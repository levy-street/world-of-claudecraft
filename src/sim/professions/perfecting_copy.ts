// A captured Perfecting selection carries both the same-id sibling anchor and
// a compact fingerprint of itemCopyPin (payload plus crafted provenance). The anchor catches
// bag splices even for identical copies; the pin catches a replacement with the
// same sibling count, including worn swaps. Refuse stale selections before any
// materials move. Tokens are optional only for legacy/headless callers.
// This is a stale-selection witness, not authentication: the server independently
// validates ownership, eligibility and costs. The bounded wire token must cover
// even forward-compatible payloads larger than a command frame.
import { fingerprint128 } from '../fingerprint128';
import { baggedCopyAnchor, type ItemCopyAnchor } from '../item_copy_anchor';
import { itemCopyPin } from '../item_copy_ref';
import type { EquipSlot, InvSlot, ItemInstancePayload } from '../types';

export interface PerfectingCopy {
  pin: string;
  anchor?: ItemCopyAnchor;
}

export type PerfectItemRef = ({ slot: EquipSlot } | { bag: number; itemId: string }) & {
  copy?: PerfectingCopy;
};

export interface PerfectingCopyReads {
  inventory: readonly InvSlot[];
  equipment: Readonly<Partial<Record<EquipSlot, string>>>;
  equipmentInstances: Readonly<Partial<Record<EquipSlot, ItemInstancePayload>>>;
}

function copyAt(reads: PerfectingCopyReads, ref: PerfectItemRef): PerfectingCopy | null {
  if ('slot' in ref) {
    const itemId = reads.equipment[ref.slot];
    return itemId
      ? {
          pin: fingerprint128(
            itemCopyPin({ itemId, count: 1, instance: reads.equipmentInstances[ref.slot] }),
          ),
        }
      : null;
  }
  const anchor = baggedCopyAnchor(reads.inventory, ref.itemId, ref.bag);
  return anchor ? { pin: fingerprint128(itemCopyPin(reads.inventory[ref.bag])), anchor } : null;
}

/** Preserve an earlier capture, especially across a prompt or a snapshot. An
 * absent selection gets an invalid pin so it cannot become valid by arrival. */
export function capturePerfectItemRef(
  reads: PerfectingCopyReads,
  ref: PerfectItemRef,
): PerfectItemRef {
  return ref.copy !== undefined ? ref : { ...ref, copy: copyAt(reads, ref) ?? { pin: '' } };
}

/** Compare only; never retarget an already-authorized command. Item pins use
 * the repo's semantic-copy model: two byte-identical copies have no distinct
 * persisted identity. The sibling anchor supplies the bag-position witness. */
export function perfectingCopyMatches(reads: PerfectingCopyReads, ref: PerfectItemRef): boolean {
  if (ref.copy === undefined) return true;
  const live = copyAt(reads, ref);
  return (
    live !== null &&
    ref.copy.pin === live.pin &&
    ref.copy.anchor?.ordinal === live.anchor?.ordinal &&
    ref.copy.anchor?.count === live.anchor?.count
  );
}
