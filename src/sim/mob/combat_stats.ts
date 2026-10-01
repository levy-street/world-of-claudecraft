// A mob's spawn-time combat block (health, melee weapon, armor) from its
// template and level: the one owner of the classic-style elite scaling
// (~2.3x health, ~1.5x damage) and the weapon spread around the level's
// damage figure. `createMob` (entity.ts) stamps exactly these numbers onto a
// fresh spawn, so anything that reports a mob's base stats (the mob inspect
// window's template fallback, its tests) reads the same math instead of a
// second hand-carried copy. Instance tuning (heroic/normal dungeon retunes,
// rift ranks) rewrites the TEMPLATE before this runs, never these formulas.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no rng.

import type { MobTemplate } from '../types';

export interface MobCombatStats {
  readonly maxHp: number;
  readonly weaponMin: number;
  readonly weaponMax: number;
  readonly attackSpeed: number;
  readonly armor: number;
}

export function mobCombatStats(template: MobTemplate, level: number): MobCombatStats {
  const hpMult = template.elite ? 2.3 : 1;
  const dmgMult = template.elite ? 1.5 : 1;
  const dmg = (template.dmgBase + template.dmgPerLevel * (level - 1)) * dmgMult;
  return {
    maxHp: Math.round((template.hpBase + template.hpPerLevel * (level - 1)) * hpMult),
    weaponMin: Math.round(dmg * 0.8),
    weaponMax: Math.round(dmg * 1.25),
    attackSpeed: template.attackSpeed,
    // A template has no armorBase, so a level-1 mob gets 0 and each level adds
    // armorPerLevel.
    armor: Math.round(template.armorPerLevel * (level - 1)),
  };
}
