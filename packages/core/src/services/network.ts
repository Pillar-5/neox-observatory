import type { Logger } from 'pino';
import { getNetworkDefinition, hexToChainId, type NetworkName } from '../constants.js';
import type { Repository } from '../db/repository.js';
import { RpcClient } from '../rpc/client.js';
import { weiPerGasToGwei } from '../normalize.js';

/**
 * Read-only Neo X network status.
 *
 * Everything here comes from a live RPC call made at request time, or from a
 * stored observation that records when the read happened. No value is derived
 * from a cached constant other than the expected chain ID, which exists only to
 * be compared against what the endpoint reports.
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
  /** Network the operator configured. */
  configuredNetwork: NetworkName;
  /** Chain ID the endpoint actually returned. */
  chainId: number;
  chainIdHex: string;
  /** Chain ID expected for the configured network. */
  expectedChainId: number;
  /** False when the endpoint chain ID and configuration disagree. */
  chainIdMatches: boolean;
  rpcUrl: string;
  /** true when the most recent RPC round trip succeeded. */
  rpcHealthy: boolean;
  rpcError: string | null;
  latestBlockNumber: number | null;
  latestBlockTimestamp: number | null;
  /** Gas price in wei, straight from eth_gasPrice. */
  gasPrice: string | null;
  gasPriceGwei: string | null;
  /** Last stored Anti-MEV observation, when one exists. */
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

export class NetworkService {
  constructor(
    private readonly rpc: RpcClient,
    private readonly repo: Repository,
    private readonly logger: Logger,
    private readonly network: NetworkName,
  ) {}

  /**
   * Assemble current network status.
   *
   * An RPC failure is reported rather than thrown so the dashboard can render a
   * degraded state. A chain ID mismatch is surfaced as a field instead of an
   * exception because the operator still needs to see the values that disagree.
   */
  async getStatus(): Promise<NetworkStatus> {
    const definition = getNetworkDefinition(this.network);
    const collectedAt = new Date().toISOString();

    let chainIdHex: string | null = null;
    let chainId: number | null = null;
    let rpcError: string | null = null;
    let latestBlockNumber: number | null = null;
    let latestBlockTimestamp: number | null = null;
    let gasPrice: string | null = null;

    try {
      chainIdHex = await this.rpc.rawCall<string>('eth_chainId');
      chainId = hexToChainId(chainIdHex);

      const head = await this.rpc.getBlockNumber();
      latestBlockNumber = head;

      const block = await this.rpc.getBlock(head);
      latestBlockTimestamp = block?.timestamp ?? null;

      const gasPriceHex = await this.rpc.rawCall<string>('eth_gasPrice');
      gasPrice = BigInt(gasPriceHex).toString();
    } catch (error) {
      rpcError = error instanceof Error ? error.message : String(error);
      this.logger.warn({ error: rpcError }, 'network status RPC read failed');
    }

    const observation = this.repo.getLatestObservation();
    const contractChecks = this.repo.listContractChecks();

    const antiMevCapability = observation?.antimev_capability ?? null;

    return {
      configuredNetwork: this.network,
      chainId: chainId ?? definition.chainId,
      chainIdHex: chainIdHex ?? definition.chainIdHex,
      expectedChainId: definition.chainId,
      chainIdMatches: chainId === null ? false : chainId === definition.chainId,
      rpcUrl: this.rpc.url,
      rpcHealthy: rpcError === null,
      rpcError,
      latestBlockNumber,
      latestBlockTimestamp,
      gasPrice,
      gasPriceGwei: weiPerGasToGwei(gasPrice),
      lastObservation: observation
        ? {
            blockNumber: observation.block_number,
            envelopeFee: observation.envelope_fee,
            maxEnvelopeGasLimit: observation.max_envelope_gas_limit,
            antimevCapability: observation.antimev_capability,
            observedAt: observation.observed_at,
          }
        : null,
      antiMevCapability,
      contracts: contractChecks.map((row) => ({
        key: row.contract_key,
        address: row.address,
        hasBytecode: row.has_bytecode === 1,
        bytecodeLength: row.bytecode_length,
        verifiedAt: row.verified_at,
        error: row.error,
      })),
      collectedAt,
    };
  }

  /**
   * Read eth_chainId and compare it with the configured network.
   *
   * Throws when the values disagree because continuing would silently query the
   * wrong chain and store mislabelled data. Throws when the call itself fails so
   * a startup failure is loud rather than deferred to the first page load.
   */
  async verifyChainId(): Promise<{ chainId: number; matches: boolean; expectedChainId: number }> {
    const definition = getNetworkDefinition(this.network);
    const hex = await this.rpc.rawCall<string>('eth_chainId');
    const chainId = hexToChainId(hex);
    const expected = definition.chainId;

    if (chainId !== expected) {
      throw new Error(
        `Configured network "${this.network}" expects chain ID ${expected} but ${this.rpc.url} ` +
          `returned ${chainId}. Update NEOX_RPC_URL or NEOX_NETWORK so they agree.`,
      );
    }

    this.logger.info({ network: this.network, chainId, rpcUrl: this.rpc.url }, 'chain ID verified');
    return { chainId, matches: true, expectedChainId: expected };
  }
}
