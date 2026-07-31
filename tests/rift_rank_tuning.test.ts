import { describe, expect, it } from 'vitest';
import {
  RIFT_EPIC_ITEM_IDS,
  RIFT_LEGENDARY_ITEM_IDS,
  RIFT_RARE_ITEM_IDS,
} from '../src/sim/content/rift/items';
import { RIFT_BOSS_IDS, RIFT_TRASH_IDS } from '../src/sim/content/rift/mobs';
import { BUILTIN_WORLD, ITEMS, MOBS, riftInstanceOrigin } from '../src/sim/data';
import { RIFT_MECHANIC_SPACING_SEC } from '../src/sim/mob/mechanic_spacing';
import { riftHeroicClearPool, riftNormalClearPool } from '../src/sim/rift/loot_pools';
import { RIFT_TIER_INFO } from '../src/sim/rift/portals';
import {
  addRiftClearGearLoot,
  RIFT_BLUE_MOUNT_CHANCE,
  RIFT_BLUE_MOUNT_REINS,
  RIFT_COIN_BONUS_A,
  RIFT_COIN_BONUS_B,
  RIFT_COIN_BONUS_C,
  RIFT_COIN_BONUS_S,
  RIFT_EPIC_MOUNT_CHANCE,
  RIFT_EPIC_MOUNT_REINS,
  RIFT_GREEN_MOUNT_CHANCE,
  RIFT_GREEN_MOUNT_REINS,
  RIFT_LEGENDARY_CHANCE_S,
} from '../src/sim/rift/progression';
import {
  capRiftNonLethalMechanicDamage,
  RIFT_HEROIC_MIN_MOVE_SPEED,
  RIFT_HEROIC_TUNING,
  RIFT_NONLETHAL_MECHANIC_CAP_PCT,
  RIFT_RANK_MECHANIC_BUDGET,
  RIFT_S_ZONE_TEMPO,
  type RiftSpawnRole,
  riftFloorLevel,
  riftMechanicSuppressed,
  riftRankForBaseLevel,
  riftRankTuningFor,
  riftRoleDamageMultiplier,
  riftRoleHealthMultiplier,
} from '../src/sim/rift/ranks';
import { generateRiftFloor, isSetPieceSeed, riftFloorCount } from '../src/sim/rift/rift_gen';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, RiftTier, WorldContent } from '../src/sim/types';
import { isInWaterBody } from '../src/sim/world';

// Rank-driven rift difficulty (rift/ranks.ts): the C/B/A/S level bands, the A/S
// heroic stat transform, the rank-gated boss mechanic kits (C=1 .. S=4), the
// boss-add level pin, the A/S one-shot rolling boulder, and the loot tables.

const SEED = 4242;

const RIFT_RANK_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(seed = SEED) {
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    world: RIFT_RANK_TEST_WORLD,
  });
}

function active(sim: Sim) {
  return sim.riftInstances.find((i) => i.partyKey !== null)!;
}

function tickAlive(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) {
    sim.player.hp = sim.player.maxHp;
    sim.tick();
  }
}

function killTrash(sim: Sim): void {
  const inst = active(sim);
  for (const id of inst.mobIds) {
    if (id === inst.bossId) continue;
    const e = sim.entities.get(id);
    if (e) {
      e.hp = 0;
      e.dead = true;
    }
  }
}

/** Enter a rift and descend to its boss floor (the rift_sim.test.ts recipe). */
function enterAtBossFloor(seed: number, baseLevel: number): Sim {
  const sim = makeSim(seed);
  sim.enterRift(seed, baseLevel, sim.player.id);
  const inst = active(sim);
  for (let guard = 0; guard < 10 && inst.floorIndex < inst.floorCount - 1; guard++) {
    killTrash(sim);
    inst.litPylons = new Set(inst.pylonIds);
    inst.puzzleSolved = true;
    tickAlive(sim, 21);
    if (inst.descentId === null) break;
    const desc = sim.entities.get(inst.descentId)!;
    sim.player.pos = { ...desc.pos };
    sim.player.hp = sim.player.maxHp;
    sim.tick();
  }
  expect(inst.floorIndex).toBe(inst.floorCount - 1);
  expect(inst.bossId).not.toBeNull();
  return sim;
}

/** A procedural (non-set-piece) seed whose final-floor boss is `bossId`. */
function seedWithFinalBoss(bossId: string): number {
  for (let s = 1; s < 800; s++) {
    if (isSetPieceSeed(s)) continue;
    const fc = riftFloorCount(s);
    const boss = generateRiftFloor(s, 20, fc - 1).spawns.find((sp) => sp.boss);
    if (boss?.templateId === bossId) return s;
  }
  throw new Error(`no seed found whose final boss is ${bossId}`);
}

describe('rift ranks: derivation and level bands', () => {
  it('riftRankForBaseLevel inverts the portal tier table, and budgets are 1/2/3/4', () => {
    for (const tier of ['C', 'B', 'A', 'S'] as RiftTier[]) {
      expect(riftRankForBaseLevel(RIFT_TIER_INFO[tier].baseLevel)).toBe(tier);
    }
    expect(RIFT_RANK_MECHANIC_BUDGET).toEqual({ C: 1, B: 2, A: 3, S: 4 });
  });

  it('C ramps 20..22, B/A hold 22, S is flat 23', () => {
    expect([0, 1, 2, 3, 5].map((i) => riftFloorLevel(20, i))).toEqual([20, 21, 22, 22, 22]);
    expect([0, 3, 5].map((i) => riftFloorLevel(22, i))).toEqual([22, 22, 22]);
    expect([0, 3, 5].map((i) => riftFloorLevel(25, i))).toEqual([22, 22, 22]);
    // S-rank mobs are flat 23 on every floor (no ramp to 25).
    expect([0, 1, 2, 3, 5].map((i) => riftFloorLevel(28, i))).toEqual([23, 23, 23, 23, 23]);
  });
});

describe('rift ranks: boss mechanic kits (content integrity)', () => {
  const DRIVER_KEYS = new Set([
    'aoePulse',
    'aoeSlow',
    'bigCast',
    'stoneskin',
    'stomp',
    'terrify',
    'summonAdds',
    'desperateHeal',
    'deathZoneCast',
    'deathZoneStrike',
  ]);

  it('every rift boss lists exactly 4 distinct mechanics its template actually carries', () => {
    for (const id of RIFT_BOSS_IDS) {
      const t = MOBS[id] as unknown as Record<string, unknown>;
      const kit = MOBS[id].rankMechanics;
      expect(kit, `${id} has a rankMechanics kit`).toBeDefined();
      expect(kit, id).toHaveLength(4);
      expect(new Set(kit).size, `${id} kit keys are distinct`).toBe(4);
      for (const key of kit ?? []) {
        expect(DRIVER_KEYS.has(key), `${id} kit key ${key} has a gated driver`).toBe(true);
        expect(t[key], `${id} template carries ${key}`).toBeDefined();
      }
    }
  });

  it('suppression follows the entity budget; unlisted non-driver-keys (enrage, knockback) are never gated; unlisted driver-keys ARE suppressed at all ranks', () => {
    const bossAt = (limit: number | undefined) =>
      ({ templateId: 'rift_boss_frost', riftMechanicLimit: limit }) as unknown as Entity;
    // Frost kit order: aoePulse, aoeSlow, deathZoneCast, deathZoneStrike.
    const c = bossAt(1);
    expect(riftMechanicSuppressed(c, 'aoePulse')).toBe(false);
    expect(riftMechanicSuppressed(c, 'aoeSlow')).toBe(true);
    expect(riftMechanicSuppressed(c, 'deathZoneCast')).toBe(true);
    expect(riftMechanicSuppressed(c, 'deathZoneStrike')).toBe(true);
    expect(riftMechanicSuppressed(c, 'enrage'), 'unlisted keys are never gated').toBe(false);
    expect(riftMechanicSuppressed(c, 'stomp'), 'unlisted driver key suppressed at all ranks').toBe(
      true,
    );
    expect(
      riftMechanicSuppressed(c, 'knockback'),
      'knockback (unlisted, not a driver key) never gated',
    ).toBe(false);
    const b = bossAt(2);
    expect(riftMechanicSuppressed(b, 'aoeSlow')).toBe(false);
    expect(riftMechanicSuppressed(b, 'deathZoneCast')).toBe(true);
    const s = bossAt(4);
    for (const key of ['aoePulse', 'aoeSlow', 'deathZoneCast', 'deathZoneStrike']) {
      expect(riftMechanicSuppressed(s, key), `S runs ${key}`).toBe(false);
    }
    const trash = bossAt(undefined);
    expect(riftMechanicSuppressed(trash, 'aoeSlow'), 'no budget = nothing gated').toBe(false);
    const nonRift = { templateId: 'wolf', riftMechanicLimit: 1 } as unknown as Entity;
    expect(riftMechanicSuppressed(nonRift, 'aoePulse'), 'no kit = nothing gated').toBe(false);
  });
});

describe('rift ranks: C/B/A/S spawn scaling', () => {
  it('every rank takes a stat transform + mechanic multipliers, on its own table', () => {
    // Since the 2026-07-26 recalibration C is scaled too, on the sibling
    // RIFT_NORMAL_TUNING (the normal-dungeon rung), so no rank spawns raw
    // templates any more. C keeps the template's own move speed: the anti-kite
    // floor is a heroic-only property.
    for (const baseLevel of [20, 22, 25, 28]) {
      const tier = riftRankForBaseLevel(baseLevel);
      const tuning = riftRankTuningFor(baseLevel);
      const sim = makeSim();
      sim.enterRift(SEED, baseLevel, sim.player.id);
      const inst = active(sim);
      expect(inst.mobIds.length).toBeGreaterThan(0);
      for (const id of inst.mobIds) {
        const m = sim.entities.get(id)!;
        const t = MOBS[m.templateId];
        // Floor 0 is never a boss floor, but a C set-piece seed fields the
        // citadel miniboss there, which takes the BOSS pair.
        const role: RiftSpawnRole = id === inst.bossId || id === inst.minibossId ? 'boss' : 'trash';
        expect(m.mechanicDamageMult, `${tier} mob ${m.templateId}`).toBe(
          riftRoleDamageMultiplier(tuning, role),
        );
        expect(m.mechanicHealMult).toBe(riftRoleHealthMultiplier(tuning, role));
        if (tier === 'C') {
          expect(m.moveSpeed, 'C keeps the template speed').toBe(t.moveSpeed);
        } else {
          expect(m.moveSpeed, 'anti-kite move-speed floor').toBeGreaterThanOrEqual(
            RIFT_HEROIC_MIN_MOVE_SPEED,
          );
        }
        // The spawn-time template transform reached the derived stats: maxHp is
        // the elite formula over the health-multiplied template line.
        const hm = riftRoleHealthMultiplier(tuning, role);
        const eliteHp = t.elite ? 2.3 : 1;
        const expected = Math.round((t.hpBase * hm + t.hpPerLevel * hm * (m.level - 1)) * eliteHp);
        expect(m.maxHp, `${tier} ${m.templateId} hp`).toBe(expected);
      }
    }
    // Trash never carries a boss mechanic budget, at any rank.
    for (const baseLevel of [20, 22, 25, 28]) {
      const sim = makeSim();
      sim.enterRift(SEED, baseLevel, sim.player.id);
      const inst = active(sim);
      for (const id of inst.mobIds) {
        if (id === inst.bossId || id === inst.minibossId) continue;
        expect(
          sim.entities.get(id)!.riftMechanicLimit,
          'trash carries no mechanic budget',
        ).toBeUndefined();
      }
    }
  });

  it('the boss mechanic budget follows the rank (C=1 .. S=4) on the boss floor', () => {
    const seed = seedWithFinalBoss('rift_boss_ember');
    const c = enterAtBossFloor(seed, 20);
    const cBoss = c.entities.get(active(c).bossId!)!;
    expect(cBoss.riftMechanicLimit).toBe(1);
    expect(cBoss.level, 'C boss holds the 22 cap').toBe(22);
    const s = enterAtBossFloor(seed, 28);
    const sBoss = s.entities.get(active(s).bossId!)!;
    expect(sBoss.riftMechanicLimit).toBe(4);
    // S-rank is flat 23 on every floor (no ramp to 25).
    expect(sBoss.level, 'S boss is flat 23').toBe(23);
  });
});

describe('rift ranks: rank-gated summons + the boss-add level pin', () => {
  // Necro kit order: summonAdds (index 0), bigCast (index 1), deathZoneCast (index 2),
  // deathZoneStrike (index 3). summonAdds is the C-rank mechanic: it always fires.
  // Adds must spawn at the boss's level, not the template band.
  it('necro C rank fires summonAdds (index 0); adds spawn AT the boss level (not 50)', () => {
    const seed = seedWithFinalBoss('rift_boss_necro');

    const c = enterAtBossFloor(seed, 20);
    const cBoss = c.entities.get(active(c).bossId!)!;
    c.player.gm = true; // survive the boss so combat (and the wave window) persists
    c.player.pos = { ...cBoss.pos, z: cBoss.pos.z - 4 };
    c.player.prevPos = { ...c.player.pos };
    // Drop the necro below its first summon threshold (0.7).
    (c as unknown as { dealDamage: Function }).dealDamage(
      c.player,
      cBoss,
      Math.round(cBoss.maxHp * 0.5),
      false,
      'physical',
      'test',
      'hit',
      true,
    );
    tickAlive(c, 3);
    expect(cBoss.summonedIds.length, 'C rank fires summonAdds (index 0)').toBeGreaterThan(0);
    for (const addId of cBoss.summonedIds) {
      const add = c.entities.get(addId)!;
      // The level-50 bug: adds rolled the template band before the fix.
      // They must spawn AT the boss's level (add.level === boss.level).
      expect(add.level, 'adds match the boss level').toBe(cBoss.level);
    }

    // Kit integrity: deathZoneStrike is the S-rank capstone at index 3.
    expect(
      MOBS['rift_boss_necro'].rankMechanics?.indexOf('deathZoneStrike'),
      'deathZoneStrike is at index 3',
    ).toBe(3);
  });
});

describe('rift ranks: lethal boss death zone (deathZoneCast / deathZoneStrike)', () => {
  // Frost kit: aoePulse (C), aoeSlow (B), deathZoneCast (A), deathZoneStrike (S).
  // At S rank (budget=4) the boss has both lethal mechanics active. A player
  // standing inside the zone when the fuse expires should be instantly killed;
  // one who stepped out survives.
  it('A-rank frost boss death zone detonates and kills a standing player', () => {
    const seed = seedWithFinalBoss('rift_boss_frost');
    const sim = enterAtBossFloor(seed, 25); // A rank (baseLevel 25)
    const inst = active(sim);
    const boss = sim.entities.get(inst.bossId!)!;
    sim.player.gm = false;
    // Position the player inside the boss's melee range so it enters combat and
    // the cast-bar mechanic ticks. Keep the player alive between ticks.
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 3 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.hp = sim.player.maxHp;

    // Manually inject a death zone with a very short fuse.
    inst.bossDeathZones.push({
      x: sim.player.pos.x,
      z: sim.player.pos.z,
      radius: 12,
      remaining: 0.05,
    });
    // One tick: the fuse expires and the zone detonates.
    sim.player.hp = sim.player.maxHp; // restore so only the zone kills
    sim.tick();
    expect(sim.player.dead, 'player inside the zone is killed on detonation').toBe(true);
  });

  it('deathZoneStrike is suppressed at A rank (budget=3)', () => {
    const bossAt = (limit: number) =>
      ({ templateId: 'rift_boss_frost', riftMechanicLimit: limit }) as unknown as Entity;
    expect(
      riftMechanicSuppressed(bossAt(3), 'deathZoneStrike'),
      'A suppresses deathZoneStrike',
    ).toBe(true);
    expect(riftMechanicSuppressed(bossAt(4), 'deathZoneStrike'), 'S runs deathZoneStrike').toBe(
      false,
    );
  });

  it('bossDeathZones clears between floors', () => {
    const seed = seedWithFinalBoss('rift_boss_frost');
    const sim = enterAtBossFloor(seed, 25);
    const inst = active(sim);
    inst.bossDeathZones.push({ x: 0, z: 0, radius: 9, remaining: 5 });
    // Simulate a floor descent (freeRiftFloorEntities clears zones).
    inst.bossDeathZones = [];
    expect(inst.bossDeathZones, 'zones cleared between floors').toHaveLength(0);
  });

  it('heroic_s tempo: S death zones cast faster and recycle sooner; A keeps the base tempo', () => {
    const seed = seedWithFinalBoss('rift_boss_frost');
    const def = MOBS.rift_boss_frost.deathZoneCast!;
    const fire = (baseLevel: number) => {
      const sim = enterAtBossFloor(seed, baseLevel);
      const inst = active(sim);
      const boss = sim.entities.get(inst.bossId!)!;
      // Aggro warm-up: mechanics only tick in the chase/attack AI states, and
      // the player must SURVIVE it (heroic_s hits one-shot a naked level-20; a
      // dead player drops combat and resets the boss). The boss floor's trash
      // is culled and a big absorb shield soaks the warm-up swings.
      killTrash(sim);
      sim.player.auras.push({
        id: 'test_absorb',
        name: 'Test Absorb',
        kind: 'absorb',
        remaining: 999,
        duration: 999,
        value: 100_000_000,
        sourceId: sim.player.id,
        school: 'physical',
      } as Entity['auras'][number]);
      boss.deathZoneCastTimer = 999;
      boss.deathZoneStrikeTimer = 999;
      sim.player.pos = { ...boss.pos, z: boss.pos.z - 3 };
      sim.player.prevPos = { ...sim.player.pos };
      tickAlive(sim, 5);
      // Fire tick from outside melee reach so nothing else lands this tick.
      sim.player.pos = { ...boss.pos, z: boss.pos.z - 6 };
      sim.player.prevPos = { ...sim.player.pos };
      sim.player.hp = sim.player.maxHp;
      boss.deathZoneCastTimer = 0.01;
      // The warm-up ticks fired other kit mechanics (aoePulse lands on the
      // first engaged tick) which armed the shared spacing lock; the zone
      // under test must fire from a clear lock, as it would in a real fight
      // once the spacing window has passed.
      boss.mechanicLockTimer = 0;
      inst.bossDeathZones = [];
      sim.tick();
      return { sim, inst, boss };
    };
    const s = fire(28);
    expect(s.boss.castTotal, 'S cast bar runs at tempo').toBeCloseTo(
      def.castTime * RIFT_S_ZONE_TEMPO,
      5,
    );
    expect(s.inst.bossDeathZones, 'S zone placed').toHaveLength(1);
    // The zone ticks down once within the fire tick, hence the elapsed DT.
    expect(s.inst.bossDeathZones[0].remaining, 'S fuse matches the tempo cast').toBeCloseTo(
      def.castTime * RIFT_S_ZONE_TEMPO - 1 / 20,
      5,
    );
    expect(s.boss.deathZoneCastTimer, 'S cadence recycles sooner').toBeCloseTo(
      (def.every + def.castTime) * RIFT_S_ZONE_TEMPO,
      5,
    );
    const a = fire(25);
    expect(a.boss.castTotal, 'A cast bar unchanged').toBeCloseTo(def.castTime, 5);
    expect(a.inst.bossDeathZones[0].remaining, 'A fuse unchanged').toBeCloseTo(
      def.castTime - 1 / 20,
      5,
    );
    expect(a.boss.deathZoneCastTimer, 'A cadence unchanged').toBeCloseTo(
      def.every + def.castTime,
      5,
    );
  });

  it('heroic_s barrage: at S deathZoneStrike drops a zone under EVERY living member', () => {
    const seed = seedWithFinalBoss('rift_boss_frost');
    const sim = makeSim(seed);
    sim.player.level = 20;
    const pid2 = sim.addPlayer('warrior', 'P2', { autoEquip: true });
    const p2 = sim.entities.get(pid2)!;
    p2.level = 20;
    sim.partyInvite(pid2, sim.player.id);
    sim.partyAccept(pid2);
    sim.enterRift(seed, 28, sim.player.id);
    sim.enterRift(seed, 28, pid2);
    const inst = active(sim);
    // Drive the party to the boss floor (the enterAtBossFloor loop, keeping
    // both members alive through hazards and trash).
    p2.gm = true;
    for (let guard = 0; guard < 10 && inst.floorIndex < inst.floorCount - 1; guard++) {
      killTrash(sim);
      inst.litPylons = new Set(inst.pylonIds);
      inst.puzzleSolved = true;
      for (let i = 0; i < 21; i++) {
        sim.player.hp = sim.player.maxHp;
        p2.hp = p2.maxHp;
        sim.tick();
      }
      if (inst.descentId === null) break;
      const desc = sim.entities.get(inst.descentId)!;
      sim.player.pos = { ...desc.pos };
      p2.pos = { ...desc.pos };
      sim.player.hp = sim.player.maxHp;
      p2.hp = p2.maxHp;
      sim.tick();
    }
    expect(inst.floorIndex).toBe(inst.floorCount - 1);
    const boss = sim.entities.get(inst.bossId!)!;
    // Aggro warm-up in melee reach (mechanics tick in chase/attack only); both
    // members must survive it (heroic_s hits one-shot a naked 20), so the boss
    // floor's trash is culled and both get big absorb shields.
    killTrash(sim);
    p2.gm = false;
    const shield = (e: Entity) =>
      e.auras.push({
        id: 'test_absorb',
        name: 'Test Absorb',
        kind: 'absorb',
        remaining: 999,
        duration: 999,
        value: 100_000_000,
        sourceId: e.id,
        school: 'physical',
      } as Entity['auras'][number]);
    shield(sim.player);
    shield(p2);
    boss.deathZoneCastTimer = 999;
    boss.deathZoneStrikeTimer = 999;
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 3 };
    sim.player.prevPos = { ...sim.player.pos };
    for (let i = 0; i < 5; i++) {
      sim.player.hp = sim.player.maxHp;
      p2.hp = p2.maxHp;
      sim.tick();
    }
    // ...then spread the two members outside melee so the barrage anchors are
    // distinguishable and nothing else lands on the fire tick.
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 6 };
    sim.player.prevPos = { ...sim.player.pos };
    p2.pos = { ...boss.pos, x: boss.pos.x + 6 };
    p2.prevPos = { ...p2.pos };
    sim.player.hp = sim.player.maxHp;
    p2.hp = p2.maxHp;
    boss.deathZoneStrikeTimer = 0.01;
    // Clear the shared spacing lock the warm-up mechanics armed, so the
    // barrage under test fires on the very next tick.
    boss.mechanicLockTimer = 0;
    inst.bossDeathZones = [];
    sim.tick();
    expect(inst.bossDeathZones, 'one zone per living member at S').toHaveLength(2);
    const anchors = inst.bossDeathZones.map((z) => `${Math.round(z.x)}:${Math.round(z.z)}`);
    expect(new Set(anchors).size, 'zones land on distinct member positions').toBe(2);
  });

  it('the heroic tuning table covers exactly B, A and S', () => {
    // The transform tests above assert WIRING against this table (field on the
    // mob === field in the table). The VALUES are pinned as literals, together
    // with C's RIFT_NORMAL_TUNING and every floor they were solved against, in
    // tests/rift_difficulty_floors.test.ts: that is the file that must go red
    // when the dungeon ladder moves. Here we only pin the rank COVERAGE, which
    // is what this file's wiring assertions depend on (C must stay absent, or
    // the citadel and the C boulder gate change meaning silently).
    expect(Object.keys(RIFT_HEROIC_TUNING).sort()).toEqual(['A', 'B', 'S']);
  });

  it('B-rank boss adds take the softer add multiplier (venom summons in budget)', () => {
    const seed = seedWithFinalBoss('rift_boss_venom');
    const b = enterAtBossFloor(seed, 22);
    const bBoss = b.entities.get(active(b).bossId!)!;
    b.player.gm = true; // survive the heroic boss so the summoned wave persists
    b.player.pos = { ...bBoss.pos, z: bBoss.pos.z - 4 };
    b.player.prevPos = { ...b.player.pos };
    (b as unknown as { dealDamage: Function }).dealDamage(
      b.player,
      bBoss,
      Math.round(bBoss.maxHp * 0.5),
      false,
      'physical',
      'test',
      'hit',
      true,
    );
    tickAlive(b, 3);
    expect(bBoss.summonedIds.length, 'B summons (venom slot 1 fits budget 2)').toBeGreaterThan(0);
    const addMult = RIFT_HEROIC_TUNING.B!.addDamageMultiplier;
    for (const addId of bBoss.summonedIds) {
      const add = b.entities.get(addId)!;
      expect(add.level, 'adds match the boss level').toBe(bBoss.level);
      expect(add.mechanicDamageMult, 'softer add multiplier, literal').toBe(10.3);
      expect(addMult, 'and it is the table value').toBe(10.3);
      // Strictly softer than the boss's own line: wave pressure, not extra bosses.
      expect(addMult).toBeLessThan(RIFT_HEROIC_TUNING.B!.bossDamageMultiplier);
      const t = MOBS[add.templateId];
      const swing = t.dmgBase * addMult + t.dmgPerLevel * addMult * (add.level - 1);
      expect(add.weapon.min, 'add swings at the softer multiplier').toBe(Math.round(swing * 0.8));
    }
  });
});

describe('rift ranks: non-lethal mechanic damage cap (heroic_s safety rule)', () => {
  it('caps a raw hit below max HP, never below 1', () => {
    expect(capRiftNonLethalMechanicDamage(1_000_000, 1000)).toBe(900);
    expect(capRiftNonLethalMechanicDamage(500, 1000)).toBe(500);
    expect(capRiftNonLethalMechanicDamage(5, 1)).toBe(1);
  });

  it('a rift boss aoePulse never one-shots a full-health player, even absurdly multiplied', () => {
    const seed = seedWithFinalBoss('rift_boss_frost');
    const sim = enterAtBossFloor(seed, 28);
    const inst = active(sim);
    const boss = sim.entities.get(inst.bossId!)!;
    const pulse = MOBS.rift_boss_frost.aoePulse!;
    sim.player.gm = false;
    // Aggro warm-up within melee reach (mechanics tick in chase/attack only);
    // the boss floor's trash is culled and an absorb shield (consumed BEFORE
    // hp, so the cap assertion below still reads raw amounts) soaks the
    // warm-up swings. The shield is stripped again before the fire tick.
    killTrash(sim);
    sim.player.auras.push({
      id: 'test_absorb',
      name: 'Test Absorb',
      kind: 'absorb',
      remaining: 999,
      duration: 999,
      value: 100_000_000,
      sourceId: sim.player.id,
      school: 'physical',
    } as Entity['auras'][number]);
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 3 };
    sim.player.prevPos = { ...sim.player.pos };
    boss.pulseTimer = 999;
    boss.deathZoneCastTimer = 999;
    boss.deathZoneStrikeTimer = 999;
    tickAlive(sim, 5);
    // Strip the shield so the pulse's damage event reports the applied amount.
    sim.player.auras = sim.player.auras.filter((a) => a.id !== 'test_absorb');
    // ...then step outside melee but inside the pulse radius for the fire tick,
    // so the only damage this tick is the pulse itself.
    sim.player.pos = { ...boss.pos, z: boss.pos.z - Math.min(6, pulse.radius - 1) };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.hp = sim.player.maxHp;
    boss.mechanicDamageMult = 10_000_000; // force the raw roll far beyond max HP
    boss.pulseTimer = 0.01;
    const events = sim.tick();
    const hit = events.find(
      (ev) => ev.type === 'damage' && ev.ability === pulse.name && ev.targetId === sim.player.id,
    ) as { amount: number } | undefined;
    expect(hit, 'the pulse landed').toBeTruthy();
    const cap = Math.floor(sim.player.maxHp * RIFT_NONLETHAL_MECHANIC_CAP_PCT);
    expect(hit!.amount, 'the cap engaged exactly').toBe(cap);
    expect(sim.player.dead, 'full-health player survives the raw mechanic').toBe(false);
  });
});

describe('rift ranks: A/S one-shot rolling boulder', () => {
  function rollerSeed(): number {
    for (let s = 1; s < 800; s++) {
      const f = generateRiftFloor(s, 20, 0);
      if (!f.isBoss && f.rollers.length > 0) return s;
    }
    throw new Error('no roller seed found');
  }

  function parkInLane(sim: Sim): void {
    const inst = active(sim);
    killTrash(sim);
    const origin = riftInstanceOrigin(inst.slot, 0);
    const floor = generateRiftFloor(inst.seed, inst.baseLevel, 0);
    const lane = floor.rollers[0];
    sim.player.pos = sim.player.pos && {
      ...sim.player.pos,
      x: origin.x + lane.x,
      z: origin.z + (lane.z0 + lane.z1) / 2,
    };
    sim.player.prevPos = { ...sim.player.pos };
  }

  it('C chips a fraction of max hp; B/A/S execute outright (lava stays a burn)', () => {
    const seed = rollerSeed();

    const c = makeSim(seed);
    c.enterRift(seed, 20, c.player.id);
    parkInLane(c);
    c.player.hp = c.player.maxHp;
    for (let i = 0; i < 20 * 30 && c.player.hp === c.player.maxHp; i++) {
      parkInLane(c);
      c.tick();
    }
    expect(c.player.dead, 'a C-rank boulder is survivable').toBe(false);
    expect(c.player.hp, 'but it hurts').toBeLessThan(c.player.maxHp);

    // B-rank boulders are lethal (B now has heroic tuning).
    const b = makeSim(seed);
    b.enterRift(seed, 22, b.player.id);
    parkInLane(b);
    b.player.hp = b.player.maxHp;
    for (let i = 0; i < 20 * 30 && !b.player.dead; i++) {
      parkInLane(b);
      b.tick();
    }
    expect(b.player.dead, 'a B-rank boulder is a one-shot kill').toBe(true);

    const a = makeSim(seed);
    a.enterRift(seed, 25, a.player.id);
    parkInLane(a);
    a.player.hp = a.player.maxHp;
    for (let i = 0; i < 20 * 30 && !a.player.dead; i++) {
      parkInLane(a);
      a.tick();
    }
    expect(a.player.dead, 'an A-rank boulder is a one-shot kill').toBe(true);
  });

  it('lava burns below S and executes outright at S (environmental one-shot)', () => {
    // A floor-0 hazard clear of every roller lane, so only the lava acts.
    const hazardFor = (baseLevel: number) => {
      for (let s = 1; s < 600; s++) {
        if (isSetPieceSeed(s)) continue;
        const floor = generateRiftFloor(s, baseLevel, 0);
        const hz = (floor.hazards ?? []).find((h) =>
          floor.rollers.every((rl) => Math.abs(h.x - rl.x) > rl.r + (h.rx ?? h.r) + 1),
        );
        if (!floor.isBoss && hz) return { seed: s, hz };
      }
      throw new Error('no floor-0 hazard seed found');
    };
    const soak = (baseLevel: number) => {
      const { seed, hz } = hazardFor(baseLevel);
      const sim = makeSim(seed);
      sim.enterRift(seed, baseLevel, sim.player.id);
      const inst = active(sim);
      killTrash(sim);
      const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
      sim.player.hp = sim.player.maxHp;
      for (let i = 0; i < 20 * 4 && !sim.player.dead; i++) {
        sim.player.pos = { x: origin.x + hz.x, y: 0, z: origin.z + hz.z };
        sim.player.prevPos = { ...sim.player.pos };
        sim.tick();
      }
      return sim;
    };
    const a = soak(25);
    expect(a.player.dead, 'A lava is a burn, not an execute').toBe(false);
    expect(a.player.hp, 'A lava burns').toBeLessThan(a.player.maxHp);
    const s = soak(28);
    expect(s.player.dead, 'S lava executes outright').toBe(true);
  });
});

describe('rift loot: every rift creature pays out', () => {
  it('every declared rift rare resolves, is rare quality, and actually drops', () => {
    const dropped = new Set(
      [...RIFT_TRASH_IDS, ...RIFT_BOSS_IDS].flatMap((id) =>
        MOBS[id].loot.map((entry) => entry.itemId),
      ),
    );
    for (const id of RIFT_RARE_ITEM_IDS) {
      expect(ITEMS[id], id).toBeDefined();
      expect(ITEMS[id].quality, id).toBe('rare');
      expect(dropped.has(id), `${id} drops from some rift creature`).toBe(true);
    }
  });

  it('every trash template carries its themed rare + an essence trickle + coin', () => {
    for (const id of RIFT_TRASH_IDS) {
      const loot = MOBS[id].loot;
      expect(
        loot.some((e) => e.copper !== undefined && e.chance === 1),
        id,
      ).toBe(true);
      expect(
        loot.some((e) => e.itemId !== undefined && e.itemId !== 'rift_essence'),
        `${id} drops a themed rare`,
      ).toBe(true);
      expect(
        loot.some((e) => e.itemId === 'rift_essence'),
        `${id} trickles essence`,
      ).toBe(true);
    }
  });

  it('every boss carries a fat rare chance plus guaranteed essence', () => {
    for (const id of RIFT_BOSS_IDS) {
      const loot = MOBS[id].loot;
      const rare = loot.find((e) => e.itemId !== undefined && e.itemId !== 'rift_essence');
      expect(rare, `${id} drops a signature item`).toBeDefined();
      expect(rare!.chance, id).toBeGreaterThanOrEqual(0.35);
      expect(
        loot.filter((e) => e.itemId === 'rift_essence' && e.chance === 1).length,
        `${id} guarantees essence`,
      ).toBeGreaterThanOrEqual(1);
    }
    expect(MOBS.rift_boss_ritualist.loot.some((e) => e.itemId === 'pactbound_vestments')).toBe(
      true,
    );
    expect(MOBS.rift_boss_pitlord.loot.some((e) => e.itemId === 'pitlords_cleaver')).toBe(true);
  });

  it('a killed non-main boss (the citadel ritualist) leaves a lootable corpse with items', () => {
    let seed = -1;
    for (let s = 1; s < 400 && seed < 0; s++) if (isSetPieceSeed(s)) seed = s;
    expect(seed, 'found a set-piece seed').toBeGreaterThan(0);
    const sim = makeSim(seed);
    sim.enterRift(seed, 20, sim.player.id);
    const inst = active(sim);
    expect(inst.minibossId, 'the citadel halls field a miniboss').not.toBeNull();
    const mini = sim.entities.get(inst.minibossId!)!;
    sim.player.pos = { ...mini.pos, z: mini.pos.z - 3 };
    sim.player.prevPos = { ...sim.player.pos };
    (sim as unknown as { dealDamage: Function }).dealDamage(
      sim.player,
      mini,
      mini.hp + 100,
      false,
      'physical',
      'test',
      'hit',
      true,
    );
    expect(mini.dead).toBe(true);
    expect(mini.lootable, 'the miniboss corpse is lootable').toBe(true);
    const items = mini.loot?.items ?? [];
    expect(
      items.filter((i) => i.itemId === 'rift_essence').length,
      'guaranteed essence dropped',
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('rift ranks: rune-reset notice rate limit', () => {
  it('standing on a wrong rune announces once per cooldown, not every tick', () => {
    let seed = -1;
    for (let s = 1; s < 800 && seed < 0; s++) {
      const f = generateRiftFloor(s, 20, 0);
      if (!f.isBoss && f.puzzle.kind === 'sequence') seed = s;
    }
    expect(seed, 'found a sequence floor').toBeGreaterThan(0);
    const sim = makeSim(seed);
    sim.enterRift(seed, 20, sim.player.id);
    const inst = active(sim);
    killTrash(sim);
    sim.player.gm = true;
    const wrongRune = sim.entities.get(inst.seqRuneIds[1])!;
    const countResets = (ticks: number): number => {
      let n = 0;
      for (let i = 0; i < ticks; i++) {
        sim.player.pos = { ...wrongRune.pos };
        sim.player.prevPos = { ...sim.player.pos };
        sim.player.hp = sim.player.maxHp;
        for (const ev of sim.tick()) {
          if (ev.type === 'log' && ev.text === 'The runes go dark. Begin again.') n++;
        }
      }
      return n;
    };
    // The bug: 20 notices per second while standing still. Now: one on arrival...
    expect(countResets(40), 'one notice in the first two seconds').toBe(1);
    // ...and at most a couple more across the next ten (the 4s cooldown cadence).
    const later = countResets(200);
    expect(later).toBeGreaterThanOrEqual(1);
    expect(later).toBeLessThanOrEqual(3);
  });

  it('a reset that wipes real progress announces immediately, cooldown or not', () => {
    let seed = -1;
    for (let s = 1; s < 800 && seed < 0; s++) {
      const f = generateRiftFloor(s, 20, 0);
      if (
        !f.isBoss &&
        f.puzzle.kind === 'sequence' &&
        f.objects.filter((o) => o.kind === 'seq_rune').length >= 3
      )
        seed = s;
    }
    const sim = makeSim(seed);
    sim.enterRift(seed, 20, sim.player.id);
    const inst = active(sim);
    killTrash(sim);
    sim.player.gm = true;
    const stepOnto = (i: number): ReturnType<Sim['tick']> => {
      const rune = sim.entities.get(inst.seqRuneIds[i])!;
      sim.player.pos = { ...rune.pos };
      sim.player.prevPos = { ...sim.player.pos };
      sim.player.hp = sim.player.maxHp;
      return sim.tick();
    };
    // Trip the no-progress notice (stamps the cooldown)...
    stepOnto(1);
    expect(inst.seqStep).toBe(0);
    // ...then advance legitimately and wipe: the wipe must announce despite the
    // ticking cooldown, because progress was actually lost.
    stepOnto(0);
    expect(inst.seqStep).toBe(1);
    const events = stepOnto(2);
    expect(inst.seqStep).toBe(0);
    expect(
      events.some((e) => e.type === 'log' && e.text === 'The runes go dark. Begin again.'),
    ).toBe(true);
  });
});

describe('rift ranks: B/A/S rifts are never shorter than 3 floors', () => {
  it('a set-piece seed opens the 2-floor citadel at C only; B/A/S run procedural 3+', () => {
    // B now has the heroic transform, so isSetPieceRift gates on tuning !== null.
    // The citadel is C-only content; B/A/S all run the procedural descent.
    let seed = -1;
    for (let s = 1; s < 400 && seed < 0; s++) if (isSetPieceSeed(s)) seed = s;
    expect(seed).toBeGreaterThan(0);
    // C: the citadel (2 authored floors).
    expect(riftFloorCount(seed)).toBe(2);
    expect(riftFloorCount(seed, 20)).toBe(2);
    expect(generateRiftFloor(seed, 20, 0).authored).toBe(true);
    // B on a citadel seed now runs procedural 3+ (B has heroic tuning).
    expect(riftFloorCount(seed, 22), 'B runs procedural').toBeGreaterThanOrEqual(3);
    const bFloor = generateRiftFloor(seed, 22, 0);
    expect(bFloor.authored, 'B never opens the 2-floor set-piece').toBeUndefined();
    expect(bFloor.floorCount).toBeGreaterThanOrEqual(3);
    // A/S: guaranteed 3+ procedural floors, never the 2-floor set-piece.
    for (const baseLevel of [25, 28]) {
      expect(riftFloorCount(seed, baseLevel), `base ${baseLevel}`).toBeGreaterThanOrEqual(3);
      const f0 = generateRiftFloor(seed, baseLevel, 0);
      expect(f0.authored, 'A/S runs the procedural generator').toBeUndefined();
      expect(f0.floorCount).toBeGreaterThanOrEqual(3);
    }
    // And every procedural rift is 3+ floors at every rank anyway.
    for (let s = 1; s <= 60; s++) {
      if (isSetPieceSeed(s)) continue;
      for (const baseLevel of [20, 22, 25, 28]) {
        expect(riftFloorCount(s, baseLevel)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('an S-rank citadel-seed run fields S-band mobs (flat 23) on its procedural floors', () => {
    let seed = -1;
    for (let s = 1; s < 400 && seed < 0; s++) if (isSetPieceSeed(s)) seed = s;
    const floor = generateRiftFloor(seed, 28, 0);
    // S-rank is flat 23 on every floor.
    for (const sp of floor.spawns) expect(sp.level).toBe(23);
  });
});

describe('rift ranks: clear-time epic and legendary payout', () => {
  it('the declared epic/legendary shells resolve at the right quality', () => {
    for (const id of RIFT_EPIC_ITEM_IDS) {
      expect(ITEMS[id], id).toBeDefined();
      expect(ITEMS[id].quality, id).toBe('epic');
    }
    for (const id of RIFT_LEGENDARY_ITEM_IDS) {
      expect(ITEMS[id], id).toBeDefined();
      expect(ITEMS[id].quality, id).toBe('legendary');
    }
  });

  it('C pays one normal-pool drop + coin, B/A guarantee one heroic epic, S guarantees plus rolls more', () => {
    const epicIds = new Set<string>(riftHeroicClearPool());
    const normalIds = new Set<string>(riftNormalClearPool());
    const legendaryIds = new Set<string>(RIFT_LEGENDARY_ITEM_IDS);
    const mountIds = new Set<string>([
      ...RIFT_GREEN_MOUNT_REINS,
      ...RIFT_BLUE_MOUNT_REINS,
      ...RIFT_EPIC_MOUNT_REINS,
    ]);
    // Returns only the gear (non-mount) items from a clear.
    const run = (baseLevel: number, rngSeed: number) => {
      const boss = { loot: { copper: 0, items: [] }, lootable: false } as unknown as Entity;
      const ctx = { rng: new Rng(rngSeed) } as unknown as SimContext;
      addRiftClearGearLoot(ctx, boss, baseLevel);
      return boss.loot!.items.map((i) => i.itemId).filter((id) => !mountIds.has(id!));
    };
    const runCopper = (baseLevel: number, rngSeed: number): number => {
      const boss = { loot: { copper: 0, items: [] }, lootable: false } as unknown as Entity;
      const ctx = { rng: new Rng(rngSeed) } as unknown as SimContext;
      addRiftClearGearLoot(ctx, boss, baseLevel);
      return boss.loot!.copper;
    };
    for (let s = 1; s <= 40; s++) {
      // C: exactly one drop from the NORMAL five-man pool, never a heroic epic.
      const c = run(20, s);
      expect(c.length, 'C pays exactly one item').toBe(1);
      expect(normalIds.has(c[0]!), 'C pays from the normal pool').toBe(true);
      expect(epicIds.has(c[0]!), 'C never pays from the heroic pool').toBe(false);
      expect(runCopper(20, s), 'C pays the coin bonus').toBe(RIFT_COIN_BONUS_C);
      const a = run(25, s);
      expect(a.length, 'A guarantees exactly one epic').toBe(1);
      expect(epicIds.has(a[0]!), 'A pays from the heroic pool').toBe(true);
      // B: guaranteed 1 epic (RIFT_EPIC_CHANCE_B = 1.0).
      const b = run(22, s);
      expect(b.length, 'B guarantees exactly one epic').toBe(1);
      expect(epicIds.has(b[0]!), 'B pays from the heroic pool').toBe(true);
      const sDrops = run(28, s);
      expect(sDrops.length, 'S guarantees one epic').toBeGreaterThanOrEqual(1);
      // Ceiling: guaranteed epic + second epic + one roll per legendary.
      expect(sDrops.length).toBeLessThanOrEqual(2 + RIFT_LEGENDARY_ITEM_IDS.length);
      expect(epicIds.has(sDrops[0]!)).toBe(true);
      for (const id of sDrops) {
        expect(epicIds.has(id!) || legendaryIds.has(id!)).toBe(true);
      }
    }
  });

  it('the mount ladder: C none, B green only, A blue only, S epic only, each at its own rate', () => {
    const run = (baseLevel: number, rngSeed: number): string[] => {
      const boss = { loot: { copper: 0, items: [] }, lootable: false } as unknown as Entity;
      const ctx = { rng: new Rng(rngSeed) } as unknown as SimContext;
      addRiftClearGearLoot(ctx, boss, baseLevel);
      return boss.loot!.items.map((i) => i.itemId!) as string[];
    };
    const SAMPLE = 20_000;
    const tiers = [
      { rank: 'C', baseLevel: 20, reins: [] as readonly string[], chance: 0 },
      { rank: 'B', baseLevel: 22, reins: RIFT_GREEN_MOUNT_REINS, chance: RIFT_GREEN_MOUNT_CHANCE },
      { rank: 'A', baseLevel: 25, reins: RIFT_BLUE_MOUNT_REINS, chance: RIFT_BLUE_MOUNT_CHANCE },
      { rank: 'S', baseLevel: 28, reins: RIFT_EPIC_MOUNT_REINS, chance: RIFT_EPIC_MOUNT_CHANCE },
    ];
    const allReins = new Set<string>([
      ...RIFT_GREEN_MOUNT_REINS,
      ...RIFT_BLUE_MOUNT_REINS,
      ...RIFT_EPIC_MOUNT_REINS,
    ]);
    for (const tier of tiers) {
      const own = new Set<string>(tier.reins);
      let hits = 0;
      for (let s = 1; s <= SAMPLE; s++) {
        for (const id of run(tier.baseLevel, s)) {
          if (!allReins.has(id)) continue;
          // A rank never sheds a tier it did not earn, in either direction.
          expect(own.has(id), `${tier.rank} dropped ${id}, which is not its tier`).toBe(true);
          hits++;
        }
      }
      const expected = SAMPLE * tier.chance;
      if (tier.chance === 0) {
        expect(hits, `${tier.rank} rolls no mount at all`).toBe(0);
        continue;
      }
      expect(
        hits,
        `${tier.rank} observed ${hits}/${SAMPLE}, expected about ${expected}`,
      ).toBeGreaterThan(expected * 0.5);
      expect(
        hits,
        `${tier.rank} observed ${hits}/${SAMPLE}, expected about ${expected}`,
      ).toBeLessThan(expected * 1.7);
    }
  });

  it('each rift legendary drops at its own declared 0.3% rate on S, and never below S', () => {
    const mountIds = new Set<string>([
      ...RIFT_GREEN_MOUNT_REINS,
      ...RIFT_BLUE_MOUNT_REINS,
      ...RIFT_EPIC_MOUNT_REINS,
    ]);
    const run = (baseLevel: number, rngSeed: number) => {
      const boss = { loot: { copper: 0, items: [] }, lootable: false } as unknown as Entity;
      const ctx = { rng: new Rng(rngSeed) } as unknown as SimContext;
      addRiftClearGearLoot(ctx, boss, baseLevel);
      return boss.loot!.items.map((i) => i.itemId).filter((id) => !mountIds.has(id!));
    };
    // A 0.3% rate needs a big sample to be measurable at all; 20 000 clears puts
    // the expectation at 60 per legendary, tight enough to catch a 2x mistuning.
    const SAMPLE = 20_000;
    const hits = new Map<string, number>(RIFT_LEGENDARY_ITEM_IDS.map((id) => [id, 0]));
    for (let s = 1; s <= SAMPLE; s++) {
      for (const id of run(28, s)) if (hits.has(id!)) hits.set(id!, hits.get(id!)! + 1);
    }
    const expected = SAMPLE * RIFT_LEGENDARY_CHANCE_S; // 60
    for (const id of RIFT_LEGENDARY_ITEM_IDS) {
      const n = hits.get(id)!;
      expect(n, `${id} observed ${n}/${SAMPLE}, expected about ${expected}`).toBeGreaterThan(
        expected * 0.5,
      );
      expect(n, `${id} observed ${n}/${SAMPLE}, expected about ${expected}`).toBeLessThan(
        expected * 1.7,
      );
    }
    // C/B/A never shed a legendary, no matter how many clears.
    for (const baseLevel of [20, 22, 25]) {
      for (let s = 1; s <= 2000; s++) {
        for (const id of run(baseLevel, s)) expect(RIFT_LEGENDARY_ITEM_IDS).not.toContain(id);
      }
    }
  });

  it('an S clear leaves a heroic epic on the corpse; a C clear leaves a normal-pool drop', () => {
    const seed = seedWithFinalBoss('rift_boss_ember');
    const epicIds = new Set<string>(riftHeroicClearPool());
    const normalIds = new Set<string>(riftNormalClearPool());

    const s = enterAtBossFloor(seed, 28);
    const sBoss = s.entities.get(active(s).bossId!)!;
    s.player.gm = true;
    s.player.pos = { ...sBoss.pos, z: sBoss.pos.z - 4 };
    s.player.prevPos = { ...s.player.pos };
    (s as unknown as { dealDamage: Function }).dealDamage(
      s.player,
      sBoss,
      sBoss.hp + 100,
      false,
      'physical',
      'test',
      'hit',
      true,
    );
    expect(sBoss.dead).toBe(true);
    tickAlive(s, 25); // the 1 Hz sweep claims the clear and pays the gear
    const sItems = (sBoss.loot?.items ?? []).map((i) => i.itemId);
    expect(
      sItems.some((id) => epicIds.has(id!) || RIFT_LEGENDARY_ITEM_IDS.includes(id as never)),
      `S corpse carries clear gear (got: ${sItems.join(',')})`,
    ).toBe(true);

    const c = enterAtBossFloor(seed, 20);
    const cBoss = c.entities.get(active(c).bossId!)!;
    c.player.gm = true;
    c.player.pos = { ...cBoss.pos, z: cBoss.pos.z - 4 };
    c.player.prevPos = { ...c.player.pos };
    (c as unknown as { dealDamage: Function }).dealDamage(
      c.player,
      cBoss,
      cBoss.hp + 100,
      false,
      'physical',
      'test',
      'hit',
      true,
    );
    tickAlive(c, 25);
    const cItems = (cBoss.loot?.items ?? []).map((i) => i.itemId);
    expect(
      cItems.some((id) => epicIds.has(id!) || RIFT_LEGENDARY_ITEM_IDS.includes(id as never)),
      'C corpse never carries an epic or legendary',
    ).toBe(false);
    expect(
      cItems.some((id) => normalIds.has(id!)),
      `C corpse carries a normal-pool drop (got: ${cItems.join(',')})`,
    ).toBe(true);
  });

  it('rank coin bonus: C/B/A/S each pay the correct copper bonus', () => {
    const runCopper = (baseLevel: number, rngSeed: number): number => {
      const boss = { loot: { copper: 0, items: [] }, lootable: false } as unknown as Entity;
      const ctx = { rng: new Rng(rngSeed) } as unknown as SimContext;
      addRiftClearGearLoot(ctx, boss, baseLevel);
      return boss.loot!.copper;
    };
    // C gets the normal-tier coin bonus (RIFT_COIN_BONUS_C = 10 000c).
    for (let s = 1; s <= 10; s++) {
      expect(runCopper(20, s), 'C rank: normal-tier coin bonus').toBe(RIFT_COIN_BONUS_C);
    }
    // B always gets exactly RIFT_COIN_BONUS_B regardless of other draws.
    for (let s = 1; s <= 10; s++) {
      expect(runCopper(22, s), 'B rank: flat 10 000c bonus').toBe(RIFT_COIN_BONUS_B);
    }
    // A always gets exactly RIFT_COIN_BONUS_A.
    for (let s = 1; s <= 10; s++) {
      expect(runCopper(25, s), 'A rank: flat 35 000c bonus').toBe(RIFT_COIN_BONUS_A);
    }
    // S always gets exactly RIFT_COIN_BONUS_S.
    for (let s = 1; s <= 10; s++) {
      expect(runCopper(28, s), 'S rank: flat 50 000c bonus').toBe(RIFT_COIN_BONUS_S);
    }
  });
});

describe('rift exit: the way home is never anchored in water', () => {
  it('entering from inside a water body dries out the return point', () => {
    // Find a declared water point on the overworld.
    let wet: { x: number; z: number } | null = null;
    for (let x = -400; x <= 400 && !wet; x += 7) {
      for (let z = -3000; z <= 3000 && !wet; z += 11) {
        if (isInWaterBody(x, z)) wet = { x, z };
      }
    }
    expect(wet, 'found a water point to test from').not.toBeNull();
    const sim = makeSim();
    sim.enterRift(SEED, 20, sim.player.id, wet!);
    const inst = active(sim);
    expect(isInWaterBody(inst.returnPos.x, inst.returnPos.z), 'return point is dry').toBe(false);
  });
});

// ---- Walk-in throttle pins ---------------------------------------------------
// These pin the rate-limit behavior of the four repeating messages that fire on
// the 20 Hz walk-in path without a throttle. Counting emitted messages over a
// fixed tick window proves they stay within the cooldown cadence.

describe('rift throttle: pool-full error fires at most once per cooldown window', () => {
  it('standing in a full-pool portal emits the error once per 4 s, not every call', () => {
    const sim = makeSim();
    // Fill every rift slot so no free slot exists.
    for (const inst of sim.riftInstances) {
      inst.partyKey = 'party:occupied';
    }
    // A fake portal entity carrying the fields enterRift's portal-gate checks read.
    const fakePortal = {
      id: 9999,
      riftSeed: SEED,
      riftBaseLevel: 20,
      pos: { x: 0, y: 0, z: 0 },
    } as unknown as import('../src/sim/types').Entity;
    sim.player.level = 20;
    const drainPoolFull = (): number => {
      sim.enterRift(SEED, 20, sim.player.id, undefined, fakePortal);
      return (sim as unknown as { drainEvents(): import('../src/sim/types').SimEvent[] })
        .drainEvents()
        .filter(
          (ev) =>
            ev.type === 'error' &&
            (ev as { text: string }).text === 'All rifts are unstable right now. Try again soon.',
        ).length;
    };
    // First call: one error.
    expect(drainPoolFull(), 'first call emits the error').toBe(1);
    // Immediate re-call: silenced by cooldown.
    expect(drainPoolFull(), 'immediate re-call is silenced').toBe(0);
    // After 100 ticks (> 4 s), the cooldown has elapsed: one more error.
    tickAlive(sim, 100);
    expect(drainPoolFull(), 'error fires again after cooldown').toBe(1);
  });
});

describe('rift throttle: level-denial error fires at most once per 4 s', () => {
  it('low-level player re-entering a portal sees the denial once per cooldown', () => {
    const sim = makeSim();
    const fakePortal = {
      id: 9998,
      riftSeed: SEED,
      riftBaseLevel: 20,
      pos: { x: 0, y: 0, z: 0 },
    } as unknown as import('../src/sim/types').Entity;
    sim.player.level = 1;
    const deny = 'Only adventurers of level 20 or higher may enter this rift.';
    const drainDeny = (): number => {
      sim.enterRift(SEED, 20, sim.player.id, undefined, fakePortal);
      return (sim as unknown as { drainEvents(): import('../src/sim/types').SimEvent[] })
        .drainEvents()
        .filter((ev) => ev.type === 'error' && (ev as { text: string }).text === deny).length;
    };
    expect(drainDeny(), 'first call emits the denial').toBe(1);
    expect(drainDeny(), 'immediate re-call is silenced').toBe(0);
    tickAlive(sim, 100);
    expect(drainDeny(), 'denial fires again after 4 s cooldown').toBe(1);
  });
});

describe('rift throttle: orb-notice fires at most once per 6 s cooldown', () => {
  it('standing at a dormant Blood Orb nudges at most once per 6 s, not every tick', () => {
    let setPieceSeed = -1;
    for (let s = 1; s < 400 && setPieceSeed < 0; s++) {
      if (isSetPieceSeed(s)) setPieceSeed = s;
    }
    expect(setPieceSeed, 'found a set-piece seed').toBeGreaterThan(0);
    const sim = makeSim(setPieceSeed);
    sim.enterRift(setPieceSeed, 20, sim.player.id);
    const inst = active(sim);
    expect(inst.orbId, 'authored floor has an orb').not.toBeNull();
    const orb = sim.entities.get(inst.orbId!)!;
    sim.player.gm = true;
    const countOrb = (ticks: number): number => {
      let n = 0;
      for (let i = 0; i < ticks; i++) {
        sim.player.pos = { ...orb.pos };
        sim.player.prevPos = { ...sim.player.pos };
        sim.player.hp = sim.player.maxHp;
        for (const ev of sim.tick()) {
          if (
            ev.type === 'log' &&
            (ev as { text?: string }).text === 'The orb is sealed by the ritual below.'
          )
            n++;
        }
      }
      return n;
    };
    // 120 ticks = 6 s: one nudge on arrival, then silence for the rest.
    expect(countOrb(120), 'one nudge per 6 s window').toBe(1);
    expect(countOrb(120), 'one more nudge in the next window').toBe(1);
  });
});

describe('rift throttle: seq-reset notice is instance-level, not per-player', () => {
  it('two party members standing on a wrong rune produce one broadcast per window', () => {
    let seqSeed = -1;
    for (let s = 1; s < 800 && seqSeed < 0; s++) {
      const f = generateRiftFloor(s, 20, 0);
      if (
        !f.isBoss &&
        f.puzzle.kind === 'sequence' &&
        f.objects.filter((o) => o.kind === 'seq_rune').length >= 2
      )
        seqSeed = s;
    }
    expect(seqSeed, 'found a multi-rune sequence floor').toBeGreaterThan(0);
    const sim = makeSim(seqSeed);
    sim.player.level = 20;
    // Add a second player and form a party with the primary.
    const pid2 = sim.addPlayer('warrior', 'P2', { autoEquip: true });
    const p2 = sim.entities.get(pid2)!;
    p2.level = 20;
    sim.partyInvite(pid2, sim.player.id);
    sim.partyAccept(pid2);
    // Both enter the rift (they share the same instance because they are in a party).
    sim.enterRift(seqSeed, 20, sim.player.id);
    sim.enterRift(seqSeed, 20, pid2);
    const inst = active(sim);
    killTrash(sim);
    sim.player.gm = true;
    p2.gm = true;
    // Both stand on the SECOND rune (wrong: the sequence requires rune 0 first).
    const wrongRune = sim.entities.get(inst.seqRuneIds[1])!;
    const countNotices = (ticks: number): number => {
      let n = 0;
      for (let i = 0; i < ticks; i++) {
        sim.player.pos = { ...wrongRune.pos };
        sim.player.prevPos = { ...sim.player.pos };
        p2.pos = { ...wrongRune.pos };
        p2.prevPos = { ...p2.pos };
        sim.player.hp = sim.player.maxHp;
        p2.hp = p2.maxHp;
        for (const ev of sim.tick()) {
          if (
            ev.type === 'log' &&
            (ev as { text?: string }).text === 'The runes go dark. Begin again.'
          )
            n++;
        }
      }
      return n;
    };
    // The instance-level stamp means exactly ONE broadcast fires per 4 s window.
    // Each broadcast sends the log to every member: 2 players = 2 log events.
    // With the old per-player stamp, BOTH players would trigger a broadcast on the
    // same tick = up to 4 log events in the first tick (2 players x 2 recipients).
    const first80 = countNotices(80);
    expect(first80, 'one broadcast per window (2 recipients)').toBe(2);
    const next80 = countNotices(80);
    expect(next80, 'one broadcast in the next window').toBe(2);
  });
});

describe('rift ranks: budget escape and citadel exemption', () => {
  it('an unlisted driver key (stomp on frost boss) is suppressed at every rank limit', () => {
    const boss = (limit: number | undefined) =>
      ({ templateId: 'rift_boss_frost', riftMechanicLimit: limit }) as unknown as Entity;
    // frost kit: aoePulse, aoeSlow, deathZoneCast, deathZoneStrike - stomp not listed
    expect(riftMechanicSuppressed(boss(1), 'stomp'), 'stomp suppressed at C').toBe(true);
    expect(riftMechanicSuppressed(boss(4), 'stomp'), 'stomp suppressed at S').toBe(true);
    // enrage and knockback are not driver keys - never gated
    expect(riftMechanicSuppressed(boss(1), 'enrage'), 'enrage never gated').toBe(false);
    expect(riftMechanicSuppressed(boss(1), 'knockback'), 'knockback never gated').toBe(false);
  });

  it('citadel bosses carry no riftMechanicLimit (exempt from rank budget)', () => {
    let seed = -1;
    for (let s = 1; s < 400 && seed < 0; s++) if (isSetPieceSeed(s)) seed = s;
    expect(seed).toBeGreaterThan(0);
    const sim = makeSim(seed);
    sim.enterRift(seed, 20, sim.player.id);
    const inst = active(sim);
    // The citadel fields a miniboss (ritualist) and a boss (pitlord).
    // Neither should carry riftMechanicLimit since citadel is exempt, but BOTH
    // still carry the shared mechanic spacing (the budget exemption is about
    // kit size, not about letting mechanics stack).
    if (inst.minibossId !== null) {
      const mini = sim.entities.get(inst.minibossId!)!;
      expect(mini.riftMechanicLimit, 'citadel miniboss is exempt from rank budget').toBeUndefined();
      expect(mini.riftMechanicSpacing, 'citadel miniboss still spaced').toBe(
        RIFT_MECHANIC_SPACING_SEC,
      );
    }
    if (inst.bossId !== null) {
      const boss = sim.entities.get(inst.bossId!)!;
      expect(boss.riftMechanicLimit, 'citadel boss is exempt from rank budget').toBeUndefined();
      expect(boss.riftMechanicSpacing, 'citadel boss still spaced').toBe(RIFT_MECHANIC_SPACING_SEC);
    }
  });

  it('every rift-spawned boss is stamped with the shared mechanic spacing; trash is not', () => {
    const seed = seedWithFinalBoss('rift_boss_frost');
    const sim = enterAtBossFloor(seed, 28); // S rank
    const inst = active(sim);
    const boss = sim.entities.get(inst.bossId!)!;
    expect(boss.riftMechanicSpacing, 'ranked boss stamped').toBe(RIFT_MECHANIC_SPACING_SEC);
    expect(boss.riftMechanicLimit, 'ranked boss still budget-capped').toBe(
      RIFT_RANK_MECHANIC_BUDGET.S,
    );
    const trash = inst.mobIds
      .map((id) => sim.entities.get(id))
      .filter((m): m is Entity => !!m && m.id !== inst.bossId && m.id !== inst.minibossId);
    for (const m of trash) {
      expect(m.riftMechanicSpacing, `${m.templateId} trash unstamped`).toBeUndefined();
    }
  });

  it('a live spacing lock holds a due death zone; the cast starts once the lock clears', () => {
    const seed = seedWithFinalBoss('rift_boss_frost');
    const sim = enterAtBossFloor(seed, 28); // S rank: deathZoneCast live
    const inst = active(sim);
    const boss = sim.entities.get(inst.bossId!)!;
    const def = MOBS.rift_boss_frost.deathZoneCast!;
    killTrash(sim);
    sim.player.auras.push({
      id: 'test_absorb',
      name: 'Test Absorb',
      kind: 'absorb',
      remaining: 999,
      duration: 999,
      value: 100_000_000,
      sourceId: sim.player.id,
      school: 'physical',
    } as Entity['auras'][number]);
    boss.deathZoneCastTimer = 999;
    boss.deathZoneStrikeTimer = 999;
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 3 };
    sim.player.prevPos = { ...sim.player.pos };
    tickAlive(sim, 5); // warm-up: aoePulse fires on first contact and arms the lock
    expect(boss.mechanicLockTimer, 'warm-up armed the shared lock').toBeGreaterThan(0);
    boss.deathZoneCastTimer = 0.01; // due now, but the lock is live
    inst.bossDeathZones = [];
    let heldTicks = 0;
    while (boss.castingAbility !== def.castId && heldTicks < 20 * 8) {
      // While the lock runs the due zone must hold: no cast, no zone placed.
      if ((boss.mechanicLockTimer ?? 0) > 0) {
        expect(boss.castingAbility, 'no cast while the lock runs').toBeNull();
        expect(inst.bossDeathZones, 'no zone while the lock runs').toHaveLength(0);
      }
      sim.player.hp = sim.player.maxHp;
      sim.tick();
      heldTicks++;
    }
    expect(boss.castingAbility, 'the held zone cast once the lock cleared').toBe(def.castId);
    expect(inst.bossDeathZones.length, 'the zone was placed at cast start').toBeGreaterThan(0);
    // It held for roughly the lock remainder, not a full fresh cycle.
    expect(heldTicks * (1 / 20)).toBeLessThanOrEqual(RIFT_MECHANIC_SPACING_SEC + 0.5);
  });

  it('dodgeability: deathZone castTime satisfies slowedSpeed * castTime >= radius * 1.2 for each boss with in-kit CC', () => {
    const RUN_SPEED = 7;
    const cases: Array<{
      id: string;
      ccMult: number;
      zone: string;
      minCastTime: number;
      stunDuration?: number;
    }> = [
      // frost: aoeSlow mult 0.4
      { id: 'rift_boss_frost', ccMult: 0.4, zone: 'deathZoneCast', minCastTime: 4.0 },
      { id: 'rift_boss_frost', ccMult: 0.4, zone: 'deathZoneStrike', minCastTime: 5.0 },
      // venom: aoeSlow mult 0.5
      { id: 'rift_boss_venom', ccMult: 0.5, zone: 'deathZoneCast', minCastTime: 3.2 },
      { id: 'rift_boss_venom', ccMult: 0.5, zone: 'deathZoneStrike', minCastTime: 4.0 },
      // brute: stomp stun 1.5s (free_run_time = castTime - 1.5 must cover radius/speed)
      {
        id: 'rift_boss_brute',
        ccMult: 1,
        stunDuration: 1.5,
        zone: 'deathZoneCast',
        minCastTime: 3.5,
      },
      {
        id: 'rift_boss_brute',
        ccMult: 1,
        stunDuration: 1.5,
        zone: 'deathZoneStrike',
        minCastTime: 4.0,
      },
      // tide: terrify 2.5s (full fear covers entire old fuse)
      {
        id: 'rift_boss_tide',
        ccMult: 1,
        stunDuration: 2.5,
        zone: 'deathZoneCast',
        minCastTime: 5.0,
      },
      {
        id: 'rift_boss_tide',
        ccMult: 1,
        stunDuration: 2.5,
        zone: 'deathZoneStrike',
        minCastTime: 5.0,
      },
    ];
    for (const { id, ccMult, zone, minCastTime, stunDuration } of cases) {
      const tmpl = MOBS[id] as unknown as Record<string, { castTime: number; radius: number }>;
      const def = tmpl[zone];
      expect(def, `${id}.${zone} exists`).toBeDefined();
      expect(def.castTime, `${id}.${zone} castTime >= ${minCastTime}`).toBeGreaterThanOrEqual(
        minCastTime,
      );
      // Verify the actual dodgeability inequality.
      const freeSecs = stunDuration ? def.castTime - stunDuration : def.castTime;
      const escapeDist = RUN_SPEED * ccMult * freeSecs;
      expect(
        escapeDist,
        `${id}.${zone}: escape dist ${escapeDist.toFixed(2)} >= required ${(def.radius * 1.2).toFixed(2)}`,
      ).toBeGreaterThanOrEqual(def.radius * 1.2);
    }
  });
});
