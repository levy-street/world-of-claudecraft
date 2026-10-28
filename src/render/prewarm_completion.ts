import type { RendererPrewarmCompileUnitStats } from './prewarm_compile_lifecycle';
import type { StartedPrewarmEntryOutcome } from './prewarm_entry';
import { orderPrewarmResumeEntries, prewarmResumeIsDebt } from './prewarm_policy';
import type { PrewarmResumeEntry, PrewarmResumeHooks } from './prewarm_resume';
import { resumeDroppedPrewarmEntries } from './prewarm_resume';
import type { PrewarmResumeLedger } from './prewarm_resume_ledger_core';

/** A watchdog, not permission to publish unfinished desktop shader work. */
export const COMPLETE_PREWARM_WATCHDOG_MS = 180_000;

export class PrewarmCompletionError extends Error {
  constructor(detail: string) {
    super(`Shader preparation did not complete: ${detail}`);
    this.name = 'PrewarmCompletionError';
  }
}

/** The mobile process-survival path and synchronous drivers keep streaming. */
export function completeDesktopPrewarm(constrainedMemory: boolean, asyncCompile: boolean): boolean {
  return !constrainedMemory && asyncCompile;
}

/** Capped view discovery is deliberately partial; finite shader catalogs are not. */
export function assertCompletePrewarmEntry(id: string, outcome: StartedPrewarmEntryOutcome): void {
  if (
    outcome.status === 'failed' ||
    (outcome.status === 'partial' && !id.startsWith('views.') && outcome.partialUnits.length === 0)
  ) {
    throw new PrewarmCompletionError(`${id}: ${outcome.status}`);
  }
}

/** Fail the loading contract promptly, but let non-cancellable driver work settle
 * before destroying its material/geometry owners. No later queued unit may start. */
export class PrewarmCompletionScope {
  private stopped = false;
  private readonly pending = new Set<Promise<unknown>>();
  check(): void {
    if (this.stopped) throw new PrewarmCompletionError('preparation cancelled');
  }
  track<T>(task: Promise<T>): Promise<T> {
    this.pending.add(task);
    const forget = () => this.pending.delete(task);
    void task.then(forget, forget);
    return task;
  }
  fail(error: unknown, cleanup: () => void): never {
    this.stopped = true;
    void Promise.allSettled([...this.pending])
      .then(cleanup)
      .catch((failure) => console.warn('Prewarm cleanup failed', failure));
    throw error instanceof PrewarmCompletionError
      ? error
      : new PrewarmCompletionError(String(error));
  }
}

/** Clear the timer on either outcome; a stuck driver must never hold loading forever. */
export async function awaitPrewarmCompletion<T>(
  task: Promise<T>,
  remainingMs: number,
  label: string,
): Promise<T> {
  if (remainingMs <= 0) {
    // The caller may already have submitted a non-cancellable driver link.
    // Observe its eventual failure even though the entry watchdog has expired.
    void task.catch(() => {});
    throw new PrewarmCompletionError(`${label}: watchdog expired`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PrewarmCompletionError(`${label}: watchdog expired`)),
          Math.max(0, remainingMs),
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A failed link is not paid debt, even if its asynchronous task settled. */
export function assertPrewarmLinksSettled(
  records: readonly RendererPrewarmCompileUnitStats[],
): void {
  const unpaid = records.filter((entry) => entry.failedAtMs !== null || entry.settledAtMs === null);
  if (unpaid.length) throw new PrewarmCompletionError(unpaid.map((entry) => entry.id).join(', '));
}

/** Preserve every small resume unit and its error attribution, but reject an incomplete drain. */
export async function completePrewarmRemainder(
  entries: readonly PrewarmResumeEntry[],
  hooks: PrewarmResumeHooks<PrewarmResumeEntry>,
): Promise<void> {
  const failed: string[] = [];
  await resumeDroppedPrewarmEntries(entries, {
    ...hooks,
    onUnitError(entry, unit, error) {
      failed.push(`${entry.id}:${unit.id}`);
      hooks.onUnitError?.(entry, unit, error);
    },
  });
  if (failed.length) throw new PrewarmCompletionError(failed.join(', '));
}

/** The same bounded units run before desktop reveal or after constrained entry. */
export async function settleInitialPrewarmRemainder(options: {
  entries: readonly PrewarmResumeEntry[];
  ledger: PrewarmResumeLedger;
  submitted: readonly { done: Promise<void> }[];
  hooks: PrewarmResumeHooks<PrewarmResumeEntry>;
  afterFirstPaint?: Promise<void>;
  publish(): void;
}): Promise<void> {
  const resume = orderPrewarmResumeEntries(options.entries);
  options.ledger.schedule(resume, prewarmResumeIsDebt);
  try {
    await options.afterFirstPaint;
    await Promise.all(options.submitted.map((unit) => unit.done));
    await completePrewarmRemainder(resume, options.hooks);
    options.ledger.finish(true);
  } catch (error) {
    options.ledger.finish(false);
    throw error;
  } finally {
    options.publish();
  }
}
