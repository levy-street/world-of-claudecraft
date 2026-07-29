import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A byte-identical pin on generated chunk geometry.
//
// The terrain generator is about to be split so its compute half (the row
// fills, which touch no WebGL) can run in a Worker instead of stealing main
// thread time. That move must not change a single vertex: same seed, same
// world. These hashes are the safety net for the whole sequence, including the
// later swap of THREE.Color palette math for plain floats, where an
// unreplicated sRGB-to-linear conversion would silently reshade the world
// without changing anything's shape.
//
// If one of these fails after a refactor, the refactor changed the world. That
// is the point. Re-mint the expected hash ONLY when you intend the visual
// change and have looked at it.

function mockEmptyAssetLoads(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => new Promise(() => {})),
    loadHdr: vi.fn(() => new Promise(() => {})),
    loadTexture: vi.fn(() => new Promise(() => {})),
    releaseGltf: vi.fn(),
  }));
  const texture = (): THREE.DataTexture => {
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
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

/** Stable digest of one attribute's raw numbers, rounded to a float32-safe
 *  precision so an unrelated FP-associativity change does not cry wolf. */
function hashAttribute(values: ArrayLike<number>): string {
  const hash = createHash('sha256');
  const buf = new Float64Array(1);
  for (let i = 0; i < values.length; i++) {
    // round to 6 decimals: far tighter than any visible difference, loose
    // enough to survive a compiler reassociating a sum
    buf[0] = Math.round(values[i] * 1e6) / 1e6;
    hash.update(new Uint8Array(buf.buffer, 0, 8));
  }
  return hash.digest('hex').slice(0, 16);
}

describe('generated chunk geometry is stable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pins every vertex attribute of the Eastbrook chunks for seed 20061', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    const task = terrain.ensureZone(zoneAt(0, 0));
    await vi.runAllTimersAsync();
    await task;

    const meshes = terrain.group.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
    // 36 in-rect chunks plus the 12 merged super-chunk meshes over the 21 gap
    // cells nearest-rect ownership hands the Vale (the rects do not tile).
    expect(meshes.length).toBe(48);

    // Order the chunks by their own geometry bounds, so the pin does not depend
    // on build ORDER (which the worker move is expressly going to change).
    const keyed = meshes.map((mesh) => {
      const geo = mesh.geometry;
      geo.computeBoundingBox();
      const box = geo.boundingBox;
      if (!box) throw new Error('chunk geometry has no bounding box');
      return { geo, box, key: `${Math.round(box.min.x)}:${Math.round(box.min.z)}` };
    });
    keyed.sort((a, b) => a.key.localeCompare(b.key));

    const digestOf = (chunks: typeof keyed): string => {
      const digest = createHash('sha256');
      for (const { geo, key } of chunks) {
        digest.update(key);
        for (const name of ['position', 'normal', 'color', 'uv']) {
          const attr = geo.getAttribute(name);
          expect(attr, `${key} missing ${name}`).toBeTruthy();
          digest.update(`${name}:${hashAttribute(attr.array as unknown as ArrayLike<number>)}`);
        }
        const index = geo.getIndex();
        expect(index, `${key} missing index`).toBeTruthy();
        if (index)
          digest.update(`index:${hashAttribute(index.array as unknown as ArrayLike<number>)}`);
      }
      return digest.digest('hex').slice(0, 32);
    };

    // The in-rect chunks split from the gap fill by their bounds: every Vale
    // rect chunk starts at x >= -180 (the skirt overhangs by under a yard).
    const inRect = keyed.filter(({ box }) => box.min.x >= -181);
    const gapFill = keyed.filter(({ box }) => box.min.x < -181);
    expect(inRect.length).toBe(36);
    expect(gapFill.length).toBe(12);

    // Re-minted for the Eastbrook camp respacing (PR #2584, maintainer-ordered):
    // camp radii drive the terrain flatten aprons, so the deliberate, reviewed
    // spread of the starter camps regrades the Vale rect. The prior pin
    // (6f7fb63da247a5eb272dd9d7a42a5fcd) dated from before that change; the
    // gap-cell fill must still not perturb a single byte of in-rect geometry.
    expect(digestOf(inRect)).toBe('987a8787d8d0101698ed259f73aa557b');
    // The gap super-chunks' own pin. Re-mint ONLY for a deliberate, reviewed
    // visual change.
    expect(digestOf(gapFill)).toBe('1da89b363fda0dcac73d4d5a24c1760d');

    terrain.cancelStreaming();
  });
});
