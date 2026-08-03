import { beaconSpiralLift } from './beacon_spiral';
import {
  castleLift,
  castlePadTarget,
  castlePadWeight,
  castleSkirtWeight,
  LAST_SPRING,
} from './castle_layout';
import { STABLE_FLAT, STABLE_PADDOCK } from './content/mounts';
import { PALMREACH_PROPS } from './content/palmreach';
import {
  CAMPS,
  COLUMN_ZONES,
  columnBlendAt,
  DUNGEON_FLOOR_Y,
  DUNGEON_X_THRESHOLD,
  dungeonAt,
  getActiveWorldContent,
  getContentGeneration,
  instanceOrigin,
  instanceSlotForZ,
  ROADS,
  STRIP_MAX_X,
  STRIP_MIN_X,
  STRIP_ZONES,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  worldXBoundsAt,
  ZONES,
} from './data';
import { dockLocalPoint, dockSectionAtLocal, dockSurfaceLine, dockSurfaceYAt } from './dock_layout';
import { dungeonFloorLift } from './dungeon_floor';
import { lastKeepLiftAt } from './dungeon_layout';
import {
  EMBER_FLAT_POOLS,
  EMBER_LAVA_LINKS,
  emberLinkDistanceNorm,
  emberNearestOnLink,
} from './ember_lava_layout';
import { GALE_DECK_FREEBOARD, galeDeckSurface } from './gale_harbor';
import { reachDeckClear, reachDeckSurface } from './reach_decks';
import { fbm2, hash2, noise2 } from './rng';
import {
  buildTerrainRegionIndex,
  TERRAIN_APPLIER,
  TERRAIN_APPLIER_BOUNDS,
  type TerrainRegionCell,
  type TerrainRegionIndex,
  terrainRegionCellAt,
  terrainRegionHas,
} from './terrain_region_index';
import type { BiomeId, HeightStamp, WorldContent, ZoneDef } from './types';
import { isInSowfieldShell, SOWFIELD_FLAT, sowfieldStandLift } from './vale_cup_layout';
import { wildheartFieldHeight } from './wildheart_field';

// Terrain is a pure function of (x, z, seed): both the sim (ground clamping)
// and the renderer (mesh) sample the same heightfield, so they always agree.
//
// The world is a north-running strip of zone bands (see ZONES in data.ts).
// Each biome shapes the heightfield differently — the vale rolls, the marsh
// lies low and flat, the peaks tower — with smooth blends at the boundaries
// and a mountain ridge wall between zones, pierced by a road pass.

const HILL_SCALE = 0.013;
const DETAIL_SCALE = 0.05;

export const WATER_LEVEL = -4.5;

// The ACTIVE water surface height: the custom map's level if one is loaded, else
// the built-in constant. Cheap (identity-cached content lookup), safe in hot
// paths. For the built-in world getActiveWorldContent() has no waterLevel, so
// this equals WATER_LEVEL.
export function waterLevel(): number {
  return getActiveWorldContent().waterLevel ?? WATER_LEVEL;
}

// A declared lake's footprint reaches this multiple past its authored radius
// (the same soft-edge basin blend baseHeight uses below), so the render plane,
// the walkable-depth floor, and the terrain basin itself all agree on where a
// lake actually ends.
export const LAKE_BLEND_RADIUS_MULT = 1.6;

// True when (x,z) falls inside a declared lake's footprint (any active zone's
// `lakes` list) or one of the programmatic border waters (the moats, column
// straits, and row meres where two maps meet: BORDER_WATERS below). Terrain
// outside every water body is never "water", no matter how far its height dips
// below waterLevel(): a content author's sunken feature (crater, sinkhole,
// tunnel) stays dry and walkable as long as it isn't inside one of these
// footprints. (The open seas are handled separately by the coastal appliers
// and inHollowOpenSea.)
export function isInWaterBody(x: number, z: number): boolean {
  if (inBorderWater(x, z)) return true;
  for (const zone of getActiveWorldContent().zones) {
    for (const lake of zone.lakes) {
      const dSq = (x - lake.x) ** 2 + (z - lake.z) ** 2;
      const rMax = lake.radius * LAKE_BLEND_RADIUS_MULT;
      if (dSq < rMax * rMax) return true;
    }
  }
  return false;
}

// The water surface height AT this location: waterLevel() inside a declared
// lake's footprint, else -Infinity (there is no water surface here, so nothing
// reads as flooded and no swim-depth floor applies). Callers that need "is there
// water here at all" should prefer this over a flat global constant.
export function waterLevelAt(x: number, z: number): number {
  return isInWaterBody(x, z) ? waterLevel() : -Infinity;
}

// Every declared lake across the active content's zones, in render/authoring
// footprint (radius already includes the basin blend margin). Used to draw
// water only where it is actually declared.
export function waterBodies(): { x: number; z: number; radius: number }[] {
  const out: { x: number; z: number; radius: number }[] = [];
  for (const zone of getActiveWorldContent().zones) {
    for (const lake of zone.lakes) {
      out.push({ x: lake.x, z: lake.z, radius: lake.radius * LAKE_BLEND_RADIUS_MULT });
    }
  }
  return out;
}

// Hill amplitude / base elevation / hub plateau height per biome.
const BIOME_SHAPE: Record<BiomeId, { hill: number; base: number; hubHeight: number }> = {
  vale: { hill: 26, base: 0, hubHeight: 1.5 },
  marsh: { hill: 11, base: -1.0, hubHeight: 1.2 },
  peaks: { hill: 34, base: 7, hubHeight: 9 },
  // The Veiled Hollow: a sheltered valley, gentler than the peaks that hide it.
  dusk: { hill: 14, base: 2, hubHeight: 2.5 },
  ember: { hill: 16, base: 2.5, hubHeight: 2.5 },
  frost: { hill: 26, base: 6, hubHeight: 3 },
  // the Amberfall: rolling autumn weald around the Great Mere
  amber: { hill: 15, base: 2, hubHeight: 2.5 },
  // the Willowfen: low, wet, and gentle
  fen: { hill: 8, base: -0.3, hubHeight: 2 },
  // the Nightbloom: soft moonlit downs, a touch more rolling than the fen
  night: { hill: 12, base: 1, hubHeight: 2.5 },
  // the Wraithwood: low haunted forest floor under the giant canopies
  haunt: { hill: 13, base: 1.5, hubHeight: 2.5 },
  // the Palmreach: low tropical relief, the coasts flattened to beach by
  // the jungle coast applier
  jungle: { hill: 11, base: 1.2, hubHeight: 2 },
  // the Evergarden: groomed parkland, gentle as a lawn
  garden: { hill: 9, base: 1.8, hubHeight: 2 },
  // the Galecrest: rolling wind-scoured headland downs over sea cliffs
  gale: { hill: 14, base: 2.4, hubHeight: 2.5 },
  // Paint-only biomes (the editor's biome brush): never a zone band in the
  // built-in world, so these rows only shape painted cells on custom maps.
  beach: { hill: 5, base: -2.4, hubHeight: 0.8 },
  desert: { hill: 15, base: 2.5, hubHeight: 2 },
  volcano: { hill: 42, base: 9, hubHeight: 6 },
  cave: { hill: 9, base: 1, hubHeight: 1 },
};

// Ridge walls along every shared zone edge, each opened by a road pass. A
// zone with sealedSouthBorder instead gets a taller, narrower wall with NO
// pass, its crest shifted into the sealed zone's own band so the southern
// neighbor's border content keeps (nearly) its original ground. Sealed
// zones are entered only through a portal (see portals content).
//
// The world is a GRID of zone rectangles (see data.ts zoneAt): horizontal
// edges separate north-south neighbors (the classic band borders) and
// vertical edges separate east-west columns with the same math rotated a
// quarter turn. An edge that spans its whole world row keeps the classic
// unbounded ridge (byte-identical to the strip era); a partial edge
// feathers to nothing past its span ends.
export interface BorderEdge {
  kind: 'h' | 'v';
  at: number; // the edge line: z for 'h', x for 'v'
  lo: number; // span start along the edge (x for 'h', z for 'v')
  hi: number; // span end
  fullRow: boolean; // spans the whole world row: no end feather
  passAt: number; // pass coordinate along the span
  sealed: boolean;
}

/** All shared edges between adjacent zone rects (pure; exported for tests). */
export function computeBorderEdges(zones: readonly ZoneDef[]): BorderEdge[] {
  const zx0 = (zn: ZoneDef) => zn.xMin ?? STRIP_MIN_X;
  const zx1 = (zn: ZoneDef) => zn.xMax ?? STRIP_MAX_X;
  const edges: BorderEdge[] = [];
  for (const a of zones) {
    for (const b of zones) {
      // horizontal edge: b sits directly north of a, rects overlapping in x
      if (a.zMax === b.zMin) {
        const lo = Math.max(zx0(a), zx0(b));
        const hi = Math.min(zx1(a), zx1(b));
        if (hi - lo > 1) {
          const sealed = b.sealedSouthBorder === true;
          // full row = nothing that touches or crosses the border line lies
          // beyond this span (a column zone whose band SPANS the line counts
          // too: its interior must not inherit the row wall)
          const fullRow = zones.every(
            (zn) => zn.zMax < a.zMax || zn.zMin > a.zMax || (zx0(zn) >= lo && zx1(zn) <= hi),
          );
          edges.push({
            kind: 'h',
            at: a.zMax + (sealed ? 15 : 0),
            lo,
            hi,
            fullRow,
            passAt: b.southPassX ?? 0,
            sealed,
          });
        }
      }
      // vertical edge: b sits directly east of a, rects overlapping in z
      if (zx1(a) === zx0(b)) {
        const lo = Math.max(a.zMin, b.zMin);
        const hi = Math.min(a.zMax, b.zMax);
        if (hi - lo > 1) {
          edges.push({
            kind: 'v',
            at: zx1(a),
            lo,
            hi,
            fullRow: false, // a column border never spans the world's full z
            passAt: b.westPassZ ?? a.eastPassZ ?? (lo + hi) / 2,
            sealed: false,
          });
        }
      }
    }
  }
  return edges;
}

const BORDER_EDGES: readonly BorderEdge[] = computeBorderEdges(ZONES);
// Low, broad border ranges: steep enough to read as a border, gentle
// enough that ANY land contact between two maps is walkable over (the
// pass roads stay the easy way; the hills are never a hard wall). Only
// the sealed border is a true barrier.
const RIDGE_HEIGHT = 15;
const RIDGE_SIGMA = 26; // gaussian width of the wall
// Sealed walls: tall and steep enough that the straight-approach gradient
// beats PLAYER_MAX_CLIMB_SLOPE everywhere along the border. The slope gate
// alone cannot seal a smooth wall (it projects rise along the movement
// direction, so a shallow-enough diagonal always sneaks under it); the crest
// line is therefore ALSO a hard movement wall in colliders.resolveMovement
// via crossesSealedBorder below. The terrain steepness is the fiction; the
// crossing check is the guarantee (guarded by tests/veiled_hollow.test.ts).
const SEALED_RIDGE_HEIGHT = 60;
const SEALED_RIDGE_SIGMA = 12;

// Crest z of every sealed border: an uncrossable line for swept movement
// within the edge's x span (plus its feather). Portal teleports assign
// positions directly and are unaffected; the column realms whose bands
// span the same z live outside the span and walk freely.
export const SEALED_BORDERS: readonly { at: number; lo: number; hi: number }[] =
  BORDER_EDGES.filter((e) => e.kind === 'h' && e.sealed).map((e) => ({
    at: e.at,
    lo: e.lo - 24,
    hi: e.hi + 24,
  }));

export function crossesSealedBorder(x: number, z0: number, z1: number): boolean {
  for (const b of SEALED_BORDERS) {
    if (x >= b.lo && x <= b.hi && (z0 - b.at) * (z1 - b.at) < 0) return true;
  }
  return false;
}
const PASS_HALF_WIDTH = 10; // flat opening around the road
const PASS_SHOULDER = 34; // ...rising to full wall by this far from the pass

// The Veiled Hollow's organic relief, layered over the base FBM hills the
// same way the Mirefen crater is: gentle radial features that break the
// band's uniformity into highlands, a meadow bowl, and the falls terrace
// whose steep southern lip pours into Starfall Basin (the lake carve and the
// terrace overlap; the height step between them IS the waterfall cliff,
// dressed by render/realm_flora.ts).
export const HOLLOW_FALLS = {
  terrace: { x: 128, z: 1008, radius: 22, height: 9 },
  // where the lip meets the basin: the render waterfall hangs here
  lip: { x: 118, z: 995 },
} as const;
const HOLLOW_SHAPING = [
  {
    x: HOLLOW_FALLS.terrace.x,
    z: HOLLOW_FALLS.terrace.z,
    r: HOLLOW_FALLS.terrace.radius,
    h: HOLLOW_FALLS.terrace.height,
  },
  { x: -135, z: 1090, r: 45, h: 7 }, // western highlands (the Mirrormere sits in them)
  // the Star's Cradle islet: a dry rise at Starfall Basin's heart, so the
  // fallen star sits ringed by a swimmable moat of lake water
  { x: 110, z: 985, r: 14, h: 8 },
  // the crystal cove highland: a broad gentle shoulder east of the Shallows
  // that slopes long and smooth down to the cove, so the crystal mound
  // reads as breaking out of a cliffside above the water
  { x: 120, z: 1170, r: 34, h: 4.2 },
  { x: 20, z: 1005, r: 35, h: -2.2 }, // soft meadow bowl south of the town road
  { x: -110, z: 1210, r: 28, h: 6 }, // a crescent knoll sheltering the Deep's north rings
  // the Tablecrag's bulk (its flat crown is leveled after the rims, below)
  { x: -170, z: 1195, r: 46, h: 12 },
  // ...and its southern sister over the old inlet
  { x: -168, z: 1075, r: 38, h: 10 },
] as const;

// ---------------------------------------------------------------------------
// The Hollow's coastline. The realm is an organic landmass in a dusk sea:
// a union of soft land lobes (peninsulas for the cave arrival, the western
// highlands, the Gleaming Deep, the northeast monument arm, the Starfall
// headland) minus carved bays. Terrain outside the coast sinks to a seabed,
// and the full-band water plane plus the map painter's blue do the rest, so
// the world map reads like a real continent silhouette instead of a square.
// Every fixed content point (camps, town, roads, ruins) sits on a lobe with
// margin; tests/veiled_hollow.test.ts asserts it stays that way.
// ---------------------------------------------------------------------------
// Keep in sync with REALM_ZONE.zMax (content/realm.ts): the band's northern
// stretch past the coast is open ocean.
const HOLLOW_ZMAX = 1440;
const HOLLOW_LAND_LOBES = [
  { x: 0, z: 1060, r: 155 }, // main body: town, meadow, court's west edge
  { x: -125, z: 1010, r: 85 }, // southwest: the Duskfall arrival and overlook
  { x: -140, z: 925, r: 55 }, // the sealed range's western shoulder
  { x: 10, z: 935, r: 90 }, // the sealed range's center and Elder Grove
  { x: 140, z: 925, r: 60 }, // the sealed range's eastern shoulder
  { x: -125, z: 1150, r: 75 }, // western highlands and the Mirrormere
  { x: -55, z: 1200, r: 75 }, // the Gleaming Deep's north rings
  { x: 95, z: 1150, r: 75 }, // the Crystalline Shallows
  { x: 20, z: 1172, r: 38 }, // the Deep road's shoulder (organic-warp dip)
  { x: 150, z: 1215, r: 62 }, // the northeast arm (the forgotten monument)
  { x: 120, z: 995, r: 72 }, // the Starfall headland and falls terrace
  { x: 130, z: 1082, r: 48 }, // the Sunken Court peninsula
  // the Pale Causeway: a winding isthmus rooted in the north coast and
  // running across the ocean to the band edge, where a future realm will
  // one day connect (adjacent lobes overlap deeply so the spine is one
  // continuous, walkable landmass)
  { x: 0, z: 1250, r: 48 }, // the root, fused with the mainland coast
  { x: 30, z: 1300, r: 44 },
  { x: 48, z: 1355, r: 40 },
  { x: 44, z: 1420, r: 48 },
  // the western edge arm: a low coastal ridge along the map border that
  // encloses the old open water as the Mirrorshallow lake
  { x: 184, z: 1000, r: 50 },
  { x: 186, z: 1075, r: 52 },
  { x: 184, z: 1150, r: 50 },
  // the eastern highland shoulder: the old bay is filled and the Tablecrag
  // (a flat-topped mesa, see HOLLOW_SHAPING) rises over the Deep's flank
  { x: -178, z: 1190, r: 60 },
  { x: -180, z: 1255, r: 48 },
  { x: -176, z: 1080, r: 55 }, // ...and its southern reach over the old inlet
  { x: -180, z: 1412, r: 46 }, // the corner arm carrying the Snowline cap's footing to the sound
  { x: -118, z: 1420, r: 44 }, // the sound's north shore under the Gatewood's new west reach
] as const;
const HOLLOW_BAYS = [
  // (the old bight at {182,1038} became the Mirrorshallow: see the edge arm
  // lobes below, which enclose that water as a lake)
  { x: -62, z: 1270, r: 50 }, // the north sound, west of the causeway root
] as const;
const HOLLOW_SEA_FLOOR = WATER_LEVEL - 5;

// >0 on land, <0 at sea; the coast is the soft zero crossing. One metaball
// evaluator shared by every northern realm's coastline (same math the Hollow
// shipped with, extracted verbatim when the Drakelands and the Frostveil
// added their own lobe tables).
type CoastBlob = { readonly x: number; readonly z: number; readonly r: number };
// One terrainHeight sample evaluates SEVERAL realms' landness at the same
// (x, z) (its own coast, seam neighbours, the border seaGate, the open-sea
// check), and the three fixed-seed fbm terms below depend only on (x, z),
// never on the lobe tables. A last-point memo shares them across those calls:
// pure caching of identical inputs, so every result stays bit-identical.
let mbMemoX = Number.NaN;
let mbMemoZ = Number.NaN;
let mbMemoWX = 0;
let mbMemoWZ = 0;
let mbMemoRag = 0;
// Per-table bounding box of every blob's reach, cached by array identity. A
// warped point outside the box contributes zero from every blob (all d2 >= 1),
// so the whole loop can be skipped bit-identically. terrainHeight consults
// far realms' landness on most samples (border seaGates, the open-sea check),
// which is exactly the always-outside case this gate removes.
interface BlobBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
interface BoundedBlobs {
  blobs: readonly CoastBlob[];
  bounds: BlobBounds;
}
function boundedBlobs(blobs: readonly CoastBlob[]): BoundedBlobs {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
  for (const blob of blobs) {
    bounds.minX = Math.min(bounds.minX, blob.x - blob.r);
    bounds.maxX = Math.max(bounds.maxX, blob.x + blob.r);
    bounds.minZ = Math.min(bounds.minZ, blob.z - blob.r);
    bounds.maxZ = Math.max(bounds.maxZ, blob.z + blob.r);
  }
  return { blobs, bounds };
}
function metaballLandness(lobes: BoundedBlobs, bays: BoundedBlobs, x: number, z: number): number {
  // Organic coastlines: the raw metaball union reads as connecting circles,
  // so the sample position is domain-warped by fixed-seed fbm (bending the
  // blobs into peninsulas and coves) and the result gets a higher-frequency
  // raggedness term (small capes and inlets). The seeds are CONSTANTS, not
  // the world seed: landness must stay a pure fn of (x, z) because content
  // tables, tests, and the sim's open-sea check were all placed against it.
  if (x !== mbMemoX || z !== mbMemoZ) {
    mbMemoX = x;
    mbMemoZ = z;
    mbMemoWX = x + (fbm2(x * 0.015, z * 0.015, 9101, 3) - 0.5) * 46;
    mbMemoWZ = z + (fbm2(x * 0.015 + 73, z * 0.015 - 41, 9103, 3) - 0.5) * 46;
    mbMemoRag = (fbm2(x * 0.05, z * 0.05, 9107, 2) - 0.5) * 0.2;
  }
  const wx = mbMemoWX;
  const wz = mbMemoWZ;
  let land = 0;
  // Bounds are computed once beside each private coast table. Passing them
  // directly avoids a WeakMap lookup on every terrain landness probe.
  const lb = lobes.bounds;
  if (wx >= lb.minX && wx <= lb.maxX && wz >= lb.minZ && wz <= lb.maxZ) {
    for (const b of lobes.blobs) {
      // |dx| >= r means d2 >= 1 regardless of dz: skip the divisions early
      const dx = wx - b.x;
      if (dx >= b.r || -dx >= b.r) continue;
      const d2 = (dx / b.r) ** 2 + ((wz - b.z) / b.r) ** 2;
      if (d2 < 1) land += (1 - d2) ** 2;
    }
  }
  if (bays.blobs.length > 0) {
    const bb = bays.bounds;
    if (wx >= bb.minX && wx <= bb.maxX && wz >= bb.minZ && wz <= bb.maxZ) {
      for (const b of bays.blobs) {
        const dx = wx - b.x;
        if (dx >= b.r || -dx >= b.r) continue;
        const d2 = (dx / b.r) ** 2 + ((wz - b.z) / b.r) ** 2;
        if (d2 < 1) land -= 1.4 * (1 - d2) ** 2;
      }
    }
  }
  land += mbMemoRag;
  return land - 0.06;
}

const HOLLOW_LAND_FIELD = boundedBlobs(HOLLOW_LAND_LOBES);
const HOLLOW_BAY_FIELD = boundedBlobs(HOLLOW_BAYS);
export function hollowLandness(x: number, z: number): number {
  return metaballLandness(HOLLOW_LAND_FIELD, HOLLOW_BAY_FIELD, x, z);
}

// ---------------------------------------------------------------------------
// The Drakelands' landmass: a gatewood shore fused to the causeway landing,
// widening into the desert body, then a broad volcanic belt spanning the far
// north (the Drakemaw range doubles as the sealed wall's footing where it
// meets land; over the flanks the range simply runs into the sea).
// ---------------------------------------------------------------------------
const DRAKE_ZMIN = 1820; // keep in sync with DRAKELANDS_ZONE.zMin (east column)
const DRAKE_ZMAX = 2420; // ...and zMax
const EMBER_LAND_LOBES = [
  { x: 404, z: 1825, r: 40 }, // the causeway landing, fused across the border
  { x: 404, z: 1858, r: 52 }, // the Wyrmgate shore and Wyrmwatch
  { x: 360, z: 1900, r: 70 }, // the Gatewood
  { x: 450, z: 1920, r: 55 }, // eastern gatewood shore
  { x: 455, z: 1995, r: 55 }, // the Last Spring headland
  { x: 290, z: 1940, r: 60 }, // western gatewood shore
  { x: 380, z: 2030, r: 90 }, // the drying midlands
  { x: 280, z: 2080, r: 65 }, // Mirage Hollow's dune shelf
  { x: 262, z: 2020, r: 46 }, // ...its southern shoulder under the dune road
  { x: 274, z: 2170, r: 48 }, // ...and the shelf road's western shoulder
  { x: 470, z: 2070, r: 70 }, // eastern dunes
  { x: 465, z: 2150, r: 60 }, // Trollmoot's rise
  { x: 405, z: 2170, r: 55 }, // the dune saddle carrying the Trollmoot fork
  { x: 340, z: 2160, r: 85 }, // the Cinder Dunes' heart
  { x: 420, z: 2260, r: 80 }, // approach to the Drakemaw
  { x: 360, z: 2238, r: 45 }, // the saddle carrying the Snowline road
  { x: 290, z: 2250, r: 75 }, // the Bloodglass shelf
  { x: 360, z: 2355, r: 95 }, // the Drakemaw belt
  { x: 490, z: 2330, r: 60 }, // eastern volcanic spur
  { x: 220, z: 2340, r: 55 }, // western volcanic spur
  { x: 450, z: 2400, r: 70 }, // the rim belt, wide under the sealed range
  { x: 270, z: 2400, r: 70 },
  { x: 360, z: 2410, r: 80 },
  { x: 242, z: 2080, r: 42 }, // the Snowline crossing's waste-side shoulder
  { x: 208, z: 2080, r: 40 }, // ...carried to the column border
  { x: 216, z: 1930, r: 44 }, // the Snowline's waste-side shoulder
  { x: 236, z: 1972, r: 46 }, // ...rising onto the dune shelf road
  { x: 376, z: 1952, r: 42 }, // the town road's western shoulder
  { x: 242, z: 1858, r: 46 }, // the cap's shore joining the Gatewood...
  { x: 264, z: 1908, r: 44 }, // ...so no channel runs behind it to the sound
  { x: 492, z: 2390, r: 48 }, // the Goldmelt Water's east cap, waste side
] as const;
const EMBER_BAYS = [
  { x: 195, z: 1980, r: 50 }, // the west bight
  { x: 535, z: 2180, r: 55 }, // the east reach
  { x: 205, z: 2230, r: 40 }, // a western cove under the spur
] as const;

const EMBER_LAND_FIELD = boundedBlobs(EMBER_LAND_LOBES);
const EMBER_BAY_FIELD = boundedBlobs(EMBER_BAYS);
export function emberLandness(x: number, z: number): number {
  return metaballLandness(EMBER_LAND_FIELD, EMBER_BAY_FIELD, x, z);
}

// ---------------------------------------------------------------------------
// The Frostveil Reach: a snowbound island massif. Its south rim carries the
// sealed wall's footing (the Heartfrost side), the body climbs in terraced
// benches (frost shaping below), and the north coast meets the world's edge
// sea like the Hollow's does.
// ---------------------------------------------------------------------------
const FROST_ZMAX = 1960; // keep in sync with FROSTVEIL_ZONE.zMax (the strip's north end)
const FROST_LAND_LOBES = [
  { x: 0, z: 1460, r: 95 }, // the south rim: Heartfrost Cavern's shelf
  { x: -120, z: 1475, r: 60 }, // western wall footing
  { x: 120, z: 1475, r: 60 }, // eastern wall footing
  { x: 0, z: 1500, r: 85 }, // the rim benches
  { x: -40, z: 1630, r: 90 }, // the Icemantle massif
  { x: -30, z: 1558, r: 45 }, // the town shelf under Icemantle itself
  { x: 80, z: 1600, r: 75 }, // Glacier Tarn's shoulder
  { x: 30, z: 1670, r: 65 }, // the inner valley joining the tarn to the Steps
  { x: 20, z: 1750, r: 95 }, // the Aurora Steps
  { x: -100, z: 1720, r: 70 }, // the Shiverfen shelf
  { x: -68, z: 1806, r: 46 }, // the Goldmelt road's first shoulder off the Steps
  { x: -120, z: 1820, r: 48 }, // the west shore's rise under the Goldmelt road
  { x: -132, z: 1856, r: 40 }, // ...its mid rise
  { x: -158, z: 1872, r: 44 }, // the Goldmelt's ice-side shoulder
  { x: -162, z: 1930, r: 48 }, // the Palewater's north cap, ice side
  { x: 120, z: 1790, r: 65 }, // the Howling Terraces
  { x: 158, z: 1852, r: 44 }, // the Snowline's ice-side shoulder
  { x: 116, z: 1744, r: 42 }, // the tarn road's eastern shoulder
  { x: 0, z: 1870, r: 80 }, // the north crown
  { x: 10, z: 1945, r: 50 }, // the Goldmelt corridor's south footing
  { x: 146, z: 1700, r: 44 }, // the Snowline crossing's ice-side shoulder
  { x: 108, z: 1700, r: 42 }, // ...rising onto the benches
  { x: 54, z: 1638, r: 42 }, // the crossing road's bench shoulder
  { x: 98, z: 1672, r: 40 }, // ...stepping down toward the border
  { x: 86, z: 1824, r: 42 }, // the terrace road's north shoulder
  { x: 42, z: 1674, r: 40 }, // the tarn road's southern loop
  { x: 78, z: 1694, r: 38 }, // ...meeting the crossing shoulder
  { x: 162, z: 1468, r: 48 }, // the Meltwater's south cap, ice side
  { x: 162, z: 1930, r: 48 }, // the Meltwater's north cap, ice side
  { x: 102, z: 1888, r: 46 }, // the shore between the Terraces and the crown, closing the cap
  { x: -60, z: 1958, r: 40 }, // the north crown's headlands push into the bay...
  { x: 44, z: 1962, r: 36 }, // ...and a second, so the north shore is lobed
  { x: -30, z: 1452, r: 46 }, // the south shore's rise east of the Wyrmgate
  { x: 70, z: 1450, r: 42 }, // ...and its east headland over the sound
  { x: 52, z: 1974, r: 26 }, // a north-center headland east of the new cove
] as const;
const FROST_BAYS = [
  { x: 165, z: 1660, r: 55 }, // the east sound
  { x: -165, z: 1580, r: 50 }, // the west inlet
  { x: 60, z: 1945, r: 50 }, // the north cove
  { x: -108, z: 1952, r: 40 }, // ...and a second cove, west of the crown
  { x: 8, z: 1470, r: 40 }, // a south cove biting the shore east of the Wyrmgate
  { x: 24, z: 1976, r: 34 }, // a cove splitting the flat north-center headland
] as const;

const FROST_LAND_FIELD = boundedBlobs(FROST_LAND_LOBES);
const FROST_BAY_FIELD = boundedBlobs(FROST_BAYS);
export function frostLandness(x: number, z: number): number {
  return metaballLandness(FROST_LAND_FIELD, FROST_BAY_FIELD, x, z);
}

// ---------------------------------------------------------------------------
// The Amberfall: an autumn weald around the Great Mere, its south fringe
// carrying the sealed wall's footing, meadow shelves east and west, and a
// north crown meeting the world's end sea.
// ---------------------------------------------------------------------------
const AMBER_ZMIN = 1820; // keep in sync with AMBERFALL_ZONE.zMin (west column)
const AMBER_ZMAX = 2380; // ...and zMax
const AMBER_LAND_LOBES = [
  { x: -350, z: 1850, r: 60 }, // the Goldmelt pass mouth
  { x: -420, z: 1880, r: 70 }, // the arrival shelf west of the pass
  { x: -340, z: 1910, r: 80 }, // the south weald
  { x: -260, z: 1950, r: 65 }, // Harvest Hollow's shelf
  { x: -305, z: 1985, r: 50 }, // the harvest road's field saddle
  { x: -450, z: 2010, r: 75 }, // the Gilded Orchard
  { x: -400, z: 1950, r: 55 }, // the Rootway road's meadow saddle
  { x: -360, z: 2040, r: 90 }, // Lanternmere's shore
  { x: -360, z: 2130, r: 95 }, // the Great Mere basin
  { x: -440, z: 2210, r: 70 }, // Cindermaple Rise
  { x: -265, z: 2220, r: 70 }, // the Monolith heath
  { x: -360, z: 2300, r: 85 }, // the north crown
  { x: -380, z: 2355, r: 55 }, // the Amberfen Steps' northern footing
  { x: -268, z: 2232, r: 40 }, // the mere lurkers' reeded shore
  { x: -306, z: 2160, r: 44 }, // the east mere road's shoulder
  { x: -490, z: 1852, r: 48 }, // the Goldmelt Water's west cap, amber side
  { x: -230, z: 1852, r: 48 }, // the Goldmelt Water's east cap, amber side
  { x: -210, z: 1896, r: 46 }, // ...joined to Harvest Hollow's shelf
  { x: -492, z: 2344, r: 50 }, // the Amber Broads' west cap, amber side
  { x: -465, z: 2290, r: 46 }, // ...joined to the north crown and Cindermaple Rise
  { x: -198, z: 2352, r: 50 }, // the southeast corner knot, amber quarter
  { x: -225, z: 2280, r: 48 }, // ...joined to the Monolith heath
] as const;
const AMBER_BAYS = [
  { x: -190, z: 2080, r: 55 }, // the east sound
  { x: -530, z: 2120, r: 55 }, // the west reach
  { x: -320, z: 2375, r: 45 }, // the north cove
] as const;

const AMBER_LAND_FIELD = boundedBlobs(AMBER_LAND_LOBES);
const AMBER_BAY_FIELD = boundedBlobs(AMBER_BAYS);
export function amberLandness(x: number, z: number): number {
  return metaballLandness(AMBER_LAND_FIELD, AMBER_BAY_FIELD, x, z);
}

// ---------------------------------------------------------------------------
// The Willowfen: a low green wetland platter, widest of the north realms,
// its coasts gentle everywhere (no cliffs in a fen).
// ---------------------------------------------------------------------------
const FEN_ZMIN = 180; // keep in sync with WILLOWFEN_ZONE.zMin (west column)
const FEN_ZMAX = 700; // ...and zMax
const FEN_LAND_LOBES = [
  { x: -380, z: 210, r: 65 }, // the Amberfen Steps' shelf
  { x: -400, z: 662, r: 46 }, // the Tanglemouth's fen-side shoulder
  { x: -330, z: 260, r: 80 }, // the eastern fen
  { x: -430, z: 300, r: 85 }, // the Lilymoors' platter
  { x: -360, z: 360, r: 90 }, // Bridgemere's wetland heart
  { x: -270, z: 320, r: 65 }, // Bogshine's shelf
  { x: -420, z: 460, r: 85 }, // Willowweep
  { x: -320, z: 490, r: 80 }, // the Drowsy Flats
  { x: -360, z: 590, r: 85 }, // the north fen
  { x: -470, z: 390, r: 60 },
  { x: -250, z: 440, r: 60 },
  { x: -390, z: 660, r: 55 }, // the Nightgate's southern footing
  { x: -402, z: 538, r: 40 }, // the north track's shoulder (organic-warp dip)
  { x: -390, z: 694, r: 38 }, // the border footing right under the Nightgate
  { x: -240, z: 440, r: 45 }, // the Windway road's fen-side shoulder
  { x: -200, z: 440, r: 42 }, // ...carried right up to the column border
  { x: -300, z: 405, r: 42 }, // the east track's moor
  { x: -492, z: 218, r: 50 }, // the Amber Broads' west cap, fen side
  { x: -198, z: 210, r: 50 }, // the corner knot, fen quarter: seals the Windmere's mouth
  { x: -456, z: 640, r: 44 }, // ...joined to the north fen
  { x: -198, z: 672, r: 48 }, // the Four Corners, fen quarter
] as const;
const FEN_BAYS = [
  { x: -190, z: 360, r: 55 }, // the east sound
  { x: -530, z: 510, r: 55 }, // the west reach
  { x: -330, z: 695, r: 50 }, // the north cove
] as const;

const FEN_LAND_FIELD = boundedBlobs(FEN_LAND_LOBES);
const FEN_BAY_FIELD = boundedBlobs(FEN_BAYS);
export function fenLandness(x: number, z: number): number {
  return metaballLandness(FEN_LAND_FIELD, FEN_BAY_FIELD, x, z);
}

// Gentle everywhere: the fen's shelf is wider and its floor shallower than
// the other realms' (bog country, not sea cliffs).
function applyFenCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(FEN_ZMIN - 8, FEN_ZMIN + 8, z) * (1 - smoothstep(FEN_ZMAX - 8, FEN_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the west column: cross-fade toward the marsh at the border (a step in
  // terrainHeight along the border line buries walkers; the render mesh
  // interpolates across it, the sim does not)
  if (x < -566) return h; // nothing west of the world
  const seam = 1 - smoothstep(STRIP_MIN_X - 8, STRIP_MIN_X + 8, x);
  if (seam <= 0) return h;
  const land = fenLandness(x, z);
  const t = Math.max(greenSeamT(x, z), smoothstep(0.02, 0.34, land));
  const shelf = smoothstep(-0.5, 0.06, land);
  const floor = WATER_LEVEL - 3.4 + (WATER_LEVEL - 1 - (WATER_LEVEL - 3.4)) * shelf;
  let out = floor + (h - floor) * t;
  // the Mirewalk: a flat floor easing onto the marsh across the border
  const passE = (1 - smoothstep(26, 52, Math.abs(z - 440))) * smoothstep(-260, -215, x);
  if (passE > 0) out = out + (6 + (out - 6) * 0.15 - out) * passE;
  // ...and the Tanglemouth's south ramp, meeting the jungle's pass cap
  const passN = (1 - smoothstep(26, 52, Math.abs(x + 400))) * smoothstep(640, 685, z);
  if (passN > 0) out = out + (6 + (out - 6) * 0.15 - out) * passN;
  return h + (out - h) * seam * zSeam;
}

// ---------------------------------------------------------------------------
// The Nightbloom: moonlit downs under permanent night, the world's current
// northern end. Gentle coasts like the fen's; the north shore looks out over
// open starlit sea.
// ---------------------------------------------------------------------------
const NIGHT_ZMIN = 1260; // keep in sync with NIGHTBLOOM_ZONE.zMin (west column)
const NIGHT_ZMAX = 1820; // ...and zMax
const NIGHT_LAND_LOBES = [
  { x: -390, z: 1300, r: 60 }, // the Nightgate's shelf
  { x: -330, z: 1298, r: 46 }, // ...and the crossing's dark-side shoulder
  { x: -340, z: 1380, r: 90 }, // the realm's heart: Moonrest and the Moonwell
  { x: -440, z: 1480, r: 80 }, // Gloamfield's flower downs
  { x: -280, z: 1550, r: 70 }, // the Standing Vigil's rise
  { x: -360, z: 1660, r: 85 }, // the barrow downs
  { x: -365, z: 1520, r: 80 }, // the midrealm saddle: bridges heart to barrow
  { x: -372, z: 1448, r: 42 }, // the saddle's south seam, under the barrow road
  { x: -360, z: 1588, r: 45 }, // ...and its north seam at the barrow's foot
  { x: -325, z: 1485, r: 55 }, // the Vigil road's shoulder
  { x: -480, z: 1570, r: 55 }, // the west arm
  { x: -230, z: 1380, r: 50 }, // the east arm
  { x: -330, z: 1780, r: 48 }, // the Crowgate's southern footing
  { x: -350, z: 1720, r: 50 }, // the dream road's shoulder past the Barrowmere
  { x: -300, z: 1600, r: 62 }, // the Dreamer's Rise: dry footing under the caldera
  { x: -228, z: 1540, r: 44 }, // the Dreamsedge crossing's dream-side shoulder
  { x: -492, z: 1550, r: 44 }, // the Tanglemouth crossing's dream-side shoulder
  { x: -528, z: 1550, r: 40 }, // ...to the jungle's border
  { x: -330, z: 1808, r: 40 }, // the Garden Gate's southern footing
  { x: -522, z: 1288, r: 48 }, // the Tanglewater's south cap, dream side
  { x: -522, z: 1782, r: 48 }, // the Tanglewater's north cap, dream side
  { x: -522, z: 1800, r: 44 }, // ...and its west twin
] as const;
const NIGHT_BAYS = [
  { x: -190, z: 1520, r: 55 }, // the east sound
  { x: -530, z: 1380, r: 55 }, // the west reach
  { x: -420, z: 1770, r: 50 }, // the north bight, open to the starlit sea
] as const;

const NIGHT_LAND_FIELD = boundedBlobs(NIGHT_LAND_LOBES);
const NIGHT_BAY_FIELD = boundedBlobs(NIGHT_BAYS);
export function nightLandness(x: number, z: number): number {
  return metaballLandness(NIGHT_LAND_FIELD, NIGHT_BAY_FIELD, x, z);
}

// Gentle everywhere, the fen's recipe: soft downs easing into a dark sea.
function applyNightCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(NIGHT_ZMIN - 8, NIGHT_ZMIN + 8, z) *
    (1 - smoothstep(NIGHT_ZMAX - 8, NIGHT_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the west column: cross-fade toward the strip at the border
  if (x < -566) return h; // nothing west of the world
  const seam = 1 - smoothstep(STRIP_MIN_X - 8, STRIP_MIN_X + 8, x);
  if (seam <= 0) return h;
  const land = nightLandness(x, z);
  const t = smoothstep(0.02, 0.32, land);
  const shelf = smoothstep(-0.5, 0.06, land);
  const floor = WATER_LEVEL - 3.6 + (WATER_LEVEL - 1 - (WATER_LEVEL - 3.6)) * shelf;
  let out = floor + (h - floor) * t;
  // the Nightgate: flat pass floor across the border with the jungle
  const passT = (1 - smoothstep(26, 52, Math.abs(x + 330))) * (1 - smoothstep(1310, 1360, z));
  if (passT > 0) out = out + (6 + (out - 6) * 0.15 - out) * passT;
  // ...and the gold road's south ramp, meeting the Amberfall's pass cap
  const passN = (1 - smoothstep(26, 52, Math.abs(x + 350))) * smoothstep(1760, 1805, z);
  if (passN > 0) out = out + (6 + (out - 6) * 0.15 - out) * passN;
  return h + (out - h) * seam * zSeam;
}

// ---------------------------------------------------------------------------
// The Wraithwood: the haunted forest at the world's current northern end.
// A broad wooded platter whose shores sink into a drowned grey sea.
// ---------------------------------------------------------------------------
const WOOD_ZMIN = 1260; // keep in sync with WRAITHWOOD_ZONE.zMin (east column)
const WOOD_ZMAX = 1820; // ...and zMax
const WOOD_LAND_LOBES = [
  { x: 390, z: 1300, r: 55 }, // the Crowgate's shelf
  { x: 398, z: 1742, r: 46 }, // the Wyrmroad's wood-side shoulder...
  { x: 404, z: 1790, r: 46 }, // ...carried to the waste's border
  { x: 360, z: 1420, r: 90 }, // the realm's heart: Gallowmere under the eaves
  { x: 280, z: 1490, r: 80 }, // Widow's Thicket
  { x: 440, z: 1530, r: 75 }, // the Hanging Glade
  { x: 410, z: 1488, r: 40 }, // the glade road's shoulder
  { x: 300, z: 1620, r: 70 }, // the Mournstone rise
  { x: 370, z: 1690, r: 80 }, // the Huntsman's clearing
  { x: 350, z: 1540, r: 70 }, // the midwood saddle: bridges hamlet to chapel
  { x: 374, z: 1600, r: 50 }, // the clearing road's shoulder
  { x: 230, z: 1560, r: 55 }, // the west arm
  { x: 490, z: 1440, r: 50 }, // the east arm
  { x: 470, z: 1700, r: 48 }, // ...running down to the Ashmere's cap
  { x: 300, z: 1770, r: 48 }, // the Tanglemouth's southern footing
  { x: 308, z: 1705, r: 45 }, // the west track's shoulder toward the pass
  { x: 300, z: 1800, r: 42 }, // the border footing right under the pass
  { x: 250, z: 1540, r: 42 }, // ...under the first black eaves
  { x: 252, z: 1792, r: 44 }, // ...joined to the Tanglemouth road's footing
  { x: 508, z: 1364, r: 48 }, // the east eaves' shore, closing the coast under the corner
  { x: 502, z: 1288, r: 48 }, // the Crowmere's east cap, wood side
] as const;
const WOOD_BAYS = [
  { x: 548, z: 1520, r: 42 }, // the east sound, pushed off the coast
  { x: 190, z: 1400, r: 55 }, // the west reach
  { x: 300, z: 1795, r: 50 }, // the north bight, now a basin of the Ashmere
] as const;

const WOOD_LAND_FIELD = boundedBlobs(WOOD_LAND_LOBES);
const WOOD_BAY_FIELD = boundedBlobs(WOOD_BAYS);
export function woodLandness(x: number, z: number): number {
  return metaballLandness(WOOD_LAND_FIELD, WOOD_BAY_FIELD, x, z);
}

// Gentle shores under the murk, the fen recipe again.
function applyWoodCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(WOOD_ZMIN - 8, WOOD_ZMIN + 8, z) * (1 - smoothstep(WOOD_ZMAX - 8, WOOD_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the east column: cross-fade toward the strip at the border
  if (x > 566) return h; // nothing east of the world (instance space far beyond)
  const seam = smoothstep(STRIP_MAX_X - 8, STRIP_MAX_X + 8, x);
  if (seam <= 0) return h;
  const land = woodLandness(x, z);
  const t = smoothstep(0.02, 0.32, land);
  const shelf = smoothstep(-0.5, 0.06, land);
  const floor = WATER_LEVEL - 3.6 + (WATER_LEVEL - 1 - (WATER_LEVEL - 3.6)) * shelf;
  let out = floor + (h - floor) * t;
  // the Crowgate: flat pass floor up from the garden's lawns
  const passT = (1 - smoothstep(26, 52, Math.abs(x - 390))) * (1 - smoothstep(1310, 1360, z));
  if (passT > 0) out = out + (6 + (out - 6) * 0.15 - out) * passT;
  // ...and the Wyrmgate road's north ramp, meeting the waste's pass cap
  const passN = (1 - smoothstep(26, 52, Math.abs(x - 404))) * smoothstep(1760, 1805, z);
  if (passN > 0) out = out + (6 + (out - 6) * 0.15 - out) * passN;
  return h + (out - h) * seam * zSeam;
}

// ---------------------------------------------------------------------------
// The Palmreach: the tropical realm at the world's current northern end.
// Its signature is the coast: every shore is flattened into a wide, gently
// sloped beach shelf, so the land meets a turquoise sea over sand instead of
// bluffs. The eastern arm cups the Sapphire Lagoon.
// ---------------------------------------------------------------------------
const REACH_ZMIN = 700; // keep in sync with PALMREACH_ZONE.zMin (west column)
const REACH_ZMAX = 1260; // ...and zMax
const REACH_LAND_LOBES = [
  { x: -420, z: 740, r: 55 }, // the Tanglemouth's shelf
  { x: -402, z: 736, r: 44 }, // ...and the crossing's jungle-side shoulder
  { x: -332, z: 1222, r: 46 }, // the Nightgate's jungle-side shoulder
  { x: -460, z: 890, r: 75 }, // the Palmstrand's long beach arm
  { x: -360, z: 940, r: 95 }, // the Emerald Tangle: the realm's green heart
  { x: -300, z: 830, r: 70 }, // Drifthaven's strand
  { x: -265, z: 895, r: 60 }, // the lagoon's northern arm...
  { x: -235, z: 990, r: 55 }, // ...curling east around the water
  { x: -242, z: 948, r: 40 }, // the idol road's shoulder on the lagoon's rim
  { x: -260, z: 1080, r: 60 }, // the Sunken Idol's headland
  { x: -400, z: 1080, r: 80 }, // the Vinefall
  { x: -340, z: 1170, r: 70 }, // the north cape
  { x: -480, z: 1020, r: 55 }, // the west arm
  { x: -400, z: 1000, r: 55 }, // the Tangle's western shoulder
  { x: -330, z: 1060, r: 50 }, // ...and its northeastern one
  { x: -340, z: 800, r: 55 }, // the shore road's back-beach
  { x: -384, z: 770, r: 45 }, // ...its western reach out of the pass
  { x: -366, z: 865, r: 45 }, // the Palmstrand road's shoulder
  { x: -210, z: 820, r: 42 }, // the offshore islet
  { x: -242, z: 826, r: 38 }, // ...and its sandbar back to the strand
  { x: -282, z: 1145, r: 45 }, // the gate road's saddle over the cape's neck
  { x: -294, z: 1185, r: 38 }, // ...and its rise to the gate footing
  { x: -310, z: 1220, r: 45 }, // the Garden Gate road's northern footing
  { x: -310, z: 1256, r: 42 }, // ...carried right up to the border
  { x: -252, z: 1015, r: 44 }, // ...back to the idol road
  { x: -198, z: 726, r: 48 }, // the Tanglewater's south cap, jungle side
  { x: -248, z: 740, r: 46 }, // ...joined to the shore road's back-beach
  { x: -290, z: 752, r: 46 }, // ...and carried onto the back-beach itself
  { x: -198, z: 1220, r: 48 }, // the Tanglewater's north cap, jungle side
  { x: -252, z: 1214, r: 44 }, // ...joined to the gate road's saddle
] as const;
const REACH_BAYS = [
  { x: -530, z: 950, r: 50 }, // the west reach
  { x: -182, z: 940, r: 45 }, // the east sound
  { x: -390, z: 1252, r: 50 }, // the north bight, open to the warm sea
] as const;

const REACH_LAND_FIELD = boundedBlobs(REACH_LAND_LOBES);
const REACH_BAY_FIELD = boundedBlobs(REACH_BAYS);
export function reachLandness(x: number, z: number): number {
  return metaballLandness(REACH_LAND_FIELD, REACH_BAY_FIELD, x, z);
}

// The Palmreach strand: the three shipped beach-palm models scattered on a
// deterministic grid over the beach shelf. The renderer draws them
// (render/jungle_features.ts) and the sim gives each a trunk collider
// (sim/colliders.ts) from THIS one list, so what you bump into is exactly the
// trunk you see. Pure function of the world seed, memoized (both hosts call it
// with the same seed and must agree byte-for-byte).
export interface ReachPalm {
  x: number;
  z: number;
  y: number; // trunk base, sunk slightly into the sand
  rot: number; // yaw
  variant: number; // 0..2 -> beach_palm_{1,2,3}
  scale: number; // uniform world scale applied to the model
  r: number; // trunk collider radius, world units
}

// Native trunk heights of beach_palm_{1,2,3}.glb (pivot on the ground) and the
// native trunk radius near the base, measured from the shipped GLBs. The
// per-variant height normalizes all three to PALM_TARGET_H before the
// per-spot size jitter, so the strand reads as one canopy height like the
// neighbouring pines rather than three different species sizes.
const PALM_NATIVE_H = [2.685, 2.689, 3.587];
const PALM_TRUNK_R = 0.17; // native trunk radius (all three ~equal)
const PALM_TARGET_H = 9; // rendered trunk height at size factor 1.0

let reachPalmCache: { seed: number; spots: ReachPalm[] } | null = null;

export function reachPalmSpots(seed: number): ReachPalm[] {
  if (reachPalmCache && reachPalmCache.seed === seed) return reachPalmCache.spots;
  const spots: ReachPalm[] = [];
  // props a palm must never stand in (the village, the camps, the walkways)
  const rp = PALMREACH_PROPS;
  const propClear = (x: number, z: number): boolean => {
    for (const b of rp.buildings ?? []) if (Math.hypot(x - b.x, z - b.z) < 9) return false;
    for (const m of rp.mudHuts ?? []) if (Math.hypot(x - m[0], z - m[1]) < 5) return false;
    for (const t of rp.tents ?? []) if (Math.hypot(x - t.x, z - t.z) < 5) return false;
    for (const f of rp.campfires ?? []) if (Math.hypot(x - f[0], z - f[1]) < 8) return false;
    for (const st of rp.stalls ?? []) if (Math.hypot(x - st.x, z - st.z) < 5) return false;
    for (const d of rp.decorProps ?? [])
      if (Math.hypot(x - d.x, z - d.z) < (d.r ?? 3) + 3) return false;
    for (const g of rp.greatTrees ?? []) if (Math.hypot(x - g.x, z - g.z) < g.r + 6) return false;
    for (const ring of rp.ruinRings ?? [])
      if (Math.hypot(x - ring.x, z - ring.z) < ring.ringR + 4) return false;
    return reachDeckClear(x, z, 1.5);
  };
  const push = (x: number, z: number, y: number, sizeF: number): void => {
    const variant = Math.floor(hash2(x, z, seed + 5151) * 3);
    const scale = (PALM_TARGET_H / PALM_NATIVE_H[variant]) * sizeF;
    spots.push({
      x,
      z,
      y: y - 0.15,
      rot: hash2(z, x, seed + 5141) * Math.PI * 2,
      variant,
      scale,
      r: PALM_TRUNK_R * scale,
    });
  };
  for (let gx = -536; gx <= -184; gx += 8) {
    for (let gz = REACH_ZMIN + 10; gz <= REACH_ZMAX - 10; gz += 8) {
      if (hash2(gx, gz, seed + 5101) > 0.7) continue; // thin the grid (~30% dropped)
      const x = gx + (hash2(gx, gz, seed + 5111) - 0.5) * 7;
      const z = gz + (hash2(gz, gx, seed + 5121) - 0.5) * 7;
      const land = reachLandness(x, z);
      if (land < 0.045 || land > 0.24) continue; // the beach band only
      const y = terrainHeight(x, z, seed);
      if (y < WATER_LEVEL + 0.5 || y > 3.6) continue; // out of the surf, off the bluff
      if (roadDistance(x, z) < 4) continue;
      if (Math.hypot(x + 300, z - 820) < 18) continue; // Drifthaven's lanes stay open
      if (!propClear(x, z)) continue;
      if (isCliffFace(x, z, seed)) continue;
      // a few of the strand's palms grow into towering elders
      const grand = hash2(x + 3, z, seed + 5161) < 0.09 ? 1.4 : 1;
      push(x, z, y, (0.85 + hash2(x, z, seed + 5131) * 0.5) * grand);
    }
  }
  // the inland palms: a sparser scatter through the jungle interior, so the
  // green runs palm-crowned all the way across the realm, not just the shore
  for (let gx = -530; gx <= -190; gx += 14) {
    for (let gz = REACH_ZMIN + 16; gz <= REACH_ZMAX - 16; gz += 14) {
      if (hash2(gx, gz, seed + 5171) > 0.34) continue;
      const x = gx + (hash2(gx + 1, gz, seed + 5181) - 0.5) * 11;
      const z = gz + (hash2(gx, gz + 1, seed + 5191) - 0.5) * 11;
      if (reachLandness(x, z) <= 0.24) continue; // the interior only
      const y = terrainHeight(x, z, seed);
      if (y < WATER_LEVEL + 0.6 || y > 9) continue;
      if (roadDistance(x, z) < 5) continue;
      if (reachRiverDistance(x, z) < 9) continue;
      if (Math.hypot(x + 300, z - 820) < 22) continue;
      if (!propClear(x, z)) continue;
      if (isCliffFace(x, z, seed)) continue;
      const grand = hash2(x + 5, z, seed + 5162) < 0.12 ? 1.35 : 1;
      push(x, z, y, (0.95 + hash2(x, z, seed + 5131) * 0.6) * grand);
    }
  }
  reachPalmCache = { seed, spots };
  return spots;
}

// The Farshore strand: the same three beach-palm models scattered over the
// isle's beach apron (the reachPalmSpots idiom): one deterministic list
// feeds the renderer (render/farshore_features.ts) and the trunk colliders
// (sim/colliders.ts). Memoized per seed.
let farshorePalmCache: { seed: number; spots: ReachPalm[] } | null = null;

export function farshorePalmSpots(seed: number): ReachPalm[] {
  if (farshorePalmCache && farshorePalmCache.seed === seed) return farshorePalmCache.spots;
  const spots: ReachPalm[] = [];
  for (let gx = 186; gx <= 556; gx += 9) {
    for (let gz = -170; gz <= 170; gz += 9) {
      if (hash2(gx, gz, seed + 5501) > 0.6) continue;
      const x = gx + (hash2(gx, gz, seed + 5511) - 0.5) * 8;
      const z = gz + (hash2(gz, gx, seed + 5521) - 0.5) * 8;
      const land = isleLandness(x, z);
      if (land < 0.045 || land > 0.22) continue; // the beach apron only
      const y = terrainHeight(x, z, seed);
      if (y < WATER_LEVEL + 0.5 || y > 3.8) continue;
      if (roadDistance(x, z) < 4.5) continue;
      if (Math.hypot(x - 305, z - 70) < 22) continue; // Gullhaven's lanes
      if (Math.hypot(x - 290, z - 86) < 12) continue; // the graveyard
      const variant = Math.floor(hash2(x, z, seed + 5151) * 3);
      const grand = hash2(x + 3, z, seed + 5531) < 0.08 ? 1.35 : 1;
      const scale =
        (PALM_TARGET_H / PALM_NATIVE_H[variant]) * (0.85 + hash2(x, z, seed + 5131) * 0.5) * grand;
      spots.push({
        x,
        z,
        y: y - 0.15,
        rot: hash2(z, x, seed + 5141) * Math.PI * 2,
        variant,
        scale,
        r: PALM_TRUNK_R * scale,
      });
    }
  }
  farshorePalmCache = { seed, spots };
  return spots;
}

// The tropical coast: the fen recipe, then every low shore flattened into a
// broad sand shelf (the beach cap) so the strand runs wide and walkable.
function applyReachCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(REACH_ZMIN - 8, REACH_ZMIN + 8, z) *
    (1 - smoothstep(REACH_ZMAX - 8, REACH_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the west column: cross-fade toward the strip at the border
  if (x < -566) return h; // nothing west of the world
  const seam = 1 - smoothstep(STRIP_MIN_X - 8, STRIP_MIN_X + 8, x);
  if (seam <= 0) return h;
  const land = reachLandness(x, z);
  const t = Math.max(greenSeamT(x, z), smoothstep(0.02, 0.32, land));
  const shelf = smoothstep(-0.5, 0.06, land);
  const floor = WATER_LEVEL - 3.2 + (WATER_LEVEL - 0.8 - (WATER_LEVEL - 3.2)) * shelf;
  let out = floor + (h - floor) * t;
  // the beach cap: the coastal band is pressed flat and low, a long sandy
  // apron instead of the other realms' bluff shores
  const beachT = 1 - smoothstep(0.05, 0.3, land);
  if (beachT > 0 && out > 1.4) out = out + (1.4 + (out - 1.4) * 0.2 - out) * beachT;
  // the Sunway: a flat floor off the heights, down into the sun
  const passT = (1 - smoothstep(26, 52, Math.abs(z - 820))) * smoothstep(-260, -215, x);
  if (passT > 0) out = out + (6 + (out - 6) * 0.15 - out) * passT;
  // the Tanglemouth: flat pass floor across the border with the fen
  const passS = (1 - smoothstep(26, 52, Math.abs(x + 400))) * (1 - smoothstep(750, 800, z));
  if (passS > 0) out = out + (6 + (out - 6) * 0.15 - out) * passS;
  // ...and the Nightgate's south ramp, meeting the dream's pass cap
  const passN = (1 - smoothstep(26, 52, Math.abs(x + 330))) * smoothstep(1200, 1245, z);
  if (passN > 0) out = out + (6 + (out - 6) * 0.15 - out) * passN;
  // the jungle rivers: each run lies in a gentle valley (banks eased down
  // to just above the waterline so boats beach naturally and bridges sit
  // low) with the swimmable channel carved along the center-line; both
  // blends only ever LOWER ground (min), so the open seabed is never raised
  for (const river of REACH_RIVERS) {
    const d = riverDistance(river.pts, x, z);
    if (d >= river.hw + 16) continue;
    const tv = 1 - smoothstep(river.hw, river.hw + 16, d);
    out = Math.min(out, out + (WATER_LEVEL + 1.1 - out) * tv);
    if (d < river.hw + 2) {
      const tc = 1 - smoothstep(river.hw * 0.4, river.hw + 2, d);
      out = Math.min(out, out + (WATER_LEVEL - 1.6 - out) * tc);
    }
  }
  return h + (out - h) * seam * zSeam;
}

// The Palmreach's rivers, polyline center-lines with a half-width; every
// run keeps clear of the road net (the road-water guard samples raw
// terrain, so a road never dips into a channel).
const REACH_RIVERS: { pts: { x: number; z: number }[]; hw: number }[] = [
  {
    // the Emerald Run: out of the jungle pool, west to the sea
    pts: [
      { x: -374, z: 1006 },
      { x: -408, z: 1000 },
      { x: -446, z: 988 },
      { x: -482, z: 972 },
      { x: -520, z: 956 },
    ],
    hw: 4.5,
  },
  {
    // the Tanglewash: the northern tarn's outflow to the north bight
    pts: [
      { x: -336, z: 1166 },
      { x: -350, z: 1192 },
      { x: -366, z: 1220 },
      { x: -384, z: 1246 },
    ],
    hw: 4,
  },
  {
    // the West Arm stream, a short run off the west arm's shoulder
    pts: [
      { x: -466, z: 1052 },
      { x: -492, z: 1034 },
      { x: -518, z: 1014 },
    ],
    hw: 3.5,
  },
];

function riverDistance(pts: { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i].x;
    const az = pts[i].z;
    const dx = pts[i + 1].x - ax;
    const dz = pts[i + 1].z - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

/** Distance from (x, z) to the nearest Palmreach river center-line. */
export function reachRiverDistance(x: number, z: number): number {
  let best = Infinity;
  for (const river of REACH_RIVERS) best = Math.min(best, riverDistance(river.pts, x, z));
  return best;
}

// ---------------------------------------------------------------------------
// The Evergarden: the formal garden at the world's current northern end. The
// lawns are one broad organic landmass; its signature is the Great Maze, a
// true hedge labyrinth grown from the heightfield itself (walls are terrain,
// so sim collision, the renderer, and the map all read the same hedges).
// ---------------------------------------------------------------------------
const GARDEN_ZMIN = 700; // keep in sync with EVERGARDEN_ZONE.zMin (east column)
const GARDEN_ZMAX = 1260; // ...and zMax
const GARDEN_LAND_LOBES = [
  { x: 410, z: 710, r: 42 }, // the Garden Gate's border footing
  { x: 410, z: 740, r: 55 }, // the Garden Gate's approach lawn
  { x: 378, z: 765, r: 45 }, // the gate road's lawn, bridging to the hub
  { x: 320, z: 810, r: 70 }, // Hedgewick and the gate lawns
  { x: 360, z: 880, r: 80 }, // the Parterre Walk
  { x: 440, z: 850, r: 55 }, // the Petal Pond's basin
  { x: 290, z: 870, r: 40 }, // the rose road's shoulder
  { x: 270, z: 910, r: 60 }, // Dawnhold Castle's lawn
  { x: 360, z: 1016, r: 95 }, // the Great Maze's terrace...
  { x: 305, z: 960, r: 60 }, // ...and its four corners, kept well ashore
  { x: 415, z: 960, r: 60 },
  { x: 305, z: 1075, r: 60 },
  { x: 415, z: 1075, r: 60 },
  { x: 340, z: 1170, r: 65 }, // the north lawn and the Lily Basin
  { x: 420, z: 1140, r: 55 }, // the east walk's long lawn
  { x: 448, z: 895, r: 40 }, // the east walk's south shoulder
  { x: 460, z: 960, r: 55 }, // the east walk's shoulder
  { x: 452, z: 924, r: 44 }, // ...and its south rise off the pond
  { x: 262, z: 1000, r: 44 }, // the gnomes' west lawn kept dry
  { x: 458, z: 1010, r: 40 }, // the east walk's midpoint lawn
  { x: 460, z: 1060, r: 50 }, // the eastern border beds
  { x: 250, z: 1030, r: 55 }, // the western wilds
  { x: 390, z: 1230, r: 50 }, // the far hedgerow under the north rim
  { x: 264, z: 848, r: 38 }, // the west lawn's elder stands dry
  { x: 314, z: 1124, r: 36 }, // the north lawn's elder too
  { x: 430, z: 854, r: 46 }, // the pond road's east shoulder
  { x: 198, z: 726, r: 50 }, // the Moonmere's west cap, garden side
  { x: 240, z: 782, r: 46 }, // ...joined to Hedgewick's lawns
  { x: 522, z: 726, r: 50 }, // the Moonmere's east cap, garden side
  { x: 488, z: 786, r: 46 }, // ...joined to the Petal Pond's basin
] as const;

// Level pads under the Evergarden's modeled flower beds: one per bed (the
// six large square gardens and their small round satellites), consumed by
// the pad-flattening loop in terrainHeight so no bed sinks into a slope.
// Every satellite ANCHORS to its parent square bed (ax, az), so a whole
// ensemble levels to one shared terrace height and overlapping pads never
// fight. The render plan (garden_parterre_core PARTERRE_PLOTS) and the
// collide decor entries (content/evergarden decorProps) carry the SAME
// sites; the parterre test pins all three against each other.
export interface GardenBedPad {
  x: number;
  z: number;
  r: number;
  /** the pad's height anchor; satellites point at their parent bed */
  ax: number;
  az: number;
}
const bedGroup = (ax: number, az: number, r: number, sats: [number, number][]): GardenBedPad[] => [
  { x: ax, z: az, r, ax, az },
  ...sats.map(([x, z]) => ({ x, z, r: 3.25, ax, az })),
];
export const GARDEN_BED_PADS: readonly GardenBedPad[] = [
  ...bedGroup(322, 878, 10, [
    [322, 892.8],
    [322, 863.2],
    [336.8, 878],
    [307.2, 878],
  ]),
  ...bedGroup(400, 866, 9, [
    [400, 879.8],
    [400, 852.2],
    [413.8, 866],
    [386.2, 866],
  ]),
  ...bedGroup(256, 952, 9, [
    [256, 965.8],
    [256, 938.2],
    [269.8, 952],
    [242.2, 952],
  ]),
  ...bedGroup(476, 1010, 7.5, [
    [476, 1022.3],
    [476, 997.7],
    [463.7, 1010],
  ]),
  // (the Garden Gate group came out: its lawn belongs to the extended gate
  // wall and its channel-bank tower now)
  ...bedGroup(300, 1118, 6, [
    [300, 1128.8],
    [300, 1107.3],
    [310.8, 1118],
    [289.2, 1118],
  ]),
] as const;
const GARDEN_BAYS = [
  { x: 190, z: 940, r: 50 }, // the west water
  { x: 535, z: 860, r: 45 }, // the east water
  { x: 522, z: 1105, r: 40 }, // the east bight, mid-coast
] as const;

const GARDEN_LAND_FIELD = boundedBlobs(GARDEN_LAND_LOBES);
const GARDEN_BAY_FIELD = boundedBlobs(GARDEN_BAYS);
export function gardenLandness(x: number, z: number): number {
  return metaballLandness(GARDEN_LAND_FIELD, GARDEN_BAY_FIELD, x, z);
}

// The garden coast: the fen recipe over lawn instead of reeds.
function applyGardenCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(GARDEN_ZMIN - 8, GARDEN_ZMIN + 8, z) *
    (1 - smoothstep(GARDEN_ZMAX - 8, GARDEN_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the east column: cross-fade toward the strip at the border
  if (x > 566) return h; // nothing east of the world (instance space far beyond)
  const seam = smoothstep(STRIP_MAX_X - 8, STRIP_MAX_X + 8, x);
  if (seam <= 0) return h;
  const land = gardenLandness(x, z);
  const t = Math.max(greenSeamT(x, z), smoothstep(0.02, 0.3, land));
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = WATER_LEVEL - 3.2 + (WATER_LEVEL - 0.9 - (WATER_LEVEL - 3.2)) * shelf;
  let out = floor + (h - floor) * t;
  // the Garden Gate: flat pass floor across the border with the headlands
  const passT = (1 - smoothstep(26, 52, Math.abs(x - 400))) * (1 - smoothstep(750, 800, z));
  if (passT > 0) out = out + (6 + (out - 6) * 0.15 - out) * passT;
  // the Gardenwalk: a flat floor easing onto the heights across the border
  const passW = (1 - smoothstep(26, 52, Math.abs(z - 800))) * (1 - smoothstep(230, 280, x));
  if (passW > 0) out = out + (6 + (out - 6) * 0.15 - out) * passW;
  // ...and the Crowgate's south ramp, up into the haunted wood
  const passN = (1 - smoothstep(26, 52, Math.abs(x - 390))) * smoothstep(1200, 1245, z);
  if (passN > 0) out = out + (6 + (out - 6) * 0.15 - out) * passN;
  return h + (out - h) * seam * zSeam;
}

// The Great Maze. '#' cells are modeled hedge walls; '.' cells are lawn
// corridors. Row 0 is the NORTH row (the map's top): the entrance is the
// gap in the south row, the exit the gap in the north row, and the open
// 3x3 court at the center is the Fountain Court. Solvability (entrance to
// court to exit) is asserted by tests/evergarden.test.ts, so an edit here
// that bricks the maze fails CI instead of stranding players.
const GARDEN_MAZE = [
  // the exit sits at column 10: straight north of column 7 lies the garden
  // pond, so the way out opens onto the dry east lawn instead
  '##########.####',
  '#.....#.......#',
  '#.###.#####.###',
  '#.#.#.....#...#',
  '#.#.#####.#.#.#',
  '#.#.#.....#.#.#',
  '#.#.#.#####.#.#',
  '#.#.......#.#.#',
  '#.#.##....###.#',
  '#.#.#.........#',
  '#.###.#######.#',
  '#.#...#.....#.#',
  '#.#.#####.#.#.#',
  '#.#.....#.#.#.#',
  '#.#####.#.###.#',
  '#.......#.....#',
  '#######.#######',
] as const;
export const GARDEN_MAZE_GRID: readonly string[] = GARDEN_MAZE;
export const MAZE_CELL = 9; // yd per maze cell
export const MAZE_COLS = 15;
export const MAZE_ROWS = 17;
export const MAZE_X0 = 360 - (MAZE_COLS * MAZE_CELL) / 2; // west edge, x 292.5
export const MAZE_Z1 = 1093; // north edge (row 0); south edge z 940
export const MAZE_Z0 = MAZE_Z1 - MAZE_ROWS * MAZE_CELL;
// The hedge walls are MODELED now (the user's hedge GLB, rendered by
// garden_features.ts from this same grid), not terrain: the ground through
// the maze is flat lawn and the walls block movement as crisp solid boxes.
// Each wall cell carries a hedge piece along each axis that continues into
// a neighboring wall cell: a piece spans its full cell along the run and
// MAZE_WALL_DEPTH across it, so runs read as continuous clipped hedges and
// corners/junctions read as crossing pieces. Collision is the union of the
// same boxes, so the blocked ground IS the modeled hedge's footprint.
export const MAZE_WALL_DEPTH = 4.2; // yd across a hedge piece (tracks the modeled hedge scale)

/** Inside the maze footprint (small margin), where dressing must not spawn. */
export function inGardenMaze(x: number, z: number): boolean {
  return (
    x > MAZE_X0 - 3 && x < MAZE_X0 + MAZE_COLS * MAZE_CELL + 3 && z > MAZE_Z0 - 3 && z < MAZE_Z1 + 3
  );
}

// Is a grid position a wall? Out-of-bounds counts as open (the lawn beyond
// the maze), so the outer ring's pieces run along the perimeter only.
function mazeWallAt(c: number, r: number): boolean {
  if (r < 0 || r >= MAZE_ROWS || c < 0 || c >= MAZE_COLS) return false;
  return GARDEN_MAZE[r].charCodeAt(c) === 35; // '#'
}

/**
 * Which hedge pieces a wall cell carries: h runs east-west, v runs
 * north-south, both at a junction. An isolated wall cell (no wall
 * neighbors) reads as a single east-west piece. Shared by the movement
 * wall test, the modeled-hedge renderer, and the map painter, so all
 * three always agree exactly. Returns null for corridor cells.
 */
export function gardenMazeCellPieces(c: number, r: number): { h: boolean; v: boolean } | null {
  if (!mazeWallAt(c, r)) return null;
  const h = mazeWallAt(c - 1, r) || mazeWallAt(c + 1, r);
  const v = mazeWallAt(c, r - 1) || mazeWallAt(c, r + 1);
  if (!h && !v) return { h: true, v: false };
  return { h, v };
}

// Movement treats the hedge pieces as hard walls (see colliders
// .resolveMovement). A piece never reaches outside its own cell, so only
// the containing cell is tested.
export function inGardenMazeWall(x: number, z: number): boolean {
  const w = MAZE_COLS * MAZE_CELL;
  if (x < MAZE_X0 || x > MAZE_X0 + w) return false;
  if (z < MAZE_Z0 || z > MAZE_Z1) return false;
  const ci = Math.floor((x - MAZE_X0) / MAZE_CELL);
  const ri = Math.floor((MAZE_Z1 - z) / MAZE_CELL);
  const p = gardenMazeCellPieces(ci, ri);
  if (!p) return false;
  const half = MAZE_CELL / 2;
  const d = MAZE_WALL_DEPTH / 2;
  const lx = x - (MAZE_X0 + ci * MAZE_CELL) - half; // offset from cell center
  const lz = MAZE_Z1 - ri * MAZE_CELL - z - half;
  return (p.h && Math.abs(lz) <= d) || (p.v && Math.abs(lx) <= d);
}

// Does the segment pass through hedge? The endpoint test alone is not
// enough: a mover stalled at a wall face keeps its interpolated target
// advancing, and the moment the target lands on open ground beyond the
// wall an endpoint-only check would teleport it across. Sampled finer than
// the wall's solid core so no step can straddle it.
export function crossesGardenHedge(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): boolean {
  // fast reject: segment nowhere near the maze
  const w = MAZE_COLS * MAZE_CELL;
  if (Math.max(fromZ, toZ) < MAZE_Z0 || Math.min(fromZ, toZ) > MAZE_Z1) return false;
  if (Math.max(fromX, toX) < MAZE_X0 || Math.min(fromX, toX) > MAZE_X0 + w) return false;
  const len = Math.hypot(toX - fromX, toZ - fromZ);
  const steps = Math.max(1, Math.ceil(len / 0.3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (inGardenMazeWall(fromX + (toX - fromX) * t, fromZ + (toZ - fromZ) * t)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The Galecrest: the world's first east-column realm, a wind-scoured
// headland landmass in its own grid cell beside the Willowfen. Its west
// border is the vertical ridge the border-edge machinery raises along the
// shared column edge, opened at the Windway (westPassZ 3380).
// ---------------------------------------------------------------------------
const GALE_XMIN = 180; // keep in sync with GALECREST_ZONE.xMin
const GALE_ZMIN = 180;
const GALE_ZMAX = 700;
const GALE_LAND_LOBES = [
  { x: 210, z: 440, r: 48 }, // the Windway's shelf at the border
  { x: 268, z: 405, r: 55 }, // the road's rise onto the downs
  { x: 290, z: 340, r: 70 }, // the Howling Downs
  { x: 340, z: 380, r: 65 }, // the mid downs
  { x: 425, z: 360, r: 70 }, // Wickharbor's headland
  { x: 492, z: 315, r: 45 }, // the Old Beacon's head
  { x: 448, z: 522, r: 55 }, // the Shear's cliff tops
  { x: 300, z: 555, r: 58 }, // the Mirror Tarn plateau
  { x: 355, z: 620, r: 60 }, // the Wreckfields' back downs
  { x: 380, z: 480, r: 60 }, // the connective heart of the headland
  { x: 240, z: 510, r: 50 }, // the west downs above the border range
  { x: 435, z: 450, r: 45 }, // the cliff road's first shoulder
  { x: 428, z: 565, r: 48 }, // ...and its long run above the Shear
  { x: 345, z: 515, r: 42 }, // the tarn road's saddle
  { x: 366, z: 566, r: 40 }, // the wisp hollows
  { x: 300, z: 510, r: 42 }, // the upper downs west of the saddle
  { x: 390, z: 658, r: 44 }, // the Crowgate climb's south footing
  { x: 388, z: 692, r: 38 }, // the Crowgate climb's border footing
  { x: 200, z: 212, r: 50 }, // the corner knot, gale quarter
  { x: 250, z: 264, r: 48 }, // the knot's shore rising onto the Howling Downs
  { x: 200, z: 674, r: 48 }, // the Four Corners, gale quarter
  { x: 474, z: 638, r: 44 }, // the east downs above the wrecks: the Crowmere's south neck
  { x: 428, z: 624, r: 44 }, // ...joined to the Wreckfields' back downs
] as const;
const GALE_BAYS = [
  { x: 470, z: 390, r: 24 }, // the harbor cove in Wickharbor's lee
  { x: 530, z: 600, r: 50 }, // the south sound
  { x: 272, z: 676, r: 34 }, // the north bight, now a cove of the Crowmere
  { x: 535, z: 210, r: 45 }, // the northeast water past the beacon
] as const;

const GALE_LAND_FIELD = boundedBlobs(GALE_LAND_LOBES);
const GALE_BAY_FIELD = boundedBlobs(GALE_BAYS);
export function galeLandness(x: number, z: number): number {
  return metaballLandness(GALE_LAND_FIELD, GALE_BAY_FIELD, x, z);
}

// The headland coast: the fen recipe cut steeper (sea cliffs, not bog), a
// flat pass floor at the Windway meeting the fen's east ramp.
function applyGaleCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(GALE_ZMIN - 8, GALE_ZMIN + 8, z) * (1 - smoothstep(GALE_ZMAX - 8, GALE_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the seam twin of applyFenCoast's gate: cross-fade, never a hard cut
  if (x > 566) return h; // nothing east of the world (instance space far beyond)
  const seam = smoothstep(STRIP_MAX_X - 8, STRIP_MAX_X + 8, x);
  if (seam <= 0) return h;
  const land = galeLandness(x, z);
  const t = Math.max(greenSeamT(x, z), smoothstep(0.02, 0.28, land));
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = WATER_LEVEL - 3.6 + (WATER_LEVEL - 1.2 - (WATER_LEVEL - 3.6)) * shelf;
  let out = floor + (h - floor) * t;
  // the Windway: flat pass floor across the column border
  const passT = (1 - smoothstep(26, 52, Math.abs(z - 440))) * (1 - smoothstep(230, 280, x));
  if (passT > 0) out = out + (6 + (out - 6) * 0.15 - out) * passT;
  // ...and the Garden Gate's south ramp, up onto the lawns
  const passN = (1 - smoothstep(26, 52, Math.abs(x - 400))) * smoothstep(640, 685, z);
  if (passN > 0) out = out + (6 + (out - 6) * 0.15 - out) * passN;
  return h + (out - h) * seam * zSeam;
}

// ---------------------------------------------------------------------------
// Eastbrook Vale's organic coast. The starter map meets open sea on its
// east, south, and west edges (its north edge is the land border with the
// Mirefen). A metaball landness field gives it a lobed, bayed shoreline
// instead of a square rim; the interior sits at high landness, so the coast
// applier returns it untouched and every seed-pinned fixture keeps its exact
// ground. Only the far edges (low landness) become shore and water.
// ---------------------------------------------------------------------------
const VALE_LAND_LOBES = [
  { x: 0, z: 30, r: 128 }, // the heartland: the town, the roads, the fields
  { x: 0, z: 155, r: 100 }, // the north reach to the Mirefen border
  { x: -95, z: 170, r: 52 }, // ...its northwest fill (the border stays land)
  { x: 95, z: 170, r: 52 }, // ...and northeast fill
  { x: -168, z: 172, r: 42 }, // the northwest border corner
  { x: 168, z: 172, r: 42 }, // the northeast border corner
  { x: -100, z: 85, r: 70 }, // the western downs and Mirror Lake's shore
  { x: -95, z: -55, r: 70 }, // the southwest pastures (Grix's tunnel)
  { x: 45, z: -85, r: 84 }, // the south fields (the bandit camp)
  { x: 108, z: -52, r: 60 }, // the southwest rise (mogger's hollow)
  { x: 100, z: 70, r: 62 }, // the west meadows
  { x: 60, z: 138, r: 55 }, // Brightwood Glade's north wood
  { x: 150, z: -46, r: 44 }, // the west point: the causeway's mainland root
] as const;
const VALE_BAYS = [
  { x: -192, z: 25, r: 60 }, // the west bay
  { x: 30, z: -196, r: 66 }, // the south bay
  { x: 196, z: 104, r: 56 }, // the east bay, north of the causeway
  { x: -142, z: -152, r: 48 }, // the southwest cove
  { x: 178, z: -128, r: 42 }, // the south cove, east of the point
] as const;

const VALE_LAND_FIELD = boundedBlobs(VALE_LAND_LOBES);
const VALE_BAY_FIELD = boundedBlobs(VALE_BAYS);
export function valeLandness(x: number, z: number): number {
  return metaballLandness(VALE_LAND_FIELD, VALE_BAY_FIELD, x, z);
}

// The vale coast: gentle green shores meeting the sea. Runs on the vale's own
// band only (its north edge stays the Mirefen land border, untouched). The
// window edges are FADES, not cuts: the carve used to stop dead at x = 178
// and z = 178 while still pulling partial-landness ground several yards
// toward the sea floor, leaving an instant cliff wall along both lines (the
// strait wall north of the causeway, and the border-corner steps). The east
// edge fades OUT into the strait (where the starter moat's own carve is
// already ramping in), so everything at x <= 178 keeps its exact height; the
// north edge fades IN before the border, releasing the ground back to the
// raw band so the vale meets the Mirefen as continuous land, which is what
// the border-corner fill lobes always intended.
// (tests/terrain_window_seams.test.ts pins both lines.)
function applyValeCoast(x: number, z: number, h: number): number {
  if (z > 178 || z < -215 || x > 190) return h;
  const w = (1 - smoothstep(178, 190, x)) * (1 - smoothstep(162, 178, z));
  if (w <= 0) return h;
  const land = valeLandness(x, z);
  const t = smoothstep(0.02, 0.3, land);
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = WATER_LEVEL - 3.4 + (WATER_LEVEL - 1 - (WATER_LEVEL - 3.4)) * shelf;
  return h + (floor + (h - floor) * t - h) * w;
}

// The Ferrywalk: a natural sandbar causeway from the vale's west point across
// the strait to the Farshore's Landing, so the island is reached on foot (no
// teleport). A curving spit of low ground raised out of the shallows; the
// deeper water to either side keeps its swim fatigue.
const CAUSEWAY = [
  { x: 150, z: -46 },
  { x: 173, z: -30 },
  { x: 195, z: -14 },
  { x: 217, z: 1 },
  { x: 238, z: 12 },
  { x: 256, z: 16 },
] as const;
function causewayDistance(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < CAUSEWAY.length; i++) {
    const a = CAUSEWAY[i];
    const b = CAUSEWAY[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}
export function onCauseway(x: number, z: number): boolean {
  // The WEST edge must contain the distance test's full support (every point
  // with d < 22 of the spit): the old x > 140 edge clipped the sandbar lift
  // mid slope near the mainland root at (150, -46), leaving a step wall
  // along x = 140 (tests/terrain_window_seams.test.ts). The EAST x < 262
  // edge is a deliberate trim, kept: it ends the spit's no-fatigue water and
  // lift just past the Landing so the open sea beyond guards the island
  // (tests/fixes.test.ts, the open-shore fatigue pin); the surrounding isle
  // shelf sits near the bar height there, so the trim never steps.
  return z < 60 && z > -80 && x > 126 && x < 262 && causewayDistance(x, z) < 22;
}
function applyCauseway(x: number, z: number, h: number): number {
  if (!onCauseway(x, z)) return h;
  const d = causewayDistance(x, z);
  const w = 1 - smoothstep(9, 22, d);
  if (w <= 0) return h;
  // a low sandbar (walkable ~2.2), roughened so it reads as drifted sand
  const bar = 2.2 + (noise2(x * 0.09, z * 0.09, 613) - 0.5) * 1.2;
  const lifted = Math.max(h, bar);
  return h + (lifted - h) * w;
}

// Clean open water framing the Farshore: the island touches the mainland
// only at the causeway, so its shared edges read as sea, with no border
// ridge or neighbour coast bleeding into the island's map. A channel to the
// north (the Galecrest, no crossing there) and open sea below its south
// headland; the causeway's z-window sits between the two, untouched.
function applyStarterMoat(x: number, z: number, h: number): number {
  // the vale/island border strait (x~177..190): clear any crest sitting on
  // the border line over the open water on either side of the Ferrywalk, so
  // the only dry link is the causeway. Skipped on the causeway itself. Every
  // window edge is a fade, never a cut (the old hard z < 150 and x <= 194
  // edges left step walls along both lines; the seabed now ramps up onto the
  // vale's north-corner land instead): tests/terrain_window_seams.test.ts.
  if (x >= 177 && x <= 196 && z < 158 && z > -184 && !onCauseway(x, z)) {
    // the north fade starts at z = 148 so the carve keeps FULL depth through
    // every guarded strait row (the deep-water barrier must not shallow),
    // then ramps out as a continuous bank under the vale's north-corner land
    const wb =
      smoothstep(177, 182, x) *
      (1 - smoothstep(188, 196, x)) *
      (1 - smoothstep(148, 158, z)) *
      smoothstep(-184, -172, z);
    if (wb > 0) {
      const sea2 = Math.min(h, WATER_LEVEL - 5);
      h = h + (sea2 - h) * wb;
    }
  }
  if (x < 172 || x > 548) return h;
  // the west end eases up onto the strip's border headland instead of
  // starting as a vertical channel wall at x = 184
  const xw = smoothstep(172, 184, x);
  // the north channel: the border band with the Galecrest (z 164..186),
  // fading back to the Galecrest's own coast north of z 200
  const north = smoothstep(150, 164, z) * (1 - smoothstep(186, 200, z));
  // the south: open sea below the island's headland, out to the map edge
  const south = smoothstep(-150, -166, z);
  const w = Math.max(north, south) * xw;
  if (w <= 0) return h;
  const sea = Math.min(h, WATER_LEVEL - 5);
  return h + (sea - h) * w;
}

// ---------------------------------------------------------------------------
// The Farshore: a small island in the starter sea east of Eastbrook Vale
// (map-left of it, under the compass mirror). No land border and no pass:
// the only way over is the ferry portal, and swim fatigue guards the
// strait. Beaches all around, rising to the Crown Meadow inland.
// ---------------------------------------------------------------------------
const ISLE_LAND_LOBES = [
  { x: 375, z: -5, r: 95 }, // the island's heart, rising to the Crown Meadow
  { x: 305, z: 70, r: 55 }, // Gullhaven's shelf on the northwest strand
  { x: 256, z: 15, r: 42 }, // the Landing's shelf
  { x: 430, z: 55, r: 65 }, // the east downs
  { x: 400, z: -70, r: 70 }, // the south headland
  { x: 320, z: -55, r: 55 }, // the coves' shoulder
  { x: 356, z: 88, r: 60 }, // the north point
  { x: 275, z: 44, r: 42 }, // the ferry road's rise
] as const;
const ISLE_BAYS = [
  { x: 292, z: -108, r: 40 }, // the south cove
  { x: 472, z: -30, r: 40 }, // the east bight
] as const;

const ISLE_LAND_FIELD = boundedBlobs(ISLE_LAND_LOBES);
const ISLE_BAY_FIELD = boundedBlobs(ISLE_BAYS);
export function isleLandness(x: number, z: number): number {
  return metaballLandness(ISLE_LAND_FIELD, ISLE_BAY_FIELD, x, z);
}

// The island coast: beaches all around, and the interior climbs with the
// landness field itself, so the highest ground is the farthest inland.
function applyIsleCoast(x: number, z: number, h: number): number {
  if (x < 166 || x > 566) return h;
  const zSeam = smoothstep(-188, -172, z) * (1 - smoothstep(172, 188, z));
  if (zSeam <= 0) return h;
  const seam = smoothstep(172, 188, x);
  if (seam <= 0) return h;
  const land = isleLandness(x, z);
  const t = smoothstep(0.02, 0.3, land);
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = WATER_LEVEL - 3.2 + (WATER_LEVEL - 0.8 - (WATER_LEVEL - 3.2)) * shelf;
  let out = floor + (h - floor) * t;
  // the beach apron: low shores pressed flat, the Palmreach recipe
  const beachT = 1 - smoothstep(0.05, 0.28, land);
  if (beachT > 0 && out > 1.4) out = out + (1.4 + (out - 1.4) * 0.2 - out) * beachT;
  // higher land more inland: a broad dome under the Crown Meadow, so the
  // shore is always the low ground and the center the high
  const dCrown = Math.hypot(x - 375, z + 5);
  out += 14 * (1 - smoothstep(18, 128, dCrown)) * smoothstep(0.02, 0.2, land);
  return h + (out - h) * seam * zSeam;
}

// The border meres between columns: the seam blend of two adjacent coasts
// leaves each border line hovering at the waterline (a mushy mudflat neither
// walkable nor swimmable); these carve every column border into honest
// water, leaving each crossing's corridor untouched. Since the corner caps
// landed, each carve is also windowed to its lake basin (lakeLo..lakeHi) and
// fades out into the cap land at both ends, so the water is a landlocked
// mere, not a sea strait.
const COLUMN_STRAITS = [
  // east: the Hollow's moat running north into the Reach's flank, crossed
  // only by the Snowline's isthmus at the fire and ice border
  { borderX: STRIP_MAX_X, passZ: 1890, zLo: 900, zHi: 1960, lakeLo: 940, lakeHi: 1925 },
  // west: the same moat mirrored, crossed by the Goldmelt's isthmus
  { borderX: STRIP_MIN_X, passZ: 1890, zLo: 900, zHi: 1960, lakeLo: 940, lakeHi: 1925 },
] as const;
function applyColumnStraits(x: number, z: number, h: number): number {
  let out = h;
  for (const st of COLUMN_STRAITS) {
    if (z <= st.zLo || z > st.zHi) continue;
    const strait =
      (1 - smoothstep(2, 12, Math.abs(x - st.borderX))) *
      smoothstep(26, 52, Math.abs(z - st.passZ)) *
      smoothstep(st.lakeLo - 20, st.lakeLo + 20, z) *
      (1 - smoothstep(st.lakeHi - 20, st.lakeHi + 20, z));
    // The moat's fixed central channel keeps the Hollow enclosed. On top of it,
    // scallop the INNER (Hollow-side) bank so the shore is not a ruled vertical
    // moat wall: coves bite inland from the moat where the Hollow's own coast
    // recedes (low landness), headlands stand proud where it swells. This only
    // ever LOWERS the near-shore strip toward water, never raises the channel,
    // so the moat stays continuous at every z (no bridge possible).
    const zGate =
      smoothstep(26, 52, Math.abs(z - st.passZ)) *
      smoothstep(st.lakeLo - 20, st.lakeLo + 20, z) *
      (1 - smoothstep(st.lakeHi - 20, st.lakeHi + 20, z));
    let scallop = 0;
    if (zGate > 0) {
      // distance inland from the border (positive going into the Hollow)
      const inland = st.borderX > 0 ? st.borderX - x : x - st.borderX;
      if (inland > 8 && inland < 46) {
        const land = hollowLandness(x, z);
        // low landness -> deep cove; taper the band's inner lip so coves ease
        // into the shore instead of ending in a step
        const cove = 1 - smoothstep(-0.16, 0.1, land);
        const lip = smoothstep(8, 16, inland) * (1 - smoothstep(34, 46, inland));
        // only deepen ground that is ALREADY near the waterline, so the coves
        // extend genuine shore into the moat and never bite a marginal sliver
        // out of an elevated ridge foot (e.g. the z1440 border foot).
        const lowGate = 1 - smoothstep(1, 8, out);
        scallop = cove * lip * zGate * lowGate;
      }
    }
    const carve = Math.max(strait, scallop);
    if (carve > 0) {
      const channel = Math.min(out, WATER_LEVEL - 2.5);
      out = out + (channel - out) * carve;
    }
    // The OUTER bank (the neighbor realm's flank) cut to the walkable beach
    // ramp (see borderBankRamp): the border ridge and flank coasts must never
    // stand as a cliff over the moat water (field-reported trap at the
    // Palmreach|Hollow crossing). The Hollow's INNER bank keeps its authored
    // scallop coves and proud headlands (the coves are the designed exits,
    // and seed-pinned ruins stand on those headlands); the pass isthmus
    // window keeps its full road profile.
    if (zGate > 0) {
      const outward = st.borderX > 0 ? x - st.borderX : st.borderX - x;
      const outerSide = smoothstep(-4, 4, outward);
      const wRamp = zGate * outerSide;
      if (wRamp > 0) {
        const capped = Math.min(out, borderBankRamp(Math.abs(x - st.borderX)));
        out = out + (capped - out) * wRamp;
      }
    }
  }
  return out;
}

// The row meres: the six column-row borders carved into honest lakes
// between their green or capped ends, each crossed only by its pass road's
// isthmus (the h-border twin of COLUMN_STRAITS).
// xLo/xHi span the mere's water. The z700 row sits in the peaks green-seam
// row, so its INNER cap (the x=+-180 seam) stays dry land; the z1260/z1820
// rows sit against the Hollow/Frost moats, so their inner caps are water
// too. All rows carve out to the world edge (x=+-540) so no cap sliver is
// left proud at the map corners.
// The walkable beach ramp cut into a border-water bank (the meres and the
// column straits): terrain above this envelope is cut down to a 0.55 rise/run
// ramp anchored just outside the channel carve, so climbing out of a border
// water is always a beach walk, never a cliff scramble. Terrain already below
// the envelope (the water itself, gentle banks) keeps its own shape, and the
// ramp exceeds every natural bank within ~25yd, so the cut self-releases.
function borderBankRamp(bankDist: number): number {
  return WATER_LEVEL + Math.max(0, bankDist - 15) * 0.55;
}

const ROW_MERES = [
  { borderZ: 700, passX: 400, xLo: 240, xHi: 552 }, // the Lawnmere
  { borderZ: 1260, passX: 390, xLo: 168, xHi: 552 }, // the Gravemere
  { borderZ: 1820, passX: 404, xLo: 168, xHi: 552 }, // the Ashmere
  { borderZ: 700, passX: -400, xLo: -552, xHi: -240 }, // the Palmere
  { borderZ: 1260, passX: -330, xLo: -552, xHi: -168 }, // the Duskmere
  { borderZ: 1820, passX: -350, xLo: -552, xHi: -168 }, // the Goldmere
] as const;
function applyRowMeres(x: number, z: number, h: number): number {
  let out = h;
  for (const m of ROW_MERES) {
    if (x <= m.xLo - 20 || x > m.xHi + 20) continue;
    const xWindow =
      smoothstep(26, 52, Math.abs(x - m.passX)) *
      smoothstep(m.xLo - 20, m.xLo + 20, x) *
      (1 - smoothstep(m.xHi - 20, m.xHi + 20, x));
    const mere = (1 - smoothstep(2, 12, Math.abs(z - m.borderZ))) * xWindow;
    if (mere > 0) {
      const basin = Math.min(out, WATER_LEVEL - 2.5);
      out = out + (basin - out) * mere;
    }
    // The banks: cut both shores down to a walkable beach ramp rising from
    // the water, so a swimmer can always climb out of the mere instead of
    // treading under an authored cliff (field-reported trap). The ramp
    // self-releases where the natural bank is already gentler, and the pass
    // isthmus window keeps its full road profile.
    if (xWindow > 0) {
      const capped = Math.min(out, borderBankRamp(Math.abs(z - m.borderZ)));
      out = out + (capped - out) * xWindow;
    }
  }
  return out;
}

// The north bay: the open water between the columns' shoulders, north of
// the Reach's coast. No zone owns that gap, and untouched it would
// soft-floor into dry mudflats instead of sea.
function applyNorthBay(x: number, z: number, h: number): number {
  if (z <= FROST_ZMAX - 60 || Math.abs(x) > STRIP_MAX_X + 20) return h;
  const ax = Math.abs(x);
  // The Reach's north shore ends INSIDE its own band. The old lobed
  // headlands ran dry land past the zone line into the no-zone gap, where
  // zoneAt falls back to the Amberfall and the map loses its tiles (the
  // reported glitch). The shoreline now wobbles just south of the boundary,
  // the approach is a walkable bank, and everything past it is the bay's
  // open water shore to shore (tests/world_edge_coast.test.ts sweeps the
  // whole gap for dry ground). The window widens toward the boundary so the
  // gap drowns fully, while south of the widening the meres' enclosing cap
  // land keeps its designed dry ground (the world_grid cap pins).
  const widen = 12 * smoothstep(FROST_ZMAX - 14, FROST_ZMAX, z);
  const xWin = 1 - smoothstep(172 + widen, 188 + widen, ax);
  if (xWin <= 0) return h;
  const wob = (fbm2(x * 0.03, 61.7, 9331, 2) - 0.5) * 14;
  const zShore = FROST_ZMAX - 12 + wob; // 1941 to 1955: strictly inside the band
  const bank = WATER_LEVEL - 0.2 + 0.65 * Math.max(0, zShore - z);
  if (h > bank) h = h + (bank - h) * xWin;
  const t = smoothstep(zShore, zShore + 24, z) * xWin;
  if (t <= 0) return h;
  const sea = Math.min(h, WATER_LEVEL - 6);
  return h + (sea - h) * t;
}

// The northern grid's outer edges are OPEN OCEAN. After all land shaping and
// the rims, a sea margin is carved around the true world perimeter (the
// columns' outer x-flanks and the north cap) so no realm's land hugs the map
// edge. The margin's inner shoreline wanders with fixed-seed noise, so land
// meets the sea as a natural coast, never a ruled edge with land on one side
// and water on the other. The playable world only (instance space past |x|560
// keeps its own containment); the starter/mid realms south of z1250 already
// end in open coast, so they are left to their own appliers.
function applyWorldEdgeSea(x: number, z: number, h: number): number {
  if (z <= 1250 || Math.abs(x) > 560) return h;
  // Each column's sea margin measures against ITS OWN outer perimeter: the
  // west column ends at the world's west bound and the Amberfall's zMax,
  // the east column at the east bound and the world's north end, and the
  // strip's flanks face sibling columns (interior, no margin; its far north
  // is the bay's water, applyNorthBay). The old row-union bounds
  // (worldXBoundsAt) are a STEP function of z, and consuming them here
  // stood the whole z = 2380 line up as an instant 16yd wall into the sunk
  // sea. tests/world_edge_coast.test.ts sweeps the margins.
  const dX = x < STRIP_MIN_X ? x - WORLD_MIN_X : x > STRIP_MAX_X ? WORLD_MAX_X - x : Infinity;
  // ...blended across the west column seam so the margin's own onset never
  // steps at the Amberfall's northeast corner
  const northEnd =
    AMBER_ZMAX + (WORLD_MAX_Z - AMBER_ZMAX) * smoothstep(STRIP_MIN_X - 12, STRIP_MIN_X + 12, x);
  const dEdge = Math.min(dX, northEnd - z);
  if (dEdge > 190) return h;
  // two octaves of fixed-seed noise bend the shoreline into deep coves and
  // headlands so the ocean margin reads as a natural coast, not a ruled band
  const wob =
    (fbm2(x * 0.015, z * 0.015, 9311, 3) - 0.5) * 54 +
    (fbm2(x * 0.044, z * 0.044, 9313, 2) - 0.5) * 18;
  const band = 50 + wob;
  // Pull the land back from the margin: ground standing tall near the
  // shoreline is shaved to a 0.55 rise/run bank climbing inland from the
  // beach, so the world ends in shores and headland slopes, never a plateau
  // cliff (the report: sheer walls at the Drakelands' east shore and the
  // Amberfall's west and north). The cone clears the Drakemaw Caldera and
  // every hub/POI standing near a margin; the authority fade releases well
  // inside the early-out above so neither edge seams.
  const capW = 1 - smoothstep(band + 40, band + 90, dEdge);
  if (capW > 0) {
    const cap = WATER_LEVEL + 1.1 + 0.55 * Math.max(0, dEdge - (band - 30));
    if (h > cap) h = h + (cap - h) * capW;
  }
  const seaT = 1 - smoothstep(band - 34, band, dEdge);
  if (seaT <= 0) return h;
  const floor = Math.min(h, WATER_LEVEL - 6);
  return h + (floor - h) * seaT;
}

// The strip's flanks (the Hollow and the Reach beside the moat) are NATURAL
// COAST, not walls: pull their land back from the x=+-180 boundary with a wavy
// shoreline so the moat reads as a sound the land slopes into, never a ruled
// edge with land one side and water the other. Confined to the strip side and
// gated to low ground (a lowGate) so it only widens the near-shore into the
// moat, never cuts a marginal sliver out of interior land or the Tablecrag;
// the isthmus crossings at z1890 are left as land bridges.
function applyStripFlankCoast(x: number, z: number, h: number): number {
  // The z window fades INSIDE the old hard 940..1925 edges (which left step
  // walls where the carve was still several yards deep at the line): the
  // carve releases to zero AT the edges, so nothing outside the window is
  // ever touched. Fading outward instead would carve the meres' enclosing
  // cap land (the Veilmelt north cap pin in tests/world_grid.test.ts). The
  // inland x edge fades outward, guarded by the lowGate (the wavy band can
  // still reach dEdge 48 at the old ax < 132 cut).
  // tests/terrain_window_seams.test.ts pins the lines.
  if (z < 940 || z > 1925) return h;
  const ax = Math.abs(x);
  if (ax > 180 || ax < 124) return h;
  const zWin = smoothstep(940, 956, z) * (1 - smoothstep(1909, 1925, z));
  const xWin = smoothstep(124, 132, ax);
  const dEdge = 180 - ax;
  const nearPass = 1 - smoothstep(20, 48, Math.abs(z - 1890));
  const wob =
    (fbm2(z * 0.02, Math.sign(x) * 70, 9321, 3) - 0.5) * 34 +
    (fbm2(z * 0.05, Math.sign(x) * 31, 9323, 2) - 0.5) * 12;
  const band = 28 + wob;
  const lowGate = 1 - smoothstep(6, 22, h);
  const seaT = (1 - smoothstep(band - 22, band, dEdge)) * (1 - nearPass) * lowGate * zWin * xWin;
  if (seaT <= 0) return h;
  const floor = Math.min(h, WATER_LEVEL - 5);
  return h + (floor - h) * seaT;
}

// The green seams: along the marsh and peaks rows the columns join the
// strip as dry rolling land (the sketch's land borders). The coast
// appliers stand down inside the seam band so no shoreline forms there,
// and the border ridge still rises over it (seaGate reads this too).
function greenSeamT(x: number, z: number): number {
  if (z < 170 || z > 910) return 0;
  const d = Math.abs(Math.abs(x) - STRIP_MAX_X);
  return (1 - smoothstep(50, 90, d)) * (1 - smoothstep(870, 910, z));
}

// Same coast recipe; holds the sealed wall's footing at the south fringe.
function applyAmberCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(AMBER_ZMIN - 8, AMBER_ZMIN + 8, z) *
    (1 - smoothstep(AMBER_ZMAX - 8, AMBER_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the west column: cross-fade toward the strip at the border
  if (x < -566) return h; // nothing west of the world
  const seam = 1 - smoothstep(STRIP_MIN_X - 8, STRIP_MIN_X + 8, x);
  if (seam <= 0) return h;
  const land = amberLandness(x, z);
  const t = smoothstep(0.02, 0.3, land);
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = HOLLOW_SEA_FLOOR + (WATER_LEVEL - 1.1 - HOLLOW_SEA_FLOOR) * shelf;
  let out = floor + (h - floor) * t;
  // the Goldmelt: a flat floor at the fire and ice border's autumn side
  const passT = (1 - smoothstep(26, 52, Math.abs(z - 1890))) * smoothstep(-260, -215, x);
  if (passT > 0) out = out + (7 + (out - 7) * 0.15 - out) * passT;
  // ...and the gold road's south cap, meeting the dream's ramp at the border
  const passS = (1 - smoothstep(26, 52, Math.abs(x + 350))) * (1 - smoothstep(1870, 1920, z));
  if (passS > 0) out = out + (6 + (out - 6) * 0.15 - out) * passS;
  return h + (out - h) * seam * zSeam;
}

// Sink everything beyond the coast to the seabed. The outer 10yd of the band
// keeps the containment rim (it rises from the water as border cliffs), and
// the sealed border band is fully inside land lobes so the wall never wets.
function applyHollowCoast(x: number, z: number, h: number): number {
  // the sea starts north of the sealed range: the realm's south is mountain,
  // its other shores are coast (and the wall never wets). The south limit
  // wanders to z940 (well clear of the sealed crest at z900-915 and its
  // feather) so the south shoreline is organic, not a horizontal chop; the
  // z925-935 land lobes keep the whole wall band dry.
  if (z < 940) return h;
  const southEase = smoothstep(940, 968, z);
  const zSeam = 1 - smoothstep(HOLLOW_ZMAX - 8, HOLLOW_ZMAX + 8, z);
  if (zSeam <= 0) return h;
  // the moat columns flank the Hollow now: its coast owns only the strip,
  // cross-fading toward the lawns and the wood at the border meres
  const seam =
    smoothstep(STRIP_MIN_X - 8, STRIP_MIN_X + 8, x) *
    (1 - smoothstep(STRIP_MAX_X + 8, STRIP_MAX_X + 30, x));
  if (seam <= 0) return h;
  const land = hollowLandness(x, z);
  // a wide, gentle transition: a shallow near-shore shelf slopes into the
  // deep, so beaches ease into the water instead of dropping off a cliff
  const t = smoothstep(0.02, 0.3, land);
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = HOLLOW_SEA_FLOOR + (WATER_LEVEL - 1.1 - HOLLOW_SEA_FLOOR) * shelf;
  let out = floor + (h - floor) * t;
  // The northern lowlands: everything past the mainland's north coast rides
  // low (dune country), so no bluff line interrupts the view over the open
  // sea. The rims add AFTER this, so the causeway tip's gate cap at the band
  // edge still rises as the one distant landmark.
  if (z > 1245) {
    const cap = 6.5;
    const ease = smoothstep(1245, 1268, z); // mainland shore eases into it
    if (out > cap) out = out + (cap + (out - cap) * 0.12 - out) * ease;
  }
  // Wave-cut ledges: coastal rock above the beach line breaks into stepped
  // terraces with noise-jittered edges, so bluffs meet the sea as rigid
  // cliff faces instead of smooth mounds. Confined to the shore band (the
  // interior fades out by landness) south of the northern lowlands; beaches
  // and the water itself sit below the height gate and stay gentle.
  if (z < 1245) {
    const coastW = smoothstep(0.02, 0.1, land) * (1 - smoothstep(0.3, 0.48, land));
    if (coastW > 0) {
      const lift = smoothstep(WATER_LEVEL + 1.5, WATER_LEVEL + 6, out);
      const fade = 1 - smoothstep(WATER_LEVEL + 20, WATER_LEVEL + 28, out);
      const w = 0.62 * coastW * lift * fade;
      if (w > 0) {
        const step = 4.2;
        const jit = (noise2(x * 0.13, z * 0.13, 77) - 0.5) * 2.2;
        const hh = out + jit;
        const base = Math.floor(hh / step) * step;
        const frac = (hh - base) / step;
        const ledge = base + step * Math.min(1, Math.max(0, (frac - 0.3) / 0.4));
        out = out + (ledge - out) * w;
      }
    }
  }
  return h + (out - h) * seam * zSeam * southEase;
}

// The Drakelands' coast, same recipe as the Hollow's. It fades OUT toward
// the volcanic rim belt (z past ~2010) so the Drakemaw range keeps its
// footing all the way across the band: over the flanks the sealed range
// simply runs down into the sea instead of being sunk by the coast.
function applyEmberCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(DRAKE_ZMIN - 8, DRAKE_ZMIN + 8, z) *
    (1 - smoothstep(DRAKE_ZMAX - 8, DRAKE_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the east column: cross-fade toward the strip at the border
  if (x > 566) return h; // nothing east of the world (instance space far beyond)
  const emberSeam = smoothstep(STRIP_MAX_X - 8, STRIP_MAX_X + 8, x);
  if (emberSeam <= 0) return h;
  const land = emberLandness(x, z);
  const t = smoothstep(0.02, 0.3, land);
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = HOLLOW_SEA_FLOOR + (WATER_LEVEL - 1.1 - HOLLOW_SEA_FLOOR) * shelf;
  let out = floor + (h - floor) * t;
  // the Wyrmgate road's south cap, meeting the wood's ramp at the border
  const passS = (1 - smoothstep(26, 52, Math.abs(x - 404))) * (1 - smoothstep(1870, 1920, z));
  if (passS > 0) out = out + (6 + (out - 6) * 0.15 - out) * passS;
  // ...and the Snowline's east floor, fire cooling into ice at the border
  const passW = (1 - smoothstep(26, 52, Math.abs(z - 1890))) * (1 - smoothstep(230, 280, x));
  if (passW > 0) out = out + (6 + (out - 6) * 0.15 - out) * passW;
  return h + (out - h) * emberSeam * zSeam;
}

// The Frostveil's coast. Fades IN north of the sealed wall's footing for the
// same reason (the wall crest sits at the band's south fringe).
function applyFrostCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(HOLLOW_ZMAX - 8, HOLLOW_ZMAX + 8, z) *
    (1 - smoothstep(FROST_ZMAX - 8, FROST_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the Reach holds the strip's north end: cross-fade toward both columns
  const seam =
    smoothstep(STRIP_MIN_X - 8, STRIP_MIN_X + 8, x) *
    (1 - smoothstep(STRIP_MAX_X - 8, STRIP_MAX_X + 8, x));
  if (seam <= 0) return h;
  const land = frostLandness(x, z);
  const t = smoothstep(0.02, 0.3, land);
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = HOLLOW_SEA_FLOOR + (WATER_LEVEL - 1.1 - HOLLOW_SEA_FLOOR) * shelf;
  let out = floor + (h - floor) * t;
  // Continue the Hollow's northern-lowlands cap across the border (same
  // formula, easing off northward), so the Wyrmgate shore meets the causeway
  // at matching height and the road rises gradually into the snow.
  const capEase = 1 - smoothstep(1442, 1495, z);
  if (capEase > 0 && out > 6.5) out = out + (6.5 + (out - 6.5) * 0.12 - out) * capEase;
  // the Snowline's west ramp: ice warming toward the waste at the border...
  const passE = (1 - smoothstep(26, 52, Math.abs(z - 1890))) * smoothstep(100, 145, x);
  if (passE > 0) out = out + (7 + (out - 7) * 0.15 - out) * passE;
  // ...and the Goldmelt's east ramp, toward the autumn on the west border
  const passW = (1 - smoothstep(26, 52, Math.abs(z - 1890))) * (1 - smoothstep(-145, -100, x));
  if (passW > 0) out = out + (7 + (out - 7) * 0.15 - out) * passW;
  return h + (out - h) * seam * zSeam;
}

// The Drakemaw's volcano cones: raised shields with crater dips. The caldera
// floors sit well above the sea so they stay dry; the render layer pours the
// lava (ember features module).
export const EMBER_VOLCANOES = [
  { x: 390, z: 2320, r: 62, h: 27, craterR: 16, craterD: 13 }, // Drakemaw Caldera
  { x: 270, z: 2282, r: 40, h: 20, craterR: 8, craterD: 8 },
  // the east cone, on its real footing: at (500, 2370) it straddled the
  // column strait and row mere carves, which sank its seaward half (and
  // its crater pool) to the seabed after every shaping pass
  { x: 487, z: 2356, r: 32, h: 18, craterR: 7, craterD: 7 },
  { x: 318, z: 2392, r: 30, h: 14, craterR: 0, craterD: 0 },
] as const;
// the Snowline crossing's drake-side footing (appended to the ember lobes
// below via EMBER_GATE_LOBES; the fire road to the ice)

// Open lava pools out in the wastes (shaped as shallow flat-floored basins;
// the render lava surface sits just above each floor).
// padK: where the flat melt floor ends, as a fraction of r. The default 0.95
// keeps the whole model footprint on level ground; the Drakemaw vent keeps
// the original tight eye (0.55) because its shore is the escape bench's
// wade-out ramp (DRAKEMAW_ESCAPE), pinned by tests/terrain_escape.test.ts.
export const EMBER_LAVA_POOLS = [
  { x: 390, z: 2320, r: 14, floor: 12, padK: 0.55 }, // the vent inside the Drakemaw crater
  { x: 446, z: 2220, r: 11, floor: -0.5 },
  { x: 302, z: 2328, r: 11, floor: 0 },
  // crater pools high in the two smaller cones (padK 0.55: the pit walls
  // cradle the model's rocky ring, and the escape walkers need the legacy
  // gentle floor-to-wall transition)
  { x: 270, z: 2282, r: 7, floor: 11.5, padK: 0.55 },
  { x: 487, z: 2356, r: 6, floor: 9.5, padK: 0.55 },
  // the Moltenmaw: an open lava-lake field east of the caldera. The big eye
  // sits at (423, 2347) so its whole model footprint (r * 1.15) stays clear
  // of the Drakemaw escape bench ring (benchFade 23 from the vent), whose
  // every-azimuth dry-shore guarantee is pinned by tests/terrain_escape.
  { x: 423, z: 2347, r: 16, floor: -1.2 },
  { x: 438, z: 2326, r: 10, floor: -1.2 },
] as const;

function emberShapingOffset(x: number, z: number, seed: number): number {
  if (z < DRAKE_ZMIN - 10 || z > DRAKE_ZMAX + 40) return 0;
  if (x < STRIP_MAX_X - 30) return 0; // the waste lives in the east column
  let dh = 0;
  for (const v of EMBER_VOLCANOES) {
    const d = Math.hypot(x - v.x, z - v.z);
    if (d < v.r) {
      dh += v.h * (1 - smoothstep(v.r * 0.22, v.r, d));
      if (v.craterR > 0 && d < v.craterR * 1.5)
        dh -= v.craterD * (1 - smoothstep(v.craterR * 0.55, v.craterR * 1.5, d));
    }
  }
  // long low dune ridges across the open waste (stretched noise, north only)
  const duneT =
    smoothstep(2000, 2140, z) *
    (1 - smoothstep(2310, 2370, z)) *
    smoothstep(STRIP_MAX_X - 4, STRIP_MAX_X + 26, x);
  if (duneT > 0) dh += (fbm2(x * 0.018, z * 0.085, seed + 41, 2) - 0.5) * 5 * duneT;
  return dh;
}

// The Drakemaw's escapable vent: the caldera wall climbs past the movement
// gate at every azimuth and the melt pool used to fill the vent floor wall
// to wall, so anyone dropping in was stranded standing IN the rendered lava
// (the player report: three stranded attempts, and the world's ONLY closed
// basin in the trap scan). Two shapes fix it together, and both must stay
// above the rendered melt surface (pool floor + 0.9, see
// src/render/ember_features.ts), or the "dry" ground reads as lava and no
// player will walk it:
// - a flat SHORE BENCH ringing the melt eye, so every landing spot around
//   the pool is dry rock with a gentle wade-out ramp from the melt, and
// - an old outflow GORGE cutting the south face, a walkable 0.5 rise/run
//   descent from the bench down to the open waste (volcanoes breach; the
//   melt had to go somewhere). The bench sits above the melt, so the pool
//   never drains into it.
// Both pull terrain TO their target (never only downward): a raise-and-cut
// makes the shore and channel floors deterministic, with no one-way dips
// where the old lip crossed the mouth. tests/terrain_escape.test.ts walks
// a real player from the reported stranding spot around the ring and out.
const DRAKEMAW_ESCAPE = {
  x: 390,
  z: 2320,
  benchH: 13.4, // 0.5 above the rendered melt surface (12 + 0.9)
  benchIn: 8, // wade-out ramp from the melt eye starts here...
  benchFull: 10.6, // ...and reaches the dry bench height here
  benchOut: 18, // bench ends; the crater wall (or the gorge) takes over
  benchFade: 23, // wall-side fade end: steps stay under the climb gate
  // the gorge: due south, out the crater's low approach
  angle: -Math.PI / 2,
  slope: 0.5,
  floorH: 5.4, // the south plain's height: the channel grades onto it, never below
  endR: 54,
} as const;
function applyDrakemawEscape(x: number, z: number, h: number): number {
  const b = DRAKEMAW_ESCAPE;
  const dx = x - b.x;
  const dz = z - b.z;
  const d = Math.hypot(dx, dz);
  let out = h;
  // the shore bench ring
  if (d > b.benchIn && d < b.benchFade) {
    const w = smoothstep(b.benchIn, b.benchFull, d) * (1 - smoothstep(b.benchOut, b.benchFade, d));
    out = out + (b.benchH - out) * w;
  }
  // the outflow gorge, in corridor coordinates along the south ray: a
  // constant-width channel (perpendicular distance, not a widening cone)
  // so the mouth is a real walkable gate, not a slit
  const along = dx * Math.cos(b.angle) + dz * Math.sin(b.angle);
  const perp = Math.abs(dx * Math.sin(b.angle) - dz * Math.cos(b.angle));
  if (along >= b.benchFull && along <= b.endR && perp <= 8) {
    const wedge =
      (1 - smoothstep(4, 8, perp)) *
      smoothstep(b.benchFull, b.benchOut, along) *
      (1 - smoothstep(b.endR - 8, b.endR, along));
    if (wedge > 0) {
      // flat at bench height across the mouth, then the 0.5 rise/run descent
      const ramp = Math.max(b.benchH - b.slope * Math.max(0, along - b.benchOut), b.floorH);
      out = out + (ramp - out) * wedge;
    }
  }
  return out;
}

// The east cone's breach: a shallow melt-notch cut southwest through its
// crater rim, the walkable way out (the Drakemaw gorge idiom scaled down;
// an unbreached crater is a foot trap, and this cone's old seaward breach
// was an accident of the coast carve). The notch floor starts above the
// rendered melt surface so the pool never drains through it.
const EAST_CONE_BREACH = {
  x: 487,
  z: 2356,
  angle: Math.atan2(-25.1, -16.4), // toward the open waste at (470, 2331)
  startH: 10.4,
  slope: 0.55,
  floorH: 3.0,
  endR: 30,
} as const;
function applyEastConeBreach(x: number, z: number, h: number): number {
  const b = EAST_CONE_BREACH;
  const dx = x - b.x;
  const dz = z - b.z;
  if (Math.abs(dx) > b.endR + 8 || Math.abs(dz) > b.endR + 8) return h;
  const along = dx * Math.cos(b.angle) + dz * Math.sin(b.angle);
  const perp = Math.abs(dx * Math.sin(b.angle) - dz * Math.cos(b.angle));
  if (along < 2 || along > b.endR || perp > 5.5) return h;
  const wedge =
    (1 - smoothstep(2.5, 5.5, perp)) *
    smoothstep(2, 6, along) *
    (1 - smoothstep(b.endR - 6, b.endR, along));
  if (wedge <= 0) return h;
  const ramp = Math.max(b.startH - b.slope * Math.max(0, along - 5), b.floorH);
  return h + (ramp - h) * wedge;
}

// The Glacier Tarn's shore ramp: the one authored way in and out of the tarn
// bowl on foot. The tarn is the merged carve of two declared lakes (the tarn
// and its northern finger, src/sim/content/frostveil.ts), and the frost
// benches terrace the rim 10 to 25yd above the pond, so a player who jumped
// in was stranded on the sandy floor with the Rime Elementals' beach camp for
// company (the player report, world (42, 1642)). The tarn's WEST flank is the
// shallowest and is already the designed approach: the Icemantle road comes
// down to the "Glacier Tarn shore" waypoint at (42, 1626) and runs north past
// the rim, so the terracing is suppressed there and the natural flank was
// already close to walkable. It failed on a two-yard band at the waterline,
// where the carve's organic shore wobble spiked the gradient past the climb
// gate. This grades that flank into one straight slipway from the tarn's
// shallows up onto the road bench: the target height is linear along the
// segment (a constant rise/run well under the gate), it starts BELOW the
// waterline so a swimmer meets it, and it cuts at most about 1.7yd into the
// shoulder, so the terraced bowl keeps its shape and the elemental camp on
// the far shore is untouched.
//
// It runs LAST, after applyLakeShoreGrading, so the heights below are the
// FINISHED ones a player stands on (the shore grading rescales the waterline
// band and drops everything above it by about 1.4yd, so a ramp authored
// upstream of it would land well below the bench it is supposed to meet).
// tests/frostveil_pit_escape.test.ts walks a real player out of the reported
// stranding spot and back down again.
export const GLACIER_TARN_RAMP = {
  ax: 48.5, // the foot, out in the tarn's shallows...
  az: 1640.5,
  ah: -7, // ...below the waterline, on the natural bed height
  bx: 34, // the top, on the road bench above the rim...
  bz: 1640,
  bh: 3, // ...at the bench's own height, so the tie-in has no seam
  wIn: 3, // the walkable channel's half-width...
  wOut: 8.5, // ...easing back to the untouched flank here
} as const;
// The capsule's bounding box, derived so it can never drift from the record:
// this applier is on the hot path for EVERY height sample in the world.
const TARN_RAMP_BOUNDS = {
  x0: Math.min(GLACIER_TARN_RAMP.ax, GLACIER_TARN_RAMP.bx) - GLACIER_TARN_RAMP.wOut,
  x1: Math.max(GLACIER_TARN_RAMP.ax, GLACIER_TARN_RAMP.bx) + GLACIER_TARN_RAMP.wOut,
  z0: Math.min(GLACIER_TARN_RAMP.az, GLACIER_TARN_RAMP.bz) - GLACIER_TARN_RAMP.wOut,
  z1: Math.max(GLACIER_TARN_RAMP.az, GLACIER_TARN_RAMP.bz) + GLACIER_TARN_RAMP.wOut,
} as const;

// The ramp itself: a capsule stamp (the cove-apron idiom used on the Hollow's
// northeast shore walk). The target height runs linearly along the segment,
// full strength inside the channel half-width and easing back to the natural
// flank by wOut, so the cut has no lip at either end and no lateral step.
function applyGlacierTarnRamp(x: number, z: number, h: number): number {
  const b = TARN_RAMP_BOUNDS;
  if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return h;
  const r = GLACIER_TARN_RAMP;
  const dx = r.bx - r.ax;
  const dz = r.bz - r.az;
  const t = Math.max(0, Math.min(1, ((x - r.ax) * dx + (z - r.az) * dz) / (dx * dx + dz * dz)));
  const d = Math.hypot(x - (r.ax + dx * t), z - (r.az + dz * t));
  if (d >= r.wOut) return h;
  const natural = smoothstep(r.wIn, r.wOut, d); // 0 on the channel floor, 1 off it
  return h * natural + lerp(r.ah, r.bh, t) * (1 - natural);
}

// The modeled lava network's ground (render/ember_features.ts): the pool
// records, link topology, and meander curves live in the shared leaf
// src/sim/ember_lava_layout.ts, and this applier grades terrain to them:
// a LEVEL pad flush under each pool model's whole footprint, a flat bed
// following each river link's actual meander, and a low moulded shoulder
// ringing both so the melt sits down IN the ground. Every rim parts where
// a channel crosses it (emberLinkDistanceNorm), and every slope stays
// gentle (rise/run well under the movement climb gate), so nothing strands
// a player inside the melt line.
function applyEmberLavaNetwork(x: number, z: number, h: number): number {
  if (z < DRAKE_ZMIN || z > DRAKE_ZMAX) return h;
  if (x < 260 || x > 480 || z < 2160 || z > 2360) return h; // network bbox
  let out = h;
  const linkNorm = emberLinkDistanceNorm(x, z);
  const rimGate = smoothstep(0.55, 1.15, linkNorm);
  for (const pool of EMBER_FLAT_POOLS) {
    const d = Math.hypot(x - pool.x, z - pool.z);
    const edge = pool.r * 1.15; // the model's rocky ring ends here
    if (d < edge + 7) {
      // flush pad under the whole model, easing back to open ground
      const w = 1 - smoothstep(edge, edge + 4.5, d);
      // the moulded shoulder just past the model edge (0.33 rise/run)
      const rim =
        1.5 *
        smoothstep(edge - 1, edge + 2, d) *
        (1 - smoothstep(edge + 2, edge + 6.5, d)) *
        rimGate;
      out = out + (pool.h - out) * w + rim;
    }
  }
  for (const link of EMBER_LAVA_LINKS) {
    const s = emberNearestOnLink(link, x, z);
    const half = link.w * 0.62; // the channel model overhangs its melt line
    if (s.dist < half + 6.5) {
      const w = 1 - smoothstep(half, half + 3.5, s.dist);
      // low banks shouldering the channel, parted at every pool mouth
      const bankGate = smoothstep(0.1, 0.55, poolDistanceNorm(x, z));
      const rim =
        1.2 *
        smoothstep(half - 0.5, half + 2, s.dist) *
        (1 - smoothstep(half + 2, half + 6, s.dist)) *
        bankGate;
      out = out + (s.h - out) * w + rim;
    }
  }
  return out;
}

// distance to the nearest pool edge (flat pools AND shaped basins),
// normalized by that pool's radius: river banks fade out near mouths
function poolDistanceNorm(x: number, z: number): number {
  let best = Infinity;
  for (const pool of EMBER_FLAT_POOLS) {
    best = Math.min(best, Math.hypot(x - pool.x, z - pool.z) / pool.r - 1.15);
  }
  for (const pool of EMBER_LAVA_POOLS) {
    best = Math.min(best, Math.hypot(x - pool.x, z - pool.z) / pool.r - 1.15);
  }
  return best;
}

// Real craters, carved after the cones: a raised rock lip rings each pool
// and the floor sinks genuinely below the surrounding ground, so the melt
// sits down INSIDE its bowl the way lake water does (the floors stay above
// WATER_LEVEL so the zone water plane never floods a vent). The flat floor
// runs out past the whole model footprint (r * 1.15) so the modeled rim
// rests on level ground even where the base terrain falls away (the coast
// side of the Moltenmaw used to drop out from under its pool), and the lip
// peaks OUTSIDE the model edge: the moulded shoulder players walk over.
function applyEmberLavaBasins(x: number, z: number, h: number): number {
  if (z < DRAKE_ZMIN || z > DRAKE_ZMAX) return h;
  let out = h;
  for (const pool of EMBER_LAVA_POOLS) {
    const d = Math.hypot(x - pool.x, z - pool.z);
    if (d < pool.r * 2.4) {
      const padK = (pool as { padK?: number }).padK ?? 0.95;
      const linkGate = smoothstep(0.55, 1.15, emberLinkDistanceNorm(x, z));
      // the lip: rises past the melt edge, falls away outward; it parts
      // where a modeled river link crosses it (normalized by that link's
      // width), so the melt flows in flush. Crater-nested pools
      // (padK < 0.9) keep the legacy tight lip the escape walkers are
      // tuned against; open basins take the outward moulded shoulder.
      const lip =
        padK < 0.9
          ? 2.4 *
            smoothstep(pool.r * 0.7, pool.r * 1.05, d) *
            (1 - smoothstep(pool.r * 1.05, pool.r * 2.2, d)) *
            linkGate
          : 2.4 *
            smoothstep(pool.r * 1.02, pool.r * 1.45, d) *
            (1 - smoothstep(pool.r * 1.45, pool.r * 2.4, d)) *
            linkGate;
      // the bowl: flat melt floor under the model, blending up to the lip
      // across a gentle walkable shoulder
      const blend = smoothstep(pool.r * padK, pool.r * (padK + 0.4), d);
      out = out * blend + pool.floor * (1 - blend) + lip;
    }
  }
  return out;
}

// The Last Keep's terraced grounds: the castle pads grade to their local
// target (the outer bailey floor, or the raised inner ward with its stair
// cuts; the plan lives in castle_layout.ts), with a gentle skirt back onto
// the midlands.
function applyCastlePad(x: number, z: number, h: number): number {
  const w = castlePadWeight(x, z);
  if (w <= 0) return h;
  return h + (castlePadTarget(x, z) - h) * w;
}

// The pad's northeast apron meets the Last Spring pool, and the pad yields to
// the pool over castlePadWeight's own ring: the bailey's level floor ends on an
// arc about 16yd out from the pool center and the ground then falls to the pool
// bed in about 5yd of run. That left a 1.85 rise/run face standing straight out
// of the water (tests/world_edge_coast.test.ts swept it on the drake east
// margin: 4.5 and 4.3yd per 2yd step at z 1990 and 1998).
//
// Grade the apron into the shore: fill the hollow between the arc and the water
// with a straight bank, so the pad's skirt reaches the pool as a shore slope
// instead of a lip (the near-shore band measures 1.58 rise/run after, 2.82
// before). Three properties keep the castle out of it:
//   - it RAISES ONLY, so no pad, courtyard, or grounds height can move down;
//   - its rim stops inside the castle's closest masonry (the northeast
//     bastion's outer face at x 440.2, 15.8yd from the pool center), so no
//     wall, bastion, ramp, or flank-trap seal is ever in its reach;
//   - its authority is the pad's OWN skirt (castleSkirtWeight), so the fill is
//     the skirt meeting the water and dies out around the pool's far shores,
//     which have no pad behind them and keep their natural bank.
// The bank line dives under the pool bed inside the shallows and rises above
// the natural apron outside it, so the fill releases to zero at both ends on
// its own: no window edge to seam (tests/terrain_window_seams.test.ts).
const LAST_SPRING_BANK = {
  /** the bank's outer rim, measured from the pool center (castle_layout) */
  rim: 15.5,
  /** the bank's height at the rim, just under the apron it meets there */
  rimH: 3.5,
  /** rise/run of the bank plane, under PLAYER_MAX_CLIMB_SLOPE (the apron
   *  ABOVE it is the pad's own yield ramp and stays as steep as it was) */
  slope: 1.4,
  /** the fill eases back to the natural apron over the last of the rim */
  ease: 1.5,
} as const;

function applyLastSpringBank(x: number, z: number, h: number): number {
  const b = LAST_SPRING_BANK;
  const dx = x - LAST_SPRING.x;
  const dz = z - LAST_SPRING.z;
  if (dx < -b.rim || dx > b.rim || dz < -b.rim || dz > b.rim) return h;
  const d = Math.hypot(dx, dz);
  if (d >= b.rim) return h;
  const target = b.rimH - b.slope * (b.rim - d);
  if (target <= h) return h; // raises only: the apron above the bank never moves
  const w = castleSkirtWeight(x, z) * (1 - smoothstep(b.rim - b.ease, b.rim, d));
  if (w <= 0) return h;
  return h + (target - h) * w;
}

// ---------------------------------------------------------------------------
// Signature landforms: one distinctive terrain idea per northern realm, so
// no two maps read alike. All of them yield to roads (every marked route
// stays a walkable pass) and are placed clear of hubs, lakes, and camps.
// ---------------------------------------------------------------------------

// The Veilspires: the Frostveil's central massif. The terrace applier below
// steps its flanks into benched paths; the plateau tables are cut flat at
// the end of terrainHeight (mesa-style, after the rims).
const FROST_MASSIF = [
  { x: -6, z: 1710, r: 46, h: 24 }, // the south spire, over the road fork
  { x: -40, z: 1810, r: 46, h: 28 }, // the crown massif
  { x: 30, z: 1870, r: 44, h: 22 }, // the north spire at the pass road
  { x: 66, z: 1720, r: 40, h: 18 }, // the east shoulder above the tarn
] as const;
const FROST_PLATEAUS = [
  { x: -18, z: 1752, r: 20, h: 12 }, // the low shelf
  { x: -2, z: 1786, r: 15, h: 19 }, // the mid shelf
  { x: -26, z: 1820, r: 12, h: 26 }, // the crown table
] as const;
function frostMassifOffset(x: number, z: number): number {
  if (z < 1500 || z > FROST_ZMAX - 20) return 0;
  if (x < STRIP_MIN_X + 4 || x > STRIP_MAX_X - 4) return 0; // the Reach holds the strip's center
  let dh = 0;
  for (const m of FROST_MASSIF) {
    const d = Math.hypot(x - m.x, z - m.z);
    if (d < m.r) dh += m.h * (1 - smoothstep(m.r * 0.3, m.r, d));
  }
  if (dh <= 0) return 0;
  // roads pierce the range as valley passes
  return dh * smoothstep(7, 16, roadDistance(x, z));
}

// The Golden Shelf: the Amberfall's raised northeast tableland, an amber
// escarpment overlooking the Great Mere.
const AMBER_SHELF = [
  { x: -236, z: 1960, r: 55, h: 13 },
  { x: -264, z: 1896, r: 42, h: 9 },
  { x: -220, z: 2050, r: 48, h: 11 },
] as const;
function amberShelfOffset(x: number, z: number): number {
  if (z < 1860 || z > 2160) return 0;
  let dh = 0;
  for (const m of AMBER_SHELF) {
    const d = Math.hypot(x - m.x, z - m.z);
    if (d < m.r) dh += m.h * (1 - smoothstep(m.r * 0.35, m.r, d));
  }
  if (dh <= 0) return 0;
  return dh * smoothstep(7, 16, roadDistance(x, z));
}

// The Dreamer's Bowl: the Nightbloom's caldera. A climbable ring with a
// notch entrance on its road-facing side, a sunken dream-meadow floor, and
// a knoll at the very center.
const BOWL_X = -300;
const BOWL_Z = 1600;
function nightCalderaOffset(x: number, z: number): number {
  const d = Math.hypot(x - BOWL_X, z - BOWL_Z);
  if (d > 68) return 0;
  // the ring: a rounded rampart at radius 40, tall enough that its crest
  // takes the night biome's violet crag tint on the map (h > 20) instead
  // of reading as mid-slope rock
  const ring = 17 * (1 - smoothstep(0, 18, Math.abs(d - 40)));
  // the notch: the rampart parts on the southwest, toward Moonrest's road
  const ang = Math.atan2(x - BOWL_X, z - BOWL_Z);
  const notch = 1 - smoothstep(0.28, 0.62, Math.abs(ang + 2.3));
  // the floor: the bowl sinks gently inside the ring
  const bowl = -3.5 * (1 - smoothstep(10, 34, d));
  // the knoll: the dream stands centered
  const knoll = 7 * (1 - smoothstep(0, 10, d));
  // a gentle pedestal lifts the whole formation, so the rampart's crest
  // clears the caret and crag bands all the way around the circle
  const pedestal = 4 * (1 - smoothstep(30, 58, d));
  return ring * (1 - notch) + bowl + knoll + pedestal;
}

// The Firemount: the Palmreach's volcano, a climbable cone over the deep
// jungle with a cupped summit crater.
const CONE_X = -344;
const CONE_Z = 1002;
function palmConeOffset(x: number, z: number): number {
  const d = Math.hypot(x - CONE_X, z - CONE_Z);
  if (d > 36) return 0;
  // crest ~25: above the map's crown stipple (22) so the summit reads as
  // bare volcanic rock and carets, below the snow-cap band (26)
  const cone = 22 * (1 - smoothstep(4, 32, d));
  const crater = -8 * (1 - smoothstep(0, 9, d));
  return (cone + crater) * smoothstep(7, 14, roadDistance(x, z));
}

// The Braids: the Willowfen's east water-meadows dissolve into winding
// channels and grassy islets. Channels follow the valleys of a ridged
// noise field; roads, the hub, camps (which flattened first), and the
// border pass caps are all left dry.
function applyFenBraids(x: number, z: number, h: number): number {
  if (z < 240 || z > 620 || x < -380 || x > STRIP_MIN_X - 4) return h;
  if (h < WATER_LEVEL + 0.5 || h > 5.5) return h;
  const ridge = Math.abs(fbm2(x * 0.021, z * 0.021, 9301, 3) - 0.5) * 2;
  let channel = 1 - smoothstep(0.05, 0.17, ridge);
  if (channel <= 0) return h;
  // feathered region edges: a hard gate would print a straight hillshade
  // seam across the fen
  channel *= smoothstep(-380, -356, x) * (1 - smoothstep(STRIP_MIN_X - 30, STRIP_MIN_X - 6, x));
  channel *= smoothstep(240, 275, z) * (1 - smoothstep(585, 620, z));
  const roadGate = smoothstep(8, 15, roadDistance(x, z));
  let campGate = 1;
  for (const camp of CAMPS) {
    if (camp.center.z < 200 || camp.center.z > 660) continue;
    const d = Math.hypot(x - camp.center.x, z - camp.center.z);
    campGate = Math.min(campGate, smoothstep(camp.radius * 1.6, camp.radius * 2.4, d));
  }
  const depth = (WATER_LEVEL - 1.4 - h) * channel * roadGate * campGate;
  return depth < 0 ? h + depth : h;
}

// The Frostveil's terraced benches: the whole massif steps into flats,
// ramps, and short steep risers (multi-level mountain ground). Suppressed
// near roads so every marked route stays climbable, and below the shore
// line so beaches ease into the sea.
function applyFrostTerraces(x: number, z: number, h: number): number {
  if (z <= 1460 || z > FROST_ZMAX) return h;
  if (x < STRIP_MIN_X + 2 || x > STRIP_MAX_X - 2) return h; // the benches stay in the strip
  if (Math.abs(z - 1890) < 34 && Math.abs(x) > 92) return h; // the crossings' corridors stay smooth
  if (h < WATER_LEVEL + 2) return h;
  const road = roadDistance(x, z);
  if (road < 5) return h;
  // Every band and corridor edge above is matched by a smooth fade below, so
  // the terracing eases in and out instead of switching on along a straight
  // line: the old hard edges left knee-high step walls running the width of
  // the realm at z = 1460 and around the crossing corridors at z = 1856,
  // z = 1924, and x = +-92 (tests/terrain_window_seams.test.ts).
  const zBand = smoothstep(1460, 1476, z) * (1 - smoothstep(FROST_ZMAX - 16, FROST_ZMAX, z));
  const xBand =
    smoothstep(STRIP_MIN_X + 2, STRIP_MIN_X + 18, x) *
    (1 - smoothstep(STRIP_MAX_X - 18, STRIP_MAX_X - 2, x));
  const corridor = (1 - smoothstep(34, 46, Math.abs(z - 1890))) * smoothstep(80, 92, Math.abs(x));
  const step = 6.5;
  const jit = (noise2(x * 0.045, z * 0.045, 88) - 0.5) * 3.4;
  const hh = h + jit;
  const base = Math.floor(hh / step) * step;
  const frac = (hh - base) / step;
  const ledge = base + step * Math.min(1, Math.max(0, (frac - 0.26) / 0.42));
  const w =
    0.55 *
    smoothstep(WATER_LEVEL + 2, WATER_LEVEL + 5.5, h) *
    smoothstep(5, 12, road) *
    zBand *
    xBand *
    (1 - corridor);
  return h + (ledge - h) * w;
}

// The continent's interior border meres: the landlocked lakes between the
// realms' corner caps, one basin span per interior border. Ocean rules
// (swim fatigue, rim suppression) must never treat them as open sea.
const BORDER_LAKES = [
  // the Hollow's moats: the border ribbon itself is a swimmable mere, but
  // the rects stay narrow so the wider water past them keeps the classic
  // swim-fatigue turnback (the Hollow stays a place you arrive at on
  // purpose, not by drifting)
  { x0: 168, x1: 212, z0: 950, z1: 1450 }, // the east moat
  { x0: -212, x1: -168, z0: 950, z1: 1450 }, // the west moat
  { x0: 136, x1: 224, z0: 1450, z1: 1935 }, // the Veilmelt, with the Snowline's isthmus
  { x0: -224, x1: -136, z0: 1450, z1: 1935 }, // the Palewater, with the Goldmelt's isthmus
  // (the six row-border waters between the column realms open westward or
  // eastward into the outer sea as natural inlets, so they are NOT listed:
  // their mouths keep the ocean rules)
] as const;
export function inBorderLake(x: number, z: number): boolean {
  for (const l of BORDER_LAKES) {
    if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1) return true;
  }
  return false;
}

// Every programmatic border water where two maps meet, as generous rects: the
// moat/melt sections above, the column straits with their Hollow-side scallop
// coves, and the row meres. These are REAL water to the sim (isInWaterBody),
// the same as a declared lake: players swim them, the movement kernel rides
// their surface, border ridges break across them, and their banks take the
// shore grading. Generous bounds are safe because every consumer self-gates
// on the real carved depth: a dry isthmus or bank inside a rect never swims,
// never clamps a slope, and never blocks a walker.
const BORDER_WATERS: readonly { x0: number; x1: number; z0: number; z1: number }[] = [
  ...BORDER_LAKES,
  // half-width 48 covers the channel, the Hollow-side scallop coves, and the
  // full beach-ramp aprons (borderBankRamp releases by ~40yd), so both banks
  // sit fully inside (full grading + ridge gate) out to dry land
  ...COLUMN_STRAITS.map((st) => ({
    x0: st.borderX - 48,
    x1: st.borderX + 48,
    z0: st.lakeLo - 4,
    z1: st.lakeHi + 4,
  })),
  // z half-width 20: the carve wets |z - borderZ| <= ~10 and the beach ramp
  // can hold water to ~19, so both banks stay fully inside
  ...ROW_MERES.map((m) => ({ x0: m.xLo, x1: m.xHi, z0: m.borderZ - 20, z1: m.borderZ + 20 })),
];

// The border ridges break only over the water they actually cross: the moat
// sections, the straits' channel and OUTER bank (the neighbor realm's flank,
// where the beach ramp runs), and the meres. The straits' INNER flank keeps
// its full range: the Hollow's authored headland fixtures (ruin rings, POIs)
// stand on that ridge, and the scallop coves between them are the designed
// inner exits.
const RIDGE_BREAK_WATERS: readonly { x0: number; x1: number; z0: number; z1: number }[] = [
  ...BORDER_LAKES,
  // inner reach 14 opens the inner lip for entry, EXCEPT across the two
  // Tablecrag mesa guards (z windows below): their foot-approach ramps are
  // the ridge flank itself, so the gate narrows to the channel core there.
  // The Hollow's other headland fixtures sit beyond 14yd and keep their
  // ridge either way; the scallop coves stay the designed inner exits.
  ...COLUMN_STRAITS.flatMap((st) => {
    const inner = (reach: number): number =>
      st.borderX > 0 ? st.borderX - reach : st.borderX + reach;
    const outer = st.borderX > 0 ? st.borderX + 48 : st.borderX - 48;
    const rect = (z0: number, z1: number, reach: number) => ({
      x0: Math.min(outer, inner(reach)),
      x1: Math.max(outer, inner(reach)),
      z0,
      z1,
    });
    if (st.borderX > 0) {
      // east strait: no mesas on this flank
      return [rect(st.lakeLo - 4, st.lakeHi + 4, 14)];
    }
    // west strait: segment around the Tablecrag mesas at z 1072 and 1195
    return [
      rect(st.lakeLo - 4, 1040, 14),
      rect(1040, 1105, 8),
      rect(1105, 1160, 14),
      rect(1160, 1230, 8),
      rect(1230, st.lakeHi + 4, 14),
    ];
  }),
  ...ROW_MERES.map((m) => ({ x0: m.xLo, x1: m.xHi, z0: m.borderZ - 20, z1: m.borderZ + 20 })),
];

// Distance to the nearest rect of a border-water list: 0 inside one, the
// outside clearance otherwise. Shared by the water test (=== 0), the ridge
// gate, and the shore grading fade.
function borderWaterOutsideDist(
  x: number,
  z: number,
  rects: readonly { x0: number; x1: number; z0: number; z1: number }[],
): number {
  let best = Infinity;
  for (const r of rects) {
    const dx = Math.max(r.x0 - x, 0, x - r.x1);
    const dz = Math.max(r.z0 - z, 0, z - r.z1);
    if (dx === 0 && dz === 0) return 0;
    // one axis is usually 0 (beside an edge): skip the hypot there
    const d = dx === 0 ? dz : dz === 0 ? dx : Math.hypot(dx, dz);
    if (d < best) best = d;
  }
  return best;
}

// Boolean-only rect scan (no distances): this sits inside isInWaterBody,
// which the movement kernel queries several times per tick.
export function inBorderWater(x: number, z: number): boolean {
  for (const r of BORDER_WATERS) {
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
  }
  return false;
}

// The fatigue-free CROSSING CORRIDORS: the moat/melt rects, the meres, and
// the straits' channel plus outer approach. Deliberately NOT the straits'
// inner scallop reach: the Hollow's wider inner water keeps the open-sea
// fatigue turnback ("a place you arrive at on purpose, not by drifting",
// pinned by tests/world_grid.test.ts), and a cove landing from the channel
// is a few seconds' swim, inside the fatigue grace.
const FATIGUE_FREE_WATERS: readonly { x0: number; x1: number; z0: number; z1: number }[] = [
  ...BORDER_LAKES,
  ...COLUMN_STRAITS.map((st) => ({
    x0: st.borderX > 0 ? st.borderX - 14 : st.borderX - 48,
    x1: st.borderX > 0 ? st.borderX + 48 : st.borderX + 14,
    z0: st.lakeLo - 4,
    z1: st.lakeHi + 4,
  })),
  ...ROW_MERES.map((m) => ({ x0: m.xLo, x1: m.xHi, z0: m.borderZ - 20, z1: m.borderZ + 20 })),
];

export function inFatigueFreeWater(x: number, z: number): boolean {
  for (const r of FATIGUE_FREE_WATERS) {
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
  }
  return false;
}

// The northern realms' open sea (swim fatigue + rim suppression): far enough
// offshore that no land lobe reaches, near a true map border edge. The
// Hollow's north edge stopped being a border when the Drakelands landed
// beyond it, so only the x flanks bite there now; the Frostveil's far north
// is the world's actual end again.
export function inHollowOpenSea(x: number, z: number): boolean {
  if (x > DUNGEON_X_THRESHOLD) return false;
  // the Mirrorshallow: enclosed lake water, never open sea
  if (Math.hypot(x - 152, z - 1112) < 42) return false;
  // every designed crossing corridor (the moats, the straits' channel and
  // outer approach, the row meres) is a CROSSING, never open sea: swim
  // fatigue must not kill a player mid-crossing between two realms. Fatigue
  // resumes past the corridors (the mere mouths into the outer sea, the
  // Hollow's wider inner water), so the containment lines hold.
  if (inFatigueFreeWater(x, z)) return false;
  const seaXb = worldXBoundsAt(z);
  if (z < 180) {
    // the starter sea: open water past the vale's and the island's organic
    // shores carries the fatigue turnback. The Ferrywalk sandbar is land you
    // walk, never open sea.
    if (Math.abs(x) > 620 || z < -215) return false; // the far void keeps legacy rules
    if (onCauseway(x, z)) return false;
    return valeLandness(x, z) < 0.02 && isleLandness(x, z) < 0.02;
  }
  if (z <= 960) {
    // the columns' southern outer coasts: open ocean to the world edge
    // (the strip center sits hundreds of yards from the row bounds here,
    // so this only ever bites the fen, gale, jungle, and garden flanks)
    const dRim = Math.min(x - seaXb.min, seaXb.max - x);
    return (
      dRim < 48 &&
      Math.max(fenLandness(x, z), galeLandness(x, z), reachLandness(x, z), gardenLandness(x, z)) <
        0.02
    );
  }
  if (z <= HOLLOW_ZMAX + 2) {
    // the moat: within reach of the sealed realm's OWN rect edges, open
    // water stays open sea however wide the row has grown, so no swimmer
    // slips into the Hollow sideways around the wall; the columns' outer
    // flanks keep the classic world-edge rule
    const dMoat = Math.min(x - STRIP_MIN_X, STRIP_MAX_X - x);
    const dRim = Math.min(x - seaXb.min, seaXb.max - x);
    if (dMoat >= 48 && dRim >= 48) return false;
    return (
      Math.max(
        hollowLandness(x, z),
        gardenLandness(x, z),
        reachLandness(x, z),
        woodLandness(x, z),
        nightLandness(x, z),
      ) < 0.02
    );
  }
  if (z <= FROST_ZMAX + 2) {
    const dMoat = Math.min(x - STRIP_MIN_X, STRIP_MAX_X - x);
    const dRim = Math.min(x - seaXb.min, seaXb.max - x);
    if (dMoat >= 48 && dRim >= 48) return false;
    return (
      Math.max(
        frostLandness(x, z),
        woodLandness(x, z),
        nightLandness(x, z),
        emberLandness(x, z),
        amberLandness(x, z),
      ) < 0.02
    );
  }
  if (z <= DRAKE_ZMAX + 2) {
    // the north bay between the columns' shoulders, and their outer flanks
    if (Math.abs(x) < 188) {
      return Math.max(frostLandness(x, z), emberLandness(x, z), amberLandness(x, z)) < 0.02;
    }
    const dRim = Math.min(x - seaXb.min, seaXb.max - x);
    return dRim < 48 && Math.max(emberLandness(x, z), amberLandness(x, z)) < 0.02;
  }
  return false;
}

// Border pockets the mountain fringe must not swallow.
function hollowShapingOffset(x: number, z: number, _seed: number): number {
  if (z < 905 || z > HOLLOW_ZMAX) return 0;
  if (x < STRIP_MIN_X - 20 || x > STRIP_MAX_X + 20) return 0; // strip only
  let dh = 0;
  for (const f of HOLLOW_SHAPING) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < f.r) dh += f.h * (1 - smoothstep(f.r * 0.35, f.r, d));
  }
  // The x-flanks are natural coast now, not a mountain ring: the Hollow's land
  // simply slopes into the moat (the coast applier and the moat's scalloped
  // banks do the shaping), so its shores read as an organic coastline rather
  // than a walled bowl. Only the interior HOLLOW_SHAPING landforms remain.
  return dh;
}

export const MIREFEN_IMPACT_CRATER = {
  x: 149.5,
  z: 295,
  bowlRadius: 20,
  radius: 30,
  depth: 2.6,
  rimHeight: 0.95,
} as const;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Pure pass mask used by border ridges. Exported for the performance invariant
// test: a zero mask makes the skipped crest-noise contribution exactly +0.
export function ridgePassWeight(distanceFromPass: number): number {
  return smoothstep(PASS_HALF_WIDTH, PASS_SHOULDER, Math.abs(distanceFromPass));
}

// North-rim profile for the multi-row world. The rim can wander at most 23yd
// south of its nominal onset, so every point at or below this bound is provably
// outside it. Returning before the two fbm2 calls preserves the exact +0 result.
export function northRimWeight(x: number, z: number): number {
  if (z <= WORLD_MAX_Z - 53) return 0;
  const wobble = (fbm2(x * 0.008, 60.1, 9207, 2) - 0.5) * 46;
  return (
    smoothstep(WORLD_MAX_Z - 30 + wobble, WORLD_MAX_Z + wobble, z) *
    (0.32 + 0.68 * fbm2(x * 0.013, 60.2, 9209, 2))
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mirefenImpactCraterOffset(x: number, z: number): number {
  const dx = x - MIREFEN_IMPACT_CRATER.x;
  const dz = z - MIREFEN_IMPACT_CRATER.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= MIREFEN_IMPACT_CRATER.radius) return 0;

  const bowlT = d / MIREFEN_IMPACT_CRATER.bowlRadius;
  const bowl =
    d < MIREFEN_IMPACT_CRATER.bowlRadius
      ? -MIREFEN_IMPACT_CRATER.depth * (1 - smoothstep(0, 1, bowlT))
      : 0;

  const rimStart = MIREFEN_IMPACT_CRATER.bowlRadius * 0.82;
  if (d <= rimStart) return bowl;
  const rimT = (d - rimStart) / (MIREFEN_IMPACT_CRATER.radius - rimStart);
  const rim =
    MIREFEN_IMPACT_CRATER.rimHeight * smoothstep(0, 0.35, rimT) * (1 - smoothstep(0.72, 1, rimT));
  return bowl + rim;
}

const TERRAIN_CAMP_BOUNDS = CAMPS.map((camp) => {
  const reach = camp.radius * 1.8 + 1;
  return {
    minX: camp.center.x - reach,
    maxX: camp.center.x + reach,
    minZ: camp.center.z - reach,
    maxZ: camp.center.z + reach,
  };
});
const TERRAIN_HUB_BOUNDS = ZONES.map((zone) => {
  const reach = zone.hub.radius * 1.6 + 1;
  return {
    minX: zone.hub.x - reach,
    maxX: zone.hub.x + reach,
    minZ: zone.hub.z - reach,
    maxZ: zone.hub.z + reach,
  };
});

let terrainRegionGeneration = -1;
let terrainRegionIndex: TerrainRegionIndex | null = null;

function terrainRegionAt(x: number, z: number): TerrainRegionCell {
  const generation = getContentGeneration();
  if (terrainRegionIndex === null || terrainRegionGeneration !== generation) {
    terrainRegionIndex = buildTerrainRegionIndex({
      applierBounds: TERRAIN_APPLIER_BOUNDS,
      campBounds: TERRAIN_CAMP_BOUNDS,
      hubBounds: TERRAIN_HUB_BOUNDS,
    });
    terrainRegionGeneration = generation;
  }
  return terrainRegionCellAt(terrainRegionIndex, x, z);
}

// Exposed for the performance invariant test. This reads the exact cached
// cell terrainHeightUnpadded consumes, so a full-scan regression is visible
// without putting timing assertions in Vitest.
export function terrainRegionCandidateCountsAt(
  x: number,
  z: number,
): { appliers: number; camps: number; hubs: number } {
  const region = terrainRegionAt(x, z);
  let appliers = 0;
  for (let id = 0; id < TERRAIN_APPLIER_BOUNDS.length; id++) {
    if (terrainRegionHas(region, id)) appliers++;
  }
  return {
    appliers,
    camps: region.campIndices.length,
    hubs: region.hubIndices.length,
  };
}

// Blended biome shape at a position. Zone interiors keep their exact shape;
// blends happen across the same -30/+35yd windows at every border: the
// strip's band boundaries cascade by z as they always did, and column zones
// blend in sideways (columnBlendAt), so an east map's hills arrive across
// its border pass exactly like a northern realm's do.
const shapeScratch = { hill: 0, base: 0 };

function shapeAt(x: number, z: number): { hill: number; base: number } {
  let hill = BIOME_SHAPE[STRIP_ZONES[0].biome].hill;
  let base = BIOME_SHAPE[STRIP_ZONES[0].biome].base;
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const boundary = STRIP_ZONES[i].zMax;
    const t = smoothstep(boundary - 30, boundary + 35, z);
    const next = BIOME_SHAPE[STRIP_ZONES[i + 1].biome];
    hill = lerp(hill, next.hill, t);
    base = lerp(base, next.base, t);
  }
  for (const col of COLUMN_ZONES) {
    const t = columnBlendAt(col, x, z);
    if (t <= 0) continue;
    const shape = BIOME_SHAPE[col.biome];
    hill = lerp(hill, shape.hill, t);
    base = lerp(base, shape.base, t);
  }
  // baseHeight is the only caller and reads both fields before any nested
  // terrain sample, so the shared result is never retained across a reuse.
  shapeScratch.hill = hill;
  shapeScratch.base = base;
  return shapeScratch;
}

function baseHeight(
  x: number,
  z: number,
  seed: number,
  region: TerrainRegionCell = terrainRegionAt(x, z),
): number {
  const shape = shapeAt(x, z);
  let h =
    (fbm2(x * HILL_SCALE + 100, z * HILL_SCALE + 100, seed, 4) - 0.5) * shape.hill + shape.base;
  h += (fbm2(x * DETAIL_SCALE, z * DETAIL_SCALE, seed + 7, 2) - 0.5) * 2.2;
  // Flatten each zone's hub settlement into a plateau
  // A hub omitted by the coarse index is outside its complete squared gate
  // plus a full guard cell, so skipping it is a bit-identical no-op.
  for (const zoneIndex of region.hubIndices) {
    const zone = ZONES[zoneIndex];
    const dx = x - zone.hub.x,
      dz = z - zone.hub.z;
    // Conservative squared-distance gate (one spare yard of margin) before
    // the sqrt: a point past it can never pass the dHub < radius*1.6 test
    // below, so skipping it is bit-identical. This loop runs for EVERY
    // terrainHeight sample, and sqrt per zone per sample was real cost.
    const hubGate = zone.hub.radius * 1.6 + 1;
    if (dx * dx + dz * dz >= hubGate * hubGate) continue;
    const dHub = Math.sqrt(dx * dx + dz * dz);
    if (dHub < zone.hub.radius * 1.6) {
      const blend = smoothstep(zone.hub.radius * 0.7, zone.hub.radius * 1.6, dHub);
      h = h * blend + BIOME_SHAPE[zone.biome].hubHeight * (1 - blend);
    }
  }
  // Keep dry land everywhere: soft-floor low dips above the water level...
  const minLand = WATER_LEVEL + 1.4;
  if (h < minLand) h = minLand - (minLand - h) * 0.12;
  // ...except the carved lake basins. The ACTIVE content's lakes (the same
  // list isInWaterBody/waterLevelAt gate on; identical to the static table for
  // the builtin world), so a lake a content author declares always gets a real
  // basin under its water, never a water surface over uncarved ground.
  for (const zone of getActiveWorldContent().zones) {
    for (const lake of zone.lakes) {
      // Conservative squared-distance gate before the noise + sqrt: the shore
      // wobble is bounded by radius*0.225 (|noise2 - 0.5| <= 0.5), so a point
      // farther than radius*1.84 can never pass the dLake < radius*1.6 carve
      // test below. Skipping it is bit-identical, and it matters: the wobble
      // noise used to run for every lake in the WORLD on every height sample.
      const ldx = x - lake.x,
        ldz = z - lake.z;
      const lakeGate = lake.radius * 1.84;
      if (ldx * ldx + ldz * ldz >= lakeGate * lakeGate) continue;
      // organic shores: the carve distance wobbles with fixed-seed noise so
      // lakes read as real waterbodies instead of stamped discs. Northern
      // realms only (z > 900): the three original zones keep their exact
      // shorelines, and with them every seed-pinned fixture placed on them.
      const wob = lake.z > 900 ? (noise2(x * 0.12, z * 0.12, 9109) - 0.5) * lake.radius * 0.45 : 0;
      const dLake = Math.sqrt((x - lake.x) ** 2 + (z - lake.z) ** 2) + wob;
      if (dLake < lake.radius * 1.6) {
        const lakeBlend = smoothstep(lake.radius * 0.55, lake.radius * 1.6, dLake);
        h = h * lakeBlend + (WATER_LEVEL - 4) * (1 - lakeBlend);
      }
    }
  }
  return h;
}

// ---------------------------------------------------------------------------
// The custom-map edit layer (the sculpt brushes), applied to the height computed
// so far. Stamps apply in array order; pure data, no RNG, so the sim and renderer
// agree. `add` stamps add a falloff-weighted delta; `level` stamps pull the height
// toward the absolute height `delta` (flatten/plateau/terrace). The built-in world
// has no terrainEdits, so the heightfield is unchanged.
//
// Stamps are looked up through a coarse spatial bucket index (cell 32yd; each
// stamp registered in every cell its radius's bounding box touches) instead of a
// linear scan: the render chunk rebuilder samples the height 5x per vertex, so
// with the 4000-stamp cap the linear scan grows editor brush cost with session
// length. Determinism contract: candidates for a query point are iterated in
// ascending original array index (each bucket is built in index order and a stamp
// appears at most once per bucket), so float addition order is bit-identical to
// the linear scan. The index is a pure cache keyed by the terrainEdits array
// reference + length; it is rebuilt when either differs and cleared by
// invalidateTerrainEditIndex() for same-length in-place mutations.
// ---------------------------------------------------------------------------

const EDIT_INDEX_CELL = 32; // yards per bucket cell
// A stamp this large would touch an unbounded number of cells; index none and
// fall back to the (bit-identical) linear scan. The document sanitizer caps
// stamp radius at 200, so this only guards hostile in-memory content.
const EDIT_INDEX_MAX_RADIUS = 4096;

interface TerrainEditIndex {
  length: number;
  linear: boolean; // true = do not use buckets, scan the array
  buckets: Map<string, number[]>; // "cx,cz" -> ascending stamp indices
}

let terrainEditIndexCache = new WeakMap<HeightStamp[], TerrainEditIndex>();

// Clears the edit-layer index cache. The editor MUST call this after a
// splice-style in-place mutation that keeps the array reference and length
// (e.g. replacing a stamp); push/pop/reassignment are picked up automatically
// via the length + reference key. The exact export name is a contract with the
// editor lane: do not rename.
export function invalidateTerrainEditIndex(): void {
  terrainEditIndexCache = new WeakMap();
}

function buildTerrainEditIndex(edits: HeightStamp[]): TerrainEditIndex {
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (e.radius <= 0) continue; // the scan skips these too; no cell to register
    // A non-finite stamp (NaN poisons the scan; Infinity reaches everywhere)
    // or an absurd radius cannot be bucketed: reproduce the linear scan's
    // exact semantics by not indexing at all.
    if (
      !Number.isFinite(e.radius) ||
      e.radius > EDIT_INDEX_MAX_RADIUS ||
      !Number.isFinite(e.x) ||
      !Number.isFinite(e.z)
    ) {
      return { length: edits.length, linear: true, buckets: new Map() };
    }
    // One guard cell on every side: sqrt rounding can put a point with
    // d < radius up to ~1 ulp outside the bbox cells at an exact cell
    // boundary. Extra candidates are harmless (applyStamp re-checks d).
    const c0 = Math.floor((e.x - e.radius) / EDIT_INDEX_CELL) - 1;
    const c1 = Math.floor((e.x + e.radius) / EDIT_INDEX_CELL) + 1;
    const r0 = Math.floor((e.z - e.radius) / EDIT_INDEX_CELL) - 1;
    const r1 = Math.floor((e.z + e.radius) / EDIT_INDEX_CELL) + 1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = `${c},${r}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push(i); // outer loop is ascending i, so each bucket stays sorted
      }
    }
  }
  return { length: edits.length, linear: false, buckets };
}

// One stamp's contribution, shared verbatim by the indexed and linear paths so
// they are bit-identical.
function applyStamp(e: HeightStamp, x: number, z: number, h: number): number {
  if (e.radius <= 0) return h;
  const dx = x - e.x;
  const dz = z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= e.radius) return h;
  const t = d / e.radius; // 0 at centre, 1 at edge
  // 'flat' = full delta out to the edge; 'smooth' = eased taper to 0.
  const w = e.falloff === 'flat' ? 1 : 1 - smoothstep(0, 1, t);
  if (e.mode === 'level') return lerp(h, e.delta, w);
  return h + e.delta * w;
}

function applyEditLayer(x: number, z: number, h0: number): number {
  const edits = getActiveWorldContent().terrainEdits;
  if (!edits || edits.length === 0) return h0;
  let index = terrainEditIndexCache.get(edits);
  if (!index || index.length !== edits.length) {
    index = buildTerrainEditIndex(edits);
    terrainEditIndexCache.set(edits, index);
  }
  let h = h0;
  if (index.linear) {
    for (const e of edits) h = applyStamp(e, x, z, h);
    return h;
  }
  const key = `${Math.floor(x / EDIT_INDEX_CELL)},${Math.floor(z / EDIT_INDEX_CELL)}`;
  const bucket = index.buckets.get(key);
  if (!bucket) return h0;
  // Any stamp with d < radius has |x - e.x| < radius, so its bounding-box cells
  // cover the query cell: the bucket holds every contributing stamp, in
  // ascending array index, exactly once.
  for (const i of bucket) h = applyStamp(edits[i], x, z, h);
  return h;
}

// The Sowfield boarball ground (docs/prd/vale-cup.md): the southern Eastbrook
// basin leveled into a crisp rectangular plateau with a smoothstep apron ring.
// Blend weight of the flatten at (x, z): 1 inside the rectangle, easing to 0
// over SOWFIELD_FLAT.falloff yards outside it. Height stamps are circles-only,
// so like MIREFEN_IMPACT_CRATER this is a bespoke hand-authored arm; it applies
// for ANY active content. The apron's influence ends at z = SOWFIELD_FLAT.zMin -
// falloff (-149), north of the world rim's z = -150 onset, so the rim wall is
// untouched by construction (tests/terrain_walls.test.ts sweeps that band).
export function sowfieldFlattenWeight(x: number, z: number): number {
  const f = SOWFIELD_FLAT;
  const dx = Math.max(0, f.xMin - x, x - f.xMax);
  const dz = Math.max(0, f.zMin - z, z - f.zMax);
  if (dx === 0 && dz === 0) return 1;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= f.falloff) return 0;
  return 1 - smoothstep(0, 1, d / f.falloff);
}

// The Highwatch stables paddock plateau (STABLE_FLAT): the worked yard leveled
// to one height so the show-jumping course sits on fair, flat ground. The
// smooth apron keeps movement, collision, props, and terrain rendering on the
// same continuous heightfield.
export function stableFlattenWeight(x: number, z: number): number {
  const f = STABLE_FLAT;
  const dx = Math.max(0, f.x1 - x, x - f.x2);
  const dz = Math.max(0, f.z1 - z, z - f.z2);
  if (dx === 0 && dz === 0) return 1;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= f.falloff) return 0;
  return 1 - smoothstep(0, 1, d / f.falloff);
}

// The renderer seats each dock section relative to its shore anchor, then uses
// the plank top as a raised walkable surface. Return the matching absolute
// surface height, or -Infinity outside every deck footprint.
function dockSurfaceHeight(x: number, z: number, seed: number): number {
  // Wickharbor's stilt piers and boardwalk ride the same raised-surface arm
  // (an absolute plank plane, never a terrain lift; see sim/gale_harbor.ts).
  let surface = galeDeckSurface(
    x,
    z,
    (sampleX, sampleZ) => terrainHeight(sampleX, sampleZ, seed),
    WATER_LEVEL,
  );
  // ...and the Palmreach's river bridges and lagoon decks, the same idiom
  surface = Math.max(
    surface,
    reachDeckSurface(
      x,
      z,
      (sampleX, sampleZ) => terrainHeight(sampleX, sampleZ, seed),
      WATER_LEVEL,
    ),
  );
  for (const dock of getActiveWorldContent().props.docks) {
    const local = dockLocalPoint(dock, x, z);
    if (dockSectionAtLocal(local.x, local.z) < 0) continue;
    const line = dockSurfaceLine(dock, (sampleX, sampleZ) => terrainHeight(sampleX, sampleZ, seed));
    surface = Math.max(surface, dockSurfaceYAt(line, local.z));
  }
  return surface;
}

// ---------------------------------------------------------------------------
// Declared-lake grading: two arms that keep inland water escapable on foot
// (the terrain-side counterpart of the movement kernel's ride_height.ts).
// Both read the ACTIVE content's lakes (same footprints waterLevelAt gates
// on), so editor maps get the same guarantees as the builtin world.
// ---------------------------------------------------------------------------

// Non-sealed border ridges break where they cross a declared lake or a
// border water (moat, strait, row mere), the same reading the seaGate gives
// the open sea: where two maps meet across a waterway, the water simply
// continues and the seam bed stays an even, swimmable basin instead of a
// mountain range rising sheer from the channel. 1 on land, easing to 0 over
// the water. Sealed walls are never gated (their ridge and the
// crossesSealedBorder movement wall are the realm's hard boundary).
function lakeRidgeGateAt(x: number, z: number): number {
  // a tight fade: the beach ramps (borderBankRamp) own the bank softness, so
  // the ridge only needs to vanish over the water itself, and the straits'
  // inner-flank ridge (with its seed-pinned headland fixtures) stays intact
  let gate = smoothstep(0, 8, borderWaterOutsideDist(x, z, RIDGE_BREAK_WATERS));
  if (gate === 0) return 0;
  for (const zone of getActiveWorldContent().zones) {
    for (const lake of zone.lakes) {
      // hostile in-memory content: a degenerate radius must not gate anything
      // (the sanitizer clamps documents to [0.5, 200]; mirror the stamp guard)
      if (!Number.isFinite(lake.radius) || lake.radius <= 0) continue;
      // zero across the ENTIRE water disc (isInWaterBody reaches
      // LAKE_BLEND_RADIUS_MULT = 1.6R), rising to the full range on land
      // beyond, so no mountain flank ever stands inside the drawn water.
      const fadeIn = lake.radius * LAKE_BLEND_RADIUS_MULT;
      const fadeOut = lake.radius * 2.0;
      const dSq = (x - lake.x) ** 2 + (z - lake.z) ** 2;
      if (dSq >= fadeOut * fadeOut) continue;
      gate = Math.min(gate, smoothstep(fadeIn, fadeOut, Math.sqrt(dSq)));
      if (gate === 0) return 0;
    }
  }
  return gate;
}

// Gradual shores for every declared lake: compress the finished height
// profile in a band around the waterline so the slope a player wades through
// leaving the water (and the first bank above it) is always well under the
// climb limit. The map is anchored at the waterline (band(0) = 0), so every
// shoreline KEEPS ITS EXACT POSITION and every seed-pinned shore fixture
// holds; only the profile through the band gets flatter. Below the band the
// bed rises by a small constant (lakes stay swim-deep), above it the land
// inside the footprint settles by the same amount, easing to nothing past
// the footprint. Applied after ALL shaping (ridges, coasts, fixtures) so it
// is the last word on shore slopes; worst builtin shore was 4.49 rise/run,
// graded to about 1.1 against the 1.5 climb limit
// (tests/lake_shores.test.ts sweeps every declared lake).
const SHORE_BAND_DOWN = 1.2; // yards below the waterline the grading reshapes
const SHORE_BAND_UP = 1.9; // yards above (past the shore step-out reach)
const SHORE_GRADE = 0.25; // band slopes multiply by this inside a footprint
// NOTE for authored fixtures inside a lake footprint (the Star's Cradle
// plateau, the cove plaza): a flatten target ABOVE the band lands
// (1 - SHORE_GRADE) * SHORE_BAND_UP = about 1.4yd lower than the constant it
// names, because the grading applies after those fixtures. Everything stays
// on the same side of the waterline (the remap is monotone and fixes 0), and
// every consumer samples groundHeight at runtime, so this is a tuning note,
// not a hazard: pick fixture heights with the settle in mind.

// The band remap itself: compress heights around the live waterline
// (band(0) = 0 keeps every shoreline position exact; monotone, so wet stays
// wet and dry stays dry). Anchored to waterLevel() (the custom-map override
// when one is set), the same surface movement and render gate on.
function gradeShoreBand(h: number, w: number): number {
  const y = h - waterLevel();
  let gy: number;
  if (y > SHORE_BAND_UP) gy = y - (1 - SHORE_GRADE) * SHORE_BAND_UP;
  else if (y < -SHORE_BAND_DOWN) gy = y + (1 - SHORE_GRADE) * SHORE_BAND_DOWN;
  else gy = y * SHORE_GRADE;
  return h + (gy - y) * w;
}

function applyLakeShoreGrading(x: number, z: number, h: number): number {
  // border waters (moats, straits, row meres) grade like any lake: full
  // weight over the water, fading to nothing a short walk up the bank
  let w = 1 - smoothstep(0, 10, borderWaterOutsideDist(x, z, BORDER_WATERS));
  if (w === 1) return gradeShoreBand(h, 1);
  outer: for (const zone of getActiveWorldContent().zones) {
    for (const lake of zone.lakes) {
      // hostile in-memory content: never grade around a degenerate lake
      // (the sanitizer clamps documents to [0.5, 200]; mirror the stamp guard)
      if (!Number.isFinite(lake.radius) || lake.radius <= 0) continue;
      // full grading past every organic shoreline: the carve's wobble can pull
      // a shore bulge out to ~1.825R on the northern lakes (d + wob < 1.6R
      // with wob down to -0.225R), so full weight holds to 1.85R and fades
      // over a ring wide enough that the land settle never reads as a bank
      const fadeIn = lake.radius * 1.85;
      const fadeOut = fadeIn + Math.max(lake.radius * 0.25, 6);
      const dSq = (x - lake.x) ** 2 + (z - lake.z) ** 2;
      if (dSq >= fadeOut * fadeOut) continue;
      w = Math.max(w, 1 - smoothstep(fadeIn, fadeOut, Math.sqrt(dSq)));
      if (w === 1) break outer;
    }
  }
  if (w === 0) return h;
  return gradeShoreBand(h, w);
}

// ---------------------------------------------------------------------------
// The Palmreach jungle-pool walkway's bed: the two places the terrain under
// the viewing platform (sim/reach_decks.ts) has to be shaped for the walkway
// to behave, the rim it crosses and the sand it lands on.
// ---------------------------------------------------------------------------

// The Palmreach jungle pool's east rim, where the viewing platform and the
// stair that lands on it cross it (sim/reach_decks.ts). The rim climbs at
// almost exactly the movement climb limit (PLAYER_MAX_CLIMB_SLOPE, 1.5), and
// the platform's LEVEL plank plane covers the handful of 1-yard cells that tip
// over it. That pairing is not a slow spot, it is a permanent freeze: the
// movement kernel takes the player's own steepness from the TERRAIN under the
// planks (rideSteepnessAt defers to the memoized terrain view on dry ground),
// so a player standing there counts as standing on unwalkable ground and loses
// all steering; but BOTH escapes from unwalkable ground read groundHeight,
// which over a level deck is a dead-flat plane, so terrainDownhill finds no
// downhill to slide along and terrainWallStandoff finds no wall to be pushed
// off. Nothing ever moves the player again (reported stuck at -373, 1003).
//
// Ease the rim's face where the walkway crosses it so no cell the planks cover
// reaches the limit, with margin. Only the face moves: everything at or above
// `top` is untouched (including both deck anchors, so every plank plane stays
// exactly where it was), and the pool floor below the face simply lifts by the
// rise the face gives up. Bbox-guarded, so the rest of the world never pays.
const REACH_POOL_RIM_EASE = {
  // the early-out box around the crossing
  x1: -379,
  x2: -367,
  z1: 993,
  z2: 1012,
  // the crest line the walkway crosses, as a capsule (the rim runs as an arc
  // of the declared jungle pool at -380, 1000)
  ax: -371.5,
  az: 998.4,
  bx: -374.9,
  bz: 1006.2,
  full: 3.4, // full weight within this far of the crest line
  fade: 7.0, // and none past this
  // the rim face itself, in finished heights: `drop` yards below `top`
  top: -5.35,
  drop: 1.6,
  // the face keeps this much of its rise, so this much of its gradient
  scale: 0.62,
};

function applyReachPoolRimEase(x: number, z: number, h: number): number {
  const e = REACH_POOL_RIM_EASE;
  if (x < e.x1 || x > e.x2 || z < e.z1 || z > e.z2) return h;
  const y = h - e.top;
  if (y >= 0) return h; // the shelf above the rim, and both deck anchors, never move
  const sx = e.bx - e.ax;
  const sz = e.bz - e.az;
  const t = Math.min(1, Math.max(0, ((x - e.ax) * sx + (z - e.az) * sz) / (sx * sx + sz * sz)));
  const d = Math.hypot(x - (e.ax + sx * t), z - (e.az + sz * t));
  const w = 1 - smoothstep(e.full, e.fade, d);
  if (w === 0) return h;
  // monotone and continuous at both ends of the face (y = 0 maps to 0, and the
  // ground below the face rides up by exactly the rise the face gave up), so
  // wet stays wet, dry stays dry, and no step opens anywhere along the blend
  const eased = y < -e.drop ? y + e.drop * (1 - e.scale) : y * e.scale;
  return h + (eased - y) * w;
}

// The sand tie-in at the platform's landward end. The plank plane is set by the
// deck freeboard (GALE_DECK_FREEBOARD over the waterline), not by the shore, so
// it rides about a yard proud of the flat beach behind it: the whole landward
// end reads as a knee-high plinth the climb gate refuses, and a player who
// walks off the deck onto the strand can never step back on. Drift the sand up
// against the deck's end so the walkway is a path in BOTH directions, one deck
// lift below the planks (the height the deck's own bed sits at, so the boards
// meet the sand instead of hanging over it). Raises only, so the beach is never
// carved, and its reach stops well short of the shared deck anchor at
// (-368, 1000): both plank planes are anchored there and must not move.
const REACH_POOL_DECK_TIE_IN = {
  x1: -377,
  x2: -363,
  z1: 1002,
  z2: 1015,
  x: -369.5,
  z: 1008.6,
  full: 2.6, // sand at the tie-in height within this far of the end
  fade: 6.0, // easing back to the natural strand by here
};

function applyReachPoolDeckTieIn(x: number, z: number, h: number): number {
  const t = REACH_POOL_DECK_TIE_IN;
  if (x < t.x1 || x > t.x2 || z < t.z1 || z > t.z2) return h;
  // the platform is freeboard-seated, so its planks (and this tie-in with them)
  // sit a fixed height over the waterline wherever the shore happens to be.
  // WATER_LEVEL, not waterLevel(): dockSurfaceHeight seats every deck on the
  // constant, so the sand has to answer to the same line the planks do.
  const target = WATER_LEVEL + GALE_DECK_FREEBOARD;
  if (h >= target) return h;
  const w = 1 - smoothstep(t.full, t.fade, Math.hypot(x - t.x, z - t.z));
  if (w === 0) return h;
  return h + (target - h) * w;
}

// One shared early-out over both shapers' boxes: this runs for every terrain
// sample in the world, so the rest of it never pays for more than four compares.
const REACH_POOL_BED_BOX = {
  x1: Math.min(REACH_POOL_RIM_EASE.x1, REACH_POOL_DECK_TIE_IN.x1),
  x2: Math.max(REACH_POOL_RIM_EASE.x2, REACH_POOL_DECK_TIE_IN.x2),
  z1: Math.min(REACH_POOL_RIM_EASE.z1, REACH_POOL_DECK_TIE_IN.z1),
  z2: Math.max(REACH_POOL_RIM_EASE.z2, REACH_POOL_DECK_TIE_IN.z2),
};

function applyReachPoolWalkwayBed(x: number, z: number, h: number): number {
  const b = REACH_POOL_BED_BOX;
  if (x < b.x1 || x > b.x2 || z < b.z1 || z > b.z2) return h;
  return applyReachPoolDeckTieIn(x, z, applyReachPoolRimEase(x, z, h));
}

// Ground height including instanced dungeon floors (flat, far off-world, plus
// the raised boss dais where the room stacks one), the walkable Vale Cup
// grandstand lift, raised docks, and custom-map sculpt edits.
export function groundHeight(x: number, z: number, seed: number): number {
  if (x > DUNGEON_X_THRESHOLD) {
    const dungeon = dungeonAt(x);
    if (dungeon?.interior === 'wildheart') {
      const origin = instanceOrigin(dungeon.index, instanceSlotForZ(z));
      return DUNGEON_FLOOR_Y + wildheartFieldHeight(x - origin.x, z - origin.z);
    }
    if (dungeon?.interior === 'lastkeep') {
      // The Last Keep's authored rooms carry per-room lifts (door ramps
      // become stairs); the renderer builds risers and stairs from the same
      // authoredLiftAt field, so what you climb is what you stand on.
      const origin = instanceOrigin(dungeon.index, instanceSlotForZ(z));
      return DUNGEON_FLOOR_Y + lastKeepLiftAt(x - origin.x, z - origin.z);
    }
    // Every other interior is the flat room floor plus the raised boss dais
    // where its room plan stacks one (dungeon_floor.ts).
    return DUNGEON_FLOOR_Y + dungeonFloorLift(x, z);
  }
  // The Vale Cup grandstands are walkable: the ground steps up in seated tiers so
  // players can climb the bleachers (raised WALKABLE ground is the heightfield).
  // This lives in groundHeight, NOT terrainHeight, so the render's flat terrain
  // baseline (and the wooden deck geometry that seats on it) is unchanged; the
  // ramp just raises where the player stands. Zero outside the stand footprints,
  // so the pitch stays flat. (The custom-map edit layer is applied inside
  // terrainHeight, so it never touches the flat instance/rift floor above.)
  // The Old Beacon's stair rides the same idiom: beaconSpiralLift raises the
  // walkable plank helix and gallery ring around the lighthouse (and its
  // sheer core plug is what blocks walking through the tower). The Last
  // Keep's curtain walls, bastions, and stair flights ride it too
  // (castleLift): the wall mass is a sheer riser the climb gate refuses,
  // and its flat top is the wall-walk.
  const terrain =
    terrainHeight(x, z, seed) + sowfieldStandLift(x, z) + beaconSpiralLift(x, z) + castleLift(x, z);
  return Math.max(terrain, dockSurfaceHeight(x, z, seed));
}

export function terrainHeight(x: number, z: number, seed: number): number {
  let h = terrainHeightUnpadded(x, z, seed);
  // The Last Keep's courtyard pad, over the FINISHED height (the world-edge
  // sea shave runs late in the unpadded chain and was clipping the castle's
  // seaward corner; the castle plateau must win everywhere inside its walls).
  h = applyCastlePad(x, z, h);
  // ...and the shore bank that carries that pad's northeast apron down into the
  // Last Spring, applied straight after it: the hollow it fills is the one the
  // pad's own pool yield opens, so it has to read the padded height.
  h = applyLastSpringBank(x, z, h);
  // The Palmreach jungle-pool walkway's bed, over the FINISHED height: the
  // deck surfaces the movement kernel walks are anchored to this function, so
  // the rim the planks cover and the sand they land on have to be shaped here,
  // after the shore grading that forms them (see REACH_POOL_RIM_EASE for the freeze
  // it closes and REACH_POOL_DECK_TIE_IN for the one-way edge it closes).
  h = applyReachPoolWalkwayBed(x, z, h);
  // Level pads under the Evergarden's modeled flower beds, applied over the
  // FINISHED height (the garden seam reshapes the lawn per position, so an
  // early flatten would drift apart again): each bed ensemble sits flush on
  // one terrace at its anchor's finished height. The garden bounding box
  // gates the loop so the rest of the world never pays for it.
  if (x > 180 && x < 540 && z > 700 && z < 1260) {
    for (const pad of GARDEN_BED_PADS) {
      const dx = x - pad.x,
        dz = z - pad.z;
      const padGate = pad.r + 4;
      if (dx * dx + dz * dz >= padGate * padGate) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      const ch = terrainHeightUnpadded(pad.ax, pad.az, seed);
      const blend = smoothstep(pad.r + 1, pad.r + 4, d);
      h = h * blend + ch * (1 - blend);
    }
  }
  // The Bridgemere island: one level pad inside the widened moat ring,
  // over the finished height, so the doubled town floor stays dry wall to
  // wall (the natural fen dips below the waterline inside the wider ring;
  // the pad's rim fades into the moat's carved banks without drying them).
  if (x > -540 && x < -180 && z > 180 && z < 700) {
    const bdx = x + 360,
      bdz = z - 362;
    if (bdx * bdx + bdz * bdz < 19 * 19) {
      const d = Math.sqrt(bdx * bdx + bdz * bdz);
      const w = 1 - smoothstep(15, 19, d);
      h = h * (1 - w) + 2.0 * w;
    }
  }
  // The Galecrest's shaping, over the finished height like the bed pads:
  if (x > 180 && x < 540 && z > 180 && z < 700) {
    // the Mirror Tarn's bathing shore FIRST: pull the carved banks down onto
    // one long gentle sandy ramp, so the water is waded into, never fallen
    // into (the level pads below then win wherever the two overlap)
    const tdx = x - 300,
      tdz = z - 560;
    if (tdx * tdx + tdz * tdz < 32 * 32) {
      const d = Math.sqrt(tdx * tdx + tdz * tdz);
      const target = WATER_LEVEL - 2.2 + smoothstep(5, 26, d) * 8.2;
      const w = 1 - smoothstep(26, 32, d);
      if (h > target) h = h * (1 - w) + target * w;
    }
    // level pads under the raider encampments and the tarn's north-bank
    // stable barns (the built-in camp flatten only reaches the mob spawn
    // ring; tents and barns stand wider than that)
    for (const pad of GALE_LEVEL_PADS) {
      const dx = x - pad.x,
        dz = z - pad.z;
      const padGate = pad.r + 5;
      if (dx * dx + dz * dz >= padGate * padGate) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      const ch = pad.h ?? terrainHeightUnpadded(pad.x, pad.z, seed);
      const blend = smoothstep(pad.r, pad.r + 5, d);
      h = h * blend + ch * (1 - blend);
    }
    // the Beacon dock stair's cutting: the headland face is carved down to
    // the stair's ramp line so the treads climb an open notch instead of
    // vanishing inside the cliff (mirror of the beacon stair deck in
    // sim/gale_harbor.ts: center 503.3,325.3 rot 0.99 hl 6.94)
    const sdx = x - 503.3,
      sdz = z - 325.3;
    if (sdx * sdx + sdz * sdz < 10.6 * 10.6) {
      const dirx = 0.8360259786005205; // sin(0.99)
      const dirz = 0.5486979929717658; // cos(0.99)
      const along = sdx * dirx + sdz * dirz;
      const across = sdx * dirz - sdz * dirx;
      if (along > -8.4 && along < 8.4 && Math.abs(across) < 4.4) {
        const topY = terrainHeightUnpadded(497, 321, seed) + 0.1;
        const botY = Math.max(terrainHeightUnpadded(507, 327, seed), WATER_LEVEL + 0.55) + 0.1;
        const t = Math.min(1, Math.max(0, (along + 6.94) / 13.88));
        const rampY = topY + (botY - topY) * t - 0.25;
        const w =
          (1 - smoothstep(1.4, 4.4, Math.abs(across))) *
          (1 - smoothstep(6.94, 8.4, Math.abs(along)));
        if (h > rampY) h = h * (1 - w) + rampY * w;
      }
    }
  }
  return h;
}

// The Galecrest's level ground (terrainHeight above): each pad blends the
// finished height to its center's, wide enough that every tent, tower,
// palisade run, and barn sits flush instead of sinking into a rise.
const GALE_LEVEL_PADS: { x: number; z: number; r: number; h?: number }[] = [
  { x: 252, z: 250, r: 14 },
  { x: 210, z: 410, r: 14 },
  { x: 354, z: 664, r: 14 },
  // the stable barns' lakeside terrace on the Mirror Tarn's north bank: an
  // explicit height keeps it a low shelf above the beach, the downs rising
  // behind it, instead of a high pad with a sheer rim over the water
  { x: 299, z: 531, r: 12, h: WATER_LEVEL + 3.2 },
  // the Old Beacon's lawn: one flat disc under the whole tower and spiral
  // stair, so the stair foot always meets level ground (a sloping lawn left
  // the first tread hovering and broke click-to-move approaches)
  { x: 498, z: 308, r: 11 },
];

function borderSeaGate(x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    // A skipped later field could be NaN for a non-finite coordinate, which
    // would poison the eager Math.max. Keep that exact invalid-input path.
    return smoothstep(
      0.005,
      0.06,
      Math.max(
        greenSeamT(x, z) * 0.2,
        hollowLandness(x, z),
        emberLandness(x, z),
        frostLandness(x, z),
        amberLandness(x, z),
        fenLandness(x, z),
        nightLandness(x, z),
        woodLandness(x, z),
        reachLandness(x, z),
        gardenLandness(x, z),
        galeLandness(x, z),
      ),
    );
  }

  // smoothstep is exactly 1 at and above 0.06. Once the running maximum
  // reaches it, later finite fields cannot change the result, so skipping
  // them is bit-identical. The non-saturating path keeps the original order.
  let land = greenSeamT(x, z) * 0.2;
  if (land >= 0.06) return 1;
  land = Math.max(land, hollowLandness(x, z));
  if (land >= 0.06) return 1;
  land = Math.max(land, emberLandness(x, z));
  if (land >= 0.06) return 1;
  land = Math.max(land, frostLandness(x, z));
  if (land >= 0.06) return 1;
  land = Math.max(land, amberLandness(x, z));
  if (land >= 0.06) return 1;
  land = Math.max(land, fenLandness(x, z));
  if (land >= 0.06) return 1;
  land = Math.max(land, nightLandness(x, z));
  if (land >= 0.06) return 1;
  land = Math.max(land, woodLandness(x, z));
  if (land >= 0.06) return 1;
  land = Math.max(land, reachLandness(x, z));
  if (land >= 0.06) return 1;
  land = Math.max(land, gardenLandness(x, z));
  if (land >= 0.06) return 1;
  land = Math.max(land, galeLandness(x, z));
  return smoothstep(0.005, 0.06, land);
}

function terrainHeightUnpadded(x: number, z: number, seed: number): number {
  const region = terrainRegionAt(x, z);
  let h = baseHeight(x, z, seed, region);

  // Flatten each camp a little so mobs don't stand on cliffs. The squared
  // gate (one spare yard) before the sqrt is bit-identical: a point past it
  // can never pass the d < radius*1.8 test, and this loop runs over all 150
  // camps for EVERY height sample.
  // A camp omitted by the coarse index is outside that complete gate plus a
  // full guard cell, so skipping it is a bit-identical no-op.
  for (const campIndex of region.campIndices) {
    const camp = CAMPS[campIndex];
    const dx = x - camp.center.x,
      dz = z - camp.center.z;
    const campGate = camp.radius * 1.8 + 1;
    if (dx * dx + dz * dz >= campGate * campGate) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < camp.radius * 1.8) {
      const ch = baseHeight(camp.center.x, camp.center.z, seed);
      const blend = smoothstep(camp.radius * 0.8, camp.radius * 1.8, d);
      h = h * blend + ch * (1 - blend);
    }
  }

  // Mountain ridge walls along shared zone edges, pierced by the road pass
  // (sealed walls have no pass and only ever grow past their base height,
  // so no crest dip opens a climbable notch)
  let wallAdd = 0;
  // lazily computed once per call: non-sealed ridges break at declared lakes
  let lakeGate = -1;
  for (const edge of BORDER_EDGES) {
    const sigma = edge.sealed ? SEALED_RIDGE_SIGMA : RIDGE_SIGMA;
    const dPerp = Math.abs((edge.kind === 'h' ? z : x) - edge.at);
    // The window used to cut hard at 3 sigma, but the gaussian tail there is
    // still 0.2yd for a classic ridge, 0.6 to 1.3yd for the tall peaks and
    // sealed walls: an instant knee-high cliff along the whole cutoff line
    // that the movement gate (rise over one tick's run) refuses, an invisible
    // straight wall across open country (the Thornpeak x = -102 report). The
    // skirt below keeps every height inside 3 sigma bit-identical and fades
    // the tail smoothly to zero across [3, 4] sigma, so the window edge
    // cannot step (tests/border_ridge_skirt.test.ts sweeps every edge).
    if (dPerp < sigma * 4) {
      const along = edge.kind === 'h' ? x : z;
      let profile = Math.exp(-(dPerp * dPerp) / (2 * sigma * sigma));
      const pass = edge.sealed ? 1 : ridgePassWeight(along - edge.passAt);
      // Inside a road pass, the final wall term is exactly +0. Skip the crest
      // noise and shaping work while keeping the heightfield bit-identical.
      if (pass === 0) continue;
      // jagged crest so the wall reads as mountains, not a berm
      // Thornpeak's edges carry real peaks: the mountain realm's borders
      // are taller and craggier than the rest of the grid's low ranges
      // (the Sunway and Gardenwalk passes still open through them)
      const peaksEdge =
        (edge.kind === 'v' && edge.lo >= 540 && edge.hi <= 900) ||
        (edge.kind === 'h' && edge.at === 540);
      // Thornpeak's range wanders instead of running dead straight: its crest
      // LINE meanders +-16yd with low-frequency noise along its length, and
      // its height swells and saddles over long runs, so the mountain front
      // reads as an organic range, not a ruled berm. Placement (mean z540 /
      // the column lines) is unchanged.
      // The sealed south wall's VISIBLE crest also meanders so it reads as an
      // organic range, not a ruled band, on the map. This moves only the
      // terrain crest line; the movement seal (crossesSealedBorder / SEALED_
      // BORDERS) is a separate, independent wall fixed at the border, so
      // weaving the mountains never opens a gap the player can walk through.
      let dPerpEdge = dPerp;
      if (peaksEdge || edge.sealed) {
        const amp = edge.sealed ? 14 : 32;
        const amp2 = edge.sealed ? 6 : 10;
        const wob =
          (fbm2(along * 0.006, edge.at * 0.006, seed + 31, 2) - 0.5) * amp +
          (fbm2(along * 0.02, edge.at * 0.02, seed + 33, 2) - 0.5) * amp2;
        dPerpEdge = Math.abs((edge.kind === 'h' ? z : x) - (edge.at + wob));
        profile = Math.exp(-(dPerpEdge * dPerpEdge) / (2 * sigma * sigma));
      }
      const crestNoise =
        edge.kind === 'h'
          ? (fbm2(x * 0.03, edge.at * 0.03, seed + 19, 2) - 0.5) * (peaksEdge ? 1.0 : 0.7)
          : (fbm2(edge.at * 0.03, z * 0.03, seed + 19, 2) - 0.5) * (peaksEdge ? 1.0 : 0.7);
      // a coarse height swell for peaks so the wall has big shoulders and
      // saddles over long runs (broken silhouette, not uniform teeth)
      const peaksSwell = peaksEdge
        ? 0.55 + 0.9 * fbm2(along * 0.009, edge.at * 0.009, seed + 37, 2)
        : 1;
      const crest = (1 + (edge.sealed ? Math.abs(crestNoise) : crestNoise)) * peaksSwell;
      // the marsh's mountain range (the z540 marsh|peaks wall) sits a little
      // lower than the peaks' inner crags
      const peaksHeight = edge.kind === 'h' && edge.at === 540 ? 27 : 34;
      const height = edge.sealed ? SEALED_RIDGE_HEIGHT : peaksEdge ? peaksHeight : RIDGE_HEIGHT;
      // The Hollow/Drakelands boundary ridge rises only where there is land
      // to carry it (the Wyrmgate mountains around the causeway head); over
      // the open sea the two realms' waters simply meet. Sealed walls are
      // never gated: the Drakemaw range runs down into the sea at its flanks.
      let seaGate = 1;
      // seaGate the northern realms' edges AND every column-row border (an
      // east/west column h-edge, lo>=strip or hi<=-strip): those are mere
      // crossings whose ridge must not rise over the open water at the mere
      // caps. The classic full-strip land borders (vale/marsh, marsh/peaks)
      // keep their ungated mountain range.
      const columnRow = edge.kind === 'h' && (edge.lo >= STRIP_MAX_X || edge.hi <= STRIP_MIN_X);
      const northern = (edge.kind === 'h' ? edge.at >= HOLLOW_ZMAX : true) || columnRow;
      if (!edge.sealed && northern) {
        seaGate = borderSeaGate(x, z);
      }
      // a partial edge (a column border, or a band split by columns) fades
      // out past its span; a full-row edge keeps the classic unbounded wall
      let end = 1;
      if (!edge.fullRow) {
        const outside = Math.max(edge.lo - along, along - edge.hi, 0);
        end = 1 - smoothstep(0, 24, outside);
      }
      // the Mirefen crater is a seed-pinned fixture 30yd from the marsh's
      // east border: the wall's gaussian tail must not lean into its bowl
      const dCrater = Math.hypot(x - MIREFEN_IMPACT_CRATER.x, z - MIREFEN_IMPACT_CRATER.z);
      const craterGate = smoothstep(34, 56, dCrater);
      if (!edge.sealed && lakeGate < 0) lakeGate = lakeRidgeGateAt(x, z);
      const waterGate = edge.sealed ? 1 : lakeGate;
      // the tail skirt: full weight through the classic 3-sigma window, easing
      // to exactly zero by 4 sigma (keyed on the unmeandered dPerp so the fade
      // band itself never wanders)
      const skirt = 1 - smoothstep(sigma * 3, sigma * 4, dPerp);
      // where two borders meet, the TALLER range wins instead of stacking
      // (summed corners built unclimbable knots at every junction)
      wallAdd = Math.max(
        wallAdd,
        height * crest * profile * pass * seaGate * end * craterGate * waterGate * skirt,
      );
    }
  }
  h += wallAdd;

  // A missing bit means the entire guarded cell is outside the applier's
  // declared support. That applier would return exact +0 or the unchanged h,
  // so each skip is bit-identical. Contributing paths keep their old order.
  if (terrainRegionHas(region, TERRAIN_APPLIER.mirefenImpactCrater)) {
    h += mirefenImpactCraterOffset(x, z);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.hollowShaping)) {
    h += hollowShapingOffset(x, z, seed);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.emberShaping)) {
    h += emberShapingOffset(x, z, seed);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.frostMassif)) {
    h += frostMassifOffset(x, z);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.amberShelf)) {
    h += amberShelfOffset(x, z);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.nightCaldera)) {
    h += nightCalderaOffset(x, z);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.palmCone)) {
    h += palmConeOffset(x, z);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.hollowCoast)) {
    h = applyHollowCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.emberCoast)) {
    h = applyEmberCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.frostCoast)) {
    h = applyFrostCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.amberCoast)) {
    h = applyAmberCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.fenCoast)) {
    h = applyFenCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.nightCoast)) {
    h = applyNightCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.woodCoast)) {
    h = applyWoodCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.reachCoast)) {
    h = applyReachCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.gardenCoast)) {
    h = applyGardenCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.galeCoast)) {
    h = applyGaleCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.valeCoast)) {
    h = applyValeCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.isleCoast)) {
    h = applyIsleCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.causeway)) {
    h = applyCauseway(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.starterMoat)) {
    h = applyStarterMoat(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.columnStraits)) {
    h = applyColumnStraits(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.stripFlankCoast)) {
    h = applyStripFlankCoast(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.rowMeres)) {
    h = applyRowMeres(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.northBay)) {
    h = applyNorthBay(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.emberLavaNetwork)) {
    h = applyEmberLavaNetwork(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.emberLavaBasins)) {
    h = applyEmberLavaBasins(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.drakemawEscape)) {
    h = applyDrakemawEscape(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.eastConeBreach)) {
    h = applyEastConeBreach(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.frostTerraces)) {
    h = applyFrostTerraces(x, z, h);
  }
  if (terrainRegionHas(region, TERRAIN_APPLIER.fenBraids)) {
    h = applyFenBraids(x, z, h);
  }
  // (The Great Maze no longer shapes terrain: its hedge walls are modeled
  // props over flat lawn, blocked by inGardenMazeWall in the movement pass
  // and drawn by garden_features.ts from the same grid.)
  // World rims AFTER the coast, so the border ranges rise out of the sea
  // (mountains dipping into the ocean at the flanks) instead of being sunk
  // by it. The NORTH rim is suppressed over the Hollow's open sea: looking
  // out from the shore reads as water meeting sky, and swim fatigue (not a
  // wall) turns swimmers back before the band edge.
  const xb = worldXBoundsAt(z);
  let rimX = Math.max(smoothstep(xb.max - 30, xb.max, x), smoothstep(-xb.min - 30, -xb.min, -x));
  let rimS = smoothstep(WORLD_MIN_Z + 30, WORLD_MIN_Z, z);
  // The north rim (the Drakelands' Ashen Reach along the world's top edge)
  // wanders and saddles so it reads as an organic mountain coast, not a ruled
  // horizontal wall: its onset line meanders +-23yd in z with low-frequency
  // noise along x, and its height swells and drops to near-nothing over long
  // runs (broken massifs and passes, not a uniform berm).
  let rimN = northRimWeight(x, z);
  // the southern realms end in open coast, not a rim range: the vale, the
  // Farshore, the fen, the headlands, the jungle, and the lawns all meet
  // the sea at their outer edges, and swim fatigue does the containment
  // (bounded to the playable world: far instance-space x keeps its rim)
  if (z <= 1260 && Math.abs(x) <= 600) {
    rimX = 0;
    rimS = 0;
  }
  if (inHollowOpenSea(x, z)) {
    // no ranges over the open sea: the flanks read as water to the map edge
    // (swim fatigue, not a wall, turns swimmers back out there)
    rimX = 0;
    rimN = 0;
  }
  // the northern grid's outer edges are open ocean (applyWorldEdgeSea carves
  // them below), so no rim range rises there; instance space past |x|560 keeps
  // its containment wall
  if (z > 1250 && Math.abs(x) <= 560) {
    rimX = 0;
    rimN = 0;
  }
  // inside the northern realms the remaining land rims stay softer than the
  // world's (their coasts and ranges do the framing; the old causeway gate
  // cap is now the Wyrmgate ridge with a real pass through it)
  const rimScale = z > 960 && z <= WORLD_MAX_Z ? 0.6 : 1;
  h += Math.max(rimX, rimS, rimN) * 40 * rimScale;
  // Brother Aldric's wall: the Mirefen keeps a relic of its old east rim
  // beside the crater fixture (the green seam replaced the rest of that rim
  // with the Windway's approach downs), so the impact site still reads as a
  // strike into the wall's base and every seed-pinned sample holds
  h +=
    40 *
    smoothstep(150, 180, x) *
    (1 - smoothstep(184, 214, x)) *
    (1 - smoothstep(45, 75, Math.abs(z - MIREFEN_IMPACT_CRATER.z))) *
    // ...with a walkable breach at the wall's north end, so the relic is a
    // landmark to route around, not a shut border
    (1 - 0.85 * (1 - smoothstep(10, 26, Math.abs(z - 348))));
  // the Tablecrag's crown: a level table cut into the eastern border range
  // (flattened AFTER the rims so the top is a true plateau, not rim noise)
  const dMesa = Math.hypot(x + 168, z - 1195);
  if (dMesa < 30) {
    const t = smoothstep(14, 30, dMesa);
    h = h * t + 34 * (1 - t);
  }
  const dMesaS = Math.hypot(x + 166, z - 1072);
  if (dMesaS < 26) {
    const t = smoothstep(11, 26, dMesaS);
    h = h * t + 30 * (1 - t);
  }
  // the Star's Cradle: a level plateau at Starfall Basin's heart (flattened
  // after the shaping bump so the shrine floor is true), plus a flat
  // causeway strip west to the shore so the moat frames it as a C
  const dCradle = Math.hypot(x - 110, z - 985);
  if (dCradle < 13) {
    const t = smoothstep(8.5, 13, dCradle);
    h = h * t + -1.0 * (1 - t);
  }
  if (z > 979 && z < 991 && x > 86 && x < 111) {
    const segT = Math.max(0, Math.min(1, (x - 88) / (110 - 88)));
    const segZ = 982 + (985 - 982) * segT;
    const dCause = Math.abs(z - segZ);
    if (dCause < 4.5) {
      const t = smoothstep(2.2, 4.5, dCause);
      h = h * t + -1.2 * (1 - t);
    }
  }
  // the crystal cove plaza: a level shelf at the cove's edge where the
  // mound's cave mouth opens, blending wide into the slope behind it
  const dCove = Math.hypot(x - 100, z - 1162);
  if (dCove < 14) {
    const t = smoothstep(7, 14, dCove);
    h = h * t + -1.2 * (1 - t);
  }
  // the cove apron: one wide, gently graded shelf of dry ground covering the
  // whole northeast shore walk from the glade to the cave plaza. Broad on
  // purpose: a narrow ramp here left carved-water slivers and trench walls
  // beside the path (the floor stays well above WATER_LEVEL throughout).
  {
    const ax = 78;
    const az = 1176;
    const bx = 101;
    const bz = 1163;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const dApron = Math.hypot(x - px, z - pz);
    if (dApron < 13) {
      const apronH = lerp(1.3, -1.2, t);
      const w = smoothstep(8, 13, dApron);
      h = h * w + apronH * (1 - w);
    }
  }
  // Beyond a row's own columns the world is open water: past the rim range
  // the ground dives to the sea floor, so rows without an east or west
  // column read as coast, not as an endless mountain shelf. Two gates keep
  // it honest: it only exists where the world is genuinely wider than this
  // row (inert in a one-column world), and never past the world bounds
  // themselves (instance space far east keeps its untouched heights).
  if (
    (WORLD_MAX_X > xb.max || WORLD_MIN_X < xb.min) &&
    x <= WORLD_MAX_X + 60 &&
    x >= WORLD_MIN_X - 60
  ) {
    const beyond = Math.max(x - (xb.max + 26), xb.min - 26 - x);
    if (beyond > 0) {
      const t = smoothstep(0, 44, beyond);
      h = h * (1 - t) + (WATER_LEVEL - 6) * t;
    }
  }
  // The Veilspires' plateau tables: level shelves cut into the massif at
  // rising heights (flattened after the rims and terraces, so each top is
  // a true plateau).
  if (z > 1680 && z < 1880 && x > STRIP_MIN_X + 4 && x < STRIP_MAX_X - 4) {
    for (const p of FROST_PLATEAUS) {
      const dP = Math.hypot(x - p.x, z - p.z);
      if (dP < p.r) {
        const t = smoothstep(p.r * 0.55, p.r, dP);
        h = h * t + p.h * (1 - t);
      }
    }
  }
  // The Huntsman's Bluff: the Pale Huntsman's clearing sits on a flat-top
  // rise; his road from Gallowmere climbs the blended rim as the ramp.
  if (z > 1620 && z < 1750) {
    const dBluff = Math.hypot(x - 380, z - 1680);
    if (dBluff < 32) {
      const t = smoothstep(17, 32, dBluff);
      h = h * t + 14 * (1 - t);
    }
  }
  // Last: the northern grid's outer edges dive to open ocean with a wavy
  // coast, after every land-raising pass, so no realm's land hugs the map edge.
  h = applyWorldEdgeSea(x, z, h);
  // The Sowfield plateau (Vale Cup) is the LAST word on the southern-vale
  // terrain: a LEVEL pull toward the pitch height applied AFTER every coast, rim,
  // and sea pass (like the Tablecrag / Veilspires bespoke plateaus above), so the
  // football pitch stays dead flat and dry no matter what the grid's vale coast
  // does beneath it. Its influence ends north of the world-rim onset (z >= -149,
  // see sowfieldFlattenWeight), so it never fights the rim wall.
  // Gradual shores on every declared lake: the last shaping word before the
  // stand lift and the editor's stamps, so nothing above can re-steepen a
  // shore a player must wade out of.
  h = applyLakeShoreGrading(x, z, h);
  // The Glacier Tarn's shore ramp, after that grading: the bowl's one authored
  // way in and out, authored in FINISHED height space so its foot meets the
  // pond and its top meets the road bench with no seam at either end.
  if (terrainRegionHas(region, TERRAIN_APPLIER.glacierTarnRamp)) {
    h = applyGlacierTarnRamp(x, z, h);
  }
  const sow = terrainRegionHas(region, TERRAIN_APPLIER.sowfieldFlatten)
    ? sowfieldFlattenWeight(x, z)
    : 0;
  if (sow > 0) h = lerp(h, SOWFIELD_FLAT.height, sow);
  // The Highwatch paddock is another authored level pull. It sits deep inside
  // Thornpeak, so it does not compete with a realm border or coast.
  const stable = terrainRegionHas(region, TERRAIN_APPLIER.stableFlatten)
    ? stableFlattenWeight(x, z)
    : 0;
  if (stable > 0) h = lerp(h, STABLE_FLAT.height, stable);
  // The custom-map sculpt edits are the LAST word over the finished overworld
  // height (the editor's height stamps; a no-op for the built-in world, which has
  // no terrainEdits). Kept in terrainHeight so the render mesh (which samples
  // terrainHeight) and the sim's groundHeight both see the edited ground.
  return applyEditLayer(x, z, h);
}

// Steepest local rise/run of the walkable heightfield at (x, z), independent of
// travel direction. Movement gates on this (not just the slope along the step)
// so a diagonal switchback approach cannot beat the straight-line climb limit.
export const STEEPNESS_SAMPLE = 0.35; // yards; about one movement tick of run
// The steepness field reads the NATURAL walking surface: the designed raised
// decks (the Beacon's spiral stair, the harbor piers) are deliberately left
// out. Their tall rims are honest DROPS that the movement kernel's step-rise
// gate already handles; sampling them here would smear each rim across a
// whole cached steepness cell and wall the deck off as a fake cliff face
// (the bug that made the lighthouse stair unclimbable for a real player).
function steepnessGroundHeight(x: number, z: number, seed: number): number {
  if (x > DUNGEON_X_THRESHOLD) return DUNGEON_FLOOR_Y;
  return terrainHeight(x, z, seed) + sowfieldStandLift(x, z);
}
export function terrainSteepness(x: number, z: number, seed: number): number {
  const e = STEEPNESS_SAMPLE;
  const hx =
    (steepnessGroundHeight(x + e, z, seed) - steepnessGroundHeight(x - e, z, seed)) / (2 * e);
  const hz =
    (steepnessGroundHeight(x, z + e, seed) - steepnessGroundHeight(x, z - e, seed)) / (2 * e);
  return Math.hypot(hx, hz);
}

// Memoized 1-yard-cell view of terrainSteepness for the per-tick movement gates
// (every moving mob evaluates its step fan every tick; the exact helper costs
// four heightfield samples). A cache over a pure function of (cell, seed) stays
// fully deterministic; the cap just bounds memory on long-running hosts. Cell
// granularity only shifts a gate line by under a yard, far inside the walls'
// steepness margin (tests/terrain_walls.test.ts).
const steepnessCache = new Map<number, Map<number, number>>(); // seed -> cell -> steepness
const STEEPNESS_CACHE_MAX = 400_000; // cells per seed; ~the whole overworld
const STEEPNESS_CACHE_MAX_SEEDS = 4; // hosts run one seed; only test runs see more
const STEEPNESS_CELL_SPAN = 16384; // cells per axis in the packed key
// The heightfield is a function of (x, z, seed) AND the active content (its
// lakes, edits, camps): drop the memo whenever the content swaps (editor
// play-test enter/leave, test worlds) so no stale cells survive a swap.
let steepnessCacheGeneration = -1;
export function terrainSteepnessAt(x: number, z: number, seed: number): number {
  // Instanced interiors (dungeons/arena/delves/rifts) are flat floors; skip the
  // cache entirely so their far-off coordinates never enter (or overflow) the
  // packed key space, which is sized for the overworld.
  if (x > DUNGEON_X_THRESHOLD) return 0;
  const gen = getContentGeneration();
  if (gen !== steepnessCacheGeneration) {
    steepnessCache.clear();
    steepnessCacheGeneration = gen;
  }
  const cx = Math.round(x);
  const cz = Math.round(z);
  let bySeed = steepnessCache.get(seed);
  if (!bySeed) {
    if (steepnessCache.size >= STEEPNESS_CACHE_MAX_SEEDS) steepnessCache.clear();
    bySeed = new Map();
    steepnessCache.set(seed, bySeed);
  }
  const key = (cx + STEEPNESS_CELL_SPAN / 2) * STEEPNESS_CELL_SPAN + (cz + STEEPNESS_CELL_SPAN / 2);
  let v = bySeed.get(key);
  if (v === undefined) {
    if (bySeed.size >= STEEPNESS_CACHE_MAX) bySeed.clear();
    v = terrainSteepness(cx, cz, seed);
    bySeed.set(key, v);
  }
  return v;
}

// True inside the terrain bands that hold the deliberate unwalkable walls: the
// inter-zone border ridges and the world rim (with margin). The per-tick mob
// movement gate screens with this so the steepness memo never runs over the open
// world; rare interior steep spots (calderas, massifs, mesas) stay mob-walkable,
// exactly as they were before the gate (players get the full gate everywhere in
// sim.ts). Adapted to dems's BORDER_EDGES + rim (the strip-era ZONE_RIDGES this
// once screened are gone).
export function nearSteepWalls(x: number, z: number): boolean {
  if (x > DUNGEON_X_THRESHOLD) return false; // instanced interiors: flat floors
  if (
    x > WORLD_MAX_X - 40 ||
    x < WORLD_MIN_X + 40 ||
    z < WORLD_MIN_Z + 40 ||
    z > WORLD_MAX_Z - 40
  ) {
    return true; // within the world rim's margin
  }
  for (const edge of BORDER_EDGES) {
    const sigma = edge.sealed ? SEALED_RIDGE_SIGMA : RIDGE_SIGMA;
    if (Math.abs((edge.kind === 'h' ? z : x) - edge.at) >= sigma * 4) continue;
    const along = edge.kind === 'h' ? x : z;
    if (edge.fullRow || (along >= edge.lo - 24 && along <= edge.hi + 24)) return true;
  }
  return false;
}

// Unit downhill direction at (x, z), or null on (near-)flat ground. Drives the
// slide that carries a player off ground steeper than the climb limit.
export function terrainDownhill(
  x: number,
  z: number,
  seed: number,
): { x: number; z: number } | null {
  const e = STEEPNESS_SAMPLE;
  const hx = (groundHeight(x + e, z, seed) - groundHeight(x - e, z, seed)) / (2 * e);
  const hz = (groundHeight(x, z + e, seed) - groundHeight(x, z - e, seed)) / (2 * e);
  const mag = Math.hypot(hx, hz);
  if (mag < 1e-6) return null;
  return { x: -hx / mag, z: -hz / mag };
}

// Ring samples for the wall standoff below. 8 covers the body circle evenly
// without being a hot-loop cost (the caller only runs it for grounded overworld
// players).
const WALL_STANDOFF_SAMPLES = 8;

// A single ring-sample-and-nudge pass, capped at one body radius of push (see
// `terrainWallStandoff` below for why it must be iterated rather than trusted
// to converge in one call, and why the caller must accept a push that only
// REDUCES steepness rather than requiring it clear `maxSlope` outright).
export function terrainWallStandoffPass(
  x: number,
  z: number,
  seed: number,
  radius: number,
  maxSlope: number,
): { x: number; z: number } {
  const h0 = groundHeight(x, z, seed);
  const wallRise = radius * maxSlope; // the most a climbable slope rises over `radius`
  let pushX = 0;
  let pushZ = 0;
  for (let k = 0; k < WALL_STANDOFF_SAMPLES; k++) {
    const a = (k / WALL_STANDOFF_SAMPLES) * Math.PI * 2;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    const rise = groundHeight(x + sx * radius, z + sz * radius, seed) - h0;
    if (rise > wallRise) {
      // horizontal setback that would make this direction merely climbable,
      // capped at the body radius (a face closer than `radius` reads as a huge
      // rise; one exactly at `radius` contributes nothing)
      const setback = Math.min((rise - wallRise) / maxSlope, radius);
      pushX -= sx * setback;
      pushZ -= sz * setback;
    }
  }
  if (pushX === 0 && pushZ === 0) return { x, z };
  const mag = Math.hypot(pushX, pushZ);
  const scale = Math.min(mag, radius) / mag; // total nudge never exceeds one body radius
  return { x: x + pushX * scale, z: z + pushZ * scale };
}

// The most passes `terrainWallStandoff` will take to converge. Mirrors the
// 3-iteration prop/OBB push-out loop in `colliders.ts`'s `resolveAgainst`.
const WALL_STANDOFF_ITERATIONS = 3;

// Push a body of `radius` out of terrain steeper than `maxSlope` so the
// character model does not sink into a cliff face. Movement collision samples
// only the center point (the climb gate blocks the center from CLIMBING a wall,
// but nothing keeps the body's WIDTH clear of one), so standing at or strafing
// along the foot of a near-vertical wall buries the model's near side. This
// samples the heightfield on a ring at the body radius; any direction rising
// faster than a climbable slope is a wall within reach, and the center is nudged
// directly away from it, toward the lower walkable side. Pure and deterministic;
// returns the input unchanged on open or merely-sloped ground (no ring sample
// exceeds a climbable rise there), so it is a near-no-op away from the walls.
//
// A single pass can leave the pushed point still reading as a wall in a
// CONCAVE pocket (a ridge/rim corner or a coastline notch wrapping more than
// half the sample ring): one pass's push, capped at one body radius, is not
// always enough to clear it. The caller (`stepPlayerMotion`) only ever
// committed the result when it stopped reading as steep, so an unconverged
// single pass silently no-ops right where standoff is needed most, leaving
// the player permanently wedged. Iterating a few passes lets each subsequent
// ring sample, now centered on the partially-pushed point, see less of the
// wall, converging out of the pocket instead of stalling on it.
export function terrainWallStandoff(
  x: number,
  z: number,
  seed: number,
  radius: number,
  maxSlope: number,
): { x: number; z: number } {
  let cx = x;
  let cz = z;
  for (let iter = 0; iter < WALL_STANDOFF_ITERATIONS; iter++) {
    const next = terrainWallStandoffPass(cx, cz, seed, radius, maxSlope);
    if (next.x === cx && next.z === cz) break;
    cx = next.x;
    cz = next.z;
  }
  return { x: cx, z: cz };
}

// ---------------------------------------------------------------------------
// Natural roads. The authored ROADS are sparse waypoint polylines; drawn raw
// they read as ruler segments with kinks at every joint. Each road is
// densified ONCE through a centripetal-flavored Catmull-Rom spline so it
// flows as a curve through its waypoints (shared endpoints stay shared, so
// junctions remain seamless), and the query point gets a gentle fixed-seed
// meander so long reaches wander like a worn track instead of a survey line.
// Everything that reads roadDistance (the terrain splat, the map painter,
// decoration/terrace suppression) inherits the same curves together.
// ---------------------------------------------------------------------------
interface SmoothRoad {
  pts: { x: number; z: number }[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const ROAD_SAMPLE_STEP = 5; // yd between densified points
const ROAD_MEANDER = 7; // full meander swing of the query warp (yd)
const ROAD_BBOX_MARGIN = 24; // covers the meander plus every consumer's reach

function catmullRom(
  p0: { x: number; z: number },
  p1: { x: number; z: number },
  p2: { x: number; z: number },
  p3: { x: number; z: number },
  t: number,
): { x: number; z: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z:
      0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  };
}

const SMOOTH_ROADS: SmoothRoad[] = ROADS.map((road) => {
  const pts: { x: number; z: number }[] = [];
  if (road.length < 2) {
    pts.push(...road);
  } else {
    for (let i = 0; i < road.length - 1; i++) {
      const p0 = road[Math.max(0, i - 1)];
      const p1 = road[i];
      const p2 = road[i + 1];
      const p3 = road[Math.min(road.length - 1, i + 2)];
      const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      const steps = Math.max(1, Math.ceil(segLen / ROAD_SAMPLE_STEP));
      for (let k = 0; k < steps; k++) pts.push(catmullRom(p0, p1, p2, p3, k / steps));
    }
    pts.push(road[road.length - 1]);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return {
    pts,
    minX: minX - ROAD_BBOX_MARGIN,
    maxX: maxX + ROAD_BBOX_MARGIN,
    minZ: minZ - ROAD_BBOX_MARGIN,
    maxZ: maxZ + ROAD_BBOX_MARGIN,
  };
});

// Distance from (x,z) to the nearest road curve.
export function roadDistance(x: number, z: number): number {
  // cheap first: most queries are nowhere near a road, so gate on the raw
  // bboxes (their margin already covers the meander) before paying for the
  // warp noise or any segment math
  let anyNear = false;
  for (const road of SMOOTH_ROADS) {
    if (x >= road.minX && x <= road.maxX && z >= road.minZ && z <= road.maxZ) {
      anyNear = true;
      break;
    }
  }
  if (!anyNear) return Infinity;
  // the meander: warp the query, and the whole road wanders in response
  const wx = x + (fbm2(x * 0.045, z * 0.045, 9203, 2) - 0.5) * ROAD_MEANDER;
  const wz = z + (fbm2(x * 0.045 + 37, z * 0.045 - 11, 9205, 2) - 0.5) * ROAD_MEANDER;
  let best2 = Infinity;
  for (const road of SMOOTH_ROADS) {
    if (wx < road.minX || wx > road.maxX || wz < road.minZ || wz > road.maxZ) continue;
    const pts = road.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const apx = wx - a.x;
      const apz = wz - a.z;
      const len2 = abx * abx + abz * abz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apz * abz) / len2)) : 0;
      const dx = apx - abx * t;
      const dz = apz - abz * t;
      const d2 = dx * dx + dz * dz;
      if (d2 < best2) best2 = d2;
    }
  }
  return Math.sqrt(best2);
}

// Deterministic decoration placement (trees, rocks) — used by the renderer,
// kept here so it shares the seed and stays out of mob camps / hubs / roads /
// lakes. Density and mix vary by biome: the vale is wooded, the marsh sparse
// and scrubby, the peaks rocky with hardy pines.
export interface Decoration {
  kind: 'tree' | 'tree2' | 'rock';
  x: number;
  z: number;
  scale: number;
  variant: number;
  biome: BiomeId;
}

const DECORATION_EXCLUSION_RADIUS = 1.2;
const DECORATION_EXCLUSIONS = [{ x: 2.456450840458274, z: 211.33819991815835 }];

function isExcludedDecoration(x: number, z: number): boolean {
  return DECORATION_EXCLUSIONS.some(
    (p) => Math.hypot(x - p.x, z - p.z) < DECORATION_EXCLUSION_RADIUS,
  );
}

export function zoneBiomeAt(x: number, z: number): BiomeId {
  let fallback: { biome: BiomeId; zMax: number } | null = null;
  let northmost = ZONES[0];
  for (const zone of ZONES) {
    if (zone.zMax > northmost.zMax) northmost = zone;
    if (z >= zone.zMax) continue;
    if (fallback === null || zone.zMax < fallback.zMax) {
      fallback = { biome: zone.biome, zMax: zone.zMax }; // southmost band containing z
    }
    const x0 = zone.xMin ?? STRIP_MIN_X;
    const x1 = zone.xMax ?? STRIP_MAX_X;
    if (z >= zone.zMin && x >= x0 && x < x1) return zone.biome;
  }
  return fallback ? fallback.biome : northmost.biome;
}

// Paint grid id -> biome. APPEND-ONLY: the id is persisted in map documents.
export const BIOME_BY_ID: BiomeId[] = [
  'vale',
  'marsh',
  'peaks',
  'beach',
  'desert',
  'volcano',
  'cave',
];

// The painted biome at (x,z), or null if unpainted / no paint layer. Cheap grid
// lookup; absent for the built-in world (getActiveWorldContent has no biomePaint).
function paintedBiomeAt(x: number, z: number): BiomeId | null {
  const bp = getActiveWorldContent().biomePaint;
  if (!bp) return null;
  const c = Math.floor((x - bp.originX) / bp.cell);
  const r = Math.floor((z - bp.originZ) / bp.cell);
  if (c < 0 || c >= bp.cols || r < 0 || r >= bp.rows) return null;
  const id = bp.ids[r * bp.cols + c];
  return id >= 0 && id < BIOME_BY_ID.length ? BIOME_BY_ID[id] : null;
}

// Biome at a world point: the painted override if any (map editor), else the
// zone-band biome. This is the 2D biome the renderer colours by; zoneBiomeAt
// stays the grid version. With no paint layer this equals zoneBiomeAt(x, z).
export function biomeAt(x: number, z: number): BiomeId {
  return paintedBiomeAt(x, z) ?? zoneBiomeAt(x, z);
}

// Scatter props (trees, boulders) are anchored to terrainHeight at their exact
// (x, z). On a near-vertical rim/ridge wall a prop juts out of the face and
// reads as floating, and (via colliders.ts) a large rock or trunk there is also
// an invisible collider on the cliff. Reject any candidate whose local terrain
// is steeper than this: it matches PLAYER_MAX_CLIMB_SLOPE (the impassable-wall
// gate), so only genuine walls are cleared and rolling interior hills keep
// their props. Grass and ground dressing already refuse cliffs the same way
// (foliage.ts tooSteep / GRASS_MAX_SLOPE); this brings the big props in line.
// Pinned as a literal by tests/fixes.test.ts.
export const DECORATION_MAX_SLOPE = 1.5;

/** True where the ground is too steep to anchor a surface prop: the shared gate
 * for every scatter that snaps to terrainHeight (the generic tree/rock props
 * below, the Palmreach palms and their coconut clusters). Four heightfield
 * samples, so callers check it LAST, after their cheaper gates. */
export function isCliffFace(x: number, z: number, seed: number): boolean {
  return terrainSteepness(x, z, seed) > DECORATION_MAX_SLOPE;
}

const DECORATION_STEP = 10;
const DECORATION_X_START = -(WORLD_MAX_X - 14);
const DECORATION_X_END = WORLD_MAX_X - 14;
const DECORATION_Z_START = WORLD_MIN_Z + 14;
const DECORATION_Z_END = WORLD_MAX_Z - 14;
const DECORATION_JITTER = DECORATION_STEP / 2;

// Evaluate one stable decoration-grid anchor. Keeping every gate in this one
// function lets the renderer enumerate the whole field while collision asks
// only for the handful of anchors near a queried spatial cell. The latter is
// important now that the world spans multiple columns: eagerly rebuilding the
// entire field in every isolated test worker made the first Sim in each file
// pay for thousands of terrain samples it never touched.
function decorationAt(seed: number, gx: number, gz: number): Decoration | null {
  const r = hash2(Math.round(gx), Math.round(gz), seed + 31);
  const biome = zoneBiomeAt(gx, gz);
  // density gate + kind mix per biome
  let kind: Decoration['kind'] | null = null;
  if (biome === 'vale') {
    if (r > 0.48) return null;
    kind = r < 0.3 ? 'tree' : r < 0.4 ? 'tree2' : 'rock';
  } else if (biome === 'marsh') {
    if (r > 0.34) return null;
    kind = r < 0.08 ? 'tree' : r < 0.26 ? 'tree2' : 'rock';
  } else if (biome === 'dusk') {
    // the hollow is a glade: sparse pines, more twisted elders and stone;
    // the dense mushroom flora comes from ground dressing and realm props
    if (r > 0.38) return null;
    kind = r < 0.14 ? 'tree' : r < 0.28 ? 'tree2' : 'rock';
  } else if (biome === 'ember') {
    // the gatewood thins mile by mile into open waste: trees fade out
    // northward, scorched rock takes over (the widened rock band keeps the
    // waste strewn with boulders the way a volcanic plain reads)
    const t = Math.max(0, Math.min(1, (gz - 1560) / 170));
    const treeGate = 0.36 * (1 - t) + 0.05 * t;
    if (r > treeGate + 0.2 + t * 0.16) return null; // rockier as the waste opens
    kind = r < treeGate * 0.55 ? 'tree' : r < treeGate ? 'tree2' : 'rock';
    // no boulders inside the modeled lava network: the melt pads, the river
    // beds, and the shaped basins stay clear (a rock there is also a stray
    // collider standing in the melt)
    if (gz > 2160 && gz < 2360 && emberLinkDistanceNorm(gx, gz) < 1.1) return null;
    // the Last Keep's graded grounds carry no wild scatter
    if (castlePadWeight(gx, gz) > 0) return null;
    for (const pool of EMBER_FLAT_POOLS) {
      if (Math.hypot(gx - pool.x, gz - pool.z) < pool.r * 1.6 + 4) return null;
    }
    for (const pool of EMBER_LAVA_POOLS) {
      if (Math.hypot(gx - pool.x, gz - pool.z) < pool.r * 1.7 + 4) return null;
    }
  } else if (biome === 'frost') {
    // hardy pines and broken stone on the snow benches
    if (r > 0.36) return null;
    kind = r < 0.18 ? 'tree' : r < 0.23 ? 'tree2' : 'rock';
  } else if (biome === 'amber') {
    // a dense fire-colored weald, broadleaf-heavy
    if (r > 0.5) return null;
    kind = r < 0.12 ? 'tree' : r < 0.42 ? 'tree2' : 'rock';
  } else if (biome === 'fen') {
    // open and soft: scattered broadleafs, very little stone
    if (r > 0.3) return null;
    kind = r < 0.06 ? 'tree' : r < 0.26 ? 'tree2' : 'rock';
  } else if (biome === 'night') {
    // open moon meadows: sparse silvered groves, standing stones between
    if (r > 0.28) return null;
    kind = r < 0.08 ? 'tree' : r < 0.2 ? 'tree2' : 'rock';
  } else if (biome === 'haunt') {
    // the densest forest in the world: the canopy is the realm
    if (r > 0.62) return null;
    kind = r < 0.3 ? 'tree' : r < 0.54 ? 'tree2' : 'rock';
  } else if (biome === 'jungle') {
    // wall-to-wall broadleaf inland; the palms on the beaches are the
    // render module's (this grid skips the low sand shelf below)
    if (terrainHeight(gx, gz, seed) < 3) return null;
    if (r > 0.58) return null;
    kind = r < 0.1 ? 'tree' : r < 0.5 ? 'tree2' : 'rock';
  } else if (biome === 'garden') {
    // open parkland: sparse specimen trees on the lawns, and the maze
    // keeps its corridors clear (the hedges are terrain, not dressing)
    if (inGardenMaze(gx, gz)) return null;
    if (r > 0.3) return null;
    kind = r < 0.16 ? 'tree' : r < 0.2 ? 'tree2' : 'rock';
  } else if (biome === 'gale') {
    // wind-scoured downs: rock outcrops everywhere, and hardy windbreak
    // trees scattered across the open land between them
    if (r > 0.22) return null;
    kind = r < 0.09 ? 'tree' : r < 0.14 ? 'tree2' : 'rock';
  } else {
    if (r > 0.44) return null;
    kind = r < 0.2 ? 'tree' : r < 0.24 ? 'tree2' : 'rock';
  }
  // grid cells outside every zone rect are open sea between columns
  let inRect = false;
  for (const zn of ZONES) {
    if (gz < zn.zMin || gz >= zn.zMax) continue;
    if (gx < (zn.xMin ?? STRIP_MIN_X) || gx >= (zn.xMax ?? STRIP_MAX_X)) continue;
    inRect = true;
    break;
  }
  if (!inRect) return null;
  const ox = (hash2(Math.round(gx), Math.round(gz), seed + 57) - 0.5) * DECORATION_STEP;
  const oz = (hash2(Math.round(gx), Math.round(gz), seed + 91) - 0.5) * DECORATION_STEP;
  const x = gx + ox,
    z = gz + oz;
  if (isExcludedDecoration(x, z)) return null;
  // The Sowfield stadium footprint grows no trees or rocks (hash-based
  // placement, so skipping here shifts no other decoration or rng draw).
  if (isInSowfieldShell(x, z)) return null;
  // The Galecrest paddock is a worked yard and race course. Keep the same
  // deterministic decoration field out of its apron so no tree becomes an
  // invisible obstacle across a jump line.
  if (
    x > STABLE_PADDOCK.x1 - 1 &&
    x < STABLE_PADDOCK.x2 + 1 &&
    z > STABLE_PADDOCK.z1 - 1 &&
    z < STABLE_PADDOCK.z2 + 1
  ) {
    return null;
  }
  // No rock or stunted tree grows up through Wickharbor's boardwalk planks.
  if (galeDeckSurface(x, z, (sx, sz) => terrainHeight(sx, sz, seed), WATER_LEVEL) !== -Infinity) {
    return null;
  }
  if (!reachDeckClear(x, z, 1)) return null;
  // The Old Beacon's lawn stays clear (nothing crowds the lighthouse stair),
  // and the raider encampments keep trees and rocks off their level pads.
  {
    const bdx = x - 498,
      bdz = z - 308;
    if (bdx * bdx + bdz * bdz < 20 * 20) return null;
    for (const camp of GALE_LEVEL_PADS) {
      const cdx = x - camp.x,
        cdz = z - camp.z;
      if (cdx * cdx + cdz * cdz < 13 * 13) return null;
    }
  }
  for (const zone of ZONES) {
    const dx = x - zone.hub.x,
      dz = z - zone.hub.z;
    if (Math.sqrt(dx * dx + dz * dz) < zone.hub.radius + 4) return null;
  }
  if (terrainHeight(x, z, seed) < WATER_LEVEL + 1) return null;
  if (roadDistance(x, z) < 5) return null;
  for (const c of CAMPS) {
    const dx = x - c.center.x,
      dz = z - c.center.z;
    if (Math.sqrt(dx * dx + dz * dz) < c.radius + 3) return null;
  }
  // no scatter on cliff faces: a prop anchored to the surface here floats
  // off the wall (and large ones would be phantom colliders). Checked last,
  // after the cheaper gates, so the four-sample steepness only runs for
  // candidates that survive everything else.
  if (isCliffFace(x, z, seed)) return null;
  return {
    kind,
    x,
    z,
    scale: 0.7 + hash2(Math.round(gx), Math.round(gz), seed + 13) * 0.9,
    variant: Math.floor(hash2(Math.round(gx), Math.round(gz), seed + 77) * 3),
    biome,
  };
}

function decorationAnchorCount(start: number, end: number): number {
  return Math.max(0, Math.ceil((end - start) / DECORATION_STEP));
}

function appendDecorationRange(
  out: Decoration[],
  seed: number,
  xFirst: number,
  xEnd: number,
  zFirst: number,
  zEnd: number,
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number },
): void {
  for (let xi = xFirst; xi < xEnd; xi++) {
    const gx = DECORATION_X_START + xi * DECORATION_STEP;
    for (let zi = zFirst; zi < zEnd; zi++) {
      const gz = DECORATION_Z_START + zi * DECORATION_STEP;
      const decoration = decorationAt(seed, gx, gz);
      if (!decoration) continue;
      if (
        bounds &&
        (decoration.x < bounds.minX ||
          decoration.x > bounds.maxX ||
          decoration.z < bounds.minZ ||
          decoration.z > bounds.maxZ)
      ) {
        continue;
      }
      out.push(decoration);
    }
  }
}

/**
 * Return the exact subset of the deterministic decoration field whose centers
 * fall inside `bounds`. Candidate anchors include the full placement jitter,
 * so filtering this result is byte-for-byte equivalent to filtering
 * `generateDecorations(seed)` without paying to evaluate the other realms.
 */
export function generateDecorationsInBounds(
  seed: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): Decoration[] {
  if (bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) return [];
  const xCount = decorationAnchorCount(DECORATION_X_START, DECORATION_X_END);
  const zCount = decorationAnchorCount(DECORATION_Z_START, DECORATION_Z_END);
  const first = (value: number, start: number, count: number): number =>
    Math.max(0, Math.min(count, Math.ceil((value - DECORATION_JITTER - start) / DECORATION_STEP)));
  const end = (value: number, start: number, count: number): number =>
    Math.max(
      0,
      Math.min(count, Math.floor((value + DECORATION_JITTER - start) / DECORATION_STEP) + 1),
    );
  const xFirst = first(bounds.minX, DECORATION_X_START, xCount);
  const xEnd = end(bounds.maxX, DECORATION_X_START, xCount);
  const zFirst = first(bounds.minZ, DECORATION_Z_START, zCount);
  const zEnd = end(bounds.maxZ, DECORATION_Z_START, zCount);
  const out: Decoration[] = [];
  appendDecorationRange(out, seed, xFirst, xEnd, zFirst, zEnd, bounds);
  return out;
}

export function generateDecorations(seed: number): Decoration[] {
  const out: Decoration[] = [];
  appendDecorationRange(
    out,
    seed,
    0,
    decorationAnchorCount(DECORATION_X_START, DECORATION_X_END),
    0,
    decorationAnchorCount(DECORATION_Z_START, DECORATION_Z_END),
  );
  return out;
}
