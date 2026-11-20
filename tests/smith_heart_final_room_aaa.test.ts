// The final room's AAA pass (design doc section 5.21, "The AAA pass"): the items that
// needed no Blender, each pinned where it could quietly come back:
//   - the crown's paint never reads a position through a face's normal (the starry sky),
//     only for a camera in the Heart, and the Quench's frost takes those walls otherwise;
//   - the Heart's light keeps the world's blue sky map to a trace (the cobalt shade);
//   - the well finds its wall exactly (the stepped mosaic);
//   - the column has no edge and thins at a body's height, on every tier;
//   - a sleeping crack is a cut in the stone with no outline, its waking look untouched;
//   - the Heat's falls are painted streams, not a flat sheet.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  HEART_CROWN,
  heartCrownCalmGlsl,
  heartCrownColorGlsl,
  heartCrownEmissiveGlsl,
} from '../src/render/smith_heart/heart_crown_core';
import { SMITH_HEART_CORE_LIGHT } from '../src/render/smith_heart/heart_environment';
import { heartFloorMaterial, setHeartFloorQuarter } from '../src/render/smith_heart/heart_floor';
import { heartFloorFragHead, heartFloorPaint } from '../src/render/smith_heart/heart_floor_glsl';
import { landmarkGlowFrag, wellFrag } from '../src/render/smith_heart/heart_landmarks_glsl';
import {
  HEART_RING_COLUMN,
  HEART_RING_LOOK,
  heartRingSheathRadius,
} from '../src/render/smith_heart/heart_quarters_core';
import {
  BLAZE_FRAG,
  BLAZE_VERT,
  quarterGlowFrag,
} from '../src/render/smith_heart/heart_quarters_glsl';
import { buildHeartRingColumn } from '../src/render/smith_heart/heart_ring_column';
import { applyRockCutaway, setHeartRockCore } from '../src/render/smith_heart/heart_rock_cutaway';
import { quenchFrostGlsl } from '../src/render/smith_heart/quench_frost_core';
import { HEART_ROOM, SMITH_HEART_VEINS } from '../src/sim/content/smith_heart_layout';

describe('the crown of rock', () => {
  it('reads no position through a face normal (a huge world coordinate turned that to dots)', () => {
    for (const glsl of [heartCrownColorGlsl(), heartCrownEmissiveGlsl()]) {
      expect(glsl).not.toMatch(/dot\(\s*vRockCutWorld/);
      // The paint's coordinates are the room's own: slot-relative, round its centre.
      expect(glsl).toMatch(/vRockCutWorld\.xz - uHeartSlot/);
    }
    // No thin line left for a coarse pixel to break up.
    expect(heartCrownEmissiveGlsl()).not.toMatch(/abs\(\s*cLine/);
  });

  it('paints only for a camera in the Heart, the frost taking those walls otherwise', () => {
    for (const glsl of [heartCrownColorGlsl(), heartCrownEmissiveGlsl(), heartCrownCalmGlsl()])
      expect(glsl).toMatch(/\* uHeartCore;/);
    // The frost's hole round the Heart opens only as the camera goes in.
    expect(quenchFrostGlsl()).toMatch(/mix\( 1\.0, smoothstep\([^;]*uHeartCore \)/);
    expect(HEART_CROWN.out1).toBeGreaterThan(HEART_ROOM.r);
  });

  it('hands the rock its area by a shared uniform the frame driver writes', () => {
    const mat = new THREE.MeshStandardMaterial();
    applyRockCutaway(mat);
    const shader = {
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n#include <color_fragment>\n#include <lights_physical_fragment>\n#include <emissivemap_fragment>',
      uniforms: {} as Record<string, THREE.IUniform>,
    };
    mat.onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader).toMatch(/uniform float uHeartCore/);
    // The fracture calmed before the lights.
    expect(shader.fragmentShader.indexOf('nonPerturbedNormal')).toBeLessThan(
      shader.fragmentShader.indexOf('#include <lights_physical_fragment>'),
    );
    setHeartRockCore(0.25);
    expect(shader.uniforms.uHeartCore.value).toBe(0.25);
    setHeartRockCore(0);
  });
});

describe("the Heart's light", () => {
  it('keeps the sky map to a trace and its fill a muted grey violet, never cobalt', () => {
    expect(SMITH_HEART_CORE_LIGHT.env).toBeLessThanOrEqual(0.05);
    const c = new THREE.Color(SMITH_HEART_CORE_LIGHT.hemiSky);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    expect(hsl.s).toBeLessThan(0.2);
    // Enough fill that a shaded face stays a value, never black.
    expect(SMITH_HEART_CORE_LIGHT.hemi).toBeGreaterThan(SMITH_HEART_CORE_LIGHT.sun);
  });
});

describe('the well floor', () => {
  const frag = wellFrag(13.4, HEART_RING_LOOK.depth, 85, -25, false);

  it('finds the wall exactly: a coarse walk, then the step halved', () => {
    expect(frag).toMatch(/wellOutside\(p \+ d \* \(z \/ dy\), z, R, COURSE\)/);
    expect(frag).toMatch(/0\.5 \* \(z0 \+ z1\)/);
    // The courses read the point it found, never a fixed walk's own step.
    expect(frag).toMatch(/float depthAt = z1;/);
    expect(frag).not.toMatch(/k <= 28/);
  });

  it('lifts in the final phase without burning its paint out', () => {
    const m = /col \*= 1\.0 \+ uBlaze \* \(([\d.]+) \+ ([\d.]+) \* sin/.exec(frag);
    expect(m).not.toBeNull();
    expect(Number(m?.[1]) + Number(m?.[2])).toBeLessThan(1);
  });
});

describe('the column of the final phase', () => {
  const at = new THREE.Vector3(HEART_ROOM.x, 0, HEART_ROOM.z);

  it('is no tube: flaring out of the well, drawn in to a waist, opening above it', () => {
    for (const s of HEART_RING_COLUMN.sheaths) {
      const foot = heartRingSheathRadius(s, 0);
      const waist = heartRingSheathRadius(s, HEART_RING_COLUMN.waist);
      const top = heartRingSheathRadius(s, 1);
      expect(foot).toBeCloseTo(s.foot, 6);
      expect(top).toBeCloseTo(s.top, 6);
      expect(waist).toBeCloseTo(s.mid, 6);
      expect(waist).toBeLessThan(foot / 2);
      expect(waist).toBeLessThan(top);
      // Continuous over its waist.
      const e = 1e-4;
      expect(
        Math.abs(
          heartRingSheathRadius(s, HEART_RING_COLUMN.waist + e) -
            heartRingSheathRadius(s, HEART_RING_COLUMN.waist - e),
        ),
      ).toBeLessThan(0.01);
    }
    const c = buildHeartRingColumn(false, at);
    const sheath = c.group.children.find((o) => o.name === 'heartRingColumn:2') as THREE.Mesh;
    sheath.geometry.computeBoundingBox();
    // Tall enough to be read over every head in the room.
    expect(sheath.geometry.boundingBox?.max.y).toBeGreaterThan(80);
  });

  it('has no edge and stays thin at the height of a body, on every tier', () => {
    for (const low of [false, true]) {
      const c = buildHeartRingColumn(low, at);
      const sheaths = c.materials.filter((m) => m.name.startsWith('smithHeartRingColumn:'));
      expect(sheaths.length).toBe(HEART_RING_COLUMN.sheaths.length);
      for (const m of sheaths) {
        // Its light gone at the silhouette (vRim 0), whole facing the eye.
        expect(m.fragmentShader).toMatch(/float soft = smoothstep\(0\.08, 0\.72, vRim\)/);
        expect(m.fragmentShader).toMatch(/a = uK \* fade \* soft \* over/);
        expect(m.fragmentShader).toMatch(/float over = mix\(0\.2, 1\.0, smoothstep\(/);
      }
    }
    expect(HEART_RING_COLUMN.clear[0]).toBeLessThan(HEART_RING_COLUMN.clear[1]);
  });

  it('draws its motes as thin slivers of the four veins, never round balls', () => {
    expect(BLAZE_VERT).toMatch(/aCorner \* vec2\(1\.0, [\d.]+\)/);
    for (const u of ['uV0', 'uV1', 'uV2', 'uV3']) expect(BLAZE_FRAG).toMatch(new RegExp(u));
  });
});

describe('a sleeping crack', () => {
  it('is a cut in the stone, the flood lighting it exactly as before', () => {
    for (const vein of SMITH_HEART_VEINS) {
      const frag = quarterGlowFrag(vein);
      expect(frag).toMatch(/mix\(asleep, awakeC, wake\)/);
      expect(frag).toMatch(/float wake = clamp\(max\(inside, edge\) \* 2\.0, 0\.0, 1\.0\)/);
      // A wall facing the painted light, the other in shadow, a dark throat.
      expect(frag).toMatch(/dFdx\(vShade\.r\)/);
      expect(frag).toMatch(/mix\(stone, throat/);
    }
  });

  it('loses its scar until the flood reaches it, on the floor the telegraphs draw over', () => {
    for (const low of [false, true]) {
      expect(heartFloorPaint(low)).toMatch(/if \(sInside < 0\.5\)/);
      expect(heartFloorPaint(low)).toMatch(/discard/);
      expect(heartFloorFragHead(low)).toMatch(/uniform vec4 uHfAwake/);
    }
    // The scar's height is the kit's own (quarter_pieces.py: SKIN less a hair).
    const py = readFileSync('docs/design/raid/kit/quarter_pieces.py', 'utf8');
    const skin = Number(/^SKIN = ([\d.]+)/m.exec(py)?.[1]);
    expect(py).toMatch(/SKIN - 0\.006, 1\.0, slot=0/);
    expect(heartFloorPaint(false)).toContain(`abs(vHfP.y - ${(skin - 0.006).toFixed(3)})`);
    expect(heartFloorMaterial(false).transparent).toBe(false);
  });

  it('reads each quarter from one shared pair the frame writes', () => {
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    };
    heartFloorMaterial(false).onBeforeCompile(shader as never, {} as never);
    setHeartFloorQuarter(2, 1, 30);
    expect((shader.uniforms.uHfAwake.value as THREE.Vector4).z).toBe(1);
    expect((shader.uniforms.uHfFront.value as THREE.Vector4).z).toBe(30);
    setHeartFloorQuarter(2, 0, 0);
  });
});

describe("the Heat's falls of lava", () => {
  it('paints its falls in streams breaking up as they drop, only the Heat', () => {
    const heat = landmarkGlowFrag('heat');
    expect(heat).toMatch(/if \(vP\.y < -0\.25\)/);
    expect(heat).toMatch(/if \(body < 0\.2 \+ 0\.5 \* drop\) discard/);
    for (const vein of ['hammer', 'quench', 'breath'])
      expect(landmarkGlowFrag(vein)).not.toMatch(/vP\.y < -0\.25/);
  });
});
