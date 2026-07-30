import { afterEach, describe, expect, it, vi } from 'vitest';
import { RiftAssetCoordinator, riftAssetConfigFromEnv } from '../../server/rift_assets';
import { BUILTIN_WORLD } from '../../src/sim/data';
import { spawnNaturalRiftPortal } from '../../src/sim/rift/portals';
import { Sim } from '../../src/sim/sim';

afterEach(() => vi.unstubAllGlobals());

describe('optional runtime Rift asset bridge', () => {
  it('is opt-in and records only an opaque generation job', async () => {
    expect(
      riftAssetConfigFromEnv({ RIFT_ASSET_PIPELINE_URL: 'https://assets.invalid' }),
    ).toBeNull();
    const config = riftAssetConfigFromEnv({
      RIFT_RUNTIME_ASSETS: '1',
      RIFT_ASSET_PIPELINE_URL: 'https://assets.invalid/jobs',
    })!;
    const sim = new Sim({
      seed: 821,
      playerClass: 'warrior',
      noPlayer: true,
      riftPortals: true,
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    spawnNaturalRiftPortal(sim.ctx, 0);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ jobId: 'tripo:job-42' }), { status: 200 })),
    );
    const coordinator = new RiftAssetCoordinator(config);
    coordinator.observe(sim.ctx);
    expect(sim.riftEvents[0].assetPipeline.status).toBe('pending');
    await vi.waitFor(() => {
      coordinator.drain(sim.ctx);
      expect(sim.riftEvents[0].assetPipeline.status).toBe('queued');
    });
    expect(sim.riftEvents[0].assetPipeline.jobId).toBe('tripo:job-42');
  });
});
