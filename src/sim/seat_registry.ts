// The world's seats: every building's declared anchors (seat_anchor.ts) merged into one
// list and one id lookup. The seats belong to the built-in world's buildings, so a custom
// map exposes none (the same gate the buildings' colliders and floors take). A pure leaf
// over content: no SimContext, no rng.

import { MIREFEN_TAVERN_SEATS } from './content/mirefen_tavern_seats';
import { isBuiltinWorldActive } from './data';
import type { SeatAnchor } from './seat_anchor';

/** Every built-in seat, in a fixed order (a new building appends its list). */
export const BUILTIN_SEATS: readonly SeatAnchor[] = Object.freeze([...MIREFEN_TAVERN_SEATS]);

const BY_ID: ReadonlyMap<string, SeatAnchor> = new Map(BUILTIN_SEATS.map((s) => [s.id, s]));
const NONE: readonly SeatAnchor[] = Object.freeze([]);

/** The seats of the active world. */
export function activeSeats(): readonly SeatAnchor[] {
  return isBuiltinWorldActive() ? BUILTIN_SEATS : NONE;
}

/** A seat of the active world by id, or null. */
export function seatById(id: string): SeatAnchor | null {
  if (!isBuiltinWorldActive()) return null;
  return BY_ID.get(id) ?? null;
}
