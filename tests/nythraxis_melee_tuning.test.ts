// Nythraxis raid boss melee retune (2026-09-07): raw white-damage swing lands
// ~90% of the lower comparator final boss on each difficulty (normal vs.
// ignivar_herald_of_the_last_flame, heroic vs.
// varkhul_forgefather_of_the_last_flame; see dungeon_difficulty.ts). Only the
// boss's own melee moves; the encounter's adds keep their existing per-mob
// factors. Exercises the real production spawn path
// (mobTemplateForDungeonDifficulty + createMob).

import { describe, expect, it } from 'vitest';
import {
  HEROIC_DUNGEON_TUNING,
  NORMAL_DUNGEON_TUNING,
} from '../src/sim/content/dungeon_difficulty';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { mobTemplateForDungeonDifficulty } from '../src/sim/instances/difficulty';
import type { DungeonDifficulty } from '../src/sim/types';

const RAID = 'nythraxis_boss_arena';
const RAID_BOSS = 'nythraxis_scourge_of_thornpeak';
const IGNIVAR_RAID = 'ignivar_raid_arena';
const IGNIVAR_BOSS = 'ignivar_herald_of_the_last_flame';
const VARKHUL_ROOM = 'ignivar_inner_crucible';
const VARKHUL_BOSS = 'varkhul_forgefather_of_the_last_flame';

function rawWeapon(
  mobId: string,
  dungeonId: string,
  difficulty: DungeonDifficulty,
  levelOverride?: number,
): { min: number; max: number } {
  const template = mobTemplateForDungeonDifficulty(MOBS[mobId], dungeonId, difficulty);
  const level = levelOverride ?? template.maxLevel;
  const mob = createMob(1, template, level, { x: 0, y: 0, z: 0 });
  return { min: mob.weapon.min, max: mob.weapon.max };
}

describe('Nythraxis raid boss melee retune', () => {
  it('spawns the normal boss at the calibrated raw swing (production spawn path)', () => {
    expect(rawWeapon(RAID_BOSS, RAID, 'normal', 20)).toEqual({ min: 257, max: 402 });
  });

  it('spawns the heroic boss at the calibrated raw swing (production spawn path)', () => {
    expect(rawWeapon(RAID_BOSS, RAID, 'heroic')).toEqual({ min: 367, max: 573 });
  });

  it('lands both difficulties within a whisker of 90% of their comparator final boss', () => {
    const normalBoss = rawWeapon(RAID_BOSS, RAID, 'normal', 20);
    const normalComparator = rawWeapon(IGNIVAR_BOSS, IGNIVAR_RAID, 'normal', 20);
    expect(normalBoss.min / normalComparator.min).toBeCloseTo(0.9, 1);
    expect(normalBoss.max / normalComparator.max).toBeCloseTo(0.9, 1);

    const heroicBoss = rawWeapon(RAID_BOSS, RAID, 'heroic');
    const heroicComparator = rawWeapon(VARKHUL_BOSS, VARKHUL_ROOM, 'heroic');
    expect(heroicBoss.min / heroicComparator.min).toBeCloseTo(0.9, 1);
    expect(heroicBoss.max / heroicComparator.max).toBeCloseTo(0.9, 1);
  });

  it('keeps Nythraxis strictly under its comparator on both difficulties (stays the easier raid)', () => {
    expect(rawWeapon(RAID_BOSS, RAID, 'normal', 20).max).toBeLessThan(
      rawWeapon(IGNIVAR_BOSS, IGNIVAR_RAID, 'normal', 20).max,
    );
    expect(rawWeapon(RAID_BOSS, RAID, 'heroic').max).toBeLessThan(
      rawWeapon(VARKHUL_BOSS, VARKHUL_ROOM, 'heroic').max,
    );
  });

  it('keeps heroic hitting harder than normal for the same boss', () => {
    const normalBoss = rawWeapon(RAID_BOSS, RAID, 'normal', 20);
    const heroicBoss = rawWeapon(RAID_BOSS, RAID, 'heroic');
    expect(heroicBoss.min).toBeGreaterThan(normalBoss.min);
    expect(heroicBoss.max).toBeGreaterThan(normalBoss.max);
  });

  it('leaves every add wave on its existing per-mob factor (boss-only retune)', () => {
    expect(NORMAL_DUNGEON_TUNING[RAID].damageMultiplierByMob.nythraxis_skeleton_warrior).toBe(5);
    const heroicByMob = HEROIC_DUNGEON_TUNING[RAID].damageMultiplierByMob;
    expect(heroicByMob?.nythraxis_skeleton_warrior).toBe(3.75);
    expect(heroicByMob?.nythraxis_heroic_warrior_add).toBe(3.75);
    expect(heroicByMob?.nythraxis_heroic_priest_add).toBe(8);
    expect(heroicByMob?.nythraxis_heroic_rogue_add).toBe(6);
  });
});
