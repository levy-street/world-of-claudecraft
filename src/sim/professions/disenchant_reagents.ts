// Typed disenchant secondaries (Professions 2.0): the rare-or-better
// disenchant secondary material, keyed by the disenchanted piece's own material
// so an armor set and a weapon set feed distinct reagent lines. Armor keys off
// its armor class (cloth/leather/mail); a weapon keys off its family (a melee
// bucket yields steel, a caster/ranged haft-or-stock bucket yields timber).
// Below `rare` (and for a piece with no typed material, e.g. jewelry, which
// carries no armor class) there is no typed secondary, so the caller grants
// only the universal ladder material and stays byte-identical to the
// pre-typed-secondary yield.
//
// A pure `src/sim` leaf: no SimContext, no rng, no clock, no DOM/Three/render/
// ui/game/net imports (enforced by tests/architecture.test.ts). The
// resolveDisenchant arm (professions/enchanting.ts) reads this to decide the
// bind-on-trade secondary grant; the ENCHANTS table (content/enchants.ts)
// consumes each material so none is a dead-end.

import { weaponTypeForItem } from '../content/weapon_skin_rules';
import type { ItemDef } from '../types';

// Armor class -> its resonant weave. Only cloth/leather/mail armor pieces carry
// an armorType; jewelry (neck/ring, no armor class) falls through to no
// secondary.
export const ARMOR_SECONDARY_BY_TYPE: Readonly<Record<string, string>> = {
  cloth: 'resonant_thread',
  leather: 'resonant_hide',
  mail: 'resonant_links',
};

// Weapon families that yield resonant timber (the caster/ranged hafts and
// stocks: staves, wands, bows, crossbows). Every other classified weapon
// family, and any weapon with no WEAPON_TYPE_BY_ITEM classification, yields
// resonant steel (the melee default). Staves and wands sitting in the WEAPON
// (timber) bucket is a settled decision: timber is a weapon bucket,
// not the cloth armor line.
export const TIMBER_WEAPON_TYPES: ReadonlySet<string> = new Set([
  'staff',
  'wand',
  'bow',
  'crossbow',
]);

/** The typed secondary material one disenchant of `def` yields, or null when
 *  the piece is below `rare` (sub-rare disenchants stay byte-identical to today,
 *  yielding only the universal ladder material) or carries no typed material
 *  (jewelry has no armor class, so no weave). Armor keys off armorType; a weapon
 *  keys off its family via weaponTypeForItem, an unclassified weapon falling
 *  back to resonant_steel. Pure: no rng, no side effects. */
export function typedSecondaryFor(def: ItemDef): string | null {
  if (def.quality !== 'rare' && def.quality !== 'epic' && def.quality !== 'legendary') return null;
  if (def.kind === 'armor') {
    return def.armorType ? (ARMOR_SECONDARY_BY_TYPE[def.armorType] ?? null) : null;
  }
  if (def.kind === 'weapon') {
    const family = weaponTypeForItem(def.id);
    return family && TIMBER_WEAPON_TYPES.has(family) ? 'resonant_timber' : 'resonant_steel';
  }
  return null;
}
