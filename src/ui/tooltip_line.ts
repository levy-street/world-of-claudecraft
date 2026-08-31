// Generic tooltip body line via createElement + textContent.
// Used by raw-cooking-catch purpose hints (and any later tt-desc / tt-sub
// call site that wants a createElement path without HTML template strings).
// Not a pure core: needs document. Prefer this over new innerHTML builders.
//
// THE CLASS VOCABULARY IS NOT OWNED HERE. tooltip_line_core.ts owns the one
// TooltipLineClass union for the whole tooltip-line family, and this module
// NARROWS it. Both were briefly declared independently (this module's two
// roles, the core's four), which put two same-named exported unions with
// DIFFERENT members in one directory: an author importing TooltipLineClass got
// whichever module the autoimport picked. Deriving with Extract is what stops
// the two from drifting apart again, because dropping a role from the core
// narrows this alias to `never` and reds the default parameter below rather
// than leaving a second union to keep in sync by hand.

import type { TooltipLineClass } from './tooltip_line_core';

/** The subset this createElement path paints. The HTML-string builder's
 *  tt-green and tt-red roles are deliberately absent: no call site here has
 *  wanted them, and widening is a one-word edit when one does. */
export type TooltipLineElementClass = Extract<TooltipLineClass, 'tt-desc' | 'tt-sub'>;

/** Optional modifier stacked on the base class; extend the union per use.
 *  tt-material-use: the profession-affinity Used-by line's craft tint. */
export type TooltipLineModifier = 'tt-material-use';

/**
 * Build one muted description (or sub) line for the shared #tooltip box.
 * Sets text with textContent only; never assigns innerHTML.
 */
export function createTooltipLine(
  text: string,
  className: TooltipLineElementClass = 'tt-desc',
  modifier?: TooltipLineModifier,
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = modifier ? `${className} ${modifier}` : className;
  el.textContent = text;
  return el;
}
