import * as THREE from 'three';
import { NumberSampleRing } from '../game/sample_ring';
import { coerceFxTier, nameplateIntervalSec } from '../game/ui_tier_knobs';
import { supportHeightAt } from '../sim/colliders';
import {
  ABILITIES,
  ARENA_SLOT_COUNT,
  arenaOrigin,
  CAMPS,
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
  isRiftPos,
  isYumiMazePos,
  MOBS,
  NPCS,
  YUMI_MAZE_SLOT_COUNT,
  yumiMazeOrigin,
  ZONES,
  zoneAt,
} from '../sim/data';
import type { DelveModuleId } from '../sim/delve_layout';
import { generateRiftFloor, riftLiftAt } from '../sim/rift/rift_gen';
import type { BiomeId, ZoneDef } from '../sim/types';
import { ALL_CLASSES, type Entity, type SimEvent } from '../sim/types';
import { isAtSowfield } from '../sim/vale_cup_layout';
import { groundHeight, waterLevelAt, zoneBiomeAt } from '../sim/world';
import { attachAvatarFallback } from '../ui/avatar_fallback';
import type { ChatBubbleStyle } from '../ui/chat_bubble_style';
import { tEntity } from '../ui/entity_i18n';
import type { IWorld } from '../world_api';
import { AbilityVfx, AbilityVfxFx } from './ability_vfx';
import { ABILITY_VFX_FULL_SPECS } from './ability_vfx_full_specs';
import { ABILITY_VFX_SPECS } from './ability_vfx_specs';
import { type AmberFeaturesView, buildAmberFeatures } from './amber_features';
import { isVisuallyDead } from './anim_state';
import { AOE_RING_LIFETIME, aoeRingAnim } from './aoe_ring';
import { formatResidencyBudget, residencyBudget } from './assets/residency_budget';
import type { AmbientPointSource, SpatialAudioSink, Surface } from './audio_sink';
import { createBackgroundGpuQueue, GPU_WORK_PRIORITY } from './background_gpu_queue';
import { attachBankerChestToNpcView } from './banker_chest';
import { type BirdsView, buildBirds } from './birds';
import { type BladeGrassView, buildBladeGrass } from './blade_grass';
import { createCameraBoom, stepCameraBoom } from './camera_boom_core';
import {
  cancelCameraDirective,
  createCameraDirector,
  startDeathDrift,
  startVista,
  stepCameraDirector,
} from './camera_director_core';
import {
  cameraFovOffset,
  createCameraFeel,
  punchCameraFov,
  stepCameraFeel,
  stepLandingDetector,
} from './camera_feel_core';
import { canopyDetailPrewarmTextures } from './canopy_detail';
import { buildCastleFeatures, type CastleFeaturesView } from './castle_features';
import { type CharacterWeaponAura, characterWeaponAuraInto } from './character_effects';
import {
  addCharacterEffectAura,
  CHARACTER_EFFECT_RECKLESSNESS,
  CHARACTER_EFFECT_SOUL_REND,
  hasCharacterEffect,
} from './character_effects_core';
import { characterViewOutsideHysteresis } from './character_view_core';
import {
  type AnimState,
  type CharacterVisual,
  createCharacterVisual,
  createMountVisual,
  setWeaponVfxViewportHeight,
} from './characters';
import {
  isSwimmingAtDepth,
  SWIM_ENTER_FEET_DEPTH,
  SWIM_EXIT_FEET_DEPTH,
  shouldTriggerWaterImpact,
  waterContactFrameMode,
} from './characters/anim_state';
import { logAssetMissOnce } from './characters/asset_miss_log';
import {
  characterResidencySources,
  mechAssetsReady,
  mountAssetsReady,
  preloadMechAssets,
  preloadMountAssets,
  preloadTrainingDummyAssets,
  trainingDummyAssetsReady,
} from './characters/assets';
import { skinCount, visualKeyFor } from './characters/manifest';
import {
  playerRangedAttackAlreadyStarted,
  playerRangedAttackStartsAtLaunch,
} from './characters/skin_attack';
import { shouldRetainPooledCharacterVisual } from './characters/visual_pool_policy';
import { attackAbilityId, isSpinAttackAbility } from './characters/weapon_attack_style_core';
import { fogFarForBuiltGround } from './chunk_residency_core';
import { CLICK_MARKER_LIFETIME, clickMarkerAnim, clickMarkerColor } from './click_marker';
import { buildCliffScree, type CliffScreeView } from './cliff_scree';
import { CompileGateQueue, settlePendingSwap } from './compile_gate';
import { preflightWebGL2ContextRecycle, type RecycledRendererContext } from './context_recycle';
import { trackWebGLContext } from './context_release';
import {
  animatesEveryFrame,
  animCadenceFrames,
  type CharacterLodBands,
  characterLodBandsInto,
  crowdLodScaleSq,
  midAnimCadence,
  showsStaticFarMesh,
} from './crowd_lod';
import { daisVisualLift } from './dais_lift';
import { currentDayNightPhase, dayNightPhaseOverride } from './day_night_clock';
import {
  aboveHorizon,
  DAY_ONLY,
  type DayNightGrade,
  dayNightGrade,
  effectiveDayness,
  fullDayGrade,
  globalDayness,
  moonDirection,
  NEUTRAL_DAY_GRADE,
  nightStarAmount,
  REALM_DAYNIGHT_AMPLITUDE,
  sunDirection,
} from './day_night_core';
import { shouldPlayDeedFirework } from './deed_fx_gate';
import { buildDelveModule } from './delve_interiors';
import { buildDelveInteractable, syncDelveInteractableVisibility } from './delve_props';
import { buildDoorBody, buildRiftGateBody, buildRiftPuzzleProp } from './door_portal';
import { createLogicalFrameDrawStats, type LogicalFrameDrawStats } from './draw_stats_core';
import { DungeonInteriors, dungeonDaisHasRaisedPlatform, ensureDungeonAssets } from './dungeon';
import {
  dynamicResolutionAllocationScale,
  dynamicResolutionGovernorRange,
  dynamicResolutionRect,
  MIN_DYNAMIC_RENDER_SCALE,
} from './dynamic_resolution_core';
import { buildEastbrookTownView, type EastbrookTownView } from './eastbrook_town';
import { buildEmberFeatures, type EmberFeaturesView } from './ember_features';
import { objectDisplayName } from './entity_labels';
import { resolveEnvironmentPrefilterPlan } from './env_prefilter_core';
import {
  createEnvironmentMapTransition,
  dampedValue,
  type EnvironmentMapTransition,
  easedFogFar,
  easedFogNear,
  stepEnvironmentMapTransition,
  transitionAlpha,
  ZONE_ENVIRONMENT_RESPONSE,
} from './environment_transition_core';
import { advanceSelfFacing, releaseSelfFacing } from './facing_smooth';
import { buildFarshoreFeatures } from './farshore_features';
import { buildFenFeatures, type FenFeaturesView } from './fen_features';
import { type FireballTravelVisual, syncFireballTravelVisual } from './fireball_travel_visual';
import { buildFish, type FishView } from './fish';
import { FishingBobberVisual } from './fishing_bobber';
import {
  buildFoliage,
  buildFoliageMaterialPrewarmGroup,
  type FoliagePerfStats,
  type FoliageView,
  foliageResidencySources,
} from './foliage';
import {
  type FrostNovaRootVisual,
  isFrostNovaRootAura,
  syncFrostNovaRootVisual,
} from './frost_nova_root_visual';
import { buildFrostSky, type FrostSkyView } from './frost_sky';
import { FrozenOrbFx } from './frozen_orb_fx';
import { buildGaleFeatures, type GaleFeaturesView } from './gale_features';
import { buildGardenFeatures, type GardenFeaturesView } from './garden_features';
import { gardenMazeCameraLift } from './garden_maze_core';
import { buildGatherNodes, type GatherNodesView, resolveGatherNodePick } from './gather_nodes';
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
import { buildGreatTreePrewarmGroup } from './great_tree_prewarm';
import { GroundAimReticleVisual } from './ground_aim_reticle_visual';
import { createGroundTilt, type GroundTiltState, stepGroundTilt } from './ground_tilt_core';
import { buildHauntFeatures, type HauntFeaturesView } from './haunt_features';
import { buildHollowGates } from './hollow_gates';
import { type IceBlockVisual, syncIceBlockVisual } from './ice_block_visual';
import { idleSlot } from './idle_queue';
import { buildImpactSite, type ImpactSiteView, MIREFEN_IMPACT_SITE } from './impact_site';
import { ensureDelveInteriorKit } from './interior_kit';
import { buildJailScene, type JailSceneView } from './jail_scene';
import { buildJungleFeatures, type JungleFeaturesView } from './jungle_features';
import { LightPulses } from './light_pulses';
import {
  type LocoState,
  type LocoTrack,
  newLocoState,
  newLocoTrack,
  updateLocomotionInto,
} from './locomotion';
import {
  type MageBarrierState,
  type MageBarrierVisual,
  mageBarrierStateForAura,
  syncMageBarrierVisual,
} from './mage_barrier_visual';
import { MageGroundFx } from './mage_ground_fx';
import { buildMailboxPillar } from './mailbox';
import { buildMotes, type MotesView } from './motes';
import { MountBeacon } from './mount_beacon';
import { mountBobY, mountVisualSpec } from './mount_visuals';
import { COMBO_PIP_MAX } from './nameplate_combo';
import { NameplatePainter } from './nameplate_painter';
import {
  isProjectedNameplateAnchorVisible,
  nameplateScreenTransform,
} from './nameplate_projection';
import { facingAlpha, remoteEntityAlpha } from './net_interp_core';
import { buildNightFeatures, type NightFeaturesView } from './night_features';
import { buildEastbrookNoticeboard } from './noticeboard';
import {
  type OpaqueSortPolicyInput,
  opaqueFrontToBackSort,
  opaqueMaterialFirstSort,
  shouldUseFrontToBackOpaqueSort,
} from './opaque_draw_order_core';
import { projectionScalePixels } from './perceptual_lod_core';
import { resolveDirectPickEntityId } from './pick_resolution';
import { PlacedAssetsView } from './placed_assets';
import { type PlayerAuraRingInput, PlayerAuraRings } from './player_aura_rings';
import {
  applyPointLightBudget,
  flickerContributingFireLights,
  pointLightPadCount,
  type RankedPointLight,
  reconcileViewPointLights,
} from './point_light_budget';
import { buildComposer, type PostPipeline } from './post';
import {
  boundedPrewarmVisibility,
  runBackgroundPrewarm,
  withHiddenPrewarmGroups,
} from './prewarm_pass';
import {
  constrainedEntryViewCreateBudget,
  interactionLandmarkViewPriority,
  mandatoryLandmarkViewsReady,
  orderedPrewarmIds,
  type PrewarmPolicy,
  partitionMandatoryLandmarkCandidates,
  prewarmBuildDeadline,
  prewarmEntryRuns,
  prewarmEntryShouldDefer,
  remainingPrewarmViewBudget,
  resolvePrewarmPolicy,
} from './prewarm_policy';
import {
  buildPrewarmCompileUnits,
  type PrewarmResumeEntry,
  type PrewarmResumeUnit,
  resumeDroppedPrewarmEntries,
  settlePrewarmBeforePublish,
} from './prewarm_resume';
import { buildPropMaterialPrewarmGroup, buildProps, propResidencySources } from './props';
import { buildGroundQuestObject } from './quest_objects';
import { RaceLine } from './race_line';
import { isOwnedPetHostile } from './reaction';
import { buildRealmFlora, type RealmFloraView } from './realm_flora';
import {
  RenderBudgetGovernor,
  type RenderBudgetSample,
  type RenderBudgetState,
} from './render_budget';
import {
  beginRendererFrameTelemetry,
  type RendererFramePhaseMs,
  type RendererWorldPhaseMs,
} from './renderer_frame_telemetry_core';
import { buildRiftRankBadge } from './rift_rank';
import { RingOfFrostVisuals } from './ring_of_frost_visual';
import {
  captureSceneCensus,
  createHitchTracker,
  type HitchSummary,
  type SceneCensusChild,
  type SceneCensusHost,
  type SceneCensusReport,
} from './scene_census_core';
import { type FlamePerceptualState, updateSceneryFlame } from './scenery_flame';
import { downscaleDims } from './screenshot';
import { drapeRingLocalY } from './selection_ring';
import { type SelfMotionFrame, SelfMotionPredictor, updateSelfRenderFallback } from './self_motion';
import { isSharedGeometry, isSharedMaterial } from './shared_resource';
import {
  buildSky,
  ensureSkyAssetsAt,
  ensureSkyBiomeAssets,
  type SkyKey,
  type SkyView,
} from './sky';
import { nearestSloppyPickId, type SloppyPickCandidate } from './sloppy_pick';
import { freezeStaticMatrices, freezeStaticSubtreeMatrices } from './static_matrix';
import { buildStationProps } from './stations';
import { shouldRenderStealthGhost } from './stealth';
import { createStepSmooth, type StepSmoothState, stepSmoothHeight } from './step_smooth_core';
import { buildFlaredConeFan, buildRingXZ, drapeConeWorld } from './target_cone_debug';
import {
  syncTemporalHourglassVisual,
  TemporalHourglassGroundVisuals,
  type TemporalHourglassMode,
  type TemporalHourglassVisual,
} from './temporal_hourglass_visual';
import { buildTerrain, type TerrainView } from './terrain';
import { uploadDataTextureInChunks } from './texture_upload';
import { sparkleTexture } from './textures';
import { targetIntensityFromValues } from './travel_speed_fx';
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
import {
  finishViewCandidates,
  type ViewCandidate,
  writeViewCandidate,
} from './view_candidate_pool_core';
import { ViewCreateRetryGate } from './view_create_retry';
import { type WarriorCastVisualPlan, warriorCastVisualPlan } from './warrior_cast_fx_core';
import { RecklessSkullPainter } from './warrior_cast_fx_painter';
import { buildWater, type WaterView } from './water';
import { buildWaterFlora } from './water_flora';
import { Weather } from './weather';
import { buildWorldAmbientSources, crowdAmbienceAt, footstepSurfaceAt } from './world_audio';
import { surfaceDetailPrewarmTextures } from './worn_stone';
import { buildYumiMaze, type YumiMazeView } from './yumi_maze';
import { YumiTeamMarkers } from './yumi_team_markers';
import {
  type FeatureFootprint,
  hasUnseededInstanceMatrix,
  isZoneFeatureVisible,
} from './zone_feature_visibility_core';
import {
  INITIAL_SKY_PREWARM_RADIUS,
  MAX_OUTDOOR_FOG_FAR,
  ZONE_STREAM_RECHECK_DISTANCE,
  zoneEntryPoint,
  zonesWithinStreamingHorizon,
} from './zone_streaming';

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
// first in-world frame that needs a program compiles it synchronously, the
// multi-hundred-ms (up to ~1.7s) freeze players feel when new model types
// appear. So the compile step gets its own budget (it normally drains in <~100ms
// with KHR_parallel_shader_compile) rather than racing the leftover view-build
// budget, which could starve it. This threshold is diagnostic only: an async
// compile cannot be cancelled, so returning at the threshold would let it
// overlap later warm units and gameplay.
const PREWARM_COMPILE_MAX_MS = 10000;
// A background prewarm waits for a browser idle slot between its per-group
// compile chunks; the timeout forces progress under sustained frame load.
const IDLE_PREWARM_TIMEOUT_MS = 250;
// Diagnostic threshold for a live async-compile gate. The compile cannot be
// cancelled, so the target remains hidden and the serial gate remains occupied
// until the driver settles instead of overlapping first-draw or later links.
const VIEW_COMPILE_GATE_MAX_MS = 1500;
// Reserve at the tail of the view-build budget so the compile + final-frame
// steps always start before the prewarm deadline (runEntry skips late entries).
const PREWARM_BUILD_RESERVE_MS = 3000;
const VIEW_PREWARM_MAX_VIEWS_LOW = 48;
const VIEW_PREWARM_MAX_VIEWS_HIGH = 72;
// Constrained (phone WebKit): build only self plus one required/nearby view at
// entry. Even when twelve views fit in memory and compile asynchronously, their
// compile gates can resolve together and reveal the whole crowd on the first live
// submit. The retained iPhone probe measured that burst at 1.17s. Remaining views
// stream in through the post-entry one-per-frame budget instead.
const VIEW_PREWARM_MAX_VIEWS_CONSTRAINED = 2;
const VIEW_CREATED_TYPE_SAMPLE_LIMIT = 24;
const PERSISTENT_PORTAL_VIEW_PREWARM_LIMIT = 16;
// rigs further than this stop casting articulated shadows (~7 draws each) and
// hand off to a single-draw static-pose shadow proxy (the merged far-LOD mesh
// with a colorWrite-off material) so mid-ground NPCs keep their grounding for
// ~1/7 the cost, the pose freeze is invisible in a shadow blob this far out
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
// Rift portal-family template ids (module-hoisted: createView is a hot path and
// allocated this Set per view).
const RIFT_PORTAL_IDS = new Set(['rift_portal', 'rift_descent', 'rift_exit']);

const AIRBORNE_EPS = 0.4;
/**
 * Terrain-lean gradient resample interval (seconds) and sample arm (yards).
 * TIME based, not frame based: a frame-count cadence silently starves on a
 * slow client (at 4 fps an "every 4th frame" gradient updates once a second,
 * so the lean never arrives), while a time budget costs the same four terrain
 * samples at 60 fps and self-corrects when frames are scarce. Per body, the
 * phase is staggered by entity id so a crowd never resamples in lockstep.
 */
/**
 * Landing speed (yd/s) below which a touchdown is a step, not an impact. A
 * jump from flat ground lands near 6 yd/s, so this sits under that: catching
 * a boulder part way up the arc, or settling off a kerb, stays a footfall.
 */
const SOFT_LANDING_SPEED = 4.5;
const TILT_SAMPLE_INTERVAL = 0.06;
const TILT_SAMPLE_SPAN = 0.55;
// Beyond this (squared) an entity's footsteps/movement are inaudible, so we skip
// the surface sample + dispatch entirely. Kept under the engine's own cutoff (46u).
const SFX_MOVE_RANGE_SQ = 42 * 42;
// Stride length (world units travelled) between footfalls, longer at a run.
const FOOT_STRIDE_WALK = 0.95;
const FOOT_STRIDE_RUN = 1.55;
// Mount clips contain a full gait beat (usually two contacts), so their cadence
// is intentionally longer than an on-foot stride and leaves the one-shot tail clear.
const MOUNT_STRIDE_RUN = 5.8;
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
// Third-person camera obstruction is opacity-only. Anything registered as a
// hideable crosses the eye-to-camera segment through the shared fade policy.
// The requested chase-camera distance is never changed by scene geometry.
const CAMERA_BASE_FOV = 60;
// Decay rate of the one-time offset captured when the self-motion predictor
// takes over from the lead-smoothing path (gone in ~0.3 s, no camera step).
const SELF_MOTION_HANDOFF_RATE = 15;
// lighting rig (high/ultra): IBL supplies ambient, sun carries the key.
// The key keeps its golden color (full-strength white read as harsh midday
// glare against the sunless realm skies); key up / fill down buys the
// directional contrast, while the sunlit diffuse ceiling stays under the
// post.ts BLOOM_THRESHOLD so only emissives bloom. Intensities only:
// water.ts and sky.ts read the sun direction and their own tint
// independently, so retinting this light seams the shoreline against the
// dome.
// composer tiers get the full key/fill contrast (the grade lifts their
// shadows); without the composer the same fill crushes shaded timber to
// near-black, so non-composer tiers ride a higher floor. The grade-only
// medium tier sits between: its grade supplies the shadow lift but it has
// no AO/bloom softening the extremes.
// Shadow DARKNESS is the other half of felt sunlight: a stronger hemisphere
// plus IBL fill lifted building and hill shadows until they read as
// dirt-colour variation, not shade (BSL-class looks run visibly darker,
// cooler shadow regions). Key up / both fills down buys the contrast.
const HEMI_INTENSITY_COMPOSER = 0.27;
const HEMI_INTENSITY_GRADE = 0.32;
const HEMI_INTENSITY_FLAT = 0.4;
const hemiOutdoorIntensity = (): number =>
  GFX.composer
    ? HEMI_INTENSITY_COMPOSER
    : GFX.gradePass
      ? HEMI_INTENSITY_GRADE
      : HEMI_INTENSITY_FLAT;

const SUN_INTENSITY = 3.5;
const ENV_INTENSITY = 0.37;
// dungeon interiors: kill the daylight so torchlight carries the scene
// (env at 0.15 still lit rigs sky-blue against the pitch-dark crypt)
const DUNGEON_SUN_INTENSITY = 0.34;
const DUNGEON_ENV_INTENSITY = 0.05;
// The authored Infernal Citadel is larger than a procedural floor and carries
// real budgeted brazier lights. A stronger ambient floor preserves the black-red
// infernal grade while keeping its loops, bosses, and doors readable between pools.
const INFERNAL_SUN_INTENSITY = 0.54;
const INFERNAL_HEMI_INTENSITY = 0.32;
const INFERNAL_ENV_INTENSITY = 0.1;
const INFERNAL_RIM_BOOST = 2.15;
// raw HDRI PMREMs integrate the real sun the dome shader clamps away,
// rescale so ambient matches the dome-capture look (see lookdev-hookup.md)
const IBL_RAW_SCALE = 0.55;
const DUNGEON_HEMI_INTENSITY = 0.22; // floor of readability — bosses crushed to black at 0.14
// day/night: at night the key sun and sky bounce cool toward moonlight. These
// are the fully-night blend weights (scaled each frame by the grade's nightAmt).
const MOON_SUN_COLOR = 0x9fb2e0; // pale cool moonlight the warm sun eases toward
const MOON_HEMI_SKY_COLOR = 0x8b9cd0; // cool sky bounce at deepest night
const MOON_HEMI_GROUND_COLOR = 0x2b3350; // dark cool ground bounce at deepest night
const NIGHT_SUN_COOL = 0.55; // how far the sun hue shifts to moonlight at full night
const NIGHT_HEMI_COOL = 0.5; // how far the sky-bounce hue shifts at full night
// golden tone the sun light warms toward, strongest as the sun nears the horizon
const WARM_SUN_COLOR = 0xff8a3a;
// A shared warm daylight bias applied after each biome picks its authored hue.
// Keeping this below 0.2 preserves Frostveil, Wraithwood, and Galecrest as cool
// realms while stopping their HDRI/hemisphere fill from cooling the whole frame.
const WARM_HEMI_SKY_COLOR = 0xffdfbd;
const WARM_HEMI_GROUND_COLOR = 0x725038;
const DAY_HEMI_SKY_WARMTH = 0.18;
const DAY_HEMI_GROUND_WARMTH = 0.13;
// the moving sun/moon key light rides at the same distance the fixed anchor did
const SUN_TRAVEL_DISTANCE = SUN_ANCHOR.length();
// character rim glow scales up underground so silhouettes split from the murk
const DUNGEON_RIM_BOOST = 2.4;
// The Protect Yumi maze is a torch-lit NIGHT ARENA, not a crypt: a moon-key
// plus a healthy hemisphere keep the whole competitive space readable, with
// the braziers/torches adding warmth rather than carrying the scene alone.
const YUMI_MAZE_SUN_INTENSITY = 1.32;
const YUMI_MAZE_HEMI_INTENSITY = 0.38;
const YUMI_MAZE_ENV_INTENSITY = 0.25;
const YUMI_MAZE_RIM_BOOST = 1.7;
const WILDHEART_SUN_INTENSITY = 1.75;
const WILDHEART_HEMI_INTENSITY = 0.59;
const WILDHEART_ENV_INTENSITY = 0.28;
const WILDHEART_RIM_BOOST = 1.5;
// The Last Keep is a LIVED-IN castle interior, not a crypt: a higher, warmed
// ambient floor (over the candle-orange torch lights the interior itself
// carries) so its halls read golden and inhabited while staying indoors-dim.
// Scoped to interior 'lastkeep' only; every other underground interior keeps
// the DUNGEON_* rig.
const LASTKEEP_SUN_INTENSITY = 0.66;
const LASTKEEP_HEMI_INTENSITY = 0.46;
const LASTKEEP_ENV_INTENSITY = 0.14;
const LASTKEEP_RIM_BOOST = 1.9;
const LASTKEEP_SUN_COLOR = 0xffd9a8;
const LASTKEEP_HEMI_SKY_COLOR = 0xffe4c4;
const LASTKEEP_HEMI_GROUND_COLOR = 0x4a3826;
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
  textureUploads: number;
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
  mountVisual: CharacterVisual | null; // rideable mount under a player, built lazily
  mountVisualKey: string; // '' = none; diffed each frame for live mount swaps
  /** world-unit rider saddle lift while mounted (0 dismounted); the nameplate,
   *  chat-bubble, and sloppy-pick overhead anchors add it (scaled by e.scale) */
  mountLift: number;
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
  /** unscaled height, nameplate/vfx anchor reads height * e.scale */
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
  nameplateScreenX: number;
  nameplateScreenY: number;
  nameplateSig: string;
  nameplateStaticName: string;
  nameplateStaticColor: string | null;
  nameplateStaticHpDisplay: string;
  nameplateStaticMarker: string;
  nameplateStaticMarkerClass: string;
  nameplateStaticOpacity: string;
  nameplateStaticFrame: string;
  nameplateStaticGuild: string;
  nameplateStaticDevOutline: string | null;
  nameplateStaticAi: boolean;
  nameplateStaticI18nRevision: number;
  /** Bitset of the last-applied combat-state classes, for per-frame write elision. */
  nameplateStateMask: number;
  /** Last-applied friendly-pet class, diffed separately from the combat-state bitset. */
  nameplateFriendlyPet: boolean;
  nameplateHpWidth: string;
  nameplateHp: number;
  nameplateMaxHp: number;
  titleSig: string; // cheap-diff for the deed-title subtitle (i18n revision|deed id)
  nameplateTitleId: string;
  nameplateTitleI18nRevision: number;
  comboSig: string; // cheap-diff for the combo pip row
  nameplateComboCount: number;
  tierEl: HTMLImageElement; // $WOC holder-tier flair badge (other players)
  tierValue: number; // last-applied holderTier, to diff cheaply
  devTierEl: HTMLImageElement; // developer-badge flair badge (other players)
  devTierValue: number; // last-applied devTier, to diff cheaply
  discordEl: HTMLImageElement; // linked-Discord PFP next to the name (other players)
  discordAvatarSig: string; // last-applied discord avatar URL, to diff cheaply
  aiEl: HTMLSpanElement; // operator-set [AI] account tag, inline before the name
  levelEl: HTMLSpanElement; // mob level badge (e.g. "[5]"), inline before the name; hidden for non-mobs
  levelSig: string; // cheap-diff for the level badge (levelText|color)
  nameplateLevelText: string;
  nameplateLevelColor: string;
  sparkle?: THREE.Sprite; // ground objects
  objectMesh?: THREE.Object3D;
  objectPoolKey: string | null;
  /** templateId the object mesh was built from. The sim swaps delve interactable
   *  templates in place (plate -> triggered, rope -> pulled); diffing this each
   *  frame drops the stale view so it rebuilds with the new mesh. */
  builtTemplateId?: string;
  portal?: THREE.Mesh; // dungeon door swirl
  objectCasters: THREE.Object3D[]; // object/accessory shadow meshes, distance-gated
  viewLights: THREE.PointLight[]; // point lights this view contributes to the budget
  shadowOn: boolean;
  isFar: boolean;
  // hidden until its shader programs finish linking off-thread (async-compile gate)
  compilePending: boolean;
  // Resolves when compilePending clears after the non-cancellable link settles.
  compileReady: Promise<void> | null;
  // A live material-variant swap (gateSwapFlagOnCompile) is still linking off-thread
  // for a target whose .visible the per-frame loop recomputes every tick (the mount
  // root, the base visual root after a skin/visual-key swap): those lines AND this
  // in so a plain hide would not be overwritten later the same frame. See #2571.
  mountCompilePending: boolean;
  visualCompilePending: boolean;
  // Same gate shape as mountCompilePending/visualCompilePending (the lazy form roots'
  // .visible is also recomputed every tick, see the "lazy form visuals" block), but
  // shared across sheep/bear/cat/travel as ONE token instead of four flags: at most
  // one form is ever active or newly built per entity per frame (see the mutually
  // exclusive polyed/bear/cat/travel booleans), so a single field naming the pending
  // form's root, cleared via settlePendingSwap, is enough. See #2571.
  formCompilePending: THREE.Object3D | null;
  lastOverheadEmoteKey: string | null;
  recklessOn?: boolean;
  // render-space position last frame, for true u/s locomotion speed
  lastX: number;
  lastZ: number;
  // locomotion-state hysteresis so a one-frame speed dip can't reset the
  // walk clip (see locomotion.ts)
  loco: LocoTrack;
  locoState: LocoState;
  // spatial-audio state: distance travelled since the last footfall, and edge
  // latches for jump/land/water-entry detection.
  stepAccum: number;
  waterContactSeen: boolean;
  waterContactActive: boolean;
  waterContactX: number;
  waterContactZ: number;
  waterContactAccum: number;
  wasAirborne: boolean;
  wasSwimming: boolean;
  // consecutive frames the foot-height heuristic read airborne (debounce)
  airborneHeurFrames: number;
  // mount summon/dismount transition edge-detects. lastMountKey fires the summon
  // glow when e.mountKey changes (a dedicated tracker: mountVisualKey above lags
  // asset loading). wasMountCasting fires the rider's call pose on the idle ->
  // summoning edge. Both seeded from the entity's current state so an already-
  // mounted login does not flash a spurious glow or pose.
  lastMountKey: string;
  wasMountCasting: boolean;
  /** Display-only vertical smoothing (step-up/step-down presentation). */
  stepSmooth: StepSmoothState;
  /** Previous drawn height, for the display-derived fall speed. */
  prevRenderY: number;
  hasPrevY: boolean;
  /** Peak downward display speed this flight, reset on landing. */
  fallSpeed: number;
  /** Damped terrain lean plus its cadence-sampled gradient. */
  groundTilt: GroundTiltState;
  tiltGradX: number;
  tiltGradZ: number;
  tiltOnProp: boolean;
  /** Countdown to the next gradient resample (seconds). */
  tiltSampleT: number;
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

function summarizeMs(values: number[]): {
  count: number;
  avg: number;
  p95: number;
  max: number;
} {
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
  return {
    setup: 0,
    entities: 0,
    world: 0,
    nameplates: 0,
    submit: 0,
    total: 0,
  };
}

function emptyWorldPhaseMs(): RendererWorldPhaseMs {
  return {
    lights: 0,
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

/**
 * The world-space XZ footprint of a static feature group, for the per-frame
 * distance cull (see zone_feature_visibility_core.ts). Measured once, right
 * after the group is frozen: these groups never move again, so re-deriving
 * bounds every frame would be pure waste. Null when the group has no
 * measurable geometry, which the caller treats as "always visible".
 */
function measureFeatureFootprint(root: THREE.Object3D): FeatureFootprint | null {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { centerX: center.x, centerZ: center.z, halfX: size.x / 2, halfZ: size.z / 2 };
}

// Diagnostics-only label (the census buckets and the renderTrace walker read
// it); NEVER a behavior or visibility gate, so tagging an actionable object
// (team rings, corpse beacon) can never become a graphics-fairness break.
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

/** Encode a copied 2D canvas without paying Canvas.toDataURL's synchronous
 *  compression cost on the UI thread. FileReader keeps the server-facing data
 *  URL contract while both compression and blob reading happen asynchronously. */
function canvasDataUrlAsync(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.addEventListener('load', () =>
            resolve(typeof reader.result === 'string' ? reader.result : null),
          );
          reader.addEventListener('error', () => resolve(null));
          reader.readAsDataURL(blob);
        },
        type,
        quality,
      );
    } catch {
      resolve(null);
    }
  });
}

export interface RendererCreateOptions {
  context?: WebGL2RenderingContext;
  initializeGfx?: boolean;
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
  private readonly nameplateBatch = document.createDocumentFragment();
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
  private playerAuraRings: PlayerAuraRings;
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
  private readonly raycastNdc = new THREE.Vector2();
  private readonly raycastGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycastHit = new THREE.Vector3();
  private readonly raycastHits: THREE.Intersection[] = [];
  private readonly directHitIds: number[] = [];
  clickTargets: THREE.Object3D[] = [];
  // Gather-node meshes (#1866), raycast separately from `clickTargets`/`pick()`:
  // nodes are static content keyed by string id, not entities keyed by numeric
  // id, so they get their own list and `pickGatherNode` instead of widening
  // `pick()`'s numeric-id contract.
  gatherNodeMeshes: THREE.Object3D[] = [];
  private gatherNodes: GatherNodesView;
  camYaw = Math.PI;
  camPitch = 0.32;
  camDist = 12;
  // Map-editor 3D mode: when set, the camera uses this free-cam pose instead of
  // chasing the player (updateCamera honors it and returns early). Editor-only;
  // always null in the shipped game.
  editorCam: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  // AAA camera-feel layers (all display-only; see the three *_core modules):
  // spring-arm pivot lag, look-ahead + FOV kicks + landing thump, and the
  // directed moves (zone vista, death drift). Gated by reducedMotion().
  private readonly camBoom = createCameraBoom();
  private readonly camFeel = createCameraFeel();
  private readonly camDirector = createCameraDirector();
  // Player-pose mirror from last frame: any change while a directive runs is
  // manual camera input (or the follow system), which cancels the directive.
  private readonly camMirror = { yaw: Number.NaN, pitch: Number.NaN, dist: Number.NaN };
  // Death-drift arming: only an alive-to-dead EDGE of the SAME viewed entity
  // arms one drift (a spectate switch onto a corpse never does), and a
  // cancelled drift stays cancelled for that death.
  private camSelfId = -1;
  private camSelfWasDead = false;
  private deathDriftArmed = false;
  // settings-backed in-game "Reduce motion" switch; OR-ed with the OS
  // prefers-reduced-motion query in reducedMotion(). Initialized from Settings
  // and kept live by main.ts's applySetting dispatcher (mirrors showDevBadges).
  reduceMotionSetting = false;
  showNameplates = true;
  // settings-backed developer-badge display toggle (nameplate glyph + outline);
  // initialized from Settings and kept live by main.ts's applySetting dispatcher.
  showDevBadges = true;
  // settings-backed self-nameplate toggle (off by default): when on, your own
  // overhead nameplate renders exactly as other players see it. Initialized from
  // Settings and kept live by main.ts's applySetting dispatcher (mirrors showDevBadges).
  showOwnNameplate = false;
  // settings-backed other-players nameplate toggle (on by default): when off,
  // other players' plates hide (current target exempt) so crowded hubs stay
  // readable, especially on short mobile viewports. Initialized from Settings
  // and kept live by main.ts's applySetting dispatcher (mirrors showOwnNameplate).
  showPlayerNameplates = true;
  // settings-menu graphics knobs (applied live)
  private renderScale = 1; // user-requested resolution ceiling on top of the device pixel ratio
  private effectiveRenderScale = 1; // runtime value after adaptive backoff
  private renderPixelHeight = 1;
  private frameMsEma = 16.7;
  private adaptiveGrace = 2.0;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: write-only render-budget restore state (pre-existing); read path not yet wired.
  private adaptiveCooldown = 0;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: write-only render-budget restore state (pre-existing); read path not yet wired.
  private stableFrameTime = 0;
  private viewCreateBackoff = 0;
  private runtimeEntryElapsedMs = 0;
  private entityViewCreateRangeSq = ENTITY_VIEW_CREATE_RANGE_SQ;
  private entityViewDestroyRangeSq = ENTITY_VIEW_DESTROY_RANGE_SQ;
  private renderBudgetGovernor!: RenderBudgetGovernor;
  private renderBudgetState!: RenderBudgetState;
  private readonly renderBudgetSample: RenderBudgetSample = {
    dt: 0,
    frameMs: 0,
    totalMs: 0,
    submitMs: 0,
    calls: 0,
    triangles: 0,
    grassVisibleTufts: 0,
    grassVisibleChunks: 0,
    activeViews: 0,
    createdViews: 0,
    minRenderScale: 1,
    maxRenderScale: 1,
  };
  // Last frame-budget pressure (render_budget.ts), fed to the character LOD plan
  // so the animated far band is the first extra cost surrendered on a machine
  // already at its budget. Cosmetic only: the fairness floor for an actionable
  // pose lives in crowd_lod.ts and never reads this.
  private lastBudgetPressure = 0;
  // Post-processing profiles only: owns manual counter setup, logical-frame
  // deltas, governor reads, perf reads, and out-of-band resets as one contract.
  private drawStats: LogicalFrameDrawStats | null = null;
  private opaqueFrontToBackActive: boolean | null = null;
  private readonly opaqueSortPolicyInput: OpaqueSortPolicyInput = {
    drawCalls: 0,
    elapsedSeconds: 0,
    focusX: 0,
    focusZ: 0,
    previousFocusX: Number.NaN,
    previousFocusZ: Number.NaN,
  };
  // Hitch correlation (scene_census_core): fed per frame only while the ?perf
  // overlay has it enabled, so the fleet pays nothing for it. The sample is a
  // reused scratch object so the per-frame path stays allocation-free.
  private readonly hitchTracker = createHitchTracker();
  private hitchLogEnabled = false;
  private readonly hitchFrameScratch = {
    atMs: 0,
    frameMs: 0,
    submitMs: 0,
    programs: 0,
    textures: 0,
    createdViews: 0,
  };
  // The census burst inflates the following frame's dt; skip that one sample
  // so the tracker never charges the census to the scene.
  private hitchSkipNextFrame = false;
  // Tone-mapping exposure at brightness 1.0. Applied in OutputPass, i.e.
  // AFTER bloom, so this trims the raised sun rig back to the old apparent
  // brightness without moving anything across BLOOM_THRESHOLD.
  private baseExposure = 1;
  private tmpV = new THREE.Vector3();
  private tmpPuff = new THREE.Vector3();
  private viewCandidates: ViewCandidate[] = [];
  private viewCandidatePool: ViewCandidate[] = [];
  private readonly characterLodPlan: CharacterLodBands = {
    shadowRangeSq: 0,
    lodRangeSq: 0,
    staticRangeSq: 0,
    actionableStaticRangeSq: 0,
    midCadence: 1,
    farCadence: 1,
  };
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
  // Second scratch for the mount rig: the rider's state minus the rider-only
  // facts (casting/sitting/dead never reach the mount's locomotion clips).
  private readonly mountAnimScratch: AnimState = {
    speed: 0,
    moving: false,
    running: false,
    airborne: false,
    backwards: false,
    reverseBackpedal: false,
    dead: false,
    casting: false,
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
  private moonSprites: THREE.Sprite[] = [];
  private sunDir = new THREE.Vector3();
  // the moving moon direction plus how far above the horizon each body sits
  // (0 down, 1 up); recomputed each frame in updateAmbience from the world clock
  private moonDir = new THREE.Vector3(0, -1, 0);
  private lightDir = new THREE.Vector3(); // blended sun/moon dir the key light uses
  private shadowLightDirection = new THREE.Vector3();
  private sunUp = 1;
  private moonUp = 0;
  private starAmt = 0; // 0 day, 1 deep night: star-field strength for the sky dome
  private sunAzimuth = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize();
  private waterView: WaterView;
  private lastWaterSimulationPasses = 0;
  private terrainView: TerrainView;
  // Map-editor placed GLB assets; null when the world has none and the editor
  // never asked for the view (the shipped game with the built-in world).
  private placedAssetsView: PlacedAssetsView | null = null;
  private jailScene: JailSceneView;
  private foliage: FoliageView;
  private fish: FishView;
  private motes: MotesView;
  private bladeGrass: BladeGrassView;
  private cliffScree: CliffScreeView;
  private birds: BirdsView;
  private impactSite: ImpactSiteView;
  private realmFlora: RealmFloraView | null = null;
  private emberFeatures: EmberFeaturesView | null = null;
  private castleFeatures: CastleFeaturesView | null = null;
  private frostSky: FrostSkyView | null = null;
  private fenFeatures: FenFeaturesView | null = null;
  private amberFeatures: AmberFeaturesView | null = null;
  private nightFeatures: NightFeaturesView | null = null;
  private hauntFeatures: HauntFeaturesView | null = null;
  private jungleFeatures: JungleFeaturesView | null = null;
  private gardenFeatures: GardenFeaturesView | null = null;
  private galeFeatures: GaleFeaturesView | null = null;
  private fogScratch = new THREE.Color();
  // world day/night grade, recomputed each frame from the UTC-anchored clock in
  // updateAmbience and consumed by the outdoor fog/light easing, the sky dome,
  // and the IBL intensity. Defaults to full day for the frames before the first
  // updateAmbience runs.
  private dnGrade: DayNightGrade = fullDayGrade();
  private fixedLowDayBiome: BiomeId | null = null;
  private dnColorScratch = new THREE.Color();
  private dnMoonScratch = new THREE.Color();
  private flames: THREE.Mesh[];
  private flamePerceptualStates = new WeakMap<THREE.Mesh, FlamePerceptualState>();
  private windmillFans: THREE.Object3D[] = [];
  private fireLights: THREE.PointLight[];
  // Point lights owned by entity views (e.g. the quest-object glow). These stream
  // in/out with interest, so they are budgeted into the SAME constant count as the
  // static fire lights - otherwise numPointLights toggles as a lit object enters or
  // leaves view and every lit material recompiles (an open-world travel hitch).
  private viewLights: THREE.PointLight[] = [];
  // Renderer-owned pad lights (intensity 0, distance 0) that keep the VISIBLE
  // point-light count pinned at GFX.maxPointLights from the first frame on,
  // even when fewer real lights than the budget exist: see pointLightPadCount.
  private lightPads: THREE.PointLight[] = [];
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
      dt: number,
      reducedMotion?: boolean,
    ): void;
  };
  private eastbrookTownView!: EastbrookTownView;
  private lightRank: RankedPointLight[] = [];
  private doomedIds: number[] = [];
  private dungeons: DungeonInteriors | null = null;
  private envRTs = new Map<SkyKey, THREE.WebGLRenderTarget>();
  private envRTBySource = new WeakMap<THREE.Texture, THREE.WebGLRenderTarget>();
  // Cached: building a PMREMGenerator compiles the EquirectangularToCubeUV and
  // PMREMGGXConvolution shaders, so a fresh one per biome used to stall travel
  // at every biome boundary. Lives as long as the renderer, like the env RTs.
  private pmremGenerator: THREE.PMREMGenerator | null = null;
  private envBiome: SkyKey = 'vale';
  private envOutdoorIntensity = ENV_INTENSITY;
  private envTransition: EnvironmentMapTransition<SkyKey> = createEnvironmentMapTransition(
    'vale',
    0,
  );
  private preparedZones = new Set<string>();
  private pendingZonePrepares = new Map<string, Promise<void>>();
  // A walked boundary can ask for the same shader warmup in the frame where
  // the visible-zone lane finishes preparing it. Share that in-flight work:
  // duplicate prewarm grids were measured running concurrently for 5.7s.
  private pendingZonePrewarms = new Map<string, Promise<void>>();
  // One shared lane for background work that touches WebGL. Idle callbacks from
  // independent zone/sky/archetype tasks can otherwise all start in one frame.
  private backgroundGpuWork = createBackgroundGpuQueue();
  // Static terrain/water/features just beyond the current zone are built in a
  // single background lane when their rectangles enter the relaxed fog
  // horizon, so a walked boundary crossing lands on already-resident ground.
  // The queue is recomputed after meaningful camera travel, so teleports
  // discard stale not-yet-started work instead of walking an old route first.
  private visibleZonePrepareQueue: ZoneDef[] = [];
  private visibleZonePrepareActive = false;
  private visibleZoneCheckX = Number.NaN;
  private visibleZoneCheckZ = Number.NaN;
  private visibleZoneCheckFar = Number.NaN;
  // The biome preset's requested fog far BEFORE fogFarForPreparedZones clamps
  // it. The streaming horizon keys off this relaxed value: keying off the
  // clamped live fog would only start preparing a zone once its boundary is
  // already close enough to clamp the fog, i.e. too late.
  private lastRequestedFogFar = MAX_OUTDOOR_FOG_FAR;
  // The authored preset near that pairs with it: together they are the
  // ATMOSPHERIC fog the foliage swap follows (never the residency clamp).
  private lastRequestedFogNear = 55;
  /** Fired whenever a zone becomes resident (any prepare path). Wired by
   *  main.ts so presentation caches outside the renderer (the HUD's world-map
   *  background) prewarm alongside the zone itself. */
  onZonePrepared: ((zoneId: string) => void) | null = null;
  private lastZonePrepareStats: {
    zoneId: string;
    totalMs: number;
    skyMs: number;
    terrainMs: number;
    waterMs: number;
    featuresMs: number;
  } | null = null;
  private prewarmedMobTemplates = new Set<string>();
  private prewarmedNpcModels = new Set<string>();
  private prewarmedZonePrograms = new Set<string>();
  private time = 0;
  private frameIdx = 0;
  // Visible non-self character rigs last frame, feeding the crowd-adaptive LOD.
  private lastVisibleRigCount = 0;
  // KHR_parallel_shader_compile present: lets us link new programs off-thread and
  // gate a freshly-streamed view's draw on readiness instead of stalling the frame.
  private asyncCompileSupported = false;
  private readonly liveCompileGates = new CompileGateQueue(this.backgroundGpuWork);
  vfx: Vfx;
  private raceLine: RaceLine;
  private mountBeacon: MountBeacon;
  // Per-ability spell VFX subsystem: the spec-driven painter plus the pooled
  // primitive engine (ribbons, shock rings, decals, windup orbs, buff orbits;
  // see src/render/ability_vfx/).
  private abilityVfx: AbilityVfx;
  private abilityVfxFx: AbilityVfxFx;
  private lightPulses: LightPulses;
  // Flash a pooled talent-moment point light at an entity's feet (see
  // light_pulses.ts); bound once in the constructor over the views map.
  private pulseAt: (
    id: number,
    school: string,
    intensity: number,
    duration: number,
    range?: number,
  ) => void;
  private frozenOrbFx!: FrozenOrbFx;
  private mageGroundFx!: MageGroundFx;
  private ringOfFrostVisuals!: RingOfFrostVisuals;
  private riftDeathZoneVisuals!: import('./rift_death_zone').RiftDeathZoneVisuals;
  private temporalHourglassGroundVisuals!: TemporalHourglassGroundVisuals;
  private readonly mageBarrierStateScratch: MageBarrierState = {
    theme: 'frost',
    value: 0,
  };
  private readonly weaponAuraScratch: CharacterWeaponAura = { color: 0, tip: false };
  private glacialFrontVisual!: GlacialFrontVisual;
  private fishingBobbers!: FishingBobberVisual;
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
  private vcupFireworks: {
    at: number;
    x: number;
    z: number;
    colors: readonly number[];
  }[] = [];
  private valeCupBallDust: ValeCupBallDust | null = null;
  private valeCupBallTrail: ValeCupBallTrail | null = null;
  // seed-bound ground sampler, built once so the per-frame Vale Cup ring update
  // allocates no closure (see the drape path in vale_cup_team_ring.ts).
  private groundSample = (x: number, z: number): number => groundHeight(x, z, this.sim.cfg.seed);
  private selectionDrapeSupportY = 0;
  private selectionGroundSample = (x: number, z: number): number =>
    Math.max(this.groundSample(x, z), this.selectionDrapeSupportY);

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
  private readonly onWebGLContextLost = (): void => {
    this.contextLostCount++;
  };
  private readonly onWebGLContextRestored = (): void => {
    this.contextRestoredCount++;
    this.captureGlIdentity();
    this.vfx?.onContextRestored();
  };
  private readonly onViewportResize = (): void => {
    if (!this.shutdownStarted) this.resizeViewport();
  };
  private readonly onOrientationChange = (): void => {
    this.onViewportResize();
    this.resizeTimers.push(window.setTimeout(this.onViewportResize, 250));
    this.resizeTimers.push(window.setTimeout(this.onViewportResize, 800));
  };
  private phaseSamples: Record<RendererPhase, NumberSampleRing> = {
    setup: new NumberSampleRing(RENDERER_PHASE_SAMPLE_LIMIT),
    entities: new NumberSampleRing(RENDERER_PHASE_SAMPLE_LIMIT),
    world: new NumberSampleRing(RENDERER_PHASE_SAMPLE_LIMIT),
    nameplates: new NumberSampleRing(RENDERER_PHASE_SAMPLE_LIMIT),
    submit: new NumberSampleRing(RENDERER_PHASE_SAMPLE_LIMIT),
    total: new NumberSampleRing(RENDERER_PHASE_SAMPLE_LIMIT),
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
  private lastQualityChange: RendererQualityChangeStats | null = null;
  private visualPool = new Map<string, CharacterVisual[]>();
  private pooledVisualCount = 0;
  private objectPool = new Map<string, PooledObjectView[]>();
  private prewarmDepthMaterials = new Map<string, THREE.MeshDepthMaterial>();
  private readonly canvas: HTMLCanvasElement;
  private unregisterWebGLContext: (() => void) | null = null;
  private shutdownStarted = false;
  private shutdownTask: Promise<RecycledRendererContext> | null = null;
  private lifecycleGeneration = 0;
  private resizeTimers: number[] = [];
  private devProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private devProbeBindings: {
    host: Record<string, unknown>;
    values: Record<string, unknown>;
  } | null = null;
  private rendererResourcesDisposed = false;

  constructor(
    private sim: IWorld,
    canvas: HTMLCanvasElement,
    nameplateLayer: HTMLDivElement,
    options: RendererCreateOptions = {},
  ) {
    this.canvas = canvas;
    this.nameplateLayer = nameplateLayer;
    this.travelSpeedFx = new TravelSpeedFxPainter(nameplateLayer);
    // biome-ignore format: Keep the established constructor body stable inside the failure guard.
    try {
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
    // composer's MSAA HalfFloat target, low is meant to run without AA, and
    // requesting it here would hit software GL (the autodetect can only run
    // after the context exists) with the most expensive setting there is.
    this.webgl = new THREE.WebGLRenderer({
      canvas,
      context: options.context,
      antialias: false,
      powerPreference: 'high-performance',
    });
    if (!this.webgl.capabilities.isWebGL2) {
      throw new Error('Renderer requires WebGL2');
    }
    if (options.context && this.webgl.getContext() !== options.context) {
      throw new Error('Three replaced the supplied WebGL2 context');
    }
    // Release this context promptly on page teardown so repeated logout/login
    // reloads (location.reload) don't exhaust the browser's WebGL context pool.
    this.unregisterWebGLContext = trackWebGLContext(this.webgl);
    this.captureGlIdentity();
    canvas.addEventListener('webglcontextlost', this.onWebGLContextLost);
    canvas.addEventListener('webglcontextrestored', this.onWebGLContextRestored);
    if (options.initializeGfx !== false) {
      initGfxTier(this.webgl); // software-GL autodetect needs the live context
    }
    if (GFX.composer || GFX.gradePass) {
      // three r165's render() resets info per pass (after the shadow pass, see
      // draw_stats_core.ts header), so with the composer's multiple passes every
      // post-frame reader saw only the final fullscreen pass (1 call/1 triangle).
      // The session owns manual accumulation and every downstream consumer.
      // Direct profiles keep Three's normal auto-reset path.
      this.drawStats = createLogicalFrameDrawStats(this.webgl.info);
    }
    // The lightweight material path does not preload HDR sky/water assets.
    // Keep the renderer's HDR/IBL branch aligned with that preload decision.
    this.lowGfx = !GFX.standardMaterials;
    this.renderBudgetGovernor = new RenderBudgetGovernor({
      tier: GFX.tier,
      budget: GFX.budget,
      enabled: GFX.autoGovernor,
    });
    this.renderBudgetState = this.renderBudgetGovernor.reset(
      this.effectiveRenderScale,
      this.renderBudgetMinScale(),
      this.renderBudgetMaxScale(),
    );
    const LOW_GFX = this.lowGfx;
    this.viewport = this.measureViewport();
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, GFX.pixelRatioCap));
    this.webgl.setSize(this.viewport.width, this.viewport.height, false);
    this.renderPixelHeight = this.webgl.domElement.height;
    // Three's default checkShaderErrors=true queries getShader/ProgramInfoLog
    // after every link: a SYNCHRONOUS GPU-process roundtrip that blocks until
    // the driver finishes compiling. Measured on a zone-streaming walk it was
    // 25% of ALL main-thread time (multi-second stalls per new zone's program
    // batch), so it stays off unless a shader author opts back in for
    // diagnostics with ?shaderdebug=1.
    try {
      this.webgl.debug.checkShaderErrors = new URLSearchParams(location.search).has('shaderdebug');
    } catch {
      this.webgl.debug.checkShaderErrors = false;
    }
    this.webgl.shadowMap.enabled = GFX.dynamicShadows;
    // PCF (not PCFSoft): in three 0.165 shadow.radius is only honoured by the
    // plain PCF kernel. PCFSoft ignores it and uses a fixed texel-sized
    // kernel, so the old softening was silently a no-op and every shadow edge
    // rendered near-hard regardless of tuning. The live radius is deliberately
    // crisp without dropping all the way to a razor edge.
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
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
    // updateCamera owns the one explicit camera matrix refresh. Prevent each
    // WebGLRenderer pass from repeating it for an unchanged camera.
    this.camera.matrixWorldAutoUpdate = false;
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
      showPlayerNameplates: () => this.showPlayerNameplates,
      isHostilePlayer: (e) => this.isHostilePlayer(e),
    });

    // Boot values match the vale/low presets; updateAmbience eases from here.
    this.scene.fog = new THREE.Fog(
      LOW_GFX ? 0xb6cddd : 0xa6c6e0,
      LOW_GFX ? 90 : 190,
      LOW_GFX ? 325 : 700,
    );

    // sky dome, follows the camera so the world strip never outruns it.
    // High tier: shader gradient + sun glow with biome-aware horizon tints;
    // low keeps the legacy canvas-gradient dome.
    const initialX = this.sim.player.pos.x;
    const initialZ = this.sim.player.pos.z;
    const initialBiome = zoneBiomeAt(initialX, initialZ);
    this.skyView = buildSky(LOW_GFX, SUN_ANCHOR, initialX, initialZ);
    this.sky = this.skyView.dome;
    setRenderCategory(this.sky, 'sky');
    this.scene.add(this.sky);

    // IBL: prefilter the real per-biome HDRI equirects so PBR materials get
    // sky-matched ambient; swapped as the camera crosses biome bands (the
    // dome shader cross-fades the same textures). The raw equirects carry
    // the unclamped sun that the dome shader tames with per-biome gain, so
    // the environment intensity is rescaled to match the shipped look.
    if (!LOW_GFX) {
      // Phone WebKit keeps only the spawn biome PMREM for the session. The on-device
      // diagnostic showed that the old deferred second PMREM was followed by a process
      // termination at 32.8s, with no context-loss or JS error. Keeping the initial IBL
      // while the sky dome continues to cross-fade is cosmetic and avoids that allocation.
      const envPlan = resolveEnvironmentPrefilterPlan(GFX.constrainedMemory, initialBiome);
      const entryBiomes: BiomeId[] = envPlan.immediate;
      if (GFX.constrainedMemory) this.envBiome = entryBiomes[0] ?? 'vale';
      for (const b of entryBiomes) this.ensureEnvironmentBiome(b);
      // Rift entries can spawn outside the dedicated environment biomes; where
      // memory allows, build the actual spawn biome's PMREM too so IBL matches
      // the dome from the first frame.
      if (!GFX.constrainedMemory) this.ensureEnvironmentBiome(initialBiome);
      console.info(
        `[entry-guard] environment prefilter: immediate=[${envPlan.immediate.join(',')}] ` +
          `deferred=[${envPlan.deferred.join(',')}] constrained=${GFX.constrainedMemory}`,
      );
      if (this.envRTs.size > 0) {
        // Seed from the biome actually built at entry (the spawn biome where its
        // prefilter exists, else the plan's first), so IBL and sun rotation match
        // the dome from the first frame instead of after a deferred prefilter.
        const seedBiome: BiomeId = this.envRTs.has(initialBiome) ? initialBiome : entryBiomes[0];
        this.envOutdoorIntensity = ENV_INTENSITY * IBL_RAW_SCALE;
        this.scene.environment = this.envRTs.get(seedBiome)?.texture ?? null;
        this.scene.environmentRotation.y = this.skyView.envRotationY(seedBiome);
        this.envBiome = seedBiome;
      } else {
        // fallback: prefilter the dome itself (gain/clamp already applied)
        this.pmremGenerator ??= new THREE.PMREMGenerator(this.webgl);
        const envScene = new THREE.Scene();
        envScene.add(this.sky.clone());
        const envRT = this.pmremGenerator.fromScene(envScene, 0.04, 0.1, 1100); // far must cover the 560u dome
        this.scene.environment = envRT.texture;
      }
      this.scene.environmentIntensity = this.envOutdoorIntensity;
      this.envTransition.current = this.envBiome;
      this.envTransition.intensity = this.scene.environmentIntensity;
    }

    const hemi = new THREE.HemisphereLight(
      0xdcefff,
      0x465f39,
      LOW_GFX ? 0.9 : hemiOutdoorIntensity(),
    );
    this.scene.add(hemi);
    this.hemi = hemi;
    // Golden key light: warmer than the old near-white cream so daylight reads
    // as soft sun, not white glare; the hemisphere stays cool for contrast.
    const sun = new THREE.DirectionalLight(
      LOW_GFX ? 0xffdfaa : 0xffd99a,
      LOW_GFX ? 2.65 : SUN_INTENSITY,
    );
    sun.position.copy(SUN_ANCHOR);
    sun.castShadow = GFX.dynamicShadows;
    sun.shadow.mapSize.set(GFX.shadowMap, GFX.shadowMap);
    sun.shadow.camera.near = 30;
    sun.shadow.camera.far = 480;
    // 105u half-extent: the 31° sun throws shadows ~1.7x an object's height,
    // so the frustum must reach further sunward than the old 95 to catch
    // off-screen casters; ~5.1cm texels at 4096, which the PCF radius below
    // softens over anyway. (115 cost real shadow-pass draw calls at ultra;
    // 105 keeps most of the reach.)
    const S = LOW_GFX ? 85 : 105;
    sun.shadow.camera.left = -S;
    sun.shadow.camera.right = S;
    sun.shadow.camera.top = S;
    sun.shadow.camera.bottom = -S;
    sun.shadow.bias = -0.0006;
    // 0.05 pushed contact shadows clean off clod/prop-scale relief; 0.035
    // still clears acne on the low-poly facets
    sun.shadow.normalBias = LOW_GFX ? 0.02 : 0.035;
    sun.shadow.radius = 2.25;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    // characters can self-cull only where they cast no sun shadow (low/lean tier)
    this.cullCharacters = !sun.castShadow;
    this.sunDir.copy(SUN_DIR);

    // visible sun disc + bloom halo
    // The sun and moon are billboard sprites: always camera-facing, so they read
    // as perfect circles wherever they sit on screen (a dome-shader disc would
    // project to an ellipse off-axis). Each is a crisp filled disc plus a soft
    // glow; the renderer aims them along the sun/moon direction each frame and
    // fades them by how far the body is above the horizon.
    const discTex = (r: number, g: number, b: number): THREE.CanvasTexture => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const ctx = cv.getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable');
      const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
      grad.addColorStop(0.82, `rgba(${r}, ${g}, ${b}, 1)`); // solid plateau = crisp disc
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`); // feathered rim to anti-alias the edge
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(cv);
    };
    const glowTex = (r: number, g: number, b: number): THREE.CanvasTexture => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const ctx = cv.getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable');
      const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.5)`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(cv);
    };
    const makeCelestialSprite = (
      tex: THREE.CanvasTexture,
      scale: number,
      opacity: number,
      blending: THREE.Blending = THREE.AdditiveBlending,
      renderOrder = -9,
    ): THREE.Sprite => {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          fog: false,
          depthWrite: false,
          depthTest: false,
          blending,
          opacity,
        }),
      );
      setRenderCategory(sp, 'sky');
      sp.scale.set(scale, scale, 1);
      sp.renderOrder = renderOrder;
      sp.frustumCulled = false; // rides the camera at a fixed offset; never cull it
      sp.userData.baseOpacity = opacity;
      this.scene.add(sp);
      return sp;
    };
    // sun: a warm disc under a soft warm glow
    this.sunSprites = [
      makeCelestialSprite(glowTex(255, 214, 150), 150, LOW_GFX ? 0.6 : 0.3),
      makeCelestialSprite(discTex(255, 224, 168), 42, 0.9),
    ];
    // moon: a bright cratered face (normal-blended so the maria read as dark)
    // under a soft cool additive glow kept modest so it does not wash the face
    // moon: a plain bright disc (as bright as the stars) under a soft cool glow
    this.moonSprites = [
      makeCelestialSprite(glowTex(150, 170, 220), 128, 0.22),
      makeCelestialSprite(discTex(247, 250, 255), 52, 1),
    ];

    // god-ray shafts: elongated additive gradient sprites hanging sunward of
    // the camera; opacity follows how directly the camera faces the sun
    if (!LOW_GFX) {
      const shaft = document.createElement('canvas');
      shaft.width = 64;
      shaft.height = 256;
      const sctx = shaft.getContext('2d');
      if (!sctx) throw new Error('2D canvas context unavailable');
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

    // A returning character can log out anywhere in a zone, not only at a
    // hub, so ensureZone builds the cells nearest the actual entry position
    // first (a bounded reorder inside each zone build) rather than wherever
    // row-major order happens to reach them. (Sprite clouds are gone: the
    // per-biome HDRI skies carry the cloudscape now.)
    // Dev-channel build-phase telemetry (English, console.info, Release-silent):
    // the iPhone 17 Pro WebContent kill now lands INSIDE this constructor, after
    // every preload completes, so localizing which build phase tips the memory
    // ceiling requires a marker between phases. Wall-clock only, no allocation.
    const bdStart = performance.now();
    let bdLast = bdStart;
    const bd = (phase: string): void => {
      const now = performance.now();
      // Gated like [load-diag] and the residency table: dev browsers plus the
      // native iOS profile under diagnosis, never the production web console.
      if (import.meta.env.DEV || GFX.nativeIosMemoryProfile) {
        console.info(
          `[build-diag] ${phase} +${(now - bdLast).toFixed(0)}ms (total ${(now - bdStart).toFixed(0)}ms)`,
        );
      }
      bdLast = now;
    };
    this.terrainView = buildTerrain(this.sim.cfg.seed, {
      x: this.sim.player.pos.x,
      z: this.sim.player.pos.z,
    });
    setRenderCategory(this.terrainView.group, 'terrain');
    this.scene.add(this.terrainView.group);
    // Terrain chunks never move after build (the LOD update only toggles
    // visibility): stop their per-frame matrix recompose (static_matrix.ts).
    freezeStaticSubtreeMatrices(this.terrainView.group);
    bd('terrain');
    this.waterView = buildWater(this.sim.cfg.seed, this.webgl);
    setRenderCategory(this.waterView.group, 'water');
    this.scene.add(this.waterView.group);
    freezeStaticSubtreeMatrices(this.waterView.group); // water animates via uniforms, never transforms
    bd('water');

    this.foliage = buildFoliage(this.sim.cfg.seed);
    setRenderCategory(this.foliage.group, 'foliage');
    this.scene.add(this.foliage.group);
    bd('foliage');
    this.fish = buildFish(this.sim.cfg.seed, (x, z, radius, strength) => {
      this.waterView.addSplash(x, z, radius, strength);
      const level = waterLevelAt(x, z);
      if (Number.isFinite(level)) {
        this.vfx.waterSplash(x, level, z, radius, strength);
      }
    });
    setRenderCategory(this.fish.group, 'fish');
    this.scene.add(this.fish.group);
    this.motes = buildMotes(this.sim.cfg.seed);
    setRenderCategory(this.motes.group, 'ambient');
    this.scene.add(this.motes.group);
    // near-field solid-blade carpet; the card tufts own the mid/far field
    this.bladeGrass = buildBladeGrass(
      this.sim.cfg.seed,
      this.sim.player.pos.x,
      this.sim.player.pos.z,
    );
    this.scene.add(this.bladeGrass.group);
    // boulders on the steep-slope band; cliffs stop being bare wedges
    this.cliffScree = buildCliffScree(this.sim.cfg.seed);
    this.scene.add(this.cliffScree.group);
    this.birds = buildBirds(this.sim.cfg.seed);
    setRenderCategory(this.birds.group, 'ambient');
    this.scene.add(this.birds.group);
    this.impactSite = buildImpactSite(this.sim.cfg.seed);
    setRenderCategory(this.impactSite.group, 'props');
    this.scene.add(this.impactSite.group);
    this.scene.add(this.impactSite.light);
    const props = buildProps(this.sim.cfg.seed, (delveId) =>
      tEntity({ kind: 'delve', id: delveId, field: 'name' }),
    );
    setRenderCategory(props.group, 'props');
    this.scene.add(props.group);
    bd('props');
    // The light budget must exist BEFORE any attachZoneFeature call: a static
    // feature that ships glowLights pushes into it during the loop below.
    this.fireLights = props.fireLights;
    // World-spanning modeled dressing, all static: the Duskfall cave mouths,
    // lily-and-reed water flora on every temperate lake, and the Farshore's
    // palm strand. Attached like the per-zone features so the distance cull
    // applies: the gates and the palm strand have compact footprints of their
    // own, and water flora registers one cull child per zone.
    for (const staticFeature of [
      buildHollowGates(this.sim.cfg.seed),
      buildWaterFlora(this.sim.cfg.seed),
      buildFarshoreFeatures(this.sim.cfg.seed),
    ]) {
      this.attachZoneFeature(staticFeature);
    }
    this.flames = props.flames;
    this.windmillFans = props.windmillFans;
    // Props are baked into world space at build and their update() only toggles
    // visibility, so the whole tree is matrix-static, EXCEPT the campfire
    // flames, whose flicker rescales them every frame, and the windmill sail
    // pivots, which turn: re-enable those.
    freezeStaticMatrices(props.group);
    for (const flame of this.flames) flame.matrixAutoUpdate = true;
    for (const fan of this.windmillFans) fan.matrixAutoUpdate = true;
    // The impact-site light rides the campfire point-light budget so the visible
    // point-light count stays constant as the player travels (constant
    // numPointLights -> materials never recompile for a light-count change).
    this.fireLights.push(this.impactSite.light);
    // The Sowfield (Vale Cup stadium): same landmark pattern. Brazier lights ride
    // the fireLights budget (never the cull-toggled group) and its flames join the
    // campfire flicker + ember pass.
    this.valeCupStadium = buildValeCupStadium(this.sim.cfg.seed);
    setRenderCategory(this.valeCupStadium.group, 'props');
    this.scene.add(this.valeCupStadium.group);
    bd('vale-cup');
    // The private practice-pitch copy (shown at a far instance origin when the
    // local player is practicing; positioned/toggled by valeCupStadium.update).
    setRenderCategory(this.valeCupStadium.practiceGroup, 'props');
    this.scene.add(this.valeCupStadium.practiceGroup);
    // The practice skybox (camera-centred; shown only while practicing, driven
    // in updateAmbience). Category 'sky' groups it with the dome in diagnostics.
    setRenderCategory(this.valeCupSky.mesh, 'sky');
    this.scene.add(this.valeCupSky.mesh);
    for (const light of this.valeCupStadium.lights) {
      this.scene.add(light);
      this.fireLights.push(light);
    }
    this.flames.push(...this.valeCupStadium.flames);
    // Pin numPointLights at the tier constant from the very first frame: real
    // fire lights start hidden (budgetFireLights reveals the nearest ones) and
    // renderer-owned pads fill the rest of the visible count, so no material
    // ever recompiles for a light-count change - including at boot, before the
    // first budget pass, while the boot prewarm compiles the pinned variant.
    for (const light of this.fireLights) light.visible = false;
    for (let i = 0; i < GFX.maxPointLights; i++) {
      const pad = new THREE.PointLight(0xffffff, 0, 0, 2);
      this.scene.add(pad);
      this.lightPads.push(pad);
    }
    // Team glow rings under live match fighters (ally/enemy/self readability).
    this.valeCupTeamRings = buildValeCupTeamRings();
    setRenderCategory(this.valeCupTeamRings.group, 'ui3d');
    this.scene.add(this.valeCupTeamRings.group);
    this.propsView = props;

    // Eastbrook's replacement town is a distinct, stable scene subtree. Its
    // six opaque building volumes stay individual for camera roof ghosting;
    // civic, market, fence, and wall geometry is initialization-batched.
    this.eastbrookTownView = buildEastbrookTownView(this.sim.cfg.seed);
    setRenderCategory(this.eastbrookTownView.group, 'props');
    this.scene.add(this.eastbrookTownView.group);
    freezeStaticSubtreeMatrices(this.eastbrookTownView.group);
    bd('eastbrook-town');

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

    this.jailScene = buildJailScene(this.sim.cfg.seed);
    setRenderCategory(this.jailScene.group, 'props');
    this.scene.add(this.jailScene.group);

    this.gatherNodes = buildGatherNodes(this.sim.cfg.seed);
    setRenderCategory(this.gatherNodes.group, 'props');
    this.scene.add(this.gatherNodes.group);
    // Node transforms are baked into world space. The lightweight frame update
    // below changes only provably unreachable directional-shadow eligibility.
    freezeStaticSubtreeMatrices(this.gatherNodes.group);
    this.gatherNodeMeshes = this.gatherNodes.group.children;
    bd('jail-gather');

    // Crafting-station scenery (Professions 2.0): static, except the kitchens
    // fire, whose flame + light join the campfire flicker/ember pass above.
    const stationProps = buildStationProps(this.sim.cfg.seed, this.sim.stationPlacements);
    setRenderCategory(stationProps.group, 'props');
    this.scene.add(stationProps.group);
    freezeStaticMatrices(stationProps.group);
    for (const flame of stationProps.flames) flame.matrixAutoUpdate = true;
    this.flames.push(...stationProps.flames);
    this.fireLights.push(...stationProps.fireLights);
    bd('stations');
    // One residency table at the end of the build (dev console): where the
    // decoded bytes sit at exactly the point the iPhone 17 Pro is killed.
    // Scene first so shared buffers/images attribute to the live world, then
    // the caches so only their EXCLUSIVE retention shows as theirs. Gated to
    // dev browsers and the native iOS profile under diagnosis: the walk
    // allocates identity sets over every buffer at the peak-memory instant,
    // which the production web population must not pay.
    if (import.meta.env.DEV || GFX.nativeIosMemoryProfile) {
      console.info(
        formatResidencyBudget(
          residencyBudget([
            { label: 'scene', objects: [this.scene] },
            {
              label: 'char parse cache',
              objects: characterResidencySources().parsedScenes,
            },
            {
              label: 'prop extract cache',
              geometries: propResidencySources().extractedGeometries,
            },
            {
              label: 'prop parse cache',
              objects: propResidencySources().parsedScenes,
            },
            {
              label: 'foliage extract cache',
              geometries: foliageResidencySources().extractedGeometries,
            },
            {
              label: 'foliage parse cache',
              objects: foliageResidencySources().parsedScenes,
            },
          ]),
        ),
      );
    }

    // selection ring, a classic target reticle: a base ring plus four
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

    this.playerAuraRings = new PlayerAuraRings(GFX.effectsTier, GFX.composer);
    setRenderCategory(this.playerAuraRings.group, 'ui3d');
    this.scene.add(this.playerAuraRings.group);

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
    // Fishing bobbers: one float per fishing entity in view; the personal
    // fishingBite event flips the owner's into the bite state (handleEvent).
    this.fishingBobbers = new FishingBobberVisual(this.scene, (x, z, radius, strength) => {
      this.waterView.addSplash(x, z, radius, strength);
      const level = waterLevelAt(x, z);
      if (Number.isFinite(level)) {
        this.vfx.waterSplash(x, level, z, radius, strength);
      }
    });
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
    const riftDeathZoneGeneration = this.lifecycleGeneration;
    void import('./rift_death_zone').then(({ RiftDeathZoneVisuals }) => {
      if (
        this.shutdownStarted ||
        riftDeathZoneGeneration !== this.lifecycleGeneration
      )
        return;
      this.riftDeathZoneVisuals = new RiftDeathZoneVisuals(this.scene, (x, z) => {
        const base = groundHeight(x, z, this.sim.cfg.seed);
        // Add the rift platform lift so rings on elevated sanctum boss arenas
        // sit on the arena floor, not under it (same pattern as entity ground
        // and the camera clamp), PLUS the raised boss dais: the dais is a
        // render-only platform the sim keeps flat, so without daisVisualLift a
        // ring under the tanked boss hides beneath the foundation blocks (the
        // playtest's invisible aoe circles). Mirrors placeDais's raised
        // decision exactly (style.daisRaised override, else the kit default).
        const rf = this.sim.riftFloor;
        if (rf) {
          const floor = generateRiftFloor(rf.seed, rf.baseLevel, rf.floorIndex, rf.upgrade);
          const lx = x - rf.origin.x;
          const lz = z - rf.origin.z;
          const raised = floor.style.daisRaised ?? dungeonDaisHasRaisedPlatform(floor.style.kit);
          return (
            base + riftLiftAt(floor, lx, lz) + daisVisualLift(floor.layout.dais, raised, lx, lz)
          );
        }
        return base;
      });
    });
    this.temporalHourglassGroundVisuals = new TemporalHourglassGroundVisuals(this.scene, (x, z) =>
      groundHeight(x, z, this.sim.cfg.seed),
    );
    const vfxAnchor = (id: number, frac: number) => {
      const v = this.views.get(id);
      if (!v) return null;
      const e = this.sim.entities.get(id);
      const h = v.height * (e?.scale ?? 1) * frac;
      return new THREE.Vector3(v.group.position.x, v.group.position.y + h, v.group.position.z);
    };
    this.vfx = new Vfx(this.scene, vfxAnchor);
    this.vfx.setViewportScale(this.webgl.domElement.clientHeight * this.webgl.getPixelRatio(), 60);
    this.abilityVfxFx = new AbilityVfxFx(this.scene, this.camera, vfxAnchor, (x, z) =>
      groundHeight(x, z, this.sim.cfg.seed),
    );
    this.abilityVfxFx.setViewportScale(
      this.webgl.domElement.clientHeight * this.webgl.getPixelRatio(),
      60,
    );
    this.abilityVfx = new AbilityVfx({
      vfx: this.vfx,
      fx: this.abilityVfxFx,
      anchor: vfxAnchor,
      spawnAoeRing: (x, z, radius, school, colorHex) =>
        this.spawnAoeRing(x, z, radius, school, colorHex),
      triggerAttack: (id, abilityId) => this.triggerAttack(id, abilityId),
      lightPulse: (id, school, intensity, duration, range) =>
        this.pulseAt(id, school, intensity, duration, range),
      setAuraGlow: (id, colorHex, intensity) => {
        const v = this.views.get(id);
        if (v) this.activeVisual(v)?.setAuraGlow(colorHex, intensity);
      },
      playShoutAnim: (id) => {
        const v = this.views.get(id);
        const vis = v ? this.activeVisual(v) : null;
        if (vis && !vis.isMidOneShot) vis.playEmote('cheer', 1);
      },
      isMob: (id) => this.sim.entities.get(id)?.kind === 'mob',
      castingAbilityOf: (id) => this.sim.entities.get(id)?.castingAbility ?? null,
      isMidOneShot: (id) => {
        const v = this.views.get(id);
        return v ? !!this.activeVisual(v)?.isMidOneShot : false;
      },
      localPlayerId: () => this.sim.player.id,
      hasGestureClip: (id, abilityId) => {
        const v = this.views.get(id);
        const vis = v ? this.activeVisual(v) : null;
        return vis ? vis.hasAttackClipOverride(abilityId) : false;
      },
      isInstantAbility: (abilityId) => {
        const def = ABILITIES[abilityId];
        return !def || (def.castTime <= 0 && !def.channel && !def.empowerStages);
      },
      // heavy VFX moments (fissures, gavel verdicts, finisher crits) ride the
      // Fiesta trauma accumulator; the fx engine has already applied distance
      // falloff and its rolling anti-spam budget
      addShake: (amount) => this.addShake(amount),
      // contact-frame hitstop: only THAT rig's animation clock slows (the
      // world, sim, and every other character keep running); the visual
      // guards against stacking
      animHold: (id, scale, dur) => {
        const v = this.views.get(id);
        if (v) this.activeVisual(v)?.holdFrame(scale, dur);
      },
      // caster windup lean, fed per frame by the staged ceremony
      bodyLean: (id, amount) => {
        const v = this.views.get(id);
        if (v) this.activeVisual(v)?.setWindupLean(amount);
      },
      // screen feedback (crit flash, finisher ripples): composer-gated like
      // bloom, skipped for reduced-motion players
      screenFlash: (strength) => {
        if (this.post && !this.reducedMotion()) this.post.screenFlash(strength);
      },
      screenImpact: (x, y, z, strength) => this.screenImpactAt(x, y, z, strength),
      // per-ability procedural audio (release whooshes, palette impact
      // identities, zone pulses, crit stings) rides the injected spatial
      // audio sink; offline/headless hosts without one stay silent
      abilityAudio: (kind, palette, power, x, y, z, opts) =>
        this.audioSink?.abilityAudio?.(kind, palette, power, x, y, z, opts),
    });
    // Dev-only ability VFX probe surface (scripts/ability_vfx_probe.mjs):
    // self-installs onto window.__game once main.ts has assembled it, so the
    // probe wiring lives entirely inside the subsystem it measures and the
    // production bundle carries none of it.
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const devProbeGeneration = this.lifecycleGeneration;
      const install = () => {
        if (this.shutdownStarted || devProbeGeneration !== this.lifecycleGeneration) return;
        const g = (window as unknown as { __game?: Record<string, unknown> }).__game;
        if (!g) {
          this.devProbeTimer = setTimeout(install, 250);
          return;
        }
        this.devProbeTimer = null;
        if (!g.abilityVfxStats) {
          const values: Record<string, unknown> = {
            abilityVfxStats: () => this.abilityVfxStats(),
            abilityVfxGlow: (id: number) => this.abilityVfxGlow(id),
            abilityVfxGroundAuras: (id: number) => this.abilityVfxGroundAuras(id),
            abilityVfxAttackCount: () => this.abilityVfxAttackCount(),
            abilityVfxProbe: {
              specs: ABILITY_VFX_SPECS,
              fullSpecs: ABILITY_VFX_FULL_SPECS,
              abilities: ABILITIES,
            },
          };
          Object.assign(g, values);
          this.devProbeBindings = { host: g, values };
        }
      };
      this.devProbeTimer = setTimeout(install, 250);
    }
    this.pulseAt = (id, school, intensity, duration, range) => {
      const v = this.views.get(id);
      if (!v) return;
      this.lightPulses.pulse(v.group.position, school, intensity, duration, range);
    };

    // Show-jumping racing line: self-scoped course guidance, hidden outside the
    // player's own race (driven per frame from world.mountRaceView() below).
    this.raceLine = new RaceLine(this.scene, this.groundSample);
    // Riding-lesson start platform: the glowing square behind the start arch.
    this.mountBeacon = new MountBeacon(this.scene, this.groundSample);

    // ambient precipitation: biome-driven snow/rain that rides with the camera
    this.weather = new Weather(this.scene, this.lowGfx);

    // post chain (bloom + grade, GTAO on ultra); medium gets the grade-only
    // mini chain so the cinematic grade stops being a high-tier privilege;
    // low renders direct
    if (GFX.composer || GFX.gradePass)
      this.post = buildComposer(
        this.webgl,
        this.scene,
        this.camera,
        this.viewport.width,
        this.viewport.height,
        { gradeOnly: !GFX.composer },
      );

    window.addEventListener('resize', this.onViewportResize);
    window.addEventListener('orientationchange', this.onOrientationChange);
    window.visualViewport?.addEventListener('resize', this.onViewportResize);
    window.visualViewport?.addEventListener('scroll', this.onViewportResize);
    document.addEventListener('fullscreenchange', this.onViewportResize);
    } catch (error) {
      this.beginRendererShutdown();
      this.disposeRendererResources();
      if (!options.context) {
        try {
          const partial = this as unknown as { webgl?: THREE.WebGLRenderer };
          partial.webgl?.forceContextLoss();
        } catch {
          // A failed fresh construction must not leak its newly-created context.
        }
      }
      throw error;
    }
  }

  private beginRendererShutdown(): void {
    if (this.shutdownStarted) return;
    this.shutdownStarted = true;
    this.lifecycleGeneration++;
    this.onZonePrepared = null;
    this.audioSink = null;
    this.visibleZonePrepareQueue = [];
    try {
      this.terrainView?.cancelStreaming();
    } catch {
      // A partially constructed terrain view may already be unwinding.
    }
    this.canvas.removeEventListener('webglcontextlost', this.onWebGLContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onWebGLContextRestored);
    window.removeEventListener('resize', this.onViewportResize);
    window.removeEventListener('orientationchange', this.onOrientationChange);
    window.visualViewport?.removeEventListener('resize', this.onViewportResize);
    window.visualViewport?.removeEventListener('scroll', this.onViewportResize);
    document.removeEventListener('fullscreenchange', this.onViewportResize);
    for (const timer of this.resizeTimers) window.clearTimeout(timer);
    this.resizeTimers = [];
    if (this.devProbeTimer !== null) {
      clearTimeout(this.devProbeTimer);
      this.devProbeTimer = null;
    }
    if (this.devProbeBindings) {
      const { host, values } = this.devProbeBindings;
      for (const [key, value] of Object.entries(values)) {
        if (host[key] === value) delete host[key];
      }
      this.devProbeBindings = null;
    }
    this.unregisterWebGLContext?.();
    this.unregisterWebGLContext = null;
  }

  private disposeRendererResources(): void {
    if (this.rendererResourcesDisposed) return;
    this.rendererResourcesDisposed = true;
    const cleanupErrors: unknown[] = [];
    const bestEffort = (cleanup: () => void): void => {
      try {
        cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };

    bestEffort(() => this.post?.dispose());
    this.post = null;
    bestEffort(() => this.prewarmRenderTarget?.dispose());
    this.prewarmRenderTarget = null;
    bestEffort(() => this.pmremGenerator?.dispose());
    this.pmremGenerator = null;
    for (const target of this.envRTs.values()) {
      bestEffort(() => target.dispose());
    }
    this.envRTs.clear();
    for (const material of this.prewarmDepthMaterials.values()) {
      bestEffort(() => material.dispose());
    }
    this.prewarmDepthMaterials.clear();
    for (const bubble of this.chatBubbles.values()) bestEffort(() => bubble.el.remove());
    this.chatBubbles.clear();
    for (const id of [...this.views.keys()]) bestEffort(() => this.removeView(id, true));
    this.views.clear();
    for (const pool of this.visualPool.values()) {
      for (const visual of pool) bestEffort(() => visual.dispose());
    }
    this.visualPool.clear();
    this.pooledVisualCount = 0;
    this.objectPool.clear();
    this.clickTargets.length = 0;
    this.gatherNodeMeshes = [];
    this.viewLights.length = 0;
    // The layer is renderer-owned. Clearing it catches a pending DocumentFragment
    // batch or any renderer DOM surface added after the explicit maps above.
    bestEffort(() => this.nameplateLayer.replaceChildren());
    bestEffort(() => this.travelSpeedFx?.dispose());
    bestEffort(() => this.scene.clear());
    const webgl = this.webgl as THREE.WebGLRenderer | undefined;
    if (webgl) {
      bestEffort(() => webgl.setAnimationLoop(null));
      bestEffort(() => webgl.dispose());
    }
    if (cleanupErrors.length > 0) {
      try {
        console.warn('Renderer terminal cleanup completed with failures', cleanupErrors);
      } catch {
        // Reporting must not turn terminal best-effort cleanup into a rejection.
      }
    }
  }

  /**
   * Quiesce this generation and terminally dispose its Three wrapper without
   * losing the underlying WebGL2 context. The caller owns the subsequent
   * WEBGL_lose_context cycle and rebuild on the returned canvas/context pair.
   */
  preflightContextRecycle(): void {
    if (this.shutdownStarted) throw new Error('Renderer is already shutting down');
    if (!this.webgl.capabilities.isWebGL2) throw new Error('Renderer context is not WebGL2');
    const context = this.webgl.getContext() as WebGL2RenderingContext;
    preflightWebGL2ContextRecycle(context);
  }

  shutdown(): Promise<RecycledRendererContext> {
    if (this.shutdownTask) return this.shutdownTask;
    const recycled: RecycledRendererContext = {
      canvas: this.canvas,
      context: this.webgl.getContext() as WebGL2RenderingContext,
    };
    const pending = [
      ...this.pendingZonePrepares.values(),
      ...this.pendingZonePrewarms.values(),
      ...this.textureUploadTaskSet.values(),
    ];
    this.beginRendererShutdown();
    const queueShutdown = this.backgroundGpuWork.shutdown(new Error('Renderer shut down'));
    this.shutdownTask = (async () => {
      await Promise.allSettled([...pending, queueShutdown]);
      this.disposeRendererResources();
      return recycled;
    })();
    return this.shutdownTask;
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

  // Allocate at the manual resolution ceiling. Automatic changes on the supported
  // grade-only path update only the live region below, never target storage.
  private applyResolution(): void {
    const basePixelRatio = Math.min(window.devicePixelRatio, GFX.pixelRatioCap);
    const allocationScale = dynamicResolutionAllocationScale(
      this.post?.supportsDynamicResolution === true,
      this.renderScale,
      this.effectiveRenderScale,
    );
    const ratio = basePixelRatio * allocationScale;
    this.webgl.setPixelRatio(ratio);
    this.webgl.setSize(this.viewport.width, this.viewport.height, false);
    if (this.post) {
      this.post.setSize(this.viewport.width, this.viewport.height, ratio);
    }
    this.applyRenderRegion();
  }

  private applyRenderRegion(): void {
    const post = this.post;
    let devicePxHeight = this.webgl.domElement.clientHeight * this.webgl.getPixelRatio();
    this.renderPixelHeight = this.webgl.domElement.height;
    if (post?.supportsDynamicResolution) {
      const rect = dynamicResolutionRect({
        logicalWidth: this.viewport.width,
        logicalHeight: this.viewport.height,
        pixelRatio: Math.min(window.devicePixelRatio, GFX.pixelRatioCap),
        renderScale: this.effectiveRenderScale,
        maxRenderScale: this.renderBudgetMaxScale(),
        minRenderScale: Math.max(MIN_DYNAMIC_RENDER_SCALE, this.renderBudgetMinScale()),
      });
      post.setRenderRegion(rect);
      this.renderPixelHeight = rect.renderHeight;
      devicePxHeight *= rect.renderHeight / rect.targetHeight;
    }
    this.vfx.setViewportScale(devicePxHeight, 60);
    this.abilityVfxFx.setViewportScale(devicePxHeight, 60);
    // Weapon-skin VFX point sprites size against the device-pixel height too:
    // future rigs read the module value, live rigs re-scale in place.
    setWeaponVfxViewportHeight(devicePxHeight);
    for (const v of this.views.values()) v.visual?.setWeaponVfxPixelScale(devicePxHeight);
  }

  /** Tone-mapping exposure multiplier (1.0 = the default look). */
  setBrightness(mult: number): void {
    this.webgl.toneMappingExposure = this.baseExposure * mult;
  }

  setPlayerAuraRings(rings: readonly PlayerAuraRingInput[]): void {
    this.playerAuraRings.setRings(rings);
  }

  zoneIdAt(x: number, z: number): string | null {
    return x > DUNGEON_X_THRESHOLD ? null : zoneAt(x, z).id;
  }

  isZonePreparedAt(x: number, z: number): boolean {
    const id = this.zoneIdAt(x, z);
    return id === null || this.preparedZones.has(id);
  }

  isZoneReadyAt(x: number, z: number): boolean {
    const id = this.zoneIdAt(x, z);
    return id === null || (this.preparedZones.has(id) && this.prewarmedZonePrograms.has(id));
  }

  zoneStreamingStats(): {
    prepared: number;
    pending: number;
    last: {
      zoneId: string;
      totalMs: number;
      skyMs: number;
      terrainMs: number;
      waterMs: number;
      featuresMs: number;
    } | null;
  } {
    return {
      prepared: this.preparedZones.size,
      pending: this.pendingZonePrepares.size + this.visibleZonePrepareQueue.length,
      last: this.lastZonePrepareStats,
    };
  }

  private ensureEnvironmentBiome(biome: BiomeId): THREE.WebGLRenderTarget | null {
    if (this.lowGfx) return null;
    const existing = this.envRTs.get(biome);
    if (existing) return existing;
    // Constrained WebKit keeps only the entry-built PMREM for the session (see
    // resolveEnvironmentPrefilterPlan): another mip-chained cubemap's transient
    // allocation spike is enough to terminate the WKWebView process.
    if (GFX.constrainedMemory && this.envRTs.size > 0) return null;
    const source = this.skyView.envTexture(biome);
    if (!source) return null;
    let target = this.envRTBySource.get(source);
    if (!target) {
      this.pmremGenerator ??= new THREE.PMREMGenerator(this.webgl);
      target = this.pmremGenerator.fromEquirectangular(source);
      this.envRTBySource.set(source, target);
    }
    this.envRTs.set(biome, target);
    return target;
  }

  /**
   * The sky/IBL half of a zone prepare: the realm's HDRI plus its prefiltered
   * environment. Its own lane, because it is 30 to 70 percent of a prepare and
   * a neighbouring realm's IBL has nothing to do with whether the player can
   * see ground (the fog clamp reads attached terrain chunks). Sky is still
   * needed to RENDER that realm's sky, so zone residency continues to wait for
   * it; only the terrain build was let off the leash.
   */
  private async prepareZoneSky(
    zone: ZoneDef,
    x: number,
    z: number,
    idlePace: boolean,
  ): Promise<void> {
    await ensureSkyAssetsAt(x, z);
    const envSource = this.skyView.envTexture(zone.biome);
    const domeSource = this.skyView.domeTexture(zone.biome);
    if (!idlePace) {
      // Initial entry/teleport is already covered by an opaque loading screen.
      this.ensureEnvironmentBiome(zone.biome);
      this.prewarmTexture(envSource);
      this.prewarmTexture(domeSource);
      return;
    }
    // A DataTexture upload is synchronous even from requestIdleCallback. Newer
    // Three runtimes can split HDRIs into row batches; pinned r165 lacks update
    // ranges and pays one full upload. Either way each atomic WebGL call enters
    // the shared queue so it cannot overlap a live shader compile.
    await this.prewarmTextureInIdle(envSource);
    // PMREM generation is indivisible in Three r165. Defer two timed-out
    // callbacks before deliberately paying that single unit under sustained
    // load, rather than running it on the first forced callback.
    await idleSlot(IDLE_PREWARM_TIMEOUT_MS, { maxTimeoutDeferrals: 2 });
    await this.backgroundGpuWork.run(
      () => this.ensureEnvironmentBiome(zone.biome),
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
    );
    await this.prewarmTextureInIdle(domeSource);
  }

  /**
   * Materialize the terrain, water and bespoke render layer for one overworld
   * zone. Calls for an already-loaded (or currently-loading) zone are cheap and
   * share the same promise, so teleports and boundary jitter cannot duplicate
   * geometry. `opts.pace: 'idle'` marks a background prepare (the visible-zone
   * streaming lane): the terrain build then advances one small batch per
   * browser idle slot instead of racing, so it never steals interactive frame
   * time. (x, z) doubles as the build's priority point, so the chunks nearest
   * the expected entry land first.
   */
  prepareZoneAt(
    x: number,
    z: number,
    onProgress?: (done: number, total: number) => void,
    opts?: { pace?: 'fast' | 'idle' },
  ): Promise<void> {
    if (this.shutdownStarted) return Promise.resolve();
    const zoneId = this.zoneIdAt(x, z);
    if (zoneId === null || this.preparedZones.has(zoneId)) {
      onProgress?.(1, 1);
      return Promise.resolve();
    }
    const pending = this.pendingZonePrepares.get(zoneId);
    if (pending) return pending;
    const zone = zoneAt(x, z);
    const idlePace = opts?.pace === 'idle';
    const task = (async () => {
      const started = performance.now();
      onProgress?.(0, 100);
      let skyMs = 0;
      const skyLane = (async () => {
        await this.prepareZoneSky(zone, x, z, idlePace);
        skyMs = Math.round((performance.now() - started) * 10) / 10;
      })();
      // Mark the lane handled the moment it exists. A background terrain build
      // below can run for tens of seconds, and a rejection sitting un-awaited
      // across that window is reported as an unhandledrejection (the client's
      // fatal overlay) long before the join at the end could catch it.
      void skyLane.catch(() => {});
      // A BACKGROUND prepare does not let sky hold up ground. HDRI plus PMREM
      // is 30 to 70 percent of a prepare (Drakelands measured skyMs 6083 of
      // totalMs 8982) and a NEIGHBOURING realm's IBL has nothing to do with
      // whether the player can see ground: the fog clamp keys off attached
      // terrain chunks, so starting terrain now is what opens the view. The
      // gating path still takes sky first: the player is arriving INTO that
      // sky behind an opaque loading screen, and its bar stays monotonic.
      if (!idlePace) await skyLane;
      onProgress?.(5, 100);
      const terrainStarted = performance.now();
      await this.terrainView.ensureZone(
        zone,
        (done, total) => onProgress?.(5 + Math.round((done / Math.max(1, total)) * 83), 100),
        { priority: { x, z }, pace: opts?.pace },
      );
      // The group itself was frozen while still empty in the constructor.
      // Freeze the children added by this zone as well; subsequent zones are
      // handled by their own prepare pass.
      freezeStaticMatrices(this.terrainView.group);
      const terrainDone = performance.now();
      onProgress?.(89, 100);
      const waterMeshes = await this.waterView.ensureZone(zone, { pace: opts?.pace });
      for (const mesh of waterMeshes) freezeStaticMatrices(mesh);
      const waterDone = performance.now();
      onProgress?.(96, 100);
      this.lastAttachedFeatureGroups = [];
      this.ensureZoneFeatures(zone);
      const featureGroups = this.lastAttachedFeatureGroups.slice();
      // A background prepare precompiles every program this zone just added
      // (water lakes, bespoke biome features), one idle slot apart: a program
      // whose driver link has not finished BLOCKS the main thread at its first
      // draw (getUniforms queries ACTIVE_UNIFORMS synchronously), which was a
      // measured multi-hundred-ms stall per new biome. compileAsync resolves
      // only once the programs report ready, so the live render never pays it.
      if (opts?.pace === 'idle') {
        try {
          await withHiddenPrewarmGroups(featureGroups, async () => {
            if (this.asyncCompileSupported) {
              for (const obj of [...waterMeshes, ...featureGroups]) {
                await idleSlot(IDLE_PREWARM_TIMEOUT_MS, { maxTimeoutDeferrals: 2 });
                // Await the linker before revealing the object or advancing to
                // another unit. Submit one object at a time so live work can
                // jump queued visible-zone prewarm without overlapping it.
                await this.backgroundGpuWork.run(
                  () => this.compilePrewarmColorPrograms(obj, false),
                  GPU_WORK_PRIORITY.VISIBLE_PREWARM,
                );
              }
            }
          });
        } finally {
          // Water meshes from an idle build enter hidden, preventing a live
          // frame from winning the race against compileAsync. Reveal only once
          // the material is linked (or immediately on a non-async renderer).
          for (const mesh of waterMeshes) mesh.visible = true;
        }
      }
      const featuresDone = performance.now();
      // Zone RESIDENCY still means the whole zone, sky included: the HUD map
      // prewarm and the warmup gate both key off it. Only the fog was
      // decoupled, and it now reads chunk residency instead.
      await skyLane;
      const prepareDone = performance.now();
      this.preparedZones.add(zone.id);
      // Presentation layers beyond the renderer (main.ts wires the HUD's map
      // background prewarm here) piggyback on zone residency, so their own
      // caches are warm before the player can interact with the new zone.
      this.onZonePrepared?.(zone.id);
      // On a background prepare skyMs OVERLAPS terrainMs (the lanes run
      // concurrently), so the stages no longer sum to totalMs. Each is still
      // its own lane's wall time, which is what the pacing work reads them for.
      this.lastZonePrepareStats = {
        zoneId: zone.id,
        totalMs: Math.round((prepareDone - started) * 10) / 10,
        skyMs,
        terrainMs: Math.round((terrainDone - terrainStarted) * 10) / 10,
        waterMs: Math.round((waterDone - terrainDone) * 10) / 10,
        featuresMs: Math.round((featuresDone - waterDone) * 10) / 10,
      };
      onProgress?.(100, 100);
    })().finally(() => this.pendingZonePrepares.delete(zoneId));
    this.pendingZonePrepares.set(zoneId, task);
    return task;
  }

  /** Stage wall-times of the most recent prewarmZoneAt, for perf tooling. */
  lastZonePrewarmStats: {
    zoneId: string;
    buildMs: number;
    compileMs: number;
    passMs: number;
  } | null = null;

  async prewarmZoneAt(x: number, z: number, opts?: { background?: boolean }): Promise<void> {
    if (this.shutdownStarted) return;
    const zoneId = this.zoneIdAt(x, z);
    if (zoneId === null || this.prewarmedZonePrograms.has(zoneId)) return;
    const pending = this.pendingZonePrewarms.get(zoneId);
    if (pending) return pending;
    const task = (async () => {
      const zone = zoneAt(x, z);
      const deadline = performance.now() + 5000;
      const t0 = performance.now();
      const mobPrewarm = this.buildEntityPrewarmGroup(zone);
      const npcPrewarm = this.buildNpcPrewarmGroup(zone, deadline);
      const mobGroup = mobPrewarm.group;
      const npcGroup = npcPrewarm.group;
      // Hide before scene attachment. The shared GPU queue may be occupied by
      // sky/feature work for many frames before runBackgroundPrewarm starts.
      mobGroup.visible = false;
      npcGroup.visible = false;
      this.scene.add(mobGroup, npcGroup);
      const tBuild = performance.now();
      let tCompile = tBuild;
      try {
        // A background prewarm (the visible-zone streaming lane) links the new
        // programs off-thread BEFORE the warm pass renders with them, so the
        // pass never compiles inside a live gameplay frame. Compile the PREWARM
        // GROUPS, one idle slot apart, never the whole scene: compileAsync's
        // synchronous prologue walks and re-initializes every material it is
        // handed, and a full-scene walk was a measured multi-hundred-ms stall
        // per streamed zone. Live frames keep rendering across that whole
        // awaited window, so runBackgroundPrewarm keeps both groups invisible
        // between its bounded child uploads (a visible group is a grid of T-posed
        // rigs stacked next to the player). The gating path (behind the loading
        // screen) keeps render-first, which also covers renderers without
        // KHR_parallel_shader_compile.
        if (opts?.background) {
          await runBackgroundPrewarm([mobGroup, npcGroup], {
            supportsAsyncCompile: this.asyncCompileSupported,
            idleSlot: () =>
              idleSlot(IDLE_PREWARM_TIMEOUT_MS, {
                maxTimeoutDeferrals: 2,
              }),
            compileChild: async (child) => {
              const childRoot = child as THREE.Object3D;
              await this.backgroundGpuWork.run(
                () => this.compilePrewarmColorPrograms(childRoot, true),
                GPU_WORK_PRIORITY.VISIBLE_PREWARM,
              );
              await this.backgroundGpuWork.run(
                () => this.compileSkinnedShadowPrograms(childRoot),
                GPU_WORK_PRIORITY.VISIBLE_PREWARM,
              );
            },
            prepareChildAssets: (child) => {
              this.prewarmObjectTextures(child as THREE.Object3D);
            },
            warmChild: (groupLike, child) => {
              const group = groupLike as THREE.Group;
              const childRoot = child as THREE.Object3D;
              this.renderBoundedPrewarmRoot(group, childRoot);
            },
            renderWarmPass: () => {
              tCompile = performance.now();
              this.renderPrewarmPass(1 / 60, { offscreen: true });
            },
            runUpload: (work) =>
              this.backgroundGpuWork.run(work, GPU_WORK_PRIORITY.VISIBLE_PREWARM),
          });
          tCompile = performance.now();
        } else {
          mobGroup.visible = true;
          npcGroup.visible = true;
          tCompile = performance.now();
          this.renderPrewarmPass(1 / 60);
          // The gating path compiles after the pass, exactly as before.
          if (this.asyncCompileSupported) {
            await this.compilePrewarmColorPrograms(this.scene, false);
          }
        }
        this.prewarmedZonePrograms.add(zoneId);
      } finally {
        mobGroup.removeFromParent();
        npcGroup.removeFromParent();
        // Only publish visuals to the live pool after the warm pass. Background
        // gameplay can otherwise take one out of its T-pose grid while the
        // prewarm awaits idle compile slots, leaving its shadow variant cold.
        for (const item of mobPrewarm.pooled) this.storePooledVisual(item.key, item.visual);
        for (const item of npcPrewarm.pooled) this.storePooledVisual(item.key, item.visual);
        this.lastZonePrewarmStats = {
          zoneId,
          buildMs: Math.round(tBuild - t0),
          compileMs: Math.round(tCompile - tBuild),
          passMs: Math.round(performance.now() - tCompile),
        };
      }
    })().finally(() => this.pendingZonePrewarms.delete(zoneId));
    this.pendingZonePrewarms.set(zoneId, task);
    return task;
  }

  /** Blocking-path neighborhood prepare for a teleport ARRIVAL (the rift exit):
   * materialize every overworld zone within `radius` of the landing point,
   * nearest first, so the residency fog clamp is already OPEN when the loading
   * screen lifts. Landing with unprepared neighbors pulls the fog into a tight
   * wall that eases open over seconds and reads as "standing in water"; this
   * pays that cost behind the screen instead. Cheap when the neighborhood is
   * already resident (prepareZoneAt dedupes by zone id). */
  async prepareZonesAround(
    x: number,
    z: number,
    radius: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    if (this.shutdownStarted) return;
    const worldZones = this.sim.cfg.world?.zones ?? ZONES;
    const zones = zonesWithinStreamingHorizon(worldZones, x, z, radius);
    let done = 0;
    for (const zone of zones) {
      await this.prepareZoneAt(zone.hub.x, zone.hub.z);
      onProgress?.(++done, zones.length);
    }
  }

  // Recompute the background prepare queue from the RELAXED fog horizon (the
  // biome preset request, not the clamped live fog: the clamp only engages
  // because a zone is unprepared, which is exactly what this lane fixes).
  // Cheap frame-loop guard: skip until the camera has travelled a bit or the
  // horizon changed. Runs from sync(), one zone in flight at a time.
  private queueVisibleZonePrepares(horizon: number): void {
    const player = this.sim.player;
    if (this.fogState !== 'outdoor' || this.zoneIdAt(player.pos.x, player.pos.z) === null) {
      this.visibleZonePrepareQueue = [];
      return;
    }
    const cameraX = this.camera.position.x;
    const cameraZ = this.camera.position.z;
    const moved = Math.hypot(cameraX - this.visibleZoneCheckX, cameraZ - this.visibleZoneCheckZ);
    if (
      Number.isFinite(this.visibleZoneCheckX) &&
      moved < ZONE_STREAM_RECHECK_DISTANCE &&
      Math.abs(horizon - this.visibleZoneCheckFar) < 1
    ) {
      return;
    }
    this.visibleZoneCheckX = cameraX;
    this.visibleZoneCheckZ = cameraZ;
    this.visibleZoneCheckFar = horizon;
    const forwardX = this.cameraLookAt.x - cameraX;
    const forwardZ = this.cameraLookAt.z - cameraZ;
    this.visibleZonePrepareQueue = zonesWithinStreamingHorizon(
      ZONES,
      cameraX,
      cameraZ,
      horizon,
      forwardX,
      forwardZ,
    ).filter((zone) => !this.preparedZones.has(zone.id) && !this.pendingZonePrepares.has(zone.id));
    this.pumpVisibleZonePrepareQueue();
  }

  private pumpVisibleZonePrepareQueue(): void {
    if (this.shutdownStarted) return;
    if (this.visibleZonePrepareActive) return;
    const zone = this.visibleZonePrepareQueue.shift();
    if (!zone) return;
    if (this.preparedZones.has(zone.id) || this.pendingZonePrepares.has(zone.id)) {
      this.pumpVisibleZonePrepareQueue();
      return;
    }
    this.visibleZonePrepareActive = true;
    // The likely entry point is where the zone's rectangle sits closest to the
    // camera, so prioritize the build there (not at the hub, which can be on
    // the far side of the zone). zoneEntryPoint's one-yard inset keeps the
    // point resolving to THIS zone (see its doc: an entry point resolving to
    // the neighbour would no-op the prepare and starve this queue entry).
    const { x: entryX, z: entryZ } = zoneEntryPoint(
      zone,
      this.camera.position.x,
      this.camera.position.z,
    );
    // Entity programs do not depend on terrain residency. Start their idle
    // compile beside (not after) the often multi-second terrain build, or the
    // first mob can enter interest range before its zone prewarm even starts.
    const prepare = this.prepareZoneAt(entryX, entryZ, undefined, { pace: 'idle' });
    const prewarm = this.prewarmZoneAt(entryX, entryZ, { background: true });
    void Promise.all([prepare, prewarm])
      .then(() => {
        if (!this.preparedZones.has(zone.id)) {
          // The entry point resolved to some other zone: this queue entry was
          // consumed without making its zone resident (the starvation class
          // the entry-point inset above exists to prevent).
          console.warn(`Visible-zone prepare resolved without residency: ${zone.id}`);
        }
      })
      .catch((err) => {
        console.warn(`Visible-zone preparation failed: ${zone.id}`, err);
        // Permit a retry on the next frame even if the camera has not moved.
        this.visibleZoneCheckX = Number.NaN;
      })
      .finally(() => {
        this.visibleZonePrepareActive = false;
        this.pumpVisibleZonePrepareQueue();
      });
  }

  // Groups attachZoneFeature added during the current ensureZoneFeatures pass:
  // a background prepare precompiles their programs (see prepareZoneAt), so a
  // new biome's bespoke feature shaders never first-draw inside a live frame.
  // Constructor-time attaches (the world-spanning dressing) land here too but
  // are reset before the first prepare: those compile with the boot warmup.
  private lastAttachedFeatureGroups: THREE.Group[] = [];

  // Every attached feature group with its world XZ footprint, for the
  // per-frame distance cull in updateZoneFeatureVisibility. Measured ONCE here:
  // these groups are static and matrix-frozen, so the bounds never move.
  private zoneFeatureGroups: { group: THREE.Group; footprint: FeatureFootprint | null }[] = [];

  private attachZoneFeature(
    view: { group: THREE.Group; glowLights?: THREE.PointLight[]; cullGroups?: THREE.Group[] },
    freeze = true,
  ): void {
    setRenderCategory(view.group, 'props');
    this.scene.add(view.group);
    // Point lights ride the fireLights budget, NEVER the cull-toggled group
    // (the Sowfield brazier rule). A light left inside the group leaves the
    // render light list whenever the distance cull hides its ancestor, so the
    // pinned numPointLights changes and every lit material recompiles: the
    // open-world travel freeze the budget exists to prevent. Reparent every
    // PointLight descendant to the scene mechanically, so the NEXT feature
    // builder that parents a glow into its group cannot reintroduce it.
    const strandedLights: THREE.PointLight[] = [];
    view.group.traverse((obj) => {
      if ((obj as THREE.PointLight).isLight) strandedLights.push(obj as THREE.PointLight);
    });
    for (const light of strandedLights) {
      light.getWorldPosition(this.tmpV);
      this.scene.add(light); // add() detaches from the old parent
      light.position.copy(this.tmpV);
    }
    if (freeze) freezeStaticMatrices(view.group);
    for (const light of view.glowLights ?? []) this.fireLights.push(light);
    this.lightRankDirty = true;
    this.lastAttachedFeatureGroups.push(view.group);
    // A view spanning several regions registers each child for the distance
    // cull instead of the whole group: one world-wide footprint can never be
    // culled (water-flora was 10.96M triangles submitted from every realm).
    for (const cullGroup of view.cullGroups ?? [view.group]) {
      // Footprints are measured ONCE at attach, so an InstancedMesh whose
      // matrices are still factory zeros poisons the measurement silently
      // (the seabird flock parked a footprint at the world origin this way).
      cullGroup.traverse((obj) => {
        const inst = obj as THREE.InstancedMesh;
        if (!inst.isInstancedMesh) return;
        if (hasUnseededInstanceMatrix(inst.instanceMatrix.array, inst.count)) {
          console.error(
            `attachZoneFeature: "${cullGroup.name}" holds an InstancedMesh with unseeded ` +
              'instance matrices; seed placements before attach or its cull footprint is wrong',
          );
        }
      });
      this.zoneFeatureGroups.push({
        group: cullGroup,
        footprint: measureFeatureFootprint(cullGroup),
      });
    }
  }

  // Hide feature groups the fog has already swallowed. Terrain and foliage both
  // did this; zone features never did, so ~40M triangles of towns, mazes and
  // flora for zones the player could not see were submitted every frame (see
  // zone_feature_visibility_core.ts for the measurements).
  private updateZoneFeatureVisibility(fogFar: number): void {
    const camX = this.camera.position.x;
    const camZ = this.camera.position.z;
    for (const entry of this.zoneFeatureGroups) {
      entry.group.visible = isZoneFeatureVisible(entry.footprint, camX, camZ, fogFar);
    }
  }

  private ensureZoneFeatures(zone: ZoneDef): void {
    switch (zone.biome) {
      case 'dusk':
        if (!this.realmFlora) {
          this.realmFlora = buildRealmFlora(this.sim.cfg.seed);
          this.attachZoneFeature(this.realmFlora);
          // the freeze above stills the whole subtree; foam swell and mist
          // drift move via object transforms, so they get their motion back
          // (the props.flames idiom)
          for (const moving of this.realmFlora.animated) moving.matrixAutoUpdate = true;
        }
        break;
      case 'ember':
        if (!this.emberFeatures) {
          this.emberFeatures = buildEmberFeatures(this.sim.cfg.seed);
          this.attachZoneFeature(this.emberFeatures);
        }
        if (!this.castleFeatures) {
          this.castleFeatures = buildCastleFeatures();
          this.attachZoneFeature(this.castleFeatures);
        }
        break;
      case 'frost':
        if (!this.frostSky) {
          this.frostSky = buildFrostSky(this.sim.cfg.seed);
          this.attachZoneFeature(this.frostSky, false);
        }
        break;
      case 'fen':
        if (!this.fenFeatures) {
          this.fenFeatures = buildFenFeatures(this.sim.cfg.seed);
          this.attachZoneFeature(this.fenFeatures);
        }
        break;
      case 'amber':
        if (!this.amberFeatures) {
          this.amberFeatures = buildAmberFeatures(this.sim.cfg.seed);
          this.attachZoneFeature(this.amberFeatures);
        }
        break;
      case 'night':
        if (!this.nightFeatures) {
          this.nightFeatures = buildNightFeatures(this.sim.cfg.seed);
          this.attachZoneFeature(this.nightFeatures);
        }
        break;
      case 'haunt':
        if (!this.hauntFeatures) {
          this.hauntFeatures = buildHauntFeatures(this.sim.cfg.seed);
          this.attachZoneFeature(this.hauntFeatures, false);
        }
        break;
      case 'jungle':
        if (!this.jungleFeatures) {
          this.jungleFeatures = buildJungleFeatures(this.sim.cfg.seed);
          this.attachZoneFeature(this.jungleFeatures);
        }
        break;
      case 'garden':
        if (!this.gardenFeatures) {
          this.gardenFeatures = buildGardenFeatures(this.sim.cfg.seed);
          this.attachZoneFeature(this.gardenFeatures);
        }
        break;
      case 'gale':
        if (!this.galeFeatures) {
          this.galeFeatures = buildGaleFeatures(this.sim.cfg.seed);
          this.attachZoneFeature(this.galeFeatures, false);
        }
        break;
      default:
        break;
    }
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
  // Ground impact dust at a body's feet, coloured by the surface underfoot.
  // Water is skipped: splashes are the water system's job, and dust on a lake
  // reads as a bug. Power below the floor emits nothing at all.
  private emitGroundPuff(x: number, y: number, z: number, power: number): void {
    const p = Math.min(1, power);
    if (p <= 0.02) return;
    const surface = this.surfaceAt(x, z, y);
    if (surface === 'water') return;
    const color =
      surface === 'stone'
        ? 0x9b9a95
        : surface === 'wood'
          ? 0xa8895f
          : surface === 'snow'
            ? 0xe6eef5
            : surface === 'dirt'
              ? 0xa38257
              : 0x8d9a63;
    this.tmpPuff.set(x, y, z);
    this.vfx.groundPuff(this.tmpPuff, p, color);
  }

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
    this.renderBudgetState = this.renderBudgetGovernor.reset(
      this.effectiveRenderScale,
      this.renderBudgetMinScale(),
      this.renderBudgetMaxScale(),
    );
    this.applyRenderBudgetState(this.renderBudgetState);
    this.applyResolution();
  }

  private isMobileRuntime(): boolean {
    return document.body.classList.contains('mobile-touch');
  }

  private initialEffectiveRenderScale(scale: number): number {
    const forcedTier = urlForcedTier();
    if (
      this.isMobileRuntime() &&
      forcedTier !== 'high' &&
      forcedTier !== 'ultra' &&
      forcedTier !== 'insane'
    )
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
      ? Math.abs(state.levels.grass - previousLevels.grass) >= 0.001 ||
        Math.abs(state.levels.foliage - previousLevels.foliage) >= 0.001 ||
        Math.abs(state.levels.vfx - previousLevels.vfx) >= 0.001 ||
        Math.abs(state.levels.lighting - previousLevels.lighting) >= 0.001 ||
        Math.abs(state.levels.resolution - previousLevels.resolution) >= 0.001
      : true;
    if (levelsChanged) {
      const nextLevels = { ...state.levels };
      this.lastQualityChange = {
        atMs: performance.now(),
        ageMs: 0,
        mode: state.mode,
        reason: state.reason,
        previousLevels: previousLevels ?? nextLevels,
        levels: nextLevels,
      };
      this.appliedBudgetLevels = nextLevels;
    }
    this.effectiveRenderScale = Math.min(
      this.renderBudgetMaxScale(),
      Math.max(this.renderBudgetMinScale(), state.levels.resolution),
    );
    this.lastBudgetPressure = state.pressure;
    this.foliage.setGrassQuality(state.levels.grass);
    this.foliage.setModelQuality(state.levels.foliage);
    this.vfx.setQuality(state.levels.vfx);
    this.abilityVfx.setQuality(state.levels.vfx);
    this.effectivePointLights = Math.max(1, Math.round(GFX.maxPointLights * state.levels.lighting));
    if (
      Math.abs(previousScale - this.effectiveRenderScale) >= 0.001 &&
      this.post?.supportsDynamicResolution
    ) {
      this.applyRenderRegion();
    }
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
        nativeIosMemoryProfile: boolean;
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
    pooledVisuals: number;
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
    const drawStatsFrame = this.drawStats ? this.drawStats.currentFrame() : null;
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
          nativeIosMemoryProfile: GFX.nativeIosMemoryProfile,
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
      // Composer tiers serve the accumulated per-frame delta (the live counter is
      // monotonic there, so it already includes the off-screen water-simulation
      // passes); other profiles keep the live post-frame read, where three's
      // per-render auto-reset drops those passes, so add them back at 1 draw call
      // and 2 triangles each.
      calls: drawStatsFrame
        ? drawStatsFrame.calls
        : info.render.calls + this.lastWaterSimulationPasses,
      triangles: drawStatsFrame
        ? drawStatsFrame.triangles
        : info.render.triangles + this.lastWaterSimulationPasses * 2,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      views: this.views.size,
      pooledVisuals: this.pooledVisualCount,
      foliage: this.foliage.perfStats(),
      glVendor: this.glVendor,
      glRenderer: this.glRenderer,
      contextLost: this.contextLostCount,
      contextRestored: this.contextRestoredCount,
      phaseMs: this.rendererPhaseStats(),
      renderDiagnostics: this.lastFrameStats.renderDiagnostics,
      lastFrame: this.snapshotLastFrameStats(),
      prewarm: this.lastPrewarmStats,
    };
  }

  /** Overlay-gated hitch correlation: enabled by the ?perf monitor only. */
  setHitchLogEnabled(enabled: boolean): void {
    if (this.hitchLogEnabled && !enabled) this.hitchTracker.reset();
    this.hitchLogEnabled = enabled;
  }

  hitchStats(): HitchSummary | null {
    return this.hitchLogEnabled ? this.hitchTracker.summary() : null;
  }

  /**
   * One-shot MEASURED scene census (scene_census_core): per-category draw
   * calls and triangles via bucket-visibility diffs through the real pipeline
   * (composer and shadow passes included), plus the shadow pass share via a
   * frozen-shadow render. On demand only (the ?perf overlay census button and
   * the capture harness); the burst is excluded from the live draw-stats
   * delta via discardOutOfBandDraws.
   */
  captureSceneCensus(): SceneCensusReport {
    const info = this.webgl.info;
    const children: SceneCensusChild[] = [];
    for (const child of this.scene.children) {
      // Lights stay untouched: hiding one changes the lighting state hash and
      // recompiles programs mid-census, which would poison the diffs.
      if ((child as { isLight?: boolean }).isLight) continue;
      children.push({
        category:
          typeof child.userData.renderCategory === 'string'
            ? (child.userData.renderCategory as string)
            : 'unknown',
        get visible() {
          return child.visible;
        },
        setVisible(visible: boolean) {
          child.visible = visible;
        },
      });
    }
    const host: SceneCensusHost = {
      children: () => children,
      render: () => {
        if (this.post) this.post.render();
        else this.webgl.render(this.scene, this.camera);
      },
      counters: () => ({
        calls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
      }),
      resetCounters: () => info.reset(),
      countersAutoReset: () => info.autoReset,
      setCountersAutoReset: (autoReset: boolean) => {
        info.autoReset = autoReset;
      },
      programCount: () => info.programs?.length ?? 0,
      textureCount: () => info.memory.textures,
      geometryCount: () => info.memory.geometries,
      shadowsEnabled: () => this.webgl.shadowMap.enabled,
      shadowAutoUpdate: () => this.webgl.shadowMap.autoUpdate,
      setShadowAutoUpdate: (autoUpdate: boolean) => {
        this.webgl.shadowMap.autoUpdate = autoUpdate;
      },
      discardOutOfBand: () => this.discardOutOfBandDraws(),
    };
    const p = this.sim.player;
    try {
      return captureSceneCensus(host, {
        atMs: performance.now(),
        tier: GFX.tier,
        playerPosition: { x: roundMs(p.pos.x), y: roundMs(p.pos.y), z: roundMs(p.pos.z) },
        cameraPosition: {
          x: roundMs(this.camera.position.x),
          y: roundMs(this.camera.position.y),
          z: roundMs(this.camera.position.z),
        },
      });
    } finally {
      this.hitchSkipNextFrame = true;
    }
  }

  private recordRendererPhase(phase: RendererPhase, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.phaseSamples[phase].push(Math.min(250, ms));
  }

  private markRendererPhase(
    out: RendererFramePhaseMs,
    phase: RendererPhase,
    start: number,
  ): number {
    const now = performance.now();
    const ms = now - start;
    out[phase] = roundMs(ms);
    this.recordRendererPhase(phase, ms);
    return now;
  }

  private markRendererWorldPhase(
    out: RendererWorldPhaseMs,
    phase: RendererWorldPhase,
    start: number,
  ): number {
    const now = performance.now();
    out[phase] += roundMs(now - start);
    return now;
  }

  private rendererPhaseStats(): RendererPhaseStats {
    return {
      setup: summarizeMs(this.phaseSamples.setup.toArray()),
      entities: summarizeMs(this.phaseSamples.entities.toArray()),
      world: summarizeMs(this.phaseSamples.world.toArray()),
      nameplates: summarizeMs(this.phaseSamples.nameplates.toArray()),
      submit: summarizeMs(this.phaseSamples.submit.toArray()),
      total: summarizeMs(this.phaseSamples.total.toArray()),
    };
  }

  private snapshotLastFrameStats(): RendererFrameStats {
    const frame = this.lastFrameStats;
    const foliage = frame.foliage;
    const qualityChange = frame.lastQualityChange;
    return {
      phaseMs: { ...frame.phaseMs },
      worldPhaseMs: { ...frame.worldPhaseMs },
      foliage: {
        ...foliage,
        modelBucketsByLod: { ...foliage.modelBucketsByLod },
        modelVisibleByLod: { ...foliage.modelVisibleByLod },
        modelDrawsByLod: { ...foliage.modelDrawsByLod },
        modelVisibleDrawsByLod: { ...foliage.modelVisibleDrawsByLod },
        modelTrianglesByLod: { ...foliage.modelTrianglesByLod },
        modelVisibleTrianglesByLod: { ...foliage.modelVisibleTrianglesByLod },
      },
      renderDiagnostics: frame.renderDiagnostics,
      cameraPosition: { ...frame.cameraPosition },
      playerPosition: { ...frame.playerPosition },
      biome: frame.biome,
      lastQualityChange: qualityChange
        ? {
            ...qualityChange,
            previousLevels: { ...qualityChange.previousLevels },
            levels: { ...qualityChange.levels },
          }
        : null,
      createdViews: frame.createdViews,
      createdViewTypes: [...frame.createdViewTypes],
      removedViews: frame.removedViews,
      candidateViews: frame.candidateViews,
      activeViews: frame.activeViews,
      visibleViews: frame.visibleViews,
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
    if (!this.renderDiagnosticsEnabled) return this.renderDiagnosticsSnapshot;
    const info = this.webgl.info;
    const programs = info.programs?.length ?? 0;
    const textures = info.memory.textures;
    const programDelta = programs - this.renderDiagnosticsLastPrograms;
    const textureDelta = textures - this.renderDiagnosticsLastTextures;
    this.renderDiagnosticsLastPrograms = programs;
    this.renderDiagnosticsLastTextures = textures;

    type MutableCategoryStats = RenderDiagnosticsCategoryStats & {
      materialKeys: Set<string>;
    };
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
    if (!this.renderDiagnosticsEnabled) return this.renderDiagnosticsSnapshot;
    if (force) {
      this.renderDiagnosticsSnapshot = this.collectRenderDiagnostics();
      this.renderDiagnosticsNextSampleAt = now + RENDER_DIAGNOSTICS_SAMPLE_MS;
      return this.renderDiagnosticsSnapshot;
    }
    if (!this.renderDiagnosticsSamplePending && now >= this.renderDiagnosticsNextSampleAt) {
      this.renderDiagnosticsSamplePending = true;
      this.renderDiagnosticsNextSampleAt = now + RENDER_DIAGNOSTICS_SAMPLE_MS;
      const generation = this.lifecycleGeneration;
      const run = (): void => {
        if (this.shutdownStarted || generation !== this.lifecycleGeneration) return;
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
        win.requestIdleCallback(run, {
          timeout: RENDER_DIAGNOSTICS_IDLE_TIMEOUT_MS,
        });
      else window.setTimeout(run, 100);
    }
    return this.renderDiagnosticsSnapshot;
  }

  private updateAdaptiveResolution(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const frameMs = Math.min(250, dt * 1000);
    const info = this.webgl.info;
    // Grade-only chains can vary a fixed target's viewport and upscale through
    // OutputGradePass. Direct-to-canvas profiles have no upscale pass. N8AO,
    // bloom, and SMAA sample neighboring full-target texels, so their chains stay
    // locked until every internal target and depth read can honor the live rect.
    const dynamicResolution = this.post?.supportsDynamicResolution === true;
    const resolutionRange = dynamicResolutionGovernorRange(
      dynamicResolution,
      this.effectiveRenderScale,
      this.renderBudgetMinScale(),
      this.renderBudgetMaxScale(),
    );
    // Post-processing tiers route the measured logical frame through the
    // session's governor signal. Direct profiles keep Three's live read.
    const drawSignal = this.drawStats ? this.drawStats.governorSignal(GFX.tier) : info.render;
    const sample = this.renderBudgetSample;
    sample.dt = dt;
    sample.frameMs = frameMs;
    // Non-composer profiles read info.render live, where three's per-render
    // auto-reset drops the off-screen water-simulation passes: add them back
    // (1 draw call / 2 triangles per pass). Composer tiers pass drawSignal
    // through untouched, and their water passes are already present in
    // the logical-frame session, so they must not be counted twice.
    sample.calls = drawSignal.calls + (this.drawStats ? 0 : this.lastWaterSimulationPasses);
    sample.triangles =
      drawSignal.triangles + (this.drawStats ? 0 : this.lastWaterSimulationPasses * 2);
    sample.grassVisibleTufts = this.lastFrameStats.foliage.grassVisibleTufts;
    sample.grassVisibleChunks = this.lastFrameStats.foliage.grassVisibleChunks;
    sample.activeViews = this.lastFrameStats.activeViews;
    sample.createdViews = this.lastFrameStats.createdViews;
    sample.minRenderScale = resolutionRange.minRenderScale;
    sample.maxRenderScale = resolutionRange.maxRenderScale;
    const state = this.renderBudgetGovernor.update(sample, this.renderBudgetState);
    this.frameMsEma = state.frameMsEma;
    this.adaptiveCooldown = state.cooldownSeconds;
    this.stableFrameTime = state.stableSeconds;
    if (this.adaptiveGrace > 0) this.adaptiveGrace = Math.max(0, this.adaptiveGrace - dt);
    this.applyRenderBudgetState(state);
  }

  private runtimeViewCreateBudget(dt: number): number {
    const normalBase = this.lowGfx ? VIEW_CREATE_BUDGET_LOW : VIEW_CREATE_BUDGET_HIGH;
    const base = constrainedEntryViewCreateBudget(
      GFX.constrainedMemory,
      this.runtimeEntryElapsedMs,
      normalBase,
    );
    if (base === 0) return 0;
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
    const landmarkPriority = interactionLandmarkViewPriority(e.templateId, d2);
    if (landmarkPriority !== null) return landmarkPriority;
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
    let count = 0;
    for (const e of this.sim.entities.values()) {
      if (this.views.has(e.id)) continue;
      const required = e.id === center.id || e.id === center.targetId;
      if (required && !includeRequired) continue;
      const d2 = distSqXZ(e, center);
      if (!required && d2 > rangeSq) continue;
      writeViewCandidate(
        this.viewCandidatePool,
        this.viewCandidates,
        count,
        e.id,
        d2,
        this.viewCandidatePriority(e, center, d2),
      );
      count++;
    }
    finishViewCandidates(this.viewCandidates, count);
  }

  private createdViewType(e: Entity): string {
    const id = e.templateId || e.kind;
    return `${e.kind}:${id}`.slice(0, 64);
  }

  private sampleCreatedViewType(into: string[], e: Entity): void {
    if (into.length < VIEW_CREATED_TYPE_SAMPLE_LIMIT) into.push(this.createdViewType(e));
  }

  private createRequiredView(
    id: number | null,
    createdViewTypes: string[],
    nameplateParent: ParentNode,
  ): number {
    if (id === null) return 0;
    const e = this.sim.entities.get(id);
    if (!e || this.views.has(e.id)) return 0;
    if (!this.viewCreateRetry.canAttempt(e.id, 'view', performance.now())) return 0;
    this.createView(e, nameplateParent);
    this.sampleCreatedViewType(createdViewTypes, e);
    return 1;
  }

  private createRequiredViews(
    player: Entity,
    createdViewTypes: string[],
    nameplateParent: ParentNode = this.nameplateLayer,
  ): number {
    return (
      this.createRequiredView(player.id, createdViewTypes, nameplateParent) +
      this.createRequiredView(player.targetId, createdViewTypes, nameplateParent)
    );
  }

  private async createMandatoryLandmarkViews(
    player: Entity,
    createdViewTypes: string[],
  ): Promise<{ created: number; ids: number[] }> {
    const mandatory = partitionMandatoryLandmarkCandidates(
      this.sim.entities.values(),
      player.pos,
    ).mandatory;
    const ids = mandatory.map((entity) => entity.id);
    const compileWaits: Promise<void>[] = [];
    let created = 0;
    for (const entity of mandatory) {
      let view = this.views.get(entity.id);
      if (!view) {
        this.createView(entity);
        view = this.views.get(entity.id);
        if (view) {
          this.sampleCreatedViewType(createdViewTypes, entity);
          created++;
        }
      }
      if (view?.compileReady) compileWaits.push(view.compileReady);
    }
    // Parallel compile resolves, rejects, or clears through the per-view 1500ms
    // fail-soft guard. Without parallel compile there are no promises and the
    // views begin ready for the per-entry synchronous link pass.
    await Promise.all(compileWaits);
    if (!mandatoryLandmarkViewsReady(ids, this.views)) {
      throw new Error('Mandatory interaction landmark views did not become ready');
    }
    return { created, ids };
  }

  private createPersistentPortalViews(
    createdViewTypes: string[],
    deadlineMs: number,
    maxViews: number,
  ): number {
    const limit = Math.min(PERSISTENT_PORTAL_VIEW_PREWARM_LIMIT, Math.max(0, Math.floor(maxViews)));
    let created = 0;
    for (const e of this.sim.entities.values()) {
      if (created >= limit || performance.now() >= deadlineMs) break;
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
    nameplateParent: ParentNode = this.nameplateLayer,
  ): number {
    const max = Math.max(0, Math.floor(limit));
    let created = 0;
    for (const candidate of this.viewCandidates) {
      if (created >= max || performance.now() >= deadlineMs) break;
      const e = this.sim.entities.get(candidate.id);
      if (!e || this.views.has(e.id)) continue;
      // a recent failed build (assets unavailable) sits out its cooldown so it
      // cannot burn a budget slot every frame
      if (!this.viewCreateRetry.canAttempt(e.id, 'view', performance.now())) continue;
      this.createView(e, nameplateParent);
      this.sampleCreatedViewType(createdViewTypes, e);
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
    const fogFar = (this.scene.fog as THREE.Fog).far;
    // The foliage LOD swaps real trees for impostors relative to the fog, not at
    // a fixed distance, so it needs both planes (src/render/foliage_lod.ts).
    const fogNear = (this.scene.fog as THREE.Fog).near;
    const projectionPixels = projectionScalePixels(
      this.camera.projectionMatrix.elements[5],
      this.renderPixelHeight,
    );
    this.lastWaterSimulationPasses = this.waterView.update(
      this.time,
      this.camera.position.x,
      this.camera.position.z,
      fogFar,
    );
    this.terrainView.update(this.camera.position.x, this.camera.position.z, fogFar);
    this.updateZoneFeatureVisibility(fogFar);
    this.propsView.update(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      this.cameraLookAt.x,
      this.cameraLookAt.y,
      this.cameraLookAt.z,
      fogFar,
      dt,
      this.reducedMotion(),
    );
    this.eastbrookTownView.update(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      this.cameraLookAt.x,
      this.cameraLookAt.y,
      this.cameraLookAt.z,
      fogFar,
      dt,
      this.reducedMotion(),
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
      fogNear,
      fogFar,
      this.lastRequestedFogNear,
      this.lastRequestedFogFar,
      projectionPixels,
      dt,
      this.reducedMotion(),
    );
    this.fish.update(p.pos.x, p.pos.z, dt);
    this.abilityVfx.update(dt);
    this.vfx.update(dt);
    this.vfx.prepareDraw(this.camera);
    this.frozenOrbFx.update(dt);
    this.mageGroundFx.update(dt);
    this.ringOfFrostVisuals.sync(this.sim.activeFrostRings);
    this.ringOfFrostVisuals.update(dt);
    if (this.riftDeathZoneVisuals) {
      this.riftDeathZoneVisuals.sync(this.sim.riftBossDeathZones());
      this.riftDeathZoneVisuals.update(dt);
    }
    this.temporalHourglassGroundVisuals.sync(this.sim.activeTemporalHourglasses);
    this.temporalHourglassGroundVisuals.update(dt);
    this.glacialFrontVisual.updateCharge(p, dt, groundHeight(p.pos.x, p.pos.z, this.sim.cfg.seed));
    this.glacialFrontVisual.update(dt);
    this.lightPulses.update(dt);
    const pv = this.views.get(p.id);
    if (pv) {
      const pp = pv.group.position;
      this.updateKeyLight(pp);
    }
    this.jailScene.updateVisibility(this.camera, this.sun);
    if (this.sun.castShadow) {
      this.shadowLightDirection.subVectors(this.sun.position, this.sun.target.position).normalize();
      this.gatherNodes.updateShadowVisibility(this.camera, this.shadowLightDirection, true);
      this.valeCupStadium.updateShadowVisibility(this.camera, this.shadowLightDirection, true);
    }
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    // The dome rides the camera, so it also serves Wildheart's open-air field.
    this.sky.visible = this.fogState === 'outdoor' || this.fogState === 'wildheartField';
    if (this.sky.visible) {
      this.skyView.setCameraPos(this.camera.position.x, this.camera.position.z, dt);
      if (!this.lowGfx) {
        this.skyView.setDayNight(this.dnGrade.sky);
        this.skyView.setFog((this.scene.fog as THREE.Fog).color);
        this.skyView.setStars(this.starAmt, this.time);
        this.updateEnvBiome(dt);
      }
    }
    this.updateCelestialSprites();
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
    this.pooledVisualCount = Math.max(0, this.pooledVisualCount - 1);
    if (pool?.length === 0) this.visualPool.delete(key);
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
    if (!shouldRetainPooledCharacterVisual(this.pooledVisualCount, GFX.maxPooledCharacterVisuals)) {
      visual.dispose();
      return;
    }
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
    this.pooledVisualCount++;
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

  private templateIdsInZone(zone: ZoneDef, kind: 'mob' | 'npc'): string[] {
    const ids = new Set<string>();
    // Static content is authoritative here: online clients only receive nearby
    // entities, so a just-crossed zone may not have delivered its first snapshot
    // by the time the transition prewarm starts.
    if (kind === 'mob') {
      for (const camp of CAMPS) {
        if (zoneAt(camp.center.x, camp.center.z).id === zone.id) ids.add(camp.mobId);
      }
    } else {
      for (const npc of Object.values(NPCS)) {
        if (!npc.dynamic && zoneAt(npc.pos.x, npc.pos.z).id === zone.id) ids.add(npc.id);
      }
    }
    // Dynamic/event content has no static camp record. Union whatever the sim
    // already knows without making correctness depend on snapshot timing.
    for (const entity of this.sim.entities.values()) {
      if (entity.kind !== kind || !entity.templateId || entity.pos.x > DUNGEON_X_THRESHOLD)
        continue;
      if (zoneAt(entity.pos.x, entity.pos.z).id === zone.id) ids.add(entity.templateId);
    }
    return [...ids].sort();
  }

  private buildEntityPrewarmGroup(zone: ZoneDef): {
    group: THREE.Group;
    pooled: { key: string; visual: CharacterVisual }[];
  } {
    const group = new THREE.Group();
    const pooled: { key: string; visual: CharacterVisual }[] = [];
    const p = this.sim.player;
    group.position.set(p.pos.x, p.pos.y, p.pos.z - 14);
    setRenderCategory(group, 'prewarm');
    let idx = 0;
    const place = (obj: THREE.Object3D): void => {
      obj.position.set(((idx % 6) - 2.5) * 3.2, 0, Math.floor(idx / 6) * 3.2);
      group.add(obj);
      idx++;
    };
    const build = (templateId: string, copies: number): void => {
      const template = MOBS[templateId];
      if (!template) return;
      for (let i = 0; i < copies; i++) {
        const entity = this.prewarmEntity('mob', template.id, template.color, template.scale);
        const visual = createCharacterVisual(entity);
        // Assets unavailable: skip the seed so a later zone preparation can retry it.
        if (!visual) continue;
        const poolKey = this.visualPoolKeyFor(entity);
        if (poolKey) pooled.push({ key: poolKey, visual });
        visual.root.visible = true;
        place(visual.root);
      }
    };
    // Warm only templates that can appear in this zone. The per-template set
    // persists across transitions, so shared families are paid once per session.
    for (const templateId of this.templateIdsInZone(zone, 'mob')) {
      if (this.prewarmedMobTemplates.has(templateId)) continue;
      const copies = PREWARM_MOB_COMMON_IDS.has(templateId) ? PREWARM_MOB_POOL_COPIES : 1;
      build(templateId, copies);
      this.prewarmedMobTemplates.add(templateId);
    }
    return { group, pooled };
  }

  // Every NPC visual MODEL once (NPCs were not prewarmed at all, entering a zone hub
  // compiled their shaders live). Most NPCs share a handful of models (npc_knight,
  // npc_mage, ...), so dedup by model key (visualKeyFor) builds each only once.
  private buildNpcPrewarmGroup(
    zone: ZoneDef,
    deadline: number,
  ): { group: THREE.Group; pooled: { key: string; visual: CharacterVisual }[] } {
    const group = new THREE.Group();
    const pooled: { key: string; visual: CharacterVisual }[] = [];
    const p = this.sim.player;
    group.position.set(p.pos.x, p.pos.y, p.pos.z - 24);
    setRenderCategory(group, 'prewarm');
    let idx = 0;
    for (const npcId of this.templateIdsInZone(zone, 'npc')) {
      if (performance.now() >= deadline) break;
      const npc = NPCS[npcId];
      if (!npc) continue;
      const entity = this.prewarmEntity('npc', npc.id, npc.color, 1);
      const modelKey = visualKeyFor(entity);
      if (this.prewarmedNpcModels.has(modelKey)) continue;
      const visual = createCharacterVisual(entity);
      // assets unavailable: skip the seed, leave the model unmarked
      if (!visual) continue;
      this.prewarmedNpcModels.add(modelKey);
      const poolKey = this.visualPoolKeyFor(entity);
      if (poolKey) pooled.push({ key: poolKey, visual });
      visual.root.visible = true;
      visual.root.position.set(((idx % 8) - 3.5) * 2.8, 0, Math.floor(idx / 8) * 2.8);
      group.add(visual.root);
      idx++;
    }
    return { group, pooled };
  }

  private buildPlayerPrewarmGroup(deadline: number): {
    group: THREE.Group;
    visualCount: number;
  } {
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
    // One EXTRA rig per class wearing the ability-VFX aura glow: setAuraGlow's
    // on-edge swaps the rig materials for private clones, and on the tinted
    // player rigs that clone links a NEW program. Without this seed the FIRST
    // spec'd cast of a session compiles it synchronously mid-frame - the
    // measured 'mage' program link landing inside the player's own cast
    // moment (e.g. mid Solemn Prayer cast bar). Seeding glow-lit copies here
    // puts the clone materials in front of programs.compile while the base
    // rigs above still carry the un-glowed originals; the group is removed in
    // the prewarm finally, but the linked programs stay cached for the
    // session.
    for (const cls of ALL_CLASSES) {
      if (performance.now() >= deadline) return { group, visualCount: idx };
      const color = CLASSES[cls]?.color ?? 0xffffff;
      const entity = this.prewarmEntity('player', cls, color, 1, 0, -11_500 - idx);
      const visual = createCharacterVisual(entity);
      if (!visual) continue;
      visual.root.visible = true;
      visual.setAuraGlow(0xffffff, 0.02);
      place(visual.root);
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
    this.gpuReadyTextures.add(texture);
  }

  private readonly gpuReadyTextures = new WeakSet<THREE.Texture>();
  private readonly textureUploadTasks = new WeakMap<THREE.Texture, Promise<void>>();
  private readonly textureUploadTaskSet = new Set<Promise<void>>();

  private prewarmTextureInIdle(texture: THREE.Texture | null | undefined): Promise<void> {
    if (!texture || this.gpuReadyTextures.has(texture)) return Promise.resolve();
    const pending = this.textureUploadTasks.get(texture);
    if (pending) return pending;
    const task = uploadDataTextureInChunks(this.webgl, texture, {
      beforeChunk: () => idleSlot(IDLE_PREWARM_TIMEOUT_MS),
      uploadChunk: (chunkTexture) =>
        this.backgroundGpuWork.run(
          () => this.webgl.initTexture(chunkTexture),
          GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        ),
    })
      .then(() => {
        this.gpuReadyTextures.add(texture);
      })
      .finally(() => {
        this.textureUploadTasks.delete(texture);
        this.textureUploadTaskSet.delete(task);
      });
    this.textureUploadTasks.set(texture, task);
    this.textureUploadTaskSet.add(task);
    return task;
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
      // ShaderMaterials (ability-vfx pools, custom fx) hold their textures in
      // uniforms, invisible to the standard-key walk above.
      const shaderMat = mat as THREE.ShaderMaterial;
      if (shaderMat.isShaderMaterial) {
        for (const uniform of Object.values(shaderMat.uniforms)) {
          const value = uniform?.value as { isTexture?: boolean } | null | undefined;
          if (value?.isTexture) this.prewarmTexture(value as THREE.Texture);
        }
      }
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

  private prewarmDepthMaterial(source: THREE.Material): THREE.MeshDepthMaterial {
    const textured = source as TextureBackedMaterial & {
      displacementScale?: number;
      displacementBias?: number;
      wireframe?: boolean;
    };
    const shadowSide =
      source.shadowSide ??
      (source.side === THREE.FrontSide
        ? THREE.BackSide
        : source.side === THREE.BackSide
          ? THREE.FrontSide
          : THREE.DoubleSide);
    const key = [
      shadowSide,
      textured.map ? 1 : 0,
      textured.alphaMap ? 1 : 0,
      source.alphaToCoverage || source.alphaTest > 0 ? 1 : 0,
      textured.displacementMap ? 1 : 0,
      textured.wireframe ? 1 : 0,
    ].join('|');
    let depth = this.prewarmDepthMaterials.get(key);
    if (depth) return depth;
    depth = new THREE.MeshDepthMaterial({
      side: shadowSide,
      map: textured.map ?? null,
      alphaMap: textured.alphaMap ?? null,
      alphaTest: source.alphaToCoverage ? 0.5 : source.alphaTest,
      displacementMap: textured.displacementMap ?? null,
      displacementScale: textured.displacementScale ?? 1,
      displacementBias: textured.displacementBias ?? 0,
      wireframe: textured.wireframe ?? false,
    });
    depth.name = `prewarm-skinned-depth:${key}`;
    this.prewarmDepthMaterials.set(key, depth);
    return depth;
  }

  /**
   * Link a root's exact live colour-program variant before a bounded upload.
   * Three r165 chooses output colour space from the current render target in
   * compileAsync's synchronous prologue. Restore that global before awaiting
   * the parallel linker so live frames never inherit the prewarm target.
   */
  private async compilePrewarmColorPrograms(
    root: THREE.Object3D,
    includeOffscreenVariant: boolean,
  ): Promise<void> {
    const compileAtTarget = async (target: THREE.WebGLRenderTarget | null): Promise<void> => {
      const previousTarget = this.webgl.getRenderTarget();
      let compilePromise: Promise<THREE.Object3D>;
      try {
        this.webgl.setRenderTarget(target);
        compilePromise = this.webgl.compileAsync(root, this.camera, this.scene);
      } finally {
        this.webgl.setRenderTarget(previousTarget);
      }
      await compilePromise;
    };

    // Direct tiers draw to the canvas in gameplay, so retain that variant.
    if (!this.post) await compileAtTarget(null);

    // Composer tiers draw the scene into a render target. Direct tiers also
    // need this second variant before their bounded offscreen geometry upload,
    // otherwise that upload itself can synchronously link a new program.
    if (this.post || includeOffscreenVariant) {
      this.prewarmRenderTarget ??= new THREE.WebGLRenderTarget(8, 8);
      await compileAtTarget(this.prewarmRenderTarget);
    }
  }

  /**
   * compileAsync(scene, camera) does not enumerate Three's renderer-owned
   * shadow materials. Temporarily put equivalent MeshDepthMaterials on the
   * real skinned rigs so KHR_parallel_shader_compile can link those variants
   * before the synchronous shadow warm pass asks getUniforms for them.
   */
  private async compileSkinnedShadowPrograms(root: THREE.Object3D): Promise<void> {
    if (!GFX.dynamicShadows || !this.asyncCompileSupported) return;
    const swaps: { mesh: THREE.SkinnedMesh; material: THREE.Material | THREE.Material[] }[] = [];
    root.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.castShadow) return;
      const material = mesh.material;
      swaps.push({ mesh, material });
      mesh.material = Array.isArray(material)
        ? material.map((item) => this.prewarmDepthMaterial(item))
        : this.prewarmDepthMaterial(material);
    });
    if (swaps.length === 0) return;
    try {
      // Match the real shadow pass's program key exactly. A bare
      // compileAsync(root, shadowCamera) uses the canvas output colour space
      // and sees no scene lights, producing a skinned depth program that still
      // misses both the render-target and shadow-map bits. Conversely, passing
      // the world scene verbatim would add fog bits that WebGLShadowMap omits
      // (its renderBufferDirect call uses a null scene). Keep the world only as
      // the light source, briefly suppress its fog, and compile while any
      // offscreen target is current so outputColorSpace is the linear working
      // space. compileAsync runs its compile() prologue synchronously; restore
      // both globals before awaiting parallel linker completion so live frames
      // can continue normally.
      this.prewarmRenderTarget ??= new THREE.WebGLRenderTarget(8, 8);
      const previousTarget = this.webgl.getRenderTarget();
      const previousFog = this.scene.fog;
      let compilePromise: Promise<THREE.Object3D>;
      try {
        this.scene.fog = null;
        this.webgl.setRenderTarget(this.prewarmRenderTarget);
        compilePromise = this.webgl.compileAsync(root, this.sun.shadow.camera, this.scene);
      } finally {
        this.webgl.setRenderTarget(previousTarget);
        this.scene.fog = previousFog;
      }
      // Do not race a timer here. The underlying linker cannot be cancelled,
      // so a timeout only lets it overlap the next child and gameplay.
      await compilePromise;
    } finally {
      for (const swap of swaps) swap.mesh.material = swap.material;
    }
  }

  // A tiny throwaway target for background child uploads, so a prewarm root
  // that is briefly visible during its bounded call is never presented on
  // the canvas. Lazily built once and kept: 8x8 RGBA plus depth is negligible.
  private prewarmRenderTarget: THREE.WebGLRenderTarget | null = null;

  private collectObjectTextures(
    obj: THREE.Object3D,
    visibleOnly: boolean,
    textures = new Set<THREE.Texture>(),
  ): Set<THREE.Texture> {
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
    const collect = (child: THREE.Object3D): void => {
      const renderable = child as RenderableDiagnosticObject;
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : renderable.material
          ? [renderable.material]
          : [];
      for (const material of materials) {
        const textureMaterial = material as TextureBackedMaterial;
        for (const key of textureKeys) {
          const texture = textureMaterial[key];
          if (texture) textures.add(texture);
        }
      }
    };
    if (visibleOnly) obj.traverseVisible(collect);
    else obj.traverse(collect);
    return textures;
  }

  private collectInitialSceneTextures(): THREE.Texture[] {
    const textures = this.collectObjectTextures(this.scene, true);
    // Async shader compilation temporarily hides non-self entity groups. Include
    // those already-created views explicitly so their textures do not all upload
    // during the first live submit when the compile gate restores visibility.
    for (const view of this.views.values()) {
      this.collectObjectTextures(view.group, false, textures);
    }
    return [...textures];
  }

  private async prewarmInitialSceneTexturesBatched(
    batchSize: number,
    maxMs: number,
  ): Promise<number> {
    const before = this.webgl.info.memory.textures;
    const deadline = performance.now() + Math.max(0, maxMs);
    const textures = this.collectInitialSceneTextures();
    const batch = Math.max(1, Math.floor(batchSize));
    for (let i = 0; i < textures.length && performance.now() < deadline; i += batch) {
      const end = Math.min(textures.length, i + batch);
      for (let j = i; j < end; j++) this.prewarmTexture(textures[j]);
      if (end < textures.length && performance.now() < deadline) await sleep(0);
    }
    return Math.max(0, this.webgl.info.memory.textures - before);
  }

  // Drop an out-of-band render burst (prewarm pass, screenshot, scene census)
  // from the perf counters. The zeroing runs on EVERY profile so a synchronous
  // perfStats() read right after the burst never serves a stale out-of-band
  // pass (on auto-reset profiles the next live render would also clear it, but
  // the census harness reads in the same task). The accumulator hand-off is
  // composer-tiers-only, where the counters run monotonically.
  private discardOutOfBandDraws(): void {
    if (this.drawStats) this.drawStats.discardOutOfBand();
    else this.webgl.info.reset();
  }

  private updateOpaqueDrawOrder(elapsedSeconds: number): void {
    if (!GFX.standardMaterials) return;
    const focusX = this.cameraLookAt.x;
    const focusZ = this.cameraLookAt.z;
    const input = this.opaqueSortPolicyInput;
    input.drawCalls = this.drawStats
      ? this.drawStats.currentFrame().calls
      : this.webgl.info.render.calls;
    input.elapsedSeconds = elapsedSeconds;
    input.focusX = focusX;
    input.focusZ = focusZ;
    const useFrontToBack = shouldUseFrontToBackOpaqueSort(input);
    input.previousFocusX = focusX;
    input.previousFocusZ = focusZ;
    if (useFrontToBack === this.opaqueFrontToBackActive) return;
    this.opaqueFrontToBackActive = useFrontToBack;
    this.webgl.setOpaqueSort(useFrontToBack ? opaqueFrontToBackSort : opaqueMaterialFirstSort);
  }

  private renderBoundedPrewarmRoot(group: THREE.Group, childRoot: THREE.Object3D): void {
    const sceneVisibility = this.scene.children.map((entry) => entry.visible);
    const groupVisibility = group.children.map((entry) => entry.visible);
    const previousTarget = this.webgl.getRenderTarget();
    const previousShadowAutoUpdate = this.webgl.shadowMap.autoUpdate;
    const previousShadowNeedsUpdate = this.webgl.shadowMap.needsUpdate;
    try {
      for (const entry of this.scene.children) {
        const isLight = (entry as THREE.Light).isLight === true;
        const keepVisible = entry === group || isLight || entry === this.sun.target;
        entry.visible = boundedPrewarmVisibility(entry.visible, keepVisible);
      }
      group.visible = true;
      for (const entry of group.children) entry.visible = entry === childRoot;

      // Keep the real shadow-enabled colour-program variant, but do not rebuild
      // Insane's 4096px shadow map for every child upload. The separate shadow
      // compile lane above already links the skinned depth variants.
      this.webgl.shadowMap.autoUpdate = false;
      this.webgl.shadowMap.needsUpdate = false;
      this.prewarmRenderTarget ??= new THREE.WebGLRenderTarget(8, 8);
      this.webgl.setRenderTarget(this.prewarmRenderTarget);
      this.webgl.render(this.scene, this.camera);
    } finally {
      this.webgl.setRenderTarget(previousTarget);
      this.webgl.shadowMap.autoUpdate = previousShadowAutoUpdate;
      this.webgl.shadowMap.needsUpdate = previousShadowNeedsUpdate;
      for (let i = 0; i < group.children.length; i++) {
        group.children[i].visible = groupVisibility[i];
      }
      for (let i = 0; i < this.scene.children.length; i++) {
        this.scene.children[i].visible = sceneVisibility[i];
      }
      this.discardOutOfBandDraws();
    }
  }

  private renderPrewarmPass(dt: number, opts?: { offscreen?: boolean }): void {
    this.prewarmWorldFrame(dt);
    this.updateOpaqueDrawOrder(dt);
    // Offscreen only applies on a composer tier: there gameplay's scene pass
    // renders into the composer's buffer, so its programs are the
    // render-target variants and an offscreen pass warms the exact same ones
    // (the post chain itself is already warm from live frames). Without a
    // composer the live variant is the canvas one, so the pass keeps
    // rendering to the canvas; at worst that is a single presented frame.
    try {
      if (opts?.offscreen && this.post) {
        this.prewarmRenderTarget ??= new THREE.WebGLRenderTarget(8, 8);
        const previousTarget = this.webgl.getRenderTarget();
        try {
          this.webgl.setRenderTarget(this.prewarmRenderTarget);
          this.webgl.render(this.scene, this.camera);
        } finally {
          this.webgl.setRenderTarget(previousTarget);
        }
        return;
      }
      if (this.post) this.post.render();
      else this.webgl.render(this.scene, this.camera);
    } finally {
      this.discardOutOfBandDraws();
    }
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

  async prewarmInitialScene(
    options: {
      maxMs?: number;
      onEntryStart?: (id: string, category: RendererPrewarmCategory) => void;
    } = {},
  ): Promise<RendererPrewarmStats> {
    const policy: PrewarmPolicy = resolvePrewarmPolicy({
      constrainedMemory: GFX.constrainedMemory,
      asyncCompileSupported: this.asyncCompileSupported,
      lowGfx: this.lowGfx,
      finishFullManifestBeforeReveal: GFX.tier === 'insane' && !GFX.constrainedMemory,
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
    // Extended by resumeDroppedPrewarmEntries below when a dropped entry is
    // resumed in idle time, so its own internal deadline checks see fresh room.
    const deadline = started + maxMs;
    // Stop the archetype-build steps early so the later entries, crucially
    // programs.compile, still START before `deadline` (runEntry skips anything
    // that begins past it). Compiling is what kills the in-world freeze.
    // Mutable: extended alongside `deadline` when a dropped entry is resumed, so
    // a resumed entities.player-archetypes/entities.npc-archetypes does not see
    // a stale, already-past budget and silently build nothing (#2571 review).
    const buildDeadline = prewarmBuildDeadline(
      deadline,
      PREWARM_BUILD_RESERVE_MS,
      policy.finishFullManifestBeforeReveal,
    );
    const manifestEntries: RendererPrewarmManifestEntryStats[] = [];
    const startCounts = this.prewarmCounts();
    const createdViewTypes: string[] = [];
    const p = this.sim.player;
    const activeZone = zoneAt(p.pos.x, p.pos.z);
    const worldZones = this.sim.cfg.world?.zones ?? ZONES;
    const initialSkyBiomes = [
      ...new Set(
        zonesWithinStreamingHorizon(worldZones, p.pos.x, p.pos.z, INITIAL_SKY_PREWARM_RADIUS).map(
          (zone) => zone.biome,
        ),
      ),
    ];
    const zoneMobTemplateIds = this.templateIdsInZone(activeZone, 'mob');
    const zoneNpcTemplateIds = this.templateIdsInZone(activeZone, 'npc');
    let createdViews = 0;
    let candidateViews = 0;
    let mandatoryLandmarkIds: number[] = [];
    let doorPrewarmGroup: THREE.Group | null = null;
    let interiorPrewarmGroup: THREE.Group | null = null;
    let entityPrewarmGroup: THREE.Group | null = null;
    let npcPrewarmGroup: THREE.Group | null = null;
    let entityPrewarmPool: { key: string; visual: CharacterVisual }[] = [];
    let npcPrewarmPool: { key: string; visual: CharacterVisual }[] = [];
    let deferPoolPublication = false;
    let playerPrewarmGroup: THREE.Group | null = null;
    let objectPrewarmGroup: THREE.Group | null = null;
    let propMaterialPrewarmGroup: THREE.Group | null = null;
    let foliagePrewarmGroup: THREE.Group | null = null;
    let greatTreePrewarmGroup: THREE.Group | null = null;
    let landmarkPrewarmGroup: THREE.Group | null = null;
    let weatherPrewarmActive = false;
    let surfaceDetailTexturesWarmed = 0;

    let renderPasses = 0;
    let playerPrewarmVisuals = 0;
    let vfxPrewarmBursts = 0;
    let compileMode: RendererPrewarmStats['compileMode'] = 'none';
    let compileMs = 0;
    let compileTimedOut = false;
    // How many of [player/entity/npc]PrewarmGroup actually had a skinned-shadow
    // pre-compile pass run against them: 0 on a resumed programs.compile whose
    // archetype groups were already torn down by the main pass's cleanup, so the
    // detail string below does not overstate what a resumed run actually did
    // (#2571 review).
    let compiledSkinnedShadowGroups = 0;
    let textureUploads = 0;
    let diagnosticsBaseline: RendererPrewarmDiagnosticsBaselineStats | null = null;

    type PrewarmManifestEntry = {
      id: string;
      category: RendererPrewarmCategory;
      priority: number;
      required: boolean;
      /** This small entry still runs if an earlier required view consumed maxMs. */
      deadlineExempt?: boolean;
      /** Explicit small units that may resume after world entry. The absence of
       * this hook is intentional: a whole manifest entry is never rerun live. */
      resumeUnits?: () => readonly PrewarmResumeUnit[];
      run: () => void | Promise<void>;
      detail?: () => string;
    };

    // Explicitly bounded units captured when their manifest entry misses the
    // loading deadline. Whole entry callbacks are never resumed live.
    const droppedEntries: PrewarmResumeEntry[] = [];

    const runEntry = async (
      entry: PrewarmManifestEntry,
      // Resumed entries record into their OWN array (see the resume kickoff
      // below), never back into `manifestEntries`: that array already backs
      // the FROZEN counts on the stats object this function returns, and a
      // resumed entry pushing into it later would grow the array while
      // manifestCompleted/manifestTimedOut/etc. stayed stuck at their
      // original values, an array-vs-counters disagreement on anything that
      // reads this.lastPrewarmStats after a resume (#2571 review).
      target: RendererPrewarmManifestEntryStats[] = manifestEntries,
    ): Promise<void> => {
      const before = this.prewarmCounts();
      const entryStarted = performance.now();
      if (
        prewarmEntryShouldDefer(
          entryStarted,
          deadline,
          entry.deadlineExempt ?? false,
          policy.finishFullManifestBeforeReveal,
        )
      ) {
        target.push({
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
        const units = entry.resumeUnits?.() ?? [];
        if (units.length > 0) droppedEntries.push({ id: entry.id, units });
        return;
      }
      let status: RendererPrewarmManifestEntryStats['status'] = 'completed';
      try {
        try {
          options.onEntryStart?.(entry.id, entry.category);
        } catch {
          // Diagnostics must never change whether a prewarm entry runs.
        }
        await entry.run();
      } catch (err) {
        status = 'failed';
        console.warn(`Renderer prewarm entry failed: ${entry.id}`, err);
      }
      const after = this.prewarmCounts();
      const entryEnded = performance.now();
      target.push({
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

    // Hide every temp prewarm group currently staged in the scene without
    // removing it. Three's compile()/compileAsync() traverse the whole scene
    // regardless of visibility (see prewarm_pass.ts), so a hidden group still
    // links its programs; the point is keeping a resumed entry's staged group
    // (e.g. the Mirefen impact-site clone, positioned right next to the
    // player) from ever painting a live frame once the loading screen is gone.
    const hidePrewarmArtifacts = (): void => {
      for (const group of [
        doorPrewarmGroup,
        interiorPrewarmGroup,
        entityPrewarmGroup,
        npcPrewarmGroup,
        playerPrewarmGroup,
        objectPrewarmGroup,
        propMaterialPrewarmGroup,
        foliagePrewarmGroup,
        landmarkPrewarmGroup,
      ]) {
        if (group) group.visible = false;
      }
    };

    // Tear down every temp prewarm group staged so far. Shared by the main
    // pass's finally block and, with clearVfx false, by the background resume
    // pass: vfx.clear() wipes the whole pooled particle system, which is fine
    // behind the loading screen but would erase live gameplay particles if
    // called after world entry (the resumed vfx.atlas burst instead decays on
    // its own once the real per-frame update loop is ticking).
    const cleanupPrewarmArtifacts = (opts: { clearVfx: boolean; publishPools: boolean }): void => {
      if (opts.clearVfx) {
        this.vfx.clear();
        this.abilityVfxFx.clear();
      }
      if (doorPrewarmGroup) this.scene.remove(doorPrewarmGroup);
      if (interiorPrewarmGroup) this.scene.remove(interiorPrewarmGroup);
      if (entityPrewarmGroup) this.scene.remove(entityPrewarmGroup);
      if (npcPrewarmGroup) this.scene.remove(npcPrewarmGroup);
      if (opts.publishPools) {
        for (const item of entityPrewarmPool) this.storePooledVisual(item.key, item.visual);
        for (const item of npcPrewarmPool) this.storePooledVisual(item.key, item.visual);
      }
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
      if (greatTreePrewarmGroup) this.scene.remove(greatTreePrewarmGroup);
      if (landmarkPrewarmGroup) this.scene.remove(landmarkPrewarmGroup);
      if (weatherPrewarmActive) this.weather.endPrewarm();
      doorPrewarmGroup = null;
      interiorPrewarmGroup = null;
      if (opts.publishPools) {
        entityPrewarmGroup = null;
        npcPrewarmGroup = null;
        entityPrewarmPool = [];
        npcPrewarmPool = [];
      }
      playerPrewarmGroup = null;
      objectPrewarmGroup = null;
      propMaterialPrewarmGroup = null;
      foliagePrewarmGroup = null;
      greatTreePrewarmGroup = null;
      landmarkPrewarmGroup = null;
      weatherPrewarmActive = false;
    };

    const textureResumeUnits = (
      idPrefix: string,
      textures: readonly THREE.Texture[],
    ): PrewarmResumeUnit[] =>
      [...new Set(textures)].map((texture, index) => ({
        id: `${idPrefix}:${index}`,
        run: () => this.prewarmTexture(texture),
      }));

    const manifest: PrewarmManifestEntry[] = [
      {
        // A 2k RGBA16F dome upload blocked a live Mirefen frame for 183ms.
        // WebGL exposes no non-blocking Three.js DataTexture upload, so pay the
        // immediate-neighbour cost while the loading screen still owns the
        // frame. PMREM uses the 1k source but is generated here too, keeping
        // both the dome swap and IBL transition out of gameplay.
        id: 'sky.nearby-biomes',
        category: 'sky',
        priority: 5,
        required: true,
        run: async () => {
          await ensureSkyBiomeAssets(initialSkyBiomes);
          for (const biome of initialSkyBiomes) {
            this.prewarmTexture(this.skyView.envTexture(biome));
            this.ensureEnvironmentBiome(biome);
            this.prewarmTexture(this.skyView.domeTexture(biome));
          }
        },
        detail: () => `biomes=${initialSkyBiomes.join(',')}`,
      },
      {
        id: 'views.required',
        category: 'views',
        priority: 10,
        required: true,
        run: () => {
          createdViews += this.createRequiredViews(p, createdViewTypes);
        },
        detail: () => `created=${createdViews}`,
      },
      {
        id: 'views.landmarks',
        category: 'views',
        priority: 12,
        required: true,
        deadlineExempt: true,
        run: async () => {
          const result = await this.createMandatoryLandmarkViews(p, createdViewTypes);
          mandatoryLandmarkIds = result.ids;
          createdViews += result.created;
        },
        detail: () =>
          `required=${mandatoryLandmarkIds.length};ready=${mandatoryLandmarkViewsReady(
            mandatoryLandmarkIds,
            this.views,
          )};created=${createdViews}`,
      },
      {
        id: 'views.persistent-portals',
        category: 'views',
        priority: 14,
        required: true,
        run: () => {
          createdViews += this.createPersistentPortalViews(
            createdViewTypes,
            buildDeadline,
            remainingPrewarmViewBudget(policy.maxViews, createdViews),
          );
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
            remainingPrewarmViewBudget(policy.maxViews, createdViews),
            createdViewTypes,
            buildDeadline,
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
        // archetypes first (before the long mob tail), guaranteed within budget.
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
          const built = this.buildEntityPrewarmGroup(activeZone);
          entityPrewarmGroup = built.group;
          entityPrewarmPool = built.pooled;
          this.scene.add(entityPrewarmGroup);
        },
        detail: () =>
          `zone=${activeZone.id};mobs=${zoneMobTemplateIds.length};copies=${PREWARM_MOB_POOL_COPIES}`,
      },
      {
        id: 'entities.npc-archetypes',
        category: 'entities',
        priority: 36,
        required: true,
        run: () => {
          const built = this.buildNpcPrewarmGroup(activeZone, buildDeadline);
          npcPrewarmGroup = built.group;
          npcPrewarmPool = built.pooled;
          this.scene.add(npcPrewarmGroup);
        },
        detail: () => `zone=${activeZone.id};npcs=${zoneNpcTemplateIds.length}`,
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
        // The great-tree landmark bark variant (worn_stone.ts
        // GREAT_TREE_BARK_DETAIL on an unchained clone) streams in with zone
        // features, so without this its program links synchronously the
        // first time a giant enters the frustum mid-travel.
        id: 'foliage.great-tree-materials',
        category: 'props',
        priority: 46,
        required: false,
        run: () => {
          greatTreePrewarmGroup = buildGreatTreePrewarmGroup();
          this.scene.add(greatTreePrewarmGroup);
        },
        detail: () => `objects=${greatTreePrewarmGroup?.children.length ?? 0}`,
      },
      {
        // The worn-stone family maps (normal/AO/rough/displacement/metal) and
        // the canopy clump maps are onBeforeCompile UNIFORMS, so the scene
        // texture sweep below never finds them and they otherwise decode +
        // upload on the first live draw that binds them. The Displacement
        // fields only exist on the parallax tiers (high+), where that first
        // draw was measured as 1fps 1%-low windows mid-travel (the round-10
        // high-meadow stall). Upload them all inside the boot window instead.
        id: 'surface-detail.textures',
        category: 'props',
        priority: 47,
        required: false,
        resumeUnits: () =>
          textureResumeUnits('surface-detail', [
            ...surfaceDetailPrewarmTextures(),
            ...canopyDetailPrewarmTextures(),
          ]),
        run: () => {
          const textures = [...surfaceDetailPrewarmTextures(), ...canopyDetailPrewarmTextures()];
          for (const texture of textures) this.prewarmTexture(texture);
          surfaceDetailTexturesWarmed = textures.length;
        },
        detail: () => `textures=${surfaceDetailTexturesWarmed}`,
      },
      {
        // Precipitation starts hidden in the dry spawn biome. Make one points
        // draw visible behind the loading screen and upload both sprite maps,
        // so entering rain/snow cannot link or upload on its first live frame.
        id: 'weather.materials',
        category: 'world',
        priority: 47,
        required: false,
        run: () => {
          weatherPrewarmActive = true;
          for (const texture of this.weather.beginPrewarm()) this.prewarmTexture(texture);
        },
      },
      {
        // The Mirefen impact site exists from boot but sits hundreds of yards
        // outside the spawn frustum. A translated clone shares its real
        // geometry/materials and warms the custom scorch + ember programs.
        id: 'landmarks.impact-site',
        category: 'props',
        priority: 48,
        required: false,
        run: () => {
          landmarkPrewarmGroup = this.impactSite.group.clone(true);
          landmarkPrewarmGroup.name = 'prewarm-mirefen-impact-site';
          landmarkPrewarmGroup.visible = true;
          landmarkPrewarmGroup.position.set(
            p.pos.x - MIREFEN_IMPACT_SITE.x,
            p.pos.y,
            p.pos.z - 18 - MIREFEN_IMPACT_SITE.z,
          );
          setRenderCategory(landmarkPrewarmGroup, 'prewarm');
          this.scene.add(landmarkPrewarmGroup);
        },
        detail: () => `objects=${landmarkPrewarmGroup?.children.length ?? 0}`,
      },
      {
        id: 'textures.scene',
        category: 'world',
        priority: 50,
        required: true,
        resumeUnits: () => textureResumeUnits('scene', this.collectInitialSceneTextures()),
        run: async () => {
          textureUploads = constrainedPrewarm
            ? await this.prewarmInitialSceneTexturesBatched(
                policy.textureBatchSize,
                policy.textureMaxMs,
              )
            : this.prewarmObjectTextures(this.scene);
        },
        detail: () => `uploaded=${textureUploads}`,
      },
      {
        id: 'vfx.atlas',
        category: 'vfx',
        priority: 60,
        required: false,
        // No resumeUnits: this spawns real particles into the shared pooled VFX
        // system, so rerunning it live would create an unexplained burst.
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
        // Spawn one of every pooled ability-VFX primitive (rings, decals,
        // pillar, shell, slash ribbon, overlay sprite). The pools build their
        // meshes visible=false, so neither the render passes nor
        // programs.compile ever see their ShaderMaterials, the first spec'd
        // cast in the open world used to link them synchronously. The spawns
        // also bind the per-style decal textures, so the texture re-walk below
        // uploads the whole canvas set now. abilityVfxFx.clear() in the
        // finally block hides everything again.
        id: 'vfx.ability-primitives',
        category: 'vfx',
        priority: 62,
        required: false,
        run: () => {
          this.abilityVfxFx.prewarmSpawn(p.pos.x, p.pos.y, p.pos.z - 5, p.id);
          this.scene.traverse((child) => {
            const renderable = child as RenderableDiagnosticObject;
            if (renderable.userData.renderCategory !== 'vfx' || !renderable.material) return;
            this.prewarmMaterialTextures(renderable.material);
          });
        },
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
        // If the loading deadline drops the monolithic compile, retain only
        // explicit archetype-sized roots. Three r165's compileAsync first runs
        // a synchronous traversal, so the live resume lane must never receive
        // this.scene or another whole manifest entry.
        resumeUnits: () => {
          if (!this.asyncCompileSupported || !this.webgl.compileAsync) return [];
          deferPoolPublication =
            (entityPrewarmPool.length > 0 && (entityPrewarmGroup?.children.length ?? 0) > 0) ||
            (npcPrewarmPool.length > 0 && (npcPrewarmGroup?.children.length ?? 0) > 0);
          const groups: readonly [string, THREE.Group | null][] = [
            ['doors', doorPrewarmGroup],
            ['interiors', interiorPrewarmGroup],
            ['players', playerPrewarmGroup],
            ['mobs', entityPrewarmGroup],
            ['npcs', npcPrewarmGroup],
            ['objects', objectPrewarmGroup],
            ['props', propMaterialPrewarmGroup],
            ['foliage', foliagePrewarmGroup],
            ['great-tree', greatTreePrewarmGroup],
            ['landmark', landmarkPrewarmGroup],
          ];
          return buildPrewarmCompileUnits(
            groups.flatMap(([id, group]) => (group ? [{ id, roots: group.children }] : [])),
            async (root) => {
              await this.compilePrewarmColorPrograms(root, false);
              await this.compileSkinnedShadowPrograms(root);
            },
          );
        },
        run: async () => {
          const compileStart = performance.now();
          // Use a dedicated budget, not `deadline - now`: linking every program now is
          // exactly what prevents the in-world freeze, so a near-empty leftover budget
          // must not cut it short (the old bug, the async compile timed out and the
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
          compileMode = 'async';
          for (const group of [playerPrewarmGroup, entityPrewarmGroup, npcPrewarmGroup]) {
            if (group) {
              await this.compileSkinnedShadowPrograms(group);
              compiledSkinnedShadowGroups++;
            }
          }
          await this.compilePrewarmColorPrograms(this.scene, false).catch((err: unknown) => {
            console.warn('Renderer async prewarm compile failed', err);
          });
          compileMs = roundMs(performance.now() - compileStart);
          // Keep the historical diagnostic field as a budget-overrun signal,
          // but never abandon a still-running compile behind the loading gate.
          compileTimedOut = compileMs > policy.compileMaxMs;
        },
        detail: () =>
          `mode=${compileMode};timedOut=${compileTimedOut};skinnedShadowGroups=${compiledSkinnedShadowGroups}`,
      },
      {
        id: 'sky.current-zone',
        category: 'sky',
        priority: 90,
        required: false,
        // No resumeUnits: this would present real frames in a synchronous loop.
        run: () => {
          const points = [p.pos, activeZone.hub];
          for (const point of points) {
            if (performance.now() >= deadline) break;
            this.skyView.setCameraPos(point.x, point.z, 1 / 20);
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
        // No resumeUnits: this is a tight loop of real presented renders.
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
      cleanupPrewarmArtifacts({ clearVfx: true, publishPools: !deferPoolPublication });
    }

    if (droppedEntries.length > 0) {
      // Fire-and-forget: world-entry timing does not depend on this. Every
      // retained item is an explicit small unit, never a whole entry rerun.
      const resume = droppedEntries.slice();
      const failedResumeUnits: string[] = [];
      console.info(
        `[entry-guard] prewarm resume scheduled: dropped=[${resume.map((entry) => entry.id).join(',')}]`,
      );
      void settlePrewarmBeforePublish(
        () =>
          resumeDroppedPrewarmEntries(resume, {
            idleSlot: () =>
              idleSlot(IDLE_PREWARM_TIMEOUT_MS, {
                maxTimeoutDeferrals: 2,
              }),
            runUnit: (unit) => this.backgroundGpuWork.run(unit.run, GPU_WORK_PRIORITY.BOOT_RESUME),
            afterEntry: hidePrewarmArtifacts,
            onUnitError: (entry, unit, error) => {
              failedResumeUnits.push(`${entry.id}:${unit.id}`);
              console.warn(`Renderer prewarm resume unit failed: ${entry.id}:${unit.id}`, error);
            },
          }),
        () => cleanupPrewarmArtifacts({ clearVfx: false, publishPools: true }),
      )
        .then(() => {
          const unitCount = resume.reduce((sum, entry) => sum + entry.units.length, 0);
          console.info(
            `[entry-guard] prewarm resume done: units=${unitCount};failed=[${failedResumeUnits.join(',')}]`,
          );
        })
        .catch((err) => {
          console.warn('Renderer prewarm resume failed', err);
        });
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
      textureUploads,
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
    this.prewarmedZonePrograms.add(activeZone.id);
    // Dev-channel diagnostic (pairs with main.ts's "[entry-guard] scene built"): one
    // line naming where the entry-time main-thread budget went, for isolating
    // world-entry process kills on real devices.
    console.info(
      `[entry-guard] prewarm done: ${stats.elapsedMs}ms/${stats.maxMs}ms passes=${stats.renderPasses} ` +
        `views=${stats.createdViews}/${stats.candidateViews} ` +
        `programs=${stats.programsBefore}->${stats.programsAfter} ` +
        `textures=${stats.texturesBefore}->${stats.texturesAfter} uploads=${stats.textureUploads} ` +
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
        // Goad: the warrior audibly swears at the victim - a grawlix bark over
        // the caster's head, riding the completion cue every client receives,
        // so other players see the taunt too. Before the claim: the painter
        // owns the wave/sequence, the bubble is this renderer's own read.
        // Pure symbols, so it is i18n-exempt (CLAUDE.md: emojis/symbols need
        // no t() entry) - it must read as swearing in every locale.
        if (ev.fx === 'selfCast' && ev.ability === 'taunt') {
          this.showChatBubble(ev.sourceId, '$@#%&*!', false, 1.8);
        }
        // Spec-driven per-ability visuals claim the event first; unknown
        // ability/fx falls through to the generic school-colored arms below.
        if (this.abilityVfx.handleSpellfx(ev)) break;
        // 'selfCast' is a renderer-only cue this layer introduced (see
        // casting_lifecycle: the silent completions that emit no damage,
        // projectile or castFx). It has no legacy meaning, so an ability the
        // painter declines (no spec, or an archetype it does not claim) must
        // draw NOTHING rather than reach the terminal school nova below and
        // pop a burst that never existed before (sport_second_wind is the
        // reachable case today).
        if (ev.fx === 'selfCast') break;
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
        // Spec-driven ground-cast visuals claim the point-anchored cues first
        // (aimed 'nova'/'burst' landings and 'tick' zone pulses). The painter
        // deliberately never claims meteorFall/snowZone/runeCircle/orb: those
        // four are stateful lifetime visuals (a ball timed to its landing,
        // snowfall over the zone's whole life, a persistent inscription, the
        // roaming orb) that its one-shot sequences would read worse than, so
        // their dedicated arms below stay authoritative.
        if (this.abilityVfx.handleSpellfxAt(ev)) break;
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
        // spec-driven per-ability impact accent (no-op for unknown abilities)
        this.abilityVfx.onDamage(ev);
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
        // A brief FOV widen sells the surge (no-op under reduced motion).
        this.punchFov(3);
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
      case 'fishingBite': {
        // Personal bite signal (Professions 2.0): only the angler's
        // own client receives it, so flipping their bobber into the bite
        // state here is correct (bystanders keep the idle float).
        this.fishingBobbers.bite(ev.pid);
        break;
      }
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
        setRenderCategory(this.valeCupBallTrail.group, 'vfx');
        this.scene.add(this.valeCupBallTrail.group);
      }
      this.valeCupBallTrail.emit(x, y + BALL_RADIUS * e.scale, z, speed, dt);
    }
    if (speed > 6 && heightAbove < 0.5 && v.group.visible) {
      if (!this.valeCupBallDust) {
        this.valeCupBallDust = new ValeCupBallDust();
        setRenderCategory(this.valeCupBallDust.group, 'vfx');
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
        setRenderCategory(this.valeCupBallDust.group, 'vfx');
        this.scene.add(this.valeCupBallDust.group);
      }
      this.valeCupBallDust.burst(x, gy, z);
    }
  }

  // ---- 2v2 Fiesta juice (driven by the HUD's event handler) --------------

  // Add camera trauma (0..1). Squared on apply, so small adds barely register
  // and big hits (kills, ring closes) really kick. A no-op for
  // reduced-motion players (OS query or the in-game switch).
  addShake(amount: number): void {
    if (this.reducedMotion()) return;
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  // Zone-entry vista sweep (hud.ts fires it on the zone-banner edge): the
  // camera eases up and out and pans slowly over the new zone, then settles
  // home. Any manual camera input cancels it; reduced motion skips it.
  vistaPan(): void {
    if (this.reducedMotion()) return;
    startVista(this.camDirector);
  }

  // Transient FOV impulse in degrees (negative = a dip); decays on its own.
  punchFov(degrees: number): void {
    if (this.reducedMotion()) return;
    punchCameraFov(this.camFeel, degrees);
  }

  // Ability-VFX screen feedback (spec.screenFx finishers / big novas): a
  // world-anchored radial distortion ripple plus a faint flash on the post
  // chain. Composer-gated like bloom (the low tier renders direct and pays
  // nothing) and skipped entirely for reduced-motion players.
  private screenImpactAt(x: number, y: number, z: number, strength: number): void {
    if (!this.post || this.reducedMotion()) return;
    this.post.screenRipple(x, y, z, strength);
    // spectacle calibration: the finisher pop reads brighter (still well under
    // the pass's 0.4 clamp and the ~3-frame decay, a pop, never a strobe)
    this.post.screenFlash(0.12 * strength);
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
      setRenderCategory(this.fiestaRing, 'vfx');
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
        setRenderCategory(m, 'vfx');
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

  private createView(e: Entity, nameplateParent: ParentNode = this.nameplateLayer): void {
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
    // Rift portals reuse the dungeon-door arch+swirl body: the overworld entrance
    // (rift_portal) and the in-rift descent are "entering" portals; the egress is a
    // "leaving" portal. Pylons and the other puzzle props are bespoke procedural
    // bodies (handled in the next branch).
    if (
      e.kind === 'object' &&
      (e.templateId === 'dungeon_door' ||
        e.templateId === 'dungeon_exit' ||
        RIFT_PORTAL_IDS.has(e.templateId))
    ) {
      const entering =
        e.templateId === 'dungeon_door' ||
        e.templateId === 'rift_portal' ||
        e.templateId === 'rift_descent';
      // The overworld ranked portal AND the post-boss victory exit both get the
      // bespoke "gate" GLB (the exit is literally the way home tearing open); the
      // in-rift descent/pylons keep the procedural arch. Gate builder falls back to
      // the arch if its asset is missing.
      const asGate = e.templateId === 'rift_portal' || e.templateId === 'rift_exit';
      const built =
        (asGate ? buildRiftGateBody(this.lowGfx, e.riftTier) : null) ??
        buildDoorBody(entering, e.dungeonId, this.lowGfx);
      body = built.body;
      portal = built.portal;
      height = 4.6;
      objectMesh = built.body;
      // World-spawned ranked portals carry their rank as a big floating badge
      // (colour square + letter) so the tier reads from across the zone.
      if (e.templateId === 'rift_portal' && e.riftTier) {
        body?.add(buildRiftRankBadge(e.riftTier));
      }
    } else if (
      e.kind === 'object' &&
      (e.templateId === 'rift_beacon' ||
        e.templateId === 'rift_ice_goal' ||
        e.templateId === 'rift_boulder' ||
        e.templateId === 'rift_boulder_placed' ||
        e.templateId === 'rift_boulder_pad' ||
        e.templateId === 'rift_seq_rune' ||
        e.templateId === 'rift_seq_rune_lit' ||
        e.templateId === 'rift_pylon' ||
        e.templateId === 'rift_pylon_lit' ||
        e.templateId === 'rift_roller' ||
        e.templateId === 'rift_locked_chest' ||
        e.templateId === 'rift_chest_open' ||
        e.templateId === 'rift_chest_jammed' ||
        e.templateId === 'rift_treasure' ||
        e.templateId === 'rift_treasure_open' ||
        e.templateId === 'rift_gate' ||
        e.templateId === 'rift_gate_open' ||
        e.templateId === 'rift_switch' ||
        e.templateId === 'rift_switch_on' ||
        e.templateId === 'rift_infernal_orb' ||
        e.templateId === 'rift_infernal_orb_active')
    ) {
      // In-rift puzzle props (procedural; glowing ones spin via `portal`, the
      // rolling boulder rolls via `userData.rollRock`).
      const built = buildRiftPuzzleProp(e.templateId, this.lowGfx);
      body = built.body;
      portal = built.portal;
      height =
        e.templateId === 'rift_pylon' || e.templateId === 'rift_pylon_lit'
          ? 4.0
          : e.templateId === 'rift_gate' || e.templateId === 'rift_gate_open'
            ? 5.6
            : e.templateId === 'rift_roller'
              ? 3.0
              : e.templateId === 'rift_infernal_orb' || e.templateId === 'rift_infernal_orb_active'
                ? 2.2
                : 2.4;
      objectMesh = body!;
    } else if (e.kind === 'object' && e.templateId === 'mailbox') {
      // Ravenpost pillar: bespoke procedural prop (no sparkle; the unread-mail
      // votive in the group is the per-viewer beacon, toggled in sync()).
      const built = buildMailboxPillar(e.id);
      body = built.group;
      height = built.height;
      objectMesh = body!;
    } else if (e.kind === 'object' && e.templateId === 'noticeboard_eastbrook') {
      // The civic board is itself the readable interaction landmark. Keep the
      // complete GLB on every tier and avoid the generic loot sparkle.
      const built = buildEastbrookNoticeboard();
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
      objectMesh = built.group;
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
      objectMesh = body;
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

    const bankerChest = attachBankerChestToNpcView(
      group,
      e,
      this.sim.cfg.seed,
      this.sim.cfg.world?.npcs,
    );

    let clickTarget: THREE.Object3D;
    if (visual) {
      // raycasting skinned meshes is expensive, pick against the invisible
      // capsule proxy instead (three's raycaster ignores `visible`)
      if (!isQuestVision) visual.clickProxy.userData.entityId = e.id;
      clickTarget = visual.clickProxy;
    } else {
      // every object branch above built a body; the bare group is a benign
      // fallback for the (unreachable) no-body case
      if (body) {
        group.add(body);
        body.traverse((o) => {
          o.userData.entityId = e.id;
        });
        // Prop builders hang their ambience handles (rolling rock, orbiting
        // shards, pulsing veins, pylon flame, the mail votive) on the BODY they
        // return, but the per-frame animation pass reads them from the view
        // GROUP: hoist them across or every one of those animations sits inert.
        for (const key of ['rollRock', 'riftOrbiters', 'riftPulse', 'riftFlame', 'mailGlow']) {
          if (body.userData[key] !== undefined) group.userData[key] = body.userData[key];
        }
      }
      clickTarget = body ?? group;
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
    nameplateParent.appendChild(np);

    // Object views gate their own casters. Character shadows live in visual,
    // while separately composed accessories use this same distance gate.
    const objectCasters: THREE.Object3D[] = [];
    if (!visual) collectCasters(group, objectCasters);
    else if (bankerChest) collectCasters(bankerChest, objectCasters);
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
      mountVisual: null,
      mountVisualKey: '',
      mountLift: 0,
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
      nameplateScreenX: Number.NaN,
      nameplateScreenY: Number.NaN,
      nameplateSig: '',
      nameplateStaticName: '',
      nameplateStaticColor: null,
      nameplateStaticHpDisplay: '',
      nameplateStaticMarker: '',
      nameplateStaticMarkerClass: '',
      nameplateStaticOpacity: '',
      nameplateStaticFrame: '',
      nameplateStaticGuild: '',
      nameplateStaticDevOutline: null,
      nameplateStaticAi: false,
      nameplateStaticI18nRevision: 0,
      nameplateStateMask: 0,
      nameplateFriendlyPet: false,
      nameplateHpWidth: '',
      nameplateHp: Number.NaN,
      nameplateMaxHp: Number.NaN,
      titleSig: '',
      nameplateTitleId: '',
      nameplateTitleI18nRevision: 0,
      comboSig: '',
      nameplateComboCount: -1,
      tierValue: 0,
      devTierValue: 0,
      discordAvatarSig: '',
      levelSig: '',
      nameplateLevelText: '',
      nameplateLevelColor: '',
      objectCasters,
      viewLights,
      shadowOn: true,
      isFar: false,
      compilePending: false,
      compileReady: null,
      mountCompilePending: false,
      visualCompilePending: false,
      formCompilePending: null,
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
      locoState: newLocoState(),
      stepAccum: 0,
      waterContactSeen: false,
      waterContactActive: false,
      waterContactX: e.pos.x,
      waterContactZ: e.pos.z,
      waterContactAccum: 0,
      wasAirborne: false,
      wasSwimming: false,
      airborneHeurFrames: 0,
      lastMountKey: e.mountKey,
      wasMountCasting: e.mountCastRemaining > 0,
      stepSmooth: createStepSmooth(),
      groundTilt: createGroundTilt(),
      prevRenderY: 0,
      hasPrevY: false,
      fallSpeed: 0,
      // Stagger the first resample so a crowd spreads its terrain samples.
      tiltSampleT: (e.id % 7) * (TILT_SAMPLE_INTERVAL / 7),
      tiltGradX: 0,
      tiltGradZ: 0,
      tiltOnProp: false,
    });
    const view = this.views.get(e.id);
    // Never gate the player's OWN view: it must be on screen immediately, its
    // class is already prewarmed, and the self render path does not re-evaluate
    // the compilePending flag (only the non-self loop does), so gating it would
    // strand the player invisible. Other entities un-hide via that loop.
    if (view && e.id !== this.sim.player.id) {
      view.compileReady = this.gateViewOnCompile(view, group);
    }
  }

  // Shared core for every compile gate below: link `target`'s programs off the
  // main thread (KHR_parallel_shader_compile via compileAsync) against the live
  // scene's exact lights + environment. The same priority arbiter owns live
  // views and background uploads, so their WebGL work never overlaps.
  //
  // Deliberately ONE call per gated target, not batched into one call per frame.
  // #2571's third fix asked for exactly that batching, on the premise that "each
  // gated view calls compileAsync with the whole scene individually", checked
  // against the pinned three.js WebGLRenderer.compile()/compileAsync() source
  // directly rather than assumed. `compile(scene, camera, targetScene)` gathers
  // LIGHTS from `targetScene` (here `this.scene`, for a correct
  // NUM_POINT_LIGHTS/... shader variant) but only calls getProgram/prepareMaterial
  // by traversing `scene` (here `target`, the one gated node): "Only initialize
  // materials in the new scene, not the targetScene" per its own source comment.
  // So the expensive part (shader source generation, program acquisition) is
  // already scoped to the single target, never the whole scene; only the light
  // GATHERING walk re-scans `this.scene` on every call, and it is a plain
  // isLight check over the scene graph, not a shader compile. At the runtime
  // view-create budget (see VIEW_CREATE_BUDGET_HIGH; the boot prewarm's much
  // larger manifest is a separate, one-time pass with its own budgets), a
  // worst-case frame pays that redundant light-gather walk a handful of times,
  // never a redundant scene-wide shader compile. Batching multiple targets into
  // one compileAsync call is not achievable through the public API without either
  // reparenting each already-placed target out of its real scene position
  // (breaking its transform) or cloning every target into a scratch batch
  // container purely to compile it (paying a real allocation/traversal cost to
  // save a cheap boolean-flag walk). Given the traversal that actually matters is
  // already correctly scoped, and a real batch would cost more than it saves,
  // this stays one call per target.
  private compilePriorityFor(target: THREE.Object3D): number {
    let current: THREE.Object3D | null = target;
    while (current) {
      if (current.userData.entityId === this.sim.player.targetId) {
        return GPU_WORK_PRIORITY.ACTIONABLE_VIEW;
      }
      current = current.parent;
    }
    return GPU_WORK_PRIORITY.LIVE_VIEW;
  }

  private compileGate(target: THREE.Object3D): Promise<unknown> {
    const priority = this.compilePriorityFor(target);
    return this.liveCompileGates.run(
      () => this.webgl.compileAsync(target, this.camera, this.scene),
      VIEW_COMPILE_GATE_MAX_MS,
      { priority },
    );
  }

  private recoverRejectedCompileGate(
    error: unknown,
    generation: number,
    restore: () => void,
  ): void {
    // Shutdown rejects queued GPU work on purpose. A stale completion must not
    // mutate the next renderer generation or produce a misleading live error.
    if (this.shutdownStarted || generation !== this.lifecycleGeneration) return;
    restore();
    console.error('Live shader compile gate failed', error);
  }

  // Generic anti-freeze layer. A freshly-streamed view links its shader programs
  // SYNCHRONOUSLY on first draw - a 50-1700ms frame stall (the open-world travel
  // hitch). Instead link them OFF the main thread and keep the view hidden until
  // ready: it pops in a frame or two late rather than freezing. Unlike the boot
  // prewarm this enumerates NOTHING, so new content and render-state variants the
  // prewarm cannot anticipate (e.g. the env-map-lit material that links only when
  // you walk into a biome) never hitch in-world. The prewarm stays a pure
  // optimization: already-compiled spawn content resolves instantly, no pop-in.
  private gateViewOnCompile(view: EntityView, group: THREE.Group): Promise<void> | null {
    if (!this.asyncCompileSupported) return null;
    const generation = this.lifecycleGeneration;
    const priorVisibility = group.visible;
    view.compilePending = true;
    group.visible = false;
    // The DOM nameplate, target marker, health, and cast bar remain available
    // while the 3D group is gated, so actionable information has an immediate
    // placeholder without first-drawing a still-linking shader.
    return this.compileGate(group).then(
      () => {
        if (!this.shutdownStarted && generation === this.lifecycleGeneration) {
          view.compilePending = false;
        }
      },
      (error) => {
        this.recoverRejectedCompileGate(error, generation, () => {
          view.compilePending = false;
          group.visible = priorVisibility;
        });
      },
    );
  }

  // Sibling to gateViewOnCompile for a live material-variant swap on an
  // ALREADY-VISIBLE entity (a gear/weapon-skin prop just attached to a
  // character already on screen, see #2571 commit 2). Hiding the WHOLE
  // character like a brand-new view would be a worse regression than the
  // freeze this prevents, so this hides only the swapped node: the rest of
  // the character keeps animating and drawing normally, and the new prop
  // pops in a frame or two late instead of stalling the frame. Safe only for
  // a node nothing else drives the visibility of per frame (a weapon/offhand
  // payload, once attached, is left alone); for one the per-frame loop
  // recomputes every tick, use gateSwapFlagOnCompile instead.
  private gateSwapOnCompile(target: THREE.Object3D): void {
    if (!this.asyncCompileSupported || !target.visible) return;
    const generation = this.lifecycleGeneration;
    target.visible = false;
    void this.compileGate(target).then(
      () => {
        if (!this.shutdownStarted && generation === this.lifecycleGeneration) {
          target.visible = true;
        }
      },
      (error) => {
        this.recoverRejectedCompileGate(error, generation, () => {
          target.visible = true;
        });
      },
    );
  }

  // Sibling to gateSwapOnCompile for a swap whose .visible the per-frame loop
  // ALREADY recomputes every tick (the mount root, the base visual root after
  // a skin or visual-key swap): a direct hide would be overwritten later the
  // same frame, so this compiles in the background and reports back through a
  // caller-owned flag those per-frame lines AND against instead. The caller
  // sets its pending flag to true BEFORE calling this, so onSettled MUST still
  // run when the gate is a no-op (unsupported browser): otherwise the flag is
  // permanently stuck true and the target stays hidden forever.
  private gateSwapFlagOnCompile(target: THREE.Object3D, onSettled: () => void): void {
    if (!this.asyncCompileSupported) {
      onSettled();
      return;
    }
    const generation = this.lifecycleGeneration;
    void this.compileGate(target).then(
      () => {
        if (!this.shutdownStarted && generation === this.lifecycleGeneration) onSettled();
      },
      (error) => {
        this.recoverRejectedCompileGate(error, generation, onSettled);
      },
    );
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
    // A live base-visual replace (race/mech toggle) is exactly a brand-new
    // rig's materials linking for the first time; gate it the same as a
    // gear swap rather than freezing the frame it lands on (#2571).
    v.visualCompilePending = true;
    this.gateSwapFlagOnCompile(next.root, () => {
      v.visualCompilePending = false;
    });
  }

  private reconcileViewLights(v: EntityView): void {
    const reconciled = reconcileViewPointLights(v.group, v.viewLights, this.viewLights);
    if (!reconciled.changed) return;
    v.viewLights = reconciled.lights;
    this.lightRankDirty = true;
    if (v.viewLights.length > 0) this.lightOwnerGroups.add(v.group);
    else this.lightOwnerGroups.delete(v.group);
  }

  // Dev probe surface (scripts/ability_vfx_probe.mjs via window.__game):
  // per-ability claim/primitive counters from the ability VFX painter, the
  // live body-glow intensity of an entity, and the one-shot swing counter.
  abilityVfxStats(): Record<string, { claimed: number; primitives: number }> {
    return this.abilityVfx.statsSnapshot();
  }

  abilityVfxGlow(entityId: number): number {
    return this.abilityVfx.glowIntensityOf(entityId);
  }

  abilityVfxGroundAuras(entityId: number): number {
    return this.abilityVfx.groundAuraCountOf(entityId);
  }

  abilityVfxAttackCount(): number {
    return this.attackTriggerCount;
  }

  private attackTriggerCount = 0;

  triggerAttack(entityId: number, abilityId?: string): void {
    const v = this.views.get(entityId);
    const visual = v ? this.activeVisual(v) : null;
    if (!visual) return;
    this.attackTriggerCount++;
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
  // Rift interiors are the one interior class whose world origin is REUSED: an
  // empty slot frees after 60s and the next run rebuilds at the same z-stacked
  // origin, so a stale group would overlap the new build and its torch lights
  // would stack into the per-frame fire-light budget forever. Tracked per key;
  // every build retires the others (a descended-from floor included: there is
  // no way back up). Geometries/materials are NOT disposed here: kit meshes
  // share the loader cache and the instance-held kit materials, so only the
  // scene-graph nodes and the light/flame registries are reclaimed.
  private riftInteriorGroups = new Map<string, THREE.Group>();
  // Protect Yumi maze interiors, one per match slot, built lazily like the
  // arena copies; their update() anchors the team beacons each frame.
  private yumiMazeViews = new Map<number, YumiMazeView>();
  // Blue/red team arrows above every yumi fighter (yumi_team_markers.ts).
  private readonly yumiTeamMarkers = new YumiTeamMarkers();
  // Delve module interiors build asynchronously; track in-flight keys so a
  // per-frame ensureDelveInteriorsNear does not re-schedule a build mid-load.
  private pendingInteriors = new Set<string>();
  // Re-applied rift fog is keyed by the floor descriptor (seed:floorIndex) so a
  // descent (same 'rift' fogState, different palette) still refreshes the fog.
  private riftFogKey: string | null = null;
  // Cached with riftFogKey: whether the current rift floor is an authored set
  // piece, so the per-frame lighting read avoids regenerating the floor.
  private riftFogAuthored = false;
  private fogState:
    | 'outdoor'
    | 'dungeon'
    | 'temple'
    | 'nythraxis'
    | 'delve'
    | 'yumiMaze'
    | 'underwater'
    | 'rift'
    | 'practice'
    | 'wildheartField'
    | 'lastkeep' = 'outdoor';

  /** Drop a retired interior's scene nodes and prune its lights/flames out of
   * the per-frame registries. See riftInteriorGroups for why nothing here
   * calls dispose(): the meshes share cached kit geometry and materials. */
  private retireInteriorGroup(group: THREE.Group): void {
    this.scene.remove(group);
    const doomed = new Set<THREE.Object3D>();
    group.traverse((o) => doomed.add(o));
    for (let i = this.fireLights.length - 1; i >= 0; i--) {
      if (doomed.has(this.fireLights[i])) this.fireLights.splice(i, 1);
    }
    for (let i = this.flames.length - 1; i >= 0; i--) {
      if (doomed.has(this.flames[i])) this.flames.splice(i, 1);
    }
    this.dungeons?.retireHideables(doomed);
  }

  private buildInterior(
    interior: string,
    ox: number,
    oz: number,
    opts?: Parameters<DungeonInteriors['buildInterior']>[3],
  ): void {
    this.dungeons ??= new DungeonInteriors(this.scene, this.lowGfx, this.flames, this.fireLights);
    void this.dungeons.buildInterior(interior, ox, oz, opts).catch((err) => {
      console.error('Failed to build dungeon interior:', err);
    });
  }

  // Outdoor fog presets per biome (high tier eases between them as the player
  // crosses zone bands; low keeps one preset everywhere). Distances are the
  // pre-residency-clamp table opened back up (roughly x1.5): with the
  // visible-zone streaming lane keeping neighbours resident before they can
  // be seen, the fog no longer has to hide unloaded regions itself, so the
  // sky and real vistas read again. fogFarForPreparedZones stays as the
  // safety clamp for the brief window a build is still catching up. No far
  // exceeds MAX_OUTDOOR_FOG_FAR (the rendering/culling envelope).
  //
  // The MURKY realms (marsh, haunt, frost, ember, dusk, amber and the two
  // paint-only caves) then got a readability pass: their `near` was where the
  // "cannot see anything in front of me" reports came from, since the chase
  // camera sits ~12 yd behind the player and a near of 45 puts the fog barely
  // 30 yd ahead of the character. `near` moves out further than `far` here,
  // which does steepen those gradients slightly, but it is the plane the
  // complaint is actually about and it costs nothing to draw. `far` moves only
  // enough to keep each realm's silhouette depth (fog far drives terrain,
  // prop and foliage culling, so it is the expensive half). The clear realms
  // (vale, peaks, fen, jungle, garden, gale and friends) were already open and
  // are untouched.
  private static BIOME_FOG: Record<BiomeId, { color: number; near: number; far: number }> = {
    // The blue-sky biomes carry a deeper sky-blue haze (the old paler values
    // tonemapped to near white, so fully fogged distant trees and zones read
    // as white cutouts against the HDRI sky instead of far-off silhouettes).
    // 700 (not the 850 cap) on the open blue-sky realms: at 850 the last
    // visible hills sat almost fully outside the haze and the horizon read
    // cutout-crisp, with the same saturation at 400 yd as at 40. 700 puts real
    // aerial perspective on the far third while costing nothing near (and
    // fog-far drives culling, so the trim is a small draw-count win too).
    vale: { color: 0x7095bd, near: 55, far: 700 },
    // pale sage matched to the marsh horizon sky: the dome renders fog-free,
    // so a darker murk left every fully fogged silhouette as a cutout band
    marsh: { color: 0xc2cbb6, near: 75, far: 165 },
    peaks: { color: 0x8bb0d4, near: 55, far: 700 },
    beach: { color: 0x7ea6c9, near: 50, far: 700 },
    desert: { color: 0xd8c9a8, near: 50, far: 700 },
    volcano: { color: 0x8a7468, near: 60, far: 145 },
    cave: { color: 0x76807c, near: 48, far: 125 },
    // permanent dusk: rose-mauve murk, the realm's signature
    dusk: { color: 0xc9a3bd, near: 115, far: 400 },
    // scorched haze south, thicker toward the volcanic north (looks pass)
    ember: { color: 0x9a5844, near: 115, far: 385 },
    // the Frostveil: icy mist, the coldest sightlines in the world
    frost: { color: 0xa9bed2, near: 95, far: 325 },
    // the Amberfall: warm golden haze under an endless afternoon
    amber: { color: 0xdec18e, near: 130, far: 430 },
    // the Willowfen: clear airy morning, the lightest fog in the world
    // (deepened from 0xcfe2dc: the near-white haze tonemapped to a white
    // cutout band on the horizon instead of reading as distance, with the same
    // lesson as the blue-sky biomes above)
    fen: { color: 0xb7d0c6, near: 140, far: 510 },
    // the Nightbloom: a lavender dream-haze over the violet downs, deepened
    // to twilight with the realm's new dimmed light level
    night: { color: 0x8d7fc0, near: 110, far: 460 },
    // the Wraithwood: dead-grey murk, the tightest sightlines outdoors
    haunt: { color: 0x454c46, near: 85, far: 265 },
    // the Palmreach: bright humid haze, the clearest air in the world
    jungle: { color: 0xc2e0d0, near: 165, far: 600 },
    // the Evergarden: crystal parkland air with the faintest green cast
    garden: { color: 0xc6ddc6, near: 175, far: 630 },
    // the Galecrest: scrubbed salt air, dawn-lit haze off the sea
    gale: { color: 0xccc9d8, near: 170, far: 645 },
  };
  // Low tier trades view distance for draw count (its own perf knob, never a
  // gameplay one: entities draw within their own much shorter ranges on every
  // tier, so fog distance sheds only cosmetic scenery). Takes the same
  // readability pass on `near`, with `far` held nearly still so the tier keeps
  // paying for itself.
  private static LOW_FOG = { color: 0xa6c6e0, near: 115, far: 340 };

  // Per-biome outdoor light grade, eased alongside fog in updateAmbience.
  // The three original biomes keep the exact constants the lights were
  // created with; the dusk realm warms the sun to late-evening orange and
  // turns the sky bounce rose over violet ground. The optional sun/hemi/env
  // scales multiply the rig intensities, so a realm's mood can finally live
  // in light LEVEL as well as hue (gloom via color luminance alone left the
  // Nightbloom's canopies rendering in full daylight green).
  private static BIOME_LIGHT: Record<
    BiomeId,
    {
      hemiSky: number;
      hemiGround: number;
      sun: number;
      sunScale?: number;
      hemiScale?: number;
      envScale?: number;
    }
  > = {
    vale: { hemiSky: 0xdcefff, hemiGround: 0x465f39, sun: 0xffedd0 },
    marsh: { hemiSky: 0xdcefff, hemiGround: 0x465f39, sun: 0xffedd0 },
    peaks: { hemiSky: 0xdcefff, hemiGround: 0x465f39, sun: 0xffedd0 },
    dusk: { hemiSky: 0xffc9dd, hemiGround: 0x4d3f63, sun: 0xffb072 },
    ember: { hemiSky: 0xe89070, hemiGround: 0x422424, sun: 0xff7440 },
    frost: { hemiSky: 0x9cb6d6, hemiGround: 0x66748a, sun: 0xccdaea },
    amber: { hemiSky: 0xffe2b0, hemiGround: 0x5a4a30, sun: 0xffc86a },
    fen: { hemiSky: 0xdceeff, hemiGround: 0x51704e, sun: 0xfff0d2 },
    // the Nightbloom: dreamlight. A cool rose sun over lavender sky bounce
    // and deep violet ground: luminous, but at a twilight level. At full
    // day strength its canopies and downs rendered in ordinary daylight
    // green under the starfield sky
    night: {
      hemiSky: 0xc0b2f0,
      hemiGround: 0x463a6e,
      sun: 0xe6d4ff,
      sunScale: 0.6,
      hemiScale: 0.95,
      envScale: 0.7,
    },
    // the Wraithwood: sickly grey light strangled by the canopy, dim as
    // well as grey now that the rig has an intensity knob
    haunt: { hemiSky: 0x4d564c, hemiGround: 0x0e120e, sun: 0x6e7a66, sunScale: 0.8, envScale: 0.8 },
    // the Palmreach: hard tropical daylight over deep green bounce
    jungle: { hemiSky: 0xeafcff, hemiGround: 0x3a6a42, sun: 0xfff4d8 },
    // the Evergarden: soft perfect afternoon over clipped lawns
    garden: { hemiSky: 0xe8f8ff, hemiGround: 0x4a7a44, sun: 0xfff2d0 },
    // the Galecrest: cool dawn light, sea-grey bounce off the downs
    gale: { hemiSky: 0xe4e8f2, hemiGround: 0x4e6a52, sun: 0xffe8c8 },
    // paint-only biomes (map editor, never a built-in realm): beach reuses the
    // neutral vale grade, desert the amber warmth, volcano the ember glow, cave
    // the wraithwood gloom.
    beach: { hemiSky: 0xdcefff, hemiGround: 0x465f39, sun: 0xffedd0 },
    desert: { hemiSky: 0xffe2b0, hemiGround: 0x5a4a30, sun: 0xffc86a },
    volcano: { hemiSky: 0xe89070, hemiGround: 0x422424, sun: 0xff7440 },
    cave: { hemiSky: 0x4d564c, hemiGround: 0x0e120e, sun: 0x6e7a66, sunScale: 0.8, envScale: 0.8 },
  };

  private outdoorFogPreset(): { color: number; near: number; far: number } {
    if (this.lowGfx) return Renderer.LOW_FOG;
    return Renderer.BIOME_FOG[zoneBiomeAt(this.sim.player.pos.x, this.sim.player.pos.z)];
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
    const biome = zoneBiomeAt(this.sim.player.pos.x, pz);
    const phaseOverride = dayNightPhaseOverride();
    if (this.lowGfx && DAY_ONLY && phaseOverride === null) {
      if (this.fixedLowDayBiome !== biome) {
        this.dnGrade = NEUTRAL_DAY_GRADE;
        this.sunDir.copy(SUN_DIR);
        this.moonDir.set(0, -1, 0);
        this.sunUp = aboveHorizon(SUN_DIR.y) * REALM_DAYNIGHT_AMPLITUDE[biome];
        this.moonUp = 0;
        this.starAmt = 0;
        this.fixedLowDayBiome = biome;
      }
    } else {
      this.fixedLowDayBiome = null;
      // This is render-only, so the clock read never touches sim parity. The
      // dev override still drives the real grade even while DAY_ONLY ships.
      const phase = currentDayNightPhase();
      const gday = globalDayness(phase);
      this.dnGrade =
        DAY_ONLY && phaseOverride === null
          ? NEUTRAL_DAY_GRADE
          : dayNightGrade(effectiveDayness(gday, biome));
      const amp = REALM_DAYNIGHT_AMPLITUDE[biome];
      if (DAY_ONLY && phaseOverride === null) {
        this.sunDir.copy(SUN_DIR);
        this.moonDir.set(0, -1, 0);
        this.sunUp = aboveHorizon(SUN_DIR.y) * amp;
        this.moonUp = 0;
        this.starAmt = 0;
      } else {
        const sd = sunDirection(phase);
        const md = moonDirection(phase);
        this.sunDir.set(sd[0], sd[1], sd[2]);
        this.moonDir.set(md[0], md[1], md[2]);
        this.sunUp = aboveHorizon(sd[1]) * amp;
        this.moonUp = aboveHorizon(md[1]) * Math.max(amp, 0.6);
        this.starAmt = nightStarAmount(gday);
      }
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
          setRenderCategory(view.group, 'dungeon');
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
    } else if (isRiftPos(px)) {
      // Procedural rift: regenerate the floor's geometry + style from the
      // descriptor (IWorld.riftFloor) and build it at the floor's own z-stacked
      // origin. Each (seed, floorIndex) is a distinct key + origin, so descending
      // builds a fresh interior; the previous floor's geometry harmlessly persists
      // off-screen (the player has descended away), like authored dungeon copies.
      const rf = this.sim.riftFloor;
      if (rf) {
        void ensureDungeonAssets().catch(() => undefined);
        const key = `rift:${rf.instanceId}:${rf.contentHash}:${rf.floorIndex}`;
        if (!this.builtInteriors.has(key)) {
          const o = rf.origin;
          if (Math.abs(px - o.x) < 200 && Math.abs(pz - o.z) < 250) {
            this.builtInteriors.add(key);
            const floor = generateRiftFloor(rf.seed, rf.baseLevel, rf.floorIndex, rf.upgrade);
            this.dungeons ??= new DungeonInteriors(
              this.scene,
              this.lowGfx,
              this.flames,
              this.fireLights,
            );
            void this.dungeons
              .buildInterior(floor.style.kit, o.x, o.z, {
                layout: floor.layout,
                style: floor.style,
                hazards: floor.hazards,
                hazardStyle: 'lava',
                iceZone: floor.iceZone,
                platform: floor.platform,
              })
              .then((group) => {
                for (const [staleKey, staleGroup] of this.riftInteriorGroups) {
                  if (staleKey === key) continue;
                  this.retireInteriorGroup(staleGroup);
                  this.riftInteriorGroups.delete(staleKey);
                  this.builtInteriors.delete(staleKey);
                }
                this.riftInteriorGroups.set(key, group);
              })
              .catch((err) => {
                console.error('Failed to build rift interior:', err);
              });
          }
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
    // Wildheart is an OPEN-AIR jungle caldera, not a closed room: it keeps the
    // sky dome and the daylight rig and only swaps in its own field haze.
    const inWildheartField = interior === 'wildheart';
    const inLastKeep = interior === 'lastkeep';
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
              : inWildheartField
                ? 'wildheartField'
                : inLastKeep
                  ? 'lastkeep'
                  : inside
                    ? 'dungeon'
                    : camY < waterLevelAt(px, pz) - 0.05
                      ? 'underwater'
                      : 'outdoor';
    const fog = this.scene.fog as THREE.Fog;
    // Procedural rift: dynamic fog from the generated floor style, re-applied when
    // the floor changes (descent keeps fogState='rift' but swaps the palette).
    const riftFloor = inside && isRiftPos(px) ? this.sim.riftFloor : null;
    if (riftFloor) {
      const fogKey = `${riftFloor.contentHash}:${riftFloor.floorIndex}`;
      if (fogKey !== this.riftFogKey) {
        this.riftFogKey = fogKey;
        const floor = generateRiftFloor(
          riftFloor.seed,
          riftFloor.baseLevel,
          riftFloor.floorIndex,
          riftFloor.upgrade,
        );
        this.riftFogAuthored = floor.authored === true;
        const style = floor.style;
        fog.color.setHex(style.fog.color);
        fog.near = style.fog.near;
        fog.far = style.fog.far;
      }
      this.fogState = 'rift';
      if (!this.lowGfx) {
        const authored = this.riftFogAuthored;
        this.sun.intensity = authored ? INFERNAL_SUN_INTENSITY : DUNGEON_SUN_INTENSITY;
        this.hemi.intensity = authored ? INFERNAL_HEMI_INTENSITY : DUNGEON_HEMI_INTENSITY;
        this.scene.environmentIntensity = authored ? INFERNAL_ENV_INTENSITY : DUNGEON_ENV_INTENSITY;
        sharedUniforms.uRimBoost.value = authored ? INFERNAL_RIM_BOOST : DUNGEON_RIM_BOOST;
      }
      return;
    }
    this.riftFogKey = null;
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
        // the raid arena is huge (±230), push the murk back so ~50yd reads
        // clear (linear-fog midpoint (near+far)/2 = 50), not the old ~30
        fog.color.setHex(0x020106);
        fog.near = 20;
        fog.far = 80;
      } else if (desired === 'wildheartField') {
        // Sunlit humid depth keeps the full caldera readable while the rear
        // shrine and limestone shell settle into a warm green atmospheric veil.
        fog.color.setHex(0x8ca786);
        fog.near = 105;
        fog.far = 430;
      } else if (desired === 'lastkeep') {
        // The Last Keep: a warm hearth-lit haze pushed well back, so its
        // grand three-story halls read golden and inhabited instead of
        // dissolving into the crypt's cold near-black murk.
        fog.color.setHex(0x241610);
        fog.near = 30;
        fog.far = 150;
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
      // The rim glow cranks up instead, silhouettes must split from the murk.
      if (!this.lowGfx) {
        const mazeNight = desired === 'yumiMaze';
        const wildheartSun = desired === 'wildheartField';
        const keepHearth = desired === 'lastkeep';
        const underground =
          desired === 'dungeon' ||
          desired === 'temple' ||
          desired === 'nythraxis' ||
          desired === 'delve';
        // The maze runs its own night rig; otherwise returning outdoors restores the
        // full daylight rig scaled by the current day/night grade, so stepping out
        // of a cave at night stays night.
        this.sun.intensity = mazeNight
          ? YUMI_MAZE_SUN_INTENSITY
          : wildheartSun
            ? WILDHEART_SUN_INTENSITY
            : keepHearth
              ? LASTKEEP_SUN_INTENSITY
              : underground
                ? DUNGEON_SUN_INTENSITY
                : SUN_INTENSITY * this.dnGrade.lightScale;
        this.hemi.intensity = mazeNight
          ? YUMI_MAZE_HEMI_INTENSITY
          : wildheartSun
            ? WILDHEART_HEMI_INTENSITY
            : keepHearth
              ? LASTKEEP_HEMI_INTENSITY
              : underground
                ? DUNGEON_HEMI_INTENSITY
                : hemiOutdoorIntensity() * this.dnGrade.lightScale;
        this.scene.environmentIntensity = mazeNight
          ? YUMI_MAZE_ENV_INTENSITY
          : wildheartSun
            ? WILDHEART_ENV_INTENSITY
            : keepHearth
              ? LASTKEEP_ENV_INTENSITY
              : underground
                ? DUNGEON_ENV_INTENSITY
                : this.envOutdoorIntensity * this.dnGrade.lightScale;
        sharedUniforms.uRimBoost.value = mazeNight
          ? YUMI_MAZE_RIM_BOOST
          : wildheartSun
            ? WILDHEART_RIM_BOOST
            : keepHearth
              ? LASTKEEP_RIM_BOOST
              : underground
                ? DUNGEON_RIM_BOOST
                : 1;
        if (wildheartSun) {
          this.sun.color.setHex(0xffd48c);
          this.hemi.color.setHex(0xd8ebca);
          this.hemi.groundColor.setHex(0x5b4a2d);
        } else if (keepHearth) {
          // hearth-gold key and bounce; the outdoor path re-grades these
          // colors every frame once the player steps back outside
          this.sun.color.setHex(LASTKEEP_SUN_COLOR);
          this.hemi.color.setHex(LASTKEEP_HEMI_SKY_COLOR);
          this.hemi.groundColor.setHex(LASTKEEP_HEMI_GROUND_COLOR);
        }
      }
      return;
    }
    // Outdoors, fog is also the residency boundary. Pull it inward immediately
    // before an unloaded zone can become visible; once that zone has been
    // loaded by the boundary transition, ease the view distance back out.
    if (desired === 'outdoor') {
      const g = this.dnGrade;
      const preset = this.outdoorFogPreset();
      const k = transitionAlpha(dt, ZONE_ENVIRONMENT_RESPONSE);
      const requestedFar = preset.far * (this.lowGfx ? 1 : g.farScale);
      this.lastRequestedFogFar = requestedFar;
      this.lastRequestedFogNear = preset.near;
      // Residency is read per CHUNK, through the terrain view's own accessor.
      // Asking per ZONE meant an unprepared 36-to-54 chunk rectangle within
      // ~53 yd pinned the view at the floor until that entire rectangle (and
      // its HDRI) finished: 198 s of 45-yard wall after a Drakelands portal.
      // Read live rather than cached: an editor rebuildTerrain swaps the view.
      const ground = this.terrainView.groundResidency();
      const atmosphericFar = dampedValue(fog.far, requestedFar, dt, ZONE_ENVIRONMENT_RESPONSE);
      const residencyFar = fogFarForBuiltGround(
        ground.grid,
        ground.isPending,
        this.camera.position.x,
        this.camera.position.z,
        atmosphericFar,
      );
      fog.far = easedFogFar(fog.far, requestedFar, residencyFar, dt);
      fog.near = easedFogNear(fog.near, preset.near, fog.far, dt);
      if (this.lowGfx) return;
      // fog color: the biome hue multiplied by the day/night color (a dark
      // dusk-blue by night)
      this.fogScratch.setHex(preset.color);
      this.fogScratch.r *= g.fog[0];
      this.fogScratch.g *= g.fog[1];
      this.fogScratch.b *= g.fog[2];
      fog.color.lerp(this.fogScratch, k);
      // ...and the light grade with it (the dusk realm's warm sun and rose sky
      // bounce, a no-op elsewhere by day since the presets match the ctor hues):
      // the sun and sky hues cool toward moonlight at night, and the sun + sky
      // intensity scales down with the grade (the IBL follows in updateEnvBiome).
      const light = Renderer.BIOME_LIGHT[biome];
      // the sun light warms toward gold, gently by day and strongly as it nears
      // the horizon (a golden hour), then cools toward moonlight deep at night.
      // The warm blend is gated by aboveHorizon so it never tints the moonlight.
      const sunElev = this.sunDir.y;
      let hi = (sunElev - 0.08) / 0.5;
      hi = hi < 0 ? 0 : hi > 1 ? 1 : hi;
      const lowness = 1 - hi * hi * (3 - 2 * hi);
      // 0.42 base: with the key pinned at 31° the warm never ramps through
      // the old near-horizon band, so the standing gold has to come from the
      // base term. This is the golden-hour read at the permanent day angle
      const warmAmt = aboveHorizon(sunElev) * (0.52 + lowness * 0.4);
      this.dnColorScratch.setHex(light.sun);
      this.dnColorScratch.lerp(this.dnMoonScratch.setHex(WARM_SUN_COLOR), warmAmt);
      this.dnColorScratch.lerp(
        this.dnMoonScratch.setHex(MOON_SUN_COLOR),
        g.nightAmt * NIGHT_SUN_COOL,
      );
      this.sun.color.lerp(this.dnColorScratch, k);
      this.dnColorScratch
        .setHex(light.hemiSky)
        .lerp(
          this.dnMoonScratch.setHex(WARM_HEMI_SKY_COLOR),
          DAY_HEMI_SKY_WARMTH * (1 - g.nightAmt),
        )
        .lerp(this.dnMoonScratch.setHex(MOON_HEMI_SKY_COLOR), g.nightAmt * NIGHT_HEMI_COOL);
      this.hemi.color.lerp(this.dnColorScratch, k);
      // the ground bounce cools with the sky side so night shading does not keep
      // a warm daytime tint (its brightness still rides the hemi intensity above)
      this.dnColorScratch
        .setHex(light.hemiGround)
        .lerp(
          this.dnMoonScratch.setHex(WARM_HEMI_GROUND_COLOR),
          DAY_HEMI_GROUND_WARMTH * (1 - g.nightAmt),
        )
        .lerp(this.dnMoonScratch.setHex(MOON_HEMI_GROUND_COLOR), g.nightAmt * NIGHT_HEMI_COOL);
      this.hemi.groundColor.lerp(this.dnColorScratch, k);
      this.sun.intensity +=
        (SUN_INTENSITY * g.lightScale * (light.sunScale ?? 1) - this.sun.intensity) * k;
      this.hemi.intensity +=
        (hemiOutdoorIntensity() * g.lightScale * (light.hemiScale ?? 1) - this.hemi.intensity) * k;
    }
  }

  // Hand the prefiltered environment map to the dominant eased sky biome.
  // PMREMs cannot cross-fade, so their shared core fades the current IBL to a
  // low contribution, authorizes the texture/rotation swap, then restores the
  // new biome on the same long response as fog and light tint.
  private updateEnvBiome(dt: number): void {
    if (this.lowGfx || this.envRTs.size < 2 || this.fogState !== 'outdoor') return;
    const blend = this.skyView.currentBiomeBlend();
    const dominant = blend.t < 0.5 ? blend.from : blend.to;
    // the biome's light-level scale applies to the IBL too, or a dimmed realm
    // (Nightbloom twilight) would keep full-daylight ambient from its HDRI.
    // `dominant` is a SkyKey: the place-keyed skies (farshore, vale_cup) have
    // no BIOME_LIGHT row and take the neutral 1.
    const envScale =
      dominant in Renderer.BIOME_LIGHT
        ? (Renderer.BIOME_LIGHT[dominant as BiomeId].envScale ?? 1)
        : 1;
    const target = this.envRTs.has(dominant) ? dominant : this.envTransition.current;
    const settledIntensity = this.envOutdoorIntensity * this.dnGrade.lightScale * envScale;
    // Interior presets write the scene intensity directly. Re-seed from that
    // live value on the first outdoor frame so returning outside never jumps
    // back to a stale transition scalar.
    this.envTransition.intensity = this.scene.environmentIntensity;
    const swapTo = stepEnvironmentMapTransition(this.envTransition, target, settledIntensity, dt);
    if (swapTo !== null) {
      this.envBiome = swapTo;
      this.scene.environment = this.envRTs.get(swapTo)?.texture ?? null;
      this.scene.environmentRotation.y = this.skyView.envRotationY(swapTo);
    }
    this.scene.environmentIntensity = this.envTransition.intensity;
  }

  // Aim the key light (sun by day, moon by night) at the player. On the low tier
  // day/night is off, so it keeps the fixed anchor for a stable, cheap look.
  private updateKeyLight(pp: THREE.Vector3): void {
    if (this.lowGfx && !this.sun.castShadow) return;
    if (this.lowGfx) {
      this.sun.position.set(pp.x + SUN_ANCHOR.x, pp.y + SUN_ANCHOR.y, pp.z + SUN_ANCHOR.z);
    } else {
      // the key light hands off from the sun to the moon across the terminator.
      // Blend the two directions smoothly (rather than a hard switch) as the sun
      // sinks through the horizon, so the shadow direction glides instead of
      // popping; the swap happens at dusk/dawn when the light is dim anyway.
      let t = (0.05 - this.sunDir.y) / 0.2; // sunDir.y 0.05 -> sun, -0.15 -> moon
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const blend = t * t * (3 - 2 * t);
      this.lightDir.copy(this.sunDir).lerp(this.moonDir, blend).normalize();
      this.sun.position.set(
        pp.x + this.lightDir.x * SUN_TRAVEL_DISTANCE,
        pp.y + this.lightDir.y * SUN_TRAVEL_DISTANCE,
        pp.z + this.lightDir.z * SUN_TRAVEL_DISTANCE,
      );
    }
    this.sun.target.position.set(pp.x, pp.y, pp.z);
  }

  // Aim the sun and moon disc sprites along their directions and fade them by how
  // far each body sits above the horizon (out when below, and only outdoors).
  private updateCelestialSprites(): void {
    // The basin keeps directional daylight and the sky dome, but the camera-
    // riding sun and moon sprites can clip against its high rim as oversized
    // wedges. Reserve screen-space celestial overlays for the overworld.
    const outdoor = this.fogState === 'outdoor';
    for (const sp of this.sunSprites) {
      sp.position.copy(this.camera.position).addScaledVector(this.sunDir, 760);
      sp.visible = outdoor && this.sunUp > 0.02;
      sp.material.opacity = (sp.userData.baseOpacity as number) * this.sunUp;
    }
    for (const sp of this.moonSprites) {
      sp.position.copy(this.camera.position).addScaledVector(this.moonDir, 760);
      sp.visible = outdoor && this.moonUp > 0.02;
      sp.material.opacity = (sp.userData.baseOpacity as number) * this.moonUp;
    }
  }

  // Drop the view of an entity that left the world / our interest area.
  private removeView(id: number, terminal = false): void {
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
      // survive interest churn, dispose only per-instance mixer bindings.
      if (!terminal && v.visualPoolKey) this.storePooledVisual(v.visualPoolKey, v.visual);
      else v.visual.dispose();
      v.sheepVisual?.dispose();
      v.bearVisual?.dispose();
      v.catVisual?.dispose();
      v.travelVisual?.dispose();
      v.mountVisual?.dispose();
      v.fireballTravelVisual?.dispose();
    } else {
      if (!terminal && v.objectPoolKey && v.objectMesh instanceof THREE.Group) {
        this.storePooledObject(v.objectPoolKey, {
          group: v.objectMesh,
          height: v.height,
        });
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
    this.targetCone = {
      group,
      pos,
      localXZ: fan.localXZ,
      worldXYZ,
      ringPos,
      ringXZ,
      ringWorldXYZ,
    };
  }

  sync(
    alpha: number,
    dt: number,
    renderFacingOverride: number | null,
    selfAlphaLead = 0,
    selfMotion: SelfMotionFrame | null = null,
    selfAuthoritativeDiscontinuity = false,
  ): void {
    if (this.shutdownStarted) return;
    const totalStart = performance.now();
    let phaseStart = totalStart;
    const frameStats = this.lastFrameStats;
    const framePhaseMs = frameStats.phaseMs;
    const worldPhaseMs = frameStats.worldPhaseMs;
    beginRendererFrameTelemetry(framePhaseMs, worldPhaseMs, this.renderBudgetSample);
    let createdViews = 0;
    let removedViews = 0;
    const createdViewTypes = frameStats.createdViewTypes;
    createdViewTypes.length = 0;

    // Composer tiers: snapshot the previous frame's accumulated draw counters
    // (all composer + shadow passes) and re-arm the baseline BEFORE the governor
    // reads its draw signal below. The WebGL counters themselves stay monotonic
    // (autoReset is off); out-of-band renders reset them via discardOutOfBandDraws.
    if (this.drawStats) this.drawStats.beginFrame();
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
    const selfPos = this.updateSelfRenderPosition(
      alpha,
      dt,
      selfAlphaLead,
      selfMotion,
      selfAuthoritativeDiscontinuity,
    );
    phaseStart = this.markRendererPhase(framePhaseMs, 'setup', phaseStart);

    // dynamic worlds: create nearby views lazily and drop views for leavers or
    // entities that moved well outside the draw band. This avoids building
    // rig/nameplate DOM for the whole sim on the first rendered frame.
    createdViews += this.createRequiredViews(p, createdViewTypes, this.nameplateBatch);
    this.collectMissingViewCandidates(p, this.entityViewCreateRangeSq, false);
    createdViews += this.createCandidateViews(
      this.runtimeViewCreateBudget(dt),
      createdViewTypes,
      Infinity,
      this.nameplateBatch,
    );
    if (this.nameplateBatch.childNodes.length > 0) {
      this.nameplateLayer.appendChild(this.nameplateBatch);
    }
    this.doomedIds.length = 0;
    for (const id of this.views.keys()) {
      const e = sim.entities.get(id);
      if (
        !e ||
        (!isPersistentPortalObject(e) &&
          id !== p.id &&
          id !== p.targetId &&
          distSqXZ(e, p) > this.entityViewDestroyRangeSq)
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
    // The plan also carries the animated far band (articulated rig at a low
    // cadence between `lodRangeSq` and `staticRangeSq`) and its cadences.
    const lodBands = characterLodBandsInto(
      this.characterLodPlan,
      this.lastVisibleRigCount,
      ENTITY_SHADOW_RANGE_SQ,
      ENTITY_LOD_RANGE_SQ,
      GFX.farCharacterAnimScale,
      this.lastBudgetPressure,
    );
    const shadowRangeSq = lodBands.shadowRangeSq;
    const shadowsEnabled = this.sun.castShadow;
    let visibleRigCount = 0;

    for (const [id, v] of this.views) {
      const e = sim.entities.get(id);
      if (!e) continue;
      // Distance rejection comes before effect/state derivation. Retained views
      // outside the 80/96 yard visibility hysteresis rendered nothing before
      // and still render nothing, so their aura and actionability work can wait.
      const cdx = e.pos.x - p.pos.x,
        cdz = e.pos.z - p.pos.z;
      const d2 = cdx * cdx + cdz * cdz;
      const isSelf = id === p.id;
      if (
        !isSelf &&
        characterViewOutsideHysteresis(
          v.group.visible,
          d2,
          this.entityViewCreateRangeSq,
          this.entityViewDestroyRangeSq,
        )
      ) {
        v.group.visible = false;
        continue;
      }
      // form swaps (polymorph sheep, druid forms), computed up front because
      // the shadow gates below must not run the base rig's proxy under a form.
      // One pass over the aura list instead of repeated .some() scans per entity per
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
      let characterEffects = 0;
      for (const a of e.auras) {
        characterEffects = addCharacterEffectAura(characterEffects, a);
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
      const hasSoulRend = hasCharacterEffect(characterEffects, CHARACTER_EFFECT_SOUL_REND);
      const hasRecklessness = hasCharacterEffect(characterEffects, CHARACTER_EFFECT_RECKLESSNESS);
      // Pose carries information the player acts on (own feedback, the read on
      // the current target, pet combat, a cast windup telegraph) rather than
      // mere cosmetic smoothness: such an entity is exempt from BOTH the cadence
      // throttle and the crowd-pulled frozen-mesh swap below.
      const combatTargetId = e.aggroTargetId ?? e.targetId;
      const combatTarget =
        e.inCombat && combatTargetId !== null ? sim.entities.get(combatTargetId) : undefined;
      const actionablePose = animatesEveryFrame(
        id,
        p.id,
        p.targetId,
        e.castingAbility,
        e.inCombat,
        e.ownerId,
        combatTargetId,
        combatTarget?.ownerId ?? null,
      );
      if (isSelf) {
        v.group.visible = true;
        v.isFar = false;
        if (shadowsEnabled) {
          v.visual?.setShadow(true);
          v.visual?.setProxyShadow(false);
        }
      }
      if (!isSelf) {
        // Per-frame visibility uses the same create/destroy hysteresis as view
        // retention (above) so a rig hovering right at the draw edge
        // doesn't toggle visible/invisible every frame, that hard cutoff is the
        // actual on-screen boundary flicker. group.visible carries last frame's
        // state: once shown, keep it until past the 96yd destroy radius (where
        // the view is torn down anyway); while hidden, show only within 80yd.
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
        if (v.visual) {
          visibleRigCount++; // crowd-density signal for next frame's adaptive LOD
        }
        if (shadowsEnabled) {
          // mid-distance rigs keep rendering but leave the shadow pass
          const wantShadow = d2 < shadowRangeSq;
          const inProxyBand = d2 < ENTITY_PROXY_SHADOW_RANGE_SQ;
          v.visual?.setShadow(wantShadow);
          // past the articulated gate the static-pose proxy carries the
          // shadow; an active form's own rig keeps casting instead. A mounted
          // rider also skips the proxy: its baked ground-level idle silhouette
          // would render under the raised body.
          v.visual?.setProxyShadow(
            !wantShadow &&
              inProxyBand &&
              !polyed &&
              !bear &&
              !cat &&
              !travel &&
              !v.mountVisual &&
              !fireballForm,
          );
          // sheep/forms keep articulated shadows through the whole proxy band:
          // a frozen humanoid proxy silhouette would be wrong under a form
          const wantFormShadow = wantShadow || inProxyBand;
          v.sheepVisual?.setShadow(wantFormShadow);
          v.bearVisual?.setShadow(wantFormShadow);
          v.catVisual?.setShadow(wantFormShadow);
          v.travelVisual?.setShadow(wantFormShadow);
          v.mountVisual?.setShadow(wantFormShadow);
          if (wantShadow !== v.shadowOn) {
            v.shadowOn = wantShadow;
            for (const caster of v.objectCasters) (caster as THREE.Mesh).castShadow = wantShadow;
          }
        }
        if (v.visual) v.isFar = showsStaticFarMesh(d2, lodBands, actionablePose);
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
          v.compilePending,
          !isPortalObject || d2 <= this.entityViewCreateRangeSq,
        );
        if (v.sparkle && vis) {
          // sub-pixel beyond ~45u but still a full transparent draw each
          // (d2 is this entity's player distance, computed once above)
          v.sparkle.visible = d2 < SPARKLE_DRAW_RANGE_SQ;
          const pulse = 0.75 + Math.sin(this.time * 3 + e.id) * 0.25;
          v.sparkle.scale.set(pulse, pulse, 1);
          v.sparkle.material.rotation = this.time * 0.8;
        }
        let wardstoneLit = false;
        if (
          vis &&
          (e.objectItemId === 'bastion_ward_stone' || e.objectItemId === 'soulshard_pillar')
        ) {
          for (const aura of e.auras) {
            if (aura.id !== 'nythraxis_wardstone_lit') continue;
            wardstoneLit = true;
            break;
          }
        }
        if (wardstoneLit) {
          this.vfx.castSparkle(e.id, 'arcane', dt * 2.6);
        }
        if (v.portal && vis) {
          v.portal.rotation.z = this.time * 1.4;
          (v.portal.material as THREE.MeshBasicMaterial).opacity =
            0.45 + Math.sin(this.time * 2.2 + e.id) * 0.15;
        }
        if (vis && e.templateId === 'rift_roller') {
          // Roll the boulder about X in proportion to distance travelled (radius
          // 1.4), so it appears to roll without slipping as its entity advances.
          const rock = v.group.userData.rollRock as THREE.Object3D | undefined;
          if (rock) rock.rotation.x = e.pos.z * 0.714;
        }
        // Rift prop ambience: orbiting shards spin + bob; glowing veins/beams pulse.
        // Cheap (a handful of meshes on a few props per floor) and only when visible.
        if (vis) {
          const orbiters = v.group.userData.riftOrbiters as THREE.Object3D[] | undefined;
          if (orbiters) {
            for (let oi = 0; oi < orbiters.length; oi++) {
              const pv = orbiters[oi];
              pv.rotation.y = this.time * 1.1 + oi * 2.1;
              pv.position.y = 3.6 + Math.sin(this.time * 2 + oi * 1.7) * 0.18;
            }
          }
          const pulse = v.group.userData.riftPulse as THREE.Mesh[] | undefined;
          if (pulse) {
            const k = 0.7 + Math.sin(this.time * 3 + e.id) * 0.3;
            for (const m of pulse) {
              const mat = m.material as THREE.MeshBasicMaterial;
              if (mat.userData.baseOpacity === undefined) mat.userData.baseOpacity = mat.opacity;
              mat.opacity = (mat.userData.baseOpacity as number) * k;
            }
          }
          // Arcane flame crowning a lit pylon: flicker the height + a lick of sway,
          // so the Tripo flame reads as living fire rather than a frozen mesh.
          const flame = v.group.userData.riftFlame as THREE.Object3D | undefined;
          if (flame) {
            const t = this.time * 9 + e.id;
            flame.scale.y = 1 + Math.sin(t) * 0.14 + Math.sin(t * 2.3) * 0.06;
            flame.scale.x = flame.scale.z = 1 + Math.sin(t * 1.7 + 1) * 0.06;
            flame.rotation.y = Math.sin(this.time * 1.3 + e.id) * 0.25;
          }
          // Continuous particle ambience via the real VFX system (like the Nythraxis
          // wardstone above): a lit pylon fizzes arcane motes; the rolling boulder
          // trails embers. Rate-scaled by dt, skipped on low-gfx by the emitter.
          if (e.templateId === 'rift_pylon_lit') this.vfx.castSparkle(e.id, 'arcane', dt * 2.2);
          else if (e.templateId === 'rift_roller') this.vfx.castSparkle(e.id, 'fire', dt * 2.4);
        }
        if (vis && e.templateId === 'mailbox') {
          // The unread-mail votive: per-viewer beacon driven by the IWorld
          // mirror (a cheap field online, a small filter offline; <=4 pillars).
          const glow = v.group.userData.mailGlow as THREE.Object3D | undefined;
          if (glow) {
            const lit = this.sim.mailUnread > 0;
            glow.visible = lit;
            if (lit) {
              const baseLocalY = glow.userData.mailGlowBaseLocalY as number;
              glow.position.y = baseLocalY + Math.sin(this.time * 2.4 + e.id) * 0.06;
            }
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

      // live skin swap: appearance changed (in-game changer or a multiplayer peer).
      // NOT gated: unlike a base-visual swap, the old rig is not being replaced,
      // just re-textured in place, so there is no reason to hide the whole
      // character while its shader links. Hiding it (as an earlier version of
      // this fix did, reusing visualCompilePending) made a skin change worse
      // than the freeze it was meant to prevent (up to 1500ms with the whole
      // character invisible). Every player skin variant is already compiled by
      // the boot prewarm anyway (see entities.player-archetypes); an uncached
      // mob/NPC skin combo still pays the old synchronous first-draw cost, same
      // as before this fix (#2571 review).
      if (e.skin !== v.skin) {
        v.skin = e.skin;
        v.visual.setSkin(e.skin);
      }

      // live held-weapon swap, equipped mainhand changed (self equip or a peer's
      // gear update); setWeapon no-ops on classes with a fixed weapon (hunter).
      // Gated per newly attached payload: nothing else in this loop drives its own
      // .visible, so first-sight materials link off-thread instead of freezing the
      // frame the gear lands on (#2571).
      if (e.mainhandItemId !== v.mainhandItemId) {
        v.mainhandItemId = e.mainhandItemId;
        const changed = v.visual.setWeapon(e.mainhandItemId);
        if (changed) for (const node of changed) this.gateSwapOnCompile(node);
        this.reconcileViewLights(v);
      }

      if (e.offhandItemId !== v.offhandItemId) {
        v.offhandItemId = e.offhandItemId;
        const changed = v.visual.setOffhand(e.offhandItemId);
        if (changed) for (const node of changed) this.gateSwapOnCompile(node);
        this.reconcileViewLights(v);
      }

      // live weapon-skin swap: a Season 1 Armory cosmetic applied/detached (self
      // or a peer, via the identity wire); replaces the held model + rarity VFX
      if (e.weaponSkinId !== v.weaponSkinId) {
        v.weaponSkinId = e.weaponSkinId;
        const changed = v.visual.setWeaponSkin(e.weaponSkinId);
        if (changed) for (const node of changed) this.gateSwapOnCompile(node);
        this.reconcileViewLights(v);
      }
      const weaponAura = characterWeaponAuraInto(e, this.weaponAuraScratch);
      v.visual.setWeaponAura(weaponAura ? weaponAura.color : null, weaponAura?.tip ?? false);

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

      // lazy form visuals, swapped by visibility like the old sheep/bear rigs
      // A null build leaves the field unset; the shared gate retries after its cooldown.
      // A freshly built form root is exactly a brand-new rig's materials linking for
      // the first time (same as a race/mech base-visual swap), so it is gated the
      // same way instead of freezing the frame the form lands on (#2571).
      if (polyed && !v.sheepVisual) {
        const built = this.createCharacterVisualWithRetry(e, 'form_sheep', 'form_sheep');
        if (built) {
          v.sheepVisual = built;
          v.group.add(built.root); // group.scale already carries e.scale
          v.formCompilePending = built.root;
          this.gateSwapFlagOnCompile(built.root, () => {
            v.formCompilePending = settlePendingSwap(v.formCompilePending, built.root);
          });
        }
      }
      if (bear && !v.bearVisual) {
        const built = this.createCharacterVisualWithRetry(e, 'form_bear', 'form_bear');
        if (built) {
          v.bearVisual = built;
          v.group.add(built.root);
          v.formCompilePending = built.root;
          this.gateSwapFlagOnCompile(built.root, () => {
            v.formCompilePending = settlePendingSwap(v.formCompilePending, built.root);
          });
        }
      }
      if (cat && !v.catVisual) {
        const built = this.createCharacterVisualWithRetry(e, 'form_cat', 'form_cat');
        if (built) {
          v.catVisual = built;
          v.group.add(built.root);
          v.formCompilePending = built.root;
          this.gateSwapFlagOnCompile(built.root, () => {
            v.formCompilePending = settlePendingSwap(v.formCompilePending, built.root);
          });
        }
      }
      if (travel && !v.travelVisual) {
        const built = this.createCharacterVisualWithRetry(e, 'form_travel', 'form_travel');
        if (built) {
          v.travelVisual = built;
          v.group.add(built.root);
          v.formCompilePending = built.root;
          this.gateSwapFlagOnCompile(built.root, () => {
            v.formCompilePending = settlePendingSwap(v.formCompilePending, built.root);
          });
        }
      }
      // Gated per form root: the per-frame recompute below AND the pending token
      // both drive .visible, so a still-linking form pops in a frame or two late
      // instead of stalling the frame it is entered on.
      if (v.sheepVisual) {
        v.sheepVisual.root.visible = polyed && v.formCompilePending !== v.sheepVisual.root;
      }
      if (v.bearVisual) {
        v.bearVisual.root.visible = bear && v.formCompilePending !== v.bearVisual.root;
      }
      if (v.catVisual) {
        v.catVisual.root.visible = cat && v.formCompilePending !== v.catVisual.root;
      }
      if (v.travelVisual) {
        v.travelVisual.root.visible = travel && v.formCompilePending !== v.travelVisual.root;
      }
      // rideable mount under the player (the lazy form-visual pattern). Mount
      // GLBs are lazyPreload: the first sight of a rider kicks the fetch and
      // the visual appears once ready. A druid form replaces the whole body,
      // so the form wins visually and the mount hides (the sim's speed math
      // is untouched either way).
      const mountSpec = e.kind === 'player' && e.mountKey ? mountVisualSpec(e.mountKey) : null;
      const mountShown =
        !!mountSpec && !(polyed || bear || cat || travel || fireballForm) && !e.dead;
      if (mountSpec && v.mountVisualKey !== mountSpec.visualKey) {
        if (v.mountVisual) {
          v.group.remove(v.mountVisual.root);
          v.mountVisual.dispose();
          v.mountVisual = null;
        }
        v.mountVisualKey = '';
        if (mountAssetsReady(mountSpec.visualKey)) {
          v.mountVisual = createMountVisual(mountSpec.visualKey);
          v.group.add(v.mountVisual.root); // group.scale already carries e.scale
          v.mountVisualKey = mountSpec.visualKey;
          // A newly summoned mount is exactly a brand-new rig's materials
          // linking for the first time; gate it like a gear swap instead of
          // freezing the frame the mount lands on (#2571).
          v.mountCompilePending = true;
          this.gateSwapFlagOnCompile(v.mountVisual.root, () => {
            v.mountCompilePending = false;
          });
        } else {
          void preloadMountAssets(mountSpec.visualKey).catch((err) =>
            console.error('Failed to preload mount model:', err),
          );
        }
      } else if (!mountSpec && v.mountVisual) {
        v.group.remove(v.mountVisual.root);
        v.mountVisual.dispose();
        v.mountVisual = null;
        v.mountVisualKey = '';
      }
      if (v.mountVisual) v.mountVisual.root.visible = mountShown && !v.mountCompilePending;
      v.mountLift = mountShown && v.mountVisual ? mountSpec.seat : 0;
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
      const stealthGhost = shouldRenderStealthGhost(this.sim.playerId, e);
      const ghost =
        ghostWolf ||
        stealthGhost ||
        e.templateId.startsWith('vision_') ||
        e.ghost || // a released player spirit renders translucent (the ghost run)
        e.templateId === 'spirit_healer'; // the graveyard angel is an ethereal figure
      // Duskveil/Smokestep wear the denser stealth fade; every spirit read
      // (ghost run, ghost wolf, visions, the graveyard angel) keeps the thin
      // ethereal one. A dead stealther is a spirit first.
      const ghostStyle =
        stealthGhost && !ghostWolf && !e.ghost ? ('stealth' as const) : ('spirit' as const);
      active.setGhost(ghost, ghostStyle);
      active.setSoulRend(hasSoulRend);
      // Shadowform tints the base priest rig shadow-purple (no rig swap). Moonkin Form and
      // Metamorphosis reuse the same tint treatment (a bright violet, and a dark fel demon);
      // Metamorphosis also grows the body via Entity.scale in the sim.
      active.setShadowform(hasShadowform);
      active.setMoonkin(hasMoonkin);
      active.setMetamorph(hasMetamorph);
      v.visual.root.visible = active === v.visual && !fireballForm && !v.visualCompilePending;
      // saddle lift: the rider (click proxy included, a root child) sits at
      // the seat height while mounted; 0 whenever the mount is absent/hidden.
      // seatFwd slides the rider along facing onto saddles that sit off the
      // model origin (the toad's is well back toward the tail).
      v.visual.root.position.y = v.mountLift;
      v.visual.root.position.z = v.mountLift > 0 && mountSpec ? mountSpec.seatFwd : 0;
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
      // Derive both the swim pose and surface contact from the same displayed
      // coordinates. Network interpolation can lead or trail authoritative
      // snapshots, so mixing the two timelines produces a visible pose pop.
      const wl = waterLevelAt(ax, az);
      const feetDepth = wl - ay;
      const floorSampleDepth = v.wasSwimming ? SWIM_EXIT_FEET_DEPTH : SWIM_ENTER_FEET_DEPTH;
      const floorDepth =
        !e.dead && feetDepth >= floorSampleDepth
          ? wl - groundHeight(ax, az, this.sim.cfg.seed)
          : Number.NEGATIVE_INFINITY;
      const swimming = isSwimmingAtDepth(v.wasSwimming, e.dead, feetDepth, floorDepth);
      const vx = ax - v.lastX,
        vz = az - v.lastZ;
      v.lastX = ax;
      v.lastZ = az;
      const loco = updateLocomotionInto(v.locoState, v.loco, vx, vz, facing, dt);
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
      // airborne state from foot height vs terrain, keeps the jump pose working in
      // both worlds without a wire change. Gated to players (only they jump) to keep
      // the extra groundHeight sample off the hot path for mobs/NPCs.
      // The local player uses the predictor's kernel onGround when it is active:
      // exact physics state, coherent with the displayed pose by construction.
      // The heuristic is debounced over 2 frames: snapshot bursts during load
      // hitches transiently lift the sampled pose off the terrain, and a
      // single-frame false positive flips the base state to `jump` and back,
      // replaying the jump clip's crouch (the world-entry anim glitch).
      // In a rift, the raised-tier height field lifts a standing player's Y above
      // the flat dungeon floor; without accounting for it the foot-height heuristic
      // (and the self predictor's kernel) read the lift as airborne and freeze the
      // jump pose, and stairs never animate as walking. Add the platform lift to the
      // ground reference (regenerated from the floor descriptor, memoised) so the
      // raised tier reads as solid floor. Also force the heuristic path over the
      // predictor's onGround inside a rift (the predictor samples the same flat
      // ground, so it would still report airborne on the platform).
      const inRift = isRiftPos(ax) && this.sim.riftFloor !== null;
      if (e.kind === 'player' && e.onGround && !swimming) {
        const heurSeed = this.sim.cfg.seed;
        let effGround = groundHeight(ax, az, heurSeed);
        if (inRift) {
          const rf = this.sim.riftFloor!;
          const floor = generateRiftFloor(rf.seed, rf.baseLevel, rf.floorIndex, rf.upgrade);
          effGround += riftLiftAt(floor, ax - rf.origin.x, az - rf.origin.z);
        }
        // The standing surface is that ground reference OR a standable prop top
        // under the feet (parkour: crates/rocks are walkable), else a player
        // perched on a crate would read as permanently airborne and loop the
        // jump pose.
        const standY = Math.max(effGround, supportHeightAt(heurSeed, ax, az, 0.5, ay + 0.01));
        if (ay - standY > AIRBORNE_EPS) v.airborneHeurFrames++;
        else v.airborneHeurFrames = 0;
      } else {
        v.airborneHeurFrames = 0;
      }
      const airborne =
        !visuallyDead &&
        !swimming &&
        (animFromDisplay && this.selfMotionPredictor && !inRift
          ? !this.selfMotionPredictor.onGround
          : !e.onGround || v.airborneHeurFrames >= 2);
      // Grounded presentation polish, both display-only (see the cores).
      // Vertical smoothing absorbs the step-up the solver performs inside a
      // single tick, so the body strides onto a kerb instead of teleporting up
      // it while the soft camera boom trails behind. Applied for every body,
      // and fed back into the self pose so the camera follows what is drawn.
      const settled = !airborne && !swimming && !visuallyDead;
      // Display-derived fall speed: the wire carries no vy for remote bodies,
      // so the drawn trajectory is the only honest source of landing weight.
      const dyRaw = v.hasPrevY ? y - v.prevRenderY : 0;
      v.prevRenderY = y;
      v.hasPrevY = true;
      if (airborne && dt > 1e-4) v.fallSpeed = Math.max(v.fallSpeed, -dyRaw / dt);
      const smoothY = stepSmoothHeight(v.stepSmooth, y, settled, dt);
      if (smoothY !== y) {
        v.group.position.y = smoothY;
        if (isSelf) selfPos.y = smoothY;
      }
      // Terrain lean: near bodies tip toward the surface they stand on. The
      // gradient is resampled on a cadence (four terrain samples) and damped
      // in between, so a crowd costs a handful of samples per frame, and a
      // body standing on a flat prop top stays upright.
      if (v.visual && !v.isFar) {
        v.tiltSampleT -= dt;
        if (v.tiltSampleT <= 0) {
          v.tiltSampleT = TILT_SAMPLE_INTERVAL;
          const ts = this.sim.cfg.seed;
          const hx0 = groundHeight(ax - TILT_SAMPLE_SPAN, az, ts);
          const hx1 = groundHeight(ax + TILT_SAMPLE_SPAN, az, ts);
          const hz0 = groundHeight(ax, az - TILT_SAMPLE_SPAN, ts);
          const hz1 = groundHeight(ax, az + TILT_SAMPLE_SPAN, ts);
          v.tiltGradX = (hx1 - hx0) / (2 * TILT_SAMPLE_SPAN);
          v.tiltGradZ = (hz1 - hz0) / (2 * TILT_SAMPLE_SPAN);
          // Standing well above the local terrain means a prop top, which is
          // flat whatever the ground below it does.
          v.tiltOnProp = ay - (hx0 + hx1 + hz0 + hz1) / 4 > 0.2;
        }
        stepGroundTilt(
          v.groundTilt,
          v.tiltGradX,
          v.tiltGradZ,
          facing,
          settled && !v.tiltOnProp,
          dt,
        );
        v.visual.setGroundTilt(v.groundTilt.pitch, v.groundTilt.roll);
      }
      // Ledge climb: the sim owns the move (Entity.climb offline, the mirrored
      // progress online); the visual poses it by hand, tracking the move's
      // real phase so hands plant when the body reaches the lip whatever the
      // climb's height-scaled duration is.
      if (v.visual) {
        v.visual.setClimbing(
          !!e.climb || e.climbing === true,
          e.climb ? e.climb.elapsed / e.climb.duration : e.climbProgress,
        );
      }
      const st = this.animScratch;
      st.speed = loco.speed;
      st.moving = moving;
      st.running = loco.running;
      // A mounted rider stays planted in the saddle: the MOUNT carries the
      // jump arc (its anim scratch below keeps the real airborne flag), while
      // the rider holds the seated pose instead of replaying the jump clip.
      const logicallyMounted = e.mountKey !== '';
      const riderMounted = v.mountLift > 0;
      st.airborne = airborne && !riderMounted;
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
      // A mounted rider holds the seated pose (the sit loop reads as riding);
      // swim/cast still outrank it in desiredBaseState, so mounted casting
      // and swimming animate normally.
      st.sitting =
        e.kind === 'player' &&
        (e.sitting || e.eating !== null || e.drinking !== null || riderMounted);
      // Ice slide: the sim glides the player at speed but they should read as
      // FROZEN (gliding stiff on the ice), not sprinting. Suppress locomotion +
      // airborne so the state machine holds the static idle pose while they slide.
      if (e.riftSliding && !visuallyDead) {
        st.moving = false;
        st.running = false;
        st.airborne = false;
      }
      // --- spatial movement audio (self + others) --------------------------
      // All gated by audibility (squared distance) so far entities cost nothing.
      const sink = this.audioSink;
      if (sink && d2 < SFX_MOVE_RANGE_SQ) {
        // jump / land / water-entry edges
        if (airborne && !v.wasAirborne && !visuallyDead) sink.movement('jump', ax, ay, az, isSelf);
        else if (!airborne && v.wasAirborne && !visuallyDead) {
          // A flight that ends by catching a ledge is not a fall, and the
          // heavy landing thud on one reads as a bug: you hopped onto a rock
          // mid-arc and the game played a crash. Anything softer than a plain
          // jump's own landing speed gets a footfall instead.
          if (v.fallSpeed >= SOFT_LANDING_SPEED) {
            sink.movement('land', ax, ay, az, isSelf);
          } else {
            sink.footstep(ax, ay, az, this.surfaceAt(ax, az, ay), false, isSelf);
          }
          // Impact dust, scaled by how hard the body actually came down and
          // tinted by what it came down on. This is the visual half of the
          // landing the camera already thumps for.
          this.emitGroundPuff(ax, ay, az, (v.fallSpeed - 5) / 14);
        }
        // Striding up onto a ledge scuffs the surface: a wisp, not a landing.
        if (settled && dyRaw > 0.28 && !visuallyDead) {
          this.emitGroundPuff(ax, ay, az, 0.08);
        }
        if (swimming && !v.wasSwimming && !visuallyDead)
          sink.movement('splash', ax, ay, az, isSelf);
        // footfalls / swim strokes via a distance accumulator (no timers)
        if (visuallyDead || (st.sitting && !riderMounted)) {
          v.stepAccum = 0;
        } else if (swimming) {
          v.stepAccum += loco.speed * dt;
          if (v.stepAccum >= SWIM_STRIDE) {
            v.stepAccum = 0;
            sink.movement('swim', ax, ay, az, isSelf);
          }
        } else if (logicallyMounted && moving && !airborne) {
          if (loco.speed >= FOOT_RUN_SPEED) {
            v.stepAccum += loco.speed * dt;
            if (v.stepAccum >= MOUNT_STRIDE_RUN) {
              v.stepAccum = 0;
              sink.mountRun(ax, ay, az, e.mountKey, isSelf);
            }
          } else {
            v.stepAccum = MOUNT_STRIDE_RUN * 0.6;
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
          // standing still, prime the accumulator so the first step after moving
          // lands promptly rather than after a full stride of travel.
          v.stepAccum = FOOT_STRIDE_WALK * 0.6;
        }
      }
      // Reset the flight's peak fall speed once grounded, so the next landing
      // is measured from its own drop and not the last one.
      if (!airborne) v.fallSpeed = 0;

      // Feed rendered body motion into the persistent height field. This begins
      // while wading, before the swim-pose latch, and uses old minus new surface
      // capsule footprints to create a coherent wake instead of detached rings.
      const contactLevel = wl;
      const contactRadius = Math.min(1.25, Math.max(0.34, active.height * e.scale * 0.16));
      const waterDepth = contactLevel - ay;
      const contactImmersion = Number.isFinite(waterDepth)
        ? Math.min(1, Math.max(0, (waterDepth + 0.04) / (contactRadius * 0.85)))
        : 0;
      const contactAxisX = Math.sin(facing);
      const contactAxisZ = Math.cos(facing);
      const contactHalfLength = swimming
        ? Math.min(1.05, Math.max(contactRadius * 0.9, active.height * e.scale * 0.3))
        : contactRadius * 0.22;
      const touchesWater =
        !visuallyDead &&
        !st.sitting &&
        Number.isFinite(contactLevel) &&
        waterDepth >= -0.035 &&
        ay + active.height * e.scale * 0.82 > contactLevel;
      const contactMode = waterContactFrameMode(
        Boolean(this.editorCam),
        charOnScreen,
        v.waterContactSeen,
      );
      if (contactMode === 'forget') {
        // The editor's hidden entity and frustum-culled actors must not create
        // phantom exits. Seed them silently if they become drawable again.
        v.waterContactSeen = false;
        v.waterContactActive = false;
        v.waterContactAccum = 0;
        v.waterContactX = ax;
        v.waterContactZ = az;
      } else if (contactMode === 'seed') {
        // Interest entry can create a view already in water. Seed without a
        // synthetic splash; subsequent entry, motion, and exit are physical.
        v.waterContactSeen = true;
        v.waterContactActive = touchesWater;
        v.waterContactX = ax;
        v.waterContactZ = az;
        v.waterContactAccum = 0;
      } else if (touchesWater) {
        const waterImpact = shouldTriggerWaterImpact(
          v.waterContactActive,
          v.wasAirborne,
          airborne,
          v.wasSwimming,
          swimming,
        );
        if (waterImpact) {
          const splashStrength = Math.min(1.65, 0.82 + loco.speed * 0.08 + contactImmersion * 0.25);
          this.waterView.enterContact(
            ax,
            az,
            contactRadius,
            contactHalfLength,
            contactAxisX,
            contactAxisZ,
            splashStrength,
          );
          const entryDistance = Math.hypot(vx, vz);
          const entryDirX = entryDistance > 0.001 ? vx / entryDistance : contactAxisX;
          const entryDirZ = entryDistance > 0.001 ? vz / entryDistance : contactAxisZ;
          this.vfx.characterWaterSplash(
            ax,
            contactLevel,
            az,
            entryDirX,
            entryDirZ,
            contactRadius * 1.45,
            splashStrength,
          );
          v.waterContactActive = true;
          v.waterContactX = ax;
          v.waterContactZ = az;
          v.waterContactAccum = 0;
        } else {
          const waterDx = ax - v.waterContactX;
          const waterDz = az - v.waterContactZ;
          const waterDistanceSq = waterDx * waterDx + waterDz * waterDz;
          const teleportLimit = contactRadius * 8;
          v.waterContactAccum += dt;
          if (waterDistanceSq > teleportLimit * teleportLimit) {
            this.waterView.addSplash(ax, az, contactRadius, 0.7);
            v.waterContactX = ax;
            v.waterContactZ = az;
            v.waterContactAccum = 0;
          } else if (waterDistanceSq > 0.0016 && v.waterContactAccum >= 1 / 24) {
            const contactSpeed = Math.sqrt(waterDistanceSq) / Math.max(v.waterContactAccum, 0.001);
            const wakeStrength = Math.min(
              1.6,
              Math.max(0.28, (0.34 + contactSpeed * 0.095) * (0.45 + contactImmersion * 0.75)),
            );
            this.waterView.moveContact(
              v.waterContactX,
              v.waterContactZ,
              ax,
              az,
              contactRadius,
              contactHalfLength,
              contactAxisX,
              contactAxisZ,
              wakeStrength,
            );
            v.waterContactX = ax;
            v.waterContactZ = az;
            v.waterContactAccum = 0;
          }
        }
      } else {
        if (v.waterContactActive) {
          const releaseHalfLength = v.wasSwimming
            ? Math.min(1.05, Math.max(contactRadius * 0.9, active.height * e.scale * 0.3))
            : contactRadius * 0.22;
          this.waterView.releaseContact(
            v.waterContactX,
            v.waterContactZ,
            contactRadius,
            releaseHalfLength,
            contactAxisX,
            contactAxisZ,
            0.68,
          );
        }
        v.waterContactActive = false;
        v.waterContactAccum = 0;
        v.waterContactX = ax;
        v.waterContactZ = az;
      }
      v.wasAirborne = airborne;
      v.wasSwimming = swimming;
      // Distance-tiered mixer updates: near = every frame, mid = every Nth, the
      // animated far band = every 4th to 6th (the rig is still articulated, so
      // this is visible motion, just at a lower pose rate), and the frozen band
      // = every 6th to keep the pose warm for re-entry. Edges latch regardless.
      // Every band follows the same crowd-adaptive plan the shadow bands use,
      // because sampling clips + rebuilding bone matrices is the per-rig cost
      // that actually scales with the crowd.
      //
      // Animation smoothness is cosmetic, but a cast windup is a telegraph the
      // player reacts to, so the local player, the current target, and anything
      // mid-cast always animate every frame no matter how dense the crowd.
      let animate = true;
      if (!actionablePose) {
        const cadence = animCadenceFrames(d2, lodBands);
        animate = cadence <= 1 || (this.frameIdx + e.id) % cadence === 0;
      }
      active.update(dt, st, animate);
      // weapon-skin VFX ride the humanoid rig's held weapon; advancing them is a
      // few uniform writes per handle, so they stay smooth at every LOD tier
      v.visual.updateWeaponVfx(dt);
      // The sheathe swap is deferred to the gesture midpoint, so the rig (and any
      // skin VFX point light on it) is rebuilt inside update(), not at the diff.
      if (v.visual.consumeWeaponGraphDirty()) this.reconcileViewLights(v);

      // The mount animates from the same locomotion inputs as its rider: the
      // rigged quadrupeds run their baked gait clips (a live Idle loop while
      // standing, Walk/Run on the move, scripts/bake_mount_gaits.mjs), and
      // the clipless mounts bob procedurally (the hover cycle floats, the
      // griffin canters, the snail glides flat). `airborne` here is the real
      // flag, not the rider's suppressed one: the mount carries the jump.
      if (v.mountVisual && mountSpec && mountShown) {
        const mst = this.mountAnimScratch;
        mst.speed = st.speed;
        mst.moving = st.moving;
        mst.running = st.running;
        mst.airborne = airborne;
        mst.backwards = st.backwards;
        mst.swimming = st.swimming;
        v.mountVisual.update(dt, mst, animate);
        // the rider floats WITH the procedural bob (the hover cycle's idle
        // float), not just the mount body
        const bob = mountBobY(mountSpec, this.time, moving);
        v.mountVisual.root.position.y = bob;
        v.visual.root.position.y = v.mountLift + bob;
        // ambient mount particles: the snail paints its slime path while
        // gliding, the hover cycle streams aether exhaust off its tail
        if (mountSpec.fx === 'slime') {
          if (moving) this.vfx.mountSlimeTrail(v.group.position, dt);
        } else if (mountSpec.fx === 'exhaust') {
          this.vfx.mountExhaust(v.group.position, facing, dt, moving);
        }
      }

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

      // Mount summon/dismount transition FX (render-only; the wire fields carry
      // the state to every client, so no SimEvent is needed). The rider throws up
      // a call pose the instant a summon begins, and a yellow-orange shimmer rings
      // them when the mount actually appears, swaps, or clears.
      if (e.kind === 'player') {
        const mountCasting = e.mountCastRemaining > 0;
        // idle -> summoning edge (mountCastKey set): play the arm-raise call pose
        // for ~the transition window. A dismount (mountCastKey === '') gets no
        // pose; its effect is the completion glow below. Gated like the emote path
        // (the sim roots the player, so moving/airborne is unlikely regardless).
        if (
          mountCasting &&
          !v.wasMountCasting &&
          e.mountCastKey !== '' &&
          !visuallyDead &&
          !swimming
        ) {
          active.playCallPose(e.mountCastRemaining);
        }
        v.wasMountCasting = mountCasting;
        // mountKey change = summon completed, dismount completed, or a live swap:
        // fire the shimmer at the rider. Tracked separately from mountVisualKey,
        // which lags async asset loading.
        if (e.mountKey !== v.lastMountKey) {
          v.lastMountKey = e.mountKey;
          this.vfx.mountSummonGlow(e.id);
        }
      }

      // per-ability windup orb + buff-orbit bands (spec-driven; no-op for
      // entities with no spec'd cast or aura)
      this.abilityVfx.syncEntity(e);
      if (st.casting) {
        this.vfx.castSparkle(
          e.id,
          waterJetVisualChannel
            ? 'frost'
            : e.castingAbility === 'demon_heal'
              ? 'shadow'
              : (ABILITIES[e.castingAbility ?? '']?.school ?? 'arcane'),
          dt,
          // per-ability spec color when the casting ability has one
          this.abilityVfx.sparkleColorFor(e.castingAbility),
        );
      }
      if (hasSoulRend) {
        this.vfx.castSparkle(e.id, 'shadow', dt * 3.2);
      }
      if (hasRecklessness) {
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
    let visibleViews = 0;
    for (const [, v] of this.views) {
      v.group.matrixWorldAutoUpdate = v.group.visible || this.lightOwnerGroups.has(v.group);
      if (v.group.visible) visibleViews++;
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
          // A target standing on a prop top (crate/rock) gets the ring on that
          // surface, not buried at terrain height under it.
          const supportY = supportHeightAt(seed, cx, cz, 0.5, tv.group.position.y + 0.01);
          const gy = Math.max(groundHeight(cx, cz, seed), supportY);
          this.selectionDrapeSupportY = supportY;
          this.selectionRing.position.set(cx, gy, cz);
          this.selectionRing.scale.setScalar(target.scale);
          const drape = drapeRingLocalY(
            this.selectionRingLocalXZ,
            cx,
            cz,
            gy,
            target.scale,
            0.08,
            this.selectionGroundSample,
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
    const playerView = this.views.get(p.id);
    if (playerView && !p.dead && this.playerAuraRings.hasVisibleRings()) {
      const px = playerView.group.position.x;
      const pz = playerView.group.position.z;
      const seed = this.sim.cfg.seed;
      const supportY = supportHeightAt(seed, px, pz, 0.5, playerView.group.position.y + 0.01);
      const baseY = Math.max(groundHeight(px, pz, seed), supportY);
      this.playerAuraRings.update(
        true,
        px,
        pz,
        baseY,
        seed,
        supportY,
        this.time,
        this.reducedMotion(),
      );
    } else {
      this.playerAuraRings.update(false, 0, 0, 0, this.sim.cfg.seed, 0, this.time);
    }
    this.updateClickMarkers(dt);
    this.updateAoeRings(dt);
    this.recklessSkulls.update(dt);
    this.fishingBobbers.update(dt, this.sim.entities, this.sim.cfg.seed);
    this.updateGroundAimReticle(dt);
    // dev-only Tab-target cone overlay: re-drape the front cone on the terrain
    // under the local player, oriented to the model's rendered facing.
    if (this.targetCone) {
      if (p.dead) {
        this.targetCone.group.visible = false;
      } else {
        const lv = this.views.get(p.id);
        const facing = lv ? lv.group.rotation.y : p.facing;
        drapeConeWorld(
          this.targetCone.localXZ,
          selfPos.x,
          selfPos.z,
          facing,
          0.07,
          this.groundSample,
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
          this.groundSample,
          this.targetCone.ringWorldXYZ,
        );
        this.targetCone.ringPos.needsUpdate = true;
        this.targetCone.group.visible = true;
      }
    }
    phaseStart = this.markRendererPhase(framePhaseMs, 'entities', phaseStart);

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
          setRenderCategory(this.corpseBeacon, 'ui3d');
          this.scene.add(this.corpseBeacon);
        }
        this.corpseBeacon.visible = true;
        this.corpseBeacon.position.set(corpse.x, corpse.y + 7, corpse.z);
      } else if (this.corpseBeacon) {
        this.corpseBeacon.visible = false;
      }
    }

    let worldStart = performance.now();
    const projectionPixels = projectionScalePixels(
      this.camera.projectionMatrix.elements[5],
      this.renderPixelHeight,
    );
    this.tmpV2.subVectors(this.cameraLookAt, this.camera.position).normalize();

    // the mill sails turn in the garden breeze, each at its own phase
    for (let i = 0; i < this.windmillFans.length; i++) {
      this.windmillFans[i].rotation.z = this.time * 0.55 + i * 2.1;
    }

    // Fire flicker and rising embers are scenery only. Keep nearby flames at
    // full cadence, but once the whole flame is under 10 live pixels its
    // absolute-time scale can refresh at 20 or 10 Hz without a readable phase
    // error. Sub-10px fires emit no smaller ember cloud.
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const priorState = this.flamePerceptualStates.get(f);
      const state = updateSceneryFlame(
        f,
        i,
        this.time,
        this.camera.position,
        this.tmpV2,
        projectionPixels,
        priorState,
      );
      if (!state) continue;
      if (!priorState) this.flamePerceptualStates.set(f, state);
      if (state.emitsEmber) this.vfx.campfireEmber(state.worldPosition, dt);
    }
    this.budgetFireLights(p.pos.x, p.pos.z, true);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'lights', worldStart);

    // water shimmer (low-tier texture scroll; shader water rides uTime)
    this.lastWaterSimulationPasses = this.waterView.update(
      this.time,
      this.camera.position.x,
      this.camera.position.z,
      (this.scene.fog as THREE.Fog).far,
    );
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'water', worldStart);
    this.vfx.update(dt);
    // Racing line (cosmetic; reads the self race view only).
    this.raceLine.update(this.sim.mountRaceView(), this.time, dt);
    // Start platform: visible while the riding quest is active and no race is live.
    this.mountBeacon.update(
      this.sim.questState('q_riding_lessons') === 'active' && !this.sim.mountRaceView(),
      this.time,
    );
    this.abilityVfx.update(dt);
    this.frozenOrbFx.update(dt);
    this.mageGroundFx.update(dt);
    this.ringOfFrostVisuals.sync(this.sim.activeFrostRings);
    this.ringOfFrostVisuals.update(dt);
    if (this.riftDeathZoneVisuals) {
      this.riftDeathZoneVisuals.sync(this.sim.riftBossDeathZones());
      this.riftDeathZoneVisuals.update(dt);
    }
    this.temporalHourglassGroundVisuals.sync(this.sim.activeTemporalHourglasses);
    this.temporalHourglassGroundVisuals.update(dt);
    this.glacialFrontVisual.updateCharge(p, dt, groundHeight(p.pos.x, p.pos.z, this.sim.cfg.seed));
    this.glacialFrontVisual.update(dt);
    this.lightPulses.update(dt);
    this.updateFiestaRing(dt);
    this.updateFiestaPowerups(dt);
    this.tickFiestaGlows(dt);
    for (const view of this.yumiMazeViews.values())
      view.update(
        this.sim,
        this.camera.position.x,
        this.camera.position.y,
        this.camera.position.z,
        this.cameraLookAt.x,
        this.cameraLookAt.y,
        this.cameraLookAt.z,
        dt,
        this.reducedMotion(),
      );
    this.yumiTeamMarkers.update(this.sim, this.views);
    this.tickValeCupFx(dt);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'vfx', worldStart);

    this.updateCamera(selfPos, dt);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'camera', worldStart);
    // Fully-fogged terrain chunks / tree buckets are dropped before the
    // frustum; camera-ghost props fade against the current eye-to-camera ray.
    const fogFar = (this.scene.fog as THREE.Fog).far;
    // The foliage LOD swaps real trees for impostors relative to the fog, not at
    // a fixed distance, so it needs both planes (src/render/foliage_lod.ts).
    const fogNear = (this.scene.fog as THREE.Fog).near;
    this.queueVisibleZonePrepares(Math.max(fogFar, this.lastRequestedFogFar));
    this.terrainView.update(this.camera.position.x, this.camera.position.z, fogFar);
    this.updateZoneFeatureVisibility(fogFar);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'terrain', worldStart);
    this.propsView.update(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      this.cameraLookAt.x,
      this.cameraLookAt.y,
      this.cameraLookAt.z,
      fogFar,
      dt,
      this.reducedMotion(),
    );
    this.eastbrookTownView.update(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      this.cameraLookAt.x,
      this.cameraLookAt.y,
      this.cameraLookAt.z,
      fogFar,
      dt,
      this.reducedMotion(),
    );
    this.dungeons?.update(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      this.cameraLookAt.x,
      this.cameraLookAt.y,
      this.cameraLookAt.z,
      dt,
      this.reducedMotion(),
    );
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'props', worldStart);
    this.foliage.update(
      p.pos.x,
      p.pos.z,
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      this.cameraLookAt.x,
      this.cameraLookAt.y,
      this.cameraLookAt.z,
      fogNear,
      fogFar,
      this.lastRequestedFogNear,
      this.lastRequestedFogFar,
      projectionPixels,
      dt,
      this.reducedMotion(),
    );
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'foliage', worldStart);
    this.fish.update(p.pos.x, p.pos.z, dt);
    this.motes.update(p.pos.x, p.pos.z, dt);
    this.bladeGrass.update(p.pos.x, p.pos.z);
    this.cliffScree.update(p.pos.x, p.pos.z);
    this.realmFlora?.update(this.time);
    this.emberFeatures?.update(this.time);
    this.frostSky?.update(this.time, this.camera.position.x, this.camera.position.z);
    this.fenFeatures?.update(this.time);
    this.amberFeatures?.update(this.time);
    this.nightFeatures?.update(this.time);
    this.hauntFeatures?.update(this.time);
    this.jungleFeatures?.update(this.time);
    this.gardenFeatures?.update(this.time);
    this.galeFeatures?.update(this.time);
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
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'fish', worldStart);
    this.updateAmbience(p.pos.x, this.camera.position.y, dt);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'ambience', worldStart);
    // shadow frustum follows the player
    const pv = this.views.get(p.id);
    if (pv) {
      const pp = pv.group.position;
      this.updateKeyLight(pp);
    }
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'shadows', worldStart);
    // sky dome + sun disc ride along with the camera
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    // The dome rides the camera, so it also serves Wildheart's open-air field.
    this.sky.visible = this.fogState === 'outdoor' || this.fogState === 'wildheartField';
    if (this.sky.visible) {
      this.skyView.setCameraPos(this.camera.position.x, this.camera.position.z, dt);
      if (!this.lowGfx) {
        this.skyView.setDayNight(this.dnGrade.sky);
        this.skyView.setFog((this.scene.fog as THREE.Fog).color);
        this.skyView.setStars(this.starAmt, this.time);
        this.updateEnvBiome(dt);
      }
    }
    // precipitation only falls outdoors; indoors/underwater pass null to clear
    this.weather.update(
      this.camera.position,
      dt,
      this.fogState === 'outdoor' ? zoneBiomeAt(p.pos.x, p.pos.z) : null,
    );
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'sky', worldStart);
    this.updateCelestialSprites();
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'sunSprites', worldStart);
    this.updateGodRays();
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'godRays', worldStart);
    phaseStart = this.markRendererPhase(framePhaseMs, 'world', phaseStart);

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
    phaseStart = this.markRendererPhase(framePhaseMs, 'nameplates', phaseStart);
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
    this.jailScene.updateVisibility(this.camera, this.sun);
    if (this.sun.castShadow) {
      this.shadowLightDirection.subVectors(this.sun.position, this.sun.target.position).normalize();
      this.gatherNodes.updateShadowVisibility(this.camera, this.shadowLightDirection, true);
      this.valeCupStadium.updateShadowVisibility(this.camera, this.shadowLightDirection, true);
    }
    this.updateOpaqueDrawOrder(dt);
    if (shakeX !== 0 || shakeY !== 0) this.camera.updateMatrixWorld();
    this.vfx.prepareDraw(this.camera);
    if (this.post) {
      // screen-fx pass state (ripple re-projection, flash decay) advances
      // with the camera finalized for this frame
      this.post.updateScreenFx(dt);
      this.post.render();
    } else this.webgl.render(this.scene, this.camera);
    if (shakeX !== 0 || shakeY !== 0) {
      this.camera.position.x -= shakeX;
      this.camera.position.y -= shakeY;
    }
    phaseStart = this.markRendererPhase(framePhaseMs, 'submit', phaseStart);
    const totalMs = performance.now() - totalStart;
    framePhaseMs.total = roundMs(totalMs);
    this.recordRendererPhase('total', totalMs);
    const afterSubmit = performance.now();
    frameStats.renderDiagnostics = this.renderDiagnosticsForFrame(
      afterSubmit,
      framePhaseMs.submit >= RENDER_STALL_ATTRIBUTION_MS,
    );
    this.foliage.perfStats(frameStats.foliage);
    frameStats.cameraPosition.x = roundMs(this.camera.position.x);
    frameStats.cameraPosition.y = roundMs(this.camera.position.y);
    frameStats.cameraPosition.z = roundMs(this.camera.position.z);
    frameStats.playerPosition.x = roundMs(p.pos.x);
    frameStats.playerPosition.y = roundMs(p.pos.y);
    frameStats.playerPosition.z = roundMs(p.pos.z);
    frameStats.biome = zoneBiomeAt(p.pos.x, p.pos.z);
    if (this.lastQualityChange) {
      this.lastQualityChange.ageMs = roundMs(afterSubmit - this.lastQualityChange.atMs);
    }
    frameStats.lastQualityChange = this.lastQualityChange;
    frameStats.createdViews = createdViews;
    frameStats.removedViews = removedViews;
    frameStats.candidateViews = this.viewCandidates.length;
    frameStats.activeViews = this.views.size;
    frameStats.visibleViews = visibleViews;
    if (this.hitchLogEnabled && this.hitchSkipNextFrame) {
      this.hitchSkipNextFrame = false;
    } else if (this.hitchLogEnabled) {
      const sample = this.hitchFrameScratch;
      sample.atMs = afterSubmit;
      sample.frameMs = Math.min(250, Math.max(0, dt * 1000));
      sample.submitMs = framePhaseMs.submit;
      sample.programs = this.webgl.info.programs?.length ?? 0;
      sample.textures = this.webgl.info.memory.textures;
      sample.createdViews = createdViews;
      this.hitchTracker.frame(sample);
    }
    this.runtimeEntryElapsedMs += Math.min(250, Math.max(0, dt * 1000));
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
    let inTravelForm = false;
    for (const aura of p.auras) {
      if (aura.kind !== 'form_travel') continue;
      inTravelForm = true;
      break;
    }
    const target = targetIntensityFromValues(inTravelForm, speed, this.reducedMotion());
    this.travelSpeedFx.update(target, dt);
  }

  private reducedMotion(): boolean {
    return this.reduceMotionSetting || (this.reduceMotionMql?.matches ?? false);
  }

  // Grab a JPEG screenshot of the live scene for a bug report. The main
  // WebGLRenderer is created WITHOUT preserveDrawingBuffer (that costs memory on
  // the hot path), so the colour buffer is valid only until control returns to
  // the browser and it composites. We therefore render one fresh frame and read
  // it back synchronously in the SAME call, before yielding, then downscale onto
  // a 2D canvas. JPEG compression is deliberately asynchronous: toDataURL took
  // ~18ms at 1280x720 and blocked the bug-report menu. Returns null on any failure
  // (lost context, tainted canvas) so the caller can degrade gracefully.
  async captureScreenshot(maxEdge = 1280, quality = 0.7): Promise<string | null> {
    if (this.shutdownStarted) return null;
    try {
      this.camera.updateMatrixWorld();
      this.vfx.prepareDraw(this.camera);
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
      return await canvasDataUrlAsync(out, 'image/jpeg', quality);
    } catch {
      return null;
    } finally {
      // The extra render above must not count toward the next frame's draw
      // stats on composer tiers (covers the throw path too).
      this.discardOutOfBandDraws();
    }
  }

  // Forward-renderer point-light budget: every campfire/torch light exists,
  // but only the nearest GFX.maxPointLights within range shine each frame.
  // Rank entries are pooled (extended only when interiors or view lights change).
  // Static world positions stay cached; moving weapon VFX refresh into their
  // existing vectors, so this hot loop allocates nothing.
  private budgetFireLights(px: number, pz: number, flicker = false): void {
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
      for (let fireIndex = 0; fireIndex < this.fireLights.length; fireIndex++) {
        const light = this.fireLights[fireIndex];
        ranked.push({
          light,
          d2: 0,
          worldPos: light.getWorldPosition(new THREE.Vector3()),
          base: null,
          dynamic: false,
          fireIndex,
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
    if (flicker) {
      flickerContributingFireLights(
        ranked,
        this.time,
        visibleCount,
        liveBudget,
        LIGHT_BUDGET_RANGE_SQ,
      );
    }
    // Fill unused slots of the visible count with pad lights so the total
    // visible point-light count stays pinned at visibleCount even when fewer
    // real lights than the budget exist (boot, sparse custom maps, interiors).
    const padCount = pointLightPadCount(ranked.length, visibleCount);
    for (let i = 0; i < this.lightPads.length; i++) this.lightPads[i].visible = i < padCount;
  }

  // light shafts fade in as the camera turns toward the sun, outdoor only
  private updateGodRays(): void {
    if (this.godRays.length === 0) return;
    // Wildheart is open-air, but the long screen-space shafts read as giant
    // triangles against its enclosed caldera rim. The basin keeps the sun,
    // sky, and outdoor grade while reserving these shafts for the overworld.
    const outdoor = this.fogState === 'outdoor';
    // azimuth-only alignment, the chase cam always pitches down while the
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
      sp.material.opacity = facing * facing * facing * (0.3 - i * 0.05) * this.sunUp;
    }
  }

  private updateSelfRenderPosition(
    alpha: number,
    dt: number,
    selfAlphaLead: number,
    selfMotion: SelfMotionFrame | null = null,
    authoritativeDiscontinuity = false,
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
      const predicted = this.selfMotionPredictor.step(p, selfMotion, authoritativeDiscontinuity);
      if (predicted) {
        // Follow the predictor output exactly (it is already continuous;
        // smoothing it again would re-add the display lag this exists to
        // remove). The only discontinuity is the handoff frame from the
        // lead-smoothing path below: capture that gap once as an offset and
        // decay it, so the camera glides instead of stepping.
        if (authoritativeDiscontinuity) {
          this.selfMotionOffset.set(0, 0, 0);
        } else if (this.selfRenderPositionReady && !this.selfMotionActive) {
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
    updateSelfRenderFallback(
      this.selfRenderPosition,
      px,
      py,
      pz,
      this.selfRenderPositionReady,
      dt,
      selfAlphaLead > 0,
      authoritativeDiscontinuity,
    );
    this.selfRenderPositionReady = true;
    return this.selfRenderPosition;
  }

  // ---- Map-editor 3D seams (editor-only) --------------------------------

  /** The terrain chunk group, for the editor to raycast/rebuild. */
  get terrainGroup(): THREE.Group {
    return this.terrainView.group;
  }

  /**
   * Stop terrain streaming and tear down its worker pool. rebuildTerrain does
   * this for a replaced view; a host that discards the whole renderer (the
   * editor viewport) must call it too, or every teardown leaks the pool's
   * module workers.
   */
  cancelTerrainStreaming(): void {
    this.terrainView.cancelStreaming();
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
    this.cliffScree.invalidate();
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
      const withMap = mat as THREE.Material & {
        normalMap?: THREE.Texture | null;
      };
      withMap.normalMap?.dispose();
      mat.dispose();
    };
    if (Array.isArray(sharedMat)) sharedMat.forEach(disposeMat);
    else if (sharedMat) disposeMat(sharedMat);
    this.terrainView = buildTerrain(this.sim.cfg.seed);
    setRenderCategory(this.terrainView.group, 'terrain');
    this.scene.add(this.terrainView.group);
    freezeStaticSubtreeMatrices(this.terrainView.group);
    // A full editor rebuild replaces the zone cache along with the geometry.
    // Re-run the same preparation path for every resident zone so the renderer
    // cannot mistake an empty replacement view for an already-ready region.
    const residentZones = ZONES.filter((zone) => this.preparedZones.has(zone.id));
    this.preparedZones.clear();
    for (const zone of residentZones) {
      void this.prepareZoneAt(zone.hub.x, zone.hub.z);
    }
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
    this.cliffScree.invalidate();
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
    this.cliffScree.invalidate();
    // One group holds every zone plane plus the apron, so detaching it is the
    // whole scene removal; dispose() then releases the geometry, the shared
    // material, and the height-field render targets in one place.
    this.scene.remove(this.waterView.group);
    this.waterView.dispose();
    this.waterView = buildWater(this.sim.cfg.seed, this.webgl);
    setRenderCategory(this.waterView.group, 'water');
    this.scene.add(this.waterView.group);
    freezeStaticSubtreeMatrices(this.waterView.group);
    for (const zone of ZONES) {
      if (!this.preparedZones.has(zone.id)) continue;
      void this.waterView.ensureZone(zone).then((meshes) => {
        for (const mesh of meshes) freezeStaticMatrices(mesh);
      });
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
    // player-chase path. Every camera-relative cull in sync() then
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
    const reduce = this.reducedMotion();

    // Spring-arm lag: the look pivot trails the avatar on a critically damped
    // spring (vertical softer), so runs, jumps, mantles, and landings carry
    // weight. Reduced motion stiffens it to near-rigid instead of branching.
    stepCameraBoom(this.camBoom, selfPos.x, selfPos.y, selfPos.z, dt, reduce ? 4 : 1);

    // Landing thump, detected from the display trajectory alone (works in
    // both hosts): a short FOV dip plus a touch of trauma, scaled by fall
    // speed. addShake/punchFov are reduced-motion no-ops already.
    const thump = stepLandingDetector(this.camFeel, selfPos.y, dt);
    if (thump > 0) {
      this.punchFov(-3.5 * thump);
      this.addShake(0.1 + 0.3 * thump);
    }

    // Look-ahead lead + speed FOV, fed by the horizontal display velocity.
    let velX = 0;
    let velZ = 0;
    if (this.lastLocalPos && dt > 1e-4) {
      velX = (selfPos.x - this.lastLocalPos.x) / dt;
      velZ = (selfPos.z - this.lastLocalPos.z) / dt;
      // A teleport is not velocity.
      if (velX * velX + velZ * velZ > 30 * 30) {
        velX = 0;
        velZ = 0;
      }
    }
    stepCameraFeel(this.camFeel, velX, velZ, dt, !reduce);

    // Flipping reduce motion on mid-directive blends any running move out.
    if (reduce) cancelCameraDirective(this.camDirector);

    // Death drift: one slow elevated drift per death while the body lies
    // unreleased. Armed only on the alive-to-dead EDGE of the SAME viewed
    // entity, so a spectate switch onto an already-dead target never drifts;
    // the edge releases a running vista first and the drift starts once the
    // director is free. Releasing/resurrecting (or camera input) blends out.
    const deadBody = p.dead && !p.ghost;
    if (p.id !== this.camSelfId) {
      this.camSelfId = p.id;
      this.deathDriftArmed = false;
      cancelCameraDirective(this.camDirector);
    } else if (deadBody && !this.camSelfWasDead) {
      this.deathDriftArmed = true;
      cancelCameraDirective(this.camDirector);
    }
    this.camSelfWasDead = deadBody;
    if (!deadBody) {
      this.deathDriftArmed = false;
      if (this.camDirector.kind === 'deathDrift') cancelCameraDirective(this.camDirector);
    } else if (this.deathDriftArmed && !reduce && this.camDirector.kind === null) {
      startDeathDrift(this.camDirector);
      this.deathDriftArmed = false;
    }

    // Directed moves blend OVER the live player pose; any change to that pose
    // since last frame is manual input (or the follow system) and cancels.
    const mirror = this.camMirror;
    const disturbed =
      this.camDirector.kind !== null &&
      !Number.isNaN(mirror.yaw) &&
      (Math.abs(this.camYaw - mirror.yaw) > 1e-4 ||
        Math.abs(this.camPitch - mirror.pitch) > 1e-4 ||
        Math.abs(this.camDist - mirror.dist) > 1e-4);
    const pose = stepCameraDirector(
      this.camDirector,
      { yaw: this.camYaw, pitch: this.camPitch, dist: this.camDist },
      dt,
      disturbed,
    );
    mirror.yaw = this.camYaw;
    mirror.pitch = this.camPitch;
    mirror.dist = this.camDist;

    // The camera orbits the lagged/led pivot at the player's requested
    // distance. Scene geometry never changes that distance; registered
    // obstructors fade through their subsystem's occluder-fade pass.
    const px = this.camBoom.x + this.camFeel.leadX;
    const py = this.camBoom.y;
    const pz = this.camBoom.z + this.camFeel.leadZ;
    const eyeY = py + 2.0;
    const cx = px - Math.sin(pose.yaw) * Math.cos(pose.pitch) * pose.dist;
    const cy = eyeY + Math.sin(pose.pitch) * pose.dist;
    const cz = pz - Math.cos(pose.yaw) * Math.cos(pose.pitch) * pose.dist;
    let groundY = groundHeight(cx, cz, seed) + 0.6;
    // On a raised rift tier the flat ground clamp would let the camera sink
    // into the riser: add the same lift the sim stands entities on.
    const rfCam = this.sim.riftFloor;
    if (rfCam && isRiftPos(cx)) {
      const floor = generateRiftFloor(rfCam.seed, rfCam.baseLevel, rfCam.floorIndex, rfCam.upgrade);
      groundY += riftLiftAt(floor, cx - rfCam.origin.x, cz - rfCam.origin.z);
    }
    // The Great Maze's modeled hedges are not terrain, so the ground clamp
    // alone would sit the camera inside their leaves: ride over them the
    // way the old terrain walls lifted it.
    groundY += gardenMazeCameraLift(cx, cz);
    this.camera.position.set(cx, Math.max(cy, groundY), cz);
    // Base FOV plus the feel kicks; the latter are zero under reduced motion.
    const fovTarget = Math.min(100, Math.max(50, CAMERA_BASE_FOV + cameraFovOffset(this.camFeel)));
    if (Math.abs(this.camera.fov - fovTarget) > 0.01) {
      this.camera.fov = fovTarget;
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
      const biome = zoneBiomeAt(px, pz);
      const precip =
        !this.weatherOn || inDungeon
          ? null
          : biome === 'peaks' || biome === 'frost'
            ? 'snow'
            : biome === 'marsh' || biome === 'haunt'
              ? 'rain' // the haunted wood drips under a permanent drizzle
              : null;
      // Only at the water's edge / in it, sampled at the player, so a loose
      // threshold made the loop bleed across the low marsh from far off.
      const nearWater = !inDungeon && groundHeight(px, pz, seed) < waterLevelAt(px, pz) + 0.4;
      // Sowfield crowd bed: murmurs near the ground, swells while a match is
      // live (cupInfo is the IWorld mirror, so this works online too).
      const crowd = crowdAmbienceAt(px, pz, inDungeon, !!this.sim.cupInfo?.live);
      sink.ambience(biome, inDungeon, precip, nearWater, crowd, this.ambientPointSources);
    }
  }

  // Hang a speech bubble over an entity's head; it follows the entity and
  // fades out after a few seconds (longer for longer messages), or after the
  // caller's explicit ttl (short reaction barks like Goad's grawlix).
  showChatBubble(
    entityId: number,
    text: string,
    style?: boolean | ChatBubbleStyle,
    ttlSec?: number,
  ): void {
    // Back-compat: the older 3-arg call passes a bare `yell` boolean; the chat
    // gate passes a full descriptor (the party channel tint).
    const s: ChatBubbleStyle = typeof style === 'boolean' ? { yell: style } : (style ?? {});
    let b = this.chatBubbles.get(entityId);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'chat-bubble';
      this.nameplateLayer.appendChild(el);
      b = { el, until: 0 };
      this.chatBubbles.set(entityId, b);
    }
    b.el.textContent = text; // textContent: chat is player input, never HTML
    b.el.classList.toggle('yell', s.yell === true);
    // Channel bubbles (party/guild/officer) tint the BORDER only; the near-white
    // background and dark text stay for legibility. Clearing to '' restores the
    // stylesheet default (and the `.yell` border) when a reused bubble switches
    // channel, so say/yell/emote stay byte-identical.
    b.el.style.borderColor = s.border ?? '';
    // wall-clock ttl: sim/render time can run slower than real time under
    // frame-delta clamping, which would keep bubbles up too long
    b.until = performance.now() + 1000 * (ttlSec ?? Math.min(10, 3.5 + text.length * 0.045));
  }

  private updateChatBubbles(): void {
    if (this.chatBubbles.size === 0) return;
    const { width: w, height: h } = this.viewport;
    const now = performance.now();
    for (const [id, b] of this.chatBubbles) {
      const e = this.sim.entities.get(id);
      const v = e ? this.views.get(id) : undefined;
      if (now >= b.until) {
        b.el.remove();
        this.chatBubbles.delete(id);
        continue;
      }
      if (!e || !v) {
        b.el.style.display = 'none';
        continue;
      }
      // culled rigs (beyond ENTITY_DRAW_RANGE) stop updating group.position,
      // so a yell from 80 to 100u away would hang frozen over empty terrain:
      // fall back to the live entity position when the rig isn't being drawn
      if (v.group.visible) this.tmpV.copy(v.group.position);
      else this.tmpV.set(e.pos.x, e.pos.y, e.pos.z);
      this.tmpV.y += (v.height + v.mountLift) * e.scale + 1.0;
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
  // horizontal plane at the player's foot height, robust on the gentle terrain
  // here and far cheaper than raycasting the terrain mesh.
  groundPoint(clientX: number, clientY: number, planeY: number): { x: number; z: number } | null {
    this.raycastNdc.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.raycastNdc, this.camera);
    this.raycastGroundPlane.constant = -planeY;
    return this.raycaster.ray.intersectPlane(this.raycastGroundPlane, this.raycastHit)
      ? { x: this.raycastHit.x, z: this.raycastHit.z }
      : null;
  }

  // Click/tap-to-harvest (#1866): raycasts the static gather-node meshes
  // (`gatherNodeMeshes`, with per-instance ids in src/render/gather_nodes.ts)
  // and returns the hit node's content id, or null.
  // A separate method from `pick()` on purpose: nodes are static content keyed
  // by string id, not entities keyed by numeric id, so widening `pick()`'s
  // return contract would force every existing caller to re-discriminate.
  pickGatherNode(clientX: number, clientY: number): string | null {
    this.raycastNdc.set(
      (clientX / this.viewport.width) * 2 - 1,
      -(clientY / this.viewport.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.raycastNdc, this.camera);
    const hits = this.raycastHits;
    hits.length = 0;
    this.raycaster.intersectObjects(this.gatherNodeMeshes, true, hits);
    const result = resolveGatherNodePick(hits);
    hits.length = 0;
    return result;
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
    this.raycastNdc.set(
      (clientX / this.viewport.width) * 2 - 1,
      -(clientY / this.viewport.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.raycastNdc, this.camera);
    const hits = this.raycastHits;
    hits.length = 0;
    this.raycaster.intersectObjects(this.clickTargets, true, this.raycastHits);
    const directHitIds = this.directHitIds;
    directHitIds.length = 0;
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
    hits.length = 0;
    if (directHitIds.length === 0) return null;
    return resolveDirectPickEntityId(directHitIds, this.sim.entities, this.sim.player.targetId);
  }

  // The forgiving-assist half of pick(): snap to the nearest targetable
  // character within a small screen radius when nothing was hit directly.
  pickSloppy(clientX: number, clientY: number): number | null {
    // Forgiving assist: nothing under the ray, so snap to the nearest
    // targetable character within a small screen radius, chibi proportions
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
        this.tmpV2.y += (v.height + v.mountLift) * e.scale + 1.0;
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
    aim: {
      x: number;
      z: number;
      radius: number;
      school: string;
      dimmed: boolean;
    } | null,
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
