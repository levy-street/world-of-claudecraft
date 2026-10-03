import { describe, expect, it } from 'vitest';
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import {
  TURRET_ARENA,
  TURRET_BOWLING,
  TURRET_PHYSICS,
  TURRET_SHOCKWAVE,
  TURRET_SIZE_CLASSES,
  TURRET_TIMING,
  TURRET_WEAPON,
} from '../src/sim/content/turret_defense';
import {
  blastFalloff,
  planFlight,
  stillSegment,
  type ThrowProbe,
} from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  type TurretEvent,
  type TurretMonster,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import {
  type TurretKind,
  type TurretPlan,
  turretChargesLeft,
} from '../src/sim/minigames/turret_defense_plan';
import { TURRET_STREAM, turretDraw } from '../src/sim/minigames/turret_defense_rng';
import {
  startTurretShockwave,
  turretShockwaveBlast,
  turretShockwaveFront,
} from '../src/sim/minigames/turret_shockwave';
import type { TurretSizeClass } from '../src/sim/types';

const flat: ThrowProbe = { ground: () => 0, water: () => null };
const START = 1000;
const INTRO_END = START + TURRET_TIMING.introTicks;
const HELD_BACK = Number.MAX_SAFE_INTEGER;
const CORE = 80;
const NO_BARRELS = { count: 0, minRadius: 0, maxRadius: 0 };
const ROLL = TURRET_SHOCKWAVE.rollTicks;

function kind(size: TurretSizeClass, maxHp: number): TurretKind {
  return {
    templateId: 'forest_wolf',
    level: 2,
    sizeClass: size,
    maxHp,
    marchSpeed: 4.4,
    ...TURRET_SIZE_CLASSES[size],
  };
}

function plan(k: TurretKind, count: number, shockwave = 2): TurretPlan {
  return {
    scenarioId: 'test',
    integrity: 100,
    medals: TURRET_SCENARIO_STANDARD.medals,
    arsenal: { shockwave, fragmentation: 0 },
    resupplyWaves: [],
    chargeBonus: false,
    kinds: [k],
    waves: [
      {
        spawns: Array.from({ length: count }, () => 0),
        coreDamage: CORE,
        gapMinTicks: 16,
        gapMaxTicks: 32,
        barrels: NO_BARRELS,
        arrival: { kind: 'ring' },
      },
    ],
    bowling: { ...TURRET_BOWLING, enabled: false },
  };
}

function run(state: TurretDefenseState, toTick: number, probe = flat): TurretEvent[] {
  const out: TurretEvent[] = [];
  for (let t = state.tick + 1; t <= toTick; t++) out.push(...tickTurretDefense(state, t, probe));
  return out;
}

function ofType<T extends TurretEvent['type']>(events: readonly TurretEvent[], type: T) {
  return events.filter((e): e is Extract<TurretEvent, { type: T }> => e.type === type);
}

/** A first wave under way with `count` bodies spawned and no more to come, each pinned lying far off. */
function field(k: TurretKind, count: number, shockwave = 2, seed = 7) {
  const state = createTurretDefense(plan(k, count, shockwave), { x: 0, z: 0 }, seed, START);
  run(state, INTRO_END);
  while (state.spawnCursor < count) {
    state.nextSpawnTick = 0;
    run(state, state.tick + 1);
  }
  state.nextSpawnTick = HELD_BACK;
  for (const m of state.monsters) lay(state, m, 200 + m.id * 10, 200);
  return { state, ms: [...state.monsters] };
}

function lay(state: TurretDefenseState, m: TurretMonster, x: number, z: number, y = 0): void {
  m.state = 'down';
  m.seg = stillSegment(state.tick, 100000, { x, y, z });
}

function slam(state: TurretDefenseState, probe = flat): TurretEvent[] {
  const out = startTurretShockwave(state, state.tick, probe);
  if (!out.ok) throw new Error(`refused: ${out.reason}`);
  return out.events;
}

describe('the front', () => {
  it('rolls from the tower wall to the reach in 0.4 s at a steady speed, then holds', () => {
    expect(ROLL).toBe(8);
    expect(TURRET_SHOCKWAVE.innerRadius).toBe(TURRET_ARENA.turretRadius);
    expect(turretShockwaveFront(0)).toBe(TURRET_SHOCKWAVE.innerRadius);
    expect(turretShockwaveFront(ROLL)).toBe(TURRET_SHOCKWAVE.reach);
    expect(turretShockwaveFront(ROLL / 2)).toBeCloseTo(
      (TURRET_SHOCKWAVE.innerRadius + TURRET_SHOCKWAVE.reach) / 2,
      9,
    );
    expect(turretShockwaveFront(2.5) - turretShockwaveFront(2)).toBeCloseTo(
      (turretShockwaveFront(ROLL) - turretShockwaveFront(0)) / (2 * ROLL),
      9,
    );
    expect(turretShockwaveFront(-3)).toBe(TURRET_SHOCKWAVE.innerRadius);
    expect(turretShockwaveFront(ROLL * 4)).toBe(TURRET_SHOCKWAVE.reach);
    // It stops short of the kegs' ring.
    expect(TURRET_SHOCKWAVE.reach).toBeLessThan(16);
  });

  it('keeps its first values, so a tuning change is a deliberate edit here', () => {
    expect(TURRET_SHOCKWAVE).toEqual({
      innerRadius: TURRET_ARENA.turretRadius,
      reach: 12,
      rollTicks: 8,
      falloffCore: 8,
      falloffRadius: 18,
      groundClearance: 1.5,
      pushScale: 1.2,
      popScale: 0.6,
      damageScale: 0.3,
      rearmTicks: 30,
    });
  });

  it('is full strength inside 8 yd and 60 percent at its reach', () => {
    const f = (d: number) =>
      blastFalloff(d, TURRET_SHOCKWAVE.falloffRadius, TURRET_SHOCKWAVE.falloffCore);
    expect(f(3)).toBe(1);
    expect(f(8)).toBe(1);
    expect(f(TURRET_SHOCKWAVE.reach)).toBeCloseTo(0.6, 9);
  });
});

describe('the slam', () => {
  it('throws each grounded body the moment the front reaches it, outward, low and flat', () => {
    const { state, ms } = field(kind('small', 5000), 3);
    lay(state, ms[0], 4, 0);
    lay(state, ms[1], 0, -7);
    lay(state, ms[2], -8, 8);
    const slamTick = state.tick;
    const started = slam(state);
    expect(started).toEqual([
      {
        type: 'shockwave',
        id: 1,
        x: 0,
        y: 0,
        z: 0,
        startTick: slamTick,
        reach: TURRET_SHOCKWAVE.reach,
      },
    ]);
    const thrownAt = new Map<number, number>();
    for (let t = slamTick + 1; t <= slamTick + ROLL + 4; t++) {
      for (const e of run(state, t)) {
        if (e.type === 'launched') thrownAt.set(e.id, t);
        if (e.type === 'launched') {
          const m = ms.find((b) => b.id === e.id)!;
          const out = Math.hypot(e.vx, e.vz);
          // Outward from the tower's centre, within the throw's private spread.
          const cos = (e.vx * e.x + e.vz * e.z) / (out * Math.hypot(e.x, e.z));
          expect(cos).toBeGreaterThan(Math.cos(TURRET_WEAPON.deviation) - 1e-9);
          // Flatter than a shell's core throw: 1.2 across for 0.6 up.
          expect(e.vy / out).toBeCloseTo(
            (TURRET_WEAPON.pop * TURRET_SHOCKWAVE.popScale) /
              (TURRET_WEAPON.push * TURRET_SHOCKWAVE.pushScale),
            9,
          );
          expect(m.state).toBe('fly');
        }
      }
    }
    const front = (id: number) => {
      const t = thrownAt.get(id)!;
      return [turretShockwaveFront(t - 1 - slamTick), turretShockwaveFront(t - slamTick)];
    };
    for (const [m, d] of [
      [ms[0], 4],
      [ms[1], 7],
      [ms[2], Math.hypot(8, 8)],
    ] as const) {
      expect(thrownAt.has(m.id)).toBe(true);
      const [before, at] = front(m.id);
      expect(d).toBeGreaterThan(before);
      expect(d).toBeLessThanOrEqual(at);
    }
    expect(state.shockwave).toBeNull();
    expect(state.stats.shockwaves).toBe(1);
  });

  it('deals 0.3 of the core damage at full strength, easing past 8 yd, and each body once', () => {
    const { state, ms } = field(kind('small', 5000), 2);
    lay(state, ms[0], 5, 0);
    lay(state, ms[1], 0, 11);
    slam(state);
    const events = run(state, state.tick + ROLL + 30);
    const hits = ofType(events, 'shockwaveHit').flatMap((e) => e.hits);
    expect(hits.map((h) => h.id).sort()).toEqual([ms[0].id, ms[1].id].sort());
    const near = hits.find((h) => h.id === ms[0].id)!;
    const far = hits.find((h) => h.id === ms[1].id)!;
    expect(near.falloff).toBe(1);
    expect(near.damage).toBe(Math.round(CORE * TURRET_SHOCKWAVE.damageScale));
    expect(far.falloff).toBeCloseTo(
      blastFalloff(11, TURRET_SHOCKWAVE.falloffRadius, TURRET_SHOCKWAVE.falloffCore),
      9,
    );
    expect(ofType(events, 'shockwaveHit').every((e) => e.id === 1)).toBe(true);
    // It is not a shot: neither the shots nor the hits count it.
    expect(state.stats.shots).toBe(0);
    expect(state.stats.hits).toBe(0);
  });

  it('counts its kills like any kill, the corpse flying once', () => {
    const { state, ms } = field(kind('small', 10), 1);
    lay(state, ms[0], 5, 0);
    slam(state);
    const events = run(state, state.tick + ROLL);
    expect(ofType(events, 'killed').map((e) => e.id)).toEqual([ms[0].id]);
    expect(ofType(events, 'launched').map((e) => e.id)).toEqual([ms[0].id]);
    expect(state.stats.kills).toBe(1);
  });

  it('never reaches past 12 yd, nor a body flying over it, nor a corpse', () => {
    const { state, ms } = field(kind('small', 5000), 3);
    lay(state, ms[0], 0, 12.5);
    ms[1].state = 'fly';
    ms[1].seg = planFlight(
      state.tick,
      5,
      0,
      0,
      { x: 0, y: 20, z: 0 },
      TURRET_SIZE_CLASSES.small.radius,
      flat,
      TURRET_PHYSICS,
    );
    lay(state, ms[2], -3, 3);
    ms[2].hp = 0;
    ms[2].state = 'dead';
    const corpse = ms[2].seg;
    slam(state);
    const events = run(state, state.tick + ROLL + 1);
    expect(ofType(events, 'shockwaveHit')).toEqual([]);
    expect(ofType(events, 'launched')).toEqual([]);
    expect(ms[0].state).toBe('down');
    expect(ms[2].seg).toBe(corpse);
  });

  it('passes over a body whose feet clear the ground by more than 1.5 yd', () => {
    const { state, ms } = field(kind('small', 5000), 2);
    lay(state, ms[0], 4, 0, 1.4);
    lay(state, ms[1], -4, 0, 1.6);
    slam(state);
    const events = run(state, state.tick + ROLL + 1);
    const struck = ofType(events, 'shockwaveHit').flatMap((e) => e.hits.map((h) => h.id));
    expect(struck).toEqual([ms[0].id]);
  });

  it('cancels a windup: the striker is thrown, the tower keeps its points', () => {
    const state = createTurretDefense(plan(kind('large', 5000), 1), { x: 0, z: 0 }, 7, START);
    run(state, INTRO_END);
    state.nextSpawnTick = HELD_BACK;
    const m = state.monsters[0];
    while (m.state !== 'windup') run(state, state.tick + 1);
    const strike = Math.ceil(m.seg.end);
    run(state, strike - 2);
    slam(state);
    const events = run(state, strike + 20);
    expect(ofType(events, 'breach')).toEqual([]);
    expect(ofType(events, 'shockwaveHit').flatMap((e) => e.hits.map((h) => h.id))).toEqual([m.id]);
    expect(state.integrity).toBe(state.plan.integrity);
    expect(m.hp).toBeGreaterThan(0);
  });

  // Ticks from the slam until the front reaches a striker's stand, per size class. A slam
  // this long before the strike cancels it; one tick later is too late. The click
  // prediction leads by this much, so a tuning change must move it here on purpose.
  const STRIKER_LEAD: Record<TurretSizeClass, number> = { small: 1, medium: 1, large: 2, huge: 2 };

  it.each(Object.entries(STRIKER_LEAD) as [TurretSizeClass, number][])(
    'cancels a %s striker only when slammed %i ticks or more before its strike',
    (size, lead) => {
      const stand = TURRET_ARENA.breachRadius + TURRET_SIZE_CLASSES[size].radius;
      expect(turretShockwaveFront(lead)).toBeGreaterThanOrEqual(stand);
      expect(turretShockwaveFront(lead - 1)).toBeLessThan(stand);
      const arms: [number, number][] =
        lead > 1
          ? [
              [lead, 0],
              [lead - 1, 1],
            ]
          : [[lead, 0]];
      for (const [before, breaches] of arms) {
        const state = createTurretDefense(plan(kind(size, 5000), 1), { x: 0, z: 0 }, 7, START);
        run(state, INTRO_END);
        state.nextSpawnTick = HELD_BACK;
        const m = state.monsters[0];
        while (m.state !== 'windup') run(state, state.tick + 1);
        const strike = Math.ceil(m.seg.end);
        const events = run(state, strike - before);
        slam(state);
        events.push(...run(state, strike + 20));
        expect(ofType(events, 'breach'), `${size} slammed ${before} before`).toHaveLength(breaches);
      }
    },
  );

  it('ends its roll without a new revision: the ring is off the view', () => {
    const { state } = field(kind('small', 5000), 1);
    slam(state);
    const rev = state.rev;
    run(state, state.tick + ROLL + 5);
    expect(state.shockwave).toBeNull();
    expect(state.rev).toBe(rev);
  });

  it('lights no barrel itself, even one standing inside its reach', () => {
    const { state, ms } = field(kind('small', 5000), 1);
    lay(state, ms[0], 4, 0);
    state.barrels.push({ id: state.nextBarrelId++, x: 0, y: 0, z: 6, litTick: -1, blowTick: -1 });
    slam(state);
    const events = run(state, state.tick + ROLL + 10);
    const struck = ofType(events, 'shockwaveHit').flatMap((e) => e.hits.map((h) => h.id));
    expect(struck).toEqual([ms[0].id]);
    expect(ofType(events, 'barrelLit')).toEqual([]);
    expect(state.barrels[0].litTick).toBe(-1);
  });

  it('draws each throw from its own private stream, keyed by the ring', () => {
    const { state, ms } = field(kind('small', 5000), 1);
    lay(state, ms[0], 0, 6);
    slam(state);
    const blast = turretShockwaveBlast(state, state.shockwave!, CORE);
    expect(blast).toMatchObject({
      x: 0,
      z: 0,
      damage: CORE * TURRET_SHOCKWAVE.damageScale,
      stream: TURRET_STREAM.shockwaveThrow,
      key: 1,
      push: TURRET_WEAPON.push * TURRET_SHOCKWAVE.pushScale,
      pop: TURRET_WEAPON.pop * TURRET_SHOCKWAVE.popScale,
    });
    const launched = ofType(run(state, state.tick + ROLL), 'launched')[0];
    const spread = turretDraw(state, TURRET_STREAM.shockwaveThrow, 1, ms[0].id) * 2 - 1;
    const bearing = Math.atan2(launched.vx, launched.vz);
    expect(bearing).toBeCloseTo(spread * TURRET_WEAPON.deviation, 9);
  });
});

describe('charges and the rearm', () => {
  it('spends a charge per slam, rearms on its own clock and leaves the shell reload alone', () => {
    const { state } = field(kind('small', 5000), 1);
    expect(turretChargesLeft(state)).toEqual({ shockwave: 2, fragmentation: 0 });
    const ready = state.readyTick;
    slam(state);
    expect(state.readyTick).toBe(ready);
    expect(state.shockReadyTick).toBe(state.tick + TURRET_SHOCKWAVE.rearmTicks);
    expect(turretChargesLeft(state).shockwave).toBe(1);
    // The shell fires during the slam.
    expect(fireTurret(state, state.tick, 20, 0, flat).ok).toBe(true);
    run(state, state.shockReadyTick - 1);
    expect(startTurretShockwave(state, state.tick, flat)).toEqual({
      ok: false,
      reason: 'cooldown',
      events: [],
    });
    run(state, state.shockReadyTick);
    expect(startTurretShockwave(state, state.tick, flat).ok).toBe(true);
    expect(turretChargesLeft(state).shockwave).toBe(0);
    run(state, state.shockReadyTick + 5);
    const empty = startTurretShockwave(state, state.tick, flat);
    expect(empty).toEqual({ ok: false, reason: 'empty', events: [] });
    expect(state.stats.shockwaves).toBe(2);
  });

  it('counts no charge below zero, whatever the stats claim', () => {
    const base = { plan: { arsenal: { shockwave: 2, fragmentation: 3 } } };
    expect(
      turretChargesLeft({ ...base, stats: { shockwaves: 5, frags: 4, resupplies: 0 } }),
    ).toEqual({
      shockwave: 0,
      fragmentation: 0,
    });
    expect(
      turretChargesLeft({ ...base, stats: { shockwaves: 1, frags: 0, resupplies: 0 } }),
    ).toEqual({
      shockwave: 1,
      fragmentation: 3,
    });
  });

  it('refuses with no arsenal, and once the run has ended', () => {
    const none = field(kind('small', 5000), 1, 0).state;
    const rev = none.rev;
    expect(startTurretShockwave(none, none.tick, flat)).toMatchObject({
      ok: false,
      reason: 'empty',
    });
    expect(none.rev).toBe(rev);
    for (const phase of ['won', 'lost'] as const) {
      const { state } = field(kind('small', 5000), 1);
      state.phase = phase;
      expect(startTurretShockwave(state, state.tick, flat)).toMatchObject({
        ok: false,
        reason: 'ended',
      });
      expect(state.stats.shockwaves).toBe(0);
    }
  });

  it.each(['intro'] as const)(
    'refuses in the %s (D50), before the charges and the rearm, spending nothing',
    (phase) => {
      const { state } = field(kind('small', 5000), 1, 1);
      slam(state);
      state.phase = phase;
      const rev = state.rev;
      const ready = state.shockReadyTick;
      expect(startTurretShockwave(state, state.tick, flat)).toEqual({
        ok: false,
        reason: 'lull',
        events: [],
      });
      expect(state.rev).toBe(rev);
      expect(state.shockReadyTick).toBe(ready);
      expect(state.stats.shockwaves).toBe(1);
      state.phase = 'lost';
      expect(startTurretShockwave(state, state.tick, flat)).toMatchObject({ reason: 'ended' });
    },
  );

  it('keeps a lost run frozen: the ring in progress is dropped', () => {
    const state = createTurretDefense(plan(kind('huge', 5000), 1), { x: 0, z: 0 }, 7, START);
    run(state, INTRO_END);
    state.nextSpawnTick = HELD_BACK;
    const m = state.monsters[0];
    while (m.state !== 'windup') run(state, state.tick + 1);
    state.integrity = 1;
    const strike = Math.ceil(m.seg.end);
    run(state, strike - 1);
    // One tick in, the front has not reached a huge striker yet.
    expect(turretShockwaveFront(1)).toBeLessThan(
      TURRET_ARENA.breachRadius + TURRET_SIZE_CLASSES.huge.radius,
    );
    slam(state);
    const events = run(state, strike);
    expect(ofType(events, 'breach')).toHaveLength(1);
    expect(state.phase).toBe('lost');
    expect(state.shockwave).toBeNull();
    expect(run(state, strike + 20)).toEqual([]);
  });
});

describe('determinism', () => {
  it('replays a slam byte-identically, and round-trips through JSON mid-ring', () => {
    const scene = () => {
      const { state, ms } = field(kind('small', 5000), 3);
      ms.forEach((m, i) => {
        lay(state, m, 3 + i * 3, i);
      });
      slam(state);
      return state;
    };
    const a = scene();
    const b = scene();
    run(a, a.tick + 3);
    expect(a.shockwave?.struck.length).toBeGreaterThan(0);
    const copy = JSON.parse(JSON.stringify(a)) as TurretDefenseState;
    const later = a.tick + 40;
    const rest = run(a, later);
    expect(ofType(rest, 'shockwaveHit').length).toBeGreaterThan(0);
    expect(run(copy, later)).toEqual(rest);
    expect(copy).toEqual(a);
    run(b, later);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
