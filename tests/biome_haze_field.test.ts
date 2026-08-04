// The Three half of the biome haze field. Three things matter here and none
// of them need a GPU:
//   1. the shader anchors this splices against still exist in the pinned three
//      release, and sit in the order the effect assumes (declarations at
//      <common>, the blend immediately before <fog_fragment>, which three
//      places AFTER <colorspace_fragment> so the haze lands in the same colour
//      space the scene fog does);
//   2. the GLSL ramp is the SAME curve the Node-tested aerialHazeAmount is, so
//      what a test pins is what a fragment runs;
//   3. the uniforms are shared BY REFERENCE, which is what makes the near
//      terrain and the far vista tiles agree at the detail-horizon handoff
//      instead of drawing a ring there.

import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BIOME_HAZE_DECLARATIONS,
  biomeHazeFieldLayout,
  biomeHazeFragmentGlsl,
  biomeHazeUniforms,
  disposeBiomeHazeField,
  ensureBiomeHazeField,
  hasBiomeHazeField,
  setBiomeHazeCamera,
  setBiomeHazeGrade,
} from '../src/render/biome_haze_field';
import {
  aerialHazeAmount,
  type BiomeHazePreset,
  hazeFieldLayout,
} from '../src/render/biome_haze_field_core';
import { ZONES } from '../src/sim/data';
import type { BiomeId } from '../src/sim/types';

function presetTable(): Record<BiomeId, BiomeHazePreset> {
  const base = {} as Record<BiomeId, BiomeHazePreset>;
  for (const zone of ZONES) base[zone.biome] = { color: 0x8899aa, far: 400 };
  for (const extra of ['beach', 'desert', 'volcano', 'cave'] as BiomeId[]) {
    base[extra] ??= { color: 0x8899aa, far: 400 };
  }
  return base;
}

beforeEach(() => {
  disposeBiomeHazeField();
});

describe('shader anchors in the pinned three release', () => {
  const frag = THREE.ShaderLib.physical.fragmentShader;

  it('still has both chunks this patches', () => {
    expect(frag).toContain('#include <common>');
    expect(frag).toContain('#include <fog_fragment>');
  });

  it('applies after the colour-space conversion, exactly where scene fog does', () => {
    expect(frag.indexOf('#include <colorspace_fragment>')).toBeGreaterThan(-1);
    expect(frag.indexOf('#include <fog_fragment>')).toBeGreaterThan(
      frag.indexOf('#include <colorspace_fragment>'),
    );
    expect(frag.indexOf('#include <common>')).toBeLessThan(frag.indexOf('#include <fog_fragment>'));
  });
});

describe('the spliced snippet', () => {
  it('reads the caller world position and writes only gl_FragColor', () => {
    const glsl = biomeHazeFragmentGlsl('vFarXZ');
    expect(glsl).toContain('vFarXZ');
    expect(glsl).toContain('gl_FragColor.rgb = mix(');
    // Scoped in its own block, so it can never collide with a sibling patch.
    expect(glsl.trim().startsWith('{')).toBe(true);
    expect(glsl.trim().endsWith('}')).toBe(true);
  });

  it('declares every uniform it samples', () => {
    const glsl = biomeHazeFragmentGlsl('vWPos.xz');
    for (const name of ['uHazeField', 'uHazeRect', 'uHazeGrade', 'uHazeCam']) {
      expect(glsl).toContain(name);
      expect(BIOME_HAZE_DECLARATIONS).toContain(name);
    }
  });

  it('runs the identical ramp aerialHazeAmount pins', () => {
    const glsl = biomeHazeFragmentGlsl('vFarXZ');
    const onset = Number(/uHazeCam\) - ([0-9.]+)\)/.exec(glsl)?.[1]);
    const ref = Number(/\/ ([0-9.]+);/.exec(glsl)?.[1]);
    const max = Number(/float wocHazeA = ([0-9.]+) \*/.exec(glsl)?.[1]);
    expect(Number.isFinite(onset)).toBe(true);
    expect(Number.isFinite(ref)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
    expect(glsl).toContain('(1.0 - exp(-wocHazeT * wocHazeT))');
    for (const distance of [0, 150, 260, 400, 700, 1200, 3000]) {
      for (const strength of [0.66, 0.83, 1]) {
        const t = Math.max(0, distance - onset) / ref;
        const shader = max * strength * (1 - Math.exp(-t * t));
        expect(shader).toBeCloseTo(aerialHazeAmount(distance, strength), 6);
      }
    }
  });
});

describe('the two-replace splice both terrain layers perform', () => {
  // far_terrain.ts and terrain.ts patch the pinned physical fragment with the
  // same pair of replaces. Doing it here catches a chunk rename or an
  // unbalanced block without standing up either module's asset graph.
  function splice(worldXZ: string): string {
    return THREE.ShaderLib.physical.fragmentShader
      .replace('#include <common>', `#include <common>${BIOME_HAZE_DECLARATIONS}`)
      .replace(
        '#include <fog_fragment>',
        `${biomeHazeFragmentGlsl(worldXZ)}\n\t#include <fog_fragment>`,
      );
  }

  it('lands the declarations at file scope and the blend inside main', () => {
    const out = splice('vFarXZ');
    expect(out).toContain('uniform sampler2D uHazeField;');
    expect(out.indexOf('uniform sampler2D uHazeField;')).toBeLessThan(out.indexOf('void main('));
    expect(out.indexOf('vec2 wocHazeXZ')).toBeGreaterThan(out.indexOf('void main('));
  });

  it('runs before the scene fog, so the horizon band still owns the rim', () => {
    const out = splice('vWPos.xz');
    expect(out.indexOf('wocHazeA')).toBeLessThan(out.indexOf('#include <fog_fragment>'));
  });

  it('leaves the shader brace-balanced', () => {
    for (const worldXZ of ['vFarXZ', 'vWPos.xz']) {
      const out = splice(worldXZ);
      let depth = 0;
      for (const ch of out) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }
      expect(depth).toBe(0);
    }
  });

  it('patches exactly once, so a second consumer cannot double-apply it', () => {
    const out = splice('vFarXZ');
    expect(out.split('uniform sampler2D uHazeField;').length - 1).toBe(1);
    expect(out.split('vec2 wocHazeXZ').length - 1).toBe(1);
  });
});

describe('field installation', () => {
  it('is absent until built, so a tier without one compiles unchanged', () => {
    expect(hasBiomeHazeField()).toBe(false);
    expect(biomeHazeFieldLayout()).toBeNull();
  });

  it('uploads an sRGB clamped RGBA8 texture matching the core layout', () => {
    ensureBiomeHazeField(presetTable());
    expect(hasBiomeHazeField()).toBe(true);
    const layout = biomeHazeFieldLayout();
    expect(layout).toEqual(hazeFieldLayout());
    const tex = biomeHazeUniforms().uHazeField.value as THREE.DataTexture;
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(tex.format).toBe(THREE.RGBAFormat);
    expect(tex.type).toBe(THREE.UnsignedByteType);
    expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.image.width).toBe(layout?.cols);
    expect(tex.image.height).toBe(layout?.rows);
  });

  it('normalizes world xz into the field rect', () => {
    ensureBiomeHazeField(presetTable());
    const layout = hazeFieldLayout();
    const rect = biomeHazeUniforms().uHazeRect.value as THREE.Vector4;
    expect(rect.x).toBe(layout.originX);
    expect(rect.y).toBe(layout.originZ);
    // The far corner must land exactly on uv 1, or the clamp band shifts.
    expect((layout.originX + layout.sizeX - rect.x) * rect.z).toBeCloseTo(1, 9);
    expect((layout.originZ + layout.sizeZ - rect.y) * rect.w).toBeCloseTo(1, 9);
  });

  it('builds once: a terrain rebuild reuses the world-static field', () => {
    ensureBiomeHazeField(presetTable());
    const first = biomeHazeUniforms().uHazeField.value;
    ensureBiomeHazeField(presetTable());
    expect(biomeHazeUniforms().uHazeField.value).toBe(first);
  });
});

describe('shared-by-reference uniforms', () => {
  it('hands every consumer the same objects, so the near-to-far handoff agrees', () => {
    ensureBiomeHazeField(presetTable());
    const nearTerrain = biomeHazeUniforms();
    const farTiles = biomeHazeUniforms();
    for (const key of ['uHazeField', 'uHazeRect', 'uHazeGrade', 'uHazeCam']) {
      expect(nearTerrain[key]).toBe(farTiles[key]);
    }
  });

  it('writes the day/night grade and camera through to both consumers', () => {
    ensureBiomeHazeField(presetTable());
    const consumer = biomeHazeUniforms();
    setBiomeHazeGrade([0.3, 0.35, 0.6]);
    setBiomeHazeCamera(-40, -186);
    expect(consumer.uHazeGrade.value).toMatchObject({ x: 0.3, y: 0.35, z: 0.6 });
    expect(consumer.uHazeCam.value).toMatchObject({ x: -40, y: -186 });
  });
});
