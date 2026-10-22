import type { Point3 } from '../colliders_authored/placement_geometry';
import type { PlacedAsset } from '../types';

/** Exported plane vectors include full model rotation/scale, relative to its anchor. */
export interface LayoutDeck {
  placement: PlacedAsset;
  origin: Point3;
  across: Point3;
  along: Point3;
}

/** Full placement rotation/scale applies to both the visible plank and its walk surface. */
export function layoutDeckSurfaceAt(
  deck: LayoutDeck,
  x: number,
  z: number,
  terrainAt: (x: number, z: number) => number,
): number | null {
  const p = deck.placement;
  if (!((p.collideRadius ?? 0) > 0)) return null;
  const { origin, across, along } = deck;
  const dx = x - p.x - origin.x,
    dz = z - p.z - origin.z;
  const det = across.x * along.z - along.x * across.z;
  if (Math.abs(det) < 1e-8) return null;
  const u = (dx * along.z - along.x * dz) / det;
  const v = (across.x * dz - dx * across.z) / det;
  if (Math.abs(u) > 0.5 || Math.abs(v) > 0.5) return null;
  const base = p.detached ? (p.groundY ?? 0) : terrainAt(p.x, p.z);
  return base + (p.y ?? 0) + origin.y + u * across.y + v * along.y;
}

export function layoutDeckFloorAt(
  decks: readonly LayoutDeck[] | undefined,
  x: number,
  z: number,
  terrainAt: (x: number, z: number) => number,
  maxFloor = Infinity,
): number {
  let floor = -Infinity;
  for (const deck of decks ?? []) {
    const y = layoutDeckSurfaceAt(deck, x, z, terrainAt);
    if (y !== null && y <= maxFloor) floor = Math.max(floor, y);
  }
  return floor;
}

/** Lowest enabled plank above the body; prevents jumping through its underside. */
export function layoutDeckCeilingAt(
  decks: readonly LayoutDeck[] | undefined,
  x: number,
  z: number,
  terrainAt: (x: number, z: number) => number,
  aboveY: number,
): number {
  let ceiling = Infinity;
  for (const deck of decks ?? []) {
    const y = layoutDeckSurfaceAt(deck, x, z, terrainAt);
    if (y !== null && y > aboveY) ceiling = Math.min(ceiling, y);
  }
  return ceiling;
}
