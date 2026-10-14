// The right-hand context inspector: per-tool option panels (brush, biome
// palette, water level, placement options, camp editor, spawn point, region
// clipboard, erase help), the Select-mode placement/marker editors, the
// procedural generators, and the 2D layer/frame controls. Owns no state: it
// reads and writes through the injected deps and re-renders on refresh().

import { MUSIC_ZONES } from '../game/music';
import { assetUrl } from '../render/assets/media';
import { BUILTIN_SKYBOXES } from '../render/assets/skyboxes';
import { DECAL_CATEGORY_ORDER } from '../render/decal_library.generated';
import type { EditorLightingProfile } from '../render/editor_lighting';
import { FOLIAGE_PRESETS, foliagePreset } from '../render/foliage_gen';
import { LEAF_SETS } from '../render/leaf_sets.generated';
import { MATERIAL_GROUP_LABEL, modelMaterialOptions } from '../render/model_materials';
import { DEFAULT_TEXTURE_TILE_YD } from '../render/terrain';
import { paintTextureSlotUsage } from '../render/terrain_paint_layers';
import {
  builtinShaFor,
  paintDefaultSets,
  TERRAIN_TEXTURE_SETS,
} from '../render/terrain_texture_sets';
import { TREE_PRESETS, treeVolumesFor } from '../render/tree_gen';
import { TRUNKS } from '../render/tree_trunks.generated';
import { autoCollideRadius } from '../sim/asset_collision';
import {
  DEFAULT_MOB_RESPAWN_SECONDS,
  MAX_AUTHORED_CAMP_LEVEL,
  MAX_CAMP_RESPAWN_SECONDS,
  MIN_CAMP_RESPAWN_SECONDS,
  MOB_STAT_MOD_MAX,
  MOB_STAT_MOD_MIN,
} from '../sim/camp_authoring';
import { CLUTTER_KINDS } from '../sim/city_clutter';
import { COLLIDER_DEFAULT_SIZE, type ColliderVolumeKind } from '../sim/collider_volumes';
import {
  assetFirePreset,
  MAX_ASSET_FIRE_EMITTERS,
  nextAssetFireId,
  sanitizeAssetFireEmitter,
} from '../sim/fire_effects';
import { FLUID_PRESETS, type FluidKind } from '../sim/fluid_volumes';
import {
  FOLIAGE_KINDS,
  type FoliageKind,
  type FoliageNumericKey,
  type FoliageParams,
  foliageHasLeafCards,
  foliageHasTrunk,
  foliageKindOf,
  foliageLimitsFor,
  resolvedFoliageParams,
} from '../sim/foliage_params';
import {
  type CollisionMode,
  MAX_AUTHORING_NOTES_LENGTH,
  MAX_CAMP_COUNT,
  MAX_CAMP_RADIUS,
  MAX_COLLIDE_RADIUS,
  MAX_DECAL_SIZE,
  MAX_WATER_LEVEL,
  MIN_COLLIDE_RADIUS,
  MIN_DECAL_SIZE,
  MIN_WATER_LEVEL,
  MODEL_ASSET_ID,
  NPC_ROUTE_SPEED_MAX,
  NPC_ROUTE_SPEED_MIN,
  ROCK_ASSET_ID,
} from '../sim/map_doc';
import { NOISE_SIZE_MAX, NOISE_SIZE_MIN } from '../sim/terrain_noise_brush';
import {
  MAX_TREE_VOLUMES,
  TREE_LEAF_ORIENTS,
  TREE_LIMITS,
  TREE_SHAPES,
  type TreeCanopyShape,
  type TreeLeafOrient,
  type TreeNumericKey,
  type TreeParams,
  type TreeVolume,
} from '../sim/tree_params';
import type {
  AssetFireEmitter,
  AssetFireStyle,
  AuthorVfx,
  CampStatMods,
  CustomPaintSwatch,
  MapDecal,
  TerrainBrushAlphaId,
  WeatherPrecipMode,
} from '../sim/types';
import { captureFocusKey, findFocusKey, restoreFirstEnabled } from '../ui/focus_restore';
import { formatNumber, t } from '../ui/i18n';
import { assetById } from './asset_catalog.generated';
import { BUILTIN_ALPHAS, brushAlphaThumb, listBrushAlphas, removeBrushAlpha } from './brush_alphas';
import { type BuildingPanelDeps, buildBuildModePanel } from './building_panel';
import { STREAM_ZONE_COUNT } from './camera_zone_core';
import { DIG_ALPHA_KINDS, type DigAlpha } from './carve_voxel_core';
import { buildCityBuildPanel, type CityBuildPanelDeps } from './city_build_panel';
import type { CmSculptTool } from './cm_mesh_sculpt_core';
import {
  CUT_BRUSH_LIMITS,
  CUT_BRUSH_SHAPES,
  type CutBrush,
  type CutBrushShape,
  type CutChange,
  type CutSummary,
  type TunnelMode,
} from './cut_tool_core';
import {
  type DecalBrush,
  type DecalLibraryEntry,
  decalName,
  decalThumbUrl,
  listDecals,
} from './decal_tool';
import { button, checkbox, el, iconButton, selectRow, slider } from './dom';
import {
  type CharacterVisualOption,
  catalogMatches,
  type MobCatalogOption,
} from './entity_authoring';
import { PLACEMENT_SCALE_MAX, PLACEMENT_SCALE_MIN } from './placement_transform_core';
import { POINT_SOUND_CLIPS, pointSoundLabel } from './point_sounds';
import { adjustedSwatchColor } from './swatch_color';
import { buildModal } from './toasts';
import type { EditorTool } from './toolbar';

// Scene Collection row glyphs (24x24 stroke paths, Feather-style) painted via
// iconButton so the panel carries no emoji.
const ICON_LOCK_CLOSED = 'M6 10V7a6 6 0 1 1 12 0v3M5 10h14v11H5zM12 14v3';
const ICON_LOCK_OPEN = 'M6 10V7a6 6 0 1 1 12 0M5 10h14v11H5zM12 14v3';
const ICON_EYE =
  'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z';
const ICON_EYE_OFF =
  'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.06 6.06A18.45 18.45 0 0 0 2 12s3 8 10 8a10.07 10.07 0 0 0 5.94-1.94M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20';
const ICON_PIN =
  'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z';

export interface CampSelection {
  index: number;
  mobId: string;
  count: number;
  radius: number;
  levelMin: number | null;
  levelMax: number | null;
  authorVfx: AuthorVfx | null;
  aiNotes: string;
  questNotes: string;
}

/** One subject's authored patrol, folded down for the panel. */
export interface PatrolSummary {
  points: number;
  mode: 'loop' | 'pingpong';
  speed: number;
}

export interface MovableEntitySelection {
  kind: 'npc' | 'mobs';
  key: string;
  name: string;
  facing: number | null;
  title: string;
  visualKey: string | null;
  authorRole: string;
  authorVfx: AuthorVfx | null;
  aiNotes: string;
  questNotes: string;
  /** How many NPCs the pick covers (Ctrl+click groups them). */
  count: number;
  /** The NPC's authored patrol, or null when it stands still. */
  route: PatrolSummary | null;
}

/**
 * The mobs picked with the Mob tool, folded into one editable row. Multi-select
 * reports the FIRST mob's values and `mixed` flags where the rest disagree; an
 * edit always writes through to every selected mob.
 */
export interface MobToolSelection {
  /** How many individual mobs the selection covers. */
  count: number;
  /** Shared template id, or null when the selection spans several types. */
  mobId: string | null;
  /** Template display name for the header (or a mixed-selection label). */
  label: string;
  levelMin: number | null;
  levelMax: number | null;
  /** Resolved multipliers (1 where the mob authored none). */
  statMods: Required<CampStatMods>;
  /** Seconds, or null for the realm default. */
  respawnSeconds: number | null;
  /** The authored patrol, or null when the mob still wanders its spawn point. */
  route: PatrolSummary | null;
  authorVfx: AuthorVfx | null;
  aiNotes: string;
  questNotes: string;
  /** Selected mobs disagree on at least one field shown here. */
  mixed: boolean;
}

/** Live state of the click-to-place patrol waypoint mode. */
export interface MobRouteDraft {
  points: number;
  mode: 'loop' | 'pingpong';
  speed: number;
  wait: number;
}

export interface PlacementSelection {
  index: number;
  assetId: string;
  assetLabel: string;
  x: number;
  /** Vertical offset above the terrain seat (yards), null = seated (0). */
  y: number | null;
  z: number;
  rotY: number;
  scale: number;
  collide: boolean;
  /** Authored collision-radius override (yards), or null = derived from scale. */
  collideRadius: number | null;
  /** Footprint shape: null = circle (default), 'square' = yaw-following box. */
  collideShape: 'square' | null;
  /** The effective collision type (the dropdown's value). */
  collisionMode: CollisionMode;
  /** Boxes the baked mode would block with (edited count when edited). */
  hitboxCount: number;
  /** The placement carries hand-edited hitboxes. */
  hasHitboxEdits: boolean;
  /** A hitbox preset for this asset exists on this device. */
  hasHitboxPreset: boolean;
  /** How many OTHER placements on the map share this asset id (0 = unique). */
  sameAssetCount: number;
  /** How this asset would sway if sway is on, or null when it is rigid (a
   *  crate, a wall) and the toggle should not be offered at all. */
  swayKind: 'tree' | 'bush' | null;
  /** Whether wind sway is on for this ASSET (the default). */
  swayEnabled: boolean;
  /** "True collision" fine-bake state for this asset. */
  meshBakeReady: boolean;
  meshBakePending: boolean;
  /** Non-null when the selection is a collider volume placement. */
  colliderKind: ColliderVolumeKind | null;
  /** Shader tweaks (null = not overridden). */
  tint: number | null;
  opacity: number | null;
  glow: number | null;
  glowStrength: number | null;
  /** Animated fire effect at the model's top. */
  fire: boolean;
  /** Rich independently positioned fire sources (legacy `fire` may be empty). */
  fireEffects: readonly AssetFireEmitter[];
  /** Authored collider dimensions (yards at scale 1), null = kind default. */
  sizeX: number | null;
  sizeY: number | null;
  sizeZ: number | null;
  /** Non-null when the selection is a fluid pool placement. */
  fluidKind: FluidKind | null;
  /** Fluid tint overrides (null = the kind preset). */
  hue: number | null;
  lum: number | null;
  fluidDps: number | null;
  fluidFx: number | null;
  /** Generated-rock shape params (null = defaults / not a generated rock). */
  rockSeed: number | null;
  rockNoise: number | null;
  rockDetail: number | null;
  rockSharp: number | null;
  rockTex: number | null;
  rockHeight: number | null;
  rockDepth: number | null;
  rockJag: number | null;
  rockTexId: string | null;
  rockTexTile: number | null;
  /** The generated-tree recipe (null = not a generated tree). */
  tree: TreeParams | null;
}

export interface MarkerSelection {
  label: string;
  x: number;
  z: number;
}

/** Map weather with every field resolved (defaults filled), for the panel. */
export interface ResolvedWeather {
  mode: 'auto' | WeatherPrecipMode;
  intensity: number;
  clouds: { coverage: number; height: number };
  schedule: { mode: WeatherPrecipMode; minutes: number }[];
  /** Aurora strength 0..1 (0 = none). */
  aurora: number;
}

export interface InspectorDeps {
  buildingWorkspace(): BuildingPanelDeps | null;
  buildTransformControls(): HTMLElement | null;
  getTool(): EditorTool;
  getViewMode(): '3d' | '2d';

  /** The City Build workspace panel's dependency bag (city_build_panel.ts). */
  cityBuild(): CityBuildPanelDeps;

  getBrushRadius(): number;
  setBrushRadius(v: number): void;
  getBrushStrength(): number;
  setBrushStrength(v: number): void;
  getTerrainEditStats(): { count: number; max: number };

  getPaintBiome(): number;
  setPaintBiome(id: number): void;
  getPaintHardness(): number;
  setPaintHardness(v: number): void;
  /** Selected brush alpha id (null = plain round brush). */
  getPaintAlpha(): string | null;
  setPaintAlpha(id: string | null): void;
  importPaintAlpha(): void;
  /** Bucket fill: armed = the next terrain click replaces the clicked texture
   *  map-wide with the selected swatch. */
  getBucketArmed(): boolean;
  setBucketArmed(on: boolean): void;

  getLocations(): readonly {
    name: string;
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
  }[];
  renameLocation(index: number, name: string): void;
  deleteLocation(index: number): void;
  getMapLights(): readonly {
    x: number;
    z: number;
    y: number;
    color: number;
    intensity: number;
    range: number;
  }[];
  /** Selected map light (viewport bulb click or panel row click), or null. */
  getSelectedLight(): number | null;
  setSelectedLight(index: number | null): void;
  updateMapLight(
    index: number,
    change: Partial<{ y: number; color: number; intensity: number; range: number }>,
  ): void;
  deleteMapLight(index: number): void;
  getMapSounds(): readonly {
    x: number;
    z: number;
    y: number;
    sound: string;
    volume: number;
    radius: number;
  }[];
  /** Selected map point sound (viewport badge click or panel row click), null. */
  getSelectedSound(): number | null;
  setSelectedSound(index: number | null): void;
  updateMapSound(
    index: number,
    change: Partial<{ y: number; sound: string; volume: number; radius: number }>,
  ): void;
  deleteMapSound(index: number): void;
  getMapDecals(): readonly MapDecal[];
  /** Selected ground decal (viewport click or panel row click), else null. */
  getSelectedDecal(): number | null;
  setSelectedDecal(index: number | null): void;
  updateMapDecal(index: number, change: Partial<MapDecal>): void;
  deleteMapDecal(index: number): void;
  /** The Decal tool's "next stamp" settings. */
  getDecalBrush(): DecalBrush;
  setDecalBrush(change: Partial<DecalBrush>): void;
  /** Pick library art (adopts that decal's authored size/glow/tint defaults). */
  pickDecalArt(tex: string): void;
  importDecalFile(file: File): void;
  getMarkers(): readonly { name: string; kind: 'npc' | 'object'; x: number; z: number }[];
  getMarkerMode(): { placing: boolean; kind: 'npc' | 'object' };
  setMarkerMode(change: Partial<{ placing: boolean; kind: 'npc' | 'object' }>): void;
  renameMarker(index: number, name: string): void;
  deleteMarker(index: number): void;
  getCustomSwatches(): readonly CustomPaintSwatch[];
  /** Auto-texturing rules for this map (resolved: absent flags read true). */
  getTerrainStyle(): {
    slopeRock: boolean;
    scree: boolean;
    snowCaps: boolean;
    rimMountains: boolean;
    shoreSand: boolean;
  };
  setTerrainStyle(
    change: Partial<{
      slopeRock: boolean;
      scree: boolean;
      snowCaps: boolean;
      rimMountains: boolean;
      shoreSand: boolean;
    }>,
  ): void;
  /** Hue/light adjust of the active paint texture (built-in biomes get or
   *  reuse a custom variant swatch; custom swatches edit their own fields). */
  setPaintAdjust(change: { hueShift?: number; light?: number }): void;
  saveAdjustedSwatch(): void;
  importTextureSwatch(): void;
  /** Pick a built-in library texture set (materializes a swatch on first use). */
  pickBuiltinTexture(key: string): void;
  /** Object URL of an imported ground texture (for swatch thumbnails), or
   *  null while it has not resolved from IndexedDB yet. */
  swatchTextureUrl(sha: string): string | null;
  setSwatchTileSize(id: number, tileSize: number): void;
  setSwatchVariation(id: number, variation: number): void;
  setSwatchDepth(id: number, depth: number): void;
  getPaintEdge(): { softness: number; detail: number };
  setPaintEdge(change: Partial<{ softness: number; detail: number }>): void;
  /** Remove a custom swatch from the map; cells painted with it revert to the
   *  base biome look. Undoable. */
  deleteCustomSwatch(id: number): void;
  clearBiomePaint(): void;
  /** One-click: repaint the whole map with elevation/zone/water/path-aware
   *  builtin textures as editable custom swatches (ground look only). */
  autoRetextureMap(): void;

  getFoliage(): {
    density: number;
    minScale: number;
    maxScale: number;
    collide: boolean;
    grass: boolean;
    grassHue: number;
    grassLight: number;
    grassClump: number;
    ferns: boolean;
    bushes: boolean;
    trees: boolean;
    rocks: boolean;
  };
  setFoliage(
    change: Partial<{
      density: number;
      minScale: number;
      maxScale: number;
      collide: boolean;
      grass: boolean;
      grassHue: number;
      grassLight: number;
      grassClump: number;
      ferns: boolean;
      bushes: boolean;
      trees: boolean;
      rocks: boolean;
    }>,
  ): void;
  hasAmbientFoliage(): boolean;
  /** Convert the built-in procedural foliage into editable placements. `all` =
   *  the whole map at once; otherwise the nearest batch to the camera. */
  makeAmbientFoliageEditable(mode: 'all' | 'batch' | 'zone'): void;
  /** Whether the map has any painted no-grass discs (grass-clear brush). */
  hasClearedGrass(): boolean;
  /** Restore all grass the grass-clear brush scrubbed. */
  restoreAllGrass(): void;
  /** Paint Clutter brush settings (kinds is a bitmask over CLUTTER_KINDS). */
  getClutter(): {
    density: number;
    minScale: number;
    maxScale: number;
    clumps: number;
    kinds: number;
    erase: boolean;
  };
  setClutter(
    change: Partial<{
      density: number;
      minScale: number;
      maxScale: number;
      clumps: number;
      kinds: number;
      erase: boolean;
    }>,
  ): void;
  /** How many clutter stamps the map holds. */
  clutterStampCount(): number;
  /** Remove every painted clutter stamp (one undo step). */
  clearAllClutter(): void;
  /** Mesh Fix tool: restore mode, the knockout count, and the full reset. */
  getMeshFixRestore(): boolean;
  setMeshFixRestore(on: boolean): void;
  meshFixCount(): number;
  clearMeshFix(): void;
  /** Custom foliage-brush asset (scatter a chosen asset instead of the built-in
   *  groups), or null for the built-in behaviour. */
  getFoliageCustom(): { assetId: string; label: string } | null;
  pickFoliageCustom(): void;
  clearFoliageCustom(): void;

  getSculptLower(): boolean;
  setSculptLower(on: boolean): void;
  /** Grab (snake hook) mode for the Sculpt tool: press grabs the ground and
   *  the drag pulls it up/down with the cursor. */
  getSculptGrab(): boolean;
  setSculptGrab(on: boolean): void;
  getSculptHardness(): number;
  setSculptHardness(value: number): void;
  getSculptAlpha(): TerrainBrushAlphaId | null;
  setSculptAlpha(id: TerrainBrushAlphaId | null): void;
  /** Slope-based auto texture for the sculpt tools: band ids are paint ids
   *  (biome / custom swatch), -1 = leave that band's paint untouched. */
  getAutoTexture(): { enabled: boolean; angle: number; flatId: number; steepId: number };
  setAutoTexture(
    change: Partial<{ enabled: boolean; angle: number; flatId: number; steepId: number }>,
  ): void;
  getLevelStyle(): 'smooth' | 'sharpen' | 'noise' | 'terrace';
  setLevelStyle(style: 'smooth' | 'sharpen' | 'noise' | 'terrace'): void;
  /** The Noise style's bump size (yards) and roughness (percent). */
  getNoiseSize(): number;
  setNoiseSize(yards: number): void;
  getNoiseRough(): number;
  setNoiseRough(percent: number): void;
  getFlattenSmooth(): boolean;
  setFlattenSmooth(on: boolean): void;
  getFlattenHardEdge(): boolean;
  setFlattenHardEdge(on: boolean): void;

  getWaterLevel(): number;
  previewWaterLevel(v: number): void;
  commitWaterLevel(v: number): void;
  resetWaterLevel(): void;
  /** Rebuild every water sheet from the current terrain (terrain panels). */
  reapplyWater(): void;
  getWaterTint(): { hue: number | null; lum: number | null };
  previewWaterTint(hue: number | null, lum: number | null): void;
  commitWaterTint(hue: number | null, lum: number | null): void;
  resetWaterTint(): void;
  getFluidKind(): FluidKind;
  setFluidKind(kind: FluidKind): void;
  getRockParams(): {
    size: number;
    noise: number;
    detail: number;
    sharp: number;
    tex: number;
    walkable: boolean;
    height: number;
    depth: number;
    jag: number;
    texId: string;
    texTile: number;
  };
  setRockParams(change: {
    size?: number;
    noise?: number;
    detail?: number;
    sharp?: number;
    tex?: number;
    walkable?: boolean;
    height?: number;
    depth?: number;
    jag?: number;
    texId?: string;
    texTile?: number;
  }): void;
  getTreeParams(): { preset: string; params: FoliageParams; showVolumes: boolean };
  treeStudioActive(): boolean;
  enterTreeStudio(): void;
  exitTreeStudio(keep: boolean): void;
  setTreeParams(change: Partial<FoliageParams>): void;
  applyTreePreset(key: string): void;
  /** Export the armed plant as a GLB under public/models/generated, so it
   *  becomes an ordinary catalogue asset (batched, collision-bakeable,
   *  publishable) instead of living only as parameters. */
  bakeFoliage(): void;
  setTreeVolumesShown(on: boolean): void;
  updateSelectedTree(change: Partial<TreeParams>, commit: boolean): void;
  rerollSelectedTree(): void;
  treeParamsFromSelection(): void;
  getRockChainState(): { mode: boolean; count: number };
  setRockChainMode(on: boolean): void;
  generateRockChain(): void;
  clearRockChain(): void;
  getTunnelMode(): TunnelMode;
  setTunnelMode(mode: TunnelMode): void;
  /** The Cut/Carve ghost awaiting commit, or null. index is -1 (not in the
   *  document); depth is its centre's sink below the local surface. */
  getPendingCut(): (CutSummary & { depth: number; erase: boolean }) | null;
  updatePendingCut(change: CutChange & { depth?: number }): void;
  /** Commit the ghost: the ground opens, one undo step. */
  commitPendingCut(): void;
  cancelPendingCut(): void;
  getCarveDepth(): number;
  setCarveDepth(v: number): void;
  /** FORK: the document-wide carve mesh cell + the one-click re-mesh. */
  getCaveMeshCell(): number;
  remeshAllCaves(cell: number): void;
  getRemeshCell(): number;
  setRemeshCell(v: number): void;
  getDetailRegions(): { index: number; x: number; z: number; radius: number; cell: number }[];
  deleteDetailRegion(index: number): void;
  getCaves(): {
    index: number;
    nodes: number;
    width: number;
    height: number;
    variance: number;
    floorVariance: number;
    stalactites: number;
    stalagmites: number;
    spikeSize: number;
    startOpen: boolean;
    endOpen: boolean;
    tex: string | null;
    texTile: number | null;
    autoMouth: boolean;
    mouthBlend: number;
  }[];
  getHoles(): (CutSummary & { depth: number })[];
  getHolePatches(): CutSummary[];
  /** FORK: the Dig/Fill brush's stamp alpha + rim noise, the voxel cell, and
   *  the dug-rock volumes (baked strokes) of the document. */
  getDigAlpha(): DigAlpha;
  setDigAlpha(change: Partial<DigAlpha>): void;
  getDigCell(): number;
  setDigCell(v: number): void;
  hasDugRock(): boolean;
  clearDugRock(): void;
  getCutBrush(): CutBrush;
  setCutBrush(change: Partial<CutBrush>): void;
  getCavePairState(): { pendingExit: boolean; readyToGenerate: number };
  generateCaves(): void;
  updateCave(
    index: number,
    change: {
      width?: number;
      height?: number;
      variance?: number;
      floorVariance?: number;
      stalactites?: number;
      stalagmites?: number;
      spikeSize?: number;
      startOpen?: boolean;
      endOpen?: boolean;
      tex?: string | null;
      texTile?: number | null;
      autoMouth?: boolean;
      mouthBlend?: number;
    },
    commit: boolean,
  ): void;
  reverseCave(index: number): void;
  deleteCave(index: number): void;
  /** Multi-select every rig node of a cave and arm the Move tool, so the
   *  group gizmo translates the whole tube rigidly into place. */
  selectWholeCave(index: number): void;
  updateHole(
    index: number,
    change: CutChange & { depth?: number; tex?: string | null; texTile?: number | null },
    commit: boolean,
  ): void;
  deleteHole(index: number): void;
  updateHolePatch(index: number, change: CutChange, commit: boolean): void;
  deleteHolePatch(index: number): void;
  /** Arm the Place tool with the procedural waterfall asset. */
  placeWaterfall(): void;

  getPlaceScale(): number;
  setPlaceScale(v: number): void;
  getPlaceCollide(): boolean;
  setPlaceCollide(on: boolean): void;
  getPlaceRandomRot(): boolean;
  setPlaceRandomRot(on: boolean): void;
  getPlaceAssetLabel(): string | null;

  mobOptions(): MobCatalogOption[];
  getSelectedCamp(): CampSelection | null;
  updateCamp(change: {
    mobId?: string;
    count?: number;
    radius?: number;
    levelMin?: number | null;
    levelMax?: number | null;
    authorVfx?: AuthorVfx | null;
    aiNotes?: string;
    questNotes?: string;
  }): void;
  deleteCamp(): void;

  npcVisualOptions(): CharacterVisualOption[];
  getNpcPlacement(): string | null;
  beginNpcPlacement(visualKey: string): void;
  cancelNpcPlacement(): void;
  getSelectedMovableEntity(): MovableEntitySelection | null;
  updateSelectedNpc(change: {
    name?: string;
    title?: string;
    visualKey?: string | null;
    authorRole?: string;
    authorVfx?: AuthorVfx | null;
    aiNotes?: string;
    questNotes?: string;
  }): void;
  updateMovableEntityFacing(key: string, facing: number, commit: boolean): void;

  /** The Mob tool's current pick, folded into one editable row. */
  getSelectedMobs(): MobToolSelection | null;
  updateSelectedMobs(change: {
    mobId?: string;
    levelMin?: number | null;
    levelMax?: number | null;
    statMods?: Partial<CampStatMods>;
    respawnSeconds?: number | null;
    routeMode?: 'loop' | 'pingpong';
    routeSpeed?: number;
    clearRoute?: true;
    authorVfx?: AuthorVfx | null;
    aiNotes?: string;
    questNotes?: string;
  }): void;
  deleteSelectedMobs(): void;
  /** Patrol edits for the NPC arm of the same tool. */
  updateSelectedNpcRoute(change: {
    routeMode?: 'loop' | 'pingpong';
    routeSpeed?: number;
    clearRoute?: true;
  }): void;
  deleteSelectedNpcs(): void;
  /** Non-null while the maker is clicking out patrol waypoints. */
  getMobRouteDraft(): MobRouteDraft | null;
  beginMobRoute(): void;
  setMobRouteDraft(change: { mode?: 'loop' | 'pingpong'; speed?: number; wait?: number }): void;
  undoMobRoutePoint(): void;
  finishMobRoute(): void;
  cancelMobRoute(): void;

  getSpawn(): { x: number; z: number } | null;
  getSpawnArea(): { minX: number; minZ: number; maxX: number; maxZ: number } | null;
  clearSpawn(): void;

  copyRegion(): void;
  pasteBeside(): void;

  getBlockerStats(): { count: number; max: number };

  getColliderShape(): ColliderVolumeKind;
  setColliderShape(kind: ColliderVolumeKind): void;

  getSelection(): PlacementSelection | null;
  getSelectedFireEmitter(): number | null;
  setSelectedFireEmitter(index: number | null): void;
  /** Turn wind sway on/off for the selected placement's ASSET. Per-asset, not
   *  per-placement: the sway program lives on the shared template material, so
   *  every placement of the asset moves together (and costs one program). */
  setAssetSway(on: boolean): void;
  /** Live update (slider drag); commit=false does not push an undo entry.
   *  collideRadius: number sets the override, null clears it (back to auto). */
  updateSelection(
    change: {
      x?: number;
      y?: number;
      z?: number;
      rotY?: number;
      scale?: number;
      collide?: boolean;
      collideRadius?: number | null;
      collideShape?: 'square' | null;
      collisionMode?: CollisionMode;
      sizeX?: number;
      sizeY?: number;
      sizeZ?: number;
      tint?: number | null;
      opacity?: number | null;
      glow?: number | null;
      glowStrength?: number | null;
      fire?: boolean | null;
      fireEffects?: AssetFireEmitter[] | null;
      hue?: number | null;
      lum?: number | null;
      fluidDps?: number | null;
      fluidFx?: number | null;
      rockSeed?: number;
      rockNoise?: number;
      rockDetail?: number;
      rockSharp?: number;
      rockTex?: number;
      rockHeight?: number;
      rockDepth?: number;
      rockJag?: number;
      rockTexId?: string | null;
      rockTexTile?: number;
    },
    commit: boolean,
  ): void;
  duplicateSelection(): void;
  deleteSelection(): void;
  /** Prefab pieces the active placement can be split into (0 = not a
   *  Blender-built building with a parts twin). */
  getPrefabPieceCount(): number;
  /** Replace the active building with its kit pieces + shell, each its own
   *  placement (src/editor/prefab_pieces_core.ts). */
  explodeSelection(): void;
  /** Multi-selection size (1 = just the active placement). */
  getSelectionCount(): number;
  /** Placements that would be joined by Combine (0 = nothing to join). */
  getCombineCount(): number;
  /** Join the selection: a split building back into itself, anything else into
   *  a group that behaves as one object (src/editor/prefab_rejoin_core.ts). */
  combineSelection(): void;
  /** Size of the group the active placement belongs to (0 = not grouped). */
  getGroupCount(): number;
  /** Break the active placement's group apart again. */
  ungroupSelection(): void;
  /** How many placements share the active placement's asset (the ones
   *  selectAllOfAsset would take; hidden ones excluded). */
  getSameAssetCount(): number;
  /** Select every placement of the active placement's asset, one click. */
  selectAllOfAsset(): void;
  /** Baked collision box count for an asset id (0 = legacy circle only). */
  getBakedCollisionCount(assetId: string): number;
  getFootprints(): boolean;
  setFootprints(on: boolean): void;
  /** Hitbox edit mode (baked boxes as movable objects): null = not editing. */
  getHitboxEdit(): { count: number; selectedCount: number } | null;
  enterHitboxEdit(): void;
  exitHitboxEdit(): void;
  addHitbox(): void;
  deleteSelectedHitboxes(): void;
  resetHitboxes(): void;
  /** Per-asset hitbox presets (this device): copy on future placements. */
  saveHitboxPreset(): void;
  clearHitboxPreset(): void;
  /** Copy the active placement's whole collision setup (type, radius, shape,
   *  hitbox edits) onto every other placement of the same asset on the map,
   *  after an in-app confirm. */
  copyCollisionToSameAsset(): void;

  // ---- Collision Master (single-asset authored-collision scene) -----------
  /** Active session (or null): the panel replaces the normal tool panels. */
  getCollisionMaster(): { assetId: string; label: string; canSave: boolean } | null;
  /** Starter box sets: the raw voxel bake, one fitted box, or one plain box. */
  collisionMasterStarter(kind: 'bake' | 'fitted' | 'single' | 'cylinder' | 'clear'): void;
  getCollisionMasterPoly(): boolean;
  setCollisionMasterPoly(on: boolean): void;
  /** Lock In: persist as the asset's repo default and return to the map. */
  collisionMasterCommit(): void;
  collisionMasterCancel(): void;
  /** Open Collision Master for the SELECTED placement's asset (catalogue
   *  assets only; the app toasts otherwise). */
  openCollisionMasterForSelection(): void;

  // ---- Build tool (custom modeled objects) -------------------------------
  /** Active Build session (or null): the panel replaces the tool panels. */
  getBuildSession(): { index: number } | null;
  getModelingSculpt(): {
    tool: CmSculptTool | null;
    radius: number;
    strength: number;
    dynamicTopology: boolean;
    targetEdgeLength: number;
    symmetry: { x: boolean; y: boolean; z: boolean };
  };
  setModelingSculptTool(tool: CmSculptTool | null): void;
  setModelingSculptSettings(
    change: Partial<{
      radius: number;
      strength: number;
      dynamicTopology: boolean;
      targetEdgeLength: number;
      symmetry: { x: boolean; y: boolean; z: boolean };
    }>,
  ): void;
  /** Finish the Build session (keep the model). */
  buildDone(): void;
  /** The model the panel edits (Build session model, else a selected model),
   *  or null when neither applies. */
  getModelPanel(): {
    texId: string | undefined;
    texTile: number;
    hue: number;
    sat: number;
    light: number;
    collide: boolean;
    shapes: number;
  } | null;
  setModelTexture(texId: string | undefined): void;
  setModelTexTile(tile: number): void;
  /** Material adjustments for every selected built model (undefined = leave). */
  setModelLook(look: { hue?: number; sat?: number; light?: number }): void;
  /** How many built models the material controls act on (multi-select). */
  getModelCount(): number;
  setModelCollision(on: boolean): void;
  /** Re-open the selected model placement in the Build editing session. */
  editModel(): void;
  /** "Scale all copies" range: roll a random scale in [min, max] onto every
   *  placement of the selected asset (after an in-app confirm). */
  getCloneScaleRange(): { min: number; max: number };
  setCloneScaleRange(change: { min?: number; max?: number }): void;
  scaleAllSameAsset(): void;

  getFreeFly(): boolean;
  setFreeFly(on: boolean): void;
  getInvertPan(): boolean;
  setInvertPan(on: boolean): void;
  getShowPlayer(): boolean;
  setShowPlayer(on: boolean): void;
  getShowBoundaryWalls(): boolean;
  setShowBoundaryWalls(on: boolean): void;
  /** Wireframe render mode (map geometry as raw polygons, no textures). */
  getWireframe(): boolean;
  setWireframe(on: boolean): void;
  vertexModeOn(): boolean;
  setVertexMode(on: boolean): void;
  vertexSelectionCount(): number;
  vertexEditCount(): number;
  resetSelectedVertices(): void;
  clearVertexSelection(): void;
  clearAllVertexEdits(): void;
  /** Transparent map geometry for inspecting and selecting through surfaces. */
  getXray(): boolean;
  setXray(on: boolean): void;
  /** Scene Collection: the zone → group → placement tree, with residency and
   *  isolate state per zone. Row indexes are DOCUMENT indexes (the contract
   *  every scene action below is keyed on). */
  getSceneTree(): {
    zoneId: string;
    zoneName: string;
    count: number;
    resident: boolean;
    isolated: boolean;
    groups: {
      group: string;
      rows: { index: number; name: string; hidden: boolean; selected: boolean }[];
    }[];
  }[];
  /** Zone isolate: enter (zone id) or leave (null). Mirrors the topbar toggle. */
  isolateZone(zoneId: string | null): void;
  /** Camera-zone stream: keep the zone the CAMERA is over resident and swap it
   *  as the camera travels; the padlock holds one zone until released. Drives
   *  the same residency rect as zone isolate. */
  getCameraZoneStream(): {
    on: boolean;
    locked: boolean;
    zone: string | null;
    count: number;
    guide: boolean;
  };
  setCameraZoneStream(on: boolean): void;
  setCameraZoneLocked(locked: boolean): void;
  /** Draw light red walls where the resident zones end. */
  setStreamGuide(on: boolean): void;
  selectSceneObject(index: number): void;
  pinSceneObject(index: number): void;
  renameSceneObject(index: number, name: string): void;
  toggleSceneObjectHidden(index: number): void;
  getCollidersHidden(): boolean;
  setCollidersHidden(on: boolean): void;
  /** Hide the blue named-location area boxes (Zone tool toggle). */
  getLocationsHidden(): boolean;
  setLocationsHidden(on: boolean): void;
  /** Editor camera speed multipliers (Camera tab sliders); 1 = shipped feel. */
  getCameraSpeeds(): { move: number; look: number; pan: number };
  setCameraSpeeds(change: Partial<{ move: number; look: number; pan: number }>): void;
  getVisibilityProfile(): { distance: number; haze: number };
  setVisibilityProfile(change: Partial<{ distance: number; haze: number }>): void;
  /** Viewport performance overlay config (Camera tab). */
  getPerfOverlay(): {
    enabled: boolean;
    fps: boolean;
    frameMs: boolean;
    assets: boolean;
    tris: boolean;
    selTris: boolean;
    terrain: boolean;
    streaming: boolean;
    coords: boolean;
  };
  setPerfOverlay(
    change: Partial<{
      enabled: boolean;
      fps: boolean;
      frameMs: boolean;
      assets: boolean;
      tris: boolean;
      selTris: boolean;
      terrain: boolean;
      streaming: boolean;
      coords: boolean;
    }>,
  ): void;
  focusSelection(): void;

  getLighting(): { preset: string; profile: EditorLightingProfile };
  setLightingPreset(key: string): void;
  updateLighting(change: Partial<EditorLightingProfile>): void;
  getZoneAtmosphere(): {
    zones: { id: string; label: string }[];
    selectedId: string;
    preset: string;
    profile: EditorLightingProfile;
    skybox: string | null;
    timeScale: number;
    /** The selected zone's own weather, resolved with the same defaults as the
     *  map-wide one (mode auto, intensity 1, no clouds, no schedule). */
    weather: ResolvedWeather;
  } | null;
  selectAtmosphereZone(id: string): void;
  setZoneLightingPreset(key: string): void;
  updateZoneLighting(change: Partial<EditorLightingProfile>): void;
  setZoneSkybox(value: string | null): void;
  setZoneWeather(w: ResolvedWeather): void;
  setZoneWorldSpeed(value: number): void;
  resetZoneAtmosphere(): void;
  /** Map weather, resolved with defaults (mode auto, intensity 1, no clouds). */
  getWeather(): ResolvedWeather;
  setWeather(w: ResolvedWeather): void;

  /** Authored soundtrack: map-wide track, area rects, next-area pick. */
  getMusic(): {
    zoneTrack: string | null;
    areas: readonly { minX: number; minZ: number; maxX: number; maxZ: number; track: string }[];
    areaTrack: string;
  };
  setZoneTrack(track: string | null): void;
  setAreaTrack(track: string): void;
  updateMusicArea(index: number, track: string): void;
  deleteMusicArea(index: number): void;
  /** Selected music area (in-world rect click or panel row click), or null. */
  getSelectedMusicArea(): number | null;
  setSelectedMusicArea(index: number | null): void;
  getBirds(): { enabled: boolean; count: number; formation: boolean };
  setBirds(change: Partial<{ enabled: boolean; count: number; formation: boolean }>): void;
  /** Ambience animation speed (cosmetic world motion); 1 = normal. */
  getWorldSpeed(): number;
  setWorldSpeed(v: number): void;
  /** Placed-asset view distance in yards (how far decor renders before it culls). */
  getAssetViewDistance(): number;
  setAssetViewDistance(v: number): void;
  /** Active skybox: 'builtin:<id>' | 'custom:<sha>' | null (procedural sky). */
  getSkybox(): string | null;
  setSkybox(v: string | null): void;
  importSkybox(): void;

  getMarkerSelection(): MarkerSelection | null;
  updateMarker(axis: 'x' | 'z', v: number): void;
  resetMarker(): void;

  getScatterCount(): number;
  setScatterCount(v: number): void;
  runScatter(): void;
  runHills(): void;

  layers(): { kind: string; label: string; visible: boolean }[];
  toggleLayer(kind: string, on: boolean): void;
  frameAll(): void;
  zones(): { id: string; name: string }[];
  frameZone(id: string): void;
}

export const BIOME_OPTIONS: { id: number; labelKey: string; swatch: string }[] = [
  { id: 0, labelKey: 'editor.biome.vale', swatch: '#5aa850' },
  { id: 1, labelKey: 'editor.biome.marsh', swatch: '#786037' },
  { id: 2, labelKey: 'editor.biome.peaks', swatch: '#969ba5' },
  { id: 3, labelKey: 'editor.biome.beach', swatch: '#d8c27a' },
  { id: 4, labelKey: 'editor.biome.desert', swatch: '#cf9040' },
  { id: 5, labelKey: 'editor.biome.volcano', swatch: '#b04030' },
  { id: 6, labelKey: 'editor.biome.cave', swatch: '#4a4a55' },
  { id: 255, labelKey: 'editor.biome.erase', swatch: 'transparent' },
];

// Texture-picker thumbnails: the REAL ground texture each biome paints with
// (the splat shader's dominant layer), tinted toward the biome palette so the
// row previews what actually lands on the ground.
/** One paintable choice in the texture gallery: a biome, a saved swatch, a
 *  built-in library set (`builtinKey`), or the erase mode (id 255). */
interface TextureOption {
  id: number;
  label: string;
  thumb: { file?: string; url?: string; tint?: string; erase?: boolean };
  builtinKey?: string;
  group?: string;
}

const BIOME_THUMBS: Record<number, { file: string; tint?: string }> = {
  0: { file: 'Grass001_Color.jpg', tint: 'rgba(90, 168, 80, 0.35)' },
  1: { file: 'Ground071_Color.jpg', tint: 'rgba(120, 96, 55, 0.3)' },
  2: { file: 'Rock051_Color.jpg', tint: 'rgba(150, 155, 165, 0.25)' },
  3: { file: 'Ground080_Color.jpg', tint: 'rgba(216, 194, 122, 0.3)' },
  4: { file: 'Ground080_Color.jpg', tint: 'rgba(207, 144, 64, 0.45)' },
  5: { file: 'Rock051_Color.jpg', tint: 'rgba(176, 64, 48, 0.45)' },
  6: { file: 'Rock051_Color.jpg', tint: 'rgba(74, 74, 85, 0.5)' },
};

function hexWithAlpha(hex: string, alpha: number): string {
  const v = Number.parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function num1(v: number): string {
  return formatNumber(v, { useGrouping: false, maximumFractionDigits: 1 });
}

function num0(v: number): string {
  return formatNumber(Math.round(v), { useGrouping: false, maximumFractionDigits: 0 });
}

/** Bark texture choices: the real texture sets only (no 'legacy:' looks, which
 *  are rock-specific), wood and roots first since those are what a trunk wants. */
function barkTexOptions(): { value: string; label: string; file?: string }[] {
  const woody = (k: string): boolean => /^(Wood|Roots|Bark)/.test(k);
  const opts = TERRAIN_TEXTURE_SETS.map((set) => ({
    value: set.key,
    label: set.name,
    file: `${set.key}_Color.jpg`,
  }));
  return [...opts.filter((o) => woody(o.value)), ...opts.filter((o) => !woody(o.value))];
}

/** Replace one field of one canopy sphere, returning a fresh list (the panel
 *  never mutates the placement's own array). */
function withVolume(
  volumes: readonly TreeVolume[],
  index: number,
  key: 'x' | 'y' | 'z' | 'r' | 'sy',
  value: number,
): TreeVolume[] {
  return volumes.map((v, i) => (i === index ? { ...v, [key]: value } : { ...v }));
}

/** Stat-modifier readout: the raw multiplier first (so the slider's default
 *  parse still reads a typed number back), then the bonus/penalty in percent. */
function mobStatModLabel(v: number): string {
  const mult = formatNumber(v, {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (Math.abs(v - 1) < 0.0001) return t('editor.mobTool.statDefault', { value: mult });
  const percent = formatNumber(Math.round(Math.abs(v - 1) * 100), {
    useGrouping: false,
    maximumFractionDigits: 0,
  });
  return v > 1
    ? t('editor.mobTool.statBonus', { value: mult, percent })
    : t('editor.mobTool.statPenalty', { value: mult, percent });
}

function section(title: string): HTMLElement {
  const s = el('section', 'ed-section');
  s.appendChild(el('h2', 'ed-section-title', title));
  return s;
}

/** Free texture slots at or below which the tally turns amber. */
const TEXTURE_SLOTS_LOW = 3;

function hint(text: string): HTMLElement {
  return el('p', 'ed-hint', text);
}

interface CatalogPickerRow {
  id: string;
  title: string;
  meta: string;
  group: string;
  keywords: string[];
  badges?: string[];
}

function authorTextField(
  labelText: string,
  value: string,
  onChange: (value: string) => void,
  options: { multiline?: boolean; placeholder?: string; maxLength?: number } = {},
): HTMLElement {
  const wrap = el('label', 'ed-author-field');
  wrap.appendChild(el('span', 'ed-author-field-label', labelText));
  const input = options.multiline
    ? document.createElement('textarea')
    : document.createElement('input');
  if (input instanceof HTMLInputElement) input.type = 'text';
  input.value = value;
  input.placeholder = options.placeholder ?? '';
  input.maxLength = options.maxLength ?? MAX_AUTHORING_NOTES_LENGTH;
  input.addEventListener('change', () => onChange(input.value.trim()));
  wrap.appendChild(input);
  return wrap;
}

function catalogPicker(options: {
  label: string;
  title?: string;
  currentId: string;
  currentLabel: string;
  rows: readonly CatalogPickerRow[];
  onPick: (id: string) => void;
}): HTMLElement {
  const picker = el('div', 'ed-catalog-picker');
  const summary = el('div', 'ed-catalog-summary');
  summary.append(
    el('span', 'ed-catalog-summary-label', options.label),
    el('strong', undefined, options.currentLabel),
  );
  const browse = button(
    t('editor.authoring.browseAll'),
    () => {
      const modal = buildModal(document.body, options.title ?? options.label, () => {});
      modal.panel.classList.add('ed-catalog-modal');
      const tools = el('div', 'ed-catalog-tools');
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = t('editor.authoring.search');
      search.setAttribute('aria-label', t('editor.authoring.searchLabel'));
      const group = document.createElement('select');
      group.setAttribute('aria-label', t('editor.authoring.filterLabel'));
      const all = document.createElement('option');
      all.value = '';
      all.textContent = t('editor.authoring.allGroups');
      group.appendChild(all);
      for (const name of [...new Set(options.rows.map((row) => row.group))].sort()) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        group.appendChild(option);
      }
      tools.append(search, group);
      const list = el('div', 'ed-catalog-list');
      const status = el('p', 'ed-catalog-status');
      const render = (): void => {
        const matching = options.rows.filter(
          (row) =>
            (!group.value || row.group === group.value) &&
            catalogMatches(search.value, row.title, row.meta, row.group, ...row.keywords),
        );
        const shown = matching.slice(0, 200);
        list.innerHTML = '';
        for (const row of shown) {
          const pick = document.createElement('button');
          pick.type = 'button';
          pick.className = `ed-catalog-card${row.id === options.currentId ? ' active' : ''}`;
          const copy = el('span', 'ed-catalog-copy');
          copy.append(el('strong', undefined, row.title), el('small', undefined, row.meta));
          pick.appendChild(copy);
          if (row.badges?.length) {
            const badges = el('span', 'ed-catalog-badges');
            for (const badge of row.badges.slice(0, 3))
              badges.appendChild(el('i', undefined, badge));
            pick.appendChild(badges);
          }
          pick.addEventListener('click', () => {
            options.onPick(row.id);
            modal.close();
          });
          list.appendChild(pick);
        }
        status.textContent =
          matching.length === 0
            ? t('editor.authoring.noResults')
            : matching.length > shown.length
              ? t('editor.authoring.showing', { shown: shown.length, total: matching.length })
              : t('editor.authoring.resultCount', { count: matching.length });
      };
      search.addEventListener('input', render);
      group.addEventListener('change', render);
      render();
      modal.panel.append(tools, list, status);
      search.focus();
    },
    'small',
  );
  browse.classList.add('ed-catalog-browse');
  picker.append(summary, browse);
  return picker;
}

export class Inspector {
  readonly root: HTMLElement;
  /** Which inspector tab is showing (3D only; Lighting lives on its own tab). */
  private panelTab: 'tool' | 'camera' | 'lighting' | 'scene' = 'tool';
  private buildingSettingsOpen = false;
  // Scene tree expand/collapse state, per session (zone ids / zoneId+group).
  private readonly sceneOpenZones = new Set<string>();
  private readonly sceneOpenGroups = new Set<string>();

  constructor(
    parent: HTMLElement,
    private readonly deps: InspectorDeps,
  ) {
    this.root = el('aside', 'ed-inspector');
    this.root.setAttribute('aria-label', t('editor.inspector.label'));
    parent.appendChild(this.root);
    this.refresh();
  }

  /** Picking any tool jumps the panel back to the Tool tab, so the new tool's
   *  options are visible even if Camera/Lighting was open. */
  showToolTab(): void {
    this.panelTab = 'tool';
  }

  refresh(): void {
    const focusKey = captureFocusKey(this.root);
    const settings = this.root.querySelector<HTMLDetailsElement>('.ed-building-settings');
    if (settings) this.buildingSettingsOpen = settings.open;
    this.root.innerHTML = '';
    try {
      this.buildPanels();
      const rebuilt = this.root.querySelector<HTMLDetailsElement>('.ed-building-settings');
      if (rebuilt) rebuilt.open = this.buildingSettingsOpen;
      if (focusKey !== null)
        restoreFirstEnabled([
          findFocusKey(this.root, focusKey),
          this.root.querySelector<HTMLButtonElement>('.ed-building-modes [aria-pressed="true"]'),
          findFocusKey(this.root, 'building:action:newBuilding'),
        ]);
    } catch (err) {
      // FAIL LOUD. Every panel builder appends its `section()` to the root on
      // its LAST line, so a throw anywhere inside one takes the whole panel
      // with it and the tool's controls simply vanish -- the maker sees Brush
      // size and nothing else, with only the console to say why. That is
      // exactly how one stale generated i18n key ate the entire Paint panel
      // (SPACEY, 2026-09-22). A visible strip beats a silent hole.
      console.error('[inspector] panel build failed', err);
      this.panelErrorStrip(err);
    }
  }

  /** The error strip deliberately uses literal English, not `t()`: a broken
   *  translation table is the likeliest reason we are in here at all, and a
   *  strip that throws while reporting a throw reports nothing. */
  private panelErrorStrip(err: unknown): void {
    const s = el('section', 'ed-section');
    s.appendChild(el('h2', 'ed-section-title', 'Panel error'));
    s.appendChild(
      el(
        'p',
        'ed-hint',
        'This tool\u2019s options could not be built, so they are missing below. ' +
          'The rest of the editor still works. Please report this message:',
      ),
    );
    const detail = el('p', 'ed-hint ed-panel-error', String((err as Error)?.message ?? err));
    s.appendChild(detail);
    this.root.appendChild(s);
  }

  private buildPanels(): void {
    const d = this.deps;
    const tool = d.getTool();
    // Drives the per-tool hue (--tool-hue) shared with the tool rail, so the
    // panel header chip and slider accents match the active tool's color.
    this.root.dataset.tool = tool;

    const is3d = d.getViewMode() === '3d';
    // Collision Master session: a focused panel set (the CM controls + the
    // normal Selection panel, whose collision block does the actual editing).
    const cm = d.getCollisionMaster();
    if (cm) {
      this.collisionMasterPanel(cm);
      this.modelingSculptPanel();
      if (tool === 'move' || tool === 'rotate' || tool === 'scale') this.transformPanel(tool);
      this.selectPanel();
      this.navHint();
      return;
    }
    // Build session: the modeling panel (texture + collision + Done) replaces
    // the tool panels, alongside the transform gizmo controls.
    const build = d.getBuildSession();
    if (build) {
      this.buildPanel();
      this.modelingSculptPanel();
      if (tool === 'move' || tool === 'rotate' || tool === 'scale') this.transformPanel(tool);
      this.navHint();
      return;
    }
    if (is3d) this.panelTabs();
    if (is3d && this.panelTab === 'lighting') {
      this.lightingPanel();
      return;
    }
    if (is3d && this.panelTab === 'camera') {
      this.cameraPanel();
      return;
    }
    if (is3d && this.panelTab === 'scene') {
      this.sceneCollectionPanel();
      return;
    }

    const transforms = d.buildTransformControls?.();
    if (transforms) this.root.appendChild(transforms);
    const buildingWorkspace = d.buildingWorkspace?.();
    if (buildingWorkspace) this.root.appendChild(buildBuildModePanel(buildingWorkspace));
    if (tool === 'building') return;

    switch (tool) {
      case 'select':
        // A bulb-badge click selects a map light (or a sound badge a point
        // sound): edit it right here without hopping to that tool.
        if (d.getSelectedLight() !== null) this.lightPanel();
        else if (d.getSelectedSound() !== null) this.soundPanel();
        else this.selectPanel();
        break;
      case 'move':
      case 'rotate':
      case 'scale':
        this.transformPanel(tool);
        this.selectPanel();
        break;
      case 'raise':
      case 'lower':
        this.brushPanel(true, true);
        this.sculptBrushShapePanel();
        this.sculptPanel();
        break;
      case 'smooth':
        this.brushPanel(true, true);
        this.sculptBrushShapePanel();
        break;
      case 'flatten':
        this.brushPanel(this.deps.getFlattenSmooth(), true);
        this.sculptBrushShapePanel();
        this.flattenPanel();
        break;
      case 'tunnel':
        this.brushPanel(false, true);
        this.tunnelPanel();
        break;
      case 'rock':
        this.rockPanel();
        break;
      case 'tree':
        this.treePanel();
        break;
      case 'paint':
        this.brushPanel(false);
        this.biomePanel();
        break;
      case 'water':
        this.waterPanel();
        break;
      case 'fluid':
        this.fluidToolPanel();
        break;
      case 'place':
        this.placePanel();
        this.procgenPanel();
        break;
      case 'foliage':
        this.brushPanel(false);
        this.foliagePanel();
        break;
      case 'clutter':
        this.brushPanel(false);
        this.clutterPanel();
        break;
      case 'meshfix':
        this.brushPanel(false);
        this.meshFixPanel();
        break;
      case 'grassclear':
        this.brushPanel(false);
        this.grassClearPanel();
        break;
      case 'blocker':
        this.blockerPanel();
        break;
      case 'collider':
        this.colliderPanel();
        this.selectPanel();
        break;
      case 'camp':
        this.campPanel();
        break;
      case 'entity':
        this.entityPanel();
        break;
      case 'spawn':
        this.spawnPanel();
        this.markerPanel();
        break;
      case 'zone':
        this.zonePanel();
        break;
      case 'light':
        this.lightPanel();
        break;
      case 'music':
        this.musicPanel();
        break;
      case 'sound':
        this.soundPanel();
        break;
      case 'decal':
        this.decalPanel();
        break;
      case 'region':
        this.regionPanel();
        break;
      case 'erase':
        this.brushPanel(false, true);
        this.erasePanel();
        break;
      case 'city':
        this.root.appendChild(buildCityBuildPanel(d.cityBuild(), () => this.refresh()));
        break;
    }

    if (!is3d) this.layersPanel();
    this.navHint();
  }

  private panelTabs(): void {
    const bar = el('div', 'ed-inspector-tabs');
    bar.setAttribute('role', 'tablist');
    for (const tab of ['tool', 'camera', 'lighting', 'scene'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-inspector-tab';
      b.setAttribute('role', 'tab');
      const active = this.panelTab === tab;
      b.setAttribute('aria-selected', active ? 'true' : 'false');
      b.classList.toggle('active', active);
      b.textContent = t(
        tab === 'tool'
          ? 'editor.inspector.toolTab'
          : tab === 'camera'
            ? 'editor.inspector.cameraTab'
            : tab === 'lighting'
              ? 'editor.inspector.lightingTab'
              : 'editor.inspector.sceneTab',
      );
      b.addEventListener('click', () => {
        this.panelTab = tab;
        this.refresh();
      });
      bar.appendChild(b);
    }
    this.root.appendChild(bar);
  }

  // ---- panels -----------------------------------------------------------------

  /** `withWater`: the height tools also get "Re-apply water", the manual full
   *  rebuild beside the automatic per-stroke water refresh. */
  private brushPanel(withStrength: boolean, withWater = false): void {
    const d = this.deps;
    const s = section(t('editor.brush.title'));
    // Brush size on a LOG scale: fine sub-yard steps at the small end
    // (0.4yd, 10x smaller than the old minimum) through region-sized 300yd
    // sweeps at the top, all on one comfortable track.
    const SIZE_MIN = 0.4;
    const SIZE_MAX = 300;
    const SIZE_LOG_SPAN = Math.log(SIZE_MAX / SIZE_MIN);
    const sizeFromT = (tv: number): number =>
      Math.round(SIZE_MIN * Math.exp((tv / 100) * SIZE_LOG_SPAN) * 10) / 10;
    const tFromSize = (r: number): number =>
      (Math.log(Math.min(SIZE_MAX, Math.max(SIZE_MIN, r)) / SIZE_MIN) / SIZE_LOG_SPAN) * 100;
    s.appendChild(
      slider(t('editor.brush.size'), {
        min: 0,
        max: 100,
        step: 0.5,
        value: tFromSize(d.getBrushRadius()),
        onInput: (v) => d.setBrushRadius(sizeFromT(v)),
        format: (v) => num1(sizeFromT(v)),
        // The readout is in yards; typing a yard value maps back to the log t.
        parse: (text) => {
          const yd = Number.parseFloat(text);
          return Number.isFinite(yd) ? tFromSize(yd) : null;
        },
      }).root,
    );
    if (withStrength) {
      s.appendChild(
        slider(t('editor.brush.strength'), {
          // 1..50 on a 5x finer scale than the legacy 1..30 (5 == legacy 1):
          // gentle grading at the low end, same ceiling (50 == legacy 10).
          min: 1,
          max: 50,
          step: 1,
          value: d.getBrushStrength(),
          onInput: (v) => d.setBrushStrength(v),
          format: num1,
        }).root,
      );
    }
    s.appendChild(hint(t('editor.brush.sizeHint')));
    const stats = d.getTerrainEditStats();
    s.appendChild(
      hint(
        t('editor.brush.editCount', {
          count: formatNumber(stats.count, { useGrouping: false }),
          max: formatNumber(stats.max, { useGrouping: false }),
        }),
      ),
    );
    if (withWater) {
      s.appendChild(
        button(
          t('editor.brush.reapplyWater'),
          () => d.reapplyWater(),
          'small',
          t('editor.brush.reapplyWaterTitle'),
        ),
      );
    }
    this.root.appendChild(s);
  }

  /** Small labelled text input for list renames. */
  private nameInput(value: string, onCommit: (v: string) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.maxLength = 40;
    input.addEventListener('change', () => onCommit(input.value));
    return input;
  }

  private zonePanel(): void {
    const d = this.deps;
    const s = section(t('editor.zoneTool.title'));
    s.appendChild(hint(t('editor.zoneTool.hint')));
    s.appendChild(
      checkbox(t('editor.zoneTool.hideBoxes'), d.getLocationsHidden(), (on) =>
        d.setLocationsHidden(on),
      ).root,
    );
    const locs = d.getLocations();
    if (locs.length === 0) s.appendChild(el('p', 'ed-muted', t('editor.zoneTool.none')));
    locs.forEach((loc, i) => {
      const row = el('div', 'ed-row');
      row.appendChild(this.nameInput(loc.name, (v) => d.renameLocation(i, v)));
      row.appendChild(
        button(
          'x',
          () => {
            d.deleteLocation(i);
            this.refresh();
          },
          'danger small',
          t('editor.zoneTool.deleteTitle'),
        ),
      );
      s.appendChild(row);
    });
    this.root.appendChild(s);
  }

  private lightPanel(): void {
    const d = this.deps;
    const s = section(t('editor.lightTool.title'));
    s.appendChild(hint(t('editor.lightTool.hint', { max: 24 })));
    const lights = d.getMapLights();
    const selected = d.getSelectedLight();
    if (lights.length === 0) s.appendChild(el('p', 'ed-muted', t('editor.lightTool.none')));
    lights.forEach((l, i) => {
      const card = el('div', 'ed-light-card');
      card.classList.toggle('active', i === selected);
      const row = el('div', 'ed-row');
      const name = button(
        t('editor.lightTool.lightN', { num: formatNumber(i + 1, { useGrouping: false }) }),
        () => {
          d.setSelectedLight(i === selected ? null : i);
        },
        'small',
        t('editor.lightTool.selectTitle'),
      );
      name.classList.toggle('active', i === selected);
      row.appendChild(name);
      row.appendChild(
        this.colorInput(t('editor.lightTool.color'), l.color, (hex) =>
          d.updateMapLight(i, { color: hex }),
        ),
      );
      row.appendChild(
        button(
          'x',
          () => {
            d.deleteMapLight(i);
            this.refresh();
          },
          'danger small',
          t('editor.lightTool.deleteTitle'),
        ),
      );
      card.appendChild(row);
      card.appendChild(
        slider(t('editor.lightTool.intensity'), {
          min: 0.2,
          max: 30,
          step: 0.2,
          value: l.intensity,
          onInput: (v) => d.updateMapLight(i, { intensity: v }),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.lightTool.range'), {
          min: 4,
          max: 120,
          step: 1,
          value: l.range,
          onInput: (v) => d.updateMapLight(i, { range: v }),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.lightTool.height'), {
          min: 0,
          max: 20,
          step: 0.5,
          value: l.y,
          onInput: (v) => d.updateMapLight(i, { y: v }),
          format: num1,
        }).root,
      );
      s.appendChild(card);
    });
    this.root.appendChild(s);
  }

  /** A dropdown of the loopable SFX clips a point sound can play on repeat. */
  private soundClipSelect(value: string, onChange: (id: string) => void): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', t('editor.soundTool.clip'));
    for (const id of POINT_SOUND_CLIPS) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = pointSoundLabel(id);
      opt.selected = value === id;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  private soundPanel(): void {
    const d = this.deps;
    const s = section(t('editor.soundTool.title'));
    s.appendChild(hint(t('editor.soundTool.hint')));
    const sounds = d.getMapSounds();
    const selected = d.getSelectedSound();
    if (sounds.length === 0) s.appendChild(el('p', 'ed-muted', t('editor.soundTool.none')));
    sounds.forEach((snd, i) => {
      const card = el('div', 'ed-light-card');
      card.classList.toggle('active', i === selected);
      const row = el('div', 'ed-row');
      const name = button(
        t('editor.soundTool.soundN', { num: formatNumber(i + 1, { useGrouping: false }) }),
        () => d.setSelectedSound(i === selected ? null : i),
        'small',
        t('editor.soundTool.selectTitle'),
      );
      name.classList.toggle('active', i === selected);
      row.appendChild(name);
      row.appendChild(
        button(
          'x',
          () => {
            d.deleteMapSound(i);
            this.refresh();
          },
          'danger small',
          t('editor.soundTool.deleteTitle'),
        ),
      );
      card.appendChild(row);
      const clipRow = el('label', 'ed-field');
      clipRow.appendChild(el('span', undefined, t('editor.soundTool.clip')));
      clipRow.appendChild(
        this.soundClipSelect(snd.sound, (id) => d.updateMapSound(i, { sound: id })),
      );
      card.appendChild(clipRow);
      card.appendChild(
        slider(t('editor.soundTool.volume'), {
          min: 0,
          max: 1,
          step: 0.05,
          value: snd.volume,
          onInput: (v) => d.updateMapSound(i, { volume: v }),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.soundTool.radius'), {
          min: 2,
          max: 200,
          step: 1,
          value: snd.radius,
          onInput: (v) => d.updateMapSound(i, { radius: v }),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.soundTool.height'), {
          min: 0,
          max: 40,
          step: 0.5,
          value: snd.y,
          onInput: (v) => d.updateMapSound(i, { y: v }),
          format: num1,
        }).root,
      );
      s.appendChild(card);
    });
    this.root.appendChild(s);
  }

  /**
   * Decal tool: the art library, the settings the NEXT stamp uses, and, when
   * a placed stamp is selected, that stamp's own settings.
   */
  private decalPanel(): void {
    const d = this.deps;
    const brush = d.getDecalBrush();
    const s = section(t('editor.decalTool.title'));
    s.appendChild(hint(t('editor.decalTool.hint')));

    // ---- library ------------------------------------------------------------
    const catLabel: Record<string, string> = {
      arcane: t('editor.decalTool.catArcane'),
      burn: t('editor.decalTool.catBurn'),
      damage: t('editor.decalTool.catDamage'),
      gore: t('editor.decalTool.catGore'),
      nature: t('editor.decalTool.catNature'),
      tracks: t('editor.decalTool.catTracks'),
      marker: t('editor.decalTool.catMarker'),
      imported: t('editor.decalTool.imported'),
    };
    const entries = listDecals();
    const groups: { key: string; items: DecalLibraryEntry[] }[] = [];
    for (const key of [...DECAL_CATEGORY_ORDER, 'imported']) {
      const items = entries.filter((e) => e.category === key);
      if (items.length > 0) groups.push({ key, items });
    }
    for (const group of groups) {
      s.appendChild(el('span', 'ed-label', catLabel[group.key] ?? group.key));
      const row = el('div', 'ed-alpha-row');
      row.setAttribute('role', 'radiogroup');
      row.setAttribute('aria-label', catLabel[group.key] ?? group.key);
      for (const entry of group.items) {
        const cell = el('div', 'ed-alpha-cell');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ed-alpha ed-decal-cell';
        const active = entry.tex === brush.tex;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', active ? 'true' : 'false');
        b.classList.toggle('active', active);
        b.title = entry.name;
        b.setAttribute('aria-label', entry.name);
        const url = decalThumbUrl(entry.tex);
        if (url) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = '';
          img.loading = 'lazy';
          b.appendChild(img);
        } else b.appendChild(el('span', 'ed-alpha-none', entry.name.slice(0, 8)));
        b.addEventListener('click', () => {
          d.pickDecalArt(entry.tex);
          this.refresh();
        });
        cell.appendChild(b);
        cell.appendChild(el('span', 'ed-decal-name', entry.name));
        row.appendChild(cell);
      }
      s.appendChild(row);
    }
    const importBtn = button(
      t('editor.decalTool.importDecal'),
      () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (file) d.importDecalFile(file);
        });
        input.click();
      },
      'small',
      t('editor.decalTool.importTitle'),
    );
    s.appendChild(importBtn);

    // ---- what the next click stamps ----------------------------------------
    s.appendChild(
      slider(t('editor.decalTool.size'), {
        min: MIN_DECAL_SIZE,
        max: 60,
        step: 0.5,
        value: brush.size,
        onInput: (v) => d.setDecalBrush({ size: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      checkbox(t('editor.decalTool.randomRotate'), brush.randomRotate, (on) => {
        d.setDecalBrush({ randomRotate: on });
        this.refresh();
      }).root,
    );
    if (!brush.randomRotate) {
      s.appendChild(
        slider(t('editor.decalTool.rotation'), {
          min: 0,
          max: 360,
          step: 5,
          value: (brush.rot * 180) / Math.PI,
          onInput: (v) => d.setDecalBrush({ rot: (v * Math.PI) / 180 }),
          format: num1,
        }).root,
      );
    }
    s.appendChild(
      slider(t('editor.decalTool.opacity'), {
        min: 0.05,
        max: 1,
        step: 0.05,
        value: brush.opacity,
        onInput: (v) => d.setDecalBrush({ opacity: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.decalTool.glow'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: brush.glow,
        onInput: (v) => d.setDecalBrush({ glow: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      this.colorInput(t('editor.decalTool.tint'), brush.color, (hex) =>
        d.setDecalBrush({ color: hex }),
      ),
    );

    // ---- placed stamps -------------------------------------------------------
    const decals = d.getMapDecals();
    const selected = d.getSelectedDecal();
    if (decals.length === 0) s.appendChild(el('p', 'ed-muted', t('editor.decalTool.none')));
    decals.forEach((decal, i) => {
      // Only the selected stamp expands: a map with hundreds of decals must not
      // build hundreds of slider cards every refresh.
      const card = el('div', 'ed-light-card');
      card.classList.toggle('active', i === selected);
      const row = el('div', 'ed-row');
      const name = button(
        `${formatNumber(i + 1, { useGrouping: false })}. ${decalName(decal.tex)}`,
        () => d.setSelectedDecal(i === selected ? null : i),
        'small',
        t('editor.decalTool.selectTitle'),
      );
      name.classList.toggle('active', i === selected);
      row.appendChild(name);
      row.appendChild(
        button(
          'x',
          () => {
            d.deleteMapDecal(i);
            this.refresh();
          },
          'danger small',
          t('editor.decalTool.deleteTitle'),
        ),
      );
      card.appendChild(row);
      if (i === selected) {
        card.appendChild(
          slider(t('editor.decalTool.size'), {
            min: MIN_DECAL_SIZE,
            max: MAX_DECAL_SIZE,
            step: 0.5,
            value: decal.size,
            onInput: (v) => d.updateMapDecal(i, { size: v }),
            format: num1,
          }).root,
        );
        card.appendChild(
          slider(t('editor.decalTool.rotation'), {
            min: 0,
            max: 360,
            step: 1,
            value: (decal.rot * 180) / Math.PI,
            onInput: (v) => d.updateMapDecal(i, { rot: (v * Math.PI) / 180 }),
            format: num1,
          }).root,
        );
        card.appendChild(
          slider(t('editor.decalTool.aspect'), {
            min: 0.25,
            max: 4,
            step: 0.05,
            value: decal.aspect ?? 1,
            onInput: (v) => d.updateMapDecal(i, { aspect: v }),
            format: num1,
          }).root,
        );
        card.appendChild(
          slider(t('editor.decalTool.opacity'), {
            min: 0.05,
            max: 1,
            step: 0.05,
            value: decal.opacity ?? 1,
            onInput: (v) => d.updateMapDecal(i, { opacity: v }),
            format: num1,
          }).root,
        );
        card.appendChild(
          slider(t('editor.decalTool.glow'), {
            min: 0,
            max: 1,
            step: 0.05,
            value: decal.glow ?? 0,
            onInput: (v) => d.updateMapDecal(i, { glow: v }),
            format: num1,
          }).root,
        );
        card.appendChild(
          slider(t('editor.decalTool.sortOrder'), {
            min: -8,
            max: 8,
            step: 1,
            value: decal.sort ?? 0,
            onInput: (v) => d.updateMapDecal(i, { sort: v }),
            format: num1,
          }).root,
        );
        card.appendChild(
          this.colorInput(t('editor.decalTool.tint'), decal.color ?? 0xffffff, (hex) =>
            d.updateMapDecal(i, { color: hex }),
          ),
        );
      }
      s.appendChild(card);
    });
    this.root.appendChild(s);
  }

  /** A track select listing every shipped theme (plus a "biome default"). */
  private trackSelect(
    value: string | null,
    withDefault: boolean,
    ariaKey: 'editor.music.zoneTrack' | 'editor.music.areaTrack' | 'editor.music.rowTrack',
    onChange: (track: string | null) => void,
  ): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', t(ariaKey));
    if (withDefault) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t('editor.music.default');
      opt.selected = value === null;
      sel.appendChild(opt);
    }
    for (const id of MUSIC_ZONES) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = t(`editor.music.track.${id}` as Parameters<typeof t>[0]);
      opt.selected = value === id;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value === '' ? null : sel.value));
    return sel;
  }

  private musicPanel(): void {
    const d = this.deps;
    const s = section(t('editor.music.title'));
    s.appendChild(hint(t('editor.music.hint')));
    const m = d.getMusic();
    // Map-wide track.
    const zoneRow = el('label', 'ed-field');
    zoneRow.appendChild(el('span', undefined, t('editor.music.zoneTrack')));
    zoneRow.appendChild(
      this.trackSelect(m.zoneTrack, true, 'editor.music.zoneTrack', (track) => {
        d.setZoneTrack(track);
        this.refresh();
      }),
    );
    s.appendChild(zoneRow);
    // The track the NEXT dragged box gets.
    s.appendChild(el('h3', 'ed-subtitle', t('editor.music.areasTitle')));
    const areaRow = el('label', 'ed-field');
    areaRow.appendChild(el('span', undefined, t('editor.music.areaTrack')));
    areaRow.appendChild(
      this.trackSelect(m.areaTrack, false, 'editor.music.areaTrack', (track) => {
        if (track) d.setAreaTrack(track);
      }),
    );
    s.appendChild(areaRow);
    s.appendChild(hint(t('editor.music.dragHint')));
    if (m.areas.length === 0) {
      s.appendChild(el('p', 'ed-muted', t('editor.music.none')));
    }
    const selected = d.getSelectedMusicArea();
    m.areas.forEach((a, i) => {
      const row = el('div', 'ed-row ed-music-area');
      row.classList.toggle('active', i === selected);
      const name = button(
        t('editor.music.areaN', { num: formatNumber(i + 1, { useGrouping: false }) }),
        () => {
          d.setSelectedMusicArea(i === selected ? null : i);
        },
        'small',
        t('editor.music.selectArea'),
      );
      name.classList.toggle('active', i === selected);
      row.appendChild(name);
      row.appendChild(
        this.trackSelect(a.track, false, 'editor.music.rowTrack', (track) => {
          if (track) d.updateMusicArea(i, track);
        }),
      );
      row.appendChild(
        button(
          'x',
          () => {
            d.deleteMusicArea(i);
            this.refresh();
          },
          'danger small',
          t('editor.music.removeArea'),
        ),
      );
      s.appendChild(row);
    });
    this.root.appendChild(s);
  }

  private markerPanel(): void {
    const d = this.deps;
    const s = section(t('editor.markerTool.title'));
    s.appendChild(hint(t('editor.markerTool.hint')));
    const mode = d.getMarkerMode();
    s.appendChild(
      checkbox(t('editor.markerTool.place'), mode.placing, (on) => {
        d.setMarkerMode({ placing: on });
        this.refresh();
      }).root,
    );
    if (mode.placing) {
      const row = el('label', 'ed-field');
      row.appendChild(el('span', undefined, t('editor.markerTool.kind')));
      const sel = document.createElement('select');
      for (const kind of ['npc', 'object'] as const) {
        const o = document.createElement('option');
        o.value = kind;
        o.textContent = t(`editor.markerTool.${kind}` as Parameters<typeof t>[0]);
        if (mode.kind === kind) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () =>
        d.setMarkerMode({ kind: sel.value === 'object' ? 'object' : 'npc' }),
      );
      row.appendChild(sel);
      s.appendChild(row);
    }
    const markers = d.getMarkers();
    if (markers.length === 0) s.appendChild(el('p', 'ed-muted', t('editor.markerTool.none')));
    markers.forEach((m, i) => {
      const row = el('div', 'ed-row');
      row.appendChild(this.nameInput(m.name, (v) => d.renameMarker(i, v)));
      row.appendChild(
        button(
          'x',
          () => {
            d.deleteMarker(i);
            this.refresh();
          },
          'danger small',
          t('editor.markerTool.deleteTitle'),
        ),
      );
      s.appendChild(row);
    });
    this.root.appendChild(s);
  }

  /** Tunnel tool: dig/patch mode, authoring hint, and the cave list with
   *  per-cave width/height sliders, reverse (swap A<->B) and delete. */
  // ---- Tree Generator ----------------------------------------------------------
  //
  // ONE form drives both the tool (shaping the next tree) and a selected tree
  // (reshaping it live). The only difference is where the change goes, so the
  // caller passes an `onChange` and everything below is shared.

  private treePanel(): void {
    const d = this.deps;
    const state = d.getTreeParams();
    const s = section(t('editor.tree.title'));
    s.appendChild(hint(t('editor.tree.hint')));
    s.appendChild(
      selectRow(
        t('editor.tree.preset'),
        TREE_PRESETS.map((tp) => ({ value: tp.key, label: `${tp.biome}, ${tp.label}` })),
        state.preset,
        (v) => d.applyTreePreset(v),
      ).root,
    );
    s.appendChild(hint(t('editor.tree.presetHint')));
    s.appendChild(button(t('editor.tree.openStudio'), () => d.enterTreeStudio(), 'primary'));
    s.appendChild(hint(t('editor.tree.openStudioHint')));
    // Baking is what turns a plant from parameters into an asset. It is worth
    // its own button up here rather than buried in the form: it is the step
    // that makes a generated bush batchable and shareable.
    s.appendChild(button(t('editor.foliage.bake'), () => d.bakeFoliage(), 'small'));
    s.appendChild(hint(t('editor.foliage.bakeHint')));
    this.treeForm(s, state.params, (change) => {
      d.setTreeParams(change);
      this.refresh();
    });
    this.root.appendChild(s);
  }

  /** The Appearance-panel section shown when a generated tree is selected. */
  private treeControls(parent: HTMLElement, sel: PlacementSelection): void {
    const d = this.deps;
    const params = sel.tree ?? {};
    const inStudio = d.treeStudioActive();
    parent.appendChild(el('h4', 'ed-sub-title', t('editor.tree.title')));
    if (inStudio) {
      // The studio deliberately has no chrome of its own - the tree is meant to
      // be the only thing on screen - so the two ways out live at the top of
      // this panel rather than in a rail the maker has to go hunting for.
      const banner = el('div', 'ed-tree-studio-banner');
      banner.appendChild(el('strong', undefined, t('editor.tree.studioBanner')));
      banner.appendChild(el('span', undefined, t('editor.tree.studioHint')));
      parent.appendChild(banner);
      const exits = el('div', 'ed-row');
      exits.appendChild(
        button(t('editor.tree.studioKeep'), () => d.exitTreeStudio(true), 'primary'),
      );
      exits.appendChild(
        button(t('editor.tree.studioDiscard'), () => d.exitTreeStudio(false), 'small'),
      );
      parent.appendChild(exits);
    }
    const row = el('div', 'ed-row');
    row.appendChild(button(t('editor.tree.randomize'), () => d.rerollSelectedTree(), 'primary'));
    if (!inStudio) {
      // Inside the studio the whole tree IS the tool default in waiting, so a
      // separate "copy to tool" button would only confuse the exit buttons.
      row.appendChild(
        button(t('editor.tree.copyToTool'), () => d.treeParamsFromSelection(), 'small'),
      );
    }
    parent.appendChild(row);
    parent.appendChild(hint(t('editor.tree.randomizeHint')));
    this.treeForm(parent, params, (change, commit) =>
      d.updateSelectedTree(change, commit !== false),
    );
  }

  /**
   * Every knob the generator has, grouped the way a maker thinks about a tree:
   * trunk, branches, the canopy spheres, the leaves in them, then wind and
   * collision. Sliders read their bounds from TREE_LIMITS so the panel can
   * never author a value the map sanitizer would clamp away on the next load.
   */
  private treeForm(
    parent: HTMLElement,
    params: FoliageParams,
    onChange: (change: Partial<FoliageParams>, commit?: boolean) => void,
  ): void {
    const kind = foliageKindOf(params);
    const p = resolvedFoliageParams(params);
    const hasTrunk = foliageHasTrunk(kind);
    const hasCards = foliageHasLeafCards(kind);
    // ---- which plant this is. Everything below reads it: a bush has no
    // trunk chain to tune and grass has no leaf cards, so those groups are
    // hidden rather than shown inert.
    parent.appendChild(
      selectRow(
        t('editor.foliage.kind'),
        FOLIAGE_KINDS.map((k) => ({ value: k, label: t(`editor.foliage.kinds.${k}`) })),
        kind,
        (v) => onChange({ kind: v as FoliageKind }, true),
      ).root,
    );
    if (kind !== 'tree') {
      const presets = FOLIAGE_PRESETS.filter((fp) => fp.kind === kind);
      if (presets.length > 0) {
        parent.appendChild(
          selectRow(
            t('editor.foliage.preset'),
            presets.map((fp) => ({
              value: fp.key,
              label: t(`editor.foliage.presets.${fp.label}`),
            })),
            '',
            (v) => {
              const preset = foliagePreset(v);
              if (preset) onChange({ ...preset.params }, true);
            },
          ).root,
        );
      }
      const limits = foliageLimitsFor(kind);
      const kindNum = (
        key: FoliageNumericKey,
        labelKey: Parameters<typeof t>[0],
        format: (v: number) => string = num1,
      ): void => {
        const lim = limits[key];
        if (!lim) return;
        parent.appendChild(
          slider(t(labelKey), {
            min: lim.min,
            max: lim.max,
            step: lim.step,
            value: p[key] as number,
            onInput: (v) => onChange({ [key]: v } as Partial<FoliageParams>, false),
            onChange: (v) => onChange({ [key]: v } as Partial<FoliageParams>, true),
            format,
          }).root,
        );
      };
      kindNum('footprint', 'editor.foliage.footprint');
      kindNum('plantHeight', 'editor.foliage.plantHeight');
      kindNum('splay', 'editor.foliage.splay');
      kindNum('clumps', 'editor.foliage.clumps', num0);
      kindNum('strands', 'editor.foliage.strands', num0);
      kindNum('hang', 'editor.foliage.hang');
    }
    const num = (
      key: TreeNumericKey,
      labelKey: Parameters<typeof t>[0],
      format: (v: number) => string = num1,
    ): void => {
      const lim = TREE_LIMITS[key];
      parent.appendChild(
        slider(t(labelKey), {
          min: lim.min,
          max: lim.max,
          step: lim.step,
          value: p[key] as number,
          onInput: (v) => onChange({ [key]: v } as Partial<TreeParams>, false),
          onChange: (v) => onChange({ [key]: v } as Partial<TreeParams>, true),
          format,
        }).root,
      );
    };
    const sub = (labelKey: Parameters<typeof t>[0]): void => {
      parent.appendChild(el('h4', 'ed-sub-title', t(labelKey)));
    };

    // ---- trunk (trees only: nothing else grows from a foundation GLB)
    if (hasTrunk) {
      sub('editor.tree.trunkSection');
      parent.appendChild(
        selectRow(
          t('editor.tree.trunk'),
          TRUNKS.map((tr) => ({ value: tr.key, label: tr.label })),
          p.trunk,
          (v) => onChange({ trunk: v }, true),
        ).root,
      );
      num('girth', 'editor.tree.girth');
      num('height', 'editor.tree.heightScale');
      this.texSetPicker(parent, t('editor.tree.bark'), barkTexOptions(), p.barkTexId, (v) =>
        onChange({ barkTexId: v }, true),
      );
      num('barkTile', 'editor.tree.barkTile');

      // ---- branches
      sub('editor.tree.branchSection');
      num('branches', 'editor.tree.branches', num0);
      num('branchDepth', 'editor.tree.branchDepth', num0);
      num('branchLen', 'editor.tree.branchLen');
      num('branchAngle', 'editor.tree.branchAngle');
      num('branchDroop', 'editor.tree.branchDroop');
      num('branchTwist', 'editor.tree.branchTwist');
      num('branchTaper', 'editor.tree.branchTaper');
    }

    // ---- canopy volumes: the spheres the leaves are scattered into. Grass
    // has no cards to scatter, so it has no volumes either.
    if (hasCards) {
      sub('editor.tree.canopySection');
      parent.appendChild(hint(t('editor.tree.canopyHint')));
      parent.appendChild(
        checkbox(t('editor.tree.showVolumes'), this.deps.getTreeParams().showVolumes, (on) =>
          this.deps.setTreeVolumesShown(on),
        ).root,
      );
      const authored = (params.volumes?.length ?? 0) > 0;
      if (!authored) {
        parent.appendChild(
          selectRow(
            t('editor.tree.shape'),
            TREE_SHAPES.map((sh) => ({
              value: sh,
              label: t(`editor.tree.shapeName.${sh}` as Parameters<typeof t>[0]),
            })),
            p.shape,
            (v) => onChange({ shape: v as TreeCanopyShape }, true),
          ).root,
        );
        num('volumeCount', 'editor.tree.volumeCount', num0);
        num('volumeSpread', 'editor.tree.volumeSpread');
        num('volumeRise', 'editor.tree.volumeRise');
        num('volumeScale', 'editor.tree.volumeScale');
        num('volumeJitter', 'editor.tree.volumeJitter');
        parent.appendChild(
          button(
            t('editor.tree.editVolumes'),
            // Freeze the preset's layout into editable spheres. From here the
            // shape dropdown stops regenerating over the maker's own crown.
            () => onChange({ volumes: treeVolumesFor(params) }, true),
            'small',
          ),
        );
      } else {
        const volumes = params.volumes ?? [];
        volumes.forEach((v, i) => {
          const box = el('div', 'ed-tree-volume');
          box.appendChild(
            el('h4', 'ed-sub-title', t('editor.tree.volumeLabel', { n: String(i + 1) })),
          );
          const axis = (
            key: 'x' | 'y' | 'z' | 'r' | 'sy',
            labelKey: Parameters<typeof t>[0],
            min: number,
            max: number,
          ): void => {
            box.appendChild(
              slider(t(labelKey), {
                min,
                max,
                step: 0.1,
                value: v[key],
                onInput: (nv) => onChange({ volumes: withVolume(volumes, i, key, nv) }, false),
                onChange: (nv) => onChange({ volumes: withVolume(volumes, i, key, nv) }, true),
                format: num1,
              }).root,
            );
          };
          axis('x', 'editor.tree.volumeX', -30, 30);
          axis('y', 'editor.tree.volumeY', -5, 45);
          axis('z', 'editor.tree.volumeZ', -30, 30);
          axis('r', 'editor.tree.volumeR', 0.2, 20);
          axis('sy', 'editor.tree.volumeSy', 0.1, 3);
          box.appendChild(
            button(
              t('editor.tree.removeVolume'),
              () =>
                onChange(
                  { volumes: volumes.length > 1 ? volumes.filter((_, j) => j !== i) : volumes },
                  true,
                ),
              'small',
            ),
          );
          parent.appendChild(box);
        });
        const vrow = el('div', 'ed-row');
        if (volumes.length < MAX_TREE_VOLUMES) {
          vrow.appendChild(
            button(
              t('editor.tree.addVolume'),
              () => {
                const last = volumes[volumes.length - 1];
                onChange(
                  {
                    volumes: [
                      ...volumes,
                      { ...last, x: last.x + last.r, y: last.y + last.r * 0.4 },
                    ],
                  },
                  true,
                );
              },
              'small',
            ),
          );
        }
        vrow.appendChild(
          button(
            t('editor.tree.resetVolumes'),
            () => onChange({ volumes: undefined }, true),
            'small',
          ),
        );
        parent.appendChild(vrow);
      }

      // ---- leaves
      sub('editor.tree.leafSection');
      parent.appendChild(
        selectRow(
          t('editor.tree.leafSet'),
          LEAF_SETS.map((ls) => ({ value: ls.key, label: ls.label })),
          p.leafSet,
          (v) => onChange({ leafSet: v }, true),
        ).root,
      );
      num('leaves', 'editor.tree.leaves', num0);
      num('leafSize', 'editor.tree.leafSize');
      num('leafSizeVar', 'editor.tree.leafSizeVar');
      parent.appendChild(
        selectRow(
          t('editor.tree.leafOrient'),
          TREE_LEAF_ORIENTS.map((o) => ({
            value: o,
            label: t(`editor.tree.orient.${o}` as Parameters<typeof t>[0]),
          })),
          p.leafOrient,
          (v) => onChange({ leafOrient: v as TreeLeafOrient }, true),
        ).root,
      );
      num('leafFill', 'editor.tree.leafFill');
      parent.appendChild(hint(t('editor.tree.leafFillHint')));
      num('leafDroop', 'editor.tree.leafDroop');
      num('leafJitter', 'editor.tree.leafJitter');
      num('leafClump', 'editor.tree.leafClump');
      num('leafBranchBias', 'editor.tree.leafBranchBias');
      parent.appendChild(
        this.colorInput(t('editor.tree.leafTint'), p.leafTint, (hex) =>
          onChange({ leafTint: hex }, true),
        ),
      );
      num('leafTintVar', 'editor.tree.leafTintVar');
      num('leafGlow', 'editor.tree.leafGlow');
      parent.appendChild(
        checkbox(t('editor.tree.leafCross'), p.leafCross, (on) => onChange({ leafCross: on }, true))
          .root,
      );
      parent.appendChild(hint(t('editor.tree.leafCrossHint')));

      // ---- wind + collision
    }
    sub('editor.tree.windSection');
    num('sway', 'editor.tree.sway');
    num('collide', 'editor.tree.collide');
    parent.appendChild(hint(t('editor.tree.collideHint')));
  }

  private rockPanel(): void {
    const d = this.deps;
    const s = section(t('editor.rock.title'));
    const params = d.getRockParams();
    const chain = d.getRockChainState();
    s.appendChild(
      checkbox(t('editor.rock.chainMode'), chain.mode, (on) => {
        d.setRockChainMode(on);
        this.refresh();
      }).root,
    );
    s.appendChild(hint(chain.mode ? t('editor.rock.chainHint') : t('editor.rock.hint')));
    if (chain.mode) {
      if (chain.count > 0) {
        s.appendChild(
          el(
            'p',
            'ed-chosen',
            t('editor.rock.chainCount', {
              count: formatNumber(chain.count, { useGrouping: false }),
            }),
          ),
        );
      }
      const row = el('div', 'ed-row');
      row.appendChild(
        button(t('editor.rock.generateChain'), () => d.generateRockChain(), 'primary'),
      );
      if (chain.count > 0) {
        row.appendChild(button(t('editor.rock.clearChain'), () => d.clearRockChain(), 'small'));
      }
      s.appendChild(row);
      s.appendChild(
        checkbox(t('editor.rock.walkable'), params.walkable, (on) =>
          d.setRockParams({ walkable: on }),
        ).root,
      );
    }
    s.appendChild(
      slider(t('editor.rock.size'), {
        min: 0.5,
        max: 20,
        step: 0.5,
        value: params.size,
        onInput: (v) => d.setRockParams({ size: v }),
        onChange: (v) => d.setRockParams({ size: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.noise'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: params.noise,
        onInput: (v) => d.setRockParams({ noise: v }),
        onChange: (v) => d.setRockParams({ noise: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.detail'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: params.detail,
        onInput: (v) => d.setRockParams({ detail: v }),
        onChange: (v) => d.setRockParams({ detail: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.sharp'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: params.sharp,
        onInput: (v) => d.setRockParams({ sharp: v }),
        onChange: (v) => d.setRockParams({ sharp: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.jag'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: params.jag,
        onInput: (v) => d.setRockParams({ jag: v }),
        onChange: (v) => d.setRockParams({ jag: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.height'), {
        min: 0.3,
        max: 3,
        step: 0.1,
        value: params.height,
        onInput: (v) => d.setRockParams({ height: v }),
        onChange: (v) => d.setRockParams({ height: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.depth'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: params.depth,
        onInput: (v) => d.setRockParams({ depth: v }),
        onChange: (v) => d.setRockParams({ depth: v }),
        format: num1,
      }).root,
    );
    this.texSetPicker(
      s,
      t('editor.rock.baseTex'),
      this.rockTexOptions(),
      params.texId || `legacy:${params.tex}`,
      (v) => {
        if (v.startsWith('legacy:')) d.setRockParams({ tex: Number(v.slice(7)), texId: '' });
        else d.setRockParams({ texId: v });
      },
    );
    if (params.texId) {
      s.appendChild(
        slider(t('editor.biome.tileSize'), {
          min: 1,
          max: 64,
          step: 1,
          value: params.texTile,
          onInput: (v) => d.setRockParams({ texTile: v }),
          onChange: (v) => d.setRockParams({ texTile: v }),
          format: num1,
        }).root,
      );
    }
    this.root.appendChild(s);
  }

  /** Selected generated rock: reshape it live through updateSelection. */
  private rockControls(s: HTMLElement, sel: PlacementSelection): void {
    const d = this.deps;
    s.appendChild(el('h4', 'ed-sub-title', t('editor.rock.selTitle')));
    s.appendChild(
      slider(t('editor.rock.noise'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: sel.rockNoise ?? 0.5,
        onInput: (v) => d.updateSelection({ rockNoise: v }, false),
        onChange: (v) => d.updateSelection({ rockNoise: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.detail'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: sel.rockDetail ?? 0.5,
        onInput: (v) => d.updateSelection({ rockDetail: v }, false),
        onChange: (v) => d.updateSelection({ rockDetail: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.sharp'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: sel.rockSharp ?? 0.3,
        onInput: (v) => d.updateSelection({ rockSharp: v }, false),
        onChange: (v) => d.updateSelection({ rockSharp: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.jag'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: sel.rockJag ?? 0,
        onInput: (v) => d.updateSelection({ rockJag: v }, false),
        onChange: (v) => d.updateSelection({ rockJag: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.height'), {
        min: 0.3,
        max: 3,
        step: 0.1,
        value: sel.rockHeight ?? 1,
        onInput: (v) => d.updateSelection({ rockHeight: v }, false),
        onChange: (v) => d.updateSelection({ rockHeight: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.depth'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: sel.rockDepth ?? 0,
        onInput: (v) => d.updateSelection({ rockDepth: v }, false),
        onChange: (v) => d.updateSelection({ rockDepth: v }, true),
        format: num1,
      }).root,
    );
    this.texSetPicker(
      s,
      t('editor.rock.baseTex'),
      this.rockTexOptions(),
      sel.rockTexId || `legacy:${sel.rockTex ?? 0}`,
      (v) => {
        if (v.startsWith('legacy:')) d.updateSelection({ rockTex: Number(v.slice(7)) }, true);
        else d.updateSelection({ rockTexId: v }, true);
      },
    );
    if (sel.rockTexId) {
      s.appendChild(
        slider(t('editor.biome.tileSize'), {
          min: 1,
          max: 64,
          step: 1,
          value: sel.rockTexTile ?? DEFAULT_TEXTURE_TILE_YD,
          onInput: (v) => d.updateSelection({ rockTexTile: v }, false),
          onChange: (v) => d.updateSelection({ rockTexTile: v }, true),
          format: num1,
        }).root,
      );
    }
    s.appendChild(
      button(
        t('editor.rock.reroll'),
        () => {
          d.updateSelection({ rockSeed: ((sel.rockSeed ?? 0) + 7919) % 1_000_000_000 }, true);
          this.refresh();
        },
        'small',
      ),
    );
  }

  /** The armed Cut brush: which solid the next click drops, and the two
   *  proportions that turn a ball into a slot, an arch or a shaft. */
  private cutBrushControls(): HTMLElement {
    const d = this.deps;
    const brush = d.getCutBrush();
    const box = el('div', 'ed-cave-card');
    box.appendChild(el('p', 'ed-chosen', t('editor.tunnel.cutBrush')));
    const shapeRow = el('div', 'ed-row');
    for (const shape of CUT_BRUSH_SHAPES) {
      shapeRow.appendChild(
        button(
          t(`editor.tunnel.cutShape.${shape}`),
          () => {
            d.setCutBrush({ shape: shape as CutBrushShape });
            this.refresh();
          },
          brush.shape === shape ? 'primary small' : 'small',
        ),
      );
    }
    box.appendChild(shapeRow);
    if (brush.shape !== 'sphere') {
      box.appendChild(
        slider(t('editor.tunnel.cutLength'), {
          ...CUT_BRUSH_LIMITS.lengthMult,
          value: brush.lengthMult,
          onInput: () => {},
          onChange: (v) => d.setCutBrush({ lengthMult: v }),
          format: num1,
        }).root,
      );
      box.appendChild(
        slider(t('editor.tunnel.cutHeight'), {
          ...CUT_BRUSH_LIMITS.heightMult,
          value: brush.heightMult,
          onInput: () => {},
          onChange: (v) => d.setCutBrush({ heightMult: v }),
          format: num1,
        }).root,
      );
      box.appendChild(
        slider(t('editor.tunnel.cutPitch'), {
          min: -90,
          max: 90,
          step: 1,
          value: (brush.rotX * 180) / Math.PI,
          onInput: () => {},
          onChange: (v) => d.setCutBrush({ rotX: (v * Math.PI) / 180 }),
          format: num1,
        }).root,
      );
    }
    box.appendChild(
      slider(t('editor.tunnel.cutBlend'), {
        ...CUT_BRUSH_LIMITS.blend,
        value: brush.blend,
        onInput: () => {},
        onChange: (v) => d.setCutBrush({ blend: v }),
        format: num1,
      }).root,
    );
    this.shapeDialRows(box, brush, (change, commit) => {
      if (commit) d.setCutBrush(change);
    });
    return box;
  }

  /** FORK: the organic shaping dials (undulation for every shape; taper,
   *  wobble, bend and arch for a capsule), appended below a cut's Blend row.
   *  `apply` receives partial CutChange edits; `commit` marks the release. */
  private shapeDialRows(
    root: HTMLElement,
    v: {
      shape: string;
      warp: number;
      warpScale: number;
      taper: number;
      wobble: number;
      wobbleLen: number;
      bend: number;
      arch: number;
    },
    apply: (change: CutChange, commit: boolean) => void,
  ): void {
    const dial = (
      label: string,
      key: 'warp' | 'warpScale' | 'taper' | 'wobble' | 'wobbleLen' | 'bend' | 'arch',
      format: (n: number) => string,
    ): void => {
      root.appendChild(
        slider(label, {
          ...CUT_BRUSH_LIMITS[key],
          value: v[key],
          onInput: (x) => apply({ [key]: x }, false),
          onChange: (x) => apply({ [key]: x }, true),
          format,
        }).root,
      );
    };
    dial(t('editor.tunnel.cutWarp'), 'warp', num1);
    if (v.warp > 0) dial(t('editor.tunnel.cutWarpScale'), 'warpScale', num1);
    if (v.shape === 'capsule') {
      dial(t('editor.tunnel.cutTaper'), 'taper', num1);
      dial(t('editor.tunnel.cutWobble'), 'wobble', num1);
      if (v.wobble > 0) dial(t('editor.tunnel.cutWobbleLen'), 'wobbleLen', num1);
      dial(t('editor.tunnel.cutBend'), 'bend', num1);
      dial(t('editor.tunnel.cutArch'), 'arch', num1);
    }
  }

  private tunnelPanel(): void {
    const d = this.deps;
    const mode = d.getTunnelMode();
    const s = section(t('editor.tool.tunnel'));
    // Mode switch: model a cave tube, carve boolean interiors, cut/patch the
    // ground sheet, paint remesh detail, or drag the volumetric brushes.
    const modes: { id: TunnelMode; label: string }[] = [
      { id: 'dig', label: t('editor.tunnel.modeDig') },
      { id: 'carve', label: t('editor.tunnel.modeCarve') },
      { id: 'sculpt', label: t('editor.tunnel.modeSculpt') },
      { id: 'fill', label: t('editor.tunnel.modeFill') },
      { id: 'smooth', label: t('editor.tunnel.modeSmooth') },
      { id: 'hole', label: t('editor.tunnel.modeHole') },
      { id: 'patch', label: t('editor.tunnel.modePatch') },
      { id: 'remesh', label: t('editor.tunnel.modeRemesh') },
    ];
    let modeRow = el('div', 'ed-row');
    for (let i = 0; i < modes.length; i++) {
      if (i === 4) {
        s.appendChild(modeRow);
        modeRow = el('div', 'ed-row');
      }
      const m = modes[i];
      modeRow.appendChild(
        button(
          m.label,
          () => {
            d.setTunnelMode(m.id);
            this.refresh();
          },
          mode === m.id ? 'primary small' : 'small',
        ),
      );
    }
    s.appendChild(modeRow);
    s.appendChild(
      hint(
        mode === 'hole'
          ? t('editor.tunnel.holeHint')
          : mode === 'carve'
            ? t('editor.tunnel.carveHint')
            : mode === 'sculpt'
              ? t('editor.tunnel.sculptHint')
              : mode === 'fill'
                ? t('editor.tunnel.fillHint')
                : mode === 'smooth'
                  ? t('editor.tunnel.smoothHint')
                  : mode === 'remesh'
                    ? t('editor.tunnel.remeshHint')
                    : mode === 'patch'
                      ? t('editor.tunnel.patchHint')
                      : t('editor.tunnel.hint'),
      ),
    );
    if (mode === 'remesh') {
      // FORK: one cell for the whole map, applied to every cave at once.
      let globalCell = d.getCaveMeshCell();
      s.appendChild(el('p', 'ed-chosen', t('editor.tunnel.remeshAllTitle')));
      s.appendChild(hint(t('editor.tunnel.remeshAllHint')));
      s.appendChild(
        slider(t('editor.tunnel.remeshGlobal'), {
          min: 0.5,
          max: 2,
          step: 0.25,
          value: globalCell,
          onInput: (v) => {
            globalCell = v;
          },
          onChange: (v) => {
            globalCell = v;
          },
          format: (v) => v.toFixed(2),
        }).root,
      );
      s.appendChild(
        button(t('editor.tunnel.remeshAll'), () => d.remeshAllCaves(globalCell), 'primary small'),
      );
      s.appendChild(el('h3', 'ed-subtitle', t('editor.tunnel.remeshRegionsTitle')));
      s.appendChild(
        slider(t('editor.tunnel.remeshCell'), {
          min: 0.25,
          max: 2,
          step: 0.05,
          value: d.getRemeshCell(),
          onInput: () => {},
          onChange: (v) => d.setRemeshCell(v),
          format: (v) => v.toFixed(2),
        }).root,
      );
      const regions = d.getDetailRegions();
      if (regions.length > 0) {
        s.appendChild(el('h3', 'ed-subtitle', t('editor.tunnel.remeshList')));
      }
      for (const r of regions) {
        const card = el('div', 'ed-cave-card');
        card.appendChild(
          el(
            'p',
            'ed-chosen',
            t('editor.tunnel.remeshLabel', {
              n: formatNumber(r.index + 1, { useGrouping: false }),
              r: num1(r.radius),
              cell: r.cell.toFixed(2),
            }),
          ),
        );
        card.appendChild(
          button(
            t('editor.tunnel.remeshDelete'),
            () => d.deleteDetailRegion(r.index),
            'danger small',
          ),
        );
        s.appendChild(card);
      }
      this.root.appendChild(s);
      return;
    }
    if (mode === 'sculpt' || mode === 'smooth') {
      if (mode !== 'smooth') {
        // FORK: the stamp's alpha (shape), its rim noise, and the volume cell.
        const alpha = d.getDigAlpha();
        s.appendChild(el('p', 'ed-chosen', t('editor.tunnel.digAlphaLabel')));
        const row = el('div', 'ed-row');
        for (const kind of DIG_ALPHA_KINDS) {
          row.appendChild(
            button(
              t(`editor.tunnel.digAlpha.${kind}`),
              () => {
                d.setDigAlpha({ kind });
                this.refresh();
              },
              alpha.kind === kind ? 'primary small' : 'small',
            ),
          );
        }
        s.appendChild(row);
        s.appendChild(
          slider(t('editor.tunnel.digNoise'), {
            min: 0,
            max: 1,
            step: 0.05,
            value: alpha.noise,
            onInput: () => {},
            onChange: (v) => d.setDigAlpha({ noise: v }),
            format: num1,
          }).root,
        );
        s.appendChild(
          slider(t('editor.tunnel.digCell'), {
            min: 0.25,
            max: 2,
            step: 0.25,
            value: d.getDigCell(),
            onInput: () => {},
            onChange: (v) => d.setDigCell(v),
            format: num1,
          }).root,
        );
        s.appendChild(hint(t('editor.tunnel.digCellHint')));
      }
      if (d.hasDugRock()) {
        s.appendChild(button(t('editor.tunnel.digClear'), () => d.clearDugRock(), 'small'));
      }
      this.root.appendChild(s);
      return;
    }
    if (mode === 'hole' || mode === 'patch' || mode === 'carve' || mode === 'fill') {
      const carve = mode === 'carve';
      // FORK: Fill is the ERASE BOX: the same ghost flow, sized as a box, and
      // the commit removes every cave inside it instead of adding a cut.
      const erase = mode === 'fill';
      const pendingAny = mode === 'patch' ? null : d.getPendingCut();
      const pending = pendingAny && pendingAny.erase === erase ? pendingAny : null;
      if (pending) {
        // The GHOST: the blue solid standing in the viewport, waiting for the
        // maker to place, size and confirm it.
        const card = el('div', 'ed-cave-card');
        card.appendChild(
          el(
            'p',
            'ed-chosen',
            erase ? t('editor.tunnel.eraseTitle') : t('editor.tunnel.ghostTitle'),
          ),
        );
        card.appendChild(
          hint(erase ? t('editor.tunnel.eraseGhostHint') : t('editor.tunnel.ghostHint')),
        );
        if (carve) {
          card.appendChild(
            slider(t('editor.tunnel.cutDepth'), {
              min: 0,
              max: 120,
              step: 0.5,
              value: Math.max(0, Math.min(120, pending.depth)),
              onInput: (v) => d.updatePendingCut({ depth: v }),
              onChange: (v) => d.updatePendingCut({ depth: v }),
              format: num1,
            }).root,
          );
        }
        card.appendChild(
          slider(erase ? t('editor.tunnel.eraseHalf') : t('editor.tunnel.holeRadius'), {
            min: 1,
            max: erase ? 80 : 40,
            step: 0.5,
            value: pending.radius,
            onInput: (v) => d.updatePendingCut({ radius: v }),
            onChange: (v) => d.updatePendingCut({ radius: v }),
            format: num1,
          }).root,
        );
        if (pending.shape !== 'sphere' && pending.shape !== 'tube') {
          card.appendChild(
            slider(t('editor.tunnel.cutLength'), {
              ...CUT_BRUSH_LIMITS.lengthMult,
              value: pending.lengthMult,
              onInput: (v) => d.updatePendingCut({ lengthMult: v }),
              onChange: (v) => d.updatePendingCut({ lengthMult: v }),
              format: num1,
            }).root,
          );
          card.appendChild(
            slider(t('editor.tunnel.cutHeight'), {
              ...CUT_BRUSH_LIMITS.heightMult,
              value: pending.heightMult,
              onInput: (v) => d.updatePendingCut({ heightMult: v }),
              onChange: (v) => d.updatePendingCut({ heightMult: v }),
              format: num1,
            }).root,
          );
          card.appendChild(
            slider(t('editor.tunnel.cutYaw'), {
              min: 0,
              max: 360,
              step: 1,
              value: ((pending.rotY * 180) / Math.PI + 360) % 360,
              onInput: (v) => d.updatePendingCut({ rotY: (v * Math.PI) / 180 }),
              onChange: (v) => d.updatePendingCut({ rotY: (v * Math.PI) / 180 }),
              format: num1,
            }).root,
          );
          if (!erase)
            card.appendChild(
              slider(t('editor.tunnel.cutPitch'), {
                min: -90,
                max: 90,
                step: 1,
                value: (pending.rotX * 180) / Math.PI,
                onInput: (v) => d.updatePendingCut({ rotX: (v * Math.PI) / 180 }),
                onChange: (v) => d.updatePendingCut({ rotX: (v * Math.PI) / 180 }),
                format: num1,
              }).root,
            );
        }
        if (!erase) {
          card.appendChild(
            slider(t('editor.tunnel.cutBlend'), {
              ...CUT_BRUSH_LIMITS.blend,
              value: pending.blend,
              onInput: (v) => d.updatePendingCut({ blend: v }),
              onChange: (v) => d.updatePendingCut({ blend: v }),
              format: num1,
            }).root,
          );
          this.shapeDialRows(card, pending, (change, commit) => {
            d.updatePendingCut(change);
            if (commit && ('warp' in change || 'wobble' in change)) this.refresh();
          });
        }
        card.appendChild(hint(t('editor.tunnel.ghostGizmoHint')));
        card.appendChild(hint(t('editor.tunnel.ghostLockHint')));
        const row = el('div', 'ed-row');
        row.appendChild(
          button(
            erase ? t('editor.tunnel.eraseConfirm') : t('editor.tunnel.ghostConfirm'),
            () => d.commitPendingCut(),
            'primary small',
          ),
        );
        row.appendChild(
          button(t('editor.tunnel.ghostCancel'), () => d.cancelPendingCut(), 'small'),
        );
        card.appendChild(row);
        s.appendChild(card);
      }
      if (carve && !pending) {
        s.appendChild(
          slider(t('editor.tunnel.cutDepth'), {
            min: 0,
            max: 120,
            step: 0.5,
            value: d.getCarveDepth(),
            onInput: () => {},
            onChange: (v) => d.setCarveDepth(v),
            format: num1,
          }).root,
        );
      }
      if (erase) {
        this.root.appendChild(s);
        return;
      }
      if (!pending) s.appendChild(this.cutBrushControls());
      const cuts =
        mode === 'patch' ? d.getHolePatches() : d.getHoles().filter((c) => c.carve === carve);
      const update = (
        i: number,
        change: CutChange & { depth?: number; tex?: string | null; texTile?: number | null },
        commit: boolean,
      ): void =>
        mode === 'patch' ? d.updateHolePatch(i, change, commit) : d.updateHole(i, change, commit);
      if (cuts.length > 0) {
        s.appendChild(
          el(
            'h3',
            'ed-subtitle',
            mode === 'hole'
              ? t('editor.tunnel.holeList')
              : carve
                ? t('editor.tunnel.carveList')
                : t('editor.tunnel.patchList'),
          ),
        );
      }
      for (const cut of cuts as (CutSummary & { depth?: number })[]) {
        const card = el('div', 'ed-cave-card');
        const n = formatNumber(cut.index + 1, { useGrouping: false });
        card.appendChild(
          el(
            'p',
            'ed-chosen',
            mode === 'hole'
              ? t('editor.tunnel.holeLabel', { n })
              : carve
                ? t('editor.tunnel.carveLabel', { n })
                : t('editor.tunnel.patchLabel', { n }),
          ),
        );
        if (carve && cut.depth !== undefined && cut.shape !== 'tube') {
          card.appendChild(
            slider(t('editor.tunnel.cutDepth'), {
              min: 0,
              max: 30,
              step: 0.5,
              value: Math.max(0, Math.min(30, cut.depth)),
              onInput: (v) => update(cut.index, { depth: v }, false),
              onChange: (v) => update(cut.index, { depth: v }, true),
              format: num1,
            }).root,
          );
        }
        card.appendChild(el('p', 'ed-hint', t(`editor.tunnel.cutShape.${cut.shape}`)));
        card.appendChild(
          slider(t('editor.tunnel.holeRadius'), {
            min: 1,
            max: 40,
            step: 0.5,
            value: cut.radius,
            onInput: (v) => update(cut.index, { radius: v }, false),
            onChange: (v) => update(cut.index, { radius: v }, true),
            format: num1,
          }).root,
        );
        // A tube cut is a cave's own self-carved mouth: derived from the bore,
        // so its proportions are not the maker's to edit here.
        if (cut.shape !== 'tube') {
          if (cut.shape !== 'sphere') {
            card.appendChild(
              slider(t('editor.tunnel.cutLength'), {
                ...CUT_BRUSH_LIMITS.lengthMult,
                value: cut.lengthMult,
                onInput: (v) => update(cut.index, { lengthMult: v }, false),
                onChange: (v) => update(cut.index, { lengthMult: v }, true),
                format: num1,
              }).root,
            );
            card.appendChild(
              slider(t('editor.tunnel.cutHeight'), {
                ...CUT_BRUSH_LIMITS.heightMult,
                value: cut.heightMult,
                onInput: (v) => update(cut.index, { heightMult: v }, false),
                onChange: (v) => update(cut.index, { heightMult: v }, true),
                format: num1,
              }).root,
            );
            card.appendChild(
              slider(t('editor.tunnel.cutYaw'), {
                min: 0,
                max: 360,
                step: 1,
                value: (cut.rotY * 180) / Math.PI,
                onInput: (v) => update(cut.index, { rotY: (v * Math.PI) / 180 }, false),
                onChange: (v) => update(cut.index, { rotY: (v * Math.PI) / 180 }, true),
                format: num1,
              }).root,
            );
            card.appendChild(
              slider(t('editor.tunnel.cutPitch'), {
                min: -90,
                max: 90,
                step: 1,
                value: (cut.rotX * 180) / Math.PI,
                onInput: (v) => update(cut.index, { rotX: (v * Math.PI) / 180 }, false),
                onChange: (v) => update(cut.index, { rotX: (v * Math.PI) / 180 }, true),
                format: num1,
              }).root,
            );
          }
          card.appendChild(
            slider(t('editor.tunnel.cutBlend'), {
              ...CUT_BRUSH_LIMITS.blend,
              value: cut.blend,
              onInput: (v) => update(cut.index, { blend: v }, false),
              onChange: (v) => update(cut.index, { blend: v }, true),
              format: num1,
            }).root,
          );
          this.shapeDialRows(card, cut, (change, commit) => update(cut.index, change, commit));
        }
        if (carve && cut.shape !== 'tube') {
          // Interior base texture, same picker the cave tubes use: tiled over
          // the cavity's walls/floor, with the Paint tool's vertex tint
          // layering on top.
          this.texSetPicker(
            card,
            t('editor.tunnel.texture'),
            [
              { value: '', label: t('editor.tunnel.texDefault'), file: 'Rock051_Color.jpg' },
              ...TERRAIN_TEXTURE_SETS.map((set) => ({
                value: set.key,
                label: set.name,
                file: `${set.key}_Color.jpg`,
              })),
            ],
            cut.tex ?? '',
            (v) => update(cut.index, { tex: v || null }, true),
          );
          if (cut.tex) {
            card.appendChild(
              slider(t('editor.biome.tileSize'), {
                min: 1,
                max: 64,
                step: 1,
                value: cut.texTile ?? DEFAULT_TEXTURE_TILE_YD,
                onInput: (v) => update(cut.index, { texTile: v }, false),
                onChange: (v) => update(cut.index, { texTile: v }, true),
                format: num1,
              }).root,
            );
          }
        }
        card.appendChild(
          button(
            mode === 'patch'
              ? t('editor.tunnel.patchDelete')
              : carve
                ? t('editor.tunnel.carveDelete')
                : t('editor.tunnel.holeDelete'),
            () => (mode === 'patch' ? d.deleteHolePatch(cut.index) : d.deleteHole(cut.index)),
            'danger small',
          ),
        );
        s.appendChild(card);
      }
      this.root.appendChild(s);
      return;
    }
    const pairState = d.getCavePairState();
    if (pairState.pendingExit) {
      s.appendChild(hint(t('editor.tunnel.needExit')));
    }
    if (pairState.readyToGenerate > 0) {
      s.appendChild(
        button(
          t('editor.tunnel.generate', {
            count: formatNumber(pairState.readyToGenerate, { useGrouping: false }),
          }),
          () => d.generateCaves(),
          'primary',
        ),
      );
    }
    const caves = d.getCaves();
    if (caves.length > 0) s.appendChild(el('h3', 'ed-subtitle', t('editor.tunnel.listTitle')));
    for (const cave of caves) {
      const card = el('div', 'ed-cave-card');
      card.appendChild(
        el(
          'p',
          'ed-chosen',
          t('editor.tunnel.caveLabel', {
            n: formatNumber(cave.index + 1, { useGrouping: false }),
            nodes: formatNumber(cave.nodes, { useGrouping: false }),
          }),
        ),
      );
      // Whole-cave move: group-select the rig and hand off to the Move gizmo.
      card.appendChild(
        button(t('editor.tunnel.selectCave'), () => d.selectWholeCave(cave.index), 'primary small'),
      );
      // Mouth toggles: each end is an open ring at exactly its authored size,
      // or a sealed rock cap.
      card.appendChild(
        checkbox(t('editor.tunnel.startOpen'), cave.startOpen, (on) => {
          d.updateCave(cave.index, { startOpen: on }, true);
        }).root,
      );
      card.appendChild(
        checkbox(t('editor.tunnel.endOpen'), cave.endOpen, (on) => {
          d.updateCave(cave.index, { endOpen: on }, true);
        }).root,
      );
      // Self-carving mouth: the bore emits a matching tube cut, so wherever
      // the tube breaches the surface it opens its own way in. Off by default,
      // because a cave authored before this existed already has hand-placed
      // openings lined up with it.
      card.appendChild(
        checkbox(t('editor.tunnel.autoMouth'), cave.autoMouth, (on) => {
          d.updateCave(cave.index, { autoMouth: on }, true);
        }).root,
      );
      if (cave.autoMouth) {
        card.appendChild(hint(t('editor.tunnel.autoMouthHint')));
        card.appendChild(
          slider(t('editor.tunnel.mouthBlend'), {
            ...CUT_BRUSH_LIMITS.blend,
            value: cave.mouthBlend,
            onInput: (v) => d.updateCave(cave.index, { mouthBlend: v }, false),
            onChange: (v) => d.updateCave(cave.index, { mouthBlend: v }, true),
            format: num1,
          }).root,
        );
      }
      card.appendChild(
        slider(t('editor.tunnel.width'), {
          min: 0.5,
          max: 3,
          step: 0.1,
          value: cave.width,
          onInput: (v) => d.updateCave(cave.index, { width: v }, false),
          onChange: (v) => d.updateCave(cave.index, { width: v }, true),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.tunnel.height'), {
          min: 0.5,
          max: 3,
          step: 0.1,
          value: cave.height,
          onInput: (v) => d.updateCave(cave.index, { height: v }, false),
          onChange: (v) => d.updateCave(cave.index, { height: v }, true),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.tunnel.variance'), {
          min: 0,
          max: 1,
          step: 0.05,
          value: cave.variance,
          onInput: (v) => d.updateCave(cave.index, { variance: v }, false),
          onChange: (v) => d.updateCave(cave.index, { variance: v }, true),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.tunnel.floorVariance'), {
          min: 0,
          max: 1,
          step: 0.05,
          value: cave.floorVariance,
          onInput: (v) => d.updateCave(cave.index, { floorVariance: v }, false),
          onChange: (v) => d.updateCave(cave.index, { floorVariance: v }, true),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.tunnel.stalactites'), {
          min: 0,
          max: 1,
          step: 0.05,
          value: cave.stalactites,
          onInput: (v) => d.updateCave(cave.index, { stalactites: v }, false),
          onChange: (v) => d.updateCave(cave.index, { stalactites: v }, true),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.tunnel.stalagmites'), {
          min: 0,
          max: 1,
          step: 0.05,
          value: cave.stalagmites,
          onInput: (v) => d.updateCave(cave.index, { stalagmites: v }, false),
          onChange: (v) => d.updateCave(cave.index, { stalagmites: v }, true),
          format: num1,
        }).root,
      );
      if (cave.stalactites > 0 || cave.stalagmites > 0) {
        card.appendChild(
          slider(t('editor.tunnel.spikeSize'), {
            min: 0.3,
            max: 3,
            step: 0.1,
            value: cave.spikeSize,
            onInput: (v) => d.updateCave(cave.index, { spikeSize: v }, false),
            onChange: (v) => d.updateCave(cave.index, { spikeSize: v }, true),
            format: num1,
          }).root,
        );
      }
      // Interior base texture: tiled over walls/floor; the Paint tool's vertex
      // tint still layers on top, so a re-textured cave stays fully paintable.
      this.texSetPicker(
        card,
        t('editor.tunnel.texture'),
        [
          { value: '', label: t('editor.tunnel.texDefault'), file: 'Rock051_Color.jpg' },
          ...TERRAIN_TEXTURE_SETS.map((set) => ({
            value: set.key,
            label: set.name,
            file: `${set.key}_Color.jpg`,
          })),
        ],
        cave.tex ?? '',
        (v) => d.updateCave(cave.index, { tex: v || null }, true),
      );
      if (cave.tex) {
        card.appendChild(
          slider(t('editor.biome.tileSize'), {
            min: 1,
            max: 64,
            step: 1,
            value: cave.texTile ?? DEFAULT_TEXTURE_TILE_YD,
            onInput: (v) => d.updateCave(cave.index, { texTile: v }, false),
            onChange: (v) => d.updateCave(cave.index, { texTile: v }, true),
            format: num1,
          }).root,
        );
      }
      const row = el('div', 'ed-row');
      row.appendChild(button(t('editor.tunnel.reverse'), () => d.reverseCave(cave.index), 'small'));
      row.appendChild(
        button(t('editor.tunnel.delete'), () => d.deleteCave(cave.index), 'danger small'),
      );
      card.appendChild(row);
      s.appendChild(card);
    }
    s.appendChild(hint(t('editor.tunnel.guideHint')));
    this.root.appendChild(s);
  }

  /** The merged Sculpt tool's direction toggle (raise by default). */
  private sculptBrushShapePanel(): void {
    const d = this.deps;
    const s = section(t('editor.sculpt.shapeTitle'));
    s.appendChild(
      slider(t('editor.sculpt.hardness'), {
        min: 0,
        max: 100,
        step: 5,
        value: d.getSculptHardness(),
        onInput: (value) => d.setSculptHardness(value),
        format: num1,
      }).root,
    );
    s.appendChild(el('h3', 'ed-subtitle', t('editor.sculpt.alphaTitle')));
    const row = el('div', 'ed-alpha-row');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('editor.sculpt.alphaTitle'));
    const add = (id: TerrainBrushAlphaId | null, name: string, thumb: HTMLElement | null): void => {
      const buttonEl = document.createElement('button');
      buttonEl.type = 'button';
      buttonEl.className = 'ed-alpha';
      buttonEl.setAttribute('role', 'radio');
      buttonEl.setAttribute('aria-checked', id === d.getSculptAlpha() ? 'true' : 'false');
      buttonEl.classList.toggle('active', id === d.getSculptAlpha());
      buttonEl.title = name;
      buttonEl.setAttribute('aria-label', name);
      buttonEl.appendChild(thumb ?? el('span', 'ed-alpha-none', name));
      buttonEl.addEventListener('click', () => {
        d.setSculptAlpha(id);
        this.refresh();
      });
      row.appendChild(buttonEl);
    };
    add(null, t('editor.sculpt.alphaNone'), null);
    for (const alpha of BUILTIN_ALPHAS) {
      add(alpha.id as TerrainBrushAlphaId, alpha.name, brushAlphaThumb(alpha));
    }
    s.appendChild(row);
    s.appendChild(hint(t('editor.sculpt.alphaHint')));
    this.root.appendChild(s);
  }

  private sculptPanel(): void {
    const d = this.deps;
    const s = section(t('editor.tool.raise'));
    s.appendChild(hint(t('editor.sculpt.hint')));
    s.appendChild(
      checkbox(t('editor.sculpt.lower'), d.getSculptLower(), (on) => d.setSculptLower(on)).root,
    );
    s.appendChild(
      checkbox(t('editor.sculpt.grab'), d.getSculptGrab(), (on) => {
        d.setSculptGrab(on);
        this.refresh();
      }).root,
    );
    if (d.getSculptGrab()) s.appendChild(hint(t('editor.sculpt.grabHint')));
    s.appendChild(hint(t('editor.sculpt.shiftHint')));
    this.autoTextureControls(s);
    this.root.appendChild(s);
  }

  /** One paint-id dropdown for the auto-texture bands: built-in biomes plus
   *  the map's custom swatches, with "Leave as is" = -1. */
  private paintIdSelect(value: number, onChange: (id: number) => void): HTMLElement {
    const row = el('label', 'ed-field');
    const sel = document.createElement('select');
    const add = (v: number, label: string): void => {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = label;
      if (v === value) o.selected = true;
      sel.appendChild(o);
    };
    add(-1, t('editor.sculpt.autoTexNone'));
    for (const opt of BIOME_OPTIONS) {
      if (opt.id === 255) continue;
      add(opt.id, t(opt.labelKey as Parameters<typeof t>[0]));
    }
    for (const sw of this.deps.getCustomSwatches()) {
      add(sw.id, sw.label ?? `#${sw.color.toString(16).padStart(6, '0')}`);
    }
    sel.addEventListener('change', () => {
      const v = Number.parseInt(sel.value, 10);
      if (Number.isFinite(v)) onChange(v);
    });
    row.appendChild(sel);
    return row;
  }

  /** Slope-based auto texture: shared by the Sculpt and Flatten/Smooth panels. */
  private autoTextureControls(s: HTMLElement): void {
    const d = this.deps;
    const cfg = d.getAutoTexture();
    s.appendChild(
      checkbox(t('editor.sculpt.autoTex'), cfg.enabled, (on) => {
        d.setAutoTexture({ enabled: on });
        this.refresh();
      }).root,
    );
    if (!cfg.enabled) return;
    s.appendChild(hint(t('editor.sculpt.autoTexHint')));
    s.appendChild(
      slider(t('editor.sculpt.autoTexAngle'), {
        min: 10,
        max: 75,
        step: 1,
        value: cfg.angle,
        onInput: (v) => d.setAutoTexture({ angle: v }),
        format: num1,
      }).root,
    );
    s.appendChild(el('p', 'ed-hint', t('editor.sculpt.autoTexFlat')));
    s.appendChild(this.paintIdSelect(cfg.flatId, (id) => d.setAutoTexture({ flatId: id })));
    s.appendChild(el('p', 'ed-hint', t('editor.sculpt.autoTexSteep')));
    s.appendChild(this.paintIdSelect(cfg.steepId, (id) => d.setAutoTexture({ steepId: id })));
  }

  private flattenPanel(): void {
    const d = this.deps;
    const s = section(t('editor.tool.flatten'));
    s.appendChild(hint(t('editor.flatten.hint')));
    s.appendChild(
      checkbox(t('editor.flatten.smoothMode'), d.getFlattenSmooth(), (on) => {
        d.setFlattenSmooth(on);
        this.refresh(); // the strength slider / hard-edge toggle swap with the mode
      }).root,
    );
    if (d.getFlattenSmooth()) {
      // The smoothing STYLE (Blender's brush family on a heightfield): plain
      // smooth, its sharpen inverse, roughening noise, or stepped terraces.
      const styles = ['smooth', 'sharpen', 'noise', 'terrace'] as const;
      const styleRow = el('div', 'ed-row');
      const active = d.getLevelStyle();
      for (const style of styles) {
        styleRow.appendChild(
          button(
            t(`editor.flatten.style.${style}`),
            () => {
              d.setLevelStyle(style);
              this.refresh();
            },
            active === style ? 'primary small' : 'small',
          ),
        );
      }
      s.appendChild(styleRow);
      s.appendChild(hint(t(`editor.flatten.styleHint.${active}`)));
      if (active === 'noise') {
        s.appendChild(
          slider(t('editor.flatten.noiseSize'), {
            min: NOISE_SIZE_MIN,
            max: NOISE_SIZE_MAX,
            step: 0.5,
            value: d.getNoiseSize(),
            onInput: (v) => d.setNoiseSize(v),
            format: num1,
          }).root,
        );
        s.appendChild(
          slider(t('editor.flatten.noiseRough'), {
            min: 0,
            max: 100,
            step: 5,
            value: d.getNoiseRough(),
            onInput: (v) => d.setNoiseRough(v),
            format: num1,
          }).root,
        );
        s.appendChild(hint(t('editor.flatten.noiseHint')));
      }
    }
    if (!d.getFlattenSmooth()) {
      s.appendChild(
        checkbox(t('editor.flatten.hardEdge'), d.getFlattenHardEdge(), (on) =>
          d.setFlattenHardEdge(on),
        ).root,
      );
    }
    s.appendChild(hint(t('editor.flatten.shiftHint')));
    this.autoTextureControls(s);
    this.root.appendChild(s);
  }

  private biomePanel(): void {
    const d = this.deps;
    const s = section(t('editor.biome.title'));
    // Photoshop-style brush edge control + the bucket fill.
    s.appendChild(
      slider(t('editor.biome.hardness'), {
        min: 10,
        max: 100,
        step: 5,
        value: d.getPaintHardness(),
        onInput: (v) => d.setPaintHardness(v),
        format: num1,
      }).root,
    );
    // Boundary look, map-wide. These sit with Brush hardness because they are
    // the other half of it: hardness decides how wide the dithered rim is,
    // these two decide whether that rim reads as a gradient or as speckle.
    const edge = d.getPaintEdge();
    s.appendChild(
      slider(t('editor.biome.edgeSoftness'), {
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(edge.softness * 100),
        onInput: (v) => d.setPaintEdge({ softness: v / 100 }),
        format: (v) => `${Math.round(v)}%`,
      }).root,
    );
    s.appendChild(
      slider(t('editor.biome.edgeDetail'), {
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(edge.detail * 100),
        onInput: (v) => d.setPaintEdge({ detail: v / 100 }),
        format: (v) => `${Math.round(v)}%`,
      }).root,
    );
    s.appendChild(hint(t('editor.biome.edgeHint')));
    const bucket = button(
      t('editor.biome.bucket'),
      () => {
        d.setBucketArmed(!d.getBucketArmed());
        this.refresh();
      },
      'small',
      t('editor.biome.bucketTitle'),
    );
    if (d.getBucketArmed()) bucket.classList.add('active');
    s.appendChild(bucket);
    if (d.getBucketArmed()) s.appendChild(hint(t('editor.biome.bucketArmedHint')));
    this.brushAlphaPicker(s);
    this.texturePicker(s);
    this.textureSlotTally(s);
    // Tile-size for the active imported-texture swatch (yards per repeat).
    const active = d.getCustomSwatches().find((sw) => sw.id === d.getPaintBiome());
    if (active?.textureSha) {
      s.appendChild(
        slider(t('editor.biome.tileSize'), {
          min: 1,
          max: 64,
          step: 1,
          value: active.tileSize ?? DEFAULT_TEXTURE_TILE_YD,
          onInput: (v) => d.setSwatchTileSize(active.id, v),
          format: num1,
        }).root,
      );
      // Anti-tiling. Zero is the plain repeat and costs exactly what it
      // always did; above zero the tile is sampled a second time through a
      // rotated frame, so the slider is also the cost control.
      s.appendChild(
        slider(t('editor.biome.variation'), {
          min: 0,
          max: 100,
          step: 5,
          value: Math.round((active.variation ?? 0) * 100),
          onInput: (v) => d.setSwatchVariation(active.id, v / 100),
          format: (v) => `${Math.round(v)}%`,
        }).root,
      );
      // Surface depth: shades the texture's own crevices so painted ground
      // stops reading flat. Like Variation, 0 takes no extra tap.
      s.appendChild(
        slider(t('editor.biome.depth'), {
          min: 0,
          max: 100,
          step: 5,
          value: Math.round((active.depth ?? 0) * 100),
          onInput: (v) => d.setSwatchDepth(active.id, v / 100),
          format: (v) => `${Math.round(v)}%`,
        }).root,
      );
      s.appendChild(hint(t('editor.biome.variationHint')));
    }
    // Hue / light adjust of the selected texture. Centered = the texture
    // paints exactly as stock; moving a slider on a BUILT-IN biome creates
    // (or reuses) a custom variant swatch carrying the adjust, so the values
    // save with the map. Color-only swatches keep just their authored color.
    const isBuiltIn = BIOME_OPTIONS.some((o) => o.id === d.getPaintBiome() && o.id !== 255);
    if (isBuiltIn || active?.textureSha || active?.baseBiome !== undefined) {
      // A non-centered tint can be kept as its own reusable swatch. The button
      // lives in the panel permanently (panels don't re-render per slider
      // tick) and the slider handlers keep its enabled state current.
      const saveBtn = button(
        t('editor.biome.saveSwatch'),
        () => d.saveAdjustedSwatch(),
        'small',
        t('editor.biome.saveSwatchTitle'),
      );
      const syncSave = (): void => {
        const sw = d.getCustomSwatches().find((c) => c.id === d.getPaintBiome());
        saveBtn.disabled = !sw || ((sw.hueShift ?? 0) === 0 && (sw.light ?? 0) === 0);
      };
      s.appendChild(
        slider(t('editor.biome.hue'), {
          min: -180,
          max: 180,
          step: 1,
          value: active?.hueShift ?? 0,
          onInput: (v) => {
            d.setPaintAdjust({ hueShift: v });
            syncSave();
          },
          format: num1,
        }).root,
      );
      s.appendChild(
        slider(t('editor.biome.light'), {
          min: -100,
          max: 100,
          step: 1,
          value: Math.round((active?.light ?? 0) * 100),
          onInput: (v) => {
            d.setPaintAdjust({ light: v / 100 });
            syncSave();
          },
          format: num1,
        }).root,
      );
      syncSave();
      s.appendChild(saveBtn);
    }
    // Remove the active custom swatch from the map (imported texture or saved
    // biome variant); painted cells fall back to the base biome look.
    if (active) {
      s.appendChild(
        button(
          t('editor.biome.removeSwatch'),
          () => d.deleteCustomSwatch(active.id),
          'small danger',
          t('editor.biome.removeSwatchTitle'),
        ),
      );
    }
    s.appendChild(
      button(
        t('editor.biome.importTexture'),
        () => d.importTextureSwatch(),
        'small',
        t('editor.biome.importTextureTitle'),
      ),
    );
    s.appendChild(hint(t('editor.biome.customHint')));
    s.appendChild(hint(t('editor.biome.hint')));
    this.terrainStyleControls(s);
    s.appendChild(button(t('editor.biome.autoRetexture'), () => d.autoRetextureMap(), 'small'));
    s.appendChild(hint(t('editor.biome.autoRetextureHint')));
    s.appendChild(button(t('editor.biome.clear'), () => d.clearBiomePaint(), 'small danger'));
    this.root.appendChild(s);
  }

  /**
   * The map's texture-slot tally under the swatches: each distinct texture
   * claims one of MAX_PAINT_SLOTS, and a texture past the budget silently
   * paints as its flat colour. Amber when only a few slots remain, red with
   * the overflow count once the map is over. The panel rebuilds on every
   * swatch add/remove, so the count is always current.
   */
  private textureSlotTally(s: HTMLElement): void {
    const u = paintTextureSlotUsage(this.deps.getCustomSwatches());
    const tally = el('p', 'ed-slot-tally', t('editor.biome.textureSlots', { ...u }));
    tally.title = t('editor.biome.textureSlotsTitle', { max: u.max });
    if (u.over > 0) tally.classList.add('over');
    else if (u.free <= TEXTURE_SLOTS_LOW) tally.classList.add('low');
    s.appendChild(tally);
    if (u.over > 0) {
      s.appendChild(
        el('p', 'ed-slot-warning', t('editor.biome.textureSlotsOver', { over: u.over })),
      );
    }
  }

  /** Brush alpha picker: None + the built-in masks + imports, as thumbnails. */
  private brushAlphaPicker(s: HTMLElement): void {
    const d = this.deps;
    const activeId = d.getPaintAlpha();
    s.appendChild(el('h3', 'ed-subtitle', t('editor.biome.alphaTitle')));
    const row = el('div', 'ed-alpha-row');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('editor.biome.alphaTitle'));
    const cell = (
      id: string | null,
      name: string,
      thumb: HTMLElement | null,
      removable: boolean,
    ): void => {
      const wrap = el('div', 'ed-alpha-cell');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-alpha';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', id === activeId ? 'true' : 'false');
      b.classList.toggle('active', id === activeId);
      b.title = name;
      b.setAttribute('aria-label', name);
      if (thumb) b.appendChild(thumb);
      else b.appendChild(el('span', 'ed-alpha-none', name));
      b.addEventListener('click', () => {
        d.setPaintAlpha(id);
        this.refresh();
      });
      wrap.appendChild(b);
      if (removable && id) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'ed-asset-del';
        del.textContent = 'x';
        del.title = t('editor.biome.alphaRemove');
        del.setAttribute('aria-label', t('editor.biome.alphaRemove'));
        del.addEventListener('click', (ev) => {
          ev.stopPropagation();
          removeBrushAlpha(id);
          if (activeId === id) d.setPaintAlpha(null);
          this.refresh();
        });
        wrap.appendChild(del);
      }
      row.appendChild(wrap);
    };
    cell(null, t('editor.biome.alphaNone'), null, false);
    for (const a of listBrushAlphas()) {
      cell(a.id, a.name, brushAlphaThumb(a), a.imported === true);
    }
    s.appendChild(row);
    s.appendChild(
      button(
        t('editor.biome.alphaImport'),
        () => d.importPaintAlpha(),
        'small',
        t('editor.biome.alphaImportTitle'),
      ),
    );
  }

  /** Every paintable texture as one option row (thumbnail + name). Built-in
   *  library sets not yet materialized as map swatches ride along with a
   *  `builtinKey` instead of a paint id (picking one materializes it). */
  private textureOptions(): TextureOption[] {
    const d = this.deps;
    const out: TextureOption[] = [];
    const gBiomes = t('editor.biome.groupBiomes');
    for (const opt of BIOME_OPTIONS) {
      if (opt.id === 255) continue;
      out.push({
        id: opt.id,
        label: t(opt.labelKey as Parameters<typeof t>[0]),
        thumb: { ...BIOME_THUMBS[opt.id] },
        group: gBiomes,
      });
    }
    const swatches = d.getCustomSwatches();
    const gSwatches = t('editor.biome.groupSwatches');
    for (const sw of swatches) {
      const css = `#${adjustedSwatchColor(sw).toString(16).padStart(6, '0')}`;
      const texUrl = sw.textureSha ? d.swatchTextureUrl(sw.textureSha) : null;
      // A biome-variant swatch previews over its base biome's real texture.
      const baseThumb = sw.baseBiome !== undefined ? BIOME_THUMBS[sw.baseBiome] : BIOME_THUMBS[0];
      out.push({
        id: sw.id,
        label: sw.label ?? css,
        // A color swatch hue-tints the base grass texture, so its thumbnail
        // previews exactly that; an imported texture shows its own image.
        thumb: texUrl ? { url: texUrl } : { file: baseThumb?.file, tint: hexWithAlpha(css, 0.55) },
        group: gSwatches,
      });
    }
    // The built-in texture library: always-available default sets that ship
    // with the editor. One already materialized as a swatch is skipped (its
    // swatch row above covers it).
    const gLibrary = t('editor.biome.builtinGroup');
    for (const set of paintDefaultSets()) {
      const sha = builtinShaFor(set.key);
      if (swatches.some((sw) => sw.textureSha === sha)) continue;
      out.push({
        id: -1,
        label: set.name,
        thumb: { file: `${set.key}_Color.jpg` },
        builtinKey: set.key,
        group: gLibrary,
      });
    }
    // Erase rides along at the end with no group header (it is a mode, not a
    // texture) so the grid always offers a way to clear paint.
    out.push({ id: 255, label: t('editor.biome.erase'), thumb: { erase: true } });
    return out;
  }

  /** Small texture-set dropdown (the texturePicker look) for tools that pick a
   *  base texture: generated rocks and cave interiors. */
  private texSetPicker(
    parent: HTMLElement,
    label: string,
    options: { value: string; label: string; file?: string }[],
    activeValue: string,
    onPick: (value: string) => void,
  ): void {
    const wrap = el('div', 'ed-texpick-wrap');
    wrap.appendChild(el('span', 'ed-label', label));
    const active = options.find((o) => o.value === activeValue) ?? options[0];
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ed-texpick';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.append(
      this.textureThumb({ file: active.file }),
      el('span', 'ed-texpick-label', active.label),
      el('span', 'ed-texpick-caret', 'v'),
    );
    const menu = el('div', 'ed-texpick-menu');
    menu.setAttribute('role', 'listbox');
    menu.style.display = 'none';
    const closeOnOutside = (ev: PointerEvent): void => {
      if (!wrap.contains(ev.target as Node)) close();
    };
    const close = (): void => {
      menu.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', closeOnOutside, true);
    };
    trigger.addEventListener('click', () => {
      if (menu.style.display !== 'none') {
        close();
        return;
      }
      menu.style.display = '';
      trigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', closeOnOutside, true);
    });
    for (const opt of options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ed-texpick-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', opt.value === active.value ? 'true' : 'false');
      item.classList.toggle('active', opt.value === active.value);
      item.append(this.textureThumb({ file: opt.file }), el('span', 'ed-texpick-label', opt.label));
      item.addEventListener('click', () => {
        close();
        onPick(opt.value);
        this.refresh();
      });
      menu.appendChild(item);
    }
    wrap.append(trigger, menu);
    parent.appendChild(wrap);
  }

  /** The Rock tool's base-texture options: legacy procedural looks plus every
   *  built-in terrain texture set. */
  private rockTexOptions(): { value: string; label: string; file?: string }[] {
    return [
      { value: 'legacy:0', label: t('editor.rock.texStone') },
      { value: 'legacy:1', label: t('editor.rock.texSandstone') },
      { value: 'legacy:2', label: t('editor.rock.texBare') },
      ...TERRAIN_TEXTURE_SETS.map((s) => ({
        value: s.key,
        label: s.name,
        file: `${s.key}_Color.jpg`,
      })),
    ];
  }

  private textureThumb(opt: {
    file?: string;
    url?: string;
    tint?: string;
    erase?: boolean;
  }): HTMLElement {
    const th = el('span', 'ed-texthumb');
    if (opt.erase) th.classList.add('ed-biome-erase');
    else if (opt.url) th.style.backgroundImage = `url(${opt.url})`;
    else if (opt.file)
      th.style.backgroundImage = `url(${assetUrl(`textures/terrain/${opt.file}`)})`;
    if (opt.tint) {
      const overlay = el('span', 'ed-texthumb-tint');
      overlay.style.background = opt.tint;
      th.appendChild(overlay);
    }
    return th;
  }

  /** Texture selection: a trigger showing the active texture; clicking opens
   *  the full-screen gallery (openTextureGallery) where you browse every
   *  texture at a glance and Lock In the one to paint with. */
  private texturePicker(s: HTMLElement): void {
    const d = this.deps;
    const options = this.textureOptions();
    const active = options.find((o) => o.id === d.getPaintBiome()) ?? options[0];
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ed-texpick';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.title = t('editor.biome.pickTexture');
    trigger.append(
      this.textureThumb(active.thumb),
      el('span', 'ed-texpick-label', active.label),
      el('span', 'ed-texpick-caret', 'v'),
    );
    trigger.addEventListener('click', () => this.openTextureGallery());
    s.appendChild(trigger);
  }

  /** Full-screen texture gallery: a grid of every paintable texture grouped by
   *  Biomes / your swatches / Library. Clicking a tile tentatively selects it
   *  (nothing is applied to the map yet); Lock In commits, Cancel/Esc discards.
   *  Double-clicking a tile locks it in directly. */
  private openTextureGallery(): void {
    const d = this.deps;
    const options = this.textureOptions();
    const activeId = d.getPaintBiome();
    const activeIdx = options.findIndex((o) => o.id === activeId);
    // Tentative selection starts on whatever is painted right now.
    let pending = activeIdx >= 0 ? activeIdx : 0;

    const modal = buildModal(this.root, t('editor.biome.galleryTitle'), () => {});
    modal.panel.classList.add('ed-texgal');
    modal.panel.appendChild(hint(t('editor.biome.galleryHint')));

    const grid = el('div', 'ed-texgal-grid');
    const tiles: HTMLButtonElement[] = [];
    const footLabel = el('span', 'ed-texgal-sel');

    const commit = (): void => {
      const opt = options[pending];
      modal.close();
      if (opt.builtinKey) d.pickBuiltinTexture(opt.builtinKey);
      else d.setPaintBiome(opt.id);
      this.refresh();
    };
    const highlight = (): void => {
      for (let i = 0; i < tiles.length; i++) {
        tiles[i].classList.toggle('selected', i === pending);
        tiles[i].setAttribute('aria-selected', i === pending ? 'true' : 'false');
      }
      footLabel.textContent = options[pending]?.label ?? '';
    };

    let lastGroup: string | undefined;
    let groupItems: HTMLElement | null = null;
    options.forEach((opt, i) => {
      if (!groupItems || (opt.group !== undefined && opt.group !== lastGroup)) {
        lastGroup = opt.group;
        if (opt.group) grid.appendChild(el('h3', 'ed-texgal-group', opt.group));
        groupItems = el('div', 'ed-texgal-items');
        grid.appendChild(groupItems);
      }
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'ed-texgal-tile';
      tile.setAttribute('role', 'option');
      const thumb = this.textureThumb(opt.thumb);
      thumb.classList.add('ed-texgal-thumb');
      tile.append(thumb, el('span', 'ed-texgal-name', opt.label));
      // The texture already painted on the map gets a persistent "Current" badge.
      if (opt.id === activeId && i === activeIdx)
        tile.appendChild(el('span', 'ed-texgal-cur', t('editor.biome.galleryCurrent')));
      tile.addEventListener('click', () => {
        pending = i;
        highlight();
      });
      tile.addEventListener('dblclick', () => {
        pending = i;
        commit();
      });
      groupItems.appendChild(tile);
      tiles[i] = tile;
    });
    modal.panel.appendChild(grid);

    const foot = el('div', 'ed-texgal-foot');
    const count = el(
      'span',
      'ed-texgal-count',
      t('editor.biome.galleryCount', { n: String(tiles.length) }),
    );
    const actions = el('div', 'ed-modal-actions');
    const cancel = button(t('editor.confirm.cancel'), () => modal.close());
    const lockIn = button(t('editor.biome.galleryLockIn'), commit, 'primary');
    actions.append(cancel, lockIn);
    foot.append(count, footLabel, actions);
    modal.panel.appendChild(foot);

    // Enter locks in the tentative pick (Esc/backdrop close via buildModal).
    modal.panel.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commit();
      }
    });
    highlight();
    lockIn.focus();
  }

  /** Per-map auto-texturing rules (paint always wins over the enabled ones). */
  private terrainStyleControls(s: HTMLElement): void {
    const d = this.deps;
    const style = d.getTerrainStyle();
    s.appendChild(el('h3', 'ed-subtitle', t('editor.biome.autoTitle')));
    s.appendChild(
      checkbox(t('editor.biome.autoSlopeRock'), style.slopeRock, (on) =>
        d.setTerrainStyle({ slopeRock: on }),
      ).root,
    );
    s.appendChild(
      checkbox(t('editor.biome.autoScree'), style.scree, (on) => d.setTerrainStyle({ scree: on }))
        .root,
    );
    s.appendChild(
      checkbox(t('editor.biome.autoSnowCaps'), style.snowCaps, (on) =>
        d.setTerrainStyle({ snowCaps: on }),
      ).root,
    );
    s.appendChild(
      checkbox(t('editor.biome.autoRim'), style.rimMountains, (on) =>
        d.setTerrainStyle({ rimMountains: on }),
      ).root,
    );
    s.appendChild(
      checkbox(t('editor.biome.autoShoreSand'), style.shoreSand, (on) =>
        d.setTerrainStyle({ shoreSand: on }),
      ).root,
    );
    // One click for "let me just paint": the rules are applied under the paint
    // layers, so a maker covering a cliff watches the slope rule put the rock
    // straight back (SPACEY, 2026-09-21). Unchecking five boxes to get there is
    // the wrong amount of work for the commonest intent.
    s.appendChild(
      button(
        t('editor.biome.autoAllOff'),
        () =>
          d.setTerrainStyle({
            slopeRock: false,
            scree: false,
            snowCaps: false,
            rimMountains: false,
            shoreSand: false,
          }),
        'ed-btn',
        t('editor.biome.autoAllOffTitle'),
      ),
    );
    s.appendChild(hint(t('editor.biome.autoHint')));
  }

  private waterPanel(): void {
    const d = this.deps;
    const s = section(t('editor.water.title'));
    s.appendChild(
      slider(t('editor.water.level'), {
        min: MIN_WATER_LEVEL,
        max: MAX_WATER_LEVEL,
        step: 0.5,
        value: d.getWaterLevel(),
        onInput: (v) => d.previewWaterLevel(v),
        onChange: (v) => d.commitWaterLevel(v),
        format: num1,
      }).root,
    );
    s.appendChild(
      hint(
        t('editor.water.hint', {
          min: num1(MIN_WATER_LEVEL),
          max: num1(MAX_WATER_LEVEL),
        }),
      ),
    );
    s.appendChild(
      button(
        t('editor.water.reset'),
        () => {
          d.resetWaterLevel();
          this.refresh();
        },
        'small',
      ),
    );
    s.appendChild(
      button(
        t('editor.brush.reapplyWater'),
        () => d.reapplyWater(),
        'small',
        t('editor.brush.reapplyWaterTitle'),
      ),
    );
    {
      // Map-wide water tint: hue + lightness, the grass-slider authoring model.
      const tint = d.getWaterTint();
      const hue = tint.hue ?? 205;
      const lumPct = Math.round((tint.lum ?? 0.45) * 100);
      s.appendChild(el('h3', 'ed-subtitle', t('editor.water.tintTitle')));
      s.appendChild(
        slider(t('editor.water.hue'), {
          min: 0,
          max: 360,
          step: 1,
          value: hue,
          onInput: (v) => d.previewWaterTint(v, d.getWaterTint().lum),
          onChange: (v) => d.commitWaterTint(v, d.getWaterTint().lum),
          format: num1,
        }).root,
      );
      s.appendChild(
        slider(t('editor.water.light'), {
          min: 5,
          max: 90,
          step: 1,
          value: lumPct,
          onInput: (v) => d.previewWaterTint(d.getWaterTint().hue, v / 100),
          onChange: (v) => d.commitWaterTint(d.getWaterTint().hue, v / 100),
          format: num1,
        }).root,
      );
      s.appendChild(
        button(
          t('editor.water.tintReset'),
          () => {
            d.resetWaterTint();
            this.refresh();
          },
          'small',
        ),
      );
    }
    s.appendChild(el('h3', 'ed-subtitle', t('editor.water.waterfallTitle')));
    s.appendChild(
      button(
        t('editor.water.placeWaterfall'),
        () => d.placeWaterfall(),
        'small',
        t('editor.water.placeWaterfallTitle'),
      ),
    );
    s.appendChild(hint(t('editor.water.waterfallHint')));
    this.root.appendChild(s);
  }

  private placePanel(): void {
    const d = this.deps;
    const s = section(t('editor.place.title'));
    const label = d.getPlaceAssetLabel();
    s.appendChild(
      label
        ? el('p', 'ed-chosen', t('editor.place.chosen', { name: label }))
        : hint(t('editor.place.none')),
    );
    s.appendChild(
      slider(t('editor.place.scale'), {
        min: PLACEMENT_SCALE_MIN,
        max: PLACEMENT_SCALE_MAX,
        step: 0.1,
        value: d.getPlaceScale(),
        onInput: (v) => d.setPlaceScale(v),
        format: num1,
      }).root,
    );
    s.appendChild(
      checkbox(t('editor.place.collide'), d.getPlaceCollide(), (on) => d.setPlaceCollide(on)).root,
    );
    s.appendChild(hint(t('editor.place.collideHint')));
    s.appendChild(
      checkbox(t('editor.place.randomRotation'), d.getPlaceRandomRot(), (on) =>
        d.setPlaceRandomRot(on),
      ).root,
    );
    this.root.appendChild(s);
  }

  private campPanel(): void {
    const d = this.deps;
    const s = section(t('editor.camp.title'));
    s.appendChild(hint(t('editor.camp.hint')));
    s.appendChild(hint(t('editor.camp.playtestNote')));
    const camp = d.getSelectedCamp();
    if (!camp) {
      s.appendChild(el('p', 'ed-muted', t('editor.camp.none')));
      this.root.appendChild(s);
      return;
    }
    const mobs = d.mobOptions();
    const chosen = mobs.find((m) => m.id === camp.mobId);
    s.appendChild(
      el('p', 'ed-chosen', t('editor.camp.selected', { mob: chosen?.label ?? camp.mobId })),
    );
    s.appendChild(
      catalogPicker({
        label: t('editor.camp.mob'),
        title: t('editor.camp.chooseMob'),
        currentId: camp.mobId,
        currentLabel: chosen?.label ?? camp.mobId,
        rows: mobs.map((mob) => ({
          id: mob.id,
          title: mob.label,
          meta: t('editor.camp.catalogMeta', {
            family: mob.family,
            min: mob.minLevel,
            max: mob.maxLevel,
          }),
          group: mob.family,
          keywords: [mob.id, ...mob.mechanics],
          badges: mob.mechanics.map((tag) => this.mobTagLabel(tag)),
        })),
        onPick: (mobId) => {
          d.updateCamp({ mobId, levelMin: null, levelMax: null });
          this.refresh();
        },
      }),
    );
    if (chosen) {
      const stats = el('div', 'ed-author-stats');
      stats.append(
        el('span', undefined, t('editor.camp.statFamily', { value: chosen.family })),
        el('span', undefined, t('editor.camp.statAggro', { value: num1(chosen.aggroRadius) })),
        el('span', undefined, t('editor.camp.statScale', { value: num1(chosen.scale) })),
      );
      s.appendChild(stats);
    }
    s.appendChild(
      slider(t('editor.camp.count'), {
        min: 1,
        max: MAX_CAMP_COUNT,
        step: 1,
        value: camp.count,
        onInput: () => {},
        onChange: (v) => d.updateCamp({ count: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.camp.radius'), {
        min: 1,
        max: MAX_CAMP_RADIUS,
        step: 1,
        value: camp.radius,
        onInput: () => {},
        onChange: (v) => d.updateCamp({ radius: v }),
        format: num1,
      }).root,
    );
    const levelOverride = camp.levelMin !== null || camp.levelMax !== null;
    s.appendChild(
      checkbox(t('editor.camp.overrideLevels'), levelOverride, (on) => {
        d.updateCamp(
          on
            ? {
                levelMin: chosen?.minLevel ?? 1,
                levelMax: chosen?.maxLevel ?? chosen?.minLevel ?? 1,
              }
            : { levelMin: null, levelMax: null },
        );
        this.refresh();
      }).root,
    );
    if (levelOverride) {
      const minLevel = camp.levelMin ?? chosen?.minLevel ?? 1;
      const maxLevel = camp.levelMax ?? chosen?.maxLevel ?? minLevel;
      s.appendChild(
        slider(t('editor.camp.levelMin'), {
          min: 1,
          max: 80,
          step: 1,
          value: minLevel,
          onInput: () => {},
          onChange: (levelMin) =>
            d.updateCamp({ levelMin, levelMax: Math.max(levelMin, maxLevel) }),
          format: num1,
        }).root,
      );
      s.appendChild(
        slider(t('editor.camp.levelMax'), {
          min: 1,
          max: 80,
          step: 1,
          value: maxLevel,
          onInput: () => {},
          onChange: (levelMax) =>
            d.updateCamp({ levelMin: Math.min(minLevel, levelMax), levelMax }),
          format: num1,
        }).root,
      );
    }
    s.appendChild(
      this.authorVfxControls(camp.authorVfx, (authorVfx) => d.updateCamp({ authorVfx })),
    );
    const notes = el('div', 'ed-author-subpanel');
    notes.appendChild(el('h3', undefined, t('editor.authoring.aiBrief')));
    notes.appendChild(
      authorTextField(
        t('editor.authoring.aiNotes'),
        camp.aiNotes,
        (aiNotes) => d.updateCamp({ aiNotes }),
        { multiline: true, placeholder: t('editor.camp.aiNotesPlaceholder') },
      ),
    );
    notes.appendChild(
      authorTextField(
        t('editor.authoring.questNotes'),
        camp.questNotes,
        (questNotes) => d.updateCamp({ questNotes }),
        { multiline: true, placeholder: t('editor.camp.questNotesPlaceholder') },
      ),
    );
    s.appendChild(notes);
    s.appendChild(
      button(
        t('editor.camp.delete'),
        () => {
          d.deleteCamp();
          this.refresh();
        },
        'danger small',
      ),
    );
    this.root.appendChild(s);
  }

  private spawnPanel(): void {
    const d = this.deps;
    const s = section(t('editor.spawn.title'));
    s.appendChild(hint(t('editor.spawn.hint')));
    const spawn = d.getSpawn();
    const area = d.getSpawnArea();
    if (area) {
      s.appendChild(
        el(
          'p',
          'ed-chosen',
          t('editor.spawn.area', {
            width: num1(area.maxX - area.minX),
            height: num1(area.maxZ - area.minZ),
          }),
        ),
      );
    }
    if (spawn) {
      s.appendChild(
        el('p', 'ed-chosen', t('editor.spawn.position', { x: num1(spawn.x), z: num1(spawn.z) })),
      );
      s.appendChild(
        button(
          t('editor.spawn.clear'),
          () => {
            d.clearSpawn();
            this.refresh();
          },
          'small',
        ),
      );
    } else {
      s.appendChild(el('p', 'ed-muted', t('editor.spawn.unset')));
    }
    this.root.appendChild(s);
  }

  private entityPanel(): void {
    const s = section(t('editor.entityTool.title'));
    s.appendChild(hint(t('editor.entityTool.hint')));
    const visuals = this.deps.npcVisualOptions();
    const placingKey = this.deps.getNpcPlacement();
    const placing = visuals.find((visual) => visual.key === placingKey);
    s.appendChild(
      catalogPicker({
        label: t('editor.entityTool.placeNpc'),
        title: t('editor.entityTool.chooseNpcModel'),
        currentId: placingKey ?? '',
        currentLabel: placing?.label ?? t('editor.entityTool.chooseNpcModel'),
        rows: visuals.map((visual) => ({
          id: visual.key,
          title: visual.label,
          meta: visual.key,
          group: this.visualCategoryLabel(visual.category),
          keywords: [visual.key, visual.category],
        })),
        onPick: (visualKey) => {
          this.deps.beginNpcPlacement(visualKey);
          this.refresh();
        },
      }),
    );
    if (placingKey) {
      s.appendChild(
        hint(t('editor.entityTool.placeNpcHint', { name: placing?.label ?? placingKey })),
      );
      s.appendChild(
        button(
          t('editor.entityTool.cancelPlacement'),
          () => {
            this.deps.cancelNpcPlacement();
            this.refresh();
          },
          'small',
        ),
      );
    }
    const selected = this.deps.getSelectedMovableEntity();
    s.appendChild(
      selected
        ? el('p', 'ed-chosen', t('editor.entityTool.selected', { name: selected.name }))
        : el('p', 'ed-muted', t('editor.entityTool.none')),
    );
    if (!selected) {
      this.root.appendChild(s);
      return;
    }
    if (selected.kind === 'mobs') {
      this.mobToolControls(s);
      this.root.appendChild(s);
      return;
    }
    if (selected?.facing !== null && selected?.facing !== undefined) {
      s.appendChild(
        slider(t('editor.entityTool.facing'), {
          min: 0,
          max: 359,
          step: 1,
          value: Math.round(
            (((selected.facing % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * (180 / Math.PI),
          ),
          onInput: (degrees) =>
            this.deps.updateMovableEntityFacing(selected.key, (degrees * Math.PI) / 180, false),
          onChange: (degrees) =>
            this.deps.updateMovableEntityFacing(selected.key, (degrees * Math.PI) / 180, true),
          format: (degrees) =>
            `${formatNumber(Math.round(degrees), {
              useGrouping: false,
              maximumFractionDigits: 0,
            })}°`,
        }).root,
      );
    }
    s.appendChild(
      authorTextField(
        t('editor.entityTool.name'),
        selected.name,
        (name) => {
          if (name) this.deps.updateSelectedNpc({ name });
          this.refresh();
        },
        { maxLength: 60 },
      ),
    );
    s.appendChild(
      authorTextField(
        t('editor.entityTool.titleField'),
        selected.title,
        (title) => {
          this.deps.updateSelectedNpc({ title });
        },
        { maxLength: 60 },
      ),
    );
    s.appendChild(
      authorTextField(
        t('editor.entityTool.role'),
        selected.authorRole,
        (authorRole) => {
          this.deps.updateSelectedNpc({ authorRole });
        },
        { maxLength: 60, placeholder: t('editor.entityTool.rolePlaceholder') },
      ),
    );
    const currentVisual = visuals.find((option) => option.key === selected.visualKey);
    s.appendChild(
      catalogPicker({
        label: t('editor.entityTool.characterModel'),
        title: t('editor.entityTool.chooseNpcModel'),
        currentId: selected.visualKey ?? '',
        currentLabel: currentVisual?.label ?? t('editor.entityTool.automaticModel'),
        rows: [
          {
            id: '',
            title: t('editor.entityTool.automaticModel'),
            meta: t('editor.entityTool.automaticModelHint'),
            group: t('editor.authoring.defaults'),
            keywords: ['automatic', 'default'],
          },
          ...visuals.map((visual) => ({
            id: visual.key,
            title: visual.label,
            meta: visual.key,
            group: this.visualCategoryLabel(visual.category),
            keywords: [visual.key, visual.category],
          })),
        ],
        onPick: (visualKey) => {
          this.deps.updateSelectedNpc({ visualKey: visualKey || null });
          this.refresh();
        },
      }),
    );
    // NPCs walk the same authored waypoint routes camp mobs do.
    s.appendChild(
      this.mobPatrolControls(selected.route, {
        setMode: (routeMode) => this.deps.updateSelectedNpcRoute({ routeMode }),
        setSpeed: (routeSpeed) => this.deps.updateSelectedNpcRoute({ routeSpeed }),
        clear: () => this.deps.updateSelectedNpcRoute({ clearRoute: true }),
        emptyHintKey: 'editor.mobTool.patrolNoneNpc',
      }),
    );
    s.appendChild(
      this.authorVfxControls(selected.authorVfx, (authorVfx) =>
        this.deps.updateSelectedNpc({ authorVfx }),
      ),
    );
    const notes = el('div', 'ed-author-subpanel');
    notes.appendChild(el('h3', undefined, t('editor.authoring.aiBrief')));
    notes.appendChild(
      authorTextField(
        t('editor.authoring.aiNotes'),
        selected.aiNotes,
        (aiNotes) => this.deps.updateSelectedNpc({ aiNotes }),
        { multiline: true, placeholder: t('editor.entityTool.aiNotesPlaceholder') },
      ),
    );
    notes.appendChild(
      authorTextField(
        t('editor.authoring.questNotes'),
        selected.questNotes,
        (questNotes) => this.deps.updateSelectedNpc({ questNotes }),
        { multiline: true, placeholder: t('editor.entityTool.questNotesPlaceholder') },
      ),
    );
    s.appendChild(notes);
    s.appendChild(
      button(
        selected.count > 1
          ? t('editor.mobTool.deleteManyNpcs', { count: selected.count })
          : t('editor.mobTool.deleteNpc'),
        () => {
          this.deps.deleteSelectedNpcs();
          this.refresh();
        },
        'danger small',
      ),
    );
    this.root.appendChild(s);
  }

  /**
   * The Mob tool's editor for whatever mobs are picked in the viewport: which
   * template they are, their level band, stat multipliers, respawn pacing, a
   * click-authored patrol route, and delete. Every control writes through to
   * EVERY selected mob (each one is backed by its own one-mob camp).
   */
  private mobToolControls(s: HTMLElement): void {
    const d = this.deps;
    const mob = d.getSelectedMobs();
    if (!mob) {
      s.appendChild(hint(t('editor.mobTool.hint')));
      return;
    }
    const catalog = d.mobOptions();
    const template = mob.mobId ? catalog.find((option) => option.id === mob.mobId) : undefined;

    // --- identity -------------------------------------------------------------
    const header = el('div', 'ed-author-subpanel');
    header.appendChild(
      el(
        'h3',
        undefined,
        mob.count > 1
          ? t('editor.mobTool.typeHeaderMany', { name: mob.label, count: mob.count })
          : t('editor.mobTool.typeHeader', { name: mob.label }),
      ),
    );
    if (template) {
      const stats = el('div', 'ed-author-stats');
      stats.append(
        el('span', undefined, t('editor.camp.statFamily', { value: template.family })),
        el(
          'span',
          undefined,
          t('editor.mobTool.statLevels', { min: template.minLevel, max: template.maxLevel }),
        ),
        el('span', undefined, t('editor.camp.statAggro', { value: num1(template.aggroRadius) })),
        el('span', undefined, t('editor.camp.statScale', { value: num1(template.scale) })),
      );
      header.appendChild(stats);
      if (template.mechanics.length > 0) {
        const badges = el('div', 'ed-author-stats');
        for (const tag of template.mechanics) {
          badges.appendChild(el('span', undefined, this.mobTagLabel(tag)));
        }
        header.appendChild(badges);
      }
    }
    if (mob.mixed) header.appendChild(hint(t('editor.mobTool.mixedHint')));
    s.appendChild(header);
    s.appendChild(
      catalogPicker({
        label: t('editor.mobTool.type'),
        title: t('editor.camp.chooseMob'),
        currentId: mob.mobId ?? '',
        currentLabel: mob.label,
        rows: catalog.map((option) => ({
          id: option.id,
          title: option.label,
          meta: t('editor.camp.catalogMeta', {
            family: option.family,
            min: option.minLevel,
            max: option.maxLevel,
          }),
          group: option.family,
          keywords: [option.id, ...option.mechanics],
          badges: option.mechanics.map((tag) => this.mobTagLabel(tag)),
        })),
        onPick: (mobId) => {
          d.updateSelectedMobs({ mobId, levelMin: null, levelMax: null });
          this.refresh();
        },
      }),
    );

    // --- level ----------------------------------------------------------------
    const levelOverride = mob.levelMin !== null || mob.levelMax !== null;
    s.appendChild(
      checkbox(t('editor.mobTool.overrideLevels'), levelOverride, (on) => {
        d.updateSelectedMobs(
          on
            ? {
                levelMin: template?.minLevel ?? 1,
                levelMax: template?.maxLevel ?? template?.minLevel ?? 1,
              }
            : { levelMin: null, levelMax: null },
        );
        this.refresh();
      }).root,
    );
    if (levelOverride) {
      const minLevel = mob.levelMin ?? template?.minLevel ?? 1;
      const maxLevel = mob.levelMax ?? template?.maxLevel ?? minLevel;
      s.appendChild(
        slider(t('editor.camp.levelMin'), {
          min: 1,
          max: MAX_AUTHORED_CAMP_LEVEL,
          step: 1,
          value: minLevel,
          onInput: () => {},
          onChange: (levelMin) =>
            d.updateSelectedMobs({ levelMin, levelMax: Math.max(levelMin, maxLevel) }),
          format: num1,
        }).root,
      );
      s.appendChild(
        slider(t('editor.camp.levelMax'), {
          min: 1,
          max: MAX_AUTHORED_CAMP_LEVEL,
          step: 1,
          value: maxLevel,
          onInput: () => {},
          onChange: (levelMax) =>
            d.updateSelectedMobs({ levelMin: Math.min(minLevel, levelMax), levelMax }),
          format: num1,
        }).root,
      );
    } else {
      s.appendChild(hint(t('editor.mobTool.levelDefaultHint')));
    }

    // --- stat modifiers -------------------------------------------------------
    s.appendChild(this.mobStatModControls(mob));

    // --- respawn --------------------------------------------------------------
    const respawn = el('div', 'ed-author-subpanel');
    respawn.appendChild(el('h3', undefined, t('editor.mobTool.respawnTitle')));
    respawn.appendChild(
      checkbox(t('editor.mobTool.respawnDefault'), mob.respawnSeconds === null, (on) => {
        d.updateSelectedMobs({ respawnSeconds: on ? null : DEFAULT_MOB_RESPAWN_SECONDS });
        this.refresh();
      }).root,
    );
    if (mob.respawnSeconds === null) {
      respawn.appendChild(hint(t('editor.mobTool.respawnDefaultHint')));
    } else {
      respawn.appendChild(
        slider(t('editor.mobTool.respawnSeconds'), {
          min: MIN_CAMP_RESPAWN_SECONDS,
          max: MAX_CAMP_RESPAWN_SECONDS,
          step: 1,
          value: mob.respawnSeconds,
          onInput: () => {},
          onChange: (respawnSeconds) => d.updateSelectedMobs({ respawnSeconds }),
          format: (value) => t('editor.mobTool.seconds', { value: num1(value) }),
        }).root,
      );
    }
    s.appendChild(respawn);

    // --- patrol ---------------------------------------------------------------
    s.appendChild(
      this.mobPatrolControls(mob.route, {
        setMode: (routeMode) => d.updateSelectedMobs({ routeMode }),
        setSpeed: (routeSpeed) => d.updateSelectedMobs({ routeSpeed }),
        clear: () => d.updateSelectedMobs({ clearRoute: true }),
        emptyHintKey: 'editor.mobTool.patrolNone',
      }),
    );

    // --- presentation + delete ------------------------------------------------
    s.appendChild(
      this.authorVfxControls(mob.authorVfx, (authorVfx) => d.updateSelectedMobs({ authorVfx })),
    );
    const notes = el('div', 'ed-author-subpanel');
    notes.appendChild(el('h3', undefined, t('editor.authoring.aiBrief')));
    notes.appendChild(
      authorTextField(
        t('editor.authoring.aiNotes'),
        mob.aiNotes,
        (aiNotes) => d.updateSelectedMobs({ aiNotes }),
        { multiline: true, placeholder: t('editor.camp.aiNotesPlaceholder') },
      ),
    );
    notes.appendChild(
      authorTextField(
        t('editor.authoring.questNotes'),
        mob.questNotes,
        (questNotes) => d.updateSelectedMobs({ questNotes }),
        { multiline: true, placeholder: t('editor.camp.questNotesPlaceholder') },
      ),
    );
    s.appendChild(notes);
    s.appendChild(
      button(
        mob.count > 1
          ? t('editor.mobTool.deleteMany', { count: mob.count })
          : t('editor.mobTool.delete'),
        () => {
          d.deleteSelectedMobs();
          this.refresh();
        },
        'danger small',
      ),
    );
  }

  /** The x-multiplier stack: bonuses above 1, penalties below it. */
  private mobStatModControls(mob: MobToolSelection): HTMLElement {
    const d = this.deps;
    const panel = el('div', 'ed-author-subpanel');
    panel.appendChild(el('h3', undefined, t('editor.mobTool.statsTitle')));
    panel.appendChild(hint(t('editor.mobTool.statsHint')));
    const rows: { key: keyof CampStatMods; label: string }[] = [
      { key: 'health', label: t('editor.mobTool.statHealth') },
      { key: 'damage', label: t('editor.mobTool.statDamage') },
      { key: 'armor', label: t('editor.mobTool.statArmor') },
      { key: 'moveSpeed', label: t('editor.mobTool.statMoveSpeed') },
      { key: 'attackSpeed', label: t('editor.mobTool.statAttackSpeed') },
      { key: 'scale', label: t('editor.mobTool.statScale') },
    ];
    for (const row of rows) {
      panel.appendChild(
        slider(row.label, {
          min: MOB_STAT_MOD_MIN,
          max: MOB_STAT_MOD_MAX,
          step: 0.05,
          value: mob.statMods[row.key],
          onInput: () => {},
          onChange: (value) => {
            d.updateSelectedMobs({ statMods: { [row.key]: value } });
            this.refresh();
          },
          format: mobStatModLabel,
        }).root,
      );
    }
    const stock = rows.every((row) => mob.statMods[row.key] === 1);
    if (!stock) {
      panel.appendChild(
        button(
          t('editor.mobTool.statsReset'),
          () => {
            d.updateSelectedMobs({
              statMods: {
                health: 1,
                damage: 1,
                armor: 1,
                moveSpeed: 1,
                attackSpeed: 1,
                scale: 1,
              },
            });
            this.refresh();
          },
          'small',
        ),
      );
    }
    return panel;
  }

  /**
   * Patrol route: pick waypoints in the viewport, then tune how they're walked.
   * Shared by the mob and NPC arms of the Mob tool; only the commit callbacks
   * differ (a mob's route lives on its camp, an NPC's on its own def).
   */
  private mobPatrolControls(
    route: PatrolSummary | null,
    commit: {
      setMode: (mode: 'loop' | 'pingpong') => void;
      setSpeed: (speed: number) => void;
      clear: () => void;
      /** Copy for the "no route yet" line: mobs wander, NPCs stand still. */
      emptyHintKey: 'editor.mobTool.patrolNone' | 'editor.mobTool.patrolNoneNpc';
    },
  ): HTMLElement {
    const d = this.deps;
    const panel = el('div', 'ed-author-subpanel');
    panel.appendChild(el('h3', undefined, t('editor.mobTool.patrolTitle')));
    const draft = d.getMobRouteDraft();
    if (draft) {
      // Picking mode: the viewport is claimed by waypoint clicks until the
      // maker finishes (or double-clicks the last point) or cancels.
      panel.appendChild(hint(t('editor.mobTool.patrolPickHint')));
      panel.appendChild(
        el('p', 'ed-chosen', t('editor.mobTool.patrolDraftPoints', { count: draft.points })),
      );
      panel.appendChild(
        selectRow(
          t('editor.mobTool.patrolMode'),
          [
            { value: 'loop', label: t('editor.mobTool.patrolLoop') },
            { value: 'pingpong', label: t('editor.mobTool.patrolPingpong') },
          ],
          draft.mode,
          (mode) => d.setMobRouteDraft({ mode: mode === 'pingpong' ? 'pingpong' : 'loop' }),
        ).root,
      );
      panel.appendChild(
        slider(t('editor.mobTool.patrolSpeed'), {
          min: NPC_ROUTE_SPEED_MIN,
          max: NPC_ROUTE_SPEED_MAX,
          step: 0.1,
          value: draft.speed,
          onInput: () => {},
          onChange: (speed) => d.setMobRouteDraft({ speed }),
          format: (value) => t('editor.mobTool.yardsPerSecond', { value: num1(value) }),
        }).root,
      );
      panel.appendChild(
        slider(t('editor.mobTool.patrolWait'), {
          min: 0,
          max: 60,
          step: 1,
          value: draft.wait,
          onInput: () => {},
          onChange: (wait) => d.setMobRouteDraft({ wait }),
          format: (value) => t('editor.mobTool.seconds', { value: num1(value) }),
        }).root,
      );
      panel.appendChild(hint(t('editor.mobTool.patrolWaitHint')));
      const row = el('div', 'ed-row');
      row.append(
        button(t('editor.mobTool.patrolFinish'), () => {
          d.finishMobRoute();
          this.refresh();
        }),
        button(t('editor.mobTool.patrolUndoPoint'), () => {
          d.undoMobRoutePoint();
          this.refresh();
        }),
        button(t('editor.mobTool.patrolCancel'), () => {
          d.cancelMobRoute();
          this.refresh();
        }),
      );
      panel.appendChild(row);
      return panel;
    }
    if (!route) {
      panel.appendChild(hint(t(commit.emptyHintKey)));
      panel.appendChild(
        button(t('editor.mobTool.patrolSet'), () => {
          d.beginMobRoute();
          this.refresh();
        }),
      );
      return panel;
    }
    panel.appendChild(
      el('p', 'ed-chosen', t('editor.mobTool.patrolPoints', { count: route.points })),
    );
    panel.appendChild(
      selectRow(
        t('editor.mobTool.patrolMode'),
        [
          { value: 'loop', label: t('editor.mobTool.patrolLoop') },
          { value: 'pingpong', label: t('editor.mobTool.patrolPingpong') },
        ],
        route.mode,
        (mode) => {
          commit.setMode(mode === 'pingpong' ? 'pingpong' : 'loop');
          this.refresh();
        },
      ).root,
    );
    panel.appendChild(
      slider(t('editor.mobTool.patrolSpeed'), {
        min: NPC_ROUTE_SPEED_MIN,
        max: NPC_ROUTE_SPEED_MAX,
        step: 0.1,
        value: route.speed,
        onInput: () => {},
        onChange: (speed) => commit.setSpeed(speed),
        format: (value) => t('editor.mobTool.yardsPerSecond', { value: num1(value) }),
      }).root,
    );
    const row = el('div', 'ed-row');
    row.append(
      button(t('editor.mobTool.patrolEdit'), () => {
        d.beginMobRoute();
        this.refresh();
      }),
      button(
        t('editor.mobTool.patrolClear'),
        () => {
          commit.clear();
          this.refresh();
        },
        'small',
      ),
    );
    panel.appendChild(row);
    return panel;
  }

  private authorVfxControls(
    current: AuthorVfx | null,
    onChange: (value: AuthorVfx | null) => void,
  ): HTMLElement {
    const panel = el('div', 'ed-author-subpanel');
    panel.appendChild(el('h3', undefined, t('editor.authoring.vfxTitle')));
    const row = el('label', 'ed-field');
    row.appendChild(el('span', undefined, t('editor.authoring.vfxPreset')));
    const select = document.createElement('select');
    const choices: { value: AuthorVfx['preset'] | ''; label: string }[] = [
      { value: '', label: t('editor.authoring.vfxNone') },
      { value: 'arcane', label: t('editor.authoring.vfxArcane') },
      { value: 'fire', label: t('editor.authoring.vfxFire') },
      { value: 'frost', label: t('editor.authoring.vfxFrost') },
      { value: 'holy', label: t('editor.authoring.vfxHoly') },
      { value: 'nature', label: t('editor.authoring.vfxNature') },
      { value: 'shadow', label: t('editor.authoring.vfxShadow') },
    ];
    for (const choice of choices) {
      const option = document.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      select.appendChild(option);
    }
    select.value = current?.preset ?? '';
    select.addEventListener('change', () => {
      onChange(
        select.value
          ? { preset: select.value as AuthorVfx['preset'], intensity: current?.intensity ?? 1 }
          : null,
      );
      this.refresh();
    });
    row.appendChild(select);
    panel.appendChild(row);
    if (current) {
      panel.appendChild(
        slider(t('editor.authoring.vfxIntensity'), {
          min: 0.25,
          max: 3,
          step: 0.25,
          value: current.intensity,
          onInput: () => {},
          onChange: (intensity) => onChange({ ...current, intensity }),
          format: num1,
        }).root,
      );
    }
    panel.appendChild(hint(t('editor.authoring.vfxHint')));
    return panel;
  }

  private mobTagLabel(tag: string): string {
    switch (tag) {
      case 'elite':
        return t('editor.camp.tagElite');
      case 'rare':
        return t('editor.camp.tagRare');
      case 'boss':
        return t('editor.camp.tagBoss');
      case 'caster':
        return t('editor.camp.tagCaster');
      case 'support':
        return t('editor.camp.tagSupport');
      case 'summoner':
        return t('editor.camp.tagSummoner');
      case 'enrage':
        return t('editor.camp.tagEnrage');
      case 'swimmer':
        return t('editor.camp.tagSwimmer');
      case 'stationary':
        return t('editor.camp.tagStationary');
      default:
        return tag;
    }
  }

  private visualCategoryLabel(category: CharacterVisualOption['category']): string {
    switch (category) {
      case 'npc':
        return t('editor.entityTool.categoryNpc');
      case 'player':
        return t('editor.entityTool.categoryPlayer');
      case 'humanoid':
        return t('editor.entityTool.categoryHumanoid');
      case 'creature':
        return t('editor.entityTool.categoryCreature');
      case 'form':
        return t('editor.entityTool.categoryForm');
    }
  }

  private regionPanel(): void {
    const d = this.deps;
    const s = section(t('editor.region.title'));
    s.appendChild(hint(t('editor.region.hint')));
    if (d.getViewMode() === '3d') s.appendChild(hint(t('editor.region.hint3d')));
    const row = el('div', 'ed-row');
    row.append(
      button(t('editor.region.copy'), () => d.copyRegion()),
      button(t('editor.region.pasteBeside'), () => d.pasteBeside()),
    );
    s.appendChild(row);
    this.root.appendChild(s);
  }

  private erasePanel(): void {
    const s = section(t('editor.eraseTool.title'));
    s.appendChild(hint(t('editor.eraseTool.hint')));
    s.appendChild(hint(t('editor.eraseTool.blockerHint')));
    this.root.appendChild(s);
  }

  private grassClearPanel(): void {
    const d = this.deps;
    const s = section(t('editor.grassClearTool.title'));
    s.appendChild(hint(t('editor.grassClearTool.hint')));
    if (d.hasClearedGrass()) {
      s.appendChild(button(t('editor.grassClearTool.restore'), () => d.restoreAllGrass(), 'small'));
    }
    this.root.appendChild(s);
  }

  private foliagePanel(): void {
    const d = this.deps;
    const f = d.getFoliage();
    const s = section(t('editor.foliageTool.title'));
    s.appendChild(hint(t('editor.foliageTool.hint')));

    s.appendChild(el('h4', 'ed-sub-title', t('editor.foliageTool.ambientTitle')));
    if (d.hasAmbientFoliage()) {
      s.appendChild(hint(t('editor.foliageTool.ambientHint')));
      s.appendChild(
        button(
          t('editor.foliageTool.makeZoneEditable'),
          () => d.makeAmbientFoliageEditable('zone'),
          'small',
        ),
      );
      s.appendChild(hint(t('editor.foliageTool.makeZoneEditableHint')));
      s.appendChild(
        button(
          t('editor.foliageTool.makeAmbientEditable'),
          () => d.makeAmbientFoliageEditable('batch'),
          'small',
        ),
      );
      s.appendChild(
        button(
          t('editor.foliageTool.makeAllAmbientEditable'),
          () => d.makeAmbientFoliageEditable('all'),
          'small',
        ),
      );
      s.appendChild(hint(t('editor.foliageTool.ambientAllHint')));
    } else {
      s.appendChild(hint(t('editor.foliageTool.ambientEditableHint')));
    }

    // ---- custom brush asset (scatter a chosen asset instead of the groups) ---
    s.appendChild(el('h4', 'ed-sub-title', t('editor.foliageTool.customTitle')));
    const custom = d.getFoliageCustom();
    if (custom) {
      s.appendChild(
        el('p', 'ed-chosen', t('editor.foliageTool.customChosen', { name: custom.label })),
      );
      s.appendChild(
        button(t('editor.foliageTool.customClear'), () => d.clearFoliageCustom(), 'small'),
      );
    } else {
      s.appendChild(hint(t('editor.foliageTool.customHint')));
      s.appendChild(
        button(t('editor.foliageTool.customPick'), () => d.pickFoliageCustom(), 'small'),
      );
    }

    // Group toggles + grass controls only matter for the built-in pool; a custom
    // asset ignores them, so hide them while one is active.
    if (custom) {
      this.foliageSharedControls(s, f);
      this.root.appendChild(s);
      return;
    }

    // Animated grass (the built-in world's tuft cards) + its theme color and
    // clump size. The swatch previews the blade color BEFORE painting.
    s.appendChild(
      checkbox(t('editor.foliageTool.grass'), f.grass, (on) => {
        d.setFoliage({ grass: on });
        this.refresh(); // the grass controls appear/disappear with the checkbox
      }).root,
    );
    if (f.grass) {
      const swatch = el('div', 'ed-grass-swatch');
      swatch.title = t('editor.foliageTool.grassPreview');
      const paintSwatch = (): void => {
        const cur = d.getFoliage();
        // Matches the renderer's tint: setHSL(hue, 0.55, light).
        swatch.style.background = `hsl(${Math.round(cur.grassHue)}, 55%, ${Math.round(cur.grassLight)}%)`;
      };
      paintSwatch();
      s.appendChild(
        slider(t('editor.foliageTool.grassHue'), {
          min: 0,
          max: 360,
          step: 1,
          value: f.grassHue,
          onInput: (v) => {
            d.setFoliage({ grassHue: v });
            paintSwatch();
          },
          format: num1,
        }).root,
      );
      s.appendChild(
        slider(t('editor.foliageTool.grassLight'), {
          min: 15,
          max: 90,
          step: 1,
          value: f.grassLight,
          onInput: (v) => {
            d.setFoliage({ grassLight: v });
            paintSwatch();
          },
          format: num1,
        }).root,
      );
      s.appendChild(swatch);
      s.appendChild(
        slider(t('editor.foliageTool.grassClump'), {
          min: 1,
          max: 40,
          step: 1,
          value: f.grassClump,
          onInput: (v) => d.setFoliage({ grassClump: v }),
          format: num1,
        }).root,
      );
    }
    for (const group of ['ferns', 'bushes', 'trees', 'rocks'] as const) {
      s.appendChild(
        checkbox(t(`editor.foliageTool.${group}` as Parameters<typeof t>[0]), f[group], (on) =>
          d.setFoliage({ [group]: on }),
        ).root,
      );
    }
    this.foliageSharedControls(s, f);
    this.root.appendChild(s);
  }

  /** Paint Clutter brush: which of the ten clutter kinds to scatter, how
   *  densely, at what sizes, and whether they gather into piles. */
  private meshFixPanel(): void {
    const d = this.deps;
    const s = section(t('editor.meshFixTool.title'));
    const vertexMode = d.vertexModeOn();
    s.appendChild(
      checkbox(t('editor.meshFixTool.vertexMode'), vertexMode, (on) => d.setVertexMode(on)).root,
    );
    if (vertexMode) {
      // The brush controls are meaningless in vertex mode and the knockout
      // hint actively contradicts it, so the panel swaps rather than stacks.
      s.appendChild(hint(t('editor.meshFixTool.vertexHint')));
      s.appendChild(
        hint(
          t('editor.meshFixTool.vertexCount', {
            sel: d.vertexSelectionCount(),
            n: d.vertexEditCount(),
          }),
        ),
      );
      s.appendChild(button(t('editor.meshFixTool.vertexReset'), () => d.resetSelectedVertices()));
      s.appendChild(button(t('editor.meshFixTool.vertexClearSel'), () => d.clearVertexSelection()));
      s.appendChild(button(t('editor.meshFixTool.vertexClearAll'), () => d.clearAllVertexEdits()));
      this.root.appendChild(s);
      return;
    }
    s.appendChild(hint(t('editor.meshFixTool.hint')));
    s.appendChild(
      checkbox(t('editor.meshFixTool.restore'), d.getMeshFixRestore(), (on) =>
        d.setMeshFixRestore(on),
      ).root,
    );
    s.appendChild(hint(t('editor.meshFixTool.count', { n: d.meshFixCount() })));
    s.appendChild(button(t('editor.meshFixTool.clear'), () => d.clearMeshFix()));
    s.appendChild(hint(t('editor.meshFixTool.nudgeHint')));
    this.root.appendChild(s);
  }

  private clutterPanel(): void {
    const d = this.deps;
    const c = d.getClutter();
    const s = section(t('editor.clutterTool.title'));
    s.appendChild(hint(t('editor.clutterTool.hint')));
    s.appendChild(hint(t('editor.clutterTool.tierNote')));
    s.appendChild(
      checkbox(t('editor.clutterTool.erase'), c.erase, (on) => d.setClutter({ erase: on })).root,
    );
    s.appendChild(
      slider(t('editor.clutterTool.density'), {
        min: 1,
        max: 10,
        step: 1,
        value: c.density,
        onInput: (v) => d.setClutter({ density: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.clutterTool.minScale'), {
        min: 0.25,
        max: 4,
        step: 0.05,
        value: c.minScale,
        onInput: (v) => d.setClutter({ minScale: Math.min(v, d.getClutter().maxScale) }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.clutterTool.maxScale'), {
        min: 0.25,
        max: 4,
        step: 0.05,
        value: c.maxScale,
        onInput: (v) => d.setClutter({ maxScale: Math.max(v, d.getClutter().minScale) }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.clutterTool.clumps'), {
        min: 0,
        max: 8,
        step: 1,
        value: c.clumps,
        onInput: (v) => d.setClutter({ clumps: v }),
        format: num1,
      }).root,
    );
    s.appendChild(el('h4', 'ed-sub-title', t('editor.clutterTool.kindsTitle')));
    CLUTTER_KINDS.forEach((kind, i) => {
      const bit = 1 << i;
      s.appendChild(
        checkbox(
          t(`editor.clutterTool.kinds.${kind}` as Parameters<typeof t>[0]),
          (c.kinds & bit) !== 0,
          (on) => {
            const kinds = d.getClutter().kinds;
            d.setClutter({ kinds: on ? kinds | bit : kinds & ~bit });
          },
        ).root,
      );
    });
    const count = d.clutterStampCount();
    if (count > 0) {
      s.appendChild(hint(t('editor.clutterTool.count', { count })));
      s.appendChild(button(t('editor.clutterTool.clearAll'), () => d.clearAllClutter()));
    }
    this.root.appendChild(s);
  }

  /** Density / scale / collide controls shared by the built-in and custom
   *  foliage brush (a custom asset ignores the group toggles, not these). */
  private foliageSharedControls(s: HTMLElement, f: ReturnType<InspectorDeps['getFoliage']>): void {
    const d = this.deps;
    s.appendChild(
      slider(t('editor.foliageTool.density'), {
        min: 1,
        max: 10,
        step: 1,
        value: f.density,
        onInput: (v) => d.setFoliage({ density: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.foliageTool.minScale'), {
        min: 0.2,
        max: 50,
        step: 0.1,
        value: f.minScale,
        onInput: (v) => d.setFoliage({ minScale: Math.min(v, d.getFoliage().maxScale) }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.foliageTool.maxScale'), {
        min: 0.2,
        max: 50,
        step: 0.1,
        value: f.maxScale,
        onInput: (v) => d.setFoliage({ maxScale: Math.max(v, d.getFoliage().minScale) }),
        format: num1,
      }).root,
    );
    s.appendChild(
      checkbox(t('editor.foliageTool.collide'), f.collide, (on) => d.setFoliage({ collide: on }))
        .root,
    );
  }

  private blockerPanel(): void {
    const d = this.deps;
    const s = section(t('editor.blockerTool.title'));
    s.appendChild(hint(t('editor.blockerTool.hint')));
    const stats = d.getBlockerStats();
    s.appendChild(
      hint(
        t('editor.blockerTool.count', {
          count: formatNumber(stats.count, { useGrouping: false }),
          max: formatNumber(stats.max, { useGrouping: false }),
        }),
      ),
    );
    this.root.appendChild(s);
  }

  private colliderPanel(): void {
    const d = this.deps;
    const s = section(t('editor.collider.title'));
    s.appendChild(hint(t('editor.collider.hint')));
    const pal = el('div', 'ed-biomes');
    pal.setAttribute('role', 'radiogroup');
    pal.setAttribute('aria-label', t('editor.collider.shapeLabel'));
    const shapes: ColliderVolumeKind[] = ['box', 'sphere', 'plane', 'wall'];
    for (const kind of shapes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-biome';
      b.setAttribute('role', 'radio');
      const active = d.getColliderShape() === kind;
      b.setAttribute('aria-checked', active ? 'true' : 'false');
      b.classList.toggle('active', active);
      const sw = el('span', 'ed-biome-swatch');
      sw.style.background = '#3ddc6a';
      b.append(sw, el('span', undefined, t(`editor.collider.${kind}` as Parameters<typeof t>[0])));
      b.addEventListener('click', () => {
        d.setColliderShape(kind);
        this.refresh();
      });
      pal.appendChild(b);
    }
    s.appendChild(pal);
    s.appendChild(hint(t('editor.collider.playtestNote')));
    s.appendChild(
      checkbox(t('editor.collider.hideVolumes'), d.getCollidersHidden(), (on) =>
        d.setCollidersHidden(on),
      ).root,
    );
    s.appendChild(hint(t('editor.collider.hideVolumesHint')));
    this.root.appendChild(s);
  }

  /** Per-axis dimension sliders for a selected collider volume. */
  /** Fluid tool: pick the pool preset to stamp; click ground to place. */
  private fluidToolPanel(): void {
    const d = this.deps;
    const s = section(t('editor.fluid.title'));
    s.appendChild(hint(t('editor.fluid.hint')));
    const kinds: FluidKind[] = ['lava', 'acid', 'spectral', 'water'];
    for (const kind of kinds) {
      const preset = FLUID_PRESETS[kind];
      const row = checkbox(
        t(`editor.fluid.kind.${kind}` as Parameters<typeof t>[0]),
        d.getFluidKind() === kind,
        () => {
          d.setFluidKind(kind);
          this.refresh();
        },
      );
      const sw = el('span', 'ed-swatch');
      sw.style.background = `hsl(${preset.hue}, 70%, ${Math.round(preset.lum * 100)}%)`;
      row.root.appendChild(sw);
      s.appendChild(row.root);
    }
    this.root.appendChild(s);
  }

  /** Selected fluid pool: tint, surface offset, damage, effect toggles. */
  private fluidControls(s: HTMLElement, sel: PlacementSelection): void {
    const d = this.deps;
    const kind = sel.fluidKind as FluidKind;
    const preset = FLUID_PRESETS[kind];
    const hue = sel.hue ?? preset.hue;
    const lumPct = Math.round((sel.lum ?? preset.lum) * 100);
    const swatch = el('span', 'ed-swatch');
    const paint = (h: number, lp: number): void => {
      swatch.style.background = `hsl(${Math.round(h)}, 70%, ${Math.round(lp)}%)`;
    };
    paint(hue, lumPct);
    s.appendChild(swatch);
    s.appendChild(
      slider(t('editor.fluid.hue'), {
        min: 0,
        max: 360,
        step: 1,
        value: hue,
        onInput: (v) => {
          d.updateSelection({ hue: v }, false);
          paint(v, lumPct);
        },
        onChange: (v) => d.updateSelection({ hue: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.fluid.light'), {
        min: 8,
        max: 90,
        step: 1,
        value: lumPct,
        onInput: (v) => {
          d.updateSelection({ lum: v / 100 }, false);
          paint(sel.hue ?? preset.hue, v);
        },
        onChange: (v) => d.updateSelection({ lum: v / 100 }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.fluid.dps'), {
        min: 0,
        max: 50,
        step: 0.5,
        value: sel.fluidDps ?? preset.dps,
        onInput: (v) => d.updateSelection({ fluidDps: v }, false),
        onChange: (v) => d.updateSelection({ fluidDps: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.fluid.surfaceOffset'), {
        min: -20,
        max: 20,
        step: 0.1,
        value: sel.sizeY ?? 0.3,
        onInput: (v) => d.updateSelection({ sizeY: v }, false),
        onChange: (v) => d.updateSelection({ sizeY: v }, true),
        format: num1,
      }).root,
    );
    const fx = sel.fluidFx ?? preset.fx;
    const fxToggle = (labelKey: string, bit: number): void => {
      s.appendChild(
        checkbox(t(labelKey as Parameters<typeof t>[0]), (fx & bit) !== 0, (on) => {
          d.updateSelection({ fluidFx: on ? fx | bit : fx & ~bit }, true);
          this.refresh();
        }).root,
      );
    };
    fxToggle('editor.fluid.fxBubbles', 1);
    fxToggle('editor.fluid.fxSmoke', 2);
    fxToggle('editor.fluid.fxHaze', 4);
    fxToggle('editor.fluid.fxLight', 8);
    s.appendChild(
      button(
        t('editor.fluid.resetPreset'),
        () => {
          d.updateSelection({ hue: null, lum: null, fluidDps: null, fluidFx: null }, true);
          this.refresh();
        },
        'small',
      ),
    );
    s.appendChild(hint(t('editor.fluid.selHint')));
  }

  private colliderSizeControls(s: HTMLElement, sel: PlacementSelection): void {
    const d = this.deps;
    const kind = sel.colliderKind;
    if (!kind) return;
    const defs = COLLIDER_DEFAULT_SIZE[kind];
    const dim = (
      labelKey: string,
      value: number,
      axis: 'sizeX' | 'sizeY' | 'sizeZ',
      min: number,
      max: number,
    ): void => {
      s.appendChild(
        slider(t(labelKey as Parameters<typeof t>[0]), {
          min,
          max,
          step: 0.5,
          value,
          onInput: (v) => d.updateSelection({ [axis]: v }, false),
          onChange: (v) => d.updateSelection({ [axis]: v }, true),
          format: num1,
        }).root,
      );
    };
    if (kind === 'box') {
      dim('editor.collider.width', sel.sizeX ?? defs.x, 'sizeX', 0.5, 60);
      dim('editor.collider.height', sel.sizeY ?? defs.y, 'sizeY', 0.5, 30);
      dim('editor.collider.depth', sel.sizeZ ?? defs.z, 'sizeZ', 0.5, 60);
    } else if (kind === 'wall') {
      // A wall is a thin standing box: long, tall, and barely thick.
      dim('editor.collider.width', sel.sizeX ?? defs.x, 'sizeX', 0.5, 120);
      dim('editor.collider.height', sel.sizeY ?? defs.y, 'sizeY', 0.5, 100);
      dim('editor.collider.depth', sel.sizeZ ?? defs.z, 'sizeZ', 0.2, 10);
    } else if (kind === 'sphere') {
      dim('editor.collider.diameter', sel.sizeX ?? defs.x, 'sizeX', 0.5, 60);
    } else {
      dim('editor.collider.width', sel.sizeX ?? defs.x, 'sizeX', 0.5, 120);
      dim('editor.collider.depth', sel.sizeZ ?? defs.z, 'sizeZ', 0.5, 120);
      dim('editor.collider.floorOffset', sel.sizeY ?? defs.y, 'sizeY', -20, 40);
    }
    s.appendChild(hint(t('editor.collider.sizeHint')));
  }

  private transformPanel(tool: 'move' | 'rotate' | 'scale'): void {
    const s = section(t(`editor.tool.${tool}` as Parameters<typeof t>[0]));
    const hintKey =
      tool === 'move'
        ? 'editor.transform.moveHint'
        : tool === 'rotate'
          ? 'editor.transform.rotateHint'
          : 'editor.transform.scaleHint';
    s.appendChild(hint(t(hintKey as Parameters<typeof t>[0])));
    if (!this.deps.getSelection()) s.appendChild(hint(t('editor.transform.pickHint')));
    this.root.appendChild(s);
  }

  private selectPanel(): void {
    const d = this.deps;
    const sel = d.getSelection();
    const s = section(t('editor.selection.title'));
    if (sel) {
      const count = d.getSelectionCount();
      if (count > 1) {
        s.appendChild(
          el(
            'p',
            'ed-chosen',
            t('editor.selection.multiCount', {
              count: formatNumber(count, { useGrouping: false }),
            }),
          ),
        );
        s.appendChild(hint(t('editor.selection.multiHint')));
      }
      s.appendChild(el('p', 'ed-chosen', t('editor.selection.asset', { name: sel.assetLabel })));
      // One click selects every placement of this asset on the map, so the
      // whole family can be moved, deleted or retuned together.
      s.appendChild(
        button(
          t('editor.selection.selectAllOfAsset', {
            count: formatNumber(d.getSameAssetCount(), { useGrouping: false }),
          }),
          () => {
            d.selectAllOfAsset();
            this.refresh();
          },
          'small',
          t('editor.selection.selectAllOfAssetTitle'),
        ),
      );
      if (!sel.colliderKind && !sel.fluidKind && assetById(sel.assetId)) {
        this.collisionMasterHero(s, sel);
      }
      s.appendChild(
        this.coordField(t('editor.selection.x'), sel.x, (v) => {
          d.updateSelection({ x: v }, true);
        }),
      );
      s.appendChild(
        this.coordField(t('editor.selection.y'), sel.y ?? 0, (v) => {
          d.updateSelection({ y: v }, true);
        }),
      );
      s.appendChild(
        this.coordField(t('editor.selection.z'), sel.z, (v) => {
          d.updateSelection({ z: v }, true);
        }),
      );
      s.appendChild(
        slider(t('editor.selection.rotation'), {
          min: 0,
          max: 360,
          step: 1,
          value: Math.round(
            (((sel.rotY % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * (180 / Math.PI),
          ),
          onInput: (v) => d.updateSelection({ rotY: (v * Math.PI) / 180 }, false),
          onChange: (v) => d.updateSelection({ rotY: (v * Math.PI) / 180 }, true),
          format: num1,
        }).root,
      );
      s.appendChild(
        slider(t('editor.selection.scale'), {
          min: PLACEMENT_SCALE_MIN,
          max: PLACEMENT_SCALE_MAX,
          step: 0.1,
          value: sel.scale,
          onInput: (v) => d.updateSelection({ scale: v }, false),
          onChange: (v) => d.updateSelection({ scale: v }, true),
          format: num1,
        }).root,
      );
      // "Scale all copies": roll a random scale in [min, max] onto every
      // placement of this asset (min==max = uniform). Only when copies exist.
      if (sel.sameAssetCount > 0) {
        const range = d.getCloneScaleRange();
        s.appendChild(el('h4', 'ed-sub-title', t('editor.selection.scaleAllTitle')));
        s.appendChild(
          slider(t('editor.selection.scaleMin'), {
            min: PLACEMENT_SCALE_MIN,
            max: PLACEMENT_SCALE_MAX,
            step: 0.1,
            value: range.min,
            onInput: (v) => d.setCloneScaleRange({ min: v }),
            onChange: (v) => d.setCloneScaleRange({ min: v }),
            format: num1,
          }).root,
        );
        s.appendChild(
          slider(t('editor.selection.scaleMax'), {
            min: PLACEMENT_SCALE_MIN,
            max: PLACEMENT_SCALE_MAX,
            step: 0.1,
            value: range.max,
            onInput: (v) => d.setCloneScaleRange({ max: v }),
            onChange: (v) => d.setCloneScaleRange({ max: v }),
            format: num1,
          }).root,
        );
        s.appendChild(
          button(
            t('editor.selection.scaleAllButton', {
              name: sel.assetLabel,
              count: formatNumber(sel.sameAssetCount + 1, { useGrouping: false }),
            }),
            () => d.scaleAllSameAsset(),
          ),
        );
        s.appendChild(hint(t('editor.selection.scaleAllHint', { name: sel.assetLabel })));
      }
      if (sel.fluidKind) {
        // Fluid pools: footprint + surface offset + tint/damage/effects.
        this.fluidControls(s, sel);
      } else if (sel.assetId === ROCK_ASSET_ID) {
        this.rockControls(s, sel);
      } else if (sel.tree) {
        // Generated trees: the whole recipe, live. The trunk collider is
        // derived from the girth, so the ordinary footprint controls would
        // only fight with it.
        this.treeControls(s, sel);
      } else if (sel.assetId === MODEL_ASSET_ID) {
        // Built models: re-open for modeling + surface texture + collision.
        this.modelControlsForSelection(s);
      } else if (sel.colliderKind) {
        // Collider volumes: per-axis dimensions instead of the circle-footprint
        // controls (their collision IS the volume; collide stays on).
        this.colliderSizeControls(s, sel);
      } else {
        this.collisionControls(s, sel);
      }
      // Wind sway sits with Appearance, not Collision: it is presentation, and
      // it is per-ASSET where everything above is per-placement.
      if (!sel.colliderKind) this.swayControls(s, sel);
      // Appearance (shader tweaks): tint / opacity / glow, saved on the map.
      if (!sel.colliderKind) {
        s.appendChild(el('h4', 'ed-sub-title', t('editor.appearance.title')));
        s.appendChild(
          this.colorInput(t('editor.appearance.tint'), sel.tint ?? 0xffffff, (hex) =>
            d.updateSelection({ tint: hex === 0xffffff ? null : hex }, true),
          ),
        );
        s.appendChild(
          slider(t('editor.appearance.opacity'), {
            min: 10,
            max: 100,
            step: 5,
            value: Math.round((sel.opacity ?? 1) * 100),
            onInput: (v) => d.updateSelection({ opacity: v >= 100 ? null : v / 100 }, false),
            onChange: (v) => d.updateSelection({ opacity: v >= 100 ? null : v / 100 }, true),
            format: num1,
          }).root,
        );
        s.appendChild(
          this.colorInput(t('editor.appearance.glow'), sel.glow ?? 0x000000, (hex) =>
            d.updateSelection({ glow: hex === 0 ? null : hex }, true),
          ),
        );
        s.appendChild(
          slider(t('editor.appearance.glowStrength'), {
            min: 0,
            max: 8,
            step: 0.1,
            value: sel.glowStrength ?? 1,
            onInput: (v) => d.updateSelection({ glowStrength: v }, false),
            onChange: (v) => d.updateSelection({ glowStrength: v }, true),
            format: num1,
          }).root,
        );
        this.fireControls(s, sel);
        s.appendChild(
          button(
            t('editor.appearance.reset'),
            () => {
              d.updateSelection(
                { tint: null, opacity: null, glow: null, glowStrength: null },
                true,
              );
              this.refresh();
            },
            'small',
          ),
        );
        s.appendChild(hint(t('editor.appearance.hint')));
      }
      const pieceCount = d.getPrefabPieceCount();
      if (pieceCount > 0) {
        s.appendChild(
          button(
            t('editor.selection.pieces', {
              count: formatNumber(pieceCount, { useGrouping: false }),
            }),
            () => d.explodeSelection(),
          ),
        );
        s.appendChild(hint(t('editor.selection.piecesHint')));
      }
      const combineCount = d.getCombineCount();
      if (combineCount > 1) {
        s.appendChild(
          button(
            t('editor.selection.combine', {
              count: formatNumber(combineCount, { useGrouping: false }),
            }),
            () => d.combineSelection(),
          ),
        );
        s.appendChild(hint(t('editor.selection.combineHint')));
      }
      const groupCount = d.getGroupCount();
      if (groupCount > 1) {
        s.appendChild(
          button(
            t('editor.selection.ungroup', {
              count: formatNumber(groupCount, { useGrouping: false }),
            }),
            () => d.ungroupSelection(),
          ),
        );
      }
      const row = el('div', 'ed-row');
      row.append(
        button(t('editor.selection.duplicate'), () => d.duplicateSelection()),
        button(t('editor.selection.delete'), () => d.deleteSelection(), 'danger'),
      );
      s.appendChild(row);
      // Teach the direct-manipulation paths (drag-move, wheel, nudge keys).
      s.appendChild(hint(t('editor.selection.moveHint')));
      s.appendChild(hint(t('editor.selection.wheelHint')));
      s.appendChild(hint(t('editor.selection.deleteHint')));
    } else {
      const marker = d.getMarkerSelection();
      if (marker) {
        s.appendChild(el('p', 'ed-chosen', marker.label));
        s.appendChild(
          this.coordField(t('editor.selection.x'), marker.x, (v) => d.updateMarker('x', v)),
        );
        s.appendChild(
          this.coordField(t('editor.selection.z'), marker.z, (v) => d.updateMarker('z', v)),
        );
        s.appendChild(
          button(
            t('editor.marker.reset'),
            () => {
              d.resetMarker();
              this.refresh();
            },
            'small',
          ),
        );
      } else {
        s.appendChild(el('p', 'ed-muted', t('editor.selection.none')));
      }
    }
    s.appendChild(
      checkbox(t('editor.selection.footprints'), d.getFootprints(), (on) => d.setFootprints(on))
        .root,
    );
    this.root.appendChild(s);
  }

  private modelingSculptPanel(): void {
    const d = this.deps;
    const state = d.getModelingSculpt();
    const s = section(t('editor.collisionMaster.sculptSettings'));
    const select = document.createElement('select');
    select.className = 'ed-full-select';
    const tools: readonly [CmSculptTool | null, Parameters<typeof t>[0]][] = [
      [null, 'editor.collisionMaster.sculptOff'],
      ['grab', 'editor.collisionMaster.sculptGrab'],
      ['inflate', 'editor.collisionMaster.sculptInflate'],
      ['deflate', 'editor.collisionMaster.sculptDeflate'],
      ['smooth', 'editor.collisionMaster.sculptSmooth'],
      ['pinch', 'editor.collisionMaster.sculptPinch'],
      ['crease', 'editor.collisionMaster.sculptCrease'],
      ['relax', 'editor.collisionMaster.sculptRelax'],
    ];
    for (const [value, key] of tools) {
      const option = document.createElement('option');
      option.value = value ?? '';
      option.textContent = t(key);
      option.selected = value === state.tool;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      d.setModelingSculptTool((select.value || null) as CmSculptTool | null);
      this.refresh();
    });
    s.appendChild(select);
    if (state.tool) {
      s.appendChild(
        slider(t('editor.collisionMaster.sculptRadius'), {
          min: 0.25,
          max: 12,
          step: 0.25,
          value: state.radius,
          onInput: (radius) => d.setModelingSculptSettings({ radius }),
          format: num1,
        }).root,
      );
      s.appendChild(
        slider(t('editor.collisionMaster.sculptStrength'), {
          min: 0.01,
          max: 1,
          step: 0.01,
          value: state.strength,
          onInput: (strength) => d.setModelingSculptSettings({ strength }),
          format: num1,
        }).root,
      );
      s.appendChild(
        checkbox(t('editor.collisionMaster.dyntopo'), state.dynamicTopology, (dynamicTopology) => {
          d.setModelingSculptSettings({ dynamicTopology });
          this.refresh();
        }).root,
      );
      if (state.dynamicTopology) {
        s.appendChild(
          slider(t('editor.collisionMaster.sculptDetail'), {
            min: 0.08,
            max: 2,
            step: 0.04,
            value: state.targetEdgeLength,
            onInput: (targetEdgeLength) => d.setModelingSculptSettings({ targetEdgeLength }),
            format: num1,
          }).root,
        );
      }
      s.appendChild(el('h3', 'ed-subtitle', t('editor.collisionMaster.symmetry')));
      const axes = el('div', 'ed-row ed-wrap');
      for (const axis of ['x', 'y', 'z'] as const) {
        axes.appendChild(
          checkbox(axis.toUpperCase(), state.symmetry[axis], (enabled) => {
            state.symmetry[axis] = enabled;
            d.setModelingSculptSettings({ symmetry: { ...state.symmetry } });
          }).root,
        );
      }
      s.appendChild(axes);
      s.appendChild(hint(t('editor.collisionMaster.symmetryHint')));
    }
    this.root.appendChild(s);
  }

  /** Collision block for ordinary model placements: the type dropdown plus
   *  the picked mode's controls (baked hitbox editing / basic radius / true
   *  mesh status). */
  /** The Collision Master session panel: session controls + starters + the
   *  poly-snap brush toggle. The actual box/radius editing happens through the
   *  normal Selection panel's collision block below it. */
  private collisionMasterPanel(cm: { assetId: string; label: string; canSave: boolean }): void {
    const d = this.deps;
    const s = section(t('editor.collisionMaster.title'));
    s.appendChild(el('p', 'ed-hint', t('editor.collisionMaster.assetLabel', { name: cm.label })));
    s.appendChild(hint(t('editor.collisionMaster.hint')));
    s.appendChild(
      button(
        t('editor.collisionMaster.fromBake'),
        () => d.collisionMasterStarter('bake'),
        'small',
        t('editor.collisionMaster.fromBakeTitle'),
      ),
    );
    s.appendChild(
      button(
        t('editor.collisionMaster.fittedBox'),
        () => d.collisionMasterStarter('fitted'),
        'small',
        t('editor.collisionMaster.fittedBoxTitle'),
      ),
    );
    s.appendChild(
      button(
        t('editor.collisionMaster.singleBox'),
        () => d.collisionMasterStarter('single'),
        'small',
        t('editor.collisionMaster.singleBoxTitle'),
      ),
    );
    s.appendChild(
      button(
        t('editor.collisionMaster.fromCylinder'),
        () => d.collisionMasterStarter('cylinder'),
        'small',
        t('editor.collisionMaster.fromCylinderTitle'),
      ),
    );
    s.appendChild(
      button(
        t('editor.collisionMaster.fromClear'),
        () => d.collisionMasterStarter('clear'),
        'small',
        t('editor.collisionMaster.fromClearTitle'),
      ),
    );
    s.appendChild(
      checkbox(t('editor.collisionMaster.polySnap'), d.getCollisionMasterPoly(), (on) => {
        d.setCollisionMasterPoly(on);
        this.refresh();
      }).root,
    );
    s.appendChild(hint(t('editor.collisionMaster.polySnapHint')));
    if (!cm.canSave) s.appendChild(hint(t('editor.collisionMaster.devOnly')));
    s.appendChild(
      button(
        t('editor.collisionMaster.lockIn'),
        () => d.collisionMasterCommit(),
        'primary',
        t('editor.collisionMaster.lockInTitle'),
      ),
    );
    s.appendChild(button(t('editor.collisionMaster.cancel'), () => d.collisionMasterCancel()));
    this.root.appendChild(s);
  }

  /** The Build session panel: shape count, surface texture, collision toggle,
   *  and Done. The actual modeling happens through the floating bar + gizmo. */
  private buildPanel(): void {
    const d = this.deps;
    const s = section(t('editor.build.panelTitle'));
    s.appendChild(hint(t('editor.build.bannerHint')));
    const vm = d.getModelPanel();
    if (vm) {
      s.appendChild(el('p', 'ed-hint', t('editor.build.shapes', { n: String(vm.shapes) })));
      this.modelControls(s, vm);
      s.appendChild(hint(t('editor.build.walkableTip')));
    }
    s.appendChild(button(t('editor.build.done'), () => d.buildDone(), 'primary'));
    this.root.appendChild(s);
  }

  /** Texture picker + tile size + collision toggle for a built model, shared by
   *  the Build session panel and the model's Selection panel. */
  private modelControls(
    s: HTMLElement,
    vm: {
      texId: string | undefined;
      texTile: number;
      hue: number;
      sat: number;
      light: number;
      collide: boolean;
      shapes: number;
    },
  ): void {
    const d = this.deps;
    const count = d.getModelCount();
    if (count > 1) s.appendChild(hint(t('editor.build.materialMany', { n: String(count) })));
    this.texSetPicker(s, t('editor.build.material'), this.modelTexOptions(), vm.texId ?? '', (v) =>
      d.setModelTexture(v || undefined),
    );
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    s.appendChild(
      slider(t('editor.build.hue'), {
        min: -180,
        max: 180,
        step: 1,
        value: vm.hue,
        onInput: (v) => d.setModelLook({ hue: v }),
        onChange: (v) => d.setModelLook({ hue: v }),
        format: (v) => `${Math.round(v)}\u00b0`,
      }).root,
    );
    s.appendChild(
      slider(t('editor.build.saturation'), {
        min: 0,
        max: 2,
        step: 0.02,
        value: vm.sat,
        onInput: (v) => d.setModelLook({ sat: v }),
        onChange: (v) => d.setModelLook({ sat: v }),
        format: pct,
        parse: (text) => {
          const n = Number.parseFloat(text);
          return Number.isFinite(n) ? n / 100 : null;
        },
      }).root,
    );
    s.appendChild(
      slider(t('editor.build.light'), {
        min: -1,
        max: 1,
        step: 0.02,
        value: vm.light,
        onInput: (v) => d.setModelLook({ light: v }),
        onChange: (v) => d.setModelLook({ light: v }),
        format: (v) => (v > 0 ? '+' : '') + pct(v),
        parse: (text) => {
          const n = Number.parseFloat(text);
          return Number.isFinite(n) ? n / 100 : null;
        },
      }).root,
    );
    if (vm.hue !== 0 || vm.sat !== 1 || vm.light !== 0) {
      s.appendChild(
        button(
          t('editor.build.resetLook'),
          () => {
            d.setModelLook({ hue: 0, sat: 1, light: 0 });
            this.refresh();
          },
          'small',
        ),
      );
    }
    s.appendChild(hint(t('editor.build.materialHint')));
    if (vm.texId) {
      s.appendChild(
        slider(t('editor.build.tileSize'), {
          min: 0.5,
          max: 32,
          step: 0.5,
          value: vm.texTile,
          onInput: (v) => d.setModelTexTile(v),
          onChange: (v) => d.setModelTexTile(v),
          format: num1,
        }).root,
      );
    }
    s.appendChild(
      checkbox(t('editor.build.collision'), vm.collide, (on) => {
        d.setModelCollision(on);
        this.refresh();
      }).root,
    );
    s.appendChild(hint(t('editor.build.collisionHint')));
  }

  /** Bare (no material) + the whole object-material library, in picker
   *  groups (render/model_materials.ts): "Metal \u00b7 Brushed Steel". */
  private modelTexOptions(): { value: string; label: string; file?: string }[] {
    return [
      { value: '', label: t('editor.build.bare') },
      ...modelMaterialOptions().map((m) => ({
        value: m.key,
        label: `${MATERIAL_GROUP_LABEL[m.group]} \u00b7 ${m.name}`,
        file: m.file,
      })),
    ];
  }

  /** Selection panel block for a built model placement: re-open for editing,
   *  plus the texture/collision controls. */
  private modelControlsForSelection(s: HTMLElement): void {
    const d = this.deps;
    s.appendChild(el('h4', 'ed-sub-title', t('editor.build.panelTitle')));
    s.appendChild(button(t('editor.build.editModel'), () => d.editModel(), 'primary'));
    const vm = d.getModelPanel();
    if (vm) this.modelControls(s, vm);
  }

  /** Wind-sway opt-out for the selected asset. Only offered for assets that
   *  actually sway: showing a dead toggle on a crate would read as broken. */
  private swayControls(s: HTMLElement, sel: PlacementSelection): void {
    if (!sel.swayKind) return;
    const d = this.deps;
    s.appendChild(
      checkbox(t('editor.selection.sway'), sel.swayEnabled, (on) => {
        d.setAssetSway(on);
        this.refresh();
      }).root,
    );
    s.appendChild(hint(t('editor.selection.swayHint')));
  }

  private collisionControls(s: HTMLElement, sel: PlacementSelection): void {
    const d = this.deps;
    s.appendChild(el('h4', 'ed-sub-title', t('editor.selection.collisionTitle')));
    s.appendChild(
      selectRow(
        t('editor.selection.collisionType'),
        [
          { value: 'baked', label: t('editor.selection.collisionTypeBaked') },
          { value: 'basic', label: t('editor.selection.collisionTypeBasic') },
          { value: 'mesh', label: t('editor.selection.collisionTypeMesh') },
          { value: 'none', label: t('editor.selection.collisionTypeNone') },
        ],
        sel.collisionMode,
        (v) => {
          d.updateSelection({ collisionMode: v as CollisionMode }, true);
          this.refresh();
        },
      ).root,
    );
    if (sel.collisionMode === 'basic') {
      s.appendChild(
        slider(t('editor.selection.radius'), {
          min: MIN_COLLIDE_RADIUS,
          max: MAX_COLLIDE_RADIUS,
          step: 0.1,
          value: sel.collideRadius ?? autoCollideRadius(sel.assetId, sel.scale, 'basic'),
          onInput: (v) => d.updateSelection({ collideRadius: v }, false),
          onChange: (v) => d.updateSelection({ collideRadius: v }, true),
          format: num1,
        }).root,
      );
      s.appendChild(
        checkbox(t('editor.selection.squareCollision'), sel.collideShape === 'square', (on) =>
          d.updateSelection({ collideShape: on ? 'square' : null }, true),
        ).root,
      );
      s.appendChild(
        button(
          t('editor.selection.radiusAuto'),
          () => {
            d.updateSelection({ collideRadius: null }, true);
            this.refresh();
          },
          'small',
          t('editor.selection.radiusAutoTitle'),
        ),
      );
      s.appendChild(hint(t('editor.selection.radiusHint')));
    } else if (sel.collisionMode === 'baked') {
      const he = d.getHitboxEdit();
      s.appendChild(
        hint(
          sel.hasHitboxEdits
            ? t('editor.selection.collisionEdited', {
                count: formatNumber(sel.hitboxCount, { useGrouping: false }),
              })
            : t('editor.selection.collisionBaked', {
                count: formatNumber(sel.hitboxCount, { useGrouping: false }),
              }),
        ),
      );
      if (!he) {
        s.appendChild(
          button(t('editor.selection.hitboxEdit'), () => {
            d.enterHitboxEdit();
            this.refresh();
          }),
        );
      } else {
        s.appendChild(
          hint(
            t('editor.selection.hitboxSelected', {
              count: formatNumber(he.selectedCount, { useGrouping: false }),
            }),
          ),
        );
        const row = el('div', 'ed-row');
        row.append(
          button(t('editor.selection.hitboxAdd'), () => {
            d.addHitbox();
            this.refresh();
          }),
          button(
            t('editor.selection.hitboxDelete'),
            () => {
              d.deleteSelectedHitboxes();
              this.refresh();
            },
            'danger',
          ),
        );
        s.appendChild(row);
        s.appendChild(
          button(t('editor.selection.hitboxDone'), () => {
            d.exitHitboxEdit();
            this.refresh();
          }),
        );
        s.appendChild(hint(t('editor.selection.hitboxHint')));
      }
      if (sel.hasHitboxEdits) {
        const row = el('div', 'ed-row');
        row.append(
          button(t('editor.selection.hitboxReset'), () => {
            d.resetHitboxes();
            this.refresh();
          }),
          button(
            t('editor.selection.hitboxSavePreset'),
            () => {
              d.saveHitboxPreset();
              this.refresh();
            },
            undefined,
            t('editor.selection.hitboxPresetHint'),
          ),
        );
        s.appendChild(row);
      }
      if (sel.hasHitboxPreset) {
        s.appendChild(
          button(t('editor.selection.hitboxClearPreset'), () => {
            d.clearHitboxPreset();
            this.refresh();
          }),
        );
        s.appendChild(hint(t('editor.selection.hitboxPresetHint')));
      }
    } else if (sel.collisionMode === 'mesh') {
      s.appendChild(
        hint(
          sel.meshBakePending
            ? t('editor.selection.meshBaking')
            : sel.meshBakeReady
              ? t('editor.selection.meshReady')
              : t('editor.selection.meshHint'),
        ),
      );
    }
    // Bottom of the menu: copy this placement's whole collision setup onto every
    // other placement of the same asset on the map (confirmed in the app layer).
    if (sel.sameAssetCount > 0) {
      s.appendChild(
        button(
          t('editor.selection.collisionCopyAll', {
            name: sel.assetLabel,
            count: formatNumber(sel.sameAssetCount, { useGrouping: false }),
          }),
          () => d.copyCollisionToSameAsset(),
        ),
      );
      s.appendChild(hint(t('editor.selection.collisionCopyAllHint', { name: sel.assetLabel })));
    }
  }

  private collisionMasterHero(s: HTMLElement, sel: PlacementSelection): void {
    if (this.deps.getCollisionMaster()) return;
    const card = el('div', 'ed-collision-hero');
    const copy = el('div', 'ed-collision-hero-copy');
    copy.append(
      el('strong', 'ed-collision-hero-title', t('editor.collisionMaster.heroTitle')),
      el(
        'span',
        'ed-collision-hero-status',
        t('editor.collisionMaster.heroStatus', {
          mode: t(
            `editor.selection.collisionType${
              sel.collisionMode === 'baked'
                ? 'Baked'
                : sel.collisionMode === 'basic'
                  ? 'Basic'
                  : sel.collisionMode === 'mesh'
                    ? 'Mesh'
                    : 'None'
            }` as Parameters<typeof t>[0],
          ),
        }),
      ),
    );
    card.append(
      copy,
      button(
        t('editor.collisionMaster.openFromSelection'),
        () => this.deps.openCollisionMasterForSelection(),
        'primary ed-collision-hero-btn',
        t('editor.collisionMaster.openFromSelectionTitle'),
      ),
    );
    s.appendChild(card);
  }

  private layersPanel(): void {
    const d = this.deps;
    const s = section(t('editor.layers.title'));
    const list = el('div', 'ed-layers');
    for (const layer of d.layers()) {
      list.appendChild(
        checkbox(layer.label, layer.visible, (on) => d.toggleLayer(layer.kind, on)).root,
      );
    }
    s.appendChild(list);
    const frame = section(t('editor.frame.title'));
    const row = el('div', 'ed-row ed-wrap');
    row.appendChild(button(t('editor.frame.all'), () => d.frameAll(), 'small'));
    for (const z of d.zones()) {
      row.appendChild(button(z.name, () => d.frameZone(z.id), 'small'));
    }
    frame.appendChild(row);
    this.root.appendChild(s);
    this.root.appendChild(frame);
  }

  private procgenPanel(): void {
    const d = this.deps;
    const s = section(t('editor.procgen.title'));
    s.appendChild(
      slider(t('editor.procgen.count'), {
        min: 10,
        max: 400,
        step: 10,
        value: d.getScatterCount(),
        onInput: (v) => d.setScatterCount(v),
        format: num1,
      }).root,
    );
    const row = el('div', 'ed-row ed-wrap');
    row.append(
      button(t('editor.procgen.scatter'), () => d.runScatter(), 'small'),
      button(t('editor.procgen.hills'), () => d.runHills(), 'small'),
    );
    s.appendChild(row);
    this.root.appendChild(s);
  }

  private lightingPanel(): void {
    const d = this.deps;
    const L = d.getLighting();
    const p = L.profile;
    const s = section(t('editor.lighting.title'));
    const row = el('div', 'ed-row ed-wrap');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('editor.lighting.presetLabel'));
    const presets = ['day', 'overcast', 'dusk', 'night'] as const;
    for (const key of presets) {
      const b = button(
        t(`editor.lighting.${key}` as Parameters<typeof t>[0]),
        () => {
          d.setLightingPreset(key);
          this.refresh();
        },
        L.preset === key ? 'small active' : 'small',
      );
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', L.preset === key ? 'true' : 'false');
      row.appendChild(b);
    }
    s.appendChild(row);
    if (L.preset === 'custom') s.appendChild(hint(t('editor.lighting.customHint')));
    const live = (
      labelKey: string,
      value: number,
      min: number,
      max: number,
      step: number,
      apply: (v: number) => Partial<EditorLightingProfile>,
    ): void => {
      s.appendChild(
        slider(t(labelKey as Parameters<typeof t>[0]), {
          min,
          max,
          step,
          value,
          onInput: (v) => d.updateLighting(apply(v)),
          onChange: () => this.refresh(), // the preset chips flip to Custom
          format: num1,
        }).root,
      );
    };
    live('editor.lighting.sun', p.sunIntensity, 0, 6, 0.1, (v) => ({ sunIntensity: v }));
    live('editor.lighting.ambient', p.hemiIntensity, 0, 2, 0.05, (v) => ({ hemiIntensity: v }));
    live('editor.lighting.environment', p.envScale, 0, 2, 0.05, (v) => ({ envScale: v }));
    live('editor.lighting.azimuth', p.sunAzimuthDeg, 0, 360, 5, (v) => ({ sunAzimuthDeg: v }));
    live('editor.lighting.elevation', p.sunElevationDeg, 5, 85, 1, (v) => ({
      sunElevationDeg: v,
    }));
    // The night floor: 0 keeps the shipped night dip, 1 never leaves day.
    live('editor.lighting.nightFloor', p.nightFloor ?? 0, 0, 1, 0.05, (v) => ({
      nightFloor: v,
    }));
    s.appendChild(hint(t('editor.lighting.nightFloorHint')));
    // Cave brightness: 0 keeps the shipped cave dark, 1 tints carved rock like daylight rock.
    live('editor.lighting.caveLight', p.caveLight ?? 0, 0, 1, 0.05, (v) => ({
      caveLight: v,
    }));
    s.appendChild(hint(t('editor.lighting.caveLightHint')));
    s.appendChild(
      this.colorInput(t('editor.lighting.sunColor'), p.sunColor, (hex) =>
        d.updateLighting({ sunColor: hex }),
      ),
    );
    s.appendChild(
      this.colorInput(t('editor.lighting.skyColor'), p.skyColor, (hex) =>
        d.updateLighting({ skyColor: hex }),
      ),
    );
    s.appendChild(hint(t('editor.lighting.hint')));

    // ---- skybox (procedural sky, a bundled CC0 image, or an uploaded one) ----
    s.appendChild(el('h4', 'ed-sub-title', t('editor.lighting.skyboxTitle')));
    const active = d.getSkybox();
    const skyRow = el('div', 'ed-row ed-wrap');
    const skyChip = (label: string, value: string | null, title?: string): void => {
      const b = button(
        label,
        () => {
          d.setSkybox(value);
          this.refresh();
        },
        'small',
        title,
      );
      if (active === value) b.classList.add('active');
      skyRow.appendChild(b);
    };
    skyChip(t('editor.lighting.skyboxDefault'), null);
    for (const sky of BUILTIN_SKYBOXES) {
      skyChip(
        t(`editor.lighting.skybox_${sky.id}` as Parameters<typeof t>[0]),
        `builtin:${sky.id}`,
      );
    }
    s.appendChild(skyRow);
    if (active?.startsWith('custom:')) {
      s.appendChild(el('p', 'ed-chosen', t('editor.lighting.skyboxCustomActive')));
    }
    s.appendChild(button(t('editor.lighting.skyboxUpload'), () => d.importSkybox(), 'small'));
    s.appendChild(hint(t('editor.lighting.skyboxHint')));

    this.zoneAtmosphereControls(s);

    // ---- birds ----------------------------------------------------------------
    s.appendChild(el('h4', 'ed-sub-title', t('editor.lighting.birdsTitle')));
    const birds = d.getBirds();
    s.appendChild(
      checkbox(t('editor.lighting.birds'), birds.enabled, (on) => {
        d.setBirds({ enabled: on });
        this.refresh(); // the sliders appear/disappear with the checkbox
      }).root,
    );
    if (birds.enabled) {
      s.appendChild(
        slider(t('editor.lighting.birdCount'), {
          min: 2,
          max: 40,
          step: 1,
          value: birds.count,
          onInput: (v) => d.setBirds({ count: v }),
          format: num1,
        }).root,
      );
      s.appendChild(
        checkbox(t('editor.lighting.birdFormation'), birds.formation, (on) =>
          d.setBirds({ formation: on }),
        ).root,
      );
    }
    this.weatherControls(s, this.deps.getWeather(), (next) => this.deps.setWeather(next));
    this.worldSpeedControls(s);
    this.root.appendChild(s);
  }

  private zoneAtmosphereControls(s: HTMLElement): void {
    const d = this.deps;
    const zone = d.getZoneAtmosphere();
    if (!zone) return;
    s.appendChild(el('h3', 'ed-subtitle', t('editor.lighting.zoneTitle')));
    s.appendChild(hint(t('editor.lighting.zoneHint')));
    const zoneSelect = document.createElement('select');
    zoneSelect.className = 'ed-full-select';
    zoneSelect.setAttribute('aria-label', t('editor.lighting.zoneSelect'));
    for (const item of zone.zones) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      option.selected = item.id === zone.selectedId;
      zoneSelect.appendChild(option);
    }
    zoneSelect.addEventListener('change', () => {
      d.selectAtmosphereZone(zoneSelect.value);
      this.refresh();
    });
    s.appendChild(zoneSelect);

    const presets = el('div', 'ed-row ed-wrap');
    for (const key of ['day', 'overcast', 'dusk', 'night'] as const) {
      const pick = button(
        t(`editor.lighting.${key}` as Parameters<typeof t>[0]),
        () => {
          d.setZoneLightingPreset(key);
          this.refresh();
        },
        zone.preset === key ? 'small active' : 'small',
      );
      presets.appendChild(pick);
    }
    s.appendChild(presets);
    const live = (
      key: Parameters<typeof t>[0],
      value: number,
      min: number,
      max: number,
      step: number,
      change: (value: number) => Partial<EditorLightingProfile>,
    ): void => {
      s.appendChild(
        slider(t(key), {
          min,
          max,
          step,
          value,
          onInput: (v) => d.updateZoneLighting(change(v)),
          format: num1,
        }).root,
      );
    };
    live('editor.lighting.sun', zone.profile.sunIntensity, 0, 6, 0.1, (sunIntensity) => ({
      sunIntensity,
    }));
    live('editor.lighting.ambient', zone.profile.hemiIntensity, 0, 2, 0.05, (hemiIntensity) => ({
      hemiIntensity,
    }));
    live('editor.lighting.environment', zone.profile.envScale, 0, 2, 0.05, (envScale) => ({
      envScale,
    }));
    live('editor.lighting.azimuth', zone.profile.sunAzimuthDeg, 0, 360, 5, (sunAzimuthDeg) => ({
      sunAzimuthDeg,
    }));
    live(
      'editor.lighting.elevation',
      zone.profile.sunElevationDeg,
      5,
      85,
      1,
      (sunElevationDeg) => ({ sunElevationDeg }),
    );
    s.appendChild(
      this.colorInput(t('editor.lighting.sunColor'), zone.profile.sunColor, (sunColor) =>
        d.updateZoneLighting({ sunColor }),
      ),
    );
    s.appendChild(
      this.colorInput(t('editor.lighting.skyColor'), zone.profile.skyColor, (skyColor) =>
        d.updateZoneLighting({ skyColor }),
      ),
    );

    const skies = el('div', 'ed-row ed-wrap');
    const sky = (label: string, value: string | null): void => {
      const pick = button(
        label,
        () => {
          d.setZoneSkybox(value);
          this.refresh();
        },
        zone.skybox === value ? 'small active' : 'small',
      );
      skies.appendChild(pick);
    };
    sky(t('editor.lighting.skyboxDefault'), null);
    for (const item of BUILTIN_SKYBOXES) {
      sky(t(`editor.lighting.skybox_${item.id}` as Parameters<typeof t>[0]), `builtin:${item.id}`);
    }
    s.appendChild(skies);
    s.appendChild(
      slider(t('editor.lighting.worldSpeed'), {
        min: 0.25,
        max: 2,
        step: 0.05,
        value: zone.timeScale,
        onInput: (value) => d.setZoneWorldSpeed(value),
        format: (value) => `${num1(value)}x`,
      }).root,
    );
    // This zone's OWN weather. Set here it beats the map-wide sky while the
    // player stands in this zone, so one realm of a whole-world map can run its
    // own storm cycle without raining on the rest of the world.
    this.weatherControls(
      s,
      zone.weather,
      (next) => d.setZoneWeather(next),
      'editor.weather.zoneTitle',
    );
    s.appendChild(hint(t('editor.weather.zoneHint')));
    s.appendChild(
      button(
        t('editor.lighting.zoneReset'),
        () => {
          d.resetZoneAtmosphere();
          this.refresh();
        },
        'small',
      ),
    );
  }

  /** Ambience "world speed": one cosmetic-motion multiplier (below weather). */
  private worldSpeedControls(s: HTMLElement): void {
    const d = this.deps;
    s.appendChild(el('h3', 'ed-subtitle', t('editor.lighting.worldSpeedTitle')));
    const speed = d.getWorldSpeed();
    s.appendChild(
      slider(t('editor.lighting.worldSpeed'), {
        min: 0.25,
        max: 2,
        step: 0.05,
        value: speed,
        onInput: (v) => d.setWorldSpeed(v),
        onChange: () => this.refresh(),
        format: (v) => `${num1(v)}x`,
      }).root,
    );
    s.appendChild(hint(t('editor.lighting.worldSpeedHint')));
    if (Math.abs(speed - 1) > 0.001) {
      s.appendChild(
        button(
          t('editor.lighting.worldSpeedReset'),
          () => {
            d.setWorldSpeed(1);
            this.refresh();
          },
          'small',
        ),
      );
    }
  }

  /** Weather: fixed mode / intensity / cloud deck / timed schedule. Rendered
   *  for the MAP-wide setting and, with a zone's own record, for one zone ,
   *  same controls, different backing store. */
  private weatherControls(
    s: HTMLElement,
    w: ResolvedWeather,
    setWeather: (next: ResolvedWeather) => void,
    titleKey: Parameters<typeof t>[0] = 'editor.weather.title',
  ): void {
    const hasSchedule = w.schedule.length > 0;
    s.appendChild(el('h3', 'ed-subtitle', t(titleKey)));
    // Fixed mode radio row (dimmed by a live schedule, which wins).
    const modes: { key: 'auto' | WeatherPrecipMode; label: string }[] = [
      { key: 'auto', label: t('editor.weather.auto') },
      { key: 'clear', label: t('editor.weather.clear') },
      { key: 'rain', label: t('editor.weather.rain') },
      { key: 'snow', label: t('editor.weather.snow') },
      { key: 'blizzard', label: t('editor.weather.blizzard') },
      { key: 'sparkle', label: t('editor.weather.sparkle') },
    ];
    const row = el('div', 'ed-row ed-weather-modes');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('editor.weather.title'));
    for (const m of modes) {
      const b = button(
        m.label,
        () => {
          setWeather({ ...w, mode: m.key });
          this.refresh();
        },
        'small',
      );
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', w.mode === m.key ? 'true' : 'false');
      b.classList.toggle('active', w.mode === m.key);
      if (hasSchedule) b.disabled = true;
      row.appendChild(b);
    }
    s.appendChild(row);
    if (hasSchedule) s.appendChild(hint(t('editor.weather.scheduleWins')));
    s.appendChild(
      slider(t('editor.weather.intensity'), {
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(w.intensity * 100),
        onInput: (v) => setWeather({ ...w, intensity: v / 100 }),
        format: num1,
      }).root,
    );
    // Cloud deck.
    s.appendChild(
      slider(t('editor.weather.cloudCover'), {
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(w.clouds.coverage * 100),
        onInput: (v) => setWeather({ ...w, clouds: { ...w.clouds, coverage: v / 100 } }),
        format: num1,
      }).root,
    );
    if (w.clouds.coverage > 0) {
      s.appendChild(
        slider(t('editor.weather.cloudHeight'), {
          min: 0,
          max: 160,
          step: 2,
          value: w.clouds.height,
          onInput: (v) => setWeather({ ...w, clouds: { ...w.clouds, height: v } }),
          format: num1,
        }).root,
      );
      s.appendChild(hint(t('editor.weather.cloudHint')));
    }
    // Aurora.
    s.appendChild(
      slider(t('editor.weather.aurora'), {
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(w.aurora * 100),
        onInput: (v) => setWeather({ ...w, aurora: v / 100 }),
        format: num1,
      }).root,
    );
    if (w.aurora > 0) s.appendChild(hint(t('editor.weather.auroraHint')));
    // Dynamic schedule.
    s.appendChild(el('h3', 'ed-subtitle', t('editor.weather.scheduleTitle')));
    w.schedule.forEach((step, i) => {
      const r = el('div', 'ed-row');
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', t('editor.weather.stepMode'));
      for (const m of modes) {
        if (m.key === 'auto') continue;
        const opt = document.createElement('option');
        opt.value = m.key;
        opt.textContent = m.label;
        opt.selected = step.mode === m.key;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => {
        const schedule = w.schedule.map((st, j) =>
          j === i ? { ...st, mode: sel.value as typeof step.mode } : st,
        );
        setWeather({ ...w, schedule });
        this.refresh();
      });
      const mins = document.createElement('input');
      mins.type = 'number';
      mins.min = '0.5';
      mins.max = '120';
      mins.step = '0.5';
      mins.value = String(step.minutes);
      mins.setAttribute('aria-label', t('editor.weather.stepMinutes'));
      mins.addEventListener('keydown', (ev) => ev.stopPropagation());
      mins.addEventListener('change', () => {
        const v = Number(mins.value);
        if (!Number.isFinite(v)) return;
        const schedule = w.schedule.map((st, j) =>
          j === i ? { ...st, minutes: Math.min(120, Math.max(0.5, v)) } : st,
        );
        setWeather({ ...w, schedule });
      });
      r.append(
        sel,
        mins,
        el('span', 'ed-muted', t('editor.weather.minutesShort')),
        button(
          'x',
          () => {
            const schedule = w.schedule.filter((_, j) => j !== i);
            setWeather({ ...w, schedule });
            this.refresh();
          },
          'danger small',
          t('editor.weather.removeStep'),
        ),
      );
      s.appendChild(r);
    });
    s.appendChild(
      button(
        t('editor.weather.addStep'),
        () => {
          const schedule = [...w.schedule, { mode: 'rain' as const, minutes: 5 }];
          setWeather({ ...w, schedule });
          this.refresh();
        },
        'small',
        t('editor.weather.addStepTitle'),
      ),
    );
    s.appendChild(hint(t('editor.weather.scheduleHint')));
  }

  private colorInput(label: string, value: number, onChange: (hex: number) => void): HTMLElement {
    const row = el('label', 'ed-field');
    row.appendChild(el('span', undefined, label));
    const input = document.createElement('input');
    input.type = 'color';
    input.value = `#${value.toString(16).padStart(6, '0')}`;
    input.addEventListener('input', () => {
      const v = Number.parseInt(input.value.slice(1), 16);
      if (Number.isFinite(v)) onChange(v);
    });
    input.addEventListener('change', () => this.refresh());
    row.appendChild(input);
    return row;
  }

  /** Full multi-emitter fire authoring. Every edit replaces the array instead
   *  of mutating it, preserving the app's one-undo-per-slider gesture model. */
  private fireControls(s: HTMLElement, sel: PlacementSelection): void {
    const d = this.deps;
    const effects = sel.fireEffects;
    const selectedRaw = d.getSelectedFireEmitter();
    const selected =
      selectedRaw !== null && effects[selectedRaw] ? selectedRaw : effects.length > 0 ? 0 : null;

    s.appendChild(el('h4', 'ed-sub-title', t('editor.fire.title')));
    s.appendChild(hint(t('editor.fire.hint')));

    if (sel.fire && effects.length === 0) {
      const legacy = el('div', 'ed-fire-legacy');
      legacy.append(
        el('span', undefined, t('editor.fire.legacy')),
        button(
          t('editor.fire.customize'),
          () => {
            const fx = assetFirePreset('torch', 'fire-1');
            d.updateSelection({ fireEffects: [fx] }, true);
            d.setSelectedFireEmitter(0);
          },
          'small',
        ),
      );
      s.appendChild(legacy);
    }

    const toolbar = el('div', 'ed-row ed-wrap ed-fire-toolbar');
    toolbar.appendChild(
      button(
        t('editor.fire.add'),
        () => {
          if (effects.length >= MAX_ASSET_FIRE_EMITTERS) return;
          const next = [...effects.map((fx) => ({ ...fx }))];
          next.push(assetFirePreset('torch', nextAssetFireId(next)));
          d.updateSelection({ fireEffects: next }, true);
          d.setSelectedFireEmitter(next.length - 1);
        },
        'small',
      ),
    );
    if (effects.length > 0 || sel.fire) {
      toolbar.appendChild(
        button(
          t('editor.fire.removeAll'),
          () => {
            d.updateSelection({ fire: null, fireEffects: null }, true);
            d.setSelectedFireEmitter(null);
          },
          'danger small',
        ),
      );
    }
    s.appendChild(toolbar);

    if (effects.length === 0) return;
    const tabs = el('div', 'ed-fire-tabs');
    effects.forEach((fx, i) => {
      const tab = button(
        t('editor.fire.emitter', { count: formatNumber(i + 1, { useGrouping: false }) }),
        () => d.setSelectedFireEmitter(i),
        `small${selected === i ? ' is-active' : ''}`,
      );
      tab.title = fx.id;
      tabs.appendChild(tab);
    });
    s.appendChild(tabs);
    if (selected === null) return;

    const fx = effects[selected];
    const apply = (patch: Partial<AssetFireEmitter>, commit: boolean): void => {
      const clean = sanitizeAssetFireEmitter({ ...fx, ...patch }, fx.id);
      if (!clean) return;
      const next = effects.map((item, i) => (i === selected ? clean : { ...item }));
      d.updateSelection({ fireEffects: next }, commit);
    };
    const effectSlider = (
      label: string,
      key: keyof AssetFireEmitter,
      min: number,
      max: number,
      step: number,
      format: (v: number) => string = num1,
    ): void => {
      const value = fx[key];
      if (typeof value !== 'number') return;
      s.appendChild(
        slider(label, {
          min,
          max,
          step,
          value,
          onInput: (v) => apply({ [key]: v }, false),
          onChange: (v) => apply({ [key]: v }, true),
          format,
        }).root,
      );
    };

    const styleOptions: { value: AssetFireStyle; label: string }[] = [
      { value: 'torch', label: t('editor.fire.style.torch') },
      { value: 'bonfire', label: t('editor.fire.style.bonfire') },
      { value: 'wildfire', label: t('editor.fire.style.wildfire') },
      { value: 'soulfire', label: t('editor.fire.style.soulfire') },
      { value: 'embers', label: t('editor.fire.style.embers') },
    ];
    s.appendChild(
      selectRow(t('editor.fire.preset'), styleOptions, fx.style, (value) => {
        const preset = assetFirePreset(value as AssetFireStyle, fx.id);
        preset.x = fx.x;
        preset.y = fx.y;
        preset.z = fx.z;
        preset.anchor = fx.anchor;
        const next = effects.map((item, i) => (i === selected ? preset : { ...item }));
        d.updateSelection({ fireEffects: next }, true);
        this.refresh();
      }).root,
    );
    s.appendChild(
      checkbox(t('editor.fire.enabled'), fx.enabled, (on) => apply({ enabled: on }, true)).root,
    );
    s.appendChild(
      selectRow(
        t('editor.fire.anchor'),
        [
          { value: 'base', label: t('editor.fire.anchorBase') },
          { value: 'center', label: t('editor.fire.anchorCenter') },
          { value: 'top', label: t('editor.fire.anchorTop') },
        ],
        fx.anchor,
        (value) => {
          apply({ anchor: value as AssetFireEmitter['anchor'] }, true);
          this.refresh();
        },
      ).root,
    );

    s.appendChild(el('h5', 'ed-fire-group-title', t('editor.fire.position')));
    effectSlider(t('editor.fire.positionX'), 'x', -50, 50, 0.05);
    effectSlider(t('editor.fire.positionY'), 'y', -50, 50, 0.05);
    effectSlider(t('editor.fire.positionZ'), 'z', -50, 50, 0.05);

    s.appendChild(el('h5', 'ed-fire-group-title', t('editor.fire.flameShape')));
    effectSlider(t('editor.fire.scale'), 'scale', 0.05, 10, 0.05);
    effectSlider(t('editor.fire.width'), 'width', 0.1, 4, 0.05);
    effectSlider(t('editor.fire.height'), 'height', 0.1, 5, 0.05);
    effectSlider(t('editor.fire.layers'), 'flames', 1, 8, 1, (v) => String(Math.round(v)));
    effectSlider(t('editor.fire.intensity'), 'intensity', 0, 8, 0.05);
    effectSlider(t('editor.fire.opacity'), 'opacity', 0.05, 1, 0.05);

    s.appendChild(el('h5', 'ed-fire-group-title', t('editor.fire.light')));
    effectSlider(t('editor.fire.glow'), 'glow', 0, 8, 0.05);
    effectSlider(t('editor.fire.glowRange'), 'glowRange', 0.5, 50, 0.5);

    s.appendChild(el('h5', 'ed-fire-group-title', t('editor.fire.smoke')));
    effectSlider(t('editor.fire.smokeAmount'), 'smoke', 0, 1, 0.02);
    effectSlider(t('editor.fire.smokeScale'), 'smokeScale', 0.1, 5, 0.05);
    effectSlider(t('editor.fire.smokeRise'), 'smokeRise', 0, 5, 0.05);

    s.appendChild(el('h5', 'ed-fire-group-title', t('editor.fire.colorMotion')));
    effectSlider(t('editor.fire.hue'), 'hue', 0, 360, 1, (v) => `${Math.round(v)}°`);
    effectSlider(t('editor.fire.saturation'), 'saturation', 0, 1, 0.02);
    effectSlider(t('editor.fire.speed'), 'speed', 0, 4, 0.05);
    effectSlider(t('editor.fire.turbulence'), 'turbulence', 0, 2, 0.02);
    effectSlider(t('editor.fire.flicker'), 'flicker', 0, 1, 0.02);
    effectSlider(t('editor.fire.embers'), 'embers', 0, 1, 0.02);
    s.appendChild(
      selectRow(
        t('editor.fire.blend'),
        [
          { value: 'additive', label: t('editor.fire.blendAdditive') },
          { value: 'alpha', label: t('editor.fire.blendAlpha') },
        ],
        fx.blend,
        (value) => {
          apply({ blend: value as AssetFireEmitter['blend'] }, true);
          this.refresh();
        },
      ).root,
    );

    const actions = el('div', 'ed-row ed-wrap ed-fire-actions');
    actions.append(
      button(
        t('editor.fire.duplicate'),
        () => {
          if (effects.length >= MAX_ASSET_FIRE_EMITTERS) return;
          const copy = { ...fx, id: nextAssetFireId(effects), x: fx.x + 0.35 };
          const next = [...effects.map((item) => ({ ...item })), copy];
          d.updateSelection({ fireEffects: next }, true);
          d.setSelectedFireEmitter(next.length - 1);
        },
        'small',
      ),
      button(
        t('editor.fire.remove'),
        () => {
          const next = effects.filter((_, i) => i !== selected).map((item) => ({ ...item }));
          d.updateSelection({ fireEffects: next.length > 0 ? next : null }, true);
          d.setSelectedFireEmitter(next.length > 0 ? Math.min(selected, next.length - 1) : null);
        },
        'danger small',
      ),
    );
    s.appendChild(actions);
  }

  private cameraPanel(): void {
    const d = this.deps;
    const s = section(t('editor.camera.title'));
    s.appendChild(
      button(
        t('editor.camera.focus'),
        () => d.focusSelection(),
        'small',
        t('editor.camera.focusTitle'),
      ),
    );
    s.appendChild(
      checkbox(t('editor.camera.freeFly'), d.getFreeFly(), (on) => d.setFreeFly(on)).root,
    );
    if (d.getFreeFly()) s.appendChild(hint(t('editor.camera.freeFlyHint')));
    s.appendChild(
      checkbox(t('editor.camera.invertPan'), d.getInvertPan(), (on) => d.setInvertPan(on)).root,
    );
    s.appendChild(
      checkbox(t('editor.camera.showPlayer'), d.getShowPlayer(), (on) => d.setShowPlayer(on)).root,
    );
    // View toggles (overlay visibility only; collision never changes).
    s.appendChild(
      checkbox(t('editor.camera.showBoundary'), d.getShowBoundaryWalls(), (on) =>
        d.setShowBoundaryWalls(on),
      ).root,
    );
    s.appendChild(
      checkbox(t('editor.camera.wireframe'), d.getWireframe(), (on) => d.setWireframe(on)).root,
    );
    s.appendChild(checkbox(t('editor.camera.xray'), d.getXray(), (on) => d.setXray(on)).root);
    // Collision hitbox overlay (ON by default; persisted per maker).
    s.appendChild(
      checkbox(t('editor.selection.footprints'), d.getFootprints(), (on) => d.setFootprints(on))
        .root,
    );

    // ---- movement speeds ----------------------------------------------------
    s.appendChild(el('h4', 'ed-sub-title', t('editor.camera.speedTitle')));
    const speeds = d.getCameraSpeeds();
    const speedSlider = (labelKey: string, value: number, apply: (v: number) => void): void => {
      s.appendChild(
        slider(t(labelKey as Parameters<typeof t>[0]), {
          min: 0.1,
          max: 4,
          step: 0.1,
          value,
          onInput: apply,
          format: (v) => `${num1(v)}x`,
        }).root,
      );
    };
    speedSlider('editor.camera.moveSpeed', speeds.move, (v) => d.setCameraSpeeds({ move: v }));
    speedSlider('editor.camera.lookSpeed', speeds.look, (v) => d.setCameraSpeeds({ look: v }));
    speedSlider('editor.camera.panSpeed', speeds.pan, (v) => d.setCameraSpeeds({ pan: v }));
    s.appendChild(hint(t('editor.camera.speedHint')));
    s.appendChild(
      button(
        t('editor.camera.resetSpeeds'),
        () => {
          d.setCameraSpeeds({ move: 1, look: 1, pan: 1 });
          this.refresh();
        },
        'small',
      ),
    );

    // ---- placed-asset view distance (LOD) -----------------------------------
    s.appendChild(el('h4', 'ed-sub-title', t('editor.camera.assetViewTitle')));
    s.appendChild(
      slider(t('editor.camera.assetViewDistance'), {
        min: 120,
        max: 2000,
        step: 20,
        value: d.getAssetViewDistance(),
        onInput: (v) => d.setAssetViewDistance(v),
        format: (v) => (v >= 2000 ? t('editor.camera.assetViewMax') : `${num1(v)} yd`),
      }).root,
    );
    s.appendChild(hint(t('editor.camera.assetViewHint')));

    // ---- terrain visibility / loading haze ---------------------------------
    s.appendChild(el('h4', 'ed-sub-title', t('editor.camera.visibilityTitle')));
    const visibility = d.getVisibilityProfile();
    s.appendChild(
      slider(t('editor.camera.visibilityDistance'), {
        min: 400,
        max: 4000,
        step: 100,
        value: visibility.distance,
        onInput: (v) => d.setVisibilityProfile({ distance: v }),
        format: (v) => `${Math.round(v)} yd`,
      }).root,
    );
    s.appendChild(
      slider(t('editor.camera.loadingHaze'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: visibility.haze,
        onInput: (v) => d.setVisibilityProfile({ haze: v }),
        format: (v) => `${Math.round(v * 100)}%`,
      }).root,
    );
    s.appendChild(hint(t('editor.camera.visibilityHint')));

    // ---- performance overlay ------------------------------------------------
    s.appendChild(el('h4', 'ed-sub-title', t('editor.camera.perfTitle')));
    const perf = d.getPerfOverlay();
    s.appendChild(
      checkbox(t('editor.camera.perfShow'), perf.enabled, (on) => {
        d.setPerfOverlay({ enabled: on });
        this.refresh(); // the field toggles appear/disappear with the overlay
      }).root,
    );
    if (perf.enabled) {
      s.appendChild(hint(t('editor.camera.perfHint')));
      const fields: { key: keyof typeof perf; labelKey: string }[] = [
        { key: 'fps', labelKey: 'editor.camera.perfFps' },
        { key: 'frameMs', labelKey: 'editor.camera.perfFrameMs' },
        { key: 'assets', labelKey: 'editor.camera.perfAssets' },
        { key: 'tris', labelKey: 'editor.camera.perfTris' },
        { key: 'selTris', labelKey: 'editor.camera.perfSelTris' },
        { key: 'terrain', labelKey: 'editor.camera.perfTerrain' },
        { key: 'streaming', labelKey: 'editor.camera.perfStreaming' },
        { key: 'coords', labelKey: 'editor.camera.perfCoords' },
      ];
      for (const f of fields) {
        s.appendChild(
          checkbox(t(f.labelKey as Parameters<typeof t>[0]), perf[f.key], (on) =>
            d.setPerfOverlay({ [f.key]: on }),
          ).root,
        );
      }
    }

    this.root.appendChild(s);
  }

  /** Blender-style Scene Collection: a flat list of every placed object with an
   *  eyeball (hide in editor), a click-to-select / double-click-to-rename name,
   *  and a pin (fly the camera close + select). */
  private sceneCollectionPanel(): void {
    const d = this.deps;
    const s = section(t('editor.scene.title'));
    s.appendChild(hint(t('editor.scene.hint')));
    // Camera-zone stream: the automatic way to choose the residency zone, above
    // the per-zone radios because it drives them.
    const stream = d.getCameraZoneStream();
    const streamRow = el('div', 'ed-scene-stream');
    streamRow.appendChild(
      checkbox(t('editor.scene.zoneStream'), stream.on, (on) => d.setCameraZoneStream(on)).root,
    );
    // Padlock: hold the resident zone regardless of where the camera goes. Only
    // meaningful while the stream is running, so it is disabled otherwise
    // rather than hidden, the control stays where the maker learned it is.
    const lock = iconButton(
      stream.locked ? ICON_LOCK_CLOSED : ICON_LOCK_OPEN,
      () => d.setCameraZoneLocked(!stream.locked),
      'ed-scene-icon',
      stream.locked ? t('editor.scene.zoneUnlockTitle') : t('editor.scene.zoneLockTitle'),
    );
    lock.disabled = !stream.on;
    lock.classList.toggle('active', stream.locked);
    streamRow.appendChild(lock);
    s.appendChild(streamRow);
    s.appendChild(
      hint(
        stream.on && stream.zone
          ? stream.locked
            ? t('editor.scene.zoneStreamLocked', { zone: stream.zone })
            : t('editor.scene.zoneStreamAt', { zone: stream.zone, count: stream.count })
          : t('editor.scene.zoneStreamHint', { count: STREAM_ZONE_COUNT }),
      ),
    );
    // The perimeter guide: where the resident set ends, drawn rather than
    // guessed. Useful with the stream OFF too (a hand-picked isolate rect).
    s.appendChild(
      checkbox(t('editor.scene.streamGuide'), stream.guide, (on) => d.setStreamGuide(on)).root,
    );
    s.appendChild(hint(t('editor.scene.streamGuideHint')));
    const tree = d.getSceneTree();
    const total = tree.reduce((sum, zone) => sum + zone.count, 0);
    if (total === 0 && tree.length === 0) {
      s.appendChild(el('p', 'ed-muted', t('editor.scene.none')));
      this.root.appendChild(s);
      return;
    }
    s.appendChild(el('p', 'ed-muted', t('editor.scene.count', { n: total })));
    const list = el('div', 'ed-scene-list');
    for (const zone of tree) {
      const details = document.createElement('details');
      details.className = 'ed-scene-zone';
      details.open = this.sceneOpenZones.has(zone.zoneId) || zone.isolated;
      details.addEventListener('toggle', () => {
        if (details.open) this.sceneOpenZones.add(zone.zoneId);
        else this.sceneOpenZones.delete(zone.zoneId);
      });
      const summary = document.createElement('summary');
      summary.className = 'ed-scene-zone-head';
      // Current-zone radio: isolate this zone (or leave isolate when current).
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'ed-scene-isolate';
      radio.checked = zone.isolated;
      radio.title = t('editor.scene.isolateTitle', { zone: zone.zoneName });
      radio.addEventListener('click', (ev) => {
        ev.preventDefault(); // the refresh re-derives checked state
        ev.stopPropagation();
        d.isolateZone(zone.isolated ? null : zone.zoneId);
      });
      summary.appendChild(radio);
      summary.appendChild(el('span', 'ed-scene-zone-name', zone.zoneName));
      summary.appendChild(el('span', 'ed-scene-zone-count', String(zone.count)));
      if (zone.resident) {
        summary.appendChild(
          el('span', 'ed-scene-badge ed-scene-resident', t('editor.scene.residentBadge')),
        );
      }
      details.appendChild(summary);
      for (const group of zone.groups) {
        const groupBox = document.createElement('details');
        groupBox.className = 'ed-scene-group';
        const groupKey = `${zone.zoneId}/${group.group}`;
        groupBox.open = this.sceneOpenGroups.has(groupKey);
        groupBox.addEventListener('toggle', () => {
          if (groupBox.open) this.sceneOpenGroups.add(groupKey);
          else this.sceneOpenGroups.delete(groupKey);
        });
        const groupHead = document.createElement('summary');
        groupHead.className = 'ed-scene-group-head';
        groupHead.appendChild(el('span', 'ed-scene-group-name', group.group));
        groupHead.appendChild(el('span', 'ed-scene-zone-count', String(group.rows.length)));
        groupBox.appendChild(groupHead);
        for (const obj of group.rows) groupBox.appendChild(this.sceneRow(obj));
        details.appendChild(groupBox);
      }
      list.appendChild(details);
    }
    s.appendChild(list);
    this.root.appendChild(s);
  }

  /** One placement row: eye / name (click select, dblclick rename) / pin. */
  private sceneRow(obj: {
    index: number;
    name: string;
    hidden: boolean;
    selected: boolean;
  }): HTMLElement {
    const d = this.deps;
    const row = el('div', 'ed-scene-row');
    row.classList.toggle('active', obj.selected);
    row.classList.toggle('is-hidden', obj.hidden);
    // Eyeball: hide/show in the EDITOR only (the object stays in the map).
    row.appendChild(
      iconButton(
        obj.hidden ? ICON_EYE_OFF : ICON_EYE,
        () => d.toggleSceneObjectHidden(obj.index),
        'ed-scene-icon',
        obj.hidden ? t('editor.scene.showTitle') : t('editor.scene.hideTitle'),
      ),
    );
    // Name: single click selects, double click renames inline. A short timer
    // lets a double click cancel the pending select (which would rebuild the
    // row out from under the dblclick).
    const name = el('button', 'ed-scene-name', obj.name);
    name.type = 'button';
    name.title = obj.name;
    let clickTimer = 0;
    name.addEventListener('click', () => {
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => d.selectSceneObject(obj.index), 220);
    });
    name.addEventListener('dblclick', (ev) => {
      window.clearTimeout(clickTimer);
      ev.preventDefault();
      const input = this.nameInput(obj.name, (v) => d.renameSceneObject(obj.index, v));
      input.className = 'ed-scene-name-input';
      input.setAttribute('aria-label', t('editor.scene.renameLabel'));
      name.replaceWith(input);
      input.focus();
      input.select();
      input.addEventListener('blur', () => this.refresh());
      input.addEventListener('keydown', (k) => {
        if (k.key === 'Enter') input.blur();
        else if (k.key === 'Escape') this.refresh();
      });
    });
    row.appendChild(name);
    if (obj.hidden) row.appendChild(el('span', 'ed-scene-badge', t('editor.scene.hiddenBadge')));
    // Pin: fly the camera close to the object and select it.
    row.appendChild(
      iconButton(
        ICON_PIN,
        () => d.pinSceneObject(obj.index),
        'ed-scene-icon',
        t('editor.scene.pinTitle'),
      ),
    );
    return row;
  }

  private navHint(): void {
    const mode = this.deps.getViewMode();
    this.root.appendChild(
      el(
        'p',
        'ed-hint ed-nav-hint',
        mode === '3d' ? t('editor.hints.nav3d') : t('editor.hints.nav2d'),
      ),
    );
  }

  private coordField(label: string, value: number, onChange: (v: number) => void): HTMLElement {
    const row = el('label', 'ed-field');
    row.appendChild(el('span', undefined, label));
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.5';
    input.value = String(Math.round(value * 100) / 100);
    input.addEventListener('keydown', (ev) => ev.stopPropagation());
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) onChange(v);
    });
    row.appendChild(input);
    return row;
  }
}
