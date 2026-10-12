import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AppConfig, Repository, RpcClient } from '@neox-observatory/core';
import { buildServer, type ApiDependencies } from './server.js';

/**
 * Contract tests for the read-only API.
 *
 * The SDK, CLI and dashboard all consume these routes, so the response shapes
 * asserted here are the shapes those three clients are typed against. A change
 * that breaks a client breaks this file first.
 */

const config = {
  neoxNetwork: 'mainnet',
  neoxRpcUrl: 'https://mainnet-1.rpc.banelabs.org',
  apiRateLimitMax: 1000,
  apiRateLimitWindowMs: 60_000,
  maxPageSize: 500,
} as unknown as AppConfig;

/** Fake node: probes report a fixed capability set, eth_chainId returns mainnet. */
function fakeRpc(): RpcClient {
  return {
    url: config.neoxRpcUrl,
    probeMethod: async (method: string) => ({
      method,
      status:
        method === 'eth_maxEnvelopeGasLimit' ? ('unsupported' as const) : ('supported' as const),
      checkedAt: '2026-10-10T00:00:00.000Z',
    }),
    rawCall: async (method: string) => {
      if (method === 'eth_chainId') return '0xba93';
      if (method === 'eth_gasPrice') return '0x9502f9000';
      throw new Error(`unexpected rpc method ${method}`);
    },
    getBlockNumber: async () => 7_959_649,
    getBlock: async () => ({ timestamp: 1_791_620_453 }),
    getTransactionReceipt: async () => null,
  } as unknown as RpcClient;
}

function fakeRepo(): Repository {
  return {
    getStats: () => ({
      blocks: 1085,
      transactions: 305,
      bridgeMessages: 0,
      latestBlock: { number: 7_959_649 },
    }),
    listCheckpoints: () => [
      { stream: 'blocks', last_block: 7_959_649, updated_at: '2026-10-10T00:00:00.000Z' },
    ],
    listBlocks: () => [
      {
        number: 7_959_649,
        hash: '0xabc',
        parent_hash: '0xdef',
        timestamp: 1_791_620_453,
        transaction_count: 1,
        gas_used: '21000',
        gas_limit: '30000000',
        base_fee_per_gas: null,
        observed_at: '2026-10-10T00:00:00.000Z',
      },
    ],
    countBlocks: () => 1085,
    getBlock: () => null,
    getBlockTransactions: () => [],
    getTransaction: () => null,
    getBridgeMessages: () => [],
    countBridgeMessages: () => 0,
    getBridgeMessage: () => null,
    listContractChecks: () => [],
    getLatestObservation: () => null,
    getHistory: () => [],
  } as unknown as Repository;
}

/**
 * Structural stubs for the four services.
 *
 * Only the methods the routes under test call are implemented, so the cast
 * belongs here rather than on every call site.
 */
type Services = Pick<
  ApiDependencies,
  'networkService' | 'antiMevService' | 'bridgeService' | 'aaService'
>;

function fakeServices(): Services {
  return {
    networkService: {
      getStatus: async () => ({
        configuredNetwork: 'mainnet',
        chainId: 47763,
        chainIdHex: '0xba93',
        expectedChainId: 47763,
        chainIdMatches: true,
        rpcUrl: config.neoxRpcUrl,
        rpcHealthy: true,
        rpcError: null,
        latestBlockNumber: 7_959_649,
        latestBlockTimestamp: 1_791_620_453,
        gasPrice: '40000000000',
        gasPriceGwei: '40.0',
        lastObservation: null,
        antiMevCapability: 'available',
        contracts: [],
        collectedAt: '2026-10-10T00:00:00.000Z',
      }),
    },
    antiMevService: {
      getPolicy: async () => ({
        blockNumber: 7_959_649,
        chainId: 47763,
        gasPrice: '40000000000',
        capability: 'available',
        envelopeFee: {
          method: 'eth_envelopeFee',
          status: 'supported',
          rawValue: '0x0',
          normalizedValue: '0',
          error: null,
          checkedAt: '2026-10-10T00:00:00.000Z',
        },
        maxEnvelopeGasLimit: {
          method: 'eth_maxEnvelopeGasLimit',
          status: 'unsupported',
          rawValue: null,
          normalizedValue: null,
          error: 'method not found',
          checkedAt: '2026-10-10T00:00:00.000Z',
        },
        cachedTransaction: {
          method: 'eth_getCachedTransaction',
          status: 'error',
          rawValue: null,
          normalizedValue: null,
          error: 'missing value for required argument 0',
          checkedAt: '2026-10-10T00:00:00.000Z',
        },
        observedAt: '2026-10-10T00:00:00.000Z',
      }),
      getHistory: () => [],
    },
    bridgeService: {
      getConfiguration: () => ({
        messageBridgeAddress: '0x1212000000000000000000000000000000000009',
        executionManagerAddress: '0x85776439bbE26A3B6F91baB0fb8Ef3fDc769f385',
        messageBridgeVerified: true,
        executionManagerVerified: true,
        checks: [],
      }),
      listMessages: () => [],
      getMessage: () => null,
    },
    aaService: {
      getStatus: () => ({
        configured: true,
        govPaymasterAddress: '0x121200000000000000000000000000000000000a',
        entryPointAddress: '0x433709009B8330FDa32311DF1C2AFA402eD8D009',
        entryPointVersion: '0.9',
        govPaymasterHasBytecode: true,
        entryPointHasBytecode: true,
        verifiedAt: '2026-10-10T00:00:00.000Z',
        verificationError: null,
        sponsorshipIndexing: 'not_configured' as const,
        sponsorshipIndexingReason: null,
        indexedEvents: 0,
        successes: 0,
        failures: 0,
        latestIndexedBlock: null,
        sourceNote: 'Addresses verified with eth_getCode.',
      }),
    },
  } as unknown as Services;
}

describe('API contract', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({
      config,
      rpc: fakeRpc(),
      repo: fakeRepo(),
      logger: undefined as never,
      ...fakeServices(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/health reports index statistics and checkpoints', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.configuredNetwork).toBe('mainnet');
    expect(body.chainId).toBe(47763);
    expect(body.indexedBlocks).toBe(1085);
    expect(body.indexedTransactions).toBe(305);
    expect(body.checkpoints).toEqual([
      { stream: 'blocks', lastBlock: 7_959_649, updatedAt: '2026-10-10T00:00:00.000Z' },
    ]);
  });

  it('GET /api/capabilities matches the SDK Capabilities shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/capabilities' });
    expect(response.statusCode).toBe(200);

    const body = response.json();

    // Top level fields the CLI status command reads.
    expect(body.configuredNetwork).toBe('mainnet');
    expect(body.chainId).toBe(47763);
    expect(body.chainIdMatches).toBe(true);
    expect(body.rpcUrl).toBe(config.neoxRpcUrl);

    // antiMev is keyed by friendly name, not by raw method name, and each
    // value is a status string the dashboard renders directly.
    expect(body.antiMev).toEqual({
      envelopeFee: 'supported',
      maxEnvelopeGasLimit: 'unsupported',
      cachedTransaction: 'supported',
      overall: 'supported',
    });

    // bridge carries the flat address/verified fields plus the check list.
    expect(body.bridge.messageBridgeAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(body.bridge.executionManagerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(body.bridge.messageBridgeVerified).toBe(true);
    expect(body.bridge.executionManagerVerified).toBe(true);
    expect(Array.isArray(body.bridge.checks)).toBe(true);

    expect(body.accountAbstraction.configured).toBe(true);
    expect(body.accountAbstraction.entryPointVersion).toBe('0.9');
    expect(typeof body.checkedAt).toBe('string');
  });

  it('GET /api/network returns the documented NetworkStatus fields', async () => {
    const body = await (await app.inject({ method: 'GET', url: '/api/network' })).json();
    expect(body).toMatchObject({
      configuredNetwork: 'mainnet',
      chainId: 47763,
      chainIdHex: '0xba93',
      expectedChainId: 47763,
      chainIdMatches: true,
      rpcHealthy: true,
      latestBlockNumber: 7_959_649,
      gasPriceGwei: '40.0',
    });
    expect(Array.isArray(body.contracts)).toBe(true);
  });

  it('GET /api/blocks validates the limit instead of returning an unbounded set', async () => {
    const tooLarge = await app.inject({ method: 'GET', url: '/api/blocks?limit=5000' });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json().error.code).toBe('validation_error');

    const negative = await app.inject({ method: 'GET', url: '/api/blocks?limit=-1' });
    expect(negative.statusCode).toBe(400);

    const valid = await app.inject({ method: 'GET', url: '/api/blocks?limit=5' });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().limit).toBe(5);
  });

  it('rejects a malformed transaction hash with 400, not a database error', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/transactions/not-a-hash' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_error');
  });

  it('rejects a non-integer block number with 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/blocks/abc' });
    expect(response.statusCode).toBe(400);
  });

  it('answers unknown routes with the standard error envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('never exposes a stack trace when a handler throws', async () => {
    const brokenRepo = {
      ...fakeRepo(),
      listBlocks: () => {
        throw new Error('database is locked at C:\\app\\db.ts:42:7');
      },
    } as unknown as Repository;

    const failing = await buildServer({
      config,
      rpc: fakeRpc(),
      repo: brokenRepo,
      logger: undefined as never,
      ...fakeServices(),
    });
    await failing.ready();

    const response = await failing.inject({ method: 'GET', url: '/api/blocks' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
    expect(response.body).not.toMatch(/db\.ts:42/);
    expect(response.body).not.toMatch(/\bat .*C:/);

    await failing.close();
  });

  it('reports a chain ID mismatch instead of hiding it', async () => {
    const mismatched = await buildServer({
      config,
      rpc: {
        ...fakeRpc(),
        rawCall: async (method: string) => (method === 'eth_chainId' ? '0x1' : '0x0'),
      } as unknown as RpcClient,
      repo: fakeRepo(),
      logger: undefined as never,
      ...fakeServices(),
    });
    await mismatched.ready();

    const body = JSON.parse((await mismatched.inject({ url: '/api/capabilities' })).body);
    expect(body.chainId).toBe(1);
    expect(body.chainIdMatches).toBe(false);

    await mismatched.close();
  });

  it('leaves chain ID null when the node will not answer', async () => {
    const broken = await buildServer({
      config,
      rpc: {
        ...fakeRpc(),
        rawCall: async () => {
          throw new Error('node unreachable');
        },
      } as unknown as RpcClient,
      repo: fakeRepo(),
      logger: undefined as never,
      ...fakeServices(),
    });
    await broken.ready();

    const body = JSON.parse((await broken.inject({ url: '/api/capabilities' })).body);
    expect(body.chainId).toBeNull();
    expect(body.chainIdMatches).toBeNull();

    await broken.close();
  });
});
