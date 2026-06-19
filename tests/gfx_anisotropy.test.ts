import { describe, expect, it } from 'vitest';
import { anisotropyLevel } from '../src/render/gfx';

// Guards the init-ordering trap: terrain/water textures preload BEFORE
// initGfxTier resolves the device max, so anisotropyLevel must fall back to the
// requested value (GL clamps on upload) rather than clamping against a stale 0
// — otherwise the headline "crisper grazing-angle ground" ships as anisotropy=1.
describe('anisotropyLevel', () => {
  it('low tier pays nothing', () => {
    expect(anisotropyLevel('low', 16, 8)).toBe(1);
    expect(anisotropyLevel('low', 0, 8)).toBe(1);
  });

  it('clamps the request to the known device max', () => {
    expect(anisotropyLevel('high', 4, 8)).toBe(4);
    expect(anisotropyLevel('ultra', 16, 8)).toBe(8);
    expect(anisotropyLevel('high', 16, 4)).toBe(4);
  });

  it('falls back to the requested value before the GL max is known (max === 0)', () => {
    expect(anisotropyLevel('high', 0, 8)).toBe(8);
    expect(anisotropyLevel('ultra', 0, 4)).toBe(4);
  });
});
