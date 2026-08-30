// Heroic retune (economy pass, 2026-07): every heroic mob's health DOUBLES
// versus the previous heroic calibration, and the minimum non-crit swing of
// every SPAWN-LIST mob lands at least 500 post-mitigation on the
// maximum-mitigation reference warrior (see below); boss-summoned adds floor
// at 150 since the v0.30 40% add nerf. The Nythraxis raid rides the model on
// its own numbers: heroic boss floor 1000 (2026-07-24 nerf), encounter-script
// add waves at the raid 250 line, and NORMAL Nythraxis gets the
// normal-Gravewyrm treatment (2x health, boss >= 600, adds >= 300).
//
// Reference warrior (the "fully geared" mitigation ceiling, same as
// tests/gravewyrm_normal_tuning.test.ts): level-20 prot warrior in the
// max-armor kit (full heroic plate + shield, prot mastery), 2861 armor, in
// Defensive Stance (takes 10% less). Heroic mobs attack at the level-22 pin,
// so the armor step passes ~44.2% and the stance cut leaves ~39.8%.

import { describe, expect, it } from 'vitest';
import {
  HEROIC_DUNGEON_TUNING,
  NORMAL_DUNGEON_TUNING,
} from '../src/sim/content/dungeon_difficulty';
import { DUNGEONS, ITEMS, MOBS } from '../src/sim/data';
import type { PlayerEquipment } from '../src/sim/entity';
import { characterDerivedStats, createMob } from '../src/sim/entity';
import { canEquipItemInSlot } from '../src/sim/equipment_rules';
import {
  type HeroicSpawnRole,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import { requiredLevelFor } from '../src/sim/item_level_req';
import type { DungeonDifficulty, ItemDef } from '../src/sim/types';
import { ALL_EQUIP_SLOTS, armorReduction } from '../src/sim/types';

const REF_ARMOR = 2861;
const DEFENSIVE_STANCE_TAKEN = 0.9;
const HEROIC_MOB_FLOOR = 500;
// v0.30: five-man boss-summoned adds hit 40% softer again (the 2026-07
// half-the-mob-line 250 floor was still overwhelming healers when a tanked
// triple wave stacked on the boss); they are wave pressure, not extra bosses.
// The RAID's encounter-script waves deliberately keep the old 250 line: a
// ten-player group brings two or three healers.
const SUMMONED_ADD_FLOOR = 150;
const RAID_ADD_FLOOR = 250;
// 2026-07-24 heroic Nythraxis nerf: boss floor 1200 -> 1000 (mult 7.25)
// and the skeleton waves to 1.2x their NORMAL-mode health via the new
// healthMultiplierByMob map. Ships with the wave-2 package; the morning
// hotfix, if raids still cannot clear, nerfs FURTHER from here.
const HEROIC_NYTHRAXIS_BOSS_FLOOR = 1000;
const NORMAL_NYTHRAXIS_BOSS_FLOOR = 600;
const NORMAL_NYTHRAXIS_ADD_FLOOR = 300;

const FIVE_MANS = [
  'hollow_crypt',
  'sunken_bastion',
  'drowned_temple',
  'gravewyrm_sanctum',
  'wildheart_basin',
];
const RAID = 'nythraxis_boss_arena';
const RAID_BOSS = 'nythraxis_scourge_of_thornpeak';
// Encounter-script waves (spawnNythraxisAdds / spawnNythraxisHeroicAdds spawn
// these with NO summonedAdd role, so they ride the per-mob override map).
const RAID_NORMAL_ADD = 'nythraxis_skeleton_warrior';
const RAID_HEROIC_ADDS = [
  'nythraxis_skeleton_warrior',
  'nythraxis_heroic_warrior_add',
  'nythraxis_heroic_priest_add',
  'nythraxis_heroic_rogue_add',
];

// The minimum non-avoided, non-crit hit on the reference warrior, replicating
// the sim's rounding chain (mobSwing rounds after armor, dealDamage after the
// stance cut). Heroic spawns land at the transformed template's pinned level.
function minSwing(
  mobId: string,
  dungeonId: string,
  difficulty: DungeonDifficulty,
  role?: HeroicSpawnRole,
  levelOverride?: number,
): number {
  const template = mobTemplateForDungeonDifficulty(MOBS[mobId], dungeonId, difficulty, role);
  const level = levelOverride ?? template.maxLevel;
  const mob = createMob(1, template, level, { x: 0, y: 0, z: 0 });
  const afterArmor = Math.round(mob.weapon.min * (1 - armorReduction(REF_ARMOR, level)));
  return Math.round(afterArmor * DEFENSIVE_STANCE_TAKEN);
}

function maxHpAt(
  mobId: string,
  dungeonId: string,
  difficulty: DungeonDifficulty,
  role?: HeroicSpawnRole,
  levelOverride?: number,
): number {
  const template = mobTemplateForDungeonDifficulty(MOBS[mobId], dungeonId, difficulty, role);
  const level = levelOverride ?? template.maxLevel;
  return createMob(1, template, level, { x: 0, y: 0, z: 0 }).maxHp;
}

function spawnListMobIds(dungeonId: string): Set<string> {
  const ids = new Set<string>();
  for (const spawn of DUNGEONS[dungeonId].spawns) ids.add(spawn.mobId);
  return ids;
}

describe('heroic five-man floors', () => {
  it('every spawn-list mob swings for at least 500 on the reference warrior', () => {
    for (const dungeonId of FIVE_MANS) {
      for (const mobId of spawnListMobIds(dungeonId)) {
        expect(
          minSwing(mobId, dungeonId, 'heroic'),
          `${dungeonId}/${mobId}`,
        ).toBeGreaterThanOrEqual(HEROIC_MOB_FLOOR);
      }
    }
  });

  it('every boss-summoned add swings for at least the 150 add floor on the reference warrior', () => {
    for (const dungeonId of FIVE_MANS) {
      for (const mobId of spawnListMobIds(dungeonId)) {
        const summoned = MOBS[mobId]?.summonAdds?.mobId;
        if (!summoned) continue;
        const swing = minSwing(summoned, dungeonId, 'heroic', { summonedAdd: true });
        expect(swing, `${dungeonId}/${summoned}`).toBeGreaterThanOrEqual(SUMMONED_ADD_FLOOR);
        // And UNDER the full mob line: an add must never hit like a boss again.
        expect(swing, `${dungeonId}/${summoned} above the mob line`).toBeLessThan(HEROIC_MOB_FLOOR);
      }
    }
  });

  it('keeps heroic Sanctum bosses above the retuned normal Sanctum bosses', () => {
    for (const bossId of [
      'korgath_the_bound',
      'grand_necromancer_velkhar',
      'korzul_the_gravewyrm',
    ]) {
      const normal = minSwing(bossId, 'gravewyrm_sanctum', 'normal', undefined, 20);
      const heroic = minSwing(bossId, 'gravewyrm_sanctum', 'heroic');
      expect(heroic, `${bossId} heroic ${heroic} vs normal ${normal}`).toBeGreaterThan(normal);
    }
  });
});

describe('heroic five-man doubled health', () => {
  it('pins representative heroic health to exactly double the pre-retune values', () => {
    // pre-retune heroic values in comments (health multipliers 1.9/2.0/2.6/2.0).
    expect(maxHpAt('crypt_shambler', 'hollow_crypt', 'heroic')).toBe(4108); // was 2054
    expect(maxHpAt('morthen', 'hollow_crypt', 'heroic')).toBe(7883); // was 3942
    expect(maxHpAt('bastion_revenant', 'sunken_bastion', 'heroic')).toBe(4554); // was 2277
    expect(maxHpAt('vael_the_mistcaller', 'sunken_bastion', 'heroic')).toBe(8777); // was 4388
    expect(maxHpAt('drowned_templeguard', 'drowned_temple', 'heroic')).toBe(6219); // was 3110
    expect(maxHpAt('ysolei', 'drowned_temple', 'heroic')).toBe(13132); // was 6566
    expect(maxHpAt('moonspawn', 'drowned_temple', 'heroic', { summonedAdd: true })).toBe(1867); // was 933
    expect(maxHpAt('korzul_the_gravewyrm', 'gravewyrm_sanctum', 'heroic')).toBe(13138); // was 6569
  });
});

describe('Nythraxis raid floors', () => {
  it('heroic boss swings for at least 1000, add waves for the raid 250 add floor', () => {
    expect(minSwing(RAID_BOSS, RAID, 'heroic')).toBeGreaterThanOrEqual(HEROIC_NYTHRAXIS_BOSS_FLOOR);
    for (const addId of RAID_HEROIC_ADDS) {
      const swing = minSwing(addId, RAID, 'heroic');
      expect(swing, addId).toBeGreaterThanOrEqual(RAID_ADD_FLOOR);
      expect(swing, `${addId} above the mob line`).toBeLessThan(HEROIC_MOB_FLOOR);
    }
  });

  it('normal boss swings for at least 600, skeleton waves for at least 300', () => {
    expect(minSwing(RAID_BOSS, RAID, 'normal', undefined, 20)).toBeGreaterThanOrEqual(
      NORMAL_NYTHRAXIS_BOSS_FLOOR,
    );
    expect(minSwing(RAID_NORMAL_ADD, RAID, 'normal', undefined, 20)).toBeGreaterThanOrEqual(
      NORMAL_NYTHRAXIS_ADD_FLOOR,
    );
  });

  it('pins raid health: boss doubled, heroic skeletons at 1.2x their normal HP', () => {
    expect(maxHpAt(RAID_BOSS, RAID, 'heroic')).toBe(192000); // was 96000
    // Skeleton waves: 2.22x base = 3,768 at the level-22 pin, 1.2x the normal
    // wave's 3,137 (heroic waves stay beefier than normal, but stop being
    // 73% beefier: they are wave pressure, not extra bosses).
    expect(maxHpAt(RAID_NORMAL_ADD, RAID, 'heroic')).toBe(3768);
    expect(maxHpAt(RAID_BOSS, RAID, 'normal', undefined, 20)).toBe(120000); // was 60000
    expect(maxHpAt(RAID_NORMAL_ADD, RAID, 'normal', undefined, 20)).toBe(3137); // was 1569
  });

  it('pins the normal raid tuning data', () => {
    const tuning = NORMAL_DUNGEON_TUNING[RAID];
    expect(tuning).toBeTruthy();
    expect(tuning.healthMultiplier).toBe(2.0);
    expect(tuning.damageMultiplierByMob).toEqual({
      nythraxis_scourge_of_thornpeak: 5,
      nythraxis_skeleton_warrior: 5,
    });
  });
});

describe('heroic tuning data contract', () => {
  it('pins the retuned heroic ladder (health doubled, 500-floor damage)', () => {
    expect(
      Object.fromEntries(
        Object.values(HEROIC_DUNGEON_TUNING).map((t) => [
          t.id,
          [t.healthMultiplier, t.damageMultiplier, t.addDamageMultiplier],
        ]),
      ),
    ).toEqual({
      hollow_crypt: [3.8, 20, 6],
      sunken_bastion: [4.0, 18, 9.75],
      drowned_temple: [5.2, 16.5, 9.15],
      gravewyrm_sanctum: [4.0, 15.5, 8.55],
      wildheart_basin: [4.0, 17.25, 8.625],
      nythraxis_boss_arena: [3.2, 7.25, 7.25],
      ignivar_raid_arena: [1.75, 2, 2],
      ignivar_inner_crucible: [5 / 3, 1.2459633027522936, 1],
    });
  });

  it('pins the per-mob heroic overrides and checks every key is a real mob', () => {
    expect(HEROIC_DUNGEON_TUNING.gravewyrm_sanctum.damageMultiplierByMob).toEqual({
      korgath_the_bound: 19,
      grand_necromancer_velkhar: 19,
      korzul_the_gravewyrm: 19,
    });
    expect(HEROIC_DUNGEON_TUNING.nythraxis_boss_arena.damageMultiplierByMob).toEqual({
      nythraxis_skeleton_warrior: 3.75,
      nythraxis_heroic_warrior_add: 3.75,
      nythraxis_heroic_priest_add: 8,
      nythraxis_heroic_rogue_add: 6,
    });
    for (const tuning of Object.values(HEROIC_DUNGEON_TUNING)) {
      for (const mobId of Object.keys(tuning.damageMultiplierByMob ?? {})) {
        expect(MOBS[mobId], `${tuning.id}: ${mobId}`).toBeTruthy();
      }
    }
  });
});

describe('the reference warrior is a CALIBRATION CONSTANT, and the catalog must not out-run it', () => {
  // ADDED AT PHASE 15. REF_ARMOR is a hardcoded literal in four floors suites
  // and is quoted as fact in two shipped sim comments, but nothing derives it
  // from the catalog, so the whole floors model is structurally blind to GEAR
  // drift: any new armour piece that becomes a max-mitigation pick moves real
  // tank intake with zero test signal. That is not hypothetical here. The
  // packet's apex shield shipped at armor 732 / blockValue 32 against the
  // heroic raid shield's frozen 680 / 30, which made a CRAFTED item the best
  // mitigation piece in the game and took the reference tank's physical
  // damage down about 1.0 percent, unmeasured and unpinned, on exactly the
  // axis R5's protected asset is priced in.
  //
  // Raising REF_ARMOR is not the fix: it would move every floor. The claim
  // pinned instead is the one that actually protects the model, and it is a
  // pure equality rather than a tolerance: REMOVING the packet's flagged defs
  // must leave the max-mitigation kit unchanged. A crafted piece may sit
  // beside the raid line; it may never take it.
  const maxArmorKit = (includeFlagged: boolean): PlayerEquipment => {
    const eq: Record<string, string> = {};
    for (const slot of ALL_EQUIP_SLOTS) {
      let best: ItemDef | null = null;
      let bestArmor = -1;
      for (const def of Object.values(ITEMS)) {
        if (!includeFlagged && def.masterwrought === true) continue;
        if (!canEquipItemInSlot('warrior', def, slot, 'prot')) continue;
        if ((requiredLevelFor(def) ?? 0) > 20) continue;
        const armor = (def.stats as { armor?: number } | undefined)?.armor ?? 0;
        // Deterministic tie-break by id so the pick cannot drift with table order.
        if (armor > bestArmor || (armor === bestArmor && best !== null && def.id < best.id)) {
          bestArmor = armor;
          best = def;
        }
      }
      if (best) eq[slot] = best.id;
    }
    return eq as PlayerEquipment;
  };

  it('the max-mitigation prot kit is UNCHANGED by the packet, slot for slot', () => {
    const withFlagged = maxArmorKit(true);
    const withoutFlagged = maxArmorKit(false);
    // Non-vacuity: the picker really filled the paperdoll, and the flagged
    // family really exists to be excluded.
    expect(Object.keys(withFlagged).length, 'the picker filled every slot').toBe(
      ALL_EQUIP_SLOTS.length,
    );
    expect(
      Object.values(ITEMS).filter((d) => d.masterwrought === true).length,
      'the flagged family is really there to exclude',
    ).toBe(17);
    expect(withFlagged, 'a flagged def won a max-mitigation slot').toEqual(withoutFlagged);
    const a = characterDerivedStats('warrior', 20, withFlagged);
    const b = characterDerivedStats('warrior', 20, withoutFlagged);
    expect(a.stats.armor).toBe(b.stats.armor);
    expect(a.maxHp).toBe(b.maxHp);
    // THE RULE ITSELF, stated rather than left to the tie-break. The equality
    // above holds today partly by accident: after the shield tune the
    // prot-legal offhand pool is a three-way armour TIE at 680, and the id
    // tie-break happens to hand both arms an unflagged def. Rename the crafted
    // shield to sort earlier and the equality would red with no power change;
    // add a future apex piece that TIES with a late-sorting id and it would
    // stay green while a crafted piece matched the raid line. So the armour
    // comparison is made directly, per slot: a crafted piece may sit beside
    // the raid line, it may never take it.
    for (const slot of ALL_EQUIP_SLOTS) {
      let bestFlagged = 0;
      let bestUnflagged = 0;
      for (const def of Object.values(ITEMS)) {
        if (!canEquipItemInSlot('warrior', def, slot, 'prot')) continue;
        if ((requiredLevelFor(def) ?? 0) > 20) continue;
        const armor = (def.stats as { armor?: number } | undefined)?.armor ?? 0;
        if (def.masterwrought === true) bestFlagged = Math.max(bestFlagged, armor);
        else bestUnflagged = Math.max(bestUnflagged, armor);
      }
      expect(
        bestFlagged,
        `${slot}: a flagged def out-armours every pre-packet piece a prot warrior can wear`,
      ).toBeLessThanOrEqual(bestUnflagged);
    }
    // Non-vacuity for that sweep: the offhand really is a slot where a flagged
    // def competes, and it really does reach the raid shield's own number.
    const shieldArmor = (ITEMS.duskforged_bulwark.stats as { armor?: number }).armor;
    expect(shieldArmor, 'the apex shield ties the raid shield').toBe(
      (ITEMS.heroic_bonewrought_bulwark.stats as { armor?: number }).armor,
    );
    // The derived values as literals, so a catalog move on EITHER side reds
    // here with a named cause instead of moving both together silently. These
    // are the raw kit numbers, without the prot mastery the header's
    // derivation folds in; REF_ARMOR above stays the pinned calibration
    // constant it has always been and is deliberately not asserted equal to
    // this, because it is not a live property of the catalog.
    // Re-pinned 2969 -> 4085 at the merge of release/v0.41.0 (tip 3e801dc925,
    // 2026-08-30): the named cause is the release's Crucible raid plate (the
    // Phase B set pieces and the Varkhul legendaries), which a prot warrior
    // can wear and which out-armours the pre-raid kit slot for slot; no
    // flagged def moved (the sweep above still holds). The calibration gap
    // between REF_ARMOR (2861) and the live kit therefore widened from about a
    // hundred points to over a thousand: a maintainer decision on the
    // constant (the packet's Phase 19 table), never a re-tune here.
    expect(a.stats.armor, 'the live max-armor kit').toBe(4085);
    // The pool moved DOWN with the same cause (1672 -> 1582): the max-ARMOR
    // picks are not the max-stamina picks, and the Crucible plate that wins
    // each slot on armour carries less stamina than the pre-raid kit it
    // displaces. Same re-pin, same date, same named cause.
    expect(a.maxHp, 'and its pool').toBe(1582);
  });
});
