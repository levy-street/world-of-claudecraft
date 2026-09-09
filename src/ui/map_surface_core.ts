// Pure resolver for WHICH map surface the world-map window shows. The window
// used to derive its surface from the player's position alone (mapWindowMode)
// and hid the level toggle inside every instance, so a player in a rift, raid,
// dungeon, delve, or battleground could never reach the zone or world map, and a
// player outside could never look into the dungeon their party was running.
//
// This core combines the position-derived mode with the player's requested
// level (instance / zone / continent) and the party roster, and answers three
// questions for the HUD: which surface to paint, what the toggle does next, and
// where a from-outside instance map should anchor. DOM-free and IWorld-only
// (registered in UI_PURE_CORES).

import type { IWorld } from '../world_api';
import { dungeonMapLocal } from './dungeon_map_view';
import type { TranslationKey } from './i18n';
import { dawnholdLocal, lastKeepLocal } from './lastkeep_map_view';
import type { MapWindowMode } from './map_window_view';

/** The level the player asked for. `instance` is the schematic floor plan. */
export type MapLevel = 'instance' | 'zone' | 'continent';

/** A party member standing inside an instance whose floor plan can be drawn
 *  from outside (static dungeon or castle interiors; rifts, delves, and
 *  battlegrounds are procedural per run and only known to their participants). */
export interface RemoteInstanceAnchor {
  pid: number;
  x: number;
  z: number;
}

const INSTANCE_MODES: ReadonlySet<MapWindowMode> = new Set([
  'rift',
  'delve',
  'battleground',
  'dungeon',
  'castle',
]);

/** True when the player's own position is inside an instance band. */
export function isInstanceMode(mode: MapWindowMode): boolean {
  return INSTANCE_MODES.has(mode);
}

/** The level the map opens on (and falls back to after a mode change). */
export function defaultMapLevel(mode: MapWindowMode): MapLevel {
  return isInstanceMode(mode) ? 'instance' : 'zone';
}

/** True when (x, z) stands inside a dungeon or castle instance that has a floor plan. */
export function drawableInstanceAt(x: number, z: number): boolean {
  return (
    dungeonMapLocal(x, z) !== null || lastKeepLocal(x, z) !== null || dawnholdLocal(x, z) !== null
  );
}

/**
 * First party member (never the local player) standing in a drawable instance,
 * or null. Online, member positions stream with the roster regardless of
 * interest range, so this works while the viewer is on another continent.
 */
export function remoteInstanceAnchor(world: IWorld): RemoteInstanceAnchor | null {
  const party = world.partyInfo;
  if (!party) return null;
  const self = world.player.id;
  for (const m of party.members) {
    if (m.pid === self) continue;
    if (drawableInstanceAt(m.x, m.z)) return { pid: m.pid, x: m.x, z: m.z };
  }
  return null;
}

/**
 * The surface actually painted. The requested level wins whenever it is
 * reachable; `instance` outside an instance needs a remote anchor, otherwise the
 * zone map (the friend may have left the dungeon since the level was picked).
 */
export function resolveMapSurface(
  mode: MapWindowMode,
  level: MapLevel,
  hasRemoteInstance: boolean,
): MapLevel {
  if (level === 'instance' && !isInstanceMode(mode) && !hasRemoteInstance) return 'zone';
  return level;
}

/**
 * The level the toggle button moves to. Inside an instance the cycle is
 * instance -> zone -> continent -> instance; outside it is zone <-> continent,
 * with a detour through the party's instance map when one is drawable.
 */
export function nextMapLevel(
  mode: MapWindowMode,
  level: MapLevel,
  hasRemoteInstance: boolean,
): MapLevel {
  const surface = resolveMapSurface(mode, level, hasRemoteInstance);
  if (surface === 'instance') return 'zone';
  if (surface === 'zone') return 'continent';
  return isInstanceMode(mode) || hasRemoteInstance ? 'instance' : 'zone';
}

/** Visible label for the toggle: names the surface a press switches TO. */
export function mapLevelToggleKey(
  mode: MapWindowMode,
  level: MapLevel,
  hasRemoteInstance: boolean,
): TranslationKey {
  const next = nextMapLevel(mode, level, hasRemoteInstance);
  if (next === 'instance') return 'hudChrome.continentMap.toInstance';
  return next === 'zone' ? 'hudChrome.continentMap.toZone' : 'hudChrome.continentMap.toWorld';
}
