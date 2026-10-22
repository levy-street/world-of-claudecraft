// The built-in towns that stand painted Tidehold buildings, in one list:
// Eastbrook (sim/eastbrook_layout.ts), Fenbridge (sim/fenbridge_layout.ts),
// Highwatch (sim/highwatch_layout.ts) and every painted town after them
// (sim/painted_towns/). Every consumer that has to know which
// building records belong to a rebuilt town (their colliders and walk-in
// floors, the inn's rest area, the custom-world strip, Studio's promotion)
// reads this list instead of naming the towns one by one.
//
// `promotedBy` is the promoted-scenery family a document sets when it owns a
// town's buildings as its own placements. Eastbrook and Fenbridge share the
// original `authoredTowns` family; Highwatch has its own, because a document
// saved before Highwatch was rebuilt carries `authoredTowns` but none of
// Highwatch's placements, and sharing the flag would stand its buildings down
// with nothing to replace them (the same reason the Eastbrook vault has its
// own family). The painted towns share `paintedTowns` for the same reason:
// they arrived together, so a document carries all of them or none.
import { EASTBROOK_LAYOUT } from './eastbrook_layout';
import { FENBRIDGE_LAYOUT } from './fenbridge_layout';
import { HIGHWATCH_LAYOUT } from './highwatch_layout';
import { PAINTED_TOWNS, type PaintedTownId } from './painted_towns';
import type { PromotedScenery } from './types';

export type AuthoredTownFamily = 'authoredTowns' | 'highwatchTown' | 'paintedTowns';

interface TownPoint {
  readonly x: number;
  readonly z: number;
}

interface TownBox {
  readonly id: string;
  readonly center: TownPoint;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly rotation: number;
}

/** The shape every town's makePlacedBuilding gives its records. */
export interface AuthoredTownBuildingRecord {
  readonly id: string;
  readonly assetId: string;
  readonly kind: 'house' | 'inn' | 'chapel';
  readonly position: TownPoint;
  readonly nativeDimensions: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
  };
  readonly rotation: number;
  readonly frontStandingPoint: TownPoint;
  readonly annexes: readonly TownBox[];
  readonly reach: TownBox;
  readonly placement: {
    readonly x: number;
    readonly z: number;
    readonly rotation: number;
    readonly scale: number;
    readonly lift: number;
    /** Fixed ground seat for a detached Studio placement; otherwise sample terrain. */
    readonly groundY?: number;
    /** Walk-in towns only: the model's largest dimension at authored size. */
    readonly modelSize?: number;
  };
  /** Walk-in towns only: an open doorway a player walks through. */
  readonly walkIn?: boolean;
}

export interface AuthoredTown {
  readonly id: 'eastbrook' | 'fenbridge' | 'highwatch' | PaintedTownId;
  readonly promotedBy: AuthoredTownFamily;
  readonly buildings: readonly AuthoredTownBuildingRecord[];
}

export const AUTHORED_TOWNS: readonly AuthoredTown[] = Object.freeze([
  { id: 'eastbrook', promotedBy: 'authoredTowns', buildings: EASTBROOK_LAYOUT.buildings },
  { id: 'fenbridge', promotedBy: 'authoredTowns', buildings: FENBRIDGE_LAYOUT.buildings },
  { id: 'highwatch', promotedBy: 'highwatchTown', buildings: HIGHWATCH_LAYOUT.buildings },
  ...PAINTED_TOWNS.map(
    (town): AuthoredTown => ({
      id: town.id,
      promotedBy: 'paintedTowns',
      buildings: town.buildings,
    }),
  ),
]);

/** Every rebuilt town's building records, Eastbrook first. */
export const AUTHORED_TOWN_BUILDINGS: readonly AuthoredTownBuildingRecord[] = Object.freeze(
  AUTHORED_TOWNS.flatMap((town) => town.buildings),
);

/** Whether a document owns this town's buildings as its own placements. */
export function authoredTownPromoted(
  promoted: PromotedScenery | undefined,
  town: AuthoredTown,
): boolean {
  return promoted?.[town.promotedBy] === true;
}

/** The ids of the rebuilt towns' inns: their rest areas follow the collider
 *  (building_layout.ts buildingContainsRestPoint). */
export const AUTHORED_TOWN_INN_IDS: ReadonlySet<string> = new Set(
  AUTHORED_TOWN_BUILDINGS.filter((building) => building.kind === 'inn').map(
    (building) => building.id,
  ),
);
