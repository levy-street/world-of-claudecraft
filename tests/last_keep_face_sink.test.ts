// A character standing on the Last Keep's grounds must stand on the ground it
// SEES. The reported break (maintainer, on the castle's east and west faces):
// run a character along them and it sinks into the terrain.
//
// Mechanism: the terrain chunk mesh samples a vertex lattice (1.2yd at the
// densest LOD band, 3.0yd on the low tier) and draws flat triangles between
// samples, so it can only carry features WIDER than that lattice. Every other
// built mass in the castle already respects that (the curtain walls, bastions
// and stair flights live in castleLift, which terrainHeight excludes and
// castle_features.ts draws), but the inner ward's 2.6yd terrace sat in
// terrainHeight behind a 0.7yd retaining blend. The mesh smeared that cliff
// into a ramp spilling out over the bailey, so the drawn ground stood up to
// 1.73yd ABOVE the floor the sim puts the player's feet on, along both faces.
//
// The gate below is lattice-independent: over the graded castle grounds the
// mesh height view must be exactly FLAT, and a constant field interpolates
// exactly at any spacing and any phase, so no LOD band can reintroduce a sink.
// The lattice replication then measures the thing a player actually sees.
import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { meshTerrainHeight } from '../src/render/terrain_mesh_height';
import {
  CASTLE,
  castleLift,
  castlePadWeight,
  WARD_STEP_RUN,
  WARD_STEPS,
  wardTerraceRise,
} from '../src/sim/castle_layout';
import { WORLD_MAX_X, WORLD_MIN_Z } from '../src/sim/data';
import { groundHeight } from '../src/sim/world';

const SEED = 20061;
// render/terrain.ts: CHUNK_SIZE and every LOD_BANDS spacing, high and low tier
const CHUNK_SIZE = 60;
const SPACINGS = [1.2, 1.6, 2.6, 3.0, 4.4, 6.5];
/** the graded castle grounds: the walls plus a margin, all at pad weight 1 */
const GROUNDS = { x0: 350, x1: 444, z0: 1982, z1: 2078 };

/**
 * The drawn terrain surface at (x, z): the chunk mesh's triangle, rebuilt from
 * the same lattice and the same diagonal choice as fillChunkVertexRow /
 * fillChunkIndexRow in render/terrain_chunk_build.ts.
 */
function meshSurface(x: number, z: number, spacing: number, originX: number): number {
  const cx = Math.floor((x - originX) / CHUNK_SIZE);
  const cz = Math.floor((z - WORLD_MIN_Z) / CHUNK_SIZE);
  const x0 = originX + cx * CHUNK_SIZE;
  const z0 = WORLD_MIN_Z + cz * CHUNK_SIZE;
  const n = Math.max(4, Math.round(CHUNK_SIZE / spacing));
  const step = CHUNK_SIZE / n;
  const i = Math.min(n - 1, Math.floor((x - x0) / step));
  const j = Math.min(n - 1, Math.floor((z - z0) / step));
  const vx = x0 + i * step;
  const vz = z0 + j * step;
  const ha = meshTerrainHeight(vx, vz, SEED);
  const hb = meshTerrainHeight(vx + step, vz, SEED);
  const hc = meshTerrainHeight(vx, vz + step, SEED);
  const hd = meshTerrainHeight(vx + step, vz + step, SEED);
  const u = (x - vx) / step;
  const v = (z - vz) / step;
  if (Math.abs(hb - hc) <= Math.abs(ha - hd)) {
    // b-c diagonal: triangles either side of u + v = 1
    return u + v <= 1
      ? ha + (hb - ha) * u + (hc - ha) * v
      : hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  }
  // a-d diagonal: triangles either side of v = u
  return v <= u ? ha + (hb - ha) * u + (hd - hb) * v : ha + (hc - ha) * v + (hd - hc) * u;
}

/** Sample points over a rect. */
function grid(r: { x0: number; x1: number; z0: number; z1: number }, s: number) {
  const out: { x: number; z: number }[] = [];
  for (let x = r.x0; x <= r.x1 + 1e-9; x += s) {
    for (let z = r.z0; z <= r.z1 + 1e-9; z += s) out.push({ x, z });
  }
  return out;
}

describe('the Last Keep is drawn on the ground the sim stands players on', () => {
  it('keeps the terrain mesh view exactly flat over the graded castle grounds', () => {
    // The one property that makes the mesh lattice-proof. Any feature left in
    // here that is narrower than a vertex cell comes back as a sink.
    for (const p of grid(GROUNDS, 0.25)) {
      if (castlePadWeight(p.x, p.z) !== 1) continue;
      expect(
        Math.abs(meshTerrainHeight(p.x, p.z, SEED) - CASTLE.pad.h),
        `mesh height view at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`,
      ).toBeLessThan(1e-4);
    }
  });

  it('never draws ground above a player standing on the keep flanks, at any LOD', () => {
    // The east and west faces the report names, plus the north and south rims,
    // swept at every LOD band spacing and at two lattice phases (the real
    // chunk anchor and a half-cell offset), so no vertex alignment hides it.
    const faces = [
      { name: 'west face', x0: 393, x1: 403, z0: 1990, z1: 2020 },
      { name: 'east face', x0: 428, x1: 438, z0: 1990, z1: 2020 },
      { name: 'north rim', x0: 396, x1: 435, z0: 1986, z1: 1996 },
      { name: 'south rim', x0: 396, x1: 435, z0: 2014, z1: 2024 },
    ];
    for (const face of faces) {
      for (const spacing of SPACINGS) {
        for (const originX of [-WORLD_MAX_X, -WORLD_MAX_X + CHUNK_SIZE / 2]) {
          for (const p of grid(face, 0.5)) {
            if (castlePadWeight(p.x, p.z) !== 1) continue;
            const drawn = meshSurface(p.x, p.z, spacing, originX);
            expect(
              drawn - groundHeight(p.x, p.z, SEED),
              `${face.name} sink at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) spacing ${spacing}`,
            ).toBeLessThan(0.02);
          }
        }
      }
    }
  });

  it('leaves nobody standing on air: every gap under the feet is authored masonry', () => {
    // Where the mesh sits BELOW the sim ground, a built mass has to be drawn
    // there. castleLift is the curtain walls, bastions and stair flights;
    // wardTerraceRise is the ward plinth castle_features.ts now builds.
    for (const p of grid(GROUNDS, 0.25)) {
      if (castlePadWeight(p.x, p.z) !== 1) continue;
      const gap = groundHeight(p.x, p.z, SEED) - meshTerrainHeight(p.x, p.z, SEED);
      if (gap <= 0.05) continue;
      const built = castleLift(p.x, p.z) > 0 || wardTerraceRise(p.x, p.z) > 0;
      expect(
        built,
        `unbuilt ${gap.toFixed(2)}yd gap at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`,
      ).toBe(true);
    }
  });

  it('pins the ward mass the render draws to the terrace the sim walks', () => {
    // castle_features.ts builds the plinth, its facing blocks and its stair
    // wedges from exactly these numbers, so they cannot drift apart.
    const w = CASTLE.ward;
    expect(wardTerraceRise(415, 2005), 'full height well inside the rect').toBeCloseTo(2.6, 6);
    expect(CASTLE.ward.h - CASTLE.pad.h, 'the terrace stands 2.6 over the bailey').toBeCloseTo(
      2.6,
      6,
    );
    expect(groundHeight(415, 2005, SEED), 'the sim terrace').toBeCloseTo(8.6, 6);
    // zero on every rect line, so the drawn facing sits on the sim's cliff
    for (const p of [
      { x: w.x0, z: 2005 },
      { x: w.x1, z: 2005 },
      { x: 415, z: w.z0 },
      { x: 393, z: 2005 },
      { x: 438, z: 2005 },
    ]) {
      expect(wardTerraceRise(p.x, p.z), `ward rise at (${p.x}, ${p.z})`).toBe(0);
    }
    // the two stair cuts ramp the terrace down to the bailey over their run
    for (const cut of WARD_STEPS) {
      const cx = (cut.x0 + cut.x1) / 2;
      expect(wardTerraceRise(cx, w.z1), 'cut starts at terrace height').toBeCloseTo(2.6, 6);
      expect(wardTerraceRise(cx, w.z1 + WARD_STEP_RUN / 2), 'half way down').toBeCloseTo(1.3, 6);
      expect(wardTerraceRise(cx, w.z1 + WARD_STEP_RUN), 'lands on the bailey').toBeCloseTo(0, 6);
      // and the rise is gentle enough for the mesh-free wedge to read as stairs
      expect(2.6 / WARD_STEP_RUN, 'stair run').toBeLessThan(1);
    }
  });

  it('builds a solid ward mass whose top is the terrace height, not a dirt shelf', async () => {
    // The mesh no longer carries the terrace, so castle_features.ts MUST: this
    // is what a player on the ward now stands on. Asset loads never resolve, so
    // only the analytic masses land in the group, which is exactly what we want
    // to measure.
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => new Promise(() => {})),
      loadHdr: vi.fn(() => new Promise(() => {})),
      loadTexture: vi.fn(() => new Promise(() => {})),
      releaseGltf: vi.fn(),
    }));
    const { buildCastleFeatures } = await import('../src/render/castle_features');
    const w = CASTLE.ward;
    const view = buildCastleFeatures();
    const boxes = view.group.children
      .filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh)
      .map((mesh) => {
        mesh.geometry.computeBoundingBox();
        return (mesh.geometry.boundingBox as THREE.Box3)
          .clone()
          .applyMatrix4(
            mesh.matrixWorld.clone().compose(mesh.position, mesh.quaternion, mesh.scale),
          );
      });
    // the terrace mass: the one that spans most of the ward rect in both axes
    const plinth = boxes.find(
      (b) => b.max.x - b.min.x > (w.x1 - w.x0) * 0.9 && b.max.z - b.min.z > (w.z1 - w.z0) * 0.9,
    );
    expect(plinth, 'a ward-sized mass must be drawn under the terrace').toBeTruthy();
    if (!plinth) return;
    expect(plinth.max.y, 'its top IS the terrace the sim walks').toBeCloseTo(CASTLE.ward.h, 4);
    expect(plinth.min.y, 'and it reaches below the bailey floor it stands on').toBeLessThan(
      CASTLE.pad.h,
    );
    // it may not overhang the rect: that ground is walkable bailey
    expect(plinth.min.x).toBeGreaterThanOrEqual(w.x0 - 1e-6);
    expect(plinth.max.x).toBeLessThanOrEqual(w.x1 + 1e-6);
    expect(plinth.min.z).toBeGreaterThanOrEqual(w.z0 - 1e-6);
    expect(plinth.max.z).toBeLessThanOrEqual(w.z1 + 1e-6);
    // and the two stair cuts get their own wedges reaching the terrace top
    for (const cut of WARD_STEPS) {
      const wedge = boxes.find(
        (b) =>
          b.min.x >= cut.x0 - 1e-6 &&
          b.max.x <= cut.x1 + 1e-6 &&
          b.min.z >= w.z1 - 1e-6 &&
          Math.abs(b.max.y - CASTLE.ward.h) < 1e-4,
      );
      expect(wedge, `a stair wedge for the cut at x ${cut.x0}..${cut.x1}`).toBeTruthy();
      expect(wedge?.max.z, 'running out to the bailey').toBeCloseTo(w.z1 + WARD_STEP_RUN, 4);
    }
    vi.doUnmock('../src/render/assets/loader');
  });
});
