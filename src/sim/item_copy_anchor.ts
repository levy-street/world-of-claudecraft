import type { InvSlot } from './types';

// THE ORDINAL-PLUS-COUNT COPY ANCHOR: a second, independent description of the
// bag copy a command names, sent beside its index so the server can tell a
// STALE selection from a live one.
//
// The problem the index alone cannot solve. Every index-addressed item command
// (discard, sell, lock) sends `slotIndex`, and the server re-resolves it against
// its OWN inventory, checking that the cell still holds the right item id. That
// catches a selection pointing at a different ITEM. It cannot catch a selection
// pointing at a different COPY of the same item, and that is the case that
// actually happens: the client's mirror can lag the authority by a snapshot, a
// splice moves every slot above it down one, and the index the player clicked
// now names the id-mate beside their enchanted piece. The id check passes and
// the wrong copy is destroyed, sold, or locked, silently.
//
// The anchor is the Phase 14 selection design (`sameSelectedCopy` /
// `baggedCopyOrdinal` in src/ui/hud/professions/perfecting_view.ts), reused
// here as a WIRE contract: which same-id sibling this is (`ordinal`, counted in
// bag order) and how many siblings there were (`count`). Together they describe
// the copy without depending on the absolute index, so the server can check its
// own bags against what the client was looking at.
//
// OPTIONAL, and that is load-bearing rather than a migration convenience. An
// absent anchor means every command behaves EXACTLY as it did: the same
// resolution, the same refusals, the same rng draw order, so the golden traces
// do not move and an older client keeps working unchanged. Present, it can only
// ever turn a would-have-succeeded-on-the-wrong-copy into a refusal; it never
// selects a copy the index did not already name, and never widens what a
// command may touch.
//
// A pure leaf like item_copy_ref.ts beside it: no SimContext, no rng, no clock.

export interface ItemCopyAnchor {
  /** Which same-id bag slot this is, counting from 0 in inventory order. */
  ordinal: number;
  /** How many same-id bag slots the sender could see. */
  count: number;
}

/** The anchor describing the copy at `slotIndex`, or null when that index names
 *  no live cell of `itemId` (nothing to anchor). The SENDER's half. */
export function baggedCopyAnchor(
  inventory: readonly InvSlot[],
  itemId: string,
  slotIndex: number,
): ItemCopyAnchor | null {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= inventory.length) return null;
  if (inventory[slotIndex].itemId !== itemId) return null;
  let ordinal = -1;
  let count = 0;
  for (let i = 0; i < inventory.length; i++) {
    if (inventory[i].itemId !== itemId) continue;
    if (i === slotIndex) ordinal = count;
    count++;
  }
  return ordinal < 0 ? null : { ordinal, count };
}

/**
 * Whether a received anchor still DESCRIBES the named slot, judged against the
 * authoritative inventory. The RECEIVER's half.
 *
 * True (accept) when no anchor was sent, which is the unchanged path. True when
 * the anchor was sent and re-derives to the same ordinal and the same sibling
 * count. False (refuse) otherwise: either the sender saw a different number of
 * copies than exist, or this index is a different sibling than the one the
 * player picked, and in both cases the selection describes a bag that is no
 * longer there.
 *
 * Deliberately a REFUSAL rather than a re-target. The UI's own anchor re-targets
 * (it is following a selection the player can still see and correct), but a
 * command has already been sent: silently moving it to a different cell would
 * spend a copy on the strength of a guess about which way the bags shifted,
 * which is precisely the class of guess per-copy addressing exists to remove.
 * The caller answers with its own existing not-held refusal, so a stale command
 * reads exactly like every other stale selection in the game.
 */
export function anchorMatchesSelection(
  inventory: readonly InvSlot[],
  itemId: string,
  slotIndex: number | undefined,
  anchor: ItemCopyAnchor | undefined,
): boolean {
  if (anchor === undefined || slotIndex === undefined) return true;
  const live = baggedCopyAnchor(inventory, itemId, slotIndex);
  if (live === null) return false;
  return live.ordinal === anchor.ordinal && live.count === anchor.count;
}

/**
 * Read an anchor off a wire frame's two fields, or undefined when the sender
 * carried none. Shape validation only: both must be non-negative integers and
 * the ordinal must sit inside the count, because an anchor that cannot describe
 * any bag is not a refusal to honor, it is a malformed field to ignore (the
 * dispatch-layer laundering rule: never normalize a bad value into a plausible
 * one). A dropped anchor degrades to the pre-anchor behavior, never to a wrong
 * one, because the index check the command already runs still stands.
 */
export function parseItemCopyAnchor(ordinal: unknown, count: unknown): ItemCopyAnchor | undefined {
  if (typeof ordinal !== 'number' || typeof count !== 'number') return undefined;
  if (!Number.isInteger(ordinal) || !Number.isInteger(count)) return undefined;
  if (ordinal < 0 || count <= 0 || ordinal >= count) return undefined;
  return { ordinal, count };
}
