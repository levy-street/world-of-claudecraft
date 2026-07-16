// Per-entity character visual: a SkeletonUtils clone of a manifest asset with
// its own AnimationMixer, a clip-driven state machine fed by renderer-derived
// state, a baked static idle-pose far LOD, and a shadow-only proxy for the
// mid-distance band. All geometry/materials are shared caches — dispose()
// only releases mixer bindings.
import * as THREE from 'three';
import { WEAPON_SKINS } from '../../sim/content/weapon_skins';
import type { OverheadEmoteId } from '../../world_api';
import { GFX } from '../gfx';
import { createWeaponVfx, WEAPON_VFX, type WeaponVfxHandle } from '../weapon_vfx';
import { weaponVfxTuningFor } from '../weapon_vfx_tuning';
import {
  type AnimState,
  type BaseState,
  desiredBaseState,
  locomotionTimeScale,
  pickProxyHeight,
} from './anim_state';
import {
  applyMaterials,
  assembleModel,
  ensureSkinTexture,
  prepareVisual,
  setHeldWeapon,
  setWeaponsStowed,
  skinEmissiveTexture,
  skinTexture,
  tintedFarMaterials,
} from './assets';
import type { EmoteClipSpec, VisualDef, WeaponLayoutOverride } from './manifest';
import { SKIN_ATTACK_CLIP_NAMES, weaponSkinAttackClips, weaponSkinOrientPin } from './skin_attack';
import { createStowTransition, forceStow, requestStow, tickStow } from './stow_transition';
import {
  disposeOwnedWeaponSkinMaterials,
  markOwnedWeaponSkinMaterials,
} from './weapon_skin_materials';

export type { AnimState, BaseState } from './anim_state';

// Current canvas height in device pixels, pushed by the renderer on resolution
// changes so newly created weapon-skin VFX rigs size their point sprites right.
let weaponVfxViewportHeight = 1080;

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
const HIT_REACT_COOLDOWN = 0.9;

// Lie_Idle already lays the rig flat — a touch of extra pitch reads as a
// surface glide; clip-less rigs (creatures) get the full procedural prone
const SWIM_PITCH_CLIP = 0.35;
const SWIM_PITCH_PROCEDURAL = 1.18;
const SWIM_RISE = 0.95; // body must break the surface or only the hat floats
const MIXER_DT_CAP = 0.3; // throttled entities never integrate a huge step
const GHOST_OPACITY = 0.34;
const SOUL_REND_OPACITY = 0.58;
const SOUL_REND_TINT = new THREE.Color(0x4f0505);
const SHADOWFORM_OPACITY = 0.9;
const SHADOWFORM_TINT = new THREE.Color(0x5a2a8f);
// Moonkin Form: a brighter, more luminous violet than the ghost run (owner's brief: a
// purplish tint like ghost form but a bit brighter).
const MOONKIN_OPACITY = 0.72;
const MOONKIN_TINT = new THREE.Color(0x9d6bff);
// Metamorphosis: a monstrous demon shell, deep fel-purple body with a hot glow
// (the fire aura around it comes from vfx.formAura, not the material). Kept
// dark enough that the body still shades and the flames read against it.
const METAMORPH_TINT = new THREE.Color(0x4f2170);

// shared invisible click capsule — raycaster ignores `visible`, render doesn't
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
  shadowOnlySingleton ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  return shadowOnlySingleton;
}

export class CharacterVisual {
  /** add to the entity group; pivot at feet, faces +Z; renderer applies e.scale */
  readonly root = new THREE.Group();
  /** unscaled world-unit height — nameplate anchor = height * e.scale + 0.5 */
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
  private weaponSkinId: string | null = null;
  private weaponVfx: WeaponVfxHandle[] = [];
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
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private model: THREE.Object3D;
  private modelWrap = new THREE.Group();
  private poseWrap = new THREE.Group();
  private farMesh: THREE.Mesh | null = null;
  private farMaterials: THREE.Material | THREE.Material[] | null = null;
  private shadowProxy: THREE.Mesh | null = null;
  private casters: THREE.Mesh[] = [];
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private ghostMaterials = new Map<THREE.Material, THREE.Material>();
  private soulRendMaterials = new Map<THREE.Material, THREE.Material>();
  private shadowformMaterials = new Map<THREE.Material, THREE.Material>();
  private moonkinMaterials = new Map<THREE.Material, THREE.Material>();
  private metamorphMaterials = new Map<THREE.Material, THREE.Material>();

  private baseState: BaseState = 'idle';
  private current: THREE.AnimationAction | null = null;
  private currentIsOneShot = false;
  private currentOneShotIsEmote = false;
  private deadLock = false;
  private wasDead = false;
  private initialized = false;
  private attackIdx = 0;
  private hitCooldown = 0;
  private pendingDt = 0;
  private swimPitch = 0;

  private shadowOn = true;
  private far = false;
  private soulRend = false;
  private shadowform = false;
  private moonkin = false;
  private metamorph = false;
  private bobPhase = Math.random() * Math.PI * 2;

  constructor(
    key: string,
    entityColor: number,
    skinIndex = 0,
    weaponItemId: string | null = null,
    weaponOverride: WeaponLayoutOverride | null = null,
  ) {
    const prep = prepareVisual(key);
    // A cosmetic body (the Combat Mech) keeps its model/clips but can adopt the
    // wearer class's held-weapon layout (e.g. the rogue dual-wields in both hands).
    // Override just attach + weaponSlots on a shallow def clone, leaving the rest of
    // the def (clips/height/tint) intact and never mutating the shared cached def.
    this.def = weaponOverride
      ? { ...prep.def, attach: weaponOverride.attach, weaponSlots: weaponOverride.weaponSlots }
      : prep.def;
    this.key = key;
    this.entityColor = entityColor;
    this.skinIndex = skinIndex;
    this.weaponItemId = weaponItemId;
    this.height = prep.def.height;

    // model: yaw/scale/feet normalization wrapper around the skinned clone. The
    // equipped mainhand item (if the class swaps; see VisualDef.weaponSlot) picks
    // the held weapon model, so the visual is born holding the right weapon.
    this.model = assembleModel(this.def, weaponItemId);
    applyMaterials(
      this.model,
      this.def,
      entityColor,
      skinTexture(key, skinIndex),
      skinEmissiveTexture(key, skinIndex),
    );
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) this.originalMaterials.set(mesh, mesh.material);
    });
    this.modelWrap.rotation.y = prep.def.yaw ?? 0;
    this.modelWrap.scale.setScalar(prep.normScale);
    this.modelWrap.position.y = prep.yOffset;
    this.modelWrap.add(this.model);
    this.poseWrap.add(this.modelWrap);
    this.root.add(this.poseWrap);

    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      // skinned bounds drift outside bind-pose spheres; entity-level culling
      // (80u draw range) already bounds the cost
      if ((mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
      this.casters.push(mesh);
    });

    // far LOD + shadow proxy share the baked idle-pose geometry per key
    if (prep.idleGeo) {
      this.farMesh = new THREE.Mesh(
        prep.idleGeo,
        tintedFarMaterials(prep.def, entityColor, prep.idleSrcMats),
      );
      this.farMaterials = this.farMesh.material;
      this.farMesh.visible = false;
      this.poseWrap.add(this.farMesh);
      if (GFX.tier !== 'low') {
        this.shadowProxy = new THREE.Mesh(prep.idleGeo, shadowOnlyMat());
        this.shadowProxy.castShadow = true;
        this.shadowProxy.visible = false;
        this.poseWrap.add(this.shadowProxy);
      }
    }

    // capsule from measured body extents — long/wide creatures (wolves,
    // dragons) were nearly unclickable with a height-derived sliver
    const r = prep.clickRadius;
    this.clickRadius = r;
    this.clickProxy = new THREE.Mesh(clickGeo(), clickMat());
    this.clickProxy.scale.set(r * 2, this.height, r * 2);
    this.clickProxy.visible = false;
    this.root.add(this.clickProxy);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const name of [...clipNamesOf(prep.def), ...SKIN_ATTACK_CLIP_NAMES]) {
      const clip = prep.clips.get(name);
      if (clip) this.actions.set(name, this.mixer.clipAction(clip));
    }
    this.mixer.addEventListener('finished', (ev) => this.onFinished(ev.action));

    const idle = this.action(this.def.clips.idle);
    if (idle) {
      idle.play();
      this.current = idle;
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  /** `animate=false` skips mixer integration (distance throttling); state
   *  edges still latch so the pose catches up when the entity nears. */
  update(dt: number, s: AnimState, animate: boolean): void {
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    // Deferred sheathe swap: lands at the gesture's windup peak (see
    // setWeaponStowed), where the clip is also cut so the chop's downswing never
    // plays. Ticks even when `animate` is false so a throttled rig still settles.
    const stowTick = tickStow(this.stow, dt);
    if (stowTick !== 'none') {
      if (stowTick === 'swap') this.applyStowSwap();
      this.endStowGesture();
    }

    // death is a level sim-side — edge-trigger the clip locally
    if (s.dead && !this.wasDead) this.enterDeath();
    else if (!s.dead && this.wasDead) this.revive();
    this.wasDead = s.dead;
    this.initialized = true;

    if (!this.deadLock) {
      const desired = this.desiredBase(s);
      const baseChanged = desired !== this.baseState;
      if (baseChanged) this.baseState = desired;
      if (this.currentOneShotIsEmote && this.shouldInterruptEmote(s)) {
        this.currentIsOneShot = false;
        this.currentOneShotIsEmote = false;
        this.fadeTo(this.baseAction(), FADE, false);
      } else if (baseChanged && !this.currentIsOneShot) {
        this.fadeTo(this.baseAction(), FADE, false);
      }
      // foot-speed matching on locomotion cycles
      if (!this.currentIsOneShot && this.current) {
        const timeScale = locomotionTimeScale(this.baseState, s, this.def.walkRef, this.def.runRef);
        if (timeScale !== null) {
          if (timeScale < 0 && this.current.time <= 1e-3)
            this.current.time = Math.max(0, this.current.getClip().duration - 1e-3);
          this.current.timeScale = timeScale;
        }
      }
    }

    // swim pose: Lie_Idle (when the rig has it) + pitch and surface bob
    const proneAngle = this.action(this.def.clips.swim) ? SWIM_PITCH_CLIP : SWIM_PITCH_PROCEDURAL;
    const wantPitch = s.swimming && !s.dead ? proneAngle : 0;
    this.swimPitch += (wantPitch - this.swimPitch) * Math.min(1, dt * 8);
    this.poseWrap.rotation.x = this.swimPitch;
    this.poseWrap.rotation.z = 0;
    this.poseWrap.position.y =
      s.swimming && !s.dead
        ? SWIM_RISE + Math.sin(performance.now() / 500 + this.bobPhase) * 0.08
        : 0;

    // distant corpses show the static idle far mesh — tip it over
    if (this.farMesh && this.farMesh.visible) {
      if (s.dead) {
        this.farMesh.rotation.z = Math.PI / 2;
        this.farMesh.position.y = this.height * 0.16;
      } else {
        this.farMesh.rotation.z = 0;
        this.farMesh.position.y = 0;
      }
    }

    this.pendingDt = Math.min(MIXER_DT_CAP, this.pendingDt + dt);
    if (animate) {
      this.mixer.update(this.pendingDt);
      this.pendingDt = 0;
      // AFTER the mixer wrote the sampled pose: the sheathe gesture's additive
      // arm raise (never applied on skipped-mixer frames, so it cannot accumulate).
      this.applyStowArmLift(dt);
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

  playAttack(): void {
    if (this.deadLock) return;
    const skinAttack = weaponSkinAttackClips(this.weaponSkinId);
    const clips = skinAttack?.clips ?? this.def.clips.attack;
    if (clips.length === 0) return;
    const name = clips[this.attackIdx++ % clips.length];
    this.playOneShot(name, skinAttack?.timeScale ?? this.def.attackTimeScale ?? 1.3);
  }

  playHit(): void {
    if (this.deadLock || this.currentIsOneShot || this.hitCooldown > 0) return;
    const clips = this.def.clips.hit;
    if (!clips || clips.length === 0) return;
    this.hitCooldown = HIT_REACT_COOLDOWN;
    this.playOneShot(clips[Math.floor(Math.random() * clips.length)], 1.2);
  }

  playEmote(id: OverheadEmoteId): void {
    if (this.deadLock) return;
    const spec = this.def.clips.emote?.[id];
    const clip = firstLoadedEmoteClip(spec, (name) => this.action(name));
    if (!clip) return;
    this.playOneShot(clip, spec?.timeScale ?? 1, spec?.repeats ?? 1, id);
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
    this.mixer.update(0);
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
    this.mixer.update(0);
  }

  // -------------------------------------------------------------------------
  // LOD / shadow plumbing (memoized — called every frame by the renderer)
  // -------------------------------------------------------------------------

  setShadow(on: boolean): void {
    if (on === this.shadowOn) return;
    this.shadowOn = on;
    for (const m of this.casters) m.castShadow = on;
  }

  setProxyShadow(on: boolean): void {
    if (this.shadowProxy) this.shadowProxy.visible = on;
  }

  setFar(far: boolean): void {
    if (far === this.far) return;
    this.far = far;
    this.modelWrap.visible = !far || !this.farMesh;
    if (this.farMesh) this.farMesh.visible = far;
  }

  get isFar(): boolean {
    return this.far;
  }

  setGhost(on: boolean): void {
    this.ghosted = on;
    this.applyVisualMaterials();
  }

  setSoulRend(on: boolean): void {
    if (on === this.soulRend) return;
    this.soulRend = on;
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

  setMetamorph(on: boolean): void {
    if (on === this.metamorph) return;
    this.metamorph = on;
    this.applyVisualMaterials();
  }

  private applyVisualMaterials(): void {
    for (const [mesh, original] of this.originalMaterials) {
      mesh.material = this.effectMaterial(original);
    }
    if (this.farMesh && this.farMaterials) {
      this.farMesh.material = this.effectMaterial(this.farMaterials);
    }
  }

  /** Swap the body skin (alternate texture atlas) at runtime; no-op if unchanged.
   *  Reuses the shared skin-keyed material cache, so this is a cheap reassign. */
  setSkin(skinIndex: number): void {
    if (skinIndex === this.skinIndex) return;
    this.skinIndex = skinIndex;
    this.applySkinMaterials(skinIndex);
    // If the alternate atlas for this skin has not finished loading yet,
    // skinTexture() returned null and the body is showing the embedded default.
    // Load it on demand and re-apply once it arrives — but only if this is still
    // the requested skin (a newer setSkin must win). Without this, a freshly
    // selected skin stayed on the default until a relog warmed the atlas cache.
    const pending = ensureSkinTexture(this.key, skinIndex);
    if (pending) {
      void pending
        .then(() => {
          // Bail if the model was disposed while the atlas was loading — applying
          // materials to a torn-down model is wasted work (and re-snapshots a stale
          // material map). Also guard that this is still the requested skin.
          if (!this.disposed && this.skinIndex === skinIndex) this.applySkinMaterials(skinIndex);
        })
        .catch((err) => console.error('failed to load skin atlas:', err));
    }
  }

  private applySkinMaterials(skinIndex: number): void {
    applyMaterials(
      this.model,
      this.def,
      this.entityColor,
      skinTexture(this.key, skinIndex),
      skinEmissiveTexture(this.key, skinIndex),
    );
    // re-snapshot the material map ghost/restore relies on, then re-ghost if stealthed
    this.originalMaterials.clear();
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      // VFX rig meshes stay out of the ghost/restore cycle: their shader
      // materials are owned by the weapon-skin handle, never overlaid.
      if (mesh.isMesh && !mesh.userData.weaponVfxMesh)
        this.originalMaterials.set(mesh, mesh.material);
    });
    this.applyVisualMaterials();
  }

  /** Swap the held mainhand weapon model at runtime (gear equip/unequip); no-op if
   *  unchanged or if this class keeps a fixed weapon (hunter crossbow, mobs/NPCs —
   *  no VisualDef.weaponSlot). Mirrors setSkin: re-attach the prop, re-run the
   *  shared material pass, re-snapshot the original-material map, then re-apply any
   *  active ghost/soul-rend overlay. Cheap (one prop clone) and keeps the mixer/
   *  animation state, unlike a full visual rebuild. */
  setWeapon(weaponItemId: string | null): void {
    if (weaponItemId === this.weaponItemId) return;
    this.weaponItemId = weaponItemId;
    if (!this.def.weaponSlots?.length) return;
    this.reattachHeldWeapon();
  }

  /** Apply or clear a Season 1 Armory weapon-skin cosmetic: the skin's model
   *  replaces the held weapon (all swap slots, or the hunter's fixed ranged
   *  attach) and its rarity VFX ride the new payloads. Null restores the
   *  equipped item's own model. */
  setWeaponSkin(weaponSkinId: string | null): void {
    if (weaponSkinId === this.weaponSkinId) return;
    this.weaponSkinId = weaponSkinId;
    this.reattachHeldWeapon();
  }

  /** Re-attach the weapon slots (gear swap / skin change), honoring an active
   *  sheathe so a weapon swapped while stowed lands on the back, not the hand. */
  private reattachHeldWeapon(): void {
    this.disposeWeaponVfx();
    this.disposeWeaponSkinMaterials();
    const payloads = setHeldWeapon(
      this.model,
      this.def,
      this.weaponItemId,
      this.weaponSkinId,
      this.stow.attached,
    );
    this.finishWeaponAttach(payloads);
  }

  /** The shared tail of every re-attach (slot swap, skin change, sheathe swap):
   *  re-pin skin orientation, re-run the material pass, re-snapshot originals,
   *  and rebuild the skin VFX on the payloads that now exist. */
  private finishWeaponAttach(payloads: THREE.Object3D[]): void {
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
    applyMaterials(
      this.model,
      this.def,
      this.entityColor,
      skinTexture(this.key, this.skinIndex),
      skinEmissiveTexture(this.key, this.skinIndex),
    );
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
    // list and re-snapshot originals, then re-apply ghost/stealth overlays.
    this.originalMaterials.clear();
    this.rebuildCasters();
    this.applyVisualMaterials();
    this.buildWeaponVfx(payloads);
  }

  private weaponSkinVfxSpec() {
    const skin = this.weaponSkinId ? WEAPON_SKINS[this.weaponSkinId] : null;
    return skin ? (WEAPON_VFX[skin.model] ?? null) : null;
  }

  /** Attach the skin's rarity VFX rig to each held payload (in-hand mode: no
   *  backdrop dome, no ground pool; emissive + particles ride the weapon). */
  private buildWeaponVfx(payloads: THREE.Object3D[]): void {
    const skin = this.weaponSkinId ? WEAPON_SKINS[this.weaponSkinId] : null;
    const spec = skin ? (WEAPON_VFX[skin.model] ?? null) : null;
    if (!skin || !spec) return;
    for (const payload of payloads) {
      const handle = createWeaponVfx(payload, spec, { grounded: false });
      handle.setBackdropVisible(false);
      handle.setTuning(weaponVfxTuningFor(skin.model, spec.tier));
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
   *  Also re-pins bow payload orientation (see reattachHeldWeapon). */
  updateWeaponVfx(dt: number): void {
    this.applySkinOrientation(dt);
    for (const handle of this.weaponVfx) handle.update(dt);
  }

  /** Blend pinned skin payloads between the authored grip glue and their
   *  root-relative pin: a bow to BOW_AIM_QUAT while the shot one-shot plays, a
   *  bow-slot gun to GUN_CARRY_QUAT everywhere BUT the shot (and never while
   *  dead: a corpse's weapon just lies with the hand). Position always follows
   *  the hand. No-op without pinned payloads. */
  private applySkinOrientation(dt: number): void {
    if (this.orientPins.length === 0) return;
    const shot = this.currentIsOneShot && !this.currentOneShotIsEmote;
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
    ]);
  }

  private disposeEffectMaterials(): void {
    const materials = new Set<THREE.Material>([
      ...this.ghostMaterials.values(),
      ...this.soulRendMaterials.values(),
    ]);
    for (const material of materials) material.dispose();
    this.ghostMaterials.clear();
    this.soulRendMaterials.clear();
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
    );
    this.finishWeaponAttach(payloads);
  }

  /** Rebuild the shadow-caster list and original-material snapshot after the model
   *  graph changes (a weapon swap adds/removes bone-child meshes). */
  private rebuildCasters(): void {
    this.casters.length = 0;
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.weaponVfxMesh) return;
      mesh.castShadow = this.shadowOn;
      mesh.receiveShadow = false;
      if ((mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
      this.originalMaterials.set(mesh, mesh.material);
      this.casters.push(mesh);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.disposeWeaponVfx();
    this.disposeWeaponSkinMaterials();
    this.disposeEffectMaterials();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
    // SkeletonUtils.clone gives each instance exclusive Skeletons whose GPU
    // bone textures the renderer allocates lazily — release them here or
    // online interest churn strands one per despawned entity. Geometries and
    // materials remain shared per-asset caches and are never disposed.
    const skeletons = new Set<THREE.Skeleton>();
    this.model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh && sm.skeleton) skeletons.add(sm.skeleton);
    });
    for (const skeleton of skeletons) skeleton.dispose();
  }

  // -------------------------------------------------------------------------
  // State machine internals
  // -------------------------------------------------------------------------

  private desiredBase(s: AnimState): BaseState {
    return desiredBaseState(s, !!this.def.clips.walkBack);
  }

  private effectMaterial<T extends THREE.Material | THREE.Material[]>(material: T): T {
    if (Array.isArray(material)) return material.map((m) => this.effectSingleMaterial(m)) as T;
    return this.effectSingleMaterial(material) as T;
  }

  private effectSingleMaterial(material: THREE.Material): THREE.Material {
    // Death treatments (soul rend, ghost run) win over the shapeshift tints.
    if (this.soulRend) return this.soulRendMaterial(material);
    if (this.ghosted) return this.ghostMaterial(material);
    if (this.metamorph) return this.metamorphMaterial(material);
    if (this.moonkin) return this.moonkinMaterial(material);
    if (this.shadowform) return this.shadowformMaterial(material);
    return material;
  }

  private ghostMaterial(material: THREE.Material): THREE.Material {
    const cached = this.ghostMaterials.get(material);
    if (cached) return cached;
    const ghost = material.clone();
    ghost.transparent = true;
    ghost.opacity = GHOST_OPACITY;
    ghost.depthWrite = false;
    this.ghostMaterials.set(material, ghost);
    return ghost;
  }

  private soulRendMaterial(material: THREE.Material): THREE.Material {
    const cached = this.soulRendMaterials.get(material);
    if (cached) return cached;
    const marked = material.clone();
    marked.transparent = true;
    marked.opacity = SOUL_REND_OPACITY;
    marked.depthWrite = false;
    const withColor = marked as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
    };
    if (withColor.color) withColor.color.copy(SOUL_REND_TINT);
    if (withColor.emissive) {
      withColor.emissive.setHex(0x2a0000);
      withColor.emissiveIntensity = Math.max(withColor.emissiveIntensity ?? 0, 0.35);
    }
    this.soulRendMaterials.set(material, marked);
    return marked;
  }

  private shadowformMaterial(material: THREE.Material): THREE.Material {
    const cached = this.shadowformMaterials.get(material);
    if (cached) return cached;
    const marked = material.clone();
    marked.transparent = true;
    marked.opacity = SHADOWFORM_OPACITY;
    marked.depthWrite = true;
    const withColor = marked as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
    };
    if (withColor.color) withColor.color.copy(SHADOWFORM_TINT);
    if (withColor.emissive) {
      withColor.emissive.setHex(0x2a0a4a);
      withColor.emissiveIntensity = Math.max(withColor.emissiveIntensity ?? 0, 0.4);
    }
    this.shadowformMaterials.set(material, marked);
    return marked;
  }

  private moonkinMaterial(material: THREE.Material): THREE.Material {
    const cached = this.moonkinMaterials.get(material);
    if (cached) return cached;
    const marked = material.clone();
    marked.transparent = true;
    marked.opacity = MOONKIN_OPACITY;
    marked.depthWrite = true;
    const withColor = marked as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
    };
    if (withColor.color) withColor.color.copy(MOONKIN_TINT);
    if (withColor.emissive) {
      withColor.emissive.setHex(0x6a3fd0);
      withColor.emissiveIntensity = Math.max(withColor.emissiveIntensity ?? 0, 0.55);
    }
    this.moonkinMaterials.set(material, marked);
    return marked;
  }

  private metamorphMaterial(material: THREE.Material): THREE.Material {
    const cached = this.metamorphMaterials.get(material);
    if (cached) return cached;
    const marked = material.clone();
    const withColor = marked as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
    };
    if (withColor.color) withColor.color.copy(METAMORPH_TINT);
    if (withColor.emissive) {
      withColor.emissive.setHex(0x7a1abf);
      // Set, don't floor: the source materials ship emissiveIntensity 1 (with a
      // black emissive color), so a Math.max floor keeps full-strength glow and
      // the body renders as flat neon, drowning the fire aura and all shading.
      withColor.emissiveIntensity = 0.35;
    }
    this.metamorphMaterials.set(material, marked);
    return marked;
  }

  private action(name: string | undefined): THREE.AnimationAction | null {
    return name ? (this.actions.get(name) ?? null) : null;
  }

  private baseAction(): THREE.AnimationAction | null {
    const c = this.def.clips;
    switch (this.baseState) {
      case 'walk':
        return this.action(c.walk) ?? this.action(c.idle);
      case 'walkBack':
        return this.action(c.walkBack) ?? this.action(c.walk);
      case 'run':
        return this.action(c.run) ?? this.action(c.walk);
      case 'cast':
        return this.action(c.cast) ?? this.action(c.idle);
      case 'swim':
        return this.action(c.swim) ?? this.action(c.idle);
      case 'sit':
        return this.action(c.sitDown) ?? this.action(c.sitIdle) ?? this.action(c.idle);
      case 'jump':
        return this.action(c.jump) ?? this.action(c.idle);
      default:
        return this.action(c.idle);
    }
  }

  private shouldInterruptEmote(s: AnimState): boolean {
    return s.moving || s.airborne || s.swimming || s.casting || s.sitting || s.dead;
  }

  private fadeTo(next: THREE.AnimationAction | null, fade: number, oneShot: boolean): void {
    if (!next) return;
    if (next === this.current && !oneShot) return;
    const prev = this.current;
    next.reset();
    next.setLoop(oneShot || this.isOnce(next) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = true;
    next.timeScale = 1;
    if (prev && prev !== next) prev.fadeOut(fade);
    next.fadeIn(fade).play();
    this.current = next;
    this.currentIsOneShot = oneShot;
    this.currentOneShotIsEmote = false;
  }

  /** sit-down transitions play once, then hand off to the sit-idle loop */
  private isOnce(a: THREE.AnimationAction): boolean {
    return this.baseState === 'sit' && a === this.action(this.def.clips.sitDown);
  }

  private playOneShot(
    name: string,
    timeScale: number,
    repeats = 1,
    emoteId: OverheadEmoteId | null = null,
  ): void {
    const a = this.action(name);
    if (!a) return;
    const prev = this.current;
    if (prev === a) a.stop();
    a.reset();
    const repeatCount = Math.max(1, Math.floor(repeats));
    a.setLoop(repeatCount === 1 ? THREE.LoopOnce : THREE.LoopRepeat, repeatCount);
    // clamp on the last frame: an unclamped LoopOnce action zeroes its weight
    // the instant it finishes, which blends the rig toward bind pose for the
    // whole 0.18s hand-off fade (a visible T-pose pop after every swing)
    a.clampWhenFinished = true;
    a.timeScale = timeScale;
    if (prev && prev !== a) prev.fadeOut(ONESHOT_FADE);
    a.fadeIn(ONESHOT_FADE).play();
    this.current = a;
    this.currentIsOneShot = true;
    this.currentOneShotIsEmote = emoteId !== null;
  }

  private onFinished(a: THREE.AnimationAction): void {
    if (this.deadLock) return; // death clip clamps on its last frame
    if (this.baseState === 'sit' && a === this.action(this.def.clips.sitDown)) {
      this.fadeTo(this.action(this.def.clips.sitIdle) ?? a, 0.25, false);
      return;
    }
    if (a === this.current) {
      this.currentIsOneShot = false;
      this.currentOneShotIsEmote = false;
      this.fadeTo(this.baseAction(), 0.18, false);
    }
  }

  private enterDeath(): void {
    this.deadLock = true;
    this.currentIsOneShot = false;
    this.currentOneShotIsEmote = false;
    // Collapse the upright pick capsule to a flat, ground-hugging profile so a
    // near-eye click behind or above the now-lying corpse no longer intersects an
    // invisible standing column (issue 1486). The ground-level footprint stays, so
    // a lootable corpse remains clickable. Restored in revive(). Set here (not the
    // per-frame update) since it only changes on the death/revive edge, and this
    // runs on every enterDeath path including the created-already-dead snapshot.
    this.clickProxy.scale.y = pickProxyHeight(this.height, this.clickRadius, true);
    const death = this.action(this.def.clips.death);
    if (!death) return;
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
      this.mixer.update(0);
      return;
    }
    if (prev && prev !== death) prev.fadeOut(ONESHOT_FADE);
    death.fadeIn(ONESHOT_FADE).play();
    this.current = death;
  }

  private revive(): void {
    this.deadLock = false;
    this.baseState = 'idle';
    this.currentOneShotIsEmote = false;
    // Restore the upright pick capsule (the corpse-flatten from enterDeath).
    this.clickProxy.scale.y = pickProxyHeight(this.height, this.clickRadius, false);
    const death = this.action(this.def.clips.death);
    if (death) death.stop();
    const flourish = this.action(this.def.clips.flourish);
    if (flourish) {
      // skeletons claw back out of the ground; bosses taunt
      this.current = null;
      this.playOneShot(this.def.clips.flourish!, 1);
    } else {
      this.fadeTo(this.action(this.def.clips.idle), 0.2, false);
    }
  }
}

function clipNamesOf(def: VisualDef): string[] {
  const c = def.clips;
  return [
    c.idle,
    c.walk,
    c.run,
    c.death,
    ...(c.attack ?? []),
    ...(c.hit ?? []),
    c.cast,
    c.sitDown,
    c.sitIdle,
    c.swim,
    c.jump,
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
