/** Feature flags (tech-spec-v3 §7). Build-time defaults; tests and pilot builds pass overrides. */
export const FLAG_DEFAULTS = {
  /** Kill switch for summaries (SVC4 runbook: validity incident). Off until OP5 ships. */
  'summary.enabled': false as boolean,
  'providers.allowed': ['nano', 'ollama', 'openai-compatible'] as readonly string[],
  'lists.sites': [] as readonly string[],
};
export type Flags = typeof FLAG_DEFAULTS;
export type FlagName = keyof Flags;

export function createFlags(overrides: Partial<Flags> = {}): { get<N extends FlagName>(name: N): Flags[N] } {
  const values: Flags = { ...FLAG_DEFAULTS, ...overrides };
  return {
    get(name) {
      if (!Object.hasOwn(values, name)) throw new Error(`Unknown flag: ${String(name)}`);
      return values[name];
    },
  };
}
