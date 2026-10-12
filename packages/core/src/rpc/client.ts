import { JsonRpcProvider, type TransactionReceipt } from 'ethers';
import type { Logger } from 'pino';

/** Reason an RPC call failed, used for retry and capability decisions. */
export type RpcErrorKind =
  | 'timeout'
  | 'rate-limit'
  | 'server-error'
  | 'method-not-found'
  | 'invalid-request'
  | 'network-error'
  | 'unknown';

/** Normalized error carrying the classification the caller needs. */
export class RpcError extends Error {
  readonly kind: RpcErrorKind;
  readonly code: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, kind: RpcErrorKind, code?: number) {
    super(message);
    this.name = 'RpcError';
    this.kind = kind;
    this.code = code;
    this.retryable = kind === 'timeout' || kind === 'rate-limit' || kind === 'server-error';
  }
}

export interface RpcClientOptions {
  url: string;
  chainId: number;
  network: string;
  timeoutMs: number;
  retries: number;
  concurrency: number;
  logger: Logger;
  /** Extra headers, for endpoints that require a user agent. */
  headers?: Record<string, string>;
}

/**
 * How a Neo X-specific RPC method behaved when probed.
 *
 * `unsupported` is distinct from `error`: an endpoint answering -32601 genuinely
 * lacks the method, while `error` means the method exists but the call failed
 * for another reason and may succeed later.
 */
export type CapabilityStatus = 'unsupported' | 'supported' | 'error' | 'unknown';

export interface MethodCapability {
  method: string;
  status: CapabilityStatus;
  /** Raw value returned when the call succeeded. */
  value?: unknown;
  /** Error message when the call failed. */
  error?: string;
  /** HTTP or JSON-RPC error code when present. */
  code?: number;
  checkedAt: string;
}

const MAX_TIMEOUT_MS = 120_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Map a JSON-RPC error code onto the project's error taxonomy. */
export function toRpcError(code: number | undefined, message: string): RpcError {
  switch (code) {
    case -32601:
      return new RpcError(message, 'method-not-found', code);
    case -32600:
    case -32602:
      return new RpcError(message, 'invalid-request', code);
    case -32005:
      return new RpcError(message, 'rate-limit', code);
    case -32603:
      return new RpcError(message, 'server-error', code);
    default:
      if (code === undefined || code === null) {
        return new RpcError(message, 'network-error');
      }
      if (code <= -32000) return new RpcError(message, 'server-error', code);
      return new RpcError(message, 'unknown', code);
  }
}

/**
 * Neo X RPC client.
 *
 * Standard Ethereum methods go through ethers so blocks, receipts and logs get
 * their usual decoding. Neo X-specific methods are not part of the ethers
 * surface, so they are issued as raw JSON-RPC over fetch. That also lets this
 * client classify the -32601 response an endpoint without Anti-MEV support
 * returns, which ethers would otherwise surface as a generic transport error.
 */
export class RpcClient {
  readonly url: string;
  readonly chainId: number;
  readonly network: string;

  private readonly provider: JsonRpcProvider;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly logger: Logger;
  private readonly headers: Record<string, string>;
  private requestId = 0;

  /** Semaphore state keeping in-flight RPC calls under the configured bound. */
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private concurrencyLimit = 8;

  private readonly capabilities = new Map<string, MethodCapability>();

  constructor(options: RpcClientOptions) {
    this.url = options.url;
    this.chainId = options.chainId;
    this.network = options.network;
    this.timeoutMs = Math.min(options.timeoutMs, MAX_TIMEOUT_MS);
    this.retries = options.retries;
    this.concurrencyLimit = options.concurrency;
    this.logger = options.logger.child({ component: 'rpc' });
    this.headers = options.headers ?? {};

    // staticNetwork avoids a redundant eth_chainId round trip per call, and
    // disabling batching keeps one slow method from delaying its siblings.
    this.provider = new JsonRpcProvider(this.url, this.chainId, {
      staticNetwork: true,
      batchMaxCount: 1,
    });
  }

  setConcurrencyLimit(limit: number): void {
    this.concurrencyLimit = Math.max(1, Math.min(64, limit));
  }

  /**
   * Take a concurrency slot and return the release function.
   *
   * Waiting callers are queued and woken in arrival order so a burst of requests
   * is throttled rather than refused.
   */
  private async acquire(): Promise<() => void> {
    if (this.active < this.concurrencyLimit) {
      this.active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this.active -= 1;
        this.waiters.shift()?.();
      };
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    return this.acquire();
  }

  /** Issue a raw JSON-RPC request with timeout, retry and classification. */
  async rawCall<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const release = await this.acquire();
    try {
      return await this.withRetry(async () => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: ++this.requestId, method, params });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await fetch(this.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...this.headers },
            body,
            signal: controller.signal,
          });

          if (response.status === 429) {
            throw new RpcError('RPC rate limited', 'rate-limit', 429);
          }
          if (response.status >= 500) {
            throw new RpcError(
              `RPC server error ${response.status}`,
              'server-error',
              response.status,
            );
          }
          if (!response.ok) {
            throw new RpcError(
              `RPC HTTP ${response.status}`,
              response.status === 400 ? 'invalid-request' : 'network-error',
              response.status,
            );
          }

          const payload = (await response.json()) as {
            result?: unknown;
            error?: { code?: number; message?: string };
          };

          if (payload.error) {
            throw toRpcError(payload.error.code, payload.error.message ?? 'RPC error');
          }
          return payload.result as T;
        } finally {
          clearTimeout(timer);
        }
      });
    } finally {
      release();
    }
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        const normalized =
          error instanceof RpcError ? error : new RpcError(String(error), 'unknown');
        lastError = normalized;
        if (!normalized.retryable || attempt === this.retries) {
          throw normalized;
        }
        const backoff = Math.min(1000 * 2 ** attempt, 8000);
        this.logger.warn(
          { method: 'retry', attempt: attempt + 1, kind: normalized.kind, backoff },
          'retrying RPC call',
        );
        await sleep(backoff);
      }
    }
    throw lastError instanceof Error ? lastError : new RpcError(String(lastError), 'unknown');
  }

  /** Call an ordinary Ethereum method through ethers. */
  async eth<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const release = await this.acquire();
    try {
      return (await this.withRetry(() => this.provider.send(method, params))) as T;
    } finally {
      release();
    }
  }

  getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  getBlock(blockNumber: number) {
    return this.provider.getBlock(blockNumber);
  }

  getTransactionReceipt(hash: string): Promise<TransactionReceipt | null> {
    return this.provider.getTransactionReceipt(hash);
  }

  getCode(address: string, blockTag: number | 'latest' = 'latest'): Promise<string> {
    return this.provider.getCode(address, blockTag);
  }

  getLogs(filter: {
    address?: string[];
    topics?: Array<string | string[] | null>;
    fromBlock: number;
    toBlock: number;
  }) {
    return this.provider.getLogs({
      address: filter.address,
      topics: filter.topics,
      fromBlock: filter.fromBlock,
      toBlock: filter.toBlock,
    });
  }

  /**
   * Probe a Neo X-specific method once and cache the outcome.
   *
   * A method reported unsupported stays unsupported for the lifetime of this
   * client, so the rest of the application can skip it without re-probing. A
   * transient `error` is retried on the next probe rather than cached.
   */
  async probeMethod(method: string, params: unknown[] = []): Promise<MethodCapability> {
    const cached = this.capabilities.get(method);
    if (cached && cached.status !== 'error') return cached;

    const checkedAt = new Date().toISOString();
    try {
      const value = await this.rawCall<unknown>(method, params);
      const capability: MethodCapability = { method, status: 'supported', value, checkedAt };
      this.capabilities.set(method, capability);
      return capability;
    } catch (error) {
      const normalized =
        error instanceof RpcError ? error : new RpcError(String(error), 'unknown');
      const capability: MethodCapability = {
        method,
        status: normalized.kind === 'method-not-found' ? 'unsupported' : 'error',
        error: normalized.message,
        code: normalized.code,
        checkedAt,
      };
      this.capabilities.set(method, capability);
      return capability;
    }
  }

  getCapability(method: string): MethodCapability | undefined {
    return this.capabilities.get(method);
  }

  listCapabilities(): MethodCapability[] {
    return [...this.capabilities.values()];
  }

  destroy(): void {
    this.provider.destroy();
  }
}

