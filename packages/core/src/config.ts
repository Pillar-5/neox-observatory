import { z } from 'zod';
import { NETWORKS, type NetworkName } from './constants.js';

/**
 * Application configuration, parsed from the environment with Zod.
 *
 * The RPC URL is deliberately not hardcoded to a MainNet endpoint: the caller
 * must opt in to a network. Read-only development against TestNet is the
 * natural default, and a mismatch between the configured network and the chain
 * ID the endpoint reports is a hard error rather than a warning.
 */

const networkNameSchema = z.enum(['mainnet', 'testnet']);

const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().nonnegative();

export const configSchema = z.object({
  /** JSON-RPC endpoint used for all Neo X reads. */
  neoxRpcUrl: z.string().url('NEOX_RPC_URL must be a valid URL'),
  /** Which network the operator claims the endpoint serves. */
  neoxNetwork: networkNameSchema,
  /**
   * Optional Neo N3 endpoint used only to enrich bridge destination data.
   * Empty when the operator has not configured one.
   */
  neoN3RpcUrl: z.string().url().optional().or(z.literal('')),
  /** SQLite file path. */
  databasePath: z.string().min(1),
  /** HTTP port for the REST API. */
  apiPort: positiveInt,
  /** HTTP port for the web dashboard in development. */
  webPort: positiveInt,
  /**
   * Where indexing starts. Zero or positive values are absolute block numbers.
   * Negative values mean "this many blocks behind the head".
   */
  indexerStartBlock: z.coerce.number().int(),
  /** Blocks processed per indexing batch. */
  indexerBlockWindow: positiveInt.max(1000),
  /** Milliseconds between head polls. */
  indexerPollIntervalMs: nonNegativeInt,
  /** Number of blocks scanned backwards for bridge events. */
  bridgeLookbackBlocks: positiveInt.max(100_000),
  /** Milliseconds between bridge event scans. */
  bridgePollIntervalMs: nonNegativeInt,
  /** Per-RPC-call timeout in milliseconds. */
  rpcTimeoutMs: positiveInt,
  /** Retries for a failed RPC call, excluding the first attempt. */
  rpcRetries: nonNegativeInt.max(10),
  /** Maximum in-flight RPC calls. */
  rpcConcurrency: positiveInt.max(64),
  /** Public API rate limit window in milliseconds. */
  apiRateLimitWindowMs: positiveInt,
  /** Maximum requests per rate limit window per client. */
  apiRateLimitMax: positiveInt,
  /** Maximum blocks returned by a single list request. */
  maxPageSize: positiveInt.max(500),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
});

export type AppConfig = z.infer<typeof configSchema>;

export interface RawEnv {
  NEOX_RPC_URL?: string;
  NEOX_NETWORK?: string;
  NEO_N3_RPC_URL?: string;
  DATABASE_PATH?: string;
  API_PORT?: string;
  WEB_PORT?: string;
  INDEXER_START_BLOCK?: string;
  INDEXER_BLOCK_WINDOW?: string;
  INDEXER_POLL_INTERVAL_MS?: string;
  BRIDGE_LOOKBACK_BLOCKS?: string;
  BRIDGE_POLL_INTERVAL_MS?: string;
  RPC_TIMEOUT_MS?: string;
  RPC_RETRIES?: string;
  RPC_CONCURRENCY?: string;
  API_RATE_LIMIT_WINDOW_MS?: string;
  API_RATE_LIMIT_MAX?: string;
  MAX_PAGE_SIZE?: string;
  LOG_LEVEL?: string;
}

export interface ParseConfigResult {
  config: AppConfig;
  /** Environment variable names that were absent and received a default. */
  defaultsUsed: string[];
}

/**
 * Parse configuration from a raw environment object.
 *
 * Defaults cover the operational tuning knobs so a developer only has to supply
 * the RPC URL and the network name.
 */
export function parseConfig(env: RawEnv = {}): ParseConfigResult {
  const defaultsUsed: string[] = [];

  const take = <T>(value: T | undefined, fallback: T, name: string): T => {
    if (value === undefined || value === '') {
      defaultsUsed.push(name);
      return fallback;
    }
    return value;
  };

  const network = (env.NEOX_NETWORK ?? 'testnet') as NetworkName;
  if (!NETWORKS[network]) {
    throw new Error(
      `NEOX_NETWORK must be one of ${Object.keys(NETWORKS).join(', ')} (received "${network}")`,
    );
  }

  const rpcUrl = take(env.NEOX_RPC_URL, NETWORKS[network].rpcUrls[0] ?? '', 'NEOX_RPC_URL');
  const neoN3 = env.NEO_N3_RPC_URL?.trim() ? env.NEO_N3_RPC_URL.trim() : '';

  const parsed = configSchema.parse({
    neoxRpcUrl: rpcUrl,
    neoxNetwork: network,
    neoN3RpcUrl: neoN3,
    databasePath: take(env.DATABASE_PATH, './data/neox-observatory.db', 'DATABASE_PATH'),
    apiPort: take(env.API_PORT, '3000', 'API_PORT'),
    webPort: take(env.WEB_PORT, '5173', 'WEB_PORT'),
    indexerStartBlock: take(env.INDEXER_START_BLOCK, '-2000', 'INDEXER_START_BLOCK'),
    indexerBlockWindow: take(env.INDEXER_BLOCK_WINDOW, '100', 'INDEXER_BLOCK_WINDOW'),
    indexerPollIntervalMs: take(env.INDEXER_POLL_INTERVAL_MS, '3000', 'INDEXER_POLL_INTERVAL_MS'),
    bridgeLookbackBlocks: take(env.BRIDGE_LOOKBACK_BLOCKS, '5000', 'BRIDGE_LOOKBACK_BLOCKS'),
    bridgePollIntervalMs: take(env.BRIDGE_POLL_INTERVAL_MS, '15000', 'BRIDGE_POLL_INTERVAL_MS'),
    rpcTimeoutMs: take(env.RPC_TIMEOUT_MS, '15000', 'RPC_TIMEOUT_MS'),
    rpcRetries: take(env.RPC_RETRIES, '2', 'RPC_RETRIES'),
    rpcConcurrency: take(env.RPC_CONCURRENCY, '8', 'RPC_CONCURRENCY'),
    apiRateLimitWindowMs: take(env.API_RATE_LIMIT_WINDOW_MS, '60000', 'API_RATE_LIMIT_WINDOW_MS'),
    apiRateLimitMax: take(env.API_RATE_LIMIT_MAX, '120', 'API_RATE_LIMIT_MAX'),
    maxPageSize: take(env.MAX_PAGE_SIZE, '100', 'MAX_PAGE_SIZE'),
    logLevel: take(env.LOG_LEVEL, 'info', 'LOG_LEVEL'),
  });

  return { config: parsed, defaultsUsed };
}

/**
 * Load a .env file when present, then parse configuration.
 *
 * dotenv is imported lazily so importing this module never mutates
 * process.env unless the caller asks for it.
 */
export async function loadConfigFromDisk(env: NodeJS.ProcessEnv = process.env): Promise<AppConfig> {
  const dotenv = await import('dotenv');
  dotenv.config();
  return parseConfig(env as RawEnv).config;
}

/** Expected chain ID for the configured network name. */
export function expectedChainId(network: NetworkName): number {
  return NETWORKS[network].chainId;
}

