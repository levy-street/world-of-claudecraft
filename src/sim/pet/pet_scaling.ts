// Owner -> pet stat inheritance for hunter beast pets, plus the heel-speed floor.
//
// A tamed pet is a clone of the wild mob it came from, so before this module its
// power was frozen at tame time: health and damage came only from the template's
// hpBase/dmgBase ladder, and Entity.attackPower stayed 0 for the pet's whole life.
// Two consequences fell out of that. Gear did nothing for a pet, so a hunter who
// out-geared their beast kept a level-appropriate but permanently weak companion;
// and which beast a player happened to tame decided their damage, because the
// tameable ladder spans roughly 306 to 486 health and 17 to 32 damage per second
// at level 20 with no way to close the gap.
//
// Classic-era hunter pet scaling answers both by making the pet a SHARE of its
// owner rather than a snapshot of a mob: the pet inherits a fraction of the
// hunter's attack power, health, and armor, and re-derives whenever the hunter's
// stats change. The shares below follow that model.
//
// This is a pure leaf (no SimContext, no rng, no clock): pet_commands/pet_ai own
// the application, and tests import these functions directly.

import type { MobFamily } from '../types';

/**
 * The mob families a hunter can tame, and therefore exactly the pets that inherit
 * from their owner. Lives here so the tame gate (pet_commands.tameError) and the
 * scaling gate read ONE list: a family that becomes tameable must start inheriting
 * in the same change, or a new pet would silently arrive with none of the owner's
 * stats.
 */
export const TAMEABLE_FAMILIES: readonly MobFamily[] = ['beast', 'spider'];

// Set lookup rather than a scan of the array above: the scaling gate consults this
// for every hunter pet on every tick.
const TAMEABLE_FAMILY_SET: ReadonlySet<MobFamily> = new Set(TAMEABLE_FAMILIES);

/** Whether a hunter can tame this family (and so whether its pets inherit). */
export function isTameableFamily(family: MobFamily): boolean {
  return TAMEABLE_FAMILY_SET.has(family);
}

// Provenance of the three ratios, per the rule in docs/design/spell-balance-framework.md
// that a coefficient needs a classic-era formula, a checked-in reference, or a measured
// result. Armor and attack power are the classic-era inheritance ratios verbatim. Health
// is the one adaptation, and is derived below rather than picked.

/**
 * Share of the owner's max health added to the pet's template pool.
 *
 * The classic-era rule inherits a share of the hunter's STAMINA, which does not port
 * directly: a pet here has no stamina stat at all, its pool is the flat template ladder
 * `hpBase + hpPerLevel * (level - 1)`, so there is nothing for a stamina ratio to apply
 * to. Re-basing the same rule onto the owner's health is what this is, and at the
 * level-20 reference the two agree closely: the classic 45% of the hunter's
 * stamina-derived health is 176, against 181 from 25% of max health (a 3% gap).
 *
 * Max health is deliberately the basis rather than the stamina component, because it is
 * the more CONSERVATIVE of the two once gear is involved: at best-in-slot the
 * stamina-faithful port would hand the pet 531 health where this hands it 379.
 *
 * The measured corroboration, per the framework's third arm: this lands a median
 * tameable beast in the warlock tank demons' durability band (which is the comparison
 * that matters, since those are the pets it competes with) instead of well under it,
 * which is why beast pets were dying to raid damage demons survived.
 */
export const PET_OWNER_HP_SHARE = 0.25;

/**
 * Share of the owner's armor added to the pet's template armor. This is the classic-era
 * hunter pet armor inheritance ratio, used as-is. Beast templates carry armorPerLevel 8
 * to 14 against a tank demon's 38 to 55, so it narrows the effective-health gap without
 * turning a damage pet into a tank.
 */
export const PET_OWNER_ARMOR_SHARE = 0.35;

/**
 * Share of the owner's ranged attack power the pet inherits as its own attack power.
 * This is the classic-era hunter pet ranged-attack-power inheritance ratio, used as-is.
 *
 * It is also the channel that makes a pet scale with hunter gear at all: mob swing
 * damage is `weaponRoll + (attackPower / 14) * weaponSpeed`, and a pet's attackPower was
 * previously 0 for its entire life.
 */
export const PET_OWNER_AP_SHARE = 0.22;

/**
 * How much faster than its owner a heeling pet may run while catching up. The
 * pet has to close ground it already lost, so it needs headroom above the
 * owner's own speed rather than a fixed sprint.
 */
export const PET_CATCHUP_SPEED_MULT = 1.1;

/** The owner-derived stats a pet inherits. */
export interface PetOwnerScaling {
  /** Health added on top of the pet's template pool. */
  hp: number;
  /** Armor added on top of the pet's template armor. */
  armor: number;
  /** The pet's attack power, inherited whole from the owner's ranged power. */
  attackPower: number;
}

/** The owner fields the inheritance reads. Keeps the math testable without an Entity. */
export interface PetScalingOwner {
  maxHp: number;
  armor: number;
  rangedPower: number;
}

/**
 * The stats a pet inherits from its owner. Pure and idempotent: callers re-derive
 * from the template base plus this, never accumulate onto a previous result.
 */
export function petOwnerScaling(owner: PetScalingOwner): PetOwnerScaling {
  return {
    hp: Math.max(0, Math.round(owner.maxHp * PET_OWNER_HP_SHARE)),
    armor: Math.max(0, Math.round(owner.armor * PET_OWNER_ARMOR_SHARE)),
    attackPower: Math.max(0, Math.round(owner.rangedPower * PET_OWNER_AP_SHARE)),
  };
}

/**
 * Heel speed for a pet catching up to its owner. The old floor was a fixed
 * `RUN_SPEED * 1.1` (7.7 yd/s), which a mount beat outright: mounts add 60 to 80
 * percent, putting a mounted player at 11.2 to 12.6 yd/s, so the pet fell behind
 * every time until the 60 yd teleport rescued it. Tracking the owner's ACTUAL
 * speed keeps the pet with its hunter whatever the owner is riding, while a fast
 * beast still runs at its own higher speed.
 *
 * @param petMoveSpeed the pet's own template move speed
 * @param ownerSpeed the owner's current effective speed, mount and buffs included
 */
export function petHeelSpeed(petMoveSpeed: number, ownerSpeed: number): number {
  return Math.max(petMoveSpeed, ownerSpeed * PET_CATCHUP_SPEED_MULT);
}
