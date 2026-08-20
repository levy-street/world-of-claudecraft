import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerrainView } from '../src/render/terrain';
import { owningRectIndex, type WorldRect } from '../src/render/terrain_region_core';
import {
  STRIP_MAX_X,
  STRIP_MIN_X,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
  ZONES,
} from '../src/sim/data';

// Mirrors terrain.ts's private cellOwnerId: every cell (cx, cz) belongs to the
// zone whose rectangle contains its center, else the nearest rectangle (the
// 14 zone rects do not tile the world). Used to exhaustively check unloadZone
// against every cell it should (and should not) touch, including the far-band
// gap cells a zone owns outside its own rectangle.
function cellsOwnedBy(zoneId: string, chunkSize: number): [number, number][] {
  const zoneRects: WorldRect[] = ZONES.map((zone) => ({
    minX: zone.xMin ?? STRIP_MIN_X,
    maxX: zone.xMax ?? STRIP_MAX_X,
    minZ: zone.zMin,
    maxZ: zone.zMax,
  }));
  const chunksX = Math.ceil((WORLD_MAX_X * 2) / chunkSize);
  const chunksZ = Math.ceil((WORLD_MAX_Z - WORLD_MIN_Z) / chunkSize);
  const owned: [number, number][] = [];
  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const x = -WORLD_MAX_X + (cx + 0.5) * chunkSize;
      const z = WORLD_MIN_Z + (cz + 0.5) * chunkSize;
      const owner = ZONES[owningRectIndex(x, z, zoneRects)];
      if (owner.id === zoneId) owned.push([cx, cz]);
    }
  }
  return owned;
}

/** A build-route-independent identity for a zone's chunks: where each mesh
 *  sits and how dense it is. Two routes to the same world produce the same set,
 *  whatever order the chunks arrived in. */
function chunkFingerprints(group: THREE.Object3D): string[] {
  return group.children
    .map((child) => {
      const geo = (child as THREE.Mesh).geometry as THREE.BufferGeometry;
      geo.computeBoundingBox();
      const box = geo.boundingBox;
      const pos = geo.attributes.position;
      return `${box?.min.x.toFixed(3)},${box?.min.z.toFixed(3)},${pos.count}`;
    })
    .sort();
}

function mockEmptyAssetLoads(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => new Promise(() => {})),
    loadKtx2Texture: vi.fn(() => new Promise(() => {})),
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

// Zone-lazy terrain: buildTerrain() itself builds nothing; each overworld zone
// materializes through ensureZone (driven by the renderer's prepareZoneAt and
// the visible-zone streaming queue). ensureZone yields between build batches
// on setTimeout(0); fake timers drain it deterministically.
describe('progressive terrain build', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    // The pooled-build test below stubs the worker pool; vi.resetModules()
    // drops the module cache but NOT the mock registry, so without this the
    // stub would leak into every later test in this file (it made an idle
    // build finish at fast pace and quietly broke the escalation pins).
    vi.doUnmock('../src/render/zone_build_pool');
  });

  it('builds nothing until a zone is ensured, then only that zone streams in', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    expect(terrain.group.children).toHaveLength(0);

    const zone = zoneAt(0, 0);
    expect(terrain.isZoneLoaded(zone.id)).toBe(false);
    const task = terrain.ensureZone(zone);
    await vi.runAllTimersAsync();
    await task;

    expect(terrain.group.children.length).toBeGreaterThan(0);
    expect(terrain.isZoneLoaded(zone.id)).toBe(true);
  });

  it('unloadZone releases every cell a zone owns (including gap cells outside its rectangle), leaves a neighbouring zone untouched, and a later ensureZone rebuilds it identically', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain, CHUNK_SIZE } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    const zone = zoneAt(0, 0); // eastbrook_vale: owns gap cells up to 360 yd
    // outside its own rectangle (see zone_eviction_core.test.ts), so this
    // exercises the far-band 2x2 super-chunk span-clearing path too, not
    // just single near-band cells.
    const ownedCells = cellsOwnedBy(zone.id, CHUNK_SIZE);
    expect(ownedCells.length).toBeGreaterThan(0);

    // mirefen_marsh is eastbrook_vale's northern neighbour: prepare it too,
    // so unloading eastbrook_vale alone can be checked to leave it intact.
    const neighbor = zoneAt(0, 300);
    expect(neighbor.id).not.toBe(zone.id);
    const neighborCells = cellsOwnedBy(neighbor.id, CHUNK_SIZE);
    expect(neighborCells.length).toBeGreaterThan(0);

    const firstTask = terrain.ensureZone(zone);
    await vi.runAllTimersAsync();
    await firstTask;
    const neighborTask = terrain.ensureZone(neighbor);
    await vi.runAllTimersAsync();
    await neighborTask;

    const builtChunkCount = terrain.group.children.length;
    expect(builtChunkCount).toBeGreaterThan(0);
    const before = terrain.groundResidency();
    for (const [cx, cz] of ownedCells) expect(before.isPending(cx, cz)).toBe(false);
    for (const [cx, cz] of neighborCells) expect(before.isPending(cx, cz)).toBe(false);

    terrain.unloadZone(zone);

    // Same state an unvisited zone starts in: not loaded, and the chunk-level
    // fog clamp treats every one of its owned cells as owed again.
    expect(terrain.isZoneLoaded(zone.id)).toBe(false);
    const after = terrain.groundResidency();
    for (const [cx, cz] of ownedCells) expect(after.isPending(cx, cz)).toBe(true);
    // The neighbouring zone's own cells (including ITS gap cells) must
    // survive: unloadZone must not over-clear past the evicted zone's
    // ownership, e.g. by mis-sizing a far-band super-chunk span.
    for (const [cx, cz] of neighborCells) expect(after.isPending(cx, cz)).toBe(false);
    expect(terrain.isZoneLoaded(neighbor.id)).toBe(true);

    // A later visit rebuilds through the ordinary streaming path, with the
    // same chunk coverage as the first build (neighbor's chunks untouched).
    const secondTask = terrain.ensureZone(zone);
    await vi.runAllTimersAsync();
    await secondTask;
    expect(terrain.group.children.length).toBe(builtChunkCount);
    expect(terrain.isZoneLoaded(zone.id)).toBe(true);
  });

  it('unloadZone on a zone with nothing built is a no-op', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    const zone = zoneAt(0, 0);
    expect(() => terrain.unloadZone(zone)).not.toThrow();
    expect(terrain.group.children).toHaveLength(0);
    expect(terrain.isZoneLoaded(zone.id)).toBe(false);
  });

  it('cancelStreaming stops an in-flight zone build from ever completing', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    const zone = zoneAt(0, 0);
    const task = terrain.ensureZone(zone);
    // Let at most one yield slice through, then cancel: the loop must bail at
    // its next yield point without marking the zone loaded.
    await vi.advanceTimersByTimeAsync(0);
    const midCount = terrain.group.children.length;
    terrain.cancelStreaming();

    await vi.runAllTimersAsync();
    await task;

    expect(terrain.group.children.length).toBe(midCount);
    expect(terrain.isZoneLoaded(zone.id)).toBe(false);
  });

  it('streamed-in chunks are visible to update()/rebuildRegion() via the same live chunk list', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    terrain.update(0, 0, 0);
    const task = terrain.ensureZone(zoneAt(0, 0));
    await vi.runAllTimersAsync();
    await task;

    // The first update cached an empty chunk list. Newly streamed chunks must
    // invalidate that cache, even when camera and fog inputs are unchanged.
    expect(() => terrain.update(0, 0, 0)).not.toThrow();
    expect(terrain.group.children.every((child) => !child.visible)).toBe(true);
    terrain.update(0, 0, 1000);
    expect(terrain.group.children.some((child) => child.visible)).toBe(true);
  });

  it('freezes matrixAutoUpdate on every streamed-in chunk', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    const task = terrain.ensureZone(zoneAt(0, 0));
    await vi.runAllTimersAsync();
    await task;

    for (const child of terrain.group.children) {
      expect(child.matrixAutoUpdate).toBe(false);
    }
  });

  it('an idle-paced background build completes and matches the fast build', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const zone = zoneAt(0, 0);
    const fast = buildTerrain(20061);
    const fastTask = fast.ensureZone(zone);
    await vi.runAllTimersAsync();
    await fastTask;

    // No requestIdleCallback in plain Node, so idleSlot falls back to
    // setTimeout(0); fake timers drain it the same way. The pin is that the
    // idle-paced arm reaches byte-identical/full mesh coverage (zone marked
    // loaded) without stalling or dropping work. Geometry rows are time-sliced
    // now, so it no longer needs extra meshes merely to bound each idle task.
    const idle = buildTerrain(20061);
    const idleTask = idle.ensureZone(zone, undefined, { pace: 'idle' });
    await vi.runAllTimersAsync();
    await idleTask;

    expect(idle.group.children.length).toBe(fast.group.children.length);
    expect(idle.isZoneLoaded(zone.id)).toBe(true);
    fast.cancelStreaming();
    idle.cancelStreaming();
  });

  // The GATING arm pipelines through the shared worker pool: it used to build
  // every cell synchronously on the main thread (measured ~0.8 s per zone under
  // a teleport's loading screen), while the pool sat idle behind the idle arm.
  // The pins: every cell really goes off-thread, no more jobs are in flight than
  // the pool has workers, and the zone that lands is the same one the
  // main-thread arm builds.
  it('a fast-paced build pipelines through the worker pool and lands the same zone', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');
    const zone = zoneAt(0, 0);

    const plain = buildTerrain(20061);
    const plainTask = plain.ensureZone(zone);
    await vi.runAllTimersAsync();
    await plainTask;
    const expected = chunkFingerprints(plain.group);
    plain.cancelStreaming();

    vi.resetModules();
    mockEmptyAssetLoads();
    const stats = { calls: 0, inFlight: 0, peak: 0 };
    const POOL_SIZE = 3;
    vi.doMock('../src/render/zone_build_pool', async () => {
      const { buildChunkArrays } = await import('../src/render/zone_build_worker');
      return {
        zoneBuildPool: () => ({
          size: POOL_SIZE,
          async buildChunk(job: Record<string, unknown>) {
            stats.calls++;
            stats.inFlight++;
            stats.peak = Math.max(stats.peak, stats.inFlight);
            await new Promise((resolve) => setTimeout(resolve, 0));
            stats.inFlight--;
            return buildChunkArrays({ ...job, kind: 'chunk', id: stats.calls } as never);
          },
          async fillWater() {
            return null;
          },
          dispose() {},
        }),
        disposeZoneBuildPool: () => {},
      };
    });
    const pooled = (await import('../src/render/terrain')).buildTerrain(20061);
    const progress: [number, number][] = [];
    const pooledTask = pooled.ensureZone(zone, (done, total) => progress.push([done, total]));
    await vi.runAllTimersAsync();
    await pooledTask;

    const built = chunkFingerprints(pooled.group);
    expect(built).toEqual(expected);
    // Every chunk came from the pool: not one fell back to the main thread.
    expect(stats.calls).toBe(pooled.group.children.length);
    expect(stats.peak).toBe(POOL_SIZE);
    // Progress still ticks once per cell (and per normal-bake slice), and it
    // RUNS OUT: the loading bar has to reach its own total, so the last call
    // is the full one and no tick ever overshoots it. (Sortedness alone was
    // vacuous: an unordered lane still pushes an ascending counter.)
    expect(progress.length).toBeGreaterThan(pooled.group.children.length);
    const total = progress[0][1];
    expect(total).toBeGreaterThan(0);
    expect(progress.every(([, reported]) => reported === total)).toBe(true);
    expect(progress.at(-1)).toEqual([total, total]);
    expect(Math.max(...progress.map(([done]) => done))).toBe(total);
    expect(pooled.isZoneLoaded(zone.id)).toBe(true);
    pooled.cancelStreaming();
  });

  // The pool is FALLIBLE by contract: a worker can fail a single job and the
  // caller must build that one cell here instead. The zone that lands must be
  // indistinguishable from the all-main-thread one, cell for cell, or a zone
  // would quietly come out different depending on which jobs happened to fail.
  it('falls back per cell when the pool declines a job, and still lands the same zone', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');
    const zone = zoneAt(0, 0);

    const plain = buildTerrain(20061);
    const plainTask = plain.ensureZone(zone);
    await vi.runAllTimersAsync();
    await plainTask;
    const expected = chunkFingerprints(plain.group);
    plain.cancelStreaming();

    vi.resetModules();
    mockEmptyAssetLoads();
    const stats = { calls: 0, declined: 0 };
    vi.doMock('../src/render/zone_build_pool', async () => {
      const { buildChunkArrays } = await import('../src/render/zone_build_worker');
      return {
        zoneBuildPool: () => ({
          size: 3,
          async buildChunk(job: Record<string, unknown>) {
            const call = ++stats.calls;
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (call % 3 === 0) {
              stats.declined++;
              return null;
            }
            return buildChunkArrays({ ...job, kind: 'chunk', id: call } as never);
          },
          async fillWater() {
            return null;
          },
          dispose() {},
        }),
        disposeZoneBuildPool: () => {},
      };
    });
    const pooled = (await import('../src/render/terrain')).buildTerrain(20061);
    const pooledTask = pooled.ensureZone(zone);
    await vi.runAllTimersAsync();
    await pooledTask;

    expect(chunkFingerprints(pooled.group)).toEqual(expected);
    expect(stats.declined).toBeGreaterThan(0);
    // Still consulted for EVERY claimable cell: a declined job must fall back
    // for that one cell only, never make the lane give up on the pool.
    expect(stats.calls).toBe(pooled.group.children.length);
    expect(pooled.isZoneLoaded(zone.id)).toBe(true);
    pooled.cancelStreaming();
  });

  // A pool job that REJECTS (a worker that died mid-zone, not one that merely
  // declined) must not be swallowed: the gating lane rethrows the first error,
  // so the zone stays unloaded and the arrival's own catch sees it, instead of
  // a permanent hole in the ground sitting under an opened fog clamp.
  it('a rejecting pool job fails the gating build and leaves the zone rebuildable', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const stats = { calls: 0, rejected: 0 };
    const REJECT_ON_CALL = 5;
    vi.doMock('../src/render/zone_build_pool', async () => {
      const { buildChunkArrays } = await import('../src/render/zone_build_worker');
      return {
        zoneBuildPool: () => ({
          size: 3,
          async buildChunk(job: Record<string, unknown>) {
            const call = ++stats.calls;
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (call === REJECT_ON_CALL) {
              stats.rejected++;
              throw new Error('zone build worker died');
            }
            return buildChunkArrays({ ...job, kind: 'chunk', id: call } as never);
          },
          async fillWater() {
            return null;
          },
          dispose() {},
        }),
        disposeZoneBuildPool: () => {},
      };
    });
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');
    const zone = zoneAt(0, 0);

    const terrain = buildTerrain(20061);
    const settled = terrain.ensureZone(zone).then(
      () => 'resolved' as const,
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    expect(await settled).toBeInstanceOf(Error);
    expect(stats.rejected).toBe(1);
    expect(terrain.isZoneLoaded(zone.id)).toBe(false);

    // Not loaded means REBUILDABLE, not merely un-flagged: a second ensureZone
    // must run the build again (consulting the pool for the cells the failed
    // lane never reached) rather than early-return on a cached zone.
    const callsAfterFailure = stats.calls;
    const second = terrain.ensureZone(zone);
    await vi.runAllTimersAsync();
    await second;
    expect(stats.calls).toBeGreaterThan(callsAfterFailure);
    expect(terrain.isZoneLoaded(zone.id)).toBe(true);
    terrain.cancelStreaming();
  });

  // Escalation: an in-flight idle build switches to fast pacing mid-zone. In
  // Node the idle fallback is a >=200ms cooperative timer while fast yields
  // are setTimeout(0), so MOCK TIME separates the paces decisively: a zone
  // needs well over a hundred yields, so an un-escalated idle build cannot
  // finish inside a few mock seconds, while an escalated one races through
  // its zero-delay yields within each single advance call.
  for (const [name, escalate] of [
    [
      'a fast ensureZone joining an in-flight idle build escalates it',
      (terrain: { ensureZone: (z: unknown) => Promise<void> }, zone: unknown) =>
        void terrain.ensureZone(zone),
    ],
    [
      'escalateZone flips an in-flight idle build to fast pacing',
      (terrain: { escalateZone: (id: string) => void }, zone: { id: string }) =>
        terrain.escalateZone(zone.id),
    ],
  ] as const) {
    it(name, async () => {
      vi.resetModules();
      mockEmptyAssetLoads();
      const { buildTerrain } = await import('../src/render/terrain');
      const { zoneAt } = await import('../src/sim/data');

      const zone = zoneAt(0, 0);
      const terrain = buildTerrain(20061);
      const task = terrain.ensureZone(zone, undefined, { pace: 'idle' });
      // Control: three mock seconds of idle-slot pacing cannot finish a zone
      // (a build takes over a hundred 200ms slots un-escalated).
      for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(250);
      expect(terrain.isZoneLoaded(zone.id)).toBe(false);

      // biome-ignore lint/suspicious/noExplicitAny: the loop above erases the concrete view type
      escalate(terrain as any, zone as any);
      // Escalated, the remaining build must land within a few more mock
      // seconds: far under the un-escalated idle-slot budget.
      for (let i = 0; i < 40 && !terrain.isZoneLoaded(zone.id); i++) {
        await vi.advanceTimersByTimeAsync(250);
      }
      expect(terrain.isZoneLoaded(zone.id)).toBe(true);
      await task;
      terrain.cancelStreaming();
    });
  }

  it('builds the chunks nearest a per-call priority point before farther ones', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    // Anchor away from the zone's row-major origin so the ordering effect is
    // unambiguous: the first built chunks must hug the entry point. The point
    // rides the ensureZone call (a walked crossing's entry), NOT the view's
    // construction point, which deliberately stays unset here.
    const zone = zoneAt(0, 0);
    const point = { x: 0, z: (zone.zMin + zone.zMax) / 2 };
    const terrain = buildTerrain(20061);
    const task = terrain.ensureZone(zone, undefined, { priority: point });

    // Advance a couple of yield slices only, mid-build.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    const early = [...terrain.group.children];
    expect(early.length).toBeGreaterThan(0);

    await vi.runAllTimersAsync();
    await task;
    const all = [...terrain.group.children];
    expect(all.length).toBeGreaterThan(early.length);

    const distToPoint = (mesh: THREE.Object3D): number => {
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      return Math.hypot(center.x - point.x, center.z - point.z);
    };
    const earlyClosest = Math.min(...early.map(distToPoint));
    const overallClosest = Math.min(...all.map(distToPoint));
    expect(earlyClosest).toBeCloseTo(overallClosest, 5);
  });
});

// The outdoor fog clamp reads residency per CHUNK through groundResidency(),
// so these pin the terrain side of that seam: what starts pending, and exactly
// when a cell stops being pending.
describe('chunk-level ground residency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const allCells = (grid: { countX: number; countZ: number }): [number, number][] => {
    const out: [number, number][] = [];
    for (let cz = 0; cz < grid.countZ; cz++) {
      for (let cx = 0; cx < grid.countX; cx++) out.push([cx, cz]);
    }
    return out;
  };

  it('starts every buildable cell pending, then settles exactly one zone of them', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    const { grid, isPending } = terrain.groundResidency();
    const cells = allCells(grid);
    const pendingCount = (): number => cells.filter(([cx, cz]) => isPending(cx, cz)).length;

    // All 792 cells start pending. Ownership is TOTAL since the gap-cell fix
    // (nearest-rect assignment in cellOwnerId): the 96 cells outside every
    // zone rectangle are now built by their nearest zone, so pending-until-
    // built is correct for every cell and the fog clamp can trust the bitmap.
    expect(cells.length).toBe(792);
    expect(pendingCount()).toBe(792);

    const zone = zoneAt(0, 0);
    const hubCx = Math.floor((zone.hub.x - grid.originX) / grid.size);
    const hubCz = Math.floor((zone.hub.z - grid.originZ) / grid.size);
    expect(isPending(hubCx, hubCz)).toBe(true);

    const before = pendingCount();
    const task = terrain.ensureZone(zone);
    await vi.runAllTimersAsync();
    await task;

    expect(isPending(hubCx, hubCz)).toBe(false);
    // Exactly this zone's OWNED cells settled, and nothing outside them: the
    // 36 in-rect cells plus the 21 gap cells nearest-rect ownership assigns
    // the Vale (see the gap-fill notes in terrain.ts).
    expect(before - pendingCount()).toBe(57);
    terrain.cancelStreaming();
  });

  it('clears a cell only once its mesh ATTACHES, never when it is merely claimed', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    const { grid, isPending } = terrain.groundResidency();
    const startedPending = allCells(grid).filter(([cx, cz]) => isPending(cx, cz));

    // Idle pace, stopped mid-build: terrain.ts marks a cell in its internal
    // `built` set BEFORE awaiting the geometry, so a residency signal taken
    // from that set would report ground the scene does not have yet and the
    // fog would open over a hole. Residency must follow attachChunk instead.
    const task = terrain.ensureZone(zoneAt(0, 0), undefined, { pace: 'idle' });
    // Stop at the first attached mesh: the zone has 36 cells, so this is
    // unambiguously mid-build. The idle lane awaits a slot before its first
    // geometry, so the clock has to actually move (advancing by 0 is a no-op).
    for (let slice = 0; slice < 500 && terrain.group.children.length === 0; slice++) {
      await vi.advanceTimersByTimeAsync(1);
    }

    const boxes = terrain.group.children.map((mesh) => new THREE.Box3().setFromObject(mesh));
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.length).toBeLessThan(36);
    const cleared = startedPending.filter(([cx, cz]) => !isPending(cx, cz));
    expect(cleared.length).toBeGreaterThan(0);
    for (const [cx, cz] of cleared) {
      const x = grid.originX + (cx + 0.5) * grid.size;
      const z = grid.originZ + (cz + 0.5) * grid.size;
      const covered = boxes.some(
        (box) =>
          x >= box.min.x - 1 && x <= box.max.x + 1 && z >= box.min.z - 1 && z <= box.max.z + 1,
      );
      expect(covered, `cell (${cx}, ${cz}) cleared with no attached mesh over it`).toBe(true);
    }

    terrain.cancelStreaming();
    await vi.runAllTimersAsync();
    await task;
  });
});

// The world seed src/main.ts fixes; the gap geometry below is stated in its
// terms, so the height pin and the build share one world.
const WORLD_SEED = 20061;

// The zone rectangles do not tile the world box (nothing sits west of
// Eastbrook Vale for z -180..180, nothing north of Frostveil in the centre
// column, and the chunk grid overhangs WORLD_MAX_Z by a row). Cells in those
// gaps used to belong to no zone, so no zone's build ever meshed them: the
// ground there rendered as a hole you saw and fell through. Standing at
// (-195, 161) the terrain is 1.6yd ABOVE the waterline, i.e. walkable ground a
// player reaches on foot from the Willowfen border.
describe('terrain covers the whole world, gaps between zone rectangles included', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // A point is covered when some built chunk's XZ footprint contains it.
  const coversPoint = (group: THREE.Object3D, x: number, z: number): boolean =>
    group.children.some((mesh) => {
      const box = new THREE.Box3().setFromObject(mesh);
      return x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z;
    });

  it('meshes the walkable ground at (-195, 161), in the gap west of Eastbrook Vale', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { ZONES } = await import('../src/sim/data');
    const { terrainHeight, WATER_LEVEL } = await import('../src/sim/world');

    // Pin the premise on the shipped world seed: this really is dry land, not
    // seabed under the water plane, so a missing chunk here is ground the
    // player walks onto and falls through.
    expect(terrainHeight(-195, 161, WORLD_SEED)).toBeGreaterThan(WATER_LEVEL);

    const terrain = buildTerrain(WORLD_SEED);
    // The two realms the gap abuts, which is what the renderer's streaming
    // horizon prepares from either side of the border.
    for (const id of ['eastbrook_vale', 'willowfen']) {
      const zone = ZONES.find((candidate) => candidate.id === id);
      if (!zone) throw new Error(`missing zone ${id}`);
      const task = terrain.ensureZone(zone);
      await vi.runAllTimersAsync();
      await task;
    }

    expect(coversPoint(terrain.group, -195, 161)).toBe(true);
    terrain.cancelStreaming();
  });

  // These two tests both build every zone across the whole map (the most
  // expensive shape in this file, ~800 chunk cells of real geometry) and only
  // ever READ terrain.group afterward, so building it once in a beforeAll and
  // sharing it is byte-identical to each test rebuilding its own copy: same
  // seed, same deterministic zone-order build, no test mutates the result.
  describe('with every zone built', () => {
    let terrain: TerrainView;

    beforeAll(async () => {
      vi.useFakeTimers();
      vi.resetModules();
      mockEmptyAssetLoads();
      const { buildTerrain } = await import('../src/render/terrain');
      const { ZONES } = await import('../src/sim/data');

      terrain = buildTerrain(WORLD_SEED);
      for (const zone of ZONES) {
        const task = terrain.ensureZone(zone);
        await vi.runAllTimersAsync();
        await task;
      }
      vi.useRealTimers();
    });

    afterAll(() => {
      terrain.cancelStreaming();
    });

    it('leaves no uncovered cell anywhere once every zone is built', async () => {
      const { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } = await import('../src/sim/data');

      // Sample every 60u chunk cell's centre across the whole world box.
      // Before the gap-cell fix this found 96 uncovered cells (the
      // south-west quadrant, the centre column north of Frostveil, and the
      // overhanging north row).
      const CHUNK = 60;
      const uncovered: [number, number][] = [];
      for (let z = WORLD_MIN_Z + CHUNK / 2; z < WORLD_MAX_Z; z += CHUNK) {
        for (let x = -WORLD_MAX_X + CHUNK / 2; x < WORLD_MAX_X; x += CHUNK) {
          if (!coversPoint(terrain.group, x, z)) uncovered.push([x, z]);
        }
      }
      expect(uncovered).toEqual([]);
    });

    it('builds every cell exactly once across all zones', () => {
      // Nearest-rect ownership must stay single-owner: a cell claimed by two
      // zones would mesh twice and z-fight, which is the failure mode a plain
      // "nearest zone" fallback in each zone's own loop would have.
      const footprints = terrain.group.children.map((mesh) => {
        const box = new THREE.Box3().setFromObject(mesh);
        return `${box.min.x.toFixed(2)},${box.min.z.toFixed(2)},${box.max.x.toFixed(2)},${box.max.z.toFixed(2)}`;
      });
      expect(new Set(footprints).size).toBe(footprints.length);
    });
  });
});
