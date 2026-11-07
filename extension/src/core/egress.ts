/**
 * Outbound host allowlist (CLAUDE.md rule 1, tech-spec-v3 §4.2). Single source for
 * core/http, the SYS-SEC-01 e2e fitness function and (later) the VW3 privacy table (SYS-SEC-05).
 * Hosts are URL.host values (hostname plus non-default port).
 */
export const SCHOLARLY_HOSTS = ['api.openalex.org', 'api.crossref.org', 'www.ebi.ac.uk', 'api.unpaywall.org'] as const;
/** Ollama on the user's machine. Plain http is allowed only here. */
export const LOCAL_LLM_HOSTS = ['localhost:11434'] as const;
export const STATIC_ALLOWED_HOSTS: readonly string[] = [...SCHOLARLY_HOSTS, ...LOCAL_LLM_HOSTS];

const HTTPS_HOSTS: readonly string[] = SCHOLARLY_HOSTS;
const HTTP_HOSTS: readonly string[] = LOCAL_LLM_HOSTS;

/**
 * True when `url` may be requested: https to a scholarly host or the user-chosen LLM host,
 * or http to local Ollama. `userLlmHosts` comes from Settings (the chosen provider).
 */
export function isAllowedUrl(url: string, userLlmHosts: readonly string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username !== '' || u.password !== '') return false;
  if (u.protocol === 'http:') return HTTP_HOSTS.includes(u.host);
  if (u.protocol === 'https:') return HTTPS_HOSTS.includes(u.host) || userLlmHosts.includes(u.host);
  return false;
}
