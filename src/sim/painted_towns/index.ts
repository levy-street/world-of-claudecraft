// Painted towns: the built-in towns whose kit houses are replaced by the
// painted Tidehold buildings through one shared recipe, each town one frozen
// layout module in this directory (sim/painted_towns/CLAUDE.md). Every
// consumer reads PAINTED_TOWNS (through sim/authored_town_registry.ts for the
// sim, render/painted_towns.ts for the views), never a town by name, so a
// town is rebuilt by filling in its module and its zone file alone.
import type { BuildingDef } from '../types';
import { BRIDGEMERE_LAYOUT } from './bridgemere';
import { DRIFTHAVEN_LAYOUT } from './drifthaven';
import { ELDERSHINE_LAYOUT } from './eldershine';
import { GIBBETMERE_LAYOUT } from './gibbetmere';
import { GULLHAVEN_LAYOUT } from './gullhaven';
import { HEDGEWICK_LAYOUT } from './hedgewick';
import { ICEMANTLE_LAYOUT } from './icemantle';
import { LANTERNMERE_LAYOUT } from './lanternmere';
import { MOONREST_LAYOUT } from './moonrest';
import type { PaintedTownLayout } from './types';
import { WICKHARBOR_LAYOUT } from './wickharbor';

export {
  BRIDGEMERE_BUILDINGS_BY_ID,
  BRIDGEMERE_CAUSEWAY_ROAD,
  BRIDGEMERE_LAYOUT,
  BRIDGEMERE_NPC_PLACEMENTS_BY_ID,
} from './bridgemere';
export {
  DRIFTHAVEN_BUILDINGS_BY_ID,
  DRIFTHAVEN_LAYOUT,
  DRIFTHAVEN_NPC_PLACEMENTS_BY_ID,
} from './drifthaven';
export {
  ELDERSHINE_BUILDINGS_BY_ID,
  ELDERSHINE_LAYOUT,
  ELDERSHINE_NPC_PLACEMENTS_BY_ID,
} from './eldershine';
export {
  GIBBETMERE_BUILDINGS_BY_ID,
  GIBBETMERE_LAYOUT,
  GIBBETMERE_NPC_PLACEMENTS_BY_ID,
} from './gibbetmere';
export {
  GULLHAVEN_BUILDINGS_BY_ID,
  GULLHAVEN_LAYOUT,
  GULLHAVEN_NPC_PLACEMENTS_BY_ID,
} from './gullhaven';
export {
  HEDGEWICK_BUILDINGS_BY_ID,
  HEDGEWICK_LAYOUT,
  HEDGEWICK_NPC_PLACEMENTS_BY_ID,
} from './hedgewick';
export {
  ICEMANTLE_BUILDINGS_BY_ID,
  ICEMANTLE_LAYOUT,
  ICEMANTLE_NPC_PLACEMENTS_BY_ID,
} from './icemantle';
export {
  LANTERNMERE_BUILDINGS_BY_ID,
  LANTERNMERE_LAYOUT,
  LANTERNMERE_NPC_PLACEMENTS_BY_ID,
} from './lanternmere';
export {
  PAINTED_LOOK_MODELS,
  PAINTED_LOOK_SETS,
  PAINTED_MODELS,
  type PaintedLook,
  type PaintedModel,
  type PaintedModelSpec,
  type PaintedTownBuildingSpec,
  paintedTownBuilding,
} from './models';
export {
  MOONREST_BUILDINGS_BY_ID,
  MOONREST_LAYOUT,
  MOONREST_MOONSPRING_ROAD,
  MOONREST_NPC_PLACEMENTS_BY_ID,
} from './moonrest';
export type {
  PaintedTownId,
  PaintedTownLayout,
  ReplacedDecorProp,
  ReplacedKitBuilding,
  TownNpcStand,
  TownPad,
} from './types';
export {
  WICKHARBOR_BUILDINGS_BY_ID,
  WICKHARBOR_LAYOUT,
  WICKHARBOR_NPC_PLACEMENTS_BY_ID,
} from './wickharbor';

/** Every painted town, in a fixed order (their pads append to the built-in
 *  world's terrain edits in this order). */
export const PAINTED_TOWNS: readonly PaintedTownLayout[] = Object.freeze([
  GULLHAVEN_LAYOUT,
  WICKHARBOR_LAYOUT,
  HEDGEWICK_LAYOUT,
  DRIFTHAVEN_LAYOUT,
  BRIDGEMERE_LAYOUT,
  ICEMANTLE_LAYOUT,
  LANTERNMERE_LAYOUT,
  MOONREST_LAYOUT,
  GIBBETMERE_LAYOUT,
  ELDERSHINE_LAYOUT,
]);

/** A layout's buildings as the zone file's building records (the mapping
 *  Highwatch's zone3.ts uses): the record IS the painted building, so
 *  collision, the rest area and the map silhouette follow its walls. */
export function paintedTownBuildingDefs(layout: PaintedTownLayout): BuildingDef[] {
  return layout.buildings.map((building) => ({
    id: building.id,
    assetId: building.assetId,
    kind: building.kind,
    x: building.position.x,
    z: building.position.z,
    w: building.nativeDimensions.width,
    d: building.nativeDimensions.depth,
    rot: building.rotation,
    height: building.nativeDimensions.height,
  }));
}
