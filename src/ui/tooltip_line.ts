// Generic tooltip body line via createElement + textContent.
// Used by raw-cooking-catch purpose hints (and any later tt-desc / tt-sub
// call site that wants a createElement path without HTML template strings).
// Not a pure core: needs document. Prefer this over new innerHTML builders.

export type TooltipLineClass = 'tt-desc' | 'tt-sub';

/** Optional modifier stacked on the base class; extend the union per use.
 *  tt-material-use: the profession-affinity Used-by line's craft tint. */
export type TooltipLineModifier = 'tt-material-use';

/**
 * Build one muted description (or sub) line for the shared #tooltip box.
 * Sets text with textContent only; never assigns innerHTML.
 */
export function createTooltipLine(
  text: string,
  className: TooltipLineClass = 'tt-desc',
  modifier?: TooltipLineModifier,
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = modifier ? `${className} ${modifier}` : className;
  el.textContent = text;
  return el;
}
