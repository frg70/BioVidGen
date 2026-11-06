import { z } from 'zod';
import { BACKEND_HOST } from '../core/egress';
import type { Http } from '../core/http';
import { createDefaultHttp } from '../core/http';
import { err, ok, type Result } from '../core/result';
import type { RunId } from '../core/runid';

/**
 * The extension's way to the local backend (ADR-0010 step 3, docs/impl-plans/be1-extension-client.md).
 *
 * Codes: BACKEND_OFF (nothing, or something else, answers on the port) · WRONG_ORIGIN (the backend runs but does not
 * allow this extension's id) · UNPAIRED (no token stored) · TOKEN_REJECTED (401) · BAD_TOKEN_FORMAT (typed input is
 * not a token).
 *
 * The token is a secret (rule 2): it lives in chrome.storage.local, goes only into the X-BVG-Token header of API
 * calls, and is never returned or logged.
 */
export type BackendCode = 'BACKEND_OFF' | 'WRONG_ORIGIN' | 'UNPAIRED' | 'TOKEN_REJECTED' | 'BAD_TOKEN_FORMAT';
export type BackendResult = Result<null, BackendCode>;

export interface TokenStore {
  get(): Promise<unknown>;
  set(token: string): Promise<void>;
}

const BASE = `http://${BACKEND_HOST}`;
const TIMEOUT_MS = 2_000; // a local process: anything slower is not going to answer
const TOKEN = /^[0-9a-f]{64}$/;
const HealthSchema = z.object({ ok: z.literal(true), version: z.string() });
const StatusSchema = z.object({ paired: z.literal(true) });

const parses = async (schema: z.ZodType, response: Response) => {
  try {
    return schema.safeParse(await response.json()).success;
  } catch {
    return false;
  }
};

export function createBackendClient(http: Http, tokens: TokenStore) {
  const once = { timeoutMs: TIMEOUT_MS, retry: false } as const;

  async function reachable(): Promise<BackendResult> {
    const health = await http.get(`${BASE}/health`, once);
    if (health.ok) return (await parses(HealthSchema, health.value)) ? ok(null) : err('BACKEND_OFF');
    if (health.code !== 'NETWORK') return err('BACKEND_OFF');
    // A refused Origin and a closed port look the same to a CORS fetch. A no-cors request sends no Origin on a GET,
    // so a running backend answers it. The answer is opaque (status 0): only the fact of it is used.
    const probe = await http.get(`${BASE}/health`, { ...once, mode: 'no-cors' });
    return err(probe.ok || probe.code === 'HTTP_ERROR' ? 'WRONG_ORIGIN' : 'BACKEND_OFF');
  }

  async function authorise(token: string, runId: RunId): Promise<BackendResult> {
    const status = await http.get(`${BASE}/api/v1/status`, { ...once, headers: { 'X-BVG-Token': token, 'X-BVG-Run-Id': runId } });
    if (status.ok) return (await parses(StatusSchema, status.value)) ? ok(null) : err('BACKEND_OFF');
    return err(status.code === 'HTTP_ERROR' && status.status === 401 ? 'TOKEN_REJECTED' : 'BACKEND_OFF');
  }

  return {
    /** Where things stand now. Called when the panel opens and when the student asks to retry. */
    async check(runId: RunId): Promise<BackendResult> {
      const up = await reachable();
      if (!up.ok) return up;
      const token = await tokens.get();
      return typeof token === 'string' && TOKEN.test(token) ? authorise(token, runId) : err('UNPAIRED');
    },
    /** Stores the token only once the backend has accepted it, so a typo never replaces a working one. */
    async pair(raw: string, runId: RunId): Promise<BackendResult> {
      const token = raw.trim();
      if (!TOKEN.test(token)) return err('BAD_TOKEN_FORMAT');
      const accepted = await authorise(token, runId);
      if (accepted.ok) await tokens.set(token);
      return accepted;
    },
  };
}

export type BackendClient = ReturnType<typeof createBackendClient>;

export const createDefaultBackendClient = (tokens: TokenStore): BackendClient => createBackendClient(createDefaultHttp(), tokens);
