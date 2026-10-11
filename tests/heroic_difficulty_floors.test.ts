// Heroic retune (economy pass, 2026-07): every heroic mob's health DOUBLES
// versus the previous heroic calibration, and the minimum non-crit swing of
// every SPAWN-LIST mob landed at least 500 post-mitigation on the
// maximum-mitigation reference warrior (see below). The heroic pack budget
// (2026-10-08) keeps that 500 line for the ENCOUNTER bodies only (bosses and
// solo minibosses) and prices TRASH per pull instead, because the five-mans'
// trash now comes in packs of three to six (the pack budget block below).
// Boss-summoned adds floor at 150 since the v0.30 40% add nerf and stay under
// the 500 line. The Nythraxis raid rides the model on
// its own numbers: heroic boss floor 1000 (2026-07-24 nerf), encounter-script
// add waves at the raid 250 line, and NORMAL Nythraxis gets the
// normal-Gravewyrm treatment (2x health, boss >= 600, adds >= 300).
//
// Reference warrior (the "fully geared" mitigation ceiling, same as
// tests/gravewyrm_normal_tuning.test.ts): level-20 prot warrior in the
// max-armor kit (full heroic plate + shield, prot mastery), 2861 armor, in
// Defensive Stance (takes 10% less). Heroic mobs attack at the level-22 pin,
// so the armor step passes ~44.2% and the stance cut leaves ~39.8%.
// Provenance (qr-19-ref-armor-calibration-constant, 2026-09-01): 2861 is a
// PINNED constant, not a live measurement of the catalog. The committed
// max-armour kit pins at 4085, in THIS file's own re-pin arm below (search
// 'the live max-armor kit'), and whether 2861 was ever the raw kit armour or a
// prot-mastery-folded reading is UNSETTLED, so it is not re-based here and rides
// the packet's R5 re-measure. On the 4085 kit those two figures read about 35.7%
// and about 32.1%, derived in the arm named REF_ARMOR provenance below.

import { describe, expect, it } from 'vitest';
import { crucibleCollectionForItem } from '../src/sim/content/crucible_collections';
import {
  HEROIC_DUNGEON_TUNING,
  NORMAL_DUNGEON_TUNING,
} from '../src/sim/content/dungeon_difficulty';
import { DUNGEONS, ITEMS, MOBS } from '../src/sim/data';
import type { PlayerEquipment } from '../src/sim/entity';
import { characterDerivedStats, createMob } from '../src/sim/entity';
import { canEquipItemInSlot } from '../src/sim/equipment_rules';
import {
  applyDungeonMobTuning,
  type HeroicSpawnRole,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import { requiredLevelFor } from '../src/sim/item_level_req';
import type { DungeonDifficulty, ItemDef } from '../src/sim/types';
import { ALL_EQUIP_SLOTS, armorReduction } from '../src/sim/types';

const REF_ARMOR = 2861;
const DEFENSIVE_STANCE_TAKEN = 0.9;
// The economy pass's per-mob line. Since the pack budget only the encounter
// bodies (bosses and solo minibosses) are held to it; every add stays under it.
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
// 2026-09-04 first playtest of the mechanics redo: the boss swing is 70% of
// its old weapon (the Dread Curse stacks now carry the tank pressure), so the
// floors follow it down: heroic 1000 -> 700, normal 600 -> 420.
// 2026-09-07 playtest tuning pass: raw swing retuned to ~90% of the lower
// comparator final boss (dungeon_difficulty.ts), so the floors follow it
// down: heroic 700 -> 146, normal 420 -> 98.
const HEROIC_NYTHRAXIS_BOSS_FLOOR = 146;
const NORMAL_NYTHRAXIS_BOSS_FLOOR = 98;
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

// ---- the heroic pack budget (2026-10-08) ------------------------------------
// Heroic trash is priced per PULL. Every placement sharing a
// DungeonSpawn.packId enters combat together (aggroDungeonPackmates), and a
// placement with no packId is its own pull. Under the old per-mob 500 floor a
// pull of three to six stacked as high as 2,060 formula DTPS, and on the bench
// below the trash pulls ran three to seven times one healer's sustained
// output. The maintainer's budget is a REAL-SIM number: on the level-20
// best-in-slot prot warrior (4,081 armor, 3,312 health buffed, Defensive
// Stance), every pull threat-pinned around it in melee with trash kits inert
// (the intake bench of scripts/healing_montecarlo.ts), a dungeon's AVERAGE
// trash pull lands about 250 DTPS and its HEAVIEST about 450 or less (that one
// wants a crowd control or a cooldown). One healer sustains about 150 to 205
// HPS on the same bench.
//
// This suite cannot run that bench, so it pins the budget's FORMULA image on
// the reference warrior: each melee member's mean weapon roll through the
// armor pass at its level and the stance cut, over its swing timer, summed
// over the pull. A petSpell caster stands at range and casts instead of
// swinging (mob/combat_profile.ts updateCasterCombat), so it counts 0 here
// (its unscaled heroic nuke adds about 10 to 20 real DTPS a caster).
//
// Calibration (MEASURED 2026-10-08 on the PR 4352 spawn lists with that bench,
// every trash pull of the five, 4 runs of 90 s each, the p50 per pull):
//   dungeon   real mean pull (formula)   heaviest real pull   formula heaviest
//   crypt     262 (366)                  421 (w2, 5 crows)    654 (w2)
//   bastion   252 (366)                  356 (k3)             541 (b2)
//   temple    257 (353)                  344 (g11)            539 (g11)
//   basin     245 (361)                  417 (g1 and g11)     600 (g4)
//   sanctum   248 (375)                  451 (g11)            620 (g11)
// (On the old per-mob floor the bench read 561 / 637 / 616 / 589 / 775 mean and
// 1,055 / 906 / 904 / 1,104 / 1,411 heaviest.) A dungeon's damage factor moves
// all its pulls together, so each band is that dungeon's own measured
// conversion carried to the budget's edges: meanMin and meanMax are the formula
// means that land a real mean of 225 and 275, heaviestMax the formula heaviest
// at which its heaviest real pull reaches 475. Rounded inward.
const PACK_BUDGET: Record<
  string,
  { pulls: number; meanMin: number; meanMax: number; heaviestMax: number }
> = {
  hollow_crypt: { pulls: 17, meanMin: 315, meanMax: 384, heaviestMax: 737 },
  sunken_bastion: { pulls: 19, meanMin: 327, meanMax: 399, heaviestMax: 721 },
  drowned_temple: { pulls: 16, meanMin: 309, meanMax: 377, heaviestMax: 744 },
  wildheart_basin: { pulls: 16, meanMin: 332, meanMax: 405, heaviestMax: 683 },
  gravewyrm_sanctum: { pulls: 15, meanMin: 341, meanMax: 415, heaviestMax: 652 },
};

/** Every pull of a dungeon's spawn list, as mob ids (egg sacs never fight). */
function pullsOf(dungeonId: string): string[][] {
  const pulls = new Map<string, string[]>();
  DUNGEONS[dungeonId].spawns.forEach((spawn, i) => {
    if (MOBS[spawn.mobId]?.broodEgg) return;
    const key = spawn.packId ?? `solo:${i}`;
    const pull = pulls.get(key) ?? [];
    pull.push(spawn.mobId);
    pulls.set(key, pull);
  });
  return [...pulls.values()];
}

/** An encounter body: every boss and solo miniboss is ccImmune (or the final
 *  boss flag); trash never is. A pull holding one is an encounter, not trash. */
function isEncounterBody(mobId: string): boolean {
  return MOBS[mobId]?.boss === true || MOBS[mobId]?.ccImmune === true;
}

/** Mean melee DTPS of one heroic spawn on the reference warrior (0 for a
 *  petSpell caster, which casts from range instead of swinging). */
function meleeDtps(mobId: string, dungeonId: string): number {
  if (MOBS[mobId]?.petSpell) return 0;
  const template = mobTemplateForDungeonDifficulty(MOBS[mobId], dungeonId, 'heroic');
  const level = template.maxLevel;
  const mob = createMob(1, template, level, { x: 0, y: 0, z: 0 });
  const taken = (1 - armorReduction(REF_ARMOR, level)) * DEFENSIVE_STANCE_TAKEN;
  return (((mob.weapon.min + mob.weapon.max) / 2) * taken) / mob.weapon.speed;
}

describe('heroic five-man floors', () => {
  it('prices every heroic trash pull inside the pack budget', () => {
    expect(Object.keys(PACK_BUDGET).sort()).toEqual([...FIVE_MANS].sort());
    for (const dungeonId of FIVE_MANS) {
      const budget = PACK_BUDGET[dungeonId];
      const trash = pullsOf(dungeonId).filter((pull) => !pull.some(isEncounterBody));
      // Non-vacuity: the authored pull count, so a lost packId (every member
      // turning into its own one-mob pull) cannot slip the mean down.
      expect(trash.length, `${dungeonId} trash pulls`).toBe(budget.pulls);
      const dtps = trash.map((pull) => pull.reduce((sum, id) => sum + meleeDtps(id, dungeonId), 0));
      const mean = dtps.reduce((a, b) => a + b, 0) / dtps.length;
      expect(mean, `${dungeonId} mean pull`).toBeGreaterThanOrEqual(budget.meanMin);
      expect(mean, `${dungeonId} mean pull`).toBeLessThanOrEqual(budget.meanMax);
      expect(Math.max(...dtps), `${dungeonId} heaviest pull`).toBeLessThanOrEqual(
        budget.heaviestMax,
      );
    }
  });

  it('holds every encounter body on the 500 line and every trash mob under it', () => {
    let bodies = 0;
    for (const dungeonId of FIVE_MANS) {
      for (const pull of pullsOf(dungeonId)) {
        const encounter = pull.some(isEncounterBody);
        for (const mobId of pull) {
          const swing = minSwing(mobId, dungeonId, 'heroic');
          // Ilvane's two Choristers are her trash-like adds: since the pack
          // budget they ride the crypt's trash value, not a boss entry.
          if (encounter && mobId !== 'hollow_chorister') {
            bodies++;
            expect(swing, `${dungeonId}/${mobId}`).toBeGreaterThanOrEqual(HEROIC_MOB_FLOOR);
          } else {
            expect(swing, `${dungeonId}/${mobId} hits like a boss`).toBeLessThan(HEROIC_MOB_FLOOR);
          }
        }
      }
    }
    // The Knellwyrm (Morthen's rite raises it with no add role) is a boss too.
    expect(minSwing('crypt_knellwyrm', 'hollow_crypt', 'heroic')).toBeGreaterThanOrEqual(
      HEROIC_MOB_FLOOR,
    );
    // Non-vacuity: 20 boss bodies (the Hydra's three heads, the Beastmaster
    // and his jaguar among them) plus the four solo minibosses.
    expect(bodies).toBe(24);
  });

  it('the pack budget left every trash kit on its pre-budget mechanic factor', () => {
    // A heroic mob with no mechanic entry stamps its MELEE factor as
    // mechanicDamageMult (instances/difficulty.ts), so the budget's melee cut
    // would have moved every trash kit with it. Each kit-carrying trash mob
    // whose melee moved carries its old factor as a mechanic entry instead.
    const PRE_BUDGET: Record<string, Record<string, number>> = {
      hollow_crypt: {
        crypt_ossuary_warrior: 20,
        crypt_gravecaller_adept: 24,
        crypt_chapel_gargoyle: 20,
        crypt_ossuary_cutthroat: 23,
        crypt_ossuary_drake: 20,
        bonechill_widow: 20,
        crypt_crow_caller: 24,
        crypt_carrion_crow: 66,
      },
      sunken_bastion: { bastion_revenant: 18, mistweaver: 21.6 },
      drowned_temple: { pale_choir_acolyte: 16.5, moonlit_siren: 17.5 },
      wildheart_basin: {
        wildheart_stalker: 17.25,
        wildheart_ravager: 17.25,
        wildheart_hexcaller: 17.25,
      },
    };
    const stamped = (mobId: string, dungeonId: string): number => {
      const template = mobTemplateForDungeonDifficulty(MOBS[mobId], dungeonId, 'heroic');
      const mob = createMob(1, template, template.maxLevel, { x: 0, y: 0, z: 0 });
      applyDungeonMobTuning(mob, dungeonId, 'heroic');
      return mob.mechanicDamageMult ?? 1;
    };
    for (const [dungeonId, factors] of Object.entries(PRE_BUDGET)) {
      const tuning = HEROIC_DUNGEON_TUNING[dungeonId];
      for (const [mobId, factor] of Object.entries(factors)) {
        expect(stamped(mobId, dungeonId), `${dungeonId}/${mobId}`).toBe(factor);
        // Load-bearing: the melee factor really moved off the kit's factor.
        const melee = tuning.damageMultiplierByMob?.[mobId] ?? tuning.damageMultiplier;
        expect(melee, `${dungeonId}/${mobId} melee`).toBeLessThan(factor);
      }
    }
    // The one deliberate move: the Moonmantle Ray's Pearl Slam rode its x16.5
    // melee lift while every sibling temple kit sits on x5.5; it joins them.
    expect(stamped('pearlguard_sentinel', 'drowned_temple')).toBe(5.5);
    expect(stamped('drowned_templeguard', 'drowned_temple')).toBe(5.5);
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

  it('the adds an encounter module raises swing in the add band too', () => {
    // Sexton Marrow's Restless Bones (encounters/hollow_crypt/marrow.ts) rise
    // from his graves through spawnKitAdd as summoned adds, not a summonAdds row.
    for (const [dungeonId, add] of [['hollow_crypt', 'marrow_restless_bones']] as const) {
      const swing = minSwing(add, dungeonId, 'heroic', { summonedAdd: true });
      expect(swing, `${dungeonId}/${add}`).toBeGreaterThanOrEqual(SUMMONED_ADD_FLOOR);
      expect(swing, `${dungeonId}/${add} above the mob line`).toBeLessThan(HEROIC_MOB_FLOOR);
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
    // The crypt rework prices Morthen from fight length x heroic DPS (about
    // 125 s of damage beside his immune Rite, dungeon_difficulty.ts).
    expect(maxHpAt('morthen', 'hollow_crypt', 'heroic')).toBe(28837);
    expect(maxHpAt('bastion_revenant', 'sunken_bastion', 'heroic')).toBe(4554); // was 2277
    // The Sunken Bastion rework prices Vael's pool per boss (150 s at heroic
    // party DPS, dungeon_difficulty.ts healthMultiplierByMob), off the doubling.
    expect(maxHpAt('vael_the_mistcaller', 'sunken_bastion', 'heroic')).toBe(34449);
    expect(maxHpAt('drowned_templeguard', 'drowned_temple', 'heroic')).toBe(6219); // was 3110
    // The Temple rework prices Ysolei from fight length x heroic DPS (150 s).
    expect(maxHpAt('ysolei', 'drowned_temple', 'heroic')).toBe(34497);
    expect(maxHpAt('moonspawn', 'drowned_temple', 'heroic', { summonedAdd: true })).toBe(1867); // was 933
    // The Ice Tomb rework prices Korzul from fight length x heroic DPS (160 s
    // on the ground; phase B adds his flights).
    expect(maxHpAt('korzul_the_gravewyrm', 'gravewyrm_sanctum', 'heroic')).toBe(36785);
  });
});

describe('Nythraxis raid floors', () => {
  it('heroic boss swings for at least 700, add waves for the raid 250 add floor', () => {
    expect(minSwing(RAID_BOSS, RAID, 'heroic')).toBeGreaterThanOrEqual(HEROIC_NYTHRAXIS_BOSS_FLOOR);
    for (const addId of RAID_HEROIC_ADDS) {
      const swing = minSwing(addId, RAID, 'heroic');
      expect(swing, addId).toBeGreaterThanOrEqual(RAID_ADD_FLOOR);
      expect(swing, `${addId} above the mob line`).toBeLessThan(HEROIC_MOB_FLOOR);
    }
  });

  it('normal boss swings for at least 420, skeleton waves for at least 300', () => {
    expect(minSwing(RAID_BOSS, RAID, 'normal', undefined, 20)).toBeGreaterThanOrEqual(
      NORMAL_NYTHRAXIS_BOSS_FLOOR,
    );
    expect(minSwing(RAID_NORMAL_ADD, RAID, 'normal', undefined, 20)).toBeGreaterThanOrEqual(
      NORMAL_NYTHRAXIS_ADD_FLOOR,
    );
  });

  it('pins raid health: the redo boss pool, heroic skeletons at 1.2x their normal HP', () => {
    // The mechanics redo sets the boss pool directly through the per-mob health
    // multiplier on the tuning records (120,000 normal, 192,000 heroic after
    // the first playtest, 2026-09-04; the redo tried 160,000 / 230,000); the
    // adds keep the shared difficulty multipliers.
    expect(maxHpAt(RAID_BOSS, RAID, 'heroic')).toBe(192000);
    // Skeleton waves: 2.22x base = 3,768 at the level-22 pin, 1.2x the normal
    // wave's 3,137 (heroic waves stay beefier than normal, but stop being
    // 73% beefier: they are wave pressure, not extra bosses).
    expect(maxHpAt(RAID_NORMAL_ADD, RAID, 'heroic')).toBe(3768);
    expect(maxHpAt(RAID_BOSS, RAID, 'normal', undefined, 20)).toBe(120000);
    expect(maxHpAt(RAID_NORMAL_ADD, RAID, 'normal', undefined, 20)).toBe(3137); // was 1569
  });

  it('pins the normal raid tuning data', () => {
    const tuning = NORMAL_DUNGEON_TUNING[RAID];
    expect(tuning).toBeTruthy();
    expect(tuning.healthMultiplier).toBe(2.0);
    expect(tuning.damageMultiplierByMob).toEqual({
      nythraxis_scourge_of_thornpeak: 1.132,
      nythraxis_skeleton_warrior: 5,
    });
  });
});

describe('heroic tuning data contract', () => {
  it('pins the retuned heroic ladder (health doubled, pack-budget trash damage)', () => {
    expect(
      Object.fromEntries(
        Object.values(HEROIC_DUNGEON_TUNING).map((t) => [
          t.id,
          [t.healthMultiplier, t.damageMultiplier, t.addDamageMultiplier],
        ]),
      ),
    ).toEqual({
      // The five-mans' damage is the trash pack budget (was the 500 floor:
      // 20, 18, 16.5, 15.5, 17.25; the bosses keep those through their
      // per-mob entries). 6 -> 9.5: the rework's wing bosses summon adds (the
      // 150 add floor).
      hollow_crypt: [3.8, 9, 9.5],
      sunken_bastion: [4.0, 6.9, 9.75],
      drowned_temple: [5.2, 6.4, 9.15],
      gravewyrm_sanctum: [4.0, 5.1, 8.55],
      wildheart_basin: [4.0, 7.5, 8.625],
      nythraxis_boss_arena: [3.2, 7.25, 7.25],
      ignivar_raid_arena: [1.75, 2, 2],
      ignivar_inner_crucible: [5 / 3, 1.2459633027522936, 1],
    });
  });

  it('pins the per-mob heroic overrides and checks every key is a real mob', () => {
    // Every boss and solo miniboss keeps its pre-budget melee factor (the
    // Sanctum bosses their 19, everyone else the old dungeon-wide value); the
    // trash overrides kept their old floor lifts in proportion, the crows,
    // raptors and whelps that dominated a heavy pull less a little more.
    expect(HEROIC_DUNGEON_TUNING.gravewyrm_sanctum.damageMultiplierByMob).toEqual({
      korgath_the_bound: 19,
      grand_necromancer_velkhar: 19,
      korzul_the_gravewyrm: 19,
      sledge_tusker: 15.5,
      broodsworn_thawcaller: 5.5,
      broodsworn_pyre_tender: 5.5,
      rime_whelp: 8.8,
    });
    expect(HEROIC_DUNGEON_TUNING.hollow_crypt.damageMultiplierByMob).toEqual({
      sexton_marrow: 20,
      rimeweb: 20,
      cantor_ilvane: 20,
      morthen: 20,
      crypt_knellwyrm: 20,
      crypt_gravecaller_adept: 10.8,
      crypt_gravecaller_necromancer: 10.8,
      crypt_crow_caller: 10.8,
      crypt_ossuary_cutthroat: 10.35,
      crypt_carrion_crow: 26.7,
    });
    expect(HEROIC_DUNGEON_TUNING.sunken_bastion.damageMultiplierByMob).toEqual({
      knight_commander_olen: 18,
      gaoler_ossick: 18,
      vael_the_mistcaller: 18,
      turretback_hermit: 18,
      gaol_turnkey: 18,
      bastion_warhound: 7.5,
      fogbound_arbalest: 8.3,
      mistweaver: 8.3,
    });
    expect(HEROIC_DUNGEON_TUNING.drowned_temple.damageMultiplierByMob).toEqual({
      choirmother_selthe: 16.5,
      mere_hydra_head_left: 16.5,
      mere_hydra_head_center: 16.5,
      mere_hydra_head_right: 16.5,
      tideglass_colossus: 16.5,
      ysolei: 16.5,
      drowned_pilgrim: 10.5,
      moonlit_siren: 6.8,
    });
    expect(HEROIC_DUNGEON_TUNING.wildheart_basin.damageMultiplierByMob).toEqual({
      wildheart_beastmaster: 17.25,
      fanglord_jaguar: 17.25,
      the_gorgebloom: 17.25,
      wildheart_high_priest: 17.25,
      great_saurian: 17.25,
      basin_raptor: 11.4,
    });
    expect(HEROIC_DUNGEON_TUNING.nythraxis_boss_arena.damageMultiplierByMob).toEqual({
      nythraxis_scourge_of_thornpeak: 1.488,
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
        // Equal armor does not raise the defensive ceiling. Keep the incumbent
        // non-Masterwrought pick on a tie, then compare ids within that category.
        const preferredTie =
          armor === bestArmor &&
          best !== null &&
          ((best.masterwrought === true && def.masterwrought !== true) ||
            ((def.masterwrought === true) === (best.masterwrought === true) && def.id < best.id));
        if (armor > bestArmor || preferredTie) {
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
    ).toBe(50);
    expect(
      Object.values(ITEMS).filter(
        (def) => def.masterwrought === true && !crucibleCollectionForItem(def.id),
      ),
      'the original Masterwrought family remains intact',
    ).toHaveLength(17);
    expect(
      Object.values(ITEMS).filter(
        (def) => def.masterwrought === true && crucibleCollectionForItem(def.id),
      ),
      'the new raid collections are included in the ceiling',
    ).toHaveLength(33);
    expect(withFlagged, 'a flagged def won a max-mitigation slot').toEqual(withoutFlagged);
    const a = characterDerivedStats('warrior', 20, withFlagged);
    const b = characterDerivedStats('warrior', 20, withoutFlagged);
    expect(a.stats.armor).toBe(b.stats.armor);
    expect(a.maxHp).toBe(b.maxHp);
    // THE RULE ITSELF, independent of the stable tie-break: every flagged
    // candidate is compared directly with the non-Masterwrought slot ceiling.
    // This includes the original family and the new Crucible collections.
    // Matching an existing armor line is permitted; exceeding it is not.
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
    // Re-pinned 1582 -> 1922 on 2026-09-10 with the stamina baseline model
    // (item_budget.ts): the reference picker now scores the class line, so the
    // tank's neck and rings are physical, stamina-bearing pieces instead of the
    // caster jewelry a raw five-stat sum tied them with, and the two
    // stamina-free physical pieces gained their floor. The armor pin above did
    // not move (the max-armor picks are the same plate). Same class of move as
    // the practice dummy's reference body (tests/practice_dummies.test.ts); the
    // difficulty floors themselves are not retuned here, which is the same
    // maintainer decision the 1672 -> 1582 re-pin recorded: REF_ARMOR and the
    // packet's Phase 19 table stay the calibration constants.
    // Re-pinned 1922 -> 2052 with the trinket slot (PR 4173): the max-armor
    // picker fills the thirteenth slot, and every trinket carries armor 0, so
    // the id-ordered tie lands on the first trinket the warrior can wear and
    // its stamina line (+13, 130 HP) joins the pool. The armor pin above did
    // not move; the floors are not retuned here, the same maintainer decision.
    // Re-pinned 2052 -> 2032 with Balgath's trinkets: the id-ordered tie now lands on
    // barrowstone_heart, which sorts first and carries +11 Stamina (110 HP) instead of
    // +13. Same tie-break, same armor pin, floors not retuned.
    expect(a.maxHp, 'and its pool').toBe(2032);
  });

  it('REF_ARMOR provenance: the readings the comments quote are derived, not hand-carried', () => {
    // RULED (qr-19-ref-armor-calibration-constant, 2026-09-01): the constant
    // stays pinned at 2861 and the widened gap is recorded as the model's
    // stated conservatism. That ruling put derived percentages into comments
    // across this suite, its three siblings, dungeon_difficulty.ts and
    // rift/ranks.ts, and NOTHING asserted them.
    //
    // The LIVE kit armour is derived here, never hand-carried: an earlier
    // draft of this arm hardcoded 4085 five times, which would have kept
    // computing on a stale number after the next catalog move while every
    // comment it defends went false. That is the exact failure this arm
    // exists to prevent, so it reads the same picker the sibling arm uses.
    const liveKitArmor = characterDerivedStats('warrior', 20, maxArmorKit(true)).stats.armor;
    const passes = (armor: number, level: number): number => 1 - armorReduction(armor, level);
    // Defensive Stance takes 10 percent off on top. MIRRORED, not read: the
    // factor is a bare literal in src/sim/combat/damage.ts with no exported
    // constant, so if stance mitigation ever moves, this line and the fifteen
    // comments move together and neither is the other's guard.
    const STANCE = 0.9;

    // The constant is NOT a live catalog read, which is the whole ruling.
    expect(REF_ARMOR, 'the pinned calibration constant').toBe(2861);
    expect(liveKitArmor, 'and the live kit it no longer describes').toBeGreaterThan(REF_ARMOR);

    // The armour step at the level-22 heroic pin, both kits.
    expect(passes(REF_ARMOR, 22) * 100, 'armour pass at the constant').toBeCloseTo(44.24, 1);
    expect(passes(liveKitArmor, 22) * 100, 'armour pass on the live kit').toBeCloseTo(35.72, 1);
    // Which is where the ~39.8 the comments quote comes from, and what it
    // would read on the live kit.
    expect(passes(REF_ARMOR, 22) * STANCE * 100, 'with stance, the constant').toBeCloseTo(39.8, 1);
    expect(passes(liveKitArmor, 22) * STANCE * 100, 'with stance, live kit').toBeCloseTo(32.1, 1);
    // The S-rank level-23 pair the rift suite's comment quotes.
    expect(passes(liveKitArmor, 23) * 100, 'live kit at level 23').toBeCloseTo(36.57, 1);
    expect(passes(liveKitArmor, 23) * STANCE * 100, 'with stance at level 23').toBeCloseTo(32.9, 1);
    // And the headline the ruling rests on: post-armour melee falls about 19
    // percent on the live kit, so holding a floor would want about 24 percent
    // more mob melee. This is what makes a re-base a difficulty change rather
    // than a calibration tidy.
    const ratio = passes(liveKitArmor, 22) / passes(REF_ARMOR, 22);
    expect((1 - ratio) * 100, 'post-armour melee falls').toBeCloseTo(19.3, 1);
    expect((1 / ratio - 1) * 100, 'and holding the floor would need').toBeCloseTo(23.9, 1);
  });
});
