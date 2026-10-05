// Which geometry level a WOC character draws (the pure policy; the levels themselves ride the
// files, WOC_lod, and the variants that draw them are src/render/assets/geometry_lod.ts).
// Three-free, so a Vitest reads the table the visual builds with.
//
// Every WOC file a character draws up close (the base body, the armor's low and medium files,
// the head cores, the hairstyles and the beards) carries up to two coarser index lists per
// primitive beside its own: MID, about half the triangles, and FAR, about a quarter. Which one a
// character draws is fixed when its visual is built (a graphics change rebuilds every visual),
// never per frame:
//
//   preset (or device)        full detail    crowd detail
//   low, or any phone         mid            mid
//   medium, high, ultra       level 0        mid
//   the far LOD bake          far            far
//
// `full` is the local player's own character and every body built directly (the creator,
// inspect, the armory, the character sheet, a portrait); `crowd` is every other character in
// the world (woc_armor_core.ts WocArmorDetail). A piece without a level of the kind wanted draws
// the next finer one it has (geometry_lod_core.ts geometryLodDrawn). One exception, by design: a
// head piece the face sliders move keeps level 0 while it draws on its own (woc_head_packs.ts
// hangWocHeadFile), because a variant would cost a second morph texture; the merged head draws
// its level instead.
//
// Geometry detail is cosmetic only, never information a player acts on
// (docs/design/graphics-settings-fairness.md): every level draws the same pieces over the same
// vertices, skinned, posed and tinted alike, so a silhouette, a worn item or a cast reads the
// same at any level, and which character draws level 0 is decided by whose character it is,
// never by anything a player could react to.
import type { GeometryLodLevel } from '../assets/geometry_lod_core';
import type { WocArmorDetail, WocTierProfile } from './woc_armor_core';

/** The level a WOC character of `detail` draws up close under a graphics profile. */
export function wocLodLevelFor(
  profile: WocTierProfile,
  detail: WocArmorDetail = 'full',
): GeometryLodLevel {
  if (profile.constrainedMemory || profile.tier === 'low') return 'mid';
  return detail === 'full' ? 'lod0' : 'mid';
}

/** The level the far LOD bake freezes, whatever the character's detail (woc_far_bake.ts and the
 *  bare body's bake in assets.ts prepareVisual). */
export const WOC_FAR_BAKE_LOD: GeometryLodLevel = 'far';
