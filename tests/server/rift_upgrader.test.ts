import { afterEach, describe, expect, it, vi } from 'vitest';
import { RiftUpgradeCoordinator, riftUpgraderConfigFromEnv } from '../../server/rift_upgrader';
import { BUILTIN_WORLD } from '../../src/sim/data';
import { spawnNaturalRiftPortal } from '../../src/sim/rift/portals';
import { Sim } from '../../src/sim/sim';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeSim(): Sim {
  return new Sim({
    seed: 551,
    playerClass: 'warrior',
    noPlayer: true,
    riftPortals: true,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
}

describe('server Rift AI upgrader', () => {
  it('is disabled unless a complete provider configuration is present', () => {
    expect(riftUpgraderConfigFromEnv({})).toBeNull();
    expect(riftUpgraderConfigFromEnv({ OPENAI_API_KEY: 'secret' })).toBeNull();
    expect(
      riftUpgraderConfigFromEnv({
        OPENAI_API_KEY: 'secret',
        RIFT_UPGRADER_MODEL: 'configured-model',
      }),
    ).toEqual(expect.objectContaining({ provider: 'openai', model: 'configured-model' }));
  });

  it('applies a dedicated-service result only when drained at a tick boundary', async () => {
    const sim = makeSim();
    spawnNaturalRiftPortal(sim.ctx, 0);
    const event = sim.riftEvents[0];
    const upgraded = structuredClone(event.upgrade!);
    upgraded.title = `${upgraded.title} Reforged`;
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(upgraded), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const coordinator = new RiftUpgradeCoordinator({
      provider: 'dedicated',
      url: 'https://upgrader.invalid/rifts',
      apiKey: 'not-logged',
      timeoutMs: 5_000,
      maxRequestsPerHour: 4,
    });

    coordinator.observe(sim.ctx);
    expect(event.upgradeStatus).toBe('pending');
    expect(event.riftName).not.toContain('Reforged');
    await vi.waitFor(() => {
      coordinator.drain(sim.ctx);
      expect(event.upgradeStatus).toBe('ready');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(event.riftName).toContain('Reforged');
    expect(event.contentLocked).toBe(false);
  });
});
