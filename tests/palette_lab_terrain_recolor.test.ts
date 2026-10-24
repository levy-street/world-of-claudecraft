import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The palette lab recolours BUILT ground in place (terrain.recolorRegion):
// each stale chunk is re-meshed from its own inputs and only its colour buffer
// is copied over the live one. These pin that it touches colours and nothing
// else, that a second pass finds nothing stale, and that clearing the override
// brings the shipped colours back exactly.

function mockEmptyAssetLoads(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => new Promise(() => {})),
    loadKtx2Texture: vi.fn(() => new Promise(() => {})),
    loadTexture: vi.fn(() => new Promise(() => {})),
    releaseGltf: vi.fn(),
  }));
  const texture = (): THREE.DataTexture => {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    return tex;
  };
  vi.doMock('../src/render/textures', () => ({
    groundDetailTexture: vi.fn(texture),
    groundSplatMaps: vi.fn(() => ({
      grass: texture(),
      dirt: texture(),
      rock: texture(),
      sand: texture(),
      mud: texture(),
      snow: texture(),
    })),
    macroNoiseTexture: vi.fn(texture),
    skyTexture: vi.fn(texture),
    waterNormalish: vi.fn(texture),
    waterNormalMaps: vi.fn(() => [texture(), texture()]),
  }));
}

const VIVID = {
  grass: 0x78cc3a,
  grassDark: 0x3c983a,
  grassYellow: 0xc2e05a,
  dirt: 0xb08458,
  sand: 0xf0dca2,
};

function snapshot(
  group: THREE.Object3D,
): { geo: THREE.BufferGeometry; pos: number[]; col: number[] }[] {
  return group.children.map((child) => {
    const geo = (child as THREE.Mesh).geometry as THREE.BufferGeometry;
    return {
      geo,
      pos: Array.from(geo.getAttribute('position').array),
      col: Array.from(geo.getAttribute('color').array),
    };
  });
}

describe('palette lab: terrain.recolorRegion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(async () => {
    vi.useRealTimers();
    const { setGroundPaletteOverrides } = await import(
      '../src/render/ground_palette_override_core'
    );
    setGroundPaletteOverrides(null);
  });

  it('recolours built chunks in place, skips current ones, and restores stock exactly', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { setGroundPaletteOverrides } = await import(
      '../src/render/ground_palette_override_core'
    );
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    const zone = zoneAt(0, 0); // eastbrook_vale
    const task = terrain.ensureZone(zone);
    await vi.runAllTimersAsync();
    await task;
    const before = snapshot(terrain.group);
    expect(before.length).toBeGreaterThan(0);

    const recolor = async (): Promise<number> => {
      const pass = terrain.recolorRegion(-40, -100, 40, -20, 0, -60);
      await vi.runAllTimersAsync();
      return pass;
    };

    setGroundPaletteOverrides({ [zone.id]: VIVID });
    const changed = await recolor();
    expect(changed).toBeGreaterThan(0);
    const after = snapshot(terrain.group);
    let recoloured = 0;
    for (let i = 0; i < before.length; i++) {
      // Same geometry object, same positions: only the colour buffer moved.
      expect(after[i].geo).toBe(before[i].geo);
      expect(after[i].pos).toEqual(before[i].pos);
      if (after[i].col.some((v, j) => v !== before[i].col[j])) recoloured++;
    }
    expect(recoloured).toBe(changed);

    // Everything is current now: a second pass has nothing to do.
    expect(await recolor()).toBe(0);

    setGroundPaletteOverrides(null);
    await recolor();
    const restored = snapshot(terrain.group);
    for (let i = 0; i < before.length; i++) expect(restored[i].col).toEqual(before[i].col);
  }, 180_000);
});
