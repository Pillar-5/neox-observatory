import { loadConfigFromDisk, expectedChainId } from '../config.js';
import { createLogger } from '../logger.js';
import { openDatabase } from '../db/database.js';
import { RpcClient } from '../rpc/client.js';
import { NetworkService } from '../services/network.js';
import { BlockIndexer } from './blocks.js';

/**
 * `npm run indexer:once` entry point.
 *
 * Runs a single indexing batch against the configured endpoint, verifies the
 * chain ID first, then exits. Used to validate indexing without starting the
 * long-running API process.
 */
async function main(): Promise<void> {
  const config = await loadConfigFromDisk();
  const logger = createLogger(config.logLevel);

  const rpc = new RpcClient({
    url: config.neoxRpcUrl,
    chainId: expectedChainId(config.neoxNetwork),
    network: config.neoxNetwork,
    timeoutMs: config.rpcTimeoutMs,
    retries: config.rpcRetries,
    concurrency: config.rpcConcurrency,
    logger,
  });

  try {
    const { db, repo } = openDatabase(config.databasePath);
    const network = new NetworkService(rpc, repo, logger, config.neoxNetwork);
    const { chainId } = await network.verifyChainId();

    const indexer = new BlockIndexer({
      rpc,
      repo,
      logger,
      startBlock: config.indexerStartBlock,
      blockWindow: config.indexerBlockWindow,
      pollIntervalMs: config.indexerPollIntervalMs,
    });

    const result = await indexer.runOnce();
    process.stdout.write(
      `indexed blocks ${result.fromBlock}-${result.toBlock} ` +
        `(${result.blocksIndexed} blocks, ${result.transactionsIndexed} transactions) on chain ${chainId}\n`,
    );
    db.close();
  } finally {
    rpc.destroy();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
