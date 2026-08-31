// Per-entity character visual: a SkeletonUtils clone of a manifest asset with
// its own AnimationMixer, a clip-driven state machine fed by renderer-derived
// state, a baked static idle-pose far LOD, and a shadow-only proxy for the
// mid-distance band. All geometry/materials are shared caches; dispose()
// releases mixer bindings, this clone's Skeletons, and the visual's claims
// on the shared tinted-material cache (which disposes a clone only once no
// visual mounts it).
import * as THREE from 'three';
import { offhandMirrorsWeaponSkin } from '../../sim/content/weapon_skin_rules';
import { WEAPON_SKINS } from '../../sim/content/weapon_skins';
import type { OverheadEmoteId } from '../../world_api';
import { recordBuildSpan, timeBuildSpan } from '../build_spans';
import { GFX } from '../gfx';
import { cloneMaterialWithHooks } from '../material_clone_hooks';
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
  desiredBaseState,
  drivesPose,
  locomotionTimeScale,
  pickProxyHeight,
  scanAnimRepair,
  shouldPlayLanding,
  shouldPlayOutCastExit,
} from './anim_state';
import {
  type AssembleOptions,
  applyMaterials,
  applyModularSliderMorphs,
  assembleModel,
  attachDeferredFaceDecals,
  ensureSkinTexture,
  farSourceMaterials,
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
} from './assets';
import { deathGroundingOffset } from './death_grounding_core';
import {
  createGhostEffectMaterial,
  createMoonkinEffectMaterial,
  createShadowformEffectMaterial,
  type GhostStyle,
  ghostEffectOpacity,
} from './effect_materials';
import { farMeshShown, shadowProxyShown } from './far_lod_reveal_core';
import { HairSwayDriver } from './hair_sway';
import { buildHalo } from './halo';
import { disposeHeldPropIdles, updateHeldPropIdles } from './held_prop_idle';
import { noteLookAttached } from './look_pieces';
import type { EmoteClipSpec, VisualDef, WeaponLayoutOverride } from './manifest';
import { createMetamorphWingPose, metamorphWingPoseInto } from './metamorph_wing_motion_core';
import type { ModularAppearance, ModularLook } from './modular';
import {
  PALADIN_BASTION_SWEEP_CLIP,
  PALADIN_BASTION_SWEEP_DURATION,
} from './paladin_bastion_sweep_clip';
import { PaladinBastionSweepFx } from './paladin_bastion_sweep_fx';
import {
  PALADIN_TEMPLARS_VERDICT_CLIP,
  PALADIN_TEMPLARS_VERDICT_DURATION,
} from './paladin_templars_verdict_clip';
import { PaladinTemplarsVerdictFx } from './paladin_templars_verdict_fx';
import { attachSharedDepthMaterials } from './shadow_depth_materials';
import { characterMeshCastsShadow } from './shadow_policy';
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
import { applySoulRendOverlay } from './soul_rend_overlay';
import { soulRendPrewarmTargets } from './soul_rend_prewarm_core';
import { createStowTransition, forceStow, requestStow, tickStow } from './stow_transition';
import { SPIN_ATTACK_VISUAL_DURATION, weaponAttackStyle } from './weapon_attack_style_core';
import {
  disposeOwnedWeaponSkinMaterials,
  markOwnedWeaponSkinMaterials,
} from './weapon_skin_materials';

export type { AnimState, BaseState } from './anim_state';

/** The renderer's live compile gate for a far LOD minted (or re-skinned) after
 *  the view's own creation gate ran: compile `target` hidden, off-thread, and
 *  call `onSettled` once its programs are linked (or immediately when async
 *  compile is unsupported). Mirrors renderer `gateSwapFlagOnCompile`. */
export type FarBakeGate = (target: THREE.Object3D, onSettled: () => void) => void;

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
  /** unscaled world-unit height, nameplate anchor = height * e.scale + 0.5 */
  readonly height: number;
  /** invisible capsule for picking (userData.entityId set by the renderer) */
  readonly clickProxy: THREE.Mesh;
  /** click-capsule radius (measured body extent); the pick proxy's standing scale.y
   *  is `height`, collapsed to a flat profile while dead (see enterDeath/revive). */
  private readonly clickRadius: number;

  private def: VisualDef;
  private key: string;
  private entityColor: number;
  private skinIndex: number;
  private weaponItemId: string | null;
  private offhandItemId: string | null;
  /** Composition inputs for a `modular` def (null for a fixed class rig).
   *  Changing a look means changing GEOMETRY, so callers rebuild the visual
   *  rather than mutating it; this is kept so they can tell whether they must. */
  private look: ModularLook | null = null;

  /** The composition this visual was built from (null for a fixed class rig). */
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
      decal.frustumCulled = false;
      this.casters.push(decal);
      this.revealDecalOnCompile(decal);
    }
    if (decals.length > 0) noteLookAttached();
    return true;
  }

  private revealDecalOnCompile(decal: THREE.Mesh): void {
    const gate = this.farBakeGate;
    if (!gate) return;
    decal.visible = false;
    try {
      gate(decal, () => {
        // A visual disposed, or its decal detached, while the link was in
        // flight: the settle belongs to a mesh this visual no longer draws.
        if (this.disposed || decal.parent === null) return;
        decal.visible = true;
      });
    } catch (err) {
      // A gate that rejects outright (a lane shut down under a graphics
      // rebuild) reveals now: a decal linking on its first draw beats one that
      // never shows, and the swap must not throw out of the attach.
      decal.visible = true;
      console.warn('[decals] compile gate refused a face decal, revealed ungated:', err);
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
  /** Waiting on the per-frame bake budget (takeFarBakeBudget): the band
   *  crossed but this part set's slot was taken, so update() retries. The
   *  visual stays articulated meanwhile (correct, just not yet cheap). */
  private farBakePending = false;
  private shadowProxy: THREE.Mesh | null = null;
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
  private auraGlowColor = 0xffffff;
  private auraGlowIntensity = 0;

  private baseState: BaseState = 'idle';
  private current: THREE.AnimationAction | null = null;
  private currentIsOneShot = false;
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
  /** which ability's cast clip the current cast-state base action was chosen
   *  for; lets chained casts refresh their per-ability override */
  private castClipAbility: string | null = null;
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
  /** True while the climb's baked clips own the mixer (restore on release). */
  private climbClipsActive = false;
  private spinAngle = 0;
  private spinOnceTimer = 0;

  private shadowOn = true;
  private far = false;
  private soulRend = false;
  private shadowform = false;
  private moonkin = false;
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
    this.entityColor = entityColor;
    this.skinIndex = skinIndex;
    this.weaponItemId = weaponItemId;
    this.offhandItemId = offhandItemId;
    this.height = prep.def.height;

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
    this.model = timeBuildSpan('view-part:assemble', () =>
      assembleModel(this.def, weaponItemId, offhandItemId, look, opts),
    );
    // Release-on-throw for everything below: the retry gate re-runs this whole
    // constructor when a streamed asset lands late (a designed path, not an
    // edge case), and assembleModel above RETAINED the composed part set.
    // Nothing on the failed path ever reaches dispose(), so without this each
    // retry pins the variant a little harder until it can never be evicted.
    // No-op for a fixed rig.
    try {
      configureTightBoneTextures(this.model);
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
        // skinned bounds drift outside bind-pose spheres; entity-level culling
        // (80u draw range) already bounds the cost
        if ((mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
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
      }

      // capsule from measured body extents, long/wide creatures (wolves,
      // dragons) were nearly unclickable with a height-derived sliver
      const r = prep.clickRadius;
      this.clickRadius = r;
      this.clickProxy = new THREE.Mesh(clickGeo(), clickMat());
      this.clickProxy.scale.set(r * 2, this.height, r * 2);
      this.clickProxy.visible = false;
      this.root.add(this.clickProxy);

      const mixerStarted = performance.now();
      this.mixer = new THREE.AnimationMixer(this.model);
      this.skeletonUpdates = new SkeletonUpdateCache(this.model);
      for (const name of [...clipNamesOf(prep.def), ...SKIN_ATTACK_CLIP_NAMES]) {
        const clip = prep.clips.get(name);
        if (clip) this.actions.set(name, this.mixer.clipAction(clip));
      }
      this.mixer.addEventListener('finished', (ev) => this.onFinished(ev.action));
      recordBuildSpan('view-part:mixer', performance.now() - mixerStarted, mixerStarted);
      if (key === 'player_paladin') {
        this.bastionSweepFx = new PaladinBastionSweepFx(this.model);
        this.templarsVerdictFx = new PaladinTemplarsVerdictFx(this.model);
      }

      const idle = this.action(this.def.clips.idle);
      if (idle) {
        idle.play();
        this.current = idle;
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
    // A transparent effect whose clones finished linking: swap them in HERE,
    // on the per-frame path, never in the gate callback (see effectSwapSettled).
    if (this.effectSwapSettled) this.commitPendingEffectSwap();
    // A far crossing that lost the bake-budget race retries here until its
    // part set gets a slot (or someone else bakes it, making the peek free).
    if (this.farBakePending && this.far && !this.farBakeTried) {
      this.attemptComposedFar();
      this.syncFarVisibility();
    }
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.updateMetamorphWings(dt, s, reducedMotion);
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
      shouldPlayLanding(this.wasAirborne, s.airborne, s.dead, !!this.action(landClip))
    )
      this.playOneShot(landClip, 1);
    this.wasAirborne = s.airborne;

    this.castingAbility = s.casting ? (s.castingAbility ?? null) : null;
    if (!this.deadLock) {
      const desired = this.desiredBase(s);
      const baseChanged = desired !== this.baseState;
      const previousBase = this.baseState;
      if (baseChanged) this.baseState = desired;
      if (this.currentOneShotIsEmote && this.shouldInterruptEmote(s)) {
        this.currentIsOneShot = false;
        this.currentOneShotIsEmote = false;
        this.fadeTo(this.baseAction(), this.baseTransitionFade(desired), false);
      } else if (this.currentOneShotIsCastExit && this.shouldInterruptEmote(s)) {
        // The recovery tail outlived the sim's stand-still window (the clip
        // lagged the cast, so more of it was left than the window covers) and
        // the body is really moving/casting again: hand the rig back to the
        // base state NOW instead of gliding the model under the one-shot.
        this.currentIsOneShot = false;
        this.currentOneShotIsCastExit = false;
        this.fadeTo(this.baseAction(), this.baseTransitionFade(desired), false);
      } else if (baseChanged && !this.currentIsOneShot) {
        // a cast clip frozen at its hold point must never stay paused through
        // the exit, whichever exit path runs below
        if (previousBase === 'cast' && this.current?.paused) this.current.paused = false;
        if (previousBase !== 'cast' || !this.beginCastExitPlayOut()) {
          this.fadeTo(this.baseAction(), this.baseTransitionFade(desired), false);
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
      // foot-speed matching on locomotion cycles
      if (!this.currentIsOneShot && this.current) {
        const timeScale = locomotionTimeScale(this.baseState, s, this.def.walkRef, this.def.runRef);
        if (timeScale !== null) {
          if (timeScale < 0 && this.current.time <= 1e-3)
            this.current.time = Math.max(0, this.current.getClip().duration - 1e-3);
          this.current.timeScale = timeScale;
        }
        if (this.baseState === 'spin') this.current.timeScale = SPIN_ATTACK_TIMESCALE;
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
      this.spinAngle = (this.spinAngle + dt * SPIN_RATE) % (Math.PI * 2);
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
    const strokeRise = authoredSwim ? SWIM_RISE_AUTHORED : SWIM_RISE;
    const swimRise = strokeRise + (SWIM_RISE_TREAD - strokeRise) * this.treadBlend;
    this.swimBlend = advanceSwimBlend(this.swimBlend, s.swimming && !s.dead, dt);
    this.swimBobTime += dt;
    // windup lean/recoil spring: while fed (setWindupLean each ceremony frame)
    // the body eases back toward the target; when feeding stops (the release)
    // it snaps forward through a small recoil, then settles to neutral
    if (this.leanFeed > 0) {
      this.leanFeed -= dt;
      this.lean += (this.leanTarget - this.lean) * Math.min(1, dt * 10);
      if (this.leanFeed <= 0) this.leanRecoil = LEAN_RECOIL_S;
    } else if (this.leanRecoil > 0) {
      this.leanRecoil -= dt;
      this.lean += (-this.leanTarget * 0.45 - this.lean) * Math.min(1, dt * 22);
    } else if (this.lean !== 0) {
      this.lean += -this.lean * Math.min(1, dt * 9);
      if (Math.abs(this.lean) < 1e-3) this.lean = 0;
    }
    // Ledge climb rides the SAME pose channels rather than fighting them:
    // these three lines are rewritten every frame, so a climb pose written
    // anywhere else would be stomped. Blend and phase are advanced here too.
    this.advanceClimbPose(dt, s.dead);
    const climb = this.climbBlend;
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

    // distant corpses show the static idle far mesh, tip it over
    if (this.farMesh?.visible) {
      if (s.dead) {
        this.farMesh.rotation.z = Math.PI / 2;
        this.farMesh.position.y = this.height * 0.16;
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
      const verdictTime =
        this.templarsVerdictAction &&
        this.current === this.templarsVerdictAction &&
        this.currentIsOneShot
          ? Math.min(PALADIN_TEMPLARS_VERDICT_DURATION, this.templarsVerdictAction.time)
          : null;
      const bastionTime =
        this.bastionSweepAction && this.current === this.bastionSweepAction && this.currentIsOneShot
          ? Math.min(PALADIN_BASTION_SWEEP_DURATION, this.bastionSweepAction.time)
          : null;
      this.bastionSweepFx?.update(bastionTime, animationDt);
      this.templarsVerdictFx?.update(verdictTime, animationDt);
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
    const reach = this.action(CLIMB_REACH_CLIP);
    const mantle = this.action(CLIMB_MANTLE_CLIP);
    if (!reach || !mantle) return;
    if (!active) {
      if (this.climbClipsActive) {
        this.climbClipsActive = false;
        reach.stop();
        mantle.stop();
        this.current?.setEffectiveWeight(1);
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
    if (this.current && this.current !== reach && this.current !== mantle) {
      this.current.setEffectiveWeight(1 - k);
    }
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
    const override = this.def.clips.attackByAbility?.[abilityId];
    return override !== undefined && this.action(override) !== null;
  }

  playAttack(abilityId?: string): void {
    if (this.deadLock) return;
    // Resolved against THIS rig's bound clips: a rig without the substitute
    // (every body but the hunter) keeps its own authored attack instead of
    // swinging with no animation at all.
    const skinAttack = pickSkinAttackClips(this.weaponSkinId, (c) => this.action(c) !== null);
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
    // too), never a draw-shot. Both are identified by their clip-name
    // convention rather than a hardcoded ability list, so any future
    // non-ranged override keeps its authored clip automatically
    // (tests/weapon_skins.test.ts).
    const rawOverride = abilityId ? this.def.clips.attackByAbility?.[abilityId] : undefined;
    const overrideIsNonRanged =
      rawOverride?.startsWith('Hunter_Melee_') || rawOverride === 'Spellcast_Raise';
    const override = !skinAttack || overrideIsNonRanged ? rawOverride : undefined;
    if (override && this.action(override)) {
      const authoredTimeScale = abilityId
        ? this.def.clips.attackTimeScaleByAbility?.[abilityId]
        : undefined;
      this.playOneShot(override, authoredTimeScale ?? this.def.attackTimeScale ?? 1.3);
      this.currentOneShotIsAttack = true;
      if (override === PALADIN_TEMPLARS_VERDICT_CLIP) {
        this.templarsVerdictAction = this.action(override);
      } else if (override === PALADIN_BASTION_SWEEP_CLIP) {
        this.bastionSweepAction = this.action(override);
      }
      return;
    }
    const style = weaponAttackStyle(this.weaponItemId, this.offhandItemId);
    const handClip = style ? this.def.clips.attackByHand?.[style] : undefined;
    if (!skinAttack && handClip && this.action(handClip)) {
      this.playOneShot(handClip, this.def.attackTimeScale ?? 1.3);
      this.currentOneShotIsAttack = true;
      return;
    }
    const clips = skinAttack?.clips ?? this.def.clips.attack;
    if (clips.length === 0) return;
    const name = clips[this.attackIdx++ % clips.length];
    this.playOneShot(name, skinAttack?.timeScale ?? this.def.attackTimeScale ?? 1.3);
    this.currentOneShotIsAttack = true;
  }

  /** Bladed Gyre is instant, so it uses one short body spin instead of the
   *  held Bladestorm channel pose. Repeated AoE hits only refresh the timer. */
  playWhirl(): void {
    if (this.deadLock) return;
    this.spinOnceTimer = SPIN_ATTACK_VISUAL_DURATION;
    const clips = this.def.clips.attack;
    if (clips.length > 0) {
      this.playOneShot(clips[this.attackIdx++ % clips.length], SPIN_ATTACK_TIMESCALE);
    }
  }

  playHit(): void {
    if (this.deadLock || this.currentIsOneShot || this.hitCooldown > 0) return;
    const clips = this.def.clips.hit;
    if (!clips || clips.length === 0) return;
    this.hitCooldown = HIT_REACT_COOLDOWN;
    this.playOneShot(clips[Math.floor(Math.random() * clips.length)], 1.2);
  }

  /** Contact-frame hitstop: hold THIS rig's animation at `scale` speed for
   *  `dur` seconds (the melee "bite"; also the struck target's flinch-freeze).
   *  Overlapping requests merge, longest duration, slowest scale, and the
   *  post-hold refractory swallows rapid re-triggers, so stacking strikes can
   *  never chain the rig into visible slow motion. */
  holdFrame(scale: number, dur: number): void {
    if (this.deadLock || dur <= 0) return;
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
    if (this.deadLock) return;
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
      // and never competes for the slot.
      if (far && !this.farMesh && this.look && !this.farBakeTried) this.attemptComposedFar();
      if (!far) this.farBakePending = false;
    }
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
   *  the LOD edge, the budget retry and the per-frame setFar all land here, so
   *  a far mesh whose materials are still linking never draws early and the
   *  articulated rig never hides without a ready stand-in. */
  private syncFarVisibility(): void {
    const showFar = farMeshShown(this.far, this.farMesh !== null, this.farCompilePending);
    const showRig = !showFar;
    if (this.modelWrap.visible !== showRig) this.modelWrap.visible = showRig;
    if (this.farMesh && this.farMesh.visible !== showFar) this.farMesh.visible = showFar;
    this.syncShadowProxyVisibility();
  }

  private syncShadowProxyVisibility(): void {
    if (!this.shadowProxy) return;
    const show = shadowProxyShown(
      this.proxyShadowWanted,
      this.farMesh !== null,
      this.farCompilePending,
    );
    if (this.shadowProxy.visible !== show) this.shadowProxy.visible = show;
  }

  /** Install (or clear) the renderer's compile gate for far bakes minted after
   *  the view's creation gate ran. Installing also resets any bake or re-skin
   *  still pending from a previous life (pool re-acquire): a settle the old
   *  renderer generation dropped must not strand this visual articulated or
   *  keep a superseded far set's tinted lease. */
  setFarBakeGate(gate: FarBakeGate | null): void {
    this.farBakeGate = gate;
    this.dropPendingFarMaterials();
    this.farCompilePending = false;
    // Same reason as the far arm: a settle the old renderer generation dropped
    // must not leave this visual waiting forever on an effect it already wears.
    this.dropPendingEffectSwap();
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

  /** One budgeted attempt at the composed far LOD. Free when the part set is
   *  already baked; otherwise takes the frame slot or goes pending. */
  private attemptComposedFar(): void {
    if (!this.look) return;
    const cached = peekModularFarBake(this.key, this.look);
    if (!cached && !takeFarBakeBudget()) {
      this.farBakePending = true;
      return;
    }
    this.farBakePending = false;
    this.buildComposedFar();
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

  /** Bake (or reuse) this composed body's far LOD. Leaves farMesh null if the
   *  look bakes to nothing, in which case the character simply keeps its
   *  articulated model at distance (correct, just not as cheap). */
  private buildComposedFar(): void {
    this.farBakeTried = true;
    if (!this.look) return;
    const bake = modularFarBake(this.key, this.look);
    if (!bake) return;
    const prep = prepareVisual(this.key);
    this.buildFarMeshes(
      bake.geo,
      tintedFarMaterials(
        prep.def,
        this.entityColor,
        farSourceMaterials(this.model, bake.isBody.length),
        bake.isBody,
        skinTexture(this.key, this.skinIndex),
        skinEmissiveTexture(this.key, this.skinIndex),
        // Claimed like the fixed-rig far materials, so the tinted cache
        // refcounts a composed body's far tints too. Nothing to release first:
        // the constructor builds no far mesh for a composed body (this is the
        // lazy path), so the claim set is empty until here.
        this.tintedFarClaims,
      ),
    );
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

  get isFar(): boolean {
    return this.far;
  }

  setGhost(on: boolean, style: GhostStyle = 'spirit'): void {
    if (on === this.ghosted && style === this.ghostStyle) return;
    this.ghosted = on;
    this.ghostStyle = style;
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
    return soulRendPrewarmTargets<THREE.Mesh, THREE.Material>({
      originalMaterials: this.originalMaterials,
      farMesh: this.farMesh,
      farMaterials: this.farMaterials,
      disposed: this.disposed,
    }).map(({ source, original }) => ({
      source,
      overlay: Array.isArray(original)
        ? original.map((material) => this.soulRendMaterial(material))
        : this.soulRendMaterial(original),
    }));
  }

  /** Scale only the drawn pose. The click proxy remains at its authoritative size. */
  setPresentationScale(scale: number): void {
    const next = Number.isFinite(scale) ? Math.min(1.2, Math.max(1, scale)) : 1;
    if (next === this.presentationScale) return;
    this.presentationScale = next;
    this.poseWrap.scale.setScalar(next);
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
    this.applyVisualMaterials();
  }

  setMoonkin(on: boolean): void {
    if (on === this.moonkin) return;
    this.moonkin = on;
    this.applyVisualMaterials();
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
   * not known linked yet. Only clones that flip `transparent` qualify: every
   * other overlay (ferocity, ascension, rune tint, aura glow) keeps the source's
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
      if (next === source || next.transparent === source.transparent) return;
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
      skinTexture(this.key, skinIndex),
      skinEmissiveTexture(this.key, skinIndex),
      this.tintedRigClaims,
    );
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
      const claims: TintedMaterialClaims = new Set();
      const mats = tintedFarMaterials(
        this.def,
        this.entityColor,
        composed ? farSourceMaterials(this.model, composed.isBody.length) : prep.idleSrcMats,
        composed ? composed.isBody : prep.idleSrcIsBody,
        skinTexture(this.key, skinIndex),
        skinEmissiveTexture(this.key, skinIndex),
        claims,
      );
      this.stageFarMaterials(mats, claims);
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
    this.weaponItemId = weaponItemId;
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
      return null;
    }
    const wasMirrored = offhandMirrorsWeaponSkin(this.weaponSkinId, this.offhandItemId);
    this.offhandItemId = offhandItemId;
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
    );
    const offPayloads = setHeldOffhand(
      this.model,
      this.def,
      this.offhandItemId,
      this.weaponSkinId,
      this.stow.attached,
    );
    if (offhandMirrorsWeaponSkin(this.weaponSkinId, this.offhandItemId)) {
      payloads.push(...offPayloads);
      this.finishWeaponAttach(payloads);
      return payloads;
    }
    // The non-mirrored offhand stays OUT of the skin material/VFX set
    // (pixel-untouched), but its freshly attached nodes must still reach the
    // caller's compile gate: dropped from the return, a re-attached shield's
    // first draw linked its programs synchronously.
    this.finishWeaponAttach(payloads);
    return [...payloads, ...offPayloads];
  }

  /** The shared tail of every re-attach (slot swap, skin change, sheathe swap):
   *  re-pin skin orientation, re-run the material pass, re-snapshot originals,
   *  and rebuild the skin VFX on the payloads that now exist. */
  private finishWeaponAttach(payloads: THREE.Object3D[]): void {
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
      skinTexture(this.key, this.skinIndex),
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
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map((m) => m.clone())
            : mesh.material.clone();
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
    this.templarsVerdictFx =
      this.key === 'player_paladin' ? new PaladinTemplarsVerdictFx(this.model) : null;
    this.templarsVerdictAction = null;
  }

  /** Hold the imbued-weapon overlay in `colorHex` (null clears it). Driven per
   *  frame by the renderer from characterWeaponAuraInto - the buff spec's
   *  weaponAura knob - so the soak lives exactly as long as the worn aura
   *  (Sanguine Blade's blood red, Pyrebrand's flame lick, Rimebound's rime).
   *  `tip` scopes the overlay to the blade's far end (Adder's Bite's green
   *  tip against Festering Venom's full-blade wash). */
  setWeaponAura(colorHex: number | null, tip = false): void {
    if (colorHex === this.weaponAuraColor && tip === this.weaponAuraTip) return;
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

    // Structural channel: Stonebound sheathes EVERY held weapon in a wireframe
    // stone shell and plates the body with shards. Independent of the imbue
    // color below, which only ever soaks the mainhand.
    if (stonebound) {
      for (const holder of weaponHolders) {
        holder?.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || !mesh.userData.weaponMesh || !mesh.parent) return;
          const aura = new THREE.Mesh(
            mesh.geometry,
            new THREE.MeshBasicMaterial({
              color: 0x9a9384,
              transparent: true,
              opacity: 0.72,
              depthWrite: false,
              blending: THREE.NormalBlending,
              side: THREE.DoubleSide,
              wireframe: true,
            }),
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
      this.buildStoneboundArmorShards();
    }

    if (this.weaponAuraColor === null) return;
    const auraColor = this.weaponAuraColor;
    const mainhand = weaponHolders.find((o) => o.userData.heldSlot === 0) ?? weaponHolders[0];
    if (!mainhand) return;
    mainhand.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData.weaponMesh || !mesh.parent) return;
      const tipGeometry = this.weaponAuraTip ? tipFadedWeaponGeometry(mesh, mainhand) : null;
      const aura = new THREE.Mesh(
        tipGeometry ?? mesh.geometry,
        new THREE.MeshBasicMaterial({
          // Additive translucent clone of the weapon mesh in the spec-authored
          // soak color. Brightness class is fixed here; only the hue is data.
          // Tip scope rides a vertex-alpha ramp baked into the cloned geometry.
          color: auraColor,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          vertexColors: tipGeometry !== null,
        }),
      );
      aura.position.copy(mesh.position);
      aura.quaternion.copy(mesh.quaternion);
      aura.scale.copy(mesh.scale).multiplyScalar(1.08);
      aura.renderOrder = 3;
      aura.userData.weaponVfxMesh = true;
      if (tipGeometry) aura.userData.ownsAuraGeometry = true;
      mesh.parent.add(aura);
      this.weaponAuraMeshes.push(aura);
    });
  }

  private buildStoneboundArmorShards(): void {
    const placements = [
      { x: -0.42, y: this.height * 0.7, z: 0, sx: 0.2, sy: 0.13, rz: -0.35 },
      { x: 0.42, y: this.height * 0.7, z: 0, sx: 0.2, sy: 0.13, rz: 0.35 },
      { x: 0, y: this.height * 0.53, z: 0.2, sx: 0.24, sy: 0.18, rz: 0 },
    ];
    for (const placement of placements) {
      const shard = new THREE.Mesh(
        STONEBOUND_SHARD_GEOMETRY,
        new THREE.MeshBasicMaterial({
          color: 0x777065,
          transparent: true,
          opacity: 0.82,
          wireframe: true,
          depthWrite: false,
        }),
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
    for (const payload of payloads) {
      const handle = createWeaponVfx(payload, spec, {
        grounded: false,
        budgetedLight: this.budgetedWeaponLight,
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
      this.auraGlowMaterials,
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
      ...this.auraGlowMaterials.values(),
    ]);
    for (const material of materials) material.dispose();
    this.ghostMaterials.clear();
    this.soulRendMaterials.clear();
    this.shadowformMaterials.clear();
    this.moonkinMaterials.clear();
    for (const cache of this.ferocityMaterials) cache.clear();
    this.ascensionMaterials.clear();
    this.runeTintMaterials.clear();
    this.auraGlowMaterials.clear();
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
    const swapDelay = (gesture.getClip().duration / STOW_GESTURE_TIMESCALE) * STOW_SWAP_FRACTION;
    if (requestStow(this.stow, stowed, swapDelay)) {
      this.playOneShot(clip as string, STOW_GESTURE_TIMESCALE);
      // Arm-raise window: peaks exactly at the swap, eases back out after it.
      this.stowLift.t = 0;
      this.stowLift.dur = swapDelay * 2;
    }
  }

  /** Cut the stow gesture at its windup peak: hand back to base so the chop
   *  clip's downswing never plays (mirrors onFinished's one-shot hand-off). */
  private endStowGesture(): void {
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
    // The swap lands mid-gesture, long after the renderer's stow diff returned,
    // so the rig it rebuilds (and the skin VFX point light hanging off it) can
    // only be reconciled into the light budget on a later frame: raise an edge
    // the renderer consumes (consumeWeaponGraphDirty).
    this.weaponGraphDirty = true;
    this.disposeWeaponVfx();
    this.disposeWeaponSkinMaterials();
    const payloads = setWeaponsStowed(
      this.model,
      this.def,
      this.weaponItemId,
      this.weaponSkinId,
      this.stow.attached,
      this.offhandItemId,
    );
    this.finishWeaponAttach(payloads);
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
      if ((mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
      this.originalMaterials.set(mesh, mesh.material);
      this.casters.push(mesh);
    });
  }

  dispose(): void {
    this.disposed = true;
    disposeHeldPropIdles(this.model);
    this.bastionSweepFx?.dispose();
    this.bastionSweepFx = null;
    this.bastionSweepAction = null;
    this.templarsVerdictFx?.dispose();
    this.templarsVerdictFx = null;
    this.templarsVerdictAction = null;
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
    // a rig that ships the loop may enter the state.
    return desiredBaseState(
      s,
      !!this.action(this.def.clips.walkBack),
      !!this.action(this.def.clips.wade),
      !!this.action(this.def.clips.combatIdle),
    );
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
    this.mixer.update(dt);
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

  private baseTransitionFade(next: BaseState): number {
    // A winged form without an authored Jump clip must leave its locomotion
    // stride almost immediately. The normal crossfade preserves too much of a
    // forward-leaning Run pose after takeoff and reads as a frozen leap.
    return this.key === 'form_metamorph' && next === 'jump' ? 0.04 : FADE;
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
    if (this.moonkin) return this.moonkinMaterial(material);
    if (this.shadowform) return this.shadowformMaterial(material);
    if (this.ferocityStage > 0) return this.ferocityMaterial(material, this.ferocityStage);
    if (this.ascended) return this.ascensionMaterial(material);
    if (this.runeTint !== null) return this.runeTintMaterial(material, this.runeTint);
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

  private action(name: string | undefined): THREE.AnimationAction | null {
    return name ? (this.actions.get(name) ?? null) : null;
  }

  private baseAction(): THREE.AnimationAction | null {
    const c = this.def.clips;
    switch (this.baseState) {
      case 'combatIdle':
        // desiredBaseState only picks this for a rig that HAS the loop, so the
        // fallback is unreachable belt-and-braces (a def whose clip name misses
        // in the GLB resolves to null in both places and lands on idle).
        return this.action(c.combatIdle) ?? this.action(c.idle);
      case 'walk':
        return this.action(c.walk) ?? this.action(c.idle);
      case 'walkBack':
        return this.action(c.walkBack) ?? this.action(c.walk);
      case 'run':
        return this.action(c.run) ?? this.action(c.walk);
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
        return this.action(c.attack[0]) ?? this.action(c.idle);
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
      case 'jump':
        return this.action(c.jump) ?? this.action(c.idle);
      case 'fall':
        // Rigs without the authored flail (mobs, creatures) hold the jump
        // pose for the whole fall, which is what every rig did before it.
        return this.action(c.fall) ?? this.action(c.jump) ?? this.action(c.idle);
      default:
        return this.action(c.idle);
    }
  }

  private shouldInterruptEmote(s: AnimState): boolean {
    return s.moving || s.airborne || s.swimming || s.casting || !!s.spinning || s.sitting || s.dead;
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
      if (a === next || a === prev || a.paused || !a.isRunning()) continue;
      a.stop();
    }
    if (prev && prev !== next && drivesPose(readActionWeight(prev))) {
      prev.fadeOut(fade);
      next.fadeIn(fade).play();
      return;
    }
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
    return false;
  }

  private playOneShot(
    name: string,
    timeScale: number,
    repeats = 1,
    emoteId: OverheadEmoteId | null = null,
  ): void {
    this.currentOneShotIsAttack = false;
    const a = this.action(name);
    if (!a) return;
    if (name !== PALADIN_TEMPLARS_VERDICT_CLIP) this.stopTemplarsVerdictFx();
    if (name !== PALADIN_BASTION_SWEEP_CLIP) this.stopBastionSweepFx();
    const prev = this.current;
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
    this.beginAction(a, prev, ONESHOT_FADE);
    this.current = a;
    this.currentIsOneShot = true;
    this.currentOneShotIsEmote = emoteId !== null;
    this.currentOneShotIsCastExit = false;
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

  /** One-shot the flourish clip (skeleton awaken / boss taunt / the dragonkin
   *  brood's Shout and the whelp's hatch pounce), off the 'shout'/'flourish'
   *  spellfx cues. No-op for rigs without a flourish clip. */
  playFlourish(): void {
    const clip = this.def.clips.flourish;
    if (clip && this.action(clip)) this.playOneShot(clip, 1);
  }

  private enterDeath(): void {
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
    this.clickProxy.scale.y = pickProxyHeight(this.height, this.clickRadius, true);
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
      // created already-dead (corpse entering interest): snap to the end pose
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
    this.clickProxy.scale.y = pickProxyHeight(this.height, this.clickRadius, false);
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

function clipNamesOf(def: VisualDef): string[] {
  const c = def.clips;
  return [
    c.idle,
    c.combatIdle,
    c.walk,
    c.run,
    c.death,
    ...(c.attack ?? []),
    ...Object.values(c.attackByAbility ?? {}),
    ...Object.values(c.castByAbility ?? {}),
    ...Object.values(c.attackByHand ?? {}),
    ...(c.hit ?? []),
    c.cast,
    c.sitDown,
    c.sitIdle,
    c.swim,
    c.swimSurface,
    c.swimIdle,
    c.wade,
    c.jump,
    c.fall,
    c.land,
    c.walkBack,
    c.flourish,
    c.stow,
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
