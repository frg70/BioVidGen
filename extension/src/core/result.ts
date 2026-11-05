/** Errors are values: `Result<T, Code>` with a documented string code (CLAUDE.md conventions). */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<C extends string> = { readonly ok: false; readonly code: C; readonly status?: number };
export type Result<T, C extends string> = Ok<T> | Err<C>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <C extends string>(code: C, status?: number): Err<C> =>
  status === undefined ? { ok: false, code } : { ok: false, code, status };
