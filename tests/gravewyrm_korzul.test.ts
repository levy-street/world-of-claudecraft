// Korzul the Gravewyrm's phase B core (src/sim/encounters/gravewyrm_sanctum/
// korzul.ts, design 6.3): the plate floor (G25: the ladder, the refreeze, the
// quench-water), his ground kit (Grave Breath burning the plates it covers,
// Tail Sweep, the Grave Inferno cut short when his plate breaks: Doused), the
// flights (G26: Wing Gale, out of reach on the wing, Wyrm's Eye and Plunging
// Fire, Brood from Below, Crashing Descent), the last phase, the heroic extras
// (Deep Quench, Twin Eyes), the wipe reset and Thin Ice. Driven through
// tickSanctumEncounters inside a real claimed Sanctum, with the mob AI held
// still (the trash test's shape), so every assertion reads the encounter.

import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { LAKE_PLATES, WYRMS_HOLLOW } from '../src/sim/content/gravewyrm_sanctum_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import {
  KORZUL_AIRBORNE,
  KORZUL_BREAK_FREE,
  KORZUL_CRASHING_DESCENT,
  KORZUL_DOUSED,
  KORZUL_GRAVE_BREATH,
  KORZUL_GRAVE_INFERNO,
  KORZUL_ID,
  KORZUL_PLUNGING_FIRE,
  KORZUL_SHARD_FLARE,
  KORZUL_WYRMS_EYE,
  plateOf,
  SANCTUM_DEED_IDS,
  SANCTUM_LANDING_SHADOW,
  SANCTUM_PLUNGING_FIRE,
  SANCTUM_QUENCH_WATER,
  SCALEGUARD_ID,
  KORZUL_TUNING as T,
  tickSanctumEncounters,
} from '../src/sim/encounters/gravewyrm_sanctum';
import { claimBoss } from '../src/sim/encounters/gravewyrm_sanctum/claim';
import {
  burnLakePlate,
  KORZUL_TAKEOFF_SECONDS,
  korzulDevTrigger,
  korzulState,
  thinIceEarned,
} from '../src/sim/encounters/gravewyrm_sanctum/korzul';
import {
  emergeBeat,
  emergeFacing,
  emergePose,
  KORZUL_EMERGE,
  KORZUL_EMERGE_ALTITUDE,
  KORZUL_EMERGE_ARC_AT,
  KORZUL_EMERGE_FROM,
  KORZUL_EMERGE_LAND_AT,
  KORZUL_EMERGE_RISE_AT,
  KORZUL_EMERGE_SECONDS,
  KORZUL_EMERGE_TO,
  KORZUL_WAKE_RADIUS,
} from '../src/sim/encounters/gravewyrm_sanctum/korzul_emerge_plan';
import type { KorzulFightState } from '../src/sim/encounters/gravewyrm_sanctum/korzul_state';
import {
  conePlates,
  nearestPlate,
  plateIndexAt,
} from '../src/sim/encounters/gravewyrm_sanctum/plates';
import { storyStep } from '../src/sim/encounters/gravewyrm_sanctum/story';
import { dungeonGateState } from '../src/sim/instances/dungeon_gates';
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
  ox: number;
  oz: number;
}

function room(difficulty: 'normal' | 'heroic' = 'normal', seed = 93): Room {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat(`/dev sanctum enter ${difficulty}`, sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no sanctum claim');
  const boss = claimBoss(sim.ctx, inst, KORZUL_ID);
  if (!boss) throw new Error('no Korzul');
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS[DUNGEON].index, inst.slot);
  sim.drainEvents();
  const r: Room = { sim, inst, me, boss, events: [], ox: o.x, oz: o.z };
  // The tank stands 4 yd south of him (his body faces south down the lake).
  put(r, me, boss.pos.x - o.x, boss.pos.z - o.z - 4);
  return r;
}

function put(r: Room, e: Entity, lx: number, lz: number): void {
  e.pos = r.sim.ctx.groundPos(r.ox + lx, r.oz + lz);
  e.prevPos = { ...e.pos };
  r.sim.ctx.rebucket(e);
}

function addPlayer(r: Room, name: string, lx: number, lz: number): Entity {
  const pid = r.sim.addPlayer('mage', name);
  r.sim.setPlayerLevel(20, pid);
  const e = r.sim.ctx.entities.get(pid) as Entity;
  put(r, e, lx, lz);
  return e;
}

/** Hold him in his fight on the tank, and tick the encounters. */
function run(r: Room, seconds: number, engaged = true): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    if (engaged && !r.boss.dead) {
      r.boss.inCombat = true;
      r.boss.aiState = 'attack';
      r.boss.aggroTargetId ??= r.me.id;
    }
    // Nobody dies: every hit is read off its damage event.
    for (const meta of r.sim.ctx.players.values()) {
      const p = r.sim.ctx.entities.get(meta.entityId);
      if (p) p.hp = p.maxHp;
    }
    tickSanctumEncounters(r.sim.ctx);
    r.events.push(...r.sim.drainEvents());
  }
}

/** Pull him and let Break Free play out (the whole cinematic: he lands on
 *  the arena centre and his fight begins). */
function pullOut(r: Room): KorzulFightState {
  run(r, KORZUL_EMERGE_SECONDS + 0.1);
  return st(r);
}

function st(r: Room): KorzulFightState {
  const s = r.boss.sanctumFight;
  if (s?.kind !== 'korzul') throw new Error('no Korzul state');
  return s;
}

function plateTemplates(r: Room): string[] {
  return st(r).plates.map((p) => r.sim.ctx.entities.get(p.objectId)?.templateId ?? '?');
}

function damageTo(r: Room, e: Entity, ability: string): number[] {
  return r.events
    .filter(
      (ev) =>
        ev.type === 'damage' &&
        (ev as { targetId: number }).targetId === e.id &&
        (ev as { ability?: string }).ability === ability,
    )
    .map((ev) => (ev as { amount: number }).amount);
}

function dev(r: Room, what: string): string | null {
  return korzulDevTrigger(r.sim.ctx, r.inst, r.boss, what);
}

/** Park his timers so only what a test triggers fires. */
function quiet(s: KorzulFightState): void {
  s.breathTimer = 999;
  s.tailTimer = 999;
  s.infernoTimer = 999;
  s.galeTimer = 999;
}

describe('Korzul: the plate floor (G25)', () => {
  it('lays nineteen Sound plates on the lake before the pull, one per LAKE_PLATES centre', () => {
    const r = room();
    // On the shore side of the pull's trigger: nothing stirs yet.
    put(r, r.me, 0, WYRMS_HOLLOW.z - KORZUL_WAKE_RADIUS - 6);
    run(r, DT, false);
    const s = korzulState(r.sim.ctx, r.inst, r.boss);
    expect(s.phase).toBe('idle');
    expect(s.plates).toHaveLength(19);
    s.plates.forEach((p, i) => {
      const obj = r.sim.ctx.entities.get(p.objectId) as Entity;
      expect(obj.templateId).toBe('sanctum_plate_sound');
      expect(obj.pos.x - r.ox).toBeCloseTo(LAKE_PLATES[i].x, 5);
      expect(obj.pos.z - r.oz).toBeCloseTo(LAKE_PLATES[i].z, 5);
      expect(obj.scale).toBe(LAKE_PLATES[i].r);
      expect(r.inst.objectIds).toContain(p.objectId);
    });
  });

  it('a lake point belongs to the nearest plate; the shelf to none', () => {
    for (let i = 0; i < LAKE_PLATES.length; i++)
      expect(plateIndexAt(LAKE_PLATES[i].x, LAKE_PLATES[i].z)).toBe(i);
    expect(plateIndexAt(WYRMS_HOLLOW.x, WYRMS_HOLLOW.z + WYRMS_HOLLOW.lakeR + 2)).toBeNull();
    expect(nearestPlate(WYRMS_HOLLOW.x, WYRMS_HOLLOW.z + WYRMS_HOLLOW.lakeR + 2)).toBe(
      plateIndexAt(WYRMS_HOLLOW.x, WYRMS_HOLLOW.z + WYRMS_HOLLOW.lakeR - 1),
    );
  });

  it('fire cracks a Sound plate, breaks a Cracked one, and a Cracked plate refreezes after 30 s', () => {
    const r = room();
    const s = pullOut(r);
    quiet(s);
    dev(r, 'crack 3');
    expect(plateTemplates(r)[3]).toBe('sanctum_plate_cracked_10');
    run(r, 15);
    expect(plateOf(plateTemplates(r)[3])).toEqual({ state: 'cracked', refreeze: 0.5 });
    run(r, 15.1);
    expect(plateTemplates(r)[3]).toBe('sanctum_plate_sound');
    dev(r, 'crack 4');
    dev(r, 'crack 4');
    expect(plateTemplates(r)[4]).toBe('sanctum_plate_broken');
    run(r, 40);
    expect(plateTemplates(r)[4]).toBe('sanctum_plate_broken');
  });

  it('heroic Deep Quench: a Cracked plate never refreezes', () => {
    const r = room('heroic');
    const s = pullOut(r);
    quiet(s);
    dev(r, 'crack 3');
    expect(plateTemplates(r)[3]).toBe('sanctum_plate_cracked_deep');
    run(r, 45);
    expect(plateTemplates(r)[3]).toBe('sanctum_plate_cracked_deep');
  });

  it('quench-water slows and burns 60 a second on normal, 150 on heroic', () => {
    for (const [difficulty, per] of [
      ['normal', 60],
      ['heroic', 150],
    ] as const) {
      const r = room(difficulty);
      const s = pullOut(r);
      quiet(s);
      dev(r, 'break 12');
      const swimmer = addPlayer(r, `Swim${difficulty}`, LAKE_PLATES[12].x, LAKE_PLATES[12].z);
      const dry = addPlayer(r, `Dry${difficulty}`, LAKE_PLATES[0].x, LAKE_PLATES[0].z);
      r.events = [];
      run(r, 3);
      const hits = damageTo(r, swimmer, 'Quench-Water');
      expect(hits).toHaveLength(3);
      for (const h of hits) expect(h).toBe(per);
      expect(swimmer.auras.some((a) => a.id === SANCTUM_QUENCH_WATER && a.value === 0.5)).toBe(
        true,
      );
      expect(damageTo(r, dry, 'Quench-Water')).toHaveLength(0);
    }
  });
});

describe('Korzul: the ground kit', () => {
  it('Grave Breath: a 2 s bar along the tank, then the cone burns everyone but the tank and the plates it covers', () => {
    const r = room();
    const s = pullOut(r);
    quiet(s);
    const bx = r.boss.pos.x - r.ox;
    const bz = r.boss.pos.z - r.oz;
    // The tank south of him; a mage behind the tank, in the cone; another off to the side.
    put(r, r.me, bx, bz - 6);
    const inCone = addPlayer(r, 'Cone', bx + 1, bz - 18);
    const aside = addPlayer(r, 'Aside', bx + 20, bz);
    expect(dev(r, 'breath')).toBe('Grave Breath.');
    expect(r.boss.castingAbility).toBe(KORZUL_GRAVE_BREATH);
    expect(r.boss.castTargetId).toBe(r.me.id);
    const expected = conePlates(
      bx,
      bz,
      Math.PI,
      T.breathRange + 5,
      T.breathArcDeg,
      T.breathPlates,
      s.plates.map((p) => p.state),
      plateIndexAt(bx, bz),
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThanOrEqual(3);
    r.events = [];
    run(r, T.breathCast + DT);
    const hit = damageTo(r, inCone, 'Grave Breath');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toBeGreaterThanOrEqual(T.breathMin);
    expect(hit[0]).toBeLessThanOrEqual(T.breathMax);
    expect(damageTo(r, r.me, 'Grave Breath')).toHaveLength(0);
    expect(damageTo(r, aside, 'Grave Breath')).toHaveLength(0);
    const states = s.plates.map((p) => p.state);
    for (const i of expected) expect(states[i]).toBe('cracked');
    expect(states.filter((x) => x !== 'sound')).toHaveLength(expected.length);
    // His own plate never burns under his breath.
    expect(states[plateIndexAt(bx, bz) as number]).toBe('sound');
  });

  it('Tail Sweep: his rear cone strikes and throws whoever stands behind him', () => {
    const r = room();
    const s = pullOut(r);
    quiet(s);
    r.boss.facing = Math.PI;
    const behind = addPlayer(r, 'Behind', r.boss.pos.x - r.ox, r.boss.pos.z - r.oz + 8);
    const z0 = behind.pos.z;
    expect(dev(r, 'tail')).toBe('Tail Sweep.');
    r.events = [];
    run(r, T.tailCast + DT);
    const hit = damageTo(r, behind, 'Tail Sweep');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toBeGreaterThanOrEqual(T.tailMin);
    expect(hit[0]).toBeLessThanOrEqual(T.tailMax);
    expect(behind.pos.z).toBeGreaterThan(z0 + 3);
    expect(damageTo(r, r.me, 'Tail Sweep')).toHaveLength(0);
  });

  it('Grave Inferno on Sound ice: four escalating pulses; pulse 2 cracks his plate, pulse 4 breaks it', () => {
    const r = room();
    const s = pullOut(r);
    quiet(s);
    const under = plateIndexAt(r.boss.pos.x - r.ox, r.boss.pos.z - r.oz) as number;
    const near = addPlayer(r, 'Near', r.boss.pos.x - r.ox + 6, r.boss.pos.z - r.oz);
    expect(dev(r, 'inferno')).toBe('Grave Inferno.');
    expect(r.boss.castingAbility).toBe(KORZUL_GRAVE_INFERNO);
    r.events = [];
    run(r, 4.05);
    expect(s.plates[under].state).toBe('cracked');
    run(r, 4.05);
    const hits = damageTo(r, near, 'Grave Inferno');
    expect(hits).toHaveLength(4);
    hits.forEach((h, k) => {
      expect(h).toBeGreaterThanOrEqual(T.infernoMin * (k + 1));
      expect(h).toBeLessThanOrEqual(T.infernoMax * (k + 1));
    });
    expect(s.plates[under].state).toBe('broken');
    expect(r.boss.auras.some((a) => a.id === KORZUL_DOUSED)).toBe(true);
  });

  it('Doused: on a plate that was already cracked the Inferno breaks it at pulse 2 and ends at half', () => {
    const r = room();
    const s = pullOut(r);
    quiet(s);
    const under = plateIndexAt(r.boss.pos.x - r.ox, r.boss.pos.z - r.oz) as number;
    dev(r, `crack ${under}`);
    const near = addPlayer(r, 'Near', r.boss.pos.x - r.ox + 6, r.boss.pos.z - r.oz);
    dev(r, 'inferno');
    r.events = [];
    run(r, 8.1);
    expect(damageTo(r, near, 'Grave Inferno')).toHaveLength(2);
    expect(s.plates[under].state).toBe('broken');
    expect(r.boss.castingAbility).not.toBe(KORZUL_GRAVE_INFERNO);
    expect(
      r.events.some(
        (e) => e.type === 'spellfx' && (e as { ability?: string }).ability === KORZUL_DOUSED,
      ),
    ).toBe(true);
  });

  it('Grave Inferno: the 14 yd edge is exact (13.5 yd eats every pulse, 14.5 yd none)', () => {
    const r = room();
    const s = pullOut(r);
    quiet(s);
    const bx = r.boss.pos.x - r.ox;
    const bz = r.boss.pos.z - r.oz;
    const inside = addPlayer(r, 'Inside', bx + 13.5, bz);
    const outside = addPlayer(r, 'Outside', bx - 14.5, bz);
    dev(r, 'inferno');
    r.events = [];
    run(r, 8.1);
    expect(damageTo(r, inside, 'Grave Inferno')).toHaveLength(4);
    expect(damageTo(r, outside, 'Grave Inferno')).toHaveLength(0);
  });

  it('Grave Inferno keeps its 30 s cadence from a first channel at 20 s', () => {
    const r = room();
    const s = pullOut(r);
    s.breathTimer = 999;
    s.tailTimer = 999;
    const starts: number[] = [];
    for (let i = 0; i < 20 * 55; i++) {
      const before = r.boss.castingAbility;
      run(r, DT);
      if (r.boss.castingAbility === KORZUL_GRAVE_INFERNO && before !== KORZUL_GRAVE_INFERNO)
        starts.push(i);
    }
    expect(starts).toHaveLength(2);
    expect(starts[0] * DT).toBeCloseTo(T.infernoFirst, 0);
    expect((starts[1] - starts[0]) * DT).toBeCloseTo(T.infernoEvery, 0);
  });

  it('fires the Inferno once at half health even off its cadence', () => {
    const r = room();
    const s = pullOut(r);
    quiet(s);
    s.flights = 1; // past the 70 percent flight
    r.boss.hp = Math.floor(r.boss.maxHp * 0.49);
    run(r, DT * 2);
    expect(r.boss.castingAbility).toBe(KORZUL_GRAVE_INFERNO);
    expect(s.infernoGates).toBe(1);
  });
});

describe('Korzul: the flights (G26)', () => {
  function flightRoom(difficulty: 'normal' | 'heroic' = 'normal') {
    const r = room(difficulty);
    const s = pullOut(r);
    quiet(s);
    const bx = r.boss.pos.x - r.ox;
    const bz = r.boss.pos.z - r.oz;
    // Three players spread on three plates.
    const a = addPlayer(r, 'Ash', LAKE_PLATES[0].x, LAKE_PLATES[0].z);
    const b = addPlayer(r, 'Birch', LAKE_PLATES[3].x, LAKE_PLATES[3].z);
    const c = addPlayer(r, 'Cedar', LAKE_PLATES[5].x, LAKE_PLATES[5].z);
    put(r, r.me, bx, bz - 6);
    return { r, s, a, b, c };
  }

  it('at 70 percent: Wing Gale, then out of reach on the wing, two eyes, their plates burn, then he lands', () => {
    const { r, s, a, b, c } = flightRoom();
    dev(r, 'break 9');
    dev(r, 'break 10');
    r.boss.hp = Math.floor(r.boss.maxHp * 0.69);
    r.events = [];
    run(r, DT * 2);
    expect(s.phase).toBe('gale');
    run(r, T.galeCast + 1);
    // The climb: airborne, immune, nobody's target, the brood out of the water.
    expect(r.boss.auras.some((a2) => a2.id === KORZUL_AIRBORNE)).toBe(true);
    expect(r.boss.damageImmune).toBe(true);
    expect(r.boss.hostile).toBe(false);
    const brood = r.inst.mobIds
      .map((id) => r.sim.ctx.entities.get(id))
      .filter((e) => e?.templateId === SCALEGUARD_ID && e.summonedAdd);
    expect(brood).toHaveLength(2);
    expect(s.broodIds).toHaveLength(2);
    run(r, 2);
    expect(s.phase).toBe('air');
    const floor = r.sim.ctx.groundPos(r.boss.pos.x, r.boss.pos.z).y;
    expect(r.boss.pos.y - floor).toBeGreaterThan(T.flightAltitude - 0.5);
    // A hit on him in the air lands nothing.
    const hp = r.boss.hp;
    r.sim.ctx.dealDamage(r.me, r.boss, 500, false, 'physical', 'Test', 'hit', true);
    expect(r.boss.hp).toBe(hp);
    // The eye: a non-tank, marked for 4 s.
    run(r, 0.6);
    const marked = [a, b, c].filter((p) => p.auras.some((x) => x.id === KORZUL_WYRMS_EYE));
    expect(marked).toHaveLength(1);
    expect(r.me.auras.some((x) => x.id === KORZUL_WYRMS_EYE)).toBe(false);
    const victimPlate = plateIndexAt(marked[0].pos.x - r.ox, marked[0].pos.z - r.oz) as number;
    run(r, T.eyeSeconds);
    expect(r.boss.castingAbility).toBe(KORZUL_PLUNGING_FIRE);
    const fire = r.sim.ctx.entities.get(r.boss.castTargetId as number) as Entity;
    expect(fire.templateId).toBe(SANCTUM_PLUNGING_FIRE);
    expect(fire.scale).toBe(LAKE_PLATES[victimPlate].r);
    r.events = [];
    run(r, T.plungeWarn + DT);
    const burn = damageTo(r, marked[0], 'Plunging Fire');
    expect(burn).toHaveLength(1);
    expect(burn[0]).toBeGreaterThanOrEqual(T.plungeMin);
    expect(burn[0]).toBeLessThanOrEqual(T.plungeMax);
    expect(s.plates[victimPlate].state).toBe('cracked');
    expect(r.sim.ctx.entities.has(fire.id)).toBe(false);
    // The second eye (marked while the first plate burned) went to someone else.
    const second = [a, b, c].filter((p) => p.auras.some((x) => x.id === KORZUL_WYRMS_EYE));
    expect(second).toHaveLength(1);
    expect(second[0].id).not.toBe(marked[0].id);
    // The descent: the shadow on the most crowded unbroken plate, then the landing.
    put(r, a, LAKE_PLATES[2].x, LAKE_PLATES[2].z);
    put(r, b, LAKE_PLATES[2].x + 1, LAKE_PLATES[2].z);
    put(r, c, LAKE_PLATES[2].x, LAKE_PLATES[2].z + 1);
    let shadow: Entity | undefined;
    for (let i = 0; i < 20 * 12 && !shadow; i++) {
      run(r, DT);
      if (r.boss.castingAbility === KORZUL_CRASHING_DESCENT)
        shadow = r.sim.ctx.entities.get(r.boss.castTargetId as number);
    }
    expect(shadow?.templateId).toBe(SANCTUM_LANDING_SHADOW);
    expect(shadow?.scale).toBe(T.descentRadius);
    expect(plateIndexAt((shadow as Entity).pos.x - r.ox, (shadow as Entity).pos.z - r.oz)).toBe(2);
    r.events = [];
    // He holds his height while the shadow grows, then dives through the
    // bar's second half (no snap from full height at the end).
    const floorY = () => r.sim.ctx.groundPos(r.boss.pos.x, r.boss.pos.z).y;
    run(r, T.descentWarn * 0.4);
    expect(r.boss.pos.y - floorY()).toBeGreaterThan(T.flightAltitude - 0.01);
    run(r, T.descentWarn * 0.45);
    const late = r.boss.pos.y - floorY();
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(T.flightAltitude * 0.2);
    run(r, T.descentWarn * 0.15 + DT);
    expect(s.phase).toBe('ground');
    expect(s.flights).toBe(1);
    expect(r.boss.damageImmune).toBe(false);
    expect(r.boss.hostile).toBe(true);
    expect(r.boss.auras.some((x) => x.id === KORZUL_AIRBORNE)).toBe(false);
    expect(r.boss.pos.y - r.sim.ctx.groundPos(r.boss.pos.x, r.boss.pos.z).y).toBeLessThan(0.01);
    const landed = damageTo(r, a, 'Crashing Descent');
    expect(landed).toHaveLength(1);
    expect(landed[0]).toBeGreaterThanOrEqual(T.descentMin);
    // The second eye's carrier stood on plate 2 when the eye closed (its fire
    // cracked it), so the landing on the same plate broke it: burn twice.
    expect(s.plates[2].state).toBe('broken');
  });

  it('at 40 percent: three eyes, then the last phase (the shard flares, breath every 12 s)', () => {
    const { r, s, a, b, c } = flightRoom();
    s.flights = 1;
    r.boss.hp = Math.floor(r.boss.maxHp * 0.39);
    s.infernoGates = 1;
    let eyes = 0;
    run(r, DT);
    for (let i = 0; i < 20 * 40 && s.phase !== 'ground'; i++) {
      const before = [a, b, c].filter((p) => p.auras.some((x) => x.id === KORZUL_WYRMS_EYE));
      run(r, DT);
      const after = [a, b, c].filter((p) => p.auras.some((x) => x.id === KORZUL_WYRMS_EYE));
      if (after.length > before.length) eyes++;
    }
    expect(eyes).toBe(3);
    expect(s.flights).toBe(2);
    expect(s.lastPhase).toBe(true);
    expect(r.boss.auras.some((x) => x.id === KORZUL_SHARD_FLARE)).toBe(true);
    s.breathTimer = 0;
    run(r, DT * 2);
    expect(r.boss.castingAbility).toBe(KORZUL_GRAVE_BREATH);
    expect(s.breathTimer).toBeCloseTo(T.breathEveryLast - DT, 1);
  });

  it('Twin Eyes: two marks at once on heroic, one on normal', () => {
    for (const [difficulty, n] of [
      ['normal', 1],
      ['heroic', 2],
    ] as const) {
      const { r, a, b, c } = flightRoom(difficulty);
      dev(r, 'flight');
      run(r, T.galeCast + 2 + 1.2);
      const marked = [a, b, c].filter((p) => p.auras.some((x) => x.id === KORZUL_WYRMS_EYE));
      expect(marked).toHaveLength(n);
    }
  });

  it('no ice left: he hovers over the open water and breathes without pause', () => {
    const r = room();
    const s = pullOut(r);
    quiet(s);
    for (let i = 0; i < LAKE_PLATES.length; i++) dev(r, `break ${i}`);
    run(r, DT * 2);
    expect(s.phase).toBe('drown');
    run(r, 8);
    const breaths = r.events.filter(
      (e) => e.type === 'spellfx' && (e as { ability?: string }).ability === KORZUL_GRAVE_BREATH,
    );
    expect(breaths.length).toBeGreaterThanOrEqual(2);
    expect(r.boss.damageImmune).toBe(false);
  });
});

describe('Korzul: the wipe, the kill, the deed', () => {
  it('a wipe in the air resets the lake to Sound, sends the brood away and brings him down', () => {
    const r = room();
    const s = pullOut(r);
    quiet(s);
    dev(r, 'break 9');
    dev(r, 'crack 4');
    dev(r, 'flight');
    run(r, T.galeCast + 2.5);
    expect(s.phase).toBe('air');
    expect(s.broodIds).toHaveLength(1);
    const broodId = s.broodIds[0];
    // The wipe: he loses his fight.
    r.boss.inCombat = false;
    r.boss.aggroTargetId = null;
    r.boss.aiState = 'evade';
    run(r, DT, false);
    expect(s.phase).toBe('idle');
    expect(plateTemplates(r).every((t) => t === 'sanctum_plate_sound')).toBe(true);
    expect(r.sim.ctx.entities.has(broodId)).toBe(false);
    expect(r.boss.damageImmune).toBe(false);
    expect(r.boss.auras.some((x) => x.id === KORZUL_AIRBORNE)).toBe(false);
    expect(r.boss.pos.y - r.sim.ctx.groundPos(r.boss.pos.x, r.boss.pos.z).y).toBeLessThan(0.01);
  });

  it('Thin Ice: at least twelve of the nineteen plates unbroken', () => {
    const sound = new Array(19).fill('sound') as ('sound' | 'cracked' | 'broken')[];
    expect(thinIceEarned(sound)).toBe(true);
    const seven = sound.map((x, i) => (i < 7 ? 'broken' : x));
    expect(thinIceEarned(seven)).toBe(true);
    const eight = sound.map((x, i) => (i < 8 ? 'broken' : x));
    expect(thinIceEarned(eight)).toBe(false);
    const cracked = sound.map((x, i) => (i < 12 ? 'cracked' : x));
    expect(thinIceEarned(cracked)).toBe(true);
  });

  it('his death breaks the plate under him and grants Thin Ice to a careful group', () => {
    const r = room();
    const s = pullOut(r);
    quiet(s);
    const under = plateIndexAt(r.boss.pos.x - r.ox, r.boss.pos.z - r.oz) as number;
    r.boss.hp = 0;
    r.boss.dead = true;
    run(r, DT, false);
    expect(s.phase).toBe('slain');
    expect(s.plates[under].state).toBe('broken');
    const meta = r.sim.ctx.players.get(r.me.id);
    if (DEEDS[SANCTUM_DEED_IDS.korzulThinIce])
      expect(meta?.deedsEarned.has(SANCTUM_DEED_IDS.korzulThinIce)).toBe(true);
  });

  it('the Inferno and enrage live off the template now; the template keeps the kept enrage', () => {
    expect(MOBS.korzul_the_gravewyrm.infernoChannel).toBeUndefined();
    expect(MOBS.korzul_the_gravewyrm.enrage?.belowHpPct).toBe(T.enrageAtHpPct);
  });
});

describe('Korzul: the real tick (the mob AI running)', () => {
  it('holds his fight through both flights and lands back in it, never evading', () => {
    const r = room();
    put(r, r.me, r.boss.pos.x - r.ox, r.boss.pos.z - r.oz - 6);
    r.sim.ctx.aggroMob(r.boss, r.me, false);
    const tick = (seconds: number): void => {
      for (let t = 0; t < seconds - DT * 0.5; t += DT) {
        // The tank never falls (his real swings run here).
        r.me.damageImmune = true;
        r.me.hp = r.me.maxHp;
        r.sim.tick();
      }
    };
    tick(KORZUL_EMERGE_SECONDS + 1);
    const s = st(r);
    expect(s.phase).toBe('ground');
    r.boss.hp = Math.floor(r.boss.maxHp * 0.69);
    tick(3);
    expect(['gale', 'takeoff', 'air']).toContain(s.phase);
    tick(4);
    expect(s.phase).toBe('air');
    expect(r.boss.hostile).toBe(false);
    expect(r.boss.inCombat).toBe(true);
    tick(22);
    expect(s.phase).toBe('ground');
    expect(s.flights).toBe(1);
    expect(r.boss.hostile).toBe(true);
    expect(r.boss.aiState).not.toBe('evade');
    r.boss.hp = Math.floor(r.boss.maxHp * 0.39);
    s.infernoGates = 1;
    tick(30);
    expect(s.flights).toBe(2);
    expect(s.lastPhase).toBe(true);
    expect(r.boss.aiState).not.toBe('evade');
  }, 180_000);

  it('/dev sanctum trigger reaches an engaged Korzul', () => {
    const r = room();
    const s = pullOut(r);
    quiet(s);
    r.sim.chat('/dev sanctum trigger crack5', r.me.id);
    expect(s.plates[5].state).toBe('cracked');
    r.sim.chat('/dev sanctum trigger breath', r.me.id);
    expect(r.boss.castingAbility).toBe(KORZUL_GRAVE_BREATH);
  });
});

describe('Korzul: determinism', () => {
  it('two runs on one seed fly, mark and burn the same', () => {
    const trace = (): string => {
      const { r, s } = (() => {
        const r0 = room('heroic', 7);
        const s0 = pullOut(r0);
        addPlayer(r0, 'Ash', LAKE_PLATES[0].x, LAKE_PLATES[0].z);
        addPlayer(r0, 'Birch', LAKE_PLATES[3].x, LAKE_PLATES[3].z);
        addPlayer(r0, 'Cedar', LAKE_PLATES[5].x, LAKE_PLATES[5].z);
        return { r: r0, s: s0 };
      })();
      run(r, 20);
      r.boss.hp = Math.floor(r.boss.maxHp * 0.69);
      run(r, 30);
      return JSON.stringify({
        plates: s.plates.map((p) => p.state),
        flights: s.flights,
        events: r.events
          .filter((e) => e.type === 'damage' || e.type === 'spellfx')
          .map((e) => JSON.stringify(e)),
      });
    };
    expect(trace()).toBe(trace());
  });
});

describe('Korzul: Break Free, the cinematic of his pull', () => {
  const MECHANIC_FX = new Set([
    KORZUL_GRAVE_BREATH,
    KORZUL_GRAVE_INFERNO,
    KORZUL_PLUNGING_FIRE,
    KORZUL_CRASHING_DESCENT,
    KORZUL_DOUSED,
    KORZUL_SHARD_FLARE,
    'sanctum_korzul_tail_sweep',
    'sanctum_korzul_wing_gale',
    'sanctum_korzul_brood_from_below',
  ]);
  const TOUCHDOWN = 'sanctum_korzul_touchdown';
  const local = (r: Room) => ({ x: r.boss.pos.x - r.ox, z: r.boss.pos.z - r.oz });
  const floorAt = (r: Room) => r.sim.ctx.groundPos(r.boss.pos.x, r.boss.pos.z).y;
  /** The real tick (the mob AI and every system running); nobody dies. */
  const realTick = (r: Room, ticks: number, each?: () => void): void => {
    for (let i = 0; i < ticks; i++) {
      for (const meta of r.sim.ctx.players.values()) {
        const p = r.sim.ctx.entities.get(meta.entityId);
        if (p) p.hp = p.maxHp;
      }
      r.events.push(...r.sim.tick());
      each?.();
      r.events.push(...r.sim.drainEvents());
    }
  };

  it('the timeline: burst, rise, arc, land in order, 7 to 10 s, the climb the flights climb', () => {
    expect(KORZUL_EMERGE.burst).toBe(3);
    expect(KORZUL_EMERGE.rise).toBe(KORZUL_TAKEOFF_SECONDS);
    expect(0).toBeLessThan(KORZUL_EMERGE_RISE_AT);
    expect(KORZUL_EMERGE_RISE_AT).toBeLessThan(KORZUL_EMERGE_ARC_AT);
    expect(KORZUL_EMERGE_ARC_AT).toBeLessThan(KORZUL_EMERGE_LAND_AT);
    expect(KORZUL_EMERGE_LAND_AT).toBeLessThan(KORZUL_EMERGE_SECONDS);
    expect(KORZUL_EMERGE_SECONDS).toBeGreaterThanOrEqual(7);
    expect(KORZUL_EMERGE_SECONDS).toBeLessThanOrEqual(10);
    expect(emergeBeat(0)).toBe('burst');
    expect(emergeBeat(KORZUL_EMERGE_RISE_AT)).toBe('rise');
    expect(emergeBeat(KORZUL_EMERGE_ARC_AT)).toBe('arc');
    expect(emergeBeat(KORZUL_EMERGE_LAND_AT)).toBe('land');
    expect(emergeBeat(KORZUL_EMERGE_SECONDS)).toBe('done');
  });

  it('the path: from the face foot, up, over the lake to the arena centre, and down, never a jump', () => {
    // The start is walkable floor on the north shelf, north of the lake; the
    // end is the middle plate.
    const dFace = Math.hypot(
      KORZUL_EMERGE_FROM.x - WYRMS_HOLLOW.x,
      KORZUL_EMERGE_FROM.z - WYRMS_HOLLOW.z,
    );
    expect(dFace).toBeGreaterThan(WYRMS_HOLLOW.lakeR);
    expect(dFace).toBeLessThan(WYRMS_HOLLOW.shelfR);
    expect(KORZUL_EMERGE_TO).toEqual({ x: LAKE_PLATES[0].x, z: LAKE_PLATES[0].z });
    expect(emergeFacing(KORZUL_EMERGE_FROM)).toBeCloseTo(Math.PI, 6);
    const from = KORZUL_EMERGE_FROM;
    const to = KORZUL_EMERGE_TO;
    const len = Math.hypot(to.x - from.x, to.z - from.z);
    let prev = emergePose(0, from);
    let progress = 0;
    let peak = 0;
    expect(prev).toMatchObject({ x: from.x, z: from.z, h: 0 });
    for (let t = DT; t <= KORZUL_EMERGE_SECONDS + 1e-9; t += DT) {
      const p = emergePose(t, from);
      // On the straight line from the face to the centre, never back.
      const along = ((p.x - from.x) * (to.x - from.x) + (p.z - from.z) * (to.z - from.z)) / len;
      const off = Math.abs((p.x - from.x) * (to.z - from.z) - (p.z - from.z) * (to.x - from.x));
      expect(off / len).toBeLessThan(1e-9);
      expect(along).toBeGreaterThanOrEqual(progress - 1e-9);
      progress = along;
      // Never under the floor, and no step bigger than a fast wingbeat.
      expect(p.h).toBeGreaterThanOrEqual(0);
      expect(Math.hypot(p.x - prev.x, p.z - prev.z, p.h - prev.h)).toBeLessThan(1.6);
      peak = Math.max(peak, p.h);
      prev = p;
    }
    expect(progress).toBeCloseTo(len, 6);
    expect(peak).toBeGreaterThan(KORZUL_EMERGE_ALTITUDE);
    expect(emergePose(KORZUL_EMERGE_ARC_AT, from).h).toBeCloseTo(KORZUL_EMERGE_ALTITUDE, 6);
    expect(emergePose(KORZUL_EMERGE_LAND_AT, from)).toMatchObject({ x: to.x, z: to.z });
    expect(emergePose(KORZUL_EMERGE_SECONDS, from)).toMatchObject({ x: to.x, z: to.z, h: 0 });
    // The burst holds him at the face; the landing falls faster as it ends.
    expect(emergePose(KORZUL_EMERGE.burst - DT, from)).toMatchObject({ x: from.x, z: from.z });
    const h1 = emergePose(KORZUL_EMERGE_LAND_AT + 0.2, from).h;
    const h2 = emergePose(KORZUL_EMERGE_LAND_AT + 0.4, from).h;
    const h3 = emergePose(KORZUL_EMERGE_LAND_AT + 0.6, from).h;
    expect(h2 - h3).toBeGreaterThan(h1 - h2);
  });

  it('the face still whole: he tears out at its foot behind the bar, flies the arc and lands on the centre', () => {
    const r = room();
    run(r, DT);
    const s = st(r);
    expect(s.phase).toBe('emerge');
    expect(r.boss.castingAbility).toBe(KORZUL_BREAK_FREE);
    expect(r.boss.castTotal).toBe(KORZUL_EMERGE.burst);
    expect(local(r).x).toBeCloseTo(KORZUL_EMERGE_FROM.x, 6);
    expect(local(r).z).toBeCloseTo(KORZUL_EMERGE_FROM.z, 6);
    expect(r.boss.pos.y - floorAt(r)).toBeCloseTo(0, 6);
    // No streak across the lake from where he lay hidden.
    expect(r.boss.prevPos).toEqual(r.boss.pos);
    expect(r.boss.facing).toBeCloseTo(Math.PI, 6);
    expect(
      r.events.some((e) => e.type === 'log' && (e as { text: string }).text.includes('Calving')),
    ).toBe(true);
    // The bar ends, he climbs, then flies over the lake.
    run(r, KORZUL_EMERGE.burst + KORZUL_EMERGE.rise * 0.5);
    expect(r.boss.castingAbility).toBeNull();
    expect(local(r).z).toBeCloseTo(KORZUL_EMERGE_FROM.z, 6);
    expect(r.boss.pos.y - floorAt(r)).toBeGreaterThan(1);
    run(r, KORZUL_EMERGE.rise * 0.5 + KORZUL_EMERGE.arc * 0.5);
    const mid = local(r);
    expect(mid.z).toBeLessThan(KORZUL_EMERGE_FROM.z - 5);
    expect(mid.z).toBeGreaterThan(KORZUL_EMERGE_TO.z + 5);
    expect(r.boss.pos.y - floorAt(r)).toBeGreaterThan(KORZUL_EMERGE_ALTITUDE);
    expect(s.phase).toBe('emerge');
    run(r, KORZUL_EMERGE_SECONDS - (KORZUL_EMERGE_ARC_AT + KORZUL_EMERGE.arc * 0.5) + DT);
    expect(s.phase).toBe('ground');
    expect(local(r).x).toBeCloseTo(KORZUL_EMERGE_TO.x, 6);
    expect(local(r).z).toBeCloseTo(KORZUL_EMERGE_TO.z, 6);
    expect(r.boss.pos.y - floorAt(r)).toBeCloseTo(0, 6);
    expect(
      r.events.some(
        (e) => e.type === 'spellfx' && (e as { ability?: string }).ability === TOUCHDOWN,
      ),
    ).toBe(true);
  });

  it('cannot be engaged before the landing ends: no damage either way, no strike, no burn, no swing, not attackable', () => {
    const r = room();
    // The route cleared (no pack answers the pull), one quiet tick off the
    // lake so the plates lie, then a broken plate with a swimmer in it (the
    // quench-water is his, so it waits for him too).
    for (const what of ['trash', 'korgath', 'velkhar'])
      r.sim.chat(`/dev sanctum kill ${what}`, r.me.id);
    put(r, r.me, 0, 120);
    realTick(r, 1);
    const s = korzulState(r.sim.ctx, r.inst, r.boss);
    expect(s.phase).toBe('idle');
    burnLakePlate(r.sim.ctx, r.inst, s, 12);
    burnLakePlate(r.sim.ctx, r.inst, s, 12);
    const before = s.plates.map((p) => p.state);
    const swimmer = addPlayer(r, 'Swim', LAKE_PLATES[12].x, LAKE_PLATES[12].z);
    // The tank waits at the face's foot, in his reach the moment he is out.
    put(r, r.me, KORZUL_EMERGE_FROM.x, KORZUL_EMERGE_FROM.z - 6);
    r.me.targetId = r.boss.id;
    r.events = [];
    let ticks = 0;
    let damageTried = 0;
    realTick(r, Math.round(KORZUL_EMERGE_SECONDS / DT) + 40, () => {
      if (s.phase !== 'emerge') return;
      ticks++;
      expect(r.boss.inCombat).toBe(true);
      expect(r.boss.damageImmune).toBe(true);
      expect(r.boss.hostile).toBe(false);
      expect(r.sim.isHostileTo(r.me, r.boss)).toBe(false);
      expect([null, KORZUL_BREAK_FREE]).toContain(r.boss.castingAbility);
      expect(r.boss.swingTimer).toBeGreaterThan(0);
      // A hit straight at him lands nothing.
      r.sim.ctx.dealDamage(r.me, r.boss, 500, false, 'physical', 'Test', 'hit', true);
      damageTried++;
      expect(r.boss.hp).toBe(r.boss.maxHp);
      r.sim.startAutoAttack(r.me.id);
      expect(s.plates.map((p) => p.state)).toEqual(before);
      expect(s.breathTimer).toBe(T.breathFirst);
      expect(s.tailTimer).toBe(T.tailFirst);
      expect(s.infernoTimer).toBe(T.infernoFirst);
    });
    // The whole cinematic ran under the gate, then the fight began.
    expect(damageTried).toBeGreaterThan(0);
    expect(Math.abs(ticks - Math.round(KORZUL_EMERGE_SECONDS / DT))).toBeLessThanOrEqual(1);
    const landing = r.events.findIndex(
      (e) => e.type === 'spellfx' && (e as { ability?: string }).ability === TOUCHDOWN,
    );
    expect(landing).toBeGreaterThan(0);
    for (const e of r.events.slice(0, landing)) {
      if (e.type === 'damage') {
        const d = e as { sourceId: number; targetId: number; amount: number };
        expect(d.sourceId).not.toBe(r.boss.id);
        if (d.targetId === r.boss.id) expect(d.amount).toBe(0);
      }
      if (e.type === 'spellfx')
        expect(MECHANIC_FX.has((e as { ability?: string }).ability ?? '')).toBe(false);
    }
    const beforeLanding: Room = { ...r, events: r.events.slice(0, landing) };
    expect(damageTo(beforeLanding, swimmer, 'Quench-Water')).toHaveLength(0);
    expect(
      beforeLanding.events.some((e) => e.type === 'damage' && (e as { amount: number }).amount > 0),
    ).toBe(false);
    // Landed: in reach, and the quench-water bites from now on.
    expect(s.phase).toBe('ground');
    expect(r.boss.damageImmune).toBe(false);
    expect(r.boss.hostile).toBe(true);
    expect(r.sim.isHostileTo(r.me, r.boss)).toBe(true);
    const hp = r.boss.hp;
    r.sim.ctx.dealDamage(r.me, r.boss, 500, false, 'physical', 'Test', 'hit', true);
    expect(r.boss.hp).toBeLessThan(hp);
    expect(damageTo(r, swimmer, 'Quench-Water').length).toBeGreaterThan(0);
  }, 60_000);

  it("the fight's mechanics clock starts at the touchdown", () => {
    const r = room();
    put(r, r.me, KORZUL_EMERGE_TO.x, KORZUL_EMERGE_TO.z - 14);
    r.sim.ctx.aggroMob(r.boss, r.me, false);
    let landedAt = -1;
    let breathAt = -1;
    let tick = 0;
    realTick(r, Math.round((KORZUL_EMERGE_SECONDS + T.breathFirst + 2) / DT), () => {
      tick++;
      r.me.damageImmune = true;
      if (landedAt < 0 && st(r).phase === 'ground') landedAt = tick;
      if (breathAt < 0 && r.boss.castingAbility === KORZUL_GRAVE_BREATH) breathAt = tick;
    });
    expect(landedAt * DT).toBeCloseTo(KORZUL_EMERGE_SECONDS, 0);
    expect(breathAt).toBeGreaterThan(landedAt);
    expect((breathAt - landedAt) * DT).toBeCloseTo(T.breathFirst, 0);
  }, 60_000);

  it('the pull: a player out on the plates wakes him (the chain pull answers); short of the ring nothing stirs', () => {
    const far = room();
    put(far, far.me, 0, WYRMS_HOLLOW.z - KORZUL_WAKE_RADIUS - 2);
    realTick(far, 20);
    expect(st(far).phase).toBe('idle');
    expect(far.boss.inCombat).toBe(false);

    const r = room();
    put(r, r.me, 0, WYRMS_HOLLOW.z - KORZUL_WAKE_RADIUS + 1.5);
    realTick(r, 1);
    expect(st(r).phase).toBe('emerge');
    expect(r.boss.aggroTargetId).toBe(r.me.id);
    // The Sanctum punishes a skipped pack: everything left alive comes.
    const woken = r.inst.mobIds
      .map((id) => r.sim.ctx.entities.get(id))
      .filter((e) => e && e.id !== r.boss.id && !e.dead && e.aiState === 'chase');
    expect(woken.length).toBeGreaterThan(0);
    expect(storyStep(r.sim.ctx, r.inst)).toBe(8);
  });

  it('the Hollow Ward seals behind the group the moment he wakes, cinematic included', () => {
    const r = room();
    r.sim.chat('/dev sanctum kill trash', r.me.id);
    const ward = DUNGEONS[DUNGEON].gates?.find((g) => g.id === 'hollow_ward');
    if (!ward) throw new Error('no Hollow Ward');
    put(r, r.me, 0, WYRMS_HOLLOW.z - KORZUL_WAKE_RADIUS - 2);
    realTick(r, 2);
    expect(dungeonGateState(r.sim.ctx, r.inst, ward)).toBe('open');
    put(r, r.me, 0, WYRMS_HOLLOW.z - 10);
    realTick(r, 2);
    expect(st(r).phase).toBe('emerge');
    expect(dungeonGateState(r.sim.ctx, r.inst, ward)).toBe('sealed');
  });

  it('a wipe mid-flight restores him; with the ice already gone the next pull rises from where he stands', () => {
    const r = room();
    run(r, KORZUL_EMERGE_ARC_AT + 1);
    const s = st(r);
    expect(s.phase).toBe('emerge');
    expect(r.boss.pos.y - floorAt(r)).toBeGreaterThan(1);
    r.boss.inCombat = false;
    r.boss.aggroTargetId = null;
    r.boss.aiState = 'evade';
    run(r, DT, false);
    expect(s.phase).toBe('idle');
    expect(r.boss.castingAbility).toBeNull();
    expect(r.boss.damageImmune).toBe(false);
    expect(r.boss.hostile).toBe(true);
    expect(r.boss.pos.y - floorAt(r)).toBeLessThan(0.01);
    expect(plateTemplates(r).every((t) => t === 'sanctum_plate_sound')).toBe(true);
    // Home again (the evade walks him back), the face long broken: the next
    // pull plays from his own spot, never from the face.
    r.boss.aiState = 'idle';
    put(r, r.boss, 0, 214);
    expect(storyStep(r.sim.ctx, r.inst)).toBe(8);
    run(r, DT);
    expect(s.phase).toBe('emerge');
    expect(local(r).z).toBeCloseTo(214, 6);
    run(r, KORZUL_EMERGE_SECONDS);
    expect(s.phase).toBe('ground');
    expect(local(r).z).toBeCloseTo(KORZUL_EMERGE_TO.z, 6);
  });

  it('a dev trigger mid-cinematic skips it cleanly: he stands on the centre and the mechanic fires', () => {
    const r = room();
    run(r, KORZUL_EMERGE.burst + 1);
    expect(st(r).phase).toBe('emerge');
    r.sim.chat('/dev sanctum trigger breath', r.me.id);
    expect(st(r).phase).toBe('ground');
    expect(r.boss.castingAbility).toBe(KORZUL_GRAVE_BREATH);
    expect(r.boss.damageImmune).toBe(false);
    expect(r.boss.hostile).toBe(true);
    expect(local(r).z).toBeCloseTo(KORZUL_EMERGE_TO.z, 6);
    expect(r.boss.pos.y - floorAt(r)).toBeLessThan(0.01);
    expect(r.boss.auras.some((a) => a.id === KORZUL_AIRBORNE)).toBe(false);
  });

  it('the landing throws the close clear, without a scratch', () => {
    const r = room();
    run(r, KORZUL_EMERGE_LAND_AT);
    const under = addPlayer(r, 'Under', KORZUL_EMERGE_TO.x + 2, KORZUL_EMERGE_TO.z);
    r.events = [];
    run(r, KORZUL_EMERGE.land + DT);
    expect(st(r).phase).toBe('ground');
    const d = Math.hypot(under.pos.x - r.boss.pos.x, under.pos.z - r.boss.pos.z);
    expect(d).toBeGreaterThan(6);
    expect(r.events.filter((e) => e.type === 'damage')).toHaveLength(0);
  });
});
