// Idle-time icon cache warmer. Procedural icons (src/ui/icons.ts) compose a
// canvas and serialize it with toDataURL on first request, ~3-8ms per unique
// icon; a first vendor/bags/loot open over a cold cache used to pay that for
// every visible item at once, a 60-300ms synchronous burst. This walks the
// likely-needed icon ids during requestIdleCallback slices (setTimeout paced
// fallback, same pattern as the hud's map prewarm) so the first window open
// finds the shared urlCache already hot. Purely a cache warmer: rendering is
// byte-identical with or without it, and it never blocks a frame.
import { ABILITIES, ITEMS } from '../sim/data';
import { type IconKind, iconDataUrl } from './icons';

export type IconPrewarmEntry = { kind: IconKind; id: string };

// Hard time budget per pump callback. One icon composes in ~3-8ms, so the
// budget is checked BEFORE each icon (never between batches): a callback can
// overshoot by at most one icon, not one batch. requestIdleCallback deadlines
// are estimates; trusting them across a whole batch produced real 60-100ms
// long tasks in CPU profiles of the first minute of play.
const SLICE_BUDGET_MS = 6;

/** Every icon the item/ability windows can ask for: the whole item catalog
 *  (bags, vendor, loot, market, quest rewards) plus every ability (action bar,
 *  spellbook, buff/debuff rows reuse ability art for most auras). Bounded by
 *  the content tables (a few hundred entries), not by runtime state. */
export function defaultIconPrewarmEntries(): IconPrewarmEntry[] {
  const entries: IconPrewarmEntry[] = [];
  for (const id of Object.keys(ITEMS)) entries.push({ kind: 'item', id });
  for (const id of Object.keys(ABILITIES)) entries.push({ kind: 'ability', id });
  return entries;
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
  opts: { warm?: (kind: IconKind, id: string) => void; now?: () => number } = {},
): () => void {
  const warm = opts.warm ?? ((kind: IconKind, id: string) => void iconDataUrl(kind, id));
  const now = opts.now ?? (() => performance.now());
  let next = 0;
  let cancelled = false;

  const pump = (deadline?: IdleDeadline): void => {
    if (cancelled) return;
    const start = now();
    while (next < entries.length) {
      // budget checked per ICON: stop when either our own wall-clock budget is
      // spent or the idle deadline says the frame needs the thread back
      if (now() - start >= SLICE_BUDGET_MS) break;
      if (deadline !== undefined && deadline.timeRemaining() <= 3) break;
      const entry = entries[next++];
      try {
        warm(entry.kind, entry.id);
      } catch {
        // one bad recipe must not kill the warmer; the icon falls back to
        // its normal on-demand path (which surfaces the same failure)
      }
    }
    if (next < entries.length) schedule();
  };

  const schedule = (): void => {
    const w = window as IdleWindow;
    if (w.requestIdleCallback) w.requestIdleCallback(pump, { timeout: 2000 });
    else window.setTimeout(() => pump(), 32);
  };

  if (entries.length > 0) schedule();
  return () => {
    cancelled = true;
  };
}
