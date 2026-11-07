/** Correlation id created per user action in the side panel and passed through every command. */
export type RunId = string & { readonly __brand: 'RunId' };
export const RUN_ID_PATTERN = /^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newRunId(): RunId {
  return `run_${crypto.randomUUID()}` as RunId;
}

export function isRunId(value: unknown): value is RunId {
  return typeof value === 'string' && RUN_ID_PATTERN.test(value);
}
