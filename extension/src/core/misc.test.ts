import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../public/_locales/en/messages.json';
import es from '../../public/_locales/es/messages.json';
import { STATIC_ALLOWED_HOSTS, isAllowedUrl } from './egress';
import { FLAG_DEFAULTS, createFlags } from './flags';
import { createT } from './i18n';
import { RUN_ID_PATTERN, isRunId, newRunId } from './runid';

const ROOT = join(import.meta.dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
const APP_SOURCES = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'entrypoints'))];

describe('core/runid', () => {
  it('SVC0-UNIT-18 runIds are well-formed and unique', () => {
    const ids = Array.from({ length: 1000 }, newRunId);
    expect(ids.every((id) => RUN_ID_PATTERN.test(id) && isRunId(id))).toBe(true);
    expect(new Set(ids).size).toBe(1000);
    expect(isRunId('run_x')).toBe(false);
    expect(isRunId(42)).toBe(false);
  });
});

describe('core/egress', () => {
  it('SVC0-SEC-03 allowlist: https to scholarly hosts and the chosen LLM host; http only to local Ollama', () => {
    expect(STATIC_ALLOWED_HOSTS).toEqual(['api.openalex.org', 'api.crossref.org', 'www.ebi.ac.uk', 'api.unpaywall.org', 'localhost:11434']);
    expect(isAllowedUrl('https://api.openalex.org/works/doi:10.1/x')).toBe(true);
    expect(isAllowedUrl('https://www.ebi.ac.uk/europepmc/webservices/rest/PMC1/fullTextXML')).toBe(true);
    expect(isAllowedUrl('http://localhost:11434/api/chat')).toBe(true);
    expect(isAllowedUrl('https://api.groq.com/openai/v1/chat/completions', ['api.groq.com'])).toBe(true);
    for (const bad of [
      'https://api.groq.com/x',
      'http://api.crossref.org/works',
      'https://localhost:11435/',
      'http://localhost/',
      'https://api.openalex.org.evil.example/',
      'https://user@evil.example/',
      'ftp://api.openalex.org/',
      'not a url',
    ]) {
      expect(isAllowedUrl(bad), bad).toBe(false);
    }
  });
});

describe('core/flags', () => {
  it('SVC0-UNIT-19 flags return typed defaults and honour overrides', () => {
    const flags = createFlags();
    expect(flags.get('summary.enabled')).toBe(false);
    expect(flags.get('providers.allowed')).toEqual(FLAG_DEFAULTS['providers.allowed']);
    expect(createFlags({ 'summary.enabled': true }).get('summary.enabled')).toBe(true);
    // @ts-expect-error unknown flag names do not compile
    expect(() => flags.get('nope')).toThrow();
  });
});

describe('core/i18n', () => {
  it('SVC0-UNIT-20 t() returns the message, passes substitutions, and shows the key when missing', () => {
    const calls: unknown[] = [];
    const t = createT((key, subs) => {
      calls.push([key, subs]);
      return key === 'panelTitle' ? 'BioVidGen' : '';
    });
    expect(t('panelTitle')).toBe('BioVidGen');
    expect(t('panelEmpty', ['x'])).toBe('panelEmpty');
    expect(calls).toEqual([['panelTitle', undefined], ['panelEmpty', ['x']]]);
  });

  it('SYS-I18N-01 string coverage: es and en define the same keys, and every t() key exists', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    for (const v of [...Object.values(es), ...Object.values(en)]) expect(v.message.trim()).not.toBe('');
    const used = APP_SOURCES.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1]));
    for (const key of used) expect(Object.keys(es), `missing es message ${key}`).toContain(key);
  });
});

describe('storage.sync ban', () => {
  it('SYS-SEC-12 keys not in sync: no app source references chrome.storage.sync', () => {
    const offenders = APP_SOURCES.filter((f) => /storage\s*\.\s*sync\b|\[\s*['"]sync['"]\s*\]/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
