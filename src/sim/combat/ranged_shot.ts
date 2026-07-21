// The effective ranged weapon behind an auto-shot / wand bolt (a pure leaf,
// unit-tested directly).
//
// Casters have no equippable ranged slot, so their wand is the class-defined
// sidearm: its damage range and speed come from CLASSES[cls].ranged and never
// change with gear. Hunters, by contrast, shoot with their equipped weapon, so
// Auto Shot must scale off that weapon's damage range and swing speed (and thus
// its DPS), exactly the way a melee swing scales off the weapon it carries.
// Ranged attack power (agility, via Entity.rangedPower) is layered on top at the
// swing site; this leaf only decides which weapon profile the shot uses.
//
// `src/sim`-pure: no DOM/Three, no Math.random/Date.now. A total function of its
// two inputs, so it stays deterministic and host-agnostic.

export interface RangedProfile {
  min: number;
  max: number;
  speed: number;
}

// Resolve the min/max/speed an auto-shot / wand bolt fires with. Wands keep the
// class ranged profile; every other ranged attacker (i.e. the hunter) uses the
// carried weapon. School/dead-zone/range still come from the class `ranged` def.
export function rangedShotProfile(
  ranged: { min: number; max: number; speed: number; wand?: boolean },
  weapon: RangedProfile,
): RangedProfile {
  if (ranged.wand) return { min: ranged.min, max: ranged.max, speed: ranged.speed };
  return { min: weapon.min, max: weapon.max, speed: weapon.speed };
}
