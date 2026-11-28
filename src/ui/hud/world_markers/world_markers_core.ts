// The raid's world markers in the HUD, as pure decisions: whether the world
// marker button shows and what it says (in a group, inside an instance), who may
// place (the sim's own rule, canEditSharedMapMarks), which of the eight symbols
// are down, where a ground click would put a mark (the instance-local point and
// the map page, or a refusal when the point is outside the copy the player
// stands in), what a press on a symbol tile does, and the paint key that keeps
// an idle HUD from writing anything.
//
// The marks are the SAME marks the raid atlas places (IWorld.sharedMapMarks):
// one per symbol, server-authoritative, each with its map point and its world
// point on the floor. DOM-free and deterministic (UI_PURE_CORES).

import { dungeonInstanceAt } from '../../../sim/dungeon_floor';
import { instanceHalfWidthOf } from '../../../sim/instances/instance_footprint';
import {
  canEditSharedMapMarks,
  SHARED_MAP_MARK_REACH_Z,
  SHARED_MAP_MARK_SYMBOLS,
} from '../../../sim/social/shared_map_marks';
import type { SharedMapMark } from '../../../world_api';
import { raidAtlasPageAt } from '../raid_atlas/raid_atlas_shared_marks_core';

export const WORLD_MARKER_SYMBOLS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

/** The keybind action ids: one per symbol (place it), and one that clears all.
 *  Unbound by default, as the classic client ships them. */
export const WORLD_MARKER_PLACE_ACTIONS = WORLD_MARKER_SYMBOLS.map((s) => `worldMarker${s + 1}`);
export const WORLD_MARKER_CLEAR_ACTION = 'worldMarkerClear';

/** The world-marker hotkey an action id names: 0..7 places that symbol, null
 *  clears every mark, undefined is not a world-marker action. */
export function worldMarkerActionSymbol(actionId: string): number | null | undefined {
  if (actionId === WORLD_MARKER_CLEAR_ACTION) return null;
  const m = /^worldMarker([1-8])$/.exec(actionId);
  return m ? Number(m[1]) - 1 : undefined;
}

/** What the world-marker button reads from the world each sync. */
export interface WorldMarkerBarInput {
  party: { leader: number; raid: boolean } | null;
  playerId: number;
  /** The player stands inside a dungeon or raid instance. */
  inInstance: boolean;
  marks: readonly SharedMapMark[];
  /** The symbol armed for a ground click, or null. */
  armed: number | null;
}

export interface WorldMarkerBarView {
  /** The button shows: in a party or raid, inside an instance. */
  visible: boolean;
  /** This player may place and clear (solo/party always, raid leader only). */
  editable: boolean;
  /** Bit s set: symbol s is down. */
  placed: number;
  armed: number | null;
  /** Changes whenever anything painted changes (an idle sync compares one number). */
  key: number;
}

/** The bitmask of placed symbols (no allocation). */
export function placedMask(marks: readonly SharedMapMark[]): number {
  let mask = 0;
  for (const m of marks)
    if (Number.isInteger(m.symbol) && m.symbol >= 0 && m.symbol < SHARED_MAP_MARK_SYMBOLS)
      mask |= 1 << m.symbol;
  return mask;
}

export function worldMarkerBarView(input: WorldMarkerBarInput): WorldMarkerBarView {
  const visible = input.party !== null && input.inInstance;
  const editable = canEditSharedMapMarks(input.party, input.playerId);
  const placed = placedMask(input.marks);
  const armed = editable ? input.armed : null;
  const key =
    (visible ? 1 : 0) | (editable ? 2 : 0) | (placed << 2) | ((armed === null ? 15 : armed) << 10);
  return { visible, editable, placed, armed, key };
}

/** Where a ground click would put a mark: the map page and the instance-local
 *  point, or null when the point lies outside the instance copy the player
 *  stands in (the sim would refuse it; the reticle shows it refused). */
export interface WorldMarkerTarget {
  page: number;
  lx: number;
  lz: number;
}

export function worldMarkerTarget(
  player: { x: number; z: number },
  point: { x: number; z: number },
): WorldMarkerTarget | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  const here = dungeonInstanceAt(player.x, player.z);
  if (!here) return null;
  const there = dungeonInstanceAt(point.x, point.z);
  if (!there || there.ox !== here.ox || there.oz !== here.oz) return null;
  const lx = point.x - here.ox;
  const lz = point.z - here.oz;
  if (Math.abs(lx) >= instanceHalfWidthOf(here.dungeonId)) return null;
  if (Math.abs(lz) >= SHARED_MAP_MARK_REACH_Z) return null;
  return { page: raidAtlasPageAt(here.dungeonId, lx, lz), lx, lz };
}

/** True when the player stands inside an instance copy (where marks live). */
export function inMarkableInstance(player: { x: number; z: number }): boolean {
  return dungeonInstanceAt(player.x, player.z) !== null;
}

/** What a press on a symbol tile (or its hotkey) does. */
export type WorldMarkerPress =
  | { kind: 'arm'; symbol: number }
  | { kind: 'disarm' }
  | { kind: 'clear'; symbol: number | null }
  | { kind: 'refuse' };

/**
 * A press on symbol `symbol` (null: the clear-all control). `secondary` is the
 * right click (or a long press on touch): it removes that one mark. A primary
 * press arms the symbol for a ground click, and pressing the armed symbol
 * again disarms it. Nothing happens for a player who may not edit, nor for a
 * clear with nothing to clear (it would only spend the group's edit window).
 */
export function worldMarkerPress(
  view: Pick<WorldMarkerBarView, 'editable' | 'placed' | 'armed'>,
  symbol: number | null,
  secondary: boolean,
): WorldMarkerPress {
  if (!view.editable) return { kind: 'refuse' };
  if (symbol === null) return view.placed ? { kind: 'clear', symbol: null } : { kind: 'refuse' };
  if (secondary)
    return view.placed & (1 << symbol) ? { kind: 'clear', symbol } : { kind: 'refuse' };
  if (view.armed === symbol) return { kind: 'disarm' };
  return { kind: 'arm', symbol };
}
