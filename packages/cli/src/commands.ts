import type { Command } from 'commander';
import { emit, fail, formatTimestamp, getClient } from './runtime.js';

/** Register `status`, `blocks`, `block` and `tx` commands. */
export function registerReadCommands(program: Command): void {
  program
    .command('status')
    .description('network status, chain ID check and Anti-MEV capability summary')
    .action(async () => {
      try {
        const client = getClient();
        const [health, network, capabilities] = await Promise.all([
          client.getHealth(),
          client.getNetwork(),
          client.getCapabilities(),
        ]);

        emit({ health, network, capabilities }, () =>
          [
            `network      ${network.configuredNetwork} (chain ID ${network.chainId}${
              network.chainIdMatches ? '' : `, MISMATCH expected ${network.expectedChainId}`
            })`,
            `rpc          ${
              network.rpcHealthy ? 'healthy' : `unhealthy: ${network.rpcError ?? 'unknown'}`
            }`,
            `latest block ${network.latestBlockNumber ?? 'unknown'}`,
            `gas price    ${network.gasPriceGwei ? `${network.gasPriceGwei} gwei` : 'unknown'}`,
            `antimev      fee=${capabilities.antiMev.envelopeFee} maxGas=${capabilities.antiMev.maxEnvelopeGasLimit} cachedTx=${capabilities.antiMev.cachedTransaction}`,
            `bridge       messageBridge=${
              capabilities.bridge.messageBridgeVerified ? 'verified' : 'not verified'
            } executionManager=${
              capabilities.bridge.executionManagerVerified ? 'verified' : 'not verified'
            }`,
            `aa           configured=${capabilities.accountAbstraction.configured} indexing=${capabilities.accountAbstraction.sponsorshipIndexing}`,
            `indexed      ${health.indexedBlocks} blocks, ${health.indexedTransactions} transactions, ${health.bridgeMessages} bridge messages`,
            `observed at  ${health.observedAt}`,
          ].join('\n'),
        );
      } catch (error) {
        fail(error);
      }
    });

  program
    .command('blocks')
    .description('list recently indexed blocks')
    .option('-n, --limit <number>', 'how many blocks to show', '10')
    .action(async (cmdOptions: { limit: string }) => {
      try {
        const limit = Number.parseInt(cmdOptions.limit, 10);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error('--limit must be a positive integer');
        }
        const client = getClient();
        const result = await client.getBlocks({ limit });

        emit(result, () => {
          if (result.blocks.length === 0) {
            return 'no indexed blocks yet. The indexer fills the database on startup.';
          }
          const header = 'HEIGHT  TIMESTAMP                   TXS  HASH';
          const rows = result.blocks.map(
            (block) =>
              `${String(block.number).padEnd(6)}  ${formatTimestamp(block.timestamp).padEnd(26)}  ` +
              `${String(block.transactionCount).padStart(3)}  ${block.hash}`,
          );
          return [header, ...rows].join('\n');
        });
      } catch (error) {
        fail(error);
      }
    });

  program
    .command('block <number>')
    .description('show one indexed block and its transactions')
    .action(async (numberArg: string) => {
      try {
        const number = Number.parseInt(numberArg, 10);
        if (!Number.isInteger(number) || number < 0) {
          throw new Error('block number must be a non-negative integer');
        }
        const client = getClient();
        const result = await client.getBlock(number);

        emit(result, () => {
          const block = result.block;
          const lines = [
            `block        ${block.number}`,
            `hash         ${block.hash}`,
            `parent       ${block.parentHash}`,
            `timestamp    ${formatTimestamp(block.timestamp)}`,
            `transactions ${block.transactionCount}`,
          ];
          if (block.explorerUrl) lines.push(`explorer     ${block.explorerUrl}`);
          if (result.transactions.length > 0) {
            lines.push('', 'tx hash                                    from -> to');
            for (const tx of result.transactions) {
              lines.push(
                `${tx.hash}  ${(tx.from ?? 'null').slice(0, 10)}->${(tx.to ?? 'contract creation').slice(0, 10)}`,
              );
            }
          }
          return lines.join('\n');
        });
      } catch (error) {
        fail(error);
      }
    });

  program
    .command('tx <hash>')
    .description('inspect a transaction by hash')
    .action(async (hashArg: string) => {
      try {
        if (!/^0x[0-9a-fA-F]{64}$/.test(hashArg)) {
          throw new Error('hash must be a 0x-prefixed 32-byte hex string');
        }
        const client = getClient();
        const result = await client.getTransaction(hashArg);

        emit(result, () => {
          const tx = result.transaction;
          const lines = [
            `hash        ${tx.hash}`,
            `source      ${result.source}`,
            `block       ${tx.blockNumber ?? 'unknown'}`,
            `from        ${tx.from ?? 'unknown'}`,
            `to          ${tx.to ?? 'contract creation'}`,
            `value       ${tx.value ?? '0'} wei`,
            `nonce       ${tx.nonce ?? 'unknown'}`,
            `status      ${
              tx.status === null ? 'unknown' : tx.status === 1 ? 'success' : 'failed'
            }`,
            `gas limit   ${tx.gasLimit ?? 'unknown'}`,
            `gas used    ${tx.gasUsed ?? 'unknown'}`,
          ];
          if (tx.isEnvelope) {
            const envelope = tx.envelope;
            lines.push(
              'envelope    yes',
              `  dkg epoch       ${envelope?.dkgEpoch ?? 'unknown'}`,
              `  inner gas limit ${envelope?.innerGasLimit ?? 'unknown'}`,
              `  inner hash      ${envelope?.innerTransactionHash ?? 'unknown'}`,
            );
          }
          if (result.explorerUrl) lines.push(`explorer    ${result.explorerUrl}`);
          return lines.join('\n');
        });
      } catch (error) {
        fail(error);
      }
    });
}

/** Register the `antimev policy` and `antimev decode` command group. */
export function registerAntiMevCommands(program: Command): void {
  const antimev = program.command('antimev').description('Neo X Anti-MEV policy commands');

  antimev
    .command('policy')
    .description('show the current Anti-MEV policy as reported by the node')
    .action(async () => {
      try {
        const client = getClient();
        const policy = await client.getAntiMevPolicy();

        emit(policy, () =>
          [
            `observed at  ${policy.observedAt}`,
            `block        ${policy.blockNumber}`,
            `capability   ${policy.capability}`,
            `envelope fee ${describeMethod(policy.envelopeFee)}`,
            `max gas      ${describeMethod(policy.maxEnvelopeGasLimit)}`,
            `cached tx    ${describeMethod(policy.cachedTransaction)}`,
          ].join('\n'),
        );
      } catch (error) {
        fail(error);
      }
    });

  antimev
    .command('decode <hex>')
    .description('decode Envelope Transaction calldata deterministically')
    .action(async (hexArg: string) => {
      try {
        const payload = hexArg.startsWith('0x') ? hexArg : `0x${hexArg}`;
        const client = getClient();
        const decoded = await client.decodeEnvelope({ payload });

        emit(decoded, () =>
          [
            `prefix           ${decoded.prefix}`,
            `dkg epoch        ${decoded.dkgEpoch} (${decoded.dkgEpochHex})`,
            `inner gas limit  ${decoded.innerGasLimit} (${decoded.innerGasLimitHex})`,
            `inner tx hash    ${decoded.innerTransactionHash}`,
            `ciphertext bytes ${decoded.ciphertextLength}`,
            `payload bytes    ${decoded.payloadLengthBytes}`,
          ].join('\n'),
        );
      } catch (error) {
        fail(error);
      }
    });
}

/** Register the `bridge recent` and `bridge message` command group. */
export function registerBridgeCommands(program: Command): void {
  const bridge = program.command('bridge').description('Neo X Message Bridge commands');

  bridge
    .command('recent')
    .description('list recently observed bridge messages')
    .option('-n, --limit <number>', 'how many messages to show', '10')
    .action(async (cmdOptions: { limit: string }) => {
      try {
        const limit = Number.parseInt(cmdOptions.limit, 10);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error('--limit must be a positive integer');
        }
        const client = getClient();
        const result = await client.getBridgeMessages({ limit });

        emit(result, () => {
          if (result.messages.length === 0) {
            return 'no bridge messages observed in the indexed range yet.';
          }
          const header = 'ID      STATE                SOURCE BLOCK  LATENCY  SOURCE TX';
          const rows = result.messages.map(
            (message) =>
              `${message.id.padEnd(7)}  ${message.state.padEnd(18)}  ` +
              `${String(message.sourceBlockNumber ?? '-').padEnd(12)}  ` +
              `${message.latencySeconds !== null ? `${message.latencySeconds}s`.padEnd(8) : '-'.padEnd(8)}  ` +
              `${message.sourceTxHash ?? '-'}`,
          );
          return [header, ...rows].join('\n');
        });
      } catch (error) {
        fail(error);
      }
    });

  bridge
    .command('message <id>')
    .description('show one bridge message by its bridge nonce identifier')
    .action(async (idArg: string) => {
      try {
        const client = getClient();
        const result = await client.getBridgeMessage(idArg);

        emit(result, () => {
          const message = result.message;
          const lines = [
            `id             ${message.id}`,
            `state          ${message.state}`,
            `direction      ${message.direction}`,
            `source tx      ${message.sourceTxHash ?? 'not observed'}`,
            `source block   ${message.sourceBlockNumber ?? 'not observed'}`,
            `source address ${message.sourceAddress ?? 'not observed'}`,
            `execution tx   ${message.executionTxHash ?? 'destination execution not observed'}`,
            `latency        ${message.latencySeconds !== null ? `${message.latencySeconds}s` : 'not calculable yet'}`,
          ];
          if (message.errorMessage) lines.push(`error          ${message.errorMessage}`);
          if (message.sourceExplorerUrl) {
            lines.push(`explorer       ${message.sourceExplorerUrl}`);
          }
          return lines.join('\n');
        });
      } catch (error) {
        fail(error);
      }
    });
}

/** Render one method report line for terminal output. */
export function describeMethod(report: {
  status: string;
  rawValue: string | null;
  normalizedValue: string | null;
  error?: string | null;
}): string {
  if (report.status === 'supported') {
    return `${report.rawValue ?? 'null'} (${report.normalizedValue ?? 'n/a'} normalized)`;
  }
  if (report.status === 'unsupported') return 'unsupported by this endpoint';
  if (report.status === 'error') {
    return `probe failed${report.error ? `: ${report.error}` : ''}`;
  }
  return report.status;
}
