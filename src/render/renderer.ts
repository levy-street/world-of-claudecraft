import * as THREE from 'three';
import { ALL_CLASSES, isQuestTurnInNpc, type Entity, type SimEvent } from '../sim/types';
import { OVERHEAD_EMOTES, type IWorld } from '../world_api';
import { groundHeight, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import { drapeRingLocalY } from './selection_ring';
import {
  CLASSES, MOBS, ABILITIES, DUNGEON_X_THRESHOLD, DUNGEON_LIST, QUESTS,
  instanceOrigin, INSTANCE_SLOT_COUNT, ARENA_SLOT_COUNT, arenaOrigin, isArenaPos, dungeonAt,
  WORLD_MAX_Z, WORLD_MIN_Z, ZONES,
} from '../sim/data';
import { cameraOcclusion } from '../sim/colliders';
import type { BiomeId } from '../sim/types';
import { AnimState, CharacterVisual, createCharacterVisual } from './characters';
import { skinCount, visualKeyFor } from './characters/manifest';
import { mechAssetsReady, preloadMechAssets } from './characters/assets';
import { isVisuallyDead } from './anim_state';
import { clickMarkerAnim, clickMarkerColor, CLICK_MARKER_LIFETIME } from './click_marker';
import { LocoTrack, newLocoTrack, updateLocomotion } from './locomotion';
import type { SpatialAudioSink, Surface } from './audio_sink';
import { buildPropMaterialPrewarmGroup, buildProps } from './props';
import { plankTexture, sparkleTexture } from './textures';
import { DungeonInteriors, ensureDungeonAssets } from './dungeon';
import { buildGroundQuestObject } from './quest_objects';
import { Vfx } from './vfx';
import { Weather } from './weather';
import {
  GFX, initGfxTier, sharedUniforms, SUN_ANCHOR, SUN_DIR, surfaceMat, urlForcedTier,
  type GfxBucketBands, type GfxBucketLevels,
} from './gfx';
import { buildComposer, PostPipeline } from './post';
import { buildTerrain, TerrainView } from './terrain';
import { buildWater, WaterView } from './water';
import { buildClouds, buildSky, SkyView } from './sky';
import { buildFoliage, type FoliagePerfStats, type FoliageView } from './foliage';
import { buildFish, FishView } from './fish';
import { buildCritters, CritterField } from './critters';
import { buildMotes, MotesView } from './motes';
import { buildBirds, BirdsView } from './birds';
import { buildImpactSite, type ImpactSiteView } from './impact_site';
import { shouldRenderStealthGhost } from './stealth';
import { downscaleDims } from './screenshot';
import { RenderBudgetGovernor, type RenderBudgetState } from './render_budget';
import { t } from '../ui/i18n';
import { tEntity } from '../ui/entity_i18n';
import { raidMarkerDataUrl } from '../ui/icons';
import { holderTierByIndex, holderTierBadgeDataUrl, holderTierDisplayName } from '../ui/holder_tier';
import { isProjectedNameplateAnchorVisible, nameplateScreenTransform } from './nameplate_projection';
import { comboPipsFor, COMBO_PIP_MAX } from './nameplate_combo';
import { stepCameraOcclusion, type CameraOcclusionState } from './camera_collision';
import { castBarState } from './cast_bar';
import { isMobThreateningViewer } from './nameplate_threat';
import { characterSoulRendActive } from './character_effects';
import { FRIENDLY, isFriendlyPet, isOwnedPetHostile, mobNameColor } from './reaction';

const NAMEPLATE_RANGE = 55;
const NAMEPLATE_RANGE_SQ = NAMEPLATE_RANGE * NAMEPLATE_RANGE;
const emoteIconUrl = (id: string): string => `/ui/emotes/emote-${id}.png`;
// Entities further than this from the player are hidden entirely: their rigs
// are several draw calls each and read as sub-pixel specks long before this.
const ENTITY_DRAW_RANGE = 80;
const ENTITY_VIEW_CREATE_RANGE_SQ = ENTITY_DRAW_RANGE * ENTITY_DRAW_RANGE;
const ENTITY_VIEW_DESTROY_RANGE_SQ = 96 * 96;
const VIEW_CREATE_BUDGET_LOW = 2;
const VIEW_CREATE_BUDGET_HIGH = 8;
const VIEW_CREATE_SLOW_FRAME_MS = 33;
const VIEW_CREATE_HITCH_FRAME_MS = 50;
const VIEW_CREATE_BACKOFF_SECONDS = 0.75;
const VIEW_PREWARM_RANGE_SQ = ENTITY_VIEW_CREATE_RANGE_SQ;
const VIEW_PREWARM_MAX_MS = 5000;
const VIEW_PREWARM_MAX_VIEWS_LOW = 48;
const VIEW_PREWARM_MAX_VIEWS_HIGH = 72;
const VIEW_CREATED_TYPE_SAMPLE_LIMIT = 24;
const PERSISTENT_PORTAL_VIEW_PREWARM_LIMIT = 16;
// rigs further than this stop casting articulated shadows (~7 draws each) and
// hand off to a single-draw static-pose shadow proxy (the merged far-LOD mesh
// with a colorWrite-off material) so mid-ground NPCs keep their grounding for
// ~1/7 the cost — the pose freeze is invisible in a shadow blob this far out
const ENTITY_SHADOW_RANGE_SQ = 25 * 25;
const ENTITY_PROXY_SHADOW_RANGE_SQ = 62 * 62;
// loot sparkles further than this are hidden (sub-pixel, real draw cost)
const SPARKLE_DRAW_RANGE_SQ = 40 * 40;
// beyond this, the articulated rig swaps for its single-draw merged far LOD.
// Keep the full rig just past nameplate range so nearby characters and held
// weapons stay readable on low while the 80u draw cap still bounds total cost.
const ENTITY_LOD_RANGE_SQ = 58 * 58;
// Feet-above-terrain margin that counts as "airborne" for the jump pose. Mirrors
// the sim's own 0.4u grounded tolerance (sim.ts), so walking slopes doesn't trip
// it but a jump (apex ~1.1u) does. Needed because online snapshots don't carry
// `onGround`, so the flag alone never fires the jump clip for the mirrored world.
const AIRBORNE_EPS = 0.4;
// Beyond this (squared) an entity's footsteps/movement are inaudible, so we skip
// the surface sample + dispatch entirely. Kept under the engine's own cutoff (46u).
const SFX_MOVE_RANGE_SQ = 42 * 42;
// Stride length (world units travelled) between footfalls — longer at a run.
const FOOT_STRIDE_WALK = 0.95;
const FOOT_STRIDE_RUN = 1.55;
const SWIM_STRIDE = 2.4;
const FOOT_RUN_SPEED = 4.5; // u/s — matches the run threshold in characters/anim_state.ts
// fire/torch point lights beyond this never shine (their falloff range is
// shorter anyway); the nearest GFX.maxPointLights within it win the budget
const LIGHT_BUDGET_RANGE_SQ = 55 * 55;
// HDR boosts so the bloom pass picks these out (composer tiers only)
const SELECTION_RING_BOOST = 1.5;
const SELECTION_RING_SPIN = 0.6; // rad/s — slow classic target-reticle rotation
const CLICK_MARKER_POOL = 4; // concurrent click-feedback markers before reuse
const SPARKLE_BOOST = 1.5;
const PORTAL_BOOST = 2;
// Third-person camera collision (see updateCamera). Prop colliders marked
// camGhost are hidden by props.ts/foliage.ts instead; this path is for
// non-hideable blockers such as large rocks and interior walls.
const CAMERA_COLLIDER_PAD = 0.35;
const CAMERA_SOFT_COLLIDER_PAD = 1.65;
const CAMERA_MIN_DIST = 1.2;
const CAMERA_PULL_IN_RATE = 10;
const CAMERA_PULL_OUT_RATE = 6;
const CAMERA_SOFT_PULL_WEIGHT = 0.45;
const CAMERA_BASE_FOV = 60;
const CAMERA_MAX_COMP_FOV = 98;
const SELF_RENDER_SMOOTH_RATE = 30;
const SELF_RENDER_SNAP_DIST_SQ = 6 * 6;
const SUN_HALO_OPACITY = 0.35; // bloom now supplies most of the halo
// lighting rig (high/ultra) — IBL supplies ambient, sun carries the key
const HEMI_INTENSITY = 0.45;
const SUN_INTENSITY = 2.8;
const ENV_INTENSITY = 0.5;
// dungeon interiors: kill the daylight so torchlight carries the scene
// (env at 0.15 still lit rigs sky-blue against the pitch-dark crypt)
const DUNGEON_SUN_INTENSITY = 0.3;
const DUNGEON_ENV_INTENSITY = 0.05;
// raw HDRI PMREMs integrate the real sun the dome shader clamps away —
// rescale so ambient matches the dome-capture look (see lookdev-hookup.md)
const IBL_RAW_SCALE = 0.55;
const DUNGEON_HEMI_INTENSITY = 0.22; // floor of readability — bosses crushed to black at 0.14
// character rim glow scales up underground so silhouettes split from the murk
const DUNGEON_RIM_BOOST = 2.4;
const RENDERER_PHASE_SAMPLE_LIMIT = 720;
const RENDER_DIAGNOSTICS_SAMPLE_MS = 2000;
const RENDER_DIAGNOSTICS_IDLE_TIMEOUT_MS = 1000;
const RENDER_STALL_ATTRIBUTION_MS = 80;
const PREWARM_MOB_TEMPLATE_IDS = [
  'forest_wolf',
  'wild_boar',
  'webwood_spider',
  'mudfin_murloc',
  'tunnel_rat',
  'vale_bandit',
  'restless_bones',
  'old_greyjaw',
  'mogger',
  'mire_widow',
  'fen_troll',
  'gravecaller_cultist',
  'stormcrag_elemental',
  'thornpeak_ogre',
  'glimmermere_wader',
  'sethrael_palecoil',
  'warlock_imp',
  'warlock_voidwalker',
] as const;
const PREWARM_OBJECT_ITEM_IDS = [
  'supply_crate',
  'lost_caravan_goods',
  'morthen_grimoire',
  'gravecaller_sigil',
  'weathered_ledger_page',
  'fen_muster_order',
  'rusted_censer',
  'bastion_ward_stone',
  'ogre_war_totem',
  'sanctum_key_shard',
  'gravewyrm_sigil',
  'crypt_ritual_circle',
] as const;
const PREWARM_MOB_POOL_COPIES = 3;
const PREWARM_OBJECT_POOL_COPIES = 2;

function prewarmPlayerSkinVariantCount(): number {
  return ALL_CLASSES.reduce((sum, cls) => sum + skinCount(`player_${cls}`), 0);
}

type RendererPhase = 'setup' | 'entities' | 'world' | 'nameplates' | 'submit' | 'total';
type RendererWorldPhase =
  | 'lights'
  | 'clouds'
  | 'water'
  | 'terrain'
  | 'props'
  | 'foliage'
  | 'fish'
  | 'vfx'
  | 'camera'
  | 'ambience'
  | 'shadows'
  | 'sky'
  | 'sunSprites'
  | 'godRays';
type RendererPhaseStats = Record<RendererPhase, { count: number; avg: number; p95: number; max: number }>;
type RendererFramePhaseMs = Record<RendererPhase, number>;
type RendererWorldPhaseMs = Record<RendererWorldPhase, number>;
type RenderDiagnosticsCategory = string;
type RenderableDiagnosticObject = THREE.Object3D & {
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  isSkinnedMesh?: boolean;
  isPoints?: boolean;
  isSprite?: boolean;
  isLine?: boolean;
  isLineSegments?: boolean;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
  count?: number;
};

type TextureBackedMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  bumpMap?: THREE.Texture | null;
  displacementMap?: THREE.Texture | null;
  emissiveMap?: THREE.Texture | null;
  envMap?: THREE.Texture | null;
  lightMap?: THREE.Texture | null;
  metalnessMap?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  specularMap?: THREE.Texture | null;
  gradientMap?: THREE.Texture | null;
};
type TextureMaterialKey = keyof Omit<TextureBackedMaterial, keyof THREE.Material>;
interface ViewCandidate {
  e: Entity;
  d2: number;
  priority: number;
}

export interface RenderDiagnosticsCategoryStats {
  objects: number;
  draws: number;
  triangles: number;
  points: number;
  materials: number;
  materialSamples: string[];
}

export interface RenderDiagnosticsSnapshot {
  enabled: boolean;
  totalObjects: number;
  estimatedDraws: number;
  estimatedTriangles: number;
  estimatedPoints: number;
  programs: number;
  programDelta: number;
  textures: number;
  textureDelta: number;
  newMaterials: string[];
  firstVisibleObjects: string[];
  categories: Record<RenderDiagnosticsCategory, RenderDiagnosticsCategoryStats>;
}

interface RendererFrameStats {
  phaseMs: RendererFramePhaseMs;
  worldPhaseMs: RendererWorldPhaseMs;
  foliage: FoliagePerfStats;
  renderDiagnostics: RenderDiagnosticsSnapshot;
  cameraPosition: { x: number; y: number; z: number };
  playerPosition: { x: number; y: number; z: number };
  biome: BiomeId;
  lastQualityChange: RendererQualityChangeStats | null;
  createdViews: number;
  createdViewTypes: string[];
  removedViews: number;
  candidateViews: number;
  activeViews: number;
  visibleViews: number;
}

interface RendererQualityChangeStats {
  atMs: number;
  ageMs: number;
  mode: RenderBudgetState['mode'];
  reason: RenderBudgetState['reason'];
  previousLevels: RenderBudgetState['levels'];
  levels: RenderBudgetState['levels'];
}

type RendererPrewarmCategory = 'views' | 'world' | 'sky' | 'props' | 'entities' | 'objects' | 'vfx' | 'post' | 'diagnostics';

interface RendererPrewarmManifestEntryStats {
  id: string;
  category: RendererPrewarmCategory;
  priority: number;
  required: boolean;
  status: 'completed' | 'skipped' | 'timed-out' | 'failed';
  elapsedMs: number;
  remainingMsAfter: number;
  passes: number;
  programsBefore: number;
  programsAfter: number;
  programDelta: number;
  texturesBefore: number;
  texturesAfter: number;
  textureDelta: number;
  detail?: string;
}

interface RendererPrewarmDiagnosticsBaselineStats {
  programs: number;
  textures: number;
  totalObjects: number;
  estimatedDraws: number;
  estimatedTriangles: number;
  categories: Record<string, { draws: number; triangles: number; materials: number }>;
}

export interface RendererPrewarmStats {
  elapsedMs: number;
  maxMs: number;
  createdViews: number;
  candidateViews: number;
  renderPasses: number;
  programsBefore: number;
  programsAfter: number;
  texturesBefore: number;
  texturesAfter: number;
  compileMode: 'async' | 'sync' | 'none';
  compileMs: number;
  compileTimedOut: boolean;
  timedOut: boolean;
  remainingMs: number;
  budgetUsedRatio: number;
  createdViewTypes: string[];
  manifestPlanned: number;
  manifestEntries: RendererPrewarmManifestEntryStats[];
  manifestCompleted: number;
  manifestSkipped: number;
  manifestTimedOut: number;
  manifestFailed: number;
  timedOutEntryIds: string[];
  failedEntryIds: string[];
  diagnosticsBaseline: RendererPrewarmDiagnosticsBaselineStats | null;
}

interface PooledObjectView {
  group: THREE.Group;
  height: number;
}

interface ClickMarkerSlot {
  group: THREE.Group;
  ring: THREE.Mesh;
  cross: THREE.Group;
  ringMat: THREE.MeshBasicMaterial;
  crossMat: THREE.MeshBasicMaterial;
  elapsed: number; // seconds since spawn; >= CLICK_MARKER_LIFETIME means free
}

function selfSnapshotAlpha(alpha: number, lead: number): number {
  return Math.min(1.25, alpha + Math.max(0, lead));
}

interface EntityView {
  group: THREE.Group;
  /** rigged glTF visual for characters; null for object views (doors/crates) */
  visual: CharacterVisual | null;
  visualKey: string | null;
  visualPoolKey: string | null;
  sheepVisual: CharacterVisual | null; // polymorph form, built lazily
  bearVisual: CharacterVisual | null; // druid bear form, built lazily
  catVisual: CharacterVisual | null; // druid cat form, built lazily
  travelVisual: CharacterVisual | null; // druid travel form (chicken-cow), built lazily
  skin: number; // last-rendered appearance skin — diffed each frame for live swaps
  /** unscaled height — nameplate/vfx anchor reads height * e.scale */
  height: number;
  /** last-applied entity scale (group.scale); diffed each frame for live size buffs */
  liveScale: number;
  /** what removeView pulls back out of clickTargets */
  clickTarget: THREE.Object3D;
  nameplate: HTMLDivElement;
  nameEl: HTMLDivElement;
  guildEl: HTMLDivElement; // <Guild> tag under the name (players only)
  hpBar: HTMLDivElement;
  hpFill: HTMLDivElement;
  emoteEl: HTMLDivElement;
  emoteIconEl: HTMLImageElement;
  emoteLabelEl: HTMLSpanElement;
  markerEl: HTMLDivElement;
  castBar: HTMLDivElement; // overhead spell cast/channel bar, below the hp bar
  castFill: HTMLDivElement;
  castLabel: HTMLDivElement;
  raidMarkEl: HTMLDivElement; // party raid/target marker, above the name
  comboRow: HTMLDivElement; // rogue/druid combo-point pips, above the name
  comboPips: HTMLDivElement[]; // the COMBO_PIP_MAX pip cells, lit left-to-right
  nameplateDisplay: string;
  nameplateTransform: string;
  nameplateSig: string;
  nameplateHpWidth: string;
  comboSig: string; // cheap-diff for the combo pip row
  tierEl: HTMLImageElement; // $WOC holder-tier flair badge (other players)
  tierValue: number; // last-applied holderTier, to diff cheaply
  sparkle?: THREE.Sprite; // ground objects
  objectMesh?: THREE.Object3D;
  objectPoolKey: string | null;
  portal?: THREE.Mesh; // dungeon door swirl
  objectCasters: THREE.Object3D[]; // object-view shadow meshes, distance-gated
  shadowOn: boolean;
  isFar: boolean;
  lastOverheadEmoteKey: string | null;
  // render-space position last frame, for true u/s locomotion speed
  lastX: number;
  lastZ: number;
  // locomotion-state hysteresis so a one-frame speed dip can't reset the
  // walk clip (see locomotion.ts)
  loco: LocoTrack;
  // spatial-audio state: distance travelled since the last footfall, and edge
  // latches for jump/land/water-entry detection.
  stepAccum: number;
  wasAirborne: boolean;
  wasSwimming: boolean;
}

function collectCasters(root: THREE.Object3D, into: THREE.Object3D[]): void {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).castShadow) into.push(o);
  });
}

function roundMs(v: number): number {
  return Math.round(v * 100) / 100;
}

function distSqXZ(a: Entity, b: Entity): number {
  const dx = a.pos.x - b.pos.x;
  const dz = a.pos.z - b.pos.z;
  return dx * dx + dz * dz;
}

function summarizeMs(values: number[]): { count: number; avg: number; p95: number; max: number } {
  if (values.length === 0) return { count: 0, avg: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  const p95Idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return {
    count: values.length,
    avg: roundMs(total / values.length),
    p95: roundMs(sorted[p95Idx]),
    max: roundMs(sorted[sorted.length - 1]),
  };
}

function emptyFramePhaseMs(): RendererFramePhaseMs {
  return { setup: 0, entities: 0, world: 0, nameplates: 0, submit: 0, total: 0 };
}

function emptyWorldPhaseMs(): RendererWorldPhaseMs {
  return {
    lights: 0,
    clouds: 0,
    water: 0,
    terrain: 0,
    props: 0,
    foliage: 0,
    fish: 0,
    vfx: 0,
    camera: 0,
    ambience: 0,
    shadows: 0,
    sky: 0,
    sunSprites: 0,
    godRays: 0,
  };
}

function emptyFoliagePerfStats(): FoliagePerfStats {
  return {
    modelQuality: 1,
    modelBuckets: 0,
    modelVisibleBuckets: 0,
    modelBucketsByLod: {},
    modelVisibleByLod: {},
    modelDraws: 0,
    modelVisibleDraws: 0,
    modelDrawsByLod: {},
    modelVisibleDrawsByLod: {},
    modelTriangles: 0,
    modelVisibleTriangles: 0,
    modelTrianglesByLod: {},
    modelVisibleTrianglesByLod: {},
    grassEnabled: false,
    grassQuality: 0,
    grassActiveRadius: 0,
    grassChunks: 0,
    grassReadyChunks: 0,
    grassVisibleChunks: 0,
    grassQueuedChunks: 0,
    grassTufts: 0,
    grassVisibleTufts: 0,
    grassBuiltChunks: 0,
    grassDisposedChunks: 0,
    grassLastBuildMs: 0,
    grassBuildMs: 0,
    grassCacheLimit: 0,
  };
}

function emptyRenderDiagnosticsSnapshot(): RenderDiagnosticsSnapshot {
  return {
    enabled: false,
    totalObjects: 0,
    estimatedDraws: 0,
    estimatedTriangles: 0,
    estimatedPoints: 0,
    programs: 0,
    programDelta: 0,
    textures: 0,
    textureDelta: 0,
    newMaterials: [],
    firstVisibleObjects: [],
    categories: {},
  };
}

function loopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function localRenderDiagnosticsEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof location === 'undefined') return false;
  if (!loopbackHostname(location.hostname)) return false;
  const params = new URLSearchParams(location.search);
  return params.get('perfTrace') === '1' || params.get('perf_trace') === '1' || params.get('renderTrace') === '1';
}

function setRenderCategory(obj: THREE.Object3D, category: RenderDiagnosticsCategory): void {
  obj.userData.renderCategory = category;
}

function isPersistentPortalObject(e: Entity): boolean {
  return e.kind === 'object' && (e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit');
}

function markSharedGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
  geometry.userData.sharedRendererResource = true;
  return geometry;
}

function markSharedMaterial<T extends THREE.Material>(material: T): T {
  material.userData.sharedRendererResource = true;
  return material;
}

function isSharedGeometry(geometry: THREE.BufferGeometry): boolean {
  return geometry.userData.sharedRendererResource === true;
}

function isSharedMaterial(material: THREE.Material): boolean {
  return material.userData.sharedRendererResource === true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}

function mobDisplayName(mobId: string): string {
  return tEntity({ kind: 'mob', id: mobId, field: 'name' });
}

function npcDisplayName(npcId: string): string {
  return tEntity({ kind: 'npc', id: npcId, field: 'name' });
}

function dungeonDisplayName(dungeonId: string): string {
  return tEntity({ kind: 'dungeon', id: dungeonId, field: 'name' });
}

function objectDisplayName(entity: Entity): string {
  if ((entity.templateId === 'dungeon_door' || entity.templateId === 'dungeon_exit') && entity.dungeonId) {
    const dungeonName = dungeonDisplayName(entity.dungeonId);
    return entity.templateId === 'dungeon_exit'
      ? t('worldContent.dungeonExitName', { name: dungeonName })
      : dungeonName;
  }
  // Collectible/quest ground objects carry the item id they grant; localize the
  // nameplate through the item dictionary instead of the raw English name.
  if (entity.objectItemId) return tEntity({ kind: 'item', id: entity.objectItemId, field: 'name' });
  return entity.name;
}

export class Renderer {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  webgl: THREE.WebGLRenderer;
  views = new Map<number, EntityView>();
  nameplateLayer: HTMLDivElement;
  selectionRing: THREE.Group;
  selectionRingMesh: THREE.Mesh;
  selectionRingTicks: THREE.Group;
  selectionRingMat: THREE.MeshBasicMaterial;
  // center-relative XZ of every base-ring vertex (cached) + scratch draped Y,
  // so sync() can re-drape the ring over the terrain without allocating.
  selectionRingLocalXZ: Float32Array;
  selectionRingDrapeY: Float32Array;
  // Pool of transient click-feedback markers (ring plus crossed "X"). Each slot is
  // a group reused round-robin, so rapid clicking never allocates. A slot with
  // `elapsed >= lifetime` is free. See click_marker.ts for the animation curves.
  private clickMarkers: ClickMarkerSlot[] = [];
  private clickMarkerNext = 0;
  raycaster = new THREE.Raycaster();
  clickTargets: THREE.Object3D[] = [];
  camYaw = Math.PI;
  camPitch = 0.32;
  camDist = 12;
  // Smoothed chase-cam occlusion (1 = no pull-in); see updateCamera.
  private camOcclusion: CameraOcclusionState = { pullT: 1, lensT: 1, fov: CAMERA_BASE_FOV };
  showNameplates = true;
  // settings-menu graphics knobs (applied live)
  private renderScale = 1; // user-requested resolution ceiling on top of the device pixel ratio
  private effectiveRenderScale = 1; // runtime value after adaptive backoff
  private frameMsEma = 16.7;
  private adaptiveGrace = 2.0;
  private adaptiveCooldown = 0;
  private viewCreateBackoff = 0;
  private stableFrameTime = 0;
  private renderBudgetGovernor!: RenderBudgetGovernor;
  private baseExposure = 1.12; // tone-mapping exposure at brightness 1.0
  private tmpV = new THREE.Vector3();
  private viewCandidates: ViewCandidate[] = [];
  private tmpV2 = new THREE.Vector3();
  // Manual frustum cull for characters. Their skinned meshes keep
  // frustumCulled=false (a skinned mesh's bind-pose bounds don't follow the
  // animated pose, so Three's own cull pops visible rigs out), which means an
  // off-screen rig otherwise issues its draws every frame. We instead cull at
  // the group level from the rig's real world position + a generous radius.
  // Gated to shadowless tiers so a culled off-screen caster can never drop a
  // shadow that was actually visible in-frame.
  private cullFrustum = new THREE.Frustum();
  private cullViewProj = new THREE.Matrix4();
  private cullSphere = new THREE.Sphere();
  private cullCharacters = false;
  private selfRenderPosition = new THREE.Vector3();
  private selfRenderPositionReady = false;
  private cameraLookAt = new THREE.Vector3();
  // floating /say-/yell bubbles, keyed by speaker entity id
  private chatBubbles = new Map<number, { el: HTMLDivElement; until: number }>();
  private sun: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private sky!: THREE.Mesh;
  private skyView!: SkyView;
  private sunSprites: THREE.Sprite[] = [];
  private sunDir = new THREE.Vector3();
  private sunAzimuth = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize();
  private clouds: THREE.Sprite[] = [];
  private waterView: WaterView;
  private terrainView: TerrainView;
  private foliage: FoliageView;
  private fish: FishView;
  private critters: CritterField;
  private motes: MotesView;
  private birds: BirdsView;
  private impactSite: ImpactSiteView;
  private fogScratch = new THREE.Color();
  private flames: THREE.Mesh[];
  private fireLights: THREE.PointLight[];
  private effectivePointLights = 0;
  private propsView!: {
    update(
      camX: number, camY: number, camZ: number,
      eyeX: number, eyeY: number, eyeZ: number,
      fogFar: number,
    ): void;
  };
  private lightRank: { light: THREE.PointLight; d2: number; worldPos: THREE.Vector3 }[] = [];
  private doomedIds: number[] = [];
  private dungeons: DungeonInteriors | null = null;
  private envRTs = new Map<BiomeId, THREE.WebGLRenderTarget>();
  private envBiome: BiomeId = 'vale';
  private envOutdoorIntensity = ENV_INTENSITY;
  private time = 0;
  private frameIdx = 0;
  vfx: Vfx;
  private weather: Weather;
  private weatherOn = true;
  private audioSink: SpatialAudioSink | null = null;

  // 2v2 Fiesta juice: trauma-based screen shake (decays each frame) and the
  // hazard-ring wall (built lazily the first time a Fiesta bout asks for it).
  private shakeTrauma = 0;
  private shakeElapsed = 0;
  private fiestaRing: THREE.Mesh | null = null;
  private fiestaPowerupMeshes = new Map<number, THREE.Mesh>();
  // Per-entity power-up glow: emits a coloured swirl around the carrier until it expires.
  private fiestaGlows = new Map<number, { color: number; until: number; nextSwirl: number }>();

  private lowGfx: boolean;
  private post: PostPipeline | null = null;
  private godRays: THREE.Sprite[] = [];
  private viewport = { width: 1, height: 1 };
  private viewportPollTimer = 0;
  private nameplateTimer = 0;
  private glVendor = '';
  private glRenderer = '';
  private contextLostCount = 0;
  private contextRestoredCount = 0;
  private phaseSamples: Record<RendererPhase, number[]> = {
    setup: [],
    entities: [],
    world: [],
    nameplates: [],
    submit: [],
    total: [],
  };
  private lastFrameStats: RendererFrameStats = {
    phaseMs: emptyFramePhaseMs(),
    worldPhaseMs: emptyWorldPhaseMs(),
    foliage: emptyFoliagePerfStats(),
    renderDiagnostics: emptyRenderDiagnosticsSnapshot(),
    cameraPosition: { x: 0, y: 0, z: 0 },
    playerPosition: { x: 0, y: 0, z: 0 },
    biome: 'vale',
    lastQualityChange: null,
    createdViews: 0,
    createdViewTypes: [],
    removedViews: 0,
    candidateViews: 0,
    activeViews: 0,
    visibleViews: 0,
  };
  private lastPrewarmStats: RendererPrewarmStats | null = null;
  private readonly renderDiagnosticsEnabled = localRenderDiagnosticsEnabled();
  private renderDiagnosticsSnapshot = emptyRenderDiagnosticsSnapshot();
  private renderDiagnosticsNextSampleAt = 0;
  private renderDiagnosticsSamplePending = false;
  private renderDiagnosticsKnownMaterials = new Set<string>();
  private renderDiagnosticsKnownVisibleObjects = new Set<string>();
  private renderDiagnosticsLastPrograms = 0;
  private renderDiagnosticsLastTextures = 0;
  private appliedBudgetLevels: RenderBudgetState['levels'] | null = null;
  private lastQualityChange: Omit<RendererQualityChangeStats, 'ageMs'> | null = null;
  private visualPool = new Map<string, CharacterVisual[]>();
  private objectPool = new Map<string, PooledObjectView[]>();

  constructor(private sim: IWorld, canvas: HTMLCanvasElement, nameplateLayer: HTMLDivElement) {
    this.nameplateLayer = nameplateLayer;
    // No default-framebuffer MSAA on any tier: high/ultra get AA from the
    // composer's MSAA HalfFloat target, low is meant to run without AA — and
    // requesting it here would hit software GL (the autodetect can only run
    // after the context exists) with the most expensive setting there is.
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.captureGlIdentity();
    canvas.addEventListener('webglcontextlost', () => { this.contextLostCount++; });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextRestoredCount++;
      this.captureGlIdentity();
    });
    initGfxTier(this.webgl); // software-GL autodetect needs the live context
    // The lightweight material path does not preload HDR sky/water assets.
    // Keep the renderer's HDR/IBL branch aligned with that preload decision.
    this.lowGfx = !GFX.standardMaterials;
    this.renderBudgetGovernor = new RenderBudgetGovernor({ tier: GFX.tier, budget: GFX.budget, enabled: GFX.autoGovernor });
    this.renderBudgetGovernor.reset(this.effectiveRenderScale, this.renderBudgetMinScale(), this.renderBudgetMaxScale());
    const LOW_GFX = this.lowGfx;
    this.viewport = this.measureViewport();
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, GFX.pixelRatioCap));
    this.webgl.setSize(this.viewport.width, this.viewport.height, false);
    this.webgl.shadowMap.enabled = !LOW_GFX;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping; // OutputPass reads this on the composer path
    this.webgl.toneMappingExposure = this.baseExposure;
    this.camera = new THREE.PerspectiveCamera(CAMERA_BASE_FOV, this.viewport.width / this.viewport.height, 0.1, 950);

    this.scene.fog = new THREE.Fog(LOW_GFX ? 0xb6cddd : 0xa6c6e0, LOW_GFX ? 150 : 130, LOW_GFX ? 520 : 470);

    // sky dome — follows the camera so the world strip never outruns it.
    // High tier: shader gradient + sun glow with biome-aware horizon tints;
    // low keeps the legacy canvas-gradient dome.
    this.skyView = buildSky(LOW_GFX, SUN_ANCHOR);
    this.sky = this.skyView.dome;
    setRenderCategory(this.sky, 'sky');
    this.scene.add(this.sky);

    // IBL: prefilter the real per-biome HDRI equirects so PBR materials get
    // sky-matched ambient; swapped as the camera crosses biome bands (the
    // dome shader cross-fades the same textures). The raw equirects carry
    // the unclamped sun that the dome shader tames with per-biome gain, so
    // the environment intensity is rescaled to match the shipped look.
    if (!LOW_GFX) {
      const pmrem = new THREE.PMREMGenerator(this.webgl);
      for (const b of ['vale', 'marsh', 'peaks'] as BiomeId[]) {
        const eq = this.skyView.envTexture(b);
        if (eq) this.envRTs.set(b, pmrem.fromEquirectangular(eq));
      }
      if (this.envRTs.size > 0) {
        this.envOutdoorIntensity = ENV_INTENSITY * IBL_RAW_SCALE;
        this.scene.environment = this.envRTs.get('vale')!.texture;
        this.scene.environmentRotation.y = this.skyView.envRotationY('vale');
      } else {
        // fallback: prefilter the dome itself (gain/clamp already applied)
        const envScene = new THREE.Scene();
        envScene.add(this.sky.clone());
        const envRT = pmrem.fromScene(envScene, 0.04, 0.1, 1100); // far must cover the 560u dome
        this.scene.environment = envRT.texture;
      }
      this.scene.environmentIntensity = this.envOutdoorIntensity;
      pmrem.dispose(); // prefiltered envRTs stay alive for the session
    }

    const hemi = new THREE.HemisphereLight(0xdcefff, 0x465f39, LOW_GFX ? 0.98 : HEMI_INTENSITY);
    this.scene.add(hemi);
    this.hemi = hemi;
    const sun = new THREE.DirectionalLight(LOW_GFX ? 0xfff0d0 : 0xffedd0, LOW_GFX ? 2.65 : SUN_INTENSITY);
    sun.position.copy(SUN_ANCHOR);
    sun.castShadow = !LOW_GFX;
    sun.shadow.mapSize.set(GFX.shadowMap, GFX.shadowMap);
    sun.shadow.camera.near = 30;
    sun.shadow.camera.far = 480;
    // 95u half-extent: the whole mid-ground shadows (a 50u box left every
    // tree/house past it on uniformly lit grass); ~4.6cm texels at 4096
    const S = LOW_GFX ? 75 : 95;
    sun.shadow.camera.left = -S;
    sun.shadow.camera.right = S;
    sun.shadow.camera.top = S;
    sun.shadow.camera.bottom = -S;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = LOW_GFX ? 0.02 : 0.05;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    // characters can self-cull only where they cast no sun shadow (low/lean tier)
    this.cullCharacters = !sun.castShadow;
    this.sunDir.copy(SUN_DIR);

    // visible sun disc + bloom halo
    const sunCanvas = (core: boolean): THREE.CanvasTexture => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
      if (core) {
        g.addColorStop(0, 'rgba(255,252,238,1)');
        g.addColorStop(0.35, 'rgba(255,238,180,0.95)');
        g.addColorStop(1, 'rgba(255,220,140,0)');
      } else {
        g.addColorStop(0, 'rgba(255,236,180,0.55)');
        g.addColorStop(1, 'rgba(255,220,150,0)');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    };
    for (const [tex, scale] of [[sunCanvas(true), 60], [sunCanvas(false), 190]] as const) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, fog: false, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending,
        // bloom supplies the big halo on the composer path; the painted one
        // would double up and wash out the sky
        opacity: scale === 190 && !LOW_GFX ? SUN_HALO_OPACITY : 1,
      }));
      setRenderCategory(sp, 'sky');
      sp.scale.set(scale, scale, 1);
      sp.renderOrder = -9;
      this.sunSprites.push(sp);
      this.scene.add(sp);
    }

    // god-ray shafts: elongated additive gradient sprites hanging sunward of
    // the camera; opacity follows how directly the camera faces the sun
    if (!LOW_GFX) {
      const shaft = document.createElement('canvas');
      shaft.width = 64;
      shaft.height = 256;
      const sctx = shaft.getContext('2d')!;
      const gh = sctx.createLinearGradient(0, 0, 0, 256);
      gh.addColorStop(0, 'rgba(255,240,200,0)');
      gh.addColorStop(0.45, 'rgba(255,240,200,0.55)');
      gh.addColorStop(0.6, 'rgba(255,240,200,0.5)');
      gh.addColorStop(1, 'rgba(255,240,200,0)');
      sctx.fillStyle = gh;
      sctx.fillRect(0, 0, 64, 256);
      const gw = sctx.createLinearGradient(0, 0, 64, 0);
      gw.addColorStop(0, 'rgba(0,0,0,1)');
      gw.addColorStop(0.5, 'rgba(0,0,0,0)');
      gw.addColorStop(1, 'rgba(0,0,0,1)');
      sctx.globalCompositeOperation = 'destination-out';
      sctx.fillStyle = gw;
      sctx.fillRect(0, 0, 64, 256);
      const shaftTex = new THREE.CanvasTexture(shaft);
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: shaftTex, transparent: true, opacity: 0, fog: false,
          depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
          rotation: 0.42 + i * 0.13,
        }));
        setRenderCategory(sp, 'sky');
        sp.scale.set(26 + i * 16, 150 + i * 35, 1);
        sp.renderOrder = -8;
        this.godRays.push(sp);
        this.scene.add(sp);
      }
    }

    // clouds, spread over the whole zone strip (3 sprite variants + a faint
    // high cirrus layer on the full pipeline)
    for (const cl of buildClouds(LOW_GFX).sprites) {
      setRenderCategory(cl, 'sky');
      this.clouds.push(cl);
      this.scene.add(cl);
    }

    this.terrainView = buildTerrain(this.sim.cfg.seed);
    setRenderCategory(this.terrainView.group, 'terrain');
    this.scene.add(this.terrainView.group);
    this.waterView = buildWater(this.sim.cfg.seed);
    for (const mesh of this.waterView.meshes) {
      setRenderCategory(mesh, 'water');
      this.scene.add(mesh);
    }

    this.foliage = buildFoliage(this.sim.cfg.seed);
    setRenderCategory(this.foliage.group, 'foliage');
    this.scene.add(this.foliage.group);
    this.fish = buildFish(this.sim.cfg.seed);
    setRenderCategory(this.fish.group, 'fish');
    this.scene.add(this.fish.group);
    this.critters = buildCritters(this.sim.cfg.seed);
    this.scene.add(this.critters.group);
    this.motes = buildMotes(this.sim.cfg.seed);
    this.scene.add(this.motes.group);
    this.birds = buildBirds(this.sim.cfg.seed);
    this.scene.add(this.birds.group);
    this.impactSite = buildImpactSite(this.sim.cfg.seed);
    this.scene.add(this.impactSite.group);
    const props = buildProps(this.sim.cfg.seed);
    setRenderCategory(props.group, 'props');
    this.scene.add(props.group);
    this.flames = props.flames;
    this.fireLights = props.fireLights;
    this.propsView = props;

    // selection ring — a classic target reticle: a base ring plus four
    // inward-pointing ticks. The base ring is draped over the terrain each
    // frame (see drapeRingLocalY / sync) so it stays legible on slopes instead
    // of sinking into the uphill ground; the ticks keep the classic spin on a
    // separate pivot. The ring is radially symmetric, so only the ticks read spin.
    const ringGeo = new THREE.RingGeometry(0.9, 1.15, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0.9, depthWrite: false });
    this.selectionRingMat = ringMat;
    this.selectionRing = new THREE.Group();
    this.selectionRingMesh = new THREE.Mesh(ringGeo, ringMat);
    // the draped ring deforms every frame; skip frustum culling so the (now
    // out-of-date) bounding sphere can't cull it on steep slopes.
    this.selectionRingMesh.frustumCulled = false;
    this.selectionRing.add(this.selectionRingMesh);
    // cache the ring's center-relative XZ so sync() can re-drape it cheaply.
    const ringPos = ringGeo.getAttribute('position') as THREE.BufferAttribute;
    this.selectionRingLocalXZ = new Float32Array(ringPos.count * 2);
    for (let i = 0; i < ringPos.count; i++) {
      this.selectionRingLocalXZ[i * 2] = ringPos.getX(i);
      this.selectionRingLocalXZ[i * 2 + 1] = ringPos.getZ(i);
    }
    this.selectionRingDrapeY = new Float32Array(ringPos.count);
    // four cardinal ticks on a spinning pivot, sharing the ring material so the
    // per-frame hostile/friendly recolour carries over for free.
    this.selectionRingTicks = new THREE.Group();
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0.72, 0, 0,     // inner tip (points toward the unit)
      1.2, 0, 0.16,   // outer corners
      1.2, 0, -0.16,
    ], 3));
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(tickGeo, ringMat);
      t.rotation.y = (i * Math.PI) / 2;
      this.selectionRingTicks.add(t);
    }
    this.selectionRing.add(this.selectionRingTicks);
    setRenderCategory(this.selectionRing, 'ui3d');
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    // click-feedback marker pool: a small fixed set of ring+X groups reused
    // round-robin, so rapid clicking never allocates. Geometry is shared; each
    // slot owns its own materials so the ring and X fade independently and
    // recolour per click (gold neutral, red on a hostile). Laid flat as decals at
    // the ground point in sync(); built once here.
    const cmRingGeo = new THREE.RingGeometry(0.42, 0.6, 40);
    cmRingGeo.rotateX(-Math.PI / 2);
    // The "X": two thin flat bars crossed at right angles, lying in the XZ plane.
    const cmBarGeo = new THREE.PlaneGeometry(0.16, 1.0);
    cmBarGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < CLICK_MARKER_POOL; i++) {
      const group = new THREE.Group();
      const ringMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false });
      const ring = new THREE.Mesh(cmRingGeo, ringMat);
      const crossMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false });
      const cross = new THREE.Group();
      for (const rot of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(cmBarGeo, crossMat);
        bar.rotation.y = rot;
        cross.add(bar);
      }
      group.add(ring, cross);
      group.visible = false;
      group.renderOrder = 3; // draw over terrain decals (depthTest off above)
      setRenderCategory(group, 'ui3d');
      this.scene.add(group);
      this.clickMarkers.push({ group, ring, cross, ringMat, crossMat, elapsed: CLICK_MARKER_LIFETIME });
    }

    // particle system: projectiles, impacts, heal glows, ambience
    this.vfx = new Vfx(this.scene, (id, frac) => {
      const v = this.views.get(id);
      if (!v) return null;
      const e = this.sim.entities.get(id);
      const h = v.height * (e?.scale ?? 1) * frac;
      return new THREE.Vector3(v.group.position.x, v.group.position.y + h, v.group.position.z);
    });
    this.vfx.setViewportScale(this.webgl.domElement.clientHeight * this.webgl.getPixelRatio(), 60);

    // ambient precipitation: biome-driven snow/rain that rides with the camera
    this.weather = new Weather(this.scene, this.lowGfx);

    // post chain (bloom + grade, GTAO on ultra); low renders direct
    if (GFX.composer) this.post = buildComposer(this.webgl, this.scene, this.camera, this.viewport.width, this.viewport.height);

    const resize = () => this.resizeViewport();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => {
      resize();
      window.setTimeout(resize, 250);
      window.setTimeout(resize, 800);
    });
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    document.addEventListener('fullscreenchange', resize);
  }

  private measureViewport(): { width: number; height: number } {
    const rect = this.webgl.domElement.getBoundingClientRect();
    const stableMobileGameViewport = document.body.classList.contains('game-active') && document.body.classList.contains('mobile-touch');
    const vv = stableMobileGameViewport ? null : window.visualViewport;
    const width = Math.round(stableMobileGameViewport ? (rect.width || window.innerWidth) : (vv?.width ?? (rect.width || window.innerWidth)));
    const height = Math.round(stableMobileGameViewport ? (rect.height || window.innerHeight) : (vv?.height ?? (rect.height || window.innerHeight)));
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }

  private captureGlIdentity(): void {
    try {
      const gl = this.webgl.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.glVendor = String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
      this.glRenderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch {
      this.glVendor = '';
      this.glRenderer = '';
    }
  }

  private resizeViewport(measured = this.measureViewport()): void {
    this.viewport = measured;
    this.camera.aspect = this.viewport.width / this.viewport.height;
    this.camera.updateProjectionMatrix();
    this.applyResolution();
  }

  // Push the current device pixel ratio (× renderScale, still capped by the
  // tier) to the renderer, composer, and vfx. Shared by resize and the
  // render-scale setting so a window resize never drops the chosen scale.
  private applyResolution(): void {
    const ratio = Math.min(window.devicePixelRatio, GFX.pixelRatioCap) * this.effectiveRenderScale;
    this.webgl.setPixelRatio(ratio);
    this.webgl.setSize(this.viewport.width, this.viewport.height, false);
    if (this.post) {
      this.post.composer.setPixelRatio(ratio);
      this.post.setSize(this.viewport.width, this.viewport.height);
    }
    this.vfx.setViewportScale(this.webgl.domElement.clientHeight * this.webgl.getPixelRatio(), 60);
  }

  /** Tone-mapping exposure multiplier (1.0 = the default look). */
  setBrightness(mult: number): void {
    this.webgl.toneMappingExposure = this.baseExposure * mult;
  }

  /** Toggle biome-driven ambient precipitation (snow/rain). */
  setWeatherEnabled(on: boolean): void {
    this.weather.setEnabled(on);
    this.weatherOn = on;
  }

  /** main.ts injects the spatial sound engine here (render never imports game/). */
  setAudioSink(sink: SpatialAudioSink | null): void {
    this.audioSink = sink;
  }

  // Surface under (x,z) for footstep timbre. Sampled only at a footfall (cheap).
  private surfaceAt(x: number, z: number, y: number): Surface {
    if (x > DUNGEON_X_THRESHOLD) return 'stone'; // dungeon interiors are stone halls
    if (groundHeight(x, z, this.sim.cfg.seed) < WATER_LEVEL && y <= WATER_LEVEL + 0.3) return 'water';
    const biome = zoneBiomeAt(z);
    if (biome === 'vale') return 'grass';
    if (biome === 'marsh') return 'dirt';
    return this.weatherOn ? 'snow' : 'stone'; // peaks: snowy when weather is on
  }

  /** Vertical camera field of view in degrees (55..100, default 60). */
  setCameraFov(deg: number): void {
    this.camera.fov = Math.min(100, Math.max(55, deg));
    this.camera.updateProjectionMatrix();
  }

  /** Resolution multiplier on top of the device pixel ratio (0.5..1). */
  setRenderScale(scale: number): void {
    this.renderScale = Math.min(1, Math.max(0.5, scale));
    this.effectiveRenderScale = this.initialEffectiveRenderScale(this.renderScale);
    this.frameMsEma = 16.7;
    this.adaptiveGrace = 1.0;
    this.adaptiveCooldown = 0.5;
    this.stableFrameTime = 0;
    this.applyRenderBudgetState(this.renderBudgetGovernor.reset(
      this.effectiveRenderScale,
      this.renderBudgetMinScale(),
      this.renderBudgetMaxScale(),
    ));
    this.applyResolution();
  }

  private isMobileRuntime(): boolean {
    return document.body.classList.contains('mobile-touch');
  }

  private initialEffectiveRenderScale(scale: number): number {
    const forcedTier = urlForcedTier();
    if (this.isMobileRuntime() && forcedTier !== 'high' && forcedTier !== 'ultra') return Math.min(scale, 0.85);
    return scale;
  }

  private renderBudgetMinScale(): number {
    const budget = GFX.budget;
    return this.isMobileRuntime() ? budget.minRenderScaleMobile : budget.minRenderScaleDesktop;
  }

  private renderBudgetMaxScale(): number {
    return Math.min(this.renderScale, GFX.budget.maxRenderScale);
  }

  private applyRenderBudgetState(state: RenderBudgetState): void {
    const previousScale = this.effectiveRenderScale;
    const previousLevels = this.appliedBudgetLevels;
    const levelsChanged = previousLevels
      ? Object.entries(state.levels).some(([key, value]) => Math.abs(value - previousLevels[key as keyof RenderBudgetState['levels']]) >= 0.001)
      : true;
    if (levelsChanged) {
      this.lastQualityChange = {
        atMs: performance.now(),
        mode: state.mode,
        reason: state.reason,
        previousLevels: previousLevels ?? state.levels,
        levels: state.levels,
      };
      this.appliedBudgetLevels = { ...state.levels };
    }
    this.effectiveRenderScale = Math.min(this.renderBudgetMaxScale(), Math.max(this.renderBudgetMinScale(), state.levels.resolution));
    this.foliage.setGrassQuality(state.levels.grass);
    this.foliage.setModelQuality(state.levels.foliage);
    this.vfx.setQuality(state.levels.vfx);
    this.effectivePointLights = Math.max(1, Math.round(GFX.maxPointLights * state.levels.lighting));
    if (Math.abs(previousScale - this.effectiveRenderScale) >= 0.001) this.applyResolution();
  }

  private graphicsBucketLevels(state = this.renderBudgetGovernor.state()): GfxBucketLevels {
    return {
      ...GFX.bucketBaselines,
      resolution: Math.round(this.effectiveRenderScale * 100) / 100,
      grass: state.levels.grass,
      foliage: state.levels.foliage,
      vfx: state.levels.vfx,
      lighting: state.levels.lighting,
      characters: 1,
      weapons: 1,
      worldStreaming: this.lowGfx ? GFX.bucketBaselines.worldStreaming : 1,
      ui: this.isMobileRuntime() ? Math.min(GFX.bucketBaselines.ui, 0.9) : GFX.bucketBaselines.ui,
    };
  }

  perfStats(): {
    graphicsConfigVersion: number;
    tier: string;
    qualityBuckets: {
      version: number;
      bands: GfxBucketBands;
      baseline: GfxBucketLevels;
      levels: GfxBucketLevels;
      features: {
        composer: boolean;
        ao: boolean;
        standardMaterials: boolean;
        lowPlus: boolean;
        leanFoliage: boolean;
        terrainSplat: boolean;
        windSway: boolean;
        maxPointLights: number;
        activePointLights: number;
        shadowMap: number;
      };
    };
    autoGovernor: boolean;
    budget: typeof GFX.budget;
    renderScale: number;
    effectiveRenderScale: number;
    renderBudget: RenderBudgetState;
    pixelRatio: number;
    width: number;
    height: number;
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    programs: number;
    views: number;
    foliage: FoliagePerfStats;
    glVendor: string;
    glRenderer: string;
    contextLost: number;
    contextRestored: number;
    phaseMs: RendererPhaseStats;
    renderDiagnostics: RenderDiagnosticsSnapshot;
    lastFrame?: RendererFrameStats;
    prewarm: RendererPrewarmStats | null;
  } {
    const info = this.webgl.info;
    const renderBudget = this.renderBudgetGovernor.state();
    return {
      graphicsConfigVersion: GFX.graphicsConfigVersion,
      tier: GFX.tier,
      qualityBuckets: {
        version: GFX.graphicsConfigVersion,
        bands: GFX.bucketBands,
        baseline: GFX.bucketBaselines,
        levels: this.graphicsBucketLevels(renderBudget),
        features: {
          composer: GFX.composer,
          ao: GFX.ao,
          standardMaterials: GFX.standardMaterials,
          lowPlus: GFX.lowPlus,
          leanFoliage: GFX.leanFoliage,
          terrainSplat: GFX.terrainSplat,
          windSway: GFX.windSway,
          maxPointLights: GFX.maxPointLights,
          activePointLights: this.effectivePointLights || GFX.maxPointLights,
          shadowMap: GFX.shadowMap,
        },
      },
      autoGovernor: GFX.autoGovernor,
      budget: GFX.budget,
      renderScale: this.renderScale,
      effectiveRenderScale: this.effectiveRenderScale,
      renderBudget,
      pixelRatio: this.webgl.getPixelRatio(),
      width: this.viewport.width,
      height: this.viewport.height,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      views: this.views.size,
      foliage: this.foliage.perfStats(),
      glVendor: this.glVendor,
      glRenderer: this.glRenderer,
      contextLost: this.contextLostCount,
      contextRestored: this.contextRestoredCount,
      phaseMs: this.rendererPhaseStats(),
      renderDiagnostics: this.lastFrameStats.renderDiagnostics,
      lastFrame: this.lastFrameStats,
      prewarm: this.lastPrewarmStats,
    };
  }

  private recordRendererPhase(phase: RendererPhase, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    const samples = this.phaseSamples[phase];
    samples.push(Math.min(250, ms));
    if (samples.length > RENDERER_PHASE_SAMPLE_LIMIT) samples.splice(0, samples.length - RENDERER_PHASE_SAMPLE_LIMIT);
  }

  private rendererPhaseStats(): RendererPhaseStats {
    return {
      setup: summarizeMs(this.phaseSamples.setup),
      entities: summarizeMs(this.phaseSamples.entities),
      world: summarizeMs(this.phaseSamples.world),
      nameplates: summarizeMs(this.phaseSamples.nameplates),
      submit: summarizeMs(this.phaseSamples.submit),
      total: summarizeMs(this.phaseSamples.total),
    };
  }

  private materialLabels(material: THREE.Material | THREE.Material[] | undefined): string[] {
    const mats = Array.isArray(material) ? material : material ? [material] : [];
    return mats.map((mat) => `${mat.name || mat.type}:${mat.uuid.slice(0, 8)}`);
  }

  private drawCountFor(material: THREE.Material | THREE.Material[] | undefined, geometry?: THREE.BufferGeometry): number {
    if (!material) return 1;
    if (Array.isArray(material)) return Math.max(1, geometry?.groups.length || material.length);
    return Math.max(1, geometry?.groups.length && geometry.groups.length > 0 ? geometry.groups.length : 1);
  }

  private triangleCountFor(geometry?: THREE.BufferGeometry): number {
    if (!geometry) return 0;
    const drawCount = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
    return Math.max(0, Math.floor(drawCount / 3));
  }

  private objectDiagnosticLabel(obj: THREE.Object3D, category: string, materialLabels: string[]): string {
    const name = obj.name || obj.type;
    const material = materialLabels[0] ?? 'no-material';
    return `${category}:${name}:${material}`.slice(0, 140);
  }

  private collectRenderDiagnostics(): RenderDiagnosticsSnapshot {
    if (!this.renderDiagnosticsEnabled) return emptyRenderDiagnosticsSnapshot();
    const info = this.webgl.info;
    const programs = info.programs?.length ?? 0;
    const textures = info.memory.textures;
    const programDelta = programs - this.renderDiagnosticsLastPrograms;
    const textureDelta = textures - this.renderDiagnosticsLastTextures;
    this.renderDiagnosticsLastPrograms = programs;
    this.renderDiagnosticsLastTextures = textures;

    type MutableCategoryStats = RenderDiagnosticsCategoryStats & { materialKeys: Set<string> };
    const categories: Record<string, MutableCategoryStats> = {};
    const totals = { objects: 0, draws: 0, triangles: 0, points: 0 };
    const newMaterials: string[] = [];
    const firstVisibleObjects: string[] = [];
    const categoryStats = (category: string): MutableCategoryStats => {
      categories[category] ??= {
        objects: 0,
        draws: 0,
        triangles: 0,
        points: 0,
        materials: 0,
        materialSamples: [],
        materialKeys: new Set<string>(),
      };
      return categories[category];
    };
    const visit = (obj: THREE.Object3D, inheritedCategory: string, inheritedVisible: boolean): void => {
      const visible = inheritedVisible && obj.visible;
      const category = typeof obj.userData.renderCategory === 'string'
        ? obj.userData.renderCategory as string
        : inheritedCategory;
      if (visible) {
        const renderable = obj as RenderableDiagnosticObject;
        const hasMesh = Boolean(renderable.isMesh || renderable.isInstancedMesh || renderable.isSkinnedMesh);
        const hasPoints = Boolean(renderable.isPoints);
        const hasSprite = Boolean(renderable.isSprite);
        const hasLine = Boolean(renderable.isLine || renderable.isLineSegments);
        if (hasMesh || hasPoints || hasSprite || hasLine) {
          const geometry = renderable.geometry;
          const material = renderable.material;
          const stat = categoryStats(category);
          const labels = this.materialLabels(material);
          const draws = this.drawCountFor(material, geometry);
          let triangles = 0;
          let pointCount = 0;
          if (hasMesh) {
            const instanceCount = renderable.isInstancedMesh ? Math.max(0, renderable.count ?? 0) : 1;
            triangles = this.triangleCountFor(geometry) * instanceCount;
          } else if (hasSprite) {
            triangles = 2;
          } else if (hasPoints) {
            pointCount = geometry?.getAttribute('position')?.count ?? 0;
          }
          stat.objects++;
          stat.draws += draws;
          stat.triangles += triangles;
          stat.points += pointCount;
          totals.objects++;
          totals.draws += draws;
          totals.triangles += triangles;
          totals.points += pointCount;
          for (const label of labels) {
            if (!stat.materialKeys.has(label)) {
              stat.materialKeys.add(label);
              if (stat.materialSamples.length < 8) stat.materialSamples.push(label);
            }
            if (!this.renderDiagnosticsKnownMaterials.has(label)) {
              this.renderDiagnosticsKnownMaterials.add(label);
              if (newMaterials.length < 16) newMaterials.push(label);
            }
          }
          const visibleKey = `${category}|${obj.uuid}|${geometry?.uuid ?? ''}|${labels.join('|')}`;
          if (!this.renderDiagnosticsKnownVisibleObjects.has(visibleKey)) {
            this.renderDiagnosticsKnownVisibleObjects.add(visibleKey);
            if (firstVisibleObjects.length < 16) firstVisibleObjects.push(this.objectDiagnosticLabel(obj, category, labels));
          }
        }
      }
      for (const child of obj.children) visit(child, category, visible);
    };
    visit(this.scene, 'unknown', true);

    const outCategories: Record<string, RenderDiagnosticsCategoryStats> = {};
    for (const [category, stat] of Object.entries(categories)) {
      outCategories[category] = {
        objects: stat.objects,
        draws: stat.draws,
        triangles: stat.triangles,
        points: stat.points,
        materials: stat.materialKeys.size,
        materialSamples: stat.materialSamples,
      };
    }
    return {
      enabled: true,
      totalObjects: totals.objects,
      estimatedDraws: totals.draws,
      estimatedTriangles: totals.triangles,
      estimatedPoints: totals.points,
      programs,
      programDelta,
      textures,
      textureDelta,
      newMaterials,
      firstVisibleObjects,
      categories: outCategories,
    };
  }

  private renderDiagnosticsForFrame(now: number, force = false): RenderDiagnosticsSnapshot {
    if (!this.renderDiagnosticsEnabled) return emptyRenderDiagnosticsSnapshot();
    if (force) {
      this.renderDiagnosticsSnapshot = this.collectRenderDiagnostics();
      this.renderDiagnosticsNextSampleAt = now + RENDER_DIAGNOSTICS_SAMPLE_MS;
      return this.renderDiagnosticsSnapshot;
    }
    if (!this.renderDiagnosticsSamplePending && now >= this.renderDiagnosticsNextSampleAt) {
      this.renderDiagnosticsSamplePending = true;
      this.renderDiagnosticsNextSampleAt = now + RENDER_DIAGNOSTICS_SAMPLE_MS;
      const run = (): void => {
        try {
          this.renderDiagnosticsSnapshot = this.collectRenderDiagnostics();
        } finally {
          this.renderDiagnosticsSamplePending = false;
        }
      };
      const win = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      };
      if (win.requestIdleCallback) win.requestIdleCallback(run, { timeout: RENDER_DIAGNOSTICS_IDLE_TIMEOUT_MS });
      else window.setTimeout(run, 100);
    }
    return this.renderDiagnosticsSnapshot;
  }

  private updateAdaptiveResolution(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const frameMs = Math.min(250, dt * 1000);
    const previousSubmitMs = this.lastFrameStats.phaseMs.submit;
    const previousTotalMs = this.lastFrameStats.phaseMs.total;
    const info = this.webgl.info;
    // Do not let the live governor resize the drawing buffers during play.
    // Three/WebGL can turn setSize/setPixelRatio into a large synchronous
    // allocation on weak GPUs/software GL, which is worse than the pressure
    // signal it is trying to fix. Manual render-scale changes still apply via
    // setRenderScale(); the automatic governor keeps to grass/VFX budgets here.
    const lockedRenderScale = this.effectiveRenderScale;
    const state = this.renderBudgetGovernor.update({
      dt,
      frameMs,
      totalMs: previousTotalMs,
      submitMs: previousSubmitMs,
      calls: info.render.calls,
      triangles: info.render.triangles,
      grassVisibleTufts: this.lastFrameStats.foliage.grassVisibleTufts,
      grassVisibleChunks: this.lastFrameStats.foliage.grassVisibleChunks,
      activeViews: this.lastFrameStats.activeViews,
      createdViews: this.lastFrameStats.createdViews,
      minRenderScale: lockedRenderScale,
      maxRenderScale: lockedRenderScale,
    });
    this.frameMsEma = state.frameMsEma;
    this.adaptiveCooldown = state.cooldownSeconds;
    this.stableFrameTime = state.stableSeconds;
    if (this.adaptiveGrace > 0) this.adaptiveGrace = Math.max(0, this.adaptiveGrace - dt);
    this.applyRenderBudgetState(state);
  }

  private runtimeViewCreateBudget(dt: number): number {
    const base = this.lowGfx ? VIEW_CREATE_BUDGET_LOW : VIEW_CREATE_BUDGET_HIGH;
    if (!Number.isFinite(dt) || dt <= 0) return base;
    const frameMs = Math.min(250, dt * 1000);
    if (frameMs >= VIEW_CREATE_HITCH_FRAME_MS) this.viewCreateBackoff = VIEW_CREATE_BACKOFF_SECONDS;
    if (this.viewCreateBackoff > 0) {
      this.viewCreateBackoff = Math.max(0, this.viewCreateBackoff - dt);
      return 1;
    }
    if (frameMs >= VIEW_CREATE_SLOW_FRAME_MS || this.frameMsEma >= GFX.budget.dropFrameMs) {
      return Math.max(1, Math.ceil(base / 2));
    }
    return base;
  }

  private viewCandidatePriority(e: Entity, p: Entity, d2: number): number {
    if (e.id === p.id) return -100;
    if (e.id === p.targetId) return -90;
    if (e.kind === 'mob' && e.hostile && d2 <= 35 * 35) return 0;
    if (e.kind === 'npc' && d2 <= 45 * 45) return 1;
    if (e.kind === 'object' && (e.lootable || isPersistentPortalObject(e))) return 2;
    if (e.kind === 'player') return 3;
    if (e.kind === 'mob' && e.hostile) return 4;
    if (e.kind === 'mob') return 5;
    if (e.kind === 'npc') return 6;
    if (e.kind === 'object') return 7;
    return 9;
  }

  private collectMissingViewCandidates(center: Entity, rangeSq: number, includeRequired: boolean): void {
    this.viewCandidates.length = 0;
    for (const e of this.sim.entities.values()) {
      if (this.views.has(e.id)) continue;
      const required = e.id === center.id || e.id === center.targetId;
      if (required && !includeRequired) continue;
      const d2 = distSqXZ(e, center);
      if (!required && d2 > rangeSq) continue;
      this.viewCandidates.push({ e, d2, priority: this.viewCandidatePriority(e, center, d2) });
    }
    if (this.viewCandidates.length > 1) {
      this.viewCandidates.sort((a, b) => a.priority - b.priority || a.d2 - b.d2 || a.e.id - b.e.id);
    }
  }

  private createdViewType(e: Entity): string {
    const id = e.templateId || e.kind;
    return `${e.kind}:${id}`.slice(0, 64);
  }

  private sampleCreatedViewType(into: string[], e: Entity): void {
    if (into.length < VIEW_CREATED_TYPE_SAMPLE_LIMIT) into.push(this.createdViewType(e));
  }

  private createRequiredViews(player: Entity, createdViewTypes: string[]): number {
    let created = 0;
    const requiredIds = [player.id, player.targetId].filter((id): id is number => id !== null);
    for (const id of requiredIds) {
      const e = this.sim.entities.get(id);
      if (!e || this.views.has(e.id)) continue;
      this.createView(e);
      this.sampleCreatedViewType(createdViewTypes, e);
      created++;
    }
    return created;
  }

  private createPersistentPortalViews(createdViewTypes: string[], deadlineMs: number): number {
    let created = 0;
    for (const e of this.sim.entities.values()) {
      if (created >= PERSISTENT_PORTAL_VIEW_PREWARM_LIMIT || performance.now() >= deadlineMs) break;
      if (!isPersistentPortalObject(e) || this.views.has(e.id)) continue;
      this.createView(e);
      this.sampleCreatedViewType(createdViewTypes, e);
      created++;
    }
    return created;
  }

  private createCandidateViews(limit: number, createdViewTypes: string[], deadlineMs = Infinity): number {
    const max = Math.max(0, Math.floor(limit));
    let created = 0;
    for (const candidate of this.viewCandidates) {
      if (created >= max || performance.now() >= deadlineMs) break;
      if (this.views.has(candidate.e.id)) continue;
      this.createView(candidate.e);
      this.sampleCreatedViewType(createdViewTypes, candidate.e);
      created++;
    }
    return created;
  }

  private prewarmWorldFrame(dt: number): void {
    const p = this.sim.player;
    this.time += dt;
    sharedUniforms.uTime.value = this.time;
    this.tmpV.set(p.pos.x, p.pos.y, p.pos.z);
    this.updateCamera(this.tmpV, dt);
    this.updateAmbience(p.pos.x, this.camera.position.y, dt);
    this.budgetFireLights(p.pos.x, p.pos.z);
    this.waterView.update(this.time);
    const fogFar = (this.scene.fog as THREE.Fog).far;
    this.terrainView.update(this.camera.position.x, this.camera.position.z, fogFar);
    this.propsView.update(
      this.camera.position.x, this.camera.position.y, this.camera.position.z,
      this.cameraLookAt.x, this.cameraLookAt.y, this.cameraLookAt.z,
      fogFar,
    );
    this.foliage.update(
      p.pos.x, p.pos.z,
      this.camera.position.x, this.camera.position.y, this.camera.position.z,
      this.cameraLookAt.x, this.cameraLookAt.y, this.cameraLookAt.z,
      fogFar,
    );
    this.fish.update(p.pos.x, p.pos.z, dt);
    this.vfx.update(dt);
    const pv = this.views.get(p.id);
    if (pv) {
      const pp = pv.group.position;
      this.sun.position.set(pp.x + SUN_ANCHOR.x, pp.y + SUN_ANCHOR.y, pp.z + SUN_ANCHOR.z);
      this.sun.target.position.set(pp.x, pp.y, pp.z);
    }
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.sky.visible = this.fogState === 'outdoor';
    if (this.sky.visible) {
      this.skyView.setCameraZ(this.camera.position.z, dt);
      this.updateEnvBiome(dt);
    }
    for (const sp of this.sunSprites) {
      sp.position.copy(this.camera.position).addScaledVector(this.sunDir, 760);
      sp.visible = this.fogState === 'outdoor';
    }
    this.updateGodRays();
    this.updateNameplates(true);
    this.updateChatBubbles();
  }

  private prewarmEntity(kind: 'player' | 'mob', templateId: string, color: number, scale: number, skin = 0, id = -10_000): Entity {
    const p = this.sim.player;
    return {
      ...p,
      id,
      kind,
      templateId,
      name: templateId,
      level: 1,
      pos: { ...p.pos },
      prevPos: { ...p.pos },
      facing: 0,
      prevFacing: 0,
      targetId: null,
      auras: [],
      hostile: kind === 'mob',
      color,
      scale,
      skin,
      dead: false,
      castingAbility: null,
      overheadEmoteId: null,
      overheadEmoteUntil: 0,
      objectItemId: null,
      lootable: false,
      dungeonId: null,
      ownerId: null,
    };
  }

  private visualPoolKeyFor(e: Entity): string | null {
    if (e.kind !== 'mob') return null;
    return `mob:${e.templateId}:${e.color}:${e.scale}`;
  }

  private takePooledVisual(key: string): CharacterVisual | null {
    const pool = this.visualPool.get(key);
    const visual = pool?.pop() ?? null;
    if (!visual) return null;
    visual.root.removeFromParent();
    visual.root.visible = true;
    visual.root.position.set(0, 0, 0);
    visual.root.rotation.set(0, 0, 0);
    visual.root.scale.set(1, 1, 1);
    visual.setFar(false);
    visual.setGhost(false);
    return visual;
  }

  private storePooledVisual(key: string, visual: CharacterVisual): void {
    visual.root.removeFromParent();
    visual.root.visible = false;
    visual.root.position.set(0, 0, 0);
    visual.root.rotation.set(0, 0, 0);
    visual.root.scale.set(1, 1, 1);
    let pool = this.visualPool.get(key);
    if (!pool) {
      pool = [];
      this.visualPool.set(key, pool);
    }
    pool.push(visual);
  }

  private objectPoolKeyFor(e: Entity): string | null {
    if (e.kind !== 'object' || !e.objectItemId) return null;
    if (e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit') return null;
    return `object:${e.objectItemId}`;
  }

  private takePooledObject(key: string): PooledObjectView | null {
    const pool = this.objectPool.get(key);
    const object = pool?.pop() ?? null;
    if (!object) return null;
    object.group.removeFromParent();
    object.group.visible = true;
    object.group.position.set(0, 0, 0);
    object.group.rotation.set(0, 0, 0);
    object.group.scale.set(1, 1, 1);
    return object;
  }

  private storePooledObject(key: string, object: PooledObjectView): void {
    object.group.removeFromParent();
    object.group.visible = false;
    object.group.position.set(0, 0, 0);
    object.group.rotation.set(0, 0, 0);
    object.group.scale.set(1, 1, 1);
    let pool = this.objectPool.get(key);
    if (!pool) {
      pool = [];
      this.objectPool.set(key, pool);
    }
    pool.push(object);
  }

  private buildEntityPrewarmGroup(): THREE.Group {
    const group = new THREE.Group();
    const p = this.sim.player;
    group.position.set(p.pos.x, p.pos.y, p.pos.z - 14);
    setRenderCategory(group, 'prewarm');
    let idx = 0;
    const place = (obj: THREE.Object3D): void => {
      obj.position.set(((idx % 6) - 2.5) * 3.2, 0, Math.floor(idx / 6) * 3.2);
      group.add(obj);
      idx++;
    };
    for (const templateId of PREWARM_MOB_TEMPLATE_IDS) {
      const template = MOBS[templateId];
      if (!template) continue;
      for (let i = 0; i < PREWARM_MOB_POOL_COPIES; i++) {
        const entity = this.prewarmEntity('mob', template.id, template.color, template.scale);
        const visual = createCharacterVisual(entity);
        const key = this.visualPoolKeyFor(entity);
        if (key) this.storePooledVisual(key, visual);
        visual.root.visible = true;
        place(visual.root);
      }
    }
    return group;
  }

  private buildPlayerPrewarmGroup(deadline: number): { group: THREE.Group; visualCount: number } {
    const group = new THREE.Group();
    const p = this.sim.player;
    group.position.set(p.pos.x, p.pos.y, p.pos.z - 21);
    setRenderCategory(group, 'prewarm');
    let idx = 0;
    const place = (obj: THREE.Object3D): void => {
      obj.position.set(((idx % 8) - 3.5) * 2.8, 0, Math.floor(idx / 8) * 2.8);
      group.add(obj);
      idx++;
    };
    for (const cls of ALL_CLASSES) {
      const variants = skinCount(`player_${cls}`);
      for (let skin = 0; skin < variants; skin++) {
        if (performance.now() >= deadline) return { group, visualCount: idx };
        const color = CLASSES[cls]?.color ?? 0xffffff;
        const entity = this.prewarmEntity('player', cls, color, 1, skin, -11_000 - idx);
        const visual = createCharacterVisual(entity);
        visual.root.visible = true;
        place(visual.root);
      }
    }
    return { group, visualCount: idx };
  }

  private buildObjectPrewarmGroup(): THREE.Group {
    const group = new THREE.Group();
    const p = this.sim.player;
    group.position.set(p.pos.x, p.pos.y, p.pos.z - 17);
    setRenderCategory(group, 'prewarm');
    let idx = 0;
    const place = (obj: THREE.Object3D): void => {
      obj.position.set(((idx % 6) - 2.5) * 3.2, 0, Math.floor(idx / 6) * 3.2);
      group.add(obj);
      idx++;
    };
    for (const itemId of PREWARM_OBJECT_ITEM_IDS) {
      const key = `object:${itemId}`;
      for (let i = 0; i < PREWARM_OBJECT_POOL_COPIES; i++) {
        const built = buildGroundQuestObject(itemId, -20_000 - idx);
        this.storePooledObject(key, built);
        built.group.visible = true;
        place(built.group);
      }
    }
    return group;
  }

  private prewarmCounts(): { programs: number; textures: number } {
    return {
      programs: this.webgl.info.programs?.length ?? 0,
      textures: this.webgl.info.memory.textures,
    };
  }

  private prewarmTexture(texture: THREE.Texture | null | undefined): void {
    if (!texture) return;
    this.webgl.initTexture(texture);
  }

  private prewarmMaterialTextures(material: THREE.Material | THREE.Material[] | undefined): void {
    const mats = Array.isArray(material) ? material : material ? [material] : [];
    const textureKeys: TextureMaterialKey[] = [
      'map',
      'alphaMap',
      'aoMap',
      'bumpMap',
      'displacementMap',
      'emissiveMap',
      'envMap',
      'lightMap',
      'metalnessMap',
      'normalMap',
      'roughnessMap',
      'specularMap',
      'gradientMap',
    ];
    for (const mat of mats) {
      const textureMat = mat as TextureBackedMaterial;
      for (const key of textureKeys) this.prewarmTexture(textureMat[key]);
    }
  }

  private prewarmObjectTextures(obj: THREE.Object3D): number {
    let count = 0;
    obj.traverse((child) => {
      const renderable = child as RenderableDiagnosticObject;
      if (!renderable.material) return;
      const before = this.webgl.info.memory.textures;
      this.prewarmMaterialTextures(renderable.material);
      count += Math.max(0, this.webgl.info.memory.textures - before);
    });
    return count;
  }

  private renderPrewarmPass(dt: number): void {
    this.prewarmWorldFrame(dt);
    if (this.post) this.post.render();
    else this.webgl.render(this.scene, this.camera);
  }

  private diagnosticsBaselineForPrewarm(): RendererPrewarmDiagnosticsBaselineStats | null {
    if (!this.renderDiagnosticsEnabled) return null;
    this.renderDiagnosticsSnapshot = this.collectRenderDiagnostics();
    const categories: RendererPrewarmDiagnosticsBaselineStats['categories'] = {};
    for (const [name, stat] of Object.entries(this.renderDiagnosticsSnapshot.categories)) {
      categories[name] = {
        draws: stat.draws,
        triangles: stat.triangles,
        materials: stat.materials,
      };
    }
    return {
      programs: this.renderDiagnosticsSnapshot.programs,
      textures: this.renderDiagnosticsSnapshot.textures,
      totalObjects: this.renderDiagnosticsSnapshot.totalObjects,
      estimatedDraws: this.renderDiagnosticsSnapshot.estimatedDraws,
      estimatedTriangles: this.renderDiagnosticsSnapshot.estimatedTriangles,
      categories,
    };
  }

  async prewarmInitialScene(options: { maxMs?: number } = {}): Promise<RendererPrewarmStats> {
    const maxMs = Math.max(0, options.maxMs ?? VIEW_PREWARM_MAX_MS);
    const started = performance.now();
    const deadline = started + maxMs;
    const manifestEntries: RendererPrewarmManifestEntryStats[] = [];
    const startCounts = this.prewarmCounts();
    const createdViewTypes: string[] = [];
    const p = this.sim.player;
    let createdViews = 0;
    let candidateViews = 0;
    let doorPrewarmGroup: THREE.Group | null = null;
    let entityPrewarmGroup: THREE.Group | null = null;
    let playerPrewarmGroup: THREE.Group | null = null;
    let objectPrewarmGroup: THREE.Group | null = null;
    let propMaterialPrewarmGroup: THREE.Group | null = null;

    let renderPasses = 0;
    let playerPrewarmVisuals = 0;
    let vfxPrewarmBursts = 0;
    let compileMode: RendererPrewarmStats['compileMode'] = 'none';
    let compileMs = 0;
    let compileTimedOut = false;
    let textureUploads = 0;
    let diagnosticsBaseline: RendererPrewarmDiagnosticsBaselineStats | null = null;

    type PrewarmManifestEntry = {
      id: string;
      category: RendererPrewarmCategory;
      priority: number;
      required: boolean;
      run: () => void | Promise<void>;
      detail?: () => string;
    };

    const runEntry = async (
      entry: PrewarmManifestEntry,
    ): Promise<void> => {
      const before = this.prewarmCounts();
      const entryStarted = performance.now();
      if (entryStarted >= deadline) {
        manifestEntries.push({
          id: entry.id,
          category: entry.category,
          priority: entry.priority,
          required: entry.required,
          status: 'timed-out',
          elapsedMs: 0,
          remainingMsAfter: 0,
          passes: renderPasses,
          programsBefore: before.programs,
          programsAfter: before.programs,
          programDelta: 0,
          texturesBefore: before.textures,
          texturesAfter: before.textures,
          textureDelta: 0,
          detail: entry.detail?.(),
        });
        return;
      }
      let status: RendererPrewarmManifestEntryStats['status'] = 'completed';
      try {
        await entry.run();
      } catch (err) {
        status = 'failed';
        console.warn(`Renderer prewarm entry failed: ${entry.id}`, err);
      }
      const after = this.prewarmCounts();
      const entryEnded = performance.now();
      manifestEntries.push({
        id: entry.id,
        category: entry.category,
        priority: entry.priority,
        required: entry.required,
        status,
        elapsedMs: roundMs(entryEnded - entryStarted),
        remainingMsAfter: roundMs(Math.max(0, deadline - entryEnded)),
        passes: renderPasses,
        programsBefore: before.programs,
        programsAfter: after.programs,
        programDelta: after.programs - before.programs,
        texturesBefore: before.textures,
        texturesAfter: after.textures,
        textureDelta: after.textures - before.textures,
        detail: entry.detail?.(),
      });
    };

    const manifest: PrewarmManifestEntry[] = [
      {
        id: 'views.required',
        category: 'views',
        priority: 10,
        required: true,
        run: () => {
        createdViews += this.createRequiredViews(p, createdViewTypes);
        createdViews += this.createPersistentPortalViews(createdViewTypes, deadline);
        },
        detail: () => `created=${createdViews}`,
      },
      {
        id: 'views.nearby',
        category: 'views',
        priority: 20,
        required: true,
        run: () => {
        this.collectMissingViewCandidates(p, VIEW_PREWARM_RANGE_SQ, false);
        candidateViews = this.viewCandidates.length;
        const maxViews = this.lowGfx ? VIEW_PREWARM_MAX_VIEWS_LOW : VIEW_PREWARM_MAX_VIEWS_HIGH;
        createdViews += this.createCandidateViews(Math.max(0, maxViews - createdViews), createdViewTypes, deadline);
        },
        detail: () => `created=${createdViews};candidates=${candidateViews}`,
      },
      {
        id: 'props.dungeon-doors',
        category: 'objects',
        priority: 30,
        required: true,
        run: () => {
        doorPrewarmGroup = this.buildDoorPrewarmGroup();
          this.scene.add(doorPrewarmGroup);
        },
      },
      {
        id: 'entities.mob-archetypes',
        category: 'entities',
        priority: 35,
        required: true,
        run: () => {
          entityPrewarmGroup = this.buildEntityPrewarmGroup();
          this.scene.add(entityPrewarmGroup);
        },
        detail: () => `templates=${PREWARM_MOB_TEMPLATE_IDS.length};copies=${PREWARM_MOB_POOL_COPIES}`,
      },
      {
        id: 'entities.player-archetypes',
        category: 'entities',
        priority: 37,
        required: true,
        run: () => {
          const built = this.buildPlayerPrewarmGroup(deadline);
          playerPrewarmGroup = built.group;
          playerPrewarmVisuals = built.visualCount;
          this.scene.add(playerPrewarmGroup);
        },
        detail: () => `classes=${ALL_CLASSES.length};skins=${prewarmPlayerSkinVariantCount()};visuals=${playerPrewarmVisuals}`,
      },
      {
        id: 'objects.quest-archetypes',
        category: 'objects',
        priority: 40,
        required: true,
        run: () => {
          objectPrewarmGroup = this.buildObjectPrewarmGroup();
          this.scene.add(objectPrewarmGroup);
        },
        detail: () => `items=${PREWARM_OBJECT_ITEM_IDS.length};copies=${PREWARM_OBJECT_POOL_COPIES}`,
      },
      {
        id: 'props.material-variants',
        category: 'props',
        priority: 45,
        required: true,
        run: () => {
        propMaterialPrewarmGroup = buildPropMaterialPrewarmGroup();
        propMaterialPrewarmGroup.position.set(p.pos.x, p.pos.y, p.pos.z - 18);
        setRenderCategory(propMaterialPrewarmGroup, 'prewarm');
        this.scene.add(propMaterialPrewarmGroup);
        },
        detail: () => `objects=${propMaterialPrewarmGroup?.children.length ?? 0}`,
      },
      {
        id: 'textures.scene',
        category: 'world',
        priority: 50,
        required: true,
        run: () => {
        textureUploads = this.prewarmObjectTextures(this.scene);
        },
        detail: () => `uploaded=${textureUploads}`,
      },
      {
        id: 'vfx.atlas',
        category: 'vfx',
        priority: 60,
        required: false,
        run: () => {
        const offsets = [
          [0, -4],
          [-3, -5],
          [3, -5],
          [0, -7],
        ] as const;
        for (const [dx, dz] of offsets) {
          if (performance.now() >= deadline) break;
          this.vfx.prewarm(new THREE.Vector3(p.pos.x + dx, p.pos.y + 1, p.pos.z + dz));
          vfxPrewarmBursts++;
        }
        },
        detail: () => `bursts=${vfxPrewarmBursts}`,
      },
      {
        id: 'world.initial-frame',
        category: 'world',
        priority: 70,
        required: true,
        run: () => {
        this.renderPrewarmPass(1 / 60);
        renderPasses++;
        },
      },
      {
        id: 'programs.compile',
        category: 'world',
        priority: 80,
        required: true,
        run: async () => {
        const compileStart = performance.now();
        const compileBudgetMs = Math.max(0, deadline - compileStart);
        if (compileBudgetMs > 0 && this.webgl.compileAsync) {
          compileMode = 'async';
          let settled = false;
          const compilePromise = this.webgl.compileAsync(this.scene, this.camera)
            .then(() => { settled = true; })
            .catch((err: unknown) => {
              settled = true;
              console.warn('Renderer async prewarm compile failed', err);
            });
          await Promise.race([compilePromise, sleep(compileBudgetMs)]);
          compileTimedOut = !settled;
          compileMs = roundMs(performance.now() - compileStart);
        } else if (compileBudgetMs > 0) {
          compileMode = 'sync';
          this.webgl.compile(this.scene, this.camera);
          compileMs = roundMs(performance.now() - compileStart);
        }
        },
        detail: () => `mode=${compileMode};timedOut=${compileTimedOut}`,
      },
      {
        id: 'sky.biome-variants',
        category: 'sky',
        priority: 90,
        required: false,
        run: () => {
        const zs = [p.pos.z, ...ZONES.map((z) => z.zMax - 8), ...ZONES.map((z) => z.zMax + 8)]
          .filter((z) => Number.isFinite(z) && z > WORLD_MIN_Z && z < WORLD_MAX_Z)
          .slice(0, this.lowGfx ? 3 : 8);
        for (const z of zs) {
          if (performance.now() >= deadline) break;
          this.skyView.setCameraZ(z, 1 / 20);
          this.renderPrewarmPass(1 / 60);
          renderPasses++;
        }
        },
      },
      {
        id: 'render.settle-passes',
        category: this.post ? 'post' : 'world',
        priority: 100,
        required: false,
        run: () => {
        const minPasses = this.lowGfx ? 8 : 10;
        while (renderPasses < minPasses && performance.now() < deadline) {
          this.renderPrewarmPass(1 / 60);
          renderPasses++;
        }
        },
        detail: () => `passes=${renderPasses}`,
      },
      {
        id: 'diagnostics.baseline',
        category: 'diagnostics',
        priority: 110,
        required: false,
        run: () => {
        diagnosticsBaseline = this.diagnosticsBaselineForPrewarm();
        },
      },
    ];

    try {
      for (const entry of manifest) {
        await runEntry(entry);
      }
    } finally {
      this.vfx.clear();
      if (doorPrewarmGroup) this.scene.remove(doorPrewarmGroup);
      if (entityPrewarmGroup) this.scene.remove(entityPrewarmGroup);
      if (playerPrewarmGroup) this.scene.remove(playerPrewarmGroup);
      if (objectPrewarmGroup) this.scene.remove(objectPrewarmGroup);
      if (propMaterialPrewarmGroup) this.scene.remove(propMaterialPrewarmGroup);
    }

    const elapsed = performance.now() - started;
    const finalCounts = this.prewarmCounts();
    const manifestTimedOut = manifestEntries.filter((entry) => entry.status === 'timed-out');
    const manifestFailed = manifestEntries.filter((entry) => entry.status === 'failed');
    const stats: RendererPrewarmStats = {
      elapsedMs: roundMs(elapsed),
      maxMs: roundMs(maxMs),
      createdViews,
      candidateViews,
      renderPasses,
      programsBefore: startCounts.programs,
      programsAfter: finalCounts.programs,
      texturesBefore: startCounts.textures,
      texturesAfter: finalCounts.textures,
      compileMode,
      compileMs,
      compileTimedOut,
      timedOut: elapsed >= maxMs,
      remainingMs: roundMs(Math.max(0, deadline - performance.now())),
      budgetUsedRatio: maxMs > 0 ? roundMs(elapsed / maxMs) : 1,
      createdViewTypes,
      manifestPlanned: manifest.length,
      manifestEntries,
      manifestCompleted: manifestEntries.filter((entry) => entry.status === 'completed').length,
      manifestSkipped: manifestEntries.filter((entry) => entry.status === 'skipped').length,
      manifestTimedOut: manifestTimedOut.length,
      manifestFailed: manifestFailed.length,
      timedOutEntryIds: manifestTimedOut.map((entry) => entry.id),
      failedEntryIds: manifestFailed.map((entry) => entry.id),
      diagnosticsBaseline,
    };
    this.lastPrewarmStats = stats;
    return stats;
  }

  // Visual reactions to sim events (called by the HUD for every event,
  // including those between other players and mobs).
  handleEvent(ev: SimEvent): void {
    switch (ev.type) {
      case 'spellfx':
        if (ev.fx === 'projectile') this.vfx.projectile(ev.sourceId, ev.targetId, ev.school);
        else if (ev.fx === 'beam') this.vfx.beam(ev.sourceId, ev.targetId, ev.school);
        else if (ev.fx === 'tick') this.vfx.tick(ev.targetId, ev.school);
        else this.vfx.nova(ev.targetId, ev.school);
        break;
      case 'damage':
        // every melee/ranged swing animates the attacker for all to see
        if (ev.school === 'physical' && ev.sourceId !== -1) this.triggerAttack(ev.sourceId);
        if (ev.kind === 'hit' && ev.amount > 0) {
          // landed blows flinch the victim (rate-limited inside the visual)
          this.triggerHit(ev.targetId);
          if (ev.school === 'physical') this.vfx.meleeSpark(ev.targetId, ev.crit);
        }
        break;
      case 'heal2':
        if (ev.amount > 0 || ev.crit) this.vfx.healGlow(ev.targetId);
        break;
      case 'aura': {
        const tgt = this.sim.entities.get(ev.targetId);
        if (ev.gained && tgt?.kind === 'player') this.vfx.buffSwirl(ev.targetId);
        break;
      }
      case 'levelup':
        this.vfx.levelUpPillar(this.sim.playerId);
        break;
      case 'fiestaPowerup':
        // Big celebratory pop on grab, plus a lingering coloured glow.
        this.vfx.levelUpPillar(ev.entityId);
        this.vfx.nova(ev.entityId, 'nature');
        this.fiestaGlows.set(ev.entityId, { color: ev.glow, until: this.time + ev.duration, nextSwirl: 0 });
        if (ev.entityId === this.sim.playerId) this.addShake(0.5);
        break;
    }
  }

  // ---- 2v2 Fiesta juice (driven by the HUD's event handler) --------------

  // Add camera trauma (0..1). Squared on apply, so small adds barely register
  // and big hits (kills, ring closes) really kick.
  addShake(amount: number): void {
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  // A golden pillar bursts up off a fighter who just locked in an augment.
  fiestaAugmentBurst(entityId: number): void {
    this.vfx.levelUpPillar(entityId);
  }

  // A school-flavoured nova pops on a takedown.
  fiestaKillBurst(entityId: number, school = 'fire'): void {
    this.vfx.nova(entityId, school);
  }

  // The shrinking hazard-ring wall. Built once on first use, then positioned and
  // scaled to the live ring each frame; hidden whenever no Fiesta bout is active.
  private updateFiestaRing(dt: number): void {
    const match = this.sim.arenaInfo?.match;
    const ring = match?.fiesta?.ring;
    if (!ring || match?.state !== 'active') {
      if (this.fiestaRing) this.fiestaRing.visible = false;
      return;
    }
    if (!this.fiestaRing) {
      const geo = new THREE.CylinderGeometry(1, 1, 8, 48, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff3df0, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      this.fiestaRing = new THREE.Mesh(geo, mat);
      this.scene.add(this.fiestaRing);
    }
    const m = this.fiestaRing;
    m.visible = true;
    const gy = groundHeight(ring.cx, ring.cz, this.sim.cfg.seed);
    m.position.set(ring.cx, gy + 3, ring.cz);
    m.scale.set(ring.radius, 1, ring.radius);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.24 + Math.sin(this.time * 4) * 0.08;
    m.rotation.y += dt * 0.35;
  }

  // Floating power-up gems: a 5s growing/pulsing telegraph while 'spawning',
  // then a bright bobbing orb once 'ready'. Pooled by power-up id.
  private updateFiestaPowerups(dt: number): void {
    const match = this.sim.arenaInfo?.match;
    const list = (match?.fiesta && match.state === 'active') ? match.fiesta.powerups : [];
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let m = this.fiestaPowerupMeshes.get(p.id);
      if (!m) {
        const geo = new THREE.OctahedronGeometry(0.8, 0);
        const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
        m = new THREE.Mesh(geo, mat);
        this.fiestaPowerupMeshes.set(p.id, m);
        this.scene.add(m);
      }
      const gy = groundHeight(p.x, p.z, this.sim.cfg.seed);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(p.color);
      if (p.state === 'spawning') {
        m.scale.setScalar(0.25 + p.frac * 0.85);
        m.position.set(p.x, gy + 0.7, p.z);
        mat.opacity = 0.3 + Math.abs(Math.sin(this.time * 9)) * 0.4; // urgent pulse
      } else {
        m.scale.setScalar(1);
        m.position.set(p.x, gy + 1.1 + Math.sin(this.time * 2 + p.id) * 0.25, p.z);
        mat.opacity = 0.9;
      }
      m.rotation.y += dt * 1.6;
    }
    for (const [id, m] of this.fiestaPowerupMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
      m.geometry.dispose();
      this.fiestaPowerupMeshes.delete(id);
    }
  }

  private tickFiestaGlows(dt: number): void {
    if (this.fiestaGlows.size === 0) return;
    for (const [id, g] of this.fiestaGlows) {
      if (this.time >= g.until || !this.views.has(id)) { this.fiestaGlows.delete(id); continue; }
      g.nextSwirl -= dt;
      if (g.nextSwirl <= 0) { g.nextSwirl = 0.22; this.vfx.buffSwirl(id, g.color); }
    }
  }

  // -------------------------------------------------------------------------
  // Entity views
  // -------------------------------------------------------------------------

  // Shared object-view resources: views must not own materials/textures, or
  // interest churn leaks them (removeView only disposes per-view geometry).
  private doorStoneMat: THREE.Material | null = null;
  private doorArchGeo: THREE.BufferGeometry | null = null;
  private doorKeystoneGeo: THREE.BufferGeometry | null = null;
  private doorPlinthGeo: THREE.BufferGeometry | null = null;
  private doorPortalGeo: THREE.BufferGeometry | null = null;
  private doorNythraxisClickGeo: THREE.BufferGeometry | null = null;
  private doorNythraxisClickMat: THREE.MeshBasicMaterial | null = null;
  private doorEntrancePortalMat: THREE.MeshBasicMaterial | null = null;
  private doorExitPortalMat: THREE.MeshBasicMaterial | null = null;
  private sparkleMat: THREE.SpriteMaterial | null = null;

  private doorStoneMaterial(): THREE.Material {
    this.doorStoneMat ??= markSharedMaterial(new THREE.MeshLambertMaterial({ color: 0x6a6a72 }));
    return this.doorStoneMat;
  }

  private doorArchGeometry(): THREE.BufferGeometry {
    if (!this.doorArchGeo) {
      const outer = new THREE.Shape();
      outer.moveTo(-2.1, 0);
      outer.lineTo(-2.1, 3.1);
      outer.quadraticCurveTo(-2.1, 4.85, 0, 5.05);
      outer.quadraticCurveTo(2.1, 4.85, 2.1, 3.1);
      outer.lineTo(2.1, 0);
      outer.closePath();
      const inner = new THREE.Path();
      inner.moveTo(-1.3, -0.5);
      inner.lineTo(-1.3, 2.9);
      inner.quadraticCurveTo(-1.3, 4.05, 0, 4.22);
      inner.quadraticCurveTo(1.3, 4.05, 1.3, 2.9);
      inner.lineTo(1.3, -0.5);
      inner.closePath();
      outer.holes.push(inner);
      const archGeo = new THREE.ExtrudeGeometry(outer, {
        depth: 0.7, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 1,
      });
      archGeo.translate(0, 0, -0.35);
      this.doorArchGeo = markSharedGeometry(archGeo);
    }
    return this.doorArchGeo;
  }

  private doorKeystoneGeometry(): THREE.BufferGeometry {
    this.doorKeystoneGeo ??= markSharedGeometry(new THREE.BoxGeometry(0.7, 1.0, 0.95));
    return this.doorKeystoneGeo;
  }

  private doorPlinthGeometry(): THREE.BufferGeometry {
    this.doorPlinthGeo ??= markSharedGeometry(new THREE.BoxGeometry(1.15, 0.7, 1.15));
    return this.doorPlinthGeo;
  }

  private doorPortalGeometry(): THREE.BufferGeometry {
    this.doorPortalGeo ??= markSharedGeometry(new THREE.CircleGeometry(1.55, 24));
    return this.doorPortalGeo;
  }

  private doorNythraxisClickGeometry(): THREE.BufferGeometry {
    this.doorNythraxisClickGeo ??= markSharedGeometry(new THREE.BoxGeometry(4.6, 4.2, 2.4));
    return this.doorNythraxisClickGeo;
  }

  private doorNythraxisClickMaterial(): THREE.MeshBasicMaterial {
    this.doorNythraxisClickMat ??= markSharedMaterial(new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.001, depthWrite: false,
    }));
    return this.doorNythraxisClickMat;
  }

  private doorPortalMaterial(entering: boolean): THREE.MeshBasicMaterial {
    const tint = entering ? 0x9a5df0 : 0x6ab8ff;
    const existing = entering ? this.doorEntrancePortalMat : this.doorExitPortalMat;
    if (existing) return existing;
    const material = markSharedMaterial(new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    if (!this.lowGfx) material.color.multiplyScalar(PORTAL_BOOST);
    if (entering) this.doorEntrancePortalMat = material;
    else this.doorExitPortalMat = material;
    return material;
  }

  private buildDoorBody(entering: boolean, dungeonId?: string | null): { body: THREE.Group; portal?: THREE.Mesh } {
    const body = new THREE.Group();
    if (entering && dungeonId === 'nythraxis_crypt') {
      const clickBox = new THREE.Mesh(this.doorNythraxisClickGeometry(), this.doorNythraxisClickMaterial());
      clickBox.position.y = 2.1;
      body.add(clickBox);
      return { body };
    }

    const stone = this.doorStoneMaterial();
    const arch = new THREE.Mesh(this.doorArchGeometry(), stone);
    arch.castShadow = true;
    body.add(arch);
    const keystone = new THREE.Mesh(this.doorKeystoneGeometry(), stone);
    keystone.position.set(0, 4.75, 0);
    keystone.castShadow = true;
    body.add(keystone);
    for (const sx of [-1.7, 1.7]) {
      const plinth = new THREE.Mesh(this.doorPlinthGeometry(), stone);
      plinth.position.set(sx, 0.35, 0);
      plinth.castShadow = true;
      body.add(plinth);
    }
    const portal = new THREE.Mesh(this.doorPortalGeometry(), this.doorPortalMaterial(entering));
    portal.position.y = 2.15;
    portal.scale.set(1, 1.35, 1);
    body.add(portal);
    return { body, portal };
  }

  private buildDoorPrewarmGroup(): THREE.Group {
    const group = new THREE.Group();
    const entrance = this.buildDoorBody(true).body;
    entrance.position.x = -3;
    group.add(entrance);
    const exit = this.buildDoorBody(false).body;
    exit.position.x = 3;
    group.add(exit);
    const p = this.sim.player;
    group.position.set(p.pos.x, p.pos.y, p.pos.z - 8);
    setRenderCategory(group, 'entity:object');
    return group;
  }

  private createView(e: Entity): void {
    const group = new THREE.Group();
    setRenderCategory(group, `entity:${e.kind}`);
    let visual: CharacterVisual | null = null;
    let body: THREE.Group | null = null; // object views build meshes into this
    let height = 1.2;
    let sparkle: THREE.Sprite | undefined;
    let objectMesh: THREE.Object3D | undefined;
    let visualPoolKey: string | null = null;
    let objectPoolKey: string | null = null;
    const isQuestVision = e.kind === 'mob' && e.templateId.startsWith('vision_');

    let portal: THREE.Mesh | undefined;
    if (e.kind === 'object' && (e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit')) {
      const entering = e.templateId === 'dungeon_door';
      const built = this.buildDoorBody(entering, e.dungeonId);
      body = built.body;
      portal = built.portal;
      height = 4.6;
      objectMesh = body!;
    } else if (e.kind === 'object') {
      objectPoolKey = this.objectPoolKeyFor(e);
      const pooled = objectPoolKey ? this.takePooledObject(objectPoolKey) : null;
      if (pooled) {
        body = pooled.group;
        height = pooled.height;
        body.rotation.y = (e.id % 7) * 0.45;
      } else {
        const built = buildGroundQuestObject(e.objectItemId ?? '', e.id);
        body = built.group;
        height = built.height;
        objectPoolKey = null;
      }
      objectMesh = body!;
      if (!this.sparkleMat) {
        this.sparkleMat = new THREE.SpriteMaterial({ map: sparkleTexture(), transparent: true, depthWrite: false });
        if (!this.lowGfx) this.sparkleMat.color.setScalar(SPARKLE_BOOST); // gold glint via bloom
      }
      sparkle = new THREE.Sprite(this.sparkleMat);
      sparkle.scale.set(0.9, 0.9, 1);
      sparkle.position.y = 1.35;
      group.add(sparkle);
    } else {
      const visualKey = visualKeyFor(e);
      if (visualKey === 'player_mech' && !mechAssetsReady()) {
        void preloadMechAssets().catch((err) => console.error('Failed to preload live mech cosmetic:', err));
        return;
      }
      visualPoolKey = this.visualPoolKeyFor(e);
      visual = visualPoolKey ? this.takePooledVisual(visualPoolKey) : null;
      if (!visual) {
        visual = createCharacterVisual(e);
        visualPoolKey = null;
      }
      // entity scale is applied to the whole group below, so it can update live
      // (Fiesta size buffs) and also scale lazily-built form visuals for free.
      group.add(visual.root);
      height = visual.height;
    }

    let clickTarget: THREE.Object3D;
    if (visual) {
      // raycasting skinned meshes is expensive — pick against the invisible
      // capsule proxy instead (three's raycaster ignores `visible`)
      if (!isQuestVision) visual.clickProxy.userData.entityId = e.id;
      clickTarget = visual.clickProxy;
    } else {
      group.add(body!);
      body!.traverse((o) => { o.userData.entityId = e.id; });
      clickTarget = body!;
    }
    group.scale.setScalar(e.scale);
    group.position.set(e.pos.x, e.pos.y, e.pos.z);
    group.userData.entityId = e.id;
    this.scene.add(group);
    if (!isQuestVision) this.clickTargets.push(clickTarget);

    // nameplate
    const np = document.createElement('div');
    np.className = 'nameplate';
    np.style.display = 'none';
    const emoteEl = document.createElement('div');
    emoteEl.className = 'np-emote';
    emoteEl.style.display = 'none';
    const emoteIconEl = document.createElement('img');
    emoteIconEl.className = 'np-emote-icon';
    emoteIconEl.alt = '';
    const emoteLabelEl = document.createElement('span');
    emoteLabelEl.className = 'np-emote-label';
    emoteEl.append(emoteIconEl, emoteLabelEl);
    const raidMark = document.createElement('div');
    raidMark.className = 'np-raidmark';
    raidMark.style.display = 'none';
    // combo-point pips (rogue/druid): hidden until the local player builds
    // points on this entity; lit left-to-right as they accumulate
    const comboRow = document.createElement('div');
    comboRow.className = 'np-combo';
    comboRow.style.display = 'none';
    const comboPips: HTMLDivElement[] = [];
    for (let i = 0; i < COMBO_PIP_MAX; i++) {
      const pip = document.createElement('div');
      pip.className = 'np-combo-pip';
      comboRow.appendChild(pip);
      comboPips.push(pip);
    }
    const marker = document.createElement('div');
    marker.className = 'np-marker';
    const tierEl = document.createElement('img');
    tierEl.className = 'np-tier';
    tierEl.alt = '';
    tierEl.style.display = 'none';
    const nameEl = document.createElement('div');
    nameEl.className = 'np-name';
    nameEl.textContent = e.kind === 'object' ? objectDisplayName(e) : e.name;
    // guild tag under the name (players in a guild); hidden until set
    const guildEl = document.createElement('div');
    guildEl.className = 'np-guild';
    guildEl.style.display = 'none';
    const hpBar = document.createElement('div');
    hpBar.className = 'np-hpbar';
    const hpFill = document.createElement('div');
    hpFill.className = 'np-hpfill';
    hpBar.appendChild(hpFill);
    // overhead cast bar: hidden until the entity starts casting/channeling
    const castBar = document.createElement('div');
    castBar.className = 'np-castbar';
    castBar.style.display = 'none';
    const castFill = document.createElement('div');
    castFill.className = 'np-castfill';
    const castLabel = document.createElement('div');
    castLabel.className = 'np-castlabel';
    castBar.append(castFill, castLabel);
    np.append(emoteEl, raidMark, comboRow, marker, tierEl, nameEl, guildEl, hpBar, castBar);
    this.nameplateLayer.appendChild(np);

    // object views gate their own casters; character shadows live in visual
    const objectCasters: THREE.Object3D[] = [];
    if (!visual) collectCasters(group, objectCasters);
    this.views.set(e.id, {
      group, visual, visualKey: visual ? visualKeyFor(e) : null, visualPoolKey, sheepVisual: null, bearVisual: null, catVisual: null, travelVisual: null, height, clickTarget,
      nameplate: np, nameEl, guildEl, hpBar, hpFill, emoteEl, emoteIconEl, emoteLabelEl, markerEl: marker, raidMarkEl: raidMark, comboRow, comboPips, castBar, castFill, castLabel, tierEl, sparkle, objectMesh, objectPoolKey, portal,
      nameplateDisplay: 'none', nameplateTransform: '', nameplateSig: '', nameplateHpWidth: '', comboSig: '', tierValue: 0,
      objectCasters, shadowOn: true, isFar: false, lastOverheadEmoteKey: null,
      lastX: e.pos.x, lastZ: e.pos.z, skin: e.skin, liveScale: e.scale,
      loco: newLocoTrack(),
      stepAccum: 0, wasAirborne: false, wasSwimming: false,
    });
  }

  /** The visual the player currently sees (form swaps hide the base rig). */
  private activeVisual(v: EntityView): CharacterVisual | null {
    if (v.sheepVisual?.root.visible) return v.sheepVisual;
    if (v.bearVisual?.root.visible) return v.bearVisual;
    if (v.catVisual?.root.visible) return v.catVisual;
    if (v.travelVisual?.root.visible) return v.travelVisual;
    return v.visual;
  }

  private updateBaseVisual(e: Entity, v: EntityView): void {
    if (!v.visual) return;
    const nextKey = visualKeyFor(e);
    if (nextKey === v.visualKey) return;
    if (nextKey === 'player_mech' && !mechAssetsReady()) {
      void preloadMechAssets().catch((err) => console.error('Failed to preload live mech cosmetic:', err));
      return;
    }
    const next = createCharacterVisual(e);
    next.setShadow(v.shadowOn);
    next.setFar(v.isFar);
    next.root.visible = v.visual.root.visible;
    const oldClickTarget = v.clickTarget;
    const idx = this.clickTargets.indexOf(oldClickTarget);
    v.visual.dispose();
    v.group.remove(v.visual.root);
    if (!e.templateId.startsWith('vision_')) next.clickProxy.userData.entityId = e.id;
    if (idx >= 0) this.clickTargets[idx] = next.clickProxy;
    v.visual = next;
    v.visualKey = nextKey;
    v.clickTarget = next.clickProxy;
    v.height = next.height;
    v.skin = e.skin;
    v.group.add(next.root);
  }

  triggerAttack(entityId: number): void {
    const v = this.views.get(entityId);
    if (v) this.activeVisual(v)?.playAttack();
  }

  triggerHit(entityId: number): void {
    const v = this.views.get(entityId);
    if (v) this.activeVisual(v)?.playHit();
  }

  private isHostileSelectionTarget(target: Entity): boolean {
    // A controlled pet inherits its owner's reaction (a player's pet is hostile
    // only in PvP), so route mobs through the owner-aware helper; everything
    // else falls back to the player-vs-player verdict.
    if (target.kind === 'mob') {
      return target.ownerId !== null
        ? isOwnedPetHostile(target, this.sim.entities, (p) => this.isHostilePlayer(p))
        : target.hostile;
    }
    return this.isHostilePlayer(target);
  }

  private isHostilePlayer(target: Entity): boolean {
    if (target.kind !== 'player' || target.dead || target.id === this.sim.playerId) return false;
    if (this.sim.duelInfo?.state === 'active' && this.sim.duelInfo.otherPid === target.id) return true;
    const match = this.sim.arenaInfo?.match;
    return match?.state === 'active' && (match.oppPid === target.id || match.enemies.some((e) => e.pid === target.id));
  }

  // -------------------------------------------------------------------------
  // Per-frame sync
  // -------------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Dungeon interiors (see dungeon.ts), built lazily per instance origin.
  // ---------------------------------------------------------------------

  private builtInteriors = new Set<string>();
  private fogState: 'outdoor' | 'dungeon' | 'temple' | 'nythraxis' | 'underwater' = 'outdoor';

  private buildInterior(interior: string, ox: number, oz: number): void {
    this.dungeons ??= new DungeonInteriors(this.scene, this.lowGfx, this.flames, this.fireLights);
    void this.dungeons.buildInterior(interior, ox, oz).catch((err) => {
      console.error('Failed to build dungeon interior:', err);
    });
  }

  // Outdoor fog presets per biome (high tier eases between them as the
  // player crosses zone bands; low keeps the legacy vale fog everywhere).
  private static BIOME_FOG: Record<BiomeId, { color: number; near: number; far: number }> = {
    vale: { color: 0xa6c6e0, near: 130, far: 470 },
    marsh: { color: 0xa3b294, near: 80, far: 330 },
    peaks: { color: 0xbdd3ec, near: 160, far: 560 },
  };
  private static LOW_FOG = { color: 0xa6c6e0, near: 70, far: 260 };

  private outdoorFogPreset(): { color: number; near: number; far: number } {
    if (this.lowGfx) return Renderer.LOW_FOG;
    return Renderer.BIOME_FOG[zoneBiomeAt(this.sim.player.pos.z)];
  }

  private updateAmbience(px: number, camY: number, dt: number): void {
    const inside = px > DUNGEON_X_THRESHOLD;
    if (inside && isArenaPos(px)) {
      void ensureDungeonAssets().catch(() => undefined);
      // build the Ashen Coliseum copy the player was matched into
      const pz = this.sim.player.pos.z;
      for (let i = 0; i < ARENA_SLOT_COUNT; i++) {
        const key = `arena:${i}`;
        if (this.builtInteriors.has(key)) continue;
        const o = arenaOrigin(i);
        if (Math.abs(px - o.x) < 200 && Math.abs(pz - o.z) < 120) {
          this.builtInteriors.add(key);
          this.buildInterior('arena', o.x, o.z);
        }
      }
    } else if (inside) {
      void ensureDungeonAssets().catch(() => undefined);
      // build the interior copy the player is standing in
      for (const dungeon of DUNGEON_LIST) {
        for (let i = 0; i < INSTANCE_SLOT_COUNT; i++) {
          const key = `${dungeon.id}:${i}`;
          if (this.builtInteriors.has(key)) continue;
          const o = instanceOrigin(dungeon.index, i);
          if (Math.abs(px - o.x) < 200 && Math.abs(this.sim.player.pos.z - o.z) < 250) {
            this.builtInteriors.add(key);
            this.buildInterior(dungeon.interior, o.x, o.z);
          }
        }
      }
    }
    // the Drowned Temple reads as submerged: a teal murk instead of the
    // crypt's near-black, so its flooded halls feel underwater, not just dark
    const interior = inside && !isArenaPos(px) ? dungeonAt(px)?.interior : null;
    const inTemple = interior === 'temple';
    const inNythraxis = interior === 'nythraxis';
    const desired = inTemple ? 'temple'
      : inNythraxis ? 'nythraxis'
        : inside ? 'dungeon'
        : camY < WATER_LEVEL - 0.05 ? 'underwater' : 'outdoor';
    const fog = this.scene.fog as THREE.Fog;
    if (desired !== this.fogState) {
      this.fogState = desired;
      if (desired === 'dungeon') {
        fog.color.setHex(0x05060a);
        fog.near = 18;
        fog.far = 90;
      } else if (desired === 'temple') {
        fog.color.setHex(0x0a3a44);
        fog.near = 12;
        fog.far = 78;
      } else if (desired === 'nythraxis') {
        // the raid arena is huge (±230) — push the murk back so ~50yd reads
        // clear (linear-fog midpoint (near+far)/2 = 50), not the old ~30
        fog.color.setHex(0x020106);
        fog.near = 20;
        fog.far = 80;
      } else if (desired === 'underwater') {
        fog.color.setHex(0x17506e);
        fog.near = 2;
        fog.far = 48;
      } else {
        const preset = this.outdoorFogPreset();
        fog.color.setHex(preset.color);
        fog.near = preset.near;
        fog.far = preset.far;
      }
      // interiors must not leak daylight: drop sun + sky ambient + IBL
      // underground so the torch point lights own the scene; restore outside.
      // The rim glow cranks up instead — silhouettes must split from the murk.
      if (!this.lowGfx) {
        const underground = desired === 'dungeon' || desired === 'temple' || desired === 'nythraxis';
        this.sun.intensity = underground ? DUNGEON_SUN_INTENSITY : SUN_INTENSITY;
        this.hemi.intensity = underground ? DUNGEON_HEMI_INTENSITY : HEMI_INTENSITY;
        this.scene.environmentIntensity = underground ? DUNGEON_ENV_INTENSITY : this.envOutdoorIntensity;
        sharedUniforms.uRimBoost.value = underground ? DUNGEON_RIM_BOOST : 1;
      }
      return;
    }
    // outdoors: ease fog toward the current biome's preset (~2s)
    if (desired === 'outdoor' && !this.lowGfx) {
      const preset = this.outdoorFogPreset();
      const k = 1 - Math.exp(-dt * 1.5);
      fog.color.lerp(this.fogScratch.setHex(preset.color), k);
      fog.near += (preset.near - fog.near) * k;
      fog.far += (preset.far - fog.far) * k;
    }
  }

  // Swap the prefiltered environment map to the dominant biome's HDRI as the
  // camera crosses zone bands (the dome cross-fades the same textures); a
  // brief intensity dip masks the hard texture swap, then eases back like fog.
  private updateEnvBiome(dt: number): void {
    if (this.lowGfx || this.envRTs.size < 2) return;
    const blend = this.skyView.biomeAt(this.camera.position.z);
    const dominant = blend.t < 0.5 ? blend.from : blend.to;
    if (dominant !== this.envBiome && this.envRTs.has(dominant)) {
      this.envBiome = dominant;
      this.scene.environment = this.envRTs.get(dominant)!.texture;
      this.scene.environmentRotation.y = this.skyView.envRotationY(dominant);
      this.scene.environmentIntensity = this.envOutdoorIntensity * 0.4;
    }
    const k = 1 - Math.exp(-dt * 1.5);
    this.scene.environmentIntensity += (this.envOutdoorIntensity - this.scene.environmentIntensity) * k;
  }

  // Drop the view of an entity that left the world / our interest area.
  private removeView(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.group);
    v.nameplate.remove();
    const idx = this.clickTargets.indexOf(v.clickTarget);
    if (idx >= 0) this.clickTargets.splice(idx, 1);
    if (v.visual) {
      // Character geometry/materials are shared per-asset caches and must
      // survive interest churn — dispose only per-instance mixer bindings.
      if (v.visualPoolKey) this.storePooledVisual(v.visualPoolKey, v.visual);
      else v.visual.dispose();
      v.sheepVisual?.dispose();
      v.bearVisual?.dispose();
      v.catVisual?.dispose();
      v.travelVisual?.dispose();
    } else {
      if (v.objectPoolKey && v.objectMesh instanceof THREE.Group) {
        this.storePooledObject(v.objectPoolKey, { group: v.objectMesh, height: v.height });
      } else {
        // Object views usually own their geometries. Door portal resources are
        // shared and prewarmed, so they must survive interest churn.
        v.group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && !isSharedGeometry(mesh.geometry)) mesh.geometry.dispose();
        });
        if (v.portal && !isSharedMaterial(v.portal.material as THREE.Material)) (v.portal.material as THREE.Material).dispose();
      }
    }
    this.views.delete(id);
  }

  sync(alpha: number, dt: number, renderFacingOverride: number | null, selfAlphaLead = 0): void {
    const totalStart = performance.now();
    let phaseStart = totalStart;
    const framePhaseMs = emptyFramePhaseMs();
    const worldPhaseMs = emptyWorldPhaseMs();
    let createdViews = 0;
    let removedViews = 0;
    const createdViewTypes: string[] = [];
    const markPhase = (phase: RendererPhase): void => {
      const t = performance.now();
      const ms = t - phaseStart;
      framePhaseMs[phase] = roundMs(ms);
      this.recordRendererPhase(phase, ms);
      phaseStart = t;
    };
    const markWorldPhase = (phase: RendererWorldPhase, start: number): number => {
      const t = performance.now();
      worldPhaseMs[phase] += roundMs(t - start);
      return t;
    };

    this.updateAdaptiveResolution(dt);
    this.viewportPollTimer += dt;
    if (this.viewportPollTimer >= 0.25) {
      this.viewportPollTimer = 0;
      const measured = this.measureViewport();
      if (measured.width !== this.viewport.width || measured.height !== this.viewport.height) {
        this.resizeViewport(measured);
      }
    }
    this.time += dt;
    sharedUniforms.uTime.value = this.time;
    const sim = this.sim;
    const p = sim.player;
    const now = performance.now();
    const selfPos = this.updateSelfRenderPosition(alpha, dt, selfAlphaLead);
    markPhase('setup');

    // dynamic worlds: create nearby views lazily and drop views for leavers or
    // entities that moved well outside the draw band. This avoids building
    // rig/nameplate DOM for the whole sim on the first rendered frame.
    createdViews += this.createRequiredViews(p, createdViewTypes);
    this.collectMissingViewCandidates(p, ENTITY_VIEW_CREATE_RANGE_SQ, false);
    createdViews += this.createCandidateViews(this.runtimeViewCreateBudget(dt), createdViewTypes);
    this.doomedIds.length = 0;
    for (const id of this.views.keys()) {
      const e = sim.entities.get(id);
      if (!e || (!isPersistentPortalObject(e) && id !== p.id && id !== p.targetId && distSqXZ(e, p) > ENTITY_VIEW_DESTROY_RANGE_SQ)) {
        this.doomedIds.push(id);
      }
    }
    for (const id of this.doomedIds) {
      this.removeView(id);
      removedViews++;
    }

    // frame parity for distance-tiered mixer throttling
    this.frameIdx = (this.frameIdx + 1) & 0xffff;

    // world-space view frustum for the per-character cull below. Built from last
    // frame's camera (it's repositioned after this loop); the one-frame lag is
    // absorbed by the generous per-rig cull radius.
    if (this.cullCharacters) {
      this.cullViewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      this.cullFrustum.setFromProjectionMatrix(this.cullViewProj);
    }

    for (const [id, v] of this.views) {
      const e = sim.entities.get(id);
      if (!e) continue;
      // form swaps (polymorph sheep, druid forms) — computed up front because
      // the shadow gates below must not run the base rig's proxy under a form
      const polyed = e.auras.some((a) => a.kind === 'polymorph');
      const bear = !polyed && e.auras.some((a) => a.kind === 'form_bear');
      const ghostWolf = !polyed && !bear && e.auras.some((a) => a.id === 'ghost_wolf');
      const cat = !polyed && !bear && (ghostWolf || e.auras.some((a) => a.kind === 'form_cat'));
      const travel = !polyed && !bear && !cat && e.auras.some((a) => a.kind === 'form_travel');
      const stealthed = e.auras.some((a) => a.kind === 'stealth');
      // distance cull: far rigs are invisible specks but cost real draw calls
      const cdx = e.pos.x - p.pos.x, cdz = e.pos.z - p.pos.z;
      const d2 = cdx * cdx + cdz * cdz;
      if (id !== p.id) {
        // Per-frame visibility uses the SAME 80/96 hysteresis as view
        // create/destroy (above) so a rig hovering right at the 80yd draw edge
        // doesn't toggle visible/invisible every frame — that hard cutoff is the
        // actual on-screen boundary flicker. group.visible carries last frame's
        // state: once shown, keep it until past the 96yd destroy radius (where
        // the view is torn down anyway); while hidden, show only within 80yd.
        const showCutoff = v.group.visible ? ENTITY_VIEW_DESTROY_RANGE_SQ : ENTITY_VIEW_CREATE_RANGE_SQ;
        if (d2 > showCutoff) {
          v.group.visible = false;
          continue;
        }
        v.group.visible = true; // the object branch below may re-hide loot
        // mid-distance rigs keep rendering but leave the shadow pass
        const wantShadow = d2 < ENTITY_SHADOW_RANGE_SQ;
        const inProxyBand = d2 < ENTITY_PROXY_SHADOW_RANGE_SQ;
        if (v.visual) {
          v.visual.setShadow(wantShadow);
          v.isFar = d2 > ENTITY_LOD_RANGE_SQ;
          // past the articulated gate the static-pose proxy carries the
          // shadow; an active form's own rig keeps casting instead
          v.visual.setProxyShadow(!wantShadow && inProxyBand && !polyed && !bear && !cat && !travel);
          // sheep/forms keep articulated shadows through the whole proxy band —
          // a frozen humanoid proxy silhouette would be wrong under a form
          const wantFormShadow = wantShadow || inProxyBand;
          v.sheepVisual?.setShadow(wantFormShadow);
          v.bearVisual?.setShadow(wantFormShadow);
          v.catVisual?.setShadow(wantFormShadow);
          v.travelVisual?.setShadow(wantFormShadow);
        } else if (wantShadow !== v.shadowOn) {
          v.shadowOn = wantShadow;
          for (const caster of v.objectCasters) (caster as THREE.Mesh).castShadow = wantShadow;
        }
      }
      // online, entities beyond nameplate range stream below snapshot rate;
      // each interpolates on its own clock so they move smoothly instead of
      // freezing and dashing once per update (self keeps the global alpha
      // the camera follow uses)
      const isSelf = e.id === p.id;
      const ea = e.id !== p.id && e.netUpdatedAt !== undefined && e.netInterval !== undefined
        ? Math.min(1.25, (now - e.netUpdatedAt) / Math.max(20, e.netInterval))
        : isSelf ? selfSnapshotAlpha(alpha, selfAlphaLead) : alpha;
      const x = isSelf ? selfPos.x : e.prevPos.x + (e.pos.x - e.prevPos.x) * ea;
      const y = isSelf ? selfPos.y : e.prevPos.y + (e.pos.y - e.prevPos.y) * ea;
      const z = isSelf ? selfPos.z : e.prevPos.z + (e.pos.z - e.prevPos.z) * ea;
      v.group.position.set(x, y, z);
      let facing = e.prevFacing + shortestAngle(e.prevFacing, e.facing) * ea;
      if (id === p.id && renderFacingOverride !== null) facing = renderFacingOverride;
      v.group.rotation.y = facing;

      if (e.kind === 'object') {
        const isPortalObject = isPersistentPortalObject(e);
        const vis = e.lootable && (!isPortalObject || d2 <= ENTITY_VIEW_CREATE_RANGE_SQ);
        v.group.visible = vis;
        if (v.sparkle && vis) {
          // sub-pixel beyond ~45u but still a full transparent draw each
          const sdx = e.pos.x - p.pos.x, sdz = e.pos.z - p.pos.z;
          v.sparkle.visible = sdx * sdx + sdz * sdz < SPARKLE_DRAW_RANGE_SQ;
          const pulse = 0.75 + Math.sin(this.time * 3 + e.id) * 0.25;
          v.sparkle.scale.set(pulse, pulse, 1);
          v.sparkle.material.rotation = this.time * 0.8;
        }
        if (vis
          && (e.objectItemId === 'bastion_ward_stone' || e.objectItemId === 'soulshard_pillar')
          && e.auras.some((a) => a.id === 'nythraxis_wardstone_lit')) {
          this.vfx.castSparkle(e.id, 'arcane', dt * 2.6);
        }
        if (v.portal && vis) {
          v.portal.rotation.z = this.time * 1.4;
          (v.portal.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(this.time * 2.2 + e.id) * 0.15;
        }
        continue;
      }
      if (!v.visual) continue;

      this.updateBaseVisual(e, v);
      if (!v.visual) continue;

      // off-screen rigs still need their pose/audio updated, but not their draws.
      // Decide visibility now from the real world position; applied at the end so
      // the rest of the per-entity work (animation, footstep audio) is unaffected.
      let charOnScreen = true;
      if (this.cullCharacters && id !== p.id) {
        this.cullSphere.center.set(x, y + v.height * 0.5 * e.scale, z);
        this.cullSphere.radius = (v.height * 0.7 + 1.5) * e.scale;
        charOnScreen = this.cullFrustum.intersectsSphere(this.cullSphere);
      }

      // live skin swap — appearance changed (in-game changer or a multiplayer peer)
      if (e.skin !== v.skin) { v.skin = e.skin; v.visual.setSkin(e.skin); }

      // live body-size buffs (Fiesta power-ups): scale the whole group so the
      // rig, click proxy, and any form visual grow/shrink together.
      if (e.scale !== v.liveScale) { v.liveScale = e.scale; v.group.scale.setScalar(e.scale); }

      // swimming pose: prone at the surface (derived here — the sim is unaware).
      // The cheap feet-depth test gates the expensive terrain-noise sample: an
      // entity whose feet are above the swim line can't be swimming, so the vast
      // majority (everyone on land) skip groundHeight() entirely each frame.
      const swimming = !e.dead
        && e.pos.y <= WATER_LEVEL - 0.5
        && groundHeight(e.pos.x, e.pos.z, this.sim.cfg.seed) < WATER_LEVEL - 0.8;

      // lazy form visuals, swapped by visibility like the old sheep/bear rigs
      if (polyed && !v.sheepVisual) {
        v.sheepVisual = createCharacterVisual(e, 'form_sheep');
        v.group.add(v.sheepVisual.root); // group.scale already carries e.scale
      }
      if (bear && !v.bearVisual) {
        v.bearVisual = createCharacterVisual(e, 'form_bear');
        v.group.add(v.bearVisual.root);
      }
      if (cat && !v.catVisual) {
        v.catVisual = createCharacterVisual(e, 'form_cat');
        v.group.add(v.catVisual.root);
      }
      if (travel && !v.travelVisual) {
        v.travelVisual = createCharacterVisual(e, 'form_travel');
        v.group.add(v.travelVisual.root);
      }
      if (v.sheepVisual) v.sheepVisual.root.visible = polyed;
      if (v.bearVisual) v.bearVisual.root.visible = bear;
      if (v.catVisual) v.catVisual.root.visible = cat;
      if (v.travelVisual) v.travelVisual.root.visible = travel;
      const active = polyed && v.sheepVisual ? v.sheepVisual
        : bear && v.bearVisual ? v.bearVisual
          : cat && v.catVisual ? v.catVisual
            : travel && v.travelVisual ? v.travelVisual : v.visual;
      const ghost = ghostWolf || shouldRenderStealthGhost(this.sim.playerId, e) || e.templateId.startsWith('vision_');
      active.setGhost(ghost);
      active.setSoulRend(characterSoulRendActive(e));
      v.visual.root.visible = active === v.visual;
      // distant rigs swap to the single-draw baked idle-pose mesh
      v.visual.setFar(v.isFar && active === v.visual);

      // animation state machine inputs, derived from render-space motion with
      // hysteresis so a one-frame speed dip can't reset the walk clip.
      // For the local player online, sample the *plain* interpolated sim motion
      // (ax/ay/az), never the smoothed/predicted self render position (selfPos):
      // the online self predictor freezes-then-jumps within each snapshot
      // interval, and feeding that jitter to the cadence/airborne logic
      // intermittently flips the base state and resets the walk clip. The
      // predictor moves only the mesh. Offline, ax==x so this is a no-op.
      const ax = isSelf ? e.prevPos.x + (e.pos.x - e.prevPos.x) * alpha : x;
      const ay = isSelf ? e.prevPos.y + (e.pos.y - e.prevPos.y) * alpha : y;
      const az = isSelf ? e.prevPos.z + (e.pos.z - e.prevPos.z) * alpha : z;
      const vx = ax - v.lastX, vz = az - v.lastZ;
      v.lastX = ax;
      v.lastZ = az;
      const loco = updateLocomotion(v.loco, vx, vz, facing, dt);
      const moving = loco.moving;
      const visuallyDead = isVisuallyDead(e);
      // `onGround` is authoritative offline but is never sent in online snapshots
      // (ClientWorld defaults it to true), so for players fall back to deriving the
      // airborne state from foot height vs terrain — keeps the jump pose working in
      // both worlds without a wire change. Gated to players (only they jump) to keep
      // the extra groundHeight sample off the hot path for mobs/NPCs.
      const airborne = !visuallyDead && !swimming && (
        !e.onGround
        || (e.kind === 'player'
          && ay - groundHeight(ax, az, this.sim.cfg.seed) > AIRBORNE_EPS));
      const st: AnimState = {
        speed: loco.speed,
        moving,
        airborne,
        backwards: loco.backwards,
        reverseBackpedal: ghostWolf,
        dead: visuallyDead,
        casting: e.castingAbility !== null && !visuallyDead,
        swimming,
        sitting: e.kind === 'player' && (e.sitting || e.eating !== null || e.drinking !== null),
      };
      // --- spatial movement audio (self + others) --------------------------
      // All gated by audibility (squared distance) so far entities cost nothing.
      const sink = this.audioSink;
      if (sink && d2 < SFX_MOVE_RANGE_SQ) {
        // jump / land / water-entry edges
        if (airborne && !v.wasAirborne && !visuallyDead) sink.movement('jump', ax, ay, az, isSelf);
        else if (!airborne && v.wasAirborne && !visuallyDead) sink.movement('land', ax, ay, az, isSelf);
        if (swimming && !v.wasSwimming && !visuallyDead) sink.movement('splash', ax, ay, az, isSelf);
        // footfalls / swim strokes via a distance accumulator (no timers)
        if (visuallyDead || st.sitting) {
          v.stepAccum = 0;
        } else if (swimming) {
          v.stepAccum += loco.speed * dt;
          if (v.stepAccum >= SWIM_STRIDE) { v.stepAccum = 0; sink.movement('swim', ax, ay, az, isSelf); }
        } else if (moving && !airborne) {
          v.stepAccum += loco.speed * dt;
          const stride = loco.speed >= FOOT_RUN_SPEED ? FOOT_STRIDE_RUN : FOOT_STRIDE_WALK;
          if (v.stepAccum >= stride) {
            v.stepAccum = 0;
            sink.footstep(ax, ay, az, this.surfaceAt(ax, az, ay), loco.speed >= FOOT_RUN_SPEED, isSelf);
          }
        } else {
          // standing still — prime the accumulator so the first step after moving
          // lands promptly rather than after a full stride of travel.
          v.stepAccum = FOOT_STRIDE_WALK * 0.6;
        }
      }
      v.wasAirborne = airborne;
      v.wasSwimming = swimming;
      // distance-tiered mixer updates: near = every frame, mid = every 2nd,
      // far (static LOD mesh visible) = every 6th; edges latch regardless
      let animate = true;
      if (id !== p.id) {
        if (v.isFar) animate = ((this.frameIdx + e.id) % 6) === 0;
        else if (d2 > ENTITY_SHADOW_RANGE_SQ) animate = ((this.frameIdx + e.id) & 1) === 0;
      }
      active.update(dt, st, animate);

      const emoteId = e.kind === 'player' && e.overheadEmoteId && !e.dead ? e.overheadEmoteId : null;
      const emoteKey = emoteId ? `${emoteId}:${e.overheadEmoteSeq}` : null;
      if (emoteKey !== v.lastOverheadEmoteKey) {
        const canPlayEmote = emoteId && !moving && !st.airborne && !st.swimming && !st.casting && !st.sitting;
        if (canPlayEmote) {
          active.playEmote(emoteId);
          v.lastOverheadEmoteKey = emoteKey;
        } else if (!emoteId) {
          v.lastOverheadEmoteKey = null;
        }
      }

      if (st.casting) {
        this.vfx.castSparkle(e.id, e.castingAbility === 'demon_heal' ? 'shadow' : ABILITIES[e.castingAbility!]?.school ?? 'arcane', dt);
      }
      if (e.auras.some((a) => a.id === 'nythraxis_soul_rend')) {
        this.vfx.castSparkle(e.id, 'shadow', dt * 3.2);
      }
      if (swimming) this.vfx.swimRipple(v.group.position, moving ? dt * 3 : dt);

      // skip the draw for off-screen rigs (pose/audio above already ran)
      if (!charOnScreen) v.group.visible = false;
    }

    // selection ring
    const target = p.targetId !== null ? sim.entities.get(p.targetId) : null;
    if (target) {
      const tv = this.views.get(target.id);
      if (tv) {
        const cx = tv.group.position.x;
        const cz = tv.group.position.z;
        const seed = this.sim.cfg.seed;
        // anchor the reticle to the ground under the unit (a classic decal: it
        // stays grounded even if the target jumps) and drape it over the slope.
        const gy = groundHeight(cx, cz, seed);
        this.selectionRing.position.set(cx, gy, cz);
        this.selectionRing.scale.setScalar(target.scale);
        const drape = drapeRingLocalY(
          this.selectionRingLocalXZ, cx, cz, gy, target.scale, 0.08,
          (sx, sz) => groundHeight(sx, sz, seed),
          this.selectionRingDrapeY,
        );
        const ringPos = this.selectionRingMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < drape.length; i++) ringPos.setY(i, drape[i]);
        ringPos.needsUpdate = true;
        this.selectionRingTicks.position.y = 0.08; // ticks float just above the footing
        this.selectionRingTicks.rotation.y += dt * SELECTION_RING_SPIN; // slow reticle spin
        const ringMat = this.selectionRingMat;
        ringMat.color.setHex(this.isHostileSelectionTarget(target) ? 0xcc2222 : 0xd4af37);
        if (!this.lowGfx) ringMat.color.multiplyScalar(SELECTION_RING_BOOST); // subtle bloom edge
        ringMat.opacity = 0.78 + 0.2 * Math.sin(this.time * 4.5); // gentle pulse
        this.selectionRing.visible = true;
      } else {
        this.selectionRing.visible = false;
      }
    } else {
      this.selectionRing.visible = false;
    }
    this.updateClickMarkers(dt);
    markPhase('entities');

    let worldStart = performance.now();

    // fire flicker + rising embers
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const fl = 0.85 + Math.sin(this.time * 9 + i * 2.4) * 0.12 + Math.sin(this.time * 23 + i) * 0.06;
      f.scale.set(fl, fl * (1 + Math.sin(this.time * 13 + i) * 0.12), fl);
      const mat = f.material as THREE.MeshLambertMaterial;
      if (mat.color.r > mat.color.b) {
        f.getWorldPosition(this.tmpV);
        this.vfx.campfireEmber(this.tmpV, dt);
      }
    }
    for (let i = 0; i < this.fireLights.length; i++) {
      const light = this.fireLights[i];
      const base = (light.userData.baseIntensity as number | undefined) ?? 11;
      light.intensity = base + Math.sin(this.time * 11 + i * 1.7) * 2.5 * (base / 11);
    }
    this.budgetFireLights(p.pos.x, p.pos.z);
    worldStart = markWorldPhase('lights', worldStart);

    // clouds drift (the high cirrus layer crawls slower); on the lit tiers
    // they tint warm sunward / cool anti-sun to anchor the key light's azimuth
    for (const cl of this.clouds) {
      cl.position.x += dt * ((cl.userData.drift as number | undefined) ?? 1.6);
      if (cl.position.x > 320) cl.position.x = -320;
      if (!this.lowGfx) {
        const along = ((cl.position.x - this.camera.position.x) * this.sunAzimuth.x
          + (cl.position.z - this.camera.position.z) * this.sunAzimuth.z) / 320;
        const t = Math.max(-1, Math.min(1, along)) * 0.5 + 0.5;
        (cl.material as THREE.SpriteMaterial).color.setRGB(
          0.86 + 0.14 * t, 0.90 + 0.05 * t, 1.0 - 0.13 * t,
        );
      }
    }
    worldStart = markWorldPhase('clouds', worldStart);

    // water shimmer (low-tier texture scroll; shader water rides uTime)
    this.waterView.update(this.time);
    worldStart = markWorldPhase('water', worldStart);
    this.vfx.update(dt);
    this.updateFiestaRing(dt);
    this.updateFiestaPowerups(dt);
    this.tickFiestaGlows(dt);
    worldStart = markWorldPhase('vfx', worldStart);

    this.updateCamera(selfPos, dt);
    worldStart = markWorldPhase('camera', worldStart);
    // Fully-fogged terrain chunks / tree buckets are dropped before the
    // frustum; camera-ghost props hide against the current eye-to-camera ray.
    const fogFar = (this.scene.fog as THREE.Fog).far;
    this.terrainView.update(this.camera.position.x, this.camera.position.z, fogFar);
    worldStart = markWorldPhase('terrain', worldStart);
    this.propsView.update(
      this.camera.position.x, this.camera.position.y, this.camera.position.z,
      this.cameraLookAt.x, this.cameraLookAt.y, this.cameraLookAt.z,
      fogFar,
    );
    this.dungeons?.update(
      this.camera.position.x, this.camera.position.y, this.camera.position.z,
      this.cameraLookAt.x, this.cameraLookAt.y, this.cameraLookAt.z,
    );
    worldStart = markWorldPhase('props', worldStart);
    this.foliage.update(
      p.pos.x, p.pos.z,
      this.camera.position.x, this.camera.position.y, this.camera.position.z,
      this.cameraLookAt.x, this.cameraLookAt.y, this.cameraLookAt.z,
      fogFar,
    );
    worldStart = markWorldPhase('foliage', worldStart);
    this.fish.update(p.pos.x, p.pos.z, dt);
    this.critters.update(p.pos.x, p.pos.z, dt);
    this.motes.update(p.pos.x, p.pos.z, dt);
    this.birds.update(p.pos.x, p.pos.z, dt);
    this.impactSite.update(p.pos.x, p.pos.z, dt);
    worldStart = markWorldPhase('fish', worldStart);
    this.updateAmbience(p.pos.x, this.camera.position.y, dt);
    worldStart = markWorldPhase('ambience', worldStart);
    // shadow frustum follows the player
    const pv = this.views.get(p.id);
    if (pv) {
      const pp = pv.group.position;
      this.sun.position.set(pp.x + SUN_ANCHOR.x, pp.y + SUN_ANCHOR.y, pp.z + SUN_ANCHOR.z);
      this.sun.target.position.set(pp.x, pp.y, pp.z);
    }
    worldStart = markWorldPhase('shadows', worldStart);
    // sky dome + sun disc ride along with the camera
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.sky.visible = this.fogState === 'outdoor';
    if (this.sky.visible) {
      this.skyView.setCameraZ(this.camera.position.z, dt);
      this.updateEnvBiome(dt);
    }
    // precipitation only falls outdoors; indoors/underwater pass null to clear
    this.weather.update(
      this.camera.position,
      dt,
      this.fogState === 'outdoor' ? zoneBiomeAt(p.pos.z) : null,
    );
    worldStart = markWorldPhase('sky', worldStart);
    for (const sp of this.sunSprites) {
      sp.position.copy(this.camera.position).addScaledVector(this.sunDir, 760);
      sp.visible = this.fogState === 'outdoor';
    }
    worldStart = markWorldPhase('sunSprites', worldStart);
    this.updateGodRays();
    worldStart = markWorldPhase('godRays', worldStart);
    markPhase('world');

    this.nameplateTimer += dt;
    const nameplateInterval = this.isMobileRuntime() ? 1 / 15 : 1 / 24;
    const fullNameplatePass = this.nameplateTimer >= nameplateInterval;
    if (fullNameplatePass) this.nameplateTimer = 0;
    this.updateNameplates(fullNameplatePass);
    this.updateChatBubbles();
    markPhase('nameplates');
    // Fiesta screen shake: trauma^2 jitter offsets the camera for the draw only.
    let shakeX = 0, shakeY = 0;
    if (this.shakeTrauma > 0) {
      this.shakeElapsed += dt;
      const intensity = this.shakeTrauma * this.shakeTrauma;
      const t = this.shakeElapsed * 60;
      shakeX = Math.sin(t * 1.7) * intensity * 0.6;
      shakeY = Math.sin(t * 2.3 + 1.1) * intensity * 0.45;
      this.camera.position.x += shakeX;
      this.camera.position.y += shakeY;
      this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.8);
    }
    if (this.post) this.post.render();
    else this.webgl.render(this.scene, this.camera);
    if (shakeX !== 0 || shakeY !== 0) { this.camera.position.x -= shakeX; this.camera.position.y -= shakeY; }
    markPhase('submit');
    const totalMs = performance.now() - totalStart;
    framePhaseMs.total = roundMs(totalMs);
    this.recordRendererPhase('total', totalMs);
    let visibleViews = 0;
    for (const v of this.views.values()) {
      if (v.group.visible) visibleViews++;
    }
    const afterSubmit = performance.now();
    const renderDiagnostics = this.renderDiagnosticsForFrame(
      afterSubmit,
      framePhaseMs.submit >= RENDER_STALL_ATTRIBUTION_MS,
    );
    const qualityChange = this.lastQualityChange
      ? {
        ...this.lastQualityChange,
        ageMs: roundMs(afterSubmit - this.lastQualityChange.atMs),
      }
      : null;
    this.lastFrameStats = {
      phaseMs: framePhaseMs,
      worldPhaseMs,
      foliage: this.foliage.perfStats(),
      renderDiagnostics,
      cameraPosition: {
        x: roundMs(this.camera.position.x),
        y: roundMs(this.camera.position.y),
        z: roundMs(this.camera.position.z),
      },
      playerPosition: {
        x: roundMs(p.pos.x),
        y: roundMs(p.pos.y),
        z: roundMs(p.pos.z),
      },
      biome: zoneBiomeAt(p.pos.z),
      lastQualityChange: qualityChange,
      createdViews,
      createdViewTypes,
      removedViews,
      candidateViews: this.viewCandidates.length,
      activeViews: this.views.size,
      visibleViews,
    };
  }

  // Grab a JPEG screenshot of the live scene for a bug report. The main
  // WebGLRenderer is created WITHOUT preserveDrawingBuffer (that costs memory on
  // the hot path), so the colour buffer is valid only until control returns to
  // the browser and it composites. We therefore render one fresh frame and read
  // it back synchronously in the SAME call, before yielding, then downscale onto
  // a 2D canvas and export JPEG to keep the payload small. Returns null on any
  // failure (lost context, tainted canvas) so the caller can degrade gracefully.
  captureScreenshot(maxEdge = 1280, quality = 0.7): string | null {
    try {
      if (this.post) this.post.render();
      else this.webgl.render(this.scene, this.camera);
      const gl = this.webgl.domElement;
      const dims = downscaleDims(gl.width, gl.height, maxEdge);
      const out = document.createElement('canvas');
      out.width = dims.w;
      out.height = dims.h;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(gl, 0, 0, dims.w, dims.h);
      return out.toDataURL('image/jpeg', quality);
    } catch {
      return null;
    }
  }

  // Forward-renderer point-light budget: every campfire/torch light exists,
  // but only the nearest GFX.maxPointLights within range shine each frame.
  // Rank entries are pooled (extended only when interiors add lights) and
  // world positions cached once — the lights never move — so this hot loop
  // allocates nothing and skips the sort while the budget isn't contended.
  private budgetFireLights(px: number, pz: number): void {
    const ranked = this.lightRank;
    while (ranked.length < this.fireLights.length) {
      const light = this.fireLights[ranked.length];
      ranked.push({ light, d2: 0, worldPos: light.getWorldPosition(new THREE.Vector3()) });
    }
    for (const entry of ranked) {
      const dx = entry.worldPos.x - px, dz = entry.worldPos.z - pz;
      entry.d2 = dx * dx + dz * dz;
    }
    const lightBudget = this.effectivePointLights || GFX.maxPointLights;
    if (ranked.length > lightBudget) ranked.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < ranked.length; i++) {
      ranked[i].light.visible = i < lightBudget && ranked[i].d2 < LIGHT_BUDGET_RANGE_SQ;
    }
  }

  // light shafts fade in as the camera turns toward the sun, outdoor only
  private updateGodRays(): void {
    if (this.godRays.length === 0) return;
    const outdoor = this.fogState === 'outdoor';
    // azimuth-only alignment — the chase cam always pitches down while the
    // sun sits high, so a full 3D dot product would never light the shafts
    this.camera.getWorldDirection(this.tmpV);
    this.tmpV.y = 0;
    this.tmpV.normalize();
    const sunAzimuth = this.tmpV2.set(this.sunDir.x, 0, this.sunDir.z).normalize();
    const facing = Math.max(0, this.tmpV.dot(sunAzimuth));
    const side = this.tmpV.set(sunAzimuth.z, 0, -sunAzimuth.x); // sunAzimuth x up
    for (let i = 0; i < this.godRays.length; i++) {
      const sp = this.godRays[i];
      sp.visible = outdoor;
      if (!outdoor) continue;
      const sway = Math.sin(this.time * 0.13 + i * 2.1) * 10;
      // hang the shafts sunward of the camera but near eye height so they
      // cross a third-person frame instead of floating 150u overhead
      sp.position.copy(this.camera.position)
        .addScaledVector(sunAzimuth, 48 + i * 26)
        .addScaledVector(side, (i - 1) * 30 + sway);
      sp.position.y = this.camera.position.y + 16 + i * 7;
      sp.material.opacity = facing * facing * facing * (0.30 - i * 0.05);
    }
  }

  private updateSelfRenderPosition(alpha: number, dt: number, selfAlphaLead: number): THREE.Vector3 {
    const p = this.sim.player;
    const playerAlpha = selfSnapshotAlpha(alpha, selfAlphaLead);
    const px = p.prevPos.x + (p.pos.x - p.prevPos.x) * playerAlpha;
    const py = p.prevPos.y + (p.pos.y - p.prevPos.y) * playerAlpha;
    const pz = p.prevPos.z + (p.pos.z - p.prevPos.z) * playerAlpha;
    if (selfAlphaLead > 0) {
      const dx = px - this.selfRenderPosition.x;
      const dy = py - this.selfRenderPosition.y;
      const dz = pz - this.selfRenderPosition.z;
      if (!this.selfRenderPositionReady || dx * dx + dy * dy + dz * dz > SELF_RENDER_SNAP_DIST_SQ) {
        this.selfRenderPosition.set(px, py, pz);
        this.selfRenderPositionReady = true;
      } else {
        const t = 1 - Math.exp(-SELF_RENDER_SMOOTH_RATE * Math.max(0, dt));
        this.selfRenderPosition.x += dx * t;
        this.selfRenderPosition.y += dy * t;
        this.selfRenderPosition.z += dz * t;
      }
    } else {
      this.selfRenderPosition.set(px, py, pz);
      this.selfRenderPositionReady = true;
    }
    return this.selfRenderPosition;
  }

  private updateCamera(selfPos: THREE.Vector3, dt: number): void {
    const p = this.sim.player;
    const seed = this.sim.cfg.seed;
    const px = selfPos.x;
    const py = selfPos.y;
    const pz = selfPos.z;
    const eyeY = py + 2.0;
    let cx = px - Math.sin(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    let cy = eyeY + Math.sin(this.camPitch) * this.camDist;
    let cz = pz - Math.cos(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    if (isArenaPos(p.pos.x)) {
      // Arena walls hide from the camera like buildings, so the chase camera
      // stays at the player's requested zoom instead of clamping inside the pit.
      this.camOcclusion.pullT = 1;
      this.camOcclusion.lensT = 1;
      this.camOcclusion.fov = CAMERA_BASE_FOV;
    } else {
      // Camera collision for non-hideable blockers. Camera-ghost props are left
      // at the requested zoom and hidden in props.ts while keeping their shadows.
      let hardT = cameraOcclusion(seed, px, eyeY, pz, cx, cy, cz, CAMERA_COLLIDER_PAD);
      let softT = cameraOcclusion(seed, px, eyeY, pz, cx, cy, cz, CAMERA_SOFT_COLLIDER_PAD);
      const segLen = Math.hypot(cx - px, cy - eyeY, cz - pz);
      if (segLen > 1e-3) {
        const minT = CAMERA_MIN_DIST / segLen;
        hardT = Math.min(1, Math.max(hardT, minT));
        softT = Math.min(1, Math.max(softT, minT));
      }
      stepCameraOcclusion(
        this.camOcclusion,
        hardT,
        softT,
        dt,
        CAMERA_PULL_IN_RATE,
        CAMERA_PULL_OUT_RATE,
        CAMERA_SOFT_PULL_WEIGHT,
        CAMERA_BASE_FOV,
        CAMERA_MAX_COMP_FOV,
      );
    }
    const ct = this.camOcclusion.pullT;
    cx = px + (cx - px) * ct;
    cy = eyeY + (cy - eyeY) * ct;
    cz = pz + (cz - pz) * ct;
    const groundY = groundHeight(cx, cz, seed) + 0.6;
    this.camera.position.set(cx, Math.max(cy, groundY), cz);
    if (Math.abs(this.camera.fov - this.camOcclusion.fov) > 0.01) {
      this.camera.fov = this.camOcclusion.fov;
      this.camera.updateProjectionMatrix();
    }
    this.cameraLookAt.set(px, eyeY, pz);
    this.camera.lookAt(this.cameraLookAt);
    this.camera.updateMatrixWorld();

    // Spatial-audio listener (at the camera, facing the player) + ambience state.
    const sink = this.audioSink;
    if (sink) {
      const cpx = this.camera.position.x, cpy = this.camera.position.y, cpz = this.camera.position.z;
      let fx = px - cpx, fy = eyeY - cpy, fz = pz - cpz;
      const fl = Math.hypot(fx, fy, fz) || 1;
      sink.setListener(cpx, cpy, cpz, fx / fl, fy / fl, fz / fl);
      const inDungeon = px > DUNGEON_X_THRESHOLD;
      const biome = zoneBiomeAt(pz);
      const precip = !this.weatherOn || inDungeon ? null : biome === 'peaks' ? 'snow' : biome === 'marsh' ? 'rain' : null;
      // Only at the water's edge / in it — sampled at the player, so a loose
      // threshold made the loop bleed across the low marsh from far off.
      const nearWater = !inDungeon && groundHeight(px, pz, seed) < WATER_LEVEL + 0.4;
      sink.ambience(biome, inDungeon, precip, nearWater);
    }
  }

  private updateNameplates(fullPass: boolean): void {
    const sim = this.sim;
    const p = sim.player;
    const { width: w, height: h } = this.viewport;
    for (const [id, v] of this.views) {
      const e = sim.entities.get(id);
      if (!e) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      const d2 = dx * dx + dz * dz;
      const urgent = id === p.targetId || d2 < 14 * 14 || e.castingAbility !== null;
      const isSelf = id === p.id;
      const hasOverheadEmote = !!(e.kind === 'player' && e.overheadEmoteId && !e.dead);
      const isDoor = e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit';
      const hidden = (isSelf && !hasOverheadEmote) || d2 > NAMEPLATE_RANGE_SQ
        || (e.dead && !e.lootable && e.kind === 'mob')
        || (e.kind === 'object' && !isDoor)
        // the sealed royal door inside the crypt carries no floating label —
        // it reads as part of the back wall, not a portal billboard
        || (isDoor && e.dungeonId === 'nythraxis_boss_arena')
        || (!this.showNameplates && e.kind === 'mob' && !e.dead);
      if (hidden) {
        if (v.nameplateDisplay !== 'none') {
          v.nameplate.style.display = 'none';
          v.nameplateDisplay = 'none';
        }
        continue;
      }
      this.tmpV.copy(v.group.position);
      this.tmpV.y += v.height * e.scale + (isSelf && hasOverheadEmote ? 0.2 : 0.8);
      if (!isProjectedNameplateAnchorVisible(this.camera, this.tmpV, this.tmpV2)) {
        if (v.nameplateDisplay !== 'none') {
          v.nameplate.style.display = 'none';
          v.nameplateDisplay = 'none';
        }
        continue;
      }
      this.tmpV.project(this.camera);
      if (this.tmpV.z < -1 || this.tmpV.z > 1) {
        if (v.nameplateDisplay !== 'none') {
          v.nameplate.style.display = 'none';
          v.nameplateDisplay = 'none';
        }
        continue;
      }
      const sx = (this.tmpV.x * 0.5 + 0.5) * w;
      const sy = (-this.tmpV.y * 0.5 + 0.5) * h;
      if (v.nameplateDisplay !== '') {
        v.nameplate.style.display = '';
        v.nameplateDisplay = '';
      }
      const transform = nameplateScreenTransform(sx, sy);
      if (transform !== v.nameplateTransform) {
        v.nameplate.style.transform = transform;
        v.nameplateTransform = transform;
      }

      if (!fullPass && !urgent) continue;
      v.nameplate.classList.toggle('has-emote', hasOverheadEmote);

      // party raid/target marker (only mobs are markable, so this is null elsewhere)
      const emote = e.overheadEmoteId ? OVERHEAD_EMOTES.find((x) => x.id === e.overheadEmoteId) : null;
      if (emote && e.kind === 'player' && !e.dead) {
        v.emoteIconEl.src = emoteIconUrl(emote.id);
        const emoteLabel = t(`hudChrome.emotes.${emote.id}`);
        v.emoteLabelEl.textContent = emoteLabel;
        v.emoteEl.title = emoteLabel;
        v.emoteEl.style.display = '';
      } else {
        v.emoteEl.style.display = 'none';
      }
      v.nameEl.style.display = '';

      const raidMark = this.sim.markerFor(e.id);
      if (raidMark !== null) {
        v.raidMarkEl.style.backgroundImage = `url(${raidMarkerDataUrl(raidMark)})`;
        v.raidMarkEl.style.display = '';
      } else {
        v.raidMarkEl.style.display = 'none';
      }

      // combo points the local player has built on this entity (rogue/druid)
      this.setNameplateCombo(v, comboPipsFor(p, e));

      if (e.kind === 'object') {
        // dungeon doorways announce themselves
        const objName = objectDisplayName(e);
        this.setNameplateStatic(v, `object|${objName}`, objName, '#c084ff', 'none', '', 'np-marker', '1');
      } else if (e.kind === 'player') {
        // other players: friendly blue with an hp bar; <Guild> tag under the name.
        // Self has no overhead nameplate, so its guild line stays hidden too.
        const opacity = e.auras.some((a) => a.kind === 'stealth') ? '0.55' : '1';
        const nameDisplay = isSelf ? 'none' : '';
        const hpDisplay = e.dead || isSelf ? 'none' : '';
        const guild = isSelf ? '' : e.guild;
        this.setNameplateStatic(v, `player|${e.name}|${guild}|${nameDisplay}|${hpDisplay}|${opacity}`, e.name, '#7fb8ff', hpDisplay, '', 'np-marker', opacity, '', guild);
        v.nameEl.style.display = nameDisplay;
        // $WOC holder-tier flair, shown on OTHER players (own nameplate is hidden).
        this.setNameplateTier(v, isSelf ? 0 : (e.holderTier ?? 0));
        this.setNameplateHp(v, e);
      } else if (e.kind === 'npc' || (!e.hostile && e.questIds.length > 0)) {
        const npcName = e.kind === 'npc'
          ? npcDisplayName(e.templateId)
          : tEntity({ kind: 'mob', id: e.templateId, field: 'name' });
        let marker = '';
        let cls = '';
        // role-aware: '!' only at the quest's giver, '?' only at its turn-in
        // NPC (gray while in progress), matching the gossip dialog
        for (const qid of e.questIds) {
          const quest = QUESTS[qid];
          if (!quest) continue;
          const st = sim.questState(qid);
          if (st === 'ready' && isQuestTurnInNpc(quest, e.templateId)) { marker = '?'; cls = 'ready'; break; }
          if (st === 'available' && quest.giverNpcId === e.templateId) { marker = '!'; cls = 'avail'; }
          else if (st === 'active' && isQuestTurnInNpc(quest, e.templateId) && !marker) { marker = '?'; cls = 'active'; }
        }
        const markerClass = cls ? `np-marker ${cls}` : 'np-marker';
        this.setNameplateStatic(v, `npc|${npcName}|${marker}|${markerClass}`, npcName, FRIENDLY, 'none', marker, markerClass, '1');
      } else {
        const diff = e.level - p.level;
        const template = MOBS[e.templateId];
        const elite = !!template?.elite;
        const boss = !!template?.boss;
        // A friendly controlled pet reads as friendly green; wild mobs keep the
        // classic level-difference ("con") color.
        const friendlyPet = isFriendlyPet(e, this.sim.entities, (pl) => this.isHostilePlayer(pl));
        const color = mobNameColor(diff, e.dead, friendlyPet);
        const mobName = e.ownerId !== null ? e.name : mobDisplayName(e.templateId);
        const name = e.dead ? t('worldContent.corpseName', { name: mobName }) : `[${e.level}${elite ? '+' : ''}] ${mobName}`;
        const hpDisplay = e.dead ? 'none' : '';
        const marker = e.lootable ? '$' : elite && !e.dead ? '◆' : '';
        // classic "dragon frame" cue: gold bar frame for elites, red for bosses (live mobs only)
        const frame = e.dead ? '' : boss ? 'boss' : elite ? 'elite' : '';
        this.setNameplateStatic(v, `mob|${name}|${color}|${hpDisplay}|${marker}|${frame}`, name, color, hpDisplay, marker, 'np-marker loot', '1', frame);
        this.setNameplateHp(v, e);
        // threat plate: tint the bar red when this mob is aggroed on me
        v.nameplate.classList.toggle('np-threat', isMobThreateningViewer(e, this.sim.playerId));
      }

      this.updateCastBar(v, e);
    }
  }

  private setNameplateStatic(
    v: EntityView,
    sig: string,
    name: string,
    color: string,
    hpDisplay: string,
    marker: string,
    markerClass: string,
    opacity: string,
    frame = '',
    guild = '',
  ): void {
    if (sig === v.nameplateSig) return;
    v.nameplateSig = sig;
    v.nameEl.textContent = name;
    v.nameEl.style.color = color;
    v.hpBar.style.display = hpDisplay;
    v.hpBar.classList.toggle('elite', frame === 'elite');
    v.hpBar.classList.toggle('boss', frame === 'boss');
    v.markerEl.textContent = marker;
    v.markerEl.className = markerClass;
    v.nameplate.style.opacity = opacity;
    // guild tag rides in the sig (players only); empty for every other kind
    if (guild) {
      v.guildEl.textContent = `<${guild}>`;
      v.guildEl.style.display = '';
    } else {
      v.guildEl.style.display = 'none';
    }
  }

  // Show/hide the $WOC holder-tier badge on a player's nameplate. Cheap-diffed
  // on the tier value so the badge image is only rebuilt when the tier changes.
  private setNameplateTier(v: EntityView, tier: number): void {
    if (tier === v.tierValue) return;
    v.tierValue = tier;
    const def = holderTierByIndex(tier);
    if (def) {
      v.tierEl.src = holderTierBadgeDataUrl(def, 32);
      v.tierEl.title = t('wallet.holderTierTitle', { tier: holderTierDisplayName(def) });
      v.tierEl.style.display = '';
    } else {
      v.tierEl.removeAttribute('src');
      v.tierEl.style.display = 'none';
    }
  }

  private setNameplateHp(v: EntityView, e: Entity): void {
    const width = `${(100 * e.hp / Math.max(1, e.maxHp)).toFixed(1)}%`;
    if (width === v.nameplateHpWidth) return;
    v.nameplateHpWidth = width;
    v.hpFill.style.width = width;
  }

  // Light `count` of the COMBO_PIP_MAX pips over this nameplate; hide the row
  // entirely at zero so non-combo classes/targets show nothing.
  private setNameplateCombo(v: EntityView, count: number): void {
    const n = Math.max(0, Math.min(COMBO_PIP_MAX, count));
    const sig = `${n}`;
    if (sig === v.comboSig) return;
    v.comboSig = sig;
    v.comboRow.style.display = n > 0 ? '' : 'none';
    for (let i = 0; i < v.comboPips.length; i++) {
      v.comboPips[i].classList.toggle('lit', i < n);
    }
  }

  // Overhead spell cast/channel bar. The fill + label rules live in the DOM-free
  // castBarState() helper (cast_bar.ts); here we just push them to the DOM. Casts
  // fill up toward completion, channels drain down — both honest to the live
  // cast fields the sim and the online snapshot already expose.
  private updateCastBar(v: EntityView, e: Entity): void {
    const st = castBarState(e);
    if (!st.visible) {
      if (v.castBar.style.display !== 'none') v.castBar.style.display = 'none';
      return;
    }
    v.castBar.style.display = '';
    v.castBar.classList.toggle('channel', st.channel);
    v.castFill.style.width = `${(st.fill * 100).toFixed(1)}%`;
    // cast_bar.ts keeps st.label as a stable id (DOM/i18n-free); localize here.
    v.castLabel.textContent = st.fishing
      ? t('abilityUi.cast.fishing')
      : (ABILITIES[st.label] ? tEntity({ kind: 'ability', id: st.label, field: 'name' }) : st.label);
  }

  // Hang a speech bubble over an entity's head; it follows the entity and
  // fades out after a few seconds (longer for longer messages).
  showChatBubble(entityId: number, text: string, yell: boolean): void {
    let b = this.chatBubbles.get(entityId);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'chat-bubble';
      this.nameplateLayer.appendChild(el);
      b = { el, until: 0 };
      this.chatBubbles.set(entityId, b);
    }
    b.el.textContent = text; // textContent: chat is player input, never HTML
    b.el.classList.toggle('yell', yell);
    // wall-clock ttl: sim/render time can run slower than real time under
    // frame-delta clamping, which would keep bubbles up too long
    b.until = performance.now() + 1000 * Math.min(10, 3.5 + text.length * 0.045);
  }

  private updateChatBubbles(): void {
    if (this.chatBubbles.size === 0) return;
    const { width: w, height: h } = this.viewport;
    const now = performance.now();
    for (const [id, b] of this.chatBubbles) {
      const e = this.sim.entities.get(id);
      const v = e ? this.views.get(id) : undefined;
      if (!e || !v || now >= b.until) {
        b.el.remove();
        this.chatBubbles.delete(id);
        continue;
      }
      // culled rigs (beyond ENTITY_DRAW_RANGE) stop updating group.position,
      // so a yell from 80–100u away would hang frozen over empty terrain —
      // fall back to the live entity position when the rig isn't being drawn
      if (v.group.visible) this.tmpV.copy(v.group.position);
      else this.tmpV.set(e.pos.x, e.pos.y, e.pos.z);
      this.tmpV.y += v.height * e.scale + 1.0;
      if (!isProjectedNameplateAnchorVisible(this.camera, this.tmpV, this.tmpV2)) {
        b.el.style.display = 'none';
        continue;
      }
      this.tmpV.project(this.camera);
      if (this.tmpV.z < -1 || this.tmpV.z > 1) { b.el.style.display = 'none'; continue; }
      b.el.style.display = '';
      const sx = (this.tmpV.x * 0.5 + 0.5) * w;
      const sy = (-this.tmpV.y * 0.5 + 0.5) * h;
      b.el.style.transform = nameplateScreenTransform(sx, sy);
    }
  }

  // Click-to-move (#95): where a screen click meets the ground. Intersects a
  // horizontal plane at the player's foot height — robust on the gentle terrain
  // here and far cheaper than raycasting the terrain mesh.
  groundPoint(clientX: number, clientY: number, planeY: number): { x: number; z: number } | null {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
  }

  pick(clientX: number, clientY: number): number | null {
    const ndc = new THREE.Vector2(
      (clientX / this.viewport.width) * 2 - 1,
      -(clientY / this.viewport.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.clickTargets, true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (o.userData.entityId !== undefined && o.userData.entityId !== this.sim.playerId) {
          const e = this.sim.entities.get(o.userData.entityId as number);
          if (e?.kind === 'object' && !e.lootable) return null;
          return o.userData.entityId as number;
        }
        o = o.parent;
      }
    }
    // Forgiving assist: nothing under the ray, so snap to the nearest
    // targetable character within a small screen radius — chibi proportions
    // and melee scrums (often hidden behind the player's own model) make
    // precise capsule clicks fiddly. Objects (doors/loot) still need a
    // direct hit; the local player never competes for the click.
    const SLOPPY_PICK_PX = 26;
    let bestId: number | null = null;
    let bestD = SLOPPY_PICK_PX;
    for (const [id, v] of this.views) {
      if (id === this.sim.playerId || !v.visual || !v.group.visible) continue;
      const e = this.sim.entities.get(id);
      if (!e || (e.dead && !e.lootable)) continue;
      this.tmpV.copy(v.group.position);
      this.tmpV.y += v.height * e.scale * 0.5;
      this.tmpV.project(this.camera);
      if (this.tmpV.z > 1) continue;
      const sx = (this.tmpV.x * 0.5 + 0.5) * this.viewport.width;
      const sy = (-this.tmpV.y * 0.5 + 0.5) * this.viewport.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        bestId = id;
      }
    }
    return bestId;
  }

  // Drop a transient OSRS-style click marker at a world ground point. Called from
  // main.ts on a qualifying left-click; `hostile` tints it red. Pure presentation,
  // it never reads or writes sim state. No-op if the pool is empty.
  spawnClickMarker(x: number, z: number, hostile: boolean): void {
    if (this.clickMarkers.length === 0) return;
    const slot = this.clickMarkers[this.clickMarkerNext];
    this.clickMarkerNext = (this.clickMarkerNext + 1) % this.clickMarkers.length;
    const y = groundHeight(x, z, this.sim.cfg.seed) + 0.06; // tiny lift to avoid z-fighting
    slot.group.position.set(x, y, z);
    slot.elapsed = 0;
    const color = clickMarkerColor(hostile);
    slot.ringMat.color.setHex(color);
    slot.crossMat.color.setHex(color);
    if (!this.lowGfx) {
      slot.ringMat.color.multiplyScalar(SELECTION_RING_BOOST); // subtle bloom edge, matches reticle
      slot.crossMat.color.multiplyScalar(SELECTION_RING_BOOST);
    }
    slot.group.visible = true;
  }

  // Advance every live click marker by dt and apply the ring/X fade+scale curves.
  private updateClickMarkers(dt: number): void {
    for (const slot of this.clickMarkers) {
      if (slot.elapsed >= CLICK_MARKER_LIFETIME) continue;
      slot.elapsed += dt;
      const a = clickMarkerAnim(slot.elapsed);
      if (!a.active) { slot.group.visible = false; continue; }
      slot.ring.scale.setScalar(a.ringScale);
      slot.ringMat.opacity = a.ringAlpha;
      slot.cross.scale.setScalar(a.crossScale);
      slot.crossMat.opacity = a.crossAlpha;
    }
  }

  worldToScreen(x: number, y: number, z: number): { x: number; y: number; behind: boolean } {
    this.tmpV.set(x, y, z).project(this.camera);
    return {
      x: (this.tmpV.x * 0.5 + 0.5) * this.viewport.width,
      y: (-this.tmpV.y * 0.5 + 0.5) * this.viewport.height,
      behind: this.tmpV.z > 1,
    };
  }
}

function shortestAngle(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
