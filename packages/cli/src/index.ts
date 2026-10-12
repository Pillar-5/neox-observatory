#!/usr/bin/env node
import { fail, program } from './runtime.js';
import {
  registerAntiMevCommands,
  registerBridgeCommands,
  registerReadCommands,
} from './commands.js';

/**
 * NeoX Observatory command line interface.
 *
 * The CLI is a thin client over the REST API. It holds no credentials, never
 * signs a transaction and requires no wallet: every command is a read.
 *
 * The program and the `emit`/`fail`/`getClient` helpers live in `runtime.ts` so
 * that `commands.ts` can use them without importing this entry point, which
 * would form a cycle and run the CLI on import.
 */

export {
  emit,
  fail,
  formatTimestamp,
  getClient,
  program,
  type CliOptions,
} from './runtime.js';

registerReadCommands(program);
registerAntiMevCommands(program);
registerBridgeCommands(program);

/**
 * Only parse argv when this file is the entry point.
 *
 * Importing the module (for example to reuse `emit` or `formatTimestamp` from a
 * test) must not run the CLI against the caller's arguments. `require.main` is
 * undefined under an ESM loader, so the typeof guard keeps this safe in both.
 */
const isEntryPoint =
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  require.main === module;

if (isEntryPoint) {
  program.parseAsync(process.argv).catch((error: unknown) => {
    fail(error);
  });
}
