/**
 * Central Neo X protocol constants.
 *
 * Every value here is recorded in docs/sources.md with its source URL and the
 * date it was checked. Do not add constants that are not traceable to an
 * official Neo X or Bane Labs source.
 */

export type NetworkName = 'mainnet' | 'testnet';

export interface NetworkDefinition {
  name: NetworkName;
  /** Chain ID in decimal form. */
  chainId: number;
  /** Chain ID in hex form, as returned by eth_chainId. */
  chainIdHex: string;
  /** Public JSON-RPC endpoints, in preference order. */
  rpcUrls: string[];
  /** Endpoints that are documented to support the Anti-MEV cache RPC methods. */
  antiMevRpcUrls: string[];
  /** Verified block explorer base URLs, without a trailing slash. */
  explorerUrls: string[];
  /** Native currency symbol. */
  currencySymbol: string;
  /** Average seconds per block, used only for display estimates. */
  blockTimeSeconds: number;
}

/**
 * Neo X system contracts that are allocated at genesis rather than deployed by
 * a transaction. Verified with eth_getCode on 2025-10-08.
 */
export const SYSTEM_CONTRACTS = {
  govProxyAdmin: '0x1212000000000000000000000000000000000000',
  governance: '0x1212000000000000000000000000000000000001',
  policy: '0x1212000000000000000000000000000000000002',
  govReward: '0x1212000000000000000000000000000000000003',
  tokenBridge: '0x1212000000000000000000000000000000000004',
  bridgeManagement: '0x1212000000000000000000000000000000000005',
  messageBridge: '0x1212000000000000000000000000000000000009',
  govPaymaster: '0x121200000000000000000000000000000000000a',
} as const;

/**
 * ExecutionManager is deployed by a transaction, so unlike the system
 * contracts above its address is not a genesis allocation.
 */
export const EXECUTION_MANAGER_ADDRESS = '0x85776439bbE26A3B6F91baB0fb8Ef3fDc769f385';

/**
 * ERC-4337 EntryPoint v0.9, the single version that GovPaymaster accepts.
 * Source: Neo X account abstraction documentation.
 */
export const ENTRYPOINT_V0_9_ADDRESS = '0x433709009B8330FDa32311DF1C2AFA402eD8D009';

/**
 * 4-byte prefix that opens a Neo X Envelope Transaction payload.
 * The documented layout is:
 *   0xffffffff | 4-byte DKG epoch | 4-byte inner gas limit
 *   | 32-byte inner transaction hash | TPKE ciphertext
 */
export const ENVELOPE_PREFIX_HEX = '0xffffffff';
export const ENVELOPE_PREFIX_BYTES = 4;
export const ENVELOPE_EPOCH_BYTES = 4;
export const ENVELOPE_GAS_LIMIT_BYTES = 4;
export const ENVELOPE_INNER_HASH_BYTES = 32;
export const ENVELOPE_MIN_LENGTH_BYTES =
  ENVELOPE_PREFIX_BYTES +
  ENVELOPE_EPOCH_BYTES +
  ENVELOPE_GAS_LIMIT_BYTES +
  ENVELOPE_INNER_HASH_BYTES;

/** Neo X-specific JSON-RPC methods this project probes for. */
export const NEOX_RPC_METHODS = {
  envelopeFee: 'eth_envelopeFee',
  maxEnvelopeGasLimit: 'eth_maxEnvelopeGasLimit',
  cachedTransaction: 'eth_getCachedTransaction',
} as const;

export const NETWORKS: Record<NetworkName, NetworkDefinition> = {
  mainnet: {
    name: 'mainnet',
    chainId: 47763,
    chainIdHex: '0xba93',
    rpcUrls: [
      'https://mainnet-1.rpc.banelabs.org',
      'https://mainnet-2.rpc.banelabs.org',
      'https://mainnet-3.rpc.banelabs.org',
    ],
    antiMevRpcUrls: ['https://mainnet-5.rpc.banelabs.org'],
    explorerUrls: ['https://xexplorer.neo.org', 'https://neoxscan.ngd.network'],
    currencySymbol: 'GAS',
    blockTimeSeconds: 1,
  },
  testnet: {
    name: 'testnet',
    chainId: 12227332,
    chainIdHex: '0xba9304',
    rpcUrls: [
      'https://neoxt4seed1.ngd.network',
      'https://neoxt4seed2.ngd.network',
      'https://neoxt4seed3.ngd.network',
    ],
    antiMevRpcUrls: ['https://neoxt4seed5.ngd.network'],
    explorerUrls: ['https://xt4scan.ngd.network', 'https://neoxt4scan.ngd.network'],
    currencySymbol: 'GAS',
    blockTimeSeconds: 1,
  },
};

export function getNetworkDefinition(name: NetworkName): NetworkDefinition {
  const network = NETWORKS[name];
  if (!network) {
    throw new Error(`Unknown Neo X network: ${String(name)}`);
  }
  return network;
}

/** Convert a decimal chain ID to the hex form eth_chainId returns. */
export function chainIdToHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

/** Parse a hex chain ID such as "0xba93" into a number. */
export function hexToChainId(hex: string): number {
  return Number.parseInt(hex, 16);
}

/**
 * Build an explorer transaction link. Returns null when the network has no
 * verified explorer URL so callers can omit the link instead of guessing.
 */
export function explorerTxUrl(network: NetworkName, txHash: string): string | null {
  const explorer = getNetworkDefinition(network).explorerUrls[0];
  if (!explorer) return null;
  return `${explorer}/transaction/${txHash}`;
}

/** Build an explorer block link, or null when no verified explorer exists. */
export function explorerBlockUrl(network: NetworkName, blockNumber: number): string | null {
  const explorer = getNetworkDefinition(network).explorerUrls[0];
  if (!explorer) return null;
  return `${explorer}/block/${blockNumber}`;
}

/** Build an explorer address link, or null when no verified explorer exists. */
export function explorerAddressUrl(network: NetworkName, address: string): string | null {
  const explorer = getNetworkDefinition(network).explorerUrls[0];
  if (!explorer) return null;
  return `${explorer}/address/${address}`;
}
