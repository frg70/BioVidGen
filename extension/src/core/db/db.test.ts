import { describe, expect, it } from 'vitest';
import { createMemorySink, LOG_CAPACITY, type LogEntry } from '../log';
import { openDb, requestPersistence, unwrap, type DbHandle } from './index';
import { logsRepo } from './repos/logs';
import { statusChecksRepo } from './repos/status-checks';
import { summariesRepo } from './repos/summaries';
import { DB_VERSION } from './schema';

let n = 0;
async function freshDb(): Promise<DbHandle> {
  const r = await openDb({ name: `test-${Date.now()}-${n++}` });
  if (!r.ok) throw new Error(r.code);
  return r.value;
}

const entry = (i: number): LogEntry => ({
  at: '2026-11-05T12:00:00.000Z',
  runId: 'run_123e4567-e89b-42d3-a456-426614174000',
  op: 'OP3',
  durationMs: i,
  outcome: 'ok',
});

describe('core/db', () => {
  it('SVC0-INT-01 schema v1 has exactly the planned stores, keys and indexes', async () => {
    const db = unwrap(await freshDb());
    expect(db.verno).toBe(DB_VERSION);
    const shape = Object.fromEntries(
      db.tables.map((t) => [t.name, { pk: t.schema.primKey.src, idx: t.schema.indexes.map((i) => i.src).sort() }]),
    );
    expect(shape).toEqual({
      articles: { pk: 'doi', idx: ['fetchedAt'] },
      status_checks: { pk: '[doi+checkedAt]', idx: ['doi'] },
      texts: { pk: '[doi+contentHash]', idx: ['doi'] },
      summaries: { pk: '[doi+pipelineVersion]', idx: ['createdAt', 'doi'] },
      feedback: { pk: '++id', idx: ['summaryKey'] },
      logs: { pk: '++seq', idx: ['at', 'runId'] },
    });
  });

  it('SVC0-INT-02 open failure returns DB_OPEN_FAIL instead of throwing (memory-only mode)', async () => {
    const broken = {
      open: () => {
        throw new DOMException('The user denied permission to access the database.', 'InvalidStateError');
      },
    } as unknown as IDBFactory;
    const r = await openDb({ name: 'broken', dexie: { indexedDB: broken, IDBKeyRange } });
    expect(r).toEqual({ ok: false, code: 'DB_OPEN_FAIL' });
  });

  it('SVC0-INT-03 repositories serve the planned access patterns (latest status, latest/recent summaries)', async () => {
    const db = await freshDb();
    const status = statusChecksRepo(db);
    await status.put({ doi: '10.1/a', checkedAt: '2026-11-01T00:00:00Z', v: 1 });
    await status.put({ doi: '10.1/a', checkedAt: '2026-11-04T00:00:00Z', v: 2 });
    await status.put({ doi: '10.1/b', checkedAt: '2026-11-05T00:00:00Z', v: 3 });
    expect((await status.latest('10.1/a'))?.v).toBe(2);
    expect(await status.latest('10.1/none')).toBeUndefined();

    const sums = summariesRepo(db);
    await sums.put({ doi: '10.1/a', pipelineVersion: 'p1', createdAt: '2026-11-01T00:00:00Z' });
    await sums.put({ doi: '10.1/a', pipelineVersion: 'p2', createdAt: '2026-11-03T00:00:00Z' });
    await sums.put({ doi: '10.1/b', pipelineVersion: 'p1', createdAt: '2026-11-02T00:00:00Z' });
    expect((await sums.latestByDoi('10.1/a'))?.pipelineVersion).toBe('p2');
    expect((await sums.listRecent(2)).map((s) => `${s.doi}@${s.pipelineVersion}`)).toEqual(['10.1/a@p2', '10.1/b@p1']);
  });

  it('SYS-OBS-03 ring cap: logs store keeps the newest 200 entries, trimmed on insert', async () => {
    const logs = logsRepo(await freshDb(), LOG_CAPACITY);
    for (let i = 0; i < 205; i++) await logs.append(entry(i));
    const all = await logs.list();
    expect(all).toHaveLength(200);
    expect(all[0]?.durationMs).toBe(5);
    expect(all.at(-1)?.durationMs).toBe(204);
    // the memory-only fallback has the same cap
    const mem = createMemorySink();
    for (let i = 0; i < 205; i++) await mem.append(entry(i));
    expect(await mem.list()).toHaveLength(200);
  });

  it('SVC0-UNIT-17 requests persistent storage once and tolerates its absence', async () => {
    expect(await requestPersistence({ persist: async () => true })).toBe(true);
    expect(await requestPersistence({ persist: async () => false })).toBe(false);
    expect(await requestPersistence(undefined)).toBe(false);
    expect(await requestPersistence({ persist: async () => { throw new Error('nope'); } })).toBe(false);
  });

  it('SVC0-TYPE-01 DbHandle is opaque: module code cannot reach tables without a repository', async () => {
    const db = await freshDb();
    // @ts-expect-error tables are not visible on the handle
    expect(db.summaries).toBeDefined(); // runtime object is the Dexie instance; the type hides it
  });
});
