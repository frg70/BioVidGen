import { browser } from 'wxt/browser';
import type messages from '../../public/_locales/es/messages.json';

export type MessageKey = keyof typeof messages;
export type GetMessage = (key: string, substitutions?: string | string[]) => string;

/** Builds `t`. A missing message returns the key itself so the gap is visible, never blank. */
export function createT(getMessage: GetMessage): (key: MessageKey, subs?: string | string[]) => string {
  return (key, subs) => {
    const message = getMessage(key, subs);
    return message === '' ? key : message;
  };
}

/** UI strings from _locales (es default, en secondary). */
export const t = createT((key, subs) => browser.i18n.getMessage(key as never, subs));
