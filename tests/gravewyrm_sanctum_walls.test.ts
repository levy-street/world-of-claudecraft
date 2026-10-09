// The Gravewyrm Sanctum's drawn walls and its walked floor agree (owner's
// playtest, 2026-10-03): after Velkhar the way down to the shore ran THROUGH
// the vault's rim, and on the way to Korzul the lake stair ran through an ice
// rim on the shore. Both were the same class of bug: the terrain drew a
// surface's rock skirt along its WHOLE outline, also where a later, lower
// surface (a stair cut down through the lip, the lake's shelf) owns the ground,
// so a wall stood across a walk with no collider behind it.
//
// This suite sweeps the whole cirque for that class, in the spirit of
// tests/wildheart_basin_walkways.test.ts:
// - every face the terrain draws (skirts and risers) that rises through a
//   body's height over walkable, reachable floor is backed by a collider;
// - every standing kit wall (the vault's walls, the glacier walls, the
//   icefalls, the frozen falls, the crags, the tunnel's flanks) that stands
//   over walkable floor is backed by a collider;
// - every ramp and stair runs clear end to end: no generated cliff across its
//   corridor, no step taller than the cliff step;
// - the two openings the owner walked through are real openings.
//
// It asks the REAL seams: the terrain's own mesh plan (planFieldCliffs with
// the live options), the kit's own placement plan, and the collision seam
// (colliders.ts isBlocked over the field's cliffs, props and gates).

import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FieldMeshData, planFieldCliffs } from '../src/render/authored_field/field_mesh_core';
import { sanctumPlacementMatrix } from '../src/render/gravewyrm_sanctum/sanctum_kit';
import {
  planSanctumKitPlacements,
  planVaultWalls,
  type SanctumKitPlacement,
} from '../src/render/gravewyrm_sanctum/sanctum_kit_plan_core';
import { isBlocked } from '../src/sim/colliders';
import { GRAVEWYRM_SANCTUM_GATES } from '../src/sim/content/gravewyrm_sanctum';
import {
  GRAVEWYRM_HEIGHTS,
  GRAVEWYRM_SANCTUM_FIELD,
  RITUAL_VAULT,
  SHORE,
  WYRMS_HOLLOW,
} from '../src/sim/content/gravewyrm_sanctum_layout';
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
const DUNGEON = DUNGEONS.gravewyrm_sanctum;
const SLOT = 6;
const O = instanceOrigin(DUNGEON.index, SLOT);
const FIELD = GRAVEWYRM_SANCTUM_FIELD;
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

/** Every one-yard cell a body reaches from the arrival with EVERY gate open
 *  (the whole cleared run), flood-filled over the real collision seam. */
let reach: Uint8Array;

function floodReach(): Uint8Array {
  setOpenDungeonGates(
    O.x,
    O.z,
    GRAVEWYRM_SANCTUM_GATES.map((g) => g.id),
  );
  const seen = new Uint8Array(W * H);
  const start = DUNGEON.entry;
  const queue: number[] = [Math.round(start.x), Math.round(start.z)];
  seen[cell(start.x, start.z)] = 1;
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

/** How far (x, z) stands from the nearest collider (yards, capped at 6). */
function clearance(x: number, z: number): number {
  let lo = 0.5;
  let hi = 6;
  if (!isBlocked(SEED, O.x + x, O.z + z, hi)) return hi;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (isBlocked(SEED, O.x + x, O.z + z, mid)) hi = mid;
    else lo = mid;
  }
  return lo;
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

/** The kit's real geometry (the shipped GLB), piece name to triangles in the
 *  piece's own frame: the sweep tests what is drawn, never a bounding box
 *  (the gate tunnel is an arch, a serac a tapering tower). */
const KIT_TRIS = new Map<string, Float32Array>();

async function loadKit(): Promise<void> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(
    new Uint8Array(readFileSync('public/models/props/gravewyrm_sanctum_kit.glb')),
  );
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!name.startsWith('Kit_')) continue;
    const m = node.getWorldMatrix();
    const tris: number[] = [];
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      const idx = prim.getIndices();
      const count = idx?.getCount() ?? a.getCount();
      const e: number[] = [];
      for (let i = 0; i < count; i++) {
        a.getElement(idx ? idx.getScalar(i) : i, e);
        tris.push(
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        );
      }
    }
    KIT_TRIS.set(name, new Float32Array(tris));
  }
}

/** Floor dressing a body walks over on purpose (knee high or flat). */
const WALK_OVER =
  /SnowDrift|Sastrugi|HaulRoadKerb|MeltChannel|RitualCircle|MoraineRocks|ChainHeap|IceBridge/;
/** The wall class (rims, lips, walls, falls, crags, the tunnel, the rune
 *  wall): never a yard of it over walkable floor without a collider. */
const WALLS =
  /CrevasseEdge|RockCliff|VaultWall|GlacierWall|IceFall|FrozenFall|Crag|GateTunnel|RuneWall|ThornpeakRock/;
/** Fitted props: their collider is a circle or a box under a sculpted body,
 *  so a little of the body may stand past it, at most a body's width. */
const PROP_SKIN = 1.6;
/** Props whose reach past the collider is render-only on purpose: the
 *  chain links the held giants grip and the anchors pay out run across the
 *  ledge and over the lip (the kit's notes: "the links are render only"),
 *  and the thaw pyres' rim stakes stand in Velkhar's arena, where the pools
 *  stay open to walk in and out (design 6.2). */
const RENDER_ONLY_REACH = /HeldGiant|ChainAnchor|ThawPyre/;

/** Points of a placed kit piece that stand through a body's height over
 *  standable floor with no collider. */
function walkThroughPiece(k: SanctumKitPlacement, skin = 0): string[] {
  const tris = KIT_TRIS.get(k.piece);
  if (!tris) return [];
  const m = sanctumPlacementMatrix(k, new THREE.Matrix4()).elements;
  const out = new Map<string, string>();
  const at = (i: number): number[] => {
    const x = tris[i];
    const y = tris[i + 1];
    const z = tris[i + 2];
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
  };
  // Cheap reject: no reached cell under the piece's footprint.
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const [x, , z] = at(i);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  let near = false;
  for (let x = Math.max(minX, Math.floor(x0)); x <= Math.min(maxX, Math.ceil(x1)) && !near; x++)
    for (let z = Math.max(minZ, Math.floor(z0)); z <= Math.min(maxZ, Math.ceil(z1)); z++)
      if (reach[cell(x, z)]) {
        near = true;
        break;
      }
  if (!near) return [];
  for (let t = 0; t < tris.length; t += 9) {
    const va = at(t);
    const vb = at(t + 3);
    const vc = at(t + 6);
    const span = Math.max(
      Math.hypot(va[0] - vb[0], va[2] - vb[2]),
      Math.hypot(vb[0] - vc[0], vb[2] - vc[2]),
      Math.hypot(vc[0] - va[0], vc[2] - va[2]),
      Math.abs(va[1] - vb[1]),
      Math.abs(vb[1] - vc[1]),
      Math.abs(vc[1] - va[1]),
    );
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
    const n = Math.max(1, Math.ceil(span / 0.5));
    for (const [x, y, z] of trianglePoints(va, vb, vc, n)) {
      const floor = authoredFieldHeight(FIELD, x, z);
      if (floor <= VOID + 1) continue;
      if (y < floor + BAND_LOW || y > floor + BAND_HIGH) continue;
      if (!standable(x, z)) continue;
      const clear = clearance(x, z);
      if (clear <= skin) continue;
      const key = `${Math.round(x)},${Math.round(z)}`;
      if (!out.has(key))
        out.set(
          key,
          `${k.piece} at (${x.toFixed(1)}, ${z.toFixed(1)}) y ${(y - floor).toFixed(1)} over floor ${floor.toFixed(1)}, ${clear.toFixed(2)} from a collider`,
        );
    }
  }
  return [...out.values()];
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

/** The terrain's faces at both tiers, and the walk-through ones among them. */
let meshes: FieldMeshData[] = [];
let faces: string[][] = [];

beforeAll(async () => {
  reach = floodReach();
  await loadKit();
  meshes = cliffMeshes();
  faces = meshes.map(walkThroughFaces);
}, 240_000);

describe('Gravewyrm Sanctum: the drawn walls and the walked floor agree', () => {
  it('the cleared run reaches the lake (the sweep below covers the whole route)', () => {
    expect(reach[cell(0, -222)]).toBe(1);
    expect(reach[cell(0, 120)]).toBe(1);
    expect(reach[cell(0, 150)]).toBe(1);
    expect(reach[cell(WYRMS_HOLLOW.x, WYRMS_HOLLOW.z)]).toBe(1);
  });

  it('no face of the drawn terrain stands across walkable floor without a collider', () => {
    for (const bad of faces) expect(bad, bad.slice(0, 20).join('\n')).toEqual([]);
  });

  it('every kit wall, rim and lip over walkable floor is backed by a collider', () => {
    const bad = planSanctumKitPlacements()
      .filter((k) => WALLS.test(k.piece))
      .flatMap((k) => walkThroughPiece(k));
    expect(bad, bad.slice(0, 20).join('\n')).toEqual([]);
  });

  it('every fitted prop stands at most a body width past its collider', () => {
    const bad = planSanctumKitPlacements()
      .filter((k) => !WALLS.test(k.piece) && !WALK_OVER.test(k.piece))
      .filter((k) => !RENDER_ONLY_REACH.test(k.piece))
      .flatMap((k) => walkThroughPiece(k, PROP_SKIN));
    expect(bad, bad.slice(0, 20).join('\n')).toEqual([]);
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
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('the way down from the Ritual Vault leaves through a real opening in its rim', () => {
    const vaultEdge = RITUAL_VAULT.z + RITUAL_VAULT.r;
    // The stair is cut down through the vault's lip: no drawn face stands
    // across its corridor (the vault's own skirt is left out where the stair
    // owns the ground), only its two side walls.
    for (const bad of faces) expect(bad.filter((f) => f.includes('shore_stair'))).toEqual([]);
    expect(authoredFieldHeight(FIELD, 0, vaultEdge)).toBeLessThan(GRAVEWYRM_HEIGHTS.vault - 2);
    // The vault's walls leave both stairs a body's margin either side.
    const tris = KIT_TRIS.get('Kit_VaultWall');
    if (!tris) throw new Error('no Kit_VaultWall in the kit');
    for (const id of ['shore_stair', 'vault_stair']) {
      const stair = PATHS.find((s) => s.id === id);
      if (!stair) throw new Error(`no ${id}`);
      const [ax, az] = stair.points[0];
      const [bx, bz] = stair.points[stair.points.length - 1];
      let nearest = Infinity;
      for (const w of planVaultWalls()) {
        const m = sanctumPlacementMatrix(w, new THREE.Matrix4()).elements;
        for (let i = 0; i < tris.length; i += 3) {
          const x = m[0] * tris[i] + m[4] * tris[i + 1] + m[8] * tris[i + 2] + m[12];
          const z = m[2] * tris[i] + m[6] * tris[i + 1] + m[10] * tris[i + 2] + m[14];
          nearest = Math.min(nearest, segDist(x, z, ax, az, bx, bz));
        }
      }
      expect(nearest, id).toBeGreaterThan(stair.halfWidth + 1);
    }
  });

  it('the lake stair comes down onto the shelf with no rim across it', () => {
    const stair = PATHS.find((s) => s.id === 'lake_stair');
    if (!stair) throw new Error('no lake_stair');
    const last = stair.points[stair.points.length - 1];
    expect(last[2]).toBe(GRAVEWYRM_HEIGHTS.lake);
    // The shore's drawn inner rim stood on the shelf (the shelf owns r < 46,
    // the shore's own outline is at r 44): no drawn face may stand on the
    // shelf ring or across the stair.
    expect(SHORE.innerR).toBeLessThan(WYRMS_HOLLOW.shelfR);
    const onShelf: string[] = [];
    for (const mesh of meshes) {
      const p = mesh.positions;
      for (const v of new Set(mesh.indices)) {
        const i = v * 3;
        const r = Math.hypot(p[i] - WYRMS_HOLLOW.x, p[i + 2] - WYRMS_HOLLOW.z);
        if (r > WYRMS_HOLLOW.lakeR + 0.2 && r < WYRMS_HOLLOW.shelfR - 0.2 && p[i + 1] > 0.05)
          onShelf.push(`(${p[i].toFixed(1)}, ${p[i + 1].toFixed(1)}, ${p[i + 2].toFixed(1)})`);
      }
    }
    expect(onShelf, onShelf.slice(0, 10).join(' ')).toEqual([]);
  });
});

describe('Gravewyrm Sanctum: the descent from the Chain Bridge is glacier ice', () => {
  it('the Thaw Works road down to the lower terrace is ice, not rock', () => {
    const road = PATHS.find((s) => s.id === 'works_road');
    expect(road?.ground).toBe('ice');
    // The rest of the way down to the vault is ice as well.
    expect(PATHS.find((s) => s.id === 'vault_stair')?.ground).toBe('ice');
  });
});
