// The Crucible tier-set bonus resolver (Ignivar raid loot Phase B): folds the
// worn-set ENGINE bonuses (content/ignivar_set_bonuses.ts) into a character's
// TalentModifiers, on the same accumulateTalentEffect path talent rows use.
// Every met tier ALSO registers a wearer flag in mods.selected
// (setBonusFlag(setId, pieces)), which is how bespoke class-module call sites
// gate their bends, exactly like a talent option id.
//
// This module, not computeTalentModifiers, owns the equipment walk:
// content/talents.ts stays a leaf (importing ITEMS there would cycle through
// data.ts). Every writer of meta.talentMods routes through
// computeCharacterModifiers below, and every EQUIPMENT mutation site calls
// refreshEquipmentMods before its recalcPlayerStats, so the mods a combat
// module reads can never be stale against the worn set.
//
// Stat-engine separation: item_sets.ts's aggregateSetBonuses keeps applying
// the incumbent sets' STAT tiers inside recalcPlayerStats; the Crucible sets'
// tiers carry empty stat effects there and pay entirely through this seam
// (maintainer ruling: engine bends, never raw stats).
//
// `src/sim`-pure: no DOM, no rng, no clock (tests/architecture.test.ts).

import { SET_ENGINE_BONUSES, setBonusFlag } from './content/ignivar_set_bonuses';
import {
  accumulateTalentEffect,
  computeTalentModifiers,
  type TalentModifiers,
} from './content/talents';
import { ITEMS } from './data';
import type { PlayerClass } from './types';

type EquipmentMap = Partial<Record<string, string>>;

/** Worn piece count per set id, from the equipment map's item `set` tags. */
export function wornSetCounts(equipment: EquipmentMap | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const itemId of Object.values(equipment ?? {})) {
    if (!itemId) continue;
    const setId = ITEMS[itemId]?.set;
    if (setId) counts.set(setId, (counts.get(setId) ?? 0) + 1);
  }
  return counts;
}

/** Accumulates every met engine-bonus tier of the worn sets into `modifiers`
 *  (mutating it, the accumulateTalentEffect contract) and registers the
 *  per-tier wearer flags. Returns the same object for writer-site chaining. */
export function applySetBonusModifiers(
  modifiers: TalentModifiers,
  equipment: EquipmentMap | undefined,
): TalentModifiers {
  for (const [setId, count] of wornSetCounts(equipment)) {
    const tiers = SET_ENGINE_BONUSES[setId];
    if (!tiers) continue;
    for (const tier of tiers) {
      if (count < tier.pieces) continue;
      modifiers.selected[setBonusFlag(setId, tier.pieces)] = true;
      accumulateTalentEffect(modifiers, tier.effect);
    }
  }
  return modifiers;
}

/** The ONE character-modifier builder every meta.talentMods writer uses:
 *  talents first, then the worn-set engine bonuses on top. */
export function computeCharacterModifiers(
  cls: PlayerClass,
  talents: unknown,
  level: number,
  equipment: EquipmentMap | undefined,
): TalentModifiers {
  return applySetBonusModifiers(computeTalentModifiers(cls, talents, level), equipment);
}
