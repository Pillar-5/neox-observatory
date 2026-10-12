/**
 * Response shapes returned by the NeoX Observatory REST API.
 *
 * These types mirror the API contract. Values that originate from the chain are
 * strings or numbers decoded from hex, and optional fields are null when the
 * connected endpoint could not supply them.
 */

export interface ContractHealth {
  key: string;
  address: string;
  hasBytecode: boolean;
  bytecodeLength: number | null;
  verifiedAt: string;
  error: string | null;
}

export interface NetworkStatus {
  configuredNetwork: string;
  chainId: number;
  chainIdHex: string;
  expectedChainId: number;
  chainIdMatches: boolean;
  rpcUrl: string;
  rpcHealthy: boolean;
  rpcError: string | null;
  latestBlockNumber: number | null;
  latestBlockTimestamp: number | null;
  gasPrice: string | null;
  gasPriceGwei: string | null;
  lastObservation: {
    blockNumber: number;
    envelopeFee: string | null;
    maxEnvelopeGasLimit: string | null;
    antimevCapability: string;
    observedAt: string;
  } | null;
  antiMevCapability: string | null;
  contracts: ContractHealth[];
  collectedAt: string;
}

export type MethodStatus = 'supported' | 'unsupported' | 'error' | 'unknown';

export interface AntiMevMethodReport {
  method: string;
  status: MethodStatus;
  rawValue: string | null;
  normalizedValue: string | null;
  error: string | null;
  checkedAt: string;
}

export interface AntiMevPolicy {
  blockNumber: number;
  chainId: number;
  observedAt: string;
  capability: string;
  envelopeFee: AntiMevMethodReport;
  maxEnvelopeGasLimit: AntiMevMethodReport;
  cachedTransaction: AntiMevMethodReport;
  gasPrice: string | null;
}

export interface AntiMevPolicyHistoryEntry {
  id: number;
  blockNumber: number;
  chainId: number;
  gasPrice: string | null;
  envelopeFee: string | null;
  maxEnvelopeGasLimit: string | null;
  capability: string;
  envelopeFeeSupported: boolean;
  maxGasLimitSupported: boolean;
  observedAt: string;
}

export interface EnvelopeFields {
  prefix: string;
  dkgEpoch: number;
  dkgEpochHex: string;
  innerGasLimit: number;
  innerGasLimitHex: string;
  innerTransactionHash: string;
  ciphertextLength: number;
  ciphertextHex: string;
  payloadLengthBytes: number;
  hasEmptyCiphertext: boolean;
}

export interface BlockSummary {
  number: number;
  hash: string;
  parentHash: string | null;
  timestamp: number;
  transactionCount: number;
  gasUsed: string | null;
  gasLimit: string | null;
  baseFeePerGas: string | null;
  observedAt: string;
  explorerUrl: string | null;
}

export interface BlocksResponse {
  total: number;
  limit: number;
  offset: number;
  network?: string;
  blocks: BlockSummary[];
}

/** Response of GET /api/blocks/:number. */
export interface BlockDetail {
  network: string;
  block: BlockSummary;
  transactions: TransactionSummary[];
}

export interface EnvelopeMetadata {
  dkgEpoch: number | null;
  innerGasLimit: number | null;
  innerTransactionHash: string | null;
  ciphertextLength: number | null;
}

export interface TransactionSummary {
  hash: string;
  blockNumber: number | null;
  transactionIndex: number | null;
  from: string | null;
  to: string | null;
  fromExplorerUrl?: string | null;
  toExplorerUrl?: string | null;
  value: string | null;
  nonce: number | null;
  gasLimit: string | null;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  type: number | null;
  status: number | null;
  /** Present when the transaction was served from the local index. */
  gasUsed?: string | null;
  /** Present when the transaction was served from the local index. */
  effectiveGasPrice?: string | null;
  input: string | null;
  /** True when the recipient is GovReward and the calldata decodes as an envelope. */
  isEnvelope: boolean;
  envelope: EnvelopeMetadata | null;
  explorerUrl: string | null;
  /** Present when the transaction was served from the local index. */
  observedAt?: string;
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
  /** Explorer link for the source transaction, when one exists. */
  sourceExplorerUrl: string | null;
  /** Explorer link for the destination execution transaction, when observed. */
  executionExplorerUrl: string | null;
}

export interface BridgeContractConfiguration {
  messageBridgeAddress: string;
  messageBridgeVerified: boolean;
  executionManagerAddress: string;
  executionManagerVerified: boolean;
}

export interface BridgeMessagesResponse {
  total: number;
  limit: number;
  offset: number;
  network?: string;
  configuration?: BridgeContractConfiguration;
  messages: BridgeMessageView[];
}

export interface Capabilities {
  configuredNetwork: string;
  chainId: number | null;
  chainIdMatches: boolean | null;
  rpcUrl: string;
  antiMev: {
    envelopeFee: MethodStatus;
    maxEnvelopeGasLimit: MethodStatus;
    cachedTransaction: MethodStatus;
    overall: string;
  };
  bridge: {
    messageBridgeAddress: string;
    executionManagerAddress: string;
    messageBridgeVerified: boolean;
    executionManagerVerified: boolean;
    checks: ContractHealth[];
  };
  accountAbstraction: AccountAbstractionStatus;
  checkedAt: string;
}

export interface AccountAbstractionStatus {
  configured: boolean;
  govPaymasterAddress: string;
  entryPointAddress: string;
  entryPointVersion: string;
  govPaymasterHasBytecode: boolean;
  entryPointHasBytecode: boolean;
  verifiedAt: string | null;
  verificationError: string | null;
  sponsorshipIndexing: 'enabled' | 'not_configured';
  sponsorshipIndexingReason: string | null;
  indexedEvents: number;
  successes: number;
  failures: number;
  latestIndexedBlock: number | null;
  sourceNote: string;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  configuredNetwork: string;
  chainId: number | null;
  chainIdMatches: boolean | null;
  rpcHealthy: boolean;
  indexedBlocks: number;
  indexedTransactions: number;
  bridgeMessages: number;
  latestIndexedBlock: number | null;
  checkpoints: Array<{ stream: string; lastBlock: number; updatedAt: string }>;
  observedAt: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type EnvelopeDecodeResult =
  | { ok: true; data: EnvelopeFields }
  | { ok: false; error: string; message: string };

export interface NormalizedLog {
  address: string;
  topics: string[];
  data: string;
  index: number;
  blockNumber: number;
  transactionHash: string;
  transactionIndex: number;
  blockHash: string;
}
