// Per-entity character visual: a SkeletonUtils clone of a manifest asset with
// its own AnimationMixer, a clip-driven state machine fed by renderer-derived
// state, a baked static idle-pose far LOD, and a shadow-only proxy for the
// mid-distance band. All geometry/materials are shared caches; dispose()
// releases mixer bindings, this clone's Skeletons, and the visual's claims
// on the shared tinted-material cache (which disposes a clone only once no
// visual mounts it).
import * as THREE from 'three';
import {
  mainhandShowsWeaponSkin,
  offhandMirrorsWeaponSkin,
} from '../../sim/content/weapon_skin_rules';
import { WEAPON_SKINS } from '../../sim/content/weapon_skins';
import type { EquipSlot } from '../../sim/types';
import type { OverheadEmoteId } from '../../world_api';
import { GPU_WORK_PRIORITY } from '../background_gpu_queue';
import { recordBuildSpan, timeBuildSpan } from '../build_spans';
import type { EyeWardMarkerPlan } from '../eye_ward_marker_core';
import { GFX } from '../gfx';
import { cloneMaterialWithHooks } from '../material_clone_hooks';
import type { MeleeImpactProfile } from '../melee_impact_core';
import type { MountRideSpec } from '../mount_visuals';
import {
  stoneboundShardMaterialOptions,
  stoneboundShellMaterialOptions,
  weaponImbueAuraMaterialOptions,
} from '../vfx_basic_materials';
import {
  createWeaponVfx,
  DEFAULT_TUNING,
  WEAPON_VFX,
  type WeaponVfxHandle,
  type WeaponVfxTuning,
} from '../weapon_vfx';
import { scaleWeaponVfxTuning } from '../weapon_vfx_shed_core';
import { weaponVfxTuningFor } from '../weapon_vfx_tuning';
import {
  type AnimActionWeight,
  type AnimState,
  advanceSwimBlend,
  advanceTreadBlend,
  type BaseState,
  castHoldStep,
  combatIdleClamps,
  desiredBaseState,
  drivesPose,
  gaitWindDownTimeScale,
  isStrafeState,
  locomotionTimeScale,
  pickProxyHeight,
  SUBMERGED_HEAD_FRACTION,
  scanAnimRepair,
  shouldInterruptLanding,
  shouldPlayLanding,
  shouldPlayOutCastExit,
} from './anim_state';
import {
  type AssembleOptions,
  applyMaterials,
  applyModularSliderMorphs,
  assembleModel,
  atlasTextureByUrl,
  attachDeferredFaceDecals,
  ensureSkinTexture,
  farSourceMaterials,
  heldPropHolders,
  modularFarBake,
  peekModularFarBake,
  prepareVisual,
  releaseModularVariant,
  releaseTintedMaterials,
  setHeldOffhand,
  setHeldWeapon,
  setWeaponsStowed,
  skinEmissiveTexture,
  skinTexture,
  type TintedMaterialClaims,
  takeFarBakeBudget,
  tintedFarMaterials,
  wocBuildLod,
} from './assets';
import {
  contactDelaySec,
  dualWieldHalfNames,
  newDualSwingState,
  pickDualSwing,
} from './attack_swing_core';
import { auraIdleClip } from './aura_idle_core';
import { ChargeGlow } from './charge_glow';
import { sharedClipSplit } from './clip_split';
import { twinClipOf } from './clip_twin';
import { extendBrace, isBraced } from './combat_brace_core';
import { deathGroundingOffset } from './death_grounding_core';
import {
  createGhostEffectMaterial,
  createMoonkinEffectMaterial,
  createShadowformEffectMaterial,
  type GhostStyle,
  ghostEffectOpacity,
} from './effect_materials';
import { EffigyRig } from './effigy_rig';
import { EyeGlow, selfLitMeshes } from './eye_glow';
import { EyeWardMarker } from './eye_ward_marker';
import {
  bodyDrawn,
  farMeshShown,
  shadowProxyShown,
  shadowStandInShown,
} from './far_lod_reveal_core';
import { FormAdornments } from './form_adornments';
import { HairSwayDriver } from './hair_sway';
import { buildHalo } from './halo';
import { HarvestRecoil } from './harvest_recoil';
import { disposeHeldPropIdles, updateHeldPropIdles } from './held_prop_idle';
import { noteLookAttached } from './look_pieces';
import type { EmoteClipSpec, VisualDef, WeaponLayoutOverride } from './manifest';
import { createMetamorphWingPose, metamorphWingPoseInto } from './metamorph_wing_motion_core';
import { clampWocBodyScale, type ModularAppearance, type ModularLook } from './modular';
import {
  PALADIN_BASTION_SWEEP_CLIP,
  PALADIN_BASTION_SWEEP_DURATION,
} from './paladin_bastion_sweep_clip';
import { PaladinBastionSweepFx } from './paladin_bastion_sweep_fx';
import { PaladinTemplarsVerdictFx } from './paladin_templars_verdict_fx';
import { SanguineWeaponSheath } from './sanguine_weapon_sheath';
import { attachSharedDepthMaterials } from './shadow_depth_materials';
import { characterMeshCastsShadow } from './shadow_policy';
import { shardpikeProp } from './shardpike_prop';
import { SkeletonUpdateCache, type SkeletonUpdateStats } from './skeleton_update_cache';
import {
  type OneShotKind,
  pickSkinAttackClips,
  rangedSkinAiming,
  SKIN_ATTACK_CLIP_NAMES,
  weaponSkinCastClip,
  weaponSkinOrientPin,
} from './skin_attack';
import { configureTightBoneTextures } from './skin_gpu_layout';
import { applySkinnedCullBounds } from './skinned_cull_bounds';
import { applySoulRendOverlay } from './soul_rend_overlay';
import { soulRendPrewarmTargets } from './soul_rend_prewarm_core';
import { stoneboundShellStyle } from './stonebound_shell_core';
import { createStowTransition, forceStow, requestStow, tickStow } from './stow_transition';
import { CharacterSurfaceResponse, SURFACE_RESPONSE_PROGRAM } from './surface_response';
import { warriorActionBlend } from './warrior_action_blend';
import { WarriorActionProps } from './warrior_action_props';
import { WarriorBodyEffects } from './warrior_body_effects';
import { SPIN_ATTACK_VISUAL_DURATION, weaponAttackStyle } from './weapon_attack_style_core';
import { fixedHandPropsShown, swappedClip, weaponLoadout } from './weapon_loadout_core';
import {
  disposeOwnedWeaponSkinMaterials,
  markOwnedWeaponSkinMaterials,
} from './weapon_skin_materials';
import {
  WocArmorDressing,
  type WocArmorDressingHost,
  type WocArmorFile,
} from './woc_armor_dressing';
import { releaseWocArmorOf, setWocArmorWorkQueue } from './woc_armor_packs';
import { WocAtlasSwap } from './woc_atlas_swap';
import type { WocCharacterManifest } from './woc_character_manifest';
import {
  peekWocFarBake,
  queueWocFarBake,
  retainWocFarBake,
  WOC_FAR_MOUNT_LABEL,
  WOC_FAR_MOUNT_SPAN,
  type WocFarBake,
  type WocFarBakeLease,
  type WocFarBakeRequest,
  warnWocFarStopped,
  wocFarPartsKey,
} from './woc_far_bake';
import { wocDrawnHeadMorphs } from './woc_far_head';
import { type WocFarHeadPose, wocFarHeadPose } from './woc_far_head_core';
import { WocFarTint } from './woc_far_tint';
import { wocHeadTypeForGender } from './woc_head_catalog';
import { WocHeadDressing, type WocHeadHold } from './woc_head_dressing';
import { type WocHeadAppearanceInput, wocWornHidesHair } from './woc_head_look_core';
import { applyWocPartVisibility, resolveWocPartNodes, type WocPartNodes } from './woc_parts';
import {
  WOC_DRESSABLE_EQUIP_SLOTS,
  type WocWorn,
  wocDefaultAppearance,
  wocDefaultWorn,
  wocManifestSets,
  wocUnderArmorAtlas,
  wocVisibleParts,
  wocWornFromEquipment,
  wocWornSets,
} from './woc_parts_core';
import { type WocBodyAtlas, wocBodyAtlasOf } from './woc_skin_tint_core';

export type { AnimState, BaseState } from './anim_state';

/** The renderer's live compile gate for a far LOD minted (or re-skinned) after
 *  the view's own creation gate ran: compile `target` hidden, off-thread, and
 *  call `settle` (a lazy `ready` proof) once the gate settles, or immediately
 *  and with no proof when async compile is unsupported. Mirrors `gateSwapFlagOnCompile`. */
export type FarBakeGate = (target: THREE.Object3D, settle: (ready?: () => boolean) => void) => void;

/** The work queue each renderer gate was first installed with (setFarBakeGate). */
const queueOfGate = new WeakMap<FarBakeGate, CharacterWorkQueue>();

/** The slice of the renderer's background work queue a character rides
 *  (background_gpu_queue.ts: synchronous main-thread work is a valid unit there). */
export interface CharacterWorkQueue {
  run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T>;
}

// Current canvas height in device pixels, pushed by the renderer on resolution
// changes so newly created weapon-skin VFX rigs size their point sprites right.
let weaponVfxViewportHeight = 1080;
const STONEBOUND_SHARD_GEOMETRY = new THREE.OctahedronGeometry(1, 0);
type WeaponAuraMode = 'none' | 'sanguine' | 'stonebound';

export function setWeaponVfxViewportHeight(heightPx: number): void {
  weaponVfxViewportHeight = Math.max(1, Math.round(heightPx));
}

// The VFX rig sizes point sprites for the inspector's 35 degree vertical fov.
// Rendering under a different camera needs an equivalent-height correction or
// particles draw the wrong size (the 60 degree world camera showed them ~1.8x
// too large). Each visual carries the factor for the camera it renders under.
const VFX_RIG_FOV_DEG = 35;

export function weaponVfxSpriteScaleForFov(fovDeg: number): number {
  return Math.tan((VFX_RIG_FOV_DEG * Math.PI) / 360) / Math.tan((fovDeg * Math.PI) / 360);
}

// World camera default (CAMERA_BASE_FOV = 60 in renderer.ts).
const WORLD_FOV_SPRITE_SCALE = weaponVfxSpriteScaleForFov(60);

// Scratch quaternions for the per-frame bow orientation pin (no allocation).
const BOW_Q_ROOT = new THREE.Quaternion();
const BOW_Q_B = new THREE.Quaternion();
const BOW_Q_TARGET = new THREE.Quaternion();
// Root-relative aim orientation a firing bow blends to: upright limbs (the
// variant convention authors limbs along +Y), STRING toward the archer (the
// belly faces the target), the full profile square to the aim.
const BOW_AIM_QUAT = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(0, -Math.PI / 2, 0, 'XYZ'),
);
// Root-relative carry for a bow-slot gun outside the shot: muzzle (authored
// along +Y) pitched forward to the horizon, then rolled a quarter turn about
// the barrel so the handle lies parallel to the hunter's body instead of
// jutting out sideways. The shot itself keeps the hand-tuned grip.
const GUN_CARRY_QUAT = new THREE.Quaternion()
  .setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0, 'XYZ'))
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2));
const BOW_PIN_BLEND_S = 0.12; // engage/disengage fade for the orientation pins

const FADE = 0.22;
const ONESHOT_FADE = 0.1;
/** Near-instant crossfade for a `cutToIdle` visual: not zero, because three
 *  needs a frame to hand the pose over cleanly, but short enough to read as a
 *  hard stop. */
const CUT_FADE = 0.02;
/** Run <-> side run (the strafe states): a short crossfade, quicker than a base change's FADE so
 *  a Q/E press reads at once, but never the one-frame snap (owner, 2026-09-29: the instant cut
 *  looked weird, "maybe do 0.1 cross fade"). */
const STRAFE_FADE = 0.1;
/** Idle-breaker cadence (seconds): a floor plus a per-fire jitter, so several
 *  copies of the same rig standing together never fidget in lockstep.
 *
 *  Deliberately tight: the fidgets are the whole point of this rig, so they run
 *  on a 5-second beat rather than the sparse 20-to-45s one this shipped with.
 *  The variants themselves run 3.7 to 4.3 seconds, so a standing mount is
 *  almost always mid-fidget: that is the intended read here, not an accident,
 *  and raising the floor back above the longest clip is a one-line change. */
const IDLE_VARIANT_MIN = 5;
const IDLE_VARIANT_JITTER = 0;
/** Exported for tests/idle_variants.test.ts, which pins the cadence against the
 *  actual clip lengths in the shipped GLBs. */
export const idleVariantCadenceForTest = {
  min: IDLE_VARIANT_MIN,
  jitter: IDLE_VARIANT_JITTER,
} as const;
// Z-key sheathe gesture: the 1H chop's WINDUP raises the hand over the shoulder
// toward the back (grabbing/planting the hilt). The held-prop swap lands at the
// windup peak, where update() also cuts the clip so the downswing never plays.
const STOW_GESTURE_TIMESCALE = 1.15;
// Frozen-pose sweep of the chop: the hand peaks beside the shoulder (right
// where the on-back hilt sits) at ~28% in; by 40% the downswing has started.
const STOW_SWAP_FRACTION = 0.28;
// Additive post-mixer raise on the right upper arm so the hand climbs clearly
// above the shoulder toward the hilt (the clip alone tops out at shoulder
// height). Negative X lifts on this rig; past ~-1.0 the oversized helmet hides
// the whole arm from the chase camera, so -0.85 is the readable peak.
const STOW_ARM_BONE = 'upperarmr';
const STOW_ARM_LIFT_RAD = -0.85;
// Ledge climb, posed by hand: the KayKit rigs ship no climb clip, so the pull
// up is built from the airborne base pose plus additive bone work, sequenced
// like a real mantle: hands FLY to the lip first, the torso curls in behind
// them and the knees tuck as the body rises, then everything releases as the
// body vaults over and plants. The leading limbs move a beat before the
// trailing ones; that asymmetry is what sells it as effort rather than a
// lift. Negative X raises an arm on this rig (see the stow lift above); the
// joints are the shared rig names with GLTF's dot-stripping applied.
const CLIMB_ARM_BONES = ['upperarml', 'upperarmr'] as const;
const CLIMB_FOREARM_BONES = ['lowerarml', 'lowerarmr'] as const;
/** Deep overhead raise: the hands must read ABOVE the head, grasping the lip,
 *  not out at the sides. Negative X swings an arm forward and up on this rig;
 *  -2.5 carries it past vertical so the hands hang over the ledge line. */
const CLIMB_ARM_RAISE_RAD = -2.5;
/** Roll the raised arms toward the body's midline so the hands finish at
 *  shoulder width above the head instead of flaring into a T. Mirrored per
 *  side (left +, right -). */
const CLIMB_ARM_ROLL_RAD = 0.45;
/** Elbow hook while the hands own the lip: a straight arm reads as a plank. */
const CLIMB_ELBOW_RAD = 0.55;
/** Chin up at the lip while the hands fly to it: the eyes lead the grab. */
const CLIMB_HEAD_TILT_RAD = -0.35;
/** The off hand plants this far (in phase) behind the lead hand. */
const CLIMB_ARM_LEAD = 0.05;
const CLIMB_LEG_BONES = ['upperlegl', 'upperlegr'] as const;
const CLIMB_SHIN_BONES = ['lowerlegl', 'lowerlegr'] as const;
const CLIMB_THIGH_TUCK_RAD = -0.9;
const CLIMB_SHIN_FOLD_RAD = 1.05;
/** The trailing leg tucks this far (in phase) behind, at reduced depth. */
const CLIMB_LEG_TRAIL = 0.08;
const CLIMB_TORSO_BONE = 'chest';
const CLIMB_TORSO_CURL_RAD = 0.45;
const CLIMB_BODY_PITCH = 0.3;
const CLIMB_BODY_DUCK = -0.18;
/** Blend in/out rate for the whole climb pose (1/s). */
const CLIMB_BLEND_RATE = 14;

/** Ride (straddle) pose bones. The foot chain is only needed here, so it is not
 *  folded into the climb's arrays. Names are the three.js-sanitized KayKit
 *  Rig_Medium ones (the GLB spells them `upperleg.l`; the loader drops the dot). */
const RIDE_FOOT_BONES = ['footl', 'footr'] as const;
const RIDE_HIP_BONE = 'hips';
/** Blend in/out rate for the straddle (1/s): a mount summon should settle the
 *  rider's legs over the same beat the mount fades in on, not snap them. */
const RIDE_BLEND_RATE = 8;
const AXIS_X = /* @__PURE__ */ new THREE.Vector3(1, 0, 0);
const AXIS_Z = /* @__PURE__ */ new THREE.Vector3(0, 0, 1);
/** The leg bones' rest orientation: a half turn about X, which is what points
 *  their local +Y (down the limb) at the model's DOWN. Every ride-pose thigh
 *  target is built off it. */
const RIDE_LEG_REST = /* @__PURE__ */ new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI,
);
// Scratch, so the per-frame pose allocates nothing.
const rideQuat = /* @__PURE__ */ new THREE.Quaternion();
const rideSwing = /* @__PURE__ */ new THREE.Quaternion();
/** Fallback local clock for the pose envelope, used only when no sim phase
 *  arrives (an older server); normally the pose tracks the climb's real,
 *  height-scaled progress via setClimbing's phase. */
const CLIMB_POSE_DURATION = 0.5;
/** Chase rate toward the sim-reported phase (1/s): fast enough to track a
 *  20 Hz feed within a frame or three, slow enough to never visibly snap. */
const CLIMB_TRACK_RATE = 20;
/** Smoothstep of `t` across [a, b]: the one easing all climb envelopes use. */
const env01 = (t: number, a: number, b: number): number => {
  const c = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return c * c * (3 - 2 * c);
};
const HIT_REACT_COOLDOWN = 0.9;

// Contact-frame hitstop (gallery melee "bite": timeScale ~0.07 for ~0.11s at
// contact). Only THIS rig's animation clock slows, the world, the sim, and
// every other character keep running, so it is multiplayer-safe by
// construction. After a hold ends, a short refractory swallows re-triggers so
// a fast swing chain cannot smear the rig into slow motion.
const HOLD_REFRACTORY_S = 0.25;
// Windup lean spring (gallery updateBodyFeel: -0.085 rad ease during windup,
// released through a small forward recoil snap). Fed per frame; auto-releases
// when feeding stops.
const LEAN_FEED_S = 0.12;
const LEAN_RECOIL_S = 0.14;
const LEAN_MAX_RAD = 0.12;

// Lie_Idle already lays the rig flat, a touch of extra pitch reads as a
// The climb's baked clips (player rigs all ship both): Spellcast_Raise's
// first stretch throws the arms overhead (the reach to the lip), and
// Sit_Floor_Down run BACKWARD is a floor-crouch rising to a stand (the
// top-out over the lip). Scrub fractions are hand-tuned against the clips.
const CLIMB_REACH_CLIP = 'Spellcast_Raise';
const CLIMB_MANTLE_CLIP = 'Sit_Floor_Down';
/** Fraction of Spellcast_Raise where the arms crest overhead; held there. */
const CLIMB_REACH_CREST = 0.45;
/** Climb phase by which the reach finishes rising to the crest. */
const CLIMB_REACH_RISE_END = 0.3;
/** Climb phase band over which reach hands off to the top-out. */
const CLIMB_HANDOFF_START = 0.5;
const CLIMB_HANDOFF_END = 0.72;
/** Climb phase by which the top-out stands fully upright. */
const CLIMB_TOPOUT_END = 0.98;

// Lie_Idle already lays the rig flat — a touch of extra pitch reads as a
// surface glide; clip-less rigs (creatures) get the full procedural prone.
// The AUTHORED player strokes need neither: they were built prone, head
// leading and face down, so any pitch here would over-rotate them (see
// tmp/swim/build_swim.py). They also carry the body at hip height already,
// so they need only a nudge of lift to break the surface rather than the
// near-a-yard hoist Lie_Idle's ground-level pose does.
const SWIM_PITCH_CLIP = 0.35;
const SWIM_PITCH_PROCEDURAL = 1.18;
const SWIM_PITCH_AUTHORED = 0;
const SWIM_RISE = 0.95; // body must break the surface or only the hat floats
const SWIM_RISE_AUTHORED = 0.3;
// Treading is the one UPRIGHT water pose, so it needs the opposite of a lift:
// the strokes float a body lying at hip height, while a standing one has to
// SINK or it wades on the surface with its knees dry. Sized so the waterline
// lands at the chest, and no deeper — the swim latch allows a bed only 0.8
// under the line, and a diver's tucked feet have to clear it.
const SWIM_RISE_TREAD = -0.34;
// Nosing over reads as intent on a prone stroke and as a faceplant on an
// upright tread, so the pitch is largely held back while treading.
const TREAD_PITCH_SCALE = 0.35;
// Water transitions cross whole postures — prone to upright, dry stride to
// wade — so they get a longer crossfade than the land states, where a fast cut
// reads as responsive.
const WATER_FADE = 0.34;
const WATER_STATES = new Set<BaseState>(['swim', 'swimSurface', 'swimIdle', 'wade']);

/** Crossfade for a base-state edge: longer whenever water is on either side. */
function waterFade(from: BaseState, to: BaseState): number {
  return WATER_STATES.has(from) || WATER_STATES.has(to) ? WATER_FADE : FADE;
}
const MIXER_DT_CAP = 0.3; // throttled entities never integrate a huge step
const SPIN_RATE = 14;
const SPIN_ATTACK_TIMESCALE = 1.6;
const SPIN_ONCE_RATE = 18;
// Metamorphosis: a monstrous demon shell, deep fel-purple body with a hot glow
// (the fire aura around it comes from vfx.formAura, not the material). Kept
// dark enough that the body still shades and the flames read against it.
const FEROCITY_TINTS = [
  new THREE.Color(0xd98a62),
  new THREE.Color(0xd84a35),
  new THREE.Color(0xd62418),
] as const;
const FEROCITY_TINT_STRENGTH = [0.18, 0.32, 0.48] as const;
const FEROCITY_EMISSIVE = [0x2a0802, 0x4a0803, 0x6a0803] as const;
const FEROCITY_EMISSIVE_STRENGTH = [0.08, 0.15, 0.23] as const;
const ASCENSION_TINT = new THREE.Color(0xffe49a);

export type { GhostStyle } from './effect_materials';

/** The live mixer facts the pure watchdog decides on (see anim_state.ts). */
function readActionWeight(a: THREE.AnimationAction, into?: AnimActionWeight): AnimActionWeight {
  const scheduled = a.isScheduled();
  const effectiveWeight = a.getEffectiveWeight();
  if (!into) return { scheduled, effectiveWeight };
  into.scheduled = scheduled;
  into.effectiveWeight = effectiveWeight;
  return into;
}

// shared invisible click capsule, raycaster ignores `visible`, render doesn't
let clickGeoSingleton: THREE.CylinderGeometry | null = null;
function clickGeo(): THREE.CylinderGeometry {
  if (!clickGeoSingleton) {
    clickGeoSingleton = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
    clickGeoSingleton.translate(0, 0.5, 0);
  }
  return clickGeoSingleton;
}
let clickMatSingleton: THREE.Material | null = null;
function clickMat(): THREE.Material {
  clickMatSingleton ??= new THREE.MeshBasicMaterial();
  return clickMatSingleton;
}

// shadow-only material: writes neither color nor depth so the main pass
// rasterizes nothing while the shadow pass still renders the proxy
let shadowOnlySingleton: THREE.Material | null = null;
function shadowOnlyMat(): THREE.Material {
  shadowOnlySingleton ??= new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
  });
  return shadowOnlySingleton;
}

// Tip-scoped weapon aura: how far up the blade the wash starts (fraction of
// the blade's long axis measured from the grip) and how quickly it ramps in.
const WEAPON_AURA_TIP_START = 0.55;
const WEAPON_AURA_TIP_RAMP = 0.35;

/** A private clone of the weapon mesh geometry carrying an RGBA vertex-color
 *  ramp: opaque white at the blade tip fading to alpha 0 toward the grip, so
 *  an additive overlay in this geometry reads as a tipped weapon (Adder's
 *  Bite) instead of the full soak. The blade axis is the geometry's longest
 *  bbox extent; the tip is whichever end of it sits farther from the grip
 *  (the holder origin, transformed into this mesh's local space so quantized
 *  or recentered geometry cannot flip the ramp). Returns null when the
 *  geometry cannot be ramped (no position attribute); callers fall back to
 *  the full-blade overlay. The clone is aura-owned: dispose it with the aura. */
function tipFadedWeaponGeometry(
  mesh: THREE.Mesh,
  holder: THREE.Object3D,
): THREE.BufferGeometry | null {
  const srcPos = mesh.geometry.getAttribute('position');
  if (!srcPos) return null;
  // grip point (the holder origin; weapon models author the grip at origin)
  // in this mesh's local space: compose the mesh -> holder chain from TRS
  // (world matrices can be stale during a rebuild), then invert.
  const toHolder = new THREE.Matrix4().compose(mesh.position, mesh.quaternion, mesh.scale);
  const step = new THREE.Matrix4();
  let node = mesh.parent;
  while (node && node !== holder) {
    step.compose(node.position, node.quaternion, node.scale);
    toHolder.premultiply(step);
    node = node.parent;
  }
  const gripLocal = new THREE.Vector3(0, 0, 0);
  if (node === holder) gripLocal.applyMatrix4(toHolder.invert());
  const box = new THREE.Box3().setFromBufferAttribute(srcPos as THREE.BufferAttribute);
  const size = new THREE.Vector3();
  box.getSize(size);
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  const min = box.min[axis];
  const max = box.max[axis];
  const span = max - min;
  if (!(span > 1e-6)) return null;
  // orient the ramp: 1 at the end farther from the grip (the tip)
  const tipAtMax = max - gripLocal[axis] >= gripLocal[axis] - min;
  const geometry = mesh.geometry.clone();
  const pos = geometry.getAttribute('position');
  const rgba = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const v = axis === 'x' ? pos.getX(i) : axis === 'y' ? pos.getY(i) : pos.getZ(i);
    let t = (v - min) / span;
    if (!tipAtMax) t = 1 - t;
    const alpha = Math.min(1, Math.max(0, (t - WEAPON_AURA_TIP_START) / WEAPON_AURA_TIP_RAMP));
    rgba.set([1, 1, 1, alpha], i * 4);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  return geometry;
}

export class CharacterVisual {
  /** add to the entity group; pivot at feet, faces +Z; renderer applies e.scale */
  readonly root = new THREE.Group();
  /** The def's world-unit height (VisualDef.height): the pick capsule's, and
   *  the frame every poseWrap child is placed in (the wrap carries the scale). */
  private readonly baseHeight: number;
  /** A WOC player's chosen body size (setBodyScale), 1 on every other rig. */
  private bodyScale = 1;
  /** The DRAWN body's world-unit height before e.scale (the renderer applies
   *  that on the group): the def height times the body size, so the nameplate
   *  (height * e.scale + 0.5), the VFX anchors, the cull sphere and the blob
   *  shadow all read the body actually drawn. The renderer re-reads it every
   *  frame, so a live size change needs no view rebuild. */
  get height(): number {
    return this.baseHeight * this.bodyScale;
  }
  /** invisible capsule for picking (userData.entityId set by the renderer) */
  readonly clickProxy: THREE.Mesh;
  // A WOC modular body's part nodes, resolved once on the first dressing, and
  // the last-applied worn set (one id per dressable equip slot plus the helm
  // bit) so the per-frame diff is a slot compare and never an allocation.
  private wocParts: WocPartNodes | null = null;
  private readonly wocWornItems: (string | null)[] = [];
  private wocHelmHidden = false;
  private wocDressed = false;
  private wocDefaultDressed = false;
  private wocFarParts: ReadonlySet<string> | null = null;
  /** The armor files the far parts are drawn from (their tier is the bake's material). */
  private wocFarFiles: readonly WocArmorFile[] = [];
  private wocFarLease: WocFarBakeLease | null = null;
  /** The head's face the far parts freeze (woc_far_head_core.ts); null while the
   *  modular head is not drawn. */
  private wocFarHead: WocFarHeadPose | null = null;
  /** The far key of the three inputs above (woc_far_bake.ts wocFarPartsKey), built once
   *  per dressing: every later ask (a pending bake's peek, the bake itself) reuses it. */
  private wocFarKey: string | null = null;
  /** This body's ask for a queued far bake (woc_far_bake.ts queueWocFarBake), from its
   *  far crossing until its mount unit has run. A re-dress, a new gate and a dispose all
   *  drop it, and a dropped ask mounts nothing. The ask holds the finished bake in the
   *  cache until this body has mounted it, so every way out of it releases it. */
  private wocFarJob: WocFarBakeRequest | null = null;
  /** This body's head tints on its far set (woc_far_tint.ts); null on any other rig. */
  private wocFarTint: WocFarTint | null = null;
  /** The streamed armor files this WOC body draws (woc_armor_dressing.ts); null on any
   *  other rig. The last worn set is kept so a file landing late re-dresses the body. */
  private wocArmor: WocArmorDressing | null = null;
  private wocWorn: WocWorn | null = null;
  private wocBirthDressed = false;
  /** The modular head a WOC body wears (woc_head_dressing.ts); null on any other rig.
   *  The last appearance reference handed in short-circuits the per-frame diff. */
  private wocHead: WocHeadDressing | null = null;
  private wocHeadApp: WocHeadAppearanceInput = undefined;
  private wocHeadRedress = false;
  /** A WOC body built directly (a preview, a portrait) draws nothing until its head is
   *  live: the base file ends at the neck, so the body alone would be a headless figure
   *  (woc_head_dressing.ts `awaited`). Set at birth, cleared ONCE (syncWocHeadWait): a
   *  body that has drawn never hides for its head again (a later look change holds the
   *  previous head instead). A body in the world never waits at all: its opt-in
   *  (setWocBareHeadStandIn) clears this before its first frame. */
  private wocHeadAwaited = false;
  /** click-capsule radius (measured body extent); the pick proxy's standing scale.y
   *  is `height`, collapsed to a flat profile while dead (see enterDeath/revive). */
  private readonly clickRadius: number;

  private def: VisualDef;
  private key: string;
  private entityColor: number;
  private skinIndex: number;
  private weaponItemId: string | null;
  private offhandItemId: string | null;
  /** The weapon slot follows real equipment (AssembleOptions.bareWhenUnarmed): with no
   *  weapon equipped the hand is empty, at birth and on every re-attach after it. */
  private readonly bareWhenUnarmed: boolean;
  /** Composition inputs for a `modular` def (null for a fixed class rig).
   *  Changing a look means changing GEOMETRY, so callers rebuild the visual
   *  rather than mutating it; this is kept so they can tell whether they must. */
  private look: ModularLook | null = null;

  /** The composition this visual was built from (null for a fixed class rig). */
  /** Dress a WOC modular body from an entity's worn equipment (the helmet,
   *  shoulder, gloves, chest, waist and feet slots) and its helm-visibility
   *  bit: a visibility flip per named part, nothing rebuilt (woc_parts_core.ts
   *  owns the rule, including the per-slot fallback for an unmapped item). A
   *  no-op on any other rig and on a repeat of the last-applied set, so the
   *  renderer calls it every frame. Returns whether anything changed. */
  setWocEquipment(
    equipped: Readonly<Partial<Record<EquipSlot, string>>> | null | undefined,
    helmHidden: boolean,
  ): boolean {
    const manifest = this.def.wocCharacter;
    if (!manifest || this.disposed) return false;
    let changed = !this.wocDressed || this.wocDefaultDressed || helmHidden !== this.wocHelmHidden;
    for (let i = 0; i < WOC_DRESSABLE_EQUIP_SLOTS.length; i++) {
      const id = equipped?.[WOC_DRESSABLE_EQUIP_SLOTS[i]] ?? null;
      if (this.wocWornItems[i] !== id) {
        changed = true;
        this.wocWornItems[i] = id;
      }
    }
    if (!changed) {
      this.wocAtlas.retryFailed();
      return false;
    }
    this.wocHelmHidden = helmHidden;
    this.wocDressed = true;
    this.wocDefaultDressed = false;
    this.applyWocWorn(wocWornFromEquipment(manifest, equipped, helmHidden));
    return true;
  }

  /** Roster previews have no equipped-item snapshot; keep the manifest kit. A world
   *  NPC is dressed the same way at birth, its head slot empty (characters/index.ts). */
  setWocDefaultEquipment(helmHidden: boolean): boolean {
    const manifest = this.def.wocCharacter;
    if (!manifest || this.disposed) return false;
    if (this.wocDefaultDressed && this.wocHelmHidden === helmHidden) {
      this.wocAtlas.retryFailed();
      return false;
    }
    this.wocHelmHidden = helmHidden;
    this.wocDefaultDressed = true;
    const worn = { ...wocDefaultWorn(manifest) };
    if (helmHidden) worn.head = null;
    this.applyWocWorn(worn);
    return true;
  }

  /** Change how much armor texture detail a WOC body draws, on the LIVE body: a preview
   *  whose character was just chosen, or whose stage changed hands
   *  (preview_armor_detail_core.ts). Never a rebuild and never a blink: with the body's
   *  next dressing (setWocEquipment, setWocDefaultEquipment), else its next update, the
   *  dressing asks for the files of the new detail and keeps drawing the ones it has until
   *  each replacement's reveal settles (woc_armor_dressing.ts setDetail). The geometry
   *  level is no part of it (fixed at build). A no-op on any other rig and on a repeat. */
  setWocArmorDetail(detail: import('./woc_armor_core').WocArmorDetail): void {
    this.wocArmor?.setDetail(detail);
  }

  /** Draw a WOC head look (the stored appearance: its head picks, face controls and
   *  colours) IN PLACE: visibility flags, morph influences and tint uniforms on the
   *  live model, never a rebuild (a body-type change is another body, which the
   *  caller's key diff rebuilds). A no-op on any other rig and on a repeat of the
   *  last reference, so the renderer calls it every frame. `hold` is how a look
   *  whose head files still stream is drawn meanwhile (WocHeadHold: 'look' when the
   *  body is handed a different character). Returns whether the drawn head changed. */
  setWocHeadLook(app: WocHeadAppearanceInput, hold: WocHeadHold = 'slot'): boolean {
    if (!this.wocHead || this.disposed || app === this.wocHeadApp) return false;
    this.wocHeadApp = app;
    const changed = this.wocHead.setAppearance(app, hold);
    // a head born with every file of this look resident is live now: draw the body
    this.syncWocHeadWait();
    if (!changed) return false;
    // the far set's head colours follow as uniform writes (woc_far_tint.ts)
    this.wocFarTint?.setColors(this.wocHead.look.colors);
    const manifest = this.def.wocCharacter;
    if (manifest && this.wocParts) {
      this.dressWoc(manifest, this.wocWorn ?? wocDefaultWorn(manifest));
    }
    return true;
  }

  /** Re-read the wait for the head (syncFarVisibility ends it once the head is live, or
   *  one of its files failed to load): the body draws from then on. */
  private syncWocHeadWait(): void {
    if (this.wocHeadAwaited) this.syncFarVisibility();
  }

  /** The WOC head's live look (tests, dev overlays); null on any other rig and until the
   *  head is live (a body built directly is not drawn yet; one in the world draws without
   *  a head only while its core is missing). What it DRAWS of that look, a hairstyle or a
   *  beard still on the wire left off, is wocHeadDrawnLook. */
  get wocHeadLook(): WocHeadDressing['look'] | null {
    return this.wocHead?.isLive ? this.wocHead.look : null;
  }

  /** The head pieces' look drawn right now (the portrait's uncover), which a streaming
   *  pick can still differ from; null on any other rig and until the head is live. */
  get wocHeadDrawnLook(): WocHeadDressing['drawnLook'] {
    return this.wocHead?.drawnLook ?? null;
  }

  private applyWocWorn(worn: WocWorn): void {
    const manifest = this.def.wocCharacter;
    if (!manifest) return;
    this.wocWorn = worn;
    // The files this worn set draws from: the class's own set (always: it is the
    // kit a bare slot falls back to) plus any set a display row points one of
    // the worn items at (woc_item_display.ts). Resident files attach (at once on
    // a body with no work queue behind it, else as a unit of it), the rest
    // stream and attach once they land.
    const sets = wocManifestSets(manifest);
    for (const set of wocWornSets(manifest, worn)) if (!sets.includes(set)) sets.push(set);
    if (this.wocArmor?.want(sets)) this.wocParts = null;
    this.dressWoc(manifest, worn);
  }

  /** Show the worn parts that can draw now: a part whose set is still streaming
   *  resolves to no node yet, and the body's own suit shows in its place. */
  private dressWoc(manifest: WocCharacterManifest, worn: WocWorn): void {
    if (!this.wocParts) this.wocParts = resolveWocPartNodes(this.model, manifest);
    const wanted = wocVisibleParts(manifest, wocDefaultAppearance(manifest), worn);
    applyWocPartVisibility(this.wocParts, manifest, wanted);
    // The modular head after the part pass: the worn helm hides its hair.
    if (this.wocHead && !this.wocHead.setHelm(wocWornHidesHair(manifest, worn))) {
      this.wocHead.apply();
    }
    // The far LOD bakes what is drawn: never a part still streaming, and the
    // file (tier) each set is drawn from, whose materials the bake shares.
    const parts = new Set<string>();
    for (const name of wanted) if (this.wocParts.has(name)) parts.add(name);
    for (const name of this.wocHead?.drawnNames ?? []) parts.add(name);
    const files = this.wocArmor?.attachedFiles ?? [];
    // ...and the face the drawn head shows, frozen on the far grid (woc_far_head.ts)
    const head = this.wocHead?.isLive
      ? wocFarHeadPose(wocDrawnHeadMorphs(this.model, this.wocHead.look.morphs))
      : null;
    // the key is built here, once per dressing, and kept: nothing asks for it per frame
    const farKey = wocFarPartsKey(parts, files, head);
    if (farKey !== this.wocFarKey) {
      this.wocFarParts = parts;
      this.wocFarFiles = files;
      this.wocFarHead = head;
      this.wocFarKey = farKey;
      this.invalidateWocFar();
    }
    this.setWocBodyAtlas(wocUnderArmorAtlas(manifest, worn));
    // the merged armor follows the parts this pass just showed and hid
    this.wocArmor?.redressed();
  }

  /** Re-dress after the attached files changed under the last worn set (or the
   *  default kit when the body was never dressed). */
  private redressWoc(): void {
    const manifest = this.def.wocCharacter;
    if (!manifest) return;
    this.wocParts = null;
    this.dressWoc(manifest, this.wocWorn ?? wocDefaultWorn(manifest));
  }

  /** The dressing's view of this visual (woc_armor_dressing.ts). */
  private wocArmorHost(): WocArmorDressingHost {
    // No queue behind this body (the constructor's own dressing, a preview, a portrait)
    // is no `schedule` at all: the dressing then attaches a file on the spot, where with
    // one it waits for the file's prepare unit and attaches as a unit of its own (the
    // same scheduleWocWork, and so the same priority, as the merged stand-ins' mounts).
    const queued = (): WocArmorDressingHost['schedule'] =>
      this.queuedWorkQueue() ? this.scheduleWocWork : undefined;
    return {
      model: this.model,
      adopt: (container) => this.adoptWocArmor(container),
      forget: (container) => this.forgetWocArmor(container),
      reveal: (container, live) => this.revealOnCompile(container, 'armor set', live),
      rigDrawn: this.wocRigDrawn,
      get schedule() {
        return queued();
      },
    };
  }

  /** Whether the articulated rig is what draws right now, to stay, behind a gate: a merged
   *  stand-in (the head, the armor) is not built for a body never handed a gate, one shown
   *  by its far mesh, one not shown at all, or one drawn by its rig only until its far mesh
   *  arrives (farLodArriving). */
  private readonly wocRigDrawn = (): boolean =>
    this.farBakeGate !== null &&
    this.root.visible &&
    this.modelWrap.visible &&
    !this.farLodArriving;

  /** A far body whose far mesh is on its way: asked for (in line behind other looks, or
   *  baking), mounting or linking. Its rig is a stopgap until then, and a crowd arriving in
   *  the far band would pay a fold per body for a stand-in its far mesh replaces. A body
   *  whose far bake came to nothing is not arriving: it stays on its rig, and is merged
   *  like any. */
  private get farLodArriving(): boolean {
    return (
      this.far &&
      (this.wocFarJob !== null ||
        (this.farBakePending && !this.farBakeTried) ||
        (this.farMesh !== null && this.farCompilePending))
    );
  }

  /**
   * Run a merged stand-in's mount as one unit of the renderer's work queue. The queue
   * is read when the work is ASKED for, never when the host object is built: it rides in
   * with the compile gate (setFarBakeGate), after the constructor. A stand-in is an
   * optimization of a body already drawn whole, so it sits below the live views, in the
   * class that still gets a slot a frame under load (when fewer draws are worth the
   * most). With no renderer behind this body the work runs on the spot. A unit the
   * queue refuses (shut down by a graphics rebuild) is dropped: the views go with it.
   */
  private readonly scheduleWocWork = (work: () => void, label: string): void => {
    const queue = this.queuedWorkQueue();
    if (!queue) {
      work();
      return;
    }
    void queue.run(work, GPU_WORK_PRIORITY.VISIBLE_PREWARM, label).catch(() => undefined);
  };

  /** The queue this body's own units ride: the one it was handed, else the one its gate
   *  came with (rendererWorkQueue). A pooled body is handed its gate alone, and one taken
   *  before the renderer had paired that gate with its queue would otherwise fold its
   *  merged head and attach its armor on the spot, inside a live frame. Pooled WOC bodies
   *  are the norm since every world NPC rides one (npc_looks.ts). */
  private queuedWorkQueue(): CharacterWorkQueue | null {
    return this.workQueue ?? this.rendererWorkQueue();
  }

  /** The head dressing's view of this visual (woc_head_dressing.ts). */
  private wocHeadHost(): import('./woc_head_dressing').WocHeadDressingHost {
    return {
      model: this.model,
      adopt: (node, retint) => this.adoptWocArmor(node, retint),
      reveal: (node, live) => this.revealOnCompile(node, 'head part', live),
      relive: () => {
        this.wocHeadRedress = true;
      },
      forget: (node) => this.forgetWocArmor(node),
      baseMaterial: (mesh) => this.originalMaterials.get(mesh) ?? mesh.material,
      rigDrawn: this.wocRigDrawn,
      schedule: this.scheduleWocWork,
    };
  }

  /** Fold this WOC body's many pieces into few draws while they stand still (the head as
   *  one mesh: woc_head_merge.ts; the worn armor as one mesh per material:
   *  woc_armor_merge.ts). The world view's opt-in (createCharacterVisual), where a
   *  crowd's draw calls are the cost; a preview or a portrait draws piece by piece. A
   *  no-op on any other rig. */
  setWocDrawMerge(on: boolean): void {
    this.wocHead?.setMerged(on);
    this.wocArmor?.setMerged(on);
  }

  /** Let this WOC body draw with the bare head standing in for a hairstyle or a beard
   *  whose file is still on the wire, or failed (woc_head_dressing.ts setBareStandIn):
   *  the body never waits on a head file, and the missing piece joins hidden until
   *  linked, like a later pick. The world view's opt-in (createCharacterVisual), where a
   *  player with no body at all is the cost; a preview, a portrait and the face builder
   *  keep drawing a head only whole. A no-op on any other rig. */
  setWocBareHeadStandIn(on: boolean): void {
    this.wocHead?.setBareStandIn(on);
    this.syncWocHeadWait();
  }

  /** Give a streamed armor set attached after construction everything the
   *  constructor's sweeps give a mesh, exactly as attachDeferredDecals does for
   *  a late face decal: the tier tint and its lease, the effect-swap snapshot
   *  and the effect the body wears now, the depth materials, the caster flags. */
  private adoptWocArmor(container: THREE.Object3D, afterMaterials?: () => void): void {
    container.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      o.userData.bodyMesh = true;
      o.userData.skinAtlasTarget = false;
    });
    applyMaterials(
      container,
      this.def,
      this.entityColor,
      this.bodyAtlasTexture(),
      skinEmissiveTexture(this.key, this.skinIndex),
      this.tintedRigClaims,
    );
    // the head's tint wrap rides between the material pass and the snapshot
    afterMaterials?.();
    container.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      this.originalMaterials.set(mesh, mesh.material);
      mesh.material = this.effectMaterial(mesh.material);
      attachSharedDepthMaterials(mesh, mesh.material);
      const castsShadow = characterMeshCastsShadow(mesh);
      mesh.castShadow = castsShadow && this.shadowOn;
      mesh.receiveShadow = false;
      if (!castsShadow) return;
      if (mesh.isSkinnedMesh) applySkinnedCullBounds(mesh, this.root, this.height);
      this.casters.push(mesh);
    });
  }

  /** Take a detached armor set's meshes out of the per-mesh bookkeeping (their
   *  material claims overstay until the next full sweep: an overstay only pins). */
  private forgetWocArmor(container: THREE.Object3D): void {
    container.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      this.originalMaterials.delete(mesh);
      const at = this.casters.indexOf(mesh);
      if (at >= 0) this.casters.splice(at, 1);
    });
  }

  /** The under-armor body atlas the worn set selects (null = the GLB's own
   *  suit): re-derives the body materials through the same atlas-keyed cache
   *  a skin swap uses, once the KTX2 is resident, so two paladins with
   *  different chests never share a material. */
  private setWocBodyAtlas(url: string | null): void {
    this.wocAtlas.request(url, () => ({
      model: this.model,
      parent: this.poseWrap,
      def: this.def,
      color: this.entityColor,
      fallback: skinTexture(this.key, this.skinIndex),
      emissive: skinEmissiveTexture(this.key, this.skinIndex),
      gate: this.farBakeGate,
      wrap: (scratch) => this.wocHead?.wrapTwins(scratch),
      commit: () => this.applySkinMaterials(this.skinIndex),
    }));
  }

  private bodyAtlasTexture(): THREE.Texture | null {
    return this.wocAtlas.currentUrl
      ? atlasTextureByUrl(this.wocAtlas.currentUrl)
      : skinTexture(this.key, this.skinIndex);
  }

  /** What the body mesh draws right now (woc_skin_tint_core.ts): a class under-armor
   *  atlas once it is swapped in and resident, else the base file's own suit. */
  private wocBodyAtlas(): WocBodyAtlas {
    const url = this.wocAtlas.currentUrl;
    return wocBodyAtlasOf(url && atlasTextureByUrl(url) ? url : null);
  }

  get modularLook(): ModularLook | null {
    return this.look;
  }

  /** Move the face/body sliders on the LIVE body: morph influences are
   *  per-instance over shared geometry, so a slider drag repaints without the
   *  dispose-and-recompose a geometry change needs (which is why the sliders
   *  are deliberately outside `modularBuildSignature`). No-op on a fixed rig. */
  applyModularSliders(app: ModularAppearance): void {
    if (!this.look) return;
    this.look = { ...this.look, app };
    applyModularSliderMorphs(this.model, app);
  }

  /** Attach the face decals a deferred build left off (AssembleOptions
   *  .deferDecals, once the look's pieces are resident): the same decals the
   *  synchronous compose adds, given everything the constructor's sweeps give
   *  a mesh (the tier tint and its lease, the effect-swap snapshot and the
   *  effect the body wears now, the caster flags), born hidden and revealed
   *  through the compile gate so their first draw never links inside a live
   *  frame (immediately without a gate: previews, tests). False when there is
   *  nothing to attach: disposed, no deferral on the model, or a fixed rig. */
  attachDeferredDecals(): boolean {
    if (this.disposed || !this.look || !this.model.userData.deferredDecals) return false;
    const decals = attachDeferredFaceDecals(this.model, this.look);
    for (const decal of decals) {
      applyMaterials(
        decal,
        this.def,
        this.entityColor,
        skinTexture(this.key, this.skinIndex),
        skinEmissiveTexture(this.key, this.skinIndex),
        this.tintedRigClaims,
      );
      this.originalMaterials.set(decal, decal.material);
      decal.material = this.effectMaterial(decal.material);
      // Against what is MOUNTED, same rule and same reason as
      // commitVisualMaterials: applyMaterials chose this caster's shared depth
      // material from the pre-effect material a line ago, and the effect swap
      // can be one that getDepthMaterial would write a non-default alphaTest
      // onto. Benign today only because no effect material sets alphaTest.
      attachSharedDepthMaterials(decal, decal.material);
      decal.castShadow = this.shadowOn;
      decal.receiveShadow = false;
      applySkinnedCullBounds(decal, this.root, this.height);
      this.casters.push(decal);
      this.revealDecalOnCompile(decal);
    }
    if (decals.length > 0) noteLookAttached();
    return true;
  }

  private revealDecalOnCompile(decal: THREE.Mesh): void {
    this.revealOnCompile(decal, 'face decal');
  }

  /** Hide a node attached after construction until its programs link through
   *  the host's compile gate (immediately without one: previews, tests).
   *  `revealed` hears whether the gate could prepare it (its `ready` proof): a
   *  node with a stand-in still drawing can stay behind it instead of linking
   *  on a live frame. It is handed the proof itself too, when the gate has one:
   *  asked again later it answers for the gate's context as it is then
   *  (woc_head_merge_proof_core.ts). */
  private revealOnCompile(
    node: THREE.Object3D,
    what: string,
    revealed?: (prepared: boolean, proof?: () => boolean) => void,
  ): void {
    const gate = this.farBakeGate;
    if (!gate) {
      revealed?.(true);
      return;
    }
    node.visible = false;
    try {
      gate(node, (ready) => {
        // A visual disposed, or the node detached, while the link was in
        // flight: the settle belongs to a node this visual no longer draws.
        if (this.disposed || node.parent === null) return;
        node.visible = true;
        revealed?.(ready?.() !== false, ready);
      });
    } catch (err) {
      // A gate that rejects outright (a lane shut down under a graphics
      // rebuild) reveals now: a node linking on its first draw beats one that
      // never shows, and the swap must not throw out of the attach.
      node.visible = true;
      revealed?.(false);
      console.warn(`[character] compile gate refused a ${what}, revealed ungated:`, err);
    }
  }

  private weaponSkinId: string | null = null;
  private weaponVfx: WeaponVfxHandle[] = [];
  // The skin's authored tuning row (the rig's 1.0 look) plus the shed
  // multiplier last applied over it, and one scratch the scaled row is written
  // into so a shed step allocates nothing.
  private weaponVfxAuthored: Partial<WeaponVfxTuning> = {};
  private weaponVfxShed = 1;
  private readonly weaponVfxTuningScratch: WeaponVfxTuning = { ...DEFAULT_TUNING };
  /** Long-hair secondary motion (modular styles with sway morphs; empty and
   *  free on every other rig). */
  private hairSway = new HairSwayDriver();
  // Skin payloads whose orientation blends to a root-relative pin (see
  // applySkinOrientation): bows aim upright DURING the shot, bow-slot guns
  // carry forward OUTSIDE it. qGrip is the authored grip-local orientation.
  private orientPins: {
    payload: THREE.Object3D;
    qGrip: THREE.Quaternion;
    blend: number;
    duringShot: boolean;
  }[] = [];
  private weaponVfxSpriteScale = WORLD_FOV_SPRITE_SCALE;
  private stow = createStowTransition();
  // The clip set for what the hands hold (ClipMap.loadoutSwaps, weapon_loadout_core.ts): every
  // clip name the rig plays resolves through this map in action().
  private loadoutSwap: Readonly<Record<string, string>> | null = null;
  // Battle-stance hold for a rig whose engagement is not on the wire (players): every attack
  // one-shot and hit reaction extends it (combat_brace_core.ts), on this visual's own clock.
  private braceUntil = Number.NEGATIVE_INFINITY;
  private clock = 0;
  // Set whenever the held-prop graph is rebuilt OUTSIDE a renderer-driven call
  // (the deferred stow swap); the renderer consumes it to re-rank view lights.
  private weaponGraphDirty = false;
  // The gesture's additive arm-raise window: t rises 0..dur (peak at dur/2,
  // the swap moment); -1 = inactive. Bone resolved lazily once (null = absent).
  private stowLift = { t: -1, dur: 0 };
  private stowArmBone: THREE.Object3D | null | undefined;
  private disposed = false;
  private ghosted = false;
  private ghostStyle: GhostStyle = 'spirit';
  private mixer: THREE.AnimationMixer;
  private skeletonUpdates: SkeletonUpdateCache;
  private actions = new Map<string, THREE.AnimationAction>();
  private model: THREE.Object3D;
  private modelWrap = new THREE.Group();
  private modelWrapGroundY = 0;
  private poseWrap = new THREE.Group();
  private farMesh: THREE.Mesh | null = null;
  private farMaterials: THREE.Material | THREE.Material[] | null = null;
  /** A composed far LOD is baked on the first crossing into the far band, not
   *  at construction: most of a crowd stands close and never needs one. This
   *  latches so a bake that yields nothing is not retried every crossing. */
  private farBakeTried = false;
  /** A far body whose bake could not be asked for yet, so update() asks again: it
   *  waits on the per-frame bake budget (takeFarBakeBudget: the band crossed but
   *  this part set's slot was taken), or it is a WOC body still waiting for its
   *  head (attemptWocFar). The visual stays articulated meanwhile (correct, just
   *  not yet cheap). */
  private farBakePending = false;
  private shadowProxy: THREE.Mesh | null = null;
  /** A WOC body's shadow in the proxy band while its own far bake cannot cast it: the
   *  key's stand-in silhouette (woc_shadow_stand_in.ts), mounted at construction so the
   *  body's own creation gate links it. Null on every other rig, and on a tier that
   *  casts no dynamic shadow. */
  private shadowStandIn: THREE.Mesh | null = null;
  /** The far mesh and its shadow proxy under one node, so the compile gate
   *  walks both (colour + depth arms) in one pass. */
  private farWrap: THREE.Group | null = null;
  /** The far LOD's freshly minted materials are still linking off-thread
   *  behind the renderer's compile gate (setFarBakeGate). While true the far
   *  mesh counts as absent: the articulated rig keeps drawing and the far
   *  mesh + shadow proxy stay hidden (far_lod_reveal_core). */
  private farCompilePending = false;
  /** The compile gate the renderer installs. ONE injected gate serves both
   *  uses: a fresh far bake (below) and the transparent effect-clone swap
   *  (stageEffectSwap). Null (previews, tests, hosts without one) keeps the
   *  immediate behaviour both paths had before the gate. */
  private farBakeGate: FarBakeGate | null = null;
  /** The renderer's background work queue (setFarBakeGate): main-thread pieces this
   *  body can put off ride it as budgeted units. Null with no renderer behind it. */
  private workQueue: CharacterWorkQueue | null = null;
  /** Effect clones (ghost / stealth / shadowform / moonkin) whose programs are
   *  known linked: either a gate settle landed on them, or they were mounted
   *  with no gate at all. A later toggle of an effect on the same source
   *  materials swaps immediately, so a ghost run or a death treatment that
   *  MUST show is never held back twice. */
  private linkedEffectMaterials = new WeakSet<THREE.Material>();
  /** The hidden scratch group staging effect clones that are still linking.
   *  Never contains the rig's own meshes: the BODY IS NEVER HIDDEN, it keeps
   *  drawing its current (already linked) materials until the swap commits. */
  private effectSwapScratch: THREE.Group | null = null;
  /** Set by the gate callback, consumed by update(): committing materials from
   *  inside the callback can land between frames, and a swap that changes what
   *  three counts for a frame belongs on the per-frame path (the
   *  numPointLights hazard the far-bake mint reveal documents). */
  private effectSwapSettled = false;
  /** The renderer's per-frame shadow-plan answer for the far shadow proxy,
   *  kept so a proxy that could not show yet (mint still linking) reveals on
   *  settle without waiting for the next plan write. */
  private proxyShadowWanted = false;
  /** Skin swap-on-settle: the far material set a skin change rebuilt is
   *  compiled hidden on `farSkinScratch` (same geometry and flags as the far
   *  mesh, so three keys the same programs) while the far mesh keeps drawing
   *  its current set, and swapped in when the gate settles. `pendingFarClaims`
   *  is that set's tinted-material lease until then. */
  private farSkinScratch: THREE.Mesh | null = null;
  private pendingFarClaims: TintedMaterialClaims | null = null;
  private casters: THREE.Mesh[] = [];
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  /** The halo's build-time shared additive material. Re-snapshots after a
   *  swap must record THIS handle, not the live material: a swap under an
   *  active overlay (ghost/shadowform/...) would otherwise capture the
   *  overlay clone as "original" and the golden ring never restores. */
  private haloBaseMaterial: THREE.Material | THREE.Material[] | null = null;
  private weaponAuraMeshes: THREE.Mesh[] = [];
  private weaponAuraColor: number | null = null;
  private weaponAuraTip = false;
  private weaponAuraSanguine = false;
  private readonly sanguineSheath = new SanguineWeaponSheath();
  private weaponAuraMode: WeaponAuraMode = 'none';
  private bastionSweepFx: PaladinBastionSweepFx | null = null;
  private bastionSweepAction: THREE.AnimationAction | null = null;
  private templarsVerdictFx: PaladinTemplarsVerdictFx | null = null;
  private templarsVerdictAction: THREE.AnimationAction | null = null;
  private ghostMaterials = new Map<THREE.Material, THREE.Material>();
  private soulRendMaterials = new Map<THREE.Material, THREE.Material>();
  private shadowformMaterials = new Map<THREE.Material, THREE.Material>();
  private moonkinMaterials = new Map<THREE.Material, THREE.Material>();
  private ferocityMaterials = [
    new Map<THREE.Material, THREE.Material>(),
    new Map<THREE.Material, THREE.Material>(),
    new Map<THREE.Material, THREE.Material>(),
  ];
  private ascensionMaterials = new Map<THREE.Material, THREE.Material>();
  // Thornhollow Fields rune buffs: a slight whole-body lean toward the rune's color
  // (weakest treatment: every form/death tint above wins). Keyed per source
  // material, one clone each (the live rune color rides the clone's userData);
  // chaining to a different rune replaces and disposes the old clone inside
  // the same applyVisualMaterials sweep that unmounts it, and dispose()
  // releases whatever remains, so rune wear can never strand materials.
  private runeTintMaterials = new Map<THREE.Material, THREE.Material>();
  // Leases over the shared tinted-material cache (assets.ts): every cache
  // clone mounted on the rig (and, separately, on the far LOD) stays claimed
  // through these sets so the cache can never dispose a mounted material. A
  // full re-apply sweep claims into a fresh lease first and releases the old
  // one after (shared keys never dip to zero claims mid-swap); dispose()
  // releases both.
  private tintedRigClaims: TintedMaterialClaims = new Set();
  private tintedFarClaims: TintedMaterialClaims = new Set();
  // Ability VFX body glow (the gallery rim read): per-visual material clones
  // carrying an emissive tint while a spec'd cast or buff aura is live. Cloned
  // once per original because base materials are SHARED per-asset caches;
  // writing emissive on those would leak the glow across every same-skin rig.
  private auraGlowMaterials = new Map<THREE.Material, THREE.Material>();
  private readonly surfaceResponse = new CharacterSurfaceResponse();
  private readonly harvestRecoil = new HarvestRecoil();
  private auraGlowColor = 0xffffff;
  private auraGlowIntensity = 0;

  private baseState: BaseState = 'idle';
  private current: THREE.AnimationAction | null = null;
  /** Fist glow for telegraphed abilities. Built on first use; null on rigs with no hands. */
  private chargeGlow: ChargeGlow | null = null;
  /** A permanently lit eye, for a VisualDef that declares one. */
  private eyeGlow: EyeGlow | null = null;
  /**
   * The Shardpike aim reticle around that same eye. Built alongside the glow because it
   * shares its measured offset: the ring and the thing it rings must never drift apart.
   */
  private eyeWardMarker: EyeWardMarker | null = null;
  /** The drill yard effigy's plank hide and lantern (VisualDef.effigy), or null. */
  private effigyRig: EffigyRig | null = null;
  /**
   * This frame's reticle plan, or null to hide it. Pushed in by the renderer rather than
   * derived here: the plan needs the LOCAL player's held item and distance, which is
   * viewer state a per-entity visual has no business knowing about.
   */
  private eyeWardPlan: EyeWardMarkerPlan | null = null;
  private currentIsOneShot = false;
  /** Seconds until the next idle-breaker; -1 means "rearm on the next idle". */
  private idleVariantIn = -1;
  /** The live one-shot is an idle-breaker, so leaving idle must cancel it. */
  private currentOneShotIsIdleVariant = false;
  /** Countdown to the next ClipMap.idleBeat fire; -1 = rearm on the idle edge. */
  private idleBeatIn = -1;
  /** True while the live one-shot is the TOUCHDOWN clip, so a body that lands
   *  already travelling can drop it instead of sliding through it. */
  private currentOneShotIsLanding = false;
  private currentOneShotIsEmote = false;
  /** the running one-shot is a cast-exit play-out (a recovery tail): it
   *  yields to any real body state the moment one appears, because holding it
   *  over a body the sim is already MOVING glides the model across the floor
   *  with no run animation (the post-Slam "teleport" to the tank) */
  private currentOneShotIsCastExit = false;
  // Whether the live one-shot is the ATTACK, as opposed to a hit react, a
  // landing, the sheathe gesture or any other one-shot. Only the aim pin needs
  // the distinction (skin_attack.ts rangedSkinAiming); a stale true is harmless
  // because every read gates on currentIsOneShot first.
  private currentOneShotIsAttack = false;
  /** The ability driving the cast base state, mirrored from AnimState so the
   *  aim pin can tell a drawn shot from a pet utility cast. */
  private castingAbility: string | null = null;
  private readonly warriorBody: WarriorBodyEffects;
  private actionProps: WarriorActionProps | null = null;
  /** which ability's cast clip the current cast-state base action was chosen
   *  for; lets chained casts refresh their per-ability override */
  private castClipAbility: string | null = null;
  /** The aura-held idle loop in force (ClipMap.idleByAura), or null for the rig's own. */
  private auraIdle: string | null = null;
  private deadLock = false;
  /** consecutive frames with no action driving the pose (the T-pose watchdog) */
  private starvedFrames = 0;
  /** Per-frame scratch view of every action's mixer weight, refilled in place:
   *  a fresh array per rig per frame would be real GC churn at raid rig counts. */
  private readonly weightScan: AnimActionWeight[] = [];
  private readonly currentWeight: AnimActionWeight = {
    scheduled: false,
    effectiveWeight: 0,
  };
  private wasDead = false;
  /** previous frame's airborne flag, for the touchdown edge (see ClipMap.land) */
  private wasAirborne = false;
  /** Was the body moving at takeoff? See the ClipMap's jumpMoving. */
  private jumpWhileMoving = false;
  private initialized = false;
  private attackIdx = 0;
  private hitCooldown = 0;
  // contact-frame hitstop state (see HOLD_REFRACTORY_S)
  private holdT = 0;
  private holdScale = 1;
  private holdCooldown = 0;
  // windup lean spring (see LEAN_FEED_S); applied on poseWrap pitch
  private lean = 0;
  private leanTarget = 0;
  private leanFeed = 0;
  private leanRecoil = 0;
  private pendingDt = 0;
  private swimBlend = 0;
  // How far into the upright TREAD posture the body is, 0..1. Separate from
  // swimBlend because it eases between two swim poses rather than in and out of
  // the water, and it is what keeps the body-height swap off the state edge.
  private treadBlend = 0;
  private swimBobTime = 0;
  // Ledge-climb pose: `blend` fades the whole gesture, `phase` runs 0..1 over
  // the pull so the arms plant early and the body clears late. `target` is
  // the sim-reported phase the local one chases (null = free-run local clock).
  private climbOn = false;
  private climbBlend = 0;
  private climbPhase = 0;
  private climbTarget: number | null = null;
  private climbArmBones: (THREE.Object3D | null)[] | undefined;
  private climbForearmBones: (THREE.Object3D | null)[] | undefined;
  private climbLegBones: (THREE.Object3D | null)[] | undefined;
  private climbShinBones: (THREE.Object3D | null)[] | undefined;
  private climbTorsoBone: THREE.Object3D | null | undefined;
  private climbHeadBone: THREE.Object3D | null | undefined;
  /** Dual-wield swing picking (attack_swing_core.ts): lone swings alternate the
   *  halves of the two-strike clip; a second swing in the same frame (matched
   *  weapons keep both hand timers on one sim tick) is both hands at once and
   *  plays the next ClipMap.dualWieldPair clip. */
  private readonly dualSwing = newDualSwingState();
  /** What the current one-shot was blending FROM and the mixer time it began:
   *  a one-shot replaced in the same frame (the second swing of a same-tick
   *  pair) blends from that pose, not from the zero-weight action it replaces
   *  (which used to hard-cut the rig into the new clip). */
  private oneShotFrom: THREE.AnimationAction | null = null;
  private oneShotAt = -1;
  /** A second action per re-triggered one-shot clip, so the same swing started
   *  again mid-play crossfades from where it is instead of snapping to frame 0. */
  private readonly twinActions = new Map<THREE.AnimationAction, THREE.AnimationAction>();
  /** The under-armor body atlas the worn set selects (WOC manifests): null is
   *  the GLB's own suit. Re-derived through applySkinMaterials on change. */
  private readonly wocAtlas = new WocAtlasSwap();
  /** Every held/sheathed prop holder mounted on the rig, for the swim hide. */
  private weaponProps: THREE.Object3D[] = [];
  /** True while the climb's baked clips own the mixer (restore on release). */
  private climbClipsActive = false;
  /** The base action a climb overlay has pushed down. An action's STORED
   *  weight is what every later fadeIn multiplies by (see beginAction), so
   *  it is restored on the action that yielded, never on whatever `current`
   *  happens to be at release: a Jump zeroed under a climb and released while
   *  the body already stood in idle stayed at zero, and the next jump off the
   *  ledge faded in an action that contributed nothing (the bind pose). */
  private climbYielded: THREE.AnimationAction | null = null;
  /** The authored climb one-shot while it runs: unlike the scrubbed KayKit
   *  overlays it is NOT paused, so beginAction's stale-action sweep must be
   *  told to leave it alone when the base state flips at the top-out. */
  private climbOverlay: THREE.AnimationAction | null = null;
  // Straddle pose, for mounts whose spec asks for one (mount_visuals.ts
  // MountRideSpec). `spec` is the target the renderer sets each frame and
  // `blend` chases 0/1 off it, so dismounting unwinds the legs instead of
  // dropping them.
  private rideSpec: MountRideSpec | null = null;
  private rideBlend = 0;
  private rideFootBones: (THREE.Object3D | null)[] | undefined;
  private rideHipBone: THREE.Object3D | null | undefined;
  private spinAngle = 0;
  private spinOnceTimer = 0;

  private shadowOn = true;
  private far = false;
  private soulRend = false;
  private shadowform = false;
  private moonkin = false;
  /** Moonwing's antlers, crescent and wings; Gloamveil's veil (form_adornments.ts).
   *  Built on the first form edge, so a rig that never shifts pays nothing. */
  private formAdornments: FormAdornments | null = null;
  private ferocityStage = 0;
  private presentationScale = 1;
  private ascended = false;
  private metamorphLeftWing: THREE.Object3D | null = null;
  private metamorphRightWing: THREE.Object3D | null = null;
  private metamorphLeftWingRest = new THREE.Euler();
  private metamorphRightWingRest = new THREE.Euler();
  private metamorphLeftHand: THREE.Object3D | null = null;
  private metamorphRightHand: THREE.Object3D | null = null;
  private metamorphWingPose = createMetamorphWingPose();
  private metamorphElapsed = 0;
  private metamorphPulse = 0;
  private metamorphWasVisible = false;
  private runeTint: number | null = null;
  // The Barrowstone Heart's statue (setPetrified): the rig turns to grey stone and holds
  // its pose; one program-preserving clone per source material.
  private abilityAttackIdx = 0;
  private petrified = false;
  private petrifiedMaterials = new Map<THREE.Material, THREE.Material>();
  private bobPhase = Math.random() * Math.PI * 2;

  constructor(
    key: string,
    entityColor: number,
    skinIndex = 0,
    weaponItemId: string | null = null,
    weaponOverride: WeaponLayoutOverride | null = null,
    offhandItemId: string | null = null,
    look: ModularLook | null = null,
    opts?: AssembleOptions,
  ) {
    const prep = prepareVisual(key);
    // A cosmetic body (the Combat Mech) keeps its model/clips but can adopt the
    // wearer class's independent mainhand and offhand layout.
    // Override only the held-item layout on a shallow def clone, leaving the rest of
    // the def (clips/height/tint) intact and never mutating the shared cached def.
    this.def = weaponOverride
      ? {
          ...prep.def,
          attach: weaponOverride.attach,
          weaponSlots: weaponOverride.weaponSlots,
          offhandSlot: weaponOverride.offhandSlot,
        }
      : prep.def;
    this.key = key;
    this.warriorBody = WarriorBodyEffects.forKey(key);
    this.entityColor = entityColor;
    this.skinIndex = skinIndex;
    this.weaponItemId = weaponItemId;
    this.offhandItemId = offhandItemId;
    this.bareWhenUnarmed = opts?.bareWhenUnarmed ?? false;
    this.baseHeight = prep.def.height;

    // model: yaw/scale/feet normalization wrapper around the skinned clone. The
    // equipped mainhand item (if the class swaps; see VisualDef.weaponSlot) picks
    // the held weapon model, so the visual is born holding the right weapon.
    // THE MECH IS A REPLACEMENT BODY, NOT A LAYER. Only a `modular` def can
    // compose a character, so a look handed to a fixed rig is dropped here
    // rather than carried: the mech cosmetic must never end up with a second
    // body inside it (Troy, 2026-08-07). assembleModel already ignores `look`
    // for a non-modular def, this makes the visual agree, so nothing
    // downstream can read a look the geometry never used.
    this.look = prep.def.modular ? look : null;
    // A WOC body's geometry level, fixed for its life: the model and both dressings draw it
    // (woc_lod_core.ts; a graphics change rebuilds every visual).
    const wocLod = wocBuildLod(opts);
    // ...and the head it is born with: the look its host named, else the type's default
    const wocHead = opts?.wocHead ?? null;
    this.model = timeBuildSpan('view-part:assemble', () =>
      assembleModel(this.def, weaponItemId, offhandItemId, look, { ...opts, wocLod, wocHead }),
    );
    // Release-on-throw for everything below: the retry gate re-runs this whole
    // constructor when a streamed asset lands late (a designed path, not an
    // edge case), and assembleModel above RETAINED the composed part set.
    // Nothing on the failed path ever reaches dispose(), so without this each
    // retry pins the variant a little harder until it can never be evicted.
    // No-op for a fixed rig.
    try {
      configureTightBoneTextures(this.model);
      if (key === 'player_warrior' || key === 'player_warrior_modular')
        this.actionProps = new WarriorActionProps(this.model);
      timeBuildSpan('view-part:materials', () =>
        applyMaterials(
          this.model,
          this.def,
          entityColor,
          skinTexture(key, skinIndex),
          skinEmissiveTexture(key, skinIndex),
          this.tintedRigClaims,
        ),
      );
      // A WOC body's modular head (the pieces of its look resident at build hung by
      // assembleModel, the rest hung the frame they land): its tint wrap goes on before
      // the material snapshot below, so the body's first draw links the tinted program.
      if (prep.def.wocCharacter) {
        this.wocHead = new WocHeadDressing(
          this.wocHeadHost(),
          wocHeadTypeForGender(prep.def.wocCharacter.fit),
          wocLod,
          wocHead,
        );
        this.wocHead.retint();
        this.wocFarTint = new WocFarTint();
        // nothing of this body draws until its head is live (syncWocHeadWait): applied
        // by syncFarVisibility once the far mesh below exists
        this.wocHeadAwaited = true;
      }
      if (key === 'form_metamorph') {
        this.metamorphLeftWing = this.model.getObjectByName('metamorph_wing_left_hinge') ?? null;
        this.metamorphRightWing = this.model.getObjectByName('metamorph_wing_right_hinge') ?? null;
        if (this.metamorphLeftWing) {
          this.metamorphLeftWingRest.copy(this.metamorphLeftWing.rotation);
        }
        if (this.metamorphRightWing) {
          this.metamorphRightWingRest.copy(this.metamorphRightWing.rotation);
        }
        this.metamorphLeftHand =
          this.model.getObjectByName('handslotl') ??
          this.model.getObjectByName('handslot.l') ??
          this.model.getObjectByName('L_Hand') ??
          null;
        this.metamorphRightHand =
          this.model.getObjectByName('handslotr') ??
          this.model.getObjectByName('handslot.r') ??
          this.model.getObjectByName('R_Hand') ??
          null;
      }
      // A permanently lit eye, parented to its own bone. Built here beside the halo for
      // the same reason: both are additive meshes hung on a bone, and both must be added
      // AFTER applyMaterials so their material is not re-mapped, and BEFORE the
      // originalMaterials snapshot so ghost and stealth swaps restore them like any mesh.
      if (this.def.eyeGlow) {
        const spec = this.def.eyeGlow;
        const bone =
          this.model?.getObjectByName(spec.bone) ??
          this.model?.getObjectByName(spec.bone.toLowerCase()) ??
          null;
        this.eyeGlow = new EyeGlow(spec, bone, selfLitMeshes(this.model, spec.selfLitMaterial));
        this.eyeWardMarker = new EyeWardMarker(spec, bone);
      }
      // The training effigy's planks and lantern: same reasons, same spot (it re-grades a
      // clone of the lantern glass, so it must run before the originalMaterials snapshot).
      if (this.def.effigy) this.effigyRig = new EffigyRig(this.model);
      // Class halo (the priest's Light): a glowing ring behind the head bone.
      // Added AFTER applyMaterials (its additive material must not be re-mapped)
      // and BEFORE the originalMaterials snapshot, so ghost/stealth material
      // swaps restore it like any other mesh.
      const haloDef = this.def.halo;
      if (haloDef !== undefined) {
        const head = this.model.getObjectByName('head');
        if (head) {
          const halo = timeBuildSpan('view-part:halo', () =>
            buildHalo(haloDef, this.def.haloUpOffset, this.def.haloRadius),
          );
          this.haloBaseMaterial = halo.material;
          head.add(halo);
        }
      }
      this.model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) this.originalMaterials.set(mesh, mesh.material);
      });
      this.modelWrap.rotation.y = prep.def.yaw ?? 0;
      this.modelWrap.name = 'character_model_wrap';
      this.modelWrap.scale.setScalar(prep.normScale);
      this.modelWrap.position.y = prep.yOffset;
      this.modelWrapGroundY = prep.yOffset;
      this.hairSway.build(this.model);
      this.modelWrap.add(this.model);
      this.poseWrap.add(this.modelWrap);
      this.root.add(this.poseWrap);

      this.model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const castsShadow = characterMeshCastsShadow(mesh);
        mesh.castShadow = castsShadow;
        mesh.receiveShadow = false;
        if (!castsShadow) return;
        // a padded sphere lets three cull this caster in each pass on its own
        // question (the camera frustum, then the shadow camera's own ortho
        // box), which a bind-pose sphere could not answer: skinned_cull_bounds
        const skinned = mesh as unknown as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) applySkinnedCullBounds(skinned, this.root, this.height);
        this.casters.push(mesh);
      });

      // far LOD + shadow proxy share the baked idle-pose geometry per key. Skin
      // aware from the start (see applySkinMaterials): a character that spawns
      // already wearing a non-default skin must not LOD out to the embedded one.
      //
      // A COMPOSED body cannot use the key's bake: prepareVisual measures
      // DEFAULT_LOOK, so a peer crossing into the far band would change gender,
      // hair and outfit. Theirs is baked from their own part set instead, and
      // lazily (buildComposedFar), because most of a crowd stands close enough
      // that the mesh would never be drawn.
      //
      // A WOC body's far LOD is baked from what it wears too (woc_far_bake.ts), and
      // its key bakes no far mesh at all (prepareVisual): nothing is built here that
      // its first dressing would only throw away. What it mounts is the key's shadow
      // stand-in, the one thing it casts in the proxy band before that bake exists.
      const idleGeo = prep.idleGeo;
      if (idleGeo && !this.look) {
        timeBuildSpan('view-part:far-bake', () =>
          this.buildFarMeshes(
            idleGeo,
            tintedFarMaterials(
              prep.def,
              entityColor,
              prep.idleSrcMats,
              prep.idleSrcIsBody,
              skinTexture(key, skinIndex),
              skinEmissiveTexture(key, skinIndex),
              this.tintedFarClaims,
            ),
            prep.shadowGeo,
          ),
        );
      } else if (prep.def.wocCharacter && prep.shadowGeo) {
        this.mountShadowStandIn(prep.shadowGeo);
      }

      if (this.wocHeadAwaited) this.syncFarVisibility();

      // capsule from measured body extents, long/wide creatures (wolves,
      // dragons) were nearly unclickable with a height-derived sliver
      const r = prep.clickRadius;
      this.clickRadius = r;
      this.clickProxy = new THREE.Mesh(clickGeo(), clickMat());
      this.clickProxy.scale.set(r * 2, this.baseHeight, r * 2);
      this.clickProxy.visible = false;
      this.root.add(this.clickProxy);

      const mixerStarted = performance.now();
      this.mixer = new THREE.AnimationMixer(this.model);
      this.skeletonUpdates = new SkeletonUpdateCache(this.model);
      const signatureClips = key.startsWith('player_')
        ? Array.from(prep.clips.keys()).filter((n) => n.startsWith('Signature_'))
        : [];
      for (const name of [...clipNamesOf(prep.def), ...SKIN_ATTACK_CLIP_NAMES, ...signatureClips]) {
        const clip = prep.clips.get(name);
        if (clip) this.actions.set(name, this.mixer.clipAction(clip));
      }
      // A two-strike dual-wield clip is minted as two one-shots, one per hand
      // (ClipMap.dualWieldSplit), so a swing plays its own strike only. The halves are
      // cut once per source clip and shared by every rig (clip_split.ts sharedClipSplit).
      const dual = prep.def.clips.attackByHand?.dualwield;
      const dualClip = dual ? prep.clips.get(dual) : undefined;
      const split = prep.def.clips.dualWieldSplit;
      if (dual && dualClip && split !== undefined && split > 0 && split < dualClip.duration) {
        const names = dualWieldHalfNames(dual);
        const [main, off] = sharedClipSplit(dualClip, split, names);
        this.actions.set(names[0], this.mixer.clipAction(main));
        this.actions.set(names[1], this.mixer.clipAction(off));
      }
      // Hold-and-release clips (ClipMap.clipSplits): the same cut, under the
      // rig's own names, for a cast that holds one half and plays the other.
      for (const cut of prep.def.clips.clipSplits ?? []) {
        const source = prep.clips.get(cut.clip);
        if (!source || !(cut.at > 0) || cut.at >= source.duration) continue;
        const [head, tail] = sharedClipSplit(source, cut.at, cut.names);
        this.actions.set(cut.names[0], this.mixer.clipAction(head));
        this.actions.set(cut.names[1], this.mixer.clipAction(tail));
      }
      this.mixer.addEventListener('finished', (ev) => this.onFinished(ev.action));
      recordBuildSpan('view-part:mixer', performance.now() - mixerStarted, mixerStarted);
      if (key === 'player_paladin' && !prep.def.wocCharacter) {
        this.bastionSweepFx = new PaladinBastionSweepFx(this.model);
      }
      this.rebuildTemplarsVerdictFx();

      this.refreshLoadout();
      const idle = this.action(this.def.clips.idle);
      if (idle) {
        idle.play();
        this.current = idle;
      }

      // A WOC body's armor streams per set: the dressing adopts the files
      // assembleModel attached and wants the default kit until the first
      // dressing names the worn one, so a body that is never dressed (a mob on
      // a WOC body, a portrait) still wears its kit: a portrait's explicit kit
      // is dressed here, any other body on its first frame (update), and again
      // the frame a streamed file lands.
      const woc = prep.def.wocCharacter;
      if (woc) {
        this.wocArmor = new WocArmorDressing(
          this.wocArmorHost(),
          woc,
          opts?.wocArmorDetail,
          wocLod,
        );
        // a speculative build (fetchStreamed: false) keeps what it was born with
        if (opts?.fetchStreamed !== false) this.wocArmor.want(wocManifestSets(woc));
        if ((opts?.wocArmor?.length ?? 0) > 0) this.redressWoc();
      }

      // The atlas for a non-default skin may not be resident at construction: every
      // iOS WebKit host defers the boot atlas sweep (assets.ts), so a visual
      // born with a cosmetic skin applies the embedded default above and heals
      // here once the atlas arrives - the same ensure + re-apply round-trip
      // setSkin() already runs for live swaps. No-op when the atlas is resident
      // (ensureSkinTexture returns null), so eager platforms are unchanged.
      const pendingAtlas = ensureSkinTexture(this.key, skinIndex);
      if (pendingAtlas) {
        void pendingAtlas
          .then(() => {
            if (!this.disposed && this.skinIndex === skinIndex) this.applySkinMaterials(skinIndex);
          })
          .catch((err) => console.error('failed to load skin atlas:', err));
      }
    } catch (err) {
      releaseModularVariant(this.model);
      this.wocHead?.dispose();
      // ...and the streamed armor files assembleModel (or the dressing) attached.
      this.wocArmor?.dispose();
      releaseWocArmorOf(this.model);
      // ...and the tinted-material leases applyMaterials and the far build
      // already took above, for the same reason and with the same shape as
      // dispose(). A constructor that throws never reaches dispose, so on the
      // streamed-asset retry path every attempt would strand its leases and pin
      // shared materials against the tinted cache's idle bound forever.
      releaseTintedMaterials(this.tintedRigClaims);
      this.tintedRigClaims.clear();
      releaseTintedMaterials(this.tintedFarClaims);
      this.tintedFarClaims.clear();
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  /** `animate=false` skips mixer integration (distance throttling); state
   *  edges still latch so the pose catches up when the entity nears. */
  update(dt: number, s: AnimState, animate: boolean, reducedMotion = false): void {
    this.clock += dt;
    if (this.currentIsOneShot && this.currentOneShotIsAttack && this.def.clips.combatIdle) {
      this.braceUntil = extendBrace(this.braceUntil, this.clock);
    }
    if (this.surfaceResponse.update(dt, this.root, this.height)) this.applyVisualMaterials();
    // A streamed armor file that landed (or a better tier of one): the dressing
    // attaches it (at once with no work queue behind this body, else as a unit
    // of it), and the re-dress that follows is here, on the per-frame path.
    if (this.wocArmor?.poll()) this.redressWoc();
    // A head piece the look wants can hang (its file landed: hang it, gated) or a reveal
    // changed the drawn head (re-dress, so the far bake keys on it): both on the per-frame
    // path.
    else if (this.wocHead?.poll() || this.wocHeadRedress) {
      this.wocHeadRedress = false;
      this.redressWoc();
    }
    // Nobody dressed this body by its first frame (a mob on a WOC body: players are dressed by
    // the renderer's worn-set diff before their update): its kit attached hidden, so show it.
    else if (this.wocArmor && this.wocWorn === null && !this.wocBirthDressed) {
      this.wocBirthDressed = true;
      this.redressWoc();
    }
    // A body in its default kit is dressed once and never diffed again (an NPC: the
    // renderer's worn-set diff, which heals a failed under-armor atlas for a player every
    // frame, is the players'): its failed atlas is asked for again from here, on the same
    // cooldown, so the wrong cloth never stays for as long as the body is in view.
    if (this.wocDefaultDressed) this.wocAtlas.retryFailed();
    // The head went live (or a file of it failed): the body draws from this frame on.
    if (this.wocHeadAwaited) this.syncWocHeadWait();
    // A transparent effect whose clones finished linking: swap them in HERE,
    // on the per-frame path, never in the gate callback (see effectSwapSettled).
    if (this.effectSwapSettled) this.commitPendingEffectSwap();
    // A far crossing that lost the bake-budget race retries here until its
    // part set gets a slot (or someone else bakes it, making the peek free), and
    // so does one whose body still waited for its head. Only a FAR body asks: the
    // shadow plan never bakes (a WOC body casts its key's stand-in meanwhile).
    if (this.farBakePending && this.far && !this.farBakeTried) {
      this.attemptComposedFar();
      this.syncFarVisibility();
    }
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.chargeGlow?.update(dt);
    this.effigyRig?.update(this.eyeWardPlan?.state === 'blinded', dt, reducedMotion);
    // A snuffed effigy lantern gutters out on the same curve as a dying eye.
    this.eyeGlow?.update(
      dt,
      reducedMotion,
      s.asleep === true,
      s.dead || this.effigyRig?.lanternOut() === true,
    );
    this.eyeWardMarker?.update(this.eyeWardPlan, dt, reducedMotion);
    // A body atlas the gate answered for is swapped in here, on the per-frame path and
    // never in the gate callback (woc_atlas_swap.ts), as an effect swap is above.
    if (this.wocAtlas.settled) this.wocAtlas.commit();
    this.updateMetamorphWings(dt, s, reducedMotion);
    this.formAdornments?.update(
      dt,
      s.moving,
      s.casting,
      reducedMotion,
      this.root.visible && !farMeshShown(this.far, this.farMesh !== null, this.farCompilePending),
    );
    if (this.holdCooldown > 0) this.holdCooldown = Math.max(0, this.holdCooldown - dt);
    // Deferred sheathe swap: lands at the gesture's windup peak (see
    // setWeaponStowed), where the clip is also cut so the chop's downswing never
    // plays. Ticks even when `animate` is false so a throttled rig still settles.
    const stowTick = tickStow(this.stow, dt);
    if (stowTick !== 'none') {
      if (stowTick === 'swap') this.applyStowSwap();
      this.endStowGesture();
    }

    // death is a level sim-side, edge-trigger the clip locally
    if (s.dead && !this.wasDead) this.enterDeath();
    else if (!s.dead && this.wasDead) this.revive();
    this.wasDead = s.dead;
    this.initialized = true;

    // Touchdown, edge-triggered locally like death/revive. Runs BEFORE the base
    // machine below so its `currentIsOneShot` latch suppresses the jump->idle
    // fade; onFinished then hands back to whatever base state we landed into.
    const landClip = this.def.clips.land;
    if (
      landClip &&
      shouldPlayLanding(this.wasAirborne, s.airborne, s.dead, !!this.action(landClip), s.swimming)
    ) {
      this.playOneShot(landClip, 1);
      this.currentOneShotIsLanding = true;
    }
    // Latch WHY we are airborne, on the takeoff edge. It cannot be read later:
    // a moving jump keeps `moving` true the whole time it is in the air, so by
    // the time the pose is chosen the takeoff is no longer observable.
    if (!this.wasAirborne && s.airborne) this.jumpWhileMoving = s.moving;
    this.wasAirborne = s.airborne;

    this.castingAbility = s.casting ? (s.castingAbility ?? null) : null;
    const rushChanged = this.warriorBody.updateRush(dt, s);
    // An aura swapping the idle loop (Balgath blinded) is a base change for a standing
    // body, so it rides the same fade arm below; a moving one picks it up when it stops.
    const auraIdle = auraIdleClip(this.def.clips.idleByAura, s.auras);
    const auraIdleChanged =
      auraIdle !== this.auraIdle && (this.baseState === 'idle' || this.baseState === 'combatIdle');
    this.auraIdle = auraIdle;
    if (!this.deadLock) {
      const desired = this.desiredBase(s);
      const baseChanged = desired !== this.baseState;
      const previousBase = this.baseState;
      if (baseChanged) this.baseState = desired;
      if (this.warriorBody.rushArrivalStarted && this.def.clips.rushArrival) {
        this.playOneShot(this.def.clips.rushArrival, 1);
      } else if (
        this.currentIsOneShot &&
        this.current?.getClip().name === this.def.clips.rushArrival &&
        !this.warriorBody.rushRecovering
      ) {
        this.currentIsOneShot = false;
        this.fadeTo(this.baseAction(), 0.06, false);
      }
      if (this.currentOneShotIsEmote && this.shouldInterruptEmote(s)) {
        this.currentIsOneShot = false;
        this.currentOneShotIsEmote = false;
        this.fadeTo(this.baseAction(), this.baseTransitionFade(desired), false);
      } else if (baseChanged && previousBase === 'sleep' && this.wakeAction()) {
        // The dawn rise. Leaving the sleep loop plays the authored wake ONCE (it begins
        // in the sleep pose, so the hand-off is a continuation rather than a cut) and
        // onFinished fades it into whatever base the machine now wants; an interrupting
        // one-shot (a hit, an attack) simply replaces it, as with any other one-shot.
        // Ahead of the idle-breaker arm below: leaving 'sleep' is a BASE change, so the
        // rig is never mid-fidget here, and the ordering keeps the rise unmissable.
        this.playOneShot(this.def.clips.wake as string, 1);
      } else if (this.currentIsOneShot && this.currentOneShotIsIdleVariant && desired !== 'idle') {
        // An idle-breaker must die the instant the rig stops standing still.
        // It is a one-shot, so without this it suppresses BOTH the fade to
        // walk/run below and the foot-speed matching further down: the mount
        // would skate across the ground, mid-fidget, for the rest of a clip
        // that can run four seconds.
        this.currentIsOneShot = false;
        this.currentOneShotIsIdleVariant = false;
        this.fadeTo(this.baseAction(), this.baseTransitionFade(desired), false);
      } else if (
        this.currentIsOneShot &&
        this.currentOneShotIsLanding &&
        shouldInterruptLanding(s)
      ) {
        // Same trap as the idle-breaker above, one state over: a touchdown
        // one-shot is still a one-shot, so it suppresses the fade to walk/run
        // AND the foot-speed match beneath it. Landing at speed therefore held
        // the recovery pose and skated forward for the whole clip. A body that
        // travels, jumps again or enters water yields to its real pose at once.
        this.currentIsOneShot = false;
        this.currentOneShotIsLanding = false;
        this.fadeTo(this.baseAction(), this.baseTransitionFade(desired), false);
      } else if (this.currentOneShotIsCastExit && this.shouldInterruptEmote(s)) {
        // The recovery tail outlived the sim's stand-still window (the clip
        // lagged the cast, so more of it was left than the window covers) and
        // the body is really moving/casting again: hand the rig back to the
        // base state NOW instead of gliding the model under the one-shot.
        this.currentIsOneShot = false;
        this.currentOneShotIsCastExit = false;
        this.fadeTo(this.baseAction(), this.baseTransitionFade(desired), false);
      } else if ((baseChanged || rushChanged || auraIdleChanged) && !this.currentIsOneShot) {
        // a cast clip frozen at its hold point must never stay paused through
        // the exit, whichever exit path runs below
        if (previousBase === 'cast' && this.current?.paused) this.current.paused = false;
        if (previousBase !== 'cast' || !this.beginCastExitPlayOut()) {
          this.fadeTo(this.baseAction(), this.baseTransitionFade(desired, previousBase), false);
          this.fadeTo(this.baseAction(), waterFade(previousBase, desired), false);
        }
      } else if (
        desired === 'cast' &&
        !this.currentIsOneShot &&
        this.castClipAbility !== this.castingAbility
      ) {
        // one cast chained into another without leaving the cast state: the
        // base-edge fade above never fires, so refresh the per-ability clip
        this.fadeTo(this.baseAction(), 0.15, false);
      }
      if (desired === 'cast') this.castClipAbility = this.castingAbility;
      this.tickIdleBeat(dt, desired);
      this.tickIdleVariant(dt, desired);
      // foot-speed matching on locomotion cycles
      if (!this.currentIsOneShot && this.current) {
        const timeScale = locomotionTimeScale(
          this.baseState,
          s,
          this.def.walkRef,
          this.def.runRef,
          this.def.prowlRef,
          this.def.walkBackRef,
          this.def.runTimeScaleMin,
          this.def.walkTimeScaleMax,
          this.def.runTimeScaleMax,
          this.def.strafeRef ?? this.def.runRef,
        );
        if (timeScale !== null) {
          if (timeScale < 0 && this.current.time <= 1e-3)
            this.current.time = Math.max(0, this.current.getClip().duration - 1e-3);
          this.current.timeScale = timeScale;
        }
        if (this.baseState === 'spin')
          this.current.timeScale =
            (this.castingAbility && this.def.clips.castTimeScaleByAbility?.[this.castingAbility]) ||
            SPIN_ATTACK_TIMESCALE;
        if (this.baseState === 'cast') {
          // per-frame on purpose: actions are cached per clip, so a clip that
          // doubles as an attackByAbility one-shot would otherwise leak that
          // route's timescale into the cast loop
          const castScale =
            (this.castingAbility
              ? this.def.clips.castTimeScaleByAbility?.[this.castingAbility]
              : undefined) ?? 1;
          this.current.timeScale = castScale;
          const holdPoint = this.def.clips.castHoldPointSeconds;
          const genericCast = this.action(this.def.clips.cast);
          // The freeze covers ONLY the generic cast clip: a per-ability
          // override (the identity check, since actions are cached per clip)
          // keeps its authored behavior. The recovery past the hold point
          // plays on cast end via beginCastExitPlayOut.
          if (holdPoint !== undefined && genericCast && this.current === genericCast) {
            const step = castHoldStep(
              this.current.time,
              holdPoint,
              this.current.getClip().duration,
            );
            if (step.time !== undefined) this.current.time = step.time;
            this.current.paused = step.paused;
          }
        }
      }
      // Frozen idle pose (the downed forge mech): hold the idle clip on its first
      // frame while standing still, and release it the moment we leave idle. Done
      // here, not via fadeTo, because a rig whose idle and walk share one clip
      // (mech.glb's Crawl) never edges the action, so fadeTo would no-op: the same
      // action must be paused in idle and un-paused (locomotionTimeScale drives it)
      // once moving. One-shots (StandUp attack, Death) own the rig via
      // currentIsOneShot and are left untouched.
      if (this.def.idleFrozen && !this.currentIsOneShot && this.current) {
        if (this.baseState === 'idle') {
          this.current.paused = true;
          this.current.time = 0;
        } else if (this.current.paused) {
          this.current.paused = false;
        }
      }
    }
    this.advanceGaitWindDown(dt);

    // Zero-weight watchdog. The fades above only run on a base-state EDGE, so
    // any transient that leaves NO action driving the rig keeps it in bind pose
    // (the T-pose) for as long as the state is held, and strafe/cast/walk are
    // all held states. Re-drive the base pose instead of waiting for the next
    // edge. Debounced, so a legitimate crossfade can never trip it.
    if (this.current && drivesPose(readActionWeight(this.current, this.currentWeight))) {
      this.starvedFrames = 0;
    } else {
      const scan = scanAnimRepair(this.starvedFrames, this.readActionWeights(), this.deadLock);
      this.starvedFrames = scan.starvedFrames;
      if (scan.repair) this.repairPose();
    }

    if (s.spinning && !s.dead) {
      this.spinAngle =
        !this.currentIsOneShot && this.current?.getClip().name === 'Warrior_Bladestorm_Loop'
          ? 0
          : (this.spinAngle + dt * SPIN_RATE) % (Math.PI * 2);
      this.spinOnceTimer = 0;
    } else if (this.spinOnceTimer > 0 && !s.dead) {
      this.spinOnceTimer = Math.max(0, this.spinOnceTimer - dt);
      this.spinAngle =
        this.spinOnceTimer > 0 ? (this.spinAngle + dt * SPIN_ONCE_RATE) % (Math.PI * 2) : 0;
    } else {
      this.spinAngle = 0;
    }
    this.poseWrap.rotation.y = this.spinAngle;

    // swim pose: the clip's own posture + whatever pitch and lift it still needs
    const authoredSwim = !!this.action(this.def.clips.swimSurface);
    const proneAngle = authoredSwim
      ? SWIM_PITCH_AUTHORED
      : this.action(this.def.clips.swim)
        ? SWIM_PITCH_CLIP
        : SWIM_PITCH_PROCEDURAL;
    // Treading swaps the body between two postures that sit at different
    // heights, so the swap has to EASE: switching the offset on the state edge
    // would pop the model a third of a yard while the clips are still
    // crossfading into each other.
    this.treadBlend = advanceTreadBlend(
      this.treadBlend,
      this.baseState === 'swimIdle' && !!this.action(this.def.clips.swimIdle),
      dt,
    );
    const strokeRise = this.def.swimRise?.stroke ?? (authoredSwim ? SWIM_RISE_AUTHORED : SWIM_RISE);
    const treadRise = this.def.swimRise?.tread ?? SWIM_RISE_TREAD;
    const swimRise = strokeRise + (treadRise - strokeRise) * this.treadBlend;
    this.swimBlend = advanceSwimBlend(this.swimBlend, s.swimming && !s.dead, dt);
    if (this.def.hideWeaponsWhileSwimming) {
      const shown = !(s.swimming && !s.dead);
      for (const prop of this.weaponProps) if (prop.visible !== shown) prop.visible = shown;
    }
    this.swimBobTime += dt;
    // windup lean/recoil spring: while fed (setWindupLean each ceremony frame)
    // the body eases back toward the target; when feeding stops (the release)
    // it snaps forward through a small recoil, then settles to neutral
    if (reducedMotion || s.dead) {
      this.lean = this.leanFeed = this.leanRecoil = this.leanTarget = this.holdT = 0;
    } else if (this.leanFeed > 0) {
      this.leanFeed -= dt;
      this.lean += (this.leanTarget - this.lean) * (1 - Math.exp(-Math.max(0, dt) * 10));
      if (this.leanFeed <= 0) this.leanRecoil = LEAN_RECOIL_S;
    } else if (this.leanRecoil > 0) {
      this.leanRecoil -= dt;
      this.lean += (-this.leanTarget * 0.45 - this.lean) * (1 - Math.exp(-Math.max(0, dt) * 22));
    } else if (this.lean !== 0) {
      this.lean += -this.lean * (1 - Math.exp(-Math.max(0, dt) * 9));
      if (Math.abs(this.lean) < 1e-3) this.lean = 0;
    }
    // Ledge climb rides the SAME pose channels rather than fighting them:
    // these three lines are rewritten every frame, so a climb pose written
    // anywhere else would be stomped. Blend and phase are advanced here too.
    this.advanceClimbPose(dt, s.dead);
    // The pitch-into-the-wall and the duck are procedural too: an authored
    // climb clip keeps its stationary upright root, so they yield as well.
    const climb = this.def.clips.climb ? 0 : this.climbBlend;
    // Pitch into the wall through the pull, level out as the body tops the
    // lip so the plant lands upright.
    const climbLevel = 1 - env01(this.climbPhase, 0.62, 0.98);
    // ...and nose over into a dive or a climb. The renderer eased this toward
    // the body's real vertical travel (advanceSwimPitch), so it arrives already
    // smooth; it rides the swim blend like the prone angle it adds to, and so
    // unwinds with the rest of the swim pose on the way out of the water.
    // Every pose contribution on this channel is an additive offset (swim
    // prone+pitch, the windup lean/recoil spring, the ledge-climb pitch):
    // writing any one alone here would silently stomp the others.
    // The dive nose-over is largely held back while treading: the same tilt
    // that reads as aiming on a prone stroke reads as a faceplant on an
    // upright body.
    const swimPitch = s.swimPitch * (1 + (TREAD_PITCH_SCALE - 1) * this.treadBlend);
    this.poseWrap.rotation.x =
      (proneAngle + swimPitch) * this.swimBlend + this.lean + CLIMB_BODY_PITCH * climb * climbLevel;
    this.poseWrap.rotation.z = 0;
    this.poseWrap.position.y =
      this.swimBlend * (swimRise + Math.sin(this.swimBobTime * 2 + this.bobPhase) * 0.08) +
      // Compress at the start of the pull, back to neutral as the body rises.
      CLIMB_BODY_DUCK * climb * (1 - env01(this.climbPhase, 0.1, 0.55));
    this.harvestRecoil.apply(this.poseWrap, dt, reducedMotion || s.dead);
    this.warriorBody.applyContactRecoil(this.poseWrap, dt, reducedMotion || s.dead);

    // distant corpses show the static idle far mesh, tip it over
    if (this.farMesh?.visible) {
      if (s.dead) {
        this.farMesh.rotation.z = Math.PI / 2;
        this.farMesh.position.y = this.baseHeight * 0.16;
      } else {
        this.farMesh.rotation.z = 0;
        this.farMesh.position.y = 0;
      }
    }

    // hitstop: the held rig integrates a slowed dt (its clock, not the world's)
    this.pendingDt = Math.min(
      MIXER_DT_CAP,
      this.pendingDt + (this.holdT > 0 ? dt * this.holdScale : dt),
    );
    if (this.holdT > 0) {
      this.holdT -= dt;
      if (this.holdT <= 0) this.holdCooldown = HOLD_REFRACTORY_S;
    }
    if (animate) {
      const animationDt = this.pendingDt;
      // BEFORE the mixer integrates: scrub the climb's baked clips (weights
      // and frozen times are mixer INPUTS, unlike the additive lifts below).
      this.driveClimbClips();
      this.updateMixer(animationDt);
      // Held props with their own looping clip (the Ignivar legendaries'
      // engine idles) advance on the same hitstop-aware dt as the rig.
      // Gated on the far mesh ACTUALLY standing in, like updateWeaponVfx:
      // while the far bake is shown the props are hidden with the rig, so the
      // mixer would write node TRS nothing draws.
      if (!farMeshShown(this.far, this.farMesh !== null, this.farCompilePending)) {
        updateHeldPropIdles(this.model, animationDt);
      }
      this.pendingDt = 0;
      // AFTER the mixer wrote the sampled pose: the sheathe gesture's additive
      // arm raise (never applied on skipped-mixer frames, so it cannot accumulate).
      this.applyStowArmLift(dt);
      // Same rule for the climb's overhead reach.
      this.applyClimbPose();
      // ...and for the straddle a mount asks its rider to hold.
      this.applyRidePose(dt);
      const verdictTime =
        this.templarsVerdictAction &&
        this.current === this.templarsVerdictAction &&
        this.currentIsOneShot
          ? this.templarsVerdictAction.time
          : null;
      const bastionTime =
        this.bastionSweepAction && this.current === this.bastionSweepAction && this.currentIsOneShot
          ? Math.min(PALADIN_BASTION_SWEEP_DURATION, this.bastionSweepAction.time)
          : null;
      this.bastionSweepFx?.update(bastionTime, animationDt);
      this.templarsVerdictFx?.update(
        verdictTime,
        animationDt,
        this.templarsVerdictAction?.getClip().duration,
      );
      // Morph influences, not bone writes, so mixer order is irrelevant, but
      // it rides the animated branch: a throttled far rig has no business
      // integrating a hair spring.
      this.hairSway.update(dt, s);
    }
    this.syncDeathGrounding(s.dead);
  }

  private syncDeathGrounding(dead: boolean): void {
    const finalOffset = this.def.deathGroundOffset ?? 0;
    if (finalOffset <= 0) return;
    const death = this.action(this.def.clips.death);
    this.modelWrap.position.y =
      this.modelWrapGroundY -
      deathGroundingOffset(dead, death?.time ?? 0, death?.getClip().duration ?? 0, finalOffset);
  }

  private updateMetamorphWings(dt: number, s: AnimState, reducedMotion: boolean): void {
    if (!this.metamorphLeftWing || !this.metamorphRightWing) return;
    const visible = this.root.visible && !this.far;
    if (visible && !this.metamorphWasVisible) this.metamorphElapsed = 0;
    this.metamorphWasVisible = visible;
    this.metamorphPulse = Math.max(0, this.metamorphPulse - dt);
    if (!visible) return;

    this.metamorphElapsed += dt;
    const attacking = this.currentIsOneShot || this.metamorphPulse > 0;
    const pose = metamorphWingPoseInto(
      this.metamorphElapsed,
      s.moving,
      s.running,
      s.airborne,
      s.casting,
      attacking,
      this.metamorphWingPose,
      reducedMotion,
    );
    const fold = (1 - pose.unfold) * 0.82;
    const sweep = pose.sweepBack - pose.open;

    this.metamorphLeftWing.rotation.set(
      this.metamorphLeftWingRest.x + pose.breath + pose.open * 0.12,
      this.metamorphLeftWingRest.y + fold + sweep,
      this.metamorphLeftWingRest.z + (1 - pose.unfold) * 0.2 - pose.breath,
    );
    this.metamorphRightWing.rotation.set(
      this.metamorphRightWingRest.x + pose.breath + pose.open * 0.12,
      this.metamorphRightWingRest.y - fold - sweep,
      this.metamorphRightWingRest.z - (1 - pose.unfold) * 0.2 + pose.breath,
    );
  }

  /**
   * Advance the bounded clocks that must not stall while this cosmetic rig is
   * outside the camera frustum. The next visible update consumes the mixer
   * debt, while state-machine, pose, and skeleton-palette work stays asleep.
   * Actionable rigs never enter this path.
   */
  advanceOffscreen(dt: number): void {
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    if (this.holdCooldown > 0) this.holdCooldown = Math.max(0, this.holdCooldown - dt);
    const stowTick = tickStow(this.stow, dt);
    if (stowTick !== 'none') {
      if (stowTick === 'swap') this.applyStowSwap();
      this.endStowGesture();
    }
    this.pendingDt = Math.min(
      MIXER_DT_CAP,
      this.pendingDt + (this.holdT > 0 ? dt * this.holdScale : dt),
    );
    if (this.holdT > 0) {
      this.holdT -= dt;
      if (this.holdT <= 0) this.holdCooldown = HOLD_REFRACTORY_S;
    }
    // A body atlas the gate answered for is taken on this per-frame path too: left for the
    // next visible update, a crowd dressed behind the camera would all swap on the one
    // frame it turns into view.
    if (this.wocAtlas.settled) this.wocAtlas.commit();
  }

  /** Push the live base action down to `1 - k` under a climb overlay, restoring
   *  whichever action yielded before it if the base state moved meanwhile. */
  private yieldBaseToClimb(k: number, overlay: THREE.AnimationAction | null): void {
    const base = this.current && this.current !== overlay ? this.current : null;
    if (this.climbYielded && this.climbYielded !== base) this.climbYielded.setEffectiveWeight(1);
    this.climbYielded = base;
    base?.setEffectiveWeight(1 - k);
  }

  private restoreBaseFromClimb(): void {
    this.climbYielded?.setEffectiveWeight(1);
    this.climbYielded = null;
  }

  /**
   * The baked half of the climb, on the rigs that ship the clips (all player
   * archetypes): the REACH rides Spellcast_Raise scrubbed up to its
   * arms-overhead crest and held, and the TOP-OUT rides Sit_Floor_Down played
   * in reverse (floor-crouch rising to a stand), cross-faded at the pull's
   * midpoint. Both actions are paused and time-scrubbed by the climb phase,
   * so the sim's real progress (netted via `cl`) drives every frame and no
   * clock can drift. Rigs missing either clip keep the hand-authored bone
   * pose in applyClimbPose.
   */
  private driveClimbClips(): void {
    const active = this.climbBlend > 1e-3;
    const authored = this.def.clips.climb ? this.action(this.def.clips.climb) : null;
    if (authored) {
      this.driveAuthoredClimb(authored, active);
      return;
    }
    const reach = this.action(CLIMB_REACH_CLIP);
    const mantle = this.action(CLIMB_MANTLE_CLIP);
    if (!reach || !mantle) return;
    if (!active) {
      if (this.climbClipsActive) {
        this.climbClipsActive = false;
        reach.stop();
        mantle.stop();
        this.restoreBaseFromClimb();
      }
      return;
    }
    this.climbClipsActive = true;
    const t = this.climbPhase;
    const k = this.climbBlend;
    for (const a of [reach, mantle]) {
      if (!a.isRunning()) {
        a.reset();
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
        a.play();
      }
      a.paused = true;
      a.timeScale = 1;
    }
    // Hands fly overhead early and hold the crest through the hang.
    const reachDur = reach.getClip().duration;
    reach.time = Math.min(
      reachDur - 1e-3,
      reachDur * CLIMB_REACH_CREST * env01(t, 0, CLIMB_REACH_RISE_END),
    );
    // The top-out unwinds the sit: seated crouch at the lip, standing at 1.
    const mantleDur = mantle.getClip().duration;
    const rise = env01(t, CLIMB_HANDOFF_START, CLIMB_TOPOUT_END);
    mantle.time = Math.max(1e-3, Math.min(mantleDur - 1e-3, mantleDur * (1 - rise)));
    // Cross-fade reach into top-out at the pull's midpoint; the base action
    // yields while the climb owns the body and returns as the blend releases.
    const hand = env01(t, CLIMB_HANDOFF_START, CLIMB_HANDOFF_END);
    reach.setEffectiveWeight(k * (1 - hand));
    mantle.setEffectiveWeight(k * hand);
    this.yieldBaseToClimb(k, null);
  }

  /**
   * A rig with its OWN climb clip (the WOC warrior's 0.3 s Climb, an upright
   * stationary-root vault the artist authored for exactly this move): played
   * once at 1x from the grab and clamped on its ending stance when the sim's
   * height-scaled pull outlasts it (the sim owns the body's travel, so the
   * clip never needs to), then released with the climb blend back into
   * locomotion. Two frames of ramp-in: a 0.3 s clip has no room for the
   * procedural pose's 14/s fade, and the grab itself is already a cut. Every
   * procedural climb channel (the pitch, the duck, the limb work and the head
   * tilt) yields to it, so nothing stacks on top of the authored motion.
   */
  private driveAuthoredClimb(action: THREE.AnimationAction, active: boolean): void {
    if (!active) {
      if (this.climbClipsActive) {
        this.climbClipsActive = false;
        this.climbOverlay = null;
        action.stop();
        this.restoreBaseFromClimb();
      }
      return;
    }
    if (!this.climbClipsActive) {
      this.climbClipsActive = true;
      this.climbOverlay = action;
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = 1;
      action.paused = false;
      action.play();
    }
    const k = this.climbOn ? Math.min(1, this.climbBlend * 4) : this.climbBlend;
    action.setEffectiveWeight(k);
    this.yieldBaseToClimb(k, action);
  }

  /**
   * Advance the climb blend and phase. Kept next to the pose block that reads
   * them so the two can never drift out of step.
   */
  private advanceClimbPose(dt: number, dead: boolean): void {
    const want = this.climbOn && !dead ? 1 : 0;
    this.climbBlend += (want - this.climbBlend) * Math.min(1, dt * CLIMB_BLEND_RATE);
    if (this.climbBlend < 1e-3 && want === 0) {
      this.climbBlend = 0;
      this.climbPhase = 0;
      return;
    }
    if (!this.climbOn) return;
    if (this.climbTarget !== null) {
      // Track the sim's real progress: chase it fast, never run backwards, so
      // the 20 Hz feed reads as one continuous pull at any frame rate.
      const chased =
        this.climbPhase + (this.climbTarget - this.climbPhase) * Math.min(1, dt * CLIMB_TRACK_RATE);
      this.climbPhase = Math.max(this.climbPhase, Math.min(1, chased));
    } else {
      this.climbPhase = Math.min(1, this.climbPhase + dt / CLIMB_POSE_DURATION);
    }
  }

  /**
   * The hand-authored half of the climb, in three overlapping beats: hands
   * fly to the lip (lead hand a breath early), the torso curls in and the
   * knees tuck as the body rises, then every channel releases as the body
   * vaults over and plants. Additive on top of whatever the mixer produced,
   * applied ONLY on frames the mixer actually ran, exactly like the stow
   * lift, so it can never accumulate into a permanent deformation.
   */
  private applyClimbPose(): void {
    if (this.climbBlend <= 1e-3) return;
    // An authored climb clip owns every limb and the head; no additive work.
    if (this.def.clips.climb) return;
    if (this.climbClipsActive) {
      // The baked clips own the limbs; only the eyes-lead head tilt rides on
      // top (neither clip looks up at the lip).
      if (this.climbHeadBone === undefined) {
        this.climbHeadBone = this.model.getObjectByName('head') ?? null;
      }
      if (this.climbHeadBone) {
        const look = env01(this.climbPhase, 0, 0.18) * (1 - env01(this.climbPhase, 0.5, 0.85));
        this.climbHeadBone.rotation.x += CLIMB_HEAD_TILT_RAD * look * this.climbBlend;
      }
      return;
    }
    if (this.climbArmBones === undefined) {
      this.climbArmBones = CLIMB_ARM_BONES.map((n) => this.model.getObjectByName(n) ?? null);
    }
    if (this.climbLegBones === undefined) {
      this.climbLegBones = CLIMB_LEG_BONES.map((n) => this.model.getObjectByName(n) ?? null);
    }
    if (this.climbShinBones === undefined) {
      this.climbShinBones = CLIMB_SHIN_BONES.map((n) => this.model.getObjectByName(n) ?? null);
    }
    if (this.climbTorsoBone === undefined) {
      this.climbTorsoBone = this.model.getObjectByName(CLIMB_TORSO_BONE) ?? null;
    }
    if (this.climbForearmBones === undefined) {
      this.climbForearmBones = CLIMB_FOREARM_BONES.map(
        (n) => this.model.getObjectByName(n) ?? null,
      );
    }
    const t = this.climbPhase;
    const k = this.climbBlend;
    // Hands fly ABOVE THE HEAD to the lip (deep forward raise rolled toward
    // the midline so they finish at shoulder width, never a T), hook the lip
    // with a bent elbow, press through the pull, release on the vault.
    for (let i = 0; i < this.climbArmBones.length; i++) {
      const bone = this.climbArmBones[i];
      if (!bone) continue;
      const lead = i === 0 ? 0 : CLIMB_ARM_LEAD;
      const reach = env01(t - lead, 0, 0.2) * (1 - env01(t, 0.58, 0.95));
      bone.rotation.x += CLIMB_ARM_RAISE_RAD * reach * k;
      bone.rotation.z += (i === 0 ? 1 : -1) * CLIMB_ARM_ROLL_RAD * reach * k;
      const forearm = this.climbForearmBones[i];
      if (forearm) forearm.rotation.x += CLIMB_ELBOW_RAD * reach * k;
    }
    // Knees tuck while the body rises and extend to plant as it tops out; the
    // trailing leg follows a beat behind at reduced depth.
    for (let i = 0; i < this.climbLegBones.length; i++) {
      const trail = i === 0 ? 0 : CLIMB_LEG_TRAIL;
      const amp = i === 0 ? 1 : 0.78;
      const tuck = env01(t - trail, 0.14, 0.44) * (1 - env01(t - trail, 0.66, 0.96)) * amp * k;
      const thigh = this.climbLegBones[i];
      if (thigh) thigh.rotation.x += CLIMB_THIGH_TUCK_RAD * tuck;
      const shin = this.climbShinBones?.[i] ?? null;
      if (shin) shin.rotation.x += CLIMB_SHIN_FOLD_RAD * tuck;
    }
    // The torso curls in behind the hands and straightens over the lip.
    if (this.climbTorsoBone) {
      const curl = env01(t, 0.06, 0.4) * (1 - env01(t, 0.7, 1));
      this.climbTorsoBone.rotation.x += CLIMB_TORSO_CURL_RAD * curl * k;
    }
    // The eyes lead: chin up at the lip while the hands fly to it.
    if (this.climbHeadBone === undefined) {
      this.climbHeadBone = this.model.getObjectByName('head') ?? null;
    }
    if (this.climbHeadBone) {
      const look = env01(t, 0, 0.18) * (1 - env01(t, 0.5, 0.85));
      this.climbHeadBone.rotation.x += CLIMB_HEAD_TILT_RAD * look * k;
    }
  }

  /**
   * Drive the ledge-climb pose. The sim owns the move; this says whether it
   * is running and how far through it is (0..1). Both hosts feed the real
   * phase (offline from the entity's climb arc, online from the mirrored
   * snapshot progress), so hands plant exactly when the body reaches the lip
   * whatever the climb's height-scaled duration. Phase omitted falls back to
   * a local clock (an older server that only sent the boolean).
   */
  setClimbing(on: boolean, phase?: number): void {
    const clamped = typeof phase === 'number' ? Math.min(1, Math.max(0, phase)) : null;
    // Joining mid-pull (a remote climber entering interest range) seeds the
    // pose at the right beat instead of replaying the reach from zero.
    if (on && !this.climbOn) this.climbPhase = clamped ?? 0;
    this.climbOn = on;
    this.climbTarget = on ? clamped : null;
  }

  /**
   * Sit this body astride a mount, or hand it back its own legs.
   *
   * The renderer passes the active mount's MountRideSpec while the mount is
   * shown and null the rest of the time, and the pose is applied after the
   * mixer in the same slot as the ledge climb. Mounts without a ride spec keep
   * the plain seated loop, the Lanternback's rider is in a CHAIR, where a
   * straddle would be wrong.
   */
  setRidePose(spec: MountRideSpec | null): void {
    this.rideSpec = spec;
  }

  /**
   * Fold the legs around the mount's barrel.
   *
   * Runs AFTER the mixer, in the same slot as applyClimbPose, and bails while
   * the climb owns the body, nothing can be climbing a ledge and riding at
   * once, and the two would otherwise both write the thigh.
   *
   * Unlike every other pose layer here this one OVERRIDES the legs (a slerp
   * from the clip's pose toward an absolute target) rather than adding to
   * them. The base underneath is the floor-sit loop, whose thighs are folded
   * to 99 degrees forward and 105 degrees out with the shins tucked across
   * each other, additive offsets on top of a cross-legged pose land wherever
   * that pose happens to be, and the legs of a rider gripping a mount should
   * be still anyway. The base keeps everything else: the hips' HEIGHT (which
   * is what puts his weight on the saddle), the breathing, the arms.
   *
   * Bone frames, read out of the shipped rig rather than guessed: each leg
   * bone's local +Y runs DOWN the limb, the pelvis frame is the model frame
   * (+Z forward, proved by the toe bone sitting forward of the ankle), and the
   * legs' rest orientation is a half turn about X. So the target for a thigh
   * is qZ(spread) * qX(-flex) * qRest, the knee is a plain hinge about the
   * thigh's own X, and the left leg (which hangs at model +X) opens on
   * POSITIVE z with the right mirrored.
   */
  private applyRidePose(dt: number): void {
    const spec = this.rideSpec;
    const target = spec && !this.climbOn && this.climbBlend <= 0 ? 1 : 0;
    this.rideBlend += (target - this.rideBlend) * Math.min(1, dt * RIDE_BLEND_RATE);
    if (this.rideBlend < 1e-3) {
      this.rideBlend = 0;
      return;
    }
    if (!spec) return;
    if (this.climbLegBones === undefined) {
      this.climbLegBones = CLIMB_LEG_BONES.map((n) => this.model.getObjectByName(n) ?? null);
    }
    if (this.climbShinBones === undefined) {
      this.climbShinBones = CLIMB_SHIN_BONES.map((n) => this.model.getObjectByName(n) ?? null);
    }
    if (this.rideFootBones === undefined) {
      this.rideFootBones = RIDE_FOOT_BONES.map((n) => this.model.getObjectByName(n) ?? null);
    }
    if (this.rideHipBone === undefined) {
      this.rideHipBone = this.model.getObjectByName(RIDE_HIP_BONE) ?? null;
    }
    const k = this.rideBlend;
    for (let i = 0; i < this.climbLegBones.length; i++) {
      const side = i === 0 ? 1 : -1;
      const thigh = this.climbLegBones[i];
      if (thigh) {
        rideQuat
          .setFromAxisAngle(AXIS_Z, side * spec.spread)
          .multiply(rideSwing.setFromAxisAngle(AXIS_X, -spec.thigh))
          .multiply(RIDE_LEG_REST);
        thigh.quaternion.slerp(rideQuat, k);
      }
      const shin = this.climbShinBones[i];
      if (shin) shin.quaternion.slerp(rideQuat.setFromAxisAngle(AXIS_X, spec.knee), k);
      const foot = this.rideFootBones[i];
      if (foot && spec.ankle !== undefined) {
        foot.quaternion.slerp(rideQuat.setFromAxisAngle(AXIS_X, spec.ankle), k);
      }
    }
    // The pelvis is an override too (the seated lounge leans it back); the
    // chest stays additive so the torso keeps breathing on top.
    if (this.rideHipBone && spec.hips !== undefined) {
      this.rideHipBone.rotation.x += (spec.hips - this.rideHipBone.rotation.x) * k;
    }
    if (spec.lean) {
      if (this.climbTorsoBone === undefined) {
        this.climbTorsoBone = this.model.getObjectByName(CLIMB_TORSO_BONE) ?? null;
      }
      if (this.climbTorsoBone) this.climbTorsoBone.rotation.x += spec.lean * k;
    }
  }

  /** Ease the extra arm raise in toward the swap moment and back out after it;
   *  an attack/hit one-shot stealing the gesture cancels the lift outright. */
  private applyStowArmLift(dt: number): void {
    const lift = this.stowLift;
    if (lift.t < 0 || lift.dur <= 0) return;
    const clip = this.def.clips.stow;
    const gesture = clip ? this.action(clip) : null;
    if (this.deadLock || !gesture || (this.currentIsOneShot && this.current !== gesture)) {
      lift.t = -1;
      return;
    }
    lift.t += dt;
    const p = lift.t / lift.dur;
    if (p >= 1) {
      lift.t = -1;
      return;
    }
    if (this.stowArmBone === undefined) {
      this.stowArmBone = this.model.getObjectByName(STOW_ARM_BONE) ?? null;
    }
    if (!this.stowArmBone) {
      lift.t = -1;
      return;
    }
    this.stowArmBone.rotation.x += STOW_ARM_LIFT_RAD * Math.sin(Math.PI * p);
  }

  // -------------------------------------------------------------------------
  // One-shot triggers (sim events)
  // -------------------------------------------------------------------------

  /** A one-shot (attack/hit/emote) is still playing. The renderer's spellfx
   *  handler reads this to avoid restarting a windup-started throw animation
   *  when the projectile releases mid-clip. */
  get isMidOneShot(): boolean {
    return this.currentIsOneShot;
  }

  /** A channel-start event can arrive just before its authoritative entity
   * snapshot. Enter the looping cast pose immediately and interrupt any short
   * projectile one-shot that would otherwise mask the first part of the channel. */
  beginCastChannel(): void {
    if (this.deadLock) return;
    this.baseState = 'cast';
    this.currentIsOneShot = false;
    this.currentOneShotIsEmote = false;
    this.fadeTo(this.action(this.def.clips.cast) ?? this.action(this.def.clips.idle), FADE, false);
  }

  /** An authored per-ability one-shot exists on this rig (attackByAbility
   *  entry with a live action). The ability-VFX painter gates its ceremonial
   *  cast gestures on this, so a heal/blessing cue can never fall back to a
   *  weapon swing on a rig without the authored clip. */
  hasAttackClipOverride(abilityId: string): boolean {
    if (this.action(`Signature_${abilityId}`)) return true;
    const override = this.def.clips.attackByAbility?.[abilityId];
    return override !== undefined && this.action(override) !== null;
  }

  /** Start the attack one-shot for a swing and return the seconds until its blade lands
   *  (ClipMap.contacts; 0 = no listed contact, the swing's effects play at once). */
  playAttack(abilityId?: string, gestureOnly = false, kind?: 'melee' | 'wand'): number {
    if (this.deadLock) return 0;
    if ((abilityId === 'charge' || abilityId === 'intervene') && this.action(this.def.clips.rush)) {
      this.warriorBody.beginRush(abilityId);
      return 0;
    }
    if (!abilityId && this.warriorBody.rushOwnsBody) return 0;
    if (abilityId) this.warriorBody.cancelRush();
    const signature = abilityId ? `Signature_${abilityId}` : null;
    if (signature && this.action(signature)) {
      this.playOneShot(signature, 1);
      this.currentOneShotIsAttack = true;
      return 0;
    }
    // A cast ceremony (castFx flourish/weaponAura) draws a body gesture ONLY
    // through an authored per-ability entry, the rule the ability painter
    // already applies: with none, nothing plays. Never the default weapon
    // swing, which is what a buff with no entry used to fall back to.
    if (gestureOnly && !this.def.clips.attackByAbility?.[abilityId ?? '']) return 0;
    if (kind === 'wand' && this.action(this.def.clips.wandAttack)) {
      this.playOneShot(this.def.clips.wandAttack!, this.def.attackTimeScale ?? 1.3);
      this.currentOneShotIsAttack = true;
      return 0;
    }
    // Resolved against THIS rig's bound clips: a rig without the substitute
    // (every body but the hunter) keeps its own authored attack instead of
    // swinging with no animation at all.
    const skinAttack = kind
      ? null
      : pickSkinAttackClips(this.weaponSkinId, (c) => this.action(c) !== null);
    // A displayed bow skin substitutes Bow_Draw_Shot for the hunter's RANGED
    // attacks, including the ranged per-ability overrides: the crossbow-
    // shoulder ability poses (Hunter_Shot_Snap etc.) are authored for the
    // class's authored crossbow and would look backwards with a bow visibly
    // drawn. It must NOT substitute for a non-ranged override: the three
    // melee abilities (raptor_strike, mongoose_bite, wing_clip) play a
    // bespoke Hunter_Melee_* swing regardless of a displayed bow, since a bow
    // skin never changes how a melee hit is thrown, and the self-buff aspect
    // toggles / Fevered Draw (rapid_fire) play the class's own baked
    // Spellcast_Raise raise/buff ceremony through this same playAttack path
    // (the ability-VFX painter triggers non-contact authored gestures here
    // too), never a draw-shot. A RANGED override is identified by its
    // clip-name convention (the KayKit Hunter_Shot_* poses, the WOC rig's
    // Ranged_Shoot and its minted halves) rather than a hardcoded ability
    // list, so any non-ranged override (Hunter_Melee_*, the WOC 1H blades,
    // Spellcast_Raise) keeps its authored clip automatically
    // (tests/weapon_skins.test.ts).
    const rawOverride = abilityId ? this.def.clips.attackByAbility?.[abilityId] : undefined;
    const overrideIsRanged = rawOverride !== undefined && /Shot|Shoot/.test(rawOverride);
    // Light the fist BEFORE the clip choice, so an ability that declares a glow gets one
    // even on a rig whose authored clip is missing: the telegraph is the load-bearing half
    // of a slam, and it must not depend on the animation having been baked.
    const glow = abilityId ? this.def.clips.chargeGlowByAbility?.[abilityId] : undefined;
    if (glow) this.ensureChargeGlow()?.ignite(glow);
    const override = !skinAttack || !overrideIsRanged ? rawOverride : undefined;
    if (override && this.action(override)) {
      const authoredTimeScale = abilityId
        ? this.def.clips.attackTimeScaleByAbility?.[abilityId]
        : undefined;
      const overrideScale = authoredTimeScale ?? this.def.attackTimeScale ?? 1.3;
      this.playOneShot(override, overrideScale);
      this.currentOneShotIsAttack = true;
      if (abilityId === 'final_edict') {
        this.templarsVerdictAction = this.action(override);
      } else if (override === PALADIN_BASTION_SWEEP_CLIP) {
        this.bastionSweepAction = this.action(override);
      }
      return this.swingContact(override, 0, overrideScale);
    }
    // A shot launched out of a HELD aim (ClipMap.clipSplits: the generic cast
    // clip is the head half, frozen at the hold point) releases the tail half
    // instead of restarting the whole clip: the crossbow is already up. The
    // launch cue carries no ability id (the sim tags every player shot
    // 'ranged-shot' and the renderer starts whichever clip the rig selects),
    // so the per-ability override above never sees a timed shot; this is
    // the arm that does. A bound bow-skin draw still wins, as for any shot.
    const tail = skinAttack || kind ? null : this.heldSplitTail();
    if (tail) {
      this.playOneShot(tail, this.def.attackTimeScale ?? 1.3);
      this.currentOneShotIsAttack = true;
      return 0;
    }
    const style = weaponAttackStyle(this.weaponItemId, this.offhandItemId);
    // A two-hander carried on the single set (loadoutSwaps.twohand: held in one fist, the
    // sword-and-board stance without the shield) swings like the one-hand sword too, the
    // default chop/slash alternation; a two-hand staff keeps its heavy hand clip.
    const singleSetTwoHander =
      style === 'twohand' &&
      this.loadoutSwap !== null &&
      this.loadoutSwap === this.def.clips.loadoutSwaps?.twohand;
    const handClip =
      style && !singleSetTwoHander ? this.def.clips.attackByHand?.[style] : undefined;
    if (!skinAttack && handClip && this.action(handClip)) {
      const scale = this.def.attackTimeScale ?? 1.3;
      if (style !== 'dualwield') {
        this.playOneShot(handClip, scale);
        this.currentOneShotIsAttack = true;
        return this.swingContact(handClip, 0, scale);
      }
      // One strike per swing on a split clip, the halves alternating; two swings
      // in one frame are both hands at once (attack_swing_core.ts).
      const pick = pickDualSwing(
        handClip,
        this.def.clips.dualWieldPair,
        (n) => this.action(n) !== null,
        this.mixer.time,
        this.dualSwing,
      );
      if (pick.clip === null) {
        // a third swing this frame: the pair clip already playing carries it
        const playing = this.currentIsOneShot ? this.current?.getClip().name : undefined;
        return contactDelaySec(this.def.clips.contacts, playing, pick.contact, scale);
      }
      this.playOneShot(pick.clip, scale);
      this.currentOneShotIsAttack = true;
      return this.swingContact(pick.clip, pick.contact, scale);
    }
    // An ability with no override of its own takes the rig's heavier ability blow, when it
    // authors one (the Shape of the Foreman's hammer and stomp against its swipes).
    const abilityClips = abilityId && !skinAttack ? this.def.clips.abilityAttack : undefined;
    if (abilityClips && abilityClips.length > 0) {
      const name = abilityClips[this.abilityAttackIdx++ % abilityClips.length];
      if (this.action(name)) {
        const abilityScale = this.def.attackTimeScale ?? 1.3;
        this.playOneShot(name, abilityScale);
        this.currentOneShotIsAttack = true;
        return this.swingContact(name, 0, abilityScale);
      }
    }
    const clips =
      skinAttack?.clips ??
      (kind === 'melee' ? this.def.clips.meleeAttack : undefined) ??
      this.def.clips.attack;
    if (clips.length === 0) return 0;
    const name = clips[this.attackIdx++ % clips.length];
    const listScale = skinAttack?.timeScale ?? this.def.attackTimeScale ?? 1.3;
    this.playOneShot(name, listScale);
    this.currentOneShotIsAttack = true;
    return this.swingContact(name, 0, listScale);
  }

  /** Seconds until the blade of the swing just started lands: the listed contact of the
   *  clip the name resolves to under the current loadout (1H_Slash -> Dual_Cross ...). */
  private swingContact(name: string, contact: number, timeScale: number): number {
    const clip = this.action(name)?.getClip().name ?? name;
    return contactDelaySec(this.def.clips.contacts, clip, contact, timeScale);
  }

  /** The tail half of a split clip whose head half is the cast action the
   *  rig is holding right now (paused at its hold point), or null. */
  private heldSplitTail(): string | null {
    const current = this.current;
    if (!current?.paused || this.baseState !== 'cast') return null;
    const head = current.getClip().name;
    const cut = this.def.clips.clipSplits?.find((c) => c.names[0] === head);
    return cut && this.action(cut.names[1]) ? cut.names[1] : null;
  }

  /**
   * The fist-glow rig, built on first use.
   *
   * Resolved through the same bone-name variants the weapon-attach path tries, because
   * GLTFLoader sanitizes `handslot.r` to `handslotr` and the creature rigs name their
   * hands `R_Hand` outright. A rig with neither returns a glow that simply never draws,
   * rather than throwing on a boss mid-fight.
   */
  private ensureChargeGlow(): ChargeGlow | null {
    if (this.chargeGlow) return this.chargeGlow;
    const find = (...names: string[]): THREE.Object3D | null => {
      for (const n of names) {
        const found = this.model?.getObjectByName(n);
        if (found) return found;
      }
      return null;
    };
    this.chargeGlow = new ChargeGlow(
      find('handslotl', 'handslot.l', 'L_Hand'),
      find('handslotr', 'handslot.r', 'R_Hand'),
    );
    return this.chargeGlow;
  }

  /** Bladed Gyre is instant, so it uses one short body spin instead of the
   *  held Bladestorm channel pose. Repeated AoE hits only refresh the timer. */
  playWhirl(abilityId?: string): void {
    if (this.deadLock) return;
    this.warriorBody.cancelRush();
    if (
      (abilityId === 'cleave' || abilityId === 'whirlwind') &&
      this.action(`Signature_${abilityId}`)
    ) {
      this.spinOnceTimer = 0;
      this.playOneShot(`Signature_${abilityId}`, 1);
      this.currentOneShotIsAttack = true;
      return;
    }
    this.spinOnceTimer = SPIN_ATTACK_VISUAL_DURATION;
    const clips = this.def.clips.attack;
    if (clips.length > 0) {
      this.playOneShot(clips[this.attackIdx++ % clips.length], SPIN_ATTACK_TIMESCALE);
    }
  }

  /** Successful Onrush arrival, validated by its travelled contact cue. */
  arriveFromOnrush(): boolean {
    return !this.deadLock && !!this.action(this.def.clips.rushArrival) && this.warriorBody.arrive();
  }

  get isPerformingAbility(): boolean {
    return (
      this.warriorBody.rushOwnsBody ||
      (this.currentIsOneShot && this.current?.getClip().name.startsWith('Signature_') === true)
    );
  }

  playHit(): void {
    if (this.deadLock || this.currentIsOneShot || this.hitCooldown > 0) return;
    const clips = this.def.clips.hit;
    if (!clips || clips.length === 0) return;
    this.hitCooldown = HIT_REACT_COOLDOWN;
    this.playOneShot(clips[Math.floor(Math.random() * clips.length)], 1.2);
    if (this.def.clips.combatIdle) this.braceUntil = extendBrace(this.braceUntil, this.clock);
  }

  /** Contact-frame hitstop: hold THIS rig's animation at `scale` speed for
   *  `dur` seconds (the melee "bite"; also the struck target's flinch-freeze).
   *  Overlapping requests merge, longest duration, slowest scale, and the
   *  post-hold refractory swallows rapid re-triggers, so stacking strikes can
   *  never chain the rig into visible slow motion. */
  holdFrame(scale: number, dur: number): void {
    if (this.deadLock || !Number.isFinite(scale) || !Number.isFinite(dur) || dur <= 0) return;
    dur = Math.min(0.16, dur);
    if (this.holdT > 0) {
      this.holdT = Math.max(this.holdT, dur);
      this.holdScale = Math.min(this.holdScale, Math.max(0.02, scale));
      return;
    }
    if (this.holdCooldown > 0) return;
    this.holdT = dur;
    this.holdScale = Math.max(0.02, scale);
  }

  /** Feed the cast-windup lean for this frame (anticipation): the body eases
   *  toward `amount` rad of backward pitch while fed each frame; once feeding
   *  stops (the release moment) the spring snaps through a small forward
   *  recoil back to neutral. Rig-group rotation only, no bone surgery. */
  setWindupLean(amount: number): void {
    if (this.deadLock || !Number.isFinite(amount)) return;
    this.leanTarget = -Math.min(LEAN_MAX_RAD, Math.max(0, amount));
    this.leanFeed = LEAN_FEED_S;
  }

  playEmote(id: OverheadEmoteId, repeatsOverride?: number): void {
    if (this.deadLock) return;
    const spec = this.def.clips.emote?.[id];
    const clip = firstLoadedEmoteClip(spec, (name) => this.action(name));
    if (!clip) return;
    this.playOneShot(clip, spec?.timeScale ?? 1, repeatsOverride ?? spec?.repeats ?? 1, id);
  }

  /** The roar one-shot of a shout cast: the rig's own `shoutEmote` (the WOC
   *  warrior flexes), cheer for every rig that names none. */
  playShout(repeats = 1): void {
    const emote = this.def.clips.shoutEmote;
    if (emote === null) return;
    this.playEmote(emote ?? 'cheer', repeats);
  }

  /** The summon gesture: the rider throws an arm up as a mount is called. A thin
   *  wrapper over the Spellcast_Raise one-shot, time-scaled so the single raise
   *  roughly fills the transition window (clamped so a very short or long window
   *  still reads as a deliberate pose). No-ops on rigs without the clip. */
  playCallPose(durationSeconds: number): void {
    if (this.deadLock) return;
    const a = this.action('Spellcast_Raise');
    if (!a) return;
    const window = Math.max(0.2, durationSeconds);
    const timeScale = Math.min(2, Math.max(0.5, a.getClip().duration / window));
    this.playOneShot('Spellcast_Raise', timeScale);
  }

  // -------------------------------------------------------------------------
  // Static posing (player-card capture). poseFreeze() locks the rig on a chosen
  // clip's frame so an offscreen render captures a deliberate pose instead of
  // whatever idle frame happens to be up; clearPose() resumes the idle loop.
  // -------------------------------------------------------------------------

  /**
   * Pose the rig on the first available clip from `candidates`, frozen at
   * `fraction` (0..1) of that clip's duration, and hold it paused. Returns the
   * chosen clip name, or null if none of the candidates exist on this model.
   * Only contributes the chosen action (others are stopped) so the frame is
   * clean. Pair with clearPose() to return to the idle loop.
   */
  poseFreeze(candidates: readonly string[], fraction: number): string | null {
    let chosen: THREE.AnimationAction | null = null;
    let name: string | null = null;
    for (const c of candidates) {
      const a = this.action(c);
      if (a) {
        chosen = a;
        name = c;
        break;
      }
    }
    if (!chosen) return null;
    for (const a of this.actions.values()) if (a !== chosen) a.stop();
    chosen.stop();
    chosen.reset();
    chosen.setLoop(THREE.LoopOnce, 1);
    chosen.clampWhenFinished = true;
    chosen.timeScale = 1;
    chosen.setEffectiveWeight(1);
    chosen.play();
    const dur = chosen.getClip().duration;
    chosen.time = dur > 0 ? Math.max(0, Math.min(dur - 1e-3, dur * fraction)) : 0;
    chosen.paused = true; // hold the frame
    this.current = chosen;
    this.currentIsOneShot = true;
    this.currentOneShotIsEmote = false;
    this.updateMixer(0);
    return name;
  }

  /** Resume the looping idle after poseFreeze() so the live preview isn't stuck. */
  clearPose(): void {
    this.currentIsOneShot = false;
    this.currentOneShotIsEmote = false;
    this.baseState = 'idle';
    const idle = this.action(this.def.clips.idle);
    if (!idle) return;
    for (const a of this.actions.values()) if (a !== idle) a.stop();
    idle.reset();
    idle.setLoop(THREE.LoopRepeat, Infinity);
    idle.clampWhenFinished = false;
    idle.timeScale = 1;
    idle.paused = false;
    idle.setEffectiveWeight(1);
    idle.play();
    this.current = idle;
    this.updateMixer(0);
  }

  // -------------------------------------------------------------------------
  // LOD / shadow plumbing (memoized, called every frame by the renderer)
  // -------------------------------------------------------------------------

  /**
   * Terrain lean, in the body's own frame (see `render/ground_tilt_core.ts`).
   * Written on `root`, which nothing else transforms: `poseWrap` rewrites its
   * own rotation every frame for the swim pose, so a lean applied there would
   * be stomped. Two float writes, elided when the plan has not moved.
   */
  setGroundTilt(pitch: number, roll: number): void {
    if (this.root.rotation.x === pitch && this.root.rotation.z === roll) return;
    this.root.rotation.x = pitch;
    this.root.rotation.z = roll;
  }

  setShadow(on: boolean): void {
    if (on === this.shadowOn) return;
    this.shadowOn = on;
    for (const m of this.casters) m.castShadow = on;
  }

  /** The shadow plan's answer for the proxy band. A flag and a visibility write, never a
   *  bake: a body with no far bake of its own casts nothing here (a composed body, until
   *  its first far crossing) or its key's stand-in (a WOC body). */
  setProxyShadow(on: boolean): void {
    this.proxyShadowWanted = on;
    this.syncShadowProxyVisibility();
  }

  setActive(on: boolean): void {
    const changed = this.root.visible !== on;
    this.root.visible = on;
    if (!this.metamorphLeftWing || !this.metamorphRightWing) return;
    if (!on) {
      this.metamorphWasVisible = false;
      this.metamorphPulse = 0;
      return;
    }
    if (changed || !this.metamorphWasVisible) {
      this.metamorphElapsed = 0;
      this.metamorphWasVisible = true;
    }
  }

  setFar(far: boolean): void {
    if (far !== this.far) {
      this.far = far;
      // First crossing of a composed body: mint its far LOD, BUDGETED. Cached
      // per part set, so a crowd in one haircut pays for one bake between them,
      // but a camera leaving a capital crosses every peer in one frame, so only
      // one genuinely new part set bakes per window and the rest go pending and
      // retry from update(). A part set someone already baked is free (the peek)
      // and never competes for the slot. (A WOC body's bake is units of the
      // renderer's work queue instead, whose budget does that spreading.)
      if (!far) this.farBakePending = false;
    }
    if (far && !this.farMesh && !this.farBakeTried) this.attemptComposedFar();
    // Every frame, not only on the edge: the compile gate's settle only clears
    // its flag (below), and the reveal it unlocks must land HERE, inside the
    // renderer's per-frame pass, never in the settle callback. A rig hidden
    // between frames takes its budgeted weapon lights out of three's counted
    // set behind the light budget's back, and numPointLights sits in every
    // program cache key (the measured relink storm). Write-elided, so the
    // steady state costs three compares.
    this.syncFarVisibility();
  }

  /** The one place the rig/far-mesh handoff is written (far_lod_reveal_core):
   *  the LOD edge, update()'s retry and the per-frame setFar all land here, so
   *  a far mesh whose materials are still linking never draws early and the
   *  articulated rig never hides without a ready stand-in. */
  private syncFarVisibility(): void {
    // The wait for a WOC body's head ends here, once, on whichever per-frame path reveals
    // first (the LOD pass, the shadow plan, update): the body draws the frame its head is
    // live. Free afterwards: the latch never re-arms.
    if (this.wocHeadAwaited && !this.wocHead?.awaited) this.wocHeadAwaited = false;
    const farStandsIn = farMeshShown(this.far, this.farMesh !== null, this.farCompilePending);
    const showRig = bodyDrawn(!farStandsIn, this.wocHeadAwaited);
    const showFar = bodyDrawn(farStandsIn, this.wocHeadAwaited);
    if (this.modelWrap.visible !== showRig) this.modelWrap.visible = showRig;
    if (this.farMesh && this.farMesh.visible !== showFar) this.farMesh.visible = showFar;
    this.syncShadowProxyVisibility();
  }

  private syncShadowProxyVisibility(): void {
    const hasFar = this.farMesh !== null;
    if (this.shadowProxy) {
      const show = bodyDrawn(
        shadowProxyShown(this.proxyShadowWanted, hasFar, this.farCompilePending),
        this.wocHeadAwaited,
      );
      if (this.shadowProxy.visible !== show) this.shadowProxy.visible = show;
    }
    // a WOC body's stand-in casts for as long as its own baked silhouette cannot
    if (this.shadowStandIn) {
      const show = bodyDrawn(
        shadowStandInShown(
          this.proxyShadowWanted,
          this.shadowProxy !== null,
          this.farCompilePending,
        ),
        this.wocHeadAwaited,
      );
      if (this.shadowStandIn.visible !== show) this.shadowStandIn.visible = show;
    }
  }

  /** Install (or clear) the renderer's compile gate for far bakes minted after
   *  the view's creation gate ran. Installing also resets any bake or re-skin
   *  still pending from a previous life (pool re-acquire): a settle the old
   *  renderer generation dropped must not strand this visual articulated or
   *  keep a superseded far set's tinted lease. */
  setFarBakeGate(gate: FarBakeGate | null, work?: CharacterWorkQueue): void {
    this.farBakeGate = gate;
    // The renderer's work queue rides in with its gate. A pool re-acquire passes the
    // gate alone, and a body the prewarm built never met the queue at all, so the queue
    // is found again by the gate it first came with (one renderer owns both).
    if (gate && work) queueOfGate.set(gate, work);
    const queue = work ?? (gate ? queueOfGate.get(gate) : undefined);
    if (queue) this.workQueue = queue;
    // ...and the armor store rides the same queue: a set that lands is prepared as a
    // unit of it, ahead of any wearer's attach (woc_armor_packs.ts)
    if (queue) setWocArmorWorkQueue(queue);
    this.wocHead?.gateChanged();
    this.wocArmor?.gateChanged();
    this.wocAtlas.restart();
    this.sanguineSheath.setGate(gate);
    if (this.weaponAuraSanguine) this.rebuildWeaponAura();
    this.dropPendingFarMaterials();
    this.farCompilePending = false;
    // ...and a far bake asked of the previous queue may never be run: a body still far
    // asks the new one on its next frame, also when the previous queue had already
    // answered that it would never bake (it shut down under the ask).
    this.dropWocFarJob();
    if (this.wocFarParts && !this.farMesh && !this.wocFarLease) this.farBakeTried = false;
    // Same reason as the far arm: a settle the old renderer generation dropped
    // must not leave this visual waiting forever on an effect it already wears.
    // A swap that was still in flight is planned again behind THIS gate: dropped and
    // forgotten, the rig kept the materials of an effect state it had already left
    // (opaque while stealthed, a ghost after the ghost run) until some later edge
    // happened to sweep it.
    const replan = this.effectSwapScratch !== null;
    this.dropPendingEffectSwap();
    if (replan && !this.disposed) this.applyVisualMaterials();
  }

  /** Route a freshly minted far bake (mesh + shadow proxy) through the compile
   *  gate: hidden until its programs link, the articulated rig standing in
   *  meanwhile. Without a gate the bake reveals immediately (previous
   *  behaviour, and what previews and tests without a renderer get). */
  private gateFarMint(): void {
    const wrap = this.farWrap;
    if (!wrap || !this.farBakeGate) return;
    this.farCompilePending = true;
    this.farBakeGate(wrap, () => {
      // A visual disposed, or re-baked, while the link was in flight: the
      // settle belongs to a node this visual no longer draws. Flag only: the
      // next per-frame setFar reveals (see setFar for why not here).
      if (this.disposed || this.farWrap !== wrap) return;
      this.farCompilePending = false;
    });
  }

  /** One attempt at the composed far LOD, budgeted: free when the part set is already
   *  baked; otherwise it takes the frame slot or goes pending. A WOC body behind a
   *  renderer never bakes here: its bake is units of the work queue (attemptWocFar). */
  private attemptComposedFar(): void {
    if (!this.look && !this.wocFarParts) return;
    if (this.wocFarParts && this.attemptWocFar()) return;
    const cached = this.wocFarParts
      ? peekWocFarBake(
          this.key,
          this.wocFarParts,
          this.wocFarFiles,
          this.wocFarHead,
          this.wocFarKey ?? undefined,
        )
      : this.look && peekModularFarBake(this.key, this.look);
    if (!cached && !takeFarBakeBudget()) {
      this.farBakePending = true;
      return;
    }
    this.farBakePending = false;
    this.buildComposedFar();
  }

  /**
   * A WOC body's far bake, off the frame. Nothing is baked for a body that draws nothing
   * yet (it still waits for its head), nor for one whose head just changed under a
   * dressing update() has not run yet: either bake would freeze a head the body is about
   * to stop drawing (none at all, for the first) and be thrown away the frame the far key
   * catches up, so it stays pending and update() asks again. A body behind a renderer
   * (a compile gate, and the work queue that rode in with it) hands the bake to that queue
   * and keeps its rig until its mount unit has run. True when this call dealt with the
   * attempt; false for a body with none (a direct build, a preview, a test), which bakes
   * on the spot under the bake budget, as a composed body does.
   */
  private attemptWocFar(): boolean {
    // A head piece still on its way (a hairstyle joining a head that stands in bare) re-keys
    // the bake the moment it joins (dressWoc): the rig stands in until then, so a file
    // landing late never costs this body a second bake. A file that failed is not on its
    // way: the head is at rest in what it holds, and bakes as it is.
    if (this.wocHeadAwaited || this.wocHeadRedress || this.wocHead?.joining) {
      this.farBakePending = true;
      return true;
    }
    const queue = this.rendererWorkQueue();
    if (!queue) return false;
    this.farBakePending = false;
    if (!this.wocFarJob) this.queueWocFar(queue);
    return true;
  }

  /** The work queue of the renderer behind this body, or null for a body with no gate (a
   *  queue outlives the gate it came with only on a body whose gate was taken away). A
   *  pooled body is handed its gate alone, and one taken before the renderer had paired
   *  that gate with its queue met no queue then: it finds it here, by the gate, the first
   *  time it needs one. */
  private rendererWorkQueue(): CharacterWorkQueue | null {
    const gate = this.farBakeGate;
    if (!gate) return null;
    this.workQueue ??= queueOfGate.get(gate) ?? null;
    return this.workQueue;
  }

  /**
   * Ask the work queue for this body's far LOD: the bake's units (shared with every body
   * in the same look, and none at all for a look already baked: woc_far_bake.ts
   * queueWocFarBake), then this body's own mount as one more unit, so a crowd crossing
   * the band together mounts a few bodies a frame. The far mesh is an optimization of a
   * body its rig already draws whole, so its units sit with the merged stand-ins: below
   * the live views, in the class that still gets a slot a frame under load.
   */
  private queueWocFar(queue: CharacterWorkQueue): void {
    const parts = this.wocFarParts;
    const fit = this.def.wocCharacter?.fit;
    if (!parts || !fit) return;
    const priority = GPU_WORK_PRIORITY.VISIBLE_PREWARM;
    const job = queueWocFarBake(
      this.key,
      parts,
      this.wocFarFiles,
      this.wocFarHead,
      queue,
      priority,
      this.wocFarKey ?? undefined,
    );
    this.wocFarJob = job;
    void job.ready
      .then((baked) => {
        // an ask dropped meanwhile mounts nothing, so it asks the queue for nothing
        if (this.wocFarJob !== job) return undefined;
        // nothing to mount: the look bakes to nothing, or the bake stopped and said so
        if (!baked) return this.endWocFarJob(job);
        return queue.run(() => this.mountWocFar(job), priority, `${WOC_FAR_MOUNT_LABEL}:${fit}`);
      })
      .catch((err) => {
        // the mount unit was refused (a queue shut down with its renderer) or threw
        warnWocFarStopped(`mount:${this.key}`, err);
        this.endWocFarJob(job);
      });
  }

  /** The mount unit of a queued far bake: build this body's far mesh from the bake its
   *  units just finished, hidden behind the compile gate. The ask holds that bake in the
   *  cache until here, so this retains it and never bakes. An ask dropped since (a
   *  re-dress, a new gate, a dispose) mounts nothing. The reveal is the next per-frame
   *  setFar's, never this unit's (see setFar). */
  private mountWocFar(job: WocFarBakeRequest): void {
    if (this.wocFarJob !== job) return;
    this.wocFarJob = null;
    try {
      if (this.disposed || this.farMesh || this.farBakeTried) return;
      // the head changed under a dressing update() has not run yet, or a piece of it is
      // joining: the look this bake froze is about to be re-keyed, so the body asks again
      // once it is dressed
      if (this.wocHeadRedress || this.wocHead?.joining) {
        this.farBakePending = this.far;
        return;
      }
      this.buildComposedFar();
    } finally {
      // after the body's own lease is taken: the bake never goes idle in between
      job.release();
    }
  }

  /** A far ask that came to nothing: the body keeps its rig, and asks again only once it
   *  is dressed again. Never a bake on the spot in its place. */
  private endWocFarJob(job: WocFarBakeRequest): undefined {
    job.release();
    if (this.wocFarJob !== job) return undefined;
    this.wocFarJob = null;
    this.farBakeTried = true;
    this.farBakePending = false;
    return undefined;
  }

  /** The body is parked (its entity streamed out and the pool kept it): nobody sees it,
   *  so it stops waiting for a far mesh. Its look leaves the line unless another body
   *  waits for it too. */
  parked(): void {
    this.dropWocFarJob();
    this.farBakePending = false;
  }

  /** Let go of a queued far bake this body no longer wants. */
  private dropWocFarJob(): void {
    this.wocFarJob?.release();
    this.wocFarJob = null;
  }

  /** An equipment edge drops the obsolete silhouette, restoring the rig until its
   *  replacement is baked (units of the work queue, or the bake budget for a body with no
   *  queue) and linked behind the compile gate. A body with none mounted only forgets
   *  what it asked for: there is nothing to take down, so nothing is swept. */
  private invalidateWocFar(): void {
    this.dropWocFarJob();
    this.farBakeTried = false;
    this.farBakePending = this.far;
    // (a lease with no mesh is a mint that threw part way: it is given back like any other)
    if (!this.farWrap && !this.wocFarLease) return;
    this.dropPendingFarMaterials();
    this.dropPendingEffectSwap();
    this.farWrap?.removeFromParent();
    this.farWrap = null;
    this.farMesh = null;
    this.farMaterials = null;
    this.shadowProxy = null;
    this.farCompilePending = false;
    releaseTintedMaterials(this.tintedFarClaims);
    this.tintedFarClaims.clear();
    this.wocFarLease?.release();
    this.wocFarLease = null;
    this.syncFarVisibility();
    this.applyVisualMaterials();
  }

  /** Hang a baked far mesh (and, off the low tier, its shadow proxy) on the
   *  pose wrapper. Shared by the fixed-rig path in the constructor and the
   *  composed path below so the two cannot drift. */
  private buildFarMeshes(
    geo: THREE.BufferGeometry,
    mats: THREE.Material[],
    shadowGeo: THREE.BufferGeometry | null = geo,
  ): void {
    const wrap = new THREE.Group();
    wrap.name = 'character_far_wrap';
    this.farWrap = wrap;
    this.farMesh = new THREE.Mesh(geo, mats);
    this.farMaterials = this.farMesh.material;
    this.farMesh.name = 'character_far_mesh';
    this.farMesh.visible = false;
    wrap.add(this.farMesh);
    if (GFX.tier !== 'low' && shadowGeo) {
      this.shadowProxy = new THREE.Mesh(shadowGeo, shadowOnlyMat());
      this.shadowProxy.name = 'character_shadow_proxy';
      this.shadowProxy.castShadow = true;
      this.shadowProxy.visible = false;
      wrap.add(this.shadowProxy);
    }
    this.poseWrap.add(wrap);
  }

  /** Hang a WOC key's shadow stand-in on the pose wrapper, hidden until the shadow plan
   *  wants a proxy this body's own far bake cannot cast (syncShadowProxyVisibility). A
   *  mesh over the key's shared geometry and the shared shadow-only material: nothing to
   *  derive, nothing to free. */
  private mountShadowStandIn(geo: THREE.BufferGeometry): void {
    const standIn = new THREE.Mesh(geo, shadowOnlyMat());
    standIn.name = 'character_shadow_stand_in';
    standIn.castShadow = true;
    standIn.visible = false;
    this.shadowStandIn = standIn;
    this.poseWrap.add(standIn);
  }

  /** Bake (or reuse) this composed body's far LOD. Leaves farMesh null if the
   *  look bakes to nothing, in which case the character simply keeps its
   *  articulated model at distance (correct, just not as cheap). Under its own
   *  view-lane kind in the CPU build ledger: it runs from a far crossing or a unit of
   *  the work queue, never inside a view build. */
  private buildComposedFar(): void {
    const started = performance.now();
    try {
      this.mintComposedFar();
    } finally {
      recordBuildSpan(
        this.wocFarParts ? WOC_FAR_MOUNT_SPAN : 'view:composed-far-bake',
        performance.now() - started,
        started,
      );
    }
  }

  private mintComposedFar(): void {
    this.farBakeTried = true;
    if (this.wocFarParts) {
      this.wocFarLease = retainWocFarBake(
        this.key,
        this.wocFarParts,
        this.wocFarFiles,
        this.wocFarHead,
        this.wocFarKey ?? undefined,
      );
    }
    const woc = this.wocFarLease?.bake;
    const composed = this.look ? modularFarBake(this.key, this.look) : null;
    const bake = woc ?? composed;
    if (!bake) return;
    const prep = prepareVisual(this.key);
    const mats = tintedFarMaterials(
      prep.def,
      this.entityColor,
      woc ? woc.mats : composed ? farSourceMaterials(this.model, composed.slots) : [],
      bake.isBody,
      this.bodyAtlasTexture(),
      skinEmissiveTexture(this.key, this.skinIndex),
      // Claimed like the fixed-rig far materials, so the tinted cache
      // refcounts a composed body's far tints too. Nothing to release first:
      // the constructor builds no far mesh for a composed body (this is the
      // lazy path), so the claim set is empty until here.
      this.tintedFarClaims,
    );
    this.buildFarMeshes(bake.geo, this.wocFarTinted(mats, woc), woc ? woc.shadowGeo : bake.geo);
    // This mesh is minted lazily, on the first crossing into the far band, so
    // any effect state (ghost, soul rend, shadowform, moonkin, metamorph, rune
    // tint) that edged on before that crossing never touched it: every setter
    // that writes an overlay onto farMesh early-returns on no state change, and
    // this is the only place a fresh farMesh comes from outside the constructor.
    // Catch it up now, on the same material set the rig itself is already wearing.
    this.applyVisualMaterials();
    // The far clones of a ghosted / stealthed body would otherwise STAGE behind
    // the effect gate while the mint gate below reveals the far mesh on its own
    // settle: an opaque baked body for a stealther until the swap lands. The
    // far mesh is hidden by the mint gate anyway, so mount its effect clones
    // now and let them link inside that gate; deferral buys nothing here.
    if (this.farMesh && this.farMaterials) {
      this.farMesh.material = this.effectMaterial(this.farMaterials);
    }
    // Brand-new programs (the near body's minus the skinning bit, plus the
    // proxy's depth arm): link them hidden, the rig standing in until then.
    // The reveal itself is the caller's syncFarVisibility, since the shadow
    // proxy also answers to the renderer's per-frame plan (setProxyShadow),
    // which already ran this frame against a null proxy.
    this.gateFarMint();
  }

  /** A WOC far set wearing this body's head tints (woc_far_tint.ts): the bake's
   *  tinted groups on this character's wrapped clones, at its current colours and
   *  the strength its body atlas gives the body's skin layer. */
  private wocFarTinted(mats: THREE.Material[], bake: WocFarBake | undefined): THREE.Material[] {
    if (!bake) return mats;
    // a WOC bake's materials are its groups, then one per head slot (read for its
    // surface, never drawn): only the groups ever reach the mesh
    return this.wocFarTint && this.wocHead
      ? this.wocFarTint.wrap(mats, bake.tints, this.wocHead.look.colors, this.wocBodyAtlas())
      : mats.slice(0, bake.tints.length);
  }

  /** Actual shown body, after the far-mesh compile/reveal gate has settled. */
  get displayedFarBody(): THREE.Object3D | null {
    return this.farMesh?.visible ? this.farMesh : null;
  }

  get isFar(): boolean {
    return this.far;
  }

  setGhost(on: boolean, style: GhostStyle = 'spirit'): void {
    if (on === this.ghosted && style === this.ghostStyle) return;
    this.ghosted = on;
    this.ghostStyle = style;
    this.syncFormAdornments();
    this.applyVisualMaterials();
  }

  /** Ability VFX body glow (buff/cast rim): tint the rig's emissive toward the
   *  spec color at the given intensity (0 restores the shared originals). The
   *  material swap runs only on the off/on edge; while on, per-frame calls just
   *  rewrite emissive on this visual's private clones. Death and shapeshift
   *  treatments keep priority over the glow. */
  setAuraGlow(colorHex: number, intensity: number): void {
    const on = intensity > 0.01;
    const wasOn = this.auraGlowIntensity > 0.01;
    this.auraGlowColor = colorHex;
    this.auraGlowIntensity = intensity;
    if (on !== wasOn) this.applyVisualMaterials();
    if (!on) return;
    for (const glow of this.auraGlowMaterials.values()) this.writeAuraGlow(glow);
  }
  respondToElement(school: string, strength = 0.75, contact?: MeleeImpactProfile): void {
    if (this.disposed || this.deadLock) return;
    if (this.surfaceResponse.trigger(school, strength, contact)) this.applyVisualMaterials();
  }
  clearElementResponse(): void {
    this.harvestRecoil.clear();
    this.warriorBody.clearContactRecoil();
    const active = this.surfaceResponse.active;
    this.surfaceResponse.clear();
    if (active && !this.disposed) this.applyVisualMaterials();
  }
  receiveHarvestImpact(beat: number, source?: { x: number; z: number }): void {
    if (!this.disposed && !this.deadLock)
      this.harvestRecoil.trigger(beat, this.height, this.root, source);
  }

  receiveWarriorImpact(id: string, beat: number, source?: { x: number; z: number }): void {
    if (!this.disposed && !this.deadLock)
      this.warriorBody.triggerContactRecoil(id, beat, this.height, this.root, source);
  }

  private writeAuraGlow(material: THREE.Material): void {
    const m = material as THREE.Material & { emissive?: THREE.Color; emissiveIntensity?: number };
    if (!m.emissive) return;
    m.emissive.setHex(this.auraGlowColor);
    // the gallery cap: the rim accents the body, never repaints it
    m.emissiveIntensity = Math.min(0.85, this.auraGlowIntensity);
  }

  private auraGlowMaterial(material: THREE.Material): THREE.Material {
    if ((material as THREE.Material & { emissive?: THREE.Color }).emissive === undefined)
      return material; // no emissive channel (low-tier basic materials): no glow
    const cached = this.auraGlowMaterials.get(material);
    if (cached) {
      this.writeAuraGlow(cached);
      return cached;
    }
    // Program-preserving clone: a bare clone() drops the source's
    // onBeforeCompile layers, so it both renders un-patched and links a fresh
    // program on its first draw (material_clone_hooks.ts). That first draw is
    // the first spec'd hit on this rig, i.e. mid-combat for every mob.
    const glow = cloneMaterialWithHooks(material);
    this.writeAuraGlow(glow);
    this.auraGlowMaterials.set(material, glow);
    return glow;
  }

  setSoulRend(on: boolean): void {
    if (on === this.soulRend) return;
    this.soulRend = on;
    this.applyVisualMaterials();
  }

  /** The Soul Rend clones this body will need, built without flipping the mark
   *  (no `soulRend` flag, no material application): the encounter prewarm only
   *  wants the program linked. Selection lives in `soul_rend_prewarm_core`; the
   *  disposed arm matters because the queue defers this past the frame that
   *  built the view. */
  prewarmSoulRendSlots(): Array<{
    source: THREE.Mesh;
    overlay: THREE.Material | THREE.Material[];
  }> {
    return (
      soulRendPrewarmTargets<THREE.Mesh, THREE.Material>({
        originalMaterials: this.originalMaterials,
        farMesh: this.farMesh,
        farMaterials: this.farMaterials,
        disposed: this.disposed,
      })
        // the mark is translucent, and a merged head or kit goes back to its pieces under one
        .filter(({ source }) => !source.userData.wocHeadMerged && !source.userData.wocArmorMerged)
        .map(({ source, original }) => ({
          source,
          overlay: Array.isArray(original)
            ? original.map((material) => this.soulRendMaterial(material))
            : this.soulRendMaterial(original),
        }))
    );
  }

  /** Scale only the drawn pose. The click proxy remains at its authoritative size. */
  setPresentationScale(scale: number): void {
    const next = Number.isFinite(scale) ? Math.min(1.2, Math.max(1, scale)) : 1;
    if (next === this.presentationScale) return;
    this.presentationScale = next;
    this.poseWrap.scale.setScalar(next * this.bodyScale);
  }

  /** A WOC player's chosen body size (ModularAppearance.bodyScale, clamped to
   *  WOC_BODY_SCALE_RANGE): the drawn body scales uniformly about its feet on
   *  the pose wrap, so the far mesh and shadow proxy (wrap children) follow,
   *  and `height` follows, so the nameplate and every overhead anchor sit on
   *  the drawn head, shorter or taller. Presentation only: the pick capsule (a
   *  root child) and the sim keep the authored size either way, so targeting is
   *  the same for every body size, and a mount (its own visual) never scales, only
   *  its rider. A no-op on every other rig (a Combat Mech, a form, a mob) and
   *  on a repeat, so the renderer calls it every frame. True when it changed. */
  setBodyScale(scale: number): boolean {
    if (!this.def.wocCharacter || this.disposed) return false;
    const next = clampWocBodyScale(scale);
    if (next === this.bodyScale) return false;
    this.bodyScale = next;
    this.poseWrap.scale.setScalar(this.presentationScale * next);
    // each cull sphere lives in its mesh's own space: re-derive it for the body
    // now drawn, so its padding stays the cull core's rather than scaling too
    for (const mesh of this.casters) {
      const skinned = mesh as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh) applySkinnedCullBounds(skinned, this.root, this.height);
    }
    return true;
  }

  setFerocityStage(stage: number): void {
    const next = Number.isFinite(stage) ? Math.min(3, Math.max(0, Math.trunc(stage))) : 0;
    if (next === this.ferocityStage) return;
    this.ferocityStage = next;
    this.applyVisualMaterials();
  }

  setShadowform(on: boolean): void {
    if (on === this.shadowform) return;
    this.shadowform = on;
    this.syncFormAdornments();
    this.applyVisualMaterials();
  }

  setMoonkin(on: boolean): void {
    if (on === this.moonkin) return;
    this.moonkin = on;
    this.syncFormAdornments();
    this.applyVisualMaterials();
  }

  private syncFormAdornments(): void {
    if (this.disposed || (!this.formAdornments && !this.moonkin && !this.shadowform)) return;
    this.formAdornments ??= new FormAdornments(
      this.model,
      this.look ? 'composed' : this.key === 'player_mech' ? 'replacement' : 'classRig',
      () => this.farBakeGate,
    );
    this.formAdornments.sync(this.moonkin, this.shadowform, this.ghosted);
  }

  pulseMetamorphosis(strength = 1): void {
    this.metamorphPulse = Math.max(this.metamorphPulse, 0.24 + strength * 0.12);
  }

  metamorphHandWorldPositions(left: THREE.Vector3, right: THREE.Vector3): boolean {
    if (!this.root.visible || this.far || !this.metamorphLeftHand || !this.metamorphRightHand) {
      return false;
    }
    const owner = this.root.parent;
    if (owner && (!owner.visible || !owner.matrixWorldAutoUpdate)) return false;
    owner?.updateWorldMatrix(true, false);
    this.metamorphLeftHand.updateWorldMatrix(true, false);
    this.metamorphRightHand.updateWorldMatrix(true, false);
    this.metamorphLeftHand.getWorldPosition(left);
    this.metamorphRightHand.getWorldPosition(right);
    return true;
  }

  setAscended(on: boolean): void {
    if (on === this.ascended) return;
    this.ascended = on;
    this.applyVisualMaterials();
  }

  /**
   * Turn the rig to stone (the Barrowstone Heart's statue): every material leans hard to
   * weathered grey granite and the pose freezes where it stood. Cosmetic only; the sim's
   * stasis aura is what holds the body. Clones keep their source's program (no link).
   */
  setPetrified(on: boolean): void {
    if (on === this.petrified) return;
    this.petrified = on;
    this.applyVisualMaterials();
  }

  /** The manifest key this rig was built from (a shared form slot compares it). */
  get assetKey(): string {
    return this.key;
  }

  get isPetrified(): boolean {
    return this.petrified;
  }

  private petrifiedMaterial(material: THREE.Material): THREE.Material {
    const cached = this.petrifiedMaterials.get(material);
    if (cached) return cached;
    const stone = cloneMaterialWithHooks(material);
    const m = stone as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
      roughness?: number;
      metalness?: number;
    };
    // Take the hue away without a new shader program: the lit term is dimmed to a grey
    // multiplier (a painted texture keeps only its value pattern, so the statue still
    // reads as THIS body) and a flat granite grey rides the emissive term on top, which
    // washes out whatever hue the texture still carries. A touch of green lichen.
    if (m.color) {
      const lum = m.color.r * 0.3 + m.color.g * 0.55 + m.color.b * 0.15;
      m.color.setRGB(0.32 + lum * 0.1, 0.33 + lum * 0.1, 0.31 + lum * 0.08);
    }
    if (m.emissive) {
      m.emissive.setRGB(0.1, 0.105, 0.095);
      m.emissiveIntensity = 1;
    }
    if (m.roughness !== undefined) m.roughness = 1;
    if (m.metalness !== undefined) m.metalness = 0;
    this.petrifiedMaterials.set(material, stone);
    return stone;
  }

  /** Slight whole-body color lean while a Thornhollow Fields rune buff rides (null = off). */
  setRuneTint(color: number | null): void {
    if (color === this.runeTint) return;
    this.runeTint = color;
    this.applyVisualMaterials();
  }

  /** Mount the material set the current effect state asks for. This is the
   *  synchronous half; applyVisualMaterials decides whether it runs now or
   *  after a compile gate settles. */
  private commitVisualMaterials(): void {
    for (const [mesh, original] of this.originalMaterials) {
      mesh.material = this.effectMaterial(original);
      // Re-evaluated against what is ACTUALLY mounted, not against the
      // pre-effect material applyMaterials saw. attachSharedDepthMaterials
      // excludes any caster whose material would make three's getDepthMaterial
      // write a non-default alphaTest, because alternating values on a SHARED
      // depth material bump its version per draw, which is the exact rebuild
      // that module exists to remove, on a material every caster of that shape
      // is pointed at. No effect material sets alphaTest today, so leaving the
      // attach at applyMaterials happened to be correct; this makes it correct
      // by construction rather than by luck.
      attachSharedDepthMaterials(mesh, mesh.material);
    }
    if (this.farMesh && this.farMaterials) {
      this.farMesh.material = this.effectMaterial(this.farMaterials);
    }
    // a head or a kit merged into few draws goes back to its pieces under a translucent
    // effect
    this.wocHead?.effectsChanged();
    this.wocArmor?.effectsChanged();
  }

  /**
   * An overlay that flips `transparent` is a NEW program per rig material
   * (three keys `opaque`), and swapping it onto a visible rig links it on the
   * next draw: the 4808 ms `paladin_metallic` stall of the 2026-08-17 crowd
   * capture. So the first time a given clone set is mounted, the rig keeps
   * drawing its current materials and the clones compile hidden on a scratch
   * mesh set, exactly the shape stageFarMaterials uses for a re-skin.
   *
   * The body is NEVER hidden by this: it is a deferred SWAP, not a gate on the
   * entity. Stealth or a shapeshift tint reading a few frames late is the whole
   * cost, and it is paid once per clone set: the second toggle is immediate.
   */
  private applyVisualMaterials(): void {
    // A newer effect supersedes anything still linking (a stale settle must
    // never commit over a state the visual has already left).
    this.dropPendingEffectSwap();
    const staged = this.collectUnlinkedEffectMaterials();
    if (staged.length === 0) {
      this.commitVisualMaterials();
      return;
    }
    this.stageEffectSwap(staged);
  }

  /**
   * The clone/source-mesh pairs this effect state would mount whose program is
   * not known linked yet. Transparency and the marked surface-response shader
   * qualify. The other overlays (ferocity, ascension, rune tint, aura glow) keep the source's
   * program cache key through cloneMaterialWithHooks, so it costs no link and
   * must not be delayed. Empty without a gate, which keeps previews, tests and
   * hosts with no async compile on the immediate path.
   */
  private collectUnlinkedEffectMaterials(): {
    source: THREE.Mesh;
    material: THREE.Material;
  }[] {
    const staged: { source: THREE.Mesh; material: THREE.Material }[] = [];
    if (!this.farBakeGate) return staged;
    // Nythraxis' Soul Rend mark is ACTIONABLE raid information (the marked
    // player has to see it to react), so it is exempt from the deferral and
    // swaps in on the frame it lands, whatever the link state
    // (docs/design/graphics-settings-fairness.md). Its one-time link is the
    // accepted cost, and the encounter prewarm (soulRendPrewarmTargets) is
    // what usually pays it before the first mark.
    if (this.soulRend) return staged;
    const consider = (mesh: THREE.Mesh | null, source: THREE.Material): void => {
      if (!mesh?.geometry) return;
      const next = this.effectSingleMaterial(source);
      // a merged head or kit goes back to its pieces under a translucent effect
      // (effectsChanged): its clone would link and never draw
      if (next.transparent && (mesh.userData.wocHeadMerged || mesh.userData.wocArmorMerged)) {
        return;
      }
      if (
        next === source ||
        (next.transparent === source.transparent && !next.userData[SURFACE_RESPONSE_PROGRAM])
      )
        return;
      if (this.linkedEffectMaterials.has(next)) return;
      staged.push({ source: mesh, material: next });
    };
    for (const [mesh, original] of this.originalMaterials) {
      for (const source of Array.isArray(original) ? original : [original]) {
        consider(mesh, source);
      }
    }
    if (this.farMesh && this.farMaterials) {
      const farMats = this.farMaterials;
      for (const source of Array.isArray(farMats) ? farMats : [farMats]) {
        consider(this.farMesh, source);
      }
    }
    return staged;
  }

  /** Compile the staged clones hidden, on meshes carrying the same geometry and
   *  skinning as the rig so three keys the same programs, and let update()
   *  commit the swap once the gate settles. */
  private stageEffectSwap(
    staged: readonly { source: THREE.Mesh; material: THREE.Material }[],
  ): void {
    const gate = this.farBakeGate;
    if (!gate) {
      this.commitVisualMaterials();
      return;
    }
    const scratch = new THREE.Group();
    scratch.name = 'character_effect_compile_scratch';
    scratch.visible = false;
    for (const entry of staged) {
      // Mirror the SOURCE mesh's kind: three keys `skinning` on isSkinnedMesh,
      // so a SkinnedMesh twin of a plain source (an attached weapon, the class
      // halo, the baked far mesh) links a variant the real draw never binds and
      // the commit frame pays the synchronous link anyway. The shadow flags ride
      // along for the same reason on the depth arm.
      const source = entry.source;
      const mesh = (source as THREE.SkinnedMesh).isSkinnedMesh
        ? new THREE.SkinnedMesh(source.geometry, entry.material)
        : new THREE.Mesh(source.geometry, entry.material);
      mesh.castShadow = source.castShadow;
      mesh.receiveShadow = source.receiveShadow;
      mesh.visible = false;
      mesh.frustumCulled = false;
      scratch.add(mesh);
    }
    this.effectSwapScratch = scratch;
    this.poseWrap.add(scratch);
    try {
      gate(scratch, () => {
        if (this.disposed || this.effectSwapScratch !== scratch) return;
        this.effectSwapSettled = true;
      });
    } catch (err) {
      // A gate that rejects outright leaves the rig on its current, linked
      // materials rather than throwing out of a material sweep; the next state
      // change retries. Dev channel on purpose.
      console.warn('character effect compile gate rejected', err);
      this.dropPendingEffectSwap();
    }
  }

  /** Take the settled clone set live, and remember it as linked so every later
   *  toggle of that effect swaps immediately. */
  private commitPendingEffectSwap(): void {
    this.effectSwapSettled = false;
    const scratch = this.effectSwapScratch;
    if (!scratch) return;
    this.recordLinkedEffectMaterials(scratch);
    this.dropPendingEffectSwap();
    this.commitVisualMaterials();
  }

  /** A settled scratch set's programs ARE compiled, whether or not the swap
   *  reached its commit frame, so record them: without this a set superseded
   *  after its gate settled (stealth chained into a shapeshift) re-stages and
   *  re-queues a compile-lane slot on every later toggle, forever. */
  private recordLinkedEffectMaterials(scratch: THREE.Group): void {
    for (const child of scratch.children) {
      const mats = (child as THREE.Mesh).material;
      for (const material of Array.isArray(mats) ? mats : [mats]) {
        this.linkedEffectMaterials.add(material);
      }
    }
  }

  /** Detach a scratch set without disposing anything: its materials ARE the
   *  live clones the effect caches own, so a set that already settled stays
   *  recorded as linked. `keepLinked = false` is for the paths that dispose
   *  those clones on the way out (skin rebuild, teardown). */
  private dropPendingEffectSwap(keepLinked = true): void {
    const scratch = this.effectSwapScratch;
    if (scratch && keepLinked && this.effectSwapSettled) {
      this.recordLinkedEffectMaterials(scratch);
    }
    this.effectSwapSettled = false;
    if (!scratch) return;
    scratch.removeFromParent();
    scratch.clear();
    this.effectSwapScratch = null;
  }

  /** Re-tint this visual for a new owner entity (pooled reuse across per-instance
   *  colors: rift spawns jitter mob.color per instance, so the reuse-pool key is
   *  per-template and color is applied at acquire time; see
   *  characters/visual_pool.ts). Runs the same shared-material sweep setSkin
   *  does, so the reused visual picks the exact tinted-material clones a fresh
   *  construction with this color would, re-snapshots the ghost/restore map, and
   *  re-applies any active overlay. No-op when the color already matches; a def
   *  that ignores entity color (fixed or absent tint) only records the new
   *  color, because no material reads it. */
  setEntityColor(color: number): void {
    if (color === this.entityColor) return;
    this.entityColor = color;
    if (this.def.tint !== 'entity') return;
    this.applySkinMaterials(this.skinIndex);
  }

  /** Swap the body skin (alternate texture atlas) at runtime; no-op if unchanged.
   *  Reuses the shared skin-keyed material cache, so this is a cheap reassign. */
  setSkin(skinIndex: number): void {
    if (skinIndex === this.skinIndex) return;
    this.skinIndex = skinIndex;
    this.applySkinMaterials(skinIndex);
    // If the alternate atlas for this skin has not finished loading yet,
    // skinTexture() returned null and the body is showing the embedded default.
    // Load it on demand and re-apply once it arrives, but only if this is still
    // the requested skin (a newer setSkin must win). Without this, a freshly
    // selected skin stayed on the default until a relog warmed the atlas cache.
    const pending = ensureSkinTexture(this.key, skinIndex);
    if (pending) {
      void pending
        .then(() => {
          // Bail if the model was disposed while the atlas was loading, applying
          // materials to a torn-down model is wasted work (and re-snapshots a stale
          // material map). Also guard that this is still the requested skin.
          if (!this.disposed && this.skinIndex === skinIndex) this.applySkinMaterials(skinIndex);
        })
        .catch((err) => console.error('failed to load skin atlas:', err));
    }
  }

  private applySkinMaterials(skinIndex: number): void {
    // Full-rig sweep: claim the new material set into a fresh lease BEFORE
    // releasing the old one, so a key kept across the swap (same source, same
    // tint) never dips to zero claims and can never be evicted mid-swap. Old
    // keys nothing re-claimed (a previous entity color's tints, a previous
    // skin's atlas variants) go idle and age out of the shared cache.
    const prevRigClaims = this.tintedRigClaims;
    this.tintedRigClaims = new Set();
    applyMaterials(
      this.model,
      this.def,
      this.entityColor,
      this.bodyAtlasTexture(),
      skinEmissiveTexture(this.key, skinIndex),
      this.tintedRigClaims,
    );
    // the WOC head's tint wrap over the re-derived sources, before the snapshot: the
    // body's skin layer is off under a class under-armor atlas (no skin on it)
    this.wocHead?.retint(this.wocBodyAtlas(), true);
    releaseTintedMaterials(prevRigClaims);
    // The per-effect clone maps (ghost/soul-rend/shadowform/moonkin/
    // metamorph/rune-tint/aura-glow) key by SOURCE material, and this sweep
    // just swapped every source (a new entity color or skin atlas), so
    // clones derived from the old sources are unreachable from here on.
    // Dispose them now, in the same synchronous pass that unmounts them (no
    // render in between, the rune-chain precedent); the applyVisualMaterials
    // call below re-derives any active overlay from the new sources, so a
    // live effect survives the swap. Without this, a pooled visual
    // accumulated one clone set per rift color worn (the maps only emptied
    // in dispose()).
    this.disposeEffectMaterials();
    // re-snapshot the material map ghost/restore relies on, then re-ghost if stealthed
    this.originalMaterials.clear();
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      // VFX rig meshes stay out of the ghost/restore cycle: their shader
      // materials are owned by the weapon-skin handle, never overlaid.
      if (!mesh.isMesh || mesh.userData.weaponVfxMesh) return;
      // applyMaterials skips the halo, so mid-overlay its live material is
      // the overlay clone; snapshot the build-time handle instead
      const original =
        mesh.name === 'class_halo' ? (this.haloBaseMaterial ?? mesh.material) : mesh.material;
      this.originalMaterials.set(mesh, original);
    });
    // The far LOD mesh is a separate baked geometry (see the constructor):
    // it needs its own skin-aware material rebuild or a distant player LOD
    // pop reverts to the model's embedded default skin. A composed body rebuilds
    // from ITS bake, not the key's DEFAULT_LOOK one.
    if (this.farMesh) {
      const prep = prepareVisual(this.key);
      const composed = this.look ? modularFarBake(this.key, this.look) : null;
      const woc = this.wocFarLease?.bake;
      const claims: TintedMaterialClaims = new Set();
      const mats = tintedFarMaterials(
        this.def,
        this.entityColor,
        woc
          ? woc.mats
          : composed
            ? farSourceMaterials(this.model, composed.slots)
            : prep.idleSrcMats,
        woc ? woc.isBody : composed ? composed.isBody : prep.idleSrcIsBody,
        this.bodyAtlasTexture(),
        skinEmissiveTexture(this.key, skinIndex),
        claims,
      );
      this.stageFarMaterials(this.wocFarTinted(mats, woc), claims);
    }
    this.applyVisualMaterials();
  }

  /** Take a rebuilt far material set live: claim the new lease, release the
   *  old one AFTER (a key kept across the swap never dips to zero claims). */
  private commitFarMaterials(mats: THREE.Material[], claims: TintedMaterialClaims): void {
    const prevFarClaims = this.tintedFarClaims;
    this.tintedFarClaims = claims;
    this.farMaterials = mats;
    releaseTintedMaterials(prevFarClaims);
  }

  /** A re-skinned far set is new programs too (an emissive atlas toggles a
   *  define). Behind a gate it links hidden on a scratch mesh while the far
   *  mesh keeps drawing its current, linked set, and swaps in on settle: no
   *  hole and no LOD pop for a distant player who changes skin. A newer skin
   *  before settle supersedes the one in flight. */
  private stageFarMaterials(mats: THREE.Material[], claims: TintedMaterialClaims): void {
    const farMesh = this.farMesh;
    const wrap = this.farWrap;
    // A newer set supersedes one still linking on either path (a stale settle
    // must never commit over a set that already landed).
    this.dropPendingFarMaterials();
    if (!this.farBakeGate || !farMesh || !wrap) {
      this.commitFarMaterials(mats, claims);
      return;
    }
    // The far mesh draws effectMaterial(farMaterials), the overlay clones when
    // a ghost/soul-rend/rune tint is on, and a clone is a different program
    // key: gate the set the mesh will actually wear (the mint path applies
    // its overlays before gating for the same reason).
    const scratch = new THREE.Mesh(farMesh.geometry, this.effectMaterial(mats));
    scratch.name = 'character_far_skin_scratch';
    scratch.visible = false;
    scratch.castShadow = farMesh.castShadow;
    scratch.receiveShadow = farMesh.receiveShadow;
    this.farSkinScratch = scratch;
    this.pendingFarClaims = claims;
    wrap.add(scratch);
    this.farBakeGate(scratch, () => {
      if (this.disposed || this.farSkinScratch !== scratch) return;
      // Unlike the mint's reveal (see setFar), this settle may land between
      // frames: it swaps materials on a mesh and detaches a hidden node, and
      // neither changes an ancestor's visibility or three's counted light set.
      this.farSkinScratch = null;
      this.pendingFarClaims = null;
      scratch.removeFromParent();
      this.commitFarMaterials(mats, claims);
      this.applyVisualMaterials();
    });
  }

  private dropPendingFarMaterials(): void {
    if (this.farSkinScratch) {
      this.farSkinScratch.removeFromParent();
      this.farSkinScratch = null;
    }
    if (this.pendingFarClaims) {
      releaseTintedMaterials(this.pendingFarClaims);
      this.pendingFarClaims = null;
    }
  }

  /** Swap the held mainhand weapon model at runtime (gear equip/unequip); no-op if
   *  unchanged or if this class keeps a fixed weapon (hunter crossbow, mobs/NPCs,    *  no VisualDef.weaponSlot). Mirrors setSkin: re-attach the prop, re-run the
   *  shared material pass, re-snapshot the original-material map, then re-apply any
   *  active ghost/soul-rend overlay. Cheap (one prop clone) and keeps the mixer/
   *  animation state, unlike a full visual rebuild. Returns the newly attached
   *  payload(s) (for the caller's compile gate), or null on a no-op. */
  setWeapon(weaponItemId: string | null): THREE.Object3D[] | null {
    if (weaponItemId === this.weaponItemId) return null;
    const ownPropsShown = fixedHandPropsShown(this.bareWhenUnarmed, this.weaponItemId);
    this.weaponItemId = weaponItemId;
    this.refreshLoadout();
    // Arming or disarming a body that follows real equipment shows or hides its own hand
    // props too (the hunter's crossbow, the warlock's book), which no slot swap reaches.
    if (ownPropsShown !== fixedHandPropsShown(this.bareWhenUnarmed, weaponItemId)) {
      return this.reattachAllHeld();
    }
    if (!this.def.weaponSlots?.length) return null;
    return this.reattachHeldWeapon();
  }

  /** Swap the actual offhand. When neither the old nor the new offhand mirrors the
   *  active weapon skin, this is the lean path that never disturbs the mainhand
   *  cosmetic pipeline (its rarity VFX keep running). When the offhand crosses into,
   *  out of, or between skin-mirrored states (a matching-type weapon), it
   *  routes through the full re-attach so the offhand gains or loses the skin model
   *  and its rarity VFX in step with the mainhand. Returns the newly attached
   *  payload(s) (for the caller's compile gate), or null on a no-op. */
  setOffhand(offhandItemId: string | null): THREE.Object3D[] | null {
    if (offhandItemId === this.offhandItemId) return null;
    if (this.def.offhandSlot === undefined) {
      this.offhandItemId = offhandItemId;
      this.refreshLoadout();
      return null;
    }
    const wasMirrored = offhandMirrorsWeaponSkin(this.weaponSkinId, this.offhandItemId);
    this.offhandItemId = offhandItemId;
    this.refreshLoadout();
    const nowMirrored = offhandMirrorsWeaponSkin(this.weaponSkinId, this.offhandItemId);
    if (wasMirrored || nowMirrored) {
      return this.reattachHeldWeapon();
    }
    const payloads = setHeldOffhand(
      this.model,
      this.def,
      offhandItemId,
      this.weaponSkinId,
      this.stow.attached,
    );
    this.actionProps?.refresh();
    this.weaponProps = heldPropHolders(this.model);
    for (const payload of payloads) {
      configureTightBoneTextures(payload);
      // Payload-subtree sweep: claim ADDITIVELY into the live rig lease (the
      // rest of the rig keeps its mounts). Keys of the removed offhand's
      // materials overstay in the lease until the next full sweep or dispose;
      // an overstay only pins, it can never dispose a mounted material.
      applyMaterials(
        payload,
        this.def,
        this.entityColor,
        skinTexture(this.key, this.skinIndex),
        skinEmissiveTexture(this.key, this.skinIndex),
        this.tintedRigClaims,
      );
    }
    this.rebuildCasters();
    this.applyVisualMaterials();
    if (this.weaponAuraSanguine) this.rebuildWeaponAura();
    return payloads;
  }

  /** Apply or clear a Season 1 Armory weapon-skin cosmetic: the skin's model
   *  replaces the held weapon (all swap slots, or the hunter's fixed ranged
   *  attach) and its rarity VFX ride the new payloads. Null restores the
   *  equipped item's own model. Returns the newly attached payload(s) (for the
   *  caller's compile gate), or null on a no-op. */
  setWeaponSkin(weaponSkinId: string | null): THREE.Object3D[] | null {
    if (weaponSkinId === this.weaponSkinId) return null;
    this.weaponSkinId = weaponSkinId;
    const payloads = this.reattachHeldWeapon();
    // The CAST pose depends on the displayed skin (a drawn bow holds its draw),
    // but the base action is only re-selected on a base-state EDGE. A skin
    // applied or removed mid-cast does not edge the state, so without this the
    // rig keeps Spellcasting after equipping the bow, or keeps Bow_Draw_Hold
    // after removing it, for the rest of the cast. Reported by review on 2950.
    if (!this.deadLock && !this.currentIsOneShot && this.baseState === 'cast') {
      const next = this.baseAction();
      if (next && next !== this.current) this.fadeTo(next, FADE, false);
    }
    return payloads;
  }

  /** Rebuild the current weapon-skin attachments after its on-demand GLB
   *  arrives. The logical skin id stays unchanged; only its fail-soft base
   *  weapon payload is replaced. */
  refreshWeaponSkin(): THREE.Object3D[] | null {
    if (!this.weaponSkinId) return null;
    return this.reattachHeldWeapon();
  }

  /** Re-attach BOTH held hands (gear swap / skin change), honoring an active
   *  sheathe so a weapon swapped while stowed lands on the back, not the hand. The
   *  offhand re-attaches with skin awareness: when the active skin mirrors onto a
   *  matching-type offhand weapon, that payload joins the skin VFX/material
   *  set; a shield, held offhand, or different-type weapon re-attaches with its own
   *  model and stays out of that set (pixel-untouched). Returns the newly attached
   *  payload(s), for the caller's compile gate. */
  private reattachHeldWeapon(): THREE.Object3D[] {
    this.disposeWeaponVfx();
    this.disposeWeaponSkinMaterials();
    const payloads = setHeldWeapon(
      this.model,
      this.def,
      this.weaponItemId,
      this.weaponSkinId,
      this.stow.attached,
      this.bareWhenUnarmed,
    );
    const offPayloads = setHeldOffhand(
      this.model,
      this.def,
      this.offhandItemId,
      this.weaponSkinId,
      this.stow.attached,
    );
    // The skin material/VFX set is exactly the hands that SHOW the skin: the
    // mainhand while it holds the skin's type (or always with no skin, so a
    // bare rig keeps its authored pass), the offhand while the skin mirrors
    // onto it. A hand left out is pixel-untouched, but its freshly attached
    // nodes must still reach the caller's compile gate: dropped from the
    // return, a re-attached shield's first draw linked its programs
    // synchronously.
    const mainhandSkinned =
      !this.weaponSkinId || mainhandShowsWeaponSkin(this.weaponSkinId, this.weaponItemId);
    const skinned = [
      ...(mainhandSkinned ? payloads : []),
      ...(offhandMirrorsWeaponSkin(this.weaponSkinId, this.offhandItemId) ? offPayloads : []),
    ];
    // A hand outside the skin set still needs its bone-texture pass (the skin
    // set gets it inside finishWeaponAttach).
    for (const payload of [...payloads, ...offPayloads]) {
      if (!skinned.includes(payload)) configureTightBoneTextures(payload);
    }
    this.finishWeaponAttach(skinned);
    return [...payloads, ...offPayloads];
  }

  /** The shared tail of every re-attach (slot swap, skin change, sheathe swap):
   *  re-pin skin orientation, re-run the material pass, re-snapshot originals,
   *  and rebuild the skin VFX on the payloads that now exist. */
  private finishWeaponAttach(payloads: THREE.Object3D[]): void {
    this.actionProps?.refresh();
    // Every mounted holder, not this call's payloads: the mainhand and the
    // offhand attach through separate calls, and the swim hide must cover both.
    this.weaponProps = heldPropHolders(this.model);
    for (const payload of payloads) configureTightBoneTextures(payload);
    // Ranged skins take a root-relative orientation pin (position always rides
    // the hand): a bow aims upright WHILE the shot one-shot plays (the string
    // hand rolls a glued bow sideways mid-draw); a bow-slot gun carries muzzle
    // forward OUTSIDE the shot (the hanging idle arm points it at the ground)
    // and keeps the hand-tuned grip during the shouldered aim
    // (applySkinOrientation each frame). A SHEATHED weapon takes no pin: its
    // pose is the on-back grip, which the pin would fight every frame.
    {
      const mode = this.stow.attached ? null : weaponSkinOrientPin(this.weaponSkinId);
      this.orientPins = mode
        ? payloads.map((payload) => ({
            payload,
            qGrip: payload.quaternion.clone(),
            blend: 0,
            duringShot: mode === 'aimDuringShot',
          }))
        : [];
    }
    // Full-rig sweep (the whole model graph, weapon meshes included): swap
    // the rig lease like applySkinMaterials does, so the removed weapon's
    // material claims release and can age out of the shared cache.
    const prevRigClaims = this.tintedRigClaims;
    this.tintedRigClaims = new Set();
    applyMaterials(
      this.model,
      this.def,
      this.entityColor,
      this.bodyAtlasTexture(),
      skinEmissiveTexture(this.key, this.skinIndex),
      this.tintedRigClaims,
    );
    releaseTintedMaterials(prevRigClaims);
    // A VFX-tier skin's emissive derive mutates its payload materials in place,
    // so give each payload exclusive clones BEFORE the caster snapshot: the
    // shared tinted-material cache must never carry derived state (two players
    // with one skin, or a rogue's two hands, would corrupt each other), and the
    // ghost/stealth snapshot below must target the clones the rig restores.
    if (this.weaponSkinVfxSpec()) {
      for (const payload of payloads) {
        payload.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          // cloneMaterialWithHooks, never a bare clone: a rig material carries
          // the silhouette rim glow (assets.ts buildTintedClone; a flat held
          // plate alone does not, and its clone must not gain one), and
          // Material.clone() drops onBeforeCompile. The bare clone therefore
          // rendered the isolated weapon WITHOUT its rim AND, since three's
          // default program cache key IS the hook source, linked a program the
          // source had already linked. See ../material_clone_hooks.ts.
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map((m) => cloneMaterialWithHooks(m))
            : cloneMaterialWithHooks(mesh.material);
          mesh.userData.weaponSkinIsolated = true;
          markOwnedWeaponSkinMaterials(mesh);
        });
      }
    }
    // the model graph changed (weapon meshes added/removed): rebuild the caster
    // list and re-snapshot originals (rebuildCasters un-applies live overlays
    // first, so a stealthed equip never bakes the ghost material in).
    this.rebuildCasters();
    this.applyVisualMaterials();
    this.buildWeaponVfx(payloads);
    this.rebuildWeaponAura();
    this.rebuildTemplarsVerdictFx();
  }

  private rebuildTemplarsVerdictFx(): void {
    this.templarsVerdictFx?.dispose();
    this.templarsVerdictFx = this.def.clips.attackByAbility?.final_edict
      ? new PaladinTemplarsVerdictFx(this.model)
      : null;
    this.templarsVerdictAction = null;
  }

  /** Hold the imbued-weapon overlay in `colorHex` (null clears it). Driven per
   *  frame by the renderer from characterWeaponAuraInto - the buff spec's
   *  weaponAura knob - so the soak lives exactly as long as the worn aura
   *  (Sanguine Blade's blood red, Pyrebrand's flame lick, Rimebound's rime).
   *  `tip` scopes the overlay to the blade's far end (Adder's Bite's green
   *  tip against Festering Venom's full-blade wash). */
  setWeaponAura(colorHex: number | null, tip = false, sanguine = false): void {
    if (
      colorHex === this.weaponAuraColor &&
      tip === this.weaponAuraTip &&
      sanguine === this.weaponAuraSanguine
    )
      return;
    this.weaponAuraSanguine = sanguine;
    this.weaponAuraColor = colorHex;
    this.weaponAuraTip = tip;
    this.rebuildWeaponAura();
  }

  /** Structural weapon/body presentation (Stonebound's stone shell + armor
   *  shards). Orthogonal to the imbue COLOR overlay above: a shaman can carry
   *  both, so they are separate channels that both feed rebuildWeaponAura. */
  setWeaponAuraMode(mode: WeaponAuraMode): void {
    if (mode === this.weaponAuraMode) return;
    this.weaponAuraMode = mode;
    this.rebuildWeaponAura();
  }

  private rebuildWeaponAura(): void {
    this.disposeWeaponAura();
    const stonebound = this.weaponAuraMode === 'stonebound';
    if (this.weaponAuraColor === null && !stonebound) return;

    const weaponHolders: THREE.Object3D[] = [];
    this.model.traverse((o) => {
      if (o.userData.swapWeaponHolder) weaponHolders.push(o);
    });

    // Structural channel: Stonebound sheathes EVERY held weapon in a stone
    // shell and plates the body with shards. Independent of the imbue color
    // channel below; Sanguine may also coat an equipped second weapon. The
    // shell is a wireframe on an antialiased frame and a solid translucent
    // sheath when no AA pass runs (stonebound_shell_core.ts).
    if (stonebound) {
      const style = stoneboundShellStyle(GFX);
      for (const holder of weaponHolders) {
        holder?.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || !mesh.userData.weaponMesh || !mesh.parent) return;
          const aura = new THREE.Mesh(
            mesh.geometry,
            new THREE.MeshBasicMaterial(
              stoneboundShellMaterialOptions({
                opacity: style.shellOpacity,
                wireframe: style.wireframe,
              }),
            ),
          );
          aura.position.copy(mesh.position);
          aura.quaternion.copy(mesh.quaternion);
          aura.scale.copy(mesh.scale).multiplyScalar(1.14);
          aura.renderOrder = 3;
          aura.userData.weaponVfxMesh = true;
          mesh.parent.add(aura);
          this.weaponAuraMeshes.push(aura);
        });
      }
      this.buildStoneboundArmorShards(style.wireframe, style.shardOpacity);
    }

    if (this.weaponAuraColor === null) return;
    const auraColor = this.weaponAuraColor;
    const mainhand = weaponHolders.find((o) => o.userData.heldSlot === 0) ?? weaponHolders[0];
    if (!mainhand) return;
    const imbuedHolders = [mainhand];
    if (
      this.weaponAuraSanguine &&
      weaponAttackStyle(this.weaponItemId, this.offhandItemId) === 'dualwield'
    ) {
      this.model.traverse((o) => {
        if (o.userData.heldPropHolder && o.userData.heldSlot === 1) imbuedHolders.push(o);
      });
    }
    for (const holder of imbuedHolders)
      holder.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.userData.weaponMesh || !mesh.parent) return;
        const tipGeometry = this.weaponAuraTip ? tipFadedWeaponGeometry(mesh, holder) : null;
        // The option tables are shared with the never-disposed boot stand-ins
        // (vfx_basic_materials.ts), which hold these programs between rebuilds.
        const aura = new THREE.Mesh(
          tipGeometry ?? mesh.geometry,
          new THREE.MeshBasicMaterial(
            weaponImbueAuraMaterialOptions(auraColor, tipGeometry !== null),
          ),
        );
        aura.position.copy(mesh.position);
        aura.quaternion.copy(mesh.quaternion);
        aura.scale.copy(mesh.scale).multiplyScalar(1.08);
        aura.renderOrder = 3;
        aura.userData.weaponVfxMesh = true;
        if (tipGeometry) aura.userData.ownsAuraGeometry = true;
        mesh.parent.add(aura);
        this.weaponAuraMeshes.push(aura);
        if (this.weaponAuraSanguine && !this.weaponAuraTip) this.sanguineSheath.stage(aura);
      });
  }

  private buildStoneboundArmorShards(wireframe: boolean, opacity: number): void {
    const placements = [
      { x: -0.42, y: this.baseHeight * 0.7, z: 0, sx: 0.2, sy: 0.13, rz: -0.35 },
      { x: 0.42, y: this.baseHeight * 0.7, z: 0, sx: 0.2, sy: 0.13, rz: 0.35 },
      { x: 0, y: this.baseHeight * 0.53, z: 0.2, sx: 0.24, sy: 0.18, rz: 0 },
    ];
    for (const placement of placements) {
      const shard = new THREE.Mesh(
        STONEBOUND_SHARD_GEOMETRY,
        new THREE.MeshBasicMaterial(stoneboundShardMaterialOptions({ opacity, wireframe })),
      );
      shard.position.set(placement.x, placement.y, placement.z);
      shard.rotation.z = placement.rz;
      shard.scale.set(placement.sx, placement.sy, 0.11);
      shard.renderOrder = 3;
      shard.userData.weaponVfxMesh = true;
      this.poseWrap.add(shard);
      this.weaponAuraMeshes.push(shard);
    }
  }

  private disposeWeaponAura(): void {
    this.sanguineSheath.clear();
    for (const mesh of this.weaponAuraMeshes) {
      mesh.removeFromParent();
      (mesh.material as THREE.Material).dispose();
      // full-blade auras share the weapon's cached geometry (never disposed);
      // tip auras own their vertex-alpha clone
      if (mesh.userData.ownsAuraGeometry) mesh.geometry.dispose();
    }
    this.weaponAuraMeshes.length = 0;
  }

  private weaponSkinVfxSpec() {
    const skin = this.weaponSkinId ? WEAPON_SKINS[this.weaponSkinId] : null;
    return skin ? (WEAPON_VFX[skin.model] ?? null) : null;
  }

  /**
   * Whether a point-light budget owns this rig's weapon-skin light.
   *
   * TRUE only in the world, where the renderer reconciles the light into its
   * fixed budget: born visible there, it would be counted for the frames before
   * the first budget pass, and that changed numPointLights relinks every
   * material drawn in them. `createCharacterVisual` sets it.
   *
   * FALSE for a rig built directly (the armoury preview, the character screen).
   * Those own their renderer and scene and have NO budget, so nothing would ever
   * turn the light back on: the skin's cast glow is the product on a cosmetics
   * surface, and it must light immediately.
   *
   * A FIELD rather than a constructor argument, so it must be set before the
   * rig attaches a weapon. That holds today because `buildWeaponVfx` is only
   * reached from `finishWeaponAttach`, which runs from async model-load
   * continuations and the runtime re-attach paths, never synchronously from the
   * constructor. A future synchronous attach in the constructor would silently
   * miss the flag; the ordering at the one world call site is pinned by
   * tests/weapon_vfx_rig_build.test.ts.
   */
  budgetedWeaponLight = false;

  /** Attach the skin's rarity VFX rig to each held payload (in-hand mode: no
   *  backdrop dome, no ground pool; emissive + particles ride the weapon). */
  private buildWeaponVfx(payloads: THREE.Object3D[]): void {
    const skin = this.weaponSkinId ? WEAPON_SKINS[this.weaponSkinId] : null;
    const spec = skin ? (WEAPON_VFX[skin.model] ?? null) : null;
    if (!skin || !spec) return;
    // The authored row is the rig's 1.0 look; the shed lever below re-derives
    // from it, so it must be kept rather than only pushed once.
    this.weaponVfxAuthored = weaponVfxTuningFor(skin.model, spec.tier);
    this.weaponVfxShed = 1;
    // A skin whose hand-tuned row mutes the light (weapon_vfx_tuning.ts
    // `light: 0`) gets no PointLight at all: built anyway it would hold one of
    // the renderer's fixed counted point-light slots away from a light that
    // actually shines, and pay a per-frame ancestor walk, while every update()
    // drove its intensity straight back to zero.
    const withLight = (this.weaponVfxAuthored.light ?? 1) > 0;
    for (const payload of payloads) {
      const handle = createWeaponVfx(payload, spec, {
        grounded: false,
        budgetedLight: this.budgetedWeaponLight,
        withLight,
      });
      handle.setBackdropVisible(false);
      handle.setTuning(this.weaponVfxAuthored);
      handle.setPixelScale(weaponVfxViewportHeight * this.weaponVfxSpriteScale);
      // Tag the rig's own scene nodes: applyMaterials must never tint its
      // ShaderMaterials and the shadow pass has no business with sprite shells.
      handle.group.traverse((o) => {
        o.userData.weaponVfxMesh = true;
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = false;
      });
      this.weaponVfx.push(handle);
    }
  }

  /** True exactly once after a deferred re-attach rebuilt the held-prop graph
   *  (the sheathe swap): the caller must re-reconcile its point lights. */
  consumeWeaponGraphDirty(): boolean {
    if (!this.weaponGraphDirty) return false;
    this.weaponGraphDirty = false;
    return true;
  }

  /** Advance the weapon-skin VFX (shader time, pulse, flicker). Cheap no-op
   *  without an active skin; the renderer calls it once per entity per frame.
   *  Also re-pins bow payload orientation (see reattachHeldWeapon).
   *
   *  `shed` is the rig-strength multiplier from `weaponVfxShedScale` (viewer
   *  distance plus the frame-budget governor's vfx lever); 1 is the authored
   *  look. It only ever DIMS; what removes a rig is the far-LOD swap below.
   *
   *  The rig's point light deliberately keeps its `visible` flag at every
   *  scale: three counts visible point lights into every lit material's program
   *  cache key, so clearing one mid-flight is the open-world recompile freeze.
   *  Dimming drives its intensity down instead, which is the look without the
   *  hazard. */
  updateWeaponVfx(dt: number, shed = 1): void {
    this.applySkinOrientation(dt);
    if (this.weaponVfx.length === 0) return;
    // A rig that the far-LOD swap has taken off screen still cost a full tick
    // of uniform writes, emissive pulse and light flicker every frame, for
    // something no pixel can show: `setFar` hides `modelWrap`, and a held
    // weapon (with its rig) hangs off a bone INSIDE it.
    //
    // Gated on the far mesh ACTUALLY standing in (farMeshShown), not on `far`
    // alone, and that is the load-bearing half: `setFar` leaves `modelWrap`
    // VISIBLE when there is no baked mesh, or one whose materials are still
    // linking behind the compile gate, while `isFar` reads true either way.
    // Skipping on `far` alone would freeze a rig that is still drawing,
    // leaving its motes hanging in the air and its light stuck at whatever
    // the last flicker wrote.
    if (farMeshShown(this.far, this.farMesh !== null, this.farCompilePending)) return;
    this.applyWeaponVfxShed(shed);
    for (const handle of this.weaponVfx) handle.update(dt);
  }

  // Write-elided: setTuning walks every part and rewrites its materials, so the
  // quantized scale is compared first and an unchanged frame costs nothing.
  private applyWeaponVfxShed(shed: number): void {
    const next = Number.isFinite(shed) ? Math.min(1, Math.max(0, shed)) : 1;
    if (next === this.weaponVfxShed) return;
    this.weaponVfxShed = next;
    scaleWeaponVfxTuning(this.weaponVfxAuthored, next, this.weaponVfxTuningScratch);
    for (const handle of this.weaponVfx) handle.setTuning(this.weaponVfxTuningScratch);
  }

  /** Blend pinned skin payloads between the authored grip glue and their
   *  root-relative pin: a bow to BOW_AIM_QUAT while the shot one-shot plays, a
   *  bow-slot gun to GUN_CARRY_QUAT everywhere BUT the shot (and never while
   *  dead: a corpse's weapon just lies with the hand). Position always follows
   *  the hand. No-op without pinned payloads. */
  /** The live one-shot's kind for the aim pin. Derived rather than stored as a
   *  third latch, so it cannot drift out of step with currentIsOneShot. */
  private currentOneShotKind(): OneShotKind {
    if (!this.currentIsOneShot) return null;
    if (this.currentOneShotIsEmote) return 'emote';
    return this.currentOneShotIsAttack ? 'attack' : 'other';
  }

  private applySkinOrientation(dt: number): void {
    if (this.orientPins.length === 0) return;
    // "Is this character shooting", asked properly: the attack one-shot (the
    // release) or an active cast (the draw of a cast-time shot). A hit react is
    // a one-shot and is NOT shooting; see rangedSkinAiming.
    const shot = rangedSkinAiming(this.currentOneShotKind(), this.castingAbility);
    const step = dt / BOW_PIN_BLEND_S;
    this.root.getWorldQuaternion(BOW_Q_ROOT);
    for (const entry of this.orientPins) {
      const parent = entry.payload.parent;
      if (!parent) continue;
      const engaged = !this.deadLock && (entry.duringShot ? shot : !shot);
      entry.blend = Math.min(1, Math.max(0, entry.blend + (engaged ? step : -step)));
      if (entry.blend === 0) {
        entry.payload.quaternion.copy(entry.qGrip);
        continue;
      }
      // pinned local = parentWorld^-1 * rootWorld * pin target
      parent.getWorldQuaternion(BOW_Q_B).invert();
      BOW_Q_TARGET.copy(BOW_Q_B)
        .multiply(BOW_Q_ROOT)
        .multiply(entry.duringShot ? BOW_AIM_QUAT : GUN_CARRY_QUAT);
      entry.payload.quaternion.copy(entry.qGrip).slerp(BOW_Q_TARGET, entry.blend);
    }
  }

  /** Re-scale VFX point sprites after a viewport/pixel-ratio change. */
  setWeaponVfxPixelScale(heightPx: number): void {
    for (const handle of this.weaponVfx) {
      handle.setPixelScale(heightPx * this.weaponVfxSpriteScale);
    }
  }

  /** Set the camera fov this visual renders under (preview rigs differ from the
   *  world camera); re-scales any live VFX sprites to match. */
  setWeaponVfxCameraFov(fovDeg: number): void {
    this.weaponVfxSpriteScale = weaponVfxSpriteScaleForFov(fovDeg);
  }

  private disposeWeaponVfx(): void {
    for (const handle of this.weaponVfx) handle.dispose();
    this.weaponVfx.length = 0;
  }

  private disposeWeaponSkinMaterials(): void {
    disposeOwnedWeaponSkinMaterials(this.model, this.originalMaterials, [
      this.ghostMaterials,
      this.soulRendMaterials,
      this.shadowformMaterials,
      this.moonkinMaterials,
      this.runeTintMaterials,
      this.petrifiedMaterials,
      this.auraGlowMaterials,
      this.surfaceResponse.materials,
    ]);
  }

  private disposeEffectMaterials(): void {
    // The scratch set wears clones this sweep is about to dispose, so they are
    // dropped WITHOUT being recorded as linked (a disposed program is not one).
    this.dropPendingEffectSwap(false);
    const materials = new Set<THREE.Material>([
      ...this.ghostMaterials.values(),
      ...this.soulRendMaterials.values(),
      ...this.shadowformMaterials.values(),
      ...this.moonkinMaterials.values(),
      ...this.ferocityMaterials.flatMap((cache) => [...cache.values()]),
      ...this.ascensionMaterials.values(),
      ...this.runeTintMaterials.values(),
      ...this.petrifiedMaterials.values(),
      ...this.auraGlowMaterials.values(),
      ...this.surfaceResponse.materials.values(),
    ]);
    for (const material of materials) material.dispose();
    this.ghostMaterials.clear();
    this.soulRendMaterials.clear();
    this.shadowformMaterials.clear();
    this.moonkinMaterials.clear();
    for (const cache of this.ferocityMaterials) cache.clear();
    this.ascensionMaterials.clear();
    this.runeTintMaterials.clear();
    this.petrifiedMaterials.clear();
    this.auraGlowMaterials.clear();
    this.surfaceResponse.materials.clear();
  }

  /** Move every held prop between the hands and the sheathed on-back pose (the
   *  Z-key stow toggle). On a live rig this plays the ClipMap `stow` arm gesture
   *  and defers the actual re-parent to the gesture's midpoint (stow_transition),
   *  so the swap lands while the hand passes the shoulder; spawn-in sync, dead
   *  rigs, and clip-less defs snap immediately instead. */
  setWeaponStowed(stowed: boolean): void {
    if (!this.def.attach?.length) {
      forceStow(this.stow, stowed);
      return;
    }
    const clip = this.def.clips.stow;
    const gesture = clip ? this.action(clip) : null;
    if (!this.initialized || this.deadLock || !gesture) {
      if (forceStow(this.stow, stowed)) this.applyStowSwap();
      return;
    }
    const whole = this.def.clips.stowPlaysWhole === true;
    const timeScale = whole ? 1 : STOW_GESTURE_TIMESCALE;
    const swapFraction = this.def.clips.stowSwapFraction ?? STOW_SWAP_FRACTION;
    const swapDelay = (gesture.getClip().duration / timeScale) * swapFraction;
    if (requestStow(this.stow, stowed, swapDelay)) {
      this.playOneShot(clip as string, timeScale);
      // Arm-raise window: peaks exactly at the swap, eases back out after it.
      // An authored sheathe already reaches the shoulder on its own.
      if (!whole) {
        this.stowLift.t = 0;
        this.stowLift.dur = swapDelay * 2;
      }
    }
  }

  /** Cut the stow gesture at its windup peak: hand back to base so the chop
   *  clip's downswing never plays (mirrors onFinished's one-shot hand-off). */
  private endStowGesture(): void {
    // An authored sheathe recovers on its own; onFinished hands back to base.
    if (this.def.clips.stowPlaysWhole) return;
    const clip = this.def.clips.stow;
    const gesture = clip ? this.action(clip) : null;
    if (!gesture || this.current !== gesture || this.deadLock) return;
    this.currentIsOneShot = false;
    this.currentOneShotIsEmote = false;
    this.fadeTo(this.baseAction(), 0.18, false);
  }

  /** The deferred half of setWeaponStowed: re-attach every held prop to the pose
   *  the transition just landed on, keeping the applied weapon skin, then run the
   *  shared re-attach tail (materials, caster snapshot, skin VFX rebuilt on the
   *  new payloads). Mixer state is untouched. */
  private applyStowSwap(): void {
    this.refreshLoadout();
    // The swap lands mid-gesture, long after the renderer's stow diff returned,
    // so the rig it rebuilds (and the skin VFX point light hanging off it) can
    // only be reconciled into the light budget on a later frame: raise an edge
    // the renderer consumes (consumeWeaponGraphDirty).
    this.weaponGraphDirty = true;
    this.reattachAllHeld();
  }

  /** Strip and re-attach EVERY held prop (both slots and the body's own hand props) for
   *  what the hands hold now and where they are carried, then run the shared re-attach
   *  tail. Returns every prop mounted afterwards, for the caller's compile gate. */
  private reattachAllHeld(): THREE.Object3D[] {
    this.disposeWeaponVfx();
    this.disposeWeaponSkinMaterials();
    const payloads = setWeaponsStowed(
      this.model,
      this.def,
      this.weaponItemId,
      this.weaponSkinId,
      this.stow.attached,
      this.offhandItemId,
      this.bareWhenUnarmed,
    );
    // The returned set is the hands that SHOW the skin (attachAllProps); a
    // hand outside it still needs its bone-texture pass, and the whole-rig
    // sweep is idempotent (skeletons already cropped are skipped).
    configureTightBoneTextures(this.model);
    this.finishWeaponAttach(payloads);
    return heldPropHolders(this.model);
  }

  /** Rebuild the shadow-caster list and original-material snapshot after the model
   *  graph changes (a weapon swap adds/removes bone-child meshes). */
  private rebuildCasters(): void {
    // Un-apply any live effect overlay (ghost, soul rend, tints) BEFORE the
    // snapshot: equipping a weapon while stealthed otherwise captures the
    // ghost clone as a mesh's "original", and the character stays translucent
    // forever after leaving stealth (owner playtest: /dev bis inside
    // Duskveil). Restore from the pre-rebuild map first, then recapture.
    for (const [mesh, original] of this.originalMaterials) mesh.material = original;
    this.originalMaterials.clear();
    this.casters.length = 0;
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.weaponVfxMesh) return;
      const castsShadow = characterMeshCastsShadow(mesh);
      if (!castsShadow) {
        // unlit additive FX quad: never a shadow caster, but its material must
        // stay in the snapshot so ghost/stealth swaps restore it; snapshot the
        // build-time handle, since the live one may be an overlay clone when
        // the swap happens mid-ghost/shadowform
        this.originalMaterials.set(
          mesh,
          mesh.name === 'class_halo' ? (this.haloBaseMaterial ?? mesh.material) : mesh.material,
        );
        mesh.castShadow = false;
        return;
      }
      mesh.castShadow = this.shadowOn;
      mesh.receiveShadow = false;
      const skinned = mesh as unknown as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh) applySkinnedCullBounds(skinned, this.root, this.height);
      this.originalMaterials.set(mesh, mesh.material);
      this.casters.push(mesh);
    });
  }

  /** Set (or clear, with null) the Shardpike aim reticle on this creature's eye. */
  setEyeWardMarker(plan: EyeWardMarkerPlan | null): void {
    this.eyeWardPlan = plan;
  }

  /** Fire the landed-thrust burst on the reticle. No-op on a rig that has no eye. */
  strikeEyeWardMarker(): void {
    this.eyeWardMarker?.strike();
  }

  releaseShardpikeProp() {
    return shardpikeProp(this.model);
  }

  sampleEyeAnchor(out: THREE.Vector3): boolean {
    const spec = this.def.eyeGlow;
    const bone = spec && this.model.getObjectByName(spec.bone);
    if (!spec || !bone) return false;
    bone.updateWorldMatrix(true, false);
    out.fromArray(spec.offset).applyMatrix4(bone.matrixWorld);
    return true;
  }

  dispose(): void {
    this.actionProps?.restore();
    this.disposed = true;
    // first: whatever below throws, no bake goes on for a body that is gone
    this.dropWocFarJob();
    this.wocAtlas.dispose();
    // Give the streamed armor files back: a set nobody wears is freed after the
    // idle window (woc_armor_packs.ts).
    this.wocArmor?.dispose();
    this.wocArmor = null;
    this.wocHead?.dispose();
    this.wocHead = null;
    this.wocFarTint?.dispose();
    this.wocFarTint = null;
    releaseWocArmorOf(this.model);
    disposeHeldPropIdles(this.model);
    this.chargeGlow?.dispose();
    this.chargeGlow = null;
    this.eyeGlow?.dispose();
    this.eyeGlow = null;
    this.eyeWardMarker?.dispose();
    this.eyeWardMarker = null;
    this.effigyRig?.dispose();
    this.effigyRig = null;
    this.bastionSweepFx?.dispose();
    this.bastionSweepFx = null;
    this.bastionSweepAction = null;
    this.templarsVerdictFx?.dispose();
    this.templarsVerdictFx = null;
    this.templarsVerdictAction = null;
    this.formAdornments?.dispose();
    this.disposeWeaponAura();
    this.disposeWeaponVfx();
    this.disposeWeaponSkinMaterials();
    this.disposeEffectMaterials();
    // Release the shared tinted-material leases (never disposing directly:
    // another visual may still mount the same clones; the shared cache
    // disposes an entry only once nothing claims it). Cleared so a double
    // dispose cannot release another visual's claims.
    releaseTintedMaterials(this.tintedRigClaims);
    this.tintedRigClaims.clear();
    releaseTintedMaterials(this.tintedFarClaims);
    this.tintedFarClaims.clear();
    this.dropPendingFarMaterials();
    this.dropPendingEffectSwap(false);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.skeletonUpdates.dispose();
    this.root.removeFromParent();
    this.wocFarLease?.release();
    this.wocFarLease = null;
    // SkeletonUtils.clone gives each instance exclusive Skeletons whose GPU
    // bone textures the renderer allocates lazily, release them here or
    // online interest churn strands one per despawned entity. Geometries
    // remain shared per-asset caches and are never disposed; shared tinted
    // materials were claim-released above and dispose through the bounded
    // cache once no visual mounts them.
    const skeletons = new Set<THREE.Skeleton>();
    this.model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh && sm.skeleton) skeletons.add(sm.skeleton);
    });
    for (const skeleton of skeletons) skeleton.dispose();
    // Give the composed part set back. It is the one shared cache entry that IS
    // reclaimable: keyed by the look rather than by the asset, so a populated
    // zone mints one per distinct character and would otherwise grow for the
    // life of the session. No-op for a fixed rig.
    releaseModularVariant(this.model);
  }

  // -------------------------------------------------------------------------
  // State machine internals
  // -------------------------------------------------------------------------

  private desiredBase(s: AnimState): BaseState {
    // Whether the LOADED rig has the clip, not whether the ClipMap names one:
    // every player ClipMap names walkBack, but baseAction() silently falls back
    // to walk when the GLB lacks it, and the machine would then hold a state
    // nothing is playing.
    //
    // Wading is the same rule seen from the other side: a rig with no wade
    // cycle (every mob and NPC) must not enter the state at all, or it would
    // play its dry walk at the WADE clip's tempo — the fallback covers the pose
    // but nothing covers the timing.
    // Passed as a flag rather than a doctored copy of `s`: this runs per entity
    // per frame, and the copy allocated a fresh object every frame for every
    // rig with no wade clip standing in a ford.
    //
    // The battle stance is gated the same way and for the walkBack reason: only
    // a rig that ships the loop may enter the state. So is the strafe, which
    // needs BOTH side runs; they are looked up only while strafing, the one
    // case the flag is read.
    return desiredBaseState(
      s,
      !!this.action(this.def.clips.walkBack),
      !!this.action(this.def.clips.wade),
      !!this.action(this.def.clips.combatIdle),
      !!this.action(this.def.clips.prowlIdle),
      !!this.action(this.def.clips.prowlWalk),
      isBraced(this.braceUntil, this.clock),
      !!s.strafe &&
        !!this.action(this.def.clips.strafeLeft) &&
        !!this.action(this.def.clips.strafeRight),
      !!this.action(this.def.clips.sleep),
    );
  }

  /** The posed head height used by the renderer's surface/submerged latch. */
  get swimHeadHeight(): number {
    return (this.def.swimHeadHeight ?? this.baseHeight * SUBMERGED_HEAD_FRACTION) * this.bodyScale;
  }

  get gait(): VisualDef['gait'] {
    return this.def.gait;
  }

  /** Refill the weight scratch from the live mixer (see `weightScan`). */
  private readActionWeights(): AnimActionWeight[] {
    const scan = this.weightScan;
    let i = 0;
    for (const a of this.actions.values()) {
      const slot = scan[i];
      if (slot) readActionWeight(a, slot);
      else scan.push(readActionWeight(a));
      i++;
    }
    return scan;
  }

  /** Measured requests vs actual palette rebuilds for browser-side accounting. */
  skeletonUpdateStats(): SkeletonUpdateStats {
    return this.skeletonUpdates.stats();
  }

  private updateMixer(dt: number): void {
    // A statue holds the pose it was struck in.
    this.mixer.update(this.petrified ? 0 : dt);
    this.skeletonUpdates.markPoseChanged();
  }

  /** Nothing is driving the rig (see `needsAnimRepair`): drop the stale handle
   *  so fadeTo cannot early-return on it, release the one-shot latch a missed
   *  `finished` may have left set, and re-drive the base state. beginAction
   *  snaps rather than fades, since there is no live pose to blend from. */
  private repairPose(): void {
    this.currentIsOneShot = false;
    this.currentOneShotIsEmote = false;
    this.current = null;
    this.fadeTo(this.baseAction(), FADE, false);
  }

  /**
   * Normalized phase of the base locomotion clip, 0..1, or null when no base
   * action is running.
   *
   * Exposed so audio can be pinned to events INSIDE the animation (a foot
   * meeting the ground) rather than to distance travelled. A distance
   * accumulator drifts against the clip whenever playback rate and ground speed
   * disagree, and then footfalls land between the visible steps.
   */
  baseClipPhase(): number | null {
    const a = this.current ?? this.baseAction();
    const clip = a?.getClip?.();
    if (!a || !clip || clip.duration <= 0) return null;
    const t = a.time % clip.duration;
    return (t < 0 ? t + clip.duration : t) / clip.duration;
  }

  private baseTransitionFade(next: BaseState, from?: BaseState): number {
    // The side runs blend in and out quickly (STRAFE_FADE), whichever state they meet.
    if (isStrafeState(next) || (from !== undefined && isStrafeState(from))) return STRAFE_FADE;
    // A winged form without an authored Jump clip must leave its locomotion
    // stride almost immediately. The normal crossfade preserves too much of a
    // forward-leaning Run pose after takeoff and reads as a frozen leap.
    if (this.key === 'form_metamorph' && next === 'jump') return 0.04;
    // A wheeled vehicle stops turning its wheels the moment it stops moving.
    // The outgoing clip keeps playing through a crossfade, so any real fade
    // here spins the wheels on after the throttle is released.
    if (this.def.cutToIdle && next === 'idle') return CUT_FADE;
    return FADE;
  }

  private effectMaterial<T extends THREE.Material | THREE.Material[]>(material: T): T {
    if (Array.isArray(material)) return material.map((m) => this.effectSingleMaterial(m)) as T;
    return this.effectSingleMaterial(material) as T;
  }

  // Every overlay cache below clones the rig's live material. They all go
  // through cloneMaterialWithHooks for the reason material_clone_hooks.ts
  // spells out: a bare clone() drops onBeforeCompile, so it renders WITHOUT
  // the rim glow, the worn detail layer and the player's armour dye (a dyed
  // set reverting to its base colours the moment the character ghosts, goes
  // shadowform, or shifts to moonkin), and it links a second program on its
  // first draw because three keys its cache on customProgramCacheKey().
  private effectSingleMaterial(material: THREE.Material): THREE.Material {
    // Death treatments (soul rend, ghost run) win over the shapeshift tints.
    if (this.soulRend) return this.soulRendMaterial(material);
    if (this.ghosted) return this.ghostMaterial(material);
    // A statue is stone whatever else it was wearing.
    if (this.petrified) return this.petrifiedMaterial(material);
    if (this.moonkin) return this.moonkinMaterial(material);
    if (this.shadowform) return this.shadowformMaterial(material);
    if (this.ferocityStage > 0) return this.ferocityMaterial(material, this.ferocityStage);
    if (this.ascended) return this.ascensionMaterial(material);
    if (this.runeTint !== null) return this.runeTintMaterial(material, this.runeTint);
    if (this.surfaceResponse.active) return this.surfaceResponse.material(material);
    // lowest priority: the ability VFX buff/cast body glow
    if (this.auraGlowIntensity > 0.01) return this.auraGlowMaterial(material);
    return material;
  }

  private ferocityMaterial(material: THREE.Material, stage: number): THREE.Material {
    const index = Math.min(2, Math.max(0, stage - 1));
    const cache = this.ferocityMaterials[index];
    const cached = cache.get(material);
    if (cached) return cached;
    const marked = cloneMaterialWithHooks(material);
    const withColor = marked as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
    };
    if (withColor.color) {
      withColor.color.lerp(FEROCITY_TINTS[index], FEROCITY_TINT_STRENGTH[index]);
    }
    if (withColor.emissive) {
      withColor.emissive.setHex(FEROCITY_EMISSIVE[index]);
      withColor.emissiveIntensity = Math.max(
        withColor.emissiveIntensity ?? 0,
        FEROCITY_EMISSIVE_STRENGTH[index],
      );
    }
    cache.set(material, marked);
    return marked;
  }

  private runeTintMaterial(material: THREE.Material, tint: number): THREE.Material {
    const cached = this.runeTintMaterials.get(material);
    if (cached && cached.userData.runeTintHex === tint) return cached;
    // Chained to a different rune color: replace the clone and dispose the
    // old one. Safe because every runeTintMaterial call happens inside an
    // applyVisualMaterials sweep, and a tint change reaches here only while
    // that sweep is rewriting every mount of the old clone (same synchronous
    // pass, no render in between), so disposal lands exactly as the material
    // is unmounted, and the map stays at one clone per source instead of one
    // per (source, color) forever.
    cached?.dispose();
    const marked = cloneMaterialWithHooks(material);
    marked.userData.runeTintHex = tint;
    const withColor = marked as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
    };
    // "Very slight": lean the base color toward the rune color and add a low
    // emissive of the same hue so the read survives bright daylight floors.
    if (withColor.color) withColor.color.lerp(new THREE.Color(tint), 0.3);
    if (withColor.emissive) {
      withColor.emissive.setHex(tint);
      withColor.emissiveIntensity = 0.18;
    }
    this.runeTintMaterials.set(material, marked);
    return marked;
  }

  private ghostMaterial(material: THREE.Material): THREE.Material {
    const opacity = ghostEffectOpacity(this.ghostStyle);
    const cached = this.ghostMaterials.get(material);
    if (cached) {
      // one cache serves both flavors; rewrite the opacity on style flips
      // (stealth -> die -> ghost run reuses the same clones)
      cached.opacity = opacity;
      return cached;
    }
    const ghost = createGhostEffectMaterial(material, this.ghostStyle);
    this.ghostMaterials.set(material, ghost);
    return ghost;
  }

  private soulRendMaterial(material: THREE.Material): THREE.Material {
    const cached = this.soulRendMaterials.get(material);
    if (cached) return cached;
    const marked = applySoulRendOverlay(material);
    this.soulRendMaterials.set(material, marked);
    return marked;
  }

  private shadowformMaterial(material: THREE.Material): THREE.Material {
    const cached = this.shadowformMaterials.get(material);
    if (cached) return cached;
    const marked = createShadowformEffectMaterial(material);
    this.shadowformMaterials.set(material, marked);
    return marked;
  }

  private moonkinMaterial(material: THREE.Material): THREE.Material {
    const cached = this.moonkinMaterials.get(material);
    if (cached) return cached;
    const marked = createMoonkinEffectMaterial(material);
    this.moonkinMaterials.set(material, marked);
    return marked;
  }

  private ascensionMaterial(material: THREE.Material): THREE.Material {
    const cached = this.ascensionMaterials.get(material);
    if (cached) return cached;
    const marked = cloneMaterialWithHooks(material);
    const withColor = marked as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
    };
    if (withColor.color) withColor.color.lerp(ASCENSION_TINT, 0.38);
    if (withColor.emissive) {
      withColor.emissive.setHex(0x9d690e);
      withColor.emissiveIntensity = 0.48;
    }
    this.ascensionMaterials.set(material, marked);
    return marked;
  }

  /** Whether the rig carries a clip. Built once: action() asks about ten times a frame. */
  private readonly hasClip = (name: string): boolean => this.actions.has(name);

  private action(name: string | undefined): THREE.AnimationAction | null {
    if (!name) return null;
    const clip = this.loadoutSwap ? swappedClip(this.loadoutSwap, name, this.hasClip) : name;
    return clip ? (this.actions.get(clip) ?? null) : null;
  }

  /** Re-pick the loadout clip set (weapon_loadout_core.ts) after the hands' contents change:
   *  a mainhand or offhand swap, or the sheathe landing. A rig standing in a base state
   *  crossfades onto its new variant (the base machine only re-resolves on a state change). */
  private refreshLoadout(): void {
    const swaps = this.def.clips.loadoutSwaps;
    if (!swaps) return;
    const attach = this.def.attach ?? [];
    const loadout = weaponLoadout({
      mainhandItemId: this.weaponItemId,
      offhandItemId: this.offhandItemId,
      stowed: this.stow.attached,
      showsMainhand: (this.def.weaponSlots?.length ?? 0) > 0,
      showsOffhand: this.def.offhandSlot !== undefined,
      // ...unless the body leaves its own hand props off while unarmed
      fixedOffhand:
        fixedHandPropsShown(this.bareWhenUnarmed, this.weaponItemId) &&
        attach.some((a, i) => a.bone === 'handslot.l' && i !== this.def.offhandSlot && !a.swapOnly),
    });
    const next = loadout ? (swaps[loadout] ?? null) : null;
    if (next === this.loadoutSwap) return;
    this.loadoutSwap = next;
    if (this.initialized && !this.deadLock && !this.currentIsOneShot) {
      const base = this.baseAction();
      if (base && base !== this.current) this.fadeTo(base, 0.2, false);
    }
  }

  private baseAction(): THREE.AnimationAction | null {
    const c = this.def.clips;
    switch (this.baseState) {
      case 'prowlIdle':
        return this.action(c.prowlIdle) ?? this.action(c.idle);
      case 'prowlWalk':
        return this.action(c.prowlWalk) ?? this.action(c.walk);
      case 'combatIdle':
        // desiredBaseState only picks this for a rig that HAS the loop, so the
        // fallback is unreachable belt-and-braces (a def whose clip name misses
        // in the GLB resolves to null in both places and lands on idle).
        return (
          this.action(this.auraIdle ?? undefined) ??
          this.action(c.combatIdle) ??
          this.action(c.idle)
        );
      case 'walk':
        return this.action(c.walk) ?? this.action(c.idle);
      case 'walkBack':
        return this.action(c.walkBack) ?? this.action(c.walk);
      case 'run':
        return (
          (this.warriorBody.rushActive ? this.action(c.rush) : null) ??
          this.action(c.run) ??
          this.action(c.walk)
        );
      // desiredBaseState only picks a strafe for a rig that loads BOTH side runs,
      // so the run-then-walk fallback is belt-and-braces, as combatIdle's is.
      case 'strafeLeft':
        return this.action(c.strafeLeft) ?? this.action(c.run) ?? this.action(c.walk);
      case 'strafeRight':
        return this.action(c.strafeRight) ?? this.action(c.run) ?? this.action(c.walk);
      case 'cast':
        // A displayed bow holds its draw here instead of the shared caster
        // gesture; a per-ability authored cast clip beats the generic channel;
        // every other weapon keeps the rig's authored cast.
        return (
          this.action(weaponSkinCastClip(this.weaponSkinId, this.castingAbility) ?? undefined) ??
          this.action(this.castingAbility ? c.castByAbility?.[this.castingAbility] : undefined) ??
          this.action(c.cast) ??
          this.action(c.idle)
        );
      case 'spin':
        return (
          this.action(this.castingAbility ? c.castByAbility?.[this.castingAbility] : undefined) ??
          this.action(c.attack[0]) ??
          this.action(c.idle)
        );
      case 'swim':
        return this.action(c.swim) ?? this.action(c.idle);
      case 'swimSurface':
        // Rigs with one swim clip (creatures, and any body that never loaded
        // the authored lane) swim it at every depth.
        return this.action(c.swimSurface) ?? this.action(c.swim) ?? this.action(c.idle);
      case 'swimIdle':
        // No tread clip = keep stroking on the spot, which is what every rig
        // did before the tread existed.
        return (
          this.action(c.swimIdle) ??
          this.action(c.swimSurface) ??
          this.action(c.swim) ??
          this.action(c.idle)
        );
      case 'wade':
        return this.action(c.wade) ?? this.action(c.walk) ?? this.action(c.idle);
      case 'sit':
        return this.action(c.sitDown) ?? this.action(c.sitIdle) ?? this.action(c.idle);
      case 'sleep':
        // Only ever entered when the rig HAS the clip (desiredBase gates on it), so the
        // idle fallback is belt-and-braces rather than a state anything runs in.
        return this.action(c.sleep) ?? this.action(c.idle);
      case 'jump': {
        const moving = this.jumpWhileMoving ? this.action(c.jumpMoving) : null;
        return moving ?? this.action(c.jump) ?? this.action(c.idle);
      }
      case 'fall':
        // Rigs without the authored flail (mobs, creatures) hold the jump
        // pose for the whole fall, which is what every rig did before it.
        return this.action(c.fall) ?? this.action(c.jump) ?? this.action(c.idle);
      default:
        // 'idle' lands here: an aura-held loop (ClipMap.idleByAura) replaces it while it rides.
        return this.action(this.auraIdle ?? undefined) ?? this.action(c.idle);
    }
  }

  private shouldInterruptEmote(s: AnimState): boolean {
    return s.moving || s.airborne || s.swimming || s.casting || !!s.spinning || s.sitting || s.dead;
  }

  /** The outgoing gait currently winding down, if this rig opted in. Cleared
   *  when the fade completes, or the moment the action is re-driven. */
  private windDown: {
    action: THREE.AnimationAction;
    from: number;
    fade: number;
    elapsed: number;
  } | null = null;

  /** Decay the outgoing gait's cadence alongside its crossfade, so a stop
   *  settles instead of sprinting out under a dissolving pose. A no-op for a
   *  rig that has not opted in, and for the whole of the rest of the game. */
  private advanceGaitWindDown(dt: number): void {
    const w = this.windDown;
    if (!w) return;
    // Re-driven as the live pose (a stop that immediately becomes a start), or
    // stopped out from under us: hand it back, the per-frame speed matching
    // owns its cadence again. isScheduled(), NOT isRunning(): three reports a
    // timeScale-0 action as not running, so isRunning would call the freeze
    // this very function just applied a reason to stop tracking it.
    if (w.action === this.current || !w.action.isScheduled()) {
      this.windDown = null;
      return;
    }
    w.elapsed += dt;
    w.action.timeScale = gaitWindDownTimeScale(w.from, w.elapsed, w.fade);
    if (w.elapsed >= w.fade) this.windDown = null;
  }

  /** The cast just ended mid-clip: let a listed cast clip FINISH as a one-shot
   *  (the crash recovery, the pointing arm coming back down) instead of being
   *  cut by the base-pose crossfade. The action keeps its cast timescale and
   *  its current time; onFinished hands back to whatever base state the rig is
   *  in by then, and an attack or a new cast stomps it like any one-shot. */
  private beginCastExitPlayOut(): boolean {
    const action = this.current;
    if (!action) return false;
    const clip = action.getClip();
    if (!shouldPlayOutCastExit(this.def.clips.castPlayOut, clip.name, action.time, clip.duration))
      return false;
    action.paused = false;
    // the hold loop may exit mid-reverse: the play-out always runs FORWARD
    action.timeScale = Math.abs(action.timeScale) || 1;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    this.currentIsOneShot = true;
    this.currentOneShotIsEmote = false;
    this.currentOneShotIsAttack = false;
    this.currentOneShotIsCastExit = true;
    return true;
  }

  private fadeTo(next: THREE.AnimationAction | null, fade: number, oneShot: boolean): void {
    if (!next) return;
    if (next === this.current && !oneShot) return;
    const prev = this.current;
    next.reset();
    next.setLoop(oneShot || this.isOnce(next) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = true;
    next.timeScale = 1;
    this.beginAction(next, prev, fade);
    this.current = next;
    this.currentIsOneShot = oneShot;
    this.currentOneShotIsEmote = false;
    this.currentOneShotIsCastExit = false;
  }

  /**
   * Start `next`, crossfading out of `prev` while it still drives the rig.
   * With no outgoing partner (nothing active, the same clip re-triggered, or a
   * `current` that was stopped out from under us) a fadeIn would ramp the ONLY
   * contributing action up from zero, and the mixer blends that whole deficit
   * toward BIND pose: a T-pose for the length of the fade. Snap to full weight
   * in that case, since there is no live pose to blend from anyway.
   */
  private beginAction(
    next: THREE.AnimationAction,
    prev: THREE.AnimationAction | null,
    fade: number,
  ): void {
    this.actionProps?.action(next.getClip().name);
    // A transition can interrupt a crossfade still in flight (the stow gesture
    // racing the waterline's base-state edge is the common case: auto-sheathe
    // fires the moment the swim latch flips). The action that was FADING IN at
    // that moment is neither `next` nor `prev`, so the pairwise fade below
    // never touches it — its scheduled ramp completes and a full-weight loop
    // is left running under every later pose. That is the "swims in mid-air /
    // glitched swimming after jumping in from a cliff" bug. Sweep every other
    // unpaused running action out whenever a new transition starts; the climb
    // overlay actions run PAUSED (scrubbed by phase) and are never touched.
    //
    // stop(), NOT fadeOut(). `fadeOut(d)` is `_scheduleFading(d, 1, 0)`, and
    // _updateWeight MULTIPLIES the interpolant by `this.weight`, so fading out
    // an action caught mid-fade-in at 0.05 first RESTORES it to full weight for
    // the frame and only then decays it: the sweep would trade a stuck loop for
    // a full-weight flash of the stale pose, with a WATER_FADE-long tail on
    // exactly the shoreline transitions this exists to fix. setEffectiveWeight(0)
    // is worse still, since it zeroes `this.weight` permanently and every later
    // fadeIn multiplies by that zero. stop() deactivates and reset()s (which
    // stopFading()s) without touching weight, and the pairwise fade below keeps
    // the scheduled total at 1, so the rig never dips toward BIND pose.
    for (const a of this.actions.values()) {
      if (a === next || a === prev || a === this.climbOverlay || a.paused || !a.isRunning()) {
        continue;
      }
      a.stop();
    }
    // the re-trigger twins (twinOf) are not in the action map: sweep them too
    for (const a of this.twinActions.keys()) {
      if (a === next || a === prev || a.paused || !a.isRunning()) continue;
      a.stop();
    }
    if (prev && prev !== next && drivesPose(readActionWeight(prev))) {
      prev.fadeOut(fade);
      // Arm the cadence wind-down on the SAME action the mixer is fading, and
      // only for a gait that was actually running forward: a reversed
      // backpedal (negative scale) or an already-idle clip has nothing to wind
      // down, and one-shots own their own timing.
      this.windDown =
        this.def.gaitWindDown && !this.currentIsOneShot && prev.timeScale > 0
          ? { action: prev, from: prev.timeScale, fade, elapsed: 0 }
          : null;
      next.fadeIn(fade).play();
      return;
    }
    // The snap path stops `prev` outright, so there is no outgoing cadence left
    // to decay; drop any wind-down still pointing at it.
    this.windDown = null;
    // A prev below the pose-drive threshold still needs its scheduled fades
    // cancelled: it is excluded from the sweep above (as prev) and from the
    // crossfade (below threshold), so a fade-in it was carrying would
    // otherwise complete underneath the snap and loop at full weight.
    // stop() for the same reason as the sweep, and doubly here: this branch
    // exists to SNAP, and fading a near-dead prev out from weight 1 would blend
    // it ~50/50 against the snapped `next` for the whole fade, the opposite of
    // what the docblock above promises.
    if (prev && prev !== next && !prev.paused && prev.isRunning()) prev.stop();
    next.setEffectiveWeight(1);
    next.play();
  }

  /** Base clips that play once and CLAMP instead of looping: a sit-down
   *  transition (which then hands off to the sit-idle loop), and the jump clip
   *  of a rig that ships a landing one-shot, which holds its airborne pose for
   *  as long as the body is off the ground. Rigs without a `land` clip keep
   *  looping `jump` unchanged. */
  private isOnce(a: THREE.AnimationAction): boolean {
    if (this.baseState === 'sit') return a === this.action(this.def.clips.sitDown);
    // 'fall' counts as well as 'jump'. A rig with no authored flail resolves
    // `fall` back to its jump clip (baseAction), so keying this on 'jump' alone
    // meant a long fall silently LOOPED the pose a short hop clamps. The check
    // is on the resolved ACTION, so a rig that does ship a flail is unaffected:
    // its fall action is not the jump action, and the flail loops as intended.
    if ((this.baseState === 'jump' || this.baseState === 'fall') && this.def.clips.land)
      return a === this.action(this.def.clips.jump);
    // The held guard: a raise-into-guard stance clip (the muster's `Block`) comes up once
    // and holds its raised last frame for as long as the body stays braced.
    if (combatIdleClamps(this.baseState, this.def.clips.combatIdleHold))
      return a === this.action(this.def.clips.combatIdle);
    return false;
  }

  /**
   * Idle-breakers: while a rig with `idleVariants` is standing still, play one
   * of them now and then instead of looping the breathing idle forever.
   *
   * They go through playOneShot, so onFinished crossfades the rig back to the
   * base idle and nothing here has to unwind the pose. The timer only runs
   * while genuinely idle; the moment the rig leaves idle the caller above
   * CANCELS a fidget already in flight, because a one-shot left running would
   * suppress the walk/run fade and the foot-speed match behind it.
   *
   * The interval is jittered per fire rather than fixed: a paddock of
   * tortoises all rearing on the same beat is worse than none of them rearing
   * at all. It is also deliberately long relative to the clips (which run 3.7
   * to 4.3 seconds) so the rig reads as occasionally restless rather than
   * twitchy.
   */
  private tickIdleVariant(dt: number, desired: BaseState): void {
    const variants = this.def.clips.idleVariants;
    if (!variants || variants.length === 0) return;
    if (desired !== 'idle') {
      this.idleVariantIn = -1; // rearm on the next idle edge
      return;
    }
    if (this.idleVariantIn < 0) {
      this.idleVariantIn = this.nextIdleVariantIn();
      return;
    }
    this.idleVariantIn -= dt;
    if (this.idleVariantIn > 0) return;
    // Due, but something else is playing (very often the idle BEAT, which is a
    // one-shot too). Hold the draw rather than rearming: rearming here let the
    // beat reset this clock on every fire and the pool would never come up.
    if (this.currentIsOneShot) return;
    this.idleVariantIn = this.nextIdleVariantIn();
    const pick = variants[Math.floor(Math.random() * variants.length)];
    if (!this.action(pick)) return;
    this.playOneShot(pick, 1);
    this.currentOneShotIsIdleVariant = true;
  }

  /** Seconds until the next fidget: the rig's own cadence, else the shared beat. */
  private nextIdleVariantIn(): number {
    const cadence = this.def.clips.idleVariantCadence;
    if (!cadence) return IDLE_VARIANT_MIN + Math.random() * IDLE_VARIANT_JITTER;
    return cadence.everySec + Math.random() * (cadence.jitterSec ?? 0);
  }

  /**
   * The signature idle on its own clock (ClipMap.idleBeat).
   *
   * Separate from the fidget pool because the pool is a single shared timer
   * feeding a random pick, so a clip's real cadence there is the draw interval
   * times the pool size, fine for "occasionally restless", useless for "every
   * twenty seconds". This keeps its own countdown and fires only that clip.
   *
   * It reuses the idle-variant latch, so it inherits the cancel that kills a
   * fidget the instant the rig stops standing still; without that a one-shot
   * left running suppresses the walk/run fade and the rig skates.
   */
  private tickIdleBeat(dt: number, desired: BaseState): void {
    const beat = this.def.clips.idleBeat;
    if (!beat) return;
    if (desired !== 'idle') {
      this.idleBeatIn = -1; // rearm on the next idle edge
      return;
    }
    const arm = () => beat.everySec + Math.random() * (beat.jitterSec ?? 0);
    if (this.idleBeatIn < 0) {
      this.idleBeatIn = arm();
      return;
    }
    this.idleBeatIn -= dt;
    if (this.idleBeatIn > 0) return;
    if (this.currentIsOneShot) return; // wait for the floor, keep the clock at 0
    this.idleBeatIn = arm();
    if (!this.action(beat.clip)) return;
    this.playOneShot(beat.clip, 1);
    this.currentOneShotIsIdleVariant = true;
  }

  private playOneShot(
    name: string,
    timeScale: number,
    repeats = 1,
    emoteId: OverheadEmoteId | null = null,
  ): void {
    this.currentOneShotIsAttack = false;
    let a = this.action(name);
    if (!a) return;
    // Final Edict and an ordinary two-hand attack share WOC's authored chop.
    // Every new one-shot clears ownership; playAttack reclaims it by ability.
    this.stopTemplarsVerdictFx();
    if (name !== PALADIN_BASTION_SWEEP_CLIP) this.stopBastionSweepFx();
    // A one-shot replaced in the frame it began (the second swing of a same-tick
    // dual pair) never drove a pose: blend from what IT was blending from.
    const replacedThisFrame = this.currentIsOneShot && this.oneShotAt === this.mixer.time;
    const prev = replacedThisFrame ? this.oneShotFrom : this.current;
    // The same clip started again while it still drives the rig (an ability strike on
    // the swing just begun): play its twin from the top, crossfading from where the
    // running one is, instead of resetting it in place (a snap to frame 0).
    // (WOC bodies only: the KayKit signature poses deliberately re-enter at full weight.)
    if (
      this.def.wocCharacter &&
      a === prev &&
      !replacedThisFrame &&
      a.isRunning() &&
      drivesPose(readActionWeight(a))
    ) {
      a = this.twinOf(a);
    }
    // reset (not stop) restarts the clip in place: stopping the clip that is
    // ALREADY driving the rig, then fading it back in from zero with no
    // outgoing partner, T-poses the rig for the whole fade on every same-clip
    // re-trigger (a repeated swing, a re-fired emote, the sheathe gesture).
    a.reset();
    const repeatCount = Math.max(1, Math.floor(repeats));
    a.setLoop(repeatCount === 1 ? THREE.LoopOnce : THREE.LoopRepeat, repeatCount);
    // clamp on the last frame: an unclamped LoopOnce action zeroes its weight
    // the instant it finishes, which blends the rig toward bind pose for the
    // whole 0.18s hand-off fade (a visible T-pose pop after every swing)
    a.clampWhenFinished = true;
    a.timeScale = timeScale;
    this.beginAction(
      a,
      prev,
      name === this.def.clips.rushArrival ? 0.04 : warriorActionBlend(this.key, name, ONESHOT_FADE),
    );
    this.current = a;
    this.currentIsOneShot = true;
    this.oneShotFrom = prev;
    this.oneShotAt = this.mixer.time;
    this.currentOneShotIsEmote = emoteId !== null;
    // Cleared for EVERY one-shot; tickIdleVariant re-sets it straight after
    // its own call, so the latch can never outlive the clip that set it.
    this.currentOneShotIsIdleVariant = false;
    this.currentOneShotIsLanding = false;
    this.currentOneShotIsCastExit = false;
  }

  /** The second action of a one-shot's clip, minted on first use; the two alternate on
   *  repeated re-triggers. It rides the clip's twin (a clone under the same name, one per
   *  source clip and shared by every rig: clip_twin.ts), since this mixer already holds
   *  the one action it keeps per clip. */
  private twinOf(a: THREE.AnimationAction): THREE.AnimationAction {
    let twin = this.twinActions.get(a);
    if (!twin) {
      twin = this.mixer.clipAction(twinClipOf(a.getClip()));
      this.twinActions.set(a, twin);
      this.twinActions.set(twin, a);
    }
    return twin;
  }

  private onFinished(a: THREE.AnimationAction): void {
    if (a === this.templarsVerdictAction) this.stopTemplarsVerdictFx();
    if (a === this.bastionSweepAction) this.stopBastionSweepFx();
    if (this.deadLock) return; // death clip clamps on its last frame
    if (this.baseState === 'sit' && a === this.action(this.def.clips.sitDown)) {
      this.fadeTo(this.action(this.def.clips.sitIdle) ?? a, 0.25, false);
      return;
    }
    if (a === this.current) {
      this.currentIsOneShot = false;
      this.currentOneShotIsEmote = false;
      this.currentOneShotIsIdleVariant = false;
      this.currentOneShotIsLanding = false;
      this.currentOneShotIsCastExit = false;
      this.fadeTo(this.baseAction(), 0.18, false);
    }
  }

  /** Two-state prop mobs (VisualDef.corpseMeshSwap): alive shows `hide`,
   *  dead shows `show` (the dragonkin egg's cracked shell IS its corpse).
   *  assembleModel seeds the alive state; the death/revive edges flip it. */
  private applyCorpseMeshSwap(dead: boolean): void {
    const swap = this.def.corpseMeshSwap;
    if (!swap) return;
    this.model.traverse((n) => {
      if (n.name === swap.hide) n.visible = !dead;
      else if (n.name === swap.show) n.visible = dead;
    });
  }

  /** The authored wake one-shot, if the ClipMap names one AND the loaded rig has it. */
  private wakeAction(): THREE.AnimationAction | null {
    const clip = this.def.clips.wake;
    return clip ? this.action(clip) : null;
  }

  /** One-shot the flourish clip (skeleton awaken / boss taunt / the dragonkin
   *  brood's Shout and the whelp's hatch pounce), off the 'shout'/'flourish'
   *  spellfx cues. No-op for rigs without a flourish clip. */
  playFlourish(): void {
    const clip = this.def.clips.flourish;
    if (clip && this.action(clip)) this.playOneShot(clip, 1);
  }

  private enterDeath(): void {
    this.braceUntil = Number.NEGATIVE_INFINITY;
    this.stopTemplarsVerdictFx();
    this.stopBastionSweepFx();
    this.deadLock = true;
    this.currentIsOneShot = false;
    this.currentOneShotIsEmote = false;
    this.currentOneShotIsCastExit = false;
    this.applyCorpseMeshSwap(true);
    // Collapse the upright pick capsule to a flat, ground-hugging profile so a
    // near-eye click behind or above the now-lying corpse no longer intersects an
    // invisible standing column (issue 1486). The ground-level footprint stays, so
    // a lootable corpse remains clickable. Restored in revive(). Set here (not the
    // per-frame update) since it only changes on the death/revive edge, and this
    // runs on every enterDeath path including the created-already-dead snapshot.
    this.clickProxy.scale.y = pickProxyHeight(this.baseHeight, this.clickRadius, true);
    const death = this.action(this.def.clips.death);
    if (!death) {
      // No death clip: the corpse holds whatever pose was driving it. dead-lock
      // freezes the zero-weight watchdog, so leave the machine on something
      // real, or the rig sits in bind pose until it revives (and revive() would
      // inherit a stale `current` it can neither fade out of nor blend from).
      if (!drivesPose(this.current ? readActionWeight(this.current) : null)) {
        this.baseState = 'idle';
        this.current = null;
        this.fadeTo(this.baseAction(), ONESHOT_FADE, false);
      }
      return;
    }
    const prev = this.current;
    death.reset();
    death.setLoop(THREE.LoopOnce, 1);
    death.clampWhenFinished = true;
    death.timeScale = this.def.deathTimeScale ?? 1.15;
    if (!this.initialized) {
      // created already-dead (corpse entering interest): snap to the end pose, and the
      // eye is simply out rather than guttering through a death nobody saw
      this.eyeGlow?.snuff();
      if (prev && prev !== death) prev.stop();
      death.play();
      death.time = Math.max(0, death.getClip().duration - 1e-3);
      this.current = death;
      this.updateMixer(0);
      return;
    }
    this.beginAction(death, prev, ONESHOT_FADE);
    this.current = death;
  }

  private stopTemplarsVerdictFx(): void {
    this.templarsVerdictAction = null;
    this.templarsVerdictFx?.update(null, 0);
  }

  private stopBastionSweepFx(): void {
    this.bastionSweepAction = null;
    this.bastionSweepFx?.update(null, 0);
  }

  private revive(): void {
    this.deadLock = false;
    this.baseState = 'idle';
    this.modelWrap.position.y = this.modelWrapGroundY;
    this.applyCorpseMeshSwap(false);
    // Release the one-shot latch: a `finished` that never arrived (the rig was
    // throttled, or the clip was cut) would otherwise leave every later base
    // change committing its state while silently skipping its fade.
    this.currentIsOneShot = false;
    this.currentOneShotIsEmote = false;
    // Restore the upright pick capsule (the corpse-flatten from enterDeath).
    this.clickProxy.scale.y = pickProxyHeight(this.baseHeight, this.clickRadius, false);
    // The clamped death pose stays the OUTGOING partner of the fade below (a
    // paused action still fades out). Stopping it first, or clearing `current`,
    // left the incoming clip ramping up from zero with nothing else driving the
    // rig: bind pose (the T-pose) for the whole fade, on every single respawn.
    const death = this.action(this.def.clips.death);
    if (death && death !== this.current) death.stop();
    const flourishClip = this.def.clips.flourish;
    if (flourishClip && this.action(flourishClip)) {
      this.playOneShot(flourishClip, 1); // skeletons claw out of the ground; bosses taunt
      return;
    }
    this.fadeTo(this.action(this.def.clips.idle), 0.2, false);
  }
}

export function clipNamesOf(def: VisualDef): string[] {
  const c = def.clips;
  return [
    c.idle,
    c.combatIdle,
    c.prowlIdle,
    c.prowlWalk,
    c.walk,
    c.run,
    c.rushArrival,
    c.death,
    ...(c.attack ?? []),
    ...(c.meleeAttack ?? []),
    c.wandAttack,
    ...Object.values(c.attackByAbility ?? {}),
    ...(c.abilityAttack ?? []),
    ...Object.values(c.castByAbility ?? {}),
    ...Object.values(c.attackByHand ?? {}),
    ...(c.dualWieldPair ?? []),
    ...(c.hit ?? []),
    c.cast,
    c.sitDown,
    c.sitIdle,
    c.swim,
    c.swimSurface,
    c.swimIdle,
    c.wade,
    c.jump,
    c.jumpMoving,
    c.fall,
    c.land,
    c.walkBack,
    c.strafeLeft,
    c.strafeRight,
    c.flourish,
    c.stow,
    c.climb,
    // The idle-breakers and the idle beat were MISSING here, which is the only
    // place actions get built (visual.ts constructor). A clip absent from this
    // list loads fine and passes the clipmap gate, that gate checks the GLB,
    // not the action map, but `this.action(name)` returns null forever, so
    // tickIdleVariant/tickIdleBeat bail on every fire and the rig simply never
    // fidgets. Silent: no throw, no warning, just a clip that is never seen.
    ...(c.idleVariants ?? []),
    ...Object.values(c.loadoutSwaps ?? {}).flatMap((m) => Object.values(m ?? {})),
    c.idleBeat?.clip,
    // The night pair (mob/slumber.ts): a slot named here is the ONLY way a clip becomes an
    // action, so a new ClipMap field joins this list or it never plays (pinned per rig by
    // tests/character_clipmaps.test.ts against the gate's own required-clip list).
    c.sleep,
    c.wake,
    // The aura-held idles (Balgath's Blinded loop): same rule, a loop never bound is a
    // pose never seen.
    ...Object.values(c.idleByAura ?? {}),
    ...Object.values(c.emote ?? {}).flatMap((spec) => spec.clips),
  ].filter((n): n is string => !!n);
}

function firstLoadedEmoteClip(
  spec: EmoteClipSpec | undefined,
  action: (name: string) => THREE.AnimationAction | null,
): string | null {
  if (!spec) return null;
  return spec.clips.find((name) => action(name)) ?? null;
}
