// Form-aware auto-attack resolution (a pure leaf, unit-tested directly): the
// base swing speed, plus which ranged auto profile (class wand) a shapeshifted
// player still has.
//
// A druid in Wolf Form (internally the `form_cat` shapeshift aura) fights with
// claws, not the staff/mace it carries, so its auto-attack cadence must NOT come
// from the equipped weapon. Classic feral cat forms swing at a fixed fast 1.0s
// paw speed; the auto path pairs that cadence with a weapon-roll rescale
// (catAutoWeaponRollMult) so white DPS tracks the weapon's AUTHORED dps.
//
// `src/sim`-pure: no DOM/Three, no Math.random/Date.now. Reads only the static
// content tables, so it stays deterministic and host-agnostic.

import { CLASSES, ITEMS } from '../data';
import type { Entity, PlayerClass, WeaponInfo } from '../types';

// The rogue's baseline weapon speed (its starting dagger). Sourcing it from the
// content tables keeps it honest even if the rogue's base weapon is ever
// retuned, instead of a magic number that could drift. Wolf Form borrowed this
// cadence before the classic paw-speed standardization below; the rogue itself
// still swings at it.
export const ROGUE_BASE_SWING_SPEED: number = ITEMS[CLASSES.rogue.startWeapon].weapon?.speed ?? 1.8;

// The classic fast feral paw cadence (seconds). Wolf Form used to borrow the
// rogue baseline (1.8s) while rolling the carried weapon's full authored
// min..max every swing, which inflated slow big-roll weapons and made the
// feral feel sluggish; the classic cat cadence is a fixed fast 1.0s.
export const CAT_FORM_SWING_SPEED = 1.0;

// The cadence Wolf Form swung at BEFORE the 1.0s standardization, frozen as a
// literal: per-swing sources balanced around the old cadence (Requital below)
// rescale against this number. It happens to equal the rogue's starting dagger
// speed because that is what cat form borrowed, but it must NOT track a future
// rogue weapon retune, so it is deliberately not a content lookup.
export const CAT_FORM_LEGACY_SWING_SPEED = 1.8;

// The feral form damage knob: the single bench-neutrality constant for the
// 2026-08 cat swing-cadence standardization (CAT_FORM_SWING_SPEED above; the
// design home is docs/design/druid-v029-class-design.md, "Wolf Form
// swing-cadence standardization"). Every Wolf Form melee swing (auto AND
// weaponStrike special, deliberately: the special's AP term follows the
// shared cadence, while its weapon roll stays raw per the classic
// non-normalized special shape) is scaled by it in meleeSwing, so the 1.0s
// cadence plus auto-roll normalization land DPS-neutral on the feral bench
// instead of a stealth nerf: a fidelity and itemization cleanup, not a buff.
// Tuned at 1.22 against the wildfang band probe
// (tests/owned_class_balance_druid_bands.test.ts, 179.1 -> 181.9 dps) and the
// 8-seed druid matrix (scripts/druid_balance_probe.ts, 176.6 -> 175.7 avg),
// both within ~2% of the pre-change numbers and inside the shipped bands.
// Measured at the level-20 balance anchor, the only tier the balance contract
// covers; revisit if a higher cap shifts the flat-bonus/finisher share.
export const CAT_FORM_DAMAGE_MULT = 1.22;

export function isCatForm(e: Entity): boolean {
  for (const a of e.auras) if (a.kind === 'form_cat') return true;
  return false;
}

// Effective base swing speed in seconds, BEFORE haste/slow auras
// (`swingIntervalMult`). Wolf Form ignores the equipped weapon and swings at
// the fixed cat cadence; every other entity swings at its own weapon speed.
export function baseSwingSpeed(e: Entity): number {
  return isCatForm(e) ? CAT_FORM_SWING_SPEED : e.weapon.speed;
}

// Wolf Form auto-attacks rescale the carried weapon's per-swing roll to the
// fixed paw cadence, the same shape as the instant normalization below: the
// roll times CAT_FORM_SWING_SPEED over speed reads as the weapon's authored
// dps delivered at the cat cadence, so a slow big-roll weapon cannot inflate
// the fast swings and white DPS is weapon-speed independent.
export function catAutoWeaponRollMult(e: Entity, weapon: WeaponInfo): number {
  return isCatForm(e) ? CAT_FORM_SWING_SPEED / Math.max(0.1, weapon.speed) : 1;
}

// The feral form damage multiplier for a swing by this entity: the tuning
// constant above in Wolf Form, neutral for everyone else.
export function catFormDamageMult(e: Entity): number {
  return isCatForm(e) ? CAT_FORM_DAMAGE_MULT : 1;
}

// Rescale for a FLAT on-every-landed-swing damage source (Requital Aura, the
// paladin party buff): such a source was balanced around the old borrowed
// cadence, and at the 1.0s paw speed a cat lands ~80% more swings, so without
// this its damage per second silently inflates by the same ~80%. The cadence
// ratio keeps the source's per-second contribution unchanged by the
// standardization; every other attacker keeps the full authored value.
export function catFlatSwingAdderMult(e: Entity): number {
  return isCatForm(e) ? CAT_FORM_SWING_SPEED / CAT_FORM_LEGACY_SWING_SPEED : 1;
}

// Classic instant-attack normalization speeds (seconds), by weapon class. An
// instant special attack that opts into normalization computes its weapon
// damage as if the weapon swung at this fixed speed, not its real speed, so a
// slow high-per-hit weapon cannot inflate an energy-gated instant. Daggers
// normalize to 1.7 and every other one-hander to 2.4, exactly like the
// classic era; this repo's rogues only ever wield one of the two.
export const DAGGER_NORMALIZED_SPEED = 1.7;
export const ONE_HAND_NORMALIZED_SPEED = 2.4;

export function normalizedInstantSpeed(weapon: WeaponInfo): number {
  return weapon.dagger ? DAGGER_NORMALIZED_SPEED : ONE_HAND_NORMALIZED_SPEED;
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
