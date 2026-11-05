import { SCHOLARLY_HOSTS, isAllowedUrl } from '../../src/core/egress';

/**
 * Fitness function for SYS-SEC-01 (host allowlist) and SYS-SEC-02 (payload allowlist), used by
 * the e2e suite on every captured request. Pure so it can be unit-tested against known bad traffic.
 */
export interface ObservedRequest {
  url: string;
  method: string;
  postData?: string | null;
}
export interface EgressViolation {
  rule: 'SYS-SEC-01' | 'SYS-SEC-02';
  url: string;
  reason: string;
}
export interface EgressContext {
  /** chrome-extension://<id> of the extension under test. */
  extensionOrigin: string;
  /** Hosts the test itself serves (fixture pages). */
  fixtureHosts?: readonly string[];
  /** The user-chosen LLM host(s), when a test configures one. */
  userLlmHosts?: readonly string[];
  /** Values that must never leave the machine (visited URLs, titles, runIds). */
  forbiddenValues?: readonly string[];
}

/** Query parameters a scholarly request may carry (catalog SYS-SEC-02). */
export const SCHOLARLY_PARAMS: ReadonlySet<string> = new Set(['mailto', 'api_key', 'select', 'filter', 'per-page']);
const SCHOLARLY: readonly string[] = SCHOLARLY_HOSTS;
const RUN_ID = /run_[0-9a-f]{8}-/;

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};

export function checkEgress(requests: readonly ObservedRequest[], ctx: EgressContext): EgressViolation[] {
  const out: EgressViolation[] = [];
  for (const r of requests) {
    let u: URL;
    try {
      u = new URL(r.url);
    } catch {
      out.push({ rule: 'SYS-SEC-01', url: r.url, reason: 'unparseable URL' });
      continue;
    }
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') continue;
    if (u.protocol === 'chrome-extension:') {
      if (`${u.protocol}//${u.host}` !== ctx.extensionOrigin) out.push({ rule: 'SYS-SEC-01', url: r.url, reason: 'another extension' });
      continue;
    }
    if (u.protocol === 'https:' && ctx.fixtureHosts?.includes(u.host)) continue;
    if (!isAllowedUrl(r.url, ctx.userLlmHosts ?? [])) {
      out.push({ rule: 'SYS-SEC-01', url: r.url, reason: `host ${u.host} (${u.protocol}) is not on the allowlist` });
      continue;
    }
    if (!SCHOLARLY.includes(u.host)) continue;
    const reasons: string[] = [];
    if (r.method !== 'GET') reasons.push(`${r.method} to a scholarly host`);
    for (const key of new Set(u.searchParams.keys())) if (!SCHOLARLY_PARAMS.has(key)) reasons.push(`query parameter "${key}"`);
    const payload = decode(r.url) + (r.postData ? decode(r.postData) : '');
    for (const v of ctx.forbiddenValues ?? []) if (v && payload.includes(v)) reasons.push('contains a forbidden value (page URL or title)');
    if (RUN_ID.test(payload)) reasons.push('contains a runId');
    if (reasons.length > 0) out.push({ rule: 'SYS-SEC-02', url: r.url, reason: reasons.join('; ') });
  }
  return out;
}
