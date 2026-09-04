// In-place WebGL context restore: the coordinator that re-bakes every
// GPU-resident resource the renderer owns that has no CPU backing.
//
// Why: after `webglcontextrestored` three re-creates textures from their
// images, geometry from its arrays and programs by re-linking, but a render
// target texture has no CPU image. A target the renderer only ever SAMPLES
// (the grass ground bake, the foliage impostor atlas, the prefiltered sky
// environments) is never bound as a target again, so on the fresh context its
// texture stays unbound and samples black for the rest of the session: the
// "world goes black mid-session while the HUD stays normal" report (issue
// 3846). Every such producer registers a re-bake here, and the renderer's
// restore handler runs them all through the shared background GPU queue.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/context_restore_core.test.ts. The host adapter (context_restore.ts)
// supplies the queue and the dev-channel logging; this core only sequences
// the producers and keeps the counts the perf beacon reports.

export type ContextRestoreRebake = () => void | Promise<void>;

/** The host's GPU work seam: enqueue one re-bake, resolve once it ran. A
 *  rejection (the queue refused or shut down, or the re-bake threw) counts
 *  as that producer failing this restore. */
export type ContextRestoreRun = (id: string, work: ContextRestoreRebake) => Promise<unknown>;

export interface ContextRestoreFailure {
  id: string;
  error: unknown;
}

export interface ContextRestoreOutcome {
  /** 1 for the first restore of the session, counting up. */
  generation: number;
  restored: readonly string[];
  failed: readonly ContextRestoreFailure[];
}

export interface ContextRestoreStats {
  /** Restores the coordinator ran (one per restore event). */
  restores: number;
  /** Producers re-baked successfully, summed over every restore. */
  restored: number;
  /** Producers whose re-bake threw or rejected, summed over every restore. */
  failed: number;
  /** Producers still queued or running from any restore. */
  pending: number;
  /** Ids that failed in the most recently COMPLETED restore. */
  lastFailedIds: readonly string[];
}

export interface ContextRestoreCoordinator {
  /** Register a producer. A second registration under the same id replaces
   *  the first. Returns the unregister function; it is a no-op once a later
   *  registration has replaced this one. */
  register(id: string, rebake: ContextRestoreRebake): () => void;
  /** Run every registered producer through `run`. Producers are enqueued in
   *  registration order and settle independently: one failure never stops
   *  the others. */
  restore(run: ContextRestoreRun): Promise<ContextRestoreOutcome>;
  stats(): ContextRestoreStats;
  producerIds(): readonly string[];
}

export function createContextRestoreCoordinator(): ContextRestoreCoordinator {
  const producers = new Map<string, ContextRestoreRebake>();
  let restores = 0;
  let restored = 0;
  let failed = 0;
  let pending = 0;
  let lastFailedIds: readonly string[] = [];

  return {
    register(id, rebake) {
      producers.set(id, rebake);
      return () => {
        if (producers.get(id) === rebake) producers.delete(id);
      };
    },

    async restore(run) {
      restores++;
      const generation = restores;
      // Snapshot: a producer registered while this restore is in flight
      // belongs to the next one (it was built on the live context).
      const batch = [...producers.entries()];
      pending += batch.length;
      const settled = await Promise.allSettled(
        batch.map(([id, rebake]) =>
          Promise.resolve()
            .then(() => run(id, rebake))
            .finally(() => {
              pending--;
            }),
        ),
      );
      const outcomeRestored: string[] = [];
      const outcomeFailed: ContextRestoreFailure[] = [];
      settled.forEach((result, i) => {
        const id = batch[i][0];
        if (result.status === 'fulfilled') outcomeRestored.push(id);
        else outcomeFailed.push({ id, error: result.reason });
      });
      restored += outcomeRestored.length;
      failed += outcomeFailed.length;
      lastFailedIds = outcomeFailed.map((f) => f.id);
      return { generation, restored: outcomeRestored, failed: outcomeFailed };
    },

    stats() {
      return { restores, restored, failed, pending, lastFailedIds };
    },

    producerIds() {
      return [...producers.keys()];
    },
  };
}
