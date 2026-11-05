/**
 * Licence policy (CLAUDE.md rule 8, ADR-0004, SYS-SEC-30).
 * Runtime: MIT, BSD, Apache-2.0, ISC only. Dev-only may also use MPL-2.0 and the other permissive
 * licences listed below. Anything else (GPL family, SSPL, unknown, missing) fails. Adding a licence
 * to DEV_EXTRA needs a dependency-register entry.
 */
export interface LockPackage {
  license?: string;
  dev?: boolean;
  devOptional?: boolean;
  link?: boolean;
}
export interface Violation {
  pkg: string;
  license: string;
  scope: 'runtime' | 'dev';
  reason: string;
}

const RUNTIME_OK = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD']);
const DEV_EXTRA = new Set(['MPL-2.0', 'BlueOak-1.0.0', 'CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'Python-2.0', 'Unlicense']);

/** Evaluates an SPDX expression (ids, AND, OR, WITH, parentheses). Unknown syntax fails closed. */
export function isAllowed(expression: string | undefined, scope: 'runtime' | 'dev'): boolean {
  if (!expression) return false;
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const okId = (id: string) => RUNTIME_OK.has(id) || (scope === 'dev' && DEV_EXTRA.has(id));
  const parseOr = (): boolean => {
    let v = parseAnd();
    while (tokens[i] === 'OR') {
      i++;
      const r = parseAnd();
      v = v || r;
    }
    return v;
  };
  const parseAnd = (): boolean => {
    let v = parseAtom();
    while (tokens[i] === 'AND') {
      i++;
      const r = parseAtom();
      v = v && r;
    }
    return v;
  };
  const parseAtom = (): boolean => {
    const tok = tokens[i++];
    if (tok === '(') {
      const v = parseOr();
      if (tokens[i++] !== ')') throw new Error('unbalanced');
      return v;
    }
    if (tok === undefined || tok === ')' || tok === 'AND' || tok === 'OR') throw new Error('syntax');
    if (tokens[i] === 'WITH') i += 2; // exceptions only widen permissions
    return okId(tok);
  };
  try {
    const v = parseOr();
    return i === tokens.length && v;
  } catch {
    return false;
  }
}

export function checkLockfile(lock: { packages: Record<string, LockPackage> }): Violation[] {
  const out: Violation[] = [];
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (path === '' || pkg.link) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const scope = pkg.dev ? 'dev' : 'runtime';
    if (!isAllowed(pkg.license, scope)) {
      out.push({ pkg: name, license: pkg.license ?? '(missing)', scope, reason: `licence not allowed for ${scope} dependencies` });
    }
  }
  return out;
}
