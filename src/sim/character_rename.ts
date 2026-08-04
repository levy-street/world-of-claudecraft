// Force-rename instance-signer sweep (Professions 2.0): a
// moderator-sanctioned rename re-keys market listings and the Ravenpost
// mailbox, but the renamed character's OWN signed instances still carry the
// old name in ItemInstancePayload.signer, which silently breaks the #1145
// self-signed crafting discount (crafting.ts hasSelfSignedInstance compares
// signer to meta.name), Battlefield Experience attribution (battlefield_xp.ts
// compares signer to observerName), and leaks the old name through tooltips
// and the eqi inspect wire. This sweep rewrites exactly those signer strings
// in the character's persisted blob, and the market/mail rekeys sweep the
// renamer's OWN escrowed copies in the world-state books the same way
// (market.ts rekeyMarketSeller, post_office.ts rekeyMailOwner). Foreign-held
// copies signed with the old name are deliberately out of scope: they live
// in OTHER characters' blobs or parcels and keep reading as items signed by
// a name that no longer exists.
//
// src/sim-pure: no DOM/Three/render-ui-game-net imports, no rng, no clock
// (enforced by tests/architecture.test.ts). Pure bookkeeping, zero draws.

import type { CharacterState } from './sim';
import type { ItemInstancePayload } from './types';

/** Rewrite one payload's signer when (and only when) it equals `oldName`. */
export function rekeySigner(
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
 * five signer-bearing blob regions (carried inventory, bank inventory, the
 * vendor buyback ring, and the equipped-instance map under BOTH its
 * spellings), PLUS the signer-derived `craftedBy` on every slotted tool
 * effect. Touches
 * nothing else: foreign signers, every other payload field, slot order, the
 * manual `slot` placements, and stack counts all pass through untouched, and
 * the sweep never merges slots (two slots left byte-equal by the rewrite stay
 * separate; the identical-payload merge points unify them on a future add).
 *
 * The tool-effect arm is a signer-derived identity rather than another
 * collection: the acquisition craft stamps a slot's `craftedBy` from
 * the consumed charm's signer (professions/tools.ts), and
 * `isOriginalCrafter` compares it to the LIVE character name, so a rename
 * that skipped it would silently retire the original-crafter recharge
 * discount on effects the renamer really did craft, with no way back short
 * of consuming another charm.
 *
 * Mutates `state` IN PLACE (the rename handler owns the loaded blob and
 * persists it whole right after) and returns whether anything was
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
  // The buyback ring is the fifth signer-bearing blob region (the
  // whole-branch review): a sold self-signed copy sits there for five
  // minutes and buyBackItem re-grants the exact stale payload, so a rename
  // landing inside that window would hand back a copy whose discount no
  // longer answers to its owner (and after a reclaim, one naming a
  // stranger).
  for (const slot of state.vendorBuyback ?? []) {
    if (rekeySigner(slot.instance, oldName, newName)) changed = true;
  }
  // BOTH equipment-map spellings: the loader still reads the legacy plural
  // key this branch's earlier rift-gear saves wrote (sim.ts, `s.
  // equipmentInstance ?? s.equipmentInstances`), so a sweep that walked only
  // the modern key would leave a legacy blob's signers behind for exactly
  // the reclaim case the sweep exists for.
  for (const instance of Object.values(state.equipmentInstance ?? {})) {
    if (rekeySigner(instance, oldName, newName)) changed = true;
  }
  for (const instance of Object.values(state.equipmentInstances ?? {})) {
    if (rekeySigner(instance, oldName, newName)) changed = true;
  }
  for (const slot of Object.values(state.toolEffectSlots ?? {})) {
    if (slot && slot.craftedBy === oldName) {
      slot.craftedBy = newName;
      changed = true;
    }
  }
  return changed;
}
