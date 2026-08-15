// Host-neutral disclosure boundary for actionable live map markers.
//
// Offline Sim retains complete entity rosters while online ClientWorld is
// interest-scoped. Keeping every live map disclosure inside the server's
// 90-yard ordinary entity enter radius makes both hosts reveal the same state.

export const LIVE_MAP_ENTITY_DISCLOSURE_RADIUS = 80;
const LIVE_MAP_ENTITY_DISCLOSURE_RADIUS_SQ =
  LIVE_MAP_ENTITY_DISCLOSURE_RADIUS * LIVE_MAP_ENTITY_DISCLOSURE_RADIUS;

/** Inclusive planar-distance check, allocation-free for hot map redraws. */
export function isLiveMapEntityDisclosed(
  playerX: number,
  playerZ: number,
  entityX: number,
  entityZ: number,
): boolean {
  const dx = entityX - playerX;
  const dz = entityZ - playerZ;
  return dx * dx + dz * dz <= LIVE_MAP_ENTITY_DISCLOSURE_RADIUS_SQ;
}
