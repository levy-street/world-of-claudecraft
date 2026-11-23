import { describe, expect, it } from 'vitest';
import {
  assetFirePreset,
  MAX_ASSET_FIRE_EMITTERS,
  nextAssetFireId,
  sanitizeAssetFireEmitters,
} from '../src/sim/fire_effects';
import { sanitizeMapDoc } from '../src/sim/map_doc';

function rawDoc(fireEffects: unknown): Record<string, unknown> {
  return {
    version: 2,
    meta: { id: 'fire-map', name: 'Fire Map', seed: 7 },
    content: {
      zones: [
        {
          id: 'z',
          name: 'Z',
          zMin: -10,
          zMax: 100,
          hub: { x: 0, z: 0, radius: 5, name: 'H' },
        },
      ],
      camps: [],
      npcs: {},
      objects: [],
      roads: [],
    },
    terrainEdits: [],
    placements: [
      {
        assetId: 'props/well',
        x: 1,
        z: 2,
        rotY: 0,
        scale: 1,
        collide: false,
        fireEffects,
      },
    ],
  };
}

describe('asset fire effect data', () => {
  it('provides complete distinct presets and deterministic ids', () => {
    const torch = assetFirePreset('torch', 'fire-1');
    const soul = assetFirePreset('soulfire', 'fire-2');
    expect(torch.anchor).toBe('top');
    expect(soul.hue).toBeGreaterThan(180);
    expect(soul).not.toBe(torch);
    expect(nextAssetFireId([torch, soul])).toBe('fire-3');
  });

  it('bounds untrusted shader, smoke, position, and layering values', () => {
    const [fx] = sanitizeAssetFireEmitters([
      {
        id: 'custom',
        style: 'wildfire',
        anchor: 'center',
        blend: 'alpha',
        x: 999,
        y: -999,
        z: Number.NaN,
        scale: 999,
        width: -5,
        height: 999,
        flames: 99,
        intensity: 99,
        opacity: 0,
        glow: -1,
        glowRange: 999,
        smoke: 8,
        smokeScale: -1,
        smokeRise: 99,
        hue: 999,
        saturation: -2,
        speed: 99,
        turbulence: 99,
        flicker: 99,
        embers: 99,
      },
    ]);
    expect(fx).toMatchObject({
      id: 'custom',
      anchor: 'center',
      blend: 'alpha',
      x: 50,
      y: -50,
      scale: 10,
      width: 0.1,
      height: 5,
      flames: 8,
      intensity: 8,
      opacity: 0.05,
      glow: 0,
      glowRange: 50,
      smoke: 1,
      smokeScale: 0.1,
      smokeRise: 5,
      hue: 360,
      saturation: 0,
      speed: 4,
      turbulence: 2,
      flicker: 1,
      embers: 1,
    });
    expect(Number.isFinite(fx.z)).toBe(true);
  });

  it('caps emitter count and repairs duplicate ids', () => {
    const rows = Array.from({ length: MAX_ASSET_FIRE_EMITTERS + 4 }, () => ({
      ...assetFirePreset('torch', 'duplicate'),
    }));
    const clean = sanitizeAssetFireEmitters(rows);
    expect(clean).toHaveLength(MAX_ASSET_FIRE_EMITTERS);
    expect(new Set(clean.map((fx) => fx.id)).size).toBe(MAX_ASSET_FIRE_EMITTERS);
  });

  it('round-trips rich emitters through the map document sanitizer', () => {
    const bonfire = assetFirePreset('bonfire', 'fire-1');
    bonfire.x = 1.25;
    bonfire.hue = 72;
    const doc = sanitizeMapDoc(rawDoc([bonfire]));
    expect(doc?.placements[0].fireEffects).toEqual([bonfire]);
  });
});
