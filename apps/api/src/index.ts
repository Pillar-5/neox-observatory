import {
  AccountAbstractionService,
  AntiMevService,
  BlockIndexer,
  BridgeService,
  NetworkService,
  RpcClient,
  createLogger,
  loadConfigFromDisk,
  openDatabase,
} from '@neox-observatory/core';
import { buildServer } from './server.js';

/**
 * API entry point.
 *
 * Startup order matters. Configuration is parsed first, then the chain ID the
 * endpoint reports is compared with the configured network and a mismatch stops
 * startup. Only then are the bridge contracts verified and the indexer started,
 * so the first request never lands on an unverified chain.
 */

const logger = createLogger(
  (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
);

async function main(): Promise<void> {
  const config = await loadConfigFromDisk();

  const { db, repo } = openDatabase(config.databasePath);

  const rpc = new RpcClient({
    url: config.neoxRpcUrl,
    chainId: config.neoxNetwork === 'mainnet' ? 47763 : 12227332,
    network: config.neoxNetwork,
    timeoutMs: config.rpcTimeoutMs,
    retries: config.rpcRetries,
    concurrency: config.rpcConcurrency,
    logger,
  });

  const networkService = new NetworkService(rpc, repo, logger, config.neoxNetwork);
  const antiMevService = new AntiMevService(rpc, repo, logger);
  const bridgeService = new BridgeService(rpc, repo, logger);
  const aaService = new AccountAbstractionService(rpc, repo, logger);

  try {
    await networkService.verifyChainId();
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'chain ID verification failed',
    );
    process.exit(1);
  }

  try {
    await bridgeService.verifyContracts();
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'bridge contract verification failed',
    );
  }

  try {
    await aaService.verifyContracts();
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'AA contract check failed',
    );
  }

  const indexer = new BlockIndexer({
    rpc,
    repo,
    logger,
    startBlock: config.indexerStartBlock,
    blockWindow: config.indexerBlockWindow,
    pollIntervalMs: config.indexerPollIntervalMs,
  });

  indexer.runForever().catch((error) => {
    logger.error({ error: String(error) }, 'indexer loop exited unexpectedly');
  });

  const bridgeTimer = setInterval(() => {
    bridgeService
      .indexEvents(config.bridgeLookbackBlocks)
      .catch((error) => {
        logger.warn({ error: String(error) }, 'bridge indexing pass failed');
      });
  }, config.bridgePollIntervalMs);

  bridgeService
    .indexEvents(config.bridgeLookbackBlocks)
    .catch((error) => {
      logger.warn({ error: String(error) }, 'initial bridge indexing pass failed');
    });

  const server = await buildServer({
    config,
    rpc,
    repo,
    logger,
    networkService,
    antiMevService,
    bridgeService,
    aaService,
  });

  await server.listen({ port: config.apiPort, host: '0.0.0.0' });
  logger.info(
    { port: config.apiPort, network: config.neoxNetwork, rpcUrl: config.neoxRpcUrl },
    'NeoX Observatory API listening',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    clearInterval(bridgeTimer);
    indexer.stop();
    await server.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error({ error: String(error) }, 'startup failed');
  process.exit(1);
});
