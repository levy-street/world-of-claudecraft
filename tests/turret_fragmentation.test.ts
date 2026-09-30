import { describe, expect, it } from 'vitest';
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import {
  TURRET_BOWLING,
  TURRET_FRAGMENTATION,
  TURRET_SIZE_CLASSES,
  TURRET_TIMING,
  TURRET_WEAPON,
} from '../src/sim/content/turret_defense';
import { blastFalloff, stillSegment, type ThrowProbe } from '../src/sim/minigames/thrown_body';
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
import { TURRET_STREAM } from '../src/sim/minigames/turret_defense_rng';
import {
  TURRET_BOMBLETS,
  turretBombletBlast,
  turretFragBomblets,
} from '../src/sim/minigames/turret_fragmentation';
import type { PrivateSalt, TurretSizeClass } from '../src/sim/types';

const flat: ThrowProbe = { ground: () => 0, water: () => null };
const tilted: ThrowProbe = { ground: (x, z) => 0.1 * x - 0.05 * z, water: () => null };
const START = 1000;
const INTRO_END = START + TURRET_TIMING.introTicks;
const HELD_BACK = Number.MAX_SAFE_INTEGER;
const CORE = 80;
const TAU = Math.PI * 2;
const NO_BARRELS = { count: 0, minRadius: 0, maxRadius: 0 };

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

function plan(k: TurretKind, count: number, fragmentation = 3): TurretPlan {
  return {
    scenarioId: 'test',
    integrity: 100,
    medals: TURRET_SCENARIO_STANDARD.medals,
    arsenal: { shockwave: 0, fragmentation },
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

interface Timed {
  tick: number;
  event: TurretEvent;
}

function runTimed(state: TurretDefenseState, toTick: number, probe = flat): Timed[] {
  const out: Timed[] = [];
  for (let t = state.tick + 1; t <= toTick; t++) {
    for (const event of tickTurretDefense(state, t, probe)) out.push({ tick: t, event });
  }
  return out;
}

function run(state: TurretDefenseState, toTick: number, probe = flat): TurretEvent[] {
  return runTimed(state, toTick, probe).map((e) => e.event);
}

function ofType<T extends TurretEvent['type']>(events: readonly TurretEvent[], type: T) {
  return events.filter((e): e is Extract<TurretEvent, { type: T }> => e.type === type);
}

function field(k: TurretKind, count: number, fragmentation = 3, seed = 7) {
  const state = createTurretDefense(plan(k, count, fragmentation), { x: 0, z: 0 }, seed, START);
  run(state, INTRO_END);
  while (state.spawnCursor < count) {
    state.nextSpawnTick = 0;
    run(state, state.tick + 1);
  }
  state.nextSpawnTick = HELD_BACK;
  for (const m of state.monsters) lay(state, m, 200 + m.id * 10, 200);
  return { state, ms: [...state.monsters] };
}

function lay(state: TurretDefenseState, m: TurretMonster, x: number, z: number): void {
  m.state = 'down';
  m.seg = stillSegment(state.tick, 100000, { x, y: 0, z });
}

function fireFrag(state: TurretDefenseState, x: number, z: number, probe = flat) {
  const out = fireTurret(state, state.tick, x, z, probe, 'frag');
  if (!out.ok) throw new Error(`refused: ${out.reason}`);
  return out;
}

describe('the star', () => {
  it.each([0, 0.7, Math.PI / 2, 2.5, -2, Math.PI])(
    'puts one bomblet on the point and five on a 4.5 yd circle, the first straight ahead (bearing %f)',
    (bearing) => {
      const dirX = Math.sin(bearing);
      const dirZ = Math.cos(bearing);
      const star = turretFragBomblets(10, -4, dirX, dirZ, 500);
      expect(star).toHaveLength(TURRET_BOMBLETS);
      expect(TURRET_BOMBLETS).toBe(6);
      expect(star.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(star[0]).toMatchObject({ x: 10, z: -4 });
      star.slice(1).forEach((b, i) => {
        expect(Math.hypot(b.x - 10, b.z + 4)).toBeCloseTo(TURRET_FRAGMENTATION.outerRadius, 9);
        const at = Math.atan2(b.x - 10, b.z + 4);
        // Clockwise seen from above: each one a fifth of a turn less than the one before.
        const want = bearing - (i * TAU) / 5;
        expect(Math.cos(at - want)).toBeCloseTo(1, 9);
      });
    },
  );

  it('lands the centre 0.2 s after the burst, then one outer bomblet a tick until 0.45 s', () => {
    const star = turretFragBomblets(0, 0, 0, 1, 300);
    expect(star.map((b) => b.landTick - 300)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('bursts into the same star whatever the seed or the salt: no draw anywhere', () => {
    const salt: PrivateSalt = [0xdeadbeef, 0x5eed1234];
    const runs: [number, PrivateSalt | undefined][] = [
      [7, undefined],
      [99, undefined],
      [7, salt],
    ];
    const stars = runs.map(([seed, withSalt]) => {
      const p = plan(kind('small', 5000), 1);
      const state = createTurretDefense(p, { x: 0, z: 0 }, seed, START, withSalt);
      run(state, INTRO_END);
      state.nextSpawnTick = HELD_BACK;
      const out = fireFrag(state, 15, -12);
      return ofType(run(state, out.ok ? out.shot.impactTick : 0), 'fragBurst')[0].bomblets;
    });
    expect(stars[1]).toEqual(stars[0]);
    expect(stars[2]).toEqual(stars[0]);
  });

  it('keeps its first values, so a tuning change is a deliberate edit here', () => {
    expect(TURRET_FRAGMENTATION).toEqual({
      burstHeight: 4,
      outerCount: 5,
      outerRadius: 4.5,
      centreDelayTicks: 4,
      outerDelayTicks: 5,
      blastRadius: 3.5,
      blastCore: 1,
      damageScale: 0.5,
      throwScale: 0.55,
    });
  });
});

describe('firing a frag shell', () => {
  it('flies and reloads like a shell, spends a charge and counts as a shot', () => {
    const { state } = field(kind('small', 5000), 1);
    const shell = fireTurret(state, state.tick, 25, 0, flat);
    expect(shell.ok && shell.events[0]).not.toHaveProperty('weapon');
    expect(shell.ok && shell.shot).not.toHaveProperty('weapon');
    run(state, state.readyTick);
    const out = fireFrag(state, 25, 0);
    expect(out.ok && out.shot.weapon).toBe('frag');
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({ type: 'fired', weapon: 'frag', x: 25, z: 0 });
    const fired = out.events[0] as Extract<TurretEvent, { type: 'fired' }>;
    const firedShell = (shell.ok ? shell.events[0] : null) as Extract<
      TurretEvent,
      { type: 'fired' }
    >;
    expect(fired.flightTicks).toBe(firedShell.flightTicks);
    expect(state.readyTick).toBe(state.tick + TURRET_WEAPON.cooldownTicks);
    expect(state.stats).toMatchObject({ shots: 2, frags: 1 });
    expect(turretChargesLeft(state).fragmentation).toBe(2);
  });

  it('refuses with no charge left (spending nothing), while reloading, and once the run has ended', () => {
    const { state } = field(kind('small', 5000), 1, 1);
    fireFrag(state, 20, 0);
    expect(fireTurret(state, state.tick, 20, 0, flat, 'frag')).toMatchObject({
      ok: false,
      reason: 'empty',
    });
    run(state, state.readyTick);
    const rev = state.rev;
    expect(fireTurret(state, state.tick, 20, 0, flat, 'frag')).toMatchObject({ reason: 'empty' });
    expect(state.rev).toBe(rev);
    expect(state.stats).toMatchObject({ shots: 1, frags: 1 });
    // A plain shell still fires.
    expect(fireTurret(state, state.tick, 20, 0, flat).ok).toBe(true);

    const reloading = field(kind('small', 5000), 1).state;
    fireTurret(reloading, reloading.tick, 20, 0, flat);
    expect(fireTurret(reloading, reloading.tick, 20, 0, flat, 'frag')).toMatchObject({
      reason: 'cooldown',
    });
    expect(turretChargesLeft(reloading).fragmentation).toBe(3);
    const ended = field(kind('small', 5000), 1).state;
    ended.phase = 'won';
    expect(fireTurret(ended, ended.tick, 20, 0, flat, 'frag')).toMatchObject({ reason: 'ended' });
    expect(fireTurret(ended, ended.tick, Number.NaN, 0, flat, 'frag')).toMatchObject({
      reason: 'ended',
    });
  });
});

describe('the burst and the bomblets', () => {
  it('bursts at the impact tick over the point, then blasts each bomblet on its tick', () => {
    const { state } = field(kind('small', 5000), 1);
    const out = fireFrag(state, 0, 20, tilted);
    const shot = out.ok ? out.shot : null;
    const timed = runTimed(state, shot!.impactTick + 12, tilted);
    expect(timed.filter((e) => e.event.type === 'impact')).toEqual([]);
    const burst = timed.filter((e) => e.event.type === 'fragBurst');
    expect(burst.map((e) => e.tick)).toEqual([shot!.impactTick]);
    const b = burst[0].event as Extract<TurretEvent, { type: 'fragBurst' }>;
    expect(b).toMatchObject({ shotId: shot!.id, x: 0, z: 20 });
    expect(b.y).toBeCloseTo(tilted.ground(0, 20) + TURRET_FRAGMENTATION.burstHeight, 9);
    const star = turretFragBomblets(0, 20, 0, 1, shot!.impactTick);
    expect(b.bomblets).toEqual(star.map((s) => ({ ...s, y: tilted.ground(s.x, s.z) })));
    const blasts = timed.filter((e) => e.event.type === 'bomblet');
    expect(blasts.map((e) => e.tick)).toEqual(star.map((s) => s.landTick));
    expect(blasts.map((e) => e.event)).toEqual(
      star.map((s) => ({
        type: 'bomblet',
        shotId: shot!.id,
        index: s.index,
        x: s.x,
        y: tilted.ground(s.x, s.z),
        z: s.z,
        hits: [],
      })),
    );
    expect(state.frags).toEqual([]);
    expect(state.shots).toEqual([]);
    // Every bomblet missed: the frag is a shot, never a hit.
    expect(state.stats).toMatchObject({ shots: 1, hits: 0, frags: 1 });
  });

  it("turns the star to the shot's bearing off both axes, its first bomblet beyond the point", () => {
    const { state } = field(kind('small', 5000), 1);
    const out = fireFrag(state, 15, -12);
    const shot = out.ok ? out.shot : null;
    expect(shot!.x).toBeCloseTo(15, 9);
    expect(shot!.z).toBeCloseTo(-12, 9);
    const burst = ofType(run(state, shot!.impactTick), 'fragBurst')[0];
    const bearing = Math.atan2(15, -12);
    const want = turretFragBomblets(15, -12, Math.sin(bearing), Math.cos(bearing), 0);
    expect(burst.bomblets).toHaveLength(want.length);
    burst.bomblets.forEach((spot, i) => {
      expect(spot.x).toBeCloseTo(want[i].x, 9);
      expect(spot.z).toBeCloseTo(want[i].z, 9);
    });
    expect(Math.hypot(burst.bomblets[1].x, burst.bomblets[1].z)).toBeCloseTo(
      Math.hypot(15, -12) + TURRET_FRAGMENTATION.outerRadius,
      9,
    );
  });

  it('hits with a small blast: half the core damage, a 3.5 yd reach and 0.55 of the throw', () => {
    const { state, ms } = field(kind('small', 5000), 2);
    lay(state, ms[0], 0, 20);
    lay(state, ms[1], 0, 20 + 4.5 + TURRET_FRAGMENTATION.blastRadius + 0.2);
    const out = fireFrag(state, 0, 20);
    const events = run(state, (out.ok ? out.shot.impactTick : 0) + 12);
    const blasts = ofType(events, 'bomblet');
    const centre = blasts.find((e) => e.index === 0)!;
    expect(centre.hits.map((h) => h.id)).toEqual([ms[0].id]);
    expect(centre.hits[0].damage).toBe(Math.round(CORE * TURRET_FRAGMENTATION.damageScale));
    expect(blasts.flatMap((e) => e.hits).some((h) => h.id === ms[1].id)).toBe(false);
    const launch = ofType(events, 'launched').find((e) => e.id === ms[0].id)!;
    expect(Math.hypot(launch.vx, launch.vz)).toBeCloseTo(
      TURRET_WEAPON.push * TURRET_FRAGMENTATION.throwScale,
      6,
    );
    expect(launch.vy).toBeCloseTo(TURRET_WEAPON.pop * TURRET_FRAGMENTATION.throwScale, 6);
    const blast = turretBombletBlast(
      { ...fragOf(out), landed: 0 },
      {
        index: 3,
        x: 1,
        z: 2,
        landTick: 0,
      },
    );
    expect(blast).toMatchObject({
      radius: TURRET_FRAGMENTATION.blastRadius,
      core: TURRET_FRAGMENTATION.blastCore,
      stream: TURRET_STREAM.bombletThrow,
    });
    expect(blastFalloff(TURRET_FRAGMENTATION.blastRadius, blast.radius, blast.core)).toBe(0);
  });

  it('juggles a body between two bomblets, and counts one hit for the whole frag', () => {
    const { state, ms } = field(kind('small', 5000), 1);
    // Between the centre and the bomblet straight ahead.
    lay(state, ms[0], 0, 22.2);
    const out = fireFrag(state, 0, 20);
    const events = run(state, (out.ok ? out.shot.impactTick : 0) + 12);
    const struck = ofType(events, 'bomblet').filter((e) => e.hits.length);
    expect(struck.map((e) => e.index)).toEqual([0, 1]);
    expect(ofType(events, 'launched').filter((e) => e.id === ms[0].id)).toHaveLength(2);
    expect(state.stats).toMatchObject({ shots: 1, hits: 1, frags: 1 });
  });

  it('counts its kills like any kill', () => {
    const { state, ms } = field(kind('small', 10), 2);
    lay(state, ms[0], 0, 20);
    lay(state, ms[1], 0, 24.5);
    const out = fireFrag(state, 0, 20);
    const events = run(state, (out.ok ? out.shot.impactTick : 0) + 12);
    expect(ofType(events, 'killed').map((e) => e.id)).toEqual([ms[0].id, ms[1].id]);
    expect(state.stats).toMatchObject({ kills: 2, hits: 1, shots: 1 });
  });

  it('lights every barrel a bomblet reaches, as a shell does', () => {
    const { state } = field(kind('small', 5000), 1);
    const reach = TURRET_FRAGMENTATION.blastRadius;
    const ahead = 20 + TURRET_FRAGMENTATION.outerRadius + reach;
    const near = { id: state.nextBarrelId++, x: 0, y: 0, z: ahead, litTick: -1, blowTick: -1 };
    const far = { id: state.nextBarrelId++, x: -20, y: 0, z: 20, litTick: -1, blowTick: -1 };
    state.barrels.push(near, far);
    const out = fireFrag(state, 0, 20);
    const impact = out.ok ? out.shot.impactTick : 0;
    const timed = runTimed(state, impact + 12);
    const lit = timed.filter((e) => e.event.type === 'barrelLit');
    expect(lit.map((e) => (e.event as { id: number }).id)).toEqual([near.id]);
    // Lit by the first outer bomblet (straight ahead, on the +z bearing), on its tick.
    expect(lit[0].tick).toBe(impact + TURRET_FRAGMENTATION.outerDelayTicks);
    expect(
      ofType(
        timed.map((e) => e.event),
        'barrelExploded',
      ).map((e) => e.id),
    ).toEqual([near.id]);
  });

  it('keeps a lost run frozen: bomblets still to land are dropped', () => {
    const state = createTurretDefense(plan(kind('huge', 5000), 1), { x: 0, z: 0 }, 7, START);
    run(state, INTRO_END);
    state.nextSpawnTick = HELD_BACK;
    const m = state.monsters[0];
    while (m.state !== 'windup') run(state, state.tick + 1);
    state.integrity = 1;
    const strike = Math.ceil(m.seg.end);
    run(state, strike - 6);
    const out = fireFrag(state, 30, 0);
    const burstAt = out.ok ? out.shot.impactTick : 0;
    expect(burstAt).toBeLessThan(strike);
    expect(burstAt + TURRET_FRAGMENTATION.centreDelayTicks).toBeGreaterThan(strike);
    run(state, strike);
    expect(state.phase).toBe('lost');
    expect(state.frags).toEqual([]);
    expect(ofType(run(state, strike + 20), 'bomblet')).toEqual([]);
  });

  it('replays byte-identically, and round-trips through JSON between two bomblets', () => {
    const scene = () => {
      const { state, ms } = field(kind('small', 5000), 3);
      ms.forEach((m, i) => {
        lay(state, m, i * 2 - 2, 21);
      });
      fireFrag(state, 0, 20);
      return state;
    };
    const a = scene();
    const b = scene();
    const mid = a.shots[0].impactTick + TURRET_FRAGMENTATION.outerDelayTicks + 1;
    run(a, mid);
    expect(a.frags[0].landed).toBeGreaterThan(1);
    const copy = JSON.parse(JSON.stringify(a)) as TurretDefenseState;
    const rest = run(a, mid + 40);
    expect(ofType(rest, 'bomblet').length).toBeGreaterThan(0);
    expect(run(copy, mid + 40)).toEqual(rest);
    expect(copy).toEqual(a);
    run(b, mid + 40);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

function fragOf(out: ReturnType<typeof fireFrag>) {
  const shot = out.ok ? out.shot : null;
  return {
    shotId: shot!.id,
    x: shot!.x,
    z: shot!.z,
    dirX: 0,
    dirZ: 1,
    damage: shot!.damage,
    burstTick: shot!.impactTick,
    hit: false,
  };
}
