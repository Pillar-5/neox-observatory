import type { Logger } from 'pino';
import { NEOX_RPC_METHODS } from '../constants.js';
import type { Repository } from '../db/repository.js';
import { RpcClient, RpcError } from '../rpc/client.js';

/**
 * Neo X Anti-MEV policy reads.
 *
 * The two policy methods, eth_envelopeFee and eth_maxEnvelopeGasLimit, are
 * probed through the capability layer. When an endpoint does not implement a
 * method it answers -32601 and the result is recorded as unsupported. There is
 * no default or estimated value substituted, so the UI reports a gap as a gap.
 *
 * eth_getCachedTransaction is deliberately not part of this service. It needs a
 * node configured for the Anti-MEV cache plus sender-signature parameters, and
 * the public endpoints used by this tool do not expose it. It is probed only for
 * the capability report.
 */

export type MethodStatus = 'supported' | 'unsupported' | 'error' | 'unknown';

export interface AntiMevMethodReport {
  method: string;
  status: MethodStatus;
  /** Raw value exactly as the endpoint returned it. */
  rawValue: string | null;
  /** Decimal rendering of the raw value, when it parses as a hex integer. */
  normalizedValue: string | null;
  error: string | null;
  checkedAt: string;
}

export interface AntiMevPolicy {
  blockNumber: number;
  chainId: number;
  observedAt: string;
  /** True when at least one of the two policy methods is supported. */
  capability: string;
  envelopeFee: AntiMevMethodReport;
  maxEnvelopeGasLimit: AntiMevMethodReport;
  /** Capability status of the advanced cache method, for information only. */
  cachedTransaction: AntiMevMethodReport;
  gasPrice: string | null;
}

/** Parse a 0x hex quantity into a decimal string, or null when it is not one. */
function hexQuantityToDecimal(value: unknown): string | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try {
    return BigInt(value).toString();
  } catch {
    return null;
  }
}

function report(
  method: string,
  capability: { status: MethodStatus; value?: unknown; error?: string; checkedAt: string },
): AntiMevMethodReport {
  const rawValue =
    typeof capability.value === 'string'
      ? capability.value
      : capability.value !== undefined && capability.value !== null
        ? String(capability.value)
        : null;
  return {
    method,
    status: capability.status,
    rawValue,
    normalizedValue: hexQuantityToDecimal(capability.value),
    error: capability.error ?? null,
    checkedAt: capability.checkedAt,
  };
}

export class AntiMevService {
  constructor(
    private readonly rpc: RpcClient,
    private readonly repo: Repository,
    private readonly logger: Logger,
  ) {}

  /**
   * Query the connected node for its current Anti-MEV policy.
   *
   * Both methods are probed in parallel. A failure on one does not stop the
   * other, and a supported method is reported even when its sibling is not.
   */
  async getPolicy(): Promise<AntiMevPolicy> {
    const blockNumber = await this.rpc.getBlockNumber();
    const chainIdHex = await this.rpc.rawCall<string>('eth_chainId');
    const chainId = Number.parseInt(chainIdHex, 16);

    const [feeCapability, gasCapability, cachedCapability] = await Promise.all([
      this.rpc.probeMethod(NEOX_RPC_METHODS.envelopeFee),
      this.rpc.probeMethod(NEOX_RPC_METHODS.maxEnvelopeGasLimit),
      this.rpc.probeMethod(NEOX_RPC_METHODS.cachedTransaction),
    ]);

    let gasPrice: string | null = null;
    try {
      const hex = await this.rpc.rawCall<string>('eth_gasPrice');
      gasPrice = BigInt(hex).toString();
    } catch (error) {
      this.logger.warn({ error: String(error) }, 'gas price read failed during policy query');
    }

    const envelopeFee = report(NEOX_RPC_METHODS.envelopeFee, feeCapability);
    const maxEnvelopeGasLimit = report(NEOX_RPC_METHODS.maxEnvelopeGasLimit, gasCapability);

    const capability =
      feeCapability.status === 'supported' || gasCapability.status === 'supported'
        ? 'available'
        : feeCapability.status === 'unsupported' && gasCapability.status === 'unsupported'
          ? 'unsupported'
          : 'error';

    this.repo.insertObservation({
      block_number: blockNumber,
      chain_id: chainId,
      gas_price: gasPrice,
      envelope_fee: envelopeFee.status === 'supported' ? envelopeFee.rawValue : null,
      max_envelope_gas_limit:
        maxEnvelopeGasLimit.status === 'supported' ? maxEnvelopeGasLimit.rawValue : null,
      antimev_capability: capability,
      envelope_fee_supported: feeCapability.status === 'supported',
      max_gas_limit_supported: gasCapability.status === 'supported',
      cached_tx_supported: cachedCapability.status === 'supported',
      message_bridge_verified: this.isContractVerified('message_bridge'),
      execution_manager_verified: this.isContractVerified('execution_manager'),
    });

    return {
      blockNumber,
      chainId,
      observedAt: new Date().toISOString(),
      capability,
      envelopeFee,
      maxEnvelopeGasLimit,
      cachedTransaction: report(NEOX_RPC_METHODS.cachedTransaction, cachedCapability),
      gasPrice,
    };
  }

  /** Stored policy observations, most recent first, for the history chart. */
  getHistory(limit: number) {
    return this.repo.listObservations(limit, 0).map((row) => ({
      id: row.id,
      blockNumber: row.block_number,
      chainId: row.chain_id,
      gasPrice: row.gas_price,
      envelopeFee: row.envelope_fee,
      maxEnvelopeGasLimit: row.max_envelope_gas_limit,
      capability: row.antimev_capability,
      envelopeFeeSupported: row.envelope_fee_supported === 1,
      maxGasLimitSupported: row.max_gas_limit_supported === 1,
      observedAt: row.observed_at,
    }));
  }

  private isContractVerified(key: string): boolean {
    return this.repo.getContractCheck(key)?.has_bytecode === 1;
  }
}

export { RpcError };
