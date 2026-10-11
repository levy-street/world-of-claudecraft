// A graded trail on the existing western mountain, with a raised summit to
// separate the launch from the landing area and surrounding visual clutter.
export const GLIDER_APPROACH_PATH = [
  { x: 228, z: 418, y: 5.7 },
  { x: 241, z: 537, y: 8.3 },
  { x: 222, z: 611, y: 12.9 },
  { x: 183, z: 610, y: 40.1 },
  { x: 191, z: 557, y: 64.45 },
] as const;

export const GLIDER_TRAIL_DECK_Y = 64.79;

/** Grade the trail, feathering back into the mountain beyond the road shoulder. */
export function applyGliderApproachPath(x: number, z: number, height: number): number {
  if (x < 143 || x > 259 || z < 400 || z > 629) return height;
  // Raise the existing summit, preserving the surrounding mountain silhouette.
  const distanceFromSummit = Math.hypot(x - 191, z - 557);
  const summitBlend = Math.max(0, Math.min(1, (distanceFromSummit - 12) / 36));
  height += 20 * (1 - summitBlend * summitBlend * (3 - 2 * summitBlend));
  let nearest = Infinity;
  let target = height;
  for (let i = 1; i < GLIDER_APPROACH_PATH.length; i++) {
    const a = GLIDER_APPROACH_PATH[i - 1];
    const b = GLIDER_APPROACH_PATH[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (distance >= nearest) continue;
    nearest = distance;
    target = a.y + (b.y - a.y) * t;
  }
  if (nearest >= 18) return height;
  const blend = Math.max(0, (nearest - 9) / 9);
  const weight = 1 - blend * blend * (3 - 2 * blend);
  return height + (target - height) * weight;
}
