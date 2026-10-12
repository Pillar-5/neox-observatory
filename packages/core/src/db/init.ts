import { parseConfig } from '../config.js';
import { initDatabase } from './database.js';

/**
 * `npm run db:init` entry point.
 *
 * Parses configuration and creates the SQLite schema at the configured path
 * without starting the API or connecting to an RPC endpoint.
 */
function main(): void {
  const { config, defaultsUsed } = parseConfig(process.env);
  if (defaultsUsed.length > 0) {
    process.stdout.write(`defaults applied for: ${defaultsUsed.join(', ')}\n`);
  }
  initDatabase(config.databasePath);
  process.stdout.write(`database ready at ${config.databasePath}\n`);
}

main();
