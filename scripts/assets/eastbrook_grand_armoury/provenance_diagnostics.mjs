// Failure diagnostics for the Eastbrook composite polish provenance: the
// Phase 6 (CI/CD performance packet) answer to the 2026-08-05 divergence
// incident. Root cause, proven by recomputing the craft-cast merge's (#2965,
// 4fea9babb0) composite from its own committed tree: the merge ran
// remint_polish_provenance.mjs and src/render/renderer.ts then moved AGAIN
// before the merge was committed, so the committed pin (628f66e2...) matched
// a tree that never existed. Every pristine checkout computed 09f6f78b...,
// exactly one leaf apart (runtimeRender.renderer.sha256). Local full gates
// always run the polish suites while selective CI runs skip them unless the
// diff reaches them, which is what dressed a stale pin up as a "local vs CI
// divergence".
//
// The composite is computed from WORKING-TREE bytes by design: a mint must
// be able to seal uncommitted edits that will be committed with it. What was
// missing is legibility, and this module carries it for both the failing
// tests and the remint tool: WHICH leaf moved (against the committed
// evidence seals), whether any fingerprinted input differs from HEAD right
// now (the stale-mint hazard), and the exact one-step remint command.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The one-step re-mint the failure messages point at. */
export const REMINT_COMMAND =
  'node scripts/assets/eastbrook_grand_armoury/remint_polish_provenance.mjs';

/**
 * The committed evidence seal the diagnostics diff against, one constant so
 * the failing test, the remint tool, and the unit suite cannot drift onto
 * three different paths.
 */
export const POLISH_SEAL_PATH =
  'docs/screenshots/eastbrook-vale-rebuild/polish/metadata/after-desktop-ultra.json';

/**
 * Leaf-by-leaf diff of two provenance component trees (the sealed one from
 * the committed evidence, the computed one from this tree). Returns dotted
 * key paths so the diverged input is named directly, the exact analysis that
 * localized the craft-cast incident to renderer.ts.
 *
 * @param {Record<string, unknown>} sealed
 * @param {Record<string, unknown>} computed
 * @returns {Array<{ key: string, sealed: unknown, computed: unknown }>}
 */
export function diffProvenanceComponents(sealed, computed) {
  /** @type {Array<{ key: string, sealed: unknown, computed: unknown }>} */
  const diffs = [];
  const walk = (a, b, prefix) => {
    for (const key of Object.keys(a ?? {})) {
      const sealedValue = a?.[key];
      const computedValue = b?.[key];
      if (sealedValue !== null && typeof sealedValue === 'object') {
        walk(sealedValue, computedValue ?? {}, `${prefix}${key}.`);
      } else if (sealedValue !== computedValue) {
        diffs.push({
          key: `${prefix}${key}`,
          sealed: sealedValue ?? null,
          computed: computedValue ?? null,
        });
      }
    }
    // Symmetric arm: a leaf that exists only on the COMPUTED side (the
    // composite gained an input, or a schema bump added a branch) must be
    // named too; a one-directional walk would report zero diffs and the
    // formatter would then wrongly blame a hand-edited pin.
    for (const key of Object.keys(b ?? {})) {
      if (a !== null && a !== undefined && Object.hasOwn(a, key)) continue;
      const computedValue = b[key];
      if (computedValue !== null && typeof computedValue === 'object') {
        walk({}, computedValue, `${prefix}${key}.`);
      } else {
        diffs.push({ key: `${prefix}${key}`, sealed: null, computed: computedValue ?? null });
      }
    }
  };
  walk(sealed, computed, '');
  return diffs;
}

/**
 * Every repo-relative file whose bytes feed the composite: the direct
 * provenance inputs (minus the captureContract entry, which is a contract id,
 * not a path) plus the GLB source-fingerprint file lists (which carry
 * pnpm-lock.yaml and the exporter sources).
 *
 * @param {{
 *   inputs: Record<string, string>,
 *   sourceFileLists?: ReadonlyArray<readonly string[]>,
 * }} opts
 * @returns {string[]}
 */
export function collectPolishProvenanceInputPaths({ inputs, sourceFileLists = [] }) {
  const paths = new Set();
  for (const [key, value] of Object.entries(inputs)) {
    // captureContract is a contract id, not a path; the shape guard backs
    // the name up so a future non-path entry cannot slip into the git
    // pathspecs (every real input carries a slash or an extension dot).
    if (key === 'captureContract' || !/[/.]/.test(value)) continue;
    paths.add(value);
  }
  for (const list of sourceFileLists) {
    for (const p of list) paths.add(p);
  }
  return [...paths].sort();
}

/**
 * Raw `git status --porcelain` lines for the given paths (worktree or index
 * differing from HEAD), or null when git is unavailable so the caller can
 * say so instead of silently claiming a clean tree.
 *
 * @param {{
 *   repoRoot: string,
 *   paths: readonly string[],
 *   runGit?: (args: string[], cwd: string) => string,
 * }} opts
 * @returns {string[] | null}
 */
export function gitDirtyStatusLines({ repoRoot, paths, runGit = defaultRunGit }) {
  try {
    // --no-optional-locks (a global option, so it precedes the subcommand)
    // keeps the status read strictly a read: without it git refreshes
    // .git/index stat data, which both mutates repo state from a test
    // process and contends with any concurrent git in a sibling worktree.
    const output = runGit(
      ['--no-optional-locks', 'status', '--porcelain', '--', ...paths],
      repoRoot,
    );
    return output.split('\n').filter((line) => line.length > 0);
  } catch {
    return null;
  }
}

/**
 * The real git runner, exported (with an injectable exec) so its hardening
 * options are pinnable: bounded and quiet, because this runs on the
 * synchronous path of a vitest worker, where a blocked git (index.lock
 * contention, a stalled filesystem) would freeze the event loop past every
 * test timeout and lose the diagnostic entirely; the deadline lands it in
 * the null arm instead. stderr is dropped so a fatal from an unusual
 * checkout cannot muddy the failure log the caller is about to print.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @param {typeof execFileSync} execImpl
 * @returns {string}
 */
export function defaultRunGit(args, cwd, execImpl = execFileSync) {
  return execImpl('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * The full mismatch explanation: computed vs pinned fingerprint, the moved
 * leaves against the committed evidence seals, the dirty-input verdict that
 * separates "your tree differs from HEAD" (fix the tree or commit the exact
 * bytes; a mint now can go stale) from "the committed tree computes a new
 * value everywhere" (a re-mint is legitimate), and the one-step command.
 *
 * @param {{
 *   pinnedFingerprint: string,
 *   computed: { fingerprint: string, components: Record<string, unknown> },
 *   sealedComponents?: Record<string, unknown> | null,
 *   dirtyStatusLines?: string[] | null,
 * }} opts
 * @returns {string}
 */
export function formatPolishProvenanceMismatch({
  pinnedFingerprint,
  computed,
  sealedComponents = null,
  dirtyStatusLines = null,
}) {
  const lines = [
    'Eastbrook polish composite fingerprint mismatch.',
    `  computed from this tree: ${computed.fingerprint}`,
    `  pinned in the test:      ${pinnedFingerprint}`,
  ];
  if (sealedComponents) {
    const diffs = diffProvenanceComponents(sealedComponents, computed.components);
    if (diffs.length === 0) {
      lines.push(
        '  every leaf matches the committed evidence seals: the pin literal alone is stale',
        '  (the seals and the pin move together in a re-mint, so suspect a hand edit).',
      );
    } else {
      const show = (value) =>
        value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
      lines.push('  inputs that moved (leaves differing from the committed evidence seals):');
      for (const diff of diffs) {
        lines.push(
          `    ${diff.key}`,
          `      sealed:   ${show(diff.sealed)}`,
          `      computed: ${show(diff.computed)}`,
        );
      }
    }
  }
  if (dirtyStatusLines === null) {
    lines.push('  git status unavailable: could not check the inputs for uncommitted edits.');
  } else if (dirtyStatusLines.length > 0) {
    lines.push(
      '  WARNING: fingerprinted inputs differ from HEAD in this working tree:',
      ...dirtyStatusLines.map((line) => `    ${line}`),
      '  A re-mint now seals THESE bytes and matches the committed tree only if exactly',
      '  these bytes land in the same commit. If an input moves again after minting, the',
      '  pin goes stale for every checkout (the 2026-08-05 craft-cast pin failed exactly',
      '  this way: renderer.ts moved after the mint).',
    );
  } else {
    lines.push(
      '  every fingerprinted input matches HEAD: this committed tree computes the value',
      '  above everywhere (local and CI), the pin is stale, and a re-mint is legitimate.',
    );
  }
  lines.push(
    '  One-step re-mint (recomputes all three pinned literals and sweeps the evidence seals):',
    `    ${REMINT_COMMAND}`,
  );
  return lines.join('\n');
}

/**
 * The mint-time input-status verdict the remint tool prints, extracted here
 * so its three arms (dirty, clean, git-unavailable) are unit-tested instead
 * of living as inline console logic only a source-text pin could see.
 *
 * @param {string[] | null} dirtyStatusLines
 * @returns {string[]}
 */
export function formatMintInputStatus(dirtyStatusLines) {
  if (dirtyStatusLines === null) {
    return [
      'git status unavailable: could not check the fingerprinted inputs for',
      'uncommitted edits; verify by hand before committing the new pins.',
    ];
  }
  if (dirtyStatusLines.length > 0) {
    return [
      'WARNING: fingerprinted inputs differ from HEAD in this working tree:',
      ...dirtyStatusLines.map((line) => `  ${line}`),
      'This mint seals THESE bytes. Commit exactly these bytes with the new pins,',
      'and RE-RUN this tool if any of them moves again before the commit (the',
      '2026-08-05 craft-cast pin went stale exactly that way: renderer.ts moved',
      'after the mint).',
    ];
  }
  return [
    'every fingerprinted input matches HEAD: this mint reproduces on any checkout',
    'of the committed tree.',
  ];
}

function defaultReadSeal(absolutePath) {
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

/**
 * The whole failure-branch composition in one tested place: read the
 * committed seal (fail-soft to the no-seal arm), collect the fingerprinted
 * input paths, take the git dirty verdict, and format the report. The
 * capture-contract suite calls exactly this on a pin mismatch, so the glue
 * that only ever executes when a pin is already stale is unit-testable with
 * injected seal-reader and git.
 *
 * @param {{
 *   pinnedFingerprint: string,
 *   computed: { fingerprint: string, components: Record<string, unknown> },
 *   repoRoot: string,
 *   inputs: Record<string, string>,
 *   sourceFileLists?: ReadonlyArray<readonly string[]>,
 *   readSeal?: (absolutePath: string) => unknown,
 *   runGit?: (args: string[], cwd: string) => string,
 * }} opts
 * @returns {string}
 */
export function buildPolishProvenanceMismatchReport({
  pinnedFingerprint,
  computed,
  repoRoot,
  inputs,
  sourceFileLists = [],
  readSeal = defaultReadSeal,
  runGit,
}) {
  // A missing or malformed seal must degrade to the no-seal arm, never
  // replace the diagnostic with a bare filesystem error on the one path
  // where the message matters.
  let sealedComponents = null;
  try {
    const seal = readSeal(path.join(repoRoot, POLISH_SEAL_PATH));
    sealedComponents = seal?.polishProvenance?.components ?? null;
  } catch {
    sealedComponents = null;
  }
  const inputPaths = collectPolishProvenanceInputPaths({ inputs, sourceFileLists });
  const dirtyStatusLines = gitDirtyStatusLines({
    repoRoot,
    paths: inputPaths,
    ...(runGit ? { runGit } : {}),
  });
  return formatPolishProvenanceMismatch({
    pinnedFingerprint,
    computed,
    sealedComponents,
    dirtyStatusLines,
  });
}
