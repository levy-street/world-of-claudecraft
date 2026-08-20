import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginChunkGeometry,
  fillChunkIndexRow,
  fillChunkVertexRow,
} from '../src/render/terrain_chunk_build';
import { shoreDepthAt, shoreSlopeAt } from '../src/render/water_core';
import { disposeZoneBuildPool, zoneBuildPool } from '../src/render/zone_build_pool';
import {
  buildChunkArrays,
  buildWaterFillArrays,
  type TerrainChunkRequest,
  type WaterFillRequest,
} from '../src/render/zone_build_worker';
import { isBuiltinWorldActive, setActiveWorldContent } from '../src/sim/data';

// The worker's entry point is a SECOND route to the same geometry, so it can
// drift from the main-thread one: drop an index row, mis-order the fills, miss
// a field off the response. Then chunks would render differently depending on
// which thread happened to build them, which no screenshot would reliably
// catch. These compare the two routes directly.

const JOB: TerrainChunkRequest = {
  kind: 'chunk',
  id: 1,
  x0: -60,
  z0: 240,
  size: 60,
  spacing: 2,
  seed: 20061,
  withSplat: true,
  skirtSpan: 8,
  lowShade: false,
};

/** The main-thread route, spelled out, so this is not a self-comparison. */
function buildOnThisThread(job: TerrainChunkRequest) {
  const state = beginChunkGeometry(
    job.x0,
    job.z0,
    job.size,
    job.spacing,
    job.seed,
    job.withSplat,
    job.skirtSpan,
    job.lowShade,
  );
  for (let row = 0; row < state.gh; row++) fillChunkVertexRow(state, row);
  for (let row = 0; row < state.gh - 1; row++) fillChunkIndexRow(state, row);
  return state;
}

describe('off-thread chunk generation matches the main thread', () => {
  it('produces identical arrays for the same job', () => {
    const viaWorker = buildChunkArrays(JOB);
    const viaMain = buildOnThisThread(JOB);

    expect(viaWorker.positions.length).toBeGreaterThan(0);
    expect(viaWorker.indices.length).toBeGreaterThan(0);
    expect(Array.from(viaWorker.positions)).toEqual(Array.from(viaMain.positions));
    expect(Array.from(viaWorker.normals)).toEqual(Array.from(viaMain.normals));
    expect(Array.from(viaWorker.colors)).toEqual(Array.from(viaMain.colors));
    expect(Array.from(viaWorker.uvs)).toEqual(Array.from(viaMain.uvs));
    expect(Array.from(viaWorker.indices)).toEqual(Array.from(viaMain.indices));
    expect(viaWorker.splats).not.toBeNull();
    expect(Array.from(viaWorker.splats ?? [])).toEqual(Array.from(viaMain.splats ?? []));
    expect(Array.from(viaWorker.extras ?? [])).toEqual(Array.from(viaMain.extras ?? []));
  });

  it('honours the caller-resolved tier flag instead of reading gfx.ts', () => {
    // gfx.ts reads document/navigator, so a worker would resolve a DIFFERENT
    // tier and shade chunks two ways depending on the thread. The flag has to
    // travel on the request, and it has to actually do something.
    const lit = buildChunkArrays({ ...JOB, lowShade: false });
    const shaded = buildChunkArrays({ ...JOB, lowShade: true, withSplat: false });
    expect(Array.from(shaded.colors)).not.toEqual(Array.from(lit.colors));
    // ...and only the colours: the surface itself is the same shape either way.
    expect(Array.from(shaded.positions)).toEqual(Array.from(lit.positions));
  });

  it('omits the splat attributes on the low tier', () => {
    const low = buildChunkArrays({ ...JOB, withSplat: false });
    expect(low.splats).toBeNull();
    expect(low.extras).toBeNull();
  });

  it('degrades to null where module workers are unavailable', () => {
    // Node has no Worker, which is exactly the contract: off-thread generation
    // is a latency optimisation and every caller keeps a main-thread path, so
    // an environment without workers must get null rather than a throw.
    expect(typeof Worker).toBe('undefined');
    expect(zoneBuildPool()).toBeNull();
  });
});

// The water sheets' shore attributes ride the same worker. Same hazard as the
// geometry above: a second route to the same numbers can drift (a swapped
// depth/slope pair, a seed dropped off the request, the grid walked in the
// wrong axis order), and the result would be foam and shallow tint landing in
// different places depending on which thread baked the sheet.
describe('off-thread water fill matches the main thread', () => {
  const SEED = 20061;

  /** A small synthetic grid straddling a coastline, walked exactly the way
   *  water.ts walks a sheet's position attribute (row major). */
  function coordinateGrid(): { x: Float32Array; z: Float32Array } {
    const columns = 7;
    const rows = 5;
    const x = new Float32Array(columns * rows);
    const z = new Float32Array(columns * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const i = r * columns + c;
        x[i] = -84 + c * 13.5;
        z[i] = 306 + r * 11.25;
      }
    }
    return { x, z };
  }

  it('produces identical shore depth and slope for the same coordinates', () => {
    const grid = coordinateGrid();
    const job: WaterFillRequest = { kind: 'water-fill', id: 1, ...grid, seed: SEED };
    const viaWorker = buildWaterFillArrays(job);

    // The main-thread route, spelled out, so this is not a self-comparison.
    const shoreDepth = new Float32Array(grid.x.length);
    const shoreSlope = new Float32Array(grid.x.length);
    for (let i = 0; i < grid.x.length; i++) {
      shoreDepth[i] = shoreDepthAt(grid.x[i], grid.z[i], SEED);
      shoreSlope[i] = shoreSlopeAt(grid.x[i], grid.z[i], SEED);
    }

    expect(viaWorker.shoreDepth).toEqual(shoreDepth);
    expect(viaWorker.shoreSlope).toEqual(shoreSlope);
    // ...and the sample is actually doing something: a flat constant would
    // satisfy the comparison above.
    expect(new Set(Array.from(viaWorker.shoreDepth)).size).toBeGreaterThan(1);
    expect(new Set(Array.from(viaWorker.shoreSlope)).size).toBeGreaterThan(1);
  });

  it('samples the coordinates it is given, not a grid it re-derives', () => {
    const grid = coordinateGrid();
    const shifted = Float32Array.from(grid.x, (v) => v + 40);
    const here = buildWaterFillArrays({ kind: 'water-fill', id: 1, ...grid, seed: SEED });
    const there = buildWaterFillArrays({
      kind: 'water-fill',
      id: 2,
      x: shifted,
      z: grid.z,
      seed: SEED,
    });
    expect(Array.from(there.shoreDepth)).not.toEqual(Array.from(here.shoreDepth));
    for (let i = 0; i < shifted.length; i++) {
      // fround: the arrays are Float32, the reference sample is a double.
      expect(there.shoreDepth[i]).toBe(Math.fround(shoreDepthAt(shifted[i], grid.z[i], SEED)));
    }
  });

  it('carries the seed on the request rather than assuming one', () => {
    const grid = coordinateGrid();
    const a = buildWaterFillArrays({ kind: 'water-fill', id: 1, ...grid, seed: SEED });
    const b = buildWaterFillArrays({ kind: 'water-fill', id: 2, ...grid, seed: SEED + 7 });
    expect(Array.from(b.shoreDepth)).not.toEqual(Array.from(a.shoreDepth));
  });
});

// Node has no module Worker, so both describes below stand up a minimal stub:
// the pool only ever constructs one, assigns onmessage/onerror, posts to it and
// terminates it, which is exactly this surface. Without the stub every arm
// would be satisfied by "there is no Worker here" and prove nothing.
class FakeWorker {
  static spawned: FakeWorker[] = [];
  static reset(): void {
    FakeWorker.spawned = [];
  }
  terminated = 0;
  onmessage: unknown = null;
  onerror: unknown = null;
  constructor() {
    FakeWorker.spawned.push(this);
  }
  posted: { id: number; kind: string }[] = [];
  postMessage(message: unknown): void {
    this.posted.push(message as { id: number; kind: string });
  }
  terminate(): void {
    this.terminated++;
  }
}

function useFakeWorkers(): void {
  beforeEach(() => {
    // zoneBuildPool memoizes, and the workerless arm above already cached a
    // null: without this the stubbed spawn would never be attempted.
    disposeZoneBuildPool();
    FakeWorker.reset();
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    disposeZoneBuildPool();
    setActiveWorldContent(null);
    vi.unstubAllGlobals();
  });
}

describe('zoneBuildPool custom-world guard', () => {
  useFakeWorkers();

  it('hands out the pool on the built-in world, refuses it under a custom one, and recovers', () => {
    // Positive control first: with workers available the accessor really does
    // spawn a pool, so the null below can only be the custom-world guard.
    expect(isBuiltinWorldActive()).toBe(true);
    expect(zoneBuildPool()).not.toBeNull();
    expect(FakeWorker.spawned.length).toBeGreaterThan(0);

    // A worker samples its own module copy of the content (the built-in
    // world), so the accessor must force the main-thread fallback here.
    setActiveWorldContent({ zones: [], spawns: [] } as never);
    expect(isBuiltinWorldActive()).toBe(false);
    const spawnedBefore = FakeWorker.spawned.length;
    expect(zoneBuildPool()).toBeNull();
    // The guard short-circuits: it must not spawn a pool it then withholds.
    expect(FakeWorker.spawned.length).toBe(spawnedBefore);

    setActiveWorldContent(null);
    expect(isBuiltinWorldActive()).toBe(true);
    expect(zoneBuildPool()).not.toBeNull();
  });

  it('guards the accessor itself, not a call site (source pin)', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../src/render/zone_build_pool.ts'),
      'utf8',
    );
    const accessor = source.slice(source.indexOf('export function zoneBuildPool'));
    expect(accessor).toContain('if (!isBuiltinWorldActive()) return null;');
    expect(accessor.indexOf('isBuiltinWorldActive')).toBeLessThan(
      accessor.indexOf('createZoneBuildPool'),
    );
  });
});

// The pool is a process-wide singleton every view shares, and cancelStreaming
// disposes it: if dispose forgot to terminate its workers they would outlive
// the renderer, and if the accessor kept handing back the disposed pool the
// next zone build would submit into a dead one.
describe('zoneBuildPool singleton lifecycle', () => {
  useFakeWorkers();

  it('memoizes one pool, terminates its workers on dispose, and spawns a fresh one after', () => {
    const first = zoneBuildPool();
    expect(first).not.toBeNull();
    expect(zoneBuildPool()).toBe(first);
    const beforeDispose = [...FakeWorker.spawned];
    expect(beforeDispose.length).toBeGreaterThan(0);
    for (const worker of beforeDispose) expect(worker.terminated).toBe(0);

    disposeZoneBuildPool();
    for (const worker of beforeDispose) expect(worker.terminated).toBe(1);

    const second = zoneBuildPool();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(FakeWorker.spawned.length).toBeGreaterThan(beforeDispose.length);
  });
});

describe('zoneBuildPool urgent lane', () => {
  useFakeWorkers();

  it('an urgent claimant jumps queued background work once a worker frees up', async () => {
    const pool = zoneBuildPool();
    expect(pool).not.toBeNull();
    if (!pool) return;
    const workers = FakeWorker.spawned.length;
    const chunkJob = {
      x0: 0,
      z0: 0,
      size: 30,
      spacing: 1,
      seed: 1,
      withSplat: false,
      skirtSpan: 0,
      lowShade: false,
    };
    // Saturate every worker with background chunk jobs that never respond.
    for (let i = 0; i < workers; i++) void pool.buildChunk({ ...chunkJob });
    await Promise.resolve();
    const postedBefore = FakeWorker.spawned.reduce((n, w) => n + w.posted.length, 0);
    expect(postedBefore).toBe(workers);
    // Queue a background water fill FIRST, then an urgent chunk.
    void pool.fillWater({ x: new Float32Array(1), z: new Float32Array(1), seed: 1 });
    void pool.buildChunk({ ...chunkJob }, { urgent: true });
    await Promise.resolve();
    // Free one worker: its queued-in-front URGENT claimant must get it, so the
    // next posted job is the chunk, not the earlier-queued water fill.
    const first = FakeWorker.spawned[0];
    const firstId = first.posted[0].id;
    (first.onmessage as (e: { data: unknown }) => void)({
      data: { id: firstId, kind: 'chunk', ok: false, error: 'freed for the test' },
    });
    await Promise.resolve();
    await Promise.resolve();
    // The freed worker (and only it) got a new job, and that job is the
    // URGENT chunk, not the earlier-queued water fill.
    expect(FakeWorker.spawned.reduce((n, w) => n + w.posted.length, 0)).toBe(workers + 1);
    expect(first.posted.length).toBe(2);
    expect(first.posted[1].kind).toBe('chunk');
  });
});

// A worker can die outright: its module fails to load (a stale hashed URL after
// a deploy, a blocked CSP, a mobile OOM kill), it fires onerror once, and from
// then on every postMessage is swallowed in silence. Handing such a worker
// another job leaves that job's promise unsettled forever, and the gating
// terrain lane awaits it: the loading screen, the world-draw hold and input
// stay stuck for the rest of the session. So a failed worker must be retired,
// and a pool with no live worker left must DECLINE rather than park.
const CHUNK_JOB = {
  x0: 0,
  z0: 0,
  size: 30,
  spacing: 1,
  seed: 1,
  withSplat: false,
  skirtSpan: 0,
  lowShade: false,
};

/** A minimal ok chunk response for a given job id: buildChunk only copies the
 *  attribute fields across, so real geometry would prove nothing extra here. */
function okChunk(id: number): { data: unknown } {
  return {
    data: {
      id,
      kind: 'chunk',
      ok: true,
      positions: new Float32Array(3),
      normals: new Float32Array(3),
      colors: new Float32Array(3),
      uvs: new Float32Array(2),
      splats: null,
      extras: null,
      indices: new Uint32Array(3),
    },
  };
}

function feed(worker: FakeWorker, message: { data: unknown }): void {
  (worker.onmessage as (event: { data: unknown }) => void)(message);
}

function fail(worker: FakeWorker): void {
  (worker.onerror as () => void)();
}

describe('zoneBuildPool worker failure', () => {
  useFakeWorkers();
  beforeEach(() => {
    // Pin the pool to three workers: the isolation arm needs more than one,
    // and hardwareConcurrency is whatever the test host happens to have.
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
  });

  it('retires the failed worker only, and declines once every worker is dead', async () => {
    const pool = zoneBuildPool();
    expect(pool).not.toBeNull();
    if (!pool) return;
    const workers = FakeWorker.spawned;
    expect(workers.length).toBe(3);

    const jobs = workers.map(() => pool.buildChunk({ ...CHUNK_JOB }));
    await Promise.resolve();
    expect(workers.map((w) => w.posted.length)).toEqual([1, 1, 1]);

    // One worker dies. Only ITS in-flight job fails.
    const deadId = workers[0].posted[0].id;
    fail(workers[0]);
    expect(await jobs[0]).toBeNull();

    // A response arriving from the retired worker must not resurrect it.
    feed(workers[0], okChunk(deadId));

    // The healthy workers' jobs are untouched and still complete.
    feed(workers[1], okChunk(workers[1].posted[0].id));
    expect(await jobs[1]).not.toBeNull();

    // The freed HEALTHY worker takes the next job; the dead one never does.
    const next = pool.buildChunk({ ...CHUNK_JOB });
    await Promise.resolve();
    await Promise.resolve();
    expect(workers.map((w) => w.posted.length)).toEqual([1, 2, 1]);

    // With one worker dead and two busy, this claimant parks.
    const parked = pool.buildChunk({ ...CHUNK_JOB });
    await Promise.resolve();
    expect(workers.map((w) => w.posted.length)).toEqual([1, 2, 1]);

    // The last two die: every outstanding job resolves null, including the
    // claimant that was already parked (nothing can ever wake it otherwise).
    fail(workers[1]);
    fail(workers[2]);
    expect(await next).toBeNull();
    expect(await jobs[2]).toBeNull();
    expect(await parked).toBeNull();

    // And a fresh submission into the all-dead pool declines promptly instead
    // of hanging, without posting into any corpse.
    expect(await pool.buildChunk({ ...CHUNK_JOB })).toBeNull();
    expect(workers.map((w) => w.posted.length)).toEqual([1, 2, 1]);
  });
});

describe('zoneBuildPool single-worker recovery', () => {
  useFakeWorkers();
  beforeEach(() => {
    // hardwareConcurrency 2 leaves the main thread a core, so the pool spawns
    // exactly one worker: that pins "the SAME worker takes the next job".
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
  });

  it('a throwing postMessage fails just that job and leaves the worker usable', async () => {
    const pool = zoneBuildPool();
    expect(pool).not.toBeNull();
    if (!pool) return;
    expect(FakeWorker.spawned.length).toBe(1);
    const worker = FakeWorker.spawned[0];
    const accept = worker.postMessage.bind(worker);
    let threw = false;
    worker.postMessage = (message: unknown): void => {
      if (!threw) {
        threw = true;
        throw new Error('detached transferable');
      }
      accept(message);
    };

    expect(await pool.buildChunk({ ...CHUNK_JOB })).toBeNull();
    expect(threw).toBe(true);
    expect(worker.posted).toHaveLength(0);

    // The worker never received that job, so it is healthy: it must not be
    // left busy, or every later job would park on a worker that is idle.
    const next = pool.buildChunk({ ...CHUNK_JOB });
    await Promise.resolve();
    await Promise.resolve();
    expect(worker.posted).toHaveLength(1);
    feed(worker, okChunk(worker.posted[0].id));
    expect(await next).not.toBeNull();
  });

  it('a stale response does not free a worker that already carries a newer job', async () => {
    const pool = zoneBuildPool();
    expect(pool).not.toBeNull();
    if (!pool) return;
    const worker = FakeWorker.spawned[0];

    const inFlight = pool.buildChunk({ ...CHUNK_JOB });
    await Promise.resolve();
    expect(worker.posted).toHaveLength(1);
    const liveId = worker.posted[0].id;

    // A reply for a job this worker no longer owns must not clear its busy
    // flag: the live job is still running, and a second post would race it.
    feed(worker, okChunk(liveId + 1000));
    const queued = pool.buildChunk({ ...CHUNK_JOB });
    await Promise.resolve();
    await Promise.resolve();
    expect(worker.posted).toHaveLength(1);

    // The worker's own answer frees it, and the queued job goes out then.
    feed(worker, okChunk(liveId));
    expect(await inFlight).not.toBeNull();
    await Promise.resolve();
    expect(worker.posted).toHaveLength(2);
    feed(worker, okChunk(worker.posted[1].id));
    expect(await queued).not.toBeNull();
  });
});
