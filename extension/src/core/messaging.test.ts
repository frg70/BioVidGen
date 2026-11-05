import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMessaging, defineMessage, type Listener, type RuntimeLike, type SenderLike } from './messaging';
import { err, ok } from './result';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const PANEL: SenderLike = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/sidepanel.html` };
const CONTENT: SenderLike = { id: EXT_ID, url: 'https://journal.example/article/1', tab: { id: 7 } };

/** Minimal chrome.runtime double: delivers to listeners, resolves with the first sendResponse. */
function fakeRuntime(defaultSender: SenderLike = PANEL) {
  const listeners = new Set<Listener>();
  const dispatch = (message: unknown, sender: SenderLike): Promise<unknown> =>
    new Promise((resolve, reject) => {
      let async = false;
      for (const l of listeners) {
        if (l(structuredClone(message), sender, (r) => resolve(structuredClone(r))) === true) async = true;
      }
      if (!async) reject(new Error('Could not establish connection. Receiving end does not exist.'));
    });
  const runtime: RuntimeLike = {
    id: EXT_ID,
    onMessage: { addListener: (l) => void listeners.add(l), removeListener: (l) => void listeners.delete(l) },
    sendMessage: (m) => dispatch(m, defaultSender),
  };
  return { runtime, dispatch, listeners };
}

const Ping = defineMessage('test.ping', z.strictObject({ n: z.number().int() }), z.strictObject({ doubled: z.number() }));

describe('core/messaging', () => {
  it('SVC0-UNIT-14 round trip: validated request reaches the handler and the reply is typed', async () => {
    const { runtime } = fakeRuntime();
    const m = createMessaging(runtime);
    m.handle(Ping, async ({ n }) => ok({ doubled: n * 2 }));
    expect(await m.send(Ping, { n: 21 })).toEqual(ok({ doubled: 42 }));
  });

  it('SYS-SEC-23 message sender check: messages from other extensions or web pages are ignored', async () => {
    const { runtime, dispatch } = fakeRuntime();
    const onReject = vi.fn();
    const handler = vi.fn(async () => ok({ doubled: 0 }));
    createMessaging(runtime, { onReject }).handle(Ping, handler, { allow: 'any' });
    const envelope = { v: 1, name: 'test.ping', payload: { n: 1 } };

    await expect(dispatch(envelope, { id: 'another-extension-id' })).rejects.toThrow(/Receiving end/);
    await expect(dispatch(envelope, { url: 'https://evil.example/' })).rejects.toThrow(/Receiving end/);
    expect(handler).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith('FOREIGN_SENDER', 'test.ping');
  });

  it('SVC0-SEC-02 sender role: a content script cannot call an extension-only handler', async () => {
    const { runtime, dispatch } = fakeRuntime();
    const onReject = vi.fn();
    const handler = vi.fn(async () => ok({ doubled: 0 }));
    createMessaging(runtime, { onReject }).handle(Ping, handler); // default allow: 'extension'
    const reply = await dispatch({ v: 1, name: 'test.ping', payload: { n: 1 } }, CONTENT);
    expect(reply).toEqual(err('FORBIDDEN_SENDER'));
    expect(handler).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith('FORBIDDEN_SENDER', 'test.ping');

    // a page of another extension origin, even with our id spoofed in the URL, is not "extension"
    const spoof = await dispatch({ v: 1, name: 'test.ping', payload: { n: 1 } }, { id: EXT_ID, url: 'https://x.example/', tab: { id: 1 } });
    expect(spoof).toEqual(err('FORBIDDEN_SENDER'));
  });

  it('SYS-SEC-24 Zod on every message: malformed payload → BAD_MESSAGE reply, reject logged, handler not called', async () => {
    const { runtime, dispatch } = fakeRuntime();
    const onReject = vi.fn();
    const handler = vi.fn(async () => ok({ doubled: 0 }));
    createMessaging(runtime, { onReject }).handle(Ping, handler);
    for (const payload of [{ n: '1' }, { n: 1, extra: true }, null, 'n=1']) {
      expect(await dispatch({ v: 1, name: 'test.ping', payload }, PANEL)).toEqual(err('BAD_MESSAGE'));
    }
    expect(handler).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledTimes(4);
    expect(onReject).toHaveBeenCalledWith('BAD_MESSAGE', 'test.ping');
  });

  it('SYS-SEC-24 sender side: invalid outgoing payload is refused locally; invalid reply → BAD_RESPONSE', async () => {
    const { runtime } = fakeRuntime();
    const send = vi.spyOn(runtime, 'sendMessage');
    const m = createMessaging(runtime);
    expect(await m.send(Ping, { n: 1.5 })).toEqual(err('BAD_MESSAGE'));
    expect(send).not.toHaveBeenCalled();

    m.handle(Ping, async () => ok({ doubled: 'two' } as never));
    expect(await m.send(Ping, { n: 1 })).toEqual(err('BAD_RESPONSE'));
  });

  it('SVC0-UNIT-15 handler errors are values; thrown errors become HANDLER_ERROR; no receiver → NO_RECEIVER', async () => {
    const { runtime } = fakeRuntime();
    const m = createMessaging(runtime);
    expect(await m.send(Ping, { n: 1 })).toEqual(err('NO_RECEIVER'));

    const off = m.handle(Ping, async () => err('NO_ARTICLE'));
    expect(await m.send(Ping, { n: 1 })).toEqual(err('NO_ARTICLE'));
    off();

    m.handle(Ping, async () => {
      throw new Error('bug');
    });
    expect(await m.send(Ping, { n: 1 })).toEqual(err('HANDLER_ERROR'));
  });

  it('SVC0-UNIT-16 a handler ignores envelopes for other message names, leaving them to other listeners', async () => {
    const { runtime } = fakeRuntime();
    const m = createMessaging(runtime);
    const Other = defineMessage('test.other', z.strictObject({}), z.strictObject({ ok: z.literal(true) }));
    const ping = vi.fn(async () => ok({ doubled: 0 }));
    m.handle(Ping, ping);
    m.handle(Other, async () => ok({ ok: true as const }));
    expect(await m.send(Other, {})).toEqual(ok({ ok: true }));
    expect(ping).not.toHaveBeenCalled();
  });
});
