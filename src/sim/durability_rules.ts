// Gear durability, the pure rules (the classic repair-bill gold sink).
//
// This is the dependency-light LEAF half of the durability system: which gear
// carries a durability pool, how large that pool is, what the worn copy's
// current value is, and what a vendor charges to top it back up. The
// SimContext half (durability.ts) applies death loss and the repair command;
// entity.ts recalcPlayerStats reads isBrokenGear from HERE (importing the ctx
// module from the stat derivation would cycle through sim.ts), and the vendor
// window's pure view core reads repairAllCost through the same leaf.
//
// Storage doctrine: durability lives ON THE COPY, as ItemInstancePayload
// `durability` (the current value; the max is a pure function of the def), and
// the field is present ONLY while the piece is damaged: a full pool is the
// absent field, so an undamaged copy stays a plain fungible stack and a
// pre-durability save loads byte-identically. Keeping it on the copy (not a
// per-slot table on the character) means unequipping a damaged piece carries
// the damage into the bags with it, so an unequip-then-re-equip can never be a
// free repair, and repairing to full strips the field again.
//
// Rings and necklaces (jewelry, no armor class) never carry a pool: they are
// never damaged and never billed. Everything else that is worn (armor with an
// armor class, shields, weapons, held offhands) does.
import { itemLevel } from './item_level';
import { requiredLevelFor } from './item_level_req';
import {
  ALL_EQUIP_SLOTS,
  type ArmorType,
  type EquipSlot,
  type InvSlot,
  type ItemDef,
  type ItemInstancePayload,
} from './types';

/** Copper charged per point of missing durability per item level:
 *  cost = REPAIR_COPPER_PER_ILVL_POINT * ilvl * missing. */
export const REPAIR_COPPER_PER_ILVL_POINT = 5;

/** Fraction of MAX durability every worn piece loses on death (classic 10%). */
export const DEATH_DURABILITY_LOSS = 0.1;

/** The EXTRA fraction of max durability a Spirit Healer resurrection costs, on
 *  top of the death loss (the corpse run stays the gear-cheap choice). */
export const SPIRIT_REZ_DURABILITY_LOSS = 0.15;

/** Deaths at or above this level damage gear ("once the player is above level
 *  5"); a starter's first deaths cost nothing. */
export const DURABILITY_LOSS_MIN_LEVEL = 6;

// The pool sizes, a classic-shaped ladder: the torso and legs carry the most,
// belts and gloves the least, and heavier armor classes carry more per slot.
// Not scaled by item level (classic never did), so a repair bill grows through
// the cost formula's ilvl term, never through a bigger pool.
const SLOT_BASE_DURABILITY: Partial<Record<EquipSlot, number>> = {
  helmet: 60,
  shoulder: 60,
  chest: 100,
  waist: 35,
  legs: 75,
  gloves: 35,
  feet: 50,
  mainhand: 75,
  offhand: 75,
};

const ARMOR_TYPE_DURABILITY_MULT: Record<ArmorType, number> = {
  cloth: 0.8,
  leather: 1,
  mail: 1.2,
};

/** Two-handed weapons carry a bigger pool than the one-handed line. */
const TWOHAND_DURABILITY = 100;

/** A shield's pool, flat: it is neither a weapon nor a body slot. */
const SHIELD_DURABILITY = 100;

/** True when this def carries a durability pool at all: worn gear with an
 *  armor class, shields, weapons, and held offhands. Jewelry (neck, rings)
 *  and every non-equippable kind return false. */
export function hasDurability(def: ItemDef | undefined): boolean {
  if (!def) return false;
  if (def.kind === 'weapon' || def.kind === 'held_offhand') return true;
  return def.kind === 'armor' && def.armorType !== undefined;
}

/** The pool size for a def, or 0 when it carries none (see hasDurability). */
export function maxDurability(def: ItemDef | undefined): number {
  if (!def || !hasDurability(def)) return 0;
  if (def.kind === 'weapon') {
    return def.hand === 'twohand' ? TWOHAND_DURABILITY : (SLOT_BASE_DURABILITY.mainhand ?? 0);
  }
  if (def.kind === 'held_offhand') return SLOT_BASE_DURABILITY.offhand ?? 0;
  if (def.kind === 'armor' && 'shield' in def && def.shield) return SHIELD_DURABILITY;
  if (def.kind !== 'armor' || def.armorType === undefined) return 0;
  const base = SLOT_BASE_DURABILITY[def.slot as EquipSlot] ?? 0;
  return Math.round(base * ARMOR_TYPE_DURABILITY_MULT[def.armorType]);
}

/** The copy's current durability: the payload's `durability` when present and
 *  sane, else the full pool (absent means undamaged). Clamped into [0, max]
 *  so a hand-edited save can never read negative or over-full. */
export function currentDurability(
  def: ItemDef | undefined,
  instance: ItemInstancePayload | undefined,
): number {
  const max = maxDurability(def);
  if (max === 0) return 0;
  const d = instance?.durability;
  if (typeof d !== 'number' || !Number.isFinite(d)) return max;
  return Math.min(max, Math.max(0, Math.round(d)));
}

/** True when the copy has a pool and it is empty: worn but inert (grants no
 *  stats, armor, ratings, or set pieces) until repaired. */
export function isBrokenGear(
  def: ItemDef | undefined,
  instance: ItemInstancePayload | undefined,
): boolean {
  return maxDurability(def) > 0 && currentDurability(def, instance) === 0;
}

/** The item level the repair bill is priced on: the tooltip's item level where
 *  the def has a derivable source, else the piece's required level (starter
 *  and plain vendor gear have no source and would otherwise price at nothing). */
export function repairItemLevel(def: ItemDef): number {
  return Math.max(1, itemLevel(def) ?? requiredLevelFor(def));
}

/** Copper to restore ONE copy to full: 5c per item level per missing point
 *  (an ilvl 33 piece missing all 240 points costs 39,600c). Zero for an
 *  undamaged copy or a def with no pool. */
export function repairCostFor(
  def: ItemDef | undefined,
  instance: ItemInstancePayload | undefined,
): number {
  if (!def) return 0;
  const missing = maxDurability(def) - currentDurability(def, instance);
  if (missing <= 0) return 0;
  return REPAIR_COPPER_PER_ILVL_POINT * repairItemLevel(def) * missing;
}

/** Copper to restore every worn piece, plus every damaged copy in the bags,
 *  to full (the vendor's Repair All quote).
 *  Both hosts compute this from the same equipment + instance maps, so the
 *  window's preview and the server's charge agree by construction. */
export function repairAllCost(
  equipment: Partial<Record<EquipSlot, string>>,
  instances: Partial<Record<EquipSlot, ItemInstancePayload>> | undefined,
  items: Readonly<Record<string, ItemDef>>,
  inventory: readonly InvSlot[] = [],
): number {
  let total = 0;
  for (const slot of ALL_EQUIP_SLOTS) {
    const itemId = equipment[slot];
    if (!itemId) continue;
    total += repairCostFor(items[itemId], instances?.[slot]);
  }
  // Damaged copies carried in the bags (an unequipped piece keeps its damage)
  // are on the same bill, the classic Repair All scope; a gear copy is one
  // per slot, but the count is honored for safety.
  for (const slot of inventory) {
    if (slot.instance?.durability === undefined) continue;
    total += repairCostFor(items[slot.itemId], slot.instance) * Math.max(1, slot.count);
  }
  return total;
}

/** Take `fraction` of MAX durability off every worn piece that carries a pool,
 *  writing the result onto each slot's payload (creating the payload for a
 *  plain piece). At least one point per hit, floored at zero. Mutates
 *  `instances` in place and reports whether anything changed. Pure of any
 *  host: draws no rng, reads no clock. */
export function damageWornGear(
  equipment: Partial<Record<EquipSlot, string>>,
  instances: Partial<Record<EquipSlot, ItemInstancePayload>>,
  fraction: number,
  items: Readonly<Record<string, ItemDef>>,
): boolean {
  let changed = false;
  for (const slot of ALL_EQUIP_SLOTS) {
    const itemId = equipment[slot];
    if (!itemId) continue;
    const def = items[itemId];
    const max = maxDurability(def);
    if (max === 0) continue;
    const current = currentDurability(def, instances[slot]);
    if (current === 0) continue;
    const loss = Math.max(1, Math.round(max * fraction));
    const next = Math.max(0, current - loss);
    const inst = instances[slot] ?? {};
    inst.durability = next;
    instances[slot] = inst;
    changed = true;
  }
  return changed;
}

/** Restore every worn piece (and every damaged bagged copy) to full: strip the
 *  `durability` field, and drop a payload that held nothing else so the piece
 *  is plain again. Mutates in place; returns true when any slot changed. */
export function restoreWornGear(
  instances: Partial<Record<EquipSlot, ItemInstancePayload>>,
  inventory: InvSlot[] = [],
): boolean {
  let changed = false;
  for (const slot of ALL_EQUIP_SLOTS) {
    const inst = instances[slot];
    if (!inst || inst.durability === undefined) continue;
    delete inst.durability;
    if (Object.keys(inst).length === 0) delete instances[slot];
    changed = true;
  }
  for (const slot of inventory) {
    const inst = slot.instance;
    if (!inst || inst.durability === undefined) continue;
    delete inst.durability;
    if (Object.keys(inst).length === 0) delete slot.instance;
    changed = true;
  }
  return changed;
}
