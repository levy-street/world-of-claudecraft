// The Smith's Heart's mountain rock kit (phase 2E: scripts/assets/
// smith_heart_rock_kit/build.mjs, built from docs/design/raid/kit/
// build_smith_heart_rock_kit.py) and its plan (src/render/smith_heart/
// heart_rock_plan_core.ts):
//   - the shipped GLB is the current sources' (fingerprint, nodes, the one
//     lit material), inside the dungeon kit budget, every piece light enough
//     to be drawn by the hundred;
//   - the measures the plan relies on are the GLB's: each face's front plane
//     (nothing of it in front), its reach, depth and height, the far builds
//     the same rock; the lips hang under their brink, leaning out;
//   - the plan skins the whole mountain band by band (the Hammer vein and the
//     rest of the main map alike), keeps every piece's front behind its
//     contour of the clearance and out of the open air, stretches no piece
//     past its beds, sheds only the upper bands on the low tier, and stands
//     nothing render-only over a walked floor (the lips never proud of one);
//   - the mountain's slope steps back behind the first band, under its floor;
//   - the rock is cut away round the camera.
// The glTF frame is the kit's Blender frame turned y up: (x, z, -y), so a
// piece's front (Blender -Y) is +Z here, as in the game.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  SMITH_HEART_ROCK_KIT_PIECES,
  sourceFingerprint,
} from '../scripts/assets/smith_heart_rock_kit/build.mjs';
import { heartKitPlacementMatrix } from '../src/render/smith_heart/heart_kit';
import type { HeartKitPlacement } from '../src/render/smith_heart/heart_kit_core';
import {
  HEART_MOUNTAIN_CHASM,
  HEART_MOUNTAIN_LEDGE,
  HEART_MOUNTAIN_RECESS,
  heartMountainHeight,
} from '../src/render/smith_heart/heart_mountain_core';
import { applyRockCutaway, heartRockBedGlsl } from '../src/render/smith_heart/heart_rock_cutaway';
import {
  HEART_ROCK_BANDS,
  HEART_ROCK_CUT_FAR,
  HEART_ROCK_CUT_NEAR,
  HEART_ROCK_FAR_FROM,
  HEART_ROCK_FIRST_SLACK,
  HEART_ROCK_FOCUS_R,
  HEART_ROCK_LIP,
  HEART_ROCK_PIECES,
  HEART_ROCK_RISE,
  HEART_ROCK_STRATA,
  HEART_ROCK_UNDER,
  HEART_ROCK_UPPER_SLACK,
  heartRockBedFloor,
  heartRockFocus,
  heartRockFrontPoints,
  heartRockPieceOf,
  planHeartLips,
  planHeartRock,
  planHeartUnderCliffs,
} from '../src/render/smith_heart/heart_rock_plan_core';
import {
  HEART_WALL_CLEAR,
  HEART_WALL_PATH_CLEAR,
  heartFloorClearance,
  heartOpenAir,
} from '../src/render/smith_heart/heart_walls_core';
import {
  SMITH_HEART_FIELD,
  SMITH_HEART_FLOATING_SURFACES,
  smithHeartAreaAt,
} from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const KIT = ASSET.target;
const haveKit = existsSync(KIT);
const F = SMITH_HEART_FIELD;

type V3 = [number, number, number];
interface Shape {
  min: V3;
  max: V3;
  points: V3[];
  triangles: number;
}

const shapes = new Map<string, Shape>();
let extras: Record<string, unknown> = {};
let nodeNames: string[] = [];
let materialNames: string[] = [];

beforeAll(async () => {
  if (!haveKit) return;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(KIT)));
  extras = (doc.getRoot().getExtras() ?? {}) as Record<string, unknown>;
  nodeNames = doc
    .getRoot()
    .listNodes()
    .map((n) => n.getName())
    .sort();
  materialNames = doc
    .getRoot()
    .listMaterials()
    .map((m) => m.getName())
    .sort();
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!name.startsWith('Kit_')) continue;
    const points: V3[] = [];
    let triangles = 0;
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      triangles += (prim.getIndices()?.getCount() ?? a.getCount()) / 3;
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        points.push([
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        ]);
      }
    }
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of points)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    shapes.set(name, { min, max, points, triangles });
  }
});

const shape = (name: string): Shape => {
  const s = shapes.get(name);
  if (!s) throw new Error(`no kit piece ${name}`);
  return s;
};

/** The clearance past a floor at (x, z): how far behind the mountain's own
 *  clearance line the point lies. */
function backOf(x: number, z: number): number {
  const c = heartFloorClearance(x, z);
  return c.d - (c.path ? HEART_WALL_PATH_CLEAR : HEART_WALL_CLEAR);
}

/** The band a placed face piece belongs to (its front's contour). */
function bandOf(p: HeartKitPlacement): number {
  const b = backOf(p.x, p.z);
  let best = 0;
  HEART_ROCK_BANDS.forEach((band, i) => {
    if (Math.abs(band.back - b) < Math.abs(HEART_ROCK_BANDS[best].back - b)) best = i;
  });
  return best;
}

const FACES = Object.keys(HEART_ROCK_PIECES);
const rock = planHeartRock();
const lips = planHeartLips();
const under = planHeartUnderCliffs();

describe('Smith Heart rock kit: the piece list and the shipped GLB', () => {
  it('lists every piece once: the faces, their far builds, the lips, the boulders', () => {
    const list = SMITH_HEART_ROCK_KIT_PIECES;
    expect(new Set(list).size).toBe(list.length);
    for (const face of FACES) {
      expect(list, face).toContain(face.slice(4));
      expect(list, `${face}Far`).toContain(`${face.slice(4)}Far`);
    }
    for (const piece of ['RockLipA', 'RockLipB', 'BoulderA']) expect(list).toContain(piece);
  });

  it.skipIf(!haveKit)('was built from the current sources, nodes and material intact', () => {
    expect(extras.sourceFingerprint).toBe(sourceFingerprint());
    expect(nodeNames).toEqual(
      [ASSET.root, ...SMITH_HEART_ROCK_KIT_PIECES.map((p) => `Kit_${p}`)].sort(),
    );
    // Lit stone only: the mountain carries no light of its own.
    expect(materialNames).toEqual(['KitStone']);
    expect(statSync(KIT).size).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it.skipIf(!haveKit)('keeps every piece light enough to be drawn by the hundred', () => {
    let total = 0;
    for (const [name, s] of shapes) {
      expect(s.triangles, name).toBeGreaterThan(0);
      const cap = /Far$/.test(name)
        ? 1100
        : /Needle/.test(name)
          ? 4000
          : /Boulder/.test(name)
            ? 600
            : /Lip/.test(name)
              ? 1300
              : 3000;
      expect(s.triangles, name).toBeLessThanOrEqual(cap);
      total += s.triangles;
    }
    expect(total).toBeLessThan(42_000);
  });
});

describe('Smith Heart rock kit: the measures the plan relies on', () => {
  it.skipIf(!haveKit)('stands every face behind its front plane, its measures the GLB’s', () => {
    for (const name of FACES) {
      const m = HEART_ROCK_PIECES[name];
      for (const built of [name, `${name}Far`]) {
        const s = shape(built);
        // Nothing in front of the front plane (glTF +Z is the front).
        expect(s.max[2], built).toBeLessThanOrEqual(0.25);
        expect(s.max[2], built).toBeGreaterThan(-0.3);
        expect(s.min[1], built).toBeGreaterThan(-0.1);
        expect(Math.max(-s.min[0], s.max[0]), built).toBeLessThanOrEqual(m.reach + 0.3);
        expect(Math.max(-s.min[0], s.max[0]), built).toBeGreaterThan(m.reach - 0.5);
        expect(-s.min[2], built).toBeLessThanOrEqual(m.depth + 0.4);
        expect(Math.abs(s.max[1] - m.height), built).toBeLessThan(1.2);
      }
      expect(m.half).toBeLessThan(m.reach);
    }
  });

  it.skipIf(!haveKit)('hangs the lips under their brink, leaning out over the void', () => {
    for (const name of ['Kit_RockLipA', 'Kit_RockLipB']) {
      const s = shape(name);
      // Never proud of the walk it hangs from.
      expect(s.max[1], name).toBeLessThan(-0.04);
      expect(s.min[1], name).toBeCloseTo(-HEART_ROCK_LIP.drop, 0);
      // Out over the void as far as its face leans, its body back under the walk.
      expect(s.max[2], name).toBeLessThanOrEqual(HEART_ROCK_LIP.out * HEART_ROCK_LIP.drop + 1.5);
      expect(s.max[2], name).toBeGreaterThan(HEART_ROCK_LIP.out * HEART_ROCK_LIP.drop * 0.7);
      expect(-s.min[2], name).toBeLessThanOrEqual(HEART_ROCK_LIP.depth + 2);
      expect(Math.max(-s.min[0], s.max[0]), name).toBeLessThanOrEqual(HEART_ROCK_LIP.half + 2.8);
    }
  });

  it('stretches a piece up its slope through the placement matrix', () => {
    const m = new THREE.Matrix4();
    heartKitPlacementMatrix(
      { piece: 'Kit_RockWallA', x: 3, y: -2, z: 1, rot: 0, scale: 1.5, rise: 1.2 },
      m,
    );
    const p = new THREE.Vector3(1, 10, 0).applyMatrix4(m);
    expect(p.x).toBeCloseTo(4.5, 6);
    expect(p.y).toBeCloseTo(-2 + 18, 6);
    expect(p.z).toBeCloseTo(1, 6);
  });
});

describe('heart_rock_plan_core: the mountain skinned band by band', () => {
  it('plans every band, the Hammer vein and every other area of the main map', () => {
    // Phase 2G: a few hundred great faces (2F's eleven hundred small plated
    // pieces read as crumpled paper).
    expect(rock.length).toBeGreaterThan(300);
    expect(rock.length).toBeLessThan(800);
    const bands = new Set(rock.map(bandOf));
    for (let i = 0; i < HEART_ROCK_BANDS.length; i++) expect(bands.has(i), `band ${i}`).toBe(true);
    const areas = new Map<string, number>();
    for (const p of rock) {
      const a = smithHeartAreaAt(p.x, p.z);
      areas.set(a, (areas.get(a) ?? 0) + 1);
    }
    for (const a of ['hammer', 'breath', 'quench', 'heat', 'heart'])
      expect(areas.get(a) ?? 0, a).toBeGreaterThan(30);
  });

  it('keeps every front behind its contour and out of the open air', () => {
    const bad: string[] = [];
    for (const p of rock) {
      const i = bandOf(p);
      const slack = i === 0 ? HEART_ROCK_FIRST_SLACK : HEART_ROCK_UPPER_SLACK;
      const m = heartRockPieceOf(p.piece);
      for (const q of heartRockFrontPoints(p, m))
        if (backOf(q.x, q.z) < HEART_ROCK_BANDS[i].back - slack - 1e-6)
          bad.push(`${p.piece} (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) front`);
      if (heartOpenAir(p.x, p.z, m.reach * (p.scale ?? 1)))
        bad.push(`${p.piece} (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) open air`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
    // The first band never comes nearer than the mountain's own clearance
    // (less the distance field's grain).
    expect(HEART_ROCK_FIRST_SLACK).toBeLessThanOrEqual(1.5);
  });

  it('stretches no piece past its beds, scales within its band, sheds only upper bands', () => {
    for (const p of rock) {
      const i = bandOf(p);
      const band = HEART_ROCK_BANDS[i];
      expect(p.rise ?? 1, p.piece).toBeGreaterThanOrEqual(HEART_ROCK_RISE[0] - 1e-9);
      expect(p.rise ?? 1, p.piece).toBeLessThanOrEqual(HEART_ROCK_RISE[1] + 1e-6);
      expect(p.scale ?? 1, p.piece).toBeGreaterThanOrEqual(band.scale[0] * 0.7 - 1e-9);
      expect(p.scale ?? 1, p.piece).toBeLessThanOrEqual(band.scale[1] + 1e-9);
      // The low tier keeps the first two bands (the walls the walks see).
      expect(!!p.cosmetic, `${p.piece} band ${i}`).toBe(band.cosmetic);
      // The far builds only high up the mountain.
      expect(p.piece.endsWith('Far'), `${p.piece} band ${i}`).toBe(i >= HEART_ROCK_FAR_FROM);
      expect(p.noShadow).toBe(true);
    }
    expect(HEART_ROCK_BANDS[0].cosmetic).toBe(false);
    expect(HEART_ROCK_BANDS[1].cosmetic).toBe(false);
  });

  it('covers the mountain past the walks: no flat plane left between the pieces', () => {
    // Every point of the mountain's slope from the clearance line up the
    // first sixty yards lies inside some piece's footprint (its true front
    // back to its depth), in the Hammer vein and across the main map.
    const covered = (x: number, z: number): boolean =>
      rock.some((p) => {
        const m = heartRockPieceOf(p.piece);
        const k = p.scale ?? 1;
        const dx = x - p.x;
        const dz = z - p.z;
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        return Math.abs(lx) <= m.half * k && lz <= 0.5 && lz >= -m.depth * k;
      });
    const share = (area: (a: string) => boolean): number => {
      let n = 0;
      let hit = 0;
      const b = F.bounds;
      for (let x = b.minX - 60; x <= b.maxX + 60; x += 4)
        for (let z = b.minZ - 60; z <= b.maxZ + 60; z += 4) {
          if (!area(smithHeartAreaAt(x, z))) continue;
          if (heartMountainHeight(x, z) <= HEART_MOUNTAIN_CHASM) continue;
          const back = backOf(x, z);
          if (back < 0 || back > 60) continue;
          n++;
          if (covered(x, z)) hit++;
        }
      return hit / n;
    };
    expect(share((a) => a === 'hammer')).toBeGreaterThan(0.95);
    expect(share((a) => a !== 'hammer' && a !== 'heart')).toBeGreaterThan(0.9);
  });

  it('steps the slope back behind the first band, under its floor', () => {
    // From the clearance line to the recess the mountain is a ledge under
    // the floor it faces (the first band's faces stand on it, never buried).
    let checked = 0;
    const b = F.bounds;
    for (let x = b.minX - 40; x <= b.maxX + 40; x += 3)
      for (let z = b.minZ - 40; z <= b.maxZ + 40; z += 3) {
        const c = heartFloorClearance(x, z);
        const back = backOf(x, z);
        if (!(back >= 0 && back < HEART_MOUNTAIN_RECESS)) continue;
        const h = heartMountainHeight(x, z);
        if (h <= HEART_MOUNTAIN_CHASM) continue;
        expect(h, `(${x}, ${z})`).toBeLessThanOrEqual(c.floor - HEART_MOUNTAIN_LEDGE + 1e-6);
        checked++;
      }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('heart_rock_plan_core: the walks’ sides', () => {
  it('hangs a lip under every walk falling into the chasm, never under a floating island', () => {
    expect(lips.length).toBeGreaterThan(200);
    const floating = new Set(SMITH_HEART_FLOATING_SURFACES);
    for (const p of lips) {
      expect(p.cosmetic).toBe(false);
      expect(p.stretch ?? 1).toBeGreaterThan(0.2);
      expect(p.stretch ?? 1).toBeLessThan(1.6);
      // The walk it hangs from, a few yards back from its brink.
      let s = null as ReturnType<typeof authoredFieldSurfaceAt>;
      for (let back = HEART_ROCK_LIP.push + 0.5; back <= HEART_ROCK_LIP.push + 6 && !s; back += 0.5)
        s = authoredFieldSurfaceAt(F, p.x - Math.sin(p.rot) * back, p.z - Math.cos(p.rot) * back);
      expect(s, `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).not.toBeNull();
      expect(floating.has(s?.id ?? ''), s?.id).toBe(false);
    }
  });

  it.skipIf(!haveKit)('stands nothing render-only over a walked floor', () => {
    // Every rock piece's and lip's real mesh, placed: no vertex over a walked
    // floor (a lip under its walk, a face behind its clearance).
    const bad: string[] = [];
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const p of [...rock, ...under, ...lips]) {
      heartKitPlacementMatrix(p, m);
      const pts = shape(p.piece).points;
      for (let i = 0; i < pts.length; i += 5) {
        v.set(pts[i][0], pts[i][1], pts[i][2]).applyMatrix4(m);
        const surface = authoredFieldSurfaceAt(F, v.x, v.z);
        if (!surface) continue;
        const floor = authoredFieldHeight(F, v.x, v.z);
        if (v.y > floor + 0.02 && v.y < floor + 2.6) {
          bad.push(`${p.piece} over ${surface.id} at (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`);
          break;
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe('heart_rock_plan_core: the calm mountain (phase 2G)', () => {
  it('lines every face up on the world’s beds: one height scale, every foot on the grid', () => {
    const S = HEART_ROCK_STRATA;
    expect(S.lift).toBeCloseTo(S.kitLift * S.scale, 6);
    for (const p of [...rock, ...under]) {
      // The beds' height scale (a piece's lifts stand `lift` apart).
      expect((p.scale ?? 1) * (p.rise ?? 1), p.piece).toBeCloseTo(S.scale, 6);
      // Its foot on a bed line.
      expect(heartRockBedFloor(p.y + 1e-6), p.piece).toBeCloseTo(p.y, 5);
    }
  });

  it('keeps the faces broad: few pieces, each several times 2F’s plates', () => {
    for (const [name, m] of Object.entries(HEART_ROCK_PIECES)) {
      expect(m.half * 2, name).toBeGreaterThan(20);
      expect(m.height, name).toBeGreaterThan(44);
    }
    const mean =
      rock.reduce((a, p) => a + heartRockPieceOf(p.piece).half * 2 * (p.scale ?? 1), 0) /
      rock.length;
    expect(mean).toBeGreaterThan(30);
  });

  it('stands the buttress where the eye goes, the plain faces elsewhere', () => {
    const prows = rock.filter((p) => /Prow/.test(p.piece));
    // Nearly every focus (a vein mouth, a stair head, a way into an arena)
    // with the mountain beside it has a buttress there.
    let foci = 0;
    let dressed = 0;
    for (const f of heartRockFocus()) {
      const near = rock.filter((p) => Math.hypot(p.x - f.x, p.z - f.z) < HEART_ROCK_FOCUS_R + 10);
      if (near.length === 0) continue;
      foci++;
      if (near.some((p) => /Prow/.test(p.piece))) dressed++;
    }
    expect(foci).toBeGreaterThan(15);
    expect(dressed / foci).toBeGreaterThan(0.85);
    // Never the mountain's common piece (the rest fill bends too sharp for
    // a broad face).
    expect(prows.length).toBeLessThan(rock.length * 0.2);
  });

  it('hangs a great face under every high walk, under its lip and never over a walk', () => {
    expect(under.length).toBeGreaterThan(30);
    const F2 = SMITH_HEART_FIELD;
    for (const p of under) {
      const m = heartRockPieceOf(p.piece);
      const top = p.y + m.height * HEART_ROCK_STRATA.scale;
      // The walk it stands under: back toward it from its front.
      let floor = Number.NEGATIVE_INFINITY;
      for (let back = 0; back <= HEART_ROCK_UNDER.out + 16; back += 0.5) {
        const x = p.x - Math.sin(p.rot) * back;
        const z = p.z - Math.cos(p.rot) * back;
        if (authoredFieldSurfaceAt(F2, x, z)) {
          floor = authoredFieldHeight(F2, x, z);
          break;
        }
      }
      expect(Number.isFinite(floor), `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBe(true);
      expect(top, `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBeLessThanOrEqual(
        floor - HEART_ROCK_UNDER.below + 1e-6,
      );
      expect(heartOpenAir(p.x, p.z, 4)).toBe(false);
    }
  });

  it('paints the world’s beds on the rock on the same grid', () => {
    const glsl = heartRockBedGlsl();
    expect(glsl).toContain(HEART_ROCK_STRATA.lift.toFixed(2));
    expect(glsl).toContain(HEART_ROCK_STRATA.zero.toFixed(2));
    expect(glsl).toContain('diffuseColor.rgb');
  });
});

describe('heart_rock_cutaway: the rock never hides the player from their camera', () => {
  it('discards the rock near the camera and keys its own program', () => {
    expect(HEART_ROCK_CUT_NEAR).toBeGreaterThan(2);
    expect(HEART_ROCK_CUT_FAR).toBeGreaterThan(HEART_ROCK_CUT_NEAR);
    const mat = new THREE.MeshLambertMaterial();
    const before = mat.customProgramCacheKey();
    applyRockCutaway(mat);
    expect(mat.customProgramCacheKey()).not.toBe(before);
    const shader = {
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <clipping_planes_fragment>',
      uniforms: {},
    };
    mat.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain('vRockCutWorld');
    expect(shader.vertexShader).toContain('instanceMatrix');
    expect(shader.fragmentShader).toContain('discard');
    expect(shader.fragmentShader).toContain('cameraPosition');
  });
});
