// Pure classifier for how visible a test file's coverage is to Vitest's module
// graph, the thing `vitest related` selects on.
//
// Why this exists. `vitest related <changed sources>` walks the STATIC IMPORT
// graph: a test is selected when it (transitively) imports a changed file. That
// models most of this suite correctly, but a large minority of tests assert over
// content they reach WITHOUT importing it: tests/architecture.test.ts scans
// src/sim/ off disk with readdirSync/readFileSync, tests/ci_workflow.test.ts
// reads .github/workflows/ci.yml, and several suites shell out (execSync) or
// resolve modules dynamically (await import(expr)). None of those edges exist in
// the module graph, so `related` can never select them from a source change.
//
// The failure mode is silent: a missed test does not error, it simply does not
// run, and the gate still prints PASS. So the selective gate never relies on the
// graph alone. It ALWAYS runs every test this module classifies as reaching
// outside the graph, and only uses `related` for the remainder.
//
// Classes:
//   'blind'   reaches outside the graph AND imports nothing from src/ or
//             server/. `related` can NEVER select it from a source change.
//   'partial' reaches outside the graph AND imports source. `related` selects it
//             SOMETIMES, which is more dangerous than never: the import half of
//             its assertions can match while the scanning half silently does
//             not, so selection looks like it is working.
//   'graph'   pure imports. `related` models it correctly.
//
// 'blind' and 'partial' both land in the always-run set; the split is reported
// only so the guard test can explain WHY a file needs to be there.

/**
 * Ways a test reaches content the static import graph does not cover.
 * Each entry is [label, regex]. Kept as source-text patterns (not an AST walk)
 * deliberately: this list is a floor, not a proof of completeness, and a cheap
 * over-broad match costs one extra always-run file while a missed one costs a
 * silently skipped test.
 */
export const OUT_OF_GRAPH_PATTERNS = Object.freeze([
  ['readFileSync', /\breadFileSync\s*\(/],
  ['readdirSync', /\breaddirSync\s*\(/],
  ['globSync', /\bglobSync\s*\(/],
  ['readdir', /\breaddir\s*\(/],
  // existsSync alone is enough: tests/held_weapon_models.test.ts asserts every
  // weapon GLB and JPG exists under public/ and otherwise classifies as graph,
  // so deleting an asset (a nonCode path, no related expansion) would fail the
  // full gate and pass the selective one.
  ['existsSync', /\bexistsSync\s*\(/],
  ['fs/promises', /from\s*['"]node:fs\/promises['"]|from\s*['"]fs\/promises['"]/],
  // Whole-module fs / child_process imports, so a helper alias or a destructure
  // this list does not name by function still counts as reaching outside.
  ['node:fs', /from\s*['"]node:fs['"]|require\(\s*['"]node:fs['"]\s*\)/],
  [
    'node:child_process',
    /from\s*['"]node:child_process['"]|require\(\s*['"]node:child_process['"]\s*\)/,
  ],
  ['import.meta.glob', /import\.meta\.glob\s*\(/],
  ['execSync', /\bexecSync\s*\(/],
  // execFileSync is the form tests/i18n_resolved_equivalence.test.ts uses to
  // drive the real i18n build (execFileSync(process.execPath, [buildScript])),
  // so without it a scripts/i18n_build.mjs regression escapes selection.
  // Deliberately still NOT matching a bare `spawn(`: this sim has mob spawners
  // (tests/mob_rally.test.ts) and that would be a large false-positive class.
  ['execFileSync', /\bexecFileSync\s*\(/],
  ['spawnSync', /\bspawnSync\s*\(/],
  ['dynamic-import', /\bawait\s+import\s*\(/],
]);

/**
 * Shared helpers that themselves reach outside the graph. A per-file text scan
 * cannot see through an import, so a test whose fs access lives one hop away in
 * `tests/helpers/*` looks pure: tests/i18n_resolved_equivalence.test.ts delegates
 * its readdirSync/readFileSync to tests/helpers/i18n_determinism. Importing one
 * of these is therefore itself an out-of-graph signal.
 *
 * Derived by scanning the helper directories rather than hand-listed, so a helper
 * that grows an fs call is covered without anyone remembering to update a list.
 */
export const FS_HELPER_DIRS = Object.freeze([
  'tests/helpers',
  'tests/server/helpers',
  'tests/util',
]);

/** Does a shared helper itself reach outside the graph? */
export const HELPER_FS_PATTERN =
  /readFileSync|readdirSync|globSync|existsSync|execFileSync|execSync|spawnSync|from ['"]node:(?:fs|child_process)['"]/;

/**
 * Build the import-matching regex for a set of fs-touching helper module paths.
 *
 * @param {string[]} helperPaths repo-relative, extension stripped
 * @returns {RegExp | null}
 */
export function buildHelperImportPattern(helperPaths) {
  const names = [...new Set((helperPaths ?? []).map((p) => p.split('/').pop()))].filter(Boolean);
  if (names.length === 0) return null;
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`from\\s*['"][^'"]*\\/(?:${alt})['"]`);
}

/** Static imports from the product source trees the graph DOES model. */
const SRC_IMPORT_RE = /from\s*['"](?:\.\.\/)+(?:src|server|headless|bot)\//;

/**
 * @typedef {'blind' | 'partial' | 'graph'} VisibilityClass
 * @typedef {{ klass: VisibilityClass, reasons: string[], srcImports: boolean }} Visibility
 */

/**
 * Classify one test file from its source text.
 *
 * @param {string} source
 * @returns {Visibility}
 */
export function classifyTestSource(source, { helperImportPattern = null } = {}) {
  const text = String(source ?? '');
  const reasons = [];
  for (const [label, re] of OUT_OF_GRAPH_PATTERNS) {
    if (re.test(text)) reasons.push(label);
  }
  if (helperImportPattern && helperImportPattern.test(text)) reasons.push('fs-helper-import');
  const srcImports = SRC_IMPORT_RE.test(text);
  if (reasons.length === 0) return { klass: 'graph', reasons, srcImports };
  return { klass: srcImports ? 'partial' : 'blind', reasons, srcImports };
}

/**
 * True when a test must be run on EVERY selective gate regardless of the diff.
 *
 * @param {VisibilityClass} klass
 * @returns {boolean}
 */
export function requiresAlwaysRun(klass) {
  return klass === 'blind' || klass === 'partial';
}

/**
 * Fold per-file classifications into the always-run set plus a reason index.
 * Sorted so the emitted list is stable across machines and reviewable in a diff.
 *
 * @param {Array<{ file: string, visibility: Visibility }>} entries
 * @returns {{ alwaysRun: string[], reasons: Record<string, string[]>, counts: Record<VisibilityClass, number> }}
 */
export function buildAlwaysRunSet(entries) {
  /** @type {Record<string, string[]>} */
  const reasons = {};
  /** @type {Record<VisibilityClass, number>} */
  const counts = { blind: 0, partial: 0, graph: 0 };
  const alwaysRun = [];
  for (const { file, visibility } of entries) {
    counts[visibility.klass] += 1;
    if (!requiresAlwaysRun(visibility.klass)) continue;
    alwaysRun.push(file);
    reasons[file] = visibility.reasons;
  }
  alwaysRun.sort();
  return { alwaysRun, reasons, counts };
}
