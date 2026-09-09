import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';

import { gfxInternalsForTest } from '../src/render/gfx';
import {
  anisotropyFor,
  applyTextureAnisotropy,
  refreshTextureAnisotropy,
  textureAnisotropyInternalsForTest,
} from '../src/render/texture_anisotropy';

afterEach(() => textureAnisotropyInternalsForTest.reset());

const capsHost = (max: number) => ({ capabilities: { getMaxAnisotropy: () => max } });

describe('texture anisotropy budget', () => {
  it('reads the STATIC preset ladder, colour and normal apart', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      const settings = gfxInternalsForTest.settingsFor(tier);
      expect(anisotropyFor('colour', settings), tier).toBe(settings.anisotropy);
      expect(anisotropyFor('normal', settings), tier).toBe(settings.normalAnisotropy);
    }
  });

  it('clamps to the device ceiling and never drops below one tap', () => {
    const insane = gfxInternalsForTest.settingsFor('insane');
    expect(anisotropyFor('colour', insane)).toBe(8);

    refreshTextureAnisotropy(capsHost(2));
    expect(anisotropyFor('colour', insane)).toBe(2);
    expect(anisotropyFor('normal', insane)).toBe(2);

    // A device that reports no anisotropy support at all still gets a legal
    // sampler value, not 0.
    refreshTextureAnisotropy(capsHost(0));
    expect(anisotropyFor('colour', insane)).toBe(1);
    expect(anisotropyFor('normal', gfxInternalsForTest.settingsFor('low'))).toBe(1);
  });

  it('stamps the live budget onto a texture', () => {
    const restore = gfxInternalsForTest.overrideSettings({ anisotropy: 8, normalAnisotropy: 4 });
    try {
      const colour = applyTextureAnisotropy(new THREE.Texture(), 'colour');
      const normal = applyTextureAnisotropy(new THREE.Texture(), 'normal');
      expect(colour.anisotropy).toBe(8);
      expect(normal.anisotropy).toBe(4);
    } finally {
      restore();
    }
  });

  it('re-stamps textures registered before the tier resolved', () => {
    const parsedEarly = new THREE.Texture();
    const parsedEarlyNormal = new THREE.Texture();
    const guess = gfxInternalsForTest.overrideSettings({ anisotropy: 8, normalAnisotropy: 4 });
    try {
      applyTextureAnisotropy(parsedEarly, 'colour');
      applyTextureAnisotropy(parsedEarlyNormal, 'normal');
    } finally {
      guess();
    }
    expect(parsedEarly.anisotropy).toBe(8);

    const resolved = gfxInternalsForTest.overrideSettings({ anisotropy: 2, normalAnisotropy: 1 });
    try {
      refreshTextureAnisotropy(capsHost(16));
    } finally {
      resolved();
    }

    expect(parsedEarly.anisotropy).toBe(2);
    expect(parsedEarlyNormal.anisotropy).toBe(1);
  });

  it('never marks a re-stamped texture for re-upload', () => {
    // three keys its per-context WebGLTexture cache on `anisotropy`, so a
    // `needsUpdate` here would mint a new GL texture with forceUpload: a full
    // re-upload, which comes back BLACK for a KTX2 texture whose CPU mips
    // assets/ktx2_mip_release.ts already released. The correct path is to move
    // the value before the first upload and leave `version` alone.
    const tex = new THREE.Texture();
    const before = tex.version;
    const restore = gfxInternalsForTest.overrideSettings({ anisotropy: 8, normalAnisotropy: 4 });
    try {
      applyTextureAnisotropy(tex, 'colour');
    } finally {
      restore();
    }
    expect(tex.version).toBe(before);

    const lowered = gfxInternalsForTest.overrideSettings({ anisotropy: 1, normalAnisotropy: 1 });
    try {
      refreshTextureAnisotropy(capsHost(16));
    } finally {
      lowered();
    }
    expect(tex.anisotropy).toBe(1);
    expect(tex.version).toBe(before);
  });

  it('drops collected registrations instead of retaining every texture forever', () => {
    const kept = applyTextureAnisotropy(new THREE.Texture(), 'colour');
    applyTextureAnisotropy(new THREE.Texture(), 'colour');
    expect(textureAnisotropyInternalsForTest.registeredCount()).toBe(2);

    // Simulate the collection rather than waiting on the real GC: the contract
    // under test is that a dead WeakRef is pruned, not that V8 collects at a
    // particular moment.
    const [, second] = textureAnisotropyInternalsForTest.registrations();
    Object.defineProperty(second.ref, 'deref', { value: () => undefined });
    refreshTextureAnisotropy();
    expect(textureAnisotropyInternalsForTest.registeredCount()).toBe(1);
    expect(kept.anisotropy).toBe(anisotropyFor('colour'));
  });
});

// Every site that used to hard-code a tap count. A regression that puts a
// literal back reds here, which is the point: the ladder is only worth
// anything if nothing bypasses it.
const CONSUMERS: ReadonlyArray<readonly [string, number]> = [
  ['src/render/terrain.ts', 3],
  ['src/render/assets/loader.ts', 1],
  ['src/render/detail_normals.ts', 1],
  ['src/render/canopy_detail.ts', 1],
  ['src/render/water.ts', 1],
  ['src/render/worn_stone.ts', 1],
  ['src/render/characters/stubble.ts', 1],
  ['src/render/characters/makeup.ts', 1],
];

describe('texture anisotropy consumers', () => {
  it('routes every converted site through the knob and leaves no literal behind', () => {
    for (const [file, sites] of CONSUMERS) {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(src, file).toMatch(/import \{ applyTextureAnisotropy \} from '\.\.?\/?[\w/]*'/);
      expect(src.match(/applyTextureAnisotropy\(/g)?.length ?? 0, file).toBe(sites);
      // `x.anisotropy = <number literal>` anywhere is the pattern this change
      // exists to remove.
      expect(src, file).not.toMatch(/\.anisotropy\s*=\s*[\d.]/);
    }
  });

  it('gives the renderer the resolved budget before it builds any scene content', () => {
    const src = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const init = src.indexOf('initGfxTier(this.webgl)');
    const refresh = src.indexOf('refreshTextureAnisotropy(this.webgl)');
    expect(init).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(init);
  });
});
