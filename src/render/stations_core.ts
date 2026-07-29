// Pure placement core for the crafting-station scenery (Professions 2.0).
// Maps each station record supplied through the active IWorld seam to the
// world-space prop cluster the Three half
// (stations.ts) places at it: one thematic anchor prop BESIDE the station
// pos (the point itself is an interaction target routes end on, and the
// props are solid) plus a little fixed clutter. Hand-authored offsets, not
// procedural scatter, so exact spots matter more than variety; offsets keep
// clear of each resident master
// NPC (1 to 3 units beside the station, see the STATIONS placement notes).
//
// Deliberately NO radius ring, circle, or boundary decal spec: the station
// gate has no visual precision by design (the Eastbrook loom/toolworks
// overlap is a documented drift note).
//
// Three/DOM/i18n-free and deterministic (RENDER_PURE_CORES) so a plain
// Vitest can pin that every station gets a cluster and every placement
// stays anchored to its station pos.

import type { StationDef, StationType } from '../sim/professions/stations';
import { STATION_PROP_CLUSTERS as CLUSTERS, type StationPropKind } from '../sim/town_props';

/** The reused prop vocabulary a station cluster draws from (each maps to an
 *  EXISTING GLB in stations.ts; no new assets). */
export type { StationPropKind };

/** One prop in a station-type cluster, offset (yd) from the station pos. */
export interface StationClusterProp {
  kind: StationPropKind;
  dx: number;
  dz: number;
  rot: number;
}

/** A placed station prop in world space, ready for the Three half. */
export interface StationPropPlacement {
  stationId: string;
  kind: StationPropKind;
  x: number;
  z: number;
  rot: number;
}

// The cluster layout now lives in `src/sim/town_props.ts` so COLLISION can see
// it: these props stand in the middle of town and used to be walk-through
// because the sim had no idea they existed. Re-exported here to keep this
// module's public surface unchanged for the Three half.
export const STATION_PROP_CLUSTERS = CLUSTERS;

/** Flatten stations x STATION_PROP_CLUSTERS into world-space placements, in
 *  content order (deterministic). */
export function stationPropPlacements(stations: readonly StationDef[]): StationPropPlacement[] {
  const out: StationPropPlacement[] = [];
  for (const station of stations) {
    for (const prop of STATION_PROP_CLUSTERS[station.type]) {
      out.push({
        stationId: station.id,
        kind: prop.kind,
        x: station.pos.x + prop.dx,
        z: station.pos.z + prop.dz,
        rot: prop.rot,
      });
    }
  }
  return out;
}
