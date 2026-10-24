// Two small terrain-height decisions the editor shares between its tools,
// kept pure (no DOM, no Three) so Vitest imports them directly:
//   - the Flatten tool's LOCKED LEVEL: right-click the ground to pick a height,
//     then every left-drag levels to it, until the lock is cleared and each
//     stroke goes back to levelling to the height where it starts;
//   - seating a placement back ON THE GROUND: the Move tool detaches a model
//     from its terrain seat (it floats at a frozen ground height), and "Set to
//     ground" / "Snap to ground when moving" undo exactly that.

import type { MapPlacement } from '../sim/map_doc';

/** The height a Flatten stroke levels to: the locked level when one is set,
 *  otherwise the ground under the press point. */
export function flattenStrokeTarget(lock: number | null, pressHeight: number): number {
  return lock !== null && Number.isFinite(lock) ? lock : pressHeight;
}

/** The furthest a typed level may sit from zero, in yards: the same bound
 *  the map document keeps on a stamp's height (sim/map_doc.ts sanitizeStamp),
 *  so a level never looks right live and comes back clipped after a reload. */
export const FLATTEN_LEVEL_LIMIT = 200;

/** A typed level from the panel (clamped to the stored range), or null for an
 *  empty or unreadable entry. */
export function parseLevelInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.min(FLATTEN_LEVEL_LIMIT, Math.max(-FLATTEN_LEVEL_LIMIT, value));
}

/** The fields a placement's terrain seat is made of. */
export interface GroundSeat {
  detached?: boolean;
  groundY?: number;
  y?: number;
}

/** Whether a placement already sits on the terrain (attached, no lift). */
export function isOnGround(p: Pick<MapPlacement, 'detached' | 'y'>): boolean {
  return p.detached !== true && (p.y ?? 0) === 0;
}

/** The seat a placement had, for an undo entry. */
export function groundSeatOf(p: MapPlacement): GroundSeat {
  return { detached: p.detached, groundY: p.groundY, y: p.y };
}

/** Restore a seat captured by groundSeatOf (absent fields stay absent). */
export function applyGroundSeat(p: MapPlacement, seat: GroundSeat): void {
  if (seat.detached === undefined) delete p.detached;
  else p.detached = seat.detached;
  if (seat.groundY === undefined) delete p.groundY;
  else p.groundY = seat.groundY;
  if (seat.y === undefined) delete p.y;
  else p.y = seat.y;
}

/** Seat a placement on the terrain wherever it now stands: re-attach it (its
 *  base follows the ground under it again) and drop any vertical lift. */
export function seatOnGround(p: MapPlacement): void {
  applyGroundSeat(p, {});
}
