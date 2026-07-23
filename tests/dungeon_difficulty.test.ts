// Direct unit tests for the heroic-difficulty module pair:
// src/sim/instances/difficulty.ts (the pure transform) and
// src/sim/content/dungeon_difficulty.ts (the tuning data). The integration
// paths (claimInstance, boss adds, marks) are covered in tests/dungeons.test.ts;
// this file pins the pure math and the data contract to exact literals.

import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING, HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { DUNGEON_MOBS } from '../src/sim/content/dungeons';
import { TEMPLE_DUNGEON_MOBS } from '../src/sim/content/temple';
import { ITEMS, MOBS } from '../src/sim/data';
import {
  applyDungeonMobTuning,
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

  it('pins the floor-calibrated heroic multipliers per dungeon', () => {
    // Economy retune: the damageMultiplier per dungeon is set so the MINIMUM
    // non-crit swing of the dungeon's weakest spawn-list mob lands at least
    // 500 post-mitigation on the maximum-mitigation reference warrior at the
    // level-22 pin, and health is DOUBLED versus the previous calibration
    // (1.9/2.0/2.6/2.0/1.6 became 3.8/4.0/5.2/4.0/3.2). The ladder still
    // inverts because harder dungeons carry bigger base weapon damage.
    // Boss-summoned add waves are non-elite (no 1.5x swing multiplier), so
    // their addDamageMultiplier is LARGER than the trash value while landing
    // the same 500 floor. Exact literals so an accidental retune reddens
    // deliberately; the floors themselves are pinned by
    // tests/heroic_difficulty_floors.test.ts.
    expect(
      Object.fromEntries(
        Object.values(HEROIC_DUNGEON_TUNING).map((t) => [
          t.id,
          [t.healthMultiplier, t.damageMultiplier, t.addDamageMultiplier, t.armorMultiplier],
        ]),
      ),
    ).toEqual({
      hollow_crypt: [3.8, 20, 10, 1.3],
      sunken_bastion: [4.0, 18, 32.5, 1.3],
      drowned_temple: [5.2, 16.5, 30.5, 1.25],
      gravewyrm_sanctum: [4.0, 15.5, 29, 1.2],
      // The raid multiplier is smaller in RELATIVE terms because normal
      // Nythraxis already lands the game's hardest hits; the heroic boss
      // floors at 1200 through the dungeon-wide value while the encounter
      // add waves (spawned with no summonedAdd role) are held to the 500
      // line through damageMultiplierByMob, so the raid's
      // addDamageMultiplier stays an inert mirror of damageMultiplier.
      nythraxis_boss_arena: [3.2, 8.75, 8.75, 1.2],
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
    // hollow_crypt tuning: health x3.8, damage x20, armor x1.3, level 22.
    expect(heroic).not.toBe(SYNTHETIC);
    expect(heroic.minLevel).toBe(22);
    expect(heroic.maxLevel).toBe(22);
    expect(heroic.hpBase).toBeCloseTo(380, 10);
    expect(heroic.hpPerLevel).toBeCloseTo(38, 10);
    expect(heroic.dmgBase).toBeCloseTo(400, 10);
    expect(heroic.dmgPerLevel).toBeCloseTo(40, 10);
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

  it('scales a boss-SUMMONED add by addDamageMultiplier, everything else unchanged', () => {
    const add = mobTemplateForDungeonDifficulty(SYNTHETIC, 'hollow_crypt', 'heroic', {
      summonedAdd: true,
    });
    // hollow_crypt addDamageMultiplier is 10 (no crypt boss summons, inert).
    expect(add.dmgBase).toBeCloseTo(200, 10);
    expect(add.dmgPerLevel).toBeCloseTo(20, 10);
    // Health, armor, level, and the speed floor stay on the dungeon-wide tuning.
    expect(add.hpBase).toBeCloseTo(380, 10);
    expect(add.hpPerLevel).toBeCloseTo(38, 10);
    expect(add.armorPerLevel).toBeCloseTo(5.2, 10);
    expect(add.minLevel).toBe(22);
    expect(add.moveSpeed).toBe(8);
    // The role flag does nothing outside heroic.
    expect(
      mobTemplateForDungeonDifficulty(SYNTHETIC, 'hollow_crypt', 'normal', { summonedAdd: true }),
    ).toBe(SYNTHETIC);
  });
});

describe('mobLevelForDungeonDifficulty', () => {
  it('pins heroic spawns to the tuning level and passes rolled levels through otherwise', () => {
    expect(mobLevelForDungeonDifficulty('hollow_crypt', 'heroic', 11)).toBe(22);
    expect(mobLevelForDungeonDifficulty('hollow_crypt', 'normal', 11)).toBe(11);
    expect(mobLevelForDungeonDifficulty('no_such_dungeon', 'heroic', 11)).toBe(11);
  });
});

describe('applyDungeonMobTuning', () => {
  it('stamps the fire-time mechanic multipliers only for heroic spawns', () => {
    const mob = { mechanicDamageMult: undefined, mechanicHealMult: undefined } as Entity;
    applyDungeonMobTuning(mob, 'sunken_bastion', 'heroic');
    expect(mob.mechanicDamageMult).toBe(HEROIC_DUNGEON_TUNING.sunken_bastion.damageMultiplier);
    expect(mob.mechanicHealMult).toBe(HEROIC_DUNGEON_TUNING.sunken_bastion.healthMultiplier);

    // A boss-summoned add stamps the softer add multiplier on its mechanics too.
    const summoned = { mechanicDamageMult: undefined, mechanicHealMult: undefined } as Entity;
    applyDungeonMobTuning(summoned, 'sunken_bastion', 'heroic', { summonedAdd: true });
    expect(summoned.mechanicDamageMult).toBe(
      HEROIC_DUNGEON_TUNING.sunken_bastion.addDamageMultiplier,
    );
    expect(summoned.mechanicHealMult).toBe(HEROIC_DUNGEON_TUNING.sunken_bastion.healthMultiplier);

    const normalMob = { mechanicDamageMult: undefined, mechanicHealMult: undefined } as Entity;
    applyDungeonMobTuning(normalMob, 'sunken_bastion', 'normal');
    expect(normalMob.mechanicDamageMult).toBeUndefined();
    applyDungeonMobTuning(normalMob, 'no_such_dungeon', 'heroic');
    expect(normalMob.mechanicDamageMult).toBeUndefined();
  });

  it('stamps entity-level CC and snare immunity on boss-flagged heroic spawns only', () => {
    // The heroic entity stamp is belt and braces on top of the template flags
    // below: it stays boss-only and heroic-only (the applyAura gates check
    // template OR entity, so a normal boss is covered by its template).
    const boss = { templateId: 'morthen' } as Entity;
    applyDungeonMobTuning(boss, 'hollow_crypt', 'heroic');
    expect(boss.ccImmune).toBe(true);
    expect(boss.slowImmune).toBe(true);

    const trash = { templateId: 'crypt_shambler' } as Entity;
    applyDungeonMobTuning(trash, 'hollow_crypt', 'heroic');
    expect(trash.ccImmune).toBeUndefined();
    expect(trash.slowImmune).toBeUndefined();

    const normalBoss = { templateId: 'morthen' } as Entity;
    applyDungeonMobTuning(normalBoss, 'hollow_crypt', 'normal');
    expect(normalBoss.ccImmune).toBeUndefined();
    expect(normalBoss.slowImmune).toBeUndefined();
  });
});

describe('boss templates are CC and snare immune on BOTH difficulties', () => {
  it('every boss-flagged template of the five endgame instances carries both flags', () => {
    // The complete boss enumeration of the four five-mans plus the raid: these
    // are the ONLY boss: true templates in dungeons.ts + temple.ts (Korgath,
    // Velkhar, Sexton Marrow, Olen, Selthe, and the Nythraxis adds are
    // deliberately NOT boss-flagged). Template-level flags cover normal spawns
    // too: the applyAura gates read MOBS[templateId] at fire time, so a normal
    // Korzul can no longer be stunned or kited on a snare (the economy retune
    // assumes boss swings actually land).
    const bossIds = [
      'morthen',
      'vael_the_mistcaller',
      'ysolei',
      'korzul_the_gravewyrm',
      'nythraxis_scourge_of_thornpeak',
    ].sort();
    const instanceTemplates = [
      ...Object.values(DUNGEON_MOBS),
      ...Object.values(TEMPLE_DUNGEON_MOBS),
    ];
    expect(
      instanceTemplates
        .filter((t) => t.boss)
        .map((t) => t.id)
        .sort(),
    ).toEqual(bossIds);
    for (const id of bossIds) {
      expect(MOBS[id]?.ccImmune, `${id} template ccImmune`).toBe(true);
      expect(MOBS[id]?.slowImmune, `${id} template slowImmune`).toBe(true);
    }
    // The encounter-design CC targets stay CC-able (pinned in depth by
    // tests/nythraxis_priest_heal.test.ts).
    expect(MOBS.nythraxis_heroic_priest_add.ccImmune).toBe(false);
    expect(MOBS.nythraxis_heroic_rogue_add.ccImmune).toBe(false);
    expect(MOBS.nythraxis_heroic_priest_add.slowImmune).toBeUndefined();
    expect(MOBS.nythraxis_heroic_rogue_add.slowImmune).toBeUndefined();
  });

  it('every named mid-boss carries both flags without gaining the boss flag', () => {
    // The named uniques of the four five-mans are bosses from the player's
    // side ("all the bosses can't be slowed or CC'd"), so they get the same
    // template immunity, but they deliberately do NOT gain boss: true: that
    // flag also drives the Avatar control-break boundary
    // (tests/avatar_break_control.test.ts) and boss loot, which must not move.
    const midBossIds = [
      'sexton_marrow',
      'knight_commander_olen',
      'choirmother_selthe',
      'korgath_the_bound',
      'grand_necromancer_velkhar',
    ];
    for (const id of midBossIds) {
      expect(MOBS[id]?.ccImmune, `${id} template ccImmune`).toBe(true);
      expect(MOBS[id]?.slowImmune, `${id} template slowImmune`).toBe(true);
      expect(MOBS[id]?.boss, `${id} must stay un-boss-flagged`).toBeFalsy();
    }
  });
});
