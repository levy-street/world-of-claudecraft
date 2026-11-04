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
// is a deliberate design choice, documented below.

/**
 * Share of the owner's max health added to a hunter pet's template pool.
 *
 * Max health is the basis rather than stamina because a pet here has no stamina stat:
 * its pool is the flat template ladder `hpBase + hpPerLevel * (level - 1)`.
 *
 * 60% is the TANK share, the same one a warlock's threat-holding pet gets
 * (WARLOCK_TANK_PET_OWNER_HP_SHARE below): every tameable beast taunts (Growl, see
 * pet_taunt_gate.ts), so a hunter pet is a tank pet. It was 25% (a stamina-faithful
 * port of the classic-era 45% stamina rule), which left a level-20 beast at 502 to 682
 * health, low enough for a single big spell to kill it. A test pins that every tameable
 * template can taunt, so this premise cannot drift silently.
 */
export const PET_OWNER_HP_SHARE = 0.6;

/**
 * Share of the owner's max health added to a warlock pet's template pool (the
 * demons and the Necromancy undead). Before this, warlock pets kept only their
 * flat template pool, so at level 20 a single big spell killed Emberkin (363)
 * or the Bone Mage (193), while every normal tamed beast already sat above 500.
 * Health only: their armor, damage and haste stay as authored.
 */
export const WARLOCK_PET_OWNER_HP_SHARE = 0.5;

/** The larger share for a warlock pet that holds threat (Duskmurk, Graveguard). */
export const WARLOCK_TANK_PET_OWNER_HP_SHARE = 0.6;

/**
 * Warlock pets that never inherit: the Pyre Colossus is a 30 sec Ruination
 * cooldown that already has the largest pool, not a standing companion.
 */
export const WARLOCK_PET_HP_SHARE_EXCLUDED: ReadonlySet<string> = new Set(['pyre_colossus']);

/** The owner health share for a warlock pet, or 0 when it does not inherit. */
export function warlockPetOwnerHpShare(templateId: string, isTank: boolean): number {
  if (WARLOCK_PET_HP_SHARE_EXCLUDED.has(templateId)) return 0;
  return isTank ? WARLOCK_TANK_PET_OWNER_HP_SHARE : WARLOCK_PET_OWNER_HP_SHARE;
}

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
 * The pet mirrors the owner's total melee haste (item-set bonuses, haste rating,
 * and meleeHastePct talents) one-for-one rather than at a fraction, unlike the AP/HP/
 * armor shares above.
 *
 * Unlike those three, this ratio does NOT have a classic-era formula, a checked-in
 * reference, or a measured result behind it (the framework's usual bar, see the
 * provenance note above): real classic-era hunter pets do not scale with the
 * owner's haste stat at all, so there is nothing to port. The 1:1 value instead
 * follows the ONE precedent this game already sets for hunter/pet haste (Pack
 * Rally applies the identical `buff_haste` value to both the hunter and the pet)
 * rather than inventing an unrelated fraction. That precedent is a temporary AURA,
 * a different axis from a passive baseline stat, so treat 1:1 as the best current
 * model, not a verified constant: revisit with the class owner if it needs a
 * different ratio.
 *
 * What is NOT a judgment call: that the share should be nonzero. Before this, the
 * pet's `meleeHaste` stayed at its `baseEntity` default of 0 for its whole life,
 * so a hunter's attack-speed gear did nothing for the pet even though the hunter's
 * own swings sped up, and even though Unleash Beast's own tooltip already promises
 * pet attack speed responds to the hunter (a separate, already-correct mechanic:
 * see `packlordPetHasteMultiplier` in hunter_packlord.ts).
 */
export const PET_OWNER_HASTE_SHARE = 1;

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
  /** The pet's melee haste, mirrored one-for-one from the owner's melee haste. */
  meleeHaste: number;
}

/** The owner fields the inheritance reads. Keeps the math testable without an Entity. */
export interface PetScalingOwner {
  maxHp: number;
  armor: number;
  rangedPower: number;
  meleeHaste: number;
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
    meleeHaste: Math.max(0, owner.meleeHaste * PET_OWNER_HASTE_SHARE),
  };
}

/**
 * Heel speed for a pet catching up to its owner. The old floor was a fixed
 * `RUN_SPEED * 1.1` (7.7 yd/s), which a mount beat outright: riding training adds
 * speed, so the pet fell behind until the 60 yd teleport rescued it.
 * Tracking the owner's ACTUAL
 * speed keeps the pet with its hunter whatever the owner is riding, while a fast
 * beast still runs at its own higher speed.
 *
 * @param petMoveSpeed the pet's own template move speed
 * @param ownerSpeed the owner's current effective speed, mount and buffs included
 */
export function petHeelSpeed(petMoveSpeed: number, ownerSpeed: number): number {
  return Math.max(petMoveSpeed, ownerSpeed * PET_CATCHUP_SPEED_MULT);
}
