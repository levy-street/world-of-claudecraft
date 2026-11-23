import type * as THREE from 'three';
import { type BackgroundGpuQueue, GPU_WORK_PRIORITY } from './background_gpu_queue';
import type { CompileArmHost } from './compile_arms';
import { type IdleSlotResult, idleSlot } from './idle_queue';
import { collectObjectTextures } from './material_texture_slots';
import { runBackgroundPrewarm } from './prewarm_pass';
import { warmRootBeforeLink } from './shader_warm_lane';

interface ZonePrewarmPacing {
  wait(): Promise<IdleSlotResult>;
  promote(): void;
}

const pacingByTasks = new WeakMap<Map<string, Promise<void>>, Map<string, ZonePrewarmPacing>>();

function createZonePrewarmPacing(): ZonePrewarmPacing {
  let urgent = false;
  const waiting = new Set<() => void>();
  const yieldTask = (): Promise<IdleSlotResult> =>
    new Promise((resolve) => {
      // Keep every upload a separate browser task, so loading-screen paint,
      // input, and driver polling still get turns under the arrival curtain.
      setTimeout(
        () => resolve({ forcedProgress: false, source: 'cooperative-timer', timeRemainingMs: 0 }),
        0,
      );
    });
  return {
    wait() {
      if (urgent) return yieldTask();
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (result: IdleSlotResult): void => {
          if (done) return;
          done = true;
          waiting.delete(wake);
          resolve(result);
        };
        const wake = (): void => {
          void yieldTask().then(finish);
        };
        waiting.add(wake);
        void idleSlot(250, { maxTimeoutDeferrals: 2 }).then(finish, (error) => {
          if (done) return;
          done = true;
          waiting.delete(wake);
          reject(error);
        });
      });
    },
    promote() {
      if (urgent) return;
      urgent = true;
      for (const wake of waiting) wake();
    },
  };
}

/** A blocking arrival joins the SAME task and promotes its remaining idle
 * waits. No other zone or queue priority changes, and no work is skipped. */
export function runZonePrewarmTask(
  pending: Map<string, Promise<void>>,
  zoneId: string,
  background: boolean,
  work: (pacing: Pick<ZonePrewarmPacing, 'wait'>) => Promise<void>,
): Promise<void> {
  let pacers = pacingByTasks.get(pending);
  const existing = pending.get(zoneId);
  if (existing) {
    if (!background) pacers?.get(zoneId)?.promote();
    return existing;
  }
  if (!pacers) {
    pacers = new Map();
    pacingByTasks.set(pending, pacers);
  }
  const pacing = createZonePrewarmPacing();
  if (!background) pacing.promote();
  pacers.set(zoneId, pacing);
  // Register before starting work so a synchronous reentrant join sees the
  // task, and a failed build cannot strand an already-completed map entry.
  const task = Promise.resolve()
    .then(() => work(pacing))
    .finally(() => {
      pending.delete(zoneId);
      pacers.delete(zoneId);
      if (pacers.size === 0) pacingByTasks.delete(pending);
    });
  pending.set(zoneId, task);
  return task;
}

export interface ZoneBackgroundPrewarmHost {
  supportsAsyncCompile: boolean;
  arms: CompileArmHost;
  queue: Pick<BackgroundGpuQueue, 'run'>;
  compileColor(root: THREE.Object3D): Promise<void>;
  compileShadow(root: THREE.Object3D): Promise<void>;
  prepareAssets(root: THREE.Object3D): void;
  uploadTexture(texture: THREE.Texture): void;
  renderRoot(group: THREE.Group, child: THREE.Object3D): void;
  renderWarmPass(): void;
}

/** The existing per-child links and two-texture upload batches, shared by
 * ordinary idle streaming and a promoted blocking arrival. */
export function runZoneBackgroundPrewarm(
  groups: readonly THREE.Group[],
  host: ZoneBackgroundPrewarmHost,
  pacing: Pick<ZonePrewarmPacing, 'wait'>,
): Promise<void> {
  return runBackgroundPrewarm(groups, {
    supportsAsyncCompile: host.supportsAsyncCompile,
    idleSlot: () => pacing.wait(),
    compileChild: async (child) => {
      const root = child as THREE.Object3D;
      await warmRootBeforeLink(host.arms, root, {
        priority: GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        label: `zone-prewarm-warm:${root.name || root.type}`,
        run: (work, priority, label) => host.queue.run(work, priority, label),
        includeOffscreenVariant: true,
      });
      await host.queue.run(
        () => host.compileColor(root),
        GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        `zone-prewarm-color:${root.name || root.type}`,
      );
      await host.queue.run(
        () => host.compileShadow(root),
        GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        `zone-prewarm-shadow:${root.name || root.type}`,
      );
    },
    prepareChildAssets: (child) => host.prepareAssets(child as THREE.Object3D),
    warmChildUnits: (group, child) => {
      const root = child as THREE.Object3D;
      const units: { label: string; run: () => void }[] = [];
      const textures = [...collectObjectTextures(root, false)];
      for (let i = 0; i < textures.length; i += 2) {
        const batch = textures.slice(i, i + 2);
        units.push({
          label: 'zone-prewarm-tex',
          run: () => {
            for (const texture of batch) host.uploadTexture(texture);
          },
        });
      }
      units.push({
        label: `zone-prewarm-render:${root.name || root.type}`,
        run: () => host.renderRoot(group as THREE.Group, root),
      });
      return units;
    },
    renderWarmPass: () => host.renderWarmPass(),
    runUpload: (work, label) =>
      host.queue.run(work, GPU_WORK_PRIORITY.VISIBLE_PREWARM, label ?? 'zone-prewarm-upload'),
  });
}
