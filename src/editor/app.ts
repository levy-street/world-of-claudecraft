import {
  liveWorldCottagesChanged,
  liveWorldPreview,
  newLiveWorldMap,
  refreshLiveWorldTerrain,
} from './live_world_core';
import { showLiveWorldNotice } from './live_world_notice';
// The map-editor application coordinator. Thin by design: layout assembly,
// tool state, the undo stack, and event routing live here; everything with a
// nameable responsibility is a sibling module (topbar, toolbar, inspector,
// asset_browser, map_drawer, map_io, net, toasts, undo_core, stamp_core,
// user_assets, the 3D viewport, and the 2D canvas/view/model trio).
//
// Ownership of the ACTIVE world content: the app builds ONE WorldContent whose
// terrainEdits / biomePaint / zones / camps tables SHARE references with the
// working document, registers it via setActiveWorldContent, and every terrain
// sample (renderer chunks, procgen, smooth/flatten sampling) reads through it.

import { audio } from '../game/audio';
import { resolveMapMusicZone } from '../game/instance_music';
import { type MusicZone, music, musicZoneForLocation } from '../game/music';
import { Settings } from '../game/settings';
import {
  groundTextureUrl,
  loadGroundTextureBytes,
  storeGroundTexture,
} from '../render/assets/ground_textures';
import { loadSkyboxBytes, resolveSkyboxUrl, storeSkybox } from '../render/assets/skyboxes';
import { VISUALS } from '../render/characters/manifest';
import {} from '../render/cut_cavity_bake';
import { bakeCutCavities, setCavityPreviewCoarsen } from '../render/cut_cavity_mesh';
import {
  EDITOR_LIGHTING_DAY,
  EDITOR_LIGHTING_PRESETS,
  type EditorLightingProfile,
} from '../render/editor_lighting';
import { GFX } from '../render/gfx';
import {
  DEFAULT_TEXTURE_TILE_YD,
  rebakePaintFieldSwatches,
  refreshCustomGroundTextures,
  refreshTerrainHoles,
} from '../render/terrain';
import { MAX_PAINT_SLOTS, paintTextureSlotUsage } from '../render/terrain_paint_layers';
import { naturalSwayKindForAssetPath } from '../render/tree_sway';
import type { BrushShape } from '../sim/brush_shape';
import {
  CAVE_MAX_MULT,
  CAVE_MAX_RADIUS,
  CAVE_MIN_MULT,
  CAVE_MIN_RADIUS,
  CAVE_SPIKE_SIZE_MAX,
  CAVE_SPIKE_SIZE_MIN,
  caveBounds,
  holeBounds,
  MAX_CAVES,
} from '../sim/caves';
import { clonePropsKeepingAuthoredTowns } from '../sim/custom_world_props';
import { type FoliageParams, foliageKindOf } from '../sim/foliage_params';
import {
  CUT_MAX_BLEND,
  cutBounds,
  cutSdfAt,
  cutVerticalBounds,
  MAX_HOLE_PATCHES,
  MAX_TERRAIN_HOLES,
} from '../sim/terrain_cuts';
import {
  NOISE_ROUGH_DEFAULT,
  NOISE_SIZE_DEFAULT,
  NOISE_SIZE_MAX,
  NOISE_SIZE_MIN,
} from '../sim/terrain_noise_brush';
import {
  commitVoxelText,
  type DigAlpha,
  eraseVoxelBounds,
  eraseVoxelBox,
  extendSnapshot,
  growVoxelCut,
  makeVoxelCut,
  pickDigCell,
  resizeVoxelCut,
  restoreVoxels,
  smoothVoxel,
  snapshotVoxels,
  stampBox,
  stampVoxel,
  stampWorldBox,
  unionVoxelBox,
  type VoxelBox,
  type VoxelFields,
  voxelBoxRegion,
  voxelCovers,
  voxelFields,
  voxelIsEmpty,
  voxelShiftFrom,
} from './carve_voxel_core';

// Reserved marker assetIds for the cave rig flow. Ordinary placements
// (gizmo-movable, undoable, saved); placement.name carries the shared cave id.
const CAVE_ENTRANCE_ASSET_ID = 'cave/entrance';
const CAVE_EXIT_ASSET_ID = 'cave/exit';
// Blue rig waypoint between the entrance and the exit (Caves tool clicks
// after the first). The rig's LAST point acts as the exit.
const CAVE_POINT_ASSET_ID = 'cave/point';
// Control-point cap per rig (the generated node chain has its own sim cap).
const MAX_CAVE_RIG_POINTS = 24;
// Organic wobble a fresh cave generates with (Cave card slider re-bores).
const DEFAULT_CAVE_VARIANCE = 0.35;
// Patrol authoring: the default walk pace (matches npc_routes' own default) and
// the Mob tool's route-preview colour, kept distinct from City Build's amber.
const DEFAULT_ROUTE_SPEED = 2.2;
const MOB_ROUTE_PREVIEW_COLOR = 0xff7a59;
// The road selected in the Roads tab's Edit mode: a cool blue, apart from the
// amber of a road being drawn.
const ROAD_EDIT_PREVIEW_COLOR = 0x6fd0ff;

/** Clamp a number into an inclusive range. */
function clampNum(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Deterministic per-cave wobble seed from its id (stable across regens). */
function caveWobbleSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100000;
  return h;
}

import { assetUrl } from '../render/assets/media';
import { rockSeed } from '../render/rock_gen';
import { meshTerrainHeight } from '../render/terrain_mesh_height';
import { builtinShaFor, terrainTextureSet } from '../render/terrain_texture_sets';
import {
  setTreeVolumeOverlay,
  treeCollideRadius,
  treeHeight,
  treePreset,
  treeSeed,
  treeVolumeOverlayEnabled,
} from '../render/tree_gen';
import {
  type AssetCollisionOverride,
  analyzeBakedFootprint,
  applySessionCollisionOverride,
  autoCollideRadius,
  boxesForAssetId,
  collisionOverrideFor,
} from '../sim/asset_collision';
import { ASSET_COLLISION } from '../sim/asset_collision.generated';
import {
  CAMP_STAT_MOD_KEYS,
  campStatModsAreStock,
  MAX_AUTHORED_CAMP_LEVEL,
  MAX_CAMP_RESPAWN_SECONDS,
  MIN_CAMP_RESPAWN_SECONDS,
  MOB_STAT_MOD_MAX,
  MOB_STAT_MOD_MIN,
} from '../sim/camp_authoring';
import { CLUTTER_ALL_KINDS, type ClutterStamp, MAX_CLUTTER_STAMPS } from '../sim/city_clutter';
import {
  COLLIDER_ASSET_IDS,
  type ColliderVolumeKind,
  colliderKindFor,
  colliderVolumeFromPlacement,
} from '../sim/collider_volumes';
import { invalidateStaticColliders } from '../sim/colliders';
import {
  BUILTIN_WORLD,
  MOBS,
  PLAYER_START,
  STRIP_MAX_X,
  STRIP_MIN_X,
  setActiveWorldContent,
  touchActiveWorldContent,
  WORLD_MAX_X,
} from '../sim/data';
import { sanitizeAssetFireEmitter } from '../sim/fire_effects';
import {
  FLUID_ASSET_IDS,
  FLUID_DEFAULT_OFFSET_Y,
  FLUID_DEFAULT_SIZE,
  type FluidKind,
  fluidKindFor,
  fluidVolumesFromPlacements,
} from '../sim/fluid_volumes';
import { addGrassClearStamp, type GrassClearCircle } from '../sim/grass_clear';
import { generateGroundDressing } from '../sim/ground_dressing';
import {
  type CollisionMode,
  CUSTOM_PAINT_ID_MIN,
  clampBlockerSegment,
  collideRadiusFor,
  DEFAULT_ASSET_VIEW_DISTANCE,
  DEFAULT_MODEL_TEX_TILE,
  DEFAULT_PAINT_EDGE_DETAIL,
  DEFAULT_PAINT_EDGE_SOFTNESS,
  DEFAULT_SWATCH_DEPTH,
  DETAIL_CELL_MAX,
  DETAIL_CELL_MIN,
  effectiveCollisionMode,
  GRASS_PATCH_ASSET_ID,
  isCustomPaintId,
  MAX_ASSET_COLLISION_MESH_BOXES,
  MAX_ASSET_VIEW_DISTANCE,
  MAX_AUTHORING_NOTES_LENGTH,
  MAX_AXIS_SCALE,
  MAX_BLOCKERS,
  MAX_CAMP_COUNT,
  MAX_CAMP_RADIUS,
  MAX_CAMPS,
  MAX_COLLIDE_RADIUS,
  MAX_COLLIDER_SIZE,
  MAX_COLLIDER_SIZE_Y,
  MAX_CUSTOM_PAINT_SWATCHES,
  MAX_DECALS,
  MAX_DETAIL_RADIUS,
  MAX_DETAIL_REGIONS,
  MAX_GRASS_CLEAR,
  MAX_LIGHTS,
  MAX_LOCATION_NAME,
  MAX_LOCATIONS,
  MAX_MARKERS,
  MAX_MUSIC_AREAS,
  MAX_NPC_ROUTE_POINTS,
  MAX_NPC_ROUTE_WAIT,
  MAX_NPCS,
  MAX_PLACEMENT_HITBOXES,
  MAX_PLACEMENT_NAME_LENGTH,
  MAX_PLACEMENT_RAMPS,
  MAX_PLACEMENT_Y_OFFSET,
  MAX_PLACEMENTS,
  MAX_POINT_SOUNDS,
  MAX_ROADS,
  MAX_ROCK_NODES,
  MAX_SWATCH_LABEL_LENGTH,
  MAX_TERRAIN_EDITS,
  MAX_TERRAIN_KNOCKOUTS,
  MAX_TERRAIN_VERTEX_EDITS,
  MAX_TIME_SCALE,
  MAX_WEATHER_SCHEDULE,
  type MapHitbox,
  MIN_ASSET_VIEW_DISTANCE,
  MIN_AXIS_SCALE,
  MIN_COLLIDE_RADIUS,
  MIN_COLLIDER_SIZE,
  MIN_COLLIDER_SIZE_Y,
  MIN_TIME_SCALE,
  MODEL_ASSET_ID,
  NPC_ROUTE_SPEED_MAX,
  NPC_ROUTE_SPEED_MIN,
  nextCustomPaintId,
  ROCK_ASSET_ID,
  ROCK_POINT_ASSET_ID,
  ROCK_RIDGE_ASSET_ID,
  type RoadDef,
  TREE_ASSET_ID,
  WATERFALL_ASSET_ID,
  type WallRunDef,
} from '../sim/map_doc';
import {
  cloneMaterialFinishes,
  type MaterialFinishes,
  withMaterialFinish,
} from '../sim/material_finishes';
import { hash2 } from '../sim/rng';
import type { TreeParams } from '../sim/tree_params';
import {
  type AssetFireEmitter,
  type AuthorVfx,
  type BiomePaint,
  type BlockerDef,
  type CampDef,
  type CampStatMods,
  type CaveDef,
  type CaveNode,
  type CustomPaintSwatch,
  type DetailRegion,
  emptyZoneProps,
  type HeightStamp,
  type MapDecal,
  type MapWeather,
  type NpcDef,
  type NpcRoute,
  type NpcRoutePoint,
  type TerrainBrushAlphaId,
  type TerrainCut,
  type TerrainKnockout,
  type TerrainStyle,
  type TerrainVertexEdit,
  type WorldContent,
  type ZoneAtmosphere,
} from '../sim/types';
import type { WallFinish } from '../sim/wall_finishes';
import {
  biomeAt,
  generateDecorationsInBounds,
  invalidateTerrainEditIndex,
  roadDistance,
  terrainHeight,
  WATER_LEVEL,
  waterLevel,
} from '../sim/world';
import { tEntity } from '../ui/entity_i18n';
import { formatNumber, t } from '../ui/i18n';
import { loadMapArt } from '../ui/map_art';
import { Editor3DViewport, type GizmoCutChange, type GizmoHitboxChange } from './3d/viewport';
import { AssetBrowser } from './asset_browser';
import { ASSET_CATALOG, assetById } from './asset_catalog.generated';
import { classifyCell, isTownStructure, makeRetexNoise, RETEX_SWATCHES } from './auto_retexture';
import { visitBiomeBrushCells } from './biome_brush_core';
import { finestPaintCell, growBiomePaint, resampleBiomePaint } from './biome_paint_core';
import { nearestBlockerIndex } from './blocker_core';
import { brushAlphaById, importBrushAlpha, sampleBrushAlpha } from './brush_alphas';
import { BuildTransformControls } from './build_transform_controls';
import { BuildingWorkspace } from './building_workspace';
import { BundleDependencyError, buildMapBundle, zipStore } from './bundle';
import { flySpeedFromWheel } from './camera_speed_core';
import { STREAM_ZONE_COUNT, zoneForCamera, zoneSetForCamera } from './camera_zone_core';
import { resolveCampClick } from './camp_core';
import { draw } from './canvas';
import { generateCaveRigNodes } from './cave_gen_core';
import {
  type CityBuildSettings,
  type CityPrefab,
  cityPlacementIndices,
  combinedRoads,
  generateWallPieces,
  generateWallStairs,
  ghostBlocked,
  nextCityId,
  pathHasNode,
  polylineBounds,
  rebaseAsPrefab,
  sanitizeCityPrefabs,
  sanitizeCitySettings,
  snapAngleRad,
  snapPoint,
  stampPrefab,
  tileSnapPoint,
  WALL_STYLES,
  WALL_TOWER_ASSET,
  WALL_TOWER_SRC,
  wallFootprintOrFallback,
  wallPiecesToPlacements,
  wallStyleById,
  wallTopModelY,
  wallTopRamps,
  wallTowerFit,
  withoutLastPathPoint,
} from './city_build_core';
import type { CityBuildPanelDeps, CityRoadSelection, CitySubtool } from './city_build_panel';
import {
  applyClutterBrush,
  type ClutterBrush,
  clutterStampDue,
  DEFAULT_CLUTTER_BRUSH,
} from './clutter_paint_core';
import {
  applyCmGizmo,
  type CmMesh,
  cloneMesh,
  cmBox,
  cmCylinder,
  cmPlane,
  cmSphere,
  cmWedge,
  deleteMeshComponents,
  extrudeEdge,
  extrudeFace,
  faceNormal,
  fillMeshSelection,
  insetMeshFace,
  loopCut,
  meshFromHitbox,
  meshToHitboxes,
  meshToRamp,
  mirrorMesh,
  roundMesh,
  sanitizeCmMesh,
  subdivideMesh,
  vertsCentroid,
  weldMeshVertices,
} from './cm_mesh';
import {
  type CmSculptSymmetry,
  type CmSculptTool,
  sculptCmMeshSymmetric,
} from './cm_mesh_sculpt_core';
import { planCollisionAdoption } from './collision_adopt_core';
import { applyDefaultCollision } from './collision_defaults';
import { type CmTopologyAction, CollisionMasterBar } from './collision_master_bar';
import {
  type AssetPlacement,
  BLANK_MAP_WATER_LEVEL,
  CUSTOM_MAP_VERSION,
  type CustomMap,
  customMapToWorldContent,
  effectiveCollideRadius,
  mapBounds,
  newCustomMap,
  newFlatCustomMap,
  promotedSceneryFor,
  zoneGraveyards,
} from './custom_map';
import {
  applyCutChange,
  type CutBrush,
  type CutChange,
  cutSummary,
  DEFAULT_CUT_BRUSH,
  makeCut,
  sameCut,
} from './cut_tool_core';
import {
  type DecalBrush,
  decalEntry,
  decalName,
  importDecalImage,
  loadDecalBrush,
  saveDecalBrush,
  warmDecalThumbs,
} from './decal_tool';
import { button, checkbox, el, slider } from './dom';
import { AUTHORED_DUNGEONS } from './dungeon/authored_dungeons';
import { DungeonEditorMode } from './dungeon/dungeon_mode';
import { capRoom, clampToCap } from './edit_caps_core';
import type { MapRect } from './editor_map_core';
import { type EditorMapDeps, EditorMapWindow, EditorMinimap } from './editor_map_ui';
import { transitionEditorViewport } from './editor_viewport_transition';
import { buildCharacterVisualOptions, buildMobCatalogOptions } from './entity_authoring';
import {
  isMovableEntity,
  pickMovableEntity,
  splitCampIntoIndividuals,
  toggledMobSelection,
} from './entity_edit_core';
import { type EntityPasteHost, pasteMobs, pasteNpcs } from './entity_paste';
import {
  bundleDependencyRefs,
  ExportCompatibilityError,
  type PreparedMapExport,
  prepareMapForEngine,
} from './export_contract';
import { promoteFeatureDressing } from './feature_prop_placements';
import {
  downloadCollisionOverride,
  downloadMap,
  downloadPublishedMap,
  downloadRegionModule,
  importMapBundleBytes,
  pickMapOrBundle,
} from './file_io';
import { bakeFoliageToGlb } from './foliage_bake';
import { foliageSlug } from './foliage_bake_core';
import {
  AMBIENT_TREE_EDIT_BATCH,
  ambientDecorationKey,
  ambientDecorationsToPlacements,
  closestAmbientDecorations,
} from './foliage_edit_core';
import {
  applyGroundSeat,
  flattenStrokeTarget,
  type GroundSeat,
  groundSeatOf,
  isOnGround,
  seatOnGround,
} from './ground_level_core';
import { bakeImportedModelCollision, bakeTrueModelCollision } from './import_collision';
import {
  BIOME_OPTIONS,
  Inspector,
  type MobToolSelection,
  type PlacementSelection,
  type ResolvedWeather,
} from './inspector';
import {
  isLocalAssetId,
  localAssetIdFor,
  localAssetLabel,
  localAssetUrl,
  registerLocalAsset,
} from './local_assets';
import { loadStoredLocalAssets, storeLocalAssetBytes } from './local_assets_db';
import { repairMissingTreeCollision, repairPlacedAssetShapes } from './map_asset_migration';
import { MapDrawer, type PublishedMapMeta } from './map_drawer';
import { MapIO } from './map_io';
import { ensureMapItemIds } from './map_item_ids';
import { upgradeLoadedMap } from './map_load_upgrades';
import {
  emitPublishedMapModule,
  mapPublishSlug,
  vendorPublishedAssetCollision,
} from './map_publish_core';
import { fetchRepoMap, pushMapChanges } from './map_push';
import { showPushConflicts } from './map_push_report';
import {
  addKnockout,
  eraseKnockouts,
  knockoutRegion,
  MESH_FIX_MAX_RADIUS,
  MESH_FIX_MIN_RADIUS,
} from './mesh_fix_core';
import {
  buildEntities,
  type EditorEntity,
  type EntityKind,
  snapshot,
  type ZoneContent,
} from './model';
import { EditorApiError, forkMap, type MapFullWire, signedIn, uploadAsset } from './net';
import { newMapSizeDialog } from './new_map_dialog';
import { ObjectMoveController } from './object_move_controller';
import { buildObjectMovePanel, buildRemovedObjectsPanel } from './object_move_panel';
import { parseMap, serializeMapForRepo } from './persist';
import { applyScaleEqualize, type EqualizePlan, planScaleEqualize } from './placement_scale_core';
import {
  CommitCoalescer,
  groupMemberPoint,
  NORTH_UP_YAW,
  NUDGE_STEP_BIG_YD,
  NUDGE_STEP_YD,
  type NudgeKey,
  nudgeDelta,
  PLACEMENT_SCALE_MAX,
  PLACEMENT_SCALE_MIN,
  rotateStep,
  scaleStep,
  wrapAngle,
} from './placement_transform_core';
import {
  clearPlaytestRecoveryDraft,
  DEFAULT_PLAYTEST_SEED,
  launchPlaytest,
  loadPlaytestRecoveryDraft,
  PLAYTEST_RESUME_KEY,
  savePlaytestRecoveryDraft,
} from './playtest';
import { DEFAULT_POINT_SOUND } from './point_sounds';
import { createPondCommand } from './pond_commands';
import {
  DEFAULT_POND_DEPTH,
  DEFAULT_POND_RADIUS,
  POND_BANK_RADIUS_FACTOR,
  POND_DEPTH_MAX,
  POND_DEPTH_MIN,
  POND_RADIUS_MAX,
  POND_RADIUS_MIN,
  planPond,
  pondTerrainMatches,
} from './pond_core';
import {
  applyCollisionShare,
  type PrefabAuthoredCollision,
  splitPrefabCollision,
} from './prefab_collision_core';
import { prefabPiecesFor } from './prefab_pieces.generated';
import { explodePrefab, type PrefabPiecesDef } from './prefab_pieces_core';
import { groupMembers, newGroupId, prefabOfSelection, rejoinPrefab } from './prefab_rejoin_core';
import { type Bounds, makeRng, scatterHills, scatterPlacements } from './procgen';
import {
  emitRegionModule,
  regionExportFromMap,
  regionModulePath,
} from './regions/region_export_core';
import { RoadEditController } from './road_edit_controller';
import {
  applyRoadEdits,
  builtinRoadState,
  type RoadLayers,
  type RoadRef,
  roadPoints,
} from './road_edit_core';
import { EditGeneration, shouldAutosave } from './save_lifecycle_core';
import {
  type CopiedNpc,
  cloneAssetPlacement,
  copyCampSelection,
  copyNpcSelection,
  copyPlacementSelection,
  marqueePlacementSelection,
  pastePlacementSelection,
  toggledKeySelection,
} from './selection_clipboard';
import { SelectionQuickActions, type SelectionQuickActionsDeps } from './selection_quick_actions';
import { editorErrorKey } from './server_errors_core';
import { createShippedMap } from './shipped_maps';
import { type SlopePoint, type SlopeRamp, slopeStamp } from './slope_core';
import { appendSpan, removeSpan } from './span_core';
import {
  erasePlacementIndex,
  flattenStamp,
  noiseStamp,
  pickPlacementIndex,
  SCULPT_POWER_SCALE,
  sharpenStamp,
  smoothStamp,
  stampRegion,
  terraceStamp,
  unionRegion,
} from './stamp_core';
import { buildModal, confirmDialog, optOutConfirmDialog, promptDialog, Toasts } from './toasts';
import { type EditorTool, TOOL_BY_KEY, Toolbar } from './toolbar';
import { Topbar } from './topbar';
import { TutorialLoader } from './tutorial_loader';
import { UndoStack } from './undo_core';
import {
  isUserAssetId,
  registerUserAssets,
  userAssetIdFor,
  userAssetLabel,
  userAssetPath,
} from './user_assets';
import {
  applySelection,
  clearVertexEdits,
  moveVertices,
  nearestVertex,
  packVertex,
  type SelectMode,
  unpackVertex,
  vertexEditRegion,
  vertexWorld,
  verticesNear,
} from './vertex_edit_core';
import { Camera, pickHandle, type ScreenPoint, type Vec2, type Viewport } from './view';
import { generateTerrainDialog, worldLinkDialog } from './world_link';
import {
  promoteEditablePalms,
  promoteFarshorePalms,
  promoteMajorWorldProps,
  promoteStreetlamps,
  promoteWillows,
  repairDecorBuildingCollision,
  repairLegacyWorldPropFit,
  repairStretchedWorldProps,
  withoutEditableWorldProps,
  withoutMajorWorldProps,
} from './world_prop_placements';
import {
  buildSceneTree,
  isolateViewDistance,
  propsWithinRect,
  type ZoneRect,
  zoneRectOf,
  zonesUnionRect,
} from './zone_isolate_core';

const KINDS: EntityKind[] = ['hub', 'graveyard', 'lake', 'poi', 'camp', 'npc', 'object'];

/** The Blender-style transform trio; they keep (and require) a selection, and
 *  drive it through the same drag machinery as Select-mode direct move. */
function isTransformTool(tool: EditorTool): tool is 'move' | 'rotate' | 'scale' {
  return tool === 'move' || tool === 'rotate' || tool === 'scale';
}

/** Tools that select and manipulate placements (Select is pick-only). */
function isSelectionTool(tool: EditorTool): boolean {
  return tool === 'select' || isTransformTool(tool);
}

/** The terrain sculpt family: these route to the stroke pipeline, and holding
 *  Shift while stroking applies the OPPOSITE sub-mode (raise<->lower,
 *  smooth<->flatten). */
function isSculptTool(tool: EditorTool): boolean {
  return (
    tool === 'raise' ||
    tool === 'lower' ||
    tool === 'smooth' ||
    tool === 'flatten' ||
    tool === 'slope'
  );
}
// The built-in meadow grass's perceived blade hue/lightness (render
// grass_patch.ts DEFAULT_HUE / TINT_L): the foliage brush's defaults, so
// painted grass matches ambient until the maker themes it. Lightness is a
// percent for the slider; clump is tufts per patch.
const GRASS_DEFAULT_HUE = 105;
const GRASS_DEFAULT_LIGHT = 55;
const GRASS_DEFAULT_CLUMP = 16;
const AUTOSAVE_MS = 30_000;
// Unconditional periodic full save of the current map's stored JSON (the
// local map store), independent of the opt-in autosave toggle.
const LOCAL_SAVE_MS = 600_000;
const AUTOSAVE_PREF_KEY = 'woc_editor_autosave';
const FREE_FLY_PREF_KEY = 'woc_editor_freefly';
const SHOW_BOUNDARY_PREF_KEY = 'woc_editor_show_boundary';
const BIRDS_PREF_KEY = 'woc_editor_birds';
const SNOWFALL_PREF_KEY = 'woc_editor_snowfall';
const INVERT_PAN_PREF_KEY = 'woc_editor_invert_pan';
const SHOW_PLAYER_PREF_KEY = 'woc_editor_show_player';
const LIGHTING_PREF_KEY = 'woc_editor_lighting';
const CAMERA_SPEEDS_PREF_KEY = 'woc_editor_camera_speeds';
const VISIBILITY_PREF_KEY = 'woc_editor_visibility_v2';
const HIDE_COLLIDERS_PREF_KEY = 'woc_editor_hide_colliders';
const HIDE_LOCATIONS_PREF_KEY = 'woc_editor_hide_locations';
const PERF_OVERLAY_PREF_KEY = 'woc_editor_perf_overlay';
const WIREFRAME_PREF_KEY = 'woc_editor_wireframe';

// Camera-toggle icons for the top bar (16px, stroke = currentColor, no
// emoji per the repo copy rule; each mirrors an inspector Camera switch).
const CAM_ICONS = {
  freeFly:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 11l18-7-7 18-2.5-8.5L3 11z"/></svg>',
  invert:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4v14M8 18l-3-3M8 18l3-3M16 20V6M16 6l-3 3M16 6l3 3"/></svg>',
  player:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="6.5" r="3"/><path d="M5.5 21c.7-4.4 3.2-7 6.5-7s5.8 2.6 6.5 7"/></svg>',
  boundary:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 3"><rect x="4" y="4" width="16" height="16" rx="1"/></svg>',
  wireframe:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3L3 20h18L12 3zM12 3l-2.5 8.5M12 3l2.5 8.5M9.5 11.5h5M9.5 11.5L7 20M14.5 11.5L17 20"/></svg>',
  xray: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  footprints:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="8" width="12" height="12" rx="1"/><path d="M9 8V4h12v12h-4"/></svg>',
};
const XRAY_PREF_KEY = 'woc_editor_xray';
const AXIS_GIMBAL_PREF_KEY = 'woc_editor_axis_gimbal';
// One-shot compatibility key for a Collision Master return camera left by an
// older reload-based editor build. Current Lock In returns without reloading.
const CM_RETURN_CAM_KEY = 'woc_editor_cm_return_cam';
// The last editor camera pose, per map id: saved on pagehide so a page reload
// drops the maker back exactly where they were looking (not the frame-all
// default). localStorage (survives the reload), keyed by map so it only ever
// reapplies to the map it belongs to.
const EDITOR_CAM_KEY = 'woc_editor_last_cam';
// Collision hitbox overlay. The stored value is '1'/'0'; unset reads as off
// (see the footprintsOn field for why).
const FOOTPRINTS_PREF_KEY = 'woc_editor_show_hitboxes';
// One-shot repair key, see repairFootprintPref().
const FOOTPRINTS_REPAIR_KEY = 'woc_editor_show_hitboxes_repair1';
// Per-asset hand-edited hitbox presets (this device only): new placements of
// an asset copy its saved boxes.
const HITBOX_PRESETS_PREF_KEY = 'woc_editor_hitbox_presets';
/** Ask "save as preset?" after a Collision Master Lock In (default on). */
const CM_PRESET_PROMPT_PREF_KEY = 'woc_editor_cm_preset_prompt';
const CITY_SETTINGS_PREF_KEY = 'woc_editor_city_settings';
const CITY_PREFABS_PREF_KEY = 'woc_editor_city_prefabs';
// Zone isolate (Full Build ⇄ Zone): per map like the camera, one key holding
// { mapId, zoneId }, validated against the open map on read.
const ZONE_ISOLATE_PREF_KEY = 'woc_editor_zone_isolate';
const CAMERA_ZONE_PREF_KEY = 'woc_editor_camera_zone_stream';
const STREAM_GUIDE_PREF_KEY = 'woc_editor_stream_guide';
/** How often the camera's zone is sampled while the stream is on. */
const CAMERA_ZONE_POLL_MS = 250;
/** How long the camera must SETTLE in a new zone before it is streamed. Flying
 *  across three zones costs one rebuild at the far end, not three on the way. */
const CAMERA_ZONE_SETTLE_MS = 600;
const WATER_DEBOUNCE_MS = 100;

/** Boolean editor preference read; blocked storage reads as off. */
function readPref(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Boolean preference that defaults ON: only an explicit stored '0' turns it
 *  off (unset or blocked storage reads as on). */
function readPrefDefaultOn(key: string): boolean {
  try {
    return localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

/** Boolean editor preference write; blocked storage keeps the session value. */
function writePref(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Blocked storage: the toggle still works for this session.
  }
}

/**
 * Undo, once per browser, the collision-overlay preference that opening a
 * shipped map used to clobber.
 *
 * That path forced "Show collision footprints" off AND persisted '0' on EVERY
 * shipped-map open, so a stored '0' records that bug far more often than a
 * maker's decision, and once written it kept the overlay off for good, which
 * reads as "this map has no collision". The clobber is gone; this clears the
 * value it left behind. A maker who genuinely wants the overlay off toggles it
 * off and it now stays off, so the repair can only ever cost one click.
 */
function repairFootprintPref(): void {
  try {
    if (localStorage.getItem(FOOTPRINTS_REPAIR_KEY) === '1') return;
    localStorage.setItem(FOOTPRINTS_REPAIR_KEY, '1');
    if (localStorage.getItem(FOOTPRINTS_PREF_KEY) === '0') {
      localStorage.setItem(FOOTPRINTS_PREF_KEY, '1');
    }
  } catch {
    // Blocked storage never persisted the bug, so there is nothing to repair.
  }
}
// Runs at module load, so it lands before the footprintsOn field initializer
// below reads the preference.
repairFootprintPref();

/** JSON preference write; blocked storage keeps the setting session-only. */
function writeJsonPref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* session-only */
  }
}

/** JSON preference read, or null on blocked storage / malformed value. */
function readJsonPref<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

interface RegionBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}
interface Clipboard {
  placements: AssetPlacement[]; // relative to center
  edits: HeightStamp[]; // relative to center
}

type SelectionClipboard =
  | { kind: 'placements'; items: AssetPlacement[] }
  | { kind: 'mobs'; items: CampDef[] }
  | { kind: 'npcs'; items: CopiedNpc[] };

interface CityWallRuntimeState {
  def: WallRunDef;
  placements: AssetPlacement[];
}

interface PlaytestRestore {
  map: CustomMap;
  dirty: boolean;
}

const LAYER_KEYS: Record<EntityKind, string> = {
  hub: 'editor.layers.hub',
  graveyard: 'editor.layers.graveyard',
  lake: 'editor.layers.lake',
  poi: 'editor.layers.poi',
  camp: 'editor.layers.camp',
  npc: 'editor.layers.npc',
  object: 'editor.layers.object',
};

const BRUSH_COLOR: Partial<Record<EditorTool, number>> = {
  raise: 0xffd100,
  lower: 0x5aa0ff,
  smooth: 0x9fdc7f,
  flatten: 0xd8c27a,
  slope: 0xe0a85a,
  erase: 0xe0503c,
  place: 0x3fd0ff,
  foliage: 0x69d84f,
  grassclear: 0x7bc86c,
  collider: 0x3ddc6a,
  camp: 0xd9534f,
  spawn: 0x3fd0ff,
};

/** FORK: one volume a Dig/Fill stroke writes, with what its undo needs. */
interface VoxelStrokeTarget {
  op: 'dig' | 'fill' | 'restore';
  cut: TerrainCut;
  list: TerrainCut[];
  created: boolean;
  box: VoxelBox | null;
  snap: Int8Array | null;
  grewFrom: VoxelFields | null;
  removed: boolean;
}

export class EditorApp {
  private buildingWorkspace!: BuildingWorkspace;
  private buildTransformControls!: BuildTransformControls;
  private fineBuildRotation = false;
  private keepAssetBrowser = false;
  private placeRotation = 0;
  // ---- document + active world ------------------------------------------------
  private map: CustomMap;
  private activeWorld!: WorldContent;
  private content: ZoneContent;
  private entities: EditorEntity[];
  private base: Map<string, Vec2>;

  // ---- chrome -------------------------------------------------------------------
  private readonly topbar: Topbar;
  private readonly toolbar: Toolbar;
  private readonly inspector: Inspector;
  private readonly assets: AssetBrowser;
  private readonly drawer: MapDrawer;
  private readonly toasts: Toasts;
  private readonly tutorial: TutorialLoader;

  // ---- stage -----------------------------------------------------------------
  private readonly stage2d: HTMLElement;
  private readonly stage3dEl: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cam = new Camera({ x: 0, z: 0 }, 2);
  private viewMode: '3d' | '2d' = '3d';
  // Blender-style perspective/orthographic lens. Session-only: changing the
  // modeling view never dirties or changes the authored map.
  private orthographicOn = false;
  private viewport3d: Editor3DViewport | null = null;
  private markerMovedWhile2d = false;

  // ---- editing state -----------------------------------------------------------
  private tool: EditorTool = 'select';
  private brushRadius = 18;
  // Sculpt strength SLIDER value (1..50). The height math consumes it divided
  // by BRUSH_STRENGTH_SCALE, so every step is a fifth of the legacy 1..30
  // scale's ? fine control at the low end without losing the old ceiling
  // (50/5 = 10; the default 30/5 = 6 matches the legacy default of 6).
  private brushStrength = 30;
  private paintBiome = 1;
  private flattenHardEdge = false;
  private placeAssetId: string | null = null;
  private placeAssetLabel: string | null = null;
  private placeScale = 1;
  // Placed assets collide by default (baked hitboxes); uncheck to opt out.
  private placeCollide = true;
  private placeRandomRot = true;
  private scatterCount = 80;
  private campMobId: string = Object.keys(MOBS)[0] ?? 'boar';
  private colliderShape: ColliderVolumeKind = 'box';
  // Foliage brush settings + per-stroke buffer (one undo entry per stroke).
  private foliage = {
    density: 3,
    minScale: 0.7,
    maxScale: 1.6,
    collide: false,
    // Animated grass-tuft patches (the built-in world's grass cards) + their
    // theme color (hue in degrees, lightness in percent) and clump size
    // (tufts per patch, 1 = single strands); the GLB families follow.
    grass: true,
    grassHue: GRASS_DEFAULT_HUE,
    grassLight: GRASS_DEFAULT_LIGHT,
    grassClump: GRASS_DEFAULT_CLUMP,
    ferns: true,
    bushes: true,
    trees: true,
    rocks: false,
  };
  // Custom foliage brush asset: when set, the foliage brush scatters ONLY this
  // catalogue/uploaded asset (with the same density/scale/collide controls)
  // instead of the built-in group pool. Null = the built-in behaviour.
  private foliageCustom: { assetId: string; label: string } | null = null;
  private foliageStroke: AssetPlacement[] = [];
  private foliageStart = 0;
  private foliageLast: Vec2 | null = null;
  private foliageCapWarned = false;
  private foliagePoolWarned = false;
  // Paint Clutter brush settings + per-stroke buffer (one undo entry per
  // stroke). Stamps live on the document (map.clutter); the renderer scatters
  // the pieces itself, so painting never touches the placement list.
  private clutter: ClutterBrush = { ...DEFAULT_CLUTTER_BRUSH };
  private clutterStroke: readonly ClutterStamp[] | null = null;
  private clutterStrokeStart: ClutterStamp[] | undefined;
  private clutterLast: Vec2 | null = null;
  private clutterCapWarned = false;
  // Mesh Fix brush: restore mode + the stroke's working list (one undo per stroke).
  private meshFixRestore = false;
  private meshFixStroke: readonly TerrainKnockout[] | null = null;
  private meshFixStrokeStart: readonly TerrainKnockout[] | null = null;
  private meshFixCapWarned = false;
  // Mesh Fix "Vertices" mode (editor/vertex_edit_core.ts): the lattice window
  // under the cursor, the selection, and the live drag.
  private meshFixVertexMode = false;
  private vertexSel: ReadonlySet<number> = new Set<number>();
  private vertexDotIds: number[] = [];
  private vertexDotPos: Float32Array | null = null;
  private vertexWindowAt: Vec2 | null = null;
  private vertexDrag: {
    kind: 'box' | 'move';
    clientX: number;
    clientY: number;
    lastX: number;
    lastY: number;
    startEdits: readonly TerrainVertexEdit[];
    startSel: ReadonlySet<number>;
    mode: SelectMode;
    changed: boolean;
  } | null = null;
  // ---- City Build workspace state ----------------------------------------------
  // Subtool + persisted build settings (grid size / rotation snap).
  private citySubtool: CitySubtool = 'kit';
  private citySettings: CityBuildSettings = sanitizeCitySettings(
    readJsonPref(CITY_SETTINGS_PREF_KEY),
  );
  // Kit placement: the armed rotation (R rotates by the snap step).
  private cityKitRot = 0;
  // Connect-tiles height anchor: the first tile placed freezes the ground
  // level, and every connected tile after it locks to the same height axis
  // (detached placements at this groundY) instead of re-seating on terrain.
  // Null = no anchor yet; reset on asset/subtool/tool change and Esc.
  private cityTileLevel: number | null = null;
  // Wall drawing state.
  private cityWallStyle: string = WALL_STYLES[0].id;
  // 2x the original defaults: scale-6 walls with a double-thick body read as
  // real fortifications (SPACEY: "nice scale walls"), and the walk deck gets a
  // comfortable width instead of a plank.
  private cityWallScale = 6;
  private cityWallHeight = 1;
  private cityWallThickness = 2;
  private cityWallPostEvery = 0;
  private cityWallClosed = false;
  // Rampart options: a walkable deck along the wall top, and stairs pieces
  // climbing up to it.
  private cityWallWalkTop = true;
  private cityWallStairs = true;
  private cityWallPoints: Vec2[] = [];
  // The most recently built or selected authored run. Wall controls update
  // this run live whenever no new path is being drawn.
  private cityActiveWallId: string | null = null;
  private cityWallUpdateRevision = 0;
  private cityWallFinishing = false;
  private readonly cityWallRuntime = new Map<string, CityWallRuntimeState>();
  // Road drawing state.
  private cityRoadKind: 'road' | 'path' = 'road';
  private cityRoadPoints: Vec2[] = [];
  // Roads tab mode: draw a new road, or edit the roads already on the map.
  private cityRoadMode: 'draw' | 'edit' = 'draw';
  // What the Edit mode handles last drew (skips identical hover redraws).
  private roadPreviewDrawn: {
    points: readonly { x: number; z: number }[];
    highlight: number | null;
    r: number;
  } | null = null;
  // Prefab library (localStorage) + the prefab armed for stamping.
  private cityPrefabs: CityPrefab[] = sanitizeCityPrefabs(readJsonPref(CITY_PREFABS_PREF_KEY));
  private cityArmedPrefab: string | null = null;
  // Route editing: the NPC key whose route is being authored + working copy.
  private cityRouteNpcKey: string | null = null;
  private cityRoutePoints: { x: number; z: number; wait?: number }[] = [];
  private cityRouteMode: 'loop' | 'pingpong' = 'loop';
  private cityRouteSpeed = 2.2;
  private cityRouteWait = 0;
  // Measured world-yard bounds per asset id (wall fitting, walk decks,
  // stairs), cached.
  private cityFootprints = new Map<string, { sizeX: number; sizeZ: number; sizeY: number }>();

  /**
   * The user's manual footprint-overlay toggle ("Show collision footprints",
   * Camera panel); the effective overlay also forces on while authoring
   * collision (see syncFootprintOverlay).
   *
   * Off until asked for, on the grounds that a dense map can carry thousands of
   * outline meshes. Worth knowing before revisiting that: the dense maps do not
   * actually draw any. A kit conversion's collision is `collider/<kind>`
   * volumes, which this overlay never sees, so every dungeon, delve and arena
   * draws ZERO outlines; only the overworld (~1191) and Thornhollow (~864) draw
   * any at all. Covered by tests/editor_thornhollow_collision.
   */
  private footprintsOn = readPref(FOOTPRINTS_PREF_KEY);
  // Per-asset hitbox presets (localStorage): assetId -> normalized boxes.
  private hitboxPresets: Record<string, MapHitbox[]> =
    readJsonPref<Record<string, MapHitbox[]>>(HITBOX_PRESETS_PREF_KEY) ?? {};
  // Hitbox edit mode: individual baked boxes of ONE placement become
  // selectable/transformable objects (Shift/Ctrl+click multi-select).
  private hitboxEdit: { index: number; selected: Set<number> } | null = null;
  // Snapshot of the boxes at gizmo-gesture start (one undo entry per gesture).
  private hitboxDragBase: MapHitbox[] | null = null;
  // Assets whose "true collision" fine bake is currently running.
  private readonly meshBakesInFlight = new Set<string>();
  // Camera preferences (persisted): Free-Fly navigation and inverted drag-pan.
  // Free-Fly is ON by default (WASD/QE fly + mouse-look is the default editor
  // feel); a stored '0' keeps a maker who turned it off, off.
  private freeFlyOn = readPrefDefaultOn(FREE_FLY_PREF_KEY);
  // Invert camera defaults OFF: the uninverted drag direction is the one the
  // editor ships with, and the checkbox is the opt-in.
  private invertPanOn = readPref(INVERT_PAN_PREF_KEY);
  /** Draw the streamed rect's edges as light red walls (Scene panel). */
  private streamGuideOn = readPref(STREAM_GUIDE_PREF_KEY);
  // The playtest player stand-in model; removed by default (game-editor feel).
  private showPlayerOn = readPref(SHOW_PLAYER_PREF_KEY);
  // Map-limit wall overlays; OFF by default (uncluttered viewport), shown when a
  // maker explicitly turns them on from the Camera tab.
  private showBoundaryOn = readPref(SHOW_BOUNDARY_PREF_KEY);
  // Collision-volume overlays; shown by default, hideable from the Collider tab.
  private collidersHiddenOn = readPref(HIDE_COLLIDERS_PREF_KEY);
  // Named-location area boxes; shown by default, hideable from the Zone tool.
  private locationsHiddenOn = readPref(HIDE_LOCATIONS_PREF_KEY);
  // Preview-only snowfall visibility, remembered without changing the map.
  private snowfallOn = readPrefDefaultOn(SNOWFALL_PREF_KEY);
  // "Scale all copies" range (Selection panel): a random scale in [min, max] is
  // rolled onto every placement of the selected asset. Session state, not saved.
  private cloneScaleMin = 0.8;
  private cloneScaleMax = 1.5;
  // Wireframe render mode (Camera tab); OFF by default, persisted per maker.
  private wireframeOn = readPref(WIREFRAME_PREF_KEY);
  // Transparent X-ray render mode (Camera tab); independent from wireframe.
  private xrayOn = readPref(XRAY_PREF_KEY);
  // Camera orientation gimbal in the top-right viewport corner. On by default,
  // with a persistent View-menu toggle for makers who prefer a clear canvas.
  private axisGimbalOn = readPrefDefaultOn(AXIS_GIMBAL_PREF_KEY);
  // Editor camera speed multipliers (persisted): 1 = the shipped feel. Applied
  // to the viewport camera's move/look/pan rates.
  private cameraSpeeds = { move: 1, look: 1, pan: 1 };
  /** Debounce for the Free-Fly wheel toast (a wheel arrives in bursts). */
  private flySpeedToastTimer: number | null = null;
  private visibilityProfile = { distance: 900, haze: 0.25 };
  // Performance overlay (persisted): a live viewport readout the maker can turn
  // on and configure (which stats show). ON by default; a stored pref overrides.
  private perfOverlay = {
    enabled: true,
    fps: true,
    frameMs: true,
    assets: true,
    tris: true,
    selTris: true,
    terrain: true,
    streaming: true,
    coords: true,
  };
  // Editor lighting override (persisted): null = the shipped Day rig.
  private lighting: EditorLightingProfile | null = null;
  private lightingPreset: string = 'day';
  private atmosphereZoneId: string | null = null;
  private npcPlaceVisualKey: string | null = null;

  // blocker walls (drag-drawn invisible colliders)
  private blockerStart: Vec2 | null = null;
  private blockerPreview: BlockerDef | null = null;
  private drawingBlocker2d = false;
  private blockersVisible2d = true;

  private readonly undo = new UndoStack();
  private dirty = false;
  private saving = false;
  // Autosave (full save, not the draft backup): user-toggled, default OFF,
  // persisted; disabled again by setAutosave(false) on any autosave error so a
  // failing server can never loop toasts or hide that saving is broken.
  private autosaveOn = false;
  private presetPromptOn = readPrefDefaultOn(CM_PRESET_PROMPT_PREF_KEY);
  // True while a pointer gesture (stroke / placement drag) is mutating the
  // document; autosave must never serialize mid-gesture.
  private pointerEditActive = false;
  // Edits made while a save is in flight bump this; finishSave only clears the
  // dirty flag / draft when the generation it snapshotted is still current.
  private readonly editGen = new EditGeneration();
  private autosaveWarned = false;

  // selection
  private selectedPlacement: number | null = null;
  // Inspector-selected fire emitter on the active placement. While non-null,
  // the ordinary viewport Move gizmo edits the emitter rather than the model.
  private selectedFireEmitter: number | null = null;
  // Multi-selection (Blender Shift+click): every selected placement index,
  // ALWAYS including selectedPlacement (the active one) when non-null. Any
  // structural placement change collapses it back to the single active.
  private selectedSet = new Set<number>();
  private selectedCamp: number | null = null;
  private selectedKey: string | null = null; // 2D marker
  // Entity-tool mob selection uses live Sim ids so a rendered mob, rather than
  // its whole authored camp, is the unit of selection and movement.
  private selectedMobIds = new Set<number>();
  private selectedMobCamps = new Map<number, CampDef>();
  // NPC authoring keys use the same Ctrl-click group semantics as runtime mobs.
  private selectedNpcKeys = new Set<string>();
  private npcDragBase: Map<string, { npc: NpcDef; point: Vec2 }> | null = null;
  // Select-mode NPC direct manipulation (drag + arrow nudge), mirroring the
  // placement flow: base = every selected NPC's pre-gesture position (one undo
  // step per gesture/burst); anchor = the grabbed NPC's start, so a multi-drag
  // moves the group by the anchor's delta.
  private npcMoveBase: Map<string, { npc: NpcDef; from: Vec2 }> | null = null;
  private npcMoveAnchor: { key: string; start: Vec2 } | null = null;
  // Same for camp mobs: per-entity camp bases; anchor = first drag sample
  // (pure deltas, no pickup snap); applied = the delta already pushed into
  // the live sim, so each sample moves runtime mobs incrementally.
  private mobMoveState: {
    camps: Map<number, { camp: CampDef; from: Vec2 }>;
    anchor: Vec2 | null;
    applied: { dx: number; dz: number };
  } | null = null;
  private mobDragStart: {
    pointer: Vec2;
    camps: Map<number, { camp: CampDef; point: Vec2 }>;
    dx: number;
    dz: number;
  } | null = null;
  // Mob-tool patrol authoring: non-null while the maker is clicking waypoints
  // for the selected mobs. Claims the Mob tool's viewport clicks until it is
  // finished (Enter / double-click / Finish) or cancelled (Escape).
  private mobRouteDraft: {
    points: NpcRoutePoint[];
    mode: 'loop' | 'pingpong';
    speed: number;
    wait: number;
  } | null = null;
  // Selected map point light (Light tool click or Select-tool bulb click).
  private selectedLight: number | null = null;
  // Selected map point sound (Sound tool click or Select-tool badge click).
  private selectedSound: number | null = null;
  // Selected ground decal (Decal tool click on a stamp).
  private selectedDecal: number | null = null;
  private decalThumbsWarmed = false;
  // The Decal tool's "next stamp" settings: the art plus how it lands. Kept in
  // localStorage so a maker's working decal survives a reload, like the paint
  // tool's swatch. Stamping does NOT read the selected decal's values, so
  // tweaking one placed stamp never changes what the next click drops.
  private decalBrush = loadDecalBrush();
  private hoverKey: string | null = null;
  // Pre-drag placement value for slider undo (waterBase pattern): captured on
  // the first LIVE change so the trailing commit diffs against the real prev.
  private placementDragBase: { index: number; prev: AssetPlacement } | null = null;
  // Wheel/nudge bursts coalesce into ONE undo commit (against placementDragBase).
  private readonly transformCoalescer = new CommitCoalescer();
  private transformTimer = 0;
  /** Select-mode moving of the built-in gameplay objects a map can move
   *  (farm beds, practice dummies, gather nodes, dungeon doors). */
  private readonly objectMoves = new ObjectMoveController({
    getMoves: () => this.map.objectMoves,
    setMoves: (next) => {
      if (next) this.map.objectMoves = next;
      else delete this.map.objectMoves;
      if (next) this.activeWorld.objectMoves = next;
      else delete this.activeWorld.objectMoves;
    },
    moveLive: (key, before, after) => {
      this.viewport3d?.setSimObjectMoves(after);
      const shown = this.viewport3d?.objects.moveLive(key, before, after) ?? true;
      // A restore of an object the view was built without cannot appear live.
      if (!shown) this.toasts.info(t('editor.objectMove.restoredLater'));
    },
    showSelection: (key) => this.viewport3d?.objects.setSelected(key),
    pushUndo: (entry) => this.pushUndo(entry),
    committed: () => {
      invalidateStaticColliders();
      this.map.meta.updatedAt = now();
      this.markDirty();
      this.inspector.refresh();
    },
  });
  /** City Build Roads tab, Edit mode: reshape or remove the map's roads,
   *  authored and legacy (road_edit_controller.ts). */
  private readonly roadEdit = new RoadEditController({
    layers: () => this.cityRoadLayers(),
    write: (next) => {
      if (next.edits) this.map.roadEdits = next.edits;
      else delete this.map.roadEdits;
      if (next.defs) this.map.roadDefs = next.defs;
      else delete this.map.roadDefs;
    },
    refresh: (region) => this.cityRoadsChanged(region),
    preview: (points, highlight) => this.cityRoadEditPreview(points, highlight),
    pushUndo: (entry) => this.pushUndo(entry),
    committed: () => {
      this.map.meta.updatedAt = now();
      this.inspector.refresh();
    },
  });
  // A Push changes to repo map is in flight (one at a time).
  private pushing = false;
  // A 3D drag-move is in flight: single-key tool shortcuts stay suppressed.
  private placementDragging = false;
  // Preview mode (topbar toggle): in-game look, editor overlays hidden.
  private previewOn = false;
  // Zone isolate: the isolated zone's id, or null in Full Build. View state.
  private isolateZoneId: string | null = null;
  // Camera-zone stream (Scene panel): keep the zone the CAMERA is over
  // resident and swap it as the camera travels, unless the maker has locked
  // one. It drives the same residency rect as zone isolate, this is the
  // automatic way to choose that rect, not a second mechanism.
  private cameraZoneOn = false;
  private cameraZoneLocked = false;
  private cameraZoneTimer = 0;
  /** The zones the stream is holding resident (STREAM_ZONE_COUNT of them). The
   *  set swaps wholesale, so this is also what unloads in one go. */
  private streamZoneIds: string[] = [];
  private cameraZonePending: string | null = null;
  private cameraZonePendingSince = 0;
  private fullBuildRunning = false;
  // Rotate/Scale drag reference (captured on the first drag sample): the
  // placement's pre-drag transform plus the cursor's angle/distance around the
  // pivot, so the whole drag applies deltas against one stable baseline.
  private transformDragRef: {
    angle: number;
    dist: number;
    rotY: number;
    scale: number;
  } | null = null;
  // Pre-gesture snapshots of the OTHER multi-selection members during a group
  // transform (move/rotate/scale; the active one is covered by
  // placementDragBase). Full snapshots: every live sample re-derives each
  // member from its snapshot, and the commit's undo restores it wholesale.
  private groupDragBase: Map<number, AssetPlacement> | null = null;

  // stroke state
  // Merged-tool modes: Sculpt lowers instead of raising; Level smooths
  // instead of flattening.
  private sculptLower = false;
  // Sculpt Grab mode (snake hook): press grabs the ground under the brush,
  // and the drag pulls that spot ALONG the drag direction ? in 3D the cursor
  // motion maps onto the camera's view plane (sideways slides the grabbed
  // bump across the map, up/down on screen pulls it out of / into the
  // ground); in 2D top-down only the height pull applies (one live stamp per
  // gesture either way).
  private sculptGrab = false;
  private grabSession: {
    stamp: HeightStamp;
    startClientX: number;
    startClientY: number;
    // Where the stamp was planted (world): lateral drags offset from here.
    startX: number;
    startZ: number;
    // World yards per screen pixel at the grab point (camera-scaled).
    wpp: number;
    // Camera view-plane basis at grab time (3D only; null in 2D).
    axes: {
      right: { x: number; y: number; z: number };
      up: { x: number; y: number; z: number };
    } | null;
    region: RegionBox;
  } | null = null;
  // The Fluid tool's armed pool kind (preset).
  private fluidKind: FluidKind = 'lava';
  private pondRadius = DEFAULT_POND_RADIUS;
  private pondDepth = DEFAULT_POND_DEPTH;
  // Brush footprints, kept apart so a square paint brush never squares sculpt.
  private paintBrushShape: BrushShape = 'circle';
  private sculptBrushShape: BrushShape = 'circle';
  // Slope tool: the right-clicked start, and the ramp the current stroke
  // follows (its end is the press point, set at stroke begin).
  private slopeStart: SlopePoint | null = null;
  private slopeRamp: SlopeRamp | null = null;
  private selectionQuickActions!: SelectionQuickActions;
  // Caves tool sub-mode: lay cave rig nodes, CARVE real interiors, cut sheet
  // openings, patch ground back, paint remesh detail, run the volumetric
  // Dig/Fill sculpt brushes, or the edge-rounding Smooth brush.
  private tunnelMode: 'dig' | 'carve' | 'hole' | 'patch' | 'remesh' | 'sculpt' | 'fill' | 'smooth' =
    'dig';
  // The Cut/Carve GHOST: the solid the next commit will remove, shown as a
  // translucent blue preview the maker drags into place and tunes from the
  // panel before pressing Cut. Lives outside the document - no undo step, no
  // terrain change - until commitPendingCut().
  private pendingCut: TerrainCut | null = null;
  private pendingCutCarve = false;
  /** FORK: the ghost is the Fill tool's ERASE box (commit removes every cave
   *  inside it) rather than a cut to add. */
  private pendingErase = false;
  private eraseLength = 1;
  private eraseHeight = 1.5;
  private cutGhostDrag = false;
  // One Smooth-brush stroke: each touched cut's ORIGINAL blend (for the single
  // undo step at gesture end), the running dirty region, and a throttle.
  /** FORK: the last edit pointer position (client px), so voxel brushes can
   *  re-raycast the cave surface under the cursor. */
  private lastEditPointer: { x: number; y: number } | null = null;
  private smoothVoxelUndo: {
    cut: TerrainCut;
    box: VoxelBox;
    snap: Int8Array;
  }[] = [];
  private smoothStroke: {
    targets: Map<TerrainCut, number>;
    region: RegionBox | null;
    dirty: RegionBox | null;
    lastX: number;
    lastZ: number;
    lastRefresh: number;
  } | null = null;
  // The Cut tool's armed brush: which solid the next click drops, and its
  // proportions. Shape arithmetic lives in cut_tool_core.ts.
  private cutBrush: CutBrush = { ...DEFAULT_CUT_BRUSH };
  // Carve mode: how far below the clicked surface the solid's centre sinks.
  private carveDepth = 3;
  // Remesh brush: the cell size painted into the next detail region. On the
  // cavity mesher's stitch chain {0.25, 0.5, 1, 2}; the default base cell is
  // 1, so 0.5 arms the brush as "one step finer".
  private remeshCell = 0.5;
  // One volumetric Dig/Fill stroke: the stamps it laid (for the single undo
  // step at gesture end), the running dirty region, and a refresh throttle.
  // FORK: Dig/Fill strokes bake into the document's voxel volumes
  // (carve_voxel_core.ts). Undo is a box snapshot of the cells the stroke
  // touched, or a full copy when the stroke had to GROW the grid.
  private carveStroke: {
    mode: 'sculpt' | 'fill';
    /** The volumes this stroke writes: a Dig stroke the dig grid; a Fill
     *  stroke puts rock BACK into the dig grid (restore) and, where a
     *  primitive carve stands under the brush, solid into the patch grid. */
    targets: VoxelStrokeTarget[];
    region: RegionBox | null;
    dirty: RegionBox | null;
    lastX: number;
    lastZ: number;
    lastY: number;
    lastRefresh: number;
    capped: boolean;
  } | null = null;
  /** FORK: the Dig brush's stamp shape + rim noise, and the volume's cell. */
  private digAlpha: DigAlpha = { kind: 'crescent', noise: 0.35 };
  private digCell = 1;
  // Rock Generator tool: the sliders shaping the NEXT rock. Chain mode lays
  // blue waypoint PLACEMENTS (rock/point, grouped by the chain id in
  // placement.name, exactly like the cave rigs), so the nodes survive tool
  // switches, move/scale with the ordinary gizmos, and undo/save.
  private rockParams = {
    size: 3,
    noise: 0.5,
    detail: 0.5,
    sharp: 0.3,
    tex: 0,
    walkable: true,
    height: 1,
    depth: 0,
    jag: 0,
    texId: '',
    texTile: DEFAULT_TEXTURE_TILE_YD,
  };
  private rockChainMode = false;
  // Tree Generator tool: the whole recipe shaping the NEXT tree, plus which
  // preset it started from and whether the canopy spheres are drawn. Seeds are
  // stamped per placement, so two clicks with identical settings still grow
  // two different trees.
  private treeParams: FoliageParams = { ...treePreset('forest_oak')?.params };
  private treePresetKey = 'forest_oak';
  /** The Tree Studio session: a scratch scene holding ONE tree, opened so the
   *  maker can shape it against an empty backdrop instead of squinting at it
   *  inside a village. Same stash-and-return contract as Collision Master. */
  private treeStudio: {
    returnMapId: string;
    returnMap: CustomMap;
    /** The return map's placement list exactly as it was on the way in. See
     *  exitTreeStudio: the load that brings the map back prunes it. */
    returnPlacements: AssetPlacement[];
    returnSelection: number | null;
    returnTool: EditorTool;
    returnCam: { x: number; y: number; z: number; yaw: number; pitch: number; dist: number } | null;
    terrainPreserved: boolean;
  } | null = null;
  private caveEditBase: {
    cave: CaveDef;
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
    // Pre-edit node chain: a variance drag re-bores, so undo restores nodes too.
    nodes: CaveNode[];
  } | null = null;
  // Pre-edit cut per hole/patch (live sliders; same pattern as caves).
  private holeEditBase: { index: number; cut: TerrainCut } | null = null;
  private holePatchEditBase: { index: number; cut: TerrainCut } | null = null;
  private flattenSmooth = false;
  // The Level tool's smoothing STYLE: plain smoothing, its sharpen inverse,
  // deterministic roughening, or stepped terraces (stamp_core.ts).
  private levelStyle: 'smooth' | 'sharpen' | 'noise' | 'terrace' = 'smooth';
  // The Noise style's dials: bump size in yards and roughness in percent (how
  // strongly the finer layers show). The seed is rolled once per stroke so its
  // dabs share one pattern and the next stroke layers a fresh one.
  private noiseSize = NOISE_SIZE_DEFAULT;
  private noiseRough = NOISE_ROUGH_DEFAULT * 100;
  private strokeNoiseSeed = 0;
  // Sculpt stamps persist only built-in deterministic alphas so playtest and
  // every terrain consumer reproduce the exact same surface.
  private sculptHardness = 55;
  private sculptAlphaId: TerrainBrushAlphaId | null = null;
  // Paint brush edge hardness (percent; 100 = the legacy hard brush) and the
  // one-shot bucket fill arm state.
  private paintHardness = 70;
  // Selected brush alpha (mask) for the paint tool; null = plain round brush.
  private paintAlphaId: string | null = null;
  // Track the music tool assigns to the NEXT dragged area.
  private musicAreaTrack: string = 'vale';
  // Selected music area (Music tool click on a rect, or a panel row click).
  private selectedMusicArea: number | null = null;
  private bucketArmed = false;
  // Slope-based auto texture for the sculpt tools: when enabled, every stroke
  // repaints its region by ground angle (flat id below the threshold, steep id
  // above; -1 leaves that band's paint untouched).
  private autoTexture = { enabled: false, angle: 38, flatId: -1, steepId: 2 };
  // Which paint cells the slope auto-texture currently OWNS (cell index -> the
  // id the cell held BEFORE auto first painted it). Lets a later stroke that
  // reshapes the ground back to flat RESTORE the original texture instead of
  // leaving the "locked in" cliff paint. Session-only, keyed to one grid; it
  // resets when the paint grid is swapped (resample) since indices change.
  private autoTexOwned = new Map<number, number>();
  private autoTexOwnedGrid: BiomePaint | null = null;
  // Zone tool drag box (named locations) + spawn-tool marker placement mode.
  private zoneStart: Vec2 | null = null;
  private spawnAreaStart: Vec2 | null = null;
  private spawnAreaPreview: {
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
  } | null = null;
  private zoneBox: RegionBox | null = null;
  private markerPlaceMode = false;
  private markerKind: 'npc' | 'object' = 'npc';
  private strokeStamps: HeightStamp[] = [];
  private strokeStartIndex = 0;
  private strokeCapWarned = false;
  private strokeRegion: RegionBox | null = null;
  // Shift held during the current sculpt stroke: apply the OPPOSITE sub-mode
  // (raise<->lower, smooth<->flatten). Set from the pointer event per stamp.
  private strokeInvert = false;
  private paintChanges = new Map<number, { prev: number; next: number }>();
  private paintCreatedGrid = false;
  private lastStamp: Vec2 | null = null;
  private flattenTarget = 0;
  /** Flatten's locked level (right-click picks it); null = each stroke levels
   *  to the height where it starts. */
  private flattenLock: number | null = null;
  /** Moving an asset re-seats it on the ground instead of detaching it. */
  private snapToGroundOnMove = false;
  private eraseLast: Vec2 | null = null;

  // water
  private waterBase = WATER_LEVEL;
  private waterTimer = 0;

  // region clipboard
  private regionBox: RegionBox | null = null;
  private regionStart: Vec2 | null = null;
  private selectingRegion = false;
  private clipboard: Clipboard | null = null;
  private selectionClipboard: SelectionClipboard | null = null;

  // 2D pointer state
  private panning = false;
  private dragKey: string | null = null;
  private markerDragStart: { key: string; x: number; z: number } | null = null;
  private grab: Vec2 = { x: 0, z: 0 };
  private npcFacingDragBase: { key: string; facing: number } | null = null;
  private lastPointer: ScreenPoint = { sx: 0, sy: 0 };
  private painting2d = false;
  /** Pixels dragged since the 2D paint press; gates jitter, see pointermove. */
  private paint2dDragPx = 0;
  private cursorWorld: Vec2 | null = null;
  /** The ground under the cursor in the 3D view (null off the map): where a
   *  pasted mob or NPC group lands. */
  private hover3dWorld: Vec2 | null = null;
  private canvasDirty = true;

  private readonly io = new MapIO();
  // The shared game settings store (localStorage-backed): the editor's Settings
  // dialog writes graphics/sound here, so a playtest boots with the same values.
  private readonly gameSettings = new Settings();
  private readonly visible = new Set<EntityKind>(KINDS);

  // Lighting-tab birds preference (editor preview, persisted like lighting).
  // The skybox is NOT a preference: it lives on the map document (map.skybox)
  // so playtest renders it in-game.
  private birds = { enabled: true, count: 14, formation: true };

  constructor(
    private readonly root: HTMLElement,
    content: ZoneContent,
  ) {
    this.content = content;
    this.map = {
      version: CUSTOM_MAP_VERSION,
      meta: {
        id: mintId(),
        name: t('editor.untitledMap'),
        description: '',
        createdAt: now(),
        updatedAt: now(),
        seed: DEFAULT_PLAYTEST_SEED,
        parentId: '',
      },
      content,
      terrainEdits: [],
      placements: [],
    };
    // The saved-map restore is DEFERRED to finishBoot(): the store hydrates
    // from IndexedDB first (and migrates localStorage saves across, freeing
    // the quota that used to block every save). The constructor proceeds on
    // the built-in default; finishBoot loadMap()s the maker's real map the
    // moment the store is ready.
    if (new URLSearchParams(location.search).get('liveWorld') === '1') {
      this.map = newLiveWorldMap(t('editor.liveWorld.name'));
      this.content = this.map.content;
    } else {
      promoteMajorWorldProps(this.map as CustomMap);
      promoteEditablePalms(this.map as CustomMap);
      promoteStreetlamps(this.map as CustomMap);
      promoteWillows(this.map as CustomMap);
      promoteFarshorePalms(this.map as CustomMap);
      promoteFeatureDressing(this.map as CustomMap);
      repairLegacyWorldPropFit(this.map as CustomMap);
      repairStretchedWorldProps(this.map);
      repairPlacedAssetShapes(this.map);
      repairMissingTreeCollision(this.map, applyDefaultCollision);
      repairDecorBuildingCollision(this.map);
    }
    this.entities = buildEntities(this.content);
    this.base = snapshot(this.entities);
    this.rebuildActiveWorld();

    // ---- layout ------------------------------------------------------------------
    this.root.innerHTML = '';
    this.root.classList.add('ed-root');

    this.topbar = new Topbar(this.root, {
      onNameChange: (name) => {
        this.map.meta.name = name;
        this.markDirty();
      },
      onNew: () => void this.newMap(),
      onNewFlat: () => void this.newFlatMap(),
      onOpen: () => this.drawer.open(),
      onSave: () => void this.save(),
      onSaveAs: () => void this.saveAs(),
      onAutosaveToggle: () => this.setAutosave(!this.autosaveOn),
      onPresetPromptToggle: () => this.setPresetPrompt(!this.presetPromptOn),
      onFork: () => void this.forkCurrent(),
      onImport: () => void this.importFile(),
      onExport: () => this.exportFile(),
      onUploadAsset: () => void this.uploadAsset(),
      onImportModel: () => this.importModel(),
      onWorldLink: () => void this.openWorldLink(),
      onGenerateTerrain: () => void this.openGenerateTerrain(),
      onEvenBuildings: () => this.evenOutBuildingScales(),
      onSettings: () => this.openGameSettings(),
      onCameraFocus: () => this.focusSelection(),
      cameraToggles: [
        {
          key: 'freefly',
          title: t('editor.camera.freeFly'),
          icon: CAM_ICONS.freeFly,
          get: () => this.freeFlyOn,
          set: (on) => this.setFreeFly(on),
        },
        {
          key: 'invert',
          title: t('editor.camera.invertPan'),
          icon: CAM_ICONS.invert,
          get: () => this.invertPanOn,
          set: (on) => this.setInvertPan(on),
        },
        {
          key: 'player',
          title: t('editor.camera.showPlayer'),
          icon: CAM_ICONS.player,
          get: () => this.showPlayerOn,
          set: (on) => this.setShowPlayer(on),
        },
        {
          key: 'boundary',
          title: t('editor.camera.showBoundary'),
          icon: CAM_ICONS.boundary,
          get: () => this.showBoundaryOn,
          set: (on) => this.setShowBoundaryWalls(on),
        },
        {
          key: 'wireframe',
          title: t('editor.camera.wireframe'),
          icon: CAM_ICONS.wireframe,
          get: () => this.wireframeOn,
          set: (on) => this.setWireframeMode(on),
        },
        {
          key: 'xray',
          title: t('editor.camera.xray'),
          icon: CAM_ICONS.xray,
          get: () => this.xrayOn,
          set: (on) => this.setXrayMode(on),
        },
        {
          key: 'footprints',
          title: t('editor.selection.footprints'),
          icon: CAM_ICONS.footprints,
          get: () => this.footprintsOn,
          set: (on) => this.setHitboxOverlay(on),
        },
      ],
      onPlaytest: () => void this.playtest(),
      onDungeonMode: AUTHORED_DUNGEONS.length > 0 ? () => this.enterDungeonMode() : undefined,
      onBattlegroundMode: () => this.enterBattlegroundMode(),
      onRegionExport: () => void this.exportRegionMap(),
      // Not while a push is between its read of the file and its write.
      onPublishMap: () => {
        if (!this.pushing) void this.publishMapToRepo();
      },
      onPushMapChanges: () => void this.pushMapChangesToRepo(),
      onUnpublishMap: () => void this.unpublishMapFromRepo(),
      onViewMode: (mode) => this.setViewMode(mode),
      onProjectionToggle: () => this.setOrthographic(!this.orthographicOn),
      onAxisGimbalToggle: () => this.setAxisGimbalVisible(!this.axisGimbalOn),
      onMinimapToggle: () => this.toggleMinimap(),
      onMusicToggle: () => this.toggleAreaMusic(),
      onOpenMap: () => this.openMapWindow(),
      onPreviewToggle: () => this.setPreviewMode(!this.previewOn),
      onZoneIsolateToggle: () => this.toggleZoneIsolate(),
      onHitboxToggle: () => this.setHitboxOverlay(!this.footprintsOn),
      onFullBuildPreview: () => void this.fullBuildPreview(),
      onUndo: () => this.doUndo(),
      onRedo: () => this.doRedo(),
      onHelp: () => this.tutorial.openHelp(),
    });
    // Publish to Game is a dev-server action (the vite endpoint only exists
    // there). Set it at construction, not only on the map-load path: the
    // most-recent-save boot never went through that path, so the button stayed
    // hidden (SPACEY 2026-09-07: "I don't have that button").
    this.topbar.setPublishEnabled(import.meta.env.DEV && !this.map.meta.overworldBase);
    // Autosave preference: default off; a blocked storage read stays off.
    try {
      this.autosaveOn = localStorage.getItem(AUTOSAVE_PREF_KEY) === '1';
    } catch {
      this.autosaveOn = false;
    }
    // Lighting preference: {preset, profile}; malformed/blocked storage = Day.
    try {
      const raw = localStorage.getItem(LIGHTING_PREF_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          preset?: string;
          profile?: EditorLightingProfile;
        };
        if (saved.profile && typeof saved.profile.sunIntensity === 'number') {
          this.lighting = saved.profile;
          this.lightingPreset = typeof saved.preset === 'string' ? saved.preset : 'custom';
        }
      }
    } catch {
      this.lighting = null;
    }
    this.topbar.setAutosave(this.autosaveOn);
    this.topbar.setPresetPrompt(this.presetPromptOn);

    const main = el('div', 'ed-main');
    this.root.appendChild(main);
    this.toolbar = new Toolbar(
      main,
      (tool) => this.setTool(tool),
      () => this.toggleBattlegroundPanel(),
    );

    const stageWrap = el('div', 'ed-stage');
    stageWrap.setAttribute('aria-label', t('editor.a11y.stage'));
    this.stage3dEl = el('div', 'editor-3d-host');
    this.stage2d = el('div', 'editor-2d-host');
    this.canvas = document.createElement('canvas');
    this.stage2d.appendChild(this.canvas);
    stageWrap.append(this.stage3dEl, this.stage2d);
    main.appendChild(stageWrap);

    this.inspector = new Inspector(main, this.inspectorDeps());

    this.assets = new AssetBrowser(stageWrap, {
      onPick: (assetId, label) => {
        // On the Foliage tool, a pick arms the CUSTOM brush asset instead of the
        // Place tool, so makers can scatter their own trees/bushes.
        if (this.tool === 'foliage') {
          this.foliageCustom = { assetId, label };
          this.inspector.refresh();
          return;
        }
        if (this.buildingWorkspace?.active) {
          this.setTool('building');
          void this.buildingWorkspace.pickAsset(assetId, label);
          return;
        }
        this.placeAssetId = assetId;
        this.placeAssetLabel = label;
        // City Build's Kit subtool keeps the pick armed for snapped placement;
        // measuring the footprint now means the first tile snap is exact. A
        // new asset starts a fresh tile level.
        if (this.tool === 'city' && this.citySubtool === 'kit') {
          this.cityTileLevel = null;
          void this.cityFootprint(assetId);
          this.inspector.refresh();
          return;
        }
        if (this.tool !== 'place') this.setTool('place');
        else this.inspector.refresh();
      },
      confirm: (title, body) => confirmDialog(this.root, { title, body, danger: true }),
      toastError: (m) => this.toasts.error(m),
      onCollisionMaster: (assetId, label) => this.enterCollisionMaster(assetId, label),
      onImportModel: () => this.importModel(),
    });

    this.buildingWorkspace = new BuildingWorkspace({
      map: () => this.map,
      viewport: () => this.viewport3d,
      terrain: (p) => terrainHeight(p.x, p.z, this.map.meta.seed),
      execute: (command) => {
        this.flushTransformCommit();
        command.redo();
        this.pushUndo(command);
      },
      changed: () => {
        this.setSelectedPlacement(null);
        this.viewport3d?.rebuildPlacements();
        this.buildingWorkspace.syncView();
        this.canvasDirty = true;
      },
      refresh: () => {
        this.buildTransformControls?.refresh();
        this.selectionQuickActions?.refresh();
        this.inspector.refresh();
      },
      arm: () => this.setTool('building'),
      selectExisting: () => this.setTool('move'),
      openAssets: () => {
        this.assets.setVisible(true);
      },
      clearSelection: () => this.setSelectedPlacement(null),
      error: (message) => this.toasts.error(message),
    });
    this.buildTransformControls = new BuildTransformControls({
      getState: () => {
        const npcKey = this.transformableNpcKey();
        if (npcKey !== null) {
          const npc = this.map.content.npcs[npcKey.slice('npc:'.length)];
          return {
            transform: npc ? { rotY: npc.facing, scale: 1 } : null,
            rotateOnly: true,
            fineRotation: this.fineBuildRotation,
            canUndo: this.undo.canUndo,
            canRedo: this.undo.canRedo,
          };
        }
        return {
          transform:
            isSelectionTool(this.tool) && this.selectedPlacement !== null
              ? (this.map.placements[this.selectedPlacement] ?? null)
              : this.buildingWorkspace.active
                ? this.buildingWorkspace.transform
                : this.placeAssetId
                  ? {
                      rotY: this.tool === 'city' ? this.cityKitRot : this.placeRotation,
                      scale: this.tool === 'city' ? this.citySettings.kitScale : this.placeScale,
                    }
                  : null,
          fineRotation: this.fineBuildRotation,
          canUndo: this.undo.canUndo,
          canRedo: this.undo.canRedo,
        };
      },
      onTransform: (next) => {
        const npcKey = this.transformableNpcKey();
        if (npcKey !== null) {
          this.updateNpcFacing(npcKey, next.rotY, true);
          this.inspector.refresh();
        } else if (isSelectionTool(this.tool) && this.selectedPlacement !== null) {
          this.updateSelectedPlacement(next, true);
          this.inspector.refresh();
        } else if (this.buildingWorkspace.active) this.buildingWorkspace.setTransform(next);
        else if (this.tool === 'city') {
          this.cityKitRot = next.rotY;
          this.setCitySettings({ ...this.citySettings, kitScale: next.scale });
        } else {
          this.placeRotation = next.rotY;
          this.placeScale = next.scale;
        }
      },
      onFineRotationChange: (on) => {
        this.fineBuildRotation = on;
      },
      onUndo: () => this.doUndo(),
      onRedo: () => this.doRedo(),
    });

    this.selectionQuickActions = new SelectionQuickActions(this.selectionQuickActionsDeps());
    stageWrap.append(this.selectionQuickActions.root);

    this.cmBar = new CollisionMasterBar(stageWrap, {
      getMode: () => this.cmSubMode,
      setMode: (m) => this.setCmSubMode(m),
      addPrimitive: (kind) => this.addCmPrimitive(kind),
      duplicateSelection: () => this.duplicateCmSelection(),
      deleteSelection: () => this.deleteCmSelection(),
      getPolySnap: () => this.cmPolySnap,
      setPolySnap: (on) => {
        this.cmPolySnap = on;
        if (on) {
          this.cmPolyBuild = false;
          this.cmSculptTool = null;
        }
        this.cmPolyPoints = null;
        this.cmBar?.refresh();
        this.inspector.refresh();
      },
      getSelectedRamp: () => {
        const vi = this.cmSel.volume;
        return vi === null ? null : (this.cmVolumes[vi]?.ramp ?? false);
      },
      toggleSelectedRamp: () => this.toggleCmRamp(),
      loopCut: () => this.loopCutCmSelection(),
      canLoopCut: () => this.canLoopCut(),
      topology: (action) => this.applyCmTopology(action),
      canTopology: (action) => this.canCmTopology(action),
      getPolyBuild: () => this.cmPolyBuild,
      setPolyBuild: (on) => this.setCmPolyBuild(on),
      getSculpt: () => ({
        tool: this.cmSculptTool,
        radius: this.cmSculptRadius,
        strength: this.cmSculptStrength,
        dynamicTopology: this.cmSculptDynamic,
        targetEdgeLength: this.cmSculptTargetEdge,
      }),
      setSculptTool: (tool) => this.setCmSculptTool(tool),
      setSculptSettings: (change) => {
        if (change.radius !== undefined) this.cmSculptRadius = change.radius;
        if (change.strength !== undefined) this.cmSculptStrength = change.strength;
        if (change.dynamicTopology !== undefined) this.cmSculptDynamic = change.dynamicTopology;
        if (change.targetEdgeLength !== undefined)
          this.cmSculptTargetEdge = change.targetEdgeLength;
        this.cmBar?.refresh();
      },
    });

    // Dev-only introspection handle (integration tests / manual debugging).
    if (import.meta.env.DEV) {
      (window as unknown as { __wocEditorApp?: unknown }).__wocEditorApp = this;
    }

    this.toasts = new Toasts(this.root);
    this.drawer = new MapDrawer(this.root, {
      listLocal: () => this.io.store.list(),
      hasDraft: () => this.io.draftLoad() !== null,
      onOpenShipped: async (mapId) => {
        if (!(await this.confirmDiscard())) return;
        // A map published under this shipped id's slug IS the shipped map now
        // (the game boots it for that slug), so the shipped row opens the
        // published document; the code-built adapter is the fallback.
        const published = await this.fetchPublishedMap(mapId);
        if (published) {
          this.loadMap(published);
          this.inspector.refresh();
          this.toasts.info(t('editor.status.publishedMapOpened', { name: published.meta.name }));
          return;
        }
        const map = await createShippedMap(mapId, mintId(), now());
        this.loadMap(map);
        // The maker's "Show collision footprints" toggle is left ALONE here.
        // This used to force it off and persist that, on the theory that a
        // dense kit map becomes one screen-sized wash of outlines. It does not:
        // a kit conversion's collision lives in `collider/<kind>` volumes, which
        // this overlay never draws (they resolve to no model and are drawn by
        // the viewport's own collider-volume pass), so every dungeon, delve and
        // arena renders exactly ZERO footprints. The only shipped maps with real
        // placement collision are the overworld and Thornhollow, precisely the
        // two where a maker opens the map to look at collision, and where the
        // old force-off silently answered "there is none" and then clobbered
        // the saved preference so the answer stuck.
        this.inspector.refresh();
        this.toasts.info(t('editor.status.shippedMapOpened', { name: map.meta.name }));
      },
      listPublished: async () => {
        if (!import.meta.env.DEV) return [];
        try {
          const res = await fetch('/__studio_map/published');
          if (!res.ok) return [];
          const list = (await res.json()) as unknown;
          return Array.isArray(list) ? (list as PublishedMapMeta[]) : [];
        } catch {
          return [];
        }
      },
      onOpenPublished: async (slug) => {
        if (!(await this.confirmDiscard())) return;
        const map = await this.fetchPublishedMap(slug);
        if (!map) {
          this.toasts.error(t('editor.openDrawer.publishedUnreadable', { slug }));
          return;
        }
        this.loadMap(map);
        this.inspector.refresh();
        this.toasts.info(t('editor.status.shippedMapOpened', { name: map.meta.name }));
      },
      onOpenLocal: async (id) => {
        if (!(await this.confirmDiscard())) return;
        const loaded = this.io.store.load(id);
        if (loaded) this.loadMap(loaded);
        // A listed save that fails to load (corrupt/truncated bytes) used to
        // do NOTHING, the drawer closed and the maker was left guessing.
        else this.toasts.error(t('editor.status.openFailedLocal'));
      },
      onOpenDraft: async () => {
        if (!(await this.confirmDiscard())) return;
        const draft = this.io.draftLoad();
        if (draft) {
          this.loadMap(draft);
          this.toasts.info(t('editor.status.draftRestored'));
        }
      },
      onDeleteLocal: async (id) => {
        this.io.store.remove(id);
        this.io.setLink(id, null);
      },
      onOpenServer: (full, mine) => void this.openServerMap(full, mine),
      confirm: (title, body, confirmLabel) =>
        confirmDialog(this.root, { title, body, confirmLabel, danger: true }),
      toastError: (m) => this.toasts.error(m),
      toastSuccess: (m) => this.toasts.success(m),
    });

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    this.ctx = ctx;

    this.attach2dEvents(this.stage2d);
    window.addEventListener('keydown', this.onKeyDown);
    // Unsaved work guard: the browser shows its leave-confirmation while the
    // document is dirty (closing the tab was silent data loss before).
    window.addEventListener('beforeunload', (ev) => {
      if (!this.dirty) return;
      ev.preventDefault();
      ev.returnValue = '';
    });
    // Remember where the camera was looking, so a page reload lands the maker
    // back there instead of framing the whole map. pagehide is the reliable
    // reload/close hook (fires where beforeunload/unload are throttled).
    window.addEventListener('pagehide', () => {
      this.saveEditorCam();
      this.stopAreaMusic();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveEditorCam();
    });
    this.resize();
    this.frameAll();
    requestAnimationFrame(this.tick2d);
    window.setInterval(() => this.autosave(), AUTOSAVE_MS);
    window.setInterval(() => this.localBackupSave(), LOCAL_SAVE_MS);

    this.topbar.setMapName(this.map.meta.name);
    this.topbar.setHitboxes(this.footprintsOn);
    this.topbar.setOffline(!signedIn());
    // The reopened-map chrome (fork state, "Opened ..." toast, playtest dirty
    // flag) moved to finishBoot(): the restore now runs there, after the
    // async store hydration.
    this.topbar.setViewMode(this.viewMode);
    this.topbar.setProjectionMode(this.orthographicOn);
    this.topbar.setAxisGimbalVisible(this.axisGimbalOn);
    this.toolbar.setActive(this.tool);

    // Sky/birds preferences (applied through the viewport once it boots).
    const savedBirds = readJsonPref<{
      enabled: boolean;
      count: number;
      formation: boolean;
    }>(BIRDS_PREF_KEY);
    if (savedBirds && typeof savedBirds.enabled === 'boolean') {
      this.birds = {
        enabled: savedBirds.enabled,
        count: Number.isFinite(savedBirds.count) ? savedBirds.count : 14,
        formation: savedBirds.formation !== false,
      };
    }
    // Camera-speed multipliers (persisted): clamp to the slider range on load.
    const savedSpeeds = readJsonPref<{
      move: number;
      look: number;
      pan: number;
    }>(CAMERA_SPEEDS_PREF_KEY);
    if (savedSpeeds) {
      const clampSpeed = (v: unknown): number =>
        Number.isFinite(v) ? Math.min(4, Math.max(0.1, v as number)) : 1;
      this.cameraSpeeds = {
        move: clampSpeed(savedSpeeds.move),
        look: clampSpeed(savedSpeeds.look),
        pan: clampSpeed(savedSpeeds.pan),
      };
    }
    const savedVisibility =
      readJsonPref<Partial<EditorApp['visibilityProfile']>>(VISIBILITY_PREF_KEY);
    if (savedVisibility) {
      if (Number.isFinite(savedVisibility.distance)) {
        this.visibilityProfile.distance = Math.min(
          4000,
          Math.max(400, savedVisibility.distance as number),
        );
      }
      if (Number.isFinite(savedVisibility.haze)) {
        this.visibilityProfile.haze = Math.min(1, Math.max(0, savedVisibility.haze as number));
      }
    }
    // Performance-overlay preferences (persisted): merge onto the defaults so a
    // partial/old stored object keeps every field a valid boolean.
    const savedPerf = readJsonPref<Partial<EditorApp['perfOverlay']>>(PERF_OVERLAY_PREF_KEY);
    if (savedPerf && typeof savedPerf === 'object') {
      for (const key of Object.keys(this.perfOverlay) as (keyof EditorApp['perfOverlay'])[]) {
        if (typeof savedPerf[key] === 'boolean') this.perfOverlay[key] = savedPerf[key];
      }
    }
    this.applyViewMode();
    this.boot3d();
    this.applyBirds();
    this.applySkybox();
    this.viewport3d?.setShowBoundaryWalls(this.showBoundaryOn);
    this.viewport3d?.setWireframe(this.wireframeOn);
    this.viewport3d?.setXray(this.xrayOn);
    this.viewport3d?.setVisibilityProfile(this.visibilityProfile);

    // Help modal + first-run tour (auto-starts once; Help > Begin tutorial
    // replays it any time). Loaded lazily: maybeAutoStart() skips the import
    // outright for a returning-user session, the large majority.
    this.tutorial = new TutorialLoader(this.root);
    this.tutorial.maybeAutoStart();

    // Restore imported models persisted in IndexedDB, so 'local/<sha>'
    // placements in saved maps resolve without re-importing the files.
    void this.ensureStoredLocalAssets().then((added) => {
      if (added) this.viewport3d?.rebuildPlacements();
    });

    // Hydrate the map store, then reopen the maker's real map (playtest
    // return first, else the most recent save). Deferred because the store
    // now lives in IndexedDB (async): see the constructor comment above.
    void this.finishBoot();
  }

  private async finishBoot(): Promise<void> {
    await this.io.ready();
    // Returning from a playtest in this tab: reopen the map that launched it.
    // Prefer the newest copy across the full save, the launch draft, and the
    // session recovery slot so a failed navigation cannot strand a blank editor.
    const restored = this.restorePlaytestMap();
    const resumed = restored?.map ?? null;
    // Fresh page (nothing to resume): reopen the most recently saved local map
    // so a maker lands back in their last work instead of the built-in world. A
    // first-time visitor with no saves still gets the built-in world as before.
    // The seed is asked FIRST, and answers null unless the shipped default has
    // a version this browser has never taken (see seedDefaultMap). Asking it
    // after loadMostRecentSave, the old order, meant a browser with ANY save
    // could never receive an updated default: it re-opened its months-old copy
    // forever, which is exactly the "the editor keeps loading an old map"
    // report. Non-destructive either way: seeding saves the new default
    // alongside the maker's own maps rather than replacing them.
    // The maker's own most recent save comes FIRST: Studio always reopens the
    // last map they worked on. The shipped default world is only OPENED on a
    // first-ever visit with no saves at all; on every other boot a newer
    // shipped version is still seeded into the store in the background (kept
    // alongside their maps, never opened over them), so an updated default
    // is one click away in Open rather than hijacking the boot.
    const liveWorld = new URLSearchParams(location.search).get('liveWorld') === '1';
    let autoloaded = resumed
      ? null
      : liveWorld
        ? (this.io.store.load(this.map.meta.id) ?? this.map)
        : await this.seedDefaultMap();
    if (!resumed && !autoloaded) autoloaded = this.loadMostRecentSave();
    const opened = resumed ?? autoloaded;
    if (opened) {
      // Consume a one-shot return pose left by an older reload-based Collision
      // Master build before falling back to the general saved camera.
      const cmCam = this.takeCmReturnCam();
      if (cmCam && cmCam.mapId === opened.meta.id) {
        this.pendingCamera = cmCam.cam;
      } else {
        // General reload restore: drop the maker back where they were looking
        // on this map (loadMap's post-reload hook applies pendingCamera).
        const savedCam = this.readEditorCam(opened.meta.id);
        if (savedCam) this.pendingCamera = savedCam;
      }
      this.loadMap(opened);
      this.topbar.setForkEnabled(this.io.linkFor(this.map.meta.id) !== null);
      this.toasts.info(t('editor.status.opened', { name: this.map.meta.name }));
      if (restored?.dirty) this.markDirty();
      this.restoreZoneIsolate();
    }
  }

  private restorePlaytestMap(): PlaytestRestore | null {
    let resumeId: string | null = null;
    try {
      resumeId = sessionStorage.getItem(PLAYTEST_RESUME_KEY);
    } catch {
      resumeId = null;
    }

    const candidates: {
      map: CustomMap;
      source: 'store' | 'draft' | 'recovery';
    }[] = [];
    if (resumeId) {
      const stored = this.io.store.load(resumeId);
      const draft = this.io.draftLoadById(resumeId);
      if (stored) candidates.push({ map: stored, source: 'store' });
      if (draft) candidates.push({ map: draft, source: 'draft' });
    }
    const recovery = loadPlaytestRecoveryDraft();
    if (recovery && (!resumeId || recovery.meta.id === resumeId)) {
      candidates.push({ map: recovery, source: 'recovery' });
    }
    if (candidates.length === 0) {
      if (resumeId) {
        try {
          sessionStorage.removeItem(PLAYTEST_RESUME_KEY);
        } catch {
          // Blocked storage: ignore the stale marker.
        }
      }
      return null;
    }

    candidates.sort((a, b) => b.map.meta.updatedAt - a.map.meta.updatedAt);
    const picked = candidates[0];
    const saved = picked.source === 'store' ? true : this.io.saveLocal(picked.map);
    if (saved) {
      this.io.draftClear(picked.map.meta.id);
      clearPlaytestRecoveryDraft(picked.map.meta.id);
    }
    try {
      sessionStorage.removeItem(PLAYTEST_RESUME_KEY);
    } catch {
      // Blocked storage: the stale marker can only point back to this map.
    }
    return { map: picked.map, dirty: !saved };
  }

  /**
   * Reopen the most recently saved local map (newest by `updatedAt`), or null if
   * this browser has none. `store.list()` is already sorted newest-first, so the
   * head is the last map the maker touched. Called on a fresh launch (no playtest
   * to resume) so the editor reopens their work instead of a blank world.
   */
  private loadMostRecentSave(): CustomMap | null {
    // Walk past corrupt/unparseable entries: one bad newest save must not
    // dump the maker onto the built-in world while their older saves are fine.
    for (const meta of this.io.store.list()) {
      const map = this.io.store.load(meta.id);
      if (map) return map;
    }
    return null;
  }

  /**
   * First boot with no saves: seed the shipped default world ,
   * "World of ClaudeCraft" (public/maps/default-world.wocmap.zip, a
   * deflate-compressed map bundle), so a fresh clone opens into the world the
   * GAME boots, with every prop and decoration already an editable placement.
   * Regenerate it from the live content with
   * `UPDATE_DEFAULT_WORLD=1 npx vitest run tests/default_world_bundle.test.ts`
   * whenever the overworld changes, and bump SEEDED_KEY below. Seeded ONCE: a localStorage flag
   * records it and the map is saved locally, so loadMostRecentSave reopens it on
   * later boots and deleting it never forces it back. Best effort, any failure
   * (offline, blocked storage, bad bundle) falls through to the built-in default.
   */
  private async seedDefaultMap(): Promise<CustomMap | null> {
    // VERSIONED. The old key was unversioned, so once a browser had seeded ANY
    // default it never took another one: shipping a new default-world bundle
    // (the v0.39 rebuild) reached first-time visitors only, and everyone else
    // kept re-opening the copy they seeded months earlier, which reads as
    // "the editor keeps loading an old map". Bump the suffix whenever
    // public/maps/default-world.wocmap.zip changes materially. Re-seeding is
    // non-destructive: it saves the new default alongside the maker's own maps
    // (their work is keyed by its own meta.id) and simply opens the newer one.
    const SEEDED_KEY = 'woc-editor-default-world-seeded-v045-genshin1';
    try {
      if (localStorage.getItem(SEEDED_KEY)) return null;
    } catch {
      // Storage blocked: try the seed anyway; without the flag it just re-seeds
      // each fresh boot, which is harmless (the store copy short-circuits it).
    }
    try {
      const url = assetUrl('maps/default-world.wocmap.zip');
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[default-map] fetch failed: ${url} -> ${res.status}`);
        return null;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      // requireDeps=false: this is the trusted shipped bundle, whose builtin:
      // texture deps resolve from the code bundle (it ships map.json only).
      const map = await importMapBundleBytes(bytes, false);
      if (!map) {
        console.warn(`[default-map] import returned null for ${bytes.length}-byte bundle`);
        return null;
      }
      const existing = this.io.store.load(map.meta.id);
      const existingHasDecor = existing?.placements.some(
        (p) => p.assetId === 'biome/hexb_home_a' || p.assetId.startsWith('props/flower_bed'),
      );
      const existingUnedited = existing?.meta.updatedAt === map.meta.updatedAt;
      if (existing && existingHasDecor && !existingUnedited) {
        existing.placements = existing.placements.filter(
          (p) =>
            !(
              (p.assetId === 'biome/hexb_barracks' && p.x === 17.5 && p.z === -5.5) ||
              (p.assetId === 'biome/hexb_watchtower' && p.x === 27 && p.z === -13)
            ),
        );
        if (existing.content.npcs.proving_shore_guide) {
          existing.content.npcs.proving_shore_guide.dynamic = true;
        }
        this.io.saveLocal(existing);
        this.io.draftClear(map.meta.id);
        try {
          localStorage.setItem(SEEDED_KEY, '1');
        } catch {
          // ignore: the stored copy already short-circuits the next seed
        }
        return existing;
      }
      // Persist it so loadMostRecentSave reopens it next boot (and the maker's
      // edits save back onto it, not a throwaway).
      this.io.saveLocal(map);
      this.io.draftClear(map.meta.id);
      try {
        localStorage.setItem(SEEDED_KEY, '1');
      } catch {
        // ignore: the saved store copy already prevents a re-seed loop
      }
      return map;
    } catch (err) {
      console.warn('[default-map] seed threw', err);
      return null;
    }
  }

  /**
   * Register every imported model saved in this browser's IndexedDB (bundle
   * imports and past sessions) as a session object URL, so a loaded/opened map
   * that references 'local/<sha>' placements resolves them. Idempotent: an id
   * already registered is skipped (never re-minting a URL, which would leak the
   * old blob). Resolves true when at least one NEW asset was registered, so the
   * caller knows to re-instance placements that were holes. Best effort: a
   * blocked/empty store resolves false. Also feeds the asset browser's Imported
   * tab (it lists the registry).
   */
  private async ensureStoredLocalAssets(): Promise<boolean> {
    let added = false;
    try {
      for (const a of await loadStoredLocalAssets()) {
        const id = localAssetIdFor(a.sha256);
        if (localAssetUrl(id) !== null) continue; // already registered this session
        registerLocalAsset({
          id,
          name: a.name,
          url: URL.createObjectURL(new Blob([a.bytes], { type: a.mime })),
          byteSize: a.byteSize,
        });
        added = true;
      }
    } catch {
      // Blocked storage: the session keeps whatever is already registered.
    }
    return added;
  }

  // ---- active world -------------------------------------------------------------

  /**
   * Build the ACTIVE WorldContent over SHARED references into the working
   * document (terrainEdits, biomePaint, zones/camps/roads), so every edit is
   * immediately visible to terrainHeight()/waterLevel() without cloning.
   */
  private rebuildActiveWorld(): void {
    const map = this.map;
    const world: WorldContent = {
      zones: map.content.zones as WorldContent['zones'],
      camps: map.content.camps as WorldContent['camps'],
      npcs: map.content.npcs as WorldContent['npcs'],
      groundObjects: map.content.objects as WorldContent['groundObjects'],
      // The legacy roads (this map's moves and removals applied) plus the
      // authored ones; shared with the document while there are neither.
      roads: (map.roadDefs?.length || map.roadEdits
        ? combinedRoads(
            applyRoadEdits(map.content.roads ?? BUILTIN_WORLD.roads, map.roadEdits),
            map.roadDefs,
          )
        : (map.content.roads ?? BUILTIN_WORLD.roads)) as WorldContent['roads'],
      // Fork: propsMode drives the editable-foliage tiers. v0.31's
      // clonePropsWithoutEastbrookLayout is threaded through every branch, so a
      // custom world still gets its own prop clone with Eastbrook's layout
      // dropped, whichever tier the author picked.
      props:
        map.propsMode === 'empty'
          ? emptyZoneProps()
          : map.propsMode === 'editable-all'
            ? withoutEditableWorldProps(clonePropsKeepingAuthoredTowns(BUILTIN_WORLD.props))
            : map.propsMode === 'editable-major'
              ? withoutMajorWorldProps(clonePropsKeepingAuthoredTowns(BUILTIN_WORLD.props))
              : clonePropsKeepingAuthoredTowns(BUILTIN_WORLD.props),
      playerStart: map.playerStart ? { ...map.playerStart } : { ...PLAYER_START },
      terrainEdits: map.terrainEdits,
      placements: [],
      biomePaint: map.biomePaint,
      // Same tier answer the playtest projection gives, from the same function:
      // the renderer-owned builders that read a STATIC content module (the
      // Palmreach strand) must stand down wherever the document owns that
      // scenery as placements, and the viewport is exactly where a maker
      // notices they did not.
      promotedScenery: promotedSceneryFor(map.propsMode, map.placements, map.promotedScenery),
    };
    if (map.playerSpawnArea) world.playerSpawnArea = { ...map.playerSpawnArea };
    // Moved gameplay objects: the same frozen record the document holds, so
    // the viewport's Sim, colliders and renderer read the live edits.
    if (map.objectMoves) world.objectMoves = map.objectMoves;
    // The zone graveyards the viewport's Sim spawns its Spirit Healers at: the
    // active content must carry the same record (sim.ts world invariant), or
    // the collider build's healer-spot veto forks from the Sim's.
    const graveyards = zoneGraveyards(world.zones);
    if (graveyards.length > 0) world.services = { graveyards };
    if (map.blockers) world.blockers = map.blockers;
    if (map.caves) world.caves = map.caves;
    if (map.holes) world.holes = map.holes;
    if (map.holePatches) world.holePatches = map.holePatches;
    // Remesh detail regions must ride along or a LOADED map's regions are
    // render-inert until the first new brush stroke re-links the array
    // (detailRegionsRef), "the remesh tool doesn't work" after a reload.
    if (map.detailRegions) world.detailRegions = map.detailRegions;
    // Rails and Mesh Fix knockouts have exactly the same failure mode, and
    // both were missing here. The playtest projection (editor/custom_map.ts)
    // carries them, so a maker saw a mine railway in Playtest and an empty
    // tunnel in the Studio (SPACEY, 2026-09-20: "the traintrack inside the cave
    // has gone missing"), render/rail_tracks.ts reads WorldContent.rails,
    // never the document. Knockouts were inert the same way until the next
    // brush stroke happened to re-stamp activeWorld.terrainKnockouts.
    if (map.rails) world.rails = map.rails;
    if (map.terrainKnockouts) world.terrainKnockouts = map.terrainKnockouts;
    if (map.terrainVertexEdits) world.terrainVertexEdits = map.terrainVertexEdits;
    if (map.caveMeshCell) world.caveMeshCell = map.caveMeshCell;
    // FORK: the baked cave tiles ride the document; the mesher reads them
    // from the cache instead of marching (idempotent on the same array).
    if (map.waterLevel !== undefined) world.waterLevel = map.waterLevel;
    if (map.waterHue !== undefined) world.waterHue = map.waterHue;
    if (map.waterLum !== undefined) world.waterLum = map.waterLum;
    const fluids = fluidVolumesFromPlacements(map.placements);
    if (fluids.length > 0) world.fluids = fluids;
    if (map.worldHalfX !== undefined) world.worldHalfX = map.worldHalfX;
    if (map.decorationsMode === 'empty') world.decorationsMode = 'empty';
    if (map.decorationExclusions && map.decorationExclusions.length > 0) {
      world.decorationExclusions = map.decorationExclusions;
    }
    if (map.grassClear && map.grassClear.length > 0) world.grassClear = map.grassClear;
    if (map.clutter && map.clutter.length > 0) world.clutter = map.clutter;
    if (map.presentationMode !== undefined) world.presentationMode = map.presentationMode;
    if (map.terrainBase) world.terrainBase = map.terrainBase;
    if (map.skybox !== undefined) world.skybox = map.skybox;
    if (map.terrainStyle) world.terrainStyle = map.terrainStyle;
    if (map.timeScale !== undefined) world.timeScale = map.timeScale;
    if (map.zoneAtmosphere) world.zoneAtmosphere = map.zoneAtmosphere;
    if (map.assetViewDistance !== undefined) world.assetViewDistance = map.assetViewDistance;
    if (map.weather) world.weather = map.weather;
    // The authored lighting rides the projected world like the weather does.
    // Without it, the viewport's zone-atmosphere pass (renderer
    // applyZoneAtmosphere reads world.lighting ?? null) restamped the shipped
    // rig on the first frame after every load, so a map's own sun, sky and
    // night floor only ever showed once a maker touched a Lighting slider -
    // the Studio opened every map "dark and overcast" (SPACEY).
    if (map.lighting) world.lighting = { ...map.lighting };
    if (map.music) world.music = map.music;
    // Zone isolate cuts the built-in dressing at the source. buildProps() reads
    // the ACTIVE content once at engine build and drops the whole world's
    // buildings/wells/trees into one uncullable group, so filtering here (plus
    // the engine reload setZoneIsolate triggers) is what actually unloads them
    //, without it the terrain vanishes and every building keeps standing.
    // Safe to filter in place: props above is already a fresh clone per call.
    if (map.meta.overworldBase) Object.assign(world, liveWorldPreview(map));
    const isolate = this.isolateRect();
    if (isolate) world.props = propsWithinRect(world.props, isolate);
    this.activeWorld = world;
    // Roads drive the terrain splat + flattening through roadDistance. v0.35
    // re-derives the smoothed curves from the ACTIVE content whenever the
    // content generation changes, which setActiveWorldContent bumps, so the
    // fork's explicit setAuthoredRoads override is no longer needed here.
    setActiveWorldContent(world);
    // The whole terrainEdits array was swapped: every derived cache is stale.
    this.terrainEditsMutated();
  }

  /** The document's blocker list, lazily created and SHARED with the active
   *  WorldContent so the sim's colliders always read the live array. */
  private blockersRef(): BlockerDef[] {
    if (!this.map.blockers) this.map.blockers = [];
    if (this.activeWorld.blockers !== this.map.blockers) {
      this.activeWorld.blockers = this.map.blockers;
    }
    return this.map.blockers;
  }

  /** The document's cave list, lazily created and SHARED with the active
   *  WorldContent so terrainHeight()/groundHeightNear() read the live array. */
  private cavesRef(): CaveDef[] {
    if (!this.map.caves) this.map.caves = [];
    if (this.activeWorld.caves !== this.map.caves) {
      this.activeWorld.caves = this.map.caves;
    }
    return this.map.caves;
  }

  /** The document's terrain-hole list, lazily created and SHARED with the
   *  active WorldContent (same contract as cavesRef). */
  private holesRef(): TerrainCut[] {
    if (!this.map.holes) this.map.holes = [];
    if (this.activeWorld.holes !== this.map.holes) {
      this.activeWorld.holes = this.map.holes;
    }
    return this.map.holes;
  }

  /** The document's hole-patch list (same contract as holesRef). */
  private holePatchesRef(): TerrainCut[] {
    if (!this.map.holePatches) this.map.holePatches = [];
    if (this.activeWorld.holePatches !== this.map.holePatches) {
      this.activeWorld.holePatches = this.map.holePatches;
    }
    return this.map.holePatches;
  }

  /** EVERY blocker mutation (add, erase, undo/redo) funnels here: the cached
   *  static-collider grid is stale and the overlays must repaint. */
  private blockersMutated(): void {
    invalidateStaticColliders();
    this.viewport3d?.rebuildBlockers();
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
  }

  private syncWaterToActive(): void {
    if (this.map.waterLevel !== undefined) this.activeWorld.waterLevel = this.map.waterLevel;
    else delete this.activeWorld.waterLevel;
  }

  // ---- 3D viewport ---------------------------------------------------------------

  // Full-stage overlay while the 3D engine loads its assets (the stage is
  // otherwise a black canvas for several seconds on first boot).
  /**
   * Builds holding the loading curtain up. Boot and a document reload each
   * take a hold, so two overlapping builds (boot3d's start() on the built-in
   * map, then finishBoot's loadMap reload on the maker's save, which aborts
   * the first) cannot let the FIRST one to settle drop the curtain while the
   * second is still building: that was the "loading reaches 30 percent, goes
   * black, then the map appears" report. The curtain only comes down when the
   * last hold is released, and then only after the viewport has painted.
   */
  private loading3dHolds = 0;
  private loading3dPct = 0;

  private show3dLoading(): void {
    this.loading3dHolds++;
    // A curtain still fading out from the previous build is replaced by a
    // fresh opaque one, never reused mid-fade.
    for (const stale of this.stage3dEl.querySelectorAll('.ed-3d-loading-out')) stale.remove();
    if (this.stage3dEl.querySelector('.ed-3d-loading')) return;
    this.loading3dPct = 0;
    const overlay = el('div', 'ed-3d-loading');
    overlay.setAttribute('role', 'status');
    const text = el('div', 'ed-3d-loading-text');
    text.textContent = t('editor.status.loading3d');
    // A real progress bar under the spinner: the viewport reports how far the
    // build is (assets, engine, then the zone under the camera) so a maker
    // watching a black stage can see how long it will take instead of guessing.
    const bar = el('div', 'ed-3d-loading-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', '0');
    bar.append(el('div', 'ed-3d-loading-fill'));
    const pct = el('div', 'ed-3d-loading-pct');
    pct.textContent = '0%';
    overlay.append(el('div', 'ed-3d-loading-spin'), text, bar, pct);
    this.stage3dEl.appendChild(overlay);
  }

  /** Drive the loading curtain from the viewport's build progress. */
  private set3dLoadingProgress(percent: number, stage: 'assets' | 'engine' | 'zone'): void {
    const overlay = this.stage3dEl.querySelector('.ed-3d-loading');
    if (!overlay || overlay.classList.contains('ed-3d-loading-out')) return;
    // Monotonic for the life of one curtain: a build that supersedes another
    // restarts its own count at zero, and the bar must not run backwards.
    const p = Math.max(this.loading3dPct, Math.max(0, Math.min(100, Math.round(percent))));
    this.loading3dPct = p;
    const fill = overlay.querySelector('.ed-3d-loading-fill') as HTMLElement | null;
    if (fill) fill.style.width = `${p}%`;
    overlay.querySelector('.ed-3d-loading-bar')?.setAttribute('aria-valuenow', String(p));
    const pct = overlay.querySelector('.ed-3d-loading-pct');
    if (pct) pct.textContent = `${p}%`;
    const text = overlay.querySelector('.ed-3d-loading-text');
    if (text) {
      text.textContent = t(
        stage === 'assets'
          ? 'editor.status.loading3dAssets'
          : stage === 'engine'
            ? 'editor.status.loading3dEngine'
            : 'editor.status.loading3dZone',
      );
    }
  }

  private hide3dLoading(): void {
    this.loading3dHolds = Math.max(0, this.loading3dHolds - 1);
    if (this.loading3dHolds > 0) return;
    const overlay = this.stage3dEl.querySelector('.ed-3d-loading') as HTMLElement | null;
    if (!overlay || overlay.classList.contains('ed-3d-loading-out')) return;
    this.set3dLoadingProgress(100, 'zone');
    // Let the viewport paint its first frames behind the curtain before it
    // goes: start() resolves when the zone is BUILT, one frame before it is
    // drawn, and lifting the curtain on that frame is a black flash.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        // A new build took a hold while we waited: it owns the curtain now.
        if (this.loading3dHolds > 0 || !overlay.isConnected) return;
        overlay.classList.add('ed-3d-loading-out');
        const done = (): void => {
          if (overlay.isConnected && overlay.classList.contains('ed-3d-loading-out'))
            overlay.remove();
        };
        overlay.addEventListener('transitionend', done, { once: true });
        window.setTimeout(done, 600);
      }),
    );
  }

  private boot3d(): void {
    if (this.viewport3d) return;
    this.show3dLoading();
    try {
      this.viewport3d = new Editor3DViewport(this.stage3dEl, this.map, {
        toolActive: () => this.toolWantsPointer(),
        // Vertices mode claims Shift+drag too: without it the camera pan wins
        // and a Shift rubber band never reaches the tool at all.
        // Slope has no inverted mode, so Shift+drag keeps panning with it.
        shiftEditsTool: () =>
          (isSculptTool(this.tool) && this.tool !== 'slope') ||
          (this.tool === 'meshfix' && this.meshFixVertexMode),
        onEditStart: (w, ev) => this.editStart(w, ev),
        onEditMove: (w, ev) => this.editMove(w, ev),
        onEditEnd: (ev) => this.editEnd(ev),
        onHover: (w) => this.hover3d(w),
        onTap: (cx, cy, w, additive) => this.tap3d(cx, cy, w, additive),
        onRightTap: (w) => this.rightTap3d(w),
        // Collision Master: the workbench asset never drags; clicks pick
        // volumes/components instead.
        placementDragEnabled: () =>
          isSelectionTool(this.tool) && !this.hitboxEdit && !this.meshEditActive(),
        ...this.placementPickingHooks(),
        onPlacementDragStart: (index) => this.beginPlacementDrag(index),
        onPlacementDragMove: (w) => this.placementDragMove(w),
        onPlacementDragEnd: () => this.endPlacementDrag(),
        onNpcDragStart: (key) => this.beginNpcDrag(key),
        onNpcDragMove: (w) => this.npcDragMove(w),
        onNpcDragEnd: () => this.endNpcDrag(),
        onMobDragStart: (id) => this.beginMobDrag(id),
        onMobDragMove: (w) => this.mobSelectDragMove(w),
        onMobDragEnd: () => this.endMobDrag(),
        onObjectDragStart: (key) => this.beginObjectDrag(key),
        onObjectDragMove: (w) => this.objectMoves.dragMove(w),
        onObjectDragEnd: () => this.objectMoves.endDrag(),
        onBoxSelect: (indices, additive) => this.selectPlacements(indices, additive),
        placementLabel: (index) => {
          const placement = this.map.placements[index];
          return placement
            ? placement.name?.trim() || this.placementLabel(placement.assetId)
            : t('editor.picking.asset', { number: formatNumber(index + 1) });
        },
        onTransformWheel: (kind, deltaY) => this.transformWheel(kind, deltaY),
        onFlySpeedWheel: (deltaY) => this.flySpeedWheel(deltaY),
        gizmoMode: () =>
          this.cmSculptActive() || this.cmPolyActive() || this.cmPolyBuildActive()
            ? null
            : isTransformTool(this.tool) &&
                (this.selectedPlacement !== null || this.pendingCut !== null)
              ? this.tool
              : null,
        onGizmoChange: (change) =>
          this.updateSelectedPlacement(change, false, { detachOnMove: true }),
        onFireGizmoChange: (change) => this.updateSelectedFireEmitter(change, false),
        onHitboxGizmoChange: (change) => this.applyHitboxGizmo(change),
        onCmGizmoChange: (change) => this.applyCmGizmoChange(change),
        onCmMarquee: (verts) => this.selectCmVerts(verts),
        onHitboxHandleEdit: (boxIndex, box) => this.applyHitboxHandleEdit(boxIndex, box),
        onHitboxHandleCommit: () => this.commitHitboxes(),
        onHitboxBoxSelect: (indices) => this.selectHitboxes(indices),
        onCutGhostGizmoChange: (change) => this.gizmoPendingCut(change),
        onGizmoEnd: () => {
          if (this.pendingCut && this.selectedPlacement === null) {
            this.inspector.refresh();
            return;
          }
          if (this.cmDragBase) this.commitCmGesture();
          else if (this.hitboxDragBase) this.commitHitboxes();
          else if (this.selectedFireEmitter !== null) this.updateSelectedFireEmitter({}, true);
          else this.updateSelectedPlacement({}, true);
          this.inspector.refresh();
        },
        onBuildProgress: (percent, stage) => this.set3dLoadingProgress(percent, stage),
      });
      this.viewport3d.setFreeFly(this.freeFlyOn);
      this.viewport3d.setInvertPan(this.invertPanOn);
      this.viewport3d.setShowPlayer(this.showPlayerOn);
      this.viewport3d.setCollidersHidden(this.collidersHiddenOn);
      this.viewport3d.setLocationsHidden(this.locationsHiddenOn);
      this.viewport3d.setSnowEnabled(this.snowfallOn);
      this.viewport3d.setWireframe(this.wireframeOn);
      this.viewport3d.setXray(this.xrayOn);
      this.viewport3d.setCameraSpeeds(this.cameraSpeeds);
      this.viewport3d.setOrthographic(this.orthographicOn);
      this.viewport3d.setAxisWidgetVisible(this.axisGimbalOn);
      this.viewport3d.setVisibilityProfile(this.visibilityProfile);
      this.viewport3d.setPerfOverlay(this.perfOverlay);
      this.viewport3d.setWorldSpeed(this.map.timeScale ?? 1);
      this.viewport3d.setAssetViewDistance(
        this.map.assetViewDistance ?? DEFAULT_ASSET_VIEW_DISTANCE,
      );
      this.viewport3d.setLighting(this.lighting);
      void this.viewport3d
        .start()
        .then(() => {
          this.hide3dLoading();
          this.syncFootprintOverlay();
          // Node guides are always-on chrome now: sync them at boot/load too,
          // not just on tool switches.
          this.refreshCaveGuides();
          this.refreshRockGuides();
        })
        .catch((e) => {
          console.error('3D viewport failed; falling back to 2D', e);
          this.hide3dLoading();
          this.viewMode = '2d';
          this.applyViewMode();
        });
    } catch (e) {
      console.error('3D viewport unavailable; using 2D', e);
      this.hide3dLoading();
      this.viewMode = '2d';
      this.applyViewMode();
    }
  }

  // ---- dungeon-layout mode ---------------------------------------------------
  // A parallel stage over the same 3D viewport: it edits an authored
  // DungeonLayout (src/editor/dungeon/) instead of the map document. The map
  // document is untouched while it runs; entering just needs the 3D engine up.
  private dungeonMode: DungeonEditorMode | null = null;

  private enterDungeonMode(): void {
    const entry = AUTHORED_DUNGEONS[0];
    if (!entry || this.dungeonMode?.isActive()) return;
    if (this.viewMode !== '3d') this.setViewMode('3d');
    const viewport = this.viewport3d;
    if (!viewport) return;
    this.setTool('select');
    this.dungeonMode ??= new DungeonEditorMode({
      viewport,
      panelHost: document.body,
      onExit: () => undefined,
    });
    // The engine may still be booting (assets await); retry on the next frames
    // until the stage port exists, bounded so a dead boot cannot loop forever.
    let attempts = 0;
    const tryEnter = (): void => {
      if (this.dungeonMode?.isActive()) return;
      if (viewport.dungeonStagePort()) {
        this.dungeonMode?.enter(entry);
        return;
      }
      if (++attempts < 600) requestAnimationFrame(tryEnter);
    };
    tryEnter();
  }

  // The retired segment editor was replaced by the authored Thornhollow map.
  private toggleBattlegroundPanel(): void {
    this.enterBattlegroundMode();
  }

  private enterBattlegroundMode(): void {
    this.toolbar.setRavenriftOpen(false);
    this.toasts.error(
      'Ravenrift mode is not available yet: v0.35 replaced the battleground layout with the authored Thornhollow map.',
    );
  }

  private setViewMode(mode: '3d' | '2d'): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.applyViewMode();
    if (mode === '3d') {
      this.boot3d();
      // 2D marker drags reshape hubs/zones: re-mesh once when returning to 3D.
      if (this.markerMovedWhile2d) {
        this.viewport3d?.rebuildTerrainFull();
        this.markerMovedWhile2d = false;
      }
    }
    this.inspector.refresh();
  }

  private setOrthographic(on: boolean): void {
    this.orthographicOn = on;
    this.viewport3d?.setOrthographic(on);
    this.topbar.setProjectionMode(on);
  }

  private setAxisGimbalVisible(on: boolean): void {
    this.axisGimbalOn = on;
    this.viewport3d?.setAxisWidgetVisible(on);
    this.topbar.setAxisGimbalVisible(on);
    writePref(AXIS_GIMBAL_PREF_KEY, on);
  }

  private applyViewMode(): void {
    const is3d = this.viewMode === '3d';
    this.stage3dEl.style.display = is3d ? '' : 'none';
    this.stage2d.style.display = is3d ? 'none' : '';
    // Pause the hidden 3D render loop (it refreshes itself on show).
    this.viewport3d?.setVisible(is3d);
    this.topbar.setViewMode(this.viewMode);
    if (!is3d) {
      this.resize();
      this.canvasDirty = true;
    }
  }

  // ---- tool state ----------------------------------------------------------------

  private setTool(tool: EditorTool): void {
    // Music-area rects are authoring chrome: draw them only for the tool.
    this.viewport3d?.setMusicPreview(tool === 'music');
    // Point-sound radius spheres likewise show all only while the tool is active.
    this.viewport3d?.setSoundPreview(tool === 'sound');
    // Mesh Fix works on the raw polygons: wireframe is on while it is the
    // tool, and the maker's own Camera-tab choice comes back when it is not.
    if ((tool === 'meshfix') !== (this.tool === 'meshfix')) {
      this.viewport3d?.setWireframe(tool === 'meshfix' ? true : this.wireframeOn);
    }
    if (this.viewport3d?.grabFollowing) {
      this.viewport3d.cancelGrabFollow();
      this.endPlacementDrag();
    }
    // An unfinished patrol draft belongs to the Mob tool only: leaving the tool
    // abandons it rather than leaving invisible clicks armed, and the committed
    // route overlay goes with it.
    if (tool !== 'entity' && this.tool === 'entity') {
      this.cancelMobRoute();
      this.viewport3d?.setCityPathPreview(null);
    }
    // A pending Cut/Carve ghost belongs to the Caves tool: leaving the tool
    // discards it rather than leaving an invisible commit armed. FORK: the
    // selection tools (Select/Move/Rotate/Scale, keys 1-4) are the exception,
    // so 2-4 can grab the ghost with the gizmo, 1 parks it, and the maker
    // comes back (or presses Enter) to cut.
    if (this.pendingCut && tool !== 'tunnel' && !isSelectionTool(tool)) this.cancelPendingCut();
    if (this.tool === 'building' && tool !== 'building') this.buildingWorkspace.cancel();
    this.keepAssetBrowser =
      tool === 'building' ||
      tool === 'place' ||
      tool === 'foliage' ||
      (tool === 'city' && this.citySubtool === 'kit') ||
      (isSelectionTool(tool) && this.keepAssetBrowser);
    if (this.buildingWorkspace)
      this.buildingWorkspace.setActive(
        tool === 'building' || (isSelectionTool(tool) && this.buildingWorkspace.active),
      );
    this.tool = tool;
    this.syncSelectedMobRouteOverlay();
    // Cave + rock node guides stay visible in EVERY tool: the blue points are
    // real placements the Move/Scale gizmos can grab, so hiding them on tool
    // switch read as "my nodes disappeared". setTool only re-syncs them.
    // Hole rings show only while the Caves tool is up (refreshHoleGuides gates).
    this.refreshCaveGuides();
    this.refreshRockGuides();
    this.refreshHoleGuides();
    this.toolbar.setActive(tool);
    this.inspector.showToolTab();
    // The asset browser backs the Place tool and the Foliage tool's custom brush.
    this.assets.setVisible(this.keepAssetBrowser);
    // The placement selection survives switching among Select/Move/Rotate/Scale
    // (Blender flow: pick, then G/R/S); any other tool drops it.
    if (!isSelectionTool(tool)) this.setSelectedPlacement(null);
    else {
      // A renderer reload or a terrain-preserving document swap can recreate
      // the viewport's selection surface independently from the app state.
      // Re-feed the active placement whenever a selection tool is chosen so
      // Move/Rotate/Scale always have the same target as the inspector.
      this.viewport3d?.setSelectedPlacement(this.selectedPlacement);
      this.syncMultiSelectionView();
      // Preview deliberately hides editor overlays, including the transform
      // gizmo. Choosing an explicit transform is an editing action, so leave
      // preview rather than presenting a pressed tool with invisible handles.
      if (isTransformTool(tool) && this.previewOn) this.setPreviewMode(false);
    }
    if (!isSelectionTool(tool) && tool !== 'entity') this.selectedKey = null;
    if (tool !== 'entity') {
      // NPCs and mobs are first-class in Select mode (picked, dragged and
      // nudged like placements), so their selection survives the
      // Select/transform tools.
      if (!isSelectionTool(tool)) {
        this.clearMobSelection();
        this.syncSelectedMobRouteOverlay();
        this.clearNpcSelection();
        this.npcFacingDragBase = null;
      }
    }
    if (tool !== 'camp') this.selectedCamp = null;
    if (tool !== 'select' && tool !== 'light' && this.selectedLight !== null) {
      this.selectedLight = null;
      this.viewport3d?.setSelectedLight(null);
    }
    if (tool !== 'music' && this.selectedMusicArea !== null) {
      this.selectedMusicArea = null;
      this.viewport3d?.setSelectedMusicArea(null);
    }
    if (tool !== 'select' && tool !== 'sound' && this.selectedSound !== null) {
      this.selectedSound = null;
      this.viewport3d?.setSelectedSound(null);
    }
    if (tool !== 'decal' && this.selectedDecal !== null) {
      this.selectedDecal = null;
      this.viewport3d?.setSelectedDecal(null);
    }
    // Footprint rings for every stamp only while the Decal tool is up.
    this.viewport3d?.setDecalOverlay(tool === 'decal');
    if (tool === 'decal' && !this.decalThumbsWarmed) {
      // Imported decals live in IndexedDB: read them once so the library grid
      // has thumbnails, then redraw the panel with them.
      this.decalThumbsWarmed = true;
      void warmDecalThumbs().then(() => {
        if (this.tool === 'decal') this.inspector.refresh();
      });
    }
    if (tool !== 'blocker') this.clearBlockerDraft();
    if (tool !== 'city') this.cityToolReset();
    this.buildingWorkspace?.syncView();
    this.buildTransformControls?.refresh();
    this.selectionQuickActions?.refresh();
    if (tool === 'spawn') this.viewport3d?.setZonePreview(this.map.playerSpawnArea ?? null);
    else if (this.tool !== 'zone' && this.tool !== 'music') this.viewport3d?.setZonePreview(null);
    this.viewport3d?.clearBrush();
    this.syncFootprintOverlay();
    this.inspector.refresh();
    this.canvasDirty = true;
  }

  /**
   * Effective footprint overlay = the user's manual toggle OR a collision-
   * authoring context that forces it on (the Place tool with collide checked,
   * or the Blocker tool). Leaving those contexts falls back to the manual
   * setting untouched, so the toggle's semantics never change.
   */
  /** The collision hitbox overlay (topbar toggle + inspector checkbox share
   *  this): the shapes the sim really blocks with, drawn over the whole map. */
  private setHitboxOverlay(on: boolean): void {
    this.footprintsOn = on;
    writePref(FOOTPRINTS_PREF_KEY, on);
    this.topbar.setHitboxes(on);
    this.syncFootprintOverlay();
    this.inspector.refresh();
    this.topbar.syncCameraToggles();
  }

  private syncFootprintOverlay(): void {
    const forced = this.tool === 'blocker' || (this.tool === 'place' && this.placeCollide);
    // Preview mode wins: no editor chrome, whatever the tool wants.
    // Collision Master wins harder: the BLUE authored volumes are the single
    // source of truth in the studio, the red derived-box footprint drawn over
    // them read as "random collision" (it is only the sim's band-box
    // approximation, regenerated from the blue shapes on every edit).
    this.viewport3d?.showFootprints(
      (this.footprintsOn || forced) && !this.previewOn && !this.meshEditActive(),
    );
  }

  /** Preview mode (topbar): the map as it looks in-game ? every editor-only
   *  overlay hidden. Purely a view state; nothing in the document changes. */
  private setPreviewMode(on: boolean): void {
    if (this.previewOn === on) return;
    this.previewOn = on;
    this.topbar.setPreview(on);
    this.viewport3d?.setPreviewMode(on);
    this.selectionQuickActions?.refresh();
    this.syncFootprintOverlay();
  }

  /** Zone isolate (Full Build ⇄ Zone). View state only, the residency policy
   *  and every filtered view live in the viewport/renderer; the document never
   *  changes. Persisted per map like the camera. */
  /** The isolated zone's world rect, or null in Full Build. */
  private isolateRect(): ZoneRect | null {
    if (this.isolateZoneId === null) return null;
    const zone = this.map.content.zones.find((z) => z.id === this.isolateZoneId);
    return zone ? zoneRectOf(zone) : null;
  }

  private setZoneIsolate(zoneId: string | null): void {
    const zone = zoneId ? (this.map.content.zones.find((z) => z.id === zoneId) ?? null) : null;
    // The camera-zone stream DRIVES this method rather than competing with it,
    // so there is nothing to tear down here. A maker who hand-picks a
    // different zone while the stream is on simply moves it; the next poll
    // leaves that choice alone until the camera is clear of the zone (or
    // forever, if the padlock is on).
    this.isolateZoneId = zone?.id ?? null;
    const rect = zone ? zoneRectOf(zone) : null;
    // Re-project the active world FIRST (isolate filters its prop dressing),
    // then hand the viewport the rect and rebuild the engine over it: props
    // are baked at engine build, so only a rebuild truly unloads them.
    //
    // Isolate rebuilds the engine, which drops every view-state overlay the
    // renderer was holding (the collision hitbox overlay above all, it lives
    // on PlacedAssetsView and comes back off). finishViewportMapTransition is
    // the same restore the map-load path runs; without it, toggling isolate
    // silently turned the hitboxes off and they only reappeared in Collision
    // Master, which forces its own view.
    this.enterIsolateRect(rect);
    this.applyStreamGuide();
    this.topbar.setZoneIsolate(zone?.name ?? null);
    writeJsonPref(ZONE_ISOLATE_PREF_KEY, { mapId: this.map.meta.id, zoneId: this.isolateZoneId });
    this.inspector.refresh();
  }

  // ---- camera-zone stream -------------------------------------------------

  /** Scene panel: turn the camera-zone stream on/off. On, the zone under the
   *  CAMERA stays resident and swaps as the camera travels; off restores Full
   *  Build. Entering goes through setZoneIsolate like a hand-picked zone, so
   *  there is exactly one residency path to reason about. */
  private setCameraZoneStream(on: boolean): void {
    if (this.cameraZoneOn === on) return;
    this.cameraZoneOn = on;
    window.clearInterval(this.cameraZoneTimer);
    this.cameraZoneTimer = 0;
    this.cameraZonePending = null;
    if (on) {
      const set = this.cameraZoneSet();
      this.applyStreamZones(set);
      this.cameraZoneTimer = window.setInterval(() => this.pollCameraZone(), CAMERA_ZONE_POLL_MS);
      this.toasts.info(
        t('editor.scene.zoneStreamOn', { zone: this.streamZoneLabel(), count: set.length }),
      );
    } else {
      this.cameraZoneLocked = false;
      this.streamZoneIds = [];
      this.setZoneIsolate(null);
    }
    this.persistCameraZonePref();
    this.inspector.refresh();
  }

  /** Scene panel padlock: hold the zone that is resident now, whatever the
   *  camera does, until the maker unlocks it. */
  private setCameraZoneLocked(locked: boolean): void {
    if (this.cameraZoneLocked === locked) return;
    this.cameraZoneLocked = locked;
    this.cameraZonePending = null;
    this.persistCameraZonePref();
    this.inspector.refresh();
  }

  private persistCameraZonePref(): void {
    writeJsonPref(CAMERA_ZONE_PREF_KEY, {
      mapId: this.map.meta.id,
      on: this.cameraZoneOn,
      locked: this.cameraZoneLocked,
    });
  }

  /** The zone under the camera EYE.
   *
   *  cameraPosition(), not cameraFocus() and not the player: the editor's
   *  "player" is pinned to the orbit pivot, and the pivot can sit a long way
   *  from the eye on a wide orbit, streaming either one loads the region the
   *  maker is looking AT or standing on rather than the one they are looking
   *  FROM, which is the region actually filling the viewport. */
  private cameraZoneId(): string | null {
    const eye = this.viewport3d?.cameraPosition() ?? { x: 0, z: 0 };
    return zoneForCamera(
      this.map.content.zones,
      eye.x,
      eye.z,
      this.isolateZoneId,
      this.cameraZoneLocked,
    );
  }

  /** The STREAM_ZONE_COUNT zones the stream should hold, nearest first. The
   *  set is held until the camera leaves every zone in it and then swaps
   *  wholesale, so the engine reloads once per crossing instead of per zone. */
  private cameraZoneSet(): string[] {
    const eye = this.viewport3d?.cameraPosition() ?? { x: 0, z: 0 };
    return zoneSetForCamera(
      this.map.content.zones,
      eye.x,
      eye.z,
      this.streamZoneIds,
      this.cameraZoneLocked,
      undefined,
      STREAM_ZONE_COUNT,
    );
  }

  /** "Eastbrook Vale +3": the nearest zone names the set, the rest are a count
   *  (four full names would not fit the topbar or the Scene hint). */
  private streamZoneLabel(): string {
    const [first, ...rest] = this.streamZoneIds;
    const name = this.map.content.zones.find((q) => q.id === first)?.name ?? first ?? '';
    return rest.length > 0 ? `${name} +${rest.length}` : name;
  }

  /** Make `ids` the resident set: one union rect through the same residency
   *  path zone isolate uses, so there is still exactly one way to unload. */
  private applyStreamZones(ids: readonly string[]): void {
    this.streamZoneIds = [...ids];
    this.isolateZoneId = ids[0] ?? null;
    const rect = zonesUnionRect(this.map.content.zones, this.streamZoneIds);
    this.enterIsolateRect(rect);
    this.topbar.setZoneIsolate(ids.length > 0 ? this.streamZoneLabel() : null);
    this.applyStreamGuide();
    writeJsonPref(ZONE_ISOLATE_PREF_KEY, { mapId: this.map.meta.id, zoneId: this.isolateZoneId });
    this.inspector.refresh();
  }

  /** Push the guide's on/off and its rect to the viewport. */
  private applyStreamGuide(): void {
    const rect =
      this.streamZoneIds.length > 0
        ? zonesUnionRect(this.map.content.zones, this.streamZoneIds)
        : this.isolateZoneId
          ? zonesUnionRect(this.map.content.zones, [this.isolateZoneId])
          : null;
    this.viewport3d?.setResidencyGuideRect(rect);
    this.viewport3d?.setResidencyGuide(this.streamGuideOn);
  }

  /** Scene panel: draw light red walls where the resident zones end. */
  private setStreamGuide(on: boolean): void {
    if (this.streamGuideOn === on) return;
    this.streamGuideOn = on;
    writePref(STREAM_GUIDE_PREF_KEY, on);
    this.applyStreamGuide();
    this.inspector.refresh();
  }

  /** One poll tick: has the camera committed to a different zone for long
   *  enough to be worth re-streaming? */
  private pollCameraZone(): void {
    if (!this.cameraZoneOn || !this.viewport3d) return;
    if (this.cameraZoneLocked) return;
    // Never re-stream mid-gesture: a sculpt stroke, a placement drag or a pan
    // is exactly when a rebuild would be felt, and the camera is about to
    // settle anyway.
    if (this.pointerEditActive || this.placementDragging || this.panning) return;
    const want = this.cameraZoneSet();
    const key = want.join(',');
    if (want.length === 0 || key === this.streamZoneIds.join(',')) {
      this.cameraZonePending = null;
      return;
    }
    const now = Date.now();
    if (key !== this.cameraZonePending) {
      this.cameraZonePending = key;
      this.cameraZonePendingSince = now;
      return;
    }
    if (now - this.cameraZonePendingSince < CAMERA_ZONE_SETTLE_MS) return;
    this.cameraZonePending = null;
    this.applyStreamZones(want);
  }

  /** Enter or leave an arbitrary residency rect, the full unload path shared by
   *  zone isolate and the camera-zone stream. */
  private enterIsolateRect(rect: ZoneRect | null): void {
    this.rebuildActiveWorld();
    void this.viewport3d?.setZoneIsolate(rect).then(() => {
      this.finishViewportMapTransition();
      // The reload inside setZoneIsolate drops every editor-owned overlay,
      // the perimeter guide included, so it is re-applied HERE rather than
      // before the await, otherwise the guide vanished the moment the next
      // four zones streamed in and never came back.
      this.applyStreamGuide();
    });
    this.applyIsolateViewProfile(rect);
  }

  /** Size the view profile to the streamed rect: the residency fog clamp reads
   *  the deliberately-unbuilt outside world as a 45-yard wall otherwise. */
  private applyIsolateViewProfile(rect: ZoneRect | null): void {
    this.viewport3d?.setVisibilityProfile(
      rect
        ? {
            distance: Math.max(this.visibilityProfile.distance, isolateViewDistance(rect)),
            haze: this.visibilityProfile.haze,
          }
        : this.visibilityProfile,
    );
  }

  /** Restore the stream after a map load. */
  private restoreCameraZoneStream(): void {
    const saved = readJsonPref<{ mapId?: string; on?: boolean; locked?: boolean }>(
      CAMERA_ZONE_PREF_KEY,
    );
    if (!saved || saved.mapId !== this.map.meta.id || !saved.on) return;
    this.cameraZoneLocked = saved.locked === true;
    this.setCameraZoneStream(true);
  }

  private toggleZoneIsolate(): void {
    if (this.isolateZoneId !== null) {
      this.setZoneIsolate(null);
      return;
    }
    const zone = this.currentCameraZone();
    if (zone) this.setZoneIsolate(zone.id);
  }

  /** Restore this map's saved isolate state (called after loadMap). The camera
   *  chunk stream is checked first and wins: they share one rect, and it is the
   *  more specific of the two. */
  private restoreZoneIsolate(): void {
    this.restoreCameraZoneStream();
    // The camera-zone stream already set a residency zone; a saved hand-pick
    // must not fight it.
    if (this.cameraZoneOn) return;
    const saved = readJsonPref<{ mapId?: string; zoneId?: string | null }>(ZONE_ISOLATE_PREF_KEY);
    if (!saved || saved.mapId !== this.map.meta.id || !saved.zoneId) return;
    if (!this.map.content.zones.some((z) => z.id === saved.zoneId)) return;
    this.setZoneIsolate(saved.zoneId);
  }

  /** Full Build Preview: leave isolate mode and stream every zone. */
  private async fullBuildPreview(): Promise<void> {
    if (this.fullBuildRunning) return;
    // Full Build is the opposite of both residency modes; end whichever is on.
    if (this.cameraZoneOn) this.setCameraZoneStream(false);
    if (this.isolateZoneId !== null) this.setZoneIsolate(null);
    this.fullBuildRunning = true;
    try {
      await this.viewport3d?.fullBuildPreview((done, total) => {
        if (done === total) {
          this.toasts.success(t('editor.topbar.fullBuildDone', { total }));
        } else if (done % 4 === 0) {
          this.toasts.info(t('editor.topbar.fullBuildProgress', { done, total }));
        }
      });
    } finally {
      this.fullBuildRunning = false;
    }
  }

  /** Tools that claim the left pointer in the 3D viewport. The transform trio
   *  goes through the placement-drag path instead, so empty ground still orbits. */
  private toolWantsPointer(): boolean {
    // The mesh-edit brushes (poly-snap, poly-build) claim the pointer on ANY
    // tool: the drag models geometry instead of orbiting or box-selecting.
    if (this.cmSculptActive() || this.cmPolyActive() || this.cmPolyBuildActive()) return true;
    return this.tool !== 'select' && this.tool !== 'water' && !isTransformTool(this.tool);
  }

  private isDragTool(): boolean {
    if (this.cmSculptActive() || this.cmPolyActive() || this.cmPolyBuildActive()) return true;
    if (this.tool === 'tunnel' && (this.tunnelMode === 'sculpt' || this.tunnelMode === 'fill')) {
      return true;
    }
    return (
      this.tool === 'building' ||
      this.tool === 'raise' ||
      this.tool === 'lower' ||
      this.tool === 'smooth' ||
      this.tool === 'flatten' ||
      this.tool === 'slope' ||
      this.tool === 'paint' ||
      this.tool === 'foliage' ||
      this.tool === 'clutter' ||
      this.tool === 'meshfix' ||
      this.tool === 'grassclear' ||
      this.tool === 'entity' ||
      this.tool === 'spawn' ||
      this.tool === 'zone' ||
      this.tool === 'music' ||
      this.tool === 'erase'
    );
  }

  // ---- shared edit routing (3D hooks + 2D pointer both land here) -----------------

  private editStart(w: Vec2, ev?: PointerEvent): void {
    this.lastEditPointer = ev ? { x: ev.clientX, y: ev.clientY } : null;
    this.pointerEditActive = true;
    if (this.tool === 'building') {
      this.buildingWorkspace.begin(w, ev);
      return;
    }
    if (this.cmSculptActive() && ev) {
      this.cmSculptBegin(ev);
      return;
    }
    if (this.cmPolyBuildActive() && ev) {
      this.cmPolyBuildBegin(ev);
      return;
    }
    if (this.cmPolyActive() && ev) {
      this.cmPolyBegin(ev);
      return;
    }
    switch (this.tool) {
      case 'raise':
      case 'lower':
      case 'smooth':
      case 'flatten':
      case 'slope':
        if (this.tool === 'raise' && this.sculptGrab && ev) {
          this.grabBegin(w, ev);
          break;
        }
        this.strokeInvert = ev?.shiftKey === true;
        this.strokeBegin(w);
        break;
      case 'tunnel':
        this.tunnelBegin(w, ev);
        break;
      case 'eyedropper':
        this.eyedropAt(w);
        break;
      case 'paint':
        if (this.bucketArmed) {
          this.bucketFill(w);
          break;
        }
        this.paintBegin(w);
        break;
      case 'erase':
        this.eraseLast = null;
        this.eraseAt(w);
        break;
      case 'place':
        this.placeAt(w);
        break;
      case 'foliage':
        this.foliageBegin(w);
        break;
      case 'clutter':
        this.clutterBegin(w);
        break;
      case 'meshfix':
        if (this.meshFixVertexMode) this.vertexBegin(ev);
        else this.meshFixBegin(ev);
        break;
      case 'grassclear':
        this.grassClearBegin(w);
        break;
      case 'collider':
        this.insertColliderAt(w);
        break;
      case 'pond':
        this.insertPondAt(w);
        break;
      case 'fluid':
        this.insertFluidAt(w);
        break;
      case 'blocker':
        this.blockerStart = { ...w };
        this.blockerPreview = null;
        break;
      case 'camp':
        this.campClick(w);
        break;
      case 'entity': {
        // Patrol authoring claims every click until the route is committed, so
        // dropping a waypoint on top of a mob never re-picks the selection.
        if (this.mobRouteDraft) {
          this.mobRouteClick(w, ev);
          break;
        }
        if (this.npcPlaceVisualKey) {
          this.placeNpcAt(w, this.npcPlaceVisualKey);
          break;
        }
        const runtimeMob = ev ? this.viewport3d?.pickRuntimeMob(ev.clientX, ev.clientY) : null;
        if (runtimeMob) {
          const camp = this.individualCampForRuntimeMob(runtimeMob.id);
          if (camp) {
            // A split respawned the authored mobs with fresh ids (see
            // beginMobDrag): re-resolve, or this drag moves a dead entity.
            const liveMobId =
              this.viewport3d?.liveMobIdNearCamp(
                camp.mobId,
                camp.center,
                Math.max(4, camp.radius),
              ) ?? runtimeMob.id;
            this.clearNpcSelection();
            this.selectedMobIds = toggledMobSelection(
              this.selectedMobIds,
              liveMobId,
              ev?.ctrlKey === true,
            );
            if (this.selectedMobIds.has(liveMobId)) {
              this.selectedMobCamps.set(liveMobId, camp);
            } else {
              this.selectedMobCamps.delete(liveMobId);
            }
            for (const id of [...this.selectedMobCamps.keys()]) {
              if (!this.selectedMobIds.has(id)) this.selectedMobCamps.delete(id);
            }
            this.viewport3d?.setSelectedRuntimeMobs(this.selectedMobIds);
            this.selectedKey = null;
            this.markerDragStart = null;
            this.mobDragStart = this.selectedMobIds.has(liveMobId)
              ? {
                  pointer: { ...w },
                  camps: new Map(
                    [...this.selectedMobCamps].map(([id, selectedCamp]) => [
                      id,
                      { camp: selectedCamp, point: { ...selectedCamp.center } },
                    ]),
                  ),
                  dx: 0,
                  dz: 0,
                }
              : null;
            this.syncSelectedMobRouteOverlay();
            this.inspector.refresh();
            this.canvasDirty = true;
            break;
          }
        }
        this.clearMobSelection();
        const hit = pickMovableEntity(this.entities, w);
        if (hit?.kind === 'npc') {
          this.selectedNpcKeys = toggledKeySelection(
            this.selectedNpcKeys,
            hit.key,
            ev?.ctrlKey === true,
          );
          this.selectedKey = this.selectedNpcKeys.has(hit.key)
            ? hit.key
            : ([...this.selectedNpcKeys].pop() ?? null);
          this.viewport3d?.setSelectedRuntimeNpcs(this.selectedNpcKeys);
        } else {
          this.clearNpcSelection();
          this.selectedKey = hit?.key ?? null;
        }
        if (hit && this.selectedKey === hit.key) {
          this.markerDragStart = {
            key: hit.key,
            x: hit.point.x,
            z: hit.point.z,
          };
          if (hit.kind === 'npc') {
            this.npcDragBase = new Map(
              [...this.selectedNpcKeys]
                .map((key) => {
                  const npc = this.map.content.npcs[key.slice('npc:'.length)];
                  return npc ? ([key, { npc, point: { ...npc.pos } }] as const) : null;
                })
                .filter(
                  (entry): entry is readonly [string, { npc: NpcDef; point: Vec2 }] =>
                    entry !== null,
                ),
            );
          }
          this.grab = { x: w.x - hit.point.x, z: w.z - hit.point.z };
        } else {
          this.markerDragStart = null;
          this.npcDragBase = null;
        }
        this.syncSelectedMobRouteOverlay();
        this.inspector.refresh();
        this.canvasDirty = true;
        break;
      }
      case 'spawn':
        if (this.markerPlaceMode) this.addMarker(w);
        else {
          this.spawnAreaStart = { ...w };
          this.spawnAreaPreview = {
            minX: w.x,
            minZ: w.z,
            maxX: w.x,
            maxZ: w.z,
          };
        }
        break;
      case 'zone':
      case 'music':
        this.zoneStart = { ...w };
        this.zoneBox = { minX: w.x, minZ: w.z, maxX: w.x, maxZ: w.z };
        break;
      case 'light': {
        // A click on an existing bulb selects it (edit/delete); empty ground
        // places a new light.
        const hit = ev ? (this.viewport3d?.pickMapLight(ev.clientX, ev.clientY) ?? null) : null;
        if (hit !== null) this.setSelectedLight(hit);
        else this.placeLight(w);
        break;
      }
      case 'sound': {
        // A click on an existing sound badge selects it; empty ground places one.
        const hit = ev ? (this.viewport3d?.pickMapSound(ev.clientX, ev.clientY) ?? null) : null;
        if (hit !== null) this.setSelectedSound(hit);
        else this.placeSound(w);
        break;
      }
      case 'decal': {
        // A click on an existing stamp selects it; empty ground stamps a new
        // one. Alt-click always stamps, for layering marks inside a big circle.
        const hit =
          ev && !ev.altKey ? (this.viewport3d?.pickMapDecal(ev.clientX, ev.clientY) ?? null) : null;
        if (hit !== null) this.setSelectedDecal(hit);
        else this.placeDecal(w);
        break;
      }
      case 'rock':
        this.rockClick(w);
        break;
      case 'tree':
        this.treeClick(w);
        break;
      case 'build':
        this.buildClick(w);
        break;
      case 'city':
        this.cityClick(w, ev);
        break;
      case 'region':
        this.regionStart = { ...w };
        this.regionBox = { minX: w.x, minZ: w.z, maxX: w.x, maxZ: w.z };
        this.canvasDirty = true;
        break;
      default:
        break;
    }
  }

  private editMove(w: Vec2, ev?: PointerEvent): void {
    if (this.tool === 'building') {
      this.buildingWorkspace.hover(w);
      return;
    }
    if (ev) this.lastEditPointer = { x: ev.clientX, y: ev.clientY };
    if (this.cmSculptActive() || this.cmSculptStroke) {
      if (this.cmSculptStroke && ev) this.cmSculptMove(ev);
      return;
    }
    // Poly Build CLAIMS the whole gesture whenever it is active, even when the
    // press missed a face/edge (no cmPolyBuildDrag), so a stray drag can never
    // leak through to the active sculpt/paint tool and edit the terrain.
    if (this.cmPolyBuildActive()) {
      if (this.cmPolyBuildDrag && ev) this.cmPolyBuildMove(ev);
      return;
    }
    if (this.cmPolyActive() && this.cmPolyPoints && ev) {
      this.cmPolyMove(ev);
      return;
    }
    switch (this.tool) {
      case 'raise':
      case 'lower':
      case 'smooth':
      case 'flatten':
      case 'slope':
        if (this.grabSession) {
          if (ev) this.grabStep(ev);
          this.brushRing(w);
          break;
        }
        // Live: pressing/releasing Shift mid-stroke flips the sub-mode from
        // the next stamp on (matching how sculpt modifiers feel elsewhere).
        if (ev) this.strokeInvert = ev.shiftKey;
        this.strokeStep(w);
        this.brushRing(w);
        break;
      case 'tunnel':
        // The Dig/Fill/Smooth brushes drag, and so does the Cut/Carve ghost
        // while the button is down; every other mode is click-only with the
        // ring previewing the node/solid size while aiming.
        if (this.carveStroke && ev) this.carveStrokeStep(w, ev);
        else if (this.smoothStroke) this.smoothStrokeStamp(w);
        else if (this.cutGhostDrag) this.cutGhostMove(w);
        this.brushRing(w);
        break;
      case 'paint':
        this.paintStep(w);
        this.brushRing(w);
        break;
      case 'erase':
        this.eraseAt(w);
        this.brushRing(w);
        break;
      case 'foliage':
        this.foliageStep(w);
        this.brushRing(w);
        break;
      case 'clutter':
        this.clutterStep(w);
        this.brushRing(w);
        break;
      case 'meshfix':
        if (this.meshFixVertexMode) this.vertexStep(ev);
        else {
          this.meshFixStep(ev);
          this.brushRing(w);
        }
        break;
      case 'grassclear':
        this.grassClearStep(w);
        this.brushRing(w);
        break;
      case 'blocker':
        if (this.blockerStart) {
          const s = this.blockerStart;
          // Same clamp the sanitizer applies: too short previews nothing, and
          // a drag past 200yd truncates live, so the preview IS the stored wall.
          this.blockerPreview = clampBlockerSegment(s.x, s.z, w.x, w.z);
          this.viewport3d?.setBlockerPreview(this.blockerPreview);
          this.canvasDirty = true;
        }
        break;
      case 'entity': {
        // Patrol authoring owns the pointer: a drag across the map places
        // waypoints, it never drags the mobs the route is being drawn for.
        if (this.mobRouteDraft) break;
        if (this.mobDragStart) {
          const drag = this.mobDragStart;
          const dx = w.x - drag.pointer.x;
          const dz = w.z - drag.pointer.z;
          this.viewport3d?.moveRuntimeMobs(this.selectedMobIds, dx - drag.dx, dz - drag.dz);
          drag.dx = dx;
          drag.dz = dz;
          for (const { camp, point } of drag.camps.values()) {
            camp.center.x = point.x + dx;
            camp.center.z = point.z + dz;
          }
          this.entities = buildEntities(this.content);
          this.canvasDirty = true;
          break;
        }
        if (this.npcDragBase && this.markerDragStart) {
          const activeStart = this.markerDragStart;
          const activeTo = { x: w.x - this.grab.x, z: w.z - this.grab.z };
          const dx = activeTo.x - activeStart.x;
          const dz = activeTo.z - activeStart.z;
          for (const [key, entry] of this.npcDragBase) {
            const from = { ...entry.npc.pos };
            const to = { x: entry.point.x + dx, z: entry.point.z + dz };
            entry.npc.pos.x = to.x;
            entry.npc.pos.z = to.z;
            const entity = this.entities.find((candidate) => candidate.key === key);
            if (entity) {
              entity.point.x = to.x;
              entity.point.z = to.z;
            }
            this.viewport3d?.moveMapEntity(key, from, to);
          }
          this.canvasDirty = true;
          break;
        }
        if (!this.selectedKey) break;
        const entity = this.entities.find((candidate) => candidate.key === this.selectedKey);
        if (!entity || !isMovableEntity(entity)) break;
        const from = { x: entity.point.x, z: entity.point.z };
        const to = { x: w.x - this.grab.x, z: w.z - this.grab.z };
        entity.point.x = to.x;
        entity.point.z = to.z;
        this.viewport3d?.moveMapEntity(entity.key, from, to);
        this.canvasDirty = true;
        break;
      }
      case 'spawn':
        if (this.spawnAreaStart && !this.markerPlaceMode) {
          this.spawnAreaPreview = {
            minX: Math.min(this.spawnAreaStart.x, w.x),
            minZ: Math.min(this.spawnAreaStart.z, w.z),
            maxX: Math.max(this.spawnAreaStart.x, w.x),
            maxZ: Math.max(this.spawnAreaStart.z, w.z),
          };
          this.viewport3d?.setZonePreview(this.spawnAreaPreview);
          this.canvasDirty = true;
        }
        break;
      case 'zone':
      case 'music':
        if (this.zoneStart) {
          this.zoneBox = {
            minX: Math.min(this.zoneStart.x, w.x),
            minZ: Math.min(this.zoneStart.z, w.z),
            maxX: Math.max(this.zoneStart.x, w.x),
            maxZ: Math.max(this.zoneStart.z, w.z),
          };
          this.viewport3d?.setZonePreview(this.zoneBox);
          this.canvasDirty = true;
        }
        break;
      case 'city':
        if (this.citySubtool === 'road' && this.cityRoadMode === 'edit') this.roadEdit.dragTo(w);
        break;
      case 'region':
        if (this.regionStart) {
          this.regionBox = {
            minX: Math.min(this.regionStart.x, w.x),
            minZ: Math.min(this.regionStart.z, w.z),
            maxX: Math.max(this.regionStart.x, w.x),
            maxZ: Math.max(this.regionStart.z, w.z),
          };
          this.canvasDirty = true;
        }
        break;
      default:
        break;
    }
  }

  private editEnd(ev?: PointerEvent): void {
    this.pointerEditActive = false;
    if (this.tool === 'building') {
      if (ev?.type === 'pointercancel') this.buildingWorkspace.cancel();
      else
        this.buildingWorkspace.end(
          ev ? (this.viewport3d?.surfaceAt(ev.clientX, ev.clientY) ?? undefined) : undefined,
        );
      return;
    }
    if (this.cmSculptActive() || this.cmSculptStroke) {
      this.cmSculptEnd();
      return;
    }
    // Poly Build claims the gesture end too (see editMove): commit an in-flight
    // extrude, or just consume a missed press so it never falls through to a
    // sculpt/paint strokeCommit.
    if (this.cmPolyBuildActive() || this.cmPolyBuildDrag) {
      if (this.cmPolyBuildDrag) this.cmPolyBuildEnd();
      return;
    }
    if (this.cmPolyPoints) {
      this.cmPolyEnd();
      return;
    }
    switch (this.tool) {
      case 'raise':
      case 'lower':
      case 'smooth':
      case 'flatten':
      case 'slope':
        if (this.grabSession) {
          this.grabCommit();
          this.inspector.refresh();
          break;
        }
        this.strokeCommit();
        // The stroke mutated terrainEdits in place on the ACTIVE content.
        this.terrainEditsMutated();
        this.inspector.refresh(); // the brush panel's edit-count readout
        break;
      case 'erase':
        this.inspector.refresh();
        break;
      case 'tunnel':
        this.carveStrokeEnd();
        this.smoothStrokeEnd();
        this.cutGhostDrag = false;
        break;
      case 'foliage':
        this.foliageCommit();
        break;
      case 'clutter':
        this.clutterCommit();
        break;
      case 'meshfix':
        if (this.meshFixVertexMode) this.vertexCommit();
        else this.meshFixCommit();
        break;
      case 'grassclear':
        this.grassClearCommit();
        break;
      case 'blocker':
        this.commitBlocker();
        break;
      case 'zone':
        void this.finishZoneBox();
        break;
      case 'music':
        this.finishMusicBox();
        break;
      case 'paint':
        this.paintCommit();
        break;
      case 'entity': {
        const mobDrag = this.mobDragStart;
        this.mobDragStart = null;
        if (mobDrag && (mobDrag.dx !== 0 || mobDrag.dz !== 0)) {
          const moves = new Map(
            [...mobDrag.camps].map(([id, entry]) => [
              id,
              {
                camp: entry.camp,
                prev: entry.point,
                next: { x: entry.camp.center.x, z: entry.camp.center.z },
              },
            ]),
          );
          const apply = (side: 'prev' | 'next'): void => {
            for (const [id, move] of moves) {
              const target = move[side];
              const dx = target.x - move.camp.center.x;
              const dz = target.z - move.camp.center.z;
              this.viewport3d?.moveRuntimeMobs(new Set([id]), dx, dz);
              move.camp.center.x = target.x;
              move.camp.center.z = target.z;
            }
            this.entities = buildEntities(this.content);
            this.canvasDirty = true;
          };
          this.pushUndo({
            label: 'move-mobs',
            undo: () => apply('prev'),
            redo: () => apply('next'),
          });
          this.map.meta.updatedAt = now();
          this.markDirty();
          this.inspector.refresh();
          break;
        }
        const npcDrag = this.npcDragBase;
        this.npcDragBase = null;
        if (npcDrag) {
          const previous = new Map([...npcDrag].map(([key, entry]) => [key, entry.point]));
          const next = new Map([...npcDrag].map(([key, entry]) => [key, { ...entry.npc.pos }]));
          const changed = [...previous].some(([key, point]) => {
            const target = next.get(key);
            return target && (target.x !== point.x || target.z !== point.z);
          });
          this.markerDragStart = null;
          if (changed) {
            const apply = (points: ReadonlyMap<string, Vec2>): void => {
              for (const [key, point] of points) {
                const npc = this.map.content.npcs[key.slice('npc:'.length)];
                if (!npc) continue;
                const from = { ...npc.pos };
                npc.pos.x = point.x;
                npc.pos.z = point.z;
                const entity = this.entities.find((candidate) => candidate.key === key);
                if (entity) Object.assign(entity.point, point);
                this.viewport3d?.moveMapEntity(key, from, point);
              }
              this.canvasDirty = true;
            };
            this.pushUndo({
              label: 'move-npcs',
              undo: () => apply(previous),
              redo: () => apply(next),
            });
            this.map.meta.updatedAt = now();
            this.markDirty();
          }
          this.inspector.refresh();
          break;
        }
        const start = this.markerDragStart;
        const entity = start
          ? this.entities.find((candidate) => candidate.key === start.key)
          : null;
        this.markerDragStart = null;
        if (start && entity && (entity.point.x !== start.x || entity.point.z !== start.z)) {
          this.pushMarkerUndo(
            start.key,
            { x: start.x, z: start.z },
            { x: entity.point.x, z: entity.point.z },
          );
          this.map.meta.updatedAt = now();
          this.markDirty();
        }
        this.inspector.refresh();
        break;
      }
      case 'spawn':
        if (!this.markerPlaceMode) this.finishSpawnArea();
        break;
      case 'city':
        this.roadEdit.endDrag();
        break;
      case 'region': {
        // A click (no real drag) with a clipboard pastes at the click point.
        const b = this.regionBox;
        if (
          b &&
          this.clipboard &&
          Math.abs(b.maxX - b.minX) < 1.5 &&
          Math.abs(b.maxZ - b.minZ) < 1.5
        ) {
          this.pasteAt({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
          this.regionBox = null;
        }
        this.regionStart = null;
        this.canvasDirty = true;
        break;
      }
      default:
        break;
    }
  }

  private hover3d(w: Vec2 | null): void {
    this.hover3dWorld = w ? { x: w.x, z: w.z } : null;
    if (this.tool === 'building') {
      if (w) this.buildingWorkspace.hover(w);
      return;
    }
    if (!w) {
      this.viewport3d?.clearBrush();
      if (this.tool === 'city') this.viewport3d?.setCityGridOverlay(null, 0);
      return;
    }
    // Vertices mode shows its dots on HOVER, you have to see a vertex before
    // you can decide to click it, and the window travels with the cursor
    // rather than redrawing the whole map's lattice. Re-centre only once the
    // cursor has left the middle of the current window, so a slow drag across
    // the mesh is not one rebuild per pixel.
    if (this.tool === 'meshfix' && this.meshFixVertexMode) {
      this.viewport3d?.clearBrush();
      const at = this.vertexWindowAt;
      if (!at || Math.hypot(at.x - w.x, at.z - w.z) > EditorApp.VERTEX_WINDOW * 0.35) {
        this.refreshVertexDots(w.x, w.z);
      }
      return;
    }
    this.brushRing(w);
  }

  private brushRing(w: Vec2): void {
    if (!this.viewport3d) return;
    let radius = this.brushRadius;
    let color = BRUSH_COLOR[this.tool];
    if (this.tool === 'paint') {
      // The erase option's swatch is 'transparent'; fall back to the accent.
      const custom = this.map.biomePaint?.custom?.find((s) => s.id === this.paintBiome);
      const swatch = BIOME_OPTIONS.find((b) => b.id === this.paintBiome)?.swatch ?? '';
      color = custom
        ? custom.color
        : /^#[0-9a-f]{6}$/i.test(swatch)
          ? Number.parseInt(swatch.slice(1), 16)
          : 0xffd100;
    } else if (this.tool === 'place') {
      radius = Math.max(0.8, this.placeScale * 0.9);
    } else if (this.tool === 'pond') {
      radius = this.pondRadius * POND_BANK_RADIUS_FACTOR;
      color = 0x4aa6d8;
    } else if (this.tool === 'collider') {
      radius = 2;
    } else if (this.tool === 'camp') {
      radius = this.selectedCampDef()?.radius ?? 10;
    } else if (this.tool === 'spawn') {
      radius = 1.6;
    } else if (this.tool === 'city') {
      // City Build paints its own previews (kit ghost / polyline rubber band).
      this.viewport3d.clearBrush();
      this.cityHover(w);
      return;
    } else if (this.tool === 'entity' && this.mobRouteDraft) {
      // Patrol authoring: rubber-band the path's tail to the cursor.
      this.viewport3d.clearBrush();
      this.syncMobRoutePreview(w);
      return;
    } else if (
      isSelectionTool(this.tool) ||
      this.tool === 'water' ||
      this.tool === 'region' ||
      this.tool === 'blocker' // the wall preview box is the cursor
    ) {
      this.viewport3d.clearBrush();
      return;
    }
    this.viewport3d.setBrush(w.x, w.z, radius, color, this.brushShapeForTool());
  }

  /** The active tool's brush footprint (Paint and the sculpt family only). */
  private brushShapeForTool(): BrushShape {
    if (this.tool === 'paint') return this.paintBrushShape;
    return isSculptTool(this.tool) ? this.sculptBrushShape : 'circle';
  }

  private tap3d(clientX: number, clientY: number, w: Vec2 | null, additive: boolean): void {
    if (!isSelectionTool(this.tool) || !this.viewport3d) return;
    // A mesh-edit session (Collision Master or Build): every Select-mode tap
    // picks mesh volumes (object mode) or vertices/edges/faces (sub modes) ,
    // Blender's click-select.
    if (this.meshEditActive()) {
      this.cmTap(clientX, clientY, additive);
      return;
    }
    // Hitbox edit mode captures every Select-mode tap: clicks pick individual
    // hitboxes (Shift/Ctrl+click toggles them in the multi-selection); empty
    // clicks clear the box selection but stay in edit mode.
    if (this.hitboxEdit) {
      const bi = this.viewport3d.pickHitbox(clientX, clientY);
      const sel = this.hitboxEdit.selected;
      if (bi !== null) {
        if (additive) {
          if (sel.has(bi)) sel.delete(bi);
          else sel.add(bi);
        } else {
          sel.clear();
          sel.add(bi);
        }
      } else if (!additive) {
        sel.clear();
      }
      this.syncHitboxEditView();
      this.inspector.refresh();
      return;
    }
    // Bulb badges pick first: a light's sprite is tiny next to placement
    // anchors, so the placement slack radius would otherwise swallow the tap.
    const light = additive ? null : this.viewport3d.pickMapLight(clientX, clientY);
    if (light !== null) {
      this.setSelectedLight(light);
      return;
    }
    // NPCs select like placements: a pixel-precise body hit wins outright
    // (beating a nearby placement's slack radius); the loose projected pass
    // only runs after placements miss.
    const objectDirect = additive ? null : this.viewport3d.objects.pick(clientX, clientY, true);
    if (objectDirect !== null && this.selectObject(objectDirect)) return;
    const npcDirect = this.viewport3d.pickRuntimeNpc(clientX, clientY, true);
    if (npcDirect !== null && this.selectNpcFromTap(npcDirect, additive)) return;
    const mobDirect = this.viewport3d.pickRuntimeMob(clientX, clientY, true);
    if (mobDirect !== null && this.selectMobFromTap(mobDirect.id, additive)) return;
    // Plain tap cycles through overlapping objects on repeated clicks; Shift+click
    // (additive) keeps the plain nearest pick so toggling stays predictable.
    const idx = additive
      ? this.viewport3d.pickPlacement(clientX, clientY)
      : this.viewport3d.pickPlacementCycling(clientX, clientY);
    if (additive) {
      // Blender Shift+click: toggle in the multi-selection; an empty additive
      // click keeps the selection.
      if (idx !== null) this.togglePlacementInSelection(idx);
      else {
        const npcLoose = this.viewport3d.pickRuntimeNpc(clientX, clientY);
        if (npcLoose !== null) this.selectNpcFromTap(npcLoose, true);
        else {
          const mobLoose = this.viewport3d.pickRuntimeMob(clientX, clientY);
          if (mobLoose !== null) this.selectMobFromTap(mobLoose.id, true);
        }
      }
      return;
    }
    if (this.selectedLight !== null) this.setSelectedLight(null);
    if (idx === null) {
      const npcLoose = this.viewport3d.pickRuntimeNpc(clientX, clientY);
      if (npcLoose !== null && this.selectNpcFromTap(npcLoose, false)) return;
      const objectLoose = this.viewport3d.objects.pick(clientX, clientY, false);
      if (objectLoose !== null && this.selectObject(objectLoose)) return;
      const mobLoose = this.viewport3d.pickRuntimeMob(clientX, clientY);
      if (mobLoose !== null && this.selectMobFromTap(mobLoose.id, false)) return;
    }
    if (this.selectedNpcKeys.size > 0) this.clearNpcSelection();
    this.objectMoves.select(null);
    if (this.selectedMobIds.size > 0) {
      this.clearMobSelection();
      this.syncSelectedMobRouteOverlay();
    }
    if (this.selectedKey?.startsWith('npc:')) this.selectedKey = null;
    this.setSelectedPlacement(idx);
    if (idx === null && w) {
      // Nothing else under the cursor is selectable in 3D.
      this.setSelectedPlacement(null);
    }
    this.inspector.refresh();
  }

  /** Select an authored NPC from a Select-mode tap (same toggle semantics as
   *  placements: plain click selects just it, additive toggles membership).
   *  Dynamic NPCs are not surface-placed, so they refuse the pick. */
  private selectNpcFromTap(key: string, additive: boolean): boolean {
    // `dynamic` NPCs (FURY, walk-in encounter NPCs) still stand in the world
    // at npc.pos, the pick itself required a live rendered entity, so they
    // select and move like any other NPC.
    const npc = this.map.content.npcs[key.slice('npc:'.length)];
    if (!npc) return false;
    this.flushTransformCommit();
    this.setSelectedPlacement(null);
    this.objectMoves.select(null);
    if (this.selectedLight !== null) this.setSelectedLight(null);
    this.selectedNpcKeys = toggledKeySelection(this.selectedNpcKeys, key, additive);
    this.selectedKey = this.selectedNpcKeys.has(key)
      ? key
      : ([...this.selectedNpcKeys].pop() ?? null);
    this.viewport3d?.setSelectedRuntimeNpcs(this.selectedNpcKeys);
    this.inspector.refresh();
    this.canvasDirty = true;
    return true;
  }

  /** Select one movable gameplay object (a tap or a drag start): every other
   *  selection clears first, the way picking an NPC clears placements. */
  private selectObject(key: string): boolean {
    this.flushTransformCommit();
    this.setSelectedPlacement(null);
    this.clearNpcSelection();
    if (this.selectedMobIds.size > 0) {
      this.clearMobSelection();
      this.syncSelectedMobRouteOverlay();
    }
    if (this.selectedLight !== null) this.setSelectedLight(null);
    if (this.selectedSound !== null) this.setSelectedSound(null);
    this.selectedCamp = null;
    this.selectedKey = null;
    this.objectMoves.select(key);
    this.inspector.refresh();
    return this.objectMoves.selectedKey === key;
  }

  /** A 3D left-press landed on a movable gameplay object; claim it in Select mode. */
  private beginObjectDrag(key: string): boolean {
    if (!isSelectionTool(this.tool) || !this.selectObject(key)) return false;
    return this.objectMoves.beginDrag(key);
  }

  // ---- sculpt strokes --------------------------------------------------------------

  private strokeBegin(w: Vec2): void {
    this.strokeStamps = [];
    this.strokeStartIndex = this.map.terrainEdits.length;
    this.strokeCapWarned = false;
    this.strokeRegion = null;
    this.lastStamp = null;
    // Captured for EVERY sculpt tool: a Shift-inverted Smooth stroke becomes
    // Flatten mid-gesture and needs the press-point height as its target.
    // The locked level only steers the Flatten tool's own level mode, where
    // its field is on screen.
    this.flattenTarget = flattenStrokeTarget(
      this.tool === 'flatten' && !this.flattenSmooth ? this.flattenLock : null,
      terrainHeight(w.x, w.z, this.map.meta.seed),
    );
    // Slope: the press point and the ground under it are the ramp's END, read
    // before this stroke changes anything. No start yet = nothing to climb to.
    this.slopeRamp =
      this.tool === 'slope' && this.slopeStart
        ? {
            start: this.slopeStart,
            end: { x: w.x, z: w.z, y: terrainHeight(w.x, w.z, this.map.meta.seed) },
          }
        : null;
    if (this.tool === 'slope' && !this.slopeStart) this.toasts.info(t('editor.slope.needStart'));
    // One Noise pattern per stroke, keyed off the press point and the edit
    // count so two strokes never repeat each other.
    this.strokeNoiseSeed = Math.floor(
      hash2(
        Math.round(w.x * 7.3),
        Math.round(w.z * 7.3),
        this.map.meta.seed + 131 + this.map.terrainEdits.length,
      ) * 0x7fffffff,
    );
    this.strokeStep(w);
  }

  // ---- tunnel (cave) strokes -------------------------------------------------------

  /** The bore radius: the shared brush radius clamped to the cave bounds. */
  private tunnelRadius(): number {
    return Math.min(CAVE_MAX_RADIUS, Math.max(CAVE_MIN_RADIUS, this.brushRadius * 0.5));
  }

  /** EVERY cave mutation (stroke, undo/redo) funnels here: the carve changed
   *  terrainHeight, so colliders reseat and the region re-meshes. */
  private cavesMutated(region: RegionBox | null): void {
    invalidateStaticColliders();
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    if (region) {
      this.rebuildTerrainRegion(region);
      this.viewport3d?.finishTerrainStroke(region);
    }
    this.refreshCaveGuides();
    this.inspector.refresh();
  }

  // ---- Tree Generator tool -----------------------------------------------------

  private treeClick(w: Vec2): void {
    if (this.treeStudio) return; // the studio holds exactly one tree
    this.appendPlacements([this.treeRecord(w.x, w.z)], 'tree');
    this.inspector.refresh();
  }

  /** A generated-tree placement carrying the CURRENT panel settings. The trunk
   *  collider is stamped here (collideCustom, so a later asset-collision bake
   *  never overrides a trunk the maker sized deliberately) and a random yaw
   *  keeps a hand-planted grove from looking cloned. */
  private treeRecord(x: number, z: number): AssetPlacement {
    const params: TreeParams = { ...this.treeParams, seed: treeSeed(x, z) };
    const radius = treeCollideRadius(params);
    const rec: AssetPlacement = {
      assetId: TREE_ASSET_ID,
      x,
      z,
      rotY: hash2(Math.round(x * 7), Math.round(z * 7), 991) * Math.PI * 2,
      scale: 1,
      collide: radius > 0,
      tree: params,
    };
    if (radius > 0) {
      rec.collideRadius = radius;
      // 'basic' is the maker's hand-picked footprint: placementsToRenderAssets
      // stamps collideCustom from it, so a later asset-collision bake can never
      // replace a trunk collider the Tree panel sized deliberately.
      rec.collisionMode = 'basic';
    } else {
      rec.collisionMode = 'none';
    }
    return rec;
  }

  /** The Tree panel's current recipe + preset. */
  getTreeParams(): { preset: string; params: TreeParams; showVolumes: boolean } {
    return {
      preset: this.treePresetKey,
      params: { ...this.treeParams },
      showVolumes: treeVolumeOverlayEnabled(),
    };
  }

  /** Merge a change into the recipe for the NEXT plant. */
  setTreeParams(change: Partial<FoliageParams>): void {
    this.treeParams = { ...this.treeParams, ...change };
    this.treePresetKey = '';
    this.inspector.refresh();
  }

  /**
   * "Keep as an asset": grow the armed plant, export it as a GLB, and hand it
   * to the dev server, which files it under public/models/generated. From that
   * point it is an ordinary catalogue asset (batched, collision-bakeable,
   * publishable) rather than a recipe rebuilt every session, and its own
   * parameters ride along in the file so it can be re-opened and re-baked.
   */
  private async bakeFoliage(): Promise<void> {
    const suggestion = `${foliageKindOf(this.treeParams)}_${Date.now().toString(36)}`;
    const label = await promptDialog(
      this.root,
      t('editor.foliage.bake'),
      t('editor.foliage.bakePrompt'),
      suggestion,
    );
    if (!label) return;
    const slug = foliageSlug(label);
    if (!slug) {
      this.toasts.error(t('editor.foliage.bakeFailed', { reason: 'bad_slug' }));
      return;
    }
    const result = await bakeFoliageToGlb(slug, label, this.treeParams);
    if (result.ok) this.toasts.info(t('editor.foliage.baked', { id: result.assetId }));
    else
      this.toasts.error(t('editor.foliage.bakeFailed', { reason: result.detail ?? result.reason }));
  }

  applyTreePreset(key: string): void {
    const preset = treePreset(key);
    if (!preset) return;
    this.treeParams = { ...preset.params };
    this.treePresetKey = key;
    this.inspector.refresh();
  }

  /** Draw (or hide) the canopy spheres on every generated tree. The overlay is
   *  baked into the tree's group at build time, so the trees must be rebuilt. */
  setTreeVolumesShown(on: boolean): void {
    setTreeVolumeOverlay(on);
    this.rebuildTreePlacements();
    this.inspector.refresh();
  }

  /** Re-add every tree placement so the renderer regrows it. */
  private rebuildTreePlacements(): void {
    const selected = this.selectedPlacement;
    this.map.placements.forEach((p, i) => {
      if (p.assetId === TREE_ASSET_ID) this.viewport3d?.placementAdded(i);
    });
    if (selected !== null) this.viewport3d?.setSelectedPlacement(selected);
  }

  /** Apply a recipe change to the SELECTED tree and regrow it live. */
  updateSelectedTree(change: Partial<TreeParams>, commit: boolean): void {
    const index = this.selectedPlacement;
    if (index === null) return;
    const p = this.map.placements[index];
    if (!p || p.assetId !== TREE_ASSET_ID) return;
    const before = p.tree ? { ...p.tree } : undefined;
    const next: TreeParams = { ...(p.tree ?? {}), ...change };
    // Editing a sphere by hand freezes the layout: the shape preset must stop
    // regenerating over the top of the maker's own crown.
    p.tree = next;
    const radius = treeCollideRadius(next);
    p.collide = radius > 0;
    p.collideRadius = radius > 0 ? radius : undefined;
    p.collisionMode = radius > 0 ? 'basic' : 'none';
    this.viewport3d?.placementAdded(index);
    this.viewport3d?.setSelectedPlacement(index);
    this.canvasDirty = true;
    if (commit) {
      const after = { ...next };
      const restore = (params: TreeParams | undefined): void => {
        const cur = this.map.placements[index];
        if (!cur) return;
        if (params) cur.tree = { ...params };
        else delete cur.tree;
        const r = treeCollideRadius(cur.tree);
        cur.collide = r > 0;
        cur.collideRadius = r > 0 ? r : undefined;
        cur.collisionMode = r > 0 ? 'basic' : 'none';
        this.viewport3d?.placementAdded(index);
        this.viewport3d?.setSelectedPlacement(index);
        this.inspector.refresh();
      };
      this.pushUndo({
        label: 'tree-edit',
        undo: () => restore(before),
        redo: () => restore(after),
      });
    }
    this.inspector.refresh();
  }

  /** Reroll ONLY the seed of the selected tree: same recipe, new growth. */
  rerollSelectedTree(): void {
    const index = this.selectedPlacement;
    if (index === null) return;
    const p = this.map.placements[index];
    if (!p || p.assetId !== TREE_ASSET_ID) return;
    this.updateSelectedTree({ seed: Math.floor(Math.random() * 1e9) }, true);
  }

  /** Adopt the selected tree's recipe as the tool's default. */
  treeParamsFromSelection(): void {
    const index = this.selectedPlacement;
    if (index === null) return;
    const p = this.map.placements[index];
    if (!p?.tree) return;
    this.treeParams = { ...p.tree };
    delete this.treeParams.seed;
    this.treePresetKey = '';
    this.toasts.success(t('editor.tree.copyToTool'));
    this.inspector.refresh();
  }

  // ---- Tree Studio: shape a tree in an empty scene -----------------------------

  /** Non-null while the Tree Studio scratch scene is open. */
  treeStudioActive(): boolean {
    return this.treeStudio !== null;
  }

  /**
   * Swap the working map for a small flat scratch scene holding one tree built
   * from the tool's current settings, exactly as Collision Master does for an
   * asset's collision. The real map is stashed IN MEMORY (so this opens even
   * when browser storage is blocked) and restored on exit.
   */
  enterTreeStudio(): void {
    if (this.treeStudio || this.collisionMaster || this.buildSession) return;
    const returnMap = this.map;
    const returnMapId = this.map.meta.id;
    // Best-effort store save on top of the in-memory stash: it only matters if
    // the page reloads while the studio is open.
    this.io.saveLocal(this.map);
    const scene = newFlatCustomMap(t('editor.tree.studioMapName'), mintId(), now(), {
      width: 60,
      height: 60,
    });
    // A workbench, not a playfield: no perimeter walls on the horizon.
    scene.blockers = [];
    const params: TreeParams = { ...this.treeParams, seed: this.treeParams.seed ?? 12345 };
    const radius = treeCollideRadius(params);
    scene.placements.push({
      assetId: TREE_ASSET_ID,
      x: 0,
      z: 0,
      rotY: 0,
      scale: 1,
      collide: radius > 0,
      ...(radius > 0
        ? { collideRadius: radius, collisionMode: 'basic' as const }
        : { collisionMode: 'none' as const }),
      // Detached at y=0 keeps the tree independent of the preserved world's
      // terrain sampler, the same trick the Collision Master workbench uses.
      detached: true,
      groundY: 0,
      tree: params,
    });
    const camNow = this.viewport3d?.dungeonStagePort()?.cam ?? null;
    this.treeStudio = {
      returnMapId,
      returnMap,
      returnPlacements: returnMap.placements.slice(),
      returnSelection: this.selectedPlacement,
      returnTool: this.tool,
      returnCam: camNow
        ? {
            x: camNow.target.x,
            y: camNow.target.y,
            z: camNow.target.z,
            yaw: camNow.yaw,
            pitch: camNow.pitch,
            dist: camNow.dist,
          }
        : null,
      terrainPreserved: false,
    };
    this.viewport3d?.setStudioMode(true);
    // Frame the WHOLE tree with air around it: focusClose derives its distance
    // from the extent, and half a tree height puts the camera inside the crown.
    this.pendingFocus = { x: 0, z: 0, extent: Math.max(8, treeHeight(params) * 1.15), y: 0 };
    // A FULL reload, not a terrain-preserving one. Preserving keeps the engine
    // built from the map you came from, so its procedural foliage, world props,
    // NPCs and fireflies all stay in the scene - and an empty backdrop is the
    // entire point of the studio. Rebuilding costs a beat on a big map; that is
    // the right trade for a deliberate mode switch.
    this.loadMap(scene);
    if (this.treeStudio) this.treeStudio.terrainPreserved = false;
    // Select, don't paint: clicking the ground in here must not plant a second
    // tree next to the one being shaped.
    this.setTool('select');
    this.setSelectedPlacement(0);
    this.inspector.refresh();
  }

  /**
   * Leave the studio. `keep` carries the shaped tree back out as the Tree
   * tool's new default (minus the seed, so the next placement still varies);
   * discarding leaves the tool exactly as it was.
   */
  exitTreeStudio(keep: boolean): void {
    const ts = this.treeStudio;
    if (!ts) return;
    const sceneId = this.map.meta.id;
    if (keep) {
      const shaped = this.map.placements[0]?.tree;
      if (shaped) {
        this.treeParams = { ...shaped };
        delete this.treeParams.seed;
        this.treePresetKey = '';
      }
    }
    this.treeStudio = null;
    this.viewport3d?.setStudioMode(false);
    this.pendingFocus = null;
    // The scratch scene must never resurface as a resumable draft.
    this.io.draftClear(sceneId);
    this.pendingCamera = ts.returnCam;
    const back = ts.returnMap ?? this.io.store.load(ts.returnMapId);
    if (back) {
      this.loadMap(back, { preserveViewportTerrain: ts.terrainPreserved });
      // loadMap reconciles a document's world props against the ACTIVE built-in
      // world, and on the way back that active world is still the studio's flat
      // scratch scene - so every major world prop in the maker's map reads as
      // orphaned and is pruned (75 of them on the Goldcrest map). The list we
      // stashed on the way in is the truth, so put it back. Length-guarded so
      // this only ever repairs a loss, never resurrects something the maker
      // deleted through some other path.
      if (back.placements.length < ts.returnPlacements.length) {
        back.placements.length = 0;
        back.placements.push(...ts.returnPlacements);
        this.viewport3d?.rebuildPlacements();
      }
      const restored =
        ts.returnSelection !== null && back.placements[ts.returnSelection]
          ? ts.returnSelection
          : null;
      this.setSelectedPlacement(restored);
    } else {
      this.loadMap(newCustomMap(t('editor.untitledMap'), mintId(), now()));
    }
    this.setTool(ts.returnTool);
    if (keep) this.toasts.success(t('editor.tree.studioKept'));
    this.inspector.refresh();
  }

  // ---- Rock Generator tool -----------------------------------------------------

  private rockClick(w: Vec2): void {
    if (this.rockChainMode) {
      const pending = this.pendingRockRig();
      if (pending && pending.points.length >= MAX_ROCK_NODES) {
        this.toasts.error(t('editor.status.caveCapReached', { max: MAX_ROCK_NODES }));
        return;
      }
      this.appendPlacements(
        [
          {
            assetId: ROCK_POINT_ASSET_ID,
            name: pending?.id ?? mintId(),
            x: w.x,
            z: w.z,
            rotY: 0,
            scale: 1,
            collide: false,
          },
        ],
        'rock-point',
      );
      this.refreshRockGuides();
      this.inspector.refresh();
      return;
    }
    this.appendPlacements([this.rockRecord(w.x, w.z, this.rockParams.size)], 'rock');
    this.inspector.refresh();
  }

  /** A generated-rock placement carrying the CURRENT panel sliders. */
  private rockRecord(x: number, z: number, scale: number): AssetPlacement {
    const rec: AssetPlacement = {
      assetId: ROCK_ASSET_ID,
      x,
      z,
      rotY: 0,
      scale,
      collide: false,
      rockSeed: rockSeed(x, z),
      rockNoise: this.rockParams.noise,
      rockDetail: this.rockParams.detail,
      rockSharp: this.rockParams.sharp,
      rockTex: this.rockParams.tex,
    };
    if (this.rockParams.height !== 1) rec.rockHeight = this.rockParams.height;
    if (this.rockParams.depth > 0) rec.rockDepth = this.rockParams.depth;
    if (this.rockParams.jag > 0) rec.rockJag = this.rockParams.jag;
    if (this.rockParams.texId) {
      rec.rockTexId = this.rockParams.texId;
      if (this.rockParams.texTile !== DEFAULT_TEXTURE_TILE_YD) {
        rec.rockTexTile = this.rockParams.texTile;
      }
    }
    return rec;
  }

  /** Every rock chain rig on the map (rock/point placements grouped by the
   *  chain id in placement.name, in document order). */
  private rockRigs(): { id: string; points: AssetPlacement[] }[] {
    const byId = new Map<string, { id: string; points: AssetPlacement[] }>();
    for (const p of this.map.placements) {
      if (p.assetId !== ROCK_POINT_ASSET_ID) continue;
      const id = p.name ?? '';
      if (!id) continue;
      let rig = byId.get(id);
      if (!rig) {
        rig = { id, points: [] };
        byId.set(id, rig);
      }
      rig.points.push(p);
    }
    return [...byId.values()];
  }

  /** The rig still being laid out: the first one with no generated ridge. */
  private pendingRockRig(): { id: string; points: AssetPlacement[] } | null {
    return (
      this.rockRigs().find(
        (r) =>
          !this.map.placements.some((p) => p.assetId === ROCK_RIDGE_ASSET_ID && p.name === r.id),
      ) ?? null
    );
  }

  /** Blue node markers + dotted connectors for every rock rig (all tools). */
  private refreshRockGuides(): void {
    const rigs = this.rockRigs().map((r) => ({
      points: r.points.map((p) => ({ x: p.x, z: p.z, dy: p.y ?? 0 })),
    }));
    this.viewport3d?.setRockChainGuide(rigs.length ? rigs : null);
  }

  /**
   * Ridge mode Generate: ONE merged solid body lofted along the rig's points
   * (buildRockChainModel), replacing the old overlapping-boulder pile. The
   * body's top follows a straight DECK line from the first point's ground to
   * the last point's (spanning dips like a bridge); per-node girth/height come
   * from each point placement's gizmo scale. The rig points stay after
   * Generate: moving or scaling one live-regenerates the ridge.
   */
  private generateRockChain(): void {
    let generated = 0;
    for (const rig of this.rockRigs()) {
      if (rig.points.length < 2) continue;
      if (this.generateRockRidgeForRig(rig, true)) generated++;
    }
    if (generated === 0) this.toasts.error(t('editor.rock.chainTooShort'));
    this.refreshRockGuides();
    this.inspector.refresh();
  }

  /** Build the merged-ridge nodes for a rig (deck line + per-point scale). */
  private rockRidgeNodes(rig: {
    id: string;
    points: AssetPlacement[];
  }): { dx: number; dz: number; dy: number; r: number; h: number }[] | null {
    const pts = rig.points;
    if (pts.length < 2) return null;
    const seed = this.map.meta.seed;
    const lens: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      lens.push(L);
      total += L;
    }
    if (total < 1) return null;
    const anchor = pts[0];
    const anchorGround = terrainHeight(anchor.x, anchor.z, seed);
    const h0 = anchorGround;
    const h1 = terrainHeight(pts[pts.length - 1].x, pts[pts.length - 1].z, seed);
    const size = this.rockParams.size;
    const nodes: {
      dx: number;
      dz: number;
      dy: number;
      r: number;
      h: number;
    }[] = [];
    let arc = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) arc += lens[i - 1];
      const p = pts[i];
      const t01 = arc / total;
      const deckY = h0 + (h1 - h0) * t01;
      const ground = terrainHeight(p.x, p.z, seed);
      // Girth from the point's gizmo scale (uniform * per-axis XZ), height
      // multiplier from its Y scale, both on top of the panel size slider.
      const sxz = p.scale * (((p.scaleX ?? 1) + (p.scaleZ ?? 1)) / 2);
      const sy = p.scale * (p.scaleY ?? 1);
      const r = Math.max(0.5, size * 0.55 * sxz);
      const h = Math.max(0.3, Math.min(3, this.rockParams.height * sy));
      // Ride the deck line where the ground drops away (bridge span); stay
      // ground-seated where the terrain runs higher. The node's Y gizmo adds
      // an authored lift/sink on top (floating arches, buried spans).
      const seatY = Math.max(ground, deckY - r * h * 0.4) + (p.y ?? 0);
      nodes.push({
        dx: p.x - anchor.x,
        dz: p.z - anchor.z,
        dy: seatY - anchorGround,
        r,
        h,
      });
    }
    return nodes;
  }

  /** Create or live-update the merged ridge placement for a rig. */
  private generateRockRidgeForRig(
    rig: { id: string; points: AssetPlacement[] },
    withUndo: boolean,
  ): boolean {
    const nodes = this.rockRidgeNodes(rig);
    if (!nodes) return false;
    const anchor = rig.points[0];
    const existingIndex = this.map.placements.findIndex(
      (p) => p.assetId === ROCK_RIDGE_ASSET_ID && p.name === rig.id,
    );
    if (existingIndex >= 0) {
      // Live regeneration: rebuild the body in place (no undo per drag sample).
      const existing = this.map.placements[existingIndex];
      existing.x = anchor.x;
      existing.z = anchor.z;
      existing.rockNodes = nodes;
      this.map.meta.updatedAt = now();
      this.canvasDirty = true;
      this.viewport3d?.placementAdded(existingIndex);
      return true;
    }
    const seed = this.map.meta.seed;
    const ridge: AssetPlacement = {
      assetId: ROCK_RIDGE_ASSET_ID,
      name: rig.id,
      x: anchor.x,
      z: anchor.z,
      rotY: 0,
      scale: 1,
      collide: false,
      rockSeed: rockSeed(anchor.x, anchor.z),
      rockNoise: this.rockParams.noise,
      rockDetail: this.rockParams.detail,
      rockSharp: this.rockParams.sharp,
      rockTex: this.rockParams.tex,
      rockNodes: nodes,
    };
    if (this.rockParams.jag > 0) ridge.rockJag = this.rockParams.jag;
    if (this.rockParams.texId) {
      ridge.rockTexId = this.rockParams.texId;
      if (this.rockParams.texTile !== DEFAULT_TEXTURE_TILE_YD) {
        ridge.rockTexTile = this.rockParams.texTile;
      }
    }
    const placements: AssetPlacement[] = [ridge];
    // Optional walkable deck: one plane collider per rig segment, following
    // the ridge tops so the span can actually be crossed.
    if (this.rockParams.walkable) {
      const anchorGround = terrainHeight(anchor.x, anchor.z, seed);
      for (let i = 1; i < rig.points.length; i++) {
        const a = rig.points[i - 1];
        const b = rig.points[i];
        const na = nodes[i - 1];
        const nb = nodes[i];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 1) continue;
        const midX = (a.x + b.x) / 2;
        const midZ = (a.z + b.z) / 2;
        const topA = anchorGround + na.dy + na.r * na.h * 1.35;
        const topB = anchorGround + nb.dy + nb.r * nb.h * 1.35;
        placements.push({
          assetId: COLLIDER_ASSET_IDS.plane,
          x: midX,
          z: midZ,
          rotY: Math.atan2(b.x - a.x, b.z - a.z),
          scale: 1,
          collide: true,
          sizeX: Math.max(2, (na.r + nb.r) * 0.9),
          sizeZ: L + Math.min(na.r, nb.r),
          sizeY: (topA + topB) / 2 - terrainHeight(midX, midZ, seed) - 0.4,
          rotX: -Math.atan2(topB - topA, L),
        });
      }
    }
    if (withUndo) this.appendPlacements(placements, 'rock-ridge');
    return true;
  }

  /** Live ridge regeneration while a rig point is dragged/scaled. */
  private regenerateRockRidgeForPoint(p: AssetPlacement): void {
    const id = p.name ?? '';
    if (!id) return;
    const rig = this.rockRigs().find((r) => r.id === id);
    if (rig) this.generateRockRidgeForRig(rig, false);
  }

  /** Clear the pending rig's blue points (one undoable step). */
  private clearRockChain(): void {
    const pending = this.pendingRockRig();
    if (!pending) return;
    const removed: { index: number; placement: AssetPlacement }[] = [];
    for (let i = this.map.placements.length - 1; i >= 0; i--) {
      const p = this.map.placements[i];
      if (p.assetId === ROCK_POINT_ASSET_ID && p.name === pending.id) {
        removed.push({ index: i, placement: p });
        this.map.placements.splice(i, 1);
      }
    }
    if (removed.length === 0) return;
    this.setSelectedPlacement(null);
    this.viewport3d?.rebuildPlacements();
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    this.refreshRockGuides();
    this.pushUndo({
      label: 'rock-clear-points',
      undo: () => {
        // Reverse order restores ascending indices correctly.
        for (let i = removed.length - 1; i >= 0; i--) {
          this.map.placements.splice(removed[i].index, 0, removed[i].placement);
        }
        this.viewport3d?.rebuildPlacements();
        this.refreshRockGuides();
        this.canvasDirty = true;
      },
      redo: () => {
        for (const r of removed) {
          const at = this.map.placements.indexOf(r.placement);
          if (at >= 0) this.map.placements.splice(at, 1);
        }
        this.viewport3d?.rebuildPlacements();
        this.refreshRockGuides();
        this.canvasDirty = true;
      },
    });
  }

  private tunnelBegin(w: Vec2, ev?: PointerEvent): void {
    if (this.tunnelMode === 'hole' || this.tunnelMode === 'carve') {
      this.cutGhostBeginOrMove(w, this.tunnelMode === 'carve');
      return;
    }
    if (this.tunnelMode === 'smooth') {
      this.smoothStrokeBegin(w);
      return;
    }
    if (this.tunnelMode === 'patch') {
      this.placeHolePatch(w);
      return;
    }
    if (this.tunnelMode === 'remesh') {
      this.placeDetailRegion(w);
      return;
    }
    if (this.tunnelMode === 'fill') {
      // FORK: Fill is an ERASE BOX now: place, size, confirm.
      this.cutGhostBeginOrMove(w, false, true);
      return;
    }
    if (this.tunnelMode === 'sculpt') {
      this.carveStrokeBegin(this.tunnelMode, w, ev);
      return;
    }
    this.placeCaveEndpoint(w);
  }

  /** A rig point's ABSOLUTE floor height. Cave markers are ANCHORED (frozen
   *  ground captured at drop): re-sculpting the terrain under them never
   *  reshapes the cave, and a group Y-lift moves the whole cave rigidly. */
  private rigPointY(p: AssetPlacement): number {
    const anchor = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.map.meta.seed);
    return anchor + (p.y ?? 0);
  }

  /** The rig flow: the first click drops the ENTRANCE marker; every further
   *  click (until the rig generates) appends a BLUE waypoint. The rig's last
   *  point acts as the exit. All are ordinary placements (gizmo-movable);
   *  Generate (or moving any point of a generated cave) builds the tube. */
  private placeCaveEndpoint(w: Vec2): void {
    const caves = this.map.caves ?? [];
    if (caves.length >= MAX_CAVES) {
      this.toasts.error(t('editor.status.caveCapReached', { max: MAX_CAVES }));
      return;
    }
    // A rig with no generated cave yet is the pending one being laid out.
    const pending = this.caveRigs().find((r) => !caves.some((c) => c.id === r.id));
    if (pending && pending.points.length >= MAX_CAVE_RIG_POINTS) {
      this.toasts.error(t('editor.status.caveCapReached', { max: MAX_CAVE_RIG_POINTS }));
      return;
    }
    // Anchored at the CURRENT surface height: the node keeps this elevation
    // (gizmo Y adjusts it) no matter what happens to the terrain later.
    const placement: AssetPlacement = {
      assetId: pending ? CAVE_POINT_ASSET_ID : CAVE_ENTRANCE_ASSET_ID,
      name: pending ? pending.id : mintId(),
      x: w.x,
      z: w.z,
      rotY: 0,
      scale: 1,
      collide: false,
      detached: true,
      groundY: terrainHeight(w.x, w.z, this.map.meta.seed),
    };
    this.appendPlacements([placement], 'cave-point');
    this.inspector.refresh();
    this.refreshCaveGuides();
  }

  /** Every cave rig on the map, keyed by the shared cave id carried in
   *  placement.name: the ORDERED control points (entrance first, waypoints in
   *  document order, a legacy exit marker last). */
  private caveRigs(): { id: string; points: AssetPlacement[] }[] {
    const byId = new Map<
      string,
      {
        id: string;
        entrance: AssetPlacement[];
        mid: AssetPlacement[];
        exit: AssetPlacement[];
      }
    >();
    for (const p of this.map.placements) {
      if (
        p.assetId !== CAVE_ENTRANCE_ASSET_ID &&
        p.assetId !== CAVE_EXIT_ASSET_ID &&
        p.assetId !== CAVE_POINT_ASSET_ID
      ) {
        continue;
      }
      const id = p.name ?? '';
      if (!id) continue;
      let rig = byId.get(id);
      if (!rig) {
        rig = { id, entrance: [], mid: [], exit: [] };
        byId.set(id, rig);
      }
      if (p.assetId === CAVE_ENTRANCE_ASSET_ID) rig.entrance.push(p);
      else if (p.assetId === CAVE_EXIT_ASSET_ID) rig.exit.push(p);
      else rig.mid.push(p);
    }
    return [...byId.values()].map((r) => ({
      id: r.id,
      points: [...r.entrance, ...r.mid, ...r.exit],
    }));
  }

  /** Generated tubes' flow lines plus every rig's blue control points and
   *  dotted connector. Always visible (every tool): the rig points are real
   *  placements the Move/Scale gizmos edit, so hiding them outside the Caves
   *  tool made in-progress rigs read as lost. */
  private refreshCaveGuides(): void {
    this.viewport3d?.setCaveGuides(
      this.map.caves ?? [],
      this.caveRigs().map((r) => ({
        points: r.points.map((p) => ({ x: p.x, y: this.rigPointY(p), z: p.z })),
      })),
    );
  }

  /** Generate (or re-generate) the cave for a rig. Keeps the existing cave's
   *  width/height/variance/spike sliders across regenerations. TERRAIN-BLIND:
   *  the tube runs exactly through the rig points at exactly their authored
   *  girth, so nothing about the surrounding ground can squish or reshape it. */
  private generateCaveForRig(
    rig: { id: string; points: AssetPlacement[] },
    withUndo: boolean,
  ): void {
    if (rig.points.length < 2) return;
    const seed = this.map.meta.seed;
    const caves = this.cavesRef();
    const existing = caves.find((c) => c.id === rig.id);
    // The bore radius is AUTHORED at first generate and stored on the cave:
    // regenerating (a node move) must never pick up the live brush slider, or
    // the cave silently changes girth mid-edit.
    const radius = existing?.radius ?? this.tunnelRadius();
    const nodes = generateCaveRigNodes(
      // Each rig point's gizmo scale sets the bore girth THERE (uniform scale
      // times the XZ per-axis average); its anchored elevation + Y offset IS
      // the cave floor there (rigPointY), interpolated along the path.
      rig.points.map((p) => ({
        x: p.x,
        y: this.rigPointY(p),
        z: p.z,
        r: p.scale * (((p.scaleX ?? 1) + (p.scaleZ ?? 1)) / 2),
      })),
      radius,
      {
        variance: existing?.variance ?? DEFAULT_CAVE_VARIANCE,
        seed: seed + caveWobbleSeed(rig.id),
      },
    );
    if (nodes.length < 2) {
      this.toasts.error(t('editor.tunnel.tooShort'));
      return;
    }
    const prevNodes = existing ? existing.nodes : null;
    const oldRegion = existing ? this.caveRegion(existing) : null;
    let cave: CaveDef;
    if (existing) {
      existing.nodes = nodes;
      if (existing.radius === undefined) existing.radius = radius;
      cave = existing;
    } else {
      cave = { id: rig.id, nodes, radius, variance: DEFAULT_CAVE_VARIANCE };
      caves.push(cave);
    }
    const region = this.caveRegion(cave);
    const union: RegionBox = oldRegion
      ? {
          minX: Math.min(oldRegion.minX, region.minX),
          minZ: Math.min(oldRegion.minZ, region.minZ),
          maxX: Math.max(oldRegion.maxX, region.maxX),
          maxZ: Math.max(oldRegion.maxZ, region.maxZ),
        }
      : region;
    this.cavesMutated(union);
    if (!withUndo) return;
    this.pushUndo({
      label: 'cave-generate',
      undo: () => {
        if (prevNodes) cave.nodes = prevNodes;
        else {
          const i = caves.indexOf(cave);
          if (i >= 0) caves.splice(i, 1);
        }
        this.cavesMutated(union);
      },
      redo: () => {
        if (prevNodes) cave.nodes = nodes;
        else caves.push(cave);
        this.cavesMutated(union);
      },
    });
  }

  /** The Tunnel panel's Generate button: build every rig with at least two
   *  points that has no cave yet (each as its own undo step). */
  private generatePendingCaves(): void {
    const caves = this.map.caves ?? [];
    for (const rig of this.caveRigs()) {
      if (rig.points.length < 2) continue;
      if (caves.some((c) => c.id === rig.id)) continue;
      this.generateCaveForRig(rig, true);
    }
    this.inspector.refresh();
  }

  /** Live regeneration while any rig point is dragged/moved. */
  private regenerateCaveForEndpoint(p: AssetPlacement): void {
    const id = p.name ?? '';
    if (!id) return;
    if (!this.map.caves?.some((c) => c.id === id)) return; // not generated yet
    const rig = this.caveRigs().find((q) => q.id === id);
    if (rig) this.generateCaveForRig(rig, false);
  }

  /** EVERY hole mutation (punch, resize, delete, undo/redo) funnels here:
   *  the shader cutout uniforms re-upload and the grass/dressing over the
   *  cutout re-scatter. Terrain heights are untouched (holes only remove the
   *  sheet), so no chunk re-mesh is needed ? just the region's decor. */
  /** FORK: every region rebuild goes through here: the renderer drops the
   *  baked cave tiles under the region, and the document's copy follows. */
  private rebuildTerrainRegion(region: RegionBox): void {
    this.viewport3d?.rebuildTerrainRegion(region);
  }
  private holesMutated(region: RegionBox | null): void {
    refreshTerrainHoles();
    invalidateStaticColliders();
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    if (region) {
      this.rebuildTerrainRegion(region);
      this.viewport3d?.finishTerrainStroke(region);
    }
    this.refreshHoleGuides();
    this.inspector.refresh();
  }

  private refreshHoleGuides(): void {
    const show = this.tool === 'tunnel';
    // FORK: the dug rock volumes draw no guide ring (they are the map's
    // sculpted rock, not a placed solid).
    this.viewport3d?.setHoleGuides(
      show ? (this.map.holes ?? []).filter((h) => h.shape !== 'voxel') : null,
      show ? (this.map.holePatches ?? []).filter((h) => h.shape !== 'voxel') : null,
    );
  }

  private holeRegion(hole: TerrainCut): RegionBox {
    const b = holeBounds(hole);
    return {
      minX: b.minX - 2,
      minZ: b.minZ - 2,
      maxX: b.maxX + 2,
      maxZ: b.maxZ + 2,
    };
  }

  /** Cut mode: one click drops the armed brush's solid through the terrain
   *  sheet (brush radius wide), a real opening you can drop or walk through
   *  when a cave tube runs underneath. The shape arithmetic is
   *  cut_tool_core.ts; the yaw comes from where the camera is looking, so a
   *  slot lines up with what the maker is facing. */
  // ---- the Cut/Carve ghost --------------------------------------------------
  // A click in Cut hole / Carve mode no longer removes ground on the spot: it
  // spawns (or re-places) a translucent blue GHOST of the solid, draggable
  // under the pointer and tunable from the panel, and only the panel's "Cut
  // into the ground" button commits it. The ghost lives outside the document:
  // no undo step exists until commit, and Cancel simply discards it.

  /** How far the ghost's centre sits below its LOCAL surface (its authored
   *  depth), preserved across drags so a tuned room keeps its depth. */
  private ghostDepth(cut: TerrainCut): number {
    return Math.max(0, terrainHeight(cut.x, cut.z, this.map.meta.seed) - cut.y);
  }

  private cutGhostBeginOrMove(w: Vec2, carve: boolean, erase = false): void {
    this.cutGhostDrag = true;
    const surface = terrainHeight(w.x, w.z, this.map.meta.seed);
    const existing = this.pendingCut;
    if (existing && this.pendingCutCarve === carve && this.pendingErase === erase) {
      // Re-place the standing ghost at the clicked point, keeping its depth.
      const depth = carve ? this.ghostDepth(existing) : 0;
      existing.x = w.x;
      existing.z = w.z;
      existing.y = surface - depth;
      this.refreshCutGhost();
      return;
    }
    const yaw = this.cutBrush.rotY || this.viewport3d?.cameraYaw() || 0;
    // The erase box: an upright box, no blend or shaping, sized by its own
    // remembered proportions (half width x length x height multiples).
    const brush = erase
      ? {
          ...this.cutBrush,
          shape: 'box' as const,
          rotY: yaw,
          rotX: 0,
          blend: 0,
          warp: 0,
          wobble: 0,
          taper: 1,
          bend: 0,
          arch: 0,
          lengthMult: this.eraseLength,
          heightMult: this.eraseHeight,
        }
      : { ...this.cutBrush, rotY: yaw };
    const cut = makeCut(
      brush,
      w.x,
      // A carve digs a real room: its centre sinks below the clicked surface
      // by the armed depth, so one commit opens a walk-in bowl or buried
      // chamber instead of a half-exposed dome.
      carve ? surface - this.carveDepth : surface,
      w.z,
      this.brushRadius,
    );
    if (carve) cut.carve = true;
    this.pendingCut = cut;
    this.pendingCutCarve = carve;
    this.pendingErase = erase;
    this.refreshCutGhost();
    this.inspector.refresh();
  }

  private cutGhostMove(w: Vec2): void {
    const cut = this.pendingCut;
    if (!cut) return;
    const depth = this.pendingCutCarve ? this.ghostDepth(cut) : 0;
    cut.x = w.x;
    cut.z = w.z;
    cut.y = terrainHeight(w.x, w.z, this.map.meta.seed) - depth;
    this.refreshCutGhost();
  }

  private refreshCutGhost(): void {
    this.viewport3d?.setCutGhost(this.pendingCut);
    this.syncCutLockBar();
  }

  /** FORK: a floating "Lock in cut / Cancel" bar over the 3D stage while a
   *  ghost stands, so the commit is one click (or Enter) wherever the panel
   *  is scrolled to and whichever transform tool is active. */
  private cutLockBar: HTMLElement | null = null;
  private syncCutLockBar(): void {
    const want = this.pendingCut !== null;
    if (!want) {
      this.cutLockBar?.remove();
      this.cutLockBar = null;
      return;
    }
    if (this.cutLockBar?.isConnected) return;
    const bar = el('div', 'ed-cut-lock');
    bar.append(
      button(
        `${this.pendingErase ? t('editor.tunnel.eraseConfirm') : t('editor.tunnel.ghostConfirm')} (Enter)`,
        () => this.commitPendingCut(),
        'primary',
      ),
      button(`${t('editor.tunnel.ghostCancel')} (Esc)`, () => this.cancelPendingCut()),
    );
    this.stage3dEl.appendChild(bar);
    this.cutLockBar = bar;
  }

  /** Panel edits on the ghost: same vocabulary as a committed cut (shape,
   *  radius, proportions, blend, depth), applied live to the preview. */
  private updatePendingCut(change: CutChange & { depth?: number }): void {
    const cut = this.pendingCut;
    if (!cut) return;
    const { depth, ...rest } = change;
    const working =
      depth === undefined
        ? cut
        : { ...cut, y: terrainHeight(cut.x, cut.z, this.map.meta.seed) - Math.max(0, depth) };
    this.pendingCut = applyCutChange(working, rest);
    this.refreshCutGhost();
  }

  /** FORK: a gizmo drag on the ghost (tools 2-4): position is absolute,
   *  everything else goes through the same edit vocabulary as the panel. */
  private gizmoPendingCut(change: GizmoCutChange): void {
    const cut = this.pendingCut;
    if (!cut) return;
    if (change.x !== undefined) cut.x = change.x;
    if (change.y !== undefined) cut.y = change.y;
    if (change.z !== undefined) cut.z = change.z;
    const { x: _x, y: _y, z: _z, ...rest } = change;
    if (Object.keys(rest).length > 0) this.pendingCut = applyCutChange(cut, rest);
    this.refreshCutGhost();
  }

  /** The ghost becomes a real cut: the ground opens, with one undo step. */
  private commitPendingCut(): void {
    const hole = this.pendingCut;
    if (!hole) return;
    if (this.pendingErase) {
      this.commitEraseBox(hole);
      return;
    }
    const holes = this.holesRef();
    if (holes.length >= MAX_TERRAIN_HOLES) {
      this.toasts.error(t('editor.status.holeCapReached', { max: MAX_TERRAIN_HOLES }));
      return;
    }
    this.pendingCut = null;
    this.cutGhostDrag = false;
    this.refreshCutGhost();
    const carve = hole.carve === true;
    holes.push(hole);
    const region = this.holeRegion(hole);
    this.holesMutated(region);
    this.pushUndo({
      label: carve ? 'carve-place' : 'hole-punch',
      undo: () => {
        const i = holes.indexOf(hole);
        if (i >= 0) holes.splice(i, 1);
        this.holesMutated(region);
      },
      redo: () => {
        holes.push(hole);
        this.holesMutated(region);
      },
    });
    this.inspector.refresh();
  }

  /** FORK: the Fill tool's erase box. Every carve or hole wholly inside the
   *  box is deleted; every dug volume has its cells inside the box put back
   *  to rock (an emptied record goes); a carve the box only partly covers
   *  gets a solid box PATCH over the covered part. One undo step. */
  private commitEraseBox(box: TerrainCut): void {
    this.pendingCut = null;
    this.pendingErase = false;
    this.cutGhostDrag = false;
    this.refreshCutGhost();
    const hx = box.halfX ?? box.radius;
    const hy = box.halfY ?? box.radius;
    const hz = box.halfZ ?? box.radius;
    this.eraseLength = hx / hz;
    this.eraseHeight = hy / hz;
    const holes = this.holesRef();
    const patches = this.holePatchesRef();
    const boxB = cutBounds(box);
    const inside = (x: number, y: number, z: number): boolean => cutSdfAt(box, x, y, z) <= 0;
    let region: RegionBox | null = this.holeRegion(box);
    const removed: { cut: TerrainCut; index: number }[] = [];
    const erased: {
      cut: TerrainCut;
      index: number;
      vbox: VoxelBox;
      before: Int8Array;
      after: Int8Array;
      emptied: boolean;
    }[] = [];
    let partial = false;
    for (let i = holes.length - 1; i >= 0; i--) {
      const cut = holes[i];
      if (cut.shape === 'voxel') {
        const vbox = eraseVoxelBounds(cut, box);
        if (!vbox) continue;
        const before = snapshotVoxels(cut, vbox);
        if (!eraseVoxelBox(cut, box, vbox)) continue;
        const after = snapshotVoxels(cut, vbox);
        region = unionRegion(region, this.holeRegion(cut));
        const emptied = voxelIsEmpty(cut);
        if (emptied) holes.splice(i, 1);
        erased.push({ cut, index: i, vbox, before, after, emptied });
        continue;
      }
      const b = cutBounds(cut);
      const v = cutVerticalBounds(cut);
      if (
        b.minX > boxB.maxX ||
        b.maxX < boxB.minX ||
        b.minZ > boxB.maxZ ||
        b.maxZ < boxB.minZ ||
        v.minY > box.y + hy ||
        v.maxY < box.y - hy
      ) {
        continue;
      }
      let whole = true;
      for (const x of [b.minX, b.maxX]) {
        for (const z of [b.minZ, b.maxZ]) {
          for (const y of [v.minY, v.maxY]) if (!inside(x, y, z)) whole = false;
        }
      }
      if (whole) {
        region = unionRegion(region, this.holeRegion(cut));
        removed.push({ cut, index: i });
        holes.splice(i, 1);
      } else {
        partial = true;
      }
    }
    let patch: TerrainCut | null = null;
    if (partial) {
      if (patches.length >= MAX_HOLE_PATCHES) {
        this.toasts.error(t('editor.status.holeCapReached', { max: MAX_HOLE_PATCHES }));
      } else {
        patch = {
          x: box.x,
          y: box.y,
          z: box.z,
          radius: box.radius,
          shape: 'box',
          halfX: hx,
          halfY: hy,
          halfZ: hz,
        };
        if (box.rotY) patch.rotY = box.rotY;
        patches.push(patch);
      }
    }
    if (removed.length === 0 && erased.length === 0 && !patch) {
      this.toasts.info(t('editor.tunnel.eraseNothing'));
      this.inspector.refresh();
      return;
    }
    const finalRegion = region;
    this.holesMutated(finalRegion);
    const thePatch = patch;
    this.pushUndo({
      label: 'cave-erase',
      undo: () => {
        for (const e of erased) {
          if (e.emptied && !holes.includes(e.cut))
            holes.splice(Math.min(e.index, holes.length), 0, e.cut);
          restoreVoxels(e.cut, e.vbox, e.before);
        }
        for (const r of [...removed].sort((a, b) => a.index - b.index)) {
          holes.splice(Math.min(r.index, holes.length), 0, r.cut);
        }
        if (thePatch) {
          const i = patches.indexOf(thePatch);
          if (i >= 0) patches.splice(i, 1);
        }
        this.holesMutated(finalRegion);
      },
      redo: () => {
        for (const r of removed) {
          const i = holes.indexOf(r.cut);
          if (i >= 0) holes.splice(i, 1);
        }
        for (const e of erased) {
          restoreVoxels(e.cut, e.vbox, e.after);
          if (e.emptied) {
            const i = holes.indexOf(e.cut);
            if (i >= 0) holes.splice(i, 1);
          }
        }
        if (thePatch && !patches.includes(thePatch)) patches.push(thePatch);
        this.holesMutated(finalRegion);
      },
    });
    this.toasts.info(
      t('editor.tunnel.eraseDone', { n: removed.length + erased.length + (patch ? 1 : 0) }),
    );
    this.inspector.refresh();
  }

  private cancelPendingCut(): void {
    if (!this.pendingCut) return;
    this.pendingCut = null;
    this.pendingErase = false;
    this.cutGhostDrag = false;
    this.refreshCutGhost();
    this.inspector.refresh();
  }

  /** Cut panel edits: shape, radius, proportions and blend (live while
   *  dragging, one undo step at commit). Every field goes through
   *  applyCutChange, so a resize keeps the proportions a maker tuned and a
   *  shape swap carries them across. */
  private updateHole(
    index: number,
    change: CutChange & { depth?: number; tex?: string | null; texTile?: number | null },
    commit: boolean,
  ): void {
    const holes = this.holesRef();
    const hole = holes[index];
    if (!hole) return;
    const base = this.holeEditBase?.index === index ? this.holeEditBase : { index, cut: hole };
    this.holeEditBase = base;
    // Depth and the interior texture are app-level fields (the core is
    // surface-blind): re-anchor the solid's centre below the LOCAL surface /
    // dress the working copy, then let the shape arithmetic apply the rest.
    const { depth, tex, texTile, ...rest } = change;
    let working =
      depth === undefined
        ? hole
        : { ...hole, y: terrainHeight(hole.x, hole.z, this.map.meta.seed) - depth };
    if (tex !== undefined || texTile !== undefined) {
      working = { ...working };
      if (tex === null) delete working.tex;
      else if (tex !== undefined) working.tex = tex;
      if (texTile === null) delete working.texTile;
      else if (texTile !== undefined) working.texTile = Math.min(64, Math.max(1, texTile));
    }
    const next = applyCutChange(working, rest);
    holes[index] = next;
    // The rebuild must cover the union of before and after, so shrinking a cut
    // restores the ground it used to remove.
    const region = unionRegion(this.holeRegion(base.cut), this.holeRegion(next));
    // Live: re-mesh the region so the opening follows the slider, but do NOT
    // run the full holesMutated (its inspector.refresh would replace the very
    // slider element being dragged). Commit does the rest.
    invalidateStaticColliders();
    this.rebuildTerrainRegion(region);
    this.canvasDirty = true;
    if (!commit) return;
    this.holeEditBase = null;
    const prev = base.cut;
    if (sameCut(prev, next)) return;
    this.holesMutated(region);
    this.pushUndo({
      label: 'hole-edit',
      undo: () => {
        holes[index] = prev;
        this.holesMutated(region);
      },
      redo: () => {
        holes[index] = next;
        this.holesMutated(region);
      },
    });
  }

  private deleteHole(index: number): void {
    const holes = this.holesRef();
    const hole = holes[index];
    if (!hole) return;
    const region = this.holeRegion(hole);
    holes.splice(index, 1);
    this.holesMutated(region);
    this.pushUndo({
      label: 'hole-delete',
      undo: () => {
        holes.splice(index, 0, hole);
        this.holesMutated(region);
      },
      redo: () => {
        const i = holes.indexOf(hole);
        if (i >= 0) holes.splice(i, 1);
        this.holesMutated(region);
      },
    });
  }

  /** Patch mode: one click drops a patch solid (the same brush the Cut mode
   *  arms) that RESTORES the ground inside any cutouts it overlaps, filling
   *  in the unwanted blank parts around the cuts. */
  private placeHolePatch(w: Vec2): void {
    const patches = this.holePatchesRef();
    if (patches.length >= MAX_HOLE_PATCHES) {
      this.toasts.error(t('editor.status.holeCapReached', { max: MAX_HOLE_PATCHES }));
      return;
    }
    const patch = makeCut(
      { ...this.cutBrush, rotY: this.cutBrush.rotY || this.viewport3d?.cameraYaw() || 0 },
      w.x,
      terrainHeight(w.x, w.z, this.map.meta.seed),
      w.z,
      this.brushRadius,
    );
    patches.push(patch);
    const region = this.holeRegion(patch);
    this.holesMutated(region);
    this.pushUndo({
      label: 'hole-patch',
      undo: () => {
        const i = patches.indexOf(patch);
        if (i >= 0) patches.splice(i, 1);
        this.holesMutated(region);
      },
      redo: () => {
        patches.push(patch);
        this.holesMutated(region);
      },
    });
  }

  private detailRegionsRef(): DetailRegion[] {
    if (!this.map.detailRegions) this.map.detailRegions = [];
    if (this.activeWorld.detailRegions !== this.map.detailRegions) {
      this.activeWorld.detailRegions = this.map.detailRegions;
    }
    return this.map.detailRegions;
  }

  /** Every detail-region mutation funnels here: re-extract the carve interiors
   *  the region's detail now governs (rebuildTerrainRegion refreshes the
   *  cavity tiles) and repaint the panel list. */
  private detailMutated(region: RegionBox): void {
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    this.rebuildTerrainRegion(region);
    this.inspector.refresh();
  }

  /** Remesh mode: one click paints a detail disc at the brush radius. The
   *  carve interiors under it re-extract at the armed cell size. */
  private placeDetailRegion(w: Vec2): void {
    const regions = this.detailRegionsRef();
    if (regions.length >= MAX_DETAIL_REGIONS) {
      this.toasts.error(t('editor.status.holeCapReached', { max: MAX_DETAIL_REGIONS }));
      return;
    }
    const entry: DetailRegion = {
      x: w.x,
      z: w.z,
      radius: Math.max(1, Math.min(MAX_DETAIL_RADIUS, this.brushRadius)),
      cell: Math.max(DETAIL_CELL_MIN, Math.min(DETAIL_CELL_MAX, this.remeshCell)),
    };
    regions.push(entry);
    const region: RegionBox = {
      minX: entry.x - entry.radius - 2,
      minZ: entry.z - entry.radius - 2,
      maxX: entry.x + entry.radius + 2,
      maxZ: entry.z + entry.radius + 2,
    };
    this.detailMutated(region);
    this.pushUndo({
      label: 'remesh-detail',
      undo: () => {
        const i = regions.indexOf(entry);
        if (i >= 0) regions.splice(i, 1);
        this.detailMutated(region);
      },
      redo: () => {
        regions.push(entry);
        this.detailMutated(region);
      },
    });
  }

  private deleteDetailRegion(index: number): void {
    const regions = this.detailRegionsRef();
    const entry = regions[index];
    if (!entry) return;
    const region: RegionBox = {
      minX: entry.x - entry.radius - 2,
      minZ: entry.z - entry.radius - 2,
      maxX: entry.x + entry.radius + 2,
      maxZ: entry.z + entry.radius + 2,
    };
    regions.splice(index, 1);
    this.detailMutated(region);
    this.pushUndo({
      label: 'remesh-detail-delete',
      undo: () => {
        regions.splice(index, 0, entry);
        this.detailMutated(region);
      },
      redo: () => {
        const i = regions.indexOf(entry);
        if (i >= 0) regions.splice(i, 1);
        this.detailMutated(region);
      },
    });
  }

  // ---- the volumetric Dig/Fill sculpt brushes -------------------------------
  // A stroke lays small blended carve spheres (Dig) or patch spheres (Fill)
  // along the drag, stamped at the point the pointer ray strikes a carve
  // interior / cave wall (falling back to the terrain surface), so a maker
  // sculpts cave walls the way Blender's clay brushes push a mesh. One undo
  // step per gesture; the affected region re-extracts live, throttled.

  /** Dig stamps are smaller than the aiming brush so a stroke reads as a
   *  carve, not a bomb crater; clamped to the document's shape bounds. */
  private carveStampRadius(): number {
    // The brush ring IS the stamp: a maker who sets a 20-yd brush digs a
    // 20-yd bite (the old 8-yd ceiling made every dig a crawl tunnel).
    return Math.max(0.5, Math.min(60, this.brushRadius));
  }

  private carveStampAt(w: Vec2, ev?: PointerEvent): { x: number; y: number; z: number } {
    const hit = ev ? this.viewport3d?.carveHitAt(ev.clientX, ev.clientY) : null;
    if (hit) return hit;
    return { x: w.x, y: terrainHeight(w.x, w.z, this.map.meta.seed), z: w.z };
  }

  /** The direction a stamp bites INTO the rock: along the view ray, so a
   *  half-moon stamp on a cave wall cuts away from the maker. */
  private digInto(at: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const cam = this.viewport3d?.dungeonStagePort()?.renderer.camera.position;
    if (!cam) return { x: 0, y: -1, z: 0 };
    const dx = at.x - cam.x;
    const dy = at.y - cam.y;
    const dz = at.z - cam.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return { x: 0, y: -1, z: 0 };
    return { x: dx / len, y: dy / len, z: dz / len };
  }
  private carveStrokeBegin(mode: 'sculpt' | 'fill', w: Vec2, ev?: PointerEvent): void {
    const at = this.carveStampAt(w, ev);
    this.carveStroke = {
      mode,
      targets: [],
      region: null,
      dirty: null,
      lastX: Number.NaN,
      lastZ: Number.NaN,
      lastY: Number.NaN,
      lastRefresh: 0,
      capped: false,
    };
    this.carveStrokeStamp(at);
  }
  private carveStrokeStep(w: Vec2, ev?: PointerEvent): void {
    if (!this.carveStroke) return;
    this.carveStrokeStamp(this.carveStampAt(w, ev));
  }
  /** Is any PRIMITIVE carve (sphere/box/capsule room, not a dug volume)
   *  under this stamp? Filling one needs a solid patch, since its shape
   *  cannot be written back to rock the way a dig grid can. */
  private primitiveCarveUnder(box: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  }): boolean {
    for (const cut of this.holesRef()) {
      if (cut.carve !== true || cut.shape === 'voxel') continue;
      const b = cutBounds(cut);
      const v = cutVerticalBounds(cut);
      if (
        b.minX <= box.maxX &&
        b.maxX >= box.minX &&
        b.minZ <= box.maxZ &&
        b.maxZ >= box.minZ &&
        v.minY <= box.maxY &&
        v.maxY >= box.minY
      ) {
        return true;
      }
    }
    return false;
  }
  /** Find or open the stroke's target on one list; null when a needed regrow
   *  passed the budget (reported once per stroke). */
  private carveStrokeTarget(
    op: 'dig' | 'fill' | 'restore',
    list: TerrainCut[],
    at: { x: number; y: number; z: number },
    r: number,
    create: boolean,
  ): VoxelStrokeTarget | null {
    const stroke = this.carveStroke;
    if (!stroke) return null;
    let target = stroke.targets.find((t) => t.list === list) ?? null;
    let cut = target?.cut ?? list.find((c) => c.shape === 'voxel') ?? null;
    if (!cut && !create) return null;
    const want = stampWorldBox(at, r, cut?.cell ?? this.digCell);
    let created = false;
    if (!cut) {
      const cell = pickDigCell(this.digCell, r);
      if (cell > this.digCell + 1e-9)
        this.toasts.info(t('editor.tunnel.digCellCoarsened', { cell }));
      cut = makeVoxelCut(cell, want);
      list.push(cut);
      created = true;
    } else if (op !== 'restore' && !voxelCovers(cut, want)) {
      // (a restore only rises what stands inside the grid: no regrow)
      const before = voxelFields(cut);
      if (!growVoxelCut(cut, want)) {
        if (!stroke.capped) {
          stroke.capped = true;
          this.toasts.error(t('editor.tunnel.digVolumeFull'));
        }
        return null;
      }
      if (target) {
        // The regrow keeps every cell; the stroke's undo box just shifts into
        // the new grid's indices, and undo crops back to the pre-stroke grid.
        if (!target.grewFrom) target.grewFrom = before;
        if (target.box) {
          const sh = voxelShiftFrom(cut, before);
          target.box = {
            x0: target.box.x0 + sh.x,
            y0: target.box.y0 + sh.y,
            z0: target.box.z0 + sh.z,
            x1: target.box.x1 + sh.x,
            y1: target.box.y1 + sh.y,
            z1: target.box.z1 + sh.z,
          };
        }
      }
    }
    if (!target) {
      target = { op, cut, list, created, box: null, snap: null, grewFrom: null, removed: false };
      stroke.targets.push(target);
    }
    return target;
  }
  private carveStrokeStamp(at: { x: number; y: number; z: number }): void {
    const stroke = this.carveStroke;
    if (!stroke) return;
    const r = this.carveStampRadius();
    if (
      Number.isFinite(stroke.lastX) &&
      Math.hypot(at.x - stroke.lastX, at.y - stroke.lastY, at.z - stroke.lastZ) < r * 0.45
    ) {
      return;
    }
    const targets: VoxelStrokeTarget[] = [];
    if (stroke.mode === 'sculpt') {
      const tg = this.carveStrokeTarget('dig', this.holesRef(), at, r, true);
      if (tg) targets.push(tg);
    } else {
      // Fill: rock goes back into the dug volume; a primitive room under
      // the brush additionally gets a solid patch (the only way to fill it).
      const back = this.carveStrokeTarget('restore', this.holesRef(), at, r, false);
      if (back) targets.push(back);
      const reach = stampWorldBox(at, r, this.digCell);
      if (this.primitiveCarveUnder(reach)) {
        const patch = this.carveStrokeTarget('fill', this.holePatchesRef(), at, r, true);
        if (patch) targets.push(patch);
      }
    }
    if (targets.length === 0) return;
    stroke.lastX = at.x;
    stroke.lastY = at.y;
    stroke.lastZ = at.z;
    for (const target of targets) {
      const cut = target.cut;
      // Box undo: widen the pre-stroke snapshot to cover this stamp BEFORE
      // the cells change.
      const box = stampBox(cut, at, r);
      if (!target.created) {
        const union = unionVoxelBox(target.box, box);
        target.snap =
          target.box && target.snap
            ? extendSnapshot(cut, target.box, target.snap, union)
            : snapshotVoxels(cut, union);
        target.box = union;
      } else {
        target.box = unionVoxelBox(target.box, box);
      }
      stampVoxel(cut, target.op, at, r, this.digAlpha, this.digInto(at));
      const region = voxelBoxRegion(cut, box);
      stroke.region = unionRegion(stroke.region, region);
      stroke.dirty = unionRegion(stroke.dirty, region);
    }
    const nowMs = performance.now();
    if (nowMs - stroke.lastRefresh > 140 && stroke.dirty) {
      stroke.lastRefresh = nowMs;
      const dirty = stroke.dirty;
      stroke.dirty = null;
      invalidateStaticColliders();
      // Preview at half detail under the stroke; the end refreshes it fine.
      setCavityPreviewCoarsen(2, stroke.region);
      this.rebuildTerrainRegion(dirty);
      this.canvasDirty = true;
    }
  }
  private carveStrokeEnd(): void {
    const stroke = this.carveStroke;
    this.carveStroke = null;
    setCavityPreviewCoarsen(1, null);
    if (!stroke) return;
    const targets = stroke.targets.filter((t) => t.box !== null);
    if (targets.length === 0) return;
    let region = stroke.region;
    const steps: { undo: () => void; redo: () => void }[] = [];
    for (const target of targets) {
      const cut = target.cut;
      const list = target.list;
      const box = target.box as VoxelBox;
      commitVoxelText(cut);
      // A fill that put every last cell back to rock: the record goes with
      // its mesh (undo brings it back).
      const removed = target.op === 'restore' && voxelIsEmpty(cut);
      // The refresh covers the STAMPS, not the whole record: a regrown grid
      // is rock in every cell the brush did not reach, so the field outside
      // the stroke is unchanged, and re-cutting the record's full footprint
      // re-meshed every tile of the cave (and dropped its whole bake) for a
      // stroke that touched three. A record that just emptied out needs its
      // whole footprint, so its mesh goes.
      if (removed) region = unionRegion(region, this.holeRegion(cut));
      if (removed) {
        const i = list.indexOf(cut);
        if (i >= 0) list.splice(i, 1);
      }
      const after = snapshotVoxels(cut, box);
      const before = target.snap;
      const grewFrom = target.grewFrom;
      const created = target.created;
      const afterFields = voxelFields(cut);
      steps.push({
        undo: () => {
          if (created) {
            const i = list.indexOf(cut);
            if (i >= 0) list.splice(i, 1);
            return;
          }
          if (removed && !list.includes(cut)) list.push(cut);
          if (before) restoreVoxels(cut, box, before);
          if (grewFrom) resizeVoxelCut(cut, grewFrom);
        },
        redo: () => {
          if (created) {
            if (!list.includes(cut)) list.push(cut);
            return;
          }
          if (grewFrom) resizeVoxelCut(cut, afterFields);
          restoreVoxels(cut, box, after);
          if (removed) {
            const i = list.indexOf(cut);
            if (i >= 0) list.splice(i, 1);
          }
        },
      });
    }
    const finalRegion = region;
    this.holesMutated(finalRegion);
    this.pushUndo({
      label: stroke.mode === 'sculpt' ? 'carve-dig' : 'carve-fill',
      undo: () => {
        for (const st of [...steps].reverse()) st.undo();
        this.holesMutated(finalRegion);
      },
      redo: () => {
        for (const st of steps) st.redo();
        this.holesMutated(finalRegion);
      },
    });
  }
  /** FORK: one cell for every carve interior on the map (Remesh all caves):
   *  sets the document's cave mesh cell and re-meshes every cluster. */
  private remeshAllCaves(cell: number): void {
    const next = Math.max(DETAIL_CELL_MIN, Math.min(DETAIL_CELL_MAX, cell));
    const prev = this.map.caveMeshCell;
    const apply = (v: number | undefined): void => {
      if (v === undefined) {
        delete this.map.caveMeshCell;
        delete this.activeWorld.caveMeshCell;
      } else {
        this.map.caveMeshCell = v;
        this.activeWorld.caveMeshCell = v;
      }
      let region: RegionBox | null = null;
      for (const list of [this.holesRef(), this.holePatchesRef()]) {
        for (const cut of list) {
          if (cut.carve === true) region = unionRegion(region, this.holeRegion(cut));
        }
      }
      if (region) this.holesMutated(region);
      this.markDirty();
      this.inspector.refresh();
    };
    apply(next);
    this.pushUndo({
      label: 'remesh-all-caves',
      undo: () => apply(prev),
      redo: () => apply(next),
    });
  }

  /** FORK: drop every dug/filled volume of the document (one undo step). */
  private clearDugRock(): void {
    const holes = this.holesRef();
    const patches = this.holePatchesRef();
    const removed: { list: TerrainCut[]; cut: TerrainCut; index: number }[] = [];
    for (const list of [holes, patches]) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].shape === 'voxel') removed.push({ list, cut: list[i], index: i });
      }
    }
    if (removed.length === 0) return;
    let region: RegionBox | null = null;
    for (const r of removed) region = unionRegion(region, this.holeRegion(r.cut));
    for (const r of removed) r.list.splice(r.index, 1);
    this.holesMutated(region);
    this.pushUndo({
      label: 'carve-clear-dug',
      undo: () => {
        for (const r of [...removed].reverse()) r.list.splice(r.index, 0, r.cut);
        this.holesMutated(region);
      },
      redo: () => {
        for (const r of removed) {
          const i = r.list.indexOf(r.cut);
          if (i >= 0) r.list.splice(i, 1);
        }
        this.holesMutated(region);
      },
    });
    this.inspector.refresh();
  }
  private smoothStrokeBegin(w: Vec2): void {
    this.smoothStroke = {
      targets: new Map(),
      region: null,
      dirty: null,
      lastX: Number.NaN,
      lastZ: Number.NaN,
      lastRefresh: 0,
    };
    this.smoothStrokeStamp(w);
  }

  private smoothStrokeStamp(w: Vec2): void {
    const stroke = this.smoothStroke;
    if (!stroke) return;
    const r = this.brushRadius;
    // Stamp spacing, like the Dig brush: a held-still pointer must not ramp
    // every cut under it to maximum blend in a few frames.
    if (
      Number.isFinite(stroke.lastX) &&
      Math.hypot(w.x - stroke.lastX, w.z - stroke.lastZ) < r * 0.5
    ) {
      return;
    }
    stroke.lastX = w.x;
    stroke.lastZ = w.z;
    let touched = false;
    // FORK: the dug rock volumes smooth like clay: a blur inside the brush,
    // so a cave wall the Dig brush roughed up can be eased like ground.
    const centre = this.smoothStrokeCentre(w);
    for (const list of [this.holesRef(), this.holePatchesRef()]) {
      for (const cut of list) {
        if (cut.shape !== 'voxel') continue;
        const box = stampBox(cut, centre, r);
        if (box.x1 <= box.x0 || box.y1 <= box.y0 || box.z1 <= box.z0) continue;
        this.smoothVoxelUndo.push({ cut, box, snap: snapshotVoxels(cut, box) });
        smoothVoxel(cut, centre, r, 0.6);
        touched = true;
        const region = voxelBoxRegion(cut, box);
        stroke.region = unionRegion(stroke.region, region);
        stroke.dirty = unionRegion(stroke.dirty, region);
      }
    }
    for (const list of [this.holesRef(), this.holePatchesRef()]) {
      for (const cut of list) {
        // A tube is a cave's own bore: its blend is the cave's, not ours.
        if (cut.shape === 'tube' || cut.shape === 'voxel') continue;
        const b = this.holeRegion(cut);
        if (w.x < b.minX - r || w.x > b.maxX + r || w.z < b.minZ - r || w.z > b.maxZ + r) {
          continue;
        }
        const before = cut.blend ?? 0;
        const next = Math.min(CUT_MAX_BLEND, before + CUT_MAX_BLEND * 0.12);
        if (next <= before) continue;
        if (!stroke.targets.has(cut)) stroke.targets.set(cut, before);
        cut.blend = next;
        touched = true;
        const region = this.holeRegion(cut);
        stroke.region = unionRegion(stroke.region, region);
        stroke.dirty = unionRegion(stroke.dirty, region);
      }
    }
    if (!touched) return;
    const nowMs = performance.now();
    if (nowMs - stroke.lastRefresh > 140 && stroke.dirty) {
      stroke.lastRefresh = nowMs;
      const dirty = stroke.dirty;
      stroke.dirty = null;
      invalidateStaticColliders();
      setCavityPreviewCoarsen(2, stroke.region);
      this.rebuildTerrainRegion(dirty);
      this.canvasDirty = true;
    }
  }

  /** Where a Smooth stamp centres: the cave surface under the pointer when
   *  the last edit event hit one, else the ground at the brush point. */
  private smoothStrokeCentre(w: Vec2): { x: number; y: number; z: number } {
    const hit = this.lastEditPointer
      ? this.viewport3d?.carveHitAt(this.lastEditPointer.x, this.lastEditPointer.y)
      : null;
    return hit ?? { x: w.x, y: terrainHeight(w.x, w.z, this.map.meta.seed), z: w.z };
  }
  private smoothStrokeEnd(): void {
    setCavityPreviewCoarsen(1, null);
    const stroke = this.smoothStroke;
    this.smoothStroke = null;
    const voxelUndo = this.smoothVoxelUndo;
    this.smoothVoxelUndo = [];
    if (voxelUndo.length > 0) {
      const seen = new Set<TerrainCut>();
      for (const v of voxelUndo) {
        if (!seen.has(v.cut)) {
          seen.add(v.cut);
          commitVoxelText(v.cut);
        }
      }
    }
    if (!stroke || (stroke.targets.size === 0 && voxelUndo.length === 0)) return;
    const region = stroke.region;
    if (!region) return;
    if (voxelUndo.length > 0) {
      // One undo step for the voxel blur (box snapshots, oldest first).
      const afters = voxelUndo.map((v) => ({ ...v, after: snapshotVoxels(v.cut, v.box) }));
      this.holesMutated(region);
      this.pushUndo({
        label: 'cut-smooth-voxel',
        undo: () => {
          for (const v of [...voxelUndo].reverse()) restoreVoxels(v.cut, v.box, v.snap);
          this.holesMutated(region);
        },
        redo: () => {
          for (const v of afters) restoreVoxels(v.cut, v.box, v.after);
          this.holesMutated(region);
        },
      });
      if (stroke.targets.size === 0) return;
    }
    const changes = [...stroke.targets.entries()].map(([cut, before]) => ({
      cut,
      before,
      after: cut.blend ?? 0,
    }));
    this.holesMutated(region);
    this.pushUndo({
      label: 'cut-smooth',
      undo: () => {
        for (const c of changes) {
          if (c.before > 0) c.cut.blend = c.before;
          else delete c.cut.blend;
        }
        this.holesMutated(region);
      },
      redo: () => {
        for (const c of changes) c.cut.blend = c.after;
        this.holesMutated(region);
      },
    });
  }

  /** Patch panel edits: same shape vocabulary as a cut (live while dragging,
   *  one undo step at commit). */
  private updateHolePatch(index: number, change: CutChange, commit: boolean): void {
    const patches = this.holePatchesRef();
    const patch = patches[index];
    if (!patch) return;
    const base =
      this.holePatchEditBase?.index === index ? this.holePatchEditBase : { index, cut: patch };
    this.holePatchEditBase = base;
    const next = applyCutChange(patch, change);
    patches[index] = next;
    const region = unionRegion(this.holeRegion(base.cut), this.holeRegion(next));
    invalidateStaticColliders();
    this.rebuildTerrainRegion(region);
    this.canvasDirty = true;
    if (!commit) return;
    this.holePatchEditBase = null;
    const prev = base.cut;
    if (sameCut(prev, next)) return;
    this.holesMutated(region);
    this.pushUndo({
      label: 'hole-patch-edit',
      undo: () => {
        patches[index] = prev;
        this.holesMutated(region);
      },
      redo: () => {
        patches[index] = next;
        this.holesMutated(region);
      },
    });
  }

  private deleteHolePatch(index: number): void {
    const patches = this.holePatchesRef();
    const patch = patches[index];
    if (!patch) return;
    const region = this.holeRegion(patch);
    patches.splice(index, 1);
    this.holesMutated(region);
    this.pushUndo({
      label: 'hole-patch-delete',
      undo: () => {
        patches.splice(index, 0, patch);
        this.holesMutated(region);
      },
      redo: () => {
        const i = patches.indexOf(patch);
        if (i >= 0) patches.splice(i, 1);
        this.holesMutated(region);
      },
    });
  }

  /** "Select whole cave": multi-select every rig marker of the cave and arm
   *  the Move tool, so the existing group gizmo translates the entire tube
   *  rigidly (XZ drag and Y lift both move every node by the same delta; the
   *  regenerated chain is translation-covariant, so the shape is preserved
   *  exactly while you line the mouth up with a hole). */
  private selectWholeCave(index: number): void {
    const cave = this.map.caves?.[index];
    if (!cave) return;
    const indices: number[] = [];
    for (let i = 0; i < this.map.placements.length; i++) {
      const p = this.map.placements[i];
      if (
        (p.assetId === CAVE_ENTRANCE_ASSET_ID ||
          p.assetId === CAVE_EXIT_ASSET_ID ||
          p.assetId === CAVE_POINT_ASSET_ID) &&
        p.name === cave.id
      ) {
        indices.push(i);
      }
    }
    if (indices.length === 0) {
      this.toasts.error(t('editor.tunnel.noRig'));
      return;
    }
    this.setTool('move');
    this.selectPlacements(indices);
  }

  /** Cave panel edits: width/height multipliers, organic variance (re-bores
   *  through the rig), spike densities, reverse A<->B, delete. */
  private updateCave(
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
  ): void {
    const cave = this.map.caves?.[index];
    if (!cave) return;
    const base =
      this.caveEditBase?.cave === cave
        ? this.caveEditBase
        : {
            cave,
            width: cave.width ?? 1,
            height: cave.height ?? 1,
            variance: cave.variance ?? 0,
            floorVariance: cave.floorVariance ?? 0,
            stalactites: cave.stalactites ?? 0,
            stalagmites: cave.stalagmites ?? 0,
            spikeSize: cave.spikeSize ?? 1,
            startOpen: cave.startOpen !== false,
            endOpen: cave.endOpen !== false,
            tex: cave.tex ?? null,
            texTile: cave.texTile ?? null,
            autoMouth: cave.autoMouth === true,
            mouthBlend: cave.mouthBlend ?? 0,
            nodes: cave.nodes,
          };
    this.caveEditBase = base;
    if (change.width !== undefined)
      cave.width = Math.min(CAVE_MAX_MULT, Math.max(CAVE_MIN_MULT, change.width));
    if (change.height !== undefined)
      cave.height = Math.min(CAVE_MAX_MULT, Math.max(CAVE_MIN_MULT, change.height));
    // Floor bumps live in the shared sampler (sim sheet + mesh): no re-bore
    // needed, the region rebuild below refreshes the mesh.
    if (change.floorVariance !== undefined)
      cave.floorVariance = Math.min(1, Math.max(0, change.floorVariance));
    if (change.stalactites !== undefined)
      cave.stalactites = Math.min(1, Math.max(0, change.stalactites));
    if (change.stalagmites !== undefined)
      cave.stalagmites = Math.min(1, Math.max(0, change.stalagmites));
    if (change.spikeSize !== undefined) {
      cave.spikeSize = Math.min(
        CAVE_SPIKE_SIZE_MAX,
        Math.max(CAVE_SPIKE_SIZE_MIN, change.spikeSize),
      );
    }
    // Mouth toggles: open is the default; store only an explicit seal.
    if (change.startOpen !== undefined) {
      if (change.startOpen) delete cave.startOpen;
      else cave.startOpen = false;
    }
    if (change.endOpen !== undefined) {
      if (change.endOpen) delete cave.endOpen;
      else cave.endOpen = false;
    }
    if (change.tex !== undefined) {
      if (change.tex === null) delete cave.tex;
      else cave.tex = change.tex;
    }
    if (change.texTile !== undefined) {
      if (change.texTile === null) delete cave.texTile;
      else cave.texTile = Math.min(64, Math.max(1, change.texTile));
    }
    // Self-carving mouth: only an explicit true is stored, so a cave that
    // never opted in keeps the v1 contract of hand-placed openings.
    if (change.autoMouth !== undefined) {
      if (change.autoMouth) cave.autoMouth = true;
      else delete cave.autoMouth;
    }
    if (change.mouthBlend !== undefined) {
      const blend = Math.min(CUT_MAX_BLEND, Math.max(0, change.mouthBlend));
      if (blend > 0) cave.mouthBlend = blend;
      else delete cave.mouthBlend;
    }
    if (change.variance !== undefined) {
      cave.variance = Math.min(1, Math.max(0, change.variance));
      // Variance shapes the tube itself: re-generate through the rig live.
      const rig = this.caveRigs().find((r) => r.id === cave.id);
      if (rig && rig.points.length >= 2) this.generateCaveForRig(rig, false);
    }
    const region = this.caveRegion(cave);
    invalidateStaticColliders();
    this.rebuildTerrainRegion(region);
    this.canvasDirty = true;
    if (!commit) return;
    this.caveEditBase = null;
    const snapshot = (): {
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
      nodes: CaveNode[];
    } => ({
      width: cave.width ?? 1,
      height: cave.height ?? 1,
      variance: cave.variance ?? 0,
      floorVariance: cave.floorVariance ?? 0,
      stalactites: cave.stalactites ?? 0,
      stalagmites: cave.stalagmites ?? 0,
      spikeSize: cave.spikeSize ?? 1,
      startOpen: cave.startOpen !== false,
      endOpen: cave.endOpen !== false,
      tex: cave.tex ?? null,
      texTile: cave.texTile ?? null,
      autoMouth: cave.autoMouth === true,
      mouthBlend: cave.mouthBlend ?? 0,
      nodes: cave.nodes,
    });
    const prev = {
      width: base.width,
      height: base.height,
      variance: base.variance,
      floorVariance: base.floorVariance,
      stalactites: base.stalactites,
      stalagmites: base.stalagmites,
      spikeSize: base.spikeSize,
      startOpen: base.startOpen,
      endOpen: base.endOpen,
      tex: base.tex,
      texTile: base.texTile,
      autoMouth: base.autoMouth,
      mouthBlend: base.mouthBlend,
      nodes: base.nodes,
    };
    const next = snapshot();
    this.viewport3d?.finishTerrainStroke(region);
    this.map.meta.updatedAt = now();
    const apply = (v: typeof prev): void => {
      cave.width = v.width;
      cave.height = v.height;
      cave.variance = v.variance;
      cave.floorVariance = v.floorVariance;
      cave.stalactites = v.stalactites;
      cave.stalagmites = v.stalagmites;
      cave.spikeSize = v.spikeSize;
      if (v.startOpen) delete cave.startOpen;
      else cave.startOpen = false;
      if (v.endOpen) delete cave.endOpen;
      else cave.endOpen = false;
      if (v.tex === null) delete cave.tex;
      else cave.tex = v.tex;
      if (v.texTile === null) delete cave.texTile;
      else cave.texTile = v.texTile;
      if (v.autoMouth) cave.autoMouth = true;
      else delete cave.autoMouth;
      if (v.mouthBlend > 0) cave.mouthBlend = v.mouthBlend;
      else delete cave.mouthBlend;
      cave.nodes = v.nodes;
      this.cavesMutated(this.caveRegion(cave));
    };
    this.pushUndo({
      label: 'cave-size',
      undo: () => apply(prev),
      redo: () => apply(next),
    });
  }

  private reverseCave(index: number): void {
    const cave = this.map.caves?.[index];
    if (!cave) return;
    cave.nodes.reverse();
    this.map.meta.updatedAt = now();
    this.refreshCaveGuides();
    this.inspector.refresh();
    this.pushUndo({
      label: 'cave-reverse',
      undo: () => {
        cave.nodes.reverse();
        this.refreshCaveGuides();
        this.inspector.refresh();
      },
      redo: () => {
        cave.nodes.reverse();
        this.refreshCaveGuides();
        this.inspector.refresh();
      },
    });
  }

  private deleteCave(index: number): void {
    const caves = this.cavesRef();
    const cave = caves[index];
    if (!cave) return;
    const region = this.caveRegion(cave);
    caves.splice(index, 1);
    // The cave's rig points go with it (they exist to regenerate it).
    const markers = this.map.placements.filter(
      (p) =>
        (p.assetId === CAVE_ENTRANCE_ASSET_ID ||
          p.assetId === CAVE_EXIT_ASSET_ID ||
          p.assetId === CAVE_POINT_ASSET_ID) &&
        p.name === cave.id,
    );
    const markerIndices = markers.map((m) => this.map.placements.indexOf(m)).sort((a, b) => b - a);
    for (const mi of markerIndices) this.map.placements.splice(mi, 1);
    this.setSelectedPlacement(null);
    this.viewport3d?.rebuildPlacements();
    this.cavesMutated(region);
    this.pushUndo({
      label: 'cave-delete',
      undo: () => {
        caves.splice(index, 0, cave);
        this.map.placements.push(...markers);
        this.viewport3d?.rebuildPlacements();
        this.cavesMutated(this.caveRegion(cave));
      },
      redo: () => {
        const i = caves.indexOf(cave);
        if (i >= 0) caves.splice(i, 1);
        for (const m of markers) {
          const mi = this.map.placements.indexOf(m);
          if (mi >= 0) this.map.placements.splice(mi, 1);
        }
        this.setSelectedPlacement(null);
        this.viewport3d?.rebuildPlacements();
        this.cavesMutated(this.caveRegion(cave));
      },
    });
  }

  private caveRegion(cave: CaveDef): RegionBox {
    const b = caveBounds(cave);
    return {
      minX: b.minX - 4,
      minZ: b.minZ - 4,
      maxX: b.maxX + 4,
      maxZ: b.maxZ + 4,
    };
  }

  // ---- Grab sculpt (snake hook) ---------------------------------------------------

  private shapeSculptStamp(stamp: HeightStamp): HeightStamp {
    if (this.sculptBrushShape === 'square') stamp.shape = 'square';
    stamp.hardness = Math.max(0, Math.min(1, this.sculptHardness / 100));
    if (this.sculptAlphaId) stamp.alpha = this.sculptAlphaId;
    return stamp;
  }

  /** Press: plant ONE live stamp under the brush; the drag pulls it. */
  private grabBegin(w: Vec2, ev: PointerEvent): void {
    if (this.map.terrainEdits.length >= MAX_TERRAIN_EDITS) {
      this.warnTerrainCap();
      return;
    }
    const stamp = this.shapeSculptStamp({
      x: w.x,
      z: w.z,
      radius: this.brushRadius,
      delta: 0,
      falloff: 'smooth',
    });
    this.map.terrainEdits.push(stamp);
    const wpp =
      this.viewMode === '3d'
        ? (this.viewport3d?.worldPerPixel(w.x, w.z) ?? 0.1)
        : 1 / Math.max(1e-3, this.cam.pxPerYard);
    const pad = stamp.radius + 2;
    this.grabSession = {
      stamp,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      startX: w.x,
      startZ: w.z,
      wpp,
      axes: this.viewMode === '3d' ? (this.viewport3d?.viewPlaneAxes() ?? null) : null,
      region: {
        minX: w.x - pad,
        minZ: w.z - pad,
        maxX: w.x + pad,
        maxZ: w.z + pad,
      },
    };
  }

  /** Drag: the cursor motion (camera-scaled) IS the pull. In 3D it maps onto
   *  the camera's view plane, so the grabbed ground follows the drag in all
   *  three axes ? sideways slides the bump, up on screen lifts it, down
   *  shoves it in. In 2D top-down only the height pull applies. */
  private grabStep(ev: PointerEvent): void {
    const g = this.grabSession;
    if (!g) return;
    const dxPx = ev.clientX - g.startClientX;
    const dyPx = g.startClientY - ev.clientY; // up-screen positive
    const s = g.stamp;
    const pad = s.radius + 2;
    const prevMinX = s.x - pad;
    const prevMinZ = s.z - pad;
    const prevMaxX = s.x + pad;
    const prevMaxZ = s.z + pad;
    if (g.axes) {
      const { right, up } = g.axes;
      const wx = (right.x * dxPx + up.x * dyPx) * g.wpp;
      const wy = (right.y * dxPx + up.y * dyPx) * g.wpp;
      const wz = (right.z * dxPx + up.z * dyPx) * g.wpp;
      s.x = g.startX + wx;
      s.z = g.startZ + wz;
      s.delta = Math.max(-200, Math.min(200, wy));
    } else {
      s.delta = Math.max(-200, Math.min(200, dyPx * g.wpp));
    }
    // Rebuild the union of the stamp's previous and current footprints (it
    // moves under a lateral drag); the session region keeps the union of the
    // whole gesture for the commit/undo rebuilds.
    const step: RegionBox = {
      minX: Math.min(prevMinX, s.x - pad),
      minZ: Math.min(prevMinZ, s.z - pad),
      maxX: Math.max(prevMaxX, s.x + pad),
      maxZ: Math.max(prevMaxZ, s.z + pad),
    };
    g.region = {
      minX: Math.min(g.region.minX, step.minX),
      minZ: Math.min(g.region.minZ, step.minZ),
      maxX: Math.max(g.region.maxX, step.maxX),
      maxZ: Math.max(g.region.maxZ, step.maxZ),
    };
    this.terrainEditsMutated();
    this.rebuildTerrainRegion(step);
    this.canvasDirty = true;
  }

  /** Release: keep the pulled shape as one undoable stamp (a no-op pull is
   *  dropped silently). */
  private grabCommit(): void {
    const g = this.grabSession;
    this.grabSession = null;
    if (!g) return;
    const edits = this.map.terrainEdits;
    const region = g.region;
    if (Math.abs(g.stamp.delta) < 0.05) {
      const i = edits.indexOf(g.stamp);
      if (i >= 0) edits.splice(i, 1);
      this.terrainEditsMutated();
      this.rebuildTerrainRegion(region);
      return;
    }
    const stamp = g.stamp;
    this.terrainEditsMutated();
    this.viewport3d?.finishTerrainStroke(region);
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    this.pushUndo({
      label: 'sculpt-grab',
      undo: () => {
        const i = edits.indexOf(stamp);
        if (i >= 0) edits.splice(i, 1);
        this.terrainEditsMutated();
        this.rebuildTerrainRegion(region);
        this.viewport3d?.finishTerrainStroke(region);
        this.canvasDirty = true;
      },
      redo: () => {
        edits.push(stamp);
        this.terrainEditsMutated();
        this.rebuildTerrainRegion(region);
        this.viewport3d?.finishTerrainStroke(region);
        this.canvasDirty = true;
      },
    });
  }

  /** One warning per stroke/action when the terrain-edit cap swallows stamps. */
  private warnTerrainCap(): void {
    if (this.strokeCapWarned) return;
    this.strokeCapWarned = true;
    this.toasts.error(t('editor.status.terrainCapReached', { max: MAX_TERRAIN_EDITS }));
  }

  /**
   * EVERY mutation of map.content.terrainEdits (stroke, erase, paste, hills,
   * and each undo/redo closure over them) funnels here: the cached collider
   * grid and the sim's terrain-edit spatial index are both stale.
   */
  private terrainEditsMutated(): void {
    refreshLiveWorldTerrain(this.activeWorld, this.map);
    invalidateStaticColliders();
    invalidateTerrainEditIndex();
    // The zone-build workers mesh from a CLONE of the content, refreshed only
    // when the generation moves: bump it or the next camera-LOD re-mesh of
    // this chunk (off-thread) restores the pre-stroke heights.
    touchActiveWorldContent();
  }

  private strokeStep(w: Vec2): void {
    if (this.tool === 'slope' && !this.slopeRamp) return;
    const spacing = this.brushRadius * 0.5;
    if (this.lastStamp) {
      const dx = w.x - this.lastStamp.x;
      const dz = w.z - this.lastStamp.z;
      if (dx * dx + dz * dz < spacing * spacing) return;
    }
    if (this.map.terrainEdits.length >= MAX_TERRAIN_EDITS) {
      this.warnTerrainCap();
      return;
    }
    const seed = this.map.meta.seed;
    let stamp: HeightStamp;
    // The rail merged raise+lower into one Sculpt tool (direction checkbox)
    // and flatten+smooth into one Level tool (mode checkbox); the legacy tool
    // ids still route here for safety. Holding Shift (strokeInvert) flips the
    // active sub-mode for this stamp: raise<->lower and smooth<->flatten.
    const isLevelTool = this.tool === 'smooth' || this.tool === 'flatten';
    if (this.tool === 'slope' && this.slopeRamp) {
      // Slope eases toward the ramp plane at Flatten's per-stamp pace.
      stamp = slopeStamp(
        w.x,
        w.z,
        this.brushRadius,
        this.slopeRamp,
        SCULPT_POWER_SCALE,
        this.flattenHardEdge,
      );
    } else if (isLevelTool) {
      // Base mode: Smooth tool smooths; Flatten tool smooths only when its
      // "smooth mode" checkbox is on. Shift inverts that choice.
      let smoothing = this.tool === 'smooth' || (this.tool === 'flatten' && this.flattenSmooth);
      if (this.strokeInvert) smoothing = !smoothing;
      if (smoothing) {
        const style = this.levelStyle;
        if (style === 'sharpen') {
          stamp = sharpenStamp(w.x, w.z, this.brushRadius, this.effectiveBrushStrength(), (x, z) =>
            terrainHeight(x, z, seed),
          );
        } else if (style === 'noise') {
          stamp = noiseStamp(
            w.x,
            w.z,
            this.brushRadius,
            this.effectiveBrushStrength(),
            this.noiseSize,
            this.noiseRough / 100,
            this.strokeNoiseSeed,
          );
        } else if (style === 'terrace') {
          // Step height rides the strength slider: gentle = low garden steps,
          // strong = cliff-band ledges.
          stamp = terraceStamp(
            w.x,
            w.z,
            this.brushRadius,
            Math.max(0.5, Math.min(8, this.effectiveBrushStrength())),
            (x, z) => terrainHeight(x, z, seed),
          );
        } else {
          stamp = smoothStamp(w.x, w.z, this.brushRadius, this.effectiveBrushStrength(), (x, z) =>
            terrainHeight(x, z, seed),
          );
        }
      } else {
        // Flatten eases toward the captured target by SCULPT_POWER_SCALE (a
        // fifth of the way from the current surface per stamp), the 5x-gentler
        // twin of the Smooth reduction above.
        stamp = flattenStamp(
          w.x,
          w.z,
          this.brushRadius,
          this.flattenTarget,
          this.flattenHardEdge,
          terrainHeight(w.x, w.z, seed),
          SCULPT_POWER_SCALE,
        );
      }
    } else {
      // Raise/Lower: base direction from the tool + the "lower" checkbox, then
      // Shift flips it (a Shift-click on Raise lowers, and vice versa).
      let down = this.tool === 'lower' || (this.tool === 'raise' && this.sculptLower);
      if (this.strokeInvert) down = !down;
      const strength = this.effectiveBrushStrength();
      stamp = {
        x: w.x,
        z: w.z,
        radius: this.brushRadius,
        delta: down ? -strength : strength,
        falloff: 'smooth',
      };
    }
    stamp = this.shapeSculptStamp(stamp);
    this.map.terrainEdits.push(stamp);
    this.strokeStamps.push(stamp);
    this.lastStamp = { x: w.x, z: w.z };
    const region = stampRegion(stamp);
    this.strokeRegion = unionRegion(this.strokeRegion, region);
    this.rebuildTerrainRegion(region);
    this.canvasDirty = true;
  }

  private strokeCommit(): void {
    if (this.strokeStamps.length === 0) return;
    const stamps = this.strokeStamps;
    const start = this.strokeStartIndex;
    const region = this.strokeRegion;
    this.strokeStamps = [];
    this.strokeRegion = null;
    if (region) this.viewport3d?.finishTerrainStroke(region);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'sculpt-stroke',
      undo: () => {
        removeSpan(this.map.terrainEdits, start, stamps);
        this.terrainEditsMutated();
        this.refreshTerrain(region);
      },
      redo: () => {
        this.map.terrainEdits.push(...stamps);
        this.terrainEditsMutated();
        this.refreshTerrain(region);
      },
    });
    if (this.autoTexture.enabled && region) this.autoTexturize(region);
  }

  /**
   * Slope-based auto texture (its own undo step, right after the stroke): every
   * paint cell in the sculpted region gets the flat or steep texture by the
   * ground angle at its center. A band id of -1 leaves that band's paint alone,
   * so "rock the cliffs, keep my meadows" works without repainting everything.
   */
  private autoTexturize(region: RegionBox): void {
    const cfg = this.autoTexture;
    // Did WE create the paint grid here? If so, its whole lifetime must be tied
    // to this undo step: a bare ensureBiomeGrid that then paints nothing (or is
    // undone) would otherwise leave a phantom all-255 grid behind.
    const createdGrid = this.map.biomePaint == null;
    this.ensureBiomeGrid();
    const bp = this.map.biomePaint;
    if (!bp) return;
    // The ownership map is keyed by cell index into ONE grid. If the grid was
    // swapped (resampled to a finer cell), the indices no longer line up, so
    // drop ownership: reshaping still updates paint going forward, we just lose
    // "restore the pre-auto texture" for cells painted before the resample.
    if (this.autoTexOwnedGrid !== bp) {
      this.autoTexOwned.clear();
      this.autoTexOwnedGrid = bp;
    }
    // Both bands "leave as is" still needs the loop: cells this tool previously
    // owned whose band is now "leave as is" must be RESTORED, not skipped.
    const owned = this.autoTexOwned;
    const seed = this.map.meta.seed;
    const threshold = Math.tan((Math.min(85, Math.max(5, cfg.angle)) * Math.PI) / 180);
    const c0 = Math.max(0, Math.floor((region.minX - bp.originX) / bp.cell));
    const c1 = Math.min(bp.cols - 1, Math.floor((region.maxX - bp.originX) / bp.cell));
    const r0 = Math.max(0, Math.floor((region.minZ - bp.originZ) / bp.cell));
    const r1 = Math.min(bp.rows - 1, Math.floor((region.maxZ - bp.originZ) / bp.cell));
    // Each change records the id delta AND the ownership delta so undo/redo keep
    // the ownership map consistent with the paint grid.
    const changes: {
      idx: number;
      prev: number;
      next: number;
      ownPrev: number | undefined;
      ownNext: number | undefined;
    }[] = [];
    const eps = bp.cell / 2;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cx = bp.originX + (col + 0.5) * bp.cell;
        const cz = bp.originZ + (row + 0.5) * bp.cell;
        const hx = terrainHeight(cx + eps, cz, seed) - terrainHeight(cx - eps, cz, seed);
        const hz = terrainHeight(cx, cz + eps, seed) - terrainHeight(cx, cz - eps, seed);
        const slope = Math.hypot(hx, hz) / (2 * eps);
        const desired = slope > threshold ? cfg.steepId : cfg.flatId;
        const idx = row * bp.cols + col;
        const cur = bp.ids[idx];
        const ownPrev = owned.get(idx);
        if (desired >= 0) {
          // Paint the band's texture; remember the cell's ORIGINAL (pre-auto)
          // id so a later reshape can undo the auto paint.
          if (cur === desired) continue;
          const base = ownPrev !== undefined ? ownPrev : cur;
          changes.push({
            idx,
            prev: cur,
            next: desired,
            ownPrev,
            ownNext: base,
          });
          bp.ids[idx] = desired;
          owned.set(idx, base);
        } else if (ownPrev !== undefined) {
          // "Leave as is" band, but this tool painted here before: restore the
          // pre-auto texture and release ownership (this is the reshape fix).
          if (cur === ownPrev) {
            owned.delete(idx);
            continue;
          }
          changes.push({
            idx,
            prev: cur,
            next: ownPrev,
            ownPrev,
            ownNext: undefined,
          });
          bp.ids[idx] = ownPrev;
          owned.delete(idx);
        }
      }
    }
    if (changes.length === 0) {
      // Nothing to auto-paint: tear a freshly-created grid back down so it does
      // not linger as an un-undoable empty grid.
      if (createdGrid) {
        this.map.biomePaint = undefined;
        this.activeWorld.biomePaint = undefined;
        this.autoTexOwnedGrid = null;
      }
      return;
    }
    const grid = bp;
    this.refreshTerrain(region);
    this.pushUndo({
      label: 'auto-texture',
      undo: () => {
        for (const ch of changes) {
          grid.ids[ch.idx] = ch.prev;
          if (ch.ownPrev === undefined) owned.delete(ch.idx);
          else owned.set(ch.idx, ch.ownPrev);
        }
        // Detach the grid we created here so undo fully reverses it.
        if (createdGrid) {
          this.map.biomePaint = undefined;
          this.activeWorld.biomePaint = undefined;
        }
        this.refreshTerrain(region);
      },
      redo: () => {
        if (createdGrid) {
          this.map.biomePaint = grid;
          this.activeWorld.biomePaint = grid;
        }
        for (const ch of changes) {
          grid.ids[ch.idx] = ch.next;
          if (ch.ownNext === undefined) owned.delete(ch.idx);
          else owned.set(ch.idx, ch.ownNext);
        }
        this.refreshTerrain(region);
      },
    });
  }

  /** One-click smart retexture: repaints the WHOLE map with builtin textures
   *  chosen per cell from elevation, slope, water-proximity, biome and paths.
   *  Writes editable custom swatches (ground look only, terrain shape/collision
   *  are untouched), so the maker can repaint any of it afterwards. Undoable. */
  autoRetextureMap(): void {
    const b = this.paintBounds();
    const seed = this.map.meta.seed;
    const width = b.maxX - b.minX;
    const depth = b.maxZ - b.minZ;
    if (width <= 0 || depth <= 0) return;
    // Finest affordable cell, then coarsen if the sampling pass would be huge
    // (keeps a one-click retexture responsive on world-size maps). terrainHeight
    // sampling dominates (~7us/cell), so cap cells so the worst case stays ~2s;
    // normal custom maps sit well under this and keep the finest 1yd cell.
    const RETEX_CELL_BUDGET = 350_000;
    let cell = finestPaintCell(width, depth);
    let cols = Math.ceil(width / cell) + 1;
    let rows = Math.ceil(depth / cell) + 1;
    while (cols * rows > RETEX_CELL_BUDGET && cell < 4) {
      cell *= 2;
      cols = Math.ceil(width / cell) + 1;
      rows = Math.ceil(depth / cell) + 1;
    }

    // Palette: one custom swatch per RETEX_SWATCHES entry; id = MIN + index so
    // classifyCell's returned index maps straight onto the minted swatch id.
    const custom: CustomPaintSwatch[] = RETEX_SWATCHES.map((sw, i) => ({
      id: CUSTOM_PAINT_ID_MIN + i,
      color: sw.color,
      label: sw.label,
      textureSha: builtinShaFor(sw.key),
      tileSize: sw.tileSize,
      saved: true,
    }));

    // Town anchors: zone hub plazas + clusters of building placements → cobble.
    const townDiscs: { x: number; z: number; r: number }[] = [];
    for (const zone of this.map.content.zones) {
      if (zone.hub)
        townDiscs.push({ x: zone.hub.x, z: zone.hub.z, r: Math.max(6, zone.hub.radius) });
    }
    for (const p of this.map.placements) {
      if (isTownStructure(p.assetId)) townDiscs.push({ x: p.x, z: p.z, r: 7 });
    }
    const townDistAt = (x: number, z: number): number => {
      let best = Number.POSITIVE_INFINITY;
      for (const d of townDiscs) {
        const dd = Math.hypot(x - d.x, z - d.z) - d.r;
        if (dd < best) best = dd;
      }
      return best;
    };

    const hasRoads = (this.activeWorld.roads?.length ?? 0) > 0;
    const nVar = makeRetexNoise(seed ^ 0x9e3779b1);
    const nPatch = makeRetexNoise((seed ^ 0x85ebca77) | 0);
    const wl = waterLevel();

    // Pass 1: cell-center heights (one terrainHeight call per cell).
    const hgrid = new Float32Array(cols * rows);
    for (let row = 0; row < rows; row++) {
      const cz = b.minZ + (row + 0.5) * cell;
      for (let col = 0; col < cols; col++) {
        hgrid[row * cols + col] = terrainHeight(b.minX + (col + 0.5) * cell, cz, seed);
      }
    }

    // Pass 2: classify. Slope comes from neighbouring cell heights (cheap, and
    // smoother than a per-cell finite difference at this resolution).
    const ids = new Array<number>(cols * rows);
    const inv2cell = 1 / (2 * cell);
    for (let row = 0; row < rows; row++) {
      const cz = b.minZ + (row + 0.5) * cell;
      const rUp = Math.min(rows - 1, row + 1) * cols;
      const rDn = Math.max(0, row - 1) * cols;
      const rMid = row * cols;
      for (let col = 0; col < cols; col++) {
        const cx = b.minX + (col + 0.5) * cell;
        const dhx = hgrid[rMid + Math.min(cols - 1, col + 1)] - hgrid[rMid + Math.max(0, col - 1)];
        const dhz = hgrid[rUp + col] - hgrid[rDn + col];
        ids[rMid + col] =
          CUSTOM_PAINT_ID_MIN +
          classifyCell({
            h: hgrid[rMid + col],
            slope: Math.hypot(dhx, dhz) * inv2cell,
            waterLevel: wl,
            biome: biomeAt(cx, cz),
            roadDist: hasRoads ? roadDistance(cx, cz) : Number.POSITIVE_INFINITY,
            townDist: townDiscs.length ? townDistAt(cx, cz) : Number.POSITIVE_INFINITY,
            nVar: nVar(cx, cz, 1 / 22),
            nPatch: nPatch(cx, cz, 1 / 45),
          });
      }
    }

    const grid: NonNullable<CustomMap['biomePaint']> = {
      cell,
      cols,
      rows,
      originX: b.minX,
      originZ: b.minZ,
      ids,
      custom,
    };
    const prev = this.map.biomePaint;
    const apply = (g: CustomMap['biomePaint']): void => {
      this.map.biomePaint = g;
      this.activeWorld.biomePaint = g;
      refreshCustomGroundTextures();
      this.refreshTerrain(null);
      this.map.meta.updatedAt = now();
      this.inspector.refresh();
    };
    apply(grid);
    this.markDirty();
    this.toasts.info(t('editor.biome.autoRetextureDone', { count: cols * rows }));
    this.pushUndo({
      label: 'auto-retexture',
      undo: () => apply(prev),
      redo: () => apply(grid),
    });
  }

  // ---- named locations / AI markers / point lights ---------------------------------

  /** Overlay + panel refresh shared by every authored-list mutation. */
  private authoredListsChanged(): void {
    this.viewport3d?.refreshAuthoredOverlays();
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.inspector.refresh();
    this.canvasDirty = true;
  }

  /** Zone tool release: name the dragged box and store it as a location. */
  private async finishZoneBox(): Promise<void> {
    const box = this.zoneBox;
    this.zoneStart = null;
    this.zoneBox = null;
    this.viewport3d?.setZonePreview(null);
    if (!box || box.maxX - box.minX < 2 || box.maxZ - box.minZ < 2) return;
    if ((this.map.locations?.length ?? 0) >= MAX_LOCATIONS) return;
    const name = await promptDialog(
      this.root,
      t('editor.zoneTool.namePrompt'),
      t('editor.zoneTool.namePrompt'),
      '',
    );
    if (!name || !name.trim()) return;
    const loc = { name: name.trim().slice(0, MAX_LOCATION_NAME), ...box };
    if (!this.map.locations) this.map.locations = [];
    const list = this.map.locations;
    list.push(loc);
    this.authoredListsChanged();
    this.pushUndo({
      label: 'add-location',
      undo: () => {
        const i = list.indexOf(loc);
        if (i >= 0) list.splice(i, 1);
        this.authoredListsChanged();
      },
      redo: () => {
        list.push(loc);
        this.authoredListsChanged();
      },
    });
  }

  /** Select a map light: bulb badge enlarges + range ring shows in 3D, the
   *  panel highlights the row. Exclusive with the placement selection. */
  private setSelectedLight(index: number | null): void {
    if (index !== null) {
      this.setSelectedPlacement(null);
      this.objectMoves.select(null);
      if (this.selectedSound !== null) {
        this.selectedSound = null;
        this.viewport3d?.setSelectedSound(null);
      }
    }
    this.selectedLight = index;
    this.viewport3d?.setSelectedLight(index);
    this.inspector.refresh();
  }

  private deleteMapLight(index: number): void {
    const list = this.map.lights;
    const light = list?.[index];
    if (!list || !light) return;
    list.splice(index, 1);
    if (this.selectedLight !== null) {
      this.selectedLight =
        this.selectedLight === index
          ? null
          : this.selectedLight > index
            ? this.selectedLight - 1
            : this.selectedLight;
      this.viewport3d?.setSelectedLight(this.selectedLight);
    }
    this.authoredListsChanged();
    this.pushUndo({
      label: 'delete-light',
      undo: () => {
        list.splice(Math.min(index, list.length), 0, light);
        this.authoredListsChanged();
      },
      redo: () => {
        const i = list.indexOf(light);
        if (i >= 0) list.splice(i, 1);
        if (this.selectedLight !== null) {
          this.selectedLight = null;
          this.viewport3d?.setSelectedLight(null);
        }
        this.authoredListsChanged();
      },
    });
  }

  /** Music tool release: assign the panel's selected track to the dragged box
   *  (a click without a real drag does nothing; the map-wide track lives in
   *  the panel). One undoable step. A plain CLICK (no real drag) instead
   *  picks the smallest existing area under the cursor, so rects can be
   *  selected and deleted in-world. */
  private finishMusicBox(): void {
    const box = this.zoneBox;
    this.zoneStart = null;
    this.zoneBox = null;
    this.viewport3d?.setZonePreview(null);
    if (!box) return;
    if (box.maxX - box.minX < 2 || box.maxZ - box.minZ < 2) {
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      this.setSelectedMusicArea(this.musicAreaAt(cx, cz));
      return;
    }
    if (!this.map.music) this.map.music = {};
    const music = this.map.music;
    if (!music.areas) music.areas = [];
    const list = music.areas;
    if (list.length >= MAX_MUSIC_AREAS) {
      this.toasts.error(t('editor.music.areaCap', { max: MAX_MUSIC_AREAS }));
      return;
    }
    const area = { ...box, track: this.musicAreaTrack };
    list.push(area);
    this.setSelectedMusicArea(list.length - 1);
    this.musicChanged();
    this.pushUndo({
      label: 'add-music-area',
      undo: () => {
        const i = list.indexOf(area);
        if (i >= 0) list.splice(i, 1);
        this.setSelectedMusicArea(null);
        this.musicChanged();
      },
      redo: () => {
        list.push(area);
        this.musicChanged();
      },
    });
  }

  /** The smallest music area containing (x, z), or null (matches the game's
   *  smallest-rect-wins playback rule, so you pick what you hear). */
  private musicAreaAt(x: number, z: number): number | null {
    const areas = this.map.music?.areas;
    if (!areas) return null;
    let best: number | null = null;
    let bestSize = Number.POSITIVE_INFINITY;
    for (let i = 0; i < areas.length; i++) {
      const a = areas[i];
      if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
      const size = (a.maxX - a.minX) * (a.maxZ - a.minZ);
      if (size < bestSize) {
        bestSize = size;
        best = i;
      }
    }
    return best;
  }

  /** Select a music area: its rect brightens in 3D, the panel row highlights. */
  private setSelectedMusicArea(index: number | null): void {
    this.selectedMusicArea = index;
    this.viewport3d?.setSelectedMusicArea(index);
    this.inspector.refresh();
  }

  /** Remove one music area (panel x, or Delete/X with one selected): one
   *  undoable step, with the selection kept coherent across the index shift. */
  private deleteMusicArea(index: number): void {
    const list = this.map.music?.areas;
    const area = list?.[index];
    if (!list || !area) return;
    list.splice(index, 1);
    if (this.selectedMusicArea !== null) {
      this.selectedMusicArea =
        this.selectedMusicArea === index
          ? null
          : this.selectedMusicArea > index
            ? this.selectedMusicArea - 1
            : this.selectedMusicArea;
      this.viewport3d?.setSelectedMusicArea(this.selectedMusicArea);
    }
    this.musicChanged();
    this.pushUndo({
      label: 'delete-music-area',
      undo: () => {
        // The list may have been pruned off the document while empty: reattach.
        if (!this.map.music) this.map.music = {};
        if (!this.map.music.areas) this.map.music.areas = list;
        list.splice(Math.min(index, list.length), 0, area);
        this.musicChanged();
      },
      redo: () => {
        const i = list.indexOf(area);
        if (i >= 0) list.splice(i, 1);
        if (this.selectedMusicArea !== null) {
          this.selectedMusicArea = null;
          this.viewport3d?.setSelectedMusicArea(null);
        }
        this.musicChanged();
      },
    });
  }

  /** Every music mutation funnels here: prune empty structures so a default
   *  map stays field-free, then refresh overlays + panel. */
  private musicChanged(): void {
    const m = this.map.music;
    if (m) {
      if (m.areas && m.areas.length === 0) delete m.areas;
      if (!m.zoneTrack && !m.areas) this.map.music = undefined;
    }
    if (this.map.music) this.activeWorld.music = this.map.music;
    else delete this.activeWorld.music;
    this.authoredListsChanged();
  }

  private placeLight(w: Vec2): void {
    if (!this.map.lights) this.map.lights = [];
    const list = this.map.lights;
    if (list.length >= MAX_LIGHTS) {
      this.toasts.error(t('editor.lightTool.capReached', { max: MAX_LIGHTS }));
      return;
    }
    // Bright enough to read clearly against the day rig (decay 1.8 falls off
    // fast, so a timid default just vanished into the sunlight). Campfires run
    // ~12; an authored lamp starts a touch hotter so placing one visibly DOES
    // something even at noon.
    const light = {
      x: Math.round(w.x * 10) / 10,
      z: Math.round(w.z * 10) / 10,
      y: 2,
      color: 0xffb46a,
      intensity: 14,
      range: 32,
    };
    list.push(light);
    this.selectedLight = list.length - 1;
    this.viewport3d?.setSelectedLight(this.selectedLight);
    this.authoredListsChanged();
    this.pushUndo({
      label: 'add-light',
      undo: () => {
        const i = list.indexOf(light);
        if (i >= 0) list.splice(i, 1);
        if (this.selectedLight !== null) {
          this.selectedLight = null;
          this.viewport3d?.setSelectedLight(null);
        }
        this.authoredListsChanged();
      },
      redo: () => {
        list.push(light);
        this.authoredListsChanged();
      },
    });
  }

  /** Select a map point sound: its badge enlarges + radius sphere shows in 3D,
   *  the panel highlights the row. Exclusive with the placement/light selection. */
  private setSelectedSound(index: number | null): void {
    if (index !== null) {
      this.setSelectedPlacement(null);
      this.objectMoves.select(null);
      if (this.selectedLight !== null) {
        this.selectedLight = null;
        this.viewport3d?.setSelectedLight(null);
      }
    }
    this.selectedSound = index;
    this.viewport3d?.setSelectedSound(index);
    this.inspector.refresh();
  }

  private placeSound(w: Vec2): void {
    if (!this.map.pointSounds) this.map.pointSounds = [];
    const list = this.map.pointSounds;
    if (list.length >= MAX_POINT_SOUNDS) {
      this.toasts.error(t('editor.soundTool.capReached', { max: MAX_POINT_SOUNDS }));
      return;
    }
    const sound = {
      x: Math.round(w.x * 10) / 10,
      z: Math.round(w.z * 10) / 10,
      y: 2,
      sound: DEFAULT_POINT_SOUND,
      volume: 0.6,
      radius: 24,
    };
    list.push(sound);
    this.selectedSound = list.length - 1;
    this.viewport3d?.setSelectedSound(this.selectedSound);
    this.authoredListsChanged();
    this.pushUndo({
      label: 'add-point-sound',
      undo: () => {
        const i = list.indexOf(sound);
        if (i >= 0) list.splice(i, 1);
        if (this.selectedSound !== null) {
          this.selectedSound = null;
          this.viewport3d?.setSelectedSound(null);
        }
        this.authoredListsChanged();
      },
      redo: () => {
        list.push(sound);
        this.authoredListsChanged();
      },
    });
  }

  private deleteMapSound(index: number): void {
    const list = this.map.pointSounds;
    const sound = list?.[index];
    if (!list || !sound) return;
    list.splice(index, 1);
    if (this.selectedSound !== null) {
      this.selectedSound =
        this.selectedSound === index
          ? null
          : this.selectedSound > index
            ? this.selectedSound - 1
            : this.selectedSound;
      this.viewport3d?.setSelectedSound(this.selectedSound);
    }
    this.authoredListsChanged();
    this.pushUndo({
      label: 'delete-point-sound',
      undo: () => {
        list.splice(Math.min(index, list.length), 0, sound);
        this.authoredListsChanged();
      },
      redo: () => {
        const i = list.indexOf(sound);
        if (i >= 0) list.splice(i, 1);
        if (this.selectedSound !== null) {
          this.selectedSound = null;
          this.viewport3d?.setSelectedSound(null);
        }
        this.authoredListsChanged();
      },
    });
  }

  /** Select a ground decal: its footprint ring brightens and the panel opens
   *  that stamp's own settings. Exclusive with the placement selection. */
  private setSelectedDecal(index: number | null): void {
    if (index !== null) this.setSelectedPlacement(null);
    this.selectedDecal = index;
    this.viewport3d?.setSelectedDecal(index);
    this.inspector.refresh();
  }

  /** Stamp the current decal brush at `w`. */
  private placeDecal(w: Vec2): void {
    if (!this.map.decals) this.map.decals = [];
    const list = this.map.decals;
    if (list.length >= MAX_DECALS) {
      this.toasts.error(t('editor.decalTool.capReached', { max: MAX_DECALS }));
      return;
    }
    const b = this.decalBrush;
    const decal: MapDecal = {
      x: Math.round(w.x * 100) / 100,
      z: Math.round(w.z * 100) / 100,
      tex: b.tex,
      size: b.size,
      // A random yaw per stamp is what keeps a scattering of the same splat
      // from reading as one image repeated.
      rot: b.randomRotate ? Math.random() * Math.PI * 2 : b.rot,
    };
    if (b.aspect !== 1) decal.aspect = b.aspect;
    if (b.opacity < 1) decal.opacity = b.opacity;
    if (b.color !== 0xffffff) decal.color = b.color;
    if (b.glow > 0) decal.glow = b.glow;
    list.push(decal);
    this.selectedDecal = list.length - 1;
    this.viewport3d?.setSelectedDecal(this.selectedDecal);
    this.authoredListsChanged();
    this.toasts.info(t('editor.decalTool.stamped', { name: decalName(b.tex) }));
    this.pushUndo({
      label: 'add-decal',
      undo: () => {
        const i = list.indexOf(decal);
        if (i >= 0) list.splice(i, 1);
        if (this.selectedDecal !== null) {
          this.selectedDecal = null;
          this.viewport3d?.setSelectedDecal(null);
        }
        this.authoredListsChanged();
      },
      redo: () => {
        list.push(decal);
        this.authoredListsChanged();
      },
    });
  }

  private deleteMapDecal(index: number): void {
    const list = this.map.decals;
    const decal = list?.[index];
    if (!list || !decal) return;
    list.splice(index, 1);
    if (this.selectedDecal !== null) {
      this.selectedDecal =
        this.selectedDecal === index
          ? null
          : this.selectedDecal > index
            ? this.selectedDecal - 1
            : this.selectedDecal;
      this.viewport3d?.setSelectedDecal(this.selectedDecal);
    }
    this.authoredListsChanged();
    this.toasts.info(t('editor.decalTool.removed'));
    this.pushUndo({
      label: 'delete-decal',
      undo: () => {
        list.splice(Math.min(index, list.length), 0, decal);
        this.authoredListsChanged();
      },
      redo: () => {
        const i = list.indexOf(decal);
        if (i >= 0) list.splice(i, 1);
        if (this.selectedDecal !== null) {
          this.selectedDecal = null;
          this.viewport3d?.setSelectedDecal(null);
        }
        this.authoredListsChanged();
      },
    });
  }

  /**
   * Edit one placed stamp (panel sliders). Mutate-and-refresh with no undo
   * entry, matching the other authored-list panels (lights, point sounds):
   * placing and deleting are undoable, tweaking a placed node's values is
   * live. Defaults are stored as ABSENT so a stamp reset to plain carries no
   * dead fields.
   */
  private updateDecal(index: number, patch: Partial<MapDecal>): void {
    const decal = this.map.decals?.[index];
    if (!decal) return;
    Object.assign(decal, patch);
    if (decal.aspect === 1) delete decal.aspect;
    if (decal.opacity !== undefined && decal.opacity >= 1) delete decal.opacity;
    if (decal.color === 0xffffff) delete decal.color;
    if (decal.glow !== undefined && decal.glow <= 0) delete decal.glow;
    if (decal.sort === 0) delete decal.sort;
    this.authoredListsChanged();
  }

  /** Update the Decal tool's "next stamp" settings (never a placed stamp). */
  private setDecalBrush(patch: Partial<DecalBrush>): void {
    this.decalBrush = { ...this.decalBrush, ...patch };
    saveDecalBrush(this.decalBrush);
    this.inspector.refresh();
  }

  /** Pick a library entry to stamp: adopts its authored defaults (footprint,
   *  glow, tint) so a summoning circle lands circle-sized without fiddling. */
  private pickDecalArt(tex: string): void {
    const entry = decalEntry(tex);
    this.setDecalBrush(
      entry ? { tex, size: entry.size, glow: entry.glow, color: entry.tint } : { tex },
    );
  }

  private async importDecal(file: File): Promise<void> {
    try {
      const entry = await importDecalImage(file);
      this.pickDecalArt(entry.tex);
      this.toasts.success(t('editor.decalTool.importedDecal', { name: entry.name }));
    } catch {
      this.toasts.error(t('editor.decalTool.importFailed'));
    }
  }

  private addMarker(w: Vec2): void {
    if (!this.map.markers) this.map.markers = [];
    const list = this.map.markers;
    if (list.length >= MAX_MARKERS) {
      this.toasts.error(t('editor.markerTool.capReached', { max: MAX_MARKERS }));
      return;
    }
    const kindLabel = t(
      this.markerKind === 'object' ? 'editor.markerTool.object' : 'editor.markerTool.npc',
    );
    const marker = {
      name: t('editor.markerTool.defaultName', {
        kind: kindLabel,
        num: formatNumber(list.length + 1, { useGrouping: false }),
      }),
      kind: this.markerKind,
      x: Math.round(w.x * 10) / 10,
      z: Math.round(w.z * 10) / 10,
    };
    list.push(marker);
    this.authoredListsChanged();
    this.pushUndo({
      label: 'add-marker',
      undo: () => {
        const i = list.indexOf(marker);
        if (i >= 0) list.splice(i, 1);
        this.authoredListsChanged();
      },
      redo: () => {
        list.push(marker);
        this.authoredListsChanged();
      },
    });
  }

  private refreshTerrain(region: RegionBox | null): void {
    // Every terrain-affecting undo/redo and batch edit funnels here: the
    // worker meshers must re-clone the content before their next chunk.
    touchActiveWorldContent();
    if (region) {
      this.rebuildTerrainRegion(region);
      this.viewport3d?.finishTerrainStroke(region);
    } else {
      this.viewport3d?.rebuildTerrainFull();
    }
    this.canvasDirty = true;
  }

  // ---- biome paint --------------------------------------------------------------

  private ensureBiomeGrid(): void {
    if (this.map.biomePaint) return;
    const b = this.paintBounds();
    // Adaptive cell: as fine as this map's extent affords (1yd for small maps,
    // 2yd for world-size ones), so strokes stop reading as chunky blocks.
    const cell = finestPaintCell(b.maxX - b.minX, b.maxZ - b.minZ);
    const cols = Math.ceil((b.maxX - b.minX) / cell) + 1;
    const rows = Math.ceil((b.maxZ - b.minZ) / cell) + 1;
    this.map.biomePaint = {
      cell,
      cols,
      rows,
      originX: b.minX,
      originZ: b.minZ,
      ids: new Array(cols * rows).fill(255),
    };
    this.activeWorld.biomePaint = this.map.biomePaint;
    this.paintCreatedGrid = true;
    // The terrain material is chosen by "does this map carry paint" (a painted
    // authored map gets the paint-capable splat material instead of the blank
    // slate). The grid was just born, so the current material predates it and
    // cannot render the stroke, rebuild once, ever, per map.
    this.refreshTerrain(null);
  }

  /** Maps saved with the old coarse 4yd grid upsample (losslessly, nearest
   *  neighbor) to today's finest cell the moment a new stroke starts, so they
   *  get the smooth brush too. One undoable step, pushed BEFORE the stroke. */
  private refineBiomeGridForPainting(): void {
    const coarse = this.map.biomePaint;
    if (!coarse) return;
    const b = this.paintBounds();
    // Upsample only: give legacy over-coarse grids the finer brush. A grid that
    // is already fine (or too fine for the map's current extent) is left for
    // growBiomeGridForPainting to coarsen, so the two never fight over the cell.
    const targetCell = finestPaintCell(b.maxX - b.minX, b.maxZ - b.minZ);
    if (coarse.cell <= targetCell) return;
    const fine = resampleBiomePaint(coarse, targetCell);
    if (!fine) return;
    this.map.biomePaint = fine;
    this.activeWorld.biomePaint = fine;
    this.map.meta.updatedAt = now();
    // Visually identical (same painted footprint), so no terrain rebuild here;
    // the stroke that follows rebuilds its own region.
    this.pushUndo({
      label: 'paint-refine',
      undo: () => {
        this.map.biomePaint = coarse;
        this.activeWorld.biomePaint = coarse;
        this.refreshTerrain(null);
      },
      redo: () => {
        this.map.biomePaint = fine;
        this.activeWorld.biomePaint = fine;
        this.refreshTerrain(null);
      },
    });
  }

  /** A map authored bigger after its first paint stroke (resized world, or a
   *  save from before a zone was appended) keeps its original grid, which
   *  clamps at its edge: painting past it silently does nothing and the
   *  terrain out there renders unpainted. Grow the grid to today's bounds at
   *  stroke start, preserving every painted cell in place. The GPU paint
   *  field is sized/rected to the grid, so growth needs a full refresh NOW
   *  (a region rebake would address the old texture). */
  private growBiomeGridForPainting(): void {
    const old = this.map.biomePaint;
    if (!old) return;
    const b = this.paintBounds();
    // A grid born on a NARROWER/shallower map keeps its (fine) cell size. Growing
    // it to the map's current extent at that cell can blow MAX_BIOME_PAINT_CELLS,
    // and growBiomePaint then REFUSES, stranding the grid at its old edge so the
    // flanks silently reject paint (the "middle strip works, the sides don't"
    // bug on wide maps). Coarsen to the finest cell the FULL extent can afford
    // first, so the grow always fits under the cap and covers every yard the
    // terrain does. A one-time transition: once the grid spans the map, both the
    // resample and the grow below are no-ops on subsequent strokes.
    const targetCell = finestPaintCell(b.maxX - b.minX, b.maxZ - b.minZ);
    const coarsened = old.cell < targetCell ? resampleBiomePaint(old, targetCell) : null;
    const base = coarsened ?? old;
    const grown = growBiomePaint(base, b);
    const next = grown ?? coarsened;
    if (!next) return;
    this.map.biomePaint = next;
    this.activeWorld.biomePaint = next;
    this.map.meta.updatedAt = now();
    this.refreshTerrain(null);
    this.pushUndo({
      label: 'paint-grow',
      undo: () => {
        this.map.biomePaint = old;
        this.activeWorld.biomePaint = old;
        this.refreshTerrain(null);
      },
      redo: () => {
        this.map.biomePaint = next;
        this.activeWorld.biomePaint = next;
        this.refreshTerrain(null);
      },
    });
  }

  /** Sculpt strength in HEIGHT units: the 1..50 slider over a 5x finer scale
   *  than the legacy 1..30 one (slider 5 == legacy 1), for gentle grading. */
  private effectiveBrushStrength(): number {
    return this.brushStrength / 5;
  }

  private paintBegin(w: Vec2): void {
    this.refineBiomeGridForPainting();
    this.growBiomeGridForPainting();
    this.paintChanges = new Map();
    this.paintCreatedGrid = false;
    this.strokeRegion = null;
    this.paintStep(w);
  }

  /** FORK: where the Paint brush lands. Inside a carved cave the pointer ray
   *  strikes the interior wall or floor BEFORE the ground behind it; that hit
   *  is the brush point then, so the cave walls take paint just like the
   *  ground does (the cavity material samples the same paint field). */
  private paintPoint(w: Vec2): Vec2 {
    const ev = this.lastEditPointer;
    const hit = ev ? this.viewport3d?.carveHitAt(ev.x, ev.y) : null;
    if (!hit || !this.viewport3d) return w;
    const ground = { x: w.x, y: terrainHeight(w.x, w.z, this.map.meta.seed), z: w.z };
    const groundDist = this.viewport3d.pickRayDistanceTo(ground);
    const hitDist = this.viewport3d.pickRayDistanceTo(hit);
    return hitDist <= groundDist + 0.5 ? { x: hit.x, z: hit.z } : w;
  }

  private paintStep(w0: Vec2): void {
    const w = this.paintPoint(w0);
    this.ensureBiomeGrid();
    const bp = this.map.biomePaint;
    if (!bp) return;
    const r = this.brushRadius;
    // Photoshop-style hardness: inside hardness*r every cell paints; across
    // the rim the paint DITHERS out with a quadratic falloff (a deterministic
    // per-cell gate, so re-strokes never flicker). The renderer's bilinear
    // feather then melts the dithered rim into a genuinely soft edge.
    const hard = Math.min(1, Math.max(0, this.paintHardness / 100));
    // Optional brush alpha: a grayscale mask across the brush footprint that
    // modulates the stamp coverage (splatter, streaks, ...).
    const alphaMask = brushAlphaById(this.paintAlphaId);
    let touched = false;
    // Coverage per cell (mask, hardness rim, the R2 dither gate) lives in
    // biome_brush_core.ts; it visits only cells that actually change.
    visitBiomeBrushCells(
      bp,
      {
        x: w.x,
        z: w.z,
        radius: r,
        shape: this.paintBrushShape,
        hardness: hard,
        sampleAlpha: alphaMask ? (u, v) => sampleBrushAlpha(alphaMask, u, v) : undefined,
      },
      this.paintBiome,
      (idx) => {
        const change = this.paintChanges.get(idx);
        if (change) change.next = this.paintBiome;
        else this.paintChanges.set(idx, { prev: bp.ids[idx], next: this.paintBiome });
        bp.ids[idx] = this.paintBiome;
        touched = true;
      },
    );
    if (touched) {
      const region = {
        minX: w.x - r,
        minZ: w.z - r,
        maxX: w.x + r,
        maxZ: w.z + r,
      };
      this.strokeRegion = unionRegion(this.strokeRegion, region);
      this.rebuildTerrainRegion(region);
      this.canvasDirty = true;
    }
  }

  /**
   * Eyedropper: read whichever swatch is painted under the cursor and make it
   * the active paint swatch, then switch to the Paint tool so the maker can
   * keep painting with it. Reads the biome grid exactly the way paintStep /
   * bucketFill write it (floor cell math, row-major ids). Unpainted ground
   * (255 sentinel), an off-grid click, or a deleted custom swatch is a no-op
   * with a hint.
   */
  private eyedropAt(w: Vec2): void {
    const bp = this.map.biomePaint;
    let id = -1;
    if (bp) {
      const col = Math.floor((w.x - bp.originX) / bp.cell);
      const row = Math.floor((w.z - bp.originZ) / bp.cell);
      if (col >= 0 && col < bp.cols && row >= 0 && row < bp.rows) {
        id = bp.ids[row * bp.cols + col];
      }
    }
    const isCustom = isCustomPaintId(id);
    if (id < 0 || id === 255 || (isCustom && !bp?.custom?.some((s) => s.id === id))) {
      this.toasts.info(t('editor.eyedropperTool.empty'));
      return;
    }
    this.paintBiome = id;
    this.setTool('paint');
    this.inspector.refresh();
  }

  /**
   * Paint bucket: replace EVERY cell painted with the texture under the
   * cursor by the currently selected swatch, map-wide, as one undo step.
   * Clicking unpainted ground floods the whole unpainted base.
   */
  private bucketFill(w: Vec2): void {
    this.refineBiomeGridForPainting();
    // Grow/coarsen to the full map extent first: without this a fill on the
    // flanks of a wide map lands outside the stranded grid and no-ops (the same
    // "sides don't work" bug the brush had). Match paintBegin's refine->grow.
    this.growBiomeGridForPainting();
    this.ensureBiomeGrid();
    const bp = this.map.biomePaint;
    if (!bp) return;
    const col = Math.floor((w.x - bp.originX) / bp.cell);
    const row = Math.floor((w.z - bp.originZ) / bp.cell);
    if (col < 0 || col >= bp.cols || row < 0 || row >= bp.rows) return;
    const target = bp.ids[row * bp.cols + col];
    if (target === this.paintBiome) return;
    const changes = new Map<number, { prev: number; next: number }>();
    for (let i = 0; i < bp.ids.length; i++) {
      if (bp.ids[i] !== target) continue;
      changes.set(i, { prev: target, next: this.paintBiome });
      bp.ids[i] = this.paintBiome;
    }
    this.bucketArmed = false;
    if (changes.size === 0) {
      this.inspector.refresh();
      return;
    }
    const grid = bp;
    this.refreshTerrain(null);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'paint-bucket',
      undo: () => {
        for (const [idx, ch] of changes) grid.ids[idx] = ch.prev;
        this.refreshTerrain(null);
      },
      redo: () => {
        for (const [idx, ch] of changes) grid.ids[idx] = ch.next;
        this.refreshTerrain(null);
      },
    });
    this.inspector.refresh();
    this.toasts.success(
      t('editor.biome.bucketDone', {
        count: formatNumber(changes.size, { useGrouping: false }),
      }),
    );
  }

  private paintCommit(): void {
    if (this.paintChanges.size === 0 && !this.paintCreatedGrid) return;
    const changes = this.paintChanges;
    const createdGrid = this.paintCreatedGrid;
    const region = this.strokeRegion;
    const grid = this.map.biomePaint;
    this.paintChanges = new Map();
    this.paintCreatedGrid = false;
    this.strokeRegion = null;
    if (region) this.viewport3d?.finishTerrainStroke(region);
    // Paint lands in the shared grid in place; the off-thread meshers only see
    // it once the content generation moves (same trap as terrainEditsMutated).
    touchActiveWorldContent();
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'paint-stroke',
      undo: () => {
        if (createdGrid) {
          this.map.biomePaint = undefined;
          this.activeWorld.biomePaint = undefined;
        } else if (grid) {
          for (const [idx, ch] of changes) grid.ids[idx] = ch.prev;
        }
        this.refreshTerrain(region);
      },
      redo: () => {
        if (createdGrid && grid) {
          this.map.biomePaint = grid;
          this.activeWorld.biomePaint = grid;
        }
        if (grid) for (const [idx, ch] of changes) grid.ids[idx] = ch.next;
        this.refreshTerrain(region);
      },
    });
  }

  /**
   * Add a maker-defined color swatch to the paint palette (stored on the
   * document's biomePaint layer, so it saves/exports with the map) and select
   * it for painting.
   */
  /** Pick a built-in library texture: reuse the map's existing swatch for it
   *  or materialize a new one (builtin: pseudo-sha resolves from the bundle on
   *  every machine, so these default textures always load). */
  private pickBuiltinTexture(key: string): void {
    const set = terrainTextureSet(key);
    if (!set) return;
    const sha = builtinShaFor(key);
    const existing = this.map.biomePaint?.custom?.find((c) => c.textureSha === sha);
    if (existing) {
      this.paintBiome = existing.id;
      this.inspector.refresh();
      return;
    }
    this.addCustomSwatch(set.color, set.name, sha);
  }

  private addCustomSwatch(
    color: number,
    label: string,
    textureSha?: string,
    baseBiome?: number,
  ): CustomPaintSwatch | null {
    this.ensureBiomeGrid();
    const bp = this.map.biomePaint;
    if (!bp) return null;
    if (!bp.custom) bp.custom = [];
    const list = bp.custom;
    if (list.length >= MAX_CUSTOM_PAINT_SWATCHES) {
      this.toasts.error(t('editor.biome.customFull', { max: MAX_CUSTOM_PAINT_SWATCHES }));
      return null;
    }
    const id = nextCustomPaintId(new Set(list.map((s) => s.id)));
    if (id < 0) return null;
    const trimmed = label.trim().slice(0, MAX_SWATCH_LABEL_LENGTH);
    const swatch: CustomPaintSwatch = trimmed ? { id, color, label: trimmed } : { id, color };
    if (textureSha) {
      swatch.textureSha = textureSha;
      swatch.tileSize = DEFAULT_TEXTURE_TILE_YD;
      // Surface depth on by default for a NEW textured swatch. It used to sit
      // at 0 because the old flat AO multiply was worth about +-3% and mostly
      // just brightened the ground; now that it drives real parallax and a
      // micro sun-shadow, off-by-default means every fresh swatch starts life
      // looking like a printed decal. Only new swatches -- an existing map
      // keeps whatever depth its swatches were saved with.
      swatch.depth = DEFAULT_SWATCH_DEPTH;
      // Lava paints molten: flag it so the terrain shader emits light from the
      // hot/orange parts and the bloom pass gives them a glow.
      if (/^builtin:Lava/i.test(textureSha)) swatch.glow = 1;
    }
    if (baseBiome !== undefined) swatch.baseBiome = baseBiome;
    list.push(swatch);
    this.paintBiome = id;
    this.map.meta.updatedAt = now();
    this.markDirty();
    // A textured swatch claims a shader slot the compiled terrain material
    // cannot grow at runtime: rebuild the terrain once so the texture renders
    // for real from the first stroke (this is also what turns a blank map's
    // paint-free material into the paint-capable one).
    if (textureSha) {
      refreshCustomGroundTextures();
      // FORK: the new texture's tile layer goes onto the live material; the
      // 10-15s full rebuild is now only the FIRST textured swatch of a map
      // (a material compiled without the paint path).
      touchActiveWorldContent();
      if (!this.viewport3d?.swapPaintLayers()) this.refreshTerrain(null);
      // Beyond the shader slot budget the extra textured swatches render as
      // their flat color (there is no slot to hold the image). Warn so it is
      // never a silent surprise -- the maker can retire an older texture to
      // free a slot.
      if (paintTextureSlotUsage(list).over > 0) {
        this.toasts.error(t('editor.biome.textureSlotsFull', { max: MAX_PAINT_SLOTS }));
      }
    }
    this.inspector.refresh();
    return swatch;
  }

  /**
   * Hue/light adjust of the ACTIVE paint texture. A custom swatch (imported
   * texture or biome variant) edits its own fields; a built-in biome routes
   * through a custom VARIANT swatch (created on first use, reused after) so
   * the adjust persists in the map document, which stores only swatch ids in
   * the paint grid. Already-painted cells update live via a paint-field
   * rebake, coalesced to one per frame.
   */
  private setPaintAdjust(change: { hueShift?: number; light?: number }): void {
    let createdNow = false;
    let sw = this.map.biomePaint?.custom?.find((c) => c.id === this.paintBiome);
    if (!sw) {
      const base = this.paintBiome;
      const opt = BIOME_OPTIONS.find((o) => o.id === base && o.id !== 255);
      if (!opt) return; // not a paintable built-in and not a custom swatch
      const existing = this.map.biomePaint?.custom?.find((c) => c.baseBiome === base && !c.saved);
      if (existing) {
        sw = existing;
        this.paintBiome = existing.id;
        createdNow = true; // selection changed: refresh AFTER the values land
      } else {
        const label = `${t(opt.labelKey as Parameters<typeof t>[0])} *`;
        const created = this.addCustomSwatch(
          Number.parseInt(opt.swatch.slice(1), 16),
          label,
          undefined,
          base,
        );
        if (!created) return;
        sw = created;
        createdNow = true;
      }
    }
    if (change.hueShift !== undefined) {
      const v = Math.max(-180, Math.min(180, change.hueShift));
      if (v === 0) delete sw.hueShift;
      else sw.hueShift = v;
    }
    if (change.light !== undefined) {
      const v = Math.max(-1, Math.min(1, change.light));
      if (v === 0) delete sw.light;
      else sw.light = v;
    }
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.schedulePaintAdjustRebake();
    // A variant created THIS call was refreshed (inside addCustomSwatch)
    // before the slider value landed on it; refresh again so the panel
    // renders the actual adjust rather than a centered slider.
    if (createdNow) this.inspector.refresh();
  }

  /**
   * Copy the ACTIVE adjusted swatch (biome variant or tinted import) into its
   * own saved swatch, so the tint can be reused after the working sliders
   * move on. The copy is selected for painting; `saved` keeps the biome
   * sliders' auto-variant reuse from ever mutating it.
   */
  private saveAdjustedSwatch(): void {
    const sw = this.map.biomePaint?.custom?.find((c) => c.id === this.paintBiome);
    if (!sw || (!sw.hueShift && !sw.light)) return;
    const base = (sw.label ?? '').replace(/ \*$/, '');
    const hue = sw.hueShift ?? 0;
    const light = Math.round((sw.light ?? 0) * 100);
    const parts = [
      hue !== 0 ? `${hue > 0 ? '+' : ''}${hue}?` : '',
      light !== 0 ? `${light > 0 ? '+' : ''}${light}` : '',
    ];
    const label = `${base} ${parts.filter(Boolean).join(' ')}`.trim();
    const created = this.addCustomSwatch(sw.color, label, sw.textureSha, sw.baseBiome);
    if (!created) return;
    created.saved = true;
    if (sw.hueShift !== undefined) created.hueShift = sw.hueShift;
    if (sw.light !== undefined) created.light = sw.light;
    if (sw.tileSize !== undefined) created.tileSize = sw.tileSize;
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.schedulePaintAdjustRebake();
    this.inspector.refresh();
    this.toasts.info(t('editor.biome.swatchSaved', { name: label }));
  }

  /**
   * Remove a custom paint swatch (imported texture or saved biome variant) from
   * the map. Every cell painted with it reverts to unpainted base (id 255) so
   * the terrain updates immediately AND the freed swatch id can never be
   * inherited by a later import that reuses it. Undoable; frees the textured-
   * swatch atlas slot when the swatch carried an image.
   */
  private deleteCustomSwatch(id: number): void {
    const bp = this.map.biomePaint;
    const list = bp?.custom;
    if (!bp || !list) return;
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const [removed] = list.splice(idx, 1);
    // Revert cells painted with this swatch; remember them so undo repaints exactly.
    const cleared: number[] = [];
    for (let i = 0; i < bp.ids.length; i++) {
      if (bp.ids[i] === id) {
        bp.ids[i] = 255;
        cleared.push(i);
      }
    }
    const prevPaint = this.paintBiome;
    if (this.paintBiome === id) this.paintBiome = 0;
    this.activeWorld.biomePaint = this.map.biomePaint;
    this.map.meta.updatedAt = now();
    this.markDirty();
    refreshCustomGroundTextures();
    this.refreshTerrain(null);
    this.inspector.refresh();
    const name = removed.label ?? `#${removed.color.toString(16).padStart(6, '0')}`;
    this.toasts.info(t('editor.biome.swatchRemoved', { name }));
    this.pushUndo({
      label: 'delete-biome-swatch',
      undo: () => {
        list.splice(idx, 0, removed);
        for (const i of cleared) bp.ids[i] = id;
        this.paintBiome = prevPaint;
        this.activeWorld.biomePaint = this.map.biomePaint;
        refreshCustomGroundTextures();
        this.refreshTerrain(null);
        this.inspector.refresh();
      },
      redo: () => {
        const j = list.findIndex((s) => s.id === id);
        if (j >= 0) list.splice(j, 1);
        for (const i of cleared) bp.ids[i] = 255;
        if (this.paintBiome === id) this.paintBiome = 0;
        this.activeWorld.biomePaint = this.map.biomePaint;
        refreshCustomGroundTextures();
        this.refreshTerrain(null);
        this.inspector.refresh();
      },
    });
  }

  // Coalesce slider ticks into one full paint-field rebake per frame (the
  // rebake is the expensive part; range inputs can fire far faster).
  private paintAdjustRebakeQueued = false;
  private schedulePaintAdjustRebake(): void {
    if (this.paintAdjustRebakeQueued) return;
    this.paintAdjustRebakeQueued = true;
    requestAnimationFrame(() => {
      this.paintAdjustRebakeQueued = false;
      rebakePaintFieldSwatches();
      this.canvasDirty = true;
    });
  }

  /** Tile size (yards per repeat) of a textured custom swatch. */
  private setSwatchTileSize(id: number, tileSize: number): void {
    const sw = this.map.biomePaint?.custom?.find((c) => c.id === id);
    if (!sw) return;
    sw.tileSize = Math.min(64, Math.max(1, tileSize));
    this.map.meta.updatedAt = now();
    this.markDirty();
    // Same palette, new data: the live field/tile-size path shows it without
    // a terrain rebuild.
    rebakePaintFieldSwatches();
    this.canvasDirty = true;
  }

  /** Anti-tiling amount for one painted swatch, 0..1. Zero is stored as
   *  ABSENT so an untouched document keeps the cheap single-tap path. */
  private setSwatchVariation(id: number, variation: number): void {
    const sw = this.map.biomePaint?.custom?.find((c) => c.id === id);
    if (!sw) return;
    const v = Math.min(1, Math.max(0, variation));
    if (v <= 0) delete sw.variation;
    else sw.variation = v;
    this.map.meta.updatedAt = now();
    this.markDirty();
    // Same palette, new per-slot value: the live swatch path shows it with no
    // terrain rebuild, exactly like tile size.
    rebakePaintFieldSwatches();
    this.canvasDirty = true;
  }

  /** Surface depth (AO shading) for one painted swatch, 0..1. Zero stored as
   *  ABSENT so an untouched document never takes the extra AO tap. */
  private setSwatchDepth(id: number, depth: number): void {
    const sw = this.map.biomePaint?.custom?.find((c) => c.id === id);
    if (!sw) return;
    const v = Math.min(1, Math.max(0, depth));
    if (v <= 0) delete sw.depth;
    else sw.depth = v;
    this.map.meta.updatedAt = now();
    this.markDirty();
    rebakePaintFieldSwatches();
    this.canvasDirty = true;
  }

  /** How paint boundaries look, map-wide (BiomePaint.edgeSoftness /
   *  edgeDetail). Both live on the paint layer rather than on a swatch: the
   *  warp displaces the lookup BEFORE the swatch under the fragment is known,
   *  so there is no per-swatch answer to give. */
  private getPaintEdge(): { softness: number; detail: number } {
    const bp = this.map.biomePaint;
    return {
      softness: bp?.edgeSoftness ?? DEFAULT_PAINT_EDGE_SOFTNESS,
      detail: bp?.edgeDetail ?? DEFAULT_PAINT_EDGE_DETAIL,
    };
  }

  private setPaintEdge(change: Partial<{ softness: number; detail: number }>): void {
    this.ensureBiomeGrid();
    const bp = this.map.biomePaint;
    if (!bp) return;
    const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
    if (change.softness !== undefined) bp.edgeSoftness = clamp01(change.softness);
    if (change.detail !== undefined) bp.edgeDetail = clamp01(change.detail);
    this.map.meta.updatedAt = now();
    this.markDirty();
    // The interior bit is baked against this reach (paintEdgeParams), so the
    // FIELD has to be re-filled, not just the uniform -- which is exactly what
    // the live swatch path already does.
    rebakePaintFieldSwatches();
    this.canvasDirty = true;
  }

  /** Update the per-map auto-texturing rules; only explicit FALSE flags are
   *  stored so a default map keeps no terrainStyle field at all. */
  private setTerrainStyle(
    change: Partial<{
      slopeRock: boolean;
      snowCaps: boolean;
      rimMountains: boolean;
      shoreSand: boolean;
      scree: boolean;
    }>,
  ): void {
    const merged = { ...(this.map.terrainStyle ?? {}), ...change };
    const next: TerrainStyle = {};
    if (merged.slopeRock === false) next.slopeRock = false;
    if (merged.snowCaps === false) next.snowCaps = false;
    if (merged.rimMountains === false) next.rimMountains = false;
    if (merged.shoreSand === false) next.shoreSand = false;
    if (merged.scree === false) next.scree = false;
    if (merged.motes === true) next.motes = true;
    this.map.terrainStyle = Object.keys(next).length > 0 ? next : undefined;
    if (this.map.terrainStyle) this.activeWorld.terrainStyle = this.map.terrainStyle;
    else delete this.activeWorld.terrainStyle;
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.refreshTerrain(null);
    this.inspector.refresh();
  }

  /** Ambience "world speed" (cosmetic motion only): stored on the document (so
   *  playtest inherits it) and pushed live to the editor preview. 1 = normal. */
  private setWorldSpeed(v: number): void {
    const clamped = Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, v));
    if (clamped === 1) delete this.map.timeScale;
    else this.map.timeScale = clamped;
    if (clamped === 1) delete this.activeWorld.timeScale;
    else this.activeWorld.timeScale = clamped;
    this.viewport3d?.setWorldSpeed(clamped);
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.inspector.refresh();
  }

  /** Placed-asset view distance (render-only perf knob): stored on the document
   *  so playtest inherits it, and pushed live to the editor preview. */
  private setAssetViewDistance(v: number): void {
    const clamped = Math.min(MAX_ASSET_VIEW_DISTANCE, Math.max(MIN_ASSET_VIEW_DISTANCE, v));
    if (clamped === DEFAULT_ASSET_VIEW_DISTANCE) delete this.map.assetViewDistance;
    else this.map.assetViewDistance = clamped;
    if (clamped === DEFAULT_ASSET_VIEW_DISTANCE) delete this.activeWorld.assetViewDistance;
    else this.activeWorld.assetViewDistance = clamped;
    this.viewport3d?.setAssetViewDistance(clamped);
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.inspector.refresh();
  }

  /** Clearing every painted cell is destructive: confirm before firing. */
  private async confirmClearBiomePaint(): Promise<void> {
    if (!this.map.biomePaint) return;
    const ok = await confirmDialog(this.root, {
      title: t('editor.biome.clear'),
      body: t('editor.biome.clearConfirm'),
      danger: true,
    });
    if (ok) this.clearBiomePaint();
  }

  private clearBiomePaint(): void {
    const grid = this.map.biomePaint;
    if (!grid) return;
    this.map.biomePaint = undefined;
    this.activeWorld.biomePaint = undefined;
    this.map.meta.updatedAt = now();
    this.refreshTerrain(null);
    this.pushUndo({
      label: 'clear-biome-paint',
      undo: () => {
        this.map.biomePaint = grid;
        this.activeWorld.biomePaint = grid;
        this.refreshTerrain(null);
      },
      redo: () => {
        this.map.biomePaint = undefined;
        this.activeWorld.biomePaint = undefined;
        this.refreshTerrain(null);
      },
    });
  }

  // ---- blocker walls ---------------------------------------------------------------

  private clearBlockerDraft(): void {
    this.blockerStart = null;
    if (this.blockerPreview) {
      this.blockerPreview = null;
      this.viewport3d?.setBlockerPreview(null);
      this.canvasDirty = true;
    }
  }

  /** Release of a blocker drag: store the previewed segment (already length-
   *  clamped by the preview step); a sub-minimum drag cancels silently. */
  private commitBlocker(): void {
    const seg = this.blockerPreview;
    this.clearBlockerDraft();
    if (!seg) return;
    const blockers = this.blockersRef();
    if (blockers.length >= MAX_BLOCKERS) {
      this.toasts.error(t('editor.status.blockerCapReached', { max: MAX_BLOCKERS }));
      return;
    }
    blockers.push(seg);
    this.blockersMutated();
    this.inspector.refresh(); // the blocker panel's count readout
    this.pushUndo({
      label: 'add-blocker',
      undo: () => {
        const list = this.blockersRef();
        const i = list.indexOf(seg);
        if (i >= 0) list.splice(i, 1);
        this.blockersMutated();
        this.inspector.refresh();
      },
      redo: () => {
        this.blockersRef().push(seg);
        this.blockersMutated();
        this.inspector.refresh();
      },
    });
  }

  private removeBlockerAt(index: number): void {
    const blockers = this.blockersRef();
    const seg = blockers[index];
    if (!seg) return;
    blockers.splice(index, 1);
    this.blockersMutated();
    this.inspector.refresh();
    this.pushUndo({
      label: 'erase-blocker',
      undo: () => {
        this.blockersRef().splice(index, 0, seg);
        this.blockersMutated();
        this.inspector.refresh();
      },
      redo: () => {
        this.blockersRef().splice(index, 1);
        this.blockersMutated();
        this.inspector.refresh();
      },
    });
  }

  // ---- erase -----------------------------------------------------------------------

  private eraseAt(w: Vec2): void {
    // Throttle drag erasing so one sweep does not delete a whole cluster at once.
    if (this.eraseLast) {
      const dx = w.x - this.eraseLast.x;
      const dz = w.z - this.eraseLast.z;
      if (dx * dx + dz * dz < 4) return;
    }
    this.eraseLast = { x: w.x, z: w.z };
    const pi = erasePlacementIndex(this.map.placements, w.x, w.z, this.brushRadius);
    if (pi >= 0) {
      this.removePlacementAt(pi);
      return;
    }
    // Blocker walls next, with a tight threshold. Erase deliberately never
    // touches terrain stamps: on flat authoring maps the flatness itself is
    // leveling stamps, so a stamp eraser quietly cratered the landscape.
    // Sculpt mistakes are what Undo is for.
    const bi = nearestBlockerIndex(this.map.blockers ?? [], w.x, w.z);
    if (bi >= 0) this.removeBlockerAt(bi);
  }

  // ---- placements ----------------------------------------------------------------

  private placeAt(w: Vec2): void {
    if (!this.placeAssetId) {
      this.toasts.info(t('editor.status.assetPlacedFirst'));
      return;
    }
    const placement: AssetPlacement = {
      assetId: this.placeAssetId,
      x: w.x,
      z: w.z,
      rotY: this.placeRandomRot ? Math.random() * Math.PI * 2 : this.placeRotation,
      scale: this.placeScale,
      collide: this.placeCollide,
    };
    // A saved hitbox preset for this asset (this device) is the maker's word:
    // every fresh placement copies those boxes.
    const preset = this.hitboxPresets[this.placeAssetId];
    if (this.placeCollide && preset && preset.length > 0) {
      placement.hitboxes = preset.map((b) => ({ ...b }));
    } else {
      // No preset: stamp the simple-collision default (fitted box or radius
      // circle for solid props; walkable/pass-through assets keep their bake).
      applyDefaultCollision(placement);
    }
    this.appendPlacements([placement], 'place-asset');
    // A fresh placement lands selected under the Move gizmo (Blender flow);
    // the cap may have rejected it, so only when it actually landed.
    const index = this.map.placements.lastIndexOf(placement);
    if (index >= 0) {
      this.setSelectedPlacement(index);
      this.setTool('move');
    }
  }

  private appendPlacements(placements: AssetPlacement[], label: string): void {
    const clamp = clampToCap(placements, this.map.placements.length, MAX_PLACEMENTS);
    if (clamp.truncated) {
      this.toasts.error(t('editor.status.placementCapReached', { max: MAX_PLACEMENTS }));
    }
    const accepted = clamp.accepted;
    if (accepted.length === 0) return;
    // Every creation path (including duplicate/paste/procgen) gets the same
    // asset collision defaults as a normal click placement. Existing explicit
    // modes are preserved verbatim by cloneAssetPlacement.
    for (const placement of accepted) {
      if (placement.collide && placement.collisionMode === undefined) {
        // Legacy hand-edited boxes/decks already mean baked collision even
        // before the mode field existed. Preserve that stronger source truth.
        if (placement.hitboxes?.length || placement.ramps?.length) {
          placement.collisionMode = 'baked';
        } else {
          applyDefaultCollision(placement);
        }
      }
    }
    const start = appendSpan(this.map.placements, accepted);
    for (let i = 0; i < accepted.length; i++) this.viewport3d?.placementAdded(start + i);
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    this.pushUndo({
      label,
      undo: () => {
        removeSpan(this.map.placements, start, accepted);
        this.setSelectedPlacement(null);
        this.viewport3d?.rebuildPlacements();
        this.refreshCaveGuides();
        this.refreshRockGuides();
        this.canvasDirty = true;
      },
      redo: () => {
        this.map.placements.push(...accepted);
        this.viewport3d?.rebuildPlacements();
        this.refreshCaveGuides();
        this.refreshRockGuides();
        this.canvasDirty = true;
      },
    });
    this.refreshCaveGuides();
    this.refreshRockGuides();
  }

  // ---- City Build workspace ----------------------------------------------------

  private cityClick(w: Vec2, ev?: PointerEvent): void {
    switch (this.citySubtool) {
      case 'kit':
        this.cityPlaceKit(w);
        break;
      case 'wall':
        this.cityAddPathPoint(this.cityWallPoints, w, ev, true);
        break;
      case 'road':
        if (this.cityRoadMode === 'edit') this.cityRoadEditPress(w);
        else this.cityAddPathPoint(this.cityRoadPoints, w, ev, false);
        break;
      case 'prefab':
        this.cityStampArmedPrefab(w);
        break;
      case 'route':
        this.cityRouteClick(w, ev);
        break;
    }
  }

  private citySnap(w: Vec2): { x: number; z: number } {
    return snapPoint(w, this.citySettings.gridSize);
  }

  private setCitySettings(settings: CityBuildSettings): void {
    const next = sanitizeCitySettings(settings);
    // Turning Connect tiles off (or resizing pieces) drops the height anchor:
    // the next tile re-seats on terrain and starts a fresh level.
    if (
      next.tileSnap !== this.citySettings.tileSnap ||
      next.kitScale !== this.citySettings.kitScale
    ) {
      this.cityTileLevel = null;
    }
    this.citySettings = next;
    writeJsonPref(CITY_SETTINGS_PREF_KEY, this.citySettings);
  }

  /**
   * The snapped drop point for the armed kit piece. With Connect tiles on and
   * the piece's measured footprint cached, centers snap onto the piece's own
   * pitch lattice so modules butt together edge to edge; otherwise the world
   * grid applies (and the footprint measure is kicked off for next time).
   */
  private cityKitPoint(w: Vec2): { x: number; z: number } {
    const s = this.citySettings;
    if (s.tileSnap && this.placeAssetId) {
      const fp = this.cityFootprints.get(this.placeAssetId);
      if (fp) return tileSnapPoint(w, fp, s.kitScale, snapAngleRad(this.cityKitRot, s.rotSnapDeg));
      void this.cityFootprint(this.placeAssetId);
    }
    return this.citySnap(w);
  }

  private cityPlaceKit(w: Vec2): void {
    if (!this.placeAssetId) {
      this.toasts.info(t('editor.status.assetPlacedFirst'));
      return;
    }
    const p = this.cityKitPoint(w);
    const placement: AssetPlacement = {
      assetId: this.placeAssetId,
      x: p.x,
      z: p.z,
      rotY: snapAngleRad(this.cityKitRot, this.citySettings.rotSnapDeg),
      scale: this.citySettings.kitScale,
      collide: this.placeCollide,
    };
    // Connect tiles: the first tile sets the level; the rest join it on the
    // same height axis, so a floor stays flat across bumpy ground.
    if (this.citySettings.tileSnap && this.cityFootprints.get(this.placeAssetId)) {
      if (this.cityTileLevel === null) {
        this.cityTileLevel = terrainHeight(p.x, p.z, this.map.meta.seed);
      }
      placement.detached = true;
      placement.groundY = this.cityTileLevel;
    }
    const preset = this.hitboxPresets[this.placeAssetId];
    if (this.placeCollide && preset && preset.length > 0) {
      placement.hitboxes = preset.map((b) => ({ ...b }));
    } else {
      applyDefaultCollision(placement);
    }
    // Unlike the Place tool, kit placement stays armed for repeat placement.
    this.appendPlacements([placement], 'city-kit');
  }

  /** Rotate the armed kit ghost by one rotation-snap step (the R key). */
  private cityRotateKit(): void {
    const step = (this.citySettings.rotSnapDeg * Math.PI) / 180;
    this.cityKitRot = (this.cityKitRot + step) % (Math.PI * 2);
  }

  private cityAddPathPoint(
    points: Vec2[],
    w: Vec2,
    ev: PointerEvent | undefined,
    snap: boolean,
  ): void {
    const p = snap ? this.citySnap(w) : { x: w.x, z: w.z };
    const tolerance = snap ? Math.max(0.04, this.citySettings.gridSize * 0.15) : 0.2;
    // Re-clicking a visible node never adds a zero-length edge. The second
    // click of a double-click finishes from that node.
    if (pathHasNode(points, p, tolerance)) {
      if (ev && ev.detail >= 2 && points.length >= 2) this.cityFinishActivePath();
      return;
    }
    points.push({ x: p.x, z: p.z });
    if (ev && ev.detail >= 2 && points.length >= 2) {
      this.cityFinishActivePath();
      return;
    }
    this.citySyncPathPreview(w);
    this.inspector.refresh();
  }

  private cityFinishActivePath(): void {
    if (this.citySubtool === 'wall') this.cityFinishWall();
    else if (this.citySubtool === 'road') this.cityFinishRoad();
    else if (this.citySubtool === 'route') this.cityFinishRoute();
  }

  private cityCancelActivePath(): void {
    if (this.citySubtool === 'wall') this.cityWallPoints = [];
    else if (this.citySubtool === 'road') this.cityRoadPoints = [];
    else if (this.citySubtool === 'route') {
      this.cityRouteNpcKey = null;
      this.cityRoutePoints = [];
    }
    this.viewport3d?.setCityPathPreview(null);
    this.inspector.refresh();
  }

  /** Remove exactly one authored node from the active city path. */
  private cityUndoActivePathPoint(): void {
    if (this.citySubtool === 'wall') {
      this.cityWallPoints = withoutLastPathPoint(this.cityWallPoints);
    } else if (this.citySubtool === 'road') {
      this.cityRoadPoints = withoutLastPathPoint(this.cityRoadPoints);
    } else if (this.citySubtool === 'route') {
      this.cityRoutePoints = withoutLastPathPoint(this.cityRoutePoints);
    } else {
      return;
    }
    this.citySyncPathPreview();
    this.inspector.refresh();
  }

  /** The polyline preview for whichever city subtool is mid-draw. */
  private citySyncPathPreview(cursor?: Vec2): void {
    const v = this.viewport3d;
    if (!v) return;
    if (this.citySubtool === 'road' && this.cityRoadMode === 'edit') {
      this.roadEdit.syncPreview();
      return;
    }
    let pts: { x: number; z: number }[] | null = null;
    let color = 0xf3c96b;
    if (this.citySubtool === 'wall' && this.cityWallPoints.length > 0) {
      pts = cursor ? [...this.cityWallPoints, this.citySnap(cursor)] : [...this.cityWallPoints];
    } else if (this.citySubtool === 'road' && this.cityRoadPoints.length > 0) {
      pts = cursor ? [...this.cityRoadPoints, { ...cursor }] : [...this.cityRoadPoints];
      color = 0xd9a066;
    } else if (this.citySubtool === 'route' && this.cityRoutePoints.length > 0) {
      pts = cursor ? [...this.cityRoutePoints, { ...cursor }] : [...this.cityRoutePoints];
      color = 0x6db3f2;
    }
    v.setCityPathPreview(pts, color);
  }

  /** Measured world-yard footprint for a catalogue asset (cached). */
  private async cityFootprint(
    assetId: string,
  ): Promise<{ sizeX: number; sizeZ: number; sizeY: number } | null> {
    const cached = this.cityFootprints.get(assetId);
    if (cached) return cached;
    const path = assetById(assetId)?.path;
    if (!path || !this.viewport3d) return null;
    const fp = await this.viewport3d.cityAssetFootprint(path);
    if (fp) this.cityFootprints.set(assetId, fp);
    return fp;
  }

  private cityWallDefinition(
    id: string,
    points: readonly { x: number; z: number }[],
    style = wallStyleById(this.cityWallStyle),
  ): WallRunDef {
    const def: WallRunDef = {
      id,
      points: points.map((point) => ({ ...point })),
      segmentAssetId: style.segmentAssetId,
      scale: this.cityWallScale,
      heightScale: this.cityWallHeight,
      thicknessScale: this.cityWallThickness,
      postEvery: this.cityWallPostEvery,
    };
    if (style.postAssetId) def.postAssetId = style.postAssetId;
    if (this.cityWallClosed && points.length > 2) def.closed = true;
    if (this.cityWallWalkTop) def.walkTop = true;
    if (this.cityWallWalkTop && this.cityWallStairs && style.stairAssetId) {
      def.stairs = true;
      def.stairAssetId = style.stairAssetId;
    }
    return def;
  }

  /**
   * Materialize one wall definition. Runtime model bounds are preferred, but
   * every shipped style has normalized fallback bounds so a slow or unreadable
   * GLB can never turn the Finish action into a silent no-op.
   */
  private async cityBuildWallPlacements(
    def: WallRunDef,
    style: ReturnType<typeof wallStyleById>,
  ): Promise<AssetPlacement[]> {
    const segFp = wallFootprintOrFallback(
      style,
      style.segmentAssetId,
      await this.cityFootprint(style.segmentAssetId),
    );
    if (!segFp) return [];
    const postFp = style.postAssetId
      ? wallFootprintOrFallback(
          style,
          style.postAssetId,
          await this.cityFootprint(style.postAssetId),
        )
      : null;
    const stairFp = style.stairAssetId
      ? wallFootprintOrFallback(
          style,
          style.stairAssetId,
          await this.cityFootprint(style.stairAssetId),
        )
      : null;
    const pieces = generateWallPieces(def, segFp, postFp ?? undefined);
    const placements = wallPiecesToPlacements(def, pieces) as AssetPlacement[];
    for (const placement of placements) applyDefaultCollision(placement);
    // Rampart decks: a flat walkable top on every wall piece. Stairs bridge
    // from terrain to the shaped wall height.
    const topModel = wallTopModelY(placements[0]?.hitboxes, segFp.sizeY ?? 2.2);
    if (def.walkTop) {
      for (let i = 0; i < placements.length; i++) {
        const fp = pieces[i].kind === 'post' && postFp ? postFp : segFp;
        placements[i].ramps = wallTopRamps(placements[i].hitboxes, fp);
      }
    }
    // Walk-through towers: corner posts using the arcade tower rescale so the
    // arcade floor sits exactly on the wall's walk height, carry the authored
    // shaft/pillar/roof collision (open bays between), and deck their floor so
    // the rampart path runs straight through the tower top.
    if (def.postAssetId === WALL_TOWER_ASSET) {
      const wallTopWorld = topModel * def.scale * (def.heightScale ?? 1);
      const fit = wallTowerFit(wallTopWorld);
      for (let i = 0; i < placements.length; i++) {
        if (pieces[i]?.kind !== 'post') continue;
        placements[i].scale = fit.scale;
        placements[i].collide = true;
        placements[i].collisionMode = 'baked';
        placements[i].hitboxes = fit.hitboxes.map((b) => ({ ...b }));
        if (def.walkTop) placements[i].ramps = fit.ramps.map((r) => ({ ...r }));
        else delete placements[i].ramps;
      }
    }
    if (def.stairs && stairFp) {
      // Past the tower shaft at open ends, so the stair's top half is never
      // buried inside the (much larger) walk-through tower.
      const endClearance =
        def.postAssetId === WALL_TOWER_ASSET
          ? WALL_TOWER_SRC.shaftHalf *
            wallTowerFit(topModel * def.scale * (def.heightScale ?? 1)).scale
          : 0;
      const stairPieces = generateWallStairs(def, stairFp, topModel, endClearance);
      placements.push(...(wallPiecesToPlacements(def, stairPieces) as AssetPlacement[]));
    }
    return placements;
  }

  private cityReplaceWallPlacements(cityId: string, placements: AssetPlacement[]): void {
    const indices = cityPlacementIndices(this.map.placements, cityId);
    const insertAt = indices[0] ?? this.map.placements.length;
    for (let i = indices.length - 1; i >= 0; i--) this.map.placements.splice(indices[i], 1);
    this.map.placements.splice(Math.min(insertAt, this.map.placements.length), 0, ...placements);
    this.setSelectedPlacement(null);
    this.viewport3d?.rebuildPlacements();
    this.canvasDirty = true;
  }

  private cityAdoptWall(def: WallRunDef): void {
    const style =
      WALL_STYLES.find((candidate) => candidate.segmentAssetId === def.segmentAssetId) ??
      WALL_STYLES[0];
    this.cityActiveWallId = def.id;
    this.cityWallStyle = style.id;
    this.cityWallScale = def.scale;
    this.cityWallHeight = def.heightScale ?? 1;
    this.cityWallThickness = def.thicknessScale ?? 1;
    this.cityWallPostEvery = def.postEvery;
    this.cityWallClosed = def.closed === true;
    this.cityWallWalkTop = def.walkTop === true;
    this.cityWallStairs = def.stairs === true;
    if (!this.cityWallRuntime.has(def.id)) {
      this.cityWallRuntime.set(def.id, {
        def,
        placements: cityPlacementIndices(this.map.placements, def.id).map(
          (index) => this.map.placements[index],
        ),
      });
    }
  }

  /** Rebuild the last-created or selected wall from the live panel controls. */
  private cityRefreshActiveWall(): void {
    const id = this.cityActiveWallId;
    if (!id || this.cityWallPoints.length > 0 || this.cityWallFinishing) return;
    const map = this.map;
    const run = map.wallRuns?.find((candidate) => candidate.id === id);
    if (!run) {
      this.cityActiveWallId = null;
      return;
    }
    const style = wallStyleById(this.cityWallStyle);
    const nextDef = this.cityWallDefinition(id, run.points, style);
    const revision = ++this.cityWallUpdateRevision;
    void this.cityBuildWallPlacements(nextDef, style).then((placements) => {
      if (
        revision !== this.cityWallUpdateRevision ||
        map !== this.map ||
        !map.wallRuns?.includes(run) ||
        placements.length === 0
      ) {
        return;
      }
      const oldCount = cityPlacementIndices(map.placements, id).length;
      if (map.placements.length - oldCount + placements.length > MAX_PLACEMENTS) {
        this.toasts.error(t('editor.status.placementCapReached', { max: MAX_PLACEMENTS }));
        return;
      }
      run.points = nextDef.points;
      run.segmentAssetId = nextDef.segmentAssetId;
      run.scale = nextDef.scale;
      run.heightScale = nextDef.heightScale;
      run.thicknessScale = nextDef.thicknessScale;
      run.postEvery = nextDef.postEvery;
      if (nextDef.postAssetId) run.postAssetId = nextDef.postAssetId;
      else delete run.postAssetId;
      if (nextDef.stairAssetId) run.stairAssetId = nextDef.stairAssetId;
      else delete run.stairAssetId;
      if (nextDef.closed) run.closed = true;
      else delete run.closed;
      if (nextDef.walkTop) run.walkTop = true;
      else delete run.walkTop;
      if (nextDef.stairs) run.stairs = true;
      else delete run.stairs;
      this.cityReplaceWallPlacements(id, placements);
      const state = this.cityWallRuntime.get(id);
      if (state) {
        state.def = run;
        state.placements = placements;
      } else {
        this.cityWallRuntime.set(id, { def: run, placements });
      }
      map.meta.updatedAt = now();
      this.markDirty();
    });
  }

  private cityFinishWall(): void {
    const points = this.cityWallPoints.map((point) => ({ ...point }));
    if (points.length < 2) {
      this.toasts.info(t('editor.city.wallTooShort'));
      return;
    }
    if (this.cityWallFinishing) return;
    const map = this.map;
    const style = wallStyleById(this.cityWallStyle);
    const def = this.cityWallDefinition(
      nextCityId(
        'wall',
        (map.wallRuns ?? []).map((run) => run.id),
      ),
      points,
      style,
    );
    this.cityWallFinishing = true;
    this.cityWallPoints = [];
    this.viewport3d?.setCityPathPreview(null);
    this.inspector.refresh();
    void (async () => {
      const placements = await this.cityBuildWallPlacements(def, style);
      if (map !== this.map) return;
      if (placements.length === 0) {
        this.toasts.error(t('editor.city.wallBuildFailed'));
        if (this.cityWallPoints.length === 0) this.cityWallPoints = points;
        this.citySyncPathPreview();
        return;
      }
      if (map.placements.length + placements.length > MAX_PLACEMENTS) {
        this.toasts.error(t('editor.status.placementCapReached', { max: MAX_PLACEMENTS }));
        return;
      }
      const start = appendSpan(map.placements, placements);
      for (let i = 0; i < placements.length; i++) this.viewport3d?.placementAdded(start + i);
      if (!map.wallRuns) map.wallRuns = [];
      const runs = map.wallRuns;
      runs.push(def);
      const state: CityWallRuntimeState = { def, placements };
      this.cityWallRuntime.set(def.id, state);
      this.cityActiveWallId = def.id;
      map.meta.updatedAt = now();
      this.canvasDirty = true;
      this.pushUndo({
        label: 'city-wall',
        undo: () => {
          const drop = new Set(cityPlacementIndices(map.placements, def.id));
          const kept = map.placements.filter((_, index) => !drop.has(index));
          map.placements.length = 0;
          map.placements.push(...kept);
          const at = runs.indexOf(state.def);
          if (at >= 0) runs.splice(at, 1);
          if (this.cityActiveWallId === def.id) this.cityActiveWallId = null;
          this.setSelectedPlacement(null);
          this.viewport3d?.rebuildPlacements();
          this.canvasDirty = true;
        },
        redo: () => {
          map.placements.push(...state.placements);
          if (!runs.includes(state.def)) runs.push(state.def);
          this.cityActiveWallId = def.id;
          this.viewport3d?.rebuildPlacements();
          this.canvasDirty = true;
        },
      });
      this.toasts.success(t('editor.city.wallPlaced', { n: placements.length }));
    })().finally(() => {
      this.cityWallFinishing = false;
      this.cityRefreshActiveWall();
      this.inspector.refresh();
    });
  }

  /** Delete a whole wall run (def + every derived placement), one undo entry. */
  private cityDeleteWallRun(cityId: string): void {
    const map = this.map;
    const runs = map.wallRuns ?? [];
    const runAt = runs.findIndex((r) => r.id === cityId);
    const indices = cityPlacementIndices(map.placements, cityId);
    if (runAt < 0 && indices.length === 0) return;
    const def = runAt >= 0 ? runs[runAt] : null;
    const removed = indices.map((i) => map.placements[i]);
    const apply = (): void => {
      const drop = new Set(cityPlacementIndices(this.map.placements, cityId));
      if (drop.size > 0) {
        const kept = this.map.placements.filter((_, i) => !drop.has(i));
        this.map.placements.length = 0;
        this.map.placements.push(...kept);
      }
      const at = def ? runs.indexOf(def) : -1;
      if (at >= 0) runs.splice(at, 1);
      if (this.cityActiveWallId === cityId) this.cityActiveWallId = null;
      this.setSelectedPlacement(null);
      this.viewport3d?.rebuildPlacements();
      this.canvasDirty = true;
    };
    apply();
    this.pushUndo({
      label: 'city-wall-delete',
      undo: () => {
        this.map.placements.push(...removed);
        if (def) runs.push(def);
        if (def) this.cityAdoptWall(def);
        this.viewport3d?.rebuildPlacements();
        this.canvasDirty = true;
      },
      redo: apply,
    });
    this.toasts.info(t('editor.status.deleted'));
    this.inspector.refresh();
  }

  private cityRoadsChanged(regionPoints?: readonly { x: number; z: number }[]): void {
    // Rebuilding the active world re-derives the combined roads array and
    // re-registers the roadDistance override; the terrain then re-splats.
    this.rebuildActiveWorld();
    const bounds = regionPoints ? polylineBounds(regionPoints, 30) : null;
    if (bounds) this.rebuildTerrainRegion(bounds);
    this.canvasDirty = true;
  }

  private cityFinishRoad(): void {
    const points = this.cityRoadPoints;
    if (points.length < 2) {
      this.toasts.info(t('editor.city.roadTooShort'));
      return;
    }
    const map = this.map;
    // Authored road defs have their own budget (MAX_ROADS), separate from the
    // legacy roads a map may have inherited from the built-in world: a map
    // cloned from the shipped world already carries the full legacy set.
    if ((map.roadDefs?.length ?? 0) >= MAX_ROADS) {
      this.toasts.error(t('editor.city.roadLimit'));
      return;
    }
    const def: RoadDef = {
      id: nextCityId(
        'road',
        (map.roadDefs ?? []).map((r) => r.id),
      ),
      points: points.map((p) => ({ x: p.x, z: p.z })),
      kind: this.cityRoadKind,
    };
    this.cityRoadPoints = [];
    this.viewport3d?.setCityPathPreview(null);
    // The same snapshot undo every road edit uses, so a redo can never land
    // in a roadDefs array the document has since replaced.
    this.roadEdit.addAuthored(def);
    this.toasts.success(t('editor.city.roadPlaced'));
    this.inspector.refresh();
  }

  private cityDeleteRoad(id: string): void {
    this.roadEdit.remove({ kind: 'authored', id });
  }

  /** The document's road layers, as the road editor reads them. */
  private cityRoadLayers(): RoadLayers {
    return {
      legacy: this.map.content.roads ?? BUILTIN_WORLD.roads,
      edits: this.map.roadEdits,
      defs: this.map.roadDefs,
    };
  }

  /** Edit mode press: grab a waypoint or the line of the selected road, or
   *  select the road under the cursor. Pick reach scales with zoom. */
  private cityRoadEditPress(w: Vec2): void {
    const wpp =
      this.viewMode === '3d'
        ? (this.viewport3d?.worldPerPixel(w.x, w.z) ?? 0.1)
        : 1 / Math.max(1e-3, this.cam.pxPerYard);
    const result = this.roadEdit.press(w, {
      waypoint: Math.max(1.5, wpp * 12),
      road: Math.max(4, wpp * 10),
    });
    if (result.refusal === 'tooLong') this.toasts.info(t('editor.city.roadPointLimit'));
    this.inspector.refresh();
  }

  /** The selected road's handles: a dot per waypoint sized to stay
   *  clickable at any zoom, the held one highlighted. */
  private cityRoadEditPreview(
    points: readonly { x: number; z: number }[] | null,
    highlight: number | null,
  ): void {
    const v = this.viewport3d;
    // The path preview group is shared (wall and road drafts, the Mob tool's
    // patrol route): only the Roads tab's Edit mode may draw or clear it.
    if (!v || this.tool !== 'city' || this.citySubtool !== 'road' || this.cityRoadMode !== 'edit') {
      this.roadPreviewDrawn = null;
      return;
    }
    if (!points) {
      if (this.roadPreviewDrawn) v.setCityPathPreview(null);
      this.roadPreviewDrawn = null;
      return;
    }
    const mid = points[Math.floor(points.length / 2)];
    // Quantized so a hover that does not change the zoom redraws nothing.
    const dotRadius =
      Math.round(Math.min(6, Math.max(0.45, v.worldPerPixel(mid.x, mid.z) * 6)) * 20) / 20;
    const last = this.roadPreviewDrawn;
    if (last && last.points === points && last.highlight === highlight && last.r === dotRadius) {
      return;
    }
    this.roadPreviewDrawn = { points, highlight, r: dotRadius };
    v.setCityPathPreview(points, ROAD_EDIT_PREVIEW_COLOR, { highlight, dotRadius });
  }

  private cityDeleteRoadPoint(): void {
    if (this.roadEdit.deleteWaypoint() === 'tooShort') {
      this.toasts.info(t('editor.city.roadPointTooShort'));
    }
  }

  /** The Edit mode inspector's view of the selected road. */
  private cityRoadSelection(): CityRoadSelection | null {
    const ref = this.roadEdit.selected;
    const points = ref ? roadPoints(this.cityRoadLayers(), ref) : null;
    if (!ref || !points) return null;
    const waypoint = this.roadEdit.selectedWaypoint;
    if (ref.kind === 'authored') {
      const n = (this.map.roadDefs ?? []).findIndex((d) => d.id === ref.id) + 1;
      return {
        ref,
        label: t('editor.city.roadAuthored', { n: formatNumber(n) }),
        points: points.length,
        waypoint,
        edited: false,
      };
    }
    return {
      ref,
      label: t('editor.city.roadBuiltin', { n: formatNumber(ref.index + 1) }),
      points: points.length,
      waypoint,
      edited: builtinRoadState(this.map.roadEdits, ref.index) === 'edited',
    };
  }

  /** Select a road from the panel list and frame it in the viewport. */
  private citySelectRoad(ref: RoadRef): void {
    this.roadEdit.select(ref);
    const points = this.roadEdit.selectedPoints();
    const b = points ? polylineBounds(points, 0) : null;
    if (b) {
      const extent = Math.max(15, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.35);
      this.viewport3d?.focusOn((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, extent);
      // The handles size from the camera, which lands on the next frame.
      requestAnimationFrame(() => requestAnimationFrame(() => this.roadEdit.syncPreview()));
    }
    this.inspector.refresh();
  }

  private citySavePrefab(name: string): boolean {
    const indices = [...this.selectedSet];
    if (this.selectedPlacement !== null) indices.push(this.selectedPlacement);
    const unique = [...new Set(indices)].filter((i) => this.map.placements[i]);
    if (unique.length === 0) {
      this.toasts.info(t('editor.city.prefabNeedSelection'));
      return false;
    }
    const items = copyPlacementSelection(this.map.placements, new Set(unique));
    const prefab = rebaseAsPrefab(name.slice(0, 40), items);
    if (!prefab) return false;
    this.cityPrefabs = [...this.cityPrefabs.filter((p) => p.name !== prefab.name), prefab];
    writeJsonPref(CITY_PREFABS_PREF_KEY, this.cityPrefabs);
    this.toasts.success(t('editor.city.prefabSaved', { name: prefab.name }));
    return true;
  }

  private cityDeletePrefab(name: string): void {
    this.cityPrefabs = this.cityPrefabs.filter((p) => p.name !== name);
    if (this.cityArmedPrefab === name) this.cityArmedPrefab = null;
    writeJsonPref(CITY_PREFABS_PREF_KEY, this.cityPrefabs);
  }

  private cityStampArmedPrefab(w: Vec2): void {
    const prefab = this.cityPrefabs.find((p) => p.name === this.cityArmedPrefab);
    if (!prefab) return;
    const items = stampPrefab(prefab, this.citySnap(w)) as AssetPlacement[];
    this.appendPlacements(items, 'city-prefab');
    this.toasts.success(t('editor.city.prefabStamped', { n: items.length }));
  }

  private cityRouteClick(w: Vec2, ev?: PointerEvent): void {
    if (ev && ev.detail >= 2 && this.cityRouteNpcKey) {
      this.cityFinishRoute();
      return;
    }
    if (!this.cityRouteNpcKey) {
      // First click picks the NPC to author a route for (nearest within 6yd).
      let bestKey: string | null = null;
      let bestD = 6 * 6;
      for (const [key, npc] of Object.entries(this.map.content.npcs)) {
        const dx = npc.pos.x - w.x;
        const dz = npc.pos.z - w.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          bestKey = key;
        }
      }
      if (!bestKey) {
        this.toasts.info(t('editor.city.routeNoNpc'));
        return;
      }
      this.cityRouteNpcKey = bestKey;
      const npc = this.map.content.npcs[bestKey];
      const route = npc.route;
      this.cityRoutePoints = route ? route.points.map((p) => ({ ...p })) : [];
      this.cityRouteMode = route?.mode ?? 'loop';
      this.cityRouteSpeed = route?.speed ?? 2.2;
      this.citySyncPathPreview();
      this.inspector.refresh();
      return;
    }
    const point: { x: number; z: number; wait?: number } = { x: w.x, z: w.z };
    if (this.cityRouteWait > 0) point.wait = this.cityRouteWait;
    this.cityRoutePoints.push(point);
    this.citySyncPathPreview(w);
    this.inspector.refresh();
  }

  private cityFinishRoute(): void {
    const key = this.cityRouteNpcKey;
    if (!key) return;
    const npc = this.map.content.npcs[key];
    if (!npc) return;
    const before = npc.route ? (JSON.parse(JSON.stringify(npc.route)) as NpcRoute) : undefined;
    if (this.cityRoutePoints.length < 2) {
      this.toasts.info(t('editor.city.routeNoNpc'));
      return;
    }
    const after: NpcRoute = {
      points: this.cityRoutePoints.map((p) => ({ ...p })),
      mode: this.cityRouteMode,
      speed: this.cityRouteSpeed,
    };
    npc.route = after;
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'city-route',
      undo: () => {
        const target = this.map.content.npcs[key];
        if (!target) return;
        if (before) target.route = before;
        else delete target.route;
      },
      redo: () => {
        const target = this.map.content.npcs[key];
        if (target) target.route = after;
      },
    });
    this.toasts.success(t('editor.city.routeSaved', { n: after.points.length }));
    this.cityRouteNpcKey = null;
    this.cityRoutePoints = [];
    this.viewport3d?.setCityPathPreview(null);
    this.inspector.refresh();
  }

  private cityClearRoute(): void {
    const key = this.cityRouteNpcKey;
    if (!key) return;
    const npc = this.map.content.npcs[key];
    if (npc?.route) {
      const before = npc.route;
      delete npc.route;
      this.pushUndo({
        label: 'city-route-clear',
        undo: () => {
          const target = this.map.content.npcs[key];
          if (target) target.route = before;
        },
        redo: () => {
          const target = this.map.content.npcs[key];
          if (target) delete target.route;
        },
      });
    }
    this.cityRoutePoints = [];
    this.citySyncPathPreview();
    this.toasts.info(t('editor.city.routeCleared'));
    this.inspector.refresh();
  }

  /** Ghost + rubber-band updates while the pointer moves over the viewport. */
  private cityHover(w: Vec2): void {
    const v = this.viewport3d;
    if (!v) return;
    if (this.citySubtool === 'wall') v.setCityGridOverlay(w, this.citySettings.gridSize);
    else v.setCityGridOverlay(null, 0);
    if (this.citySubtool === 'kit' && this.placeAssetId) {
      const path = assetById(this.placeAssetId)?.path ?? null;
      v.setCityGhostAsset(path);
      if (path) {
        const scale = this.citySettings.kitScale;
        const p = this.cityKitPoint(w);
        // Tile-snapped neighbors legitimately sit shoulder to shoulder, so
        // the overlap warning only fires against a piece in the SAME cell.
        const clearance = this.citySettings.tileSnap ? 0.4 : Math.max(0.6, scale * 0.5);
        const blocked = ghostBlocked(this.map.placements, p.x, p.z, clearance);
        v.updateCityGhost(
          p.x,
          p.z,
          snapAngleRad(this.cityKitRot, this.citySettings.rotSnapDeg),
          scale,
          blocked,
          this.citySettings.tileSnap ? (this.cityTileLevel ?? undefined) : undefined,
        );
      }
    } else if (this.citySubtool === 'prefab' && this.cityArmedPrefab) {
      v.setCityGhostAsset(null);
      const p = this.citySnap(w);
      v.setBrush(p.x, p.z, 2, 0x59c46a);
    } else {
      v.setCityGhostAsset(null);
      this.citySyncPathPreview(w);
    }
  }

  /** The City Build panel's dependency bag (see city_build_panel.ts). */
  private cityPanelDeps(): CityBuildPanelDeps {
    return {
      getSubtool: () => this.citySubtool,
      setSubtool: (sub) => {
        if (this.citySubtool !== sub) {
          this.citySubtool = sub;
          this.cityToolReset();
          // The Kit subtool works out of the asset browser; the draw subtools
          // need the full viewport clear for clicking.
          if (this.tool === 'city') this.assets.setVisible(sub === 'kit');
        }
      },
      getSettings: () => this.citySettings,
      setSettings: (settings) => this.setCitySettings(settings),
      kitLabel: () => this.placeAssetLabel,
      openAssetBrowser: () => this.assets.setVisible(true),
      getWallStyle: () => this.cityWallStyle,
      setWallStyle: (id) => {
        this.cityWallStyle = id;
        this.cityRefreshActiveWall();
      },
      getWallScale: () => this.cityWallScale,
      setWallScale: (v) => {
        this.cityWallScale = v;
        this.cityRefreshActiveWall();
      },
      getWallHeight: () => this.cityWallHeight,
      setWallHeight: (v) => {
        this.cityWallHeight = v;
        this.cityRefreshActiveWall();
      },
      getWallThickness: () => this.cityWallThickness,
      setWallThickness: (v) => {
        this.cityWallThickness = v;
        this.cityRefreshActiveWall();
      },
      getWallPostEvery: () => this.cityWallPostEvery,
      setWallPostEvery: (v) => {
        this.cityWallPostEvery = v;
        this.cityRefreshActiveWall();
      },
      getWallClosed: () => this.cityWallClosed,
      setWallClosed: (on) => {
        this.cityWallClosed = on;
        this.cityRefreshActiveWall();
      },
      getWallWalkTop: () => this.cityWallWalkTop,
      setWallWalkTop: (on) => {
        this.cityWallWalkTop = on;
        this.cityRefreshActiveWall();
      },
      getWallStairs: () => this.cityWallStairs,
      setWallStairs: (on) => {
        this.cityWallStairs = on;
        this.cityRefreshActiveWall();
      },
      wallHasStairs: () => !!wallStyleById(this.cityWallStyle).stairAssetId,
      wallPointCount: () => this.cityWallPoints.length,
      hasActiveWall: () =>
        !!this.cityActiveWallId &&
        !!this.map.wallRuns?.some((run) => run.id === this.cityActiveWallId),
      undoWallPoint: () => this.cityUndoActivePathPoint(),
      finishWall: () => this.cityFinishWall(),
      cancelWall: () => this.cityCancelActivePath(),
      getRoadKind: () => this.cityRoadKind,
      setRoadKind: (kind) => {
        this.cityRoadKind = kind;
      },
      roadPointCount: () => this.cityRoadPoints.length,
      finishRoad: () => this.cityFinishRoad(),
      cancelRoad: () => this.cityCancelActivePath(),
      roadList: () =>
        (this.map.roadDefs ?? []).map((r, i) => ({
          id: r.id,
          label: t('editor.city.roadAuthored', { n: i + 1 }),
          points: r.points.length,
        })),
      deleteRoad: (id) => this.cityDeleteRoad(id),
      getRoadMode: () => this.cityRoadMode,
      setRoadMode: (mode) => {
        if (mode === this.cityRoadMode) return;
        this.cityRoadPoints = [];
        this.roadEdit.select(null);
        this.cityRoadMode = mode;
        this.viewport3d?.setCityPathPreview(null);
        this.roadPreviewDrawn = null;
        this.citySyncPathPreview();
      },
      roadSelection: () => this.cityRoadSelection(),
      selectRoad: (ref) => this.citySelectRoad(ref),
      deleteRoadPoint: () => this.cityDeleteRoadPoint(),
      removeSelectedRoad: () => {
        if (this.roadEdit.removeSelected()) this.toasts.info(t('editor.city.roadRemoved'));
      },
      resetRoad: (index) => {
        this.roadEdit.resetBuiltin(index);
      },
      builtinRoadList: () =>
        (this.map.content.roads ?? BUILTIN_WORLD.roads).map((_road, index) => ({
          index,
          label: t('editor.city.roadBuiltin', { n: formatNumber(index + 1) }),
          state: builtinRoadState(this.map.roadEdits, index),
        })),
      prefabList: () => this.cityPrefabs.map((p) => ({ name: p.name, count: p.items.length })),
      savePrefab: (name) => this.citySavePrefab(name),
      armedPrefab: () => this.cityArmedPrefab,
      armPrefab: (name) => {
        this.cityArmedPrefab = name;
      },
      deletePrefab: (name) => this.cityDeletePrefab(name),
      hasSelection: () => this.selectedPlacement !== null || this.selectedSet.size > 0,
      routeNpcName: () => {
        const key = this.cityRouteNpcKey;
        return key ? (this.map.content.npcs[key]?.name ?? null) : null;
      },
      routePointCount: () => this.cityRoutePoints.length,
      getRouteMode: () => this.cityRouteMode,
      setRouteMode: (mode) => {
        this.cityRouteMode = mode;
      },
      getRouteSpeed: () => this.cityRouteSpeed,
      setRouteSpeed: (v) => {
        this.cityRouteSpeed = v;
      },
      getRouteWait: () => this.cityRouteWait,
      setRouteWait: (v) => {
        this.cityRouteWait = v;
      },
      finishRoute: () => this.cityFinishRoute(),
      clearRoute: () => this.cityClearRoute(),
    };
  }

  /** Leave City Build cleanly: clear previews and any half-drawn polyline. */
  private cityToolReset(): void {
    this.cityWallPoints = [];
    this.cityRoadPoints = [];
    this.roadEdit.endDrag();
    this.roadEdit.reset();
    this.roadPreviewDrawn = null;
    this.cityRouteNpcKey = null;
    this.cityRoutePoints = [];
    this.cityArmedPrefab = null;
    this.cityTileLevel = null;
    this.viewport3d?.setCityPathPreview(null);
    this.viewport3d?.setCityGridOverlay(null, 0);
    this.viewport3d?.setCityGhostAsset(null);
  }

  private removePlacementAt(index: number): void {
    const placement = this.map.placements[index];
    if (!placement) return;
    this.map.placements.splice(index, 1);
    this.setSelectedPlacement(null);
    // Surgical single removal: the view drops one slot, no full re-clone.
    this.viewport3d?.placementRemoved(index);
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    this.pushUndo({
      label: 'remove-placement',
      undo: () => {
        // Mid-list insert shifts every later index: full re-instance.
        this.map.placements.splice(index, 0, placement);
        this.viewport3d?.rebuildPlacements();
        this.canvasDirty = true;
      },
      redo: () => {
        this.map.placements.splice(index, 1);
        this.setSelectedPlacement(null);
        this.viewport3d?.placementRemoved(index);
        this.canvasDirty = true;
      },
    });
    this.inspector.refresh();
  }

  private setSelectedPlacement(index: number | null): void {
    if (index !== null) this.clearNpcSelection();
    // Switching objects (or clearing) leaves hitbox-edit mode.
    if (this.hitboxEdit && this.hitboxEdit.index !== index) this.exitHitboxEdit();
    if (this.selectedPlacement !== index) {
      // An open wheel/nudge burst on the OLD selection commits now, or its
      // live changes would silently drop out of the undo history.
      this.flushTransformCommit();
      this.placementDragBase = null;
      this.groupDragBase = null;
      this.materialFinishBase = null;
      this.selectedFireEmitter = null;
      this.viewport3d?.setFireEmitterEdit(null, null);
    }
    this.selectedPlacement = index;
    const cityId = index === null ? null : this.map.placements[index]?.cityId;
    const wall = cityId ? this.map.wallRuns?.find((run) => run.id === cityId) : null;
    if (wall) this.cityAdoptWall(wall);
    // Single-select semantics: the set collapses to the new active. Additive
    // callers (Shift+click, group drags) restore their wider set afterward.
    // A group behaves as ONE object: picking any member takes the whole set,
    // so drag, rotate, scale and delete all act on it together.
    this.selectedSet =
      index === null
        ? new Set()
        : new Set(
            this.map.placements[index]?.groupId
              ? groupMembers(this.map.placements, index)
              : [index],
          );
    this.viewport3d?.setSelectedPlacement(index);
    this.syncMultiSelectionView();
  }

  /** The orange member rings in the 3D view (active excluded: it has the
   *  renderer's gold ring). */
  private syncMultiSelectionView(): void {
    this.viewport3d?.setMultiSelection(
      [...this.selectedSet].filter((i) => i !== this.selectedPlacement),
    );
    this.selectionQuickActions?.refresh();
  }

  /** Select one fire source for detailed editing. Entering this mode switches
   *  to Move so the familiar 3-axis gizmo appears directly on the flame. */
  /**
   * Turn wind sway on/off for the SELECTED PLACEMENT'S ASSET (map.assetSway).
   * Per-asset by design: the sway shader is installed once on the shared
   * template material, so every placement of the asset shares one program and
   * they can only move together. Sway is on by default, so only the opt-outs
   * are stored and turning it back on deletes the entry rather than writing
   * `true` (keeps a document from growing an entry per placed plant).
   */
  private setAssetSway(on: boolean): void {
    const index = this.selectedPlacement;
    const p = index === null ? undefined : this.map.placements[index];
    if (!p) return;
    const assetId = p.assetId;
    const before = this.map.assetSway?.[assetId];
    const apply = (value: boolean | undefined): void => {
      if (value === false) {
        if (!this.map.assetSway) this.map.assetSway = {};
        this.map.assetSway[assetId] = false;
      } else if (this.map.assetSway) {
        delete this.map.assetSway[assetId];
        if (Object.keys(this.map.assetSway).length === 0) delete this.map.assetSway;
      }
      // Re-applies to templates already standing, so the change is visible on
      // every placement of the asset without a map reload.
      this.viewport3d?.applyAssetSway();
      this.inspector.refresh();
      this.canvasDirty = true;
    };
    apply(on ? undefined : false);
    this.pushUndo({
      label: 'asset-sway',
      undo: () => apply(before),
      redo: () => apply(on ? undefined : false),
    });
    this.map.meta.updatedAt = now();
    this.markDirty();
  }

  private setSelectedFireEmitter(emitterIndex: number | null): void {
    const placementIndex = this.selectedPlacement;
    const p = placementIndex === null ? undefined : this.map.placements[placementIndex];
    const valid = emitterIndex !== null && p?.fireEffects?.[emitterIndex] ? emitterIndex : null;
    this.selectedFireEmitter = valid;
    this.viewport3d?.setFireEmitterEdit(placementIndex, valid);
    if (valid !== null && this.tool !== 'move') this.setTool('move');
    else this.inspector.refresh();
    this.canvasDirty = true;
  }

  /** Immutable emitter patching is load-bearing for undo: the placement's
   *  shallow pre-gesture snapshot keeps the old array while live edits replace
   *  it, so a slider or gizmo drag still produces exactly one undo entry. */
  private updateSelectedFireEmitter(
    change: Partial<Pick<AssetFireEmitter, 'x' | 'y' | 'z'>>,
    commit: boolean,
  ): void {
    const placementIndex = this.selectedPlacement;
    const emitterIndex = this.selectedFireEmitter;
    if (placementIndex === null || emitterIndex === null) return;
    const p = this.map.placements[placementIndex];
    const effects = p?.fireEffects;
    const current = effects?.[emitterIndex];
    if (!p || !effects || !current) return;
    if (commit && Object.keys(change).length === 0 && !this.placementDragBase) return;
    const patched = sanitizeAssetFireEmitter({ ...current, ...change }, current.id);
    if (!patched) return;
    const next = effects.map((fx, i) => (i === emitterIndex ? patched : { ...fx }));
    this.updateSelectedPlacement({ fireEffects: next }, commit);
    this.viewport3d?.setFireEmitterEdit(placementIndex, emitterIndex);
  }

  /** Ctrl+drag replaces the placement pool; Ctrl+Shift+drag accumulates boxes. */
  private selectPlacements(indices: number[], additive = false): void {
    const next = marqueePlacementSelection(this.selectedSet, indices, additive);
    if (next.size === 0) {
      this.setSelectedPlacement(null);
      this.inspector.refresh();
      this.canvasDirty = true;
      return;
    }
    // An empty additive box is a no-op. In particular it must not discard the
    // carefully accumulated pool or move its active transform pivot.
    if (additive && indices.length === 0) return;
    this.selectedKey = null;
    this.clearNpcSelection();
    this.selectedCamp = null;
    const active =
      additive && this.selectedPlacement !== null && next.has(this.selectedPlacement)
        ? this.selectedPlacement
        : (indices[0] ?? next.values().next().value ?? null);
    this.setSelectedPlacement(active);
    this.selectedSet = next;
    this.syncMultiSelectionView();
    this.inspector.refresh();
    this.canvasDirty = true;
  }

  /** Blender Shift+click: toggle a placement in the multi-selection. */
  private togglePlacementInSelection(index: number): void {
    if (this.selectedSet.has(index)) {
      const rest = new Set(this.selectedSet);
      rest.delete(index);
      const nextActive =
        this.selectedPlacement === index ? ([...rest].pop() ?? null) : this.selectedPlacement;
      this.setSelectedPlacement(nextActive);
      this.selectedSet = nextActive === null ? new Set() : rest;
    } else {
      const keep = new Set(this.selectedSet);
      keep.add(index);
      this.setSelectedPlacement(index);
      this.selectedSet = keep;
    }
    this.selectedKey = null;
    this.clearNpcSelection();
    this.syncMultiSelectionView();
    this.inspector.refresh();
    this.canvasDirty = true;
  }

  /** Every placement sharing the active placement's asset, the active one
   *  first (it stays the transform pivot). Placements hidden in the editor
   *  (the Scene Collection eye) are left out, as a marquee would leave them. */
  private sameAssetIndices(): number[] {
    const active = this.selectedPlacement;
    const p = active === null ? undefined : this.map.placements[active];
    if (active === null || !p) return [];
    const indices = [active];
    this.map.placements.forEach((q, i) => {
      if (i !== active && q.assetId === p.assetId && !q.hidden) indices.push(i);
    });
    return indices;
  }

  /** The inspector's "Select all of this asset" button: one click turns the
   *  active placement into a multi-selection of its whole asset family. */
  private selectAllOfAsset(): void {
    const indices = this.sameAssetIndices();
    if (indices.length === 0) return;
    this.selectPlacements(indices, false);
  }

  private placementLabel(assetId: string): string {
    if (assetId === GRASS_PATCH_ASSET_ID) return t('editor.foliageTool.grass');
    const kind = colliderKindFor(assetId);
    if (kind) return t(`editor.collider.${kind}` as Parameters<typeof t>[0]);
    if (isLocalAssetId(assetId)) return localAssetLabel(assetId);
    if (isUserAssetId(assetId)) return userAssetLabel(assetId);
    return assetById(assetId)?.label ?? assetId;
  }

  // ---- collider volumes -------------------------------------------------------

  /** Collider tool click: insert the picked shape, select it, and hand it to
   *  the Move gizmo so it can be shaped immediately. */
  private insertColliderAt(w: Vec2): void {
    const placement: AssetPlacement = {
      assetId: COLLIDER_ASSET_IDS[this.colliderShape],
      x: w.x,
      z: w.z,
      rotY: 0,
      scale: 1,
      collide: true,
    };
    this.appendPlacements([placement], 'add-collider');
    const index = this.map.placements.lastIndexOf(placement);
    if (index >= 0) {
      this.setSelectedPlacement(index);
      this.setTool('move');
    }
    this.inspector.refresh();
  }

  /** Pond tool: dig a round basin and fill it with a local water volume, as
   *  ONE undo step; refused when authored terrain would leave it floating. */
  private insertPondAt(w: Vec2): void {
    const seed = this.map.meta.seed;
    const plan = planPond({ ...w, radius: this.pondRadius, depth: this.pondDepth }, (x, z) =>
      terrainHeight(x, z, seed),
    );
    if (!plan) {
      this.toasts.error(t('editor.pond.invalid'));
      return;
    }
    const command = createPondCommand(this.map, plan, (region) => {
      this.terrainEditsMutated();
      this.setSelectedPlacement(null);
      this.refreshTerrain(region);
      this.viewport3d?.rebuildPlacements();
      this.canvasDirty = true;
    });
    if (!command) {
      this.toasts.error(
        this.map.placements.length >= MAX_PLACEMENTS
          ? t('editor.status.placementCapReached', { max: MAX_PLACEMENTS })
          : t('editor.status.terrainCapReached', { max: MAX_TERRAIN_EDITS }),
      );
      return;
    }
    command.redo();
    if (!pondTerrainMatches(plan, (x, z) => terrainHeight(x, z, seed))) {
      command.undo();
      this.toasts.error(t('editor.pond.invalid'));
      return;
    }
    this.map.meta.updatedAt = now();
    this.pushUndo(command);
  }

  /** The floating Selected asset box: quick actions on the selected placement
   *  through the same commands the inspector uses. */
  private selectionQuickActionsDeps(): SelectionQuickActionsDeps {
    return {
      getState: () => {
        const p =
          this.selectedPlacement === null ? null : this.map.placements[this.selectedPlacement];
        if (
          !p ||
          !isSelectionTool(this.tool) ||
          this.previewOn ||
          this.hitboxEdit ||
          this.meshEditActive()
        )
          return null;
        return {
          label: p.name?.trim() || this.placementLabel(p.assetId),
          count: Math.max(
            1,
            [...this.selectedSet].filter((index) => this.map.placements[index]).length,
          ),
          transform: { rotY: p.rotY, scale: p.scale },
          fineRotation: this.fineBuildRotation,
        };
      },
      onMove: () => this.setTool('move'),
      onFrame: () => this.focusSelection(),
      onDuplicate: () => this.duplicateSelectedPlacement(),
      onRemove: () => this.removeSelectedPlacements(),
      onTransform: (next) => {
        this.updateSelectedPlacement(next, true);
        this.inspector.refresh();
      },
    };
  }

  /** Precise picking and the overlap chooser (viewport placement_pick_*). */
  private placementPickingHooks() {
    return {
      placementPickingEnabled: () =>
        (isSelectionTool(this.tool) || this.tool === 'building') &&
        !this.previewOn &&
        !this.hitboxEdit &&
        !this.meshEditActive(),
      onChoosePlacement: (index: number, additive: boolean) => {
        if (!this.map.placements[index]) return;
        if (!isSelectionTool(this.tool)) this.setTool('move');
        if (additive) this.togglePlacementInSelection(index);
        else {
          this.setSelectedPlacement(index);
          this.inspector.refresh();
          this.canvasDirty = true;
        }
      },
      onPickFloorVisibilityChange: (hideAbove: boolean) =>
        this.buildingWorkspace.panelDeps().setHideAbove(hideAbove),
      placementDragUsesCursor: () => this.tool === 'rotate' || this.tool === 'scale',
    };
  }

  private insertFluidAt(w: Vec2): void {
    const placement: AssetPlacement = {
      assetId: FLUID_ASSET_IDS[this.fluidKind],
      x: w.x,
      z: w.z,
      rotY: 0,
      scale: 1,
      collide: false,
      sizeX: FLUID_DEFAULT_SIZE.x,
      sizeZ: FLUID_DEFAULT_SIZE.z,
      sizeY: FLUID_DEFAULT_OFFSET_Y,
    };
    this.appendPlacements([placement], 'add-fluid');
    const index = this.map.placements.lastIndexOf(placement);
    if (index >= 0) {
      this.setSelectedPlacement(index);
      this.setTool('move');
    }
    this.inspector.refresh();
  }

  // ---- foliage brush ------------------------------------------------------------

  private hasAmbientFoliage(): boolean {
    return this.map.decorationsMode !== 'empty' && this.map.presentationMode !== 'blank';
  }

  private refreshAmbientFoliage(selected: number | null): void {
    this.rebuildActiveWorld();
    this.setSelectedPlacement(selected);
    this.canvasDirty = true;
    this.inspector.refresh();
    if (!this.viewport3d) return;
    // Preserve the editor camera across the reload. reload() -> start() reframes
    // the camera to the map hub (spawn), which would yank the maker away from the
    // very region they just converted, the whole point is to make the assets
    // where they ARE editable, in place. Capture the pose now, restore it once the
    // engine is back up.
    const cam = this.viewport3d.dungeonStagePort()?.cam;
    const pose = cam
      ? {
          x: cam.target.x,
          y: cam.target.y,
          z: cam.target.z,
          yaw: cam.yaw,
          pitch: cam.pitch,
          dist: cam.dist,
        }
      : null;
    this.show3dLoading();
    void this.viewport3d
      .reload(this.map)
      .then(() => {
        if (pose) {
          const c2 = this.viewport3d?.dungeonStagePort()?.cam;
          if (c2) {
            c2.target.set(pose.x, pose.y, pose.z);
            c2.yaw = pose.yaw;
            c2.pitch = pose.pitch;
            c2.dist = pose.dist;
          }
        }
        this.syncFootprintOverlay();
        this.viewport3d?.setSelectedPlacement(this.selectedPlacement);
      })
      .catch((error: unknown) => {
        console.error('[editor] Failed to refresh editable foliage', error);
      })
      .finally(() => this.hide3dLoading());
  }

  /** The zone (this map's own zone band) the editor camera is currently over,
   *  matching sim `zoneAt`'s rect walk. Null only if the map has no zones. */
  private zoneAtEditorPoint(point: {
    x: number;
    z: number;
  }): CustomMap['content']['zones'][number] | null {
    const zones = this.map.content.zones;
    let fallback: (typeof zones)[number] | null = null;
    for (const zone of zones) {
      if (point.z >= zone.zMax) continue;
      if (fallback === null || zone.zMax < fallback.zMax) fallback = zone;
      const x0 = zone.xMin ?? STRIP_MIN_X;
      const x1 = zone.xMax ?? STRIP_MAX_X;
      if (point.z >= zone.zMin && point.x >= x0 && point.x < x1) return zone;
    }
    return fallback;
  }

  private currentCameraZone(): CustomMap['content']['zones'][number] | null {
    return this.zoneAtEditorPoint(this.viewport3d?.cameraFocus() ?? { x: 0, z: 0 });
  }

  private currentMapCameraZone(): CustomMap['content']['zones'][number] | null {
    return this.zoneAtEditorPoint(this.viewport3d?.cameraPosition() ?? { x: 0, z: 0 });
  }

  /** The world rect the camera is currently over. Null if there are no zones.
   *  Drives the zone-scoped foliage conversion so far trees become editable one
   *  performance-safe region at a time instead of all 6k+ at once. */
  private zoneRectAtFocus(): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
    const zone = this.currentCameraZone();
    if (!zone) return null;
    return {
      minX: zone.xMin ?? STRIP_MIN_X,
      maxX: zone.xMax ?? STRIP_MAX_X,
      minZ: zone.zMin,
      maxZ: zone.zMax,
    };
  }

  // --- Minimap + Map window (top toolbar) --------------------------------------
  private minimap: EditorMinimap | null = null;
  // Area-music preview (the topbar's music note). The camera moves freely, so
  // the zone is re-resolved on a timer rather than on a camera event: the
  // director ignores an update that names the zone already playing, so a tick
  // that changes nothing costs a comparison.
  private areaMusicOn = false;
  private areaMusicTimer: number | undefined;
  private areaMusicZone: MusicZone | null = null;
  private mapWindow: EditorMapWindow | null = null;

  private mapWorldRect(): MapRect {
    const b = mapBounds(this.map);
    return { minX: -b.halfW, maxX: b.halfW, minZ: b.zMin, maxZ: b.zMax };
  }

  /** Camera + world accessors the minimap/map window sample; no HUD/Sim coupling. */
  private editorMapDeps(): EditorMapDeps {
    return {
      cameraPosition: () => this.viewport3d?.cameraPosition() ?? { x: 0, z: 0 },
      cameraYaw: () => this.viewport3d?.cameraYaw() ?? 0,
      seed: () => this.map.meta.seed,
      revision: () => this.map.meta.updatedAt,
      worldRect: () => this.mapWorldRect(),
      currentZoneRect: () => {
        const zone = this.currentMapCameraZone();
        return zone
          ? {
              minX: zone.xMin ?? STRIP_MIN_X,
              maxX: zone.xMax ?? STRIP_MAX_X,
              minZ: zone.zMin,
              maxZ: zone.zMax,
            }
          : this.mapWorldRect();
      },
      zoneBoxes: () =>
        this.map.content.zones.map((z) => ({
          id: z.id,
          label: (z.name || z.id) as string,
          minX: z.xMin ?? STRIP_MIN_X,
          maxX: z.xMax ?? STRIP_MAX_X,
          minZ: z.zMin,
          maxZ: z.zMax,
        })),
      sceneOverlay: () => ({
        roads: this.activeWorld.roads,
        placements: this.map.placements.map((placement) => ({
          x: placement.x,
          z: placement.z,
          scale: placement.scale,
          assetId: placement.assetId,
          hidden: placement.hidden,
        })),
      }),
      currentZone: () => {
        const zone = this.currentMapCameraZone();
        return { id: zone?.id ?? 'world', name: zone?.name || zone?.id || this.map.meta.name };
      },
      artImage: async (mode) => {
        const zone = this.currentMapCameraZone();
        return loadMapArt(mode === 'world' ? 'world' : (zone?.id ?? 'world'));
      },
      teleportCamera: (point) => this.viewport3d?.teleportCamera(point.x, point.z),
    };
  }

  private toggleMinimap(): void {
    if (!this.minimap) this.minimap = new EditorMinimap(this.stage3dEl, this.editorMapDeps());
    this.topbar.setMinimap(this.minimap.toggle());
  }

  /** The music zone the GAME would play at (x, z) on this map: the smallest
   *  music area containing the point, else the map's own track, else the cue
   *  the zone under the point would score with (hub themes included). Same
   *  order the running game resolves in (instance_music.ts). */
  private musicZoneAt(x: number, z: number): MusicZone {
    const authored = resolveMapMusicZone(this.map.music, x, z);
    if (authored) return authored;
    const zone =
      this.map.content.zones.find((zd) => zd.id === this.cameraZoneId()) ??
      this.map.content.zones[0];
    if (!zone) return 'vale';
    const hub = zone.hub;
    const inHub = !!hub && Math.hypot(x - hub.x, z - hub.z) < hub.radius + 10;
    return musicZoneForLocation(zone.id, zone.biome, inHub, false, null);
  }

  /** Topbar music note: play the soundtrack for wherever the camera is, and
   *  keep following it. SPACEY, 2026-09-09, hearing a music area used to mean
   *  launching a playtest and walking there. */
  private toggleAreaMusic(): void {
    if (this.areaMusicOn) {
      this.stopAreaMusic();
      this.toasts.info(t('editor.music.previewOff'));
      return;
    }
    if (!music.enabled) {
      // The click IS the gesture that would unlock audio, so a silent no-op
      // here reads as a broken button.
      this.toasts.error(t('editor.music.previewDisabled'));
      return;
    }
    this.areaMusicOn = true;
    this.topbar.setMusic(true);
    music.init();
    this.areaMusicZone = null;
    this.tickAreaMusic();
    this.areaMusicTimer = window.setInterval(() => this.tickAreaMusic(), 600);
  }

  private tickAreaMusic(): void {
    if (!this.areaMusicOn) return;
    const eye = this.viewport3d?.cameraPosition() ?? { x: 0, z: 0 };
    const zone = this.musicZoneAt(eye.x, eye.z);
    music.update(zone, false);
    if (zone !== this.areaMusicZone) {
      this.areaMusicZone = zone;
      this.toasts.info(t('editor.music.previewZone', { zone }));
    }
  }

  /** Tear the preview down: on the toggle, on pagehide, and whenever the open
   *  document is replaced (a new map's areas are not this one's). */
  private stopAreaMusic(): void {
    if (this.areaMusicTimer !== undefined) {
      window.clearInterval(this.areaMusicTimer);
      this.areaMusicTimer = undefined;
    }
    if (!this.areaMusicOn) return;
    this.areaMusicOn = false;
    this.areaMusicZone = null;
    this.topbar.setMusic(false);
    music.close();
  }

  private openMapWindow(): void {
    if (!this.mapWindow) {
      this.mapWindow = new EditorMapWindow(this.root, this.editorMapDeps(), {
        zoneMap: t('editor.map.zoneTitle'),
        worldMap: t('editor.map.worldTitle'),
        showWorld: t('editor.map.showWorld'),
        showZone: t('editor.map.showZone'),
        usePainted: t('editor.map.usePainted'),
        useLiveTerrain: t('editor.map.useLiveTerrain'),
        pinHint: t('editor.map.pinHint'),
        teleportToPin: t('editor.map.teleportToPin'),
        close: t('editor.map.close'),
      });
    }
    this.mapWindow.toggle();
  }

  /** Convert the built-in world's procedural foliage into editable placements.
   *  `mode`: 'all' = the whole map's remaining scatter in one action; 'batch' =
   *  the nearest 500 to the camera; 'zone' = the whole zone the camera is over
   *  (the performance-safe way to make a far area's trees editable without
   *  loading the entire map). Everything converted becomes selectable/movable. */
  private makeAmbientFoliageEditable(mode: 'all' | 'batch' | 'zone'): void {
    if (!this.hasAmbientFoliage()) return;
    const room = capRoom(this.map.placements.length, MAX_PLACEMENTS);
    if (room === 0) {
      this.toasts.error(t('editor.status.placementCapReached', { max: MAX_PLACEMENTS }));
      return;
    }
    const mb = mapBounds(this.map);
    const genBounds =
      mode === 'zone'
        ? this.zoneRectAtFocus()
        : { minX: -mb.halfW, maxX: mb.halfW, minZ: mb.zMin, maxZ: mb.zMax };
    if (!genBounds) return;
    // generateDecorationsInBounds already subtracts previously converted anchors
    // (decorationExclusions), so this is the REMAINING procedural field.
    const decorations = [
      ...generateDecorationsInBounds(this.map.meta.seed, genBounds),
      ...generateGroundDressing(this.map.meta.seed, {
        leanFoliage: GFX.leanFoliage,
        bounds: genBounds,
      }),
    ];
    const focus = this.viewport3d?.cameraFocus() ?? {
      x: 0,
      z: (genBounds.minZ + genBounds.maxZ) / 2,
    };
    // 'all' and 'zone' take the whole (remaining) field in their rect, capped by
    // the placement budget; 'batch' takes the nearest AMBIENT_TREE_EDIT_BATCH.
    const limit = mode === 'batch' ? Math.min(AMBIENT_TREE_EDIT_BATCH, room) : room;
    const selected = closestAmbientDecorations(decorations, focus, limit);
    const placements = ambientDecorationsToPlacements(selected);
    if (placements.length === 0) {
      // Nothing left to convert in this rect (already editable / empty zone).
      this.toasts.success(t('editor.foliageTool.ambientConverted', { count: 0 }));
      return;
    }
    // Converted the entire remaining field: drop the render scatter wholesale
    // (decorationsMode 'empty') instead of carrying an exclusion key per anchor.
    // Only the whole-MAP 'all' path may do this; 'zone' only ever converts its
    // own rect, so it must keep the rest of the map's procedural scatter and
    // suppress just its own anchors via exclusions.
    const convertedAll = mode === 'all' && selected.length >= decorations.length;
    const prevExclusions = [...(this.map.decorationExclusions ?? [])];
    const prevMode = this.map.decorationsMode;
    const nextExclusions = convertedAll
      ? undefined
      : [
          ...prevExclusions,
          ...selected.map(ambientDecorationKey).filter((key) => !prevExclusions.includes(key)),
        ];
    const start = appendSpan(this.map.placements, placements);
    const applyForward = (): void => {
      if (convertedAll) {
        this.map.decorationsMode = 'empty';
        this.map.decorationExclusions = undefined;
      } else {
        this.map.decorationExclusions = nextExclusions;
      }
    };
    applyForward();
    this.map.meta.updatedAt = now();
    this.refreshAmbientFoliage(start);
    this.pushUndo({
      label: 'make-ambient-foliage-editable',
      undo: () => {
        removeSpan(this.map.placements, start, placements);
        this.map.decorationsMode = prevMode;
        this.map.decorationExclusions = prevExclusions.length > 0 ? [...prevExclusions] : undefined;
        this.refreshAmbientFoliage(null);
      },
      redo: () => {
        this.map.placements.splice(start, 0, ...placements);
        applyForward();
        this.refreshAmbientFoliage(start);
      },
    });
    if (convertedAll) {
      this.toasts.success(
        t('editor.foliageTool.ambientConvertedAll', { count: placements.length }),
      );
    } else if (mode === 'all') {
      // Wanted everything but the cap clipped the batch: the rest stays
      // procedural and another pass converts more.
      this.toasts.info(t('editor.foliageTool.ambientPartial', { count: placements.length }));
    } else {
      this.toasts.success(t('editor.foliageTool.ambientConverted', { count: placements.length }));
    }
  }

  /** The enabled foliage asset ids (catalog 'foliage' category by family),
   *  plus the reserved animated-grass patch id when Grass is on. */
  private foliagePool(): string[] {
    // A picked custom asset overrides the built-in groups entirely: scatter
    // only that asset (with the same density/scale/collide controls).
    if (this.foliageCustom) return [this.foliageCustom.assetId];
    const f = this.foliage;
    const pool: string[] = [];
    if (f.grass) pool.push(GRASS_PATCH_ASSET_ID);
    for (const a of ASSET_CATALOG) {
      if (a.category !== 'foliage') continue;
      const name = a.id.slice('foliage/'.length);
      const isRock = name.startsWith('rock');
      const isBush = name.startsWith('bush');
      const isFern = name.startsWith('fern') || name.startsWith('mushroom');
      const isTree = !isRock && !isBush && !isFern;
      if (
        (isRock && f.rocks) ||
        (isBush && f.bushes) ||
        (isFern && f.ferns) ||
        (isTree && f.trees)
      ) {
        pool.push(a.id);
      }
    }
    return pool;
  }

  private foliageBegin(w: Vec2): void {
    this.foliageStroke = [];
    this.foliageStart = this.map.placements.length;
    this.foliageLast = null;
    this.foliageCapWarned = false;
    this.foliagePoolWarned = false;
    this.foliageStep(w);
  }

  /** One brush stamp: scatter `density` random pool assets inside the radius,
   *  live-added to the document; the whole stroke commits as ONE undo entry. */
  private foliageStep(w: Vec2): void {
    const spacing = Math.max(2, this.brushRadius * 0.55);
    if (this.foliageLast) {
      const dx = w.x - this.foliageLast.x;
      const dz = w.z - this.foliageLast.z;
      if (dx * dx + dz * dz < spacing * spacing) return;
    }
    const pool = this.foliagePool();
    if (pool.length === 0) {
      if (!this.foliagePoolWarned) {
        this.foliagePoolWarned = true;
        this.toasts.info(t('editor.foliageTool.noneSelected'));
      }
      return;
    }
    this.foliageLast = { x: w.x, z: w.z };
    const f = this.foliage;
    for (let k = 0; k < f.density; k++) {
      if (this.map.placements.length >= MAX_PLACEMENTS) {
        if (!this.foliageCapWarned) {
          this.foliageCapWarned = true;
          this.toasts.error(t('editor.status.placementCapReached', { max: MAX_PLACEMENTS }));
        }
        return;
      }
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * this.brushRadius;
      const scale =
        Math.round((f.minScale + Math.random() * Math.max(0, f.maxScale - f.minScale)) * 100) / 100;
      const assetId = pool[Math.floor(Math.random() * pool.length)];
      const isGrass = assetId === GRASS_PATCH_ASSET_ID;
      const placement: AssetPlacement = {
        assetId,
        x: w.x + Math.sin(ang) * rad,
        z: w.z + Math.cos(ang) * rad,
        rotY: Math.random() * Math.PI * 2,
        scale,
        // Grass is walk-through by design, like the built-in world's.
        collide: isGrass ? false : f.collide,
      };
      if (isGrass) {
        placement.hue = Math.round(f.grassHue);
        placement.lum = Math.round(f.grassLight) / 100;
        placement.clump = Math.round(f.grassClump);
      }
      if (placement.collide) applyDefaultCollision(placement);
      const index = this.map.placements.push(placement) - 1;
      this.foliageStroke.push(placement);
      this.viewport3d?.placementAdded(index);
    }
    this.canvasDirty = true;
  }

  private foliageCommit(): void {
    if (this.foliageStroke.length === 0) return;
    const placed = this.foliageStroke;
    const start = this.foliageStart;
    this.foliageStroke = [];
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'paint-foliage',
      undo: () => {
        removeSpan(this.map.placements, start, placed);
        this.setSelectedPlacement(null);
        this.viewport3d?.rebuildPlacements();
        this.canvasDirty = true;
      },
      redo: () => {
        this.map.placements.push(...placed);
        this.viewport3d?.rebuildPlacements();
        this.canvasDirty = true;
      },
    });
    this.inspector.refresh();
  }

  // ---- grass-clear brush (scrub the procedural meadow grass) ---------------------

  /** In-progress grass-clear stroke: the doc's discs plus this stroke's stamps.
   *  Applied on commit so the grass rebuilds once, not per pointer sample. */
  private grassClearStroke: GrassClearCircle[] | null = null;

  /** The document's grass-clear list, lazily created and SHARED with the active
   *  WorldContent so the render reads the live discs. */
  private grassClearRef(): GrassClearCircle[] {
    if (!this.map.grassClear) this.map.grassClear = [];
    if (this.activeWorld.grassClear !== this.map.grassClear) {
      this.activeWorld.grassClear = this.map.grassClear;
    }
    return this.map.grassClear;
  }

  /** Point the document + active world at `next` (or clear it) and rebuild the
   *  grass so scrubbed tufts vanish. The render's spatial index keys off the
   *  array identity, so a fresh array is a fresh index automatically. */
  private applyGrassClear(next: GrassClearCircle[] | undefined): void {
    if (next && next.length > 0) {
      this.map.grassClear = next;
      this.activeWorld.grassClear = next;
    } else {
      this.map.grassClear = undefined;
      this.activeWorld.grassClear = undefined;
    }
    this.viewport3d?.rebuildGrass();
    this.canvasDirty = true;
  }

  private grassClearBegin(w: Vec2): void {
    this.grassClearStroke = [...this.grassClearRef()];
    this.grassClearStep(w);
  }

  private grassClearStep(w: Vec2): void {
    if (!this.grassClearStroke) return;
    if (this.grassClearStroke.length >= MAX_GRASS_CLEAR) return;
    this.grassClearStroke = [
      ...addGrassClearStamp(this.grassClearStroke, { x: w.x, z: w.z, r: this.brushRadius }),
    ];
  }

  private grassClearCommit(): void {
    const next = this.grassClearStroke;
    this.grassClearStroke = null;
    if (!next) return;
    const prev = this.map.grassClear;
    // Every stamp was redundant (dragging inside an already-cleared disc): no-op.
    if ((prev?.length ?? 0) === next.length) return;
    this.applyGrassClear(next);
    this.map.meta.updatedAt = now();
    const prevSnapshot = prev ? [...prev] : undefined;
    const nextSnapshot = [...next];
    this.pushUndo({
      label: 'grass-clear',
      undo: () => this.applyGrassClear(prevSnapshot ? [...prevSnapshot] : undefined),
      redo: () => this.applyGrassClear([...nextSnapshot]),
    });
  }

  /** Restore all scrubbed grass (the panel's reset), one undo step. */
  private restoreAllGrass(): void {
    const prev = this.map.grassClear;
    if (!prev || prev.length === 0) return;
    const prevSnapshot = [...prev];
    this.applyGrassClear(undefined);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'restore-grass',
      undo: () => this.applyGrassClear([...prevSnapshot]),
      redo: () => this.applyGrassClear(undefined),
    });
    this.inspector.refresh();
  }

  private hasClearedGrass(): boolean {
    return (this.map.grassClear?.length ?? 0) > 0;
  }

  // ---- Paint Clutter brush ------------------------------------------------------
  // Stamps are the document truth (map.clutter, mirrored onto the active world);
  // the renderer's clutter layer re-scatters whenever the array identity changes,
  // so a stroke previews live without touching the placement list.

  private clutterRef(): ClutterStamp[] {
    if (!this.map.clutter) this.map.clutter = [];
    if (this.activeWorld.clutter !== this.map.clutter) {
      this.activeWorld.clutter = this.map.clutter;
    }
    return this.map.clutter;
  }

  /** Point the document + active world at `next` (or clear it). */
  private applyClutter(next: ClutterStamp[] | undefined): void {
    if (next && next.length > 0) {
      this.map.clutter = next;
      this.activeWorld.clutter = next;
    } else {
      this.map.clutter = undefined;
      this.activeWorld.clutter = undefined;
    }
    this.canvasDirty = true;
  }

  // ---- Mesh Fix (src/editor/mesh_fix_core.ts) -------------------------------------
  // The brush aims at the DRAWN terrain mesh (either face), not the analytic
  // surface: the leftover polys of a cut hang where the cursor sees them.
  private meshFixBegin(ev: PointerEvent | undefined): void {
    const current = this.map.terrainKnockouts ?? [];
    this.meshFixStrokeStart = current;
    this.meshFixStroke = current;
    this.meshFixCapWarned = false;
    this.meshFixStep(ev);
  }

  private meshFixStep(ev: PointerEvent | undefined): void {
    if (!this.meshFixStroke || !ev || !this.viewport3d) return;
    const hit = this.viewport3d.terrainMeshAt(ev.clientX, ev.clientY);
    if (!hit) return;
    const r = Math.min(MESH_FIX_MAX_RADIUS, Math.max(MESH_FIX_MIN_RADIUS, this.brushRadius));
    let next: readonly TerrainKnockout[];
    if (this.meshFixRestore) next = eraseKnockouts(this.meshFixStroke, hit.x, hit.z, r);
    else {
      const res = addKnockout(this.meshFixStroke, hit.x, hit.y, hit.z, r, MAX_TERRAIN_KNOCKOUTS);
      if (res.capped && !this.meshFixCapWarned) {
        this.meshFixCapWarned = true;
        this.toasts.info(t('editor.meshFixTool.capReached', { max: MAX_TERRAIN_KNOCKOUTS }));
      }
      next = res.knockouts;
    }
    if (next === this.meshFixStroke) return;
    const prev = this.meshFixStroke;
    this.meshFixStroke = next;
    this.applyMeshFix(next, prev);
  }

  private meshFixCommit(): void {
    const next = this.meshFixStroke;
    const prev = this.meshFixStrokeStart;
    this.meshFixStroke = null;
    this.meshFixStrokeStart = null;
    if (!next || !prev || next === prev) return;
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'mesh-fix',
      undo: () => this.applyMeshFix(prev, next),
      redo: () => this.applyMeshFix(next, prev),
    });
    this.inspector.refresh();
  }

  /** Install a knockout list on the document + live world and re-mesh what changed. */
  private applyMeshFix(next: readonly TerrainKnockout[], prev: readonly TerrainKnockout[]): void {
    if (next.length > 0) {
      this.map.terrainKnockouts = [...next];
      this.activeWorld.terrainKnockouts = [...next];
    } else {
      delete this.map.terrainKnockouts;
      delete this.activeWorld.terrainKnockouts;
    }
    const region = knockoutRegion(prev, next);
    if (region) this.rebuildTerrainRegion(region);
  }

  // ---- Mesh Fix: Vertices mode (src/editor/vertex_edit_core.ts) -----------------
  // SPACEY, 2026-09-20: "see all of the vertexes, select them in 1 by 1 like
  // blender ... select multiple at once ... wireframe with small square dots
  // on each vertex highlighting yellow when u select them". The dots ARE the
  // terrain lattice: the mesh regenerates per LOD, so a vertex is named by its
  // lattice coordinate, never an index into a buffer that will not exist next
  // frame.

  /** How far around the cursor the dot window reaches (yards). The whole map's
   *  lattice is millions of points; this is the handful you can actually aim
   *  at, and it re-centres as the cursor travels. */
  private static readonly VERTEX_WINDOW = 22;
  /** Yards of height per pixel of vertical drag while moving a selection. */
  private static readonly VERTEX_DRAG_SCALE = 0.05;

  vertexModeOn(): boolean {
    return this.meshFixVertexMode;
  }

  setVertexMode(on: boolean): void {
    if (this.meshFixVertexMode === on) return;
    this.meshFixVertexMode = on;
    if (!on) {
      this.vertexSel = new Set<number>();
      this.vertexDotIds = [];
      this.vertexDotPos = null;
      this.vertexWindowAt = null;
      this.viewport3d?.setVertexDots(null, null);
    }
    this.inspector.refresh();
  }

  vertexSelectionCount(): number {
    return this.vertexSel.size;
  }

  vertexEditCount(): number {
    return this.map.terrainVertexEdits?.length ?? 0;
  }

  clearVertexSelection(): void {
    if (this.vertexSel.size === 0) return;
    this.vertexSel = new Set<number>();
    this.pushVertexDots();
    this.inspector.refresh();
  }

  /** Drop every vertex move on the map (the selection is left alone). */
  clearAllVertexEdits(): void {
    const prev = this.map.terrainVertexEdits;
    if (!prev || prev.length === 0) return;
    const snapshot = [...prev];
    this.applyVertexEdits([], snapshot);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'vertex-clear',
      undo: () => this.applyVertexEdits(snapshot, []),
      redo: () => this.applyVertexEdits([], snapshot),
    });
    this.inspector.refresh();
  }

  /** Reset just the selected nodes back to the untouched surface. */
  resetSelectedVertices(): void {
    const prev = this.map.terrainVertexEdits ?? [];
    const next = clearVertexEdits(prev, this.vertexSel);
    if (next === prev) return;
    const before = [...prev];
    const after = [...next];
    this.applyVertexEdits(after, before);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'vertex-reset',
      undo: () => this.applyVertexEdits(before, after),
      redo: () => this.applyVertexEdits(after, before),
    });
    this.inspector.refresh();
  }

  /** Re-centre the dot window on a world point and push it to the viewport. */
  private refreshVertexDots(cx: number, cz: number): void {
    this.vertexDotIds = verticesNear(cx, cz, EditorApp.VERTEX_WINDOW);
    this.vertexWindowAt = { x: cx, z: cz };
    this.pushVertexDots();
  }

  /** Re-read the window's heights and selection flags and hand them over. The
   *  heights come from meshTerrainHeight, i.e. the DRAWN surface including the
   *  moves already made, so a dot always sits on the vertex it controls. */
  private pushVertexDots(): void {
    if (!this.meshFixVertexMode || this.vertexDotIds.length === 0) {
      this.viewport3d?.setVertexDots(null, null);
      return;
    }
    const n = this.vertexDotIds.length;
    if (!this.vertexDotPos || this.vertexDotPos.length !== n * 3) {
      this.vertexDotPos = new Float32Array(n * 3);
    }
    const pos = this.vertexDotPos;
    const sel = new Uint8Array(n);
    const seed = this.map.meta.seed ?? 0;
    for (let i = 0; i < n; i++) {
      const { col, row } = unpackVertex(this.vertexDotIds[i]);
      const w = vertexWorld(col, row);
      pos[i * 3] = w.x;
      pos[i * 3 + 1] = meshTerrainHeight(w.x, w.z, seed);
      pos[i * 3 + 2] = w.z;
      sel[i] = this.vertexSel.has(this.vertexDotIds[i]) ? 1 : 0;
    }
    this.viewport3d?.setVertexDots(pos, sel);
  }

  /** The select mode a pointer event's modifiers ask for. */
  private vertexSelectMode(ev: PointerEvent): SelectMode {
    if (ev.altKey) return 'remove';
    if (ev.shiftKey) return 'add';
    if (ev.ctrlKey || ev.metaKey) return 'toggle';
    return 'replace';
  }

  /** Where the pointer meets the ground for vertex work. terrainMeshAt is the
   *  strict mesh raycast and it MISSES exactly where this tool is needed ,
   *  inside a carve, over a knocked-out patch, past the built chunks, so it
   *  falls back to the same surface solve the hover window already uses. */
  private vertexPointAt(clientX: number, clientY: number): Vec2 | null {
    if (!this.viewport3d) return null;
    const mesh = this.viewport3d.terrainMeshAt(clientX, clientY);
    if (mesh) return { x: mesh.x, z: mesh.z };
    return this.viewport3d.surfaceAt(clientX, clientY);
  }

  private vertexBegin(ev: PointerEvent | undefined): void {
    if (!ev || !this.viewport3d) return;
    const hit = this.vertexPointAt(ev.clientX, ev.clientY);
    if (hit) this.refreshVertexDots(hit.x, hit.z);
    const mode = this.vertexSelectMode(ev);
    const startEdits = this.map.terrainVertexEdits ?? [];
    // Pressing ON the selection, with no modifier, grabs the whole thing and
    // drags it: the Blender gesture, and the reason a plain press never clears
    // the selection out from under you. Demanding the EXACT node was too
    // strict to hit in practice, the press and the click before it can solve
    // the surface by different paths and land a lattice step apart, so any
    // node in the 5x5 neighbourhood counts.
    let grab = false;
    if (hit && mode === 'replace' && this.vertexSel.size > 0) {
      const v = nearestVertex(hit.x, hit.z);
      for (let dr = -2; dr <= 2 && !grab; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (this.vertexSel.has(packVertex(v.col + dc, v.row + dr))) {
            grab = true;
            break;
          }
        }
      }
    }
    this.vertexDrag = {
      kind: grab ? 'move' : 'box',
      clientX: ev.clientX,
      clientY: ev.clientY,
      lastX: ev.clientX,
      lastY: ev.clientY,
      startEdits,
      startSel: this.vertexSel,
      mode,
      changed: false,
    };
  }

  private vertexStep(ev: PointerEvent | undefined): void {
    const drag = this.vertexDrag;
    if (!drag || !ev || !this.viewport3d) return;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    if (drag.kind === 'move') {
      const dy = (drag.clientY - ev.clientY) * EditorApp.VERTEX_DRAG_SCALE;
      // Always fold from the ORIGINAL list, so a drag that wanders back to
      // where it started leaves the map exactly as it was found.
      const next = moveVertices(
        drag.startEdits,
        this.vertexSel,
        Math.round(dy * 1000) / 1000,
        MAX_TERRAIN_VERTEX_EDITS,
      );
      if (next === drag.startEdits && !drag.changed) return;
      const prev = this.map.terrainVertexEdits ?? [];
      this.applyVertexEdits(next, prev);
      drag.changed = true;
      this.pushVertexDots();
      return;
    }
    // Rubber band: re-select from the ORIGINAL selection every move, so the
    // band is live and shrinking it un-selects again. The dots turning yellow
    // as the band sweeps IS the feedback; no marquee element needed.
    const inBand = this.verticesInScreenBand(drag.clientX, drag.clientY, ev.clientX, ev.clientY);
    const next = applySelection(drag.startSel, inBand, drag.mode);
    if (next !== this.vertexSel) {
      this.vertexSel = next;
      this.pushVertexDots();
    }
  }

  /** editEnd() carries no event, so the click-vs-band decision reads the last
   *  position the drag saw rather than a pointerup that never arrives here. */
  private vertexCommit(): void {
    const drag = this.vertexDrag;
    this.vertexDrag = null;
    if (!drag) return;
    if (drag.kind === 'move') {
      if (!drag.changed) return;
      const before = [...drag.startEdits];
      const after = [...(this.map.terrainVertexEdits ?? [])];
      this.map.meta.updatedAt = now();
      this.pushUndo({
        label: 'vertex-move',
        undo: () => this.applyVertexEdits(before, after),
        redo: () => this.applyVertexEdits(after, before),
      });
      this.inspector.refresh();
      return;
    }
    // A press with no travel is a CLICK on the nearest node, not an empty band.
    const travel = Math.abs(drag.lastX - drag.clientX) + Math.abs(drag.lastY - drag.clientY);
    if (travel <= 3 && this.viewport3d) {
      const hit = this.vertexPointAt(drag.lastX, drag.lastY);
      if (hit) {
        const v = nearestVertex(hit.x, hit.z);
        this.vertexSel = applySelection(drag.startSel, [packVertex(v.col, v.row)], drag.mode);
      } else if (drag.mode === 'replace') {
        this.vertexSel = new Set<number>();
      }
      this.pushVertexDots();
    }
    this.inspector.refresh();
  }

  /** Dot ids whose SCREEN position falls inside the drag rectangle. Screen
   *  space, not a world rect: the camera is usually tilted, and a world-space
   *  box under a tilted view selects a visibly different set from the one the
   *  band is drawn around. */
  private verticesInScreenBand(x0: number, y0: number, x1: number, y1: number): number[] {
    if (!this.viewport3d || !this.vertexDotPos) return [];
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const out: number[] = [];
    const pos = this.vertexDotPos;
    for (let i = 0; i < this.vertexDotIds.length; i++) {
      const p = this.viewport3d.projectPoint(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      if (!p) continue;
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      out.push(this.vertexDotIds[i]);
    }
    return out;
  }

  /** Install a vertex-edit list on the document + live world and re-mesh what
   *  changed. The generation bump is REQUIRED: terrain_vertex_edits.ts memoises
   *  its hash grid on it, and the array is mutated in place here. */
  private applyVertexEdits(
    next: readonly TerrainVertexEdit[],
    prev: readonly TerrainVertexEdit[],
  ): void {
    if (next.length > 0) {
      this.map.terrainVertexEdits = [...next];
      this.activeWorld.terrainVertexEdits = this.map.terrainVertexEdits;
    } else {
      delete this.map.terrainVertexEdits;
      delete this.activeWorld.terrainVertexEdits;
    }
    touchActiveWorldContent();
    const region = vertexEditRegion(prev, next);
    if (region) this.rebuildTerrainRegion(region);
    this.pushVertexDots();
  }

  private clearMeshFix(): void {
    const prev = this.map.terrainKnockouts;
    if (!prev || prev.length === 0) return;
    const snapshot = [...prev];
    this.applyMeshFix([], snapshot);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'mesh-fix-clear',
      undo: () => this.applyMeshFix(snapshot, []),
      redo: () => this.applyMeshFix([], snapshot),
    });
    this.inspector.refresh();
  }

  private clutterBegin(w: Vec2): void {
    if (!this.clutter.erase && (this.clutter.kinds & CLUTTER_ALL_KINDS) === 0) {
      this.toasts.info(t('editor.clutterTool.noneSelected'));
      return;
    }
    const current = this.clutterRef();
    this.clutterStrokeStart = [...current];
    this.clutterStroke = current;
    this.clutterLast = null;
    this.clutterCapWarned = false;
    this.clutterStep(w);
  }

  private clutterStep(w: Vec2): void {
    if (!this.clutterStroke) return;
    const r = this.brushRadius;
    if (!clutterStampDue(this.clutterLast, w.x, w.z, r)) return;
    this.clutterLast = { x: w.x, z: w.z };
    const seed = (Math.random() * 0x7fffffff) >>> 0;
    const result = applyClutterBrush(this.clutterStroke, this.clutter, w.x, w.z, r, seed);
    if (result.capped && !this.clutterCapWarned) {
      this.clutterCapWarned = true;
      this.toasts.info(t('editor.clutterTool.capReached', { max: MAX_CLUTTER_STAMPS }));
    }
    if (result.stamps === this.clutterStroke) return;
    this.clutterStroke = result.stamps;
    this.applyClutter([...result.stamps]);
  }

  private clutterCommit(): void {
    const next = this.clutterStroke;
    const prev = this.clutterStrokeStart;
    this.clutterStroke = null;
    this.clutterStrokeStart = undefined;
    this.clutterLast = null;
    if (!next || !prev) return;
    if (next === this.map.clutter && prev.length === next.length) return; // nothing changed
    this.map.meta.updatedAt = now();
    const prevSnapshot = [...prev];
    const nextSnapshot = [...next];
    this.pushUndo({
      label: this.clutter.erase ? 'erase-clutter' : 'paint-clutter',
      undo: () => {
        this.applyClutter(prevSnapshot.length > 0 ? [...prevSnapshot] : undefined);
        this.viewport3d?.rebuildClutter();
      },
      redo: () => {
        this.applyClutter(nextSnapshot.length > 0 ? [...nextSnapshot] : undefined);
        this.viewport3d?.rebuildClutter();
      },
    });
    this.inspector.refresh();
  }

  /** Remove every painted clutter stamp (the panel's reset), one undo step. */
  private clearAllClutter(): void {
    const prev = this.map.clutter;
    if (!prev || prev.length === 0) return;
    const prevSnapshot = [...prev];
    this.applyClutter(undefined);
    this.viewport3d?.rebuildClutter();
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'clear-clutter',
      undo: () => {
        this.applyClutter([...prevSnapshot]);
        this.viewport3d?.rebuildClutter();
      },
      redo: () => {
        this.applyClutter(undefined);
        this.viewport3d?.rebuildClutter();
      },
    });
    this.inspector.refresh();
  }

  /** A moved placement's seat: detached to float where it is (the default),
   *  or re-seated on the ground under its new spot when snapping is on. */
  private moveSeat(index: number): void {
    if (this.map.meta.overworldBase && !this.snapToGroundOnMove) return;
    if (!this.snapToGroundOnMove) {
      this.detachPlacement(index);
      return;
    }
    const p = this.map.placements[index];
    if (!p || isOnGround(p)) return;
    seatOnGround(p);
    this.viewport3d?.placementUpdated(index, { detached: false, y: 0 });
  }

  /** Flatten: a right-click on the ground locks the level every drag
   *  flattens to. */
  private rightTap3d(w: Vec2 | null): void {
    if (!w) return;
    if (this.tool === 'slope') {
      this.slopeStart = { x: w.x, z: w.z, y: terrainHeight(w.x, w.z, this.map.meta.seed) };
      this.toasts.info(
        t('editor.slope.startPicked', {
          height: formatNumber(this.slopeStart.y, { maximumFractionDigits: 2 }),
        }),
      );
      this.inspector.refresh();
      return;
    }
    if (this.tool !== 'flatten' || this.flattenSmooth) return;
    this.flattenLock = terrainHeight(w.x, w.z, this.map.meta.seed);
    this.toasts.info(
      t('editor.flatten.levelPicked', {
        height: formatNumber(this.flattenLock, { maximumFractionDigits: 2 }),
      }),
    );
    this.inspector.refresh();
  }

  /** The pre-gesture finishes of a live material edit (one undo per gesture),
   *  keyed to the placement it was taken from; cleared on selection change. */
  private materialFinishBase: { index: number; value: MaterialFinishes | undefined } | null = null;

  /** Set or clear one material slot's finish on the selected placement.
   *  `commit` closes the gesture with one undo step; live edits (a color
   *  drag) only repaint. */
  private setMaterialFinish(key: string, finish: WallFinish | null, commit: boolean): void {
    const index = this.selectedPlacement;
    if (index === null || !this.map.placements[index]) return;
    if (this.materialFinishBase?.index !== index) {
      this.materialFinishBase = {
        index,
        value: cloneMaterialFinishes(this.map.placements[index]?.materialFinishes),
      };
    }
    const apply = (value: MaterialFinishes | undefined): void => {
      const p = this.map.placements[index];
      if (!p) return;
      if (value) p.materialFinishes = value;
      else delete p.materialFinishes;
      this.viewport3d?.placementUpdated(index, { materialFinishes: value ?? null });
      this.canvasDirty = true;
    };
    const next = withMaterialFinish(this.map.placements[index]?.materialFinishes, key, finish);
    apply(next);
    if (!commit) return;
    const before = this.materialFinishBase.value;
    this.materialFinishBase = null;
    this.pushUndo({
      label: 'material-finish',
      undo: () => {
        apply(before);
        this.inspector.refresh();
      },
      redo: () => {
        apply(next);
        this.inspector.refresh();
      },
    });
    this.map.meta.updatedAt = now();
    this.inspector.refresh();
  }

  /** Cave and rock rig markers: their elevation is part of the rig. */
  private isRigMarkerAsset(assetId: string): boolean {
    return (
      assetId === CAVE_ENTRANCE_ASSET_ID ||
      assetId === CAVE_EXIT_ASSET_ID ||
      assetId === CAVE_POINT_ASSET_ID ||
      assetId === ROCK_POINT_ASSET_ID
    );
  }

  /** Seat every selected placement on the terrain under it (one undo step). */
  private setSelectionToGround(): void {
    const indices = new Set(this.selectedSet);
    if (this.selectedPlacement !== null) indices.add(this.selectedPlacement);
    const changed: { index: number; before: GroundSeat }[] = [];
    for (const index of indices) {
      const p = this.map.placements[index];
      // Rig markers keep their anchored elevation (see updateSelectedPlacement).
      if (!p || isOnGround(p) || this.isRigMarkerAsset(p.assetId)) continue;
      changed.push({ index, before: groundSeatOf(p) });
    }
    if (changed.length === 0) return;
    const push = (seat: (index: number) => GroundSeat | null): void => {
      for (const { index } of changed) {
        const p = this.map.placements[index];
        if (!p) continue;
        const s = seat(index);
        if (s) applyGroundSeat(p, s);
        else seatOnGround(p);
        this.viewport3d?.placementUpdated(index, {
          detached: p.detached === true,
          groundY: p.groundY,
          y: p.y ?? 0,
        });
      }
      this.canvasDirty = true;
      this.inspector.refresh();
    };
    push(() => null);
    this.pushUndo({
      label: 'set-to-ground',
      undo: () => push((index) => changed.find((c) => c.index === index)?.before ?? null),
      redo: () => push(() => null),
    });
    this.map.meta.updatedAt = now();
  }

  /** Detach a placement from its terrain seat (Move tool): freeze the ground
   *  height at its CURRENT position so the model floats there instead of
   *  re-snapping as it moves. No-op once already detached; pushes the flag to the
   *  render view immediately so the live drag renders in free-float mode. */
  private detachPlacement(index: number): void {
    const p = this.map.placements[index];
    if (!p || p.detached) return;
    p.detached = true;
    p.groundY = terrainHeight(p.x, p.z, this.map.meta.seed);
    this.viewport3d?.placementUpdated(index, {
      detached: true,
      groundY: p.groundY,
    });
  }

  // ---- hitbox editing (baked-collision boxes as first-class objects) ------------

  /** The hitboxes the RENDER footprint should draw for a placement (what the
   *  sim will block with): fine mesh bake, hand-edited boxes, or null (the
   *  generated baked set / legacy footprint applies). */
  private resolvedHitboxesFor(p: AssetPlacement): MapHitbox[] | null {
    const mode = effectiveCollisionMode(p);
    if (mode === 'mesh') {
      const fine = this.map.assetCollisionMesh?.[p.assetId];
      return fine && fine.length > 0 ? fine.map((b) => ({ ...b })) : null;
    }
    if (mode === 'baked' && p.hitboxes && p.hitboxes.length > 0) {
      return p.hitboxes.map((b) => ({ ...b }));
    }
    return null;
  }

  /** Enter hitbox-edit mode for the selected placement: materialize the baked
   *  boxes onto the placement (one undo entry) so they become editable. */
  private enterHitboxEdit(): void {
    // A mesh-edit session (Collision Master / Build) edits MESH volumes, not the
    // derived box set: the box editor opening there would fight the mesh view.
    if (this.meshEditActive()) return;
    const index = this.selectedPlacement;
    if (index === null) return;
    const p = this.map.placements[index];
    if (!p) return;
    if (!p.hitboxes || p.hitboxes.length === 0) {
      this.setHitboxes(index, this.materializeHitboxes(p), 'edit-hitboxes');
    }
    this.hitboxEdit = { index, selected: new Set() };
    this.selectionQuickActions?.refresh();
    this.syncFootprintOverlay();
    this.syncHitboxEditView();
    this.inspector.refresh();
  }

  private exitHitboxEdit(): void {
    if (!this.hitboxEdit) return;
    this.hitboxEdit = null;
    this.selectionQuickActions?.refresh();
    this.hitboxDragBase = null;
    this.viewport3d?.setHitboxEdit(null);
    this.syncFootprintOverlay();
    this.inspector.refresh();
  }

  /** The starting editable box set: the asset's baked boxes (catalogue or
   *  imported), else one crate-sized box derived from the collide radius. */
  private materializeHitboxes(p: AssetPlacement): MapHitbox[] {
    const baked = boxesForAssetId(p.assetId) ?? this.map.assetCollision?.[p.assetId];
    if (baked && baked.length > 0) {
      return baked.slice(0, MAX_PLACEMENT_HITBOXES).map((b) => ({ ...b }));
    }
    const r = Math.max(0.3, collideRadiusFor(1, p.assetId));
    return [{ x: 0, y: r, z: 0, hx: r, hy: r, hz: r }];
  }

  /** Push the current edit state (boxes + selection) to the 3D overlay. */
  private syncHitboxEditView(): void {
    if (!this.hitboxEdit) {
      this.viewport3d?.setHitboxEdit(null);
      return;
    }
    const p = this.map.placements[this.hitboxEdit.index];
    if (!p || !p.hitboxes || p.hitboxes.length === 0) {
      this.exitHitboxEdit();
      return;
    }
    // Undo can shrink the box list under a live selection: drop strays.
    for (const i of [...this.hitboxEdit.selected]) {
      if (i >= p.hitboxes.length) this.hitboxEdit.selected.delete(i);
    }
    this.viewport3d?.setHitboxEdit({
      index: this.hitboxEdit.index,
      boxes: p.hitboxes,
      selected: [...this.hitboxEdit.selected],
    });
  }

  /** One live gizmo sample over the selected hitboxes: apply the world-space
   *  gesture delta to the gesture-start snapshot in model space. */
  private applyHitboxGizmo(change: GizmoHitboxChange): void {
    const he = this.hitboxEdit;
    if (!he) return;
    const p = this.map.placements[he.index];
    if (!p || !p.hitboxes || he.selected.size === 0) return;
    if (!this.hitboxDragBase) this.hitboxDragBase = p.hitboxes.map((b) => ({ ...b }));
    const base = this.hitboxDragBase;
    const s = p.scale > 0 ? p.scale : 1;
    const sx = s * (p.scaleX ?? 1);
    const sy = s * (p.scaleY ?? 1);
    const sz = s * (p.scaleZ ?? 1);
    // Pivot: the selection's centroid in model space (rotate/scale anchor).
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let n = 0;
    for (const i of he.selected) {
      const b = base[i];
      if (!b) continue;
      cx += b.x;
      cy += b.y;
      cz += b.z;
      n++;
    }
    if (n === 0) return;
    cx /= n;
    cy /= n;
    cz /= n;
    const clampC = (v: number): number => Math.max(-100, Math.min(100, v));
    const clampH = (v: number): number => Math.max(0.05, Math.min(60, v));
    const boxes = base.map((b) => ({ ...b }));
    const cos = Math.cos(p.rotY);
    const sin = Math.sin(p.rotY);
    for (const i of he.selected) {
      const b = boxes[i];
      const b0 = base[i];
      if (!b || !b0) continue;
      if (change.dx !== undefined || change.dz !== undefined || change.dy !== undefined) {
        const dx = change.dx ?? 0;
        const dz = change.dz ?? 0;
        // World delta -> model space: rotate by -rotY (three.js Y convention),
        // then divide out the per-axis world scale.
        const lx = (dx * cos - dz * sin) / (sx || 1);
        const lz = (dx * sin + dz * cos) / (sz || 1);
        b.x = clampC(b0.x + lx);
        b.z = clampC(b0.z + lz);
        if (change.dy !== undefined) b.y = clampC(b0.y + change.dy / (sy || 1));
      }
      if (change.dRotY !== undefined) {
        // Orbit the centroid and spin the box itself (per-box yaw).
        const ox = b0.x - cx;
        const oz = b0.z - cz;
        const cd = Math.cos(change.dRotY);
        const sd = Math.sin(change.dRotY);
        b.x = clampC(cx + ox * cd + oz * sd);
        b.z = clampC(cz - ox * sd + oz * cd);
        const ry = wrapAngle((b0.ry ?? 0) + change.dRotY);
        if (ry === 0) delete b.ry;
        else b.ry = ry;
      }
      if (change.ratio !== undefined) {
        const r = Math.max(0.02, Math.min(50, change.ratio));
        const axis = change.axis ?? 'uniform';
        if (axis === 'uniform') {
          b.hx = clampH(b0.hx * r);
          b.hy = clampH(b0.hy * r);
          b.hz = clampH(b0.hz * r);
          b.x = clampC(cx + (b0.x - cx) * r);
          b.y = clampC(cy + (b0.y - cy) * r);
          b.z = clampC(cz + (b0.z - cz) * r);
        } else if (axis === 'x') {
          b.hx = clampH(b0.hx * r);
          b.x = clampC(cx + (b0.x - cx) * r);
        } else if (axis === 'y') {
          b.hy = clampH(b0.hy * r);
          b.y = clampC(cy + (b0.y - cy) * r);
        } else {
          b.hz = clampH(b0.hz * r);
          b.z = clampC(cz + (b0.z - cz) * r);
        }
      }
    }
    p.hitboxes = boxes;
    this.viewport3d?.placementUpdated(he.index, {
      hitboxes: boxes.map((b) => ({ ...b })),
    });
    this.syncHitboxEditView();
    this.canvasDirty = true;
  }

  /** End-of-gesture commit for a hitbox gizmo drag: ONE undo entry. */
  private commitHitboxes(): void {
    const he = this.hitboxEdit;
    const prev = this.hitboxDragBase;
    this.hitboxDragBase = null;
    if (!he || !prev) return;
    const index = he.index;
    const p = this.map.placements[index];
    if (!p || !p.hitboxes) return;
    const next = p.hitboxes.map((b) => ({ ...b }));
    if (JSON.stringify(next) === JSON.stringify(prev)) return;
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.pushUndo({
      label: 'edit-hitboxes',
      undo: () => this.restoreHitboxes(index, prev),
      redo: () => this.restoreHitboxes(index, next),
    });
  }

  private restoreHitboxes(index: number, boxes: MapHitbox[] | undefined): void {
    const p = this.map.placements[index];
    if (!p) return;
    if (boxes && boxes.length > 0) p.hitboxes = boxes.map((b) => ({ ...b }));
    else delete p.hitboxes;
    this.afterHitboxesChanged(index);
  }

  private afterHitboxesChanged(index: number): void {
    const p = this.map.placements[index];
    this.viewport3d?.placementUpdated(index, {
      hitboxes: p ? this.resolvedHitboxesFor(p) : null,
    });
    if (this.hitboxEdit?.index === index) this.syncHitboxEditView();
    this.canvasDirty = true;
  }

  /** Replace a placement's hitboxes outright (add/delete/reset/preset paths):
   *  ONE undo entry. `next` undefined clears back to the baked set. */
  private setHitboxes(index: number, next: MapHitbox[] | undefined, label: string): void {
    const p = this.map.placements[index];
    if (!p) return;
    const prev = p.hitboxes ? p.hitboxes.map((b) => ({ ...b })) : undefined;
    const clamped = next?.slice(0, MAX_PLACEMENT_HITBOXES);
    this.restoreHitboxes(index, clamped);
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.pushUndo({
      label,
      undo: () => this.restoreHitboxes(index, prev),
      redo: () => this.restoreHitboxes(index, clamped),
    });
  }

  private addHitbox(): void {
    const he = this.hitboxEdit;
    if (!he) return;
    const p = this.map.placements[he.index];
    if (!p) return;
    const boxes = p.hitboxes ? p.hitboxes.map((b) => ({ ...b })) : [];
    if (boxes.length >= MAX_PLACEMENT_HITBOXES) {
      this.toasts.error(t('editor.selection.hitboxCap', { max: MAX_PLACEMENT_HITBOXES }));
      return;
    }
    boxes.push({ x: 0, y: 1, z: 0, hx: 1, hy: 1, hz: 1 });
    this.setHitboxes(he.index, boxes, 'add-hitbox');
    he.selected.clear();
    he.selected.add(boxes.length - 1);
    this.syncHitboxEditView();
    this.inspector.refresh();
  }

  private deleteSelectedHitboxes(): void {
    const he = this.hitboxEdit;
    if (!he || he.selected.size === 0) return;
    const p = this.map.placements[he.index];
    if (!p || !p.hitboxes) return;
    const boxes = p.hitboxes.filter((_, i) => !he.selected.has(i)).map((b) => ({ ...b }));
    he.selected.clear();
    if (boxes.length === 0) {
      // Deleting every box = no collision left to edit: fall back to 'none'.
      this.setHitboxes(he.index, undefined, 'delete-hitbox');
      this.updateSelectedPlacement({ collisionMode: 'none' }, true);
      this.exitHitboxEdit();
      return;
    }
    this.setHitboxes(he.index, boxes, 'delete-hitbox');
    this.syncHitboxEditView();
    this.inspector.refresh();
  }

  /** Discard the hand-edits: back to the asset's baked box set. */
  private resetHitboxes(): void {
    const index = this.hitboxEdit?.index ?? this.selectedPlacement;
    if (index === null) return;
    this.exitHitboxEdit();
    this.setHitboxes(index, undefined, 'reset-hitboxes');
    this.inspector.refresh();
  }

  // ---- hitbox presets (localStorage, per asset) ---------------------------------

  private saveHitboxPreset(): void {
    const index = this.selectedPlacement;
    const p = index === null ? undefined : this.map.placements[index];
    if (!p || !p.hitboxes || p.hitboxes.length === 0) return;
    this.hitboxPresets[p.assetId] = p.hitboxes.map((b) => ({ ...b }));
    writeJsonPref(HITBOX_PRESETS_PREF_KEY, this.hitboxPresets);
    this.toasts.info(
      t('editor.selection.hitboxPresetSaved', {
        name: this.placementLabel(p.assetId),
      }),
    );
    this.inspector.refresh();
  }

  private clearHitboxPreset(): void {
    const index = this.selectedPlacement;
    const p = index === null ? undefined : this.map.placements[index];
    if (!p || !this.hitboxPresets[p.assetId]) return;
    delete this.hitboxPresets[p.assetId];
    writeJsonPref(HITBOX_PRESETS_PREF_KEY, this.hitboxPresets);
    this.toasts.info(t('editor.selection.hitboxPresetCleared'));
    this.inspector.refresh();
  }

  // ---- Collision Master (per-asset authored collision -> repo default) ----------

  /** Active Collision Master session: a dedicated single-asset authoring scene
   *  entered from the asset browser. The working map is saved to the local
   *  store on entry and restored on exit. Lock In posts the authored collision
   *  to the dev server (/__collision_master/save), which writes
   *  data/asset_collision_overrides.json + the generated module - making it
   *  the asset's DEFAULT collision everywhere from then on. */
  private collisionMaster: {
    assetId: string;
    label: string;
    returnMapId: string;
    /** The working map object itself: the return trip must not depend on
     *  browser storage (quota-blocked storage stranded makers in CM). */
    returnMap: CustomMap | null;
    /** Placement selected in the working map at entry. Restoring it on exit
     *  keeps the transform gizmo attached through the preserved-world swap. */
    returnSelection: number | null;
    /** Viewport camera at entry: exiting restores the maker to exactly where
     *  they were in the world (no flying back to the edited asset). */
    returnCam: { x: number; y: number; z: number; yaw: number; pitch: number; dist: number } | null;
    /** True when the world renderer and its streamed terrain stayed resident. */
    terrainPreserved: boolean;
  } | null = null;
  /** The floating modeling toolbar over the 3D stage (CM sessions only). */
  private cmBar: CollisionMasterBar | null = null;
  /** Poly-snap brush: drag across the model surface to lay a collision plane
   *  hugging the sampled geometry (built as a thin yawed box). */
  private cmPolySnap = false;
  private cmPolyPoints: { x: number; y: number; z: number }[] | null = null;
  /** Poly Build: click-drag a face to extrude it (Blender Poly Build). Toggle,
   *  mutually exclusive with poly-snap; both claim the pointer drag. */
  private cmPolyBuild = false;
  /** In-flight extrude drag: the mesh before/after the extrude, the new cap
   *  verts, and the world-space axis + start parameter along it. */
  private cmPolyBuildDrag: {
    vi: number;
    pre: CmMesh;
    base: CmMesh;
    newVerts: number[];
    axis: [number, number, number];
    origin: [number, number, number];
    t0: number;
  } | null = null;
  /** v3: the session's EDITABLE truth, real triangle-mesh volumes (Blender
   *  semantics). The placement's hitboxes are DERIVED (meshToHitboxes) so the
   *  footprint canvas and Lock In stay sim-accurate. */
  private cmVolumes: CmMesh[] = [];
  /** Volume + component selection (verts of the selected volume, sub modes). */
  private cmSel: { volume: number | null; verts: number[] } = { volume: null, verts: [] };
  /** Gesture-start snapshot of the edited volume (gizmo drags apply world
   *  deltas to it, mirroring the hitbox gizmo contract). */
  private cmDragBase: CmMesh | null = null;
  /** Session-local undo (Blender's edit-mode undo): volume-set snapshots. */
  private cmHistory: CmMesh[][] = [];
  private cmHistoryIdx = -1;
  /** Dynamic surface sculpting reuses the Build/CM mesh truth. Settings stay
   *  session-local and the selected brush claims pointer drags. */
  private cmSculptTool: CmSculptTool | null = null;
  private cmSculptRadius = 2;
  private cmSculptStrength = 0.18;
  private cmSculptDynamic = true;
  private cmSculptTargetEdge = 0.4;
  private cmSculptSymmetry: CmSculptSymmetry = { x: false, y: false, z: false };
  private cmSculptStroke: {
    vi: number;
    pre: CmMesh;
    base: CmMesh;
    center: [number, number, number];
    worldCenter: [number, number, number];
    startClientX: number;
    startClientY: number;
    lastClientX: number;
    lastClientY: number;
    changed: boolean;
  } | null = null;

  /** Build tool session: the SAME mesh-editing substrate as Collision Master
   *  (cmVolumes/cmSel/cmHistory/cmBar/gizmo/primitives/poly-snap), but editing
   *  a persistent, textured, renderable MODEL_ASSET_ID placement IN the live
   *  map at its world location, no scratch scene, no studio mode. `index` is
   *  that placement's document index. Mutually exclusive with collisionMaster. */
  private buildSession: { index: number } | null = null;
  /** Surface texture for the NEXT built model (per-model once created). */
  private buildTexId: string | undefined = 'Rock051';
  private buildTexTile = DEFAULT_MODEL_TEX_TILE;

  /** True in EITHER mesh-editing mode (Collision Master or Build): the shared
   *  cmVolumes machinery is live. */
  private meshEditActive(): boolean {
    return this.collisionMaster !== null || this.buildSession !== null;
  }

  /** The document index of the placement the mesh-edit session operates on:
   *  0 for the Collision Master scratch scene, the model's index for Build. */
  private meshEditIndex(): number | null {
    if (this.buildSession) return this.buildSession.index;
    if (this.collisionMaster) return 0;
    return null;
  }

  private meshEditPlacement(): AssetPlacement | null {
    const i = this.meshEditIndex();
    return i === null ? null : (this.map.placements[i] ?? null);
  }

  private collisionMasterVm(): { assetId: string; label: string; canSave: boolean } | null {
    const cm = this.collisionMaster;
    return cm ? { assetId: cm.assetId, label: cm.label, canSave: import.meta.env.DEV } : null;
  }

  private enterCollisionMaster(assetId: string, label: string): void {
    if (this.collisionMaster) return;
    if (!assetById(assetId)) {
      // Only catalogue assets can persist a repo default; imported models keep
      // their per-map import bake.
      this.toasts.error(t('editor.collisionMaster.catalogOnly'));
      return;
    }
    // The working map is stashed IN MEMORY for the return trip, so Collision
    // Master opens even when browser storage is full/blocked. The store save
    // is best-effort on top: it makes the return survive a page reload (the
    // Lock In HMR reload boots the most recent save).
    const returnMap = this.map;
    if (!this.io.saveLocal(this.map)) {
      this.toasts.info(t('editor.collisionMaster.stashOnly'));
    }
    const returnMapId = this.map.meta.id;
    const cm = newFlatCustomMap(
      t('editor.collisionMaster.mapName', { name: label }),
      mintId(),
      now(),
      { width: 60, height: 60 },
    );
    // The studio is a void, not a playfield: no perimeter walls on the
    // horizon (the scratch scene never ships and playtest re-adds its own).
    cm.blockers = [];
    const placement: AssetPlacement = {
      assetId,
      x: 0,
      z: 0,
      rotY: 0,
      scale: 1,
      collide: true,
      // Collision Master is a zero-height workbench. Detaching it keeps the
      // studio independent of the preserved world's terrain sampler.
      detached: true,
      groundY: 0,
    };
    // Seed the scene with the asset's CURRENT default so editing starts from
    // the truth: authored override > box set (authored or baked) > heuristics.
    const authored = collisionOverrideFor(assetId);
    if (authored?.mode === 'none') {
      placement.collisionMode = 'none';
    } else if (authored?.mode === 'basic') {
      placement.collisionMode = 'basic';
      if (authored.shape === 'square') placement.collideShape = 'square';
      if (authored.radius !== undefined) placement.collideRadius = authored.radius;
    } else {
      const boxes = boxesForAssetId(assetId);
      if (boxes && boxes.length > 0) {
        placement.collisionMode = 'baked';
        placement.hitboxes = boxes.slice(0, MAX_PLACEMENT_HITBOXES).map((b) => ({ ...b }));
      } else {
        applyDefaultCollision(placement);
      }
    }
    cm.placements.push(placement);
    const camNow = this.viewport3d?.dungeonStagePort()?.cam ?? null;
    const returnCam = camNow
      ? {
          x: camNow.target.x,
          y: camNow.target.y,
          z: camNow.target.z,
          yaw: camNow.yaw,
          pitch: camNow.pitch,
          dist: camNow.dist,
        }
      : null;
    this.collisionMaster = {
      assetId,
      label,
      returnMapId,
      returnMap,
      returnSelection: this.selectedPlacement,
      returnCam,
      terrainPreserved: false,
    };
    this.cmPolySnap = false;
    this.cmPolyBuild = false;
    this.cmPolyBuildDrag = null;
    this.cmSculptTool = null;
    this.cmSculptStroke = null;
    this.cmSubMode = 'object';
    // v3 mesh volumes: authored meshes restore EXACTLY; otherwise the box set
    // opens as editable box meshes.
    const authoredMeshes = (authored?.meshes ?? [])
      .map((m) => sanitizeCmMesh(m))
      .filter((m): m is CmMesh => m !== null);
    this.cmVolumes =
      authoredMeshes.length > 0
        ? authoredMeshes
        : (placement.hitboxes ?? []).map((b) => meshFromHitbox(b));
    this.cmSel = { volume: this.cmVolumes.length > 0 ? 0 : null, verts: [] };
    this.cmDragBase = null;
    this.cmHistory = [this.cmVolumes.map(cloneMesh)];
    this.cmHistoryIdx = 0;
    // Hide the live world before swapping the studio props in. Its terrain
    // renderer and prepared chunk cache remain alive behind the studio.
    this.viewport3d?.setStudioMode(true);
    this.pendingFocus = {
      x: placement.x,
      z: placement.z,
      extent: Math.max(2.5, placement.scale * 2.5),
      y: 0,
    };
    const terrainPreserved = this.loadMap(cm, { preserveViewportTerrain: true });
    if (this.collisionMaster) this.collisionMaster.terrainPreserved = terrainPreserved;
    // Move tool by default: selecting any volume/vertex/edge/face shows the
    // gizmo immediately (the goal of the whole scene is transform work).
    this.setTool('move');
    this.setSelectedPlacement(0);
    // The studio: a neutral backdrop outside the world, no terrain, no sky,
    // just the asset on a grid floor.
    this.syncCmView();
    this.cmBar?.setVisible(true);
    this.inspector.refresh();
  }

  /** Camera focus applied after the next 3D viewport reload completes. */
  private pendingFocus: { x: number; z: number; extent: number; y: number } | null = null;

  /** Full camera pose reapplied after the next 3D viewport reload completes
   *  (the Collision Master exit's return-to-where-you-were). Outranks the
   *  reload's frame-all; pendingFocus wins when both are set. */
  private pendingCamera: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    dist: number;
  } | null = null;

  private exitCollisionMaster(): void {
    const cm = this.collisionMaster;
    if (!cm) return;
    const cmMapId = this.map.meta.id;
    this.collisionMaster = null;
    this.cmPolySnap = false;
    this.cmPolyBuild = false;
    this.cmPolyBuildDrag = null;
    this.cmSculptTool = null;
    this.cmSculptStroke = null;
    this.cmPolyPoints = null;
    this.cmSubMode = 'object';
    this.cmVolumes = [];
    this.cmSel = { volume: null, verts: [] };
    this.cmDragBase = null;
    this.cmHistory = [];
    this.cmHistoryIdx = -1;
    this.cmBar?.setVisible(false);
    this.viewport3d?.setCmMeshState(null);
    this.viewport3d?.setStudioMode(false);
    this.viewport3d?.setHitboxSubMode(null);
    this.exitHitboxEdit();
    this.pendingFocus = null; // an unconsumed enter-focus must not retarget the restored map
    // The scratch scene must never resurface as a resumable draft.
    this.io.draftClear(cmMapId);
    // The in-memory stash is the primary return path (works with blocked
    // storage); the store copy only matters across a page reload.
    const back = cm.returnMap ?? this.io.store.load(cm.returnMapId);
    // Return the maker to exactly where they were: the reload frames the whole
    // map, so the entry camera is reapplied once the 3D rebuild lands.
    this.pendingCamera = cm.returnCam;
    if (back) {
      this.loadMap(back, { preserveViewportTerrain: cm.terrainPreserved });
      const restored =
        cm.returnSelection !== null && back.placements[cm.returnSelection]
          ? cm.returnSelection
          : null;
      this.setSelectedPlacement(restored);
      this.inspector.refresh();
    } else {
      this.loadMap(newCustomMap(t('editor.untitledMap'), mintId(), now()));
    }
  }

  // ---- Build tool: model a persistent, textured, collidable object in place --

  /** Click with the Build tool: drop a fresh model (a seed box) at the point
   *  and open the in-place mesh-editing session on it. */
  private buildClick(w: Vec2): void {
    if (this.meshEditActive()) return;
    if (this.map.placements.length >= MAX_PLACEMENTS) {
      this.toasts.error(t('editor.status.placementCapReached', { max: MAX_PLACEMENTS }));
      return;
    }
    // A 2yd cube rising from the ground: a solid to start carving from.
    const seed = cmBox(1, 1, 1, 1);
    const placement: AssetPlacement = {
      assetId: MODEL_ASSET_ID,
      x: w.x,
      z: w.z,
      rotY: 0,
      scale: 1,
      collide: false,
      collisionMode: 'none',
      meshes: [{ verts: seed.verts.slice(), tris: seed.tris.slice() }],
    };
    if (this.buildTexId) {
      placement.modelTexId = this.buildTexId;
      placement.modelTexTile = this.buildTexTile;
    }
    this.appendPlacements([placement], 'build-model');
    const index = this.map.placements.length - 1;
    if (this.map.placements[index]?.assetId !== MODEL_ASSET_ID) return; // clamped away
    this.enterBuildSession(index);
  }

  /** Open the Build editing session on an existing model placement. */
  private enterBuildSession(index: number): void {
    if (this.meshEditActive()) return;
    const p = this.map.placements[index];
    if (!p || p.assetId !== MODEL_ASSET_ID) return;
    this.buildSession = { index };
    this.cmPolySnap = false;
    this.cmPolyBuild = false;
    this.cmPolyBuildDrag = null;
    this.cmSculptTool = null;
    this.cmSculptStroke = null;
    this.cmPolyPoints = null;
    this.cmSubMode = 'object';
    const meshes = (p.meshes ?? [])
      .map((m) => sanitizeCmMesh(m))
      .filter((m): m is CmMesh => m !== null);
    this.cmVolumes = meshes.length > 0 ? meshes : [cmBox(1, 1, 1, 1)];
    this.cmSel = { volume: this.cmVolumes.length > 0 ? 0 : null, verts: [] };
    this.cmDragBase = null;
    this.cmHistory = [this.cmVolumes.map(cloneMesh)];
    this.cmHistoryIdx = 0;
    // The mesh gizmo needs a transform tool + a selected placement to show.
    this.setTool('move');
    this.setSelectedPlacement(index);
    this.cmBar?.setVisible(true);
    this.syncCmView();
    this.inspector.refresh();
    this.toasts.info(t('editor.build.entered'));
  }

  /** Write the session's volumes back to the model placement and rebuild its
   *  solid: the geometry IS the model; collision (when enabled) decomposes the
   *  same volumes into blocking boxes + walkable ramps (meshToHitboxes/Ramp). */
  private deriveBuildModel(): void {
    const bs = this.buildSession;
    if (!bs) return;
    const p = this.map.placements[bs.index];
    if (!p) return;
    p.meshes = this.cmVolumes.map((m) => roundMesh(m));
    if (p.collisionMode !== 'none' && p.collide) {
      const boxes = this.cmVolumes
        .filter((m) => !m.ramp)
        .flatMap((m) => meshToHitboxes(m))
        .slice(0, MAX_PLACEMENT_HITBOXES);
      const ramps = this.cmVolumes
        .filter((m) => m.ramp)
        .map((m) => meshToRamp(m))
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .slice(0, MAX_PLACEMENT_RAMPS);
      if (boxes.length > 0) p.hitboxes = boxes;
      else delete p.hitboxes;
      if (ramps.length > 0) p.ramps = ramps;
      else delete p.ramps;
    } else {
      delete p.hitboxes;
      delete p.ramps;
    }
    // Rebuild the fused textured solid + re-project collision from the current
    // placement fields (placementAdded removes+re-adds the render entry).
    this.viewport3d?.placementAdded(bs.index);
    this.viewport3d?.setSelectedPlacement(bs.index);
    this.canvasDirty = true;
    this.map.meta.updatedAt = now();
    this.markDirty();
  }

  /** Rebuild collision hitboxes/ramps from a model's stored meshes (used when
   *  toggling collision on a selected model that is NOT in an edit session). */
  private rederiveModelCollision(p: AssetPlacement): void {
    const meshes = (p.meshes ?? [])
      .map((m) => sanitizeCmMesh(m))
      .filter((m): m is CmMesh => m !== null);
    if (p.collisionMode !== 'none' && p.collide) {
      const boxes = meshes
        .filter((m) => !m.ramp)
        .flatMap((m) => meshToHitboxes(m))
        .slice(0, MAX_PLACEMENT_HITBOXES);
      const ramps = meshes
        .filter((m) => m.ramp)
        .map((m) => meshToRamp(m))
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .slice(0, MAX_PLACEMENT_RAMPS);
      if (boxes.length > 0) p.hitboxes = boxes;
      else delete p.hitboxes;
      if (ramps.length > 0) p.ramps = ramps;
      else delete p.ramps;
    } else {
      delete p.hitboxes;
      delete p.ramps;
    }
  }

  /** Toggle "use the mesh as collision" for the model at `index`. */
  setModelCollision(index: number, on: boolean): void {
    const p = this.map.placements[index];
    if (!p || p.assetId !== MODEL_ASSET_ID) return;
    p.collide = on;
    p.collisionMode = on ? 'baked' : 'none';
    if (this.buildSession && this.buildSession.index === index) {
      this.deriveBuildModel();
    } else {
      this.rederiveModelCollision(p);
      this.viewport3d?.placementAdded(index);
      this.markDirty();
    }
    this.inspector.refresh();
  }

  /** Set the built model's surface texture (built-in set key, undefined = bare). */
  setModelTexture(index: number, texId: string | undefined): void {
    const p = this.map.placements[index];
    if (!p || p.assetId !== MODEL_ASSET_ID) return;
    if (texId) {
      p.modelTexId = texId;
      if (p.modelTexTile === undefined) p.modelTexTile = this.buildTexTile;
    } else {
      delete p.modelTexId;
    }
    this.buildTexId = texId;
    this.viewport3d?.placementAdded(index);
    if (this.buildSession?.index === index) this.viewport3d?.setSelectedPlacement(index);
    this.markDirty();
    this.inspector.refresh();
  }

  /** Set the built model's texture tile size (yards per repeat). */
  setModelTexTile(index: number, tile: number): void {
    const p = this.map.placements[index];
    if (!p || p.assetId !== MODEL_ASSET_ID) return;
    p.modelTexTile = Math.max(0.5, Math.min(64, tile));
    this.buildTexTile = p.modelTexTile;
    this.viewport3d?.placementAdded(index);
    if (this.buildSession?.index === index) this.viewport3d?.setSelectedPlacement(index);
    this.markDirty();
  }

  /** Finish the Build session (keep the model). An emptied model is removed. */
  private exitBuildSession(): void {
    const bs = this.buildSession;
    if (!bs) return;
    this.buildSession = null;
    this.cmPolySnap = false;
    this.cmPolyBuild = false;
    this.cmPolyBuildDrag = null;
    this.cmSculptTool = null;
    this.cmSculptStroke = null;
    this.cmPolyPoints = null;
    this.cmSubMode = 'object';
    const emptied = this.cmVolumes.length === 0;
    this.cmVolumes = [];
    this.cmSel = { volume: null, verts: [] };
    this.cmDragBase = null;
    this.cmHistory = [];
    this.cmHistoryIdx = -1;
    this.cmBar?.setVisible(false);
    this.viewport3d?.setCmMeshState(null);
    if (emptied && this.map.placements[bs.index]?.assetId === MODEL_ASSET_ID) {
      this.removePlacementAt(bs.index);
    }
    // Back to the Build tool, ready to drop the next model.
    this.setTool('build');
    this.inspector.refresh();
  }

  /** Selection panel entry point: re-open a model placement for editing. */
  private editModelForSelection(): void {
    const idx = this.selectedPlacement;
    if (idx === null || this.map.placements[idx]?.assetId !== MODEL_ASSET_ID) return;
    this.enterBuildSession(idx);
  }

  /** The model the inspector's model panel edits: the Build session's model,
   *  else a selected model/custom placement. */
  private currentModelIndex(): number | null {
    if (this.buildSession) return this.buildSession.index;
    const idx = this.selectedPlacement;
    if (idx !== null && this.map.placements[idx]?.assetId === MODEL_ASSET_ID) return idx;
    return null;
  }

  modelPanelVm(): {
    texId: string | undefined;
    texTile: number;
    hue: number;
    sat: number;
    light: number;
    collide: boolean;
    shapes: number;
  } | null {
    const idx = this.currentModelIndex();
    if (idx === null) return null;
    const p = this.map.placements[idx];
    if (!p) return null;
    return {
      texId: p.modelTexId,
      texTile: p.modelTexTile ?? DEFAULT_MODEL_TEX_TILE,
      hue: p.modelHue ?? 0,
      sat: p.modelSat ?? 1,
      light: p.modelLight ?? 0,
      collide: p.collisionMode !== 'none' && p.collide === true,
      shapes: p.meshes?.length ?? 0,
    };
  }

  modelSetTexture(texId: string | undefined): void {
    const i = this.currentModelIndex();
    if (i !== null) this.setModelTexture(i, texId);
  }

  modelSetTexTile(tile: number): void {
    const i = this.currentModelIndex();
    if (i !== null) this.setModelTexTile(i, tile);
  }

  /** Every built model the maker is acting on: the Build session's model, or
   *  the active selection PLUS every other selected built model ("select all
   *  of this asset" then one slider re-tints 5,000 stair blocks at once). */
  private selectedModelIndices(): number[] {
    if (this.buildSession) return [this.buildSession.index];
    const out: number[] = [];
    const add = (i: number | null): void => {
      if (i === null || out.includes(i)) return;
      if (this.map.placements[i]?.assetId === MODEL_ASSET_ID) out.push(i);
    };
    add(this.selectedPlacement);
    for (const i of this.selectedSet) add(i);
    return out;
  }

  /** Set a built model's material adjustments (hue degrees, saturation
   *  multiplier, light). A field left undefined is untouched; a value at the
   *  neutral setting is dropped from the document. */
  setModelLook(index: number, look: { hue?: number; sat?: number; light?: number }): void {
    const p = this.map.placements[index];
    if (!p || p.assetId !== MODEL_ASSET_ID) return;
    const put = (
      key: 'modelHue' | 'modelSat' | 'modelLight',
      v: number | undefined,
      neutral: number,
      lo: number,
      hi: number,
    ): void => {
      if (v === undefined) return;
      const c = Math.max(lo, Math.min(hi, v));
      if (Math.abs(c - neutral) < 1e-6) delete p[key];
      else p[key] = c;
    };
    put('modelHue', look.hue, 0, -180, 180);
    put('modelSat', look.sat, 1, 0, 2);
    put('modelLight', look.light, 0, -1, 1);
    this.viewport3d?.placementAdded(index);
    if (this.buildSession?.index === index) this.viewport3d?.setSelectedPlacement(index);
    this.markDirty();
  }

  /** Material picker for every selected built model at once. */
  modelSetTextureAll(texId: string | undefined): void {
    for (const i of this.selectedModelIndices()) this.setModelTexture(i, texId);
  }

  modelSetTexTileAll(tile: number): void {
    for (const i of this.selectedModelIndices()) this.setModelTexTile(i, tile);
  }

  modelSetLook(look: { hue?: number; sat?: number; light?: number }): void {
    for (const i of this.selectedModelIndices()) this.setModelLook(i, look);
  }

  modelSetCollision(on: boolean): void {
    const i = this.currentModelIndex();
    if (i !== null) this.setModelCollision(i, on);
  }

  /** View-model for the Build banner (the topbar/inspector "Done" affordance). */
  buildSessionVm(): { index: number } | null {
    return this.buildSession;
  }

  finishBuildSession(): void {
    this.exitBuildSession();
  }

  /** Save the current editor camera pose (keyed by map id) so a page reload
   *  drops the maker back exactly where they were looking. Called on pagehide
   *  (and cheap enough to call periodically). No-op in a Collision Master /
   *  Build session (that camera is a scratch/edit pose, not the map view). */
  private saveEditorCam(): void {
    if (this.collisionMaster || this.buildSession) return;
    const cam = this.viewport3d?.dungeonStagePort()?.cam;
    if (!cam) return;
    try {
      localStorage.setItem(
        EDITOR_CAM_KEY,
        JSON.stringify({
          mapId: this.map.meta.id,
          cam: {
            x: cam.target.x,
            y: cam.target.y,
            z: cam.target.z,
            yaw: cam.yaw,
            pitch: cam.pitch,
            dist: cam.dist,
          },
        }),
      );
    } catch {
      // Blocked storage: the reload just falls back to frame-all (harmless).
    }
  }

  /** The saved editor camera for `mapId`, or null (absent/corrupt/other map). */
  private readEditorCam(mapId: string): {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    dist: number;
  } | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(EDITOR_CAM_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { mapId?: unknown; cam?: Record<string, unknown> };
      const c = parsed?.cam;
      const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
      if (
        parsed?.mapId === mapId &&
        c &&
        num(c.x) &&
        num(c.y) &&
        num(c.z) &&
        num(c.yaw) &&
        num(c.pitch) &&
        num(c.dist)
      ) {
        return { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, dist: c.dist };
      }
    } catch {
      // Corrupt payload: ignore and fall back to the default framing.
    }
    return null;
  }

  /** Read AND clear the stashed Collision Master return camera (single-shot, so
   *  it can never haunt a later unrelated reload). Null when absent/corrupt. */
  private takeCmReturnCam(): {
    mapId: string;
    cam: { x: number; y: number; z: number; yaw: number; pitch: number; dist: number };
  } | null {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(CM_RETURN_CAM_KEY);
      if (raw !== null) sessionStorage.removeItem(CM_RETURN_CAM_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { mapId?: unknown; cam?: Record<string, unknown> };
      const c = parsed?.cam;
      const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
      if (
        typeof parsed?.mapId === 'string' &&
        c &&
        num(c.x) &&
        num(c.y) &&
        num(c.z) &&
        num(c.yaw) &&
        num(c.pitch) &&
        num(c.dist)
      ) {
        return {
          mapId: parsed.mapId,
          cam: { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, dist: c.dist },
        };
      }
    } catch {
      // Corrupt payload: ignore and fall back to the default framing.
    }
    return null;
  }

  /** Lock In: persist the scene's collision as the asset's repo default. */
  // ---- region maps (a shipped region, edited as an ordinary map) ---------------

  /**
   * Write the open region map back to its generated module, so the game ships
   * it. The split and the emit are pure (editor/regions/region_export_core.ts),
   * shared with the CLI; the dev server only writes the bytes.
   */
  /**
   * Publish this map into the local repo as real game content:
   * data/maps/<slug>.map.json + src/sim/maps/<slug>.generated.ts + registry.
   * Gated on prepareMapForEngine (canonical sanitize + a real Sim boot) so
   * nothing that cannot run ever reaches the repo. Dev-server only.
   */
  /** Publish To Game: write `map` (the open map unless a push hands over a
   *  merged one) into the repo under its name's slug, or `slugOverride`.
   *  Resolves whether the files were written. */
  private async publishMapToRepo(
    map: CustomMap = this.map,
    slugOverride?: string,
  ): Promise<boolean> {
    // Every published item carries its permanent id, so the repo file can
    // take change-only pushes later (map_item_ids.ts).
    ensureMapItemIds(map);
    let prepared: PreparedMapExport;
    try {
      prepared = prepareMapForEngine(map);
    } catch (error) {
      this.toasts.error(
        t('editor.publish.failed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
    const slug = slugOverride ?? mapPublishSlug(prepared.map.meta.name);
    // A whole-map Publish over a repo map someone pushed to since this copy
    // was opened would throw their changes away: ask first.
    const link = map.meta.basedOn;
    if (map === this.map && link && link.slug === slug) {
      const now = await fetchRepoMap(slug);
      if (now?.base && now.base !== link.base) {
        const ok = await confirmDialog(this.root, {
          title: t('editor.push.overwriteTitle'),
          body: t('editor.push.overwriteBody'),
          danger: true,
        });
        if (!ok) return false;
      }
    }
    const world = vendorPublishedAssetCollision(prepared.world);
    const moduleSource = emitPublishedMapModule(
      slug,
      prepared.map.meta.name,
      prepared.map.meta.seed,
      JSON.stringify(world),
    );
    // The repo layout: compact (the paint grid RLE'd; a PRETTY full-world doc
    // is tens of MB and blew the endpoint cap) with one placement, stamp and
    // grass clearing per line, so git merges and diffs it item by item.
    const mapJson = serializeMapForRepo(prepared.map);
    let res: Response;
    try {
      res = await fetch('/__studio_map/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, mapJson, moduleSource }),
      });
    } catch {
      // fetch rejects only when nothing answered, the endpoint is dev-only
      // vite middleware, so this is "no dev server". Hand the two artifacts
      // over as downloads rather than losing the work: dropping them into
      // data/maps/ and src/sim/maps/ by hand publishes the map just the same.
      downloadPublishedMap(slug, mapJson, moduleSource);
      this.toasts.error(t('editor.publish.noDevServer'));
      return false;
    }
    if (!res.ok) {
      this.toasts.error(t('editor.publish.rejected', { error: await res.text() }));
      return false;
    }
    if (map === this.map) {
      // This copy now matches the repo file: it becomes the new base.
      const now = await fetchRepoMap(slug);
      if (now?.base) this.map.meta.basedOn = { slug, base: now.base };
      this.toasts.success(t('editor.publish.done', { slug }));
    }
    return true;
  }

  /** Push only this copy's changes into the repo map it was opened from
   *  (map_push.ts), then show the merged map, which is the new base. */
  private async pushMapChangesToRepo(): Promise<void> {
    if (this.pushing) return;
    this.pushing = true;
    try {
      this.flushTransformCommit();
      const outcome = await pushMapChanges(this.map, (merged, slug) =>
        this.publishMapToRepo(merged, slug),
      );
      switch (outcome.status) {
        case 'notLinked':
          this.toasts.error(t('editor.push.notLinked'));
          return;
        case 'baseMissing':
          this.toasts.error(t('editor.push.baseMissing'));
          return;
        case 'repoMissing':
          this.toasts.error(t('editor.push.repoMissing'));
          return;
        case 'missingIds':
          this.toasts.error(t('editor.push.missingIds'));
          return;
        case 'nothing':
          this.toasts.info(t('editor.push.nothing'));
          return;
        case 'conflicts':
          showPushConflicts(this.root, outcome.conflicts);
          return;
        case 'publishFailed':
          return;
        case 'pushed': {
          const slug = this.map.meta.basedOn?.slug ?? '';
          const merged = outcome.merged;
          if (outcome.newBase) merged.meta.basedOn = { slug, base: outcome.newBase };
          this.loadMap(merged);
          this.inspector.refresh();
          let count = 0;
          for (const row of Object.values(outcome.applied)) {
            count += row.added + row.changed + row.removed;
          }
          this.toasts.success(t('editor.push.done', { count: formatNumber(count), slug }));
          if (outcome.withUpgrades) this.toasts.info(t('editor.push.withUpgrades'));
          return;
        }
      }
    } finally {
      this.pushing = false;
    }
  }

  /**
   * Uninstall this map from the local game: delete its published artifacts and
   * rebuild the registry, which restores the standard ClaudeCraft world.
   *
   * Nothing has to be "restored" beyond that, publishing is additive and the
   * built-in world is never written to, so the game boots it again the moment
   * the published module stops existing. Destructive on the file system, so it
   * asks first.
   */
  private async unpublishMapFromRepo(): Promise<void> {
    const slug = mapPublishSlug(this.map.meta.name);
    const ok = await confirmDialog(this.root, {
      title: t('editor.publish.removeTitle'),
      body: t('editor.publish.removeConfirm', { slug }),
      danger: true,
    });
    if (!ok) return;
    let res: Response;
    try {
      res = await fetch('/__studio_map/unpublish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
    } catch {
      this.toasts.error(t('editor.publish.noDevServer'));
      return;
    }
    if (!res.ok) {
      this.toasts.error(t('editor.publish.rejected', { error: await res.text() }));
      return;
    }
    let removed = 0;
    try {
      removed = (JSON.parse(await res.text()) as { removed?: number }).removed ?? 0;
    } catch {
      // A 200 with an unreadable body still means the files are gone.
    }
    this.toasts.success(
      removed > 0
        ? t('editor.publish.removed', { slug })
        : t('editor.publish.removedNothing', { slug }),
    );
  }

  private async exportRegionMap(): Promise<void> {
    const regionId = this.map.regionSource;
    if (!regionId) return;
    let source: string;
    try {
      source = emitRegionModule(regionExportFromMap(this.map));
    } catch (error) {
      // A region that cannot run is worse than a refused export: the message
      // names the object (a missing flag, an asset the field cannot build) so
      // the maker can go straight to it.
      this.toasts.error(
        `Region export failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    let res: Response;
    try {
      res = await fetch('/__region_map/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ regionId, source }),
      });
    } catch {
      // fetch REJECTS only when nothing answered, and this endpoint is dev-only
      // vite middleware - so this is "the dev server is not running". Hand the
      // module over as a download rather than losing the work.
      downloadRegionModule(regionId, source);
      this.toasts.error(
        'Could not reach the dev server; the region module was downloaded instead.',
      );
      return;
    }
    if (!res.ok) {
      this.toasts.error(`Region export rejected: ${await res.text()}`);
      return;
    }
    this.toasts.info(`Exported ${regionId} to ${regionModulePath(regionId)}. Commit it to ship.`);
  }

  private async commitCollisionMaster(): Promise<void> {
    const cm = this.collisionMaster;
    if (!cm) return;
    const p = this.map.placements[0];
    if (!p) return;
    const mode = effectiveCollisionMode(p);
    let override: AssetCollisionOverride;
    if (mode === 'none') {
      override = { mode: 'none' };
    } else if (mode === 'basic') {
      override = { mode: 'basic' };
      if (p.collideShape === 'square') override.shape = 'square';
      // Scene scale is 1, so the effective radius IS the model-space radius.
      override.radius = p.collideRadius ?? autoCollideRadius(p.assetId, 1, 'basic');
    } else if (mode === 'baked') {
      // The mesh volumes are the authored truth: derive the sim's Y-banded
      // boxes fresh and persist BOTH (meshes reopen exactly, boxes collide).
      // Ramp-flagged volumes become WALKABLE decks instead of blockers: the
      // player walks up them (sim/placement_ramps.ts), like baked stairs.
      const fromMeshes = this.cmVolumes.filter((m) => !m.ramp).flatMap((m) => meshToHitboxes(m));
      const ramps = this.cmVolumes
        .filter((m) => m.ramp)
        .map((m) => meshToRamp(m))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      const boxes =
        fromMeshes.length > 0
          ? fromMeshes.slice(0, MAX_PLACEMENT_HITBOXES)
          : this.cmVolumes.length > 0
            ? []
            : (this.resolvedHitboxesFor(p) ??
              boxesForAssetId(p.assetId)?.map((b) => ({ ...b })) ??
              []);
      if (boxes.length === 0 && ramps.length === 0) {
        this.toasts.error(t('editor.collisionMaster.noBoxes'));
        return;
      }
      override = { mode: 'baked' };
      if (boxes.length > 0) override.boxes = boxes;
      if (ramps.length > 0) override.ramps = ramps;
      if (this.cmVolumes.length > 0) {
        override.meshes = this.cmVolumes.map((m) => roundMesh(m));
      }
    } else {
      // 'mesh' is a per-map fine bake, not a repo default.
      this.toasts.error(t('editor.collisionMaster.meshUnsupported'));
      return;
    }
    let res: Response;
    try {
      res = await fetch('/__collision_master/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetId: cm.assetId, override }),
      });
    } catch {
      // fetch REJECTS (vs a non-2xx response) only when the request never
      // reached a server: the save endpoint lives on the `npm run dev` server
      // (dev-only vite middleware), so this is almost always "the dev server
      // is not running/reachable" (the "Failed to fetch" the maker sees). Keep
      // the CM session open (their volumes are intact to retry) AND download
      // the override so the work survives even if the tab closes.
      downloadCollisionOverride(cm.assetId, override);
      this.toasts.error(t('editor.collisionMaster.saveUnreachable'));
      return;
    }
    if (!res.ok) {
      // The server answered but rejected it (validation, too large): surface the
      // reason; the CM session stays open so the maker can adjust and retry.
      this.toasts.error(
        t('editor.collisionMaster.saveEndpointFailed', { error: await res.text() }),
      );
      return;
    }
    // The save plugin suppresses HMR for its generated data module. Mirror the
    // persisted value into the current runtime first so returning to the map is
    // immediate and fresh placements/playtests use the new default at once.
    applySessionCollisionOverride(cm.assetId, override);
    this.toasts.info(t('editor.collisionMaster.locked', { name: cm.label }));
    const assetId = cm.assetId;
    const bakedMode = override.mode === 'baked';
    // Offer to keep the boxes as a device-local hitbox preset too (SPACEY asked
    // for the prompt, 2026-09-07). Lock In alone already makes the collision
    // the asset's default; a preset additionally stamps the boxes onto every
    // NEW placement as its own editable hitboxes. The "don't ask again" tick
    // is undone under More > "Ask about presets on Lock In".
    if (bakedMode && override.boxes && override.boxes.length > 0 && this.presetPromptOn) {
      const boxes = override.boxes.map((b) => ({ ...b }));
      const answer = await optOutConfirmDialog(this.root, {
        title: t('editor.collisionMaster.presetPromptTitle'),
        body: t('editor.collisionMaster.presetPromptBody', { name: cm.label }),
        confirmLabel: t('editor.collisionMaster.presetPromptYes'),
        cancelLabel: t('editor.collisionMaster.presetPromptNo'),
        optOutLabel: t('editor.collisionMaster.presetPromptDontAsk'),
      });
      if (answer.optOut) this.setPresetPrompt(false);
      if (answer.ok) {
        this.hitboxPresets[assetId] = boxes;
        writeJsonPref(HITBOX_PRESETS_PREF_KEY, this.hitboxPresets);
        this.toasts.info(t('editor.selection.hitboxPresetSaved', { name: cm.label }));
      }
    }
    this.exitCollisionMaster();
    // Back on the maker's own map now: pull the new default into the copies
    // already standing. Without this the authoring silently does nothing to
    // them, a placement stamped 'basic' keeps colliding as its circle, which
    // is what "the Collision Master collision is not loading in the game"
    // actually looks like from the maker's side.
    if (bakedMode) this.adoptCollisionDefault(assetId);
  }

  /**
   * Re-stamp existing placements of `assetId` onto its newly authored 'baked'
   * default. Undoable in one step, and it reports the count rather than
   * changing the document silently. Every copy adopts, hand-edited boxes and
   * ramp decks included: Lock In is the maker's latest word on the asset
   * (see planCollisionAdoption).
   */
  private adoptCollisionDefault(assetId: string): void {
    const plan = planCollisionAdoption(this.map.placements, assetId);
    if (plan.length === 0) return;
    const before = plan.map((a) => {
      const p = this.map.placements[a.index];
      return {
        index: a.index,
        collisionMode: p.collisionMode,
        collideShape: p.collideShape,
        collide: p.collide,
        hitboxes: p.hitboxes?.map((b) => ({ ...b })),
        ramps: p.ramps?.map((r) => ({ ...r })),
      };
    });
    const apply = (): void => {
      for (const a of plan) {
        const p = this.map.placements[a.index];
        p.collisionMode = 'baked';
        delete p.collideShape;
        // A non-collider (promotion-stamped or explicit "none") also has to be
        // opted IN, or the sim's placement lane skips it.
        if (a.patch.collide) p.collide = true;
        // Lock In is the latest word on this asset: the copy's own hand-edited
        // boxes / ramp decks would otherwise keep colliding instead of the
        // authored default (the "I have to click Reset to baked" symptom).
        if (a.patch.clearHitboxes) delete p.hitboxes;
        if (a.patch.clearRamps) delete p.ramps;
        if (a.patch.clearHitboxes || a.patch.clearRamps) this.afterHitboxesChanged(a.index);
      }
      this.viewport3d?.rebuildPlacements();
      this.markDirty();
    };
    apply();
    this.pushUndo({
      label: 'collision-adopt',
      undo: () => {
        for (const b of before) {
          const p = this.map.placements[b.index];
          if (b.collisionMode === undefined) delete p.collisionMode;
          else p.collisionMode = b.collisionMode;
          if (b.collideShape === undefined) delete p.collideShape;
          else p.collideShape = b.collideShape;
          // `collide` is a required field, so the undo restores its value
          // (an absent one only ever means the legacy default, false).
          p.collide = b.collide ?? false;
          if (b.hitboxes) p.hitboxes = b.hitboxes.map((x) => ({ ...x }));
          else delete p.hitboxes;
          if (b.ramps) p.ramps = b.ramps.map((r) => ({ ...r }));
          else delete p.ramps;
          if (b.hitboxes || b.ramps) this.afterHitboxesChanged(b.index);
        }
        this.viewport3d?.rebuildPlacements();
        this.markDirty();
      },
      redo: apply,
    });
    this.toasts.success(t('editor.collisionMaster.adopted', { count: plan.length }));
  }

  /**
   * Un-squish every promoted world building on the map.
   *
   * A building promoted from the world is FITTED to the plot the world reserved
   * for it: uniform `scale` sets its height, then scaleX/scaleZ stretch the mesh
   * sideways until its footprint matches the plot's w and d. Six kit models
   * cover seventy-eight shipped buildings, so most end up visibly squashed along
   * one horizontal axis. This evens the two horizontal axes at their geometric
   * mean, which keeps each building's height AND its footprint area exactly ,
   * the same building, no longer distorted. One undo step for the lot.
   */
  private evenOutBuildingScales(): void {
    const plans = planScaleEqualize(this.map.placements);
    if (plans.length === 0) {
      this.toasts.info(t('editor.topbar.evenBuildingsNone'));
      return;
    }
    const before: EqualizePlan[] = plans.map((plan) => ({ ...plan }));
    const apply = (): void => {
      applyScaleEqualize(this.map.placements, plans);
      this.viewport3d?.rebuildPlacements();
      this.markDirty();
    };
    apply();
    this.pushUndo({
      label: 'even-buildings',
      undo: () => {
        for (const plan of before) {
          const placement = this.map.placements[plan.index];
          if (!placement || placement.assetId !== plan.assetId) continue;
          placement.scaleX = plan.from.scaleX;
          placement.scaleY = plan.from.scaleY;
          placement.scaleZ = plan.from.scaleZ;
        }
        this.viewport3d?.rebuildPlacements();
        this.markDirty();
      },
      redo: apply,
    });
    this.toasts.success(t('editor.topbar.evenBuildingsDone', { count: plans.length }));
  }

  /** Starter box sets for the Collision Master scene. */
  private collisionMasterStarter(kind: 'bake' | 'fitted' | 'single' | 'cylinder' | 'clear'): void {
    const cm = this.collisionMaster;
    if (!cm) return;
    const p = this.map.placements[0];
    if (!p) return;
    this.setSelectedPlacement(0);
    if (p.collisionMode !== 'baked') this.updateSelectedPlacement({ collisionMode: 'baked' }, true);
    if (kind === 'clear') {
      this.cmVolumes = [];
      this.cmSel = { volume: null, verts: [] };
      this.pushCmHistory();
      this.deriveCmHitboxes();
      this.syncCmView();
      this.inspector.refresh();
      return;
    }
    if (kind === 'cylinder') {
      const r = Math.max(0.3, collideRadiusFor(1, cm.assetId));
      this.cmVolumes = [cmCylinder(r, r * 2, r)];
      this.cmSel = { volume: 0, verts: [] };
      this.pushCmHistory();
      this.deriveCmHitboxes();
      this.syncCmView();
      this.inspector.refresh();
      return;
    }
    let boxes: MapHitbox[];
    if (kind === 'bake') {
      const baked = ASSET_COLLISION[cm.assetId];
      boxes =
        baked && baked.length > 0
          ? baked.slice(0, MAX_PLACEMENT_HITBOXES).map((b) => ({ ...b }))
          : this.materializeHitboxes(p);
    } else if (kind === 'fitted') {
      const a = analyzeBakedFootprint(cm.assetId);
      boxes = a && a.boxCount > 0 ? [{ ...a.union }] : this.materializeHitboxes(p);
    } else {
      const r = Math.max(0.3, collideRadiusFor(1, cm.assetId));
      boxes = [{ x: 0, y: r, z: 0, hx: r, hy: r, hz: r }];
    }
    // Starters REPLACE the volume set: each box opens as an editable box mesh.
    this.cmVolumes = boxes.map((b) => meshFromHitbox(b));
    this.cmSel = { volume: this.cmVolumes.length > 0 ? 0 : null, verts: [] };
    this.pushCmHistory();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.inspector.refresh();
  }

  // ---- Collision Master v2: sub-element modes, primitives, duplicate ------------

  /** Blender-style sub-element select mode for the Collision Master scene:
   *  object = whole-box gizmo, vertex/edge/face = direct handle editing. */
  private cmSubMode: 'object' | 'vertex' | 'edge' | 'face' = 'object';

  private setCmSubMode(mode: 'object' | 'vertex' | 'edge' | 'face'): void {
    if (this.cmSubMode === mode) return;
    this.cmSubMode = mode;
    // Entering a sub mode with no volume grabbed edits the first one (Blender
    // needs an object before edit mode makes sense); component selection
    // resets across mode switches.
    if (mode !== 'object' && this.cmSel.volume === null && this.cmVolumes.length > 0) {
      this.cmSel.volume = 0;
    }
    this.cmSel.verts = [];
    this.syncCmView();
    this.cmBar?.refresh();
    this.inspector.refresh();
  }

  /** Push the session's mesh state to the 3D view (volumes + selection). */
  private syncCmView(): void {
    if (!this.meshEditActive()) {
      this.viewport3d?.setCmMeshState(null);
      return;
    }
    // Collision Master keeps the asset at the scene origin; a Build model lives
    // at its real map position, so the overlay is offset to sit on the solid.
    const { originX, baseY, originZ } = this.meshEditFrame();
    this.viewport3d?.setCmMeshState({
      meshes: this.cmVolumes,
      selected: this.cmSel.volume,
      mode: this.cmSubMode === 'object' ? null : this.cmSubMode,
      selVerts: this.cmSel.verts,
      baseY,
      originX,
      originZ,
    });
    this.canvasDirty = true;
  }

  /** Re-derive the placement's sim boxes from the volumes (footprint canvas,
   *  playtest, Lock In all read these). Uncommitted to the map undo: the CM
   *  session has its own history. */
  private deriveCmHitboxes(): void {
    // A Build session is the same substrate on a live-map model placement, so
    // every shared edit routes its "re-derive" here, dispatch to the model.
    if (this.buildSession) {
      this.deriveBuildModel();
      return;
    }
    if (!this.collisionMaster) return;
    const p = this.map.placements[0];
    if (!p) return;
    // Ramp-flagged volumes are WALKABLE decks, never blockers: only the solid
    // volumes decompose into sim boxes.
    const boxes = this.cmVolumes
      .filter((m) => !m.ramp)
      .flatMap((m) => meshToHitboxes(m))
      .slice(0, MAX_PLACEMENT_HITBOXES);
    if (boxes.length > 0) {
      p.hitboxes = boxes;
      if (p.collisionMode !== 'baked') p.collisionMode = 'baked';
    } else {
      delete p.hitboxes;
    }
    // The ramp volumes become live per-placement decks, so a playtest of THIS
    // scene walks up the ramps before Lock In ever persists them.
    const ramps = this.cmVolumes
      .filter((m) => m.ramp)
      .map((m) => meshToRamp(m))
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .slice(0, MAX_PLACEMENT_RAMPS);
    if (ramps.length > 0) {
      p.ramps = ramps;
      if (p.collisionMode !== 'baked') p.collisionMode = 'baked';
    } else {
      delete p.ramps;
    }
    this.viewport3d?.placementUpdated(0, { hitboxes: boxes.map((b) => ({ ...b })) });
    this.syncFootprintOverlay();
    this.canvasDirty = true;
  }

  /** Snapshot the volume set into the session history (one entry per
   *  committed gesture/add/delete, capped like Blender's edit undo). */
  private pushCmHistory(): void {
    this.cmHistory.splice(this.cmHistoryIdx + 1);
    this.cmHistory.push(this.cmVolumes.map(cloneMesh));
    if (this.cmHistory.length > 80) this.cmHistory.shift();
    this.cmHistoryIdx = this.cmHistory.length - 1;
  }

  /** Collision-volume clipboard: survives across Collision Master sessions
   *  (copy a shape set on one asset, paste it onto another) and NEVER touches
   *  the map clipboard, Ctrl+C in the studio copies collision, not models. */
  private cmVolumeClipboard: CmMesh[] = [];

  /** Ctrl+C: copy the selected volume, or ALL volumes when nothing is
   *  selected, to the collision clipboard. The base model never rides along. */
  private cmCopyVolumes(): void {
    if (!this.meshEditActive()) return;
    const src =
      this.cmSel.volume !== null && this.cmVolumes[this.cmSel.volume]
        ? [this.cmVolumes[this.cmSel.volume]]
        : this.cmVolumes;
    if (src.length === 0) {
      this.toasts.info(t('editor.collisionMaster.copyEmpty'));
      return;
    }
    this.cmVolumeClipboard = src.map(cloneMesh);
    this.toasts.info(t('editor.collisionMaster.copied', { n: this.cmVolumeClipboard.length }));
  }

  /** Ctrl+V: append the clipboard volumes to this session's set. */
  private cmPasteVolumes(): void {
    if (!this.meshEditActive() || this.cmVolumeClipboard.length === 0) return;
    for (const m of this.cmVolumeClipboard) this.cmVolumes.push(cloneMesh(m));
    this.cmSel = { volume: this.cmVolumes.length - 1, verts: [] };
    this.pushCmHistory();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.inspector.refresh();
    this.toasts.info(t('editor.collisionMaster.pasted', { n: this.cmVolumeClipboard.length }));
  }

  private cmUndo(): void {
    if (this.cmHistoryIdx <= 0) return;
    this.cmHistoryIdx--;
    this.cmVolumes = this.cmHistory[this.cmHistoryIdx].map(cloneMesh);
    this.clampCmSelection();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.inspector.refresh();
  }

  private cmRedo(): void {
    if (this.cmHistoryIdx >= this.cmHistory.length - 1) return;
    this.cmHistoryIdx++;
    this.cmVolumes = this.cmHistory[this.cmHistoryIdx].map(cloneMesh);
    this.clampCmSelection();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.inspector.refresh();
  }

  private clampCmSelection(): void {
    if (this.cmSel.volume !== null && this.cmSel.volume >= this.cmVolumes.length) {
      this.cmSel.volume = this.cmVolumes.length > 0 ? this.cmVolumes.length - 1 : null;
      this.cmSel.verts = [];
    }
    const m = this.cmSel.volume !== null ? this.cmVolumes[this.cmSel.volume] : null;
    if (m) {
      const max = m.verts.length / 3;
      this.cmSel.verts = this.cmSel.verts.filter((v) => v >= 0 && v < max);
    } else {
      this.cmSel.verts = [];
    }
  }

  /** One live gizmo sample over the mesh selection: object mode transforms
   *  the whole volume, sub modes ONLY the selected verts (one vertex moves
   *  one vertex, Blender semantics), around the gesture-start centroid. */
  private applyCmGizmoChange(change: GizmoHitboxChange): void {
    const vi = this.cmSel.volume;
    if (!this.meshEditActive() || vi === null) return;
    const vol = this.cmVolumes[vi];
    if (!vol) return;
    if (!this.cmDragBase) this.cmDragBase = cloneMesh(vol);
    const base = this.cmDragBase;
    const targets =
      this.cmSubMode === 'object'
        ? Array.from({ length: base.verts.length / 3 }, (_, i) => i)
        : this.cmSel.verts;
    if (targets.length === 0) return;
    const pivot = vertsCentroid(base, this.cmSubMode === 'object' ? undefined : targets);
    this.cmVolumes[vi] = applyCmGizmo(base, targets, pivot, change);
    this.syncCmView();
  }

  /** End-of-gesture commit for a mesh gizmo drag: ONE history entry. */
  private commitCmGesture(): void {
    if (!this.cmDragBase) return;
    this.cmDragBase = null;
    this.pushCmHistory();
    this.deriveCmHitboxes();
  }

  /** Select-mode tap in a Collision Master session. */
  private cmTap(clientX: number, clientY: number, additive: boolean): void {
    const vp = this.viewport3d;
    if (!vp) return;
    if (this.cmSubMode === 'object') {
      const vi = vp.pickCmVolume(clientX, clientY);
      if (vi !== null) {
        this.cmSel = { volume: vi, verts: [] };
      } else if (!additive) {
        this.cmSel = { volume: null, verts: [] };
      }
    } else {
      const pick = vp.pickCmComponent(clientX, clientY);
      if (pick) {
        if (additive) {
          const cur = new Set(this.cmSel.verts);
          const allIn = pick.verts.every((v) => cur.has(v));
          if (allIn) for (const v of pick.verts) cur.delete(v);
          else for (const v of pick.verts) cur.add(v);
          this.cmSel.verts = [...cur];
        } else {
          this.cmSel.verts = pick.verts;
        }
      } else {
        // Off-component: clicking another volume hops the edit target
        // (Blender needs an object-mode round trip; this stays fluid).
        const vi = vp.pickCmVolume(clientX, clientY);
        if (vi !== null && vi !== this.cmSel.volume) {
          this.cmSel = { volume: vi, verts: [] };
        } else if (!additive) {
          this.cmSel.verts = [];
        }
      }
    }
    this.syncCmView();
    this.inspector.refresh();
  }

  /** Marquee selection over the selected volume's verts (Ctrl+drag). */
  private selectCmVerts(verts: number[]): void {
    if (!this.meshEditActive() || this.cmSel.volume === null) return;
    this.cmSel.verts = verts;
    this.clampCmSelection();
    this.syncCmView();
    this.inspector.refresh();
  }

  /** Delete the selected volume (the workbench asset itself never deletes). */
  private deleteCmSelection(): void {
    const vi = this.cmSel.volume;
    if (!this.meshEditActive() || vi === null) return;
    if (this.cmSubMode !== 'object' && this.cmSel.verts.length > 0) {
      const edited = deleteMeshComponents(this.cmVolumes[vi], this.cmSubMode, this.cmSel.verts);
      if (!edited) {
        this.toasts.info(t('editor.collisionMaster.topologyFail'));
        return;
      }
      this.cmVolumes[vi] = edited;
      this.cmSel = { volume: vi, verts: [] };
      this.pushCmHistory();
      this.deriveCmHitboxes();
      this.syncCmView();
      this.cmBar?.refresh();
      this.inspector.refresh();
      return;
    }
    this.cmVolumes.splice(vi, 1);
    this.cmSel = {
      volume: this.cmVolumes.length > 0 ? Math.min(vi, this.cmVolumes.length - 1) : null,
      verts: [],
    };
    this.pushCmHistory();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.inspector.refresh();
  }

  /** One live sub-element handle sample: replace ONE box, uncommitted (the
   *  drag end commits via commitHitboxes, the gizmo's exact contract). */
  private applyHitboxHandleEdit(boxIndex: number, box: MapHitbox): void {
    const he = this.hitboxEdit;
    if (!he) return;
    const p = this.map.placements[he.index];
    if (!p || !p.hitboxes || !p.hitboxes[boxIndex]) return;
    if (!this.hitboxDragBase) this.hitboxDragBase = p.hitboxes.map((b) => ({ ...b }));
    const boxes = p.hitboxes.map((b) => ({ ...b }));
    const clean: MapHitbox = { ...box };
    if (!clean.ry) delete clean.ry;
    boxes[boxIndex] = clean;
    p.hitboxes = boxes;
    this.viewport3d?.placementUpdated(he.index, { hitboxes: boxes.map((b) => ({ ...b })) });
    this.syncHitboxEditView();
    this.canvasDirty = true;
  }

  /** Primitive starters: append a TRUE triangulated solid, a cylinder is a
   *  real N-gon prism (verts, edges, triangles), not two crossed boxes. The
   *  sim boxes derive from the mesh afterward (meshToHitboxes). */
  private addCmPrimitive(kind: 'box' | 'plane' | 'cylinder' | 'sphere' | 'wedge'): void {
    if (!this.meshEditActive()) return;
    const index = this.meshEditIndex();
    const p = index === null ? null : this.map.placements[index];
    if (!p || index === null) return;
    this.setSelectedPlacement(index);
    if (this.cmVolumes.length >= 24) {
      this.toasts.error(t('editor.selection.hitboxCap', { max: 24 }));
      return;
    }
    // Collision Master sizes primitives to the workbench asset so they land
    // usable; a Build model has no reference asset, so use a plain 2yd default.
    const a = this.collisionMaster ? analyzeBakedFootprint(this.collisionMaster.assetId) : null;
    const r = Math.min(3, Math.max(0.5, a ? Math.max(a.union.hx, a.union.hz) * 0.8 : 1));
    const h = Math.min(4, Math.max(0.5, a ? a.union.hy * 2 * 0.9 : 1.5));
    let fresh: CmMesh;
    if (kind === 'box') fresh = cmBox(r, h / 2, r, h / 2);
    else if (kind === 'plane') fresh = cmPlane(r * 1.2, h / 2, h / 2);
    else if (kind === 'cylinder') fresh = cmCylinder(r, h, h / 2);
    else if (kind === 'sphere') fresh = cmSphere(r, r);
    else {
      fresh = cmWedge(Math.max(1, r), h, r);
      // The Ramp primitive IS a ramp: walkable by default (the maker placed
      // it to be walked up, not to wall the player off). The bar's Walkable
      // toggle flips any volume either way.
      fresh.ramp = true;
    }
    this.cmVolumes.push(fresh);
    this.cmSel = { volume: this.cmVolumes.length - 1, verts: [] };
    // Collision Master's volumes ARE collision, so force baked mode; a Build
    // model's volumes are geometry, collision stays whatever the maker chose.
    if (this.collisionMaster && p.collisionMode !== 'baked') {
      this.updateSelectedPlacement({ collisionMode: 'baked' }, true);
    }
    this.pushCmHistory();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.inspector.refresh();
  }

  /** Marquee selection over collision boxes (Ctrl+drag in hitbox edit). */
  private selectHitboxes(indices: number[]): void {
    const he = this.hitboxEdit;
    if (!he) return;
    const p = this.map.placements[he.index];
    const max = p?.hitboxes?.length ?? 0;
    he.selected = new Set(indices.filter((i) => i >= 0 && i < max));
    this.syncHitboxEditView();
    this.inspector.refresh();
  }

  /** Flip the selected volume between solid blocker and WALKABLE ramp deck
   *  (walkable volumes lock in as rising decks the player walks up). */
  private toggleCmRamp(): void {
    const vi = this.cmSel.volume;
    if (!this.meshEditActive() || vi === null) return;
    const vol = this.cmVolumes[vi];
    if (!vol) return;
    if (vol.ramp) delete vol.ramp;
    else vol.ramp = true;
    this.pushCmHistory();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.cmBar?.refresh();
    this.inspector.refresh();
  }

  /** Duplicate the selected volume in place: the copy lands exactly on the
   *  original (no offset) and becomes the selection, ready to be moved. */
  private duplicateCmSelection(): void {
    const vi = this.cmSel.volume;
    if (!this.meshEditActive() || vi === null) return;
    const src = this.cmVolumes[vi];
    if (!src) return;
    if (this.cmVolumes.length >= 24) {
      this.toasts.error(t('editor.selection.hitboxCap', { max: 24 }));
      return;
    }
    const copy = cloneMesh(src);
    this.cmVolumes.push(copy);
    this.cmSel = { volume: this.cmVolumes.length - 1, verts: [] };
    this.pushCmHistory();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.inspector.refresh();
  }

  // ---- loop cut: insert an edge loop through the picked edge's quad ring ------

  private canLoopCut(): boolean {
    return (
      this.meshEditActive() &&
      this.cmSubMode === 'edge' &&
      this.cmSel.volume !== null &&
      this.cmSel.verts.length === 2
    );
  }

  private loopCutCmSelection(): void {
    if (!this.canLoopCut()) {
      this.toasts.info(t('editor.collisionMaster.loopCutFail'));
      return;
    }
    const vi = this.cmSel.volume;
    if (vi === null) return;
    const vol = this.cmVolumes[vi];
    const res = vol ? loopCut(vol, this.cmSel.verts[0], this.cmSel.verts[1]) : null;
    if (!res) {
      this.toasts.info(t('editor.collisionMaster.loopCutFail'));
      return;
    }
    this.cmVolumes[vi] = res.mesh;
    // Auto-select the new loop verts so the gizmo can immediately slide it.
    this.cmSel = { volume: vi, verts: res.newVerts };
    this.pushCmHistory();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.cmBar?.refresh();
    this.inspector.refresh();
  }

  private canCmTopology(action: CmTopologyAction): boolean {
    if (!this.meshEditActive() || this.cmSel.volume === null) return false;
    if (action === 'weld') return this.cmSubMode === 'vertex' && this.cmSel.verts.length >= 2;
    if (action === 'inset') return this.cmSubMode === 'face' && this.cmSel.verts.length >= 3;
    if (action === 'fill') return this.cmSubMode === 'vertex' && this.cmSel.verts.length >= 3;
    return true;
  }

  private applyCmTopology(action: CmTopologyAction): void {
    if (!this.canCmTopology(action)) {
      this.toasts.info(t('editor.collisionMaster.topologyFail'));
      return;
    }
    const vi = this.cmSel.volume;
    if (vi === null) return;
    const source = this.cmVolumes[vi];
    let mesh: CmMesh | null = null;
    let selected: number[] = this.cmSel.verts.slice();
    if (action === 'weld') {
      const result = weldMeshVertices(source, selected);
      mesh = result?.mesh ?? null;
      selected = result?.selected ?? [];
    } else if (action === 'subdivide') {
      const result = subdivideMesh(source);
      mesh = result?.mesh ?? null;
      selected = result?.newVerts ?? [];
    } else if (action === 'inset') {
      const result = insetMeshFace(source, selected);
      mesh = result?.mesh ?? null;
      selected = result?.newVerts ?? [];
    } else if (action === 'fill') {
      mesh = fillMeshSelection(source, selected);
    } else {
      const result = mirrorMesh(source, 'x');
      mesh = result?.mesh ?? null;
      selected = result?.newVerts ?? [];
    }
    if (!mesh) {
      this.toasts.info(t('editor.collisionMaster.topologyFail'));
      return;
    }
    this.cmVolumes[vi] = mesh;
    this.cmSel = { volume: vi, verts: selected };
    this.pushCmHistory();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.cmBar?.refresh();
    this.inspector.refresh();
  }

  // ---- poly build: click-drag a face to extrude it (Blender Poly Build) -------

  private cmPolyBuildActive(): boolean {
    return this.meshEditActive() && this.cmPolyBuild;
  }

  private setCmPolyBuild(on: boolean): void {
    this.cmPolyBuild = on;
    if (on) {
      this.cmPolySnap = false;
      this.cmSculptTool = null;
    }
    this.cmPolyBuildDrag = null;
    this.cmPolyPoints = null;
    this.cmBar?.refresh();
    this.inspector.refresh();
  }

  // ---- dynamic surface sculpting -----------------------------------------------

  private cmSculptActive(): boolean {
    return this.meshEditActive() && this.cmSculptTool !== null;
  }

  private setCmSculptTool(tool: CmSculptTool | null): void {
    if (this.cmSculptStroke) this.cmSculptEnd();
    this.cmSculptTool = tool;
    if (tool) {
      this.cmPolySnap = false;
      this.cmPolyBuild = false;
      this.cmPolyBuildDrag = null;
      this.cmPolyPoints = null;
    }
    this.cmBar?.refresh();
    this.inspector.refresh();
  }

  private cmSculptBegin(ev: PointerEvent): void {
    const vp = this.viewport3d;
    const tool = this.cmSculptTool;
    if (!vp || !tool) return;
    const hit = vp.pickCmSurface(ev.clientX, ev.clientY);
    if (!hit) return;
    const vol = this.cmVolumes[hit.mesh];
    if (!vol) return;
    const pre = cloneMesh(vol);
    const prepared = sculptCmMeshSymmetric(
      pre,
      {
        tool: 'grab',
        center: hit.point,
        radius: this.cmSculptRadius,
        strength: 0,
        offset: [0, 0, 0],
        dynamicTopology: this.cmSculptDynamic,
        targetEdgeLength: this.cmSculptTargetEdge,
      },
      this.cmSculptSymmetry,
    );
    const frame = this.meshEditFrame();
    const worldCenter: [number, number, number] = [
      hit.point[0] + frame.originX,
      hit.point[1] + frame.baseY,
      hit.point[2] + frame.originZ,
    ];
    this.cmVolumes[hit.mesh] = prepared.mesh;
    this.cmSel = { volume: hit.mesh, verts: prepared.affectedVerts };
    this.cmSculptStroke = {
      vi: hit.mesh,
      pre,
      base: prepared.mesh,
      center: hit.point,
      worldCenter,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      lastClientX: ev.clientX,
      lastClientY: ev.clientY,
      changed: prepared.changed,
    };
    this.syncCmView();
  }

  private cmSculptMove(ev: PointerEvent): void {
    const stroke = this.cmSculptStroke;
    const tool = this.cmSculptTool;
    const vp = this.viewport3d;
    if (!stroke || !tool || !vp) return;
    const dx = ev.clientX - stroke.lastClientX;
    const dy = ev.clientY - stroke.lastClientY;
    if (dx * dx + dy * dy < 4) return;
    stroke.lastClientX = ev.clientX;
    stroke.lastClientY = ev.clientY;
    if (tool === 'grab') {
      const offset = vp.screenDragWorldDelta(
        ev.clientX - stroke.startClientX,
        ev.clientY - stroke.startClientY,
        stroke.worldCenter,
      );
      const result = sculptCmMeshSymmetric(
        stroke.base,
        {
          tool,
          center: stroke.center,
          radius: this.cmSculptRadius,
          strength: this.cmSculptStrength,
          offset,
          dynamicTopology: this.cmSculptDynamic,
          targetEdgeLength: this.cmSculptTargetEdge,
        },
        this.cmSculptSymmetry,
      );
      this.cmVolumes[stroke.vi] = result.mesh;
      this.cmSel = { volume: stroke.vi, verts: result.affectedVerts };
      stroke.changed ||= result.changed;
      this.syncCmView();
      return;
    }
    const hit = vp.pickCmSurface(ev.clientX, ev.clientY);
    if (!hit || hit.mesh !== stroke.vi) return;
    let effectiveTool = tool;
    if (ev.shiftKey && tool === 'inflate') effectiveTool = 'deflate';
    else if (ev.shiftKey && tool === 'deflate') effectiveTool = 'inflate';
    const result = sculptCmMeshSymmetric(
      this.cmVolumes[stroke.vi],
      {
        tool: effectiveTool,
        center: hit.point,
        radius: this.cmSculptRadius,
        strength: this.cmSculptStrength,
        dynamicTopology: this.cmSculptDynamic,
        targetEdgeLength: this.cmSculptTargetEdge,
      },
      this.cmSculptSymmetry,
    );
    this.cmVolumes[stroke.vi] = result.mesh;
    this.cmSel = { volume: stroke.vi, verts: result.affectedVerts };
    stroke.changed ||= result.changed;
    this.syncCmView();
  }

  private cmSculptEnd(): void {
    const stroke = this.cmSculptStroke;
    this.cmSculptStroke = null;
    if (!stroke) return;
    if (!stroke.changed) {
      this.cmVolumes[stroke.vi] = stroke.pre;
      this.cmSel = { volume: stroke.vi, verts: [] };
      this.syncCmView();
      return;
    }
    this.pushCmHistory();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.inspector.refresh();
  }

  /** The world frame the mesh-edit overlay is drawn in: the local origin's
   *  world position (0,seat,0 for Collision Master; the model's x/z for Build)
   *  so poly-build can convert model-space verts/normals into world space. */
  private meshEditFrame(): { originX: number; baseY: number; originZ: number } {
    const p = this.meshEditPlacement();
    const seat = p
      ? (p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.map.meta.seed)) + (p.y ?? 0)
      : 0;
    const originX = this.buildSession && p ? p.x : 0;
    const originZ = this.buildSession && p ? p.z : 0;
    return { originX, baseY: seat, originZ };
  }

  private cmPolyBuildBegin(ev: PointerEvent): void {
    const vp = this.viewport3d;
    if (!vp) return;
    const frame = this.meshEditFrame();
    const startDrag = (
      vi: number,
      res: { mesh: CmMesh; newVerts: number[] },
      vol: CmMesh,
      axis: [number, number, number],
    ): void => {
      const fc = vertsCentroid(res.mesh, res.newVerts);
      const origin: [number, number, number] = [
        fc[0] + frame.originX,
        fc[1] + frame.baseY,
        fc[2] + frame.originZ,
      ];
      this.cmVolumes[vi] = res.mesh;
      this.cmPolyBuildDrag = {
        vi,
        pre: vol,
        base: res.mesh,
        newVerts: res.newVerts,
        axis,
        origin,
        t0: vp.pointerAxisT(ev.clientX, ev.clientY, origin, axis) ?? 0,
      };
      this.cmSel = { volume: vi, verts: res.newVerts };
    };
    // Click a FACE (any volume) to extrude it along its outward normal.
    const face = vp.pickCmFace(ev.clientX, ev.clientY);
    if (face) {
      const vol = this.cmVolumes[face.mesh];
      if (!vol) return;
      const res = extrudeFace(vol, face.tris);
      if (!res) {
        this.toasts.info(t('editor.collisionMaster.polyBuildFail'));
        return;
      }
      startDrag(face.mesh, res, vol, faceNormal(vol, face.tris));
      if (this.cmSubMode === 'object') this.cmSubMode = 'face';
      this.syncCmView();
      return;
    }
    // No face under the cursor: extrude the nearest edge of the selected volume.
    const edge = vp.pickCmEdge(ev.clientX, ev.clientY);
    if (!edge) return;
    const vol = this.cmVolumes[edge.mesh];
    if (!vol) return;
    const res = extrudeEdge(vol, edge.a, edge.b);
    if (!res) return;
    startDrag(edge.mesh, res, vol, [0, 1, 0]); // edges pull up by default
    this.syncCmView();
  }

  private cmPolyBuildMove(ev: PointerEvent): void {
    const d = this.cmPolyBuildDrag;
    const vp = this.viewport3d;
    if (!d || !vp) return;
    const t = vp.pointerAxisT(ev.clientX, ev.clientY, d.origin, d.axis);
    if (t === null) return;
    const delta = t - d.t0;
    this.cmVolumes[d.vi] = applyCmGizmo(d.base, d.newVerts, vertsCentroid(d.base, d.newVerts), {
      dx: d.axis[0] * delta,
      dy: d.axis[1] * delta,
      dz: d.axis[2] * delta,
    });
    this.syncCmView();
  }

  private cmPolyBuildEnd(): void {
    const d = this.cmPolyBuildDrag;
    this.cmPolyBuildDrag = null;
    if (!d) return;
    // A plain click (no drag) leaves a zero-height extrude: coincident verts
    // that would only inflate the topology, discard it back to the pre-extrude
    // mesh so a stray click is a harmless no-op.
    const cur = vertsCentroid(this.cmVolumes[d.vi], d.newVerts);
    const base = vertsCentroid(d.base, d.newVerts);
    if (Math.hypot(cur[0] - base[0], cur[1] - base[1], cur[2] - base[2]) < 0.02) {
      this.cmVolumes[d.vi] = d.pre;
      this.cmSel = { volume: d.vi, verts: [] };
    }
    this.pushCmHistory();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.inspector.refresh();
  }

  // ---- poly-snap brush: sample the real model surface, emit a hugging box ----

  private cmPolyActive(): boolean {
    return this.meshEditActive() && this.cmPolySnap;
  }

  private cmPolyBegin(ev: PointerEvent): void {
    const hit = this.viewport3d?.modelHitAt(ev.clientX, ev.clientY);
    this.cmPolyPoints = hit ? [hit] : [];
  }

  private cmPolyMove(ev: PointerEvent): void {
    if (!this.cmPolyPoints) return;
    const hit = this.viewport3d?.modelHitAt(ev.clientX, ev.clientY);
    if (hit) this.cmPolyPoints.push(hit);
  }

  private cmPolyEnd(): void {
    const pts = this.cmPolyPoints;
    this.cmPolyPoints = null;
    if (!pts || pts.length < 2) return;
    const p = this.meshEditPlacement();
    if (!p) return;
    // Model space: CM keeps the asset at the origin (yaw 0, scale 1); a Build
    // model sits at (p.x, p.z) with its local origin seated at the terrain plus
    // any vertical offset, so world hits map back the same way.
    const seat =
      (p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.map.meta.seed)) + (p.y ?? 0);
    const a = pts[0];
    const b = pts[pts.length - 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    // Yaw so the box's local X axis runs along the drag (rotY convention:
    // rotY(x, z, ry) rotates model space into world space).
    const ry = Math.atan2(dz, dx) * -1;
    const midX = (a.x + b.x) / 2;
    const midZ = (a.z + b.z) / 2;
    const ux = dx / len;
    const uz = dz / len;
    let minY = Infinity;
    let maxY = -Infinity;
    let maxPerp = 0.05;
    for (const q of pts) {
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
      // Spread perpendicular to the drag direction (thin wall by default,
      // thicker when the drag wanders across the surface).
      const perp = Math.abs((q.x - midX) * -uz + (q.z - midZ) * ux);
      maxPerp = Math.max(maxPerp, perp);
    }
    const box: MapHitbox = {
      x: midX - p.x,
      y: (minY + maxY) / 2 - seat,
      z: midZ - p.z,
      hx: Math.max(0.05, len / 2),
      hy: Math.max(0.1, (maxY - minY) / 2 + 0.05),
      hz: Math.min(2, maxPerp + 0.05),
      ry,
    };
    if (this.cmVolumes.length >= 24) {
      this.toasts.error(t('editor.selection.hitboxCap', { max: 24 }));
      return;
    }
    if (this.collisionMaster && p.collisionMode !== 'baked') {
      this.updateSelectedPlacement({ collisionMode: 'baked' }, true);
    }
    // The snapped plane lands as an editable box mesh like every volume.
    this.cmVolumes.push(meshFromHitbox(box));
    this.cmSel = { volume: this.cmVolumes.length - 1, verts: [] };
    this.pushCmHistory();
    this.deriveCmHitboxes();
    this.syncCmView();
    this.inspector.refresh();
  }

  /** Copy one placement's collision block (type, shape, hitbox edits) onto
   *  another, SIZED to the target's own scale so a small copy never inherits a
   *  big copy's oversized footprint. Hitboxes are mesh-space (the sim multiplies
   *  them by each placement's scale) so they copy verbatim; the ABSOLUTE
   *  basic-radius override is rescaled by the target/source scale ratio to keep
   *  the source's collision-to-model proportion. Deletes fields the source does
   *  not carry, so the target ends up a match rather than a merge. */
  private copyCollisionSettings(src: AssetPlacement, dst: AssetPlacement): void {
    if (src.collisionMode !== undefined) dst.collisionMode = src.collisionMode;
    else delete dst.collisionMode;
    dst.collide = src.collide;
    if (src.collideRadius !== undefined) {
      const srcScale = src.scale > 0 ? src.scale : 1;
      const ratio = (dst.scale > 0 ? dst.scale : 1) / srcScale;
      dst.collideRadius = Math.min(
        MAX_COLLIDE_RADIUS,
        Math.max(MIN_COLLIDE_RADIUS, src.collideRadius * ratio),
      );
    } else delete dst.collideRadius;
    if (src.collideShape !== undefined) dst.collideShape = src.collideShape;
    else delete dst.collideShape;
    if (src.hitboxes !== undefined) dst.hitboxes = src.hitboxes.map((b) => ({ ...b }));
    else delete dst.hitboxes;
  }

  /** "Copy collision to all {asset}" from the bottom of the collision menu:
   *  after an in-app confirm, give every OTHER placement of the active asset the
   *  active one's whole collision setup, as a single undo step. */
  private async copyCollisionToSameAsset(): Promise<void> {
    const index = this.selectedPlacement;
    const src = index === null ? undefined : this.map.placements[index];
    if (index === null || !src) return;
    const targets = this.map.placements
      .map((_, i) => i)
      .filter((i) => i !== index && this.map.placements[i].assetId === src.assetId);
    if (targets.length === 0) return;
    const name = this.placementLabel(src.assetId);
    const count = formatNumber(targets.length, { useGrouping: false });
    const ok = await confirmDialog(this.root, {
      title: t('editor.selection.collisionCopyConfirmTitle', { name }),
      body: t('editor.selection.collisionCopyConfirmBody', { name, count }),
      confirmLabel: t('editor.selection.collisionCopyConfirm'),
    });
    if (!ok) return;
    // The dialog is modal, but guard the async gap: bail if the active placement
    // is no longer the same object at the same index.
    if (this.selectedPlacement !== index || this.map.placements[index] !== src) return;
    const prev = new Map(targets.map((i) => [i, { ...this.map.placements[i] }]));
    for (const i of targets) this.copyCollisionSettings(src, this.map.placements[i]);
    const next = new Map(targets.map((i) => [i, { ...this.map.placements[i] }]));
    const applyAll = (snaps: Map<number, AssetPlacement>): void => {
      for (const [i, snap] of snaps) this.restorePlacementSnapshot(i, snap);
      this.viewport3d?.rebuildPlacements();
      this.canvasDirty = true;
    };
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'copy-collision-to-asset',
      undo: () => applyAll(prev),
      redo: () => applyAll(next),
    });
    this.viewport3d?.rebuildPlacements();
    this.canvasDirty = true;
    this.markDirty();
    this.toasts.success(t('editor.selection.collisionCopied', { name, count }));
  }

  /** "Scale all copies" from the Selection panel: after an in-app confirm, roll a
   *  random scale in [cloneScaleMin, cloneScaleMax] onto EVERY placement of the
   *  selected asset (the active one included), as a single undo step. min==max
   *  gives a uniform scale; a wider range adds natural size variation. */
  private async scaleAllSameAsset(): Promise<void> {
    const index = this.selectedPlacement;
    const src = index === null ? undefined : this.map.placements[index];
    if (index === null || !src) return;
    const targets = this.map.placements
      .map((_, i) => i)
      .filter((i) => this.map.placements[i].assetId === src.assetId);
    if (targets.length === 0) return;
    const lo = Math.max(PLACEMENT_SCALE_MIN, Math.min(this.cloneScaleMin, this.cloneScaleMax));
    const hi = Math.min(PLACEMENT_SCALE_MAX, Math.max(this.cloneScaleMin, this.cloneScaleMax));
    const name = this.placementLabel(src.assetId);
    const count = formatNumber(targets.length, { useGrouping: false });
    const fmt = (v: number): string =>
      formatNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const ok = await confirmDialog(this.root, {
      title: t('editor.selection.scaleAllConfirmTitle', { name }),
      body: t('editor.selection.scaleAllConfirmBody', {
        name,
        count,
        min: fmt(lo),
        max: fmt(hi),
      }),
      confirmLabel: t('editor.selection.scaleAllConfirm'),
    });
    if (!ok) return;
    if (this.selectedPlacement !== index || this.map.placements[index] !== src) return;
    const prev = new Map(targets.map((i) => [i, { ...this.map.placements[i] }]));
    // Seeded editor PRNG (never the sim Rng): deterministic per map, so the same
    // range re-rolls the same look until the maker widens it.
    const rng = makeRng(this.map.meta.seed);
    for (const i of targets) {
      const q = this.map.placements[i];
      const s = lo >= hi ? lo : lo + rng() * (hi - lo);
      q.scale = Math.min(PLACEMENT_SCALE_MAX, Math.max(PLACEMENT_SCALE_MIN, s));
    }
    const next = new Map(targets.map((i) => [i, { ...this.map.placements[i] }]));
    const applyAll = (snaps: Map<number, AssetPlacement>): void => {
      for (const [i, snap] of snaps) this.restorePlacementSnapshot(i, snap);
      this.viewport3d?.rebuildPlacements();
      this.canvasDirty = true;
      this.inspector.refresh();
    };
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'scale-all-asset',
      undo: () => applyAll(prev),
      redo: () => applyAll(next),
    });
    this.viewport3d?.rebuildPlacements();
    this.canvasDirty = true;
    this.markDirty();
    this.inspector.refresh();
    this.toasts.success(t('editor.selection.scaleAllDone', { name, count }));
  }

  // ---- "true collision" fine bake -------------------------------------------------

  /** Bake (once per asset, cached on the doc) the fine mesh-hugging box set
   *  'mesh' collision mode blocks with. Async; placements fall back to the
   *  standard baked boxes until it lands. */
  private ensureMeshCollision(assetId: string): void {
    if (this.map.assetCollisionMesh?.[assetId] || this.meshBakesInFlight.has(assetId)) return;
    const url = localAssetUrl(assetId) ?? userAssetPath(assetId) ?? assetById(assetId)?.path;
    if (!url) {
      this.toasts.error(t('editor.selection.meshBakeFailed'));
      return;
    }
    this.meshBakesInFlight.add(assetId);
    this.toasts.info(t('editor.selection.meshBaking'));
    void bakeTrueModelCollision(url)
      .then((boxes) => {
        this.meshBakesInFlight.delete(assetId);
        if (!boxes || boxes.length === 0) {
          this.toasts.error(t('editor.selection.meshBakeFailed'));
          this.inspector.refresh();
          return;
        }
        if (!this.map.assetCollisionMesh) this.map.assetCollisionMesh = {};
        this.map.assetCollisionMesh[assetId] = boxes.slice(0, MAX_ASSET_COLLISION_MESH_BOXES);
        this.map.meta.updatedAt = now();
        this.markDirty();
        // Re-project every placement so mesh-mode ones pick up the fine boxes.
        this.viewport3d?.rebuildPlacements();
        this.toasts.info(
          t('editor.selection.meshBakeDone', {
            count: formatNumber(this.map.assetCollisionMesh[assetId].length, {
              useGrouping: false,
            }),
          }),
        );
        this.inspector.refresh();
      })
      .catch(() => {
        this.meshBakesInFlight.delete(assetId);
        this.toasts.error(t('editor.selection.meshBakeFailed'));
        this.inspector.refresh();
      });
  }

  private updateSelectedPlacement(
    change: {
      x?: number;
      z?: number;
      y?: number;
      rotY?: number;
      rotX?: number;
      rotZ?: number;
      scale?: number;
      scaleX?: number;
      scaleY?: number;
      scaleZ?: number;
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
    opts?: { detachOnMove?: boolean },
  ): void {
    const index = this.selectedPlacement;
    if (index === null) return;
    const p = this.map.placements[index];
    if (!p) return;
    // Capture the PRE-DRAG value before the first mutation (waterBase pattern):
    // live slider events mutate p on every input, so a prev taken at commit time
    // would equal next and make undo a no-op.
    const base =
      this.placementDragBase?.index === index ? this.placementDragBase : { index, prev: { ...p } };
    this.placementDragBase = base;
    // Feature: once you MOVE a placement with the Move tool it stops respecting
    // the terrain (free-float anywhere). Detach on the first horizontal drag
    // sample, AFTER the undo base is captured, so one Ctrl+Z restores the
    // grounded state, freezing the ground at the pre-move position so it does
    // not jump. A pure Y lift, rotate, or scale never detaches.
    //
    // Rig markers re-derive their bore/ridge from their transform: XZ moves
    // the path, the Y gizmo lifts/dives the node, gizmo scale sets its girth.
    const isCaveMarker =
      p.assetId === CAVE_ENTRANCE_ASSET_ID ||
      p.assetId === CAVE_EXIT_ASSET_ID ||
      p.assetId === CAVE_POINT_ASSET_ID;
    const isRigMarker = this.isRigMarkerAsset(p.assetId);
    // Cave markers are ANCHORED (frozen ground): their elevation is absolute
    // so the tube ignores whatever the terrain does. Heal markers from older
    // sessions on first touch by freezing the CURRENT surface under them ?
    // their y offset keeps meaning the same height it did before the freeze.
    if (isCaveMarker && !p.detached) {
      p.detached = true;
      p.groundY = terrainHeight(p.x, p.z, this.map.meta.seed);
    }
    // Rock ridge markers keep the legacy terrain-relative behavior.
    if (p.assetId === ROCK_POINT_ASSET_ID && p.detached) {
      delete p.detached;
      delete p.groundY;
    }
    const detachMove =
      opts?.detachOnMove === true &&
      !isRigMarker &&
      (change.x !== undefined || change.z !== undefined);
    if (detachMove) this.moveSeat(index);
    // Group transform: moving/rotating/scaling the active placement carries the
    // other multi-selection members along (Blender-style). The group translates
    // by the same delta and rotates/scales as a unit about the active
    // placement's gesture-start pivot, each member also spinning/scaling in
    // place to match. Deltas are taken against the active's pre-gesture base
    // and applied to per-member snapshots, so every live sample re-derives the
    // members from one stable baseline (no incremental drift).
    const groupIndices = [...this.selectedSet].filter(
      (gi) => gi !== index && this.map.placements[gi],
    );
    const groupChange =
      change.x !== undefined ||
      change.z !== undefined ||
      change.y !== undefined ||
      change.rotY !== undefined ||
      change.scale !== undefined;
    if (groupChange && groupIndices.length > 0) {
      if (!this.groupDragBase) {
        this.groupDragBase = new Map(
          groupIndices.map((gi) => [gi, { ...this.map.placements[gi] }]),
        );
      }
      const prev = base.prev;
      const dx = change.x !== undefined ? change.x - prev.x : 0;
      const dz = change.z !== undefined ? change.z - prev.z : 0;
      // Vertical lifts ride along too (the gizmo's Y arrow): same clamp as the
      // active placement below.
      const dy = change.y !== undefined ? change.y - (prev.y ?? 0) : 0;
      const dRot = change.rotY !== undefined ? change.rotY - prev.rotY : 0;
      const ratio = change.scale !== undefined && prev.scale > 0 ? change.scale / prev.scale : 1;
      for (const gi of groupIndices) {
        const snap = this.groupDragBase.get(gi);
        const q = this.map.placements[gi];
        if (!snap || !q) continue;
        // Detach each member too (before moving it, so the frozen ground is the
        // pre-move height), the whole group floats free consistently.
        if (detachMove) this.moveSeat(gi);
        const pt = groupMemberPoint(snap.x, snap.z, prev.x, prev.z, dx, dz, dRot, ratio);
        q.x = pt.x;
        q.z = pt.z;
        if (change.y !== undefined) {
          q.y = Math.min(
            MAX_PLACEMENT_Y_OFFSET,
            Math.max(-MAX_PLACEMENT_Y_OFFSET, (snap.y ?? 0) + dy),
          );
        }
        if (change.rotY !== undefined) q.rotY = wrapAngle(snap.rotY + dRot);
        if (change.scale !== undefined) {
          q.scale = Math.min(
            PLACEMENT_SCALE_MAX,
            Math.max(PLACEMENT_SCALE_MIN, snap.scale * ratio),
          );
        }
        this.viewport3d?.placementUpdated(gi, {
          x: q.x,
          z: q.z,
          y: change.y !== undefined ? q.y : undefined,
          rotY: change.rotY !== undefined ? q.rotY : undefined,
          scale: change.scale !== undefined ? q.scale : undefined,
          collideRadius: q.collide ? effectiveCollideRadius(q) : 0,
        });
      }
      this.syncMultiSelectionView();
    }
    if (change.x !== undefined) p.x = change.x;
    if (change.z !== undefined) p.z = change.z;
    if (change.rotY !== undefined) p.rotY = change.rotY;
    if (change.rotX !== undefined) p.rotX = wrapAngle(change.rotX);
    if (change.rotZ !== undefined) p.rotZ = wrapAngle(change.rotZ);
    if (change.scale !== undefined) p.scale = change.scale;
    if (change.scaleX !== undefined) {
      p.scaleX = Math.min(MAX_AXIS_SCALE, Math.max(MIN_AXIS_SCALE, change.scaleX));
    }
    if (change.scaleY !== undefined) {
      p.scaleY = Math.min(MAX_AXIS_SCALE, Math.max(MIN_AXIS_SCALE, change.scaleY));
    }
    if (change.scaleZ !== undefined) {
      p.scaleZ = Math.min(MAX_AXIS_SCALE, Math.max(MIN_AXIS_SCALE, change.scaleZ));
    }
    if (change.y !== undefined) {
      p.y = Math.min(MAX_PLACEMENT_Y_OFFSET, Math.max(-MAX_PLACEMENT_Y_OFFSET, change.y));
    }
    // Collision block (type dropdown, basic radius/shape, collide toggle). With
    // several placements selected it edits EVERY selected one, not just the
    // active: snapshot the other members up front so the commit path records a
    // single group undo (the same move-placements machinery used for transforms).
    const collisionChange =
      change.collide !== undefined ||
      change.collisionMode !== undefined ||
      change.collideRadius !== undefined ||
      change.collideShape !== undefined;
    if (collisionChange && this.selectedSet.size > 1 && !this.groupDragBase) {
      const members = [...this.selectedSet].filter((gi) => gi !== index && this.map.placements[gi]);
      if (members.length > 0) {
        this.groupDragBase = new Map(members.map((gi) => [gi, { ...this.map.placements[gi] }]));
      }
    }
    this.applyCollisionFields(p, change, index);
    if (collisionChange && this.groupDragBase) {
      for (const gi of this.groupDragBase.keys()) {
        const q = this.map.placements[gi];
        if (!q || gi === index) continue;
        this.applyCollisionFields(q, change, gi);
        this.viewport3d?.placementUpdated(gi, {
          collideRadius: effectiveCollisionMode(q) !== 'none' ? effectiveCollideRadius(q) : 0,
          collideShape: q.collideShape ?? null,
          collideCustom: effectiveCollisionMode(q) === 'basic',
          hitboxes: change.collisionMode !== undefined ? this.resolvedHitboxesFor(q) : undefined,
        });
      }
    }
    for (const key of ['tint', 'opacity', 'glow', 'glowStrength'] as const) {
      const v = change[key];
      if (v === undefined) continue;
      if (v === null) delete p[key];
      else p[key] = v;
    }
    if (change.fire !== undefined) {
      if (change.fire) p.fire = true;
      else delete p.fire;
    }
    if (change.fireEffects !== undefined) {
      if (change.fireEffects && change.fireEffects.length > 0) {
        p.fireEffects = change.fireEffects.map((fx) => ({ ...fx }));
        // Rich emitters are authoritative. Removing the legacy bit keeps an
        // export unambiguous and avoids a surprise fallback if all are deleted.
        delete p.fire;
      } else delete p.fireEffects;
    }
    // Fluid-pool fields (hue/lum shared with grass; DPS + effect bits fluid-only).
    if (change.hue !== undefined) {
      if (change.hue === null) delete p.hue;
      else p.hue = Math.min(360, Math.max(0, change.hue));
    }
    if (change.lum !== undefined) {
      if (change.lum === null) delete p.lum;
      else p.lum = Math.min(1, Math.max(0, change.lum));
    }
    if (change.fluidDps !== undefined) {
      if (change.fluidDps === null) delete p.fluidDps;
      else p.fluidDps = Math.min(50, Math.max(0, change.fluidDps));
    }
    if (change.fluidFx !== undefined) {
      if (change.fluidFx === null) delete p.fluidFx;
      else p.fluidFx = Math.round(Math.min(15, Math.max(0, change.fluidFx)));
    }
    // Collider-volume dimensions (same clamps as the shared sanitizer).
    if (change.sizeX !== undefined) {
      p.sizeX = Math.min(MAX_COLLIDER_SIZE, Math.max(MIN_COLLIDER_SIZE, change.sizeX));
    }
    if (change.sizeY !== undefined) {
      p.sizeY = Math.min(MAX_COLLIDER_SIZE_Y, Math.max(MIN_COLLIDER_SIZE_Y, change.sizeY));
    }
    if (change.sizeZ !== undefined) {
      p.sizeZ = Math.min(MAX_COLLIDER_SIZE, Math.max(MIN_COLLIDER_SIZE, change.sizeZ));
    }
    // Generated-rock shape edits: clamp, then rebuild the procedural mesh in
    // the view (the record is the source of truth; the model re-derives).
    let rockChanged = false;
    if (change.rockSeed !== undefined) {
      p.rockSeed = Math.max(0, Math.round(change.rockSeed));
      rockChanged = true;
    }
    if (change.rockNoise !== undefined) {
      p.rockNoise = Math.min(1, Math.max(0, change.rockNoise));
      rockChanged = true;
    }
    if (change.rockDetail !== undefined) {
      p.rockDetail = Math.min(1, Math.max(0, change.rockDetail));
      rockChanged = true;
    }
    if (change.rockSharp !== undefined) {
      p.rockSharp = Math.min(1, Math.max(0, change.rockSharp));
      rockChanged = true;
    }
    if (change.rockTex !== undefined) {
      p.rockTex = Math.min(2, Math.max(0, Math.round(change.rockTex)));
      // Picking a legacy look clears any texture-set override.
      delete p.rockTexId;
      rockChanged = true;
    }
    if (change.rockHeight !== undefined) {
      p.rockHeight = Math.min(3, Math.max(0.3, change.rockHeight));
      rockChanged = true;
    }
    if (change.rockDepth !== undefined) {
      p.rockDepth = Math.min(1, Math.max(0, change.rockDepth));
      rockChanged = true;
    }
    if (change.rockJag !== undefined) {
      p.rockJag = Math.min(1, Math.max(0, change.rockJag));
      rockChanged = true;
    }
    if (change.rockTexId !== undefined) {
      if (change.rockTexId === null || change.rockTexId === '') delete p.rockTexId;
      else p.rockTexId = change.rockTexId;
      rockChanged = true;
    }
    if (change.rockTexTile !== undefined) {
      p.rockTexTile = Math.min(64, Math.max(1, change.rockTexTile));
      rockChanged = true;
    }
    if (rockChanged && (p.assetId === ROCK_ASSET_ID || p.assetId === ROCK_RIDGE_ASSET_ID)) {
      this.viewport3d?.placementAdded(index);
      // placementAdded rebuilds via remove+add, which drops the gold ring.
      this.viewport3d?.setSelectedPlacement(index);
    }
    // Cave rig points regenerate their bore live as they move, scale, or
    // lift: gizmo scale sets that node's bore girth, the Y gizmo its authored
    // depth (the rig's dotted guide follows even before the cave generates).
    if (
      (p.assetId === CAVE_ENTRANCE_ASSET_ID ||
        p.assetId === CAVE_EXIT_ASSET_ID ||
        p.assetId === CAVE_POINT_ASSET_ID) &&
      (change.x !== undefined ||
        change.z !== undefined ||
        change.y !== undefined ||
        change.scale !== undefined ||
        change.scaleX !== undefined ||
        change.scaleY !== undefined ||
        change.scaleZ !== undefined)
    ) {
      this.regenerateCaveForEndpoint(p);
      this.refreshCaveGuides();
    }
    // Rock rig points likewise live-regenerate their merged ridge.
    if (
      p.assetId === ROCK_POINT_ASSET_ID &&
      (change.x !== undefined ||
        change.z !== undefined ||
        change.y !== undefined ||
        change.scale !== undefined ||
        change.scaleX !== undefined ||
        change.scaleY !== undefined ||
        change.scaleZ !== undefined)
    ) {
      this.regenerateRockRidgeForPoint(p);
      this.refreshRockGuides();
    }
    // The render view gets the transform change plus the EFFECTIVE footprint
    // radius (0 = walk-through), so collide toggles, radius drags, and scale
    // changes all repaint the footprint ring live.
    this.viewport3d?.placementUpdated(index, {
      x: change.x,
      z: change.z,
      y: change.y !== undefined ? p.y : undefined,
      rotY: change.rotY,
      rotX: change.rotX !== undefined ? p.rotX : undefined,
      rotZ: change.rotZ !== undefined ? p.rotZ : undefined,
      scale: change.scale,
      scaleX: change.scaleX !== undefined ? p.scaleX : undefined,
      scaleY: change.scaleY !== undefined ? p.scaleY : undefined,
      scaleZ: change.scaleZ !== undefined ? p.scaleZ : undefined,
      collideRadius: effectiveCollisionMode(p) !== 'none' ? effectiveCollideRadius(p) : 0,
      collideShape: p.collideShape ?? null,
      collideCustom:
        change.collisionMode !== undefined ||
        change.collideRadius !== undefined ||
        change.collideShape !== undefined ||
        change.collide !== undefined
          ? effectiveCollisionMode(p) === 'basic'
          : undefined,
      hitboxes: change.collisionMode !== undefined ? this.resolvedHitboxesFor(p) : undefined,
      tint: change.tint !== undefined ? (p.tint ?? null) : undefined,
      opacity: change.opacity !== undefined ? (p.opacity ?? null) : undefined,
      glow: change.glow !== undefined ? (p.glow ?? null) : undefined,
      glowStrength: change.glowStrength !== undefined ? (p.glowStrength ?? null) : undefined,
      fire: change.fire !== undefined ? (p.fire ?? null) : undefined,
      fireEffects:
        change.fireEffects !== undefined
          ? (p.fireEffects?.map((fx) => ({ ...fx })) ?? null)
          : undefined,
    });
    this.canvasDirty = true;
    if (!commit) return;
    const prev = base.prev;
    this.placementDragBase = null;
    const groupPrev = this.groupDragBase;
    this.groupDragBase = null;
    const next = { ...p };
    if (
      prev.x === next.x &&
      prev.z === next.z &&
      prev.y === next.y &&
      prev.rotY === next.rotY &&
      prev.scale === next.scale &&
      prev.collide === next.collide &&
      prev.collideRadius === next.collideRadius &&
      prev.collideShape === next.collideShape &&
      prev.collisionMode === next.collisionMode &&
      prev.tint === next.tint &&
      prev.opacity === next.opacity &&
      prev.glow === next.glow &&
      prev.glowStrength === next.glowStrength &&
      prev.fire === next.fire &&
      prev.fireEffects === next.fireEffects &&
      prev.sizeX === next.sizeX &&
      prev.sizeY === next.sizeY &&
      prev.sizeZ === next.sizeZ &&
      prev.rotX === next.rotX &&
      prev.rotZ === next.rotZ &&
      prev.scaleX === next.scaleX &&
      prev.scaleY === next.scaleY &&
      prev.scaleZ === next.scaleZ &&
      // A Move grab that detaches then returns to its start x/z still changed
      // state (grounded -> floating): it must record an undo entry.
      prev.detached === next.detached &&
      prev.groundY === next.groundY
    ) {
      return; // drag ended where it started: no undoable change
    }
    this.map.meta.updatedAt = now();
    if (groupPrev && groupPrev.size > 0) {
      // One undo entry for the whole group transform (move/rotate/scale).
      const groupNext = new Map<number, AssetPlacement>();
      for (const gi of groupPrev.keys()) {
        const q = this.map.placements[gi];
        if (q) groupNext.set(gi, { ...q });
      }
      const applyGroup = (snaps: Map<number, AssetPlacement>): void => {
        for (const [gi, snap] of snaps) this.restorePlacementSnapshot(gi, snap);
      };
      this.pushUndo({
        label: 'move-placements',
        undo: () => {
          this.restorePlacementSnapshot(index, prev);
          applyGroup(groupPrev);
          this.viewport3d?.rebuildPlacements();
          this.syncMultiSelectionView();
        },
        redo: () => {
          this.restorePlacementSnapshot(index, next);
          applyGroup(groupNext);
          this.viewport3d?.rebuildPlacements();
          this.syncMultiSelectionView();
        },
      });
      return;
    }
    this.pushUndo({
      label: 'edit-placement',
      undo: () => this.restorePlacementSnapshot(index, prev),
      redo: () => this.restorePlacementSnapshot(index, next),
    });
  }

  /** Apply the collision-block fields of an inspector change to ONE placement.
   *  Shared by the active selection and, for a multi-selection, every other
   *  selected member so the collision dropdown/sliders retarget the whole group
   *  in one edit. `index` is the placement's own index (for the hitbox-edit
   *  guard); `p` is that placement. */
  private applyCollisionFields(
    p: AssetPlacement,
    change: {
      collide?: boolean;
      collisionMode?: CollisionMode;
      collideRadius?: number | null;
      collideShape?: 'square' | null;
    },
    index: number,
  ): void {
    if (change.collide !== undefined) p.collide = change.collide;
    if (change.collisionMode !== undefined) {
      p.collisionMode = change.collisionMode;
      // `collide` mirrors the mode so legacy consumers (2D overlay, playtest
      // projection) keep working; 'none' is the only walk-through mode.
      p.collide = change.collisionMode !== 'none';
      if (change.collisionMode !== 'baked' && this.hitboxEdit?.index === index) {
        this.exitHitboxEdit();
      }
      if (change.collisionMode === 'mesh') this.ensureMeshCollision(p.assetId);
    }
    if (change.collideRadius !== undefined) {
      // number = set the override (clamped), null = back to the derived auto.
      if (change.collideRadius === null) delete p.collideRadius;
      else {
        p.collideRadius = Math.min(
          MAX_COLLIDE_RADIUS,
          Math.max(MIN_COLLIDE_RADIUS, change.collideRadius),
        );
      }
    }
    if (change.collideShape !== undefined) {
      if (change.collideShape === 'square') p.collideShape = 'square';
      else delete p.collideShape;
    }
  }

  /** Undo/redo restore of a full placement snapshot. Object.assign alone would
   *  leave a since-added optional collideRadius behind, so clear it explicitly
   *  when the snapshot never carried one. */
  private restorePlacementSnapshot(index: number, snap: AssetPlacement): void {
    const p = this.map.placements[index];
    if (!p) return;
    Object.assign(p, snap);
    if (snap.collideRadius === undefined) delete p.collideRadius;
    if (snap.collideShape === undefined) delete p.collideShape;
    if (snap.tint === undefined) delete p.tint;
    if (snap.opacity === undefined) delete p.opacity;
    if (snap.glow === undefined) delete p.glow;
    if (snap.glowStrength === undefined) delete p.glowStrength;
    if (snap.fire === undefined) delete p.fire;
    if (snap.fireEffects === undefined) delete p.fireEffects;
    if (snap.sizeX === undefined) delete p.sizeX;
    if (snap.sizeY === undefined) delete p.sizeY;
    if (snap.sizeZ === undefined) delete p.sizeZ;
    if (snap.rotX === undefined) delete p.rotX;
    if (snap.rotZ === undefined) delete p.rotZ;
    if (snap.scaleX === undefined) delete p.scaleX;
    if (snap.scaleY === undefined) delete p.scaleY;
    if (snap.scaleZ === undefined) delete p.scaleZ;
    if (snap.y === undefined) delete p.y;
    // Detach state is part of the transform gesture (a Move-tool grab flips it),
    // so undo/redo must restore the exact grounded/floating state, name and hide.
    if (snap.detached === undefined) delete p.detached;
    if (snap.groundY === undefined) delete p.groundY;
    if (snap.name === undefined) delete p.name;
    if (snap.hidden === undefined) delete p.hidden;
    if (snap.collisionMode === undefined) delete p.collisionMode;
    if (snap.hitboxes === undefined) delete p.hitboxes;
    if (
      this.selectedPlacement === index &&
      this.selectedFireEmitter !== null &&
      !p.fireEffects?.[this.selectedFireEmitter]
    ) {
      this.selectedFireEmitter = null;
      this.viewport3d?.setFireEmitterEdit(null, null);
    }
    if (this.hitboxEdit?.index === index) this.syncHitboxEditView();
    this.viewport3d?.rebuildPlacements();
    this.canvasDirty = true;
  }

  // ---- direct manipulation (Select mode: drag-move, wheel, nudge) ------------------

  /** A 3D left-press landed on a pickable placement; claim it in Select mode
   *  or any transform tool. */
  private beginPlacementDrag(index: number): boolean {
    if (!isSelectionTool(this.tool)) return false;
    this.selectedKey = null;
    if (this.selectedSet.has(index)) {
      // Dragging a member of the multi-selection: keep the group, make the
      // grabbed one active.
      const keep = new Set(this.selectedSet);
      this.setSelectedPlacement(index);
      this.selectedSet = keep;
      this.syncMultiSelectionView();
    } else {
      this.setSelectedPlacement(index);
    }
    this.placementDragging = true;
    this.transformDragRef = null;
    this.inspector.refresh();
    this.canvasDirty = true;
    return true;
  }

  /**
   * One drag sample over the ground while a placement drag is held. Select and
   * Move reposition; Rotate spins the placement to follow the cursor around its
   * pivot; Scale resizes by the cursor's distance ratio from the pivot. Rotate
   * and Scale capture their baseline from the FIRST sample, so the drag applies
   * pure deltas and never snaps on pickup.
   */
  private placementDragMove(w: Vec2): void {
    const i = this.selectedPlacement;
    const p = i === null ? undefined : this.map.placements[i];
    if (!p) return;
    if (this.tool === 'rotate' || this.tool === 'scale') {
      const dx = w.x - p.x;
      const dz = w.z - p.z;
      const dist = Math.max(0.5, Math.hypot(dx, dz));
      const angle = Math.atan2(dx, dz);
      const ref = this.transformDragRef;
      if (!ref) {
        this.transformDragRef = { angle, dist, rotY: p.rotY, scale: p.scale };
        return;
      }
      if (this.tool === 'rotate') {
        this.updateSelectedPlacement({ rotY: wrapAngle(ref.rotY + (angle - ref.angle)) }, false);
      } else {
        const next = ref.scale * (dist / ref.dist);
        const clamped = Math.min(PLACEMENT_SCALE_MAX, Math.max(PLACEMENT_SCALE_MIN, next));
        this.updateSelectedPlacement({ scale: Math.round(clamped * 100) / 100 }, false);
      }
      return;
    }
    this.updateSelectedPlacement({ x: w.x, z: w.z }, false, {
      detachOnMove: true,
    });
  }

  /** Release: ONE commit diffed against the pre-drag base (single Ctrl+Z). */
  private endPlacementDrag(): void {
    this.placementDragging = false;
    this.transformDragRef = null;
    this.updateSelectedPlacement({}, true);
    this.inspector.refresh();
  }

  // ---- NPC direct manipulation (Select mode) ---------------------------------------
  // NPCs move exactly like placements: press-drag on the body, arrow nudge,
  // one undo step per gesture. Every position write goes through
  // viewport3d.moveMapEntity, which re-seats the LIVE sim entity (pos, prevPos,
  // spawnPos), without that the doc moves while the rendered NPC stands
  // still, which read as "NPCs cannot be moved".

  /** A 3D left-press landed on a rendered NPC; claim it in Select mode. */
  private beginNpcDrag(key: string): boolean {
    if (!isSelectionTool(this.tool)) return false;
    const npc = this.map.content.npcs[key.slice('npc:'.length)];
    if (!npc) return false;
    this.flushTransformCommit();
    this.setSelectedPlacement(null);
    this.objectMoves.select(null);
    if (!this.selectedNpcKeys.has(key)) {
      // Dragging an unselected NPC selects just it; dragging a member of the
      // multi-selection keeps the group and moves it together.
      this.selectedNpcKeys = new Set([key]);
    }
    this.selectedKey = key;
    this.viewport3d?.setSelectedRuntimeNpcs(this.selectedNpcKeys);
    this.npcMoveBase = this.captureNpcMoveBase();
    this.npcMoveAnchor = { key, start: { ...npc.pos } };
    this.inspector.refresh();
    this.canvasDirty = true;
    return true;
  }

  private captureNpcMoveBase(): Map<string, { npc: NpcDef; from: Vec2 }> {
    const base = new Map<string, { npc: NpcDef; from: Vec2 }>();
    for (const key of this.selectedNpcKeys) {
      const npc = this.map.content.npcs[key.slice('npc:'.length)];
      if (npc) base.set(key, { npc, from: { ...npc.pos } });
    }
    return base;
  }

  /** One drag sample: the grabbed NPC chases the ground point, the rest of the
   *  selection keeps its formation (same delta off the pre-drag base). */
  private npcDragMove(w: Vec2): void {
    const base = this.npcMoveBase;
    const anchor = this.npcMoveAnchor;
    if (!base || !anchor) return;
    const dx = w.x - anchor.start.x;
    const dz = w.z - anchor.start.z;
    for (const [key, entry] of base) {
      const from = { ...entry.npc.pos };
      const to = { x: entry.from.x + dx, z: entry.from.z + dz };
      entry.npc.pos.x = to.x;
      entry.npc.pos.z = to.z;
      const entity = this.entities.find((candidate) => candidate.key === key);
      if (entity) Object.assign(entity.point, to);
      this.viewport3d?.moveMapEntity(key, from, to);
    }
    this.canvasDirty = true;
  }

  private endNpcDrag(): void {
    this.commitNpcMove();
    this.inspector.refresh();
  }

  /** ONE undo step per gesture/burst, diffed against npcMoveBase. Undo/redo
   *  re-apply through moveMapEntity so the live sim NPC follows both ways. */
  private commitNpcMove(): void {
    const base = this.npcMoveBase;
    this.npcMoveBase = null;
    this.npcMoveAnchor = null;
    if (!base) return;
    const previous = new Map([...base].map(([key, entry]) => [key, entry.from]));
    const next = new Map([...base].map(([key, entry]) => [key, { ...entry.npc.pos }]));
    const changed = [...previous].some(([key, point]) => {
      const target = next.get(key);
      return target && (target.x !== point.x || target.z !== point.z);
    });
    if (!changed) return;
    const apply = (points: ReadonlyMap<string, Vec2>): void => {
      for (const [key, point] of points) {
        const npc = this.map.content.npcs[key.slice('npc:'.length)];
        if (!npc) continue;
        const from = { ...npc.pos };
        npc.pos.x = point.x;
        npc.pos.z = point.z;
        const entity = this.entities.find((candidate) => candidate.key === key);
        if (entity) Object.assign(entity.point, point);
        this.viewport3d?.moveMapEntity(key, from, point);
      }
      this.canvasDirty = true;
    };
    this.pushUndo({
      label: 'move-npcs',
      undo: () => apply(previous),
      redo: () => apply(next),
    });
    this.map.meta.updatedAt = now();
    this.markDirty();
  }

  /** Select a rendered camp mob from a Select-mode tap (splitting its camp
   *  into individuals when needed, exactly like the Mob tool's own pick). */
  private selectMobFromTap(id: number, additive: boolean): boolean {
    const camp = this.individualCampForRuntimeMob(id);
    if (!camp) return false;
    // A split respawned every authored mob with fresh ids: re-resolve the
    // clicked mob to the live entity that now owns this camp.
    const liveId =
      this.viewport3d?.liveMobIdNearCamp(camp.mobId, camp.center, Math.max(4, camp.radius)) ?? id;
    this.flushTransformCommit();
    this.setSelectedPlacement(null);
    this.clearNpcSelection();
    this.selectedKey = null;
    this.selectedMobIds = toggledMobSelection(this.selectedMobIds, liveId, additive);
    if (this.selectedMobIds.has(liveId)) this.selectedMobCamps.set(liveId, camp);
    else this.selectedMobCamps.delete(liveId);
    for (const mid of [...this.selectedMobCamps.keys()]) {
      if (!this.selectedMobIds.has(mid)) this.selectedMobCamps.delete(mid);
    }
    this.viewport3d?.setSelectedRuntimeMobs(this.selectedMobIds);
    this.syncSelectedMobRouteOverlay();
    this.inspector.refresh();
    this.canvasDirty = true;
    return true;
  }

  /** A 3D left-press landed on a rendered mob; claim it in Select mode. */
  private beginMobDrag(id: number): boolean {
    if (!isSelectionTool(this.tool)) return false;
    const camp = this.individualCampForRuntimeMob(id);
    if (!camp) return false;
    // A split respawned every authored mob with fresh ids: re-resolve the
    // grabbed mob to the live entity that now owns this camp, or the runtime
    // move targets a dead id and the rendered mob stands still.
    const liveId =
      this.viewport3d?.liveMobIdNearCamp(camp.mobId, camp.center, Math.max(4, camp.radius)) ?? id;
    this.flushTransformCommit();
    this.setSelectedPlacement(null);
    this.clearNpcSelection();
    this.selectedKey = null;
    if (!this.selectedMobIds.has(liveId)) {
      // Dragging an unselected mob selects just it; a member of the
      // multi-selection keeps the group and moves it together.
      this.selectedMobIds = new Set([liveId]);
      this.selectedMobCamps.clear();
    }
    this.selectedMobCamps.set(liveId, camp);
    for (const mid of [...this.selectedMobCamps.keys()]) {
      if (!this.selectedMobIds.has(mid)) this.selectedMobCamps.delete(mid);
    }
    this.viewport3d?.setSelectedRuntimeMobs(this.selectedMobIds);
    this.mobMoveState = {
      camps: new Map(
        [...this.selectedMobCamps].map(([mid, c]) => [mid, { camp: c, from: { ...c.center } }]),
      ),
      anchor: null,
      applied: { dx: 0, dz: 0 },
    };
    this.syncSelectedMobRouteOverlay();
    this.inspector.refresh();
    this.canvasDirty = true;
    return true;
  }

  /** One Select-mode drag sample: pure deltas off the first sample (no pickup
   *  snap), streamed into the live sim incrementally like the Mob tool. */
  private mobSelectDragMove(w: Vec2): void {
    const state = this.mobMoveState;
    if (!state) return;
    if (!state.anchor) {
      state.anchor = { ...w };
      return;
    }
    const dx = w.x - state.anchor.x;
    const dz = w.z - state.anchor.z;
    this.viewport3d?.moveRuntimeMobs(
      this.selectedMobIds,
      dx - state.applied.dx,
      dz - state.applied.dz,
    );
    state.applied = { dx, dz };
    for (const { camp, from } of state.camps.values()) {
      camp.center.x = from.x + dx;
      camp.center.z = from.z + dz;
    }
    this.entities = buildEntities(this.content);
    this.syncSelectedMobRouteOverlay();
    this.canvasDirty = true;
  }

  private endMobDrag(): void {
    this.commitMobMove();
    this.inspector.refresh();
  }

  /** ONE undo step per gesture/volley, diffed against mobMoveState. Undo and
   *  redo re-apply through moveRuntimeMobs so the live mobs follow both ways
   *  (the same closure shape as the Mob tool's own 'move-mobs'). */
  private commitMobMove(): void {
    const state = this.mobMoveState;
    this.mobMoveState = null;
    if (!state) return;
    const moves = new Map(
      [...state.camps].map(([mid, entry]) => [
        mid,
        {
          camp: entry.camp,
          prev: entry.from,
          next: { x: entry.camp.center.x, z: entry.camp.center.z },
        },
      ]),
    );
    const changed = [...moves.values()].some(
      (move) => move.prev.x !== move.next.x || move.prev.z !== move.next.z,
    );
    if (!changed) return;
    const apply = (side: 'prev' | 'next'): void => {
      for (const [mid, move] of moves) {
        const target = move[side];
        const dx = target.x - move.camp.center.x;
        const dz = target.z - move.camp.center.z;
        this.viewport3d?.moveRuntimeMobs(new Set([mid]), dx, dz);
        move.camp.center.x = target.x;
        move.camp.center.z = target.z;
      }
      this.entities = buildEntities(this.content);
      this.canvasDirty = true;
    };
    this.pushUndo({
      label: 'move-mobs',
      undo: () => apply('prev'),
      redo: () => apply('next'),
    });
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.syncSelectedMobRouteOverlay();
  }

  /** Shift+wheel rotates, Alt+wheel scales; a burst commits once at the end. */
  /**
   * Free-Fly wheel: re-gear the flight instead of dollying. Writes the SAME
   * value the Camera tab's "WASD move speed" slider owns, so the two controls
   * are one setting; the toast is debounced because a wheel arrives in bursts.
   */
  private flySpeedWheel(deltaY: number): void {
    const next = flySpeedFromWheel(this.cameraSpeeds.move, deltaY);
    if (next === this.cameraSpeeds.move) return;
    this.cameraSpeeds.move = next;
    this.viewport3d?.setCameraSpeeds(this.cameraSpeeds);
    writeJsonPref(CAMERA_SPEEDS_PREF_KEY, this.cameraSpeeds);
    this.inspector.refresh();
    if (this.flySpeedToastTimer !== null) clearTimeout(this.flySpeedToastTimer);
    this.flySpeedToastTimer = setTimeout(() => {
      this.flySpeedToastTimer = null;
      this.toasts.info(t('editor.camera.flySpeedSet', { value: next.toFixed(1) }));
    }, 320) as unknown as number;
  }

  private transformWheel(kind: 'rotate' | 'scale', deltaY: number): boolean {
    if (!isSelectionTool(this.tool) || this.selectedPlacement === null) return false;
    const p = this.map.placements[this.selectedPlacement];
    if (!p) return false;
    if (kind === 'rotate')
      this.updateSelectedPlacement({ rotY: rotateStep(p.rotY, deltaY) }, false);
    else this.updateSelectedPlacement({ scale: scaleStep(p.scale, deltaY) }, false);
    this.scheduleTransformCommit();
    return true;
  }

  /** Arrow-key nudge on the ground plane, relative to the camera yaw.
   *  Placements when one is selected; otherwise the selected NPCs, which
   *  nudge exactly the same way (debounced into one undo per key volley). */
  private nudgeSelected(key: NudgeKey, big: boolean): void {
    const yaw =
      this.viewMode === '3d' ? (this.viewport3d?.cameraYaw() ?? NORTH_UP_YAW) : NORTH_UP_YAW;
    const d = nudgeDelta(key, yaw, big ? NUDGE_STEP_BIG_YD : NUDGE_STEP_YD);
    const i = this.selectedPlacement;
    const p = i === null ? undefined : this.map.placements[i];
    if (p) {
      this.updateSelectedPlacement({ x: p.x + d.dx, z: p.z + d.dz }, false, {
        detachOnMove: true,
      });
      this.scheduleTransformCommit();
      return;
    }
    if (this.selectedNpcDefs().length === 0) {
      if (this.selectedMobCamps.size === 0) {
        if (this.objectMoves.nudge(d.dx, d.dz)) this.scheduleTransformCommit();
        return;
      }
      // Mob volley: same debounced one-undo contract as NPCs below.
      if (!this.mobMoveState) {
        this.mobMoveState = {
          camps: new Map(
            [...this.selectedMobCamps].map(([mid, c]) => [mid, { camp: c, from: { ...c.center } }]),
          ),
          anchor: null,
          applied: { dx: 0, dz: 0 },
        };
      }
      this.viewport3d?.moveRuntimeMobs(this.selectedMobIds, d.dx, d.dz);
      for (const { camp } of this.mobMoveState.camps.values()) {
        camp.center.x += d.dx;
        camp.center.z += d.dz;
      }
      this.entities = buildEntities(this.content);
      this.syncSelectedMobRouteOverlay();
      this.canvasDirty = true;
      this.scheduleTransformCommit();
      return;
    }
    // First press of a volley snapshots the base; the debounced commit below
    // (scheduleTransformCommit -> commitNpcMove) folds the volley into one undo.
    if (!this.npcMoveBase) this.npcMoveBase = this.captureNpcMoveBase();
    for (const [npcKey, entry] of this.npcMoveBase) {
      const from = { ...entry.npc.pos };
      const to = { x: from.x + d.dx, z: from.z + d.dz };
      entry.npc.pos.x = to.x;
      entry.npc.pos.z = to.z;
      const entity = this.entities.find((candidate) => candidate.key === npcKey);
      if (entity) Object.assign(entity.point, to);
      this.viewport3d?.moveMapEntity(npcKey, from, to);
    }
    this.canvasDirty = true;
    this.scheduleTransformCommit();
  }

  /** Debounce the burst commit: one undo entry per wheel spin / key volley. */
  private scheduleTransformCommit(): void {
    this.transformCoalescer.tick(performance.now());
    window.clearTimeout(this.transformTimer);
    this.transformTimer = window.setTimeout(() => {
      if (this.transformCoalescer.due(performance.now())) {
        this.updateSelectedPlacement({}, true);
        // NPC/mob nudge volleys commit through the same debounce (no-ops when
        // no base is open, drags commit on release instead).
        this.commitNpcMove();
        this.commitMobMove();
        this.objectMoves.commitPending();
        this.inspector.refresh();
      }
    }, this.transformCoalescer.windowMs);
  }

  /** Commit an open burst NOW (selection change, undo/redo). */
  private flushTransformCommit(): void {
    if (!this.transformCoalescer.pending) return;
    this.transformCoalescer.cancel();
    window.clearTimeout(this.transformTimer);
    this.updateSelectedPlacement({}, true);
    this.commitNpcMove();
    this.commitMobMove();
    this.objectMoves.commitPending();
  }

  private copySelection(): void {
    if (this.selectedPlacement !== null) {
      const indices =
        this.selectedSet.size > 0 ? this.selectedSet : new Set([this.selectedPlacement]);
      const items = copyPlacementSelection(this.map.placements, indices);
      if (items.length > 0) this.selectionClipboard = { kind: 'placements', items };
    } else if (this.selectedMobCamps.size > 0) {
      const items = copyCampSelection(new Set(this.selectedMobCamps.values()));
      if (items.length > 0) this.selectionClipboard = { kind: 'mobs', items };
    } else if (this.selectedNpcKeys.size > 0) {
      const items = copyNpcSelection(this.map.content.npcs, this.selectedNpcKeys);
      if (items.length > 0) this.selectionClipboard = { kind: 'npcs', items };
    } else {
      this.toasts.info(t('editor.status.selectionNothingToCopy'));
      return;
    }
    const count = this.selectionClipboard?.items.length ?? 0;
    this.toasts.success(t('editor.status.selectionCopied', { count }));
  }

  private pasteSelection(): void {
    const clipboard = this.selectionClipboard;
    if (!clipboard) {
      this.toasts.info(t('editor.status.selectionNothingToPaste'));
      return;
    }
    if (clipboard.kind === 'placements') {
      const start = this.map.placements.length;
      this.appendPlacements(pastePlacementSelection(clipboard.items, 2, 2), 'paste-placements');
      const added = this.map.placements.length - start;
      if (added <= 0) return;
      const indices = Array.from({ length: added }, (_, index) => start + index);
      this.setSelectedPlacement(indices[indices.length - 1]);
      this.selectedSet = new Set(indices);
      this.syncMultiSelectionView();
      this.inspector.refresh();
      this.toasts.success(t('editor.status.selectionPasted', { count: added }));
      return;
    }
    // Mobs and NPCs land centred on the cursor (entity_paste.ts) and update
    // the editor in place, never with a whole-world reload.
    const target = this.hover3dWorld ?? this.cursorWorld;
    if (clipboard.kind === 'mobs') {
      this.clearMobSelection();
      const done = pasteMobs(this.entityPasteHost(), clipboard.items, target, MAX_CAMPS);
      if (!done || done.capped) this.toasts.error(t('editor.status.entityCapReached'));
      if (!done) return;
      this.map.meta.updatedAt = now();
      this.pushUndo({ label: 'paste-mobs', undo: done.undo, redo: done.redo });
      this.inspector.refresh();
      this.toasts.success(t('editor.status.selectionPasted', { count: done.count }));
      return;
    }

    const done = pasteNpcs(this.entityPasteHost(), clipboard.items, target, MAX_NPCS);
    if (!done || done.capped) this.toasts.error(t('editor.status.entityCapReached'));
    if (!done) return;
    const select = (): void => {
      this.selectedNpcKeys = new Set(done.keys.map((key) => `npc:${key}`));
      this.selectedKey = `npc:${done.keys[done.keys.length - 1]}`;
      this.viewport3d?.setSelectedRuntimeNpcs(this.selectedNpcKeys);
    };
    select();
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'paste-npcs',
      undo: () => {
        this.selectedKey = null;
        this.clearNpcSelection();
        done.undo();
      },
      redo: () => {
        done.redo();
        select();
      },
    });
    this.inspector.refresh();
    this.toasts.success(t('editor.status.selectionPasted', { count: done.count }));
  }

  /** The in-place camp and NPC updates a mob or NPC paste runs through. */
  private entityPasteHost(): EntityPasteHost {
    return {
      camps: () => this.camps(),
      npcs: () => this.map.content.npcs as Record<string, NpcDef>,
      campsChanged: () => this.afterCampsChanged(),
      npcAdded: (npc) => {
        this.viewport3d?.addMapNpc(npc);
        this.afterNpcListChanged();
      },
      npcRemoved: (id) => {
        this.viewport3d?.removeMapNpc(id);
        this.afterNpcListChanged();
      },
    };
  }

  /** An NPC joined or left the map: refresh the handles, not the 3D world. */
  private afterNpcListChanged(): void {
    this.entities = buildEntities(this.content);
    this.base = snapshot(this.entities);
    this.canvasDirty = true;
    this.markDirty();
  }

  private duplicateSelectedPlacement(): void {
    // Duplicates the whole multi-selection (box select / Shift+click), offset
    // together so the copies keep their relative layout.
    const indices = [...this.selectedSet].sort((a, b) => a - b);
    if (indices.length === 0 && this.selectedPlacement !== null) {
      indices.push(this.selectedPlacement);
    }
    const copies = indices
      .map((i) => this.map.placements[i])
      .filter((p): p is AssetPlacement => !!p)
      .map((p) => ({ ...cloneAssetPlacement(p), x: p.x + 2, z: p.z + 2 }));
    if (copies.length === 0) return;
    const start = this.map.placements.length;
    this.appendPlacements(copies, 'duplicate-placement');
    // At the placement cap only some (or none) of the copies land: select
    // exactly those, and keep the current selection when nothing was added.
    const added = this.map.placements.length - start;
    if (added <= 0) return;
    this.setSelectedPlacement(start);
    this.selectedSet = new Set(Array.from({ length: added }, (_, k) => start + k));
    this.syncMultiSelectionView();
    this.inspector.refresh();
  }

  /** The document a map was published to the game as (data/maps/<slug>), or
   *  null when it is not published or there is no dev server. */
  private async fetchPublishedMap(slug: string): Promise<CustomMap | null> {
    if (!import.meta.env.DEV) return null;
    const repo = await fetchRepoMap(slug);
    if (!repo) return null;
    // Remember which version this copy started from, for Push changes.
    if (repo.base) repo.map.meta.basedOn = { slug, base: repo.base };
    return repo.map;
  }

  /** The active placement's prefab-pieces definition, when it is a
   *  Blender-built building shipped with a parts twin. */
  private prefabPiecesForSelection(): { index: number; def: PrefabPiecesDef } | null {
    const index = this.selectedPlacement;
    if (index === null || this.selectedSet.size > 1) return null;
    const p = this.map.placements[index];
    if (!p) return null;
    const def = prefabPiecesFor(p.assetId);
    return def ? { index, def } : null;
  }

  /**
   * "Edit pieces": replace the selected building with its kit pieces + shell,
   * each an ordinary placement of a node of the building's parts GLB, so any
   * one of them can be moved, rotated, scaled or deleted. One undo entry puts
   * the building back. The pieces land at the end of the list and become the
   * multi-selection.
   */
  /** Placements the Combine button would join. */
  private combineTargets(): number[] {
    const set = this.selectedSet.size > 1 ? [...this.selectedSet] : [];
    return set.filter((i) => this.map.placements[i]);
  }

  /**
   * Join the selection into one object.
   *
   * The pieces of a split building know what they were (their shell still
   * carries the building's own transform), so those are rebuilt into the
   * building itself, collision and all. Anything else is GROUPED: a shared
   * groupId, so the placements pick, drag, rotate and delete together without
   * inventing a merged mesh that could never be taken apart again.
   */
  private combineSelection(): void {
    const indices = this.combineTargets();
    if (indices.length < 2) {
      this.toasts.error(t('editor.selection.combineNeedsTwo'));
      return;
    }
    const picked = indices.map((i) => this.map.placements[i]);
    const def = prefabOfSelection(picked, prefabPiecesFor);
    const rejoined = def ? rejoinPrefab(picked, def) : null;
    const removed = indices.slice().sort((a, b) => b - a);
    const before = picked.map((p) => cloneAssetPlacement(p));
    const apply = (): void => {
      if (rejoined) {
        for (const i of removed) this.map.placements.splice(i, 1);
        this.map.placements.push(rejoined);
        this.setSelectedPlacement(this.map.placements.length - 1);
      } else {
        const id = newGroupId();
        for (const i of indices) this.map.placements[i].groupId = id;
        this.setSelectedPlacement(indices[0]);
      }
      this.viewport3d?.rebuildPlacements();
      this.canvasDirty = true;
    };
    apply();
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'combine',
      undo: () => {
        if (rejoined) {
          this.map.placements.pop();
          indices.forEach((i, k) => {
            this.map.placements.splice(i, 0, cloneAssetPlacement(before[k]));
          });
        } else {
          for (const i of indices) delete this.map.placements[i].groupId;
        }
        this.setSelectedPlacement(null);
        this.viewport3d?.rebuildPlacements();
        this.canvasDirty = true;
      },
      redo: () => apply(),
    });
    if (rejoined) {
      this.toasts.success(t('editor.selection.combineRejoined', { name: rejoined.assetId }));
    } else {
      this.toasts.success(t('editor.selection.combineGrouped', { count: String(indices.length) }));
    }
  }

  /** Size of the group the active placement belongs to (0 = ungrouped). */
  private groupCount(): number {
    const i = this.selectedPlacement;
    if (i === null || !this.map.placements[i]?.groupId) return 0;
    return groupMembers(this.map.placements, i).length;
  }

  private ungroupSelection(): void {
    const i = this.selectedPlacement;
    if (i === null) return;
    const members = groupMembers(this.map.placements, i);
    if (members.length < 2) return;
    const id = this.map.placements[i].groupId;
    const apply = (): void => {
      for (const k of members) delete this.map.placements[k].groupId;
      this.canvasDirty = true;
    };
    apply();
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'ungroup',
      undo: () => {
        for (const k of members) if (id) this.map.placements[k].groupId = id;
        this.canvasDirty = true;
      },
      redo: () => apply(),
    });
    this.toasts.success(t('editor.selection.ungroupDone', { count: String(members.length) }));
  }

  /** The authored collision a placed building actually uses: its own edited
   *  hitboxes when it has them, else the asset's Collision Master override.
   *  null when the building has no authored shape to hand down. */
  private authoredCollisionOf(building: AssetPlacement): PrefabAuthoredCollision | null {
    if (building.hitboxes && building.hitboxes.length > 0) {
      return { boxes: building.hitboxes, ramps: building.ramps ?? [] };
    }
    const override = collisionOverrideFor(building.assetId);
    if (!override || override.mode !== 'baked') return null;
    const boxes = override.boxes ?? [];
    if (boxes.length === 0) return null;
    return { boxes, ramps: override.ramps ?? [] };
  }

  private explodeSelectedPrefab(): void {
    const hit = this.prefabPiecesForSelection();
    if (!hit) return;
    const { index, def } = hit;
    const building = this.map.placements[index];
    if (!building) return;
    const room = MAX_PLACEMENTS - (this.map.placements.length - 1);
    const pieces = explodePrefab(building, def, {
      groundAt: (x, z) => terrainHeight(x, z, this.map.meta.seed),
      room,
    });
    const wanted = def.pieces.length + (def.shell ? 1 : 0);
    if (pieces.length < wanted) {
      this.toasts.error(t('editor.selection.piecesCap'));
      return;
    }
    // Keep the building's OWN collision through the split: its authored boxes
    // and walkable ramps are re-expressed in each piece's frame
    // (prefab_collision_core), so the doorways stay open and the stairs stay
    // climbable. Only a building with no authored shape falls back to the
    // per-piece default, which is a solid box round each mesh.
    const authored = this.authoredCollisionOf(building);
    if (authored) {
      const split = splitPrefabCollision(authored, def);
      let k = 0;
      if (def.shell) applyCollisionShare(pieces[k++], split.shell);
      for (let i = 0; i < def.pieces.length; i++) {
        applyCollisionShare(pieces[k + i], split.pieces[i]);
      }
    } else {
      for (const piece of pieces) {
        if (piece.collide && piece.collisionMode === undefined) applyDefaultCollision(piece);
      }
    }
    const apply = (): number => {
      this.map.placements.splice(index, 1);
      const start = this.map.placements.length;
      this.map.placements.push(...pieces);
      this.viewport3d?.rebuildPlacements();
      this.canvasDirty = true;
      return start;
    };
    const start = apply();
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'explode-prefab',
      undo: () => {
        this.map.placements.splice(this.map.placements.length - pieces.length, pieces.length);
        this.map.placements.splice(index, 0, building);
        this.setSelectedPlacement(null);
        this.viewport3d?.rebuildPlacements();
        this.canvasDirty = true;
      },
      redo: () => {
        apply();
        this.setSelectedPlacement(null);
      },
    });
    this.setSelectedPlacement(start);
    this.selectedSet = new Set(pieces.map((_, k) => start + k));
    this.syncMultiSelectionView();
    this.inspector.refresh();
    this.toasts.success(t('editor.selection.piecesDone', { count: pieces.length }));
  }

  /**
   * Blender Shift+D: duplicate the WHOLE multi-selection in place, select the
   * copies, and let them follow the cursor until a click drops them (Escape
   * drops them where they are).
   */
  private duplicateAndGrab(): void {
    const indices = [...this.selectedSet].sort((a, b) => a - b);
    const members = indices
      .map((i) => this.map.placements[i])
      .filter((q): q is AssetPlacement => q !== undefined);
    if (members.length === 0) return;
    const startLen = this.map.placements.length;
    this.appendPlacements(members.map(cloneAssetPlacement), 'duplicate-placement');
    const added = this.map.placements.length - startLen;
    if (added === 0) return;
    const newIndices = Array.from({ length: added }, (_, k) => startLen + k);
    this.setSelectedPlacement(newIndices[newIndices.length - 1]);
    this.selectedSet = new Set(newIndices);
    this.syncMultiSelectionView();
    this.inspector.refresh();
    this.placementDragging = true; // single-key tool shortcuts stay quiet
    this.viewport3d?.startGrabFollow();
  }

  /** Delete every selected placement as ONE undo entry. */
  private removeSelectedPlacements(): void {
    // A City Build wall piece deletes its whole run (def + every piece): the
    // run is the editable unit, not the individual fitted segment.
    if (this.selectedSet.size <= 1 && this.selectedPlacement !== null) {
      const cityId = this.map.placements[this.selectedPlacement]?.cityId;
      if (cityId) {
        this.cityDeleteWallRun(cityId);
        return;
      }
    }
    if (this.selectedSet.size <= 1) {
      if (this.selectedPlacement !== null) this.removePlacementAt(this.selectedPlacement);
      return;
    }
    const pairs = [...this.selectedSet]
      .sort((a, b) => a - b)
      .map((i) => [i, this.map.placements[i]] as const)
      .filter((pair): pair is readonly [number, AssetPlacement] => pair[1] !== undefined);
    if (pairs.length === 0) return;
    const removeAll = (): void => {
      for (let k = pairs.length - 1; k >= 0; k--) this.map.placements.splice(pairs[k][0], 1);
      this.setSelectedPlacement(null);
      this.viewport3d?.rebuildPlacements();
      this.canvasDirty = true;
    };
    removeAll();
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'remove-placements',
      undo: () => {
        for (const [i, q] of pairs) this.map.placements.splice(i, 0, q);
        this.viewport3d?.rebuildPlacements();
        this.canvasDirty = true;
      },
      redo: removeAll,
    });
    this.inspector.refresh();
  }

  // ---- camps ----------------------------------------------------------------------

  private camps(): CampDef[] {
    return this.map.content.camps as CampDef[];
  }

  private placeNpcAt(point: Vec2, visualKey: string): void {
    const npcs = this.map.content.npcs as Record<string, NpcDef>;
    if (Object.keys(npcs).length >= MAX_NPCS) {
      this.toasts.error(t('editor.status.entityCapReached'));
      return;
    }
    const visual = buildCharacterVisualOptions(Object.keys(VISUALS)).find(
      (option) => option.key === visualKey,
    );
    const stem =
      visualKey
        .replace(/[^a-z0-9_]+/gi, '_')
        .toLowerCase()
        .slice(0, 36) || 'character';
    let serial = 1;
    let id = `authored_${stem}_${serial}`;
    while (npcs[id]) id = `authored_${stem}_${++serial}`;
    const npc: NpcDef = {
      id,
      name: visual?.label ?? 'Character',
      title: '',
      pos: { x: point.x, z: point.z },
      facing: 0,
      color: 0xe7d4bf,
      questIds: [],
      greeting: '',
      visualKey,
    };
    const insert = (): void => {
      npcs[id] = npc;
      this.activeWorld.npcs = npcs;
      this.viewport3d?.addMapNpc(npc);
      this.entities = buildEntities(this.content);
      this.base = snapshot(this.entities);
      this.selectedKey = `npc:${id}`;
      this.selectedNpcKeys = new Set([`npc:${id}`]);
      this.viewport3d?.setSelectedRuntimeNpcs(this.selectedNpcKeys);
      this.canvasDirty = true;
      this.markDirty();
    };
    const remove = (): void => {
      delete npcs[id];
      this.activeWorld.npcs = npcs;
      this.viewport3d?.removeMapNpc(id);
      this.entities = buildEntities(this.content);
      this.base = snapshot(this.entities);
      this.selectedKey = null;
      this.clearNpcSelection();
      this.canvasDirty = true;
      this.markDirty();
    };
    insert();
    this.npcPlaceVisualKey = null;
    this.map.meta.updatedAt = now();
    this.pushUndo({ label: 'add-npc', undo: remove, redo: insert });
    this.inspector.refresh();
  }

  private selectedCampDef(): CampDef | null {
    return this.selectedCamp === null ? null : (this.camps()[this.selectedCamp] ?? null);
  }

  private campClick(w: Vec2): void {
    const camps = this.camps();
    // Click inside an existing camp's radius selects it (nearest wins); on
    // empty ground, resolveCampClick also refuses a new camp once the
    // document is already at MAX_CAMPS, mirroring terrainEdits/placements/
    // blockers so an author never silently loses camps past the shared
    // sanitizer's truncation point on the next save/load.
    const result = resolveCampClick(camps, w.x, w.z, this.campMobId, MAX_CAMPS);
    if (result.kind === 'select') {
      this.selectedCamp = result.index;
      this.campMobId = camps[result.index].mobId;
      this.inspector.refresh();
      this.canvasDirty = true;
      return;
    }
    if (result.kind === 'capped') {
      this.toasts.error(t('editor.status.campCapReached', { max: MAX_CAMPS }));
      return;
    }
    // New camps APPEND to content.camps (never reorder); spawns appear in playtest.
    const camp: CampDef = result.camp;
    camps.push(camp);
    this.selectedCamp = camps.length - 1;
    this.afterCampsChanged();
    this.pushUndo({
      label: 'add-camp',
      undo: () => {
        const i = this.camps().indexOf(camp);
        if (i >= 0) this.camps().splice(i, 1);
        this.selectedCamp = null;
        this.afterCampsChanged();
      },
      redo: () => {
        this.camps().push(camp);
        this.afterCampsChanged();
      },
    });
    this.inspector.refresh();
  }

  private updateSelectedCamp(change: {
    mobId?: string;
    count?: number;
    radius?: number;
    levelMin?: number | null;
    levelMax?: number | null;
    authorVfx?: AuthorVfx | null;
    aiNotes?: string;
    questNotes?: string;
  }): void {
    const camp = this.selectedCampDef();
    if (!camp) return;
    const capture = () => ({
      mobId: camp.mobId,
      count: camp.count,
      radius: camp.radius,
      levelMin: camp.levelMin,
      levelMax: camp.levelMax,
      authorVfx: camp.authorVfx ? { ...camp.authorVfx } : undefined,
      aiNotes: camp.aiNotes,
      questNotes: camp.questNotes,
    });
    const apply = (value: ReturnType<typeof capture>): void => {
      camp.mobId = value.mobId;
      camp.count = value.count;
      camp.radius = value.radius;
      for (const key of ['levelMin', 'levelMax', 'authorVfx', 'aiNotes', 'questNotes'] as const) {
        delete camp[key];
      }
      if (value.levelMin !== undefined) camp.levelMin = value.levelMin;
      if (value.levelMax !== undefined) camp.levelMax = value.levelMax;
      if (value.authorVfx) camp.authorVfx = { ...value.authorVfx };
      if (value.aiNotes) camp.aiNotes = value.aiNotes;
      if (value.questNotes) camp.questNotes = value.questNotes;
      this.campMobId = camp.mobId;
      this.afterCampsChanged();
    };
    const prev = capture();
    if (change.mobId !== undefined) {
      camp.mobId = change.mobId;
      this.campMobId = change.mobId;
    }
    if (change.count !== undefined) {
      camp.count = Math.max(1, Math.min(MAX_CAMP_COUNT, Math.round(change.count)));
    }
    if (change.radius !== undefined) {
      camp.radius = Math.max(1, Math.min(MAX_CAMP_RADIUS, change.radius));
    }
    if (change.levelMin !== undefined) {
      if (change.levelMin === null) delete camp.levelMin;
      else camp.levelMin = Math.max(1, Math.min(80, Math.round(change.levelMin)));
    }
    if (change.levelMax !== undefined) {
      if (change.levelMax === null) delete camp.levelMax;
      else camp.levelMax = Math.max(1, Math.min(80, Math.round(change.levelMax)));
    }
    if (
      camp.levelMin !== undefined &&
      camp.levelMax !== undefined &&
      camp.levelMin > camp.levelMax
    ) {
      [camp.levelMin, camp.levelMax] = [camp.levelMax, camp.levelMin];
    }
    if (change.authorVfx !== undefined) {
      if (change.authorVfx === null) delete camp.authorVfx;
      else camp.authorVfx = { ...change.authorVfx };
    }
    if (change.aiNotes !== undefined) {
      const note = change.aiNotes.slice(0, MAX_AUTHORING_NOTES_LENGTH);
      if (note) camp.aiNotes = note;
      else delete camp.aiNotes;
    }
    if (change.questNotes !== undefined) {
      const note = change.questNotes.slice(0, MAX_AUTHORING_NOTES_LENGTH);
      if (note) camp.questNotes = note;
      else delete camp.questNotes;
    }
    const next = capture();
    this.afterCampsChanged();
    this.pushUndo({
      label: 'edit-camp',
      undo: () => apply(prev),
      redo: () => apply(next),
    });
  }

  private deleteSelectedCamp(): void {
    const index = this.selectedCamp;
    if (index === null) return;
    const camp = this.camps()[index];
    if (!camp) return;
    this.camps().splice(index, 1);
    this.selectedCamp = null;
    this.afterCampsChanged();
    this.pushUndo({
      label: 'delete-camp',
      undo: () => {
        this.camps().splice(index, 0, camp);
        this.afterCampsChanged();
      },
      redo: () => {
        this.camps().splice(index, 1);
        this.selectedCamp = null;
        this.afterCampsChanged();
      },
    });
  }

  private afterCampsChanged(): void {
    this.map.meta.updatedAt = now();
    this.entities = buildEntities(this.content);
    this.base = snapshot(this.entities);
    this.activeWorld.camps = this.camps();
    this.viewport3d?.syncMapCamps();
    this.syncSelectedMobRouteOverlay();
    this.canvasDirty = true;
    this.markDirty();
  }

  private clearMobSelection(): void {
    // An open Select-mode move volley commits before the selection vanishes.
    this.commitMobMove();
    this.selectedMobIds.clear();
    this.selectedMobCamps.clear();
    this.mobDragStart = null;
    this.viewport3d?.setSelectedRuntimeMobs(this.selectedMobIds);
  }

  /** Show the committed patrol of whatever the Mob tool has picked, so an
   *  authored route is visible without re-entering the waypoint mode. Only ever
   *  touches the shared path overlay while the Mob tool is the active one. */
  private syncSelectedMobRouteOverlay(): void {
    if (this.mobRouteDraft) return; // the draft owns the preview while it lives
    if (this.tool !== 'entity') return;
    const route = this.routeTargets().defs[0]?.route;
    this.viewport3d?.setCityPathPreview(route ? route.points : null, MOB_ROUTE_PREVIEW_COLOR);
  }

  private clearNpcSelection(): void {
    // An open Select-mode move burst commits before the selection vanishes.
    this.commitNpcMove();
    this.objectMoves.select(null);
    this.selectedNpcKeys.clear();
    this.npcDragBase = null;
    this.viewport3d?.setSelectedRuntimeNpcs(this.selectedNpcKeys);
  }

  /** Rebuild authored NPC/mob entities after a structural paste or undo. */
  private refreshEntityWorld(): void {
    this.entities = buildEntities(this.content);
    this.base = snapshot(this.entities);
    this.rebuildActiveWorld();
    this.canvasDirty = true;
    this.markDirty();
    if (!this.viewport3d) return;
    this.show3dLoading();
    void this.viewport3d.reload(this.map).then(() => {
      this.hide3dLoading();
      this.syncFootprintOverlay();
      this.viewport3d?.setSelectedRuntimeNpcs(this.selectedNpcKeys);
    });
  }

  /** The one NPC the Select-mode rotate controls turn: exactly one selected
   *  map NPC and no selected placement (a placement keeps the controls). */
  private transformableNpcKey(): string | null {
    if (!isSelectionTool(this.tool) || this.selectedPlacement !== null) return null;
    if (this.selectedNpcKeys.size !== 1) return null;
    const [key] = this.selectedNpcKeys;
    return key.startsWith('npc:') && this.map.content.npcs[key.slice('npc:'.length)] ? key : null;
  }

  /** Live-facing slider for selected NPCs, committed as one undo entry. */
  private updateNpcFacing(key: string, facing: number, commit: boolean): void {
    if (!key.startsWith('npc:') || !Number.isFinite(facing)) return;
    const npcId = key.slice('npc:'.length);
    const npc = this.map.content.npcs[npcId];
    if (!npc) return;
    if (!this.npcFacingDragBase || this.npcFacingDragBase.key !== key) {
      this.npcFacingDragBase = { key, facing: npc.facing };
    }
    npc.facing = facing;
    this.viewport3d?.setMapNpcFacing(key, facing);
    this.canvasDirty = true;
    if (!commit) return;

    const previous = this.npcFacingDragBase.facing;
    this.npcFacingDragBase = null;
    if (previous === facing) return;
    const apply = (value: number): void => {
      npc.facing = value;
      this.viewport3d?.setMapNpcFacing(key, value);
      this.canvasDirty = true;
    };
    this.pushUndo({
      label: 'rotate-npc',
      undo: () => apply(previous),
      redo: () => apply(facing),
    });
    this.map.meta.updatedAt = now();
  }

  /** Edit the selected NPC's authoring profile without rebuilding the terrain renderer. */
  private updateSelectedNpc(change: {
    name?: string;
    title?: string;
    visualKey?: string | null;
    authorRole?: string;
    authorVfx?: AuthorVfx | null;
    aiNotes?: string;
    questNotes?: string;
  }): void {
    if (!this.selectedKey?.startsWith('npc:')) return;
    const npc = this.map.content.npcs[this.selectedKey.slice('npc:'.length)];
    if (!npc) return;
    const key = this.selectedKey;
    const capture = () => ({
      name: npc.name,
      title: npc.title,
      visualKey: npc.visualKey,
      authorRole: npc.authorRole,
      authorVfx: npc.authorVfx ? { ...npc.authorVfx } : undefined,
      aiNotes: npc.aiNotes,
      questNotes: npc.questNotes,
    });
    const apply = (value: ReturnType<typeof capture>): void => {
      npc.name = value.name;
      npc.title = value.title;
      for (const field of [
        'visualKey',
        'authorRole',
        'authorVfx',
        'aiNotes',
        'questNotes',
      ] as const) {
        delete npc[field];
      }
      if (value.visualKey) npc.visualKey = value.visualKey;
      if (value.authorRole) npc.authorRole = value.authorRole;
      if (value.authorVfx) npc.authorVfx = { ...value.authorVfx };
      if (value.aiNotes) npc.aiNotes = value.aiNotes;
      if (value.questNotes) npc.questNotes = value.questNotes;
      this.viewport3d?.setMapNpcPresentation(key, {
        name: npc.name,
        visualKey: npc.visualKey ?? null,
        authorVfx: npc.authorVfx ?? null,
      });
      this.entities = buildEntities(this.content);
      this.base = snapshot(this.entities);
      this.canvasDirty = true;
      this.map.meta.updatedAt = now();
    };
    const prev = capture();
    if (change.name !== undefined) npc.name = change.name.slice(0, 60);
    if (change.title !== undefined) npc.title = change.title.slice(0, 60);
    if (change.visualKey !== undefined) {
      if (change.visualKey && VISUALS[change.visualKey]) npc.visualKey = change.visualKey;
      else delete npc.visualKey;
    }
    if (change.authorRole !== undefined) {
      const role = change.authorRole.slice(0, 60);
      if (role) npc.authorRole = role;
      else delete npc.authorRole;
    }
    if (change.authorVfx !== undefined) {
      if (change.authorVfx) npc.authorVfx = { ...change.authorVfx };
      else delete npc.authorVfx;
    }
    if (change.aiNotes !== undefined) {
      const note = change.aiNotes.slice(0, MAX_AUTHORING_NOTES_LENGTH);
      if (note) npc.aiNotes = note;
      else delete npc.aiNotes;
    }
    if (change.questNotes !== undefined) {
      const note = change.questNotes.slice(0, MAX_AUTHORING_NOTES_LENGTH);
      if (note) npc.questNotes = note;
      else delete npc.questNotes;
    }
    const next = capture();
    apply(next);
    this.pushUndo({
      label: 'edit-npc',
      undo: () => apply(prev),
      redo: () => apply(next),
    });
  }

  /**
   * Turn the picked mob's group camp into compatible one-mob camps. This is
   * what makes an individual selection survive JSON export and a later import.
   */
  private individualCampForRuntimeMob(entityId: number): CampDef | null {
    const runtime = this.viewport3d?.runtimeMobCamp(entityId);
    if (!runtime) return null;
    const camps = this.camps();
    const original = camps[runtime.campIndex];
    if (!original) return null;
    if (original.count === 1) return original;

    const individuals = splitCampIntoIndividuals(
      original,
      runtime.members.map((member) => ({ x: member.x, z: member.z })),
    );
    if (individuals.length === 0) return null;
    const campByMobId = new Map(
      runtime.members
        .slice(0, individuals.length)
        .map((member, index) => [member.id, individuals[index]]),
    );
    const selected = campByMobId.get(entityId);
    if (!selected) return null;

    const insertionIndex = runtime.campIndex;
    camps.splice(insertionIndex, 1, ...individuals);
    this.selectedCamp = null;
    this.afterCampsChanged();
    const clearAndRefresh = (): void => {
      this.clearMobSelection();
      this.afterCampsChanged();
      this.inspector.refresh();
    };
    this.pushUndo({
      label: 'split-mob-camp',
      undo: () => {
        const first = this.camps().indexOf(individuals[0]);
        if (first >= 0) this.camps().splice(first, individuals.length, original);
        clearAndRefresh();
      },
      redo: () => {
        const index = this.camps().indexOf(original);
        this.camps().splice(
          index >= 0 ? index : insertionIndex,
          index >= 0 ? 1 : 0,
          ...individuals,
        );
        clearAndRefresh();
      },
    });
    return selected;
  }

  // ---- mob tool (per-mob authoring) -------------------------------------------------

  /**
   * The authored camps the Mob tool currently has picked. Clicking rendered
   * mobs selects one-mob camps (individualCampForRuntimeMob splits a group on
   * first touch); clicking a camp MARKER instead selects that whole camp.
   */
  private selectedMobCampDefs(): CampDef[] {
    if (this.selectedMobCamps.size > 0) return [...this.selectedMobCamps.values()];
    const key = this.selectedKey;
    if (!key?.startsWith('camp:')) return [];
    const index = Number.parseInt(key.slice('camp:'.length), 10);
    const camp = Number.isInteger(index) ? this.camps()[index] : undefined;
    return camp ? [camp] : [];
  }

  /** Every NPC the Mob tool has picked (Ctrl+click builds the group). */
  private selectedNpcDefs(): NpcDef[] {
    const keys =
      this.selectedNpcKeys.size > 0
        ? [...this.selectedNpcKeys]
        : this.selectedKey?.startsWith('npc:')
          ? [this.selectedKey]
          : [];
    const npcs = this.map.content.npcs as Record<string, NpcDef>;
    return keys
      .map((key) => npcs[key.slice('npc:'.length)])
      .filter((npc): npc is NpcDef => npc !== undefined);
  }

  /** Whatever the Mob tool has selected, as one routable set. Mobs win when
   *  both somehow hold a selection (a mob click always clears the NPC one). */
  private routeTargets(): { kind: 'camps'; defs: CampDef[] } | { kind: 'npcs'; defs: NpcDef[] } {
    const camps = this.selectedMobCampDefs();
    if (camps.length > 0) return { kind: 'camps', defs: camps };
    return { kind: 'npcs', defs: this.selectedNpcDefs() };
  }

  /** Fold the picked mobs into the single row the inspector edits. */
  private mobToolSelection(): MobToolSelection | null {
    const camps = this.selectedMobCampDefs();
    const first = camps[0];
    if (!first) return null;
    const sameAcross = (read: (camp: CampDef) => unknown): boolean => {
      const head = JSON.stringify(read(first) ?? null);
      return camps.every((camp) => JSON.stringify(read(camp) ?? null) === head);
    };
    const mods = first.statMods;
    const mod = (value: number | undefined): number =>
      Number.isFinite(value) ? (value as number) : 1;
    return {
      count: this.selectedMobCamps.size > 0 ? this.selectedMobCamps.size : first.count,
      mobId: sameAcross((camp) => camp.mobId) ? first.mobId : null,
      label: sameAcross((camp) => camp.mobId)
        ? tEntity({ kind: 'mob', id: first.mobId, field: 'name' })
        : t('editor.mobTool.mixedType'),
      levelMin: first.levelMin ?? null,
      levelMax: first.levelMax ?? null,
      statMods: {
        health: mod(mods?.health),
        damage: mod(mods?.damage),
        armor: mod(mods?.armor),
        moveSpeed: mod(mods?.moveSpeed),
        attackSpeed: mod(mods?.attackSpeed),
        scale: mod(mods?.scale),
      },
      respawnSeconds: first.respawnSeconds ?? null,
      route: first.route
        ? {
            points: first.route.points.length,
            mode: first.route.mode,
            speed: first.route.speed ?? DEFAULT_ROUTE_SPEED,
          }
        : null,
      authorVfx: first.authorVfx ? { ...first.authorVfx } : null,
      aiNotes: first.aiNotes ?? '',
      questNotes: first.questNotes ?? '',
      mixed:
        camps.length > 1 &&
        !(
          sameAcross((camp) => camp.mobId) &&
          sameAcross((camp) => [camp.levelMin ?? null, camp.levelMax ?? null]) &&
          sameAcross((camp) => camp.statMods ?? null) &&
          sameAcross((camp) => camp.respawnSeconds ?? null) &&
          sameAcross((camp) => camp.route ?? null)
        ),
    };
  }

  /**
   * Write one Mob-tool edit through to EVERY picked mob, as a single undo step.
   * Camps are mutated in place (the map document holds the same objects the
   * viewport preview and export read), so undo/redo restores full snapshots.
   */
  private updateSelectedMobs(change: {
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
  }): void {
    this.applyToCamps(this.selectedMobCampDefs(), 'edit-mobs', (camp) => {
      if (change.mobId !== undefined) {
        camp.mobId = change.mobId;
        this.campMobId = change.mobId;
      }
      if (change.levelMin !== undefined) {
        if (change.levelMin === null) delete camp.levelMin;
        else camp.levelMin = clampNum(Math.round(change.levelMin), 1, MAX_AUTHORED_CAMP_LEVEL);
      }
      if (change.levelMax !== undefined) {
        if (change.levelMax === null) delete camp.levelMax;
        else camp.levelMax = clampNum(Math.round(change.levelMax), 1, MAX_AUTHORED_CAMP_LEVEL);
      }
      if (
        camp.levelMin !== undefined &&
        camp.levelMax !== undefined &&
        camp.levelMin > camp.levelMax
      ) {
        [camp.levelMin, camp.levelMax] = [camp.levelMax, camp.levelMin];
      }
      if (change.statMods) {
        const next: CampStatMods = { ...camp.statMods };
        for (const key of CAMP_STAT_MOD_KEYS) {
          const value = change.statMods[key];
          if (value === undefined) continue;
          next[key] = clampNum(value, MOB_STAT_MOD_MIN, MOB_STAT_MOD_MAX);
        }
        // An all-default stack is dropped rather than saved: a stock mob keeps
        // the exact document shape it had before the Mob tool existed.
        if (campStatModsAreStock(next)) delete camp.statMods;
        else camp.statMods = next;
      }
      if (change.respawnSeconds !== undefined) {
        if (change.respawnSeconds === null) delete camp.respawnSeconds;
        else {
          camp.respawnSeconds = clampNum(
            change.respawnSeconds,
            MIN_CAMP_RESPAWN_SECONDS,
            MAX_CAMP_RESPAWN_SECONDS,
          );
        }
      }
      if (change.clearRoute) delete camp.route;
      if (change.routeMode !== undefined && camp.route) camp.route.mode = change.routeMode;
      if (change.routeSpeed !== undefined && camp.route) {
        camp.route.speed = clampNum(change.routeSpeed, NPC_ROUTE_SPEED_MIN, NPC_ROUTE_SPEED_MAX);
      }
      if (change.authorVfx !== undefined) {
        if (change.authorVfx === null) delete camp.authorVfx;
        else camp.authorVfx = { ...change.authorVfx };
      }
      if (change.aiNotes !== undefined) {
        const note = change.aiNotes.slice(0, MAX_AUTHORING_NOTES_LENGTH);
        if (note) camp.aiNotes = note;
        else delete camp.aiNotes;
      }
      if (change.questNotes !== undefined) {
        const note = change.questNotes.slice(0, MAX_AUTHORING_NOTES_LENGTH);
        if (note) camp.questNotes = note;
        else delete camp.questNotes;
      }
    });
  }

  /** Patrol edits for the NPC arm of the Mob tool (mobs go through
   *  updateSelectedMobs; an NPC has no level band or stat multipliers). */
  private updateSelectedNpcRoute(change: {
    routeMode?: 'loop' | 'pingpong';
    routeSpeed?: number;
    clearRoute?: true;
  }): void {
    this.applyToNpcs(this.selectedNpcDefs(), 'edit-npc-route', (npc) => {
      if (change.clearRoute) delete npc.route;
      if (change.routeMode !== undefined && npc.route) npc.route.mode = change.routeMode;
      if (change.routeSpeed !== undefined && npc.route) {
        npc.route.speed = clampNum(change.routeSpeed, NPC_ROUTE_SPEED_MIN, NPC_ROUTE_SPEED_MAX);
      }
    });
  }

  /** Remove every picked mob (its one-mob camp) from the map. */
  private deleteSelectedMobs(): void {
    const camps = this.selectedMobCampDefs();
    if (camps.length === 0) return;
    // Record index + def so undo restores the camps at their original
    // positions; CAMPS order is a spawn-determinism contract.
    const removed = camps
      .map((camp) => ({ camp, index: this.camps().indexOf(camp) }))
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => a.index - b.index);
    if (removed.length === 0) return;
    const remove = (): void => {
      for (const entry of [...removed].reverse()) this.camps().splice(entry.index, 1);
      this.selectedCamp = null;
      this.selectedKey = null;
      this.cancelMobRoute();
      this.clearMobSelection();
      this.afterCampsChanged();
      this.inspector.refresh();
    };
    const restore = (): void => {
      for (const entry of removed) this.camps().splice(entry.index, 0, entry.camp);
      this.afterCampsChanged();
      this.inspector.refresh();
    };
    remove();
    this.toasts.success(t('editor.mobTool.deleted', { count: removed.length }));
    this.pushUndo({ label: 'delete-mobs', undo: restore, redo: remove });
  }

  /** Open the click-to-place waypoint mode, seeded from any existing patrol. */
  private beginMobRoute(): void {
    const target = this.routeTargets();
    if (target.defs.length === 0) return;
    const existing = target.defs[0].route;
    this.mobRouteDraft = {
      points: existing ? existing.points.map((point) => ({ ...point })) : [],
      mode: existing?.mode ?? 'loop',
      speed: existing?.speed ?? DEFAULT_ROUTE_SPEED,
      wait: 0,
    };
    // Drop any armed drag from the selection click so the first waypoint press
    // cannot also translate the mobs.
    this.mobDragStart = null;
    this.markerDragStart = null;
    this.syncMobRoutePreview();
  }

  private setMobRouteDraft(change: {
    mode?: 'loop' | 'pingpong';
    speed?: number;
    wait?: number;
  }): void {
    const draft = this.mobRouteDraft;
    if (!draft) return;
    if (change.mode !== undefined) draft.mode = change.mode;
    if (change.speed !== undefined) {
      draft.speed = clampNum(change.speed, NPC_ROUTE_SPEED_MIN, NPC_ROUTE_SPEED_MAX);
    }
    if (change.wait !== undefined) draft.wait = clampNum(change.wait, 0, MAX_NPC_ROUTE_WAIT);
  }

  /** Append one waypoint under the cursor (the Mob tool's click while routing). */
  private mobRouteClick(w: Vec2, ev?: PointerEvent): void {
    const draft = this.mobRouteDraft;
    if (!draft) return;
    if (ev && ev.detail >= 2) {
      this.finishMobRoute();
      return;
    }
    if (draft.points.length >= MAX_NPC_ROUTE_POINTS) {
      this.toasts.info(t('editor.mobTool.patrolFull', { max: MAX_NPC_ROUTE_POINTS }));
      return;
    }
    const point: NpcRoutePoint = { x: w.x, z: w.z };
    if (draft.wait > 0) point.wait = draft.wait;
    draft.points.push(point);
    this.syncMobRoutePreview(w);
    this.inspector.refresh();
  }

  private undoMobRoutePoint(): void {
    const draft = this.mobRouteDraft;
    if (!draft || draft.points.length === 0) return;
    draft.points.pop();
    this.syncMobRoutePreview();
  }

  /** Commit the drafted waypoints onto every picked mob (or NPC). */
  private finishMobRoute(): void {
    const draft = this.mobRouteDraft;
    if (!draft) return;
    if (draft.points.length < 2) {
      this.toasts.info(t('editor.mobTool.patrolNeedPoints'));
      return;
    }
    const target = this.routeTargets();
    if (target.defs.length === 0) {
      this.cancelMobRoute();
      return;
    }
    const count = draft.points.length;
    // Each subject gets its OWN copy of the path: later per-subject edits must
    // not alias a shared route object through the saved document.
    const written = (): NpcRoute => ({
      points: draft.points.map((point) => ({ ...point })),
      mode: draft.mode,
      speed: draft.speed,
    });
    if (target.kind === 'camps') {
      this.applyToCamps(target.defs, 'mob-route', (camp) => {
        camp.route = written();
      });
    } else {
      this.applyToNpcs(target.defs, 'npc-route', (npc) => {
        npc.route = written();
      });
    }
    this.cancelMobRoute();
    this.toasts.success(t('editor.mobTool.patrolSaved', { count }));
    this.inspector.refresh();
  }

  /**
   * Mutate a set of camps under ONE undo entry. Camps are edited in place (the
   * map document holds the same objects the viewport preview and export read),
   * so undo/redo restores whole snapshots rather than diffing fields.
   */
  private applyToCamps(
    camps: readonly CampDef[],
    label: string,
    mutate: (camp: CampDef) => void,
  ): void {
    if (camps.length === 0) return;
    const capture = (): CampDef[] => camps.map((camp) => JSON.parse(JSON.stringify(camp)));
    const restore = (values: readonly CampDef[]): void => {
      camps.forEach((camp, index) => {
        for (const key of Object.keys(camp)) {
          delete (camp as unknown as Record<string, unknown>)[key];
        }
        Object.assign(camp, JSON.parse(JSON.stringify(values[index])));
      });
      this.afterCampsChanged();
      this.inspector.refresh();
    };
    const prev = capture();
    for (const camp of camps) mutate(camp);
    const next = capture();
    this.afterCampsChanged();
    this.pushUndo({ label, undo: () => restore(prev), redo: () => restore(next) });
  }

  /** The NpcDef twin of applyToCamps. */
  private applyToNpcs(npcs: readonly NpcDef[], label: string, mutate: (npc: NpcDef) => void): void {
    if (npcs.length === 0) return;
    const capture = (): NpcDef[] => npcs.map((npc) => JSON.parse(JSON.stringify(npc)));
    const restore = (values: readonly NpcDef[]): void => {
      npcs.forEach((npc, index) => {
        for (const key of Object.keys(npc)) delete (npc as unknown as Record<string, unknown>)[key];
        Object.assign(npc, JSON.parse(JSON.stringify(values[index])));
      });
      this.refreshEntityWorld();
      this.inspector.refresh();
    };
    const prev = capture();
    for (const npc of npcs) mutate(npc);
    const next = capture();
    this.map.meta.updatedAt = now();
    this.refreshEntityWorld();
    this.pushUndo({ label, undo: () => restore(prev), redo: () => restore(next) });
  }

  /** Remove every picked NPC from the map. */
  private deleteSelectedNpcs(): void {
    const npcs = this.map.content.npcs as Record<string, NpcDef>;
    const selected = new Set(this.selectedNpcDefs());
    const removed = Object.entries(npcs).filter(([, npc]) => selected.has(npc));
    if (removed.length === 0) return;
    const remove = (): void => {
      for (const [id] of removed) delete npcs[id];
      this.selectedKey = null;
      this.cancelMobRoute();
      this.clearNpcSelection();
      this.refreshEntityWorld();
      this.inspector.refresh();
    };
    const restore = (): void => {
      for (const [id, npc] of removed) npcs[id] = npc;
      this.refreshEntityWorld();
      this.inspector.refresh();
    };
    remove();
    this.map.meta.updatedAt = now();
    this.toasts.success(t('editor.mobTool.deletedNpcs', { count: removed.length }));
    this.pushUndo({ label: 'delete-npcs', undo: restore, redo: remove });
  }

  private cancelMobRoute(): void {
    if (!this.mobRouteDraft) return;
    this.mobRouteDraft = null;
    this.viewport3d?.setCityPathPreview(null);
    this.canvasDirty = true;
  }

  /** Redraw the drafted path, rubber-banding the tail to the cursor. */
  private syncMobRoutePreview(cursor?: Vec2): void {
    const draft = this.mobRouteDraft;
    if (!draft) return;
    const points = cursor ? [...draft.points, cursor] : draft.points;
    this.viewport3d?.setCityPathPreview(points.length > 0 ? points : null, MOB_ROUTE_PREVIEW_COLOR);
    this.canvasDirty = true;
  }

  // ---- spawn -----------------------------------------------------------------------

  private finishSpawnArea(): void {
    const start = this.spawnAreaStart;
    const area = this.spawnAreaPreview;
    this.spawnAreaStart = null;
    if (!start || !area) return;
    const width = area.maxX - area.minX;
    const height = area.maxZ - area.minZ;
    if (width < 2 || height < 2) {
      this.spawnAreaPreview = null;
      this.viewport3d?.setZonePreview(null);
      this.setSpawn(start);
      return;
    }
    const prev = this.map.playerSpawnArea ? { ...this.map.playerSpawnArea } : null;
    const next = {
      minX: Math.round(area.minX * 10) / 10,
      minZ: Math.round(area.minZ * 10) / 10,
      maxX: Math.round(area.maxX * 10) / 10,
      maxZ: Math.round(area.maxZ * 10) / 10,
    };
    const apply = (value: typeof next | null): void => {
      if (value) this.map.playerSpawnArea = { ...value };
      else delete this.map.playerSpawnArea;
      if (value) this.activeWorld.playerSpawnArea = { ...value };
      else delete this.activeWorld.playerSpawnArea;
      this.spawnAreaPreview = value ? { ...value } : null;
      this.viewport3d?.setZonePreview(value);
      this.canvasDirty = true;
    };
    apply(next);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'set-spawn-area',
      undo: () => apply(prev),
      redo: () => apply(next),
    });
    this.markDirty();
    this.inspector.refresh();
  }

  private setSpawn(w: Vec2): void {
    const prev = this.map.playerStart ? { ...this.map.playerStart } : null;
    const prevArea = this.map.playerSpawnArea ? { ...this.map.playerSpawnArea } : null;
    const next = { x: Math.round(w.x * 10) / 10, z: Math.round(w.z * 10) / 10 };
    const apply = (
      v: { x: number; z: number } | null,
      area: CustomMap['playerSpawnArea'] | null,
    ): void => {
      if (v) this.map.playerStart = { ...v };
      else delete this.map.playerStart;
      if (area) this.map.playerSpawnArea = { ...area };
      else delete this.map.playerSpawnArea;
      this.activeWorld.playerStart = v ? { ...v } : { ...PLAYER_START };
      if (area) this.activeWorld.playerSpawnArea = { ...area };
      else delete this.activeWorld.playerSpawnArea;
      this.viewport3d?.setSpawnMarker(v);
      this.viewport3d?.setZonePreview(area ?? null);
      this.canvasDirty = true;
    };
    apply(next, null);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'set-spawn',
      undo: () => apply(prev, prevArea),
      redo: () => apply(next, null),
    });
    this.inspector.refresh();
  }

  private clearSpawn(): void {
    if (!this.map.playerStart && !this.map.playerSpawnArea) return;
    const prev = this.map.playerStart ? { ...this.map.playerStart } : null;
    const prevArea = this.map.playerSpawnArea ? { ...this.map.playerSpawnArea } : null;
    const apply = (
      v: { x: number; z: number } | null,
      area: CustomMap['playerSpawnArea'] | null,
    ): void => {
      if (v) this.map.playerStart = { ...v };
      else delete this.map.playerStart;
      if (area) this.map.playerSpawnArea = { ...area };
      else delete this.map.playerSpawnArea;
      this.activeWorld.playerStart = v ? { ...v } : { ...PLAYER_START };
      if (area) this.activeWorld.playerSpawnArea = { ...area };
      else delete this.activeWorld.playerSpawnArea;
      this.viewport3d?.setSpawnMarker(v);
      this.viewport3d?.setZonePreview(area ?? null);
      this.canvasDirty = true;
    };
    apply(null, null);
    this.pushUndo({
      label: 'clear-spawn',
      undo: () => apply(prev, prevArea),
      redo: () => apply(null, null),
    });
  }

  // ---- water ------------------------------------------------------------------------

  private previewWater(v: number): void {
    this.map.waterLevel = v === WATER_LEVEL ? undefined : v;
    this.syncWaterToActive();
    window.clearTimeout(this.waterTimer);
    this.waterTimer = window.setTimeout(() => this.viewport3d?.rebuildWater(), WATER_DEBOUNCE_MS);
  }

  private commitWater(v: number): void {
    const prev = this.waterBase;
    if (prev === v) return;
    this.waterBase = v;
    const apply = (level: number): void => {
      this.map.waterLevel = level === WATER_LEVEL ? undefined : level;
      this.syncWaterToActive();
      // The shoreline is BAKED INTO THE TERRAIN MESH (the beach band and the
      // snow line are per-vertex work in terrain_chunk_build), so re-seating
      // the surface alone moves the water and leaves the sand where the old
      // waterline was. Only the commit pays for the re-mesh; previewWater keeps
      // re-seating the cheap surface while the slider is moving.
      this.viewport3d?.rebuildTerrainFull();
    };
    apply(v);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'water-level',
      undo: () => {
        this.waterBase = prev;
        apply(prev);
      },
      redo: () => {
        this.waterBase = v;
        apply(v);
      },
    });
  }

  private applyWaterTint(hue: number | null, lum: number | null): void {
    if (hue === null) this.map.waterHue = undefined;
    else this.map.waterHue = Math.min(360, Math.max(0, hue));
    if (lum === null) this.map.waterLum = undefined;
    else this.map.waterLum = Math.min(1, Math.max(0, lum));
    if (this.map.waterHue !== undefined) this.activeWorld.waterHue = this.map.waterHue;
    else delete this.activeWorld.waterHue;
    if (this.map.waterLum !== undefined) this.activeWorld.waterLum = this.map.waterLum;
    else delete this.activeWorld.waterLum;
  }

  private previewWaterTint(hue: number | null, lum: number | null): void {
    this.applyWaterTint(hue, lum);
    window.clearTimeout(this.waterTimer);
    this.waterTimer = window.setTimeout(() => this.viewport3d?.rebuildWater(), WATER_DEBOUNCE_MS);
  }

  private commitWaterTint(hue: number | null, lum: number | null): void {
    const prevHue = this.map.waterHue ?? null;
    const prevLum = this.map.waterLum ?? null;
    if (prevHue === hue && prevLum === lum) return;
    const apply = (h: number | null, l: number | null): void => {
      this.applyWaterTint(h, l);
      this.viewport3d?.rebuildWater();
    };
    apply(hue, lum);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'water-tint',
      undo: () => apply(prevHue, prevLum),
      redo: () => apply(hue, lum),
    });
  }

  // ---- region clipboard ---------------------------------------------------------------

  private copyRegion(): void {
    if (!this.regionBox) {
      this.toasts.info(t('editor.region.needBox'));
      return;
    }
    const b = this.regionBox;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const inBox = (x: number, z: number): boolean =>
      x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
    const placements = this.map.placements
      .filter((p) => inBox(p.x, p.z))
      .map((p) => ({ ...p, x: p.x - cx, z: p.z - cz }));
    const edits = this.map.terrainEdits
      .filter((e) => inBox(e.x, e.z))
      .map((e) => ({ ...e, x: e.x - cx, z: e.z - cz }));
    this.clipboard = { placements, edits };
    this.toasts.success(
      t('editor.region.copied', {
        assets: placements.length,
        edits: edits.length,
      }),
    );
  }

  private pasteAt(world: Vec2): void {
    if (!this.clipboard) return;
    const pClamp = clampToCap(
      this.clipboard.placements,
      this.map.placements.length,
      MAX_PLACEMENTS,
    );
    const eClamp = clampToCap(
      this.clipboard.edits,
      this.map.terrainEdits.length,
      MAX_TERRAIN_EDITS,
    );
    if (pClamp.truncated) {
      this.toasts.error(t('editor.status.placementCapReached', { max: MAX_PLACEMENTS }));
    }
    if (eClamp.truncated) {
      this.toasts.error(t('editor.status.terrainCapReached', { max: MAX_TERRAIN_EDITS }));
    }
    const placements = pClamp.accepted.map((p) => ({
      ...p,
      x: p.x + world.x,
      z: p.z + world.z,
    }));
    const edits = eClamp.accepted.map((e) => ({
      ...e,
      x: e.x + world.x,
      z: e.z + world.z,
    }));
    if (placements.length === 0 && edits.length === 0) return;
    let region: RegionBox | null = null;
    for (const e of edits) region = unionRegion(region, stampRegion(e));
    const pStart = appendSpan(this.map.placements, placements);
    for (let i = 0; i < placements.length; i++) this.viewport3d?.placementAdded(pStart + i);
    const eStart = appendSpan(this.map.terrainEdits, edits);
    if (edits.length > 0) this.terrainEditsMutated();
    if (region) this.refreshTerrain(region);
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    this.pushUndo({
      label: 'paste-region',
      undo: () => {
        removeSpan(this.map.placements, pStart, placements);
        removeSpan(this.map.terrainEdits, eStart, edits);
        if (edits.length > 0) this.terrainEditsMutated();
        this.setSelectedPlacement(null);
        this.viewport3d?.rebuildPlacements();
        this.refreshTerrain(region);
      },
      redo: () => {
        this.map.placements.push(...placements);
        this.map.terrainEdits.push(...edits);
        if (edits.length > 0) this.terrainEditsMutated();
        this.viewport3d?.rebuildPlacements();
        this.refreshTerrain(region);
      },
    });
    this.toasts.success(t('editor.region.pasted', { count: placements.length + edits.length }));
  }

  private pasteBeside(): void {
    if (!this.clipboard || !this.regionBox) {
      this.toasts.info(t('editor.region.needClipboard'));
      return;
    }
    const b = this.regionBox;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    this.pasteAt({ x: cx + (b.maxX - b.minX) + 4, z: cz });
  }

  // ---- procgen ----------------------------------------------------------------------

  private worldBounds(): Bounds {
    const zones = this.map.content.zones;
    const minZ = Math.min(...zones.map((z) => z.zMin));
    const maxZ = Math.max(...zones.map((z) => z.zMax));
    const halfX = (this.map.worldHalfX ?? 180) - 4;
    return { minX: -halfX, maxX: halfX, minZ: minZ + 8, maxZ: maxZ - 8 };
  }

  /** The FULL paintable/textured world rect: it matches the terrain-mesh extent
   *  (render `renderBounds` / custom_map `mapBounds`: `worldHalfX ?? WORLD_MAX_X`,
   *  the whole zone z-span, NO inset), so the paint grid and auto-retexture reach
   *  every yard the terrain covers, not just the central ±180yd "starting area"
   *  strip that `worldBounds()` (kept narrower for scatter/hills) returns. This
   *  divergence was why textures could not be applied/rendered off the strip. */
  private paintBounds(): Bounds {
    const zones = this.map.content.zones;
    const minZ = Math.min(...zones.map((z) => z.zMin));
    const maxZ = Math.max(...zones.map((z) => z.zMax));
    const halfX = this.map.worldHalfX ?? WORLD_MAX_X;
    return { minX: -halfX, maxX: halfX, minZ, maxZ };
  }

  private avoidPredicate(): (x: number, z: number) => boolean {
    const seed = this.map.meta.seed;
    const zones = this.map.content.zones;
    const water = waterLevel();
    return (x: number, z: number): boolean => {
      if (terrainHeight(x, z, seed) < water + 1) return true;
      for (const zn of zones) {
        const dx = x - zn.hub.x;
        const dz = z - zn.hub.z;
        if (Math.sqrt(dx * dx + dz * dz) < zn.hub.radius + 6) return true;
      }
      return false;
    };
  }

  private runScatter(): void {
    const category =
      this.assets.selectedAssetId && isUserAssetId(this.assets.selectedAssetId)
        ? null
        : (assetById(this.assets.selectedAssetId ?? '')?.category ?? 'foliage');
    const pool = category
      ? ASSET_CATALOG.filter((a) => a.category === category).map((a) => a.id)
      : this.placeAssetId
        ? [this.placeAssetId]
        : [];
    if (pool.length === 0) {
      this.toasts.info(t('editor.procgen.noAssets'));
      return;
    }
    const seed = (this.map.meta.seed ^ (this.map.placements.length * 2654435761)) >>> 0;
    const placed = scatterPlacements({
      assetIds: pool,
      count: this.scatterCount,
      bounds: this.worldBounds(),
      seed,
      minScale: 0.7,
      maxScale: 1.6,
      avoid: this.avoidPredicate(),
    });
    if (placed.length === 0) {
      this.toasts.info(t('editor.procgen.noAssets'));
      return;
    }
    this.appendPlacements(placed, 'procgen-scatter');
    this.toasts.success(
      t('editor.procgen.scattered', {
        count: placed.length,
        category: category ?? '',
      }),
    );
  }

  private runHills(): void {
    const seed = (this.map.meta.seed ^ (this.map.terrainEdits.length * 40503)) >>> 0;
    const hills = scatterHills({
      count: Math.max(6, Math.round(this.scatterCount / 6)),
      bounds: this.worldBounds(),
      seed,
      minRadius: 14,
      maxRadius: 40,
      minHeight: 4,
      maxHeight: 16,
      avoid: this.avoidPredicate(),
    });
    if (hills.length === 0) return;
    const clamp = clampToCap(hills, this.map.terrainEdits.length, MAX_TERRAIN_EDITS);
    if (clamp.truncated) {
      this.toasts.error(t('editor.status.terrainCapReached', { max: MAX_TERRAIN_EDITS }));
    }
    const accepted = clamp.accepted;
    if (accepted.length === 0) return;
    let region: RegionBox | null = null;
    for (const h of accepted) region = unionRegion(region, stampRegion(h));
    const start = appendSpan(this.map.terrainEdits, accepted);
    this.terrainEditsMutated();
    this.refreshTerrain(region);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'procgen-hills',
      undo: () => {
        removeSpan(this.map.terrainEdits, start, accepted);
        this.terrainEditsMutated();
        this.refreshTerrain(region);
      },
      redo: () => {
        this.map.terrainEdits.push(...accepted);
        this.terrainEditsMutated();
        this.refreshTerrain(region);
      },
    });
    this.toasts.success(t('editor.procgen.hillsAdded', { count: accepted.length }));
  }

  // ---- undo plumbing ---------------------------------------------------------------

  private syncUndoUi(): void {
    this.topbar.setUndoDepth(this.undo.depth);
    this.topbar.setUndoState(this.undo.canUndo, this.undo.canRedo);
    this.buildTransformControls?.refresh();
    this.selectionQuickActions?.refresh();
    this.buildingWorkspace?.syncView();
  }

  private pushUndo(cmd: { label: string; undo(): void; redo(): void }): void {
    this.undo.push(cmd);
    this.markDirty();
    this.syncUndoUi();
  }

  private doUndo(): void {
    this.buildingWorkspace?.cancel();
    // An open transform burst commits first, so Ctrl+Z reverts THAT burst.
    this.flushTransformCommit();
    this.objectMoves.commitPending();
    this.roadEdit.endDrag();
    if (this.undo.undo()) {
      this.markDirty();
      this.inspector.refresh();
    }
    this.syncUndoUi();
  }

  private doRedo(): void {
    this.buildingWorkspace?.cancel();
    this.flushTransformCommit();
    this.objectMoves.commitPending();
    this.roadEdit.endDrag();
    if (this.undo.redo()) {
      this.markDirty();
      this.inspector.refresh();
    }
    this.syncUndoUi();
  }

  private markDirty(): void {
    if (liveWorldCottagesChanged(this.activeWorld, this.map)) {
      this.terrainEditsMutated();
      this.refreshTerrain(null);
    }
    this.dirty = true;
    this.editGen.bump();
    this.topbar.setDirty(true);
    this.canvasDirty = true;
  }

  // ---- save / open / import / export -----------------------------------------------

  /**
   * Save locally + to the server. `auto` = fired by the autosave tick: it must
   * stay silent on success (no toast per tick) and must NEVER open a dialog;
   * any failure (conflict included) turns autosave off with one explanatory
   * toast, so a broken save path cannot loop.
   */
  private async save(auto = false): Promise<void> {
    if (this.saving) return;
    // (The cave bake mirror used to run here. Bake caves is gone, it cost
    // load time and startup memory for a worse frame, so the document no
    // longer carries baked tiles and a save has nothing to mirror.)
    this.map.meta.updatedAt = now();
    // Snapshot the edit generation the payload covers: edits made while the
    // network call is in flight must keep the doc dirty and the draft alive.
    const generation = this.editGen.current;
    const okLocal = this.io.saveLocal(this.map);
    // A blocked local save warns but never blocks the server save.
    if (!okLocal) {
      if (auto) {
        this.autosaveErrored(t('editor.status.saveFailedLocal'));
        return;
      }
      this.toasts.error(t('editor.status.saveFailedLocal'));
    }
    if (!signedIn()) {
      if (okLocal) {
        this.finishSave(
          t('editor.status.savedLocalOnly', { name: this.map.meta.name }),
          null,
          generation,
          auto,
        );
      }
      return;
    }
    this.saving = true;
    this.topbar.setSaving(true);
    try {
      const link = await this.io.saveServer(this.map);
      this.finishSave(
        t('editor.status.savedServer', {
          name: this.map.meta.name,
          version: link.version,
        }),
        link.version,
        generation,
        auto,
      );
    } catch (err) {
      if (auto) {
        this.autosaveErrored(
          t(
            err instanceof EditorApiError
              ? editorErrorKey(err.code, err.status)
              : editorErrorKey(null),
          ),
        );
        this.topbar.setSaveState(t('editor.topbar.savedLocal'));
      } else if (err instanceof EditorApiError && err.code === 'version_conflict') {
        await this.resolveConflict(err.serverVersion ?? 0);
      } else {
        const key =
          err instanceof EditorApiError
            ? editorErrorKey(err.code, err.status)
            : editorErrorKey(null);
        this.toasts.error(t(key));
        this.topbar.setSaveState(t('editor.topbar.savedLocal'));
      }
    } finally {
      this.saving = false;
      this.topbar.setSaving(false);
    }
  }

  /** An automatic save failed: turn the feature off and say why, once. */
  private autosaveErrored(reason: string): void {
    this.setAutosave(false);
    this.toasts.error(t('editor.status.autosaveOff', { reason }));
  }

  private finishSave(
    message: string,
    serverVersion: number | null,
    generation: number,
    quiet = false,
  ): void {
    const fin = this.editGen.finalize(generation);
    if (fin.clearDirty) {
      this.dirty = false;
      this.topbar.setDirty(false);
    }
    this.topbar.setSaveState(
      serverVersion === null
        ? t('editor.topbar.savedLocal')
        : t('editor.topbar.savedServer', { version: serverVersion }),
    );
    this.topbar.setForkEnabled(this.io.linkFor(this.map.meta.id) !== null);
    // Only clear THIS map's draft, and only when no mid-save edits landed.
    if (fin.clearDraft) this.io.draftClear(this.map.meta.id);
    // Autosaves succeed silently: one toast per 30s tick would be noise.
    if (!quiet) this.toasts.success(message);
  }

  private async resolveConflict(serverVersion: number): Promise<void> {
    const copy = await confirmDialog(this.root, {
      title: t('editor.confirm.conflictTitle'),
      body: t('editor.confirm.conflictBody', { version: serverVersion }),
      confirmLabel: t('editor.confirm.conflictSaveCopy'),
    });
    if (!copy) {
      this.topbar.setSaveState(t('editor.topbar.savedLocal'));
      return;
    }
    // A copy is a new document identity: new meta.id, no server link yet.
    this.io.setLink(this.map.meta.id, null);
    this.map.meta.id = mintId();
    try {
      // Re-snapshot: the payload serialized below includes every edit made up
      // to this point (including any made while the conflict dialog was open).
      const generation = this.editGen.current;
      const link = await this.io.saveServerAsCopy(this.map);
      this.io.saveLocal(this.map);
      this.finishSave(
        t('editor.status.savedServer', {
          name: this.map.meta.name,
          version: link.version,
        }),
        link.version,
        generation,
      );
    } catch (err) {
      const key =
        err instanceof EditorApiError ? editorErrorKey(err.code, err.status) : editorErrorKey(null);
      this.toasts.error(t(key));
    }
  }

  private async saveAs(): Promise<void> {
    const name = await promptDialog(
      this.root,
      t('editor.prompt.saveAsTitle'),
      t('editor.prompt.nameLabel'),
      this.map.meta.name,
    );
    if (!name) return;
    this.map.meta.name = name;
    this.map.meta.id = mintId();
    this.map.meta.createdAt = now();
    this.topbar.setMapName(name);
    this.topbar.setForkEnabled(false);
    await this.save();
  }

  private async forkCurrent(): Promise<void> {
    const link = this.io.linkFor(this.map.meta.id);
    if (!link) return;
    try {
      const forked = await forkMap(link.serverId);
      this.toasts.success(t('editor.status.forked', { name: forked.name }));
      this.openServerMap(forked, true);
    } catch (err) {
      const key =
        err instanceof EditorApiError ? editorErrorKey(err.code, err.status) : editorErrorKey(null);
      this.toasts.error(t(key));
    }
  }

  /** True when it is safe to replace the working document (confirms if dirty). */
  private async confirmDiscard(): Promise<boolean> {
    if (!this.dirty) return true;
    return confirmDialog(this.root, {
      title: t('editor.confirm.discardTitle'),
      body: t('editor.confirm.discardBody', { name: this.map.meta.name }),
      confirmLabel: t('editor.confirm.discard'),
      danger: true,
    });
  }

  private async openServerMap(full: MapFullWire, mine: boolean): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    // Re-run the shared sanitizer over the wire document (defense in depth; the
    // server stores sanitizer output, but the editor never trusts a wire byte).
    const parsed = parseMap(full.doc);
    if (!parsed) {
      this.toasts.error(t('editor.serverError.invalid_map_doc'));
      return;
    }
    parsed.meta.name = full.name;
    this.loadMap(parsed);
    if (mine) {
      this.io.setLink(parsed.meta.id, {
        serverId: full.id,
        version: full.version,
      });
      this.topbar.setForkEnabled(true);
      this.topbar.setSaveState(t('editor.topbar.savedServer', { version: full.version }));
    } else {
      this.io.setLink(parsed.meta.id, null);
      this.topbar.setForkEnabled(false);
    }
    this.toasts.success(t('editor.status.opened', { name: full.name }));
  }

  private async newMap(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.loadMap(newCustomMap(t('editor.untitledMap'), mintId(), now()));
    this.toasts.info(t('editor.status.newMap'));
  }

  private async newFlatMap(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const size = await newMapSizeDialog(this.root);
    if (!size) return;
    this.loadMap(newFlatCustomMap(t('editor.flatMapName'), mintId(), now(), size));
    this.toasts.info(t('editor.status.newFlatMap'));
  }

  private async importFile(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const outcome = await pickMapOrBundle();
    // A dismissed file dialog is not a failure: stay silent rather than flash an
    // error the maker did not cause.
    if (outcome.status === 'cancelled') return;
    if (outcome.status === 'invalid') {
      this.toasts.error(t('editor.status.importFailed'));
      return;
    }
    const map = outcome.map;
    // loadMap now restores saved 'local/<sha>' models on every load path
    // (see ensureStoredLocalAssets); a bundle's freshly-restored bytes are in
    // the store by now, so they register here too. Ground textures + skybox
    // still need a nudge since the bundle may have added new ones.
    this.loadMap(map);
    refreshCustomGroundTextures();
    this.applySkybox();
    this.toasts.success(t('editor.status.imported', { name: map.meta.name }));
    // A plain map.json (or a .json downloaded on its own) carries no dependency
    // BYTES, so a map that uses imported models / custom ground textures / an
    // uploaded skybox re-imports as an empty-looking world in a fresh browser.
    // Detect that and tell the maker to use the .wocmap.zip instead, so the
    // silent "it didn't load my map" becomes an actionable message.
    void this.warnMissingImportDeps(map);
  }

  /**
   * After an import, count the map's dependencies whose BYTES are missing from
   * THIS browser: imported local models ('local/<sha>' placements), custom
   * ground-texture swatches, and an uploaded ('custom:<sha>') skybox. A bundle
   * (.wocmap.zip) restores these before load; a bare map.json cannot carry
   * them, so such a map re-imports as an empty-looking world with a misleading
   * success toast. When any are missing, surface an actionable warning pointing
   * at the .wocmap.zip. Best effort: a failed probe never affects the import.
   */
  private async warnMissingImportDeps(map: CustomMap): Promise<void> {
    try {
      let missing = 0;
      const localShas = new Set<string>();
      for (const p of map.placements) {
        if (isLocalAssetId(p.assetId)) localShas.add(p.assetId.slice('local/'.length));
      }
      if (localShas.size > 0) {
        const stored = new Set((await loadStoredLocalAssets()).map((a) => a.sha256));
        for (const sha of localShas) if (!stored.has(sha)) missing++;
      }
      for (const sha of bundleDependencyRefs(map).textures) {
        if (!(await loadGroundTextureBytes(sha))) missing++;
      }
      if (map.skybox?.startsWith('custom:')) {
        if (!(await loadSkyboxBytes(map.skybox.slice('custom:'.length)))) missing++;
      }
      if (missing > 0) {
        this.toasts.error(t('editor.status.importMissingDeps', { count: missing }));
      }
    } catch {
      // Blocked/absent storage: skip the probe rather than block the import.
    }
  }

  private exportFile(): void {
    void this.exportBundle();
  }

  /**
   * Bundle export: the map JSON plus every browser-stored dependency (imported
   * models, ground textures, uploaded skybox). Prefers a real folder via the
   * File System Access API (pick Documents and a "<name> map bundle" folder is
   * created inside); falls back to downloading one .wocmap.zip. Both carry the
   * zip, which Import reads back on any computer.
   */
  private async exportBundle(): Promise<void> {
    if (this.map.meta.overworldBase) {
      try {
        downloadMap(this.map);
        this.toasts.success(t('editor.status.exported', { name: this.map.meta.name }));
      } catch (error) {
        console.error('Live-world export rejected', error);
        this.toasts.error(t('editor.status.exportBlockedInvalid'));
      }
      return;
    }
    this.map.meta.updatedAt = now();
    const safe = this.map.meta.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'map';
    try {
      const files = await buildMapBundle(this.map);
      const zip = zipStore(files);
      const picker = (
        window as unknown as {
          showDirectoryPicker?: (opts?: { mode?: string }) => Promise<{
            getDirectoryHandle: (
              name: string,
              opts: { create: boolean },
            ) => Promise<{
              getFileHandle: (
                name: string,
                opts: { create: boolean },
              ) => Promise<{
                createWritable: () => Promise<{
                  write: (data: Uint8Array) => Promise<void>;
                  close: () => Promise<void>;
                }>;
              }>;
            }>;
          }>;
        }
      ).showDirectoryPicker;
      if (picker) {
        try {
          const root = await picker.call(window, { mode: 'readwrite' });
          const dir = await root.getDirectoryHandle(`${safe} map bundle`, {
            create: true,
          });
          const writeFile = async (name: string, data: Uint8Array): Promise<void> => {
            const fh = await dir.getFileHandle(name, { create: true });
            const w = await fh.createWritable();
            await w.write(data);
            await w.close();
          };
          for (const f of files) {
            // Skip the bare map.json: the .wocmap.zip below is the ONE
            // importable artifact, and a loose map.json sitting in the folder is
            // exactly what a maker picks by mistake, importing it drops every
            // model/texture/skybox (they live only in the zip). The remaining
            // entries (models_*/textures_*/skybox_*) are flattened for human
            // inspection, not for Import.
            if (f.path === 'map.json') continue;
            // Flatten subpaths into the folder ('models/x.glb' -> 'models_x.glb'
            // stays readable without nested handle plumbing).
            await writeFile(f.path.replace(/\//g, '_'), f.bytes);
          }
          await writeFile(`${safe}.wocmap.zip`, zip);
          this.toasts.success(t('editor.status.bundleExported', { name: this.map.meta.name }));
          return;
        } catch (err) {
          // Cancelled picker falls back to the zip download below.
          if ((err as Error)?.name === 'AbortError') return;
        }
      }
      const blob = new Blob([zip as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}.wocmap.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      this.toasts.success(t('editor.status.bundleExported', { name: this.map.meta.name }));
    } catch (error) {
      if (error instanceof BundleDependencyError) {
        this.toasts.error(t('editor.status.exportBlockedMissingDeps', { count: error.missing }));
        return;
      }
      if (error instanceof ExportCompatibilityError) {
        this.toasts.error(t('editor.status.exportBlockedInvalid'));
        return;
      }
      const refs = bundleDependencyRefs(this.map);
      const dependencyCount = refs.models.length + refs.textures.length + refs.skyboxes.length;
      if (dependencyCount > 0) {
        this.toasts.error(t('editor.status.exportBlockedMissingDeps', { count: dependencyCount }));
        return;
      }
      // Folder/zip assembly failed for a dependency-free map. The canonical
      // JSON still passes the same engine preflight through downloadMap().
      try {
        downloadMap(this.map);
        this.toasts.success(t('editor.status.exported', { name: this.map.meta.name }));
      } catch {
        this.toasts.error(t('editor.status.exportBlockedInvalid'));
      }
    }
  }

  /**
   * Link to World (More > Link to World): place an authored map inside the
   * base game world. The dialog drags the map's outline over the world map;
   * saving stores `worldAnchor` on the document, and playtest then embeds the
   * map's layers into the FULL built-in world at that offset
   * (custom_map.ts linkedWorldContent). Standard-world maps (presentationMode
   * undefined) ARE the world already, so they cannot link.
   */
  private async openWorldLink(): Promise<void> {
    if (this.map.presentationMode === undefined) {
      this.toasts.error(t('editor.worldLink.standaloneOnly'));
      return;
    }
    const outcome = await worldLinkDialog(this.root, this.map);
    if (outcome.action === 'save') {
      this.map.worldAnchor = outcome.anchor;
      this.markDirty();
      this.toasts.success(
        t('editor.worldLink.linked', { x: outcome.anchor.x, z: outcome.anchor.z }),
      );
    } else if (outcome.action === 'unlink') {
      delete this.map.worldAnchor;
      this.markDirty();
      this.toasts.info(t('editor.worldLink.unlinked'));
    }
  }

  /**
   * Generate Terrain (More > Generate Terrain): source an authored map's base
   * heightfield from a dragged region of the old world layout. Saving stores
   * `terrainBase` on the document (world.ts terrainHeight samples the shipped
   * baseHeight at that offset under the authored presentation), CLEARS the
   * sculpt edit layer (the blank map's flatten grid would level the sourced
   * terrain straight back to zero), and raises the blank map's default water
   * level to the shipped one so sourced lakes and coastlines read as water.
   * "Flatten Map" clears the source back to the flat slate.
   */
  private async openGenerateTerrain(): Promise<void> {
    if (this.map.presentationMode === undefined) {
      this.toasts.error(t('editor.worldLink.standaloneOnly'));
      return;
    }
    const outcome = await generateTerrainDialog(this.root, this.map);
    if (outcome.action === 'cancel') return;
    if (outcome.action === 'save') {
      this.map.terrainBase = outcome.anchor;
      // The flat-slate stamps (and any prior sculpting) would fight the
      // sourced heightfield: generation starts the sculpt layer clean.
      this.map.terrainEdits = [];
      // Blank maps sink the water to -40 so the slate starts dry; sourced
      // terrain wants the shipped sea level unless the maker already tuned it.
      if (this.map.waterLevel === BLANK_MAP_WATER_LEVEL) this.map.waterLevel = WATER_LEVEL;
      this.waterBase = this.map.waterLevel ?? WATER_LEVEL;
      this.toasts.success(
        t('editor.genTerrain.generated', { x: outcome.anchor.x, z: outcome.anchor.z }),
      );
    } else {
      delete this.map.terrainBase;
      this.toasts.info(t('editor.genTerrain.cleared'));
    }
    this.markDirty();
    this.undo.clear();
    this.syncUndoUi();
    this.rebuildActiveWorld();
    this.canvasDirty = true;
    if (this.viewport3d) {
      this.show3dLoading();
      void this.viewport3d.reload(this.map).then(() => {
        this.hide3dLoading();
        this.syncFootprintOverlay();
        // The heightfield under the camera just changed wholesale: re-frame
        // so the maker is looking AT the new terrain, not hovering inside it.
        this.frameAll();
      });
    }
  }

  /**
   * In-game settings dialog (More > Settings): graphics quality + sound, written
   * to the SHARED game settings store so a playtest boots with the same values.
   * Sound applies live to the audio/music singletons; the graphics preset is
   * read at engine boot, so it takes effect on the next playtest or editor
   * reload (offered inline). This is a focused editor surface, not the full
   * in-game options menu (which needs the running game HUD).
   */
  private openGameSettings(): void {
    const s = this.gameSettings;
    const modal = buildModal(this.root, t('editor.settings.title'), () => {});
    const panel = modal.panel;
    panel.appendChild(el('p', 'ed-modal-body', t('editor.settings.hint')));

    // ---- graphics quality preset (Low/Medium/High/Ultra) --------------------
    panel.appendChild(el('h3', 'ed-subtitle', t('editor.settings.graphicsTitle')));
    const presets: { value: number; labelKey: string }[] = [
      { value: 1, labelKey: 'editor.settings.graphicsLow' },
      { value: 2, labelKey: 'editor.settings.graphicsMedium' },
      { value: 3, labelKey: 'editor.settings.graphicsHigh' },
      { value: 4, labelKey: 'editor.settings.graphicsUltra' },
    ];
    const row = el('div', 'ed-row ed-wrap');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('editor.settings.graphicsTitle'));
    const currentPreset = () => Math.round(s.get('graphicsPreset'));
    for (const p of presets) {
      const b = button(
        t(p.labelKey as Parameters<typeof t>[0]),
        () => {
          s.set('graphicsPreset', p.value);
          for (const other of row.querySelectorAll('button')) other.classList.remove('active');
          b.classList.add('active');
        },
        'small',
      );
      b.setAttribute('role', 'radio');
      const active = currentPreset() === p.value;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', active ? 'true' : 'false');
      row.appendChild(b);
    }
    panel.appendChild(row);
    panel.appendChild(el('p', 'ed-hint', t('editor.settings.graphicsHint')));
    panel.appendChild(
      button(t('editor.settings.applyGraphics'), () => window.location.reload(), 'small'),
    );

    // ---- sound --------------------------------------------------------------
    panel.appendChild(el('h3', 'ed-subtitle', t('editor.settings.soundTitle')));
    const pct = (v: number): string => `${Math.round(v)}%`;
    panel.appendChild(
      slider(t('editor.settings.sfxVolume'), {
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(s.get('sfxVolume') * 100),
        onInput: (v) => {
          const vol = s.set('sfxVolume', v / 100);
          try {
            audio.setVolume(vol);
          } catch {
            // Audio context not up in this editor session: the value still persists.
          }
        },
        format: pct,
      }).root,
    );
    panel.appendChild(
      slider(t('editor.settings.musicVolume'), {
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(s.get('musicVolume') * 100),
        onInput: (v) => {
          const vol = s.set('musicVolume', v / 100);
          try {
            music.setVolume(vol);
          } catch {
            // Music not initialized in the editor: the value still persists.
          }
        },
        format: pct,
      }).root,
    );
    panel.appendChild(
      checkbox(t('editor.settings.music'), music.enabled, (on) => {
        try {
          music.setEnabled(on);
        } catch {
          // No-op if music is not running in this editor session.
        }
      }).root,
    );

    const actions = el('div', 'ed-modal-actions');
    actions.appendChild(button(t('editor.settings.close'), () => modal.close(), 'primary'));
    panel.appendChild(actions);
  }

  /**
   * Playtest ALWAYS launches the open document.
   *
   * It is tempting to have a live field mode (Ravenrift) supply the world while
   * it is active, since that field is what fills the viewport. Do not: the mode
   * survives with its panel hidden, so the override fires long after the maker
   * has moved on and silently launches a different map than the one they have
   * open. A field gets playtested from its OWN panel button
   * (BattlegroundEditorMode's "Playtest field"), where the maker asked for it.
   */
  private async playtest(): Promise<void> {
    // Playtest navigates away; fully save the document to the local JSON
    // store first and leave a resume marker, so the game's "Back to Editor"
    // button reopens this exact map with nothing lost.
    this.map.meta.updatedAt = now();
    const generation = this.editGen.current;
    if (this.io.saveLocal(this.map)) {
      clearPlaytestRecoveryDraft(this.map.meta.id);
      this.finishSave(
        t('editor.status.savedLocalOnly', { name: this.map.meta.name }),
        null,
        generation,
        true,
      );
    } else {
      // Blocked store: require a launch draft before leaving the editor, so the
      // browser Back button can recover this exact document even if playtest
      // navigation fails before the game boots.
      const draftSaved = this.io.draftSave(this.map);
      const recoverySaved = draftSaved || savePlaytestRecoveryDraft(this.map);
      if (!recoverySaved) {
        this.dirty = true;
        this.topbar.setDirty(true);
        this.toasts.error(t('editor.status.playtestFailed'));
        return;
      }
    }
    try {
      sessionStorage.setItem(PLAYTEST_RESUME_KEY, this.map.meta.id);
    } catch {
      /* blocked storage: the return trip lands on a blank editor as before */
    }
    const world = customMapToWorldContent(this.map);
    this.toasts.info(t('editor.status.playtestLaunch'));
    const ok = await launchPlaytest(world, {
      seed: this.map.meta.seed,
      playerClass: 'warrior',
      playerName: t('editor.playtestPlayerName'),
    });
    if (!ok) this.toasts.error(t('editor.status.playtestFailed'));
  }

  /**
   * Playtest the battleground field the maker is editing in the live mode, with
   * their unsaved layout on it. Reached from that mode's own panel, never from
   * the topbar: the topbar belongs to the open document.
   *
   * The field comes back through the ordinary shipped-map builder. v0.35's
   * battleground IS an authored map, so this launches Thornhollow as shipped ,
   * the mode's own live-layout swap no longer feeds it (see
   * enterBattlegroundMode).
   */
  private async playtestBattlegroundField(): Promise<void> {
    const field = await createShippedMap('thornhollow', `${this.map.meta.id}__thornhollow`, now());
    this.toasts.info(t('editor.status.playtestLaunch'));
    const ok = await launchPlaytest(customMapToWorldContent(field), {
      seed: field.meta.seed,
      playerClass: 'warrior',
      playerName: t('editor.playtestPlayerName'),
    });
    if (!ok) this.toasts.error(t('editor.status.playtestFailed'));
  }

  private async uploadAsset(): Promise<void> {
    if (!signedIn()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,model/gltf-binary';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.glb')) {
        this.toasts.error(t('editor.upload.notGlb'));
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        this.toasts.error(t('editor.upload.tooLarge'));
        return;
      }
      this.toasts.info(t('editor.upload.uploading'));
      try {
        const bytes = await file.arrayBuffer();
        const name = file.name.replace(/\.glb$/i, '');
        const { asset, existing } = await uploadAsset(bytes, name);
        registerUserAssets([
          {
            id: asset.id,
            sha256: asset.sha256,
            name: asset.name,
            byteSize: asset.byteSize,
          },
        ]);
        const assetId = userAssetIdFor(asset.sha256);
        // One-time collision bake from the just-uploaded bytes (the server
        // copy is identical): the boxes ride the map doc keyed by the user id.
        const bakeUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
        void bakeImportedModelCollision(bakeUrl)
          .then((boxes) => {
            if (!boxes || boxes.length === 0) return;
            if (!this.map.assetCollision) this.map.assetCollision = {};
            this.map.assetCollision[assetId] = boxes;
            this.viewport3d?.setAssetCollisionOverrides();
            this.markDirty();
          })
          .finally(() => URL.revokeObjectURL(bakeUrl));
        this.placeAssetId = assetId;
        this.placeAssetLabel = asset.name ?? asset.sha256.slice(0, 8);
        this.setTool('place');
        this.assets.showUploaded(assetId);
        this.toasts.success(
          existing
            ? t('editor.upload.uploadedExisting')
            : t('editor.upload.uploaded', { name: this.placeAssetLabel }),
        );
      } catch (err) {
        const key =
          err instanceof EditorApiError
            ? editorErrorKey(err.code, err.status)
            : editorErrorKey(null);
        this.toasts.error(t(key));
      }
    };
    input.click();
  }

  /**
   * Import a .glb/.gltf model straight from disk, fully offline: the file is
   * content-hashed into a 'local/<sha256>' id, served to the GLB loader via an
   * object URL, and placed like any catalog asset. Session-scoped (a reload
   * drops the blob); re-importing the same file rebinds saved placements
   * because the id is the content hash.
   */
  /** Paint panel: import an image; its average color becomes a custom swatch
   *  (full image splatting is not supported; the swatch label keeps the file
   *  name so the source is traceable). */
  private importTextureSwatch(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = async () => {
        try {
          const c = document.createElement('canvas');
          c.width = 24;
          c.height = 24;
          const ctx = c.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          ctx.drawImage(img, 0, 0, 24, 24);
          const data = ctx.getImageData(0, 0, 24, 24).data;
          let rSum = 0;
          let gSum = 0;
          let bSum = 0;
          const n = data.length / 4;
          for (let i = 0; i < data.length; i += 4) {
            rSum += data[i];
            gSum += data[i + 1];
            bSum += data[i + 2];
          }
          const color =
            (Math.round(rSum / n) << 16) | (Math.round(gSum / n) << 8) | Math.round(bSum / n);
          const label = file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, MAX_SWATCH_LABEL_LENGTH);
          // Persist the image (content-addressed) so painting tiles the REAL
          // texture; the average color stays as the no-texture fallback. The
          // stored bytes are the COMPRESSED encoding (downscale + WebP), so
          // the sha is computed on exactly what IndexedDB keeps.
          let sha: string | undefined;
          try {
            const stored = await compressGroundTextureImport(img, file);
            const digest = await crypto.subtle.digest('SHA-256', stored.bytes);
            sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
            await storeGroundTexture({
              sha256: sha,
              name: label,
              mime: stored.mime,
              bytes: stored.bytes,
            });
          } catch {
            sha = undefined; // insecure context: color-only swatch
          }
          this.addCustomSwatch(color, label, sha);
        } catch {
          this.toasts.error(t('editor.biome.importTextureFailed'));
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        this.toasts.error(t('editor.biome.importTextureFailed'));
      };
      img.src = url;
    };
    input.click();
  }

  private importModel(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf,model/gltf-binary,model/gltf+json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const lower = file.name.toLowerCase();
      const isGlb = lower.endsWith('.glb');
      if (!isGlb && !lower.endsWith('.gltf')) {
        this.toasts.error(t('editor.importModel.notModel'));
        return;
      }
      if (file.size > 64 * 1024 * 1024) {
        this.toasts.error(t('editor.importModel.tooLarge'));
        return;
      }
      try {
        const bytes = await file.arrayBuffer();
        let sha: string;
        try {
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        } catch {
          // Insecure context: fall back to a session-unique id (no rebinding).
          sha = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
        }
        const url = URL.createObjectURL(
          new Blob([bytes], {
            type: isGlb ? 'model/gltf-binary' : 'model/gltf+json',
          }),
        );
        const name = file.name.replace(/\.(glb|gltf)$/i, '');
        const assetId = registerLocalAsset({
          id: localAssetIdFor(sha),
          name,
          url,
          byteSize: file.size,
        });
        // Persist the bytes so the import survives reloads (restored at boot).
        void storeLocalAssetBytes({
          sha256: sha,
          name,
          mime: isGlb ? 'model/gltf-binary' : 'model/gltf+json',
          bytes,
          byteSize: file.size,
        });
        // One-time collision bake (type-aware): the boxes ride the map doc so
        // playtests and exports collide with the model's real silhouette.
        void bakeImportedModelCollision(url).then((boxes) => {
          if (!boxes || boxes.length === 0) return;
          if (!this.map.assetCollision) this.map.assetCollision = {};
          this.map.assetCollision[assetId] = boxes;
          this.viewport3d?.setAssetCollisionOverrides();
          this.markDirty();
        });
        this.placeAssetId = assetId;
        this.placeAssetLabel = name;
        this.setTool('place');
        this.assets.showImported(assetId);
        this.toasts.success(t('editor.importModel.imported', { name }));
      } catch {
        this.toasts.error(t('editor.importModel.failed'));
      }
    };
    input.click();
  }

  private setAutosave(on: boolean): void {
    this.autosaveOn = on;
    this.topbar.setAutosave(on);
    try {
      localStorage.setItem(AUTOSAVE_PREF_KEY, on ? '1' : '0');
    } catch {
      // Blocked storage: the toggle still works for this session.
    }
  }

  private setPresetPrompt(on: boolean): void {
    this.presetPromptOn = on;
    this.topbar.setPresetPrompt(on);
    writePref(CM_PRESET_PROMPT_PREF_KEY, on);
  }

  private autosave(): void {
    if (!this.dirty) return;
    const ok = this.io.draftSave(this.map);
    if (ok) {
      this.autosaveWarned = false;
    } else if (!this.autosaveWarned) {
      // Surface a silent autosave failure once per failure episode: the user
      // believes a draft backup exists when it does not.
      this.autosaveWarned = true;
      this.toasts.error(t('editor.status.autosaveFailed'));
    }
    // The opt-in FULL autosave rides the same tick, strictly gated: never over
    // an in-flight save and never mid-gesture (it would serialize a half-drawn
    // stroke's undo state).
    if (
      shouldAutosave({
        enabled: this.autosaveOn,
        dirty: this.dirty,
        saving: this.saving,
        editing: this.pointerEditActive || this.placementDragging,
      })
    ) {
      void this.save(true);
    }
  }

  /**
   * The 10-minute tick: a full LOCAL save of the current map's stored JSON,
   * always on (unlike the opt-in autosave toggle, and local-only so it can
   * never surprise the user with a server version bump). Same gesture/in-flight
   * gates as autosave; silent on success, silent on failure (the 30s draft
   * backup already warns when storage is broken).
   */
  private localBackupSave(): void {
    if (!this.dirty || this.saving || this.pointerEditActive || this.placementDragging) return;
    this.map.meta.updatedAt = now();
    const generation = this.editGen.current;
    if (this.io.saveLocal(this.map)) {
      this.finishSave(
        t('editor.status.savedLocalOnly', { name: this.map.meta.name }),
        null,
        generation,
        true,
      );
    }
  }

  // Replace the whole working document and rebuild the editor over its content.
  private loadMap(map: CustomMap, options: { preserveViewportTerrain?: boolean } = {}): boolean {
    this.objectMoves.select(null);
    // Collision Master may reuse the already-running world renderer. In that
    // case keep the globally active terrain content on the return map too;
    // the scratch placement is detached and never needs to replace it.
    const preserveViewportTerrain =
      options.preserveViewportTerrain === true && this.viewport3d?.ready === true;
    // Clear through the shared setter before swapping documents. Directly
    // changing selectedPlacement leaves Editor3DViewport.selectedIndex on the
    // old document during a full renderer reload, which can suppress or attach
    // the next transform gizmo to a stale slot.
    this.setSelectedPlacement(null);
    // Zone isolate is per map: a document swap always opens in Full Build
    // (finishBoot re-applies the saved isolate for the map it belongs to).
    // Quiet clear, the reload below rebuilds the whole view anyway.
    if (this.isolateZoneId !== null) {
      this.isolateZoneId = null;
      this.viewport3d?.clearZoneIsolateQuiet();
      this.topbar.setZoneIsolate(null);
    }
    // Same for the camera-chunk stream, and its poll MUST stop here: the timer
    // outlives the document, and a tick landing after the swap would move the
    // new map's residency rect to a chunk index measured against the old one.
    if (this.cameraZoneOn) {
      window.clearInterval(this.cameraZoneTimer);
      this.cameraZoneTimer = 0;
      this.cameraZoneOn = false;
      this.cameraZoneLocked = false;
      this.cameraZonePending = null;
      this.streamZoneIds = [];
      this.viewport3d?.clearZoneIsolateQuiet();
    }
    upgradeLoadedMap(map);
    this.map = map;
    this.flattenLock = null;
    this.slopeStart = null;
    this.slopeRamp = null;
    this.materialFinishBase = null;
    this.buildingWorkspace?.reset();
    // A region map (Open -> Shipped -> Ravenrift) can be written back to the
    // game; every other document cannot, so the action only exists for it.
    this.topbar.setRegionExport(import.meta.env.DEV && map.regionSource !== undefined);
    this.topbar.setPublishEnabled(import.meta.env.DEV && !this.map.meta.overworldBase);
    this.cityActiveWallId = null;
    this.cityWallRuntime.clear();
    this.cityWallUpdateRevision++;
    this.cityWallFinishing = false;
    // The open road gesture belonged to the previous document: drop it
    // before cityToolReset would commit it against this one.
    this.roadEdit.reset();
    this.cityToolReset();
    this.content = map.content;
    this.entities = buildEntities(map.content);
    this.base = snapshot(this.entities);
    this.undo.clear();
    this.dirty = false;
    this.selectedKey = null;
    this.clearMobSelection();
    this.clearNpcSelection();
    this.npcFacingDragBase = null;
    this.hoverKey = null;
    this.placementDragBase = null;
    this.transformCoalescer.cancel();
    window.clearTimeout(this.transformTimer);
    this.placementDragging = false;
    this.transformDragRef = null;
    this.markerDragStart = null;
    this.selectedCamp = null;
    this.regionBox = null;
    this.clipboard = null;
    this.selectionClipboard = null;
    this.blockerStart = null;
    this.blockerPreview = null;
    this.drawingBlocker2d = false;
    this.waterBase = map.waterLevel ?? WATER_LEVEL;
    // The map's authored lighting is the source of truth: adopt it (or clear
    // back to the shipped rig) so the Lighting tab, the viewport, and the next
    // playtest all agree with the document. skipDoc: this IS the doc's value.
    this.applyLighting(map.lighting ? 'custom' : 'day', map.lighting ? { ...map.lighting } : null, {
      skipDoc: true,
    });
    if (!preserveViewportTerrain) this.rebuildActiveWorld();
    this.applySkybox();
    this.topbar.setMapName(map.meta.name);
    showLiveWorldNotice(this.root, !!map.meta.overworldBase);
    this.topbar.setDirty(false);
    this.syncUndoUi();
    this.topbar.setForkEnabled(this.io.linkFor(map.meta.id) !== null);
    this.topbar.setSaveState(t('editor.topbar.neverSaved'));
    this.frameAll();
    this.canvasDirty = true;
    this.inspector.refresh();
    // The reload rebuilds the render view, which resets its footprint flag:
    // reapply the effective overlay once the fresh engine is up.
    if (this.viewport3d) {
      const reload = transitionEditorViewport(this.viewport3d, map, preserveViewportTerrain);
      if (reload === null) {
        this.finishViewportMapTransition();
      } else {
        this.show3dLoading();
        void reload.then(() => {
          this.hide3dLoading();
          this.finishViewportMapTransition();
        });
      }
    }
    // Make this map's saved extra assets (imported 'local/<sha>' models kept in
    // IndexedDB) resolve on EVERY load path: open-from-store, draft, server, and
    // import all funnel here. Bundle import restores its own bytes into the
    // store first (file_io.pickMapOrBundle), so this picks those up too. When it
    // registers anything new, re-instance the placements that were holes.
    void this.ensureStoredLocalAssets().then((added) => {
      if (added) {
        this.viewport3d?.rebuildPlacements();
        this.inspector.refresh();
      }
    });
    return preserveViewportTerrain;
  }

  /** Reapply viewport state shared by synchronous CM swaps and full reloads. */
  private finishViewportMapTransition(): void {
    this.buildingWorkspace?.syncView();
    // reload() and switchDocumentPreservingTerrain() have separate lifecycles;
    // the app's selection is authoritative once either one finishes.
    this.viewport3d?.setSelectedPlacement(this.selectedPlacement);
    this.syncMultiSelectionView();
    this.syncFootprintOverlay();
    if (this.pendingFocus) {
      const f = this.pendingFocus;
      this.pendingFocus = null;
      this.pendingCamera = null;
      this.viewport3d?.focusClose(f.x, f.z, f.extent, f.y);
    } else if (this.pendingCamera) {
      const c = this.pendingCamera;
      this.pendingCamera = null;
      const cam = this.viewport3d?.dungeonStagePort()?.cam;
      if (cam) {
        cam.target.set(c.x, c.y, c.z);
        cam.yaw = c.yaw;
        cam.pitch = c.pitch;
        cam.dist = c.dist;
      }
    }
  }

  // ---- keyboard -----------------------------------------------------------------------

  private onKeyDown = (ev: KeyboardEvent): void => {
    const target = ev.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      return;
    }
    if (
      !this.meshEditActive() &&
      (this.buildingWorkspace?.active ||
        this.tool === 'place' ||
        isSelectionTool(this.tool) ||
        (this.tool === 'city' && this.citySubtool === 'kit')) &&
      this.buildTransformControls?.handleKeydown(ev)
    )
      return;
    if (this.tool === 'building' && ev.key === 'Escape') {
      this.buildingWorkspace.cancel();
      ev.preventDefault();
      return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      // A mesh-edit session has its own edit history (Blender's edit-mode undo):
      // volume edits never leak into the map's undo stack.
      if (this.meshEditActive()) {
        if (ev.shiftKey) this.cmRedo();
        else this.cmUndo();
        return;
      }
      if (ev.shiftKey) this.doRedo();
      else this.doUndo();
      return;
    }
    if (mod && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      if (this.meshEditActive()) {
        this.cmRedo();
        return;
      }
      this.doRedo();
      return;
    }
    if (mod && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      void this.save();
      return;
    }
    if (mod && ev.key.toLowerCase() === 'c') {
      ev.preventDefault();
      // A mesh-edit session: Ctrl+C copies mesh VOLUMES (selected, else all) ,
      // never the base placement through the map clipboard.
      if (this.meshEditActive()) this.cmCopyVolumes();
      else this.copySelection();
      return;
    }
    if (mod && ev.key.toLowerCase() === 'v') {
      ev.preventDefault();
      if (this.meshEditActive()) this.cmPasteVolumes();
      else this.pasteSelection();
      return;
    }
    if (mod && ev.key.toLowerCase() === 'd') {
      ev.preventDefault();
      // A mesh-edit session: Ctrl+D clones the selected volume (like Shift+D),
      // never the base placement.
      if (this.meshEditActive()) this.duplicateCmSelection();
      else if (this.selectedPlacement !== null) this.duplicateSelectedPlacement();
      return;
    }
    if (mod) return;
    // Blender's Numpad 5 lens shortcut. It is intentionally global within the
    // 3D editor (including mesh-edit mode) and does not alter the map document.
    if (ev.code === 'Numpad5' && this.viewMode === '3d') {
      ev.preventDefault();
      this.setOrthographic(!this.orthographicOn);
      return;
    }
    // Collision Master hotkeys (Blender-style): Z/V/C pick the vertex/edge/
    // face select modes, Tab toggles object <-> edit, Shift+D duplicates the
    // volume, Delete removes it. These outrank the global tool keys while the
    // studio session is up.
    // Shift+D always means "duplicate the collider volume" here, even while
    // Free-Fly claims the WASDQE keys (capturesKey('d') would otherwise
    // swallow it and let the global Shift+D grab the workbench asset).
    if (
      this.meshEditActive() &&
      !ev.altKey &&
      ((ev.shiftKey && ev.key.toLowerCase() === 'd') ||
        !this.viewport3d?.capturesKey(ev.key.toLowerCase()))
    ) {
      const k = ev.key.toLowerCase();
      if (ev.key === 'Tab') {
        ev.preventDefault();
        this.setCmSubMode(this.cmSubMode === 'object' ? 'vertex' : 'object');
        return;
      }
      if (!ev.shiftKey && k === 'z') {
        this.setCmSubMode('vertex');
        return;
      }
      if (!ev.shiftKey && k === 'v') {
        this.setCmSubMode('edge');
        return;
      }
      if (!ev.shiftKey && k === 'c') {
        this.setCmSubMode('face');
        return;
      }
      if (ev.shiftKey && k === 'd') {
        ev.preventDefault();
        this.duplicateCmSelection();
        return;
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace' || (!ev.shiftKey && k === 'x')) {
        ev.preventDefault();
        this.deleteCmSelection();
        return;
      }
      if (ev.key === 'Escape') {
        // Blender-flavored: back out of the component selection, then the
        // volume, then stay put (the workbench placement must stay selected).
        if (this.cmSel.verts.length > 0) this.cmSel.verts = [];
        else if (this.cmSubMode !== 'object') this.setCmSubMode('object');
        else this.cmSel.volume = null;
        this.syncCmView();
        this.inspector.refresh();
        return;
      }
    }
    // A pending cut (Caves tool ghost, kept across the transform tools):
    // Enter locks it in, Escape discards it.
    if (this.pendingCut) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.commitPendingCut();
        return;
      }
      if (ev.key === 'Escape') {
        this.cancelPendingCut();
        return;
      }
    }
    // Mob tool patrol authoring: Enter commits the route, Delete/Backspace
    // drops the last waypoint, Escape abandons the draft.
    if (this.tool === 'entity' && this.mobRouteDraft) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.finishMobRoute();
        this.inspector.refresh();
        return;
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        this.undoMobRoutePoint();
        this.inspector.refresh();
        return;
      }
      if (ev.key === 'Escape') {
        this.cancelMobRoute();
        this.inspector.refresh();
        return;
      }
    }
    // City Build: Enter finishes the in-progress wall/road/route, Delete or
    // Backspace removes one node, Escape cancels, and R rotates the kit piece.
    if (this.tool === 'city') {
      // Roads Edit mode: Delete removes the selected waypoint, Escape lets go
      // of the selected road.
      if (this.citySubtool === 'road' && this.cityRoadMode === 'edit') {
        if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.roadEdit.selected) {
          // The held waypoint, else the whole road (undo brings it back).
          ev.preventDefault();
          if (this.roadEdit.selectedWaypoint !== null) this.cityDeleteRoadPoint();
          else if (this.roadEdit.removeSelected()) {
            this.toasts.info(t('editor.city.roadRemoved'));
          }
          this.inspector.refresh();
          return;
        }
        // Nothing to finish in Edit mode.
        if (ev.key === 'Enter') return;
        if (ev.key === 'Escape' && this.roadEdit.selected) {
          this.roadEdit.select(null);
          this.inspector.refresh();
          return;
        }
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.cityFinishActivePath();
        return;
      }
      const hasPathNode =
        (this.citySubtool === 'wall' && this.cityWallPoints.length > 0) ||
        (this.citySubtool === 'road' && this.cityRoadPoints.length > 0) ||
        (this.citySubtool === 'route' && this.cityRoutePoints.length > 0);
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && hasPathNode) {
        ev.preventDefault();
        this.cityUndoActivePathPoint();
        return;
      }
      if (
        ev.key === 'Escape' &&
        (this.cityWallPoints.length > 0 ||
          this.cityRoadPoints.length > 0 ||
          this.cityRouteNpcKey !== null ||
          this.cityArmedPrefab !== null ||
          this.cityTileLevel !== null)
      ) {
        this.cityArmedPrefab = null;
        this.cityTileLevel = null;
        this.cityCancelActivePath();
        return;
      }
      if (ev.key.toLowerCase() === 'r' && !this.viewport3d?.capturesKey('r')) {
        this.cityRotateKit();
        return;
      }
    }
    if (ev.key === 'Escape') {
      if (this.drawer.isOpen) {
        this.drawer.close();
        return;
      }
      // Hitbox edit mode: first Escape leaves the mode, keeping the selection.
      if (this.hitboxEdit) {
        this.exitHitboxEdit();
        return;
      }
      // A Shift+D grab in flight: drop the copies where they are.
      if (this.viewport3d?.grabFollowing) {
        this.viewport3d.cancelGrabFollow();
        this.endPlacementDrag();
        return;
      }
      if (
        this.selectedPlacement !== null ||
        this.selectedKey ||
        this.selectedCamp !== null ||
        this.selectedNpcKeys.size > 0 ||
        this.selectedMobIds.size > 0 ||
        this.selectedLight !== null ||
        this.selectedMusicArea !== null ||
        this.objectMoves.selectedKey !== null
      ) {
        this.setSelectedPlacement(null);
        this.selectedKey = null;
        this.clearNpcSelection();
        this.clearMobSelection();
        this.syncSelectedMobRouteOverlay();
        this.selectedCamp = null;
        if (this.selectedLight !== null) this.setSelectedLight(null);
        if (this.selectedMusicArea !== null) this.setSelectedMusicArea(null);
        this.inspector.refresh();
        this.canvasDirty = true;
        return;
      }
      if (this.tool !== 'select') this.setTool('select');
      return;
    }
    if (ev.key === 'Delete') {
      if (this.hitboxEdit && this.hitboxEdit.selected.size > 0) this.deleteSelectedHitboxes();
      // A selected built-in gameplay object (bed, dummy, node, door).
      else if (this.objectMoves.selectedKey !== null) this.objectMoves.deleteSelected();
      // Collision Master: the scene's one placement is the workbench, never a
      // delete target, Delete/X only ever remove collision boxes there.
      else if (this.selectedPlacement !== null && !this.meshEditActive()) {
        this.removeSelectedPlacements();
      } else if (this.selectedLight !== null) this.deleteMapLight(this.selectedLight);
      else if (this.selectedDecal !== null) this.deleteMapDecal(this.selectedDecal);
      else if (this.selectedMusicArea !== null) this.deleteMusicArea(this.selectedMusicArea);
      else if (this.selectedCamp !== null) this.deleteSelectedCamp();
      // The Mob tool's own picks (individual mobs first, then NPCs) delete with
      // the same key as everything else, not only from the panel button.
      else if (this.selectedMobCampDefs().length > 0) this.deleteSelectedMobs();
      else if (this.selectedNpcDefs().length > 0) this.deleteSelectedNpcs();
      return;
    }
    if (
      (ev.key === 'ArrowUp' ||
        ev.key === 'ArrowDown' ||
        ev.key === 'ArrowLeft' ||
        ev.key === 'ArrowRight') &&
      (this.selectedPlacement !== null ||
        this.selectedNpcDefs().length > 0 ||
        this.selectedMobCamps.size > 0 ||
        this.objectMoves.selectedKey !== null)
    ) {
      ev.preventDefault();
      this.nudgeSelected(ev.key, ev.shiftKey);
      return;
    }
    if (ev.key === '[' || ev.key === '{') {
      if (this.tool === 'pond') this.pondRadius = Math.max(POND_RADIUS_MIN, this.pondRadius - 0.5);
      else if (ev.shiftKey) this.brushStrength = Math.max(1, this.brushStrength - 1);
      // Proportional steps so the keys stay useful across the whole 0.4-300yd
      // range (matching the log brush slider).
      else this.brushRadius = Math.max(0.4, Math.round((this.brushRadius / 1.12) * 100) / 100);
      this.inspector.refresh();
      return;
    }
    if (ev.key === ']' || ev.key === '}') {
      if (this.tool === 'pond') this.pondRadius = Math.min(POND_RADIUS_MAX, this.pondRadius + 0.5);
      else if (ev.shiftKey) this.brushStrength = Math.min(50, this.brushStrength + 1);
      else this.brushRadius = Math.min(300, Math.round(this.brushRadius * 1.12 * 100) / 100);
      this.inspector.refresh();
      return;
    }
    // Shift+F toggles Free-Fly camera navigation (before the tool shortcuts,
    // which would otherwise read Shift+F as Flatten).
    if (ev.shiftKey && ev.key.toLowerCase() === 'f') {
      this.setFreeFly(!this.freeFlyOn);
      return;
    }
    // Shift+D: Blender duplicate + grab (the copies follow the cursor).
    if (ev.shiftKey && ev.key.toLowerCase() === 'd') {
      if (this.selectedPlacement !== null) {
        ev.preventDefault();
        this.duplicateAndGrab();
      }
      return;
    }
    // Period focuses the selection (Blender's numpad-period): the orbit pivot
    // snaps to it; with nothing selected, the whole map.
    if (ev.key === '.') {
      this.focusSelection();
      return;
    }
    // Single-key tool shortcuts; suppressed while the 3D viewport owns the key
    // (navigation drag, or Free-Fly's WASD/QE) and during a placement drag.
    if (this.viewport3d?.capturesKey(ev.key.toLowerCase()) || this.placementDragging) return;
    // X deletes the selection (Blender-style), same as the Delete key. The
    // region tool deliberately lost this shortcut: it is click-only now.
    if (ev.key.toLowerCase() === 'x' && !ev.altKey) {
      if (this.hitboxEdit && this.hitboxEdit.selected.size > 0) this.deleteSelectedHitboxes();
      else if (this.selectedPlacement !== null && !this.meshEditActive()) {
        this.removeSelectedPlacements();
      } else if (this.selectedLight !== null) this.deleteMapLight(this.selectedLight);
      else if (this.selectedMusicArea !== null) this.deleteMusicArea(this.selectedMusicArea);
      else if (this.selectedCamp !== null) this.deleteSelectedCamp();
      // The Mob tool's own picks (individual mobs first, then NPCs) delete with
      // the same key as everything else, not only from the panel button.
      else if (this.selectedMobCampDefs().length > 0) this.deleteSelectedMobs();
      else if (this.selectedNpcDefs().length > 0) this.deleteSelectedNpcs();
      return;
    }
    const tool = TOOL_BY_KEY.get(ev.key.toLowerCase());
    if (tool && !ev.altKey) this.setTool(tool);
  };

  // ---- camera preferences ---------------------------------------------------------

  private setFreeFly(on: boolean): void {
    this.freeFlyOn = on;
    this.viewport3d?.setFreeFly(on);
    writePref(FREE_FLY_PREF_KEY, on);
    this.inspector.refresh();
    this.topbar.syncCameraToggles();
  }

  private setInvertPan(on: boolean): void {
    this.invertPanOn = on;
    this.viewport3d?.setInvertPan(on);
    writePref(INVERT_PAN_PREF_KEY, on);
    this.topbar.syncCameraToggles();
  }

  private setShowPlayer(on: boolean): void {
    this.showPlayerOn = on;
    this.viewport3d?.setShowPlayer(on);
    writePref(SHOW_PLAYER_PREF_KEY, on);
    this.topbar.syncCameraToggles();
  }

  /**
   * Blender-style focus (period key / Camera panel button): put the orbit
   * pivot on the selection so the camera revolves around it; with nothing
   * selected, frame the whole map.
   */
  private setShowBoundaryWalls(on: boolean): void {
    this.showBoundaryOn = on;
    this.viewport3d?.setShowBoundaryWalls(on);
    writePref(SHOW_BOUNDARY_PREF_KEY, on);
    this.topbar.syncCameraToggles();
  }

  private setWireframeMode(on: boolean): void {
    this.wireframeOn = on;
    this.viewport3d?.setWireframe(on);
    writePref(WIREFRAME_PREF_KEY, on);
    this.topbar.syncCameraToggles();
  }

  private setXrayMode(on: boolean): void {
    this.xrayOn = on;
    this.viewport3d?.setXray(on);
    writePref(XRAY_PREF_KEY, on);
    this.topbar.syncCameraToggles();
  }

  private focusSelection(): void {
    if (!this.viewport3d) return;
    const i = this.selectedPlacement;
    const p = i === null ? undefined : this.map.placements[i];
    if (p) {
      const volume = colliderKindFor(p.assetId)
        ? colliderVolumeFromPlacement({ ...p, collide: true })
        : null;
      const extent = volume
        ? Math.max(volume.sizeX, volume.sizeY, volume.sizeZ) / 2
        : Math.max(1.5, p.scale * 2);
      const baseY = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.map.meta.seed);
      this.viewport3d.focusOn(p.x, p.z, extent, baseY + (p.y ?? 0));
      return;
    }
    const b = this.worldBounds();
    const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
    this.viewport3d.focusOn((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, extent * 0.5);
  }

  // ---- lighting ---------------------------------------------------------------

  /** The profile the lighting controls edit (Day when no override is active). */
  private effectiveLighting(): EditorLightingProfile {
    return this.lighting ?? EDITOR_LIGHTING_DAY;
  }

  /** Push the birds preference to the renderer (null = the shipped default). */
  private applyBirds(): void {
    const b = this.birds;
    const isDefault = b.enabled && b.count === 14 && b.formation;
    this.viewport3d?.setBirds(isDefault ? null : { ...b });
  }

  /** Resolve the map's skybox token to a URL and push it to the renderer. */
  private applySkybox(): void {
    const v = this.map.skybox ?? null;
    void resolveSkyboxUrl(v).then((url) => {
      // Stale resolve: the map changed while IndexedDB loaded.
      if ((this.map.skybox ?? null) !== v) return;
      this.viewport3d?.setSkybox(url);
      if (v && !url) this.toasts.error(t('editor.lighting.skyboxMissing'));
    });
  }

  /** Upload an equirect sky image: content-hashed into IndexedDB, stored on
   *  the MAP (so playtest shows it in-game and the bundle export carries it). */
  private importSkybox(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 24 * 1024 * 1024) {
        this.toasts.error(t('editor.lighting.skyboxTooLarge'));
        return;
      }
      try {
        const bytes = await file.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const sha = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        await storeSkybox({
          sha256: sha,
          name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40),
          mime: file.type || 'image/jpeg',
          bytes,
        });
        this.map.skybox = `custom:${sha}`;
        this.markDirty();
        this.applySkybox();
        this.inspector.refresh();
        this.toasts.success(t('editor.lighting.skyboxImported'));
      } catch {
        this.toasts.error(t('editor.lighting.skyboxImportFailed'));
      }
    };
    input.click();
  }

  private applyLighting(
    preset: string,
    profile: EditorLightingProfile | null,
    opts?: { skipDoc?: boolean },
  ): void {
    this.lightingPreset = preset;
    this.lighting = profile;
    this.viewport3d?.setLighting(profile);
    // Lighting is PART OF THE MAP: it saves into the document (sanitized,
    // projected onto WorldContent) so playtest and the shipped map render the
    // authored rig, not just this editor session. skipDoc = a load path
    // applying the map's own value (no dirty, no rewrite).
    if (!opts?.skipDoc) {
      if (profile) this.map.lighting = { ...profile };
      else delete this.map.lighting;
      this.map.meta.updatedAt = now();
      this.markDirty();
      // The projected world must carry it too, or the next playtest launch
      // (which reuses the active world) would boot without the change.
      if (profile) this.activeWorld.lighting = { ...profile };
      else delete this.activeWorld.lighting;
    }
    try {
      localStorage.setItem(LIGHTING_PREF_KEY, JSON.stringify({ preset, profile }));
    } catch {
      // Blocked storage: the override still applies for this session.
    }
  }

  /** Preset click: Day restores the shipped rig (no override at all). */
  private setLightingPreset(key: string): void {
    if (key === 'day') {
      this.applyLighting('day', null);
      return;
    }
    const preset = EDITOR_LIGHTING_PRESETS.find((p) => p.key === key);
    if (preset) this.applyLighting(key, { ...preset.profile });
  }

  /** Any manual control change forks the current profile into Custom. */
  private updateLighting(change: Partial<EditorLightingProfile>): void {
    this.applyLighting('custom', { ...this.effectiveLighting(), ...change });
  }

  private selectedAtmosphereZone(): CustomMap['content']['zones'][number] | null {
    const zones = this.map.content.zones;
    if (zones.length === 0) return null;
    const selected = zones.find((zone) => zone.id === this.atmosphereZoneId) ?? zones[0];
    this.atmosphereZoneId = selected.id;
    return selected;
  }

  private zoneLightingPreset(profile: EditorLightingProfile): string {
    const close = (a: number, b: number): boolean => Math.abs(a - b) < 0.001;
    const matches = (candidate: EditorLightingProfile): boolean =>
      close(profile.sunIntensity, candidate.sunIntensity) &&
      profile.sunColor === candidate.sunColor &&
      close(profile.hemiIntensity, candidate.hemiIntensity) &&
      profile.skyColor === candidate.skyColor &&
      close(profile.envScale, candidate.envScale) &&
      close(profile.sunAzimuthDeg, candidate.sunAzimuthDeg) &&
      close(profile.sunElevationDeg, candidate.sunElevationDeg);
    if (matches(EDITOR_LIGHTING_DAY)) return 'day';
    return EDITOR_LIGHTING_PRESETS.find((preset) => matches(preset.profile))?.key ?? 'custom';
  }

  private mutateZoneAtmosphere(mutator: (entry: ZoneAtmosphere) => void): void {
    const zone = this.selectedAtmosphereZone();
    if (!zone) return;
    const table = this.map.zoneAtmosphere ?? {};
    const entry = { ...(table[zone.id] ?? {}) };
    mutator(entry);
    table[zone.id] = entry;
    this.map.zoneAtmosphere = table;
    this.activeWorld.zoneAtmosphere = table;
    this.viewport3d?.refreshZoneAtmosphere();
    this.map.meta.updatedAt = now();
    this.markDirty();
  }

  private setZoneLightingPreset(key: string): void {
    const profile =
      key === 'day'
        ? EDITOR_LIGHTING_DAY
        : EDITOR_LIGHTING_PRESETS.find((preset) => preset.key === key)?.profile;
    if (!profile) return;
    this.mutateZoneAtmosphere((entry) => {
      entry.lighting = { ...profile };
    });
  }

  private updateZoneLighting(change: Partial<EditorLightingProfile>): void {
    const zone = this.selectedAtmosphereZone();
    if (!zone) return;
    const current = this.map.zoneAtmosphere?.[zone.id]?.lighting ?? this.effectiveLighting();
    this.mutateZoneAtmosphere((entry) => {
      entry.lighting = { ...current, ...change };
    });
  }

  /** Any MapWeather record resolved with the panel's defaults. */
  private resolveWeatherRecord(w: MapWeather | undefined): ResolvedWeather {
    return {
      mode: w?.mode ?? 'auto',
      intensity: w?.intensity ?? 1,
      clouds: w?.clouds ? { ...w.clouds } : { coverage: 0, height: 60 },
      schedule: w?.schedule ? w.schedule.map((s) => ({ ...s })) : [],
      aurora: w?.aurora ?? 0,
    };
  }

  /** The map's weather resolved with defaults for the panel. */
  private resolvedWeather(): ResolvedWeather {
    return this.resolveWeatherRecord(this.map.weather);
  }

  /** The panel's weather narrowed back to a stored record: only non-default
   *  fields survive, so an untouched map (or zone) stays field-free. Returns
   *  undefined when nothing was authored. */
  private narrowWeather(w: ResolvedWeather): MapWeather | undefined {
    const out: MapWeather = {};
    if (w.mode !== 'auto') out.mode = w.mode;
    const intensity = Math.min(1, Math.max(0, w.intensity));
    if (intensity !== 1) out.intensity = intensity;
    if (w.clouds.coverage > 0.005) {
      out.clouds = {
        coverage: Math.min(1, Math.max(0, w.clouds.coverage)),
        height: Math.min(200, Math.max(0, w.clouds.height)),
      };
    }
    if (w.schedule.length > 0) {
      out.schedule = w.schedule.slice(0, MAX_WEATHER_SCHEDULE).map((s) => ({
        mode: s.mode,
        minutes: Math.min(120, Math.max(0.1, s.minutes)),
      }));
    }
    if (w.aurora > 0.005) out.aurora = Math.min(1, Math.max(0, w.aurora));
    return Object.keys(out).length > 0 ? out : undefined;
  }

  /** Store one zone's own weather (ZoneAtmosphere.weather) and refresh the
   *  viewport's zone cache so the change shows without leaving the zone. */
  private setZoneWeather(w: ResolvedWeather): void {
    const next = this.narrowWeather(w);
    this.mutateZoneAtmosphere((entry) => {
      if (next) entry.weather = next;
      else delete entry.weather;
    });
  }

  /** Store the panel's weather, keeping only non-default fields (a default
   *  map stays field-free), and push it live to the viewport. */
  private setMapWeather(w: ResolvedWeather): void {
    this.map.weather = this.narrowWeather(w);
    if (this.map.weather) this.activeWorld.weather = this.map.weather;
    else delete this.activeWorld.weather;
    this.viewport3d?.setWeather(this.map.weather ?? null);
    this.map.meta.updatedAt = now();
    this.markDirty();
  }

  // ---- inspector deps -------------------------------------------------------------------

  private inspectorDeps(): ConstructorParameters<typeof Inspector>[1] {
    return {
      getTool: () => this.tool,
      getViewMode: () => this.viewMode,
      buildingWorkspace: () =>
        this.buildingWorkspace?.active ? this.buildingWorkspace.panelDeps() : null,
      buildTransformControls: () => {
        if (
          !this.buildTransformControls ||
          this.meshEditActive() ||
          !(
            this.buildingWorkspace?.active ||
            this.tool === 'place' ||
            isSelectionTool(this.tool) ||
            (this.tool === 'city' && this.citySubtool === 'kit')
          )
        )
          return null;
        this.buildTransformControls.refresh();
        return this.buildTransformControls.root;
      },
      cityBuild: () => this.cityPanelDeps(),
      getBrushShape: () => (this.tool === 'paint' ? this.paintBrushShape : this.sculptBrushShape),
      setBrushShape: (shape) => {
        if (shape !== 'circle' && shape !== 'square') return;
        if (this.tool === 'paint') this.paintBrushShape = shape;
        else this.sculptBrushShape = shape;
        this.canvasDirty = true;
        if (this.cursorWorld) this.brushRing(this.cursorWorld);
        this.inspector.refresh();
      },
      getSlopeStart: () => this.slopeStart,
      clearSlopeStart: () => {
        this.slopeStart = null;
        this.slopeRamp = null;
        this.inspector.refresh();
      },
      getBrushRadius: () => this.brushRadius,
      setBrushRadius: (v) => {
        this.brushRadius = v;
        this.canvasDirty = true;
      },
      getBrushStrength: () => this.brushStrength,
      setBrushStrength: (v) => {
        this.brushStrength = v;
      },
      getTerrainEditStats: () => ({
        count: this.map.terrainEdits.length,
        max: MAX_TERRAIN_EDITS,
      }),
      getPaintBiome: () => this.paintBiome,
      getPaintHardness: () => this.paintHardness,
      setPaintHardness: (v) => {
        this.paintHardness = v;
      },
      getPaintAlpha: () => this.paintAlphaId,
      setPaintAlpha: (id) => {
        this.paintAlphaId = id;
      },
      importPaintAlpha: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const alpha = await importBrushAlpha(file);
            this.paintAlphaId = alpha.id;
            this.inspector.refresh();
          } catch {
            this.toasts.error(t('editor.biome.alphaImportFailed'));
          }
        };
        input.click();
      },
      getBucketArmed: () => this.bucketArmed,
      setBucketArmed: (on) => {
        this.bucketArmed = on;
      },
      getLocations: () => this.map.locations ?? [],
      renameLocation: (index, name) => {
        const loc = this.map.locations?.[index];
        if (!loc || !name.trim()) return;
        loc.name = name.trim().slice(0, MAX_LOCATION_NAME);
        this.authoredListsChanged();
      },
      deleteLocation: (index) => {
        this.map.locations?.splice(index, 1);
        this.authoredListsChanged();
      },
      getMapLights: () => this.map.lights ?? [],
      getSelectedLight: () => this.selectedLight,
      movedObjectPanel: () =>
        buildObjectMovePanel({
          selectedKey: () => this.objectMoves.selectedKey,
          moves: () => this.map.objectMoves,
          reset: () => this.objectMoves.resetSelected(),
          turn: (rotY, commit) => this.objectMoves.turnSelected(rotY, commit),
          resize: (scale, commit) => this.objectMoves.resizeSelected(scale, commit),
          remove: () => this.objectMoves.deleteSelected(),
        }),
      removedObjectsPanel: () =>
        buildRemovedObjectsPanel({
          moves: () => this.map.objectMoves,
          restore: (key) => this.objectMoves.restore(key),
        }),
      setSelectedLight: (index) => this.setSelectedLight(index),
      updateMapLight: (index, change) => {
        const l = this.map.lights?.[index];
        if (!l) return;
        Object.assign(l, change);
        this.authoredListsChanged();
      },
      deleteMapLight: (index) => this.deleteMapLight(index),
      getMapSounds: () => this.map.pointSounds ?? [],
      getSelectedSound: () => this.selectedSound,
      setSelectedSound: (index) => this.setSelectedSound(index),
      updateMapSound: (index, change) => {
        const sfxNode = this.map.pointSounds?.[index];
        if (!sfxNode) return;
        Object.assign(sfxNode, change);
        this.authoredListsChanged();
      },
      deleteMapSound: (index) => this.deleteMapSound(index),
      getMapDecals: () => this.map.decals ?? [],
      getSelectedDecal: () => this.selectedDecal,
      setSelectedDecal: (index) => this.setSelectedDecal(index),
      updateMapDecal: (index, change) => this.updateDecal(index, change),
      deleteMapDecal: (index) => this.deleteMapDecal(index),
      getDecalBrush: () => this.decalBrush,
      setDecalBrush: (change) => this.setDecalBrush(change),
      pickDecalArt: (tex) => this.pickDecalArt(tex),
      importDecalFile: (file) => void this.importDecal(file),
      getMarkers: () => this.map.markers ?? [],
      getMarkerMode: () => ({
        placing: this.markerPlaceMode,
        kind: this.markerKind,
      }),
      setMarkerMode: (change) => {
        if (change.placing !== undefined) this.markerPlaceMode = change.placing;
        if (change.kind !== undefined) this.markerKind = change.kind;
      },
      renameMarker: (index, name) => {
        const m = this.map.markers?.[index];
        if (!m || !name.trim()) return;
        m.name = name.trim().slice(0, MAX_LOCATION_NAME);
        this.authoredListsChanged();
      },
      deleteMarker: (index) => {
        this.map.markers?.splice(index, 1);
        this.authoredListsChanged();
      },
      setPaintBiome: (id) => {
        this.paintBiome = id;
      },
      getCustomSwatches: () => this.map.biomePaint?.custom ?? [],
      pickBuiltinTexture: (key) => this.pickBuiltinTexture(key),
      setPaintAdjust: (change) => this.setPaintAdjust(change),
      saveAdjustedSwatch: () => this.saveAdjustedSwatch(),
      clearBiomePaint: () => void this.confirmClearBiomePaint(),
      autoRetextureMap: () => this.autoRetextureMap(),
      getAutoTexture: () => ({ ...this.autoTexture }),
      setAutoTexture: (change) => {
        Object.assign(this.autoTexture, change);
      },
      getSculptLower: () => this.sculptLower,
      setSculptLower: (on) => {
        this.sculptLower = on;
      },
      getSculptGrab: () => this.sculptGrab,
      setSculptGrab: (on) => {
        this.sculptGrab = on;
      },
      getSculptHardness: () => this.sculptHardness,
      setSculptHardness: (value) => {
        this.sculptHardness = value;
      },
      getSculptAlpha: () => this.sculptAlphaId,
      setSculptAlpha: (id) => {
        this.sculptAlphaId = id;
      },
      getLevelStyle: () => this.levelStyle,
      setLevelStyle: (style) => {
        this.levelStyle = style;
      },
      getNoiseSize: () => this.noiseSize,
      setNoiseSize: (yards) => {
        this.noiseSize = Math.min(NOISE_SIZE_MAX, Math.max(NOISE_SIZE_MIN, yards));
      },
      getNoiseRough: () => this.noiseRough,
      setNoiseRough: (percent) => {
        this.noiseRough = Math.min(100, Math.max(0, percent));
      },
      getFlattenSmooth: () => this.flattenSmooth,
      setFlattenSmooth: (on) => {
        this.flattenSmooth = on;
      },
      getFlattenLock: () => this.flattenLock,
      setFlattenLock: (level) => {
        this.flattenLock = level;
      },
      getSnapToGround: () => this.snapToGroundOnMove,
      setSnapToGround: (on) => {
        this.snapToGroundOnMove = on;
      },
      setSelectionToGround: () => this.setSelectionToGround(),
      getMaterialSlots: () =>
        this.selectedPlacement === null
          ? null
          : (this.viewport3d?.placementMaterialSlots(this.selectedPlacement) ?? null),
      getMaterialFinishes: () =>
        this.selectedPlacement === null
          ? undefined
          : this.map.placements[this.selectedPlacement]?.materialFinishes,
      setMaterialFinish: (key, finish, commit) => this.setMaterialFinish(key, finish, commit),
      getFlattenHardEdge: () => this.flattenHardEdge,
      setFlattenHardEdge: (on) => {
        this.flattenHardEdge = on;
      },
      placeWaterfall: () => {
        this.placeAssetId = WATERFALL_ASSET_ID;
        this.placeAssetLabel = t('editor.water.waterfallLabel');
        this.setTool('place');
      },
      armPond: () => this.setTool('pond'),
      getPondRadius: () => this.pondRadius,
      setPondRadius: (value) => {
        this.pondRadius = Math.min(POND_RADIUS_MAX, Math.max(POND_RADIUS_MIN, value));
        this.canvasDirty = true;
        if (this.cursorWorld) this.brushRing(this.cursorWorld);
      },
      getPondDepth: () => this.pondDepth,
      setPondDepth: (value) => {
        this.pondDepth = Math.min(POND_DEPTH_MAX, Math.max(POND_DEPTH_MIN, value));
      },
      getWaterLevel: () => this.map.waterLevel ?? WATER_LEVEL,
      previewWaterLevel: (v) => this.previewWater(v),
      commitWaterLevel: (v) => this.commitWater(v),
      resetWaterLevel: () => this.commitWater(WATER_LEVEL),
      reapplyWater: () => {
        if (this.viewport3d?.reapplyWater()) this.toasts.info(t('editor.status.waterReapplied'));
      },
      getWaterTint: () => ({
        hue: this.map.waterHue ?? null,
        lum: this.map.waterLum ?? null,
      }),
      previewWaterTint: (hue, lum) => this.previewWaterTint(hue, lum),
      commitWaterTint: (hue, lum) => this.commitWaterTint(hue, lum),
      resetWaterTint: () => this.commitWaterTint(null, null),
      getFluidKind: () => this.fluidKind,
      setFluidKind: (kind) => {
        this.fluidKind = kind;
      },
      getRockParams: () => ({ ...this.rockParams }),
      setRockParams: (change) => {
        Object.assign(this.rockParams, change);
      },
      getTreeParams: () => this.getTreeParams(),
      treeStudioActive: () => this.treeStudioActive(),
      enterTreeStudio: () => this.enterTreeStudio(),
      exitTreeStudio: (keep) => this.exitTreeStudio(keep),
      setTreeParams: (change) => this.setTreeParams(change),
      applyTreePreset: (key) => this.applyTreePreset(key),
      bakeFoliage: () => void this.bakeFoliage(),
      setTreeVolumesShown: (on) => this.setTreeVolumesShown(on),
      updateSelectedTree: (change, commit) => this.updateSelectedTree(change, commit),
      rerollSelectedTree: () => this.rerollSelectedTree(),
      treeParamsFromSelection: () => this.treeParamsFromSelection(),
      getRockChainState: () => ({
        mode: this.rockChainMode,
        count: this.pendingRockRig()?.points.length ?? 0,
      }),
      setRockChainMode: (on) => {
        this.rockChainMode = on;
        // Leaving chain mode keeps any laid points: they are real placements
        // now (movable, undoable); Clear removes them explicitly.
      },
      generateRockChain: () => this.generateRockChain(),
      clearRockChain: () => {
        this.clearRockChain();
        this.inspector.refresh();
      },
      getTunnelMode: () => this.tunnelMode,
      setTunnelMode: (mode) => {
        if (mode !== this.tunnelMode) this.cancelPendingCut();
        this.tunnelMode = mode;
        this.refreshHoleGuides();
      },
      getPendingCut: () => {
        const cut = this.pendingCut;
        if (!cut) return null;
        return { ...cutSummary(cut, -1), depth: this.ghostDepth(cut), erase: this.pendingErase };
      },
      updatePendingCut: (change) => {
        this.updatePendingCut(change);
      },
      commitPendingCut: () => {
        this.commitPendingCut();
      },
      cancelPendingCut: () => {
        this.cancelPendingCut();
      },
      getCarveDepth: () => this.carveDepth,
      setCarveDepth: (v) => {
        this.carveDepth = Math.max(0, Math.min(120, v));
      },
      getCaveMeshCell: () => this.map.caveMeshCell ?? 1,
      remeshAllCaves: (cell) => this.remeshAllCaves(cell),
      getRemeshCell: () => this.remeshCell,
      setRemeshCell: (v) => {
        this.remeshCell = Math.max(DETAIL_CELL_MIN, Math.min(DETAIL_CELL_MAX, v));
      },
      getDetailRegions: () =>
        (this.map.detailRegions ?? []).map((r, i) => ({
          index: i,
          x: r.x,
          z: r.z,
          radius: r.radius,
          cell: r.cell,
        })),
      deleteDetailRegion: (index) => this.deleteDetailRegion(index),
      getCaves: () =>
        (this.map.caves ?? []).map((c, i) => ({
          index: i,
          nodes: c.nodes.length,
          width: c.width ?? 1,
          height: c.height ?? 1,
          variance: c.variance ?? 0,
          floorVariance: c.floorVariance ?? 0,
          stalactites: c.stalactites ?? 0,
          stalagmites: c.stalagmites ?? 0,
          spikeSize: c.spikeSize ?? 1,
          startOpen: c.startOpen !== false,
          endOpen: c.endOpen !== false,
          tex: c.tex ?? null,
          texTile: c.texTile ?? null,
          autoMouth: c.autoMouth === true,
          mouthBlend: c.mouthBlend ?? 0,
        })),
      getHoles: () =>
        (this.map.holes ?? [])
          .map((h, i) => ({
            ...cutSummary(h, i),
            depth: terrainHeight(h.x, h.z, this.map.meta.seed) - h.y,
          }))
          .filter((h) => h.shape !== 'voxel'),
      getHolePatches: () =>
        (this.map.holePatches ?? []).map(cutSummary).filter((h) => h.shape !== 'voxel'),
      getDigAlpha: () => ({ ...this.digAlpha }),
      setDigAlpha: (change) => {
        this.digAlpha = { ...this.digAlpha, ...change };
      },
      getDigCell: () => this.digCell,
      setDigCell: (v) => {
        this.digCell = Math.max(0.25, Math.min(2, v));
      },
      hasDugRock: () =>
        (this.map.holes ?? []).some((h) => h.shape === 'voxel') ||
        (this.map.holePatches ?? []).some((h) => h.shape === 'voxel'),
      clearDugRock: () => this.clearDugRock(),
      getCutBrush: () => ({ ...this.cutBrush }),
      setCutBrush: (change) => {
        this.cutBrush = { ...this.cutBrush, ...change };
      },
      getCavePairState: () => {
        const caves = this.map.caves ?? [];
        const pending = this.caveRigs().filter((r) => !caves.some((c) => c.id === r.id));
        return {
          // A rig still needs points while it has only its entrance.
          pendingExit: pending.some((r) => r.points.length === 1),
          readyToGenerate: pending.filter((r) => r.points.length >= 2).length,
        };
      },
      generateCaves: () => this.generatePendingCaves(),
      updateCave: (index, change, commit) => this.updateCave(index, change, commit),
      reverseCave: (index) => this.reverseCave(index),
      deleteCave: (index) => this.deleteCave(index),
      selectWholeCave: (index) => this.selectWholeCave(index),
      updateHole: (index, change, commit) => this.updateHole(index, change, commit),
      deleteHole: (index) => this.deleteHole(index),
      updateHolePatch: (index, change, commit) => this.updateHolePatch(index, change, commit),
      deleteHolePatch: (index) => this.deleteHolePatch(index),
      getPlaceScale: () => this.placeScale,
      setPlaceScale: (v) => {
        this.placeScale = v;
      },
      getPlaceCollide: () => this.placeCollide,
      setPlaceCollide: (on) => {
        this.placeCollide = on;
        // Authoring collision: surface the footprints so radii are visible.
        this.syncFootprintOverlay();
      },
      getPlaceRandomRot: () => this.placeRandomRot,
      setPlaceRandomRot: (on) => {
        this.placeRandomRot = on;
      },
      getPlaceAssetLabel: () => this.placeAssetLabel,
      mobOptions: () =>
        buildMobCatalogOptions(MOBS, (id) => tEntity({ kind: 'mob', id, field: 'name' })),
      getSelectedCamp: () => {
        const camp = this.selectedCampDef();
        return camp && this.selectedCamp !== null
          ? {
              index: this.selectedCamp,
              mobId: camp.mobId,
              count: camp.count,
              radius: camp.radius,
              levelMin: camp.levelMin ?? null,
              levelMax: camp.levelMax ?? null,
              authorVfx: camp.authorVfx ? { ...camp.authorVfx } : null,
              aiNotes: camp.aiNotes ?? '',
              questNotes: camp.questNotes ?? '',
            }
          : null;
      },
      updateCamp: (change) => this.updateSelectedCamp(change),
      deleteCamp: () => this.deleteSelectedCamp(),
      npcVisualOptions: () => buildCharacterVisualOptions(Object.keys(VISUALS)),
      getNpcPlacement: () => this.npcPlaceVisualKey,
      beginNpcPlacement: (visualKey) => {
        this.npcPlaceVisualKey = visualKey;
      },
      cancelNpcPlacement: () => {
        this.npcPlaceVisualKey = null;
      },
      getSelectedMovableEntity: () => {
        if (this.selectedMobIds.size > 0) {
          const count = this.selectedMobIds.size;
          return {
            kind: 'mobs' as const,
            key: `mobs:${[...this.selectedMobIds].join(',')}`,
            name:
              count === 1
                ? t('editor.entityTool.oneMob')
                : t('editor.entityTool.manyMobs', { count }),
            facing: null,
            title: '',
            visualKey: null,
            authorRole: '',
            authorVfx: null,
            aiNotes: '',
            questNotes: '',
            count,
            route: null,
          };
        }
        const entity = this.entities.find((candidate) => candidate.key === this.selectedKey);
        if (!entity || !isMovableEntity(entity)) return null;
        if (entity.kind !== 'npc') {
          return {
            kind: 'mobs' as const,
            key: entity.key,
            name: entity.label,
            facing: null,
            title: '',
            visualKey: null,
            authorRole: '',
            authorVfx: null,
            aiNotes: '',
            questNotes: '',
            count: 1,
            route: null,
          };
        }
        const npcId = entity.key.startsWith('npc:') ? entity.key.slice('npc:'.length) : null;
        const npc = npcId ? this.map.content.npcs[npcId] : null;
        return {
          kind: 'npc' as const,
          key: entity.key,
          name: entity.label,
          facing: npc?.facing ?? null,
          title: npc?.title ?? '',
          visualKey: npc?.visualKey ?? null,
          authorRole: npc?.authorRole ?? '',
          authorVfx: npc?.authorVfx ? { ...npc.authorVfx } : null,
          aiNotes: npc?.aiNotes ?? '',
          questNotes: npc?.questNotes ?? '',
          count: Math.max(1, this.selectedNpcDefs().length),
          route: npc?.route
            ? {
                points: npc.route.points.length,
                mode: npc.route.mode,
                speed: npc.route.speed ?? DEFAULT_ROUTE_SPEED,
              }
            : null,
        };
      },
      updateSelectedNpc: (change) => this.updateSelectedNpc(change),
      updateMovableEntityFacing: (key, facing, commit) => this.updateNpcFacing(key, facing, commit),
      getSelectedMobs: () => this.mobToolSelection(),
      updateSelectedMobs: (change) => this.updateSelectedMobs(change),
      deleteSelectedMobs: () => this.deleteSelectedMobs(),
      updateSelectedNpcRoute: (change) => this.updateSelectedNpcRoute(change),
      deleteSelectedNpcs: () => this.deleteSelectedNpcs(),
      getMobRouteDraft: () => {
        const draft = this.mobRouteDraft;
        return draft
          ? {
              points: draft.points.length,
              mode: draft.mode,
              speed: draft.speed,
              wait: draft.wait,
            }
          : null;
      },
      beginMobRoute: () => this.beginMobRoute(),
      setMobRouteDraft: (change) => this.setMobRouteDraft(change),
      undoMobRoutePoint: () => this.undoMobRoutePoint(),
      finishMobRoute: () => this.finishMobRoute(),
      cancelMobRoute: () => this.cancelMobRoute(),
      getSpawn: () => this.map.playerStart ?? null,
      getSpawnArea: () => this.map.playerSpawnArea ?? null,
      clearSpawn: () => this.clearSpawn(),
      copyRegion: () => this.copyRegion(),
      pasteBeside: () => this.pasteBeside(),
      getBlockerStats: () => ({
        count: this.map.blockers?.length ?? 0,
        max: MAX_BLOCKERS,
      }),
      getFoliage: () => ({ ...this.foliage }),
      setFoliage: (change) => {
        Object.assign(this.foliage, change);
      },
      hasAmbientFoliage: () => this.hasAmbientFoliage(),
      makeAmbientFoliageEditable: (mode: 'all' | 'batch' | 'zone') =>
        this.makeAmbientFoliageEditable(mode),
      hasClearedGrass: () => this.hasClearedGrass(),
      restoreAllGrass: () => this.restoreAllGrass(),
      getClutter: () => ({ ...this.clutter }),
      setClutter: (change) => {
        Object.assign(this.clutter, change);
      },
      clutterStampCount: () => this.map.clutter?.length ?? 0,
      clearAllClutter: () => this.clearAllClutter(),
      getMeshFixRestore: () => this.meshFixRestore,
      vertexModeOn: () => this.vertexModeOn(),
      setVertexMode: (on: boolean) => this.setVertexMode(on),
      vertexSelectionCount: () => this.vertexSelectionCount(),
      vertexEditCount: () => this.vertexEditCount(),
      resetSelectedVertices: () => this.resetSelectedVertices(),
      clearVertexSelection: () => this.clearVertexSelection(),
      clearAllVertexEdits: () => this.clearAllVertexEdits(),
      setMeshFixRestore: (on) => {
        this.meshFixRestore = on;
      },
      meshFixCount: () => this.map.terrainKnockouts?.length ?? 0,
      clearMeshFix: () => this.clearMeshFix(),
      getFoliageCustom: () => (this.foliageCustom ? { ...this.foliageCustom } : null),
      pickFoliageCustom: () => {
        // Reuse the currently-selected asset in the browser (same id the Place
        // tool consumes). Nothing selected: nudge the maker to pick one.
        const id = this.assets.selectedAssetId;
        if (!id) {
          this.toasts.info(t('editor.foliageTool.customNeedsPick'));
          this.assets.setVisible(true);
          return;
        }
        this.foliageCustom = { assetId: id, label: this.placementLabel(id) };
        this.inspector.refresh();
      },
      clearFoliageCustom: () => {
        this.foliageCustom = null;
        this.inspector.refresh();
      },
      importTextureSwatch: () => this.importTextureSwatch(),
      swatchTextureUrl: (sha) => groundTextureUrl(sha),
      setSwatchTileSize: (id, size) => this.setSwatchTileSize(id, size),
      setSwatchVariation: (id, v) => this.setSwatchVariation(id, v),
      setSwatchDepth: (id, v) => this.setSwatchDepth(id, v),
      getPaintEdge: () => this.getPaintEdge(),
      setPaintEdge: (change) => this.setPaintEdge(change),
      deleteCustomSwatch: (id) => this.deleteCustomSwatch(id),
      getTerrainStyle: () => ({
        slopeRock: this.map.terrainStyle?.slopeRock !== false,
        scree: this.map.terrainStyle?.scree !== false,
        snowCaps: this.map.terrainStyle?.snowCaps !== false,
        rimMountains: this.map.terrainStyle?.rimMountains !== false,
        shoreSand: this.map.terrainStyle?.shoreSand !== false,
      }),
      setTerrainStyle: (change) => this.setTerrainStyle(change),
      getColliderShape: () => this.colliderShape,
      setColliderShape: (kind) => {
        this.colliderShape = kind;
      },
      getSelection: (): PlacementSelection | null => {
        const i = this.selectedPlacement;
        const p = i === null ? undefined : this.map.placements[i];
        if (i === null || !p) return null;
        const kind = colliderKindFor(p.assetId);
        return {
          index: i,
          assetId: p.assetId,
          assetLabel: this.placementLabel(p.assetId),
          x: p.x,
          y: p.y ?? null,
          z: p.z,
          rotY: p.rotY,
          scale: p.scale,
          collide: p.collide,
          collideRadius: p.collideRadius ?? null,
          collideShape: p.collideShape ?? null,
          collisionMode: effectiveCollisionMode(p),
          hitboxCount:
            p.hitboxes?.length ??
            ASSET_COLLISION[p.assetId]?.length ??
            this.map.assetCollision?.[p.assetId]?.length ??
            0,
          hasHitboxEdits: (p.hitboxes?.length ?? 0) > 0,
          hasHitboxPreset: !!this.hitboxPresets[p.assetId],
          // Sway is per-ASSET and on by default. Ask the NATURAL kind, not the
          // effective one: the effective kind is null while sway is off, which
          // would hide the very checkbox needed to turn it back on.
          // The catalogue path is the same string the render layer keys off
          // (placementsToRenderAssets). Imported models resolve to a blob URL
          // there and never sway, so they correctly get no toggle either.
          swayKind: naturalSwayKindForAssetPath(`/models/${p.assetId}.glb`),
          swayEnabled: this.map.assetSway?.[p.assetId] !== false,
          sameAssetCount: this.map.placements.reduce(
            (n, q, qi) => (qi !== i && q.assetId === p.assetId ? n + 1 : n),
            0,
          ),
          meshBakeReady: !!this.map.assetCollisionMesh?.[p.assetId],
          meshBakePending: this.meshBakesInFlight.has(p.assetId),
          colliderKind: kind,
          tint: p.tint ?? null,
          opacity: p.opacity ?? null,
          glow: p.glow ?? null,
          glowStrength: p.glowStrength ?? null,
          fire: p.fire === true,
          fireEffects: p.fireEffects ?? [],
          sizeX: p.sizeX ?? null,
          sizeY: p.sizeY ?? null,
          sizeZ: p.sizeZ ?? null,
          fluidKind: fluidKindFor(p.assetId),
          hue: p.hue ?? null,
          lum: p.lum ?? null,
          fluidDps: p.fluidDps ?? null,
          fluidFx: p.fluidFx ?? null,
          rockSeed: p.rockSeed ?? null,
          rockNoise: p.rockNoise ?? null,
          rockDetail: p.rockDetail ?? null,
          rockSharp: p.rockSharp ?? null,
          rockTex: p.rockTex ?? null,
          rockHeight: p.rockHeight ?? null,
          rockDepth: p.rockDepth ?? null,
          rockJag: p.rockJag ?? null,
          rockTexId: p.rockTexId ?? null,
          rockTexTile: p.rockTexTile ?? null,
          tree: p.tree ?? null,
        };
      },
      updateSelection: (change, commit) => this.updateSelectedPlacement(change, commit),
      getSelectionHeights: () => [...this.selectedSet].map((i) => this.map.placements[i]?.y ?? 0),
      commitSelectionTransform: () => this.flushTransformCommit(),
      getSelectedFireEmitter: () => this.selectedFireEmitter,
      setSelectedFireEmitter: (index) => this.setSelectedFireEmitter(index),
      setAssetSway: (on) => this.setAssetSway(on),
      duplicateSelection: () => this.duplicateSelectedPlacement(),
      deleteSelection: () => this.removeSelectedPlacements(),
      getPrefabPieceCount: () => {
        const hit = this.prefabPiecesForSelection();
        return hit ? hit.def.pieces.length + (hit.def.shell ? 1 : 0) : 0;
      },
      explodeSelection: () => this.explodeSelectedPrefab(),
      getCombineCount: () => this.combineTargets().length,
      combineSelection: () => this.combineSelection(),
      getGroupCount: () => this.groupCount(),
      ungroupSelection: () => this.ungroupSelection(),
      getSelectionCount: () => this.selectedSet.size,
      getBakedCollisionCount: (assetId) =>
        ASSET_COLLISION[assetId]?.length ?? this.map.assetCollision?.[assetId]?.length ?? 0,
      getFreeFly: () => this.freeFlyOn,
      setFreeFly: (on) => this.setFreeFly(on),
      getInvertPan: () => this.invertPanOn,
      setInvertPan: (on) => this.setInvertPan(on),
      getShowPlayer: () => this.showPlayerOn,
      setShowPlayer: (on) => this.setShowPlayer(on),
      getShowBoundaryWalls: () => this.showBoundaryOn,
      setShowBoundaryWalls: (on) => this.setShowBoundaryWalls(on),
      getWireframe: () => this.wireframeOn,
      setWireframe: (on) => this.setWireframeMode(on),
      getXray: () => this.xrayOn,
      setXray: (on) => this.setXrayMode(on),
      // ---- Scene Collection (zone → group → placement tree) -------------------
      getSceneTree: () => {
        const rows = this.map.placements
          .map((p, index) => ({
            index,
            name: p.name?.trim() ? p.name : this.placementLabel(p.assetId),
            hidden: p.hidden === true,
            selected: this.selectedSet.has(index),
            x: p.x,
            z: p.z,
            // Group by the asset's pack (first path segment): 'dungeon',
            // 'medieval_village_v2', 'collider', 'cave', ...
            group: p.assetId.split('/')[0] ?? p.assetId,
          }))
          // Grass patches are procedural foliage-brush strokes, not authored
          // objects, keep them out of the Scene Collection so it stays readable.
          .filter((row) => this.map.placements[row.index].assetId !== GRASS_PATCH_ASSET_ID);
        const zones = this.map.content.zones;
        return buildSceneTree(rows, zones).map((zone) => {
          const def = zones.find((z) => z.id === zone.zoneId);
          return {
            ...zone,
            resident: def
              ? (this.viewport3d?.isZoneResident(def.hub.x, def.hub.z) ?? false)
              : false,
            isolated: this.isolateZoneId === zone.zoneId,
          };
        });
      },
      isolateZone: (zoneId) => this.setZoneIsolate(zoneId),
      getCameraZoneStream: () => ({
        on: this.cameraZoneOn,
        locked: this.cameraZoneLocked,
        zone:
          this.map.content.zones.find((q) => q.id === this.isolateZoneId)?.name ??
          this.isolateZoneId,
        count: this.streamZoneIds.length,
        guide: this.streamGuideOn,
      }),
      setStreamGuide: (on) => this.setStreamGuide(on),
      setCameraZoneStream: (on) => this.setCameraZoneStream(on),
      setCameraZoneLocked: (locked) => this.setCameraZoneLocked(locked),
      selectSceneObject: (index) => {
        if (!this.map.placements[index]) return;
        this.setSelectedPlacement(index);
        this.inspector.refresh();
      },
      pinSceneObject: (index) => {
        const p = this.map.placements[index];
        if (!p) return;
        this.setSelectedPlacement(index);
        if (this.viewport3d) {
          const volume = colliderKindFor(p.assetId)
            ? colliderVolumeFromPlacement({ ...p, collide: true })
            : null;
          const extent = volume
            ? Math.max(volume.sizeX, volume.sizeY, volume.sizeZ) / 2
            : Math.max(1.5, p.scale * 2);
          const targetY =
            (p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.map.meta.seed)) +
            (p.y ?? 0);
          this.viewport3d.focusClose(p.x, p.z, extent, targetY);
        }
        this.inspector.refresh();
      },
      renameSceneObject: (index, name) => {
        const p = this.map.placements[index];
        if (!p) return;
        const trimmed = name.trim();
        if (trimmed) p.name = trimmed.slice(0, MAX_PLACEMENT_NAME_LENGTH);
        else delete p.name;
        this.map.meta.updatedAt = now();
        this.markDirty();
        this.inspector.refresh();
      },
      toggleSceneObjectHidden: (index) => {
        const p = this.map.placements[index];
        if (!p) return;
        if (p.hidden) delete p.hidden;
        else p.hidden = true;
        // Re-feed the render (hideHidden nulls the slot) + repaint the 2D overlay.
        this.viewport3d?.rebuildPlacements();
        this.map.meta.updatedAt = now();
        this.markDirty();
        this.inspector.refresh();
      },
      getCollidersHidden: () => this.collidersHiddenOn,
      setCollidersHidden: (on) => {
        this.collidersHiddenOn = on;
        this.viewport3d?.setCollidersHidden(on);
        writePref(HIDE_COLLIDERS_PREF_KEY, on);
      },
      getLocationsHidden: () => this.locationsHiddenOn,
      setLocationsHidden: (on) => {
        this.locationsHiddenOn = on;
        this.viewport3d?.setLocationsHidden(on);
        writePref(HIDE_LOCATIONS_PREF_KEY, on);
      },
      getCameraSpeeds: () => ({ ...this.cameraSpeeds }),
      setCameraSpeeds: (change) => {
        Object.assign(this.cameraSpeeds, change);
        this.viewport3d?.setCameraSpeeds(this.cameraSpeeds);
        writeJsonPref(CAMERA_SPEEDS_PREF_KEY, this.cameraSpeeds);
      },
      getVisibilityProfile: () => ({ ...this.visibilityProfile }),
      setVisibilityProfile: (change) => {
        Object.assign(this.visibilityProfile, change);
        this.viewport3d?.setVisibilityProfile(this.visibilityProfile);
        writeJsonPref(VISIBILITY_PREF_KEY, this.visibilityProfile);
      },
      getPerfOverlay: () => ({ ...this.perfOverlay }),
      setPerfOverlay: (change) => {
        Object.assign(this.perfOverlay, change);
        this.viewport3d?.setPerfOverlay(this.perfOverlay);
        writeJsonPref(PERF_OVERLAY_PREF_KEY, this.perfOverlay);
      },
      focusSelection: () => this.focusSelection(),
      getWeather: () => this.resolvedWeather(),
      setWeather: (w) => this.setMapWeather(w),
      getSnowfallEnabled: () => this.snowfallOn,
      setSnowfallEnabled: (on) => {
        this.snowfallOn = on;
        this.viewport3d?.setSnowEnabled(on);
        writePref(SNOWFALL_PREF_KEY, on);
      },
      getMusic: () => ({
        zoneTrack: this.map.music?.zoneTrack ?? null,
        areas: this.map.music?.areas ?? [],
        areaTrack: this.musicAreaTrack,
      }),
      getSelectedMusicArea: () => this.selectedMusicArea,
      setSelectedMusicArea: (index) => this.setSelectedMusicArea(index),
      setZoneTrack: (track) => {
        if (!this.map.music) this.map.music = {};
        if (track) this.map.music.zoneTrack = track;
        else delete this.map.music.zoneTrack;
        this.musicChanged();
      },
      setAreaTrack: (track) => {
        this.musicAreaTrack = track;
      },
      updateMusicArea: (index, track) => {
        const a = this.map.music?.areas?.[index];
        if (!a) return;
        a.track = track;
        this.musicChanged();
      },
      deleteMusicArea: (index) => this.deleteMusicArea(index),
      getLighting: () => ({
        preset: this.lightingPreset,
        profile: this.effectiveLighting(),
      }),
      setLightingPreset: (key) => this.setLightingPreset(key),
      updateLighting: (change) => this.updateLighting(change),
      getZoneAtmosphere: () => {
        const selected = this.selectedAtmosphereZone();
        if (!selected) return null;
        const atmosphere = this.map.zoneAtmosphere?.[selected.id];
        const profile = atmosphere?.lighting ?? this.effectiveLighting();
        return {
          zones: this.map.content.zones.map((zone) => ({
            id: zone.id,
            label: zone.name || zone.id,
          })),
          selectedId: selected.id,
          preset: this.zoneLightingPreset(profile),
          profile,
          skybox:
            atmosphere && Object.hasOwn(atmosphere, 'skybox')
              ? (atmosphere.skybox ?? null)
              : (this.map.skybox ?? null),
          timeScale: atmosphere?.timeScale ?? this.map.timeScale ?? 1,
          weather: this.resolveWeatherRecord(atmosphere?.weather),
        };
      },
      selectAtmosphereZone: (id) => {
        const zone = this.map.content.zones.find((item) => item.id === id);
        if (!zone) return;
        this.atmosphereZoneId = zone.id;
        this.viewport3d?.focusOn(zone.hub.x, zone.hub.z, Math.max(8, zone.hub.radius));
        this.viewport3d?.refreshZoneAtmosphere();
      },
      setZoneLightingPreset: (key) => this.setZoneLightingPreset(key),
      updateZoneLighting: (change) => this.updateZoneLighting(change),
      setZoneSkybox: (value) =>
        this.mutateZoneAtmosphere((entry) => {
          entry.skybox = value;
        }),
      setZoneWeather: (w) => this.setZoneWeather(w),
      setZoneWorldSpeed: (value) =>
        this.mutateZoneAtmosphere((entry) => {
          entry.timeScale = Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, value));
        }),
      resetZoneAtmosphere: () => {
        const zone = this.selectedAtmosphereZone();
        if (!zone || !this.map.zoneAtmosphere?.[zone.id]) return;
        delete this.map.zoneAtmosphere[zone.id];
        if (Object.keys(this.map.zoneAtmosphere).length === 0) delete this.map.zoneAtmosphere;
        if (this.map.zoneAtmosphere) this.activeWorld.zoneAtmosphere = this.map.zoneAtmosphere;
        else delete this.activeWorld.zoneAtmosphere;
        this.viewport3d?.refreshZoneAtmosphere();
        this.map.meta.updatedAt = now();
        this.markDirty();
      },
      getBirds: () => ({ ...this.birds }),
      setBirds: (change) => {
        Object.assign(this.birds, change);
        this.applyBirds();
        writeJsonPref(BIRDS_PREF_KEY, this.birds);
      },
      getWorldSpeed: () => this.map.timeScale ?? 1,
      setWorldSpeed: (v) => this.setWorldSpeed(v),
      getAssetViewDistance: () => this.map.assetViewDistance ?? DEFAULT_ASSET_VIEW_DISTANCE,
      setAssetViewDistance: (v) => this.setAssetViewDistance(v),
      getSkybox: () => this.map.skybox ?? null,
      setSkybox: (v) => {
        if (v === null) delete this.map.skybox;
        else this.map.skybox = v;
        this.markDirty();
        this.applySkybox();
      },
      importSkybox: () => this.importSkybox(),
      getFootprints: () => this.footprintsOn,
      setFootprints: (on) => this.setHitboxOverlay(on),
      getSameAssetCount: () => this.sameAssetIndices().length,
      selectAllOfAsset: () => this.selectAllOfAsset(),
      // ---- collision hitbox editing + presets --------------------------------
      getHitboxEdit: () => {
        const he = this.hitboxEdit;
        if (!he) return null;
        const p = this.map.placements[he.index];
        return {
          count: p?.hitboxes?.length ?? 0,
          selectedCount: he.selected.size,
        };
      },
      enterHitboxEdit: () => this.enterHitboxEdit(),
      exitHitboxEdit: () => this.exitHitboxEdit(),
      addHitbox: () => this.addHitbox(),
      deleteSelectedHitboxes: () => this.deleteSelectedHitboxes(),
      resetHitboxes: () => this.resetHitboxes(),
      saveHitboxPreset: () => this.saveHitboxPreset(),
      clearHitboxPreset: () => this.clearHitboxPreset(),
      copyCollisionToSameAsset: () => void this.copyCollisionToSameAsset(),
      // ---- Collision Master ---------------------------------------------------
      getCollisionMaster: () => this.collisionMasterVm(),
      collisionMasterStarter: (kind) => this.collisionMasterStarter(kind),
      getCollisionMasterPoly: () => this.cmPolySnap,
      setCollisionMasterPoly: (on) => {
        this.cmPolySnap = on;
        this.cmPolyPoints = null;
      },
      collisionMasterCommit: () => void this.commitCollisionMaster(),
      collisionMasterCancel: () => this.exitCollisionMaster(),
      openCollisionMasterForSelection: () => {
        const index = this.selectedPlacement;
        const p = index === null ? undefined : this.map.placements[index];
        if (!p) return;
        this.enterCollisionMaster(p.assetId, this.placementLabel(p.assetId));
      },
      getBuildSession: () => this.buildSessionVm(),
      getModelingSculpt: () => ({
        tool: this.cmSculptTool,
        radius: this.cmSculptRadius,
        strength: this.cmSculptStrength,
        dynamicTopology: this.cmSculptDynamic,
        targetEdgeLength: this.cmSculptTargetEdge,
        symmetry: { ...this.cmSculptSymmetry },
      }),
      setModelingSculptTool: (tool) => this.setCmSculptTool(tool),
      setModelingSculptSettings: (change) => {
        if (change.radius !== undefined) this.cmSculptRadius = change.radius;
        if (change.strength !== undefined) this.cmSculptStrength = change.strength;
        if (change.dynamicTopology !== undefined) this.cmSculptDynamic = change.dynamicTopology;
        if (change.targetEdgeLength !== undefined)
          this.cmSculptTargetEdge = change.targetEdgeLength;
        if (change.symmetry !== undefined) this.cmSculptSymmetry = { ...change.symmetry };
        this.cmBar?.refresh();
      },
      buildDone: () => this.finishBuildSession(),
      getModelPanel: () => this.modelPanelVm(),
      setModelTexture: (texId) => this.modelSetTextureAll(texId),
      setModelTexTile: (tile) => this.modelSetTexTileAll(tile),
      setModelLook: (look) => this.modelSetLook(look),
      getModelCount: () => this.selectedModelIndices().length,
      setModelCollision: (on) => this.modelSetCollision(on),
      editModel: () => this.editModelForSelection(),
      getCloneScaleRange: () => ({
        min: this.cloneScaleMin,
        max: this.cloneScaleMax,
      }),
      setCloneScaleRange: (change) => {
        if (change.min !== undefined) {
          this.cloneScaleMin = Math.min(
            PLACEMENT_SCALE_MAX,
            Math.max(PLACEMENT_SCALE_MIN, change.min),
          );
        }
        if (change.max !== undefined) {
          this.cloneScaleMax = Math.min(
            PLACEMENT_SCALE_MAX,
            Math.max(PLACEMENT_SCALE_MIN, change.max),
          );
        }
      },
      scaleAllSameAsset: () => void this.scaleAllSameAsset(),
      getMarkerSelection: () => {
        const e = this.entities.find((x) => x.key === this.selectedKey);
        return e ? { label: e.label, x: e.point.x, z: e.point.z } : null;
      },
      updateMarker: (axis, v) => {
        const e = this.entities.find((x) => x.key === this.selectedKey);
        if (e && e.point[axis] !== v) {
          const prev = { x: e.point.x, z: e.point.z };
          e.point[axis] = v;
          this.markerMovedWhile2d = true;
          this.pushMarkerUndo(e.key, prev, { x: e.point.x, z: e.point.z });
        }
      },
      resetMarker: () => {
        const e = this.entities.find((x) => x.key === this.selectedKey);
        const o = e ? this.base.get(e.key) : undefined;
        if (e && o && (e.point.x !== o.x || e.point.z !== o.z)) {
          const prev = { x: e.point.x, z: e.point.z };
          e.point.x = o.x;
          e.point.z = o.z;
          this.markerMovedWhile2d = true;
          this.pushMarkerUndo(e.key, prev, { x: o.x, z: o.z });
        }
      },
      getScatterCount: () => this.scatterCount,
      setScatterCount: (v) => {
        this.scatterCount = v;
      },
      runScatter: () => this.runScatter(),
      runHills: () => this.runHills(),
      layers: () => [
        ...KINDS.map((kind) => ({
          kind: kind as string,
          label: t(LAYER_KEYS[kind] as Parameters<typeof t>[0]),
          visible: this.visible.has(kind),
        })),
        // Blocker walls are a document layer, not a marker entity kind.
        {
          kind: 'blocker',
          label: t('editor.layers.blocker'),
          visible: this.blockersVisible2d,
        },
      ],
      toggleLayer: (kind, on) => {
        if (kind === 'blocker') this.blockersVisible2d = on;
        else if (on) this.visible.add(kind as EntityKind);
        else this.visible.delete(kind as EntityKind);
        this.canvasDirty = true;
      },
      frameAll: () => this.frameAll(),
      zones: () => this.map.content.zones.map((z) => ({ id: z.id, name: z.name })),
      frameZone: (id) => this.frameZone(id),
    };
  }

  // ---- 2D view ----------------------------------------------------------------------

  /**
   * Undo entry for a marker move (2D drag, coord field, or reset). Both sides
   * re-resolve the entity by key (entities can be rebuilt) and mutate the LIVE
   * point reference into the zone content, then flag the 3D re-mesh.
   */
  private pushMarkerUndo(key: string, prev: Vec2, next: Vec2): void {
    const apply = (v: Vec2): void => {
      const e = this.entities.find((x) => x.key === key);
      if (!e) return;
      const from = { x: e.point.x, z: e.point.z };
      e.point.x = v.x;
      e.point.z = v.z;
      if (isMovableEntity(e)) this.viewport3d?.moveMapEntity(e.key, from, v);
      this.markerMovedWhile2d = true;
      this.canvasDirty = true;
    };
    this.pushUndo({
      label: 'move-marker',
      undo: () => apply(prev),
      redo: () => apply(next),
    });
  }

  private vp(): Viewport {
    return { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
  }

  private visibleEntities(): EditorEntity[] {
    return this.entities.filter((e) => this.visible.has(e.kind));
  }

  private pickEntity(s: ScreenPoint): EditorEntity | null {
    const list = this.visibleEntities();
    const handles = list.map((e) => ({
      id: e.key,
      x: e.point.x,
      z: e.point.z,
      radius: e.radius,
    }));
    const hit = pickHandle(handles, s, this.cam, this.vp());
    return hit ? (list.find((e) => e.key === hit.id) ?? null) : null;
  }

  private resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.canvasDirty = true;
  };

  private tick2d = (): void => {
    if (this.canvasDirty && this.viewMode === '2d') {
      draw(this.ctx, this.cam, this.vp(), {
        entities: this.visibleEntities(),
        roads: this.activeWorld.roads,
        selectedKey: this.selectedKey,
        hoverKey: this.hoverKey,
        terrainEdits: this.map.terrainEdits,
        caves: this.map.caves ?? [],
        holes: this.map.holes ?? [],
        holePatches: this.map.holePatches ?? [],
        placements: this.map.placements,
        biomePaint: this.map.biomePaint ?? null,
        blockers: this.blockersVisible2d ? (this.map.blockers ?? []) : [],
        blockerPreview: this.blockerPreview,
        region: this.tool === 'region' ? this.regionBox : null,
        spawn: this.map.playerStart ?? null,
        spawnArea: this.spawnAreaPreview ?? this.map.playerSpawnArea ?? null,
        brush:
          (this.isDragTool() || this.tool === 'pond') && this.cursorWorld
            ? {
                x: this.cursorWorld.x,
                z: this.cursorWorld.z,
                radius:
                  this.tool === 'pond'
                    ? this.pondRadius * POND_BANK_RADIUS_FACTOR
                    : this.brushRadius,
                raise: this.tool !== 'lower' && this.tool !== 'pond',
                shape: this.brushShapeForTool(),
              }
            : null,
      });
      this.canvasDirty = false;
    }
    requestAnimationFrame(this.tick2d);
  };

  private pointerAt(ev: { clientX: number; clientY: number }): ScreenPoint {
    const r = this.canvas.getBoundingClientRect();
    return { sx: ev.clientX - r.left, sy: ev.clientY - r.top };
  }

  private attach2dEvents(stage: HTMLElement): void {
    window.addEventListener('resize', this.resize);

    stage.addEventListener('pointerdown', (ev) => {
      const s = this.pointerAt(ev);
      this.lastPointer = s;
      const w = this.cam.screenToWorld(s, this.vp());
      if (ev.button !== 0) {
        this.panning = true;
        stage.setPointerCapture(ev.pointerId);
        return;
      }
      if (this.tool === 'region') {
        this.selectingRegion = true;
        this.editStart(w, ev);
        stage.setPointerCapture(ev.pointerId);
        return;
      }
      if (this.tool === 'blocker') {
        this.drawingBlocker2d = true;
        this.editStart(w, ev);
        stage.setPointerCapture(ev.pointerId);
        return;
      }
      if (this.isDragTool()) {
        this.painting2d = true;
        this.paint2dDragPx = 0;
        this.editStart(w, ev);
        stage.setPointerCapture(ev.pointerId);
        return;
      }
      if (this.tool === 'place' || this.tool === 'camp' || this.tool === 'spawn') {
        this.editStart(w, ev);
        this.canvasDirty = true;
        return;
      }
      // Select: markers first, then placements.
      const hit = this.pickEntity(s);
      if (hit) {
        this.dragKey = hit.key;
        // Drag-start position, so release can push a single undo entry.
        this.markerDragStart = { key: hit.key, x: hit.point.x, z: hit.point.z };
        this.selectedKey = hit.key;
        this.setSelectedPlacement(null);
        this.grab = { x: w.x - hit.point.x, z: w.z - hit.point.z };
        this.inspector.refresh();
      } else {
        const pi = pickPlacementIndex(this.map.placements, w.x, w.z, this.cam.pxPerYard);
        if (pi >= 0) {
          this.selectedKey = null;
          this.setSelectedPlacement(pi);
          this.inspector.refresh();
        } else {
          this.panning = true;
          if (this.selectedKey || this.selectedPlacement !== null) {
            this.selectedKey = null;
            this.setSelectedPlacement(null);
            this.inspector.refresh();
          }
        }
      }
      stage.setPointerCapture(ev.pointerId);
      this.canvasDirty = true;
    });

    stage.addEventListener('pointermove', (ev) => {
      const s = this.pointerAt(ev);
      const dx = s.sx - this.lastPointer.sx;
      const dy = s.sy - this.lastPointer.sy;
      this.lastPointer = s;
      this.cursorWorld = this.cam.screenToWorld(s, this.vp());
      if (this.selectingRegion || this.drawingBlocker2d) {
        this.editMove(this.cursorWorld);
      } else if (this.painting2d) {
        // Queued moves arriving after the physical release must not stroke on
        // (same trailing-event gate as the 3D viewport). Click jitter must not
        // either: the world-space spacing gate is no protection zoomed out, so
        // require a real drag before moves may stroke (the press already did).
        this.paint2dDragPx += Math.abs(dx) + Math.abs(dy);
        if (ev.buttons !== 0 && this.paint2dDragPx > 5) this.editMove(this.cursorWorld);
      } else if (this.dragKey) {
        const e = this.entities.find((x) => x.key === this.dragKey);
        if (e) {
          e.point.x = this.cursorWorld.x - this.grab.x;
          e.point.z = this.cursorWorld.z - this.grab.z;
          this.markerMovedWhile2d = true;
          this.canvasDirty = true;
        }
      } else if (this.panning) {
        this.cam.panByPixels(dx, dy);
        this.canvasDirty = true;
      } else if (this.tool !== 'select') {
        this.canvasDirty = true; // refresh the brush cursor preview
      } else {
        const hit = this.pickEntity(s);
        const key = hit ? hit.key : null;
        if (key !== this.hoverKey) {
          this.hoverKey = key;
          stage.style.cursor = key ? 'grab' : 'default';
          this.canvasDirty = true;
        }
      }
    });

    const end = (ev: PointerEvent): void => {
      this.panning = false;
      if (this.dragKey) {
        const key = this.dragKey;
        const start = this.markerDragStart;
        this.dragKey = null;
        this.markerDragStart = null;
        const e = this.entities.find((x) => x.key === key);
        if (e && start && start.key === key && (e.point.x !== start.x || e.point.z !== start.z)) {
          this.pushMarkerUndo(key, { x: start.x, z: start.z }, { x: e.point.x, z: e.point.z });
          this.inspector.refresh();
        }
      }
      if (this.selectingRegion) {
        this.selectingRegion = false;
        this.editEnd();
      }
      if (this.drawingBlocker2d) {
        this.drawingBlocker2d = false;
        this.editEnd();
      }
      if (this.painting2d) {
        this.painting2d = false;
        this.editEnd();
        this.map.meta.updatedAt = now();
      }
      try {
        stage.releasePointerCapture(ev.pointerId);
      } catch {
        // pointer capture may already be gone; ignore.
      }
      this.canvasDirty = true;
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    // Non-left buttons pan the 2D view; keep the browser menu off the stage
    // (the 3D canvas already suppresses it).
    stage.addEventListener('contextmenu', (ev) => ev.preventDefault());

    stage.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const factor = Math.exp(-ev.deltaY * 0.0015);
        this.cam.zoomAt(this.pointerAt(ev), factor, this.vp());
        this.canvasDirty = true;
      },
      { passive: false },
    );
  }

  private frameAll(): void {
    const pts = this.entities.map((e) => e.point);
    if (pts.length === 0) return;
    const min = {
      x: Math.min(...pts.map((p) => p.x)),
      z: Math.min(...pts.map((p) => p.z)),
    };
    const max = {
      x: Math.max(...pts.map((p) => p.x)),
      z: Math.max(...pts.map((p) => p.z)),
    };
    this.cam.frame(min, max, this.vp());
    this.canvasDirty = true;
  }

  private frameZone(zoneId: string): void {
    const own = this.entities.filter((e) => e.zoneId === zoneId);
    const zone = this.map.content.zones.find((z) => z.id === zoneId);
    if (!zone || own.length === 0) return;
    const xs = own.map((e) => e.point.x);
    const min = { x: Math.min(...xs), z: zone.zMin };
    const max = { x: Math.max(...xs), z: zone.zMax };
    this.cam.frame(min, max, this.vp());
    this.canvasDirty = true;
  }
}

// Editor UI helpers (not sim code): wall-clock + ids are fine here.
function now(): number {
  return Date.now();
}
function mintId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `map-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  }
}

// Imported ground textures are stored compressed: downscaled to fit 1024
// (the splat atlas samples 512 per slot, so 1024 keeps headroom) and
// re-encoded as WebP q0.9 (visually lossless at these sizes; the base game's
// terrain sources are 1K jpg). Falls back to JPEG q0.92 where the browser
// cannot encode WebP (Safari), except for PNGs that actually use alpha; and
// keeps the ORIGINAL bytes whenever the re-encode is not smaller.
async function compressGroundTextureImport(
  img: HTMLImageElement,
  file: File,
): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const original = async (): Promise<{ bytes: ArrayBuffer; mime: string }> => ({
    bytes: await file.arrayBuffer(),
    mime: file.type || 'image/png',
  });
  const scale = Math.min(1, 1024 / Math.max(1, img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return original();
  ctx.drawImage(img, 0, 0, w, h);
  const encode = (type: string, quality: number): Promise<Blob | null> =>
    new Promise((res) => c.toBlob(res, type, quality));
  let blob = await encode('image/webp', 0.9);
  if (blob?.type !== 'image/webp') {
    // No WebP encoder: JPEG drops alpha, so a PNG that uses transparency
    // keeps its original bytes instead.
    const isPng = (file.type || '').includes('png') || /\.png$/i.test(file.name);
    let hasAlpha = false;
    if (isPng) {
      const d = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] < 255) {
          hasAlpha = true;
          break;
        }
      }
    }
    blob = hasAlpha ? null : await encode('image/jpeg', 0.92);
    if (blob && blob.type !== 'image/jpeg') blob = null;
  }
  if (!blob || blob.size >= file.size) return original();
  return { bytes: await blob.arrayBuffer(), mime: blob.type };
}
