// The drowned shrine recolors its delve arch's baked red veil to water blue on a
// clone of the converted kit material. That clone used to be a bare clone() with
// a replacing hook and a constant key, so it dropped every layer the converter
// had attached: the drowned arch drew without the zone haze and without the worn
// surface detail every other delve entrance carries.

import * as THREE from 'three';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachBiomeHaze,
  disposeBiomeHazeField,
  ensureBiomeHazeField,
} from '../src/render/biome_haze_field';
import type { BiomeHazePreset } from '../src/render/biome_haze_field_core';
import { drownVeilMaterial, resetDrownVeilMaterials } from '../src/render/drowned_veil_material';
import { gfxInternalsForTest } from '../src/render/gfx';
import { applySurfaceDetail } from '../src/render/worn_stone';
import { ZONES } from '../src/sim/data';
import type { BiomeId } from '../src/sim/types';

type ShaderStub = Parameters<THREE.Material['onBeforeCompile']>[0];

function hazePresets(): Record<BiomeId, BiomeHazePreset> {
  const table = {} as Record<BiomeId, BiomeHazePreset>;
  for (const zone of ZONES) table[zone.biome] = { color: 0x8899aa, far: 400 };
  for (const extra of ['beach', 'desert', 'volcano', 'cave'] as BiomeId[]) {
    table[extra] ??= { color: 0x8899aa, far: 400 };
  }
  return table;
}

/** The arch's converted kit material as props.ts convertMaterial builds it on
 *  high: the zone haze first, then the dungeon kit's rock detail layer. */
function convertedArchMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  mat.name = 'dungeon:';
  attachBiomeHaze(mat);
  applySurfaceDetail(mat, 'rock', { strength: 0.45 });
  return mat;
}

function compiled(material: THREE.Material): ShaderStub {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as ShaderStub;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

let restoreGfx: () => void = () => {};

beforeEach(() => {
  restoreGfx = gfxInternalsForTest.overrideSettings({
    standardMaterials: true,
    surfaceDetail: true,
  });
  disposeBiomeHazeField();
  ensureBiomeHazeField(hazePresets());
  resetDrownVeilMaterials();
});

afterEach(() => {
  resetDrownVeilMaterials();
  disposeBiomeHazeField();
  restoreGfx();
});

describe('drownVeilMaterial', () => {
  it('extends the source layers in its program key instead of replacing them', () => {
    const source = convertedArchMaterial();
    const drowned = drownVeilMaterial(source);
    expect(drowned).not.toBe(source);
    const key = drowned.customProgramCacheKey();
    // The layer keys chain, so the source's own tokens lead the drowned key.
    // Not byte-equal to the source key plus a suffix: the innermost layer sits
    // on three's default key, which re-reads the OUTERMOST hook's source at
    // call time, and the outermost hook is the recolor here.
    expect(key.startsWith('surface-detail|')).toBe(true);
    expect(key).toContain('|woc-zone-haze:1|');
    expect(key.endsWith('|drownVeil')).toBe(true);
    expect(key).not.toBe(source.customProgramCacheKey());
  });

  it('keeps the zone haze and chains the recolor after the source layers', () => {
    const source = convertedArchMaterial();
    const fragment = compiled(drownVeilMaterial(source)).fragmentShader;
    // The haze layer, spliced before fog as on every other kit material.
    expect(fragment).toContain('varying vec2 wocHazeVXZ;');
    expect(fragment).toContain('uHazeField');
    // The recolor reads the raw albedo texel, right after the map lookup it was
    // tuned against, ahead of everything the later chunks do to diffuseColor.
    const recolor = fragment.indexOf('float _veilRed');
    expect(recolor).toBeGreaterThan(fragment.indexOf('#include <map_fragment>'));
    expect(recolor).toBeLessThan(fragment.indexOf('#include <color_fragment>'));
    // Everything the source compiles to is still there, plus the recolor.
    const sourceFragment = compiled(source).fragmentShader;
    expect(fragment.replace(/\n\s*\/\/ recolor[\s\S]*?_veilRed\);\n */, '')).toBe(sourceFragment);
  });

  it('leaves the default entrance material untouched', () => {
    const source = convertedArchMaterial();
    const key = source.customProgramCacheKey();
    const hook = source.onBeforeCompile;
    drownVeilMaterial(source);
    expect(source.customProgramCacheKey()).toBe(key);
    expect(source.onBeforeCompile).toBe(hook);
    expect(compiled(source).fragmentShader).not.toContain('_veilRed');
  });

  it('keeps the haze on the Lambert tier, where no detail layer applies', () => {
    const source = new THREE.MeshLambertMaterial({ color: 0xffffff });
    attachBiomeHaze(source);
    const drowned = drownVeilMaterial(source);
    const key = drowned.customProgramCacheKey();
    expect(key.startsWith('woc-zone-haze:1|')).toBe(true);
    expect(key.endsWith('|drownVeil')).toBe(true);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    } as unknown as ShaderStub;
    drowned.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('uHazeField');
    expect(shader.fragmentShader).toContain('float _veilRed');
  });

  it('grants no layer the source never carried', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    applySurfaceDetail(source, 'rock', { strength: 0.45 });
    const drowned = drownVeilMaterial(source);
    expect(drowned.customProgramCacheKey()).not.toContain('woc-zone-haze');
    const fragment = compiled(drowned).fragmentShader;
    expect(fragment).not.toContain('uHazeField');
    expect(fragment).toContain('float _veilRed');
  });

  it('clones once per source material', () => {
    const source = convertedArchMaterial();
    expect(drownVeilMaterial(source)).toBe(drownVeilMaterial(source));
  });
});

// The worn layer compiles to a pass-through until its family textures resolve,
// so the cases above see only its key. Here the textures are ready (loader and
// preload mocked, as tests/worn_stone_shader.test.ts does) and the layer's GLSL
// is really spliced: the recolor must still read the raw texel, ahead of it.
describe('drownVeilMaterial over a ready worn layer', () => {
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../src/render/assets/loader');
    vi.doUnmock('../src/render/assets/preload');
  });

  it('keeps the worn GLSL and splices the recolor ahead of it', async () => {
    const pending: Promise<unknown>[] = [];
    vi.resetModules();
    vi.stubGlobal('location', { search: '?gfx=high' });
    vi.doMock('../src/render/assets/loader', () => ({
      loadTexture: () => Promise.resolve(new THREE.Texture()),
      loadKtx2Texture: () => Promise.resolve(new THREE.Texture()),
    }));
    vi.doMock('../src/render/assets/preload', () => ({
      registerPreload: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
      registerDeferredPreload: (start: () => Promise<unknown>) => {
        pending.push(start());
      },
    }));
    const worn = await import('../src/render/worn_stone');
    const haze = await import('../src/render/biome_haze_field');
    const veil = await import('../src/render/drowned_veil_material');
    await Promise.all(pending);
    haze.ensureBiomeHazeField(hazePresets());
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    haze.attachBiomeHaze(source);
    worn.applySurfaceDetail(source, 'rock', { strength: 0.45 });
    const drowned = veil.drownVeilMaterial(source);
    expect(drowned.customProgramCacheKey().startsWith('surface-detail|on|')).toBe(true);
    const fragment = compiled(drowned).fragmentShader;
    const wornBlock = fragment.indexOf('vec3 wornP = ');
    expect(wornBlock).toBeGreaterThan(-1);
    expect(fragment).toContain('uHazeField');
    expect(fragment.indexOf('float _veilRed')).toBeLessThan(wornBlock);
    expect(fragment.replace(/\n\s*\/\/ recolor[\s\S]*?_veilRed\);\n */, '')).toBe(
      compiled(source).fragmentShader,
    );
    haze.disposeBiomeHazeField();
  });
});
