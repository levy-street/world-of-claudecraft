// Behavioral pins for src/render/context_restore.ts, the renderer-side
// adapter of the in-place WebGL context restore (issue 3846): producer
// registration, the liveness gate every re-bake runs behind, the environment
// deferral onto the GPU queue, and the dev-channel failure report.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundGpuQueue } from '../src/render/background_gpu_queue';
import {
  CONTEXT_RESTORE_GPU_PRIORITY,
  RENDERER_RESTORE_PRODUCERS,
  type RendererRestoreHost,
  registerRendererRestoreProducers,
  runContextRestore,
} from '../src/render/context_restore';
import { createContextRestoreCoordinator } from '../src/render/context_restore_core';
import { setGrassGroundBake } from '../src/render/grass_ground_bake';

type Key = 'vale' | 'dusk';

interface QueueLog {
  labels: string[];
  priorities: number[];
}

/** A queue that runs every unit immediately and records label + priority. */
function immediateQueue(log: QueueLog): BackgroundGpuQueue {
  return {
    run: async (work: () => unknown, priority?: number, label?: string) => {
      log.labels.push(label ?? '');
      log.priorities.push(priority ?? -1);
      return work();
    },
  } as unknown as BackgroundGpuQueue;
}

function fakeHost(overrides: Partial<RendererRestoreHost<Key>> = {}): RendererRestoreHost<Key> & {
  envRTs(): Map<Key, THREE.WebGLRenderTarget>;
} {
  const envRTs = new Map<Key, THREE.WebGLRenderTarget>();
  const scene = { environment: null as object | null };
  return {
    webgl: vi.fn(() => ({}) as THREE.WebGLRenderer),
    isLive: () => true,
    envRTs: () => envRTs,
    resetPrefilterCaches: vi.fn(),
    ensureEnvironmentBiome: vi.fn((key: Key) => {
      const rt = new THREE.WebGLRenderTarget(4, 4);
      envRTs.set(key, rt);
      return rt;
    }),
    scene: () => scene,
    ...overrides,
  };
}

afterEach(() => {
  setGrassGroundBake(null);
  vi.restoreAllMocks();
});

describe('registerRendererRestoreProducers', () => {
  it('registers the three sampled-only producers under their pinned ids', () => {
    const coordinator = createContextRestoreCoordinator();
    registerRendererRestoreProducers(
      coordinator,
      immediateQueue({ labels: [], priorities: [] }),
      fakeHost(),
    );
    expect(coordinator.producerIds()).toEqual([
      RENDERER_RESTORE_PRODUCERS.GRASS_GROUND_BAKE,
      RENDERER_RESTORE_PRODUCERS.FOLIAGE_IMPOSTOR_ATLAS,
      RENDERER_RESTORE_PRODUCERS.ENVIRONMENT_MAPS,
    ]);
  });

  it('runs every producer through the queue at the live-view priority with a labelled unit', async () => {
    const coordinator = createContextRestoreCoordinator();
    const log: QueueLog = { labels: [], priorities: [] };
    const host = fakeHost();
    registerRendererRestoreProducers(coordinator, immediateQueue(log), host);

    const outcome = await runContextRestore(coordinator, immediateQueue(log));

    // Nothing baked this session: every re-bake is a no-op success.
    expect(outcome.failed).toEqual([]);
    expect(outcome.restored).toEqual(coordinator.producerIds());
    expect(log.labels).toEqual([
      'context-restore:grass-ground-bake',
      'context-restore:foliage-impostor-atlas',
      'context-restore:environment-maps',
    ]);
    expect(new Set(log.priorities)).toEqual(new Set([CONTEXT_RESTORE_GPU_PRIORITY]));
    // The grass and atlas re-bakes reached for the live renderer.
    expect(host.webgl).toHaveBeenCalledTimes(2);
  });

  it('fails every producer loudly, without touching the renderer, when the host is not live', async () => {
    const coordinator = createContextRestoreCoordinator();
    const log: QueueLog = { labels: [], priorities: [] };
    const host = fakeHost({ isLive: () => false });
    registerRendererRestoreProducers(coordinator, immediateQueue(log), host);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const outcome = await runContextRestore(coordinator, immediateQueue(log));

    expect(outcome.restored).toEqual([]);
    expect(outcome.failed.map((f) => f.id)).toEqual(coordinator.producerIds());
    expect(String((outcome.failed[0] as { error: Error }).error.message)).toContain(
      'context lost again',
    );
    expect(host.webgl).not.toHaveBeenCalled();
    expect(host.resetPrefilterCaches).not.toHaveBeenCalled();
    expect(coordinator.stats().failed).toBe(3);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(
      '[context-restore] environment-maps did not come back after restore 1',
      expect.any(Error),
    );
  });

  it('rebuilds the bound environment synchronously and defers the rest as their own queue units', async () => {
    const coordinator = createContextRestoreCoordinator();
    const log: QueueLog = { labels: [], priorities: [] };
    const host = fakeHost();
    const bound = new THREE.WebGLRenderTarget(4, 4);
    host.envRTs().set('vale', bound);
    host.envRTs().set('dusk', new THREE.WebGLRenderTarget(4, 4));
    host.scene().environment = bound.texture;
    registerRendererRestoreProducers(coordinator, immediateQueue(log), host);

    const outcome = await runContextRestore(coordinator, immediateQueue(log));

    expect(outcome.failed).toEqual([]);
    expect(host.ensureEnvironmentBiome).toHaveBeenNthCalledWith(1, 'vale');
    expect(host.ensureEnvironmentBiome).toHaveBeenNthCalledWith(2, 'dusk');
    expect(log.labels).toContain('context-restore:environment-maps:dusk');
    expect(host.scene().environment).toBe(host.envRTs().get('vale')?.texture);
  });

  it('a deferred environment key that finds the host dead counts the producer as failed', async () => {
    const coordinator = createContextRestoreCoordinator();
    const log: QueueLog = { labels: [], priorities: [] };
    let live = true;
    const host = fakeHost({ isLive: () => live });
    host.envRTs().set('vale', new THREE.WebGLRenderTarget(4, 4));
    host.envRTs().set('dusk', new THREE.WebGLRenderTarget(4, 4));
    // The deferred unit runs after a second loss: dead by the time it starts.
    const queue: BackgroundGpuQueue = {
      run: async (work: () => unknown, _priority?: number, label?: string) => {
        if (label?.endsWith(':dusk') || label?.endsWith(':vale')) live = false;
        return work();
      },
    } as unknown as BackgroundGpuQueue;
    registerRendererRestoreProducers(coordinator, queue, host);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const outcome = await runContextRestore(coordinator, immediateQueue(log));

    expect(outcome.failed.map((f) => f.id)).toEqual(['environment-maps']);
  });
});
