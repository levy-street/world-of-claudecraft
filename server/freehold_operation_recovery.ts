// OPERATION RECOVERY (07a deliverable 4; the touch-set manifest's P7 to P9): a
// BOUNDED, ADMITTED producer that, when this realm becomes the authority for
// an account's plot (its claim is acquired at login), discovers that account's
// OPEN intents and reconciles each under its ORIGINAL operation id, through
// the kind's own reconciler, which applies it with the same mutation writer
// (commitFreeholdMutation) or closes it (cancelFreeholdOperation). Pending is
// not success and nothing here mints a new id.
//
// Bounded three ways: one pass per account at a time (single flight), one
// indexed read of at most FREEHOLD_OPERATION_OPEN_PER_ACCOUNT rows (never a
// whole-table or boot scan), and admitted through the background gate's
// tryAcquire, so a busy gate skips the pass rather than queueing behind
// player work (the account's next claim tries again).
//
// NO PRODUCTION KIND EXISTS in this release (the scope statement at the head
// of docs/freeholds/mutation-touch-set-manifest.md), so the
// realm's reconciler map is EMPTY and a scheduled pass returns before any
// statement: the call site is live and costs nothing until 08 registers the
// first kind. An intent whose kind has no reconciler is held open, counted
// and reported once per pass with no id in the line.
import type { OpenFreeholdOperation } from './freehold_operation_db';

export type FreeholdOperationReconcileResult = 'applied' | 'closed' | 'held';

export interface FreeholdOperationReconciler {
  /** Decide one open intent of this kind, under its ORIGINAL id. Must not throw
   *  for an expected refusal; a throw is counted and the intent stays open. */
  reconcile(intent: OpenFreeholdOperation): Promise<FreeholdOperationReconcileResult>;
}

/** The realm's reconcilers by kind. EMPTY in 07a; a kind-registering item adds
 *  its entry here in the change that registers the kind. */
export const FREEHOLD_OPERATION_RECONCILERS: ReadonlyMap<string, FreeholdOperationReconciler> =
  new Map();

export interface FreeholdOperationRecoveryCounters {
  passes: number;
  skippedNoPermit: number;
  discovered: number;
  applied: number;
  closed: number;
  held: number;
  unknownKind: number;
  threw: number;
}

/** Fresh zeroed recovery counters: the one initializer the recovery pass and
 *  the authority registry's unregistered answer share. */
export function createFreeholdOperationRecoveryCounters(): FreeholdOperationRecoveryCounters {
  return {
    passes: 0,
    skippedNoPermit: 0,
    discovered: 0,
    applied: 0,
    closed: 0,
    held: 0,
    unknownKind: 0,
    threw: 0,
  };
}

export interface FreeholdOperationRecoveryDeps {
  readonly reconcilers: ReadonlyMap<string, FreeholdOperationReconciler>;
  discover(accountId: number): Promise<OpenFreeholdOperation[]>;
  tryAcquirePermit(): { release(): void } | null;
  /** Keeps the plot's claim wanted while its intent is being reconciled. */
  holdInFlight(plotId: string): () => void;
  warn(message: string): void;
}

export function createFreeholdOperationRecovery(deps: FreeholdOperationRecoveryDeps): {
  /** Fire and forget; never rejects. */
  schedule(accountId: number): void;
  /** Resolves when every scheduled pass has settled (a test read: the
   *  shutdown closure does not wait on recovery, which no kind can reach in
   *  this release). */
  idle(): Promise<void>;
  readonly counters: FreeholdOperationRecoveryCounters;
} {
  const counters = createFreeholdOperationRecoveryCounters();
  const running = new Map<number, Promise<void>>();

  async function pass(accountId: number): Promise<void> {
    const permit = deps.tryAcquirePermit();
    if (!permit) {
      counters.skippedNoPermit++;
      return;
    }
    try {
      counters.passes++;
      const open = await deps.discover(accountId);
      counters.discovered += open.length;
      let unknown = 0;
      for (const intent of open) {
        const reconciler = deps.reconcilers.get(intent.kind);
        if (!reconciler) {
          unknown++;
          counters.unknownKind++;
          continue;
        }
        const release = intent.plotId === null ? () => {} : deps.holdInFlight(intent.plotId);
        try {
          const result = await reconciler.reconcile(intent);
          counters[result]++;
        } catch {
          counters.threw++;
        } finally {
          release();
        }
      }
      if (unknown > 0) {
        deps.warn(
          `freehold operation recovery held ${unknown} open intent(s) of an unregistered kind`,
        );
      }
    } catch {
      counters.threw++;
    } finally {
      permit.release();
    }
  }

  return {
    schedule(accountId) {
      if (deps.reconcilers.size === 0) return;
      if (!Number.isSafeInteger(accountId) || accountId <= 0) return;
      if (running.has(accountId)) return;
      const tracked = pass(accountId).finally(() => {
        if (running.get(accountId) === tracked) running.delete(accountId);
      });
      running.set(accountId, tracked);
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running.values()]);
    },
    counters,
  };
}
