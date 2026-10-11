import { beforeAll, describe, expect, it } from 'vitest';
import { type Collider, queryOpenWorldColliders } from '../src/sim/colliders';
import { DRAKELANDS_ZONE } from '../src/sim/content/drakelands';
import { HARBOR_ROUTE_MARKERS } from '../src/sim/content/harbor_route_markers';
import { TRANSPORT_ROUTES, TRANSPORT_SHIP_HULLS } from '../src/sim/content/transport_ships';
import {
  WYRMWATCH_HARBOR_DECKS,
  WYRMWATCH_HARBOR_PATH,
  WYRMWATCH_HARBOR_PATH_HALF_WIDTH,
  WYRMWATCH_HARBOR_PROPS,
  WYRMWATCH_HARBOR_RAILS,
  WYRMWATCH_LANDING_ABOVE_WATER,
  WYRMWATCH_QUAY_ABOVE_WATER,
  WYRMWATCH_RAIL_HEIGHT,
  WYRMWATCH_TOP_ABOVE_WATER,
  type WyrmwatchHarborDeck,
} from '../src/sim/content/wyrmwatch_harbor';
import { FERRY_PIER_DECK_ABOVE_WATER, FERRY_PIER_DECKS, FERRY_PIERS } from '../src/sim/ferry_piers';
import { galeDeckSurfaceAt } from '../src/sim/gale_harbor';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';
import { Sim } from '../src/sim/sim';
import { shipHullColliders } from '../src/sim/transport_ship';
import {
  generateDecorationsInBounds,
  groundHeight,
  terrainHeight,
  WATER_LEVEL,
} from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import {
  WYRMWATCH_RAIL_SEGMENT,
  wyrmwatchHarborColliders,
  wyrmwatchRailColliders,
} from '../src/sim/wyrmwatch_harbor';

// The Wyrmwatch cliff harbor at the Drakelands ferry berth (src/sim/content/wyrmwatch_harbor.ts):
// quays at the waterline, a switchback stair up the cliff, a top landing with the harbor gate,
// and a flagstone path toward Wyrmwatch. Pins the decks against the terrain, the joins between
// them, the rails and solids (src/sim/wyrmwatch_harbor.ts), what stays clear (the ferry, the
// route marker, the rocks on land), and walks the whole climb with the real movement kernel.

const S = WORLD_SEED;
const aw = (x: number, z: number): number => groundHeight(x, z, S) - WATER_LEVEL;
const deck = (id: WyrmwatchHarborDeck['id']): WyrmwatchHarborDeck => {
  const d = WYRMWATCH_HARBOR_DECKS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};
/** A deck-frame point (the sim's along/across convention) to world. */
const at = (d: WyrmwatchHarborDeck, along: number, across: number) => ({
  x: d.x + Math.sin(d.rot) * along + Math.cos(d.rot) * across,
  z: d.z + Math.cos(d.rot) * along - Math.sin(d.rot) * across,
});
const terrainAt = (x: number, z: number): number => terrainHeight(x, z, S);

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

/** The walk: off the ship's landing, along the pier, round the south quay, up both
 *  flights, over the top landing, through the gate and along the path to its end. */
const ROUTE: readonly (readonly [number, number])[] = [
  [503.5, 1899.2],
  [494.5, 1899.4],
  [495.8, 1904],
  [495.8, 1909.0],
  [495.8, 1913.4],
  [495.8, 1918.8],
  [493.6, 1919.2],
  [491.4, 1918.6],
  [491.4, 1913.9],
  [491.4, 1909.8],
  [490.5, 1908.4],
  [488.0, 1908.4],
  ...WYRMWATCH_HARBOR_PATH.slice(1),
];

describe('Wyrmwatch cliff harbor: the decks', () => {
  it('joins the ferry pier surface query, in its own list after the plank-built piers', () => {
    const start = FERRY_PIERS.flat().length;
    expect(FERRY_PIER_DECKS.slice(start, start + WYRMWATCH_HARBOR_DECKS.length)).toEqual(
      WYRMWATCH_HARBOR_DECKS,
    );
    // the quays stand at the pier's own plank height
    expect(WYRMWATCH_QUAY_ABOVE_WATER).toBe(FERRY_PIER_DECK_ABOVE_WATER);
  });

  it('stands every deck at its authored height, the flights climbing between their landings', () => {
    const levels: Record<WyrmwatchHarborDeck['id'], [number, number]> = {
      northYard: [WYRMWATCH_QUAY_ABOVE_WATER, WYRMWATCH_QUAY_ABOVE_WATER],
      southQuay: [WYRMWATCH_QUAY_ABOVE_WATER, WYRMWATCH_QUAY_ABOVE_WATER],
      flightOne: [WYRMWATCH_QUAY_ABOVE_WATER, WYRMWATCH_LANDING_ABOVE_WATER],
      turnLanding: [WYRMWATCH_LANDING_ABOVE_WATER, WYRMWATCH_LANDING_ABOVE_WATER],
      flightTwo: [WYRMWATCH_LANDING_ABOVE_WATER, WYRMWATCH_TOP_ABOVE_WATER],
      topLanding: [WYRMWATCH_TOP_ABOVE_WATER, WYRMWATCH_TOP_ABOVE_WATER],
      houseFloor: [WYRMWATCH_QUAY_ABOVE_WATER, WYRMWATCH_QUAY_ABOVE_WATER],
    };
    for (const d of WYRMWATCH_HARBOR_DECKS) {
      const [near, far] = levels[d.id];
      const a = at(d, -d.hl + 0.3, 0);
      const b = at(d, d.hl - 0.3, 0);
      const t = 0.3 / (2 * d.hl);
      expect(aw(a.x, a.z), d.id).toBeCloseTo(near + (far - near) * t, 5);
      expect(aw(b.x, b.z), d.id).toBeCloseTo(far - (far - near) * t, 5);
    }
  });

  it('stands clear of the terrain everywhere (the top landing meets the crest, never buried)', () => {
    for (const d of WYRMWATCH_HARBOR_DECKS) {
      let least = Number.POSITIVE_INFINITY;
      for (let a = -d.hl + 0.05; a <= d.hl - 0.05; a += 0.25) {
        for (let c = -d.hw + 0.05; c <= d.hw - 0.05; c += 0.25) {
          const p = at(d, a, c);
          const top = galeDeckSurfaceAt(d, a, terrainAt, WATER_LEVEL);
          least = Math.min(least, top - terrainAt(p.x, p.z));
        }
      }
      expect(least, d.id).toBeGreaterThan(0.2);
    }
    // the top landing's west edge lies on the cliff top: the land just past it is
    // within a stride of the planks, so the arrival steps straight onto the plateau
    const top = deck('topLanding');
    for (let c = -1.8; c <= 1.8; c += 0.3) {
      const edge = at(top, 0, 0);
      const x = top.x - top.hw - 0.4;
      const z = edge.z + c;
      expect(Math.abs(aw(x, z) - WYRMWATCH_TOP_ABOVE_WATER), `crest at z ${z}`).toBeLessThan(0.7);
    }
  });

  it('climbs in gentle flights, well under the climb limit, every tread a stride', () => {
    for (const id of ['flightOne', 'flightTwo'] as const) {
      const d = deck(id);
      const rise = (d.farAboveWater ?? 0) - (d.nearAboveWater ?? 0);
      expect(rise, id).toBeGreaterThan(2.5);
      expect(rise / (2 * d.hl), id).toBeLessThan(0.45);
      expect(rise / (2 * d.hl)).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
      // wide enough for two abreast (a body is a yard across)
      expect(d.hw * 2, id).toBeGreaterThanOrEqual(3.2);
    }
  });

  it('leaves no step, gap or drop anywhere along the climb', () => {
    for (let i = 0; i + 1 < ROUTE.length; i++) {
      const [x0, z0] = ROUTE[i];
      const [x1, z1] = ROUTE[i + 1];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.1);
      let prev = aw(x0, z0);
      for (let k = 1; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        const y = aw(x, z);
        // never over the water, never a step a body cannot take in its stride
        expect(y, `(${x.toFixed(2)}, ${z.toFixed(2)})`).toBeGreaterThan(2);
        expect(Math.abs(y - prev), `(${x.toFixed(2)}, ${z.toFixed(2)})`).toBeLessThan(
          MAX_STEP_HEIGHT / 3,
        );
        prev = y;
      }
    }
  });
});

describe('Wyrmwatch cliff harbor: rails and solids', () => {
  const colliders = wyrmwatchHarborColliders(S);

  it('cuts each rail into short boxes that follow the planks, a rail height over them', () => {
    const rails = WYRMWATCH_HARBOR_RAILS.flatMap((r) => wyrmwatchRailColliders(r, S));
    expect(rails.length).toBeGreaterThan(60);
    for (const c of rails) {
      if (c.type !== 'obb') throw new Error('rail box');
      expect(2 * (c.hd - c.hw)).toBeLessThanOrEqual(WYRMWATCH_RAIL_SEGMENT + 1e-9);
      const under = groundHeight(c.x, c.z, S);
      // on planks, above the water, and topped over them (a jump never clears it)
      expect(under - WATER_LEVEL).toBeGreaterThan(2.5);
      expect(c.moveTopY ?? 0).toBeGreaterThanOrEqual(under + WYRMWATCH_RAIL_HEIGHT - 1e-6);
      expect(c.standable).toBeUndefined();
      // seen and cast through above the bottom rail
      expect(c.cameraTopY ?? 0).toBeLessThan(under + 0.5);
    }
  });

  it('solidifies every prop: cargo can be stood on, the rest is full height', () => {
    // the rails first, then the props (the house's own colliders follow them)
    const rails = WYRMWATCH_HARBOR_RAILS.flatMap((r) => wyrmwatchRailColliders(r, S)).length;
    const props = colliders.slice(rails, rails + WYRMWATCH_HARBOR_PROPS.length);
    props.forEach((c, i) => {
      const p = WYRMWATCH_HARBOR_PROPS[i];
      expect(c.x).toBe(p.x);
      expect(c.z).toBe(p.z);
      const base = groundHeight(p.x, p.z, S);
      expect(c.cameraTopY).toBeCloseTo(base + p.height, 6);
      if (p.standable) {
        expect(c.standable, p.kind).toBe(true);
        expect(c.moveTopY).toBeCloseTo(base + p.height, 6);
      } else {
        expect(c.moveTopY, p.kind).toBeUndefined();
      }
    });
  });

  it('keeps the walkway clear: the route, the house door and the gate pass every solid', () => {
    // a body is 0.5 across its radius: the route's centre line keeps that from all of them
    const doorWalk: [number, number][] = [
      [491, 1899.4],
      [491, 1896.6],
      [490.2, 1893],
      [490.2, 1891.0],
    ];
    for (const path of [ROUTE, doorWalk]) {
      for (let i = 0; i + 1 < path.length; i++) {
        const [x0, z0] = path[i];
        const [x1, z1] = path[i + 1];
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

describe('Wyrmwatch cliff harbor: what stays clear', () => {
  it('keeps off the ferry: the docked hull, its gangplank and its lanes', () => {
    const route = TRANSPORT_ROUTES.find((r) => r.id === 'wickharborDrakelands');
    if (!route) throw new Error('route');
    const berth = route.berths[1];
    const hull = shipHullColliders(TRANSPORT_SHIP_HULLS[route.ship], {
      x: berth.x,
      z: berth.z,
      rot: berth.rot,
      baseY: WATER_LEVEL,
    });
    for (const d of WYRMWATCH_HARBOR_DECKS) {
      for (const [a, c] of [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ]) {
        const p = at(d, a * d.hl, c * d.hw);
        for (const h of hull) expect(clearance(p.x, p.z, 0, h), d.id).toBeGreaterThan(6);
      }
    }
    for (const c of wyrmwatchHarborColliders(S)) {
      for (const h of hull) {
        expect(
          clearance(c.x, c.z, c.type === 'circle' ? c.r : Math.max(c.hw, c.hd), h),
        ).toBeGreaterThan(5);
      }
    }
    // the ship swings in north of the pier and leaves south of it, all east of x 504:
    // the harbor's seaward edge stands well west of that water
    const east = Math.max(...WYRMWATCH_HARBOR_DECKS.map((d) => d.x + d.hw));
    expect(east).toBeLessThanOrEqual(498.5);
  });

  it('keeps the route marker standing clear on its pier', () => {
    const m = HARBOR_ROUTE_MARKERS.find((x) => x.berth === 'drakelands');
    if (!m) throw new Error('marker');
    for (const c of wyrmwatchHarborColliders(S)) {
      expect(clearance(m.x, m.z, 0.35, c), `(${c.x}, ${c.z})`).toBeGreaterThan(2);
    }
    // nothing of the harbor stands in front of its board (east along the pier edge)
    for (const p of WYRMWATCH_HARBOR_PROPS) {
      expect(p.x < m.x - 1 || Math.abs(p.z - m.z) > 3, p.kind).toBe(true);
    }
  });

  it('moves nothing on land: the rocks by the old stair head and along the path still stand', () => {
    const rocks = generateDecorationsInBounds(S, { minX: 430, maxX: 500, minZ: 1880, maxZ: 1925 })
      .filter((d) => d.kind === 'rock')
      .map((d) => [Math.round(d.x * 10) / 10, Math.round(d.z * 10) / 10]);
    for (const want of [
      [476.6, 1896.2],
      [479.4, 1897.3],
      [462.3, 1904.3],
      [443, 1898.8],
      [439.6, 1902.1],
    ]) {
      expect(rocks, `rock at ${want}`).toContainEqual(want);
    }
    // ...and none of them lies under the harbor's planks or on the path
    for (const [x, z] of rocks) {
      for (const d of WYRMWATCH_HARBOR_DECKS) {
        const dx = x - d.x;
        const dz = z - d.z;
        const along = dx * Math.sin(d.rot) + dz * Math.cos(d.rot);
        const across = dx * Math.cos(d.rot) - dz * Math.sin(d.rot);
        expect(Math.abs(along) > d.hl + 1 || Math.abs(across) > d.hw + 1).toBe(true);
      }
    }
  });

  it('lays the path over walkable open ground and stops short of the Wyrmwatch hub', () => {
    const hub = DRAKELANDS_ZONE.hub;
    if (!hub) throw new Error('hub');
    const harbor = new Set(wyrmwatchHarborColliders(S).map((c) => `${c.x},${c.z}`));
    for (let i = 0; i + 1 < WYRMWATCH_HARBOR_PATH.length; i++) {
      const [x0, z0] = WYRMWATCH_HARBOR_PATH[i];
      const [x1, z1] = WYRMWATCH_HARBOR_PATH[i + 1];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5);
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        expect(aw(x, z)).toBeGreaterThan(7);
        const near: Collider[] = [];
        queryOpenWorldColliders(S, x - 4, z - 4, x + 4, z + 4, near);
        for (const c of near) {
          // the world's rocks and trees keep off the path; the harbor's own lanterns
          // stand beside it
          const room = harbor.has(`${c.x},${c.z}`) ? 0.3 : 0.5;
          expect(
            clearance(x, z, WYRMWATCH_HARBOR_PATH_HALF_WIDTH, c),
            `(${x.toFixed(1)}, ${z.toFixed(1)})`,
          ).toBeGreaterThan(room);
        }
      }
    }
    const [ex, ez] = WYRMWATCH_HARBOR_PATH[WYRMWATCH_HARBOR_PATH.length - 1];
    expect(Math.hypot(ex - hub.x, ez - hub.z)).toBeGreaterThan(hub.radius + 8);
  });
});

describe('Wyrmwatch cliff harbor: walking it (the real movement kernel)', () => {
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

  /** Walk toward (x, z); returns where it ended and the lowest the feet went
   *  under the ground at any tick (a fall shows as a large negative). */
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

  it('walks from the ship landing up both flights to the gate and along the path, and back', () => {
    place(ROUTE[0][0], ROUTE[0][1]);
    const legs = [...ROUTE.slice(1), ...[...ROUTE].reverse().slice(1)];
    for (const [x, z] of legs) {
      const end = walk(x, z);
      expect(Math.hypot(end.x - x, end.z - z), `to (${x}, ${z})`).toBeLessThan(0.4);
      expect(Math.abs(end.y - aw(end.x, end.z)), `at (${x}, ${z})`).toBeLessThan(0.05);
      // never dropped through or off anything on the way
      expect(end.sink, `to (${x}, ${z})`).toBeGreaterThan(-0.05);
    }
  }, 120_000);

  it("reaches the Harbormaster's House door from the pier", () => {
    place(494.5, 1899.4);
    for (const [x, z] of [
      [491, 1899.4],
      [491, 1896.6],
      [490.2, 1893],
      [490.2, 1891.0],
    ] as const) {
      const end = walk(x, z);
      expect(Math.hypot(end.x - x, end.z - z)).toBeLessThan(0.4);
      expect(end.y).toBeCloseTo(WYRMWATCH_QUAY_ABOVE_WATER, 3);
    }
  }, 60_000);

  it('the rails hold: walking or jumping at every drop keeps the player on the planks', () => {
    // (start, push toward, the height the player must keep)
    const drops: [number, number, number, number, number][] = [
      [496.5, 1913.4, 502, 1913.4, 0], // flight one, seaward side
      [495.1, 1913.4, 490, 1913.4, 0], // flight one, toward the gap between the flights
      [493.6, 1919.9, 493.6, 1926, WYRMWATCH_LANDING_ABOVE_WATER], // the turning landing's end
      [496.5, 1919.5, 502, 1919.5, WYRMWATCH_LANDING_ABOVE_WATER], // ...its seaward side
      [490.7, 1913.9, 486, 1913.9, 0], // flight two, cliff side
      [491.8, 1907.2, 491.8, 1902, WYRMWATCH_TOP_ABOVE_WATER], // the top landing, north edge
      [491.8, 1908.4, 497, 1908.4, WYRMWATCH_TOP_ABOVE_WATER], // ...its seaward edge
      [494.0, 1908.6, 489, 1908.6, WYRMWATCH_QUAY_ABOVE_WATER], // the south quay's cliff side
      [490.9, 1899.2, 486, 1899.2, WYRMWATCH_QUAY_ABOVE_WATER], // the pier's root at the cliff
      [489.0, 1896.3, 489.0, 1901, WYRMWATCH_QUAY_ABOVE_WATER], // the north yard's cliff side
    ];
    for (const jump of [false, true]) {
      for (const [x, z, tx, tz, keep] of drops) {
        // every start stands in the open, clear of every solid
        for (const c of wyrmwatchHarborColliders(S)) {
          expect(clearance(x, z, 0.5, c), `start (${x}, ${z})`).toBeGreaterThan(0);
        }
        place(x, z);
        const start = sim.player.pos.y - WATER_LEVEL;
        const end = walk(tx, tz, jump, 60);
        const floor = keep > 0 ? keep : start - 0.5;
        expect(end.y, `${jump ? 'jump' : 'walk'} from (${x}, ${z})`).toBeGreaterThan(floor - 0.05);
      }
    }
  }, 120_000);
});
