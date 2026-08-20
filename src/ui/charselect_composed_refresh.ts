import {
  isComposedPortraitKey,
  onPortraitsReady,
  onPortraitUpdate,
  portraitsReady,
} from '../render/characters/portrait';

/** The character-select roster's repaint hook for composed portraits.
 *
 * A composed chip is HTML built from a look, not a src `hydratePortraits` can
 * swap, and the capture behind it lands frames after the row was built. Rows
 * register here so the landed capture repaints them; without that, a row built
 * while its capture is in flight keeps the class crest for the whole session.
 */

/** Anything with a liveness flag: the roster passes its `<li>`, a test passes a
 *  plain object, and this module never touches the DOM itself. */
export interface ComposedRowTarget {
  readonly isConnected: boolean;
}

type RowRebuild = () => void;

const tracked: Array<{ row: ComposedRowTarget; rebuild: RowRebuild }> = [];
let subscribed = false;

/** Repaint `row` through `rebuild` whenever any composed capture lands.
 *
 * A composed update names its subject by look signature, which no caller can
 * match against a row, so every tracked row rebuilds on every composed key.
 * That is cheap and correct: a rebuild re-asks the portrait getter, where a
 * landed capture is a cache hit and an in-flight one is deduped. */
export function trackComposedRow(row: ComposedRowTarget, rebuild: RowRebuild): void {
  if (!subscribed) {
    subscribed = true;
    onPortraitUpdate((_visualKey, _skin, key) => {
      if (!isComposedPortraitKey(key)) return;
      for (const entry of tracked) if (entry.row.isConnected) entry.rebuild();
    });
  }
  tracked.push({ row, rebuild });
}

/** Drop every tracked row. Call it wherever the roster is cleared, or rows from
 *  the previous load stay registered for the rest of the session. */
export function resetComposedRows(): void {
  tracked.length = 0;
}

/** The slice of a roster row the chip repaint reads: the row's liveness and
 *  its composed chip element (an outerHTML swap replaces it). */
export interface ComposedChipRow extends ComposedRowTarget {
  querySelector(selector: string): { readonly isConnected: boolean; outerHTML: string } | null;
}

/**
 * The roster's own repaint: swap the row's composed chip for a fresh
 * `chipHtml()` and re-arm its crest fallbacks through `hydrate` (the
 * module-scope onPortraitsReady arming in portrait_chip.ts ran at import time,
 * before this row existed, so the fresh img needs its own arming or a blocked
 * crest asset never falls back). Registered for the landed capture, and also
 * once for the assets landing when the row is built before the portrait
 * renderer is ready (the crest shows until then).
 */
export function trackComposedChipRow(
  row: ComposedChipRow,
  chipHtml: () => string,
  hydrate: () => void,
): void {
  const rebuild = (): void => {
    const chip = row.querySelector('.portrait-chip[data-portrait-composed]');
    if (!chip?.isConnected) return;
    chip.outerHTML = chipHtml();
    hydrate();
  };
  trackComposedRow(row, rebuild);
  if (!portraitsReady()) onPortraitsReady(rebuild);
}
