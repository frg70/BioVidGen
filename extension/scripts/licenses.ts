/** npm run licenses — licence gate over package-lock.json (SYS-SEC-30). Exit 1 on any violation. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkLockfile, type LockPackage } from './licenses-lib';

const lock = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package-lock.json'), 'utf8')) as { packages: Record<string, LockPackage> };
const counts = new Map<string, number>();
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (path === '') continue;
  const key = `${pkg.dev ? 'dev    ' : 'runtime'}  ${pkg.license ?? '(missing)'}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
for (const [key, n] of [...counts].sort()) console.log(`${String(n).padStart(4)}  ${key}`);

const violations = checkLockfile(lock);
if (violations.length > 0) {
  console.error(`\nLicence gate FAILED (${violations.length}):`);
  for (const v of violations) console.error(`  ${v.pkg} [${v.scope}] ${v.license}: ${v.reason}`);
  process.exit(1);
}
console.log(`\nLicence gate passed: ${Object.keys(lock.packages).length - 1} packages checked.`);
