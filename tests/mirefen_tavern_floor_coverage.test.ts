import path from 'node:path';
import { type Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIREFEN_TAVERN_ASSET } from '../scripts/assets/mirefen_tavern/build.mjs';
import {
  insideEastbrookGrassExclusion,
  mirefenTavernGrassExclusions,
} from '../src/render/foliage_core';
import {
  TAVERN_BAR_PLATFORM,
  TAVERN_HALL,
  TAVERN_PIT,
  TAVERN_STAGE,
  TAVERN_TOWER,
  tavernToWorld,
} from '../src/sim/content/mirefen_tavern';
import {
  tavernHallWalls,
  tavernInsideLocal,
  tavernTowerWallSegments,
  tavernWingWalls,
} from '../src/sim/mirefen_tavern';
import { mirefenTavernCovers, tavernLocalHeight } from '../src/sim/mirefen_tavern_floor';

// The Mirefen tavern's floor is whole (public/models/props/mirefen_tavern.glb against the sim's
// walk floor, src/sim/mirefen_tavern_floor.ts). Every up-facing triangle of the shipped model
// is rasterised onto a fine grid over the tavern's plan, and every cell a player can stand in
// (inside the tavern, not inside a wall) must carry a drawn floor at the sim's walk height: no
// slot where the ground outside shows through (the strip beside the bar platform left of the
// innkeeper once did, and the boards' square ends left crescents round the hearth pit's curb;
// the stage's deck and the tower's flagged nook are pinned the same way).
// Seams narrower than JOINT (the boards' hairline joints) are not gaps; a flagged floor's
// wider joints must show a mortar bed, never the ground. The sim's walk floor has a height
// everywhere inside, and the grass and the scatter keep off the whole footprint.

const ROOT = path.join(__dirname, '..');
const GLB = path.join(ROOT, MIREFEN_TAVERN_ASSET.target);

/** The grid's cell (yards) and the seam a cell may straddle unflagged (the offsets sampled
 *  round each cell's centre). */
const STEP = 0.1;
const JOINT = 0.012;
/** A drawn floor within this band of the sim's walk height counts: from a mortar bed a hand
 *  under a flag to a nosing a hair over a deck. */
const BELOW = 0.3;
const ABOVE = 0.12;

const X0 = TAVERN_HALL.x0;
const X1 = TAVERN_HALL.x1;
const Z0 = -28;
const Z1 = TAVERN_HALL.z1;
const NX = Math.round((X1 - X0) / STEP);
const NZ = Math.round((Z1 - Z0) / STEP);

let doc: Document;
let cover: Uint8Array;

function cellX(i: number): number {
  return X0 + (i + 0.5) * STEP;
}
function cellZ(j: number): number {
  return Z0 + (j + 0.5) * STEP;
}

/** Rasterise every up-facing triangle of the model onto the grid (1: a drawn floor there). */
function rasterise(): Uint8Array {
  const out = new Uint8Array(NX * NZ);
  const offsets = [
    [0, 0],
    [JOINT, 0],
    [-JOINT, 0],
    [0, JOINT],
    [0, -JOINT],
  ];
  const v = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      if (!pos || !idx) continue;
      const pts = new Float64Array(pos.getCount() * 3);
      for (let k = 0; k < pos.getCount(); k++) {
        pos.getElement(k, v);
        pts[k * 3] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
        pts[k * 3 + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
        pts[k * 3 + 2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
      }
      for (let t = 0; t < idx.getCount(); t += 3) {
        const a = idx.getScalar(t) * 3;
        const b = idx.getScalar(t + 1) * 3;
        const c = idx.getScalar(t + 2) * 3;
        const ax = pts[a];
        const ay = pts[a + 1];
        const az = pts[a + 2];
        const bx = pts[b];
        const by = pts[b + 1];
        const bz = pts[b + 2];
        const cx = pts[c];
        const cy = pts[c + 1];
        const cz = pts[c + 2];
        const ux = bx - ax;
        const uy = by - ay;
        const uz = bz - az;
        const wx = cx - ax;
        const wy = cy - ay;
        const wz = cz - az;
        const nx = uy * wz - uz * wy;
        const ny = uz * wx - ux * wz;
        const nz = ux * wy - uy * wx;
        const len = Math.hypot(nx, ny, nz);
        // a floor faces up (a ramp or a curb's bevel included), never a wall or an underside
        if (len < 1e-12 || ny / len < 0.3) continue;
        const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(den) < 1e-12) continue;
        const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - JOINT - X0) / STEP - 0.5));
        const i1 = Math.min(NX - 1, Math.floor((Math.max(ax, bx, cx) + JOINT - X0) / STEP - 0.5));
        const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - JOINT - Z0) / STEP - 0.5));
        const j1 = Math.min(NZ - 1, Math.floor((Math.max(az, bz, cz) + JOINT - Z0) / STEP - 0.5));
        for (let i = i0; i <= i1; i++) {
          for (let j = j0; j <= j1; j++) {
            if (out[i * NZ + j]) continue;
            for (const [ox, oz] of offsets) {
              const px = cellX(i) + ox;
              const pz = cellZ(j) + oz;
              const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den;
              const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den;
              const l3 = 1 - l1 - l2;
              if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
              const y = l1 * ay + l2 * by + l3 * cy;
              const h = tavernLocalHeight(px, pz);
              if (Number.isNaN(h)) continue;
              if (y >= h - BELOW && y <= h + ABOVE) {
                out[i * NZ + j] = 1;
                break;
              }
            }
          }
        }
      }
    }
  }
  return out;
}

function inBox(x: number, z: number, b: readonly [number, number, number, number]): boolean {
  return x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3];
}

const WALLS = [...tavernHallWalls(), ...tavernWingWalls()];
const RING = tavernTowerWallSegments();

/** Whether a local point stands where a player may: inside the tavern, clear of every wall
 *  and of the tower's ring. */
function standable(x: number, z: number): boolean {
  if (!tavernInsideLocal(x, z)) return false;
  for (const b of WALLS) if (inBox(x, z, b)) return false;
  const r = Math.hypot(x - TAVERN_TOWER.x, z - TAVERN_TOWER.z);
  if (r >= TAVERN_TOWER.rIn - 0.05 && r <= TAVERN_TOWER.rOut + 0.05) {
    for (const s of RING) {
      const dx = x - s.x;
      const dz = z - s.z;
      const lx = dx * Math.cos(s.rot) - dz * Math.sin(s.rot);
      const lz = dx * Math.sin(s.rot) + dz * Math.cos(s.rot);
      if (Math.abs(lx) <= s.hw && Math.abs(lz) <= s.hd + 0.05) return false;
    }
  }
  return true;
}

/** The standable cells the model leaves without a floor, as "x,z" strings. */
function gaps(): string[] {
  const out: string[] = [];
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NZ; j++) {
      const x = cellX(i);
      const z = cellZ(j);
      if (!standable(x, z) || cover[i * NZ + j]) continue;
      out.push(`${x.toFixed(2)},${z.toFixed(2)}`);
    }
  }
  return out;
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(GLB);
  cover = rasterise();
});

describe('the Mirefen tavern floor is whole', () => {
  it('draws a floor at the walk height under every standable cell, the hall and the nook', () => {
    const missing = gaps();
    expect(missing.length, `floor gaps at local ${missing.slice(0, 20).join(' ')}`).toBe(0);
  });

  it('floors the strip left of the bar platform, the corners, the pit curb and the nook', () => {
    // the named spots the owner and the audit found open onto the ground, and the new
    // stage's rounded corner, the arch's threshold and the nook's rose
    const plat = TAVERN_BAR_PLATFORM;
    const st = TAVERN_STAGE;
    const spots: [number, number][] = [
      [plat.x0 - 0.25, -12.5],
      [plat.x0 - 0.25, -11],
      [plat.x0 - 0.45, plat.z1 + 0.35],
      [TAVERN_PIT.x - 5.5, TAVERN_PIT.z - 2.2],
      [TAVERN_PIT.x + 5.5, TAVERN_PIT.z + 2.2],
      [st.x1 + 0.3, st.z1 + 0.3],
      [(st.x0 + st.x1) / 2, (st.z0 + st.z1) / 2],
      [-1.5, TAVERN_HALL.z0 + 0.2],
      [TAVERN_TOWER.x, TAVERN_TOWER.z],
      [TAVERN_TOWER.x + 4, TAVERN_TOWER.z - 3],
    ];
    for (const [x, z] of spots) {
      const i = Math.floor((x - X0) / STEP);
      const j = Math.floor((z - Z0) / STEP);
      expect(standable(cellX(i), cellZ(j)), `${x},${z}`).toBe(true);
      expect(cover[i * NZ + j], `${x},${z}`).toBe(1);
    }
  });

  it('gives the sim a walk height everywhere a player may stand', () => {
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NZ; j++) {
        const x = cellX(i);
        const z = cellZ(j);
        if (!standable(x, z)) continue;
        expect(Number.isFinite(tavernLocalHeight(x, z)), `${x},${z}`).toBe(true);
      }
    }
  });

  it('keeps the grass and the scatter off the whole footprint', () => {
    const grass = mirefenTavernGrassExclusions();
    for (let i = 0; i < NX; i += 2) {
      for (let j = 0; j < NZ; j += 2) {
        const x = cellX(i);
        const z = cellZ(j);
        if (!standable(x, z)) continue;
        const w = tavernToWorld(x, z);
        expect(insideEastbrookGrassExclusion(grass, w.x, w.z, 0), `grass ${x},${z}`).toBe(true);
        expect(mirefenTavernCovers(w.x, w.z), `scatter ${x},${z}`).toBe(true);
      }
    }
  });
});
