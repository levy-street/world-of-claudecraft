// Direct unit tests for the heroic-difficulty module pair:
// src/sim/instances/difficulty.ts (the pure transform) and
// src/sim/content/dungeon_difficulty.ts (the tuning data). The integration
// paths (claimInstance, boss adds, marks) are covered in tests/dungeons.test.ts;
// this file pins the pure math and the data contract to exact literals.

import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING, HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { ITEMS, MOBS } from '../src/sim/data';
import {
  applyHeroicMobTuning,
  claimDifficultyForDungeon,
  HEROIC_DUNGEON_IDS,
  mobLevelForDungeonDifficulty,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import type { Entity, MobTemplate } from '../src/sim/types';

// Round numbers so every transformed field pins to an exact literal below.
const SYNTHETIC: MobTemplate = {
  id: 'synthetic_test_mob',
  name: 'Synthetic Test Mob',
  minLevel: 10,
  maxLevel: 12,
  family: 'humanoid',
  hpBase: 100,
  hpPerLevel: 10,
  dmgBase: 20,
  dmgPerLevel: 2,
  attackSpeed: 2,
  armorPerLevel: 4,
  moveSpeed: 3,
  aggroRadius: 10,
  loot: [],
  scale: 1,
  color: 0xffffff,
};

describe('heroic tuning data contract', () => {
  it('covers the four five-player dungeons plus the raid arena, with their final bosses', () => {
    expect([...HEROIC_DUNGEON_IDS].sort()).toEqual([
      'drowned_temple',
      'gravewyrm_sanctum',
      'hollow_crypt',
      'nythraxis_boss_arena',
      'sunken_bastion',
    ]);
    expect(
      Object.fromEntries(Object.values(HEROIC_DUNGEON_TUNING).map((t) => [t.id, t.finalBossId])),
    ).toEqual({
      hollow_crypt: 'morthen',
      sunken_bastion: 'vael_the_mistcaller',
      drowned_temple: 'ysolei',
      gravewyrm_sanctum: 'korzul_the_gravewyrm',
      nythraxis_boss_arena: 'nythraxis_scourge_of_thornpeak',
    });
    for (const tuning of Object.values(HEROIC_DUNGEON_TUNING)) {
      expect(tuning.level).toBe(22);
      expect(MOBS[tuning.finalBossId], `${tuning.id} finalBossId is a real mob`).toBeTruthy();
    }
    expect(ITEMS[HEROIC_MARK_ITEM_ID]).toBeTruthy();
    // The five-mans pay one mark per participant; the raid pays three.
    expect(
      Object.fromEntries(
        Object.values(HEROIC_DUNGEON_TUNING).map((t) => [t.id, t.marksPerParticipant]),
      ),
    ).toEqual({
      hollow_crypt: 1,
      sunken_bastion: 1,
      drowned_temple: 1,
      gravewyrm_sanctum: 1,
      nythraxis_boss_arena: 3,
    });
  });

  it('pins the classic-era heroic multipliers per dungeon', () => {
    // The four five-mans are damage-EQUALIZED at the level-22 pin: the raw
    // damageMultiplier per dungeon is set so an average elite-trash swing lands
    // ~300 post-mitigation on the reference geared shaman (see the tuning
    // table's comment), which inverts the multiplier ladder because the harder
    // dungeons already carry bigger base weapon damage. Exact literals so an
    // accidental retune (or a revert to the old un-equalized ladder) reddens
    // deliberately.
    expect(
      Object.fromEntries(
        Object.values(HEROIC_DUNGEON_TUNING).map((t) => [
          t.id,
          [t.healthMultiplier, t.damageMultiplier, t.armorMultiplier],
        ]),
      ),
    ).toEqual({
      hollow_crypt: [1.9, 6.8, 1.3],
      sunken_bastion: [2.0, 6.2, 1.3],
      drowned_temple: [2.6, 5.7, 1.25],
      gravewyrm_sanctum: [2.0, 5.4, 1.2],
      // The raid multiplier is smaller in RELATIVE terms because normal
      // Nythraxis already lands the game's hardest hits (see the tuning
      // table's comment); its percentage mechanics scale separately in
      // encounters/nythraxis.ts (Soul Rend 1.5x, lethal Deathless Rage).
      nythraxis_boss_arena: [1.6, 2.0, 1.2],
    });
  });
});

describe('claimDifficultyForDungeon', () => {
  it('grants heroic to the supported dungeons and the raid arena only', () => {
    expect(claimDifficultyForDungeon('hollow_crypt', 'heroic')).toBe('heroic');
    expect(claimDifficultyForDungeon('gravewyrm_sanctum', 'heroic')).toBe('heroic');
    expect(claimDifficultyForDungeon('nythraxis_boss_arena', 'heroic')).toBe('heroic');
    // The attunement dungeon is story content: normal even when heroic is selected.
    expect(claimDifficultyForDungeon('nythraxis_crypt', 'heroic')).toBe('normal');
    expect(claimDifficultyForDungeon('no_such_dungeon', 'heroic')).toBe('normal');
    expect(claimDifficultyForDungeon('hollow_crypt', 'normal')).toBe('normal');
  });
});

describe('mobTemplateForDungeonDifficulty', () => {
  it('returns the SAME template untouched for normal difficulty', () => {
    expect(mobTemplateForDungeonDifficulty(SYNTHETIC, 'hollow_crypt', 'normal')).toBe(SYNTHETIC);
    expect(mobTemplateForDungeonDifficulty(SYNTHETIC, 'no_such_dungeon', 'heroic')).toBe(SYNTHETIC);
  });

  it('produces an exact heroic transform without mutating the base template', () => {
    const before = JSON.stringify(SYNTHETIC);
    const heroic = mobTemplateForDungeonDifficulty(SYNTHETIC, 'hollow_crypt', 'heroic');
    // hollow_crypt tuning: health x1.9, damage x6.8, armor x1.3, level 22.
    expect(heroic).not.toBe(SYNTHETIC);
    expect(heroic.minLevel).toBe(22);
    expect(heroic.maxLevel).toBe(22);
    expect(heroic.hpBase).toBeCloseTo(190, 10);
    expect(heroic.hpPerLevel).toBeCloseTo(19, 10);
    expect(heroic.dmgBase).toBeCloseTo(136, 10);
    expect(heroic.dmgPerLevel).toBeCloseTo(13.6, 10);
    expect(heroic.armorPerLevel).toBeCloseTo(5.2, 10);
    // Every heroic mob is floored to the anti-kite speed (player RUN_SPEED is
    // 7); a template already at or above the floor keeps its own speed.
    expect(heroic.moveSpeed).toBe(8);
    expect(
      mobTemplateForDungeonDifficulty({ ...SYNTHETIC, moveSpeed: 10.5 }, 'hollow_crypt', 'heroic')
        .moveSpeed,
    ).toBe(10.5);
    // Untouched fields carry over; the base template is never mutated.
    expect(heroic.attackSpeed).toBe(SYNTHETIC.attackSpeed);
    expect(JSON.stringify(SYNTHETIC)).toBe(before);
  });
});

describe('mobLevelForDungeonDifficulty', () => {
  it('pins heroic spawns to the tuning level and passes rolled levels through otherwise', () => {
    expect(mobLevelForDungeonDifficulty('hollow_crypt', 'heroic', 11)).toBe(22);
    expect(mobLevelForDungeonDifficulty('hollow_crypt', 'normal', 11)).toBe(11);
    expect(mobLevelForDungeonDifficulty('no_such_dungeon', 'heroic', 11)).toBe(11);
  });
});

describe('applyHeroicMobTuning', () => {
  it('stamps the fire-time mechanic multipliers only for heroic spawns', () => {
    const mob = { mechanicDamageMult: undefined, mechanicHealMult: undefined } as Entity;
    applyHeroicMobTuning(mob, 'sunken_bastion', 'heroic');
    expect(mob.mechanicDamageMult).toBe(HEROIC_DUNGEON_TUNING.sunken_bastion.damageMultiplier);
    expect(mob.mechanicHealMult).toBe(HEROIC_DUNGEON_TUNING.sunken_bastion.healthMultiplier);

    const normalMob = { mechanicDamageMult: undefined, mechanicHealMult: undefined } as Entity;
    applyHeroicMobTuning(normalMob, 'sunken_bastion', 'normal');
    expect(normalMob.mechanicDamageMult).toBeUndefined();
    applyHeroicMobTuning(normalMob, 'no_such_dungeon', 'heroic');
    expect(normalMob.mechanicDamageMult).toBeUndefined();
  });

  it('grants CC and snare immunity to boss-flagged heroic spawns only', () => {
    const boss = { templateId: 'morthen' } as Entity;
    applyHeroicMobTuning(boss, 'hollow_crypt', 'heroic');
    expect(boss.ccImmune).toBe(true);
    expect(boss.slowImmune).toBe(true);

    const trash = { templateId: 'crypt_shambler' } as Entity;
    applyHeroicMobTuning(trash, 'hollow_crypt', 'heroic');
    expect(trash.ccImmune).toBeUndefined();
    expect(trash.slowImmune).toBeUndefined();

    const normalBoss = { templateId: 'morthen' } as Entity;
    applyHeroicMobTuning(normalBoss, 'hollow_crypt', 'normal');
    expect(normalBoss.ccImmune).toBeUndefined();
    expect(normalBoss.slowImmune).toBeUndefined();
  });
});
