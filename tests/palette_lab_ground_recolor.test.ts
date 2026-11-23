import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { setGroundPaletteOverrides } from '../src/render/ground_palette_override_core';
import { groundGrassColorAt } from '../src/render/terrain_chunk_build';
import { buildChunkArrays, type TerrainChunkRequest } from '../src/render/zone_build_worker';

// The palette lab re-bakes ground colours by re-meshing chunks under a zone
// override and copying only their colour buffers over the live ones. That is
// only safe if (a) an override changes colours and NOTHING else, and (b)
// clearing it brings back the shipped colours byte for byte.

const JOB: TerrainChunkRequest = {
  kind: 'chunk',
  id: 1,
  x0: -60,
  z0: -120, // Eastbrook Vale
  size: 60,
  spacing: 2,
  seed: 20061,
  withSplat: true,
  skirtSpan: 8,
  lowShade: false,
};

const VIVID = {
  grass: 0x78cc3a,
  grassDark: 0x3c983a,
  grassYellow: 0xc2e05a,
  dirt: 0xb08458,
  sand: 0xf0dca2,
};

afterEach(() => {
  setGroundPaletteOverrides(null);
});

describe('palette-lab ground re-bake', () => {
  it('changes only the colours of a chunk inside the overridden zone', () => {
    const stock = buildChunkArrays(JOB);
    setGroundPaletteOverrides({ eastbrook_vale: VIVID });
    const tinted = buildChunkArrays(JOB);
    expect(Array.from(tinted.positions)).toEqual(Array.from(stock.positions));
    expect(Array.from(tinted.normals)).toEqual(Array.from(stock.normals));
    expect(Array.from(tinted.indices)).toEqual(Array.from(stock.indices));
    expect(tinted.colors.length).toBe(stock.colors.length);
    expect(Array.from(tinted.colors)).not.toEqual(Array.from(stock.colors));
  });

  it('restores the shipped colours exactly when the override clears', () => {
    const before = buildChunkArrays(JOB);
    setGroundPaletteOverrides({ eastbrook_vale: VIVID });
    buildChunkArrays(JOB);
    setGroundPaletteOverrides(null);
    expect(Array.from(buildChunkArrays(JOB).colors)).toEqual(Array.from(before.colors));
  });

  it('carries the table on a worker job (the worker owns its own module copy)', () => {
    const stock = buildChunkArrays(JOB);
    const viaJob = buildChunkArrays({ ...JOB, groundPalette: { eastbrook_vale: VIVID } });
    expect(Array.from(viaJob.colors)).not.toEqual(Array.from(stock.colors));
    const cleared = buildChunkArrays({ ...JOB, groundPalette: null });
    expect(Array.from(cleared.colors)).toEqual(Array.from(stock.colors));
  });

  it('feeds the grass the foliage keys off (tufts and blades follow the ground)', () => {
    const before = groundGrassColorAt(-30, -90, 20061, new THREE.Color()).getHex();
    setGroundPaletteOverrides({ eastbrook_vale: VIVID });
    expect(groundGrassColorAt(-30, -90, 20061, new THREE.Color()).getHex()).not.toBe(before);
  });
});
