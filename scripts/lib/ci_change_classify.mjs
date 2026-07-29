// Pure classification + fail-closed decision logic for the ci.yml `changes`
// job ("Detect code path changes"). The job used to answer "does this PR touch
// the code path set" with a full-history checkout plus `git diff`, which cost
// about 10 serial minutes on every PR (binary-heavy history) and twice wedged
// for 90+ minutes on the checkout step. The answer now comes from the GitHub
// pull request files endpoint (paginated), with the rules extracted here so
// Vitest can pin every branch without a workflow run.
//
// SAFETY DIRECTION: code=true means "run the full PR tier"; code=false means
// "docs-only, skip pr-gate/pr-checks/browser-gate". Every unprovable case
// (non-PR event, missing context, API error, truncated listing, payload
// mismatch, unclassifiable entry) must resolve to code=true. A slow green is
// acceptable; a fast false-green is not.

// The code path set. The first block matches the shell case patterns the
// changes job carried inline before extraction (kept in the same order); a
// shell case `dir/*` matches any path under the directory (case globs cross
// `/`), so directory entries here are prefixes and bare filenames are exact
// top-level matches. The second block widens the set with root-level build
// and supply-chain inputs the inline set missed (flagged in security review
// when the rules became a tested module): every one of these feeds a shipped
// bundle or the install itself, so a change to any of them must reach the
// malware gate and the builds, never skip them as docs.
const CODE_PATH_PREFIXES = Object.freeze([
  'src/',
  'server/',
  'tests/',
  'headless/',
  'bot/',
  'scripts/',
  '.github/workflows/',
  'electron/',
  'android/',
  'ios/',
  'public/',
  // Security-adjacent / deploy surfaces: must not skip malware+builds.
  'deploy/',
  'mediawiki/',
  'Dockerfile.',
  // Widened beyond the old inline set: bundled game data, and the shipped
  // Python RL bindings (scanner-relevant sources nothing else checks).
  'data/',
  'python/',
]);

const CODE_PATH_EXACT = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.admin.json',
  'vite.config.ts',
  'vitest.browser.config.ts',
  'biome.json',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  // Widened beyond the old inline set: the shipped entry documents (they
  // carry inline scripts and third-party tags), the build/install configs,
  // and the deploy-image filter.
  'index.html',
  'play.html',
  'admin.html',
  'guide.html',
  'editor.html',
  'wallet-handoff.html',
  'music_editor.html',
  'svelte.config.js',
  'capacitor.config.ts',
  'tsconfig.bot.json',
  'turbo.json',
  '.npmrc',
  '.browserslistrc',
  '.dockerignore',
]);

// The pull request files endpoint lists at most 3000 files; a listing that
// reaches that ceiling is indistinguishable from a truncated one, so reaching
// it (not just exceeding it) is treated as unprovable.
export const PR_FILES_CAP = 3000;

/**
 * True when the path belongs to the code path set. Anything that is not a
 * classifiable repo-relative string also returns true: an input this predicate
 * cannot read must fail toward the full suite, never toward a skip.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isCodePath(path) {
  if (typeof path !== 'string' || path === '') return true;
  if (CODE_PATH_EXACT.includes(path)) return true;
  return CODE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Classify a full PR file listing. A rename is classified by BOTH ends
 * (`filename` and `previous_filename`). This is deliberately STRICTER than the
 * old `git diff --name-only` classifier: under git's default rename detection
 * that command printed only the destination path, so a file renamed out of the
 * code path set (src/x.ts to docs/x.md) classified as docs-only. The API folds
 * a rename into one entry but keeps the source in `previous_filename`, and a
 * rename out of the code path set still changes the code path set, so both
 * ends are checked. Do not "restore parity" by dropping the second arm.
 *
 * Filenames are attacker-controlled (git allows newlines in paths), and the
 * reason string is echoed into the CI job log where line-leading `::` workflow
 * commands are parsed, so embedded filenames are JSON-escaped.
 *
 * @param {ReadonlyArray<{ filename?: string, previous_filename?: string | null }>} files
 * @returns {{ code: boolean, reason: string }}
 */
export function classifyPrFiles(files) {
  for (const file of files) {
    if (!file || typeof file.filename !== 'string' || file.filename === '') {
      return { code: true, reason: 'unclassifiable file entry: full PR tier (code=true)' };
    }
    if (isCodePath(file.filename)) {
      return {
        code: true,
        reason: `code path change detected (${JSON.stringify(file.filename)}): full PR tier`,
      };
    }
    if (file.previous_filename != null && isCodePath(file.previous_filename)) {
      return {
        code: true,
        reason: `code path change detected (renamed from ${JSON.stringify(file.previous_filename)}): full PR tier`,
      };
    }
  }
  return {
    code: false,
    reason: 'docs-only (or non-code) change: skip pr-gate, pr-checks, browser-gate',
  };
}

/**
 * Fetch the complete changed-file list for a pull request, paginated. Throws
 * on any HTTP error, non-array payload, or a listing that reaches `cap`
 * (the endpoint's ceiling, past which truncation is silent); callers translate
 * a throw into code=true. The loop needs no page budget: a short page returns,
 * a non-array throws, and a server that keeps sending full pages hits the cap
 * throw, so every path terminates.
 *
 * One AbortSignal covers the WHOLE listing, not each page: the enclosing CI
 * job has a 5 minute timeout, and a per-page budget could otherwise let a
 * slow-but-not-erroring API run the job into the hard kill (where dependents
 * skip) instead of the fail-closed code=true path.
 *
 * @param {{
 *   repo: string,
 *   prNumber: number,
 *   token: string,
 *   apiUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   perPage?: number,
 *   cap?: number,
 *   timeoutMs?: number,
 * }} opts
 * @returns {Promise<Array<{ filename?: string, previous_filename?: string | null }>>}
 */
export async function fetchPrFiles({
  repo,
  prNumber,
  token,
  apiUrl = 'https://api.github.com',
  fetchImpl = fetch,
  perPage = 100,
  cap = PR_FILES_CAP,
  timeoutMs = 30_000,
}) {
  /** @type {Array<{ filename?: string, previous_filename?: string | null }>} */
  const files = [];
  const signal = AbortSignal.timeout(timeoutMs);
  for (let page = 1; ; page++) {
    const url = `${apiUrl}/repos/${repo}/pulls/${prNumber}/files?per_page=${perPage}&page=${page}`;
    const res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
    });
    if (!res.ok) {
      throw new Error(`pull request files page ${page} failed: HTTP ${res.status}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch)) {
      throw new Error(`pull request files page ${page} returned a non-array payload`);
    }
    files.push(...batch);
    if (files.length >= cap) {
      throw new Error(
        `pull request lists ${cap} or more files; the listing cannot be proven complete`,
      );
    }
    if (batch.length < perPage) return files;
  }
}

/**
 * The whole decision, fail closed end to end: never throws, and every path
 * that cannot PROVE a docs-only change returns code=true. `reportedCount` is
 * the event payload's `changed_files`; a mismatch against the fetched listing
 * (a push racing the pagination) discards the classification. The docs-only
 * reason carries the listed and reported counts so a suspicious skip can be
 * audited from the job log alone.
 *
 * When the listing was fetched AND survived the count cross-check, it is
 * returned as `files` so the caller can derive further decisions (the
 * selective test mode) from the SAME snapshot instead of a second fetch that
 * could race a push. Every fail-closed path returns no `files`: absence means
 * "you cannot prove anything about this diff", which downstream must treat as
 * full-suite.
 *
 * @param {{
 *   eventName: string,
 *   prNumber: number,
 *   reportedCount?: number,
 *   repo: string,
 *   token: string,
 *   apiUrl?: string,
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<{ code: boolean, reason: string, files?: Array<{ filename?: string, previous_filename?: string | null, status?: string }> }>}
 */
export async function detectCode({
  eventName,
  prNumber,
  reportedCount,
  repo,
  token,
  apiUrl,
  fetchImpl,
}) {
  try {
    if (eventName !== 'pull_request') {
      return { code: true, reason: 'non-PR event: full PR tier (code=true)' };
    }
    if (!repo || !Number.isInteger(prNumber) || prNumber <= 0) {
      return { code: true, reason: 'missing PR context: full PR tier (code=true)' };
    }
    if (!token) {
      return { code: true, reason: 'missing API token: full PR tier (code=true)' };
    }
    const files = await fetchPrFiles({ repo, prNumber, token, apiUrl, fetchImpl });
    if (files.length === 0) {
      return { code: true, reason: 'empty file list: full PR tier (code=true)' };
    }
    if (Number.isInteger(reportedCount) && reportedCount !== files.length) {
      return {
        code: true,
        reason: `listed ${files.length} files but the event reports ${reportedCount}: full PR tier (code=true)`,
      };
    }
    const result = classifyPrFiles(files);
    if (!result.code) {
      const reported = Number.isInteger(reportedCount) ? reportedCount : 'n/a';
      return {
        code: false,
        reason: `${result.reason} (${files.length} files listed; event reports ${reported})`,
        files,
      };
    }
    return { ...result, files };
  } catch (err) {
    // JSON-escaped like the filenames: V8 parse errors embed raw response
    // snippets (newlines included), and this string reaches the CI log.
    const detail = JSON.stringify(err instanceof Error ? err.message : String(err));
    return {
      code: true,
      reason: `changed-file listing failed (${detail}): full PR tier (code=true)`,
    };
  }
}
