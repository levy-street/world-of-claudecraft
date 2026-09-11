// Generates a zone's heavy per-vertex arithmetic off the main thread: terrain
// chunk geometry, and the water sheets' shore-attribute bake.
//
// The whole point: producing a zone's geometry is 2 to 4 seconds of pure
// arithmetic, but on the main thread it has to yield constantly or it eats
// frames, which stretched it to 60 to 105 (Frostveil measured terrainMs 3914
// gating vs 85523 idle, the same geometry). Here nothing competes with a frame,
// so it runs flat out and the outdoor fog clamp stops waiting on it. The water
// fill is the same shape of cost (a 181x181 grid of shoreDepthAt/shoreSlopeAt,
// measured at 1.3 to 1.7 s per sheet on an Intel iGPU box) and rides the same
// worker rather than a second pool that would fight this one for cores.
//
// Imports ONLY terrain_chunk_build and water_core, which are Three-maths plus
// src/sim. Nothing here may reach for gfx.ts: it reads document/navigator and
// would resolve a DIFFERENT graphics tier in a worker, silently shading chunks
// two ways depending on which thread built them. The tier arrives on the
// request as `lowShade` instead.

import { setActiveWorldContent } from '../sim/data';
import type { TerrainCut, WorldContent } from '../sim/types';
import {
  beginChunkGeometry,
  buildChunkCutFine,
  type ChunkGeometryArrays,
  fillChunkIndexRow,
  fillChunkVertexRow,
} from './terrain_chunk_build';
import { shoreDepthAt, shoreDepthAttribute, shoreSlopeAt } from './water_core';

/**
 * The active world content, shipped to the worker so its copy of src/sim reads
 * the SAME world the main thread does.
 *
 * A worker gets its own module instances, so `getActiveWorldContent()` there
 * answers with the built-in world no matter what the editor loaded. Every
 * content-dependent term the mesher reaches through world.ts then silently
 * reverts: the height stamps an author sculpted (applyEditLayer), the zone
 * biome, the roads, the water level, the biome paint. On a custom map that
 * renders the UNEDITED world under correctly-placed props — a flat sea floor
 * with a town floating over it (the Goldcrest report). The pool sends this
 * before the first job and again whenever the content generation moves.
 */
export interface TerrainWorldContentMessage {
  kind: 'content';
  generation: number;
  /**
   * null = the built-in world, and it must stay null rather than a copy of it.
   * Several readers (data.ts activeZoneList, and the zone x-bounds it feeds)
   * tell the shipped world from an authored one by OBJECT IDENTITY, so a
   * structured clone of BUILTIN_WORLD would read as a custom map and re-bound
   * its zones. Passing null lets the worker restore its own instance.
   */
  content: WorldContent | null;
}

export interface TerrainChunkRequest {
  kind: 'chunk';
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
  /** Boolean terrain cuts and the patches that undo them, resolved by the main
   *  thread off the ACTIVE content (the worker has no world content of its
   *  own). Plain data, so postMessage structured-clones them; a map with no
   *  cuts sends nothing and the mesher keeps its old fast path. */
  cuts?: readonly TerrainCut[];
  cutPatches?: readonly TerrainCut[];
}

/** The sheet's vertex positions travel EXPLICITLY rather than being re-derived
 *  here from the rect: the caller reads them off the geometry it already built,
 *  so both threads sample the identical coordinates bit for bit. */
export interface WaterFillRequest {
  kind: 'water-fill';
  id: number;
  x: Float32Array;
  z: Float32Array;
  seed: number;
}

// FORK: the pool also ships the active world's content ahead of a job (see
// TerrainWorldContentMessage above), so the worker meshes the SAME world.
export type ZoneBuildRequest = TerrainChunkRequest | WaterFillRequest | TerrainWorldContentMessage;

export interface WaterFillArrays {
  shoreDepth: Float32Array;
  shoreSlope: Float32Array;
}

export type ZoneBuildResponse =
  | ({ id: number; ok: true; kind: 'chunk' } & ChunkGeometryArrays)
  | ({ id: number; ok: true; kind: 'water-fill' } & WaterFillArrays)
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
  if (arrays.rim) {
    buffers.push(
      arrays.rim.positions.buffer,
      arrays.rim.normals.buffer,
      arrays.rim.uvs.buffer,
      arrays.rim.indices.buffer,
    );
  }
  if (arrays.clip) {
    buffers.push(
      arrays.clip.positions.buffer,
      arrays.clip.normals.buffer,
      arrays.clip.colors.buffer,
      arrays.clip.uvs.buffer,
      arrays.clip.indices.buffer,
    );
    if (arrays.clip.splats) buffers.push(arrays.clip.splats.buffer);
    if (arrays.clip.extras) buffers.push(arrays.clip.extras.buffer);
  }
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
    job.cuts && job.cuts.length > 0 ? { cuts: job.cuts, patches: job.cutPatches } : null,
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
    ...buildChunkCutFine(state),
  };
}

export function buildWaterFillArrays(job: WaterFillRequest): WaterFillArrays {
  const count = Math.min(job.x.length, job.z.length);
  const shoreDepth = new Float32Array(count);
  const shoreSlope = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    shoreDepth[i] = shoreDepthAttribute(shoreDepthAt(job.x[i], job.z[i], job.seed));
    shoreSlope[i] = shoreSlopeAt(job.x[i], job.z[i], job.seed);
  }
  return { shoreDepth, shoreSlope };
}

// A minimal structural view of the worker scope, NOT lib="webworker". A
// triple-slash reference to that lib merges its globals across the whole
// project and starts redefining shared names like addEventListener, which
// broke an unrelated DOM test the moment this file was added.
interface ZoneBuildWorkerScope {
  onmessage: ((event: MessageEvent<ZoneBuildRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

// Bind ONLY inside a real worker. `self` is also the window on the main
// thread, so an unguarded assignment would install a message handler on the
// page; and in Node (Vitest importing buildChunkArrays for the equivalence
// tests) `self` does not exist at all and the bare assignment threw on import.
const workerScope: ZoneBuildWorkerScope | null =
  typeof self !== 'undefined' && typeof document === 'undefined'
    ? (self as unknown as ZoneBuildWorkerScope)
    : null;

if (workerScope) {
  workerScope.onmessage = (event: MessageEvent<ZoneBuildRequest>) => {
    if (event.data.kind === 'content') {
      // No reply: the pool sends this immediately before the job that needs it,
      // on the same ordered channel, so the job cannot overtake it.
      setActiveWorldContent(event.data.content);
      return;
    }
    const job = event.data;
    try {
      if (job.kind === 'water-fill') {
        const filled = buildWaterFillArrays(job);
        workerScope.postMessage({ id: job.id, ok: true, kind: 'water-fill', ...filled }, [
          filled.shoreDepth.buffer,
          filled.shoreSlope.buffer,
        ]);
        return;
      }
      const arrays = buildChunkArrays(job);
      workerScope.postMessage(
        { id: job.id, ok: true, kind: 'chunk', ...arrays },
        transferListFor(arrays),
      );
    } catch (err) {
      // Never leave the pool waiting on a job that threw: the caller falls back
      // to building this one on the main thread.
      workerScope.postMessage({
        id: job.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies ZoneBuildResponse);
    }
  };
}
