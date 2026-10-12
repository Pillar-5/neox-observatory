import type { Logger } from 'pino';
import { SYSTEM_CONTRACTS } from '../constants.js';
import { CHECKPOINT_STREAMS } from '../db/schema.js';
import type { InsertTransactionParams, Repository } from '../db/repository.js';
import { decodeEnvelope } from '../envelope/decode.js';
import {
  hexToDecimalStringOrNull,
  hexToNumberOrNull,
  normalizeBlock,
  normalizeReceipt,
} from '../normalize.js';
import { RpcClient, RpcError, sleep } from '../rpc/client.js';

/**
 * Recent block indexer.
 *
 * This indexes a bounded recent window, not the full chain. On the first run it
 * starts from `startBlock`, which may be negative to mean "this many blocks
 * behind the head". After that the checkpoint table decides where to resume, so
 * a restart never reprocesses the configured history.
 *
 * The indexer is read-only: it never sends a transaction or signs anything.
 */

export interface IndexerOptions {
  rpc: RpcClient;
  repo: Repository;
  logger: Logger;
  startBlock: number;
  blockWindow: number;
  pollIntervalMs: number;
}

export interface IndexerRunResult {
  fromBlock: number;
  toBlock: number;
  blocksIndexed: number;
  transactionsIndexed: number;
}

export class BlockIndexer {
  private stopped = false;

  constructor(private readonly options: IndexerOptions) {}

  stop(): void {
    this.stopped = true;
  }

  /**
   * Decide the first block to index.
   *
   * A stored checkpoint wins. Failing that, a negative start value is resolved
   * against the current head, and a non-negative value is an absolute block.
   */
  async resolveStartBlock(): Promise<number> {
    const checkpoint = this.options.repo.getCheckpoint(CHECKPOINT_STREAMS.blocks);
    if (checkpoint) {
      this.options.logger.info(
        { checkpoint: checkpoint.last_block },
        'resuming block indexer from checkpoint',
      );
      return checkpoint.last_block + 1;
    }

    if (this.options.startBlock < 0) {
      const head = await this.options.rpc.getBlockNumber();
      const start = Math.max(0, head + this.options.startBlock);
      this.options.logger.info(
        { head, startBlock: this.options.startBlock, resolvedStart: start },
        'no checkpoint, resolving negative start block against head',
      );
      return start;
    }
    return this.options.startBlock;
  }

  /** Index one bounded batch of blocks and checkpoint the result. */
  async runOnce(): Promise<IndexerRunResult> {
    const { rpc, repo, logger, blockWindow } = this.options;
    const fromBlock = await this.resolveStartBlock();
    const head = await rpc.getBlockNumber();
    const toBlock = Math.min(fromBlock + blockWindow - 1, head);

    if (fromBlock > toBlock) {
      logger.debug({ head, fromBlock }, 'no new blocks to index');
      return { fromBlock, toBlock, blocksIndexed: 0, transactionsIndexed: 0 };
    }

    let blocksIndexed = 0;
    let transactionsIndexed = 0;

    for (let number = fromBlock; number <= toBlock; number += 1) {
      if (this.stopped) break;

      const block = await rpc.getBlock(number);
      if (!block) {
        logger.warn({ blockNumber: number }, 'block fetch returned null, skipping');
        continue;
      }

      const normalized = normalizeBlock(block);
      const txs: InsertTransactionParams[] = [];

      // Full transaction bodies are fetched by hash because a block returned
      // without prefetching carries hashes only.
      for (let index = 0; index < block.transactions.length; index += 1) {
        const hash = block.transactions[index];
        if (typeof hash !== 'string') continue;
        const row = await this.indexTransaction(hash, number, index);
        if (row) txs.push(row);
      }

      repo.insertBlockWithTransactions(
        {
          number: normalized.number,
          hash: normalized.hash,
          parent_hash: normalized.parentHash,
          timestamp: normalized.timestamp,
          transaction_count: normalized.transactionCount,
          gas_used: normalized.gasUsed,
          gas_limit: normalized.gasLimit,
          base_fee_per_gas: normalized.baseFeePerGas,
        },
        txs,
      );
      repo.setCheckpoint(CHECKPOINT_STREAMS.blocks, number);

      blocksIndexed += 1;
      transactionsIndexed += txs.length;
    }

    logger.info({ fromBlock, toBlock, blocksIndexed, transactionsIndexed }, 'indexed block batch');
    return { fromBlock, toBlock, blocksIndexed, transactionsIndexed };
  }

  /** Fetch one transaction plus its receipt and normalize it for storage. */
  private async indexTransaction(hash: string, blockNumber: number, index: number) {
    const { rpc } = this.options;
    // `provider.send` returns raw JSON-RPC values: quantities are hex strings
    // and the calldata/gas fields are named `input` and `gas`. They are
    // normalized to the storage types before inserting.
    const raw = await rpc.eth<{
      hash: string;
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
    }>('eth_getTransactionByHash', [hash]);

    if (!raw) return null;

    const tx = {
      hash: raw.hash,
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

    const receipt = await rpc.getTransactionReceipt(hash);
    const normalizedReceipt = normalizeReceipt(receipt);

    // Envelope detection needs both the recipient and the calldata. Only a
    // transaction targeting GovReward whose calldata carries the 0xffffffff
    // prefix is marked, so the prefix alone is never treated as proof.
    const isEnvelopeTarget =
      tx.to !== null && tx.to.toLowerCase() === SYSTEM_CONTRACTS.govReward.toLowerCase();
    const decoded = isEnvelopeTarget ? decodeEnvelope(tx.data) : null;

    return {
      hash: tx.hash,
      block_number: blockNumber,
      transaction_index: index,
      from_address: tx.from ?? null,
      to_address: tx.to ?? null,
      value: tx.value,
      nonce: tx.nonce,
      gas_limit: tx.gasLimit,
      gas_price: tx.gasPrice,
      max_fee_per_gas: tx.maxFeePerGas,
      max_priority_fee_per_gas: tx.maxPriorityFeePerGas,
      status: normalizedReceipt.status,
      gas_used: normalizedReceipt.gasUsed,
      effective_gas_price: normalizedReceipt.effectiveGasPrice,
      type: tx.type,
      input: tx.data || null,
      is_envelope: decoded?.ok ? 1 : 0,
      envelope_dkg_epoch: decoded?.ok ? decoded.data.dkgEpoch : null,
      envelope_inner_gas_limit: decoded?.ok ? decoded.data.innerGasLimit : null,
      envelope_inner_hash: decoded?.ok ? decoded.data.innerTransactionHash : null,
      envelope_ciphertext_length: decoded?.ok ? decoded.data.ciphertextLength : null,
    } satisfies InsertTransactionParams;
  }

  /**
   * Poll for new blocks until stopped.
   *
   * Errors are logged and the loop continues so a rate limit or a temporary
   * endpoint outage does not kill the indexer.
   */
  async runForever(): Promise<void> {
    const { logger, pollIntervalMs } = this.options;
    logger.info({ pollIntervalMs }, 'starting block indexer loop');
    while (!this.stopped) {
      try {
        await this.runOnce();
      } catch (error) {
        if (error instanceof RpcError) {
          logger.warn({ kind: error.kind, error: error.message }, 'indexer batch failed, retrying');
        } else {
          logger.error({ error: String(error) }, 'indexer batch failed');
        }
      }
      if (this.stopped) break;
      await sleep(pollIntervalMs);
    }
    logger.info('block indexer stopped');
  }
}