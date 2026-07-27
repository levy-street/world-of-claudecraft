// Pure, host-agnostic core for the bag grid's per-copy corner glyph.
// Every instanced stack used to render ONE marker, a bare gold wedge, so a
// maker-signed copy, an enchanted copy, and a bind-on-trade reagent were
// visually identical: the wedge said "this copy is special" and nothing more.
// This resolves the payload to exactly ONE glyph KIND, so the corner says WHICH
// kind of special it is.
//
// A copy can carry several markers at once (a crafted piece that was signed,
// enchanted, and is bind-on-trade is one stack), so the kinds are a strict
// PRIORITY, most-specific first:
//   1. masterwork  - keeps the authored seal image, exactly as before
//   2. enchanted   - isEnchantedInstance (the explicit marker, or a legacy bare
//                    rolled.stats copy without the masterwork flag)
//   3. signed      - a maker's mark (instance.signer)
//   4. bound       - the Maker's Bond (bindOnTrade, or already boundTo someone)
//   5. generic     - an instanced copy carrying none of the above; keeps the
//                    pre-existing wedge so no payload silently loses its marker
// The glyph is information-ADD and aria-hidden: the accessible name and the
// tooltip carry the semantics, and it renders identically on every graphics
// preset (no --fx gate), so it never becomes a fairness lever.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { isEnchantedInstance } from '../sim/professions/enchanting';
import type { ItemInstancePayload } from '../sim/types';

export type BagInstanceGlyphKind =
  | 'masterwork'
  | 'enchanted'
  | 'signed'
  | 'bound'
  | 'generic'
  | null;

/** The single glyph kind for one bag stack's payload, or null for a plain
 *  fungible stack (no payload, no corner glyph). */
export function bagInstanceGlyphKind(instance?: ItemInstancePayload): BagInstanceGlyphKind {
  if (!instance) return null;
  if (instance.rolled?.masterwork === true) return 'masterwork';
  if (isEnchantedInstance(instance)) return 'enchanted';
  if (instance.signer !== undefined) return 'signed';
  if (instance.bindOnTrade === true || instance.boundTo !== undefined) return 'bound';
  return 'generic';
}
