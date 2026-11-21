// The raid atlas's SHARED marks as pure decisions: the group's raid world
// markers on the map (IWorld.sharedMapMarks, server-authoritative and seen by
// every member in the instance), as distinct from the player's own pins
// (raid_atlas_pins_core.ts, local only). This module maps a mark's wire page
// index to an atlas floor and back, decides whether the local player may edit
// (the sim's own rule, canEditSharedMapMarks), finds the mark under a point and
// builds the paint key part. The eight symbols are the target markers' own
// (star through skull, raid_marker_labels_view.ts names them).
//
// DOM-free and deterministic.

import { canEditSharedMapMarks } from '../../../sim/social/shared_map_marks';
import type { SharedMapMark } from '../../../world_api';
import {
  type RaidAtlasFloorId,
  type RaidAtlasPlan,
  raidAtlasFloorAt,
  raidAtlasPlanFor,
} from './raid_atlas_plan_core';

export const RAID_ATLAS_SHARED_SYMBOLS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

/** A shared mark on an atlas floor, ready to draw. */
export interface RaidAtlasSharedMark {
  symbol: number;
  floor: RaidAtlasFloorId;
  x: number;
  z: number;
}

/** The wire page index of an atlas floor (its place in the plan's page order). */
export function sharedMarkPage(plan: RaidAtlasPlan, floor: RaidAtlasFloorId): number {
  return Math.max(
    0,
    plan.floors.findIndex((f) => f.id === floor),
  );
}

/** The wire page of an instance-local point in `dungeonId`: the atlas floor it
 *  lies on for a raid with an atlas (the world placement's page), else 0. */
export function raidAtlasPageAt(dungeonId: string, lx: number, lz: number): number {
  const plan = raidAtlasPlanFor(dungeonId);
  return plan ? sharedMarkPage(plan, raidAtlasFloorAt(lx, lz)) : 0;
}

/** The group's marks on the atlas's floors (a page the plan lacks is dropped). */
export function sharedMarksOnAtlas(
  plan: RaidAtlasPlan,
  marks: readonly SharedMapMark[],
): RaidAtlasSharedMark[] {
  const out: RaidAtlasSharedMark[] = [];
  for (const m of marks) {
    const floor = plan.floors[m.page];
    if (floor) out.push({ symbol: m.symbol, floor: floor.id, x: m.x, z: m.z });
  }
  return out;
}

/** May the local player place and clear the group's marks? Solo and in a
 *  party always; in a raid only its leader (the sim refuses anyone else). */
export function sharedMarksEditable(
  party: { leader: number; raid: boolean } | null,
  playerId: number,
): boolean {
  return canEditSharedMapMarks(party, playerId);
}

/** The topmost shared mark on `floor` within `radius` px of (sx, sy), or null. */
export function sharedMarkAtScreen(
  marks: readonly RaidAtlasSharedMark[],
  floor: RaidAtlasFloorId,
  project: (x: number, z: number) => { sx: number; sy: number },
  sx: number,
  sy: number,
  radius: number,
): RaidAtlasSharedMark | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (m.floor !== floor) continue;
    const p = project(m.x, m.z);
    if (Math.hypot(p.sx - sx, p.sy - sy) <= radius) return m;
  }
  return null;
}

/** The marks' part of a paint key (a moved, added or cleared mark repaints). */
export function sharedMarksKey(marks: readonly RaidAtlasSharedMark[]): string {
  return marks.map((m) => `${m.symbol}${m.floor[0]}${m.x},${m.z}`).join('.');
}
