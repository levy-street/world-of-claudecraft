// The serializable custom-map document: the editor's save format, the JSON a
// player exports/imports, and the JSONB the server stores for saved/forked maps.
// Lives in src/sim (DOM-free, deterministic) because BOTH sides must agree on
// what a valid document is: the editor parses untrusted local files with the
// exact sanitizer the server applies to untrusted uploads. Never throws: every
// field is validated, clamped, and def-filled; an unsalvageable input returns
// null. The wire/storage shape is CustomMap v1 plus the optional v2 fields
// (waterLevel, playerStart, meta.description/parentId, stamp mode, placement
// collide + collideRadius, blockers, propsMode, decorationsMode), so every v1
// document parses unchanged.

import {
  CAMP_STAT_MOD_KEYS,
  campStatModsAreStock,
  MAX_AUTHORED_CAMP_LEVEL,
  MAX_CAMP_RESPAWN_SECONDS,
  MIN_CAMP_RESPAWN_SECONDS,
  MOB_STAT_MOD_MAX,
  MOB_STAT_MOD_MIN,
} from './camp_authoring';
import {
  CAVE_MAX_MULT,
  CAVE_MAX_RADIUS,
  CAVE_MIN_MULT,
  CAVE_MIN_RADIUS,
  CAVE_SPIKE_SIZE_MAX,
  CAVE_SPIKE_SIZE_MIN,
  MAX_CAVE_NODES,
  MAX_CAVES,
  sanitizeCaveNode,
} from './caves';
import { sanitizeAssetFireEmitters } from './fire_effects';
import { type FoliageParams, sanitizeFoliageParams } from './foliage_params';
import type { GrassClearCircle } from './grass_clear';
import {
  CUT_MAX_BLEND,
  MAX_HOLE_PATCHES,
  MAX_TERRAIN_HOLES,
  sanitizeTerrainCut,
} from './terrain_cuts';
import type {
  AssetFireEmitter,
  AuthorVfx,
  AuthorVfxPreset,
  BiomePaint,
  BlockerDef,
  CampDef,
  CampStatMods,
  CaveDef,
  CaveNode,
  CavePatch,
  CustomPaintSwatch,
  DetailRegion,
  GroundObjectDef,
  HeightStamp,
  MapDecal,
  MapLighting,
  MapMusic,
  MapPointSound,
  MapPresentationMode,
  MapWeather,
  NpcDef,
  NpcRoute,
  NpcRoutePoint,
  TerrainCut,
  TerrainStyle,
  WeatherPrecipMode,
  ZoneAtmosphere,
  ZoneDef,
} from './types';
import { ALL_BIOME_IDS, BIOME_BY_ID } from './world';
import { WORLD_SEED } from './world_seed';

export const MAP_DOC_VERSION = 2;

// Hard caps applied by the sanitizer (the server stores what the sanitizer
// returns, so these bound document size and playtest cost).
// Terrain stamps are spatially indexed (world.ts EDIT_INDEX_CELL), so
// per-sample cost tracks LOCAL stamp density, not the total; 10k stamps is
// ~80KiB JSON, well under the 2MiB server payload cap. The cap still exists
// so a hostile document cannot stall the editor's chunk rebuilds.
export const MAX_TERRAIN_EDITS = 10_000;
// Remesh detail regions (the Carve tool's Remesh brush).
export const MAX_DETAIL_REGIONS = 128;
export const MAX_DETAIL_RADIUS = 60;
export const DETAIL_CELL_MIN = 0.25;
export const DETAIL_CELL_MAX = 2;
// Headroom to convert the WHOLE built-in world's procedural scatter (trees,
// rocks, AND ground dressing) into editable placements on top of its ~1k
// authored props, a converted city, and the maker's own additions ("make all
// foliage editable" on a fully built-out map needs ~12.5k alone; 12k clipped
// the conversion and stranded the tail as uneditable procedural scatter).
// Placed decor is distance-culled at render (LOD_RANGE_ASSETS), matrix-frozen,
// and tree-instanced, so only nearby clones draw; the cap still bounds
// document size and playtest cost.
export const MAX_PLACEMENTS = 16_000;
export const MAX_DECORATION_EXCLUSIONS = MAX_PLACEMENTS;
// Grass-clear discs. A large brush (up to 300yd) clears a huge area per stamp,
// so a few thousand discs cover any map; the cap bounds document size and the
// render query's spatial index.
export const MAX_GRASS_CLEAR = 4000;
export const MAX_CAMPS = 600;
export const MAX_NPCS = 200;
export const MAX_OBJECTS = 400;
// The built-in grid world ships 14 zones (the original strip plus the east/west
// realm columns), so the editor's zone cap sits above that with headroom for a
// few custom zones. (It was 12 in the 3-zone-strip era.)
export const MAX_ZONES = 24;
// 256, not 64: the SHIPPED world already carries 91 roads, so the old bound
// silently truncated 27 of them out of every authored map the moment it was
// sanitized — and roads flatten terrain and carve paths, so the map lost shape,
// not just decoration. The cap exists to bound a hostile document, and 256
// still does that with room for the world to grow.
export const MAX_ROADS = 256;
export const MAX_ROAD_POINTS = 256;
// City Build: wall runs and authored road defs (compact polyline records the
// editor derives placements / road polylines from). Points are capped so a
// hostile document cannot make the generator emit unbounded pieces.
export const MAX_WALL_RUNS = 128;
export const MAX_WALL_RUN_POINTS = 64;
export const MAX_ROAD_DEFS = MAX_ROADS;
// NPC patrol routes (City Build Routes subtool): waypoint count and wait are
// clamped so playtest route following stays bounded.
export const MAX_NPC_ROUTE_POINTS = 64;
export const MAX_NPC_ROUTE_WAIT = 600;
export const NPC_ROUTE_SPEED_MIN = 0.5;
export const NPC_ROUTE_SPEED_MAX = 8;
export const MAX_NAME_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_AUTHORING_NOTES_LENGTH = 2000;
export const MIN_WATER_LEVEL = -40;
export const MAX_WATER_LEVEL = 40;
// Playtest-cost bounds for gameplay arrays: the Sim spawns camp.count mobs per
// camp and one ground object per position, so both are hard-clamped here (the
// built-in camps top out at count 14; see src/sim/content/zone*.ts).
export const MAX_CAMP_COUNT = 20;
export const MAX_CAMP_RADIUS = 100;
export const MAX_OBJECT_POSITIONS = 100;
export const MAX_ID_LENGTH = 64;
// Generous world-coordinate bound (the built-in world spans ~360yd); camp, NPC,
// and object coordinates are clamped into it so a hostile document cannot park
// gameplay content at astronomical positions.
export const MAX_WORLD_COORD = 10_000;
// Zone sub-arrays feed terrainHeight per sampled vertex (lakes) and the
// decoration generator loop bounds (zMin/zMax), so a stored map must not be
// able to carry unbounded values a viewer's tab then pays for.
export const MAX_ZONE_LAKES = 32;
export const MAX_ZONE_POIS = 64;
export const MAX_STR_ARRAY = 64;

const AUTHOR_VFX_PRESETS = new Set<AuthorVfxPreset>([
  'arcane',
  'fire',
  'frost',
  'holy',
  'nature',
  'shadow',
]);
// Per-placement collision-radius override bounds (yards). The derived
// collideRadiusFor(scale, assetId) shares the same cap; both stay bounded so a
// hostile document cannot wall off the world with one placement.
export const MIN_COLLIDE_RADIUS = 0.1;
export const MAX_COLLIDE_RADIUS = 30;
// Invisible blocker walls: entry cap and per-segment length bounds (yards).
// Each blocker becomes one static OBB collider at playtest, so both the count
// and the segment length are hard-clamped here.
export const MAX_BLOCKERS = 128;
// Named locations (authored sub-zone rects), AI marker points, and authored
// point lights. Lights are capped hard: each rides the renderer's ranked
// point-light budget.
export const MAX_LOCATIONS = 64;
export const MAX_MARKERS = 128;
export const MAX_LIGHTS = 24;
export const MAX_POINT_SOUNDS = 32;
export const MAX_SOUND_ID_LENGTH = 40;
// Ground decals. The cap is generous because decals are streamed: only those
// within render/decals.ts' view range are meshed and only their textures are
// fetched, so an unstamped corner of the map costs one record in the document.
export const MAX_DECALS = 400;
export const MIN_DECAL_SIZE = 0.5;
export const MAX_DECAL_SIZE = 120;
export const DEFAULT_DECAL_SIZE = 8;
const TAU = Math.PI * 2;
export const MAX_LOCATION_NAME = 40;
// Ambience animation speed (map "world speed"): render-cosmetic motion only.
export const MIN_TIME_SCALE = 0.25;
export const MAX_TIME_SCALE = 2;
// Placed-asset view distance (yards from the camera): how far free-placed decor
// renders before it fades out and culls, capped at the fog either way. Render-
// only performance knob; never affects gameplay. MAX reads as "to the fog".
export const MIN_ASSET_VIEW_DISTANCE = 120;
export const MAX_ASSET_VIEW_DISTANCE = 2000;
export const DEFAULT_ASSET_VIEW_DISTANCE = 500;
export const MIN_BLOCKER_LENGTH = 0.5;
export const MAX_BLOCKER_LENGTH = 200;
// Collider-volume placement dimensions (yards): footprint sides are bounded
// like blocker segments so one hostile placement cannot wall the world; the
// vertical size doubles as a plane's floor offset, so it may be negative.
export const MIN_COLLIDER_SIZE = 0.1;
export const MAX_COLLIDER_SIZE = 200;
export const MIN_COLLIDER_SIZE_Y = -100;
export const MAX_COLLIDER_SIZE_Y = 100;
// Custom biome-paint swatch ids live well clear of the built-in BIOME_BY_ID
// range and of 255 (unpainted). New swatches are minted from the PRIMARY
// window first, so any map with 51 or fewer of them carries exactly the ids it
// always did (and still opens in a build that only knows this window).
export const CUSTOM_PAINT_ID_MIN = 200;
export const CUSTOM_PAINT_ID_MAX = 250;
// Overflow window, used only once the primary one fills: everything above the
// built-in biome ids (BIOME_BY_ID has 7, one spare left for a future biome) and
// below the primary window. Together they hold far more than the swatch cap, so
// "no free id" is unreachable in practice.
export const CUSTOM_PAINT_ID_EXT_MIN = 8;
export const CUSTOM_PAINT_ID_EXT_MAX = 199;
// The palette cap. Sized so a map can paint every built-in ground texture (54)
// plus imports and colour swatches; the renderer allocates per texture actually
// used, so a big palette costs nothing until it is used.
export const MAX_CUSTOM_PAINT_SWATCHES = 128;

/** Is `id` a paint id belonging to a custom swatch (either window)? */
export function isCustomPaintId(id: number): boolean {
  return (
    (id >= CUSTOM_PAINT_ID_MIN && id <= CUSTOM_PAINT_ID_MAX) ||
    (id >= CUSTOM_PAINT_ID_EXT_MIN && id <= CUSTOM_PAINT_ID_EXT_MAX)
  );
}

/** The lowest custom-swatch id not in `used`, primary window first (-1 = none). */
export function nextCustomPaintId(used: ReadonlySet<number>): number {
  for (let id = CUSTOM_PAINT_ID_MIN; id <= CUSTOM_PAINT_ID_MAX; id++) {
    if (!used.has(id)) return id;
  }
  for (let id = CUSTOM_PAINT_ID_EXT_MIN; id <= CUSTOM_PAINT_ID_EXT_MAX; id++) {
    if (!used.has(id)) return id;
  }
  return -1;
}
export const MAX_SWATCH_LABEL_LENGTH = 24;
// Per-axis scale multipliers (gizmo axis handles) share the uniform scale's
// bounds, so the combined per-axis scale stays within sane document limits.
export const MIN_AXIS_SCALE = 0.05;
export const MAX_AXIS_SCALE = 50;
// A placement's vertical offset above its terrain seat (the gizmo's Y arrow).
export const MAX_PLACEMENT_Y_OFFSET = 200;
// Max length of a placement's editor display name (Scene Collection rename).
export const MAX_PLACEMENT_NAME_LENGTH = 40;

// The collision types a placement can use (the Selection panel's dropdown).
export type CollisionMode = 'baked' | 'basic' | 'mesh' | 'none';

/** A shipped region that can be opened as an editable map and exported back
 *  as production content. Ravenrift (the battleground) is the first; dungeons,
 *  delves and the arena share its fixed-origin pattern. */
export type RegionId = 'ravenrift';

/**
 * What a placement on a region map means to the GAME MODE, as opposed to what
 * it looks like.
 *
 * Cover, walls, crates and rubble need no role: on a region map they are
 * ordinary placements that render themselves and collide with their own baked
 * collision, exactly like on any other map. Only the anchors the mode logic
 * reasons about - where a flag lives, where a team respawns, where a rune pad
 * or graveyard sits - cannot be inferred from a model, so the loader stamps
 * them and the export reads them straight back into the region's record.
 *
 * The team is part of the role rather than derived from which half of the field
 * a placement sits in, so dragging a flag across the midline moves the flag
 * instead of silently changing sides.
 */
export type RegionRole =
  | 'flag0'
  | 'flag1'
  | 'spawn0'
  | 'spawn1'
  | 'banner0'
  | 'banner1'
  | 'graveyard0'
  | 'graveyard1'
  | 'speedRune'
  | 'powerRune';

const REGION_IDS: readonly RegionId[] = ['ravenrift'];
const REGION_ROLES: readonly RegionRole[] = [
  'flag0',
  'flag1',
  'spawn0',
  'spawn1',
  'banner0',
  'banner1',
  'graveyard0',
  'graveyard1',
  'speedRune',
  'powerRune',
];

export function isRegionId(v: unknown): v is RegionId {
  return typeof v === 'string' && (REGION_IDS as readonly string[]).includes(v);
}

export function isRegionRole(v: unknown): v is RegionRole {
  return typeof v === 'string' && (REGION_ROLES as readonly string[]).includes(v);
}

/** One editable hitbox: an AssetCollisionBox with an optional per-box yaw
 *  (radians, on top of the placement's rotY). Normalized model space. */
export interface MapHitbox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  ry?: number;
}

/** A Collision Master authored WALKABLE ramp deck (normalized model space):
 *  a rect centered (x, z) with half extents (hx, hz), optionally yawed by
 *  `ry`, whose walkable floor rises linearly along the rect's local +X from
 *  `y0` (at -hx) to `y1` (at +hx). Placements of the asset RAISE the walkable
 *  ground along the deck instead of blocking, so the player just walks up —
 *  exactly like the baked stairs decks (sim/placement_ramps.ts). */
export interface AuthoredCollisionRamp {
  x: number;
  z: number;
  hx: number;
  hz: number;
  ry?: number;
  y0: number;
  y1: number;
}

export const MAX_PLACEMENT_HITBOXES = 64;
export const MAX_PLACEMENT_RAMPS = 16;

/** The collision type a placement effectively uses: the authored mode, else
 *  the legacy derive (pre-dropdown documents keep their exact behavior). */
export function effectiveCollisionMode(
  p: Pick<MapPlacement, 'collide' | 'collisionMode' | 'collideRadius' | 'collideShape'>,
): CollisionMode {
  if (p.collisionMode) return p.collisionMode;
  if (!p.collide) return 'none';
  if (p.collideRadius !== undefined || p.collideShape === 'square') return 'basic';
  return 'baked';
}

// A free-form GLB placement from the asset catalogue. `collide` opts the
// placement into a sim circle collider at playtest (see collideRadiusFor).
export interface MapPlacement {
  // Stable target id for systems attached to this placement. Old documents do
  // not need one until an attachment is authored.
  uid?: string;
  // City Build ownership: the id of the WallRunDef (or future city generator)
  // this placement was derived from. Editing or deleting that run removes and
  // regenerates every placement carrying its id. Absent = hand-placed.
  cityId?: string;
  /** Combine (editor): placements sharing a groupId pick, drag, rotate and
   *  delete as ONE object. Absent = an ordinary independent placement. */
  groupId?: string;
  assetId: string; // catalogue id, e.g. "props/well"
  x: number;
  z: number;
  rotY: number; // radians
  scale: number;
  collide: boolean;
  // Semantic carried by converted shipped-world scenery. It keeps gameplay
  // behavior (jumpable fences and inn resting areas) attached while the
  // ordinary placement transform fields remain the visual/source of truth.
  worldPropKind?: 'fence' | 'inn';
  worldPropWidth?: number;
  worldPropDepth?: number;
  // Optional collision-radius override in yards (clamped to
  // [MIN_COLLIDE_RADIUS, MAX_COLLIDE_RADIUS]); absent = derive from scale via
  // collideRadiusFor. Only meaningful while collide is true, but stored either
  // way so toggling collide off and back on keeps the authored radius.
  collideRadius?: number;
  // Footprint shape: absent = circle; 'square' = a yaw-following OBB whose
  // half-extents equal the (derived or overridden) radius.
  collideShape?: 'square';
  // v2 optional: per-axis dimensions for 'collider/<kind>' placements (yards
  // at scale 1; see sim/collider_volumes.ts). Absent = the kind's default.
  // Ignored for ordinary model placements.
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  // v2 optional: extra visual transform axes (the editor's 3-axis gizmo).
  // rotX/rotZ tilt the MODEL only (radians; collision keeps its yaw-only
  // footprint); scaleX/Y/Z multiply the uniform scale per axis. Absent = 0 / 1.
  rotX?: number;
  rotZ?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  // v2 optional: vertical offset above the terrain seat (yards; the gizmo's Y
  // arrow). Visual only: the circle collider stays at ground level.
  y?: number;
  // v3 optional (editor): grabbing a placement with the Move tool DETACHES it
  // from the terrain seat, its world Y stops tracking terrainHeight so the maker
  // can float it anywhere. `groundY` freezes the terrain height captured at detach
  // time; the model seats at groundY - minY*scaleY + y. Render-only like `y`:
  // the sim collider stays at ground level (collision is 2D).
  detached?: boolean;
  groundY?: number;
  // v3 optional (editor): the Scene Collection panel's per-object display name
  // (double-click to rename). Absent = the derived catalogue/collider label.
  name?: string;
  // v3 optional (editor): hidden from the EDITOR viewport only (the Scene
  // Collection eyeball). The object still exists in the map and renders in
  // playtest/export; this flag only skips it in the editor's 3D + 2D overlays.
  hidden?: boolean;
  // v4 optional: on a REGION map (see MapDoc.regionSource), the GAME-MODE
  // anchor this placement stands for - a team's flag, a respawn point, a rune
  // pad. The region loader stamps it and the export reads it straight back into
  // the region's record; everything untagged exports as ordinary content that
  // renders and collides on its own. Absent on ordinary maps.
  regionRole?: RegionRole;
  // v3 optional: the placement's collision type. Absent = legacy derive:
  // 'none' when collide is false, 'basic' when a hand-authored radius/square
  // exists, else 'baked' (per-asset baked boxes with circle fallback).
  // 'mesh' = "true collision": a fine re-bake of the actual model geometry
  // (MapDoc.assetCollisionMesh), the expensive edge-case option.
  collisionMode?: CollisionMode;
  // v3 optional: hand-edited hitboxes overriding the baked box set (normalized
  // model space like AssetCollisionBox, plus an optional per-box yaw). Only
  // read in 'baked' mode; absent = the asset's baked/imported boxes.
  hitboxes?: MapHitbox[];
  // v3 optional: per-placement WALKABLE ramp decks (normalized model space).
  // The Collision Master scene derives these live from its ramp-flagged
  // volumes so a playtest walks the decks BEFORE Lock In persists them; when
  // present they replace the asset's authored/generated deck table
  // (sim/placement_ramps.ts). Absent on ordinary placements.
  ramps?: AuthoredCollisionRamp[];
  // v3 optional: fluid-volume fields for 'fluid/<kind>' placements (see
  // sim/fluid_volumes.ts). fluidDps = damage per second while submerged
  // (0..50; absent = the kind's preset); fluidFx = effect toggle bits
  // (1 bubbles, 2 smoke, 4 haze, 8 light; absent = the preset's set).
  // Ignored for ordinary model placements.
  fluidDps?: number;
  fluidFx?: number;
  // v2 optional: grass hue override in degrees [0, 360] for 'grass/patch'
  // placements (the foliage brush's animated grass). Absent = the game's
  // default grass tint. Ignored for ordinary model placements.
  hue?: number;
  // v2 optional, grass patches only: blade lightness [0, 1] (absent = the
  // default meadow lightness) and tufts per patch [1, 60] (absent = the
  // default clump; 1 = a single strand).
  lum?: number;
  clump?: number;
  // v2 optional: per-placement material overrides (the asset library's shader
  // tweaks). tint multiplies the albedo (0xFFFFFF = unchanged); opacity < 1
  // renders the model transparent; glow adds an emissive color scaled by
  // glowStrength. Applied in editor AND playtest.
  tint?: number;
  opacity?: number;
  glow?: number;
  glowStrength?: number;
  // v2 optional: animated fire effect at the model's top (render-only; a
  // campfire-style light joins the playtest boot set). Absent = none.
  fire?: boolean;
  // v3 optional: independently positioned procedural fire emitters. This is
  // authoritative when non-empty; `fire` remains the legacy one-flame flag.
  fireEffects?: AssetFireEmitter[];
  // Generated rock (ROCK_ASSET_ID) shape parameters: deterministic seed plus
  // the generator sliders. Absent on ordinary placements.
  rockSeed?: number;
  rockNoise?: number;
  rockDetail?: number;
  rockSharp?: number;
  rockTex?: number;
  // v3 rock params: vertical stretch (0.3..3, 1 = round boulder), ground embed
  // (0..1 of the rock's height sunk below the seat line), extra high-frequency
  // ridged displacement (0..1 "jaggedness"), and a built-in terrain texture
  // set key overriding the numeric rockTex look (render/terrain_texture_sets).
  rockHeight?: number;
  rockDepth?: number;
  rockJag?: number;
  rockTexId?: string;
  rockTexTile?: number;
  // Merged rock ridge (ROCK_RIDGE_ASSET_ID): the chain's control nodes as
  // anchor-relative offsets, each with its girth radius (yards) and a height
  // multiplier, polygonized into ONE solid body by the renderer.
  rockNodes?: { dx: number; dz: number; dy: number; r: number; h: number }[];
  // Custom built model (MODEL_ASSET_ID): the editable mesh volumes (Build
  // tool). Rendered as one textured solid (render/model_gen.ts); the editor's
  // truth AND the render source. A ramp-flagged volume renders solid but locks
  // in as a WALKABLE deck. Absent on ordinary placements.
  meshes?: PlacementMesh[];
  // Built model surface texture: a built-in terrain texture set key
  // (render/terrain_texture_sets.ts) and its tile size in yards per repeat.
  // Absent = a neutral matte surface tinted by `tint`.
  modelTexId?: string;
  modelTexTile?: number;
  /** Object-material adjustments for a built model (render/model_gen.ts):
   *  hue rotation in degrees (-180..180), saturation multiplier (0..2, 1 =
   *  as shot) and light (-1 darkest .. 1 lightest, 0 = as shot). */
  modelHue?: number;
  modelSat?: number;
  modelLight?: number;
  // Generated foliage (TREE_ASSET_ID): the whole generator recipe in one
  // nested record - the kind of plant, plus foundation trunk, branch growth,
  // canopy volumes and leaf scatter (sim/foliage_params.ts). One record rather
  // than thirty flat fields because the generator genuinely has that many
  // knobs and they must survive save, load, copy and undo together. Absent on
  // ordinary placements; a record with no `kind` is a tree, which is what
  // every placement authored before the generator grew bushes and grass is.
  // Field name kept as `tree` so existing documents parse unchanged.
  tree?: FoliageParams;
}

// Reserved placement id for the foliage brush's animated grass: no GLB behind
// it; the renderer draws a procedural tuft cluster (the same grass cards the
// built-in world streams around the player). Purely cosmetic: never collides,
// never touches the sim.
export const GRASS_PATCH_ASSET_ID = 'grass/patch';
// The sentinel "path" placementsToRenderAssets resolves the id to; the placed-
// asset renderer intercepts it instead of fetching a model.
export const GRASS_PATCH_PATH = 'procedural://grass-patch';

// Reserved placement id for the water tool's animated waterfall: procedural
// like the grass patch (no GLB), purely cosmetic, never collides.
export const WATERFALL_ASSET_ID = 'water/waterfall';
export const WATERFALL_PATH = 'procedural://waterfall';

// Reserved placement id for the Rock tool's generated boulders: procedural
// like the grass patch (no GLB). Shape lives in the rock* fields below, so a
// saved map regenerates the exact same mesh; collision is the ordinary
// placement collide circle (plus plane colliders for walkable tops).
export const ROCK_ASSET_ID = 'rock/generated';
export const ROCK_PATH = 'procedural://rock';

// Reserved placement id for a MERGED rock chain (the Rock tool's ridge mode):
// one placement whose rockNodes describe the whole connected body, rendered
// as a single blended solid (no more overlapping-boulder piles).
export const ROCK_RIDGE_ASSET_ID = 'rock/ridge';
export const ROCK_RIDGE_PATH = 'procedural://rock-ridge';
// Blue waypoint markers the Rock tool lays before Generate (grouped by the
// shared chain id in placement.name, like the cave rig points): ordinary
// placements so they undo/save/move with the standard gizmos.
export const ROCK_POINT_ASSET_ID = 'rock/point';
export const MAX_ROCK_NODES = 64;

// Reserved placement id for a CUSTOM BUILT MODEL (the Build tool): a hand-
// modeled solid whose geometry lives inline on the placement (`meshes`, the
// editor's editable CmMesh volumes) and renders as a textured mesh, exactly
// like the generated rock. Collision (when enabled) derives from the same
// meshes via the Collision Master decomposition (hitboxes + walkable ramps),
// so a maker can sculpt cave walls, interiors, and world additions that both
// render and block. Procedural like the rock: no GLB behind it.
export const MODEL_ASSET_ID = 'model/custom';
export const MODEL_PATH = 'procedural://model';

// Reserved placement id for the Tree tool's generated trees. Procedural like
// the rock — no single GLB behind it — but it DOES stream one: the foundation
// trunk (public/models/foliage/trunks/<key>.glb, built in Blender). Everything
// else (branches, canopy volumes, leaf cards) is grown from `tree` at build
// time, so a saved map regenerates the identical tree. Collision is the
// ordinary placement collide circle around the trunk.
export const TREE_ASSET_ID = 'tree/generated';
export const TREE_PATH = 'procedural://tree';
// Per-model volume cap and the yaw-per-repeat texture tiling default (yards).
export const MAX_MODEL_MESHES = 32;
export const DEFAULT_MODEL_TEX_TILE = 4;
// One built model volume: flat xyz vertex triplets + CCW index triplets in the
// model's local space (world yards; the Build tool's CmMesh shape). `ramp`
// marks a WALKABLE volume (rises as a deck instead of blocking). Structurally
// identical to the editor's CmMesh, defined here so the sim stays DOM-free.
export interface PlacementMesh {
  verts: number[];
  tris: number[];
  ramp?: boolean;
}
// Matches the editor CmMesh sanitizer bounds (src/editor/cm_mesh.ts).
export const MAX_MODEL_MESH_VERTS = 3000;
export const MAX_MODEL_MESH_TRIS = 6000;

export interface MapDocMeta {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  seed: number;
  // Fork lineage (set by the server on fork; empty string = original work).
  parentId: string;
}

// City Build: a wall or fence run. The mapper draws a polyline; the editor
// generates fitted segment placements (plus corner posts) tagged with this
// run's id via MapPlacement.cityId. The def is the editable source of truth;
// the derived placements are ordinary placements (render, collision, playtest
// all ride the existing pipeline).
export interface WallRunDef {
  id: string;
  points: { x: number; z: number }[];
  // Catalogue asset ids for the pieces.
  segmentAssetId: string;
  postAssetId?: string;
  stairAssetId?: string;
  // Uniform scale applied to every piece (segments additionally stretch along
  // their run axis to close gaps exactly).
  scale: number;
  // Independent shape multipliers applied after the uniform scale. Optional
  // keeps older wall-run documents valid with a multiplier of 1.
  heightScale?: number;
  thicknessScale?: number;
  // Place a post every N segment boundaries (0 = corners only).
  postEvery: number;
  closed?: boolean;
  // Walkable rampart: every piece carries a flat walk deck at its top (the
  // placement ramps channel), so the player can patrol the wall top.
  walkTop?: boolean;
  // Stairs pieces leading from the ground up to the walk deck (open runs get
  // one at each end; closed loops one beside the first edge).
  stairs?: boolean;
}

// City Build: an authored, editable road. World-content assembly appends
// each def's centerline points to the legacy content.roads polylines, so
// rendering and terrain flattening behave exactly like built-in roads and old
// saves are untouched. kind is cosmetic metadata for the editor UI today
// (both kinds render with the shared road splat).
export interface RoadDef {
  id: string;
  points: { x: number; z: number }[];
  kind: 'road' | 'path';
}

// The spatial content tables, mirroring the per-zone content modules. `objects`
// matches the stored-JSON key (WorldContent calls them groundObjects).
export interface MapDocContent {
  zones: ZoneDef[];
  camps: CampDef[];
  npcs: Record<string, NpcDef>;
  objects: GroundObjectDef[];
  roads: { x: number; z: number }[][];
}

export interface MapDoc {
  version: number;
  meta: MapDocMeta;
  content: MapDocContent;
  terrainEdits: HeightStamp[];
  placements: MapPlacement[];
  biomePaint?: BiomePaint;
  // v3 optional: renderer-owned scenery families this DOCUMENT has taken over
  // as editable placements (the promoted-scenery contract; the projection
  // merges these into WorldContent.promotedScenery so the feature builders
  // stand down). Only `true` entries are stored; an absent family renders
  // renderer-owned as shipped. Persisted here because most families have no
  // unique asset id to self-detect from the placements list.
  promotedScenery?: Record<string, boolean>;
  // v2 optional: caves/tunnels (the Caves tool). Each is a capsule-chain
  // centerline; sim + render share src/sim/caves.ts to derive the standalone
  // tube volume, the second ground sheet, and the mesh. Absent = none.
  caves?: CaveDef[];
  // v2 optional, LEGACY: patch discs from the retired terrain-carving cave
  // system. Parsed so old documents round-trip; ignored at runtime.
  cavePatches?: CavePatch[];
  // Imported-model collision bakes (Import Model / Upload Asset), keyed by the
  // 'local/<sha>' / 'user/<sha>' asset id: normalized model-space boxes the
  // sim blocks with in playtest (catalogue assets use the generated table
  // instead; see sim/asset_collision.ts). Absent = none.
  assetCollision?: Record<string, AssetCollisionBox[]>;
  // v3 optional: "true collision" fine bakes (collisionMode 'mesh'), keyed by
  // asset id (catalogue OR imported). Many small boxes hugging the real mesh;
  // baked in-browser on demand, kept on the doc so playtest/export keep them.
  assetCollisionMesh?: Record<string, AssetCollisionBox[]>;
  // v3 optional: per-asset wind-sway opt-OUT, keyed by asset id (catalogue or
  // imported). Sway is on by default for anything the heuristic reads as a
  // plant (render/tree_sway.ts), so only `false` entries are ever stored: an
  // absent id sways. Presentation only - it never touches collision or the sim.
  assetSway?: Record<string, boolean>;
  // v3 optional: terrain-sheet cutouts (the Cut tool). v3 documents authored
  // spheres; a cut can now be a box, capsule or tube as well, evaluated as one
  // signed distance field (sim/terrain_cuts.ts). Absent = none.
  holes?: TerrainCut[];
  // v3 optional: patch cuts restoring ground inside cutouts (Patch hole mode);
  // a patch beats every cut it overlaps. Absent = none.
  holePatches?: TerrainCut[];
  // v3 optional: remesh detail regions (the Remesh brush) — finer carve
  // interior tessellation inside each disc. Absent = default detail.
  detailRegions?: DetailRegion[];
  // FORK: document-wide carve interior mesh cell (Remesh all caves).
  caveMeshCell?: number;
  // v2: invisible blocker walls (collision-only segments); absent = none.
  blockers?: BlockerDef[];
  // v3 optional: City Build wall runs (see WallRunDef). Absent = none.
  wallRuns?: WallRunDef[];
  // v3 optional: City Build editable roads (see RoadDef). Absent = none.
  roadDefs?: RoadDef[];
  // v2: map-wide water surface height; absent = the built-in WATER_LEVEL.
  waterLevel?: number;
  // v3 optional: map-wide water TINT (the Water tab's hue/lightness sliders,
  // the same authoring model as grass hue/lum). Absent = the shipped blues.
  waterHue?: number; // degrees [0, 360]
  waterLum?: number; // lightness [0, 1]
  // v2 optional: half the world's x extent in yards (the world spans
  // [-worldHalfX, worldHalfX]); absent = the built-in WORLD_MAX_X. The z extent
  // is already per-map via the zone bands' zMin/zMax.
  worldHalfX?: number;
  // v3 optional: LINK TO WORLD — the world-space point the map's origin (0,0)
  // projects to. When set, playtest embeds this map's layers into the FULL
  // built-in world at that offset (base terrain, mobs, NPCs and quests keep
  // running around it) instead of booting the standalone authored slate.
  // Authoring always stays at the map's own origin; only the playtest
  // projection (customMapToWorldContent) applies the offset. Absent = the map
  // is a standalone space.
  worldAnchor?: { x: number; z: number };
  // v3 optional: GENERATED TERRAIN — the world-space point the map's origin
  // samples the shipped world's natural heightfield from (the editor's
  // Generate Terrain picker). The map's base terrain becomes that region of
  // the old world layout (raw baseHeight: hills, lakes, coasts); sculpt edits
  // apply on top. Absent = the flat slate.
  terrainBase?: { x: number; z: number };
  // v4 optional: REGION MAP — this document is the editable form of a shipped
  // region that lives outside the overworld (the Ravenrift battleground first;
  // dungeons, delves and the arena share the pattern). Its coordinates are the
  // REGION's own local space, so the export writes them straight back into the
  // region's generated module with no offset. Set only by the region loader
  // (editor/shipped_maps.ts); absent on every ordinary map.
  regionSource?: RegionId;
  // v2: where playtest drops the player; absent = the built-in start.
  playerStart?: { x: number; z: number };
  // Optional rectangle that spreads new players across deterministic slots.
  playerSpawnArea?: { minX: number; minZ: number; maxX: number; maxZ: number };
  // v2 optional: the map's sky. 'builtin:<id>' names a bundled equirect image
  // (render/assets/skyboxes.ts); 'custom:<sha256>' an uploaded one (IndexedDB,
  // exported with the map bundle). Absent = the procedural HDRI sky.
  skybox?: string;
  // v2: built-in static prop set by default; 'empty' gives blank authoring maps
  // no props. 'editable-major' is the legacy buildings/fences-only format;
  // 'editable-all' replaces every renderer-owned prop with exported placements.
  propsMode?: 'empty' | 'editable-major' | 'editable-all';
  // v2: procedural terrain decorations by default; 'empty' removes trees/rocks.
  decorationsMode?: 'empty';
  // Stable procedural-decoration keys replaced by editable placements.
  decorationExclusions?: string[];
  // Painted no-grass discs (grass-clear brush): the procedural meadow grass is
  // suppressed inside each circle, including the grass baked into the world.
  grassClear?: GrassClearCircle[];
  // v2: render-only world dressing by default; 'blank' is the flat-map slate.
  presentationMode?: MapPresentationMode;
  // v2 optional: named locations - axis-aligned rects the HUD shows as the
  // player's current location name in playtest.
  locations?: MapLocation[];
  // v2 optional: editor-only marker points ("quest giver goes here", "chest
  // here") for AI quest/event generation. NEVER rendered or projected into
  // playtest; they only live in the document.
  markers?: MapMarker[];
  // v2 optional: authored point lights (rendered in editor AND playtest).
  lights?: MapLight[];
  // v2 optional: authored positional point sounds (looping SFX emitters).
  pointSounds?: MapPointSound[];
  // v2 optional: authored ground decals stamped over the terrain (render-only).
  decals?: MapDecal[];
  // v2 optional: auto-texturing rule toggles (slope rock, snow caps, rim
  // mountains, shore sand). Absent = every rule on (the shipped look).
  terrainStyle?: TerrainStyle;
  // v2 optional: ambience animation speed (0.25..2, render-only cosmetic
  // motion: water, foliage sway, fire, birds, weather). Absent = 1.
  timeScale?: number;
  // v2 optional: how far placed decor renders before it culls (yards from the
  // camera, capped at the fog). Render-only perf knob. Absent = the default.
  assetViewDistance?: number;
  // v2 optional: ambient weather (fixed mode or a timed schedule, plus the
  // cloud deck). Render-only; absent = the biome rule.
  weather?: MapWeather;
  // v3 optional: authored scene lighting (the editor's Lighting tab saved
  // into the map: sun/ambient intensity+color, environment scale, sun
  // azimuth/elevation). Render-only; absent = the biome/day-night rig.
  lighting?: MapLighting;
  // Per-zone atmosphere. Missing fields inherit the map-wide values; a null
  // skybox explicitly restores the procedural sky in that zone.
  zoneAtmosphere?: Record<string, ZoneAtmosphere>;
  // v2 optional: authored soundtrack (map-wide track + per-area rects).
  music?: MapMusic;
}

export interface MapLocation {
  name: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface MapMarker {
  name: string;
  kind: 'npc' | 'object';
  x: number;
  z: number;
}

export interface MapLight {
  x: number;
  z: number;
  /** Height above the terrain seat (yards). */
  y: number;
  color: number; // 0xRRGGBB
  intensity: number;
  range: number; // yards
}

// Placed assets are normalized to ~2.2yd max dimension at scale 1 by the
// renderer (src/render/placed_assets.ts TARGET_HEIGHT), so a colliding
// placement gets a footprint radius proportional to its scale. What should
// BLOCK differs per family though: a tree blocks by its trunk (its normalized
// max dimension is the canopy/height), a rock by most of its body. Matched by
// assetId prefix; unknown ids keep the generic factor. Pure data in the
// document pipeline: the sim never opens the GLB.
const COLLIDE_FACTOR_DEFAULT = 0.8;
// Factors track the render normalization heights (placed_assets.ts
// targetHeightFor): trees normalize to 7.5yd (was 2.2), bushes 3.2, ferns
// 1.6, rocks 2.4, so each footprint scales with its family's visual size.
const COLLIDE_FACTORS: readonly { prefix: string; factor: number }[] = [
  { prefix: 'biome/beach_palm', factor: 0.35 },
  { prefix: 'foliage/oak', factor: 0.75 },
  { prefix: 'foliage/pine', factor: 0.75 },
  { prefix: 'foliage/dead', factor: 0.6 },
  { prefix: 'foliage/twisted', factor: 0.75 },
  { prefix: 'foliage/bush', factor: 0.73 },
  { prefix: 'foliage/fern', factor: 0.25 },
  { prefix: 'foliage/mushroom', factor: 0.25 },
  { prefix: 'foliage/rock', factor: 0.75 },
  { prefix: 'grass/', factor: 0.3 },
];

/**
 * The derived (auto) collision radius for a placement: per-family footprint
 * factor times scale, so the blocking circle tracks the VISUAL silhouette at
 * every scale instead of the old flat 0.8*scale capped at 8 (which walled off
 * huge areas around scaled-up tree trunks). Capped at the same bound as the
 * manual override so one placement still cannot wall off the world.
 */
export function collideRadiusFor(scale: number, assetId?: string): number {
  let factor = COLLIDE_FACTOR_DEFAULT;
  if (assetId) {
    for (const f of COLLIDE_FACTORS) {
      if (assetId.startsWith(f.prefix)) {
        factor = f.factor;
        break;
      }
    }
  }
  return Math.max(MIN_COLLIDE_RADIUS, Math.min(MAX_COLLIDE_RADIUS, factor * scale));
}

export function serializeMapDoc(doc: MapDoc): string {
  return JSON.stringify(doc, null, 2);
}

// A map document authored without an explicit seed builds the shipped world.
const DEFAULT_SEED = WORLD_SEED;

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
// Every accepted number must pass this (never bare `typeof === 'number'`):
// JSON.parse turns 1e999 into Infinity, which JSON.stringify then stores as
// null in JSONB, making the stored document unloadable forever.
function finiteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function coord(v: number): number {
  return clamp(v, -MAX_WORLD_COORD, MAX_WORLD_COORD);
}
function idStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH ? v : null;
}
function strArray(v: unknown): string[] {
  return arr(v)
    .filter((s): s is string => typeof s === 'string')
    .slice(0, MAX_STR_ARRAY)
    .map((s) => s.slice(0, MAX_ID_LENGTH));
}

function sanitizeStamp(v: unknown): HeightStamp | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (typeof s.x !== 'number' || typeof s.z !== 'number') return null;
  if (!Number.isFinite(s.x) || !Number.isFinite(s.z)) return null;
  const radius = num(s.radius, 0);
  if (radius <= 0) return null;
  const stamp: HeightStamp = {
    x: s.x,
    z: s.z,
    // Radius cap tracks the editor's widest brush (300yd, inspector brush
    // slider); the fine end goes down to sub-yard detail work.
    radius: clamp(radius, 0.1, 300),
    delta: clamp(num(s.delta, 0), -200, 200),
    falloff: s.falloff === 'flat' ? 'flat' : 'smooth',
  };
  if (s.mode === 'level') stamp.mode = 'level';
  // Level-target slope (Smooth's local trend plane). Clamped to a sane grade so
  // a corrupt document cannot tilt a stamp into the sky.
  if (typeof s.gx === 'number' && Number.isFinite(s.gx)) stamp.gx = clamp(s.gx, -20, 20);
  if (typeof s.gz === 'number' && Number.isFinite(s.gz)) stamp.gz = clamp(s.gz, -20, 20);
  if (typeof s.strength === 'number' && Number.isFinite(s.strength)) {
    stamp.strength = clamp(s.strength, 0, 1);
  }
  if (typeof s.hardness === 'number' && Number.isFinite(s.hardness)) {
    stamp.hardness = clamp(s.hardness, 0, 1);
  }
  if (
    s.alpha === 'noise' ||
    s.alpha === 'splatter' ||
    s.alpha === 'streaks' ||
    s.alpha === 'dots' ||
    s.alpha === 'chunks'
  ) {
    stamp.alpha = s.alpha;
  }
  return stamp;
}

function sanitizeCave(v: unknown): CaveDef | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const id = idStr(c.id);
  if (!id) return null;
  const nodes = arr(c.nodes)
    .slice(0, MAX_CAVE_NODES)
    .map(sanitizeCaveNode)
    .filter((n): n is CaveNode => n !== null)
    .map((n) => ({
      ...n,
      x: coord(n.x),
      z: coord(n.z),
      y: clamp(n.y, -500, 500),
    }));
  if (nodes.length === 0) return null;
  const cave: CaveDef = { id, nodes };
  if (finiteNum(c.radius)) cave.radius = clamp(c.radius, CAVE_MIN_RADIUS, CAVE_MAX_RADIUS);
  if (finiteNum(c.width)) cave.width = clamp(c.width, CAVE_MIN_MULT, CAVE_MAX_MULT);
  if (finiteNum(c.height)) cave.height = clamp(c.height, CAVE_MIN_MULT, CAVE_MAX_MULT);
  if (finiteNum(c.variance)) cave.variance = clamp(c.variance, 0, 1);
  if (finiteNum(c.floorVariance)) cave.floorVariance = clamp(c.floorVariance, 0, 1);
  if (finiteNum(c.stalactites)) cave.stalactites = clamp(c.stalactites, 0, 1);
  if (finiteNum(c.stalagmites)) cave.stalagmites = clamp(c.stalagmites, 0, 1);
  if (finiteNum(c.spikeSize)) {
    cave.spikeSize = clamp(c.spikeSize, CAVE_SPIKE_SIZE_MIN, CAVE_SPIKE_SIZE_MAX);
  }
  // Mouth toggles: only an explicit false seals an end (absent = open).
  if (c.startOpen === false) cave.startOpen = false;
  if (c.endOpen === false) cave.endOpen = false;
  // Interior base-texture set key (format-only: sim stays render-free; an
  // unknown key falls back to the default granite detail map).
  if (typeof c.tex === 'string' && /^[A-Za-z0-9]{1,32}$/.test(c.tex)) cave.tex = c.tex;
  if (finiteNum(c.texTile)) cave.texTile = clamp(c.texTile, 1, 64);
  // Self-carving mouth: only an explicit true opts in, so a v1 document never
  // gains an opening it did not author.
  if (c.autoMouth === true) cave.autoMouth = true;
  if (finiteNum(c.mouthBlend)) cave.mouthBlend = clamp(c.mouthBlend, 0, CUT_MAX_BLEND);
  return cave;
}

// Legacy Patch-tool disc bounds: kept ONLY so old documents round-trip; the
// runtime never reads patches anymore.
const LEGACY_CAVE_PATCH_MIN_RADIUS = 0.5;
const LEGACY_CAVE_PATCH_MAX_RADIUS = 30;
const LEGACY_MAX_CAVE_PATCHES = 200;

/** One baked collision box for an IMPORTED model (normalized model space:
 *  scale 1, base at y=0; a placement's rotY/scale transform it at runtime). */
export interface AssetCollisionBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

export const MAX_ASSET_COLLISION_ENTRIES = 128;
export const MAX_ASSET_COLLISION_BOXES = 12;
// Fine "true collision" bakes trade box count for fidelity.
export const MAX_ASSET_COLLISION_MESH_BOXES = 96;

function sanitizeAssetCollisionBox(v: unknown): AssetCollisionBox | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  if (
    !finiteNum(b.x) ||
    !finiteNum(b.y) ||
    !finiteNum(b.z) ||
    !finiteNum(b.hx) ||
    !finiteNum(b.hy) ||
    !finiteNum(b.hz)
  ) {
    return null;
  }
  return {
    x: clamp(b.x, -100, 100),
    y: clamp(b.y, -100, 100),
    z: clamp(b.z, -100, 100),
    hx: clamp(b.hx, 0.01, 60),
    hy: clamp(b.hy, 0.01, 60),
    hz: clamp(b.hz, 0.01, 60),
  };
}

function sanitizeMapHitbox(v: unknown): MapHitbox | null {
  const box = sanitizeAssetCollisionBox(v);
  if (!box) return null;
  const out: MapHitbox = box;
  const ry = (v as Record<string, unknown>).ry;
  if (finiteNum(ry) && ry !== 0) out.ry = clamp(ry, -Math.PI * 2, Math.PI * 2);
  return out;
}

function sanitizeCollisionRamp(v: unknown): AuthoredCollisionRamp | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (
    !finiteNum(r.x) ||
    !finiteNum(r.z) ||
    !finiteNum(r.hx) ||
    !finiteNum(r.hz) ||
    !finiteNum(r.y0) ||
    !finiteNum(r.y1)
  ) {
    return null;
  }
  if (r.hx <= 0 || r.hz <= 0) return null;
  const out: AuthoredCollisionRamp = {
    x: clamp(r.x, -100, 100),
    z: clamp(r.z, -100, 100),
    hx: clamp(r.hx, 0.01, 60),
    hz: clamp(r.hz, 0.01, 60),
    y0: clamp(r.y0, -100, 100),
    y1: clamp(r.y1, -100, 100),
  };
  if (finiteNum(r.ry) && r.ry !== 0) out.ry = clamp(r.ry, -Math.PI * 2, Math.PI * 2);
  return out;
}

/** A sanitized cut with its world coordinates clamped to the map: the cut
 *  sanitizer bounds the SHAPE (radii, half extents, blend), this bounds where
 *  it sits, tube chains included. */
function cutInWorld(cut: TerrainCut | null): TerrainCut | null {
  if (!cut) return null;
  const out: TerrainCut = { ...cut, x: coord(cut.x), z: coord(cut.z) };
  if (out.nodes) out.nodes = out.nodes.map((n) => ({ ...n, x: coord(n.x), z: coord(n.z) }));
  return out;
}

function sanitizeCavePatch(v: unknown): CavePatch | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  if (!finiteNum(c.x) || !finiteNum(c.z) || !finiteNum(c.radius)) return null;
  return {
    x: coord(c.x),
    z: coord(c.z),
    radius: clamp(c.radius, LEGACY_CAVE_PATCH_MIN_RADIUS, LEGACY_CAVE_PATCH_MAX_RADIUS),
  };
}

/** Structural sanity for a built-model volume arriving from JSON: index bounds
 *  + triplets, mirroring the editor's sanitizeCmMesh (src/editor/cm_mesh.ts). */
function sanitizeModelMesh(v: unknown): PlacementMesh | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as { verts?: unknown; tris?: unknown; ramp?: unknown };
  if (!Array.isArray(m.verts) || !Array.isArray(m.tris)) return null;
  if (m.verts.length % 3 !== 0 || m.tris.length % 3 !== 0) return null;
  if (m.verts.length < 9 || m.verts.length > MAX_MODEL_MESH_VERTS) return null;
  if (m.tris.length > MAX_MODEL_MESH_TRIS) return null;
  const vertCount = m.verts.length / 3;
  const verts: number[] = [];
  for (const n of m.verts) {
    if (!finiteNum(n)) return null;
    verts.push(clamp(n, -100, 100));
  }
  const tris: number[] = [];
  for (const n of m.tris) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= vertCount) return null;
    tris.push(n);
  }
  const out: PlacementMesh = { verts, tris };
  if (m.ramp === true) out.ramp = true;
  return out;
}

function sanitizePlacement(v: unknown): MapPlacement | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p.assetId !== 'string' || p.assetId.length > 128) return null;
  if (typeof p.x !== 'number' || typeof p.z !== 'number') return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
  const out: MapPlacement = {
    assetId: p.assetId,
    x: p.x,
    z: p.z,
    rotY: num(p.rotY, 0),
    scale: clamp(num(p.scale, 1) || 1, 0.05, 50),
    collide: p.collide === true,
  };
  const uid = idStr(p.uid);
  if (uid) out.uid = uid;
  const cityId = idStr(p.cityId);
  if (cityId) out.cityId = cityId;
  const groupId = idStr(p.groupId);
  if (groupId) out.groupId = groupId;
  // Optional radius override: accepted only finite, always clamped. Kept even
  // while collide is false (cheap, and it survives a collide re-toggle).
  if (finiteNum(p.collideRadius)) {
    out.collideRadius = clamp(p.collideRadius, MIN_COLLIDE_RADIUS, MAX_COLLIDE_RADIUS);
  }
  if (p.collideShape === 'square') out.collideShape = 'square';
  if (p.worldPropKind === 'fence' || p.worldPropKind === 'inn') {
    out.worldPropKind = p.worldPropKind;
    if (finiteNum(p.worldPropWidth)) out.worldPropWidth = clamp(p.worldPropWidth, 0.05, 100);
    if (finiteNum(p.worldPropDepth)) out.worldPropDepth = clamp(p.worldPropDepth, 0.05, 100);
  }
  if (
    p.collisionMode === 'baked' ||
    p.collisionMode === 'basic' ||
    p.collisionMode === 'mesh' ||
    p.collisionMode === 'none'
  ) {
    out.collisionMode = p.collisionMode;
  }
  if (Array.isArray(p.hitboxes)) {
    const boxes = p.hitboxes
      .slice(0, MAX_PLACEMENT_HITBOXES)
      .map(sanitizeMapHitbox)
      .filter((b): b is MapHitbox => b !== null);
    if (boxes.length > 0) out.hitboxes = boxes;
  }
  if (Array.isArray(p.ramps)) {
    const ramps = p.ramps
      .slice(0, MAX_PLACEMENT_RAMPS)
      .map(sanitizeCollisionRamp)
      .filter((r): r is AuthoredCollisionRamp => r !== null);
    if (ramps.length > 0) out.ramps = ramps;
  }
  // Optional collider-volume dimensions: same accept-only-finite, always-clamp
  // contract. Harmless on ordinary placements (nothing reads them there).
  if (finiteNum(p.sizeX)) out.sizeX = clamp(p.sizeX, MIN_COLLIDER_SIZE, MAX_COLLIDER_SIZE);
  if (finiteNum(p.sizeY)) out.sizeY = clamp(p.sizeY, MIN_COLLIDER_SIZE_Y, MAX_COLLIDER_SIZE_Y);
  if (finiteNum(p.sizeZ)) out.sizeZ = clamp(p.sizeZ, MIN_COLLIDER_SIZE, MAX_COLLIDER_SIZE);
  // Optional gizmo transform axes: tilts accepted finite like rotY; per-axis
  // scale multipliers clamped to the uniform scale's bounds.
  if (finiteNum(p.rotX)) out.rotX = p.rotX;
  if (finiteNum(p.rotZ)) out.rotZ = p.rotZ;
  if (finiteNum(p.scaleX)) out.scaleX = clamp(p.scaleX, MIN_AXIS_SCALE, MAX_AXIS_SCALE);
  if (finiteNum(p.scaleY)) out.scaleY = clamp(p.scaleY, MIN_AXIS_SCALE, MAX_AXIS_SCALE);
  if (finiteNum(p.scaleZ)) out.scaleZ = clamp(p.scaleZ, MIN_AXIS_SCALE, MAX_AXIS_SCALE);
  if (finiteNum(p.y)) out.y = clamp(p.y, -MAX_PLACEMENT_Y_OFFSET, MAX_PLACEMENT_Y_OFFSET);
  // Editor detach: a detached placement floats at a frozen ground height instead
  // of tracking terrainHeight (see MapPlacement.detached). Both survive the round
  // trip so a saved/imported map keeps floating objects put.
  if (p.detached === true) {
    out.detached = true;
    if (finiteNum(p.groundY)) out.groundY = p.groundY;
  }
  // Editor-only Scene Collection metadata: a display-name rename and a viewport
  // hide flag. Names are trimmed and length-capped like the other rename inputs.
  if (typeof p.name === 'string' && p.name.trim().length > 0) {
    out.name = p.name.trim().slice(0, MAX_PLACEMENT_NAME_LENGTH);
  }
  if (p.hidden === true) out.hidden = true;
  // Region-map structural role (see MapPlacement.regionRole). Unknown values
  // are DROPPED rather than kept: an untagged placement exports as free art,
  // which is the safe read of a role this build does not understand.
  if (isRegionRole(p.regionRole)) out.regionRole = p.regionRole;
  // Grass-patch color/clump fields; harmless on ordinary placements.
  if (finiteNum(p.hue)) out.hue = clamp(p.hue, 0, 360);
  if (finiteNum(p.lum)) out.lum = clamp(p.lum, 0, 1);
  if (finiteNum(p.clump)) out.clump = Math.round(clamp(p.clump, 1, 60));
  // Generated-rock shape params (harmless on ordinary placements).
  if (finiteNum(p.rockSeed)) out.rockSeed = Math.round(clamp(p.rockSeed, 0, 1e9));
  if (finiteNum(p.rockNoise)) out.rockNoise = clamp(p.rockNoise, 0, 1);
  if (finiteNum(p.rockDetail)) out.rockDetail = clamp(p.rockDetail, 0, 1);
  if (finiteNum(p.rockSharp)) out.rockSharp = clamp(p.rockSharp, 0, 1);
  if (finiteNum(p.rockTex)) out.rockTex = Math.round(clamp(p.rockTex, 0, 2));
  if (finiteNum(p.rockHeight)) out.rockHeight = clamp(p.rockHeight, 0.3, 3);
  if (finiteNum(p.rockDepth)) out.rockDepth = clamp(p.rockDepth, 0, 1);
  if (finiteNum(p.rockJag)) out.rockJag = clamp(p.rockJag, 0, 1);
  // Built-in texture set key (format-only check: sim stays render-free; an
  // unknown key falls back to the numeric rockTex look at render time).
  if (typeof p.rockTexId === 'string' && /^[A-Za-z0-9]{1,32}$/.test(p.rockTexId)) {
    out.rockTexId = p.rockTexId;
  }
  if (finiteNum(p.rockTexTile)) out.rockTexTile = clamp(p.rockTexTile, 1, 64);
  // Merged-ridge node chain: capped, every field clamped finite.
  if (Array.isArray(p.rockNodes)) {
    const nodes: {
      dx: number;
      dz: number;
      dy: number;
      r: number;
      h: number;
    }[] = [];
    for (const raw of p.rockNodes.slice(0, MAX_ROCK_NODES)) {
      if (!raw || typeof raw !== 'object') continue;
      const n = raw as Record<string, unknown>;
      if (!finiteNum(n.dx) || !finiteNum(n.dz)) continue;
      nodes.push({
        dx: clamp(n.dx, -2000, 2000),
        dz: clamp(n.dz, -2000, 2000),
        dy: finiteNum(n.dy) ? clamp(n.dy, -500, 500) : 0,
        r: finiteNum(n.r) ? clamp(n.r, 0.5, 40) : 3,
        h: finiteNum(n.h) ? clamp(n.h, 0.3, 3) : 1,
      });
    }
    if (nodes.length >= 2) out.rockNodes = nodes;
  }
  // Built-model geometry + surface texture (harmless on ordinary placements).
  if (Array.isArray(p.meshes)) {
    const meshes = p.meshes
      .slice(0, MAX_MODEL_MESHES)
      .map(sanitizeModelMesh)
      .filter((m): m is PlacementMesh => m !== null);
    if (meshes.length > 0) out.meshes = meshes;
  }
  if (typeof p.modelTexId === 'string' && /^[A-Za-z0-9]{1,32}$/.test(p.modelTexId)) {
    out.modelTexId = p.modelTexId;
  }
  if (finiteNum(p.modelTexTile)) out.modelTexTile = clamp(p.modelTexTile, 0.5, 64);
  if (finiteNum(p.modelHue)) out.modelHue = clamp(p.modelHue, -180, 180);
  if (finiteNum(p.modelSat)) out.modelSat = clamp(p.modelSat, 0, 2);
  if (finiteNum(p.modelLight)) out.modelLight = clamp(p.modelLight, -1, 1);
  // Generated-tree recipe (harmless on ordinary placements). Every field is
  // clamped to the same limits the Tree panel's sliders use, so a hand-edited
  // map can never author a tree the editor could not have made.
  const tree = sanitizeFoliageParams(p.tree);
  if (tree) out.tree = tree;
  // Material overrides (shader tweaks): accepted finite, clamped.
  if (finiteNum(p.tint)) out.tint = Math.round(clamp(p.tint, 0, 0xffffff));
  if (finiteNum(p.opacity)) out.opacity = clamp(p.opacity, 0.05, 1);
  if (finiteNum(p.glow)) out.glow = Math.round(clamp(p.glow, 0, 0xffffff));
  if (finiteNum(p.glowStrength)) out.glowStrength = clamp(p.glowStrength, 0, 8);
  if (p.fire === true) out.fire = true;
  const fireEffects = sanitizeAssetFireEmitters(p.fireEffects);
  if (fireEffects.length > 0) out.fireEffects = fireEffects;
  // Fluid-volume fields ('fluid/<kind>' placements); harmless elsewhere.
  if (finiteNum(p.fluidDps)) out.fluidDps = clamp(p.fluidDps, 0, 50);
  if (finiteNum(p.fluidFx)) out.fluidFx = Math.round(clamp(p.fluidFx, 0, 15));
  return out;
}

/**
 * Clamp a blocker segment's length: null when shorter than MIN_BLOCKER_LENGTH
 * (too small to author deliberately), far end truncated toward the anchor when
 * longer than MAX_BLOCKER_LENGTH. Shared by the sanitizer and the editor's
 * live drag preview so what you see while drawing is what gets stored.
 */
export function clampBlockerSegment(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): BlockerDef | null {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < MIN_BLOCKER_LENGTH) return null;
  // The epsilon keeps the truncation idempotent: hypot rounding can leave a
  // truncated segment ~1 ulp over the cap, and re-sanitizing the stored bytes
  // must not produce a new byte-different (spuriously dirty) document.
  if (len > MAX_BLOCKER_LENGTH + 1e-6) {
    const k = MAX_BLOCKER_LENGTH / len;
    return { x1, z1, x2: x1 + dx * k, z2: z1 + dz * k };
  }
  return { x1, z1, x2, z2 };
}

// A blocker wall must have four finite coordinates; they are clamped into the
// world bound BEFORE the length rules, so a truncated far end (interpolated
// between two in-bound points) stays in bounds too.
function sanitizeBlocker(v: unknown): BlockerDef | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  if (!finiteNum(b.x1) || !finiteNum(b.z1) || !finiteNum(b.x2) || !finiteNum(b.z2)) return null;
  return clampBlockerSegment(coord(b.x1), coord(b.z1), coord(b.x2), coord(b.z2));
}

// Maker-defined paint swatches: bounded count, ids in the reserved custom
// range and unique, colors clamped to 24-bit, labels truncated.
function sanitizeCustomSwatches(v: unknown): CustomPaintSwatch[] {
  const out: CustomPaintSwatch[] = [];
  const seen = new Set<number>();
  for (const raw of arr(v).slice(0, MAX_CUSTOM_PAINT_SWATCHES)) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    if (!finiteNum(s.id) || !Number.isInteger(s.id)) continue;
    if (!isCustomPaintId(s.id) || seen.has(s.id)) continue;
    if (!finiteNum(s.color)) continue;
    seen.add(s.id);
    const swatch: CustomPaintSwatch = {
      id: s.id,
      color: Math.floor(clamp(s.color, 0, 0xffffff)),
    };
    if (typeof s.label === 'string' && s.label.length > 0) {
      swatch.label = s.label.slice(0, MAX_SWATCH_LABEL_LENGTH);
    }
    // Either a real content hash (imported image, IndexedDB) or a built-in
    // library reference `builtin:<SetKey>` served from the app bundle (see
    // render/terrain_texture_sets.ts; format-only check keeps sim render-free
    // and an unknown key falls back to the swatch color).
    if (
      typeof s.textureSha === 'string' &&
      (/^[a-f0-9]{64}$/.test(s.textureSha) || /^builtin:[A-Za-z0-9]{1,32}$/.test(s.textureSha))
    ) {
      swatch.textureSha = s.textureSha;
    }
    if (finiteNum(s.tileSize)) swatch.tileSize = clamp(s.tileSize, 1, 64);
    // Hue/light adjust and biome-variant base: zero adjust is dropped (absent
    // means "paints exactly the base"), the base must be a real built-in id.
    if (finiteNum(s.hueShift) && s.hueShift !== 0) swatch.hueShift = clamp(s.hueShift, -180, 180);
    if (finiteNum(s.light) && s.light !== 0) swatch.light = clamp(s.light, -1, 1);
    if (
      finiteNum(s.baseBiome) &&
      Number.isInteger(s.baseBiome) &&
      s.baseBiome >= 0 &&
      s.baseBiome < BIOME_BY_ID.length
    ) {
      swatch.baseBiome = s.baseBiome;
    }
    if (s.saved === true) swatch.saved = true;
    if (finiteNum(s.glow) && s.glow > 0) swatch.glow = clamp(s.glow, 0, 4);
    out.push(swatch);
  }
  return out;
}

// The biome-paint grid's hard cell cap: fits a full-size world at the editor's
// finest 0.5yd brush tier (and mid maps at 0.25yd) while rejecting absurd
// grids. Kept in sync with the editor's finestPaintCell budget.
export const MAX_BIOME_PAINT_CELLS = 4_200_000;

// ---- biome-paint ids RLE (TRANSPORT layers only) ----------------------------
//
// A fine grid's plain ids array is several MB of JSON ? past browser storage
// quotas. Transport seams (the editor's localStorage store, the playtest
// sessionStorage handoff) swap `ids` for this run-length string and expand it
// back before anything else sees the document; the document FORMAT itself
// (file export, bundles, the server) always carries the plain array. Lives in
// sim so the game-side playtest reader can decode without importing editor
// code into the shipped bundle.

/** "count:value" pairs, e.g. "120:255,4:3,76:255". */
export function encodeBiomePaintIdsRle(ids: readonly number[]): string {
  const parts: string[] = [];
  let run = 0;
  let cur = -1;
  for (const id of ids) {
    if (id === cur) {
      run++;
      continue;
    }
    if (run > 0) parts.push(`${run}:${cur}`);
    cur = id;
    run = 1;
  }
  if (run > 0) parts.push(`${run}:${cur}`);
  return parts.join(',');
}

/** Expand an RLE ids string, or null on malformed input / expansion bombs. */
export function decodeBiomePaintIdsRle(rle: string): number[] | null {
  const out: number[] = [];
  for (const part of rle.split(',')) {
    const sep = part.indexOf(':');
    if (sep <= 0) return null;
    const run = Number(part.slice(0, sep));
    const value = Number(part.slice(sep + 1));
    if (!Number.isInteger(run) || run <= 0 || !Number.isFinite(value)) return null;
    if (out.length + run > MAX_BIOME_PAINT_CELLS) return null;
    for (let i = 0; i < run; i++) out.push(value);
  }
  return out;
}

// Validate a biome paint grid: ids length must match cols*rows and cell must be
// positive, else the grid is dropped. Unknown biome ids become 255 (unpainted)
// unless they name one of the document's custom swatches, so a document from a
// future build degrades instead of breaking.
function sanitizeBiomePaint(v: unknown): BiomePaint | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const b = v as Record<string, unknown>;
  const cols = num(b.cols, 0);
  const rows = num(b.rows, 0);
  const cell = num(b.cell, 0);
  if (cols <= 0 || rows <= 0 || cell <= 0) return undefined;
  if (cols * rows > MAX_BIOME_PAINT_CELLS) return undefined;
  if (!Array.isArray(b.ids) || b.ids.length !== cols * rows) return undefined;
  const custom = sanitizeCustomSwatches(b.custom);
  const customIds = new Set(custom.map((s) => s.id));
  const idCount = BIOME_BY_ID.length;
  const ids = b.ids.map((n) =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0 && (n < idCount || customIds.has(n))
      ? n
      : 255,
  );
  const paint: BiomePaint = {
    cell,
    cols,
    rows,
    originX: num(b.originX, 0),
    originZ: num(b.originZ, 0),
    ids,
  };
  if (custom.length > 0) paint.custom = custom;
  return paint;
}

function sanitizeMeta(v: unknown): MapDocMeta {
  const m = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const created = num(m.createdAt, 0);
  return {
    id: str(m.id, '').slice(0, 64),
    name: str(m.name, 'Untitled Map').slice(0, MAX_NAME_LENGTH),
    description: str(m.description, '').slice(0, MAX_DESCRIPTION_LENGTH),
    createdAt: created,
    updatedAt: num(m.updatedAt, created),
    seed: Math.floor(num(m.seed, DEFAULT_SEED)),
    parentId: str(m.parentId, '').slice(0, 64),
  };
}

// The Sim spawns camp.count mobs inside camp.radius, so every field is
// validated and clamped; a malformed camp is dropped, never thrown on.
function sanitizeAuthorVfx(v: unknown): AuthorVfx | null {
  if (!v || typeof v !== 'object') return null;
  const fx = v as Record<string, unknown>;
  if (typeof fx.preset !== 'string' || !AUTHOR_VFX_PRESETS.has(fx.preset as AuthorVfxPreset)) {
    return null;
  }
  return {
    preset: fx.preset as AuthorVfxPreset,
    intensity: clamp(num(fx.intensity, 1), 0.25, 3),
  };
}

// Mob-tool stat multipliers. Each key is clamped independently; an object that
// ends up all-1s is dropped so a stock camp never carries dead weight in the
// saved document (and round-trips byte-identically to a pre-feature save).
function sanitizeCampStatMods(v: unknown): CampStatMods | null {
  if (!v || typeof v !== 'object') return null;
  const raw = v as Record<string, unknown>;
  const mods: CampStatMods = {};
  for (const key of CAMP_STAT_MOD_KEYS) {
    if (finiteNum(raw[key])) mods[key] = clamp(raw[key], MOB_STAT_MOD_MIN, MOB_STAT_MOD_MAX);
  }
  return campStatModsAreStock(mods) ? null : mods;
}

function sanitizeCamp(v: unknown): CampDef | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const mobId = idStr(c.mobId);
  if (!mobId) return null;
  const center = c.center as Record<string, unknown> | null | undefined;
  if (!center || typeof center !== 'object') return null;
  if (!finiteNum(center.x) || !finiteNum(center.z)) return null;
  const camp: CampDef = {
    mobId,
    center: { x: coord(center.x), z: coord(center.z) },
    radius: clamp(num(c.radius, 5), 0.5, MAX_CAMP_RADIUS),
    count: clamp(Math.floor(num(c.count, 1)), 1, MAX_CAMP_COUNT),
  };
  if (finiteNum(c.levelMin))
    camp.levelMin = clamp(Math.round(c.levelMin), 1, MAX_AUTHORED_CAMP_LEVEL);
  if (finiteNum(c.levelMax))
    camp.levelMax = clamp(Math.round(c.levelMax), 1, MAX_AUTHORED_CAMP_LEVEL);
  if (camp.levelMin !== undefined && camp.levelMax !== undefined && camp.levelMin > camp.levelMax) {
    [camp.levelMin, camp.levelMax] = [camp.levelMax, camp.levelMin];
  }
  const authorVfx = sanitizeAuthorVfx(c.authorVfx);
  if (authorVfx) camp.authorVfx = authorVfx;
  const statMods = sanitizeCampStatMods(c.statMods);
  if (statMods) camp.statMods = statMods;
  if (finiteNum(c.respawnSeconds)) {
    camp.respawnSeconds = clamp(
      c.respawnSeconds,
      MIN_CAMP_RESPAWN_SECONDS,
      MAX_CAMP_RESPAWN_SECONDS,
    );
  }
  // Camp patrol routes reuse the NPC waypoint shape (and its clamps) verbatim.
  const route = sanitizeNpcRoute(c.route);
  if (route) camp.route = route;
  const aiNotes = str(c.aiNotes, '').slice(0, MAX_AUTHORING_NOTES_LENGTH);
  const questNotes = str(c.questNotes, '').slice(0, MAX_AUTHORING_NOTES_LENGTH);
  if (aiNotes) camp.aiNotes = aiNotes;
  if (questNotes) camp.questNotes = questNotes;
  return camp;
}

// NPC ids are validated for shape only (the engine tolerates an unknown quest
// or vendor item id; it just renders nothing for it).
// NPC patrol route (City Build Routes subtool). Waypoints are clamped world
// coordinates; wait and speed are clamped so playtest movement stays sane.
function sanitizeNpcRoute(v: unknown): NpcRoute | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const points: NpcRoutePoint[] = [];
  for (const p of arr(r.points).slice(0, MAX_NPC_ROUTE_POINTS)) {
    const pt = p as Record<string, unknown> | null;
    if (!pt || !finiteNum(pt.x) || !finiteNum(pt.z)) continue;
    const point: NpcRoutePoint = { x: coord(pt.x), z: coord(pt.z) };
    if (finiteNum(pt.wait) && pt.wait > 0) point.wait = clamp(pt.wait, 0, MAX_NPC_ROUTE_WAIT);
    points.push(point);
  }
  if (points.length < 2) return null;
  const route: NpcRoute = {
    points,
    mode: r.mode === 'pingpong' ? 'pingpong' : 'loop',
  };
  if (finiteNum(r.speed)) {
    route.speed = clamp(r.speed, NPC_ROUTE_SPEED_MIN, NPC_ROUTE_SPEED_MAX);
  }
  return route;
}

function sanitizeNpc(v: unknown): NpcDef | null {
  if (!v || typeof v !== 'object') return null;
  const n = v as Record<string, unknown>;
  const id = idStr(n.id);
  if (!id) return null;
  const pos = n.pos as Record<string, unknown> | null | undefined;
  if (!pos || typeof pos !== 'object') return null;
  if (!finiteNum(pos.x) || !finiteNum(pos.z)) return null;
  const npc: NpcDef = {
    id,
    name: str(n.name, 'Villager').slice(0, MAX_NAME_LENGTH),
    title: str(n.title, '').slice(0, MAX_NAME_LENGTH),
    pos: { x: coord(pos.x), z: coord(pos.z) },
    facing: num(n.facing, 0),
    color: Math.floor(clamp(num(n.color, 0xffffff), 0, 0xffffff)),
    questIds: strArray(n.questIds),
    greeting: str(n.greeting, '').slice(0, MAX_DESCRIPTION_LENGTH),
  };
  const visualKey = idStr(n.visualKey);
  if (visualKey) npc.visualKey = visualKey;
  const authorVfx = sanitizeAuthorVfx(n.authorVfx);
  if (authorVfx) npc.authorVfx = authorVfx;
  const authorRole = str(n.authorRole, '').slice(0, MAX_NAME_LENGTH);
  const aiNotes = str(n.aiNotes, '').slice(0, MAX_AUTHORING_NOTES_LENGTH);
  const questNotes = str(n.questNotes, '').slice(0, MAX_AUTHORING_NOTES_LENGTH);
  if (authorRole) npc.authorRole = authorRole;
  if (aiNotes) npc.aiNotes = aiNotes;
  if (questNotes) npc.questNotes = questNotes;
  const route = sanitizeNpcRoute(n.route);
  if (route) npc.route = route;
  if (Array.isArray(n.vendorItems)) npc.vendorItems = strArray(n.vendorItems);
  if (n.market === true) npc.market = true;
  if (n.banker === true) npc.banker = true;
  if (n.dynamic === true) npc.dynamic = true;
  return npc;
}

// Each position spawns one ground-object entity, so the list is bounded and
// every point must be a finite, in-bounds coordinate.
function sanitizeGroundObject(v: unknown): GroundObjectDef | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const itemId = idStr(o.itemId);
  if (!itemId) return null;
  const positions: { x: number; z: number }[] = [];
  for (const p of arr(o.positions).slice(0, MAX_OBJECT_POSITIONS)) {
    const pt = p as Record<string, unknown> | null;
    if (pt && typeof pt === 'object' && finiteNum(pt.x) && finiteNum(pt.z)) {
      positions.push({ x: coord(pt.x), z: coord(pt.z) });
    }
  }
  return { itemId, name: str(o.name, '').slice(0, MAX_NAME_LENGTH), positions };
}

// A zone must at least have a finite z-band and a hub to shape terrain.
function zoneIsUsable(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const z = v as Record<string, unknown>;
  const hub = z.hub as Record<string, unknown> | undefined;
  return finiteNum(z.zMin) && finiteNum(z.zMax) && !!hub && finiteNum(hub.x) && finiteNum(hub.z);
}

// Def-fill the nested zone sub-fields the terrain function and the editor
// model iterate (lakes/pois arrays, hub radius/name, a valid biome), keeping
// the never-throws contract: a minimal-but-usable zone loads instead of
// crashing a viewer's editor tab. Mutates the zone object in place (it was
// freshly JSON.parsed; nothing else holds a reference).
function fillZoneDefaults(v: unknown): ZoneDef {
  const z = v as Record<string, unknown>;
  if (typeof z.id !== 'string') z.id = 'zone';
  if (typeof z.name !== 'string') z.name = 'Zone';
  // The z-band drives the decoration generator's loop bounds and the world
  // extents: clamp its magnitude or a stored map can make a viewer's tab
  // iterate an effectively unbounded grid.
  z.zMin = coord(z.zMin as number);
  z.zMax = coord(z.zMax as number);
  // Lakes and POIs feed the terrain function and the editor overlay directly:
  // drop any entry whose numbers are not finite, clamp the survivors, and cap
  // the counts (lakes multiply per-vertex terrain cost).
  z.lakes = arr(z.lakes)
    .filter((l) => {
      const lake = l as Record<string, unknown> | null;
      return (
        !!lake &&
        typeof lake === 'object' &&
        finiteNum(lake.x) &&
        finiteNum(lake.z) &&
        finiteNum(lake.radius)
      );
    })
    .slice(0, MAX_ZONE_LAKES)
    .map((l) => {
      const lake = l as Record<string, unknown>;
      lake.x = coord(lake.x as number);
      lake.z = coord(lake.z as number);
      lake.radius = clamp(lake.radius as number, 0.5, 200);
      return lake;
    });
  z.pois = arr(z.pois)
    .filter((p) => {
      const poi = p as Record<string, unknown> | null;
      return !!poi && typeof poi === 'object' && finiteNum(poi.x) && finiteNum(poi.z);
    })
    .slice(0, MAX_ZONE_POIS)
    .map((p) => {
      const poi = p as Record<string, unknown>;
      poi.x = coord(poi.x as number);
      poi.z = coord(poi.z as number);
      return poi;
    });
  if (typeof z.welcome !== 'string') z.welcome = '';
  // A zone may carry ANY biome, not just the paintable ones (BIOME_BY_ID is the
  // brush vocabulary). Validating against the paint table downgraded frost /
  // dusk / ember / amber / fen / night / haunt / jungle / garden / gale zones to
  // 'vale' the moment the world round-tripped through a saved map, which cost
  // those zones their palette, their sky features and their ambient weather.
  if (typeof z.biome !== 'string' || !ALL_BIOME_IDS.includes(z.biome as ZoneDef['biome'])) {
    z.biome = 'vale';
  }
  const lr = z.levelRange as unknown[] | undefined;
  if (!Array.isArray(lr) || !finiteNum(lr[0]) || !finiteNum(lr[1])) z.levelRange = [1, 10];
  else z.levelRange = [clamp(Math.floor(lr[0]), 1, 60), clamp(Math.floor(lr[1]), 1, 60)];
  const hub = z.hub as Record<string, unknown>;
  hub.x = coord(hub.x as number);
  hub.z = coord(hub.z as number);
  if (!finiteNum(hub.radius)) hub.radius = 20;
  else hub.radius = clamp(hub.radius, 1, 200);
  if (typeof hub.name !== 'string') hub.name = '';
  const gy = z.graveyard as Record<string, unknown> | undefined;
  if (!gy || !finiteNum(gy.x) || !finiteNum(gy.z)) {
    z.graveyard = { x: hub.x, z: hub.z };
  } else {
    gy.x = coord(gy.x as number);
    gy.z = coord(gy.z as number);
  }
  return z as unknown as ZoneDef;
}

// City Build wall runs: every number clamped, asset ids bounded, and any run
// without at least 2 points dropped (nothing to generate from it).
function sanitizeWallRun(v: unknown): WallRunDef | null {
  if (!v || typeof v !== 'object') return null;
  const w = v as Record<string, unknown>;
  const id = idStr(w.id);
  if (!id) return null;
  if (typeof w.segmentAssetId !== 'string' || w.segmentAssetId.length > 128) return null;
  const points: { x: number; z: number }[] = [];
  for (const p of arr(w.points).slice(0, MAX_WALL_RUN_POINTS)) {
    const pt = p as Record<string, unknown> | null;
    if (pt && finiteNum(pt.x) && finiteNum(pt.z)) points.push({ x: coord(pt.x), z: coord(pt.z) });
  }
  if (points.length < 2) return null;
  const out: WallRunDef = {
    id,
    points,
    segmentAssetId: w.segmentAssetId,
    scale: clamp(num(w.scale, 1) || 1, 0.05, 50),
    postEvery: Math.floor(clamp(num(w.postEvery, 0), 0, 64)),
  };
  if (finiteNum(w.heightScale)) out.heightScale = clamp(w.heightScale, 0.25, 4);
  if (finiteNum(w.thicknessScale)) out.thicknessScale = clamp(w.thicknessScale, 0.25, 4);
  if (typeof w.postAssetId === 'string' && w.postAssetId.length <= 128 && w.postAssetId) {
    out.postAssetId = w.postAssetId;
  }
  if (typeof w.stairAssetId === 'string' && w.stairAssetId.length <= 128 && w.stairAssetId) {
    out.stairAssetId = w.stairAssetId;
  }
  if (w.closed === true) out.closed = true;
  if (w.walkTop === true) out.walkTop = true;
  if (w.stairs === true) out.stairs = true;
  return out;
}

function sanitizeRoadDef(v: unknown): RoadDef | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const id = idStr(r.id);
  if (!id) return null;
  const points: { x: number; z: number }[] = [];
  for (const p of arr(r.points).slice(0, MAX_ROAD_POINTS)) {
    const pt = p as Record<string, unknown> | null;
    if (pt && finiteNum(pt.x) && finiteNum(pt.z)) points.push({ x: coord(pt.x), z: coord(pt.z) });
  }
  if (points.length < 2) return null;
  return { id, points, kind: r.kind === 'path' ? 'path' : 'road' };
}

function sanitizeRoads(v: unknown): { x: number; z: number }[][] {
  const roads: { x: number; z: number }[][] = [];
  for (const road of arr(v).slice(0, MAX_ROADS)) {
    if (!Array.isArray(road)) continue;
    const pts: { x: number; z: number }[] = [];
    for (const p of road.slice(0, MAX_ROAD_POINTS)) {
      const pt = p as Record<string, unknown> | null;
      if (pt && finiteNum(pt.x) && finiteNum(pt.z)) {
        pts.push({ x: pt.x, z: pt.z });
      }
    }
    if (pts.length >= 2) roads.push(pts);
  }
  return roads;
}

// Parse anything (JSON string or already-parsed object, trusted or not) into a
// MapDoc, or null if it cannot be salvaged (no usable zones). Server routes and
// the editor's import path both call THIS; there is no other validation layer.
export function sanitizeMapDoc(raw: unknown): MapDoc | null {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const content = (o.content && typeof o.content === 'object' ? o.content : {}) as Record<
    string,
    unknown
  >;
  const zones = arr(content.zones).filter(zoneIsUsable).slice(0, MAX_ZONES).map(fillZoneDefaults);
  if (zones.length === 0) return null; // nothing to render/play
  const npcsRaw = content.npcs && typeof content.npcs === 'object' ? (content.npcs as object) : {};
  const npcs: Record<string, NpcDef> = {};
  for (const [key, value] of Object.entries(npcsRaw).slice(0, MAX_NPCS)) {
    const npc = sanitizeNpc(value);
    if (npc) npcs[key.slice(0, MAX_ID_LENGTH)] = npc;
  }
  const doc: MapDoc = {
    // The sanitizer always produces v2 semantics, so the stored version is
    // always 2 (never a client-supplied value round-tripped verbatim).
    version: MAP_DOC_VERSION,
    meta: sanitizeMeta(o.meta),
    content: {
      // Zones keep their full shape beyond the load-bearing fields gated
      // above; camps/npcs/objects are rebuilt field by field (the Sim spawn
      // loop trusts every number in them).
      zones,
      camps: arr(content.camps)
        .slice(0, MAX_CAMPS)
        .map(sanitizeCamp)
        .filter((c): c is CampDef => c !== null),
      npcs,
      objects: arr(content.objects)
        .slice(0, MAX_OBJECTS)
        .map(sanitizeGroundObject)
        .filter((g): g is GroundObjectDef => g !== null),
      roads: sanitizeRoads(content.roads),
    },
    terrainEdits: arr(o.terrainEdits)
      .slice(0, MAX_TERRAIN_EDITS)
      .map(sanitizeStamp)
      .filter((s): s is HeightStamp => s !== null),
    placements: arr(o.placements)
      .slice(0, MAX_PLACEMENTS)
      .map(sanitizePlacement)
      .filter((p): p is MapPlacement => p !== null),
    biomePaint: sanitizeBiomePaint(o.biomePaint),
  };
  // Promoted-scenery flags: only `true` entries survive, keys clamped to
  // short identifiers so a hostile doc cannot smuggle arbitrary data here.
  if (o.promotedScenery && typeof o.promotedScenery === 'object') {
    const flags: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(o.promotedScenery as Record<string, unknown>)) {
      if (value === true && /^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key)) flags[key] = true;
    }
    if (Object.keys(flags).length > 0) doc.promotedScenery = flags;
  }
  const blockers = arr(o.blockers)
    .slice(0, MAX_BLOCKERS)
    .map(sanitizeBlocker)
    .filter((b): b is BlockerDef => b !== null);
  if (blockers.length > 0) doc.blockers = blockers;
  const wallRuns = arr(o.wallRuns)
    .slice(0, MAX_WALL_RUNS)
    .map(sanitizeWallRun)
    .filter((w): w is WallRunDef => w !== null);
  if (wallRuns.length > 0) doc.wallRuns = wallRuns;
  const roadDefs = arr(o.roadDefs)
    .slice(0, MAX_ROAD_DEFS)
    .map(sanitizeRoadDef)
    .filter((r): r is RoadDef => r !== null);
  if (roadDefs.length > 0) doc.roadDefs = roadDefs;
  const caves = arr(o.caves)
    .slice(0, MAX_CAVES)
    .map(sanitizeCave)
    .filter((c): c is CaveDef => c !== null);
  if (caves.length > 0) doc.caves = caves;
  const cavePatches = arr(o.cavePatches)
    .slice(0, LEGACY_MAX_CAVE_PATCHES)
    .map(sanitizeCavePatch)
    .filter((c): c is CavePatch => c !== null);
  if (cavePatches.length > 0) doc.cavePatches = cavePatches;
  if (o.assetCollision && typeof o.assetCollision === 'object') {
    const bakes: Record<string, AssetCollisionBox[]> = {};
    for (const [id, raw] of Object.entries(o.assetCollision as Record<string, unknown>).slice(
      0,
      MAX_ASSET_COLLISION_ENTRIES,
    )) {
      if (!/^(local|user)\//.test(id)) continue;
      const boxes = arr(raw)
        .slice(0, MAX_ASSET_COLLISION_BOXES)
        .map(sanitizeAssetCollisionBox)
        .filter((b): b is AssetCollisionBox => b !== null);
      if (boxes.length > 0) bakes[id] = boxes;
    }
    if (Object.keys(bakes).length > 0) doc.assetCollision = bakes;
  }
  if (o.assetCollisionMesh && typeof o.assetCollisionMesh === 'object') {
    const bakes: Record<string, AssetCollisionBox[]> = {};
    for (const [id, raw] of Object.entries(o.assetCollisionMesh as Record<string, unknown>).slice(
      0,
      MAX_ASSET_COLLISION_ENTRIES,
    )) {
      if (typeof id !== 'string' || id.length > 128) continue;
      const boxes = arr(raw)
        .slice(0, MAX_ASSET_COLLISION_MESH_BOXES)
        .map(sanitizeAssetCollisionBox)
        .filter((b): b is AssetCollisionBox => b !== null);
      if (boxes.length > 0) bakes[id] = boxes;
    }
    if (Object.keys(bakes).length > 0) doc.assetCollisionMesh = bakes;
  }
  if (o.assetSway && typeof o.assetSway === 'object') {
    const sway: Record<string, boolean> = {};
    for (const [id, raw] of Object.entries(o.assetSway as Record<string, unknown>).slice(
      0,
      MAX_ASSET_COLLISION_ENTRIES,
    )) {
      if (typeof id !== 'string' || id.length === 0 || id.length > 128) continue;
      // Sway is ON by default, so `true` carries no information: storing only
      // the opt-outs keeps a document from growing an entry per placed plant.
      if (raw === false) sway[id] = false;
    }
    if (Object.keys(sway).length > 0) doc.assetSway = sway;
  }
  const holes = arr(o.holes)
    .slice(0, MAX_TERRAIN_HOLES)
    .map(sanitizeTerrainCut)
    .map(cutInWorld)
    .filter((h): h is TerrainCut => h !== null);
  if (holes.length > 0) doc.holes = holes;
  const holePatches = arr(o.holePatches)
    .slice(0, MAX_HOLE_PATCHES)
    .map(sanitizeTerrainCut)
    .map(cutInWorld)
    .filter((h): h is TerrainCut => h !== null);
  if (holePatches.length > 0) doc.holePatches = holePatches;
  const detailRegions = arr(o.detailRegions)
    .slice(0, MAX_DETAIL_REGIONS)
    .map((v): DetailRegion | null => {
      if (typeof v !== 'object' || v === null) return null;
      const r = v as Record<string, unknown>;
      const x = Number(r.x);
      const z = Number(r.z);
      const radius = Number(r.radius);
      const cell = Number(r.cell);
      if (![x, z, radius, cell].every(Number.isFinite)) return null;
      return {
        x,
        z,
        radius: clamp(radius, 1, MAX_DETAIL_RADIUS),
        cell: clamp(cell, DETAIL_CELL_MIN, DETAIL_CELL_MAX),
      };
    })
    .filter((v): v is DetailRegion => v !== null);
  if (detailRegions.length > 0) doc.detailRegions = detailRegions;
  if (finiteNum(o.caveMeshCell)) {
    doc.caveMeshCell = clamp(Number(o.caveMeshCell), DETAIL_CELL_MIN, DETAIL_CELL_MAX);
  }
  if (finiteNum(o.waterLevel)) {
    doc.waterLevel = clamp(o.waterLevel, MIN_WATER_LEVEL, MAX_WATER_LEVEL);
  }
  if (finiteNum(o.waterHue)) doc.waterHue = clamp(o.waterHue, 0, 360);
  if (finiteNum(o.waterLum)) doc.waterLum = clamp(o.waterLum, 0, 1);
  if (finiteNum(o.worldHalfX)) {
    doc.worldHalfX = clamp(o.worldHalfX, 20, MAX_WORLD_COORD);
  }
  {
    const wa = o.worldAnchor as Record<string, unknown> | undefined;
    if (wa && typeof wa === 'object' && finiteNum(wa.x) && finiteNum(wa.z)) {
      doc.worldAnchor = {
        x: clamp(wa.x, -MAX_WORLD_COORD, MAX_WORLD_COORD),
        z: clamp(wa.z, -MAX_WORLD_COORD, MAX_WORLD_COORD),
      };
    }
    const tb = o.terrainBase as Record<string, unknown> | undefined;
    if (tb && typeof tb === 'object' && finiteNum(tb.x) && finiteNum(tb.z)) {
      doc.terrainBase = {
        x: clamp(tb.x, -MAX_WORLD_COORD, MAX_WORLD_COORD),
        z: clamp(tb.z, -MAX_WORLD_COORD, MAX_WORLD_COORD),
      };
    }
  }
  // Region map (see MapDoc.regionSource): an unknown id is dropped, so a
  // document from a newer build opens as an ordinary map instead of claiming
  // to be a region this build cannot export.
  if (isRegionId(o.regionSource)) doc.regionSource = o.regionSource;
  const ps = o.playerStart as Record<string, unknown> | undefined;
  if (ps && typeof ps === 'object' && finiteNum(ps.x) && finiteNum(ps.z)) {
    doc.playerStart = { x: ps.x, z: ps.z };
  }
  const psa = o.playerSpawnArea as Record<string, unknown> | undefined;
  if (
    psa &&
    typeof psa === 'object' &&
    finiteNum(psa.minX) &&
    finiteNum(psa.minZ) &&
    finiteNum(psa.maxX) &&
    finiteNum(psa.maxZ)
  ) {
    doc.playerSpawnArea = {
      minX: coord(Math.min(psa.minX, psa.maxX)),
      minZ: coord(Math.min(psa.minZ, psa.maxZ)),
      maxX: coord(Math.max(psa.minX, psa.maxX)),
      maxZ: coord(Math.max(psa.minZ, psa.maxZ)),
    };
  }
  if (
    o.propsMode === 'empty' ||
    o.propsMode === 'editable-major' ||
    o.propsMode === 'editable-all'
  ) {
    doc.propsMode = o.propsMode;
  }
  if (o.decorationsMode === 'empty') doc.decorationsMode = 'empty';
  const decorationExclusions = arr(o.decorationExclusions)
    .filter((value): value is string => typeof value === 'string')
    .filter((value) =>
      /^(?:(?:tree|tree2|rock)|dress:(?:bush|bushFlowers|fern|mushroom)):-?\d+\.\d{3}:-?\d+\.\d{3}$/.test(
        value,
      ),
    )
    .slice(0, MAX_DECORATION_EXCLUSIONS);
  if (decorationExclusions.length > 0) {
    doc.decorationExclusions = [...new Set(decorationExclusions)];
  }
  const grassClear = arr(o.grassClear)
    .map((v): GrassClearCircle | null => {
      if (!v || typeof v !== 'object') return null;
      const c = v as Record<string, unknown>;
      if (!finiteNum(c.x) || !finiteNum(c.z) || !finiteNum(c.r) || c.r <= 0) return null;
      return { x: coord(c.x), z: coord(c.z), r: clamp(c.r, 0.1, 400) };
    })
    .filter((c): c is GrassClearCircle => c !== null)
    .slice(0, MAX_GRASS_CLEAR);
  if (grassClear.length > 0) doc.grassClear = grassClear;
  if (
    o.presentationMode === 'blank' ||
    o.presentationMode === 'dungeon' ||
    o.presentationMode === 'temple' ||
    o.presentationMode === 'nythraxis' ||
    o.presentationMode === 'delve' ||
    o.presentationMode === 'sowfield' ||
    o.presentationMode === 'yumiMaze' ||
    // The Deepglass arena. Omitting it here silently dropped the flag on every
    // parse, and that one flag gates the whole venue: the bell and stadium
    // (renderer.ts), the marshal, the bell wizard and the crowd (sim.ts), the
    // match-day market (props.ts) and the pinned arena hour. A doc that lost it
    // opened as an empty caldera.
    o.presentationMode === 'deepglass'
  ) {
    doc.presentationMode = o.presentationMode;
  }
  // Skybox token: 'builtin:<id>' or 'custom:<sha256>' (bounded; resolution
  // and fallback live render-side).
  if (
    typeof o.skybox === 'string' &&
    o.skybox.length <= 80 &&
    (o.skybox.startsWith('builtin:') || o.skybox.startsWith('custom:'))
  ) {
    doc.skybox = o.skybox;
  }
  const locations = arr(o.locations)
    .slice(0, MAX_LOCATIONS)
    .map((v): MapLocation | null => {
      const l = v as Record<string, unknown>;
      if (!l || typeof l !== 'object' || typeof l.name !== 'string') return null;
      if (!finiteNum(l.minX) || !finiteNum(l.minZ) || !finiteNum(l.maxX) || !finiteNum(l.maxZ)) {
        return null;
      }
      const name = l.name.trim().slice(0, MAX_LOCATION_NAME);
      if (!name) return null;
      return {
        name,
        minX: Math.min(l.minX, l.maxX),
        minZ: Math.min(l.minZ, l.maxZ),
        maxX: Math.max(l.minX, l.maxX),
        maxZ: Math.max(l.minZ, l.maxZ),
      };
    })
    .filter((l): l is MapLocation => l !== null);
  if (locations.length > 0) doc.locations = locations;
  const markers = arr(o.markers)
    .slice(0, MAX_MARKERS)
    .map((v): MapMarker | null => {
      const m = v as Record<string, unknown>;
      if (!m || typeof m !== 'object' || typeof m.name !== 'string') return null;
      if (!finiteNum(m.x) || !finiteNum(m.z)) return null;
      const name = m.name.trim().slice(0, MAX_LOCATION_NAME);
      if (!name) return null;
      return {
        name,
        kind: m.kind === 'object' ? 'object' : 'npc',
        x: m.x,
        z: m.z,
      };
    })
    .filter((m): m is MapMarker => m !== null);
  if (markers.length > 0) doc.markers = markers;
  const lights = arr(o.lights)
    .slice(0, MAX_LIGHTS)
    .map((v): MapLight | null => {
      const l = v as Record<string, unknown>;
      if (!l || typeof l !== 'object') return null;
      if (!finiteNum(l.x) || !finiteNum(l.z)) return null;
      return {
        x: l.x,
        z: l.z,
        y: finiteNum(l.y) ? clamp(l.y, 0, 60) : 2,
        color: finiteNum(l.color) ? Math.round(clamp(l.color, 0, 0xffffff)) : 0xffb46a,
        intensity: finiteNum(l.intensity) ? clamp(l.intensity, 0.1, 30) : 6,
        range: finiteNum(l.range) ? clamp(l.range, 2, 120) : 32,
      };
    })
    .filter((l): l is MapLight => l !== null);
  if (lights.length > 0) doc.lights = lights;
  const style = sanitizeTerrainStyle(o.terrainStyle);
  if (style) doc.terrainStyle = style;
  if (finiteNum(o.timeScale)) {
    const ts = clamp(o.timeScale, MIN_TIME_SCALE, MAX_TIME_SCALE);
    if (ts !== 1) doc.timeScale = ts;
  }
  if (finiteNum(o.assetViewDistance)) {
    const d = clamp(o.assetViewDistance, MIN_ASSET_VIEW_DISTANCE, MAX_ASSET_VIEW_DISTANCE);
    if (d !== DEFAULT_ASSET_VIEW_DISTANCE) doc.assetViewDistance = d;
  }
  const weather = sanitizeWeather(o.weather);
  if (weather) doc.weather = weather;
  const lighting = sanitizeLighting(o.lighting);
  if (lighting) doc.lighting = lighting;
  if (o.zoneAtmosphere && typeof o.zoneAtmosphere === 'object') {
    const zoneIds = new Set(doc.content.zones.map((zone) => zone.id));
    const zones: Record<string, ZoneAtmosphere> = {};
    for (const [zoneId, raw] of Object.entries(o.zoneAtmosphere as Record<string, unknown>)) {
      if (!zoneIds.has(zoneId) || !raw || typeof raw !== 'object') continue;
      const value = raw as Record<string, unknown>;
      const entry: ZoneAtmosphere = {};
      const zoneLighting = sanitizeLighting(value.lighting);
      if (zoneLighting) entry.lighting = zoneLighting;
      if (finiteNum(value.timeScale)) {
        entry.timeScale = clamp(value.timeScale, MIN_TIME_SCALE, MAX_TIME_SCALE);
      }
      if (value.skybox === null) entry.skybox = null;
      else if (
        typeof value.skybox === 'string' &&
        value.skybox.length <= 80 &&
        (value.skybox.startsWith('builtin:') || value.skybox.startsWith('custom:'))
      ) {
        entry.skybox = value.skybox;
      }
      const zoneWeather = sanitizeWeather(value.weather);
      if (zoneWeather) entry.weather = zoneWeather;
      if (Object.keys(entry).length > 0) zones[zoneId] = entry;
    }
    if (Object.keys(zones).length > 0) doc.zoneAtmosphere = zones;
  }
  const music = sanitizeMusic(o.music);
  if (music) doc.music = music;
  const pointSounds = arr(o.pointSounds)
    .slice(0, MAX_POINT_SOUNDS)
    .map((v): MapPointSound | null => {
      const s = v as Record<string, unknown>;
      if (!s || typeof s !== 'object') return null;
      if (!finiteNum(s.x) || !finiteNum(s.z)) return null;
      if (typeof s.sound !== 'string' || s.sound.length === 0) return null;
      return {
        x: s.x,
        z: s.z,
        y: finiteNum(s.y) ? clamp(s.y, 0, 60) : 2,
        sound: s.sound.slice(0, MAX_SOUND_ID_LENGTH),
        volume: finiteNum(s.volume) ? clamp(s.volume, 0, 1) : 0.6,
        radius: finiteNum(s.radius) ? clamp(s.radius, 2, 200) : 24,
      };
    })
    .filter((s): s is MapPointSound => s !== null);
  if (pointSounds.length > 0) doc.pointSounds = pointSounds;
  const decals = sanitizeDecals(o.decals);
  if (decals.length > 0) doc.decals = decals;
  return doc;
}

// Authored ground decals. The art reference is validated for SHAPE only (a
// built-in library key or a content hash) — sim code cannot import the render
// layer's decal list, and the renderer simply skips an art id it cannot
// resolve, so an unknown one round-trips instead of being destroyed.
function sanitizeDecals(v: unknown): MapDecal[] {
  const out: MapDecal[] = [];
  for (const raw of arr(v).slice(0, MAX_DECALS)) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    if (!finiteNum(d.x) || !finiteNum(d.z)) continue;
    if (typeof d.tex !== 'string') continue;
    if (!/^[a-f0-9]{64}$/.test(d.tex) && !/^builtin:[A-Za-z0-9_]{1,40}$/.test(d.tex)) continue;
    const decal: MapDecal = {
      x: coord(d.x),
      z: coord(d.z),
      tex: d.tex,
      size: finiteNum(d.size) ? clamp(d.size, MIN_DECAL_SIZE, MAX_DECAL_SIZE) : DEFAULT_DECAL_SIZE,
      // Yaw wraps rather than clamps: a maker spinning past a full turn should
      // keep spinning, not stick at the bound.
      rot: finiteNum(d.rot) ? ((d.rot % TAU) + TAU) % TAU : 0,
    };
    if (finiteNum(d.aspect) && d.aspect !== 1) decal.aspect = clamp(d.aspect, 0.1, 10);
    if (finiteNum(d.opacity) && d.opacity < 1) decal.opacity = clamp(d.opacity, 0, 1);
    if (finiteNum(d.color) && d.color !== 0xffffff) {
      decal.color = Math.floor(clamp(d.color, 0, 0xffffff));
    }
    if (finiteNum(d.glow) && d.glow > 0) decal.glow = clamp(d.glow, 0, 1);
    if (finiteNum(d.sort) && d.sort !== 0) decal.sort = Math.round(clamp(d.sort, -8, 8));
    out.push(decal);
  }
  return out;
}

export const MAX_MUSIC_AREAS = 24;
const MAX_TRACK_ID_LENGTH = 40;

// Track ids are validated for SHAPE only (sim code cannot import the game's
// track list); the client ignores unknown ids at play time.
function sanitizeMusic(v: unknown): MapMusic | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const m = v as Record<string, unknown>;
  const out: MapMusic = {};
  if (typeof m.zoneTrack === 'string' && m.zoneTrack.length > 0) {
    out.zoneTrack = m.zoneTrack.slice(0, MAX_TRACK_ID_LENGTH);
  }
  if (Array.isArray(m.areas)) {
    const areas = m.areas
      .slice(0, MAX_MUSIC_AREAS)
      .map((raw): NonNullable<MapMusic['areas']>[number] | null => {
        if (!raw || typeof raw !== 'object') return null;
        const a = raw as Record<string, unknown>;
        if (
          !finiteNum(a.minX) ||
          !finiteNum(a.minZ) ||
          !finiteNum(a.maxX) ||
          !finiteNum(a.maxZ) ||
          typeof a.track !== 'string' ||
          a.track.length === 0
        ) {
          return null;
        }
        const minX = Math.min(a.minX, a.maxX);
        const maxX = Math.max(a.minX, a.maxX);
        const minZ = Math.min(a.minZ, a.maxZ);
        const maxZ = Math.max(a.minZ, a.maxZ);
        if (maxX - minX < 1 || maxZ - minZ < 1) return null;
        return {
          minX,
          minZ,
          maxX,
          maxZ,
          track: a.track.slice(0, MAX_TRACK_ID_LENGTH),
        };
      })
      .filter((a): a is NonNullable<MapMusic['areas']>[number] => a !== null);
    if (areas.length > 0) out.areas = areas;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const WEATHER_MODES = new Set(['auto', 'clear', 'rain', 'snow', 'sparkle', 'blizzard']);
export const MAX_WEATHER_SCHEDULE = 12;

/** Authored scene lighting: every field required + clamped to the editor's
 *  slider ranges, colors masked to 24-bit. Anything unsalvageable drops the
 *  whole block (the map falls back to the shipped biome/day-night rig). */
function sanitizeLighting(v: unknown): MapLighting | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const l = v as Record<string, unknown>;
  if (
    !finiteNum(l.sunIntensity) ||
    !finiteNum(l.sunColor) ||
    !finiteNum(l.hemiIntensity) ||
    !finiteNum(l.skyColor) ||
    !finiteNum(l.envScale) ||
    !finiteNum(l.sunAzimuthDeg) ||
    !finiteNum(l.sunElevationDeg)
  ) {
    return undefined;
  }
  return {
    sunIntensity: clamp(l.sunIntensity, 0, 6),
    sunColor: Math.round(clamp(l.sunColor, 0, 0xffffff)),
    hemiIntensity: clamp(l.hemiIntensity, 0, 2),
    skyColor: Math.round(clamp(l.skyColor, 0, 0xffffff)),
    envScale: clamp(l.envScale, 0, 2),
    sunAzimuthDeg: clamp(l.sunAzimuthDeg, 0, 360),
    sunElevationDeg: clamp(l.sunElevationDeg, 5, 85),
  };
}

function sanitizeWeather(v: unknown): MapWeather | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const w = v as Record<string, unknown>;
  const out: MapWeather = {};
  if (typeof w.mode === 'string' && WEATHER_MODES.has(w.mode) && w.mode !== 'auto') {
    out.mode = w.mode as MapWeather['mode'];
  }
  if (finiteNum(w.intensity) && w.intensity !== 1) out.intensity = clamp(w.intensity, 0, 1);
  const clouds = w.clouds as Record<string, unknown> | undefined;
  if (clouds && typeof clouds === 'object' && finiteNum(clouds.coverage) && clouds.coverage > 0) {
    out.clouds = {
      coverage: clamp(clouds.coverage, 0, 1),
      height: finiteNum(clouds.height) ? clamp(clouds.height, 0, 200) : 60,
    };
  }
  if (Array.isArray(w.schedule)) {
    const steps = w.schedule
      .slice(0, MAX_WEATHER_SCHEDULE)
      .map((raw): { mode: WeatherPrecipMode; minutes: number } | null => {
        if (!raw || typeof raw !== 'object') return null;
        const s = raw as Record<string, unknown>;
        if (typeof s.mode !== 'string' || !WEATHER_MODES.has(s.mode) || s.mode === 'auto') {
          return null;
        }
        return {
          mode: s.mode as WeatherPrecipMode,
          minutes: finiteNum(s.minutes) ? clamp(s.minutes, 0.1, 120) : 5,
        };
      })
      .filter((s): s is { mode: WeatherPrecipMode; minutes: number } => s !== null);
    if (steps.length > 0) out.schedule = steps;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Keep only explicit FALSE flags (absent = rule on), so a default document
// round-trips without the field at all.
function sanitizeTerrainStyle(v: unknown): TerrainStyle | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const s = v as Record<string, unknown>;
  const out: TerrainStyle = {};
  if (s.slopeRock === false) out.slopeRock = false;
  if (s.snowCaps === false) out.snowCaps = false;
  if (s.rimMountains === false) out.rimMountains = false;
  if (s.shoreSand === false) out.shoreSand = false;
  return Object.keys(out).length > 0 ? out : undefined;
}
