// Force-rename instance-signer sweep (Professions 2.0): a
// moderator-sanctioned rename re-keys the OWNER identity on market listings
// and the Ravenpost mailbox, but the renamed character's OWN signed instances
// still carry the old name in ItemInstancePayload.signer, which silently
// breaks the #1145 self-signed crafting discount (crafting.ts
// hasSelfSignedInstance compares signer to meta.name), Battlefield Experience
// attribution (battlefield_xp.ts compares signer to observerName), and leaks
// the old name through tooltips and the eqi inspect wire.
//
// A signed copy can be sitting in any of FIVE places at rename time, and the
// sweep has to reach all of them or the rename is only partly applied:
// rekeyInstanceSigner below covers the four containers inside the character's
// persisted blob (carried inventory, bank, vendor buyback, equipped), while
// the two ESCROW books hold the rest in shared world state and sweep
// themselves through rekeySignerInSlots from their own rename hooks
// (market.ts rekeyMarketSeller, mail/post_office.ts rekeyMailOwner). Escrowed
// instanced copies only became reachable when #2507 opened the anonymous
// pipes to instanced goods, which is why the owner-only rekeys were once
// sufficient there and no longer are.
//
// Foreign-held copies signed with the old name are deliberately out of scope:
// they live in OTHER characters' blobs and keep reading as items signed by a
// name that no longer exists.
//
// src/sim-pure: no DOM/Three/render-ui-game-net imports, no rng, no clock
// (enforced by tests/architecture.test.ts). Pure bookkeeping, zero draws.

import type { CharacterState } from './sim';
import type { ItemInstancePayload } from './types';

/** Rewrite one payload's signer when (and only when) it equals `oldName`. */
function rekeySigner(
  instance: ItemInstancePayload | undefined,
  oldName: string,
  newName: string,
): boolean {
  if (!instance || instance.signer !== oldName) return false;
  instance.signer = newName;
  return true;
}

/**
 * Rewrite `instance.signer === oldName` across an arbitrary slot list, in
 * place. The reusable half of the sweep: the character blob's own containers
 * use it below, and the two ESCROW books (market listings + collections,
 * Ravenpost parcels) call it from their own rename hooks, where the rows live
 * in shared world state rather than in the character's blob. Foreign signers
 * and every other payload field pass through untouched.
 */
export function rekeySignerInSlots(
  slots: readonly { instance?: ItemInstancePayload }[] | undefined,
  oldName: string,
  newName: string,
): boolean {
  let changed = false;
  for (const slot of slots ?? []) {
    if (rekeySigner(slot.instance, oldName, newName)) changed = true;
  }
  return changed;
}

/**
 * Rewrite `instance.signer === oldName` to `newName` across EVERY container in
 * the character's persisted blob that can hold an instance payload: the
 * carried inventory, the bank inventory, the vendor buyback rows, and the
 * equipped-instance map. Touches nothing else: foreign signers, every other
 * payload field, slot order, the manual `slot` placements, and stack counts all
 * pass through untouched, and the sweep never merges slots (two slots left
 * byte-equal by the rewrite stay separate; the identical-payload merge points
 * unify them on a future add).
 *
 * vendorBuyback is easy to forget and was: it is a full InvSlot[] on
 * CharacterState like the other two (items.ts recordVendorBuyback stores the
 * sold copy's payload verbatim so a buyback returns the same copy, #2412), so
 * selling a self-signed or masterwork piece before a rename and buying it back
 * after used to hand back a copy signed by a name that no longer exists. The
 * blast radius is the same as the other containers': the #1145 self-signed
 * crafting discount stops recognising it, Battlefield Experience attribution
 * misses, and it no longer stacks with its byte-equal peers.
 *
 * Mutates `state` IN PLACE (the rename handler owns the loaded blob and
 * persists it whole right after) and returns whether any signer was
 * rewritten, so the caller can skip the save when nothing matched.
 */
export function rekeyInstanceSigner(
  state: CharacterState,
  oldName: string,
  newName: string,
): boolean {
  let changed = rekeySignerInSlots(state.inventory, oldName, newName);
  changed = rekeySignerInSlots(state.bank?.inventory, oldName, newName) || changed;
  changed = rekeySignerInSlots(state.vendorBuyback, oldName, newName) || changed;
  for (const instance of Object.values(state.equipmentInstance ?? {})) {
    if (rekeySigner(instance, oldName, newName)) changed = true;
  }
  return changed;
}
