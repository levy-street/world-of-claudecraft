import { WORLD_SEED } from '../../sim/world_seed';
// The 3D in-world editor viewport. Reuses the real game Renderer over a frozen Sim
// built from the editor's CustomMap, drives a free editor camera, and applies edits
// through the Renderer's live editing APIs: chunk-local terrain rebuilds during a
// brush stroke (rebuildTerrain(region)) with a macro-normal rebake at stroke end,
// the shader brush ring (setEditorBrush/clearEditorBrush), live water re-seating
// (rebuildWater), and the PlacedAssetsView instancer for placements
// (add/update/remove/select/footprints/reSeat). This is the DEFAULT editor mode.
// Editor-only (dev tooling); imports the heavy Renderer.
//
// Ownership: the APP owns the document and the ACTIVE WorldContent
// (setActiveWorldContent); this viewport only reads terrain via the active
// content and pushes render updates.

import * as THREE from 'three';
import { assetsReady, beginDeferredPreloads } from '../../render/assets/preload';
import { setModularLookProvider } from '../../render/characters';
import { npcEntityLookFor } from '../../render/characters/npc_look_provider';
import { buildCavityMesh } from '../../render/cut_cavity_core';
import type { EditorLightingProfile } from '../../render/editor_lighting';
import { setFoliageBounds, setFoliageFarPlacements } from '../../render/foliage_editor_scope';
import { gcGroundTextureSets } from '../../render/ground_tex_gc';
import { setOccluderFadesDisabled } from '../../render/occluder_fade_core';
import { type SeatRegion, unionRegion } from '../../render/placed_assets';
import { Renderer } from '../../render/renderer';
import { setSwayDisabledAssets } from '../../render/tree_sway';
import type { BakedCollisionBox } from '../../sim/asset_collision';
import {
  COLLIDER_DEFAULT_SIZE,
  type ColliderVolumeKind,
  colliderKindFor,
  colliderVolumeFromPlacement,
} from '../../sim/collider_volumes';
import { FENCE_HALF_DEPTH } from '../../sim/colliders';
import { getActiveWorldContent } from '../../sim/data';
import { createNpc } from '../../sim/entity';
import {
  fluidVolumeFromPlacement,
  fluidVolumesFromPlacements,
  isFluidAssetId,
} from '../../sim/fluid_volumes';
import { cavitySheetAt } from '../../sim/ground_sheets';
import {
  DEFAULT_ASSET_VIEW_DISTANCE,
  MAX_AXIS_SCALE,
  MAX_COLLIDER_SIZE,
  MAX_COLLIDER_SIZE_Y,
  MAX_PLACEMENT_Y_OFFSET,
  type MapHitbox,
  MIN_AXIS_SCALE,
  MIN_COLLIDER_SIZE,
  MIN_COLLIDER_SIZE_Y,
} from '../../sim/map_doc';
import { Sim } from '../../sim/sim';
import { cutBounds, cutSdfAt, cutVerticalBounds } from '../../sim/terrain_cuts';
import type {
  AssetFireEmitter,
  AuthorVfx,
  BlockerDef,
  CaveDef,
  ColliderVolume,
  MapWeather,
  NpcDef,
  PlacedAsset,
  TerrainHole,
} from '../../sim/types';
import { terrainHeight, zoneBiomeAt } from '../../sim/world';
import { t } from '../../ui/i18n';
import { buildingPlacementVisible } from '../building_core';
import { buildCampPreviewEntities } from '../camp_preview';
import { cityGridLayout } from '../city_build_core';
import type { CmComponentMode, CmMesh } from '../cm_mesh';
import { vertsCentroid } from '../cm_mesh';
import {
  type AssetPlacement,
  type CustomMap,
  customMapToWorldContent,
  mapBounds,
  placementsToRenderAssets,
} from '../custom_map';
import {
  findRuntimeCampIndex,
  moveRuntimeMapEntity,
  moveRuntimeMobsById,
  setRuntimeNpcFacing,
} from '../entity_edit_core';
import { localAssetUrl } from '../local_assets';
import { PLACEMENT_SCALE_MAX, PLACEMENT_SCALE_MIN, wrapAngle } from '../placement_transform_core';
import { userAssetPath } from '../user_assets';
import {
  type BuildingFootprintLookup,
  BuildingPreview,
  buildingSurfaceSide,
} from './building_preview';
import { dominantCameraPlane, projectCameraAxes } from './camera_axis_widget';
import { type CmComponentPick, CmMeshView, type CmSurfacePick } from './cm_mesh_view';
import { type CameraAxisView, EditorCamera, shouldAcceptCameraMovementKey } from './editor_camera';
import { HitboxHandles, type HitboxSubMode } from './hitbox_handles';
import { EditorPerfOverlay, type PerfOverlayConfig } from './perf_overlay';
import {
  type GizmoAxis,
  type GizmoConfig,
  type GizmoMode,
  gizmoAxisDir,
  gizmoScaleForScreen,
  TransformGizmo,
} from './transform_gizmo';

export interface EditRegion {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Editor3DHooks {
  // The active tool wants left-click/drag for editing (so the viewport must not
  // orbit on the left button). Right-drag always orbits; middle/shift-drag pans.
  toolActive(): boolean;
  // The active tool claims Shift+left-drag as an INVERTED edit (sculpt tools:
  // raise<->lower, smooth<->flatten) instead of the default Shift-pan.
  shiftEditsTool(): boolean;
  // Pointer began/continued/ended an edit over the terrain surface (world x/z).
  onEditStart(world: { x: number; z: number }, ev: PointerEvent): void;
  onEditMove(world: { x: number; z: number }, ev: PointerEvent): void;
  onEditEnd(ev: PointerEvent): void;
  // The cursor moved over the surface (for the brush gizmo); null when off-terrain.
  onHover(world: { x: number; z: number } | null): void;
  // A left-click that did not turn into a drag while no edit tool was active
  // (Select mode picking). Client coords + the terrain point under the cursor.
  // `additive` = Shift was held (Blender: extend/toggle the selection).
  onTap(
    clientX: number,
    clientY: number,
    world: { x: number; z: number } | null,
    additive: boolean,
  ): void;
  // Direct manipulation of placements in Select mode. When enabled, a left
  // pointerdown on a pickable placement offers the drag to the app; a true
  // return claims it (the app selects the placement) and the viewport streams
  // the terrain point under the cursor until release. A false return falls
  // back to the normal orbit.
  placementDragEnabled(): boolean;
  onPlacementDragStart(index: number): boolean;
  onPlacementDragMove(world: { x: number; z: number }): void;
  onPlacementDragEnd(): void;
  // Direct manipulation of authored NPCs in Select mode, the same deferred
  // press-becomes-drag contract as placements: a true return from start claims
  // the drag (the app selects the NPC) and the viewport streams the ground
  // point under the cursor until release. NPCs need no separate tool.
  onNpcDragStart(key: string): boolean;
  onNpcDragMove(world: { x: number; z: number }): void;
  onNpcDragEnd(): void;
  // And rendered camp mobs, same contract (id = live sim entity id).
  onMobDragStart(id: number): boolean;
  onMobDragMove(world: { x: number; z: number }): void;
  onMobDragEnd(): void;
  // Ctrl+left-drag marquee in Select mode: every placement index whose anchor
  // projected inside the released box (empty = clear the selection). Holding
  // Shift too adds the box to the existing placement selection.
  onBoxSelect(indices: number[], additive: boolean): void;
  // Shift+wheel (rotate) / Alt+wheel (scale) over the stage while a placement
  // is selected. True consumes the event; false falls through to camera zoom.
  onTransformWheel(kind: 'rotate' | 'scale', deltaY: number): boolean;
  // Wheel in Free-Fly: the gesture re-gears the flight instead of dollying, so
  // one input never zooms and changes speed at once (camera_speed_core.ts).
  onFlySpeedWheel(deltaY: number): void;
  // The 3-axis gizmo: which mode to show for the current tool + selection
  // (null hides it), live handle-drag updates, and the end-of-drag commit
  // (ONE undo entry, like every other transform gesture).
  gizmoMode(): GizmoMode | null;
  onGizmoChange(change: GizmoPlacementChange): void;
  /** Move the selected authored fire emitter in the model's local axes. */
  onFireGizmoChange(change: Partial<Pick<AssetFireEmitter, 'x' | 'y' | 'z'>>): void;
  onGizmoEnd(): void;
  // FORK: a gizmo drag on the pending Cut/Carve ghost (absolute values from
  // the gesture start, like onGizmoChange for a placement).
  onCutGhostGizmoChange(change: GizmoCutChange): void;
  /** Progress of a viewport build (boot and every reload), 0..100, with the
   *  stage it is in, so the loading curtain can show how far along the world
   *  is instead of a bare spinner. Optional: tests and the playtest boot pass
   *  no listener. */
  onBuildProgress?(percent: number, stage: 'assets' | 'engine' | 'zone'): void;
  // Hitbox edit mode: live gizmo deltas over the SELECTED hitboxes (world
  // space, from gesture start); the shared onGizmoEnd commits the gesture.
  onHitboxGizmoChange(change: GizmoHitboxChange): void;
  // Collision Master mesh session: live gizmo deltas over the mesh selection
  // (same world-delta contract); the shared onGizmoEnd commits the gesture.
  onCmGizmoChange(change: GizmoHitboxChange): void;
  // Ctrl+drag marquee in a Collision Master sub mode: the lassoed VERTEX
  // indices of the selected volume (empty = clear the component selection).
  onCmMarquee(verts: number[]): void;
  // Collision Master sub-element handles (vertex/edge/face): live reshaped
  // box per drag sample + the end-of-gesture commit (ONE undo entry).
  onHitboxHandleEdit(boxIndex: number, box: MapHitbox): void;
  onHitboxHandleCommit(): void;
  // Ctrl+drag marquee while hitbox editing: the lassoed COLLISION BOX indices
  // (empty = clear the box selection).
  onHitboxBoxSelect(indices: number[]): void;
}

/** A live hitbox edit produced by a gizmo handle drag: world-space deltas
 *  relative to the gesture start (the app converts to model space). */
export interface GizmoHitboxChange {
  dx?: number;
  dy?: number;
  dz?: number;
  dRotY?: number;
  // Collision Master mesh volumes rotate on all three axes (boxes are
  // yaw-only sim OBBs; meshes decompose after the fact, so tilt is legal).
  dRotX?: number;
  dRotZ?: number;
  ratio?: number;
  axis?: 'x' | 'y' | 'z' | 'uniform';
}

/** FORK: a live edit of the pending cut ghost from a gizmo handle drag. */
export interface GizmoCutChange {
  x?: number;
  y?: number;
  z?: number;
  rotY?: number;
  rotX?: number;
  radius?: number;
  lengthMult?: number;
  heightMult?: number;
}

/** A live placement edit produced by a gizmo handle drag. */
export interface GizmoPlacementChange {
  x?: number;
  y?: number;
  z?: number;
  rotY?: number;
  rotX?: number;
  rotZ?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
}

// Tunnel-tool cave guides (A -> B flow): shared materials/geometry, never
// disposed (module lifetime, a handful of tiny objects).
// Hitbox edit overlay: shared unit geometry (meshes scale it per box).
const hitboxUnitGeo = new THREE.BoxGeometry(1, 1, 1);
const hitboxUnitEdges = new THREE.EdgesGeometry(hitboxUnitGeo);
const hitboxEdgeMat = new THREE.LineBasicMaterial({
  color: 0x9fe8ff,
  transparent: true,
  opacity: 0.9,
});
const hitboxEdgeSelMat = new THREE.LineBasicMaterial({ color: 0xffe08a });

const caveGuideLineMat = new THREE.LineBasicMaterial({
  color: 0xffd35a,
  transparent: true,
  opacity: 0.9,
  depthTest: false,
});
const caveGuideEntranceMat = new THREE.MeshBasicMaterial({
  color: 0x3ade6e,
  transparent: true,
  opacity: 0.95,
  depthTest: false,
});
const caveGuideExitMat = new THREE.MeshBasicMaterial({
  color: 0xff5a4a,
  transparent: true,
  opacity: 0.95,
  depthTest: false,
});
const caveGuideSphereGeo = new THREE.SphereGeometry(0.75, 14, 10);
const caveGuideConeGeo = new THREE.ConeGeometry(0.7, 1.8, 12);
// Rig control points (the movable cave waypoints): bright blue spheres joined
// by a dotted line, so the planned path reads before the cave is generated.
const caveRigPointMat = new THREE.MeshBasicMaterial({
  color: 0x3a8fff,
  transparent: true,
  opacity: 0.95,
  depthTest: false,
});
const caveRigPointGeo = new THREE.SphereGeometry(0.9, 14, 10);
const caveRigLineMat = new THREE.LineDashedMaterial({
  color: 0x9fc8ff,
  transparent: true,
  opacity: 0.9,
  depthTest: false,
  dashSize: 1.1,
  gapSize: 0.7,
});
// The Cut/Carve tool's pending-solid ghost: translucent blue fill plus a
// faint wireframe so the shape reads against any ground, half of it being
// underground by design.
const cutGhostMat = new THREE.MeshBasicMaterial({
  color: 0x3fa7ff,
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
  side: THREE.DoubleSide,
  userData: { noWireframe: true },
});
const cutGhostWireMat = new THREE.MeshBasicMaterial({
  color: 0x9fd2ff,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  wireframe: true,
  userData: { noWireframe: true },
});
// Collision Master studio backdrop: a vertical gradient equirect, generated
// once and fed through the editor-skybox seam (which hides the procedural sky
// dome). Neutral grays, Blender lookdev vibes.
let studioBackdropCache: string | null = null;
function studioBackdropUrl(): string {
  if (studioBackdropCache) return studioBackdropCache;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const grad = ctx.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#3a3b40');
  grad.addColorStop(0.52, '#2b2c30');
  grad.addColorStop(0.58, '#232327');
  grad.addColorStop(1, '#1c1c1f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);
  studioBackdropCache = c.toDataURL('image/png');
  return studioBackdropCache;
}

// Hole-tool cutout rings: a cyan circle traced around each terrain hole so
// the punched openings stay findable/editable while the Caves tool is up.
const holeGuideMat = new THREE.LineBasicMaterial({
  color: 0x49e4ff,
  transparent: true,
  opacity: 0.9,
  depthTest: false,
});
// Patch spheres (Patch hole mode) trace GREEN so restored ground reads apart
// from cuts at a glance.
const holePatchGuideMat = new THREE.LineBasicMaterial({
  color: 0x54e07a,
  transparent: true,
  opacity: 0.9,
  depthTest: false,
});

const SPAWN_RING_COLOR = 0x3fd0ff;
const SPAWN_RING_SEGMENTS = 40;
// Editor-only blocker-wall overlay: translucent boxes over the collision
// segments (the shipped game renders nothing for a blocker). Height is
// presentational; the wall thickness reuses the sim's fence half-depth so the
// drawn box matches the collider exactly.
const BLOCKER_OVERLAY_HEIGHT = 3;
// Blocker walls that run along the map limits draw as the hard boundary they
// are: a wall too tall to ever jump (collision is height-agnostic either way).
const BOUNDARY_OVERLAY_HEIGHT = 100;
const BLOCKER_COLOR = 0xe0503c;
// Editor-only collider-volume overlay: translucent green volumes over the
// 'collider/<kind>' placements (invisible in playtest, like blockers).
const COLLIDER_COLOR = 0x3ddc6a;
// Wireframe mode (Camera tab) applies to MAP GEOMETRY only: these render
// categories (tagged on the renderer's groups via userData.renderCategory).
// Editor overlays (gizmo, rings, labels, nameplates) carry no category and stay
// solid so the chrome stays legible.
const WIREFRAME_MAP_CATEGORIES = new Set(['terrain', 'water', 'foliage', 'fish', 'props']);
const TAP_SLOP_PX = 5;
// Repeated-click cycling through overlapping placements (DCC style): a second tap
// near the SAME screen point within the window advances to the next candidate
// under the cursor instead of re-picking the nearest one, wrapping back to the
// closest after CYCLE_MAX_DEPTH. A 2s window so unhurried clicks still cycle.
const CYCLE_WINDOW_MS = 1400;
const CYCLE_SLOP_PX = 16;
const CYCLE_MAX_DEPTH = 16;
// Map-light bulb badges pick by projected screen distance (see pickMapLight);
// a click lands if it is within this many pixels of the badge center.
const LIGHT_PICK_PX = 28;
// Hover-cursor pick throttle (Select mode only): the placement raycast is the
// same cost as a tap pick, so cap it well below the pointer-move rate.
const HOVER_PICK_MS = 120;
// Analytic surface pick: march the pointer ray against the sim terrainHeight
// (render terrain == sim height invariant) instead of raycasting every terrain
// chunk per pointer-move. Coarse steps find the crossing; bisection refines it.
const MARCH_MAX_T = 1200; // yards along the ray (covers the 600yd max orbit dist)
const MARCH_STEPS = 96;
const MARCH_REFINE = 12;
const EDITOR_VERTICAL_FOV_DEG = 60;

export class Editor3DViewport {
  private canvas!: HTMLCanvasElement;
  private nameplates!: HTMLDivElement;
  private axisWidget!: HTMLDivElement;
  private axisCore!: HTMLDivElement;
  private axisWidgetVisible = true;
  // The gimbal reflects camera ORIENTATION only. Ordinary fly movement changes
  // position, not yaw/pitch, so retain the last pose and leave the DOM entirely
  // untouched on those frames. This keeps terrain streaming's main-thread
  // budget available to WebGL instead of paying for stationary UI chrome.
  private axisWidgetYaw = Number.NaN;
  private axisWidgetPitch = Number.NaN;
  private readonly axisWidgetParts = new Map<
    CameraAxisView,
    { arm: HTMLSpanElement; button: HTMLButtonElement }
  >();
  private readonly cam = new EditorCamera();
  private sim: Sim | null = null;
  private readonly authoredCampMobIds = new Set<number>();
  private renderer: Renderer | null = null;
  private raf = 0;
  private lastT = 0;
  // Seconds since the last rock/cave ground-texture GC (editor-only: the game's
  // placements are static, so it never accumulates orphaned sets).
  private groundGcAccum = 0;
  private disposed = false;
  private seed = WORLD_SEED;
  private map: CustomMap;
  // Bumped by start()/reload()/dispose(); an in-flight start() that awoke with a
  // stale token abandons, so a reload during the assets await never leaves two
  // engines (and two event attachments) running.
  private generation = 0;
  // Visibility gate: while hidden the render loop stops and the edit
  // passthroughs coalesce into dirty flags, flushed on the next setVisible(true).
  private visible = true;
  private orthographic = false;
  private hiddenTerrainFull = false;
  private hiddenTerrainRegion: SeatRegion | null = null;
  private hiddenWater = false;
  private hiddenPlacements = false;
  private hiddenSpawn = false;
  // The app's last-told selection, reapplied after a flushed structural rebuild
  // (rebuildAll clears the view's selection).
  private selectedIndex: number | null = null;

  private spawnRing: THREE.Mesh | null = null;
  private spawnPoint: { x: number; z: number } | null = null;
  private readonly spawnMat = new THREE.MeshBasicMaterial({
    color: SPAWN_RING_COLOR,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Blocker-wall overlay (spawnRing ownership pattern: build/refresh/dispose).
  private blockersGroup: THREE.Group | null = null;
  private blockerPreviewMesh: THREE.Mesh | null = null;
  private hiddenBlockers = false;
  private readonly blockerMat = new THREE.MeshBasicMaterial({
    color: BLOCKER_COLOR,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly blockerPreviewMat = new THREE.MeshBasicMaterial({
    color: BLOCKER_COLOR,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Collider-volume overlay (blocker pattern, but keyed by DOCUMENT index so a
  // live transform drag refreshes one mesh instead of the whole set).
  private collidersGroup: THREE.Group | null = null;
  private readonly colliderMeshes = new Map<number, THREE.Mesh>();
  private hiddenColliders = false;
  // User "hide collision volumes" toggle (Collider tab): keeps the group built
  // (and pickable through the same meshes) but drops it from the scene render.
  private collidersUserHidden = false;
  // User "hide area boxes" toggle (Zone tool): drops the blue named-location
  // rects from the render, same pattern as collidersUserHidden above.
  private locationsUserHidden = false;
  private readonly colliderMat = new THREE.MeshBasicMaterial({
    color: COLLIDER_COLOR,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly colliderSelMat = new THREE.MeshBasicMaterial({
    color: COLLIDER_COLOR,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly picker = new THREE.Raycaster();
  private readonly pickNdc = new THREE.Vector2(); // scratch, per pointer-move

  // The 3-axis transform gizmo (built on start; posed every frame).
  private gizmo: TransformGizmo | null = null;
  private gizmoDrag: {
    axis: GizmoAxis;
    mode: GizmoMode;
    kind: ColliderVolumeKind | null;
    start: AssetPlacement;
    origin: THREE.Vector3;
    plane: THREE.Plane;
    startHit: THREE.Vector3;
    // True when the drag edits the SELECTED HITBOXES instead of the placement.
    hitbox?: boolean;
    // FORK: the drag moves/turns/sizes the pending cut ghost (no placement).
    ghost?: { start: TerrainHole };
    // True when the drag edits the Collision Master mesh selection (a whole
    // volume in object mode, or the selected verts/edge/face in sub modes).
    cm?: boolean;
    // Authored fire emitter: the gizmo moves its local offsets, never the asset.
    fire?: { emitterIndex: number; start: AssetFireEmitter };
  } | null = null;
  private fireEditState: { index: number; emitterIndex: number } | null = null;
  // Collision Master mesh session (app-fed): editable volumes + selection.
  private cmMeshState: {
    meshes: readonly CmMesh[];
    selected: number | null;
    mode: CmComponentMode | null;
    selVerts: readonly number[];
    baseY: number;
    // World x/z the model's local origin sits at. 0/0 for the Collision Master
    // scratch scene (asset at origin); the model's map position for a Build
    // session editing in the live map.
    originX?: number;
    originZ?: number;
  } | null = null;
  private cmMeshView: CmMeshView | null = null;
  // Studio mode: neutral backdrop + hidden terrain + grid floor, applied
  // after every renderer (re)start while on (Collision Master sessions).
  private studio = false;
  private studioRig: THREE.Group | null = null;
  // Hitbox edit mode overlay (app-fed): the edited placement's boxes as
  // pickable translucent volumes; `selected` highlights + anchors the gizmo.
  private hitboxEditState: {
    index: number;
    boxes: readonly MapHitbox[];
    selected: number[];
  } | null = null;
  private hitboxGroup: THREE.Group | null = null;
  private readonly hitboxMat = new THREE.MeshBasicMaterial({
    color: 0x3fd0ff,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly hitboxSelMat = new THREE.MeshBasicMaterial({
    color: 0xffc933,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly gizmoOriginV = new THREE.Vector3();
  private readonly gizmoViewV = new THREE.Vector3();
  private readonly planeHitV = new THREE.Vector3();
  private buildingPlane: THREE.Plane | null = null;
  private buildingPreview: BuildingPreview | null = null;
  private buildingFloorFilter = { id: null as string | null, level: 0, hideAbove: false };
  private readonly buildingFilteredIndices = new Set<number>();

  // Interaction state.
  private dragMode:
    | 'none'
    | 'orbit'
    | 'pan'
    | 'edit'
    | 'placepending'
    | 'moveplacement'
    | 'npcpending'
    | 'movenpc'
    | 'mobpending'
    | 'movemob'
    | 'gizmo'
    | 'hitboxhandle'
    | 'marquee' = 'none';
  // Collision Master sub-element editing (vertex/edge/face handles).
  private hitboxHandles: HitboxHandles | null = null;
  private hitboxSubMode: HitboxSubMode | null = null;
  private handleBoxIndex = -1;
  // A left press landed on a pickable placement (Select mode). The gesture stays
  // 'placepending' until the pointer passes TAP_SLOP_PX: past it, it promotes to a
  // move-drag; a release before it is a tap (select / overlap-cycle).
  private pendingPlaceIdx: number | null = null;
  // Same deferred-press contract for an authored NPC under the cursor: NPCs
  // move like placements in Select mode, no separate tool needed.
  private pendingNpcKey: string | null = null;
  // And for a rendered camp mob (entity id), same contract again.
  private pendingMobId: number | null = null;
  // Ctrl+drag box select: client-space corners + whether Ctrl/Cmd+Shift should
  // accumulate this box into the existing placement selection.
  private marquee: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    additive: boolean;
  } | null = null;
  private marqueeEl: HTMLDivElement | null = null;
  private lastPointer = { x: 0, y: 0 };
  private dragDist = 0;
  private lastHoverPickAt = 0;
  // True only after a surface-aware tool has drawn a hover brush. Selection
  // and camera tools never need a terrain ray-march on ordinary pointer move;
  // this lets us clear the previous brush once rather than doing that work on
  // every mouse event.
  private hoverSurfaceActive = false;
  // Click-cycle state for overlapping-placement selection (pickPlacementCycling).
  private tapCycle: {
    x: number;
    y: number;
    candidates: number[];
    cursor: number;
    at: number;
  } | null = null;
  // Pointerdown resolves the pick before deciding between click and drag;
  // pointerup asks for the same candidates again to apply rapid-click cycling.
  // Retain that exact result briefly so one click pays for one mesh raycast.
  private placementPickCache: {
    x: number;
    y: number;
    at: number;
    candidates: number[];
  } | null = null;
  private readonly keys = new Set<string>();
  // Free-Fly mode: WASD/QE move whenever toggled on (not just mid-drag), and a
  // navigation drag mouse-looks (first person) instead of orbiting the target.
  private freeFly = false;
  // Map-authored ambience speed (Lighting tab), reapplied after engine reloads.
  private worldSpeed = 1;
  // Placed-asset view distance (Camera tab), reapplied after engine reloads.
  private assetViewDistance = DEFAULT_ASSET_VIEW_DISTANCE;
  private visibilityProfile = { distance: 900, haze: 0.25 };
  // Performance overlay (Camera tab). Created lazily on first enable; fed a
  // stats snapshot each frame. Editor dev tooling, never in playtest.
  private perfOverlay: EditorPerfOverlay | null = null;
  private perfCfg: PerfOverlayConfig | null = null;
  private perfMsSmoothed = 0;
  private perfUpdateAccum = 0;
  // The app's lighting override, kept so an engine reload reapplies it.
  private lighting: EditorLightingProfile | null = null;
  private birdsCfg: { enabled: boolean; count: number; formation: boolean } | null = null;
  private skyboxUrl: string | null = null;
  private showBoundaryWalls = true;
  /** The residency perimeter guide: translucent red walls on the streamed
   *  rect's edges, so a maker can SEE where the loaded zones stop. */
  private guideGroup: THREE.Group | null = null;
  private guideOn = false;
  private guideRect: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  // Wireframe render mode (Camera tab): draws map geometry as raw polygons. Applied
  // per frame while on; `wireframeWasOn` runs one final reset traverse after it is
  // turned off so shared/cached materials return to solid.
  private wireframe = false;
  private wireframeWasOn = false;
  // Mesh Fix "Vertices" mode: one THREE.Points of the terrain lattice around
  // the cursor, grey unselected / yellow selected. Rebuilt only when the app
  // hands over a new window or selection, never per frame.
  private vertexDots: THREE.Points | null = null;
  private vertexDotGeo: THREE.BufferGeometry | null = null;
  private vertexDotMat: THREE.PointsMaterial | null = null;
  // Transparent X-ray mode uses reversible material snapshots so cached map
  // materials return to their exact authored state when the toggle is off.
  private xray = false;
  private xrayWasOn = false;
  private readonly xrayMaterialState = new Map<
    THREE.Material,
    { transparent: boolean; opacity: number; depthWrite: boolean; depthTest: boolean }
  >();
  // Preview mode (topbar): in-game look, every editor overlay hidden. Re-
  // enforced per frame (loop) since overlay rebuilds recreate groups visible.
  private previewMode = false;
  // Zone isolate: when set, only this world rect is resident (terrain,
  // placements, overlays). View state only, the document never changes.
  private isolateRect: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  // Authored-overlay groups: named location rects, AI markers, point lights
  // (live editor preview; playtest builds its own from the projection).
  private locationsGroup: THREE.Group | null = null;
  private markersGroup: THREE.Group | null = null;
  private lightsGroup: THREE.Group | null = null;
  private selectedLightIndex: number | null = null;
  private bulbTexture: THREE.CanvasTexture | null = null;
  // Point-sound emitter overlays: a clickable speaker badge per node + a
  // wireframe falloff sphere (the selected node bright; all faint under preview).
  private soundsGroup: THREE.Group | null = null;
  private selectedSoundIndex: number | null = null;
  private soundPreviewOn = false;
  private soundTexture: THREE.CanvasTexture | null = null;
  // Falloff volume drawn as a wireframe BOX, not a sphere: a cube is ~18 line
  // segments vs a sphere's hundreds, so showing every emitter's range under
  // preview stays cheap. (The audio falloff itself is still spherical.)
  private readonly soundBoxMat = new THREE.MeshBasicMaterial({
    color: 0x6ad0ff,
    wireframe: true,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  private readonly soundBoxSelMat = new THREE.MeshBasicMaterial({
    color: 0x8fe0ff,
    wireframe: true,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  // Ground-decal overlays. The decals THEMSELVES are drawn by the renderer's
  // streamed Decals system (the same one playtest uses, so the editor shows
  // exactly what ships); this group only adds the authoring affordances, a
  // footprint ring per stamp while the Decal tool is up, brighter on the
  // selected one.
  private decalsGroup: THREE.Group | null = null;
  private selectedDecalIndex: number | null = null;
  private decalOverlayOn = false;
  private readonly decalRingMat = new THREE.MeshBasicMaterial({
    color: 0xffc46b,
    wireframe: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  private readonly decalRingSelMat = new THREE.MeshBasicMaterial({
    color: 0xffd89a,
    wireframe: true,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });
  private zonePreviewMesh: THREE.Mesh | null = null;
  // City Build: the wall/road polyline being drawn (terrain-draped guide line).
  private cityPathGroup: THREE.Group | null = null;
  private cityGridGroup: THREE.Group | null = null;
  private cityGridKey = '';
  private caveGuidesGroup: THREE.Group | null = null;
  private holeGuidesGroup: THREE.Group | null = null;
  private cutGhostGroup: THREE.Group | null = null;
  private cutGhostCut: TerrainHole | null = null;
  // Rock-tool bridge/ridge chain preview (blue points + dotted connector).
  private rockChainGroup: THREE.Group | null = null;
  private readonly locationMat = new THREE.MeshBasicMaterial({
    color: 0x46b1ff,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private musicGroup: THREE.Group | null = null;
  // Music-area overlays draw only while the Music tool is active (the rects
  // are authoring chrome, not world content); the selected one highlights.
  private musicPreviewOn = false;
  private selectedMusicIndex: number | null = null;
  private readonly musicMat = new THREE.MeshBasicMaterial({
    color: 0x35d0a5,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly musicSelMat = new THREE.MeshBasicMaterial({
    color: 0x53f0c2,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly zonePreviewMat = new THREE.MeshBasicMaterial({
    color: 0xf0c419,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly markerMat = new THREE.MeshBasicMaterial({ color: 0xff8c3a });
  private readonly markerObjMat = new THREE.MeshBasicMaterial({ color: 0x9a6bff });
  // Show the playtest player stand-in. Default OFF: the renderer force-shows
  // the self view every frame (sync's isSelf branch), so hiding it needs the
  // group DETACHED from the scene, enforced per frame in loop().
  private showPlayer = false;
  // Blender Shift+D grab: the fresh duplicates follow the cursor with no
  // button held until a left-click confirms (or the app cancels).
  private grabFollow = false;
  // Extra selection rings for the multi-selection members beyond the active
  // one (the renderer's gold ring marks the active).
  private multiSelGroup: THREE.Group | null = null;
  private multiSelIndices: number[] = [];
  private readonly multiSelMat = new THREE.MeshBasicMaterial({
    color: 0xffa640,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Live Sim mob selection: one bright ground ring per selected runtime id.
  private mobSelGroup: THREE.Group | null = null;
  private mobSelIds: number[] = [];
  private readonly mobSelMeshes = new Map<number, THREE.Mesh>();
  private npcSelGroup: THREE.Group | null = null;
  private npcSelKeys: string[] = [];
  private readonly npcSelMeshes = new Map<string, THREE.Mesh>();
  private readonly mobSelMat = new THREE.MeshBasicMaterial({
    color: 0x39e6ff,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  constructor(
    private readonly parent: HTMLElement,
    map: CustomMap,
    private readonly hooks: Editor3DHooks,
  ) {
    this.map = map;
    // A free camera has no protagonist to keep readable: no structure may
    // ghost to transparency under the maker's cursor. Playtest boots its own
    // page, so the game rule is never affected.
    setOccluderFadesDisabled(true);
    this.createSurfaces();
  }

  private createSurfaces(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'editor-3d-canvas';
    this.nameplates = document.createElement('div');
    this.nameplates.className = 'editor-3d-nameplates';
    this.axisWidget = document.createElement('div');
    this.axisWidget.className = 'editor-axis-widget';
    this.axisWidget.setAttribute('role', 'group');
    this.axisWidget.setAttribute('aria-label', t('editor.camera.axisWidget'));
    this.axisCore = document.createElement('div');
    this.axisCore.className = 'editor-axis-core';
    this.axisCore.setAttribute('aria-hidden', 'true');
    const coreMark = document.createElement('span');
    coreMark.className = 'editor-axis-core-mark';
    this.axisCore.appendChild(coreMark);
    this.axisWidgetParts.clear();
    const axes: readonly [CameraAxisView, string, string][] = [
      ['positiveX', 'X', t('editor.camera.snapPositiveX')],
      ['negativeX', '-X', t('editor.camera.snapNegativeX')],
      ['positiveY', 'Y', t('editor.camera.snapPositiveY')],
      ['negativeY', '-Y', t('editor.camera.snapNegativeY')],
      ['positiveZ', 'Z', t('editor.camera.snapPositiveZ')],
      ['negativeZ', '-Z', t('editor.camera.snapNegativeZ')],
    ];
    for (const [axis, label, title] of axes) {
      const arm = document.createElement('span');
      arm.className = `editor-axis-arm axis-${axis}`;
      arm.setAttribute('aria-hidden', 'true');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `editor-axis-button axis-${axis}`;
      button.textContent = label;
      button.dataset.axisLabel = label;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.addEventListener('click', () => this.cam.animateToAxis(axis));
      this.axisWidgetParts.set(axis, { arm, button });
      this.axisWidget.append(arm, button);
    }
    this.axisWidget.appendChild(this.axisCore);
    this.axisWidget.style.display = this.axisWidgetVisible ? '' : 'none';
    this.syncAxisWidget();
    this.parent.append(this.canvas, this.nameplates, this.axisWidget);
  }

  /** Rotate and depth-sort the view gimbal from the live orbit camera. */
  private syncAxisWidget(force = false): void {
    if (!this.axisWidget || !this.axisWidgetVisible) return;
    if (!force && this.cam.yaw === this.axisWidgetYaw && this.cam.pitch === this.axisWidgetPitch) {
      return;
    }
    this.axisWidgetYaw = this.cam.yaw;
    this.axisWidgetPitch = this.cam.pitch;
    const armLength = 31;
    const projections = projectCameraAxes(this.cam.yaw, this.cam.pitch, armLength);
    const current = dominantCameraPlane(projections);
    if (this.axisWidget.dataset.currentPlane !== current.plane) {
      this.axisWidget.dataset.currentPlane = current.plane;
    }
    if (this.axisWidget.dataset.currentAxis !== current.axis) {
      this.axisWidget.dataset.currentAxis = current.axis;
    }
    for (const projection of projections) {
      const part = this.axisWidgetParts.get(projection.axis);
      if (!part) continue;
      const length = Math.hypot(projection.x, projection.y);
      const angle = Math.atan2(projection.y, projection.x);
      const front = projection.depth >= 0;

      // One batched style mutation per element keeps the six-axis widget on
      // the compositor during camera movement. The previous property-by-
      // property path issued 36 DOM style writes every moving frame.
      part.arm.style.cssText =
        `opacity:${projection.opacity};z-index:${front ? 18 : 7};` +
        `transform:translateY(-50%) rotate(${angle}rad) scaleX(${length / armLength})`;
      part.button.style.cssText =
        `opacity:${projection.opacity};` +
        `z-index:${front ? 30 + Math.round(projection.depth * 8) : 10};` +
        `transform:translate(-50%, -50%) translate3d(${projection.x}px, ${projection.y}px, 0)`;
      part.button.classList.toggle('is-front', front);
      part.button.classList.toggle('is-view-axis', projection.projectedLength < 0.16);
      part.button.classList.toggle('is-current-plane', projection.axis === current.axis);
    }

    const markerX = Math.cos(this.cam.yaw) * 3;
    const markerY = Math.sin(this.cam.pitch) * 3;
    this.axisCore.style.cssText = `--axis-core-mark-x:${markerX}px;--axis-core-mark-y:${markerY}px`;
  }

  /**
   * Boot the engine over the ACTIVE world content (the app has already called
   * setActiveWorldContent with a content built from this.map).
   */
  async start(): Promise<void> {
    // Generation token against the double-start race: a reload()/dispose() that
    // lands while we await assets invalidates this run; the loser abandons
    // before building anything (nothing is half-built before the await).
    const gen = ++this.generation;
    if (!this.canvas.isConnected) this.createSurfaces();
    this.seed = this.map.meta.seed;
    const world = customMapToWorldContent(this.map);
    // The editor is its own host: world-content fetches sit parked in the
    // deferred lane until someone opens it (startGame does this for the game
    // client), and a Renderer built over an unopened lane throws "asset not
    // preloaded". Idempotent, so repeated start() calls are fine.
    beginDeferredPreloads();
    // Assets are the first ~30% of the curtain, the engine build the next 5,
    // and the zone under the opening camera the rest.
    this.hooks.onBuildProgress?.(0, 'assets');
    await assetsReady((done, total) =>
      this.hooks.onBuildProgress?.(Math.round((done / Math.max(1, total)) * 30), 'assets'),
    );
    if (this.disposed || gen !== this.generation) return;
    // The live PlacedAssetsView owns placements, so strip them from the Sim's
    // world or the Renderer ctor would build a second, frozen copy.
    this.sim = new Sim({
      seed: this.seed,
      playerClass: 'warrior',
      world: { ...world, placements: undefined },
    });
    this.authoredCampMobIds.clear();
    for (const entity of this.sim.entities.values()) {
      if (entity.kind === 'mob' && findRuntimeCampIndex(this.map.content.camps, entity) >= 0) {
        this.authoredCampMobIds.add(entity.id);
      }
    }
    // NPCs compose their authored looks exactly as in the game (main.ts
    // installs the same provider before ITS renderer): without this every
    // named NPC in the viewport wears a stock rig. The stand-in player keeps
    // the fixed class rig (null), same as a pre-creator character.
    setModularLookProvider((e) => (e.kind === 'player' ? null : npcEntityLookFor(e)));
    // The far-sprite mirrors for foliage placements are a GAME-host feature
    // (playtest/published boot derive them from content.placements): the
    // viewport deliberately skips them, they made every zone-stream engine
    // reload rebuild thousands of extra sprites and cost editor frame time
    // for a horizon a maker rarely studies. Clear any stale set so an editor
    // boot after a same-page game boot cannot inherit one.
    setFoliageFarPlacements([]);
    // Polite far-vista pacing: this construction happens against live editor
    // frames on every document load, never behind an opaque curtain, so the
    // eager macrotask build lane must stay off (see RendererCreateOptions).
    // The editor authors placements over a questless Sim, so the game's
    // quest-collectable view gate would hide every authored crate and sigil here.
    this.renderer = new Renderer(this.sim, this.canvas, this.nameplates, {
      eagerFarVista: false,
      editorClutter: true,
      showAllQuestObjects: true,
    });
    this.hooks.onBuildProgress?.(33, 'engine');
    // Per-asset sway opt-outs BEFORE the first template loads, so a stilled
    // asset never compiles the sway program in the first place.
    this.applyAssetSway();
    // Imported-model collision bakes feed the footprint view (baked boxes).
    this.renderer.placedAssets.setAssetCollision(this.resolvedAssetCollision());
    this.renderer.placedAssets.rebuildAll(this.renderPlacements(this.map.placements), true);
    // A fresh build reflects the whole document: drop any hidden-time debts
    // (before the spawn ring below, which must build even while hidden).
    this.clearHiddenWork();
    const start = this.map.playerStart ?? null;
    this.spawnPoint = start ? { x: start.x, z: start.z } : null;
    this.refreshSpawnRing();
    this.rebuildBlockers();
    this.refreshColliderVolumes();
    this.refreshAuthoredOverlays();
    if (this.lighting) this.renderer.editor.setEditorLighting(this.lighting);
    if (this.birdsCfg) this.renderer.editor.setBirdsConfig(this.birdsCfg);
    // Take world speed from the CURRENT document (reload() sets this.map before
    // start()), never a stale prior-map value: the renderer ctor already seeded
    // ambience from the active world's timeScale, so only override when non-1.
    this.worldSpeed = this.map.timeScale ?? 1;
    if (this.worldSpeed !== 1) this.renderer.editor.setAmbienceScale(this.worldSpeed);
    this.renderer.editor.setPlacedAssetViewDistance(this.assetViewDistance);
    this.renderer.editor.setEditorVisibility(this.visibilityProfile);
    // Zone isolate survives engine rebuilds (reload, Collision Master return):
    // the residency policy must be in force BEFORE the first zone prepares.
    // The hidden-group list is measured against the OLD scene, so drop it.
    this.renderer.editor.setZoneResidencyFilter(this.isolateRect);
    this.isolateHiddenGroups = null;
    if (this.skyboxUrl) this.renderer.editor.setEditorSkybox(this.skyboxUrl);
    // Studio mode + the CM mesh view survive renderer restarts (Collision
    // Master loads its scratch map through a full reload).
    this.applyStudio();
    if (this.cmMeshState) this.setCmMeshState(this.cmMeshState);
    this.gizmo = new TransformGizmo();
    this.renderer.scene.add(this.gizmo.group);
    // Shares the collider overlay material, already owned/prepared at boot.
    this.buildingPreview = new BuildingPreview(this.colliderMat);
    this.renderer.scene.add(this.buildingPreview.group);
    // Frame the world hub to start; a sized map also frames its whole extent
    // (small interior maps open close in, big open worlds pull back).
    // In isolate mode the opening build targets the isolated zone, not zone 0
    // (whose rect the residency filter may refuse outright).
    const hub = this.isolateRect
      ? {
          x: (this.isolateRect.minX + this.isolateRect.maxX) / 2,
          z: (this.isolateRect.minZ + this.isolateRect.maxZ) / 2,
        }
      : (this.map.content.zones[0]?.hub ?? { x: 0, z: 0 });
    this.cam.target.set(hub.x, terrainHeight(hub.x, hub.z, this.seed), hub.z);
    if (this.map.worldHalfX !== undefined) {
      const zones = this.map.content.zones;
      // Min/max over all zones: the list is not stacked south-to-north once
      // column zones exist (same trap as terrain.ts renderBounds).
      const zSpan =
        zones.length > 0
          ? Math.max(...zones.map((zn) => zn.zMax)) - Math.min(...zones.map((zn) => zn.zMin))
          : 0;
      const extent = Math.max(this.map.worldHalfX * 2, zSpan);
      const framingScale =
        this.map.presentationMode && this.map.presentationMode !== 'blank' ? 0.32 : 0.6;
      this.cam.dist = Math.min(500, Math.max(20, extent * framingScale));
    }
    // Build the zone under the opening camera through the foreground lane
    // while the editor loading overlay is still up. Previously the first loop
    // queued this as idle background work, so a busy tab could take tens of
    // seconds to reveal full-detail terrain and its painted textures.
    this.renderer.editorCam = this.cam.pose();
    this.renderer.editor.setEditorOrthographic(this.orthographic, this.orthographicViewHeight());
    this.hooks.onBuildProgress?.(35, 'zone');
    await this.renderer.prepareZoneAt(
      hub.x,
      hub.z,
      (done, total) =>
        this.hooks.onBuildProgress?.(35 + Math.round((done / Math.max(1, total)) * 65), 'zone'),
      { pace: 'fast' },
    );
    if (this.disposed || gen !== this.generation) return;
    this.hooks.onBuildProgress?.(100, 'zone');
    this.attachEvents();
    if (this.visible) {
      this.lastT = performance.now();
      this.loop();
    }
  }

  get ready(): boolean {
    return this.renderer !== null;
  }

  /** Update an authored NPC/camp in the live editor Sim without reloading WebGL. */
  moveMapEntity(key: string, from: { x: number; z: number }, to: { x: number; z: number }): number {
    if (!this.sim) return 0;
    return moveRuntimeMapEntity(
      this.sim.entities.values(),
      key,
      this.map.content.camps,
      from,
      to,
      (x, z) => terrainHeight(x, z, this.seed),
    );
  }

  /** Update an authored NPC's facing in the live editor Sim. */
  setMapNpcFacing(key: string, facing: number): number {
    if (!this.sim) return 0;
    return setRuntimeNpcFacing(this.sim.entities.values(), key, facing);
  }

  /** Apply authored NPC presentation to the live editor entity. */
  setMapNpcPresentation(
    key: string,
    change: { name?: string; visualKey?: string | null; authorVfx?: AuthorVfx | null },
  ): number {
    if (!this.sim || !key.startsWith('npc:')) return 0;
    const npcId = key.slice('npc:'.length);
    let changed = 0;
    for (const entity of this.sim.entities.values()) {
      if (entity.kind !== 'npc' || entity.templateId !== npcId) continue;
      if (change.name !== undefined) entity.name = change.name;
      if (change.visualKey !== undefined) entity.visualKey = change.visualKey ?? undefined;
      if (change.authorVfx !== undefined) {
        entity.authorVfx = change.authorVfx ? { ...change.authorVfx } : undefined;
      }
      changed++;
    }
    return changed;
  }

  /** Rebuild only authored camp mobs in the running Sim. Terrain and WebGL stay live. */
  syncMapCamps(): void {
    if (!this.sim) return;
    for (const id of this.authoredCampMobIds) this.sim.removeEntity(id);
    this.authoredCampMobIds.clear();
    const nextId = Math.max(0, ...this.sim.entities.keys()) + 1;
    const previews = buildCampPreviewEntities(this.map.content.camps, this.seed, nextId, (x, z) =>
      terrainHeight(x, z, this.seed),
    );
    for (const mob of previews) {
      this.sim.addEntity(mob);
      this.authoredCampMobIds.add(mob.id);
    }
  }

  addMapNpc(def: NpcDef): void {
    if (!this.sim) return;
    const nextId = Math.max(0, ...this.sim.entities.keys()) + 1;
    this.sim.addEntity(
      createNpc(nextId, def, {
        x: def.pos.x,
        y: terrainHeight(def.pos.x, def.pos.z, this.seed),
        z: def.pos.z,
      }),
    );
  }

  removeMapNpc(id: string): void {
    if (!this.sim) return;
    for (const entity of [...this.sim.entities.values()]) {
      if (entity.kind === 'npc' && entity.templateId === id) this.sim.removeEntity(entity.id);
    }
  }

  /** Pick the rendered wild mob under the cursor, rather than its camp handle. */
  pickRuntimeMob(
    clientX: number,
    clientY: number,
    directOnly = false,
  ): { id: number; mobId: string } | null {
    if (!this.renderer || !this.sim) return null;
    const rect = this.canvas.getBoundingClientRect();
    const id = this.renderer.picking.pick(clientX - rect.left, clientY - rect.top);
    const direct = id === null ? null : this.sim.entities.get(id);
    if (direct?.kind === 'mob' && direct.ownerId === null) {
      return { id: direct.id, mobId: direct.templateId };
    }
    if (directOnly) return null;

    // Models and click proxies can be tiny at editor zoom levels. Fall back to
    // the closest projected mob body, which also makes clicking its nameplate
    // select the mob users can see instead of the camp center underneath it.
    let nearest: { id: number; mobId: string } | null = null;
    let nearestPx = 48;
    for (const candidate of this.sim.entities.values()) {
      if (candidate.kind !== 'mob' || candidate.ownerId !== null) continue;
      const projected = new THREE.Vector3(
        candidate.pos.x,
        candidate.pos.y + 1.2,
        candidate.pos.z,
      ).project(this.renderer.camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const sx = rect.left + ((projected.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - projected.y) / 2) * rect.height;
      const distance = Math.hypot(clientX - sx, clientY - sy);
      if (distance < nearestPx) {
        nearestPx = distance;
        nearest = { id: candidate.id, mobId: candidate.templateId };
      }
    }
    return nearest;
  }

  /** Pick the rendered authored NPC under the cursor, as its `npc:` key.
   *  `directOnly` keeps just the exact GPU pick (used BEFORE the placement
   *  pick, so a pixel-precise body hit beats a placement's slack radius); the
   *  projected-body fallback, which also catches nameplates and tiny models
   *  at editor zoom, runs in the loose pass after placements miss. */
  pickRuntimeNpc(clientX: number, clientY: number, directOnly = false): string | null {
    if (!this.renderer || !this.sim) return null;
    const rect = this.canvas.getBoundingClientRect();
    const id = this.renderer.picking.pick(clientX - rect.left, clientY - rect.top);
    const direct = id === null ? null : this.sim.entities.get(id);
    if (direct?.kind === 'npc') return `npc:${direct.templateId}`;
    if (directOnly) return null;
    let nearestKey: string | null = null;
    let nearestPx = 48;
    for (const candidate of this.sim.entities.values()) {
      if (candidate.kind !== 'npc') continue;
      const projected = new THREE.Vector3(
        candidate.pos.x,
        candidate.pos.y + 1.2,
        candidate.pos.z,
      ).project(this.renderer.camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const sx = rect.left + ((projected.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - projected.y) / 2) * rect.height;
      const distance = Math.hypot(clientX - sx, clientY - sy);
      if (distance < nearestPx) {
        nearestPx = distance;
        nearestKey = `npc:${candidate.templateId}`;
      }
    }
    return nearestKey;
  }

  /** The live authored preview mob nearest a camp's centre. Camp SPLITS
   *  rebuild every authored mob with fresh entity ids (syncMapCamps), so the
   *  id that was clicked can be dead by the time a selection stores it, this
   *  re-resolves to whichever live mob now owns the (possibly just-split)
   *  camp. */
  liveMobIdNearCamp(
    mobId: string,
    center: { x: number; z: number },
    radius: number,
  ): number | null {
    if (!this.sim) return null;
    let best: number | null = null;
    let bestD = radius + 2;
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'mob' || e.ownerId !== null || e.templateId !== mobId) continue;
      const d = Math.hypot(e.spawnPos.x - center.x, e.spawnPos.z - center.z);
      if (d < bestD) {
        bestD = d;
        best = e.id;
      }
    }
    return best;
  }

  /** Resolve a live mob back to its authored camp and the camp's live members. */
  runtimeMobCamp(entityId: number): {
    campIndex: number;
    members: { id: number; x: number; z: number }[];
  } | null {
    if (!this.sim) return null;
    const mob = this.sim.entities.get(entityId);
    if (!mob || mob.kind !== 'mob' || mob.ownerId !== null) return null;
    const campIndex = findRuntimeCampIndex(this.map.content.camps, mob);
    const camp = this.map.content.camps[campIndex];
    if (!camp) return null;
    if (camp.count === 1) {
      return {
        campIndex,
        members: [{ id: mob.id, x: mob.pos.x, z: mob.pos.z }],
      };
    }
    const members = [...this.sim.entities.values()]
      .filter(
        (candidate) =>
          candidate.kind === 'mob' &&
          candidate.ownerId === null &&
          candidate.templateId === camp.mobId &&
          Math.hypot(candidate.spawnPos.x - camp.center.x, candidate.spawnPos.z - camp.center.z) <=
            camp.radius + 1,
      )
      .sort((a, b) => {
        const ad = Math.hypot(a.spawnPos.x - camp.center.x, a.spawnPos.z - camp.center.z);
        const bd = Math.hypot(b.spawnPos.x - camp.center.x, b.spawnPos.z - camp.center.z);
        return ad - bd || a.id - b.id;
      })
      .slice(0, camp.count)
      .map((candidate) => ({
        id: candidate.id,
        x: candidate.pos.x,
        z: candidate.pos.z,
      }));
    if (!members.some((member) => member.id === entityId)) {
      members[members.length - 1] = { id: mob.id, x: mob.pos.x, z: mob.pos.z };
    }
    return { campIndex, members };
  }

  /** Move only the explicitly selected live mobs; authored camps are owned by App. */
  moveRuntimeMobs(ids: ReadonlySet<number>, dx: number, dz: number): number {
    if (!this.sim || (dx === 0 && dz === 0)) return 0;
    return moveRuntimeMobsById(this.sim.entities.values(), ids, dx, dz, (x, z) =>
      terrainHeight(x, z, this.seed),
    );
  }

  // Terrain point under a cursor position (client coords). Analytic ray-march
  // first (cheap, per pointer-move); the renderer's full terrain-mesh raycast
  // only as a fallback when the march misses (horizon, camera under ground).
  // surfacePoint expects canvas-origin coordinates (the game canvas fills the
  // window; the editor canvas is offset by the top bar + tool rail), so convert.
  /** The drawn terrain mesh under the cursor (client coords), either face: the
   *  Mesh Fix tool's pick. Null when the ray meets no terrain triangle. */
  terrainMeshAt(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    if (!this.renderer) return null;
    const r = this.canvas.getBoundingClientRect();
    const p = this.renderer.editor.terrainMeshPoint(clientX - r.left, clientY - r.top);
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }

  surfaceAt(clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.renderer) return null;
    if (this.buildingPlane) {
      const hit = this.planeHit(clientX, clientY, this.buildingPlane);
      return hit ? { x: hit.x, z: hit.z } : null;
    }
    const marched = this.marchSurface(clientX, clientY);
    if (marched) return marched;
    // Inside a carve the terrain sheet is overhead and every surface solve
    // misses (the march bails under ground, the mesh raycast sees only the
    // sheet, the analytic solve has no downward crossing), so Select, Move
    // and Place went dead in the mines (SPACEY: "none of the assets in the
    // cave are editable"). The cave FLOOR is the surface there.
    const cave = this.cavityFloorHit(clientX, clientY);
    if (cave) return cave;
    const r = this.canvas.getBoundingClientRect();
    const p = this.renderer.editor.surfacePoint(clientX - r.left, clientY - r.top);
    if (p) return { x: p.x, z: p.z };
    // Final guaranteed fallback so editing lands ANYWHERE on the map, not only
    // in the built/near "starting area": the march covers the near region
    // precisely but caps its range (MARCH_MAX_T), and the renderer fallback
    // hits only built terrain chunks + a y=0 plane that misses near the
    // horizon, so a click over far/un-streamed ground would otherwise return
    // null and the tool would no-op. This analytically solves the pointer ray
    // against the terrain-height field for any downward ray.
    return this.analyticSurface(clientX, clientY);
  }

  /** The pointer ray against the cave FLOOR sheet (sim/ground_sheets.ts, the
   *  same sampler the player stands on), for a camera parked inside a carve.
   *  Coarse march to bracket the first drop under the floor, bisection to
   *  refine. Null above ground, on a map without carves, or when the ray
   *  never meets a floor in range: the callers then fall through to the
   *  ordinary surface solves. */
  private cavityFloorHit(clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.renderer) return null;
    const content = getActiveWorldContent();
    const cuts = content.holes;
    if (!cuts || cuts.length === 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    const o = this.picker.ray.origin;
    const d = this.picker.ray.direction;
    // only a camera under the ground is inside a carve
    if (o.y >= terrainHeight(o.x, o.z, this.seed)) return null;
    const floorAt = (x: number, z: number, y: number): number | null =>
      cavitySheetAt(cuts, content.holePatches, x, z, terrainHeight(x, z, this.seed), y)?.floor ??
      null;
    const step = 0.5;
    const maxT = 240;
    let prevT = 0;
    let prevAbove = false;
    for (let t = step; t <= maxT; t += step) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      const floor = floorAt(x, z, y);
      const above = floor !== null && y > floor;
      if (prevAbove && floor !== null && y <= floor) {
        let lo = prevT;
        let hi = t;
        for (let j = 0; j < 12; j++) {
          const mid = (lo + hi) / 2;
          const my = o.y + d.y * mid;
          const f = floorAt(o.x + d.x * mid, o.z + d.z * mid, my);
          if (f !== null && my <= f) hi = mid;
          else lo = mid;
        }
        const ft = (lo + hi) / 2;
        return { x: o.x + d.x * ft, z: o.z + d.z * ft };
      }
      prevAbove = above;
      prevT = t;
    }
    return null;
  }

  /** Fixed-point solve of the pointer ray against the terrain-height field:
   *  find t with `o.y + d.y*t == terrainHeight(o+d*t)`. terrainHeight is a pure
   *  function defined everywhere (flat 0 + stamps on authored/custom maps, the
   *  procedural field on the built-in world), so this returns a valid ground
   *  point for ANY downward ray, with no range cap, the far-editing fallback
   *  for surfaceAt. Flat authored/blank maps converge in ONE step; the DAMPED
   *  iteration widens convergence to gentle-to-moderate slopes. If it does NOT
   *  converge (a shallow ray raking a steep far ridge on the built-in world),
   *  it returns null rather than a garbage far point, the tool then no-ops
   *  there, exactly as before this fallback existed. */
  private analyticSurface(clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    const o = this.picker.ray.origin;
    const d = this.picker.ray.direction;
    if (d.y >= -1e-4) return null; // ray not aimed at the ground
    let t = (o.y - terrainHeight(o.x, o.z, this.seed)) / -d.y;
    let converged = false;
    for (let i = 0; i < 12; i++) {
      const x = o.x + d.x * t;
      const z = o.z + d.z * t;
      // Damped fixed-point (step halved) so slopes up to ~3x the ray's descent
      // still converge instead of oscillating.
      const target = (o.y - terrainHeight(x, z, this.seed)) / -d.y;
      const nt = t + 0.5 * (target - t);
      if (Math.abs(nt - t) < 0.02) {
        t = nt;
        converged = true;
        break;
      }
      t = nt;
    }
    if (!converged || !Number.isFinite(t) || t <= 0) return null;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }

  // March the pointer ray against terrainHeight (which the render mesh samples,
  // so the two agree): coarse fixed steps to bracket the first crossing, then a
  // bisection refine. Null when the ray never dips under the terrain in range.
  private marchSurface(clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    const o = this.picker.ray.origin;
    const d = this.picker.ray.direction;
    if (o.y - terrainHeight(o.x, o.z, this.seed) <= 0) return null; // under ground: fall back
    let prevT = 0;
    for (let i = 1; i <= MARCH_STEPS; i++) {
      const t = (i / MARCH_STEPS) * MARCH_MAX_T;
      const dy = o.y + d.y * t - terrainHeight(o.x + d.x * t, o.z + d.z * t, this.seed);
      if (dy <= 0) {
        let lo = prevT;
        let hi = t;
        for (let j = 0; j < MARCH_REFINE; j++) {
          const mid = (lo + hi) / 2;
          const below =
            o.y + d.y * mid - terrainHeight(o.x + d.x * mid, o.z + d.z * mid, this.seed) <= 0;
          if (below) hi = mid;
          else lo = mid;
        }
        const ft = (lo + hi) / 2;
        return { x: o.x + d.x * ft, z: o.z + d.z * ft };
      }
      prevT = t;
    }
    return null;
  }

  /** True while a pointer drag is navigating (fly keys are live), so the app
   *  suppresses single-key tool shortcuts. */
  isNavigating(): boolean {
    return this.dragMode === 'orbit' || this.dragMode === 'pan';
  }

  /** Current orbit yaw (radians); the app's screen-relative nudges read it. */
  cameraYaw(): number {
    return this.cam.yaw;
  }

  private orthographicViewHeight(): number {
    return 2 * this.cam.dist * Math.tan(THREE.MathUtils.degToRad(EDITOR_VERTICAL_FOV_DEG) / 2);
  }

  /** Blender-style lens toggle. Orbit/fly pose stays untouched; only projection
   *  and pointer rays switch, so returning to perspective is exactly reversible. */
  setOrthographic(on: boolean): void {
    this.orthographic = on;
    this.renderer?.editor.setEditorOrthographic(on, this.orthographicViewHeight());
  }

  /** Free-Fly camera mode (WASD/QE always live, drags mouse-look). */
  setFreeFly(on: boolean): void {
    this.freeFly = on;
    this.cam.flyDistIndependent = on;
    if (!on) this.keys.clear();
  }

  /** Invert the drag-pan direction (editor preference). */
  setInvertPan(on: boolean): void {
    this.cam.panInverted = on;
  }

  /** Per-user camera speed multipliers (Camera tab sliders). */
  setCameraSpeeds(speeds: { move: number; look: number; pan: number }): void {
    this.cam.moveSpeed = speeds.move;
    this.cam.lookSpeed = speeds.look;
    this.cam.panSpeedMul = speeds.pan;
  }

  /** Configure the viewport performance overlay (Camera tab). The overlay DOM
   *  is built the first time it is enabled and kept thereafter. */
  setPerfOverlay(cfg: PerfOverlayConfig): void {
    this.perfCfg = cfg;
    if (cfg.enabled && !this.perfOverlay) {
      this.perfOverlay = new EditorPerfOverlay(this.parent, {
        fps: t('editor.camera.perfFps'),
        frameMs: t('editor.camera.perfFrameMs'),
        assets: t('editor.camera.perfAssets'),
        tris: t('editor.camera.perfTris'),
        selTris: t('editor.camera.perfSelTris'),
        terrain: t('editor.camera.perfTerrain'),
        streaming: t('editor.camera.perfStreaming'),
        coords: t('editor.camera.perfCoords'),
      });
    }
    this.perfOverlay?.setConfig(cfg);
  }

  /** Editor lighting override; reapplied after every engine (re)build. */
  setLighting(profile: EditorLightingProfile | null): void {
    this.lighting = profile;
    this.renderer?.editor.setEditorLighting(profile);
  }

  refreshZoneAtmosphere(): void {
    this.renderer?.editor.refreshEditorAtmosphere();
  }

  setBirds(cfg: { enabled: boolean; count: number; formation: boolean } | null): void {
    this.birdsCfg = cfg;
    this.renderer?.editor.setBirdsConfig(cfg);
  }

  /** Map ambience speed (world speed); reapplied after every engine (re)build. */
  setWorldSpeed(scale: number): void {
    this.worldSpeed = scale;
    this.renderer?.editor.setAmbienceScale(scale);
  }

  /** Placed-asset view distance; reapplied after every engine (re)build. */
  setAssetViewDistance(distance: number): void {
    this.assetViewDistance = distance;
    this.renderer?.editor.setPlacedAssetViewDistance(distance);
  }

  /** Editor terrain visibility and loading-haze controls. */
  setVisibilityProfile(profile: { distance: number; haze: number }): void {
    this.visibilityProfile = { ...profile };
    this.renderer?.editor.setEditorVisibility(profile);
  }

  setSkybox(url: string | null): void {
    this.skyboxUrl = url;
    this.renderer?.editor.setEditorSkybox(url);
  }

  /** Map weather override (null = biome rule); reapplied on engine reload via
   *  the world content the renderer boots from. */
  setWeather(weather: MapWeather | null): void {
    this.renderer?.editor.setEditorWeather(weather);
  }

  /** Show/remove the playtest player model (the loop enforces it per frame). */
  setShowPlayer(on: boolean): void {
    this.showPlayer = on;
  }

  /** Blender Shift+D grab: fresh duplicates track the cursor (no button held)
   *  until a left-click confirms; the app commits via onPlacementDragEnd. */
  startGrabFollow(): void {
    this.grabFollow = true;
    this.canvas.style.cursor = 'grabbing';
  }

  get grabFollowing(): boolean {
    return this.grabFollow;
  }

  /** Stop following without the confirming click (Escape / tool switch). */
  cancelGrabFollow(): void {
    this.grabFollow = false;
    this.canvas.style.cursor = '';
  }

  /** The multi-selection members BEYOND the active one: each gets an orange
   *  ring (the renderer's gold ring marks the active). Rebuilt on any change
   *  (selection edits, group drags, terrain sculpts under a member). */
  setMultiSelection(indices: number[]): void {
    this.multiSelIndices = indices;
    this.refreshMultiSelection();
  }

  private refreshMultiSelection(): void {
    if (this.multiSelGroup) {
      this.renderer?.scene.remove(this.multiSelGroup);
      for (const child of this.multiSelGroup.children) {
        (child as THREE.Mesh).geometry.dispose();
      }
      this.multiSelGroup = null;
    }
    if (!this.renderer || this.multiSelIndices.length === 0) return;
    const group = new THREE.Group();
    group.name = 'editor-multi-selection';
    for (const i of this.multiSelIndices) {
      const p = this.map.placements[i];
      if (!p || !this.buildingPlacementIsVisible(p)) continue;
      const radius = Math.max(1, p.scale * 1.4);
      const geo = new THREE.RingGeometry(radius - 0.18, radius, 36);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.multiSelMat);
      mesh.position.set(p.x, terrainHeight(p.x, p.z, this.seed) + 0.12, p.z);
      mesh.renderOrder = 2;
      group.add(mesh);
    }
    this.multiSelGroup = group;
    this.renderer.scene.add(group);
  }

  /** Mark each selected live mob with a cyan ground ring. */
  setSelectedRuntimeMobs(ids: ReadonlySet<number>): void {
    this.mobSelIds = [...ids];
    if (this.mobSelGroup) {
      this.renderer?.scene.remove(this.mobSelGroup);
      for (const child of this.mobSelGroup.children) {
        (child as THREE.Mesh).geometry.dispose();
      }
    }
    this.mobSelGroup = null;
    this.mobSelMeshes.clear();
    if (!this.renderer || this.mobSelIds.length === 0) return;
    const group = new THREE.Group();
    group.name = 'editor-mob-selection';
    for (const id of this.mobSelIds) {
      const geometry = new THREE.RingGeometry(1.05, 1.35, 40);
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, this.mobSelMat);
      mesh.renderOrder = 3;
      group.add(mesh);
      this.mobSelMeshes.set(id, mesh);
    }
    this.mobSelGroup = group;
    this.renderer.scene.add(group);
    this.syncMobSelectionRings();
  }

  private syncMobSelectionRings(): void {
    if (!this.sim || this.mobSelMeshes.size === 0) return;
    for (const [id, mesh] of this.mobSelMeshes) {
      const mob = this.sim.entities.get(id);
      mesh.visible = mob?.kind === 'mob';
      if (!mob || mob.kind !== 'mob') continue;
      mesh.position.set(
        mob.pos.x,
        terrainHeight(mob.pos.x, mob.pos.z, this.seed) + 0.14,
        mob.pos.z,
      );
    }
  }

  /** Mark every Ctrl-selected authored NPC with the same cyan entity ring. */
  setSelectedRuntimeNpcs(keys: ReadonlySet<string>): void {
    this.npcSelKeys = [...keys];
    if (this.npcSelGroup) {
      this.renderer?.scene.remove(this.npcSelGroup);
      for (const child of this.npcSelGroup.children) {
        (child as THREE.Mesh).geometry.dispose();
      }
    }
    this.npcSelGroup = null;
    this.npcSelMeshes.clear();
    if (!this.renderer || this.npcSelKeys.length === 0) return;
    const group = new THREE.Group();
    group.name = 'editor-npc-selection';
    for (const key of this.npcSelKeys) {
      const geometry = new THREE.RingGeometry(1.05, 1.35, 40);
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, this.mobSelMat);
      mesh.renderOrder = 3;
      group.add(mesh);
      this.npcSelMeshes.set(key, mesh);
    }
    this.npcSelGroup = group;
    this.renderer.scene.add(group);
    this.syncNpcSelectionRings();
  }

  private syncNpcSelectionRings(): void {
    // The common editor state has no NPC selection. Avoid allocating a Map and
    // scanning every simulated entity every frame until rings actually exist.
    if (!this.sim || this.npcSelMeshes.size === 0) return;
    const positions = new Map<string, { x: number; z: number }>();
    for (const entity of this.sim.entities.values()) {
      if (entity.kind === 'npc') positions.set(`npc:${entity.templateId}`, entity.pos);
    }
    for (const [key, mesh] of this.npcSelMeshes) {
      const position = positions.get(key);
      mesh.visible = position !== undefined;
      if (!position) continue;
      mesh.position.set(
        position.x,
        terrainHeight(position.x, position.z, this.seed) + 0.14,
        position.z,
      );
    }
  }

  /**
   * Blender-style frame/focus: put the orbit pivot on the point of interest
   * and dolly to fit, so orbiting now revolves around it. `extent` is the
   * subject's rough half-size in yards.
   */
  focusOn(x: number, z: number, extent: number): void {
    const ground = terrainHeight(x, z, this.seed);
    this.cam.target.set(x, ground + Math.min(4, extent * 0.4), z);
    this.cam.dist = Math.min(500, Math.max(6, extent * 4));
  }

  /** Like focusOn but dollies in CLOSE (the Scene Collection pin): frames the
   *  subject tight instead of with headroom. `targetY` overrides the terrain seat
   *  so a detached/floating object is centred at its actual height. */
  focusClose(x: number, z: number, extent: number, targetY?: number): void {
    const base = targetY ?? terrainHeight(x, z, this.seed);
    this.cam.target.set(x, base + Math.min(4, extent * 0.4), z);
    this.cam.dist = Math.min(500, Math.max(3, extent * 1.8));
  }

  /** Ground-plane focus used by proximity-based editor actions. */
  cameraFocus(): { x: number; z: number } {
    return { x: this.cam.target.x, z: this.cam.target.z };
  }

  /** Physical camera ground position. Map UI uses this instead of the orbit
   *  pivot so its marker agrees with what is actually looking at the scene. */
  cameraPosition(): { x: number; z: number } {
    const pos = this.cam.pose().pos;
    return { x: pos.x, z: pos.z };
  }

  /** Move the physical editor camera to an exact map coordinate while keeping
   *  its current facing, zoom distance, and height above the local terrain. */
  teleportCamera(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.keys.clear();
    const current = this.cam.pose().pos;
    const clearance = Math.max(4, current.y - terrainHeight(current.x, current.z, this.seed));
    const cp = Math.cos(this.cam.pitch);
    const ground = terrainHeight(x, z, this.seed);
    this.cam.target.set(
      x + Math.sin(this.cam.yaw) * cp * this.cam.dist,
      ground + clearance - Math.sin(this.cam.pitch) * this.cam.dist,
      z + Math.cos(this.cam.yaw) * cp * this.cam.dist,
    );
    if (this.renderer) {
      this.renderer.editorCam = this.cam.pose();
      void this.renderer.prepareZoneAt(x, z, undefined, { pace: 'fast' });
    }
  }

  /** True when the viewport owns this key right now, so the app must not treat
   *  it as a tool shortcut: any key during a navigation drag, and the WASD/QE
   *  movement keys whenever Free-Fly is on. */
  capturesKey(key: string): boolean {
    return this.isNavigating() || (this.freeFly && key.length === 1 && 'wasdqe'.includes(key));
  }

  // ---- live edit application -----------------------------------------------

  /** Chunk-local terrain re-mesh over the edited region (cheap; per drag sample). */
  rebuildTerrainRegion(region: EditRegion): void {
    if (!this.visible) {
      this.hiddenTerrainRegion = unionRegion(this.hiddenTerrainRegion, region);
      return;
    }
    this.renderer?.editor.rebuildTerrain(region);
  }

  /** Drop and rebuild the procedural grass so a grass-clear brush edit shows
   *  immediately (no full engine reload). */
  rebuildGrass(): void {
    this.renderer?.editor.rebuildGrass();
  }

  /** Undo/clear of painted clutter: drop the layer's per-stamp cache so it
   *  re-scatters from the document on its next frame (a plain stroke needs no
   *  call: the layer watches the stamp array's identity). */
  rebuildClutter(): void {
    this.renderer?.editor.invalidateCityClutter();
  }

  /** Stroke-end work: macro-normal rebake + re-seat the region's placements and
   *  the spawn ring (region-scoped so a stroke never rescans every placement). */
  finishTerrainStroke(region: EditRegion): void {
    if (!this.visible) {
      this.hiddenTerrainRegion = unionRegion(this.hiddenTerrainRegion, region);
      return;
    }
    if (!this.renderer) return;
    this.renderer.editor.rebakeTerrainNormals(region);
    // The water's shore depth and dry-tile cull were baked from the old
    // ground: re-bake them under the stroke, or lowered ground shows seabed
    // (or the dark horizon apron) through a hole in the sea.
    this.renderer.editor.rebuildWater(region);
    this.renderer.placedAssets.reSeat(region);
    this.refreshSpawnRing();
    this.rebuildBlockers(); // walls sit on terrainHeight: re-seat after a sculpt
    this.refreshColliderVolumes(); // volumes too
    this.refreshMultiSelection();
  }

  /** Full terrain rebuild (map load / clear-all / undo of a large batch). */
  /** FORK: see Renderer.swapPaintLayers. False = a full rebuild is needed. */
  swapPaintLayers(): boolean {
    if (!this.visible || !this.renderer) return false;
    return this.renderer.editor.swapPaintLayers();
  }

  rebuildTerrainFull(): void {
    if (!this.visible) {
      this.hiddenTerrainFull = true;
      return;
    }
    if (!this.renderer) return;
    this.renderer.editor.rebuildTerrain();
    this.renderer.editor.rebuildWater();
    this.renderer.placedAssets.reSeat();
    this.refreshSpawnRing();
    this.rebuildBlockers();
    this.refreshColliderVolumes();
  }

  /** Re-seat the water surface at the ACTIVE waterLevel(). */
  rebuildWater(): void {
    if (!this.visible) {
      this.hiddenWater = true;
      return;
    }
    this.renderer?.editor.rebuildWater();
  }

  /** The terrain panel's "Re-apply water": dispose every water sheet and
   *  build them again from the CURRENT terrain, so sheets a zone skipped as
   *  dry when it loaded (a basin dug later) exist too. False = not shown. */
  reapplyWater(): boolean {
    if (!this.visible || !this.renderer) return false;
    this.renderer.editor.rebuildWaterBodies();
    return true;
  }

  /** Project the brush ring at world (x, z); pass per pointer-move. */
  setBrush(x: number, z: number, radius: number, color?: number): void {
    this.renderer?.editor.setEditorBrush(x, z, radius, color);
  }

  clearBrush(): void {
    this.renderer?.editor.clearEditorBrush();
  }

  // Placement passthroughs, keyed by the document index (the app keeps document
  // order and view slots in lockstep; bulk structural changes use
  // rebuildPlacements, a single doc removal uses the surgical placementRemoved).
  private buildingPlacementIsVisible(placement: AssetPlacement): boolean {
    const filter = this.buildingFloorFilter;
    return buildingPlacementVisible(
      placement.building,
      filter.id ?? undefined,
      filter.level,
      filter.hideAbove,
    );
  }

  private renderPlacements(
    placements: readonly AssetPlacement[],
    applyZone = true,
    firstIndex = 0,
  ): (PlacedAsset | null)[] {
    if (placements === this.map.placements) this.buildingFilteredIndices.clear();
    return placementsToRenderAssets(placements, {
      hideHidden: true,
      zoneRect: applyZone ? (this.isolateRect ?? undefined) : undefined,
      meshCollision: this.map.assetCollisionMesh,
    }).map((asset, index) => {
      const visible = this.buildingPlacementIsVisible(placements[index]);
      if (visible) this.buildingFilteredIndices.delete(firstIndex + index);
      else this.buildingFilteredIndices.add(firstIndex + index);
      return visible ? asset : null;
    });
  }

  /** Floor isolation belongs to the viewport, never to document hidden flags. */
  setBuildingFloorFilter(buildingId: string | null, level: number, hideAbove: boolean): void {
    const prior = this.buildingFloorFilter;
    if (prior.id === buildingId && prior.level === level && prior.hideAbove === hideAbove) return;
    this.buildingFloorFilter = { id: buildingId, level, hideAbove };
    this.rebuildPlacements();
    this.refreshMultiSelection();
    if (this.selectedIndex !== null) {
      const selected = this.map.placements[this.selectedIndex];
      if (!selected || !this.buildingPlacementIsVisible(selected)) this.setSelectedPlacement(null);
    }
  }

  placementAdded(index: number): void {
    this.tapCycle = null;
    this.placementPickCache = null;
    if (!this.visible) {
      this.hiddenPlacements = true;
      return;
    }
    const asset = this.renderPlacements([this.map.placements[index]], true, index)[0];
    if (asset) this.renderer?.placedAssets.addPlacement(index, asset);
    else if (this.buildingFilteredIndices.has(index))
      this.renderer?.placedAssets.removePlacement(index);
    this.updateColliderVolume(index);
    this.refreshFluidsIfNeeded(index);
  }

  placementUpdated(
    index: number,
    change: {
      x?: number;
      y?: number;
      z?: number;
      rotY?: number;
      scale?: number;
      collideRadius?: number;
      collideShape?: 'square' | null;
      rotX?: number;
      rotZ?: number;
      scaleX?: number;
      scaleY?: number;
      scaleZ?: number;
      detached?: boolean;
      groundY?: number;
      tint?: number | null;
      opacity?: number | null;
      glow?: number | null;
      glowStrength?: number | null;
      fire?: boolean | null;
      fireEffects?: readonly AssetFireEmitter[] | null;
      collideCustom?: boolean;
      hitboxes?: PlacedAsset['hitboxes'] | null;
    },
  ): void {
    this.placementPickCache = null;
    if (!this.visible) {
      this.hiddenPlacements = true;
      return;
    }
    const placement = this.map.placements[index];
    if (placement && !this.buildingPlacementIsVisible(placement)) {
      this.buildingFilteredIndices.add(index);
      this.renderer?.placedAssets.removePlacement(index);
    } else if (this.buildingFilteredIndices.has(index)) {
      this.placementAdded(index);
      return;
    } else {
      this.renderer?.placedAssets.updatePlacement(index, change);
    }
    this.updateColliderVolume(index);
    this.refreshFluidsIfNeeded(index);
  }

  /** Surgical single removal at a DOCUMENT index: the view drops that slot and
   *  shifts the survivors down by one, without re-cloning every model. */
  placementRemoved(index: number): void {
    this.tapCycle = null;
    this.placementPickCache = null;
    const shifted = [...this.buildingFilteredIndices]
      .filter((i) => i !== index)
      .map((i) => (i > index ? i - 1 : i));
    this.buildingFilteredIndices.clear();
    for (const i of shifted) this.buildingFilteredIndices.add(i);
    if (!this.visible) {
      this.hiddenPlacements = true;
      return;
    }
    this.renderer?.placedAssets.removePlacementAt(index);
    // Later collider indexes shifted down by one: rebuild the keyed overlay.
    this.refreshColliderVolumes();
  }

  /**
   * Push the document's per-asset wind-sway opt-outs (map.assetSway) at the
   * render layer and re-apply them to templates already standing, so toggling
   * sway on a selected asset lands on every placement of it immediately.
   */
  applyAssetSway(): void {
    setSwayDisabledAssets(
      Object.entries(this.map.assetSway ?? {})
        .filter(([, on]) => on === false)
        .map(([id]) => id),
    );
    this.renderer?.placedAssets.refreshSway();
  }

  /** Full re-instance (mid-list insert / paste / undo / bulk edits). */
  rebuildPlacements(): void {
    this.tapCycle = null;
    this.placementPickCache = null;
    if (!this.visible) {
      this.hiddenPlacements = true;
      return;
    }
    // Imported models may have (re)registered since the engine build: their
    // object URLs are fresh, so the path-keyed bake map must refresh with them.
    this.renderer?.placedAssets.setAssetCollision(this.resolvedAssetCollision());
    this.renderer?.placedAssets.rebuildAll(this.renderPlacements(this.map.placements));
    this.refreshColliderVolumes();
  }

  /**
   * Swap the editor document and its authored props while retaining the live
   * Renderer, terrain view, prepared-zone set, GPU context and camera. Used by
   * Collision Master so entering its tiny scratch scene does not throw away
   * the map chunks the maker was editing. Returns false while the engine is
   * still booting, allowing the caller to fall back to a normal reload.
   */
  switchDocumentPreservingTerrain(map: CustomMap): boolean {
    if (!this.renderer || !this.sim || this.disposed) return false;
    this.setBuildingPreview([]);
    if (this.buildingPlane || this.buildingFloorFilter.id) this.setCityGridOverlay(null, 1);
    this.buildingPlane = null;
    this.buildingFloorFilter = { id: null, level: 0, hideAbove: false };
    this.map = map;
    this.seed = map.meta.seed;
    this.tapCycle = null;
    this.placementPickCache = null;
    this.selectedIndex = null;
    this.fireEditState = null;
    this.multiSelIndices = [];
    this.spawnPoint = map.playerStart ? { x: map.playerStart.x, z: map.playerStart.z } : null;
    this.clearHiddenWork();
    this.renderer.placedAssets.setAssetCollision(this.resolvedAssetCollision());
    // Entering the Collision Master studio (this.studio, set before the swap)
    // PARKS the world's built models instead of disposing them; the return
    // swap (studio off) revives them by diff key, so leaving the studio no
    // longer re-materializes every nearby asset through the clone budget.
    this.renderer.placedAssets.rebuildAll(this.renderPlacements(map.placements, false), true);
    this.renderer.placedAssets.setSelected(null);
    this.refreshSpawnRing();
    this.rebuildBlockers();
    this.refreshColliderVolumes();
    this.refreshAuthoredOverlays();
    return true;
  }

  setSelectedPlacement(index: number | null): void {
    if (index !== null) {
      const placement = this.map.placements[index];
      if (placement && !this.buildingPlacementIsVisible(placement)) index = null;
    }
    const prev = this.selectedIndex;
    this.selectedIndex = index;
    // Collider overlay highlight tracks the selection by material swap.
    if (prev !== null) {
      const m = this.colliderMeshes.get(prev);
      if (m) m.material = this.colliderMat;
    }
    if (index !== null) {
      const m = this.colliderMeshes.get(index);
      if (m) m.material = this.colliderSelMat;
    }
    // A pending hidden structural rebuild means the view's slots are stale:
    // the flush reapplies this selection after its rebuildAll.
    if (!this.visible && this.hiddenPlacements) return;
    // Studio mode: the workbench asset stays logically selected (the gizmo
    // chain needs it) but never wears the selection ring, the CM mesh view
    // owns all highlighting there.
    this.renderer?.placedAssets.setSelected(this.studio ? null : index);
  }

  /** Inspector-selected fire source. Its transform gizmo reuses the viewport's
   *  existing stable screen-space handles and camera interaction contract. */
  setFireEmitterEdit(index: number | null, emitterIndex: number | null): void {
    this.fireEditState = index !== null && emitterIndex !== null ? { index, emitterIndex } : null;
  }

  /** The doc's imported-model bake map re-keyed by the RESOLVED render path
   *  (blob url for local imports, '/api/assets/...' for uploads): the
   *  footprint view looks boxes up by the placement's path, which never
   *  matches the doc's 'local/<sha>' / 'user/<sha>' id keys directly. The id
   *  keys are kept too, so a path that IS the id still resolves. */
  private resolvedAssetCollision(): Readonly<Record<string, readonly BakedCollisionBox[]>> | null {
    const src = this.map.assetCollision;
    if (!src || Object.keys(src).length === 0) return null;
    const out: Record<string, readonly BakedCollisionBox[]> = {};
    for (const [id, boxes] of Object.entries(src)) {
      out[id] = boxes;
      const path = localAssetUrl(id) ?? userAssetPath(id);
      if (path) out[path] = boxes;
    }
    return out;
  }

  /** Imported-model bake map changed (an import finished baking): refresh the
   *  footprint view's baked-box source. */
  setAssetCollisionOverrides(): void {
    this.renderer?.placedAssets.setAssetCollision(this.resolvedAssetCollision());
  }

  showFootprints(on: boolean): void {
    this.renderer?.placedAssets.showFootprints(on);
  }

  /**
   * World-space hit point on a placed asset's actual mesh under the cursor,
   * or null when the ray misses every model. Collision Master's poly-snap
   * brush samples the real surface through this.
   */
  modelHitAt(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    if (!this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    const hits = this.picker.intersectObjects(this.renderer.placedAssets.group.children, true);
    const hit = hits.find((h) => h.point);
    return hit ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : null;
  }

  /** The 3D point where the pointer ray strikes a carve interior or a cave
   *  tube mesh, the pick the volumetric Dig/Fill brushes stamp at. Null when
   *  the ray misses both (the caller falls back to the terrain surface). */
  carveHitAt(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    if (!this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    const targets: THREE.Object3D[] = [];
    const cavities = this.renderer.editor.carveCavityGroup;
    if (cavities) targets.push(cavities);
    const caves = this.renderer.editor.caveMeshGroup;
    if (caves) targets.push(caves);
    if (targets.length === 0) return null;
    const hits = this.picker.intersectObjects(targets, true);
    const hit = hits.find((h) => h.point);
    return hit ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : null;
  }

  /** Distance from the LAST pick ray's origin (the camera, set by carveHitAt)
   *  to a world point: lets a caller decide whether a cave hit sits in front
   *  of the ground point the same pointer resolved to. */
  pickRayDistanceTo(p: { x: number; y: number; z: number }): number {
    const o = this.picker.ray.origin;
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const dz = p.z - o.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Which placement a click lands on. The first result is always the nearest
   * actual model/collider geometry touched by the pointer ray; small nearby
   * props only participate after it in the rapid-click cycle. */
  pickPlacement(clientX: number, clientY: number): number | null {
    return this.pickPlacementCandidates(clientX, clientY)[0] ?? null;
  }

  /** Paint only a wall actually struck by the ray; nearby selection halos do not paint. */
  pickBuildingSurface(
    clientX: number,
    clientY: number,
  ): { index: number; side: 'front' | 'back' } | null {
    if (!this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    const candidate = this.renderer.placedAssets.pickCandidates(
      this.picker,
      rect.height,
      EDITOR_VERTICAL_FOV_DEG,
      this.orthographic ? this.orthographicViewHeight() : undefined,
      1,
    )[0];
    if (!candidate?.direct) return null;
    const placement = this.map.placements[candidate.index];
    if (!placement || !this.buildingPlacementIsVisible(placement)) return null;
    return {
      index: candidate.index,
      side: buildingSurfaceSide(placement, this.picker.ray.direction),
    };
  }

  /**
   * Every placement under/near the cursor as an ordered candidate list. Actual
   * rendered geometry hits lead front-to-back; then a tight screen-space halo
   * adds small neighboring assets front-to-back for repeated-click cycling.
   */
  private pickPlacementCandidates(clientX: number, clientY: number): number[] {
    if (!this.renderer) return [];
    const now = performance.now();
    const cached = this.placementPickCache;
    if (
      cached &&
      now - cached.at <= 350 &&
      Math.abs(clientX - cached.x) <= 3 &&
      Math.abs(clientY - cached.y) <= 3
    ) {
      return cached.candidates;
    }
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    const placed = this.renderer.placedAssets.pickCandidates(
      this.picker,
      rect.height,
      EDITOR_VERTICAL_FOV_DEG,
      this.orthographic ? this.orthographicViewHeight() : undefined,
      CYCLE_MAX_DEPTH,
    );
    const direct = placed.filter((candidate) => candidate.direct);
    // Collider overlays are authored geometry too. Merge them into the exact
    // hit band by ray distance so a visible wall/volume picks by identity.
    if (this.collidersGroup) {
      for (const hit of this.picker.intersectObjects(this.collidersGroup.children, false)) {
        for (const [index, mesh] of this.colliderMeshes) {
          if (mesh === hit.object) {
            direct.push({ index, distance: hit.distance, direct: true });
            break;
          }
        }
      }
    }
    direct.sort((a, b) => a.distance - b.distance || a.index - b.index);
    const ordered = [...direct, ...placed.filter((candidate) => !candidate.direct)];
    const candidates: number[] = [];
    const seen = new Set<number>();
    for (const candidate of ordered) {
      const placement = this.map.placements[candidate.index];
      if (seen.has(candidate.index) || !placement || !this.buildingPlacementIsVisible(placement))
        continue;
      seen.add(candidate.index);
      candidates.push(candidate.index);
      if (candidates.length >= CYCLE_MAX_DEPTH) break;
    }
    this.placementPickCache = { x: clientX, y: clientY, at: now, candidates };
    return candidates;
  }

  /**
   * A Select-mode tap resolved through the overlap cycle: the first tap picks the
   * front-most candidate under the cursor; each repeat tap near the SAME point
   * within CYCLE_WINDOW_MS advances to the next overlapping candidate (wrapping),
   * so stacked objects become reachable. Returns the chosen document index or null.
   */
  pickPlacementCycling(clientX: number, clientY: number): number | null {
    // Cap the rotation at the CYCLE_MAX_DEPTH closest: past that the cursor
    // wraps back to the front-most instead of digging into far scenery.
    const candidates = this.pickPlacementCandidates(clientX, clientY);
    if (candidates.length === 0) {
      this.tapCycle = null;
      return null;
    }
    const now = performance.now();
    const c = this.tapCycle;
    const sameSpot =
      c !== null &&
      Math.abs(clientX - c.x) <= CYCLE_SLOP_PX &&
      Math.abs(clientY - c.y) <= CYCLE_SLOP_PX;
    const inWindow = c !== null && now - c.at <= CYCLE_WINDOW_MS;
    if (c && sameSpot && inWindow) {
      // Preserve the original near-to-far order even if an async GLB finishes
      // loading between two rapid clicks. Drop removed entries and append any
      // newly visible neighbor without unexpectedly restarting at the front.
      const current = new Set(candidates);
      c.candidates = c.candidates.filter((index) => current.has(index));
      for (const index of candidates) if (!c.candidates.includes(index)) c.candidates.push(index);
      if (c.candidates.length === 0) {
        this.tapCycle = null;
        return null;
      }
      c.cursor = (c.cursor + 1) % c.candidates.length;
      c.at = now;
      c.x = clientX;
      c.y = clientY;
      return c.candidates[c.cursor];
    }
    this.tapCycle = { x: clientX, y: clientY, candidates, cursor: 0, at: now };
    return candidates[0];
  }

  /** Drop the click-cycle state (structural placement change shifts indices). */
  resetTapCycle(): void {
    this.tapCycle = null;
    this.placementPickCache = null;
  }

  // ---- spawn marker ----------------------------------------------------------

  setSpawnMarker(point: { x: number; z: number } | null): void {
    this.spawnPoint = point ? { x: point.x, z: point.z } : null;
    if (!this.visible) {
      this.hiddenSpawn = true;
      return;
    }
    this.refreshSpawnRing();
  }

  private refreshSpawnRing(): void {
    if (!this.renderer) return;
    if (this.spawnRing) {
      this.renderer.scene.remove(this.spawnRing);
      this.spawnRing.geometry.dispose();
      this.spawnRing = null;
    }
    if (!this.spawnPoint) return;
    const { x, z } = this.spawnPoint;
    const radius = 1.6;
    const geo = new THREE.RingGeometry(radius - 0.22, radius, SPAWN_RING_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(x + pos.getX(i), z + pos.getZ(i), this.seed) + 0.1);
    }
    geo.computeBoundingSphere();
    this.spawnRing = new THREE.Mesh(geo, this.spawnMat);
    this.spawnRing.position.set(x, 0, z);
    this.spawnRing.renderOrder = 2;
    this.renderer.scene.add(this.spawnRing);
  }

  // ---- blocker walls (editor-only overlay) -----------------------------------

  /** Rebuild the translucent wall boxes from this.map.blockers (any change:
   *  add, erase, undo/redo, map load). Disposes the previous geometries. */
  rebuildBlockers(): void {
    if (!this.visible) {
      this.hiddenBlockers = true;
      return;
    }
    if (!this.renderer) return;
    this.disposeBlockers();
    const blockers = this.map.blockers ?? [];
    if (blockers.length === 0) return;
    const group = new THREE.Group();
    group.name = 'editor-blockers';
    for (const b of blockers) {
      // The tall map-limit walls can be hidden (View setting); their collision
      // is untouched, this is overlay visibility only.
      if (!this.showBoundaryWalls && this.isBoundaryBlocker(b)) continue;
      group.add(this.blockerMesh(b, this.blockerMat));
    }
    this.blockersGroup = group;
    this.renderer.scene.add(group);
  }

  /** Rebuild the location/marker/light overlays from the document (editor-only). */
  refreshAuthoredOverlays(): void {
    if (!this.renderer) return;
    const scene = this.renderer.scene;
    const drop = (g: THREE.Group | null): null => {
      if (g) {
        scene.remove(g);
        g.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.geometry.dispose();
        });
      }
      return null;
    };
    this.locationsGroup = drop(this.locationsGroup);
    this.markersGroup = drop(this.markersGroup);
    this.musicGroup = drop(this.musicGroup);
    if (this.lightsGroup) {
      scene.remove(this.lightsGroup);
      this.lightsGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
        if ((o as THREE.PointLight).isLight) (o as THREE.PointLight).dispose();
        // Bulb sprites own their material (per-light tint); the texture is the
        // shared cached one and stays alive.
        if ((o as THREE.Sprite).isSprite) (o as THREE.Sprite).material.dispose();
      });
      this.lightsGroup = null;
    }
    if (this.decalsGroup) {
      scene.remove(this.decalsGroup);
      this.decalsGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose(); // ring geo; both ring materials are shared
      });
      this.decalsGroup = null;
    }
    if (this.soundsGroup) {
      scene.remove(this.soundsGroup);
      this.soundsGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose(); // sphere geo; the sphere material is shared
        if ((o as THREE.Sprite).isSprite) (o as THREE.Sprite).material.dispose();
      });
      this.soundsGroup = null;
    }
    const locs = this.map.locations ?? [];
    if (locs.length > 0) {
      const g = new THREE.Group();
      g.name = 'editor-locations';
      for (const l of locs) {
        const geo = new THREE.PlaneGeometry(l.maxX - l.minX, l.maxZ - l.minZ);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, this.locationMat);
        const cx = (l.minX + l.maxX) / 2;
        const cz = (l.minZ + l.maxZ) / 2;
        mesh.position.set(cx, terrainHeight(cx, cz, this.seed) + 0.25, cz);
        mesh.renderOrder = 2;
        g.add(mesh);
      }
      g.visible = !this.locationsUserHidden && !this.previewMode;
      this.locationsGroup = g;
      scene.add(g);
    }
    const musicAreas = this.musicPreviewOn ? (this.map.music?.areas ?? []) : [];
    if (musicAreas.length > 0) {
      const g = new THREE.Group();
      g.name = 'editor-music-areas';
      for (let i = 0; i < musicAreas.length; i++) {
        const a = musicAreas[i];
        const geo = new THREE.PlaneGeometry(a.maxX - a.minX, a.maxZ - a.minZ);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(
          geo,
          i === this.selectedMusicIndex ? this.musicSelMat : this.musicMat,
        );
        const cx = (a.minX + a.maxX) / 2;
        const cz = (a.minZ + a.maxZ) / 2;
        mesh.position.set(cx, terrainHeight(cx, cz, this.seed) + 0.2, cz);
        mesh.renderOrder = 2;
        g.add(mesh);
      }
      this.musicGroup = g;
      scene.add(g);
    }
    const markers = this.map.markers ?? [];
    if (markers.length > 0) {
      const g = new THREE.Group();
      g.name = 'editor-markers';
      for (const m of markers) {
        const geo = new THREE.ConeGeometry(0.5, 1.6, 8);
        const mesh = new THREE.Mesh(geo, m.kind === 'object' ? this.markerObjMat : this.markerMat);
        mesh.position.set(m.x, terrainHeight(m.x, m.z, this.seed) + 0.8, m.z);
        mesh.renderOrder = 2;
        g.add(mesh);
      }
      this.markersGroup = g;
      scene.add(g);
    }
    const lights = this.map.lights ?? [];
    const livePointLights: THREE.PointLight[] = [];
    if (lights.length > 0) {
      const g = new THREE.Group();
      g.name = 'editor-map-lights';
      for (let i = 0; i < lights.length; i++) {
        const l = lights[i];
        const y = terrainHeight(l.x, l.z, this.seed) + l.y;
        // The LIVE lights shine so authored lighting is visible while editing
        // with any tool (and in Preview mode), exactly like in-game - which
        // includes the game's POINT-LIGHT BUDGET: the renderer keeps the
        // nearest GFX.maxPointLights lit and rests the others (see
        // Renderer.setEditorMapLights). Lighting a whole city's lamps at once
        // costs every lit material in the scene, and shows a look no player
        // will ever get.
        const pl = new THREE.PointLight(l.color, l.intensity, l.range, 1.8);
        pl.position.set(l.x, y, l.z);
        g.add(pl);
        livePointLights.push(pl);
        // Always-visible bulb badge: a camera-facing sprite so map lights are
        // findable (and clickable) from any angle and any tool.
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.bulbSpriteTexture(),
            color: l.color,
            transparent: true,
            depthWrite: false,
          }),
        );
        sprite.position.set(l.x, y, l.z);
        const selected = i === this.selectedLightIndex;
        sprite.scale.setScalar(selected ? 1.6 : 1.1);
        sprite.renderOrder = 3;
        sprite.userData.lightIndex = i;
        g.add(sprite);
        if (selected) {
          // Ground ring showing the light's RANGE, so power edits read spatially.
          const ring = new THREE.RingGeometry(Math.max(0.5, l.range - 0.25), l.range, 48);
          ring.rotateX(-Math.PI / 2);
          const mesh = new THREE.Mesh(ring, this.multiSelMat);
          mesh.position.set(l.x, terrainHeight(l.x, l.z, this.seed) + 0.15, l.z);
          mesh.renderOrder = 2;
          g.add(mesh);
        }
      }
      this.lightsGroup = g;
      scene.add(g);
    }
    // Always, including the empty case: this releases the lights of the group
    // we just rebuilt out of the budget rank.
    this.renderer.editor.setEditorMapLights(livePointLights);
    const sounds = this.map.pointSounds ?? [];
    if (sounds.length > 0) {
      const g = new THREE.Group();
      g.name = 'editor-point-sounds';
      for (let i = 0; i < sounds.length; i++) {
        const snd = sounds[i];
        const y = terrainHeight(snd.x, snd.z, this.seed) + snd.y;
        // Always-visible speaker badge: a camera-facing sprite so emitters are
        // findable (and clickable) from any angle and any tool.
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.soundSpriteTexture(),
            color: 0x6ad0ff,
            transparent: true,
            depthWrite: false,
          }),
        );
        sprite.position.set(snd.x, y, snd.z);
        const selected = i === this.selectedSoundIndex;
        sprite.scale.setScalar(selected ? 1.7 : 1.2);
        sprite.renderOrder = 3;
        sprite.userData.soundIndex = i;
        g.add(sprite);
        // The falloff box: the selected node always, and every node faintly
        // while the Sound tool is active, so radius edits read spatially. A cube
        // spanning +/- radius (a cheap stand-in for the spherical audio falloff).
        if (selected || this.soundPreviewOn) {
          const side = Math.max(1, snd.radius) * 2;
          const box = new THREE.Mesh(
            new THREE.BoxGeometry(side, side, side),
            selected ? this.soundBoxSelMat : this.soundBoxMat,
          );
          box.position.set(snd.x, y, snd.z);
          box.renderOrder = 1;
          g.add(box);
        }
      }
      g.visible = !this.previewMode;
      this.soundsGroup = g;
      scene.add(g);
    }
    // Ground decals: hand the renderer the LIVE document list (like fluids), so
    // an edit shows without a terrain rebuild, then draw the authoring rings.
    const decals = this.map.decals ?? [];
    this.renderer.editor.rebuildDecals(decals);
    if (decals.length > 0 && (this.decalOverlayOn || this.selectedDecalIndex !== null)) {
      const g = new THREE.Group();
      g.name = 'editor-decals';
      for (let i = 0; i < decals.length; i++) {
        const selected = i === this.selectedDecalIndex;
        if (!selected && !this.decalOverlayOn) continue;
        const d = decals[i];
        // A flat ring on the ground at the stamp's footprint: enough to find
        // and click a decal whose art is faint, without hiding the art.
        const rx = Math.max(0.25, d.size / 2);
        const rz = Math.max(0.25, (d.size * (d.aspect ?? 1)) / 2);
        const geo = new THREE.RingGeometry(0.94, 1, 32);
        geo.rotateX(-Math.PI / 2);
        const ring = new THREE.Mesh(geo, selected ? this.decalRingSelMat : this.decalRingMat);
        ring.scale.set(rx, 1, rz);
        ring.rotation.y = d.rot;
        ring.position.set(d.x, terrainHeight(d.x, d.z, this.seed) + 0.12, d.z);
        ring.renderOrder = 3;
        ring.userData.decalIndex = i;
        g.add(ring);
      }
      g.visible = !this.previewMode;
      this.decalsGroup = g;
      scene.add(g);
    }
    // The studio keeps its void clean: no hub/graveyard rings, location
    // boxes, music/sound markers, or spawn ring around the workbench asset.
    if (this.studio) {
      for (const g of [
        this.locationsGroup,
        this.markersGroup,
        this.musicGroup,
        this.soundsGroup,
        this.lightsGroup,
        this.decalsGroup,
        this.spawnRing,
      ]) {
        if (g) g.visible = false;
      }
    }
  }

  /** Shared white lightbulb sprite texture, tinted per light via material color. */
  private bulbSpriteTexture(): THREE.CanvasTexture {
    if (this.bulbTexture) return this.bulbTexture;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 64, 64);
      // Soft halo so the badge reads at range.
      const halo = ctx.createRadialGradient(32, 26, 4, 32, 26, 26);
      halo.addColorStop(0, 'rgba(255,255,255,0.65)');
      halo.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, 64, 64);
      // Glass.
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(32, 26, 13, 0, Math.PI * 2);
      ctx.fill();
      // Neck + screw base.
      ctx.fillRect(26, 37, 12, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(27, 43, 10, 3);
      ctx.fillRect(28, 47, 8, 3);
      // Filament hint (transparent cut so the tint shows through darker).
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(27, 30);
      ctx.lineTo(30, 25);
      ctx.lineTo(34, 29);
      ctx.lineTo(37, 24);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    this.bulbTexture = new THREE.CanvasTexture(c);
    this.bulbTexture.colorSpace = THREE.SRGBColorSpace;
    return this.bulbTexture;
  }

  /**
   * The map-light index under a click, or null. Picked by SCREEN distance to
   * the projected bulb badge, not a sprite raycast: the sprite's hit quad is
   * ~1yd in world units, which collapses to a few pixels once the camera zooms
   * out while the drawn halo stays large - clicks on the visible bulb missed.
   * Nearest badge within LIGHT_PICK_PX always wins instead.
   */
  pickMapLight(clientX: number, clientY: number): number | null {
    if (!this.renderer) return null;
    const lights = this.map.lights ?? [];
    if (lights.length === 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    let best: number | null = null;
    let bestD2 = LIGHT_PICK_PX * LIGHT_PICK_PX;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      v.set(l.x, terrainHeight(l.x, l.z, this.seed) + l.y, l.z);
      v.project(this.renderer.camera);
      if (v.z > 1 || v.z < -1) continue; // behind the camera / past far plane
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((-v.y + 1) / 2) * rect.height;
      const dx = sx - clientX;
      const dy = sy - clientY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }

  /** Editor selection of a map light (bulb enlarges + range ring shows). */
  setSelectedLight(index: number | null): void {
    if (this.selectedLightIndex === index) return;
    this.selectedLightIndex = index;
    this.refreshAuthoredOverlays();
  }

  /** Music-tool preview: the area rects draw only while the tool is active. */
  setMusicPreview(on: boolean): void {
    if (this.musicPreviewOn === on) return;
    this.musicPreviewOn = on;
    this.refreshAuthoredOverlays();
  }

  /** Shared speaker-badge sprite texture for point sounds (tinted via material). */
  private soundSpriteTexture(): THREE.CanvasTexture {
    if (this.soundTexture) return this.soundTexture;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 64, 64);
      const halo = ctx.createRadialGradient(32, 32, 4, 32, 32, 28);
      halo.addColorStop(0, 'rgba(255,255,255,0.6)');
      halo.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, 64, 64);
      // Speaker cone (box + trapezoid).
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.moveTo(16, 26);
      ctx.lineTo(26, 26);
      ctx.lineTo(36, 16);
      ctx.lineTo(36, 48);
      ctx.lineTo(26, 38);
      ctx.lineTo(16, 38);
      ctx.closePath();
      ctx.fill();
      // Two sound-wave arcs.
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(38, 32, 8, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(38, 32, 15, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
    }
    this.soundTexture = new THREE.CanvasTexture(c);
    this.soundTexture.colorSpace = THREE.SRGBColorSpace;
    return this.soundTexture;
  }

  /** The map point-sound index under a click, or null: nearest projected badge
   *  within LIGHT_PICK_PX, mirroring pickMapLight. */
  pickMapSound(clientX: number, clientY: number): number | null {
    if (!this.renderer) return null;
    const sounds = this.map.pointSounds ?? [];
    if (sounds.length === 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    let best: number | null = null;
    let bestD2 = LIGHT_PICK_PX * LIGHT_PICK_PX;
    for (let i = 0; i < sounds.length; i++) {
      const s = sounds[i];
      v.set(s.x, terrainHeight(s.x, s.z, this.seed) + s.y, s.z);
      v.project(this.renderer.camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((-v.y + 1) / 2) * rect.height;
      const dx = sx - clientX;
      const dy = sy - clientY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }

  /**
   * The authored decal nearest the cursor, by SCREEN distance to its centre
   * (not a raycast): decal meshes are streamed by range, so a raycast would
   * silently fail to pick one whose art has not loaded yet. Within the stamp's
   * own on-screen radius, or the flat badge radius for a tiny one.
   */
  pickMapDecal(clientX: number, clientY: number): number | null {
    if (!this.renderer) return null;
    const decals = this.map.decals ?? [];
    if (decals.length === 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    const c = new THREE.Vector3();
    const edge = new THREE.Vector3();
    let best: number | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < decals.length; i++) {
      const d = decals[i];
      const y = terrainHeight(d.x, d.z, this.seed);
      c.set(d.x, y, d.z);
      c.project(this.renderer.camera);
      if (c.z > 1 || c.z < -1) continue;
      const sx = rect.left + ((c.x + 1) / 2) * rect.width;
      const sy = rect.top + ((-c.y + 1) / 2) * rect.height;
      // Project a footprint edge point too, so the pick radius tracks how big
      // the stamp actually looks from here.
      edge.set(d.x + d.size / 2, y, d.z);
      edge.project(this.renderer.camera);
      const ex = rect.left + ((edge.x + 1) / 2) * rect.width;
      const ey = rect.top + ((-edge.y + 1) / 2) * rect.height;
      const radius = Math.max(LIGHT_PICK_PX, Math.hypot(ex - sx, ey - sy));
      const d2 = (sx - clientX) ** 2 + (sy - clientY) ** 2;
      // Smaller stamps win ties, so a mark inside a big circle stays clickable.
      if (d2 <= radius * radius && d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }

  /** Editor selection of a ground decal (its footprint ring brightens). */
  setSelectedDecal(index: number | null): void {
    if (this.selectedDecalIndex === index) return;
    this.selectedDecalIndex = index;
    this.refreshAuthoredOverlays();
  }

  /** Show every stamp's footprint ring (on while the Decal tool is active). */
  setDecalOverlay(on: boolean): void {
    if (this.decalOverlayOn === on) return;
    this.decalOverlayOn = on;
    this.refreshAuthoredOverlays();
  }

  /** Editor selection of a point sound (badge enlarges + falloff sphere shows). */
  setSelectedSound(index: number | null): void {
    if (this.selectedSoundIndex === index) return;
    this.selectedSoundIndex = index;
    this.refreshAuthoredOverlays();
  }

  /** Sound-tool preview: every falloff sphere draws faintly while active. */
  setSoundPreview(on: boolean): void {
    if (this.soundPreviewOn === on) return;
    this.soundPreviewOn = on;
    this.refreshAuthoredOverlays();
  }

  /** Editor selection of a music area (rect brightens; null clears). */
  setSelectedMusicArea(index: number | null): void {
    if (this.selectedMusicIndex === index) return;
    this.selectedMusicIndex = index;
    this.refreshAuthoredOverlays();
  }

  /** Live drag preview for the Zone tool's naming box (null clears). */
  setZonePreview(rect: { minX: number; minZ: number; maxX: number; maxZ: number } | null): void {
    if (!this.renderer) return;
    if (this.zonePreviewMesh) {
      this.renderer.scene.remove(this.zonePreviewMesh);
      this.zonePreviewMesh.geometry.dispose();
      this.zonePreviewMesh = null;
    }
    if (!rect || rect.maxX - rect.minX < 0.2 || rect.maxZ - rect.minZ < 0.2) return;
    const geo = new THREE.PlaneGeometry(rect.maxX - rect.minX, rect.maxZ - rect.minZ);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.zonePreviewMat);
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    mesh.position.set(cx, terrainHeight(cx, cz, this.seed) + 0.3, cz);
    mesh.renderOrder = 2;
    this.renderer.scene.add(mesh);
    this.zonePreviewMesh = mesh;
  }

  // -------------------------------------------------------------------------
  // City Build previews: the cursor ghost (delegated to PlacedAssetsView) and
  // the in-progress wall/road polyline guide.
  // -------------------------------------------------------------------------

  setCityGhostAsset(path: string | null): void {
    this.renderer?.placedAssets.setGhostAsset(path);
  }

  updateCityGhost(
    x: number,
    z: number,
    rotY: number,
    scale: number,
    blocked: boolean,
    groundY?: number,
  ): void {
    this.renderer?.placedAssets.updateGhost(x, z, rotY, scale, blocked, groundY);
  }

  hideCityGhost(): void {
    this.renderer?.placedAssets.hideGhost();
  }

  async cityAssetFootprint(
    path: string,
  ): Promise<{ sizeX: number; sizeZ: number; sizeY: number } | null> {
    return (await this.renderer?.placedAssets.assetFootprint(path)) ?? null;
  }

  setBuildingPlane(y: number | null): void {
    if (y !== null && this.buildingPlane?.constant === -y) return;
    this.buildingPlane =
      y !== null && Number.isFinite(y) ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -y) : null;
  }

  setBuildingPreview(
    placements: readonly AssetPlacement[],
    footprintFor?: BuildingFootprintLookup,
  ): void {
    this.buildingPreview?.update(
      placements,
      (x, z) => terrainHeight(x, z, this.seed),
      footprintFor,
    );
    if (this.buildingPreview) this.buildingPreview.group.visible = !this.previewMode;
  }

  /**
   * Terrain-draped snap grid for wall authoring. The pure layout bounds line
   * count and moves in chunks, so pointer motion only rebuilds occasionally.
   */
  setCityGridOverlay(
    center: { x: number; z: number } | null,
    gridSize: number,
    fixedY?: number,
  ): void {
    const layout = center ? cityGridLayout(center, gridSize) : null;
    if (!layout || !this.renderer) {
      if (this.cityGridGroup) {
        this.renderer?.scene.remove(this.cityGridGroup);
        this.cityGridGroup.traverse((object) => {
          const line = object as THREE.LineSegments;
          if (line.isLineSegments) {
            line.geometry.dispose();
            const material = line.material as THREE.Material;
            material.dispose();
          }
        });
      }
      this.cityGridGroup = null;
      this.cityGridKey = '';
      return;
    }
    const planeY = fixedY !== undefined && Number.isFinite(fixedY) ? fixedY : undefined;
    const key = [
      gridSize,
      layout.minX,
      layout.maxX,
      layout.minZ,
      layout.maxZ,
      planeY ?? 'terrain',
    ].join(':');
    if (this.cityGridGroup && key === this.cityGridKey) {
      this.cityGridGroup.visible = !this.previewMode;
      return;
    }
    if (this.cityGridGroup) {
      this.renderer.scene.remove(this.cityGridGroup);
      this.cityGridGroup.traverse((object) => {
        const line = object as THREE.LineSegments;
        if (line.isLineSegments) {
          line.geometry.dispose();
          const material = line.material as THREE.Material;
          material.dispose();
        }
      });
    }
    const minor: THREE.Vector3[] = [];
    const major: THREE.Vector3[] = [];
    const lift = 0.22;
    const sampleStep = 2;
    const addStrip = (
      axis: 'x' | 'z',
      fixed: number,
      from: number,
      to: number,
      target: THREE.Vector3[],
    ): void => {
      const steps = planeY === undefined ? Math.max(1, Math.ceil((to - from) / sampleStep)) : 1;
      for (let i = 0; i < steps; i++) {
        const a = from + ((to - from) * i) / steps;
        const b = from + ((to - from) * (i + 1)) / steps;
        const ax = axis === 'x' ? fixed : a;
        const az = axis === 'x' ? a : fixed;
        const bx = axis === 'x' ? fixed : b;
        const bz = axis === 'x' ? b : fixed;
        target.push(
          new THREE.Vector3(ax, (planeY ?? terrainHeight(ax, az, this.seed)) + lift, az),
          new THREE.Vector3(bx, (planeY ?? terrainHeight(bx, bz, this.seed)) + lift, bz),
        );
      }
    };
    for (const x of layout.xLines) {
      const target = Math.abs(Math.round(x / gridSize)) % layout.majorEvery === 0 ? major : minor;
      addStrip('x', x, layout.minZ, layout.maxZ, target);
    }
    for (const z of layout.zLines) {
      const target = Math.abs(Math.round(z / gridSize)) % layout.majorEvery === 0 ? major : minor;
      addStrip('z', z, layout.minX, layout.maxX, target);
    }
    const group = new THREE.Group();
    group.name = 'editor-city-grid';
    const addLines = (points: THREE.Vector3[], color: number, opacity: number): void => {
      if (points.length === 0) return;
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        userData: { noWireframe: true },
      });
      const lines = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        material,
      );
      lines.renderOrder = 2;
      group.add(lines);
    };
    addLines(minor, 0x66a9d8, 0.32);
    addLines(major, 0xf3c96b, 0.58);
    group.visible = !this.previewMode;
    this.renderer.scene.add(group);
    this.cityGridGroup = group;
    this.cityGridKey = key;
  }

  /**
   * Draw (or clear, with null/empty) the polyline being authored by the City
   * Build wall or road subtool: a dot per point and a terrain-draped line,
   * with the last point optionally rubber-banded to the cursor.
   */
  setCityPathPreview(points: readonly { x: number; z: number }[] | null, color = 0xf3c96b): void {
    if (this.cityPathGroup) {
      this.renderer?.scene.remove(this.cityPathGroup);
      this.cityPathGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh || (o as unknown as THREE.Line).isLine) m.geometry?.dispose();
        const mat = m.material as THREE.Material | undefined;
        if (mat) mat.dispose();
      });
      this.cityPathGroup = null;
    }
    if (!points || points.length === 0 || !this.renderer) return;
    const g = new THREE.Group();
    g.name = 'editor-city-path';
    const lift = 0.5;
    const dotGeo = new THREE.SphereGeometry(0.45, 10, 8);
    const dotMat = new THREE.MeshBasicMaterial({
      color,
      depthWrite: false,
      userData: { noWireframe: true },
    });
    for (const p of points) {
      const dot = new THREE.Mesh(dotGeo.clone(), dotMat.clone());
      dot.position.set(p.x, terrainHeight(p.x, p.z, this.seed) + lift, p.z);
      dot.renderOrder = 3;
      g.add(dot);
    }
    dotGeo.dispose();
    dotMat.dispose();
    if (points.length >= 2) {
      // Subdivide each edge so the guide hugs terrain instead of tunneling.
      const verts: THREE.Vector3[] = [];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.ceil(len / 2));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          verts.push(new THREE.Vector3(x, terrainHeight(x, z, this.seed) + lift, z));
        }
      }
      const lineMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        userData: { noWireframe: true },
      });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(verts), lineMat);
      line.renderOrder = 3;
      g.add(line);
    }
    this.renderer.scene.add(g);
    this.cityPathGroup = g;
  }

  /**
   * A -> B flow guides for every cave while the Caves tool is active: a
   * line along the tube's floor, a GREEN sphere at the entrance (the first
   * node you laid) and a RED arrow cone at the exit. Pass null to hide.
   */
  setCaveGuides(
    caves: readonly CaveDef[] | null,
    rigs?: readonly { points: readonly { x: number; y: number; z: number }[] }[],
  ): void {
    if (this.caveGuidesGroup) {
      this.renderer?.scene.remove(this.caveGuidesGroup);
      this.caveGuidesGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh || (o as THREE.Line).isLine) m.geometry?.dispose();
      });
      this.caveGuidesGroup = null;
    }
    if ((!caves || caves.length === 0) && (!rigs || rigs.length === 0)) return;
    if (!this.renderer) return;
    const g = new THREE.Group();
    g.name = 'editor-cave-guides';
    // The rig itself: a BLUE sphere per control point and a dotted connector,
    // so the planned path is visible and movable before Generate. Point ys
    // arrive ABSOLUTE (the markers are anchored; terrain plays no part).
    for (const rig of rigs ?? []) {
      if (rig.points.length === 0) continue;
      const lift = 1.2;
      const pts = rig.points.map((p) => new THREE.Vector3(p.x, p.y + lift, p.z));
      for (const v of pts) {
        const dot = new THREE.Mesh(caveRigPointGeo, caveRigPointMat);
        dot.position.copy(v);
        dot.renderOrder = 3;
        g.add(dot);
      }
      if (pts.length >= 2) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), caveRigLineMat);
        // Dashed materials render SOLID until line distances exist.
        line.computeLineDistances();
        line.renderOrder = 3;
        g.add(line);
      }
    }
    for (const cave of caves ?? []) {
      if (cave.nodes.length < 2) continue;
      const lift = 1.4;
      const pts = cave.nodes.map((n) => new THREE.Vector3(n.x, n.y + lift, n.z));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), caveGuideLineMat);
      g.add(line);
      const a = cave.nodes[0];
      const entrance = new THREE.Mesh(caveGuideSphereGeo, caveGuideEntranceMat);
      entrance.position.set(a.x, a.y + lift, a.z);
      g.add(entrance);
      const b = cave.nodes[cave.nodes.length - 1];
      const prev = cave.nodes[cave.nodes.length - 2];
      const exit = new THREE.Mesh(caveGuideConeGeo, caveGuideExitMat);
      exit.position.set(b.x, b.y + lift, b.z);
      const dir = new THREE.Vector3(b.x - prev.x, 0, b.z - prev.z);
      if (dir.lengthSq() > 1e-6) {
        exit.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      }
      g.add(exit);
    }
    this.renderer.scene.add(g);
    this.caveGuidesGroup = g;
  }

  /**
   * The Cut/Carve tool's PENDING solid: a translucent blue ghost of the shape
   * the next Cut will remove, standing at its authored spot so the maker can
   * drag it around and resize it before committing. Pass null to hide.
   */
  setCutGhost(cut: TerrainHole | null): void {
    if (this.cutGhostGroup) {
      this.renderer?.scene.remove(this.cutGhostGroup);
      this.cutGhostGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry?.dispose();
      });
      this.cutGhostGroup = null;
    }
    this.cutGhostCut = cut;
    if (!cut || !this.renderer) return;
    const g = new THREE.Group();
    g.name = 'editor-cut-ghost';
    const r = Math.max(0.1, cut.radius);
    let geo: THREE.BufferGeometry;
    let scaleY = 1;
    // FORK: the ghost is MARCHED from the cut's own field, so undulation,
    // taper, wobble, bend and arch preview exactly what the cut removes.
    const marched = cut.shape === 'tube' ? null : this.marchCutGhost(cut);
    if (marched) {
      const mesh = new THREE.Mesh(marched, cutGhostMat);
      mesh.renderOrder = 3;
      g.add(mesh);
      const wire = new THREE.Mesh(marched, cutGhostWireMat);
      wire.renderOrder = 4;
      g.add(wire);
      this.renderer.scene.add(g);
      this.cutGhostGroup = g;
      return;
    }
    if (cut.shape === 'box') {
      geo = new THREE.BoxGeometry((cut.halfX ?? r) * 2, (cut.halfY ?? r) * 2, (cut.halfZ ?? r) * 2);
    } else if (cut.shape === 'capsule') {
      // Capsule runs along local X (the cut's own convention); vert squashes
      // or stretches the cross-section vertically.
      geo = new THREE.CapsuleGeometry(r, (cut.len ?? 0) * 2, 6, 20);
      geo.rotateZ(Math.PI / 2);
      scaleY = Math.max(0.1, cut.vert ?? 1);
    } else {
      geo = new THREE.SphereGeometry(r, 28, 20);
    }
    const mesh = new THREE.Mesh(geo, cutGhostMat);
    mesh.scale.setY(scaleY);
    mesh.quaternion.setFromEuler(new THREE.Euler(cut.rotX ?? 0, cut.rotY ?? 0, 0, 'YXZ'));
    mesh.position.set(cut.x, cut.y, cut.z);
    mesh.renderOrder = 3;
    g.add(mesh);
    const wire = new THREE.Mesh(geo, cutGhostWireMat);
    wire.scale.copy(mesh.scale);
    wire.quaternion.copy(mesh.quaternion);
    wire.position.copy(mesh.position);
    wire.renderOrder = 4;
    g.add(wire);
    this.renderer.scene.add(g);
    this.cutGhostGroup = g;
  }

  /** FORK: march one cut's signed field into a world-space ghost mesh (no
   *  terrain clip: the maker sees the whole solid, above and below ground).
   *  Cell follows the radius, capped so a huge ball never stalls the frame. */
  private marchCutGhost(cut: TerrainHole): THREE.BufferGeometry | null {
    const b = cutBounds(cut);
    const v = cutVerticalBounds(cut);
    const pad = 0.5;
    const ex = b.maxX - b.minX + pad * 2;
    const ey = v.maxY - v.minY + pad * 2;
    const ez = b.maxZ - b.minZ + pad * 2;
    // Long or huge cuts march coarser rather than truncating: the ghost is a
    // preview, the committed cavity meshes at its own budget.
    let cell = Math.max(0.35, Math.min(1.25, cut.radius / 8));
    while ((ex / cell) * (ey / cell) * (ez / cell) > 420_000 && cell < 6) cell *= 1.25;
    const nx = Math.max(1, Math.ceil(ex / cell));
    const ny = Math.max(1, Math.ceil(ey / cell));
    const nz = Math.max(1, Math.ceil(ez / cell));
    const arrays = buildCavityMesh({
      x0: b.minX - pad,
      y0: v.minY - pad,
      z0: b.minZ - pad,
      cell,
      nx,
      ny,
      nz,
      fieldAt: (x, y, z) => cutSdfAt(cut, x, y, z),
      heightAt: () => 1e9,
    });
    if (!arrays || arrays.indices.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  /** Hole-tool guides: a cyan ring traced around every terrain-hole cutout
   *  and a green ring around every patch sphere (visible while the Caves
   *  tool is up). Pass null to hide. */
  setHoleGuides(
    holes: readonly TerrainHole[] | null,
    patches?: readonly TerrainHole[] | null,
  ): void {
    if (this.holeGuidesGroup) {
      this.renderer?.scene.remove(this.holeGuidesGroup);
      this.holeGuidesGroup.traverse((o) => {
        if ((o as THREE.Line).isLine) (o as THREE.Line).geometry?.dispose();
      });
      this.holeGuidesGroup = null;
    }
    const holeCount = holes?.length ?? 0;
    const patchCount = patches?.length ?? 0;
    if ((holeCount === 0 && patchCount === 0) || !this.renderer) return;
    const g = new THREE.Group();
    g.name = 'editor-hole-guides';
    const SEGS = 40;
    const addRing = (h: TerrainHole, mat: THREE.LineBasicMaterial): void => {
      // Trace the sphere's intersection with the terrain: sample the surface
      // around the rim so the ring hugs slopes instead of floating.
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= SEGS; i++) {
        const a = (i / SEGS) * Math.PI * 2;
        const x = h.x + Math.cos(a) * h.radius;
        const z = h.z + Math.sin(a) * h.radius;
        pts.push(new THREE.Vector3(x, terrainHeight(x, z, this.seed) + 0.25, z));
      }
      const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      ring.renderOrder = 3;
      g.add(ring);
    };
    for (const h of holes ?? []) addRing(h, holeGuideMat);
    for (const p of patches ?? []) addRing(p, holePatchGuideMat);
    this.renderer.scene.add(g);
    this.holeGuidesGroup = g;
  }

  /** World yards per screen pixel at a ground point in the active projection: the
   *  Grab sculpt brush converts vertical cursor drags into height deltas. */
  worldPerPixel(x: number, z: number): number {
    if (!this.renderer) return 0.1;
    const cam = this.renderer.camera;
    const h = Math.max(1, this.canvas.clientHeight);
    if (this.orthographic) return this.orthographicViewHeight() / h;
    const dist = cam.position.distanceTo(this.wppV.set(x, terrainHeight(x, z, this.seed), z));
    return (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * dist) / h;
  }

  private wppV = new THREE.Vector3();

  /** The camera's view-plane basis in world space (unit right/up): the Grab
   *  sculpt maps cursor drags onto this plane so the pulled ground follows
   *  the drag direction in 3D ? sideways slides the grabbed bump across the
   *  map, up/down on screen pulls it out of / into the ground. */
  viewPlaneAxes(): {
    right: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
  } | null {
    if (!this.renderer) return null;
    const e = this.renderer.camera.matrixWorld.elements;
    return {
      right: { x: e[0], y: e[1], z: e[2] },
      up: { x: e[4], y: e[5], z: e[6] },
    };
  }

  /** Rock-tool chain guides: blue spheres + dotted connector along every
   *  rig's laid points (the cave rig look). Pass null to hide. */
  setRockChainGuide(
    rigs: readonly { points: readonly { x: number; z: number; dy?: number }[] }[] | null,
  ): void {
    if (this.rockChainGroup) {
      this.renderer?.scene.remove(this.rockChainGroup);
      this.rockChainGroup.traverse((o) => {
        if ((o as THREE.Line).isLine) (o as THREE.Line).geometry?.dispose();
      });
      this.rockChainGroup = null;
    }
    if (!rigs || rigs.length === 0 || !this.renderer) return;
    const g = new THREE.Group();
    g.name = 'editor-rock-chain';
    const lift = 1.2;
    for (const rig of rigs) {
      if (rig.points.length === 0) continue;
      const pts = rig.points.map(
        (p) => new THREE.Vector3(p.x, terrainHeight(p.x, p.z, this.seed) + (p.dy ?? 0) + lift, p.z),
      );
      for (const v of pts) {
        const dot = new THREE.Mesh(caveRigPointGeo, caveRigPointMat);
        dot.position.copy(v);
        dot.renderOrder = 3;
        g.add(dot);
      }
      if (pts.length >= 2) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), caveRigLineMat);
        line.computeLineDistances();
        line.renderOrder = 3;
        g.add(line);
      }
    }
    this.renderer.scene.add(g);
    this.rockChainGroup = g;
  }

  /** Show/hide the residency perimeter guide (the streamed rect's edges). */
  setResidencyGuide(on: boolean): void {
    if (this.guideOn === on) return;
    this.guideOn = on;
    this.rebuildResidencyGuide();
  }

  /** The rect the guide traces; null while the whole map is resident. */
  setResidencyGuideRect(
    rect: { minX: number; maxX: number; minZ: number; maxZ: number } | null,
  ): void {
    this.guideRect = rect ? { ...rect } : null;
    this.rebuildResidencyGuide();
  }

  /** Four upright translucent panels on the rect's edges. Cheap enough to
   *  rebuild on every residency change: four planes, no depth write, so the
   *  world reads through them and nothing z-fights. */
  private rebuildResidencyGuide(): void {
    if (!this.renderer) return;
    if (this.guideGroup) {
      this.renderer.scene.remove(this.guideGroup);
      this.guideGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      this.guideGroup = null;
    }
    const rect = this.guideRect;
    if (!this.guideOn || !rect) return;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff6b6b,
      transparent: true,
      // Read as a boundary through fog and bright ground alike, without
      // hiding what is behind it: this is a guide, not a curtain.
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // The strip's whole vertical range with headroom: the guide is a boundary
    // marker, not a box around the terrain, so it must not stop at a hilltop.
    const yLo = -40;
    const yHi = 120;
    const h = yHi - yLo;
    const yMid = (yLo + yHi) / 2;
    const group = new THREE.Group();
    group.name = 'editor-residency-guide';
    const wall = (cx: number, cz: number, width: number, rotY: number): void => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, h), mat);
      mesh.position.set(cx, yMid, cz);
      mesh.rotation.y = rotY;
      mesh.renderOrder = 3;
      group.add(mesh);
    };
    const w = rect.maxX - rect.minX;
    const d = rect.maxZ - rect.minZ;
    const midX = (rect.minX + rect.maxX) / 2;
    const midZ = (rect.minZ + rect.maxZ) / 2;
    wall(midX, rect.minZ, w, 0);
    wall(midX, rect.maxZ, w, 0);
    wall(rect.minX, midZ, d, Math.PI / 2);
    wall(rect.maxX, midZ, d, Math.PI / 2);
    this.guideGroup = group;
    this.renderer.scene.add(group);
  }

  setShowBoundaryWalls(on: boolean): void {
    if (this.showBoundaryWalls === on) return;
    this.showBoundaryWalls = on;
    this.rebuildBlockers();
  }

  /** Wireframe render mode: draw the map's raw polygons with no textures. The
   *  per-frame apply (in loop()) does the material work so newly added/rebuilt
   *  meshes are covered automatically. */
  setWireframe(on: boolean): void {
    this.wireframe = on;
  }

  /** Transparent map-geometry mode. Selection chrome and editor overlays stay
   *  opaque and visible through the modeled/terrain surface. */
  setXray(on: boolean): void {
    this.xray = on;
  }

  /**
   * Mesh Fix vertex dots: `positions` is a flat xyz triple per lattice node,
   * `selected` one byte per node (1 = in the selection, drawn yellow). Pass
   * null to clear.
   *
   * Square by construction, a PointsMaterial with no map rasterises the
   * gl_PointCoord square, which is exactly the handle SPACEY asked for, and
   * `sizeAttenuation: false` keeps it the same few pixels whether the camera
   * is on the cave floor or up on the cliff. depthTest is off so a node behind
   * the terrain skin is still visible and clickable, which is the whole point
   * when the polys being tidied are the ones in the way.
   */
  setVertexDots(positions: Float32Array | null, selected: Uint8Array | null): void {
    if (!this.renderer) return;
    if (!positions || positions.length === 0) {
      if (this.vertexDots) {
        this.renderer.scene.remove(this.vertexDots);
        this.vertexDotGeo?.dispose();
        this.vertexDotGeo = null;
        this.vertexDots = null;
      }
      return;
    }
    const n = positions.length / 3;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const on = selected ? selected[i] === 1 : false;
      // yellow selected, cool grey otherwise
      colors[i * 3] = on ? 1.0 : 0.62;
      colors[i * 3 + 1] = on ? 0.86 : 0.68;
      colors[i * 3 + 2] = on ? 0.1 : 0.74;
    }
    if (!this.vertexDotMat) {
      this.vertexDotMat = new THREE.PointsMaterial({
        size: 6,
        sizeAttenuation: false,
        vertexColors: true,
        depthTest: false,
        depthWrite: false,
        transparent: false,
      });
      this.vertexDotMat.userData.noWireframe = true;
    }
    if (this.vertexDots && this.vertexDotGeo) {
      const pos = this.vertexDotGeo.getAttribute('position') as THREE.BufferAttribute;
      if (pos.count === n) {
        (pos.array as Float32Array).set(positions);
        pos.needsUpdate = true;
        const col = this.vertexDotGeo.getAttribute('color') as THREE.BufferAttribute;
        (col.array as Float32Array).set(colors);
        col.needsUpdate = true;
        return;
      }
      this.renderer.scene.remove(this.vertexDots);
      this.vertexDotGeo.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const pts = new THREE.Points(geo, this.vertexDotMat);
    pts.name = 'editor-vertex-dots';
    pts.frustumCulled = false;
    pts.renderOrder = 999;
    this.vertexDotGeo = geo;
    this.vertexDots = pts;
    this.renderer.scene.add(pts);
  }

  /** World point -> client pixel, or null when it is behind the camera. The
   *  vertex tool projects its own dots for rubber-band selection. */
  projectPoint(x: number, y: number, z: number): { x: number; y: number } | null {
    if (!this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3(x, y, z).project(this.renderer.camera);
    if (v.z > 1 || v.z < -1) return null;
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((-v.y + 1) / 2) * rect.height,
    };
  }

  /** Toggle material.wireframe on every MAP-geometry mesh (terrain/water/foliage/
   *  fish/props), leaving editor overlays untouched. Run each frame while on, and
   *  once after turning off to restore shared/cached materials to solid. */
  private applyWireframe(): void {
    if (!this.renderer) return;
    const on = this.wireframe;
    this.renderer.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // renderCategory sits on the GROUP, not the leaf mesh: walk ancestors.
      let node: THREE.Object3D | null = o;
      let belongs = false;
      while (node) {
        const cat = node.userData?.renderCategory;
        if (typeof cat === 'string' && WIREFRAME_MAP_CATEGORIES.has(cat)) {
          belongs = true;
          break;
        }
        node = node.parent;
      }
      if (!belongs) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        // Editor overlays parented under a map-geometry group (the selection ring
        // + footprint rings live under the props group) opt out of wireframe.
        if (!m || m.userData?.noWireframe) continue;
        if ('wireframe' in m) (m as THREE.Material & { wireframe: boolean }).wireframe = on;
      }
    });
  }

  /** Apply or restore transparent X-ray state on map geometry. Material state
   *  is captured once per material because terrain/props share cached mats. */
  private applyXray(): void {
    if (!this.renderer) return;
    if (!this.xray) {
      for (const [m, state] of this.xrayMaterialState) {
        m.transparent = state.transparent;
        m.opacity = state.opacity;
        m.depthWrite = state.depthWrite;
        m.depthTest = state.depthTest;
        m.needsUpdate = true;
      }
      this.xrayMaterialState.clear();
      return;
    }
    this.renderer.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let node: THREE.Object3D | null = o;
      let belongs = false;
      while (node) {
        const cat = node.userData?.renderCategory;
        if (typeof cat === 'string' && WIREFRAME_MAP_CATEGORIES.has(cat)) {
          belongs = true;
          break;
        }
        node = node.parent;
      }
      if (!belongs) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m || m.userData?.noXray) continue;
        if (!this.xrayMaterialState.has(m)) {
          this.xrayMaterialState.set(m, {
            transparent: m.transparent,
            opacity: m.opacity,
            depthWrite: m.depthWrite,
            depthTest: m.depthTest,
          });
        }
        const state = this.xrayMaterialState.get(m);
        if (!state) continue;
        m.transparent = true;
        m.opacity = Math.min(state.opacity, 0.24);
        m.depthWrite = false;
        m.depthTest = true;
        m.needsUpdate = true;
      }
    });
  }

  /** Live drag preview of the wall being drawn (null clears it). */
  setBlockerPreview(seg: BlockerDef | null): void {
    if (!this.renderer) return;
    if (this.blockerPreviewMesh) {
      this.renderer.scene.remove(this.blockerPreviewMesh);
      this.blockerPreviewMesh.geometry.dispose();
      this.blockerPreviewMesh = null;
    }
    if (!seg) return;
    this.blockerPreviewMesh = this.blockerMesh(seg, this.blockerPreviewMat);
    this.renderer.scene.add(this.blockerPreviewMesh);
  }

  /** A blocker running along the map's world rect is a boundary wall. */
  private isBoundaryBlocker(b: BlockerDef): boolean {
    const { halfW, zMin, zMax } = mapBounds(this.map);
    const eps = 0.5;
    const onX = (v: number): boolean => Math.abs(b.x1 - v) < eps && Math.abs(b.x2 - v) < eps;
    const onZ = (v: number): boolean => Math.abs(b.z1 - v) < eps && Math.abs(b.z2 - v) < eps;
    return onX(halfW) || onX(-halfW) || onZ(zMin) || onZ(zMax);
  }

  // One box per segment: fence-thick, seated on the terrain at the midpoint,
  // yawed with the same convention the sim's OBB collider uses. Boundary
  // segments draw full map-limit height.
  private blockerMesh(b: BlockerDef, mat: THREE.Material): THREE.Mesh {
    const dx = b.x2 - b.x1;
    const dz = b.z2 - b.z1;
    const len = Math.max(0.1, Math.hypot(dx, dz));
    const height = this.isBoundaryBlocker(b) ? BOUNDARY_OVERLAY_HEIGHT : BLOCKER_OVERLAY_HEIGHT;
    const geo = new THREE.BoxGeometry(len, height, FENCE_HALF_DEPTH * 2);
    const mesh = new THREE.Mesh(geo, mat);
    const x = (b.x1 + b.x2) / 2;
    const z = (b.z1 + b.z2) / 2;
    mesh.position.set(x, terrainHeight(x, z, this.seed) + height / 2, z);
    mesh.rotation.y = Math.atan2(-dz, dx);
    mesh.renderOrder = 2;
    return mesh;
  }

  private disposeBlockers(): void {
    if (this.blockersGroup) {
      this.renderer?.scene.remove(this.blockersGroup);
      for (const child of this.blockersGroup.children) {
        (child as THREE.Mesh).geometry.dispose();
      }
      this.blockersGroup = null;
    }
  }

  // ---- hitbox edit overlay -----------------------------------------------------

  /** Feed (or clear) the hitbox-edit overlay: the edited placement's boxes as
   *  pickable translucent volumes, selected ones highlighted. */
  setHitboxEdit(
    state: { index: number; boxes: readonly MapHitbox[]; selected: number[] } | null,
  ): void {
    this.hitboxEditState = state;
    this.rebuildHitboxOverlay();
    this.refreshHitboxHandles();
  }

  /** Collision Master sub-element mode: vertex/edge/face handles on the
   *  selected hitbox; null = object mode (the plain transform gizmo). */
  setHitboxSubMode(mode: HitboxSubMode | null): void {
    this.hitboxSubMode = mode;
    this.refreshHitboxHandles();
  }

  /** Rebuild the sub-element handle set from the current edit state. The
   *  handles assume the Collision Master scene frame (placement at the
   *  origin, scale 1, yaw 0), the only context sub modes are enabled in. */
  private refreshHitboxHandles(): void {
    const st = this.hitboxEditState;
    const mode = this.hitboxSubMode;
    if (!st || !mode || !this.renderer) {
      this.hitboxHandles?.setTarget(null, 0, null);
      this.handleBoxIndex = -1;
      return;
    }
    if (!this.hitboxHandles) this.hitboxHandles = new HitboxHandles();
    if (this.hitboxHandles.group.parent !== this.renderer.scene) {
      this.renderer.scene.add(this.hitboxHandles.group);
    }
    const p = this.map.placements[st.index];
    if (!p) {
      this.hitboxHandles.setTarget(null, 0, null);
      this.handleBoxIndex = -1;
      return;
    }
    // The edited box: the last selected, or the only box when nothing is.
    const boxIndex =
      st.selected.length > 0 ? st.selected[st.selected.length - 1] : st.boxes.length === 1 ? 0 : -1;
    const box = boxIndex >= 0 ? st.boxes[boxIndex] : null;
    const ground = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.seed);
    this.hitboxHandles.setTarget(box ? { ...box } : null, ground + (p.y ?? 0), mode);
    this.handleBoxIndex = boxIndex;
  }

  private rebuildHitboxOverlay(): void {
    if (this.hitboxGroup) {
      this.renderer?.scene.remove(this.hitboxGroup);
      this.hitboxGroup = null;
    }
    const st = this.hitboxEditState;
    if (!st || !this.renderer) return;
    const p = this.map.placements[st.index];
    if (!p) return;
    const group = new THREE.Group();
    group.name = 'editor-hitbox-edit';
    const ground = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.seed);
    group.position.set(p.x, ground + (p.y ?? 0), p.z);
    // Tilted placements: the edit boxes lean with the model like the sim does.
    group.rotation.set(p.rotX ?? 0, p.rotY, p.rotZ ?? 0);
    const s = p.scale > 0 ? p.scale : 1;
    const sx = s * (p.scaleX ?? 1);
    const sy = s * (p.scaleY ?? 1);
    const sz = s * (p.scaleZ ?? 1);
    const selected = new Set(st.selected);
    for (let i = 0; i < st.boxes.length; i++) {
      const b = st.boxes[i];
      const sel = selected.has(i);
      const mesh = new THREE.Mesh(hitboxUnitGeo, sel ? this.hitboxSelMat : this.hitboxMat);
      mesh.position.set(b.x * sx, b.y * sy, b.z * sz);
      // A YAWED box under a NON-UNIFORM placement scale has to be measured
      // THROUGH its own rotation, exactly as the sim does (colliders.ts
      // emitPlacementBoxes). three.js applies a mesh's scale in its own local
      // frame and only then its rotation, i.e. R(ry)·S, but the box is part
      // of the model, so the real transform is S·R(ry): the model's per-axis
      // stretch acts on the ALREADY-rotated box. Drawing it the other way
      // round skews the outline off the collider it is meant to depict, and
      // every promoted building carries a non-uniform fit scale.
      const bry = b.ry ?? 0;
      const bc = Math.cos(bry);
      const bs = Math.sin(bry);
      const hw = bry !== 0 ? b.hx * Math.hypot(bc * sx, bs * sz) : b.hx * sx;
      const hd = bry !== 0 ? b.hz * Math.hypot(bs * sx, bc * sz) : b.hz * sz;
      mesh.scale.set(Math.max(0.02, hw * 2), Math.max(0.02, b.hy * 2 * sy), Math.max(0.02, hd * 2));
      if (bry) mesh.rotation.y = bry;
      mesh.renderOrder = 4;
      mesh.userData.hitboxIndex = i;
      const edges = new THREE.LineSegments(hitboxUnitEdges, sel ? hitboxEdgeSelMat : hitboxEdgeMat);
      edges.renderOrder = 5;
      mesh.add(edges);
      group.add(mesh);
    }
    group.visible = !this.previewMode;
    this.hitboxGroup = group;
    this.renderer.scene.add(group);
    // Picking can run before the next render frame: bake the matrices now.
    group.updateMatrixWorld(true);
  }

  // ---- Collision Master mesh session ---------------------------------------------

  /** Feed (or clear) the Collision Master mesh-volume view: editable meshes,
   *  the selected volume, sub mode and vertex selection. baseY = the CM
   *  placement's world seat (asset at origin, yaw 0, scale 1). */
  setCmMeshState(
    state: {
      meshes: readonly CmMesh[];
      selected: number | null;
      mode: CmComponentMode | null;
      selVerts: readonly number[];
      baseY: number;
      originX?: number;
      originZ?: number;
    } | null,
  ): void {
    this.cmMeshState = state;
    if (!this.renderer) return;
    if (!this.cmMeshView) {
      this.cmMeshView = new CmMeshView();
    }
    if (this.cmMeshView.group.parent !== this.renderer.scene) {
      this.renderer.scene.add(this.cmMeshView.group);
    }
    this.cmMeshView.setState(
      state
        ? {
            meshes: state.meshes,
            selected: state.selected,
            mode: state.mode,
            selVerts: state.selVerts,
          }
        : null,
      state?.baseY ?? 0,
      state?.originX ?? 0,
      state?.originZ ?? 0,
    );
  }

  /** The mesh-volume index under the pointer (CM object mode), or null. */
  pickCmVolume(clientX: number, clientY: number): number | null {
    if (!this.cmMeshView || !this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    return this.cmMeshView.pickVolume(this.picker);
  }

  /** The vertex/edge/face under the pointer (CM sub modes), or null. */
  pickCmComponent(clientX: number, clientY: number): CmComponentPick | null {
    if (!this.cmMeshView || !this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    return this.cmMeshView.pickComponent(this.picker, this.renderer.camera);
  }

  /** Poly Build: the face (volume + tri group) under the pointer, or null. */
  pickCmFace(
    clientX: number,
    clientY: number,
  ): { mesh: number; verts: number[]; tris: number[] } | null {
    if (!this.cmMeshView || !this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    return this.cmMeshView.pickFaceGroup(this.picker);
  }

  /** Poly Build: the nearest feature edge on the selected volume, or null. */
  pickCmEdge(clientX: number, clientY: number): { mesh: number; a: number; b: number } | null {
    if (!this.cmMeshView || !this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    return this.cmMeshView.pickEdgeAny(this.picker, this.renderer.camera);
  }

  /** Dynamic sculpting: nearest editable model surface in model space. */
  pickCmSurface(clientX: number, clientY: number): CmSurfacePick | null {
    if (!this.cmMeshView || !this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    return this.cmMeshView.pickSurface(this.picker);
  }

  /** Convert a screen drag to a world/model-space camera-plane translation at
   *  the supplied world point. Used by the mesh Grab brush. */
  screenDragWorldDelta(
    dxPx: number,
    dyPx: number,
    at: readonly [number, number, number],
  ): [number, number, number] {
    if (!this.renderer) return [0, 0, 0];
    const camera = this.renderer.camera;
    const rect = this.canvas.getBoundingClientRect();
    const distance = camera.position.distanceTo(new THREE.Vector3(at[0], at[1], at[2]));
    const yardsPerPx = this.orthographic
      ? this.orthographicViewHeight() / Math.max(1, rect.height)
      : (2 * Math.max(0.1, distance) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) /
        Math.max(1, rect.height);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const delta = right
      .multiplyScalar(dxPx * yardsPerPx)
      .add(up.multiplyScalar(-dyPx * yardsPerPx));
    return [delta.x, delta.y, delta.z];
  }

  /** The parameter t of the closest point of the pointer ray to the world line
   *  `origin + t*axis` (Poly Build's extrude-along-normal distance). Null when
   *  the ray is nearly parallel to the axis (unstable). */
  pointerAxisT(
    clientX: number,
    clientY: number,
    origin: readonly [number, number, number],
    axis: readonly [number, number, number],
  ): number | null {
    if (!this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    // Closest points between the pointer ray (p = ro + s*rd) and the axis line
    // (q = o + t*a): solve the 2x2 normal equations for t.
    const ro = this.picker.ray.origin;
    const rd = this.picker.ray.direction;
    const ox = origin[0] - ro.x;
    const oy = origin[1] - ro.y;
    const oz = origin[2] - ro.z;
    const a = 1; // rd is unit length
    const b = rd.x * axis[0] + rd.y * axis[1] + rd.z * axis[2];
    const c = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];
    const d = rd.x * ox + rd.y * oy + rd.z * oz;
    const e = axis[0] * ox + axis[1] * oy + axis[2] * oz;
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-6) return null; // ray ~parallel to the axis
    // t along the axis line from `origin`.
    return (b * d - a * e) / denom;
  }

  /** The CM gizmo anchor + selection shape, or null when nothing is grabbed:
   *  object mode anchors the selected volume's centroid, sub modes the
   *  selected verts' centroid. `single` = exactly one vertex (move-only). */
  private cmSelectionInfo(): { origin: THREE.Vector3; single: boolean } | null {
    const st = this.cmMeshState;
    if (!st || st.selected === null) return null;
    const m = st.meshes[st.selected];
    if (!m) return null;
    const ox = st.originX ?? 0;
    const oz = st.originZ ?? 0;
    if (st.mode === null) {
      const [cx, cy, cz] = vertsCentroid(m);
      return { origin: this.gizmoOriginV.set(cx + ox, cy + st.baseY, cz + oz), single: false };
    }
    if (st.selVerts.length === 0) return null;
    const [cx, cy, cz] = vertsCentroid(m, st.selVerts);
    return {
      origin: this.gizmoOriginV.set(cx + ox, cy + st.baseY, cz + oz),
      single: st.mode === 'vertex' && st.selVerts.length === 1,
    };
  }

  /** Vertex indices of the selected CM volume projecting inside the marquee. */
  private cmVertsInMarquee(): number[] {
    const m = this.marquee;
    const st = this.cmMeshState;
    if (!m || !st || st.selected === null || st.mode === null || !this.renderer) return [];
    const mesh = st.meshes[st.selected];
    if (!mesh) return [];
    const minX = Math.min(m.x0, m.x1);
    const maxX = Math.max(m.x0, m.x1);
    const minY = Math.min(m.y0, m.y1);
    const maxY = Math.max(m.y0, m.y1);
    if (maxX - minX < 3 && maxY - minY < 3) return [];
    const rect = this.canvas.getBoundingClientRect();
    const cam = this.renderer.camera;
    const ox = st.originX ?? 0;
    const oz = st.originZ ?? 0;
    const v = new THREE.Vector3();
    const out: number[] = [];
    for (let i = 0; i < mesh.verts.length / 3; i++) {
      v.set(
        mesh.verts[i * 3] + ox,
        mesh.verts[i * 3 + 1] + st.baseY,
        mesh.verts[i * 3 + 2] + oz,
      ).project(cam);
      if (v.z > 1 || v.z < -1) continue;
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) out.push(i);
    }
    return out;
  }

  // ---- studio mode (Collision Master backdrop) -------------------------------------

  /** Isolated studio look for Collision Master: a neutral gradient backdrop
   *  (replaces the sky), the terrain hidden, and a Blender-style grid floor.
   *  Survives renderer restarts; setStudioMode(false) restores the world. */
  setStudioMode(on: boolean): void {
    this.studio = on;
    this.applyStudio();
  }

  private applyStudio(): void {
    const r = this.renderer;
    if (!r) return;
    if (this.studio) {
      r.editor.setEditorSkybox(studioBackdropUrl());
      r.editor.setEditorStudio(true);
      r.terrainGroup.visible = false;
      // Fog stays untouched: the renderer's per-frame sync owns it (nulling
      // it crashes the loop), and at studio camera distances it is invisible.
      if (!this.studioRig) {
        const rig = new THREE.Group();
        rig.name = 'editor-cm-studio';
        // Blender-style floor: a soft dark disc under a sparse grid. The grid
        // stays COARSE on purpose, a dense grid viewed edge-on stacks its
        // antialiased lines into a glowing horizon band.
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(220, 48),
          new THREE.MeshBasicMaterial({ color: 0x232327 }),
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = -0.03;
        rig.add(disc);
        const grid = new THREE.GridHelper(60, 12, 0x47474d, 0x36363a);
        const gridMat = grid.material as THREE.Material;
        gridMat.transparent = true;
        gridMat.opacity = 0.38;
        gridMat.depthWrite = false;
        grid.position.y = -0.01;
        rig.add(grid);
        const axes = new THREE.GridHelper(60, 2, 0x7a3b3b, 0x3b5178);
        const axesMat = axes.material as THREE.Material;
        axesMat.transparent = true;
        axesMat.opacity = 0.5;
        axesMat.depthWrite = false;
        rig.add(axes);
        this.studioRig = rig;
      }
      if (this.studioRig.parent !== r.scene) r.scene.add(this.studioRig);
      // No floating NPC names in the studio (the scratch map is people-free),
      // and no selection ring under the workbench asset.
      this.nameplates.style.display = 'none';
      r.placedAssets.setSelected(null);
      // Already-built authored overlays (hub rings, markers, spawn ring) hide
      // too; refreshAuthoredOverlays re-applies this after any rebuild.
      for (const g of [
        this.locationsGroup,
        this.markersGroup,
        this.musicGroup,
        this.soundsGroup,
        this.lightsGroup,
        this.spawnRing,
      ]) {
        if (g) g.visible = false;
      }
      // Hiding terrainGroup alone does not empty the scene: the world's ambient
      // layers are their own scene children and stay lit and visible over the
      // studio floor - grass bands, canopy foliage, fireflies, birds, fish,
      // gather nodes, braziers, the far-terrain shell, whole zone features.
      // With them in shot the workbench is not a workbench, so every NAMED
      // world layer hides here. Editor chrome (`editor-*`, the placed asset
      // itself) and the unnamed lights/sky are left exactly as they were, and
      // each object's previous visibility is remembered so restoring cannot
      // switch something back on that the map had off.
      this.studioHidden = [];
      this.studioScanCount = -1;
      this.enforceStudioHiding();
    } else {
      if (this.studioRig?.parent) this.studioRig.parent.remove(this.studioRig);
      r.editor.setEditorStudio(false);
      r.terrainGroup.visible = true;
      this.nameplates.style.display = '';
      r.placedAssets.setSelected(this.selectedIndex);
      for (const child of this.studioHidden) r.scene.add(child);
      this.studioHidden = [];
      this.studioScanCount = -1;
      // Back to the map's own backdrop (authored skybox or procedural dome).
      r.editor.setEditorSkybox(this.skyboxUrl);
    }
  }

  /** World layers this studio session pulled out of the scene, so leaving puts
   *  back exactly those and nothing else. */
  private studioHidden: THREE.Object3D[] = [];
  /** Scene child count at the last studio pass, so the per-frame check is a
   *  single integer compare until the scene actually changes shape. */
  private studioScanCount = -1;

  /**
   * Keep the studio empty. Two things make this harder than setting `visible`:
   *
   *  - The world's ambient layers (foliage buckets, grass bands, fireflies,
   *    birds, fish, gather nodes, zone features) are built ASYNCHRONOUSLY as
   *    content streams in, so a one-shot pass at mode-switch time misses them
   *    and they fade up over the workbench floor seconds later.
   *  - The renderer OWNS their visibility. Its per-frame sync re-shows them for
   *    LOD and zone culling, so a `visible = false` is overwritten before the
   *    next draw.
   *
   * So they get DETACHED instead, which is the same lever the self-view toggle
   * in the render loop uses and for the same reason. The renderer holds them by
   * field rather than by scene traversal, so it keeps updating them happily; it
   * simply has nothing to draw. Cheap: it only rescans when the scene gains or
   * loses children, which detaching itself settles.
   */
  private enforceStudioHiding(): void {
    const r = this.renderer;
    if (!r) return;
    if (r.scene.children.length === this.studioScanCount) return;
    for (const child of [...r.scene.children]) {
      // Terrain has its own visibility switch above, and editor chrome plus the
      // workbench asset are the whole point of being here.
      if (!child.name || child.name === 'terrain') continue;
      if (child.name === 'placed-assets' || child.name.startsWith('editor-')) continue;
      this.studioHidden.push(child);
      r.scene.remove(child);
    }
    this.studioScanCount = r.scene.children.length;
  }

  /** The hitbox index under a pointer position (edit mode), or null. */
  pickHitbox(clientX: number, clientY: number): number | null {
    if (!this.hitboxGroup || !this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    const hits = this.picker.intersectObjects(this.hitboxGroup.children, false);
    for (const h of hits) {
      const idx = h.object.userData?.hitboxIndex;
      if (typeof idx === 'number') return idx;
    }
    return null;
  }

  /** World-space centroid of the SELECTED hitboxes (the gizmo anchor). */
  private hitboxSelectionOrigin(
    p: AssetPlacement,
    st: { boxes: readonly MapHitbox[]; selected: number[] },
  ): THREE.Vector3 {
    const s = p.scale > 0 ? p.scale : 1;
    const sx = s * (p.scaleX ?? 1);
    const sy = s * (p.scaleY ?? 1);
    const sz = s * (p.scaleZ ?? 1);
    let mx = 0;
    let my = 0;
    let mz = 0;
    let n = 0;
    for (const i of st.selected) {
      const b = st.boxes[i];
      if (!b) continue;
      mx += b.x * sx;
      my += b.y * sy;
      mz += b.z * sz;
      n++;
    }
    if (n > 0) {
      mx /= n;
      my /= n;
      mz /= n;
    }
    // Model -> world (three.js Y-rotation convention).
    const cos = Math.cos(p.rotY);
    const sin = Math.sin(p.rotY);
    const wx = mx * cos + mz * sin;
    const wz = -mx * sin + mz * cos;
    const ground = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.seed);
    return this.gizmoOriginV.set(p.x + wx, ground + (p.y ?? 0) + my, p.z + wz);
  }

  // ---- transform gizmo ---------------------------------------------------------

  private gizmoScaleAt(origin: THREE.Vector3): number {
    if (!this.renderer) return 1;
    const viewDepth = -this.gizmoViewV
      .copy(origin)
      .applyMatrix4(this.renderer.camera.matrixWorldInverse).z;
    return gizmoScaleForScreen(
      viewDepth,
      EDITOR_VERTICAL_FOV_DEG,
      this.canvas.clientHeight,
      this.orthographic ? this.orthographicViewHeight() : undefined,
    );
  }

  /** Per-frame gizmo pose: at the selection's anchor, stable screen-space sized,
   *  hidden when no transform tool + selection is active. */
  private syncGizmo(): void {
    const g = this.gizmo;
    if (!g || !this.renderer) return;
    const mode = this.hooks.gizmoMode();
    const idx = this.selectedIndex;
    const p = idx !== null ? this.map.placements[idx] : undefined;
    // FORK: no placement selected but a Cut/Carve ghost is up: the gizmo
    // anchors the ghost, so tools 2-4 move, turn and size the pending solid.
    const ghost = this.cutGhostCut;
    if (mode && !p && ghost) {
      const origin = this.gizmoOriginV.set(ghost.x, ghost.y, ghost.z);
      g.show(
        { mode, moveY: true, rotateXZ: true, scaleAxes: ['x', 'y', 'z'] },
        origin,
        this.gizmoScaleAt(origin),
      );
      return;
    }
    if (!mode || !p) {
      g.hide();
      return;
    }
    const fire = this.fireEditState;
    if (fire && fire.index === idx) {
      const origin = this.renderer.placedAssets.fireEmitterWorldPosition(
        fire.index,
        fire.emitterIndex,
        this.gizmoOriginV,
      );
      if (!origin) {
        g.hide();
        return;
      }
      g.show(
        { mode: 'move', moveY: true, rotateXZ: false, scaleAxes: ['x', 'y', 'z'] },
        origin,
        this.gizmoScaleAt(origin),
      );
      return;
    }
    // Collision Master mesh session: the gizmo anchors the selected volume
    // (object mode) or the selected component (sub modes), never the
    // workbench placement. A single vertex is move-only (rotate/scale of one
    // point is a no-op), so the gizmo shows move handles regardless of tool.
    if (this.cmMeshState) {
      const sel = this.cmSelectionInfo();
      if (!sel) {
        g.hide();
        return;
      }
      g.show(
        {
          mode: sel.single ? 'move' : mode,
          moveY: true,
          rotateXZ: !sel.single,
          scaleAxes: ['x', 'y', 'z'],
        },
        sel.origin,
        this.gizmoScaleAt(sel.origin),
      );
      return;
    }
    // Hitbox edit mode: the gizmo anchors the SELECTED hitboxes instead of the
    // placement (yaw-only rotation; per-axis + uniform scale).
    const hb = this.hitboxEditState;
    if (hb && hb.index === idx && hb.selected.length > 0) {
      const origin = this.hitboxSelectionOrigin(p, hb);
      g.show(
        { mode, moveY: true, rotateXZ: false, scaleAxes: ['x', 'y', 'z'] },
        origin,
        this.gizmoScaleAt(origin),
      );
      return;
    }
    if (hb && hb.index === idx) {
      // Edit mode with nothing selected: no gizmo (clicking picks boxes).
      g.hide();
      return;
    }
    const kind = this.overlayKindFor(p.assetId);
    const config: GizmoConfig = {
      mode,
      // The Y move arrow lifts ANY placement off its seat: ordinary assets and
      // box/sphere/wall colliders edit the shared vertical offset (visual only,
      // collision stays 2D), a floor plane shifts its floor-height offset. Every
      // movable object is draggable on all three axes.
      moveY: true,
      // Box/sphere colliders are yaw-only in the sim (OBB), so no tilt rings;
      // planes tilt into sloped floors (ramps), so they get all three.
      rotateXZ: kind === null || kind === 'plane',
      scaleAxes: kind === 'sphere' ? ['x'] : kind === 'plane' ? ['x', 'z'] : ['x', 'y', 'z'],
    };
    const origin = this.gizmoOriginFor(p, kind);
    g.show(config, origin, this.gizmoScaleAt(origin));
  }

  private gizmoOriginFor(p: AssetPlacement, kind: ColliderVolumeKind | null): THREE.Vector3 {
    const ground = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.seed);
    // A plane's Y handle rides its floor offset (sizeY); every other kind (assets
    // + box/sphere/wall) rides the shared vertical offset, so the gizmo tracks the
    // lifted object instead of staying pinned to the ground. Cave rig nodes are
    // plane-kind pads whose Y IS the vertical offset ? track the node.
    const caveNode = (p.assetId ?? '').startsWith('cave/');
    const y = kind === 'plane' && !caveNode ? ground + (p.sizeY ?? 0) : ground + (p.y ?? 0);
    return this.gizmoOriginV.set(p.x, y + 0.05, p.z);
  }

  /** The gizmo handle under a pointer position, or null. */
  private gizmoPick(clientX: number, clientY: number): GizmoAxis | null {
    if (!this.gizmo || !this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    return this.gizmo.pick(this.picker);
  }

  // ---- Ctrl+drag box select -----------------------------------------------------

  /** Show/refresh (or remove, when no marquee is live) the selection box. */
  private updateMarqueeEl(): void {
    if (!this.marquee) {
      this.marqueeEl?.remove();
      this.marqueeEl = null;
      return;
    }
    if (!this.marqueeEl) {
      const div = document.createElement('div');
      div.className = 'editor-3d-marquee';
      div.style.cssText =
        'position:fixed;pointer-events:none;z-index:30;' +
        'border:1px dashed rgba(240,196,25,0.9);background:rgba(240,196,25,0.12);';
      document.body.appendChild(div);
      this.marqueeEl = div;
    }
    const m = this.marquee;
    this.marqueeEl.style.left = `${Math.min(m.x0, m.x1)}px`;
    this.marqueeEl.style.top = `${Math.min(m.y0, m.y1)}px`;
    this.marqueeEl.style.width = `${Math.abs(m.x1 - m.x0)}px`;
    this.marqueeEl.style.height = `${Math.abs(m.y1 - m.y0)}px`;
  }

  /** Every placement whose anchor projects inside the live marquee box. */
  private placementsInMarquee(): number[] {
    const m = this.marquee;
    if (!m || !this.renderer) return [];
    const minX = Math.min(m.x0, m.x1);
    const maxX = Math.max(m.x0, m.x1);
    const minY = Math.min(m.y0, m.y1);
    const maxY = Math.max(m.y0, m.y1);
    // A click without a real drag clears the selection instead of lassoing a
    // zero-area box.
    if (maxX - minX < 3 && maxY - minY < 3) return [];
    const rect = this.canvas.getBoundingClientRect();
    const cam = this.renderer.camera;
    const v = new THREE.Vector3();
    const out: number[] = [];
    for (let i = 0; i < this.map.placements.length; i++) {
      const p = this.map.placements[i];
      if (!this.buildingPlacementIsVisible(p)) continue;
      const anchorY =
        (p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.seed)) + (p.y ?? 0);
      v.set(p.x, anchorY, p.z).project(cam);
      if (v.z > 1 || v.z < -1) continue; // behind the camera / past far plane
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) out.push(i);
    }
    return out;
  }

  /** Hitbox indices whose projected CENTER falls inside the marquee (hitbox
   *  edit mode: Ctrl+drag selects collision boxes instead of placements). */
  private hitboxesInMarquee(): number[] {
    const m = this.marquee;
    const st = this.hitboxEditState;
    if (!m || !st || !this.renderer) return [];
    const p = this.map.placements[st.index];
    if (!p) return [];
    const minX = Math.min(m.x0, m.x1);
    const maxX = Math.max(m.x0, m.x1);
    const minY = Math.min(m.y0, m.y1);
    const maxY = Math.max(m.y0, m.y1);
    if (maxX - minX < 3 && maxY - minY < 3) return [];
    const rect = this.canvas.getBoundingClientRect();
    const cam = this.renderer.camera;
    const ground = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.seed);
    const baseY = ground + (p.y ?? 0);
    const s = p.scale > 0 ? p.scale : 1;
    const sx0 = s * (p.scaleX ?? 1);
    const sy0 = s * (p.scaleY ?? 1);
    const sz0 = s * (p.scaleZ ?? 1);
    const cr = Math.cos(p.rotY);
    const sr = Math.sin(p.rotY);
    const v = new THREE.Vector3();
    const out: number[] = [];
    for (let i = 0; i < st.boxes.length; i++) {
      const b = st.boxes[i];
      const lx = b.x * sx0;
      const lz = b.z * sz0;
      // Same frame as the hitbox overlay group: yaw p.rotY about the anchor.
      v.set(p.x + lx * cr + lz * sr, baseY + b.y * sy0, p.z - lx * sr + lz * cr).project(cam);
      if (v.z > 1 || v.z < -1) continue;
      const px = rect.left + ((v.x + 1) / 2) * rect.width;
      const py = rect.top + ((1 - v.y) / 2) * rect.height;
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) out.push(i);
    }
    return out;
  }

  /** Pointer-ray hit on an interaction plane (client coords), or null. */
  private planeHit(clientX: number, clientY: number, plane: THREE.Plane): THREE.Vector3 | null {
    if (!this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    return this.picker.ray.intersectPlane(plane, this.planeHitV);
  }

  /** Claim a left-press on a gizmo handle; captures the drag baseline. */
  private beginGizmoDrag(axis: GizmoAxis, clientX: number, clientY: number): boolean {
    const mode = this.hooks.gizmoMode();
    const idx = this.selectedIndex;
    const p = idx !== null ? this.map.placements[idx] : undefined;
    if (!this.renderer) return false;
    const ghost = this.cutGhostCut;
    if (mode && !p && ghost) {
      // FORK: the pending cut ghost.
      const origin = new THREE.Vector3(ghost.x, ghost.y, ghost.z);
      let plane: THREE.Plane;
      if (mode === 'rotate') {
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          gizmoAxisDir(axis as 'x' | 'y' | 'z'),
          origin,
        );
      } else if (axis === 'y') {
        const n = this.renderer.camera.position.clone().sub(origin);
        n.y = 0;
        if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
        n.normalize();
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, origin);
      } else {
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), origin);
      }
      const hit = this.planeHit(clientX, clientY, plane);
      if (!hit) return false;
      this.gizmoDrag = {
        axis,
        mode,
        kind: null,
        start: { x: ghost.x, z: ghost.z } as AssetPlacement,
        origin,
        plane,
        startHit: hit.clone(),
        ghost: { start: { ...ghost } },
      };
      this.dragMode = 'gizmo';
      return true;
    }
    if (!mode || !p) return false;
    const hb = this.hitboxEditState;
    // Collision Master mesh selection outranks every other gizmo target.
    const cmSel = this.cmMeshState ? this.cmSelectionInfo() : null;
    const cm = cmSel !== null;
    const fireState = this.fireEditState?.index === idx ? this.fireEditState : null;
    const fireFx = fireState ? p.fireEffects?.[fireState.emitterIndex] : undefined;
    const fire = !!fireState && !!fireFx;
    const hitbox = !cm && !fire && !!hb && hb.index === idx && hb.selected.length > 0;
    const kind = cm || hitbox || fire ? null : this.overlayKindFor(p.assetId);
    const origin = (
      cmSel
        ? cmSel.origin
        : fireState
          ? this.renderer.placedAssets.fireEmitterWorldPosition(
              fireState.index,
              fireState.emitterIndex,
              this.gizmoOriginV,
            )
          : hitbox && hb
            ? this.hitboxSelectionOrigin(p, hb)
            : this.gizmoOriginFor(p, kind)
    )?.clone();
    if (!origin) return false;
    // A single CM vertex renders a move gizmo whatever the tool says (see
    // syncGizmo): the claimed drag must agree with what was shown.
    const effMode = fire || (cm && cmSel.single) ? 'move' : mode;
    let plane: THREE.Plane;
    if (effMode === 'rotate') {
      // Rotation reads the cursor's angle in the ring's own plane.
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        gizmoAxisDir(axis as 'x' | 'y' | 'z'),
        origin,
      );
    } else if (axis === 'y') {
      // Vertical edits track a camera-facing vertical plane through the origin.
      const n = this.renderer.camera.position.clone().sub(origin);
      n.y = 0;
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
      n.normalize();
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, origin);
    } else {
      // Ground-plane edits at the gizmo's height.
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), origin);
    }
    const hit = this.planeHit(clientX, clientY, plane);
    if (!hit) return false;
    this.gizmoDrag = {
      axis,
      mode: effMode,
      kind,
      start: { ...p },
      origin,
      plane,
      startHit: hit.clone(),
      hitbox,
      cm,
      fire:
        fireState && fireFx
          ? { emitterIndex: fireState.emitterIndex, start: { ...fireFx } }
          : undefined,
    };
    this.dragMode = 'gizmo';
    return true;
  }

  /** One gizmo drag sample: constrain the plane hit to the handle's axis and
   *  push the live (uncommitted) placement change to the app. `snap` (Shift held)
   *  quantizes rotation to 20-degree steps (a clean 180 still lands). */
  private updateGizmoDrag(clientX: number, clientY: number, snap = false): void {
    const d = this.gizmoDrag;
    if (!d) return;
    const hit = this.planeHit(clientX, clientY, d.plane);
    if (!hit) return;
    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
    const round2 = (v: number): number => Math.round(v * 100) / 100;
    // Shift snaps rotation to the nearest 20 degrees (absolute for objects,
    // relative-to-gesture-start for mesh/hitbox drags, see each branch).
    const ROT_SNAP = Math.PI / 9;
    const snapRot = (a: number): number => (snap ? Math.round(a / ROT_SNAP) * ROT_SNAP : a);
    if (d.ghost) {
      // FORK: the pending cut ghost, absolute values from the gesture start.
      const g0 = d.ghost.start;
      let change: GizmoCutChange | null = null;
      if (d.mode === 'move') {
        if (d.axis === 'y') change = { y: g0.y + (hit.y - d.startHit.y) };
        else {
          const dx = hit.x - d.startHit.x;
          const dz = hit.z - d.startHit.z;
          if (d.axis === 'x') change = { x: g0.x + dx };
          else if (d.axis === 'z') change = { z: g0.z + dz };
          else change = { x: g0.x + dx, z: g0.z + dz };
        }
      } else if (d.mode === 'rotate') {
        const v0 = d.startHit.clone().sub(d.origin);
        const v1 = hit.clone().sub(d.origin);
        if (v1.lengthSq() < 1e-4) return;
        if (d.axis === 'x') {
          change = {
            rotX: (g0.rotX ?? 0) + snapRot(Math.atan2(v1.z, v1.y) - Math.atan2(v0.z, v0.y)),
          };
        } else if (d.axis === 'z') {
          change = {
            rotX: (g0.rotX ?? 0) + snapRot(Math.atan2(v1.y, v1.x) - Math.atan2(v0.y, v0.x)),
          };
        } else {
          change = {
            rotY: (g0.rotY ?? 0) + snapRot(Math.atan2(v1.x, v1.z) - Math.atan2(v0.x, v0.z)),
          };
        }
      } else {
        const r0 = g0.radius;
        const len0 = g0.shape === 'box' ? (g0.halfX ?? r0) / r0 : (g0.len ?? 0) / r0;
        const h0 = g0.shape === 'box' ? (g0.halfY ?? r0) / r0 : (g0.vert ?? 1);
        let ratio: number;
        if (d.axis === 'uniform') {
          const base = Math.max(0.2, d.startHit.distanceTo(d.origin));
          ratio = clamp(hit.distanceTo(d.origin) / base, 0.02, 50);
          change = { radius: r0 * ratio };
        } else {
          const dir = gizmoAxisDir(d.axis as 'x' | 'y' | 'z');
          const along0 = Math.abs(d.startHit.clone().sub(d.origin).dot(dir));
          const along1 = Math.abs(hit.clone().sub(d.origin).dot(dir));
          ratio = clamp(along1 / Math.max(0.05, along0), 0.02, 50);
          if (d.axis === 'x') change = { lengthMult: len0 * ratio };
          else if (d.axis === 'y') change = { heightMult: h0 * ratio };
          else change = { radius: r0 * ratio };
        }
      }
      if (change) this.hooks.onCutGhostGizmoChange(change);
      return;
    }
    if (d.fire) {
      const worldDelta = hit.clone().sub(d.startHit);
      if (d.axis === 'x') worldDelta.set(worldDelta.x, 0, 0);
      else if (d.axis === 'y') worldDelta.set(0, worldDelta.y, 0);
      else if (d.axis === 'z') worldDelta.set(0, 0, worldDelta.z);
      const rotation = new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(d.start.rotX ?? 0, d.start.rotY, d.start.rotZ ?? 0, 'XYZ'))
        .invert();
      worldDelta.applyQuaternion(rotation);
      this.hooks.onFireGizmoChange({
        x: round2(clamp(d.fire.start.x + worldDelta.x, -50, 50)),
        y: round2(clamp(d.fire.start.y + worldDelta.y, -50, 50)),
        z: round2(clamp(d.fire.start.z + worldDelta.z, -50, 50)),
      });
      return;
    }
    // Hitbox edit + Collision Master mesh drags stream raw world-space deltas
    // from gesture start; the app owns the model-space math and the commit.
    if (d.hitbox || d.cm) {
      let hbChange: GizmoHitboxChange | null = null;
      if (d.mode === 'move') {
        if (d.axis === 'y') {
          hbChange = { dy: hit.y - d.startHit.y };
        } else {
          const dx = hit.x - d.startHit.x;
          const dz = hit.z - d.startHit.z;
          if (d.axis === 'x') hbChange = { dx };
          else if (d.axis === 'z') hbChange = { dz };
          else hbChange = { dx, dz };
        }
      } else if (d.mode === 'rotate') {
        const v0 = d.startHit.clone().sub(d.origin);
        const v1 = hit.clone().sub(d.origin);
        if (v1.lengthSq() < 1e-4) return;
        // Per-ring angles, matching the placement path's conventions: hitboxes
        // only ever show the Y ring; CM meshes tilt on all three.
        if (d.axis === 'x') {
          hbChange = { dRotX: snapRot(Math.atan2(v1.z, v1.y) - Math.atan2(v0.z, v0.y)) };
        } else if (d.axis === 'z') {
          hbChange = { dRotZ: snapRot(Math.atan2(v1.y, v1.x) - Math.atan2(v0.y, v0.x)) };
        } else {
          hbChange = { dRotY: snapRot(Math.atan2(v1.x, v1.z) - Math.atan2(v0.x, v0.z)) };
        }
      } else if (d.axis === 'uniform') {
        const r0 = Math.max(0.2, d.startHit.distanceTo(d.origin));
        hbChange = { ratio: clamp(hit.distanceTo(d.origin) / r0, 0.02, 50), axis: 'uniform' };
      } else {
        const dir = gizmoAxisDir(d.axis as 'x' | 'y' | 'z');
        const along0 = Math.abs(d.startHit.clone().sub(d.origin).dot(dir));
        const along1 = Math.abs(hit.clone().sub(d.origin).dot(dir));
        hbChange = {
          ratio: clamp(along1 / Math.max(0.05, along0), 0.02, 50),
          axis: d.axis as 'x' | 'y' | 'z',
        };
      }
      if (hbChange) {
        if (d.cm) this.hooks.onCmGizmoChange(hbChange);
        else this.hooks.onHitboxGizmoChange(hbChange);
      }
      return;
    }
    let change: GizmoPlacementChange | null = null;
    if (d.mode === 'move') {
      if (d.axis === 'y') {
        const dy = hit.y - d.startHit.y;
        // Cave rig nodes ride the plane-kind pick pad for XZ grabbing, but
        // their Y arrow must move the NODE itself (placement.y drives the
        // cave floor height there) ? never the pad's sizeY.
        const caveNode = (d.start.assetId ?? '').startsWith('cave/');
        change =
          d.kind === 'plane' && !caveNode
            ? {
                sizeY: round2(
                  clamp((d.start.sizeY ?? 0) + dy, MIN_COLLIDER_SIZE_Y, MAX_COLLIDER_SIZE_Y),
                ),
              }
            : {
                y: round2(
                  clamp((d.start.y ?? 0) + dy, -MAX_PLACEMENT_Y_OFFSET, MAX_PLACEMENT_Y_OFFSET),
                ),
              };
      } else {
        const dx = hit.x - d.startHit.x;
        const dz = hit.z - d.startHit.z;
        if (d.axis === 'x') change = { x: d.start.x + dx };
        else if (d.axis === 'z') change = { z: d.start.z + dz };
        else change = { x: d.start.x + dx, z: d.start.z + dz };
      }
    } else if (d.mode === 'rotate') {
      const v0 = d.startHit.clone().sub(d.origin);
      const v1 = hit.clone().sub(d.origin);
      if (v1.lengthSq() < 1e-4) return;
      if (d.axis === 'y') {
        const delta = Math.atan2(v1.x, v1.z) - Math.atan2(v0.x, v0.z);
        change = { rotY: wrapAngle(snapRot(d.start.rotY + delta)) };
      } else if (d.axis === 'x') {
        const delta = Math.atan2(v1.z, v1.y) - Math.atan2(v0.z, v0.y);
        change = { rotX: wrapAngle(snapRot((d.start.rotX ?? 0) + delta)) };
      } else {
        const delta = Math.atan2(v1.y, v1.x) - Math.atan2(v0.y, v0.x);
        change = { rotZ: wrapAngle(snapRot((d.start.rotZ ?? 0) + delta)) };
      }
    } else {
      // scale
      if (d.axis === 'uniform') {
        const r0 = Math.max(0.2, d.startHit.distanceTo(d.origin));
        const next = d.start.scale * (hit.distanceTo(d.origin) / r0);
        change = { scale: round2(clamp(next, PLACEMENT_SCALE_MIN, PLACEMENT_SCALE_MAX)) };
      } else {
        const dir = gizmoAxisDir(d.axis as 'x' | 'y' | 'z');
        const along0 = Math.abs(d.startHit.clone().sub(d.origin).dot(dir));
        const along1 = Math.abs(hit.clone().sub(d.origin).dot(dir));
        const ratio = along1 / Math.max(0.05, along0);
        if (d.kind) {
          const def = COLLIDER_DEFAULT_SIZE[d.kind];
          if (d.axis === 'x') {
            change = {
              sizeX: round2(
                clamp((d.start.sizeX ?? def.x) * ratio, MIN_COLLIDER_SIZE, MAX_COLLIDER_SIZE),
              ),
            };
          } else if (d.axis === 'z') {
            change = {
              sizeZ: round2(
                clamp((d.start.sizeZ ?? def.z) * ratio, MIN_COLLIDER_SIZE, MAX_COLLIDER_SIZE),
              ),
            };
          } else {
            // Box height scales from its authored (positive) size.
            change = {
              sizeY: round2(
                clamp(
                  Math.max(0.1, d.start.sizeY ?? def.y) * ratio,
                  MIN_COLLIDER_SIZE,
                  MAX_COLLIDER_SIZE_Y,
                ),
              ),
            };
          }
        } else {
          const key = d.axis === 'x' ? 'scaleX' : d.axis === 'z' ? 'scaleZ' : 'scaleY';
          const startV =
            d.axis === 'x'
              ? (d.start.scaleX ?? 1)
              : d.axis === 'z'
                ? (d.start.scaleZ ?? 1)
                : (d.start.scaleY ?? 1);
          change = { [key]: round2(clamp(startV * ratio, MIN_AXIS_SCALE, MAX_AXIS_SCALE)) };
        }
      }
    }
    if (change) this.hooks.onGizmoChange(change);
  }

  // ---- collider volumes (editor-only overlay) ---------------------------------

  /** The overlay volume for a placement index, or null when the placement is
   *  not a collider. Ignores the collide flag so an authored volume can never
   *  become invisible AND unpickable at once. */
  private colliderVolumeAt(index: number): ColliderVolume | null {
    const p = this.map.placements[index];
    if (!p || p.hidden || !this.buildingPlacementIsVisible(p)) return null;
    // Fluid pools ride the collider-overlay machinery as plane-like pads so
    // they pick and gizmo exactly like floor planes (footprint sizeX/sizeZ,
    // surface offset sizeY); their real look is the renderer's fluid surface.
    const fluid = fluidVolumeFromPlacement(p);
    if (fluid) {
      return {
        kind: 'plane',
        x: fluid.x,
        z: fluid.z,
        rotY: fluid.rotY,
        sizeX: fluid.halfX * 2,
        sizeY: fluid.offsetY,
        sizeZ: fluid.halfZ * 2,
      };
    }
    // Cave/rock rig markers: a small pick pad so the Move/Scale gizmos can
    // grab EVERY node (entrance, exit, and the blue waypoints), not just the
    // mouths ? moving or scaling one live-regenerates its bore/ridge.
    if (
      p.assetId === 'cave/entrance' ||
      p.assetId === 'cave/exit' ||
      p.assetId === 'cave/point' ||
      p.assetId === 'rock/point'
    ) {
      return { kind: 'plane', x: p.x, z: p.z, rotY: 0, sizeX: 3.5, sizeY: 0.2, sizeZ: 3.5 };
    }
    return colliderVolumeFromPlacement({ ...p, collide: true });
  }

  /** The gizmo-behavior kind for a placement: collider kinds as themselves,
   *  fluid pools as planes, ordinary assets as null. */
  private overlayKindFor(assetId: string): ColliderVolumeKind | null {
    if (
      assetId === 'cave/entrance' ||
      assetId === 'cave/exit' ||
      assetId === 'cave/point' ||
      assetId === 'rock/point'
    ) {
      return 'plane';
    }
    return colliderKindFor(assetId) ?? (isFluidAssetId(assetId) ? 'plane' : null);
  }

  /** Full overlay rebuild from this.map.placements (add/remove/undo/load). */
  refreshColliderVolumes(): void {
    if (!this.visible) {
      this.hiddenColliders = true;
      return;
    }
    if (!this.renderer) return;
    this.disposeColliderVolumes();
    const group = new THREE.Group();
    group.name = 'editor-collider-volumes';
    for (let i = 0; i < this.map.placements.length; i++) {
      // Zone isolate: overlays follow the placement view out of the rect.
      if (this.isolateRect) {
        const p = this.map.placements[i];
        const r = this.isolateRect;
        if (p.x < r.minX || p.x >= r.maxX || p.z < r.minZ || p.z >= r.maxZ) continue;
      }
      const v = this.colliderVolumeAt(i);
      if (!v) continue;
      const mesh = this.colliderVolumeMesh(v, i === this.selectedIndex, this.map.placements[i]);
      this.colliderMeshes.set(i, mesh);
      group.add(mesh);
    }
    group.visible = !this.collidersUserHidden;
    this.collidersGroup = group;
    this.renderer.scene.add(group);
    this.refreshFluidsIfNeeded();
  }

  /**
   * Preview mode (topbar toggle): the map as it looks in-game. Hides every
   * editor-only overlay ? collider boxes, blockers, music areas, location
   * rects, markers, spawn ring, cave guides, light bulbs, selection rings,
   * the gizmo. Point lights keep SHINING (they exist in-game); only their
   * bulb badges hide. Enforced per frame in loop() because refresh* rebuilds
   * recreate several of these groups visible.
   */
  /**
   * Enter/leave zone isolate mode. `rect` = the zone's world rect, null =
   * full build. Everything outside the rect is UNLOADED, not hidden: the
   * residency filter stops new zone prepares, the full terrain rebuild drops
   * what was already built, and the placement/overlay views filter by rect.
   */
  setZoneIsolate(
    rect: { minX: number; maxX: number; minZ: number; maxZ: number } | null,
  ): Promise<void> {
    this.isolateRect = rect ? { ...rect } : null;
    this.isolateHiddenGroups = null; // re-measure against the new rect
    // The guide traces whatever is resident, so it follows the rect (and the
    // rebuild below drops its group, so this re-adds it afterwards too).
    this.guideRect = rect ? { ...rect } : null;
    // Procedural trees, rocks and ground dressing are generated for the whole
    // world at engine build, so they can only be cut before the rebuild below.
    setFoliageBounds(this.isolateRect);
    if (!this.renderer) return Promise.resolve(); // start() re-applies from the field
    this.renderer.editor.setZoneResidencyFilter(this.isolateRect);
    // A FULL engine rebuild, not just rebuildTerrain(). The world's static
    // dressing (buildProps) and the per-biome zone features are constructed
    // once at engine build from the active WorldContent, rebuildTerrain drops
    // terrain and leaves every building standing in mid-air. reload() is the
    // only path that actually unloads them, and the caller has already
    // re-projected the active world through the isolate rect.
    return this.reload(this.map);
  }

  /**
   * Move the isolate rect WITHOUT an engine reload, the camera-chunk stream's
   * per-chunk step.
   *
   * setZoneIsolate reloads because the world's static dressing and its
   * procedural foliage are BAKED AT ENGINE BUILD, and a reload is the only
   * thing that truly unloads them. That is affordable once, when a maker picks
   * a zone. It is not affordable every time the camera crosses a chunk edge.
   *
   * So this moves the two residency lanes that CAN follow a rect cheaply ,
   * terrain (the residency filter plus a rebuild, which drops what was built
   * and re-prepares only what the new rect allows) and placements (refiltered
   * by rect), and leaves the baked layers to applyZoneIsolateHide's per-frame
   * pass, which is a hide rather than an unload. Entering and leaving the mode
   * still go through setZoneIsolate, so the expensive unload happens exactly
   * twice per session with the mode on, not once per chunk.
   */
  moveIsolateRect(rect: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    this.isolateRect = { ...rect };
    // The hidden list was measured against the OLD rect. Restore it before
    // dropping it, or everything the previous chunk hid stays invisible for
    // the rest of the session, the renderer's own per-frame culls re-assert
    // their own visibility, so handing these back `true` is safe.
    if (this.isolateHiddenGroups) {
      for (const g of this.isolateHiddenGroups) g.visible = true;
      this.isolateHiddenGroups = null;
    }
    // Kept in step even though the already-built foliage cannot follow it:
    // the next engine rebuild (leaving the mode, a map load) must not inherit
    // a stale bound.
    setFoliageBounds(this.isolateRect);
    if (!this.renderer) return;
    this.renderer.editor.setZoneResidencyFilter(this.isolateRect);
    this.rebuildTerrainFull();
    this.rebuildPlacements();
  }

  /** Zone residency for the Scene tree's badge (by any point in the zone). */
  isZoneResident(x: number, z: number): boolean {
    return this.renderer?.isZonePreparedAt(x, z) ?? false;
  }

  /** Drop isolate state WITHOUT rebuilding: for a document swap whose
   *  imminent reload re-applies residency from scratch anyway. */
  clearZoneIsolateQuiet(): void {
    this.isolateRect = null;
    this.isolateHiddenGroups = null;
    setFoliageBounds(null);
    this.renderer?.editor.setZoneResidencyFilter(null);
  }

  /** Stream every zone of the document (Full Build Preview). Sequential on
   *  purpose, one prepare in flight, progress per zone. */
  async fullBuildPreview(onProgress?: (done: number, total: number) => void): Promise<void> {
    const zones = this.map.content.zones;
    let done = 0;
    onProgress?.(0, zones.length);
    for (const zone of zones) {
      if (this.disposed) return;
      await this.renderer?.prepareZoneAt(zone.hub.x, zone.hub.z, undefined, { pace: 'fast' });
      onProgress?.(++done, zones.length);
    }
  }

  setPreviewMode(on: boolean): void {
    if (this.previewMode === on) return;
    this.previewMode = on;
    if (on) {
      this.applyPreviewHide();
      this.renderer?.placedAssets.setSelected(null);
      this.renderer?.placedAssets.showFootprints(false);
    } else {
      // Restore: state-driven visibility comes back; rebuilt groups are
      // visible by default, the rest re-derive from their own flags.
      for (const g of this.previewHiddenTargets()) if (g) g.visible = true;
      // Badges and rings come back; the PointLights are NOT ours to show - the
      // renderer's point-light budget owns their visibility either way.
      if (this.lightsGroup) {
        for (const c of this.lightsGroup.children) {
          if (!(c as THREE.Light).isLight) c.visible = true;
        }
      }
      if (this.collidersGroup) this.collidersGroup.visible = !this.collidersUserHidden;
      if (this.locationsGroup) this.locationsGroup.visible = !this.locationsUserHidden;
      this.renderer?.placedAssets.setSelected(this.selectedIndex);
      this.refreshMultiSelection();
    }
  }

  getPreviewMode(): boolean {
    return this.previewMode;
  }

  /** Every whole-group overlay preview mode hides (light bulbs are per-child). */
  private previewHiddenTargets(): (THREE.Object3D | null)[] {
    return [
      this.spawnRing,
      this.blockersGroup,
      this.blockerPreviewMesh,
      this.collidersGroup,
      this.locationsGroup,
      this.markersGroup,
      this.musicGroup,
      this.soundsGroup,
      this.caveGuidesGroup,
      this.holeGuidesGroup,
      this.zonePreviewMesh,
      this.cityGridGroup,
      this.buildingPreview?.group ?? null,
      this.cityPathGroup,
      this.multiSelGroup,
      this.mobSelGroup,
      this.npcSelGroup,
      this.rockChainGroup,
      this.hitboxGroup,
      this.gizmo?.group ?? null,
    ];
  }

  private applyPreviewHide(): void {
    for (const g of this.previewHiddenTargets()) if (g) g.visible = false;
    // Bulb badges and range rings hide; the THREE.PointLight children keep
    // illuminating exactly like the in-game build of this map - which means
    // leaving them to the renderer's budget rather than forcing them visible.
    if (this.lightsGroup) {
      for (const c of this.lightsGroup.children) {
        if (!(c as THREE.Light).isLight) c.visible = false;
      }
    }
  }

  // Scene groups zone-isolate hides, with the world bounds that decided it.
  // Measured once per engine build (Box3 over a whole feature group is not a
  // per-frame cost), dropped whenever the rect or the engine changes.
  private isolateHiddenGroups: THREE.Object3D[] | null = null;

  // Groups whose contents are camera-relative or global rather than parked at
  // a fixed place in the world: hiding these by world position would blank the
  // view the maker is standing in. Everything else in the scene is world-
  // anchored dressing and is fair game for the isolate cut.
  private static readonly ISOLATE_KEEP = new Set([
    'terrain',
    'farTerrain',
    'water',
    'foliage',
    'birds',
    'placed-assets',
    'sky',
    'clouds',
    'weather',
  ]);

  /**
   * Zone isolate, second layer: hide world-anchored scene groups that sit
   * wholly outside the isolated zone.
   *
   * The renderer's own feature cull (`updateZoneFeatureVisibility`) covers
   * everything attached through `attachZoneFeature`, streetlamps, braziers,
   * water flora, at per-zone granularity. But several world features are
   * added to the scene directly and register no footprint at all (the jail
   * scene, the Sowfield stadium, the Mirefen impact site, gather nodes), so
   * they stood fully lit in a zone they do not belong to. Enforced per frame
   * for the same reason preview mode is: the refresh paths rebuild groups
   * visible.
   */
  private applyZoneIsolateHide(): void {
    const rect = this.isolateRect;
    if (!rect || !this.renderer) return;
    if (!this.isolateHiddenGroups) {
      const hidden: THREE.Object3D[] = [];
      const box = new THREE.Box3();
      const outsideRect = (obj: THREE.Object3D): boolean | null => {
        box.setFromObject(obj);
        if (box.isEmpty()) return null; // nothing measurable: leave it alone
        return (
          box.max.x <= rect.minX ||
          box.min.x >= rect.maxX ||
          box.max.z <= rect.minZ ||
          box.min.z >= rect.maxZ
        );
      };
      for (const child of this.renderer.scene.children) {
        const name = child.name || '';
        if (!name || Editor3DViewport.ISOLATE_KEEP.has(name)) continue;
        if ((child as THREE.Light).isLight) continue;
        const outside = outsideRect(child);
        if (outside === null) continue;
        if (outside) {
          hidden.push(child);
          continue;
        }
        // The group STRADDLES the zone edge (gather nodes and other
        // world-spanning dressing that registers no per-zone cull child): keep
        // the group, cut the members that sit outside. One level down is
        // enough, below that the parts belong to a single placed object.
        for (const grandchild of child.children) {
          if ((grandchild as THREE.Light).isLight) continue;
          if (outsideRect(grandchild) === true) hidden.push(grandchild);
        }
      }
      this.isolateHiddenGroups = hidden;
    }
    for (const g of this.isolateHiddenGroups) g.visible = false;
  }

  /** Show/hide the green collider overlays without rebuilding them (Collider
   *  tab toggle). Playtest collision is unaffected; this is editor chrome. */
  setCollidersHidden(hidden: boolean): void {
    this.collidersUserHidden = hidden;
    if (this.collidersGroup) this.collidersGroup.visible = !hidden && !this.previewMode;
  }

  /** Show/hide the blue named-location area boxes without rebuilding them (Zone
   *  tool toggle). Editor chrome only; the locations themselves are unchanged. */
  setLocationsHidden(hidden: boolean): void {
    this.locationsUserHidden = hidden;
    if (this.locationsGroup) this.locationsGroup.visible = !hidden && !this.previewMode;
  }

  /** Live-refresh the fluid pool surfaces when a fluid placement changed. */
  private refreshFluidsIfNeeded(index?: number): void {
    if (!this.renderer) return;
    if (index !== undefined) {
      const p = this.map.placements[index];
      if (!p || !isFluidAssetId(p.assetId)) return;
    }
    this.renderer.editor.rebuildFluids(fluidVolumesFromPlacements(this.map.placements));
  }

  /** Refresh ONE overlay mesh after a live transform/size edit at `index`. */
  private updateColliderVolume(index: number): void {
    if (!this.renderer || !this.collidersGroup) return;
    const old = this.colliderMeshes.get(index);
    const v = this.colliderVolumeAt(index);
    if (old) {
      this.collidersGroup.remove(old);
      old.geometry.dispose();
      this.colliderMeshes.delete(index);
    }
    if (!v) return;
    const mesh = this.colliderVolumeMesh(
      v,
      index === this.selectedIndex,
      this.map.placements[index],
    );
    this.colliderMeshes.set(index, mesh);
    this.collidersGroup.add(mesh);
  }

  private colliderVolumeMesh(v: ColliderVolume, selected: boolean, p: AssetPlacement): THREE.Mesh {
    // Detached collider overlays float at their frozen ground; every kind adds the
    // shared vertical offset so a lifted wall/box/sphere overlay tracks the gizmo.
    const ground = p.detached ? (p.groundY ?? 0) : terrainHeight(v.x, v.z, this.seed);
    const yOff = p.y ?? 0;
    let geo: THREE.BufferGeometry;
    let y: number;
    if (v.kind === 'sphere') {
      geo = new THREE.SphereGeometry(v.sizeX / 2, 20, 14);
      y = ground + yOff + v.sizeX / 2;
    } else if (v.kind === 'plane') {
      geo = new THREE.BoxGeometry(v.sizeX, 0.12, v.sizeZ);
      y = ground + yOff + v.sizeY + 0.06;
    } else {
      geo = new THREE.BoxGeometry(v.sizeX, v.sizeY, v.sizeZ);
      y = ground + yOff + v.sizeY / 2;
    }
    const mesh = new THREE.Mesh(geo, selected ? this.colliderSelMat : this.colliderMat);
    mesh.position.set(v.x, y, v.z);
    // Euler 'XYZ' (three default), the same composition groundHeight() uses to
    // walk a tilted plane; boxes/spheres never carry rotX/rotZ.
    mesh.rotation.set(v.rotX ?? 0, v.rotY, v.rotZ ?? 0);
    mesh.renderOrder = 2;
    return mesh;
  }

  private disposeColliderVolumes(): void {
    if (this.collidersGroup) {
      this.renderer?.scene.remove(this.collidersGroup);
      for (const child of this.collidersGroup.children) {
        (child as THREE.Mesh).geometry.dispose();
      }
      this.collidersGroup = null;
    }
    this.colliderMeshes.clear();
  }

  // Swap to a different document (load/new/import) without leaking: rebuild the
  // Sim+Renderer since spawns come from the map (and the GL context is replaced).
  // Bumping the generation first abandons any start() still awaiting assets, so
  // a reload during boot can never leave two engines running.
  async reload(map: CustomMap): Promise<void> {
    this.generation++;
    this.buildingPlane = null;
    this.buildingFloorFilter = { id: null, level: 0, hideAbove: false };
    this.map = map;
    this.detachEvents();
    this.teardownEngine();
    await this.start();
  }

  /**
   * Show/hide the viewport. Hidden: the render loop stops (no rAF pending) and
   * the edit passthroughs record dirty flags instead of doing GPU work. Shown:
   * flush the coalesced work, then resume the loop.
   */
  setVisible(v: boolean): void {
    this.parent.style.display = v ? '' : 'none';
    if (v === this.visible) return;
    this.visible = v;
    if (!v) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    this.flushHiddenWork();
    if (this.renderer) {
      this.lastT = performance.now();
      this.loop();
    }
  }

  setAxisWidgetVisible(on: boolean): void {
    this.axisWidgetVisible = on;
    if (this.axisWidget) this.axisWidget.style.display = on ? '' : 'none';
    if (on) this.syncAxisWidget(true);
  }

  /** Apply the edits coalesced while hidden (called on becoming visible). */
  private flushHiddenWork(): void {
    if (!this.renderer) {
      // start() is still pending; it builds from the full document and clears
      // these flags itself.
      return;
    }
    if (this.hiddenTerrainFull) {
      this.hiddenTerrainFull = false;
      this.hiddenTerrainRegion = null;
      this.hiddenWater = false;
      this.hiddenSpawn = false;
      this.rebuildTerrainFull(); // terrain + water + full reSeat + spawn ring
    } else if (this.hiddenTerrainRegion) {
      const region = this.hiddenTerrainRegion;
      this.hiddenTerrainRegion = null;
      this.hiddenSpawn = false;
      this.renderer.editor.rebuildTerrain(region);
      this.renderer.editor.rebakeTerrainNormals(region);
      this.renderer.editor.rebuildWater(region);
      this.renderer.placedAssets.reSeat(region);
      this.refreshSpawnRing();
    }
    if (this.hiddenWater) {
      this.hiddenWater = false;
      this.renderer.editor.rebuildWater();
    }
    if (this.hiddenPlacements) {
      this.hiddenPlacements = false;
      this.renderer.placedAssets.rebuildAll(this.renderPlacements(this.map.placements));
      this.renderer.placedAssets.setSelected(this.selectedIndex);
      this.hiddenColliders = true;
    }
    if (this.hiddenSpawn) {
      this.hiddenSpawn = false;
      this.refreshSpawnRing();
    }
    if (this.hiddenBlockers) {
      this.hiddenBlockers = false;
      this.rebuildBlockers();
    }
    if (this.hiddenColliders) {
      this.hiddenColliders = false;
      this.refreshColliderVolumes();
    }
  }

  private clearHiddenWork(): void {
    this.hiddenTerrainFull = false;
    this.hiddenTerrainRegion = null;
    this.hiddenWater = false;
    this.hiddenPlacements = false;
    this.hiddenSpawn = false;
    this.hiddenBlockers = false;
    this.hiddenColliders = false;
  }

  /** Narrow surface for the dungeon-layout mode (src/editor/dungeon/): the
   *  live renderer + camera + canvas while the engine runs, else null. The
   *  mode owns its own picking, overlays, and pointer capture on top of it. */
  dungeonStagePort(): {
    renderer: Renderer;
    cam: EditorCamera;
    canvas: HTMLCanvasElement;
  } | null {
    if (!this.renderer || this.disposed) return null;
    return { renderer: this.renderer, cam: this.cam, canvas: this.canvas };
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    cancelAnimationFrame(this.raf);
    this.detachEvents();
    this.teardownEngine();
    this.perfOverlay?.dispose();
    this.perfOverlay = null;
    setOccluderFadesDisabled(false);
  }

  // Free the GL context and remove the surfaces. A fresh canvas is needed for a
  // later start() because forceContextLoss() permanently kills this context.
  private teardownEngine(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.buildingPreview?.dispose();
    this.buildingPreview = null;
    this.buildingPlane = null;
    this.buildingFilteredIndices.clear();
    if (this.renderer) {
      const renderer = this.renderer;
      renderer.editorCam = null;
      void renderer
        .shutdown()
        .then(({ context }) => {
          context.getExtension('WEBGL_lose_context')?.loseContext();
        })
        .catch(() => {
          // GL teardown is best-effort.
        });
    }
    this.renderer = null;
    this.sim = null;
    this.authoredCampMobIds.clear();
    this.spawnRing = null;
    // The scene died with the GL context; just drop the overlay handles.
    this.blockersGroup = null;
    this.blockerPreviewMesh = null;
    this.collidersGroup = null;
    this.colliderMeshes.clear();
    this.multiSelGroup = null;
    this.mobSelGroup = null;
    this.mobSelMeshes.clear();
    this.npcSelGroup = null;
    this.npcSelMeshes.clear();
    this.hitboxGroup = null;
    this.hitboxEditState = null;
    this.cityPathGroup = null;
    this.cityGridGroup = null;
    this.cityGridKey = '';
    // The scene died with the GL context: drop the view (the state survives ,
    // start() re-feeds it so Collision Master rides out reloads).
    this.cmMeshView?.dispose();
    this.cmMeshView = null;
    this.studioRig = null;
    this.gizmo?.dispose();
    this.gizmo = null;
    this.gizmoDrag = null;
    this.grabFollow = false;
    this.canvas?.remove();
    this.nameplates?.remove();
    this.axisWidget?.remove();
  }

  // ---- loop ---------------------------------------------------------------

  private loop = (): void => {
    this.raf = 0;
    if (this.disposed || !this.visible || !this.renderer || !this.sim) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;

    this.applyKeys(dt);
    if (this.cam.advanceAxisTransition(dt)) this.resetTapCycle();
    // The camera ignores the terrain entirely (Blender-style): the pivot and
    // the camera may pass through or under the ground freely.
    // Teleport the frozen player to the ground under the LOD anchor: every
    // distance-keyed layer (foliage dressing, prop culls, zone prepare, view
    // distance) measures from the player, so the anchor decides what loads.
    //
    // The anchor is always the camera's EYE: what fills the viewport is what
    // loads, and when the stand-in is shown it stands directly under the
    // camera rather than out on the orbit pivot (which sits up to 500yd away
    // through cam.dist, a body planted there reads as a stray NPC in the
    // distance, not the maker's avatar).
    const anchor = this.cam.pose().pos;
    const ground = terrainHeight(anchor.x, anchor.z, this.seed);
    const player = this.sim.player;
    if (player) {
      player.pos.x = anchor.x;
      player.pos.z = anchor.z;
      player.pos.y = ground;
    }
    this.renderer.editorCam = this.cam.pose();
    this.syncAxisWidget();
    this.renderer.editor.setEditorOrthographic(this.orthographic, this.orthographicViewHeight());
    this.syncGizmo();
    this.syncMobSelectionRings();
    this.syncNpcSelectionRings();
    // Preview mode re-hides overlays each frame: refreshAuthoredOverlays and
    // friends rebuild their groups visible, so a one-shot hide would leak.
    if (this.previewMode) this.applyPreviewHide();
    if (this.isolateRect) this.applyZoneIsolateHide();
    // Wireframe applies to freshly added/rebuilt meshes too, so re-run each frame
    // while on, plus once more after it turns off to reset shared materials.
    if (this.wireframe || this.wireframeWasOn) {
      this.applyWireframe();
      this.wireframeWasOn = this.wireframe;
    }
    if (this.xray || this.xrayWasOn) {
      this.applyXray();
      this.xrayWasOn = this.xray;
    }
    // Real elapsed frame time, like the game loop (main.ts renderer.sync):
    // passing the fixed sim DT per rAF frame ran every visual clock (water,
    // weather, foliage sway, day/night) at 50ms per frame, 3x speed at
    // 60 FPS, 6x on a 120 Hz display.
    if (this.studio) this.enforceStudioHiding();
    this.renderer.sync(1, dt, null);
    this.updatePerfOverlay(dt);
    // Free rock/cave texture sets no placement/cave uses anymore (a maker
    // cycling the picker streams a full PBR set per pick). Throttled: the scan
    // is cheap but need not run every frame.
    this.groundGcAccum += dt;
    if (this.groundGcAccum >= 4) {
      this.groundGcAccum = 0;
      gcGroundTextureSets(this.map.placements, this.map.caves ?? []);
    }
    // The player is an LOD anchor, not editable content. sync() force-shows
    // the self view every frame (visible = true), so hiding it means keeping
    // its group DETACHED from the scene; the toggle re-attaches it.
    if (player) {
      const view = this.renderer.views.get(player.id);
      if (view) {
        if (this.showPlayer) {
          if (!view.group.parent) this.renderer.scene.add(view.group);
        } else if (view.group.parent) {
          view.group.parent.remove(view.group);
        }
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Feed the perf overlay a smoothed stats snapshot (throttled to ~6 Hz so the
   *  numbers are readable). Draw calls / triangles come from the WebGLRenderer's
   *  render info for the frame we just drew. */
  private updatePerfOverlay(dt: number): void {
    const overlay = this.perfOverlay;
    if (!overlay || !overlay.enabled || !this.renderer) return;
    // Exponential smoothing on frame time (ms) so FPS is not jittery.
    const frameMs = dt * 1000;
    this.perfMsSmoothed =
      this.perfMsSmoothed === 0
        ? frameMs
        : this.perfMsSmoothed + (frameMs - this.perfMsSmoothed) * 0.1;
    this.perfUpdateAccum += dt;
    if (this.perfUpdateAccum < 1 / 6) return;
    this.perfUpdateAccum = 0;
    const streaming = this.renderer.zoneStreamingStats();
    overlay.update({
      fps: this.perfMsSmoothed > 0 ? 1000 / this.perfMsSmoothed : 0,
      frameMs: this.perfMsSmoothed,
      assets: this.map.placements.length,
      // The frame we just drew (culled and LOD-hidden geometry excluded). Not
      // the raw three counter: on composer tiers that one is monotonic and
      // read 5.2 billion after a couple of minutes.
      tris: this.renderer.editor.frameTriangles(),
      selTris: this.selectedTriangleCount(),
      terrain: this.map.terrainEdits.length,
      streaming: `${streaming.prepared} detail / ${streaming.pending} queued`,
      // The camera's world focus point (orbit pivot), so the maker always knows
      // WHERE they are on the map.
      coordX: this.cam.target.x,
      coordZ: this.cam.target.z,
    });
  }

  /** Triangles in the selected placements' models: the active one plus every
   *  multi-selection member. Model triangles, not drawn ones, so the number
   *  describes the assets whatever the camera is doing. */
  private selectedTriangleCount(): number {
    const view = this.renderer?.placedAssets;
    if (!view) return 0;
    let total = 0;
    if (this.selectedIndex !== null) total += view.triangleCount(this.selectedIndex);
    for (const i of this.multiSelIndices) {
      if (i !== this.selectedIndex) total += view.triangleCount(i);
    }
    return total;
  }

  private applyKeys(dt: number): void {
    // Fly while a navigation drag is held, or any time in Free-Fly mode: the
    // single-key tool shortcuts own these keys otherwise (see capturesKey).
    if (!this.isNavigating() && !this.freeFly) return;
    const f = (this.keys.has('w') ? 1 : 0) - (this.keys.has('s') ? 1 : 0);
    const r = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0);
    const u = (this.keys.has('e') ? 1 : 0) - (this.keys.has('q') ? 1 : 0);
    if (f || r || u) {
      this.cam.fly(f, r, u, dt);
      this.resetTapCycle();
    }
  }

  // ---- input --------------------------------------------------------------

  private attachEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onInputBlur);
  }

  private detachEvents(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onInputBlur);
    this.keys.clear();
    this.dragMode = 'none';
    this.pendingPlaceIdx = null;
    this.marquee = null;
    this.updateMarqueeEl();
  }

  private onInputBlur = (): void => {
    this.keys.clear();
  };

  private onPointerCancel = (ev: PointerEvent): void => {
    if (this.dragMode === 'edit') this.onPointerUp(ev);
  };

  private onContext = (e: Event): void => e.preventDefault();

  private onPointerDown = (ev: PointerEvent): void => {
    this.lastPointer = { x: ev.clientX, y: ev.clientY };
    this.dragDist = 0;
    // A Shift+D grab in flight: the next left press confirms where the copies
    // landed (before any navigation/tool routing).
    if (this.grabFollow && ev.button === 0) {
      this.cancelGrabFollow();
      this.hooks.onPlacementDragEnd();
      return;
    }
    // Blender navigation takes precedence over EVERY tool: Shift+drag pans and
    // middle-drag / Alt+drag orbits no matter what is active, so moving around
    // the map never requires leaving the current tool. Exceptions: sculpting
    // claims Shift+LEFT-drag as its inverted stroke, and Ctrl/Cmd+Shift-drag
    // accumulates placement marquees.
    const wantsAdditiveMarquee =
      ev.button === 0 && ev.shiftKey && (ev.ctrlKey || ev.metaKey) && !this.hooks.toolActive();
    if (ev.shiftKey && !wantsAdditiveMarquee) {
      const shiftEdit = ev.button === 0 && this.hooks.toolActive() && this.hooks.shiftEditsTool();
      if (!shiftEdit) {
        this.dragMode = 'pan';
        this.canvas.setPointerCapture(ev.pointerId);
        return;
      }
    }
    if (ev.button === 1 || (ev.button === 0 && ev.altKey)) {
      this.dragMode = 'orbit';
      this.canvas.setPointerCapture(ev.pointerId);
      return;
    }
    // Collision Master sub-element handles claim their drags like the gizmo:
    // a left press on a vertex/edge/face handle reshapes the box directly.
    if (ev.button === 0 && this.hitboxHandles?.active && this.renderer) {
      const rect = this.canvas.getBoundingClientRect();
      this.pickNdc.set(
        ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
      if (this.hitboxHandles.beginDrag(this.picker)) {
        this.dragMode = 'hitboxhandle';
        this.canvas.setPointerCapture(ev.pointerId);
        return;
      }
    }
    // The gizmo owns its handles outright: a left-press on one starts an
    // axis-constrained transform drag before the tool routing.
    if (ev.button === 0 && this.gizmo?.group.visible) {
      const axis = this.gizmoPick(ev.clientX, ev.clientY);
      if (axis !== null && this.beginGizmoDrag(axis, ev.clientX, ev.clientY)) {
        this.canvas.setPointerCapture(ev.pointerId);
        return;
      }
    }
    const wantsEdit = ev.button === 0 && this.hooks.toolActive();
    if (wantsEdit) {
      const w = this.surfaceAt(ev.clientX, ev.clientY);
      if (w) {
        this.dragMode = 'edit';
        this.hooks.onEditStart(w, ev);
        this.canvas.setPointerCapture(ev.pointerId);
        return;
      }
    }
    // Ctrl+left-drag in Select mode: marquee box select over the placements
    // (Cmd works too, Ctrl+drag is a system gesture on mac). In a Collision
    // Master sub mode, a PLAIN left-drag on empty space (no vertex/edge/face
    // under the cursor) box-selects vertices, Blender's edit-mode drag.
    const cmPlainMarquee =
      this.cmMeshState !== null &&
      this.cmMeshState.mode !== null &&
      this.pickCmComponent(ev.clientX, ev.clientY) === null;
    if (
      ev.button === 0 &&
      (ev.ctrlKey || ev.metaKey || cmPlainMarquee) &&
      !this.hooks.toolActive()
    ) {
      this.dragMode = 'marquee';
      this.marquee = {
        x0: ev.clientX,
        y0: ev.clientY,
        x1: ev.clientX,
        y1: ev.clientY,
        additive: ev.shiftKey && (ev.ctrlKey || ev.metaKey),
      };
      this.updateMarqueeEl();
      this.canvas.setPointerCapture(ev.pointerId);
      return;
    }
    // Select-mode direct move: a left press on a pickable placement DEFERS,
    // it only becomes a move once the pointer moves past the tap threshold
    // (onPointerMove). A stationary release stays a tap so repeated clicks cycle
    // through overlapping objects (onPointerUp). Empty ground orbits as before.
    if (ev.button === 0 && !this.hooks.toolActive() && this.hooks.placementDragEnabled()) {
      // Pixel-precise NPC/mob body hits first: they beat a nearby placement's
      // slack radius. Both behave exactly like placements from here on.
      const npcDirect = this.pickRuntimeNpc(ev.clientX, ev.clientY, true);
      if (npcDirect !== null) {
        this.pendingNpcKey = npcDirect;
        this.dragMode = 'npcpending';
        this.canvas.setPointerCapture(ev.pointerId);
        return;
      }
      const mobDirect = this.pickRuntimeMob(ev.clientX, ev.clientY, true);
      if (mobDirect !== null) {
        this.pendingMobId = mobDirect.id;
        this.dragMode = 'mobpending';
        this.canvas.setPointerCapture(ev.pointerId);
        return;
      }
      const idx = this.pickPlacement(ev.clientX, ev.clientY);
      if (idx !== null) {
        this.pendingPlaceIdx = idx;
        this.dragMode = 'placepending';
        this.canvas.setPointerCapture(ev.pointerId);
        return;
      }
      // Loose passes (projected body/nameplate) only after placements miss.
      const npcLoose = this.pickRuntimeNpc(ev.clientX, ev.clientY);
      if (npcLoose !== null) {
        this.pendingNpcKey = npcLoose;
        this.dragMode = 'npcpending';
        this.canvas.setPointerCapture(ev.pointerId);
        return;
      }
      const mobLoose = this.pickRuntimeMob(ev.clientX, ev.clientY);
      if (mobLoose !== null) {
        this.pendingMobId = mobLoose.id;
        this.dragMode = 'mobpending';
        this.canvas.setPointerCapture(ev.pointerId);
        return;
      }
    }
    // Everything else orbits (left-drag on empty ground in Select, right-drag).
    this.dragMode = 'orbit';
    this.canvas.setPointerCapture(ev.pointerId);
  };

  private onPointerMove = (ev: PointerEvent): void => {
    const dx = ev.clientX - this.lastPointer.x;
    const dy = ev.clientY - this.lastPointer.y;
    this.lastPointer = { x: ev.clientX, y: ev.clientY };
    this.dragDist += Math.abs(dx) + Math.abs(dy);
    if (this.dragMode === 'orbit') {
      if (this.freeFly) this.cam.look(dx, dy);
      else this.cam.orbit(dx, dy);
      this.resetTapCycle();
    } else if (this.dragMode === 'pan') {
      this.cam.pan(dx, dy);
      this.resetTapCycle();
    } else if (this.dragMode === 'edit') {
      // Sculpting tanks the frame rate, so queued pointermoves can arrive
      // AFTER the physical button release: without this gate the brush "fires
      // again" at the release point. buttons === 0 means the press is over.
      if (ev.buttons === 0) return;
      // The stroke spacing gate is in WORLD yards, so zoomed out the couple of
      // pixels of jitter inside a plain click can clear it and double-stamp
      // the press point at release. A move only strokes once it is a real
      // drag; the press already stamped via onEditStart.
      if (this.dragDist <= TAP_SLOP_PX) return;
      const w = this.surfaceAt(ev.clientX, ev.clientY);
      if (w) this.hooks.onEditMove(w, ev);
    } else if (this.dragMode === 'hitboxhandle') {
      if (this.hitboxHandles && this.renderer) {
        const rect = this.canvas.getBoundingClientRect();
        this.pickNdc.set(
          ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
          -((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
        );
        this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
        const box = this.hitboxHandles.moveDrag(this.picker);
        if (box && this.handleBoxIndex >= 0) {
          this.hooks.onHitboxHandleEdit(this.handleBoxIndex, box);
        }
      }
    } else if (this.dragMode === 'gizmo') {
      this.updateGizmoDrag(ev.clientX, ev.clientY, ev.shiftKey);
    } else if (this.dragMode === 'marquee') {
      if (this.marquee) {
        this.marquee.x1 = ev.clientX;
        this.marquee.y1 = ev.clientY;
        this.updateMarqueeEl();
      }
    } else if (this.dragMode === 'placepending') {
      // Promote a deferred placement press to an actual move once it passes the
      // tap threshold; the app claims it (selecting the placement) and we stream
      // the ground point from here on.
      if (this.dragDist > TAP_SLOP_PX && this.pendingPlaceIdx !== null) {
        const idx = this.pendingPlaceIdx;
        this.pendingPlaceIdx = null;
        if (this.hooks.onPlacementDragStart(idx)) {
          this.dragMode = 'moveplacement';
          this.canvas.style.cursor = 'grabbing';
          const w = this.surfaceAt(ev.clientX, ev.clientY);
          if (w) this.hooks.onPlacementDragMove(w);
        } else {
          this.dragMode = 'orbit';
        }
      }
    } else if (this.dragMode === 'moveplacement') {
      const w = this.surfaceAt(ev.clientX, ev.clientY);
      if (w) this.hooks.onPlacementDragMove(w);
    } else if (this.dragMode === 'npcpending') {
      // Same promotion contract as placepending: past the tap threshold the
      // app claims the drag (selecting the NPC) and the ground point streams.
      if (this.dragDist > TAP_SLOP_PX && this.pendingNpcKey !== null) {
        const key = this.pendingNpcKey;
        this.pendingNpcKey = null;
        if (this.hooks.onNpcDragStart(key)) {
          this.dragMode = 'movenpc';
          this.canvas.style.cursor = 'grabbing';
          const w = this.surfaceAt(ev.clientX, ev.clientY);
          if (w) this.hooks.onNpcDragMove(w);
        } else {
          this.dragMode = 'orbit';
        }
      }
    } else if (this.dragMode === 'movenpc') {
      const w = this.surfaceAt(ev.clientX, ev.clientY);
      if (w) this.hooks.onNpcDragMove(w);
    } else if (this.dragMode === 'mobpending') {
      if (this.dragDist > TAP_SLOP_PX && this.pendingMobId !== null) {
        const id = this.pendingMobId;
        this.pendingMobId = null;
        if (this.hooks.onMobDragStart(id)) {
          this.dragMode = 'movemob';
          this.canvas.style.cursor = 'grabbing';
          const w = this.surfaceAt(ev.clientX, ev.clientY);
          if (w) this.hooks.onMobDragMove(w);
        } else {
          this.dragMode = 'orbit';
        }
      }
    } else if (this.dragMode === 'movemob') {
      const w = this.surfaceAt(ev.clientX, ev.clientY);
      if (w) this.hooks.onMobDragMove(w);
    } else if (this.grabFollow) {
      // Shift+D grab: the duplicates chase the cursor with no button held.
      const w = this.surfaceAt(ev.clientX, ev.clientY);
      if (w) this.hooks.onPlacementDragMove(w);
    } else {
      // Only terrain/placement authoring tools draw a world-space hover brush.
      // Select/Move/Rotate/Scale used to ray-march terrain (up to 96 samples)
      // on every plain pointermove despite immediately clearing that brush.
      const wantsSurface = this.hooks.toolActive();
      if (wantsSurface) {
        this.hoverSurfaceActive = true;
        this.hooks.onHover(this.surfaceAt(ev.clientX, ev.clientY));
      } else if (this.hoverSurfaceActive) {
        this.hoverSurfaceActive = false;
        this.hooks.onHover(null);
      }
      this.updateHoverCursor(ev.clientX, ev.clientY);
    }
  };

  /** Grab-cursor feedback over pickable placements (Select mode, throttled). */
  private updateHoverCursor(clientX: number, clientY: number): void {
    if (!this.hooks.placementDragEnabled()) {
      if (this.canvas.style.cursor) this.canvas.style.cursor = '';
      return;
    }
    const now = performance.now();
    if (now - this.lastHoverPickAt < HOVER_PICK_MS) return;
    this.lastHoverPickAt = now;
    if (!this.renderer) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.renderer.editor.setRaycasterFromCamera(this.picker, this.pickNdc);
    const overPlacement = this.renderer.placedAssets.hasCandidateNearRay(
      this.picker,
      rect.height,
      EDITOR_VERTICAL_FOV_DEG,
      this.orthographic ? this.orthographicViewHeight() : undefined,
    );
    const want = overPlacement ? 'grab' : '';
    if (this.canvas.style.cursor !== want) this.canvas.style.cursor = want;
  }

  private onPointerLeave = (): void => {
    if (this.dragMode === 'none') this.hooks.onHover(null);
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (this.dragMode === 'marquee') {
      // A Ctrl+click that never became a real drag is an ADDITIVE tap
      // (Ctrl/Shift+click toggle alike), not an empty marquee clearing the
      // selection.
      const tap = this.dragDist <= TAP_SLOP_PX;
      const additive = this.marquee?.additive ?? false;
      // Collision Master sub modes: the marquee lassos VERTICES of the
      // selected volume (Blender's box select in edit mode). Hitbox-edit mode
      // lassos COLLISION BOXES; everywhere else, placements.
      const overCmVerts = this.cmMeshState !== null && this.cmMeshState.mode !== null;
      const overHitboxes = !overCmVerts && this.hitboxEditState !== null;
      const indices = tap
        ? null
        : overCmVerts
          ? this.cmVertsInMarquee()
          : overHitboxes
            ? this.hitboxesInMarquee()
            : this.placementsInMarquee();
      this.marquee = null;
      this.updateMarqueeEl();
      if (indices === null) {
        this.hooks.onTap(ev.clientX, ev.clientY, null, true);
      } else if (overCmVerts) {
        this.hooks.onCmMarquee(indices);
      } else if (overHitboxes) {
        this.hooks.onHitboxBoxSelect(indices);
      } else {
        this.hooks.onBoxSelect(indices, additive);
      }
    } else if (this.dragMode === 'hitboxhandle') {
      this.hitboxHandles?.endDrag();
      this.hooks.onHitboxHandleCommit();
      this.refreshHitboxHandles();
    } else if (this.dragMode === 'gizmo') {
      this.gizmoDrag = null;
      this.hooks.onGizmoEnd();
    } else if (this.dragMode === 'edit') {
      this.hooks.onEditEnd(ev);
    } else if (this.dragMode === 'moveplacement') {
      this.hooks.onPlacementDragEnd();
      // The pointer is usually still over the moved placement.
      this.canvas.style.cursor = this.hooks.placementDragEnabled() ? 'grab' : '';
    } else if (this.dragMode === 'movenpc') {
      this.hooks.onNpcDragEnd();
      this.canvas.style.cursor = '';
    } else if (this.dragMode === 'movemob') {
      this.hooks.onMobDragEnd();
      this.canvas.style.cursor = '';
    } else if (this.dragMode === 'placepending' && ev.button === 0) {
      // A press on a placement that never moved past the tap threshold: a
      // Select-mode tap. Route through onTap so repeated clicks on overlapping
      // objects cycle the selection.
      this.pendingPlaceIdx = null;
      this.hooks.onTap(ev.clientX, ev.clientY, null, false);
    } else if (this.dragMode === 'npcpending' && ev.button === 0) {
      // A stationary press on an NPC: a Select-mode tap (select it).
      this.pendingNpcKey = null;
      this.hooks.onTap(ev.clientX, ev.clientY, null, false);
    } else if (this.dragMode === 'mobpending' && ev.button === 0) {
      // A stationary press on a mob: a Select-mode tap (select it).
      this.pendingMobId = null;
      this.hooks.onTap(ev.clientX, ev.clientY, null, false);
    } else if (
      (this.dragMode === 'orbit' || this.dragMode === 'pan') &&
      ev.button === 0 &&
      this.dragDist <= TAP_SLOP_PX
    ) {
      // A left tap with no edit tool armed: a Select-mode pick. A tap that
      // began as Shift+drag pan (additive) extends the selection instead.
      this.hooks.onTap(ev.clientX, ev.clientY, null, this.dragMode === 'pan');
    }
    this.dragMode = 'none';
  };

  private onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    // Some platforms report Shift+wheel as a horizontal delta.
    const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
    if (delta === 0) return;
    if (
      (ev.shiftKey || ev.altKey) &&
      this.hooks.onTransformWheel(ev.altKey ? 'scale' : 'rotate', delta)
    ) {
      return;
    }
    // Free-Fly: the wheel is the throttle. Dollying here would move the camera
    // AND re-gear the flight off the same notch, which is the coupling this
    // replaces; orbit mode keeps the wheel as its zoom.
    if (this.freeFly) {
      this.hooks.onFlySpeedWheel(delta);
      this.resetTapCycle();
      return;
    }
    this.cam.zoom(delta);
    this.resetTapCycle();
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    // Typing in a field must never start the camera moving (Free-Fly listens
    // even with no drag held).
    const target = ev.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      return;
    }
    const k = ev.key.toLowerCase();
    // Shifted keys are commands (Shift+D duplicates, Shift+F toggles fly),
    // never camera movement; pressing Shift mid-flight also stops the held
    // keys so Shift+D can never strafe the camera while duplicating.
    if (ev.shiftKey) {
      this.keys.clear();
      return;
    }
    if (shouldAcceptCameraMovementKey(k, ev.repeat, this.keys.has(k))) this.keys.add(k);
  };

  private onKeyUp = (ev: KeyboardEvent): void => {
    this.keys.delete(ev.key.toLowerCase());
  };
}
