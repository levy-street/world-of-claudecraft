// The face-decal map sides per memory profile (decal_texture_size_core.ts).
import { describe, expect, it } from 'vitest';
import {
  decalMapSide,
  decalTextureSizesFor,
  FULL_DECAL_TEXTURE_SIZES,
  IOS_STUBBLE_TEXTURE_SIZE,
} from '../src/render/characters/decal_texture_size_core';

const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

describe('decal map sides per memory profile', () => {
  it('keeps the full sizes off the iOS memory profile (desktop and Android)', () => {
    expect(FULL_DECAL_TEXTURE_SIZES).toEqual({ stubble: 1024, makeup: 512 });
    expect(decalTextureSizesFor({ iosMemoryProfile: false })).toEqual({
      stubble: 1024,
      makeup: 512,
    });
  });

  it('halves the stubble map on the iOS memory profile and keeps the makeup map', () => {
    expect(decalTextureSizesFor({ iosMemoryProfile: true })).toEqual({
      stubble: 512,
      makeup: 512,
    });
  });

  it('keeps the makeup map at its full size on the tight rung too', () => {
    // a whole GfxSettings slice, tight flag included: only the iOS flag is read
    const tight = { iosMemoryProfile: true, tightMemory: true };
    expect(decalTextureSizesFor(tight)).toEqual({ stubble: 512, makeup: 512 });
    const offIosTight = { iosMemoryProfile: false, tightMemory: true };
    expect(decalTextureSizesFor(offIosTight)).toEqual({ stubble: 1024, makeup: 512 });
  });

  it('only ever picks power-of-two sides, so every map keeps a whole mip chain', () => {
    for (const size of [
      FULL_DECAL_TEXTURE_SIZES.stubble,
      FULL_DECAL_TEXTURE_SIZES.makeup,
      IOS_STUBBLE_TEXTURE_SIZE,
    ]) {
      expect(isPowerOfTwo(size), `${size}`).toBe(true);
    }
  });
});

describe('decal map side from its buffer', () => {
  it('reads the side of a square RGBA buffer', () => {
    expect(decalMapSide(1024 * 1024 * 4)).toBe(1024);
    expect(decalMapSide(512 * 512 * 4)).toBe(512);
    expect(decalMapSide(256 * 256 * 4)).toBe(256);
    expect(decalMapSide(4)).toBe(1);
  });

  it('refuses a buffer that is not a square RGBA map', () => {
    expect(() => decalMapSide(0)).toThrow();
    expect(() => decalMapSide(12)).toThrow();
    expect(() => decalMapSide(1024 * 512 * 4)).toThrow();
    expect(() => decalMapSide(512 * 512 * 3)).toThrow();
  });
});
