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
import { normalizeLegendaryName } from '../src/sim/professions/legendary_name';
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

// The optional legendary name riding a perfect_item frame (Masterwrought
// phase 13): accepted as ANY non-empty string, exactly the string the offline
// host hands the sim; a non-string drops the FIELD, never the frame, so a
// malformed name degrades to an unnamed attempt the sim's own deny ladder
// answers ('That work needs a name to become a legend.' at the final rank)
// instead of a silent drop the player cannot read. No length cut and no
// length drop here (the phase 13 QA, two rounds): the sim's normalizer
// (src/sim/professions/legendary_name.ts: trim, collapse, alphabet, max 32)
// is the ONE authority on both hosts, and any server-side edit of the raw
// string before it breaks host parity in one direction or the other (a drop
// answered "needs a name" where offline says "cannot be inscribed"; a cut
// landing on a whitespace run normalized to a short VALID name the player
// never typed, stamped online and refused offline). The flood ceiling is the
// frame itself (WS maxPayload, 16 KiB) under the pre-parse byte budget
// (server/msg_rate_limit.ts: 64 KiB/s sustained, 128 KiB burst, so at most
// four maximal frames a second before the name-screen lane's own 2/s), which
// is what makes raw pass-through safe; a raw token is priced once by the normalizer
// (linear) and never stored, since a shape-invalid one is refused and a
// shape-valid one is stamped only as its normalized form. The server-side
// CONTENT screen (offensiveName) runs in resolvePerfectItemName below on the
// normalized value, the pet_rename split.
export function parsePerfectItemName(msg: { name?: unknown }): string | undefined {
  return typeof msg.name === 'string' && msg.name.length > 0 ? msg.name : undefined;
}

/**
 * The whole naming decision for one perfect_item frame, shape-first so the
 * content screen only ever prices shape-valid names (32 chars or less at the
 * command-lane rate, never a raw wire token up to the payload ceiling):
 *  - no usable name field: pass undefined (an unnamed attempt);
 *  - shape-INVALID (normalizeLegendaryName null): skip the screen entirely
 *    and pass the RAW name through; the sim's own shape arm refuses it with
 *    its inscription line, so nothing is silently laundered;
 *  - shape-valid and clean: pass the NORMALIZED value to the sim;
 *  - shape-valid and offensive: refuse the frame only when the copy would
 *    actually CONSUME the name, otherwise strip the name and let the attempt
 *    proceed unnamed (`{ refused: false, name: undefined }`, which the
 *    dispatch already handles as an unnamed attempt with no new arm).
 *
 * The screen always runs on the NORMALIZED value, never the raw wire
 * spelling: there is then no hidden coupling to the censorship normalizer's
 * own whitespace stripping, and a spelling only normalization exposes cannot
 * slip past.
 *
 * `promoting` answers the one question the wire frame cannot: would this
 * attempt reach the promotion ladder, the only code that can stamp the name?
 * `Sim.perfectItemAs` routes a `payload.perfected === true` copy to
 * `promoteResolvedTarget(name)` and every other copy to the ordinary
 * attempt, which ignores `name` entirely. So an offensive name on an
 * UNPERFECTED copy was never going to be written anywhere, and refusing the
 * whole frame for it (the phase 13 behavior) cost the player their perfecting
 * attempt over a string the sim would have dropped on the floor. It is a
 * thunk, not a boolean, so the sim read is paid only on the rarest arm: a
 * shape-valid name that actually matches the screen.
 *
 * Deliberately `perfected` alone, NOT `perfected && !promoted`: an already
 * promoted copy still hands its name to the promotion ladder, and arm 1 of
 * that ladder ("already legendary") is the ladder's own business. Keying the
 * content screen on a deny arm's ordering would couple the two, so the screen
 * asks only whether the name reaches the code that can stamp it.
 */
export function resolvePerfectItemName(
  msg: { name?: unknown },
  offensive: (name: string) => boolean,
  promoting: () => boolean,
): { refused: boolean; name?: string } {
  const raw = parsePerfectItemName(msg);
  if (raw === undefined) return { refused: false };
  const normalized = normalizeLegendaryName(raw);
  if (normalized === null) return { refused: false, name: raw };
  if (offensive(normalized)) return promoting() ? { refused: true } : { refused: false };
  return { refused: false, name: normalized };
}
