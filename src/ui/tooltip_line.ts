// Generic tooltip body line via createElement + textContent.
// Used by raw-cooking-catch purpose hints (and any later tt-desc / tt-sub
// call site that wants a createElement path without HTML template strings).
// Not a pure core: needs document. Prefer this over new innerHTML builders.

export type TooltipLineClass = 'tt-desc' | 'tt-sub';

/**
 * Build one muted description (or sub) line for the shared #tooltip box.
 * Sets text with textContent only; never assigns innerHTML.
 */
export function createTooltipLine(
  text: string,
  className: TooltipLineClass = 'tt-desc',
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}
