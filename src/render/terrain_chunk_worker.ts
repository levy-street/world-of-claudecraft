// Generates one terrain chunk's geometry off the main thread.
//
// The whole point: producing a zone's geometry is 2 to 4 seconds of pure
// arithmetic, but on the main thread it has to yield constantly or it eats
// frames, which stretched it to 60 to 105 (Frostveil measured terrainMs 3914
// gating vs 85523 idle, the same geometry). Here nothing competes with a frame,
// so it runs flat out and the outdoor fog clamp stops waiting on it.
//
// Imports ONLY terrain_chunk_build, which is Three-maths plus src/sim. Nothing
// here may reach for gfx.ts: it reads document/navigator and would resolve a
// DIFFERENT graphics tier in a worker, silently shading chunks two ways
// depending on which thread built them. The tier arrives on the request as
// `lowShade` instead.

import {
  beginChunkGeometry,
  type ChunkGeometryArrays,
  fillChunkIndexRow,
  fillChunkVertexRow,
} from './terrain_chunk_build';

export interface TerrainChunkRequest {
  id: number;
  x0: number;
  z0: number;
  size: number;
  spacing: number;
  seed: number;
  withSplat: boolean;
  skirtSpan: number;
  /** Resolved by the main thread: see the note above about gfx.ts. */
  lowShade: boolean;
}

export type TerrainChunkResponse =
  | ({ id: number; ok: true } & ChunkGeometryArrays)
  | { id: number; ok: false; error: string };

/** Every buffer the response carries, so postMessage moves them instead of
 *  structured-cloning several megabytes per chunk. */
function transferListFor(arrays: ChunkGeometryArrays): Transferable[] {
  const buffers: Transferable[] = [
    arrays.positions.buffer,
    arrays.normals.buffer,
    arrays.colors.buffer,
    arrays.uvs.buffer,
    arrays.indices.buffer,
  ];
  if (arrays.splats) buffers.push(arrays.splats.buffer);
  if (arrays.extras) buffers.push(arrays.extras.buffer);
  return buffers;
}

export function buildChunkArrays(job: TerrainChunkRequest): ChunkGeometryArrays {
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
  return {
    positions: state.positions,
    normals: state.normals,
    colors: state.colors,
    uvs: state.uvs,
    splats: state.splats,
    extras: state.extras,
    indices: state.indices,
  };
}

// A minimal structural view of the worker scope, NOT lib="webworker". A
// triple-slash reference to that lib merges its globals across the whole
// project and starts redefining shared names like addEventListener, which
// broke an unrelated DOM test the moment this file was added.
interface TerrainWorkerScope {
  onmessage: ((event: MessageEvent<TerrainChunkRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

// Bind ONLY inside a real worker. `self` is also the window on the main
// thread, so an unguarded assignment would install a message handler on the
// page; and in Node (Vitest importing buildChunkArrays for the equivalence
// tests) `self` does not exist at all and the bare assignment threw on import.
const workerScope: TerrainWorkerScope | null =
  typeof self !== 'undefined' && typeof document === 'undefined'
    ? (self as unknown as TerrainWorkerScope)
    : null;

if (workerScope) {
  workerScope.onmessage = (event: MessageEvent<TerrainChunkRequest>) => {
    const job = event.data;
    try {
      const arrays = buildChunkArrays(job);
      workerScope.postMessage({ id: job.id, ok: true, ...arrays }, transferListFor(arrays));
    } catch (err) {
      // Never leave the pool waiting on a job that threw: the caller falls back
      // to building this chunk on the main thread.
      workerScope.postMessage({
        id: job.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies TerrainChunkResponse);
    }
  };
}
