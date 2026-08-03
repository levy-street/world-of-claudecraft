// The material_taxonomy module must self-bootstrap when it is the FIRST
// src/sim module an entry evaluates: MATERIAL_ITEM_IDS derives at module
// evaluation by reading the merged ITEMS table, so this file deliberately
// imports NOTHING at runtime from src/sim except the module itself, making
// the module the entry point of the whole data.ts closure. Every other suite
// that touches the taxonomy imports data.ts first, so only this file proves
// the derive survives being reached before the tables' own importers.
// IMPORT ORDER IS THE TEST, and the self-scan arm below enforces it: biome's
// import sorter would place a future '../src/sim/data' import ABOVE the
// module and silently retire the premise while everything stayed green.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMaterialItem, MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import type { ItemDef } from '../src/sim/types';

describe('material_taxonomy as the first-evaluated sim module', () => {
  it('derives the full set with no import of data.ts ahead of it', () => {
    expect(MATERIAL_ITEM_IDS.size).toBe(45);
    expect(MATERIAL_ITEM_IDS.has('iron_ore')).toBe(true);
    expect(MATERIAL_ITEM_IDS.has('arcanite_bar')).toBe(true);
    expect(isMaterialItem({ id: 'iron_ore' } as ItemDef)).toBe(true);
  });

  it('the premise holds: this file runtime-imports exactly one src/sim module', () => {
    // Type-only imports are erased at build time and cannot disturb the
    // evaluation order, so only runtime import statements are counted.
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const runtimeSimImports = [
      ...self.matchAll(/^import (?!type )[^;]*?from '([^']*\/src\/sim\/[^']*)';$/gm),
    ].map((m) => m[1]);
    expect(runtimeSimImports).toEqual(['../src/sim/material_taxonomy']);
  });
});
