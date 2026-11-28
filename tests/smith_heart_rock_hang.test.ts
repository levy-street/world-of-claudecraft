// The faces hung under the Breath's high walks (the AAA pass's third round,
// src/render/smith_heart/heart_rock_hang_core.ts, the rock kit's
// Kit_RockHangA/B from docs/design/raid/kit/rock_sculpt.py `rock_hang`), the
// gulf opened between the first landing and the Cornice, and the storm
// granite the rock kit takes in the Breath (breath_rock_storm_core.ts):
//   - the shipped pieces hang under their brink, battered out over the void,
//     their measures the plan's;
//   - every high Breath walk seen from the Ring is hung brink to mist, never
//     through a walked floor, never in the open air, the lips and under-walls
//     it doubles left out;
//   - the gulf is open air, so the mountain falls away there (the flat slab
//     that stood in front of the Cornice from the Ring);
//   - the storm granite holds in the Breath only and rides the rock's program.

import { existsSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  SMITH_HEART_ROCK_KIT_PIECES,
} from '../scripts/assets/smith_heart_rock_kit/build.mjs';
import {
  BREATH_ROCK_STORM,
  breathRockStormGlsl,
  breathRockStormWeight,
} from '../src/render/smith_heart/breath_rock_storm_core';
import { heartKitPlacementMatrix } from '../src/render/smith_heart/heart_kit';
import {
  HEART_MOUNTAIN_CHASM,
  heartMountainHeight,
} from '../src/render/smith_heart/heart_mountain_core';
import { applyRockCutaway } from '../src/render/smith_heart/heart_rock_cutaway';
import {
  HEART_HANG_SURFACES,
  HEART_ROCK_HANG,
  heartHangCovers,
  heartHangHides,
  planHeartHangs,
  planHeartRockLips,
  planHeartRockUnder,
} from '../src/render/smith_heart/heart_rock_hang_core';
import {
  planHeartLips,
  planHeartUnderCliffs,
} from '../src/render/smith_heart/heart_rock_plan_core';
import { HEART_BREATH_GULF, heartOpenAir } from '../src/render/smith_heart/heart_walls_core';
import { SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const F = SMITH_HEART_FIELD;
const KIT = ASSET.target;
const haveKit = existsSync(KIT);
type V3 = [number, number, number];
const shapes = new Map<string, { min: V3; max: V3; points: V3[] }>();

beforeAll(async () => {
  if (!haveKit) return;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(KIT)));
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!name.startsWith('Kit_RockHang')) continue;
    const points: V3[] = [];
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
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
    shapes.set(name, { min, max, points });
  }
});

const hangs = planHeartHangs();

/** The walk a hung face hangs from: back from its brink toward the walk. */
function walkOf(p: (typeof hangs)[number]) {
  for (let back = HEART_ROCK_HANG.push + 0.3; back <= HEART_ROCK_HANG.push + 8; back += 0.4) {
    const s = authoredFieldSurfaceAt(F, p.x - Math.sin(p.rot) * back, p.z - Math.cos(p.rot) * back);
    if (s) return s;
  }
  return null;
}

describe('Smith Heart rock kit: the hung faces in the shipped GLB', () => {
  it('lists both hung faces once', () => {
    for (const piece of ['RockHangA', 'RockHangB'])
      expect(SMITH_HEART_ROCK_KIT_PIECES.filter((p) => p === piece)).toEqual([piece]);
  });

  it.skipIf(!haveKit)(
    'hangs each under its brink, battered out over the void, its measures the plan’s',
    () => {
      for (const name of ['Kit_RockHangA', 'Kit_RockHangB']) {
        const s = shapes.get(name);
        expect(s, name).toBeDefined();
        if (!s) continue;
        // Never proud of the walk it hangs from; down its whole drop.
        expect(s.max[1], name).toBeLessThan(-0.04);
        expect(s.min[1], name).toBeCloseTo(-HEART_ROCK_HANG.drop, 0);
        // Out over the void (glTF +Z is the front) as far as the plan allows.
        expect(s.max[2], name).toBeLessThanOrEqual(HEART_ROCK_HANG.out + 0.5);
        expect(s.max[2], name).toBeGreaterThan(HEART_ROCK_HANG.out * 0.75);
        expect(-s.min[2], name).toBeLessThanOrEqual(HEART_ROCK_HANG.depth + 0.5);
        expect(Math.max(-s.min[0], s.max[0]), name).toBeLessThanOrEqual(
          HEART_ROCK_HANG.reach + 0.3,
        );
        expect(Math.max(-s.min[0], s.max[0]), name).toBeGreaterThan(HEART_ROCK_HANG.reach - 1);
      }
    },
  );
});

describe('heart_rock_hang_core: the Breath’s high walks hung brink to mist', () => {
  it('hangs every high Breath walk seen from the Ring, and nothing else', () => {
    expect(hangs.length).toBeGreaterThan(15);
    const seen = new Set<string>();
    for (const p of hangs) {
      expect(p.piece).toMatch(/^Kit_RockHang[AB]$/);
      expect(p.cosmetic).toBe(false);
      const s = walkOf(p);
      expect(s, `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).not.toBeNull();
      expect(HEART_HANG_SURFACES.has(s?.id ?? ''), s?.id).toBe(true);
      seen.add(s?.id ?? '');
      expect(p.rise ?? 1).toBeGreaterThanOrEqual(HEART_ROCK_HANG.rise[0]);
      expect(p.rise ?? 1).toBeLessThanOrEqual(HEART_ROCK_HANG.rise[1]);
      expect(Math.abs(p.shear ?? 0)).toBeLessThanOrEqual(HEART_ROCK_HANG.maxShear);
    }
    // The Cornice's face, its climb and the landings under it all hung.
    for (const id of ['storm_cornice', 'cornice_climb', 'breath_chimney', 'breath_b1'])
      expect(seen.has(id), id).toBe(true);
    expect(hangs.filter((p) => walkOf(p)?.id === 'storm_cornice').length).toBeGreaterThan(8);
  });

  it('sets every brink under the walk it hangs from and reaches the mist', () => {
    for (const p of hangs) {
      const s = walkOf(p);
      if (!s) continue;
      const back = HEART_ROCK_HANG.push + 1;
      const floor = authoredFieldHeight(
        F,
        p.x - Math.sin(p.rot) * back,
        p.z - Math.cos(p.rot) * back,
      );
      expect(p.y, `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBeLessThan(floor + 0.01);
      const foot = p.y - HEART_ROCK_HANG.drop * (p.rise ?? 1);
      expect(foot, `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBeLessThan(
        Math.min(p.y - 50, F.voidHeight + HEART_ROCK_HANG.below + 1),
      );
    }
  });

  it('keeps out of the open air (the summit’s sky under the isles excepted)', () => {
    for (const p of hangs) {
      const nx = Math.sin(p.rot);
      const nz = Math.cos(p.rot);
      const mid = HEART_ROCK_HANG.push + HEART_ROCK_HANG.out * 0.5;
      expect(heartOpenAir(p.x + nx * mid, p.z + nz * mid, 0, false)).toBe(false);
    }
  });

  it.skipIf(!haveKit)('stands no vertex over a walked floor, nothing over its own walk', () => {
    const bad: string[] = [];
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const p of hangs) {
      heartKitPlacementMatrix(p, m);
      const pts = shapes.get(p.piece)?.points ?? [];
      expect(pts.length).toBeGreaterThan(100);
      for (let i = 0; i < pts.length; i += 3) {
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

  it('leaves out the lips and under-walls a hung face doubles, and only those', () => {
    const lips = planHeartLips();
    const kept = planHeartRockLips();
    expect(kept.length).toBeLessThan(lips.length);
    expect(kept.length).toBeGreaterThan(200);
    for (const lip of kept) expect(hangs.some((h) => heartHangCovers(h, lip))).toBe(false);
    const key = (p: { x: number; z: number; y: number }) => `${p.x},${p.y},${p.z}`;
    const keptKeys = new Set(kept.map(key));
    for (const lip of lips)
      if (!keptKeys.has(key(lip))) expect(hangs.some((h) => heartHangCovers(h, lip))).toBe(true);
    const under = planHeartUnderCliffs();
    const walls = planHeartRockUnder();
    expect(walls.length).toBeLessThan(under.length);
    for (const w of walls) expect(hangs.some((h) => heartHangHides(h, w))).toBe(false);
  });
});

describe('heart_walls_core: the gulf between the first landing and the Cornice', () => {
  it('is open air, and the mountain falls away there', () => {
    const G = HEART_BREATH_GULF;
    for (let t = 0; t <= 1; t += 0.25) {
      const x = G.ax + (G.bx - G.ax) * t;
      const z = G.az + (G.bz - G.az) * t;
      expect(heartOpenAir(x, z, 0)).toBe(true);
      expect(heartOpenAir(x, z, 0, false)).toBe(false);
      expect(heartMountainHeight(x, z)).toBe(HEART_MOUNTAIN_CHASM);
    }
    // Never over a walk: the landing and the Cornice stay floors.
    expect(authoredFieldSurfaceAt(F, G.ax, G.az)).toBeNull();
    expect(authoredFieldSurfaceAt(F, G.bx, G.bz)).toBeNull();
  });
});

describe('breath_rock_storm_core: the storm granite on the Breath’s rock', () => {
  it('holds over the Breath, never on the Ring, the Quench or the Heart', () => {
    expect(breathRockStormWeight(0, 195)).toBeGreaterThan(0.95);
    expect(breathRockStormWeight(-64, 112)).toBeGreaterThan(0.95);
    expect(breathRockStormWeight(0, 0)).toBe(0);
    expect(breathRockStormWeight(0, 60)).toBe(0);
    expect(breathRockStormWeight(200, 0)).toBe(0);
    expect(breathRockStormWeight(188, 172)).toBe(0);
  });

  it('rides the rock’s one program with its own bounds', () => {
    const glsl = breathRockStormGlsl();
    expect(glsl).toContain(BREATH_ROCK_STORM.z0.toFixed(2));
    expect(glsl).toContain(BREATH_ROCK_STORM.heart0.toFixed(2));
    expect(glsl).toContain('uHeartCore');
    const mat = new THREE.MeshStandardMaterial();
    applyRockCutaway(mat);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('bSlate');
    expect(mat.customProgramCacheKey()).toContain('storm3');
  });
});
