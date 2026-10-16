import { describe, expect, it } from 'vitest';
import { gfxInternalsForTest } from '../src/render/gfx';
import { placedTextureTierPath } from '../src/render/placed_texture_tier_core';

const shipped = (...files: string[]) => {
  const set = new Set(files);
  return (path: string) => set.has(path);
};

describe('placed texture tier path', () => {
  const smithy = '/models/tidehold/smithy.glb';
  const all = shipped(
    '/models/tidehold/smithy.half.glb',
    '/models/tidehold/smithy.quarter.glb',
    '/models/tidehold/smithy.lod.half.glb',
  );

  it('keeps the model itself on the full tier, whatever ships beside it', () => {
    expect(placedTextureTierPath(smithy, 'full', all)).toBe(smithy);
  });

  it('loads the half and the quarter file where the tier asks for them', () => {
    expect(placedTextureTierPath(smithy, 'half', all)).toBe('/models/tidehold/smithy.half.glb');
    expect(placedTextureTierPath(smithy, 'quarter', all)).toBe(
      '/models/tidehold/smithy.quarter.glb',
    );
  });

  it('falls back to the next larger set, then to the model, never to a missing file', () => {
    const halfOnly = shipped('/models/tidehold/smithy.half.glb');
    expect(placedTextureTierPath(smithy, 'quarter', halfOnly)).toBe(
      '/models/tidehold/smithy.half.glb',
    );
    // the half tier never reaches DOWN for a quarter file
    const quarterOnly = shipped('/models/tidehold/smithy.quarter.glb');
    expect(placedTextureTierPath(smithy, 'half', quarterOnly)).toBe(smithy);
    expect(placedTextureTierPath(smithy, 'quarter', shipped())).toBe(smithy);
    expect(placedTextureTierPath('/models/props/barrel.glb', 'quarter', all)).toBe(
      '/models/props/barrel.glb',
    );
  });

  it('gives the far twin its own tier file', () => {
    const twin = '/models/tidehold/smithy.lod.glb';
    expect(placedTextureTierPath(twin, 'half', all)).toBe('/models/tidehold/smithy.lod.half.glb');
    // no quarter twin ships: the half one serves the quarter tier
    expect(placedTextureTierPath(twin, 'quarter', all)).toBe(
      '/models/tidehold/smithy.lod.half.glb',
    );
  });

  it('leaves a carved piece, a query and anything that is not a GLB alone', () => {
    const anything = () => true;
    for (const path of [
      '/models/tidehold/smithy.parts.glb#node:P001_furniture',
      '/models/tidehold/smithy.glb?v=2',
      '/models/tidehold/smithy.ktx2',
      'tree://generated',
    ]) {
      expect(placedTextureTierPath(path, 'quarter', anything)).toBe(path);
    }
  });
});

describe('which texture set a profile loads', () => {
  const tierOf = (
    tier: Parameters<typeof gfxInternalsForTest.settingsFor>[0],
    hints?: Parameters<typeof gfxInternalsForTest.settingsFor>[1],
  ) => gfxInternalsForTest.settingsFor(tier, hints).placedTextureTier;

  it('gives the full maps to every desktop tier above low, and the half set to low', () => {
    expect(tierOf('low')).toBe('half');
    for (const tier of ['medium', 'high', 'ultra', 'insane'] as const) {
      expect(tierOf(tier), tier).toBe('full');
    }
  });

  it('gives a phone-class memory profile the quarter set whatever its tier', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
      expect(tierOf(tier, { platform: 'ios' }), `ios ${tier}`).toBe('quarter');
      expect(tierOf(tier, { deviceMemory: 4 }), `4 GB ${tier}`).toBe('quarter');
    }
  });
});
