import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flipbookSheet } from '../src/render/ability_vfx/fx_textures';

afterEach(() => vi.unstubAllGlobals());

describe('prepared Shaman colour sheets', () => {
  it('decodes authored colours with bounded texture storage and preserves legacy masks', () => {
    const gradient = () => ({ addColorStop() {} });
    const context = new Proxy<Record<string, unknown>>(
      {},
      {
        get(target, key) {
          if (key === 'createLinearGradient' || key === 'createRadialGradient') return gradient;
          return target[String(key)] ?? (() => {});
        },
        set(target, key, value) {
          target[String(key)] = value;
          return true;
        },
      },
    );
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });
    let pixels = 0;
    for (const style of [
      'shaman_storm',
      'shaman_dust',
      'shaman_ember',
      'shaman_rime',
      'shaman_gale',
    ] as const) {
      const texture = flipbookSheet(style);
      const side = style === 'shaman_storm' || style === 'shaman_dust' ? 1536 : 1024;
      expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(texture.image.width).toBe(side);
      expect(texture.image.height).toBe(side);
      expect(texture.generateMipmaps).toBe(false);
      expect(flipbookSheet(style)).toBe(texture);
      pixels += side * side;
    }
    expect(pixels * 4).toBe(30 * 1024 * 1024);
    const legacy = flipbookSheet('flame');
    expect(legacy.colorSpace).toBe(THREE.NoColorSpace);
    expect(legacy.image.width).toBe(512);
  });
});
