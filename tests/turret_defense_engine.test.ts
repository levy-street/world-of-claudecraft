import { describe, expect, it } from 'vitest';
import {
  TURRET_ARENA,
  TURRET_BOWLING,
  TURRET_PHYSICS,
  TURRET_SIZE_CLASSES,
  TURRET_TIMING,
  TURRET_WEAPON,
} from '../src/sim/content/turret_defense';
import {
  type MotionSegment,
  marchSegment,
  planFlight,
  planSkid,
  positionAt,
  stillSegment,
  type ThrowProbe,
  velocityAt,
} from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  type TurretEvent,
  type TurretHit,
  type TurretMonster,
  tickTurretDefense,
  turretBreachPoints,
  turretShellFlightTicks,
  turretStrikeDistance,
} from '../src/sim/minigames/turret_defense';
import {
  resolveTurretPlan,
  type TurretKind,
  type TurretPlan,
} from '../src/sim/minigames/turret_defense_plan';
import { turretSessionSeed } from '../src/sim/minigames/turret_defense_rng';
import { DT, type TurretSizeClass } from '../src/sim/types';

const flat: ThrowProbe = { ground: () => 0, water: () => null };
const hills: ThrowProbe = {
  ground: (x, z) => 2 * Math.sin(x * 0.11) + 1.5 * Math.cos(z * 0.13) + 0.04 * x,
  water: () => null,
};
const lakeBeyond = (z0: number, depth = 2): ThrowProbe => ({
  ground: (_x, z) => (z > z0 ? -depth : 0),
  water: (_x, z) => (z > z0 ? 0 : null),
});
const START = 1000;
const INTRO_END = START + TURRET_TIMING.introTicks;
const HELD_BACK = Number.MAX_SAFE_INTEGER;

function kind(size: TurretSizeClass, maxHp: number, marchSpeed = 4.4): TurretKind {
  const s = TURRET_SIZE_CLASSES[size];
  return {
    templateId: 'forest_wolf',
    level: 2,
    sizeClass: size,
    maxHp,
    marchSpeed,
    mass: s.mass,
    radius: s.radius,
    breachValue: s.breachValue,
    height: s.height,
  };
}

function plan(kinds: TurretKind[], spawns: number[][], coreDamage = 60): TurretPlan {
  return {
    kinds,
    waves: spawns.map((s) => ({ spawns: s, coreDamage, gapMinTicks: 16, gapMaxTicks: 32 })),
    bowling: { ...TURRET_BOWLING, enabled: false },
  };
}

function run(state: TurretDefenseState, toTick: number, probe = flat): TurretEvent[] {
  const events: TurretEvent[] = [];
  for (let t = state.tick + 1; t <= toTick; t++) events.push(...tickTurretDefense(state, t, probe));
  return events;
}

/** A session in its first wave with one monster spawned and one held back (so the wave never clears). */
function oneMonster(k: TurretKind, seed = 7): { state: TurretDefenseState; m: TurretMonster } {
  const state = createTurretDefense(plan([k], [[0, 0]]), { x: 0, z: 0 }, seed, START);
  run(state, INTRO_END);
  state.nextSpawnTick = HELD_BACK;
  return { state, m: state.monsters[0] };
}

/** Holds a monster still at (x, z) for a long time (hit during `down` is a legal throw). */
function pin(
  state: TurretDefenseState,
  m: TurretMonster,
  x: number,
  z: number,
  probe = flat,
): void {
  m.state = 'down';
  m.seg = stillSegment(state.tick, 100000, { x, y: probe.ground(x, z), z });
}

function spawnAll(state: TurretDefenseState): void {
  const wave = state.plan.waves[state.wave];
  while (state.spawnCursor < wave.spawns.length) {
    state.nextSpawnTick = 0;
    run(state, state.tick + 1);
  }
}

function fireAt(state: TurretDefenseState, x: number, z: number, probe = flat) {
  const out = fireTurret(state, state.tick, x, z, probe);
  if (!out.ok) throw new Error(`refused: ${out.reason}`);
  return out.shot;
}

/** Where a shot fired now must land to meet a body on `seg`, and when it lands. */
function lead(state: TurretDefenseState, seg: MotionSegment, probe = flat) {
  let impact = state.tick + 5;
  let p = positionAt(seg, impact, probe);
  for (let i = 0; i < 6; i++) {
    impact = state.tick + turretShellFlightTicks(Math.hypot(p.x - state.cx, p.z - state.cz));
    p = positionAt(seg, impact, probe);
  }
  return { x: p.x, z: p.z, impact };
}

// Read through calls, so a test that just assigned a field is not narrowed to that value.
function stateOf(m: TurretMonster): TurretMonster['state'] {
  return m.state;
}
function segOf(m: TurretMonster): MotionSegment {
  return m.seg;
}

function launchesOf(events: TurretEvent[], id: number) {
  return events.flatMap((e) => (e.type === 'launched' && e.id === id ? [e] : []));
}

function nearestLive(state: TurretDefenseState, tick: number, probe: ThrowProbe) {
  let best: { x: number; z: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const p = positionAt(m.seg, tick, probe);
    const d = Math.hypot(p.x - state.cx, p.z - state.cz);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

interface RunResult {
  state: TurretDefenseState;
  trace: string[];
  ticks: number;
  waves: { start: number; cleared: number }[];
}

function fullRun(seed: number, aim: boolean, probe = flat, maxTicks = 20 * 60 * 15): RunResult {
  const state = createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, seed, START);
  const trace: string[] = [];
  const waves: { start: number; cleared: number }[] = [];
  let t = START;
  while (t < START + maxTicks && state.phase !== 'won' && state.phase !== 'lost') {
    t++;
    for (const e of tickTurretDefense(state, t, probe)) {
      trace.push(JSON.stringify(e));
      if (e.type === 'waveStart') waves.push({ start: t, cleared: -1 });
      if (e.type === 'waveCleared') waves[waves.length - 1].cleared = t;
    }
    if (aim && t >= state.readyTick) {
      const target = nearestLive(state, t, probe);
      if (target) {
        const out = fireTurret(state, t, target.x, target.z, probe);
        for (const e of out.events) trace.push(JSON.stringify(e));
      }
    }
  }
  return { state, trace, ticks: t - START, waves };
}

function expectPlainData(value: unknown, path = 'state'): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path} is not finite`).toBe(true);
    return;
  }
  expect(typeof value, path).toBe('object');
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      expectPlainData(v, `${path}[${i}]`);
    });
    return;
  }
  expect(Object.getPrototypeOf(value), `${path} is not a plain object`).toBe(Object.prototype);
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    expect(v, `${path}.${k} is undefined`).not.toBeUndefined();
    expectPlainData(v, `${path}.${k}`);
  }
}

/** Ticks one at a time and records every state label the monster takes, in order. */
function statesUntil(state: TurretDefenseState, m: TurretMonster, ticks: number, probe = flat) {
  const seen: { state: string; tick: number }[] = [{ state: m.state, tick: state.tick }];
  const events: TurretEvent[] = [];
  for (let t = state.tick + 1, until = state.tick + ticks; t <= until; t++) {
    events.push(...tickTurretDefense(state, t, probe));
    if (seen[seen.length - 1].state !== m.state) seen.push({ state: m.state, tick: t });
  }
  return { seen, events };
}

describe('phases and spawns', () => {
  it('holds a 3 s intro, then starts wave 1 and spawns its first monster at once', () => {
    const state = createTurretDefense(resolveTurretPlan(), { x: 5, z: -3 }, 11, START);
    expect(run(state, INTRO_END - 1)).toEqual([]);
    expect(state.phase).toBe('intro');
    const events = run(state, INTRO_END);
    expect(events[0]).toEqual({ type: 'waveStart', wave: 0, count: 8 });
    expect(state.phase).toBe('wave');
    expect(state.monsters).toHaveLength(1);
  });

  it('spawns on the 46 yd ring every 0.8 to 1.6 s, in plan order, with varying gaps', () => {
    const p = resolveTurretPlan();
    const state = createTurretDefense(p, { x: 5, z: -3 }, 11, START);
    const seen: { id: number; tick: number; kind: number }[] = [];
    for (let t = START + 1; t <= START + 20 * 40; t++) {
      tickTurretDefense(state, t, flat);
      for (const m of state.monsters) {
        if (seen.some((s) => s.id === m.id)) continue;
        seen.push({ id: m.id, tick: t, kind: m.kind });
        const origin = positionAt(m.seg, m.seg.start, flat);
        expect(Math.hypot(origin.x - 5, origin.z + 3)).toBeCloseTo(TURRET_ARENA.spawnRadius, 9);
      }
    }
    const wave1 = seen.slice(0, 8);
    expect(wave1.map((s) => s.kind)).toEqual(p.waves[0].spawns);
    const gaps = wave1.slice(1).map((s, i) => s.tick - wave1[i].tick);
    expect(gaps).toHaveLength(7);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(16);
      expect(gap).toBeLessThanOrEqual(32);
    }
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  it('spawns the real sixth wave in plan order with the guardian last', () => {
    const p = resolveTurretPlan();
    const state = createTurretDefense(p, { x: 0, z: 0 }, 13, START);
    state.phase = 'between';
    state.wave = 4;
    state.phaseEndTick = START + 1;
    const spawned: number[] = [];
    const ids = new Set<number>();
    for (let t = START + 1; t <= START + 20 * 30 && state.spawnCursor < 9; t++) {
      tickTurretDefense(state, t, flat);
      for (const m of state.monsters) {
        if (ids.has(m.id)) continue;
        ids.add(m.id);
        spawned.push(m.kind);
      }
    }
    expect(state.wave).toBe(5);
    expect(spawned).toEqual(p.waves[5].spawns);
    expect(p.kinds[spawned[spawned.length - 1]].templateId).toBe('idol_guardian');
  });

  it('draws spawn angles from the session seed', () => {
    const angles = (seed: number) => {
      const { state } = oneMonster(kind('small', 50), seed);
      const o = positionAt(state.monsters[0].seg, state.tick, flat);
      return Math.atan2(o.x, o.z);
    };
    expect(angles(1)).toBe(angles(1));
    expect(angles(1)).not.toBe(angles(2));
  });

  it('derives the session seed from world seed, owner and start tick', () => {
    expect(turretSessionSeed(20260928, 7, 1000)).toBe(332875727);
    expect(turretSessionSeed(20260929, 7, 1000)).not.toBe(332875727);
    expect(turretSessionSeed(20260928, 8, 1000)).not.toBe(332875727);
    expect(turretSessionSeed(20260928, 7, 1001)).not.toBe(332875727);
  });
});

describe('march and windup', () => {
  it('walks straight at the plan speed, facing the center, and winds up at the strike distance', () => {
    const k = kind('small', 50, 4.4);
    const { state, m } = oneMonster(k);
    const origin = positionAt(m.seg, m.seg.start, flat);
    expect(m.facing).toBeCloseTo(Math.atan2(-origin.x, -origin.z), 12);
    const arrive = m.seg.start + (TURRET_ARENA.spawnRadius - turretStrikeDistance(k)) / 4.4 / DT;
    run(state, Math.floor(arrive));
    expect(m.state).toBe('march');
    const events = run(state, Math.floor(arrive) + 1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'windupStart', id: m.id }));
    expect(m.state).toBe('windup');
    const p = positionAt(m.seg, state.tick, flat);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(TURRET_ARENA.breachRadius + k.radius, 9);
  });

  it('strikes in contact: every size winds up 0.4 yd off the tower wall, body edge to wall', () => {
    for (const size of Object.keys(TURRET_SIZE_CLASSES) as TurretSizeClass[]) {
      const k = kind(size, 50);
      const { state, m } = oneMonster(k);
      run(state, Math.ceil(m.seg.end));
      expect(m.state).toBe('windup');
      const p = positionAt(m.seg, state.tick, flat);
      expect(Math.hypot(p.x, p.z) - k.radius - TURRET_ARENA.turretRadius).toBeCloseTo(0.4, 9);
    }
  });
});

describe('the shot', () => {
  it('refuses inside the cooldown and accepts at its end', () => {
    const { state } = oneMonster(kind('small', 50));
    expect(fireTurret(state, state.tick, 20, 0, flat).ok).toBe(true);
    const cd = TURRET_WEAPON.cooldownTicks;
    expect(fireTurret(state, state.tick + cd - 1, 20, 0, flat)).toEqual({
      ok: false,
      reason: 'cooldown',
      events: [],
    });
    expect(fireTurret(state, state.tick + cd, 20, 0, flat).ok).toBe(true);
  });

  it('refuses a non-finite aim, and every shot once the session has ended', () => {
    const { state } = oneMonster(kind('small', 50));
    expect(fireTurret(state, state.tick, Number.NaN, 0, flat)).toMatchObject({ reason: 'invalid' });
    for (const phase of ['won', 'lost'] as const) {
      state.phase = phase;
      expect(fireTurret(state, state.tick, 20, 0, flat)).toMatchObject({
        ok: false,
        reason: 'ended',
      });
    }
  });

  it('allows practice shots in the intro and between waves', () => {
    const intro = createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 3, START);
    expect(fireTurret(intro, START, 10, 10, flat).ok).toBe(true);
    const state = createTurretDefense(
      plan([kind('small', 50)], [[0], [0]]),
      { x: 0, z: 0 },
      3,
      START,
    );
    run(state, INTRO_END);
    const m = state.monsters[0];
    pin(state, m, 0, 20);
    const shot = fireAt(state, 0, 20);
    run(state, shot.impactTick);
    expect(state.phase).toBe('between');
    run(state, state.readyTick);
    expect(fireTurret(state, state.tick, 5, 5, flat).ok).toBe(true);
  });

  it('carries the current wave core damage (wave 6 hits for 220, an intro shot for 60)', () => {
    const p = resolveTurretPlan();
    const state = createTurretDefense(p, { x: 0, z: 0 }, 3, START);
    expect(fireAt(state, 10, 0).damage).toBe(60);
    state.phase = 'between';
    state.wave = 4;
    state.phaseEndTick = state.tick + 1;
    run(state, state.tick + 1);
    expect(state.wave).toBe(5);
    const m = state.monsters[0];
    state.nextSpawnTick = HELD_BACK;
    expect(m.hp).toBe(480);
    pin(state, m, 0, 20);
    state.readyTick = 0;
    const shot = fireAt(state, 0, 20);
    expect(shot.damage).toBe(220);
    const impact = run(state, shot.impactTick).find(
      (e) => e.type === 'impact' && e.shotId === shot.id,
    );
    expect(impact?.type === 'impact' && impact.hits).toEqual([
      { id: m.id, falloff: 1, damage: 220, x: 0, y: 0, z: 20 },
    ]);
    expect(m.hp).toBe(480 - 220);
  });

  it('clamps the aim to 2..60 yd along the aim direction, 360 degrees', () => {
    const { state } = oneMonster(kind('small', 50));
    state.cx = 10;
    state.cz = 20;
    const cases = [
      { aim: [10.3, 20.4], want: [10 + 1.2, 20 + 1.6] },
      { aim: [10 - 300, 20], want: [10 - 60, 20] },
      { aim: [10, 20 - 25], want: [10, 20 - 25] },
    ];
    for (const c of cases) {
      state.readyTick = 0;
      const shot = fireAt(state, c.aim[0], c.aim[1]);
      expect(shot.x).toBeCloseTo(c.want[0], 9);
      expect(shot.z).toBeCloseTo(c.want[1], 9);
    }
    state.readyTick = 0;
    const onCenter = fireAt(state, 10, 20);
    expect(onCenter.x).toBeCloseTo(10, 9);
    expect(onCenter.z).toBeCloseTo(20 - 2, 9);
  });

  it('fixes the impact tick at fire time: clamp(distance / 110, 0.2, 0.9) s', () => {
    for (const range of [2, 22, 30, 45, 60]) {
      const seconds = Math.min(0.9, Math.max(0.2, range / 110));
      expect(turretShellFlightTicks(range)).toBe(Math.round(seconds / DT));
    }
    const { state } = oneMonster(kind('small', 50));
    const out = fireTurret(state, state.tick, 0, 45, flat);
    expect(out.ok && out.shot.impactTick).toBe(state.tick + Math.round(45 / 110 / DT));
    expect(out.events[0]).toMatchObject({ type: 'fired', flightTicks: Math.round(45 / 110 / DT) });
  });

  it('applies falloff at the core, mid, rim (at least 1 damage) and outside', () => {
    const k = kind('large', 10000);
    const state = createTurretDefense(plan([k], [[0, 0, 0, 0]]), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END);
    spawnAll(state);
    expect(state.monsters).toHaveLength(4);
    const [core, mid, rim, out] = state.monsters;
    pin(state, core, 0, 20);
    pin(state, mid, 3.75, 20);
    pin(state, rim, 0, 20 - 5.97);
    pin(state, out, -6.2, 20);
    const shot = fireAt(state, 0, 20);
    const events = run(state, shot.impactTick);
    const impact = events.find((e) => e.type === 'impact');
    if (impact?.type !== 'impact') throw new Error('no impact');
    expect(impact.hits.map((h) => h.id)).toEqual([core.id, mid.id, rim.id]);
    expect(impact.hits[0].falloff).toBe(1);
    expect(impact.hits[1].falloff).toBeCloseTo(0.5, 12);
    expect(impact.hits[2].falloff).toBeCloseTo(0.03 / 4.5, 9);
    expect(60 * impact.hits[2].falloff).toBeLessThan(0.5);
    expect(impact.hits.map((h) => h.damage)).toEqual([60, 30, 1]);
    expect(out.hp).toBe(10000);
  });

  it('places each hit where its body stood at the impact tick, on hills and on the move', () => {
    const k = kind('large', 10000);
    const state = createTurretDefense(plan([k], [[0, 0]]), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END, hills);
    spawnAll(state);
    const [still, marching] = state.monsters;
    pin(state, still, 1, 20, hills);
    marching.state = 'march';
    marching.seg = marchSegment(state.tick, -3, hills.ground(-3, 24), 24, 0, 0, 4, 2);
    const shot = fireAt(state, 0, 21, hills);
    const expected = positionAt(marching.seg, shot.impactTick, hills);
    const events = run(state, shot.impactTick, hills);
    const impact = events.find((e) => e.type === 'impact');
    if (impact?.type !== 'impact') throw new Error('no impact');
    expect(impact.hits.map((h) => h.id)).toEqual([still.id, marching.id]);
    expect(impact.hits[0]).toMatchObject({ x: 1, y: hills.ground(1, 20), z: 20 });
    expect(impact.hits[1].x).toBeCloseTo(expected.x, 12);
    expect(impact.hits[1].y).toBeCloseTo(expected.y, 12);
    expect(impact.hits[1].z).toBeCloseTo(expected.z, 12);
    for (const hit of impact.hits) {
      const launched = events.find((e) => e.type === 'launched' && e.id === hit.id);
      expect(launched).toMatchObject({ x: hit.x, y: hit.y, z: hit.z });
    }
  });

  it('reports an impact on empty ground with no hits', () => {
    const { state, m } = oneMonster(kind('small', 50));
    pin(state, m, 0, 40);
    const shot = fireAt(state, 0, 10);
    const events = run(state, shot.impactTick);
    expect(events).toContainEqual({ type: 'impact', shotId: shot.id, x: 0, y: 0, z: 10, hits: [] });
    expect(state.stats).toMatchObject({ shots: 1, hits: 0 });
  });

  it('spreads the throw direction by at most 15 degrees, and really uses the spread', () => {
    expect(TURRET_WEAPON.deviation).toBe(Math.PI / 12);
    let widest = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const { state, m } = oneMonster(kind('small', 10000), seed);
      pin(state, m, 1, 20);
      const shot = fireAt(state, 0, 20);
      const [launch] = launchesOf(run(state, shot.impactTick), m.id);
      const off = Math.abs(Math.atan2(launch.vz, launch.vx));
      expect(off).toBeLessThanOrEqual(Math.PI / 12 + 1e-9);
      widest = Math.max(widest, off);
    }
    expect(widest).toBeGreaterThan((5 * Math.PI) / 180);
  });
});

describe('the throw', () => {
  it('runs bounce, skid, down, rise, then march, and measures the throw and its airtime', () => {
    const { state, m } = oneMonster(kind('small', 10000));
    pin(state, m, 0, 20);
    const shot = fireAt(state, 0, 19.2);
    const events = run(state, shot.impactTick);
    expect(launchesOf(events, m.id)).toHaveLength(1);
    expect(m.state).toBe('fly');
    const first = m.seg;
    const { seen, events: later } = statesUntil(state, m, 20 * 8);
    const mine = later.flatMap((e) => ('id' in e && e.id === m.id ? [e.type] : []));
    expect(mine[0]).toBe('bounce');
    expect(mine.indexOf('landed')).toBeGreaterThan(0);
    expect(seen.map((s) => s.state)).toEqual(['fly', 'skid', 'down', 'rise', 'march']);
    const at = (s: string) => seen.find((x) => x.state === s)?.tick ?? 0;
    expect(at('rise') - at('down')).toBe(TURRET_TIMING.downTicks);
    expect(at('march') - at('rise')).toBe(TURRET_TIMING.riseTicks);
    expect(state.stats.longestThrow).toBeGreaterThan(24 * 0.85);
    expect(state.stats.longestThrow).toBeLessThan(24 * 1.15);
    expect(state.stats.longestAirtime).toBeCloseTo((first.end - first.start) * 0.05, 12);
    const from = positionAt(m.seg, m.seg.start, flat);
    const toCenter = Math.atan2(-from.x, -from.z);
    expect(Math.sin(m.facing)).toBeCloseTo(Math.sin(toCenter), 9);
    expect(Math.cos(m.facing)).toBeCloseTo(Math.cos(toCenter), 9);
  });

  it('goes straight to down after a slow landing, without a skid', () => {
    const { state, m } = oneMonster(kind('small', 10000));
    m.state = 'fly';
    m.seg = planFlight(state.tick, 0, 0.2, 20, { x: 0.1, y: 0, z: 0 }, 0.6, flat, TURRET_PHYSICS);
    const { seen, events } = statesUntil(state, m, 10);
    expect(seen.map((s) => s.state)).toEqual(['fly', 'down']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'landed', id: m.id }));
  });

  it('adds a juggle to the velocity the body already has, and extends its airtime', () => {
    // Large mass keeps the summed velocity under the juggle caps, so the sum is exact.
    const k = kind('large', 10000);
    const { state, m } = oneMonster(k);
    pin(state, m, 0, 20);
    const first = fireAt(state, 0, 20);
    run(state, first.impactTick);
    const launchTick = state.tick;
    const flight = m.seg;
    run(state, state.readyTick);
    const aim = lead(state, flight);
    expect(aim.impact).toBeLessThan(flight.end);
    fireAt(state, aim.x, aim.z);
    const [launched] = launchesOf(run(state, aim.impact), m.id);
    const before = velocityAt(flight, aim.impact);
    const lift = TURRET_WEAPON.pop / k.mass ** TURRET_WEAPON.massExponent;
    expect(before.y + lift).toBeLessThan(TURRET_WEAPON.maxLaunchLift);
    expect(launched.vy).toBeCloseTo(before.y + lift, 9);
    expect(Math.hypot(launched.vx, launched.vz)).toBeLessThan(TURRET_WEAPON.maxLaunchSpeed);
    const added = Math.hypot(launched.vx - before.x, launched.vz - before.z);
    expect(added).toBeCloseTo(TURRET_WEAPON.push / k.mass ** TURRET_WEAPON.massExponent, 9);
    expect(m.hp).toBe(10000 - 120);
    const second = m.seg;
    run(state, Math.ceil(second.end));
    expect(state.stats.longestAirtime).toBeCloseTo((second.end - launchTick) * 0.05, 12);
    expect(state.stats.longestAirtime).toBeGreaterThan((flight.end - flight.start) * 0.05);
  });

  it('caps a juggled body at 32 yd/s across and 26 yd/s up', () => {
    const { state, m } = oneMonster(kind('small', 100000));
    pin(state, m, 0, 6);
    const launches: ReturnType<typeof launchesOf> = [];
    let shot = fireAt(state, 0, 6);
    launches.push(...launchesOf(run(state, shot.impactTick), m.id));
    for (let i = 0; i < 3; i++) {
      run(state, state.readyTick);
      expect(m.state).toBe('fly');
      const aim = lead(state, m.seg);
      expect(aim.impact).toBeLessThan(m.seg.end);
      shot = fireAt(state, aim.x, aim.z);
      launches.push(...launchesOf(run(state, shot.impactTick), m.id));
      expect(Number.isFinite(m.seg.end)).toBe(true);
    }
    expect(launches).toHaveLength(4);
    const across = launches.map((l) => Math.hypot(l.vx, l.vz));
    for (const l of launches) expect(l.vy).toBeLessThanOrEqual(26 + 1e-9);
    for (const h of across) expect(h).toBeLessThanOrEqual(32 + 1e-9);
    expect(across.some((h) => Math.abs(h - 32) < 1e-9)).toBe(true);
    expect(launches.some((l) => Math.abs(l.vy - 26) < 1e-9)).toBe(true);
    run(state, Math.ceil(m.seg.end) + 20 * 5);
    expectPlainData(state);
  });

  it('launches a marching body at exactly push and pop over the cube root of its mass, with no carried walk', () => {
    const k = kind('large', 10000);
    const { state, m } = oneMonster(k);
    expect(m.state).toBe('march');
    run(state, state.tick + 20);
    const aim = lead(state, m.seg);
    fireAt(state, aim.x, aim.z);
    const [launched] = launchesOf(run(state, aim.impact), m.id);
    expect(Math.hypot(launched.vx, launched.vz)).toBeCloseTo(TURRET_WEAPON.push / Math.cbrt(3), 9);
    expect(launched.vy).toBeCloseTo(TURRET_WEAPON.pop / Math.cbrt(3), 9);
  });

  it('carries the velocity of a skidding body into its next throw', () => {
    const k = kind('small', 10000);
    const { state, m } = oneMonster(k);
    m.state = 'skid';
    const skid = planSkid(state.tick, 0, 0, 20, 0, 15, k.radius, flat, TURRET_PHYSICS);
    if (!skid) throw new Error('no skid');
    m.seg = skid;
    const aim = lead(state, skid);
    expect(aim.impact).toBeLessThan(skid.end);
    fireAt(state, aim.x, aim.z);
    const [launched] = launchesOf(run(state, aim.impact), m.id);
    const carried = velocityAt(skid, aim.impact);
    expect(Math.hypot(carried.x, carried.z)).toBeGreaterThan(1);
    expect(Math.hypot(launched.vx - carried.x, launched.vz - carried.z)).toBeCloseTo(
      TURRET_WEAPON.push,
      9,
    );
    expect(launched.vy).toBeCloseTo(TURRET_WEAPON.pop, 9);
  });

  it('throws a monster killed by the blast as a corpse, lays it down for 5 s, then removes it', () => {
    const { state, m } = oneMonster(kind('small', 50));
    pin(state, m, 0, 20);
    const shot = fireAt(state, 0, 20);
    const events = run(state, shot.impactTick);
    expect(events.map((e) => e.type)).toEqual(['impact', 'launched', 'killed']);
    expect(m.hp).toBe(0);
    expect(m.state).toBe('fly');
    expect(state.stats.kills).toBe(1);
    const { seen } = statesUntil(state, m, 20 * 4);
    expect(seen[seen.length - 1].state).toBe('dead');
    expect(m.seg.end - m.seg.start).toBe(TURRET_TIMING.corpseTicks);
    run(state, Math.ceil(m.seg.end) - 1);
    expect(state.monsters).toContain(m);
    run(state, Math.ceil(m.seg.end));
    expect(state.monsters).not.toContain(m);
  });

  it('throws a corpse exactly as it throws a living body, bounces and slide included', () => {
    const throwOf = (hp: number) => {
      const { state, m } = oneMonster(kind('medium', hp));
      pin(state, m, 3, 20);
      const shot = fireAt(state, 0, 20);
      const [launched] = launchesOf(run(state, shot.impactTick), m.id);
      const path: TurretEvent[] = [];
      const states: string[] = [stateOf(m)];
      const until = state.tick + 20 * 10;
      while (stateOf(m) !== 'dead' && stateOf(m) !== 'down' && state.tick < until) {
        for (const e of run(state, state.tick + 1))
          if ('id' in e && e.id === m.id && e.type !== 'killed') path.push(e);
        if (states[states.length - 1] !== stateOf(m)) states.push(stateOf(m));
      }
      return {
        launched,
        alive: m.hp > 0,
        flight: state.stats.longestThrow,
        airtime: state.stats.longestAirtime,
        path,
        states,
        rest: positionAt(m.seg, state.tick, flat),
        restTick: m.seg.start,
      };
    };
    const corpse = throwOf(30);
    const living = throwOf(10000);
    expect([corpse.alive, living.alive]).toEqual([false, true]);
    expect(corpse.launched).toEqual(living.launched);
    expect(corpse.flight).toBe(living.flight);
    const { vx, vy, vz } = corpse.launched;
    expect(corpse.flight).toBeCloseTo((2 * Math.hypot(vx, vz) * vy) / TURRET_PHYSICS.gravity, 3);
    expect(living.path.map((e) => e.type)).toContain('bounce');
    expect(living.states).toContain('skid');
    expect(corpse.path).toEqual(living.path);
    expect(corpse.states.slice(0, -1)).toEqual(living.states.slice(0, -1));
    expect([corpse.states.at(-1), living.states.at(-1)]).toEqual(['dead', 'down']);
    expect(corpse.airtime).toBe(living.airtime);
    expect(corpse.rest).toEqual(living.rest);
    expect(corpse.restTick).toBe(living.restTick);
  });

  it('does not re-throw a corpse lying on the ground', () => {
    const { state, m } = oneMonster(kind('small', 50));
    pin(state, m, 0, 20);
    run(state, fireAt(state, 0, 20).impactTick);
    const { seen } = statesUntil(state, m, 20 * 4);
    expect(seen[seen.length - 1].state).toBe('dead');
    const lying = m.seg;
    const at = positionAt(lying, state.tick, flat);
    state.readyTick = 0;
    const shot = fireAt(state, at.x, at.z);
    const impact = run(state, shot.impactTick).find((e) => e.type === 'impact');
    expect(impact?.type === 'impact' && impact.hits).toEqual([]);
    expect(m.state).toBe('dead');
    expect(m.seg).toEqual(lying);
  });

  it('drowns a body thrown into deep water, and lands it in shallow water', () => {
    for (const [depth, drowns] of [
      [2, true],
      [0.5, false],
    ] as const) {
      const probe = lakeBeyond(30, depth);
      const { state, m } = oneMonster(kind('small', 10000));
      pin(state, m, 0, 20, probe);
      const shot = fireAt(state, 0, 19, probe);
      const events = run(state, shot.impactTick + 20 * 3, probe);
      const splash = events.find((e) => e.type === 'splash' && e.id === m.id);
      expect(Boolean(splash)).toBe(drowns);
      if (splash) expect(splash).toMatchObject({ y: 0 });
      expect(state.monsters.includes(m)).toBe(!drowns);
      expect(state.stats.kills).toBe(drowns ? 1 : 0);
    }
  });

  it('drowns a body that skids into deep water, at the water surface', () => {
    const probe = lakeBeyond(30);
    const k = kind('small', 10000);
    const { state, m } = oneMonster(k);
    m.state = 'skid';
    const skid = planSkid(state.tick, 0, 0, 29, 0, 8, k.radius, probe, TURRET_PHYSICS);
    expect(skid?.contact).toBe('water');
    if (!skid) return;
    m.seg = skid;
    const events = run(state, Math.ceil(skid.end), probe);
    expect(events.filter((e) => 'id' in e && e.id === m.id).map((e) => e.type)).toEqual([
      'splash',
      'killed',
    ]);
    expect(events.find((e) => e.type === 'splash')).toMatchObject({ y: 0 });
    expect(state.stats.kills).toBe(1);
    expect(state.monsters).not.toContain(m);
  });

  it('counts a corpse flying into deep water as one kill', () => {
    const probe = lakeBeyond(30);
    const { state, m } = oneMonster(kind('small', 50));
    pin(state, m, 0, 20, probe);
    const shot = fireAt(state, 0, 19, probe);
    const events = run(state, shot.impactTick + 20 * 3, probe);
    expect(events.filter((e) => e.type === 'killed' && e.id === m.id)).toHaveLength(1);
    expect(events.some((e) => e.type === 'splash' && e.id === m.id)).toBe(true);
    expect(state.stats.kills).toBe(1);
  });

  it('removes a body that finds no ground at all, with a vanished event and no kill', () => {
    const abyss: ThrowProbe = { ground: (_x, z) => (z > 25 ? Number.NaN : 0), water: () => null };
    const { state, m } = oneMonster(kind('small', 10000));
    pin(state, m, 0, 20, abyss);
    const shot = fireAt(state, 0, 19, abyss);
    run(state, shot.impactTick, abyss);
    expect(m.seg.kind === 'fly' && m.seg.contact).toBe('void');
    const events = run(state, Math.ceil(m.seg.end), abyss);
    expect(events).toContainEqual(expect.objectContaining({ type: 'vanished', id: m.id }));
    expect(events.some((e) => e.type === 'bounce' || e.type === 'landed')).toBe(false);
    expect(state.monsters).not.toContain(m);
    expect(state.stats.kills).toBe(0);
    expectPlainData(state);
  });

  it('reflects a flight off a collider the probe reports', () => {
    const WALL = 28;
    const walled: ThrowProbe = {
      ground: () => 0,
      water: () => null,
      sweep: (_fx, _fz, tx, tz, r) =>
        tz > WALL - r ? { x: tx, z: WALL - r, blocked: true } : { x: tx, z: tz, blocked: false },
    };
    const { state, m } = oneMonster(kind('small', 10000));
    pin(state, m, 0, 20, walled);
    const shot = fireAt(state, 0, 19, walled);
    run(state, shot.impactTick, walled);
    const segs = [m.seg];
    const events: TurretEvent[] = [];
    for (let t = state.tick + 1, until = state.tick + 60; t < until; t++) {
      events.push(...tickTurretDefense(state, t, walled));
      if (segs[segs.length - 1] !== m.seg) segs.push(m.seg);
    }
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'bounce', surface: 'wall', id: m.id }),
    );
    for (const s of segs) {
      for (let t = s.start; t <= Math.min(s.end, s.start + 200); t += 0.25) {
        expect(positionAt(s, t, walled).z).toBeLessThanOrEqual(WALL - 0.6 + 1e-6);
      }
    }
  });

  it('throws a dead-center hit outward from the turret, with no NaN anywhere', () => {
    const { state, m } = oneMonster(kind('small', 10000));
    pin(state, m, 3, 4);
    const shot = fireAt(state, 3, 4);
    const [launched] = launchesOf(run(state, shot.impactTick), m.id);
    const off = Math.atan2(launched.vx * 4 - launched.vz * 3, launched.vx * 3 + launched.vz * 4);
    expect(Math.abs(off)).toBeLessThanOrEqual(TURRET_WEAPON.deviation + 1e-9);
    run(state, shot.impactTick + 60);
    expectPlainData(state);
  });

  it('never reads a monster below sloped ground at any sampled fractional tick', () => {
    const state = createTurretDefense(resolveTurretPlan(), { x: 3, z: 4 }, 21, START);
    const bad: string[] = [];
    let flying = 0;
    for (let t = START + 1; t < START + 20 * 90; t++) {
      tickTurretDefense(state, t, hills);
      if (t >= state.readyTick) {
        const target = nearestLive(state, t, hills);
        if (target) fireTurret(state, t, target.x, target.z, hills);
      }
      for (const m of state.monsters) {
        if (m.seg.kind === 'fly') flying++;
        for (const frac of [0.13, 0.5, 0.87]) {
          const p = positionAt(m.seg, t + frac, hills);
          const finite = Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
          if (!finite || p.y < hills.ground(p.x, p.z) - 1e-9) bad.push(`${m.id}@${t + frac}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(state.stats.hits).toBeGreaterThan(20);
    expect(flying).toBeGreaterThan(100);
  });
});

describe('grazing hits', () => {
  const { blastCore, blastRadius, grazeFalloff } = TURRET_WEAPON;
  /** How far from the blast point a body takes exactly this falloff. */
  const reachOf = (falloff: number) => blastCore + (1 - falloff) * (blastRadius - blastCore);
  const GRAZE = reachOf(0.19);
  // A hair inside the threshold reach, so float rounding cannot read it as a graze.
  const THRESHOLD = reachOf(grazeFalloff) - 1e-9;

  type Pose = 'march' | 'windup' | 'down' | 'rise' | 'fly';
  function posed(k: TurretKind, pose: Pose) {
    const { state, m } = oneMonster(k);
    const at = { x: 0, y: 0, z: 20 };
    m.state = pose;
    if (pose === 'march') m.seg = marchSegment(state.tick, 0, 0, 20, 0, 0, 4.4, 2);
    if (pose === 'windup') m.seg = stillSegment(state.tick - 2, TURRET_TIMING.windupTicks, at);
    if (pose === 'down') m.seg = stillSegment(state.tick - 5, TURRET_TIMING.downTicks, at);
    if (pose === 'rise') m.seg = stillSegment(state.tick - 3, TURRET_TIMING.riseTicks, at);
    if (pose === 'fly') {
      m.airSince = state.tick;
      m.seg = planFlight(
        state.tick,
        0,
        0,
        20,
        { x: 0, y: 12, z: 0 },
        k.radius,
        flat,
        TURRET_PHYSICS,
      );
    }
    return { state, m };
  }

  /** Fires so the blast lands `reach` yd beside where the body stands at the impact tick. */
  function fireBeside(state: TurretDefenseState, m: TurretMonster, reach: number) {
    let impact = state.tick + TURRET_WEAPON.minFlightTicks;
    let aim = { x: 0, z: 0 };
    for (let i = 0; i < 6; i++) {
      const p = positionAt(m.seg, impact, flat);
      aim = { x: p.x + reach, z: p.z };
      impact = state.tick + turretShellFlightTicks(Math.hypot(aim.x, aim.z));
    }
    const shot = fireAt(state, aim.x, aim.z);
    expect(shot.impactTick).toBe(impact);
    const events = run(state, impact);
    const impactEvent = events.find((e) => e.type === 'impact' && e.shotId === shot.id);
    const hit = impactEvent?.type === 'impact' ? impactEvent.hits.find((h) => h.id === m.id) : null;
    if (!hit) throw new Error('the blast missed');
    return { hit, events };
  }

  it.each(['march', 'windup', 'down', 'rise', 'fly'] as const)(
    'a %s body hit at falloff 0.19 takes its damage but keeps its action and timers',
    (pose) => {
      const k = kind('small', 10000);
      const { state, m } = posed(k, pose);
      const seg = m.seg;
      const { hit, events } = fireBeside(state, m, GRAZE);
      expect(hit.falloff).toBeCloseTo(0.19, 9);
      expect(hit.damage).toBe(Math.round(60 * 0.19));
      expect(m.hp).toBe(10000 - hit.damage);
      expect(launchesOf(events, m.id)).toEqual([]);
      expect(m.state).toBe(pose);
      expect(m.seg).toBe(seg);
      expect(state.stats.hits).toBe(1);
    },
  );

  it.each(['march', 'windup', 'down', 'rise', 'fly'] as const)(
    'a %s body hit at the 0.2 threshold is thrown as before',
    (pose) => {
      const k = kind('small', 10000);
      const { state, m } = posed(k, pose);
      const seg = m.seg;
      const { hit, events } = fireBeside(state, m, THRESHOLD);
      expect(hit.falloff).toBeGreaterThanOrEqual(grazeFalloff);
      expect(hit.falloff).toBeCloseTo(grazeFalloff, 6);
      expect(launchesOf(events, m.id)).toHaveLength(1);
      expect(stateOf(m)).toBe('fly');
      expect(m.seg).not.toBe(seg);
    },
  );

  it('lays a body a graze kills down as a corpse where it stands; a flying one on landing', () => {
    const walker = posed(kind('small', 5), 'march');
    const { hit, events } = fireBeside(walker.state, walker.m, GRAZE);
    expect(hit.falloff).toBeLessThan(grazeFalloff);
    expect(events.filter((e) => 'id' in e && e.id === walker.m.id).map((e) => e.type)).toEqual([
      'killed',
    ]);
    expect(walker.m.state).toBe('dead');
    expect(positionAt(walker.m.seg, walker.state.tick + 20, flat)).toMatchObject({
      x: hit.x,
      z: hit.z,
    });
    expect(walker.state.stats.kills).toBe(1);
    const later = run(walker.state, walker.state.tick + TURRET_TIMING.corpseTicks);
    expect(later.some((e) => e.type === 'breach')).toBe(false);
    expect(walker.state.monsters).not.toContain(walker.m);

    const flyer = posed(kind('small', 5), 'fly');
    const flight = flyer.m.seg;
    fireBeside(flyer.state, flyer.m, GRAZE);
    expect(flyer.m.hp).toBe(0);
    expect(flyer.m.seg).toBe(flight);
    run(flyer.state, flyer.state.tick + 20 * 3);
    expect(flyer.m.state).toBe('dead');
    expect(flyer.state.stats.kills).toBe(1);
  });

  it('lets a body lying past the maximum range get up under rim fire, then march back into range', () => {
    const k = kind('small', 100000);
    const { state, m } = oneMonster(k);
    const lying = TURRET_WEAPON.maxRange + 5.5;
    m.state = 'down';
    m.seg = stillSegment(state.tick, TURRET_TIMING.downTicks, { x: 0, y: 0, z: lying });
    const downAt = state.tick;
    const grazes: TurretHit[] = [];
    const launched: TurretEvent[] = [];
    const seen = [{ state: 'down', tick: downAt }];
    for (let t = downAt + 1; t < downAt + 20 * 30 && stateOf(m) !== 'windup'; t++) {
      for (const e of tickTurretDefense(state, t, flat)) {
        if (e.type === 'impact') grazes.push(...e.hits.filter((h) => h.id === m.id));
        if (e.type === 'launched' && e.id === m.id) launched.push(e);
      }
      if (seen[seen.length - 1].state !== m.state) seen.push({ state: m.state, tick: t });
      // Aimed at the body while it lies: the shells land clamped to the maximum range.
      if (stateOf(m) === 'down' && t >= state.readyTick) {
        const p = positionAt(m.seg, t, flat);
        const shot = fireAt(state, p.x, p.z);
        expect(Math.hypot(shot.x, shot.z)).toBeCloseTo(TURRET_WEAPON.maxRange, 9);
      }
    }
    expect(launched).toEqual([]);
    expect(grazes.length).toBeGreaterThanOrEqual(2);
    for (const g of grazes) {
      expect(g.falloff).toBeGreaterThan(0);
      expect(g.falloff).toBeLessThan(grazeFalloff);
      expect(g.damage).toBeGreaterThanOrEqual(1);
    }
    expect(m.hp).toBe(100000 - grazes.reduce((n, g) => n + g.damage, 0));
    expect(seen.map((s) => s.state)).toEqual(['down', 'rise', 'march', 'windup']);
    expect(seen[1].tick).toBe(downAt + TURRET_TIMING.downTicks);
    expect(seen[2].tick).toBe(seen[1].tick + TURRET_TIMING.riseTicks);
    const strike = positionAt(m.seg, state.tick, flat);
    expect(Math.hypot(strike.x, strike.z)).toBeCloseTo(turretStrikeDistance(k), 9);
  });
});

describe('the tower body', () => {
  const TOWER = TURRET_ARENA.turretRadius;

  it('reflects a low flight off the tower', () => {
    const k = kind('large', 10000);
    const { state, m } = oneMonster(k);
    pin(state, m, 0, 6);
    const shot = fireAt(state, 0, 7);
    run(state, shot.impactTick);
    const segs: MotionSegment[] = [m.seg];
    const events: TurretEvent[] = [];
    for (let t = state.tick + 1, until = state.tick + 40; t <= until; t++) {
      events.push(...tickTurretDefense(state, t, flat));
      if (segs[segs.length - 1] !== m.seg) segs.push(m.seg);
    }
    expect(events).toContainEqual(expect.objectContaining({ type: 'bounce', surface: 'wall' }));
    for (const s of segs) {
      for (let t = s.start; t <= s.end; t += 0.1) {
        const p = positionAt(s, t, flat);
        if (p.y < TURRET_ARENA.turretHeight) {
          expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(TOWER + k.radius - 1e-6);
        }
      }
    }
  });

  it('lets a high flight pass over the tower to the far side', () => {
    const { state, m } = oneMonster(kind('small', 10000));
    pin(state, m, 0, 12);
    const shot = fireAt(state, 0, 13);
    run(state, shot.impactTick);
    const flight = m.seg;
    const events = run(state, Math.ceil(flight.end));
    expect(events.some((e) => e.type === 'bounce' && e.surface === 'wall')).toBe(false);
    const landing = events.find((e) => e.type === 'bounce' && e.id === m.id);
    expect(landing?.type === 'bounce' && landing.z).toBeLessThan(-3);
  });

  it('stops a skid against the tower, then rests the body on the strike radius', () => {
    const k = kind('small', 10000);
    const { state, m } = oneMonster(k);
    m.state = 'fly';
    m.seg = planFlight(
      state.tick,
      0,
      0.1,
      7,
      { x: 0, y: 0, z: -16 },
      k.radius,
      flat,
      TURRET_PHYSICS,
    );
    const { seen } = statesUntil(state, m, 3);
    expect(seen.map((s) => s.state)).toEqual(['fly', 'skid']);
    const skid = segOf(m);
    expect(skid.kind === 'skid' && skid.contact).toBe('wall');
    const stop = positionAt(skid, skid.end, flat);
    expect(Math.hypot(stop.x, stop.z)).toBeCloseTo(TOWER + k.radius, 6);
    run(state, Math.ceil(skid.end));
    expect(m.state).toBe('down');
    const rest = positionAt(m.seg, state.tick, flat);
    expect(rest.x).toBeCloseTo(0, 9);
    expect(rest.z).toBeCloseTo(turretStrikeDistance(k), 9);
    expect(rest.z - stop.z).toBeCloseTo(0.4, 6);
  });

  it('rests a body landing just outside the strike ring where it lands', () => {
    const k = kind('large', 10000);
    const { state, m } = oneMonster(k);
    const at = turretStrikeDistance(k) + 0.3;
    m.state = 'fly';
    m.seg = planFlight(
      state.tick,
      at,
      0.4,
      0,
      { x: 0, y: 0, z: 0 },
      k.radius,
      flat,
      TURRET_PHYSICS,
    );
    const { seen } = statesUntil(state, m, 10);
    expect(seen.map((s) => s.state)).toEqual(['fly', 'down']);
    const rest = positionAt(m.seg, state.tick, flat);
    expect(rest.x).toBeCloseTo(at, 9);
    expect(rest.z).toBeCloseTo(0, 9);
  });

  it('never lets a body rest inside the tower footprint: it is placed on the strike radius on its bearing', () => {
    const k = kind('small', 10000);
    const { state, m } = oneMonster(k);
    m.state = 'fly';
    m.seg = planFlight(
      state.tick,
      0.6,
      5,
      0.8,
      { x: 0, y: 0, z: 0 },
      k.radius,
      flat,
      TURRET_PHYSICS,
    );
    for (
      let t = state.tick + 1, until = state.tick + 100;
      t <= until && stateOf(m) !== 'down';
      t++
    ) {
      run(state, t);
    }
    expect(m.state).toBe('down');
    const rest = positionAt(m.seg, state.tick, flat);
    const reach = turretStrikeDistance(k);
    expect(rest.x).toBeCloseTo(0.6 * reach, 9);
    expect(rest.z).toBeCloseTo(0.8 * reach, 9);
    const { events } = statesUntil(state, m, TURRET_TIMING.downTicks + TURRET_TIMING.riseTicks + 1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'windupStart', id: m.id }));
  });
});

describe('the breach', () => {
  function atWindup(k: TurretKind, spawns = [0, 0], kinds = [k]) {
    const state = createTurretDefense(plan(kinds, [spawns]), { x: 0, z: 0 }, 7, START);
    run(state, INTRO_END);
    state.nextSpawnTick = HELD_BACK;
    const m = state.monsters[0];
    let t = state.tick;
    while (m.state !== 'windup' && t < START + 20 * 60) run(state, ++t);
    expect(m.state).toBe('windup');
    return { state, m };
  }

  it('costs max(1, ceil(breachValue x hp / maxHp)) once, at the strike position, then the monster is gone', () => {
    expect(turretBreachPoints(2, 54, 54)).toBe(2);
    expect(turretBreachPoints(10, 206, 411)).toBe(6);
    expect(turretBreachPoints(15, 1, 1831)).toBe(1);
    expect(turretBreachPoints(4, 0, 100)).toBe(1);
    const k = kind('large', 400);
    const { state, m } = atWindup(k);
    const at = positionAt(m.seg, state.tick, flat);
    expect(Math.hypot(at.x, at.z)).toBeCloseTo(TURRET_ARENA.turretRadius + 0.4 + k.radius, 9);
    m.hp = 150;
    const start = state.tick;
    const events = run(state, start + TURRET_TIMING.windupTicks);
    expect(events.filter((e) => e.type === 'breach')).toEqual([
      { type: 'breach', id: m.id, points: 4, integrity: 96, x: at.x, y: at.y, z: at.z },
    ]);
    expect(state.monsters).not.toContain(m);
    run(state, start + TURRET_TIMING.windupTicks + 100);
    expect(state.integrity).toBe(96);
    expect(state.stats).toMatchObject({ breaches: 1, pointsLost: 4 });
  });

  it('is cancelled by a hit during the windup: thrown away, nothing lost', () => {
    const { state, m } = atWindup(kind('small', 10000));
    const p = positionAt(m.seg, state.tick, flat);
    const shot = fireAt(state, p.x, p.z);
    expect(shot.impactTick).toBeLessThan(m.seg.end);
    run(state, shot.impactTick);
    expect(m.state).toBe('fly');
    run(state, state.tick + TURRET_TIMING.windupTicks);
    expect(state.integrity).toBe(TURRET_TIMING.integrity);
    expect(state.stats.breaches).toBe(0);
  });

  it('a shot landing on the very tick the strike lands still saves the turret', () => {
    const { state, m } = atWindup(kind('small', 10000));
    const p = positionAt(m.seg, state.tick, flat);
    const flight = turretShellFlightTicks(Math.hypot(p.x, p.z));
    const fireTick = Math.ceil(m.seg.end) - flight;
    run(state, fireTick);
    expect(m.state).toBe('windup');
    const shot = fireAt(state, p.x, p.z);
    expect(shot.impactTick).toBe(Math.ceil(m.seg.end));
    run(state, shot.impactTick);
    expect(state.stats.breaches).toBe(0);
  });

  it('never drops integrity below 0: a 10-point strike on 3 points ends the session', () => {
    const { state, m } = atWindup(kind('large', 400));
    state.integrity = 3;
    const events = run(state, Math.ceil(m.seg.end));
    expect(events.find((e) => e.type === 'breach')).toMatchObject({ points: 10, integrity: 0 });
    expect(state.integrity).toBe(0);
    expect(state.phase).toBe('lost');
  });

  it('ends the session as lost the moment integrity reaches 0, freezing walkers and flyers', () => {
    const small = kind('small', 50);
    const sturdy = kind('small', 10000);
    const { state, m } = atWindup(small, [0, 0, 1], [small, sturdy]);
    spawnAll(state);
    const [other, flyer] = state.monsters.filter((x) => x !== m);
    expect(other.state).toBe('march');
    const lostTick = Math.ceil(m.seg.end);
    pin(state, flyer, 0, -20);
    const flight = turretShellFlightTicks(20);
    run(state, lostTick - 10 - flight);
    fireAt(state, 0, -20);
    run(state, lostTick - 1);
    expect(flyer.seg.kind).toBe('fly');
    const walking = other.seg;
    expect(walking.kind).toBe('march');
    expect(walking.end).toBeGreaterThan(lostTick + 10);
    const otherAt = positionAt(walking, lostTick, flat);
    expect(positionAt(walking, lostTick + 10, flat)).not.toEqual(otherAt);
    const flyerAt = positionAt(flyer.seg, lostTick, flat);
    expect(flyerAt.y).toBeGreaterThan(1);
    state.integrity = 2;
    const events = run(state, lostTick);
    expect(state.phase).toBe('lost');
    expect(events[events.length - 1]).toMatchObject({ type: 'ended', result: 'lost' });
    expect(other.seg.kind).toBe('still');
    expect(positionAt(other.seg, lostTick + 1, flat)).toEqual(otherAt);
    expect(positionAt(other.seg, lostTick + 10, flat)).toEqual(otherAt);
    expect(flyer.seg.kind).toBe('still');
    expect(positionAt(flyer.seg, lostTick + 10, flat)).toEqual(flyerAt);
    const frozen = JSON.stringify(state);
    expect(run(state, lostTick + 200)).toEqual([]);
    expect(JSON.stringify(state)).toBe(frozen);
    expect(fireTurret(state, lostTick + 300, 5, 5, flat)).toMatchObject({ reason: 'ended' });
  });
});

describe('determinism and plain data', () => {
  it('replays byte-identically from the same seed and inputs', () => {
    const a = fullRun(99, true, flat, 20 * 60);
    const b = fullRun(99, true, flat, 20 * 60);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.trace).toEqual(b.trace);
    expect(a.trace.length).toBeGreaterThan(100);
    const c = fullRun(100, true, flat, 20 * 60);
    expect(JSON.stringify(c.state)).not.toBe(JSON.stringify(a.state));
  });

  it('is plain data that survives a JSON round trip and keeps simulating identically', () => {
    const state = createTurretDefense(resolveTurretPlan(), { x: 1, z: 2 }, 5, START);
    const drive = (s: TurretDefenseState, until: number, from: number): string[] => {
      const out: string[] = [];
      for (let k = from + 1; k <= until; k++) {
        out.push(JSON.stringify(tickTurretDefense(s, k, hills)));
        if (k >= s.readyTick) {
          const target = nearestLive(s, k, hills);
          if (target) out.push(JSON.stringify(fireTurret(s, k, target.x, target.z, hills)));
        }
      }
      return out;
    };
    let t = START + 20 * 10;
    drive(state, t, START);
    while (!state.monsters.some((m) => m.state === 'fly') && t < START + 20 * 120) {
      drive(state, t + 1, t);
      t++;
    }
    expect(state.monsters.some((m) => m.state === 'fly')).toBe(true);
    expectPlainData(state);
    const clone = JSON.parse(JSON.stringify(state)) as TurretDefenseState;
    expect(JSON.stringify(clone)).toBe(JSON.stringify(state));
    const original = drive(state, t + 20 * 30, t);
    const copied = drive(clone, t + 20 * 30, t);
    expect(copied).toEqual(original);
    expect(JSON.stringify(clone)).toBe(JSON.stringify(state));
  });

  it('bumps the revision on spawns, transitions, shots and impacts, and not on quiet ticks', () => {
    const { state, m } = oneMonster(kind('small', 10000));
    pin(state, m, 0, 30);
    const quiet = state.rev;
    run(state, state.tick + 5);
    expect(state.rev).toBe(quiet);
    const beforeFire = state.rev;
    fireAt(state, 0, 30);
    expect(state.rev).toBeGreaterThan(beforeFire);
    const beforeImpact = state.rev;
    run(state, state.shots[0].impactTick);
    expect(state.rev).toBeGreaterThan(beforeImpact);
    const contact = Math.ceil(m.seg.end);
    run(state, contact - 1);
    const beforeBounce = state.rev;
    const bounce = run(state, contact);
    expect(bounce.map((e) => e.type)).toEqual(['bounce']);
    expect(state.rev).toBeGreaterThan(beforeBounce);
    const walker = oneMonster(kind('small', 10000));
    const arrive = Math.ceil(walker.m.seg.end);
    run(walker.state, arrive - 1);
    const beforeWindup = walker.state.rev;
    expect(run(walker.state, arrive).map((e) => e.type)).toEqual(['windupStart']);
    expect(walker.state.rev).toBeGreaterThan(beforeWindup);
    walker.state.nextSpawnTick = walker.state.tick + 1;
    const beforeSpawn = walker.state.rev;
    expect(run(walker.state, walker.state.tick + 1)).toEqual([]);
    expect(walker.state.monsters).toHaveLength(2);
    expect(walker.state.rev).toBeGreaterThan(beforeSpawn);
  });
});

describe('won sessions settle', () => {
  it('still lands shells already in flight and lets corpses decay to gone', () => {
    const state = createTurretDefense(plan([kind('small', 50)], [[0]]), { x: 0, z: 0 }, 3, START);
    run(state, INTRO_END);
    const m = state.monsters[0];
    pin(state, m, 0, 58);
    const kill = fireAt(state, 0, 58);
    expect(kill.impactTick - state.tick).toBeGreaterThan(TURRET_WEAPON.cooldownTicks);
    run(state, state.readyTick);
    const late = fireAt(state, 0, 30);
    const events = run(state, late.impactTick);
    const ended = events.findIndex((e) => e.type === 'ended');
    const lateImpact = events.findIndex((e) => e.type === 'impact' && e.shotId === late.id);
    expect(ended).toBeGreaterThanOrEqual(0);
    expect(lateImpact).toBeGreaterThan(ended);
    expect(state.phase).toBe('won');
    run(state, state.tick + 20 * 10);
    expect(state.monsters).toEqual([]);
    expect(state.phase).toBe('won');
  });
});

describe('full scripted runs', () => {
  it('an auto-aimer firing at the monster nearest the tower wins all six waves', () => {
    const r = fullRun(42, true);
    expect(r.state.phase).toBe('won');
    expect(r.waves).toHaveLength(6);
    expect(r.waves.every((w) => w.cleared > w.start)).toBe(true);
    for (let i = 1; i < r.waves.length; i++) {
      expect(r.waves[i].start - r.waves[i - 1].cleared).toBe(100);
    }
    expect(r.state.stats.kills).toBe(
      resolveTurretPlan().waves.reduce((n, w) => n + w.spawns.length, 0),
    );
    expect(r.state.integrity).toBeGreaterThan(50);
    expect(r.ticks).toBeLessThan(20 * 60 * 6);
    expect(JSON.parse(r.trace[r.trace.length - 1])).toEqual({
      type: 'ended',
      result: 'won',
      stats: r.state.stats,
    });
  });

  it('a player who never fires loses, in bounded ticks', () => {
    const r = fullRun(42, false);
    expect(r.state.phase).toBe('lost');
    expect(r.state.integrity).toBe(0);
    expect(r.state.stats.pointsLost).toBeGreaterThanOrEqual(TURRET_TIMING.integrity);
    expect(r.ticks).toBeLessThan(20 * 60 * 5);
  });
});
