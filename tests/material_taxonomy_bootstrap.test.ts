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
    // 60 at phase 08: forgefold_plating, wyrmhide_cording, sunspun_bolt, and
    // wyrmfall_core derived IN with their apex consumers. 60 -> 64 at
    // phase 09: duskforged_billet, precision_chassis, prismglass_setting,
    // and sablewax_vellum derived IN as the APEX_GEAR_RECIPES reagents.
    // 64 -> 66 at phase 10: lucent_reagent through the ENCHANT half of the
    // reagent union, and seasoned_stock through the recipe half as the apex
    // cooking reagent (APEX_CONSUMABLE_RECIPES). 66 -> 93 at the farming
    // absorb (masterwrought Phase 11d): farming's 27 junk-kind ids derive IN
    // (eight crop trios of seed, produce, and fine twin, plus withered_husks,
    // compost, and growth_tonic). 93 -> 105 at Phase 11e, which widens the
    // upper tiers to four crops each: four more trios, twelve more ids. The
    // count is a literal because this file may not import the tables to
    // derive it: importing anything else from src/sim is exactly what the
    // premise arm below forbids, so the number is re-pinned by hand whenever
    // the set moves.
    // 108 since masterwrought Phase 11i's three high-band catches, which derive
    // IN through the recipe-reagent source table like the six catches before
    // them. The capstone feast does NOT: it is a placeable, not a material.
    // 108 -> 116 at masterwrought Phase 11l: the eight promoted trophy drops
    // (poor junk turned common) derive IN as the TROPHY_RECIPES reagents.
    // 116 -> 118 at the same phase's second review round: the two
    // already-common leather trophies (emberwing_cinderscale,
    // old_cragmaws_pelt) derive IN the same way once their recipes land.
    // 118 -> 117 at the phase's sixth fix round, which output-excluded the
    // chipped tusk (its weaponcrafting row deleted, the def poor again), so
    // it derives OUT like the other survivors.
    // 117 -> 115 at the 11l QA, which excluded the cracked fetish and the
    // bogiron nugget under the tusk standard (their rows deleted, the defs
    // poor again), so both derive OUT like the other survivors.
    // 115 -> 116 at masterwrought Phase 11o: cogwheel_blank, the junk-kind
    // engineering on-ramp part, derives IN as a chassis and ocular reagent.
    expect(MATERIAL_ITEM_IDS.size).toBe(116);
    expect(MATERIAL_ITEM_IDS.has('iron_ore')).toBe(true);
    expect(MATERIAL_ITEM_IDS.has('arcanite_bar')).toBe(true);
    // The farming source specifically, because it is the newest and the one
    // whose own module is reached FIRST on this path: a source that failed to
    // derive during bootstrap would leave the size short, but naming an id
    // says WHICH loop broke instead of only that the total drifted.
    expect(MATERIAL_ITEM_IDS.has('vale_wheat')).toBe(true);
    expect(MATERIAL_ITEM_IDS.has('withered_husks')).toBe(true);
    expect(MATERIAL_ITEM_IDS.has('compost')).toBe(true);
    expect(MATERIAL_ITEM_IDS.has('growth_tonic')).toBe(true);
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
