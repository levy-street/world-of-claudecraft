// The lit transparent twin of a character rig stays gone. Every translucent
// character look is the spirit veil (src/render/characters/ghost_veil.ts), one
// unlit program family the boot manifest links; the only other effect look,
// Shadowform, is an opaque tint that keeps its source's program. A twin (a
// hook-preserving clone of a rig material with `transparent` flipped on) is a
// second program per rig material and face side that nothing links ahead of
// the swap, which is the cold-link class the veil exists to end.
//
// This is the source half: no module under src/render/characters that clones
// a rig material through cloneMaterialWithHooks writes `.transparent = true`.
// The behaviour half, every effect state on a real CharacterVisual mounting
// only a veil pass or a clone that keeps its source's blend, is
// tests/character_spirit_veil.test.ts ("no effect state reaches a lit
// transparent twin").

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

const CHARACTERS = fileURLToPath(new URL('../src/render/characters', import.meta.url));

/** The files under `root` that clone through the hooks and also flip a
 *  material transparent, plus how many files were read and how many clone. */
function twinWriters(root: string): { offenders: string[]; scanned: number; cloners: number } {
  const offenders: string[] = [];
  let scanned = 0;
  let cloners = 0;
  for (const { file, full } of tsFilesUnder(root)) {
    scanned++;
    const code = stripComments(readFileSync(full, 'utf8'));
    if (!code.includes('cloneMaterialWithHooks(')) continue;
    cloners++;
    if (/\.transparent\s*=\s*true\b/.test(code)) offenders.push(file);
  }
  return { offenders, scanned, cloners };
}

describe('no character module mints a lit transparent twin', () => {
  it('finds no hook clone flipped transparent anywhere under src/render/characters', () => {
    const { offenders, scanned, cloners } = twinWriters(CHARACTERS);
    // the vacuity floor: a real tree, with the modules that do clone rig
    // materials (the Shadowform tint, the surface response, the visual)
    expect(scanned).toBeGreaterThan(80);
    expect(cloners).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });

  it('reads nested directories, and catches a flip in one', () => {
    const root = mkdtempSync(join(tmpdir(), 'twin-guard-'));
    try {
      mkdirSync(join(root, 'nested', 'deeper'), { recursive: true });
      writeFileSync(
        join(root, 'nested', 'deeper', 'twin.ts'),
        'const clone = cloneMaterialWithHooks(source);\nclone.transparent = true;\n',
      );
      writeFileSync(
        join(root, 'tint.ts'),
        'const clone = cloneMaterialWithHooks(source);\n// clone.transparent = true;\n',
      );
      writeFileSync(join(root, 'decal.ts'), 'material.transparent = true;\n');
      const { offenders, scanned, cloners } = twinWriters(root);
      expect(scanned).toBe(3);
      expect(cloners).toBe(2);
      expect(offenders).toEqual(['nested/deeper/twin.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('scans only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});
