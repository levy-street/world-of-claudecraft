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

import { esc } from './esc';

export type TooltipLineClass = 'tt-sub' | 'tt-desc' | 'tt-green' | 'tt-red';

/** One tooltip line. The text is always escaped, never interpolated raw: every
 *  caller reaches localized item and recipe names (the src/ui esc() rule). */
export function tooltipLine(cls: TooltipLineClass, text: string): string {
  return `<div class="${cls}">${esc(text)}</div>`;
}
