import { z } from 'zod';
import { err, ok, type Result } from './result';

/**
 * Typed messaging over chrome.runtime (SVC0 plan §5). Both directions are validated with Zod;
 * the receiver checks `sender.id === runtime.id` and the sender role.
 *
 * Codes: BAD_MESSAGE (payload failed the request schema) · BAD_RESPONSE (reply failed the
 * response schema) · FORBIDDEN_SENDER (right extension, wrong context) · NO_RECEIVER ·
 * HANDLER_ERROR (handler threw). Messages from other extensions or web pages are ignored
 * without a reply (SYS-SEC-23).
 */
export type MessagingCode = 'BAD_MESSAGE' | 'BAD_RESPONSE' | 'FORBIDDEN_SENDER' | 'NO_RECEIVER' | 'HANDLER_ERROR';

export interface MessageDef<Req extends z.ZodType, Res extends z.ZodType> {
  readonly name: string;
  readonly req: Req;
  readonly res: Res;
}
export function defineMessage<Req extends z.ZodType, Res extends z.ZodType>(name: string, req: Req, res: Res): MessageDef<Req, Res> {
  return { name, req, res };
}

export interface SenderLike {
  id?: string;
  url?: string;
  tab?: { id?: number };
}
export type Listener = (message: unknown, sender: SenderLike, sendResponse: (response: unknown) => void) => boolean | undefined;
export interface RuntimeLike {
  readonly id: string;
  readonly onMessage: { addListener(l: Listener): void; removeListener(l: Listener): void };
  sendMessage(message: unknown): Promise<unknown>;
}

/** Who may call a handler: extension pages (side panel, options, worker), content scripts, or both. */
export type SenderRole = 'extension' | 'content' | 'any';
export type RejectCode = 'BAD_MESSAGE' | 'FOREIGN_SENDER' | 'FORBIDDEN_SENDER';

export interface Messaging {
  handle<Req extends z.ZodType, Res extends z.ZodType, C extends string>(
    def: MessageDef<Req, Res>,
    handler: (payload: z.infer<Req>, sender: SenderLike) => Promise<Result<z.infer<Res>, C>>,
    opts?: { allow?: SenderRole },
  ): () => void;
  send<Req extends z.ZodType, Res extends z.ZodType>(def: MessageDef<Req, Res>, payload: z.infer<Req>): Promise<Result<z.infer<Res>, string>>;
}

export interface MessagingOptions {
  /** Called for every rejected inbound message, so the composition root can log it. */
  onReject?: (code: RejectCode, name: string) => void;
}

const Envelope = z.strictObject({ v: z.literal(1), name: z.string().min(1).max(80), payload: z.unknown() });
const Reply = z.union([
  z.strictObject({ ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ ok: z.literal(false), code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), status: z.number().int().optional() }),
]);

/** Classifies a sender. Chrome sets `sender.id` and `sender.url`; pages cannot forge them. */
function roleOf(sender: SenderLike, runtimeId: string): 'extension' | 'content' | 'foreign' | 'unknown' {
  if (sender.id !== runtimeId) return 'foreign';
  if (sender.url?.startsWith(`chrome-extension://${runtimeId}/`)) return 'extension';
  if (sender.tab !== undefined) return 'content';
  return 'unknown';
}

export function createMessaging(runtime: RuntimeLike, opts: MessagingOptions = {}): Messaging {
  return {
    handle(def, handler, handleOpts) {
      const allow = handleOpts?.allow ?? 'extension';
      const listener: Listener = (message, sender, sendResponse) => {
        const env = Envelope.safeParse(message);
        if (!env.success || env.data.name !== def.name) return undefined;
        const role = roleOf(sender, runtime.id);
        if (role === 'foreign') {
          opts.onReject?.('FOREIGN_SENDER', def.name);
          return undefined;
        }
        if (allow !== 'any' && role !== allow) {
          opts.onReject?.('FORBIDDEN_SENDER', def.name);
          sendResponse(err('FORBIDDEN_SENDER'));
          return true;
        }
        const payload = def.req.safeParse(env.data.payload);
        if (!payload.success) {
          opts.onReject?.('BAD_MESSAGE', def.name);
          sendResponse(err('BAD_MESSAGE'));
          return true;
        }
        handler(payload.data, sender).then(
          (r) => sendResponse(r),
          () => sendResponse(err('HANDLER_ERROR')),
        );
        return true;
      };
      runtime.onMessage.addListener(listener);
      return () => runtime.onMessage.removeListener(listener);
    },

    async send(def, payload) {
      const req = def.req.safeParse(payload);
      if (!req.success) return err('BAD_MESSAGE');
      let raw: unknown;
      try {
        raw = await runtime.sendMessage({ v: 1, name: def.name, payload: req.data });
      } catch {
        return err('NO_RECEIVER');
      }
      if (raw === undefined) return err('NO_RECEIVER');
      const reply = Reply.safeParse(raw);
      if (!reply.success) return err('BAD_RESPONSE');
      if (!reply.data.ok) return err(reply.data.code, reply.data.status);
      const value = def.res.safeParse(reply.data.value);
      return value.success ? ok(value.data) : err('BAD_RESPONSE');
    },
  };
}
