import { describe, expect, it } from 'vitest';
import {
  beginChunkGeometry,
  fillChunkIndexRow,
  fillChunkVertexRow,
} from '../src/render/terrain_chunk_build';
import { terrainChunkPool } from '../src/render/terrain_chunk_pool';
import { buildChunkArrays, type TerrainChunkRequest } from '../src/render/terrain_chunk_worker';

// The worker's entry point is a SECOND route to the same geometry, so it can
// drift from the main-thread one: drop an index row, mis-order the fills, miss
// a field off the response. Then chunks would render differently depending on
// which thread happened to build them, which no screenshot would reliably
// catch. These compare the two routes directly.

const JOB: TerrainChunkRequest = {
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
    expect(terrainChunkPool()).toBeNull();
  });
});
