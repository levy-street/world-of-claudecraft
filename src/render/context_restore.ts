// Host adapter for the in-place WebGL context restore (context_restore_core.ts
// holds the sequencing and the counts). The renderer registers its sampled-only
// render targets here, and its `webglcontextrestored` handler calls
// runContextRestore, which pushes every registered re-bake through the shared
// background GPU queue (the one priority arbiter for work that reaches WebGL,
// see src/render/CLAUDE.md) and reports failures on the dev channel.
// Per-producer isolation is the core's: one failed re-bake never blocks the
// others, and the next restore retries everything.
//
// Liveness: a queued re-bake can start after a SECOND context loss, or after
// the renderer began shutting down. Rendering into a lost context is a silent
// no-op, so an unguarded re-bake would report success while leaving the
// target black. Every producer therefore checks the host's `isLive` first and
// fails loudly instead; the failure is counted, and the next restore retries.

import type * as THREE from 'three';
import type { BackgroundGpuQueue } from './background_gpu_queue';
import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import type {
  ContextRestoreCoordinator,
  ContextRestoreOutcome,
  ContextRestoreRebake,
} from './context_restore_core';
import {
  type EnvironmentMapRestoreHost,
  restoreEnvironmentMaps,
} from './environment_map_restore_core';
import { rebakeImpostorAtlas } from './foliage_impostor';
import { rebakeGrassGroundTexture } from './grass_ground_bake';

/** LIVE_VIEW, not BACKGROUND: until these targets are re-rendered the ground,
 *  the far foliage and every standard material's image lighting read black,
 *  which is the on-screen world, not a cosmetic warm-up. ACTIONABLE_VIEW stays
 *  reserved for the gameplay-readable views the reveal gate holds. */
export const CONTEXT_RESTORE_GPU_PRIORITY = GPU_WORK_PRIORITY.LIVE_VIEW;

/** The producer ids the renderer registers, pinned so the lifecycle test can
 *  prove every sampled-only target it owns has a re-bake. */
export const RENDERER_RESTORE_PRODUCERS = {
  GRASS_GROUND_BAKE: 'grass-ground-bake',
  FOLIAGE_IMPOSTOR_ATLAS: 'foliage-impostor-atlas',
  ENVIRONMENT_MAPS: 'environment-maps',
} as const;

export interface RendererRestoreHost<K extends string>
  extends Omit<EnvironmentMapRestoreHost<K, THREE.WebGLRenderTarget>, 'deferEnvironmentBiome'> {
  webgl(): THREE.WebGLRenderer;
  /** False once the renderer is shutting down or its context is lost again. */
  isLive(): boolean;
}

function guarded<K extends string>(
  host: RendererRestoreHost<K>,
  id: string,
  rebake: ContextRestoreRebake,
): ContextRestoreRebake {
  return () => {
    if (!host.isLive()) {
      throw new Error(`${id}: renderer shutting down or context lost again; not re-baked`);
    }
    return rebake();
  };
}

/** Register the renderer's three sampled-only render targets. Each re-bake
 *  is a no-op when its producer never baked this session (low tier, sprites
 *  off, headless), so registration is unconditional. The off-screen
 *  environment prefilters run as their own later units on `queue`. */
export function registerRendererRestoreProducers<K extends string>(
  coordinator: ContextRestoreCoordinator,
  queue: BackgroundGpuQueue,
  host: RendererRestoreHost<K>,
): void {
  const { GRASS_GROUND_BAKE, FOLIAGE_IMPOSTOR_ATLAS, ENVIRONMENT_MAPS } =
    RENDERER_RESTORE_PRODUCERS;
  coordinator.register(
    GRASS_GROUND_BAKE,
    guarded(host, GRASS_GROUND_BAKE, () => {
      rebakeGrassGroundTexture(host.webgl());
    }),
  );
  coordinator.register(
    FOLIAGE_IMPOSTOR_ATLAS,
    guarded(host, FOLIAGE_IMPOSTOR_ATLAS, () => {
      rebakeImpostorAtlas(host.webgl());
    }),
  );
  const envHost: EnvironmentMapRestoreHost<K, THREE.WebGLRenderTarget> = {
    ...host,
    deferEnvironmentBiome: (key) =>
      queue.run(
        guarded(host, `${ENVIRONMENT_MAPS}:${key}`, () => {
          host.ensureEnvironmentBiome(key);
        }),
        CONTEXT_RESTORE_GPU_PRIORITY,
        `context-restore:${ENVIRONMENT_MAPS}:${key}`,
      ),
  };
  coordinator.register(
    ENVIRONMENT_MAPS,
    guarded(host, ENVIRONMENT_MAPS, () => restoreEnvironmentMaps(envHost).settled),
  );
}

export function runContextRestore(
  coordinator: ContextRestoreCoordinator,
  queue: BackgroundGpuQueue,
): Promise<ContextRestoreOutcome> {
  return coordinator
    .restore((id, work) => queue.run(work, CONTEXT_RESTORE_GPU_PRIORITY, `context-restore:${id}`))
    .then((outcome) => {
      // Dev-channel English: the world stays partly black until the next
      // restore retries this producer, so the failure must be visible.
      for (const failure of outcome.failed) {
        console.warn(
          `[context-restore] ${failure.id} did not come back after restore ${outcome.generation}`,
          failure.error,
        );
      }
      return outcome;
    });
}
