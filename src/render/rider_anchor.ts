import * as THREE from 'three';

// The body-attached aura anchor: the ONE group every persistent self-attached
// visual (absorb shells, the Ascension crown, priest markers, wings, the
// hourglass, Ice Block) parents to instead of the entity view group.
//
// Why it exists: the view group sits at the entity's feet on the sim pose, and
// a mounted rider's body is carried ABOVE it inside the group (the saddle lift,
// the seat bone, the procedural bob: placeRider / updateMountPresentation write
// v.visual.root.position). A visual parented to the group at `height` therefore
// stayed at the dismounted body while the rider sat a saddle higher. Parenting
// straight to the rider root is not an option either: that root is swapped on
// a skin change, tilts with the mount's jump attitude, and re-poses for druid
// forms, none of which a shell or a crown should inherit.
//
// So the anchor copies the rider root's LOCAL POSITION only, once per frame
// after the mount pass has placed the rider, and keeps the identity rotation.
// Dismounted the root is at the origin and the anchor is a no-op.
//
// It follows the BASE rig root (v.visual.root), the one root the mount pass
// places; a druid or travel form swaps the displayed body but its own root
// stays at the group origin and cannot be mounted, so the anchor holds at the
// origin for it too. Every view owns one (object views included, where it
// sits at the origin and is never synced), attached in buildView.
//
// Ground effects stay on the view group on purpose: the Ascension seal, the
// Frost Nova restraint, the Aegis dome, the pooled ground discs (which read
// the terrain height themselves) and the player aura rings all belong at the
// feet of whatever is standing there, mount included.

/** Build the anchor group a view owns; the caller adds it to the view group. */
export function createRiderAnchor(): THREE.Group {
  const anchor = new THREE.Group();
  anchor.name = 'rider-anchor';
  return anchor;
}

/**
 * Carry the anchor to the rider root's local position for this frame. Call it
 * AFTER the rider has been placed (placeRider, updateMountPresentation), or the
 * body-attached visuals ride one frame behind the saddle. A view with no rig
 * (an object view) keeps its anchor at the origin.
 */
export function syncRiderAnchor(anchor: THREE.Object3D, riderRoot: THREE.Object3D | null): void {
  if (!riderRoot) {
    anchor.position.set(0, 0, 0);
    return;
  }
  anchor.position.copy(riderRoot.position);
}
