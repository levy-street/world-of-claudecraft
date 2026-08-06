import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SELECTION_PIPELINE_FILES } from '../scripts/lib/ci_test_select.mjs';

const REPO_ROOT = path.resolve(__dirname, '..');

// The CI selection pipeline runs the PR's own copy of its scripts, so any PR
// touching one of them must fall back to the full suite
// (lib/ci_test_select.mjs). That trigger is a literal file list, and a list
// like that rots the day someone adds an import: the new module would decide
// selection without being able to widen on its own changes. This suite
// recomputes the real static import closure of the two CI entries and diffs it
// against the list BOTH ways, so adding, removing, or moving a pipeline module
// fails here until the trigger list says so.

const ENTRIES = ['scripts/detect_code_changes.mjs', 'scripts/ci_shard_test.mjs'];

function importClosure(entries: string[]): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const rel = queue.pop() as string;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const source = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    // Comments stripped first (block then line, same idiom as
    // tests/ci_workflow.test.ts): test_visibility.mjs discusses `await
    // import(expr)` in prose, and a comment must neither trip the
    // dynamic-import ban nor register a phantom import edge.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Static ESM imports only: the pipeline scripts are plain .mjs with no
    // dynamic imports, and the assertion below keeps that true. Both specifier
    // forms count: `from './x.mjs'` AND the bare side-effect `import './x.mjs'`,
    // which a from-only match would let join the pipeline unseen.
    for (const m of code.matchAll(/(?:from\s*|\bimport\s+)['"](\.[^'"]+)['"]/g)) {
      const resolved = path.join(path.dirname(rel), m[1]).split(path.sep).join('/');
      queue.push(resolved);
    }
    expect(code, `${rel} must not import dynamically (the closure walk would miss it)`).not.toMatch(
      /\bimport\s*\(/,
    );
  }
  return [...seen].sort();
}

describe('the selection pipeline trigger list matches the real import closure', () => {
  it('lists exactly the closure of the two CI entries', () => {
    // Both directions on purpose. A closure file missing from the list is a
    // fail-open hole (that module could change selection behavior without
    // widening); a listed file outside the closure is a stale trigger that
    // widens runs for a module no longer involved.
    expect(importClosure(ENTRIES)).toEqual([...SELECTION_PIPELINE_FILES].sort());
  });

  it('keeps both CI entries in the trigger list themselves', () => {
    for (const entry of ENTRIES) {
      expect(SELECTION_PIPELINE_FILES).toContain(entry);
    }
  });

  it('names only files that exist', () => {
    for (const f of SELECTION_PIPELINE_FILES) {
      expect(existsSync(path.join(REPO_ROOT, f)), `${f} is listed but missing`).toBe(true);
    }
  });
});
