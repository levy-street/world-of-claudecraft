// Event wiring for a chroma (skin) picker row, extracted from main.ts so the
// hover-preview behavior is unit-testable. The row itself (portrait swatches,
// aria labels, i18n) is built by the caller; this module only wires the
// interactions:
//   - hover a swatch -> preview that chroma on the avatar
//   - click a swatch -> commit it (move the `sel` class) and notify the caller
//   - leave the ROW  -> revert the preview to the committed selection
//
// The revert is bound ONCE on the row, not per swatch. A per-swatch mouseleave
// fires on every move BETWEEN adjacent swatches, and that revert raced the
// neighbor's mouseenter: hovering the swatch next to the selected one reverted
// the preview instead of showing it (issue 1464). A row-level mouseleave does
// not fire on child-to-child transitions, so every swatch previews consistently
// while the revert still happens exactly when the pointer leaves the picker.

export interface SkinPickerHooks {
  /** Hovering a swatch: preview that chroma. */
  onPreview: (skin: number) => void;
  /** Leaving the whole picker: revert to the committed selection. */
  onRevert: (skin: number) => void;
  /** Clicking a swatch: commit that chroma. */
  onPick: (skin: number) => void;
}

// The picker row is a persistent element (renderSkinPicker replaces its swatches
// with innerHTML = '' but keeps the row), and it is re-rendered on every class
// switch. Track the controller from the last wiring per row so we can abort its
// listeners before wiring again: otherwise the row-level mouseleave handler would
// stack on every re-render, firing stale reverts and retaining removed swatches.
const ROW_CONTROLLERS = new WeakMap<HTMLElement, AbortController>();

/** Wire a built list of skin swatches (each carrying `dataset.skin` and the
 *  `sel` class on the initially-selected one) for hover-preview, click-commit,
 *  and revert-on-leave. `fallback` is the skin to revert to if no swatch is
 *  marked selected. Safe to call repeatedly on the same row: each call replaces
 *  the previous wiring rather than stacking on it. */
export function wireSkinPicker(
  row: HTMLElement,
  swatches: HTMLElement[],
  fallback: number,
  hooks: SkinPickerHooks,
): void {
  ROW_CONTROLLERS.get(row)?.abort();
  const controller = new AbortController();
  ROW_CONTROLLERS.set(row, controller);
  const { signal } = controller;
  const selectedSkin = (): number => {
    for (const s of swatches) {
      if (s.classList.contains('sel')) {
        const n = Number(s.dataset.skin);
        return Number.isFinite(n) ? n : fallback;
      }
    }
    return fallback;
  };
  for (const b of swatches) {
    const raw = Number(b.dataset.skin);
    const skin = Number.isFinite(raw) ? raw : fallback;
    b.addEventListener(
      'click',
      () => {
        for (const s of swatches) s.classList.remove('sel');
        b.classList.add('sel');
        hooks.onPick(skin);
      },
      { signal },
    );
    b.addEventListener('mouseenter', () => hooks.onPreview(skin), { signal });
  }
  row.addEventListener('mouseleave', () => hooks.onRevert(selectedSkin()), { signal });
}
