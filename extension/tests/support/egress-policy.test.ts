import { describe, expect, it } from 'vitest';
import { checkEgress, type EgressContext } from './egress-policy';

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const ctx: EgressContext = {
  extensionOrigin: EXT,
  fixtureHosts: ['fixtures.biovidgen.test'],
  forbiddenValues: ['https://fixtures.biovidgen.test/article/1', 'Efficacy of drug X in adults'],
};
const get = (url: string) => ({ url, method: 'GET' });

describe('egress policy (fitness function used by the e2e suite)', () => {
  it('SYS-SEC-01 network allowlist checker passes allowlisted hosts, own extension and fixture pages', () => {
    expect(
      checkEgress(
        [
          get('https://api.openalex.org/works/doi:10.1/x'),
          get('https://api.crossref.org/works/10.1/x?mailto=a@b.c'),
          get('http://localhost:11434/api/tags'),
          get(`${EXT}/sidepanel.html`),
          get('https://fixtures.biovidgen.test/article/1'),
          get('data:image/png;base64,AAAA'),
        ],
        ctx,
      ),
    ).toEqual([]);
  });

  it('SYS-SEC-01 network allowlist checker flags any other host, other extensions and plain http', () => {
    const v = checkEgress(
      [
        get('https://www.google-analytics.com/collect'),
        get('chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/x.js'),
        get('http://api.openalex.org/works/doi:10.1/x'),
        get('wss://api.openalex.org/socket'),
        get('https://api.groq.com/openai/v1/chat/completions'),
      ],
      ctx,
    );
    expect(v.map((x) => x.rule)).toEqual(['SYS-SEC-01', 'SYS-SEC-01', 'SYS-SEC-01', 'SYS-SEC-01', 'SYS-SEC-01']);
    expect(checkEgress([get('https://api.groq.com/openai/v1/chat/completions')], { ...ctx, userLlmHosts: ['api.groq.com'] })).toEqual([]);
  });

  it('SYS-SEC-02 payload allowlist checker: identifiers and approved params only; no page URL, title or runId', () => {
    expect(
      checkEgress([get('https://api.openalex.org/works?filter=doi:10.1/a|10.1/b&select=id,doi&per-page=100&mailto=a@b.c&api_key=k')], ctx),
    ).toEqual([]);
    const bad = checkEgress(
      [
        get('https://api.openalex.org/works/doi:10.1/x?ref=https%3A%2F%2Ffixtures.biovidgen.test%2Farticle%2F1'),
        get('https://api.crossref.org/works?query.title=Efficacy%20of%20drug%20X%20in%20adults'),
        get('https://api.crossref.org/works/10.1/x?mailto=a@b.c&utm_source=ext'),
        get('https://api.openalex.org/works/doi:10.1/x?run=run_123e4567-e89b-42d3-a456-426614174000'),
        { url: 'https://api.crossref.org/works', method: 'POST', postData: '{}' },
      ],
      ctx,
    );
    expect(bad.map((x) => x.rule)).toEqual(['SYS-SEC-02', 'SYS-SEC-02', 'SYS-SEC-02', 'SYS-SEC-02', 'SYS-SEC-02']);
  });
});
