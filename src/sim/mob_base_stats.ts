// A mob template's base combat numbers at a level, classic-style elite scaling
// (~2.3x health, ~1.5x damage). Pure leaf shared by createMob and anything that
// must fight with a template's numbers (the Graveyard Shift Morthen profile).

import type { MobTemplate } from './types';

export interface MobBaseStats {
  maxHp: number;
  weapon: { min: number; max: number; speed: number };
  armor: number;
}

export function mobBaseStats(template: MobTemplate, level: number): MobBaseStats {
  const hpMult = template.elite ? 2.3 : 1;
  const dmgMult = template.elite ? 1.5 : 1;
  const dmg = (template.dmgBase + template.dmgPerLevel * (level - 1)) * dmgMult;
  return {
    maxHp: Math.round((template.hpBase + template.hpPerLevel * (level - 1)) * hpMult),
    weapon: {
      min: Math.round(dmg * 0.8),
      max: Math.round(dmg * 1.25),
      speed: template.attackSpeed,
    },
    // Armor scales from level 1 like hp/dmg: a template has no armorBase, so a
    // level-1 mob gets 0 and each level adds armorPerLevel.
    armor: Math.round(template.armorPerLevel * (level - 1)),
  };
}
