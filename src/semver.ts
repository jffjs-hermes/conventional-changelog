import type { ParsedCommit, SemverBump } from './types.js';

// Full semver core with optional prerelease and/or build metadata.
// Metadata identifiers are dot-separated runs of [0-9A-Za-z-] and must be
// non-empty when their marker ('-' or '+') is present.
const VERSION_RE =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const RANK_OF_BUMP: SemverBump[] = ['none', 'patch', 'minor', 'major'];

/**
 * Scans all commits and returns the highest applicable bump.
 * Precedence: major (any breaking) > minor (feat) > patch (fix|perf) > none.
 */
export function computeBump(commits: ParsedCommit[]): SemverBump {
  let rank = 0;
  for (const c of commits) {
    let r = 0;
    if (c.breaking) r = 3;
    else if (c.type === 'feat') r = 2;
    else if (c.type === 'fix' || c.type === 'perf') r = 1;
    if (r > rank) rank = r;
  }
  return RANK_OF_BUMP[rank] ?? 'none';
}

/**
 * Applies a bump to a full semver string. The bump acts on the numeric core;
 * prerelease/build metadata are dropped. On 0.x, a 'major' bump is downgraded
 * to 'minor' (there is no way to reach 1.0.0 from commits alone).
 * Throws RangeError on a malformed current version or an invariant failure
 * (non-safe-integer component).
 */
export function bumpVersion(current: string, bump: SemverBump): string {
  const m = VERSION_RE.exec(current);
  if (!m) throw new RangeError(`invalid version: ${current}`);

  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    throw new RangeError(`invalid version: ${current}`);
  }

  if (bump === 'none') return current;

  // 0.x: breaking (major) bumps minor; there is no 1.0.0 from commits alone.
  let effective: SemverBump = bump;
  if (major === 0 && bump === 'major') effective = 'minor';

  switch (effective) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      return current; // unreachable: 'none' handled above
  }
}
