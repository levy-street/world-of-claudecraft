// Fire and Fly waves as groups of bricks (src/sim/minigames/turret_wave_groups.ts and its
// bricks: turret_surgers.ts, turret_keg_lots.ts, the plan in turret_group_plan.ts): groups
// spawning on their own clocks, the surgers setting off away from the action, the keg lots all
// laid at a wave's start (random, tower crown, on a route), and the resolver's rules. No
// shipped scenario uses surgers or the new keg modes yet: these run on synthetic plans.
import { describe, expect, it } from 'vitest';
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import {
  TURRET_ARENA,
  TURRET_BARREL_RING,
  TURRET_BOWLING,
  TURRET_EXPLOSIVE_BARREL,
  TURRET_KEG_CROWN,
  TURRET_RALLY,
  TURRET_SHOCKWAVE,
  TURRET_SIZE_CLASSES,
  TURRET_SURGERS,
  TURRET_TIMING,
} from '../src/sim/content/turret_defense';
import { horizontalAt, stillSegment, type ThrowProbe } from '../src/sim/minigames/thrown_body';
import { placeTurretBarrels, standTurretBarrel } from '../src/sim/minigames/turret_barrels';
import {
  createTurretDefense,
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
import {
  TURRET_GROUP_LIMITS,
  type TurretGroupPlan,
  type TurretWavePlan,
} from '../src/sim/minigames/turret_group_plan';
import {
  placeTurretFieldKegs,
  placeTurretPathKegs,
  turretRouteKegSpot,
} from '../src/sim/minigames/turret_keg_lots';
import { openTurretRallies, turretRallyReach } from '../src/sim/minigames/turret_rally';
import { turretClearOfRallies } from '../src/sim/minigames/turret_rally_kegs';
import { startTurretShockwave } from '../src/sim/minigames/turret_shockwave';
import {
  turretActionBearing,
  turretSurgeBearing,
  turretSurgerSector,
  turretSurgeScores,
  turretSurgeSectorOf,
  turretSurgeWeight,
} from '../src/sim/minigames/turret_surgers';
import { turretGroupLanes } from '../src/sim/minigames/turret_wave_groups';
import type {
  TurretGroupDef,
  TurretKegLotDef,
  TurretScenarioDef,
  TurretSizeClass,
} from '../src/sim/types';
import { TURRET_BRICKS_SCENARIO, walkersWavePlan } from './helpers/turret_wave_plan';

const TAU = Math.PI * 2;
const START = 1000;
const INTRO_END = START + TURRET_TIMING.introTicks;
const flat: ThrowProbe = { ground: () => 0, water: () => null };
const SECTOR = TAU / TURRET_SURGERS.sectors;

/** Signed angle from `b` to `a`, in (-PI, PI]. */
function angleOff(a: number, b: number): number {
  return ((((a - b + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

function scenario(waves: TurretScenarioDef['waves']): TurretScenarioDef {
  return { ...TURRET_SCENARIO_STANDARD, id: 'test_groups', boardKey: 'test', waves };
}

const WOLF = { templateId: 'forest_wolf', level: 2 } as const;
const walkers = (count: number, extra: Partial<TurretGroupDef> = {}): TurretGroupDef =>
  ({
    brick: 'walkers',
    entries: [{ ...WOLF, count }],
    gapMinTicks: 10,
    gapMaxTicks: 10,
    ...extra,
  }) as TurretGroupDef;

function run(state: TurretDefenseState, toTick: number): { tick: number; event: TurretEvent }[] {
  const out: { tick: number; event: TurretEvent }[] = [];
  for (let t = state.tick + 1; t <= toTick; t++)
    for (const event of tickTurretDefense(state, t, flat)) out.push({ tick: t, event });
  return out;
}

/** Each monster's first sighting: its tick and its spawn bearing. */
function births(state: TurretDefenseState, toTick: number) {
  const seen = new Map<number, { tick: number; bearing: number; kind: number }>();
  for (let t = state.tick + 1; t <= toTick; t++) {
    tickTurretDefense(state, t, flat);
    for (const m of state.monsters)
      if (!seen.has(m.id))
        seen.set(m.id, { tick: t, bearing: Math.atan2(m.seg.x, m.seg.z), kind: m.kind });
  }
  return seen;
}

describe('groups on their own clocks', () => {
  it("spawns each group from its delay at its own gaps, a tick's spawns group by group", () => {
    const plan = resolveTurretPlan(
      scenario([
        {
          coreDamage: 60,
          groups: [
            walkers(3),
            {
              ...walkers(3),
              entries: [{ templateId: 'wild_boar', count: 3, level: 3 }],
              delayTicks: 10,
            },
          ],
        },
      ]),
    );
    const state = createTurretDefense(plan, { x: 0, z: 0 }, 4, START);
    const seen = births(state, INTRO_END + 40);
    const order = [...seen.entries()].map(([id, b]) => [id, b.tick - INTRO_END, b.kind]);
    // The wolves at 0, 10, 20; the boars at 10, 20, 30; on a shared tick the wolf comes first.
    expect(order).toEqual([
      [1, 0, 0],
      [2, 10, 0],
      [3, 10, 1],
      [4, 20, 0],
      [5, 20, 1],
      [6, 30, 1],
    ]);
  });

  it("keys each group's sides apart: the first group's draws are the old single wave's", () => {
    const arc = { kind: 'arc', widthTurn: 0.05 } as const;
    const plan = resolveTurretPlan(
      scenario([
        { coreDamage: 60, groups: [walkers(2, { sides: arc }), walkers(2, { sides: arc })] },
      ]),
    );
    const wave = plan.waves[0];
    const lanes = [0, 1].map((g) => turretGroupLanes({ seed: 6 }, 0, wave, g)[0]);
    const first = turretDraw({ seed: 6 }, TURRET_STREAM.arrivalSide, 0, 0) * TAU;
    const second =
      turretDraw({ seed: 6 }, TURRET_STREAM.arrivalSide, 0, TURRET_GROUP_LIMITS.sideKeys) * TAU;
    expect(lanes[0].from + lanes[0].width / 2).toBeCloseTo(first, 12);
    expect(lanes[1].from + lanes[1].width / 2).toBeCloseTo(second, 12);
    expect(Math.abs(angleOff(first, second))).toBeGreaterThan(1e-6);
  });

  it('replays a wave of every brick the same from one seed, and differently from another', () => {
    const plan = resolveTurretPlan(TURRET_BRICKS_SCENARIO);
    const trace = (seed: number) => {
      const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, START);
      return JSON.stringify(run(state, INTRO_END + 20 * 30)) + JSON.stringify(state.monsters);
    };
    expect(trace(3)).toBe(trace(3));
    expect(trace(4)).not.toBe(trace(3));
  });
});

/** A monster record standing still at (x, z), for the sector score. */
function standing(x: number, z: number, hp = 10): Pick<TurretMonster, 'hp' | 'state' | 'seg'> {
  return { hp, state: 'march', seg: stillSegment(0, 1000, { x, y: 0, z }) };
}

/** A monster at `distance` yd on `bearing`. */
function at(bearing: number, distance: number, hp = 10) {
  return standing(Math.sin(bearing) * distance, Math.cos(bearing) * distance, hp);
}

describe("the surgers' action bearing", () => {
  it('weighs a monster from 1 at the spawn ring to 3 at the tower foot, linearly', () => {
    const foot = TURRET_ARENA.breachRadius;
    const ring = TURRET_ARENA.spawnRadius;
    expect(turretSurgeWeight(ring)).toBe(1);
    expect(turretSurgeWeight(ring + 20)).toBe(1);
    expect(turretSurgeWeight(foot)).toBe(3);
    expect(turretSurgeWeight(0)).toBe(3);
    expect(turretSurgeWeight((foot + ring) / 2)).toBeCloseTo(2, 12);
  });

  it('scores eight sectors from bearing 0, the living only', () => {
    expect(TURRET_SURGERS.sectors).toBe(8);
    expect(turretSurgeSectorOf(0)).toBe(0);
    expect(turretSurgeSectorOf(SECTOR * 2.5)).toBe(2);
    expect(turretSurgeSectorOf(-0.01)).toBe(7);
    const ring = TURRET_ARENA.spawnRadius;
    const scores = turretSurgeScores(
      [
        at(SECTOR * 2.5, ring),
        at(SECTOR * 2.5, ring),
        at(SECTOR * 5.5, TURRET_ARENA.breachRadius),
        at(SECTOR * 6.5, 10, 0),
        { ...at(SECTOR * 6.5, 10), state: 'gone' },
      ],
      0,
      0,
      0,
    );
    expect(scores).toEqual([0, 0, 2, 0, 0, 3, 0, 0]);
  });

  it("takes the best sector's centre, the lower sector on a tie, and draws one with nobody alive", () => {
    const ring = TURRET_ARENA.spawnRadius;
    const foot = TURRET_ARENA.breachRadius;
    const source = { seed: 8 };
    const action = (ms: Pick<TurretMonster, 'hp' | 'state' | 'seg'>[], group = 1) =>
      turretActionBearing(source, ms, 0, 0, 0, 2, group);
    // Two at the ring weigh less than one at the foot.
    expect(action([at(SECTOR * 2.5, ring), at(SECTOR * 2.5, ring), at(SECTOR * 5.5, foot)])).toBe(
      SECTOR * 5.5,
    );
    // Three at the ring tie one at the foot: the lower sector wins, in either listing order.
    const tie = [at(SECTOR * 5.5, foot), ...[0, 1, 2].map(() => at(SECTOR * 2.5, ring))];
    expect(action(tie)).toBe(SECTOR * 2.5);
    expect(action([...tie].reverse())).toBe(SECTOR * 2.5);
    // Nobody alive: a private draw keyed by the wave and the group.
    const drawn = action([at(1, 20, 0)]);
    expect(drawn).toBe(
      turretDraw(source, TURRET_STREAM.surgeSide, 2, TURRET_GROUP_LIMITS.sideKeys) * TAU,
    );
    expect(action([], 1)).toBe(drawn);
    expect(action([], 2)).not.toBe(drawn);
    expect(turretActionBearing({ seed: 9 }, [], 0, 0, 0, 2, 1)).not.toBe(drawn);
  });

  it('sets G bunches evenly apart from the action: opposite for one, the quarters for three, fifths for four', () => {
    const deg = (rad: number) => Math.round((rad * 180) / Math.PI);
    const bearings = (sides: number) =>
      Array.from({ length: sides }, (_, k) => deg(turretSurgeBearing(0, sides, k)));
    expect(bearings(1)).toEqual([180]);
    expect(bearings(2)).toEqual([120, 240]);
    expect(bearings(3)).toEqual([90, 180, 270]);
    expect(bearings(4)).toEqual([72, 144, 216, 288]);
    expect(bearings(5)).toEqual([60, 120, 180, 240, 300]);
    expect(turretSurgeBearing(1, 1, 0)).toBeCloseTo(1 + Math.PI, 12);
  });

  it("jitters each bunch's side a little by its own keyed draw, its monsters taking the bunches in turn", () => {
    const brick = { sides: 3, widthTurn: 0.05 };
    const sector = (seed: number, index: number, group = 1) =>
      turretSurgerSector({ seed }, 4, group, brick, 0.5, index);
    for (let index = 0; index < 9; index++) {
      const s = sector(7, index);
      expect(s).toEqual(sector(7, index));
      expect(s).toEqual(sector(7, index % 3));
      expect(s.width).toBeCloseTo(brick.widthTurn * TAU, 12);
      const nominal = turretSurgeBearing(0.5, 3, index % 3);
      expect(Math.abs(angleOff(s.from + s.width / 2, nominal))).toBeLessThanOrEqual(
        TURRET_SURGERS.jitterTurn * TAU + 1e-9,
      );
    }
    const jitters = [0, 1, 2].map((k) => {
      const s = sector(7, k);
      return angleOff(s.from + s.width / 2, turretSurgeBearing(0.5, 3, k));
    });
    expect(new Set(jitters).size).toBe(3);
    expect(sector(8, 0)).not.toEqual(sector(7, 0));
    expect(sector(7, 0, 2)).not.toEqual(sector(7, 0));
  });

  it.each([1, 2, 3, 4, 5])(
    'sends %i bunches of surgers in from the sides away from a crowd walking in on one side',
    (sides) => {
      const arc = { kind: 'arc', widthTurn: 0.05 } as const;
      const plan = resolveTurretPlan(
        scenario([
          {
            coreDamage: 60,
            groups: [
              walkers(12, { sides: arc, gapMinTicks: 2, gapMaxTicks: 2 }),
              {
                brick: 'surgers',
                sides,
                widthTurn: 0.04,
                entries: [{ ...WOLF, count: 2 * sides, speedScale: 2 }],
                gapMinTicks: 1,
                gapMaxTicks: 1,
                delayTicks: 60,
              },
            ],
          },
        ]),
      );
      for (const seed of [2, 5]) {
        const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, START);
        const seen = births(state, INTRO_END + 60 + 2 * sides + 2);
        const crowd = turretGroupLanes(state, 0, plan.waves[0], 0)[0];
        const action = state.spawning[1].action!;
        // The crowd's side is the busiest: the action is its sector's centre.
        expect(action).toBe((turretSurgeSectorOf(crowd.from + crowd.width / 2) + 0.5) * SECTOR);
        const surgers = [...seen.values()].filter((b) => b.tick >= INTRO_END + 60);
        expect(surgers).toHaveLength(2 * sides);
        surgers.forEach((b, i) => {
          const nominal = turretSurgeBearing(action, sides, i % sides);
          expect(Math.abs(angleOff(b.bearing, nominal))).toBeLessThanOrEqual(
            TURRET_SURGERS.jitterTurn * TAU + 0.02 * TAU + 1e-9,
          );
          // Never through the action's own sector.
          expect(Math.abs(angleOff(b.bearing, action))).toBeGreaterThan(SECTOR / 2);
        });
      }
    },
  );

  it('refuses surgers the engine cannot play, and a route keg on their side', () => {
    const surgers = (sides: number, count: number): TurretGroupDef => ({
      brick: 'surgers',
      sides,
      widthTurn: 0.05,
      entries: [{ ...WOLF, count }],
      gapMinTicks: 1,
      gapMaxTicks: 2,
    });
    const resolve =
      (group: TurretGroupDef, kegs: TurretKegLotDef[] = []) =>
      () =>
        resolveTurretPlan(scenario([{ coreDamage: 60, groups: [group], kegs }]));
    expect(resolve(surgers(3, 7))).toThrow(/bad surgers/);
    expect(resolve(surgers(0, 4))).toThrow(/bad surgers/);
    expect(resolve(surgers(TURRET_GROUP_LIMITS.surgerSides + 1, 9))).toThrow(/bad surgers/);
    expect(resolve(surgers(2, 4))).not.toThrow();
    expect(resolve(surgers(2, 4), [{ mode: 'path', group: 0, placement: 'front' }])).toThrow(
      /bad kegs/,
    );
  });
});

describe('the named group shapes', () => {
  it('lays the big one and the surge on the walkers machinery, from their sides', () => {
    const plan = resolveTurretPlan(TURRET_BRICKS_SCENARIO);
    const groups = plan.waves[1].groups;
    expect(groups.map((g) => g.brick)).toEqual([
      'pack',
      'walkers',
      'walkers',
      'walkers',
      'surgers',
      'sprint',
    ]);
    expect(groups[1]).toMatchObject({ sides: { kind: 'bunches', size: 3 } });
    expect(groups[2]).toMatchObject({ sides: { kind: 'arc', widthTurn: 0.08 } });
    expect(groups[3]).toMatchObject({ sides: { kind: 'flanks', count: 2, widthTurn: 0.06 } });
    const one = resolveTurretPlan(
      scenario([
        {
          coreDamage: 60,
          groups: [
            {
              brick: 'surge',
              sides: 1,
              widthTurn: 0.1,
              entries: [{ ...WOLF, count: 3 }],
              gapMinTicks: 1,
              gapMaxTicks: 2,
            },
          ],
        },
      ]),
    );
    expect(one.waves[0].groups[0]).toMatchObject({ sides: { kind: 'arc', widthTurn: 0.1 } });
  });

  it('refuses a big one with no large or huge monster or a bad band, and a surge from three sides', () => {
    const resolve = (group: TurretGroupDef) => () =>
      resolveTurretPlan(scenario([{ coreDamage: 60, groups: [group] }]));
    expect(
      resolve({
        brick: 'bigOne',
        widthTurn: 0.1,
        entries: [{ ...WOLF, count: 3 }],
        gapMinTicks: 1,
        gapMaxTicks: 2,
      }),
    ).toThrow(/a big one with no large or huge monster/);
    const troll = { templateId: 'fen_troll', count: 1, level: 11 };
    for (const band of [
      { widthTurn: 0, gapMinTicks: 1, gapMaxTicks: 2 },
      { widthTurn: 0.1, gapMinTicks: 3, gapMaxTicks: 2 },
    ])
      expect(resolve({ brick: 'bigOne', ...band, entries: [troll] })).toThrow(/a bad big one/);
    expect(
      resolve({
        brick: 'bigOne',
        widthTurn: 0.1,
        gapMinTicks: 1,
        gapMaxTicks: 2,
        entries: [troll],
      }),
    ).not.toThrow();
    expect(
      resolve({
        brick: 'surge',
        sides: 3 as 1,
        widthTurn: 0.1,
        entries: [{ ...WOLF, count: 3 }],
        gapMinTicks: 1,
        gapMaxTicks: 2,
      }),
    ).toThrow(/bad surge/);
  });
});

function kind(size: TurretSizeClass): TurretKind {
  return {
    templateId: 'forest_wolf',
    level: 2,
    sizeClass: size,
    maxHp: 1e6,
    marchSpeed: 0.0001,
    ...TURRET_SIZE_CLASSES[size],
  };
}

function testPlan(kinds: TurretKind[], waves: TurretWavePlan[], shockwave = 0): TurretPlan {
  return {
    scenarioId: 'test',
    integrity: 100,
    medals: TURRET_SCENARIO_STANDARD.medals,
    arsenal: { shockwave, fragmentation: 0 },
    resupplyWaves: [],
    chargeBonus: false,
    kinds,
    waves,
    bowling: { ...TURRET_BOWLING, enabled: false },
  };
}

describe('keg lots', () => {
  it("lays every lot of every wave at the wave's start, never mid-wave", () => {
    const plan = resolveTurretPlan(TURRET_BRICKS_SCENARIO);
    for (const seed of [1, 2, 3, 4]) {
      const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, START);
      const events = run(state, START + 20 * 60 * 3);
      const starts = events.filter((e) => e.event.type === 'waveStart').map((e) => e.tick);
      const placed = events.filter((e) => e.event.type === 'barrelsPlaced');
      expect(placed.length).toBeGreaterThan(0);
      for (const p of placed) expect(starts).toContain(p.tick);
    }
  });

  it('keeps the first random lot on the draws a ring of kegs always took', () => {
    const plan = resolveTurretPlan(TURRET_SCENARIO_STANDARD);
    const a = createTurretDefense(plan, { x: 0, z: 0 }, 9, START);
    const b = createTurretDefense(plan, { x: 0, z: 0 }, 9, START);
    const lot = plan.waves[0].kegs[0];
    if (lot.mode !== 'random') throw new Error('a ring wave');
    expect(placeTurretFieldKegs(a, plan.waves[0], START, flat)).toEqual(
      placeTurretBarrels(b, lot, START, flat),
    );
  });

  it("stands crown kegs just beyond the Shockwave's reach, in the band its thrown bodies come down in", () => {
    expect(TURRET_KEG_CROWN.minRadius).toBeGreaterThan(TURRET_SHOCKWAVE.reach);
    const wave = walkersWavePlan([0], { kegs: [{ mode: 'crown', count: 6 }] });
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const state = createTurretDefense(testPlan([kind('small')], [wave]), { x: 0, z: 0 }, seed, 0);
      const placed = placeTurretFieldKegs(state, wave, 0, flat);
      expect(placed.length).toBeGreaterThanOrEqual(5);
      for (const b of placed) {
        const d = Math.hypot(b.x, b.z);
        expect(d).toBeGreaterThanOrEqual(TURRET_KEG_CROWN.minRadius - 1e-9);
        expect(d).toBeLessThanOrEqual(TURRET_KEG_CROWN.maxRadius + 1e-9);
      }
    }
  });

  it.each(['medium', 'large', 'huge'] as const)(
    'lets a slam on a %s crowd at the foot throw bodies onto the crown kegs and light them',
    (size) => {
      let lit = 0;
      for (const seed of [1, 2, 3]) {
        const k = kind(size);
        const wave = walkersWavePlan([0], { kegs: [{ mode: 'crown', count: 8 }] });
        const state = createTurretDefense(testPlan([k], [wave], 1), { x: 0, z: 0 }, seed, 0);
        run(state, TURRET_TIMING.introTicks);
        for (const g of state.spawning) g.nextTick = Number.MAX_SAFE_INTEGER;
        const crown = new Set(state.barrels.map((b) => b.id));
        expect(crown.size).toBeGreaterThan(0);
        const reach = TURRET_ARENA.breachRadius + k.radius;
        for (let i = 0; i < 24; i++) {
          const a = ((i + 0.5) / 24) * TAU;
          state.monsters.push({
            id: state.nextMonsterId++,
            kind: 0,
            hp: k.maxHp,
            maxHp: k.maxHp,
            state: 'windup',
            seg: stillSegment(state.tick, 100_000, {
              x: Math.sin(a) * reach,
              y: 0,
              z: Math.cos(a) * reach,
            }),
            facing: 0,
            airSince: -1,
            throwX: 0,
            throwZ: 0,
            throwOpen: false,
            knocked: [],
          });
        }
        const slam = startTurretShockwave(state, state.tick, flat);
        expect(slam.ok).toBe(true);
        expect(slam.events.map((e) => e.type)).toEqual(['shockwave']);
        // The slam itself lights nothing: a keg lights when a thrown body strikes it.
        const events = run(state, state.tick + 20 * 3);
        const byBody = events.filter((e) => e.event.type === 'barrelLit' && crown.has(e.event.id));
        lit += byBody.length;
      }
      expect(lit).toBeGreaterThan(0);
    },
  );

  it.each(['medium', 'large', 'huge'] as const)(
    'lights a crown keg at either edge of the band when a slam throws a %s body down its line',
    (size) => {
      const k = kind(size);
      const footState = (seed: number, a: number) => {
        const state = createTurretDefense(
          testPlan([k], [walkersWavePlan([0])], 1),
          { x: 0, z: 0 },
          seed,
          0,
        );
        run(state, TURRET_TIMING.introTicks);
        for (const g of state.spawning) g.nextTick = Number.MAX_SAFE_INTEGER;
        const reach = TURRET_ARENA.breachRadius + k.radius;
        const id = state.nextMonsterId++;
        state.monsters.push({
          id,
          kind: 0,
          hp: k.maxHp,
          maxHp: k.maxHp,
          state: 'windup',
          seg: stillSegment(state.tick, 100_000, {
            x: Math.sin(a) * reach,
            y: 0,
            z: Math.cos(a) * reach,
          }),
          facing: 0,
          airSince: -1,
          throwX: 0,
          throwZ: 0,
          throwOpen: false,
          knocked: [],
        });
        return { state, id };
      };
      for (const seed of [1, 2, 3])
        for (const a of [0.4, 3.5]) {
          // A slam throws a little off the radial line: trace the body's own line first.
          const ref = footState(seed, a);
          expect(startTurretShockwave(ref.state, ref.state.tick, flat).ok).toBe(true);
          const line: { x: number; z: number }[] = [];
          const t0 = ref.state.tick;
          for (let t = t0 + 1; t <= t0 + 20 && line.length < 2; t++) {
            run(ref.state, t);
            const body = ref.state.monsters.find((m) => m.id === ref.id)!;
            const p = horizontalAt(body.seg, t);
            if (Math.hypot(p.x, p.z) >= 6 + 3 * line.length) line.push(p);
          }
          const [from, to] = line;
          const len = Math.hypot(to.x - from.x, to.z - from.z);
          const ux = (to.x - from.x) / len;
          const uz = (to.z - from.z) / len;
          for (const edge of [TURRET_KEG_CROWN.minRadius, TURRET_KEG_CROWN.maxRadius]) {
            const along = (at: number) => Math.hypot(from.x + ux * at, from.z + uz * at);
            let lo = 0;
            let hi = 30;
            for (let i = 0; i < 50; i++) {
              const mid = (lo + hi) / 2;
              if (along(mid) < edge) lo = mid;
              else hi = mid;
            }
            const { state } = footState(seed, a);
            const keg = standTurretBarrel(state, from.x + ux * lo, from.z + uz * lo, flat);
            startTurretShockwave(state, state.tick, flat);
            const events = run(state, state.tick + 20 * 3);
            const lit = events.some((e) => e.event.type === 'barrelLit' && e.event.id === keg.id);
            expect({ size, seed, a, edge, lit }).toEqual({ size, seed, a, edge, lit: true });
          }
        }
    },
  );

  it("stands a walking group's path kegs on its sides' axes inside the keg ring, each side in turn", () => {
    const flanks = { kind: 'flanks', count: 3, widthTurn: 0.1 } as const;
    const plan = resolveTurretPlan(
      scenario([
        {
          coreDamage: 60,
          groups: [walkers(6, { sides: flanks })],
          kegs: [
            { mode: 'path', group: 0, placement: 'front' },
            { mode: 'path', group: 0, placement: 'side' },
            { mode: 'path', group: 0, placement: 'axis', fromTower: 20 },
          ],
        },
      ]),
    );
    const wave = plan.waves[0];
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, START);
      const lanes = turretGroupLanes(state, 0, wave, 0);
      expect(lanes).toHaveLength(3);
      const placed = placeTurretPathKegs(state, wave, START, flat);
      expect(placed).toHaveLength(3);
      placed.forEach((b, k) => {
        const center = lanes[k].from + lanes[k].width / 2;
        const ux = Math.sin(center);
        const uz = Math.cos(center);
        const along = b.x * ux + b.z * uz;
        const across = Math.abs(b.x * uz - b.z * ux);
        if (k === 2) expect(along).toBeCloseTo(20, 9);
        else {
          expect(along).toBeGreaterThanOrEqual(TURRET_BARREL_RING.minRadius - 1e-9);
          expect(along).toBeLessThanOrEqual(TURRET_BARREL_RING.maxRadius + 1e-9);
        }
        const [lo, hi] =
          k === 1
            ? [TURRET_RALLY.sideOffsetMin, TURRET_RALLY.sideOffsetMax]
            : [TURRET_RALLY.axisOffsetMin, TURRET_RALLY.axisOffsetMax];
        expect(across).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(across).toBeLessThanOrEqual(hi + 1e-9);
      });
    }
    // The spot itself: on the near or the far side of the axis by the draw.
    const left = turretRouteKegSpot({ placement: 'front' }, 0, 0, 0, 0.2, 0);
    const right = turretRouteKegSpot({ placement: 'front' }, 0, 0, 0, 0.7, 0);
    expect(left.z).toBeCloseTo(TURRET_BARREL_RING.minRadius, 9);
    expect(Math.sign(left.x)).toBe(-Math.sign(right.x));
  });

  it("stands a front or side route keg in its lot's own distance band, never on a pack's", () => {
    const arc = { kind: 'arc', widthTurn: 0.1 } as const;
    const band = { minRadius: 36, maxRadius: 40 };
    const plan = resolveTurretPlan(
      scenario([
        {
          coreDamage: 60,
          groups: [walkers(6, { sides: arc })],
          kegs: [
            { mode: 'path', group: 0, placement: 'front', ...band },
            { mode: 'path', group: 0, placement: 'side', ...band },
          ],
        },
      ]),
    );
    const wave = plan.waves[0];
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, START);
      const lane = turretGroupLanes(state, 0, wave, 0)[0];
      const center = lane.from + lane.width / 2;
      const placed = placeTurretPathKegs(state, wave, START, flat);
      expect(placed).toHaveLength(2);
      for (const b of placed) {
        const along = b.x * Math.sin(center) + b.z * Math.cos(center);
        expect(along).toBeGreaterThanOrEqual(band.minRadius - 1e-9);
        expect(along).toBeLessThanOrEqual(band.maxRadius + 1e-9);
      }
    }
    const deep = turretRouteKegSpot({ placement: 'front', ...band }, 0, 0, 0, 0.2, 1);
    expect(deep.z).toBeCloseTo(band.maxRadius, 9);
    const resolve =
      (kegs: TurretKegLotDef[], groups = [walkers(6, { sides: arc })]) =>
      () =>
        resolveTurretPlan(scenario([{ coreDamage: 60, groups, kegs }]));
    const lot = (extra: object) =>
      ({ mode: 'path', group: 0, placement: 'front', ...extra }) as TurretKegLotDef;
    expect(resolve([lot({ minRadius: 20 })])).toThrow(/bad kegs/);
    expect(resolve([lot({ minRadius: 30, maxRadius: 20 })])).toThrow(/bad kegs/);
    expect(resolve([lot({ minRadius: -1, maxRadius: 20 })])).toThrow(/bad kegs/);
    const pack: TurretGroupDef = {
      brick: 'pack',
      entries: [{ ...WOLF, count: 4, leads: true }],
      minRadius: 30,
      maxRadius: 34,
      holdTicks: 80,
      spreadTicks: 40,
      widthTurn: 0.1,
      advanceScale: 1.2,
    };
    expect(resolve([lot({})], [pack])).not.toThrow();
    expect(resolve([lot(band)], [pack])).toThrow(/bad kegs/);
  });

  it('never stands a route keg where its blast reaches a pack gathering at its rally', () => {
    const plan = resolveTurretPlan(TURRET_BRICKS_SCENARIO);
    const wave = plan.waves[1];
    let placed = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, START);
      state.wave = 1;
      const rallies = openTurretRallies(state, wave);
      expect(rallies).toHaveLength(1);
      const kegs = placeTurretPathKegs(state, wave, START, flat);
      placed += kegs.length;
      const pack = wave.groups[0] as Extract<TurretGroupPlan, { brick: 'pack' }>;
      for (const keg of kegs) {
        expect(turretClearOfRallies(state, keg.x, keg.z)).toBe(true);
        expect(Math.hypot(keg.x - rallies[0].x, keg.z - rallies[0].z)).toBeGreaterThanOrEqual(
          TURRET_EXPLOSIVE_BARREL.blastRadius + turretRallyReach(pack.count),
        );
      }
    }
    expect(placed).toBeGreaterThan(24);
  });
});
