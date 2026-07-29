// camp_brazier_placement_core: where the camp fires stand and which kind each
// one is. Pure (no Three, no DOM): the camps, the authored campfires, and the
// world probes all arrive as arguments, so the whole layout is a deterministic
// function a Vitest drives directly (the streetlamp_layout shape).
//
// Only fire-building camps qualify (night_accents_core.fireBuildingCamps), and
// only the ones no authored campfire already lights (uncoveredCampSites). Half
// the fires are a tall iron BRAZIER, half a low stone FIRE PIT, split by the
// shared deterministic placement roll.

import type { MobFamily } from '../sim/types';
import { fireBuildingCamps, uncoveredCampSites } from './night_accents_core';

export type CampFireKind = 'brazier' | 'firepit';

export interface BrazierSite {
  x: number;
  z: number;
  y: number;
  yaw: number;
  kind: CampFireKind;
}

export interface BrazierProbes {
  /** ground height at a world XZ (the sim's terrainHeight, bound to the seed) */
  groundAt(x: number, z: number): number;
  /** true when a prop, building, or collider already owns this spot */
  blocked(x: number, z: number): boolean;
  /** distance from a world XZ to the painted road centre (the sim's roadDistance) */
  roadClear(x: number, z: number): number;
  /** deterministic 0..1 roll for a world XZ (the shared propPlacementRoll) */
  roll(x: number, z: number, n: number): number;
}

/** Fallback rings the placement walks when the camp centre is occupied or on
 *  the road: the near ring keeps the fire at the heart of the camp, the wide
 *  one exists for the few camps authored hard against a road. */
export const FALLBACK_RINGS = [2.6, 4.2] as const;
/** A camp authored right against a road keeps its fire off the track. */
export const ROAD_CLEAR = 2.0;

/**
 * Lay out every camp fire. A centre the colliders already own (a tent, a
 * rock) or one authored right against the painted road slides to the best
 * spot on a small deterministic ring. The slide is BEST-EFFORT by design: if
 * every ring spot is blocked too, the centre wins, and if the clearest
 * unblocked spot still sits nearer the road than ROAD_CLEAR, that spot wins,
 * because a camp with no fire at all is the worse bug either way. "No fire in
 * the road" is therefore a property the camp DATA upholds (and the real-world
 * suite pins), not one this code can promise for arbitrary future camps.
 */
export function planCampBrazierSites(
  camps: readonly { mobId: string; center: { x: number; z: number } }[],
  campfires: readonly (readonly [number, number])[],
  familyOf: (mobId: string) => MobFamily | undefined,
  probes: BrazierProbes,
  waterLevel: number,
): BrazierSite[] {
  const sites: BrazierSite[] = [];
  for (const camp of uncoveredCampSites(campfires, fireBuildingCamps(camps, familyOf))) {
    let x = camp.x;
    let z = camp.z;
    if (probes.blocked(x, z) || probes.roadClear(x, z) < ROAD_CLEAR) {
      // First choice: unblocked AND off the road, nearest ring first. Second:
      // unblocked with the most road clearance any ring offers. Last resort:
      // the centre itself.
      let bestX = Number.NaN;
      let bestZ = Number.NaN;
      let bestClear = -Infinity;
      search: for (const ring of FALLBACK_RINGS) {
        for (let k = 0; k < 8; k++) {
          const angle = (k / 8) * Math.PI * 2;
          const cx = camp.x + Math.cos(angle) * ring;
          const cz = camp.z + Math.sin(angle) * ring;
          if (probes.blocked(cx, cz)) continue;
          const clear = probes.roadClear(cx, cz);
          if (clear > bestClear) {
            bestClear = clear;
            bestX = cx;
            bestZ = cz;
          }
          if (clear >= ROAD_CLEAR) break search;
        }
      }
      if (!Number.isNaN(bestX)) {
        x = bestX;
        z = bestZ;
      }
    }
    const y = probes.groundAt(x, z);
    if (y < waterLevel) continue; // a drowned camp lights nothing
    sites.push({
      x,
      z,
      y,
      yaw: probes.roll(x, z, 33) * Math.PI * 2,
      kind: probes.roll(x, z, 34) < 0.5 ? 'firepit' : 'brazier',
    });
  }
  return sites;
}
