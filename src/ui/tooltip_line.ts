// Generic tooltip body line via createElement + textContent.
// Used by raw-cooking-catch purpose hints (and any later tt-desc / tt-sub
// call site that wants a createElement path without HTML template strings).
// Not a pure core: needs document. This is the node-returning path: it hands
// back a detached div for a caller that wants an element rather than markup.
//
// RULED (qr-19-tooltip-line-doctrine, 2026-09-01, under
// qr-19-best-for-project): the header's old "prefer this over new innerHTML
// builders" line is RETIRED as a stated preference, deliberately rather than
// dropped. It lost on the merits: this module has ONE importer while the
// HTML-string line family (tooltip_line_core.ts) has four modules and 27 call
// sites, and a preference the tree has contradicted that thoroughly is worse
// than no preference. NOTHING ABOUT SAFETY CHANGES. The string path is not the
// unsafe one, every line's text goes through esc(), and src/ui/CLAUDE.md's
// standing rule against writing raw player or server text as markup is
// untouched. Pick between the two mechanisms by RETURN TYPE: this one returns
// an HTMLDivElement, tooltipLine returns a string. And note what the tree
// actually does with the node, since calling this "the node-returning path"
// alone would overstate it: both live callers take the element and bridge it
// straight back into the composed tooltip string, so today this path buys
// text-set-by-construction at the mint, not a separate render.
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
