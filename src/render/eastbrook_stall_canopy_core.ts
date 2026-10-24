// The Eastbrook market stall's canopy, repainted where the town draws it.
//
// The stall model (scripts/assets/eastbrook_town/furniture.js,
// buildMarketStall) paints its canopy as three panels side by side, blue,
// cream and red, which reads as a national flag rather than a market awning.
// Re-exporting the model would re-fingerprint the whole Eastbrook town family
// (scripts/assets/eastbrook_town/source_fingerprint.mjs), so the town's
// extraction (eastbrook_town.ts) repaints the canopy instead: every canopy
// vertex takes the stall's own canopy colour, the layout's `canopyVariant`,
// on ONE canvas cell of the town atlas, so the three panels read as one
// striped awning in one colour.
//
// Pure (no Three, no DOM): the extraction asks it per vertex and per stall.

import type { EastbrookSurfaceSemantic } from './eastbrook_surface_atlas';

/** The one model the repaint applies to. */
export const EASTBROOK_STALL_ASSET_URL = '/models/props/eastbrook_market_stall.glb';

/** Model height (GLB units, base at 0) below which nothing is canopy: the
 *  cloth sacks on the counter top out at 1.79 and the canopy's underside sits
 *  at 2.22 (measured off the shipped GLB, pinned by
 *  tests/eastbrook_stall_canopy.test.ts). */
export const STALL_CANOPY_MIN_Y = 2;

/** The canvas cells the model's cloth colours classify onto (blue and cream
 *  panels on one, the red panel on the other). */
const CANVAS_SEMANTICS: ReadonlySet<EastbrookSurfaceSemantic> = new Set<EastbrookSurfaceSemantic>([
  'blueCreamCanvas',
  'redCreamCanvas',
]);

/** The ONE atlas cell every canopy vertex draws on, so the stripes run on
 *  unbroken across the three panels. */
export const STALL_CANOPY_SEMANTIC: EastbrookSurfaceSemantic = 'blueCreamCanvas';

/** The canopy colours the layout names (EASTBROOK_LAYOUT.market.stalls). */
export type StallCanopyVariant = 'gold' | 'green';

/** sRGB canopy colour per variant: a mustard canvas for the World Market, a
 *  sage one for the provisioner. The cell's light and dark bands shade each
 *  into a two-tone stripe of its own colour. */
export const STALL_CANOPY_COLORS: Readonly<Record<StallCanopyVariant, number>> = Object.freeze({
  gold: 0xba8838,
  green: 0x4b6d3f,
});

/** What a stall with no authored variant draws (a Studio-placed copy). */
export const STALL_CANOPY_DEFAULT_VARIANT: StallCanopyVariant = 'gold';

/** The variant a stall draws: its own when the table knows it, else the default. */
export function stallCanopyVariant(variant: string | undefined): StallCanopyVariant {
  return variant !== undefined && Object.hasOwn(STALL_CANOPY_COLORS, variant)
    ? (variant as StallCanopyVariant)
    : STALL_CANOPY_DEFAULT_VARIANT;
}

/** The sRGB canopy colour a stall draws. */
export function stallCanopyColor(variant: string | undefined): number {
  return STALL_CANOPY_COLORS[stallCanopyVariant(variant)];
}

/** Whether a vertex of the stall model is canopy cloth: classified onto a
 *  canvas cell and above the counter (the counter's cream sack shares the
 *  canopy's cream). */
export function isStallCanopyVertex(semantic: EastbrookSurfaceSemantic, y: number): boolean {
  return CANVAS_SEMANTICS.has(semantic) && y >= STALL_CANOPY_MIN_Y;
}

/** The town's template key for a stall placement: the canopy model draws one
 *  template per canopy variant, any other model its own URL. */
export function stallTemplateKey(assetId: string, variant: string | undefined): string {
  return assetId === EASTBROOK_STALL_ASSET_URL
    ? `${assetId}#canopy=${stallCanopyVariant(variant)}`
    : assetId;
}
