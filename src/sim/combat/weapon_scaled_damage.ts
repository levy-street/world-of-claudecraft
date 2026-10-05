// Weapon-scaled direct damage: a directDamage effect that sets `weaponMult`
// adds a share of the caster's weapon hit to its authored min/max range, so
// the spell grows with the weapon instead of staying a flat number.
//
// The weapon hit is the same base a melee swing uses (the weapon's raw roll
// plus Attack Power / 14 x the weapon's real speed), without armor, dodge, or
// the swing's crit table: the caller still resolves the hit as its own school
// (Tolling Hammer stays a Holy spell). One rng.range draw over the combined
// range, exactly the draw an unscaled directDamage takes, so adding the field
// never shifts the shared rng stream. Pure: plain numbers in, plain numbers out.

import type { WeaponInfo } from '../types';

export function weaponScaledDamageRange(
  baseMin: number,
  baseMax: number,
  weapon: WeaponInfo,
  attackPower: number,
  weaponMult: number,
): { min: number; max: number } {
  const apPerSwing = (attackPower / 14) * weapon.speed;
  return {
    min: baseMin + weaponMult * (weapon.min + apPerSwing),
    max: baseMax + weaponMult * (weapon.max + apPerSwing),
  };
}
