import { beforeAll, describe, expect, it } from 'vitest';
import { type Collider, queryOpenWorldColliders } from '../src/sim/colliders';
import { HARBOR_ROUTE_MARKERS } from '../src/sim/content/harbor_route_markers';
import {
  EASTBROOK_FERRY_HULL,
  WICKHARBOR_DRAKELANDS_FERRY,
} from '../src/sim/content/transport_ships';
import {
  WICKHARBOR_ARM_A0,
  WICKHARBOR_ARM_A1,
  WICKHARBOR_BERTH_HEAD_A1,
  WICKHARBOR_BOARDWALK_ABOVE_WATER,
  WICKHARBOR_FLIGHT_FIRST_RISE,
  WICKHARBOR_WHARF_ABOVE_WATER,
  WICKHARBOR_WHARF_DECKS,
  WICKHARBOR_WHARF_PROPS,
  type WickharborWharfDeck,
  wharfLocal,
  wharfPoint,
} from '../src/sim/content/wickharbor_wharf';
import { WYRMWATCH_HARBOR_DECKS, WYRMWATCH_RAIL_HEIGHT } from '../src/sim/content/wyrmwatch_harbor';
import { PROPS } from '../src/sim/data';
import { FERRY_PIER_DECK_ABOVE_WATER, FERRY_PIER_DECKS, FERRY_PIERS } from '../src/sim/ferry_piers';
import {
  GALE_HARBOR_DECKS,
  type GaleDeckDef,
  galeDeckAlong,
  galeDeckSurfaceAt,
} from '../src/sim/gale_harbor';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';
import { Sim } from '../src/sim/sim';
import { shipHullColliders } from '../src/sim/transport_ship';
import { wickharborWharfColliders } from '../src/sim/wickharbor_wharf';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The Wickharbor ferry wharf (src/sim/content/wickharbor_wharf.ts): one level plank deck (the
// pier, the berth head and the arm) at the ferry pier height, and a flight up from the town's
// shore boardwalk. It replaced four crossing decks and a jammed ship: this suite pins that no
// two floors of the harbor share a plank plane anywhere they overlap (the owner's report: the
// old boardwalk ramp and the deepwater pier crossing in an X at one height), the joins, the
// rails and solids, what stays clear, and walks from the town down to the gangplank with the
// real movement kernel.

const S = WORLD_SEED;
const terrainAt = (x: number, z: number): number => terrainHeight(x, z, S);
const aw = (x: number, z: number): number => groundHeight(x, z, S) - WATER_LEVEL;
const WICK = WICKHARBOR_DRAKELANDS_FERRY.berths[0];
const deckOf = (id: WickharborWharfDeck['id']): WickharborWharfDeck => {
  const d = WICKHARBOR_WHARF_DECKS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};
const BOARDWALK = GALE_HARBOR_DECKS.find((d) => d.x === 467.5 && d.z === 358);

/** A point in a deck's frame: along its heading and across it. */
function deckLocal(d: GaleDeckDef, x: number, z: number): { along: number; across: number } {
  const dx = x - d.x;
  const dz = z - d.z;
  return {
    along: dx * Math.sin(d.rot) + dz * Math.cos(d.rot),
    across: dx * Math.cos(d.rot) - dz * Math.sin(d.rot),
  };
}

/** The deck's plank height at (x, z), or null off it (strictly inside, by `inset`; a deck's
 *  cuts trim it, the harbor's own footprint test). */
function surfaceIn(d: GaleDeckDef, x: number, z: number, inset = 1e-6): number | null {
  const along = galeDeckAlong(d, x, z, inset);
  return along === null ? null : galeDeckSurfaceAt(d, along, terrainAt, WATER_LEVEL);
}

/** Clearance between a circle and a collider (negative = overlap). */
function clearance(x: number, z: number, r: number, c: Collider): number {
  if (c.type === 'circle') return Math.hypot(x - c.x, z - c.z) - c.r - r;
  const cos = Math.cos(-c.rot);
  const sin = Math.sin(-c.rot);
  const lx = (x - c.x) * cos + (z - c.z) * sin;
  const lz = -(x - c.x) * sin + (z - c.z) * cos;
  const dx = Math.max(0, Math.abs(lx) - c.hw);
  const dz = Math.max(0, Math.abs(lz) - c.hd);
  return Math.hypot(dx, dz) - r;
}

/** Every walkable floor of the harbor corner: Wickharbor's plank decks and the ferry pier
 *  surface query (the wharf's own decks among them). */
const FLOORS: readonly { name: string; deck: GaleDeckDef }[] = [
  ...GALE_HARBOR_DECKS.map((deck, i) => ({ name: `gale ${i}`, deck })),
  ...FERRY_PIER_DECKS.map((deck, i) => ({
    name: 'id' in deck ? String((deck as { id: string }).id) : `ferry ${i}`,
    deck,
  })),
];

/** The ferry zone the owner reported: the wharf's footprint and 6 yd round it. */
const ZONE = { x0: 446, x1: 490, z0: 363.6, z1: 396 };

/** The town walkway down to the berth: off the land at the head of the boardwalk's
 *  stair, down it onto the boardwalk, south to its end, up the flight, across the arm onto
 *  the pier, and out along it to the berth head behind the gangplank. */
const TOWN_TO_BERTH: readonly (readonly [number, number])[] = [
  [457.6, 361.3],
  [460.2, 361.5],
  [465.6, 361.9],
  [466.9, 363.5],
  [(() => wharfPoint(11.05, 12.0))().x, (() => wharfPoint(11.05, 12.0))().z],
  ...[
    [11.05, 10.5],
    [11.05, 8.2],
    [11.05, 4],
    [11.05, 0.2],
    [16, 0.2],
    [21.5, 0],
    [27.2, 0],
  ].map(([a, c]) => {
    const p = wharfPoint(a, c);
    return [p.x, p.z] as const;
  }),
];

describe('Wickharbor ferry wharf: the decks', () => {
  it('joins the ferry pier surface query after the plank-built piers and the Wyrmwatch harbor', () => {
    const start = FERRY_PIERS.flat().length + WYRMWATCH_HARBOR_DECKS.length;
    expect(FERRY_PIER_DECKS.slice(start)).toEqual(WICKHARBOR_WHARF_DECKS);
    // one plank height, the ferry pier height of every other berth
    expect(WICKHARBOR_WHARF_ABOVE_WATER).toBe(FERRY_PIER_DECK_ABOVE_WATER);
    for (const d of WICKHARBOR_WHARF_DECKS) {
      if (d.kind !== 'level') continue;
      expect([d.nearAboveWater, d.farAboveWater], d.id).toEqual([
        WICKHARBOR_WHARF_ABOVE_WATER,
        WICKHARBOR_WHARF_ABOVE_WATER,
      ]);
      for (const [a, c] of [
        [-0.9, -0.9],
        [0, 0],
        [0.9, 0.9],
      ]) {
        const p = {
          x: d.x + Math.sin(d.rot) * a * d.hl + Math.cos(d.rot) * c * d.hw,
          z: d.z + Math.cos(d.rot) * a * d.hl - Math.sin(d.rot) * c * d.hw,
        };
        expect(aw(p.x, p.z), d.id).toBeCloseTo(WICKHARBOR_WHARF_ABOVE_WATER, 6);
      }
    }
  });

  it('replaced the four crossing decks: no old deepwater pier, ramp, stair or landing stage', () => {
    // the decks the wharf superseded (x, z of each rectangle's centre)
    for (const [x, z] of [
      [464.1, 378.0],
      [459.75, 371.25],
      [477.2, 381.64],
      [480.38, 382.52],
    ]) {
      expect(
        GALE_HARBOR_DECKS.some((d) => d.x === x && d.z === z),
        `${x}, ${z}`,
      ).toBe(false);
    }
    // the rest of the harbor: two piers, the boardwalk, its two stairs, the Beacon dock with
    // its stair, and the great quay's two halves (tests/wickharbor_harbor.test.ts)
    expect(GALE_HARBOR_DECKS).toHaveLength(9);
    expect(BOARDWALK).toBeDefined();
  });

  it('lays the level decks edge to edge: one continuous plank field, nothing doubled', () => {
    const level = WICKHARBOR_WHARF_DECKS.filter((d) => d.kind === 'level');
    // the pier gives onto the head, and the arm onto the pier, along shared edges
    const pier = deckOf('pier').frame;
    const head = deckOf('berthHead').frame;
    const arm = deckOf('arm').frame;
    expect(pier.a1).toBe(head.a0);
    expect(arm.c0).toBe(pier.c1);
    expect(arm.a0).toBeGreaterThan(pier.a0);
    expect(arm.a1).toBeLessThan(pier.a1);
    // sampled: every point of the field lies on exactly one level deck
    for (let a = 0.35; a < WICKHARBOR_BERTH_HEAD_A1; a += 0.37) {
      for (let c = -5.45; c < 8.6; c += 0.31) {
        const p = wharfPoint(a, c);
        const on = level.filter((d) => surfaceIn(d, p.x, p.z) !== null).length;
        expect(on, `(${a.toFixed(2)}, ${c.toFixed(2)})`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('stands the flight on the boardwalk: a step above its planks, never in their plane', () => {
    if (!BOARDWALK) throw new Error('boardwalk');
    const flight = deckOf('flight');
    expect(flight.nearAboveWater).toBeCloseTo(
      WICKHARBOR_BOARDWALK_ABOVE_WATER + WICKHARBOR_FLIGHT_FIRST_RISE,
      9,
    );
    expect(flight.farAboveWater).toBe(WICKHARBOR_WHARF_ABOVE_WATER);
    // the boardwalk's planks lie where the model says they do
    expect(galeDeckSurfaceAt(BOARDWALK, 0, terrainAt, WATER_LEVEL) - WATER_LEVEL).toBeCloseTo(
      WICKHARBOR_BOARDWALK_ABOVE_WATER,
      6,
    );
    // the flight's whole foot edge rests on the boardwalk (no gap to fall through)
    for (let a = WICKHARBOR_ARM_A0 + 0.02; a <= WICKHARBOR_ARM_A1 - 0.02; a += 0.1) {
      const p = wharfPoint(a, flight.frame.c1 - 0.02);
      expect(surfaceIn(BOARDWALK, p.x, p.z, 0), `foot at along ${a}`).not.toBeNull();
    }
    // the first tread is a stride up, and the flight is a gentle climb
    expect(WICKHARBOR_FLIGHT_FIRST_RISE).toBeLessThan(MAX_STEP_HEIGHT / 2);
    const rise = (flight.farAboveWater ?? 0) - (flight.nearAboveWater ?? 0);
    expect(rise / (2 * flight.hl)).toBeLessThan(0.45);
  });

  it('stands clear of the terrain everywhere', () => {
    for (const d of WICKHARBOR_WHARF_DECKS) {
      let least = Number.POSITIVE_INFINITY;
      for (let a = -d.hl + 0.05; a <= d.hl - 0.05; a += 0.25) {
        for (let c = -d.hw + 0.05; c <= d.hw - 0.05; c += 0.25) {
          const x = d.x + Math.sin(d.rot) * a + Math.cos(d.rot) * c;
          const z = d.z + Math.cos(d.rot) * a - Math.sin(d.rot) * c;
          least = Math.min(
            least,
            galeDeckSurfaceAt(d, a, terrainAt, WATER_LEVEL) - terrainAt(x, z),
          );
        }
      }
      expect(least, d.id).toBeGreaterThan(0.35);
    }
  });
});

describe('Wickharbor ferry wharf: no two floors in one plane (the owner report)', () => {
  it('no two walkable floors of the ferry zone overlap at the same height anywhere', () => {
    const inZone = FLOORS.filter(({ deck }) => {
      const r = Math.hypot(deck.hl, deck.hw);
      return (
        deck.x + r > ZONE.x0 && deck.x - r < ZONE.x1 && deck.z + r > ZONE.z0 && deck.z - r < ZONE.z1
      );
    });
    // the zone holds the whole wharf and the boardwalk it joins
    expect(
      inZone.filter(({ deck }) => WICKHARBOR_WHARF_DECKS.includes(deck as never)),
    ).toHaveLength(WICKHARBOR_WHARF_DECKS.length);
    const clashes: string[] = [];
    for (let x = ZONE.x0; x <= ZONE.x1; x += 0.2) {
      for (let z = ZONE.z0; z <= ZONE.z1; z += 0.2) {
        const here: { name: string; y: number }[] = [];
        for (const { name, deck } of inZone) {
          const y = surfaceIn(deck, x, z);
          if (y !== null) here.push({ name, y });
        }
        for (let i = 0; i < here.length; i++) {
          for (let j = i + 1; j < here.length; j++) {
            if (Math.abs(here[i].y - here[j].y) < 0.05) {
              clashes.push(
                `${here[i].name} x ${here[j].name} at (${x.toFixed(1)}, ${z.toFixed(1)})`,
              );
            }
          }
        }
      }
    }
    expect(clashes.slice(0, 8)).toEqual([]);
  });

  it('the wharf never shares a plank plane with ANY floor of the harbor, near or far', () => {
    for (const w of WICKHARBOR_WHARF_DECKS) {
      for (const { name, deck } of FLOORS) {
        if (deck === w) continue;
        for (let a = -w.hl + 0.1; a <= w.hl - 0.1; a += 0.3) {
          for (let c = -w.hw + 0.1; c <= w.hw - 0.1; c += 0.3) {
            const x = w.x + Math.sin(w.rot) * a + Math.cos(w.rot) * c;
            const z = w.z + Math.cos(w.rot) * a - Math.sin(w.rot) * c;
            const other = surfaceIn(deck, x, z);
            if (other === null) continue;
            const mine = galeDeckSurfaceAt(w, a, terrainAt, WATER_LEVEL);
            expect(Math.abs(other - mine), `${w.id} x ${name}`).toBeGreaterThan(0.2);
          }
        }
      }
    }
  });

  it('took the ship that lay jammed behind the crossing off the water', () => {
    const ships = (PROPS.decorProps ?? []).filter((d) => d.key === 'hexShipBlue');
    expect(ships.some((d) => d.x === 475.1 && d.z === 368.7)).toBe(false);
    // no moored hull lies within reach of the wharf (the model's hull is 13.5 long, 6 wide)
    for (const d of ships) {
      for (const w of WICKHARBOR_WHARF_DECKS) {
        const l = deckLocal(w, d.x, d.z);
        const gap = Math.hypot(
          Math.max(0, Math.abs(l.along) - w.hl),
          Math.max(0, Math.abs(l.across) - w.hw),
        );
        expect(gap, `ship at (${d.x}, ${d.z}) vs ${w.id}`).toBeGreaterThan(9);
      }
    }
  });
});

describe('Wickharbor ferry wharf: rails and solids', () => {
  const colliders = wickharborWharfColliders(S);

  it('rails every drop a rail height over the planks, opening only where a walk runs on', () => {
    const railCount = colliders.length - WICKHARBOR_WHARF_PROPS.length;
    expect(railCount).toBeGreaterThan(50);
    for (const c of colliders.slice(0, railCount)) {
      const under = groundHeight(c.x, c.z, S);
      expect(under - WATER_LEVEL, `rail at (${c.x}, ${c.z})`).toBeGreaterThan(0.85);
      expect(c.moveTopY ?? 0).toBeGreaterThanOrEqual(under + WYRMWATCH_RAIL_HEIGHT - 1e-6);
      expect(c.standable).toBeUndefined();
    }
    // every edge of the level field is railed except the openings: the berth face (an open
    // quay the ship lies against), the arm's mouth onto the pier, and the flight's foot on
    // the boardwalk
    const level = WICKHARBOR_WHARF_DECKS.filter((d) => d.kind !== 'flight');
    const open: string[] = [];
    for (const d of level) {
      const { a0, a1, c0, c1 } = d.frame;
      const edges: [number, number, number, number][] = [
        [a0, c0, a1, c0],
        [a0, c1, a1, c1],
        [a0, c0, a0, c1],
        [a1, c0, a1, c1],
      ];
      for (const [ea0, ec0, ea1, ec1] of edges) {
        const n = Math.ceil(Math.hypot(ea1 - ea0, ec1 - ec0) / 0.25);
        for (let k = 0; k <= n; k++) {
          const a = ea0 + ((ea1 - ea0) * k) / n;
          const c = ec0 + ((ec1 - ec0) * k) / n;
          // a point just outside the edge: is it another floor, or a rail?
          const outA = a === a0 && ea0 === ea1 ? a - 0.1 : a === a1 && ea0 === ea1 ? a + 0.1 : a;
          const outC = c === c0 && ec0 === ec1 ? c - 0.1 : c === c1 && ec0 === ec1 ? c + 0.1 : c;
          const out = wharfPoint(outA, outC);
          const onFloor = FLOORS.some(({ deck }) => surfaceIn(deck, out.x, out.z, 0) !== null);
          if (onFloor) continue;
          const p = wharfPoint(a, c);
          const railed = colliders.some((col) => clearance(p.x, p.z, 0.05, col) < 0);
          if (!railed) open.push(`${d.id} (${a.toFixed(2)}, ${c.toFixed(2)})`);
        }
      }
    }
    // the berth face is open between the head's end rails, and nothing else is
    const unexpected = open.filter((s) => {
      const m = /\(([-\d.]+), ([-\d.]+)\)/.exec(s);
      if (!m) return true;
      const a = Number(m[1]);
      const c = Number(m[2]);
      // (the end rails stop 0.2 short of the face, clear of the hull's swing)
      return !(a >= WICKHARBOR_BERTH_HEAD_A1 - 0.25);
    });
    expect(unexpected).toEqual([]);
    expect(open.length).toBeGreaterThan(10);
  });

  it('solidifies every prop: cargo and bollards can be stood on, the lantern posts are full height', () => {
    const props = colliders.slice(colliders.length - WICKHARBOR_WHARF_PROPS.length);
    props.forEach((c, i) => {
      const p = WICKHARBOR_WHARF_PROPS[i];
      expect(c.x).toBe(p.x);
      expect(c.z).toBe(p.z);
      const base = groundHeight(p.x, p.z, S);
      expect(base - WATER_LEVEL, p.kind).toBeCloseTo(WICKHARBOR_WHARF_ABOVE_WATER, 6);
      expect(c.cameraTopY).toBeCloseTo(base + p.height, 6);
      if (p.kind === 'lanternPost') expect(c.moveTopY).toBeUndefined();
      else expect(c.standable, p.kind).toBe(true);
    });
  });

  it('keeps the walk clear: the town walkway and the berth head pass every solid', () => {
    for (let i = 0; i + 1 < TOWN_TO_BERTH.length; i++) {
      const [x0, z0] = TOWN_TO_BERTH[i];
      const [x1, z1] = TOWN_TO_BERTH[i + 1];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        for (const c of colliders) {
          expect(clearance(x, z, 0.5, c), `(${x.toFixed(2)}, ${z.toFixed(2)})`).toBeGreaterThan(
            0.05,
          );
        }
      }
    }
  });

  it('joins the live static grid, ungated', () => {
    for (const c of colliders) {
      const near: Collider[] = [];
      queryOpenWorldColliders(S, c.x - 0.1, c.z - 0.1, c.x + 0.1, c.z + 0.1, near);
      expect(
        near.some((n) => n.x === c.x && n.z === c.z && n.gate === undefined),
        `(${c.x}, ${c.z})`,
      ).toBe(true);
    }
  });
});

describe('Wickharbor ferry wharf: what stays clear', () => {
  it('keeps off the docked ferry: its hull clears every plank and solid of the wharf', () => {
    const docked = shipHullColliders(EASTBROOK_FERRY_HULL, {
      x: WICK.x,
      z: WICK.z,
      rot: WICK.rot,
      baseY: WATER_LEVEL,
    });
    const colliders = wickharborWharfColliders(S);
    EASTBROOK_FERRY_HULL.volumes.forEach((v, i) => {
      if (v.kind === 'gangplank' || v.kind === 'gangway') return;
      for (const c of colliders) {
        expect(clearance(c.x, c.z, 0.2, docked[i]), `${v.id} vs (${c.x}, ${c.z})`).toBeGreaterThan(
          0,
        );
      }
    });
    // the berth head's face stops short of the hull's widest beam
    const hullSide = wharfLocal(WICK.x, WICK.z).along - 5.15;
    expect(WICKHARBOR_BERTH_HEAD_A1).toBeLessThan(hullSide - 0.5);
  });

  it('lays the berth head under the gangplank, which lands a stride above it', () => {
    const plankOuter = wharfLocal(
      WICK.x + Math.cos(WICK.rot) * 8.3,
      WICK.z - Math.sin(WICK.rot) * 8.3,
    );
    const plankInner = wharfLocal(
      WICK.x + Math.cos(WICK.rot) * 7.1,
      WICK.z - Math.sin(WICK.rot) * 7.1,
    );
    const head = deckOf('berthHead').frame;
    for (const l of [plankOuter, plankInner]) {
      expect(l.along).toBeGreaterThan(head.a0);
      expect(l.along).toBeLessThan(head.a1);
      expect(Math.abs(l.across)).toBeLessThan(2);
    }
    const rise = EASTBROOK_FERRY_HULL.mainDeckY - 0.44 - WICKHARBOR_WHARF_ABOVE_WATER;
    expect(rise).toBeGreaterThan(0);
    expect(rise).toBeLessThan(MAX_STEP_HEIGHT);
    // the ship's landing spot is on the pier, clear of every solid
    expect(aw(WICK.landing.x, WICK.landing.z)).toBeCloseTo(WICKHARBOR_WHARF_ABOVE_WATER, 6);
    for (const c of wickharborWharfColliders(S)) {
      expect(clearance(WICK.landing.x, WICK.landing.z, 0.5, c)).toBeGreaterThan(0.2);
    }
  });

  it('keeps the route marker where it stood, on the pier, clear of the rails', () => {
    const m = HARBOR_ROUTE_MARKERS.find((x) => x.berth === 'wickharbor');
    if (!m) throw new Error('marker');
    expect([m.x, m.z]).toEqual([460.29, 375.28]);
    expect(surfaceIn(deckOf('pier'), m.x, m.z)).not.toBeNull();
    for (const c of wickharborWharfColliders(S)) {
      expect(clearance(m.x, m.z, 0.35, c), `(${c.x}, ${c.z})`).toBeGreaterThan(0.5);
    }
  });
});

describe('Wickharbor ferry wharf: walking it (the real movement kernel)', () => {
  let sim: Sim;
  const idle = {
    forward: false,
    back: false,
    turnLeft: false,
    turnRight: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
    dive: false,
    surface: false,
  };

  function place(x: number, z: number): void {
    const p = sim.player;
    p.pos = { x, y: groundHeight(x, z, S), z };
    p.prevPos = { ...p.pos };
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.onGround = true;
  }

  /** Walk toward (x, z); returns where it ended and the lowest the feet went under the
   *  ground at any tick (a fall shows as a large negative). */
  function walk(tx: number, tz: number, jump = false, maxTicks = 300) {
    const p = sim.player;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('meta');
    let sink = 0;
    for (let i = 0; i < maxTicks; i++) {
      const dx = tx - p.pos.x;
      const dz = tz - p.pos.z;
      if (Math.hypot(dx, dz) < 0.25) break;
      p.facing = Math.atan2(dx, dz);
      Object.assign(meta.moveInput, { ...idle, forward: true, jump: jump && p.onGround });
      sim.tick();
      sink = Math.min(sink, p.pos.y - groundHeight(p.pos.x, p.pos.z, S));
    }
    Object.assign(meta.moveInput, idle);
    for (let i = 0; i < 10; i++) sim.tick();
    return { x: p.pos.x, z: p.pos.z, y: p.pos.y - WATER_LEVEL, sink };
  }

  beforeAll(() => {
    sim = new Sim({ seed: S, playerClass: 'warrior' });
    sim.setPlayerLevel(60);
  });

  it('walks from the town down the boardwalk and the flight to the berth head, and back', () => {
    place(TOWN_TO_BERTH[0][0], TOWN_TO_BERTH[0][1]);
    const legs = [...TOWN_TO_BERTH.slice(1), ...[...TOWN_TO_BERTH].reverse().slice(1)];
    for (const [x, z] of legs) {
      const end = walk(x, z);
      expect(Math.hypot(end.x - x, end.z - z), `to (${x}, ${z})`).toBeLessThan(0.4);
      expect(Math.abs(end.y - aw(end.x, end.z)), `at (${x}, ${z})`).toBeLessThan(0.05);
      expect(end.sink, `to (${x}, ${z})`).toBeGreaterThan(-0.05);
    }
  }, 120_000);

  it('the rails hold: walking or jumping at every drop keeps the player on the planks', () => {
    const W = WICKHARBOR_WHARF_ABOVE_WATER;
    // (start and push toward, in the wharf frame; the height the player must keep)
    const drops: [number, number, number, number][] = [
      [14, -1.8, 14, -8], // the pier's south side
      [18, 1.8, 18, 8], // its north side, past the arm
      [5, 1.0, 5, 8], // ...and short of the arm
      [2.0, 0.2, -4, 0.2], // the pier's root, toward the bluff
      [28.1, 3.6, 28.1, 10], // the berth head's north end (its south end holds the cargo)
      [10.3, 6.5, 4, 6.5], // the arm's west side
      [11.8, 6.5, 18, 6.5], // ...its east side
    ];
    const colliders = wickharborWharfColliders(S);
    for (const jump of [false, true]) {
      for (const [a, c, ta, tc] of drops) {
        const start = wharfPoint(a, c);
        const to = wharfPoint(ta, tc);
        for (const col of colliders) {
          expect(clearance(start.x, start.z, 0.5, col), `start (${a}, ${c})`).toBeGreaterThan(0);
        }
        place(start.x, start.z);
        const end = walk(to.x, to.z, jump, 60);
        expect(end.y, `${jump ? 'jump' : 'walk'} from (${a}, ${c})`).toBeGreaterThan(W - 0.05);
      }
    }
    // the flight's sides: the player stays on the flight's planks (whatever height they reach)
    for (const jump of [false, true]) {
      for (const [a, c, ta] of [
        [10.1, 10.6, 4],
        [12.0, 10.6, 18],
      ]) {
        const start = wharfPoint(a, c);
        const to = wharfPoint(ta, c);
        place(start.x, start.z);
        const y0 = sim.player.pos.y - WATER_LEVEL;
        const end = walk(to.x, to.z, jump, 60);
        expect(end.y, `flight side from (${a}, ${c})`).toBeGreaterThan(y0 - 0.5);
      }
    }
  }, 120_000);
});
