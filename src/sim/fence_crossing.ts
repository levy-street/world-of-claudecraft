// The fence-crossing query: does a straight step from (fromX, fromZ) to
// (toX, toZ) cross a rail a body must jump? Shared by colliders.ts
// resolveMovement (a walking body stops at the line) and pathCrossesFence
// (click-to-move auto-jump, pathfind). Moved verbatim out of colliders.ts (the
// monolith ratchet); the Studio fence-placement arm rides with it.

import { promotedColliderProps } from './authored_town_dressing';
import { MOUNT_RACE_JUMP_FIXTURES, raceGateSegment } from './content/mounts';
import { getActiveWorldContent } from './data';
import { FENCE_END_PAD } from './fence_dims';

export function crossesFence(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  r: number,
): boolean {
  // endPad extends the crossing test past each end of the segment. An authored
  // fence overrides it with its own width so a wide rail is not walked around
  // at its posts; the race gates keep the default.
  const crossesSegment = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    endPad = FENCE_END_PAD,
  ): boolean => {
    const dx = x2 - x1,
      dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const ux = dx / len,
      uz = dz / len;
    const nx = -uz,
      nz = ux;
    const fromRelX = fromX - x1,
      fromRelZ = fromZ - z1;
    const toRelX = toX - x1,
      toRelZ = toZ - z1;
    const fromSide = fromRelX * nx + fromRelZ * nz;
    const toSide = toRelX * nx + toRelZ * nz;
    if (fromSide === 0 && toSide === 0) return false;
    if (fromSide * toSide > 0) return false;
    const denom = fromSide - toSide;
    const t = Math.abs(denom) < 1e-6 ? 0 : fromSide / denom;
    if (t < 0 || t > 1) return false;
    const hitX = fromX + (toX - fromX) * t;
    const hitZ = fromZ + (toZ - fromZ) * t;
    const along = (hitX - x1) * ux + (hitZ - z1) * uz;
    return along >= -endPad - r && along <= len + endPad + r;
  };

  const content = getActiveWorldContent();
  const props = content.props;
  // A promoted town fence crosses as its placement below, not as its record.
  for (const f of promotedColliderProps(props, content.promotedScenery).fences) {
    if (crossesSegment(f.x1, f.z1, f.x2, f.z2, f.width === undefined ? undefined : f.width / 2)) {
      return true;
    }
  }
  // Studio fence placements (worldPropKind 'fence', the editable copies of the
  // shipped fence runs) are rails too: their wall is the isFence OBB in
  // colliders_authored/placement_colliders.ts, and this segment along the
  // placement's local x axis keeps the jump-aware crossing (click-to-move
  // auto-jump, pathfind) on them. Only authored maps carry placements, so the
  // built-in world skips the loop entirely.
  for (const p of content.placements ?? []) {
    if (p.worldPropKind !== 'fence' || !p.worldPropWidth) continue;
    const half = (p.worldPropWidth * p.scale * (p.scaleX ?? 1)) / 2;
    const dx = Math.cos(p.rotY) * half;
    const dz = -Math.sin(p.rotY) * half;
    if (crossesSegment(p.x - dx, p.z - dz, p.x + dx, p.z + dz)) return true;
  }
  // Click-to-move uses this same query to auto-jump a rail. Include the race
  // fixtures so its route behaves like keyboard movement instead of walking
  // into the new collider and stalling.
  for (const jump of props.raceCourse?.jumps ?? []) {
    const halfWidth = MOUNT_RACE_JUMP_FIXTURES[jump.kind].width / 2;
    const segment = raceGateSegment(jump, halfWidth);
    if (crossesSegment(segment.ax, segment.az, segment.bx, segment.bz)) return true;
  }
  return false;
}
