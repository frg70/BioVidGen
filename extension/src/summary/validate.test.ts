import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SummarySchema, type ArticleText, type ProviderMeta, type SectionDraft } from '../contracts/pipeline';
import { openDb, unwrap, type DbHandle } from '../core/db';
import { createLogger, createMemorySink, type LogSink } from '../core/log';
import { newRunId } from '../core/runid';
import type { Drafts } from './evidence';
import { getLatestSummary, getSummary, validateAndStore } from './validate';

const ROOT = join(import.meta.dirname, '..', '..');
const { _note, ...fixture } = JSON.parse(readFileSync(join(ROOT, 'fixtures/op5v/article-text.json'), 'utf8')) as ArticleText & { _note: string };
void _note;
const TEXT: ArticleText = fixture;
const DOI = '10.5555/biovidgen.synthetic.1';
const META: ProviderMeta = { provider: 'stub', modelId: 'stub-0', promptHash: 'p0', pipelineVersion: 'pv1' };
const T0 = Date.parse('2026-11-05T12:00:00.000Z');

const good: SectionDraft = {
  section: 'results',
  summaryEs: 'Hubo menos infecciones respiratorias con vitamina D.',
  evidence: [{ quote: 'Acute respiratory infections occurred in 81 participants in the vitamin D group', section: 'results' }],
};
const DRAFTS: Drafts = {
  intro: { mainTopic: 'Vitamina D', prerequisiteTopics: ['ensayo clínico'] },
  sections: [good, { ...good, section: 'conclusions', evidence: [{ quote: 'hypercalcaemia invented by the model here', section: 'results' }] }],
};

let n = 0;
async function setup(now = () => T0): Promise<{ db: DbHandle; sink: LogSink; deps: Parameters<typeof validateAndStore>[0] }> {
  const r = await openDb({ name: `op5v-${Date.now()}-${n++}` });
  if (!r.ok) throw new Error(r.code);
  const sink = createMemorySink();
  return { db: r.value, sink, deps: { db: r.value, log: createLogger(sink, now), now } };
}

describe('OP5V validate and store', () => {
  it('OP5V-INT-01 Dexie round trip: put → read back deep-equal; latest by DOI returns newest', async () => {
    let t = T0;
    const { db, deps } = await setup(() => t);
    const a = await validateAndStore(deps, newRunId(), DOI, DRAFTS, TEXT, META);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(await getSummary(db, DOI, 'pv1')).toEqual(a.value);
    t = T0 + 60_000;
    const b = await validateAndStore(deps, newRunId(), DOI, DRAFTS, TEXT, { ...META, pipelineVersion: 'pv0-older-key' });
    expect(b.ok && (await getLatestSummary(db, DOI))).toEqual(b.ok && b.value);
    expect(await getLatestSummary(db, '10.9999/other')).toBeUndefined();
  });

  it('OP5V-UNIT-10 all sections failed → ALL_SECTIONS_FAILED, nothing stored', async () => {
    const { db, deps } = await setup();
    const r = await validateAndStore(deps, newRunId(), DOI, { sections: [{ section: 'results' }] }, TEXT, META);
    expect(r).toEqual({ ok: false, code: 'ALL_SECTIONS_FAILED' });
    expect(await getLatestSummary(db, DOI)).toBeUndefined();
  });

  it('OP5V-UNIT-12 atomic write: a failing transaction stores nothing', async () => {
    const { db, deps } = await setup();
    const fail = () => {
      throw new Error('boom');
    };
    unwrap(db).summaries.hook('creating', fail);
    const r = await validateAndStore(deps, newRunId(), DOI, DRAFTS, TEXT, META);
    unwrap(db).summaries.hook('creating').unsubscribe(fail);
    expect(r).toEqual({ ok: false, code: 'STORE_FAILED' });
    expect(await unwrap(db).summaries.count()).toBe(0);
  });

  it('OP5V-RES-01 blocked transaction: retried once, then STORE_FAILED (logged)', async () => {
    const { db, deps, sink } = await setup();
    let calls = 0;
    const once = () => {
      if (calls++ === 0) throw new Error('blocked');
    };
    unwrap(db).summaries.hook('creating', once);
    const r = await validateAndStore(deps, newRunId(), DOI, DRAFTS, TEXT, META);
    unwrap(db).summaries.hook('creating').unsubscribe(once);
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);

    const { db: db2, deps: deps2, sink: sink2 } = await setup();
    let calls2 = 0;
    const always = () => {
      calls2++;
      throw new Error('blocked');
    };
    unwrap(db2).summaries.hook('creating', always);
    expect(await validateAndStore(deps2, newRunId(), DOI, DRAFTS, TEXT, META)).toEqual({ ok: false, code: 'STORE_FAILED' });
    unwrap(db2).summaries.hook('creating').unsubscribe(always);
    expect(calls2).toBe(2);
    expect((await sink2.list()).at(-1)).toMatchObject({ op: 'OP5V', outcome: 'error', errorCode: 'STORE_FAILED' });
    expect((await sink.list()).at(-1)).toMatchObject({ op: 'OP5V', outcome: 'ok' });
  });

  it('OP5V-UNIT-13 reversibility: a new pipelineVersion (e.g. normaliser bump) adds a record and keeps the old one', async () => {
    const { db, deps } = await setup();
    await validateAndStore(deps, newRunId(), DOI, DRAFTS, TEXT, META);
    await validateAndStore(deps, newRunId(), DOI, DRAFTS, TEXT, { ...META, pipelineVersion: 'pv2' });
    expect((await getSummary(db, DOI, 'pv1'))?.pipelineVersion).toBe('pv1');
    expect((await getSummary(db, DOI, 'pv2'))?.pipelineVersion).toBe('pv2');
    expect(await unwrap(db).summaries.count()).toBe(2);
  });

  it('OP5V-UNIT-14 concurrency: two runs on the same key → one identical final record', async () => {
    const { db, deps } = await setup();
    const [a, b] = await Promise.all([
      validateAndStore(deps, newRunId(), DOI, DRAFTS, TEXT, META),
      validateAndStore(deps, newRunId(), DOI, structuredClone(DRAFTS), TEXT, META),
    ]);
    expect(a).toEqual(b);
    expect(await unwrap(db).summaries.count()).toBe(1);
    expect(await getSummary(db, DOI, 'pv1')).toEqual(a.ok && a.value);
  });

  it('OP5V-SEC-04 OP5V-OBS-01 one log entry with runId and counts by reason; no article, quote or summary text', async () => {
    const { deps, sink } = await setup();
    const runId = newRunId();
    await validateAndStore(deps, runId, DOI, DRAFTS, TEXT, META);
    const logs = await sink.list();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      runId,
      op: 'OP5V',
      outcome: 'ok',
      provider: 'stub',
      sizes: {
        quotes: 2,
        evidence: 1,
        'rejected.NOT_FOUND': 1,
        'rejected.QUOTE_TOO_SHORT': 0,
        'rejected.QUOTE_TOO_LONG': 0,
        section_mismatch: 0,
        drafts_invalid: 0,
        'sections.verified': 1,
        'sections.no_verificado': 1,
        'sections.abstract_only': 0,
        'sections.failed': 0,
        numbers_unsupported: 0,
      },
    });
    const json = JSON.stringify(logs);
    for (const leak of ['respiratory', 'infecciones', 'hypercalcaemia', 'Vitamina', 'ensayo', DOI]) expect(json).not.toContain(leak);
  });

  it('OP5V-TYPE-01 v1 Summary fixtures parse under the current schema (additive-only)', () => {
    const dir = join(ROOT, 'fixtures/op5v');
    const files = readdirSync(dir).filter((f) => /^summary\.v1\..+\.json$/.test(f));
    const statuses = new Set<string>();
    for (const f of files) {
      const parsed = SummarySchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      for (const s of Object.values(parsed.sections)) if (s) statuses.add(s.status);
    }
    expect([...statuses].sort()).toEqual(['abstract_only', 'failed', 'no_verificado', 'verified']);
  });
});
