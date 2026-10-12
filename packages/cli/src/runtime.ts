import { Command } from 'commander';
import { createNeoXObservatoryClient } from '@neox-observatory/sdk';

/**
 * Shared CLI runtime: the commander program and the helpers every command uses.
 *
 * This lives apart from `index.ts` so `commands.ts` can call `emit` without
 * importing the entry point. Importing the entry point from a command module
 * would form a cycle and, because `index.ts` parses argv on load, would run the
 * CLI as a side effect of being imported.
 */

export interface CliOptions {
  /** Base URL of a running NeoX Observatory API. */
  url: string;
  /** Emit raw JSON instead of terminal formatted text. */
  json?: boolean;
}

export const program = new Command();

program
  .name('neox-observatory')
  .description('Read-only CLI for the NeoX Observatory API')
  .version('0.1.0')
  .option('--url <url>', 'API base URL', 'http://127.0.0.1:3000')
  .option('--json', 'print raw JSON output', false);

export function getClient(): ReturnType<typeof createNeoXObservatoryClient> {
  const opts = program.opts<CliOptions>();
  return createNeoXObservatoryClient({ baseUrl: opts.url });
}

/** Print JSON when --json was passed, otherwise print the formatted text. */
export function emit(data: unknown, text: () => string): void {
  const opts = program.opts<CliOptions>();
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    process.stdout.write(`${text()}\n`);
  }
}

export function fail(error: unknown): never {
  if (error instanceof Error) {
    process.stderr.write(`error: ${error.message}\n`);
  } else {
    process.stderr.write(`error: ${String(error)}\n`);
  }
  process.exit(1);
}

/** Format a unix timestamp for a terminal without pulling in a date library. */
export function formatTimestamp(unixSeconds: number | null): string {
  if (unixSeconds === null || Number.isNaN(unixSeconds)) return 'unknown';
  return new Date(unixSeconds * 1000).toISOString().replace('.000Z', 'Z');
}
