// The hud/professions barrel completeness guard (Masterwrought Phase 14 QA):
// src/ui/hud/professions/CLAUDE.md says every module in the family joins
// index.ts in the same change, and until this guard the rule had no teeth
// (the two family-wide seams, denial_line_core and profession_log_tones,
// were the ones missing when the QA round looked). Walks the directory with
// the shared walker and diffs BOTH ways: a module the barrel omits fails,
// and so does a barrel row naming a module that no longer exists. The family
// is FLAT by design (the walker recurses, the barrel's rows are './name'), so
// a nested module fails here permanently on purpose: whoever nests one adds
// its sub-barrel row to index.ts and teaches this diff the nested shape in
// the same change, never by widening the floor.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const FAMILY_DIR = 'src/ui/hud/professions';

function barrelModules(): string[] {
  const src = readFileSync(join(process.cwd(), FAMILY_DIR, 'index.ts'), 'utf8');
  return [...src.matchAll(/^export \* from '\.\/([A-Za-z0-9_]+)';$/gm)].map((m) => m[1]);
}

describe('hud/professions barrel completeness', () => {
  it('re-exports every module in the family, and only modules that exist', () => {
    const onDisk = tsFilesUnder(FAMILY_DIR)
      .map((f) => f.file)
      .filter((file) => file !== 'index.ts' && file.endsWith('.ts'))
      .map((file) => file.replace(/\.ts$/, ''))
      .sort();
    // Vacuity floor: the family is a real directory of modules; a scan that
    // suddenly sees almost nothing is a broken walk, not an empty family.
    expect(onDisk.length).toBeGreaterThan(40);
    const inBarrel = barrelModules().sort();
    expect(inBarrel).toEqual(onDisk);
  });

  it('walks the family through the shared walker only', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});
