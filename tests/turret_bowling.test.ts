import { describe, expect, it } from 'vitest';
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import {
  TURRET_BOWLING,
  TURRET_PHYSICS,
  TURRET_SIZE_CLASSES,
  TURRET_TIMING,
  TURRET_WAVES,
  TURRET_WEAPON,
} from '../src/sim/content/turret_defense';
import {
  type FlySegment,
  flyContact,
  horizontalAt,
  marchSegment,
  planFlight,
  planSkid,
  positionAt,
  stillSegment,
  type ThrowPhysics,
  type ThrowProbe,
  velocityAt,
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
  resolveTurretPlan,
  type TurretKind,
  type TurretPlan,
} from '../src/sim/minigames/turret_defense_plan';
import type { TurretBowlingDef, TurretSizeClass, Vec3 } from '../src/sim/types';

const flat: ThrowProbe = { ground: () => 0, water: () => null };
const hills: ThrowProbe = {
  ground: (x, z) => 2 * Math.sin(x * 0.11) + 1.5 * Math.cos(z * 0.13) + 0.04 * x,
  water: () => null,
};
const START = 1000;
const HELD_BACK = Number.MAX_SAFE_INTEGER;
const OFF: TurretBowlingDef = { ...TURRET_BOWLING, enabled: false };
const NO_BARRELS = { count: 0, minRadius: 0, maxRadius: 0 };
const CORE = 60;
const KNOCK_DAMAGE = Math.max(1, Math.round(CORE * TURRET_BOWLING.damageShare));

function kind(size: TurretSizeClass, maxHp = 100000): TurretKind {
  return {
    templateId: 'forest_wolf',
    level: 2,
    sizeClass: size,
    maxHp,
    marchSpeed: 1,
    ...TURRET_SIZE_CLASSES[size],
  };
}

function plan(
  kinds: TurretKind[],
  spawns: number[],
  bowling = TURRET_BOWLING,
  cores = [CORE],
): TurretPlan {
  return {
    scenarioId: 'test',
    integrity: 100,
    medals: TURRET_SCENARIO_STANDARD.medals,
    arsenal: { shockwave: 0, fragmentation: 0 },
    resupplyWaves: [],
    chargeBonus: false,
    kinds,
    waves: cores.map((coreDamage) => ({
      spawns,
      coreDamage,
      gapMinTicks: 16,
      gapMaxTicks: 32,
      barrels: NO_BARRELS,
      arrival: { kind: 'ring' },
    })),
    bowling,
  };
}

function run(state: TurretDefenseState, toTick: number, probe = flat): TurretEvent[] {
  const events: TurretEvent[] = [];
  for (let t = state.tick + 1; t <= toTick; t++) events.push(...tickTurretDefense(state, t, probe));
  return events;
}

/** A first wave with every listed kind spawned, in order, and no more spawns to come. */
function scene(
  sizes: TurretSizeClass[],
  bowling = TURRET_BOWLING,
  hp: number[] = [],
  cores = [CORE],
): { state: TurretDefenseState; ms: TurretMonster[] } {
  const kinds = sizes.map((s, i) => kind(s, hp[i]));
  const state = createTurretDefense(
    plan(
      kinds,
      kinds.map((_, i) => i),
      bowling,
      cores,
    ),
    { x: 0, z: 0 },
    7,
    START,
  );
  run(state, START + TURRET_TIMING.introTicks);
  while (state.spawnCursor < sizes.length) {
    state.nextSpawnTick = 0;
    run(state, state.tick + 1);
  }
  state.nextSpawnTick = HELD_BACK;
  for (const m of state.monsters) park(state, m);
  return { state, ms: [...state.monsters] };
}

/** Out of the way (lying far off) so it plays no part. */
function park(state: TurretDefenseState, m: TurretMonster): void {
  stand(state, m, 200 + m.id * 10, 200, 'down');
}

function stand(
  state: TurretDefenseState,
  m: TurretMonster,
  x: number,
  z: number,
  pose: 'windup' | 'down' | 'rise' = 'rise',
  probe = flat,
): void {
  m.state = pose;
  m.seg = stillSegment(state.tick, 100000, { x, y: probe.ground(x, z), z });
}

function launch(
  state: TurretDefenseState,
  m: TurretMonster,
  at: Vec3,
  v: Vec3,
  phys: ThrowPhysics = TURRET_PHYSICS,
): void {
  m.state = 'fly';
  m.airSince = state.tick;
  m.knocked = [];
  m.seg = planFlight(state.tick, at.x, at.y, at.z, v, state.plan.kinds[m.kind].radius, flat, phys);
}

function bowls(events: TurretEvent[]) {
  return events.flatMap((e) => (e.type === 'bowled' ? [e] : []));
}

/** A body dropped from knee height at (x, z): it lands without a bounce or a skid and lies down. */
function drop(state: TurretDefenseState, m: TurretMonster, x: number, z: number): number {
  launch(state, m, { x, y: 0.2, z }, { x: 0, y: 0, z: 0 });
  return m.seg.end;
}

/** A flight that holds its height (no gravity), to place a body at an exact height over a target. */
const LEVEL: ThrowPhysics = { ...TURRET_PHYSICS, gravity: 0 };

describe('contact geometry', () => {
  const fly = planFlight(0, 0, 0.5, 0, { x: 0, y: 0, z: 20 }, 0.6, flat, LEVEL);

  it('solves the entry into reach exactly on a straight pass', () => {
    const target = stillSegment(0, 1000, { x: 0, y: 0, z: 10 });
    expect(flyContact(fly, target, 2, 1.2, 0, 20, flat, 4)).toBeCloseTo((8 / 20) * 20, 9);
  });

  it('meets a walker coming the other way sooner, and misses one beside the path', () => {
    const walker = marchSegment(0, 0, 0, 10, 0, -100, 5, 0);
    expect(flyContact(fly, walker, 2, 1.2, 0, 20, flat, 4)).toBeCloseTo((8 / 25) * 20, 9);
    const beside = stillSegment(0, 1000, { x: 2.1, y: 0, z: 10 });
    expect(flyContact(fly, beside, 2, 1.2, 0, 40, flat, 4)).toBeNull();
  });

  it('passes over a body whose top is below the flyer feet', () => {
    const target = stillSegment(0, 1000, { x: 0, y: 0, z: 10 });
    expect(flyContact(fly, target, 2, 0.5, 0, 40, flat, 4)).toBeNull();
    expect(flyContact(fly, target, 2, 0.51, 0, 40, flat, 4)).not.toBeNull();
  });

  it('only looks inside the window and the flight', () => {
    const target = stillSegment(0, 1000, { x: 0, y: 0, z: 10 });
    expect(flyContact(fly, target, 2, 1.2, 0, 7, flat, 4)).toBeNull();
    expect(flyContact(fly, target, 2, 1.2, 7, 9, flat, 4)).toBeCloseTo(8, 9);
    const short = { ...fly, end: 6 };
    expect(flyContact(short, target, 2, 1.2, 0, 20, flat, 4)).toBeNull();
  });

  it('never meets a body before its segment began, even inside the window', () => {
    const arrivesLate = stillSegment(9, 1000, { x: 0, y: 0, z: 10 });
    expect(flyContact(fly, arrivesLate, 2, 1.2, 0, 20, flat, 4)).toBeCloseTo(9, 9);
  });

  it('reads the height at the middle and the exit of an overlap, not only at its entry', () => {
    // One step from 7.5 to 8.5 whose overlap starts at 8 (halfway): the flyer
    // enters reach above the top and drops below it later in that same step.
    const target = stillSegment(0, 1000, { x: 0, y: 0, z: 10 });
    const diving = (y: number, vy: number): FlySegment => ({
      kind: 'fly',
      start: 0,
      end: 100,
      x: 0,
      y,
      z: 0,
      vx: 0,
      vy,
      vz: 20,
      g: 0,
      contact: 'void',
      nx: 0,
      nz: 0,
    });
    expect(positionAt(diving(17.5, -40), 8, flat).y).toBeCloseTo(1.5, 9);
    expect(flyContact(diving(17.5, -40), target, 2, 1.2, 7.5, 8.5, flat, 1)).toBeCloseTo(8.25, 9);
    expect(positionAt(diving(7.9, -16), 8.25, flat).y).toBeCloseTo(1.3, 9);
    expect(flyContact(diving(7.9, -16), target, 2, 1.2, 7.5, 8.5, flat, 1)).toBeCloseTo(8.5, 9);
    expect(flyContact(diving(8.5, -16), target, 2, 1.2, 7.5, 8.5, flat, 1)).toBeNull();
  });

  it('places a sliding body where the full position read puts it, held before and after', () => {
    const skid = planSkid(3, 1, 0, 2, 8, -6, 0.6, flat, TURRET_PHYSICS);
    if (!skid) throw new Error('no skid');
    for (const t of [0, 3, 3.5, 5.25, skid.end, skid.end + 4]) {
      const p = positionAt(skid, t, flat);
      const h = horizontalAt(skid, t);
      expect(h.x).toBeCloseTo(p.x, 12);
      expect(h.z).toBeCloseTo(p.z, 12);
    }
    expect(horizontalAt(skid, skid.end + 4)).not.toEqual(horizontalAt(skid, 3));
  });
});

describe('a knock', () => {
  function headOn(bowling = TURRET_BOWLING) {
    const { state, ms } = scene(['small', 'small'], bowling);
    const [flyer, struck] = ms;
    stand(state, struck, 0, 30);
    launch(state, flyer, { x: 0, y: 0.3, z: 24 }, { x: 0, y: 5, z: 20 });
    return { state, flyer, struck, before: flyer.seg, from: state.tick };
  }

  /** The head-on contact: the flyer starts 6 yd short of the struck body at 20 yd/s. */
  const headOnContact = (from: number) =>
    from + (6 - 2 * TURRET_SIZE_CLASSES.small.radius * TURRET_BOWLING.reachScale);

  it('launches the struck body with half the flyer speed plus a pop', () => {
    const { state, flyer, struck, from } = headOn();
    const events = run(state, from + 5);
    expect(bowls(events)).toEqual([
      {
        type: 'bowled',
        flyerId: flyer.id,
        struckId: struck.id,
        x: 0,
        y: 0,
        z: 30,
        speed: 20,
        damage: KNOCK_DAMAGE,
      },
    ]);
    const launched = events.find((e) => e.type === 'launched' && e.id === struck.id);
    expect(launched).toMatchObject({ x: 0, y: 0, z: 30 });
    if (launched?.type !== 'launched') throw new Error('no launch');
    expect(launched.vx).toBeCloseTo(0, 12);
    expect(launched.vz).toBeCloseTo(20 * TURRET_BOWLING.transfer, 9);
    expect(launched.vy).toBeCloseTo(TURRET_BOWLING.pop, 12);
    expect(struck.hp).toBe(100000 - KNOCK_DAMAGE);
    expect(struck.knocked).toEqual([flyer.id]);
    expect(flyer.knocked).toEqual([struck.id]);
    expect(state.stats.bowled).toBe(1);
    expect(struck.airSince).toBeCloseTo(headOnContact(from), 9);
  });

  it('caps the struck launch at the throw cap across', () => {
    const { state, ms } = scene(['huge', 'small']);
    const [flyer, struck] = ms;
    const speed = TURRET_WEAPON.maxLaunchSpeed;
    const uncapped = TURRET_BOWLING.transfer * Math.sqrt(TURRET_SIZE_CLASSES.huge.mass) * speed;
    expect(uncapped).toBeGreaterThan(TURRET_WEAPON.maxLaunchSpeed);
    stand(state, struck, 0, 30);
    launch(state, flyer, { x: 0, y: 0.3, z: 22 }, { x: 0, y: 5, z: speed });
    const events = run(state, state.tick + 10);
    const launched = events.find((e) => e.type === 'launched' && e.id === struck.id);
    if (launched?.type !== 'launched') throw new Error('no launch');
    expect(Math.hypot(launched.vx, launched.vz)).toBeCloseTo(TURRET_WEAPON.maxLaunchSpeed, 9);
  });

  it('deals a share of the current wave core damage, at least 1', () => {
    for (const [cores, wave, damage] of [
      [[4], 0, 1],
      [[60, 130], 0, 6],
      [[60, 130], 1, 13],
    ] as const) {
      const { state, ms } = scene(['small', 'small'], TURRET_BOWLING, [], [...cores]);
      state.wave = wave;
      const [flyer, struck] = ms;
      stand(state, struck, 0, 30);
      launch(state, flyer, { x: 0, y: 0.3, z: 24 }, { x: 0, y: 5, z: 20 });
      const knocks = bowls(run(state, state.tick + 5));
      expect(knocks, `${cores} wave ${wave}`).toHaveLength(1);
      expect(knocks[0].damage, `${cores} wave ${wave}`).toBe(damage);
      expect(struck.hp, `${cores} wave ${wave}`).toBe(100000 - damage);
    }
  });

  it('bumps the revision on the knock tick and on no quiet tick before it', () => {
    const { state, flyer, from } = headOn();
    const quiet = state.rev;
    expect(run(state, from + 3)).toEqual([]);
    expect(state.rev).toBe(quiet);
    expect(run(state, from + 4).map((e) => e.type)).toEqual(['bowled', 'launched']);
    expect(flyer.knocked).toHaveLength(1);
    expect(state.rev).toBeGreaterThan(quiet);
  });

  it('knocks on the tick of a bounce, from the bounce itself', () => {
    const { state, ms } = scene(['small', 'small']);
    const [flyer, struck] = ms;
    stand(state, struck, 0, 29.4);
    launch(state, flyer, { x: 0, y: 0.6, z: 24 }, { x: 0, y: -4, z: 25 });
    const before = flyer.seg;
    const bounceTick = Math.ceil(before.end);
    expect(bowls(run(state, bounceTick - 1))).toEqual([]);
    const events = run(state, bounceTick);
    expect(events.some((e) => e.type === 'bounce' && e.id === flyer.id)).toBe(true);
    expect(bowls(events).map((b) => b.struckId)).toEqual([struck.id]);
    const zb = positionAt(before, before.end, flat).z;
    const reach = 2 * TURRET_SIZE_CLASSES.small.radius * TURRET_BOWLING.reachScale;
    const across = 25 * TURRET_PHYSICS.bounceKeep * 0.05;
    expect(flyer.seg.start).toBeCloseTo(before.end + (29.4 - reach - zb) / across, 9);
  });

  it('knocks a body that comes to rest mid-tick no earlier than it got there', () => {
    const { state, ms } = scene(['small', 'small']);
    const [flyer, struck] = ms;
    const rest = drop(state, struck, 0, 30);
    launch(state, flyer, { x: 0, y: 0.6, z: 26 }, { x: 0, y: -4, z: 20 });
    const bounce = flyer.seg.end;
    expect(Math.floor(bounce)).toBe(Math.floor(rest));
    expect(bounce).toBeLessThan(rest);
    const events = run(state, Math.ceil(rest));
    expect(bowls(events).map((b) => [b.flyerId, b.struckId])).toEqual([[flyer.id, struck.id]]);
    expect(struck.state).toBe('fly');
    expect(struck.seg.start).toBeCloseTo(rest, 9);
  });

  it('meets a body come to rest mid-tick on that same tick, not a tick late', () => {
    const { state, ms } = scene(['small', 'small']);
    const [flyer, struck] = ms;
    const t0 = state.tick;
    const rest = drop(state, struck, 0, 30);
    const reach = 2 * TURRET_SIZE_CLASSES.small.radius * TURRET_BOWLING.reachScale;
    launch(state, flyer, { x: 0, y: 0.3, z: 30 - reach - 2.5 }, { x: 0, y: 0, z: 20 }, LEVEL);
    expect(rest - t0).toBeLessThan(2.5);
    const events = run(state, t0 + 3);
    expect(bowls(events).map((b) => [b.flyerId, b.struckId])).toEqual([[flyer.id, struck.id]]);
    expect(flyer.seg.start).toBeCloseTo(t0 + 2.5, 9);
  });

  it('chains: the struck body flies on and knocks a third', () => {
    const { state, ms } = scene(['small', 'small', 'small']);
    const [flyer, struck, third] = ms;
    stand(state, struck, 1.5, 30);
    stand(state, third, 4, 33.1);
    launch(state, flyer, { x: 0, y: 0.3, z: 24 }, { x: 0, y: 5, z: 20 });
    const events = run(state, state.tick + 20);
    expect(bowls(events).map((b) => [b.flyerId, b.struckId])).toEqual([
      [flyer.id, struck.id],
      [struck.id, third.id],
    ]);
    expect(struck.knocked).toEqual([flyer.id, third.id]);
  });

  it('slows the flyer by 40 percent, replanned from the contact with its heading and fall', () => {
    const { state, flyer, before, from } = headOn();
    const contact = headOnContact(from);
    run(state, from + 5);
    const after = flyer.seg;
    expect(after.kind).toBe('fly');
    if (after.kind !== 'fly' || before.kind !== 'fly') return;
    expect(after.start).toBeCloseTo(contact, 9);
    const was = positionAt(before, contact, flat);
    const now = positionAt(after, contact, flat);
    expect(now.x).toBeCloseTo(was.x, 9);
    expect(now.y).toBeCloseTo(was.y, 9);
    expect(now.z).toBeCloseTo(was.z, 9);
    expect(after.vz).toBeCloseTo(20 * TURRET_BOWLING.flyerKeep, 9);
    expect(after.vx).toBeCloseTo(0, 12);
    expect(after.vy).toBeCloseTo(velocityAt(before, contact).y, 9);
  });

  it('scales the struck speed by the square root of the mass ratio, and the pop by its own mass', () => {
    const cases: [TurretSizeClass, TurretSizeClass][] = [
      ['large', 'small'],
      ['small', 'huge'],
    ];
    for (const [flyerSize, struckSize] of cases) {
      const { state, ms } = scene([flyerSize, struckSize]);
      const [flyer, struck] = ms;
      stand(state, struck, 0, 30);
      launch(state, flyer, { x: 0, y: 0.3, z: 25 }, { x: 0, y: 5, z: 12 });
      const events = run(state, state.tick + 20);
      const launched = events.find((e) => e.type === 'launched' && e.id === struck.id);
      if (launched?.type !== 'launched')
        throw new Error(`${flyerSize} did not knock ${struckSize}`);
      const fm = TURRET_SIZE_CLASSES[flyerSize].mass;
      const sm = TURRET_SIZE_CLASSES[struckSize].mass;
      expect(Math.hypot(launched.vx, launched.vz)).toBeCloseTo(
        12 * TURRET_BOWLING.transfer * Math.sqrt(fm / sm),
        9,
      );
      expect(launched.vy).toBeCloseTo(TURRET_BOWLING.pop / Math.sqrt(sm), 12);
    }
  });

  it('scatters an off-center knock sideways, along the line between the two bodies', () => {
    const { state, ms } = scene(['small', 'small']);
    const [flyer, struck] = ms;
    stand(state, struck, 1.5, 30);
    launch(state, flyer, { x: 0, y: 0.3, z: 24 }, { x: 0, y: 5, z: 20 });
    const events = run(state, state.tick + 5);
    const [bowled] = bowls(events);
    expect(bowled).toBeDefined();
    const launched = events.find((e) => e.type === 'launched' && e.id === struck.id);
    if (launched?.type !== 'launched') throw new Error('no launch');
    const from = positionAt(flyer.seg, flyer.seg.start, flat);
    const nx = 1.5 - from.x;
    const nz = 30 - from.z;
    expect(launched.vx).toBeGreaterThan(0);
    expect(launched.vx * nz - launched.vz * nx).toBeCloseTo(0, 9);
    expect(Math.hypot(launched.vx, launched.vz)).toBeCloseTo(20 * TURRET_BOWLING.transfer, 9);
    expect(struck.facing).toBeCloseTo(Math.atan2(-launched.vx, -launched.vz), 12);
  });

  it('can kill: the knock damage counts a kill and the corpse flies on', () => {
    const { state, ms } = scene(['small', 'small'], TURRET_BOWLING, [100000, KNOCK_DAMAGE]);
    const [flyer, struck] = ms;
    stand(state, struck, 0, 30);
    launch(state, flyer, { x: 0, y: 0.3, z: 24 }, { x: 0, y: 5, z: 20 });
    const events = run(state, state.tick + 5);
    expect(events.map((e) => e.type)).toEqual(['bowled', 'launched', 'killed']);
    expect(struck.hp).toBe(0);
    expect(struck.state).toBe('fly');
    expect(state.stats.kills).toBe(1);
    run(state, state.tick + 20 * 4);
    expect(struck.state === 'dead' || !state.monsters.includes(struck)).toBe(true);
  });

  it('cancels a windup: the struck body flies and the turret loses nothing', () => {
    const { state, ms } = scene(['small', 'small']);
    const [flyer, struck] = ms;
    struck.state = 'windup';
    struck.seg = stillSegment(state.tick, TURRET_TIMING.windupTicks, { x: 0, y: 0, z: 4.1 });
    launch(state, flyer, { x: -8, y: 0.3, z: 4.1 }, { x: 20, y: 5, z: 0 });
    const events = run(state, state.tick + TURRET_TIMING.windupTicks + 20);
    expect(bowls(events).map((b) => b.struckId)).toEqual([struck.id]);
    expect(events.some((e) => e.type === 'breach')).toBe(false);
    expect(state.integrity).toBe(state.plan.integrity);
    expect(state.stats.breaches).toBe(0);
  });

  it('needs a flyer faster than the threshold', () => {
    for (const [speed, knocks] of [
      [TURRET_BOWLING.minSpeed - 0.1, 0],
      [TURRET_BOWLING.minSpeed + 0.1, 1],
    ] as const) {
      const { state, ms } = scene(['small', 'large']);
      const [flyer, struck] = ms;
      stand(state, struck, 0, 26);
      launch(state, flyer, { x: 0, y: 0.5, z: 22 }, { x: 0, y: 0, z: speed }, LEVEL);
      expect(bowls(run(state, state.tick + 40))).toHaveLength(knocks);
    }
  });
});

describe('who can be knocked', () => {
  it('passes over a body whose top is below the flyer feet, and knocks a taller one', () => {
    for (const [size, feet, knocks] of [
      ['small', TURRET_SIZE_CLASSES.small.height + 0.1, 0],
      ['medium', TURRET_SIZE_CLASSES.small.height + 0.1, 1],
      ['medium', TURRET_SIZE_CLASSES.medium.height + 0.05, 0],
    ] as const) {
      const { state, ms } = scene(['small', size]);
      const [flyer, struck] = ms;
      stand(state, struck, 0, 30);
      launch(state, flyer, { x: 0, y: feet, z: 22 }, { x: 0, y: 0, z: 20 }, LEVEL);
      const events = run(state, state.tick + 20);
      expect(bowls(events), `${size} under feet at ${feet}`).toHaveLength(knocks);
      if (!knocks) expect(struck.state).toBe('rise');
    }
  });

  it('reads a lying body as low: a flyer over its lying top passes, one below it knocks', () => {
    const lying = TURRET_SIZE_CLASSES.large.height * TURRET_BOWLING.lyingHeight;
    for (const [feet, knocks] of [
      [lying + 0.05, 0],
      [lying - 0.05, 1],
    ] as const) {
      const { state, ms } = scene(['small', 'large']);
      const [flyer, struck] = ms;
      stand(state, struck, 0, 30, 'down');
      launch(state, flyer, { x: 0, y: feet, z: 22 }, { x: 0, y: 0, z: 20 }, LEVEL);
      expect(bowls(run(state, state.tick + 20))).toHaveLength(knocks);
    }
  });

  it('never knocks a sliding body', () => {
    const { state, ms } = scene(['small', 'small']);
    const [flyer, slider] = ms;
    const skid = planSkid(state.tick, -1.5, 0, 30, 10, 0, 0.6, flat, TURRET_PHYSICS);
    if (!skid) throw new Error('no skid');
    slider.state = 'skid';
    slider.seg = skid;
    const lying = TURRET_SIZE_CLASSES.small.height * TURRET_BOWLING.lyingHeight;
    const feet = lying + 0.08;
    launch(state, flyer, { x: 0, y: feet, z: 24 }, { x: 0, y: 0, z: 20 }, LEVEL);
    expect(bowls(run(state, Math.floor(skid.end)))).toEqual([]);
    expect(slider.state).toBe('skid');
    expect(slider.seg).toBe(skid);
    expect(bowls(run(state, state.tick + 40))).toEqual([]);
  });

  it('knocks with a corpse in flight, and never moves a corpse on the ground or a body in the air', () => {
    const { state, ms } = scene(['small', 'small', 'small', 'small']);
    const [corpse, lying, airborne, standing] = ms;
    lying.hp = 0;
    stand(state, lying, 0, 27);
    lying.state = 'dead';
    launch(state, airborne, { x: 0, y: 0.4, z: 30 }, { x: 0, y: 0, z: 0 }, LEVEL);
    stand(state, standing, 0, 33);
    corpse.hp = 0;
    launch(state, corpse, { x: 0, y: 0.4, z: 22 }, { x: 0, y: 0, z: 25 }, LEVEL);
    const lyingSeg = lying.seg;
    const events = run(state, state.tick + 20);
    expect(bowls(events).map((b) => [b.flyerId, b.struckId])).toEqual([[corpse.id, standing.id]]);
    expect(lying.seg).toBe(lyingSeg);
    expect(lying.state).toBe('dead');
  });
});

describe('a line of marchers', () => {
  it('a fast flyer through a staggered line knocks each marcher once, slowing at each', () => {
    const { state, ms } = scene(['small', 'medium', 'medium', 'medium']);
    const [flyer, ...line] = ms;
    line.forEach((m, i) => {
      const x = i % 2 ? 1 : -1;
      m.state = 'march';
      m.seg = marchSegment(state.tick, x, 0, 12 + 3.5 * i, x, -1000, 1, 0);
    });
    launch(state, flyer, { x: 0, y: 0, z: 6 }, { x: 0, y: 10, z: 30 });
    const events = run(state, state.tick + 20 * 3);
    const knocks = bowls(events);
    expect(knocks.map((b) => b.flyerId)).toEqual(line.map(() => flyer.id));
    expect(knocks.map((b) => b.struckId)).toEqual(line.map((m) => m.id));
    const keep = TURRET_BOWLING.flyerKeep;
    knocks.forEach((b, i) => {
      expect(b.speed).toBeCloseTo(30 * keep ** i, 9);
    });
    expect(flyer.knocked).toEqual(line.map((m) => m.id));
    expect(state.stats.bowled).toBe(line.length);
  });

  it('resolves two contacts of one tick in time order, whatever the listing', () => {
    for (const laterListedFirst of [true, false]) {
      const { state, ms } = scene(['small', 'small', 'small']);
      const [flyer, a, b] = ms;
      const [later, sooner] = laterListedFirst ? [a, b] : [b, a];
      stand(state, sooner, -1.5, 30);
      stand(state, later, 1.5, 30.6);
      // Unslowed, the flyer would meet `sooner` 3.2 ticks out and `later` 0.6 tick after.
      const reach = 2 * TURRET_SIZE_CLASSES.small.radius * TURRET_BOWLING.reachScale;
      const z0 = 30 - Math.sqrt(reach * reach - 1.5 * 1.5) - 3.2;
      launch(state, flyer, { x: 0, y: 0.3, z: z0 }, { x: 0, y: 0, z: 20 }, LEVEL);
      const knocks = bowls(run(state, state.tick + 10));
      expect(knocks.map((k) => k.struckId)).toEqual([sooner.id, later.id]);
      expect(knocks.map((k) => k.speed)).toEqual([20, 20 * TURRET_BOWLING.flyerKeep]);
    }
  });

  it('knocks a pair at most once per flight, whoever flies', () => {
    const { state, ms } = scene(['small', 'small', 'small']);
    const [flyer, first, second] = ms;
    stand(state, first, 0, 26);
    launch(state, flyer, { x: 0, y: 0.4, z: 20 }, { x: 0, y: 0, z: 30 }, LEVEL);
    const once = run(state, state.tick + 4);
    expect(bowls(once).map((b) => b.struckId)).toEqual([first.id]);
    // The same flight carries on level, with the first body standing in its path again.
    const z = positionAt(flyer.seg, state.tick, flat).z;
    flyer.seg = planFlight(state.tick, 0, 0.4, z, { x: 0, y: 0, z: 20 }, 0.6, flat, LEVEL);
    stand(state, first, 0, z + 6);
    stand(state, second, 0, z + 12);
    const later = run(state, state.tick + 20);
    expect(bowls(later).map((b) => [b.flyerId, b.struckId])).toEqual([[flyer.id, second.id]]);
    stand(state, flyer, 0, 60);
    launch(state, first, { x: 0, y: 0.4, z: 54 }, { x: 0, y: 0, z: 20 }, LEVEL);
    first.knocked = [flyer.id];
    expect(bowls(run(state, state.tick + 20))).toEqual([]);
  });

  it('lets the same pair meet again on a later flight a shell starts', () => {
    const { state, ms } = scene(['small', 'small']);
    const [flyer, struck] = ms;
    stand(state, struck, 0, 30);
    launch(state, flyer, { x: 0, y: 0.3, z: 24 }, { x: 0, y: 5, z: 20 });
    expect(bowls(run(state, state.tick + 5)).map((b) => b.struckId)).toEqual([struck.id]);
    expect(flyer.knocked).toEqual([struck.id]);
    stand(state, flyer, 0, 30, 'down');
    park(state, struck);
    const shot = fireTurret(state, state.tick, 0, 30, flat);
    if (!shot.ok) throw new Error(shot.reason);
    run(state, shot.shot.impactTick);
    expect(flyer.state).toBe('fly');
    expect(flyer.knocked).toEqual([]);
    const landing = positionAt(flyer.seg, flyer.seg.end, flat);
    stand(state, struck, landing.x, landing.z);
    const again = bowls(run(state, state.tick + 40));
    expect(again.map((b) => [b.flyerId, b.struckId])).toEqual([[flyer.id, struck.id]]);
  });
});

describe('the toggle', () => {
  it('turned off, a flyer passes straight through a standing body', () => {
    const { state, ms } = scene(['small', 'small'], OFF);
    const [flyer, struck] = ms;
    stand(state, struck, 0, 30);
    const standing = struck.seg;
    launch(state, flyer, { x: 0, y: 0.5, z: 22 }, { x: 0, y: 0, z: 20 }, LEVEL);
    const path = flyer.seg;
    expect(bowls(run(state, state.tick + 20))).toEqual([]);
    expect(struck.seg).toBe(standing);
    expect(flyer.seg).toBe(path);
    expect(state.stats.bowled).toBe(0);
  });

  // Digests of full auto-aimer runs with bowling turned off, first taken on the lot 1
  // engine before bowling existed, re-taken since with the current throw law, tuning,
  // the cannon tower's body, its strike ring and the grazing rule: turned off, every
  // event (throws, bounces, kills, waves) replays them exactly. Before the grazing
  // rule, rim hits relaunched a body lying past the maximum range hundreds of times.
  // The barrels came after these digests: the runs place none, so the engine the
  // barrels were added to still replays them untouched. Re-taken for the 2 s pause
  // between waves (the 5 s one replayed 313311f2 and 268bf16a on the overlap engine),
  // then for the 0.8 s strike and Standard's retune (lot R4).
  it.each([
    ['flat', 42, flat, 997, 'ec3b65da'],
    ['hills', 21, hills, 964, 'f37489d7'],
  ] as const)(
    'turned off, a %s full run replays the bowling-free engine exactly',
    (_name, seed, probe, count, digest) => {
      const barrelFree = TURRET_WAVES.map((wave) => ({ ...wave, barrels: NO_BARRELS }));
      const scenario = { ...TURRET_SCENARIO_STANDARD, waves: barrelFree };
      const r = fullRun(seed, resolveTurretPlan(scenario, undefined, OFF), probe, aimNearest);
      const text = r.trace.map((s) => JSON.stringify(JSON.parse(s), dropLaterFields)).join('\n');
      expect(r.trace).toHaveLength(count);
      expect(fnv(text)).toBe(digest);
      expect(r.state.phase).toBe('won');
      expect(r.state.stats.bowled).toBe(0);
      const launches = new Map<number, number>();
      for (const s of r.trace) {
        const e = JSON.parse(s) as TurretEvent;
        if (e.type === 'launched') launches.set(e.id, (launches.get(e.id) ?? 0) + 1);
      }
      expect(launches.size).toBeGreaterThan(0);
      expect(Math.max(...launches.values())).toBeLessThanOrEqual(30);
    },
  );
});

describe('full runs with bowling', () => {
  it('the nearest-first auto-aimer still wins all six waves', () => {
    const r = fullRun(42, resolveTurretPlan(), flat, aimNearest);
    expect(r.state.phase).toBe('won');
    expect(r.state.integrity).toBeGreaterThan(50);
  });

  it('a slower, looser aimer wins while bodies knock others over through the run', () => {
    for (const [seed, probe] of [
      [42, flat],
      [21, hills],
    ] as const) {
      const r = fullRun(seed, resolveTurretPlan(), probe, aimLoosely);
      expect(r.state.phase).toBe('won');
      const knocks = r.trace.filter((s) => s.startsWith('{"type":"bowled"'));
      expect(knocks.length).toBe(r.state.stats.bowled);
      // Shells a quarter harder since lot R4 leave fewer bodies to throw: a few knocks still.
      expect(r.state.stats.bowled).toBeGreaterThanOrEqual(4);
      // About one launch in ten knocks a body over; far more reads as chaos, not bowling.
      const launches = r.trace.filter((s) => s.startsWith('{"type":"launched"')).length;
      expect(r.state.stats.bowled).toBeLessThanOrEqual(0.15 * launches);
    }
  });

  it('replays byte-identically, knocks included', () => {
    const a = fullRun(99, resolveTurretPlan(), hills, aimLoosely);
    const b = fullRun(99, resolveTurretPlan(), hills, aimLoosely);
    expect(a.state.phase).toBe('won');
    expect(a.state.stats.bowled).toBeGreaterThan(0);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.trace).toEqual(b.trace);
  });

  it('keeps the state plain data through knocks', () => {
    const r = fullRun(99, resolveTurretPlan(), hills, aimLoosely, 20 * 90);
    const clone = JSON.parse(JSON.stringify(r.state)) as TurretDefenseState;
    expect(JSON.stringify(clone)).toBe(JSON.stringify(r.state));
    for (const m of r.state.monsters) {
      expect(Array.isArray(m.knocked)).toBe(true);
      for (const id of m.knocked) expect(Number.isInteger(id)).toBe(true);
    }
  });
});

type Aim = (
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
) => { x: number; z: number } | null;

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

const aimNearest: Aim = (state, tick, probe) =>
  tick >= state.readyTick ? nearestLive(state, tick, probe) : null;

/** Fires at most every 0.8 s past the cooldown, up to 2 yd off the nearest monster. */
const aimLoosely: Aim = (state, tick, probe) => {
  if (tick < state.readyTick + 16) return null;
  const p = nearestLive(state, tick, probe);
  if (!p) return null;
  return { x: p.x + ((tick * 7919) % 400) / 100 - 2, z: p.z + ((tick * 104729) % 400) / 100 - 2 };
};

function fullRun(
  seed: number,
  p: TurretPlan,
  probe: ThrowProbe,
  aim: Aim,
  maxTicks = 20 * 60 * 15,
): { state: TurretDefenseState; trace: string[] } {
  const state = createTurretDefense(p, { x: 0, z: 0 }, seed, START);
  const trace: string[] = [];
  let t = START;
  while (t < START + maxTicks && state.phase !== 'won' && state.phase !== 'lost') {
    t++;
    for (const e of tickTurretDefense(state, t, probe)) trace.push(JSON.stringify(e));
    const target = aim(state, t, probe);
    if (target) {
      const out = fireTurret(state, t, target.x, target.z, probe);
      for (const e of out.events) trace.push(JSON.stringify(e));
    }
  }
  return { state, trace };
}

const ENDED_LATER = new Set(['medal', 'points', 'breakdown']);
const LATER_STATS = new Set(['bowled', 'barrelsDetonated', 'barrelKills']);
const WEAPON_STATS = new Set(['shockwaves', 'frags', 'resupplies']);

/** Drops what the engine gained after these digests: the bowled and barrel stats, the
 *  limited-weapon stats while they stay 0 (these runs spend no charge; a spent one shows),
 *  each hit's position and the end's medal and points. */
function dropLaterFields(this: object, key: string, value: unknown): unknown {
  if (LATER_STATS.has(key)) return undefined;
  if ('barrelKills' in this && WEAPON_STATS.has(key) && value === 0) return undefined;
  if ((this as { type?: string }).type === 'ended' && ENDED_LATER.has(key)) return undefined;
  if ('falloff' in this && (key === 'x' || key === 'y' || key === 'z')) return undefined;
  return value;
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
