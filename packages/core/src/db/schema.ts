import type Database from 'better-sqlite3';

/**
 * Deterministic SQLite schema.
 *
 * The statements are idempotent so `db:init` can run on every start without a
 * separate migration tool, and a fresh database is always built the same way.
 * Every table carries `observed_at`, which records when this application saw the
 * row rather than when the chain produced it.
 */

export const SCHEMA_VERSION = 1;

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS blocks (
    number INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    parent_hash TEXT,
    timestamp INTEGER NOT NULL,
    transaction_count INTEGER NOT NULL DEFAULT 0,
    gas_used TEXT,
    gas_limit TEXT,
    base_fee_per_gas TEXT,
    observed_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks (timestamp DESC)`,

  /**
   * One row per Anti-MEV policy observation. The RPC columns store the raw
   * string the endpoint returned, or NULL when the method is unsupported, so a
   * missing method never looks like a zero value.
   */
  `CREATE TABLE IF NOT EXISTS network_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_number INTEGER NOT NULL,
    chain_id INTEGER NOT NULL,
    gas_price TEXT,
    envelope_fee TEXT,
    max_envelope_gas_limit TEXT,
    antimev_capability TEXT NOT NULL,
    envelope_fee_supported INTEGER NOT NULL DEFAULT 0,
    max_gas_limit_supported INTEGER NOT NULL DEFAULT 0,
    cached_tx_supported INTEGER NOT NULL DEFAULT 0,
    message_bridge_verified INTEGER NOT NULL DEFAULT 0,
    execution_manager_verified INTEGER NOT NULL DEFAULT 0,
    observed_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_network_observations_time ON network_observations (observed_at DESC)`,

  `CREATE TABLE IF NOT EXISTS transactions (
    hash TEXT PRIMARY KEY,
    block_number INTEGER NOT NULL,
    transaction_index INTEGER NOT NULL,
    from_address TEXT,
    to_address TEXT,
    value TEXT,
    nonce INTEGER,
    gas_limit TEXT,
    gas_price TEXT,
    max_fee_per_gas TEXT,
    max_priority_fee_per_gas TEXT,
    status INTEGER,
    gas_used TEXT,
    effective_gas_price TEXT,
    type INTEGER,
    input TEXT,
    is_envelope INTEGER NOT NULL DEFAULT 0,
    envelope_dkg_epoch INTEGER,
    envelope_inner_gas_limit INTEGER,
    envelope_inner_hash TEXT,
    envelope_ciphertext_length INTEGER,
    observed_at TEXT NOT NULL,
    FOREIGN KEY (block_number) REFERENCES blocks (number)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_transactions_block ON transactions (block_number DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions (from_address)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_to ON transactions (to_address)`,

  /**
   * Bridge messages, keyed by the Neo X sequence identifier that MessageBridge
   * emits. Columns map onto the fields present in the official ABI only, so
   * nothing here is inferred from an unrelated bridge implementation.
   */
  `CREATE TABLE IF NOT EXISTS bridge_messages (
    id TEXT PRIMARY KEY,
    sequence_id TEXT,
    direction TEXT NOT NULL,
    message_type TEXT,
    source_tx_hash TEXT,
    source_block_number INTEGER,
    source_contract TEXT,
    source_address TEXT,
    destination_address TEXT,
    target_address TEXT,
    payload_length INTEGER,
    state TEXT NOT NULL,
    execution_tx_hash TEXT,
    execution_block_number INTEGER,
    callback_tx_hash TEXT,
    error_message TEXT,
    source_observed_at TEXT,
    execution_observed_at TEXT,
    latency_seconds INTEGER,
    raw_event_json TEXT,
    observed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_bridge_messages_source_block ON bridge_messages (source_block_number DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_bridge_messages_state ON bridge_messages (state)`,
  `CREATE INDEX IF NOT EXISTS idx_bridge_messages_source_tx ON bridge_messages (source_tx_hash)`,

  /**
   * Last successfully indexed block per indexing stream. Each stream keeps its
   * own checkpoint so a bridge scan can lag behind block indexing without
   * forcing a full re-scan of history on restart.
   */
  `CREATE TABLE IF NOT EXISTS checkpoints (
    stream TEXT PRIMARY KEY,
    last_block INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  /**
   * Account abstraction sponsorship events. Rows are only written once the
   * GovPaymaster and EntryPoint configuration has been verified, so an empty
   * table here is an honest signal rather than a gap.
   */
  `CREATE TABLE IF NOT EXISTS aa_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name TEXT NOT NULL,
    block_number INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    paymaster TEXT,
    sender TEXT,
    user_op_hash TEXT,
    success INTEGER,
    actual_gas_cost TEXT,
    raw_event_json TEXT,
    observed_at TEXT NOT NULL,
    UNIQUE (tx_hash, log_index, event_name)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_aa_events_block ON aa_events (block_number DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_aa_events_success ON aa_events (success)`,

  /**
   * Startup contract verification results, one row per checked contract. Kept
   * in the database so the UI can show the last verified state without having
   * to replay the startup check.
   */
  `CREATE TABLE IF NOT EXISTS contract_checks (
    contract_key TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    has_bytecode INTEGER NOT NULL,
    bytecode_length INTEGER,
    verified_at TEXT NOT NULL,
    error TEXT
  )`,
];

/** Create every table if it is missing. Safe to call repeatedly. */
export function initializeSchema(db: Database.Database): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  for (const statement of statements) {
    db.exec(statement);
  }
  const insert = db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );
  insert.run(SCHEMA_VERSION, new Date().toISOString());
}

export const CHECKPOINT_STREAMS = {
  blocks: 'blocks',
  bridge: 'bridge',
  antiMev: 'antimev',
} as const;

export type CheckpointStream = (typeof CHECKPOINT_STREAMS)[keyof typeof CHECKPOINT_STREAMS];
