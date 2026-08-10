// Gear sets on a saved loadout: capturing what is worn, and planning the swap back.
//
// A talent loadout already stores more than talents (`SavedLoadout` is
// `{name, alloc, bar}`), so a gear set is a third field rather than a new system.
// The motivating case is a player keeping a PvP set and a PvE set.
//
// WHY A PIN AND NOT A BAG INDEX. A copy selection on a live command is a bag
// index, valid for exactly one tick (src/sim/item_copy_ref.ts). A saved loadout
// outlives the session, so an index stored today points at something unrelated
// tomorrow. What survives is the copy's IDENTITY: `itemCopyPin` over the item id,
// the instance payload and the crafted provenance. The plan below resolves that
// identity back to an index at APPLY time, which is the only moment an index
// means anything.
//
// WHY THE PIN MATTERS AT ALL. Equipment is stored as bare item ids
// (`PlayerMeta.equipment`) with per-copy payloads in a parallel map
// (`equipmentInstance`). Two Furyforged Girdles, one enchanted for PvP and one
// plain, are the same id. Storing the id alone would re-equip whichever copy the
// legacy walk happened to pick, which is the exact defect #3162 closed. A gear
// set that re-benched your enchant on every swap would be worse than no feature.
//
// This module is PURE: it decides, it never mutates. `planGearSwap` returns what
// to equip, what is already correct, and what could not be found, and the caller
// performs the equips and owns the refusal. That split is what lets a Vitest drive
// the whole decision with plain arrays and no Sim.

import { itemCopyPin } from './item_copy_ref';
import { ALL_EQUIP_SLOTS, type EquipSlot, type InvSlot, type ItemInstancePayload } from './types';

/** One saved slot: which item, and which COPY of it. */
export interface SavedGearPiece {
  itemId: string;
  /** `itemCopyPin` of the copy that was worn. Empty for a plain piece carrying no
   *  payload, which is the common case and matches the pin of any plain copy. */
  pin: string;
}

/** The worn set a loadout captured, sparse by equip slot. */
export type SavedGearSet = Partial<Record<EquipSlot, SavedGearPiece>>;

/**
 * Capture the currently worn set.
 *
 * Takes the two authoritative maps rather than a PlayerMeta so this stays a pure
 * leaf: `equipment` is item ids by slot, `equipmentInstance` is the per-slot
 * payload of whichever piece carries one (sparse; a plain piece has no entry).
 */
/**
 * The WORN payload rendered in the BAG slot's shape, so both sides pin identically.
 *
 * This normalization is load-bearing, not tidiness. `equipmentPayloadFor` packs
 * `craftedRecipeId` INTO the worn payload, while `returnEquippedItemToBags` unpacks
 * it back out to the InvSlot's own field. `itemCopyPin` reads the two shapes
 * differently, so pinning the worn form directly meant a crafted piece could never
 * match itself once it was back in the bags: saved, unequipped, and then reported
 * gone with the exact copy sitting right there.
 */
export function wornAsBagSlot(itemId: string, payload: ItemInstancePayload | undefined): InvSlot {
  if (!payload) return { itemId, count: 1 };
  const { craftedRecipeId, ...rest } = payload as ItemInstancePayload & {
    craftedRecipeId?: string;
  };
  const instance = Object.keys(rest).length > 0 ? (rest as ItemInstancePayload) : undefined;
  return {
    itemId,
    count: 1,
    ...(instance ? { instance } : {}),
    ...(craftedRecipeId === undefined ? {} : { craftedRecipeId }),
  };
}

export function buildGearSet(
  equipment: Partial<Record<EquipSlot, string>>,
  equipmentInstance: Partial<Record<EquipSlot, ItemInstancePayload>> | undefined,
): SavedGearSet {
  const out: SavedGearSet = {};
  for (const key of Object.keys(equipment) as EquipSlot[]) {
    const itemId = equipment[key];
    if (typeof itemId !== 'string' || itemId === '') continue;
    // itemCopyPin is the SINGLE authority on both sides. No `instance ? ... : ''`
    // short-circuit: it made a crafted-but-unenchanted copy pin as the empty
    // string on one side and as a real fingerprint on the other.
    out[key] = { itemId, pin: itemCopyPin(wornAsBagSlot(itemId, equipmentInstance?.[key])) };
  }
  return out;
}

/** One equip the caller should perform, with the bag index resolved NOW. */
export interface PlannedEquip {
  slot: EquipSlot;
  itemId: string;
  /** Index into the inventory array the plan was built against. Valid only for
   *  this tick, which is why it is produced here and never stored. */
  bagIndex: number;
}

/** A saved piece that could not be equipped, and why. */
export interface UnavailableEquip {
  slot: EquipSlot;
  itemId: string;
  /** `notHeld`: no copy of the id in the bags at all.
   *  `copyGone`: copies exist but none matches the saved pin (the enchant was
   *  applied to a different copy, or this one was sold, disenchanted, or traded).
   *  `takenByOtherSlot`: the matching copy exists but an earlier slot in this same
   *  swap already claimed it. The honest case is a set saved with one ring in both
   *  ring slots, where the player simply owns one. Distinct from the other two on
   *  purpose: "you only have one of these" is a different message from "that copy
   *  is gone", and collapsing them would misinform the player. */
  reason: 'notHeld' | 'copyGone' | 'takenByOtherSlot';
}

export interface GearSwapPlan {
  /** Equips to perform, in slot order. */
  equips: PlannedEquip[];
  /** Slots already wearing the exact saved copy, so nothing to do. */
  alreadyWorn: EquipSlot[];
  /** Saved pieces that could not be found. */
  unavailable: UnavailableEquip[];
}

/**
 * Decide what a swap to `set` would do against the bags and worn gear as they are
 * right now. Pure: nothing here changes state.
 *
 * Resolution per slot, in order:
 *   1. Already wearing that exact copy (id AND pin match) -> alreadyWorn.
 *   2. A bag copy whose id AND pin both match -> equip it.
 *   3. Otherwise unavailable, distinguishing "none held" from "the copy is gone".
 *
 * There is deliberately NO looser second pass. A plain saved piece pins to the
 * empty string and so does every plain bag copy, which means step 2 already treats
 * interchangeable copies as interchangeable. What it will never do is settle a
 * saved ENCHANTED piece for a plain copy of the same id: equipping a piece
 * carrying none of the expected stats, silently, is the exact failure this feature
 * exists to avoid. Reporting it unavailable is what lets the player SEE that
 * something is missing.
 *
 * Each bag index is claimed at most once, so two ring slots saved from two copies
 * of one id cannot both resolve onto the same stack. (The live apply path in
 * progression/talents.ts re-plans per slot against the live bags, which gets the
 * same property for free; the claim set is what makes a WHOLE-set plan coherent
 * for a caller that wants to inspect one before acting.)
 *
 * KNOWN LIMITATION, pinned by a test rather than left to be discovered: this
 * searches the BAGS only. A set whose pieces are currently worn in each other's
 * slots (two rings exchanged between ring1 and ring2) reports them unavailable and
 * never corrects itself, because neither is in a bag. Fixing it means unequipping
 * within the set first, which is a larger change than this feature needs; the
 * common case (a set sitting in bags) is unaffected.
 */
export function planGearSwap(
  set: SavedGearSet,
  inventory: readonly InvSlot[],
  equipment: Partial<Record<EquipSlot, string>>,
  equipmentInstance: Partial<Record<EquipSlot, ItemInstancePayload>> | undefined,
): GearSwapPlan {
  const equips: PlannedEquip[] = [];
  const alreadyWorn: EquipSlot[] = [];
  const unavailable: UnavailableEquip[] = [];
  const claimed = new Set<number>();

  // Ordered by ALL_EQUIP_SLOTS rather than alphabetically. Both are deterministic
  // (which is what the sim requires), but the canonical order matches the rest of
  // the equipment surface and makes displacement interactions predictable: the
  // hands resolve before the armor that cannot displace them.
  const wanted = new Set(Object.keys(set) as EquipSlot[]);
  const slots = ALL_EQUIP_SLOTS.filter((slot) => wanted.has(slot));

  for (const slot of slots) {
    const want = set[slot];
    if (!want) continue;

    const wornId = equipment[slot];
    if (wornId === want.itemId) {
      const wornPin = itemCopyPin(wornAsBagSlot(wornId, equipmentInstance?.[slot]));
      if (wornPin === want.pin) {
        alreadyWorn.push(slot);
        continue;
      }
    }

    let match = -1;
    let sawId = false;
    let sawClaimedMatch = false;
    for (let i = 0; i < inventory.length; i++) {
      const bagSlot = inventory[i];
      if (bagSlot.itemId !== want.itemId || bagSlot.count < 1) continue;
      // Counted BEFORE the claim check, so "held but taken" stays distinguishable
      // from "not held at all".
      sawId = true;
      // itemCopyPin unconditionally: the old `instance ? pin : ''` short-circuit
      // gave a crafted-but-unenchanted copy the empty pin on this side while the
      // saved side fingerprinted it properly, so a crafted piece could never match.
      if (itemCopyPin(bagSlot) !== want.pin) continue;
      if (claimed.has(i)) {
        sawClaimedMatch = true;
        continue;
      }
      match = i;
      break;
    }
    if (match >= 0) {
      claimed.add(match);
      equips.push({ slot, itemId: want.itemId, bagIndex: match });
      continue;
    }
    const reason = sawClaimedMatch ? 'takenByOtherSlot' : sawId ? 'copyGone' : 'notHeld';
    unavailable.push({ slot, itemId: want.itemId, reason });
  }

  return { equips, alreadyWorn, unavailable };
}
