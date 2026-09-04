// Behavioral pins for src/render/context_restore_core.ts: the in-place WebGL
// context restore coordinator that re-bakes every sampled-only render target
// the renderer owns (issue 3846). Pure core: runs in plain Node with a fake
// GPU work seam.
import { describe, expect, it, vi } from 'vitest';
import {
  type ContextRestoreRun,
  createContextRestoreCoordinator,
} from '../src/render/context_restore_core';

/** A queue that runs units immediately, recording the order and labels. */
function immediateRun(log: string[]): ContextRestoreRun {
  return async (id, work) => {
    log.push(id);
    await work();
  };
}

describe('context restore coordinator', () => {
  it('runs every registered producer through the host queue, in registration order', async () => {
    const coordinator = createContextRestoreCoordinator();
    const ran: string[] = [];
    const grass = vi.fn();
    const atlas = vi.fn(async () => {});
    coordinator.register('grass-ground-bake', grass);
    coordinator.register('foliage-impostor-atlas', atlas);
    const log: string[] = [];

    const outcome = await coordinator.restore((id, work) => {
      log.push(id);
      ran.push(id);
      return Promise.resolve().then(work);
    });

    expect(log).toEqual(['grass-ground-bake', 'foliage-impostor-atlas']);
    expect(grass).toHaveBeenCalledOnce();
    expect(atlas).toHaveBeenCalledOnce();
    expect(outcome).toEqual({
      generation: 1,
      restored: ['grass-ground-bake', 'foliage-impostor-atlas'],
      failed: [],
    });
    expect(coordinator.stats()).toEqual({
      restores: 1,
      restored: 2,
      failed: 0,
      pending: 0,
      lastFailedIds: [],
    });
  });

  it('isolates a failing producer: the others still re-bake and the failure is counted', async () => {
    const coordinator = createContextRestoreCoordinator();
    const boom = new Error('context still lost');
    const survivor = vi.fn();
    coordinator.register('environment-maps', () => {
      throw boom;
    });
    coordinator.register('grass-ground-bake', survivor);

    const outcome = await coordinator.restore(immediateRun([]));

    expect(survivor).toHaveBeenCalledOnce();
    expect(outcome.restored).toEqual(['grass-ground-bake']);
    expect(outcome.failed).toEqual([{ id: 'environment-maps', error: boom }]);
    expect(coordinator.stats()).toMatchObject({
      restores: 1,
      restored: 1,
      failed: 1,
      lastFailedIds: ['environment-maps'],
    });
  });

  it('counts a queue rejection (refused or shut down) as that producer failing', async () => {
    const coordinator = createContextRestoreCoordinator();
    const rebake = vi.fn();
    coordinator.register('foliage-impostor-atlas', rebake);

    const outcome = await coordinator.restore(() => Promise.reject(new Error('queue shut down')));

    expect(rebake).not.toHaveBeenCalled();
    expect(outcome.failed.map((f) => f.id)).toEqual(['foliage-impostor-atlas']);
    expect(coordinator.stats().failed).toBe(1);
  });

  it('a later restore re-runs the same producers and clears the last-failed set on success', async () => {
    const coordinator = createContextRestoreCoordinator();
    let attempts = 0;
    coordinator.register('environment-maps', () => {
      attempts++;
      if (attempts === 1) throw new Error('first restore raced a second loss');
    });

    const first = await coordinator.restore(immediateRun([]));
    const second = await coordinator.restore(immediateRun([]));

    expect(first.generation).toBe(1);
    expect(first.failed).toHaveLength(1);
    expect(second.generation).toBe(2);
    expect(second.restored).toEqual(['environment-maps']);
    // Cumulative counts keep the history; lastFailedIds reflects the latest.
    expect(coordinator.stats()).toEqual({
      restores: 2,
      restored: 1,
      failed: 1,
      pending: 0,
      lastFailedIds: [],
    });
  });

  it('reports pending units while a restore is in flight', async () => {
    const coordinator = createContextRestoreCoordinator();
    coordinator.register('grass-ground-bake', () => {});
    coordinator.register('environment-maps', () => {});
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const restore = coordinator.restore(async (_id, work) => {
      await gate;
      await work();
    });
    // Two units enqueued, none settled yet.
    await Promise.resolve();
    expect(coordinator.stats().pending).toBe(2);

    release();
    await restore;
    expect(coordinator.stats().pending).toBe(0);
  });

  it('replaces a producer registered under the same id and honors unregister only for the live one', async () => {
    const coordinator = createContextRestoreCoordinator();
    const stale = vi.fn();
    const live = vi.fn();
    const unregisterStale = coordinator.register('grass-ground-bake', stale);
    coordinator.register('grass-ground-bake', live);
    // The stale unregister must not remove the live registration.
    unregisterStale();
    expect(coordinator.producerIds()).toEqual(['grass-ground-bake']);

    await coordinator.restore(immediateRun([]));
    expect(stale).not.toHaveBeenCalled();
    expect(live).toHaveBeenCalledOnce();
  });

  it('snapshots the producer set at restore start: a producer registered mid-restore waits for the next one', async () => {
    const coordinator = createContextRestoreCoordinator();
    const late = vi.fn();
    coordinator.register('grass-ground-bake', () => {
      coordinator.register('late-producer', late);
    });

    const outcome = await coordinator.restore(immediateRun([]));

    expect(outcome.restored).toEqual(['grass-ground-bake']);
    expect(late).not.toHaveBeenCalled();
    expect(coordinator.producerIds()).toEqual(['grass-ground-bake', 'late-producer']);
  });
});
