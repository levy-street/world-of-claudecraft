// Pure subzone-detection helper for the HUD's classic "subzone text" banner.
// No DOM — kept separate from hud.ts so it can be unit-tested (cf. xp_bar.ts).
import type { ZoneDef } from '../sim/types';

// Enter a subzone within this many yards of its landmark; keep it until you
// move SUBZONE_DEADBAND yards further out, so straddling the edge of a POI
// doesn't re-fire the banner every step (mirrors the zone-banner dead-band).
export const SUBZONE_RADIUS = 32;
export const SUBZONE_DEADBAND = 8;

// The named landmark the player is standing in, or null in open wilderness.
// `current` is the subzone the HUD is already showing; passing it back in
// applies the hysteresis above so a player loitering on the boundary keeps the
// same subzone instead of flickering between it and "nowhere".
export function nearestSubzone(
  x: number,
  z: number,
  pois: ZoneDef['pois'],
  current: string | null,
): string | null {
  let nearest: string | null = null;
  let bestD2 = SUBZONE_RADIUS * SUBZONE_RADIUS;
  for (const poi of pois) {
    const dx = x - poi.x;
    const dz = z - poi.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      nearest = poi.label;
    }
  }
  // Outside every enter-radius but still close to the one we're already in?
  // Stick with it until we clear the wider dead-band radius.
  if (nearest === null && current !== null) {
    const cur = pois.find((q) => q.label === current);
    if (cur) {
      const dx = x - cur.x;
      const dz = z - cur.z;
      const r = SUBZONE_RADIUS + SUBZONE_DEADBAND;
      if (dx * dx + dz * dz < r * r) return current;
    }
  }
  return nearest;
}
