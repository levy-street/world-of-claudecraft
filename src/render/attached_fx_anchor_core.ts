// Where an effect ATTACHED to a unit sits this frame (a mark ring at a
// player's feet, a stone over their head, a halo over a mob).
//
// The unit's model is never drawn at `e.pos`. Online, `pos` is the last
// server snapshot (20 Hz, and for the local player one round trip behind the
// predicted display pose); offline it is the latest sim tick, which the view
// interpolates toward from `prevPos`. The renderer draws every entity view at
// its own smoothed pose (self prediction, remote interpolation), so an effect
// placed at `pos` stair-steps a few times a second and trails the body it
// should ride: it shakes while the unit walks. An attached effect follows the
// DRAWN pose instead, and falls back to `pos` only when the renderer drew no
// view for that entity this session (out of the draw band, not created yet).
//
// Pure (no Three, no DOM): the renderer installs a lookup of its views'
// drawn positions through `attached_fx_anchor.ts`; painters call `fxAnchor`.

/** A position, read-only to callers (a live view position is returned by
 *  reference, never copied, so a painter must not write to it). */
export interface FxAnchorVec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The slice of an entity an anchor needs. */
export interface FxAnchoredEntity {
  readonly id: number;
  readonly pos: FxAnchorVec;
}

/** The drawn position of entity `id` this frame, or undefined when the
 *  renderer has no view for it. */
export type DrawnPositionLookup = (id: number) => FxAnchorVec | undefined;

/**
 * The position an effect attached to `e` follows this frame: the drawn pose
 * when a view exists and holds a finite position, else the entity's own
 * position. Returns a reference (no allocation on the per-frame path).
 */
export function resolveFxAnchor(
  e: FxAnchoredEntity,
  lookup: DrawnPositionLookup | null,
): FxAnchorVec {
  if (lookup) {
    const drawn = lookup(e.id);
    if (drawn && Number.isFinite(drawn.x) && Number.isFinite(drawn.z)) return drawn;
  }
  return e.pos;
}

/** How far a floor footprint riding a unit may slide before its drape over
 *  the floor is re-sampled. Between drapes it only slides (a group move), so
 *  a walking unit does not re-upload the footprint's vertices every frame;
 *  half a yard of slide on the raid's floors is far under a visible lift. */
export const FX_REDRAPE_YD = 0.5;

/** Whether a footprint draped at (drapedX, drapedZ) must re-drape at (x, z).
 *  A never-draped footprint (NaN) always does. */
export function needsRedrape(x: number, z: number, drapedX: number, drapedZ: number): boolean {
  return !(Math.abs(x - drapedX) <= FX_REDRAPE_YD && Math.abs(z - drapedZ) <= FX_REDRAPE_YD);
}
