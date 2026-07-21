// Form-aware auto-attack resolution (a pure leaf, unit-tested directly): the
// base swing speed, plus which ranged auto profile (class wand) a shapeshifted
// player still has.
//
// A druid in Wolf Form (internally the `form_cat` shapeshift aura) fights with
// claws, not the staff/mace it carries, so its auto-attack cadence must NOT come
// from the equipped weapon. Classic feral forms use a fixed normalized speed; we
// match it to the rogue's baseline so a feral druid attacks as fast as a rogue.
//
// `src/sim`-pure: no DOM/Three, no Math.random/Date.now. Reads only the static
// content tables, so it stays deterministic and host-agnostic.

import { CLASSES, ITEMS } from '../data';
import type { Entity, PlayerClass } from '../types';

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

// The druid shapeshifts that fight with claws (or hooves): while one is active
// the class wand is unavailable, exactly like a weapon it cannot hold. Caster
// form and Moonwing Form (`form_moonkin`) keep the wand. Deliberately a
// blocklist of the druid melee/travel forms, so the priest's `form_shadow` and
// the warlock's `form_metamorph` keep their existing wand behavior.
const WANDLESS_FORMS = new Set(['form_bear', 'form_cat', 'form_travel']);

export function wandAllowedInForm(e: Entity): boolean {
  for (const a of e.auras) if (WANDLESS_FORMS.has(a.kind)) return false;
  return true;
}

// The class ranged auto profile the player can fire RIGHT NOW: a hunter's Auto
// Shot always, a caster's wand only in a form that can hold it. This is the one
// resolver every ranged-auto consumer (the swing loop, the /attack readout)
// goes through, so a shapeshifted druid never wands from bear or cat form.
export function rangedAutoProfile(
  e: Entity,
  cls: PlayerClass,
): (typeof CLASSES)[PlayerClass]['ranged'] {
  const ranged = CLASSES[cls].ranged;
  if (!ranged) return undefined;
  if (ranged.wand && !wandAllowedInForm(e)) return undefined;
  return ranged;
}
