import { formatEther, formatUnits } from 'ethers';
import { decodeEnvelope } from './envelope/decode.js';
import { SYSTEM_CONTRACTS } from './constants.js';

/**
 * Normalization helpers that turn raw ethers objects into plain JSON shapes.
 *
 * BigInt values are converted to decimal strings because JSON.stringify throws
 * on BigInt and silently loses precision if a Number is used instead. Anything
 * that reaches the API surface is a string, a number, a boolean or null.
 */

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

export interface NormalizedReceipt {
  status: number | null;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  logs: NormalizedLog[];
}

export interface NormalizedBlockSummary {
  number: number;
  hash: string;
  parentHash: string | null;
  timestamp: number;
  transactionCount: number;
  gasUsed: string | null;
  gasLimit: string | null;
  baseFeePerGas: string | null;
  observedAt: string;
}

/** Convert a wei amount to a GAS decimal string. */
export function weiToGas(wei: string | bigint | null | undefined): string | null {
  if (wei === null || wei === undefined) return null;
  try {
    return formatEther(wei);
  } catch {
    return null;
  }
}

/** Convert a wei-per-gas price to a gwei decimal string. */
export function weiPerGasToGwei(wei: string | bigint | null | undefined): string | null {
  if (wei === null || wei === undefined) return null;
  try {
    return formatUnits(wei, 9);
  } catch {
    return null;
  }
}

/** Format a token amount using an explicit decimal count. */
export function formatTokenAmount(value: string | bigint, decimals: number): string {
  try {
    return formatUnits(value, decimals);
  } catch {
    return '0';
  }
}

/**
 * Convert an ethers receipt into a plain object.
 *
 * `status` is kept as the raw 0 or 1 the chain reports, and is null when the
 * receipt is missing so the UI can say the outcome is unobserved rather than
 * presenting a failure that was never recorded.
 */
export function normalizeReceipt(receipt: {
  status?: number | null;
  gasUsed?: bigint | null;
  /**
   * ethers v6 calls the effective gas price `gasPrice` on receipts. The legacy
   * `effectiveGasPrice` name is accepted too so fixtures written against the
   * JSON-RPC field name normalize the same way.
   */
  gasPrice?: bigint | null;
  effectiveGasPrice?: bigint | null;
  logs?: ReadonlyArray<{
    address: string;
    topics: readonly string[];
    data: string;
    index: number;
    blockNumber: number;
    transactionHash: string;
    transactionIndex: number;
    blockHash: string;
  }>;
} | null | undefined): NormalizedReceipt {
  if (!receipt) {
    return { status: null, gasUsed: null, effectiveGasPrice: null, logs: [] };
  }
  const effectiveGasPrice = receipt.gasPrice ?? receipt.effectiveGasPrice ?? null;
  return {
    status: receipt.status ?? null,
    gasUsed:
      receipt.gasUsed !== null && receipt.gasUsed !== undefined ? receipt.gasUsed.toString() : null,
    effectiveGasPrice: effectiveGasPrice !== null ? effectiveGasPrice.toString() : null,
    logs: (receipt.logs ?? []).map((log) => ({
      address: log.address,
      topics: [...log.topics],
      data: log.data,
      index: log.index,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      transactionIndex: log.transactionIndex,
      blockHash: log.blockHash,
    })),
  };
}

/**
 * Convert a JSON-RPC quantity such as `"0x1a"` into a JS number.
 *
 * `provider.send` returns raw JSON-RPC values, so quantities arrive as hex
 * strings even though they are typed as numbers. Absent values become null,
 * and a quantity outside the safe integer range throws rather than silently
 * truncating, because a wrong block number or nonce is worse than an error.
 */
export function hexToNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(parsed)) return null;
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Quantity ${String(value)} exceeds the safe integer range`);
  }
  return parsed;
}

/**
 * Normalize a raw JSON-RPC quantity to a decimal string.
 *
 * Wei-valued fields such as `value` and `gasPrice` are kept as strings because
 * converting them to a Number would lose precision. Hex input is converted to
 * decimal so the indexed and live paths report the same format.
 */
export function hexToDecimalStringOrNull(
  value: string | number | bigint | null | undefined,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && value.startsWith('0x')) {
    try {
      return BigInt(value).toString(10);
    } catch {
      return null;
    }
  }
  return String(value);
}

/** Convert an ethers block into the summary shape the API and database use. */
export function normalizeBlock(block: {
  number: number;
  hash: string | null;
  parentHash: string;
  timestamp: number;
  transactions: readonly unknown[];
  gasUsed?: bigint;
  gasLimit?: bigint;
  baseFeePerGas?: bigint | null;
}): NormalizedBlockSummary {
  return {
    number: block.number,
    hash: block.hash ?? '',
    parentHash: block.parentHash,
    timestamp: block.timestamp,
    transactionCount: block.transactions.length,
    gasUsed: block.gasUsed !== undefined && block.gasUsed !== null ? block.gasUsed.toString() : null,
    gasLimit:
      block.gasLimit !== undefined && block.gasLimit !== null ? block.gasLimit.toString() : null,
    baseFeePerGas:
      block.baseFeePerGas !== null && block.baseFeePerGas !== undefined
        ? block.baseFeePerGas.toString()
        : null,
    observedAt: new Date().toISOString(),
  };
}

/**
 * Decide whether a transaction looks like an Envelope Transaction.
 *
 * The check is deliberately narrow. A real Envelope Transaction is sent to the
 * GovReward system contract and carries calldata with the 0xffffffff prefix. A
 * transaction that only happens to have the right calldata prefix but targets an
 * ordinary contract is not claimed to be an envelope, because the calldata
 * layout is not by itself proof of Anti-MEV intent.
 */
export function detectEnvelope(
  to: string | null | undefined,
  input: string | null | undefined,
): { isEnvelope: boolean; decoded: ReturnType<typeof decodeEnvelope> | null } {
  if (!to || !input) return { isEnvelope: false, decoded: null };
  if (to.toLowerCase() !== SYSTEM_CONTRACTS.govReward.toLowerCase()) {
    return { isEnvelope: false, decoded: null };
  }
  if (input === '0x' || input.length < 2) return { isEnvelope: false, decoded: null };

  const decoded = decodeEnvelope(input);
  if (!decoded.ok) return { isEnvelope: false, decoded };
  return { isEnvelope: true, decoded };
}
