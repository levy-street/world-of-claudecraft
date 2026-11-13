// The Smith's Heart's drawn walls and its walked floor agree, in the spirit
// of tests/gravewyrm_sanctum_walls.test.ts (the class the owner walked into
// on the Sanctum: a drawn rock skirt standing across a walk with no collider
// behind it, where a later, lower surface owns the ground):
// - every face the terrain draws (skirts and risers, both tiers) that rises
//   through a body's height over walkable, reachable floor is backed by a
//   collider;
// - every ramp and stair runs clear end to end: no step taller than the
//   cliff step, no generated cliff across its corridor;
// - the Balcony looks out over open air: only the Grand Stair runs from its
//   tip to the Seal Dais; only the North Stair crosses from the Ring's north;
//   both stairs stay under every Ring eye's line to the seal, so the seal is
//   in plain sight of the Ring;
// - the Heart (the separate final room) gets the same sweep from its own
//   arrival.
//
// It asks the REAL seams: the terrain's own mesh plan (planFieldCliffs with
// the live options) and the collision seam (colliders.ts isBlocked over the
// field's cliffs, props and gates).

import { beforeAll, describe, expect, it } from 'vitest';
import { type FieldMeshData, planFieldCliffs } from '../src/render/authored_field/field_mesh_core';
import { isBlocked } from '../src/sim/colliders';
import { SMITH_HEART_GATES } from '../src/sim/content/smith_heart';
import {
  BALCONY,
  GRAND_STAIR,
  HEART_ARRIVAL,
  HEART_ROOM,
  HEART_SEAL,
  NORTH_STAIR,
  RING,
  RING_ARC,
  ringPoint,
  SEAL_DAIS,
  SMITH_HEART_BOSS_SPOTS,
  SMITH_HEART_FIELD,
} from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  authoredFieldCliffRuns,
  authoredFieldHeight,
  authoredFieldSurfaceAt,
  type FieldSurface,
} from '../src/sim/instances/authored_field';
import { setOpenDungeonGates } from '../src/sim/instances/dungeon_gate_state';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';

const SEED = 7;
const DUNGEON = DUNGEONS.smith_heart;
const SLOT = 7;
const O = instanceOrigin(DUNGEON.index, SLOT);
const FIELD = SMITH_HEART_FIELD;
const VOID = FIELD.voidHeight;
const { minX, maxX, minZ, maxZ } = FIELD.bounds;
const W = maxX - minX + 1;
const H = maxZ - minZ + 1;
type PathSurface = Extract<FieldSurface, { kind: 'path' }>;
const PATHS = FIELD.surfaces.filter((s): s is PathSurface => s.kind === 'path');

/** The body's height band over the floor: a face crossing it is one a body
 *  walks into (under it is a step; over it is an overhang). */
const BAND_LOW = Math.max(MAX_STEP_HEIGHT, FIELD.cliffStep) + 0.05;
const BAND_HIGH = 2.2;
/** The walkable floor on a one-yard grid (the void reads NaN). */
const FLOOR_GRID = (() => {
  const g = new Float32Array(W * H);
  for (let z = minZ; z <= maxZ; z++)
    for (let x = minX; x <= maxX; x++) {
      const f = authoredFieldHeight(FIELD, x, z);
      g[cell(x, z)] = f > VOID + 1 ? f : Number.NaN;
    }
  return g;
})();

/** Could a triangle spanning this box and these heights cross a body's band
 *  over any walkable floor under it (padded a yard)? */
function nearBand(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number): boolean {
  for (let z = Math.max(minZ, Math.floor(z0) - 1); z <= Math.min(maxZ, Math.ceil(z1) + 1); z++)
    for (let x = Math.max(minX, Math.floor(x0) - 1); x <= Math.min(maxX, Math.ceil(x1) + 1); x++) {
      const f = FLOOR_GRID[cell(x, z)];
      if (!Number.isNaN(f) && y1 >= f + BAND_LOW - 0.5 && y0 <= f + BAND_HIGH + 0.5) return true;
    }
  return false;
}

function cell(x: number, z: number): number {
  return (Math.round(z) - minZ) * W + (Math.round(x) - minX);
}

/** Every one-yard cell a body reaches with EVERY gate open (the whole
 *  cleared run): from the entry over the main map, and from the Heart's
 *  arrival over the final room (the portal hop joins the two), flood-filled
 *  over the real collision seam. */
let reach: Uint8Array;

function floodReach(): Uint8Array {
  setOpenDungeonGates(
    O.x,
    O.z,
    SMITH_HEART_GATES.map((g) => g.id),
  );
  const seen = new Uint8Array(W * H);
  const queue: number[] = [];
  for (const start of [DUNGEON.entry, HEART_ARRIVAL]) {
    queue.push(Math.round(start.x), Math.round(start.z));
    seen[cell(start.x, start.z)] = 1;
  }
  for (let q = 0; q < queue.length; q += 2) {
    const x = queue[q];
    const z = queue[q + 1];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
      const i = cell(nx, nz);
      if (seen[i]) continue;
      if (isBlocked(SEED, O.x + nx, O.z + nz, 0.5)) continue;
      seen[i] = 1;
      queue.push(nx, nz);
    }
  }
  return seen;
}

/** Can a body stand at (x, z) on the cleared run? (A reached cell, a real
 *  floor, and no collider pushing a body off the very point.) */
function standable(x: number, z: number): boolean {
  if (x < minX || x > maxX || z < minZ || z > maxZ) return false;
  if (!reach[cell(x, z)]) return false;
  if (authoredFieldHeight(FIELD, x, z) <= VOID + 1) return false;
  return !isBlocked(SEED, O.x + x, O.z + z, 0.5);
}

/** The live terrain options of field_terrain.ts (high and low tier). */
function cliffMeshes(): FieldMeshData[] {
  return [
    { columnStep: 1.6, rowStep: 3 },
    { columnStep: 3, rowStep: 6 },
  ].map((o) => planFieldCliffs(FIELD, { voidFloor: VOID - 25, flare: 0.22, ...o }));
}

/** Points spread over a triangle (its corners, edges and inside). */
function* trianglePoints(
  a: number[],
  b: number[],
  c: number[],
  n: number,
): Generator<[number, number, number]> {
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n - i; j++) {
      const u = i / n;
      const v = j / n;
      const w = 1 - u - v;
      yield [
        a[0] * w + b[0] * u + c[0] * v,
        a[1] * w + b[1] * u + c[1] * v,
        a[2] * w + b[2] * u + c[2] * v,
      ];
    }
  }
}

/** Faces of a drawn mesh that cross a body's height over standable floor
 *  with no collider: (x, z) rounded, deduplicated. */
function walkThroughFaces(mesh: FieldMeshData): string[] {
  const p = mesh.positions;
  const found = new Map<string, string>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] * 3;
    const b = mesh.indices[t + 1] * 3;
    const c = mesh.indices[t + 2] * 3;
    const va = [p[a], p[a + 1], p[a + 2]];
    const vb = [p[b], p[b + 1], p[b + 2]];
    const vc = [p[c], p[c + 1], p[c + 2]];
    const span = Math.max(
      Math.hypot(va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]),
      Math.hypot(vb[0] - vc[0], vb[1] - vc[1], vb[2] - vc[2]),
      Math.hypot(vc[0] - va[0], vc[1] - va[1], vc[2] - va[2]),
    );
    // Nothing walkable lies under the lowest floor plus a step.
    if (
      !nearBand(
        Math.min(va[0], vb[0], vc[0]),
        Math.max(va[0], vb[0], vc[0]),
        Math.min(va[2], vb[2], vc[2]),
        Math.max(va[2], vb[2], vc[2]),
        Math.min(va[1], vb[1], vc[1]),
        Math.max(va[1], vb[1], vc[1]),
      )
    )
      continue;
    const n = Math.max(2, Math.ceil(span / 0.5));
    for (const [x, y, z] of trianglePoints(va, vb, vc, n)) {
      const floor = authoredFieldHeight(FIELD, x, z);
      if (floor <= VOID + 1) continue;
      if (y < floor + BAND_LOW || y > floor + BAND_HIGH) continue;
      if (!standable(x, z)) continue;
      const key = `${Math.round(x)},${Math.round(z)}`;
      if (!found.has(key)) {
        const s = authoredFieldSurfaceAt(FIELD, x, z);
        found.set(
          key,
          `face at (${x.toFixed(1)}, ${z.toFixed(1)}) y ${y.toFixed(2)} over ${s?.id} floor ${floor.toFixed(2)}`,
        );
      }
    }
  }
  return [...found.values()];
}

/** Points along a path's centreline every `step` yards, with its unit side. */
function centreline(
  s: PathSurface,
  step = 0.5,
): { x: number; z: number; nx: number; nz: number }[] {
  const out: { x: number; z: number; nx: number; nz: number }[] = [];
  for (let i = 0; i < s.points.length - 1; i++) {
    const [ax, az] = s.points[i];
    const [bx, bz] = s.points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      out.push({
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        nx: -(bz - az) / len,
        nz: (bx - ax) / len,
      });
    }
  }
  return out;
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

let meshes: FieldMeshData[] = [];
let faces: string[][] = [];

beforeAll(() => {
  reach = floodReach();
  meshes = cliffMeshes();
  faces = meshes.map(walkThroughFaces);
}, 240_000);

describe("the Smith's Heart: the drawn walls and the walked floor agree", () => {
  it('the cleared run reaches all four arenas, the dais and the Heart', () => {
    const spots = Object.values(SMITH_HEART_BOSS_SPOTS).map((p) => [p.x + 4, p.z + 4]);
    for (const [x, z] of [
      [-198, -212],
      [0, -62],
      [0, -8],
      [HEART_ARRIVAL.x, HEART_ARRIVAL.z],
      ...spots,
    ]) {
      expect(reach[cell(x, z)], `${x},${z}`).toBe(1);
    }
  });

  it('no face of the drawn terrain stands across walkable floor without a collider', () => {
    for (const bad of faces) expect(bad, bad.slice(0, 20).join(' | ')).toEqual([]);
  });

  it('every ramp and stair runs clear end to end', () => {
    const cliffs = authoredFieldCliffRuns(FIELD);
    const failures: string[] = [];
    for (const s of PATHS) {
      let prev: number | null = null;
      for (const p of centreline(s, 0.25)) {
        const h = authoredFieldHeight(FIELD, p.x, p.z);
        if (prev !== null && Math.abs(h - prev) >= FIELD.cliffStep) {
          failures.push(`${s.id}: a step of ${Math.abs(h - prev).toFixed(2)} at (${p.x}, ${p.z})`);
          break;
        }
        prev = h;
        const across = cliffs.find(
          (r) => segDist(p.x, p.z, r.ax, r.az, r.bx, r.bz) < s.halfWidth * 0.5,
        );
        if (across) {
          failures.push(`${s.id}: the cliff of ${across.surface} across it at (${p.x}, ${p.z})`);
          break;
        }
      }
    }
    expect(failures, failures.join(' | ')).toEqual([]);
  });

  it('the Balcony juts out over open air: only the Grand Stair crosses to the dais', () => {
    // Either side of the Grand Stair, from the Balcony's tip to the dais's
    // rim, there is only the void.
    for (let z = BALCONY.z1 + 1; z < -SEAL_DAIS.r - 1; z++) {
      for (const x of [-GRAND_STAIR.halfWidth - 3, GRAND_STAIR.halfWidth + 3]) {
        expect(authoredFieldHeight(FIELD, x, z), `${x}, ${z}`).toBe(VOID);
      }
      // The stair itself only ever descends toward the dais.
      expect(authoredFieldHeight(FIELD, 0, z + 1)).toBeLessThanOrEqual(
        authoredFieldHeight(FIELD, 0, z) + 1e-6,
      );
    }
    expect(authoredFieldHeight(FIELD, 0, BALCONY.z1 - 1)).toBe(BALCONY.h);
    expect(authoredFieldHeight(FIELD, 0, -SEAL_DAIS.r + 2)).toBe(SEAL_DAIS.h);
  });

  it('nothing walkable stands between the Ring and the dais but the two stairs', () => {
    // Off the stairs, the annulus between the dais's rim and the Ring's inner
    // edge is open air at every bearing, and the Ring looks DOWN onto the seal.
    expect(SEAL_DAIS.h).toBeLessThan(RING.h);
    for (let d = 0; d < 360; d += 5) {
      if (d >= 160 && d <= 200) continue; // the Grand Stair's band
      if (d <= 25 || d >= 335) continue; // the North Stair's band
      for (let r = SEAL_DAIS.r + 1; r < RING.innerR - 1; r += 2) {
        const p = ringPoint(d, r);
        expect(authoredFieldHeight(FIELD, p.x, p.z), `${d} deg r ${r}`).toBe(VOID);
      }
    }
    // The Heart's platform is far away in the slot, past open air.
    expect(Math.hypot(HEART_ROOM.x, HEART_ROOM.z)).toBeGreaterThan(200);
    // The Ring's walked arc is one flat height all the way round.
    for (let d = RING_ARC.fromDeg + 8; d <= RING_ARC.toDeg - 8; d += 4) {
      const p = ringPoint(d);
      expect(authoredFieldHeight(FIELD, p.x, p.z), `ring ${d}`).toBe(RING.h);
    }
  });

  it("the North Stair alone crosses from the Ring's north to the dais, a broad gentle fall", () => {
    // Either side of it, from the Ring's inner edge to the dais's rim, only
    // the void; along it, the floor only ever falls toward the dais.
    for (let z = NORTH_STAIR.top - 2; z > NORTH_STAIR.foot + 1; z--) {
      for (const x of [-NORTH_STAIR.halfWidth - 3, NORTH_STAIR.halfWidth + 3]) {
        expect(authoredFieldHeight(FIELD, x, z), `${x}, ${z}`).toBe(VOID);
      }
      // As broad as the Grand Stair (a raid of ten walks it abreast).
      for (const x of [-NORTH_STAIR.halfWidth + 0.5, 0, NORTH_STAIR.halfWidth - 0.5]) {
        expect(authoredFieldHeight(FIELD, x, z), `${x}, ${z}`).toBeGreaterThan(VOID);
      }
      expect(authoredFieldHeight(FIELD, 0, z - 1)).toBeLessThanOrEqual(
        authoredFieldHeight(FIELD, 0, z) + 1e-6,
      );
    }
    expect(NORTH_STAIR.halfWidth * 2).toBeGreaterThanOrEqual(12);
    expect(authoredFieldHeight(FIELD, 0, NORTH_STAIR.top + 1)).toBe(RING.h);
    expect(authoredFieldHeight(FIELD, 0, NORTH_STAIR.foot - 2)).toBe(SEAL_DAIS.h);
  });

  it("both stairs stay under every Ring eye's line to the seal", () => {
    // A walked floor is not a render solid, so the sightline pin
    // (smith_heart_render_core) does not see it: this does. From every 2
    // degrees of the Ring's walked arc, the line from a body's eye to the
    // seal clears every floor it crosses over the chasm.
    const bad: string[] = [];
    const seal = { x: HEART_SEAL.x, y: SEAL_DAIS.h + 0.5, z: HEART_SEAL.z };
    for (let d = RING_ARC.fromDeg; d <= RING_ARC.toDeg; d += 2) {
      for (const r of [RING.innerR + 0.5, RING.R, RING.outerR - 0.5]) {
        const p = ringPoint(d, r);
        const ey = authoredFieldHeight(FIELD, p.x, p.z) + 1.7;
        for (let t = 0.02; t < 1; t += 0.01) {
          const x = p.x + (seal.x - p.x) * t;
          const z = p.z + (seal.z - p.z) * t;
          if (Math.hypot(x, z) < SEAL_DAIS.r) break;
          if (Math.hypot(x, z) > RING.innerR - 0.5) continue;
          const y = ey + (seal.y - ey) * t;
          const floor = authoredFieldHeight(FIELD, x, z);
          if (floor > y - 0.25) {
            bad.push(
              `ring ${d % 360} r ${r}: floor ${floor.toFixed(2)} at (${x.toFixed(1)}, ${z.toFixed(1)})`,
            );
            break;
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
