// The face-decal maps (stubble.ts, makeup.ts, painted in bands by
// look_pieces.ts) sized by the memory profile: 512 stubble maps on the iOS
// memory profile, and the full sizes, byte for byte, everywhere else; the
// makeup map keeps its size on every profile. Each case paints its own style
// keys: the texture caches live for the whole file.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DecalMemoryProfile } from '../src/render/characters/decal_texture_size_core';
import {
  composedLookPiecesFor,
  LOOK_BAND_ROWS,
  type LookPieceQueue,
  MAKEUP_BAND_LABEL,
  resetLookPiecesForTest,
  STUBBLE_BAND_LABEL,
} from '../src/render/characters/look_pieces';
import {
  MAKEUP_TEX_SIZE,
  makeupTexture,
  makeupTextureData,
  makeupTextureFromData,
} from '../src/render/characters/makeup';
import { VISUALS } from '../src/render/characters/manifest';
import {
  BEARD_DECALS,
  type BeardDecal,
  DEFAULT_APPEARANCE,
  MODULAR_WARRIOR_KEY,
  type ModularAppearance,
  type ModularLook,
  makeupSelection,
  type StubbleSelection,
  stubbleDecals,
  UNDERHAIR_STYLES,
} from '../src/render/characters/modular';
import {
  DECAL_TEX_SIZE,
  decalTexture,
  decalTextureData,
  decalTextureFromData,
  decalTextureSizes,
  resetDecalTextureSizesForTest,
} from '../src/render/characters/stubble';
import { gfxInternalsForTest } from '../src/render/gfx';
import { gpuPrepKindOfLabel } from '../src/render/gpu_prep_budget_core';

const DEF = VISUALS[MODULAR_WARRIOR_KEY];
type Profile = DecalMemoryProfile & { tightMemory: boolean };
const OFF_IOS: Profile = { iosMemoryProfile: false, tightMemory: false };
const IOS: Profile = { iosMemoryProfile: true, tightMemory: false };
const TIGHT: Profile = { iosMemoryProfile: true, tightMemory: true };

let restoreGfx: (() => void) | null = null;
function useProfile(profile: Profile): void {
  restoreGfx?.();
  restoreGfx = gfxInternalsForTest.overrideSettings(profile);
}

beforeEach(() => {
  resetDecalTextureSizesForTest();
  resetLookPiecesForTest();
});
afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
  resetDecalTextureSizesForTest();
});

function lookWith(app: Partial<ModularAppearance>): ModularLook {
  return { app: { ...DEFAULT_APPEARANCE, ...app }, worn: {} };
}

/** A queue that runs every unit at once and records its label. */
function immediateQueue() {
  const labels: string[] = [];
  const queue: LookPieceQueue = {
    run<T>(work: () => T | Promise<T>, _priority = 0, label = 'unlabeled'): Promise<T> {
      labels.push(label);
      return Promise.resolve(work());
    },
  };
  return { queue, labels };
}

const bandsOfKind = (labels: string[], kind: string): number =>
  labels.filter((label) => gpuPrepKindOfLabel(label) === kind).length;

function expectSquareMap(tex: THREE.DataTexture, side: number): void {
  expect(tex.image.width).toBe(side);
  expect(tex.image.height).toBe(side);
  expect((tex.image.data as Uint8Array).length).toBe(side * side * 4);
}

describe('decal map size on the iOS memory profile', () => {
  it('paints the stubble map at 512 and keeps the makeup map at 512', () => {
    useProfile(IOS);
    expect(decalTextureSizes()).toEqual({ stubble: 512, makeup: 512 });
    expectSquareMap(decalTexture({ scalp: 'buzz', beard: 'scruff' }), 512);
    expectSquareMap(makeupTexture({ blush: 'rose', eyeshadow: 'plum' }), 512);
  });

  it('paints a deferred look in half as many stubble bands, at 512', async () => {
    useProfile(IOS);
    const look = lookWith({ hair: 'crew', beard: 'stubble' });
    const sel = stubbleDecals(look.app, look.worn);
    const q = immediateQueue();
    const pieces = composedLookPiecesFor(DEF, look, null, q.queue, 30);
    expect(pieces.ready).toBe(false);
    await pieces.whenReady;
    expect(bandsOfKind(q.labels, STUBBLE_BAND_LABEL)).toBe(512 / LOOK_BAND_ROWS);
    const tex = decalTexture(sel);
    expectSquareMap(tex, 512);
    // the banded paint is the whole map at the same size, byte for byte
    const whole = decalTextureData(sel, 512);
    expect(Buffer.from(tex.image.data as Uint8Array).equals(Buffer.from(whole))).toBe(true);
  });

  it('keeps the makeup map at its full size on the tight rung', async () => {
    useProfile(TIGHT);
    expect(decalTextureSizes()).toEqual({ stubble: 512, makeup: 512 });
    expectSquareMap(decalTexture({ scalp: 'crew', beard: 'scruff' }), 512);
    expectSquareMap(makeupTexture({ blush: 'warm', eyeshadow: 'bronze' }), 512);
    const look = lookWith({ hair: 'bald', beard: 'none', blush: 'peach', eyeshadow: 'teal' });
    const q = immediateQueue();
    await composedLookPiecesFor(DEF, look, null, q.queue, 30).whenReady;
    expect(bandsOfKind(q.labels, MAKEUP_BAND_LABEL)).toBe(512 / LOOK_BAND_ROWS);
    expectSquareMap(makeupTexture(makeupSelection(look.app, look.worn)), 512);
  });
});

describe('decal map size off the iOS memory profile (desktop and Android)', () => {
  it('keeps the full sizes and the same bytes the fixed-size maps had', async () => {
    useProfile(OFF_IOS);
    expect(decalTextureSizes()).toEqual({ stubble: DECAL_TEX_SIZE, makeup: MAKEUP_TEX_SIZE });
    expect(DECAL_TEX_SIZE).toBe(1024);
    expect(MAKEUP_TEX_SIZE).toBe(512);
    const sel: StubbleSelection = { scalp: null, beard: 'scruff' };
    const tex = decalTexture(sel);
    expectSquareMap(tex, 1024);
    const fixed = decalTextureData(sel, 1024);
    expect(Buffer.from(tex.image.data as Uint8Array).equals(Buffer.from(fixed))).toBe(true);
    const shades = { blush: 'warm', eyeshadow: 'smoke' } as const;
    const mtex = makeupTexture(shades);
    expectSquareMap(mtex, 512);
    const fixedMakeup = makeupTextureData(shades, 512);
    expect(Buffer.from(mtex.image.data as Uint8Array).equals(Buffer.from(fixedMakeup))).toBe(true);
    // the banded path still paints the full maps in their historical unit counts
    const look = lookWith({ hair: 'buzz', beard: 'stubble', blush: 'rose', eyeshadow: 'teal' });
    const q = immediateQueue();
    await composedLookPiecesFor(DEF, look, null, q.queue, 30).whenReady;
    expect(bandsOfKind(q.labels, STUBBLE_BAND_LABEL)).toBe(128);
    expect(bandsOfKind(q.labels, MAKEUP_BAND_LABEL)).toBe(64);
    expectSquareMap(decalTexture(stubbleDecals(look.app, look.worn)), 1024);
    expectSquareMap(makeupTexture(makeupSelection(look.app, look.worn)), 512);
  });
});

describe('one size per page', () => {
  it('holds the sizes resolved at the first paint when the profile changes later', () => {
    useProfile(OFF_IOS);
    expectSquareMap(decalTexture({ scalp: 'buzz', beard: null }), 1024);
    useProfile(IOS);
    expect(decalTextureSizes()).toEqual({ stubble: 1024, makeup: 512 });
    expectSquareMap(decalTexture({ scalp: 'solid', beard: null }), 1024);
    resetDecalTextureSizesForTest();
    expect(decalTextureSizes()).toEqual({ stubble: 512, makeup: 512 });
  });
});

describe('texture dimensions follow the painted buffer', () => {
  it('sizes a published map from its bytes, never from a constant', () => {
    useProfile(OFF_IOS);
    const stubble: StubbleSelection = { scalp: 'crew', beard: null };
    expectSquareMap(decalTextureFromData(stubble, decalTextureData(stubble, 256)), 256);
    const shades = { blush: 'none', eyeshadow: 'bronze' } as const;
    expectSquareMap(makeupTextureFromData(shades, makeupTextureData(shades, 128)), 128);
    expect(() =>
      decalTextureFromData(
        { scalp: 'widow', beard: null },
        new Uint8Array(new ArrayBuffer(1024 * 512 * 4)),
      ),
    ).toThrow();
  });

  it('changes nothing but the size between profiles (same format, filtering and colour space)', () => {
    const state = (tex: THREE.DataTexture) => ({
      format: tex.format,
      type: tex.type,
      colorSpace: tex.colorSpace,
      wrapS: tex.wrapS,
      wrapT: tex.wrapT,
      magFilter: tex.magFilter,
      minFilter: tex.minFilter,
      generateMipmaps: tex.generateMipmaps,
      anisotropy: tex.anisotropy,
    });
    useProfile(OFF_IOS);
    const full = decalTexture({ scalp: 'receded', beard: null });
    resetDecalTextureSizesForTest();
    useProfile(IOS);
    const small = decalTexture({ scalp: 'low_fade', beard: null });
    expect(small.image.width).toBeLessThan(full.image.width);
    expect(state(small)).toEqual(state(full));
    expect(state(full)).toMatchObject({
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.SRGBColorSpace,
      minFilter: THREE.LinearMipmapLinearFilter,
      generateMipmaps: true,
    });
  });
});

// The stipple is sized in degrees and painted once per texel centre, and at 512
// a texel is 0.70 degree, wider than the smallest dot's radius, so a dot is hit
// or missed rather than resolved. The map the iOS profile paints must still
// carry the coverage of the full map at the level a phone samples: the full
// map's first mip, a 2x2 box of the 1024 paint.
describe('stipple coverage at 512', () => {
  /** Relative tolerance on a style's mean alpha (measured: under 0.1 percent). */
  const MEAN_TOLERANCE = 0.005;
  /** Region size in 512 texels (11.25 degrees) and the bound on the 95th
   *  percentile of the regions' relative coverage error: point sampling moves
   *  coverage between neighbouring regions (measured: up to 4.9 percent, on
   *  the sparsest pattern), it must not lose it. */
  const REGION = 16;
  const REGION_P95_TOLERANCE = 0.06;

  function alphaOf(data: Uint8Array, size: number): Float64Array {
    const out = new Float64Array(size * size);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3];
    return out;
  }
  function boxDownsample(alpha: Float64Array, size: number): Float64Array {
    const half = size / 2;
    const out = new Float64Array(half * half);
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const i = 2 * y * size + 2 * x;
        out[y * half + x] = (alpha[i] + alpha[i + 1] + alpha[i + size] + alpha[i + size + 1]) / 4;
      }
    }
    return out;
  }
  function regionMeans(alpha: Float64Array, size: number): Float64Array {
    const n = size / REGION;
    const out = new Float64Array(n * n);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        out[Math.floor(y / REGION) * n + Math.floor(x / REGION)] += alpha[y * size + x];
      }
    }
    return out.map((v) => v / (REGION * REGION));
  }
  const mean = (a: Float64Array): number => a.reduce((s, v) => s + v, 0) / a.length;

  const beards = [...new Set(Object.values(BEARD_DECALS))] as BeardDecal[];
  const styles: StubbleSelection[] = [
    ...UNDERHAIR_STYLES.map((scalp) => ({ scalp, beard: null })),
    ...beards.map((beard) => ({ scalp: null, beard })),
  ];

  it('covers every scalp and beard style', () => {
    expect(styles).toHaveLength(UNDERHAIR_STYLES.length + 2);
  });

  it.each(styles)('keeps the coverage of the full map at 512 (%o)', (sel) => {
    const full = boxDownsample(alphaOf(decalTextureData(sel, 1024), 1024), 1024);
    const small = alphaOf(decalTextureData(sel, 512), 512);
    const fullMean = mean(full);
    expect(fullMean).toBeGreaterThan(0);
    expect(Math.abs(mean(small) - fullMean) / fullMean).toBeLessThan(MEAN_TOLERANCE);
    const fullRegions = regionMeans(full, 512);
    const smallRegions = regionMeans(small, 512);
    const errors: number[] = [];
    for (let i = 0; i < fullRegions.length; i++) {
      // regions with real growth in them (over 3 percent alpha)
      if (fullRegions[i] > 8) {
        errors.push(Math.abs(smallRegions[i] - fullRegions[i]) / fullRegions[i]);
      }
    }
    errors.sort((a, b) => a - b);
    expect(errors.length).toBeGreaterThan(50);
    expect(errors[Math.floor(errors.length * 0.95)]).toBeLessThan(REGION_P95_TOLERANCE);
  });
});
