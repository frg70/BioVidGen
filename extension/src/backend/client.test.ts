import { describe, expect, it } from 'vitest';
import { createHttp } from '../core/http';
import { createLimiterRegistry, sleep } from '../core/limiter';
import { createLogger, createMemorySink } from '../core/log';
import type { Result } from '../core/result';
import { newRunId } from '../core/runid';
import { createBackendClient, type TokenStore } from './client';

const TOKEN = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const HEALTH = 'http://127.0.0.1:8765/health';
const STATUS = 'http://127.0.0.1:8765/api/v1/status';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Call = { url: string; init: RequestInit };

/** Answers like the real backend: refuses a CORS fetch when `origin` is off, and checks the token. */
function setup(opts: { off?: boolean; originRefused?: boolean; stored?: unknown; validToken?: string; healthBody?: () => Response } = {}) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (opts.off) throw new TypeError('Failed to fetch');
    // An opaque response: the server answered and the browser hides everything about it.
    if (init.mode === 'no-cors') return Response.error();
    if (opts.originRefused) throw new TypeError('Failed to fetch');
    if (url === HEALTH) return opts.healthBody?.() ?? json({ ok: true, version: '0.1.0' });
    const token = new Headers(init.headers).get('X-BVG-Token');
    return token === (opts.validToken ?? TOKEN) ? json({ paired: true }) : json({ error: 'UNAUTHORIZED' }, 401);
  }) as typeof globalThis.fetch;
  const http = createHttp({
    fetch,
    random: () => 0,
    sleep: async () => undefined,
    now: Date.now,
    limiter: createLimiterRegistry({}, 1000, { now: Date.now, sleep }),
  });
  let stored = opts.stored;
  const tokens: TokenStore = {
    get: async () => stored,
    set: async (token) => {
      stored = token;
    },
  };
  return { client: createBackendClient(http, tokens), calls, stored: () => stored };
}

const code = <T,>(r: Result<T, string>) => (r.ok ? 'ok' : r.code);

describe('backend client: states', () => {
  it('BE1-UNIT-01 nothing listening is BACKEND_OFF, and no token is read or sent', async () => {
    const { client, calls } = setup({ off: true, stored: TOKEN });
    expect(code(await client.check(newRunId()))).toBe('BACKEND_OFF');
    expect(calls.map((c) => c.url)).toEqual([HEALTH, HEALTH]);
    expect(calls.some((c) => new Headers(c.init.headers).has('X-BVG-Token'))).toBe(false);
  });

  it('BE1-UNIT-02 a running backend that refuses this extension is WRONG_ORIGIN, not BACKEND_OFF', async () => {
    const { client, calls } = setup({ originRefused: true, stored: TOKEN });
    expect(code(await client.check(newRunId()))).toBe('WRONG_ORIGIN');
    expect(calls.map((c) => c.init.mode)).toEqual([undefined, 'no-cors']);
    expect(calls.some((c) => new Headers(c.init.headers).has('X-BVG-Token'))).toBe(false);
  });

  it('BE1-UNIT-03 no stored token is UNPAIRED, without calling the API', async () => {
    const { client, calls } = setup();
    expect(code(await client.check(newRunId()))).toBe('UNPAIRED');
    expect(calls.map((c) => c.url)).toEqual([HEALTH]);
  });

  it('BE1-UNIT-03 a stored value that is not a token is UNPAIRED and is never sent', async () => {
    for (const stored of [42, 'not-a-token', `${TOKEN}\nX-Evil: 1`, null]) {
      const { client, calls } = setup({ stored });
      expect(code(await client.check(newRunId())), String(stored)).toBe('UNPAIRED');
      expect(calls.map((c) => c.url)).toEqual([HEALTH]);
    }
  });

  it('BE1-UNIT-04 a stored good token is paired; the token goes to the API, not to the public health check', async () => {
    const { client, calls } = setup({ stored: TOKEN });
    const run = newRunId();
    expect(code(await client.check(run))).toBe('ok');
    expect(calls.map((c) => c.url)).toEqual([HEALTH, STATUS]);
    expect(new Headers(calls[0]?.init.headers).has('X-BVG-Token')).toBe(false);
    const api = new Headers(calls[1]?.init.headers);
    expect(api.get('X-BVG-Token')).toBe(TOKEN);
    expect(api.get('X-BVG-Run-Id')).toBe(run);
    expect(calls.every((c) => c.init.method === 'GET' && c.init.body === undefined)).toBe(true);
  });

  it('BE1-UNIT-05 a stored token the backend refuses is TOKEN_REJECTED', async () => {
    const { client } = setup({ stored: OTHER });
    expect(code(await client.check(newRunId()))).toBe('TOKEN_REJECTED');
  });

  it('BE1-UNIT-07 another program on the port is BACKEND_OFF, and it never receives the token', async () => {
    for (const healthBody of [() => new Response('<html>hello</html>'), () => json({ ok: false, version: '1' }), () => json({ ok: true }), () => json({}, 404)]) {
      const { client, calls } = setup({ stored: TOKEN, healthBody });
      expect(code(await client.check(newRunId()))).toBe('BACKEND_OFF');
      expect(calls.map((c) => c.url)).toEqual([HEALTH]);
    }
  });
});

describe('backend client: pairing', () => {
  it('BE1-UNIT-06 a good token is stored only after the backend accepts it; pasted whitespace is dropped', async () => {
    const { client, stored, calls } = setup();
    expect(code(await client.pair(`  ${TOKEN}\r\n`, newRunId()))).toBe('ok');
    expect(stored()).toBe(TOKEN);
    expect(new Headers(calls.at(-1)?.init.headers).get('X-BVG-Token')).toBe(TOKEN);
  });

  it('BE1-UNIT-06 malformed input is BAD_TOKEN_FORMAT: nothing stored, nothing sent', async () => {
    for (const raw of ['', 'abc', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), `${TOKEN} ${TOKEN}`]) {
      const { client, stored, calls } = setup();
      expect(code(await client.pair(raw, newRunId())), raw).toBe('BAD_TOKEN_FORMAT');
      expect(stored()).toBeUndefined();
      expect(calls).toEqual([]);
    }
  });

  it('BE1-UNIT-06 a token the backend refuses is TOKEN_REJECTED and does not replace the stored one', async () => {
    const { client, stored } = setup({ stored: TOKEN });
    expect(code(await client.pair(OTHER, newRunId()))).toBe('TOKEN_REJECTED');
    expect(stored()).toBe(TOKEN);
  });

  it('BE1-UNIT-06 the backend stopping during pairing is BACKEND_OFF, nothing stored', async () => {
    const { client, stored } = setup({ off: true });
    expect(code(await client.pair(TOKEN, newRunId()))).toBe('BACKEND_OFF');
    expect(stored()).toBeUndefined();
  });
});

describe('backend client: secrets', () => {
  it('BE1-SEC-01 the token never reaches a log entry or a result', async () => {
    const sink = createMemorySink();
    const log = createLogger(sink);
    const { client } = setup({ stored: TOKEN });
    const results = [
      await log.op(newRunId(), 'backend.check', () => client.check(newRunId())),
      await log.op(newRunId(), 'backend.pair', () => client.pair(TOKEN, newRunId())),
      await log.op(newRunId(), 'backend.pair', () => client.pair(OTHER, newRunId())),
      await log.op(newRunId(), 'backend.pair', () => client.pair(`${TOKEN}x`, newRunId())),
    ];
    const everything = JSON.stringify([results, await sink.list()]);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(OTHER);
    expect(await sink.list()).toHaveLength(4);
  });

  it('BE1-SEC-02 every request goes to the backend host and carries no credentials or body', async () => {
    const { client, calls } = setup({ stored: TOKEN });
    await client.check(newRunId());
    await client.pair(TOKEN, newRunId());
    for (const c of calls) {
      expect(new URL(c.url).host).toBe('127.0.0.1:8765');
      expect(c.init.credentials).toBe('omit');
      expect(c.init.body).toBeUndefined();
    }
  });
});
