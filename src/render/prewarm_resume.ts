// Bounded background sequencing for prewarm work dropped by the world-entry
// deadline. A resume entry contains explicit small units. There is deliberately
// no whole-entry callback: requestIdleCallback cannot preempt synchronous work
// once it starts, including Three r165's compileAsync traversal prologue.

/** One root's share of a batch unit, runnable as its own queue unit. */
export interface PrewarmResumeUnitPiece {
  /** `${unit.id}:${index}`: the same kind prefix as the unit, so the budget
   *  prices it under the unit's family. */
  id: string;
  run: () => Promise<void>;
}

export interface PrewarmResumeUnit {
  id: string;
  run: () => void | Promise<void>;
  /** The same work cut ONE ROOT PER PIECE, for a lane that runs while the
   *  world is live. A batch unit's `run` launches its roots together (the
   *  boot shape: their driver links overlap under the curtain), but live that
   *  shape cost twice: every root's SECOND arm (the shadow compile after its
   *  colour compile settles) ran as a continuation, and the roots' colour
   *  links settled in the same poll pass, so 16 to 32 shadow prologues fired
   *  in one microtask burst (one 3 to 3.8 s main-thread task, bench H14); and
   *  the unit held the queue for its WHOLE settle, which serial made 4 to 6 s
   *  on the Intel iGPU, so the reveal gates of the decor the camera stands in
   *  waited behind it past their watchdog (bench batch 17: 116 keys, 365
   *  roots revealed cold). One root per queue unit keeps the held-tail debt
   *  shape (hitch-hunt P1: one settled link at a time, the driver queue
   *  shallow) and lets the queue re-arbitrate between roots, so a gate waits
   *  at most one root's settle. Absent on a unit with no batch. */
  pieces?: readonly PrewarmResumeUnitPiece[];
  /** The roots behind the unit, for a consumer that needs to know WHICH
   *  scene objects a deferred unit left unlinked (the reveal-time hold). */
  roots?: readonly object[];
}

export interface PrewarmResumeEntry {
  id: string;
  units: readonly PrewarmResumeUnit[];
}

export interface PrewarmResumeGroup<T> {
  id: string;
  roots: readonly T[];
}

/**
 * A prefetch started ahead of its manifest entry (the sky HDRI fetch + worker
 * decode), with synchronous settlement observation so the entry can decide
 * inline-vs-defer without awaiting the network.
 */
export interface TrackedPrefetch {
  task: Promise<void>;
  isSettled(): boolean;
  /** The rejection reason once the task has failed, else null. */
  rejection(): unknown | null;
}

/** Wraps an in-flight prefetch so settlement is observable synchronously. */
export function trackPrefetch(task: Promise<void>): TrackedPrefetch {
  let settled = false;
  let rejection: unknown = null;
  task.then(
    () => {
      settled = true;
    },
    (error: unknown) => {
      settled = true;
      rejection = error ?? new Error('prewarm prefetch failed');
    },
  );
  return {
    task,
    isSettled: () => settled,
    rejection: () => rejection,
  };
}

/**
 * Bounded inline wait for a tracked prefetch: 'ready' when it settles within
 * waitMs, 'pending' otherwise. The budget-hungry manifest entries after the
 * caller keep their budget because the wait can never exceed waitMs; an
 * Infinity budget awaits settlement outright (the finish-full-manifest arm).
 * The sleeper is injectable so tests drive the clock deterministically.
 */
export async function waitForPrefetch(
  prefetch: TrackedPrefetch,
  waitMs: number,
  sleeper: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<'ready' | 'pending'> {
  if (prefetch.isSettled()) return 'ready';
  if (waitMs <= 0) return 'pending';
  const settledTask = prefetch.task.then(
    () => undefined,
    () => undefined,
  );
  if (!Number.isFinite(waitMs)) {
    await settledTask;
    return 'ready';
  }
  await Promise.race([settledTask, sleeper(waitMs)]);
  return prefetch.isSettled() ? 'ready' : 'pending';
}

export interface PrewarmResumeHooks<T extends PrewarmResumeEntry> {
  idleSlot: () => Promise<unknown>;
  /** The owning entry rides along so the runner can schedule by entry class
   *  (link/upload debt vs cosmetic warm-up; see prewarmResumeIsDebt). */
  runUnit?: (unit: PrewarmResumeUnit, entry: T) => void | Promise<void>;
  afterEntry?: (entry: T) => void;
  onUnitError?: (entry: T, unit: PrewarmResumeUnit, error: unknown) => void;
}

/** Publishes retained prewarm artifacts only after all resumed work settles. */
export async function settlePrewarmBeforePublish<T>(
  work: () => T | Promise<T>,
  publish: () => void,
): Promise<T> {
  try {
    return await work();
  } finally {
    publish();
  }
}

/**
 * Near-first ordering for compile-debt roots (hitch-hunt P3a). The post-entry
 * resume lane pays the boot compile debt over tens of seconds, and the roots'
 * collection order is scene-graph order: a village the player walks toward can
 * sit behind hundreds of unrelated roots and lose the race to its own reveal.
 * Sorting by distance to the player makes the debt the camera can reach first
 * the debt paid first. Stable for ties; roots without a distance sort last.
 */
export function orderRootsByDistanceSq<T>(
  roots: readonly T[],
  distanceSq: (root: T) => number | null,
): T[] {
  return roots
    .map((root, index) => ({ root, index, dist: distanceSq(root) ?? Infinity }))
    .sort((a, b) => a.dist - b.dist || a.index - b.index)
    .map((entry) => entry.root);
}

/** Structural shape of a compile root's placement (a three mesh satisfies it
 *  without this module importing three). An InstancedMesh also exposes its
 *  instance matrices (count x 16 floats, local to the mesh). */
export interface CompileRootPlacement {
  matrixWorld: { elements: ArrayLike<number> };
  boundingSphere?: { center: { x: number; y: number; z: number } } | null;
  geometry?: {
    boundingSphere?: { center: { x: number; y: number; z: number } } | null;
  } | null;
  isInstancedMesh?: boolean;
  count?: number;
  instanceMatrix?: { array: ArrayLike<number> } | null;
}

/**
 * Camera-plane XZ distance-squared proxy for a compile root. The object's
 * matrixWorld translation alone is a trap here: merged and instanced world
 * content bakes its placement into the GEOMETRY and leaves the mesh at the
 * origin, which would tie most of the debt at "distance to world origin".
 * When three has computed a bounding sphere, its world-transformed centre is
 * the honest position for both shapes. InstancedMesh stores its aggregate,
 * instance-aware sphere on the object, so that bound takes precedence over
 * the primitive-local geometry sphere. The translation is the fallback for
 * spheres not yet computed.
 *
 * A world-spanning InstancedMesh (every alchemy cauldron of the world in one
 * mesh) has its aggregate centre far from ANY instance, so the centre alone
 * sorted it last and the resume lane reached it after the instance next to
 * the player had already drawn cold (bench batches 17 to 19: the station
 * cauldron, 0.4 to 0.7 s never-compiled in the first two seconds after the
 * curtain, every run). For an InstancedMesh with several instances the proxy
 * is therefore the NEAREST instance translation and nothing else (the
 * aggregate centre is wrong in both directions: far from every instance, or
 * near the camera with no instance there); a single-instance mesh keeps the
 * sphere, which is what keeps the identity-instance bakes honest (their
 * instance sits at the origin and the geometry carries the placement).
 */
export function compileRootDistanceSq(
  root: CompileRootPlacement,
  camX: number,
  camZ: number,
): number {
  const world = root.matrixWorld.elements;
  const center = root.boundingSphere?.center ?? root.geometry?.boundingSphere?.center;
  let x = world[12];
  let z = world[14];
  if (center) {
    x = world[0] * center.x + world[4] * center.y + world[8] * center.z + world[12];
    z = world[2] * center.x + world[6] * center.y + world[10] * center.z + world[14];
  }
  const dx = x - camX;
  const dz = z - camZ;
  let best = dx * dx + dz * dz;
  const instances = root.isInstancedMesh === true ? root.instanceMatrix?.array : undefined;
  const count = root.count ?? 0;
  if (instances && count > 1 && instances.length >= count * 16) {
    best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      const base = i * 16;
      const lx = instances[base + 12];
      const ly = instances[base + 13];
      const lz = instances[base + 14];
      const ix = world[0] * lx + world[4] * ly + world[8] * lz + world[12] - camX;
      const iz = world[2] * lx + world[6] * ly + world[10] * lz + world[14] - camZ;
      const d = ix * ix + iz * iz;
      if (d < best) best = d;
    }
  }
  return best;
}

export interface PrewarmCompileUnitOptions<T> {
  /** Program-content keys for a root (e.g. material identity plus the mesh
   *  shape bits that pick the program variant). A root whose every key an
   *  earlier root already produced links nothing new and is skipped: each
   *  awaited r165 compileAsync costs a 10 ms poll floor plus a synchronous
   *  scene walk, so redundant roots are pure wall-clock. A root with no keys
   *  is always kept (fail-open). */
  dedupeKeys?: (root: T) => Iterable<unknown>;
  /** Caller-owned dedupe store shared ACROSS calls, so one logical compile
   *  pass split over several submissions (an early manifest entry, the
   *  compile entry's tail, a live-scene re-collection, the resume lane)
   *  never resubmits a root or program signature an earlier call already
   *  covered. Omitted, each call dedupes only against itself. */
  sharedDedupe?: { seen: Set<T>; seenKeys: Set<unknown> };
  /** Roots per unit. One unit launches its batch's compiles and awaits them
   *  TOGETHER, so the 10 ms poll floors overlap instead of stacking. Each
   *  compile call keeps its own bounded synchronous prologue, so a batch
   *  stays preemptible between calls only at unit granularity: keep it small
   *  (the entry path uses 16). Default 1 preserves one-root units. */
  batchSize?: number;
}

// Per-shared-store unit indices. Two calls that share a dedupe store are two
// passes of ONE logical compile pass ('programs.compile-submit' early, then
// 'programs.compile' re-collecting the live scene), and the submit lane
// accounts every unit BY ID: an index restarting at 0 mints an id still in
// flight from the earlier pass, whose in-flight cost the namesake's sync
// prologue then rewrites and whose settle is scored against the wrong unit.
// Keyed off the caller's store, so a call with no store keeps its own space.
const sharedUnitIndices = new WeakMap<object, Map<string, number>>();

/**
 * Turns materialized archetype roots into explicit resume units. Reference
 * deduplication prevents one shared root from being compiled twice when it is
 * reachable through more than one prewarm group. The caller supplies the
 * compile operation so this seam stays Three-free and executable in Node.
 */
export function buildPrewarmCompileUnits<T extends object>(
  groups: readonly PrewarmResumeGroup<T>[],
  compile: (root: T) => unknown | Promise<unknown>,
  options?: PrewarmCompileUnitOptions<T>,
): PrewarmResumeUnit[] {
  const seen = options?.sharedDedupe?.seen ?? new Set<T>();
  const seenKeys = options?.sharedDedupe?.seenKeys ?? new Set<unknown>();
  const store = options?.sharedDedupe;
  let unitIndices = store ? sharedUnitIndices.get(store) : undefined;
  if (store && !unitIndices) {
    unitIndices = new Map<string, number>();
    sharedUnitIndices.set(store, unitIndices);
  }
  const indices = unitIndices ?? new Map<string, number>();
  const batchSize = Math.max(1, options?.batchSize ?? 1);
  const units: PrewarmResumeUnit[] = [];
  for (const group of groups) {
    let unitIndex = indices.get(group.id) ?? 0;
    let batch: T[] = [];
    const flush = (): void => {
      if (batch.length === 0) return;
      const roots = batch;
      batch = [];
      const id = `${group.id}:${unitIndex++}`;
      indices.set(group.id, unitIndex);
      units.push({
        id,
        run: async () => {
          // allSettled, then rethrow the first failure: Promise.all would
          // short-circuit the unit on one rejection and blur which of its
          // batch-mates actually compiled; every root still gets its attempt
          // and the unit's caller still sees the failure.
          const results = await Promise.allSettled(
            roots.map((root) => Promise.resolve(compile(root))),
          );
          const failed = results.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
          );
          if (failed) throw failed.reason;
        },
        pieces: roots.map((root, index) => ({
          id: `${id}:${index}`,
          run: async () => {
            await compile(root);
          },
        })),
        roots,
      });
    };
    for (const root of group.roots) {
      if (seen.has(root)) continue;
      seen.add(root);
      if (options?.dedupeKeys) {
        const keys = [...options.dedupeKeys(root)];
        const fresh = keys.length === 0 || keys.some((key) => !seenKeys.has(key));
        for (const key of keys) seenKeys.add(key);
        if (!fresh) continue;
      }
      batch.push(root);
      if (batch.length >= batchSize) flush();
    }
    flush();
  }
  return units;
}

/**
 * Run a unit's pieces one after the other through `runPiece` (the caller's
 * queue submission), every piece attempted, the first failure rethrown at the
 * end: the contract `run` has for the batch, kept for the per-root shape.
 */
export async function runPrewarmPiecesSerially(
  pieces: readonly PrewarmResumeUnitPiece[],
  runPiece: (piece: PrewarmResumeUnitPiece) => Promise<unknown>,
): Promise<void> {
  let failure: { reason: unknown } | null = null;
  for (const piece of pieces) {
    try {
      await runPiece(piece);
    } catch (reason) {
      failure ??= { reason };
    }
  }
  if (failure) throw failure.reason;
}

/**
 * Runs one explicitly bounded unit per idle slot. A failed unit is reported and
 * skipped so independent shader families later in the manifest still warm.
 */
export async function resumeDroppedPrewarmEntries<T extends PrewarmResumeEntry>(
  dropped: readonly T[],
  hooks: PrewarmResumeHooks<T>,
): Promise<void> {
  for (const entry of dropped) {
    for (const unit of entry.units) {
      await hooks.idleSlot();
      try {
        await (hooks.runUnit ? hooks.runUnit(unit, entry) : unit.run());
      } catch (error) {
        hooks.onUnitError?.(entry, unit, error);
      }
    }
    hooks.afterEntry?.(entry);
  }
}
