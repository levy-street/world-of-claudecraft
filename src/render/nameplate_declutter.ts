// Pure post-projection pass: nudges apart nameplates whose screen positions
// would otherwise fully overlap (e.g. two same-named mobs standing close
// together). Most visible on short mobile-landscape viewports, where entities
// need to be much farther apart in world space before their projections
// separate on their own. DOM/Three-free so it unit-tests directly.

export interface NameplateAnchor {
  id: number;
  sx: number;
  sy: number;
}

// Anchors within this horizontal distance are treated as colliding: nameplate
// labels render much wider than the anchor point itself (name + level + hp
// bar), so this approximates half of a typical label's on-screen width rather
// than the anchor point spacing.
const OVERLAP_THRESHOLD_X_PX = 80;
// Vertical anchors this close are considered the "same row" (labels are a
// single text line anchored at their bottom, so the tolerance is much
// tighter than the horizontal one).
const OVERLAP_THRESHOLD_Y_PX = 18;
// Vertical gap applied between stacked members of a cluster.
const STACK_OFFSET_PX = 20;

export function declutterNameplates(anchors: NameplateAnchor[]): NameplateAnchor[] {
  const out = anchors.map((a) => ({ ...a }));
  const byId = new Map(out.map((a) => [a.id, a]));
  const visited = new Set<number>();

  // Stable order regardless of input/render order, so the same entities
  // always stack the same way frame to frame.
  const ordered = [...out].sort((a, b) => a.id - b.id);

  for (const anchor of ordered) {
    if (visited.has(anchor.id)) continue;
    const cluster = ordered.filter(
      (other) =>
        !visited.has(other.id) &&
        Math.abs(other.sx - anchor.sx) <= OVERLAP_THRESHOLD_X_PX &&
        Math.abs(other.sy - anchor.sy) <= OVERLAP_THRESHOLD_Y_PX,
    );
    if (cluster.length < 2) {
      visited.add(anchor.id);
      continue;
    }
    const baseSy = cluster.reduce((sum, a) => sum + a.sy, 0) / cluster.length;
    cluster.forEach((member, i) => {
      const target = byId.get(member.id);
      if (target) target.sy = baseSy + (i - (cluster.length - 1) / 2) * STACK_OFFSET_PX;
      visited.add(member.id);
    });
  }

  return out;
}
