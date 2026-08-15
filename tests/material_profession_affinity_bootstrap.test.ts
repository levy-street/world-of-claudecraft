// The material_profession_affinity module must self-bootstrap when it is the
// FIRST src/sim module an entry evaluates: DIRECT_CONSUMERS derives at module
// evaluation by reading the recipe and enchant content tables, so this file
// deliberately imports NOTHING at runtime from src/sim except the module
// itself, making the module the entry point of its whole content closure.
// Every other suite that touches the affinity imports data.ts (via the
// taxonomy or ITEMS) ahead of it, so only this file proves the derive
// survives being reached before the tables' own importers (the
// material_taxonomy_bootstrap.test.ts precedent, same hazard class).
// IMPORT ORDER IS THE TEST, and the self-scan arm below enforces it: biome's
// import sorter would place a future '../src/sim/data' import ABOVE the
// module and silently retire the premise while everything stayed green.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { craftIdsForMaterialItem } from '../src/sim/material_profession_affinity';

describe('material_profession_affinity as the first-evaluated sim module', () => {
  it('derives the consumer sets with no import of data.ts ahead of it', () => {
    expect(craftIdsForMaterialItem('rough_hide')).toEqual([
      'leatherworking',
      'weaponcrafting',
      'armorcrafting',
    ]);
    expect(craftIdsForMaterialItem('fine_iron_ore')).toEqual([
      'engineering',
      'weaponcrafting',
      'armorcrafting',
    ]);
    expect(craftIdsForMaterialItem('arcane_dust')).toEqual(['enchanting']);
    expect(craftIdsForMaterialItem('not_a_real_item')).toEqual([]);
  });

  it('the premise holds: this file runtime-imports exactly one src/sim module', () => {
    // Type-only imports are erased at build time and cannot disturb the
    // evaluation order, so only runtime import statements are counted.
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const runtimeSimImports = [
      ...self.matchAll(/^import (?!type )[^;]*?from '([^']*\/src\/sim\/[^']*)';$/gm),
    ].map((m) => m[1]);
    expect(runtimeSimImports).toEqual(['../src/sim/material_profession_affinity']);
  });
});
