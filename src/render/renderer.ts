import * as THREE from 'three';
import { NumberSampleRing } from '../game/sample_ring';
import { coerceFxTier, nameplateIntervalSec } from '../game/ui_tier_knobs';
import { supportHeightAt } from '../sim/colliders';
import {
  emptyPriestMarkerState,
  priestMarkerStateForAuras,
} from '../sim/combat/priest/presentation';
import {
  ABILITIES,
  ARENA_SLOT_COUNT,
  arenaOrigin,
  BG_SLOT_COUNT,
  battlegroundOrigin,
  CLASSES,
  DELVE_MODULE_Z_START,
  DUNGEON_LIST,
  DUNGEON_X_THRESHOLD,
  defaultDelveModules,
  delveAt,
  delveModuleStackEndRelZ,
  delveOrigin,
  delveSlotAt,
  dungeonAt,
  INSTANCE_SLOT_COUNT,
  ITEM_SETS,
  instanceOrigin,
  isArenaPos,
  isBgPos,
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
import { ALL_CLASSES, type Entity, isMechWearer, type SimEvent } from '../sim/types';
import { groundHeight, waterLevelAt, zoneBiomeAt } from '../sim/world';
import type { ChatBubbleStyle } from '../ui/chat_bubble_style';
import { tEntity } from '../ui/entity_i18n';
import type { IWorld } from '../world_api';
import { buildAbilityMaterialPrewarmGroup } from './ability_material_prewarm';
import {
  AbilityVfx,
  AbilityVfxFx,
  abilityVfxTexturePrewarmSteps,
  collectAbilityVfxCompileTargets,
} from './ability_vfx';
import type { AbilityVfxTextures } from './ability_vfx/fx_textures';
import { ABILITY_VFX_FULL_SPECS } from './ability_vfx_full_specs';
import { shouldDrawLegacyCastSparkle, syncAbilityVfxCast } from './ability_vfx_registry';
import { ABILITY_VFX_SPECS } from './ability_vfx_specs';
import { AbyssalRiftFx } from './abyssal_rift_fx';
import { AfflictionFamiliar } from './affliction_familiar';
import { type AmberFeaturesView, buildAmberFeatures } from './amber_features';
import { isVisuallyDead } from './anim_state';
import { AOE_RING_LIFETIME, aoeRingAnim } from './aoe_ring';
import { arrivalCoverActive, noteArrivalIfTeleported } from './arrival_cover';
import { ktx2RetainedSourceBytes } from './assets/ktx2_mip_release';
import { formatResidencyBudget, residencyBudget } from './assets/residency_budget';
import type { AmbientPointSource, SpatialAudioSink, Surface } from './audio_sink';
import { createBackgroundGpuQueue, GPU_WORK_PRIORITY } from './background_gpu_queue';
import { attachBankerChestToNpcView } from './banker_chest';
import { type BattlegroundView, buildBattleground } from './battleground';
import { BattlegroundFx } from './battleground_fx';
import { updateBattlegroundOccluderFades } from './battleground_placements';
import { buildBattlegroundObject } from './battleground_props';
import { ensureBiomeHazeField, setBiomeHazeCamera, setBiomeHazeGrade } from './biome_haze_field';
import { type BiomeHazePreset, hazeLightLevel } from './biome_haze_field_core';
import { type BirdsView, buildBirds } from './birds';
import { type BladeGrassView, buildBladeGrass } from './blade_grass';
import { type BladeGrassBandView, buildBladeGrassBand } from './blade_grass_band';
import {
  type BlobShadowSlot,
  blobBaseRadius,
  blobShadowPlanInto,
  createBlobShadowSlot,
} from './blob_shadow_core';
import { BlobShadows } from './blob_shadows';
import { createBuildLedger } from './build_ledger_core';
import { BuildRetryGate } from './build_retry_gate';
import { setBuildSpanSink } from './build_spans';
import { type BulwarkFeaturesView, buildBulwarkFeatures } from './bulwark_features';
import { BurningPactMarkers } from './burning_pact_markers';
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
import { buildCampBraziers, type CampBraziersView } from './camp_braziers';
import { canopyDetailPrewarmTextures } from './canopy_detail';
import { canvasDataUrlAsync } from './canvas_data_url';
import { buildCastleFeatures, type CastleFeaturesView } from './castle_features';
import { buildCelestialSprites, type CelestialSprites } from './celestial_sprites';
import { buildCharacterEffectPrewarmGroup } from './character_effect_prewarm';
import {
  type CharacterWeaponAura,
  characterRuneTintColor,
  characterVeilboundState,
  characterWeaponAuraInto,
  characterWeaponAuraMode,
  hunterPetFerocityStage,
  hunterPetFrenzyActive,
  hunterPetVisualScale,
  isOathChainAura,
  isPaladinWingAura,
  tithefiendEmpoweredActive,
} from './character_effects';
import {
  addCharacterEffectAura,
  CHARACTER_EFFECT_RECKLESSNESS,
  CHARACTER_EFFECT_SOUL_REND,
  hasCharacterEffect,
} from './character_effects_core';
import {
  characterPresentationCasting,
  nextRecklessnessSkullsLatch,
  shouldRunCharacterPresentationWork,
} from './character_presentation_core';
import { characterViewOutsideHysteresis } from './character_view_core';
import {
  type AnimState,
  type AssembleOptions,
  type CharacterVisual,
  composedLookPiecesOf,
  createCharacterVisual,
  createMountVisual,
  type FarBakeGate,
  lookPiecesStats,
  modularLookFor,
  setWeaponVfxViewportHeight,
} from './characters';
import {
  advanceSwimPitch,
  isFallingAtSpeed,
  isSubmergedAtDepth,
  isSwimmingAtDepth,
  isWadingAtDepth,
  SWIM_ENTER_FEET_DEPTH,
  SWIM_EXIT_FEET_DEPTH,
  shouldTriggerWaterImpact,
  waterContactFrameMode,
} from './characters/anim_state';
import { logAssetMissOnce } from './characters/asset_miss_log';
import {
  characterResidencySources,
  isWeaponSkinModelUrl,
  mechAssetsReady,
  mountAssetsReady,
  onCharacterAssetReady,
  preloadMechAssets,
  preloadMountAssets,
  preloadTrainingDummyAssets,
  trainingDummyAssetsReady,
} from './characters/assets';
import {
  activeCharacterFormVisual,
  characterFormMaskForAura,
  characterFormReadyMask,
  characterFormShadowPlan,
  characterFormVisibility,
  requestedCharacterForm,
  resolvedCharacterForm,
} from './characters/form_visual_selection_core';
import { skinCount, visualKeyFor, weaponSkinModelUrl } from './characters/manifest';
import { modularLookChanged } from './characters/player_look_core';
import { PooledVisualLifecycle } from './characters/pooled_visual_lifecycle';
import {
  playerRangedAttackAlreadyStarted,
  playerRangedAttackStartsAtLaunch,
} from './characters/skin_attack';
import { CharacterVisualPool, characterVisualPoolKey } from './characters/visual_pool';
import { shouldRetainPooledCharacterVisual } from './characters/visual_pool_policy';
import { attackAbilityId, isSpinAttackAbility } from './characters/weapon_attack_style_core';
import { fogFarForBuiltGround, groundViewConeHalfAngle } from './chunk_residency_core';
import { CLICK_MARKER_LIFETIME, clickMarkerAnim, clickMarkerColor } from './click_marker';
import { buildCliffScree, type CliffScreeView } from './cliff_scree';
import type { CompileGateResult } from './compile_gate';
import { CompileGateQueue, SerialGateLane, settlePendingSwap } from './compile_gate';
import { linkPieceWork } from './compile_gate_pieces';
import {
  castingAtPlayerPredicate,
  compileMayStartBeforeInitialPaint,
  compilePriorityForTarget,
} from './compile_priority_core';
import { preflightWebGL2ContextRecycle, type RecycledRendererContext } from './context_recycle';
import { trackWebGLContext } from './context_release';
import {
  animatesEveryFrame,
  animCadenceFrames,
  CHARACTER_LOD_RANGE_SQ,
  type CharacterLodBands,
  characterLodBandsInto,
  movingHoldoutActive,
  showsStaticFarMesh,
} from './crowd_lod';
import { daisVisualLift } from './dais_lift';
import { buildDawnholdFeatures, type DawnholdFeaturesView } from './dawnhold_features';
import { currentDayNightPhase, currentLunarPhase, dayNightPhaseOverride } from './day_night_clock';
import {
  aboveHorizon,
  DAY_ONLY,
  type DayNightGrade,
  dayNightGrade,
  duskWarmAmount,
  effectiveDayness,
  fullDayGrade,
  globalDayness,
  moonDirection,
  moonTerminator,
  NEUTRAL_DAY_GRADE,
  nightIblScale,
  nightSkyDesat,
  nightStarAmount,
  REALM_DAYNIGHT_AMPLITUDE,
  REALM_MOON_TINT,
  realmLightTint,
  sunDirection,
  sunsetWarmGate,
  usesLiveDayNightLighting,
  warmDuskGrade,
} from './day_night_core';
import { buildDecorTorchFx, type DecorTorchFxView } from './decor_torch_fx';
import { shouldPlayDeedFirework } from './deed_fx_gate';
import { DelveInteriorTracker } from './delve_interior_tracker';
import { buildDelveInteractable, syncDelveInteractableVisibility } from './delve_props';
import { detailHorizonStarved } from './detail_horizon_core';
import { buildDoorBody, buildRiftGateBody, buildRiftPuzzleProp } from './door_portal';
import { watchDevicePixelRatio } from './dpr_watch';
import { DrainChannelStopLatch, drainChannelVisualPlan } from './drain_channel_visual_core';
import { createLogicalFrameDrawStats, type LogicalFrameDrawStats } from './draw_stats_core';
import { DungeonInteriors, dungeonDaisHasRaisedPlatform, ensureDungeonAssets } from './dungeon';
import {
  dynamicResolutionAllocationScale,
  dynamicResolutionGovernorRange,
  dynamicResolutionRect,
  initialEffectiveRenderScale,
  MIN_DYNAMIC_RENDER_SCALE,
} from './dynamic_resolution_core';
import { buildEastbrookTownView, type EastbrookTownView } from './eastbrook_town';
import { buildEmberFeatures, type EmberFeaturesView } from './ember_features';
import { buildEmberPools, type EmberPoolsView } from './ember_pools';
import { applyCharacterFormVisibility } from './entity_gate_stand_in_core';
import {
  entityViewCandidatePriority,
  entityViewDistanceSq,
  entityViewIsAdmitted,
  isDistanceCullExemptObject,
  isPersistentPortalObject,
  entityViewShouldDrop as shouldDropView,
  viewBuildClass,
} from './entity_view_policy_core';
import { EntryDetailHorizonAdmission } from './entry_detail_horizon';
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
import { EvilEyeMarkers } from './evil_eye_markers';
import { advanceSelfFacing, releaseSelfFacing, wrapAngle } from './facing_smooth';
import {
  buildFarTerrain,
  FAR_VISTA_ENTRY_MAX_WAIT_MS,
  type FarTerrainView,
  farVistaGate,
  setFarTerrainNightGrade,
} from './far_terrain';
import {
  detailCullFar,
  type FarVistaPlan,
  FOGLESS_DETAIL_FAR,
  horizonHazePlan,
} from './far_terrain_core';
import { buildFarshoreFeatures } from './farshore_features';
import { buildFenFeatures, type FenFeaturesView } from './fen_features';
import { buildFenbridgeTownView, type FenbridgeTownView } from './fenbridge_town';
import {
  createFireLightAdopter,
  pruneFireLights,
  reparentStrandedLightsToScene,
  runFireLightBudgetPass,
} from './fire_light_registry';
import { type FireballTravelVisual, syncFireballTravelVisual } from './fireball_travel_visual';
import { buildFish, type FishView } from './fish';
import { FishingBobberVisual } from './fishing_bobber';
import {
  buildFoliage,
  buildFoliageMaterialPrewarmGroup,
  clearFoliageShadowVolume,
  type FoliageView,
  foliageResidencySources,
  setFoliageShadowVolume,
} from './foliage';
import { activeFarFieldPolicy } from './foliage_impostor';
import { roundMs, summarizeMs } from './frame_ms_stats_core';
import { type FramePresentHost, presentFrame } from './frame_present';
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
import { attachSceneGroupGated } from './gated_scene_attach';
import { buildGatherNodes, type GatherNodesView, resolveGatherNodePick } from './gather_nodes';
import {
  GFX,
  type GfxBucketLevels,
  initGfxTier,
  SUN_ANCHOR,
  SUN_DIR,
  sharedUniforms,
  urlForcedTier,
} from './gfx';
import { GlacialFrontVisual } from './glacial_front_visual';
import { createGpuPrepAdmission } from './gpu_prep_admission';
import { createGpuPrepBudget } from './gpu_prep_budget_core';
import { gpuPrepEventsSnapshot } from './gpu_prep_events';
import { bakeGrassGroundTexture, setGrassGroundBake } from './grass_ground_bake';
import { buildGreatTreePrewarmGroup } from './great_tree_prewarm';
import { GroundAimReticleVisual } from './ground_aim_reticle_visual';
import {
  groundObjectPoolKey,
  type PooledObjectView,
  storePooledObject as storeGroundObjectInPool,
  takeOrBuildGroundObject,
} from './ground_object_pool';
import { createGroundTilt, type GroundTiltState, stepGroundTilt } from './ground_tilt_core';
import { buildHauntFeatures, type HauntFeaturesView } from './haunt_features';
import { usedJsHeapMb } from './heap_sample';
import { createHitchFrameAligner } from './hitch_frame_align_core';
import { buildHollowGates, type HollowGatesView } from './hollow_gates';
import { type IceBlockVisual, syncIceBlockVisual } from './ice_block_visual';
import { idleSlot } from './idle_queue';
import { buildImpactSite, buildImpactSitePrewarmGroup, type ImpactSiteView } from './impact_site';
import { deferredPassArms, initialFrameDeferral, type LinkDebt } from './initial_frame_core';
import { buildInitialSceneCompileUnits } from './initial_scene_compile_units';
import {
  collectInitialPresentationTextures,
  InitialSceneTextureAdmission,
  initialSceneTextureResumeUnits,
} from './initial_scene_texture_admission';
import * as encounterPrewarm from './interior_encounter_prewarm_pass';
import {
  applyInteriorLightRig,
  applyRiftLightRig,
  type FogSceneState,
  isOpenAirFogState,
} from './interior_light_rig';
import { IslandGuidance } from './island_guidance';
import { buildJailScene, type JailSceneView } from './jail_scene';
import { buildJungleFeatures, type JungleFeaturesView } from './jungle_features';
import { stepLichHeartbeat } from './lich_audio_state_core';
import { LightPulses } from './light_pulses';
import {
  createPrewarmPacing,
  markPrewarmPacingReveal,
  type PrewarmPacingHandle,
} from './link_rate_budget';
import { runWorldGateTouchLane } from './linked_program_touch_lane';
import * as liveProgramWatch from './live_program_watch';
import { renderLoadMeasure } from './load_marks';
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
import { collectObjectTextures } from './material_texture_slots';
import { buildMobNightGlow, type MobNightGlowView } from './mob_night_glow';
import { buildMotes, type MotesView } from './motes';
import { MountBeacon } from './mount_beacon';
import {
  mountPrewarmKeys,
  stageMountPrewarmVisual,
  stageResidentMountPrewarmVisual,
} from './mount_prewarm';
import { mountBobY, mountVisualSpec } from './mount_visuals';
import { NameplatePainter } from './nameplate_painter';
import {
  isProjectedNameplateAnchorVisible,
  nameplateScreenTransform,
} from './nameplate_projection';
import { NecromancyArmyPortalFx } from './necromancy_army_portal_fx';
import { NecromancyGroundFx } from './necromancy_ground_fx';
import { NeedleOfFateVfx } from './needle_of_fate_vfx';
import { isNeedleOfFateProjectile } from './needle_of_fate_vfx_core';
import { facingAlpha, POS_EXTRAPOLATION_CAP, remoteEntityAlpha } from './net_interp_core';
import { buildNightAccents, type NightAccentsView } from './night_accents';
import { buildNightFeatures, type NightFeaturesView } from './night_features';
import {
  ensureNightLightField,
  hasNightLightField,
  updateNightLightField,
} from './night_light_field';
import { collectBodyNightLights, type NightLightSite } from './night_light_field_core';
import {
  lampGlowAmount,
  mobGlowAmount,
  nightLightAmount,
  nightRimBoost,
  wildGlowAmount,
} from './night_lighting_core';
import { buildEastbrookNoticeboard } from './noticeboard';
import { buildGhostVariantPrewarmGroup } from './occluder_ghost_prewarm';
import {
  type OpaqueSortPolicyInput,
  opaqueFrontToBackSort,
  opaqueMaterialFirstSort,
  shouldUseFrontToBackOpaqueSort,
} from './opaque_draw_order_core';
import {
  PALADIN_AEGIS_DOME_RADIUS,
  type PaladinAegisVisual,
  syncPaladinAegisVisual,
} from './paladin_aegis_visual';
import {
  type PaladinAscensionVisualPlan,
  paladinAscensionVisualPlanInto,
} from './paladin_ascension_core';
import {
  type PaladinAscensionVisual,
  syncPaladinAscensionVisual,
} from './paladin_ascension_visual';
import {
  type PaladinAvengingWrathVisual,
  syncPaladinAvengingWrathVisual,
} from './paladin_avenging_wrath_visual';
import { PaladinConsecrationVisuals } from './paladin_consecration_visual';
import {
  type PaladinOathChainVisual,
  syncPaladinOathChainVisual,
} from './paladin_oath_chain_visual';
import {
  type PaladinSunVerdictAuraSource,
  type PaladinSunVerdictVisualPlan,
  paladinSunVerdictVisualPlanForAuraInto,
  selectPaladinSunVerdictAura,
} from './paladin_sun_verdict_core';
import {
  type PaladinSunVerdictVisual,
  syncPaladinSunVerdictVisual,
} from './paladin_sun_verdict_visual';
import { projectionScalePixels } from './perceptual_lod_core';
import { resolveDirectPickEntityId } from './pick_resolution';
import { PlacedAssetsView } from './placed_assets';
import { type PlayerAuraRingInput, PlayerAuraRings } from './player_aura_rings';
import {
  countDrawnPointLights,
  pointLightPadCount,
  type RankedPointLight,
  reconcileViewPointLights,
} from './point_light_budget';
import { buildComposer, type PostPipeline } from './post';
import { withSceneHiddenForPresentationPrewarm } from './presentation_prewarm';
import { createPreviewPrewarmLane } from './preview_prewarm_lane';
import {
  compileRootLabel,
  createPrewarmBudgetVariantHost,
  createPrewarmCompileLifecycle,
  type PrewarmCompileLifecycle,
  type RendererPrewarmCategory,
  type RendererPrewarmDiagnosticsBaselineStats,
  type RendererPrewarmManifestEntryStats,
  type RendererPrewarmStats,
  runPrewarmBudgetVariants,
  summarizePrewarmManifest,
} from './prewarm_compile_lifecycle';
import {
  runPrewarmCompileSubmission,
  submitPrewarmCompileUnit,
} from './prewarm_compile_submission_core';
import { prewarmDepthMaterial } from './prewarm_depth_material';
import {
  boundedPrewarmVisibility,
  runBackgroundPrewarm,
  withHiddenPrewarmGroups,
} from './prewarm_pass';
import {
  compileGroupRunsBeforeInitialPaint,
  mandatoryLandmarkViewsReady,
  nearbyPrewarmViewBudget,
  orderedPrewarmIds,
  orderPrewarmResumeEntries,
  type PrewarmEntryProgress,
  type PrewarmPolicy,
  partitionMandatoryLandmarkCandidates,
  partitionResidentSkyBiomes,
  planCompileSubmission,
  portalPrewarmViewBudget,
  prewarmBuildDeadline,
  prewarmCompileAwaitDeadline,
  prewarmEntryResumesAfterSkip,
  prewarmEntryRuns,
  prewarmEntryShouldDefer,
  prewarmResumeIsDebt,
  prewarmSubmitShouldStop,
  resolvePrewarmEntryStatus,
  resolvePrewarmPolicy,
  skyAssetInlineWaitMs,
  withRestoredPrewarmState,
} from './prewarm_policy';
import {
  type PrewarmResumeEntry,
  type PrewarmResumeUnit,
  resumeDroppedPrewarmEntries,
  runPrewarmCompileResumeUnit,
  runPrewarmPiecesSerially,
  settlePrewarmBeforePublish,
  trackPrefetch,
  waitForPrefetch,
} from './prewarm_resume';
import { createPrewarmResumeLedger } from './prewarm_resume_ledger_core';
import { type PriestMarkersVisual, syncPriestMarkersVisual } from './priest_markers_visual';
import { pieceProgramSettle } from './program_variant_settle';
import { buildPropMaterialPrewarmGroup, buildProps, propResidencySources } from './props';

import { makeQuestObjectGate, type QuestObjectGateOptions } from './quest_object_gate_core';
import { buildGroundQuestObject } from './quest_objects';
import { RaceLine } from './race_line';
import { isOwnedPetHostile } from './reaction';
import { buildRealmFlora, type RealmFloraView } from './realm_flora';
import {
  RenderBudgetGovernor,
  type RenderBudgetSample,
  type RenderBudgetState,
  renderBudgetShaderPrewarmLevels,
} from './render_budget';
import { gpuPrepMode } from './render_dev_flags';
import {
  emptyRenderDiagnosticsSnapshot,
  type RenderableDiagnosticObject,
  RenderDiagnostics,
} from './render_diagnostics';
import { measureFeatureFootprint, setRenderCategory } from './renderer_diagnostics';
import { snapshotRendererFrameStats } from './renderer_frame_stats_snapshot';
import {
  beginRendererFrameTelemetry,
  emptyFoliagePerfStats,
  emptyFramePhaseMs,
  emptyWorldPhaseMs,
  type RendererFramePhaseMs,
  type RendererWorldPhaseMs,
} from './renderer_frame_telemetry_core';
import type {
  RendererFrameStats,
  RendererPerfStats,
  RendererPhase,
  RendererPhaseStats,
  RendererQualityChangeStats,
} from './renderer_perf_stats';
import { disposeRendererPrewarmAndGroundFx } from './renderer_resource_lifecycle';
import { createRevealCompileHost, REVEAL_GATE_PREP_KIND } from './reveal_compile_host';
import { createRevealGate } from './reveal_gate';
import type { RevealGateCore } from './reveal_gate_core';
import { collectRiftAmbientSources } from './rift_ambience';
import { buildRiftRankBadge } from './rift_rank';
import { syncRigMatrixFreeze, unfreezeRigMatrices } from './rig_visibility_freeze';
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
import { SelfSpiritPrewarmer } from './self_spirit_prewarm';
import { SentenceVfx } from './sentence_vfx';
import { sentenceImpactPlan } from './sentence_vfx_core';
import {
  createShadowCadenceState,
  resetShadowCadence,
  updateShadowCadence,
} from './shadow_cadence_core';
import {
  type ShadowAnchor,
  shadowTexelWorldSize,
  snapShadowAnchor,
} from './shadow_texel_snap_core';
import { disposeUnsharedMeshResources, markSharedMaterial } from './shared_resource';
import {
  buildSky,
  ensureSkyAssetsAt,
  ensureSkyBiomeAssets,
  pinSkyBiomeAssets,
  type SkyKey,
  type SkyView,
  skyBiomesAt,
  skyResidencyTextures,
} from './sky';
import { zoneArrivalReady } from './sky_residency_core';
import { SkyResidencyDriver } from './sky_residency_driver';
import { nearestSloppyPickId, type SloppyPickCandidate } from './sloppy_pick';
import { buildSoulwell, disposeSoulwellVisual, syncSoulwellVisual } from './soulwell';
import {
  freezeStaticMatrices,
  freezeStaticSubtreeMatrices,
  lookAtFrozen,
  refreshFrozenWorldMatrix,
} from './static_matrix';
import { buildStationProps } from './stations';
import { shouldRenderStealthGhost } from './stealth';
import { createStepSmooth, type StepSmoothState, stepSmoothHeight } from './step_smooth_core';
import { buildStreetlamps, type StreetlampsView } from './streetlamps';
import { buildFlaredConeFan, buildRingXZ, drapeConeWorld } from './target_cone_debug';
import {
  syncTemporalHourglassVisual,
  TemporalHourglassGroundVisuals,
  type TemporalHourglassMode,
  type TemporalHourglassVisual,
} from './temporal_hourglass_visual';
import { buildTerrain, hasTerrainSplatAssets, type TerrainView } from './terrain';
import { runTexturePrepLane } from './texture_prep_lane';
import { sweepMaterialTextures, sweepObjectTextures } from './texture_prewarm';
import { uploadDataTextureInChunks } from './texture_upload';
import { sparkleTexture } from './textures';
import { targetIntensityFromValues } from './travel_speed_fx';
import { TravelSpeedFxPainter } from './travel_speed_fx_painter';
import { UmbralAnchorMarker } from './umbral_anchor_marker';
import {
  UNDERWATER_FOG_COLOR,
  UNDERWATER_FOG_FAR,
  UNDERWATER_FOG_NEAR,
  UnderwaterView,
} from './underwater';
import { createPrewarmGroupSlot, createVariantPrewarmSlot } from './variant_prewarm_slot';
import { SCHOOL_COLORS, Vfx } from './vfx';
import { createOffsetVfxAnchor, createVfxAnchor, type VfxAnchorPose } from './vfx_anchor';
import {
  finishViewCandidates,
  sampleCreatedViewType,
  type ViewCandidate,
  writeViewCandidate,
} from './view_candidate_pool_core';
import {
  runtimeViewCreateBudget,
  type ViewCreateBudgetInput,
  type ViewCreateBudgetState,
} from './view_create_budget_core';
import { ViewCreateRetryGate } from './view_create_retry';
import {
  routeWarlockMeteorSpellfxAt,
  WarlockMeteorFx,
  warlockMeteorDensityScale,
} from './warlock_meteor_fx';
import {
  isMobEngageCue,
  type WarriorCastVisualPlan,
  warriorCastVisualPlan,
} from './warrior_cast_fx_core';
import { RecklessSkullPainter } from './warrior_cast_fx_painter';
import { buildWater, setWaterDayNight, setWaterSunDirection, type WaterView } from './water';
import { buildWaterFlora } from './water_flora';
import {
  buildWeaponVfxPrewarmGroup,
  disposeWeaponEmissiveCache,
  weaponVfxPrewarmTextures,
} from './weapon_vfx';
import {
  resolveQueuedSkinLookup,
  WEAPON_SKIN_APPLIES_PER_FRAME,
  type WeaponSkinApplyDecision,
  WeaponSkinApplyQueue,
} from './weapon_vfx_apply_queue_core';
import { createWeaponVfxPrewarmSkinStage, weaponVfxPrewarmUnits } from './weapon_vfx_prewarm';
import { weaponVfxShedScale } from './weapon_vfx_shed_core';
import { Weather } from './weather';
import { precipForBiome } from './weather_field_core';
import { buildWorldAmbientSources, footstepSurfaceAt } from './world_audio';
import { surfaceDetailPrewarmTextures } from './worn_stone';
import { buildYumiMaze, type YumiMazeView } from './yumi_maze';
import { YumiTeamMarkers } from './yumi_team_markers';
import { zonesEligibleForEviction } from './zone_eviction_core';
import {
  type FeatureFootprint,
  hasUnseededInstanceMatrix,
  isZoneFeatureShadowCasting,
  isZoneFeatureVisible,
} from './zone_feature_visibility_core';
import {
  reportZonePrepare,
  type ZonePrewarmStats,
  type ZoneStreamingStats,
} from './zone_prepare_stats';
import { zonePrewarmTemplateIds } from './zone_prewarm_templates_core';
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
export const ENTITY_VIEW_DESTROY_RANGE = 96;
const ENTITY_VIEW_DESTROY_RANGE_SQ = ENTITY_VIEW_DESTROY_RANGE * ENTITY_VIEW_DESTROY_RANGE;
// Cooldown before re-attempting a view whose assets failed to build (the
// fail-soft path, issue #2079). Without it a permanently failing entity
// consumes a view-creation budget slot every frame; under the hitch backoff
// the budget is 1, so a first-sorted failing entity would starve every other
// pending view.
const VIEW_CREATE_FAIL_RETRY_MS = 2000;
const VIEW_PREWARM_RANGE_SQ = ENTITY_VIEW_CREATE_RANGE_SQ;
const VIEW_PREWARM_MAX_MS = 3000;
// Every browser gets the same short soft budget. Richer world art made the old
// desktop path spend more than 16 seconds warming 47 nearby rigs and shaders
// before reveal, and Chromium could restart during the preceding allocation
// spike. The manifest already records bounded resume units, while ordinary
// nearby views stream through the per-frame creation budget, so holding the
// curtain longer provides no correctness guarantee. Constrained hosts retain
// their smaller manifest in addition to the shared wall.
const VIEW_PREWARM_MAX_MS_CONSTRAINED = 3000;
const PREWARM_COMPILE_MAX_MS_CONSTRAINED = 1500;
// Shader linking is the whole point of the prewarm: if it doesn't finish, the
// first in-world frame that needs a program compiles it synchronously, the
// multi-hundred-ms (up to ~1.7s) freeze players feel when new model types
// appear. So the compile step gets its own budget (it normally drains in <~100ms
// with KHR_parallel_shader_compile) rather than racing the leftover view-build
// budget, which could starve it. This threshold is diagnostic only: an async
// compile cannot be cancelled, so returning at the threshold would let it
// overlap later warm units and gameplay.
const PREWARM_COMPILE_MAX_MS = 1500;
// The soft manifest budget protects ordinary entry. A second independent wall
// deadline also bounds desktop exemptions and Insane's full-manifest policy.
// Already-started WebGL calls cannot be cancelled, so large compiles are split
// into roots and the queue stops launching before this deadline.
const VIEW_PREWARM_HARD_MAX_MS = 5000;
const VIEW_PREWARM_HARD_MAX_MS_CONSTRAINED = 5000;
// Leave room for the final already-started GPU unit to settle. WebGL driver
// work cannot be preempted, so launching exactly at the wall can overshoot it.
const PREWARM_GPU_SUBMIT_GUARD_MS = 1000;
// A background prewarm waits for a browser idle slot between its per-group
// compile chunks; the timeout forces progress under sustained frame load.
const IDLE_PREWARM_TIMEOUT_MS = 250;

// The four pooled-particle burst points the vfx.atlas prewarm spawns around
// the player (behind them, outside the entry camera).
const VFX_PREWARM_BURST_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -4],
  [-3, -5],
  [3, -5],
  [0, -7],
];
// Diagnostic threshold for a live async-compile gate. The compile cannot be
// cancelled, so the target remains hidden and the serial gate remains occupied
// until the driver settles instead of overlapping first-draw or later links.
const VIEW_COMPILE_GATE_MAX_MS = 1500;
// Textures per zone-prewarm upload unit: small enough that one grant's
// decode+upload stays well under a frame, large enough not to double the
// idle-slot count for texture-light children.
const PREWARM_TEXTURE_UNIT_BATCH = 2;
// Reserve at the tail of the view-build budget so the compile + final-frame
// steps always start before the prewarm deadline (runEntry skips late entries).
const PREWARM_BUILD_RESERVE_MS = 1000;
// Reserve at the tail of the compile entry's await-all so world.initial-frame,
// which compileBeforeFirstFrame reorders to run immediately after this entry,
// always starts before the hard deadline: prewarmEntryShouldDefer defers ANY
// entry, even a deadlineExempt one, once its start time reaches hardDeadline.
// See prewarmCompileAwaitDeadline.
const PREWARM_COMPILE_AWAIT_RESERVE_MS = 2000;
// Compile roots per entry unit: one unit launches its batch's compileAsync
// calls and awaits them together, so three's 10 ms poll floors (r165 through
// the installed 0.185, see patches/three@0.185.1.patch) overlap instead
// of stacking (>1000 serial awaits measured 10+ s of pure timer wait). Small
// enough that a batch's synchronous submission prologues stay a bounded slice
// between the yields of the early-submission loop (submitCompileUnits).
const PREWARM_COMPILE_BATCH_ROOTS = 16;
const VIEW_PREWARM_MAX_VIEWS_LOW = 12;
const VIEW_PREWARM_MAX_VIEWS_HIGH = 16;
// Constrained (phone WebKit): build only self plus one required/nearby view at
// entry. Even when twelve views fit in memory and compile asynchronously, their
// compile gates can resolve together and reveal the whole crowd on the first live
// submit. The retained iPhone probe measured that burst at 1.17s. Remaining views
// stream in through the post-entry one-per-frame budget instead.
const VIEW_PREWARM_MAX_VIEWS_CONSTRAINED = 2;
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
// The literal lives in `crowd_lod.ts` beside the factors that scale it.
const ENTITY_LOD_RANGE_SQ = CHARACTER_LOD_RANGE_SQ;
// Contact-blob grounding range on the tiers with no dynamic shadows. Anchored
// to the FIXED articulated-rig range for the same reason weapon_vfx_shed_core.ts
// is (read its header): the live crowd-adaptive band edge swings with one
// client's visible-rig count, so a cue keyed to it would pulse as unrelated
// players wander through the frustum and two viewers standing in the same spot
// would not even agree on where it ends. It also lands just inside the 62yd
// proxy-shadow band the shadowed tiers ground bodies over, so the two tiers
// carry the cue about as far as each other.
const BLOB_SHADOW_RANGE_SQ = CHARACTER_LOD_RANGE_SQ;

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
// Surface kick: beats per second at a standstill, quickening with swim speed,
// and how far behind the pivot the prone body's feet trail (as a fraction of
// stand height — the authored stroke lays the legs out behind the hips).
const SWIM_KICK_HZ = 2.6;
const SWIM_FOOT_TRAIL = 0.19;
// Depth below the waterline over which the underwater wash fades fully in.
const UNDERWATER_FADE_DEPTH = 0.45;
// How far under the line the chase camera is pulled while the player is submerged.
const UNDERWATER_CAMERA_DIP = 0.5;
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
// raw HDRI PMREMs integrate the real sun the dome shader clamps away,
// rescale so ambient matches the dome-capture look (see lookdev-hookup.md)
const IBL_RAW_SCALE = 0.55;
// day/night: at night the key sun and sky bounce cool toward moonlight. These
// are the fully-night blend weights (scaled each frame by the grade's nightAmt).
const MOON_SUN_COLOR = 0x9fb2e0; // pale cool moonlight the warm sun eases toward
const MOON_HEMI_SKY_COLOR = 0x8b9cd0; // cool sky bounce at deepest night
const MOON_HEMI_GROUND_COLOR = 0x2b3350; // dark cool ground bounce at deepest night
const NIGHT_SUN_COOL = 0.55; // how far the sun hue shifts to moonlight at full night
const NIGHT_HEMI_COOL = 0.5; // how far the sky-bounce hue shifts at full night
// golden tone the sun light warms toward, strongest as the sun nears the
// horizon: a deep sunset orange, so dawn and dusk read hot like the real thing
const WARM_SUN_COLOR = 0xff7a28;
// A shared warm daylight bias applied after each biome picks its authored hue.
// The sky bounce is the frame's ambient fill, so this is the knob that decides
// whether ordinary daylight reads golden or clinical, and the first cut at 0.18
// left it clinical. These weights blend TOWARD a cream, never past it, so the
// cool realms stay cool by construction: at 0.3 a Frostveil noon still resolves
// blue-dominant (its bounce lands near rgb 193,196,207), it just stops washing
// the whole frame grey-blue. Both terms are scaled by (1 - nightAmt) at the
// call site, so none of this warmth reaches the moonlit night.
const WARM_HEMI_SKY_COLOR = 0xffdfbd;
const WARM_HEMI_GROUND_COLOR = 0x725038;
const DAY_HEMI_SKY_WARMTH = 0.3;
const DAY_HEMI_GROUND_WARMTH = 0.22;
// the moving sun/moon key light rides at the same distance the fixed anchor did
const SUN_TRAVEL_DISTANCE = SUN_ANCHOR.length();
const RENDERER_PHASE_SAMPLE_LIMIT = 720;
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

type RendererWorldPhase =
  | 'lights'
  | 'water'
  | 'terrain'
  | 'props'
  | 'foliage'
  | 'fish'
  | 'ambientScenery'
  | 'zoneVisibility'
  | 'zoneFeatures'
  | 'vfx'
  | 'camera'
  | 'ambience'
  | 'shadows'
  | 'sky'
  | 'sunSprites'
  | 'godRays';
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
  metamorphVisual: CharacterVisual | null; // Necromancy Lich Form, built lazily
  fireballTravelVisual: FireballTravelVisual | null; // Mage travel form, built lazily
  iceBlockVisual: IceBlockVisual | null; // Ice Block shell, built lazily on first stasis
  temporalHourglassVisual: TemporalHourglassVisual | null;
  frostNovaRootVisual: FrostNovaRootVisual | null; // Atadura de Hielo restraint at the feet
  mageBarrierVisual: MageBarrierVisual | null; // personal mage absorb shell, built lazily
  priestMarkersVisual: PriestMarkersVisual | null; // static Doctrine/Vigil/Effigy/Gloomtithe cues
  paladinAscensionVisual: PaladinAscensionVisual | null;
  paladinAvengingWrathVisual: PaladinAvengingWrathVisual | null;
  paladinOathChainVisual: PaladinOathChainVisual | null;
  paladinAegisVisual: PaladinAegisVisual | null;
  paladinSunVerdictVisual: PaladinSunVerdictVisual | null;
  skin: number; // last-rendered appearance skin — diffed each frame for live swaps
  mainhandItemId: string | null; // last-rendered equipped weapon — diffed for live held-weapon swaps
  offhandItemId: string | null; // last-rendered shield/second weapon, independent of mainhand skins
  weaponSkinId: string | null; // last-rendered weapon-skin cosmetic, diffed for live skin swaps
  weaponStowed: boolean; // last-rendered sheathe state (Z key), diffed for live stow toggles
  helmHidden: boolean; // last-rendered paperdoll eye toggle, diffed to recompose the kit helm
  // last-composed authored look, diffed by VALUE (see modularLookChanged) to
  // recompose a live redesign; a plain reference copy of e.modularAppearance,
  // never normalized, so an unchanged reference short-circuits without a
  // stringify next frame
  modularAppearance: Record<string, unknown> | null | undefined;
  /** unscaled height, nameplate/vfx anchor reads height * e.scale */
  height: number;
  /** last-applied entity scale (group.scale); diffed each frame for live size buffs */
  liveScale: number;
  /** what removeView pulls back out of clickTargets */
  clickTarget: THREE.Object3D;
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
  recklessSkullsSpawned?: boolean;
  // render-space position last frame, for true u/s locomotion speed
  lastX: number;
  lastZ: number;
  // ...and the vertical one, which only swimming reads: it drives how far the
  // body noses over into a dive or a climb (anim_state.advanceSwimPitch).
  lastY: number;
  swimPitch: number;
  // locomotion-state hysteresis so a one-frame speed dip can't reset the
  // walk clip (see locomotion.ts)
  loco: LocoTrack;
  locoState: LocoState;
  // spatial-audio state: distance travelled since the last footfall, and edge
  // latches for jump/land/water-entry detection.
  stepAccum: number;
  lichHeartbeatAt: number;
  waterContactSeen: boolean;
  waterContactActive: boolean;
  waterContactX: number;
  waterContactZ: number;
  waterContactAccum: number;
  wasAirborne: boolean;
  wasSwimming: boolean;
  // feet under the waterline but the ground still under them (the wade latch)
  wasWading: boolean;
  // head under the waterline (the stroke + VFX latch, hysteresis in anim_state)
  wasSubmerged: boolean;
  // long-fall flail latch (hysteresis in anim_state.isFallingAtSpeed)
  wasFalling: boolean;
  // surface-kick beat, 0..1 per splash (never advanced while submerged)
  swimKickPhase: number;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}

export interface RendererCreateOptions extends QuestObjectGateOptions {
  context?: WebGL2RenderingContext;
  initializeGfx?: boolean;
  /** Build the far-vista grid eagerly during construction (macrotask bites,
   *  accelerateInitialBuild). Correct only behind an opaque curtain: the
   *  boot and graphics-rebuild paths keep the default; the editor viewport,
   *  which rebuilds a live Renderer against running frames on every document
   *  load, passes false to stay on polite idle pacing. */
  eagerFarVista?: boolean;
}

export class Renderer {
  scene = new THREE.Scene();
  // A soft light pillar marking the local player's corpse during the ghost run.
  // Built lazily on first death, then just repositioned/toggled (no per-frame alloc).
  private corpseBeacon: THREE.Mesh | null = null;
  camera: THREE.PerspectiveCamera;
  webgl: THREE.WebGLRenderer;
  views = new Map<number, EntityView>();
  // Editor opt-out for the quest-collectable view gate (see RendererCreateOptions).
  private questObjectHidden = makeQuestObjectGate({});
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
  // Snapshot-observed Drain Life channels let late observers reconstruct the tether.
  private snapshotDrainVisualChannels = new Set<number>();
  private snapshotDemonicDrainVisualChannels = new Set<number>();
  private drainChannelStopLatch = new DrainChannelStopLatch();
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
  private readonly camMirror = {
    yaw: Number.NaN,
    pitch: Number.NaN,
    dist: Number.NaN,
  };
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
  private readonly viewCreateBudgetState: ViewCreateBudgetState = { backoffSeconds: 0 };
  private readonly viewCreateBudgetInput: ViewCreateBudgetInput = {
    lowGfx: false,
    constrainedMemory: false,
    entryElapsedMs: 0,
    dt: 0,
    frameMsEma: 0,
    dropFrameMs: 0,
  };
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
  // overlay has it enabled, so the fleet pays nothing for it. The aligner
  // (hitch_frame_align_core) turns the top-of-sync and end-of-sync readings
  // into the sample for the span dt measures, on one reused scratch object.
  private readonly hitchTracker = createHitchTracker();
  private hitchLogEnabled = false;
  private readonly hitchAligner = createHitchFrameAligner();
  private readonly buildLedger = createBuildLedger(); // write-only, read via perfStats()
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
    falling: false,
    backwards: false,
    reverseBackpedal: false,
    dead: false,
    casting: false,
    spinning: false,
    swimming: false,
    submerged: false,
    swimPitch: 0,
    wading: false,
    sitting: false,
  };
  // Second scratch for the mount rig: the rider's state minus the rider-only
  // facts (casting/sitting/dead never reach the mount's locomotion clips).
  private readonly mountAnimScratch: AnimState = {
    speed: 0,
    moving: false,
    running: false,
    airborne: false,
    falling: false,
    backwards: false,
    reverseBackpedal: false,
    dead: false,
    casting: false,
    swimming: false,
    submerged: false,
    swimPitch: 0,
    wading: false,
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
  private celestialSprites: CelestialSprites | null = null;
  private sunDir = new THREE.Vector3();
  // the moving moon direction plus how far above the horizon each body sits
  // (0 down, 1 up); recomputed each frame in updateAmbience from the world clock
  private moonDir = new THREE.Vector3(0, -1, 0);
  private lightDir = new THREE.Vector3(); // blended sun/moon dir the key light uses
  private shadowLightDirection = new THREE.Vector3();
  // World units per shadow-map texel (ortho box width / GFX.shadowMap), set
  // once beside the shadow camera; 0 disables snapping. shadowSnappedAnchor
  // is the per-frame scratch shadow_texel_snap_core.ts fills so the frustum
  // follows the player in whole-texel steps (anti shadow-swimming).
  private shadowTexelWorld = 0;
  private readonly shadowSnappedAnchor: ShadowAnchor = { x: 0, y: 0, z: 0 };
  // Budget-governed shadow cadence (shadow_cadence_core.ts): under sustained
  // render-budget pressure the shadow map updates every other frame, halving
  // the second scene draw; applied right after the governor each frame.
  private readonly shadowCadence = createShadowCadenceState();
  private sunUp = 1;
  private moonUp = 0;
  private starAmt = 0; // 0 day, 1 deep night: star-field strength for the sky dome
  private waterView: WaterView;
  private lastWaterSimulationPasses = 0;
  // The waterRipples setting (default off), threaded in via setWaterRipples
  // because render modules never read the settings store directly. Held here
  // so an editor water rebuild re-applies the player's choice to the fresh
  // WaterView.
  private waterRipplesEnabled = false;
  private terrainView: TerrainView;
  // Map-editor placed GLB assets; null when the world has none and the editor
  // never asked for the view (the shipped game with the built-in world).
  private placedAssetsView: PlacedAssetsView | null = null;
  private jailScene: JailSceneView;
  private foliage: FoliageView;
  private fish: FishView;
  private motes: MotesView;
  private bladeGrass: BladeGrassView;
  private bladeGrassBand: BladeGrassBandView;
  private cliffScree: CliffScreeView;
  private birds: BirdsView;
  private impactSite: ImpactSiteView;
  private realmFlora: RealmFloraView | null = null;
  private emberFeatures: EmberFeaturesView | null = null;
  private bulwarkFeatures: BulwarkFeaturesView | null = null;
  private castleFeatures: CastleFeaturesView | null = null;
  private dawnholdFeatures: DawnholdFeaturesView | null = null;
  private frostSky: FrostSkyView | null = null;
  private fenFeatures: FenFeaturesView | null = null;
  private amberFeatures: AmberFeaturesView | null = null;
  private nightFeatures: NightFeaturesView | null = null;
  private streetlamps: StreetlampsView | null = null;
  private emberPools: EmberPoolsView | null = null;
  private campBraziers: CampBraziersView | null = null;
  private decorTorchFx: DecorTorchFxView | null = null;
  // The island rail's guidance coordinator (beacon fizz + golden trail).
  private islandGuidance!: IslandGuidance;
  private nightAccents: NightAccentsView | null = null;
  private mobNightGlow: MobNightGlowView | null = null;
  // Contact blobs under nearby bodies, built ONLY on the tiers that cast no
  // dynamic shadow (null everywhere else), plus the one scratch slot the
  // entity loop refills per character.
  private blobShadows: BlobShadows | null = null;
  private blobShadowSlot: BlobShadowSlot = createBlobShadowSlot();
  // Pooled scratch for the night light field's dynamic entries (the body
  // collector rewrites it each frame; entries past the count are stale).
  private nightBodyLights: NightLightSite[] = [];
  private nightBodyLightCount = 0;
  private hauntFeatures: HauntFeaturesView | null = null;
  private jungleFeatures: JungleFeaturesView | null = null;
  private gardenFeatures: GardenFeaturesView | null = null;
  private galeFeatures: GaleFeaturesView | null = null;
  private fogScratch = new THREE.Color();
  // Blue wash + bubbles while the CAMERA is under a waterline, and the eased
  // 0..1 that drives them (and the fog override in updateUnderwater).
  private underwaterView!: UnderwaterView;
  private underwaterBlend = 0;
  // Last frame's submerged read for the LOCAL player, set in sync(). Drives the
  // camera dip below; one frame of lag is invisible at swim speeds.
  private selfSubmerged = false;
  // world day/night grade, recomputed each frame from the UTC-anchored clock in
  // updateAmbience and consumed by the outdoor fog/light easing, the sky dome,
  // and the IBL intensity. Defaults to full day for the frames before the first
  // updateAmbience runs.
  private dnGrade: DayNightGrade = fullDayGrade();
  // How far into night the shared WORLD clock is (1 - globalDayness), before any
  // realm amplitude compresses it, and 0 on a tier that never applies the grade.
  // The night-visibility layers (streetlamps, the mob ground glow, the character
  // rim lift) all key off this one number so they light up together in every
  // realm; see night_lighting_core.ts for why it is the global amount.
  private dnGlobalNight = 0;
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

  // Adoption is the ONE way a point light joins the budget after construction:
  // it hides the light AND dirties the rank, which are only correct together
  // (fire_light_registry.ts explains why). Subsystems get `sink`, which is the
  // same operation shaped like Array.push, so they cannot bypass it.
  private readonly fireLightAdopter = createFireLightAdopter(
    () => this.fireLights,
    () => {
      this.lightRankDirty = true;
    },
  );

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
    setRevealGate(gate: { allow(key: string): boolean } | null): void;
    setBandRevealGate(gate: { allow(key: string): boolean } | null): void;
    revealRoots(key: string): readonly THREE.Object3D[];
  };
  /** The props reveal gate (far cells at construction, bands at world entry). */
  private propsRevealGate: RevealGateCore | null = null;
  /** The foliage bucket reveal gate (armed at world entry, like the bands). */
  private foliageRevealGate: RevealGateCore | null = null;
  private eastbrookTownView!: EastbrookTownView;
  private fenbridgeTownView!: FenbridgeTownView;
  private hollowGates!: HollowGatesView;
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
  // The per-biome sky eviction/restore lane. Its host view is read-through, not
  // a snapshot: skyView is rebuilt by build(), and envBiome / envTransition move
  // under an IBL ease long after this field initializes.
  private readonly skyResidency = new SkyResidencyDriver({
    isShutdown: () => this.shutdownStarted,
    lifecycleGeneration: () => this.lifecycleGeneration,
    scene: () => this.scene,
    skyView: () => this.skyView,
    envRTs: () => this.envRTs,
    envBiome: () => this.envBiome,
    envTransition: () => this.envTransition,
    preparedZones: () => this.preparedZones,
    liveZones: () => this.sim.cfg.world?.zones ?? ZONES,
    zoneIdAt: (x, z) => this.zoneIdAt(x, z),
    prewarmTextureInIdle: (texture) => this.prewarmTextureInIdle(texture),
    runPmrem: (biome, label) =>
      this.backgroundGpuWork.run(
        () => this.ensureEnvironmentBiome(biome),
        GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        label,
      ),
    idleSlot: () => idleSlot(IDLE_PREWARM_TIMEOUT_MS, { maxTimeoutDeferrals: 2 }),
  });
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
  // The tier's drop-frame threshold IS the preparation headroom: a frame over
  // it is a dropped frame, so what fits under it is what preparation may cost
  // before the frame it lands in stops being a frame the player got.
  private gpuPrepBudget = createGpuPrepBudget({ targetFrameMs: GFX.budget.dropFrameMs });
  readonly backgroundGpuWork = createBackgroundGpuQueue({
    admission: createGpuPrepAdmission(this.gpuPrepBudget),
  });
  // Serial tail for spirit-puppet construction: several models resolve at once
  // when a class is first sighted, so the builds queue behind one another and
  // each spends its own idle slot instead of stacking into one combat frame.
  private spiritBuildLane: Promise<unknown> = Promise.resolve();
  private selfSpirit = new SelfSpiritPrewarmer({
    warm: () =>
      this.backgroundGpuWork.run(
        () => this.warmSelfSpirit(),
        GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        'self-spirit',
        { releaseTail: true },
      ),
    idle: () => idleSlot(IDLE_PREWARM_TIMEOUT_MS),
  });
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
  // The fog-free vista split (far_terrain_core.ts): on vista tiers the
  // outdoor fog is parked past the camera far plane (it occludes nothing)
  // while every classic subsystem culls against this detail horizon, which
  // eases exactly like scene fog used to (residency clamp included). The far
  // mesh and the foliage sprites fill everything beyond it.
  private farVista: FarVistaPlan;
  private farTerrainView!: FarTerrainView;
  private detailFogFar: number;
  private entryDetailHorizon = new EntryDetailHorizonAdmission(FOGLESS_DETAIL_FAR);
  // Scratch for the residency clamp's view wedge: the camera forward the clamp
  // reads, kept off the shared tmpV pool because updateAmbience runs in the
  // middle of sync's entity work and must not disturb it.
  private residencyForward = new THREE.Vector3();
  private readonly residencyCone: { forwardX: number; forwardZ: number; halfAngle: number } = {
    forwardX: 0,
    forwardZ: 0,
    halfAngle: Math.PI / 2,
  };
  /** The boot far-grid build, accelerated behind the entry curtain; the
   *  entry gate (farVistaReady) awaits it. Editor terrain rebuilds mint a
   *  new view but deliberately keep polite pacing and never re-arm this. */
  private farVistaInitialBuild: Promise<void> = Promise.resolve();
  /** Set by farVistaReady once the grid stands pre-reveal: the next outdoor
   *  environment update settles scene fog at the horizon haze band instead
   *  of easing it out on screen (fog only; the detail horizon stays
   *  residency-governed). */
  private vistaEntrySettlePending = false;
  /** Fired whenever a zone becomes resident (any prepare path). Wired by
   *  main.ts so presentation caches outside the renderer (the HUD's world-map
   *  background) prewarm alongside the zone itself. */
  onZonePrepared: ((zoneId: string) => void) | null = null;
  private lastZonePrepareStats: ZoneStreamingStats['last'] = null;
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
  // Thornhollow Fields flag/rune per-frame dressing + transition bursts; runs off
  // bgInfo and view userData only (battleground_fx.ts).
  private bgFx!: BattlegroundFx;
  private raceLine: RaceLine;
  private mountBeacon: MountBeacon;
  // Per-ability spell VFX subsystem: the spec-driven painter plus the pooled
  // primitive engine (ribbons, shock rings, decals, windup orbs, buff orbits;
  // see src/render/ability_vfx/).
  private abilityVfx: AbilityVfx;
  private abilityVfxFx: AbilityVfxFx;
  private needleOfFateVfx!: NeedleOfFateVfx;
  private sentenceVfx!: SentenceVfx;
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
  private warlockMeteorFx!: WarlockMeteorFx;
  private necromancyGroundFx!: NecromancyGroundFx;
  private necromancyArmyPortalFx!: NecromancyArmyPortalFx;
  private abyssalRiftFx!: AbyssalRiftFx;
  private ringOfFrostVisuals!: RingOfFrostVisuals;
  private riftDeathZoneVisuals!: import('./rift_death_zone').RiftDeathZoneVisuals;
  private temporalHourglassGroundVisuals!: TemporalHourglassGroundVisuals;
  private paladinConsecrationVisuals!: PaladinConsecrationVisuals;
  private readonly mageBarrierStateScratch: MageBarrierState = {
    theme: 'frost',
    value: 0,
  };
  private readonly priestMarkerStateScratch = emptyPriestMarkerState();
  private readonly paladinAscensionPlanScratch: PaladinAscensionVisualPlan = {
    active: false,
    charges: 0,
    lastCharge: false,
  };
  private readonly paladinSunVerdictPlanScratch: PaladinSunVerdictVisualPlan = {
    active: false,
    charges: 0,
    imminent: false,
  };
  private readonly weaponAuraScratch: CharacterWeaponAura = { color: 0, tip: false };
  private glacialFrontVisual!: GlacialFrontVisual;
  private fishingBobbers!: FishingBobberVisual;
  private weather: Weather;
  private weatherOn = true;
  private audioSink: SpatialAudioSink | null = null;
  private readonly ambientPointSources: readonly AmbientPointSource[];
  // Reused scratch buffers for the per-frame rift ambience merge in
  // updateCamera: avoids allocating two arrays plus an object per match every
  // frame regardless of whether a rift is nearby (review finding, PR #2687).
  private readonly riftAmbienceScratch: AmbientPointSource[] = [];
  private readonly ambientPointsMergedScratch: AmbientPointSource[] = [];

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

  // seed-bound ground sampler, built once so per-frame drape updates
  // allocate no closure.
  private groundSample = (x: number, z: number): number => groundHeight(x, z, this.sim.cfg.seed);
  private selectionDrapeSupportY = 0;
  private selectionGroundSample = (x: number, z: number): number =>
    Math.max(this.groundSample(x, z), this.selectionDrapeSupportY);

  private lowGfx: boolean;
  private post: PostPipeline | null = null;
  private godRays: THREE.Sprite[] = [];
  // Eased per-biome god-ray strength (BIOME_GOD_RAYS via updateAmbience): the
  // shafts are "sun through bright air" and read as detached glowing streaks
  // over the twilight and gloom realms, so those fade them out entirely.
  private godRayZoneScale = 1;
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
    // three's onContextRestore re-runs initGLContext, which REPLACES
    // webgl.info with a fresh WebGLInfo; the composer-tier draw-stats session
    // captured the old object at construction and would read a dead
    // accumulator (governor draw signal and opaque-sort input pinned at zero)
    // for the rest of the session. Re-create it against the live info; the
    // fresh session's first beginFrame re-baselines safely. Pre-existing on
    // the release branch (not a phase 6 regression); r185 even preserves
    // autoReset onto the new object, so only this rebind is needed.
    if (this.drawStats) this.drawStats = createLogicalFrameDrawStats(this.webgl.info);
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
  private initialGpuWorkStart: Promise<void> | null = null;
  private gpuHitchCompileLifecycle: PrewarmCompileLifecycle | null = null;
  private gpuHitchPacing: PrewarmPacingHandle | null = null;
  private readonly renderDiagnostics = new RenderDiagnostics({
    counters: () => ({
      programs: this.webgl.info.programs?.length ?? 0,
      textures: this.webgl.info.memory.textures,
    }),
    scene: () => this.scene,
    generation: () => this.lifecycleGeneration,
    shutdown: () => this.shutdownStarted,
  });
  private appliedBudgetLevels: RenderBudgetState['levels'] | null = null;
  private lastQualityChange: RendererQualityChangeStats | null = null;
  private visualPool = new CharacterVisualPool<CharacterVisual>();
  private readonly pooledVisuals = new PooledVisualLifecycle(this.visualPool, {
    farBakeGate: () => this.farBakeGate,
    maxPooled: () => GFX.maxPooledCharacterVisuals,
  });
  private objectPool = new Map<string, PooledObjectView[]>();
  private pooledObjectCount = 0;
  private prewarmDepthMaterials = new Map<string, THREE.MeshDepthMaterial>();
  private readonly canvas: HTMLCanvasElement;
  private unregisterWebGLContext: (() => void) | null = null;
  private unsubscribeCharacterAssetReady: (() => void) | null = null;
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
    this.questObjectHidden = makeQuestObjectGate(options);
    this.nameplateLayer = nameplateLayer;
    this.travelSpeedFx = new TravelSpeedFxPainter(nameplateLayer);
    // ?prep=legacy: admit every unit as before, while the ledger keeps learning
    // so a capture from the legacy arm still carries the costs to compare.
    if (gpuPrepMode() === 'legacy') this.gpuPrepBudget.setLegacy(true);
    setBuildSpanSink(this.buildLedger.record); // view-part:* spans: 'part' lane, out of the frame spend
    // biome-ignore format: Keep the established constructor body stable inside the failure guard.
    try {
    // Dev-channel build-phase telemetry (English, console.info, Release-silent):
    // the iPhone 17 Pro WebContent kill lands INSIDE this constructor, after
    // every preload completes, so localizing which build phase tips the memory
    // ceiling requires a marker between phases. Wall-clock only, no allocation.
    // Every segment also stamps a 'woc:load:renderer-ctor/<phase>' measure for
    // the boot profiler (window.__loadProfile), unconditionally: marks are
    // cheap and the profiler needs them on production-class devices too.
    const bdStart = performance.now();
    let bdLast = bdStart;
    const bd = (phase: string): void => {
      const now = performance.now();
      renderLoadMeasure(`renderer-ctor/${phase}`, bdLast, now);
      // Gated like [load-diag] and the residency table: dev browsers plus the
      // iOS WebKit profile under diagnosis, never the production web console.
      if (import.meta.env.DEV || GFX.iosMemoryProfile) {
        console.info(
          `[build-diag] ${phase} +${(now - bdLast).toFixed(0)}ms (total ${(now - bdStart).toFixed(0)}ms)`,
        );
      }
      bdLast = now;
    };
    // The scene root sits at identity forever; with matrixAutoUpdate on it
    // recomposes each frame and three's updateMatrixWorld force-cascades the
    // multiply through every auto-update descendant (r185 still bypasses the
    // dirty check), defeating the static-subtree freeze and the hidden-rig
    // gate below. Frozen root: auto-update children still recompose normally.
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
      // three's render() resets info per pass (since r185 at the top of the
      // pass, see draw_stats_core.ts header), so with the composer's multiple
      // passes every post-frame reader saw only the final fullscreen pass
      // (1 call/1 triangle).
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
    // Vista tiers push the far plane out to the whole-world envelope so the
    // far mesh has room; the classic 950 stays wherever the vista is off.
    // The near plane also steps out to 0.2 there: at near 0.1 the 24-bit
    // depth buffer resolves only a few units at the 3200u horizon, right
    // where the far mesh and the water apron run nearly coplanar along
    // distant coasts. The plan comes through the ONE far-field policy so
    // the vista can never enable on a profile the sprite arm rejects.
    this.farVista = activeFarFieldPolicy().vista;
    // Meadow continuum: bake the blade-cluster ground texture BEFORE any
    // terrain material builds (near splat and far tiles both read the
    // singleton at material-build time). A few milliseconds, once per
    // session. Gated on the same predicate that picks the near splat
    // material: when the near terrain runs the Lambert arm (low tier, the
    // Advanced Terrain Detail=Low dial, or a failed splat-asset preload),
    // the far tiles must stay legacy too, or the horizon would be painted
    // meadow while the ground underfoot is not.
    if (GFX.terrainSplat && hasTerrainSplatAssets()) {
      try {
        setGrassGroundBake(bakeGrassGroundTexture(this.webgl, this.sim.cfg.seed));
      } catch {
        setGrassGroundBake(null); // headless/stub GL: keep the legacy ground
      }
    }
    bd('gl-init');
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_BASE_FOV,
      this.viewport.width / this.viewport.height,
      this.farVista.enabled ? 0.2 : 0.1,
      this.farVista.enabled ? this.farVista.cameraFar : 950,
    );
    // updateCamera owns the one explicit camera matrix refresh. Prevent each
    // WebGLRenderer pass from repeating it for an unchanged camera. r185 also
    // gates the camera's own compose on this flag, so every explicit refresh
    // goes through refreshFrozenWorldMatrix and every aim through lookAtFrozen
    // (a plain updateMatrixWorld/lookAt no longer composes a frozen node).
    this.camera.matrixWorldAutoUpdate = false;
    // Nameplate Three/DOM ownership lives in the painter; it reads the
    // viewport / mob-nameplate toggle lazily (the renderer reassigns viewport on
    // resize) and borrows the renderer's PvP reaction check.
    this.nameplatePainter = new NameplatePainter({
      views: this.views,
      camera: this.camera,
      world: this.sim,
      layer: this.nameplateLayer,
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
    setRenderCategory(this.umbralAnchorMarker.group, 'vfx');
    this.scene.add(this.umbralAnchorMarker.group);
    this.detailFogFar = (this.scene.fog as THREE.Fog).far;

    // The biome haze field, built BEFORE any surface that samples it (the
    // terrain layers, the water and the sky dome all gate their shader patch
    // on its existence at compile time, and buildSky below is the earliest
    // consumer). Sourced from this renderer's own outdoor fog presets plus
    // the light rig's intensity scales and the always-on precipitation table,
    // so the atmosphere a zone shows from across the world (colour, light
    // level, weather veil) is literally the one the player meets on entry.
    // Vista tiers only: the fogged arm already carries per-biome aerial
    // perspective in scene fog itself.
    if (this.farVista.enabled && !this.lowGfx) {
      const hazePresets = {} as Record<BiomeId, BiomeHazePreset>;
      for (const biome of Object.keys(Renderer.BIOME_FOG) as BiomeId[]) {
        const fog = Renderer.BIOME_FOG[biome];
        const light = Renderer.BIOME_LIGHT[biome];
        hazePresets[biome] = {
          color: fog.color,
          far: fog.far,
          light: hazeLightLevel(light.sunScale, light.hemiScale, light.envScale),
          precip: precipForBiome(biome) ?? undefined,
        };
      }
      ensureBiomeHazeField(hazePresets);
    }
    // The night light field must decide before any splat material compiles:
    // the terrain gates its shader patch on hasNightLightField() at compile
    // time (the biome-haze contract). Lamps, camp fires, and bodies register
    // their entries later, at their own build steps; the registry is read per
    // frame, not at compile.
    ensureNightLightField();

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
        // far covers the 560u dome; size 128 matches the 512-wide equirect
        // prefilters (cubeUV height is a program-cache-key input)
        const envRT = this.pmremGenerator.fromScene(envScene, 0.04, 0.1, 1100, { size: 128 });
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
    // Texel size from the REAL map size three will use: WebGLShadowMap scales
    // a requested mapSize down to the GPU's maxTextureSize at render time, so
    // an unclamped derivation would quantize to a fraction of a real texel on
    // a capped device and quietly lose the anti-swimming property.
    this.shadowTexelWorld = shadowTexelWorldSize(
      2 * S,
      Math.min(GFX.shadowMap, this.webgl.capabilities.maxTextureSize),
    );
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    // characters can self-cull only where they cast no sun shadow (low/lean tier)
    this.cullCharacters = !sun.castShadow;
    this.sunDir.copy(SUN_DIR);

    // visible sun disc + bloom halo. The sprite construction (cratered moon
    // face, HDR sun core that crosses the bloom threshold, corona + glare
    // streak) lives in celestial_sprites.ts; the renderer owns scene entry and
    // the per-frame aim/fade (updateCelestialSprites).
    const celestial = buildCelestialSprites(LOW_GFX);
    this.celestialSprites = celestial;
    this.sunSprites = celestial.sunSprites;
    this.moonSprites = celestial.moonSprites;
    for (const sp of [...this.sunSprites, ...this.moonSprites]) {
      setRenderCategory(sp, 'sky');
      this.scene.add(sp);
    }

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
    bd('sky-lights');
    this.terrainView = buildTerrain(this.sim.cfg.seed, {
      x: this.sim.player.pos.x,
      z: this.sim.player.pos.z,
    });
    setRenderCategory(this.terrainView.group, 'terrain');
    this.scene.add(this.terrainView.group);
    // Terrain chunks never move after build (the LOD update only toggles
    // visibility): stop their per-frame matrix recompose (static_matrix.ts).
    freezeStaticSubtreeMatrices(this.terrainView.group);
    // The far-vista layer: a whole-world coarse mesh built once across idle
    // slots (nearest tiles first), standing in for everything the detail
    // envelope does not reach. A no-op group when the vista is off.
    this.farTerrainView = buildFarTerrain(this.sim.cfg.seed, this.farVista, {
      x: this.sim.player.pos.x,
      z: this.sim.player.pos.z,
    });
    setRenderCategory(this.farTerrainView.group, 'terrain');
    this.scene.add(this.farTerrainView.group);
    // The curtained construction paths (boot, graphics rebuild) build the
    // far grid eagerly: it overlaps the curtain's own asset waits and the
    // vista stands before the reveal instead of tens of seconds into play
    // on a loaded production client. The editor viewport constructs live
    // Renderers with frames running and opts out (eagerFarVista false),
    // keeping its rebuilds on polite idle pacing.
    this.farVistaInitialBuild =
      options.eagerFarVista === false
        ? Promise.resolve()
        : this.farTerrainView.accelerateInitialBuild();
    bd('terrain');
    this.waterView = buildWater(this.sim.cfg.seed, this.webgl);
    setRenderCategory(this.waterView.group, 'water');
    this.scene.add(this.waterView.group);
    freezeStaticSubtreeMatrices(this.waterView.group); // water animates via uniforms, never transforms
    this.waterView.setWavesEnabled(this.waterRipplesEnabled);
    bd('water');

    this.foliage = buildFoliage(this.sim.cfg.seed, this.webgl);
    setRenderCategory(this.foliage.group, 'foliage');
    this.scene.add(this.foliage.group);
    bd('foliage');
    this.fish = buildFish(this.sim.cfg.seed, (x, z, radius, strength) => {
      this.waterView.addSplash(x, z, radius, strength);
      const level = waterLevelAt(x, z, this.sim.cfg.seed);
      if (Number.isFinite(level)) {
        this.vfx.waterSplash(x, level, z, radius, strength);
      }
    });
    setRenderCategory(this.fish.group, 'fish');
    this.scene.add(this.fish.group);
    this.fish.setCompileGate(
      this.asyncCompileSupported ? (root: THREE.Object3D) => this.compileGate(root) : null,
    );
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
    // the meadow-continuum blade band: the same clusters carried out to the
    // band radius over the painted ground (blade_grass_band.ts)
    this.bladeGrassBand = buildBladeGrassBand(
      this.sim.cfg.seed,
      this.sim.player.pos.x,
      this.sim.player.pos.z,
    );
    this.scene.add(this.bladeGrassBand.group);
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
    this.hollowGates = buildHollowGates(this.sim.cfg.seed);
    for (const staticFeature of [
      this.hollowGates,
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
    this.propsView = props;

    // Eastbrook's replacement town is a distinct, stable scene subtree. Its
    // six opaque building volumes stay individual for camera roof ghosting;
    // civic, market, fence, and wall geometry is initialization-batched.
    this.eastbrookTownView = buildEastbrookTownView(this.sim.cfg.seed);
    setRenderCategory(this.eastbrookTownView.group, 'props');
    this.scene.add(this.eastbrookTownView.group);
    freezeStaticSubtreeMatrices(this.eastbrookTownView.group);
    bd('eastbrook-town');

    // Fenbridge's replacement town is a separate built-in-only subtree. Its
    // seven buildings remain independent camera-fade targets; civic and
    // repeated palisade/gate/boardwalk geometry is initialization-batched.
    this.fenbridgeTownView = buildFenbridgeTownView(this.sim.cfg.seed);
    setRenderCategory(this.fenbridgeTownView.group, 'props');
    this.scene.add(this.fenbridgeTownView.group);
    freezeStaticSubtreeMatrices(this.fenbridgeTownView.group);
    bd('fenbridge-town');

    // First-reveal compile gates (hitch-hunt P3a): a cull flipping world
    // content visible for the first time holds it one representation back
    // (a far cell's near twin, or hidden for a fog band or a town's first
    // approach) until its programs are linked off-thread. Without async compile the
    // gate itself would be the synchronous stall, so the views stay ungated
    // there and keep their historical immediate reveal. Ordinary reveal
    // compiles ride BELOW the live entity gates (VISIBLE_PREWARM): a teleport
    // can queue dozens of far cells at once, and cosmetic scenery must never
    // delay an actionable mob or player reveal. An IMMINENT key rides higher.
    // A key's soft deadline comes from the budget's learned reveal cost: past
    // it the gate reports how much of the key linked and keeps waiting, so
    // only the hard watchdog ever reveals an unlinked root (reveal_gate.ts).
    if (this.asyncCompileSupported) {
      const revealHost = createRevealCompileHost({
        gate: (pieces, options) =>
          this.liveCompileGates.runPieces(pieces, VIEW_COMPILE_GATE_MAX_MS, options),
        compileColor: (target) => this.compilePrewarmColorPrograms(target, false),
        compileShadow: (target) => this.compileShadowPrograms(target),
        settle: pieceProgramSettle(this.webgl.properties, this.prewarmDepthMaterials),
        upload: (target, priority) => this.uploadGateTexturesGated(target, priority),
        touch: (target, priority, gate) => this.touchLinkedProgramsGated(target, priority, gate),
        predictRevealMs: () => this.gpuPrepBudget.predictMs(REVEAL_GATE_PREP_KIND),
        startAfterInitialPaint: () => this.initialGpuWorkStart,
      });
      this.propsRevealGate = createRevealGate(revealHost, (key) => this.propsView.revealRoots(key));
      this.propsView.setRevealGate(this.propsRevealGate);
      this.eastbrookTownView.setRevealGate(
        createRevealGate(revealHost, () => this.eastbrookTownView.staticRevealRoots()),
      );
      this.fenbridgeTownView.setRevealGate(
        createRevealGate(revealHost, () => this.fenbridgeTownView.staticRevealRoots()),
      );
      this.foliageRevealGate = createRevealGate(revealHost, (key) => this.foliage.revealRoots(key));
    }

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
    // updateVisibility toggles this group every frame AFTER the budget pass, so
    // its light has to ride the budget rather than stand permanently visible,
    // AND has to leave the group: a counted light whose ancestor the sweep hides
    // later in the same frame drops numPointLights for that frame.
    reparentStrandedLightsToScene(this.scene, this.jailScene.group);
    for (const light of this.jailScene.glowLights) this.fireLightAdopter.adopt(light);

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
    // After the mass hide above, so these adopt individually.
    for (const light of stationProps.fireLights) this.fireLightAdopter.adopt(light);
    bd('stations');

    // Town streetlamps: world-spanning dressing, so it is built here with the
    // rest of it rather than lazily per biome (every zone has a hub, so a
    // per-biome gate would build the whole set within a couple of zones anyway).
    // Each town is its own cull group, so only the town the player is standing
    // in submits draws; its point lights join the shared fire-light budget.
    this.streetlamps = buildStreetlamps(this.sim.cfg.seed);
    this.attachZoneFeature(this.streetlamps);
    // Warm ground pools under nearby characters after dark. Camera-band sized
    // and rewritten every frame from the entity loop, so it is NOT a zone
    // feature: it is a pooled overlay the sync loop fills.
    this.mobNightGlow = buildMobNightGlow();
    setRenderCategory(this.mobNightGlow.group, 'ui3d');
    this.scene.add(this.mobNightGlow.group);
    // Contact-blob grounding, and ONLY where the real shadow pass is off: on
    // those tiers a body has no contact cue whatsoever and reads as floating.
    // The tier is fixed for this renderer's lifetime (a graphics change tears
    // the Renderer down and builds a new one, see
    // src/game/graphics_rebuild_coordinator.ts), so the gate is settled once
    // here rather than re-read every frame, and there is no live toggle path.
    if (!GFX.dynamicShadows) {
      this.blobShadows = new BlobShadows();
      setRenderCategory(this.blobShadows.mesh, 'ui3d');
      this.scene.add(this.blobShadows.mesh);
    }
    // Ember pools at every authored campfire: static, so they bucket per zone
    // and ride the same distance cull as the lamps.
    this.emberPools = buildEmberPools(this.sim.cfg.seed);
    this.attachZoneFeature(this.emberPools);
    // Fire braziers at every mob camp without an authored campfire: a real
    // burning fixture, so a camp's light has a source you can walk up to. The
    // flames join the shared scenery-flame pass (freeze runs first, so their
    // matrixAutoUpdate is re-armed here, the stationProps pattern) and the
    // lights join the shared fire-light budget via attachZoneFeature.
    this.campBraziers = buildCampBraziers(this.sim.cfg.seed);
    this.attachZoneFeature(this.campBraziers);
    for (const flame of this.campBraziers.flames) flame.matrixAutoUpdate = true;
    this.flames.push(...this.campBraziers.flames);
    // Live fire for authored torch decor (the Gauntlet's fence lanterns):
    // flames on the shared scenery pass, ground light through the night
    // light field, no point lights (decor_torch_fx.ts).
    this.decorTorchFx = buildDecorTorchFx(this.sim.cfg.seed);
    this.attachZoneFeature(this.decorTorchFx);
    for (const flame of this.decorTorchFx.flames) flame.matrixAutoUpdate = true;
    this.flames.push(...this.decorTorchFx.flames);
    // The streamed wilderness layer (glow flora + fireflies) follows the camera
    // and rebuilds on a cell crossing, so it is NOT a zone feature.
    this.nightAccents = buildNightAccents(this.sim.cfg.seed);
    setRenderCategory(this.nightAccents.group, 'props');
    this.scene.add(this.nightAccents.group);
    bd('night-accents');
    // One residency table at the end of the build (dev console): where the
    // decoded bytes sit at exactly the point the iPhone 17 Pro is killed.
    // Scene first so shared buffers/images attribute to the live world, then
    // the caches so only their EXCLUSIVE retention shows as theirs. Gated to
    // dev browsers and the iOS WebKit profile under diagnosis: the walk
    // allocates identity sets over every buffer at the peak-memory instant,
    // which the production web population must not pay.
    if (import.meta.env.DEV || GFX.iosMemoryProfile) {
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
            { label: 'sky', textures: skyResidencyTextures() },
            {
              // The cost side of the KTX2 mip release: source bytes retained
              // for the context-loss re-transcode (the released mip chains
              // truthfully read ~0 in the texture walks above). Pre-counted
              // here so residencyBudget stays a pure function of its sources.
              label: 'ktx2 restore sources',
              bytes: ktx2RetainedSourceBytes(),
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
      const level = waterLevelAt(x, z, this.sim.cfg.seed);
      if (Number.isFinite(level)) {
        this.vfx.waterSplash(x, level, z, radius, strength);
      }
    });
    // Meteor falls + Rune of Power circles (see src/render/mage_ground_fx.ts);
    // a landing meteor detonates with the same burst an aimed blast uses.
    this.mageGroundFx = new MageGroundFx(
      this.scene,
      (x, z) => groundHeight(x, z, this.sim.cfg.seed),
      (x, z, meteor) => {
        if (
          meteor.ability &&
          this.abilityVfx.handleSpellfxAt({
            x,
            z,
            school: 'fire',
            fx: 'nova',
            radius: meteor.radius,
            sourceId: meteor.sourceId,
            ability: meteor.ability,
          })
        ) {
          return;
        }
        const gy = groundHeight(x, z, this.sim.cfg.seed);
        this.vfx.burst(new THREE.Vector3(x, gy + 0.4, z), 'fire', 34, 1.4);
      },
    );
    this.warlockMeteorFx = new WarlockMeteorFx(
      this.scene,
      (x, z) => groundHeight(x, z, this.sim.cfg.seed),
      (impact) => {
        if (impact.kind !== 'infernal') return;
        this.abilityVfx.handleSpellfxAt({
          x: impact.x,
          z: impact.z,
          school: 'fire',
          fx: 'nova',
          radius: impact.radius,
          sourceId: impact.sourceId,
          ability: 'summon_infernal',
        });
      },
      undefined, // keep the deferred-loaded impact texture default
      {
        register: (light) => this.registerBudgetPointLight(light),
        release: (light) => this.releaseBudgetPointLight(light),
      },
    );
    this.necromancyGroundFx = new NecromancyGroundFx(this.scene, (x, z) =>
      groundHeight(x, z, this.sim.cfg.seed),
    );
    this.necromancyArmyPortalFx = new NecromancyArmyPortalFx(this.scene, (x, z) =>
      groundHeight(x, z, this.sim.cfg.seed),
    );
    this.abyssalRiftFx = new AbyssalRiftFx(this.scene, (x, z) =>
      groundHeight(x, z, this.sim.cfg.seed),
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
    this.paladinConsecrationVisuals = new PaladinConsecrationVisuals(this.scene, (x, z) =>
      groundHeight(x, z, this.sim.cfg.seed),
    );
    const fillVfxPose = (id: number, pose: VfxAnchorPose) => {
      const v = this.views.get(id);
      if (!v) return false;
      const e = this.sim.entities.get(id);
      const entityScale = e?.scale ?? 1;
      pose.x = v.group.position.x;
      pose.y = v.group.position.y;
      pose.z = v.group.position.z;
      pose.height = v.height * entityScale;
      // For local-offset resolves (the drain beams' familiar-side end): the
      // DISPLAYED yaw, so the offset tracks the body actually on screen.
      pose.yaw = v.group.rotation.y;
      pose.scale = entityScale;
      return true;
    };
    const vfxAnchor = createVfxAnchor(fillVfxPose);
    const offsetVfxAnchor = createOffsetVfxAnchor(fillVfxPose);
    bd('scene-misc');
    this.vfx = new Vfx(this.scene, vfxAnchor, offsetVfxAnchor);
    this.vfx.setViewportScale(this.webgl.domElement.clientHeight * this.webgl.getPixelRatio(), 60);
    this.bgFx = new BattlegroundFx(this.sim, this.views, this.vfx);
    this.underwaterView = new UnderwaterView(this.lowGfx);
    this.scene.add(this.underwaterView.group);
    this.abilityVfxFx = new AbilityVfxFx(
      this.scene,
      this.camera,
      vfxAnchor,
      (x, z) => groundHeight(x, z, this.sim.cfg.seed),
      // the DISPLAYED facing, not e.facing: the view group carries the smoothed
      // yaw actually on screen, so a stationary spirit lines up with the body it
      // is rising out of instead of with a pose one frame ahead of the draw
      (id) => this.views.get(id)?.group.rotation.y ?? this.sim.entities.get(id)?.facing ?? null,
    );
    this.abilityVfxFx.setViewportScale(
      this.webgl.domElement.clientHeight * this.webgl.getPixelRatio(),
      60,
    );
    this.abilityVfxFx.setSpiritBuildScheduler((build) => this.queueSpiritPuppetBuild(build));
    this.abilityVfxFx.setSpiritCompileGate(
      this.asyncCompileSupported ? (root: THREE.Object3D) => this.compileGate(root) : null,
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
    this.needleOfFateVfx = new NeedleOfFateVfx(
      this.scene,
      this.camera,
      (id, heightFraction, out) => {
        const view = this.views.get(id);
        const entity = this.sim.entities.get(id);
        if (!view || !entity || entity.dead) return false;
        const entityScale = entity.scale;
        out.set(
          view.group.position.x,
          view.group.position.y + view.height * entityScale * heightFraction,
          view.group.position.z,
        );
        return true;
      },
      this.lowGfx,
      (targetId) => this.pulseAt(targetId, 'shadow', 3.8, 0.28),
    );
    setRenderCategory(this.needleOfFateVfx.group, 'vfx');
    this.sentenceVfx = this.createSentenceVfx();
    setRenderCategory(this.sentenceVfx.group, 'vfx');

    bd('vfx');
    // Show-jumping racing line: self-scoped course guidance, hidden outside the
    // player's own race (driven per frame from world.mountRaceView() below).
    this.raceLine = new RaceLine(this.scene, this.groundSample);
    // Riding-lesson start platform: the glowing square behind the start arch.
    this.mountBeacon = new MountBeacon(this.scene, this.groundSample);
    // The Proving Shore's guidance: beacon fizz, route ribbon, target ring.
    this.islandGuidance = new IslandGuidance(this.scene, this.groundSample);

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

    bd('weather-post');
    window.addEventListener('resize', this.onViewportResize);
    window.addEventListener('orientationchange', this.onOrientationChange);
    window.visualViewport?.addEventListener('resize', this.onViewportResize);
    window.visualViewport?.addEventListener('scroll', this.onViewportResize);
    document.addEventListener('fullscreenchange', this.onViewportResize);
    // Moving the window to a display with a different scale factor fires no
    // resize event of its own when the CSS viewport size is unchanged, so the
    // backing store would keep the old ratio until something else resized.
    this.dprUnwatch = watchDevicePixelRatio(() => {
      if (!this.shutdownStarted) this.resizeViewport();
    });
    this.unsubscribeCharacterAssetReady = onCharacterAssetReady(this.onCharacterAssetReady);
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
    this.dprUnwatch?.();
    this.dprUnwatch = null;
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
    this.unsubscribeCharacterAssetReady?.();
    this.unsubscribeCharacterAssetReady = null;
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
    // Unbind this dome from the sky module's live-binding set, or a replaced
    // renderer's dome would pin its last biome pair against eviction forever.
    bestEffort(() => this.skyView?.dispose());
    for (const target of this.envRTs.values()) {
      bestEffort(() => target.dispose());
    }
    this.envRTs.clear();
    disposeRendererPrewarmAndGroundFx(this, bestEffort);
    for (const bubble of this.chatBubbles.values()) bestEffort(() => bubble.el.remove());
    this.chatBubbles.clear();
    for (const id of [...this.views.keys()]) bestEffort(() => this.removeView(id, true));
    this.views.clear();
    for (const visual of this.visualPool.drain()) bestEffort(() => visual.dispose());
    this.objectPool.clear();
    this.pooledObjectCount = 0;
    // The memoized weapon-skin emissive derivations are bounded, not
    // page-lifetime: every rig releases its reference on dispose (never
    // disposing the shared pair itself) and the cache evicts idle derivations
    // past its idle cap as the session runs. This terminal drain releases
    // whatever is still resident, or a megabyte-class texture pair per pinned
    // skin would ride a WebGL context recycle into the next context. Safe here
    // and only here, after every view (and every rig that borrowed them) is
    // torn down above. Best-effort like its neighbours: nothing in terminal
    // cleanup may abort the WebGL disposal below.
    bestEffort(() => this.weaponSkinApplies.clear());
    bestEffort(() => disposeWeaponEmissiveCache());
    this.clickTargets.length = 0;
    this.gatherNodeMeshes = [];
    this.viewLights.length = 0;
    // The nameplate painter owns the shared canvas and a document.fonts
    // listener; dispose it before clearing the layer so the listener never
    // outlives the renderer. Optional-chained like the siblings above because
    // the painter is built inside the constructor's guarded try, AFTER the
    // WebGL2 checks that can throw: the partial-construction cleanup arm
    // reaches here with it still unset.
    bestEffort(() => this.nameplatePainter?.dispose());
    // The layer is renderer-owned. Clearing it catches a pending DocumentFragment
    // batch or any renderer DOM surface added after the explicit maps above.
    bestEffort(() => this.nameplateLayer.replaceChildren());
    bestEffort(() => this.travelSpeedFx?.dispose());
    // Renderer-owned (not a module singleton): the graphics-rebuild teardown
    // comes through HERE (shutdown -> disposeRendererResources), so the blob
    // pool, texture and material release with the rest of the GPU state.
    bestEffort(() => this.blobShadows?.dispose());
    this.blobShadows = null;
    cleanupErrors.push(...(this.dungeons?.disposeAllInteriorResources().errors ?? []));
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

  private createSentenceVfx(injectedTextures?: AbilityVfxTextures): SentenceVfx {
    return new SentenceVfx(
      this.scene,
      this.camera,
      (id, heightFraction, out) => {
        const view = this.views.get(id);
        const entity = this.sim.entities.get(id);
        if (view) {
          const entityScale = entity?.scale ?? 1;
          out.set(
            view.group.position.x,
            view.group.position.y + view.height * entityScale * heightFraction,
            view.group.position.z,
          );
          return true;
        }
        if (!entity) return false;
        out.set(entity.pos.x, entity.pos.y + heightFraction * 2 * entity.scale, entity.pos.z);
        return true;
      },
      this.lowGfx,
      (sourceId, targetId, condemnation) =>
        this.sentenceImpactFeedback(sourceId, targetId, condemnation),
      injectedTextures,
    );
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

  private dprUnwatch: (() => void) | null = null;

  // Reused presentFrame host, refreshed field-by-field each sync (see the call
  // site): class-field init runs before the constructor assigns the real
  // surfaces, so only the constant watch is set here and nothing is read before
  // the first refresh.
  private readonly framePresentHost = {
    programWatch: liveProgramWatch,
  } as unknown as FramePresentHost;

  // Frames whose terminal draw actually submitted, counted at the one
  // presentFrame call site. Every other counter sits UPSTREAM of the sync
  // present argument, so this is the only evidence downstream of the skip
  // decision; the E2E probe (scripts/desktop_hidden_skip_probe.mjs) asserts
  // it freezes while hidden, which kills a forced-present mutation
  // deterministically instead of leaning on SwiftShader frame-rate collapse
  // (phase 4 QA F4).
  private presentedFrameCount = 0;

  /** Frames whose terminal draw actually submitted this session. */
  presentedFrames(): number {
    return this.presentedFrameCount;
  }

  /**
   * A display change the page cannot observe on its own (the window moved to
   * another monitor, or its scale factor changed). resizeViewport re-measures
   * and applyResolution re-reads window.devicePixelRatio live, so this is the
   * whole fix.
   */
  noteDisplayChanged(): void {
    if (!this.shutdownStarted) this.resizeViewport();
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

  /** Acceptance-capture-only visualization of canonical routes/colliders. */
  setFenbridgeCaptureOverlay(visible: boolean): void {
    this.fenbridgeTownView.setCaptureOverlay(visible);
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
    if (id === null) return true;
    // Sky residency is part of arrival readiness: a false routes the arrival
    // through prepareZoneAt's sky recovery branch (curtain, or idle pace).
    return zoneArrivalReady({
      prepared: this.preparedZones.has(id),
      programsPrewarmed: this.prewarmedZonePrograms.has(id),
      standardMaterials: GFX.standardMaterials,
      skyResident: () =>
        skyBiomesAt(x, z).every((biome) => this.skyView.skyBiomeAssetsResident(biome)),
    });
  }

  zoneStreamingStats(): ZoneStreamingStats {
    return {
      prepared: this.preparedZones.size,
      pending: this.pendingZonePrepares.size + this.visibleZonePrepareQueue.length,
      last: this.lastZonePrepareStats,
    };
  }

  // SkyKey, not BiomeId: envRTs, envBiome and skyView.envTexture are all keyed
  // by the wider sky key. The live callers still pass a zone biome (the two
  // place-keyed skies have never had a prefiltered environment of their own).
  private ensureEnvironmentBiome(biome: SkyKey): THREE.WebGLRenderTarget | null {
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
    // Every key the arrival can SEE, not just zone.biome: Farshore draws a
    // place-keyed dome whose zone key is another biome, and warming only that
    // key left the place dome its full 2K upload on first live bind. PMREM stays on zone.biome (place skies never had one).
    // The pin holds for the whole warm: an evict mid-warm would dispose a
    // texture about to be re-uploaded, minting GPU backing no store owns.
    const skyKeys = skyBiomesAt(x, z);
    const unpin = pinSkyBiomeAssets(skyKeys);
    try {
      await ensureSkyAssetsAt(x, z);
      if (!idlePace) {
        // Every non-idle caller (entry, teleport, the blocking sky recovery)
        // sits behind an opaque loading screen; the walked recovery is idle.
        this.ensureEnvironmentBiome(zone.biome);
        this.prewarmTexture(this.skyView.envTexture(zone.biome));
        for (const key of skyKeys) this.prewarmTexture(this.skyView.domeTexture(key));
        return;
      }
      // A texture upload is synchronous even from requestIdleCallback, and a
      // CompressedTexture has no row-addressable buffer to range over, so the
      // sky is ONE queued call rather than a DataTexture's row batches.
      await this.prewarmTextureInIdle(this.skyView.envTexture(zone.biome));
      // PMREM generation is indivisible in three (0.185 included). Defer two
      // timed-out callbacks before deliberately paying that single unit under
      // sustained load, rather than running it on the first forced callback.
      await idleSlot(IDLE_PREWARM_TIMEOUT_MS, { maxTimeoutDeferrals: 2 });
      await this.backgroundGpuWork.run(
        () => this.ensureEnvironmentBiome(zone.biome),
        GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        `pmrem:${zone.biome}`,
      );
      for (const key of skyKeys) await this.prewarmTextureInIdle(this.skyView.domeTexture(key));
    } finally {
      unpin();
    }
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
      // The zone build stays skipped, but its SKY may have been released while
      // the player was away (see updateSkyResidency): re-run the sky half only,
      // and return it so a blocking arrival (a teleport landing back in a realm
      // it visited hours ago) waits behind the loading screen for its dome
      // instead of arriving under the previous realm's frozen sky. Gated on
      // standardMaterials because the shadowless tiers never fetch HDRIs at
      // all: their stores stay empty by design, the residency predicate is
      // permanently false there, and this branch would re-run prepareZoneSky
      // on every arrival forever (review round 1; ensureSkyResidency guards
      // the same case on the recheck lane). Progress completes only after the
      // dome work it now awaits, so a blocking arrival's loading bar cannot
      // sit at 100 percent while the sky loads.
      if (
        zoneId !== null &&
        GFX.standardMaterials &&
        !skyBiomesAt(x, z).every((biome) => this.skyView.skyBiomeAssetsResident(biome))
      ) {
        return this.prepareZoneSky(zoneAt(x, z), x, z, opts?.pace === 'idle').then(() => {
          onProgress?.(1, 1);
        });
      }
      onProgress?.(1, 1);
      return Promise.resolve();
    }
    const pending = this.pendingZonePrepares.get(zoneId);
    if (pending) {
      // A gating caller (teleport, login) joining a background prepare must
      // not wait at idle pace behind the loading screen.
      if (opts?.pace !== 'idle') this.terrainView.escalateZone(zoneId);
      return pending;
    }
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
      // Both arms: the colour variant AND the shadow-pass depth variant of the
      // zone's casters, so the sun pass never links either at first draw.
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
                  () =>
                    this.compilePrewarmColorPrograms(obj, false).then(() =>
                      this.compileShadowPrograms(obj),
                    ),
                  GPU_WORK_PRIORITY.VISIBLE_PREWARM,
                  `zone-prepare-compile:${obj.name || obj.type}`,
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
      this.lastZonePrepareStats = reportZonePrepare(zone.id, this.buildLedger, {
        started,
        skyMs,
        terrainStarted,
        terrainDone,
        waterDone,
        featuresDone,
        prepareDone,
      });
      onProgress?.(100, 100);
    })().finally(() => this.pendingZonePrepares.delete(zoneId));
    this.pendingZonePrepares.set(zoneId, task);
    return task;
  }

  /** Stage wall-times of the most recent prewarmZoneAt, for perf tooling. */
  lastZonePrewarmStats: ZonePrewarmStats | null = null;

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
                `zone-prewarm-color:${childRoot.name || childRoot.type}`,
              );
              await this.backgroundGpuWork.run(
                () => this.compileShadowPrograms(childRoot),
                GPU_WORK_PRIORITY.VISIBLE_PREWARM,
                `zone-prewarm-shadow:${childRoot.name || childRoot.type}`,
              );
            },
            prepareChildAssets: (child) => {
              this.prewarmObjectTextures(child as THREE.Object3D);
            },
            // Decomposed upload: a whole-child bounded render was a measured
            // 100-345ms main-thread unit (texture decode+upload dominating).
            // Pre-upload the child's textures in small batches through their
            // own arbiter units, then the bounded render only pays geometry
            // upload plus the raster warm.
            warmChildUnits: (groupLike, child) => {
              const group = groupLike as THREE.Group;
              const childRoot = child as THREE.Object3D;
              const units: { label: string; run: () => void }[] = [];
              const textures = [...collectObjectTextures(childRoot, false)];
              for (let i = 0; i < textures.length; i += PREWARM_TEXTURE_UNIT_BATCH) {
                const batch = textures.slice(i, i + PREWARM_TEXTURE_UNIT_BATCH);
                units.push({
                  label: 'zone-prewarm-tex',
                  run: () => {
                    for (const texture of batch) this.webgl.initTexture(texture);
                  },
                });
              }
              units.push({
                label: `zone-prewarm-render:${childRoot.name || childRoot.type}`,
                run: () => this.renderBoundedPrewarmRoot(group, childRoot),
              });
              return units;
            },
            renderWarmPass: () => {
              tCompile = performance.now();
              this.renderPrewarmPass(1 / 60, { offscreen: true });
            },
            runUpload: (work, label) =>
              this.backgroundGpuWork.run(
                work,
                GPU_WORK_PRIORITY.VISIBLE_PREWARM,
                label ?? 'zone-prewarm-upload',
              ),
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
        for (const item of mobPrewarm.pooled) this.pooledVisuals.store(item.key, item.visual);
        for (const item of npcPrewarm.pooled) this.pooledVisuals.store(item.key, item.visual);
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
    const zones = zonesWithinStreamingHorizon(this.sim.cfg.world?.zones ?? ZONES, x, z, radius);
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
    const currentZoneId = this.zoneIdAt(player.pos.x, player.pos.z);
    if (this.fogState !== 'outdoor' || currentZoneId === null) {
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
    this.evictFarZoneIfConstrained(currentZoneId, player.pos.x, player.pos.z);
    // Same cadence, opposite direction: the per-biome sky stores are unbounded
    // without an eviction pass, and this is the one place that already knows
    // the camera moved far enough to reconsider zone residency.
    this.skyResidency.updateSkyResidency(cameraX, cameraZ);
    const forwardX = this.cameraLookAt.x - cameraX;
    const forwardZ = this.cameraLookAt.z - cameraZ;
    // The ACTIVE world's zones, never the module list.
    this.visibleZonePrepareQueue = zonesWithinStreamingHorizon(
      this.sim.cfg.world?.zones ?? ZONES,
      cameraX,
      cameraZ,
      horizon,
      forwardX,
      forwardZ,
    ).filter((zone) => !this.preparedZones.has(zone.id) && !this.pendingZonePrepares.has(zone.id));
    this.pumpVisibleZonePrepareQueue();
  }

  // Thin consumer of zone_eviction_core.ts's zonesEligibleForEviction; no-op on unconstrained hosts.
  private evictFarZoneIfConstrained(currentZoneId: string, playerX: number, playerZ: number): void {
    if (!GFX.constrainedMemory) return;
    const zoneId = zonesEligibleForEviction(
      this.sim.cfg.world?.zones ?? ZONES,
      this.preparedZones,
      currentZoneId,
      playerX,
      playerZ,
    )[0];
    if (!zoneId) return;
    const zone = (this.sim.cfg.world?.zones ?? ZONES).find((z) => z.id === zoneId);
    if (!zone) return;
    this.terrainView.unloadZone(zone);
    this.waterView.unloadZone(zone.id);
    this.preparedZones.delete(zoneId);
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
  private zoneFeatureGroups: {
    group: THREE.Group;
    footprint: FeatureFootprint | null;
    /** Whether this group currently casts into the sun shadow map. */
    shadowCasting: boolean;
    /** Meshes that carried castShadow at the first far flip, for restore. */
    shadowCasters: THREE.Mesh[] | null;
  }[] = [];

  private attachZoneFeature(
    view: { group: THREE.Group; glowLights?: THREE.PointLight[]; cullGroups?: THREE.Group[] },
    freeze = true,
  ): void {
    setRenderCategory(view.group, 'props');
    // Attach hidden until the live gate links the group's programs (the same
    // contract as dungeon interiors): a lazily built biome feature otherwise
    // links its freshly minted materials synchronously on its first visible
    // frame. Registration into the fog-cull sweep is deferred to the reveal,
    // because updateZoneFeatureVisibility writes .visible every frame and
    // would flip the hidden group back on mid-compile.
    const gate = this.asyncCompileSupported
      ? (target: THREE.Object3D) => this.compileGate(target)
      : undefined;
    const attached = attachSceneGroupGated(this.scene, view.group, gate);
    // Point lights ride the fireLights budget, NEVER the cull-toggled group
    // (fire_light_registry.ts carries the why).
    reparentStrandedLightsToScene(this.scene, view.group);
    if (freeze) freezeStaticMatrices(view.group);
    // adoptFireLight, not a bare push: a feature attaches from a zone-prepare
    // continuation, so its glow lights would otherwise be visible and unranked
    // for the frames until the next budget pass.
    for (const light of view.glowLights ?? []) this.fireLightAdopter.adopt(light);
    this.lastAttachedFeatureGroups.push(view.group);
    // A view spanning several regions registers each child for the distance
    // cull instead of the whole group: one world-wide footprint can never be
    // culled (water-flora was 10.96M triangles submitted from every realm).
    const registerCullGroups = (): void => {
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
          shadowCasting: true,
          shadowCasters: null,
        });
      }
    };
    if (!gate) {
      registerCullGroups();
      return;
    }
    const generation = this.lifecycleGeneration;
    void attached.then(() => {
      if (this.shutdownStarted || generation !== this.lifecycleGeneration) return;
      registerCullGroups();
    });
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
      // Shadow casting stops far before the fogless detail horizon: the merged
      // feature meshes disable frustum culling, so the shadow pass would
      // otherwise redraw whole neighbour towns that cannot land one texel in
      // the 105 yd shadow volume. Per-mesh writes only on a state flip.
      const casting = isZoneFeatureShadowCasting(entry.footprint, camX, camZ, entry.shadowCasting);
      if (casting !== entry.shadowCasting) {
        entry.shadowCasting = casting;
        if (!casting && !entry.shadowCasters) {
          const casters: THREE.Mesh[] = [];
          entry.group.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (mesh.isMesh && mesh.castShadow) casters.push(mesh);
          });
          entry.shadowCasters = casters;
        }
        for (const mesh of entry.shadowCasters ?? []) mesh.castShadow = casting;
      }
    }
  }

  private ensureZoneFeatures(zone: ZoneDef): void {
    switch (zone.biome) {
      case 'dusk':
        if (!this.realmFlora) {
          this.realmFlora = this.timedBuild('buildRealmFlora', buildRealmFlora);
          this.attachZoneFeature(this.realmFlora);
          // the freeze above stills the whole subtree; foam swell and mist
          // drift move via object transforms, so they get their motion back
          // (the props.flames idiom)
          for (const moving of this.realmFlora.animated) moving.matrixAutoUpdate = true;
        }
        break;
      case 'ember':
        if (!this.emberFeatures) {
          this.emberFeatures = this.timedBuild('buildEmberFeatures', buildEmberFeatures);
          this.attachZoneFeature(this.emberFeatures);
        }
        if (!this.castleFeatures) {
          this.castleFeatures = this.timedBuild('buildCastleFeatures', buildCastleFeatures);
          this.attachZoneFeature(this.castleFeatures);
        }
        if (!this.bulwarkFeatures) {
          this.bulwarkFeatures = this.timedBuild('buildBulwarkFeatures', buildBulwarkFeatures);
          this.attachZoneFeature(this.bulwarkFeatures);
        }
        break;
      case 'frost':
        if (!this.frostSky) {
          this.frostSky = this.timedBuild('buildFrostSky', buildFrostSky);
          this.attachZoneFeature(this.frostSky, false);
        }
        break;
      case 'fen':
        if (!this.fenFeatures) {
          this.fenFeatures = this.timedBuild('buildFenFeatures', buildFenFeatures);
          this.attachZoneFeature(this.fenFeatures);
        }
        break;
      case 'amber':
        if (!this.amberFeatures) {
          this.amberFeatures = this.timedBuild('buildAmberFeatures', buildAmberFeatures);
          this.attachZoneFeature(this.amberFeatures);
        }
        break;
      case 'night':
        if (!this.nightFeatures) {
          this.nightFeatures = this.timedBuild('buildNightFeatures', buildNightFeatures);
          this.attachZoneFeature(this.nightFeatures);
        }
        break;
      case 'haunt':
        if (!this.hauntFeatures) {
          this.hauntFeatures = this.timedBuild('buildHauntFeatures', buildHauntFeatures);
          this.attachZoneFeature(this.hauntFeatures, false);
        }
        break;
      case 'jungle':
        if (!this.jungleFeatures) {
          this.jungleFeatures = this.timedBuild('buildJungleFeatures', buildJungleFeatures);
          this.attachZoneFeature(this.jungleFeatures);
        }
        break;
      case 'garden':
        if (!this.gardenFeatures) {
          this.gardenFeatures = this.timedBuild('buildGardenFeatures', buildGardenFeatures);
          this.attachZoneFeature(this.gardenFeatures);
        }
        if (!this.dawnholdFeatures) {
          this.dawnholdFeatures = this.timedBuild('buildDawnholdFeatures', buildDawnholdFeatures);
          this.attachZoneFeature(this.dawnholdFeatures);
        }
        break;
      case 'gale':
        if (!this.galeFeatures) {
          this.galeFeatures = this.timedBuild('buildGaleFeatures', buildGaleFeatures);
          this.attachZoneFeature(this.galeFeatures, false);
        }
        break;
      default:
        break;
    }
  }

  // Times one zone feature builder under `zone:features:<name>`; every builder
  // takes the world seed (the seedless ones ignore it).
  private timedBuild<T>(name: string, build: (seed: number) => T): T {
    const started = performance.now();
    const built = build(this.sim.cfg.seed);
    this.buildLedger.record(`zone:features:${name}`, performance.now() - started, started);
    return built;
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
    this.effectiveRenderScale = initialEffectiveRenderScale(
      this.renderScale,
      this.isMobileRuntime(),
      urlForcedTier(),
    );
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
    resetShadowCadence(this.shadowCadence);
    this.applyShadowCadence();
    this.applyResolution();
  }

  private isMobileRuntime(): boolean {
    return document.body.classList.contains('mobile-touch');
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
    this.paladinConsecrationVisuals.setQuality(state.levels.vfx);
    this.abilityVfx.setQuality(state.levels.vfx);
    this.necromancyArmyPortalFx.setQuality(state.levels.vfx);
    this.abyssalRiftFx.setQuality(state.levels.vfx);
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

  perfStats(): RendererPerfStats {
    const info = this.webgl.info;
    const renderBudget = this.renderBudgetGovernor.state();
    const drawStatsFrame = this.drawStats ? this.drawStats.currentFrame() : null;
    return {
      graphicsConfigVersion: GFX.graphicsConfigVersion,
      tier: GFX.tier,
      currentZoneId: this.zoneIdAt(this.sim.player.pos.x, this.sim.player.pos.z),
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
          iosMemoryProfile: GFX.iosMemoryProfile,
        },
      },
      autoGovernor: GFX.autoGovernor,
      budget: GFX.budget,
      renderScale: this.renderScale,
      effectiveRenderScale: this.effectiveRenderScale,
      renderBudget,
      // Whether the budget-governed shadow cadence is currently shedding to
      // every-other-frame updates: surfaced so the ?perf overlay and capture
      // artifacts can tell a half-rate sample from a full-rate one.
      shadowCadenceHalfRate: this.shadowCadence.halfRate,
      pixelRatio: this.webgl.getPixelRatio(),
      width: this.viewport.width,
      height: this.viewport.height,
      // Composer tiers serve the accumulated per-frame delta (the live counter is
      // monotonic there, so it already includes the off-screen water-simulation
      // passes); other profiles keep the live post-frame read, where three's
      // per-render auto-reset drops those passes, so add them back at 1 draw call
      // and 2 triangles each. (Since r185 that live read would also include
      // the shadow pass; empty on every shipped direct profile, which never
      // enables dynamic shadows, pinned in tests/gfx.test.ts.)
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
      pooledVisuals: this.visualPool.size,
      foliage: this.foliage.perfStats(),
      glVendor: this.glVendor,
      glRenderer: this.glRenderer,
      contextLost: this.contextLostCount,
      contextRestored: this.contextRestoredCount,
      nightAmount: Math.round(this.dnGlobalNight * 100) / 100,
      phaseMs: this.rendererPhaseStats(),
      renderDiagnostics: this.lastFrameStats.renderDiagnostics,
      lastFrame: snapshotRendererFrameStats(this.lastFrameStats),
      prewarm: this.lastPrewarmStats,
      entryDetailHorizon: this.entryDetailHorizon.snapshot(),
      gpuQueue: this.backgroundGpuWork.stats(),
      gpuPrep: { budget: this.gpuPrepBudget.snapshot(), events: gpuPrepEventsSnapshot() },
      buildLedger: this.buildLedger.snapshot(),
      lookPieces: lookPiecesStats(),
      zoneStreaming: this.zoneStreamingStats(),
    };
  }

  /** Diagnostic-only lifecycle boundary, called immediately before curtain fade. */
  markGpuHitchReveal(): void {
    this.gpuHitchCompileLifecycle?.markReveal();
    markPrewarmPacingReveal(this.gpuHitchPacing, this.lastPrewarmStats);
    liveProgramWatch.armLiveProgramWatch(this.webgl);
  }

  /** Contract the entry-only detail field while the loading cover still owns presentation. */
  private installSceneryRevealGates(): void {
    this.propsView.setBandRevealGate(this.propsRevealGate);
    this.foliage.setRevealGate(this.foliageRevealGate);
  }

  /** Contract the entry-only detail field while the loading cover still owns presentation. */
  armEntryDetailHorizon(): void {
    this.detailFogFar = this.entryDetailHorizon.arm(this.detailFogFar, this.farVista.enabled);
  }

  /** Overlay-gated hitch correlation: enabled by the ?perf monitor only. */
  setHitchLogEnabled(enabled: boolean): void {
    if (this.hitchLogEnabled && !enabled) {
      this.hitchTracker.reset();
      this.hitchAligner.reset();
    }
    this.hitchLogEnabled = enabled;
  }

  /** Clears retained renderer costs at the boundary of a user-requested diagnostics scan. */
  resetDiagnosticSamples(): void {
    for (const samples of Object.values(this.phaseSamples)) samples.clear();
    this.hitchTracker.reset();
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
    // the logical-frame session, so they must not be counted twice. Since
    // r185 the live read would include the shadow pass too (r165 excluded
    // it), but every shipped direct profile also disables dynamic shadows
    // (low tier and the iOS memory profile; pinned in tests/gfx.test.ts), so
    // the governor signal did not move; only a dev override pairing
    // composer:false with shadows on would see the shadow-inclusive read.
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
    // Pressure follows the governor: while it is shedding quality, cosmetic
    // preparation waits. The budget's frame boundary is fed in sync() instead,
    // where it lands on every frame rather than only on a presented one.
    this.gpuPrepBudget.notePressure(state.mode === 'degrading');
    this.frameMsEma = state.frameMsEma;
    this.adaptiveCooldown = state.cooldownSeconds;
    this.stableFrameTime = state.stableSeconds;
    if (this.adaptiveGrace > 0) this.adaptiveGrace = Math.max(0, this.adaptiveGrace - dt);
    this.applyRenderBudgetState(state);
    updateShadowCadence(this.shadowCadence, dt, state.pressure, state.enabled);
    this.applyShadowCadence();
  }

  /** Write the cadence plan onto three's shadowMap flags. Runs at the top of
   *  sync(), before the frame's render; the bounded prewarm saves/restores
   *  BOTH flags around its renders and the per-frame re-assert here makes
   *  every restore self-healing. An out-of-band render between this write
   *  and the frame render (renderPrewarmPass, the census probe's frozen
   *  pass) can consume a pending needsUpdate; the cost is at most one extra
   *  frame of shadow staleness on those bounded dev/startup paths, never a
   *  lost update in steady state. */
  private applyShadowCadence(): void {
    if (!this.sun.castShadow) return;
    const shadowMap = this.webgl.shadowMap;
    const autoUpdate = !this.shadowCadence.halfRate;
    if (shadowMap.autoUpdate !== autoUpdate) shadowMap.autoUpdate = autoUpdate;
    // Under half rate three skips the pass when both flags are false and
    // clears needsUpdate after each rendered pass, so the every-other-frame
    // arm is exactly this write.
    if (!autoUpdate && this.shadowCadence.renderThisFrame) shadowMap.needsUpdate = true;
  }

  private runtimeViewCreateBudget(dt: number): number {
    const input = this.viewCreateBudgetInput;
    input.lowGfx = this.lowGfx;
    input.constrainedMemory = GFX.constrainedMemory;
    input.entryElapsedMs = this.runtimeEntryElapsedMs;
    input.dt = dt;
    input.frameMsEma = this.frameMsEma;
    input.dropFrameMs = GFX.budget.dropFrameMs;
    return runtimeViewCreateBudget(input, this.viewCreateBudgetState);
  }

  private collectMissingViewCandidates(
    center: Entity,
    rangeSq: number,
    includeRequired: boolean,
  ): void {
    let count = 0;
    const questLog = this.sim.questLog;
    for (const e of this.sim.entities.values()) {
      if (this.views.has(e.id)) continue;
      if (!entityViewIsAdmitted(e, questLog, this.questObjectHidden)) continue;
      const required = e.id === center.id || e.id === center.targetId;
      if (required && !includeRequired) continue;
      const d2 = entityViewDistanceSq(e, center);
      if (!required && d2 > rangeSq && !isDistanceCullExemptObject(e)) continue;
      writeViewCandidate(
        this.viewCandidatePool,
        this.viewCandidates,
        count,
        e.id,
        d2,
        entityViewCandidatePriority(e, center, d2),
      );
      count++;
    }
    finishViewCandidates(this.viewCandidates, count);
  }

  private createRequiredView(id: number | null, createdViewTypes: string[]): number {
    if (id === null) return 0;
    const e = this.sim.entities.get(id);
    if (!e || this.views.has(e.id)) return 0;
    if (!entityViewIsAdmitted(e, this.sim.questLog, this.questObjectHidden)) return 0;
    if (!this.viewCreateRetry.canAttempt(e.id, 'view', performance.now())) return 0;
    this.createView(e);
    sampleCreatedViewType(createdViewTypes, e);
    return 1;
  }

  private createRequiredViews(player: Entity, createdViewTypes: string[]): number {
    return (
      this.createRequiredView(player.id, createdViewTypes) +
      this.createRequiredView(player.targetId, createdViewTypes)
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
        this.createView(entity, undefined, true);
        view = this.views.get(entity.id);
        if (view) {
          sampleCreatedViewType(createdViewTypes, entity);
          created++;
        }
      }
      if (view?.compileReady) compileWaits.push(view.compileReady);
    }
    // Entry-required gates bypass the post-paint barrier awaited by this manifest.
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
  ): { created: number; trimmed: boolean } {
    const limit = Math.min(PERSISTENT_PORTAL_VIEW_PREWARM_LIMIT, Math.max(0, Math.floor(maxViews)));
    let created = 0;
    let trimmed = false;
    for (const e of this.sim.entities.values()) {
      // Either stop with entities unexamined is planned work left undone, so
      // BOTH arms report trimmed, the same rule createCandidateViews applies:
      // the deadline is a wall-clock trim and the shared view cap is a policy
      // trim (a capped scan must never masquerade as completed in the prewarm
      // summary). A scan that examines every entity exits the loop normally
      // and stays untrimmed.
      if (created >= limit) {
        trimmed = true;
        break;
      }
      if (performance.now() >= deadlineMs) {
        trimmed = true;
        break;
      }
      if (!isPersistentPortalObject(e) || this.views.has(e.id)) continue;
      this.createView(e);
      sampleCreatedViewType(createdViewTypes, e);
      created++;
    }
    return { created, trimmed };
  }

  private createCandidateViews(
    limit: number,
    createdViewTypes: string[],
    deadlineMs = Infinity,
    deferLooks = false,
  ): { created: number; trimmed: boolean } {
    const max = Math.max(0, Math.floor(limit));
    let created = 0;
    let trimmed = false;
    for (const candidate of this.viewCandidates) {
      // Either stop with candidates unexamined is planned work left undone,
      // so BOTH report trimmed: the deadline is a wall-clock trim, and the
      // view cap is a policy trim (a capped scan must never masquerade as
      // completed in the prewarm summary). A scan that examines every
      // candidate exits the loop normally and stays untrimmed.
      if (created >= max) {
        trimmed = true;
        break;
      }
      if (performance.now() >= deadlineMs) {
        trimmed = true;
        break;
      }
      const e = this.sim.entities.get(candidate.id);
      if (!e || this.views.has(e.id)) continue;
      // a recent failed build (assets unavailable) sits out its cooldown so it
      // cannot burn a budget slot every frame
      if (!this.viewCreateRetry.canAttempt(e.id, 'view', performance.now())) continue;
      if (deferLooks) this.createViewDeferringLook(e);
      else this.createView(e);
      sampleCreatedViewType(createdViewTypes, e);
      created++;
    }
    return { created, trimmed };
  }

  /** The live-frame build (characters/look_pieces.ts): a candidate whose
   *  composed look is not resident builds now WITHOUT its face decals (the
   *  body is the stand-in), its pieces enqueued, and the decals attach through
   *  the compile gate once they land. The local target builds whole now
   *  (actionable), and a covered frame keeps the synchronous build. */
  private createViewDeferringLook(e: Entity): void {
    const pieces =
      e.id === this.sim.player.targetId || arrivalCoverActive()
        ? null
        : composedLookPiecesOf(e, this.backgroundGpuWork, GPU_WORK_PRIORITY.LIVE_VIEW);
    if (!pieces || pieces.ready) {
      this.createView(e);
      return;
    }
    this.createView(e, { deferDecals: true });
    const visual = this.views.get(e.id)?.visual;
    if (!visual) return;
    pieces.attachWhenReady(`${e.id}`, () => {
      if (this.views.get(e.id)?.visual === visual) visual.attachDeferredDecals();
    });
  }

  private createCharacterVisualWithRetry(
    e: Entity,
    slot: string,
    formKey?: 'form_sheep' | 'form_bear' | 'form_cat' | 'form_travel' | 'form_metamorph',
    opts?: AssembleOptions,
  ): CharacterVisual | null {
    const now = performance.now();
    if (!this.viewCreateRetry.canAttempt(e.id, slot, now)) return null;
    const visual = createCharacterVisual(e, formKey, opts);
    if (visual) {
      this.viewCreateRetry.markSucceeded(e.id, slot);
      visual.setFarBakeGate(this.farBakeGate);
    } else this.viewCreateRetry.markFailed(e.id, slot, now);
    return visual;
  }

  // A composed body's far LOD (and a re-skinned far set) is minted AFTER the
  // view's creation gate walked the rig, so it linked cold at first draw (the
  // prod 100-160 ms far-crossing stalls). The visual owns that reveal through
  // per-frame flags, so it gets the gate as a callback, one bake at a time.
  private readonly farBakeLane = new SerialGateLane();
  private readonly farBakeGate: FarBakeGate = (target, onSettled) =>
    this.farBakeLane.enqueue((settled) => this.gateSwapFlagOnCompile(target, settled), onSettled);

  /** Build one lazy FORM rig into its view slot. A null build leaves the slot
   *  unset; the shared gate retries after its cooldown. A freshly built form
   *  root is exactly a brand-new rig's materials linking for the first time
   *  (same as a race/mech base-visual swap), so it is gated the same way instead
   *  of freezing the frame the form lands on (#2571). Metamorphosis is the one
   *  form that does not gate: it grows out of the body it replaces. */
  private buildFormVisual(
    e: Entity,
    v: EntityView,
    formKey: 'form_sheep' | 'form_bear' | 'form_cat' | 'form_travel' | 'form_metamorph',
    slot: 'sheepVisual' | 'bearVisual' | 'catVisual' | 'travelVisual' | 'metamorphVisual',
    gateCompile: boolean,
  ): void {
    const built = this.createCharacterVisualWithRetry(e, formKey, formKey);
    if (!built) return;
    v[slot] = built;
    v.group.add(built.root); // group.scale already carries e.scale
    // The encounter mark lands on whichever body is ACTIVE, and a form rig keys
    // its own Soul Rend programs (other meshes, other skinning): it cannot
    // inherit the base rig's warmed variant.
    encounterPrewarm.queueLiveSoulRendPrewarm(this, built, null, e.kind);
    if (!gateCompile) return;
    v.formCompilePending = built.root;
    this.gateSwapFlagOnCompile(built.root, () => {
      v.formCompilePending = settlePendingSwap(v.formCompilePending, built.root);
    });
  }

  private prewarmWorldFrame(dt: number): void {
    const p = this.sim.player;
    this.time += dt;
    sharedUniforms.uTime.value = this.time;
    // the paint-free carpet ring the terrain splat reads (see terrain.ts)
    sharedUniforms.uCarpetRing.value.set(p.pos.x, p.pos.z, GFX.bladeCarpetRadius);
    this.tmpV.set(p.pos.x, p.pos.y, p.pos.z);
    this.updateCamera(this.tmpV, dt);
    this.updateAmbience(p.pos.x, this.camera.position.y, dt);
    this.updateUnderwater(dt);
    this.budgetFireLights(p.pos.x, p.pos.z);
    const fogFar = this.subsystemCullFar();
    // The foliage handoff keys off distance planes (foliage_impostor_core.ts /
    // foliage_lod.ts); with the vista on, the near plane pairs with the CAPPED
    // far the foliage culls against, never scene fog.
    const fogNear =
      this.vistaLive() && this.fogState === 'outdoor'
        ? Math.min((this.scene.fog as THREE.Fog).near, fogFar * 0.55)
        : (this.scene.fog as THREE.Fog).near;
    const projectionPixels = projectionScalePixels(
      this.camera.projectionMatrix.elements[5],
      this.renderPixelHeight,
    );
    this.lastWaterSimulationPasses = this.waterView.update(
      this.time,
      this.camera.position.x,
      this.camera.position.z,
      fogFar,
      this.camera.position.y,
    );
    this.terrainView.update(this.camera.position.x, this.camera.position.z, fogFar);
    this.farTerrainView.update(
      this.camera.position.x,
      this.camera.position.z,
      fogFar,
      this.viewFar(),
      this.fogState === 'outdoor',
    );
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
    this.fenbridgeTownView.update(
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
      this.vistaLive() && this.fogState === 'outdoor'
        ? this.farVista.envelopeFar * 0.9
        : this.lastRequestedFogNear,
      this.vistaLive() && this.fogState === 'outdoor'
        ? this.farVista.envelopeFar
        : this.lastRequestedFogFar,
      projectionPixels,
      dt,
      this.reducedMotion(),
    );
    this.fish.update(p.pos.x, p.pos.z, dt);
    this.abilityVfx.update(dt, this.reducedMotion());
    this.vfx.update(dt);
    this.vfx.prepareDraw(this.camera);
    this.needleOfFateVfx.update(dt, this.reducedMotion());
    this.sentenceVfx.update(dt, this.reducedMotion());
    this.frozenOrbFx.update(dt);
    this.mageGroundFx.update(dt);
    this.warlockMeteorFx.update(dt, this.reducedMotion());
    // The meteor fx registers and releases budget lights AFTER the pass (a
    // landing frees the visible fall light), which would dip the pinned
    // visible count for this frame, and numPointLights is in every lit
    // material's program cache key. Re-run the budget, pads included.
    if (this.lightRankDirty) this.budgetFireLights(p.pos.x, p.pos.z);
    this.necromancyGroundFx.update(dt, this.reducedMotion());
    this.necromancyArmyPortalFx.update(dt, this.reducedMotion());
    this.abyssalRiftFx.update(dt, this.reducedMotion());
    this.ringOfFrostVisuals.sync(this.sim.activeFrostRings);
    this.ringOfFrostVisuals.update(dt);
    if (this.riftDeathZoneVisuals) {
      this.riftDeathZoneVisuals.sync(this.sim.riftBossDeathZones());
      this.riftDeathZoneVisuals.update(dt);
    }
    this.temporalHourglassGroundVisuals.sync(this.sim.activeTemporalHourglasses);
    this.temporalHourglassGroundVisuals.update(dt);
    this.paladinConsecrationVisuals.sync(this.sim.activeConsecrations);
    this.paladinConsecrationVisuals.update(dt, this.reducedMotion());
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
    }
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    // The dome rides the camera, so it serves every open-air state: the
    // overworld, Wildheart's field, and the Thornhollow Fields hollow (hiding
    // it there left a black void above the ramparts).
    this.sky.visible = isOpenAirFogState(this.fogState);
    if (this.sky.visible) {
      this.skyView.setCameraPos(this.camera.position.x, this.camera.position.z, dt);
      if (!this.lowGfx) {
        this.skyView.setDayNight(this.dnGrade.sky);
        this.skyView.setCycle(
          this.sunDir,
          duskWarmAmount(this.sunDir.y),
          nightSkyDesat(this.dnGrade.nightAmt),
        );
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
    // Normalized per-TEMPLATE key (characters/visual_pool.ts): per-instance
    // color/scale (rift spawns re-grade both per mob) is applied at acquire
    // time instead of partitioning the key, so rift visuals pool and reuse
    // like everything else instead of minting dead never-matching entries.
    // NPCs are skinned characters too: pool them like mobs so their Skeleton
    // (and its bone-matrix DataTexture) survives interest churn instead of
    // being disposed and re-uploaded every time one streams out and back into
    // view - that dispose + re-upload cycle is the open-world "asset-upload"
    // travel hitch (Skeleton.dispose via CharacterVisual.dispose in
    // removeView, pinned by GPU-upload profiling). Players never pool (A6).
    return characterVisualPoolKey(e);
  }

  private storePooledObject(key: string, object: PooledObjectView): void {
    // Unlike the character-visual pool, an overflow view has nothing to .dispose(): its
    // geometry/materials are shared per-item-template references (owned elsewhere), so
    // simply not pooling it drops the only reference to its Group/Object3D graph and lets
    // GC reclaim it. Without this cap every distinct harvest node/loot pile/quest pickup a
    // player interacted with stayed retained for the rest of the session on every platform.
    // shouldRetainPooledCharacterVisual is a generic bounded-retention check (currentCount
    // < maxCount, Infinity-safe); reused here rather than duplicating it under a second name.
    if (!shouldRetainPooledCharacterVisual(this.pooledObjectCount, GFX.maxPooledObjects)) return;
    storeGroundObjectInPool(this.objectPool, key, object);
    this.pooledObjectCount++;
  }

  private templateIdsInZone(zone: ZoneDef, kind: 'mob' | 'npc'): string[] {
    return zonePrewarmTemplateIds(zone.id, kind, this.sim.entities.values());
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
  ): {
    group: THREE.Group;
    pooled: { key: string; visual: CharacterVisual }[];
    /** Ids whose model ended the loop warm: freshly built here, already warm
     *  from an earlier id or session pass, or with no static record to build.
     *  An asset-unavailable skip stays uncounted so warmed < planned reports
     *  the unwarmed remainder instead of masquerading as complete work. */
    warmed: number;
    planned: number;
    trimmed: boolean;
  } {
    const group = new THREE.Group();
    const pooled: { key: string; visual: CharacterVisual }[] = [];
    const p = this.sim.player;
    group.position.set(p.pos.x, p.pos.y, p.pos.z - 24);
    setRenderCategory(group, 'prewarm');
    let idx = 0;
    const npcIds = this.templateIdsInZone(zone, 'npc');
    let warmed = 0;
    let trimmed = false;
    for (const npcId of npcIds) {
      if (performance.now() >= deadline) {
        trimmed = true;
        break;
      }
      const npc = NPCS[npcId];
      // Dynamic-entity template with no static NPC record: nothing to build.
      if (!npc) {
        warmed++;
        continue;
      }
      const entity = this.prewarmEntity('npc', npc.id, npc.color, 1);
      const modelKey = visualKeyFor(entity);
      // Shared model already warm: this id's planned work exists already.
      if (this.prewarmedNpcModels.has(modelKey)) {
        warmed++;
        continue;
      }
      const visual = createCharacterVisual(entity);
      // assets unavailable: skip the seed, leave the model unmarked and the
      // id uncounted, so a later zone preparation can retry it
      if (!visual) continue;
      this.prewarmedNpcModels.add(modelKey);
      warmed++;
      const poolKey = this.visualPoolKeyFor(entity);
      if (poolKey) pooled.push({ key: poolKey, visual });
      visual.root.visible = true;
      visual.root.position.set(((idx % 8) - 3.5) * 2.8, 0, Math.floor(idx / 8) * 2.8);
      group.add(visual.root);
      idx++;
    }
    return { group, pooled, warmed, planned: npcIds.length, trimmed };
  }

  private buildPlayerPrewarmGroup(deadline: number): {
    group: THREE.Group;
    visualCount: number;
    visuals: CharacterVisual[];
    plannedVisuals: number;
    trimmed: boolean;
  } {
    const group = new THREE.Group();
    const p = this.sim.player;
    group.position.set(p.pos.x, p.pos.y, p.pos.z - 21);
    setRenderCategory(group, 'prewarm');
    // Skin variants plus one aura-glow rig per class (the second loop below).
    const plannedVisuals = prewarmPlayerSkinVariantCount() + ALL_CLASSES.length;
    let idx = 0;
    const visuals: CharacterVisual[] = [];
    const place = (obj: THREE.Object3D): void => {
      obj.position.set(((idx % 8) - 3.5) * 2.8, 0, Math.floor(idx / 8) * 2.8);
      group.add(obj);
      idx++;
    };
    // Build Metamorphosis before regular player variants so first activation
    // cannot pay prepareVisual's clone, traversal and far-LOD bake cost in
    // combat. The form also joins the existing shader compile pass.
    const metamorphEntity = this.prewarmEntity(
      'player',
      'warlock',
      CLASSES.warlock?.color ?? 0xffffff,
      1,
      0,
      -10_999,
    );
    const metamorph = createCharacterVisual(metamorphEntity, 'form_metamorph');
    if (metamorph) {
      metamorph.setActive(true);
      place(metamorph.root);
      visuals.push(metamorph);
    }
    for (const cls of ALL_CLASSES) {
      const variants = skinCount(`player_${cls}`);
      for (let skin = 0; skin < variants; skin++) {
        if (performance.now() >= deadline) {
          return { group, visualCount: idx, visuals, plannedVisuals, trimmed: true };
        }
        const color = CLASSES[cls]?.color ?? 0xffffff;
        const entity = this.prewarmEntity('player', cls, color, 1, skin, -11_000 - idx);
        const visual = createCharacterVisual(entity);
        // assets unavailable: skip the seed
        if (!visual) continue;
        visual.root.visible = true;
        place(visual.root);
        visuals.push(visual);
      }
    }
    // One EXTRA rig per class wearing the ability-VFX aura glow: setAuraGlow's
    // on-edge swaps the rig materials for private clones, and the FIRST spec'd
    // cast of a session used to compile them synchronously mid-frame (the
    // measured 'mage' program link landing inside the player's own cast
    // moment, e.g. mid Solemn Prayer cast bar). The clones now keep the
    // source's shader hooks and therefore its program cache key
    // (material_clone_hooks.ts), which is what closes that hole for mob rigs
    // and non-default skins too; this seed stays as the boot-side belt for the
    // player classes, and for any rig material with no hook to preserve. The
    // group is removed in the prewarm finally, but linked programs stay cached
    // for the session.
    for (const cls of ALL_CLASSES) {
      if (performance.now() >= deadline) {
        return { group, visualCount: idx, visuals, plannedVisuals, trimmed: true };
      }
      const color = CLASSES[cls]?.color ?? 0xffffff;
      const entity = this.prewarmEntity('player', cls, color, 1, 0, -11_500 - idx);
      const visual = createCharacterVisual(entity);
      if (!visual) continue;
      visual.root.visible = true;
      visual.setAuraGlow(0xffffff, 0.02);
      place(visual.root);
      visuals.push(visual);
    }
    return { group, visualCount: idx, visuals, plannedVisuals, trimmed: false };
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

  private prewarmTexture(texture: THREE.Texture | null | undefined): void {
    if (!texture) return;
    this.webgl.initTexture(texture);
    this.gpuReadyTextures.add(texture);
  }

  /** One spirit-puppet build per idle slot, arbitrated with every other lane
   *  that reaches WebGL. A rejected unit (renderer shut down mid-build) is a
   *  dev-channel warning: an unbuilt puppet only means its next cast skips its
   *  spirit, exactly like a model still in flight. */
  private queueSpiritPuppetBuild(build: () => void): void {
    this.spiritBuildLane = this.spiritBuildLane
      .then(() => idleSlot(IDLE_PREWARM_TIMEOUT_MS))
      .then(() => this.backgroundGpuWork.run(build, GPU_WORK_PRIORITY.BACKGROUND, 'spirit-puppet'))
      .catch((err: unknown) => {
        console.warn('[spirits] deferred puppet build failed', err);
      });
  }

  private readonly previewPrewarm = createPreviewPrewarmLane({
    idleSlot: () => idleSlot(IDLE_PREWARM_TIMEOUT_MS, { maxTimeoutDeferrals: 2 }),
    run: (unit, priority, label, options) =>
      this.backgroundGpuWork.run(unit, priority, label, options),
  });

  /** Scheduled secondary-context preview warming (paperdoll, portrait caches).
   *  Lane policy lives in preview_prewarm_lane.ts. */
  queueSecondaryPreviewPrewarm(label: string, unit: () => void | Promise<void>): Promise<void> {
    return this.previewPrewarm.queueScheduled(label, unit);
  }

  private readonly gpuReadyTextures = new WeakSet<THREE.Texture>();
  private readonly textureUploadTasks = new WeakMap<THREE.Texture, Promise<void>>();
  private readonly textureUploadTaskSet = new Set<Promise<void>>();

  private prewarmTextureInIdle(
    texture: THREE.Texture | null | undefined,
    // The caller's queue priority for the chunk uploads: a lane whose stated
    // intent is lowest-priority (the deferred sky resume at BOOT_RESUME) must
    // not have its expensive upload steps outrank its cheap ones. An
    // already-pending upload keeps the priority it entered the queue with.
    priority: number = GPU_WORK_PRIORITY.VISIBLE_PREWARM,
  ): Promise<void> {
    if (!texture || this.gpuReadyTextures.has(texture)) return Promise.resolve();
    const pending = this.textureUploadTasks.get(texture);
    if (pending) return pending;
    const task = uploadDataTextureInChunks(this.webgl, texture, {
      beforeChunk: () => idleSlot(IDLE_PREWARM_TIMEOUT_MS),
      uploadChunk: (chunkTexture) =>
        this.backgroundGpuWork.run(
          () => this.webgl.initTexture(chunkTexture),
          priority,
          'texture-chunk-upload',
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

  private readonly textureSweepHost = {
    upload: (texture: THREE.Texture | null | undefined): void => this.prewarmTexture(texture),
    textureCount: (): number => this.webgl.info.memory.textures,
  };

  private prewarmMaterialTextures(material: THREE.Material | THREE.Material[] | undefined): void {
    sweepMaterialTextures(this.textureSweepHost, material);
  }

  private prewarmObjectTextures(obj: THREE.Object3D): number {
    return sweepObjectTextures(this.textureSweepHost, obj);
  }

  /**
   * Link a root's exact live colour-program variant before a bounded upload.
   * Three chooses output colour space from the current render target in
   * compileAsync's synchronous prologue (authored on r165; the r185 prewarm
   * re-audit kept this restore). Restore that global before awaiting
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
   * shadow materials. Temporarily put equivalent MeshDepthMaterials on EVERY
   * mesh under the root, skinned or not, so KHR_parallel_shader_compile links
   * those variants before the shadow pass asks getUniforms for them: static
   * and instanced casters (12 of the initial frame's 64 residual synchronous
   * links), and meshes NOT casting at gate time, because castShadow is toggled
   * at runtime by distance (entity shadow band, zone shadow volume, gather
   * nodes) frames after this arm ran, so a rig created beyond the band linked
   * cold at its first shadow draw (eleven depth programs of 20 to 41 ms in
   * 0.3 s on the 3090 ride, ten through Eastbrook in production). Depth twins
   * are few, cached per (material inputs x mesh shape): a cache hit, no link.
   */
  private async compileShadowPrograms(root: THREE.Object3D): Promise<void> {
    if (!GFX.dynamicShadows || !this.asyncCompileSupported) return;
    const swaps: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
    // Walked inside the try below so a throw mid-walk still restores every swap.
    const swapMaterials = (): void => {
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const material = mesh.material;
        swaps.push({ mesh, material });
        mesh.material = Array.isArray(material)
          ? material.map((item) => prewarmDepthMaterial(this.prewarmDepthMaterials, item, mesh))
          : prewarmDepthMaterial(this.prewarmDepthMaterials, material, mesh);
      });
    };
    // Match the real shadow pass's program key exactly. A bare
    // compileAsync(root, shadowCamera) uses the canvas output colour space
    // and sees no scene lights, producing a skinned depth program that still
    // misses both the render-target and shadow-map bits. Conversely, passing
    // the world scene verbatim would add fog bits that WebGLShadowMap omits
    // (its renderBufferDirect call uses a null scene). Keep the world only as
    // the light source, briefly suppress its fog, and compile while any
    // offscreen target is current so outputColorSpace is the linear working
    // space. compileAsync runs its compile() prologue synchronously; restore
    // the globals AND the swapped materials before awaiting the parallel
    // linker: the boot-resume lane runs these units on VISIBLE post-reveal
    // scene meshes, and a swap held across the awaited link (10 ms+ of real
    // frames) would draw them as depth noise. The link tracks the depth
    // material object, not the mesh, so restoring early is safe.
    this.prewarmRenderTarget ??= new THREE.WebGLRenderTarget(8, 8);
    const previousTarget = this.webgl.getRenderTarget();
    const previousFog = this.scene.fog;
    let compilePromise: Promise<THREE.Object3D> | null = null;
    try {
      swapMaterials();
      if (swaps.length > 0) {
        this.scene.fog = null;
        this.webgl.setRenderTarget(this.prewarmRenderTarget);
        compilePromise = this.webgl.compileAsync(root, this.sun.shadow.camera, this.scene);
      }
    } finally {
      this.webgl.setRenderTarget(previousTarget);
      this.scene.fog = previousFog;
      for (const swap of swaps) swap.mesh.material = swap.material;
    }
    // Do not race a timer here. The underlying linker cannot be cancelled,
    // so a timeout only lets it overlap the next child and gameplay.
    if (compilePromise) await compilePromise;
  }

  // Link the local player's own body spirit (ghost) transparent variants
  // off-thread so a later spirit release reuses cached programs instead of
  // linking ~20 inline on the ungated self view (the ~2.2 s death stall).
  // Applies the ghost materials to the REAL skinned meshes (so the variant
  // matches the flip's skinning/morph), runs compileAsync's synchronous
  // prologue, then restores the opaque originals BEFORE awaiting the linker
  // (the compileShadowPrograms restore-early pattern): no frame draws the ghost,
  // and the clones the flip reuses stay cached on the visual.
  private async warmSelfSpirit(): Promise<boolean> {
    if (!this.asyncCompileSupported || this.sim.player.ghost) return false;
    const visual = this.views.get(this.sim.player.id)?.visual;
    if (!visual) return false;
    const previousTarget = this.webgl.getRenderTarget();
    // Composer tiers link the ghost variant against their offscreen colour space.
    if (this.post) this.prewarmRenderTarget ??= new THREE.WebGLRenderTarget(8, 8);
    let compilePromise: Promise<THREE.Object3D>;
    visual.setGhost(true);
    try {
      this.webgl.setRenderTarget(this.post ? this.prewarmRenderTarget : null);
      compilePromise = this.webgl.compileAsync(visual.root, this.camera, this.scene);
    } finally {
      this.webgl.setRenderTarget(previousTarget);
      visual.setGhost(false);
    }
    await compilePromise;
    return true;
  }
  // A tiny throwaway target for background child uploads, so a prewarm root
  // that is briefly visible during its bounded call is never presented on
  // the canvas. Lazily built once and kept: 8x8 RGBA plus depth is negligible.
  private prewarmRenderTarget: THREE.WebGLRenderTarget | null = null;

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
    // The direct arm's live read would include the shadow pass since r185
    // (r165 excluded it), but shipped direct profiles never render shadows
    // (pinned in tests/gfx.test.ts), so the sort threshold did not move.
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
    const previousPadVisibility = this.lightPads.map((pad) => pad.visible);
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

      // The mask above hides entity views, and their nested chosen lights
      // leave Three's counted set with them, out of band of the budget pass:
      // NUM_POINT_LIGHTS would drift below the pinned total for THIS render
      // only, and every first-drawn material would synchronously link a
      // program variant the live render never draws (the measured 100-280 ms
      // prewarm-unit stalls). Recount in the masked state and raise the pads
      // so this render draws the exact variant the compile lane linked.
      const boundedDrawn = countDrawnPointLights(this.lightRank, this.scene);
      const boundedPadCount = Math.min(
        this.lightPads.length,
        pointLightPadCount(boundedDrawn, GFX.maxPointLights),
      );
      for (let i = 0; i < this.lightPads.length; i++) {
        this.lightPads[i].visible = i < boundedPadCount;
      }

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
      for (let i = 0; i < this.lightPads.length; i++) {
        this.lightPads[i].visible = previousPadVisibility[i];
      }
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

  private renderPresentationPrewarmPass(): boolean {
    const post = this.post;
    if (!post) return false;
    try {
      withSceneHiddenForPresentationPrewarm(this.scene, () => post.render());
      return true;
    } finally {
      this.discardOutOfBandDraws();
    }
  }

  private diagnosticsBaselineForPrewarm(): RendererPrewarmDiagnosticsBaselineStats | null {
    if (!this.renderDiagnostics.enabled) return null;
    const snapshot = this.renderDiagnostics.collect();
    const categories: RendererPrewarmDiagnosticsBaselineStats['categories'] = {};
    for (const [name, stat] of Object.entries(snapshot.categories)) {
      categories[name] = {
        draws: stat.draws,
        triangles: stat.triangles,
        materials: stat.materials,
      };
    }
    return {
      programs: snapshot.programs,
      textures: snapshot.textures,
      totalObjects: snapshot.totalObjects,
      estimatedDraws: snapshot.estimatedDraws,
      estimatedTriangles: snapshot.estimatedTriangles,
      categories,
    };
  }

  async prewarmInitialScene(
    options: {
      maxMs?: number;
      hardMaxMs?: number;
      resumeAfterFirstPaint?: Promise<void>;
      onEntryStart?: (id: string, category: RendererPrewarmCategory) => void;
    } = {},
  ): Promise<RendererPrewarmStats> {
    this.initialGpuWorkStart = options.resumeAfterFirstPaint ?? null;
    void this.initialGpuWorkStart?.then(() => {
      this.initialGpuWorkStart = null;
    });
    this.installSceneryRevealGates();
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
    const pacing = createPrewarmPacing(location.search, { now: () => performance.now() });
    const defaultHardMaxMs = constrainedPrewarm
      ? VIEW_PREWARM_HARD_MAX_MS_CONSTRAINED
      : (pacing.knobs.hardMaxMs ?? VIEW_PREWARM_HARD_MAX_MS);
    const hardMaxMs = Math.max(maxMs, options.hardMaxMs ?? defaultHardMaxMs);
    const compileBatchRoots = pacing.knobs.compileBatchRoots ?? PREWARM_COMPILE_BATCH_ROOTS;
    this.gpuHitchPacing = { controller: pacing, compileBatchRoots, hardMaxMs };
    const started = performance.now();
    const deadline = started + maxMs;
    const hardDeadline = started + hardMaxMs;
    const gpuSubmitDeadline = Math.max(started, hardDeadline - PREWARM_GPU_SUBMIT_GUARD_MS);
    // Stop the archetype-build steps early so the later entries, crucially
    // programs.compile, still START before `deadline` (runEntry skips anything
    // that begins past it). Compiling is what kills the in-world freeze.
    // Mutable: extended alongside `deadline` when a dropped entry is resumed, so
    // a resumed entities.player-archetypes/entities.npc-archetypes does not see
    // a stale, already-past budget and silently build nothing (#2571 review).
    const buildDeadline = prewarmBuildDeadline(
      deadline,
      hardDeadline,
      PREWARM_BUILD_RESERVE_MS,
      policy.finishFullManifestBeforeReveal,
    );
    // Stop the compile entry's await-all early so world.initial-frame (the
    // next entry; compileBeforeFirstFrame reorders it to run immediately
    // after this one) always starts before the hard deadline. Derived from
    // the SAME hardDeadline value prewarmEntryShouldDefer checks every entry
    // start against, never a separately-computed clock. See
    // prewarmCompileAwaitDeadline and the compile entry's run() below.
    const compileAwaitDeadline = prewarmCompileAwaitDeadline(
      hardDeadline,
      PREWARM_COMPILE_AWAIT_RESERVE_MS,
    );
    const manifestEntries: RendererPrewarmManifestEntryStats[] = [];
    const startCounts = liveProgramWatch.programCounts(this.webgl);
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
    // Decouple the sky HDRI fetch + worker decode from the budgeted manifest:
    // start it NOW so the network wait overlaps the compute stages below. The
    // old shape awaited this fetch inside the FIRST manifest entry, and a slow
    // network was measured consuming 11.5s of the 12s boot budget before a
    // single archetype/program/vfx stage had run (the boot starvation), after
    // which those stages were dropped at 0ms. Constrained profiles skip the
    // sky entry entirely (CONSTRAINED_PREWARM_KEEP), so they must not fetch
    // or decode-hold these HDRIs either: the prefetch is gated the same way.
    const skyAssetPrefetch = prewarmEntryRuns('sky.nearby-biomes', policy)
      ? trackPrefetch(ensureSkyBiomeAssets(initialSkyBiomes))
      : null;
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
    const poolsAwaitPublication = (): boolean =>
      (entityPrewarmPool.length > 0 && (entityPrewarmGroup?.children.length ?? 0) > 0) ||
      (npcPrewarmPool.length > 0 && (npcPrewarmGroup?.children.length ?? 0) > 0);
    let playerPrewarmGroup: THREE.Group | null = null;
    let playerPrewarmInstances: CharacterVisual[] = [];
    let objectPrewarmGroup: THREE.Group | null = null;
    let propMaterialPrewarmGroup: THREE.Group | null = null;
    const variantSlotHost = {
      scene: this.scene,
      compileColorPrograms: (group: THREE.Group) => this.compilePrewarmColorPrograms(group, false),
    };
    const ghostVariantSlot = createVariantPrewarmSlot(
      variantSlotHost,
      'ghost-fade-variants',
      buildGhostVariantPrewarmGroup,
    );
    const characterEffectSlot = createVariantPrewarmSlot(
      variantSlotHost,
      'character-effect-variants',
      buildCharacterEffectPrewarmGroup,
    );
    let foliagePrewarmGroup: THREE.Group | null = null;
    let greatTreePrewarmGroup: THREE.Group | null = null;
    let weaponVfxPrewarmGroup: THREE.Group | null = null;
    const weaponVfxPrewarmSkinStage = createWeaponVfxPrewarmSkinStage(this.scene);
    const landmarkSlot = createVariantPrewarmSlot(variantSlotHost, 'landmarks.impact-site', () =>
      buildImpactSitePrewarmGroup(this.impactSite.group, p.pos),
    );
    const abilityMaterialSlot = createVariantPrewarmSlot(
      variantSlotHost,
      'ability-materials',
      buildAbilityMaterialPrewarmGroup,
    );
    let mountPrewarmGroup: THREE.Group | null = null;
    const mountPrewarmPlannedKeys = mountPrewarmKeys(this.sim.ownedMounts());
    const mountPrewarmPendingKeys = new Set(mountPrewarmPlannedKeys);
    let mountPrewarmWarmed = 0;
    let surfaceDetailTexturesWarmed = 0;

    let renderPasses = 0;
    let playerPrewarmVisuals = 0;
    let playerPrewarmProgress: PrewarmEntryProgress | null = null;
    let npcPrewarmProgress: PrewarmEntryProgress | null = null;
    let portalViewsTrimmed = false;
    // views.persistent-portals' own created count (same per-entry rule as
    // nearbyViewsCreated below).
    let portalViewsCreated = 0;
    let nearbyViewsTrimmed = false;
    // views.required's own created count (same per-entry rule as
    // nearbyViewsCreated below: never report the cumulative counter as one
    // entry's done).
    let requiredViewsCreated = 0;
    // views.nearby's own created count: `createdViews` is the CUMULATIVE
    // counter shared with the required/landmark/portal substeps, so reporting
    // it as this entry's done would exceed the entry's planned candidates.
    let nearbyViewsCreated = 0;
    let sceneTextureAdmission: InitialSceneTextureAdmission<THREE.Texture> | null = null;
    let sceneTextureMemoryBefore: number | null = null;
    let textureUploads = 0;
    const sceneTextureUploadDelta = (): number =>
      Math.max(
        0,
        this.webgl.info.memory.textures -
          (sceneTextureMemoryBefore ?? this.webgl.info.memory.textures),
      );
    const ensureSceneTextureAdmission = (): InitialSceneTextureAdmission<THREE.Texture> => {
      if (!sceneTextureAdmission) {
        sceneTextureMemoryBefore = this.webgl.info.memory.textures;
        sceneTextureAdmission = new InitialSceneTextureAdmission(
          collectInitialPresentationTextures(this.scene, this.views, p.id, p.targetId),
          (texture) => this.prewarmTexture(texture),
        );
      }
      return sceneTextureAdmission;
    };
    const sceneTextureRemainder = (): readonly THREE.Texture[] =>
      ensureSceneTextureAdmission().remaining();
    let skyWarmedInlineBiomes = 0;
    let skyDeferredBiomes: (typeof initialSkyBiomes)[number][] = [];
    let skyWarmComplete = false;
    // sky.current-zone's camera points, hoisted so the entry's run() loop and
    // its progress() planned count share one source of truth (live references,
    // read at run time exactly as before).
    const skyZonePoints = [p.pos, activeZone.hub];
    let skyZonePasses = 0;
    let compileUnitsPlanned = 0;
    let compileUnitsDone = 0;
    let compileUnitsDropped = 0;
    const compileLifecycle = createPrewarmCompileLifecycle(
      () => performance.now(),
      compileRootLabel,
    );
    this.gpuHitchCompileLifecycle = compileLifecycle;
    let vfxPrewarmBursts = 0;
    let compileMode: RendererPrewarmStats['compileMode'] = 'none';
    let compileMs = 0;
    let compileTimedOut = false;
    const budgetVariantStats: NonNullable<RendererPrewarmManifestEntryStats['budgetVariants']> = [];
    // How many of [player/entity/npc]PrewarmGroup actually had a skinned-shadow
    // pre-compile pass run against them: 0 on a resumed programs.compile whose
    // archetype groups were already torn down by the main pass's cleanup, so the
    // detail string below does not overstate what a resumed run actually did
    // (#2571 review).
    let compiledPrewarmRoots = 0;
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
      /** Optional remainder for a started entry that reports partial progress. */
      resumePartialUnits?: () => readonly PrewarmResumeUnit[];
      run: () => void | Promise<void>;
      /** Read after run(): how much of the planned work actually happened. A
       * trimmed report downgrades the entry to 'partial' (prewarm_policy.ts),
       * so a deadline return can never masquerade as completed again. */
      progress?: () => PrewarmEntryProgress | null;
      budgetVariants?: () => NonNullable<RendererPrewarmManifestEntryStats['budgetVariants']>;
      detail?: () => string;
    };

    // Explicitly bounded units captured when their manifest entry misses the
    // loading deadline. Whole entry callbacks are never resumed live.
    const droppedEntries: PrewarmResumeEntry[] = [];
    const resumeLedger = createPrewarmResumeLedger();

    // One shared dedupe store across EVERY compile collection in this entry
    // pass (early submission, the compile entry's tail, the live-scene
    // re-collection, and the resume lane): a root or program signature any
    // earlier call already submitted is never resubmitted, so re-collecting
    // the live scene after world.settle-state only picks up what is
    // genuinely new.
    const compileDedupe = {
      seen: new Set<THREE.Object3D>(),
      seenKeys: new Set<unknown>(),
    };

    // Read the staged groups FRESH on every call: the group variables are
    // assigned as their manifest entries run, so a captured snapshot would
    // freeze the nulls of whenever it was taken.
    const stagedCompileGroupsNow = (): readonly [string, THREE.Group | null][] => [
      ['doors', doorPrewarmGroup],
      ['interiors', interiorPrewarmGroup],
      ['players', playerPrewarmGroup],
      ['mobs', entityPrewarmGroup],
      ['npcs', npcPrewarmGroup],
      ['objects', objectPrewarmGroup],
      ['props', propMaterialPrewarmGroup],
      ghostVariantSlot.staged(),
      characterEffectSlot.staged(),
      abilityMaterialSlot.staged(),
      ['foliage', foliagePrewarmGroup],
      ['great-tree', greatTreePrewarmGroup],
      ['weapon-vfx', weaponVfxPrewarmGroup],
      landmarkSlot.staged(),
      ['mounts', mountPrewarmGroup],
    ];

    const compileEntryUnits = (
      includeGroup: (groupId: string) => boolean = () => true,
      lifecycleLane = 'programs.compile',
    ): PrewarmResumeUnit[] => {
      const units = buildInitialSceneCompileUnits({
        scene: this.scene,
        stagedGroups: stagedCompileGroupsNow(),
        includeGroup,
        playerX: this.sim.player.pos.x,
        playerZ: this.sim.player.pos.z,
        batchSize: compileBatchRoots,
        sharedDedupe: compileDedupe,
        compileColor: (root) => this.compilePrewarmColorPrograms(root, false),
        compileShadow: (root) => this.compileShadowPrograms(root),
        onCompiledRoot: () => compiledPrewarmRoots++,
      });
      for (const unit of units) compileLifecycle.recordFor(unit, lifecycleLane);
      return units;
    };

    // Early compile submission: compileAsync links settle off-thread, so the
    // sooner a unit is SUBMITTED the more of its link time overlaps the other
    // manifest entries (surface-detail plus textures.scene alone are ~4.5 s of
    // uploads on the reference desktop). 'programs.compile-submit' fires every
    // visible-scene units right after they exist; hidden staged catalogs are
    // classified as post-paint debt and retain their stand-ins. The final
    // compile entry submits the visible remainder and then awaits it so
    // all of their programs are READY before world.initial-frame renders; a
    // program not ready by then links synchronously inside that frame, the
    // measured first-draw stall class. Which groups each call collects is the
    // pure planCompileSubmission (prewarm_policy.ts); the submit LOOP, its
    // deadline rule and its never-drop contract are
    // runPrewarmCompileSubmission (prewarm_compile_submission_core.ts).
    const submittedCompileUnits: { id: string; done: Promise<void> }[] = [];
    const submittedCompileGroups = new Set<string>();
    // Units built (their roots consumed from the shared dedupe store) but not
    // yet submitted because the loop hit the GPU submit deadline. The roots are
    // marked seen at BUILD time, so these exact unit objects are the only
    // remaining route to their compiles: the compile entry drains them first,
    // and the post-manifest hand-off pushes any leftover to the resume lane
    // (never dropped, hitch-hunt P1).
    const deferredSubmitUnits: PrewarmResumeUnit[] = [];
    const postPaintCompileUnits: PrewarmResumeUnit[] = [];
    let initialFrameDeferred: LinkDebt | null = null;
    let budgetVariantsDeferred: LinkDebt | null = null;
    const LATE_COMPILE_GROUPS = new Set(['weapon-vfx']);
    const RECOLLECT_COMPILE_GROUPS = new Set(['scene']);
    const submitCompileUnits = async (
      includeLate: boolean,
      deadlineMs = gpuSubmitDeadline,
      lane = includeLate ? 'programs.compile' : 'programs.compile-submit',
    ) => {
      const plan = planCompileSubmission({
        groups: [
          { id: 'scene', exists: true },
          ...stagedCompileGroupsNow().map(([id, group]) => ({ id, exists: group !== null })),
        ],
        submitted: submittedCompileGroups,
        late: LATE_COMPILE_GROUPS,
        recollect: RECOLLECT_COMPILE_GROUPS,
        includeLate,
      });
      const collect = new Set(
        plan.collect.filter(
          (groupId) =>
            !options.resumeAfterFirstPaint || compileGroupRunsBeforeInitialPaint(groupId),
        ),
      );
      const delayed = new Set(plan.collect.filter((groupId) => !collect.has(groupId)));
      const units = compileEntryUnits((groupId) => collect.has(groupId), lane);
      const delayedUnits = compileEntryUnits(
        (groupId) => delayed.has(groupId),
        'programs.compile-post-paint',
      );
      postPaintCompileUnits.push(...delayedUnits);
      deferPoolPublication ||= delayedUnits.length > 0;
      for (const groupId of plan.mark) submittedCompileGroups.add(groupId);
      // Earlier-deferred units resubmit ahead of the fresh collection; their
      // groups are already marked, so the plan above never re-collected them.
      const pending = [...deferredSubmitUnits.splice(0, deferredSubmitUnits.length), ...units];
      const { deferred } = await runPrewarmCompileSubmission(pending, {
        outOfTime: () =>
          prewarmSubmitShouldStop(
            performance.now(),
            deadlineMs,
            policy.finishFullManifestBeforeReveal,
            pacing.shouldStop(performance.now()),
          ),
        awaitSlot: (outOfTime) => pacing.awaitSlot(outOfTime),
        recordDeferred: (unit) => compileLifecycle.recordFor(unit, lane),
        // Pushed HERE, never batched at the loop's return (see the host's
        // own contract in prewarm_compile_submission_core.ts).
        submit: (unit) =>
          submittedCompileUnits.push(
            submitPrewarmCompileUnit(unit, lane, {
              lifecycle: compileLifecycle,
              pacing,
              programCount: () => this.webgl.info.programs?.length ?? 0,
              onError: (err) =>
                console.warn(`Renderer async prewarm compile failed: ${unit.id}`, err),
            }),
          ),
        yieldSlice: async () => {
          sceneTextureAdmission?.admitOneBefore(deadlineMs);
          await sleep(0);
        },
      });
      if (deferred.length === 0) return;
      deferredSubmitUnits.push(...(deferred as PrewarmResumeUnit[]));
      // The deferred units' compiles now settle AFTER the manifest, so the warm
      // entity/NPC pools must not publish from the manifest's finally block
      // with unlinked programs: the settle-then-publish arm below publishes
      // them once the resume lane drains (same contract as the compile entry's
      // whole-deferral path).
      deferPoolPublication ||= poolsAwaitPublication();
    };

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
      const before = liveProgramWatch.programCounts(this.webgl);
      const entryStarted = performance.now();
      if (
        prewarmEntryShouldDefer(
          entryStarted,
          deadline,
          hardDeadline,
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
      // Deadline-limited work with planned units remaining reports 'partial',
      // never 'completed'.
      const progress = entry.progress?.() ?? null;
      if (status === 'completed') status = resolvePrewarmEntryStatus(progress);
      // Explicit partial resumes may also recover failed indivisible units.
      if (status === 'partial' || status === 'failed') {
        const partialUnits = entry.resumePartialUnits?.() ?? [];
        if (partialUnits.length > 0) droppedEntries.push({ id: entry.id, units: partialUnits });
      }
      const after = liveProgramWatch.programCounts(this.webgl);
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
        workDone: progress?.done,
        workPlanned: progress?.planned,
        budgetVariants: entry.budgetVariants?.().slice(),
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
        weaponVfxPrewarmGroup,
        mountPrewarmGroup,
      ]) {
        if (group) group.visible = false;
      }
      ghostVariantSlot.hide();
      characterEffectSlot.hide();
      landmarkSlot.hide();
      weatherSlot.hide();
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
        this.needleOfFateVfx.clear();
        this.sentenceVfx.clear();
      }
      if (doorPrewarmGroup) this.scene.remove(doorPrewarmGroup);
      if (interiorPrewarmGroup) this.scene.remove(interiorPrewarmGroup);
      if (entityPrewarmGroup) this.scene.remove(entityPrewarmGroup);
      if (npcPrewarmGroup) this.scene.remove(npcPrewarmGroup);
      if (opts.publishPools) {
        for (const item of entityPrewarmPool) this.pooledVisuals.store(item.key, item.visual);
        for (const item of npcPrewarmPool) this.pooledVisuals.store(item.key, item.visual);
      }
      if (playerPrewarmGroup) this.scene.remove(playerPrewarmGroup);
      for (const visual of playerPrewarmInstances) visual.dispose();
      playerPrewarmInstances = [];
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
      ghostVariantSlot.cleanup();
      characterEffectSlot.cleanup();
      if (foliagePrewarmGroup) this.scene.remove(foliagePrewarmGroup);
      if (greatTreePrewarmGroup) this.scene.remove(greatTreePrewarmGroup);
      // Removed, never disposed: disposing a material releases its linked
      // program, which is exactly what this group exists to warm.
      if (weaponVfxPrewarmGroup) this.scene.remove(weaponVfxPrewarmGroup);
      landmarkSlot.cleanup();
      weatherSlot.cleanup();
      // Same reason: a mount rig removed here keeps its program cached, it
      // just stops taking a scene-graph traversal slot every frame.
      if (mountPrewarmGroup) this.scene.remove(mountPrewarmGroup);
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
      weaponVfxPrewarmSkinStage.dispose();
      weaponVfxPrewarmGroup = null;
      mountPrewarmGroup = null;
    };

    const settleMinPasses = this.lowGfx ? 8 : 10;

    const mountPrewarmResumeUnits = (): PrewarmResumeUnit[] =>
      [...mountPrewarmPendingKeys].map((key) => ({
        id: `mount:${key}`,
        run: async () => {
          const staged = await stageMountPrewarmVisual(this.scene, mountPrewarmGroup, key);
          if (!staged) return;
          mountPrewarmGroup = staged.group;
          await this.compilePrewarmColorPrograms(staged.visual.root, false);
          await this.compileShadowPrograms(staged.visual.root);
          mountPrewarmPendingKeys.delete(key);
          mountPrewarmWarmed++;
        },
      }));

    const textureResumeUnits = (idPrefix: string, textures: readonly THREE.Texture[]) =>
      initialSceneTextureResumeUnits(idPrefix, textures, (texture) => this.prewarmTexture(texture));

    const weatherSlot = createPrewarmGroupSlot(variantSlotHost, 'weather.materials', {
      stage: () => this.weather.beginPrewarm(),
      hide: () => this.weather.hidePrewarm(),
      units: (textures) => textureResumeUnits('weather-materials', textures),
      cleanup: () => this.weather.endPrewarm(),
    });

    const manifest: PrewarmManifestEntry[] = [
      {
        id: 'views.required',
        category: 'views',
        priority: 10,
        required: true,
        run: () => {
          requiredViewsCreated = this.createRequiredViews(p, createdViewTypes);
          createdViews += requiredViewsCreated;
        },
        // The shared view cap never stops this entry: required player/target
        // views bypass the budget by design (they only DRAIN it for the capped
        // substeps). The explicit hook keeps that rule visible beside the
        // capped entries drawing on the same budget, which mark trimmed when
        // the cap stops them with work remaining.
        progress: () => ({ done: requiredViewsCreated, trimmed: false }),
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
        // The shared view cap never stops this entry either: mandatory
        // landmark views bypass the budget (the helper takes no limit), and
        // run() throws unless every mandatory view became ready, so a
        // successful entry has done === planned by construction.
        progress: () => ({
          done: mandatoryLandmarkIds.length,
          planned: mandatoryLandmarkIds.length,
          trimmed: false,
        }),
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
          // Portals draw only what the shared budget can spare past the nearby
          // floor: they are the least actionable views on the shared cap, and
          // with the small 12/16 budgets an unreserved draw here could leave
          // views.nearby below with zero slots at a landmark-heavy spawn.
          const result = this.createPersistentPortalViews(
            createdViewTypes,
            buildDeadline,
            portalPrewarmViewBudget(policy.maxViews, createdViews, policy.nearbyViewFloor),
          );
          portalViewsCreated = result.created;
          createdViews += result.created;
          portalViewsTrimmed = result.trimmed;
        },
        progress: () => ({ trimmed: portalViewsTrimmed }),
        // Per-entry count first: `createdViews` is the cumulative counter
        // shared with the required/landmark/nearby substeps (same rule as
        // views.nearby below).
        detail: () => `created=${portalViewsCreated};cumulativeViews=${createdViews}`,
      },
      {
        id: 'views.nearby',
        category: 'views',
        priority: 20,
        required: true,
        run: () => {
          this.collectMissingViewCandidates(p, VIEW_PREWARM_RANGE_SQ, false);
          candidateViews = this.viewCandidates.length;
          const result = this.createCandidateViews(
            nearbyPrewarmViewBudget(policy.maxViews, createdViews, policy.nearbyViewFloor),
            createdViewTypes,
            buildDeadline,
          );
          nearbyViewsCreated = result.created;
          createdViews += result.created;
          nearbyViewsTrimmed = result.trimmed;
        },
        progress: () => ({
          done: nearbyViewsCreated,
          planned: candidateViews,
          trimmed: nearbyViewsTrimmed,
        }),
        detail: () =>
          `created=${nearbyViewsCreated};cumulativeViews=${createdViews};candidates=${candidateViews}`,
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
          interiorPrewarmGroup = await this.ensureDungeons().buildPrewarmGroup();
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
          playerPrewarmInstances = built.visuals;
          // Planned is exact here, so any shortfall trims: an asset-skipped
          // rig (createCharacterVisual returning null) leaves planned work
          // unwarmed, and completed must mean the work actually happened.
          playerPrewarmProgress = {
            done: built.visualCount,
            planned: built.plannedVisuals,
            trimmed: built.trimmed || built.visualCount < built.plannedVisuals,
          };
          this.scene.add(playerPrewarmGroup);
        },
        progress: () => playerPrewarmProgress,
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
          // Same derived rule as entities.player-archetypes above: done counts
          // ids whose model ended warm, so an asset-skipped id leaves
          // done < planned and the entry reports partial, never completed.
          npcPrewarmProgress = {
            done: built.warmed,
            planned: built.planned,
            trimmed: built.trimmed || built.warmed < built.planned,
          };
          this.scene.add(npcPrewarmGroup);
        },
        progress: () => npcPrewarmProgress,
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
        // The camera-ghost fade flips `transparent`, which three keys a SECOND
        // program on, so every ghosted kit material linked one the first time
        // it faded. A crowd arrival whips the camera across town and fades
        // dozens of structures inside one frame (the measured geared-arrival
        // stall). One hidden twin per distinct ghost PROGRAM, in the exact fade
        // state, links that half here instead: measured on the offline
        // Eastbrook scene, fading every live ghost material went from 41
        // programs over 2.39s of compile to 3 over 0.53s.
        id: 'props.ghost-fade-variants',
        category: 'props',
        priority: 46,
        required: false,
        // Two bounded units: stage the twins, then link them. Both read the
        // live scene, so a resume after world entry still sees the same
        // hideables the entry pass would have.
        resumeUnits: ghostVariantSlot.resumeUnits,
        run: ghostVariantSlot.run,
        detail: ghostVariantSlot.detail,
      },
      {
        // The character effect treatments (ghost run, stealth, shadowform,
        // moonkin) flip `transparent` on clones of the rig materials, so every
        // rig material owns a second, transparent program (two for a
        // double-sided one) that linked cold the first time a body faded in a
        // crowd (production: 4.8 s on one link, then 115 to 130 ms per
        // material). One hidden SkinnedMesh twin per distinct program, built
        // through the same effect-material factory the live swap uses.
        id: 'entities.character-effect-variants',
        category: 'entities',
        priority: 47,
        required: false,
        resumeUnits: characterEffectSlot.resumeUnits,
        run: characterEffectSlot.run,
        detail: characterEffectSlot.detail,
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
        // Droppable, so it MUST resume: without these units a deadline drop
        // meant the pine casters and far impostors were never linked at all,
        // and every one of them paid its colour AND shadow link mid-travel.
        // The ghost-fade-variants shape: stage the group HIDDEN (its meshes
        // are frustumCulled=false casters, so a visible stage would let the
        // next live frame link every species synchronously before the compile
        // units run; compileAsync walks hidden subtrees), then link both arms
        // (the species cast shadows) one species per unit, so the debt lane's
        // held tail never parks a live gate behind the whole family.
        resumeUnits: () => {
          const group = buildFoliageMaterialPrewarmGroup();
          group.visible = false;
          return [
            {
              id: 'foliage-materials:group',
              run: () => {
                foliagePrewarmGroup = group;
                this.scene.add(group);
              },
            },
            ...group.children.map((child, index) => ({
              id: `foliage-materials:compile:${index}`,
              run: async () => {
                await this.compilePrewarmColorPrograms(child, false);
                await this.compileShadowPrograms(child);
              },
            })),
          ];
        },
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
        // Set the capped camera and subsystem visibility before collecting any
        // scene compile or texture work. This is paint-free and deadline-exempt:
        // without it the 240-yard entry policy still prewarms the old 700-yard scene.
        id: 'world.settle-state',
        category: 'world',
        priority: 45,
        required: true,
        deadlineExempt: true,
        run: () => {
          this.prewarmWorldFrame(1 / 60);
          ensureSceneTextureAdmission();
        },
      },
      {
        // Warm only the composer's fullscreen presentation path. The scene
        // root is hidden for this pass, so catalog/texture debt cannot turn it
        // into the same multi-second whole-world submit as the first frame.
        id: 'post.initial-frame',
        category: 'post',
        priority: 45,
        required: true,
        // This is the presentation-owned half of world.initial-frame. It is
        // independent from hidden catalog debt and never submits scene roots.
        deadlineExempt: true,
        run: () => {
          if (this.renderPresentationPrewarmPass()) renderPasses++;
        },
        detail: () => (this.post ? 'composer-only' : 'direct-renderer'),
      },
      {
        // Early compile submission (see submitCompileUnits above): every
        // group staged by the entries before this one fires its compileAsync
        // units NOW, so the driver links them off-thread underneath the
        // texture-upload entries that follow instead of only starting after
        // them. Skipped without parallel compile (the submission itself would
        // link synchronously) and on a deferral, where 'programs.compile'
        // submits everything itself, exactly as before this entry existed.
        id: 'programs.compile-submit',
        category: 'world',
        priority: 46,
        required: false,
        run: async () => {
          if (policy.skipMonolithCompile || !this.asyncCompileSupported) return;
          await submitCompileUnits(false, gpuSubmitDeadline, 'programs.compile-submit');
        },
        detail: () =>
          `submitted=${submittedCompileUnits.length};deferred=${deferredSubmitUnits.length}` +
          `;postPaint=${postPaintCompileUnits.length}`,
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
        // Cosmetic resume: stage HIDDEN (the slot's hide arm: no group here).
        resumeUnits: weatherSlot.resumeUnits,
        run: weatherSlot.run,
      },
      {
        // A translated clone of the out-of-frustum impact site (impact_site.ts).
        id: 'landmarks.impact-site',
        category: 'props',
        priority: 48,
        required: false,
        // Cosmetic resume, the ghost-fade-variants shape: stage the clone
        // HIDDEN (it stands right in front of the live player), then link it.
        resumeUnits: landmarkSlot.resumeUnits,
        run: landmarkSlot.run,
        detail: landmarkSlot.detail,
      },
      {
        id: 'textures.scene',
        category: 'world',
        priority: 50,
        required: true,
        deadlineExempt: true,
        resumeUnits: () => textureResumeUnits('scene', sceneTextureRemainder()),
        resumePartialUnits: () => textureResumeUnits('scene', sceneTextureRemainder()),
        run: async () => {
          await ensureSceneTextureAdmission().drainBefore(
            gpuSubmitDeadline,
            Math.max(1, policy.textureBatchSize),
          );
        },
        progress: () => sceneTextureAdmission?.progress() ?? null,
        detail: () =>
          `initialized=${sceneTextureAdmission?.progress().initialized ?? 0};` +
          `uploadedDelta=${sceneTextureUploadDelta()}`,
      },
      {
        id: 'vfx.atlas',
        category: 'vfx',
        priority: 60,
        required: false,
        // No resumeUnits: this spawns real particles into the shared pooled VFX
        // system, so rerunning it live would create an unexplained burst.
        run: () => {
          for (const [dx, dz] of VFX_PREWARM_BURST_OFFSETS) {
            if (performance.now() >= deadline) break;
            this.vfx.prewarm(new THREE.Vector3(p.pos.x + dx, p.pos.y + 1, p.pos.z + dz));
            vfxPrewarmBursts++;
          }
        },
        progress: () => ({
          done: vfxPrewarmBursts,
          planned: VFX_PREWARM_BURST_OFFSETS.length,
          trimmed: vfxPrewarmBursts < VFX_PREWARM_BURST_OFFSETS.length,
        }),
        detail: () => `bursts=${vfxPrewarmBursts}`,
      },
      {
        // Weapon-skin rarity VFX: the rigs are worn by OTHER players, so their
        // programs otherwise link the first time a skinned player walks into
        // view, mid-gameplay, on top of the rig build itself (the reported
        // connection freeze). One hidden rig per REAL WEAPON_VFX catalog spec,
        // built through the worn path ({ grounded: false }): a synthetic
        // per-family rig was tried first and still left ~108 first-sight
        // program links, because the component mix differs per spec and each
        // mix links its own program set. The sky dome is deliberately not
        // warmed: the world path builds none.
        id: 'vfx.weapon-skins',
        category: 'vfx',
        priority: 61,
        required: false,
        // One bounded unit per catalog spec; the plan and the reason it is
        // split live in weapon_vfx_prewarm.ts (weaponVfxPrewarmUnits).
        resumeUnits: () =>
          weaponVfxPrewarmUnits(weaponVfxPrewarmSkinStage, {
            prewarmTextures: () => {
              for (const texture of weaponVfxPrewarmTextures()) this.prewarmTexture(texture);
            },
            compile: (group) => this.compilePrewarmColorPrograms(group, false),
            publishGroup: (group) => {
              weaponVfxPrewarmGroup = group;
            },
          }),
        run: () => {
          weaponVfxPrewarmGroup = buildWeaponVfxPrewarmGroup();
          setRenderCategory(weaponVfxPrewarmGroup, 'prewarm');
          this.scene.add(weaponVfxPrewarmGroup);
          for (const texture of weaponVfxPrewarmTextures()) this.prewarmTexture(texture);
        },
        detail: () => `objects=${weaponVfxPrewarmGroup?.children.length ?? 0}`,
      },
      {
        // Spawn one of every pooled ability-VFX primitive (rings, decals,
        // pillar, shell, slash ribbon, overlay sprite). The pools build their
        // meshes visible=false, so no render pass ever draws them: their
        // textures and geometry stay un-uploaded, and the first spec'd cast in
        // the open world used to pay for both synchronously. The spawns bind
        // the per-style decal textures and the six impact sheets, so the
        // texture re-walk below uploads the whole canvas set now.
        // abilityVfxFx.clear() in the finally block hides everything again.
        //
        // resumeUnits deliberately does NOT replay the spawn: run live it
        // would pop a white ring/decal/flipbook burst at the player's feet
        // (the same reason vfx.atlas retains nothing). It carries the
        // invisible half instead, one impact sheet per unit plus one program
        // link per distinct pooled material. That is also the MINIMAL variant
        // constrained devices get in place of this entry
        // (CONSTRAINED_PREWARM_RESUME): there the whole entry is skipped, so
        // each 512px sheet is otherwise drawn on the first impact of its
        // school, i.e. mid-combat.
        id: 'vfx.ability-primitives',
        category: 'vfx',
        priority: 62,
        required: false,
        resumeUnits: () => [
          ...abilityVfxTexturePrewarmSteps().map((step) => ({
            id: `texture:${step.id}`,
            run: () => {
              for (const texture of step.build()) this.prewarmTexture(texture);
            },
          })),
          ...abilityMaterialSlot.resumeUnits(),
          ...collectAbilityVfxCompileTargets(this.scene).map((target) => ({
            id: `program:${target.id}`,
            run: () => this.compilePrewarmColorPrograms(target.object, false),
          })),
        ],
        run: () => {
          this.abilityVfxFx.prewarmSpawn(p.pos.x, p.pos.y, p.pos.z - 5, p.id);
          // The lazily-minted spell materials (ability_material_prewarm.ts):
          // staged hidden here, linked by the compile lane with the rest.
          abilityMaterialSlot.run();
          this.scene.traverse((child) => {
            const renderable = child as RenderableDiagnosticObject;
            if (renderable.userData.renderCategory !== 'vfx' || !renderable.material) return;
            this.prewarmMaterialTextures(renderable.material);
          });
        },
      },
      {
        // Rideable mounts: worn by whoever is riding one, so the FIRST
        // sighting of any given mount links its programs the moment it
        // appears, exactly like vfx.weapon-skins above. The runtime fallback
        // (gateSwapFlagOnCompile at the mount-swap site, see updateEntity) is
        // a no-op without KHR_parallel_shader_compile, so on that hardware
        // this entry is the only mitigation there ever was (#2571). Mount
        // GLBs are lazyPreload (characters/assets.ts): a fetch failure or a
        // timed-out one (mount_prewarm.ts's MOUNT_PREWARM_FETCH_TIMEOUT_MS)
        // drops only that one mount, never the whole entry.
        //
        // The loading-cover path stages only already-resident mount assets,
        // then the shared programs.compile entry links both program halves
        // for that staged group. Missing keys hand off to one explicit
        // background resume unit per mount, where each lazy fetch has its own
        // timeout and then self-compiles because programs.compile has already
        // finished. progress() reports only keys actually staged or resumed,
        // so a deadline-limited pass reports 'partial', never a false
        // 'completed' (the failure mode resolvePrewarmEntryStatus documents).
        id: 'vfx.mount-programs',
        category: 'vfx',
        priority: 63,
        required: false,
        resumeUnits: mountPrewarmResumeUnits,
        resumePartialUnits: mountPrewarmResumeUnits,
        run: async () => {
          for (const key of mountPrewarmPlannedKeys) {
            if (performance.now() >= buildDeadline) break;
            const staged = stageResidentMountPrewarmVisual(this.scene, mountPrewarmGroup, key);
            if (!staged) continue;
            mountPrewarmGroup = staged.group;
            mountPrewarmPendingKeys.delete(key);
            mountPrewarmWarmed++;
          }
        },
        progress: () => ({
          done: mountPrewarmWarmed,
          planned: mountPrewarmPlannedKeys.length,
          trimmed: mountPrewarmPendingKeys.size > 0,
        }),
        detail: () => `mounts=${mountPrewarmGroup?.children.length ?? 0}`,
      },
      {
        // A 2k RGBA16F dome upload blocked a live Mirefen frame for 183ms.
        // WebGL exposes no non-blocking Three.js DataTexture upload, so pay the
        // immediate-neighbour cost while the loading screen still owns the
        // frame. PMREM uses the 1k source but is generated here too, keeping
        // both the dome swap and IBL transition out of gameplay.
        //
        // The fetch + worker decode were kicked off at prewarm start (see
        // skyAssetPrefetch above), so they overlap every compute stage above
        // instead of serializing ahead of them. This entry only waits for the
        // prefetch within the budget the tail entries can spare; biomes whose
        // assets have not arrived defer their uploads to the background lane
        // scheduled after the manifest, and the entry reports partial. The
        // first rendered frame is unaffected either way: the dome/IBL sources
        // the first frame draws were resolved before buildSky ran, and this
        // entry still precedes world.initial-frame so any inline uploads land
        // behind the loading screen. On the async-compile arm orderedPrewarmIds
        // moves programs.compile between this entry and that frame, so the
        // bounded inline wait's reserve is what protects compile RUN time
        // before the compile-unit deadline.
        id: 'sky.nearby-biomes',
        category: 'sky',
        priority: 64,
        required: true,
        // Exempt unconditionally: the exemption was sized when pinned r165
        // paid the 2k RGBA16F dome upload as one indivisible ~183ms call; the
        // installed 0.185 row-batches it via native update ranges, but the
        // batches still total the same GPU work, which must stay behind the
        // loading screen even when a slow MACHINE spent the soft budget while
        // the network stayed healthy. The exemption adds no network wait (the inline wait
        // below is already 0 past the reserve boundary) and the hard deadline
        // still bounds the entry via prewarmEntryShouldDefer. Constrained
        // profiles never run this entry, so the conditional exemption form
        // the tail entries use has nothing to gate here.
        deadlineExempt: true,
        run: async () => {
          if (!skyAssetPrefetch) return;
          const waitMs = skyAssetInlineWaitMs({
            nowMs: performance.now(),
            deadlineMs: deadline,
            reserveMs: PREWARM_BUILD_RESERVE_MS,
            finishFullManifestBeforeReveal: policy.finishFullManifestBeforeReveal,
          });
          const outcome = await waitForPrefetch(skyAssetPrefetch, waitMs, sleep);
          if (outcome === 'ready') {
            // Settled: rethrow a fetch failure so the entry reports failed,
            // exactly as the old inline await did.
            await skyAssetPrefetch.task;
            for (const biome of initialSkyBiomes) {
              this.prewarmTexture(this.skyView.envTexture(biome));
              this.ensureEnvironmentBiome(biome);
              this.prewarmTexture(this.skyView.domeTexture(biome));
            }
            skyWarmedInlineBiomes = initialSkyBiomes.length;
            skyWarmComplete = true;
            return;
          }
          // Slow network: upload what already arrived, defer the rest. The
          // compute budget stays with the manifest tail instead of this wait.
          // Residency is the sky module's two-store predicate: envTexture's
          // dome fallback means neither it nor domeTexture can probe env
          // residency, and a dome-only biome inline here would PMREM (and
          // cache for the session) the full-size dome fallback.
          const split = partitionResidentSkyBiomes(initialSkyBiomes, (biome) =>
            this.skyView.skyBiomeAssetsResident(biome),
          );
          for (const biome of split.resident) {
            this.prewarmTexture(this.skyView.envTexture(biome));
            this.ensureEnvironmentBiome(biome);
            this.prewarmTexture(this.skyView.domeTexture(biome));
          }
          skyWarmedInlineBiomes = split.resident.length;
          skyDeferredBiomes = split.missing;
          // Every biome resident means every upload already happened inline;
          // only the promise's settlement is outstanding, and a lane scheduled
          // for it would log the full set as pending and then no-op through
          // cache-elided steps.
          if (split.missing.length === 0) skyWarmComplete = true;
        },
        progress: () => ({
          done: skyWarmedInlineBiomes,
          planned: initialSkyBiomes.length,
          trimmed: skyDeferredBiomes.length > 0,
        }),
        detail: () =>
          `biomes=${initialSkyBiomes.join(',')}` +
          (skyDeferredBiomes.length > 0 ? `;deferred=${skyDeferredBiomes.join(',')}` : ''),
      },
      {
        id: 'world.initial-frame',
        category: 'world',
        priority: 70,
        required: true,
        // Deadline-exempt, but draws only when the compile lane has no link debt.
        deadlineExempt: true,
        run: () => {
          initialFrameDeferred = initialFrameDeferral(compileLifecycle.records);
          if (initialFrameDeferred) return;
          this.renderPrewarmPass(1 / 60);
          renderPasses++;
        },
        ...deferredPassArms(() => initialFrameDeferred),
      },
      {
        id: 'programs.compile',
        category: 'world',
        priority: 80,
        required: true,
        // Async-capable desktop may continue linking behind the loading cover after
        // the soft 12 s manifest budget, but never launches past the GPU guard.
        // Synchronous compilers and constrained WebKit keep the deadline because
        // they cannot safely wait behind the cover without a hard upper bound.
        deadlineExempt: !constrainedPrewarm && this.asyncCompileSupported,
        // If the loading deadline drops the monolithic compile, retain only
        // explicit archetype-sized roots. Three r165's compileAsync first runs
        // a synchronous traversal, so the live resume lane must never receive
        // this.scene or another whole manifest entry.
        resumeUnits: () => {
          if (!this.asyncCompileSupported || !this.webgl.compileAsync) return [];
          deferPoolPublication = poolsAwaitPublication();
          // Already-submitted groups are in flight off-thread; resuming them
          // would double-submit every unit. Only the never-submitted remainder
          // takes the resume lane.
          const remainder = compileEntryUnits((groupId) => !submittedCompileGroups.has(groupId));
          compileUnitsDropped = remainder.length;
          return remainder;
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
          // Submit whatever the early entry did not cover: its own deferral,
          // the late-staged groups (weapon-vfx stages at priority 61), any
          // group that did not exist yet back then (landmark stages at 48),
          // and the live-scene re-collection.
          await submitCompileUnits(
            true,
            Math.min(gpuSubmitDeadline, compileAwaitDeadline),
            'programs.compile',
          );
          compileUnitsPlanned =
            submittedCompileUnits.length +
            deferredSubmitUnits.length +
            postPaintCompileUnits.length;
          // Honesty gate: units deferred mid-run went to the resume lane, so
          // this entry must report 'partial', never 'completed'
          // (resolvePrewarmEntryStatus reads trimmed via the dropped count).
          compileUnitsDropped = deferredSubmitUnits.length + postPaintCompileUnits.length;
          // Await every submitted unit so all of their programs are READY
          // before world.initial-frame renders (a program still linking by
          // then links synchronously inside that frame, the measured
          // first-draw stall class), bounded by compileAwaitDeadline:
          // prewarmEntryShouldDefer defers ANY entry, even the
          // deadlineExempt world.initial-frame that compileBeforeFirstFrame
          // reorders to run right after this one, the instant its start
          // time reaches the hard deadline. An unbounded await risked
          // pushing that start past the wall on a pathological driver link
          // tail (no shader disk cache, a serialized linker); world.initial-
          // frame has no resumeUnits, so a deferred start SKIPPED it
          // outright and left the whole scene to link synchronously at
          // first LIVE draw instead, the exact stall this lane exists to
          // prevent. On a lost race we stop AWAITING, never resubmit: every
          // unit's compileAsync is already in flight off-thread, and
          // resubmitting would double-submit it. Each unit's done handler
          // below keeps running and counting after the race is lost, so the
          // honesty gate's done/planned count stays accurate, and whatever
          // is still linking when world.initial-frame draws links
          // synchronously inside that guaranteed, still-covered frame
          // instead: the same accepted behind-the-cover overrun class as
          // the frame itself.
          const awaitAll = Promise.all(
            submittedCompileUnits.map((unit) =>
              unit.done.then(() => {
                compileUnitsDone++;
              }),
            ),
          );
          const budgetMs = Math.max(0, compileAwaitDeadline - performance.now());
          const outcome = await Promise.race([
            awaitAll.then(() => 'settled' as const),
            sleep(budgetMs).then(() => 'timeout' as const),
          ]);
          if (outcome === 'timeout') compileTimedOut = true;
          compileMs = roundMs(performance.now() - compileStart);
          compileTimedOut ||= compileMs > policy.compileMaxMs;
        },
        // Units are never trimmed mid-entry anymore (the entry awaits every
        // submitted unit); the trimmed flag survives for the whole-entry
        // deferral path, where the never-submitted remainder drops to the
        // resume lane (resumeUnits above records the count). The
        // skipped-monolith arm plans no units and keeps the historical
        // completed status.
        progress: () =>
          compileUnitsPlanned > 0
            ? {
                done: compileUnitsDone,
                planned: compileUnitsPlanned,
                trimmed: compileUnitsDropped > 0,
              }
            : null,
        detail: () =>
          `mode=${compileMode};timedOut=${compileTimedOut};compileRoots=${compiledPrewarmRoots}` +
          (compileUnitsDropped > 0 ? `;deferred=${compileUnitsDropped}` : ''),
      },
      {
        id: 'programs.budget-variants',
        category: 'world',
        priority: 85,
        required: true,
        deadlineExempt: !constrainedPrewarm && this.asyncCompileSupported,
        run: async () => {
          budgetVariantsDeferred = initialFrameDeferral(compileLifecycle.records);
          if (budgetVariantsDeferred) return;
          if (!GFX.autoGovernor || !this.asyncCompileSupported) return;
          const originalState = this.renderBudgetGovernor.state();
          await withRestoredPrewarmState(
            () => ({
              state: originalState,
              appliedLevels: this.appliedBudgetLevels ? { ...this.appliedBudgetLevels } : null,
              qualityChange: this.lastQualityChange,
            }),
            (original) => {
              this.applyRenderBudgetState(original.state);
              this.appliedBudgetLevels = original.appliedLevels;
              this.lastQualityChange = original.qualityChange;
            },
            async () => {
              compileTimedOut ||= runPrewarmBudgetVariants(
                renderBudgetShaderPrewarmLevels(originalState),
                budgetVariantStats,
                createPrewarmBudgetVariantHost({
                  deadlineMs: gpuSubmitDeadline,
                  programCount: () => this.webgl.info.programs?.length ?? 0,
                  applyLevels: (levels) =>
                    this.applyRenderBudgetState({ ...originalState, levels }),
                  renderPass: () => {
                    this.renderPrewarmPass(1 / 60);
                    return ++renderPasses;
                  },
                }),
              ).timedOut;
            },
          );
        },
        ...deferredPassArms(() => budgetVariantsDeferred, false),
        budgetVariants: () => budgetVariantStats,
      },
      {
        id: 'sky.current-zone',
        deadlineExempt: !constrainedPrewarm && this.asyncCompileSupported,
        category: 'sky',
        priority: 90,
        required: false,
        // No resumeUnits: this would present real frames in a synchronous loop.
        run: () => {
          for (const point of skyZonePoints) {
            if (performance.now() >= gpuSubmitDeadline) break;
            if (initialFrameDeferral(compileLifecycle.records)) break;
            this.skyView.setCameraPos(point.x, point.z, 1 / 20);
            this.renderPrewarmPass(1 / 60);
            renderPasses++;
            skyZonePasses++;
          }
        },
        progress: () => ({
          done: skyZonePasses,
          planned: skyZonePoints.length,
          trimmed: skyZonePasses < skyZonePoints.length,
        }),
      },
      {
        id: 'render.settle-passes',
        deadlineExempt: !constrainedPrewarm && this.asyncCompileSupported,
        category: this.post ? 'post' : 'world',
        priority: 100,
        required: false,
        // No resumeUnits, and none needed: after the reveal the live frames ARE the passes.
        run: () => {
          while (
            renderPasses < settleMinPasses &&
            performance.now() < gpuSubmitDeadline &&
            !initialFrameDeferral(compileLifecycle.records)
          ) {
            this.renderPrewarmPass(1 / 60);
            renderPasses++;
          }
        },
        progress: () => ({
          done: renderPasses,
          planned: settleMinPasses,
          trimmed: renderPasses < settleMinPasses,
        }),
        detail: () => `passes=${renderPasses}`,
      },
      {
        id: 'diagnostics.baseline',
        deadlineExempt: true,
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
        // deliberately not warmed. The skipped warms happen lazily in-world,
        // except for the few entries that opt into the background resume lane
        // (CONSTRAINED_PREWARM_RESUME): those hand over their explicit small
        // units, which run after entry instead of never.
        if (!prewarmEntryRuns(entry.id, policy)) {
          const counts = liveProgramWatch.programCounts(this.webgl);
          const skipUnits = prewarmEntryResumesAfterSkip(entry.id, policy)
            ? (entry.resumeUnits?.() ?? [])
            : [];
          if (skipUnits.length > 0) droppedEntries.push({ id: entry.id, units: skipUnits });
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
            detail:
              skipUnits.length > 0
                ? `constrained-minimal;resume=${skipUnits.length}`
                : 'constrained-minimal',
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

    // Deferred compile-submit units whose owner never drained them (the
    // compile entry itself was dropped, or its drain hit the deadline again):
    // their roots are consumed in the shared dedupe store, so these unit
    // objects are the only remaining route to those compiles. Hand them to
    // the resume lane as link debt rather than dropping them (the production
    // failure this lane exists for, hitch-hunt P1).
    if (deferredSubmitUnits.length > 0) {
      droppedEntries.push({
        id: 'programs.compile-submit',
        units: deferredSubmitUnits.splice(0, deferredSubmitUnits.length),
      });
    }
    if (postPaintCompileUnits.length > 0) {
      droppedEntries.push({
        id: 'programs.compile-post-paint',
        units: postPaintCompileUnits.splice(0, postPaintCompileUnits.length),
      });
    }

    // Either arm needs the settle-then-publish scheduling below: real dropped
    // work (droppedEntries), or the compile entry's resumeUnits callback
    // withholding pool publication (deferPoolPublication) even though its OWN
    // remainder came back empty, because the shared compile dedupe store can
    // leave nothing left to resume while the early-submitted units are still
    // settling off-thread. droppedEntries.length alone stranded the withheld
    // pools in that case: the finally block above never publishes them when
    // deferPoolPublication is set, so this is the only remaining place that can.
    if (droppedEntries.length > 0 || deferPoolPublication) {
      // Fire-and-forget: world-entry timing does not depend on this. Every
      // retained item is an explicit small unit, never a whole entry rerun.
      // Debt first: the lane is strictly serial in array order, so the
      // BOOT_DEBT priority alone cannot reorder it; manifest order would put
      // the cosmetic entries (which resume BELOW the preview lane) ahead of
      // the link/upload debt, the exact starvation this lane exists to fix.
      const resume = orderPrewarmResumeEntries(droppedEntries);
      resumeLedger.schedule(resume, prewarmResumeIsDebt);
      const dropped = resume.map((entry) => entry.id).join(',');
      if (dropped.length > 0) {
        console.info(`[entry-guard] prewarm resume scheduled: dropped=[${dropped}]`);
      }
      void settlePrewarmBeforePublish(
        async () => {
          await options.resumeAfterFirstPaint;
          // If 'programs.compile' itself was deferred past the hard deadline,
          // its early-submitted units may still be settling off-thread; wait
          // them out before the resume lane (and pool publication) proceeds,
          // so the resume lane never overlaps the in-flight submissions. This
          // await also covers the deferPoolPublication-only case (an empty
          // `resume`): pool publication still waits for the same settlement.
          await Promise.allSettled(submittedCompileUnits.map((unit) => unit.done));
          return resumeDroppedPrewarmEntries(resume, {
            idleSlot: () => idleSlot(IDLE_PREWARM_TIMEOUT_MS, { maxTimeoutDeferrals: 2 }),
            runUnit: (unit, entry) => {
              // Link/upload debt runs at BOOT_DEBT so the cosmetic BACKGROUND
              // warmers (the preview lane) cannot starve it (hitch-hunt P1:
              // minutes of unpaid link debt behind the previews). A debt
              // BATCH (no pieces) keeps its tail HELD: released, its 16 to 32
              // links piled into the driver at once (sub-1-fps for a minute
              // with a dropped manifest). A debt ROOT piece releases its tail:
              // ONE link under the released-tail cap, whereas a held root
              // blocked the queue head for its whole link wait behind the
              // driver's queue (batch 18: 4.0 s on the iGPU, reveals starved).
              const debt = prewarmResumeIsDebt(entry.id);
              resumeLedger.noteStart(entry.id);
              const priority = debt ? GPU_WORK_PRIORITY.BOOT_DEBT : GPU_WORK_PRIORITY.BOOT_RESUME;
              const run = () => {
                if (debt && unit.pieces) {
                  return runPrewarmPiecesSerially(unit.pieces, (piece) =>
                    this.backgroundGpuWork.run(piece.run, priority, piece.id, {
                      releaseTail: true,
                    }),
                  );
                }
                // Cosmetic resume keeps the released tail (held, a 16-root unit
                // blocked live compile gates for seconds: travel hitches).
                return this.backgroundGpuWork.run(unit.run, priority, unit.id, {
                  releaseTail: !debt,
                });
              };
              return entry.id.startsWith('programs.compile')
                ? runPrewarmCompileResumeUnit(
                    unit,
                    compileLifecycle,
                    'programs.compile-resume',
                    run,
                  )
                : run();
            },
            afterEntry: hidePrewarmArtifacts,
            onUnitError: (entry, unit, error) => {
              resumeLedger.noteFailure(entry.id, unit.id);
              // Per SKIN, never the whole catalog: the ledger's boundary is
              // one unit, and the skins staged before this one keep their
              // linked programs (see WeaponVfxPrewarmSkinStage).
              if (entry.id === 'vfx.weapon-skins') {
                weaponVfxPrewarmSkinStage.disposeFailedUnit(unit.id);
                weaponVfxPrewarmGroup = weaponVfxPrewarmSkinStage.group;
              }
              console.warn(`Renderer prewarm resume unit failed: ${entry.id}:${unit.id}`, error);
            },
          });
        },
        () => cleanupPrewarmArtifacts({ clearVfx: false, publishPools: true }),
      )
        .then(() => {
          resumeLedger.finish(true);
          if (resume.length === 0) return;
          const done = resumeLedger.stats();
          console.info(
            `[entry-guard] prewarm resume done: units=${done.plannedUnits};failed=[${done.failedUnitIds.join(',')}]`,
          );
        })
        .catch((err) => {
          resumeLedger.finish(false);
          console.warn('Renderer prewarm resume failed', err);
        });
    }

    // Sky uploads deferred behind a slow prefetch (or a deadline-dropped sky
    // entry) join the world once their data arrives, on the same off-critical
    // path treatment the live zone-crossing lane uses (prepareZoneSky's idle
    // arm): chunked idle texture uploads plus the arbiter for the indivisible
    // PMREM unit. Its own lane, deliberately NOT the droppedEntries resume
    // above: that lane serially awaits each unit's settlement, so a unit
    // holding the network wait would park dropped compile units behind a
    // black-holed fetch (3217's releaseTail frees only the queue, never the
    // resume lane's own await, and a never-settling tail would pin one of the
    // queue's bounded tail slots for the session). Entering the queue only
    // AFTER the data is resident keeps network waits out of both. Every step
    // is cache-elided, so anything the entry already uploaded inline costs
    // nothing here.
    // The rejection gate: a prefetch that already failed has nothing for the
    // lane to upload, and the entry (when it ran) already reported failed;
    // scheduling the lane anyway would log a deferral for work that can never
    // run and then warn a second time from the lane's catch.
    if (skyAssetPrefetch && !skyWarmComplete && skyAssetPrefetch.rejection() === null) {
      const resumeBiomes = initialSkyBiomes.slice();
      // skyDeferredBiomes is the partitioned remainder when the entry ran;
      // when the entry never ran (wholesale-deferred) it is empty and the
      // pending work is the whole resume set.
      const pendingBiomes = skyDeferredBiomes.length > 0 ? skyDeferredBiomes : resumeBiomes;
      console.info(
        `[entry-guard] sky prewarm deferred: pending=[${pendingBiomes.join(',')}] resume=${resumeBiomes.length}`,
      );
      // The trigger is a network promise that can settle minutes after this
      // renderer is gone, and every await below yields: guard on the captured
      // lifecycle generation like every other post-boot async path, or a stale
      // completion would recreate GPU state (ensureEnvironmentBiome re-mints
      // the pmremGenerator disposeRendererResources nulled) on a dead renderer.
      const generation = this.lifecycleGeneration;
      void skyAssetPrefetch.task
        .then(async () => {
          await options.resumeAfterFirstPaint;
          if (this.shutdownStarted || generation !== this.lifecycleGeneration) return;
          for (const biome of resumeBiomes) {
            // BOOT_RESUME throughout: the dome/env uploads inside the helper
            // must not outrank the lane's own PMREM unit below.
            await this.prewarmTextureInIdle(
              this.skyView.envTexture(biome),
              GPU_WORK_PRIORITY.BOOT_RESUME,
            );
            if (this.shutdownStarted || generation !== this.lifecycleGeneration) return;
            await idleSlot(IDLE_PREWARM_TIMEOUT_MS, { maxTimeoutDeferrals: 2 });
            if (this.shutdownStarted || generation !== this.lifecycleGeneration) return;
            await this.backgroundGpuWork.run(
              () => this.ensureEnvironmentBiome(biome),
              GPU_WORK_PRIORITY.BOOT_RESUME,
              `sky-resume-pmrem:${biome}`,
            );
            if (this.shutdownStarted || generation !== this.lifecycleGeneration) return;
            await this.prewarmTextureInIdle(
              this.skyView.domeTexture(biome),
              GPU_WORK_PRIORITY.BOOT_RESUME,
            );
            if (this.shutdownStarted || generation !== this.lifecycleGeneration) return;
          }
          console.info(`[entry-guard] sky prewarm resume done: biomes=${resumeBiomes.length}`);
        })
        .catch((err) => {
          console.warn('Renderer deferred sky prewarm failed', err);
        });
    }

    const elapsed = performance.now() - started;
    const finalCounts = liveProgramWatch.programCounts(this.webgl);
    textureUploads = sceneTextureUploadDelta();
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
      ...summarizePrewarmManifest(manifestEntries),
      get resume() {
        return resumeLedger.stats();
      },
      diagnosticsBaseline,
      compileUnits: compileLifecycle.records,
      prewarmPacing: pacing.receipt(compileBatchRoots, hardMaxMs),
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
        `skipped=${stats.manifestSkipped} partial=[${stats.partialEntryIds.join(',')}] ` +
        `timedOut=[${stats.timedOutEntryIds.join(',')}] ` +
        `failed=[${stats.failedEntryIds.join(',')}]`,
    );
    return stats;
  }

  // Visual reactions to sim events (called by the HUD for every event,
  // including those between other players and mobs).
  private sentenceImpactFeedback(sourceId: number, targetId: number, condemnation: number): void {
    const plan = sentenceImpactPlan(condemnation, sourceId === this.sim.playerId);
    this.pulseAt(targetId, 'shadow', plan.light, plan.duration);
    if (plan.shake > 0) this.addShake(plan.shake);
    if (plan.fovPunch > 0) this.punchFov(plan.fovPunch);
  }

  handleEvent(ev: SimEvent): void {
    switch (ev.type) {
      case 'castStart': {
        if (ev.ability === 'needle_of_fate') {
          this.needleOfFateVfx.beginCast(ev.entityId, ev.time);
        }
        break;
      }
      case 'castStop': {
        this.needleOfFateVfx.endCast(ev.entityId);
        break;
      }
      case 'spellfx': {
        if (ev.fx === 'lichTransform') {
          if (!this.reducedMotion()) {
            this.vfx.lichTransform(ev.sourceId);
            this.pulseAt(ev.sourceId, 'shadow', 8, 0.6);
          }
          const view = this.views.get(ev.sourceId);
          const source = this.sim.entities.get(ev.sourceId);
          const x = view?.group.position.x ?? source?.pos.x;
          const y = view?.group.position.y ?? source?.pos.y;
          const z = view?.group.position.z ?? source?.pos.z;
          if (x !== undefined && y !== undefined && z !== undefined) {
            this.audioSink?.necromancy(
              'lichTransform',
              x,
              y,
              z,
              ev.sourceId === this.sim.playerId,
              ev.sourceId,
            );
          }
          if (ev.sourceId === this.sim.playerId) {
            this.addShake(0.42);
            this.punchFov(2.6);
          }
          break;
        }
        if (
          ev.fx === 'projectile' &&
          ev.ability === 'soul_harvest' &&
          this.sim.entities.get(ev.sourceId)?.auras.some((aura) => aura.kind === 'form_lich')
        ) {
          const view = this.views.get(ev.sourceId);
          if (view?.metamorphVisual?.metamorphHandWorldPositions(this.tmpV, this.tmpV2)) {
            this.vfx.deathBolt(this.tmpV, this.tmpV2, ev.targetId);
            view.metamorphVisual.pulseMetamorphosis();
          } else {
            this.vfx.projectile(ev.sourceId, ev.targetId, ev.school, 1.3);
          }
          break;
        }
        if (isNeedleOfFateProjectile(ev)) {
          this.needleOfFateVfx.spawn(ev.sourceId, ev.targetId);
          break;
        }
        if (ev.fx === 'sentenceBurst') {
          const condemnation = Math.max(20, Math.min(100, ev.level ?? 20));
          if ((ev.threads ?? 0) > 0) {
            this.sentenceVfx.trigger(ev.sourceId, ev.targetId, condemnation, ev.threads);
          } else {
            this.sentenceVfx.trigger(ev.sourceId, ev.targetId, condemnation);
          }
          break;
        }
        if (
          ev.fx === 'heavyBolt' &&
          !ev.ability &&
          this.sim.entities.get(ev.sourceId)?.kind === 'player' &&
          this.sim.entities.get(ev.sourceId)?.templateId === 'warlock' &&
          this.abilityVfx.handleSpellfx({ ...ev, ability: 'chaos_bolt' })
        ) {
          // The legacy Ruinbolt wire cue predates ability ids. Alias it before
          // the generic registry claim so only Warlocks receive Chaos Bolt's
          // authored projectile identity.
          break;
        }
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
          // the clip's release pose. `ability` rides along so a mob one-shot
          // can pick its authored clip via attackByAbility (the dragonkin
          // brood's Cleave/Stun); every petSpell emitter sends none, so their
          // rotation is unchanged.
          this.triggerAttack(ev.sourceId, ev.ability);
          break;
        }
        if (isMobEngageCue(ev.fx, this.sim.entities.get(ev.sourceId)?.kind)) {
          // A MOB's own cue: 'shout' is the dragonkin brood's rooted engage
          // bellow (broodguards and the broodlords; the lords' version also
          // cracks the clutch awake), and 'flourish' is a whelp's hatch pounce.
          // Both play the visual's flourish one-shot (Shout / JumpAttack); the
          // shout adds a pulse so the wake-up reads at a distance.
          //
          // Gated on the SOURCE so PLAYER castFx keeps reaching the warrior cast
          // plan below: the six warrior shouts and raised_guard ride these same
          // two fx kinds. raised_guard was the reachable loss, since the ability
          // painter above claims 'shout' but never 'flourish', so swallowing it
          // here traded its authored Block gesture for a playFlourish() no-op on
          // a rig that has no flourish clip. See isMobEngageCue for why the
          // ability id is the wrong discriminator and why a reorder does not fix
          // it, and tests/renderer_spellfx_dispatch_order.test.ts for the pin.
          const v = this.views.get(ev.sourceId);
          const vis = v ? this.activeVisual(v) : null;
          vis?.playFlourish();
          if (ev.fx === 'shout') this.pulseAt(ev.sourceId, ev.school, 1.8, 0.5);
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
        if (ev.fx === 'projectile') {
          this.vfx.projectile(ev.sourceId, ev.targetId, ev.school);
        } else if (ev.fx === 'heavyBolt')
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
        } else if (ev.fx === 'drainBeam') {
          const duration = ev.duration ?? 5;
          if (duration > 0 || this.sim.entities.has(ev.sourceId))
            this.drainChannelStopLatch.noteEvent(ev.sourceId, ev.targetId, duration, this.time);
          this.vfx.drainBeam(ev.sourceId, ev.targetId, duration);
          if (duration > 0) {
            const source = this.sim.entities.get(ev.sourceId);
            if (
              source?.auras.some(
                (aura) => aura.kind === 'affliction_possession' && aura.remaining > 0,
              )
            ) {
              this.vfx.demonicDrainBeam(ev.sourceId, ev.targetId, duration);
              this.snapshotDemonicDrainVisualChannels.add(ev.sourceId);
            }
          } else {
            this.snapshotDrainVisualChannels.delete(ev.sourceId);
            this.snapshotDemonicDrainVisualChannels.delete(ev.sourceId);
            this.vfx.demonicDrainBeam(ev.sourceId, ev.targetId, 0);
          }
        } else if (ev.fx === 'evilEyeGaze') {
          this.vfx.evilEyeGaze(ev.sourceId, ev.targetId, ev.duration ?? 0.28);
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
        } else if (ev.fx === 'paladinAscensionStart') {
          // The persistent seal and crown are the complete activation presentation.
        } else if (ev.fx === 'paladinAscensionImpact') {
          this.vfx.paladinAscensionImpact(ev.sourceId, ev.targetId, ev.impact);
          this.pulseAt(ev.impact === 'area' ? ev.sourceId : ev.targetId, 'holy', 10, 0.5);
        } else if (ev.fx === 'paladinHolyShock') {
          this.vfx.paladinHolyShock(
            ev.sourceId,
            ev.targetId,
            ev.impact === 'healing' ? 'heal' : 'damage',
          );
        } else if (ev.fx === 'paladinSunwardDisc') {
          if ((ev.level ?? 0) === 0) this.triggerAttack(ev.sourceId, 'sunward_disc');
          this.vfx.paladinSunwardDisc(ev.sourceId, ev.targetId, ev.level ?? 0, ev.count ?? 3);
        } else if (ev.fx === 'paladinSunwardDiscImpact') {
          this.vfx.paladinSunwardDiscImpact(ev.sourceId, ev.targetId, ev.level ?? 0, ev.count ?? 3);
        } else if (ev.fx === 'paladinBastionSweep') {
          const source = this.sim.entities.get(ev.sourceId);
          if (source) {
            this.triggerAttack(ev.sourceId, 'bastion_sweep');
            this.vfx.paladinBastionSweep(
              ev.sourceId,
              ev.range ?? 6,
              ev.angle ?? 180,
              ev.facing ?? source.facing,
            );
          }
        } else if (ev.fx === 'paladinBastionSweepImpact') {
          this.vfx.paladinBastionSweepImpact(ev.targetId);
        } else if (ev.fx === 'paladinDawnfall') {
          this.triggerAttack(ev.sourceId, ev.ability);
          this.vfx.paladinDawnfall(ev.sourceId, ev.range ?? 6);
          this.pulseAt(ev.sourceId, 'holy', 8, 0.45);
        } else if (ev.fx === 'paladinDawnfallImpact') {
          this.vfx.paladinDawnfallImpact(ev.targetId);
        } else if (ev.fx === 'paladinFinalEdict') {
          this.vfx.paladinFinalEdict(ev.sourceId, ev.targetId);
          this.pulseAt(ev.targetId, 'holy', 11, 0.4);
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
            if (!vis?.isMidOneShot) this.triggerAttack(ev.sourceId, ev.ability);
          }
        }
        break;
      }
      case 'spellfxAt': {
        if (ev.fx === 'soulTravel') {
          if (ev.targetId !== undefined) {
            const gy = groundHeight(ev.x, ev.z, this.sim.cfg.seed);
            const targetId = ev.targetId;
            this.vfx.soulTravel(ev.x, gy + 0.8, ev.z, targetId, (position: THREE.Vector3) => {
              this.audioSink?.necromancy(
                'soulConsume',
                position.x,
                position.y,
                position.z,
                targetId === this.sim.playerId,
                targetId,
              );
            });
          }
          break;
        }
        if (
          routeWarlockMeteorSpellfxAt(
            ev,
            this.warlockMeteorFx,
            warlockMeteorDensityScale(
              coerceFxTier(
                typeof document === 'undefined'
                  ? undefined
                  : document.documentElement.dataset.fxLevel,
              ),
            ),
          )
        )
          break;
        if (ev.ability === 'abyssal_rift' && ev.fx === 'nova') {
          this.abyssalRiftFx.spawn({ x: ev.x, z: ev.z, radius: ev.radius ?? 8, duration: 2.2 });
        }
        if (ev.ability === 'army_of_the_dead' && ev.fx === 'burst') {
          this.necromancyArmyPortalFx.spawn({
            x: ev.x,
            z: ev.z,
            facing:
              ev.sourceId === undefined ? 0 : (this.sim.entities.get(ev.sourceId)?.facing ?? 0),
            duration: 2.8,
          });
        }
        // Spec-driven ground-cast visuals claim the point-anchored cues first
        // (aimed 'nova'/'burst' landings and 'tick' zone pulses). The painter
        // deliberately never claims meteorFall/snowZone/runeCircle/orb: those
        // four are stateful lifetime visuals (a ball timed to its landing,
        // snowfall over the zone's whole life, a persistent inscription, the
        // roaming orb) that its one-shot sequences would read worse than, so
        // their dedicated arms below stay authoritative.
        if (this.abilityVfx.handleSpellfxAt(ev)) {
          if (ev.ability === 'corpse_explosion' && ev.sourceId !== undefined) {
            const lich = this.sim.entities
              .get(ev.sourceId)
              ?.auras.some((aura) => aura.kind === 'form_lich');
            this.necromancyGroundFx.spawnDesecration({
              x: ev.x,
              z: ev.z,
              radius: ev.radius ?? 8,
              duration: lich ? 5 : 2.5,
            });
            if (lich) this.views.get(ev.sourceId)?.metamorphVisual?.pulseMetamorphosis();
          }
          break;
        }
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
            sourceId: ev.sourceId,
            ability: ev.ability,
          });
          break;
        }
        if (ev.fx === 'snowZone') {
          const zoneDuration = ev.duration ?? 6;
          this.mageGroundFx.spawnSnow({
            x: ev.x,
            z: ev.z,
            radius: ev.radius ?? 7,
            duration: zoneDuration,
          });
          // Blizzard specifically: the storm loops for the zone's whole life.
          // Keyed by ability id (spellfxAt carries no per-cast/caster id), so
          // two casters both storming at once share one audio voice; a real
          // edge case, not a correctness issue.
          if (ev.ability === 'blizzard') {
            const zoneY = groundHeight(ev.x, ev.z, this.sim.cfg.seed);
            this.audioSink?.timedGroundLoop(
              `groundZone:${ev.ability}`,
              'blizzard',
              ev.x,
              zoneY,
              ev.z,
              zoneDuration,
            );
          }
          break;
        }
        if (ev.fx === 'runeCircle') {
          this.mageGroundFx.spawnRune({
            x: ev.x,
            z: ev.z,
            radius: ev.radius ?? 8,
            duration: ev.duration ?? 15,
            school: ev.school,
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
        if (
          ev.ability === 'corpse_explosion' &&
          ev.sourceId !== undefined &&
          this.sim.entities.get(ev.sourceId)?.auras.some((aura) => aura.kind === 'form_lich')
        ) {
          this.necromancyGroundFx.spawnDesecration({
            x: ev.x,
            z: ev.z,
            radius: ev.radius ?? 8,
            duration: 5,
          });
          this.views.get(ev.sourceId)?.metamorphVisual?.pulseMetamorphosis();
        }
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
        if (attackAbilityId(ev.ability) === 'drain_life') this.vfx.drainLifeTick(ev.sourceId);
        this.abilityVfx.onDamage(ev);
        break;
      }
      case 'heal2':
        // Throttle the particle bloom to one per target per 110ms so a burst of tiny
        // simultaneous heals (a Chronomancy group echo converting an AoE that hit
        // several enemies onto five allies in one frame) cannot spike the particle
        // count. Targets without a view have no VFX anchor, so do not timestamp
        // them and suppress the first bloom after they become visible. The healing
        // number itself (FCT) is emitted elsewhere and unaffected.
        if ((ev.amount > 0 || ev.crit) && this.views.has(ev.targetId)) {
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
      case 'worldObjectBurning': {
        // A torched murloc hut (q_deepfen_purge) bursts into flame. First-pass
        // fire cue: a strong low burst plus a taller follow-up so it reads as
        // catching, not a single puff. The lingering blaze is iterated in playtest.
        const gy = groundHeight(ev.x, ev.z, this.sim.cfg.seed);
        this.vfx.burst(new THREE.Vector3(ev.x, gy + 0.6, ev.z), 'fire', 48, 2.2);
        this.vfx.burst(new THREE.Vector3(ev.x, gy + 1.4, ev.z), 'fire', 30, 1.6);
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

  private createView(e: Entity, opts?: AssembleOptions, requiredForEntry = false): void {
    const started = performance.now();
    this.buildView(e, opts, requiredForEntry);
    const view = this.views.get(e.id);
    if (!view) return;
    const kind = viewBuildClass(e, this.sim.player.id, view.visual);
    this.buildLedger.record(`view:${kind}`, performance.now() - started, started);
  }

  private buildView(e: Entity, opts?: AssembleOptions, requiredForEntry = false): void {
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
      objectMesh = body;
    } else if (e.kind === 'object' && e.templateId === 'mailbox') {
      // Ravenpost pillar: bespoke procedural prop (no sparkle; the unread-mail
      // votive in the group is the per-viewer beacon, toggled in sync()).
      const built = buildMailboxPillar(e.id);
      body = built.group;
      height = built.height;
      objectMesh = body;
    } else if (e.kind === 'object' && e.templateId === 'noticeboard_eastbrook') {
      // The civic board is itself the readable interaction landmark. Keep the
      // complete GLB on every tier and avoid the generic loot sparkle.
      const built = buildEastbrookNoticeboard();
      body = built.group;
      height = built.height;
      objectMesh = body;
    } else if (e.kind === 'object' && e.objectItemId === 'soulwell') {
      // Temporary Warlock party utility: bespoke procedural prop today, kept
      // behind buildSoulwell so a generated GLB can replace it later.
      objectPoolKey = null;
      const built = buildSoulwell(e.id);
      body = built.group;
      height = built.height;
      objectMesh = body;
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
          this.sparkleMat = markSharedMaterial(
            new THREE.SpriteMaterial({
              map: sparkleTexture(),
              transparent: true,
              depthWrite: false,
            }),
          );
          if (!this.lowGfx) this.sparkleMat.color.setScalar(SPARKLE_BOOST);
        }
        sparkle = new THREE.Sprite(this.sparkleMat);
        sparkle.scale.set(0.9, 0.9, 1);
        sparkle.position.y = 1.35;
        group.add(sparkle);
      }
    } else if (e.kind === 'object' && e.templateId?.startsWith('bg_')) {
      // Battleground flags/runes: stateful (team color, carrier), so skip the
      // object pool (the delve_ precedent) and build the dedicated body. No
      // loot sparkle: the flag pennant / rune glow is the beacon.
      objectPoolKey = null;
      const built = buildBattlegroundObject(e.templateId, e.color, this.lowGfx);
      body = built.group;
      height = built.height;
      objectMesh = body;
      // Hoist the per-frame handles onto the VIEW group. battleground_fx.ts
      // reads `view.group.userData.bg`, and view.group is this method's own
      // wrapper, the built body goes in as a CHILD of it further down, so the
      // refs the props builder set are one level too deep to be found. Without
      // this the fx pass hits `if (!bg) continue` for every rune and flag and
      // silently animates nothing: no rune spin or bob, no pad light pulse, no
      // Ward shard orbit, and no flag carrier ring or lean.
      group.userData.bg = built.group.userData.bg;
    } else if (e.kind === 'object') {
      // Pool MISS keeps its pool key (mirrors the character-visual pool's
      // "Pool MISS: build a fresh visual but KEEP its pool key" above): see
      // ground_object_pool.ts for why nulling it here used to corrupt the
      // forever-cached, geometry-sharing template every ground object clones.
      const result = takeOrBuildGroundObject(this.objectPool, groundObjectPoolKey(e), () =>
        buildGroundQuestObject(e.objectItemId ?? '', e.id),
      );
      // takeOrBuildGroundObject pops through its own internal takePooledObject,
      // not this class's storePooledObject counterpart, so a HIT here must mirror
      // storePooledObject's increment by decrementing pooledObjectCount itself;
      // otherwise the retention cap (GFX.maxPooledObjects) only ever counts up.
      if (result.reused) this.pooledObjectCount = Math.max(0, this.pooledObjectCount - 1);
      objectPoolKey = result.poolKey;
      body = result.object.group;
      height = result.object.height;
      if (result.reused) body.rotation.y = (e.id % 7) * 0.45;
      objectMesh = body;
      if (!this.sparkleMat) {
        this.sparkleMat = markSharedMaterial(
          new THREE.SpriteMaterial({
            map: sparkleTexture(),
            transparent: true,
            depthWrite: false,
          }),
        );
        if (!this.lowGfx) this.sparkleMat.color.setScalar(SPARKLE_BOOST); // gold glint via bloom
      }
      sparkle = new THREE.Sprite(this.sparkleMat);
      sparkle.scale.set(0.9, 0.9, 1);
      sparkle.position.y = 1.35;
      group.add(sparkle);
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
      visual = visualPoolKey ? this.pooledVisuals.take(visualPoolKey, e.color) : null;
      if (!visual) {
        // Pool MISS: build a fresh visual but KEEP its pool key so removeView returns
        // it to the pool (which self-sizes to demand) instead of disposing it. Disposing
        // a skinned visual frees its Skeleton's bone-matrix DataTexture; re-creating it
        // when the entity streams back re-uploads that texture - the open-world
        // "asset-upload" travel hitch. Before, only the few prewarm-seeded copies were
        // ever recycled, so every mob past that count churned. Key is per-template, so
        // the pool stays bounded by the peak simultaneous count.
        visual = this.createCharacterVisualWithRetry(e, 'view', undefined, opts);
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
      // the light budget reads light.getWorldPosition, and updateWorldMatrix
      // does NOT heal through a matrixWorldAutoUpdate=false ancestor (r185
      // visits the gated ancestor but skips its compose; r165 never healed it
      // either), so a gated group would rank the light at a stale position.
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
      metamorphVisual: null,
      fireballTravelVisual: null,
      iceBlockVisual: null,
      temporalHourglassVisual: null,
      frostNovaRootVisual: null,
      mageBarrierVisual: null,
      priestMarkersVisual: null,
      paladinAscensionVisual: null,
      paladinAvengingWrathVisual: null,
      paladinOathChainVisual: null,
      paladinAegisVisual: null,
      paladinSunVerdictVisual: null,
      height,
      clickTarget,
      sparkle,
      objectMesh,
      objectPoolKey,
      builtTemplateId: e.kind === 'object' ? e.templateId : undefined,
      portal,
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
      lastY: e.pos.y,
      swimPitch: 0,
      wasWading: false,
      skin: e.skin,
      mainhandItemId: e.mainhandItemId,
      offhandItemId: e.offhandItemId,
      // built skinless; the per-frame diff below applies e.weaponSkinId (and its VFX)
      weaponSkinId: null,
      // Born false so the per-frame diff below sheathes an already-stowed entity
      // (a peer entering interest) on its first sync.
      weaponStowed: false,
      // Born with the CURRENT bit: unlike the stow pose there is no transition
      // to replay, createCharacterVisual composed with it just now.
      helmHidden: e.helmHidden,
      // Born with the CURRENT look, for the same reason: createCharacterVisual
      // composed with it just now, so there is nothing to reconcile yet.
      modularAppearance: e.modularAppearance,
      liveScale: e.scale,
      loco: newLocoTrack(),
      locoState: newLocoState(),
      stepAccum: 0,
      lichHeartbeatAt: 0,
      waterContactSeen: false,
      waterContactActive: false,
      waterContactX: e.pos.x,
      waterContactZ: e.pos.z,
      waterContactAccum: 0,
      wasAirborne: false,
      wasSwimming: false,
      wasSubmerged: false,
      wasFalling: false,
      swimKickPhase: 0,
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
    if (visual && view) encounterPrewarm.queueLiveSoulRendPrewarm(this, visual, view, e.kind);
    // Never gate the player's OWN view: it must be on screen immediately, its
    // class is already prewarmed, and the self render path does not re-evaluate
    // the compilePending flag (only the non-self loop does), so gating it would
    // strand the player invisible. Other entities un-hide via that loop.
    if (view && e.id !== this.sim.player.id) {
      view.compileReady = this.gateViewOnCompile(view, group, requiredForEntry);
    }
    // Warm an already-mounted entity's engine clips at view creation too: the
    // mountKey-edge preload below only fires on a CHANGE, but a remote rider
    // entering interest range, or an already-mounted player logging in, is
    // born with a mountKey and no edge to detect, so without this it always
    // hits the cold path (see the edge-site comment near preloadMountEngine).
    if (e.mountKey !== '') this.audioSink?.preloadMountEngine(e.mountKey);
  }

  // Shared core for every compile gate below: link `target`'s programs off the
  // main thread (KHR_parallel_shader_compile via compileAsync) against the live
  // scene's exact lights + environment. The same priority arbiter owns live
  // views and background uploads, so their WebGL work never overlaps.
  //
  // One queue unit per MATERIAL GROUP (tuple plus program variant) of the
  // target, one representative node compiled per group, never the whole
  // target in one unit (compile_gate_pieces.ts). Checked against the pinned
  // three.js WebGLRenderer.compile() source, not assumed: `compile(scene,
  // camera, targetScene)` gathers LIGHTS from targetScene (this.scene, for a
  // correct NUM_POINT_LIGHTS variant) but prepares materials only under the
  // one node handed to it, so a per-node compileAsync yields exactly that
  // node's programs under the root's cache keys; the group's other nodes are
  // cache hits, only the cheap isLight walk over this.scene repeats.
  // Drivers that compile shader source synchronously at submission (Mesa on
  // the iGPU) charged every never-seen program of a root to its one unit (a
  // crowd of composed players arriving in a live frame: 500 to 711 ms on the
  // first `live-gate` unit); the queue paces between units, never inside one,
  // and its released-tail cap now bounds the gate's links on the driver too.
  private compileGate(target: THREE.Object3D, requiredForEntry = false): Promise<unknown> {
    const lookup = (id: number) => this.sim.entities.get(id);
    const isCasting = castingAtPlayerPredicate(lookup, this.sim.player.id);
    const priority = compilePriorityForTarget(target, this.sim.player.targetId, isCasting);
    // Compile the variant pair the boot prewarm proved out, never a bare
    // compileAsync at the ambient render target: three keys a program on the
    // bound target's output colour space, so on composer tiers an unbound
    // compile links the canvas srgb variant while the scene pass draws the
    // linear one, and the first visible frame still linked the real program
    // synchronously (the measured 300-500 ms border-crossing stall). The
    // colour pass binds the tier-correct target; the skinned depth pass covers
    // the renderer-owned shadow material the colour walk cannot enumerate; the
    // touch tail warms the linked programs' uniform tables (no reveal query).
    const color = (node: THREE.Object3D) => this.compilePrewarmColorPrograms(node, false);
    const shadow = (node: THREE.Object3D) => this.compileShadowPrograms(node);
    const settle = pieceProgramSettle(this.webgl.properties, this.prewarmDepthMaterials);
    const submit = () =>
      this.liveCompileGates.runPieces(
        linkPieceWork(target, color, shadow, settle),
        VIEW_COMPILE_GATE_MAX_MS,
        { priority, label: `live-gate:${target.name || target.type}` },
      );
    const startAfterInitialPaint = compileMayStartBeforeInitialPaint(priority, requiredForEntry)
      ? null
      : this.initialGpuWorkStart;
    const linked = startAfterInitialPaint ? startAfterInitialPaint.then(submit, submit) : submit();
    // The uploads and the touch tail ride OUTSIDE the gate's own queue units,
    // and must: their pieces are queue units themselves, so awaiting them from
    // inside a unit holding a released-tail cap slot would park the drain loop
    // on a slot only that unit can free. The gate still settles after them, so
    // a gated reveal is no earlier than it was before.
    return linked
      .then((gate) => this.uploadGateTexturesGated(target, priority).then(() => gate))
      .then((gate) => this.touchLinkedProgramsGated(target, priority, gate));
  }

  /** The gate's upload step: one budgeted queue unit per cold texture under
   *  `target` (src/render/texture_prep_lane.ts), between the link and the
   *  touch tail. */
  private uploadGateTexturesGated(target: THREE.Object3D, priority: number): Promise<number> {
    const { properties } = this.webgl;
    return runTexturePrepLane(this.backgroundGpuWork, properties, this.webgl, target, priority, {
      inFlight: this.textureUploadTasks,
    });
  }

  /** The gate's tail: every linked program under `target`, one budgeted queue
   *  unit at a time. Readiness comes from the pieces' own settle only, never
   *  from a walk mark here (why, and the evidence it leaves: runWorldGateTouchLane). */
  private touchLinkedProgramsGated(
    target: THREE.Object3D,
    priority: number,
    gate: CompileGateResult,
  ): Promise<number> {
    const { properties } = this.webgl;
    return runWorldGateTouchLane(this.backgroundGpuWork, properties, target, priority, gate);
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

  // Generic anti-freeze layer: link a freshly streamed view off-thread and keep
  // it hidden until ready. This also covers variants the boot prewarm cannot
  // anticipate; already-compiled spawn content resolves without visible pop-in.
  private gateViewOnCompile(
    view: EntityView,
    group: THREE.Group,
    requiredForEntry = false,
  ): Promise<void> | null {
    if (!this.asyncCompileSupported) return null;
    const generation = this.lifecycleGeneration;
    const priorVisibility = group.visible;
    view.compilePending = true;
    group.visible = false;
    // The canvas nameplate (name, target marker, health, and cast bar) keeps
    // painting while the 3D group is gated, so actionable information has an
    // immediate placeholder without first-drawing a still-linking shader.
    return this.compileGate(group, requiredForEntry).then(
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
    if (v.metamorphVisual?.root.visible) return v.metamorphVisual;
    return v.visual;
  }

  private updateBaseVisual(e: Entity, v: EntityView): void {
    if (!v.visual) return;
    const nextKey = visualKeyFor(e);
    if (nextKey === v.visualKey) return;
    // One base-rig swap in flight at a time: the outgoing rig stands in until
    // the replacement links, and this per-frame key diff retries the next one.
    if (v.visualCompilePending) return;
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
    // Never leave the entity bodiless: the outgoing rig stays attached and
    // drawing (frozen pose) until the replacement's gate settles below.
    const outgoing = v.visual;
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
    // The replacement rig is COLD: its Soul Rend clones are not the disposed
    // rig's, so the encounter prewarm has to warm it like a body that just
    // arrived (v carries the look `next` was built holding).
    encounterPrewarm.queueLiveSoulRendPrewarm(this, next, v, e.kind);
    // A live base-visual replace (race/mech toggle) is exactly a brand-new
    // rig's materials linking for the first time; gate it the same as a
    // gear swap rather than freezing the frame it lands on (#2571).
    v.visualCompilePending = true;
    this.gateSwapFlagOnCompile(next.root, () => {
      v.visualCompilePending = false;
      v.group.remove(outgoing.root);
      outgoing.dispose();
    });
  }

  // Weapon-skin cosmetics waiting to be applied to a live view, at most one
  // application per frame. All the queue decisions (coalescing, cancellation,
  // the stale-guard) live in the pure core; this class only does the Three work
  // the drain hands back.
  private readonly weaponSkinApplies = new WeaponSkinApplyQueue();
  private readonly weaponSkinApplyScratch: WeaponSkinApplyDecision[] = [];

  private readonly onCharacterAssetReady = (url: string): void => {
    if (this.shutdownStarted) return;
    // This fires for EVERY character GLB arrival, including the streamed
    // creature bodies that can never be a weapon skin, and the scan below
    // mints a skin-url string per skinned view: drop non-skin urls first.
    if (!isWeaponSkinModelUrl(url)) return;
    for (const [id] of this.views) {
      const skinId = this.sim.entities.get(id)?.weaponSkinId ?? null;
      if (!skinId || weaponSkinModelUrl(skinId) !== url) continue;
      this.weaponSkinApplies.enqueue(id, skinId);
    }
  };

  // Bound once, never per frame: the drain's two callbacks would otherwise mint
  // a closure pair on every drained frame.
  private readonly weaponSkinLookup = (viewId: number): string | undefined => {
    // A view that is gone, pooled, or has no character rig has nothing to apply
    // to; everything else is the live entity's own answer.
    if (!this.views.get(viewId)?.visual) return undefined;
    return resolveQueuedSkinLookup(this.sim.entities.get(viewId));
  };

  // Nearest first: in a crowd of arrivals the wearer beside the player must not
  // wait out thirty distant rigs at one application per frame. Squared XZ
  // distance to the player, the same measure the view create/destroy bands use.
  private readonly weaponSkinRank = (viewId: number): number | undefined => {
    const entity = this.sim.entities.get(viewId);
    return entity ? entityViewDistanceSq(entity, this.sim.player) : undefined;
  };

  /** Apply (or clear) a weapon-skin cosmetic on one view and latch it. The
   *  latch is written HERE, never at enqueue time, so a queued application
   *  that never ran is retried by the next frame's diff. */
  private applyWeaponSkin(v: EntityView, skinId: string | null, kind: string): void {
    if (!v.visual) return;
    const refresh = skinId !== null && skinId === v.weaponSkinId;
    v.weaponSkinId = skinId;
    const changed = refresh ? v.visual.refreshWeaponSkin() : v.visual.setWeaponSkin(skinId);
    if (changed) for (const node of changed) this.gateSwapOnCompile(node);
    this.reconcileViewLights(v);
    encounterPrewarm.queueLiveSoulRendPrewarm(this, v.visual, v, kind);
  }

  /** Spend this frame's weapon-skin application budget, nearest wearer first.
   *  Entries whose view is gone, or whose entity has moved on to another skin,
   *  are dropped without spending it (the diff re-enqueues if the view still
   *  needs one). */
  private drainWeaponSkinApplies(): void {
    if (this.weaponSkinApplies.size === 0) return;
    const due = this.weaponSkinApplies.take(
      WEAPON_SKIN_APPLIES_PER_FRAME,
      this.weaponSkinLookup,
      this.weaponSkinApplyScratch,
      this.weaponSkinRank,
    );
    for (const entry of due) {
      const view = this.views.get(entry.viewId);
      const kind = this.sim.entities.get(entry.viewId)?.kind ?? '';
      if (view) this.applyWeaponSkin(view, entry.skinId, kind);
    }
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
    // Thornhollow Fields: the opposing TEAM is hostile for the whole live match.
    const bg = this.sim.bgInfo?.match;
    if (bg?.state === 'active') {
      const row = bg.players.find((p) => p.pid === target.id);
      if (row && row.team !== bg.myTeam) return true;
    }
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
  // A hard rift build failure releases its builtInteriors key behind this
  // cooldown, so the retry is neither per-frame nor never (build_retry_gate.ts
  // explains why it is a timestamp, not a timer).
  private readonly riftBuildRetry = new BuildRetryGate(15000);
  // Rift interiors are the one interior class whose world origin is REUSED: an
  // empty slot frees after 60s and the next run rebuilds at the same z-stacked
  // origin, so a stale group would overlap the new build and its torch lights
  // would stack into the per-frame fire-light budget forever. Tracked per key;
  // every build retires the others (a descended-from floor included: there is
  // no way back up). DungeonInteriors owns only per-root resources; its shared
  // kit cache and tint/glow materials remain resident for later floors.
  private riftInteriorGroups = new Map<string, THREE.Group>();
  // Protect Yumi maze interiors, one per match slot, built lazily like the
  // arena copies; their update() anchors the team beacons each frame.
  private yumiMazeViews = new Map<number, YumiMazeView>();
  // Thornhollow Fields battleground fields, one per match slot, built lazily like the
  // yumi maze copies; the geometry is static, and the only per-frame work is the
  // occluder fade the placements own (battleground_placements.ts).
  private bgViews = new Map<number, BattlegroundView>();
  // Reused ward-state carrier: setWardState only READS these fields, so the
  // per-frame push refills this object rather than minting a literal.
  private bgWardState = { countdown: false, ghost: false, myTeam: null as number | null };
  // Blue/red team arrows above every yumi fighter (yumi_team_markers.ts).
  private readonly yumiTeamMarkers = new YumiTeamMarkers();
  // Affliction's primary and Coven eyes remain actionable on every graphics tier.
  private readonly evilEyeMarkers = new EvilEyeMarkers();
  private readonly burningPactMarkers = new BurningPactMarkers();
  private readonly umbralAnchorMarker = new UmbralAnchorMarker(this.groundSample);
  // The approved Maledict Eye is cosmetic: one local, non-targetable Affliction familiar.
  private readonly afflictionFamiliar = new AfflictionFamiliar();
  // Delve module interiors build asynchronously; the tracker also retires a
  // position's stale geometry when a new run puts a different module there
  // (see delve_interior_tracker.ts).
  private delveInteriors = new DelveInteriorTracker(
    () => this.ensureDungeons(),
    (group) => this.retireInteriorGroup(group),
    this.builtInteriors,
  );
  // Re-applied rift fog is keyed by the floor descriptor (seed:floorIndex) so a
  // descent (same 'rift' fogState, different palette) still refreshes the fog.
  private riftFogKey: string | null = null;
  // Cached with riftFogKey: whether the current rift floor is an authored set
  // piece, so the per-frame lighting read avoids regenerating the floor.
  private riftFogAuthored = false;
  private fogState: FogSceneState = 'outdoor';

  /** Drop a retired interior's scene nodes, registries, and owned resources. */
  private retireInteriorGroup(group: THREE.Group): void {
    this.scene.remove(group);
    this.releaseInteriorExternalRefs(group);
    const resourceErrors = this.dungeons?.disposeInteriorResources(group).errors;
    if (resourceErrors?.length) console.warn('Interior resource dispose failed', resourceErrors);
  }

  /** Remove renderer-side references that live outside an interior root. */
  private releaseInteriorExternalRefs(group: THREE.Group): void {
    const doomed = new Set<THREE.Object3D>();
    group.traverse((o) => doomed.add(o));
    // pruneFireLights answers whether the registry changed, and the rank MUST
    // follow: the rebuild guard compares ranked.length against a COUNT, so a
    // retire that removes as many lights as a same-microtask build added would
    // leave a stale rank holding the retired floor and missing the new one.
    if (pruneFireLights(this.fireLights, doomed)) this.lightRankDirty = true;
    for (let i = this.flames.length - 1; i >= 0; i--) {
      if (doomed.has(this.flames[i])) this.flames.splice(i, 1);
    }
    this.dungeons?.retireHideables(doomed);
  }

  // The one construction point for DungeonInteriors: every build path (first
  // dungeon approach, delve modules, rift floors, the boot prewarm) gets the
  // live compile gate injected, so a streamed interior attaches hidden until
  // its programs link instead of stalling its first visible frame.
  private ensureDungeons(): DungeonInteriors {
    this.dungeons ??= new DungeonInteriors(
      this.scene,
      this.lowGfx,
      this.flames,
      this.fireLightAdopter.sink,
      this.asyncCompileSupported ? (target) => this.compileGate(target) : undefined,
      (group) => this.releaseInteriorExternalRefs(group),
    );
    return this.dungeons;
  }

  private buildInterior(
    interior: string,
    ox: number,
    oz: number,
    opts?: Parameters<DungeonInteriors['buildInterior']>[3],
  ): void {
    encounterPrewarm.startInteriorEncounterPrewarm(interior, this);
    void this.ensureDungeons()
      .buildInterior(interior, ox, oz, opts)
      .catch((err) => {
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

  private static readonly BATTLEGROUND_FOG = { color: 0xaecbe0, near: 70, far: 210 };
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

  // God-ray shaft strength per biome (default 1). The shafts sell a bright
  // sun hanging in clear or golden air; under the Nightbloom's starfield
  // twilight or the Wraithwood's grey murk the same additive streaks read as
  // artifacts (a playtested report over the Nightbloom's lake), and the
  // overcast/rain realms keep only a hint. Eased in updateAmbience so a
  // border crossing fades the shafts instead of popping them.
  private static BIOME_GOD_RAYS: Partial<Record<BiomeId, number>> = {
    night: 0,
    haunt: 0,
    cave: 0,
    dusk: 0.35,
    frost: 0.45,
    ember: 0.55,
    volcano: 0.3,
    marsh: 0.3,
  };

  private outdoorFogPreset(): { color: number; near: number; far: number } {
    if (this.lowGfx) return Renderer.LOW_FOG;
    return Renderer.BIOME_FOG[zoneBiomeAt(this.sim.player.pos.x, this.sim.player.pos.z)];
  }

  /** Settle the light rig for a fog state (interior_light_rig.ts owns the
   * per-state numbers; the outdoor legs carry this frame's day/night grade,
   * so leaving an interior at night stays night). */
  private applyStateLightRig(state: FogSceneState): void {
    const targets = {
      sun: this.sun,
      hemi: this.hemi,
      scene: this.scene,
      rim: sharedUniforms.uRimBoost,
    };
    if (state === 'rift') {
      applyRiftLightRig(this.riftFogAuthored, targets);
      return;
    }
    applyInteriorLightRig(state, targets, {
      sunIntensity: SUN_INTENSITY * this.dnGrade.lightScale,
      hemiIntensity: hemiOutdoorIntensity() * this.dnGrade.ambientScale,
      envIntensity: this.envOutdoorIntensity * this.dnGrade.ambientScale,
    });
  }

  /**
   * The vista arms may only engage once the far layer can actually stand in
   * for the fog: until EVERY planned tile is attached, an unbuilt direction
   * past the detail horizon would render as void (Safari's idle fallback
   * paces a high-tier tile near 3 seconds, so the full grid can take half a
   * minute there). Until then the classic fogged renderer runs verbatim,
   * and the fog wall keeps the horizon closed; the flip when the last tile
   * lands rides the same eased fog/detail transitions every zone change
   * uses. An editor far-layer rebuild drops readiness the same way, closing
   * the fog back over the void instead of exposing it.
   */
  private vistaLive(): boolean {
    return (
      this.farVista.enabled &&
      this.farTerrainView.builtTileCount() >= this.farTerrainView.plannedTileCount()
    );
  }

  /**
   * The entry-curtain gate over the boot far-grid build: resolves true once
   * the vista can stand in for the fog, or false after `maxWaitMs` so a
   * pathological device never holds the player at the loading screen (the
   * classic eased flip then covers the remainder, exactly as before). On
   * success the next outdoor environment update settles scene fog at the
   * horizon haze band, still behind the curtain, so the first visible frame
   * carries the finished horizon rather than easing the fog out on screen.
   * A no-op true on profiles with the vista off. Thin consumer: both gate
   * arms live in farVistaGate (far_terrain.ts), pinned by its tests.
   */
  async farVistaReady(maxWaitMs: number = FAR_VISTA_ENTRY_MAX_WAIT_MS): Promise<boolean> {
    if (!this.farVista.enabled) return true;
    const ready = await farVistaGate(this.farVistaInitialBuild, maxWaitMs);
    if (ready && this.vistaLive()) this.vistaEntrySettlePending = true;
    return ready;
  }

  /** The classic cull distance the detail subsystems key off: scene fog
   *  verbatim when the vista is off (identical to the fogged renderer), the
   *  residency-eased detail horizon capped at the classic envelope when it
   *  is on (outdoor fog is parked past the camera there and culls nothing). */
  private subsystemCullFar(): number {
    if (!this.vistaLive() || this.fogState !== 'outdoor') {
      return (this.scene.fog as THREE.Fog).far;
    }
    return detailCullFar(this.detailFogFar, MAX_OUTDOOR_FOG_FAR);
  }

  /** Where the whole-world view ends on vista tiers (far tiles and foliage
   *  sprites reach it); scene fog verbatim elsewhere. */
  private viewFar(): number {
    return this.vistaLive() && this.fogState === 'outdoor'
      ? this.farVista.envelopeFar
      : (this.scene.fog as THREE.Fog).far;
  }

  /** Build every module in a delve run at its stacked z offset (parallel async). */
  private buildAllDelveModules(
    delveId: string,
    slot: number,
    origin: { x: number; z: number },
    modules: readonly DelveModuleId[],
  ): void {
    this.delveInteriors.buildAll(delveId, slot, origin, modules);
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

  private updateAmbience(px: number, camY: number, dt: number): void {
    const inside = px > DUNGEON_X_THRESHOLD;
    const pz = this.sim.player.pos.z;
    // The entry-curtain settle is one-shot and belongs to THIS update only:
    // consumed by the outdoor arm below when the entry really is outdoors,
    // discarded otherwise (an interior login must keep its normal eased
    // transition when the player later walks outside).
    const settleVistaEntry = this.vistaEntrySettlePending;
    this.vistaEntrySettlePending = false;
    const biome = zoneBiomeAt(this.sim.player.pos.x, pz);
    // Per-biome god-ray strength, eased over about half a second so a border
    // crossing fades the shafts with the rest of the ambience.
    const shaftTarget = Renderer.BIOME_GOD_RAYS[biome] ?? 1;
    this.godRayZoneScale +=
      (shaftTarget - this.godRayZoneScale) * (1 - Math.exp(-2 * Math.max(0, dt)));
    const phaseOverride = dayNightPhaseOverride();
    if (this.lowGfx && DAY_ONLY && phaseOverride === null) {
      if (this.fixedLowDayBiome !== biome) {
        this.dnGrade = NEUTRAL_DAY_GRADE;
        this.dnGlobalNight = 0;
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
      const amp = REALM_DAYNIGHT_AMPLITUDE[biome];
      if (DAY_ONLY && phaseOverride === null) {
        this.dnGrade = NEUTRAL_DAY_GRADE;
        this.dnGlobalNight = 0;
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
        // Moon phase lifts the night floor (full brighter, new darker), epoch-anchored.
        const moonLit = moonTerminator(currentLunarPhase()).litFrac;
        // the whole grade warms as the sun crosses the horizon, so the fog,
        // sky dome, and water all take the sunrise/sunset orange rather than
        // just the key light
        this.dnGrade = warmDuskGrade(
          dayNightGrade(effectiveDayness(gday, biome), biome, moonLit),
          duskWarmAmount(sd[1]),
        );
        // The night-visibility layers read the world clock, not the realm's
        // compressed grade, so lamps light at the same instant everywhere. The
        // Lambert tier never applies the grade at all (see the outdoor branch
        // below), so it reports full day and its lamps stay dark.
        this.dnGlobalNight = nightLightAmount(1 - gday, !this.lowGfx);
      }
    }
    // The distant-zone haze rides the settled grade and the live camera: a
    // neighbouring realm's air darkens and cools through the cycle exactly
    // like the air the player stands in, because both take the identical
    // dnGrade.fog multiply. Unconditional and once per frame (the world
    // surfaces that sample the field are drawn from both sync paths); a no-op
    // when no field was built.
    setBiomeHazeGrade(this.dnGrade.fog);
    setBiomeHazeCamera(this.camera.position.x, this.camera.position.z);
    if (isDelvePos(px)) {
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
            fireLights: this.fireLightAdopter.sink,
            lowGfx: this.lowGfx,
          });
          setRenderCategory(view.group, 'dungeon');
          this.scene.add(view.group);
          this.yumiMazeViews.set(i, view);
        }
      }
    } else if (inside && isBgPos(px)) {
      // build the Thornhollow Fields copy the player was matched into (the yumi
      // view-map pattern; the field is static, so no per-frame update hook)
      for (let i = 0; i < BG_SLOT_COUNT; i++) {
        if (this.bgViews.has(i)) continue;
        const o = battlegroundOrigin(i);
        if (Math.abs(px - o.x) < 220 && Math.abs(pz - o.z) < 200) {
          // The field's authored point lights ride the shared fire-light budget
          // (the yumi-maze hook shape above): the field streams in mid-session,
          // and up to 14 lights appearing outside the rank would change the
          // pinned visible point-light count and relink every lit material in
          // view. The build is async, so the registration lands later; the
          // callback marks the rank dirty whenever it does.
          const view = buildBattleground(o, this.sim.cfg.seed, {
            lowGfx: this.lowGfx,
            // The raw registry on purpose: buildBgFieldLights already hides
            // each light (battleground.ts) and its release path splices, which
            // an append-only sink cannot express.
            fireLights: this.fireLights,
            onFireLightsChanged: () => {
              this.lightRankDirty = true;
            },
          });
          this.scene.add(view.group);
          this.bgViews.set(i, view);
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
        if (
          !this.builtInteriors.has(key) &&
          this.riftBuildRetry.shouldAttempt(key, performance.now())
        ) {
          const o = rf.origin;
          if (Math.abs(px - o.x) < 200 && Math.abs(pz - o.z) < 250) {
            this.builtInteriors.add(key);
            const floor = generateRiftFloor(rf.seed, rf.baseLevel, rf.floorIndex, rf.upgrade);
            void this.ensureDungeons()
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
                this.builtInteriors.delete(key);
                this.riftBuildRetry.markFailed(key, performance.now());
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
    const inBattleground = inside && isBgPos(px);
    const interior =
      inside && !inDelve && !inYumiMaze && !inBattleground && !isArenaPos(px)
        ? dungeonAt(px)?.interior
        : null;
    encounterPrewarm.setEncounterPrewarmInterior(this, interior ?? null);
    const inTemple = interior === 'temple';
    const inNythraxis = interior === 'nythraxis';
    // Wildheart is an OPEN-AIR jungle caldera, not a closed room: it keeps the
    // sky dome and the daylight rig and only swaps in its own field haze.
    const inWildheartField = interior === 'wildheart';
    const inLastKeep = interior === 'lastkeep';
    const inDawnhold = interior === 'dawnhold';
    const desired = inDelve
      ? 'delve'
      : inYumiMaze
        ? 'yumiMaze'
        : inBattleground
          ? 'battleground'
          : inTemple
            ? 'temple'
            : inNythraxis
              ? 'nythraxis'
              : inWildheartField
                ? 'wildheartField'
                : inLastKeep
                  ? 'lastkeep'
                  : inDawnhold
                    ? 'dawnhold'
                    : inside
                      ? 'dungeon'
                      : camY <
                          waterLevelAt(
                            this.camera.position.x,
                            this.camera.position.z,
                            this.sim.cfg.seed,
                          ) -
                            0.05
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
        this.applyStateLightRig('rift');
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
      } else if (desired === 'dawnhold') {
        // Dawnhold Castle: brighter and greener-warm than the keep's hearth
        // murk: a pale sage-gold air pushed even further back, so the garden
        // palace reads sunlit end to end.
        fog.color.setHex(0x3d422a);
        fog.near = 40;
        fog.far = 190;
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
      } else if (desired === 'battleground') {
        // Thornhollow Fields is OPEN-AIR at immersive scale (100x280): true
        // view-distance fog, the open world's own rule. The fight around you
        // (~a chamber) reads clearly; the far keep's detail still dissolves
        // before the 236yd flag-to-flag line, so the far chambers stay places
        // you travel to, not read from spawn. Pushed back from the original
        // 55/130 after the playtest: the tighter wall of haze swallowed the
        // sky and flattened the light; at 70/210 the dome and ramparts
        // breathe while the tactical veil holds. Symmetric for both teams:
        // distance, never information.
        fog.color.setHex(0xaecbe0);
        fog.near = 70;
        fog.far = 210;
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
      // Which numbers each state means is interior_light_rig.ts's to own.
      if (!this.lowGfx) {
        this.applyStateLightRig(desired);
      }
      return;
    }
    // Outdoors, fog is also the residency boundary. Pull it inward immediately
    // before an unloaded zone can become visible; once that zone has been
    // loaded by the boundary transition, ease the view distance back out.
    if (desired === 'outdoor') {
      const g = this.dnGrade;
      const preset = this.outdoorFogPreset();
      const vista = this.vistaLive();
      const requestedFar = vista ? FOGLESS_DETAIL_FAR : preset.far * (this.lowGfx ? 1 : g.farScale);
      this.lastRequestedFogFar = requestedFar;
      this.lastRequestedFogNear = preset.near;
      // Residency is read per CHUNK, through the terrain view's own accessor.
      // Asking per ZONE meant an unprepared 36-to-54 chunk rectangle within
      // ~53 yd pinned the view at the floor until that entire rectangle (and
      // its HDRI) finished: 198 s of 45-yard wall after a Drakelands portal.
      // Read live rather than cached: an editor rebuildTerrain swaps the view.
      const ground = this.terrainView.groundResidency(this.camera.position);
      // Ask the clamp only about ground the camera can see. Radially, the
      // binding chunk orbits with the third-person boom, so standing still and
      // turning on the spot dragged the detail horizon between 170 and 700
      // yards and deleted mid-field scenery and shadows with it.
      this.camera.getWorldDirection(this.residencyForward);
      this.residencyCone.forwardX = this.residencyForward.x;
      this.residencyCone.forwardZ = this.residencyForward.z;
      this.residencyCone.halfAngle = groundViewConeHalfAngle(
        THREE.MathUtils.degToRad(this.camera.fov),
        this.camera.aspect,
      );
      const residencyFar = fogFarForBuiltGround(
        ground.grid,
        ground.isPending,
        this.camera.position.x,
        this.camera.position.z,
        requestedFar,
        this.residencyCone,
      );
      const detailHorizonDemandFar = this.entryDetailHorizon.advanceFromFrame(
        vista,
        requestedFar,
        this.gpuHitchCompileLifecycle?.records ?? null,
        residencyFar,
        Math.max(0, dt * 1000),
        this.renderBudgetState.externalFrameCap,
      );
      if (vista) {
        // Entry settle (one-shot, armed by farVistaReady behind the opaque
        // curtain): start scene fog AT the horizon haze band instead of
        // easing it out over the first seconds on screen. The detail horizon
        // remains separately admission-governed below; coarse terrain stands
        // beneath it, so no fog wall or hole is visible while it expands.
        if (settleVistaEntry) {
          const entryHaze = horizonHazePlan(this.farVista.envelopeFar, this.camera.position);
          fog.far = entryHaze.far;
          fog.near = entryHaze.near;
        }
        this.detailFogFar = easedFogFar(
          this.detailFogFar,
          detailHorizonDemandFar,
          residencyFar,
          dt,
        );
        // Fog itself eases out to the horizon haze band: zero effect across
        // every gameplay distance, a gentle realm-tinted aerial blend where
        // the open sea meets the sky, so the horizon melts instead of
        // cutting a razor line (and interiors still hand off smoothly).
        const haze = horizonHazePlan(this.farVista.envelopeFar, this.camera.position);
        fog.far = dampedValue(fog.far, haze.far, dt, ZONE_ENVIRONMENT_RESPONSE);
        fog.near = dampedValue(fog.near, haze.near, dt, ZONE_ENVIRONMENT_RESPONSE);
      } else {
        fog.far = easedFogFar(fog.far, requestedFar, residencyFar, dt);
        fog.near = easedFogNear(fog.near, preset.near, fog.far, dt);
      }
    }
    // Every open-air state follows the live grade. Thornhollow keeps its
    // authored fog range while sharing the overworld's color and light grade.
    if (usesLiveDayNightLighting(desired)) {
      const g = this.dnGrade;
      const preset =
        desired === 'battleground' ? Renderer.BATTLEGROUND_FOG : this.outdoorFogPreset();
      const k = transitionAlpha(dt, ZONE_ENVIRONMENT_RESPONSE);
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
      // sunsetWarmGate holds the warm through the horizon crossing and drops it
      // before the key light hands over to the moon, so moonlight stays cool.
      const sunElev = this.sunDir.y;
      let hi = (sunElev - 0.12) / 0.46;
      hi = hi < 0 ? 0 : hi > 1 ? 1 : hi;
      const lowness = 1 - hi * hi * (3 - 2 * hi);
      // The base term is the standing day gold (the look tuned at the fixed
      // 31 degree anchor, which the live noon sun closely matches); the
      // lowness ramp runs the warm all the way to 1 at the horizon so sunrise
      // and sunset go genuinely orange, and the gate takes the whole warm off
      // below it so the moonlight never picks up a sunset tint.
      // The base sits at 0.58 rather than the first cut's 0.52: standing
      // daylight read clinical, and this is a couple hundred kelvin of golden
      // bias (a vale noon key lands near rgb 255,182,144 instead of
      // 255,189,152), not an orange midday. The lowness ramp reaches full at
      // y 0.12 rather than 0.08 so the key light is already at its sunset
      // orange while the gate still passes it at full strength, which is what
      // makes the golden hour read as a band rather than an instant.
      const warmAmt = sunsetWarmGate(sunElev) * (0.58 + lowness * 0.42);
      // The realm's own night hue, as a luminance-neutral multiplier. Applied
      // to the key light and both hemisphere halves AFTER they cool toward the
      // moon, so a realm keeps tinting the world it lights after dark: the
      // Drakelands' grass is green and reads red under its ember light, and
      // that has to survive the night or the realm stops being itself.
      const realmTint = realmLightTint(g.fog, g.nightAmt * REALM_MOON_TINT);
      this.dnColorScratch.setHex(light.sun);
      this.dnColorScratch.lerp(this.dnMoonScratch.setHex(WARM_SUN_COLOR), warmAmt);
      this.dnColorScratch.lerp(
        this.dnMoonScratch.setHex(MOON_SUN_COLOR),
        g.nightAmt * NIGHT_SUN_COOL,
      );
      this.dnColorScratch.r *= realmTint[0];
      this.dnColorScratch.g *= realmTint[1];
      this.dnColorScratch.b *= realmTint[2];
      this.sun.color.lerp(this.dnColorScratch, k);
      this.dnColorScratch
        .setHex(light.hemiSky)
        .lerp(
          this.dnMoonScratch.setHex(WARM_HEMI_SKY_COLOR),
          DAY_HEMI_SKY_WARMTH * (1 - g.nightAmt),
        )
        .lerp(this.dnMoonScratch.setHex(MOON_HEMI_SKY_COLOR), g.nightAmt * NIGHT_HEMI_COOL);
      this.dnColorScratch.r *= realmTint[0];
      this.dnColorScratch.g *= realmTint[1];
      this.dnColorScratch.b *= realmTint[2];
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
      this.dnColorScratch.r *= realmTint[0];
      this.dnColorScratch.g *= realmTint[1];
      this.dnColorScratch.b *= realmTint[2];
      this.hemi.groundColor.lerp(this.dnColorScratch, k);
      this.sun.intensity +=
        (SUN_INTENSITY * g.lightScale * (light.sunScale ?? 1) - this.sun.intensity) * k;
      // The ambient half rides its own higher night floor, so terrain shape and
      // body silhouettes survive deep night while the moon key light stays dim.
      this.hemi.intensity +=
        (hemiOutdoorIntensity() * g.ambientScale * (light.hemiScale ?? 1) - this.hemi.intensity) *
        k;
      // The character rim (the cheapest silhouette separator the renderer owns:
      // one shared uniform, no extra draw, every rig at once) lifts after dark
      // for the same reason the ambient floor does. Outdoors this is the only
      // writer; the fogState transition above sets it to 1 on the way out of an
      // interior and this immediately re-grades it.
      sharedUniforms.uRimBoost.value = nightRimBoost(this.dnGlobalNight);
    }
  }

  // The camera under a waterline: a blue wash, shortened fog, and a rising
  // bubble stream. Keyed off the CAMERA, not the player, so a third-person boom
  // that dips below the surface reads right, and a swimmer at the surface with
  // the camera under it still sees water rather than air.
  private updateUnderwater(dt: number): void {
    const cam = this.camera.position;
    const level = waterLevelAt(cam.x, cam.z, this.sim.cfg.seed);
    // Fade across the first half-yard under the line, so breaking the surface
    // is a wash lifting rather than a switch flipping.
    const depth = Number.isFinite(level) ? level - cam.y : -1;
    const target = Math.min(1, Math.max(0, depth / UNDERWATER_FADE_DEPTH));
    this.underwaterBlend += (target - this.underwaterBlend) * (1 - Math.exp(-dt * 7));
    this.underwaterView.update(this.camera, this.underwaterBlend, dt);
    if (this.underwaterBlend <= 0.002) return;
    // Ride ON TOP of whatever the biome fog easing just wrote. The easing pulls
    // back toward the zone preset every frame and this pulls toward the water,
    // so surfacing restores the biome's own fog with no state to unwind.
    const fog = this.scene.fog as THREE.Fog;
    const b = this.underwaterBlend;
    fog.color.lerp(this.fogScratch.setHex(UNDERWATER_FOG_COLOR), b);
    fog.near += (UNDERWATER_FOG_NEAR - fog.near) * b;
    fog.far += (UNDERWATER_FOG_FAR - fog.far) * b;
  }

  // Hand the prefiltered environment map to the dominant eased sky biome.
  // PMREMs cannot cross-fade, so their shared core fades the current IBL to a
  // low contribution, authorizes the texture/rotation swap, then restores the
  // new biome on the same long response as fog and light tint.
  private updateEnvBiome(dt: number): void {
    if (this.lowGfx || this.envRTs.size < 2 || !usesLiveDayNightLighting(this.fogState)) {
      return;
    }
    const blend = this.skyView.currentBiomeBlend();
    const dominant = blend.t < 0.5 ? blend.from : blend.to;
    // the biome's light-level scale applies to the IBL too, or a dimmed realm
    // (Nightbloom twilight) would keep full-daylight ambient from its HDRI.
    // `dominant` is a SkyKey: the place-keyed sky (farshore) has no
    // BIOME_LIGHT row and takes the neutral 1.
    const envScale =
      dominant in Renderer.BIOME_LIGHT
        ? (Renderer.BIOME_LIGHT[dominant as BiomeId].envScale ?? 1)
        : 1;
    // ...and at night the realm's own sky energy is normalized toward the Vale's.
    // The IBL is the realm's DAYTIME HDRI and those differ twenty-two fold in
    // measured irradiance, so an identical ambient scale left Willowfen and
    // Palmreach reading as an overcast afternoon while Eastbrook read as night.
    // Level only: the HDRI keeps its colour, so a realm's night stays its own.
    const nightEnvScale =
      dominant in Renderer.BIOME_LIGHT
        ? nightIblScale(dominant as BiomeId, this.dnGrade.nightAmt)
        : 1;
    const target = this.envRTs.has(dominant) ? dominant : this.envTransition.current;
    // The IBL is ambient, so it follows the grade's ambient floor, not the sun's.
    const settledIntensity =
      this.envOutdoorIntensity * this.dnGrade.ambientScale * envScale * nightEnvScale;
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
    // Follow the player in whole shadow-map texel steps, not raw sub-texel
    // ones: position and target translate together, so the light DIRECTION
    // is untouched and only the shadow rasterization grid stops sliding
    // under static geometry (shadow_texel_snap_core.ts). A shadowless key
    // light has no grid to align to and keeps the raw position.
    const anchor = this.shadowSnappedAnchor;
    anchor.x = pp.x;
    anchor.y = pp.y;
    anchor.z = pp.z;
    if (this.lowGfx) {
      if (this.sun.castShadow)
        snapShadowAnchor(
          SUN_ANCHOR.x,
          SUN_ANCHOR.y,
          SUN_ANCHOR.z,
          pp.x,
          pp.y,
          pp.z,
          this.shadowTexelWorld,
          anchor,
        );
      this.sun.position.set(
        anchor.x + SUN_ANCHOR.x,
        anchor.y + SUN_ANCHOR.y,
        anchor.z + SUN_ANCHOR.z,
      );
    } else {
      // the key light hands off from the sun to the moon across the terminator.
      // Blend the two directions smoothly (rather than a hard switch) as the sun
      // sinks through the horizon, so the shadow direction glides instead of
      // popping; the swap happens at dusk/dawn when the light is dim anyway.
      let t = (0.05 - this.sunDir.y) / 0.2; // sunDir.y 0.05 -> sun, -0.15 -> moon
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const blend = t * t * (3 - 2 * t);
      this.lightDir.copy(this.sunDir).lerp(this.moonDir, blend).normalize();
      if (this.sun.castShadow)
        snapShadowAnchor(
          this.lightDir.x,
          this.lightDir.y,
          this.lightDir.z,
          pp.x,
          pp.y,
          pp.z,
          this.shadowTexelWorld,
          anchor,
        );
      this.sun.position.set(
        anchor.x + this.lightDir.x * SUN_TRAVEL_DISTANCE,
        anchor.y + this.lightDir.y * SUN_TRAVEL_DISTANCE,
        anchor.z + this.lightDir.z * SUN_TRAVEL_DISTANCE,
      );
      // the unlit water shader follows the same key light and grade: glints
      // track the sun by day and the moon by night, and the surface dims with
      // the world (its baked palette would otherwise stay day-bright at night)
      setWaterSunDirection(this.lightDir);
      setWaterDayNight(this.dnGrade.fog);
      // the far vista's deep-night ambient floor and night albedo dim ride
      // the same grade
      setFarTerrainNightGrade(this.dnGrade.nightAmt);
      // The foliage shadow clones cull against this ortho box rather than
      // against camera distance: geometry outside it cannot write a shadow
      // texel (foliage_shadow_core.ts). Push it here, where the light's own
      // direction and target are decided, so the two can never disagree.
      if (this.sun.castShadow) {
        setFoliageShadowVolume(this.lightDir, anchor, this.sun.shadow.camera, SUN_TRAVEL_DISTANCE);
      } else {
        clearFoliageShadowVolume();
      }
    }
    this.sun.target.position.set(anchor.x, anchor.y, anchor.z);
  }

  // Aim the sun and moon disc sprites along their directions and fade them by how
  // far each body sits above the horizon (out when below, and only outdoors).
  /** Is the camera under real sky? The overworld, Wildheart's open field, and
   *  the Thornhollow Fields hollow all render the dome; every enclosed state
   *  (dungeon, temple, rift, underwater) does not. */
  /** Drive the field wards off the live match view: the form-up gate while the
   *  countdown holds, and the grave ward while the player waits as a spirit.
   *  Only visibility flags, so this is cheap enough for the per-frame block. */
  private updateBgWards(): void {
    if (this.bgViews.size === 0) return;
    const match = this.sim.bgInfo?.match ?? null;
    // Scratch state, refilled in place: setWardState only reads the fields, so
    // a fresh literal every frame would be pure garbage on the render path.
    const state = this.bgWardState;
    state.countdown = match?.state === 'countdown';
    state.myTeam = match ? match.myTeam : null;
    // The roster scan only matters while the match is live, so it is skipped as
    // a whole outside that window rather than run and then discarded, and the
    // plain loop over the at-most-ten rows allocates no per-frame closure.
    state.ghost = false;
    if (match?.state === 'active') {
      const me = this.sim.playerId;
      for (const row of match.players) {
        if (row.pid !== me) continue;
        state.ghost = row.dead;
        break;
      }
    }
    for (const view of this.bgViews.values()) view.setWardState(state);
  }

  private updateCelestialSprites(): void {
    // The basin keeps directional daylight and the sky dome, but the camera-
    // riding sun and moon sprites can clip against its high rim as oversized
    // wedges. Reserve screen-space celestial overlays for the overworld.
    const outdoor = this.fogState === 'outdoor';
    // keep the moon's shape on the lunar clock (no-op between phase buckets)
    // and run the sun's disc to sunset orange on the same horizon curve the
    // sky glow uses
    this.celestialSprites?.setMoonPhase(currentLunarPhase());
    this.celestialSprites?.setSunWarmth(duskWarmAmount(this.sunDir.y));
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
    // healGlowAt has no decay loop of its own (unlike fiestaGlows/waterJetVisualChannels).
    // Clear it before the idempotent early return so legacy or raced missing-view
    // removals cannot leave a stale throttle entry for the rest of the session.
    this.healGlowAt.delete(id);
    const v = this.views.get(id);
    if (!v) return;
    // A pending weapon-skin application must never land on a dropped (or
    // pooled and reused) view.
    this.weaponSkinApplies.cancel(id);
    this.scene.remove(v.group);
    unfreezeRigMatrices(v.group); // a pooled visual must not keep hide-frozen flags
    this.lightOwnerGroups.delete(v.group);
    if (v.viewLights.length > 0) {
      for (const light of v.viewLights) {
        const i = this.viewLights.indexOf(light);
        if (i >= 0) this.viewLights.splice(i, 1);
      }
      this.lightRankDirty = true;
    }
    this.nameplatePainter.remove(id);
    const idx = this.clickTargets.indexOf(v.clickTarget);
    if (idx >= 0) this.clickTargets.splice(idx, 1);
    let disposeObjectResources = false;
    if (v.visual) {
      // Character geometry/materials are shared per-asset caches and must
      // survive interest churn, dispose only per-instance mixer bindings.
      if (!terminal && v.visualPoolKey) this.pooledVisuals.store(v.visualPoolKey, v.visual);
      else v.visual.dispose();
      v.sheepVisual?.dispose();
      v.bearVisual?.dispose();
      v.catVisual?.dispose();
      v.travelVisual?.dispose();
      v.mountVisual?.dispose();
      v.metamorphVisual?.dispose();
      v.fireballTravelVisual?.dispose();
    } else {
      if (!terminal && v.objectPoolKey && v.objectMesh instanceof THREE.Group) {
        this.storePooledObject(v.objectPoolKey, {
          group: v.objectMesh,
          height: v.height,
        });
      } else {
        // Unshared object-view resources dispose BELOW the state-visual disposes.
        if (v.objectMesh) disposeSoulwellVisual(v.objectMesh);
        disposeObjectResources = true;
      }
    }
    v.iceBlockVisual?.dispose();
    v.temporalHourglassVisual?.dispose();
    v.frostNovaRootVisual?.dispose();
    v.mageBarrierVisual?.dispose();
    v.paladinAscensionVisual?.dispose();
    v.paladinAvengingWrathVisual?.dispose();
    v.paladinOathChainVisual?.dispose();
    v.paladinAegisVisual?.dispose();
    v.paladinSunVerdictVisual?.dispose();
    if (disposeObjectResources)
      disposeUnsharedMeshResources(v.group, { geometries: true, materials: true });
    this.audioSink?.mountEngineReset(id);
    this.views.delete(id);
  }

  private syncDrainChannelVisual(id: number, e: Entity): void {
    const drainPlan = drainChannelVisualPlan(e);
    const showDrain = this.drainChannelStopLatch.allowsSnapshot(
      id,
      drainPlan?.targetId ?? null,
      this.time,
    );
    if (drainPlan && showDrain) {
      this.vfx.drainBeam(id, drainPlan.targetId, drainPlan.duration);
      this.snapshotDrainVisualChannels.add(id);
      if (drainPlan.demonic) {
        this.vfx.demonicDrainBeam(id, drainPlan.targetId, drainPlan.duration);
        this.snapshotDemonicDrainVisualChannels.add(id);
      } else if (this.snapshotDemonicDrainVisualChannels.delete(id)) {
        this.vfx.demonicDrainBeam(id, drainPlan.targetId, 0);
      }
    } else if (!drainPlan && this.snapshotDrainVisualChannels.delete(id)) {
      this.vfx.drainBeam(id, e.castTargetId ?? id, 0);
    }
    if (!drainPlan && this.snapshotDemonicDrainVisualChannels.delete(id)) {
      this.vfx.demonicDrainBeam(id, e.castTargetId ?? id, 0);
    }
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
    // False while the window is hidden: everything below still runs (view
    // lifecycle, mixers, uTime, the viewport poll) so coming back costs no
    // create burst or shader link, and only the terminal draw is skipped.
    present = true,
  ): void {
    if (this.shutdownStarted) return;
    const totalStart = performance.now();
    // The hitch sample's start reading, before any view creation, then a new
    // ledger frame: what the ledger holds here is the previous callback plus
    // the gap before this one, the span this callback's dt measures.
    if (this.hitchLogEnabled) {
      const spend = this.buildLedger.frameSpend();
      this.hitchAligner.atStart(
        this.webgl.info.programs?.length ?? 0,
        this.webgl.info.memory.textures,
        spend.zoneMs,
        spend.viewMs,
      );
    }
    this.buildLedger.beginFrame();
    // Feed the background lane the live frame clock (see its header).
    this.backgroundGpuWork.noteFrame(totalStart);
    // The pacing budget opens its frame on the SAME boundary, unconditionally:
    // behind the present/dt guards below it never reset a hidden tab's spend,
    // so both per-frame slots latched while the queue's clock kept aging. Same
    // dt-derived ms the governor samples, and the tier's live drop-frame
    // threshold, which a tier change reassigns.
    this.gpuPrepBudget.noteFrame(Math.min(250, dt * 1000), GFX.budget.dropFrameMs);
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
    // A skipped frame draws nothing, so it carries no rendering signal at all:
    // feeding its wall-clock dt to the governor would read hidden time as free
    // headroom and ratchet quality up for the first frame back on screen.
    if (present) this.updateAdaptiveResolution(dt);
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
    // the paint-free carpet ring the terrain splat reads (see terrain.ts)
    sharedUniforms.uCarpetRing.value.set(
      this.sim.player.pos.x,
      this.sim.player.pos.z,
      GFX.bladeCarpetRadius,
    );
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

    // Dynamic worlds create nearby views lazily and drop views for leavers or
    // entities that moved well outside the draw band.
    createdViews += this.createRequiredViews(p, createdViewTypes);
    this.collectMissingViewCandidates(p, this.entityViewCreateRangeSq, false);
    createdViews += this.createCandidateViews(
      this.runtimeViewCreateBudget(dt),
      createdViewTypes,
      Infinity,
      true,
    ).created;
    this.doomedIds.length = 0;
    for (const id of this.views.keys()) {
      const e = sim.entities.get(id);
      // The pure policy also retires quest objects after turn-in or abandon.
      if (
        shouldDropView(e, p, sim.questLog, this.questObjectHidden, this.entityViewDestroyRangeSq)
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
    // Contact blobs are refilled from scratch inside the loop below (null on
    // every tier that casts real shadows).
    this.blobShadows?.begin();

    for (const [id, v] of this.views) {
      const e = sim.entities.get(id);
      if (!e) continue;
      // Distance rejection (isDistanceCullExemptObject excepted) comes before
      // effect/state derivation, so a rejected view's aura/actionability work waits.
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
        ) &&
        !isDistanceCullExemptObject(e)
      ) {
        v.group.visible = false;
        continue;
      }
      this.syncDrainChannelVisual(id, e);
      // form swaps (polymorph sheep, druid forms), computed up front because
      // the shadow gates below must not run the base rig's proxy under a form.
      // One pass over the aura list instead of repeated .some() scans per entity per
      // frame; the flag combination below preserves the original precedence.
      let formMask = 0;
      let hasGhostWolf = false;
      let hasStealth = false;
      let hasShadowform = false;
      let hasMoonkin = false;
      let hasLegacyMetamorphAura = false;
      let hasLichAura = false;
      let soulFragments = 0;
      let hasIceBlock = false;
      let temporalHourglassMode: TemporalHourglassMode | null = null;
      let hasFrostNovaRoot = false;
      let mageBarrierState: MageBarrierState | null = null;
      let sunVerdictAura: PaladinSunVerdictAuraSource | null = null;
      let hasPaladinWings = false;
      let oathChainSourceId: number | null = null;
      let characterEffects = 0;
      for (const a of e.auras) {
        characterEffects = addCharacterEffectAura(characterEffects, a);
        formMask |= characterFormMaskForAura(a);
        if (a.id === 'ghost_wolf') hasGhostWolf = true;
        if (a.kind === 'stealth') hasStealth = true;
        if (a.kind === 'form_shadow') hasShadowform = true;
        if (a.kind === 'form_moonkin') hasMoonkin = true;
        if (a.kind === 'form_metamorph') hasLegacyMetamorphAura = true;
        if (a.kind === 'form_lich') hasLichAura = true;
        if (a.kind === 'soul_fragments') soulFragments = a.stacks ?? 0;
        if (a.kind === 'necromancy_death_echo' && a.value2 !== undefined) {
          this.necromancyGroundFx.syncDeathEcho(e.id, a.id, a.value, a.value2);
        }
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
        sunVerdictAura = selectPaladinSunVerdictAura(sunVerdictAura, a, this.sim.playerId);
        if (isPaladinWingAura(a)) hasPaladinWings = true;
        if (isOathChainAura(a) && oathChainSourceId === null) oathChainSourceId = a.sourceId;
      }
      const requestedForm = requestedCharacterForm(formMask);
      const polyed = requestedForm === 'sheep';
      const bear = requestedForm === 'bear';
      const ghostWolf = requestedForm === 'cat' && hasGhostWolf;
      const cat = requestedForm === 'cat';
      const travel = requestedForm === 'travel';
      const fireballForm = requestedForm === 'fireball';
      const metamorphForm = requestedForm === 'metamorph';
      const _stealthed = hasStealth;
      const hasSoulRend = hasCharacterEffect(characterEffects, CHARACTER_EFFECT_SOUL_REND);
      const hasRecklessness = hasCharacterEffect(characterEffects, CHARACTER_EFFECT_RECKLESSNESS);
      const displayScale = e.scale;
      if (displayScale !== v.liveScale) {
        v.liveScale = displayScale;
        v.group.scale.setScalar(displayScale);
      }
      const visuallyDead = isVisuallyDead(e) && !e.ghost;
      const waterJetVisualChannel = this.waterJetVisualChannels.has(e.id);
      // This is the final render-side casting state, including Water Jet's
      // spellfx-driven channel. It feeds both the rig and the fairness carve-out.
      const characterCasting = characterPresentationCasting(
        e.castingAbility,
        waterJetVisualChannel,
        visuallyDead,
      );
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
        characterCasting,
        e.inCombat,
        e.ownerId,
        combatTargetId,
        combatTarget?.ownerId ?? null,
      );
      const ea = isSelf
        ? Math.min(1, alpha)
        : remoteEntityAlpha(now, e.netUpdatedAt, e.netInterval, alpha);
      const movingFarHoldout = movingHoldoutActive(
        e.pos,
        e.prevPos,
        ea,
        !isSelf && e.netUpdatedAt !== undefined && e.netInterval !== undefined
          ? POS_EXTRAPOLATION_CAP
          : 1,
        e.vx !== 0 || e.vz !== 0,
      );
      let wantShadow = true;
      let inProxyBand = false;
      if (isSelf) {
        v.group.visible = true;
        v.isFar = false;
        if (shadowsEnabled) {
          v.visual?.setShadow(true);
          v.visual?.setProxyShadow(false);
        }
      }
      if (!isSelf) {
        // Per-frame visibility follows the create/destroy hysteresis above so
        // rigs at the draw edge do not flicker. The object branch below may
        // still re-hide loot.
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
          wantShadow = d2 < shadowRangeSq;
          inProxyBand = d2 < ENTITY_PROXY_SHADOW_RANGE_SQ;
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
              !fireballForm &&
              !metamorphForm,
          );
          // sheep/forms keep articulated shadows through the whole proxy band:
          // a frozen humanoid proxy silhouette would be wrong under a form
          const wantFormShadow = wantShadow || inProxyBand;
          v.sheepVisual?.setShadow(wantFormShadow);
          v.bearVisual?.setShadow(wantFormShadow);
          v.catVisual?.setShadow(wantFormShadow);
          v.travelVisual?.setShadow(wantFormShadow);
          v.mountVisual?.setShadow(wantFormShadow);
          v.metamorphVisual?.setShadow(wantFormShadow);
          if (wantShadow !== v.shadowOn) {
            v.shadowOn = wantShadow;
            for (const caster of v.objectCasters) (caster as THREE.Mesh).castShadow = wantShadow;
          }
        }
        if (v.visual) v.isFar = showsStaticFarMesh(d2, lodBands, actionablePose, movingFarHoldout);
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
      const x = isSelf ? selfPos.x : e.prevPos.x + (e.pos.x - e.prevPos.x) * ea;
      const y = isSelf ? selfPos.y : e.prevPos.y + (e.pos.y - e.prevPos.y) * ea;
      const z = isSelf ? selfPos.z : e.prevPos.z + (e.pos.z - e.prevPos.z) * ea;
      v.group.position.set(x, y, z);
      let facing = e.prevFacing + wrapAngle(e.facing - e.prevFacing) * facingAlpha(ea);
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
          e,
          this.sim.questLog,
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
        if (v.portal && vis && !v.portal.userData.staticDoor) {
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
        if (vis && e.objectItemId === 'soulwell' && v.objectMesh) {
          syncSoulwellVisual(v.objectMesh, this.time, e.id);
        }
        continue;
      }
      if (e.kind === 'npc') {
        // The island rail's go-here-next fizz (island_guidance.ts): gentle
        // holy sparkle over beacon NPCs, gold over the current target.
        this.islandGuidance.npcFizz(this.sim, e, this.vfx, this.time, dt);
      }
      const sunVerdictPlan = paladinSunVerdictVisualPlanForAuraInto(
        e.dead,
        sunVerdictAura,
        this.paladinSunVerdictPlanScratch,
      );
      v.paladinSunVerdictVisual = syncPaladinSunVerdictVisual(
        v.paladinSunVerdictVisual,
        v.group,
        v.height,
        sunVerdictPlan,
        dt,
        this.reducedMotion(),
      );
      if (!v.visual) continue;
      const veilboundState = characterVeilboundState(e);
      const paladinAegisActive = e.castingAbility === 'aegis_first_dawn' && e.channeling && !e.dead;
      // Decide visibility from the real world position before presentation work.
      // Audio and state derivation below remain active even for hidden actors.
      let charOnScreen = true;
      if (this.cullCharacters && id !== p.id) {
        this.cullSphere.center.set(x, y + v.height * 0.5 * v.liveScale, z);
        const characterRadius = (v.height * 0.7 + 1.5) * v.liveScale;
        this.cullSphere.radius = paladinAegisActive
          ? Math.max(characterRadius, PALADIN_AEGIS_DOME_RADIUS + 1)
          : characterRadius;
        charOnScreen = this.cullFrustum.intersectsSphere(this.cullSphere);
      }
      const runCharacterPresentation = shouldRunCharacterPresentationWork(
        charOnScreen,
        actionablePose,
      );

      let iceBlockActivated = false;
      if (runCharacterPresentation) {
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
        v.priestMarkersVisual = syncPriestMarkersVisual(
          v.priestMarkersVisual,
          v.group,
          v.height,
          priestMarkerStateForAuras(e.auras, this.priestMarkerStateScratch),
        );
        const ascensionPlan = paladinAscensionVisualPlanInto(e, this.paladinAscensionPlanScratch);
        v.paladinAscensionVisual = syncPaladinAscensionVisual(
          v.paladinAscensionVisual,
          v.group,
          v.height,
          ascensionPlan,
          dt,
          this.reducedMotion(),
          v.visual.root,
        );
        v.paladinAvengingWrathVisual = syncPaladinAvengingWrathVisual(
          v.paladinAvengingWrathVisual,
          v.group,
          v.height,
          !e.dead && hasPaladinWings,
          dt,
          this.reducedMotion(),
        );
        const oathChainSourceEntity =
          oathChainSourceId === null ? undefined : sim.entities.get(oathChainSourceId);
        const oathChainSourceView =
          oathChainSourceId === null ? undefined : this.views.get(oathChainSourceId);
        v.paladinOathChainVisual = syncPaladinOathChainVisual(
          v.paladinOathChainVisual,
          this.scene,
          oathChainSourceView?.group.position ?? null,
          v.group.position,
          (oathChainSourceView?.height ?? 0) * (oathChainSourceEntity?.scale ?? 1),
          v.height * e.scale,
          !e.dead && !!oathChainSourceEntity && !oathChainSourceEntity.dead,
          dt,
          this.reducedMotion(),
        );
        v.paladinAegisVisual = syncPaladinAegisVisual(
          v.paladinAegisVisual,
          v.group,
          paladinAegisActive,
          dt,
          this.reducedMotion(),
          e.scale,
        );
        iceBlockActivated = v.iceBlockVisual?.activatedThisFrame === true;
      }

      // live helm toggle (the paperdoll eye): the kit's head piece is part of
      // the composed geometry, not a texture, so flipping it means recomposing
      // the body. Nulling the remembered key makes updateBaseVisual's next-key
      // diff read as a base-visual swap, reusing its whole replace path
      // (click-target handoff, compile gating). Composed entities only: a
      // fixed class rig has no kit helm to take off.
      if (e.helmHidden !== v.helmHidden) {
        v.helmHidden = e.helmHidden;
        // Mech wearers keep the mech body (index.ts skips their look), so a
        // helm toggle must not force a pointless dispose/rebuild of it. Asked
        // through isMechWearer, the one definition of the rule.
        if (!isMechWearer(e) && modularLookFor(e)) v.visualKey = null;
      }

      // live redesign: the server pushed a changed authored look onto this
      // live entity (server/game.ts) and the client mirror reassigned
      // e.modularAppearance from a fresh wire read (src/net/online.ts). Cheap
      // reference check first, exactly like every other diff in this pass;
      // the reference alone is not a verdict here because the SAME mirror
      // also reassigns it on every unrelated identity record (an equip, a
      // level-up), so modularLookChanged does the real by-value comparison
      // before anything is nulled. Same recompose path as the helm toggle
      // above: nulling visualKey makes updateBaseVisual's next-key diff read
      // as a base-visual swap and reuse its whole replace path. The guard
      // differs from the helm arm in one spot: modularLookFor reads the NEW
      // state, which is null exactly when a cleared look needs the body to
      // fall back to the class rig, so a previously composed body (a non-null
      // prev reference) recomposes too. The reference is copied every time
      // this fires, changed or not, so the cheap check above stays quiet
      // until the next real reassignment.
      if (e.modularAppearance !== v.modularAppearance) {
        if (modularLookChanged(v.modularAppearance, e.modularAppearance)) {
          const composedBefore = v.modularAppearance != null;
          if (!isMechWearer(e) && (modularLookFor(e) || composedBefore)) v.visualKey = null;
        }
        v.modularAppearance = e.modularAppearance;
      }
      this.updateBaseVisual(e, v);
      if (!v.visual) continue;
      // Warm the local player's own spirit variants once per distinct look, so
      // a death spirit-release never links them inline on the ungated self view.
      if (e.id === this.sim.player.id) {
        this.selfSpirit.observe(
          v.visual,
          e.skin,
          e.mainhandItemId,
          e.offhandItemId,
          e.weaponSkinId,
        );
      }
      if (iceBlockActivated) this.activeVisual(v)?.playEmote('wave', 1);

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
      // Both held swaps re-run finishWeaponAttach, which re-snapshots the
      // original-material map with the new weapon's meshes, so the encounter
      // mark's warmed clones no longer describe this body: re-queue on the new
      // held look (the identity carries it, so a sheathe toggle warms nothing).
      if (e.mainhandItemId !== v.mainhandItemId) {
        v.mainhandItemId = e.mainhandItemId;
        const changed = v.visual.setWeapon(e.mainhandItemId);
        if (changed) for (const node of changed) this.gateSwapOnCompile(node);
        this.reconcileViewLights(v);
        encounterPrewarm.queueLiveSoulRendPrewarm(this, v.visual, v, e.kind);
      }

      if (e.offhandItemId !== v.offhandItemId) {
        v.offhandItemId = e.offhandItemId;
        const changed = v.visual.setOffhand(e.offhandItemId);
        if (changed) for (const node of changed) this.gateSwapOnCompile(node);
        this.reconcileViewLights(v);
        encounterPrewarm.queueLiveSoulRendPrewarm(this, v.visual, v, e.kind);
      }

      // live weapon-skin swap: a Season 1 Armory cosmetic applied/detached (self
      // or a peer, via the identity wire); replaces the held model + rarity VFX.
      // APPLYING one is the expensive direction (model swap, derived emissive
      // materials, the whole VFX rig), so it goes through the per-frame budgeted
      // queue instead of running here: a crowd of skinned players arriving at
      // once used to build every rig inside this one frame. Clearing a skin
      // builds no rig, so it stays synchronous and instant, and cancels any
      // queued apply so a stale entry cannot put the skin back on.
      // The latch is written by the application itself (see applyWeaponSkin),
      // so this diff keeps re-enqueueing (idempotent: one entry per view) until
      // the queued work actually lands.
      if (e.weaponSkinId !== v.weaponSkinId) {
        if (e.weaponSkinId === null) {
          this.weaponSkinApplies.cancel(id);
          this.applyWeaponSkin(v, null, e.kind);
        } else {
          this.weaponSkinApplies.enqueue(id, e.weaponSkinId);
        }
      }
      const weaponAura = characterWeaponAuraInto(e, this.weaponAuraScratch);
      v.visual.setWeaponAura(weaponAura ? weaponAura.color : null, weaponAura?.tip ?? false);
      v.visual.setWeaponAuraMode(characterWeaponAuraMode(e));
      const petOwner = e.ownerId === null ? null : (sim.entities.get(e.ownerId) ?? null);
      const ferocityStage = hunterPetFerocityStage(e, petOwner);
      const petFrenzy = hunterPetFrenzyActive(e, petOwner);
      v.visual.setFerocityStage(petFrenzy ? 3 : ferocityStage);
      v.visual.setPresentationScale(hunterPetVisualScale(ferocityStage, petFrenzy));

      // live sheathe toggle (Z key): the sim's weaponStowed bit moves held
      // props between the hands and the on-back pose (self or a peer)
      if (e.weaponStowed !== v.weaponStowed) {
        v.weaponStowed = e.weaponStowed;
        v.visual.setWeaponStowed(e.weaponStowed);
      }

      // lazy form visuals, swapped by visibility like the old sheep/bear rigs
      // (build, compile gate and encounter prewarm all live in buildFormVisual)
      if (polyed && !v.sheepVisual) this.buildFormVisual(e, v, 'form_sheep', 'sheepVisual', true);
      if (bear && !v.bearVisual) this.buildFormVisual(e, v, 'form_bear', 'bearVisual', true);
      if (cat && !v.catVisual) this.buildFormVisual(e, v, 'form_cat', 'catVisual', true);
      if (travel && !v.travelVisual) {
        this.buildFormVisual(e, v, 'form_travel', 'travelVisual', true);
      }
      if (metamorphForm && !v.metamorphVisual) {
        this.buildFormVisual(e, v, 'form_metamorph', 'metamorphVisual', false);
      }
      // A form rig that is still linking is NOT ready: the mask holds the
      // resolved form at 'base', so the BODY stands in and a polymorphed target
      // turns into a sheep a few frames late instead of vanishing for the whole
      // gate window (the stand-in invariant, src/render/CLAUDE.md).
      const formReadyMask = characterFormReadyMask(
        v.sheepVisual,
        v.bearVisual,
        v.catVisual,
        v.travelVisual,
        v.metamorphVisual,
        v.formCompilePending,
      );
      const resolvedForm = resolvedCharacterForm(requestedForm, formReadyMask);
      const formVisibility = characterFormVisibility(resolvedForm);
      applyCharacterFormVisibility(v, formVisibility, v.visualCompilePending);
      // rideable mount under the player (the lazy form-visual pattern). Mount
      // GLBs are lazyPreload: the first sight of a rider kicks the fetch and
      // the visual appears once ready. A druid form replaces the whole body,
      // so the form wins visually and the mount hides (the sim's speed math
      // is untouched either way).
      const mountSpec = e.kind === 'player' && e.mountKey ? mountVisualSpec(e.mountKey) : null;
      const mountShown = !!mountSpec && requestedForm === 'base' && !e.dead;
      if (mountSpec && v.mountVisualKey !== mountSpec.visualKey) {
        if (v.mountVisual) {
          v.group.remove(v.mountVisual.root);
          v.mountVisual.dispose();
          v.mountVisual = null;
        }
        v.mountVisualKey = '';
        if (mountAssetsReady(mountSpec.visualKey)) {
          const mountStarted = performance.now();
          v.mountVisual = createMountVisual(mountSpec.visualKey);
          this.buildLedger.record('view:mount', performance.now() - mountStarted, mountStarted);
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
      const active = activeCharacterFormVisual(
        resolvedForm,
        v.visual,
        v.sheepVisual,
        v.bearVisual,
        v.catVisual,
        v.travelVisual,
        v.metamorphVisual,
      );
      if (!e.templateId.startsWith('vision_')) {
        active.clickProxy.userData.entityId = e.id;
      }
      if (v.clickTarget !== active.clickProxy) {
        const clickIndex = this.clickTargets.indexOf(v.clickTarget);
        if (clickIndex >= 0) this.clickTargets[clickIndex] = active.clickProxy;
        v.clickTarget = active.clickProxy;
      }
      v.height = active.height;
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
      active.setGhost(ghost || veilboundState === 'march', ghostStyle);
      active.setSoulRend(hasSoulRend);
      // Shadowform tints the base priest rig shadow-purple (no rig swap). Moonkin Form and
      // Metamorphosis reuse the same tint treatment (a bright violet, and a dark fel demon);
      // Metamorphosis also grows the body via Entity.scale in the sim.
      active.setShadowform(hasShadowform);
      active.setMoonkin(hasMoonkin);
      // Metamorphosis is no longer a tint on the base rig: it has its own lazy
      // CharacterVisual driven by formVisibility.metamorph above.
      active.setAscended(veilboundState !== 'none');
      active.setRuneTint(characterRuneTintColor(e));
      // saddle lift: the rider (click proxy included, a root child) sits at
      // the seat height while mounted; 0 whenever the mount is absent/hidden.
      // seatFwd slides the rider along facing onto saddles that sit off the
      // model origin (the toad's is well back toward the tail).
      v.visual.root.position.y = v.mountLift;
      v.visual.root.position.z = v.mountLift > 0 && mountSpec ? mountSpec.seatFwd : 0;
      // distant rigs swap to the single-draw baked idle-pose mesh
      v.visual.setFar(v.isFar && active === v.visual && resolvedForm !== 'fireball');
      v.sheepVisual?.setFar(v.isFar && active === v.sheepVisual);
      v.bearVisual?.setFar(v.isFar && active === v.bearVisual);
      v.catVisual?.setFar(v.isFar && active === v.catVisual);
      v.travelVisual?.setFar(v.isFar && active === v.travelVisual);
      v.metamorphVisual?.setFar(v.isFar && active === v.metamorphVisual);
      const shadowPlan = characterFormShadowPlan(resolvedForm, {
        isSelf,
        nearShadow: wantShadow,
        inProxyBand,
        staticFar: v.isFar,
      });
      active.setShadow(shadowPlan.activeArticulated);
      v.visual.setProxyShadow(shadowPlan.baseProxy);
      v.sheepVisual?.setProxyShadow(shadowPlan.formProxy && active === v.sheepVisual);
      v.bearVisual?.setProxyShadow(shadowPlan.formProxy && active === v.bearVisual);
      v.catVisual?.setProxyShadow(shadowPlan.formProxy && active === v.catVisual);
      v.travelVisual?.setProxyShadow(shadowPlan.formProxy && active === v.travelVisual);
      v.metamorphVisual?.setProxyShadow(shadowPlan.formProxy && active === v.metamorphVisual);

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
      const wl = waterLevelAt(ax, az, this.sim.cfg.seed);
      const feetDepth = wl - ay;
      const floorSampleDepth = v.wasSwimming ? SWIM_EXIT_FEET_DEPTH : SWIM_ENTER_FEET_DEPTH;
      const floorDepth =
        !e.dead && feetDepth >= floorSampleDepth
          ? wl - groundHeight(ax, az, this.sim.cfg.seed)
          : Number.NEGATIVE_INFINITY;
      const swimming = isSwimmingAtDepth(v.wasSwimming, e.dead, feetDepth, floorDepth);
      // ...and the band under it, where the feet are wet but the ground is
      // still doing the work. Read off the SAME displayed depth as the swim
      // latch, so a body crossing a shoreline can never be both at once.
      const wading = isWadingAtDepth(v.wasWading, swimming, e.dead, feetDepth);
      v.wasWading = wading;

      // Sheathe, from the Z key OR from being in the water: nobody swims with a
      // sword in their hand. Swimming is an OVERLAY on the sim's cosmetic
      // weaponStowed bit rather than a write to it — the player's own sheathe
      // choice is untouched, so wading back out restores exactly what they had
      // drawn, and a peer's weapon rides their back the moment they start
      // swimming without any wire traffic. (This diff sits here, after the swim
      // latch, precisely so both halves are known in the same frame.)
      const stowed = e.weaponStowed || swimming;
      if (stowed !== v.weaponStowed) {
        v.weaponStowed = stowed;
        v.visual.setWeaponStowed(stowed);
      }
      // Which stroke, and whether the body still breaks the surface at all. The
      // sim owns the DEPTH (players dive with the dive key); this is the
      // presentation read of it, taken off the same displayed coordinates as
      // the swim latch so pose and splash can never disagree.
      const submerged = isSubmergedAtDepth(
        v.wasSubmerged,
        swimming,
        feetDepth,
        active.height * e.scale,
      );
      const vx = ax - v.lastX,
        vz = az - v.lastZ;
      // Vertical travel, off the SAME displayed coordinates: how hard the body
      // noses over into its dive or its climb. Taken from motion rather than
      // from the local camera on purpose — peers pitch the same way with no
      // wire traffic, and the pose can never disagree with the descent it is
      // drawn against (at the bed, or held at the line, it levels out by
      // itself). Only players ever leave the surface, so mobs skip it.
      const vy = dt > 0 ? (ay - v.lastY) / dt : 0;
      v.lastX = ax;
      v.lastZ = az;
      v.lastY = ay;
      v.swimPitch = advanceSwimPitch(v.swimPitch, vy, swimming && e.kind === 'player', dt);
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
          const rf = this.sim.riftFloor;
          if (!rf) return;
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
      // Contact blob (no-dynamic-shadow tiers only; the painter is null on the
      // rest). Filled here rather than from a walk of its own because
      // everything it needs has just been settled for this body: the drawn feet
      // height, whether the body is on a surface at all, the frustum answer,
      // and the distance. Far-LOD bodies are included on purpose: the blob is
      // read off the entity, not the rig, so a frozen static mesh keeps its
      // grounding. A corpse keeps its blob for as long as the body is drawn.
      //
      // Ground reference: the DRAWN feet height while the body is on a
      // surface, which is exact and free, and keeps a blob flush with a dock, a
      // crate top, or a step the smoother is still easing. Only an airborne or
      // swimming body pays a terrain sample (a handful per frame at most), and
      // for a swimmer the lake bed below collapses the blob by height, which is
      // what should happen to a body that is not touching the ground.
      if (this.blobShadows) {
        const onSurface = !airborne && !swimming;
        const blobGroundY = onSurface ? smoothY : groundHeight(x, z, this.sim.cfg.seed);
        this.blobShadows.push(
          blobShadowPlanInto(
            this.blobShadowSlot,
            x,
            smoothY,
            z,
            blobGroundY,
            blobBaseRadius(active.height, v.liveScale),
            d2,
            BLOB_SHADOW_RANGE_SQ,
            v.group.visible && active.root.visible && charOnScreen,
          ),
        );
      }
      // Terrain lean: near bodies tip toward the surface they stand on. The
      // gradient is resampled on a cadence (four terrain samples) and damped
      // in between, so a crowd costs a handful of samples per frame, and a
      // body standing on a flat prop top stays upright.
      if (runCharacterPresentation && v.visual && !v.isFar) {
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
      if (runCharacterPresentation && v.visual) {
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
      // Long-fall flail: displayed vertical speed past what any hop reaches
      // (the same displayed-motion discipline as swimPitch, so peers flail
      // identically with no wire traffic). Mounted riders never flail:
      // st.airborne is already held false for them.
      v.wasFalling = isFallingAtSpeed(v.wasFalling, st.airborne, vy);
      st.falling = v.wasFalling;
      st.backwards = loco.backwards;
      st.reverseBackpedal = ghostWolf;
      st.dead = visuallyDead;
      st.casting = characterCasting;
      // Which ability, so the pose layer can tell a drawn shot from a pet
      // utility cast (tame_beast is a 6s cast; a bow must not sit aimed for it).
      st.castingAbility = characterCasting ? (e.castingAbility ?? null) : null;
      st.spinning =
        st.casting &&
        e.castingAbility !== null &&
        ABILITIES[e.castingAbility]?.selfCentered === true;
      st.swimming = swimming;
      st.submerged = submerged;
      st.swimPitch = v.swimPitch;
      st.wading = wading;
      if (isSelf) this.selfSubmerged = submerged && !visuallyDead;
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
          // An engine mount (windup/loop/winddown take set, e.g. the tank
          // mount) drives its own state machine every frame instead of the
          // per-stride gait beat below; mountEngine reports whether this
          // mountKey actually has one, so ordinary mounts fall through.
          if (sink.mountEngine(ax, ay, az, e.mountKey, true, e.id)) {
            // handled entirely by mountEngine
          } else if (loco.speed >= FOOT_RUN_SPEED) {
            v.stepAccum += loco.speed * dt;
            if (v.stepAccum >= MOUNT_STRIDE_RUN) {
              v.stepAccum = 0;
              sink.mountRun(ax, ay, az, e.mountKey, isSelf);
            }
          } else {
            v.stepAccum = MOUNT_STRIDE_RUN * 0.6;
          }
        } else if (logicallyMounted && airborne) {
          // Airborne while mounted (a jump, or hopping over a ledge): HOLD
          // whatever engine-audio phase was already playing rather than
          // polling mountEngine with moving=false, which would read the hop
          // as a stop and run a full winddown-then-windup cycle for every
          // little bump in the road. Skipping the poll entirely leaves the
          // state machine (and any active loop) exactly where it was; the
          // next grounded frame picks the state back up on its own branch.
        } else if (logicallyMounted && !visuallyDead && !(st.sitting && !riderMounted)) {
          // Not moving while mounted (grounded and stopped): still poll an
          // engine mount every frame so the winddown fires on the stop edge;
          // a non-engine mount has nothing to do here (mountEngine no-ops).
          sink.mountEngine(ax, ay, az, e.mountKey, false, e.id);
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
      } else if (sink && logicallyMounted) {
        // Every other cue in the block above is a one-shot; an engine
        // mount's loop is not, and this gate (SFX_MOVE_RANGE_SQ, 42yd) sits
        // inside the panner's own audible falloff (MAX_DISTANCE, 46yd in
        // sfx.ts). Without this, a rider who moves out of the 42yd gate
        // while still moving leaves a frozen, never-advancing loop node
        // playing at its last polled position until dismount or view
        // removal. mountEngineReset is a safe no-op with no active engine
        // state (an ordinary mount, or the loop already stopped).
        sink.mountEngineReset(e.id);
      }
      // Capture the flight's peak fall speed before the landing reset: the
      // water-entry splash below scales with how hard the body came down.
      const entryFallSpeed = v.fallSpeed;
      // Reset the flight's peak fall speed once grounded, so the next landing
      // is measured from its own drop and not the last one.
      if (!airborne) v.fallSpeed = 0;

      // Feed rendered body motion into the persistent height field. This begins
      // while wading, before the swim-pose latch, and uses old minus new surface
      // capsule footprints to create a coherent wake instead of detached rings.
      const contactLevel = wl;
      const contactRadius = Math.min(1.25, Math.max(0.34, active.height * v.liveScale * 0.16));
      const waterDepth = contactLevel - ay;
      const contactImmersion = Number.isFinite(waterDepth)
        ? Math.min(1, Math.max(0, (waterDepth + 0.04) / (contactRadius * 0.85)))
        : 0;
      const contactAxisX = Math.sin(facing);
      const contactAxisZ = Math.cos(facing);
      const contactHalfLength = swimming
        ? Math.min(1.05, Math.max(contactRadius * 0.9, active.height * v.liveScale * 0.3))
        : contactRadius * 0.22;
      const touchesWater =
        !visuallyDead &&
        !st.sitting &&
        Number.isFinite(contactLevel) &&
        waterDepth >= -0.035 &&
        ay + active.height * v.liveScale * 0.82 > contactLevel;
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
          // Impact weight: only speed BEYOND a flat hop's landing (~6-7 yd/s)
          // counts, so stepping or hopping in keeps the modest splash it
          // always had while a flail-height plunge reads as a real burst.
          const impactWeight = Math.max(0, entryFallSpeed - 7);
          const splashStrength = Math.min(
            2.4,
            0.82 + loco.speed * 0.08 + contactImmersion * 0.25 + impactWeight * 0.11,
          );
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
            contactRadius * (1.45 + Math.min(0.8, impactWeight * 0.055)),
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
            ? Math.min(1.05, Math.max(contactRadius * 0.9, active.height * v.liveScale * 0.3))
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
      // Surface swimmers churn the water where their feet kick. A SUBMERGED
      // swimmer emits nothing at all: there is no surface up there to break,
      // and the quiet is the point of going under.
      if (swimming && !submerged && !visuallyDead && charOnScreen && Number.isFinite(wl)) {
        v.swimKickPhase += dt * SWIM_KICK_HZ * (0.55 + Math.min(1.1, loco.speed / 3.2));
        if (v.swimKickPhase >= 1) {
          v.swimKickPhase -= 1;
          const trail = active.height * e.scale * SWIM_FOOT_TRAIL;
          const footX = ax - contactAxisX * trail;
          const footZ = az - contactAxisZ * trail;
          const kick = Math.min(1.3, 0.5 + loco.speed * 0.09);
          this.vfx.swimKickSplash(footX, wl, footZ, contactAxisX, contactAxisZ, kick);
          this.waterView.addSplash(footX, footZ, contactRadius * 0.8, kick * 0.5);
        }
      } else {
        v.swimKickPhase = 0;
      }
      v.wasAirborne = airborne;
      v.wasSwimming = swimming;
      v.wasSubmerged = submerged;
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
      if (runCharacterPresentation) active.update(dt, st, animate, this.reducedMotion());
      else active.advanceOffscreen(dt);
      // Weapon-skin VFX ride the humanoid rig's held weapon. Hidden cosmetic
      // rigs skip their uniform writes until they return to view; the visible
      // ones shed with camera distance and the frame-budget governor's vfx
      // lever (weapon_vfx_shed_core owns why that split is fairness-safe).
      if (runCharacterPresentation) {
        v.visual.updateWeaponVfx(dt, weaponVfxShedScale(d2, this.appliedBudgetLevels?.vfx ?? 1));
      }
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
        if (runCharacterPresentation) {
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
        } else {
          v.mountVisual.advanceOffscreen(dt);
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
          !swimming &&
          runCharacterPresentation
        ) {
          active.playCallPose(e.mountCastRemaining);
        }
        v.wasMountCasting = mountCasting;
        // mountKey change = summon completed, dismount completed, or a live swap:
        // fire the shimmer at the rider. Tracked separately from mountVisualKey,
        // which lags async asset loading.
        if (e.mountKey !== v.lastMountKey) {
          v.lastMountKey = e.mountKey;
          if (runCharacterPresentation) this.vfx.mountSummonGlow(e.id);
          // A mountKey change (dismount, a live mount swap, or a fresh summon
          // reusing this entity id) must drop any engine mount's windup/loop
          // state; otherwise the old loop node stays connected forever once
          // logicallyMounted goes false (the entity/view-removal reset at
          // removeView() never fires for a live swap or dismount), and a swap
          // would carry the old moving state into the new mount, skipping its
          // windup.
          this.audioSink?.mountEngineReset(e.id);
          // Warm the new mount's engine clips right away (not e.g. lazily on
          // the first movement frame): a cold first ride otherwise plays the
          // windup through playAt's cold path (silently dropped past a 0.12s
          // fetch/decode window) and the loop's cold path (a fallback fade-in
          // instead of the immediate splice), reading as ~0.9s of silence
          // then a swell. A no-op for an ordinary (non-engine) mount.
          if (e.mountKey !== '') this.audioSink?.preloadMountEngine(e.mountKey);
        }
      }

      // per-ability windup orb + buff-orbit bands (spec-driven; no-op for
      // entities with no spec'd cast or aura)
      const recklessSkullsSpawned = v.recklessSkullsSpawned === true;
      const nextRecklessSkullsLatch = nextRecklessnessSkullsLatch(
        hasRecklessness,
        runCharacterPresentation,
        recklessSkullsSpawned,
      );
      const spawnRecklessnessSkulls = nextRecklessSkullsLatch && !recklessSkullsSpawned;
      if (!syncAbilityVfxCast(e.castingAbility, this.abilityVfx, e)) {
        this.abilityVfx.syncEntity(e, runCharacterPresentation);
      }
      if (runCharacterPresentation) {
        if (shouldDrawLegacyCastSparkle(st.casting, e.castingAbility)) {
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
        if (veilboundState !== 'none') this.vfx.castSparkle(e.id, 'holy', dt * 2.4);
        if (!e.dead && (ferocityStage > 0 || petFrenzy)) {
          this.vfx.castSparkle(
            e.id,
            'fire',
            dt * (0.45 + ferocityStage * 0.35 + (petFrenzy ? 1 : 0)),
          );
        }
        if (tithefiendEmpoweredActive(e)) {
          this.vfx.castSparkle(e.id, 'shadow', dt * 2.4);
        }
        if (hasRecklessness) {
          this.vfx.recklessFlame(e.id, dt);
          if (spawnRecklessnessSkulls) {
            this.recklessSkulls.spawn(v.group, active.height * e.scale);
          }
        }
        // Shapeshift-form particle auras riding the tints above: metamorph fire,
        // moonkin star motes, shadowform gloom wisps. Suppressed for the dead
        // (the auras themselves drop, but a corpse must not smolder for a frame).
        if (!e.dead) {
          if (hasLegacyMetamorphAura) this.vfx.formAura(e.id, 'metamorph', dt);
          else if (hasLichAura && !this.reducedMotion()) {
            this.vfx.lichAura(e.id, dt, soulFragments);
          } else if (hasMoonkin) this.vfx.formAura(e.id, 'moonkin', dt);
          else if (hasShadowform) this.vfx.formAura(e.id, 'shadowform', dt);
        }
        // The graveyard angel: a soft, constant golden shimmer rising off the Spirit Healer.
        if (e.templateId === 'spirit_healer') this.vfx.castSparkle(e.id, 'holy', dt * 0.6);
      }
      const heartbeat = stepLichHeartbeat(
        v.lichHeartbeatAt,
        this.time,
        hasLichAura && !e.dead,
        Boolean(sink) && d2 < SFX_MOVE_RANGE_SQ,
      );
      v.lichHeartbeatAt = heartbeat.nextAt;
      if (heartbeat.play) sink?.necromancy('lichHeartbeat', ax, ay, az, isSelf, e.id);
      // Preserve the spawn latch while the aura is active and hidden. Camera
      // re-entry must not replay the skull burst; a real aura end re-arms it.
      v.recklessSkullsSpawned = nextRecklessSkullsLatch;

      // skip the draw for off-screen rigs (pose/audio above already ran)
      if (!charOnScreen) v.group.visible = false;
    }
    this.lastVisibleRigCount = visibleRigCount;
    this.blobShadows?.commit();
    this.drainWeaponSkinApplies();

    // Night mob glow: a warm pool of light on the ground under every nearby body
    // once it is properly dark, so a mob out in an unlit field still reads as a
    // body. Driven here rather than from the entity loop above because all it
    // needs is the final visibility that loop just settled plus the drawn
    // position; the walk itself lives in the module that owns the pool.
    //
    // Outdoors only: the world clock does not govern a dungeon, a delve, the
    // Last Keep, or the seabed, each of which runs its own authored rig. Without
    // this, walking underground at world-midnight lit a pool under every mob and
    // the same dungeon went dark again at world-noon, which is incoherent to a
    // player who never saw the sky. `fogState` carries last frame's answer (it
    // settles in updateAmbience, below the entity loop); one frame of discs on
    // the way through a door is not worth reordering the frame for.
    // Where the night light field runs, bodies light the ground through the
    // terrain shader instead (real reactive light); the disc pool is the
    // fallback tier's cue, so the field zeroes its amount rather than both
    // layers warming the same ground twice.
    const bodyGlow = this.fogState === 'outdoor' ? mobGlowAmount(this.dnGlobalNight) : 0;
    this.mobNightGlow?.emit(
      this.views,
      sim.entities,
      p.pos.x,
      p.pos.z,
      hasNightLightField() ? 0 : bodyGlow,
    );
    this.nightBodyLightCount =
      hasNightLightField() && bodyGlow > 0.001
        ? collectBodyNightLights(this.views, sim.entities, p.pos.x, p.pos.z, this.nightBodyLights)
        : 0;

    // Hidden views hide-freeze their WHOLE rig subtree's matrix flags (r185
    // recurses children unconditionally, so the old root-only gate left every
    // default-flag descendant recomposing per frame; rig_visibility_freeze.ts
    // carries the semantics). Flag walks run on transitions only, and the
    // reveal forces one recompose of the current pose, so nothing renders
    // stale. (pick() skips hidden views, so a frozen matrix never ghosts a
    // hitbox. CAUTION: getWorldPosition inside a frozen subtree does not heal
    // the chain, hence the light-owner exemption; any new world-space read of
    // a hidden view's child must use group.position or exempt the view too.)
    let visibleViews = 0;
    for (const [, v] of this.views) {
      syncRigMatrixFreeze(v.group, v.group.visible || this.lightOwnerGroups.has(v.group));
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
    // Streetlamps light before the budget runs, not after: the budget and its
    // flicker pass are what actually write light.intensity, and they read the
    // baseIntensity this sets. Running it afterward would put a lamp's own level
    // back on top of a light the governor had just budgeted out.
    const lampGlow = lampGlowAmount(this.dnGlobalNight);
    this.streetlamps?.update(lampGlow, this.time);
    this.emberPools?.update(lampGlow, this.time);
    this.campBraziers?.update(lampGlow, this.time);
    this.decorTorchFx?.update(lampGlow, this.time);
    // The night light field: every lamp and camp fire plus the nearby bodies
    // collected above, packed into the terrain shader's uniform slots. Indoors
    // the world clock does not govern the ground either, so the same fogState
    // gate the discs use zeroes the whole field.
    updateNightLightField(
      p.pos.x,
      p.pos.z,
      this.fogState === 'outdoor' ? lampGlow : 0,
      this.fogState === 'outdoor' ? mobGlowAmount(this.dnGlobalNight) : 0,
      this.time,
      this.nightBodyLights,
      this.nightBodyLightCount,
    );
    this.budgetFireLights(p.pos.x, p.pos.z, true);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'lights', worldStart);

    // water shimmer (low-tier texture scroll; shader water rides uTime)
    this.lastWaterSimulationPasses = this.waterView.update(
      this.time,
      this.camera.position.x,
      this.camera.position.z,
      (this.scene.fog as THREE.Fog).far,
      this.camera.position.y,
    );
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'water', worldStart);
    this.bgFx.update(this.time);
    this.updateBgWards();
    this.vfx.update(dt);
    // Racing line (cosmetic; reads the self race view only).
    this.raceLine.update(this.sim.mountRaceView(), this.time, dt);
    // Island guidance trail (actionable on every tier; island-gated inside).
    this.islandGuidance.update(this.sim, this.time, dt);
    // Start platform: visible while the riding quest is active and no race is live.
    this.mountBeacon.update(
      this.sim.questState('q_riding_lessons') === 'active' && !this.sim.mountRaceView(),
      this.time,
    );
    this.abilityVfx.update(dt, this.reducedMotion());
    this.needleOfFateVfx.update(dt, this.reducedMotion());
    this.sentenceVfx.update(dt, this.reducedMotion());
    this.frozenOrbFx.update(dt);
    this.mageGroundFx.update(dt);
    this.warlockMeteorFx.update(dt, this.reducedMotion());
    // Same post-fx budget recovery as the prewarm frame path: a landing or
    // expiry must not dip the pinned visible count for the frame it lands on.
    if (this.lightRankDirty) this.budgetFireLights(p.pos.x, p.pos.z, true);
    this.necromancyGroundFx.update(dt, this.reducedMotion());
    this.necromancyArmyPortalFx.update(dt, this.reducedMotion());
    this.abyssalRiftFx.update(dt, this.reducedMotion());
    this.ringOfFrostVisuals.sync(this.sim.activeFrostRings);
    this.ringOfFrostVisuals.update(dt);
    if (this.riftDeathZoneVisuals) {
      this.riftDeathZoneVisuals.sync(this.sim.riftBossDeathZones());
      this.riftDeathZoneVisuals.update(dt);
    }
    this.temporalHourglassGroundVisuals.sync(this.sim.activeTemporalHourglasses);
    this.temporalHourglassGroundVisuals.update(dt);
    this.paladinConsecrationVisuals.sync(this.sim.activeConsecrations);
    this.paladinConsecrationVisuals.update(dt, this.reducedMotion());
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
    for (const id of this.snapshotDrainVisualChannels) {
      if (!this.views.has(id)) this.snapshotDrainVisualChannels.delete(id);
    }
    for (const id of this.snapshotDemonicDrainVisualChannels) {
      if (!this.views.has(id)) this.snapshotDemonicDrainVisualChannels.delete(id);
    }
    this.drainChannelStopLatch.prune(this.sim.entities);

    // Battleground keeps, gatehouses and towers fade when they come between the
    // player and the chase camera (the same occluder-fade family every other
    // interior-capable subsystem uses). A no-op loop while no field is built.
    updateBattlegroundOccluderFades(
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
    this.evilEyeMarkers.update(this.sim, this.views, this.reducedMotion());
    this.burningPactMarkers.update(this.sim, this.views, this.reducedMotion());
    this.umbralAnchorMarker.update(
      this.sim.entities.get(this.sim.playerId),
      this.time,
      this.reducedMotion(),
      this.lowGfx,
    );
    this.afflictionFamiliar.update(this.sim, this.views, this.reducedMotion(), this.time);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'vfx', worldStart);

    this.updateCamera(selfPos, dt);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'camera', worldStart);
    // Terrain chunks / tree buckets past the detail horizon are dropped
    // before the frustum; camera-ghost props fade against the eye ray. On
    // vista tiers this horizon is the classic envelope, never scene fog (the
    // far mesh and the sprites own everything beyond it).
    const fogFar = this.subsystemCullFar();
    // The foliage handoff keys off distance planes (foliage_impostor_core.ts /
    // foliage_lod.ts); with the vista on, the near plane pairs with the CAPPED
    // far the foliage culls against, never scene fog.
    const fogNear =
      this.vistaLive() && this.fogState === 'outdoor'
        ? Math.min((this.scene.fog as THREE.Fog).near, fogFar * 0.55)
        : (this.scene.fog as THREE.Fog).near;
    this.queueVisibleZonePrepares(Math.max(fogFar, this.lastRequestedFogFar));
    // The player standing in a zone whose background prepare is still running
    // escalates that build to fast pacing: the ground under their feet must
    // not keep crawling in at idle-slot speed (a border walk arrives before
    // the neighbour's idle prepare finishes by design; this is its handoff).
    {
      const standingZoneId = this.zoneIdAt(p.pos.x, p.pos.z);
      if (standingZoneId !== null && this.pendingZonePrepares.has(standingZoneId)) {
        this.terrainView.escalateZone(standingZoneId);
      }
      // ...and so does a NEIGHBOUR's unbuilt ground while it is holding the
      // detail horizon in. Standing-zone-only escalation left the common case
      // unserved: unbuilt ground a couple of hundred yards over a border
      // collapses the horizon the player is looking through and hands the
      // mid-field to the coarse vista mesh, which carries no splat texture and
      // takes no shadows. (The clamp is directional now, so this fires on
      // ground actually in frame rather than on anything within a radius; that
      // makes it rarer, not less worth escalating.) Every prepare in flight is
      // escalated rather than the one owning the binding chunk: the queue is
      // urgency-ordered nearest-first and runs one zone at a time, so that is
      // the same zone in all but a race, at no spatial-query cost. See
      // detail_horizon_core.ts for why this is safe to leave on.
      //
      // Vista arm only, deliberately. The fogged arm hides the same clamp
      // behind its murk wall rather than showing coarse ground through it, so
      // the artifact this trades frame time for does not exist there, and its
      // tiers are the ones least able to afford the trade.
      const vistaOutdoor = this.farVista.enabled && this.fogState === 'outdoor';
      if (vistaOutdoor && detailHorizonStarved(fogFar, this.entryDetailHorizon.demandFar())) {
        for (const zoneId of this.pendingZonePrepares.keys()) {
          this.terrainView.escalateZone(zoneId);
        }
      }
    }
    this.terrainView.update(this.camera.position.x, this.camera.position.z, fogFar);
    this.farTerrainView.update(
      this.camera.position.x,
      this.camera.position.z,
      fogFar,
      this.viewFar(),
      this.fogState === 'outdoor',
    );
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'terrain', worldStart);
    this.updateZoneFeatureVisibility(fogFar);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'zoneVisibility', worldStart);
    // Shared by every occluder-fade view below: same camera and look-at
    // point, so one read stands in for the six repeated field accesses.
    const camX = this.camera.position.x;
    const camY = this.camera.position.y;
    const camZ = this.camera.position.z;
    const eyeX = this.cameraLookAt.x;
    const eyeY = this.cameraLookAt.y;
    const eyeZ = this.cameraLookAt.z;
    this.propsView.update(camX, camY, camZ, eyeX, eyeY, eyeZ, fogFar, dt, this.reducedMotion());
    this.eastbrookTownView.update(
      camX,
      camY,
      camZ,
      eyeX,
      eyeY,
      eyeZ,
      fogFar,
      dt,
      this.reducedMotion(),
    );
    this.fenbridgeTownView.update(
      camX,
      camY,
      camZ,
      eyeX,
      eyeY,
      eyeZ,
      fogFar,
      dt,
      this.reducedMotion(),
    );
    this.dungeons?.update(camX, camY, camZ, eyeX, eyeY, eyeZ, dt, this.reducedMotion());
    this.hollowGates.update(camX, camY, camZ, eyeX, eyeY, eyeZ, dt, this.reducedMotion());
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
      this.vistaLive() && this.fogState === 'outdoor'
        ? this.farVista.envelopeFar * 0.9
        : this.lastRequestedFogNear,
      this.vistaLive() && this.fogState === 'outdoor'
        ? this.farVista.envelopeFar
        : this.lastRequestedFogFar,
      projectionPixels,
      dt,
      this.reducedMotion(),
    );
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'foliage', worldStart);
    this.fish.update(p.pos.x, p.pos.z, dt);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'fish', worldStart);
    this.motes.update(p.pos.x, p.pos.z, dt);
    // The wilderness night layer rides beside the ambient motes: same
    // player-centred streaming contract, but gated on real dark and anchored to
    // world cells for the flora (see night_accents.ts).
    // Same outdoor gate as the mob glow: mushrooms and fireflies belong to the
    // sky's clock, so an instanced interior never grows them.
    this.nightAccents?.update(
      this.fogState === 'outdoor' ? wildGlowAmount(this.dnGlobalNight) : 0,
      this.time,
      dt,
      p.pos.x,
      p.pos.z,
    );
    this.bladeGrass.update(p.pos.x, p.pos.z);
    // fogFar here is subsystemCullFar(): the residency-clamped detail
    // horizon, so band blades never stand past unbuilt ground
    this.bladeGrassBand.update(p.pos.x, p.pos.z, fogFar, this.fogState === 'outdoor');
    this.cliffScree.update(p.pos.x, p.pos.z);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'ambientScenery', worldStart);
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
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'zoneFeatures', worldStart);
    this.updateAmbience(p.pos.x, this.camera.position.y, dt);
    this.updateUnderwater(dt);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'ambience', worldStart);
    // shadow frustum follows the player
    const pv = this.views.get(p.id);
    if (pv) this.updateKeyLight(pv.group.position);
    worldStart = this.markRendererWorldPhase(worldPhaseMs, 'shadows', worldStart);
    // sky dome + sun disc ride along with the camera. The battleground is
    // OPEN-AIR: dome, sun, and weather render over the band exactly like the
    // overworld (hiding them left a black void above the ramparts).
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.sky.visible = isOpenAirFogState(this.fogState);
    if (this.sky.visible) {
      this.skyView.setCameraPos(this.camera.position.x, this.camera.position.z, dt);
      if (!this.lowGfx) {
        this.skyView.setDayNight(this.dnGrade.sky);
        this.skyView.setCycle(
          this.sunDir,
          duskWarmAmount(this.sunDir.y),
          nightSkyDesat(this.dnGrade.nightAmt),
        );
        this.skyView.setFog((this.scene.fog as THREE.Fog).color);
        this.skyView.setStars(this.starAmt, this.time);
        this.updateEnvBiome(dt);
      }
    }
    // precipitation only falls outdoors; indoors/underwater pass null to clear.
    // The sampler lets a neighbouring zone's weather fall inside the box while
    // the player stands outside it (weather_field_core.ts).
    // Precipitation is unlit, so it takes the grade explicitly or snow stays
    // pure white at midnight. Same multiply as the fog and the water surface.
    this.weather.setDayNight(this.dnGrade.fog);
    this.weather.update(
      this.camera.position,
      dt,
      this.fogState === 'outdoor' ? zoneBiomeAt(p.pos.x, p.pos.z) : null,
      zoneBiomeAt,
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
    }
    this.updateOpaqueDrawOrder(dt);
    if (shakeX !== 0 || shakeY !== 0) refreshFrozenWorldMatrix(this.camera);
    // Refresh the reused host every frame instead of building a literal: sync
    // is the rAF hot path (no per-frame allocation), and post can be torn down
    // and rebuilt by a graphics rebuild, so a cached reference would go stale.
    const host = this.framePresentHost;
    host.vfx = this.vfx;
    host.post = this.post;
    host.webgl = this.webgl;
    host.scene = this.scene;
    host.camera = this.camera;
    if (presentFrame(host, dt, present)) this.presentedFrameCount++;
    if (shakeX !== 0 || shakeY !== 0) {
      this.camera.position.x -= shakeX;
      this.camera.position.y -= shakeY;
    }
    phaseStart = this.markRendererPhase(framePhaseMs, 'submit', phaseStart);
    const totalMs = performance.now() - totalStart;
    framePhaseMs.total = roundMs(totalMs);
    this.recordRendererPhase('total', totalMs);
    const afterSubmit = performance.now();
    frameStats.renderDiagnostics = this.renderDiagnostics.forFrame(
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
    noteArrivalIfTeleported(p.pos.x, p.pos.z, this.viewCandidates.length);
    if (this.hitchLogEnabled) {
      const sample = this.hitchAligner.atEnd(
        afterSubmit,
        Math.min(250, Math.max(0, dt * 1000)),
        framePhaseMs.submit,
        createdViews,
        framePhaseMs.total,
        usedJsHeapMb(),
      );
      if (this.hitchSkipNextFrame) this.hitchSkipNextFrame = false;
      else if (sample) this.hitchTracker.frame(sample);
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
      refreshFrozenWorldMatrix(this.camera);
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

  // The registration seam for a point light an fx mints mid-session (the
  // warlock infernal's fall and impact lights). It MUST join the same ranked
  // budget as fire and view lights: Three counts a light into numPointLights
  // iff `visible`, that count is part of every lit material's program cache
  // key, and one unranked light appearing is a synchronous relink of every lit
  // material in view (the mid-combat stall the pinned count exists to prevent).
  // Hidden on the way in because the owning fx updates AFTER budgetFireLights
  // in the frame, so the light must never count unranked; the post-fx recovery
  // pass (both frame paths re-run the budget when the rank went dirty) ranks
  // it before this frame renders, and the budget owns `visible` from then on.
  // Dynamic means
  // the budget only ever ZEROES the intensity and never restores it, so an fx
  // that wants a light back must re-drive its own level from BEFORE the pass
  // (weapon_vfx.ts is the other dynamic owner and does exactly that).
  private registerBudgetPointLight(light: THREE.PointLight): void {
    light.userData.budgetDynamic = true;
    light.visible = false;
    this.viewLights.push(light);
    this.lightRankDirty = true;
  }

  private releaseBudgetPointLight(light: THREE.PointLight): void {
    const index = this.viewLights.indexOf(light);
    if (index < 0) return;
    this.viewLights.splice(index, 1);
    this.lightRankDirty = true;
  }

  // Forward-renderer point-light budget: every campfire/torch light exists,
  // but only the nearest GFX.maxPointLights within range shine each frame.
  // Rank entries are pooled (extended only when interiors or view lights change).
  // Static world positions stay cached; moving weapon VFX refresh into their
  // existing vectors, so the per-light work allocates nothing. The one
  // allocation is the pass descriptor below, one small object per frame,
  // deliberately not pooled: a pooled descriptor would have to re-read every
  // registry each pass anyway (the constructor rebinds fireLights once the
  // props are built), and one that captured them instead would rank a dead
  // array while numPointLights moves, which is the stall this prevents.
  private budgetFireLights(px: number, pz: number, flicker = false): void {
    // The pass itself lives in fire_light_registry.ts; the renderer only owns
    // the registries, the pads and the clock it reads from.
    runFireLightBudgetPass({
      rank: this.lightRank,
      rankDirty: this.lightRankDirty,
      fireLights: this.fireLights,
      viewLights: this.viewLights,
      pads: this.lightPads,
      px,
      pz,
      // maxPointLights is the per-tier constant, so the live governor
      // (effectivePointLights) only changes how many SHINE, not the count.
      visibleCount: GFX.maxPointLights,
      liveBudget: this.effectivePointLights || GFX.maxPointLights,
      rangeSq: LIGHT_BUDGET_RANGE_SQ,
      scene: this.scene,
      flickerTime: flicker ? this.time : null,
    });
    // A completed pass always leaves the rank current.
    this.lightRankDirty = false;
  }

  // light shafts fade in as the camera turns toward the sun, outdoor only
  private updateGodRays(): void {
    if (this.godRays.length === 0) return;
    // Wildheart and the Thornhollow hollow are open-air, but the long
    // screen-space shafts read as giant triangles against an enclosed rim.
    // Both keep the sun, sky, and outdoor grade while these shafts stay
    // reserved for the overworld. Twilight and gloom realms also fade them
    // completely through BIOME_GOD_RAYS, so skip their draw and math once the
    // eased scale reaches zero.
    const shafts = this.fogState === 'outdoor' && this.godRayZoneScale > 0.02;
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
      sp.visible = shafts;
      if (!shafts) continue;
      const sway = Math.sin(this.time * 0.13 + i * 2.1) * 10;
      // hang the shafts sunward of the camera but near eye height so they
      // cross a third-person frame instead of floating 150u overhead
      sp.position
        .copy(this.camera.position)
        .addScaledVector(sunAzimuth, 48 + i * 26)
        .addScaledVector(side, (i - 1) * 30 + sway);
      sp.position.y = this.camera.position.y + 16 + i * 7;
      sp.material.opacity =
        facing * facing * facing * (0.3 - i * 0.05) * this.sunUp * this.godRayZoneScale;
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
    // The far layer streams on the same lifecycle: without this, a host
    // that tears the renderer down right after (the editor destroys the GL
    // context next) leaves the idle-paced far build allocating geometries
    // against a dead renderer and retaining it through the closure.
    this.farTerrainView.cancelStreaming();
  }

  /** Release host-owned workers, overlay canvases, and document listeners. */
  dispose(): void {
    setBuildSpanSink(null);
    this.cancelTerrainStreaming();
    this.nameplatePainter.dispose();
    this.travelSpeedFx.dispose();
    this.blobShadows?.dispose();
    this.vfx.dispose();
    // Dispose of flames (THREE.Mesh[])
    for (const flame of this.flames) {
      if (flame.parent) flame.parent.remove(flame);
      if (flame.geometry) flame.geometry.dispose();
      if (flame.material) {
        if (Array.isArray(flame.material)) {
          for (const m of flame.material) m.dispose();
        } else {
          flame.material.dispose();
        }
      }
    }
    this.flames = [];
    // Dispose of fireLights (THREE.PointLight[])
    for (const light of this.fireLights) {
      if (light.parent) light.parent.remove(light);
      if (light.shadow && light.shadow.map) light.shadow.map.dispose();
    }
    this.fireLights = [];
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
    // The far-vista mesh samples the same heightfield, so a full rebuild
    // (map load / content swap) replaces it too: dispose the old tiles and
    // their one shared material, then rebuild from the current content.
    this.scene.remove(this.farTerrainView.group);
    this.farTerrainView.dispose();
    this.farTerrainView = buildFarTerrain(this.sim.cfg.seed, this.farVista, {
      x: this.sim.player.pos.x,
      z: this.sim.player.pos.z,
    });
    setRenderCategory(this.farTerrainView.group, 'terrain');
    this.scene.add(this.farTerrainView.group);
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
    // The far layer is a static snapshot of the heightfield, so a sculpt or
    // biome paint must invalidate the tiles it intersects or the edit
    // reverts to the old geometry when the camera backs across the detail
    // handoff. Stroke end is the right cadence (this hook), matching the
    // normal rebake's own debounce: never per drag sample.
    this.farTerrainView.rebuildRegion(region.minX, region.minZ, region.maxX, region.maxZ);
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
    this.waterView.setWavesEnabled(this.waterRipplesEnabled);
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
      lookAtFrozen(this.camera, this.cameraLookAt);
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

    // Follow a submerged swimmer UNDER the surface: a height CEILING folded
    // into the one cy assignment below (the graphics-overhaul contract pins
    // that the chase camera's coordinates are each assigned exactly once).
    // The chase boom rides well above the avatar, and the built-in lakes are
    // only three or four yards deep, so left alone the camera stays dry
    // however far you dive - and the whole underwater pass (blue wash,
    // bubbles, the breaststroke you are actually playing) would only ever be
    // visible from a zoomed-in view. The ground clamp below still keeps the
    // camera off the lake bed.
    const swimWaterLevel = waterLevelAt(selfPos.x, selfPos.z, seed);
    const underwaterCeilingY =
      this.selfSubmerged && Number.isFinite(swimWaterLevel)
        ? swimWaterLevel - UNDERWATER_CAMERA_DIP
        : Infinity;
    // The camera orbits the lagged/led pivot at the player's requested
    // distance. Scene geometry never changes that distance; registered
    // obstructors fade through their subsystem's occluder-fade pass.
    const px = this.camBoom.x + this.camFeel.leadX;
    const py = this.camBoom.y;
    const pz = this.camBoom.z + this.camFeel.leadZ;
    const eyeY = py + 2.0;
    const cx = px - Math.sin(pose.yaw) * Math.cos(pose.pitch) * pose.dist;
    const cy = Math.min(eyeY + Math.sin(pose.pitch) * pose.dist, underwaterCeilingY);
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
    // lookAtFrozen, never a bare lookAt (r185 frozen-matrix aim, static_matrix.ts).
    lookAtFrozen(this.camera, this.cameraLookAt);

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
      const nearWater = !inDungeon && groundHeight(px, pz, seed) < waterLevelAt(px, pz, seed) + 0.4;
      collectRiftAmbientSources(this.sim.entities, this.riftAmbienceScratch);
      // Early-out: no live rift ambience this frame, so skip building the
      // merged array entirely and hand the static set straight through.
      let points: readonly AmbientPointSource[] = this.ambientPointSources;
      if (this.riftAmbienceScratch.length > 0) {
        this.ambientPointsMergedScratch.length = 0;
        for (const p of this.ambientPointSources) this.ambientPointsMergedScratch.push(p);
        for (const p of this.riftAmbienceScratch) this.ambientPointsMergedScratch.push(p);
        points = this.ambientPointsMergedScratch;
      }
      sink.ambience(biome, inDungeon, precip, nearWater, 0, points);
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
      this.tmpV.y += v.height * v.liveScale * (dead ? 0.15 : 0.5);
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

  /** Apply the waterRipples setting: whether movement and splashes in water
   *  feed the interactive wake height field (water_simulation.ts). Off (the
   *  default) draws zero simulation passes; bubbles and splash particles are
   *  unaffected. Live-safe: flipping it off mid-wake puts the field to sleep. */
  setWaterRipples(enabled: boolean): void {
    this.waterRipplesEnabled = enabled;
    this.waterView.setWavesEnabled(enabled);
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
