// The ONE tooltip line builder the item-card string builders share (the
// gathering-tool card, the tool-effect charm card, the mobile-station card and
// the recipe-pattern card). Four byte-identical private copies had formed, one
// per builder, which is past the repo's rule of three, so the markup and its
// escaping live here once instead.
//
// Emit-only and DOM-free (a registered UI_PURE_CORES module): it returns the
// exact `<div class="...">escaped text</div>` string every copy returned, so
// the collapse changed no rendered byte on any of the four surfaces
// (tests/tooltip_line_core.test.ts pins all four builders' output verbatim).
//
// The class union is the FAMILY's, not any one builder's: each private copy
// carried only the subset its own file happened to use, and folding them puts
// the four line roles in one place (tt-sub a secondary line, tt-desc a body
// line, tt-green a benefit, tt-red an unmet gate or a refusal). A builder that
// needs a fifth role adds it here, never a fifth private copy.
//
// THIS MODULE OWNS TooltipLineClass FOR THE WHOLE FAMILY, both mechanisms.
// The sibling DOM path (tooltip_line.ts createTooltipLine, createElement plus
// textContent) NARROWS this union with Extract rather than declaring its own,
// because for one commit the two modules exported the same name with DIFFERENT
// members and an author got whichever the autoimport picked. Widening here
// widens what that path may narrow FROM; it never silently widens the path
// itself, which names its own subset.
//
// WHICH MECHANISM A NEW CALLER PICKS is the return type, not a preference.
// Take this builder when the caller is composing a markup string (the
// item-card path, where the four consumers above live), and tooltip_line.ts
// createTooltipLine when it appends an element to a live node. Neither is the
// safe one and neither is deprecated: the text is escaped here and set with
// textContent there. Recorded because the sibling module used to state a
// preference for its own path that the tree had long since contradicted, and
// retiring that preference (qr-19-tooltip-line-doctrine, 2026-09-01) is only
// useful if something says how to choose instead.

import { esc } from './esc';

export type TooltipLineClass = 'tt-sub' | 'tt-desc' | 'tt-green' | 'tt-red';

/** One tooltip line. The text is always escaped, never interpolated raw: every
 *  caller reaches localized item and recipe names (the src/ui esc() rule). */
export function tooltipLine(cls: TooltipLineClass, text: string): string {
  return `<div class="${cls}">${esc(text)}</div>`;
}
