// Open-world mob tuning: the one level curve every open-world spawn rides.
//
// Mob templates author their stats as a per-template linear ladder
// (hpBase + hpPerLevel * (level - 1), the same for damage and armor; createMob in
// ../entity.ts). Those ladders sit on the original design anchor (mob health
// 40 + 18 per level, docs/design/spell-ranks.md), but player power has grown far
// past it: class health tables, the gear stamina baseline, talent rows and
// combat ratings. Measured with the leveling bench (scripts/leveling_ttk_probe.ts),
// a same-level kill took a few seconds where the anchor asks for 12 to 20.
//
// Rather than re-author every template, open-world spawns pass through this
// curve: a health, melee damage and armor multiplier by MOB level, the same
// transform shape the instanced difficulty layer uses
// (mobTemplateForDungeonDifficulty in ../instances/difficulty.ts). The templates
// themselves stay untouched, so:
//  - dungeon, heroic, raid, rift, delve and world-boss spawns keep their own
//    tuning tables, which were authored against the base templates;
//  - hunter pets, which are rebuilt from the base template on tame and on every
//    owner level-up (pet/pet_commands.ts syncPetLevel), keep their own scaling.
//
// Only the open-world spawn sites call this: the camp loop and the tame
// replacement respawn in ../sim.ts, world-quest champions and ambush waves,
// summoned quest foes (../encounters/quest_summon.ts), and dev spawns. Encounter
// adds (boss adds, egg hatchlings) keep their authored health. It draws no rng, so no spawn's draw order moves. Escort ambush
// waves (../escort.ts) deliberately stay on the authored ladder: the escortee
// never fights back and is sized to outlast a wave until the player peels it,
// so a wave that lived three times as long against an unchanged escortee would
// break the encounter rather than retune it.

import { createMob } from '../entity';
import type { Entity, MobTemplate, Vec3 } from '../types';

export interface OpenWorldMobScale {
  readonly health: number;
  readonly damage: number;
  readonly armor: number;
}

interface CurvePoint extends OpenWorldMobScale {
  readonly level: number;
}

// Multipliers by mob level, piecewise-linear between points and flat past the
// last one. Level 1 is never scaled: the tutorial shore and the first quests
// stay as gentle as they were. Full strength from level 8: health x3.25, melee
// and mechanic damage x1.35, armor unchanged (owner pick, 2026-10-06). Bench
// result, median same-level kill over all 19 DPS specs in today's solo gear:
// 15.6 / 13.6 / 13.2 seconds at levels 10 / 14 / 20 (was 4.5 to 6), 12 to 13 of
// the 19 inside 12 to 20 seconds at every level. Health x3.0 fell to 11.4
// seconds by level 20, under the band.
export const OPEN_WORLD_MOB_CURVE: readonly CurvePoint[] = [
  { level: 1, health: 1, damage: 1, armor: 1 },
  { level: 3, health: 1.7, damage: 1.1225, armor: 1 },
  { level: 8, health: 3.25, damage: 1.35, armor: 1 },
];

const NEUTRAL: OpenWorldMobScale = { health: 1, damage: 1, armor: 1 };

function scaleOf(point: CurvePoint): OpenWorldMobScale {
  return { health: point.health, damage: point.damage, armor: point.armor };
}

export function openWorldMobScale(level: number): OpenWorldMobScale {
  const points = OPEN_WORLD_MOB_CURVE;
  if (points.length === 0) return NEUTRAL;
  if (level <= points[0].level) return scaleOf(points[0]);
  for (let i = 1; i < points.length; i++) {
    const lo = points[i - 1];
    const hi = points[i];
    if (level > hi.level) continue;
    const t = (level - lo.level) / (hi.level - lo.level);
    return {
      health: lo.health + (hi.health - lo.health) * t,
      damage: lo.damage + (hi.damage - lo.damage) * t,
      armor: lo.armor + (hi.armor - lo.armor) * t,
    };
  }
  return scaleOf(points[points.length - 1]);
}

// Templates the curve leaves alone: decoration and practice targets, world
// bosses (participant-scaled health of their own), and puzzle objects whose
// health is a hit count, not a fight (the 1 HP egg clutches, quest-gated
// destructibles, zero-XP props).
export function isOpenWorldTuned(template: MobTemplate): boolean {
  if (template.dummy || template.ambient || template.friendlyPracticeTarget) return false;
  if (template.worldBoss || template.requiresQuestId) return false;
  return template.xpMult !== 0;
}

export function openWorldMobTemplate(template: MobTemplate, level: number): MobTemplate {
  if (!isOpenWorldTuned(template)) return template;
  const scale = openWorldMobScale(level);
  if (scale.health === 1 && scale.damage === 1 && scale.armor === 1) return template;
  return {
    ...template,
    hpBase: template.hpBase * scale.health,
    hpPerLevel: template.hpPerLevel * scale.health,
    dmgBase: template.dmgBase * scale.damage,
    dmgPerLevel: template.dmgPerLevel * scale.damage,
    armorPerLevel: template.armorPerLevel * scale.armor,
  };
}

// Mechanic numbers (pulses, stomps, hardcasts; mend and ward heals) are read
// from the base table at FIRE time, so the template transform cannot reach
// them. The spawn carries the per-entity multipliers the dungeon layer uses,
// applied at each fire site after the rng draw: mechanic damage keeps pace with
// the melee swing it lands between, support heals with the larger pool.
export function applyOpenWorldMobTuning(mob: Entity, template: MobTemplate): void {
  if (!isOpenWorldTuned(template)) return;
  const scale = openWorldMobScale(mob.level);
  if (scale.damage !== 1) mob.mechanicDamageMult = scale.damage;
  if (scale.health !== 1) mob.mechanicHealMult = scale.health;
}

/** createMob for an open-world spawn: the curve's template, then its stamps. */
export function spawnOpenWorldMob(
  id: number,
  template: MobTemplate,
  level: number,
  pos: Vec3,
): Entity {
  const mob = createMob(id, openWorldMobTemplate(template, level), level, pos);
  applyOpenWorldMobTuning(mob, template);
  return mob;
}
