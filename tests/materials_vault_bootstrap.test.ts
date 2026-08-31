// The materials_vault module must load cleanly when it is the FIRST src/sim
// module an entry evaluates: it runtime-imports data.ts plus five content
// tables for the material-id derivation, but derives LAZILY (memoized on first
// call), so nothing runs inside data.ts's own evaluation cycle. Every other
// suite that touches the vault imports the Sim (and so data.ts) first; only
// this file proves the module survives being reached ahead of the tables'
// own importers, the exact module-evaluation hazard that put its sibling
// material_taxonomy.ts under guard (see material_taxonomy_bootstrap.test.ts,
// this file's template). IMPORT ORDER IS THE TEST, and the self-scan arm
// below enforces it: biome's import sorter would place a future
// '../src/sim/data' import ABOVE the module and silently retire the premise
// while everything stayed green.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { vaultMaterialIds } from '../src/sim/materials_vault';

describe('materials_vault as the first-evaluated sim module', () => {
  it('derives the full material set with no import of data.ts ahead of it', () => {
    const ids = vaultMaterialIds();
    expect(ids.size).toBe(56);
    expect(ids.has('iron_ore')).toBe(true);
    expect(ids.has('arcanite_bar')).toBe(true);
    expect(ids.has('guardian_core')).toBe(false);
  });

  it('the premise holds: this file runtime-imports exactly one src/sim module', () => {
    // Type-only imports are erased at build time and cannot disturb the
    // evaluation order, so only runtime import statements are counted.
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const runtimeSimImports = [
      ...self.matchAll(/^import (?!type )[^;]*?from '([^']*\/src\/sim\/[^']*)';$/gm),
    ].map((m) => m[1]);
    expect(runtimeSimImports).toEqual(['../src/sim/materials_vault']);
    // The from-clause scan above misses the two other runtime forms, so pin
    // their absence explicitly: a bare side-effect import or a dynamic
    // import() of a sim module would equally retire the premise.
    expect(/^import\s+'[^']*\/src\/sim\//m.test(self)).toBe(false);
    expect(/\bimport\(\s*'[^']*\/src\/sim\//.test(self)).toBe(false);
  });
});
