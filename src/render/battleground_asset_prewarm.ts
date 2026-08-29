// Intent-driven, bounded asset warming for Thornhollow Fields.
//
// The field is secondary-context content: loading it for every player at the
// first interactive frame caused the exact entry hitch this lane is meant to
// avoid. A preview (opening the Thornhollow tab) may be paused between small
// batches; joining the queue commits the same idempotent drain to completion.
// Asset loaders retain their own fetch/decode concurrency limits. This module
// adds no global queue: it only sequences this one field through idle slots.

export interface BattlegroundAssetPrewarmUnit {
  id: string;
  run(): Promise<unknown>;
}

export interface BattlegroundAssetPrewarmSnapshot {
  active: boolean;
  committed: boolean;
  completed: number;
  total: number;
  failed: string[];
}

export interface BattlegroundAssetPrewarm {
  startPreview(): void;
  pausePreview(): void;
  /** Queue/proposal intent: cannot be paused and resolves after every unit settled. */
  commit(): Promise<void>;
  /** Test/diagnostic seam for the currently-running preview drain. */
  whenPausedOrComplete(): Promise<void>;
  snapshot(): BattlegroundAssetPrewarmSnapshot;
}

export interface BattlegroundAssetPrewarmOptions {
  idle(): Promise<unknown>;
  batchSize?: number;
}

type UnitPlan =
  | readonly BattlegroundAssetPrewarmUnit[]
  | (() => readonly BattlegroundAssetPrewarmUnit[]);

export function createBattlegroundAssetPrewarm(
  source: UnitPlan,
  options: BattlegroundAssetPrewarmOptions,
): BattlegroundAssetPrewarm {
  let plan: readonly BattlegroundAssetPrewarmUnit[] | null = null;
  let next = 0;
  let active = false;
  let committed = false;
  let running: Promise<void> | null = null;
  let committedPromise: Promise<void> | null = null;
  let resolveCommitted: (() => void) | null = null;
  const failed: string[] = [];
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 2));

  const units = (): readonly BattlegroundAssetPrewarmUnit[] =>
    (plan ??= typeof source === 'function' ? source() : source);

  const finishCommitted = (): void => {
    if (!committed || next < units().length) return;
    active = false;
    resolveCommitted?.();
    resolveCommitted = null;
  };

  const drain = (): Promise<void> => {
    if (running) return running;
    active = true;
    running = (async () => {
      const work = units();
      while ((active || committed) && next < work.length) {
        await options.idle();
        if (!active && !committed) break;
        const batch = work.slice(next, next + batchSize);
        next += batch.length;
        const outcomes = await Promise.allSettled(batch.map((unit) => unit.run()));
        for (let i = 0; i < outcomes.length; i++) {
          if (outcomes[i].status === 'rejected') failed.push(batch[i].id);
        }
      }
    })().finally(() => {
      running = null;
      finishCommitted();
      // A commit can arrive while a preview drain is unwinding after a pause.
      if (committed && next < units().length) void drain();
    });
    return running;
  };

  return {
    startPreview(): void {
      if (next >= units().length) return;
      active = true;
      void drain();
    },
    pausePreview(): void {
      if (!committed) active = false;
    },
    commit(): Promise<void> {
      if (committedPromise) return committedPromise;
      committed = true;
      active = true;
      committedPromise = new Promise<void>((resolve) => {
        resolveCommitted = resolve;
      });
      if (next >= units().length) finishCommitted();
      else void drain();
      return committedPromise;
    },
    whenPausedOrComplete(): Promise<void> {
      return running ?? Promise.resolve();
    },
    snapshot(): BattlegroundAssetPrewarmSnapshot {
      const work = units();
      return {
        active: active && next < work.length,
        committed,
        completed: next,
        total: work.length,
        failed: [...failed],
      };
    },
  };
}
