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
  // Any call-form import(), not just the awaited adjacency: a dynamic import
  // wrapped in Promise.all(...) or returned bare is just as invisible to the
  // static graph, and the awaited-only regex missed those forms.
  ['dynamic-import', /\bimport\s*\(/],
  // Third-party fs readers. A test that asserts on the CONTENT of a shipped
  // binary asset through a library (NodeIO GLB reads, sharp image metadata)
  // makes no fs call of its own, so the function patterns above never fire,
  // while an asset-only diff classifies inert and selects no related sources:
  // tests/boar_asset.test.ts, tests/arena_render.test.ts, and
  // tests/continent_map_view.test.ts were all graph-classified escapes until
  // these import signals joined the list (Phase 2 adversarial audit).
  ['gltf-transform', /from\s*['"]@gltf-transform\//],
  ['sharp', /from\s*['"]sharp['"]|require\(\s*['"]sharp['"]\s*\)/],
  // Generated i18n artifacts (the resolved locale slices and the
  // TranslationKey union): the selective planner classifies them into their
  // own never-widen bucket (lib/gate_select_plan.mjs) and feeds the changed
  // artifact paths to `vitest related` as graph nodes, which is what selects
  // their consumers (the artifacts are INSIDE the module graph, and are its
  // most-connected i18n node; the catalog/overlay sources reach the runtime
  // only through type-erased edges). This entry is the BELT over that
  // mechanism, not the mechanism: it floors the handful of suites that
  // name the artifacts in their own text, so a direct consumer keeps running
  // even on PRs whose diff carries no artifact at all, and even if a future
  // import shape ever fell out of vitest's graph walk. Matches the artifact
  // NAMES, not the exact paths: an import specifier is relative
  // ('./i18n.resolved.generated/en') and a moved artifact tree should keep
  // flooring its consumers.
  ['generated-i18n', /i18n\.resolved\.generated|translation_keys\.generated/],
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
  // The parity harness: run_scenarios.ts reads the goldens off disk, and every
  // parity suite delegates through it. Without this entry a golden-only diff
  // left 11 of the 12 parity files unselected by the LOCAL merge bar (CI was
  // already safe via CI_GUARD_PREFIXES).
  'tests/parity',
]);

/**
 * Does a shared helper itself reach outside the graph? Wider than
 * OUT_OF_GRAPH_PATTERNS on the sync-stat family and fs/promises because a
 * helper is one hop from every importer: over-matching costs a few extra
 * always-run files, under-matching silently un-floors every test that
 * delegates its fs access.
 */
export const HELPER_FS_PATTERN =
  /readFileSync|readdirSync|globSync|existsSync|execFileSync|execSync|spawnSync|statSync|lstatSync|opendirSync|readlinkSync|createReadStream|from ['"](?:node:)?fs\/promises['"]|from ['"]node:(?:fs|child_process)['"]/;

/**
 * Build the import-matching regex for a set of fs-touching helper module paths.
 *
 * Matches the helper by basename AND its parent directory as a barrel tail
 * (`from './helpers'`): tests/CLAUDE.md tells contributors to import the
 * shared fakes via the `index.ts` barrel, and a barrel hop must not hide an
 * fs-touching helper (tests/server/helpers/golden.ts re-exported by
 * `export * from './golden'` was invisible to the basename-only match).
 * Deliberately BROAD: once a dir name like `helpers` or `util` joins the
 * alternation, ANY import ending in that segment matches, including ones
 * outside the helper dirs. Over-matching adds a file to the floor; the
 * opposite direction silently un-floors a delegating test.
 *
 * @param {string[]} helperPaths repo-relative, extension stripped
 * @returns {RegExp | null}
 */
export function buildHelperImportPattern(helperPaths) {
  const paths = (helperPaths ?? []).filter(Boolean);
  const names = [
    ...new Set(
      paths.flatMap((p) => {
        const segs = p.split('/');
        return [segs.pop(), segs.pop()];
      }),
    ),
  ].filter(Boolean);
  if (names.length === 0) return null;
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // Optional extension tail: an ESM .mjs/.js helper must be imported WITH its
  // extension, and a name-must-end-the-specifier match would discover such a
  // helper and then never match its importers.
  return new RegExp(`from\\s*['"][^'"]*\\/(?:${alt})(?:\\.[cm]?[jt]s)?['"]`);
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
  if (helperImportPattern?.test(text)) reasons.push('fs-helper-import');
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
