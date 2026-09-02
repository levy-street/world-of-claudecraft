// The bounding sphere of a flat VFX mark once its vertices are draped over the
// terrain.
//
// The three ground families (shock rings, dissolve decals, buff ground auras)
// all start from a flat unit shape and push every vertex to its own sampled
// ground height (../drape_lod_core). They used to write that height straight
// into the position attribute, which left three's cached bounding sphere
// describing the FLAT shape, so each pool turned frustum culling off with a
// "never let a stale sphere cull it on a slope" note and paid a draw for every
// live mark, on screen or not.
//
// With the drape carried as its own single-float attribute the flat shape is
// permanent and the sphere is one closed-form expression of it, cheap enough to
// refresh at every re-drape. That is what lets the culling come back on.
//
// Local space: the flat shape lies in a plane at distance `flatRadius` from the
// origin at its furthest vertex, and the drape displaces each vertex along the
// remaining axis by a value in [minDrape, maxDrape]. Both are the pool's own
// LOCAL units, before the mesh scale (the drape samplers already divide by it),
// so the caller hands the result straight to geometry.boundingSphere and three
// applies the world matrix.
//
// Three/DOM-free and deterministic (a registered RENDER_PURE_CORE).

export interface DrapedBounds {
  /** Offset of the sphere centre along the DRAPE axis. */
  center: number;
  radius: number;
}

/**
 * The tightest sphere that contains a flat shape of radius `flatRadius`
 * displaced by every value in [minDrape, maxDrape] along the perpendicular
 * axis.
 *
 * Centring on the drape midpoint is what makes it tight: a sphere centred on
 * the flat plane would carry the whole drape span as radius on both sides.
 */
export function drapedBoundingSphere(
  flatRadius: number,
  minDrape: number,
  maxDrape: number,
): DrapedBounds {
  const low = Math.min(minDrape, maxDrape);
  const high = Math.max(minDrape, maxDrape);
  const center = (low + high) / 2;
  const half = (high - low) / 2;
  return { center, radius: Math.hypot(Math.max(0, flatRadius), half) };
}

/** min and max of the first `count` entries, or [0, 0] for an empty range. */
export function drapeExtent(drape: ArrayLike<number>, count = drape.length): [number, number] {
  if (count <= 0) return [0, 0];
  let low = drape[0];
  let high = drape[0];
  for (let i = 1; i < count; i++) {
    const value = drape[i];
    if (value < low) low = value;
    else if (value > high) high = value;
  }
  return [low, high];
}
