// Re-prefilter every sky environment map after an in-place WebGL context
// restore (issue 3846). The renderer keeps one PMREM render target per sky
// key in `envRTs`, a source-keyed cache behind it (aliased sky urls share a
// target), and `scene.environment` bound to one of them. All three hold GPU
// state minted on the LOST context: a restored context re-allocates nothing
// for a target that is only sampled, so the bound environment reads black
// and every standard material loses its image-based lighting.
//
// The restore disposes every target, drops the source cache and the PMREM
// generator (its blur material and ping-pong targets are dead too), rebuilds
// the BOUND key synchronously through the host's own ensure path (the same
// one zone prepare and sky residency use, so tier and memory gates apply
// unchanged) and re-binds the scene to it. Every other resident key is handed
// to `deferEnvironmentBiome` when the host offers it: a PMREM prefilter is
// indivisible and costs tens of milliseconds, so the off-screen ones spread
// across later GPU queue units instead of bursting into the restore frame.
// The bound key comes first for a second reason: a constrained-memory
// profile keeps only one prefilter for the session, and it must be the one on
// screen. A bound environment that is not one of the tracked targets (the
// renderer's dome-prefilter fallback, used when no realm HDRI was fetched)
// is rebuilt through `rebuildUntrackedEnvironment` when the host offers it,
// and unbound otherwise: plain ambient lighting beats a dead texture.
//
// Pure core contract: no three import (the host's targets are typed
// structurally), no DOM, no clocks, no randomness. Registered in
// RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/environment_map_restore_core.test.ts.

export interface RestorableEnvironmentTarget {
  texture: object;
  dispose(): void;
}

export interface EnvironmentMapRestoreHost<
  K extends string,
  T extends RestorableEnvironmentTarget,
> {
  /** The live per-key target map. Mutated in place: cleared, then refilled by
   *  the host's ensure path. */
  envRTs(): Map<K, T>;
  /** Drop the source-keyed target cache and the PMREM generator. Without this
   *  the ensure path would hand back the dead target it cached for the same
   *  source texture. */
  resetPrefilterCaches(): void;
  /** The host's own prefilter path (renderer.ts ensureEnvironmentBiome):
   *  builds and registers the key's target, or returns null when the tier or
   *  memory policy declines. */
  ensureEnvironmentBiome(key: K): T | null;
  /** Optional: run the key's ensure as its own later GPU work unit. Resolves
   *  once it ran (with whatever ensure returned); a rejection means that key
   *  did not come back. Absent, every key rebuilds synchronously. */
  deferEnvironmentBiome?(key: K): Promise<unknown>;
  /** Optional: re-prefilter the untracked fallback environment (the dome
   *  itself) and return its texture, or null when it cannot. */
  rebuildUntrackedEnvironment?(): object | null;
  scene(): { environment: object | null };
}

export interface EnvironmentMapRestoreResult<K extends string> {
  /** Keys whose prefilter was rebuilt synchronously, in order. */
  rebuilt: readonly K[];
  /** Keys that were resident before the loss but the ensure path declined. */
  missing: readonly K[];
  /** Keys handed to the host's deferral, in the order they were handed over. */
  deferred: readonly K[];
  /** Whether scene.environment now points at a rebuilt texture (false when
   *  nothing was bound, or the bound environment could not be rebuilt). */
  rebound: boolean;
  /** Resolves once every deferred key has run; rejects if any of them threw,
   *  so the producer counts as failed and the next restore retries. */
  settled: Promise<void>;
}

export function restoreEnvironmentMaps<K extends string, T extends RestorableEnvironmentTarget>(
  host: EnvironmentMapRestoreHost<K, T>,
): EnvironmentMapRestoreResult<K> {
  const envRTs = host.envRTs();
  const scene = host.scene();
  const bound = scene.environment;
  let boundKey: K | null = null;
  const keys: K[] = [];
  for (const [key, target] of envRTs) {
    if (bound !== null && boundKey === null && target.texture === bound) boundKey = key;
    keys.push(key);
  }
  // Aliased sky urls share one target across several keys: dispose each
  // target once, never per key.
  const targets = new Set<T>(envRTs.values());
  for (const target of targets) target.dispose();
  envRTs.clear();
  host.resetPrefilterCaches();

  const rebuilt: K[] = [];
  const missing: K[] = [];
  const deferred: K[] = [];
  const pending: Promise<unknown>[] = [];
  let rebound = false;
  try {
    const ordered = boundKey === null ? keys : [boundKey, ...keys.filter((k) => k !== boundKey)];
    for (const key of ordered) {
      if (key !== boundKey && host.deferEnvironmentBiome) {
        deferred.push(key);
        pending.push(host.deferEnvironmentBiome(key));
      } else if (host.ensureEnvironmentBiome(key)) {
        rebuilt.push(key);
      } else {
        missing.push(key);
      }
    }
    if (bound !== null && boundKey === null) {
      const fresh = host.rebuildUntrackedEnvironment?.() ?? null;
      scene.environment = fresh;
      rebound = fresh !== null;
    }
  } finally {
    // Runs on the throw path too: whatever survived is bound, never the
    // dead texture (an unbound environment is plain ambient lighting, a
    // dead one is black).
    if (boundKey !== null) {
      const fresh = envRTs.get(boundKey);
      scene.environment = fresh ? fresh.texture : null;
      rebound = fresh !== undefined;
    }
  }
  const settled = Promise.all(pending).then(() => undefined);
  return { rebuilt, missing, deferred, rebound, settled };
}
