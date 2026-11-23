// Adopting a freshly authored Collision Master default into the placements
// that are already standing in the open map.
//
// WHY THIS EXISTS. A placement records the collision mode it was stamped with
// at PLACEMENT time. Author an asset's real collision afterwards and every
// copy already in the map keeps its old stamp, and the sim honours that stamp
// (colliders.ts treats `collideCustom` / hand `hitboxes` as "the maker chose
// this footprint deliberately", so it never upgrades them). Measured on the
// shipped overworld: foliage/rock_1 had 14 authored volumes and 370 of its 385
// placements still colliding as a plain circle, which reads exactly like
// "Collision Master collision is not loading on the models in the game".
//
// The rule: Lock In is the maker's LATEST decision about this asset, so it
// overrides whatever a copy carried before, a simple footprint, hand-edited
// boxes, per-placement ramp decks, or a dropdown "none". (An earlier version
// left hand-edited copies alone, which meant the maker had to click "Reset to
// baked" on each one after Lock In before the authored collision showed up.)

import { effectiveCollisionMode, type MapPlacement } from '../sim/map_doc';

/** One placement the adoption would change, with the fields to set. */
export interface CollisionAdoption {
  index: number;
  /** The placement's mode before adoption (for the undo entry). */
  from: string;
  patch: {
    collisionMode: 'baked';
    collideShape?: undefined;
    /** Set when the placement was not colliding (promotion-stamped or an
     *  explicit "none"): it has to be opted into collision as well as
     *  re-stamped. */
    collide?: true;
    /** Set when the placement carried its own hand-edited boxes: they are
     *  dropped so the authored default is what collides. */
    clearHitboxes?: true;
    /** Set when the placement carried per-placement ramp decks: dropped for
     *  the same reason (the authored default carries its own ramps). */
    clearRamps?: true;
  };
}

/**
 * Which placements of `assetId` should pick up a newly authored 'baked'
 * default, and what to set on them.
 *
 * Every copy of the asset adopts. The only ones left alone are those already
 * on the plain 'baked' default with nothing of their own (nothing to do).
 */
export function planCollisionAdoption(
  placements: readonly MapPlacement[],
  assetId: string,
): CollisionAdoption[] {
  const out: CollisionAdoption[] = [];
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    if (p.assetId !== assetId) continue;
    const patch: CollisionAdoption['patch'] = { collisionMode: 'baked', collideShape: undefined };
    if (p.hitboxes && p.hitboxes.length > 0) patch.clearHitboxes = true;
    if (p.ramps && p.ramps.length > 0) patch.clearRamps = true;
    const mode = effectiveCollisionMode(p);
    // Non-colliders (a promotion that never got a footprint, or a dropdown
    // "none") are opted in: authoring collision for the asset is the intent to
    // make every copy solid.
    if (mode === 'none' || !p.collide) patch.collide = true;
    if (mode === 'baked' && !patch.collide && !patch.clearHitboxes && !patch.clearRamps) continue;
    out.push({ index: i, from: mode, patch });
  }
  return out;
}
