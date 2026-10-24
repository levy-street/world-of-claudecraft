// Fence and blocker-wall collider dimensions, a constant leaf shared by
// colliders.ts (PROPS.fences, editor blocker walls) and the authored
// placement lane (colliders_authored/placement_colliders.ts, fence-kind
// placements), so the three wall families stay the same thickness.

/** Fence/blocker wall half-thickness (yards); the editor's blocker overlay
 * reuses it so the drawn wall matches the collider exactly. */
export const FENCE_HALF_DEPTH = 0.35;
export const FENCE_END_PAD = 0.35;
/**
 * Visual top of a low village fence rail (yards). The fence.glb rail is ~0.33yd
 * native and renders at ~2.9x, so its silhouette tops out around waist height.
 * This value feeds ONLY the spell line-of-sight check (`sightBlockedAt`): it MUST
 * stay below `SIGHT_HEIGHT` (1.6) so a caster sees and casts over a fence, matching what
 * the player sees on screen (issue #1668). The old 2.8 estimate sat above the
 * eye line and wrongly blocked casts. A jump still clears the rail for movement
 * regardless (see sim `Entity.jumping`). */
export const FENCE_RAIL_HEIGHT = 0.95;
