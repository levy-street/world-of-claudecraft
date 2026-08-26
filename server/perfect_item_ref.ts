// The perfect_item command's untrusted-input parse (Masterwrought phase 12),
// a pure decision core the game.ts dispatch case consumes (server/CLAUDE.md
// module-first: command parsing lives in a host-agnostic module a Vitest
// imports directly, never as a method cluster on GameServer).
//
// The target is a passed selection, never an id. `slot` is accepted only when
// it names a real equipment key (the 'equip' case's untrusted-input rule);
// a bagged ref is a CELL plus the item id the client saw in it (the
// item_copy_ref index-plus-id pin: a bare cell could resolve to a different
// apex piece after a shift and bind it), so `bag` is usable only as a
// non-negative integer beside a non-empty `item` string under the payload
// string ceiling. EXACTLY ONE arm must be usable or the frame drops whole:
// two usable refs, or none, are never laundered into a guess the sim did not
// see; one malformed token beside one usable one falls to the usable one
// (the apply_enchant precedent: it is the sender's own explicit cell or slot,
// never a guess). The sim re-validates the ref against ITS OWN bags and
// paperdoll and resolves the whole deny ladder and the one roll itself.
import { MAX_INSTANCE_STRING_LENGTH } from '../src/sim/item_instance_load';
import type { PerfectItemRef } from '../src/sim/professions/perfecting';
import { isEquipSlot } from '../src/sim/types';

export function parsePerfectItemRef(msg: {
  slot?: unknown;
  bag?: unknown;
  item?: unknown;
}): PerfectItemRef | null {
  const slot = typeof msg.slot === 'string' && isEquipSlot(msg.slot) ? msg.slot : undefined;
  const item =
    typeof msg.item === 'string' &&
    msg.item.length > 0 &&
    msg.item.length <= MAX_INSTANCE_STRING_LENGTH
      ? msg.item
      : undefined;
  const bag =
    typeof msg.bag === 'number' && Number.isInteger(msg.bag) && msg.bag >= 0 && item !== undefined
      ? msg.bag
      : undefined;
  if ((slot === undefined) === (bag === undefined)) return null;
  return slot !== undefined ? { slot } : { bag: bag as number, itemId: item as string };
}
