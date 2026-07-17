import { HEROIC_DUNGEON_TUNING } from '../content/dungeon_difficulty';
import { MOBS } from '../data';
import type { DungeonDifficulty, Entity, MobTemplate } from '../types';

export const HEROIC_DUNGEON_IDS = new Set(Object.keys(HEROIC_DUNGEON_TUNING));

// Every heroic-instance mob moves at least this fast (player RUN_SPEED is 7),
// so heroic pulls cannot be kited on foot; escapes need a sprint cooldown.
export const HEROIC_MIN_MOVE_SPEED = 8;

export function claimDifficultyForDungeon(
  dungeonId: string,
  selected: DungeonDifficulty,
): DungeonDifficulty {
  return selected === 'heroic' && HEROIC_DUNGEON_IDS.has(dungeonId) ? 'heroic' : 'normal';
}

// Boss-summoned add waves (spawnBossAdds passes { summonedAdd: true }) swing at
// the tuning table's softer addDamageMultiplier; everything else, including the
// spawn-list guards flanking a boss, uses the dungeon-wide damageMultiplier.
export interface HeroicSpawnRole {
  summonedAdd?: boolean;
}

export function mobTemplateForDungeonDifficulty(
  template: MobTemplate,
  dungeonId: string,
  difficulty: DungeonDifficulty,
  role?: HeroicSpawnRole,
): MobTemplate {
  if (difficulty !== 'heroic') return template;
  const tuning = HEROIC_DUNGEON_TUNING[dungeonId];
  if (!tuning) return template;
  const dmgMult = role?.summonedAdd ? tuning.addDamageMultiplier : tuning.damageMultiplier;
  return {
    ...template,
    minLevel: tuning.level,
    maxLevel: tuning.level,
    hpBase: template.hpBase * tuning.healthMultiplier,
    hpPerLevel: template.hpPerLevel * tuning.healthMultiplier,
    dmgBase: template.dmgBase * dmgMult,
    dmgPerLevel: template.dmgPerLevel * dmgMult,
    armorPerLevel: template.armorPerLevel * tuning.armorMultiplier,
    moveSpeed: Math.max(template.moveSpeed, HEROIC_MIN_MOVE_SPEED),
  };
}

export function mobLevelForDungeonDifficulty(
  dungeonId: string,
  difficulty: DungeonDifficulty,
  rolledLevel: number,
): number {
  if (difficulty !== 'heroic') return rolledLevel;
  return HEROIC_DUNGEON_TUNING[dungeonId]?.level ?? rolledLevel;
}

// Boss/support mechanic numbers (aoePulse, bigCast, stomp damage; mendAlly,
// wardAllies, stoneskin amounts) are read from the base MOBS table at FIRE
// time, not from the spawn-time transformed template, so the template
// multipliers above cannot reach them. Instead a heroic spawn carries these
// per-entity multipliers, applied at each fire site AFTER the rng draw (the
// draw count and order stay identical to normal, which the parity gate pins).
// Boss-flagged mobs additionally become CC- and snare-immune on heroic (the
// entity-level twins of the template ccImmune/slowImmune flags, which are
// also base-table reads): heroic bosses can be neither controlled nor kited.
export function applyHeroicMobTuning(
  mob: Entity,
  dungeonId: string,
  difficulty: DungeonDifficulty,
  role?: HeroicSpawnRole,
): void {
  if (difficulty !== 'heroic') return;
  const tuning = HEROIC_DUNGEON_TUNING[dungeonId];
  if (!tuning) return;
  mob.mechanicDamageMult = role?.summonedAdd ? tuning.addDamageMultiplier : tuning.damageMultiplier;
  mob.mechanicHealMult = tuning.healthMultiplier;
  if (MOBS[mob.templateId]?.boss) {
    mob.ccImmune = true;
    mob.slowImmune = true;
  }
}
