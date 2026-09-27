// The floor VFX ladder: the one place every floor-anchored effect takes its
// renderOrder from, so that what a player must REACT to always paints over
// what a player merely emits.
//
// Every floor mark in this renderer (a terrain-draped disc, a telegraph cone, a
// soak ring, a consecration wash, a blob shadow) is a transparent mesh with
// depth-write off, hugging the ground on a lift or a polygon offset. The depth
// buffer therefore cannot arbitrate between two of them: whichever paints LAST
// wins the blend outright, and when two share a renderOrder three.js falls back
// to bounding-sphere depth, which flips as the camera orbits (water.ts records
// the same failure on the sea). renderOrder is the only stable arbiter, and
// before this ladder every module picked its own small integer, so a paladin's
// consecration (7 to 11) painted over Ignivar's soak telegraph (2 to 7).
//
// The ladder, bottom to top:
//   ground     the world's own marks: blob shadows, torch pools, scorch decals
//   player     class ability ground VFX: auras, decals, shock rings, runes
//   encounter  boss and encounter mechanics: telegraphs, soaks, hazards, zones
//   reticle    the player's own ground aim guide and click feedback (additive,
//              so it brightens what lies under it and never hides a telegraph)
//
// Each band owns a span of consecutive orders. A module keeps its internal
// stack (fill under rim under sweep) as STEPS inside its band, and a step is
// clamped so it can never leak into the next band. Inside the encounter band
// every module uses ONE rule, step = the order it shipped with before the
// ladder minus one, so the cross-module order the raids were authored with
// (Varkhul's modules against the soak telegraph they share) is preserved and no
// new tie appears; a piece that had no order sits on the band floor. The
// player band packs each module's own stack from step 0, since player effects
// only ever overlap other player effects there. The bands sit above the water
// surface (0) and the world's default band, and below the camera-attached
// overlays (underwater tint, sky). The Three-side twin is ./floor_vfx_layer.ts;
// the band-to-module registry and the ordering pins live in
// tests/floor_vfx_layer.test.ts.

export const FLOOR_VFX_LAYERS = ['ground', 'player', 'encounter', 'reticle'] as const;

export type FloorVfxLayer = (typeof FLOOR_VFX_LAYERS)[number];

/** First renderOrder of each band. */
export const FLOOR_VFX_LAYER_BASE: Readonly<Record<FloorVfxLayer, number>> = {
  ground: 1,
  player: 10,
  encounter: 20,
  reticle: 50,
};

/** How many consecutive orders (steps) each band owns. */
export const FLOOR_VFX_LAYER_SPAN: Readonly<Record<FloorVfxLayer, number>> = {
  ground: 8,
  player: 10,
  encounter: 30,
  reticle: 4,
};

function clampStep(layer: FloorVfxLayer, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const top = FLOOR_VFX_LAYER_SPAN[layer] - 1;
  return Math.min(top, Math.floor(step));
}

/**
 * The renderOrder for one rung of the ladder: `step` 0 is the bottom of the
 * band (a fill), higher steps paint over it (rim, spokes, sweep). Steps past
 * the band's span clamp to its top rung rather than crossing into the band
 * above, so a module can never accidentally promote itself.
 */
export function floorVfxRenderOrder(layer: FloorVfxLayer, step = 0): number {
  return FLOOR_VFX_LAYER_BASE[layer] + clampStep(layer, step);
}

/**
 * The last rung of a band: what must paint over everything else in it. It is
 * the same order a module reaches by stepping to the end of the span (or past
 * it), so a piece that asks for the top rung explicitly ties with one that
 * clamps there; keep ordinary stacks well below the span end.
 */
export function floorVfxLayerTopOrder(layer: FloorVfxLayer): number {
  return FLOOR_VFX_LAYER_BASE[layer] + FLOOR_VFX_LAYER_SPAN[layer] - 1;
}

/** Which band a renderOrder falls in, or null when it is outside the ladder. */
export function floorVfxLayerOf(renderOrder: number): FloorVfxLayer | null {
  for (const layer of FLOOR_VFX_LAYERS) {
    const base = FLOOR_VFX_LAYER_BASE[layer];
    if (renderOrder >= base && renderOrder < base + FLOOR_VFX_LAYER_SPAN[layer]) return layer;
  }
  return null;
}
