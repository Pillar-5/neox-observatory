import type { Logger } from 'pino';
import { Interface, id as keccakId } from 'ethers';
import messageBridgeAbi from './abis/MessageBridge.json';
import executionManagerAbi from './abis/ExecutionManager.json';
import { EXECUTION_MANAGER_ADDRESS, SYSTEM_CONTRACTS } from '../constants.js';
import { CHECKPOINT_STREAMS } from '../db/schema.js';
import type { Repository } from '../db/repository.js';
import { RpcClient } from '../rpc/client.js';

/**
 * Message Bridge integration.
 *
 * ABI fragments are vendored from the official bane-labs/bridge-evm-contracts
 * release artifacts. Only the events this project indexes are kept, and the
 * origin is recorded in docs/sources.md. No event signature is written by hand,
 * because a hand-typed topic hash would silently mismatch the real contract.
 *
 * MessageSend is emitted when Neo X sends a message out. Execution is emitted
 * when Neo X finishes executing a message that arrived. Both carry the bridge
 * nonce, which is the identifier used to correlate the two sides.
 */

export const MESSAGE_BRIDGE_ADDRESS = SYSTEM_CONTRACTS.messageBridge;

export const messageBridgeInterface = new Interface(
  messageBridgeAbi as unknown as ReadonlyArray<Record<string, unknown>>,
);

export const executionManagerInterface = new Interface(
  executionManagerAbi as unknown as ReadonlyArray<Record<string, unknown>>,
);

/** Topic hashes derived from the vendored ABI, never typed by hand. */
export const EVENT_TOPICS = {
  messageSend: keccakId(messageBridgeInterface.getEvent('MessageSend')!.format('sighash')),
  execution: keccakId(messageBridgeInterface.getEvent('Execution')!.format('sighash')),
  store: keccakId(messageBridgeInterface.getEvent('Store')!.format('sighash')),
} as const;

/** A normalized bridge event ready to be stored. */
export interface ParsedBridgeEvent {
  name: string;
  nonce: string;
  sender: string | null;
  message: string | null;
  encodedMetadata: string | null;
  messageHash: string | null;
  success: boolean | null;
  returnData: string | null;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  address: string;
}

export interface BridgeMessageView {
  id: string;
  nonce: string;
  direction: string;
  messageType: string | null;
  sourceTxHash: string | null;
  sourceBlockNumber: number | null;
  sourceAddress: string | null;
  destinationAddress: string | null;
  targetAddress: string | null;
  payloadLength: number | null;
  state: string;
  executionTxHash: string | null;
  executionBlockNumber: number | null;
  callbackTxHash: string | null;
  errorMessage: string | null;
  sourceObservedAt: string | null;
  executionObservedAt: string | null;
  latencySeconds: number | null;
  observedAt: string;
  updatedAt: string;
}

export interface ContractVerification {
  key: string;
  address: string;
  hasBytecode: boolean;
  bytecodeLength: number | null;
  error: string | null;
  verifiedAt: string;
}

/**
 * Byte length of a 0x-prefixed hex string, ignoring the prefix. Null input
 * yields null so callers can distinguish "no data" from "zero-length data".
 */
export function hexByteLength(value: string | null): number | null {
  if (value === null || value === undefined) return null;
  const body = value.startsWith('0x') ? value.slice(2) : value;
  return body.length / 2;
}


/**
 * Parse one raw log into a bridge event.
 *
 * Returns null when the log topic does not match a known bridge event, which
 * keeps unrelated logs emitted by the same contract out of the message table.
 */
export function parseBridgeLog(log: {
  address: string;
  topics: readonly string[];
  data: string;
  transactionHash: string;
  blockNumber: number;
  index: number;
}): ParsedBridgeEvent | null {
  const topic0 = log.topics[0];
  if (!topic0) return null;

  if (topic0 === EVENT_TOPICS.messageSend) {
    const parsed = messageBridgeInterface.parseLog({ topics: [...log.topics], data: log.data });
    if (!parsed) return null;
    return {
      name: 'MessageSend',
      nonce: (parsed.args.nonce as bigint).toString(),
      sender: String(parsed.args.sender),
      message: String(parsed.args.message),
      encodedMetadata: String(parsed.args.encodedMetadata),
      messageHash: String(parsed.args.messageHash),
      success: null,
      returnData: null,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      address: log.address,
    };
  }

  if (topic0 === EVENT_TOPICS.execution) {
    const parsed = messageBridgeInterface.parseLog({ topics: [...log.topics], data: log.data });
    if (!parsed) return null;
    const result = parsed.args.result as { success: boolean; returnData: string };
    return {
      name: 'Execution',
      nonce: (parsed.args.nonce as bigint).toString(),
      sender: null,
      message: null,
      encodedMetadata: null,
      messageHash: null,
      success: Boolean(result.success),
      returnData: String(result.returnData),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      address: log.address,
    };
  }

  return null;
}

/**
 * Verify a deployed contract by reading its bytecode.
 *
 * An empty response means nothing is deployed at that address on the connected
 * chain, which is reported rather than assumed away. The result is persisted so
 * the dashboard can show the last verified state.
 */
export class BridgeService {
  constructor(
    private readonly rpc: RpcClient,
    private readonly repo: Repository,
    private readonly logger: Logger,
  ) {}

  /** Check that MessageBridge and ExecutionManager both have deployed code. */
  async verifyContracts(): Promise<ContractVerification[]> {
    const targets = [
      { key: 'message_bridge', address: MESSAGE_BRIDGE_ADDRESS },
      { key: 'execution_manager', address: EXECUTION_MANAGER_ADDRESS },
    ];

    const results: ContractVerification[] = [];
    for (const target of targets) {
      const verifiedAt = new Date().toISOString();
      try {
        const code = await this.rpc.getCode(target.address);
        const hasBytecode = code !== '0x' && code.length > 2;
        const bytecodeLength = hasBytecode ? (code.length - 2) / 2 : 0;
        const error = hasBytecode ? null : 'eth_getCode returned no bytecode at this address';

        this.repo.upsertContractCheck({
          contract_key: target.key,
          address: target.address,
          has_bytecode: hasBytecode,
          bytecode_length: bytecodeLength,
          error,
        });

        this.logger.info(
          { contract: target.key, address: target.address, hasBytecode, bytecodeLength },
          'verified contract bytecode',
        );
        results.push({
          key: target.key,
          address: target.address,
          hasBytecode,
          bytecodeLength,
          error,
          verifiedAt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.repo.upsertContractCheck({
          contract_key: target.key,
          address: target.address,
          has_bytecode: false,
          bytecode_length: null,
          error: message,
        });
        this.logger.error({ contract: target.key, error: message }, 'contract verification failed');
        results.push({
          key: target.key,
          address: target.address,
          hasBytecode: false,
          bytecodeLength: null,
          error: message,
          verifiedAt,
        });
      }
    }

    return results;
  }

  /**
   * Index MessageBridge events over a bounded recent range.
   *
   * The checkpoint stores the last scanned block so a restart continues where it
   * stopped. MessageSend creates or updates a message row, and Execution fills in
   * the execution side of the message carrying the same nonce when it is visible.
   *
   * Destination data on Neo N3 is not fetched here. Correlating the far side
   * needs a Neo N3 client, and this tool only enables that when the operator
   * supplies NEO_N3_RPC_URL, so a message whose destination has not been
   * observed stays in an explicit partial state instead of being reported as
   * complete.
   */
  async indexEvents(
    lookbackBlocks: number,
  ): Promise<{ fromBlock: number; toBlock: number; eventsProcessed: number }> {
    const head = await this.rpc.getBlockNumber();
    const checkpoint = this.repo.getCheckpoint(CHECKPOINT_STREAMS.bridge);
    const fromBlock = checkpoint
      ? checkpoint.last_block + 1
      : Math.max(0, head - lookbackBlocks);
    const toBlock = head;

    if (fromBlock > toBlock) {
      return { fromBlock, toBlock, eventsProcessed: 0 };
    }

    const logs = await this.rpc.getLogs({
      address: [MESSAGE_BRIDGE_ADDRESS, EXECUTION_MANAGER_ADDRESS],
      fromBlock,
      toBlock,
    });

    let eventsProcessed = 0;
    for (const log of logs) {
      const parsed = parseBridgeLog(log);
      if (!parsed) continue;
      const observedAt = new Date().toISOString();

      if (parsed.name === 'MessageSend') {
        this.repo.upsertBridgeMessage({
          id: parsed.nonce,
          sequence_id: parsed.nonce,
          direction: 'neox_outbound',
          message_type: 'MessageSend',
          source_tx_hash: parsed.txHash,
          source_block_number: parsed.blockNumber,
          source_contract: parsed.address,
          source_address: parsed.sender,
          destination_address: null,
          target_address: null,
          payload_length: hexByteLength(parsed.message),
          state: 'message_observed',
          execution_tx_hash: null,
          execution_block_number: null,
          callback_tx_hash: null,
          error_message: null,
          source_observed_at: observedAt,
          execution_observed_at: null,
          latency_seconds: null,
          raw_event_json: JSON.stringify({
            encodedMetadata: parsed.encodedMetadata,
            messageHash: parsed.messageHash,
            payloadLength: hexByteLength(parsed.message),
          }),
        });
        eventsProcessed += 1;
        continue;
      }

      const existing = this.repo.getBridgeMessage(parsed.nonce);
      const sourceObservedAt = existing?.source_observed_at ?? null;

      this.repo.upsertBridgeMessage({
        id: parsed.nonce,
        sequence_id: parsed.nonce,
        direction: 'neox_inbound',
        message_type: 'Execution',
        source_tx_hash: existing?.source_tx_hash ?? null,
        source_block_number: existing?.source_block_number ?? null,
        source_contract: existing?.source_contract ?? null,
        source_address: existing?.source_address ?? null,
        destination_address: existing?.destination_address ?? null,
        target_address: existing?.target_address ?? null,
        payload_length: existing?.payload_length ?? null,
        state: parsed.success ? 'execution_observed' : 'execution_failed',
        execution_tx_hash: parsed.txHash,
        execution_block_number: parsed.blockNumber,
        callback_tx_hash: null,
        error_message: parsed.success
          ? null
          : `Execution reported success=false, returnData=${parsed.returnData ?? ''}`,
        source_observed_at: sourceObservedAt,
        execution_observed_at: observedAt,
        latency_seconds: sourceObservedAt
          ? Math.max(
              0,
              Math.round(
                (new Date(observedAt).getTime() - new Date(sourceObservedAt).getTime()) / 1000,
              ),
            )
          : null,
        raw_event_json: existing?.raw_event_json ?? null,
      });
      eventsProcessed += 1;
    }

    this.repo.setCheckpoint(CHECKPOINT_STREAMS.bridge, toBlock);
    this.logger.info({ fromBlock, toBlock, eventsProcessed }, 'indexed bridge events');
    return { fromBlock, toBlock, eventsProcessed };
  }

  /** Stored bridge messages, most recent source block first. */
  listMessages(limit: number, offset: number): { total: number; messages: BridgeMessageView[] } {
    const rows = this.repo.listBridgeMessages(limit, offset);
    return {
      total: this.repo.countBridgeMessages(),
      messages: rows.map((row) => this.toView(row)),
    };
  }

  getMessage(id: string): BridgeMessageView | null {
    const row = this.repo.getBridgeMessage(id);
    return row ? this.toView(row) : null;
  }

  private toView(row: {
    id: string;
    sequence_id: string | null;
    direction: string;
    message_type: string | null;
    source_tx_hash: string | null;
    source_block_number: number | null;
    source_address: string | null;
    destination_address: string | null;
    target_address: string | null;
    payload_length: number | null;
    state: string;
    execution_tx_hash: string | null;
    execution_block_number: number | null;
    callback_tx_hash: string | null;
    error_message: string | null;
    source_observed_at: string | null;
    execution_observed_at: string | null;
    latency_seconds: number | null;
    observed_at: string;
    updated_at: string;
  }): BridgeMessageView {
    return {
      id: row.id,
      nonce: row.sequence_id ?? row.id,
      direction: row.direction,
      messageType: row.message_type,
      sourceTxHash: row.source_tx_hash,
      sourceBlockNumber: row.source_block_number,
      sourceAddress: row.source_address,
      destinationAddress: row.destination_address,
      targetAddress: row.target_address,
      payloadLength: row.payload_length,
      state: row.state,
      executionTxHash: row.execution_tx_hash,
      executionBlockNumber: row.execution_block_number,
      callbackTxHash: row.callback_tx_hash,
      errorMessage: row.error_message,
      sourceObservedAt: row.source_observed_at,
      executionObservedAt: row.execution_observed_at,
      latencySeconds: row.latency_seconds,
      observedAt: row.observed_at,
      updatedAt: row.updated_at,
    };
  }

  /** Bridge configuration health, used by /api/capabilities. */
  getConfiguration(): {
    messageBridgeAddress: string;
    executionManagerAddress: string;
    messageBridgeVerified: boolean;
    executionManagerVerified: boolean;
    checks: ContractVerification[];
  } {
    const checks = this.repo.listContractChecks().map((row) => ({
      key: row.contract_key,
      address: row.address,
      hasBytecode: row.has_bytecode === 1,
      bytecodeLength: row.bytecode_length,
      error: row.error,
      verifiedAt: row.verified_at,
    }));

    return {
      messageBridgeAddress: MESSAGE_BRIDGE_ADDRESS,
      executionManagerAddress: EXECUTION_MANAGER_ADDRESS,
      messageBridgeVerified: checks.some((c) => c.key === 'message_bridge' && c.hasBytecode),
      executionManagerVerified: checks.some((c) => c.key === 'execution_manager' && c.hasBytecode),
      checks,
    };
  }
}
