// Main-thread half of off-thread terrain generation: a small worker pool that
// hands out chunk-geometry jobs and returns raw typed arrays.
//
// Deliberately FALLIBLE and optional. terrainChunkPool() returns null wherever
// module workers are unavailable (Node under Vitest, an old WebView, a blocked
// CSP), and every caller keeps its existing main-thread path for exactly that
// case. Off-thread generation is a latency optimisation, never a requirement:
// the geometry is identical either way, which tests/terrain_chunk_geometry.test.ts
// pins.
//
// Sizing: chunk generation is pure arithmetic, so it scales with cores, but the
// main thread still has to upload the results, and starving it helps nobody.
// Hence a small cap rather than hardwareConcurrency.

import type { ChunkGeometryArrays } from './terrain_chunk_build';
import type { TerrainChunkRequest, TerrainChunkResponse } from './terrain_chunk_worker';

const MAX_WORKERS = 3;

export interface TerrainChunkPool {
  /** Resolves with the chunk's arrays, or null if the worker failed and the
   *  caller should build it on the main thread instead. */
  build(job: Omit<TerrainChunkRequest, 'id'>): Promise<ChunkGeometryArrays | null>;
  /** How many jobs can be in flight before build() starts queueing. */
  readonly size: number;
  dispose(): void;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
}

function spawn(): Worker | null {
  try {
    return new Worker(new URL('./terrain_chunk_worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

export function terrainChunkPool(): TerrainChunkPool | null {
  if (typeof Worker === 'undefined') return null;
  const first = spawn();
  if (!first) return null;

  const hardware =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 2;
  // Leave the main thread a core: it still uploads every result.
  const target = Math.max(1, Math.min(MAX_WORKERS, hardware - 1));
  const workers: PoolWorker[] = [{ worker: first, busy: false }];
  for (let i = 1; i < target; i++) {
    const worker = spawn();
    if (worker) workers.push({ worker, busy: false });
  }

  const pending = new Map<number, (response: TerrainChunkResponse) => void>();
  const waiting: (() => void)[] = [];
  let nextId = 1;
  let disposed = false;

  for (const entry of workers) {
    entry.worker.onmessage = (event: MessageEvent<TerrainChunkResponse>) => {
      const resolve = pending.get(event.data.id);
      pending.delete(event.data.id);
      entry.busy = false;
      resolve?.(event.data);
      waiting.shift()?.();
    };
    entry.worker.onerror = () => {
      // A worker-level error has no job id, so fail every job it could have
      // been running rather than leaking the promises.
      entry.busy = false;
      for (const [id, resolve] of [...pending]) {
        pending.delete(id);
        resolve({ id, ok: false, error: 'terrain chunk worker error' });
      }
      waiting.shift()?.();
    };
  }

  const claim = async (): Promise<PoolWorker | null> => {
    for (;;) {
      if (disposed) return null;
      const free = workers.find((entry) => !entry.busy);
      if (free) {
        free.busy = true;
        return free;
      }
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
  };

  return {
    size: workers.length,
    async build(job): Promise<ChunkGeometryArrays | null> {
      const entry = await claim();
      if (!entry) return null;
      const id = nextId++;
      const response = await new Promise<TerrainChunkResponse>((resolve) => {
        pending.set(id, resolve);
        entry.worker.postMessage({ ...job, id } satisfies TerrainChunkRequest);
      });
      if (!response.ok) return null;
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
