export const RELEASE_MINT_USAGE = 'usage: node scripts/release_mint.mjs vX.Y.Z [--dry-run]';

/**
 * @param {string[]} args
 * @returns {{ version: string, dryRun: boolean, releaseRef: string }}
 */
export function parseReleaseMintArgs(args) {
  const dryRunCount = args.filter((arg) => arg === '--dry-run').length;
  const unknownFlags = args.filter((arg) => arg.startsWith('--') && arg !== '--dry-run');
  const versions = args.filter((arg) => !arg.startsWith('--'));
  if (
    dryRunCount > 1 ||
    unknownFlags.length > 0 ||
    versions.length !== 1 ||
    args.length !== 1 + dryRunCount ||
    !/^v\d+\.\d+\.\d+$/.test(versions[0])
  ) {
    throw new Error(RELEASE_MINT_USAGE);
  }
  const version = versions[0];
  return {
    version,
    dryRun: dryRunCount === 1,
    releaseRef: `refs/heads/release/${version}`,
  };
}

/**
 * Match the documented ref-pattern subset without claiming support for every
 * Ruby File.fnmatch extension accepted by GitHub. An unrecognized exclusion is
 * handled conservatively by requiredChecksCoverage.
 *
 * @param {unknown} pattern
 * @param {string} ref
 * @returns {boolean | null}
 */
function matchRefPattern(pattern, ref) {
  if (typeof pattern !== 'string') return null;
  if (pattern === '~ALL') return true;
  if (pattern === '~DEFAULT_BRANCH') return false;
  if (pattern.startsWith('~') || /[[\]{}\\]/.test(pattern) || /\*{3,}/.test(pattern)) return null;

  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          // Ruby File.fnmatch with FNM_PATHNAME lets `**/` consume zero or
          // more complete path segments. Keep the slash inside the optional
          // group so a zero-segment match does not leave a doubled slash.
          source += '(?:[^/]+/)*';
          i += 2;
        } else {
          // Without a following slash Ruby FNM_PATHNAME keeps `**`
          // segment-local, the same boundary as `*`.
          source += '[^/]*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`).test(ref);
}

/**
 * @param {unknown} ruleset
 * @param {string} releaseRef
 * @returns {{ covered: boolean, reason: string }}
 */
export function requiredChecksCoverage(ruleset, releaseRef) {
  if (!ruleset || typeof ruleset !== 'object') {
    return { covered: false, reason: 'required-checks ruleset response is not an object' };
  }
  if (ruleset.target !== 'branch') {
    return {
      covered: false,
      reason: `required-checks ruleset target is ${JSON.stringify(ruleset.target)}`,
    };
  }
  if (ruleset.enforcement !== 'active') {
    return {
      covered: false,
      reason: `required-checks ruleset enforcement is ${JSON.stringify(ruleset.enforcement)}`,
    };
  }
  if (
    !Array.isArray(ruleset.rules) ||
    !ruleset.rules.some((rule) => rule?.type === 'required_status_checks')
  ) {
    return {
      covered: false,
      reason: 'required-checks ruleset has no required_status_checks rule',
    };
  }

  const include = ruleset.conditions?.ref_name?.include;
  const exclude = ruleset.conditions?.ref_name?.exclude;
  if (!Array.isArray(include) || !Array.isArray(exclude)) {
    return {
      covered: false,
      reason: 'required-checks ref_name include/exclude must both be arrays',
    };
  }
  if (!include.some((pattern) => matchRefPattern(pattern, releaseRef) === true)) {
    return {
      covered: false,
      reason: `required-checks include ${JSON.stringify(include)} does not cover ${releaseRef}`,
    };
  }

  const blockingExclude = exclude.find((pattern) => matchRefPattern(pattern, releaseRef) !== false);
  if (blockingExclude !== undefined) {
    return {
      covered: false,
      reason:
        `required-checks exclude pattern ${JSON.stringify(blockingExclude)} matches ` +
        `or cannot be proven not to match ${releaseRef}`,
    };
  }
  return { covered: true, reason: 'active include covers the ref with no matching exclusion' };
}
