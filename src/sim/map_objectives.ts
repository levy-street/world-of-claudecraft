// The game-mode anchors an authored map carries, resolved into the record the
// objective driver reasons about.
//
// A map tags placements with a `regionRole`, this is where each team's flag
// stands, where it respawns, where its graveyard is, where the rune pads sit.
// Until now those tags only ever reached the Ravenrift SOURCE EXPORT
// (editor/regions/region_export_core.ts), which rewrites a generated module a
// human then commits; nothing read them at runtime, so a maker who placed a
// flag on their own map got a banner model and nothing else.
//
// This module is the runtime half: one pure projection from a placement list to
// a MapObjectives record, carried on WorldContent so the sim can see it without
// knowing anything about MapDoc. Sim layer, pure data, no DOM, no Three.
//
// Deliberately NOT the same shape as battleground_layout's BgLayoutRecord: that
// record also carries Ravenrift's wall and cover geometry, which an authored map
// expresses as ordinary placements with their own collision. Only the anchors
// the MODE reasons about live here.

import type { MapPlacement, RegionRole } from './map_doc';

export interface ObjectivePoint {
  x: number;
  z: number;
}

/** One team's anchors. */
export interface ObjectiveBase {
  team: 0 | 1;
  /** Flag home + capture point. Null when the map never placed one. */
  flag: ObjectivePoint | null;
  /** Respawn ring, in author order. */
  spawns: ObjectivePoint[];
  /** Spawn banner (the visible marker players orient on). */
  banner: ObjectivePoint | null;
  /** Graveyard plot centre, where spirits are released. */
  graveyard: ObjectivePoint | null;
}

export interface MapObjectives {
  bases: [ObjectiveBase, ObjectiveBase];
  speedRunes: ObjectivePoint[];
  powerRunes: ObjectivePoint[];
}

const EMPTY_BASE = (team: 0 | 1): ObjectiveBase => ({
  team,
  flag: null,
  spawns: [],
  banner: null,
  graveyard: null,
});

/** True when the record has enough to run a capture-the-flag rehearsal: both
 *  flags and at least one spawn a side. Everything else is optional dressing. */
export function objectivesArePlayable(o: MapObjectives | undefined): boolean {
  if (!o) return false;
  return o.bases.every((b) => b.flag !== null && b.spawns.length > 0);
}

/**
 * Read a placement list's `regionRole` tags into the objective record.
 *
 * Duplicates are a real authoring accident (it is one keypress to copy a flag),
 * so the FIRST tag of each single-valued role wins and the rest are ignored
 * rather than silently fighting each other at runtime. Order is the placement
 * order, which is stable across a save/load.
 */
export function mapObjectivesFromPlacements(
  placements: readonly MapPlacement[],
): MapObjectives | undefined {
  const bases: [ObjectiveBase, ObjectiveBase] = [EMPTY_BASE(0), EMPTY_BASE(1)];
  const speedRunes: ObjectivePoint[] = [];
  const powerRunes: ObjectivePoint[] = [];
  let found = false;

  const single = (base: ObjectiveBase, key: 'flag' | 'banner' | 'graveyard', p: MapPlacement) => {
    if (base[key] === null) base[key] = { x: p.x, z: p.z };
  };

  for (const p of placements) {
    const role = p.regionRole as RegionRole | undefined;
    if (role === undefined) continue;
    found = true;
    switch (role) {
      case 'flag0':
        single(bases[0], 'flag', p);
        break;
      case 'flag1':
        single(bases[1], 'flag', p);
        break;
      case 'banner0':
        single(bases[0], 'banner', p);
        break;
      case 'banner1':
        single(bases[1], 'banner', p);
        break;
      case 'graveyard0':
        single(bases[0], 'graveyard', p);
        break;
      case 'graveyard1':
        single(bases[1], 'graveyard', p);
        break;
      case 'spawn0':
        bases[0].spawns.push({ x: p.x, z: p.z });
        break;
      case 'spawn1':
        bases[1].spawns.push({ x: p.x, z: p.z });
        break;
      case 'speedRune':
        speedRunes.push({ x: p.x, z: p.z });
        break;
      case 'powerRune':
        powerRunes.push({ x: p.x, z: p.z });
        break;
    }
  }
  if (!found) return undefined;
  return { bases, speedRunes, powerRunes };
}
