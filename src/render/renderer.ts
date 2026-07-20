import * as THREE from 'three';
import { coerceFxTier, nameplateIntervalSec } from '../game/ui_tier_knobs';
import { cameraOcclusion } from '../sim/colliders';
import {
  ABILITIES,
  ARENA_SLOT_COUNT,
  arenaOrigin,
  CLASSES,
  DELVE_MODULE_Z_START,
  DUNGEON_LIST,
  DUNGEON_X_THRESHOLD,
  defaultDelveModules,
  delveAt,
  delveModuleStackEndRelZ,
  delveModuleZOffset,
  delveOrigin,
  delveSlotAt,
  dungeonAt,
  INSTANCE_SLOT_COUNT,
  ITEM_SETS,
  instanceOrigin,
  isArenaPos,
  isDelvePos,
  isYumiMazePos,
  MOBS,
  NPCS,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
  YUMI_MAZE_SLOT_COUNT,
  yumiMazeOrigin,
  ZONES,
} from '../sim/data';
import type { DelveModuleId } from '../sim/delve_layout';
import type { BiomeId } from '../sim/types';
import { ALL_CLASSES, type Entity, type SimEvent } from '../sim/types';
import { groundHeight, waterLevelAt, zoneBiomeAt } from '../sim/world';
import { attachAvatarFallback } from '../ui/avatar_fallback';
import { tEntity } from '../ui/entity_i18n';
import type { IWorld } from '../world_api';
import { isVisuallyDead } from './anim_state';
import { AOE_RING_LIFETIME, aoeRingAnim } from './aoe_ring';
import { buildArtisanRowProps } from './artisan_row_props';
import type { AmbientPointSource, SpatialAudioSink, Surface } from './audio_sink';
import { type BirdsView, buildBirds } from './birds';
import { type CameraOcclusionState, stepCameraOcclusion } from './camera_collision';
import {
  characterRecklessnessActive,
  characterSanguineAuraActive,
  characterSoulRendActive,
} from './character_effects';
import {
  type AnimState,
  type CharacterVisual,
  createCharacterVisual,
  setWeaponVfxViewportHeight,
} from './characters';
import { logAssetMissOnce } from './characters/asset_miss_log';
import {
  mechAssetsReady,
  preloadMechAssets,
  preloadTrainingDummyAssets,
  trainingDummyAssetsReady,
} from './characters/assets';
import { skinCount, visualKeyFor } from './characters/manifest';
import {
  playerRangedAttackAlreadyStarted,
  playerRangedAttackStartsAtLaunch,
} from './characters/skin_attack';
import { attackAbilityId, isSpinAttackAbility } from './characters/weapon_attack_style_core';
import { CLICK_MARKER_LIFETIME, clickMarkerAnim, clickMarkerColor } from './click_marker';
import { trackWebGLContext } from './context_release';
import { buildCritters, type CritterField } from './critters';
import { animatesEveryFrame, crowdLodScaleSq, midAnimCadence } from './crowd_lod';
import { shouldPlayDeedFirework } from './deed_fx_gate';
import { buildDelveModule } from './delve_interiors';
import { buildDelveInteractable, syncDelveInteractableVisibility } from './delve_props';
import { buildDoorBody } from './door_portal';
import { DungeonInteriors, ensureDungeonAssets } from './dungeon';
import { objectDisplayName } from './entity_labels';
import { advanceSelfFacing, releaseSelfFacing } from './facing_smooth';
import { type FireballTravelVisual, syncFireballTravelVisual } from './fireball_travel_visual';
import { buildFish, type FishView } from './fish';
import {
  buildFoliage,
  buildFoliageMaterialPrewarmGroup,
  type FoliagePerfStats,
  type FoliageView,
} from './foliage';
import {
  type FrostNovaRootVisual,
  isFrostNovaRootAura,
  syncFrostNovaRootVisual,
} from './frost_nova_root_visual';
import { FrozenOrbFx } from './frozen_orb_fx';
import { buildGatherNodes } from './gather_nodes';
import {
  GFX,
  type GfxBucketBands,
  type GfxBucketLevels,
  initGfxTier,
  SUN_ANCHOR,
  SUN_DIR,
  sharedUniforms,
  urlForcedTier,
} from './gfx';
import { GlacialFrontVisual } from './glacial_front_visual';
import { GroundAimReticleVisual } from './ground_aim_reticle_visual';
import { type IceBlockVisual, syncIceBlockVisual } from './ice_block_visual';
import { buildImpactSite, type ImpactSiteView } from './impact_site';
import { ensureDelveInteriorKit } from './interior_kit';
import { buildJailScene } from './jail_scene';
import { LightPulses } from './light_pulses';
import { type LocoTrack, newLocoTrack, updateLocomotion } from './locomotion';
import {
  type MageBarrierState,
  type MageBarrierVisual,
  mageBarrierStateForAura,
  syncMageBarrierVisual,
} from './mage_barrier_visual';
import { MageGroundFx } from './mage_ground_fx';
import { buildMailboxPillar } from './mailbox';
import { buildMotes, type MotesView } from './motes';
import { COMBO_PIP_MAX } from './nameplate_combo';
import { NameplatePainter } from './nameplate_painter';
import {
  isProjectedNameplateAnchorVisible,
  nameplateScreenTransform,
} from './nameplate_projection';
import { facingAlpha, remoteEntityAlpha } from './net_interp_core';
import { resolveDirectPickEntityId } from './pick_resolution';
import { PlacedAssetsView } from './placed_assets';
import {
  applyPointLightBudget,
  type RankedPointLight,
  reconcileViewPointLights,
} from './point_light_budget';
import { buildComposer, type PostPipeline } from './post';
import {
  orderedPrewarmIds,
  type PrewarmPolicy,
  prewarmEntryRuns,
  resolvePrewarmPolicy,
} from './prewarm_policy';
import { buildPropMaterialPrewarmGroup, buildProps } from './props';
import { buildGroundQuestObject } from './quest_objects';
import { isOwnedPetHostile } from './reaction';
import { RenderBudgetGovernor, type RenderBudgetState } from './render_budget';
import { RingOfFrostVisuals } from './ring_of_frost_visual';
import { downscaleDims } from './screenshot';
import { drapeRingLocalY } from './selection_ring';
import { type SelfMotionFrame, SelfMotionPredictor } from './self_motion';
import { isSharedGeometry, isSharedMaterial } from './shared_resource';
import { buildClouds, buildSky, type SkyView } from './sky';
import { nearestSloppyPickId, type SloppyPickCandidate } from './sloppy_pick';
import { freezeStaticMatrices } from './static_matrix';
import { buildStationProps } from './stations';
import { shouldRenderStealthGhost } from './stealth';
import { buildFlaredConeFan, buildRingXZ, drapeConeWorld } from './target_cone_debug';
import {
  syncTemporalHourglassVisual,
  TemporalHourglassGroundVisuals,
  type TemporalHourglassMode,
  type TemporalHourglassVisual,
} from './temporal_hourglass_visual';
import { buildTerrain, type TerrainView } from './terrain';
import { sparkleTexture } from './textures';
import { targetIntensity } from './travel_speed_fx';
import { TravelSpeedFxPainter } from './travel_speed_fx_painter';
import {
  BALL_RADIUS,
  buildValeCupBall,
  rollBallSpinner,
  VALE_CUP_BALL_TEMPLATE,
  ValeCupBallDust,
  ValeCupBallTrail,
} from './vale_cup_ball';
import { nationColors } from './vale_cup_flags';
import { ValeCupPracticeSky } from './vale_cup_practice_sky';
import { buildValeCupStadium, type ValeCupStadiumView } from './vale_cup_stadium';
import { buildValeCupTeamRings, type ValeCupTeamRingsView } from './vale_cup_team_ring';
import { SCHOOL_COLORS, Vfx } from './vfx';
import { ViewCreateRetryGate } from './view_create_retry';
import { type WarriorCastVisualPlan, warriorCastVisualPlan } from './warrior_cast_fx_core';
import { RecklessSkullPainter } from './warrior_cast_fx_painter';
import { buildWater, type WaterView } from './water';
import { Weather } from './weather';
import { buildWorldAmbientSources, crowdAmbienceAt, footstepSurfaceAt } from './world_audio';
import { buildYumiMaze, type YumiMazeView } from './yumi_maze';
import { YumiTeamMarkers } from './yumi_team_markers';

// Festival gold/white celebration palette, shared by the Vale Cup full-time
// draw show and the Book of Deeds unlock burst (one palette, two sites).
const FESTIVAL_GOLD_COLORS: readonly number[] = [0xffd14d, 0xfff2c0];

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
// Cooldown before re-attempting a view whose assets failed to build (the
// fail-soft path, issue #2079). Without it a permanently failing entity
// consumes a view-creation budget slot every frame; under the hitch backoff
// the budget is 1, so a first-sorted failing entity would starve every other
// pending view.
const VIEW_CREATE_FAIL_RETRY_MS = 2000;
const VIEW_PREWARM_RANGE_SQ = ENTITY_VIEW_CREATE_RANGE_SQ;
const VIEW_PREWARM_MAX_MS = 12000;
// Memory-ceiling profile (phone WebKit): the desktop budgets here allow the prewarm to
// occupy the main thread for 12s of view builds plus up to 10s of shader linking, with
// only microtask yields in between. iOS kills a WebContent process that stays
// unresponsive on that order (the same invisible kill as the memory ceiling, and RAM
// size is irrelevant to it), so constrained devices get a much smaller budget, an
// event-loop yield between manifest entries, and a link pass after each entry so no
// later single pass links every program at once. Full policy: prewarm_policy.ts.
const VIEW_PREWARM_MAX_MS_CONSTRAINED = 5000;
const PREWARM_COMPILE_MAX_MS_CONSTRAINED = 2500;
// Shader linking is the whole point of the prewarm: if it doesn't finish, the
// first in-world frame that needs a program compiles it synchronously — the
// multi-hundred-ms (up to ~1.7s) freeze players feel when new model types
// appear. So the compile step gets its own budget (it normally drains in <~100ms
// with KHR_parallel_shader_compile) rather than racing the leftover view-build
// budget, which could starve it to a timeout. The cap only bites if a driver
// stalls the parallel-compile queue; keep it modest, since a long hold here is
// itself worse than the freeze it prevents.
const PREWARM_COMPILE_MAX_MS = 10000;
// Safety ceiling for the per-view async-compile gate: if KHR_parallel_shader_compile
// somehow never reports a program ready, show the view anyway (degrading to the old
// synchronous first-use compile) rather than stranding an entity invisible.
const VIEW_COMPILE_GATE_MAX_MS = 1500;
// Reserve at the tail of the view-build budget so the compile + final-frame
// steps always start before the prewarm deadline (runEntry skips late entries).
const PREWARM_BUILD_RESERVE_MS = 3000;
const VIEW_PREWARM_MAX_VIEWS_LOW = 48;
const VIEW_PREWARM_MAX_VIEWS_HIGH = 72;
// Constrained (phone WebKit): a hard cap on nearby character views built
// SYNCHRONOUSLY at entry. A populated production hub has dozens of nearby players
// and NPCs; building them all up front is a large skinned-mesh + bone-texture +
// skin-upload spike that survives an empty local world but kills Medium in
// production. The rest stream in lazily via the per-frame view-create budget.
const VIEW_PREWARM_MAX_VIEWS_CONSTRAINED = 12;
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

// Crowd-adaptive character LOD (articulated-rig + shadow ranges, and the mid-band
// animation cadence) lives in `crowd_lod.ts`: pure policy, unit-tested there.
//
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

// Themed swirl colors for the 4-piece set-proc auras, by proc id; resolved to
// the buff display NAME below (the aura SimEvent carries only the name) via
// ITEM_SETS, so a re-coined proc name keeps its effect wired. The bleeds land
// on the TARGET (a mob), so the aura case below must not gate these on the
// player kind.
const SET_PROC_FX_BY_ID: Record<string, number> = {
  set_clearcasting: 0x8ed2ff, // icy arcane blue: a free cast
  set_gravemight: 0xffb04d, // burnished gold: attack power
  set_fangrush: 0xbfff5a, // feral green-yellow: attack speed
  set_bonesplinter: 0xc22a2a, // blood red: the plate bleed landing
  set_ragged_gash: 0xc22a2a, // blood red: the leather bleed landing
  set_soulblaze: 0xff6a9e, // ember pink: spell power
};
const SET_PROC_FX_BY_NAME = new Map<string, number>();
for (const set of Object.values(ITEM_SETS)) {
  for (const tier of set.bonuses) {
    const proc = tier.effect.proc;
    if (proc && SET_PROC_FX_BY_ID[proc.id] !== undefined) {
      SET_PROC_FX_BY_NAME.set(proc.name, SET_PROC_FX_BY_ID[proc.id]);
    }
  }
}
const CLICK_MARKER_POOL = 4; // concurrent click-feedback markers before reuse
const SPARKLE_BOOST = 1.5;
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
// Decay rate of the one-time offset captured when the self-motion predictor
// takes over from the lead-smoothing path (gone in ~0.3 s, no camera step).
const SELF_MOTION_HANDOFF_RATE = 15;
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
// Memory-ceiling profile: non-default biome env prefilters wait this long after the
// synchronous scene build (plus a stagger between each) so they never stack onto the
// world-entry allocation spike that gets phone WebKit's WebContent process killed.
// 30s/10s (was 12s/4s): the earlier schedule dropped a mip-chained HalfFloat
// cubemap build right into the first-half-minute window where a phone player is
// still settling in (opening the More tray, first camera swings), stacking the
// prefilter's transient GPU spike onto whatever the player just triggered while
// the post-entry footprint is at its peak. 30s also clears the entry crash
// guard's stable window, so a prefilter-coincident kill can never read as an
// entry crash and cost a tier.
const DEFERRED_ENV_PREFILTER_MS = 30000;
const DEFERRED_ENV_PREFILTER_STAGGER_MS = 10000;
const DUNGEON_HEMI_INTENSITY = 0.22; // floor of readability — bosses crushed to black at 0.14
// character rim glow scales up underground so silhouettes split from the murk
const DUNGEON_RIM_BOOST = 2.4;
// The Protect Yumi maze is a torch-lit NIGHT ARENA, not a crypt: a moon-key
// plus a healthy hemisphere keep the whole competitive space readable, with
// the braziers/torches adding warmth rather than carrying the scene alone.
const YUMI_MAZE_SUN_INTENSITY = 1.2;
const YUMI_MAZE_HEMI_INTENSITY = 0.42;
const YUMI_MAZE_ENV_INTENSITY = 0.28;
const YUMI_MAZE_RIM_BOOST = 1.7;
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
// The common templates above are pooled several-deep (they spawn in groups); every
// OTHER mob model is still built once so its shader program compiles at load.
const PREWARM_MOB_COMMON_IDS = new Set<string>(PREWARM_MOB_TEMPLATE_IDS);

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
type RendererPhaseStats = Record<
  RendererPhase,
  { count: number; avg: number; p95: number; max: number }
>;
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

type RendererPrewarmCategory =
  | 'views'
  | 'world'
  | 'sky'
  | 'props'
  | 'entities'
  | 'objects'
  | 'vfx'
  | 'post'
  | 'diagnostics';

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

interface AoeRingSlot {
  ring: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  radius: number; // blast radius in yards this flash represents
  elapsed: number; // seconds since spawn; >= AOE_RING_LIFETIME means free
}

function selfSnapshotAlpha(alpha: number, lead: number): number {
  return Math.min(1.25, alpha + Math.max(0, lead));
}

export interface EntityView {
  group: THREE.Group;
  /** rigged glTF visual for characters; null for object views (doors/crates) */
  visual: CharacterVisual | null;
  visualKey: string | null;
  visualPoolKey: string | null;
  sheepVisual: CharacterVisual | null; // polymorph form, built lazily
  bearVisual: CharacterVisual | null; // druid bear form, built lazily
  catVisual: CharacterVisual | null; // druid cat form, built lazily
  travelVisual: CharacterVisual | null; // druid travel form (chicken-cow), built lazily
  fireballTravelVisual: FireballTravelVisual | null; // Mage travel form, built lazily
  iceBlockVisual: IceBlockVisual | null; // Ice Block shell, built lazily on first stasis
  temporalHourglassVisual: TemporalHourglassVisual | null;
  frostNovaRootVisual: FrostNovaRootVisual | null; // Atadura de Hielo restraint at the feet
  mageBarrierVisual: MageBarrierVisual | null; // personal mage absorb shell, built lazily
  skin: number; // last-rendered appearance skin — diffed each frame for live swaps
  mainhandItemId: string | null; // last-rendered equipped weapon — diffed for live held-weapon swaps
  offhandItemId: string | null; // last-rendered shield/second weapon, independent of mainhand skins
  weaponSkinId: string | null; // last-rendered weapon-skin cosmetic, diffed for live skin swaps
  weaponStowed: boolean; // last-rendered sheathe state (Z key), diffed for live stow toggles
  /** unscaled height — nameplate/vfx anchor reads height * e.scale */
  height: number;
  /** last-applied entity scale (group.scale); diffed each frame for live size buffs */
  liveScale: number;
  /** what removeView pulls back out of clickTargets */
  clickTarget: THREE.Object3D;
  nameplate: HTMLDivElement;
  nameEl: HTMLDivElement;
  titleEl: HTMLDivElement; // Book of Deeds title subtitle (players only)
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
  /** Bitset of the last-applied combat-state classes, for per-frame write elision. */
  nameplateStateMask: number;
  /** Last-applied friendly-pet class, diffed separately from the combat-state bitset. */
  nameplateFriendlyPet: boolean;
  nameplateHpWidth: string;
  titleSig: string; // cheap-diff for the deed-title subtitle (lang|deed id)
  comboSig: string; // cheap-diff for the combo pip row
  tierEl: HTMLImageElement; // $WOC holder-tier flair badge (other players)
  tierValue: number; // last-applied holderTier, to diff cheaply
  devTierEl: HTMLImageElement; // developer-badge flair badge (other players)
  devTierValue: number; // last-applied devTier, to diff cheaply
  discordEl: HTMLImageElement; // linked-Discord PFP next to the name (other players)
  discordAvatarSig: string; // last-applied discord avatar URL, to diff cheaply
  aiEl: HTMLSpanElement; // operator-set [AI] account tag, inline before the name
  levelEl: HTMLSpanElement; // mob level badge (e.g. "[5]"), inline before the name; hidden for non-mobs
  levelSig: string; // cheap-diff for the level badge (levelText|color)
  sparkle?: THREE.Sprite; // ground objects
  objectMesh?: THREE.Object3D;
  objectPoolKey: string | null;
  /** templateId the object mesh was built from. The sim swaps delve interactable
   *  templates in place (plate -> triggered, rope -> pulled); diffing this each
   *  frame drops the stale view so it rebuilds with the new mesh. */
  builtTemplateId?: string;
  portal?: THREE.Mesh; // dungeon door swirl
  objectCasters: THREE.Object3D[]; // object-view shadow meshes, distance-gated
  viewLights: THREE.PointLight[]; // point lights this view contributes to the budget
  shadowOn: boolean;
  isFar: boolean;
  // hidden until its shader programs finish linking off-thread (async-compile gate)
  compilePending: boolean;
  lastOverheadEmoteKey: string | null;
  recklessOn?: boolean;
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
  // consecutive frames the foot-height heuristic read airborne (debounce)
  airborneHeurFrames: number;
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
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function localRenderDiagnosticsEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof location === 'undefined') return false;
  if (!loopbackHostname(location.hostname)) return false;
  const params = new URLSearchParams(location.search);
  return (
    params.get('perfTrace') === '1' ||
    params.get('perf_trace') === '1' ||
    params.get('renderTrace') === '1'
  );
}

function setRenderCategory(obj: THREE.Object3D, category: RenderDiagnosticsCategory): void {
  obj.userData.renderCategory = category;
}

function isPersistentPortalObject(e: Entity): boolean {
  return (
    e.kind === 'object' && (e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}

export class Renderer {
  scene = new THREE.Scene();
  // A soft light pillar marking the local player's corpse during the ghost run.
  // Built lazily on first death, then just repositioned/toggled (no per-frame alloc).
  private corpseBeacon: THREE.Mesh | null = null;
  camera: THREE.PerspectiveCamera;
  webgl: THREE.WebGLRenderer;
  views = new Map<number, EntityView>();
  private viewCreateRetry = new ViewCreateRetryGate(VIEW_CREATE_FAIL_RETRY_MS);
  // view groups that own a budgeted point light: exempt from the hidden-view
  // matrix gate (see the gate pass in sync and the note at registration)
  private lightOwnerGroups = new WeakSet<THREE.Object3D>();
  nameplateLayer: HTMLDivElement;
  // Travel-form speed-illusion overlay (presentation only; see travel_speed_fx*).
  private travelSpeedFx: TravelSpeedFxPainter;
  private nameplatePainter: NameplatePainter;
  // Last local-player XZ, to derive ground speed for the speed cue (yd/s).
  private lastLocalPos: { x: number; z: number } | null = null;
  // Cached prefers-reduced-motion query. `.matches` stays live as the OS setting
  // changes, so we read it per frame without re-allocating a MediaQueryList
  // (matchMedia allocates a new object on every call) in the render hot path.
  private reduceMotionMql: MediaQueryList | null =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  selectionRing: THREE.Group;
  selectionRingMesh: THREE.Mesh;
  selectionRingTicks: THREE.Group;
  selectionRingMat: THREE.MeshBasicMaterial;
  // center-relative XZ of every base-ring vertex (cached) + scratch draped Y,
  // so sync() can re-drape the ring over the terrain without allocating.
  selectionRingLocalXZ: Float32Array;
  selectionRingDrapeY: Float32Array;
  // last drape anchor: the drape is a pure function of (x, z, scale), so a
  // stationary target skips the per-vertex groundHeight resample entirely.
  private selRingX = Number.NaN;
  private selRingZ = Number.NaN;
  private selRingScale = Number.NaN;
  // Dev-only Tab-target cone overlay (enabled via ?targetcone=1 in main.ts).
  // Null until enabled; once built it is re-draped over the terrain in front of
  // the local player every frame. See target_cone_debug.ts.
  private targetCone: {
    group: THREE.Group;
    pos: THREE.BufferAttribute;
    localXZ: Float32Array;
    worldXYZ: Float32Array;
    // Full query-radius rim (40 yd): the absolute Tab range. Symmetric, so it is
    // draped with facing 0.
    ringPos: THREE.BufferAttribute;
    ringXZ: Float32Array;
    ringWorldXYZ: Float32Array;
  } | null = null;
  // Pool of transient click-feedback markers (ring plus crossed "X"). Each slot is
  // a group reused round-robin, so rapid clicking never allocates. A slot with
  // `elapsed >= lifetime` is free. See click_marker.ts for the animation curves.
  private clickMarkers: ClickMarkerSlot[] = [];
  private clickMarkerNext = 0;
  // ground-targeted AoE impact rings (see aoe_ring.ts), pooled like click markers
  private aoeRings: AoeRingSlot[] = [];
  // Water Jet's visual channel starts from a spellfx event, which can precede
  // the next online entity snapshot by one network frame. Hold this tiny local
  // bridge so the elemental enters Channel immediately instead of flashing its
  // short Waterbolt attack before `castingAbility` arrives.
  private waterJetVisualChannels = new Map<number, number>();
  private aoeRingNext = 0;
  private recklessSkulls = new RecklessSkullPainter();
  private groundAimReticle: GroundAimReticleVisual;
  raycaster = new THREE.Raycaster();
  clickTargets: THREE.Object3D[] = [];
  // Gather-node meshes (#1866), raycast separately from `clickTargets`/`pick()`:
  // nodes are static content keyed by string id, not entities keyed by numeric
  // id, so they get their own list and `pickGatherNode` instead of widening
  // `pick()`'s numeric-id contract.
  gatherNodeMeshes: THREE.Object3D[] = [];
  camYaw = Math.PI;
  camPitch = 0.32;
  camDist = 12;
  // Map-editor 3D mode: when set, the camera uses this free-cam pose instead of
  // chasing the player (updateCamera honors it and returns early). Editor-only;
  // always null in the shipped game.
  editorCam: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  // Smoothed chase-cam occlusion (1 = no pull-in); see updateCamera.
  private camOcclusion: CameraOcclusionState = { pullT: 1, lensT: 1, fov: CAMERA_BASE_FOV };
  showNameplates = true;
  // settings-backed developer-badge display toggle (nameplate glyph + outline);
  // initialized from Settings and kept live by main.ts's applySetting dispatcher.
  showDevBadges = true;
  // settings-backed self-nameplate toggle (off by default): when on, your own
  // overhead nameplate renders exactly as other players see it. Initialized from
  // Settings and kept live by main.ts's applySetting dispatcher (mirrors showDevBadges).
  showOwnNameplate = false;
  // settings-menu graphics knobs (applied live)
  private renderScale = 1; // user-requested resolution ceiling on top of the device pixel ratio
  private effectiveRenderScale = 1; // runtime value after adaptive backoff
  private frameMsEma = 16.7;
  private adaptiveGrace = 2.0;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: write-only render-budget restore state (pre-existing); read path not yet wired.
  private adaptiveCooldown = 0;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: write-only render-budget restore state (pre-existing); read path not yet wired.
  private stableFrameTime = 0;
  private viewCreateBackoff = 0;
  private renderBudgetGovernor!: RenderBudgetGovernor;
  private baseExposure = 1.12; // tone-mapping exposure at brightness 1.0
  private tmpV = new THREE.Vector3();
  private viewCandidates: ViewCandidate[] = [];
  // Persistent scratch for the sloppy-pick column build. pick() is also the
  // per-frame hover-cursor path (updateHoverCursor in main.ts), so a fresh array
  // here would be per-frame garbage on every cursor-over-empty-ground frame.
  // Reused like viewCandidates: cleared with .length = 0, grown in place.
  private sloppyCandidates: SloppyPickCandidate[] = [];
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();
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
  // Scratch AnimState reused across the per-entity sync loop: CharacterVisual
  // .update() and the pose-selection helpers only read it within the call (the
  // preview drives a shared constant too), so one buffer avoids allocating a
  // fresh state object per entity per frame, reducing GC churn that scales with crowd.
  private readonly animScratch: AnimState = {
    speed: 0,
    moving: false,
    running: false,
    airborne: false,
    backwards: false,
    reverseBackpedal: false,
    dead: false,
    casting: false,
    spinning: false,
    swimming: false,
    sitting: false,
  };
  private selfRenderPosition = new THREE.Vector3();
  private selfRenderPositionReady = false;
  // Online display-only self extrapolation (see src/render/self_motion.ts).
  // Lazy: offline never passes a SelfMotionFrame, so it is never constructed.
  private selfMotionPredictor: SelfMotionPredictor | null = null;
  private selfMotionActive = false;
  private selfMotionOffset = new THREE.Vector3();

  /** Perf-overlay telemetry: ms of latency the self-motion extrapolation is
   *  currently hiding, or null while the predictor is inactive. */
  get selfMotionLeadMs(): number | null {
    return this.selfMotionActive && this.selfMotionPredictor
      ? this.selfMotionPredictor.leadMs
      : null;
  }

  private lastSelfId: number | null = null;
  // Last yaw applied to the local player while the camera was driving its facing
  // (mouselook / mouse-camera). Null when the override is disengaged, so the next
  // engage re-seeds from the live interpolated facing instead of snapping. See
  // facing_smooth.ts for why the camera-driven yaw must be rate-limited.
  private selfFacingOverride: number | null = null;
  // Camera yaw applied on the previous camera-driven frame. advanceSelfFacing
  // subtracts it to tell the camera's ongoing rotation (applied 1:1) apart from
  // the residual engage gap (rate-limited), so a fast flick never lags. Null
  // while disengaged so the next engage re-seeds cleanly.
  private selfFacingLastTarget: number | null = null;
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
  // Map-editor placed GLB assets; null when the world has none and the editor
  // never asked for the view (the shipped game with the built-in world).
  private placedAssetsView: PlacedAssetsView | null = null;
  private foliage: FoliageView;
  private fish: FishView;
  private critters: CritterField;
  private motes: MotesView;
  private birds: BirdsView;
  private impactSite: ImpactSiteView;
  private fogScratch = new THREE.Color();
  private flames: THREE.Mesh[];
  private fireLights: THREE.PointLight[];
  // Point lights owned by entity views (e.g. the quest-object glow). These stream
  // in/out with interest, so they are budgeted into the SAME constant count as the
  // static fire lights - otherwise numPointLights toggles as a lit object enters or
  // leaves view and every lit material recompiles (an open-world travel hitch).
  private viewLights: THREE.PointLight[] = [];
  private lightRankDirty = true; // viewLights set changed: rebuild the budget rank
  private effectivePointLights = 0;
  private propsView!: {
    update(
      camX: number,
      camY: number,
      camZ: number,
      eyeX: number,
      eyeY: number,
      eyeZ: number,
      fogFar: number,
    ): void;
  };
  private lightRank: RankedPointLight[] = [];
  private doomedIds: number[] = [];
  private dungeons: DungeonInteriors | null = null;
  private envRTs = new Map<BiomeId, THREE.WebGLRenderTarget>();
  private envBiome: BiomeId = 'vale';
  private envOutdoorIntensity = ENV_INTENSITY;
  private time = 0;
  private frameIdx = 0;
  // Visible non-self character rigs last frame, feeding the crowd-adaptive LOD.
  private lastVisibleRigCount = 0;
  // KHR_parallel_shader_compile present: lets us link new programs off-thread and
  // gate a freshly-streamed view's draw on readiness instead of stalling the frame.
  private asyncCompileSupported = false;
  vfx: Vfx;
  private lightPulses: LightPulses;
  // Flash a pooled talent-moment point light at an entity's feet (see
  // light_pulses.ts); bound once in the constructor over the views map.
  private pulseAt: (id: number, school: string, intensity: number, duration: number) => void;
  private frozenOrbFx!: FrozenOrbFx;
  private mageGroundFx!: MageGroundFx;
  private ringOfFrostVisuals!: RingOfFrostVisuals;
  private temporalHourglassGroundVisuals!: TemporalHourglassGroundVisuals;
  private readonly mageBarrierStateScratch: MageBarrierState = { theme: 'frost', value: 0 };
  private glacialFrontVisual!: GlacialFrontVisual;
  private weather: Weather;
  private weatherOn = true;
  private audioSink: SpatialAudioSink | null = null;
  private readonly ambientPointSources: readonly AmbientPointSource[];

  // 2v2 Fiesta juice: trauma-based screen shake (decays each frame) and the
  // hazard-ring wall (built lazily the first time a Fiesta bout asks for it).
  private shakeTrauma = 0;
  private shakeElapsed = 0;
  private fiestaRing: THREE.Mesh | null = null;
  private fiestaPowerupMeshes = new Map<number, THREE.Mesh>();
  // Per-entity power-up glow: emits a coloured swirl around the carrier until it expires.
  private fiestaGlows = new Map<number, { color: number; until: number; nextSwirl: number }>();
  // Per-target heal-glow throttle (ms since a target last bloomed a heal glow). A
  // burst of many tiny simultaneous heals on one ally (e.g. Chronomancy's group echo
  // converting one AoE cast that struck several enemies, five allies x N hits in a
  // single frame) must not spawn a full particle bloom per heal, or the particle
  // count spikes and the frame hitches. One bloom per target per HEAL_GLOW_ICD is
  // plenty of feedback; the FCT numbers are unaffected.
  private healGlowAt = new Map<number, number>();

  // Vale Cup: the Sowfield set piece, the staggered goal-firework volley queue,
  // and the boarball's dust pool (created lazily the first time the ball rolls).
  private valeCupStadium: ValeCupStadiumView;
  // Futuristic-fantasy skybox for the private practice pitch (a random variant
  // per bout, camera-centred, only shown while the local player is practicing).
  private valeCupSky = new ValeCupPracticeSky();
  private valeCupTeamRings: ValeCupTeamRingsView;
  private vcupFireworks: { at: number; x: number; z: number; colors: readonly number[] }[] = [];
  private valeCupBallDust: ValeCupBallDust | null = null;
  private valeCupBallTrail: ValeCupBallTrail | null = null;
  // seed-bound ground sampler, built once so the per-frame Vale Cup ring update
  // allocates no closure (see the drape path in vale_cup_team_ring.ts).
  private groundSample = (x: number, z: number): number => groundHeight(x, z, this.sim.cfg.seed);

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

  constructor(
    private sim: IWorld,
    canvas: HTMLCanvasElement,
    nameplateLayer: HTMLDivElement,
  ) {
    this.nameplateLayer = nameplateLayer;
    this.travelSpeedFx = new TravelSpeedFxPainter(nameplateLayer);
    // The scene root sits at identity forever, but with the default
    // matrixAutoUpdate the root recomposes each frame, which flags
    // matrixWorldNeedsUpdate and FORCE-cascades a matrixWorld multiply through
    // every node in the graph (three r165 updateMatrixWorld), defeating both
    // the static-subtree freeze and the hidden-rig gate below. Freeze the root:
    // children with auto-update still recompose themselves normally.
    this.scene.updateMatrix();
    this.scene.matrixAutoUpdate = false;
    this.ambientPointSources = buildWorldAmbientSources(this.sim.cfg.seed);
    // No default-framebuffer MSAA on any tier: high/ultra get AA from the
    // composer's MSAA HalfFloat target, low is meant to run without AA — and
    // requesting it here would hit software GL (the autodetect can only run
    // after the context exists) with the most expensive setting there is.
    this.webgl = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    // Release this context promptly on page teardown so repeated logout/login
    // reloads (location.reload) don't exhaust the browser's WebGL context pool.
    trackWebGLContext(this.webgl);
    this.captureGlIdentity();
    canvas.addEventListener('webglcontextlost', () => {
      this.contextLostCount++;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextRestoredCount++;
      this.captureGlIdentity();
    });
    initGfxTier(this.webgl); // software-GL autodetect needs the live context
    // The lightweight material path does not preload HDR sky/water assets.
    // Keep the renderer's HDR/IBL branch aligned with that preload decision.
    this.lowGfx = !GFX.standardMaterials;
    this.renderBudgetGovernor = new RenderBudgetGovernor({
      tier: GFX.tier,
      budget: GFX.budget,
      enabled: GFX.autoGovernor,
    });
    this.renderBudgetGovernor.reset(
      this.effectiveRenderScale,
      this.renderBudgetMinScale(),
      this.renderBudgetMaxScale(),
    );
    const LOW_GFX = this.lowGfx;
    this.viewport = this.measureViewport();
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, GFX.pixelRatioCap));
    this.webgl.setSize(this.viewport.width, this.viewport.height, false);
    this.webgl.shadowMap.enabled = !LOW_GFX;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping; // OutputPass reads this on the composer path
    this.webgl.toneMappingExposure = this.baseExposure;
    // Only worth gating view draws on compileAsync when programs can link OFF the
    // main thread; without the extension compileAsync compiles synchronously, so
    // gating would just delay the same stall. Detected once here.
    try {
      this.asyncCompileSupported =
        typeof this.webgl.compileAsync === 'function' &&
        this.webgl.getContext().getExtension('KHR_parallel_shader_compile') !== null;
    } catch {
      this.asyncCompileSupported = false;
    }
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_BASE_FOV,
      this.viewport.width / this.viewport.height,
      0.1,
      950,
    );
    // Nameplate Three/DOM ownership lives in the painter; it reads the
    // viewport / mob-nameplate toggle lazily (the renderer reassigns viewport on
    // resize) and borrows the renderer's PvP reaction check.
    this.nameplatePainter = new NameplatePainter({
      views: this.views,
      camera: this.camera,
      world: this.sim,
      getViewport: () => this.viewport,
      showNameplates: () => this.showNameplates,
      showDevBadges: () => this.showDevBadges,
      showOwnNameplate: () => this.showOwnNameplate,
      isHostilePlayer: (e) => this.isHostilePlayer(e),
    });

    this.scene.fog = new THREE.Fog(
      LOW_GFX ? 0xb6cddd : 0xa6c6e0,
      LOW_GFX ? 150 : 130,
      LOW_GFX ? 520 : 470,
    );

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
      // Memory-ceiling profile (phone WebKit): prefiltering all three biome envs here adds
      // three mip-chained HalfFloat cubemaps to the world-entry allocation spike, the moment
      // iOS WebKit is most likely to kill the WebContent process. Build only the default
      // ('vale') env synchronously and stagger the rest onto idle timers: the biome-crossing
      // swap below already guards on envRTs.has(dominant), so until a deferred env lands the
      // scene just keeps the current one (a brief, cosmetic-only ambient mismatch).
      // Constrained: build only the player's INITIAL dominant biome env
      // synchronously (a returning character can spawn in Marsh or Peaks, not
      // just Vale), then defer the other two. Prefiltering the wrong biome left a
      // Marsh/Peaks starter with Vale IBL and sun rotation until a timer fired.
      const allBiomes: BiomeId[] = ['vale', 'marsh', 'peaks'];
      let entryBiomes: BiomeId[] = allBiomes;
      if (GFX.constrainedMemory) {
        const blend = this.skyView.biomeAt(this.sim.player.pos.z);
        const initial = blend.t < 0.5 ? blend.from : blend.to;
        const initialEnv: BiomeId = allBiomes.includes(initial as BiomeId)
          ? (initial as BiomeId)
          : 'vale';
        entryBiomes = [initialEnv];
        this.envBiome = initialEnv;
      }
      for (const b of entryBiomes) {
        const eq = this.skyView.envTexture(b);
        if (eq) this.envRTs.set(b, pmrem.fromEquirectangular(eq));
      }
      if (GFX.constrainedMemory) {
        const deferred: BiomeId[] = allBiomes.filter((b) => !entryBiomes.includes(b));
        deferred.forEach((b, i) => {
          window.setTimeout(
            () => {
              // The timer can outlive the context (editor viewport rebuilds, page
              // teardown force-loses tracked contexts): a lost context makes the
              // prefilter throw and leak, so just skip it.
              if (this.webgl.getContext().isContextLost()) return;
              if (this.envRTs.has(b)) return;
              const eq = this.skyView.envTexture(b);
              if (!eq) return;
              // Dev-channel diagnostic: this build is a transient GPU spike; if a
              // process kill correlates with this line on a device, this is the
              // allocation to chase.
              console.info(`[entry-guard] deferred env prefilter: ${b}`);
              const latePmrem = new THREE.PMREMGenerator(this.webgl);
              this.envRTs.set(b, latePmrem.fromEquirectangular(eq));
              latePmrem.dispose();
            },
            DEFERRED_ENV_PREFILTER_MS + i * DEFERRED_ENV_PREFILTER_STAGGER_MS,
          );
        });
      }
      if (this.envRTs.size > 0) {
        // Seed from the biome actually built at entry (the player's initial one on
        // constrained devices, else 'vale'), so IBL and sun rotation match the dome
        // from the first frame instead of only after a deferred prefilter lands.
        const seedBiome: BiomeId = this.envRTs.has(this.envBiome) ? this.envBiome : entryBiomes[0];
        this.envOutdoorIntensity = ENV_INTENSITY * IBL_RAW_SCALE;
        this.scene.environment = this.envRTs.get(seedBiome)?.texture ?? null;
        this.scene.environmentRotation.y = this.skyView.envRotationY(seedBiome);
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
    const sun = new THREE.DirectionalLight(
      LOW_GFX ? 0xfff0d0 : 0xffedd0,
      LOW_GFX ? 2.65 : SUN_INTENSITY,
    );
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
    for (const [tex, scale] of [
      [sunCanvas(true), 60],
      [sunCanvas(false), 190],
    ] as const) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          fog: false,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
          // bloom supplies the big halo on the composer path; the painted one
          // would double up and wash out the sky
          opacity: scale === 190 && !LOW_GFX ? SUN_HALO_OPACITY : 1,
        }),
      );
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
        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: shaftTex,
            transparent: true,
            opacity: 0,
            fog: false,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            rotation: 0.42 + i * 0.13,
          }),
        );
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

    // A returning character can log out anywhere in a zone, not only at a
    // hub, so the far streaming queue is ordered by distance to the actual
    // entry position (entity_roster.ts: this.sim.player.pos.x/z) rather than
    // whatever row-major order the chunk grid happens to walk.
    this.terrainView = buildTerrain(this.sim.cfg.seed, {
      x: this.sim.player.pos.x,
      z: this.sim.player.pos.z,
    });
    setRenderCategory(this.terrainView.group, 'terrain');
    this.scene.add(this.terrainView.group);
    // Terrain chunks never move after build (the LOD update only toggles
    // visibility): stop their per-frame matrix recompose (static_matrix.ts).
    freezeStaticMatrices(this.terrainView.group);
    this.waterView = buildWater(this.sim.cfg.seed);
    for (const mesh of this.waterView.meshes) {
      setRenderCategory(mesh, 'water');
      this.scene.add(mesh);
      freezeStaticMatrices(mesh); // water animates via uniforms, never transforms
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
    this.scene.add(this.impactSite.light);
    const props = buildProps(this.sim.cfg.seed, (delveId) =>
      tEntity({ kind: 'delve', id: delveId, field: 'name' }),
    );
    setRenderCategory(props.group, 'props');
    this.scene.add(props.group);
    this.flames = props.flames;
    this.fireLights = props.fireLights;
    // Props are baked into world space at build and their update() only toggles
    // visibility, so the whole tree is matrix-static, EXCEPT the campfire
    // flames, whose flicker rescales them every frame: re-enable those.
    freezeStaticMatrices(props.group);
    for (const flame of this.flames) flame.matrixAutoUpdate = true;
    // The impact-site light rides the campfire point-light budget so the visible
    // point-light count stays constant as the player travels (constant
    // numPointLights -> materials never recompile for a light-count change).
    this.fireLights.push(this.impactSite.light);
    // The Sowfield (Vale Cup stadium): same landmark pattern. Brazier lights ride
    // the fireLights budget (never the cull-toggled group) and its flames join the
    // campfire flicker + ember pass.
    this.valeCupStadium = buildValeCupStadium(this.sim.cfg.seed);
    this.scene.add(this.valeCupStadium.group);
    // The private practice-pitch copy (shown at a far instance origin when the
    // local player is practicing; positioned/toggled by valeCupStadium.update).
    this.scene.add(this.valeCupStadium.practiceGroup);
    // The practice skybox (camera-centred; shown only while practicing, driven
    // in updateAmbience). Category 'sky' so the FX governor treats it like the dome.
    setRenderCategory(this.valeCupSky.mesh, 'sky');
    this.scene.add(this.valeCupSky.mesh);
    for (const light of this.valeCupStadium.lights) {
      this.scene.add(light);
      this.fireLights.push(light);
    }
    this.flames.push(...this.valeCupStadium.flames);
    // Team glow rings under live match fighters (ally/enemy/self readability).
    this.valeCupTeamRings = buildValeCupTeamRings();
    this.scene.add(this.valeCupTeamRings.group);
    this.propsView = props;

    // Map-editor play-test: freely placed GLB models (cosmetic, render-only). Loads
    // async and pops in; absent for the built-in world. The view supports live
    // editing (add/move/remove/reSeat), reached through the editor-only
    // `placedAssets` getter below; the shipped game only ever builds it here.
    const placements = this.sim.cfg.world?.placements;
    if (placements && placements.length > 0) {
      this.placedAssetsView = new PlacedAssetsView(placements, this.sim.cfg.seed);
      setRenderCategory(this.placedAssetsView.group, 'props');
      this.scene.add(this.placedAssetsView.group);
    }

    const jailScene = buildJailScene(this.sim.cfg.seed);
    setRenderCategory(jailScene, 'props');
    this.scene.add(jailScene);

    const gatherNodes = buildGatherNodes(this.sim.cfg.seed);
    setRenderCategory(gatherNodes.group, 'props');
    this.scene.add(gatherNodes.group);
    // Baked into world space at build with no per-frame update(), same as props.
    freezeStaticMatrices(gatherNodes.group);
    this.gatherNodeMeshes = gatherNodes.group.children;

    const artisanRow = buildArtisanRowProps(this.sim.cfg.seed);
    setRenderCategory(artisanRow.group, 'props');
    this.scene.add(artisanRow.group);
    freezeStaticMatrices(artisanRow.group);

    // Crafting-station scenery (Professions 2.0): static, except the kitchens
    // fire, whose flame + light join the campfire flicker/ember pass above.
    const stationProps = buildStationProps(this.sim.cfg.seed);
    setRenderCategory(stationProps.group, 'props');
    this.scene.add(stationProps.group);
    freezeStaticMatrices(stationProps.group);
    for (const flame of stationProps.flames) flame.matrixAutoUpdate = true;
    this.flames.push(...stationProps.flames);
    this.fireLights.push(...stationProps.fireLights);

    // selection ring — a classic target reticle: a base ring plus four
    // inward-pointing ticks. The base ring is draped over the terrain each
    // frame (see drapeRingLocalY / sync) so it stays legible on slopes instead
    // of sinking into the uphill ground; the ticks keep the classic spin on a
    // separate pivot. The ring is radially symmetric, so only the ticks read spin.
    const ringGeo = new THREE.RingGeometry(0.9, 1.15, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xd4af37,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
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
    tickGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          0.72,
          0,
          0, // inner tip (points toward the unit)
          1.2,
          0,
          0.16, // outer corners
          1.2,
          0,
          -0.16,
        ],
        3,
      ),
    );
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
      const ringMat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      const ring = new THREE.Mesh(cmRingGeo, ringMat);
      const crossMat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
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
      this.clickMarkers.push({
        group,
        ring,
        cross,
        ringMat,
        crossMat,
        elapsed: CLICK_MARKER_LIFETIME,
      });
    }

    // AoE impact rings: a unit ring scaled to each blast's radius, flashed on
    // the terrain where a ground-targeted spell lands (see aoe_ring.ts).
    const aoeRingGeo = new THREE.RingGeometry(0.88, 1.0, 64);
    aoeRingGeo.rotateX(-Math.PI / 2);
    this.groundAimReticle = new GroundAimReticleVisual(
      this.scene,
      (x, z) => groundHeight(x, z, this.sim.cfg.seed),
      this.lowGfx ? 1 : SELECTION_RING_BOOST,
    );
    setRenderCategory(this.groundAimReticle.group, 'ui3d');
    for (let i = 0; i < CLICK_MARKER_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      const ring = new THREE.Mesh(aoeRingGeo, mat);
      ring.visible = false;
      ring.renderOrder = 3; // over terrain decals, like the click marker
      setRenderCategory(ring, 'ui3d');
      this.scene.add(ring);
      this.aoeRings.push({ ring, mat, radius: 1, elapsed: AOE_RING_LIFETIME });
    }

    // particle system: projectiles, impacts, heal glows, ambience
    this.lightPulses = new LightPulses(this.scene);
    // Frozen Orb: the roaming ice-sphere visual, animated locally from the one
    // 'orb' release event (see src/render/frozen_orb_fx.ts).
    this.frozenOrbFx = new FrozenOrbFx(this.scene, (x, z) => groundHeight(x, z, this.sim.cfg.seed));
    this.glacialFrontVisual = new GlacialFrontVisual(this.scene, (x, z) =>
      groundHeight(x, z, this.sim.cfg.seed),
    );
    // Meteor falls + Rune of Power circles (see src/render/mage_ground_fx.ts);
    // a landing meteor detonates with the same burst an aimed blast uses.
    this.mageGroundFx = new MageGroundFx(
      this.scene,
      (x, z) => groundHeight(x, z, this.sim.cfg.seed),
      (x, z) => {
        const gy = groundHeight(x, z, this.sim.cfg.seed);
        this.vfx.burst(new THREE.Vector3(x, gy + 0.4, z), 'fire', 34, 1.4);
      },
    );
    this.ringOfFrostVisuals = new RingOfFrostVisuals(this.scene, (x, z) =>
      groundHeight(x, z, this.sim.cfg.seed),
    );
    this.temporalHourglassGroundVisuals = new TemporalHourglassGroundVisuals(this.scene, (x, z) =>
      groundHeight(x, z, this.sim.cfg.seed),
    );
    this.vfx = new Vfx(this.scene, (id, frac) => {
      const v = this.views.get(id);
      if (!v) return null;
      const e = this.sim.entities.get(id);
      const h = v.height * (e?.scale ?? 1) * frac;
      return new THREE.Vector3(v.group.position.x, v.group.position.y + h, v.group.position.z);
    });
    this.vfx.setViewportScale(this.webgl.domElement.clientHeight * this.webgl.getPixelRatio(), 60);
    this.pulseAt = (id, school, intensity, duration) => {
      const v = this.views.get(id);
      if (!v) return;
      this.lightPulses.pulse(v.group.position, school, intensity, duration);
    };

    // ambient precipitation: biome-driven snow/rain that rides with the camera
    this.weather = new Weather(this.scene, this.lowGfx);

    // post chain (bloom + grade, GTAO on ultra); low renders direct
    if (GFX.composer)
      this.post = buildComposer(
        this.webgl,
        this.scene,
        this.camera,
        this.viewport.width,
        this.viewport.height,
      );

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
    const stableMobileGameViewport =
      document.body.classList.contains('game-active') &&
      document.body.classList.contains('mobile-touch');
    const vv = stableMobileGameViewport ? null : window.visualViewport;
    const width = Math.round(
      stableMobileGameViewport
        ? rect.width || window.innerWidth
        : (vv?.width ?? (rect.width || window.innerWidth)),
    );
    const height = Math.round(
      stableMobileGameViewport
        ? rect.height || window.innerHeight
        : (vv?.height ?? (rect.height || window.innerHeight)),
    );
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }

  private captureGlIdentity(): void {
    try {
      const gl = this.webgl.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.glVendor = String(
        dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      );
      this.glRenderer = String(
        dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      );
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
    const devicePxHeight = this.webgl.domElement.clientHeight * this.webgl.getPixelRatio();
    this.vfx.setViewportScale(devicePxHeight, 60);
    // Weapon-skin VFX point sprites size against the device-pixel height too:
    // future rigs read the module value, live rigs re-scale in place.
    setWeaponVfxViewportHeight(devicePxHeight);
    for (const v of this.views.values()) v.visual?.setWeaponVfxPixelScale(devicePxHeight);
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
    return footstepSurfaceAt(this.sim.cfg.seed, x, y, z, this.weatherOn);
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
    this.applyRenderBudgetState(
      this.renderBudgetGovernor.reset(
        this.effectiveRenderScale,
        this.renderBudgetMinScale(),
        this.renderBudgetMaxScale(),
      ),
    );
    this.applyResolution();
  }

  private isMobileRuntime(): boolean {
    return document.body.classList.contains('mobile-touch');
  }

  private initialEffectiveRenderScale(scale: number): number {
    const forcedTier = urlForcedTier();
    if (this.isMobileRuntime() && forcedTier !== 'high' && forcedTier !== 'ultra')
      return Math.min(scale, 0.85);
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
      ? Object.entries(state.levels).some(
          ([key, value]) =>
            Math.abs(value - previousLevels[key as keyof RenderBudgetState['levels']]) >= 0.001,
        )
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
    this.effectiveRenderScale = Math.min(
      this.renderBudgetMaxScale(),
      Math.max(this.renderBudgetMinScale(), state.levels.resolution),
    );
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
    if (samples.length > RENDERER_PHASE_SAMPLE_LIMIT)
      samples.splice(0, samples.length - RENDERER_PHASE_SAMPLE_LIMIT);
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

  private drawCountFor(
    material: THREE.Material | THREE.Material[] | undefined,
    geometry?: THREE.BufferGeometry,
  ): number {
    if (!material) return 1;
    if (Array.isArray(material)) return Math.max(1, geometry?.groups.length || material.length);
    return Math.max(
      1,
      geometry?.groups.length && geometry.groups.length > 0 ? geometry.groups.length : 1,
    );
  }

  private triangleCountFor(geometry?: THREE.BufferGeometry): number {
    if (!geometry) return 0;
    const drawCount = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
    return Math.max(0, Math.floor(drawCount / 3));
  }

  private objectDiagnosticLabel(
    obj: THREE.Object3D,
    category: string,
    materialLabels: string[],
  ): string {
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
    const visit = (
      obj: THREE.Object3D,
      inheritedCategory: string,
      inheritedVisible: boolean,
    ): void => {
      const visible = inheritedVisible && obj.visible;
      const category =
        typeof obj.userData.renderCategory === 'string'
          ? (obj.userData.renderCategory as string)
          : inheritedCategory;
      if (visible) {
        const renderable = obj as RenderableDiagnosticObject;
        const hasMesh = Boolean(
          renderable.isMesh || renderable.isInstancedMesh || renderable.isSkinnedMesh,
        );
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
            const instanceCount = renderable.isInstancedMesh
              ? Math.max(0, renderable.count ?? 0)
              : 1;
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
            if (firstVisibleObjects.length < 16)
              firstVisibleObjects.push(this.objectDiagnosticLabel(obj, category, labels));
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
      if (win.requestIdleCallback)
        win.requestIdleCallback(run, { timeout: RENDER_DIAGNOSTICS_IDLE_TIMEOUT_MS });
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

  private collectMissingViewCandidates(
    center: Entity,
    rangeSq: number,
    includeRequired: boolean,
  ): void {
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
      if (!this.viewCreateRetry.canAttempt(e.id, 'view', performance.now())) continue;
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

  private createCandidateViews(
    limit: number,
    createdViewTypes: string[],
    deadlineMs = Infinity,
  ): number {
    const max = Math.max(0, Math.floor(limit));
    let created = 0;
    for (const candidate of this.viewCandidates) {
      if (created >= max || performance.now() >= deadlineMs) break;
      if (this.views.has(candidate.e.id)) continue;
      // a recent failed build (assets unavailable) sits out its cooldown so it
      // cannot burn a budget slot every frame
      if (!this.viewCreateRetry.canAttempt(candidate.e.id, 'view', performance.now())) continue;
      this.createView(candidate.e);
      this.sampleCreatedViewType(createdViewTypes, candidate.e);
      created++;
    }
    return created;
  }

  private createCharacterVisualWithRetry(
    e: Entity,
    slot: string,
    formKey?: 'form_sheep' | 'form_bear' | 'form_cat' | 'form_travel',
  ): CharacterVisual | null {
    const now = performance.now();
    if (!this.viewCreateRetry.canAttempt(e.id, slot, now)) return null;
    const visual = createCharacterVisual(e, formKey);
    if (visual) this.viewCreateRetry.markSucceeded(e.id, slot);
    else this.viewCreateRetry.markFailed(e.id, slot, now);
    return visual;
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
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      this.cameraLookAt.x,
      this.cameraLookAt.y,
      this.cameraLookAt.z,
      fogFar,
    );
    this.foliage.update(
      p.pos.x,
      p.pos.z,
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      this.cameraLookAt.x,
      this.cameraLookAt.y,
      this.cameraLookAt.z,
      fogFar,
    );
    this.fish.update(p.pos.x, p.pos.z, dt);
    this.vfx.update(dt);
    this.frozenOrbFx.update(dt);
    this.mageGroundFx.update(dt);
    this.ringOfFrostVisuals.sync(this.sim.activeFrostRings);
    this.ringOfFrostVisuals.update(dt);
    this.temporalHourglassGroundVisuals.sync(this.sim.activeTemporalHourglasses);
    this.temporalHourglassGroundVisuals.update(dt);
    this.glacialFrontVisual.updateCharge(p, dt, groundHeight(p.pos.x, p.pos.z, this.sim.cfg.seed));
    this.glacialFrontVisual.update(dt);
    this.lightPulses.update(dt);
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
    this.nameplatePainter.update(true);
    this.updateChatBubbles();
  }

  private prewarmEntity(
    kind: 'player' | 'mob' | 'npc',
    templateId: string,
    color: number,
    scale: number,
    skin = 0,
    id = -10_000,
  ): Entity {
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
    if (e.kind === 'mob') return `mob:${e.templateId}:${e.color}:${e.scale}`;
    // NPCs are skinned characters too: pool them like mobs so their Skeleton (and its
    // bone-matrix DataTexture) survives interest churn instead of being disposed and
    // re-uploaded every time one streams out and back into view - that dispose +
    // re-upload cycle is the open-world "asset-upload" travel hitch (Skeleton.dispose
    // via CharacterVisual.dispose in removeView, pinned by GPU-upload profiling).
    if (e.kind === 'npc') return `npc:${e.templateId}:${e.skin}:${e.color}:${e.scale}`;
    return null;
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
    // Track which visual MODELS have been built (visualKeyFor = the model selector;
    // distinct shader programs are per-model, so this is what we must cover). The
    // pool itself is still keyed per template via visualPoolKeyFor.
    const builtModels = new Set<string>();
    const build = (templateId: string, copies: number): void => {
      const template = MOBS[templateId];
      if (!template) return;
      for (let i = 0; i < copies; i++) {
        const entity = this.prewarmEntity('mob', template.id, template.color, template.scale);
        const visual = createCharacterVisual(entity);
        // assets unavailable: skip the seed, leave the model unmarked so the
        // dedup pass below can retry it
        if (!visual) continue;
        builtModels.add(visualKeyFor(entity));
        const poolKey = this.visualPoolKeyFor(entity);
        if (poolKey) this.storePooledVisual(poolKey, visual);
        visual.root.visible = true;
        place(visual.root);
      }
    };
    // Common mobs spawn in packs → pool several copies per template (this also
    // compiles their shaders).
    for (const templateId of PREWARM_MOB_TEMPLATE_IDS) build(templateId, PREWARM_MOB_POOL_COPIES);
    // Then every remaining mob whose visual MODEL hasn't been built yet — one copy,
    // so its shader program is compiled at load and never hitches in-world. Mobs that
    // share a family model are built only once. NOT deadline-gated: the distinct-model
    // set is small (deduped by visualKeyFor) and is the whole point of this pass — a
    // skipped model is a guaranteed in-world compile stall (real-GPU walk profiling
    // caught a beast model linking ~4 programs / ~240ms when first seen north of spawn
    // because the shared build deadline cut this loop off). The deadline still bounds
    // the EXTRA pool copies above; one copy per model is cheap and mandatory.
    for (const templateId of Object.keys(MOBS)) {
      if (PREWARM_MOB_COMMON_IDS.has(templateId)) continue;
      const template = MOBS[templateId];
      if (!template) continue;
      const modelKey = visualKeyFor(
        this.prewarmEntity('mob', template.id, template.color, template.scale),
      );
      if (builtModels.has(modelKey)) continue;
      build(templateId, 1);
    }
    return group;
  }

  // Every NPC visual MODEL once (NPCs were not prewarmed at all — entering a zone hub
  // compiled their shaders live). Most NPCs share a handful of models (npc_knight,
  // npc_mage, ...), so dedup by model key (visualKeyFor) builds each only once.
  private buildNpcPrewarmGroup(deadline: number): THREE.Group {
    const group = new THREE.Group();
    const p = this.sim.player;
    group.position.set(p.pos.x, p.pos.y, p.pos.z - 24);
    setRenderCategory(group, 'prewarm');
    let idx = 0;
    const builtModels = new Set<string>();
    for (const npc of Object.values(NPCS)) {
      if (performance.now() >= deadline) break;
      const entity = this.prewarmEntity('npc', npc.id, npc.color, 1);
      const modelKey = visualKeyFor(entity);
      if (builtModels.has(modelKey)) continue;
      const visual = createCharacterVisual(entity);
      // assets unavailable: skip the seed, leave the model unmarked
      if (!visual) continue;
      builtModels.add(modelKey);
      const poolKey = this.visualPoolKeyFor(entity);
      if (poolKey) this.storePooledVisual(poolKey, visual);
      visual.root.visible = true;
      visual.root.position.set(((idx % 8) - 3.5) * 2.8, 0, Math.floor(idx / 8) * 2.8);
      group.add(visual.root);
      idx++;
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
        // assets unavailable: skip the seed
        if (!visual) continue;
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
        // Hide the object's own point light (e.g. the ritual circle glow) during
        // the prewarm: it must not inflate numPointLights, or every material would
        // compile for one more light than the open world's constant budget ever
        // shows and they would all recompile on first travel. Restored in the
        // prewarm finally so the pooled object lights normally when reused live.
        built.group.traverse((o) => {
          if ((o as THREE.PointLight).isPointLight) o.visible = false;
        });
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
    const policy: PrewarmPolicy = resolvePrewarmPolicy({
      constrainedMemory: GFX.constrainedMemory,
      asyncCompileSupported: this.asyncCompileSupported,
      lowGfx: this.lowGfx,
      defaultMaxMs: VIEW_PREWARM_MAX_MS,
      constrainedMaxMs: VIEW_PREWARM_MAX_MS_CONSTRAINED,
      defaultCompileMaxMs: PREWARM_COMPILE_MAX_MS,
      constrainedCompileMaxMs: PREWARM_COMPILE_MAX_MS_CONSTRAINED,
      maxViewsLow: VIEW_PREWARM_MAX_VIEWS_LOW,
      maxViewsHigh: VIEW_PREWARM_MAX_VIEWS_HIGH,
      maxViewsConstrained: VIEW_PREWARM_MAX_VIEWS_CONSTRAINED,
    });
    const constrainedPrewarm = policy.minimalManifest;
    const maxMs = Math.max(0, options.maxMs ?? policy.maxMs);
    const started = performance.now();
    const deadline = started + maxMs;
    // Stop the archetype-build steps early so the later entries — crucially
    // programs.compile — still START before `deadline` (runEntry skips anything
    // that begins past it). Compiling is what kills the in-world freeze.
    const buildDeadline = deadline - PREWARM_BUILD_RESERVE_MS;
    const manifestEntries: RendererPrewarmManifestEntryStats[] = [];
    const startCounts = this.prewarmCounts();
    const createdViewTypes: string[] = [];
    const p = this.sim.player;
    let createdViews = 0;
    let candidateViews = 0;
    let doorPrewarmGroup: THREE.Group | null = null;
    let interiorPrewarmGroup: THREE.Group | null = null;
    let entityPrewarmGroup: THREE.Group | null = null;
    let npcPrewarmGroup: THREE.Group | null = null;
    let playerPrewarmGroup: THREE.Group | null = null;
    let objectPrewarmGroup: THREE.Group | null = null;
    let propMaterialPrewarmGroup: THREE.Group | null = null;
    let foliagePrewarmGroup: THREE.Group | null = null;

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

    const runEntry = async (entry: PrewarmManifestEntry): Promise<void> => {
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
          createdViews += this.createCandidateViews(
            Math.max(0, policy.maxViews - createdViews),
            createdViewTypes,
            deadline,
          );
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
        // Compile the dungeon interior shaders (kit + Halloween-bits pack
        // materials, the Drowned Temple water shader, torch-glow decal) at boot
        // so first entry / nearing a dungeon door does not link them live.
        // Assets are boot-preloaded (see dungeon.ts), so the await is resolved.
        id: 'interiors.materials',
        category: 'objects',
        priority: 32,
        required: false,
        run: async () => {
          this.dungeons ??= new DungeonInteriors(
            this.scene,
            this.lowGfx,
            this.flames,
            this.fireLights,
          );
          interiorPrewarmGroup = await this.dungeons.buildPrewarmGroup();
          this.scene.add(interiorPrewarmGroup);
        },
        detail: () => `objects=${interiorPrewarmGroup?.children.length ?? 0}`,
      },
      {
        // Players are the #1 shader-compile trigger in a crowd, so build their
        // archetypes first (before the long mob tail) — guaranteed within budget.
        id: 'entities.player-archetypes',
        category: 'entities',
        priority: 34,
        required: true,
        run: () => {
          const built = this.buildPlayerPrewarmGroup(buildDeadline);
          playerPrewarmGroup = built.group;
          playerPrewarmVisuals = built.visualCount;
          this.scene.add(playerPrewarmGroup);
        },
        detail: () =>
          `classes=${ALL_CLASSES.length};skins=${prewarmPlayerSkinVariantCount()};visuals=${playerPrewarmVisuals}`,
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
        detail: () =>
          `mobs=${Object.keys(MOBS).length};common=${PREWARM_MOB_TEMPLATE_IDS.length};copies=${PREWARM_MOB_POOL_COPIES}`,
      },
      {
        id: 'entities.npc-archetypes',
        category: 'entities',
        priority: 36,
        required: true,
        run: () => {
          npcPrewarmGroup = this.buildNpcPrewarmGroup(buildDeadline);
          this.scene.add(npcPrewarmGroup);
        },
        detail: () => `npcs=${Object.keys(NPCS).length}`,
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
        detail: () =>
          `items=${PREWARM_OBJECT_ITEM_IDS.length};copies=${PREWARM_OBJECT_POOL_COPIES}`,
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
        // Compile every foliage shader (tree/rock/dressing species + far-tree
        // impostors) at boot. The renderer streams foliage buckets in as you
        // move, so distant-only species otherwise link their shaders mid-travel
        // (the open-world hitch walking north out of spawn).
        id: 'foliage.materials',
        category: 'props',
        priority: 46,
        required: false,
        run: () => {
          foliagePrewarmGroup = buildFoliageMaterialPrewarmGroup();
          this.scene.add(foliagePrewarmGroup);
        },
        detail: () => `objects=${foliagePrewarmGroup?.children.length ?? 0}`,
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
          // Use a dedicated budget, not `deadline - now`: linking every program now is
          // exactly what prevents the in-world freeze, so a near-empty leftover budget
          // must not cut it short (the old bug — the async compile timed out and the
          // programs linked synchronously on first sight instead).
          // Constrained (phone WebKit) without KHR_parallel_shader_compile: BOTH arms
          // below are one multi-second synchronous main-thread block (compileAsync
          // without the extension takes the same up-front compile), which is exactly
          // the unresponsiveness that gets the WebContent process killed. The
          // per-entry link passes already linked every visible program, so leave the
          // remainder to the bounded first-sight view gates and skip the monolith.
          if (policy.skipMonolithCompile) {
            compileMs = 0;
            return;
          }
          if (this.webgl.compileAsync) {
            compileMode = 'async';
            let settled = false;
            const compilePromise = this.webgl
              .compileAsync(this.scene, this.camera)
              .then(() => {
                settled = true;
              })
              .catch((err: unknown) => {
                settled = true;
                console.warn('Renderer async prewarm compile failed', err);
              });
            await Promise.race([compilePromise, sleep(policy.compileMaxMs)]);
            compileTimedOut = !settled;
            compileMs = roundMs(performance.now() - compileStart);
          } else {
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

    // Order per policy: with parallel compile, programs.compile moves ahead of
    // world.initial-frame so that pass draws already-linked programs off-thread
    // instead of force-linking them in one synchronous block (prewarm_policy.ts).
    const byId = new Map(manifest.map((entry) => [entry.id, entry]));
    const orderedManifest = orderedPrewarmIds(
      manifest.map((entry) => entry.id),
      policy,
    ).map((id) => byId.get(id) as PrewarmManifestEntry);
    try {
      for (const entry of orderedManifest) {
        // Skip everything outside the minimal keep-list (prewarm_policy.ts),
        // recording the skip so the prewarm summary stays honest about what was
        // deliberately not warmed. The skipped warms happen lazily in-world.
        if (!prewarmEntryRuns(entry.id, policy)) {
          const counts = this.prewarmCounts();
          manifestEntries.push({
            id: entry.id,
            category: entry.category,
            priority: entry.priority,
            required: entry.required,
            status: 'skipped',
            elapsedMs: 0,
            remainingMsAfter: roundMs(Math.max(0, deadline - performance.now())),
            passes: renderPasses,
            programsBefore: counts.programs,
            programsAfter: counts.programs,
            programDelta: 0,
            texturesBefore: counts.textures,
            texturesAfter: counts.textures,
            textureDelta: 0,
            detail: 'constrained-minimal',
          });
          continue;
        }
        // Yield the EVENT LOOP between entries (the awaits inside runEntry are
        // microtask-only, which never lets the process service events) so the
        // responsiveness watchdog sees a live process.
        if (policy.yieldBetweenEntries) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        await runEntry(entry);
        // Without parallel compile, link group-by-group per entry (the monolith is
        // skipped). With it, these passes are counterproductive and the async
        // compile entry links off-thread instead (prewarm_policy.ts).
        if (policy.linkPassPerEntry && performance.now() < buildDeadline) {
          this.renderPrewarmPass(1 / 60);
          renderPasses++;
        }
      }
    } finally {
      this.vfx.clear();
      if (doorPrewarmGroup) this.scene.remove(doorPrewarmGroup);
      if (interiorPrewarmGroup) this.scene.remove(interiorPrewarmGroup);
      if (entityPrewarmGroup) this.scene.remove(entityPrewarmGroup);
      if (npcPrewarmGroup) this.scene.remove(npcPrewarmGroup);
      if (playerPrewarmGroup) this.scene.remove(playerPrewarmGroup);
      if (objectPrewarmGroup) {
        // Re-show the object lights hidden during the prewarm so the pooled objects
        // (reused for the live ground objects) light normally. (Cast: the manifest
        // closure assignment is invisible to TS flow analysis here.)
        (objectPrewarmGroup as THREE.Group).traverse((o: THREE.Object3D) => {
          if ((o as THREE.PointLight).isPointLight) o.visible = true;
        });
        this.scene.remove(objectPrewarmGroup);
      }
      if (propMaterialPrewarmGroup) this.scene.remove(propMaterialPrewarmGroup);
      if (foliagePrewarmGroup) this.scene.remove(foliagePrewarmGroup);
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
    // Dev-channel diagnostic (pairs with main.ts's "[entry-guard] scene built"): one
    // line naming where the entry-time main-thread budget went, for isolating
    // world-entry process kills on real devices.
    console.info(
      `[entry-guard] prewarm done: ${stats.elapsedMs}ms/${stats.maxMs}ms passes=${stats.renderPasses} ` +
        `views=${stats.createdViews}/${stats.candidateViews} ` +
        `programs=${stats.programsBefore}->${stats.programsAfter} ` +
        `textures=${stats.texturesBefore}->${stats.texturesAfter} ` +
        `compile=${stats.compileMode}/${stats.compileMs}ms parallelCompile=${this.asyncCompileSupported} ` +
        `skipped=${stats.manifestSkipped} timedOut=[${stats.timedOutEntryIds.join(',')}] ` +
        `failed=[${stats.failedEntryIds.join(',')}]`,
    );
    return stats;
  }

  // Visual reactions to sim events (called by the HUD for every event,
  // including those between other players and mobs).
  handleEvent(ev: SimEvent): void {
    switch (ev.type) {
      case 'spellfx': {
        if (ev.fx === 'blinkStep') {
          // A teleport step (Flickerstep / Shadowstep): reset the cached self
          // position so the body snaps to the authoritative destination. A
          // short pulse sells the pop.
          if (ev.sourceId === this.sim.player.id) {
            this.selfRenderPositionReady = false;
          }
          this.pulseAt(ev.sourceId, ev.school, 1.2, 0.35);
          break;
        }
        if (ev.fx === 'frostCone') {
          const source = this.sim.entities.get(ev.sourceId);
          if (source) {
            this.glacialFrontVisual.spawn(
              source.pos.x,
              groundHeight(source.pos.x, source.pos.z, this.sim.cfg.seed),
              source.pos.z,
              source.facing,
              ev.range ?? 7,
              ev.level ?? 1,
              ev.angle ?? 70,
              ev.fx,
            );
            this.triggerAttack(ev.sourceId);
          }
          break;
        }
        if (ev.fx === 'fireCone') {
          const source = this.sim.entities.get(ev.sourceId);
          if (source) {
            this.glacialFrontVisual.spawn(
              source.pos.x,
              groundHeight(source.pos.x, source.pos.z, this.sim.cfg.seed),
              source.pos.z,
              source.facing,
              ev.range ?? 6,
              ev.level ?? 1,
              ev.angle ?? 55,
              ev.fx,
            );
            this.triggerAttack(ev.sourceId);
          }
          break;
        }
        if (ev.fx === 'windup') {
          // A petSpell windup telegraph: start the throw animation now; the
          // projectile for this throw follows petSpell.windup later, timed to
          // the clip's release pose.
          this.triggerAttack(ev.sourceId);
          break;
        }
        // Player ranged attacks begin when their projectile launches. The live
        // CharacterVisual chooses the authored crossbow/default clip or the bow
        // skin's cosmetic draw override without changing the sim timeline.
        if (ev.fx === 'projectile' && ev.attackAnimation === 'ranged-shot') {
          const source = this.sim.entities.get(ev.sourceId);
          if (playerRangedAttackStartsAtLaunch(source?.kind, ev.attackAnimation))
            this.triggerAttack(ev.sourceId);
        }
        const warriorCast = warriorCastVisualPlan(ev.fx, ev.ability);
        if (warriorCast?.kind === 'shout') {
          this.playShoutFx(ev.sourceId, warriorCast);
          break;
        }
        if (warriorCast?.kind === 'gesture') {
          this.triggerAttack(ev.sourceId, warriorCast.abilityId);
          break;
        }
        if (ev.fx === 'projectile') this.vfx.projectile(ev.sourceId, ev.targetId, ev.school);
        else if (ev.fx === 'heavyBolt')
          // Pyroblast's boulder: the same homing comet, doubled up.
          this.vfx.projectile(ev.sourceId, ev.targetId, ev.school, 2);
        else if (ev.fx === 'beam') this.vfx.beam(ev.sourceId, ev.targetId, ev.school);
        else if (ev.fx === 'bubbleBeam') {
          const duration = ev.duration ?? 4;
          this.vfx.bubbleBeam(ev.sourceId, ev.targetId, duration);
          if (duration <= 0) {
            this.waterJetVisualChannels.delete(ev.sourceId);
          } else {
            this.waterJetVisualChannels.set(ev.sourceId, duration);
            const view = this.views.get(ev.sourceId);
            if (view) this.activeVisual(view)?.beginCastChannel();
          }
        } else if (ev.fx === 'chainHeal') this.vfx.chainHealArc(ev.sourceId, ev.targetId);
        else if (ev.fx === 'procSurge') {
          this.vfx.procSurge(ev.targetId, ev.school);
          this.pulseAt(ev.targetId, ev.school, 5, 0.4);
        } else if (ev.fx === 'wardBloom') {
          this.vfx.wardBloom(ev.targetId, ev.school);
          this.pulseAt(ev.targetId, ev.school, 7, 0.55);
        } else if (ev.fx === 'echoBurst') {
          this.vfx.echoBurst(ev.targetId, ev.school);
          this.pulseAt(ev.targetId, 'nature', 6, 0.5);
        } else if (ev.fx === 'detonate') {
          this.vfx.detonate(ev.targetId, ev.school);
          this.pulseAt(ev.targetId, ev.school, 9, 0.5);
        } else if (ev.fx === 'temporalGlyph') {
          // Chronomancy Temporal Echo apply: a brief temporal glyph blooms
          // directly OVER the marked ally (target-anchored, no projectile ever
          // travels to them). A modest arcane bloom + glow, distinct from the
          // per-hit heal-glow pulse the conversion heals emit.
          this.vfx.wardBloom(ev.targetId, 'arcane');
          this.pulseAt(ev.targetId, 'arcane', 5, 0.45);
        } else if (ev.fx === 'temporalClock') {
          // Audio-only cue. The authoritative Rewind nova is emitted separately.
        } else if (ev.fx === 'temporalRewindNova') {
          this.vfx.nova(ev.targetId, ev.school);
        } else if (ev.fx === 'lightning') this.vfx.lightningProjectile(ev.sourceId, ev.targetId);
        else if (ev.fx === 'tick') this.vfx.tick(ev.targetId, ev.school);
        else this.vfx.nova(ev.targetId, ev.school);
        // A mob that hurls an instant bolt with NO windup (the warlock
        // demon's bolt) has no cast state for the looping cast channel, and
        // the damage event that animates melee fires on ARRIVAL and only for
        // the physical school: play the shooter's attack one-shot at launch
        // so the throw reads. A windup-telegraphed throw already started its
        // one-shot above (still mid-flight at the release: skip the
        // retrigger). Real casts (castingAbility set) animate via the cast
        // channel; players animate through their own cast/swing paths.
        if (ev.fx === 'projectile' || ev.fx === 'beam') {
          const src = this.sim.entities.get(ev.sourceId);
          if (src && src.kind === 'mob' && !src.castingAbility) {
            const view = this.views.get(ev.sourceId);
            const vis = view ? this.activeVisual(view) : null;
            if (!vis?.isMidOneShot) this.triggerAttack(ev.sourceId);
          }
        }
        break;
      }
      case 'spellfxAt': {
        // The Frozen Orb flight, animated locally from its three moments:
        // 'release' starts the drift, 'halt'/'resume' freeze and restart it at
        // the server's real coordinates when the orb latches onto an enemy.
        // The pulse novas below stay the area telegraph, so no actionable
        // information rides on this mesh.
        if (ev.fx === 'meteorFall') {
          this.mageGroundFx.spawnMeteor({
            x: ev.x,
            z: ev.z,
            radius: ev.radius ?? 8,
            duration: ev.duration ?? 2,
          });
          break;
        }
        if (ev.fx === 'snowZone') {
          this.mageGroundFx.spawnSnow({
            x: ev.x,
            z: ev.z,
            radius: ev.radius ?? 7,
            duration: ev.duration ?? 6,
          });
          break;
        }
        if (ev.fx === 'runeCircle') {
          this.mageGroundFx.spawnRune({
            x: ev.x,
            z: ev.z,
            radius: ev.radius ?? 8,
            duration: ev.duration ?? 15,
          });
          break;
        }
        if (ev.fx === 'orb') {
          const orbSource = ev.sourceId ?? -1;
          if (ev.phase === 'halt') this.frozenOrbFx.halt(orbSource, ev.x, ev.z);
          else if (ev.phase === 'resume') this.frozenOrbFx.resume(orbSource, ev.x, ev.z);
          else
            this.frozenOrbFx.spawn({
              sourceId: orbSource,
              x: ev.x,
              z: ev.z,
              dirX: ev.dirX ?? 0,
              dirZ: ev.dirZ ?? 1,
              speed: ev.speed ?? 2.5,
              duration: ev.duration ?? 8,
            });
          break;
        }
        // Ground-targeted impact: burst draped onto the terrain where the spell
        // was aimed (not on the caster), so an aimed blast reads at its landing
        // spot. A 'nova' aim is the heavier detonation; 'burst' the lighter one.
        // A radius-carrying event also flashes the AoE ring so the blast AREA
        // reads, not just its center.
        const gy = groundHeight(ev.x, ev.z, this.sim.cfg.seed);
        const at = new THREE.Vector3(ev.x, gy + 0.4, ev.z);
        this.vfx.burst(at, ev.school, ev.fx === 'nova' ? 34 : 22, ev.fx === 'nova' ? 1.4 : 1);
        if (ev.radius) this.spawnAoeRing(ev.x, ev.z, ev.radius, ev.school);
        break;
      }
      case 'damage': {
        // Every melee/ranged hit animates the attacker. A ranged projectile
        // carrying the typed launch cue already began its cosmetic one-shot,
        // so do not restart that same shot when its damage lands.
        const source = this.sim.entities.get(ev.sourceId);
        const rangedShotAlreadyStarted = playerRangedAttackAlreadyStarted(
          source?.kind,
          ev.attackAnimationStarted,
        );
        if (ev.school === 'physical' && ev.sourceId !== -1 && !rangedShotAlreadyStarted)
          this.triggerAttack(ev.sourceId, attackAbilityId(ev.ability));
        if (ev.kind === 'hit' && ev.amount > 0) {
          // landed blows flinch the victim (rate-limited inside the visual)
          this.triggerHit(ev.targetId);
          if (ev.school === 'physical') this.vfx.meleeSpark(ev.targetId, ev.crit);
        }
        break;
      }
      case 'heal2':
        // Throttle the particle bloom to one per target per 110ms so a burst of tiny
        // simultaneous heals (a Chronomancy group echo converting an AoE that hit
        // several enemies onto five allies in one frame) cannot spike the particle
        // count. The healing number itself (FCT) is emitted elsewhere and unaffected.
        if (ev.amount > 0 || ev.crit) {
          const nowMs = performance.now();
          if (nowMs - (this.healGlowAt.get(ev.targetId) ?? 0) >= 110) {
            this.healGlowAt.set(ev.targetId, nowMs);
            this.vfx.healGlow(ev.targetId);
          }
        }
        break;
      case 'aura': {
        const tgt = this.sim.entities.get(ev.targetId);
        // Set-proc auras announce themselves with a themed swirl: on the wearer
        // for the self buffs, on the struck mob for the bleeds (so this arm is
        // NOT player-gated). Everything else keeps the generic player swirl.
        const procColor = SET_PROC_FX_BY_NAME.get(ev.name);
        if (ev.gained && procColor !== undefined && tgt) {
          this.vfx.buffSwirl(ev.targetId, procColor);
        } else if (ev.gained && tgt?.kind === 'player') {
          this.vfx.buffSwirl(ev.targetId);
        }
        break;
      }
      case 'levelup':
        this.vfx.levelUpPillar(this.sim.playerId);
        break;
      case 'deedUnlocked': {
        // Book of Deeds earned moment: one festival-gold shell just above the
        // player's head (the hud pid gate already dropped other players'
        // copies). Retro back-credits (the on-join catch-up) draw nothing;
        // the HUD folds them into a single summary line. A reduced-motion
        // player skips the burst too: it is a sudden personal flash at the
        // camera's focus, and the banner plus gold log line carry the moment.
        if (!shouldPlayDeedFirework(ev, this.reducedMotion())) break;
        const v = this.views.get(this.sim.playerId);
        if (!v) break;
        const p = this.sim.player;
        this.tmpV.set(
          v.group.position.x,
          v.group.position.y + v.height * (p.scale ?? 1) + 2.2,
          v.group.position.z,
        );
        this.vfx.fireworkBurst(this.tmpV, FESTIVAL_GOLD_COLORS, 46, 1.1);
        break;
      }
      case 'delveEntered':
        this.prebuildDelveInteriors(ev.delveId);
        break;
      case 'yumiTeleport': {
        // Arcane burst at both ends of the cat's blink (the event is personal
        // per participant; ignore copies addressed to other local pids so an
        // offline multi-player sim never double-bursts).
        if (ev.pid !== undefined && ev.pid !== this.sim.playerId) break;
        const fromY = groundHeight(ev.fromX, ev.fromZ, this.sim.cfg.seed);
        const toY = groundHeight(ev.toX, ev.toZ, this.sim.cfg.seed);
        this.vfx.burst(new THREE.Vector3(ev.fromX, fromY + 1, ev.fromZ), 'arcane', 26, 1.2);
        this.vfx.burst(new THREE.Vector3(ev.toX, toY + 1, ev.toZ), 'arcane', 26, 1.2);
        // Snap the objective beacon to the landing spot NOW: online, the
        // arenaInfo mirror the beacon polls refreshes only every 10s.
        for (const view of this.yumiMazeViews.values()) view.noteTeleport(ev.catId, ev.toX, ev.toZ);
        break;
      }
      case 'delveRitePulse': {
        // The Drowned Reliquary Rite plays its sequence by pulsing each shrine
        // in turn; a school-coloured nova on the shrine entity shows which one
        // (colour matches the shrine's accent so the sequence is readable).
        const school =
          ev.shrineKind === 'rite_shrine_candle'
            ? 'fire'
            : ev.shrineKind === 'rite_shrine_reed'
              ? 'nature'
              : ev.shrineKind === 'rite_shrine_skull'
                ? 'shadow'
                : 'holy';
        this.vfx.nova(ev.entityId, school);
        break;
      }
      case 'delveRiteFeedback':
        // A correct touch answers with a green up-glow; a wrong one with a dark
        // shadow burst on the shrine the player pressed.
        if (ev.correct) this.vfx.healGlow(ev.shrineId);
        else this.vfx.nova(ev.shrineId, 'shadow');
        break;
      case 'fiestaPowerup':
        // Big celebratory pop on grab, plus a lingering coloured glow.
        this.vfx.levelUpPillar(ev.entityId);
        this.vfx.nova(ev.entityId, 'nature');
        this.fiestaGlows.set(ev.entityId, {
          color: ev.glow,
          until: this.time + ev.duration,
          nextSwirl: 0,
        });
        if (ev.entityId === this.sim.playerId) this.addShake(0.5);
        break;
      case 'vcupGoal': {
        // Team-colored firework volley above the goal the ball went into (the
        // event's world anchor). Away palette when both sides fly one banner.
        const away = ev.nationA === ev.nationB && ev.team === 'B';
        const nation = ev.team === 'A' ? ev.nationA : ev.nationB;
        const cols = nationColors(nation, away);
        this.queueValeCupFireworks(ev.x, ev.z, cols, 6);
        // a quick team-colored ground flash right at the goal that was scored
        this.valeCupTeamRings.flashGoal(ev.x, ev.z, cols[0], this.groundSample);
        break;
      }
      case 'vcupEnd': {
        // Full-time show over the pitch: the winners' colors, or festival gold
        // for a draw. Audio (horn/roar) is HUD-armed, not fired here.
        if (ev.winner) {
          const away = ev.nationA === ev.nationB && ev.winner === 'B';
          const nation = ev.winner === 'A' ? ev.nationA : ev.nationB;
          this.queueValeCupFireworks(ev.x, ev.z, nationColors(nation, away), 10);
        } else {
          this.queueValeCupFireworks(ev.x, ev.z, FESTIVAL_GOLD_COLORS, 5);
        }
        break;
      }
    }
  }

  // ---- Vale Cup juice ------------------------------------------------------

  // Stagger a volley of firework shells around a world anchor; tickValeCupFx
  // pops them as their times come due (the pooled Vfx has no delayed spawn).
  private queueValeCupFireworks(
    x: number,
    z: number,
    colors: readonly number[],
    shells: number,
  ): void {
    for (let i = 0; i < shells; i++) {
      this.vcupFireworks.push({
        at: this.time + i * 0.33 + Math.random() * 0.14,
        x: x + (Math.random() - 0.5) * 7,
        z: z + (Math.random() - 0.5) * 7,
        colors,
      });
    }
  }

  private tickValeCupFx(dt: number): void {
    this.valeCupBallDust?.update(dt);
    this.valeCupBallTrail?.update(dt);
    if (this.vcupFireworks.length === 0) return;
    for (let i = this.vcupFireworks.length - 1; i >= 0; i--) {
      const s = this.vcupFireworks[i];
      if (this.time < s.at) continue;
      this.vcupFireworks.splice(i, 1);
      const gy = groundHeight(s.x, s.z, this.sim.cfg.seed);
      this.tmpV.set(s.x, gy + 9 + Math.random() * 4, s.z);
      this.vfx.fireworkBurst(this.tmpV, s.colors, 46, 1.15);
    }
  }

  // The boarball: client-side roll from render-space position deltas, the
  // ground-hugging contact blob, and a dust kick while it rolls fast.
  private updateValeCupBall(e: Entity, v: EntityView, dt: number): void {
    v.group.rotation.y = 0; // the roll owns orientation; facing means nothing here
    const bodyGroup = v.objectMesh as THREE.Group | undefined;
    if (!bodyGroup) return;
    const spinner = bodyGroup.userData.vcSpinner as THREE.Object3D | undefined;
    const shadow = bodyGroup.userData.vcShadow as THREE.Mesh | undefined;
    const x = v.group.position.x;
    const y = v.group.position.y;
    const z = v.group.position.z;
    const dx = x - v.lastX;
    const dz = z - v.lastZ;
    v.lastX = x;
    v.lastZ = z;
    if (spinner) rollBallSpinner(spinner, dx, dz, spinner.position.y * e.scale);
    const gy = groundHeight(x, z, this.sim.cfg.seed);
    const heightAbove = Math.max(0, y - gy);
    if (shadow) {
      // group.scale carries e.scale, so the local offset is divided back out
      shadow.position.y = (gy - y) / Math.max(0.001, e.scale) + 0.04;
      shadow.scale.setScalar(Math.max(0.4, 1 / (1 + heightAbove * 0.4)));
      (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0.1,
        0.95 - heightAbove * 0.14,
      );
    }
    const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    // Rocket-League-style light trail: a comet dropped at the ball, thicker +
    // brighter for a hard kick, thin for a dribble. Follows the ball anywhere
    // (ground or flight), so it is easy to track. Lazy pool, scene-level.
    if (v.group.visible) {
      if (!this.valeCupBallTrail) {
        this.valeCupBallTrail = new ValeCupBallTrail();
        this.scene.add(this.valeCupBallTrail.group);
      }
      this.valeCupBallTrail.emit(x, y + BALL_RADIUS * e.scale, z, speed, dt);
    }
    if (speed > 6 && heightAbove < 0.5 && v.group.visible) {
      if (!this.valeCupBallDust) {
        this.valeCupBallDust = new ValeCupBallDust();
        this.scene.add(this.valeCupBallDust.group);
      }
      this.valeCupBallDust.kick(x, gy, z, dx, dz, dt);
    }
    // Kick puff: the ball leaping from rest (a held/loose ball) to fast is a
    // clean kick signal (banking off a board keeps speed, so it does not trip
    // this). Pure render heuristic, no sim event. Reuses the dust pool.
    const prevSpeed = (bodyGroup.userData.vcLastSpeed as number) ?? 0;
    bodyGroup.userData.vcLastSpeed = speed;
    if (prevSpeed < 4 && speed > 13 && heightAbove < 0.7 && v.group.visible) {
      if (!this.valeCupBallDust) {
        this.valeCupBallDust = new ValeCupBallDust();
        this.scene.add(this.valeCupBallDust.group);
      }
      this.valeCupBallDust.burst(x, gy, z);
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
        color: 0xff3df0,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
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
    const list = match?.fiesta && match.state === 'active' ? match.fiesta.powerups : [];
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let m = this.fiestaPowerupMeshes.get(p.id);
      if (!m) {
        const geo = new THREE.OctahedronGeometry(0.8, 0);
        const mat = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
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
      if (this.time >= g.until || !this.views.has(id)) {
        this.fiestaGlows.delete(id);
        continue;
      }
      g.nextSwirl -= dt;
      if (g.nextSwirl <= 0) {
        g.nextSwirl = 0.22;
        this.vfx.buffSwirl(id, g.color);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Entity views
  // -------------------------------------------------------------------------

  // Shared object-view resources: views must not own materials/textures, or
  // interest churn leaks them (removeView only disposes per-view geometry). The
  // dungeon door/portal resources moved to door_portal.ts (same shared tagging).
  private sparkleMat: THREE.SpriteMaterial | null = null;

  private buildDoorPrewarmGroup(): THREE.Group {
    const group = new THREE.Group();
    const entrance = buildDoorBody(true, null, this.lowGfx).body;
    entrance.position.x = -3;
    group.add(entrance);
    const exit = buildDoorBody(false, null, this.lowGfx).body;
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
    if (
      e.kind === 'object' &&
      (e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit')
    ) {
      const entering = e.templateId === 'dungeon_door';
      const built = buildDoorBody(entering, e.dungeonId, this.lowGfx);
      body = built.body;
      portal = built.portal;
      height = 4.6;
      objectMesh = body!;
    } else if (e.kind === 'object' && e.templateId === 'mailbox') {
      // Ravenpost pillar: bespoke procedural prop (no sparkle; the unread-mail
      // votive in the group is the per-viewer beacon, toggled in sync()).
      const built = buildMailboxPillar(e.id);
      body = built.group;
      height = built.height;
      objectMesh = body!;
    } else if (e.kind === 'object' && e.templateId?.startsWith('delve_')) {
      // Delve interactables: skip the object pool (each is unique/stateful) and
      // build a dedicated procedural mesh that matches the crypt aesthetic.
      objectPoolKey = null;
      const built = buildDelveInteractable(e.templateId, e.id);
      body = built.group;
      height = built.height;
      objectMesh = body!;
      // Pressure plates are flush to the floor, no sparkle clutter overhead.
      if (
        e.templateId !== 'delve_pressure_plate' &&
        e.templateId !== 'delve_pressure_plate_triggered' &&
        !e.templateId.startsWith('delve_sluice_valve') &&
        !e.templateId.startsWith('delve_grave_tablet') &&
        !e.templateId.startsWith('delve_corpse_candle') &&
        // A pullable rope IS an F-interactable, so it keeps the sparkle until
        // pulled (unlike the flush walk-on plates above).
        e.templateId !== 'delve_bell_rope_pulled' &&
        e.templateId !== 'delve_locked_door' &&
        e.templateId !== 'delve_destructible_wall'
      ) {
        if (!this.sparkleMat) {
          this.sparkleMat = new THREE.SpriteMaterial({
            map: sparkleTexture(),
            transparent: true,
            depthWrite: false,
          });
          if (!this.lowGfx) this.sparkleMat.color.setScalar(SPARKLE_BOOST);
        }
        sparkle = new THREE.Sprite(this.sparkleMat);
        sparkle.scale.set(0.9, 0.9, 1);
        sparkle.position.y = 1.35;
        group.add(sparkle);
      }
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
        this.sparkleMat = new THREE.SpriteMaterial({
          map: sparkleTexture(),
          transparent: true,
          depthWrite: false,
        });
        if (!this.lowGfx) this.sparkleMat.color.setScalar(SPARKLE_BOOST); // gold glint via bloom
      }
      sparkle = new THREE.Sprite(this.sparkleMat);
      sparkle.scale.set(0.9, 0.9, 1);
      sparkle.position.y = 1.35;
      group.add(sparkle);
    } else if (e.kind === 'mob' && e.templateId === VALE_CUP_BALL_TEMPLATE) {
      // The boarball: bespoke stitched-leather sphere (an inert mob entity
      // would otherwise dress as a generic bandit rig). Keeps the default
      // body click path below, so clicking it is a harmless soft target;
      // its nameplate is suppressed in nameplate_view.
      const built = buildValeCupBall();
      body = built.group;
      height = built.height;
      objectMesh = body;
    } else {
      const visualKey = visualKeyFor(e);
      // The in-flight cooldown stops the deferring entity from burning a
      // budget slot every frame, and clearing it when the fetch RESOLVES
      // keeps pop-in at the next frame after readiness (only a rejected
      // fetch waits out the full cooldown).
      if (visualKey === 'player_mech' && !mechAssetsReady()) {
        void preloadMechAssets()
          .then(() => this.viewCreateRetry.markSucceeded(e.id, 'view'))
          .catch((err) =>
            logAssetMissOnce('preload:player_mech', 'Failed to preload live mech cosmetic:', err),
          );
        this.viewCreateRetry.markFailed(e.id, 'view', performance.now());
        return;
      }
      if (visualKey === 'mob_training_dummy' && !trainingDummyAssetsReady()) {
        void preloadTrainingDummyAssets()
          .then(() => this.viewCreateRetry.markSucceeded(e.id, 'view'))
          .catch((err) =>
            logAssetMissOnce(
              'preload:mob_training_dummy',
              'Failed to preload the Training Dummy:',
              err,
            ),
          );
        this.viewCreateRetry.markFailed(e.id, 'view', performance.now());
        return;
      }
      visualPoolKey = this.visualPoolKeyFor(e);
      visual = visualPoolKey ? this.takePooledVisual(visualPoolKey) : null;
      if (!visual) {
        // Pool MISS: build a fresh visual but KEEP its pool key so removeView returns
        // it to the pool (which self-sizes to demand) instead of disposing it. Disposing
        // a skinned visual frees its Skeleton's bone-matrix DataTexture; re-creating it
        // when the entity streams back re-uploads that texture - the open-world
        // "asset-upload" travel hitch. Before, only the few prewarm-seeded copies were
        // ever recycled, so every mob past that count churned. Key is per-template, so
        // the pool stays bounded by the peak simultaneous count.
        visual = this.createCharacterVisualWithRetry(e, 'view');
        // assets unavailable: skip, the entity stays a view candidate but sits
        // out the retry cooldown so it cannot starve the per-frame budget
        if (!visual) {
          return;
        }
      } else {
        this.viewCreateRetry.markSucceeded(e.id, 'view');
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
      body?.traverse((o) => {
        o.userData.entityId = e.id;
      });
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
    // developer-badge flair, shown inline before the name for other players
    const devTierEl = document.createElement('img');
    devTierEl.className = 'np-dev-tier';
    devTierEl.alt = '';
    devTierEl.style.display = 'none';
    // linked-Discord PFP, shown inline before the name for other players
    const discordEl = document.createElement('img');
    discordEl.className = 'np-discord';
    discordEl.alt = '';
    discordEl.referrerPolicy = 'no-referrer';
    discordEl.style.display = 'none';
    // The avatar is the one nameplate image sourced from an external URL (Discord's
    // CDN); if it fails to load, hide it rather than leave the browser's broken-image
    // placeholder on the plate. Attached once here; the element is reused per entity.
    attachAvatarFallback(discordEl);
    // operator-set AI-account tag, inline before the name. A SEPARATE span, never a
    // restyled .np-name: the name's black text-shadow is what keeps it legible over
    // bright terrain, and the tag's background-clip: text cannot coexist with it.
    // Keeping them apart also lets an AI account who is also Discord staff keep its
    // role colour on the name. Hidden by CSS until the painter toggles .ai-tag on.
    const aiEl = document.createElement('span');
    aiEl.className = 'np-ai';
    // Mob level badge (e.g. "[5]" / "[5+]"), displayed inline to the left of the
    // name. Gets the con (difficulty) color from the painter; the name stays white.
    // Hidden for all non-mob entity kinds (players, NPCs, objects).
    const levelEl = document.createElement('span');
    levelEl.className = 'np-level';
    levelEl.style.display = 'none';
    const nameEl = document.createElement('div');
    nameEl.className = 'np-name';
    nameEl.textContent = e.kind === 'object' ? objectDisplayName(e) : e.name;
    // Book of Deeds title subtitle under the name (players only); hidden
    // until the entity's `title` wire field resolves to real text
    const titleEl = document.createElement('div');
    titleEl.className = 'np-title';
    titleEl.style.display = 'none';
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
    np.append(
      emoteEl,
      raidMark,
      comboRow,
      marker,
      tierEl,
      devTierEl,
      discordEl,
      aiEl,
      levelEl,
      nameEl,
      titleEl,
      guildEl,
      hpBar,
      castBar,
    );
    this.nameplateLayer.appendChild(np);

    // object views gate their own casters; character shadows live in visual
    const objectCasters: THREE.Object3D[] = [];
    if (!visual) collectCasters(group, objectCasters);
    // Register any point lights this view owns (e.g. the quest-object glow) into the
    // constant point-light budget so numPointLights never changes as it streams in.
    const reconciledLights = reconcileViewPointLights(group, [], this.viewLights);
    const viewLights = reconciledLights.lights;
    if (reconciledLights.changed && viewLights.length > 0) {
      this.lightRankDirty = true;
      // A light-owning view is exempt from the hidden-view matrix gate below:
      // the light budget reads light.getWorldPosition, and r165's
      // updateWorldMatrix does NOT heal through a matrixWorldAutoUpdate=false
      // ancestor, so a gated group would rank the light at a stale position.
      this.lightOwnerGroups.add(group);
    }
    this.views.set(e.id, {
      group,
      visual,
      visualKey: visual ? visualKeyFor(e) : null,
      visualPoolKey,
      sheepVisual: null,
      bearVisual: null,
      catVisual: null,
      travelVisual: null,
      fireballTravelVisual: null,
      iceBlockVisual: null,
      temporalHourglassVisual: null,
      frostNovaRootVisual: null,
      mageBarrierVisual: null,
      height,
      clickTarget,
      nameplate: np,
      nameEl,
      titleEl,
      guildEl,
      hpBar,
      hpFill,
      emoteEl,
      emoteIconEl,
      emoteLabelEl,
      markerEl: marker,
      raidMarkEl: raidMark,
      comboRow,
      comboPips,
      castBar,
      castFill,
      castLabel,
      tierEl,
      devTierEl,
      discordEl,
      aiEl,
      levelEl,
      sparkle,
      objectMesh,
      objectPoolKey,
      builtTemplateId: e.kind === 'object' ? e.templateId : undefined,
      portal,
      nameplateDisplay: 'none',
      nameplateTransform: '',
      nameplateSig: '',
      nameplateStateMask: 0,
      nameplateFriendlyPet: false,
      nameplateHpWidth: '',
      titleSig: '',
      comboSig: '',
      tierValue: 0,
      devTierValue: 0,
      discordAvatarSig: '',
      levelSig: '',
      objectCasters,
      viewLights,
      shadowOn: true,
      isFar: false,
      compilePending: false,
      lastOverheadEmoteKey: null,
      lastX: e.pos.x,
      lastZ: e.pos.z,
      skin: e.skin,
      mainhandItemId: e.mainhandItemId,
      offhandItemId: e.offhandItemId,
      // built skinless; the per-frame diff below applies e.weaponSkinId (and its VFX)
      weaponSkinId: null,
      // Born false so the per-frame diff below sheathes an already-stowed entity
      // (a peer entering interest) on its first sync.
      weaponStowed: false,
      liveScale: e.scale,
      loco: newLocoTrack(),
      stepAccum: 0,
      wasAirborne: false,
      wasSwimming: false,
      airborneHeurFrames: 0,
    });
    const view = this.views.get(e.id);
    // Never gate the player's OWN view: it must be on screen immediately, its
    // class is already prewarmed, and the self render path does not re-evaluate
    // the compilePending flag (only the non-self loop does), so gating it would
    // strand the player invisible. Other entities un-hide via that loop.
    if (view && e.id !== this.sim.player.id) this.gateViewOnCompile(view, group);
  }

  // Generic anti-freeze layer. A freshly-streamed view links its shader programs
  // SYNCHRONOUSLY on first draw - a 50-1700ms frame stall (the open-world travel
  // hitch). Instead link them OFF the main thread (KHR_parallel_shader_compile via
  // compileAsync) against the live scene's exact lights + environment, and keep the
  // view hidden until ready: it pops in a frame or two late rather than freezing.
  // Unlike the boot prewarm this enumerates NOTHING, so new content and render-state
  // variants the prewarm cannot anticipate (e.g. the env-map-lit material that links
  // only when you walk into a biome) never hitch in-world. The prewarm stays a pure
  // optimization: already-compiled spawn content resolves instantly, no pop-in.
  private gateViewOnCompile(view: EntityView, group: THREE.Group): void {
    if (!this.asyncCompileSupported) return;
    view.compilePending = true;
    group.visible = false;
    let settled = false;
    const clear = (): void => {
      if (settled) return;
      settled = true;
      view.compilePending = false;
    };
    const guard = setTimeout(clear, VIEW_COMPILE_GATE_MAX_MS);
    this.webgl
      .compileAsync(group, this.camera, this.scene)
      .then(clear, clear)
      .finally(() => clearTimeout(guard));
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
    const retrySlot = `base:${nextKey}`;
    if (!this.viewCreateRetry.canAttempt(e.id, retrySlot, performance.now())) return;
    if (nextKey === 'player_mech' && !mechAssetsReady()) {
      // in-flight cooldown; cleared on fetch resolution so the swap lands the
      // next frame after readiness (see the createView gates)
      void preloadMechAssets()
        .then(() => this.viewCreateRetry.markSucceeded(e.id, retrySlot))
        .catch((err) =>
          logAssetMissOnce('preload:player_mech', 'Failed to preload live mech cosmetic:', err),
        );
      this.viewCreateRetry.markFailed(e.id, retrySlot, performance.now());
      return;
    }
    // Assets unavailable: keep the old visual and retry after the shared cooldown.
    const next = this.createCharacterVisualWithRetry(e, retrySlot);
    if (!next) return;
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
    v.mainhandItemId = e.mainhandItemId; // next was built holding the current weapon
    v.offhandItemId = e.offhandItemId; // next was built holding the current offhand
    v.weaponSkinId = null; // next was built skinless; the per-frame diff re-applies it
    v.weaponStowed = false; // next was built drawn (fresh stow transition); the diff re-sheathes
    v.group.add(next.root);
    this.reconcileViewLights(v);
  }

  private reconcileViewLights(v: EntityView): void {
    const reconciled = reconcileViewPointLights(v.group, v.viewLights, this.viewLights);
    if (!reconciled.changed) return;
    v.viewLights = reconciled.lights;
    this.lightRankDirty = true;
    if (v.viewLights.length > 0) this.lightOwnerGroups.add(v.group);
    else this.lightOwnerGroups.delete(v.group);
  }

  triggerAttack(entityId: number, abilityId?: string): void {
    const v = this.views.get(entityId);
    const visual = v ? this.activeVisual(v) : null;
    if (!visual) return;
    if (isSpinAttackAbility(abilityId)) visual.playWhirl();
    else visual.playAttack(abilityId);
  }

  private playShoutFx(
    entityId: number,
    plan: Extract<WarriorCastVisualPlan, { kind: 'shout' }>,
  ): void {
    const e = this.sim.entities.get(entityId);
    if (!e) return;
    this.vfx.shoutwave(entityId, plan.color);
    this.spawnAoeRing(e.pos.x, e.pos.z, plan.ringRadius, 'physical', plan.color);
    const v = this.views.get(entityId);
    const visual = v ? this.activeVisual(v) : null;
    if (visual && !visual.isMidOneShot) visual.playEmote(plan.emote, plan.repeats);
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
    if (this.sim.duelInfo?.state === 'active' && this.sim.duelInfo.otherPid === target.id)
      return true;
    const match = this.sim.arenaInfo?.match;
    return (
      match?.state === 'active' &&
      (match.oppPid === target.id || match.enemies.some((e) => e.pid === target.id))
    );
  }

  // -------------------------------------------------------------------------
  // Per-frame sync
  // -------------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Dungeon interiors (see dungeon.ts), built lazily per instance origin.
  // ---------------------------------------------------------------------

  private builtInteriors = new Set<string>();
  // Protect Yumi maze interiors, one per match slot, built lazily like the
  // arena copies; their update() anchors the team beacons each frame.
  private yumiMazeViews = new Map<number, YumiMazeView>();
  // Blue/red team arrows above every yumi fighter (yumi_team_markers.ts).
  private readonly yumiTeamMarkers = new YumiTeamMarkers();
  // Delve module interiors build asynchronously; track in-flight keys so a
  // per-frame ensureDelveInteriorsNear does not re-schedule a build mid-load.
  private pendingInteriors = new Set<string>();
  private fogState:
    | 'outdoor'
    | 'dungeon'
    | 'temple'
    | 'nythraxis'
    | 'delve'
    | 'yumiMaze'
    | 'underwater'
    | 'practice' = 'outdoor';

  private buildInterior(interior: string, ox: number, oz: number): void {
    this.dungeons ??= new DungeonInteriors(this.scene, this.lowGfx, this.flames, this.fireLights);
    void this.dungeons.buildInterior(interior, ox, oz).catch((err) => {
      console.error('Failed to build dungeon interior:', err);
    });
  }

  // Outdoor fog presets per biome (high tier eases between them as the
  // player crosses zone bands; low keeps the legacy vale fog everywhere).
  // far/near trimmed from the original release so a zone's own mountains (the
  // rim wall, the inter-zone ridges) fade into haze instead of standing out
  // crisp when viewed from the zone's hub/centre; ratio near:far kept roughly
  // constant per biome so the fog gradient itself doesn't change shape.
  private static BIOME_FOG: Record<BiomeId, { color: number; near: number; far: number }> = {
    vale: { color: 0xa6c6e0, near: 95, far: 340 },
    marsh: { color: 0xa3b294, near: 60, far: 240 },
    peaks: { color: 0xbdd3ec, near: 110, far: 390 },
    beach: { color: 0xbcd6e6, near: 105, far: 370 },
    desert: { color: 0xd8c9a8, near: 100, far: 360 },
    volcano: { color: 0x8a7468, near: 50, far: 220 },
    cave: { color: 0x76807c, near: 45, far: 190 },
  };
  private static LOW_FOG = { color: 0xa6c6e0, near: 70, far: 260 };

  private outdoorFogPreset(): { color: number; near: number; far: number } {
    if (this.lowGfx) return Renderer.LOW_FOG;
    return Renderer.BIOME_FOG[zoneBiomeAt(this.sim.player.pos.z)];
  }

  private scheduleDelveModuleBuild(
    key: string,
    moduleId: DelveModuleId,
    ox: number,
    oz: number,
  ): void {
    if (this.builtInteriors.has(key) || this.pendingInteriors.has(key)) return;
    this.pendingInteriors.add(key);
    this.dungeons ??= new DungeonInteriors(this.scene, this.lowGfx, this.flames, this.fireLights);
    void buildDelveModule(this.dungeons, moduleId, ox, oz)
      .then(() => {
        this.builtInteriors.add(key);
        this.pendingInteriors.delete(key);
      })
      .catch((err) => {
        this.pendingInteriors.delete(key);
        if (import.meta.env?.DEV) {
          console.warn('Failed to build delve interior:', moduleId, 'at', ox, oz, err);
        }
      });
  }

  /** Build every module in a delve run at its stacked z offset (parallel async). */
  private buildAllDelveModules(
    delveId: string,
    slot: number,
    origin: { x: number; z: number },
    modules: readonly DelveModuleId[],
  ): void {
    void ensureDelveInteriorKit().catch(() => undefined);
    for (let mi = 0; mi < modules.length; mi++) {
      const moduleId = modules[mi];
      const key = `delve:${delveId}:${slot}:${moduleId}`;
      if (this.builtInteriors.has(key) || this.pendingInteriors.has(key)) continue;
      const zOff = delveModuleZOffset(modules, mi);
      this.scheduleDelveModuleBuild(key, moduleId, origin.x, origin.z + zOff);
    }
  }

  /** Prebuild the full module stack when a delve run starts (offline + online). */
  private prebuildDelveInteriors(delveId: string): void {
    const run = this.sim.delveRun;
    if (!run || run.delveId !== delveId || !run.modules.length) return;
    this.buildAllDelveModules(delveId, run.slot, run.origin, run.modules as DelveModuleId[]);
  }

  private ensureDelveInteriorsNear(px: number, pz: number): void {
    const delve = delveAt(px);
    if (!delve) return;
    const run = this.sim.delveRun;
    const modules = (
      run?.delveId === delve.id && run.modules.length ? run.modules : defaultDelveModules(delve.id)
    ) as DelveModuleId[];
    const slot = run?.delveId === delve.id ? run.slot : delveSlotAt(delve.index, pz, modules);
    const origin = run?.delveId === delve.id ? run.origin : delveOrigin(delve.index, slot);
    // Slot origins are 500u apart on z; nearest-slot heuristics mis-pick slot 1+
    // once the player advances past module 1 (interiors build at the wrong oz).
    if (Math.abs(px - origin.x) >= 120) return;
    const stackEndZ = origin.z + delveModuleStackEndRelZ(modules);
    if (pz < origin.z + DELVE_MODULE_Z_START - 30 || pz > stackEndZ) return;
    this.buildAllDelveModules(delve.id, slot, origin, modules);
  }

  // Which futuristic sky this practice bout flies: hashed off the match id so it
  // feels random and stays stable for the whole bout (a new bout, a new sky).
  private practiceSkyVariant(): number {
    const id = this.sim.cupInfo?.match?.id ?? 0;
    return ((id * 2654435761) >>> 0) % this.valeCupSky.variantCount;
  }

  private updateAmbience(px: number, camY: number, dt: number): void {
    const inside = px > DUNGEON_X_THRESHOLD;
    const pz = this.sim.player.pos.z;
    // Private Vale Cup practice instance: the pitch sits far out in an instance
    // band (which would otherwise read as a delve), so give it its own futuristic
    // skybox + matching fog instead of the delve murk. Detected by the match's
    // non-zero pitch origin (the real Sowfield match is {0,0}).
    const po = this.sim.cupInfo?.match?.origin;
    const inPractice = !!po && (po.x !== 0 || po.z !== 0);
    if (inPractice) {
      const idx = this.practiceSkyVariant();
      this.valeCupSky.setVariant(idx);
      this.valeCupSky.mesh.position.copy(this.camera.position);
      this.valeCupSky.mesh.visible = true;
    } else {
      this.valeCupSky.mesh.visible = false;
    }
    if (isDelvePos(px) && !inPractice) {
      this.ensureDelveInteriorsNear(px, pz);
    } else if (inside && isYumiMazePos(px)) {
      // build the Protect Yumi maze copy the player was matched into; the
      // update() call each frame lives in sync() (beacon anchors)
      for (let i = 0; i < YUMI_MAZE_SLOT_COUNT; i++) {
        if (this.yumiMazeViews.has(i)) continue;
        const o = yumiMazeOrigin(i);
        if (Math.abs(px - o.x) < 200 && Math.abs(pz - o.z) < 120) {
          const view = buildYumiMaze(o, this.sim.cfg.seed, {
            flames: this.flames,
            fireLights: this.fireLights,
            lowGfx: this.lowGfx,
          });
          this.scene.add(view.group);
          this.yumiMazeViews.set(i, view);
        }
      }
    } else if (inside && isArenaPos(px)) {
      void ensureDungeonAssets().catch(() => undefined);
      // build the Ashen Coliseum copy the player was matched into
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
    const inDelve = inside && isDelvePos(px);
    const inYumiMaze = inside && isYumiMazePos(px);
    const interior =
      inside && !inDelve && !inYumiMaze && !isArenaPos(px) ? dungeonAt(px)?.interior : null;
    const inTemple = interior === 'temple';
    const inNythraxis = interior === 'nythraxis';
    const desired = inPractice
      ? 'practice'
      : inDelve
        ? 'delve'
        : inYumiMaze
          ? 'yumiMaze'
          : inTemple
            ? 'temple'
            : inNythraxis
              ? 'nythraxis'
              : inside
                ? 'dungeon'
                : camY < waterLevelAt(px, pz) - 0.05
                  ? 'underwater'
                  : 'outdoor';
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
      } else if (desired === 'delve') {
        // the collapsed reliquary breathes a warm ember murk, dried-blood
        // charcoal, tighter than the overworld crypt's cold near-black, so the
        // delve reads as its own claustrophobic place under the red torches
        fog.color.setHex(0x0e0705);
        fog.near = 14;
        fog.far = 74;
      } else if (desired === 'yumiMaze') {
        // the Protect Yumi maze is a COMPETITIVE arena: a lighter night-blue
        // murk pushed well past the ~90yd footprint, so the torches + team
        // beacons read across the maze instead of dissolving mid-corridor
        fog.color.setHex(0x161d31);
        fog.near = 30;
        fog.far = 170;
      } else if (desired === 'practice') {
        // The private practice pitch under its futuristic sky: tint the fog to
        // the sky variant and push it well back so the pitch reads clear and lit
        // (NOT the delve murk this instance band would otherwise get).
        fog.color.setHex(this.valeCupSky.fogFor(this.practiceSkyVariant()));
        fog.near = 60;
        fog.far = 420;
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
        const mazeNight = desired === 'yumiMaze';
        const underground =
          desired === 'dungeon' ||
          desired === 'temple' ||
          desired === 'nythraxis' ||
          desired === 'delve';
        this.sun.intensity = mazeNight
          ? YUMI_MAZE_SUN_INTENSITY
          : underground
            ? DUNGEON_SUN_INTENSITY
            : SUN_INTENSITY;
        this.hemi.intensity = mazeNight
          ? YUMI_MAZE_HEMI_INTENSITY
          : underground
            ? DUNGEON_HEMI_INTENSITY
            : HEMI_INTENSITY;
        this.scene.environmentIntensity = mazeNight
          ? YUMI_MAZE_ENV_INTENSITY
          : underground
            ? DUNGEON_ENV_INTENSITY
            : this.envOutdoorIntensity;
        sharedUniforms.uRimBoost.value = mazeNight
          ? YUMI_MAZE_RIM_BOOST
          : underground
            ? DUNGEON_RIM_BOOST
            : 1;
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
      this.scene.environment = this.envRTs.get(dominant)?.texture ?? null;
      this.scene.environmentRotation.y = this.skyView.envRotationY(dominant);
      this.scene.environmentIntensity = this.envOutdoorIntensity * 0.4;
    }
    const k = 1 - Math.exp(-dt * 1.5);
    this.scene.environmentIntensity +=
      (this.envOutdoorIntensity - this.scene.environmentIntensity) * k;
  }

  // Drop the view of an entity that left the world / our interest area.
  private removeView(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.group);
    this.lightOwnerGroups.delete(v.group);
    if (v.viewLights.length > 0) {
      for (const light of v.viewLights) {
        const i = this.viewLights.indexOf(light);
        if (i >= 0) this.viewLights.splice(i, 1);
      }
      this.lightRankDirty = true;
    }
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
      v.fireballTravelVisual?.dispose();
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
        if (v.portal && !isSharedMaterial(v.portal.material as THREE.Material))
          (v.portal.material as THREE.Material).dispose();
      }
    }
    v.iceBlockVisual?.dispose();
    v.temporalHourglassVisual?.dispose();
    v.frostNovaRootVisual?.dispose();
    v.mageBarrierVisual?.dispose();
    this.views.delete(id);
  }

  // Build the dev-only Tab-target overlay. Called once from main.ts when
  // ?targetcone=1 is set; the flared-cone half-angle function, near radius, and
  // query radius are injected so this module never imports the sim targeting
  // code. Idempotent. Draws a filled flared near-radius cone (idle cluster), its
  // outline, and a full query-radius rim (absolute Tab range; engaged enemies
  // inside the cone reach out to here).
  enableTargetConeDebug(
    halfAt: (d: number) => number,
    nearRadius: number,
    queryRadius: number,
  ): void {
    if (this.targetCone) return;
    const fan = buildFlaredConeFan(nearRadius, halfAt, 16, 48);
    const worldXYZ = new Float32Array(fan.vertexCount * 3);
    // Wrap the array by reference (not Float32BufferAttribute, which copies) so
    // re-draping worldXYZ each frame writes straight into the uploaded buffer.
    const pos = new THREE.BufferAttribute(worldXYZ, 3);
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', pos);
    fillGeo.setIndex(new THREE.BufferAttribute(fan.index, 1));
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x49c0ff,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.frustumCulled = false; // re-draped every frame; its bounds go stale
    // Outline: a LineLoop over the flared perimeter (left edge -> outer arc ->
    // right edge), sharing the position buffer so one update moves fill and edge.
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', pos);
    lineGeo.setIndex(new THREE.BufferAttribute(fan.outline, 1));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x9be0ff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const outline = new THREE.LineLoop(lineGeo, lineMat);
    outline.frustumCulled = false;
    // Query-radius rim: a full circle at max Tab range, in a contrasting amber so
    // it reads apart from the blue cone.
    const ringXZ = buildRingXZ(queryRadius, 96);
    const ringWorldXYZ = new Float32Array((ringXZ.length / 2) * 3);
    const ringPos = new THREE.BufferAttribute(ringWorldXYZ, 3);
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', ringPos);
    const ringMat = new THREE.LineBasicMaterial({
      color: 0xffb24d,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const ring = new THREE.LineLoop(ringGeo, ringMat);
    ring.frustumCulled = false;
    const group = new THREE.Group();
    group.add(fill);
    group.add(outline);
    group.add(ring);
    setRenderCategory(group, 'ui3d');
    group.visible = false;
    this.scene.add(group);
    this.targetCone = { group, pos, localXZ: fan.localXZ, worldXYZ, ringPos, ringXZ, ringWorldXYZ };
  }

  sync(
    alpha: number,
    dt: number,
    renderFacingOverride: number | null,
    selfAlphaLead = 0,
    selfMotion: SelfMotionFrame | null = null,
  ): void {
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
    for (const [id, remaining] of this.waterJetVisualChannels) {
      const next = remaining - dt;
      if (next <= 0) this.waterJetVisualChannels.delete(id);
      else this.waterJetVisualChannels.set(id, next);
    }
    const sim = this.sim;
    const p = sim.player;
    if (this.lastSelfId !== p.id) {
      this.lastSelfId = p.id;
      this.selfRenderPositionReady = false;
      this.selfFacingOverride = null;
      this.selfFacingLastTarget = null;
      // A still-decaying predictor-handoff offset belongs to the previous
      // character; leaking it would displace the new one for a few frames.
      this.selfMotionOffset.set(0, 0, 0);
    }
    const now = performance.now();
    this.viewCreateRetry.prune(now, sim.entities);
    const selfPos = this.updateSelfRenderPosition(alpha, dt, selfAlphaLead, selfMotion);
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
      if (
        !e ||
        (!isPersistentPortalObject(e) &&
          id !== p.id &&
          id !== p.targetId &&
          distSqXZ(e, p) > ENTITY_VIEW_DESTROY_RANGE_SQ)
      ) {
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
      this.cullViewProj.multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      );
      this.cullFrustum.setFromProjectionMatrix(this.cullViewProj);
    }

    // Crowd-adaptive LOD/shadow distances, derived from last frame's visible-rig
    // count (the one-frame lag is imperceptible); recount as we go this frame.
    const crowdScaleSq = crowdLodScaleSq(this.lastVisibleRigCount);
    const lodRangeSq = ENTITY_LOD_RANGE_SQ * crowdScaleSq;
    const shadowRangeSq = ENTITY_SHADOW_RANGE_SQ * crowdScaleSq;
    const midAnimCadenceFrames = midAnimCadence(this.lastVisibleRigCount);
    let visibleRigCount = 0;

    for (const [id, v] of this.views) {
      const e = sim.entities.get(id);
      if (!e) continue;
      // form swaps (polymorph sheep, druid forms) — computed up front because
      // the shadow gates below must not run the base rig's proxy under a form.
      // One pass over the aura list instead of six .some() scans per entity per
      // frame; the flag combination below preserves the original precedence.
      let hasPoly = false;
      let hasBear = false;
      let hasGhostWolf = false;
      let hasCatForm = false;
      let hasTravelForm = false;
      let hasFireballForm = false;
      let hasStealth = false;
      let hasShadowform = false;
      let hasMoonkin = false;
      let hasMetamorph = false;
      let hasIceBlock = false;
      let temporalHourglassMode: TemporalHourglassMode | null = null;
      let hasFrostNovaRoot = false;
      let mageBarrierState: MageBarrierState | null = null;
      for (const a of e.auras) {
        if (a.kind === 'polymorph') hasPoly = true;
        if (a.kind === 'form_bear') hasBear = true;
        if (a.id === 'ghost_wolf') hasGhostWolf = true;
        if (a.kind === 'form_cat') hasCatForm = true;
        if (a.kind === 'form_travel') hasTravelForm = true;
        if (a.kind === 'form_fireball') hasFireballForm = true;
        if (a.kind === 'stealth') hasStealth = true;
        if (a.kind === 'form_shadow') hasShadowform = true;
        if (a.kind === 'form_moonkin') hasMoonkin = true;
        if (a.kind === 'form_metamorph') hasMetamorph = true;
        if (a.id === 'ice_block' && a.kind === 'stasis') hasIceBlock = true;
        // Rime Snare victims wear the same ice shell (maintainer request);
        // the freeze aura is already wired, so this is render-only sugar.
        if (a.id === 'frost_trap_freeze') hasIceBlock = true;
        if (a.id === 'temporal_hourglass') {
          if (a.kind === 'stasis') temporalHourglassMode = 'protective';
          if (a.kind === 'incapacitate') temporalHourglassMode = 'hostile';
        }
        if (isFrostNovaRootAura(a)) hasFrostNovaRoot = true;
        mageBarrierState ??= mageBarrierStateForAura(a, this.mageBarrierStateScratch);
      }
      const polyed = hasPoly;
      const bear = !polyed && hasBear;
      const ghostWolf = !polyed && !bear && hasGhostWolf;
      const cat = !polyed && !bear && (ghostWolf || hasCatForm);
      const travel = !polyed && !bear && !cat && hasTravelForm;
      const fireballForm = !polyed && !bear && !cat && !travel && hasFireballForm;
      const _stealthed = hasStealth;
      // distance cull: far rigs are invisible specks but cost real draw calls
      const cdx = e.pos.x - p.pos.x,
        cdz = e.pos.z - p.pos.z;
      const d2 = cdx * cdx + cdz * cdz;
      const isSelf = id === p.id;
      if (isSelf) {
        v.group.visible = true;
        v.isFar = false;
        v.visual?.setShadow(true);
        v.visual?.setProxyShadow(false);
      }
      if (id !== p.id) {
        // Per-frame visibility uses the SAME 80/96 hysteresis as view
        // create/destroy (above) so a rig hovering right at the 80yd draw edge
        // doesn't toggle visible/invisible every frame — that hard cutoff is the
        // actual on-screen boundary flicker. group.visible carries last frame's
        // state: once shown, keep it until past the 96yd destroy radius (where
        // the view is torn down anyway); while hidden, show only within 80yd.
        const showCutoff = v.group.visible
          ? ENTITY_VIEW_DESTROY_RANGE_SQ
          : ENTITY_VIEW_CREATE_RANGE_SQ;
        if (d2 > showCutoff) {
          v.group.visible = false;
          continue;
        }
        // hidden until its shaders finish linking off-thread (async-compile gate);
        // the object branch below may still re-hide loot
        v.group.visible = !v.compilePending;
        // The graveyard resurrection angel is present only to a released spirit: hide
        // it from the living local player. It stays in the sim for the ghost and for
        // server-side resurrect-range checks, and other ghosts still see it. The
        // continue also skips its holy shimmer and ghost pass below.
        if (e.templateId === 'spirit_healer' && !p.ghost) {
          v.group.visible = false;
          continue;
        }
        // mid-distance rigs keep rendering but leave the shadow pass
        const wantShadow = d2 < shadowRangeSq;
        const inProxyBand = d2 < ENTITY_PROXY_SHADOW_RANGE_SQ;
        if (v.visual) {
          visibleRigCount++; // crowd-density signal for next frame's adaptive LOD
          v.visual.setShadow(wantShadow);
          v.isFar = d2 > lodRangeSq;
          // past the articulated gate the static-pose proxy carries the
          // shadow; an active form's own rig keeps casting instead
          v.visual.setProxyShadow(
            !wantShadow && inProxyBand && !polyed && !bear && !cat && !travel && !fireballForm,
          );
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
      // freezing and dashing once per update. The self position comes from
      // selfPos below, so the self `ea` drives only the model FACING: cap it
      // at 1 like the camera follow does (extrapolating angles past the
      // snapshot oscillates, and a lead-extrapolated yaw target overshoots
      // every mirrored facing step and yanks a locally-held model out and
      // back). Facing needs no latency lead anyway: every self-driven heading
      // change is covered at zero latency by the local layers (the keyboard
      // turn stream, mouselook, click-move via the sent facing). Remote
      // entities interpolate on their own measured cadence via
      // remoteEntityAlpha (unknown-cadence fallback).
      const ea = isSelf
        ? Math.min(1, alpha)
        : remoteEntityAlpha(now, e.netUpdatedAt, e.netInterval, alpha);
      const x = isSelf ? selfPos.x : e.prevPos.x + (e.pos.x - e.prevPos.x) * ea;
      const y = isSelf ? selfPos.y : e.prevPos.y + (e.pos.y - e.prevPos.y) * ea;
      const z = isSelf ? selfPos.z : e.prevPos.z + (e.pos.z - e.prevPos.z) * ea;
      v.group.position.set(x, y, z);
      let facing = e.prevFacing + shortestAngle(e.prevFacing, e.facing) * facingAlpha(ea);
      if (id === p.id && renderFacingOverride !== null) {
        // Follow the camera-driven heading, easing in the one-time engage gap
        // (up to 180deg when engaging after an orbit) under the rate limiter
        // while applying the camera's ongoing rotation 1:1. Seed the model and
        // the last-target from the current values on first engage so the whole
        // seed gap is treated as residual and a fast flick never trails behind.
        const prevModel = this.selfFacingOverride ?? facing;
        const lastTarget = this.selfFacingLastTarget ?? renderFacingOverride;
        facing = advanceSelfFacing(prevModel, renderFacingOverride, lastTarget, dt);
        this.selfFacingOverride = facing;
        this.selfFacingLastTarget = renderFacingOverride;
      } else if (id === p.id && this.selfFacingOverride !== null) {
        // Disengage frame: route the return to the interpolated sim facing
        // through the SAME rate limiter so releasing mouselook mid-flick (before
        // the model caught up to the camera) rotates back smoothly instead of
        // snapping. Hold the override until it has converged onto the sim facing.
        const r = releaseSelfFacing(this.selfFacingOverride, facing, dt);
        facing = r.facing;
        this.selfFacingOverride = r.done ? null : r.facing;
        this.selfFacingLastTarget = r.lastTarget;
      }
      v.group.rotation.y = facing;

      if (e.kind === 'object') {
        // The sim swaps delve interactable templates in place (pressure plate ->
        // triggered, bell rope -> pulled). Rebuild the view from the new template
        // right here rather than leaving it to the budgeted create pass: that
        // pass never collects past the create radius, so a bare remove could
        // strand the object invisible through the whole 80-96yd hysteresis band
        // if the viewer retreats before the rebuild lands.
        if (v.builtTemplateId !== undefined && v.builtTemplateId !== e.templateId) {
          this.removeView(id);
          this.createView(e);
          continue;
        }
        const isPortalObject = isPersistentPortalObject(e);
        const vis = syncDelveInteractableVisibility(
          v.group,
          e.templateId,
          e.lootable,
          !isPortalObject || d2 <= ENTITY_VIEW_CREATE_RANGE_SQ,
        );
        if (v.sparkle && vis) {
          // sub-pixel beyond ~45u but still a full transparent draw each
          // (d2 is this entity's player distance, computed once above)
          v.sparkle.visible = d2 < SPARKLE_DRAW_RANGE_SQ;
          const pulse = 0.75 + Math.sin(this.time * 3 + e.id) * 0.25;
          v.sparkle.scale.set(pulse, pulse, 1);
          v.sparkle.material.rotation = this.time * 0.8;
        }
        if (
          vis &&
          (e.objectItemId === 'bastion_ward_stone' || e.objectItemId === 'soulshard_pillar') &&
          e.auras.some((a) => a.id === 'nythraxis_wardstone_lit')
        ) {
          this.vfx.castSparkle(e.id, 'arcane', dt * 2.6);
        }
        if (v.portal && vis) {
          v.portal.rotation.z = this.time * 1.4;
          (v.portal.material as THREE.MeshBasicMaterial).opacity =
            0.45 + Math.sin(this.time * 2.2 + e.id) * 0.15;
        }
        if (vis && e.templateId === 'mailbox') {
          // The unread-mail votive: per-viewer beacon driven by the IWorld
          // mirror (a cheap field online, a small filter offline; <=4 pillars).
          const glow = v.group.userData.mailGlow as THREE.Object3D | undefined;
          if (glow) {
            const lit = this.sim.mailUnread > 0;
            glow.visible = lit;
            if (lit) glow.position.y = 1.56 + Math.sin(this.time * 2.4 + e.id) * 0.06;
          }
        }
        continue;
      }
      if (e.templateId === VALE_CUP_BALL_TEMPLATE) {
        // bespoke ball motion (roll + contact shadow + dust); no rig to animate
        this.updateValeCupBall(e, v, dt);
        continue;
      }
      if (!v.visual) continue;
      v.iceBlockVisual = syncIceBlockVisual(v.iceBlockVisual, v.group, v.height, hasIceBlock, dt);
      v.temporalHourglassVisual = syncTemporalHourglassVisual(
        v.temporalHourglassVisual,
        v.group,
        temporalHourglassMode,
        dt,
        v.height,
      );
      v.frostNovaRootVisual = syncFrostNovaRootVisual(
        v.frostNovaRootVisual,
        v.group,
        v.height,
        hasFrostNovaRoot,
        dt,
      );
      v.mageBarrierVisual = syncMageBarrierVisual(
        v.mageBarrierVisual,
        v.group,
        v.height,
        mageBarrierState,
        dt,
      );
      const iceBlockActivated = v.iceBlockVisual?.activatedThisFrame === true;

      this.updateBaseVisual(e, v);
      if (!v.visual) continue;
      if (iceBlockActivated) this.activeVisual(v)?.playEmote('wave', 1);

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
      if (e.skin !== v.skin) {
        v.skin = e.skin;
        v.visual.setSkin(e.skin);
      }

      // live held-weapon swap — equipped mainhand changed (self equip or a peer's
      // gear update); setWeapon no-ops on classes with a fixed weapon (hunter)
      if (e.mainhandItemId !== v.mainhandItemId) {
        v.mainhandItemId = e.mainhandItemId;
        v.visual.setWeapon(e.mainhandItemId);
        this.reconcileViewLights(v);
      }

      if (e.offhandItemId !== v.offhandItemId) {
        v.offhandItemId = e.offhandItemId;
        v.visual.setOffhand(e.offhandItemId);
        this.reconcileViewLights(v);
      }

      // live weapon-skin swap: a Season 1 Armory cosmetic applied/detached (self
      // or a peer, via the identity wire); replaces the held model + rarity VFX
      if (e.weaponSkinId !== v.weaponSkinId) {
        v.weaponSkinId = e.weaponSkinId;
        v.visual.setWeaponSkin(e.weaponSkinId);
        this.reconcileViewLights(v);
      }
      v.visual.setWeaponAura(characterSanguineAuraActive(e));

      // live sheathe toggle (Z key): the sim's weaponStowed bit moves held
      // props between the hands and the on-back pose (self or a peer)
      if (e.weaponStowed !== v.weaponStowed) {
        v.weaponStowed = e.weaponStowed;
        v.visual.setWeaponStowed(e.weaponStowed);
      }

      // live body-size buffs (Fiesta power-ups): scale the whole group so the
      // rig, click proxy, and any form visual grow/shrink together.
      if (e.scale !== v.liveScale) {
        v.liveScale = e.scale;
        v.group.scale.setScalar(e.scale);
      }

      // swimming pose: prone at the surface (derived here — the sim is unaware).
      // waterLevelAt is -Infinity outside a declared lake, so the cheap feet-depth
      // test also gates entities standing in a dry sunken feature: they can't be
      // swimming there, and the vast majority (everyone on land) skip
      // groundHeight() entirely each frame.
      const wl = waterLevelAt(e.pos.x, e.pos.z);
      const swimming =
        !e.dead &&
        e.pos.y <= wl - 0.5 &&
        groundHeight(e.pos.x, e.pos.z, this.sim.cfg.seed) < wl - 0.8;

      // lazy form visuals, swapped by visibility like the old sheep/bear rigs
      // A null build leaves the field unset; the shared gate retries after its cooldown.
      if (polyed && !v.sheepVisual) {
        const built = this.createCharacterVisualWithRetry(e, 'form_sheep', 'form_sheep');
        if (built) {
          v.sheepVisual = built;
          v.group.add(built.root); // group.scale already carries e.scale
        }
      }
      if (bear && !v.bearVisual) {
        const built = this.createCharacterVisualWithRetry(e, 'form_bear', 'form_bear');
        if (built) {
          v.bearVisual = built;
          v.group.add(built.root);
        }
      }
      if (cat && !v.catVisual) {
        const built = this.createCharacterVisualWithRetry(e, 'form_cat', 'form_cat');
        if (built) {
          v.catVisual = built;
          v.group.add(built.root);
        }
      }
      if (travel && !v.travelVisual) {
        const built = this.createCharacterVisualWithRetry(e, 'form_travel', 'form_travel');
        if (built) {
          v.travelVisual = built;
          v.group.add(built.root);
        }
      }
      if (v.sheepVisual) v.sheepVisual.root.visible = polyed;
      if (v.bearVisual) v.bearVisual.root.visible = bear;
      if (v.catVisual) v.catVisual.root.visible = cat;
      if (v.travelVisual) v.travelVisual.root.visible = travel;
      const active =
        polyed && v.sheepVisual
          ? v.sheepVisual
          : bear && v.bearVisual
            ? v.bearVisual
            : cat && v.catVisual
              ? v.catVisual
              : travel && v.travelVisual
                ? v.travelVisual
                : v.visual;
      const ghost =
        ghostWolf ||
        shouldRenderStealthGhost(this.sim.playerId, e) ||
        e.templateId.startsWith('vision_') ||
        e.ghost || // a released player spirit renders translucent (the ghost run)
        e.templateId === 'spirit_healer'; // the graveyard angel is an ethereal figure
      active.setGhost(ghost);
      active.setSoulRend(characterSoulRendActive(e));
      // Shadowform tints the base priest rig shadow-purple (no rig swap). Moonkin Form and
      // Metamorphosis reuse the same tint treatment (a bright violet, and a dark fel demon);
      // Metamorphosis also grows the body via Entity.scale in the sim.
      active.setShadowform(hasShadowform);
      active.setMoonkin(hasMoonkin);
      active.setMetamorph(hasMetamorph);
      v.visual.root.visible = active === v.visual && !fireballForm;
      // distant rigs swap to the single-draw baked idle-pose mesh
      v.visual.setFar(v.isFar && active === v.visual && !fireballForm);

      // animation state machine inputs, derived from render-space motion with
      // hysteresis so a one-frame speed dip can't reset the walk clip.
      // The local player's anim samples whatever pose the MESH shows. While
      // the self-motion predictor is active that is the predicted display pose
      // (x/y/z = selfPos): it is continuous by construction, it starts and
      // stops the run clip the same frame the mesh moves, and under load
      // hitches (bursty snapshots at world entry) it stays smooth while the
      // authoritative interp stair-steps, which used to feed the cadence
      // erratic velocities and reset the walk clip. On the lead-smoothing
      // fallback path the plain interpolated sim motion is still sampled
      // instead (that path's smoothed selfPos stutters within a snapshot
      // interval). Offline, all of these are the same value.
      const animFromDisplay = isSelf && this.selfMotionActive;
      const ax = isSelf && !animFromDisplay ? e.prevPos.x + (e.pos.x - e.prevPos.x) * alpha : x;
      const ay = isSelf && !animFromDisplay ? e.prevPos.y + (e.pos.y - e.prevPos.y) * alpha : y;
      const az = isSelf && !animFromDisplay ? e.prevPos.z + (e.pos.z - e.prevPos.z) * alpha : z;
      const vx = ax - v.lastX,
        vz = az - v.lastZ;
      v.lastX = ax;
      v.lastZ = az;
      const loco = updateLocomotion(v.loco, vx, vz, facing, dt);
      const moving = loco.moving;
      v.fireballTravelVisual = syncFireballTravelVisual(
        v.fireballTravelVisual,
        v.group,
        fireballForm && charOnScreen,
        dt,
        THREE.MathUtils.clamp(loco.speed / 9.8, 0, 1),
        isSelf || !v.isFar,
      );
      // A released spirit is `dead` but should stand and run, not lie prone, so it
      // animates as a living figure (only its translucent ghost material marks it).
      const visuallyDead = isVisuallyDead(e) && !e.ghost;
      // `onGround` is authoritative offline but is never sent in online snapshots
      // (ClientWorld defaults it to true), so for players fall back to deriving the
      // airborne state from foot height vs terrain — keeps the jump pose working in
      // both worlds without a wire change. Gated to players (only they jump) to keep
      // the extra groundHeight sample off the hot path for mobs/NPCs.
      // The local player uses the predictor's kernel onGround when it is active:
      // exact physics state, coherent with the displayed pose by construction.
      // The heuristic is debounced over 2 frames: snapshot bursts during load
      // hitches transiently lift the sampled pose off the terrain, and a
      // single-frame false positive flips the base state to `jump` and back,
      // replaying the jump clip's crouch (the world-entry anim glitch).
      if (
        e.kind === 'player' &&
        e.onGround &&
        !swimming &&
        ay - groundHeight(ax, az, this.sim.cfg.seed) > AIRBORNE_EPS
      ) {
        v.airborneHeurFrames++;
      } else {
        v.airborneHeurFrames = 0;
      }
      const airborne =
        !visuallyDead &&
        !swimming &&
        (animFromDisplay && this.selfMotionPredictor
          ? !this.selfMotionPredictor.onGround
          : !e.onGround || v.airborneHeurFrames >= 2);
      const st = this.animScratch;
      st.speed = loco.speed;
      st.moving = moving;
      st.running = loco.running;
      st.airborne = airborne;
      st.backwards = loco.backwards;
      st.reverseBackpedal = ghostWolf;
      st.dead = visuallyDead;
      const waterJetVisualChannel = this.waterJetVisualChannels.has(e.id);
      st.casting = (e.castingAbility !== null || waterJetVisualChannel) && !visuallyDead;
      st.spinning =
        st.casting &&
        e.castingAbility !== null &&
        ABILITIES[e.castingAbility]?.selfCentered === true;
      st.swimming = swimming;
      st.sitting = e.kind === 'player' && (e.sitting || e.eating !== null || e.drinking !== null);
      // --- spatial movement audio (self + others) --------------------------
      // All gated by audibility (squared distance) so far entities cost nothing.
      const sink = this.audioSink;
      if (sink && d2 < SFX_MOVE_RANGE_SQ) {
        // jump / land / water-entry edges
        if (airborne && !v.wasAirborne && !visuallyDead) sink.movement('jump', ax, ay, az, isSelf);
        else if (!airborne && v.wasAirborne && !visuallyDead)
          sink.movement('land', ax, ay, az, isSelf);
        if (swimming && !v.wasSwimming && !visuallyDead)
          sink.movement('splash', ax, ay, az, isSelf);
        // footfalls / swim strokes via a distance accumulator (no timers)
        if (visuallyDead || st.sitting) {
          v.stepAccum = 0;
        } else if (swimming) {
          v.stepAccum += loco.speed * dt;
          if (v.stepAccum >= SWIM_STRIDE) {
            v.stepAccum = 0;
            sink.movement('swim', ax, ay, az, isSelf);
          }
        } else if (moving && !airborne) {
          v.stepAccum += loco.speed * dt;
          const stride = loco.speed >= FOOT_RUN_SPEED ? FOOT_STRIDE_RUN : FOOT_STRIDE_WALK;
          if (v.stepAccum >= stride) {
            v.stepAccum = 0;
            sink.footstep(
              ax,
              ay,
              az,
              this.surfaceAt(ax, az, ay),
              loco.speed >= FOOT_RUN_SPEED,
              isSelf,
            );
          }
        } else {
          // standing still — prime the accumulator so the first step after moving
          // lands promptly rather than after a full stride of travel.
          v.stepAccum = FOOT_STRIDE_WALK * 0.6;
        }
      }
      v.wasAirborne = airborne;
      v.wasSwimming = swimming;
      // Distance-tiered mixer updates: near = every frame, mid = every Nth,
      // far (static LOD mesh visible) = every 6th; edges latch regardless.
      // Both the near band and the mid cadence follow the same crowd-adaptive
      // LOD the shadow bands use, because sampling clips + rebuilding bone
      // matrices is the per-rig cost that actually scales with the crowd.
      //
      // Animation smoothness is cosmetic, but a cast windup is a telegraph the
      // player reacts to, so the local player, the current target, and anything
      // mid-cast always animate every frame no matter how dense the crowd.
      let animate = true;
      if (!animatesEveryFrame(id, p.id, p.targetId, e.castingAbility)) {
        if (v.isFar) animate = (this.frameIdx + e.id) % 6 === 0;
        else if (d2 > shadowRangeSq) animate = (this.frameIdx + e.id) % midAnimCadenceFrames === 0;
      }
      active.update(dt, st, animate);
      // weapon-skin VFX ride the humanoid rig's held weapon; advancing them is a
      // few uniform writes per handle, so they stay smooth at every LOD tier
      v.visual.updateWeaponVfx(dt);
      // The sheathe swap is deferred to the gesture midpoint, so the rig (and any
      // skin VFX point light on it) is rebuilt inside update(), not at the diff.
      if (v.visual.consumeWeaponGraphDirty()) this.reconcileViewLights(v);

      const emoteId =
        e.kind === 'player' && e.overheadEmoteId && !e.dead ? e.overheadEmoteId : null;
      const emoteKey = emoteId ? `${emoteId}:${e.overheadEmoteSeq}` : null;
      if (emoteKey !== v.lastOverheadEmoteKey) {
        const canPlayEmote =
          emoteId && !moving && !st.airborne && !st.swimming && !st.casting && !st.sitting;
        if (canPlayEmote) {
          active.playEmote(emoteId);
          v.lastOverheadEmoteKey = emoteKey;
        } else if (!emoteId) {
          v.lastOverheadEmoteKey = null;
        }
      }

      if (st.casting) {
        this.vfx.castSparkle(
          e.id,
          waterJetVisualChannel
            ? 'frost'
            : e.castingAbility === 'demon_heal'
              ? 'shadow'
              : (ABILITIES[e.castingAbility!]?.school ?? 'arcane'),
          dt,
        );
      }
      if (e.auras.some((a) => a.id === 'nythraxis_soul_rend')) {
        this.vfx.castSparkle(e.id, 'shadow', dt * 3.2);
      }
      if (characterRecklessnessActive(e)) {
        this.vfx.recklessFlame(e.id, dt);
        if (!v.recklessOn) {
          v.recklessOn = true;
          this.recklessSkulls.spawn(v.group, active.height * e.scale);
        }
      } else if (v.recklessOn) {
        v.recklessOn = false;
      }
      // Shapeshift-form particle auras riding the tints above: metamorph fire,
      // moonkin star motes, shadowform gloom wisps. Suppressed for the dead
      // (the auras themselves drop, but a corpse must not smolder for a frame).
      if (!e.dead) {
        if (hasMetamorph) this.vfx.formAura(e.id, 'metamorph', dt);
        else if (hasMoonkin) this.vfx.formAura(e.id, 'moonkin', dt);
        else if (hasShadowform) this.vfx.formAura(e.id, 'shadowform', dt);
      }
      // The graveyard angel: a soft, constant golden shimmer rising off the Spirit Healer.
      if (e.templateId === 'spirit_healer') this.vfx.castSparkle(e.id, 'holy', dt * 0.6);
      if (swimming) this.vfx.swimRipple(v.group.position, moving ? dt * 3 : dt);

      // skip the draw for off-screen rigs (pose/audio above already ran)
      if (!charOnScreen) v.group.visible = false;
    }
    this.lastVisibleRigCount = visibleRigCount;

    // Hidden views skip their whole matrix subtree: three recomposes even
    // invisible hierarchies, and a distance-culled or off-screen rig is 30-60
    // nodes of dead per-frame compose+multiply. Re-showing flips the gate back
    // on, and the next scene update revisits the subtree and recomposes it
    // from the live position/rotation properties, so nothing renders stale.
    // (pick() skips hidden views, so a frozen matrix never ghosts a hitbox.
    // CAUTION: getWorldPosition on a node inside a GATED subtree does not heal
    // the chain in r165, hence the light-owner exemption; any new world-space
    // read of a view child must use group.position or exempt the view too.)
    for (const [, v] of this.views) {
      v.group.matrixWorldAutoUpdate = v.group.visible || this.lightOwnerGroups.has(v.group);
    }

    // selection ring
    const target = p.targetId !== null ? sim.entities.get(p.targetId) : null;
    if (target) {
      const tv = this.views.get(target.id);
      if (tv) {
        const cx = tv.group.position.x;
        const cz = tv.group.position.z;
        // anchor the reticle to the ground under the unit (a classic decal: it
        // stays grounded even if the target jumps) and drape it over the slope.
        // The drape is a pure function of (cx, cz, scale) and nothing else writes
        // the ring's position attribute, so a stationary target reuses last
        // frame's per-vertex groundHeight samples untouched.
        if (cx !== this.selRingX || cz !== this.selRingZ || target.scale !== this.selRingScale) {
          this.selRingX = cx;
          this.selRingZ = cz;
          this.selRingScale = target.scale;
          const seed = this.sim.cfg.seed;
          const gy = groundHeight(cx, cz, seed);
          this.selectionRing.position.set(cx, gy, cz);
          this.selectionRing.scale.setScalar(target.scale);
          const drape = drapeRingLocalY(
            this.selectionRingLocalXZ,
            cx,
            cz,
            gy,
            target.scale,
            0.08,
            (sx, sz) => groundHeight(sx, sz, seed),
            this.selectionRingDrapeY,
          );
          const ringPos = this.selectionRingMesh.geometry.getAttribute(
            'position',
          ) as THREE.BufferAttribute;
          for (let i = 0; i < drape.length; i++) ringPos.setY(i, drape[i]);
          ringPos.needsUpdate = true;
          this.selectionRingTicks.position.y = 0.08; // ticks float just above the footing
        }
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
    this.updateAoeRings(dt);
    this.recklessSkulls.update(dt);
    this.updateGroundAimReticle(dt);
    // dev-only Tab-target cone overlay: re-drape the front cone on the terrain
    // under the local player, oriented to the model's rendered facing.
    if (this.targetCone) {
      if (p.dead) {
        this.targetCone.group.visible = false;
      } else {
        const seed = this.sim.cfg.seed;
        const lv = this.views.get(p.id);
        const facing = lv ? lv.group.rotation.y : p.facing;
        const sample = (sx: number, sz: number): number => groundHeight(sx, sz, seed);
        drapeConeWorld(
          this.targetCone.localXZ,
          selfPos.x,
          selfPos.z,
          facing,
          0.07,
          sample,
          this.targetCone.worldXYZ,
        );
        this.targetCone.pos.needsUpdate = true;
        // The rim is a full circle, so facing is irrelevant: drape it with 0.
        drapeConeWorld(
          this.targetCone.ringXZ,
          selfPos.x,
          selfPos.z,
          0,
          0.07,
          sample,
          this.targetCone.ringWorldXYZ,
        );
        this.targetCone.ringPos.needsUpdate = true;
        this.targetCone.group.visible = true;
      }
    }
    markPhase('entities');

    // Corpse beacon: a soft light pillar over the local player's body while their
    // spirit runs back to it (the ghost run). Built once, then just repositioned.
    {
      const self = this.sim.player;
      const corpse = self?.dead && self.ghost ? self.corpsePos : null;
      if (corpse) {
        if (!this.corpseBeacon) {
          const geo = new THREE.CylinderGeometry(0.25, 0.25, 14, 8, 1, true);
          const mat = new THREE.MeshBasicMaterial({
            color: 0xbfe6ff,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          });
          this.corpseBeacon = new THREE.Mesh(geo, mat);
          this.corpseBeacon.renderOrder = 2;
          this.scene.add(this.corpseBeacon);
        }
        this.corpseBeacon.visible = true;
        this.corpseBeacon.position.set(corpse.x, corpse.y + 7, corpse.z);
      } else if (this.corpseBeacon) {
        this.corpseBeacon.visible = false;
      }
    }

    let worldStart = performance.now();

    // fire flicker + rising embers
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const fl =
        0.85 + Math.sin(this.time * 9 + i * 2.4) * 0.12 + Math.sin(this.time * 23 + i) * 0.06;
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
        const along =
          ((cl.position.x - this.camera.position.x) * this.sunAzimuth.x +
            (cl.position.z - this.camera.position.z) * this.sunAzimuth.z) /
          320;
        const t = Math.max(-1, Math.min(1, along)) * 0.5 + 0.5;
        (cl.material as THREE.SpriteMaterial).color.setRGB(
          0.86 + 0.14 * t,
          0.9 + 0.05 * t,
          1.0 - 0.13 * t,
        );
      }
    }
    worldStart = markWorldPhase('clouds', worldStart);

    // water shimmer (low-tier texture scroll; shader water rides uTime)
    this.waterView.update(this.time);
    worldStart = markWorldPhase('water', worldStart);
    this.vfx.update(dt);
    this.frozenOrbFx.update(dt);
    this.mageGroundFx.update(dt);
    this.ringOfFrostVisuals.sync(this.sim.activeFrostRings);
    this.ringOfFrostVisuals.update(dt);
    this.temporalHourglassGroundVisuals.sync(this.sim.activeTemporalHourglasses);
    this.temporalHourglassGroundVisuals.update(dt);
    this.glacialFrontVisual.updateCharge(p, dt, groundHeight(p.pos.x, p.pos.z, this.sim.cfg.seed));
    this.glacialFrontVisual.update(dt);
    this.lightPulses.update(dt);
    this.updateFiestaRing(dt);
    this.updateFiestaPowerups(dt);
    this.tickFiestaGlows(dt);
    for (const view of this.yumiMazeViews.values()) view.update(this.sim);
    this.yumiTeamMarkers.update(this.sim, this.views);
    this.tickValeCupFx(dt);
    worldStart = markWorldPhase('vfx', worldStart);

    this.updateCamera(selfPos, dt);
    worldStart = markWorldPhase('camera', worldStart);
    // Fully-fogged terrain chunks / tree buckets are dropped before the
    // frustum; camera-ghost props hide against the current eye-to-camera ray.
    const fogFar = (this.scene.fog as THREE.Fog).far;
    this.terrainView.update(this.camera.position.x, this.camera.position.z, fogFar);
    worldStart = markWorldPhase('terrain', worldStart);
    this.propsView.update(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      this.cameraLookAt.x,
      this.cameraLookAt.y,
      this.cameraLookAt.z,
      fogFar,
    );
    this.dungeons?.update(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      this.cameraLookAt.x,
      this.cameraLookAt.y,
      this.cameraLookAt.z,
    );
    worldStart = markWorldPhase('props', worldStart);
    this.foliage.update(
      p.pos.x,
      p.pos.z,
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      this.cameraLookAt.x,
      this.cameraLookAt.y,
      this.cameraLookAt.z,
      fogFar,
    );
    worldStart = markWorldPhase('foliage', worldStart);
    this.fish.update(p.pos.x, p.pos.z, dt);
    this.critters.update(p.pos.x, p.pos.z, dt);
    this.motes.update(p.pos.x, p.pos.z, dt);
    this.birds.update(p.pos.x, p.pos.z, dt);
    this.impactSite.update(p.pos.x, p.pos.z, dt);
    // null-safe cupInfo read: the offline Sim may predate the Vale Cup module
    this.valeCupStadium.update(p.pos.x, p.pos.z, dt, this.sim.cupInfo ?? null);
    // Team rings ride the live entity views (positions are fresh: the entity loop
    // ran above). Reads cupInfo.match for a participant, else cupInfo.spectate (a
    // nearby walk-up at the Sowfield): the sim only fills spectate near the field,
    // so the rings self-gate to the stadium. The online mirror works the same.
    this.valeCupTeamRings.update(
      this.sim.cupInfo?.match ?? this.sim.cupInfo?.spectate ?? null,
      this.time,
      dt,
      this.lowGfx,
      this.groundSample,
      this.views,
    );
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
    // Static-preset tiered cadence: the nameplate refresh interval follows
    // the player's chosen graphics tier (the data-fx-level the preset applier
    // stamps), NEVER the FPS governor (the two-controller rule). The
    // LOW tier runs 1/15s, richer tiers 1/24s. The axis is the PRESET, not the device:
    // the weak-GPU cost ceiling (the PR901 lesson) is restored through the device-aware
    // first-run default (resolveDefaultGraphicsPreset in gfx.ts), which lands a
    // recognized-weak or software GPU on the LOW preset (its 1/15s ceiling) while a
    // mid/unknown device defaults to medium (1/24s). An explicit player preset wins.
    const nameplateInterval = nameplateIntervalSec(
      coerceFxTier(document.documentElement.dataset.fxLevel),
    );
    const fullNameplatePass = this.nameplateTimer >= nameplateInterval;
    if (fullNameplatePass) this.nameplateTimer = 0;
    this.nameplatePainter.update(fullNameplatePass);
    this.updateChatBubbles();
    markPhase('nameplates');
    this.updateTravelSpeedFx(p, selfPos, dt);
    // Fiesta screen shake: trauma^2 jitter offsets the camera for the draw only.
    let shakeX = 0,
      shakeY = 0;
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
    if (shakeX !== 0 || shakeY !== 0) {
      this.camera.position.x -= shakeX;
      this.camera.position.y -= shakeY;
    }
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

  // Drive the travel-form speed-illusion overlay. Presentation only: gated on the
  // LOCAL player being shifted into travel form AND actually moving, with the
  // intensity scaled by real ground speed. Honors prefers-reduced-motion. The
  // streak/vignette math lives in the pure core (travel_speed_fx.ts); this only
  // derives the speed and forwards a target intensity to the painter.
  private updateTravelSpeedFx(p: Entity, selfPos: THREE.Vector3, dt: number): void {
    // Measure ground speed from the SAME interpolated self render position the
    // camera uses (selfPos), advanced per render frame, so the cue tracks the
    // smooth on-screen motion rather than the raw 20Hz sim-tick snapping of p.pos.
    let speed = 0;
    const last = this.lastLocalPos;
    if (last && dt > 0) {
      speed = Math.hypot(selfPos.x - last.x, selfPos.z - last.z) / dt;
    }
    if (this.lastLocalPos) {
      this.lastLocalPos.x = selfPos.x;
      this.lastLocalPos.z = selfPos.z;
    } else {
      this.lastLocalPos = { x: selfPos.x, z: selfPos.z };
    }
    const inTravelForm = p.auras.some((a) => a.kind === 'form_travel');
    const target = targetIntensity({ inTravelForm, speed, reducedMotion: this.reducedMotion() });
    this.travelSpeedFx.update(target, dt);
  }

  private reducedMotion(): boolean {
    return this.reduceMotionMql?.matches ?? false;
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
  // Rank entries are pooled (extended only when interiors or view lights change).
  // Static world positions stay cached; moving weapon VFX refresh into their
  // existing vectors, so this hot loop allocates nothing.
  private budgetFireLights(px: number, pz: number): void {
    const ranked = this.lightRank;
    // Rank the union of static fire lights AND entity-view lights (e.g. quest-object
    // glows). Both must share one budget: if a view light were counted separately,
    // numPointLights would change as it streams in/out and recompile every lit
    // material. Rebuild only when the set changes (dirty), or when fire lights grow
    // (dungeon interiors push to fireLights) - both rare, so the hot path just
    // refreshes distances. Static positions are cached; dynamic weapon-light
    // positions refresh in applyPointLightBudget.
    const want = this.fireLights.length + this.viewLights.length;
    if (this.lightRankDirty || ranked.length !== want) {
      ranked.length = 0;
      for (const light of this.fireLights) {
        ranked.push({
          light,
          d2: 0,
          worldPos: light.getWorldPosition(new THREE.Vector3()),
          base: null,
          dynamic: false,
        });
      }
      for (const light of this.viewLights) {
        const stored = light.userData.budgetBase;
        const base = typeof stored === 'number' ? stored : light.intensity;
        const dynamic = light.userData.budgetDynamic === true;
        ranked.push({
          light,
          d2: 0,
          worldPos: light.getWorldPosition(new THREE.Vector3()),
          base: dynamic ? null : base,
          dynamic,
        });
      }
      this.lightRankDirty = false;
    }
    // Keep a CONSTANT number of point lights `visible` so numPointLights in every
    // material's program cache key never changes as the player travels. Three counts
    // a light into numPointLights iff `visible` (intensity is irrelevant to the
    // count), so toggling visibility as campfires budget in/out used to recompile
    // every nearby material 0<->maxPointLights times - the dominant open-world travel
    // freeze. Now the nearest maxPointLights lights stay visible (one stable program
    // per material); lights past the live budget or out of range simply contribute
    // nothing (intensity 0). maxPointLights is the per-tier constant, so the live
    // governor (effectivePointLights) only changes how many SHINE, not the count.
    const visibleCount = GFX.maxPointLights;
    const liveBudget = this.effectivePointLights || GFX.maxPointLights;
    applyPointLightBudget(ranked, px, pz, visibleCount, liveBudget, LIGHT_BUDGET_RANGE_SQ);
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
      sp.position
        .copy(this.camera.position)
        .addScaledVector(sunAzimuth, 48 + i * 26)
        .addScaledVector(side, (i - 1) * 30 + sway);
      sp.position.y = this.camera.position.y + 16 + i * 7;
      sp.material.opacity = facing * facing * facing * (0.3 - i * 0.05);
    }
  }

  private updateSelfRenderPosition(
    alpha: number,
    dt: number,
    selfAlphaLead: number,
    selfMotion: SelfMotionFrame | null = null,
  ): THREE.Vector3 {
    const p = this.sim.player;
    // Online intent-driven extrapolation: when active it owns the position and
    // the lead-smoothing path below becomes the fallback (both write the same
    // selfRenderPosition, so enable/disable hands off without a pop, absorbed
    // by the snap/smooth rules on the next frame).
    if (selfMotion) {
      if (!this.selfMotionPredictor) {
        this.selfMotionPredictor = new SelfMotionPredictor(this.sim.cfg.seed);
      }
      const predicted = this.selfMotionPredictor.step(p, selfMotion);
      if (predicted) {
        // Follow the predictor output exactly (it is already continuous;
        // smoothing it again would re-add the display lag this exists to
        // remove). The only discontinuity is the handoff frame from the
        // lead-smoothing path below: capture that gap once as an offset and
        // decay it, so the camera glides instead of stepping.
        if (this.selfRenderPositionReady && !this.selfMotionActive) {
          this.selfMotionOffset.set(
            this.selfRenderPosition.x - predicted.x,
            this.selfRenderPosition.y - predicted.y,
            this.selfRenderPosition.z - predicted.z,
          );
        }
        this.selfMotionOffset.multiplyScalar(Math.exp(-SELF_MOTION_HANDOFF_RATE * Math.max(0, dt)));
        this.selfRenderPosition.set(
          predicted.x + this.selfMotionOffset.x,
          predicted.y + this.selfMotionOffset.y,
          predicted.z + this.selfMotionOffset.z,
        );
        this.selfRenderPositionReady = true;
        this.selfMotionActive = true;
        return this.selfRenderPosition;
      }
    }
    this.selfMotionActive = false;
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

  // ---- Map-editor 3D seams (editor-only) --------------------------------

  /** The terrain chunk group, for the editor to raycast/rebuild. */
  get terrainGroup(): THREE.Group {
    return this.terrainView.group;
  }

  /**
   * Raycast a screen point onto the actual terrain surface (follows sculpted
   * height), returning the world hit point, or null. Falls back to the y=0 plane
   * past the built terrain footprint. Editor-only (3D in-world editing).
   */
  surfacePoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const ndc = new THREE.Vector2(
      (clientX / this.viewport.width) * 2 - 1,
      -(clientY / this.viewport.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.terrainView.group.children, false);
    if (hits.length > 0 && hits[0].point) return hits[0].point.clone();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, pt) ? pt : null;
  }

  /**
   * Re-mesh the terrain from the current active world content (after a sculpt or
   * biome-paint edit). With a `region` (world-space bounds of the edit), only the
   * chunks intersecting it re-mesh in place (cheap enough for a live brush drag);
   * the macro normal map is left stale until rebakeTerrainNormals at stroke end.
   * Without one it is the full rebuild (map load): dispose the old chunk
   * geometries and the one shared material (and its build-specific normal map)
   * exactly once, but never the shared splat/detail textures. Editor-only.
   */
  rebuildTerrain(region?: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    if (region) {
      this.terrainView.rebuildRegion(region.minX, region.minZ, region.maxX, region.maxZ);
      return;
    }
    this.terrainView.cancelStreaming();
    const old = this.terrainView.group;
    this.scene.remove(old);
    const firstMesh = old.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
    const sharedMat = firstMesh?.material as THREE.Material | THREE.Material[] | undefined;
    old.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    const disposeMat = (mat: THREE.Material): void => {
      const withMap = mat as THREE.Material & { normalMap?: THREE.Texture | null };
      withMap.normalMap?.dispose();
      mat.dispose();
    };
    if (Array.isArray(sharedMat)) sharedMat.forEach(disposeMat);
    else if (sharedMat) disposeMat(sharedMat);
    this.terrainView = buildTerrain(this.sim.cfg.seed);
    setRenderCategory(this.terrainView.group, 'terrain');
    this.scene.add(this.terrainView.group);
  }

  /**
   * Rebake the macro normal DataTexture over the edited region (the per-pixel
   * relief that goes stale after a sculpt). Debounce to stroke END in the
   * editor: it re-uploads the texture, so never call it per drag sample.
   * Editor-only.
   */
  rebakeTerrainNormals(region: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    this.terrainView.rebakeNormalRegion(region.minX, region.minZ, region.maxX, region.maxZ);
  }

  /**
   * Re-seat the water surface at the ACTIVE waterLevel() and recompute the
   * shoreline depth attribute from the current terrain (after a water-level
   * edit or a shoreline sculpt). A cheap in-place update: it does NOT change
   * which lakes exist or where they are, only their shared level/shore depth.
   * Editor-only.
   */
  rebuildWater(): void {
    this.waterView.setLevel();
  }

  /**
   * Full water rebuild: dispose every existing lake mesh and rebuild from the
   * CURRENT `waterBodies()` (declared lake list). Needed after the editor adds,
   * removes, or moves a lake marker: `rebuildWater()` only reseats existing
   * meshes in place, so a moved marker would otherwise leave the water mesh,
   * shader `uCenter`/`uRadius`, and shore-depth attribute at the OLD footprint
   * while the terrain basin itself has already moved. Editor-only.
   */
  rebuildWaterBodies(): void {
    for (const mesh of this.waterView.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    }
    this.waterView = buildWater(this.sim.cfg.seed);
    for (const mesh of this.waterView.meshes) {
      setRenderCategory(mesh, 'water');
      this.scene.add(mesh);
      freezeStaticMatrices(mesh);
    }
  }

  /**
   * Project the editor brush ring onto the terrain at world (x, z). Uniform
   * writes only; call per pointer-move. Editor-only.
   */
  setEditorBrush(x: number, z: number, radius: number, color?: THREE.ColorRepresentation): void {
    this.terrainView.setBrush(x, z, radius, color);
  }

  /** Hide the editor brush ring. Editor-only. */
  clearEditorBrush(): void {
    this.terrainView.clearBrush();
  }

  /**
   * The placed-GLB-asset view for live editing (add/move/remove/select/reSeat/
   * footprints). Created lazily so a map that starts with zero placements still
   * gets a live view; the shipped game never calls this. Editor-only.
   */
  get placedAssets(): PlacedAssetsView {
    if (!this.placedAssetsView) {
      this.placedAssetsView = new PlacedAssetsView([], this.sim.cfg.seed);
      setRenderCategory(this.placedAssetsView.group, 'props');
      this.scene.add(this.placedAssetsView.group);
    }
    return this.placedAssetsView;
  }

  private updateCamera(selfPos: THREE.Vector3, dt: number): void {
    // Map-editor free camera: use the editor pose verbatim and skip the entire
    // player-chase + occlusion path. Every camera-relative cull in sync() then
    // runs off this free camera with no other change.
    if (this.editorCam) {
      this.camera.position.copy(this.editorCam.pos);
      this.cameraLookAt.copy(this.editorCam.target);
      if (Math.abs(this.camera.fov - CAMERA_BASE_FOV) > 0.01) {
        this.camera.fov = CAMERA_BASE_FOV;
        this.camera.updateProjectionMatrix();
      }
      this.camera.lookAt(this.cameraLookAt);
      this.camera.updateMatrixWorld();
      return;
    }
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
      // Thread the active run's module chain so camera collision matches the
      // delve's actual (possibly Heroic/varied) layout, not just the default.
      const delveMods = this.sim.delveRun?.modules;
      let hardT = cameraOcclusion(seed, px, eyeY, pz, cx, cy, cz, CAMERA_COLLIDER_PAD, delveMods);
      let softT = cameraOcclusion(
        seed,
        px,
        eyeY,
        pz,
        cx,
        cy,
        cz,
        CAMERA_SOFT_COLLIDER_PAD,
        delveMods,
      );
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
      const cpx = this.camera.position.x,
        cpy = this.camera.position.y,
        cpz = this.camera.position.z;
      const fx = px - cpx,
        fy = eyeY - cpy,
        fz = pz - cpz;
      const fl = Math.hypot(fx, fy, fz) || 1;
      sink.setListener(cpx, cpy, cpz, fx / fl, fy / fl, fz / fl);
      const inDungeon = px > DUNGEON_X_THRESHOLD;
      const biome = zoneBiomeAt(pz);
      const precip =
        !this.weatherOn || inDungeon
          ? null
          : biome === 'peaks'
            ? 'snow'
            : biome === 'marsh'
              ? 'rain'
              : null;
      // Only at the water's edge / in it — sampled at the player, so a loose
      // threshold made the loop bleed across the low marsh from far off.
      const nearWater = !inDungeon && groundHeight(px, pz, seed) < waterLevelAt(px, pz) + 0.4;
      // Sowfield crowd bed: murmurs near the ground, swells while a match is
      // live (cupInfo is the IWorld mirror, so this works online too).
      const crowd = crowdAmbienceAt(px, pz, inDungeon, !!this.sim.cupInfo?.live);
      sink.ambience(biome, inDungeon, precip, nearWater, crowd, this.ambientPointSources);
    }
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
      if (this.tmpV.z < -1 || this.tmpV.z > 1) {
        b.el.style.display = 'none';
        continue;
      }
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

  // Click/tap-to-harvest (#1866): raycasts the static gather-node meshes
  // (`gatherNodeMeshes`, tagged with `userData.gatherNodeId` in
  // src/render/gather_nodes.ts) and returns the hit node's content id, or null.
  // A separate method from `pick()` on purpose: nodes are static content keyed
  // by string id, not entities keyed by numeric id, so widening `pick()`'s
  // return contract would force every existing caller to re-discriminate.
  pickGatherNode(clientX: number, clientY: number): string | null {
    const ndc = new THREE.Vector2(
      (clientX / this.viewport.width) * 2 - 1,
      -(clientY / this.viewport.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.gatherNodeMeshes, true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (typeof o.userData.gatherNodeId === 'string') return o.userData.gatherNodeId as string;
        o = o.parent;
      }
    }
    return null;
  }

  pick(clientX: number, clientY: number): number | null {
    const direct = this.pickDirect(clientX, clientY);
    if (direct !== null) return direct;
    return this.pickSloppy(clientX, clientY);
  }

  // The direct-raycast half of pick(): only a hit that actually lands on an
  // entity's mesh. Split out so callers that also raycast gather nodes (a
  // click that lands on a node must not be stolen by the sloppy assist below)
  // can slot the node raycast in between this and pickSloppy.
  pickDirect(clientX: number, clientY: number): number | null {
    const ndc = new THREE.Vector2(
      (clientX / this.viewport.width) * 2 - 1,
      -(clientY / this.viewport.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.clickTargets, true);
    const directHitIds: number[] = [];
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (o.userData.entityId !== undefined && o.userData.entityId !== this.sim.playerId) {
          const id = o.userData.entityId as number;
          // a hidden view is not clickable: the player cannot see it, and its
          // matrixWorld is frozen while hidden (the rig gate in sync), so a hit
          // against it would be a ghost hitbox at the hide-time position
          const hitView = this.views.get(id);
          if (hitView && !hitView.group.visible) break;
          const e = this.sim.entities.get(id);
          // The graveyard angel is hidden from the living, so it must not be
          // click-pickable either (the capsule proxy ignores `visible`): skip it
          // unless the local player is a released spirit.
          if (e?.templateId === 'spirit_healer' && !this.sim.player?.ghost) break;
          directHitIds.push(id);
          break;
        }
        o = o.parent;
      }
    }
    if (directHitIds.length === 0) return null;
    return resolveDirectPickEntityId(directHitIds, this.sim.entities, this.sim.player.targetId);
  }

  // The forgiving-assist half of pick(): snap to the nearest targetable
  // character within a small screen radius when nothing was hit directly.
  pickSloppy(clientX: number, clientY: number): number | null {
    // Forgiving assist: nothing under the ray, so snap to the nearest
    // targetable character within a small screen radius — chibi proportions
    // and melee scrums (often hidden behind the player's own model) make
    // precise capsule clicks fiddly. Objects (doors/loot) still need a
    // direct hit; the local player never competes for the click.
    //
    // Each candidate is a vertical screen COLUMN from the body midpoint up to an
    // overhead anchor a touch above the head (the +1.0 the chat-bubble path uses;
    // slightly higher than the nameplate's own NAMEPLATE_ANCHOR_LIFT of 0.8, which
    // with the 26px radius just helps the column reach the floating name text).
    // So a click on the floating name (what a healer does to target a party
    // member) registers on its owner instead of falling outside a body-only radius.
    const SLOPPY_PICK_PX = 26;
    const candidates = this.sloppyCandidates;
    candidates.length = 0;
    for (const [id, v] of this.views) {
      if (id === this.sim.playerId || !v.visual || !v.group.visible) continue;
      const e = this.sim.entities.get(id);
      if (!e || (e.kind === 'mob' && e.dead && !e.lootable)) continue;
      // A lying corpse (dead + lootable) has no upright body: collapse its sloppy
      // column to a ground-level point so a near-eye click above/behind the flat
      // body no longer snaps to it (issue 1486). Like the flattened pick proxy, this
      // sheds the upright column; the exact drop is approximate (a ground-level
      // anchor inside the 26px assist radius is all this path needs), not a parity
      // match of the proxy's min(standHeight, radius*2) height.
      const dead = !!e.dead;
      // body midpoint anchor (also the in-front-of-camera cull); ground-hug if dead
      this.tmpV.copy(v.group.position);
      this.tmpV.y += v.height * e.scale * (dead ? 0.15 : 0.5);
      this.tmpV.project(this.camera);
      if (this.tmpV.z > 1) continue;
      const midX = (this.tmpV.x * 0.5 + 0.5) * this.viewport.width;
      const midY = (-this.tmpV.y * 0.5 + 0.5) * this.viewport.height;
      // Overhead anchor (the +1.0 chat-bubble offset, see the note above).
      // Collapse the column to the body point if the anchor is not safely in
      // front of the camera: a point behind the near plane projects to bogus
      // screen coords that could steal an unrelated click (close / first-person
      // camera puts the head behind the near plane). Same guard the real
      // nameplate path uses before trusting its projection. A dead corpse has no
      // overhead column at all, so keep top == mid (the ground point).
      let topX = midX;
      let topY = midY;
      if (!dead) {
        this.tmpV2.copy(v.group.position);
        this.tmpV2.y += v.height * e.scale + 1.0;
        if (isProjectedNameplateAnchorVisible(this.camera, this.tmpV2, this.tmpV3)) {
          this.tmpV2.project(this.camera);
          if (this.tmpV2.z <= 1) {
            topX = (this.tmpV2.x * 0.5 + 0.5) * this.viewport.width;
            topY = (-this.tmpV2.y * 0.5 + 0.5) * this.viewport.height;
          }
        }
      }
      candidates.push({ id, midX, midY, topX, topY });
    }
    return nearestSloppyPickId(clientX, clientY, candidates, SLOPPY_PICK_PX);
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
      if (!a.active) {
        slot.group.visible = false;
        continue;
      }
      slot.ring.scale.setScalar(a.ringScale);
      slot.ringMat.opacity = a.ringAlpha;
      slot.cross.scale.setScalar(a.crossScale);
      slot.crossMat.opacity = a.crossAlpha;
    }
  }

  // Flash a school-colored AoE ring on the terrain at a ground-targeted blast's
  // landing spot, sized to the blast radius (see aoe_ring.ts for the curves).
  spawnAoeRing(x: number, z: number, radius: number, school: string, colorHex?: number): void {
    if (this.aoeRings.length === 0) return;
    const slot = this.aoeRings[this.aoeRingNext];
    this.aoeRingNext = (this.aoeRingNext + 1) % this.aoeRings.length;
    const y = groundHeight(x, z, this.sim.cfg.seed) + 0.12; // lift to avoid z-fighting
    slot.ring.position.set(x, y, z);
    slot.radius = radius;
    slot.elapsed = 0;
    slot.mat.color.setHex(colorHex ?? SCHOOL_COLORS[school] ?? 0xffffff);
    if (!this.lowGfx) slot.mat.color.multiplyScalar(SELECTION_RING_BOOST);
    slot.ring.visible = true;
  }

  setGroundAimReticle(
    aim: { x: number; z: number; radius: number; school: string; dimmed: boolean } | null,
  ): void {
    this.groundAimReticle.setAim(
      aim
        ? {
            x: aim.x,
            z: aim.z,
            radius: aim.radius,
            color: SCHOOL_COLORS[aim.school] ?? 0xffffff,
            dimmed: aim.dimmed,
          }
        : null,
    );
  }

  private updateAoeRings(dt: number): void {
    for (const slot of this.aoeRings) {
      if (slot.elapsed >= AOE_RING_LIFETIME) continue;
      slot.elapsed += dt;
      const a = aoeRingAnim(slot.elapsed);
      if (!a.active) {
        slot.ring.visible = false;
        continue;
      }
      slot.ring.scale.setScalar(slot.radius * a.ringScale);
      slot.mat.opacity = a.ringAlpha;
    }
  }

  private updateGroundAimReticle(dt: number): void {
    this.groundAimReticle.update(dt);
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
