// Pure camp-circuit logic for the leveling bot (mode 'level'): which grind
// camp to work next, and which zone band to move to when the current one is
// all gray. Data comes from the real content tables by default (CAMPS and
// MOBS from src/sim/data.ts, ZONES for band progression); everything is
// injectable so tests can drive synthetic tables. No IO, no clock.
//
// CampDef carries no zoneId and no mob level: the zone is derived from the
// camp center via zoneIdAt (zoneAt on the overworld), and the level band
// from the camp mob template's minLevel/maxLevel. A camp is JUDGED by its
// template's maxLevel: spawn rolls land anywhere in [min, max], and a camp
// whose ceiling still pays XP is worth the walk.

import { CAMPS, MOBS, ZONES, zoneAt } from '../src/sim/data';
import { type CampDef, type MobTemplate, mobXpValue, type ZoneDef } from '../src/sim/types';

export interface GrindCamp extends CampDef {
  zoneId: string;
  minLevel: number;
  maxLevel: number;
}

export interface GrindTables {
  camps: readonly CampDef[];
  mobs: Readonly<Record<string, MobTemplate>>;
  zoneIdAt: (x: number, z: number) => string;
  xpValue: (mobLevel: number, playerLevel: number) => number;
  zoneDefs: readonly ZoneDef[];
}

export function defaultGrindTables(): GrindTables {
  return {
    camps: CAMPS,
    mobs: MOBS,
    zoneIdAt: (x, z) => zoneAt(x, z).id,
    xpValue: mobXpValue,
    zoneDefs: ZONES,
  };
}

function dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return dx * dx + dz * dz;
}

// Every camp in a zone, with its mob's level band attached. Camps whose mobId
// has no template are dropped (a content typo must not route the bot to a
// camp it cannot judge).
export function zoneCampsFor(zoneId: string, tables: GrindTables): GrindCamp[] {
  const out: GrindCamp[] = [];
  for (const camp of tables.camps) {
    if (tables.zoneIdAt(camp.center.x, camp.center.z) !== zoneId) continue;
    const template = tables.mobs[camp.mobId];
    if (!template) continue;
    out.push({ ...camp, zoneId, minLevel: template.minLevel, maxLevel: template.maxLevel });
  }
  return out;
}

// A camp is judged by its top spawn level (see the header).
export function campMobLevel(camp: GrindCamp): number {
  return camp.maxLevel;
}

// The camp to work next: mob not gray for the player and inside the level
// window [playerLevel - 2, playerLevel + 3], then nearest, density breaking
// ties (a denser camp means less walking per kill).
export function pickCamp(
  playerLevel: number,
  camps: readonly GrindCamp[],
  playerPos: { x: number; z: number },
  xpValue: (mobLevel: number, playerLevel: number) => number,
): GrindCamp | null {
  const viable = camps.filter((camp) => {
    const level = campMobLevel(camp);
    if (xpValue(level, playerLevel) <= 0) return false;
    return level >= playerLevel - 2 && level <= playerLevel + 3;
  });
  if (viable.length === 0) return null;
  let best = viable[0];
  let bestD2 = dist2(playerPos, best.center);
  for (const camp of viable.slice(1)) {
    const d2 = dist2(playerPos, camp.center);
    if (d2 < bestD2 || (d2 === bestD2 && camp.count > best.count)) {
      best = camp;
      bestD2 = d2;
    }
  }
  return best;
}

// Zone band progression: the lowest levelRange zone that covers playerLevel
// AND has at least one authored camp. Null when nothing fits (past every
// band, or a level with no camps anywhere).
export function nextLevelZoneId(playerLevel: number, tables: GrindTables): string | null {
  const candidates = tables.zoneDefs
    .filter((zone) => playerLevel >= zone.levelRange[0] && playerLevel <= zone.levelRange[1])
    .filter((zone) => zoneCampsFor(zone.id, tables).length > 0)
    .sort((a, b) => a.levelRange[0] - b.levelRange[0]);
  return candidates.length > 0 ? candidates[0].id : null;
}
