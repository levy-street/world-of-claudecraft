import { describe, expect, it } from 'vitest';
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import {
  TURRET_ARENA,
  TURRET_BOWLING,
  TURRET_EXPLOSIVE_BARREL,
  TURRET_PHYSICS,
  TURRET_SIZE_CLASSES,
  TURRET_TIMING,
  TURRET_WEAPON,
} from '../src/sim/content/turret_defense';
import { fireAndFlyColliders } from '../src/sim/fire_and_fly_field';
import {
  horizontalAt,
  planFlight,
  planSkid,
  positionAt,
  stillSegment,
  type ThrowProbe,
  velocityAt,
} from '../src/sim/minigames/thrown_body';
import {
  lightTurretBarrel,
  placeTurretBarrels,
  sweepTurretBarrels,
  type TurretBarrel,
  turretFreeBearing,
  turretSpawnBearing,
} from '../src/sim/minigames/turret_barrels';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  type TurretEvent,
  type TurretMonster,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import {
  resolveTurretPlan,
  type TurretKind,
  type TurretPlan,
} from '../src/sim/minigames/turret_defense_plan';
import { TURRET_STREAM, turretDraw } from '../src/sim/minigames/turret_defense_rng';
import type { TurretBarrelWaveDef, TurretSizeClass } from '../src/sim/types';

const flat: ThrowProbe = { ground: () => 0, water: () => null };
const hills: ThrowProbe = {
  ground: (x, z) => 2 * Math.sin(x * 0.11) + 1.5 * Math.cos(z * 0.13) + 0.04 * x,
  water: () => null,
};
const START = 1000;
const INTRO_END = START + TURRET_TIMING.introTicks;
const HELD_BACK = Number.MAX_SAFE_INTEGER;
const TAU = Math.PI * 2;
const NO_BARRELS: TurretBarrelWaveDef = { count: 0, minRadius: 0, maxRadius: 0 };
const CORE = 60;
/** Where a barrel's collider meets a small body's: the two radii. */
const SMALL_REACH = TURRET_EXPLOSIVE_BARREL.radius + TURRET_SIZE_CLASSES.small.radius;

function kind(size: TurretSizeClass, maxHp: number, marchSpeed = 4.4): TurretKind {
  return {
    templateId: 'forest_wolf',
    level: 2,
    sizeClass: size,
    maxHp,
    marchSpeed,
    ...TURRET_SIZE_CLASSES[size],
  };
}

function plan(kinds: TurretKind[], spawns: number[][], barrels = NO_BARRELS): TurretPlan {
  return {
    scenarioId: 'test',
    integrity: 100,
    medals: TURRET_SCENARIO_STANDARD.medals,
    arsenal: { shockwave: 0, fragmentation: 0 },
    resupplyWaves: [],
    chargeBonus: false,
    kinds,
    waves: spawns.map((s) => ({
      spawns: s,
      coreDamage: CORE,
      gapMinTicks: 16,
      gapMaxTicks: 32,
      barrels,
      arrival: { kind: 'ring' },
    })),
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

function pin(
  state: TurretDefenseState,
  m: TurretMonster,
  x: number,
  z: number,
  pose: TurretMonster['state'] = 'down',
): void {
  m.state = pose;
  m.seg = stillSegment(state.tick, 100000, { x, y: 0, z });
}

/** A first wave under way with `count` bodies of `k` lying far off and no more to spawn. */
function field(k: TurretKind, count: number, seed = 7) {
  const state = createTurretDefense(
    plan([k], [Array.from({ length: count }, () => 0)]),
    { x: 0, z: 0 },
    seed,
    START,
  );
  run(state, INTRO_END);
  while (state.spawnCursor < count) {
    state.nextSpawnTick = 0;
    run(state, state.tick + 1);
  }
  state.nextSpawnTick = HELD_BACK;
  for (const m of state.monsters) pin(state, m, 200 + m.id * 10, 200);
  return { state, ms: [...state.monsters] };
}

function addBarrel(state: TurretDefenseState, x: number, z: number, y = 0): TurretBarrel {
  const barrel = { id: state.nextBarrelId++, x, y, z, litTick: -1, blowTick: -1 };
  state.barrels.push(barrel);
  return barrel;
}

/** The flat field with the standing barrels as colliders, as the engine sweeps them. */
function barrelProbe(state: TurretDefenseState): ThrowProbe {
  return {
    ...flat,
    sweep: (fx, fz, tx, tz, radius, fromY, toY) =>
      sweepTurretBarrels(state.barrels, fx, fz, tx, tz, radius, fromY, toY) ?? {
        x: tx,
        z: tz,
        blocked: false,
      },
  };
}

function fireAt(state: TurretDefenseState, x: number, z: number, probe = flat) {
  const out = fireTurret(state, state.tick, x, z, probe);
  if (!out.ok) throw new Error(`refused: ${out.reason}`);
  return out.shot;
}

function ofType<T extends TurretEvent['type']>(events: TurretEvent[], type: T) {
  return events.filter((e): e is Extract<TurretEvent, { type: T }> => e.type === type);
}

function stateOf(m: TurretMonster): TurretMonster['state'] {
  return m.state;
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

function fullRun(seed: number, probe: ThrowProbe, maxTicks = 20 * 60 * 15) {
  const state = createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, seed, START);
  const trace: string[] = [];
  /** Each monster's spawn point, in spawn order. */
  const spawns: string[] = [];
  const seen = new Set<number>();
  let spawnsBesideBarrels = 0;
  let standingMost = 0;
  let t = START;
  while (t < START + maxTicks && state.phase !== 'won' && state.phase !== 'lost') {
    t++;
    for (const e of tickTurretDefense(state, t, probe)) trace.push(JSON.stringify(e));
    standingMost = Math.max(standingMost, state.barrels.length);
    for (const m of state.monsters) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      spawns.push(JSON.stringify({ id: m.id, x: m.seg.x, z: m.seg.z }));
      if (state.barrels.length) spawnsBesideBarrels++;
    }
    if (t >= state.readyTick) {
      const target = nearestLive(state, t, probe);
      if (target) {
        const out = fireTurret(state, t, target.x, target.z, probe);
        for (const e of out.events) trace.push(JSON.stringify(e));
      }
    }
  }
  const events = trace.map((s) => JSON.parse(s) as TurretEvent);
  return { state, trace, events, spawns, spawnsBesideBarrels, ticks: t - START, standingMost };
}

const ENDED_LATER = new Set(['medal', 'points', 'breakdown']);
const WEAPON_STATS = new Set(['shockwaves', 'frags', 'resupplies']);

/** Drops what the engine gained after these digests: the end's medal and points, and the
 *  limited-weapon stats while they stay 0 (these runs spend no charge; a spent one shows). */
function dropResultFields(this: object, key: string, value: unknown): unknown {
  if ((this as { type?: string }).type === 'ended' && ENDED_LATER.has(key)) return undefined;
  return 'barrelKills' in this && WEAPON_STATS.has(key) && value === 0 ? undefined : value;
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('placement', () => {
  it("places the first wave's barrels at its start, on the ring, spread around and spaced", () => {
    const p = resolveTurretPlan();
    const state = createTurretDefense(p, { x: 5, z: -3 }, 11, START);
    expect(run(state, INTRO_END - 1)).toEqual([]);
    const events = run(state, INTRO_END);
    expect(events.map((e) => e.type).slice(0, 2)).toEqual(['waveStart', 'barrelsPlaced']);
    const placed = ofType(events, 'barrelsPlaced');
    expect(placed).toHaveLength(1);
    const def = p.waves[0].barrels;
    expect(placed[0].barrels).toHaveLength(def.count);
    expect(state.barrels.map(({ id, x, y, z }) => ({ id, x, y, z }))).toEqual(placed[0].barrels);
    const bearings: number[] = [];
    for (const b of state.barrels) {
      expect(b).toMatchObject({ y: 0, litTick: -1, blowTick: -1 });
      const d = Math.hypot(b.x - 5, b.z + 3);
      expect(d).toBeGreaterThanOrEqual(def.minRadius);
      expect(d).toBeLessThanOrEqual(def.maxRadius);
      bearings.push(((Math.atan2(b.x - 5, b.z + 3) % TAU) + TAU) % TAU);
    }
    for (const a of state.barrels) {
      for (const b of state.barrels) {
        if (a !== b) {
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(
            TURRET_EXPLOSIVE_BARREL.minSpacing,
          );
        }
      }
    }
    // Each wanders at most bearingJitter of its third of the circle from the middle of it.
    bearings.sort((a, b) => a - b);
    const gaps = bearings.map((b, i) => (i ? b - bearings[i - 1] : b + TAU - bearings[2]));
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(
        (1 - 2 * TURRET_EXPLOSIVE_BARREL.bearingJitter) * (TAU / 3) - 1e-9,
      );
    }
  });

  it('keeps the intact barrels into the next wave and never passes the cap', () => {
    const p = resolveTurretPlan();
    const state = createTurretDefense(p, { x: 0, z: 0 }, 5, START);
    const place = (wave: number) => {
      state.wave = wave;
      return placeTurretBarrels(state, p.waves[wave].barrels, START, flat);
    };
    expect(p.waves.map((w) => w.barrels.count)).toEqual([3, 3, 4, 4, 5, 5]);
    expect(TURRET_EXPLOSIVE_BARREL.cap).toBe(6);
    const first = place(0);
    expect(first).toHaveLength(3);
    const second = place(1);
    expect(second).toHaveLength(3);
    expect(state.barrels).toEqual([...first, ...second]);
    expect(state.barrels[0]).toBe(first[0]);
    expect(place(2)).toEqual([]);
    state.barrels = state.barrels.filter((b) => b !== first[1] && b !== second[2]);
    const third = place(3);
    expect(third).toHaveLength(2);
    expect(state.barrels).toHaveLength(TURRET_EXPLOSIVE_BARREL.cap);
    expect(new Set(state.barrels.map((b) => b.id)).size).toBe(TURRET_EXPLOSIVE_BARREL.cap);
    expect(third.map((b) => b.id)).toEqual([7, 8]);
  });

  it('draws from the session seed and the wave: the same inputs place the same barrels', () => {
    const p = resolveTurretPlan();
    const spots = (seed: number, wave: number) => {
      const state = createTurretDefense(p, { x: 0, z: 0 }, seed, START);
      state.wave = wave;
      return placeTurretBarrels(state, p.waves[wave].barrels, START, flat);
    };
    expect(spots(3, 0)).toEqual(spots(3, 0));
    expect(spots(3, 0)).not.toEqual(spots(4, 0));
    expect(spots(3, 0)).not.toEqual(spots(3, 1).slice(0, 3));
  });

  it('leaves out a barrel that finds no clear spot in its draws', () => {
    const state = createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 9, START);
    const placed = placeTurretBarrels(state, { count: 6, minRadius: 4, maxRadius: 4 }, START, flat);
    // A 4 yd ring holds no more than four barrels 6 yd apart.
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.length).toBeLessThanOrEqual(4);
    for (const a of placed) {
      for (const b of placed) {
        if (a !== b) {
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(
            TURRET_EXPLOSIVE_BARREL.minSpacing,
          );
        }
      }
    }
  });

  it('never stands a barrel in water, and reads a surface under the ground as dry', () => {
    const p = resolveTurretPlan();
    const place = (seed: number, wave: number, probe: ThrowProbe) => {
      const state = createTurretDefense(p, { x: 0, z: 0 }, seed, START);
      state.wave = wave;
      return placeTurretBarrels(state, p.waves[wave].barrels, START, probe);
    };
    const pond: ThrowProbe = { ground: () => 0, water: (x) => (x > 0 ? 0.6 : null) };
    const sunk: ThrowProbe = { ground: () => 0, water: () => -5 };
    let wouldWade = 0;
    for (let seed = 1; seed <= 8; seed++) {
      for (let wave = 0; wave < p.waves.length; wave++) {
        const dry = place(seed, wave, flat);
        wouldWade += dry.filter((b) => b.x > 0).length;
        for (const b of place(seed, wave, pond)) expect(b.x).toBeLessThanOrEqual(0);
        expect(place(seed, wave, sunk)).toEqual(dry);
      }
    }
    expect(wouldWade).toBeGreaterThan(0);
  });

  it("keeps every wave's ring clear of the arena: off the tower, inside the spawn ring, short of every collider", () => {
    const [tower, ...rest] = fireAndFlyColliders(0);
    expect(tower).toMatchObject({ type: 'circle', x: 0, z: 0 });
    const widest = Math.max(...Object.values(TURRET_SIZE_CLASSES).map((s) => s.radius));
    for (const { barrels } of resolveTurretPlan().waves) {
      expect(barrels.minRadius - TURRET_EXPLOSIVE_BARREL.radius).toBeGreaterThan(
        tower.type === 'circle' ? tower.r : Number.POSITIVE_INFINITY,
      );
      expect(barrels.maxRadius + TURRET_EXPLOSIVE_BARREL.radius + widest).toBeLessThan(
        TURRET_ARENA.spawnRadius,
      );
      for (const c of rest) {
        const reach = c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd);
        expect(Math.hypot(c.x, c.z) - reach).toBeGreaterThan(
          barrels.maxRadius + TURRET_EXPLOSIVE_BARREL.radius,
        );
      }
    }
  });

  it('keeps clear of a body still on the field', () => {
    const def = { count: 3, minRadius: 16, maxRadius: 30 };
    const bare = field(kind('small', 100), 1, 13);
    bare.state.wave = 1;
    const where = placeTurretBarrels(bare.state, def, bare.state.tick, flat)[0];
    const { state, ms } = field(kind('small', 100), 1, 13);
    pin(state, ms[0], where.x, where.z, 'dead');
    ms[0].hp = 0;
    state.wave = 1;
    const placed = placeTurretBarrels(state, def, state.tick, flat);
    const room =
      TURRET_EXPLOSIVE_BARREL.radius +
      TURRET_SIZE_CLASSES.small.radius +
      TURRET_EXPLOSIVE_BARREL.laneMargin;
    for (const b of placed) {
      expect(Math.hypot(b.x - where.x, b.z - where.z)).toBeGreaterThanOrEqual(room);
    }
    expect(placed[0]).not.toEqual(where);
  });
});

describe('spawn lanes', () => {
  it('maps a draw onto the free bearings only, in order, across the wrap', () => {
    for (const u of [0, 0.3, 0.999]) expect(turretFreeBearing(u, [])).toBe(u * TAU);
    const arcs = [
      { center: 0.1, half: 0.3 },
      { center: 2, half: 0.25 },
      { center: 2.3, half: 0.25 },
    ];
    let last = -1;
    for (let i = 0; i < 1000; i++) {
      const b = turretFreeBearing(i / 1000, arcs);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(TAU);
      expect(b).toBeGreaterThan(last);
      last = b;
      for (const arc of arcs) {
        const off = Math.abs(((b - arc.center + 3 * Math.PI) % TAU) - Math.PI);
        expect(off).toBeGreaterThanOrEqual(arc.half - 1e-9);
      }
    }
    // Uniform over what is free: the first arc wraps (5.9833 to 0.4), the other two merge (1.75 to 2.55).
    const free = TAU - 0.6 - 0.8;
    expect(turretFreeBearing(0, arcs)).toBeCloseTo(0.4, 12);
    expect(turretFreeBearing(1.45 / free, arcs)).toBeCloseTo(2.65, 12);
    expect(turretFreeBearing(0.5, [{ center: 1, half: Math.PI }])).toBe(0.5 * TAU);
  });

  it('still steers around the other barrels when one stands inside the lane reach', () => {
    const state = createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 3, START);
    const bodyRadius = TURRET_SIZE_CLASSES.small.radius;
    const reach = TURRET_EXPLOSIVE_BARREL.radius + bodyRadius + TURRET_EXPLOSIVE_BARREL.laneMargin;
    addBarrel(state, 0, reach * 0.5);
    const outer = addBarrel(state, 20, 0);
    const half = Math.asin(reach / 20);
    for (let i = 0; i < 200; i++) {
      const bearing = turretSpawnBearing(state, i / 200, bodyRadius);
      const off = Math.abs(
        ((bearing - Math.atan2(outer.x, outer.z) + 3 * Math.PI) % TAU) - Math.PI,
      );
      expect(off).toBeGreaterThanOrEqual(half - 1e-9);
    }
  });

  it('sends every marcher down a lane clear of every barrel', () => {
    let rawWouldBrush = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const p = resolveTurretPlan();
      const state = createTurretDefense(p, { x: 0, z: 0 }, seed, START);
      const seen = new Set<number>();
      for (let t = START + 1; t <= INTRO_END + 20 * 20; t++) {
        tickTurretDefense(state, t, flat);
        if (state.wave > 0) break;
        for (const m of state.monsters) {
          if (seen.has(m.id) || m.seg.kind !== 'march') continue;
          seen.add(m.id);
          const reach =
            TURRET_EXPLOSIVE_BARREL.radius +
            p.kinds[m.kind].radius +
            TURRET_EXPLOSIVE_BARREL.laneMargin -
            1e-9;
          const { x, z, dx, dz } = m.seg;
          for (const b of state.barrels) {
            const along = (b.x - x) * dx + (b.z - z) * dz;
            const side = Math.abs((b.x - x) * dz - (b.z - z) * dx);
            if (along > 0 && along < Math.hypot(x, z)) expect(side).toBeGreaterThanOrEqual(reach);
            // The bearing the same draw gives with no lanes at all.
            const raw = turretDraw(state, TURRET_STREAM.spawnAngle, m.id) * TAU;
            const bearing = Math.atan2(b.x, b.z);
            const off = Math.abs(((raw - bearing + 3 * Math.PI) % TAU) - Math.PI);
            if (off < Math.asin(reach / Math.hypot(b.x, b.z))) rawWouldBrush++;
          }
        }
      }
      expect(seen.size).toBe(p.waves[0].spawns.length);
    }
    expect(rawWouldBrush).toBeGreaterThan(0);
  });
});

describe('what lights a barrel', () => {
  it('a shell blast reaching it at the rim, at any falloff, and none just past it', () => {
    const { state } = field(kind('small', 1000), 1);
    const reach = TURRET_WEAPON.blastRadius + TURRET_EXPLOSIVE_BARREL.radius;
    const inside = addBarrel(state, 0, 20 + reach - 0.01);
    const outside = addBarrel(state, -(reach + 0.01), 20);
    const shot = fireAt(state, 0, 20);
    const events = runTimed(state, shot.impactTick);
    const lit = events.filter((e) => e.event.type === 'barrelLit');
    expect(lit).toEqual([
      {
        tick: shot.impactTick,
        event: {
          type: 'barrelLit',
          id: inside.id,
          x: inside.x,
          y: 0,
          z: inside.z,
          fuseTicks: TURRET_EXPLOSIVE_BARREL.fuseTicks,
        },
      },
    ]);
    expect(TURRET_EXPLOSIVE_BARREL.fuseTicks).toBe(5);
    expect(inside).toMatchObject({
      litTick: shot.impactTick,
      blowTick: shot.impactTick + TURRET_EXPLOSIVE_BARREL.fuseTicks,
    });
    expect(outside).toMatchObject({ litTick: -1, blowTick: -1 });
  });

  it('blows when its fuse runs out, off the field, exactly once', () => {
    const { state } = field(kind('small', 1000), 1);
    const barrel = addBarrel(state, 0, 20);
    lightTurretBarrel(state, barrel, state.tick, []);
    expect(ofType(run(state, barrel.blowTick - 1), 'barrelExploded')).toEqual([]);
    expect(state.barrels).toContain(barrel);
    const rev = state.rev;
    const events = run(state, barrel.blowTick);
    expect(ofType(events, 'barrelExploded')).toEqual([
      { type: 'barrelExploded', id: barrel.id, x: 0, y: 0, z: 20, hits: [] },
    ]);
    expect(state.rev).toBeGreaterThan(rev);
    expect(state.barrels).toEqual([]);
    expect(state.stats.barrelsDetonated).toBe(1);
    expect(ofType(run(state, state.tick + 100), 'barrelExploded')).toEqual([]);
  });

  it('chains: each blast lights the barrels it reaches, and each blows after its own fuse', () => {
    const { state } = field(kind('small', 1000), 1);
    const reach = TURRET_EXPLOSIVE_BARREL.blastRadius + TURRET_EXPLOSIVE_BARREL.radius;
    const a = addBarrel(state, 0, 20);
    const b = addBarrel(state, 0, 20 + reach - 0.1);
    const c = addBarrel(state, 0, 20 + 2 * (reach - 0.1));
    const far = addBarrel(state, 0, 20 + 3 * (reach - 0.1) + 0.2);
    const shot = fireAt(state, 0, 20 - TURRET_WEAPON.blastRadius);
    const fuse = TURRET_EXPLOSIVE_BARREL.fuseTicks;
    const events = runTimed(state, shot.impactTick + 6 * fuse);
    const at = (type: TurretEvent['type']) =>
      events
        .filter((e) => e.event.type === type)
        .map((e) => [(e.event as { id: number }).id, e.tick - shot.impactTick]);
    expect(at('barrelLit')).toEqual([
      [a.id, 0],
      [b.id, fuse],
      [c.id, 2 * fuse],
    ]);
    expect(at('barrelExploded')).toEqual([
      [a.id, fuse],
      [b.id, 2 * fuse],
      [c.id, 3 * fuse],
    ]);
    expect(state.barrels).toEqual([far]);
    expect(far.litTick).toBe(-1);
    expect(state.stats.barrelsDetonated).toBe(3);
  });

  it('lights once and blows once when two blasts reach it on the same tick', () => {
    const { state } = field(kind('small', 1000), 1);
    const a = addBarrel(state, -3, 20);
    const b = addBarrel(state, 3, 20);
    const c = addBarrel(state, 0, 28);
    const shot = fireAt(state, 0, 20);
    const events = runTimed(state, shot.impactTick + 4 * TURRET_EXPLOSIVE_BARREL.fuseTicks);
    const lit = events.filter((e) => e.event.type === 'barrelLit');
    expect(lit.map((e) => (e.event as { id: number }).id)).toEqual([a.id, b.id, c.id]);
    const blown = events.filter((e) => e.event.type === 'barrelExploded');
    expect(blown.map((e) => [(e.event as { id: number }).id, e.tick - shot.impactTick])).toEqual([
      [a.id, 5],
      [b.id, 5],
      [c.id, 10],
    ]);
  });

  it('a body sliding into it faster than the bowling minimum lights it; a slower one only stops', () => {
    for (const [speed, lights] of [
      [10, true],
      [7.5, false],
    ] as const) {
      const { state, ms } = field(kind('small', 1000), 1);
      const m = ms[0];
      const barrel = addBarrel(state, 0, 20);
      const probe = barrelProbe(state);
      m.state = 'skid';
      const seg = planSkid(
        state.tick,
        0,
        0,
        20 - SMALL_REACH - 1,
        0,
        speed,
        0.6,
        probe,
        TURRET_PHYSICS,
      );
      if (!seg) throw new Error('no slide');
      expect(seg.contact).toBe('wall');
      m.seg = seg;
      const contact = Math.hypot(velocityAt(seg, seg.end).x, velocityAt(seg, seg.end).z);
      expect(contact > state.plan.bowling.minSpeed).toBe(lights);
      const events = run(state, Math.ceil(seg.end));
      expect(ofType(events, 'barrelLit')).toHaveLength(lights ? 1 : 0);
      expect(barrel.litTick >= 0).toBe(lights);
      expect(stateOf(m)).toBe('down');
      expect(Math.hypot(positionAt(m.seg, state.tick, flat).z - 20)).toBeGreaterThan(
        SMALL_REACH - 0.05,
      );
    }
  });

  it('a thrown body the engine lands short of it slides into it: the barrel stops it and lights', () => {
    const { state, ms } = field(kind('small', 1000), 1);
    const m = ms[0];
    const barrel = addBarrel(state, 0, 20);
    // A flat, low flight that lands too softly to bounce, 1 yd short of the barrel at 11 yd/s.
    const drop = Math.sqrt((2 * 0.2) / TURRET_PHYSICS.gravity);
    m.state = 'fly';
    m.seg = planFlight(
      state.tick,
      0,
      0.2,
      20 - SMALL_REACH - 1 - 11 * drop,
      { x: 0, y: 0, z: 11 },
      0.6,
      flat,
      TURRET_PHYSICS,
    );
    expect(m.seg.kind === 'fly' && m.seg.contact).toBe('ground');
    const events = run(state, state.tick + 30);
    expect(ofType(events, 'landed')).toHaveLength(1);
    expect(ofType(events, 'barrelLit').map((e) => e.id)).toEqual([barrel.id]);
    const rest = positionAt(m.seg, state.tick, flat);
    expect(rest.z).toBeLessThan(20 - SMALL_REACH + 0.05);
  });

  it('a low flight into it bounces off it and lights it', () => {
    const { state, ms } = field(kind('small', 1000), 1);
    const m = ms[0];
    const barrel = addBarrel(state, 0, 20);
    m.state = 'fly';
    m.seg = planFlight(
      state.tick,
      0,
      0.2,
      20 - SMALL_REACH - 2,
      { x: 0, y: 3, z: 12 },
      0.6,
      barrelProbe(state),
      TURRET_PHYSICS,
    );
    expect(m.seg.kind === 'fly' && m.seg.contact).toBe('wall');
    const events = run(state, Math.ceil(m.seg.end));
    const bounce = ofType(events, 'bounce');
    expect(bounce).toHaveLength(1);
    expect(bounce[0]).toMatchObject({ id: m.id, surface: 'wall' });
    expect(ofType(events, 'barrelLit').map((e) => e.id)).toEqual([barrel.id]);
    expect(velocityAt(m.seg, m.seg.start).z).toBeLessThan(0);
  });

  it('a body flying over it never touches it', () => {
    const { state, ms } = field(kind('small', 1000), 1);
    const m = ms[0];
    const barrel = addBarrel(state, 0, 20);
    m.state = 'fly';
    m.seg = planFlight(
      state.tick,
      0,
      0,
      12,
      { x: 0, y: 14, z: 12 },
      0.6,
      barrelProbe(state),
      TURRET_PHYSICS,
    );
    expect(m.seg.kind === 'fly' && m.seg.contact).toBe('ground');
    expect(horizontalAt(m.seg, m.seg.end).z).toBeGreaterThan(20 + SMALL_REACH);
    run(state, state.tick + 60);
    expect(barrel.litTick).toBe(-1);
  });
});

describe('the barrel blast', () => {
  it("hits on the shell's falloff curve, wider and twice as hard, and throws past a graze", () => {
    const { state, ms } = field(kind('small', 100000), 4);
    const barrel = addBarrel(state, 0, 20);
    const offsets = [1, 5.75, 8.5, 9.5];
    ms.forEach((m, i) => {
      pin(state, m, offsets[i], 20);
    });
    const graze = ms[2].seg;
    lightTurretBarrel(state, barrel, state.tick, []);
    const events = run(state, barrel.blowTick);
    const [blast] = ofType(events, 'barrelExploded');
    const core = CORE * TURRET_EXPLOSIVE_BARREL.damageScale;
    const rimFalloff =
      1 - (8.5 - TURRET_EXPLOSIVE_BARREL.blastCore) / (9 - TURRET_EXPLOSIVE_BARREL.blastCore);
    expect(TURRET_EXPLOSIVE_BARREL.blastRadius).toBe(9);
    expect(blast.hits.map((h) => [h.id, h.falloff, h.damage])).toEqual([
      [ms[0].id, 1, core],
      [ms[1].id, 0.5, core / 2],
      [ms[2].id, rimFalloff, Math.round(core * rimFalloff)],
    ]);
    expect(blast.hits[0]).toMatchObject({ x: 1, y: 0, z: 20 });
    expect(ofType(events, 'launched').map((e) => e.id)).toEqual([ms[0].id, ms[1].id]);
    expect(ms[2].seg).toBe(graze);
    expect(ms[3].hp).toBe(100000);
    expect(events.findIndex((e) => e.type === 'barrelExploded')).toBeLessThan(
      events.findIndex((e) => e.type === 'launched'),
    );
  });

  it("throws a body harder and further than a shell's core hit", () => {
    const throwOf = (by: 'shell' | 'barrel') => {
      const { state, ms } = field(kind('small', 100000), 1);
      const m = ms[0];
      pin(state, m, 0, 20.5);
      let events: TurretEvent[];
      if (by === 'shell') {
        const shot = fireAt(state, 0, 20);
        events = run(state, shot.impactTick);
      } else {
        const barrel = addBarrel(state, 0, 20);
        lightTurretBarrel(state, barrel, state.tick, []);
        events = run(state, barrel.blowTick);
      }
      const [launch] = ofType(events, 'launched');
      const landed = run(state, state.tick + 200).find(
        (e) => (e.type === 'bounce' || e.type === 'landed') && e.id === m.id,
      ) as { x: number; z: number };
      return {
        across: Math.hypot(launch.vx, launch.vz),
        up: launch.vy,
        distance: Math.hypot(landed.x - launch.x, landed.z - launch.z),
      };
    };
    const shell = throwOf('shell');
    const barrel = throwOf('barrel');
    expect(shell.across).toBeCloseTo(TURRET_WEAPON.push, 9);
    expect(barrel.across).toBeCloseTo(TURRET_WEAPON.push * TURRET_EXPLOSIVE_BARREL.throwScale, 9);
    expect(barrel.up).toBeCloseTo(
      Math.min(TURRET_WEAPON.pop * TURRET_EXPLOSIVE_BARREL.throwScale, TURRET_WEAPON.maxLaunchLift),
      9,
    );
    expect(barrel.up).toBeGreaterThan(shell.up);
    expect(barrel.distance).toBeGreaterThan(shell.distance * 1.3);
  });

  it('counts its kills as barrel kills, and a shell kill as none', () => {
    const { state, ms } = field(kind('small', 50), 2);
    const barrel = addBarrel(state, 40, 40);
    pin(state, ms[0], 40, 41);
    pin(state, ms[1], 0, 20);
    lightTurretBarrel(state, barrel, state.tick, []);
    const events = run(state, barrel.blowTick);
    expect(ofType(events, 'killed').map((e) => e.id)).toEqual([ms[0].id]);
    expect(state.stats).toMatchObject({ kills: 1, barrelKills: 1, barrelsDetonated: 1 });
    const shot = fireAt(state, 0, 20);
    run(state, shot.impactTick);
    expect(state.stats).toMatchObject({ kills: 2, barrelKills: 1 });
  });

  it('never moves a corpse on the ground and never touches the tower', () => {
    const { state, ms } = field(kind('small', 100), 1);
    const z = TURRET_ARENA.turretRadius + TURRET_EXPLOSIVE_BARREL.radius + 0.2;
    const barrel = addBarrel(state, 0, z);
    const corpse = ms[0];
    pin(state, corpse, 1, z, 'dead');
    corpse.hp = 0;
    const lying = corpse.seg;
    lightTurretBarrel(state, barrel, state.tick, []);
    const events = run(state, barrel.blowTick);
    expect(ofType(events, 'barrelExploded')[0].hits).toEqual([]);
    expect(corpse.seg).toBe(lying);
    expect(state.integrity).toBe(state.plan.integrity);
    expect(ofType(events, 'breach')).toEqual([]);
  });

  it('lets a flight planned into it fly on through where it stood once it blows', () => {
    const { state, ms } = field(kind('small', 100000), 1);
    const m = ms[0];
    const barrel = addBarrel(state, 0, 20);
    lightTurretBarrel(state, barrel, state.tick, []);
    const fuseSeconds = TURRET_EXPLOSIVE_BARREL.fuseTicks / 20;
    // Out of launch reach when it blows (a graze), and still on its way into the barrel.
    m.state = 'fly';
    m.seg = planFlight(
      state.tick,
      0,
      0,
      20 - 8.05 - 9 * fuseSeconds,
      { x: 0, y: 16, z: 9 },
      0.6,
      barrelProbe(state),
      TURRET_PHYSICS,
    );
    expect(m.seg.kind === 'fly' && m.seg.contact).toBe('wall');
    const events = run(state, barrel.blowTick);
    const [blast] = ofType(events, 'barrelExploded');
    expect(blast.hits.map((h) => h.id)).toEqual([m.id]);
    expect(blast.hits[0].falloff).toBeLessThan(TURRET_WEAPON.grazeFalloff);
    expect(ofType(events, 'launched')).toEqual([]);
    expect(m.seg.start).toBe(barrel.blowTick);
    expect(m.seg.kind === 'fly' && m.seg.contact).toBe('ground');
    const after = run(state, state.tick + 60);
    expect(ofType(after, 'bounce').filter((e) => e.surface === 'wall')).toEqual([]);
    const first = after.find((e) => e.type === 'bounce' || e.type === 'landed') as { z: number };
    expect(first.z).toBeGreaterThan(20 - SMALL_REACH);
  });

  it('lets a body a shell launches on the tick it blows fly on through where it stood', () => {
    const setup = () => {
      const { state, ms } = field(kind('small', 100000), 1);
      pin(state, ms[0], 0, 20.5);
      return { state, m: ms[0] };
    };
    // The core hit's throw with nothing in its way, then a barrel just past where it lands.
    const dry = setup();
    const firedAt = dry.state.tick;
    const dryShot = fireAt(dry.state, 0, 20);
    const flightTicks = dryShot.impactTick - firedAt;
    run(dry.state, dryShot.impactTick);
    const free = dry.m.seg;
    if (free.kind !== 'fly') throw new Error('no throw');
    expect(free.contact).toBe('ground');
    const land = horizontalAt(free, free.end);
    const v = velocityAt(free, free.start);
    const across = Math.hypot(v.x, v.z);
    const spot = { x: land.x + (v.x / across) * 0.5, z: land.z + (v.z / across) * 0.5 };
    expect(Math.hypot(spot.x, spot.z - 20.5)).toBeGreaterThan(
      TURRET_EXPLOSIVE_BARREL.blastRadius + 1,
    );

    const shoot = (lit: boolean) => {
      const { state, m } = setup();
      const barrel = addBarrel(state, spot.x, spot.z);
      const fireTick = state.tick + TURRET_EXPLOSIVE_BARREL.fuseTicks;
      if (lit) {
        run(state, fireTick + flightTicks - TURRET_EXPLOSIVE_BARREL.fuseTicks);
        lightTurretBarrel(state, barrel, state.tick, []);
      }
      run(state, fireTick);
      const shot = fireAt(state, 0, 20);
      if (lit) expect(shot.impactTick).toBe(barrel.blowTick);
      const events = run(state, shot.impactTick);
      return { state, m, barrel, shot, events };
    };
    // Standing, the barrel stops that very throw.
    const standing = shoot(false);
    expect(standing.m.seg.kind === 'fly' && standing.m.seg.contact).toBe('wall');

    const { state, m, shot, events } = shoot(true);
    expect(ofType(events, 'launched').map((e) => e.id)).toEqual([m.id]);
    const [blast] = ofType(events, 'barrelExploded');
    expect(blast.hits).toEqual([]);
    expect(m.seg.start).toBe(shot.impactTick);
    expect(m.seg.kind === 'fly' && m.seg.contact).toBe('ground');
    const after = run(state, state.tick + 60);
    expect(ofType(after, 'bounce').filter((e) => e.surface === 'wall')).toEqual([]);
  });

  it('still blows a barrel lit at the win, counting nothing past the final stats', () => {
    const { state, ms } = field(kind('small', 50), 1);
    pin(state, ms[0], 0, 20);
    const barrel = addBarrel(state, 3, 20);
    const shot = fireAt(state, 0, 20);
    const [ended] = ofType(run(state, shot.impactTick), 'ended');
    expect(ended).toMatchObject({ result: 'won' });
    expect(barrel.blowTick).toBeGreaterThan(shot.impactTick);
    const after = run(state, barrel.blowTick);
    expect(ofType(after, 'barrelExploded').map((e) => e.id)).toEqual([barrel.id]);
    expect(state.stats).toEqual(ended.stats);
  });

  it('never blows once the session is lost', () => {
    const big = kind('large', 400);
    const state = createTurretDefense(plan([big], [[0, 0]]), { x: 0, z: 0 }, 7, START);
    run(state, INTRO_END);
    state.nextSpawnTick = HELD_BACK;
    const m = state.monsters[0];
    while (m.state !== 'windup') run(state, state.tick + 1);
    state.integrity = 3;
    const barrel = addBarrel(state, 30, 30);
    const strike = Math.ceil(m.seg.end);
    run(state, strike - 2);
    lightTurretBarrel(state, barrel, state.tick, []);
    const events = run(state, state.tick + 40);
    expect(state.phase).toBe('lost');
    expect(ofType(events, 'barrelExploded')).toEqual([]);
    expect(state.barrels).toEqual([barrel]);
  });
});

describe('full runs with barrels', () => {
  it.each([
    [42, 'flat', flat],
    [21, 'hills', hills],
    [7, 'flat', flat],
  ] as const)(
    'the auto-aimer still wins (seed %i, %s), blowing barrels on the way',
    (seed, _n, probe) => {
      const r = fullRun(seed, probe);
      expect(r.state.phase).toBe('won');
      expect(r.ticks).toBeLessThan(20 * 60 * 6);
      const placed = ofType(r.events, 'barrelsPlaced').flatMap((e) => e.barrels);
      const lit = ofType(r.events, 'barrelLit');
      const blown = ofType(r.events, 'barrelExploded');
      expect(placed.length).toBeGreaterThan(10);
      expect(r.standingMost).toBeLessThanOrEqual(TURRET_EXPLOSIVE_BARREL.cap);
      expect(blown.length).toBe(r.state.stats.barrelsDetonated);
      expect(blown.length).toBeGreaterThan(0);
      for (const list of [placed, lit, blown]) {
        expect(new Set(list.map((e) => e.id)).size).toBe(list.length);
      }
      expect(r.state.stats.barrelKills).toBeLessThanOrEqual(r.state.stats.kills);
      expect(r.state.stats.kills).toBe(
        resolveTurretPlan().waves.reduce((n, w) => n + w.spawns.length, 0),
      );
    },
  );

  // Digests of Standard runs with barrels and bowling on, taken on the engine before
  // arrival sectors: every spawn of these runs has barrels standing, so each bearing
  // goes through the lane walk the sectors rewrote, and Standard must replay it exactly.
  // Re-taken for the 2 s pause between waves (the 5 s one replayed the old digests
  // bf47cb63 and 3736426a on the overlap engine), then for the 0.8 s strike and Standard's
  // retune (lot R4), the hills run on seed 7: on seed 21 a few spawns now find no barrel up;
  // then for the waves chained with no pause and Standard's retune (lot R5b).
  it.each([
    [42, 'flat', flat, 1379, 'b432793f'],
    [7, 'hills', hills, 1364, 'c3749054'],
  ] as const)(
    'replays the spawn bearings beside the barrels of a seed %i %s run exactly',
    (seed, _n, probe, count, digest) => {
      const r = fullRun(seed, probe);
      expect(r.state.phase).toBe('won');
      expect(r.spawns).toHaveLength(r.state.stats.kills);
      expect(r.spawnsBesideBarrels).toBe(r.spawns.length);
      expect(r.trace).toHaveLength(count);
      // The end's medal and points, and the weapon stats, came after these digests: dropped.
      const trace = r.trace.map((s) => JSON.stringify(JSON.parse(s), dropResultFields));
      expect(fnv([...trace, ...r.spawns].join('\n'))).toBe(digest);
    },
  );

  it('replays byte-identically, and round-trips through JSON with its barrels mid-run', () => {
    expect(fullRun(99, flat, 20 * 90).trace).toEqual(fullRun(99, flat, 20 * 90).trace);
    const state = createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 5, START);
    run(state, INTRO_END + 20);
    expect(state.barrels.length).toBeGreaterThan(0);
    lightTurretBarrel(state, state.barrels[0], state.tick, []);
    const copy = JSON.parse(JSON.stringify(state)) as TurretDefenseState;
    expect(run(copy, state.tick + 200)).toEqual(run(state, state.tick + 200));
    expect(copy).toEqual(state);
  });
});
