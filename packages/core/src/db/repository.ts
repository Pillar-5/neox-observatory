import type BetterSqlite3 from 'better-sqlite3';
import type { CheckpointStream } from './schema.js';

/** A stored block row. Numeric fee and gas values stay as decimal strings. */
export interface BlockRow {
  number: number;
  hash: string;
  parent_hash: string | null;
  timestamp: number;
  transaction_count: number;
  gas_used: string | null;
  gas_limit: string | null;
  base_fee_per_gas: string | null;
  observed_at: string;
}

export interface TransactionRow {
  hash: string;
  block_number: number;
  transaction_index: number;
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
  is_envelope: 0 | 1;
  envelope_dkg_epoch: number | null;
  envelope_inner_gas_limit: number | null;
  envelope_inner_hash: string | null;
  envelope_ciphertext_length: number | null;
  observed_at: string;
}

export interface NetworkObservationRow {
  id: number;
  block_number: number;
  chain_id: number;
  gas_price: string | null;
  envelope_fee: string | null;
  max_envelope_gas_limit: string | null;
  antimev_capability: string;
  envelope_fee_supported: number;
  max_gas_limit_supported: number;
  cached_tx_supported: number;
  message_bridge_verified: number;
  execution_manager_verified: number;
  observed_at: string;
}

export interface BridgeMessageRow {
  id: string;
  sequence_id: string | null;
  direction: string;
  message_type: string | null;
  source_tx_hash: string | null;
  source_block_number: number | null;
  source_contract: string | null;
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
  raw_event_json: string | null;
  observed_at: string;
  updated_at: string;
}

export interface ContractCheckRow {
  contract_key: string;
  address: string;
  has_bytecode: number;
  bytecode_length: number | null;
  verified_at: string;
  error: string | null;
}

export interface AaEventRow {
  id: number;
  event_name: string;
  block_number: number;
  tx_hash: string;
  log_index: number;
  paymaster: string | null;
  sender: string | null;
  user_op_hash: string | null;
  success: number | null;
  actual_gas_cost: string | null;
  raw_event_json: string | null;
  observed_at: string;
}

export interface InsertBlockParams {
  number: number;
  hash: string;
  parent_hash?: string | null;
  timestamp: number;
  transaction_count: number;
  gas_used?: string | null;
  gas_limit?: string | null;
  base_fee_per_gas?: string | null;
  observed_at?: string;
}

/** Parameters for storing one indexed transaction. */
export interface InsertTransactionParams {
  hash: string;
  block_number: number;
  transaction_index: number;
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
  is_envelope?: 0 | 1;
  envelope_dkg_epoch: number | null;
  envelope_inner_gas_limit: number | null;
  envelope_inner_hash: string | null;
  envelope_ciphertext_length: number | null;
  observed_at?: string;
}

/** Parameters for storing an Anti-MEV policy observation. */
export interface InsertObservationParams {
  block_number: number;
  chain_id: number;
  gas_price: string | null;
  envelope_fee: string | null;
  max_envelope_gas_limit: string | null;
  antimev_capability: string;
  envelope_fee_supported: boolean;
  max_gas_limit_supported: boolean;
  cached_tx_supported: boolean;
  message_bridge_verified: boolean;
  execution_manager_verified: boolean;
  observed_at?: string;
}

/** Parameters for storing or updating one bridge message. */
export interface UpsertBridgeMessageParams {
  id: string;
  sequence_id: string | null;
  direction: string;
  message_type: string | null;
  source_tx_hash: string | null;
  source_block_number: number | null;
  source_contract: string | null;
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
  raw_event_json: string | null;
  observed_at?: string;
}

/** Parameters for recording a contract bytecode verification. */
export interface UpsertContractCheckParams {
  contract_key: string;
  address: string;
  has_bytecode: boolean;
  bytecode_length: number | null;
  error: string | null;
  verified_at?: string;
}

/**
 * All SQLite reads and writes.
 *
 * Every statement is prepared once in the constructor. Writes that belong
 * together run inside a transaction so an interrupted batch cannot leave a block
 * row without its transactions, or a checkpoint pointing past data that never
 * landed.
 */
export class Repository {
  private readonly stmts: Record<string, BetterSqlite3.Statement>;

  constructor(private readonly db: BetterSqlite3.Database) {
    this.stmts = {
      insertBlock: db.prepare(`INSERT INTO blocks
        (number, hash, parent_hash, timestamp, transaction_count, gas_used, gas_limit, base_fee_per_gas, observed_at)
        VALUES (@number, @hash, @parent_hash, @timestamp, @transaction_count, @gas_used, @gas_limit, @base_fee_per_gas, @observed_at)
        ON CONFLICT(number) DO UPDATE SET
          hash = excluded.hash,
          parent_hash = excluded.parent_hash,
          timestamp = excluded.timestamp,
          transaction_count = excluded.transaction_count,
          gas_used = excluded.gas_used,
          gas_limit = excluded.gas_limit,
          base_fee_per_gas = excluded.base_fee_per_gas`),

      insertTransaction: db.prepare(`INSERT INTO transactions
        (hash, block_number, transaction_index, from_address, to_address, value, nonce,
         gas_limit, gas_price, max_fee_per_gas, max_priority_fee_per_gas, status, gas_used,
         effective_gas_price, type, input, is_envelope, envelope_dkg_epoch,
         envelope_inner_gas_limit, envelope_inner_hash, envelope_ciphertext_length, observed_at)
        VALUES (@hash, @block_number, @transaction_index, @from_address, @to_address, @value, @nonce,
         @gas_limit, @gas_price, @max_fee_per_gas, @max_priority_fee_per_gas, @status, @gas_used,
         @effective_gas_price, @type, @input, @is_envelope, @envelope_dkg_epoch,
         @envelope_inner_gas_limit, @envelope_inner_hash, @envelope_ciphertext_length, @observed_at)
        ON CONFLICT(hash) DO UPDATE SET
          block_number = excluded.block_number,
          transaction_index = excluded.transaction_index,
          status = excluded.status,
          gas_used = excluded.gas_used,
          effective_gas_price = excluded.effective_gas_price,
          is_envelope = excluded.is_envelope,
          envelope_dkg_epoch = excluded.envelope_dkg_epoch,
          envelope_inner_gas_limit = excluded.envelope_inner_gas_limit,
          envelope_inner_hash = excluded.envelope_inner_hash,
          envelope_ciphertext_length = excluded.envelope_ciphertext_length`),

      latestBlock: db.prepare('SELECT * FROM blocks ORDER BY number DESC LIMIT 1'),
      oldestBlock: db.prepare('SELECT * FROM blocks ORDER BY number ASC LIMIT 1'),
      countBlocks: db.prepare('SELECT COUNT(*) AS count FROM blocks'),
      countTransactions: db.prepare('SELECT COUNT(*) AS count FROM transactions'),
      getBlock: db.prepare('SELECT * FROM blocks WHERE number = ?'),
      listBlocks: db.prepare('SELECT * FROM blocks ORDER BY number DESC LIMIT ? OFFSET ?'),
      getTransaction: db.prepare('SELECT * FROM transactions WHERE hash = ?'),
      listTransactionsByBlock: db.prepare(
        'SELECT * FROM transactions WHERE block_number = ? ORDER BY transaction_index ASC',
      ),

      insertObservation: db.prepare(`INSERT INTO network_observations
        (block_number, chain_id, gas_price, envelope_fee, max_envelope_gas_limit, antimev_capability,
         envelope_fee_supported, max_gas_limit_supported, cached_tx_supported,
         message_bridge_verified, execution_manager_verified, observed_at)
        VALUES (@block_number, @chain_id, @gas_price, @envelope_fee, @max_envelope_gas_limit,
         @antimev_capability, @envelope_fee_supported, @max_gas_limit_supported, @cached_tx_supported,
         @message_bridge_verified, @execution_manager_verified, @observed_at)`),
      latestObservation: db.prepare('SELECT * FROM network_observations ORDER BY id DESC LIMIT 1'),
      listObservations: db.prepare(
        'SELECT * FROM network_observations ORDER BY id DESC LIMIT ? OFFSET ?',
      ),

      upsertBridgeMessage: db.prepare(`INSERT INTO bridge_messages
        (id, sequence_id, direction, message_type, source_tx_hash, source_block_number,
         source_contract, source_address, destination_address, target_address, payload_length,
         state, execution_tx_hash, execution_block_number, callback_tx_hash, error_message,
         source_observed_at, execution_observed_at, latency_seconds, raw_event_json,
         observed_at, updated_at)
        VALUES (@id, @sequence_id, @direction, @message_type, @source_tx_hash, @source_block_number,
         @source_contract, @source_address, @destination_address, @target_address, @payload_length,
         @state, @execution_tx_hash, @execution_block_number, @callback_tx_hash, @error_message,
         @source_observed_at, @execution_observed_at, @latency_seconds, @raw_event_json,
         @observed_at, @updated_at)
        ON CONFLICT(id) DO UPDATE SET
          state = excluded.state,
          execution_tx_hash = COALESCE(excluded.execution_tx_hash, bridge_messages.execution_tx_hash),
          execution_block_number = COALESCE(excluded.execution_block_number, bridge_messages.execution_block_number),
          callback_tx_hash = COALESCE(excluded.callback_tx_hash, bridge_messages.callback_tx_hash),
          error_message = COALESCE(excluded.error_message, bridge_messages.error_message),
          execution_observed_at = COALESCE(excluded.execution_observed_at, bridge_messages.execution_observed_at),
          latency_seconds = excluded.latency_seconds,
          updated_at = excluded.updated_at`),
      getBridgeMessage: db.prepare('SELECT * FROM bridge_messages WHERE id = ?'),
      listBridgeMessages: db.prepare(
        'SELECT * FROM bridge_messages ORDER BY source_block_number DESC LIMIT ? OFFSET ?',
      ),
      countBridgeMessages: db.prepare('SELECT COUNT(*) AS count FROM bridge_messages'),

      getCheckpoint: db.prepare('SELECT * FROM checkpoints WHERE stream = ?'),
      upsertCheckpoint: db.prepare(`INSERT INTO checkpoints (stream, last_block, updated_at)
        VALUES (@stream, @last_block, @updated_at)
        ON CONFLICT(stream) DO UPDATE SET
          last_block = excluded.last_block,
          updated_at = excluded.updated_at`),
      listCheckpoints: db.prepare('SELECT * FROM checkpoints ORDER BY stream ASC'),

      insertAaEvent: db.prepare(`INSERT INTO aa_events
        (event_name, block_number, tx_hash, log_index, paymaster, sender, user_op_hash,
         success, actual_gas_cost, raw_event_json, observed_at)
        VALUES (@event_name, @block_number, @tx_hash, @log_index, @paymaster, @sender,
         @user_op_hash, @success, @actual_gas_cost, @raw_event_json, @observed_at)
        ON CONFLICT(tx_hash, log_index, event_name) DO NOTHING`),
      countAaEvents: db.prepare('SELECT COUNT(*) AS count FROM aa_events'),
      aaCounts: db.prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS succeeded,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
           MAX(block_number) AS latest_block
         FROM aa_events`,
      ),
      listAaEvents: db.prepare(
        'SELECT * FROM aa_events ORDER BY block_number DESC LIMIT ? OFFSET ?',
      ),

      upsertContractCheck: db.prepare(`INSERT INTO contract_checks
        (contract_key, address, has_bytecode, bytecode_length, verified_at, error)
        VALUES (@contract_key, @address, @has_bytecode, @bytecode_length, @verified_at, @error)
        ON CONFLICT(contract_key) DO UPDATE SET
          address = excluded.address,
          has_bytecode = excluded.has_bytecode,
          bytecode_length = excluded.bytecode_length,
          verified_at = excluded.verified_at,
          error = excluded.error`),
      listContractChecks: db.prepare('SELECT * FROM contract_checks ORDER BY contract_key ASC'),
      getContractCheck: db.prepare('SELECT * FROM contract_checks WHERE contract_key = ?'),
    };
  }

  upsertBridgeMessage(params: {
    id: string;
    sequence_id: string | null;
    direction: string;
    message_type: string | null;
    source_tx_hash: string | null;
    source_block_number: number | null;
    source_contract: string | null;
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
    raw_event_json: string | null;
  }): void {
    const now = new Date().toISOString();
    this.stmts.upsertBridgeMessage!.run({ ...params, observed_at: now, updated_at: now });
  }

  getBridgeMessage(id: string): BridgeMessageRow | undefined {
    return this.stmts.getBridgeMessage!.get(id) as BridgeMessageRow | undefined;
  }

  listBridgeMessages(limit: number, offset: number): BridgeMessageRow[] {
    return this.stmts.listBridgeMessages!.all(limit, offset) as BridgeMessageRow[];
  }

  countBridgeMessages(): number {
    return (this.stmts.countBridgeMessages!.get() as { count: number }).count;
  }

  getCheckpoint(
    stream: CheckpointStream,
  ): { stream: string; last_block: number; updated_at: string } | undefined {
    return this.stmts.getCheckpoint!.get(stream) as
      | { stream: string; last_block: number; updated_at: string }
      | undefined;
  }

  setCheckpoint(stream: CheckpointStream, lastBlock: number): void {
    this.stmts.upsertCheckpoint!.run({
      stream,
      last_block: lastBlock,
      updated_at: new Date().toISOString(),
    });
  }

  listCheckpoints(): Array<{ stream: string; last_block: number; updated_at: string }> {
    return this.stmts.listCheckpoints!.all() as Array<{
      stream: string;
      last_block: number;
      updated_at: string;
    }>;
  }

  insertAaEvent(params: {
    event_name: string;
    block_number: number;
    tx_hash: string;
    log_index: number;
    paymaster: string | null;
    sender: string | null;
    user_op_hash: string | null;
    success: boolean | null;
    actual_gas_cost: string | null;
    raw_event_json: string | null;
  }): void {
    this.stmts.insertAaEvent!.run({
      ...params,
      success: params.success === null ? null : params.success ? 1 : 0,
      observed_at: new Date().toISOString(),
    });
  }

  countAaEvents(): number {
    return (this.stmts.countAaEvents!.get() as { count: number }).count;
  }

  getAaCounts(): { total: number; succeeded: number; failed: number; latest_block: number | null } {
    const row = this.stmts.aaCounts!.get() as {
      total: number;
      succeeded: number | null;
      failed: number | null;
      latest_block: number | null;
    };
    return {
      total: row.total ?? 0,
      succeeded: row.succeeded ?? 0,
      failed: row.failed ?? 0,
      latest_block: row.latest_block ?? null,
    };
  }

  listAaEvents(limit: number, offset: number): AaEventRow[] {
    return this.stmts.listAaEvents!.all(limit, offset) as AaEventRow[];
  }

  upsertContractCheck(params: {
    contract_key: string;
    address: string;
    has_bytecode: boolean;
    bytecode_length: number | null;
    error?: string | null;
  }): void {
    this.stmts.upsertContractCheck!.run({
      ...params,
      has_bytecode: params.has_bytecode ? 1 : 0,
      error: params.error ?? null,
      verified_at: new Date().toISOString(),
    });
  }

  listContractChecks(): ContractCheckRow[] {
    return this.stmts.listContractChecks!.all() as ContractCheckRow[];
  }

  getContractCheck(key: string): ContractCheckRow | undefined {
    return this.stmts.getContractCheck!.get(key) as ContractCheckRow | undefined;
  }

  /** Indexing totals used by /api/health. */
  getStats(): {
    blocks: number;
    transactions: number;
    bridgeMessages: number;
    aaEvents: number;
    latestBlock: BlockRow | undefined;
    oldestBlock: BlockRow | undefined;
  } {
    return {
      blocks: this.countBlocks(),
      transactions: this.countTransactions(),
      bridgeMessages: this.countBridgeMessages(),
      aaEvents: this.countAaEvents(),
      latestBlock: this.getLatestBlock(),
      oldestBlock: this.getOldestBlock(),
    };
  }

  insertBlock(block: InsertBlockParams): void {
    this.stmts.insertBlock!.run({
      number: block.number,
      hash: block.hash,
      parent_hash: block.parent_hash ?? null,
      timestamp: block.timestamp,
      transaction_count: block.transaction_count,
      gas_used: block.gas_used ?? null,
      gas_limit: block.gas_limit ?? null,
      base_fee_per_gas: block.base_fee_per_gas ?? null,
      observed_at: new Date().toISOString(),
    });
  }

  insertTransaction(tx: InsertTransactionParams): void {
    this.stmts.insertTransaction!.run({
      hash: tx.hash,
      block_number: tx.block_number,
      transaction_index: tx.transaction_index,
      from_address: tx.from_address,
      to_address: tx.to_address,
      value: tx.value,
      nonce: tx.nonce,
      gas_limit: tx.gas_limit,
      gas_price: tx.gas_price,
      max_fee_per_gas: tx.max_fee_per_gas,
      max_priority_fee_per_gas: tx.max_priority_fee_per_gas,
      status: tx.status,
      gas_used: tx.gas_used,
      effective_gas_price: tx.effective_gas_price,
      type: tx.type,
      input: tx.input,
      is_envelope: tx.is_envelope ?? 0,
      envelope_dkg_epoch: tx.envelope_dkg_epoch,
      envelope_inner_gas_limit: tx.envelope_inner_gas_limit,
      envelope_inner_hash: tx.envelope_inner_hash,
      envelope_ciphertext_length: tx.envelope_ciphertext_length,
      observed_at: new Date().toISOString(),
    });
  }

  /**
   * Persist one block and its transactions atomically.
   *
   * A crash between the two inserts would otherwise leave a block row claiming a
   * transaction count with no matching transaction rows.
   */
  insertBlockWithTransactions(block: InsertBlockParams, txs: InsertTransactionParams[]): void {
    const write = this.db.transaction(() => {
      this.insertBlock(block);
      for (const tx of txs) this.insertTransaction(tx);
    });
    write();
  }

  getLatestBlock(): BlockRow | undefined {
    return this.stmts.latestBlock!.get() as BlockRow | undefined;
  }

  getOldestBlock(): BlockRow | undefined {
    return this.stmts.oldestBlock!.get() as BlockRow | undefined;
  }

  getBlock(number: number): BlockRow | undefined {
    return this.stmts.getBlock!.get(number) as BlockRow | undefined;
  }

  listBlocks(limit: number, offset: number): BlockRow[] {
    return this.stmts.listBlocks!.all(limit, offset) as BlockRow[];
  }

  countBlocks(): number {
    return (this.stmts.countBlocks!.get() as { count: number }).count;
  }

  countTransactions(): number {
    return (this.stmts.countTransactions!.get() as { count: number }).count;
  }

  getTransaction(hash: string): TransactionRow | undefined {
    return this.stmts.getTransaction!.get(hash.toLowerCase()) as TransactionRow | undefined;
  }

  listTransactionsByBlock(blockNumber: number): TransactionRow[] {
    return this.stmts.listTransactionsByBlock!.all(blockNumber) as TransactionRow[];
  }

  insertObservation(params: {
    block_number: number;
    chain_id: number;
    gas_price: string | null;
    envelope_fee: string | null;
    max_envelope_gas_limit: string | null;
    antimev_capability: string;
    envelope_fee_supported: boolean;
    max_gas_limit_supported: boolean;
    cached_tx_supported: boolean;
    message_bridge_verified: boolean;
    execution_manager_verified: boolean;
  }): void {
    this.stmts.insertObservation!.run({
      ...params,
      envelope_fee_supported: params.envelope_fee_supported ? 1 : 0,
      max_gas_limit_supported: params.max_gas_limit_supported ? 1 : 0,
      cached_tx_supported: params.cached_tx_supported ? 1 : 0,
      message_bridge_verified: params.message_bridge_verified ? 1 : 0,
      execution_manager_verified: params.execution_manager_verified ? 1 : 0,
      observed_at: new Date().toISOString(),
    });
  }

  getLatestObservation(): NetworkObservationRow | undefined {
    return this.stmts.latestObservation!.get() as NetworkObservationRow | undefined;
  }

  listObservations(limit: number, offset: number): NetworkObservationRow[] {
    return this.stmts.listObservations!.all(limit, offset) as NetworkObservationRow[];
  }
}

