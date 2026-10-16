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
  it('covers the five five-player dungeons plus all three raid arenas and final bosses', () => {
    expect([...HEROIC_DUNGEON_IDS].sort()).toEqual([
      'drowned_temple',
      'gravewyrm_sanctum',
      'hollow_crypt',
      'ignivar_forge_approach',
      'ignivar_forge_lift',
      'ignivar_inner_crucible',
      'ignivar_molten_assembly',
      'ignivar_raid_arena',
      'nythraxis_boss_arena',
      'sunken_bastion',
      'wildheart_basin',
    ]);
    expect(
      Object.fromEntries(Object.values(HEROIC_DUNGEON_TUNING).map((t) => [t.id, t.finalBossId])),
    ).toEqual({
      hollow_crypt: 'morthen',
      sunken_bastion: 'vael_the_mistcaller',
      drowned_temple: 'ysolei',
      gravewyrm_sanctum: 'korzul_the_gravewyrm',
      wildheart_basin: 'wildheart_high_priest',
      nythraxis_boss_arena: 'nythraxis_scourge_of_thornpeak',
      ignivar_raid_arena: 'ignivar_herald_of_the_last_flame',
      ignivar_inner_crucible: 'varkhul_forgefather_of_the_last_flame',
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
      wildheart_basin: 1,
      nythraxis_boss_arena: 3,
      ignivar_raid_arena: 3,
      ignivar_inner_crucible: 3,
    });
  });

  it('pins the pack-budget heroic multipliers per dungeon', () => {
    // The five-mans' damageMultiplier prices their TRASH per pull (the heroic
    // pack budget, 2026-10-08: an average pull about 250 DTPS and the heaviest
    // about 450 on the real-sim best-in-slot tank; it was the economy
    // retune's per-mob 500 floor, 20/18/16.5/15.5/17.25). Bosses and solo
    // minibosses no longer read it: each carries a damageMultiplierByMob entry
    // at its pre-budget factor. Health stays DOUBLED versus the calibration
    // before the economy retune (1.9/2.0/2.6/2.0/1.6 became
    // 3.8/4.0/5.2/4.0/3.2). Boss-summoned add waves keep their own factor
    // (the 2026-07 retune halved them to 250, the v0.30 pass cut another 40%
    // to the 150 floor). Exact literals so an accidental retune reddens
    // deliberately; the budget itself is pinned by
    // tests/heroic_difficulty_floors.test.ts.
    expect(
      Object.fromEntries(
        Object.values(HEROIC_DUNGEON_TUNING).map((t) => [
          t.id,
          [t.healthMultiplier, t.damageMultiplier, t.addDamageMultiplier, t.armorMultiplier],
        ]),
      ),
    ).toEqual({
      // The rework's summoned adds (Marrow's bones, Rimeweb's hatchlings) are
      // floored at 9.5 (tests/heroic_difficulty_floors.test.ts).
      hollow_crypt: [3.8, 9, 9.5, 1.3],
      sunken_bastion: [4.0, 6.9, 9.75, 1.3],
      drowned_temple: [5.2, 6.4, 9.15, 1.25],
      gravewyrm_sanctum: [4.0, 5.1, 8.55, 1.2],
      wildheart_basin: [4.0, 7.5, 8.625, 1.2],
      // The raid multiplier is smaller in RELATIVE terms because normal
      // Nythraxis already lands the game's hardest hits; the heroic boss
      // floors at 1200 through the dungeon-wide value while the encounter
      // add waves (spawned with no summonedAdd role) are held to the
      // summoned 250 floor through damageMultiplierByMob, so the raid's
      // addDamageMultiplier stays an inert mirror of damageMultiplier.
      nythraxis_boss_arena: [3.2, 7.25, 7.25, 1.2],
      ignivar_raid_arena: [1.75, 2, 2, 1.2],
      ignivar_inner_crucible: [5 / 3, 1.2459633027522936, 1, 1.2],
    });
  });
});

describe('claimDifficultyForDungeon', () => {
  it('grants heroic to the supported dungeons and the raid arena only', () => {
    expect(claimDifficultyForDungeon('hollow_crypt', 'heroic')).toBe('heroic');
    expect(claimDifficultyForDungeon('gravewyrm_sanctum', 'heroic')).toBe('heroic');
    expect(claimDifficultyForDungeon('nythraxis_boss_arena', 'heroic')).toBe('heroic');
    expect(claimDifficultyForDungeon('ignivar_raid_arena', 'heroic')).toBe('heroic');
    expect(claimDifficultyForDungeon('ignivar_forge_approach', 'heroic')).toBe('heroic');
    expect(claimDifficultyForDungeon('ignivar_molten_assembly', 'heroic')).toBe('heroic');
    expect(claimDifficultyForDungeon('ignivar_inner_crucible', 'heroic')).toBe('heroic');
    // The attunement dungeon is story content: normal even when heroic is selected.
    expect(claimDifficultyForDungeon('nythraxis_crypt', 'heroic')).toBe('normal');
    expect(claimDifficultyForDungeon('no_such_dungeon', 'heroic')).toBe('normal');
    expect(claimDifficultyForDungeon('hollow_crypt', 'normal')).toBe('normal');
  });
});

describe('mobTemplateForDungeonDifficulty', () => {
  it('returns the SAME template untouched for normal difficulty', () => {
    // A dungeon with no normal tuning record (the Hollow Crypt gained one for
    // its wing bosses' pools, so it no longer serves here).
    expect(mobTemplateForDungeonDifficulty(SYNTHETIC, 'the_last_keep', 'normal')).toBe(SYNTHETIC);
    // A dungeon WITH a health-only normal record still leaves an unlisted mob's
    // numbers untouched (a copy, every field equal).
    expect(mobTemplateForDungeonDifficulty(SYNTHETIC, 'hollow_crypt', 'normal')).toEqual(SYNTHETIC);
    expect(mobTemplateForDungeonDifficulty(SYNTHETIC, 'no_such_dungeon', 'heroic')).toBe(SYNTHETIC);
  });

  it('produces an exact heroic transform without mutating the base template', () => {
    const before = JSON.stringify(SYNTHETIC);
    const heroic = mobTemplateForDungeonDifficulty(SYNTHETIC, 'hollow_crypt', 'heroic');
    // hollow_crypt tuning: health x3.8, damage x9, armor x1.3, level 22.
    expect(heroic).not.toBe(SYNTHETIC);
    expect(heroic.minLevel).toBe(22);
    expect(heroic.maxLevel).toBe(22);
    expect(heroic.hpBase).toBeCloseTo(380, 10);
    expect(heroic.hpPerLevel).toBeCloseTo(38, 10);
    expect(heroic.dmgBase).toBeCloseTo(180, 10);
    expect(heroic.dmgPerLevel).toBeCloseTo(18, 10);
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
    // hollow_crypt addDamageMultiplier is 9.5 (Marrow's Restless Bones).
    expect(add.dmgBase).toBeCloseTo(190, 10);
    expect(add.dmgPerLevel).toBeCloseTo(19, 10);
    // Health, armor, level, and the speed floor stay on the dungeon-wide tuning.
    expect(add.hpBase).toBeCloseTo(380, 10);
    expect(add.hpPerLevel).toBeCloseTo(38, 10);
    expect(add.armorPerLevel).toBeCloseTo(5.2, 10);
    expect(add.minLevel).toBe(22);
    expect(add.moveSpeed).toBe(8);
    // The role flag does nothing outside heroic.
    expect(
      mobTemplateForDungeonDifficulty(SYNTHETIC, 'hollow_crypt', 'normal', { summonedAdd: true }),
    ).toEqual(SYNTHETIC);
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
  it('every boss-flagged dungeon template carries both flags', () => {
    // The complete boss enumeration of the four five-mans, the public raid,
    // and both Ignivar development-raid encounters. These are the ONLY boss: true templates
    // in dungeons.ts + temple.ts (Korgath, Velkhar, Sexton Marrow, Olen, Selthe,
    // and the Nythraxis adds are deliberately NOT boss-flagged). Template-level
    // flags cover normal spawns too: the applyAura gates read MOBS[templateId]
    // at fire time, so a normal Korzul can no longer be stunned or kited on a
    // snare (the economy retune assumes boss swings actually land).
    const bossIds = [
      'ignivar_herald_of_the_last_flame',
      'varkhul_forgefather_of_the_last_flame',
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
