// The live drawn-position source for effects attached to a unit (see
// attached_fx_anchor_core.ts for why they must never ride `e.pos`).
//
// The encounter effects host (rift_death_zone.ts) installs the renderer's
// view lookup when it is built and removes it on dispose; every painter that
// pins a mesh to a unit calls `fxAnchor(e)` for the x/z it draws at. With no
// lookup installed (a headless test, before the host loads) it is `e.pos`.

import {
  type DrawnPositionLookup,
  type FxAnchoredEntity,
  type FxAnchorVec,
  resolveFxAnchor,
} from './attached_fx_anchor_core';

export type { DrawnPositionLookup, FxAnchorVec } from './attached_fx_anchor_core';
export { FX_REDRAPE_YD, needsRedrape } from './attached_fx_anchor_core';

let installed: DrawnPositionLookup | null = null;

/** Install the drawn-position lookup; returns the matching uninstall, which
 *  only clears the source if it is still the one it installed. */
export function installDrawnPositions(lookup: DrawnPositionLookup): () => void {
  installed = lookup;
  return () => {
    if (installed === lookup) installed = null;
  };
}

/** Where an effect attached to `e` sits this frame (the drawn pose). */
export function fxAnchor(e: FxAnchoredEntity): FxAnchorVec {
  return resolveFxAnchor(e, installed);
}
