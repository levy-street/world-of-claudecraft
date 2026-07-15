// Sheathed-weapon toggle (the Z key): a purely cosmetic per-entity flag that the
// renderer reads to move held weapons onto the back. Server-authoritative like
// `sitting`: it rides the entity wire as a compact flag and any deliberate combat
// action re-draws the weapon (see drawWeapon call sites in combat/auto_attack.ts
// and combat/casting_lifecycle.ts). Pure leaf module (threat.ts pattern): no rng,
// no SimContext, importable directly by system modules and tests.

import type { Entity } from './types';

/** Toggle the sheathed state. Dead players can't sheathe (mirrors /sit).
 *  Returns the resulting state so callers can pick the matching sound cue. */
export function toggleWeaponStow(e: Entity): boolean {
  if (e.dead) return e.weaponStowed;
  e.weaponStowed = !e.weaponStowed;
  return e.weaponStowed;
}

/** A deliberate combat action draws the weapon again (WoW-style auto-unsheathe). */
export function drawWeapon(e: Entity): void {
  e.weaponStowed = false;
}
