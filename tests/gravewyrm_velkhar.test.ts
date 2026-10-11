// Grand Necromancer Velkhar's phase B core (src/sim/encounters/gravewyrm_sanctum/
// velkhar.ts, design docs/design/dungeon-rework/gravewyrm_sanctum.md section
// 6.2): the Waking Thaw from the pools in turn, the kept 66 and 33 percent
// waves, the death-site rule (Held on cold ice, Unquenched in meltwater: the
// pools, a Soulfire Trench's strip, a heroic Warm Hands puddle), the rise at 60
// percent with the tithe heal, Grasp of the Thawed, the trench and the volley,
// the heroic extras only on heroic claims, the wipe reset, the Stay Buried and
// Cold Comfort conditions, and determinism. Driven through
// tickSanctumEncounters inside a real claimed Sanctum, the mob AI left out so
// every body stays where the test puts it.

import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { RITUAL_VAULT, THAW_POOLS } from '../src/sim/content/gravewyrm_sanctum_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { onMobKillCreditForDeeds } from '../src/sim/deeds';
import { handleGravewyrmSanctumDevChat } from '../src/sim/dev/gravewyrm_sanctum_dev';
import {
  BONEWALKER_ID,
  SANCTUM_DEED_IDS,
  SANCTUM_HELD_STATUE,
  SANCTUM_MELT_STRIP,
  SANCTUM_PYRE_FLARE,
  SANCTUM_TRENCH_LANE,
  SANCTUM_UNQUENCHED_RING,
  SANCTUM_WARM_PUDDLE,
  VELKHAR_TUNING as T,
  tickSanctumEncounters,
  VELKHAR_GRASP,
  VELKHAR_ID,
  VELKHAR_SHADOW_VOLLEY,
  VELKHAR_SOULFIRE_TRENCH,
  VELKHAR_TWICE_WOKEN,
} from '../src/sim/encounters/gravewyrm_sanctum';
import { claimBoss } from '../src/sim/encounters/gravewyrm_sanctum/claim';
import { inMeltwater, rayToRim } from '../src/sim/encounters/gravewyrm_sanctum/meltwater';
import {
  startSoulfireTrench,
  velkharMeltZones,
  velkharState,
  velkharWalkers,
} from '../src/sim/encounters/gravewyrm_sanctum/velkhar';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

const DUNGEON = 'gravewyrm_sanctum';

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
  boss: Entity;
  events: SimEvent[];
  o: { x: number; z: number };
}

/** A claimed Sanctum with the player on cold ice in the vault's south half. */
function room(difficulty: 'normal' | 'heroic' = 'normal', seed = 93): Room {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat(`/dev sanctum enter ${difficulty}`, sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no sanctum claim');
  const o = instanceOrigin(DUNGEONS[DUNGEON].index, inst.slot);
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  me.pos = sim.ctx.groundPos(o.x + RITUAL_VAULT.x, o.z + RITUAL_VAULT.z - 12);
  me.prevPos = { ...me.pos };
  const boss = claimBoss(sim.ctx, inst, VELKHAR_ID) as Entity;
  sim.drainEvents();
  return { sim, inst, me, boss, events: [], o };
}

function engage(r: Room): void {
  r.boss.inCombat = true;
  r.boss.aiState = 'attack';
  r.boss.aggroTargetId = r.me.id;
}

function run(r: Room, seconds: number): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    if (!r.boss.dead) engage(r);
    tickSanctumEncounters(r.sim.ctx);
    r.events.push(...r.sim.drainEvents());
  }
}

function objectsOf(r: Room, templateId: string): Entity[] {
  return r.inst.objectIds
    .map((id) => r.sim.ctx.entities.get(id))
    .filter((e): e is Entity => e !== undefined && e.templateId === templateId);
}

function walkers(r: Room): Entity[] {
  return velkharWalkers(r.sim.ctx, r.boss);
}

function poolWorld(r: Room, i: number): { x: number; z: number } {
  return { x: r.o.x + THAW_POOLS[i].x, z: r.o.z + THAW_POOLS[i].z };
}

function moveTo(r: Room, e: Entity, x: number, z: number): void {
  e.pos = r.sim.ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  r.sim.ctx.rebucket(e);
}

function kill(r: Room, e: Entity): void {
  e.hp = 0;
  r.sim.ctx.handleDeath(e, r.me);
}

/** A cold-ice spot of the vault (its middle). */
function coldIce(r: Room): { x: number; z: number } {
  return { x: r.o.x + RITUAL_VAULT.x, z: r.o.z + RITUAL_VAULT.z };
}

function dealt(r: Room, targetId: number, ability: string): number[] {
  return r.events
    .filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.targetId === targetId && e.ability === ability,
    )
    .map((e) => e.amount);
}

describe('Velkhar: the meltwater geometry', () => {
  it('reads the pools, the strips and the puddles, and clips a ray to the rim', () => {
    const zones = {
      pools: [{ x: 0, z: 0, r: 7 }],
      strips: [{ x: 20, z: 0, yaw: 0, length: 10 }],
      puddles: [{ x: -20, z: 0, r: 3 }],
      stripWidth: 4,
    };
    expect(inMeltwater(zones, 6.9, 0)).toBe(true);
    expect(inMeltwater(zones, 7.2, 0)).toBe(false);
    expect(inMeltwater(zones, 21.9, 5)).toBe(true);
    expect(inMeltwater(zones, 22.2, 5)).toBe(false);
    expect(inMeltwater(zones, 20, 10.5)).toBe(false);
    expect(inMeltwater(zones, -18.1, 0)).toBe(true);
    expect(rayToRim(0, 0, 0, { x: 0, z: 0, r: 19 }, 38)).toBeCloseTo(19, 5);
    expect(rayToRim(0, 5, Math.PI, { x: 0, z: 0, r: 19 }, 38)).toBeCloseTo(24, 5);
    expect(rayToRim(0, 5, 0, { x: 0, z: 0, r: 19 }, 10)).toBe(10);
    expect(rayToRim(0, 30, 0, { x: 0, z: 0, r: 19 }, 38)).toBe(0);
  });

  it('keeps the vault middle and the player spot on cold ice', () => {
    const r = room();
    const zones = velkharMeltZones(r.sim.ctx, r.inst, null);
    const c = coldIce(r);
    expect(inMeltwater(zones, c.x, c.z)).toBe(false);
    expect(inMeltwater(zones, r.me.pos.x, r.me.pos.z)).toBe(false);
    for (let i = 0; i < 3; i++) {
      const p = poolWorld(r, i);
      expect(inMeltwater(zones, p.x, p.z)).toBe(true);
    }
  });
});

describe('Velkhar: Waking Thaw and the waves', () => {
  it('roars a pyre 1.5 s early, then two Bonewalkers climb out; the pools take turns', () => {
    const r = room();
    engage(r);
    run(r, T.thawFirst - T.thawWarn - 0.1);
    expect(objectsOf(r, SANCTUM_PYRE_FLARE)).toHaveLength(0);
    expect(walkers(r)).toHaveLength(0);
    run(r, 0.2);
    const [flare] = objectsOf(r, SANCTUM_PYRE_FLARE);
    expect(flare).toBeDefined();
    const p0 = poolWorld(r, 0);
    expect(Math.hypot(flare.pos.x - p0.x, flare.pos.z - p0.z)).toBeLessThan(0.01);
    expect(flare.scale).toBe(THAW_POOLS[0].r);
    expect(walkers(r)).toHaveLength(0);
    run(r, T.thawWarn);
    const first = walkers(r);
    expect(first).toHaveLength(T.thawCount);
    for (const w of first) {
      expect(Math.hypot(w.pos.x - p0.x, w.pos.z - p0.z)).toBeLessThan(5);
      expect(w.aggroTargetId).toBe(r.me.id);
    }
    // Keep the dead-free floor: park them on cold ice and run to the next thaw.
    run(r, T.thawEvery);
    const p1 = poolWorld(r, 1);
    const second = walkers(r).filter((w) => !first.includes(w));
    expect(second).toHaveLength(T.thawCount);
    for (const w of second) expect(Math.hypot(w.pos.x - p1.x, w.pos.z - p1.z)).toBeLessThan(5);
  });

  it('raises one Bonewalker from each pool at 66 and 33 percent, once each', () => {
    const r = room();
    engage(r);
    run(r, 0.1);
    r.boss.hp = Math.floor(r.boss.maxHp * 0.65);
    run(r, 0.1);
    expect(walkers(r)).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const p = poolWorld(r, i);
      expect(walkers(r).some((w) => Math.hypot(w.pos.x - p.x, w.pos.z - p.z) < 5)).toBe(true);
    }
    run(r, 1);
    expect(walkers(r)).toHaveLength(3);
    r.boss.hp = Math.floor(r.boss.maxHp * 0.3);
    run(r, 0.1);
    expect(walkers(r)).toHaveLength(6);
  });
});

describe('Velkhar: where the dead fall (G24)', () => {
  it('a Bonewalker killed on cold ice is Held: a statue, gone for good', () => {
    const r = room();
    engage(r);
    run(r, 0.1);
    r.boss.hp = Math.floor(r.boss.maxHp * 0.65);
    run(r, 0.1);
    const [w] = walkers(r);
    const c = coldIce(r);
    moveTo(r, w, c.x, c.z);
    kill(r, w);
    run(r, 0.1);
    const [statue] = objectsOf(r, SANCTUM_HELD_STATUE);
    expect(statue).toBeDefined();
    expect(Math.hypot(statue.pos.x - c.x, statue.pos.z - c.z)).toBeLessThan(0.01);
    run(r, T.riseDelay + 2);
    expect(walkers(r)).toHaveLength(2);
    expect(velkharState(r.boss).held).toBe(1);
    expect(velkharState(r.boss).rises).toBe(0);
  });

  it('one killed in a pool is Unquenched: it rises 4 s later at 60 percent and he takes the tithe', () => {
    const r = room();
    engage(r);
    run(r, 0.1);
    r.boss.hp = Math.floor(r.boss.maxHp * 0.65);
    run(r, 0.1);
    const [w] = walkers(r);
    const p = poolWorld(r, 2);
    moveTo(r, w, p.x + 1, p.z);
    kill(r, w);
    run(r, 0.1);
    expect(objectsOf(r, SANCTUM_UNQUENCHED_RING)).toHaveLength(1);
    expect(objectsOf(r, SANCTUM_HELD_STATUE)).toHaveLength(0);
    const hpBefore = r.boss.hp;
    run(r, T.riseDelay - 0.3);
    expect(walkers(r)).toHaveLength(2);
    run(r, 0.4);
    expect(objectsOf(r, SANCTUM_UNQUENCHED_RING)).toHaveLength(0);
    const risen = walkers(r).find((e) => Math.hypot(e.pos.x - p.x - 1, e.pos.z - p.z) < 0.5);
    expect(risen).toBeDefined();
    expect(risen?.hp).toBe(Math.round((risen as Entity).maxHp * T.riseHpShare));
    expect(risen?.auras.some((a) => a.id === VELKHAR_TWICE_WOKEN)).toBe(false);
    // It paid its kill already: a second death pays no XP (no meltwater loop).
    expect(risen?.regrown).toBe(true);
    expect(r.boss.hp - hpBefore).toBe(Math.round(r.boss.maxHp * T.titheHeal));
    expect(r.sim.ctx.entities.has(w.id)).toBe(false);
    expect(velkharState(r.boss).rises).toBe(1);
  });

  it('a Soulfire Trench hits the lane, then its strip is meltwater for 20 s', () => {
    const r = room();
    engage(r);
    run(r, 0.1);
    const st = velkharState(r.boss);
    // Stand the player straight south of him so the lane runs over a known line.
    moveTo(r, r.me, r.boss.pos.x, r.boss.pos.z - 10);
    expect(startSoulfireTrench(r.sim.ctx, r.inst, r.boss, st)).toBe(true);
    expect(r.boss.castingAbility).toBe(VELKHAR_SOULFIRE_TRENCH);
    expect(r.boss.castTargetId).toBe(r.me.id);
    const [lane] = objectsOf(r, SANCTUM_TRENCH_LANE);
    expect(lane).toBeDefined();
    expect(lane.facing).toBeCloseTo(Math.PI, 5);
    // From the vault's middle to the rim: about its radius.
    expect(lane.scale).toBeGreaterThan(RITUAL_VAULT.r - 1);
    expect(lane.scale).toBeLessThan(RITUAL_VAULT.r + 1);
    run(r, T.trenchCast + 0.05);
    const hits = dealt(r, r.me.id, 'Soulfire Trench');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeGreaterThan(0);
    expect(objectsOf(r, SANCTUM_TRENCH_LANE)).toHaveLength(0);
    expect(objectsOf(r, SANCTUM_MELT_STRIP)).toHaveLength(1);
    // A wave Bonewalker killed on the strip is Unquenched.
    r.boss.hp = Math.floor(r.boss.maxHp * 0.65);
    run(r, 0.1);
    const [w] = walkers(r);
    moveTo(r, w, r.boss.pos.x, r.boss.pos.z - 14);
    kill(r, w);
    run(r, 0.1);
    expect(objectsOf(r, SANCTUM_UNQUENCHED_RING)).toHaveLength(1);
    run(r, T.trenchSeconds);
    expect(r.sim.ctx.entities.has(lane.id)).toBe(false);
    expect(r.inst.objectIds.includes(lane.id)).toBe(false);
  });

  it('Grasp of the Thawed rides a Bonewalker only while it stands in meltwater', () => {
    const r = room();
    engage(r);
    run(r, 0.1);
    r.boss.hp = Math.floor(r.boss.maxHp * 0.65);
    run(r, 0.1);
    const [w] = walkers(r);
    const p = poolWorld(r, 0);
    moveTo(r, w, p.x, p.z - 2);
    run(r, 0.1);
    const grasp = w.auras.find((a) => a.id === VELKHAR_GRASP);
    expect(grasp?.kind).toBe('buff_dmg_done');
    expect(grasp?.value).toBe(T.graspDamage);
    const c = coldIce(r);
    moveTo(r, w, c.x, c.z);
    run(r, 0.1);
    expect(w.auras.some((a) => a.id === VELKHAR_GRASP)).toBe(false);
  });
});

describe('Velkhar: his bars', () => {
  it('Shadow Volley hits everyone; the trench comes first when both are due', () => {
    const r = room();
    engage(r);
    run(r, T.volleyFirst - 0.05);
    expect(r.boss.castingAbility).toBe(null);
    run(r, 0.1);
    expect(r.boss.castingAbility).toBe(VELKHAR_SHADOW_VOLLEY);
    run(r, T.volleyCast + 0.05);
    const hits = dealt(r, r.me.id, 'Shadow Volley');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeGreaterThanOrEqual(T.volleyMin * 0.5);
    run(r, T.trenchFirst - T.volleyFirst - T.volleyCast);
    expect(r.boss.castingAbility).toBe(VELKHAR_SOULFIRE_TRENCH);
  });
});

describe('Velkhar: heroic extras', () => {
  it('Warm Hands and Twice-Woken only on heroic', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const r = room(difficulty);
      engage(r);
      run(r, 0.1);
      r.boss.hp = Math.floor(r.boss.maxHp * 0.65);
      run(r, 0.1);
      run(r, T.warmStill + 0.2);
      const puddles = objectsOf(r, SANCTUM_WARM_PUDDLE);
      if (difficulty === 'heroic') {
        expect(puddles.length).toBeGreaterThanOrEqual(3);
        expect(puddles[0].scale).toBe(T.warmRadius);
      } else expect(puddles).toHaveLength(0);
      // A Bonewalker killed in its own puddle (heroic) or a pool (both) rises.
      const [w] = walkers(r);
      const p = poolWorld(r, 1);
      moveTo(r, w, p.x, p.z + 1);
      kill(r, w);
      run(r, T.riseDelay + 0.2);
      const risen = walkers(r).find((e) => Math.hypot(e.pos.x - p.x, e.pos.z - p.z - 1) < 0.5);
      expect(risen).toBeDefined();
      if (difficulty === 'heroic') {
        expect(risen?.hp).toBe(risen?.maxHp);
        expect(risen?.auras.find((a) => a.id === VELKHAR_TWICE_WOKEN)?.value).toBe(
          T.twiceWokenDamage,
        );
      } else {
        expect(risen?.hp).toBeLessThan((risen as Entity).maxHp);
        expect(risen?.auras.some((a) => a.id === VELKHAR_TWICE_WOKEN)).toBe(false);
      }
    }
  });

  it('a heroic puddle on cold ice makes a death there Unquenched', () => {
    const r = room('heroic');
    engage(r);
    run(r, 0.1);
    r.boss.hp = Math.floor(r.boss.maxHp * 0.65);
    run(r, 0.1);
    const [w] = walkers(r);
    const c = coldIce(r);
    moveTo(r, w, c.x + 3, c.z);
    run(r, T.warmStill + 0.1);
    const puddle = objectsOf(r, SANCTUM_WARM_PUDDLE).find(
      (o) => Math.hypot(o.pos.x - c.x - 3, o.pos.z - c.z) < 0.1,
    );
    expect(puddle).toBeDefined();
    kill(r, w);
    run(r, 0.1);
    expect(objectsOf(r, SANCTUM_UNQUENCHED_RING)).toHaveLength(1);
    run(r, T.warmSeconds);
    expect(objectsOf(r, SANCTUM_WARM_PUDDLE).some((o) => o.id === puddle?.id)).toBe(false);
  });
});

describe('Velkhar: wipe reset', () => {
  it('an evade clears the dead, the floor and the clocks', () => {
    const r = room();
    engage(r);
    run(r, T.thawFirst + 0.1);
    r.boss.hp = Math.floor(r.boss.maxHp * 0.65);
    run(r, 0.1);
    const st = velkharState(r.boss);
    moveTo(r, r.me, r.boss.pos.x, r.boss.pos.z - 10);
    startSoulfireTrench(r.sim.ctx, r.inst, r.boss, st);
    run(r, T.trenchCast + 0.1);
    const [w] = walkers(r);
    // Cold ice off both strips (they run south from his spot through the middle).
    moveTo(r, w, coldIce(r).x + 6, coldIce(r).z + 3);
    kill(r, w);
    run(r, 0.1);
    expect(walkers(r).length).toBeGreaterThan(0);
    // Its own trench at 8 s and the one just cast.
    expect(objectsOf(r, SANCTUM_MELT_STRIP)).toHaveLength(2);
    expect(objectsOf(r, SANCTUM_HELD_STATUE)).toHaveLength(1);
    // The wipe: he drops his target and walks home.
    r.boss.aggroTargetId = null;
    r.boss.aiState = 'evade';
    r.boss.hp = r.boss.maxHp;
    tickSanctumEncounters(r.sim.ctx);
    expect(r.boss.sanctumFight).toBeUndefined();
    expect(
      [...r.sim.ctx.entities.values()].filter(
        (e) => e.templateId === BONEWALKER_ID && r.inst.mobIds.includes(e.id),
      ),
    ).toHaveLength(0);
    for (const t of [
      SANCTUM_MELT_STRIP,
      SANCTUM_HELD_STATUE,
      SANCTUM_PYRE_FLARE,
      SANCTUM_UNQUENCHED_RING,
      SANCTUM_TRENCH_LANE,
    ])
      expect(objectsOf(r, t)).toHaveLength(0);
    // The next pull starts over: no wave until 66 percent again.
    engage(r);
    run(r, 0.1);
    expect(walkers(r)).toHaveLength(0);
    r.boss.hp = Math.floor(r.boss.maxHp * 0.65);
    run(r, 0.1);
    expect(walkers(r)).toHaveLength(3);
  });
});

function ensureDeed(id: string): void {
  // The deed records are the loot change's (content/deeds.ts); stand one in for
  // the grant test when this branch does not carry it yet.
  if (!Object.hasOwn(DEEDS, id))
    (DEEDS as Record<string, unknown>)[id] = {
      id,
      name: id,
      desc: id,
      category: 'dungeon',
      renown: 10,
      trigger: { kind: 'manual' },
    };
}

describe('Velkhar: deeds', () => {
  function killFight(r: Room, mode: 'held' | 'pending' | 'rose'): void {
    engage(r);
    run(r, 0.1);
    r.boss.hp = Math.floor(r.boss.maxHp * 0.65);
    run(r, 0.1);
    const ws = walkers(r);
    const c = coldIce(r);
    const p = poolWorld(r, 0);
    for (const [i, w] of ws.entries()) {
      const wet = mode !== 'held' && i === 0;
      moveTo(r, w, wet ? p.x : c.x + i, wet ? p.z : c.z);
      kill(r, w);
    }
    run(r, 0.1);
    if (mode === 'rose') {
      run(r, T.riseDelay + 0.1);
      for (const w of walkers(r)) {
        moveTo(r, w, c.x - 2, c.z);
        kill(r, w);
      }
      run(r, 0.1);
    }
  }

  function bossDies(r: Room): boolean {
    ensureDeed(SANCTUM_DEED_IDS.velkharCold);
    const meta = [...r.sim.ctx.players.values()].find((m) => m.entityId === r.me.id);
    if (!meta) throw new Error('no meta');
    r.boss.hp = 0;
    r.boss.dead = true;
    onMobKillCreditForDeeds(r.sim.ctx, r.boss, null, meta, [meta]);
    tickSanctumEncounters(r.sim.ctx);
    return meta.deedsEarned.has('dgn_velkhar_bonewalkers');
  }

  function meta(r: Room) {
    return [...r.sim.ctx.players.values()].find((m) => m.entityId === r.me.id);
  }

  it('Stay Buried and Cold Comfort: every Bonewalker Held, none rose again', () => {
    const r = room();
    killFight(r, 'held');
    expect(bossDies(r)).toBe(true);
    expect(meta(r)?.deedsEarned.has(SANCTUM_DEED_IDS.velkharCold)).toBe(true);
    expect(r.boss.sanctumFight).toBeUndefined();
  });

  it('a sunk Bonewalker still waiting to rise denies Stay Buried (it never rises after him)', () => {
    const r = room();
    killFight(r, 'pending');
    expect(objectsOf(r, SANCTUM_UNQUENCHED_RING)).toHaveLength(1);
    expect(bossDies(r)).toBe(false);
    // Nobody rose again: Cold Comfort holds; the ring is gone and none rises.
    expect(meta(r)?.deedsEarned.has(SANCTUM_DEED_IDS.velkharCold)).toBe(true);
    expect(objectsOf(r, SANCTUM_UNQUENCHED_RING)).toHaveLength(0);
    run(r, T.riseDelay + 1);
    expect(
      [...r.sim.ctx.entities.values()].filter(
        (e) => e.templateId === BONEWALKER_ID && !e.dead && r.inst.mobIds.includes(e.id),
      ),
    ).toHaveLength(0);
  });

  it('one that rose and was then Held keeps Stay Buried but loses Cold Comfort', () => {
    const r = room();
    killFight(r, 'rose');
    expect(velkharState(r.boss).rises).toBe(1);
    expect(bossDies(r)).toBe(true);
    expect(meta(r)?.deedsEarned.has(SANCTUM_DEED_IDS.velkharCold)).toBe(false);
  });
});

describe('Velkhar: tuning', () => {
  it('states his mechanics landed on normal and on the heroic boss factor', () => {
    expect(room('normal').boss.mechanicDamageMult).toBe(1);
    expect(room('heroic').boss.mechanicDamageMult).toBe(2.5);
    expect(room('normal').boss.maxHp).toBe(15000);
  });
});

describe('Velkhar: the dev trigger', () => {
  it('fires each mechanic of an engaged Velkhar', () => {
    const r = room();
    engage(r);
    run(r, 0.1);
    const say = (what: string) =>
      handleGravewyrmSanctumDevChat(r.sim.ctx, `/dev sanctum trigger ${what}`, r.me.id);
    expect(say('thaw')).toBe(true);
    expect(objectsOf(r, SANCTUM_PYRE_FLARE)).toHaveLength(1);
    say('wave');
    expect(walkers(r)).toHaveLength(3);
    say('trench');
    expect(r.boss.castingAbility).toBe(VELKHAR_SOULFIRE_TRENCH);
    say('volley');
    expect(r.boss.castingAbility).toBe(VELKHAR_SHADOW_VOLLEY);
    say('warm');
    expect(objectsOf(r, SANCTUM_WARM_PUDDLE)).toHaveLength(1);
    say('rise');
    run(r, 0.1);
    expect(objectsOf(r, SANCTUM_UNQUENCHED_RING)).toHaveLength(1);
  });
});

describe('Velkhar: determinism', () => {
  function trace(seed: number): string {
    const r = room('heroic', seed);
    engage(r);
    run(r, 0.1);
    r.boss.hp = Math.floor(r.boss.maxHp * 0.65);
    const out: string[] = [];
    for (let i = 0; i < 40; i++) {
      run(r, 1);
      const ws = walkers(r);
      if (i % 7 === 3 && ws.length > 0) {
        const p = poolWorld(r, i % 3);
        moveTo(r, ws[0], p.x, p.z);
        kill(r, ws[0]);
      }
      out.push(
        `${r.boss.hp}|${r.me.hp}|${r.boss.castingAbility}|${ws.map((w) => `${w.id}:${w.hp}`).join(',')}|${r.inst.objectIds.length}`,
      );
    }
    return out.join('\n');
  }

  it('two runs on one seed play out identically', () => {
    expect(trace(7)).toBe(trace(7));
  });
});
