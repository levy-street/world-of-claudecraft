import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// Sliced grass chunk builds (src/render/grass_build_slicer_core.ts wired into
// foliage.ts buildGrassRing): the frame budget is enforced BEFORE each build
// sub-unit, and slicing moves only WHEN the work happens, never WHAT it
// produces. Mock set mirrors tests/foliage_perceptual_density.test.ts.

vi.mock('../src/render/assets/loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/assets/loader')>();
  return {
    ...actual,
    loadGltf: () => new Promise(() => {}),
    loadTexture: () => new Promise(() => {}),
    releaseGltf: () => {},
  };
});
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: () => {},
  registerDeferredPreload: () => {},
}));
vi.mock('../src/render/textures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/textures')>();
  return {
    ...actual,
    grassTuftTexture: () => new THREE.Texture(),
    flowerTuftTexture: () => new THREE.Texture(),
  };
});
vi.mock('../src/render/gfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/gfx')>();
  return {
    ...actual,
    GFX: actual.gfxInternalsForTest.settingsFor('low'),
  };
});

const SEED = 20_061;
const PX = 15;
const PZ = 45;
const FRAME_CAP = 3000;

// A fake clock whose every reading advances by a fixed amount, simulating
// build sub-units that cost real main-thread time. advancePerReadMs 0 is the
// unsliced reference: the budget deadline never arrives, so the whole queued
// window builds in one frame (builds continue while budget remains; there is
// no per-frame completions cap).
const makeClock = (advancePerReadMs: number) => {
  let t = 0;
  return () => {
    const reading = t;
    t += advancePerReadMs;
    return reading;
  };
};

const loadRingBuilder = async () => {
  const { foliageGrassInternalsForTest } = await import('../src/render/foliage');
  return foliageGrassInternalsForTest.buildGrassRing;
};

type GrassRingUnderTest = ReturnType<
  typeof import('../src/render/foliage')['foliageGrassInternalsForTest']['buildGrassRing']
>;

const frameAt = (ring: GrassRingUnderTest, px: number, pz: number): void => {
  ring.update(px, pz, 8, 6, 40, 623.54, 1 / 60);
};

const driveUntilIdle = (ring: GrassRingUnderTest, px: number, pz: number): number => {
  let frames = 0;
  while (frames < FRAME_CAP) {
    frameAt(ring, px, pz);
    frames++;
    if (ring.perfStats().grassQueuedChunks === 0) return frames;
  }
  return frames;
};

interface ChunkGeometry {
  matrix: Float32Array;
  color: Float32Array | null;
}

// One immutable geometry record per chunk+family mesh; duplicate keys (a
// double-built chunk) fail loudly instead of shadowing each other.
const geometryByKey = (parent: THREE.Group): Map<string, ChunkGeometry> => {
  const map = new Map<string, ChunkGeometry>();
  parent.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || !mesh.userData.instanceFamily) return;
    const key = `${mesh.userData.grassChunkKey}:${mesh.userData.instanceFamily}`;
    expect(map.has(key), `duplicate mesh for ${key}`).toBe(false);
    map.set(key, {
      matrix: mesh.instanceMatrix.array as Float32Array,
      color: (mesh.instanceColor?.array as Float32Array | undefined) ?? null,
    });
  });
  return map;
};

const expectSameBytes = (
  actual: Float32Array | null,
  expected: Float32Array | null,
  label: string,
): void => {
  expect(actual === null, `${label}: presence`).toBe(expected === null);
  if (!actual || !expected) return;
  expect(actual.length, `${label}: length`).toBe(expected.length);
  const actualBytes = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength);
  const expectedBytes = Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength);
  expect(Buffer.compare(actualBytes, expectedBytes), `${label}: bytes`).toBe(0);
};

// The unsliced reference ring is built once and shared by the tests below
// (building it means scanning every in-range chunk, the expensive part).
let cachedReference: { readyChunks: number; geometry: Map<string, ChunkGeometry> } | null = null;
const buildReference = async () => {
  if (cachedReference) return cachedReference;
  const buildGrassRing = await loadRingBuilder();
  const parent = new THREE.Group();
  const ring = buildGrassRing(parent, SEED, makeClock(0));
  const frames = driveUntilIdle(ring, PX, PZ);
  expect(frames).toBeLessThan(FRAME_CAP);
  const stats = ring.perfStats();
  expect(stats.grassReadyChunks).toBeGreaterThan(8);
  expect(stats.grassReadyChunks).toBe(stats.grassBuiltChunks);
  cachedReference = { readyChunks: stats.grassReadyChunks, geometry: geometryByKey(parent) };
  return cachedReference;
};

describe('sliced grass chunk builds', () => {
  it('sliced and unsliced builds produce byte-identical instance geometry', async () => {
    // Arrange: the unsliced reference plus a ring whose clock advances 0.35ms
    // per reading, so the 2.2ms budget pauses every chunk mid-build.
    const reference = await buildReference();
    const buildGrassRing = await loadRingBuilder();
    const parent = new THREE.Group();
    const ring = buildGrassRing(parent, SEED, makeClock(0.35));

    // Act + slicing evidence: after one frame the unsliced reference had a
    // finished chunk; the sliced ring is still mid-build with nothing ready.
    frameAt(ring, PX, PZ);
    expect(ring.perfStats().grassReadyChunks).toBe(0);
    const frames = 1 + driveUntilIdle(ring, PX, PZ);
    expect(frames).toBeLessThan(FRAME_CAP);

    // Assert: same chunks, spread over strictly more frames than the old
    // one-chunk-per-frame pacing, and every buffer byte-identical.
    const stats = ring.perfStats();
    expect(stats.grassReadyChunks).toBe(reference.readyChunks);
    expect(frames).toBeGreaterThan(reference.readyChunks);
    const geometry = geometryByKey(parent);
    expect([...geometry.keys()].sort()).toEqual([...reference.geometry.keys()].sort());
    for (const [key, expected] of reference.geometry) {
      const actual = geometry.get(key);
      expect(actual, key).toBeDefined();
      if (!actual) continue;
      expectSameBytes(actual.matrix, expected.matrix, `${key} matrix`);
      expectSameBytes(actual.color, expected.color, `${key} color`);
    }
  }, 60_000);

  it('a frame whose budget is already exhausted pays zero build cost (check precedes work)', async () => {
    // Arrange: every clock reading jumps 100ms, so by the first pre-step
    // check the 2.2ms deadline has always passed.
    const buildGrassRing = await loadRingBuilder();
    const parent = new THREE.Group();
    const ring = buildGrassRing(parent, SEED, makeClock(100));

    // Act
    for (let frame = 0; frame < 5; frame++) frameAt(ring, PX, PZ);

    // Assert: chunks are queued but not one build ran, and nothing was
    // parented. The pre-slicing shape (build the chunk, then check the
    // deadline) builds a whole chunk per frame here and turns this red.
    const stats = ring.perfStats();
    expect(stats.grassQueuedChunks).toBeGreaterThan(0);
    expect(stats.grassBuiltChunks).toBe(0);
    expect(stats.grassReadyChunks).toBe(0);
    let meshes = 0;
    parent.traverse((object) => {
      if ((object as THREE.InstancedMesh).isInstancedMesh) meshes++;
    });
    expect(meshes).toBe(0);
  }, 60_000);

  it('an abandoned mid-build chunk rebuilds to the identical geometry', async () => {
    // Arrange: pause the first chunk mid-build, then leave the area so the
    // in-flight build is abandoned, then come back.
    const reference = await buildReference();
    const buildGrassRing = await loadRingBuilder();
    const parent = new THREE.Group();
    const ring = buildGrassRing(parent, SEED, makeClock(0.35));
    frameAt(ring, PX, PZ);
    frameAt(ring, PX, PZ);
    expect(ring.perfStats().grassReadyChunks).toBe(0);

    // Act: three frames far away (the streamed window moves off the chunk),
    // then return and let the ring finish.
    for (let frame = 0; frame < 3; frame++) frameAt(ring, -500, PZ);
    const frames = driveUntilIdle(ring, PX, PZ);
    expect(frames).toBeLessThan(FRAME_CAP);

    // Assert: no duplicate mesh per chunk+family (geometryByKey pins that),
    // and every reference chunk, including the abandoned-and-rebuilt one,
    // matches the unsliced reference byte for byte. The far detour may cache
    // extra chunks; the reference keys are the ones under test.
    const geometry = geometryByKey(parent);
    for (const [key, expected] of reference.geometry) {
      const actual = geometry.get(key);
      expect(actual, key).toBeDefined();
      if (!actual) continue;
      expectSameBytes(actual.matrix, expected.matrix, `${key} matrix`);
      expectSameBytes(actual.color, expected.color, `${key} color`);
    }
  }, 60_000);

  it('a frame with budget left continues into the next queued chunk (ring fill beats one per frame)', async () => {
    // Arrange: a cost profile where one whole chunk costs well under the
    // 2.2ms frame budget, so only a per-frame completions cap could hold the
    // fill rate down to the pre-slicing one chunk per frame.
    const reference = await buildReference();
    const buildGrassRing = await loadRingBuilder();
    const parent = new THREE.Group();
    const ring = buildGrassRing(parent, SEED, makeClock(0.005));

    // Act
    frameAt(ring, PX, PZ);
    const firstFrameBuilt = ring.perfStats().grassBuiltChunks;
    const frames = 1 + driveUntilIdle(ring, PX, PZ);

    // Assert: the first frame completed a chunk AND kept building with its
    // remaining budget (the completions cap that discarded unspent budget
    // after one finish goes red here), so the whole ring fills in strictly
    // fewer frames than the pre-slicing one-chunk-per-frame rate. The
    // geometry stays byte-identical to the unsliced reference.
    expect(firstFrameBuilt).toBeGreaterThan(1);
    const stats = ring.perfStats();
    expect(stats.grassReadyChunks).toBe(reference.readyChunks);
    expect(frames).toBeLessThan(reference.readyChunks);
    const geometry = geometryByKey(parent);
    for (const [key, expected] of reference.geometry) {
      const actual = geometry.get(key);
      expect(actual, key).toBeDefined();
      if (!actual) continue;
      expectSameBytes(actual.matrix, expected.matrix, `${key} matrix`);
      expectSameBytes(actual.color, expected.color, `${key} color`);
    }
  }, 60_000);

  it('entering a dungeon abandons the in-flight build instead of stranding its buffers', async () => {
    // Arrange: pause the first chunk mid-build (its two chunkCap instance
    // buffers are allocated in the setup sub-unit).
    const reference = await buildReference();
    const buildGrassRing = await loadRingBuilder();
    const parent = new THREE.Group();
    const ring = buildGrassRing(parent, SEED, makeClock(0.35));
    frameAt(ring, PX, PZ);
    frameAt(ring, PX, PZ);
    const statsBefore = ring.perfStats();
    expect(statsBefore.grassReadyChunks).toBe(0);
    expect(statsBefore.grassQueuedChunks).toBeGreaterThan(0);

    // Act: cross the dungeon threshold. update() returns before
    // buildQueuedChunks on that branch, so only the abandon path can release
    // the paused build; without it the two InstancedMesh buffers stay held
    // for the whole dungeon run.
    const disposeSpy = vi.spyOn(THREE.InstancedMesh.prototype, 'dispose');
    frameAt(ring, 200_000, PZ);
    expect(disposeSpy).toHaveBeenCalledTimes(2);
    disposeSpy.mockRestore();
    // The abandoned build no longer counts as in-flight queued work.
    expect(ring.perfStats().grassQueuedChunks).toBe(statsBefore.grassQueuedChunks - 1);

    // Assert: back outside, the abandoned chunk rebuilds byte-identically
    // (the pinned abandon contract) with no duplicate mesh per chunk+family.
    const frames = driveUntilIdle(ring, PX, PZ);
    expect(frames).toBeLessThan(FRAME_CAP);
    const geometry = geometryByKey(parent);
    for (const [key, expected] of reference.geometry) {
      const actual = geometry.get(key);
      expect(actual, key).toBeDefined();
      if (!actual) continue;
      expectSameBytes(actual.matrix, expected.matrix, `${key} matrix`);
      expectSameBytes(actual.color, expected.color, `${key} color`);
    }
  }, 60_000);
});
