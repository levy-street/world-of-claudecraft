// The Heat vein's painted rebuild (design doc section 5.25): the shipped kit and its frames,
// what stands in for what (the look only: every placement, walk and lip stays, the fight's
// wellspring, the pour and the bridge untouched), the rock it takes (by the faced surface's
// id, never by area), the molten fall in its host band's own volume, the ring of stacks in
// the sightline plan, the paint's share, the warm glow layer and the sky. Every plan rule
// here is against the same layout the sim reads.

import { existsSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { breathEnvOwnsRock } from '../src/render/smith_heart/breath_env_plan_core';
import { applyEnvLook, envLookKey } from '../src/render/smith_heart/env_kit_look';
import {
  hammerEnvFrontClear,
  hammerEnvOwnsRock,
} from '../src/render/smith_heart/hammer_env_plan_core';
import { HEAT_BRIDGE_CHASM } from '../src/render/smith_heart/heart_plan_core';
import { heartRockHeatGlsl } from '../src/render/smith_heart/heart_rock_cutaway';
import { planHeartGulfWalls } from '../src/render/smith_heart/heart_rock_gulf_core';
import {
  planHeartRockLips,
  planHeartRockUnder,
} from '../src/render/smith_heart/heart_rock_hang_core';
import { heartRockPieceOf, planHeartRock } from '../src/render/smith_heart/heart_rock_plan_core';
import { heatEnvSolids } from '../src/render/smith_heart/heart_sightline_core';
import { buildHeartSky } from '../src/render/smith_heart/heart_sky';
import { heartFloorClearance, heartOpenAir } from '../src/render/smith_heart/heart_walls_core';
import {
  fitHeatEnvRock,
  HEAT_ENV_CRYSTAL_HEIGHT,
  HEAT_ENV_DROPS,
  HEAT_ENV_FALL,
  HEAT_ENV_FALL_PIECE,
  HEAT_ENV_KEEPS,
  HEAT_ENV_MIN_WEIGHT,
  HEAT_ENV_RING,
  HEAT_ENV_ROCK,
  HEAT_OLD_CRYSTALS,
  heatEnvFallHost,
  heatEnvOwnsRock,
  heatEnvRockGlsl,
  heatEnvRockPiece,
  heatEnvSwap,
  heatEnvTakesRockPiece,
  heatEnvWeight,
  heatEnvWeightGlsl,
  isHeatEnvFallHost,
  planHeatEnvRing,
} from '../src/render/smith_heart/heat_env_plan_core';
import {
  HEAT_HEARTH_FACE,
  HEAT_PILLAR,
  HEAT_WALK_SURFACES,
  HEAT_WALL,
  planHeatKit,
} from '../src/render/smith_heart/heat_kit_plan_core';
import { heatSootWeight } from '../src/render/smith_heart/heat_soot_core';
import { quenchEnvOwnsRock } from '../src/render/smith_heart/quench_env_plan_core';
import { HEAT, POUR_CHANNEL, SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const KIT = 'public/models/props/smith_heart_heat_env_kit.glb';
const OLD_KIT = 'public/models/props/smith_heart_heat_kit.glb';
const F = SMITH_HEART_FIELD;

interface Shape {
  min: number[];
  max: number[];
  points: number[][];
  tris: number;
}

async function readShapes(file: string, top: RegExp): Promise<Map<string, Shape>> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
  const out = new Map<string, Shape>();
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!top.test(name) || top.test(node.getParentNode()?.getName() ?? '')) continue;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const points: number[][] = [];
    let tris = 0;
    const visit = (n: typeof node): void => {
      const m = n.getWorldMatrix();
      for (const prim of n.getMesh()?.listPrimitives() ?? []) {
        const a = prim.getAttribute('POSITION');
        if (!a) continue;
        tris += (prim.getIndices()?.getCount() ?? a.getCount()) / 3;
        const e: number[] = [];
        for (let i = 0; i < a.getCount(); i++) {
          a.getElement(i, e);
          const w = [
            m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
            m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
            m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
          ];
          points.push(w);
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], w[k]);
            max[k] = Math.max(max[k], w[k]);
          }
        }
      }
      for (const c of n.listChildren()) visit(c);
    };
    visit(node);
    out.set(name, { min, max, points, tris });
  }
  return out;
}

let shapes = new Map<string, Shape>();
let old = new Map<string, Shape>();
const mimes = new Set<string>();

beforeAll(async () => {
  shapes = await readShapes(KIT, /^(Env|Tex)_/);
  old = await readShapes(OLD_KIT, /^Kit_/);
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(KIT)));
  for (const t of doc.getRoot().listTextures()) mimes.add(t.getMimeType());
});

const shape = (m: Map<string, Shape>, name: string): Shape => {
  const s = m.get(name);
  if (!s) throw new Error(`no ${name}`);
  return s;
};
const reachOf = (s: Shape, above = -Infinity) =>
  Math.max(...s.points.filter((p) => p[1] >= above).map((p) => Math.hypot(p[0], p[2])));

// The bands the rock painter swaps (heart_rock.ts).
const bands = [...planHeartRock(), ...planHeartRockUnder(), ...planHeartGulfWalls()];
const owned = bands.filter((p) => heatEnvTakesRockPiece(p.piece) && heatEnvOwnsRock(p));

/** The surface a rock placement faces (heat_env_plan_core.ts's own step). */
function faced(p: { x: number; z: number }): string | null {
  const c = heartFloorClearance(p.x, p.z);
  if (!Number.isFinite(c.d)) return null;
  const r = c.d + 4;
  return authoredFieldSurfaceAt(F, p.x + c.toX * r, p.z + c.toZ * r)?.id ?? null;
}

describe('the Heat painted kit as shipped', () => {
  it('ships in KTX2, under 6 MB', () => {
    expect(existsSync(KIT)).toBe(true);
    expect([...mimes]).toEqual(['image/ktx2']);
    expect(readFileSync(KIT).length).toBeLessThan(6 * 1024 * 1024);
  });

  it('holds every piece the plans place and the paintings the runtime reads', () => {
    const placed = new Set(
      [...owned.map(fitHeatEnvRock), ...heatEnvSwap(planHeatKit()).swap, ...planHeatEnvRing()].map(
        (p) => p.piece,
      ),
    );
    expect(placed.size).toBeGreaterThanOrEqual(10);
    for (const piece of placed) expect(shapes.has(piece), piece).toBe(true);
    for (const tex of ['Tex_Floor', 'Tex_FloorN', 'Tex_Cliff', 'Tex_Block', 'Tex_Sky'])
      expect(shapes.has(tex), tex).toBe(true);
  });

  it('measures its rock as the plan fits it: foot on y 0, front on z 0, body behind', () => {
    for (const [name, m] of [
      ...Object.entries(HEAT_ENV_ROCK),
      ['Env_MoltenFall', HEAT_ENV_FALL_PIECE] as const,
    ]) {
      const s = shape(shapes, name);
      expect(s.max[0] - s.min[0], name).toBeCloseTo(m.w, 0);
      expect(s.max[1] - s.min[1], name).toBeCloseTo(m.h, 0);
      expect(s.max[2] - s.min[2], name).toBeCloseTo(m.d, 0);
      expect(s.min[1], name).toBeCloseTo(0, 1);
      expect(s.max[2], name).toBeLessThan(0.1);
    }
    const c = shape(shapes, 'Env_FireCrystal');
    expect(c.max[1] - c.min[1]).toBeCloseTo(HEAT_ENV_CRYSTAL_HEIGHT, 1);
  });

  it('stands each prop inside the old piece it replaces', () => {
    // The altar-stone and the ember boulders in the old pieces' boxes.
    for (const [now, was] of [
      ['Env_AltarStone', 'Kit_AltarStone'],
      ['Env_EmberBoulder', 'Kit_EmberBoulder'],
    ]) {
      const a = shape(shapes, now);
      const b = shape(old, was);
      for (const k of [0, 2]) {
        expect(a.min[k], `${now} ${k}`).toBeGreaterThanOrEqual(b.min[k] - 0.1);
        expect(a.max[k], `${now} ${k}`).toBeLessThanOrEqual(b.max[k] + 0.1);
      }
    }
    // The crystal inside the old crystal's round reach (a placement turns it any way).
    expect(reachOf(shape(shapes, 'Env_FireCrystal'))).toBeLessThanOrEqual(2.9);
    // The column bundle inside the pillar's reach over the floor, down into the chasm.
    const b = shape(shapes, 'Env_ColumnBundle');
    expect(reachOf(b, -0.5)).toBeLessThanOrEqual(HEAT_PILLAR.r);
    expect(b.min[1]).toBeLessThanOrEqual(-39);
    expect(b.max[1]).toBeCloseTo(14.6, 0);
  });

  it('sets the Hearth mouth in the old frame: its front at the face, its foot deep in the mountain', () => {
    const m = shape(shapes, 'Env_HearthMouth');
    expect(m.max[2]).toBeLessThanOrEqual(HEAT_HEARTH_FACE);
    expect(m.min[1]).toBeLessThanOrEqual(-32);
    expect(m.max[0] - m.min[0]).toBeCloseTo(74, 0);
  });

  it('keeps the walls in the old modules frame', () => {
    for (const w of ['Env_HeatWallA', 'Env_HeatWallB']) {
      const s = shape(shapes, w);
      expect(s.max[0] - s.min[0], w).toBeLessThanOrEqual(HEAT_WALL.half * 2 + 0.2);
      expect(s.max[1], w).toBeLessThanOrEqual(HEAT_WALL.height);
      // Nothing over the walk (local -z toward the walk past a hand).
      expect(s.min[2], w).toBeGreaterThanOrEqual(-HEAT_WALL.near);
    }
  });
});

describe('the look only: every placement stays, the fight untouched', () => {
  const plan = planHeatKit();
  const { keep, swap } = heatEnvSwap(plan);

  it('stands every swapped piece on its old placement, and drops only the ash drifts', () => {
    const dropped = plan.filter((p) => HEAT_ENV_DROPS.has(p.piece));
    expect(dropped.length).toBeGreaterThan(0);
    expect(keep.length + swap.length + dropped.length).toBe(plan.length);
    const was = plan.filter((p) => !HEAT_ENV_DROPS.has(p.piece) && !keep.includes(p));
    expect(was.length).toBe(swap.length);
    swap.forEach((p, i) => {
      expect(p.x).toBe(was[i].x);
      expect(p.y).toBe(was[i].y);
      expect(p.z).toBe(was[i].z);
      expect(p.rot).toBe(was[i].rot);
    });
  });

  it('never touches the wellspring, the pour, the bridge or the seams of fire', () => {
    for (const p of plan.filter((q) => HEAT_ENV_KEEPS.has(q.piece))) expect(keep).toContain(p);
    expect(swap.some((p) => p.piece.startsWith('Kit_'))).toBe(false);
  });

  it('stands each crystal as tall as the old one', () => {
    for (const p of plan) {
      const h = HEAT_OLD_CRYSTALS[p.piece];
      if (!h) continue;
      const s = swap.find((q) => q.x === p.x && q.z === p.z);
      expect(s?.piece).toBe('Env_FireCrystal');
      expect((s?.scale ?? 1) * HEAT_ENV_CRYSTAL_HEIGHT).toBeCloseTo((p.scale ?? 1) * h, 5);
    }
  });

  it('keeps a swap whose piece did not bake on the old kit', () => {
    const none = heatEnvSwap(plan, () => false);
    expect(none.swap).toEqual([]);
    expect(none.keep.length).toBe(plan.filter((p) => !HEAT_ENV_DROPS.has(p.piece)).length);
  });

  it('measures the old crystals as the old kit shipped them', () => {
    for (const [name, h] of Object.entries(HEAT_OLD_CRYSTALS)) {
      const s = shape(old, name);
      expect(s.max[1] - s.min[1], name).toBeCloseTo(h, 1);
    }
  });
});

describe('the basalt round the hall', () => {
  it('takes only bands facing a Heat walk where the basalt holds, never another vein', () => {
    expect(owned.length).toBeGreaterThan(40);
    for (const p of owned) {
      const id = faced(p);
      expect(id !== null && HEAT_WALK_SURFACES.has(id), `${p.x},${p.z} faces ${id}`).toBe(true);
      expect(heatSootWeight(p.x, p.z)).toBeGreaterThanOrEqual(HEAT_ENV_MIN_WEIGHT);
      expect(hammerEnvOwnsRock(p) || breathEnvOwnsRock(p) || quenchEnvOwnsRock(p)).toBe(false);
    }
  });

  it('refuses a band in the Heat that faces another walk (the area rule took those)', () => {
    // Bands west of the Ring's mouth whose nearest walk is the Ring's, not the Heat's.
    const foreign = bands.filter((p) => {
      if (!heatEnvTakesRockPiece(p.piece) || p.x > -76) return false;
      const id = faced(p);
      return id !== null && !HEAT_WALK_SURFACES.has(id);
    });
    expect(foreign.length).toBeGreaterThan(0);
    for (const p of foreign) expect(heatEnvOwnsRock(p)).toBe(false);
  });

  it('leaves the lips and the hung faces to the rock kit', () => {
    for (const p of planHeartRockLips())
      expect(heatEnvTakesRockPiece(p.piece), p.piece).toBe(false);
  });

  it('never stands a front on a walk where the old one stood clear, and keeps each spot and foot', () => {
    const bad: string[] = [];
    for (const p of owned) {
      const f = fitHeatEnvRock(p);
      expect([f.x, f.y, f.z]).toEqual([p.x, p.y, p.z]);
      const m = f.piece.startsWith('Env_MoltenFall')
        ? HEAT_ENV_FALL_PIECE
        : HEAT_ENV_ROCK[f.piece.replace(/Far$/, '')];
      const k = f.scale ?? 1;
      const s = heartRockPieceOf(p.piece);
      // As tall and as deep as the old band.
      expect(m.h * k * (f.rise ?? 1)).toBeCloseTo(s.height * (p.scale ?? 1) * (p.rise ?? 1), 3);
      expect(m.d * k).toBeCloseTo(s.depth * (p.scale ?? 1), 3);
      const half = (m.w * k * (f.stretch ?? 1)) / 2;
      const oldClear = hammerEnvFrontClear(p.x, p.z, p.rot, s.half * (p.scale ?? 1));
      if (oldClear && !hammerEnvFrontClear(f.x, f.z, f.rot, half))
        bad.push(`${p.piece} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
    expect(bad).toEqual([]);
  });

  it('pours the molten fall in its host band at the chasm north head, out of the guardian backdrop', () => {
    const host = heatEnvFallHost();
    expect(host).not.toBeNull();
    if (!host) return;
    const p = owned.find((q) => isHeatEnvFallHost(q));
    expect(p).toBeDefined();
    if (!p) return;
    expect(heatEnvRockPiece(p).replace(/Far$/, '')).toBe('Env_MoltenFall');
    expect(owned.filter((q) => isHeatEnvFallHost(q)).length).toBe(1);
    // On the first band, crest well over the floor, far from the pour's fall.
    const c = heartFloorClearance(p.x, p.z);
    expect(c.d).toBeLessThanOrEqual(HEAT_ENV_FALL.maxBack);
    const m = heartRockPieceOf(p.piece);
    expect(p.y + m.height * (p.scale ?? 1) * (p.rise ?? 1)).toBeGreaterThanOrEqual(
      c.floor + HEAT_ENV_FALL.crest,
    );
    expect(Math.hypot(p.x - POUR_CHANNEL.x, p.z - POUR_CHANNEL.z0)).toBeGreaterThanOrEqual(
      HEAT_ENV_FALL.spill,
    );
    // North of the chasm the bridge crosses, never behind the guardian from the way in.
    expect(host.z).toBeGreaterThan(HEAT_BRIDGE_CHASM.z + 20);
    const fromEntry = Math.atan2(host.z - 0, -(host.x - -174));
    expect(Math.abs((fromEntry * 180) / Math.PI)).toBeGreaterThan(40);
  });

  it('rings the hall with stacks on the mountain, clear of every walk, the way in open', () => {
    const ring = planHeatEnvRing();
    expect(ring.length).toBeGreaterThanOrEqual(10);
    const m = HEAT_ENV_ROCK[HEAT_ENV_RING.piece];
    for (const p of ring) {
      const bearing = (Math.atan2(p.x - HEAT_ENV_RING.x, p.z - HEAT_ENV_RING.z) * 180) / Math.PI;
      expect(Math.abs(bearing - 90)).toBeGreaterThanOrEqual(HEAT_ENV_RING.eastDeg);
      const k = p.scale ?? 1;
      expect(hammerEnvFrontClear(p.x, p.z, p.rot, (m.w * k) / 2)).toBe(true);
      expect(heartOpenAir(p.x, p.z, 0)).toBe(false);
      expect(p.y).toBeLessThanOrEqual(HEAT.floor.h);
    }
    // Every stack in the sightline plan.
    expect(heatEnvSolids().length).toBe(ring.length);
  });
});

describe('the basalt cliff painting on the rock it keeps', () => {
  it('paints exactly where the basalt soot held', () => {
    for (const [x, z] of [
      [-214, 0],
      [-150, 30],
      [-90, 0],
      [0, 0],
      [-214, -120],
      [200, 0],
    ])
      expect(heatEnvWeight(x, z)).toBe(heatSootWeight(x, z));
    expect(heatEnvWeight(-214, 0)).toBe(1);
    expect(heatEnvWeight(200, 0)).toBe(0);
  });

  it('writes its GLSL under its own names, its reads with explicit gradients', () => {
    const w = heatEnvWeightGlsl();
    expect(w).toContain('float heatEnvWeight( vec2 p )');
    const r = heatEnvRockGlsl();
    expect(r).toContain('vec3 heatEnvRock(');
    expect(r).toContain('textureGrad');
    expect(r).not.toMatch(/texture2D\(/);
    const cut = heartRockHeatGlsl();
    expect(cut).toContain('uHeatPainted');
    expect(cut).toContain('heatEnvRock( uHeatPaint');
  });
});

describe('the warm glow layer', () => {
  const base = { cutaway: false, strokes: null, shade: ['0.1', '0.1', '0.1'] as const };

  it('keeps every other kit key byte for byte and keys the gold apart', () => {
    expect(envLookKey({ ...base, crystal: 2, crystalHue: 'cyan' })).toBe(
      'smith-heart-env-stone|0.1,0.1,0.1||crystal:2:cyan',
    );
    expect(envLookKey({ ...base, crystal: 2 })).toBe(
      'smith-heart-env-stone|0.1,0.1,0.1||crystal:2',
    );
    expect(envLookKey({ ...base, crystal: 2, crystalHue: 'gold' })).toBe(
      'smith-heart-env-stone|0.1,0.1,0.1||crystal:2:gold',
    );
  });

  it('lights the red-past-blue fire, never the grey basalt', () => {
    const m = new THREE.MeshStandardMaterial();
    applyEnvLook(m, { ...base, crystal: 1.4, crystalHue: 'gold' });
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <emissivemap_fragment>',
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('diffuseColor.r - diffuseColor.b');
    expect(shader.fragmentShader).toContain('1.40');
  });
});

describe('the smoky dusk over the Heat', () => {
  it('wraps the painting on the dome only once its kit has landed', () => {
    const plain = buildHeartSky({ lowGfx: false, onFrame: () => undefined });
    const material = plain.mesh.material as THREE.ShaderMaterial;
    expect(material.uniforms.uHeatPainted.value).toBe(0);
    const tex = new THREE.Texture();
    const painted = buildHeartSky({ lowGfx: false, heatSky: tex, onFrame: () => undefined });
    const pm = painted.mesh.material as THREE.ShaderMaterial;
    expect(pm.uniforms.uHeatPainted.value).toBe(1);
    expect(pm.uniforms.uHeatSky.value).toBe(tex);
    expect(pm.fragmentShader).toContain('heatPaintedSky');
    expect(pm.fragmentShader).toContain('textureLod(uHeatSky');
  });
});
