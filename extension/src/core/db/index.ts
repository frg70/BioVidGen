import { err, ok, type Result } from '../result';
import { BioVidGenDb, DB_NAME, type DexieOptions } from './schema';

/**
 * Opaque handle passed from the composition root to module code. Only core/db/repos/*
 * can unwrap it, so a module cannot reach another module's tables (one writer per store).
 */
declare const handle: unique symbol;
export type DbHandle = { readonly [handle]: true };

/** For core/db/repos only. */
export function unwrap(db: DbHandle): BioVidGenDb {
  return db as unknown as BioVidGenDb;
}

export type DbCode = 'DB_OPEN_FAIL';

/**
 * Opens the database. Failure (private profile, quota, blocked upgrade) returns DB_OPEN_FAIL
 * so the caller can switch to memory-only mode with a banner (SVC0 plan §7).
 */
export async function openDb(options: { name?: string; dexie?: DexieOptions } = {}): Promise<Result<DbHandle, DbCode>> {
  try {
    const db = new BioVidGenDb(options.name ?? DB_NAME, options.dexie);
    await db.open();
    return ok(db as unknown as DbHandle);
  } catch {
    return err('DB_OPEN_FAIL');
  }
}

/** Asks Chrome not to evict our data (SVC0 plan §2). Returns false where unsupported or denied. */
export async function requestPersistence(storage: Pick<StorageManager, 'persist'> | undefined = globalThis.navigator?.storage): Promise<boolean> {
  if (!storage) return false;
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}
