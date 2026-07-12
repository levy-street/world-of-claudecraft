// Per-entity character visual: a SkeletonUtils clone of a manifest asset with
// its own AnimationMixer, a clip-driven state machine fed by renderer-derived
// state, a baked static idle-pose far LOD, and a shadow-only proxy for the
// mid-distance band. All geometry/materials are shared caches — dispose()
// only releases mixer bindings.
import * as THREE from 'three';
import { HOVER_COSMETICS } from '../../sim/content/hover_cosmetics';
import { WEAPON_SKINS } from '../../sim/content/weapon_skins';
import type { OverheadEmoteId } from '../../world_api';
import { GFX } from '../gfx';
import { HOVER_ATTACH, HOVER_FLAP, HOVER_VFX } from '../hover_vfx';
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
  hoverAttachmentPayload,
  prepareVisual,
  setHeldWeapon,
  skinEmissiveTexture,
  skinTexture,
  tintedFarMaterials,
} from './assets';
import type { EmoteClipSpec, VisualDef, WeaponLayoutOverride } from './manifest';
import { SKIN_ATTACK_CLIP_NAMES, weaponSkinAttackClips, weaponSkinOrientPin } from './skin_attack';

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
const HIT_REACT_COOLDOWN = 0.9;

// Lie_Idle already lays the rig flat — a touch of extra pitch reads as a
// surface glide; clip-less rigs (creatures) get the full procedural prone
const SWIM_PITCH_CLIP = 0.35;
const SWIM_PITCH_PROCEDURAL = 1.18;
const SWIM_RISE = 0.95; // body must break the surface or only the hat floats
// Hover cosmetics: the render-only levitation. The entity's sim position and
// speed never change (gameplay-neutral by the graphics-fairness rule); the
// VISUAL floats up and bobs, glides on the airborne pose instead of running,
// and leans forward slightly while moving.
const HOVER_RISE = 0.34;
const HOVER_BOB = 0.05;
const HOVER_LEAN = 0.16; // rad, while moving
const MIXER_DT_CAP = 0.3; // throttled entities never integrate a huge step
const GHOST_OPACITY = 0.34;
const SOUL_REND_OPACITY = 0.58;
const SOUL_REND_TINT = new THREE.Color(0x4f0505);

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
  // Hover cosmetic (back wings / jetpack): payload on the chest bone, wing
  // halves flapped procedurally, ambient VFX handle, and the live hover flag
  // the locomotion override reads.
  private hoverId: string | null = null;
  private hoverPayload: THREE.Object3D | null = null;
  private hoverWings: { l: THREE.Object3D | null; r: THREE.Object3D | null } = {
    l: null,
    r: null,
  };
  private hoverVfx: WeaponVfxHandle | null = null;
  private hoverFlapPhase = Math.random() * Math.PI * 2;
  private hoverActive = false;
  private hoverLean = 0;
  private weaponVfxSpriteScale = WORLD_FOV_SPRITE_SCALE;
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

    // death is a level sim-side — edge-trigger the clip locally
    if (s.dead && !this.wasDead) this.enterDeath();
    else if (!s.dead && this.wasDead) this.revive();
    this.wasDead = s.dead;
    this.initialized = true;

    if (!this.deadLock) {
      // The hover glide swaps the locomotion CLIP without a baseState change,
      // so a hover flip re-fades the base action like a state edge.
      const hovering = this.hoverPayload !== null && !s.dead && !s.swimming && !s.sitting;
      const hoverChanged = hovering !== this.hoverActive;
      this.hoverActive = hovering;
      const desired = this.desiredBase(s);
      const baseChanged = desired !== this.baseState || hoverChanged;
      if (baseChanged) this.baseState = desired;
      if (this.currentOneShotIsEmote && this.shouldInterruptEmote(s)) {
        this.currentIsOneShot = false;
        this.currentOneShotIsEmote = false;
        this.fadeTo(this.baseAction(), FADE, false);
      } else if (baseChanged && !this.currentIsOneShot) {
        this.fadeTo(this.baseAction(), FADE, false);
      }
      // foot-speed matching on locomotion cycles (the hover glide is not a
      // footstep cycle: it keeps its authored speed)
      if (!this.currentIsOneShot && this.current && !this.hoverActive) {
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
    // Hovering leans forward slightly while moving (the glide reads as drift,
    // not a stroll); eased like the swim pitch.
    const wantLean = this.hoverActive && s.moving ? HOVER_LEAN : 0;
    this.hoverLean += (wantLean - this.hoverLean) * Math.min(1, dt * 6);
    this.poseWrap.rotation.x = this.swimPitch + this.hoverLean;
    this.poseWrap.rotation.z = 0;
    this.poseWrap.position.y =
      s.swimming && !s.dead
        ? SWIM_RISE + Math.sin(performance.now() / 500 + this.bobPhase) * 0.08
        : this.hoverActive
          ? HOVER_RISE + Math.sin(performance.now() / 640 + this.bobPhase) * HOVER_BOB
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
    }
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

  /** Apply or clear a hover cosmetic: hang the wings / jetpack payload on the
   *  chest bone (back mount), find the wing halves for the procedural flap,
   *  and light the ambient VFX. The hover MOTION reads hoverActive per frame
   *  in update(). */
  setHoverCosmetic(hoverId: string | null): void {
    if (hoverId === this.hoverId) return;
    this.hoverId = hoverId;
    this.disposeHoverAttachment();
    const def = hoverId ? HOVER_COSMETICS[hoverId] : null;
    if (!def) return;
    const chest = this.model.getObjectByName('chest') ?? this.model.getObjectByName('spine');
    if (!chest) return;
    const payload = hoverAttachmentPayload(def.id);
    if (!payload) return;
    const mount = HOVER_ATTACH[def.model];
    if (mount) {
      payload.position.set(mount.pos[0], mount.pos[1], mount.pos[2]);
      payload.rotation.y = mount.rotY;
      payload.scale.setScalar(mount.scale);
    }
    chest.add(payload);
    this.hoverPayload = payload;
    // GLTFLoader sanitizes node names (wing.l arrives as wingl): try both.
    this.hoverWings = {
      l: payload.getObjectByName('wing.l') ?? payload.getObjectByName('wingl') ?? null,
      r: payload.getObjectByName('wing.r') ?? payload.getObjectByName('wingr') ?? null,
    };
    const vfx = createWeaponVfx(payload, HOVER_VFX[def.vfx], { grounded: false });
    vfx.setBackdropVisible(false);
    vfx.setTuning({});
    vfx.setPixelScale(weaponVfxViewportHeight * this.weaponVfxSpriteScale);
    vfx.group.traverse((o) => {
      o.userData.weaponVfxMesh = true;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = false;
    });
    this.hoverVfx = vfx;
  }

  private disposeHoverAttachment(): void {
    if (this.hoverVfx) {
      this.hoverVfx.dispose();
      this.hoverVfx = null;
    }
    if (this.hoverPayload) {
      this.hoverPayload.removeFromParent();
      this.hoverPayload = null;
    }
    this.hoverWings = { l: null, r: null };
  }

  private reattachHeldWeapon(): void {
    this.disposeWeaponVfx();
    const payloads = setHeldWeapon(this.model, this.def, this.weaponItemId, this.weaponSkinId);
    // Ranged skins take a root-relative orientation pin (position always rides
    // the hand): a bow aims upright WHILE the shot one-shot plays (the string
    // hand rolls a glued bow sideways mid-draw); a bow-slot gun carries muzzle
    // forward OUTSIDE the shot (the hanging idle arm points it at the ground)
    // and keeps the hand-tuned grip during the shouldered aim
    // (applySkinOrientation each frame).
    {
      const mode = weaponSkinOrientPin(this.weaponSkinId);
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

  /** Advance the weapon-skin VFX (shader time, pulse, flicker). Cheap no-op
   *  without an active skin; the renderer calls it once per entity per frame.
   *  Also re-pins bow payload orientation (see reattachHeldWeapon). */
  updateWeaponVfx(dt: number): void {
    this.applySkinOrientation(dt);
    for (const handle of this.weaponVfx) handle.update(dt);
    if (this.hoverPayload) {
      // Procedural wing flap: both halves hinge about the central mount. The
      // beat keeps a gentle idle rhythm and doubles while actively hovering.
      // Axis 'y' folds the wings open/closed (a resting butterfly); axis 'z'
      // beats the tips up and down (feathered / membrane wings in flight).
      const def = this.hoverId ? HOVER_COSMETICS[this.hoverId] : null;
      const flap = def ? HOVER_FLAP[def.model] : undefined;
      if (flap && (this.hoverWings.l || this.hoverWings.r)) {
        this.hoverFlapPhase += dt * flap.speed * (this.hoverActive ? 1 : 0.45);
        const a = Math.sin(this.hoverFlapPhase) * flap.amp;
        if (this.hoverWings.l) this.hoverWings.l.rotation[flap.axis] = a;
        if (this.hoverWings.r) this.hoverWings.r.rotation[flap.axis] = -a;
      }
      this.hoverVfx?.update(dt);
    }
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
    this.hoverVfx?.setPixelScale(heightPx * this.weaponVfxSpriteScale);
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
    this.disposeHoverAttachment();
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
    if (this.soulRend) return this.soulRendMaterial(material);
    if (this.ghosted) return this.ghostMaterial(material);
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

  private action(name: string | undefined): THREE.AnimationAction | null {
    return name ? (this.actions.get(name) ?? null) : null;
  }

  private baseAction(): THREE.AnimationAction | null {
    const c = this.def.clips;
    // Hover glide: MOVING locomotion states ride the airborne pose (the
    // wings/jetpack carry the character; feet never run). Standing still keeps
    // the normal idle, calmly afloat on the lift + bob; casting, sitting,
    // swimming, jumping, and death keep their own clips.
    if (
      this.hoverActive &&
      (this.baseState === 'walk' || this.baseState === 'walkBack' || this.baseState === 'run')
    ) {
      return this.action(c.jump) ?? this.action(c.idle);
    }
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
