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
  attachBiomeHaze,
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

  it('runs the identical two-term ramp aerialHazeAmount pins', () => {
    const glsl = biomeHazeFragmentGlsl('vFarXZ');
    const near = /float wocHazeT = max\(0\.0, wocHazeD - ([0-9.]+)\) \/ ([0-9.]+);/.exec(glsl);
    const far = /float wocHazeT2 = max\(0\.0, wocHazeD - ([0-9.]+)\) \/ ([0-9.]+);/.exec(glsl);
    // Only the BORDER term carries wocHaze.a (the field strength); the camera's
    // own air column is the same depth whichever realm the ray lands on, so the
    // strength must multiply the first term ALONE. Anchored on the parentheses
    // for exactly that reason: re-wrapping the sum would make the shader scale
    // both terms again and this pin is what says so.
    const amps =
      /wocHaze\.a \* ([0-9.]+) \* \(1\.0 - exp\(-wocHazeT \* wocHazeT\)\)\s*\+ ([0-9.]+) \* \(1\.0 - exp\(-wocHazeT2 \* wocHazeT2\)\);/.exec(
        glsl,
      );
    const onset1 = Number(near?.[1]);
    const ref1 = Number(near?.[2]);
    const onset2 = Number(far?.[1]);
    const ref2 = Number(far?.[2]);
    const max1 = Number(amps?.[1]);
    const span2 = Number(amps?.[2]);
    for (const v of [onset1, ref1, onset2, ref2, max1, span2]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    for (const distance of [0, 150, 260, 400, 700, 1200, 3000]) {
      for (const strength of [0.66, 0.83, 1]) {
        const t1 = Math.max(0, distance - onset1) / ref1;
        const t2 = Math.max(0, distance - onset2) / ref2;
        const shader =
          strength * max1 * (1 - Math.exp(-t1 * t1)) + span2 * (1 - Math.exp(-t2 * t2));
        expect(shader).toBeCloseTo(aerialHazeAmount(distance, strength), 6);
      }
    }
  });

  it('never mixes past 1, so the haze can only ever tint and never invert', () => {
    // The two terms are summed rather than nested now, so nothing structurally
    // bounds the total: a future retune that lifts either amplitude has to keep
    // the sum a legal mix factor at every distance and strength.
    for (let d = 0; d <= 6000; d += 50) {
      for (const strength of [0, 0.66, 0.83, 1]) {
        const a = aerialHazeAmount(d, strength);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
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

describe('attachBiomeHaze (props, buildings, foliage canopies)', () => {
  type FakeShader = {
    uniforms: Record<string, unknown>;
    vertexShader: string;
    fragmentShader: string;
  };
  function fakeShader(): FakeShader {
    return {
      uniforms: {},
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
  }
  function compile(mat: THREE.Material, sh: FakeShader): void {
    (mat.onBeforeCompile as unknown as (s: FakeShader, r: null) => void)(sh, null);
  }

  it('is a compile-time no-op without a field, so fogged tiers stay byte-identical', () => {
    const mat = new THREE.MeshStandardMaterial();
    attachBiomeHaze(mat);
    const sh = fakeShader();
    compile(mat, sh);
    expect(sh.vertexShader).toBe(THREE.ShaderLib.physical.vertexShader);
    expect(sh.fragmentShader).toBe(THREE.ShaderLib.physical.fragmentShader);
    expect(Object.keys(sh.uniforms)).toEqual([]);
  });

  it('splices the shared snippet and uniforms once the field exists', () => {
    ensureBiomeHazeField(presetTable());
    const mat = new THREE.MeshStandardMaterial();
    attachBiomeHaze(mat);
    const sh = fakeShader();
    compile(mat, sh);
    expect(sh.vertexShader).toContain('wocHazeVXZ');
    // The instancing arm: an InstancedMesh prop must resolve its own world
    // position, not the shared model origin.
    expect(sh.vertexShader).toContain('instanceMatrix * wocHazeW');
    expect(sh.fragmentShader).toContain('uniform sampler2D uHazeField;');
    // Same anchor as every other geometry consumer: immediately before fog.
    expect(sh.fragmentShader.indexOf('wocHazeA')).toBeLessThan(
      sh.fragmentShader.indexOf('#include <fog_fragment>'),
    );
    expect(sh.uniforms.uHazeField).toBe(biomeHazeUniforms().uHazeField);
  });

  it('chains an existing hook (wind, worn detail) instead of replacing it', () => {
    ensureBiomeHazeField(presetTable());
    const mat = new THREE.MeshStandardMaterial();
    let prevRan = 0;
    mat.onBeforeCompile = () => {
      prevRan++;
    };
    attachBiomeHaze(mat);
    compile(mat, fakeShader());
    expect(prevRan).toBe(1);
  });

  it('attaches once per material, so a shared surfaceMat cannot double-tint', () => {
    ensureBiomeHazeField(presetTable());
    const mat = new THREE.MeshStandardMaterial();
    attachBiomeHaze(mat);
    attachBiomeHaze(mat);
    const sh = fakeShader();
    compile(mat, sh);
    expect(sh.fragmentShader.split('vec2 wocHazeXZ').length - 1).toBe(1);
  });

  it('keys the program cache by arm so on and off tiers never share a program', () => {
    const mat = new THREE.MeshStandardMaterial();
    attachBiomeHaze(mat);
    const keyFor = mat.customProgramCacheKey as unknown as () => string;
    const off = keyFor.call(mat);
    ensureBiomeHazeField(presetTable());
    const on = keyFor.call(mat);
    expect(off).not.toBe(on);
  });
});
