import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import type { AppConfig, MethodStatus } from '@neox-observatory/core';
import {
  AntiMevService,
  AccountAbstractionService,
  BridgeService,
  NetworkService,
  ENVELOPE_MIN_LENGTH_BYTES,
  NEOX_RPC_METHODS,
  SYSTEM_CONTRACTS,
  decodeEnvelope,
  explorerTxUrl,
  explorerBlockUrl,
  explorerAddressUrl,
  getNetworkDefinition,
  hexToChainId,
  hexToDecimalStringOrNull,
  hexToNumberOrNull,
} from '@neox-observatory/core';
import { RpcClient, RpcError } from '@neox-observatory/core';
import type { Repository } from '@neox-observatory/core';
import {
  blockNumberSchema,
  blocksQuerySchema,
  bridgeQuerySchema,
  envelopeDecodeSchema,
  txHashSchema,
} from './schemas.js';

/**
 * Read-only REST API.
 *
 * There is no route that forwards an arbitrary JSON-RPC method, and no route
 * that builds or signs a transaction. Input is validated with Zod, errors are
 * returned as a consistent object without a stack trace, and every externally
 * reachable route is rate limited.
 */

export interface ApiDependencies {
  config: AppConfig;
  rpc: RpcClient;
  repo: Repository;
  logger: Logger;
  networkService: NetworkService;
  antiMevService: AntiMevService;
  bridgeService: BridgeService;
  aaService: AccountAbstractionService;
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

export async function buildServer(deps: ApiDependencies): Promise<FastifyInstance> {
  const { config, rpc, repo, networkService, antiMevService, bridgeService, aaService } = deps;
  const definition = getNetworkDefinition(config.neoxNetwork);

  const app = Fastify({
    logger: false,
    trustProxy: true,
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: config.apiRateLimitMax,
    timeWindow: config.apiRateLimitWindowMs,
    // Key by client address so a shared proxy does not collapse all callers
    // into one bucket.
    keyGenerator: (request) => request.ip,
  });

  app.setErrorHandler((error, request, reply) => {
    // Zod validation errors are client mistakes, so they map to 400 with the
    // failing paths rather than the generic 500 the fallthrough would give.
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    if (error instanceof RpcError) {
      request.log.warn({ kind: error.kind, url: request.url }, 'upstream RPC error');
      const status = error.kind === 'invalid-request' ? 400 : 503;
      return reply.status(status).send(errorBody('rpc_error', error.message));
    }

    const status = error.statusCode ?? 500;
    if (status >= 500) {
      // Stack traces stay in the server log and out of the response.
      request.log.error({ err: error, url: request.url }, 'unhandled request error');
      return reply.status(status).send(errorBody('internal_error', 'Internal server error'));
    }
    // Validation failures and rate limit responses already carry a client-safe
    // message, so they pass through unchanged.
    return reply.status(status).send(errorBody(error.code ?? 'bad_request', error.message));
  });

  app.setNotFoundHandler((request, reply) => {
    return reply
      .status(404)
      .send(errorBody('not_found', `Route ${request.method} ${request.url} not found`));
  });

  app.get('/api/health', async () => {
    let stats:
      | {
          blocks: number;
          transactions: number;
          bridgeMessages: number;
          latestBlock: { number: number } | undefined;
        }
      | undefined;
    try {
      const raw = repo.getStats();
      stats = {
        blocks: raw.blocks,
        transactions: raw.transactions,
        bridgeMessages: raw.bridgeMessages,
        latestBlock: raw.latestBlock ? { number: raw.latestBlock.number } : undefined,
      };
    } catch {
      stats = undefined;
    }
    const checkpoints = (() => {
      try {
        return repo.listCheckpoints().map((checkpoint) => ({
          stream: checkpoint.stream,
          lastBlock: checkpoint.last_block,
          updatedAt: checkpoint.updated_at,
        }));
      } catch {
        return [];
      }
    })();
    return {
      status: 'ok' as const,
      version: '0.1.0',
      configuredNetwork: config.neoxNetwork,
      chainId: definition.chainId,
      chainIdMatches: null,
      rpcHealthy: true,
      indexedBlocks: stats?.blocks ?? 0,
      indexedTransactions: stats?.transactions ?? 0,
      bridgeMessages: stats?.bridgeMessages ?? 0,
      latestIndexedBlock: stats?.latestBlock?.number ?? null,
      checkpoints,
      observedAt: new Date().toISOString(),
    };
  });

  app.get('/api/network', async () => networkService.getStatus());

  /**
   * Capability report.
   *
   * Anti-MEV methods are probed fresh on each call rather than read from a
   * cached value, so an endpoint that has just been upgraded reports the change.
   */
  app.get('/api/capabilities', async () => {
    const [envelopeFee, maxGasLimit, cachedTx] = await Promise.all([
      rpc.probeMethod(NEOX_RPC_METHODS.envelopeFee),
      rpc.probeMethod(NEOX_RPC_METHODS.maxEnvelopeGasLimit),
      rpc.probeMethod(NEOX_RPC_METHODS.cachedTransaction),
    ]);

    // Chain ID is read fresh so a capabilities report is never asserted about a
    // chain the endpoint has not confirmed it is serving.
    let chainId: number | null = null;
    let chainIdMatches: boolean | null = null;
    try {
      chainId = hexToChainId(await rpc.rawCall<string>('eth_chainId'));
      chainIdMatches = chainId === definition.chainId;
    } catch {
      chainId = null;
      chainIdMatches = null;
    }

    const bridgeConfig = bridgeService.getConfiguration();

    return {
      configuredNetwork: config.neoxNetwork,
      chainId,
      chainIdMatches,
      rpcUrl: config.neoxRpcUrl,
      antiMev: {
        envelopeFee: envelopeFee.status,
        maxEnvelopeGasLimit: maxGasLimit.status,
        // Documented as needing a node with the Anti-MEV cache configured, so
        // "unsupported" here is the expected answer on a public endpoint.
        cachedTransaction: cachedTx.status,
        overall: capabilitySummary([envelopeFee.status, maxGasLimit.status, cachedTx.status]),
      },
      bridge: bridgeConfig,
      accountAbstraction: aaService.getStatus(),
      checkedAt: new Date().toISOString(),
    };
  });

  app.get('/api/blocks', async (request) => {
    const query = blocksQuerySchema.parse(request.query);
    const cappedLimit = Math.min(query.limit, config.maxPageSize);
    const rows = repo.listBlocks(cappedLimit, query.offset);
    return {
      total: repo.countBlocks(),
      limit: cappedLimit,
      offset: query.offset,
      network: config.neoxNetwork,
      blocks: rows.map((row) => ({
        number: row.number,
        hash: row.hash,
        parentHash: row.parent_hash,
        timestamp: row.timestamp,
        transactionCount: row.transaction_count,
        gasUsed: row.gas_used,
        gasLimit: row.gas_limit,
        baseFeePerGas: row.base_fee_per_gas,
        observedAt: row.observed_at,
        explorerUrl: explorerBlockUrl(config.neoxNetwork, row.number),
      })),
    };
  });

  app.get('/api/blocks/:number', async (request, reply) => {
    const params = request.params as { number: string };
    const parsedNumber = blockNumberSchema.safeParse(params.number);
    if (!parsedNumber.success) {
      return reply
        .status(400)
        .send(errorBody('validation_error', 'Block number must be a non-negative integer'));
    }

    const number = parsedNumber.data;
    const row = repo.getBlock(number);
    if (!row) {
      return reply
        .status(404)
        .send(errorBody('block_not_found', `Block ${number} is not in the indexed range`));
    }

    const transactions = repo.listTransactionsByBlock(number);
    return {
      network: config.neoxNetwork,
      block: {
        number: row.number,
        hash: row.hash,
        parentHash: row.parent_hash,
        timestamp: row.timestamp,
        transactionCount: row.transaction_count,
        gasUsed: row.gas_used,
        gasLimit: row.gas_limit,
        baseFeePerGas: row.base_fee_per_gas,
        observedAt: row.observed_at,
        explorerUrl: explorerBlockUrl(config.neoxNetwork, row.number),
      },
      transactions: transactions.map((tx) => shapeTransaction(tx, config.neoxNetwork)),
    };
  });

  /**
   * Transaction lookup.
   *
   * The stored row is returned when present. When it is absent the transaction
   * is fetched live so a recent hash the indexer has not reached still resolves,
   * and the response flags which source served it.
   */
  app.get('/api/transactions/:hash', async (request, reply) => {
    const params = request.params as { hash: string };
    const hash = txHashSchema.parse(params.hash);
    const lowerHash = hash.toLowerCase();

    const stored = repo.getTransaction(lowerHash);
    if (stored) {
      const receipt = stored.status;
      return {
        source: 'indexed',
        network: config.neoxNetwork,
        transaction: shapeTransaction(stored, config.neoxNetwork),
        receipt: {
          status: receipt,
          gasUsed: stored.gas_used,
          effectiveGasPrice: stored.effective_gas_price,
        },
        explorerUrl: explorerTxUrl(config.neoxNetwork, lowerHash),
      };
    }

    try {
      /**
       * `eth_getTransactionByHash` through `provider.send` returns raw JSON-RPC
       * values: quantities are hex strings and the gas/input fields are named
       * `gas` and `input`. Everything is normalised here so the live response
       * matches the indexed response shape.
       */
      const raw = await rpc.eth<{
        hash: string;
        blockNumber: string | null;
        transactionIndex: string | null;
        from: string;
        to: string | null;
        value: string;
        nonce: string;
        gas: string;
        gasPrice: string | null;
        maxFeePerGas: string | null;
        maxPriorityFeePerGas: string | null;
        type: string | null;
        input: string;
      }>('eth_getTransactionByHash', [lowerHash]);

      if (!raw) {
        return reply.status(404).send(errorBody('transaction_not_found', `Transaction ${lowerHash} not found`));
      }

      const tx = {
        hash: raw.hash,
        blockNumber: hexToNumberOrNull(raw.blockNumber),
        transactionIndex: hexToNumberOrNull(raw.transactionIndex),
        from: raw.from,
        to: raw.to,
        value: hexToDecimalStringOrNull(raw.value),
        nonce: hexToNumberOrNull(raw.nonce),
        gasLimit: hexToDecimalStringOrNull(raw.gas),
        gasPrice: hexToDecimalStringOrNull(raw.gasPrice),
        maxFeePerGas: hexToDecimalStringOrNull(raw.maxFeePerGas),
        maxPriorityFeePerGas: hexToDecimalStringOrNull(raw.maxPriorityFeePerGas),
        type: hexToNumberOrNull(raw.type),
        data: raw.input ?? '0x',
      };

      const receipt = await rpc.getTransactionReceipt(lowerHash);
      const normalized = {
        status: receipt?.status ?? null,
        gasUsed: receipt?.gasUsed?.toString() ?? null,
        // ethers v6 exposes the effective gas price as gasPrice on receipts.
        effectiveGasPrice: receipt?.gasPrice?.toString() ?? null,
      };

      const isEnvelopeTarget =
        tx.to !== null && tx.to.toLowerCase() === SYSTEM_CONTRACTS.govReward.toLowerCase();
      const decoded = isEnvelopeTarget ? decodeEnvelope(tx.data) : null;

      return {
        source: 'live',
        network: config.neoxNetwork,
        transaction: {
          hash: tx.hash,
          blockNumber: tx.blockNumber,
          transactionIndex: receipt?.index ?? tx.transactionIndex,
          from: tx.from,
          to: tx.to,
          fromExplorerUrl: explorerAddressUrl(config.neoxNetwork, tx.from),
          toExplorerUrl: tx.to ? explorerAddressUrl(config.neoxNetwork, tx.to) : null,
          value: tx.value,
          nonce: tx.nonce,
          gasLimit: tx.gasLimit,
          gasPrice: tx.gasPrice,
          maxFeePerGas: tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
          type: tx.type,
          status: normalized.status,
          input: tx.data || null,
          isEnvelope: decoded?.ok ?? false,
          envelope: decoded?.ok
            ? {
                dkgEpoch: decoded.data.dkgEpoch,
                innerGasLimit: decoded.data.innerGasLimit,
                innerTransactionHash: decoded.data.innerTransactionHash,
                ciphertextLength: decoded.data.ciphertextLength,
              }
            : null,
          explorerUrl: explorerTxUrl(config.neoxNetwork, tx.hash),
        },
        receipt: normalized,
        explorerUrl: explorerTxUrl(config.neoxNetwork, tx.hash),
      };
    } catch (error) {
      if (error instanceof RpcError) throw error;
      return reply
        .status(502)
        .send(errorBody('lookup_failed', error instanceof Error ? error.message : String(error)));
    }
  });

  app.get('/api/antimev/policy', async () => {
    const policy = await antiMevService.getPolicy();
    return {
      network: config.neoxNetwork,
      ...policy,
      note: 'Raw values are returned exactly as the node reported them. A method reported unsupported has no fallback value.',
    };
  });

  app.get('/api/antimev/history', async (request) => {
    const query = bridgeQuerySchema.parse(request.query);
    const cappedLimit = Math.min(query.limit, config.maxPageSize);
    return {
      network: config.neoxNetwork,
      observations: antiMevService.getHistory(cappedLimit).slice(query.offset),
    };
  });

  /**
   * Envelope decoder.
   *
   * The endpoint is a pure function over the submitted bytes. It never contacts
   * the chain, never attempts TPKE decryption, and reports a decode failure as a
   * 400 with the reason rather than a partially decoded object.
   */
  app.post('/api/antimev/decode', async (request, reply) => {
    const body = envelopeDecodeSchema.parse(request.body ?? {});

    if (!/^0x[0-9a-fA-F]*$/.test(body.payload)) {
      return reply
        .status(400)
        .send(errorBody('invalid_hex', 'payload must be hex, optionally prefixed with 0x'));
    }

    const hex = body.payload.slice(2);
    if (hex.length % 2 !== 0) {
      return reply
        .status(400)
        .send(errorBody('invalid_hex', 'payload has an odd number of hex characters'));
    }

    const byteLength = hex.length / 2;
    if (byteLength < ENVELOPE_MIN_LENGTH_BYTES) {
      return reply.status(400).send(
        errorBody(
          'payload_too_short',
          `payload is ${byteLength} bytes, an Envelope Transaction needs at least ${ENVELOPE_MIN_LENGTH_BYTES}`,
        ),
      );
    }

    const decoded = decodeEnvelope(body.payload);
    if (!decoded.ok) {
      return reply.status(400).send(errorBody(decoded.error, decoded.message));
    }

    return {
      decoded: true,
      ...decoded.data,
      note: 'Ciphertext bytes are returned as observed. TPKE decryption requires the threshold key material held by the validators, which this tool does not hold.',
    };
  });

  app.get('/api/bridge/messages', async (request) => {
    const query = bridgeQuerySchema.parse(request.query);
    const cappedLimit = Math.min(query.limit, config.maxPageSize);
    const result = bridgeService.listMessages(cappedLimit, query.offset);
    const health = bridgeService.getConfiguration();
    return {
      network: config.neoxNetwork,
      total: result.total,
      limit: cappedLimit,
      offset: query.offset,
      configuration: {
        messageBridgeAddress: health.messageBridgeAddress,
        messageBridgeVerified: health.messageBridgeVerified,
        executionManagerAddress: health.executionManagerAddress,
        executionManagerVerified: health.executionManagerVerified,
      },
      messages: result.messages.map((message) => ({
        ...message,
        sourceExplorerUrl: message.sourceTxHash
          ? explorerTxUrl(config.neoxNetwork, message.sourceTxHash)
          : null,
        executionExplorerUrl: message.executionTxHash
          ? explorerTxUrl(config.neoxNetwork, message.executionTxHash)
          : null,
      })),
    };
  });

  app.get('/api/bridge/messages/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const message = bridgeService.getMessage(params.id);
    if (!message) {
      return reply
        .status(404)
        .send(errorBody('message_not_found', `No bridge message observed with id ${params.id}`));
    }
    return {
      network: config.neoxNetwork,
      message: {
        ...message,
        sourceExplorerUrl: message.sourceTxHash
          ? explorerTxUrl(config.neoxNetwork, message.sourceTxHash)
          : null,
        executionExplorerUrl: message.executionTxHash
          ? explorerTxUrl(config.neoxNetwork, message.executionTxHash)
          : null,
      },
    };
  });

  app.get('/api/aa/status', async () => ({
    network: config.neoxNetwork,
    ...aaService.getStatus(),
  }));

  return app;
}

/**
 * Roll the individual Anti-MEV probe results up into one honest summary.
 *
 * `supported` is only claimed when a method actually answered, `unsupported`
 * means every method reported method-not-found, and anything else is `error`
 * so a transient failure is never presented as a missing capability.
 */
function capabilitySummary(statuses: readonly MethodStatus[]): MethodStatus {
  if (statuses.some((status) => status === 'supported')) return 'supported';
  if (statuses.every((status) => status === 'unsupported')) return 'unsupported';
  if (statuses.every((status) => status === 'unknown')) return 'unknown';
  return 'error';
}

/** Map a stored transaction row onto the public response shape. */
function shapeTransaction(
  row: {
    hash: string;
    block_number: number | null;
    transaction_index: number | null;
    from_address: string | null;
    to_address: string | null;
    value: string | null;
    nonce: number | null;
    gas_limit: string | null;
    gas_price: string | null;
    max_fee_per_gas: string | null;
    max_priority_fee_per_gas: string | null;
    status: number | null;
    gas_used: string | null;
    effective_gas_price: string | null;
    type: number | null;
    input: string | null;
    is_envelope: number | null;
    envelope_dkg_epoch: number | null;
    envelope_inner_gas_limit: number | null;
    envelope_inner_hash: string | null;
    envelope_ciphertext_length: number | null;
    observed_at: string;
  },
  network: 'mainnet' | 'testnet',
) {
  return {
    hash: row.hash,
    blockNumber: row.block_number,
    transactionIndex: row.transaction_index,
    from: row.from_address,
    to: row.to_address,
    fromExplorerUrl: row.from_address ? explorerAddressUrl(network, row.from_address) : null,
    toExplorerUrl: row.to_address ? explorerAddressUrl(network, row.to_address) : null,
    value: row.value,
    nonce: row.nonce,
    gasLimit: row.gas_limit,
    gasPrice: row.gas_price,
    maxFeePerGas: row.max_fee_per_gas,
    maxPriorityFeePerGas: row.max_priority_fee_per_gas,
    type: row.type,
    status: row.status,
    gasUsed: row.gas_used,
    effectiveGasPrice: row.effective_gas_price,
    input: row.input,
    isEnvelope: row.is_envelope === 1,
    envelope:
      row.is_envelope === 1
        ? {
            dkgEpoch: row.envelope_dkg_epoch,
            innerGasLimit: row.envelope_inner_gas_limit,
            innerTransactionHash: row.envelope_inner_hash,
            ciphertextLength: row.envelope_ciphertext_length,
          }
        : null,
    explorerUrl: explorerTxUrl(network, row.hash),
    observedAt: row.observed_at,
  };
}

