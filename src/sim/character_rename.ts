// Force-rename instance-signer sweep (Professions 2.0 Phase 12d): a
// moderator-sanctioned rename re-keys market listings and the Ravenpost
// mailbox, but the renamed character's OWN signed instances still carry the
// old name in ItemInstancePayload.signer, which silently breaks the #1145
// self-signed crafting discount (crafting.ts hasSelfSignedInstance compares
// signer to meta.name), Battlefield Experience attribution (battlefield_xp.ts
// compares signer to observerName), and leaks the old name through tooltips
// and the eqi inspect wire. This sweep rewrites exactly those signer strings
// in the character's persisted blob. Foreign-held copies signed with the old
// name are deliberately out of scope: they live in OTHER characters' blobs
// and keep reading as items signed by a name that no longer exists.
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
 * Rewrite `instance.signer === oldName` to `newName` across the character's
 * carried inventory, bank inventory, and equipped-instance map. Touches
 * nothing else: foreign signers, every other payload field, slot order, the
 * manual `slot` placements, and stack counts all pass through untouched, and
 * the sweep never merges slots (two slots left byte-equal by the rewrite stay
 * separate; the Phase 12d merge points unify them on a future add).
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
  let changed = false;
  for (const slot of state.inventory ?? []) {
    if (rekeySigner(slot.instance, oldName, newName)) changed = true;
  }
  for (const slot of state.bank?.inventory ?? []) {
    if (rekeySigner(slot.instance, oldName, newName)) changed = true;
  }
  for (const instance of Object.values(state.equipmentInstance ?? {})) {
    if (rekeySigner(instance, oldName, newName)) changed = true;
  }
  return changed;
}
