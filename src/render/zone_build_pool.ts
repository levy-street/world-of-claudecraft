// Main-thread half of off-thread zone building: a small worker pool that hands
// out terrain-chunk and water-fill jobs and returns raw typed arrays.
//
// ONE pool for the whole client, shared by terrain.ts and water.ts. Both build
// the same zone at the same moment, so a second pool would only bid against
// this one for the same cores. Hence the lazy singleton below rather than a
// pool per view.
//
// Deliberately FALLIBLE and optional. zoneBuildPool() returns null wherever
// module workers are unavailable (Node under Vitest, an old WebView, a blocked
// CSP), and every caller keeps its existing main-thread path for exactly that
// case. Off-thread generation is a latency optimisation, never a requirement:
// the results are identical either way, which
// tests/terrain_chunk_geometry.test.ts and tests/terrain_chunk_worker.test.ts pin.
//
// Sizing: this work is pure arithmetic, so it scales with cores, but the main
// thread still has to upload the results, and starving it helps nobody. Hence
// a small cap rather than hardwareConcurrency.

import { isBuiltinWorldActive } from '../sim/data';
import type { ChunkGeometryArrays } from './terrain_chunk_build';
import type {
  TerrainChunkRequest,
  WaterFillArrays,
  WaterFillRequest,
  ZoneBuildRequest,
  ZoneBuildResponse,
} from './zone_build_worker';

const MAX_WORKERS = 3;

export interface ZoneBuildPool {
  /** Resolves with the chunk's arrays, or null if the worker failed and the
   *  caller should build it on the main thread instead. `urgent` puts the job
   *  ahead of queued background work: a gating caller (a blocking arrival's
   *  loading screen) must not wait behind idle neighbour prepares. */
  buildChunk(
    job: Omit<TerrainChunkRequest, 'id' | 'kind'>,
    opts?: { urgent?: boolean },
  ): Promise<ChunkGeometryArrays | null>;
  /** Resolves with the sheet's shore attributes, or null if the worker failed
   *  and the caller should bake them on the main thread instead. The coordinate
   *  arrays are TRANSFERRED, so the caller must hand over arrays it built for
   *  this job and not read them afterwards. */
  fillWater(
    job: Omit<WaterFillRequest, 'id' | 'kind'>,
    opts?: { urgent?: boolean },
  ): Promise<WaterFillArrays | null>;
  /** How many jobs can be in flight before a submission starts queueing. */
  readonly size: number;
  dispose(): void;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
  /** The one job this worker is running, so a worker-level error (which has no
   *  job id of its own) fails only that job, never the other workers' pending
   *  ones. */
  currentId: number | null;
  /** Retired by a worker-level error. A worker whose module failed to load (a
   *  stale hashed URL after a deploy, a blocked CSP, a mobile OOM kill) fires
   *  onerror once and then swallows every later postMessage in silence, so
   *  handing it another job would leave that job's promise unsettled forever
   *  and hang the gating arrival that awaits it. */
  dead: boolean;
}

function spawn(): Worker | null {
  try {
    return new Worker(new URL('./zone_build_worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

export function createZoneBuildPool(): ZoneBuildPool | null {
  if (typeof Worker === 'undefined') return null;
  const first = spawn();
  if (!first) return null;

  const hardware =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 2;
  // Leave the main thread a core: it still uploads every result.
  const target = Math.max(1, Math.min(MAX_WORKERS, hardware - 1));
  const workers: PoolWorker[] = [{ worker: first, busy: false, currentId: null, dead: false }];
  for (let i = 1; i < target; i++) {
    const worker = spawn();
    if (worker) workers.push({ worker, busy: false, currentId: null, dead: false });
  }

  const pending = new Map<number, (response: ZoneBuildResponse) => void>();
  const waiting: (() => void)[] = [];
  let nextId = 1;
  let disposed = false;

  const allDead = (): boolean => workers.every((entry) => entry.dead);

  const retire = (entry: PoolWorker): void => {
    entry.dead = true;
    entry.busy = false;
    entry.currentId = null;
    // A retired worker frees no capacity, so waking one parked claimant would
    // only make it re-park. Once the LAST worker goes, though, every parked
    // claimant has to be woken: their wake can never come from a completion
    // now, and claim() answers null on the re-check.
    if (allDead()) {
      while (waiting.length > 0) waiting.shift()?.();
    }
  };

  for (const entry of workers) {
    entry.worker.onmessage = (event: MessageEvent<ZoneBuildResponse>) => {
      const resolve = pending.get(event.data.id);
      pending.delete(event.data.id);
      // The response is its own job's answer whatever the worker's state, but
      // only the job the worker STILL carries frees it: a late reply for a job
      // already failed by onerror (or never posted, see submit) would otherwise
      // free a worker that has since taken a newer one, and a reply from a
      // retired worker would resurrect it.
      if (!entry.dead && entry.currentId === event.data.id) {
        entry.busy = false;
        entry.currentId = null;
        waiting.shift()?.();
      }
      resolve?.(event.data);
    };
    entry.worker.onerror = () => {
      // A worker-level error carries no job id, so fail THIS worker's one
      // in-flight job (tracked on the entry); the other workers' pending jobs
      // are healthy and must not be force-failed onto the main-thread path.
      const id = entry.currentId;
      retire(entry);
      if (id !== null) {
        const resolve = pending.get(id);
        pending.delete(id);
        resolve?.({ id, ok: false, error: 'zone build worker error' });
      }
    };
  }

  const claim = async (urgent: boolean): Promise<PoolWorker | null> => {
    for (;;) {
      if (disposed) return null;
      const free = workers.find((entry) => !entry.busy && !entry.dead);
      if (free) {
        free.busy = true;
        return free;
      }
      // Every worker retired: no completion can ever wake a claimant again, so
      // decline here and let the caller take its main-thread path instead of
      // parking on a promise nothing will settle.
      if (allDead()) return null;
      await new Promise<void>((resolve) => {
        // Urgent claimants (a gating arrival) go to the FRONT: the pool is
        // otherwise FIFO, and a teleport's chunks queueing behind three idle
        // neighbour water fills would extend the loading screen by exactly
        // the seconds this pool exists to remove.
        if (urgent) waiting.unshift(resolve);
        else waiting.push(resolve);
      });
    }
  };

  const submit = async (
    job: Omit<TerrainChunkRequest, 'id'> | Omit<WaterFillRequest, 'id'>,
    transfer?: Transferable[],
    urgent = false,
  ): Promise<ZoneBuildResponse | null> => {
    const entry = await claim(urgent);
    if (!entry) return null;
    const id = nextId++;
    entry.currentId = id;
    return await new Promise<ZoneBuildResponse>((resolve) => {
      pending.set(id, resolve);
      try {
        entry.worker.postMessage({ ...job, id } as ZoneBuildRequest, transfer ?? []);
      } catch (error) {
        // A throwing post (a detached transferable, a clone failure) must not
        // retire the worker: it never received the job.
        pending.delete(id);
        entry.busy = false;
        entry.currentId = null;
        waiting.shift()?.();
        resolve({ id, ok: false, error: String(error) });
      }
    });
  };

  return {
    size: workers.length,
    async buildChunk(job, opts): Promise<ChunkGeometryArrays | null> {
      const response = await submit({ ...job, kind: 'chunk' }, undefined, opts?.urgent === true);
      if (!response?.ok || response.kind !== 'chunk') return null;
      return {
        positions: response.positions,
        normals: response.normals,
        colors: response.colors,
        uvs: response.uvs,
        splats: response.splats,
        extras: response.extras,
        indices: response.indices,
      };
    },
    async fillWater(job, opts): Promise<WaterFillArrays | null> {
      const response = await submit(
        { ...job, kind: 'water-fill' },
        [job.x.buffer, job.z.buffer],
        opts?.urgent === true,
      );
      if (!response?.ok || response.kind !== 'water-fill') return null;
      return { shoreDepth: response.shoreDepth, shoreSlope: response.shoreSlope };
    },
    dispose(): void {
      disposed = true;
      for (const entry of workers) entry.worker.terminate();
      // Release anything still parked on claim(), so a disposed view's build
      // loop unwinds instead of hanging on a promise nothing will settle.
      while (waiting.length > 0) waiting.shift()?.();
      for (const [id, resolve] of [...pending]) {
        pending.delete(id);
        resolve({ id, ok: false, error: 'pool disposed' });
      }
    },
  };
}

let shared: ZoneBuildPool | null | undefined;

/** The one pool, spawned on first use. Null where module workers are
 *  unavailable, and the null is remembered so a workerless host does not retry
 *  the spawn per chunk. */
export function zoneBuildPool(): ZoneBuildPool | null {
  // A custom world (editor play-test) lives in THIS thread's module state; a
  // worker samples its own copy of the content, which is always the built-in
  // world, so it would bake the wrong ground and shorelines. Fall back to the
  // main-thread paths while one is active (the spawned pool is kept for the
  // return to the built-in world). Acquisition-time only: a swap landing after
  // a job was posted still bakes the built-in world, so the editor must swap
  // BEFORE it builds, which its play-test entry does.
  if (!isBuiltinWorldActive()) return null;
  if (shared === undefined) shared = createZoneBuildPool();
  return shared;
}

/** Tears the pool down (the terrain view's cancelStreaming, i.e. a renderer
 *  teardown or a graphics rebuild) and forgets it, so the next zone build
 *  spawns a fresh one instead of finding a permanently disposed pool. */
export function disposeZoneBuildPool(): void {
  // Also forgets a remembered null: a dispose happens on a renderer teardown
  // or graphics rebuild, so a workerless host retries the spawn once per
  // rebuild, never per zone (the memo above covers the per-zone case).
  shared?.dispose();
  shared = undefined;
}
