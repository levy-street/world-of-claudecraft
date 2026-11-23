// The floor a body stands on IS the floor that is drawn, across the whole of
// every authored open-air field (the Hollow Crypt, the Sunken Bastion, the
// Drowned Temple, the Wildheart Basin, the Gravewyrm Sanctum).
//
// Live report (the Sunken Bastion, online): in the Lower Bailey by the dead
// Turretback Hermit only the player's head showed above the paving, "and more
// widely in other areas". The sim gives a point to the LAST surface containing
// it; the terrain drew every surface whole, so an earlier, higher terrace (the
// bailey at 2) was painted straight over a later, lower surface cut into it
// (the moat ring, the Sea Gate ramp), and a crag lump of the headland rock
// could rise through a rock-edged terrace's lip. The sweep samples the sim
// height on a fine grid over each field and holds the drawn top, and the
// headland rock, against it everywhere a body can stand.
import { describe, expect, it } from 'vitest';
import {
  ccw,
  isConvexCcw,
  prepareClipper,
  ringArea,
  subtractAll,
  subtractConvex,
} from '../src/render/authored_field/field_clip_core';
import {
  drawnTopAt,
  type FieldMeshData,
  planFieldCliffs,
  planFieldTops,
  renderOutline,
  triangulatePolygon,
} from '../src/render/authored_field/field_mesh_core';
import {
  headlandMeshHeightAt,
  planHeadlandRock,
} from '../src/render/sunken_bastion/bastion_headland_core';
import { DROWNED_TEMPLE_FIELD } from '../src/sim/content/drowned_temple_layout';
import { GRAVEWYRM_SANCTUM_FIELD } from '../src/sim/content/gravewyrm_sanctum_layout';
import { HOLLOW_CRYPT_FIELD } from '../src/sim/content/hollow_crypt_layout';
import {
  BAILEY_CHAPEL,
  SUNKEN_BASTION_ANCHORS,
  SUNKEN_BASTION_FIELD,
} from '../src/sim/content/sunken_bastion_layout';
import { WILDHEART_BASIN_FIELD } from '../src/sim/content/wildheart_basin_layout';
import {
  type AuthoredFieldDef,
  authoredFieldCliffRuns,
  authoredFieldHeight,
  authoredFieldSurfaceAt,
  CLIFF_HALF_DEPTH,
  type FieldCliffRun,
} from '../src/sim/instances/authored_field';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';

/** How far the drawn floor may sit from the walked one. */
const TOLERANCE = 0.05;
/** Points this close to a surface outline are ambiguous (either side owns
 *  them within float noise) and are skipped. */
const EDGE_BAND = 0.2;

/** Distance from (x, z) to a closed ring. */
function ringDistance(ring: readonly [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

/** The drawn tops bucketed on a coarse grid, so a sweep of tens of thousands
 *  of points reads only the triangles near each one. */
function bucketTops(tops: FieldMeshData[], cell: number) {
  const buckets = new Map<string, number[]>();
  const all: number[] = [];
  for (const t of tops) for (const v of t.positions) all.push(v);
  for (let i = 0; i < all.length; i += 9) {
    const xs = [all[i], all[i + 3], all[i + 6]];
    const zs = [all[i + 2], all[i + 5], all[i + 8]];
    for (
      let cx = Math.floor(Math.min(...xs) / cell);
      cx <= Math.floor(Math.max(...xs) / cell);
      cx++
    ) {
      for (
        let cz = Math.floor(Math.min(...zs) / cell);
        cz <= Math.floor(Math.max(...zs) / cell);
        cz++
      ) {
        const key = `${cx},${cz}`;
        let b = buckets.get(key);
        if (!b) {
          b = [];
          buckets.set(key, b);
        }
        for (let k = 0; k < 9; k++) b.push(all[i + k]);
      }
    }
  }
  return (x: number, z: number): number => {
    const b = buckets.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
    if (!b) return Number.NaN;
    return drawnTopAt({ positions: b, colors: [], uvs: [], indices: [] }, x, z);
  };
}

interface Miss {
  x: number;
  z: number;
  walked: number;
  drawn: number;
  surface: string;
}

/** Every walkable sample where the drawn top misses the walked height. */
function sweep(def: AuthoredFieldDef, maxEdge: number, step: number) {
  const tops = planFieldTops(def, { maxEdge, layerLift: 0 });
  const drawnAt = bucketTops(Object.values(tops), 4);
  const rings = def.surfaces.map((s) => renderOutline(s));
  const misses: Miss[] = [];
  let samples = 0;
  const b = def.bounds;
  for (let z = b.minZ; z <= b.maxZ; z += step) {
    for (let x = b.minX; x <= b.maxX; x += step) {
      const s = authoredFieldSurfaceAt(def, x, z);
      if (!s || s.hidden) continue;
      if (rings.some((r) => ringDistance(r, x, z) < EDGE_BAND)) continue;
      const walked = authoredFieldHeight(def, x, z);
      const drawn = drawnAt(x, z);
      samples++;
      if (!(Math.abs(drawn - walked) <= TOLERANCE)) {
        misses.push({ x, z, walked, drawn, surface: s.id });
      }
    }
  }
  return { misses, samples };
}

function describeMisses(misses: Miss[]): string {
  const bySurface = new Map<string, Miss[]>();
  for (const m of misses) {
    const list = bySurface.get(m.surface) ?? [];
    list.push(m);
    bySurface.set(m.surface, list);
  }
  return [...bySurface.entries()]
    .map(([id, list]) => {
      const worst = list.reduce((a, m) =>
        Math.abs(m.drawn - m.walked) > Math.abs(a.drawn - a.walked) || Number.isNaN(m.drawn)
          ? m
          : a,
      );
      return `${id}: ${list.length} misses, worst at (${worst.x}, ${worst.z}) walked ${worst.walked.toFixed(2)} drawn ${worst.drawn.toFixed(2)}`;
    })
    .join('\n');
}

const FIELDS: [string, AuthoredFieldDef][] = [
  ['the Hollow Crypt', HOLLOW_CRYPT_FIELD],
  ['the Sunken Bastion', SUNKEN_BASTION_FIELD],
  ['the Drowned Temple', DROWNED_TEMPLE_FIELD],
  ['the Wildheart Basin', WILDHEART_BASIN_FIELD],
  ['the Gravewyrm Sanctum', GRAVEWYRM_SANCTUM_FIELD],
];

describe('an authored field is walked where it is drawn', () => {
  for (const [name, def] of FIELDS) {
    for (const [tier, maxEdge] of [
      ['high', 3],
      ['low', 6],
    ] as const) {
      it(`${name}: the drawn floor matches the walked floor everywhere (${tier} tier)`, () => {
        const { misses, samples } = sweep(def, maxEdge, 0.75);
        expect(samples).toBeGreaterThan(20000);
        expect(misses.length, describeMisses(misses)).toBe(0);
      });
    }
  }
});

/** A drawn rock face is a wall a body walks into where it crosses a body's
 *  height over a walkable floor; there it must stand on a cliff run (the
 *  generated collider) or inside a prop's or an authored wall's footprint. */
const BODY_LOW = MAX_STEP_HEIGHT + 0.25;
const BODY_HIGH = 2.2;

/** Is (x, z) within a body's reach of a collider: a cliff run (the
 *  generated wall), a prop's footprint or an authored wall? The runs are
 *  bucketed on an 8 yd grid so a sweep reads only the ones nearby. */
function colliderProbe(def: AuthoredFieldDef, runs: FieldCliffRun[]) {
  const reach = CLIFF_HALF_DEPTH + 0.5;
  const CELL = 8;
  const buckets = new Map<string, FieldCliffRun[]>();
  for (const r of runs) {
    for (
      let cx = Math.floor((Math.min(r.ax, r.bx) - reach) / CELL);
      cx <= Math.floor((Math.max(r.ax, r.bx) + reach) / CELL);
      cx++
    )
      for (
        let cz = Math.floor((Math.min(r.az, r.bz) - reach) / CELL);
        cz <= Math.floor((Math.max(r.az, r.bz) + reach) / CELL);
        cz++
      ) {
        const key = `${cx},${cz}`;
        const list = buckets.get(key) ?? [];
        list.push(r);
        buckets.set(key, list);
      }
  }
  return (x: number, z: number): boolean => {
    for (const r of buckets.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const dx = r.bx - r.ax;
      const dz = r.bz - r.az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - r.ax) * dx + (z - r.az) * dz) / l2));
      if (Math.hypot(r.ax + dx * t - x, r.az + dz * t - z) < reach) return true;
    }
    for (const o of [...def.props, ...def.walls]) {
      const ox = x - o.x;
      const oz = z - o.z;
      if ('r' in o && o.r !== undefined && o.r > 0) {
        if (Math.hypot(ox, oz) < o.r + 0.5) return true;
        continue;
      }
      if (o.hw === undefined || o.hd === undefined) continue;
      const c = Math.cos(o.rot ?? 0);
      const s = Math.sin(o.rot ?? 0);
      if (Math.abs(ox * c - oz * s) < o.hw + 0.5 && Math.abs(ox * s + oz * c) < o.hd + 0.5)
        return true;
    }
    return false;
  };
}

/** Points of the drawn cliff faces that stand through a body's height over
 *  a walkable floor with no collider under them. */
function wallsWalkedThrough(def: AuthoredFieldDef): string[] {
  const mesh = planFieldCliffs(def, {
    voidFloor: def.voidHeight - 25,
    columnStep: 1.6,
    rowStep: 3,
    flare: 0.22,
  });
  const underCollider = colliderProbe(def, authoredFieldCliffRuns(def));
  const range = floorRange(def);
  const p = mesh.positions;
  const found = new Map<string, string>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const v = [0, 1, 2].map((k) => {
      const i = mesh.indices[t + k] * 3;
      return [p[i], p[i + 1], p[i + 2]];
    });
    // Cheap reject: the floors under the triangle's footprint (a 1 yd grid,
    // padded a cell) never put it in a body's band.
    const [lo, hi] = range(
      Math.min(v[0][0], v[1][0], v[2][0]),
      Math.max(v[0][0], v[1][0], v[2][0]),
      Math.min(v[0][2], v[1][2], v[2][2]),
      Math.max(v[0][2], v[1][2], v[2][2]),
    );
    if (hi <= def.voidHeight + 1) continue;
    if (Math.max(v[0][1], v[1][1], v[2][1]) < lo + BODY_LOW) continue;
    if (Math.min(v[0][1], v[1][1], v[2][1]) > hi + BODY_HIGH) continue;
    const [a, b1, c] = v;
    const span = Math.max(
      Math.hypot(a[0] - b1[0], a[1] - b1[1], a[2] - b1[2]),
      Math.hypot(b1[0] - c[0], b1[1] - c[1], b1[2] - c[2]),
      Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]),
    );
    const n = Math.max(2, Math.ceil(span / 0.5));
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n - i; j++) {
        const u = i / n;
        const w = j / n;
        const r = 1 - u - w;
        const x = a[0] * r + b1[0] * u + c[0] * w;
        const y = a[1] * r + b1[1] * u + c[1] * w;
        const z = a[2] * r + b1[2] * u + c[2] * w;
        if (y < lo + BODY_LOW || y > hi + BODY_HIGH) continue;
        const floor = authoredFieldHeight(def, x, z);
        if (floor <= def.voidHeight + 1) continue;
        if (y < floor + BODY_LOW || y > floor + BODY_HIGH) continue;
        if (underCollider(x, z)) continue;
        const key = `${Math.round(x)},${Math.round(z)}`;
        if (!found.has(key))
          found.set(
            key,
            `(${x.toFixed(1)}, ${z.toFixed(1)}) face at ${y.toFixed(2)} over ${authoredFieldSurfaceAt(def, x, z)?.id} at ${floor.toFixed(2)}`,
          );
      }
    }
  }
  return [...found.values()];
}

/** The lowest and highest walkable floor over a box of the field (a 1 yd
 *  grid padded a cell; the void is no floor: an all-void box reads void). */
function floorRange(def: AuthoredFieldDef) {
  const b = def.bounds;
  const w = Math.ceil(b.maxX - b.minX) + 3;
  const h = Math.ceil(b.maxZ - b.minZ) + 3;
  const grid = new Float32Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      grid[j * w + i] = authoredFieldHeight(def, b.minX - 1 + i, b.minZ - 1 + j);
  return (x0: number, x1: number, z0: number, z1: number): [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    const i0 = Math.max(0, Math.floor(x0 - b.minX));
    const i1 = Math.min(w - 1, Math.ceil(x1 - b.minX) + 2);
    const j0 = Math.max(0, Math.floor(z0 - b.minZ));
    const j1 = Math.min(h - 1, Math.ceil(z1 - b.minZ) + 2);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const f = grid[j * w + i];
        if (f <= def.voidHeight + 1) continue;
        if (f < lo) lo = f;
        if (f > hi) hi = f;
      }
    return lo > hi ? [def.voidHeight, def.voidHeight] : [lo, hi];
  };
}

/** One known sliver, pinned so it cannot spread: at the foot of the
 *  Wildheart Basin's Fern Steps the ramp's skirt turns from a straight face
 *  down onto the south bank to a flared massif into the gulf, and the one
 *  triangle that bridges the two columns leans a hand over the bank's edge
 *  (a skirt-topology limit, older than the skirt-ownership fix). */
function knownSliver(def: AuthoredFieldDef, f: string): boolean {
  if (def !== WILDHEART_BASIN_FIELD) return false;
  const m = /^\((-?[\d.]+), (-?[\d.]+)\)/.exec(f);
  return !!m && Math.hypot(Number(m[1]) + 5.6, Number(m[2]) + 151) < 1.5;
}

describe('an authored field draws no rock face across a walkable floor', () => {
  // The Gravewyrm Sanctum, playtest 2026-10-03: a surface's skirt was dropped
  // along its whole outline, also where a later stair cut down through its lip
  // owns the ground, so a wall stood across the stair with no collider (the
  // owner walked through it after Velkhar and on the way to Korzul).
  for (const [name, def] of FIELDS) {
    it(`${name}: every drawn face over a walkable floor stands on a collider`, () => {
      const bad = wallsWalkedThrough(def).filter((f) => !knownSliver(def, f));
      expect(bad, bad.slice(0, 15).join('\n')).toEqual([]);
    }, 180_000);
  }
});

describe('the Sunken Bastion floors the report named', () => {
  const tops = planFieldTops(SUNKEN_BASTION_FIELD, { maxEdge: 3, layerLift: 0 });
  const drawnAt = bucketTops(Object.values(tops), 4);

  it('draws the moat ring at the moat floor, not under the bailey paving', () => {
    for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const a = (deg * Math.PI) / 180;
      const r = (BAILEY_CHAPEL.island + BAILEY_CHAPEL.moat) / 2;
      const x = BAILEY_CHAPEL.x + Math.sin(a) * r;
      const z = BAILEY_CHAPEL.z + Math.cos(a) * r;
      expect(authoredFieldHeight(SUNKEN_BASTION_FIELD, x, z)).toBe(BAILEY_CHAPEL.moatFloor);
      expect(drawnAt(x, z)).toBeCloseTo(BAILEY_CHAPEL.moatFloor, 6);
    }
  });

  it('keeps the moat a stride deep so a body walks in and out of it', () => {
    const bailey = authoredFieldHeight(
      SUNKEN_BASTION_FIELD,
      SUNKEN_BASTION_ANCHORS.cisternYard.x,
      -60,
    );
    expect(bailey - BAILEY_CHAPEL.moatFloor).toBeGreaterThan(0.2);
    expect(bailey - BAILEY_CHAPEL.moatFloor).toBeLessThan(MAX_STEP_HEIGHT);
  });

  it('draws the Sea Gate ramp where it cuts into the bailey lip', () => {
    for (const z of [-130, -128, -127]) {
      const walked = authoredFieldHeight(SUNKEN_BASTION_FIELD, 0, z);
      expect(walked).toBeLessThan(2);
      expect(drawnAt(0, z)).toBeCloseTo(walked, 5);
    }
  });

  for (const [tier, step] of [
    ['high', 2.5],
    ['low', 4],
  ] as const) {
    it(`never raises the headland rock through a walkable floor (${tier} tier)`, () => {
      const grid = planHeadlandRock(step);
      const b = SUNKEN_BASTION_FIELD.bounds;
      let checked = 0;
      const worst: string[] = [];
      for (let z = b.minZ; z <= b.maxZ; z += 0.75) {
        for (let x = b.minX; x <= b.maxX; x += 0.75) {
          const s = authoredFieldSurfaceAt(SUNKEN_BASTION_FIELD, x, z);
          if (!s || s.hidden) continue;
          const rock = headlandMeshHeightAt(grid, x, z);
          if (Number.isNaN(rock)) continue;
          checked++;
          const floor = authoredFieldHeight(SUNKEN_BASTION_FIELD, x, z);
          if (rock > floor + TOLERANCE && worst.length < 12) {
            worst.push(`(${x}, ${z}) on ${s.id}: rock ${rock.toFixed(2)} over floor ${floor}`);
          }
        }
      }
      expect(checked).toBeGreaterThan(500);
      expect(worst, worst.join('\n')).toEqual([]);
    });
  }
});

describe('the terrain clip core', () => {
  const area = (rings: [number, number][][]): number =>
    rings.reduce((sum, r) => sum + Math.abs(ringArea(r)), 0);

  it('subtracts a convex clipper exactly, in convex pieces', () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const hole: [number, number][] = [
      [2, 2],
      [6, 2],
      [6, 6],
      [2, 6],
    ];
    const pieces = subtractConvex(square, ccw(hole));
    expect(area(pieces)).toBeCloseTo(100 - 16, 9);
    for (const p of pieces) expect(isConvexCcw(ccw(p))).toBe(true);
    // Disjoint and fully covering clippers.
    expect(
      area(
        subtractConvex(
          square,
          ccw([
            [20, 20],
            [30, 20],
            [30, 30],
          ]),
        ),
      ),
    ).toBeCloseTo(100, 9);
    expect(subtractConvex(hole, ccw(square))).toEqual([]);
  });

  it('subtracts a concave clipper through its ear-clipped parts', () => {
    const l: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    const clipper = prepareClipper(l, triangulatePolygon);
    expect(clipper.parts.length).toBeGreaterThan(1);
    const square: [number, number][] = [
      [-5, -5],
      [15, -5],
      [15, 15],
      [-5, 15],
    ];
    expect(area(subtractAll(square, [clipper]))).toBeCloseTo(400 - 64, 6);
  });
});
