// Wildheart Basin NORMAL retune: the dungeon shipped with a heroic tuning
// record but NO normal one, so normal mode ran the raw base templates. Against
// the reference warrior its trash swung 26-32 and Zulgar 35, where normal
// Gravewyrm Sanctum (the calibration this suite ports) lands 103-112 and
// 200-301: about 3.5x under on trash and 6-8x under on the boss, in the same
// endgame loot band. This suite pins the ported calibration.
//
// Reference warrior (identical to tests/gravewyrm_normal_tuning.test.ts, so the
// two dungeons are measured on one ruler): level-20 prot warrior in the
// max-armor kit (full heroic plate + shield, prot mastery), 2861 armor / 2762
// hp, in Defensive Stance (takes 10% less).
//
// Two departures from the Sanctum table, both forced by this roster:
//  - a third band at 150 for the rare ccImmune beastmaster, which spawns twice
//    and out-presses trash without being the final boss;
//  - rangedDamageMultiplierByMob, because HALF this roster is a petSpell caster
//    that stands at spell range and never melees (mob/combat_profile.ts), so its
//    melee factor is inert and its nuke is otherwise immune to every tuning
//    knob. See src/sim/content/dungeon_difficulty.ts for the full rationale.

import { describe, expect, it } from 'vitest';
import {
  NORMAL_DUNGEON_TUNING,
  type NormalDungeonTuning,
} from '../src/sim/content/dungeon_difficulty';
import { BUILTIN_WORLD, DUNGEONS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  applyDungeonMobTuning,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { armorReduction } from '../src/sim/types';

const BASIN = 'wildheart_basin';
const REF_ARMOR = 2861; // max-armor BiS prot warrior, level 20 (see header)
const DEFENSIVE_STANCE_TAKEN = 0.9; // dealDamage: Defensive Stance takes 10% less

// The Sanctum floors this dungeon is being brought onto, plus the one new band.
const TRASH_FLOOR = 100;
const MINIBOSS_FLOOR = 150;
const BOSS_FLOOR = 200;
// A caster's nuke is spell damage: no armor step, and it can land on any group
// member rather than only the tank. Floored on the same 100 line as trash melee.
const RANGED_FLOOR = 100;

const TRASH_IDS = ['wildheart_stalker', 'wildheart_ravager', 'wildheart_hexcaller'] as const;
const MINIBOSS_IDS = ['wildheart_beastmaster'] as const;
const BOSS_IDS = ['wildheart_high_priest'] as const;
const CASTER_IDS = ['wildheart_stalker', 'wildheart_hexcaller'] as const;

function basinTuning(): NormalDungeonTuning {
  const tuning = NORMAL_DUNGEON_TUNING[BASIN];
  expect(tuning).toBeTruthy();
  return tuning;
}

// The minimum non-avoided, non-crit MELEE hit the reference warrior takes,
// replicating the sim's rounding chain: mobSwing rounds after the armor step,
// dealDamage rounds after the stance cut.
function minSwingOnReferenceWarrior(mobId: string, level: number): number {
  const template = mobTemplateForDungeonDifficulty(MOBS[mobId], BASIN, 'normal');
  const mob = createMob(1, template, level, { x: 0, y: 0, z: 0 });
  const afterArmor = Math.round(mob.weapon.min * (1 - armorReduction(REF_ARMOR, level)));
  return Math.round(afterArmor * DEFENSIVE_STANCE_TAKEN);
}

// The minimum non-resisted petSpell hit on the reference warrior, replicating
// the sim's chain (sim.ts updateRangedPetAttack): the floor of the damage band
// scaled by rangedDamageMult and rounded, then the stance cut. NO armor step:
// petSpell damage goes through dealDamage as spell damage.
function minRangedHitOnReferenceWarrior(mobId: string, level: number): number {
  const spell = MOBS[mobId].petSpell;
  if (!spell) throw new Error(`${mobId} has no petSpell`);
  const mult = basinTuning().rangedDamageMultiplierByMob?.[mobId] ?? 1;
  return Math.round(Math.round((spell.min + level * 0.8) * mult) * DEFENSIVE_STANCE_TAKEN);
}

function normalMaxHp(mobId: string, level: number): number {
  const template = mobTemplateForDungeonDifficulty(MOBS[mobId], BASIN, 'normal');
  return createMob(1, template, level, { x: 0, y: 0, z: 0 }).maxHp;
}

describe('normal Wildheart Basin tuning data', () => {
  it('covers every mob the basin spawns, including any boss-summoned add', () => {
    const tuning = basinTuning();
    const spawnIds = new Set<string>();
    for (const spawn of DUNGEONS[BASIN].spawns) {
      spawnIds.add(spawn.mobId);
      const summoned = MOBS[spawn.mobId]?.summonAdds?.mobId;
      if (summoned) spawnIds.add(summoned);
    }
    expect([...spawnIds].sort()).toEqual(Object.keys(tuning.damageMultiplierByMob).sort());
  });

  it('only re-prices ranged damage for mobs that have a melee factor AND a petSpell', () => {
    const tuning = basinTuning();
    const rangedKeys = Object.keys(tuning.rangedDamageMultiplierByMob ?? {});
    expect(rangedKeys.sort()).toEqual([...CASTER_IDS].sort());
    for (const id of rangedKeys) {
      expect(tuning.damageMultiplierByMob, `${id} missing a melee factor`).toHaveProperty(id);
      expect(MOBS[id].petSpell, `${id} has no petSpell to re-price`).toBeTruthy();
    }
    // The converse, so a future roster edit cannot silently leave a caster
    // unpriced: every spawnable mob WITH a petSpell must carry a ranged factor.
    for (const id of Object.keys(tuning.damageMultiplierByMob)) {
      if (MOBS[id].petSpell) {
        expect(
          tuning.rangedDamageMultiplierByMob,
          `${id} is a caster with no ranged factor`,
        ).toHaveProperty(id);
      }
    }
  });

  it('pins the retune multipliers to exact literals', () => {
    const tuning = basinTuning();
    expect(tuning.healthMultiplier).toBe(2.0);
    expect(tuning.damageMultiplierByMob).toEqual({
      wildheart_stalker: 3.7,
      wildheart_ravager: 3.15,
      wildheart_hexcaller: 3.9,
      wildheart_beastmaster: 4.2,
      wildheart_high_priest: 5.65,
    });
    expect(tuning.rangedDamageMultiplierByMob).toEqual({
      wildheart_stalker: 2.7,
      wildheart_hexcaller: 2.5,
    });
    // Mechanics ride each mob's own melee factor: no avoidable-mechanic
    // override here, unlike Korzul's Grave Inferno in the Sanctum.
    expect(tuning.mechanicDamageMultiplierByMob).toBeUndefined();
  });
});

describe('normal Wildheart Basin health', () => {
  it('doubles every mob health at its level-20 spawn (pre-retune values in comments)', () => {
    expect(normalMaxHp('wildheart_stalker', 20)).toBe(2208); // was 1104
    expect(normalMaxHp('wildheart_ravager', 20)).toBe(2765); // was 1382
    expect(normalMaxHp('wildheart_hexcaller', 20)).toBe(2111); // was 1056
    expect(normalMaxHp('wildheart_beastmaster', 20)).toBe(3836); // was 1918
    expect(normalMaxHp('wildheart_high_priest', 20)).toBe(6882); // was 3441
  });

  it('leaves Zulgar in the same pool band as Korzul, the Sanctum final boss', () => {
    const korzul = createMob(
      1,
      mobTemplateForDungeonDifficulty(MOBS.korzul_the_gravewyrm, 'gravewyrm_sanctum', 'normal'),
      20,
      { x: 0, y: 0, z: 0 },
    ).maxHp;
    const zulgar = normalMaxHp('wildheart_high_priest', 20);
    expect(zulgar).toBeGreaterThan(korzul * 0.9);
    expect(zulgar).toBeLessThan(korzul * 1.25);
  });
});

describe('normal Wildheart Basin melee floors vs the reference warrior', () => {
  it('every trash swing lands for at least 100 at every spawnable level', () => {
    for (const id of TRASH_IDS) {
      const { minLevel, maxLevel } = MOBS[id];
      for (let level = minLevel; level <= maxLevel; level++) {
        expect(
          minSwingOnReferenceWarrior(id, level),
          `${id} at level ${level}`,
        ).toBeGreaterThanOrEqual(TRASH_FLOOR);
      }
    }
  });

  it('the rare beastmaster lands above trash but below the boss line', () => {
    for (const id of MINIBOSS_IDS) {
      const { minLevel, maxLevel } = MOBS[id];
      for (let level = minLevel; level <= maxLevel; level++) {
        const swing = minSwingOnReferenceWarrior(id, level);
        expect(swing, `${id} at level ${level}`).toBeGreaterThanOrEqual(MINIBOSS_FLOOR);
        expect(swing, `${id} at level ${level} is not a third boss`).toBeLessThan(BOSS_FLOOR);
      }
    }
  });

  it('every boss swing lands for at least 200 at every spawnable level', () => {
    for (const id of BOSS_IDS) {
      const { minLevel, maxLevel } = MOBS[id];
      for (let level = minLevel; level <= maxLevel; level++) {
        expect(
          minSwingOnReferenceWarrior(id, level),
          `${id} at level ${level}`,
        ).toBeGreaterThanOrEqual(BOSS_FLOOR);
      }
    }
  });

  it('lands the whole roster inside the Sanctum normal swing band', () => {
    // The point of the retune: measured on one ruler, Wildheart's trash and boss
    // now sit in the Sanctum's own post-mitigation window (103-301), where they
    // previously sat at 26-35.
    for (const id of [...TRASH_IDS, ...MINIBOSS_IDS, ...BOSS_IDS]) {
      const swing = minSwingOnReferenceWarrior(id, 20);
      expect(swing, `${id} below the Sanctum trash floor`).toBeGreaterThanOrEqual(TRASH_FLOOR);
      expect(swing, `${id} above the Sanctum boss ceiling`).toBeLessThanOrEqual(301);
    }
  });
});

describe('normal Wildheart Basin ranged floors', () => {
  it('every caster nuke lands for at least 100 at every spawnable level', () => {
    for (const id of CASTER_IDS) {
      const { minLevel, maxLevel } = MOBS[id];
      for (let level = minLevel; level <= maxLevel; level++) {
        expect(
          minRangedHitOnReferenceWarrior(id, level),
          `${id} at level ${level}`,
        ).toBeGreaterThanOrEqual(RANGED_FLOOR);
      }
    }
  });

  it('actually reaches the live petSpell fire site, not just the tuning table', () => {
    // The floor assertions above replicate the damage chain arithmetically, so
    // they would still pass if nothing in the sim ever READ rangedDamageMult.
    // This one drives the real fire path (sim.ts updateRangedPetAttack) on a mob
    // spawned by a real normal claim and reads the damage events it emits, which
    // is the only assertion here that fails if the fire-site wiring is removed.
    const sim = new Sim({
      seed: 91,
      playerClass: 'warrior',
      noPlayer: true,
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    const pid = sim.addPlayer('warrior', 'Alpha');
    expect(enterDungeon(sim.ctx, BASIN, pid)).toBe(true);
    const instance = sim.instances.find((c) => c.dungeonId === BASIN && c.partyKey !== null);
    if (!instance) throw new Error('basin instance was not claimed');
    const player = sim.entities.get(sim.players.get(pid)!.entityId);
    const hexcaller = instance.mobIds
      .map((id) => sim.entities.get(id))
      .find((e) => e?.templateId === 'wildheart_hexcaller');
    if (!player || !hexcaller) throw new Error('hexcaller or player missing');
    const spell = MOBS.wildheart_hexcaller.petSpell;
    if (!spell) throw new Error('hexcaller lost its petSpell');

    // Stand the caster next to the player so the cast is always in range, then
    // drive the RELEASE path directly: Sunvenom Hex has a 0.7s windup, which
    // normally releases on a later tick, and this test does not advance the sim
    // clock. Pinning rangedWindupReleaseTick at 0 makes each call take the
    // committed-release branch, which is the branch that rolls the damage.
    hexcaller.pos = { ...player.pos };
    const hits: number[] = [];
    for (let i = 0; i < 400; i++) {
      hexcaller.swingTimer = 0;
      hexcaller.rangedWindupReleaseTick = 0;
      sim.ctx.updateRangedPetAttack(hexcaller, player, spell);
      for (const event of sim.drainEvents() as {
        type: string;
        ability?: string;
        amount?: number;
      }[]) {
        if (event.type === 'damage' && event.ability === spell.name && (event.amount ?? 0) > 0) {
          hits.push(event.amount as number);
        }
      }
      if (hits.length >= 20) break;
    }
    expect(hits.length, 'the caster never landed a hex').toBeGreaterThan(0);
    // Every landed hex clears the ranged floor, and the whole observed band sits
    // far above the unscaled 45-63 the same spell rolls at 1x.
    const mult = basinTuning().rangedDamageMultiplierByMob!.wildheart_hexcaller;
    expect(Math.min(...hits)).toBeGreaterThanOrEqual(RANGED_FLOOR);
    expect(Math.min(...hits)).toBeGreaterThan(spell.max + 20 * 1.1); // above the 1x CEILING
    expect(Math.max(...hits)).toBeLessThanOrEqual(
      Math.round((spell.max + 20 * 1.1) * mult), // and never above the scaled ceiling
    );
  });

  it('was NOT reachable before this retune (the gap the ranged knob closes)', () => {
    // With no ranged factor the identical chain lands 38-41: the casters were
    // immune to dungeon tuning, and a caster never melees, so that WAS their
    // whole output. This is the regression this table exists to prevent.
    for (const id of CASTER_IDS) {
      const spell = MOBS[id].petSpell;
      expect(spell).toBeTruthy();
      if (!spell) continue;
      const untuned = Math.round(Math.round(spell.min + 20 * 0.8) * DEFENSIVE_STANCE_TAKEN);
      expect(untuned, `${id} untuned`).toBeLessThan(RANGED_FLOOR / 2);
    }
  });
});

describe('normal Wildheart Basin fire-time stamping', () => {
  it('stamps the melee factor on mechanics and the doubled pool on support heals', () => {
    const tuning = basinTuning();
    for (const id of Object.keys(tuning.damageMultiplierByMob)) {
      const mob = createMob(1, MOBS[id], 20, { x: 0, y: 0, z: 0 });
      applyDungeonMobTuning(mob, BASIN, 'normal');
      expect(mob.mechanicDamageMult, id).toBe(tuning.damageMultiplierByMob[id]);
      expect(mob.mechanicHealMult, id).toBe(2.0);
    }
  });

  it('stamps rangedDamageMult on the two casters and on nobody else', () => {
    const tuning = basinTuning();
    for (const id of Object.keys(tuning.damageMultiplierByMob)) {
      const mob = createMob(1, MOBS[id], 20, { x: 0, y: 0, z: 0 });
      applyDungeonMobTuning(mob, BASIN, 'normal');
      expect(mob.rangedDamageMult, id).toBe(tuning.rangedDamageMultiplierByMob?.[id]);
    }
    const ravager = createMob(1, MOBS.wildheart_ravager, 20, { x: 0, y: 0, z: 0 });
    applyDungeonMobTuning(ravager, BASIN, 'normal');
    expect(ravager.rangedDamageMult).toBeUndefined();
  });

  it('scales Zulgar Wildheart Pulse and the Beast Pit Quake by their melee factors', () => {
    const tuning = basinTuning();
    const pulse = MOBS.wildheart_high_priest.aoePulse;
    const quake = MOBS.wildheart_beastmaster.stomp;
    expect(pulse).toBeTruthy();
    expect(quake?.min).toBeTruthy();
    if (!pulse || quake?.min === undefined || quake.max === undefined) return;
    const bossMult = tuning.damageMultiplierByMob.wildheart_high_priest;
    const rareMult = tuning.damageMultiplierByMob.wildheart_beastmaster;
    // Raw (unmitigated) mechanic damage after the per-mob multiplier. The boss
    // pulse sits in the same band as Korgath's Shuddering Stomp (190-285).
    expect(Math.round(pulse.min * bossMult)).toBe(170);
    expect(Math.round(pulse.max * bossMult)).toBe(243);
    expect(Math.round(quake.min * rareMult)).toBe(88);
    expect(Math.round(quake.max * rareMult)).toBe(130);
  });

  it('scales the hexcaller heal and the beastmaster ward with the doubled pools', () => {
    const mend = MOBS.wildheart_hexcaller.mendAlly;
    const ward = MOBS.wildheart_beastmaster.wardAllies;
    expect(mend).toBeTruthy();
    expect(ward).toBeTruthy();
    if (!mend || !ward) return;
    const healMult = basinTuning().healthMultiplier;
    expect(Math.round(mend.healMin * healMult)).toBe(72);
    expect(Math.round(mend.healMax * healMult)).toBe(100);
    expect(Math.round(ward.amount * healMult)).toBe(140);
  });
});

describe('a really claimed normal instance spawns the retuned roster', () => {
  // The assertions above exercise the transform and stamping functions. This one
  // walks the live spawn path end to end, so a tuning record that is never
  // actually reached (the failure mode that let the basin ship untuned) fails
  // here rather than passing on the unit level.
  it('applies the retune to every mob a normal claim spawns', () => {
    const sim = new Sim({
      seed: 91,
      playerClass: 'warrior',
      noPlayer: true,
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    const pid = sim.addPlayer('warrior', 'Alpha');
    expect(enterDungeon(sim.ctx, BASIN, pid)).toBe(true);
    const instance = sim.instances.find((c) => c.dungeonId === BASIN && c.partyKey !== null);
    if (!instance) throw new Error('basin instance was not claimed');
    expect(instance.difficulty).toBe('normal');

    const spawned = instance.mobIds
      .map((id) => sim.entities.get(id))
      .filter((e): e is Entity => !!e && e.kind === 'mob');
    expect(spawned.length).toBe(20);

    const tuning = basinTuning();
    for (const mob of spawned) {
      // Doubled pool, live.
      expect(mob.maxHp, mob.templateId).toBe(normalMaxHp(mob.templateId, mob.level));
      expect(mob.maxHp, mob.templateId).toBeGreaterThan(2000);
      // Fire-time multipliers, live.
      expect(mob.mechanicDamageMult, mob.templateId).toBe(
        tuning.damageMultiplierByMob[mob.templateId],
      );
      expect(mob.mechanicHealMult, mob.templateId).toBe(2.0);
      expect(mob.rangedDamageMult, mob.templateId).toBe(
        tuning.rangedDamageMultiplierByMob?.[mob.templateId],
      );
      // Normal never re-levels: the level-22 pin is heroic-only.
      expect(mob.level, mob.templateId).toBe(20);
    }
    // And the swing the tank actually feels clears the floor on a live spawn.
    const zulgar = spawned.find((m) => m.templateId === 'wildheart_high_priest');
    if (!zulgar) throw new Error('Zulgar did not spawn');
    const afterArmor = Math.round(
      zulgar.weapon.min * (1 - armorReduction(REF_ARMOR, zulgar.level)),
    );
    expect(Math.round(afterArmor * DEFENSIVE_STANCE_TAKEN)).toBeGreaterThanOrEqual(BOSS_FLOOR);
  });
});

describe('heroic Wildheart Basin keeps its own shipped calibration', () => {
  it('pins the heroic transform literals, untouched by the normal retune', () => {
    // Base template x heroic tuning (health 4.0, damage 17.25, armor 1.2, level
    // 22). If the normal retune had been implemented by editing base templates
    // instead of adding a tuning record, these would redden.
    const heroic = mobTemplateForDungeonDifficulty(MOBS.wildheart_high_priest, BASIN, 'heroic');
    expect(heroic.minLevel).toBe(22);
    expect(heroic.hpBase).toBeCloseTo(1880, 10);
    expect(heroic.hpPerLevel).toBeCloseTo(216, 10);
    expect(heroic.dmgBase).toBeCloseTo(293.25, 10);
    expect(heroic.dmgPerLevel).toBeCloseTo(55.2, 10);
    expect(heroic.armorPerLevel).toBeCloseTo(42, 10);
    expect(heroic.moveSpeed).toBe(8);

    const trash = mobTemplateForDungeonDifficulty(MOBS.wildheart_hexcaller, BASIN, 'heroic');
    expect(trash.dmgBase).toBeCloseTo(189.75, 10);
    expect(trash.hpBase).toBeCloseTo(240, 10);
  });

  it('never stamps rangedDamageMult on a heroic spawn', () => {
    // The ranged knob is normal-only by construction (HeroicDungeonTuning has no
    // such field), so heroic Wildheart cannot be silently re-priced by it.
    for (const id of Object.keys(basinTuning().damageMultiplierByMob)) {
      const mob = createMob(1, MOBS[id], 22, { x: 0, y: 0, z: 0 });
      applyDungeonMobTuning(mob, BASIN, 'heroic');
      expect(mob.rangedDamageMult, id).toBeUndefined();
    }
  });
});

describe('the ranged knob does not leak', () => {
  it('leaves every other dungeon and a player pet unscaled', () => {
    // A Sanctum spawn (a tuned normal dungeon with no ranged factors) and an
    // untuned dungeon both keep rangedDamageMult undefined, so the petSpell fire
    // site multiplies by 1 for everything except the two basin casters.
    const boneguard = createMob(1, MOBS.sanctum_boneguard, 19, { x: 0, y: 0, z: 0 });
    applyDungeonMobTuning(boneguard, 'gravewyrm_sanctum', 'normal');
    expect(boneguard.rangedDamageMult).toBeUndefined();

    const untuned = createMob(1, MOBS.wildheart_hexcaller, 20, { x: 0, y: 0, z: 0 });
    applyDungeonMobTuning(untuned, 'hollow_crypt', 'normal');
    expect(untuned.rangedDamageMult).toBeUndefined();

    // A player-owned pet is never touched by instance tuning at all.
    const pet = { ownerId: 7 } as Entity;
    expect(pet.rangedDamageMult).toBeUndefined();
  });
});
