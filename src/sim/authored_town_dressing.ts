// The authored towns' (Eastbrook Vale / Fenbridge) square DRESSING, the
// pieces the town views draw from their static layouts beside the buildings:
// Eastbrook's market stalls, benches and yard fences, and Fenbridge's
// Mirelight cistern, provision stall, muster board and boardwalks.
//
// A Studio document can own that dressing as ordinary placements
// (promotedScenery.authoredTownDressing): the town views stand their copies
// down, and the props RECORDS that still carry the stalls, the cistern and the
// fences keep feeding everything else that reads them (market ambience, the
// terrain calm anchors, the map dots) while their colliders stand down here,
// so a moved stall leaves no invisible box on the square. colliders.ts and
// fence_crossing.ts must not import src/render, so this is the sim-side twin
// of the render predicates in eastbrook_town.ts / fenbridge_town.ts. Records
// match by their stable layout ids, the custom_world_props.ts convention, so a
// record a document nudged still stands down.
//
// The town BUILDING records ride the same filter (authored_town_buildings.ts
// promotedTownBuildingStandsDown, promotedScenery.authoredTowns /
// eastbrookVault), so colliders.ts reads every promoted family through one
// call. Bench records need nothing: custom worlds never carry Eastbrook's
// (custom_world_props.ts), and the built-in world promotes nothing.

import { promotedTownBuildingStandsDown } from './authored_town_buildings';
import { EASTBROOK_LAYOUT } from './eastbrook_layout';
import { FENBRIDGE_LAYOUT } from './fenbridge_layout';
import type { PromotedScenery, ZonePropsDef } from './types';

type StallRecord = ZonePropsDef['stalls'][number];
type WellRecord = ZonePropsDef['wells'][number];
type FenceRecord = ZonePropsDef['fences'][number];

const DRESSING_STALL_IDS: ReadonlySet<string> = new Set([
  ...EASTBROOK_LAYOUT.market.stalls.map((stall) => stall.id),
  FENBRIDGE_LAYOUT.civic.provisionStall.id,
]);
const DRESSING_FENCE_IDS: ReadonlySet<string> = new Set(
  EASTBROOK_LAYOUT.fences.map((fence) => fence.id),
);

/** An Eastbrook market stall or the Fenbridge provision stall. */
export function isAuthoredTownDressingStall(stall: StallRecord): boolean {
  return stall.id !== undefined && DRESSING_STALL_IDS.has(stall.id);
}

/** The Fenbridge Mirelight cistern. Eastbrook's well record is the Realm
 *  Builder monument, which stays town-drawn (it is an interactable). */
export function isAuthoredTownDressingWell(well: WellRecord): boolean {
  return well.id === FENBRIDGE_LAYOUT.civic.cistern.id;
}

/** An Eastbrook yard fence. */
export function isAuthoredTownDressingFence(fence: FenceRecord): boolean {
  return fence.id !== undefined && DRESSING_FENCE_IDS.has(fence.id);
}

/**
 * The props records whose COLLIDERS still stand: every record, unless the
 * document owns some of them as placements (the town buildings, the Weekly
 * Vault, the square dressing), in which case those drop out (the placements
 * carry their own collision). Returns the input object untouched when nothing
 * stands down, so the built-in world (no promoted scenery, by construction)
 * cannot drift.
 */
export function promotedColliderProps(
  props: ZonePropsDef,
  promoted: PromotedScenery | undefined,
): ZonePropsDef {
  if (!promoted) return props;
  const towns = promoted.authoredTowns === true || promoted.eastbrookVault === true;
  const dressing = promoted.authoredTownDressing === true;
  if (!towns && !dressing) return props;
  // fence_crossing.ts asks per movement step: filter once per props object
  // and flag combination.
  const key = `${promoted.authoredTowns === true}|${promoted.eastbrookVault === true}|${dressing}`;
  let byFlags = STOOD_DOWN.get(props);
  const cached = byFlags?.get(key);
  if (cached) return cached;
  const stood: ZonePropsDef = { ...props };
  if (towns) {
    stood.buildings = props.buildings.filter((b) => !promotedTownBuildingStandsDown(promoted, b));
  }
  if (dressing) {
    stood.stalls = props.stalls.filter((stall) => !isAuthoredTownDressingStall(stall));
    stood.wells = props.wells.filter((well) => !isAuthoredTownDressingWell(well));
    stood.fences = props.fences.filter((fence) => !isAuthoredTownDressingFence(fence));
  }
  if (!byFlags) {
    byFlags = new Map();
    STOOD_DOWN.set(props, byFlags);
  }
  byFlags.set(key, stood);
  return stood;
}

/** Keyed by the world's own props object, so a new world (a new document
 *  projection) misses and the previous one's entries are collectable. */
const STOOD_DOWN = new WeakMap<ZonePropsDef, Map<string, ZonePropsDef>>();
