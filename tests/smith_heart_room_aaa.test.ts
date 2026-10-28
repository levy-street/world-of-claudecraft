// The Heart's room raised to its finish (phase 2N, design doc section 5.21):
//   - the floor painted on its sheet (heart_floor_glsl.ts, heart_floor.ts):
//     larger slabs than 2M's, joints thin and inconsistent (some fading
//     away, some deep cracks), worn paths; room-local (never a world point),
//     only on the flat sheet; the standard tier rakes its arrises, the low
//     tier sheds the fine strokes, the Lambert tier keeps the slabs;
//   - each quarter's wash carries its element's own life round the rim;
//   - the well marched down a funnel of rock, its mist in layers lit from
//     below, its depth deeper than 2M's;
//   - the column of the final phase layered (three sheaths turning their
//     own ways, shards riding it up), hidden while the ring rests, a share
//     of the shards on the low tier;
//   - the abyss's glow under the lip and the haze before the crown, dark
//     with the heart;
//   - the landmarks' runs and the Breath's horns the same numbers as their
//     Blender pieces (landmark_pieces.py); the core's shafts in the gaps
//     the landmarks leave, never through one.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { heartFloorMaterial } from '../src/render/smith_heart/heart_floor';
import {
  HEART_FLOOR_LOOK,
  heartFloorFragHead,
  heartFloorPaint,
} from '../src/render/smith_heart/heart_floor_glsl';
import {
  HEART_LANDMARK_FRAME,
  HEART_LANDMARK_SPAN,
  heartBreathHornTips,
} from '../src/render/smith_heart/heart_landmarks_core';
import { wellFrag } from '../src/render/smith_heart/heart_landmarks_glsl';
import { HEART_RING_LOOK } from '../src/render/smith_heart/heart_quarters_core';
import { washFrag } from '../src/render/smith_heart/heart_quarters_glsl';
import {
  buildHeartRingColumn,
  HEART_RING_COLUMN,
} from '../src/render/smith_heart/heart_ring_column';
import { HEART_CORE_SHAFTS } from '../src/render/smith_heart/heart_room_core';
import { buildHeartSurround } from '../src/render/smith_heart/heart_surround';
import { HEART_ROOM, SMITH_HEART_VEINS } from '../src/sim/content/smith_heart_layout';

const KIT = 'docs/design/raid/kit';

/** Run a material's onBeforeCompile over three's real chunk tokens. */
function compiled(m: THREE.Material): { vertex: string; fragment: string } {
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>',
    fragmentShader:
      '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>',
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return { vertex: shader.vertexShader, fragment: shader.fragmentShader };
}

describe('the floor painted on its sheet', () => {
  it('lays fewer, larger slabs than 2M, their joints thin and broken', () => {
    // 2M laid its Voronoi stones about 6.4 yd apart.
    expect(HEART_FLOOR_LOOK.slab).toBeGreaterThan(6.4 * 1.2);
    expect(HEART_FLOOR_LOOK.joint[1]).toBeLessThan(0.1);
    expect(HEART_FLOOR_LOOK.joint[0]).toBeLessThan(HEART_FLOOR_LOOK.joint[1]);
    // Some joints fade away, a few are deep cracks, the rest broken along
    // their run; patches and broken slabs, worn paths.
    expect(HEART_FLOOR_LOOK.vanish).toBeGreaterThan(0.15);
    expect(HEART_FLOOR_LOOK.deep).toBeGreaterThan(0.05);
    expect(HEART_FLOOR_LOOK.deep).toBeLessThan(0.2);
    const paint = heartFloorPaint(false);
    for (const word of ['wear', 'chip', 'soot', 'dust', 'mend', 'brk', 'hair', 'fwidth'])
      expect(paint, word).toMatch(new RegExp(word));
    // The sheet's height is the kit's (quarter_pieces.py SHEET_Z).
    const py = readFileSync(`${KIT}/quarter_pieces.py`, 'utf8');
    expect(Number(/^SHEET_Z = ([\d.]+)/m.exec(py)?.[1])).toBe(HEART_FLOOR_LOOK.sheetY);
  });

  it('paints room-local, only the flat sheet, never a world point', () => {
    const paint = heartFloorPaint(false);
    expect(paint).toMatch(/vHfP\.xz/);
    expect(paint).toMatch(/vHfUp/);
    expect(paint).not.toMatch(/modelMatrix|viewMatrix/);
    const { vertex } = compiled(heartFloorMaterial(false));
    expect(vertex).toMatch(/vHfP = position;/);
    expect(vertex).not.toMatch(/modelMatrix/);
  });

  it('rakes the arris on the lit tier, sheds the strokes on the low tier', () => {
    const full = compiled(heartFloorMaterial(false)).fragment;
    expect(full).toMatch(/hfTilt/);
    expect(full).toMatch(/normal = normalize\(normal \+ hfN/);
    expect(full).toMatch(/roughnessFactor = clamp\(roughnessFactor - 0\.16 \* hfWear/);
    expect(heartFloorPaint(false)).toMatch(/float stroke/);
    expect(heartFloorPaint(true)).not.toMatch(/float stroke/);
    expect(heartFloorPaint(true)).toMatch(/joint/);
    expect(heartFloorFragHead(true).length).toBeLessThan(heartFloorFragHead(false).length);
    // One program per tier, shared by the four quarters.
    expect(heartFloorMaterial(false)).toBe(heartFloorMaterial(false));
    expect(heartFloorMaterial(true)).not.toBe(heartFloorMaterial(false));
    // Opaque and depth-writing: every telegraph draws over it as over stone.
    expect(heartFloorMaterial(false).transparent).toBe(false);
    expect(heartFloorMaterial(false).depthWrite).toBe(true);
  });
});

describe('the rim, the well and the crackle', () => {
  it("gives each quarter's wash its own element's life round the rim", () => {
    const srcs = SMITH_HEART_VEINS.map((v) => washFrag(v));
    expect(new Set(srcs).size).toBe(4);
    for (const s of srcs) {
      expect(s).toMatch(/float life/);
      expect(s).toMatch(/band/);
    }
    expect(washFrag('breath')).toMatch(/flash/);
    expect(washFrag('quench')).toMatch(/glint/);
    expect(washFrag('hammer')).toMatch(/tremor|tp/);
    expect(washFrag('heat')).toMatch(/molten/);
  });

  it('marches the well down a funnel, deeper than 2M, its mist in layers', () => {
    expect(HEART_RING_LOOK.depth).toBeGreaterThan(3.2 * 2);
    const hi = wellFrag(13.4, HEART_RING_LOOK.depth, 85, -25, false);
    const lo = wellFrag(13.4, HEART_RING_LOOK.depth, 85, -25, true);
    expect(hi).toMatch(/course/);
    expect(hi).toMatch(/k < 6/);
    expect(lo).toMatch(/k < 4/);
    expect(hi).toMatch(/pulseUp/);
  });
});

describe('the column of the final phase', () => {
  const at = new THREE.Vector3(HEART_ROOM.x, 0, HEART_ROOM.z);

  it('layers three sheaths turning their own ways, shards riding them up', () => {
    expect(HEART_RING_COLUMN.sheaths.length).toBe(3);
    const spins = HEART_RING_COLUMN.sheaths.map((s) => Math.sign(s.spin));
    expect(new Set(spins).size).toBe(2);
    const c = buildHeartRingColumn(false, at);
    for (const m of c.materials) {
      expect(m.blending, m.name).toBe(THREE.AdditiveBlending);
      expect(m.depthWrite, m.name).toBe(false);
      expect(m.vertexShader, m.name).toMatch(/modelViewMatrix/);
      expect(m.vertexShader, m.name).not.toMatch(/viewMatrix\s*\*\s*(modelMatrix|vec4)/);
    }
    // Never a flat cylinder: each sheath narrows as it rises.
    for (const s of HEART_RING_COLUMN.sheaths) expect(s.top).toBeLessThan(s.foot);
  });

  it('hides while the ring rests and blazes with it, dark with the heart', () => {
    const c = buildHeartRingColumn(false, at);
    const sheaths = c.group.children.filter((o) => o.name.startsWith('heartRingColumn:'));
    expect(sheaths.length).toBe(3);
    c.set(0, 0);
    for (const s of sheaths) expect(s.visible).toBe(false);
    c.set(1, 0);
    for (const s of sheaths) expect(s.visible).toBe(true);
    for (const m of c.materials) expect(m.uniforms.uK.value).toBeGreaterThan(0);
    c.set(1, 1);
    for (const m of c.materials) expect(m.uniforms.uK.value).toBe(0);
  });

  it('keeps a share of the shards on the low tier', () => {
    const count = (lo: boolean) => {
      let n = 0;
      buildHeartRingColumn(lo, at).group.traverse((o) => {
        if (o.name === 'heartRingShards') n = ((o as THREE.Mesh).geometry.index?.count ?? 0) / 6;
      });
      return n;
    };
    expect(count(false)).toBe(HEART_RING_COLUMN.shards);
    expect(count(true)).toBeGreaterThan(0);
    expect(count(true)).toBeLessThan(count(false));
  });
});

describe('the room drawn in round the platform', () => {
  it('hangs the abyss glow under the lip and the haze before the crown, dark with the heart', () => {
    const s = buildHeartSurround(new THREE.Vector3(HEART_ROOM.x, 0, HEART_ROOM.z));
    const names = s.materials.map((m) => m.name).sort();
    expect(names).toEqual(['smithHeartAbyssPool', 'smithHeartAbyssSkirt', 'smithHeartHaze']);
    for (const m of s.materials) {
      expect(m.depthWrite, m.name).toBe(false);
      expect(m.vertexShader, m.name).toMatch(/modelViewMatrix/);
    }
    s.set(1, 0, 0);
    const skirt = s.materials.find((m) => m.name === 'smithHeartAbyssSkirt');
    const lit = skirt?.uniforms.uK.value as number;
    expect(lit).toBeGreaterThan(0);
    s.set(1, 1, 0);
    expect(skirt?.uniforms.uK.value).toBeGreaterThan(lit);
    s.set(1, 1, 1);
    expect(skirt?.uniforms.uK.value).toBe(0);
  });

  it("stands the core's shafts in the gaps between the landmarks, never through one", () => {
    expect(HEART_CORE_SHAFTS.length).toBeGreaterThan(2);
    for (const sh of HEART_CORE_SHAFTS) {
      const b = (Math.atan2(sh.x - HEART_ROOM.x, sh.z - HEART_ROOM.z) * 180) / Math.PI;
      for (const v of SMITH_HEART_VEINS) {
        const [d0, d1] = HEART_LANDMARK_SPAN[v];
        const off = ((((b - HEART_LANDMARK_FRAME.bearing[v]) % 360) + 540) % 360) - 180;
        // Clear of the run by its own radius at its distance.
        const pad =
          (Math.atan2(sh.r + 1, Math.hypot(sh.x - HEART_ROOM.x, sh.z - HEART_ROOM.z)) * 180) /
          Math.PI;
        expect(off > d1 + pad || off < d0 - pad, `${v} ${b.toFixed(1)}`).toBe(true);
      }
    }
  });
});

describe('the landmarks: the runtime and the Blender pieces agree', () => {
  const py = readFileSync(`${KIT}/landmark_pieces.py`, 'utf8');

  it('runs each landmark along the same arc of the rim', () => {
    const block = py.slice(py.indexOf('SPAN = {'), py.indexOf('}', py.indexOf('SPAN = {')));
    for (const v of SMITH_HEART_VEINS) {
      const m = new RegExp(`'${v}': \\((-?[\\d.]+), (-?[\\d.]+)\\)`).exec(block);
      expect(m, v).not.toBeNull();
      expect([Number(m?.[1]), Number(m?.[2])], v).toEqual([...HEART_LANDMARK_SPAN[v]]);
    }
  });

  it("raises the Breath's horns where the lightning leaves them", () => {
    const block = py.slice(
      py.indexOf('BREATH_HORNS = ('),
      py.indexOf('\n)\n', py.indexOf('BREATH_HORNS = (')),
    );
    const horns = [
      ...block.matchAll(/\((-?[\d.]+), (-?[\d.]+), ([\d.]+), [\d.]+, \((-?[\d.]+), (-?[\d.]+)\)/g),
    ].map((m) => m.slice(1, 6).map(Number));
    const tips = heartBreathHornTips();
    expect(horns.length).toBe(tips.length);
    const a = (HEART_LANDMARK_FRAME.bearing.breath * Math.PI) / 180;
    horns.forEach(([u, v, h, cu, cv], j) => {
      const tu = u + cu * h;
      const tv = v + cv * h + Math.sin(3 + j) * 0.5;
      expect(tips[j].x, `horn ${j}`).toBeCloseTo(Math.sin(a) * tu + Math.cos(a) * tv, 6);
      expect(tips[j].z, `horn ${j}`).toBeCloseTo(Math.cos(a) * tu - Math.sin(a) * tv, 6);
      expect(tips[j].y, `horn ${j}`).toBeCloseTo(-3 + h + 0.6, 6);
    });
  });
});
