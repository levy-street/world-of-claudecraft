// Which bag copies belong to a saved loadout's gear set, for the Favorites tab.
//
// A talent loadout can already capture the worn set (src/sim/loadout_gear.ts),
// and that capture is the player's own grouping: "Tank set", "PvP set". Rather
// than inventing a second tagging system, the Favorites tab reads those sets
// back and shows each one as a sub-heading over the bag copies it names.
//
// MATCHING IS THE SWAP'S OWN RULE. A copy belongs to a set exactly when its id
// AND its itemCopyPin equal a saved piece, the test planGearSwap runs to decide
// what a swap would equip. So the copy listed under "Tank set" is the copy the
// swap would put on, never an id-mate that happens to share a name (an
// enchanted piece and a plain duplicate stay apart).
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { SavedLoadout } from '../sim/content/talents';
import { itemCopyPin } from '../sim/item_copy_ref';
import type { InvSlot } from '../sim/types';

/** One loadout that captured a gear set, in loadout order. */
export interface BagGearSet {
  /** Index into the loadout list (stable for this paint; the label fallback). */
  loadoutIndex: number;
  /** The player's own loadout name: player-authored text, never a t() key. */
  name: string;
}

/** The gear-set lookup the bag filter and the section builder share. */
export interface BagGearSetIndex {
  sets: readonly BagGearSet[];
  /** Indices into `sets` of every set naming this bag copy (empty when none). */
  setsFor(slot: InvSlot): readonly number[];
}

const NO_SETS: readonly number[] = [];

function pieceKey(itemId: string, pin: string): string {
  return `${itemId}\u0000${pin}`;
}

/** Build the lookup from the loadout list. Loadouts without a captured set are
 *  skipped; a loadout whose set lists one copy in two slots (both rings) still
 *  names it once. */
export function buildBagGearSetIndex(loadouts: readonly SavedLoadout[]): BagGearSetIndex {
  const sets: BagGearSet[] = [];
  const byKey = new Map<string, number[]>();
  loadouts.forEach((loadout, loadoutIndex) => {
    const gear = loadout.gear;
    if (!gear) return;
    const pieces = Object.values(gear).filter(
      (piece): piece is NonNullable<typeof piece> =>
        !!piece && typeof piece.itemId === 'string' && piece.itemId !== '',
    );
    if (pieces.length === 0) return;
    const setIndex = sets.length;
    sets.push({ loadoutIndex, name: loadout.name });
    for (const piece of pieces) {
      const key = pieceKey(piece.itemId, piece.pin);
      const list = byKey.get(key);
      if (!list) byKey.set(key, [setIndex]);
      else if (list[list.length - 1] !== setIndex) list.push(setIndex);
    }
  });
  return {
    sets,
    setsFor(slot) {
      if (byKey.size === 0) return NO_SETS;
      return byKey.get(pieceKey(slot.itemId, itemCopyPin(slot))) ?? NO_SETS;
    },
  };
}

/** The empty lookup: no loadout captured a set. */
export const EMPTY_BAG_GEAR_SET_INDEX: BagGearSetIndex = {
  sets: [],
  setsFor: () => NO_SETS,
};
