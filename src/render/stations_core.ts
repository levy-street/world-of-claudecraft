// Pure placement core for the crafting-station scenery (Professions 2.0
// Phase 9). Maps each STATIONS record (src/sim/content/professions.ts, via
// the sim/data barrel) to the world-space prop cluster the Three half
// (stations.ts) places at it: one thematic anchor prop on the station pos
// plus a little fixed clutter beside it. Hand-authored offsets, not
// procedural scatter, so exact spots matter more than variety (the
// artisan_row_props.ts idiom); offsets keep clear of each resident master
// NPC (1 to 3 units beside the station, see the STATIONS placement notes).
//
// Deliberately NO radius ring, circle, or boundary decal spec: the station
// gate has no visual precision by design (the Eastbrook loom/toolworks
// overlap is a documented drift note).
//
// Three/DOM/i18n-free and deterministic (RENDER_PURE_CORES) so a plain
// Vitest can pin that every station gets a cluster and every placement
// stays anchored to its station pos.

import { STATIONS } from '../sim/data';
import type { StationType } from '../sim/professions/stations';

/** The reused prop vocabulary a station cluster draws from (each maps to an
 *  EXISTING GLB in stations.ts; no new assets). */
export type StationPropKind =
  | 'anvil'
  | 'campfire'
  | 'cauldron'
  | 'tanningRack'
  | 'loom'
  | 'workbench'
  | 'crate'
  | 'barrel';

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

// Per-type clusters: the anchor prop sits ON the station pos (dx/dz 0) so
// the spot the proximity gate measures from is the spot the player sees.
// Clutter offsets stay within ~1.5 yd and avoid each master NPC's side
// (forge master at station -2,-1.5; kitchens -1.5,-1.5; loom -2,-1;
// toolworks -1.5,-2; tannery +2,+1.5; apothecary +1.5,-2).
export const STATION_PROP_CLUSTERS: Readonly<Record<StationType, readonly StationClusterProp[]>> = {
  forge: [
    { kind: 'anvil', dx: 0, dz: 0, rot: 0.9 },
    { kind: 'barrel', dx: -1.1, dz: 1.0, rot: 0.3 },
    { kind: 'crate', dx: 1.0, dz: -1.2, rot: -0.5 },
  ],
  kitchens: [
    { kind: 'campfire', dx: 0, dz: 0, rot: 0 },
    { kind: 'crate', dx: 1.2, dz: 0.5, rot: 0.7 },
    { kind: 'barrel', dx: -0.5, dz: 1.4, rot: -0.2 },
  ],
  apothecary: [
    { kind: 'cauldron', dx: 0, dz: 0, rot: -0.4 },
    { kind: 'crate', dx: -1.3, dz: 0.5, rot: 0.4 },
    { kind: 'barrel', dx: 0.9, dz: 1.2, rot: 0.9 },
  ],
  tannery: [
    { kind: 'tanningRack', dx: 0, dz: 0, rot: 0.3 },
    { kind: 'barrel', dx: -1.3, dz: 0.7, rot: -0.6 },
    { kind: 'crate', dx: 0.5, dz: -1.4, rot: 1.1 },
  ],
  loom: [
    { kind: 'loom', dx: 0, dz: 0, rot: 0.6 },
    { kind: 'crate', dx: 1.3, dz: 0.6, rot: -0.3 },
    { kind: 'barrel', dx: 0.4, dz: 1.5, rot: 0.5 },
  ],
  toolworks: [
    { kind: 'workbench', dx: 0, dz: 0, rot: -0.4 },
    { kind: 'crate', dx: 1.2, dz: 0.8, rot: 0.2 },
    { kind: 'barrel', dx: -1.0, dz: 1.1, rot: -0.8 },
  ],
};

/** Flatten STATIONS x STATION_PROP_CLUSTERS into world-space placements, in
 *  content order (deterministic). */
export function stationPropPlacements(): StationPropPlacement[] {
  const out: StationPropPlacement[] = [];
  for (const station of STATIONS) {
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
