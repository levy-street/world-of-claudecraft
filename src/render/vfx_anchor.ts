import * as THREE from 'three';

// The one world-anchor resolver every VFX subsystem shares: "give me the world
// point at `frac` of entity `id`'s displayed height". The renderer used to
// close over this inline and return a fresh THREE.Vector3 on every call, which
// is fine for a one-shot spawn and expensive per frame: ribbons, shells, ground
// auras, windups, orbit bands and the sequencer's transients all resolve
// anchors EVERY frame, so a busy fight allocated on the order of a hundred
// vectors per frame purely to read three floats (the periodic multi-ms GC
// hitch, and a "no per-frame new THREE.*" break, see src/render/CLAUDE.md).
//
// The resolver therefore takes an optional caller-owned destination. Per-frame
// callers pass their own scratch vector and allocate nothing; one-shot spawn
// callers omit it and keep the old contract exactly (a fresh vector they may
// retain). The returned vector is ALWAYS the destination when one is given, so
// a caller that passes a scratch must consume the reading before its next call
// with that same scratch.
//
// Host-agnostic on purpose (it knows nothing about Sim, views, or the scene
// graph): the renderer supplies the pose lookup, and tests/vfx_anchor.test.ts
// drives it directly.

/**
 * Resolve the world point at `heightFrac` of an entity's displayed height, or
 * null when the entity has no live view.
 *
 * Pass `out` from a per-frame path to resolve without allocating; the reading is
 * then only valid until that same scratch is reused. Omit it from a one-shot
 * spawn path to get a fresh vector you may retain.
 */
export type VfxAnchorResolver = (
  id: number,
  heightFrac: number,
  out?: THREE.Vector3,
) => THREE.Vector3 | null;

/** A displayed entity pose: the view group's world position plus the height
 *  the anchor fraction is measured against (rig height x entity scale). A fill
 *  that serves offset resolves (createOffsetVfxAnchor) also supplies the
 *  displayed yaw (radians) and the world scale local offsets stretch with;
 *  both are reset before every fill, so an omitting fill reads as unrotated
 *  and unscaled rather than as the previous entity's pose. */
export interface VfxAnchorPose {
  x: number;
  y: number;
  z: number;
  height: number;
  yaw?: number;
  scale?: number;
}

/**
 * Fill `out` with the displayed pose of `id`. Returns false when the entity has
 * no live view, which the anchor reports as a null reading. Implementations MUST
 * write into `out` rather than returning a new object: the whole point is that
 * resolving an anchor allocates nothing.
 */
export type VfxAnchorPoseFill = (id: number, out: VfxAnchorPose) => boolean;

/**
 * Build the shared anchor resolver over a pose lookup.
 *
 * `anchor(id, frac)` returns a NEW vector (the historical contract, safe to
 * retain); `anchor(id, frac, out)` writes into `out` and returns it, so a
 * per-frame path can resolve anchors without touching the heap.
 */
export function createVfxAnchor(fill: VfxAnchorPoseFill): VfxAnchorResolver {
  const pose: VfxAnchorPose = { x: 0, y: 0, z: 0, height: 0 };
  return (id: number, frac: number, out?: THREE.Vector3): THREE.Vector3 | null => {
    if (!fill(id, pose)) return null;
    const target = out ?? new THREE.Vector3();
    return target.set(pose.x, pose.y + pose.height * frac, pose.z);
  };
}

/**
 * Resolve the world point at `heightFrac` of an entity's displayed height,
 * displaced by a local-frame offset rotated to the entity's displayed yaw and
 * stretched by its scale. The warlock drain beams anchor on the hovering
 * affliction familiar this way (a fixed offset beside the caster, whichever
 * way the body faces). Same `out` contract as VfxAnchorResolver.
 */
export type VfxOffsetAnchorResolver = (
  id: number,
  heightFrac: number,
  localX?: number,
  localZ?: number,
  out?: THREE.Vector3,
) => THREE.Vector3 | null;

/** Build the offset-capable resolver over the same pose lookup. */
export function createOffsetVfxAnchor(fill: VfxAnchorPoseFill): VfxOffsetAnchorResolver {
  const pose: VfxAnchorPose = { x: 0, y: 0, z: 0, height: 0, yaw: 0, scale: 1 };
  return (
    id: number,
    frac: number,
    localX = 0,
    localZ = 0,
    out?: THREE.Vector3,
  ): THREE.Vector3 | null => {
    pose.yaw = 0;
    pose.scale = 1;
    if (!fill(id, pose)) return null;
    const yaw = pose.yaw ?? 0;
    const scale = pose.scale ?? 1;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const target = out ?? new THREE.Vector3();
    return target.set(
      pose.x + (localX * cos + localZ * sin) * scale,
      pose.y + pose.height * frac,
      pose.z + (-localX * sin + localZ * cos) * scale,
    );
  };
}
