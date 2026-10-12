import type {
  AccountAbstractionStatus,
  AntiMevPolicy,
  AntiMevPolicyHistoryEntry,
  BlockDetail,
  BlockSummary,
  BridgeMessageView,
  BridgeMessagesResponse,
  Capabilities,
  EnvelopeFields,
  HealthStatus,
  NetworkStatus,
  TransactionSummary,
} from './types.js';

/**
 * Typed client for the NeoX Observatory REST API.
 *
 * The client is read-only: every method maps to a GET or POST route that only
 * reads chain or database state. Nothing here signs a transaction or holds a
 * key.
 *
 * Errors from the API are raised as `NeoXObservatoryApiError` so callers can
 * branch on the machine-readable `code` instead of parsing messages.
 */

export class NeoXObservatoryApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(statusCode: number, body: unknown) {
    // An error body is not guaranteed to be an object: a reverse proxy or a
    // gateway can return plain text or HTML. Reading it defensively keeps a
    // malformed body from turning into a TypeError that hides the real status.
    const isObject = typeof body === 'object' && body !== null;
    const record = (isObject ? body : {}) as Record<string, unknown>;
    const nested = (record.error ?? null) as { code?: string; message?: string; details?: unknown } | null;
    const apiError = nested && typeof nested === 'object' ? nested : undefined;
    const fallbackMessage =
      typeof record.message === 'string' ? record.message : undefined;

    super(apiError?.message ?? fallbackMessage ?? `HTTP ${statusCode}`);
    this.name = 'NeoXObservatoryApiError';
    this.statusCode = statusCode;
    this.code = apiError?.code ?? 'unknown_error';
    this.details = apiError?.details;
  }
}

export interface NeoXObservatoryClientOptions {
  /** Base URL of the API, without a trailing slash. */
  baseUrl: string;
  /** Per-request timeout in milliseconds. Defaults to 15 seconds. */
  timeoutMs?: number;
  /** Optional fetch implementation, for tests or non-Node runtimes. */
  fetchImpl?: typeof fetch;
}

export interface ListParams {
  limit?: number;
  offset?: number;
}

export interface DecodeEnvelopeInput {
  /** Hex payload of an Envelope Transaction, with or without the 0x prefix. */
  payload: string;
}

export interface DecodedEnvelope extends EnvelopeFields {
  decoded: true;
  note: string;
}

export interface TransactionLookup {
  source: 'indexed' | 'live';
  network: string;
  transaction: TransactionSummary;
  receipt: {
    status: number | null;
    gasUsed: string | null;
    effectiveGasPrice: string | null;
  } | null;
  explorerUrl: string | null;
}


export function createNeoXObservatoryClient(options: NeoXObservatoryClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { accept: 'application/json', ...init?.headers },
      });

      const text = await response.text();
      const body = text ? (JSON.parse(text) as unknown) : {};

      if (!response.ok) {
        throw new NeoXObservatoryApiError(response.status, body);
      }
      return body as T;
    } catch (error) {
      if (error instanceof NeoXObservatoryApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request to ${path} timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function withQuery(path: string, params?: ListParams): string {
    if (!params) return path;
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const qs = query.toString();
    return qs ? `${path}?${qs}` : path;
  }

  return {
    /** Service liveness and index statistics. */
    getHealth(): Promise<HealthStatus> {
      return request<HealthStatus>('/api/health');
    },

    /** Live chain status: block head, gas price, RPC health, chain ID check. */
    getNetwork(): Promise<NetworkStatus> {
      return request<NetworkStatus>('/api/network');
    },

    /** Anti-MEV, bridge and account abstraction capability report. */
    getCapabilities(): Promise<Capabilities> {
      return request<Capabilities>('/api/capabilities');
    },

    /** Recent indexed blocks, newest first. */
    getBlocks(params?: ListParams): Promise<{ total: number; blocks: BlockSummary[] }> {
      return request(withQuery('/api/blocks', params));
    },

    /** One indexed block with its transactions. */
    getBlock(number: number): Promise<BlockDetail> {
      return request(`/api/blocks/${number}`);
    },

    /** Look up a transaction by hash, from the index or live from the node. */
    getTransaction(hash: string): Promise<TransactionLookup> {
      return request(`/api/transactions/${hash}`);
    },

    /** Current Anti-MEV policy as reported by the connected node. */
    getAntiMevPolicy(): Promise<AntiMevPolicy & { network: string; note: string }> {
      return request('/api/antimev/policy');
    },

    /** Stored Anti-MEV policy observations for history plots. */
    getAntiMevHistory(params?: ListParams): Promise<{ observations: AntiMevPolicyHistoryEntry[] }> {
      return request(withQuery('/api/antimev/history', params));
    },

    /** Deterministically decode Envelope Transaction calldata. */
    decodeEnvelope(input: DecodeEnvelopeInput): Promise<DecodedEnvelope> {
      return request('/api/antimev/decode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    },

    /** Recent observed bridge messages. */
    getBridgeMessages(params?: ListParams): Promise<BridgeMessagesResponse> {
      return request(withQuery('/api/bridge/messages', params));
    },

    /** One bridge message by its bridge nonce identifier. */
    getBridgeMessage(id: string): Promise<{ network: string; message: BridgeMessageView }> {
      return request(`/api/bridge/messages/${encodeURIComponent(id)}`);
    },

    /** Account abstraction configuration and sponsorship counters. */
    getAccountAbstractionStatus(): Promise<AccountAbstractionStatus & { network: string }> {
      return request('/api/aa/status');
    },
  };
}

export type NeoXObservatoryClient = ReturnType<typeof createNeoXObservatoryClient>;

export * from './types.js';
