// Idle-time icon cache warmer. Procedural icons (src/ui/icons.ts) compose a
// canvas and serialize it with toDataURL on first request, ~3-8ms per unique
// icon; a first vendor/bags/loot open over a cold cache used to pay that for
// every visible item at once, a 60-300ms synchronous burst. This walks the
// likely-needed icon ids during requestIdleCallback slices (setTimeout paced
// fallback, same pattern as the hud's map prewarm) so the first window open
// finds the shared urlCache already hot. Purely a cache warmer: rendering is
// visually identical with or without it, and it never blocks a frame.
import { ABILITIES, ITEMS } from '../sim/data';
import { type IconKind, needsIconDataUrlWarm, storePrewarmedIconDataUrl } from './icons';

export type IconPrewarmEntry = { kind: IconKind; id: string; size?: number };
export type IconPrewarmPlan = { entries: IconPrewarmEntry[]; priorityCount: number };

// Procedural chrome icons are not content-table entries, so a catalog walk
// would never reach them. They are common first-open paths (action bar, bags,
// paperdoll and loot) and belong in the eager loading-screen prefix.
const CORE_UI_ICON_ENTRIES: readonly IconPrewarmEntry[] = [
  { kind: 'ability', id: 'attack' },
  { kind: 'item', id: 'backpack' },
  { kind: 'item', id: 'coin_gold' },
  { kind: 'item', id: 'slot_empty' },
];

// Hard time budget per pump callback. One icon composes in ~3-8ms, so the
// budget is checked BEFORE each icon (never between batches): a callback can
// overshoot by at most one icon, not one batch. requestIdleCallback deadlines
// are estimates; trusting them across a whole batch produced real 60-100ms
// long tasks in CPU profiles of the first minute of play.
const SLICE_BUDGET_MS = 6;
const DEFAULT_ICON_SIZE = 96;

type WorkerResponse = { requestId: number; blob?: Blob; error?: string };
type WorkerWaiter = { resolve: (blob: Blob) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 1;
const workerWaiters = new Map<number, WorkerWaiter>();
const pendingUrlWarms = new Map<string, Promise<void>>();

function rejectWorkerWaiters(error: Error): void {
  for (const waiter of workerWaiters.values()) waiter.reject(error);
  workerWaiters.clear();
}

function iconWorker(): Worker | null {
  if (
    workerUnavailable ||
    typeof Worker === 'undefined' ||
    typeof OffscreenCanvas === 'undefined'
  ) {
    return null;
  }
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./icon_prewarm_worker.ts', import.meta.url), { type: 'module' });
  } catch {
    workerUnavailable = true;
    return null;
  }
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const waiter = workerWaiters.get(response.requestId);
    if (!waiter) return;
    workerWaiters.delete(response.requestId);
    if (response.blob) waiter.resolve(response.blob);
    else waiter.reject(new Error(response.error ?? 'Icon worker returned no PNG'));
  });
  const disableWorker = (): void => {
    workerUnavailable = true;
    worker?.terminate();
    worker = null;
    rejectWorkerWaiters(new Error('Icon prewarm worker failed'));
  };
  worker.addEventListener('error', disableWorker);
  worker.addEventListener('messageerror', disableWorker);
  return worker;
}

function requestWorkerIcon(kind: IconKind, id: string, size: number): Promise<Blob> | null {
  const activeWorker = iconWorker();
  if (!activeWorker) return null;
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    workerWaiters.set(requestId, { resolve, reject });
    activeWorker.postMessage({ requestId, kind, id, size });
  });
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read procedural icon PNG'));
    });
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Icon PNG read failed')),
    );
    reader.addEventListener('abort', () => reject(new Error('Icon PNG read aborted')));
    reader.readAsDataURL(blob);
  });
}

function prewarmIconDataUrl(
  kind: IconKind,
  id: string,
  size = DEFAULT_ICON_SIZE,
): void | Promise<void> {
  if (!needsIconDataUrlWarm(kind, id, size)) return;
  const key = `${kind}|${id}|${size}`;
  const existing = pendingUrlWarms.get(key);
  if (existing) return existing;
  const blob = requestWorkerIcon(kind, id, size);
  // Unsupported browsers keep the normal synchronous demand path. Crucially,
  // they do not run a known 50-100ms PNG encoder during active gameplay.
  if (!blob) return;
  const pending = blob
    .then(blobDataUrl)
    .then((url) => storePrewarmedIconDataUrl(kind, id, size, url))
    .finally(() => pendingUrlWarms.delete(key));
  pendingUrlWarms.set(key, pending);
  return pending;
}

/** Build the complete icon warmup list, with runtime-relevant entries first.
 *  The priority prefix is stable-deduplicated both against itself and the full
 *  catalog so the caller can run exactly that prefix eagerly while a loading
 *  screen still hides the world. */
export function defaultIconPrewarmPlan(
  priorityEntries: readonly IconPrewarmEntry[] = [],
): IconPrewarmPlan {
  const entries: IconPrewarmEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: IconPrewarmEntry): void => {
    const key = `${entry.kind}|${entry.id}|${entry.size ?? DEFAULT_ICON_SIZE}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };
  for (const entry of priorityEntries) push(entry);
  for (const entry of CORE_UI_ICON_ENTRIES) push(entry);
  const priorityCount = entries.length;
  for (const id of Object.keys(ITEMS)) push({ kind: 'item', id });
  for (const id of Object.keys(ABILITIES)) push({ kind: 'ability', id });
  return { entries, priorityCount };
}

/** Every icon the item/ability windows can ask for: the whole item catalog
 *  (bags, vendor, loot, market, quest rewards) plus every ability (action bar,
 *  spellbook, buff/debuff rows reuse ability art for most auras). Bounded by
 *  the content tables (a few hundred entries), not by runtime state. */
export function defaultIconPrewarmEntries(): IconPrewarmEntry[] {
  return defaultIconPrewarmPlan().entries;
}

type IdleDeadline = { timeRemaining(): number };
type IdleWindow = typeof window & {
  requestIdleCallback?: (cb: (d: IdleDeadline) => void, opts?: { timeout: number }) => number;
};

/** Warm the icon data-URL cache for `entries` during idle time. Returns a
 *  cancel function; cancelling is OPTIONAL (the pump drains a bounded list once
 *  and self-terminates, and a re-run over a warm cache is a fast no-op), it just
 *  stops the remaining slices early. `warm` is injectable for tests; a single
 *  failing recipe is skipped rather than aborting the pump. */
export function prewarmIconCache(
  entries: IconPrewarmEntry[],
  opts: {
    warm?: (kind: IconKind, id: string, size: number) => void | Promise<void>;
    now?: () => number;
    /** Leading entries to dispatch without waiting for an idle deadline. This is
     *  intended for the small, player-specific prefix while loading is visible;
     *  each asynchronous worker encode remains serialized. */
    eagerCount?: number;
  } = {},
): () => void {
  const warm = opts.warm ?? prewarmIconDataUrl;
  const now = opts.now ?? (() => performance.now());
  const eagerCount = Math.min(entries.length, Math.max(0, Math.floor(opts.eagerCount ?? 0)));
  let next = 0;
  let cancelled = false;

  const pump = (deadline?: IdleDeadline): void => {
    if (cancelled) return;
    const start = now();
    const eagerSlice = next < eagerCount;
    while (next < entries.length) {
      if (eagerSlice && next >= eagerCount) break;
      // budget checked per ICON: stop when either our own wall-clock budget is
      // spent or the idle deadline says the frame needs the thread back
      if (now() - start >= SLICE_BUDGET_MS) break;
      if (deadline !== undefined && deadline.timeRemaining() <= 3) break;
      const entry = entries[next++];
      try {
        const result = warm(entry.kind, entry.id, entry.size ?? DEFAULT_ICON_SIZE);
        if (result) {
          // Keep only one worker encode in flight instead of queueing hundreds
          // of procedural icons at once.
          void result
            .catch(() => {
              // The normal on-demand path remains available for this icon.
            })
            .then(() => {
              if (!cancelled && next < entries.length) schedule();
            });
          return;
        }
      } catch {
        // one bad recipe must not kill the warmer; the icon falls back to
        // its normal on-demand path (which surfaces the same failure)
      }
    }
    if (next < entries.length) schedule();
  };

  const schedule = (): void => {
    const w = window as IdleWindow;
    // Keep the worker busy with the small priority prefix while loading is
    // visible. A zero-delay task prevents promise continuations from recursing
    // and still yields to rendering between every encoded icon.
    if (next < eagerCount) {
      window.setTimeout(() => pump(), 0);
      return;
    }
    if (w.requestIdleCallback) w.requestIdleCallback(pump, { timeout: 2000 });
    else window.setTimeout(() => pump(), 32);
  };

  if (entries.length > 0) schedule();
  return () => {
    cancelled = true;
  };
}
