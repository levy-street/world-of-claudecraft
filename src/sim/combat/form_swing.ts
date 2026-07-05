// Form-aware base swing speed (a pure leaf, unit-tested directly).
//
// A druid in Wolf Form (internally the `form_cat` shapeshift aura) fights with
// claws, not the staff/mace it carries, so its auto-attack cadence must NOT come
// from the equipped weapon. Classic feral forms use a fixed normalized speed; we
// match it to the rogue's baseline so a feral druid attacks as fast as a rogue.
//
// `src/sim`-pure: no DOM/Three, no Math.random/Date.now. Reads only the static
// content tables, so it stays deterministic and host-agnostic.

import { CLASSES, ITEMS } from '../data';
import type { Entity } from '../types';

// The rogue's baseline weapon speed (its starting dagger). Sourcing it from the
// content tables keeps Wolf Form genuinely "same as rogue" even if the rogue's
// base weapon is ever retuned, instead of a magic number that could drift.
export const ROGUE_BASE_SWING_SPEED: number = ITEMS[CLASSES.rogue.startWeapon].weapon?.speed ?? 1.8;

// Effective base swing speed in seconds, BEFORE haste/slow auras
// (`swingIntervalMult`). Wolf Form ignores the equipped weapon and matches the
// rogue baseline; every other entity swings at its own weapon speed.
export function baseSwingSpeed(e: Entity): number {
  for (const a of e.auras) if (a.kind === 'form_cat') return ROGUE_BASE_SWING_SPEED;
  return e.weapon.speed;
}
