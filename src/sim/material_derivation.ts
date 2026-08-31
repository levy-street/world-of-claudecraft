// The ONE material-set derivation behind the canonical eager registry in
// material_ids.ts. The UI taxonomy, bags, bank, and vault all read that same
// immutable view, so their classification and identity cannot drift.
//
// This module is deliberately RUNTIME-IMPORT-FREE: every content table arrives
// as a parameter, and the table modules are pulled in with `import type` for
// their typeofs alone (legal on a value binding in a typeof position, and fully
// erased at build time). It must never gain a runtime content dependency: the
// registry supplies fully evaluated tables explicitly and injection tests can
// exercise each source without a parallel derivation implementation.

import type { ENCHANTS } from './content/enchants';
import type { HARVEST_COMPONENT_ITEMS, HARVEST_COMPONENT_SPECIMENS } from './content/professions';
import type { ALL_RECIPES, ITEMS } from './data';
import type { NODE_MATERIAL_TABLE } from './professions/gathering_materials';
import type { MATERIAL_GRADES } from './professions/material_grades';
import type { SALVAGE_MATERIAL_BY_QUALITY } from './professions/salvage_materials';

/** The content tables the material set derives from. Injectable so the
 *  per-source pins in tests/material_taxonomy.test.ts can prove each table is
 *  actually consulted (several sources fully overlap the reagent union today,
 *  so only injection can distinguish a live loop from a dead one). */
export interface MaterialSourceTables {
  nodeMaterialTable: typeof NODE_MATERIAL_TABLE;
  materialGrades: typeof MATERIAL_GRADES;
  harvestComponentItems: typeof HARVEST_COMPONENT_ITEMS;
  harvestComponentSpecimens: typeof HARVEST_COMPONENT_SPECIMENS;
  salvageMaterialByQuality: typeof SALVAGE_MATERIAL_BY_QUALITY;
  recipes: typeof ALL_RECIPES;
  enchants: typeof ENCHANTS;
  recipePendingMaterialItemIds: readonly string[];
  items: typeof ITEMS;
}

/** A runtime-immutable ReadonlySet facade. The mutable Set is closure-private,
 *  and the frozen public object exposes only standard read operations. */
function readonlySetView<T>(values: Iterable<T>): ReadonlySet<T> {
  const backing = new Set(values);
  let view: ReadonlySet<T>;
  view = Object.freeze({
    get size(): number {
      return backing.size;
    },
    has(value: T): boolean {
      return backing.has(value);
    },
    entries(): SetIterator<[T, T]> {
      return backing.entries();
    },
    keys(): SetIterator<T> {
      return backing.keys();
    },
    values(): SetIterator<T> {
      return backing.values();
    },
    forEach(
      callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void,
      thisArg?: unknown,
    ): void {
      backing.forEach((value) => {
        callbackfn.call(thisArg, value, value, view);
      });
    },
    [Symbol.iterator](): SetIterator<T> {
      return backing[Symbol.iterator]();
    },
  });
  return view;
}

export function deriveMaterialItemIds(tables: MaterialSourceTables): ReadonlySet<string> {
  const sources = new Set<string>();
  // Node yields: every zone x node-type harvest grant.
  for (const byZone of Object.values(tables.nodeMaterialTable)) {
    for (const row of Object.values(byZone)) sources.add(row.itemId);
  }
  // Fine grades of the node yields (D8: the tool-outclassed harvest grant).
  for (const row of Object.values(tables.materialGrades)) sources.add(row.fineItemId);
  // Corpse-harvest components and their pristine-specimen jackpots.
  for (const id of Object.values(tables.harvestComponentItems)) sources.add(id);
  for (const id of Object.values(tables.harvestComponentSpecimens)) sources.add(id);
  // Salvage returns (the disenchant arm's outputs, arcane dusts and resonant
  // secondaries, arrive through the reagent union below: every one is consumed
  // by an enchant, the no-dead-end rule disenchant_reagents.ts records).
  for (const id of Object.values(tables.salvageMaterialByQuality)) sources.add(id);
  // Everything a crafting recipe or an enchant consumes. The kind filter below
  // drops tool/rod reagents (kind tool); raw fishing catches are kind junk and
  // stay IN as honest cooking reagents. Only junk-kind reagents are materials.
  for (const recipe of tables.recipes) {
    for (const reagent of recipe.reagents) sources.add(reagent.itemId);
  }
  for (const enchant of Object.values(tables.enchants)) {
    for (const reagent of enchant.reagents) sources.add(reagent.itemId);
  }
  // Materials may arrive ahead of their consuming recipes. This explicit
  // source is temporary by contract and disappears once reagent derivation
  // can classify each id.
  for (const id of tables.recipePendingMaterialItemIds) sources.add(id);
  return readonlySetView([...sources].filter((id) => tables.items[id]?.kind === 'junk'));
}
