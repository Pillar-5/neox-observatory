import type { Logger } from 'pino';
import { ENTRYPOINT_V0_9_ADDRESS, SYSTEM_CONTRACTS } from '../constants.js';
import type { Repository } from '../db/repository.js';
import { RpcClient } from '../rpc/client.js';

/**
 * Account abstraction and GovPaymaster monitoring.
 *
 * The GovPaymaster address is a Neo X system contract allocated at genesis, and
 * the EntryPoint it accepts is ERC-4337 v0.9. Both were confirmed with
 * eth_getCode on the public endpoints on 2025-10-08, so this module is enabled
 * rather than stubbed out.
 *
 * The event model for sponsored user operations is not published as an ABI in a
 * form that this project can vendor with confidence: the EntryPoint v0.9 UserOperationEvent
 * signature lives in the EntryPoint contract, and GovPaymaster's own sponsored
 * operation events are not exposed through a public artifact. Rather than guess
 * a topic hash, sponsorship indexing stays disabled and reports its state
 * explicitly. Bytecode presence is verified, and that is reported as fact.
 */

export const GOV_PAYMASTER_ADDRESS = SYSTEM_CONTRACTS.govPaymaster;

export type SponsorshipIndexingState = 'enabled' | 'not_configured';

export interface AccountAbstractionStatus {
  configured: boolean;
  govPaymasterAddress: string;
  entryPointAddress: string;
  entryPointVersion: string;
  govPaymasterHasBytecode: boolean;
  entryPointHasBytecode: boolean;
  verifiedAt: string | null;
  verificationError: string | null;
  sponsorshipIndexing: SponsorshipIndexingState;
  /** Why sponsorship indexing is off, when it is off. */
  sponsorshipIndexingReason: string | null;
  indexedEvents: number;
  successes: number;
  failures: number;
  latestIndexedBlock: number | null;
  sourceNote: string;
}

export class AccountAbstractionService {
  constructor(
    private readonly rpc: RpcClient,
    private readonly repo: Repository,
    private readonly logger: Logger,
  ) {}

  /**
   * Verify deployed bytecode for GovPaymaster and the EntryPoint.
   *
   * Only bytecode presence is asserted. No event indexing is attempted because
   * the sponsorship event model could not be confirmed from a public artifact.
   */
  async verifyContracts(): Promise<{ govPaymaster: boolean; entryPoint: boolean; error: string | null }> {
    let error: string | null = null;
    const results: boolean[] = [];

    const targets = [
      { key: 'gov_paymaster', address: GOV_PAYMASTER_ADDRESS },
      { key: 'entrypoint_v0_9', address: ENTRYPOINT_V0_9_ADDRESS },
    ];

    for (const target of targets) {
      try {
        const code = await this.rpc.getCode(target.address);
        const hasBytecode = code !== '0x' && code.length > 2;
        this.repo.upsertContractCheck({
          contract_key: target.key,
          address: target.address,
          has_bytecode: hasBytecode,
          bytecode_length: hasBytecode ? (code.length - 2) / 2 : 0,
          error: hasBytecode ? null : 'eth_getCode returned no bytecode at this address',
        });
        this.logger.info(
          { contract: target.key, address: target.address, hasBytecode },
          'verified account abstraction contract',
        );
        results.push(hasBytecode);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        error = message;
        this.repo.upsertContractCheck({
          contract_key: target.key,
          address: target.address,
          has_bytecode: false,
          bytecode_length: null,
          error: message,
        });
        this.logger.error({ contract: target.key, error: message }, 'AA contract check failed');
        results.push(false);
      }
    }

    return { govPaymaster: results[0] ?? false, entryPoint: results[1] ?? false, error };
  }

  /** Current account abstraction state for the API and dashboard. */
  getStatus(): AccountAbstractionStatus {
    const paymasterCheck = this.repo.getContractCheck('gov_paymaster');
    const entryPointCheck = this.repo.getContractCheck('entrypoint_v0_9');
    const counts = this.repo.getAaCounts();

    const govPaymasterHasBytecode = paymasterCheck?.has_bytecode === 1;
    const entryPointHasBytecode = entryPointCheck?.has_bytecode === 1;

    return {
      configured: govPaymasterHasBytecode,
      govPaymasterAddress: GOV_PAYMASTER_ADDRESS,
      entryPointAddress: ENTRYPOINT_V0_9_ADDRESS,
      entryPointVersion: '0.9',
      govPaymasterHasBytecode,
      entryPointHasBytecode,
      verifiedAt: paymasterCheck?.verified_at ?? null,
      verificationError: paymasterCheck?.error ?? entryPointCheck?.error ?? null,
      sponsorshipIndexing: 'not_configured',
      sponsorshipIndexingReason:
        'Sponsorship event indexing is disabled because the GovPaymaster event model is not ' +
        'available as a public ABI artifact. Bytecode presence is verified, but no event ' +
        'signature is assumed.',
      indexedEvents: counts.total,
      successes: counts.succeeded,
      failures: counts.failed,
      latestIndexedBlock: counts.latest_block,
      sourceNote:
        'Addresses verified with eth_getCode against the public Neo X endpoint on 2025-10-08. ' +
        'See docs/sources.md.',
    };
  }
}
