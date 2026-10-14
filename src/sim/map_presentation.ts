import type { MapPresentationMode } from './types';

export type InteriorPresentationMode = Exclude<
  MapPresentationMode,
  'blank' | 'sowfield' | 'deepglass'
>;

/** Authored maps use a bounded, flat slate instead of the shipped overworld. */
export function isAuthoredMapPresentation(mode: MapPresentationMode | undefined): boolean {
  return mode !== undefined;
}

/** Authored maps must not inherit the overworld grass/dirt splat textures. */
export function usesPlainTerrainMaterial(mode: MapPresentationMode | undefined): boolean {
  return isAuthoredMapPresentation(mode) && mode !== 'sowfield';
}

/** Procedural world foliage is global-coordinate scenery, never authored-map content. */
export function usesProceduralOverworldFoliage(mode: MapPresentationMode | undefined): boolean {
  return !isAuthoredMapPresentation(mode);
}

/**
 * Gathering veins and camp braziers are SITE dressing: fixed overworld
 * coordinates baked into the shipped content tables, not scenery derived from
 * the live map. An authored map therefore inherits whatever ore, timber and
 * campfires the built-in world happens to put in the same coordinates, inside
 * the building, if the building sits near the origin.
 *
 * minimap_markers.ts already refused to draw those veins on an authored map's
 * minimap; the renderer never got the same memo, so the Deepglass arena was
 * drawing 223k triangles of ore and herbs a frame (36% of it) around and
 * inside a blitzball stadium. Every reader of this content answers to this one
 * function so the map, the mesh and the interact key cannot disagree again.
 */
export function usesOverworldSiteDressing(mode: MapPresentationMode | undefined): boolean {
  return !isAuthoredMapPresentation(mode);
}

/**
 * The shipped world's level pads and walkable lifts (Dawnhold Castle's graded
 * grounds and wall walks, the Last Keep site, the Evergarden bed and Galecrest
 * pads, the Old Beacon's stair) are written at fixed overworld coordinates and
 * applied AFTER the custom-map sculpt layer, so on an authored map they stamp
 * ground the maker can neither see coming nor sculpt away: SPACEY's "weird flat
 * square ... hard stuck" on the Deepglass (2026-09-15) was Dawnhold's pad at
 * x 232..300, z 854..944, pinned at y 3.2 under every lowering stroke. Full
 * copies of the shipped world keep them (their castles stand on them).
 */
export function usesOverworldTerrainPads(mode: MapPresentationMode | undefined): boolean {
  return !isAuthoredMapPresentation(mode);
}

/** Interior authoring stays local while borrowing the live room's visual grade. */
export function interiorPresentationMode(
  mode: MapPresentationMode | undefined,
): InteriorPresentationMode | null {
  return mode && mode !== 'blank' && mode !== 'sowfield' && mode !== 'deepglass' ? mode : null;
}
