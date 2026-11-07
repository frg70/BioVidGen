import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LOG_CAPACITY, LogEntrySchema, createLogger, createMemorySink, type LogEntry, type LogSink } from './log';
import { err, ok } from './result';
import { newRunId } from './runid';

const valid: LogEntry = {
  at: '2026-11-05T12:00:00.000Z',
  runId: newRunIdLiteral(),
  op: 'OP3',
  durationMs: 12,
  outcome: 'ok',
};
function newRunIdLiteral() {
  return 'run_123e4567-e89b-42d3-a456-426614174000';
}
const WHITELIST = ['seq', 'at', 'runId', 'op', 'durationMs', 'outcome', 'errorCode', 'provider', 'calls', 'sizes'];

function clock(start = Date.parse('2026-11-05T12:00:00Z')) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe('core/log', () => {
  it('SYS-OBS-02 log schema whitelist: entries with extra keys (e.g. text) are rejected', () => {
    expect(LogEntrySchema.safeParse(valid).success).toBe(true);
    expect(
      LogEntrySchema.safeParse({ ...valid, errorCode: 'TIMEOUT', provider: 'nano', calls: 4, sizes: { methods: 1200 }, seq: 3 }).success,
    ).toBe(true);
    expect(LogEntrySchema.safeParse({ ...valid, text: 'Patients received 5 mg…' }).success).toBe(false);
    expect(LogEntrySchema.safeParse({ ...valid, url: 'https://journal.example/a' }).success).toBe(false);
    // free text cannot hide in whitelisted fields either
    expect(LogEntrySchema.safeParse({ ...valid, op: 'the patient had a fever' }).success).toBe(false);
    expect(LogEntrySchema.safeParse({ ...valid, errorCode: 'quote not found in methods' }).success).toBe(false);
  });

  it('SYS-OBS-02 any key outside the whitelist is rejected (property)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }).filter((k) => !WHITELIST.includes(k) && k !== '__proto__'),
        fc.oneof(fc.string(), fc.integer()),
        (key, value) => !LogEntrySchema.safeParse({ ...valid, [key]: value }).success,
      ),
    );
  });

  it('SYS-OBS-02 logger never writes an entry carrying extra keys', async () => {
    const sink = createMemorySink();
    const log = createLogger(sink);
    const runId = newRunId();
    await log.op(runId, 'OP4', async () => ok(1), { text: 'article body' } as never);
    const entries = await sink.list();
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0] ?? {})).not.toContain('text');
    expect(entries[0]).toMatchObject({ op: 'log', outcome: 'error', errorCode: 'BAD_LOG_ENTRY', runId });
  });

  it('SYS-OBS-01 runId propagation: every entry of one user action shares its runId', async () => {
    const sink = createMemorySink();
    const log = createLogger(sink);
    const action = newRunId();
    const other = newRunId();
    await log.op(action, 'OP3', async () => {
      await log.op(action, 'OP12', async () => ok('status'));
      await log.op(action, 'OP4', async () => err('NO_TEXT'));
      return ok('article');
    });
    await log.op(other, 'OP1', async () => ok(null));
    const entries = await sink.list();
    const ofAction = entries.filter((e) => e.runId === action);
    expect(ofAction.map((e) => e.op).sort()).toEqual(['OP12', 'OP3', 'OP4']);
    expect(entries.every((e) => LogEntrySchema.safeParse(e).success)).toBe(true);
  });

  it('SYS-OBS-03 ring cap: more than 200 entries → oldest trimmed (memory sink)', async () => {
    const sink = createMemorySink();
    for (let i = 0; i < 250; i++) await sink.append({ ...valid, durationMs: i });
    const entries = await sink.list();
    expect(LOG_CAPACITY).toBe(200);
    expect(entries).toHaveLength(200);
    expect(entries[0]?.durationMs).toBe(50);
    expect(entries.at(-1)?.durationMs).toBe(249);
  });

  it('SVC0-UNIT-12 log.op records duration and outcome; errors keep their code; throws are logged and rethrown', async () => {
    const c = clock();
    const sink = createMemorySink();
    const log = createLogger(sink, c.now);
    const runId = newRunId();

    const r1 = await log.op(runId, 'OP3', async () => {
      c.advance(40);
      return ok('a');
    }, { provider: 'nano', calls: 1 });
    const r2 = await log.op(runId, 'OP12', async () => err('UPSTREAM_DOWN'));
    await expect(log.op(runId, 'OP4', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(
      log.op(runId, 'OP5', async () => { throw new DOMException('closed', 'AbortError'); }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(r1).toEqual(ok('a'));
    expect(r2).toEqual(err('UPSTREAM_DOWN'));
    const e = await sink.list();
    expect(e[0]).toMatchObject({ op: 'OP3', outcome: 'ok', durationMs: 40, provider: 'nano', calls: 1, at: '2026-11-05T12:00:00.000Z' });
    expect(e[1]).toMatchObject({ op: 'OP12', outcome: 'error', errorCode: 'UPSTREAM_DOWN' });
    expect(e[2]).toMatchObject({ op: 'OP4', outcome: 'error', errorCode: 'UNCAUGHT' });
    expect(e[3]).toMatchObject({ op: 'OP5', outcome: 'aborted' });
  });

  it('SVC0-UNIT-13 a failing sink never breaks the operation', async () => {
    const broken: LogSink = { append: async () => { throw new Error('quota'); }, list: async () => [] };
    const log = createLogger(broken);
    expect(await log.op(newRunId(), 'OP3', async () => ok(7))).toEqual(ok(7));
    await expect(log.event({ runId: newRunId(), op: 'messaging', durationMs: 0, outcome: 'error', errorCode: 'BAD_MESSAGE' })).resolves.toBeUndefined();
  });
});
