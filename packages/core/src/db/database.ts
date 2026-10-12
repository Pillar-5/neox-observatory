import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initializeSchema } from './schema.js';
import { Repository } from './repository.js';

/**
 * Open the SQLite database and make sure the schema exists.
 *
 * The parent directory is created when missing so a fresh checkout can point
 * DATABASE_PATH anywhere without a manual mkdir. better-sqlite3 is used rather
 * than a native module that needs a build step, so the binary install works
 * from the published prebuilds.
 */
export interface OpenDatabaseResult {
  db: Database.Database;
  repo: Repository;
}

export function openDatabase(path: string): OpenDatabaseResult {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  initializeSchema(db);

  return { db, repo: new Repository(db) };
}

/** Create the schema without keeping a handle open, used by `npm run db:init`. */
export function initDatabase(path: string): void {
  const { db } = openDatabase(path);
  db.close();
}
