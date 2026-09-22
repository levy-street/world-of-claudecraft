// The Inner Crucible raid-reward full-body skins: nine class-restricted
// cosmetic bodies, one per class, earned by completing a FULL five-piece
// Crucible tier set of that class (the sets the Crucible Quartermaster sells
// for raid sigils, IGNIVAR_SET_ITEMS in ignivar_loot.ts). Host-agnostic data
// and pure predicates only; the claim itself (server/game.ts
// 'claim_crucible_skin', Sim.claimCrucibleSkin offline) owns the grant.
//
// Cosmetic only: a skin never changes stats. Ownership rides the same
// account-wide full-body-skin list the Founder Pack uses
// (AccountCosmetics.founderSkinIds), so wearing one is the existing
// change_skin path.

import type { PlayerClass, SkinCatalog } from '../types';
import { IGNIVAR_SET_ITEMS } from './ignivar_loot';

export interface CrucibleSkinDef {
  catalog: SkinCatalog;
  requiredClass: PlayerClass;
  /** The Reliquary marker item minted into the collection log on claim. */
  itemId: string;
}

export const CRUCIBLE_SKIN_CATALOG: readonly CrucibleSkinDef[] = [
  { catalog: 'magmaraith', requiredClass: 'warrior', itemId: 'crucible_skin_magmaraith' },
  { catalog: 'ashen_dawn', requiredClass: 'paladin', itemId: 'crucible_skin_ashen_dawn' },
  { catalog: 'craterstalker', requiredClass: 'hunter', itemId: 'crucible_skin_craterstalker' },
  { catalog: 'cinder_thorn', requiredClass: 'rogue', itemId: 'crucible_skin_cinder_thorn' },
  { catalog: 'ember_vestal', requiredClass: 'priest', itemId: 'crucible_skin_ember_vestal' },
  { catalog: 'basalt_maw', requiredClass: 'shaman', itemId: 'crucible_skin_basalt_maw' },
  { catalog: 'emberstone', requiredClass: 'mage', itemId: 'crucible_skin_emberstone' },
  { catalog: 'brimstone_pact', requiredClass: 'warlock', itemId: 'crucible_skin_brimstone_pact' },
  { catalog: 'emberbark', requiredClass: 'druid', itemId: 'crucible_skin_emberbark' },
];

export function crucibleSkinDef(catalog: string): CrucibleSkinDef | null {
  return CRUCIBLE_SKIN_CATALOG.find((def) => def.catalog === catalog) ?? null;
}

export function crucibleSkinByItemId(itemId: string): CrucibleSkinDef | null {
  return CRUCIBLE_SKIN_CATALOG.find((def) => def.itemId === itemId) ?? null;
}

export function crucibleSkinForClass(cls: PlayerClass): CrucibleSkinDef | null {
  return CRUCIBLE_SKIN_CATALOG.find((def) => def.requiredClass === cls) ?? null;
}

export interface CrucibleClassSet {
  setId: string;
  /** The five piece item ids, in catalog order. */
  pieceIds: readonly string[];
}

/** Every full Crucible tier set a class can complete, derived from the raid
 *  loot table so a new set is picked up with no second list to keep in sync.
 *  A set counts for a class only when its pieces are class-locked to exactly
 *  that class (the tier sets are; the shared-class rings and trinkets carry no
 *  `set` tag and are skipped). */
export const CRUCIBLE_CLASS_SETS: Readonly<Record<PlayerClass, readonly CrucibleClassSet[]>> =
  (() => {
    const bySet = new Map<string, { cls: PlayerClass; pieceIds: string[] }>();
    for (const item of Object.values(IGNIVAR_SET_ITEMS)) {
      const setId = item.set;
      const only = item.requiredClass;
      if (!setId || !only || only.length !== 1) continue;
      const entry = bySet.get(setId) ?? { cls: only[0] as PlayerClass, pieceIds: [] };
      entry.pieceIds.push(item.id);
      bySet.set(setId, entry);
    }
    const out: Record<string, CrucibleClassSet[]> = {};
    for (const [setId, entry] of bySet) {
      const list = out[entry.cls] ?? [];
      list.push({ setId, pieceIds: entry.pieceIds });
      out[entry.cls] = list;
    }
    return out as Record<PlayerClass, readonly CrucibleClassSet[]>;
  })();

/** True when the class has completed at least one full Crucible tier set,
 *  judged by `has` (the owner's discovered-item lookup: the collection log
 *  unioned with the account ledger). */
export function crucibleSetCompleted(cls: PlayerClass, has: (itemId: string) => boolean): boolean {
  return (CRUCIBLE_CLASS_SETS[cls] ?? []).some((set) => set.pieceIds.every(has));
}
