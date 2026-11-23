// The pure half of an in-place WebGL context restore (context_restore.ts is
// the renderer-side host): the registry of "this GPU work is done" records
// that the restored context no longer backs, and the sequencing of one
// restore pass.
//
// When the browser gives a lost context back, three starts over with empty
// GPU state (new program cache, new texture records, empty render targets)
// and rebuilds each object lazily at its next draw. Every record here that
// says "linked", "uploaded", "warmed" or "ready" was about the dead context,
// so each owner registers a reset next to its record and the host runs them
// all before anything is prepared again. Owners are held WEAKLY: a record
// that is collected needs no reset, and nothing here keeps a view, a pool or
// a renderer alive.
//
// A pass: `lost` pauses (the host stops the GPU queue), `restored` opens a
// pass with a new generation and a HOLD deadline (the world draw is withheld
// while the visible set links off-thread), the host ends the hold once that
// set settled or the deadline passed, and the rest resumes as paced debt. A
// second loss at any point cancels the pass: every later step checks its
// generation.
//
// Pure core contract: no three import, no DOM, no clocks (the host passes
// `nowMs`), no randomness. Registered in RENDER_PURE_CORES.

/** The longest the world draw is withheld after a restore, online and
 *  offline alike: the offline arrival bound (src/game/arrival_warmup.ts
 *  ARRIVAL_REVEAL_SETTLE_MAX_MS, pinned equal by the tests). Shorter than the
 *  frozen restore frame it replaces (2.3 s on an RTX 3090, 3.3 s in a traced
 *  AMD session, both with the whole client frozen), and everything but the 3D
 *  view stays live meanwhile. */
export const CONTEXT_RESTORE_HOLD_MAX_MS = 3_000;

export interface ContextRestoreResetReport {
  /** Registered owner ids that had at least one live instance. */
  owners: number;
  /** Instances reset. */
  instances: number;
  /** Owner ids whose reset threw for at least one instance. */
  failed: string[];
}

export interface ContextRestoreRegistry {
  /** Register `owner` under `id`. Idempotent per (id, owner). `reset` is
   *  called with the owner and must not capture it (that would pin it). */
  register<T extends object>(id: string, owner: T, reset: (owner: T) => void): void;
  /** Run every live owner's reset. One throw never stops the others. */
  run(onError?: (id: string, error: unknown) => void): ContextRestoreResetReport;
  /** Every live owner's callback bound to it, one entry per instance, for a
   *  host that runs each as its own unit of work. */
  bound(): { id: string; run: () => void }[];
  /** Live instance count per id (dead references pruned). */
  counts(): Map<string, number>;
  /** Forget every owner (tests: one fixture's owners must not reset in the next). */
  clear(): void;
}

interface OwnerSet {
  reset: (owner: object) => void;
  members: WeakSet<object>;
  refs: WeakRef<object>[];
  /** Live length after the last prune: a register past twice it prunes, so
   *  a session of streaming rigs between two restores stays bounded. */
  prunedAt: number;
}

export function createContextRestoreRegistry(): ContextRestoreRegistry {
  const byId = new Map<string, OwnerSet>();
  const prune = (set: OwnerSet): void => {
    let write = 0;
    for (let read = 0; read < set.refs.length; read++) {
      const ref = set.refs[read];
      if (ref.deref() !== undefined) set.refs[write++] = ref;
    }
    set.refs.length = write;
    set.prunedAt = write;
  };
  return {
    register(id, owner, reset) {
      let set = byId.get(id);
      if (!set) {
        set = {
          reset: reset as (owner: object) => void,
          members: new WeakSet(),
          refs: [],
          prunedAt: 0,
        };
        byId.set(id, set);
      }
      if (set.members.has(owner)) return;
      set.members.add(owner);
      set.refs.push(new WeakRef(owner));
      if (set.refs.length > 2 * set.prunedAt + 64) prune(set);
    },
    run(onError) {
      const report: ContextRestoreResetReport = { owners: 0, instances: 0, failed: [] };
      for (const [id, set] of byId) {
        prune(set);
        if (set.refs.length === 0) continue;
        report.owners++;
        let failed = false;
        for (const ref of set.refs.slice()) {
          const owner = ref.deref();
          if (owner === undefined) continue;
          try {
            set.reset(owner);
            report.instances++;
          } catch (error) {
            failed = true;
            onError?.(id, error);
          }
        }
        if (failed) report.failed.push(id);
      }
      return report;
    },
    bound() {
      const out: { id: string; run: () => void }[] = [];
      for (const [id, set] of byId) {
        prune(set);
        for (const ref of set.refs) {
          const owner = ref.deref();
          if (owner !== undefined) out.push({ id, run: () => set.reset(owner) });
        }
      }
      return out;
    },
    clear() {
      byId.clear();
    },
    counts() {
      const out = new Map<string, number>();
      for (const [id, set] of byId) {
        prune(set);
        out.set(id, set.refs.length);
      }
      return out;
    },
  };
}

export type ContextRestorePhase = 'live' | 'lost' | 'holding' | 'resuming';

/** How a hold ended: its visible set settled, its deadline passed, a second
 *  loss cancelled it (recorded by `lost`), or the renderer went away. */
export type ContextRestoreHoldEnd = 'settled' | 'bound' | 'cancelled' | 'disposed';

export interface ContextRestoreSnapshot {
  phase: ContextRestorePhase;
  generation: number;
  losses: number;
  restores: number;
  /** The last completed hold, or null before the first restore. */
  lastHold: { ms: number; end: ContextRestoreHoldEnd } | null;
}

export interface ContextRestoreSequence {
  /** A loss: cancels any pass in flight (a hold standing is recorded as
   *  cancelled). Returns the new generation. */
  lost(nowMs: number): number;
  /** A restore: opens a pass and its hold. Returns the pass generation. */
  restored(nowMs: number): number;
  /** The hold deadline of the current pass, or null outside a hold. */
  holdDeadline(): number | null;
  /** Whether `generation` is still the live pass. */
  current(generation: number): boolean;
  /** End the hold of `generation`. True only for the call that ended it (a
   *  stale generation or a second end is a no-op). */
  endHold(generation: number, nowMs: number, end: ContextRestoreHoldEnd): boolean;
  /** The debt of `generation` is scheduled: back to live. */
  resumed(generation: number): void;
  snapshot(): ContextRestoreSnapshot;
}

export function createContextRestoreSequence(
  holdMaxMs: number = CONTEXT_RESTORE_HOLD_MAX_MS,
): ContextRestoreSequence {
  let phase: ContextRestorePhase = 'live';
  let generation = 0;
  let losses = 0;
  let restores = 0;
  let holdStartedAt = 0;
  let deadline: number | null = null;
  let lastHold: ContextRestoreSnapshot['lastHold'] = null;
  return {
    lost(nowMs) {
      if (phase === 'holding') {
        lastHold = { ms: Math.max(0, nowMs - holdStartedAt), end: 'cancelled' };
      }
      losses++;
      generation++;
      phase = 'lost';
      deadline = null;
      return generation;
    },
    restored(nowMs) {
      restores++;
      generation++;
      phase = 'holding';
      holdStartedAt = nowMs;
      deadline = nowMs + Math.max(0, holdMaxMs);
      return generation;
    },
    holdDeadline() {
      return phase === 'holding' ? deadline : null;
    },
    current(pass) {
      return pass === generation;
    },
    endHold(pass, nowMs, end) {
      if (pass !== generation || phase !== 'holding') return false;
      phase = end === 'disposed' ? 'live' : 'resuming';
      deadline = null;
      lastHold = { ms: Math.max(0, nowMs - holdStartedAt), end };
      return true;
    },
    resumed(pass) {
      if (pass === generation && phase === 'resuming') phase = 'live';
    },
    snapshot() {
      return { phase, generation, losses, restores, lastHold };
    },
  };
}
