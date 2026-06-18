// Per-entity character visual: a SkeletonUtils clone of a manifest asset with
// its own AnimationMixer, a clip-driven state machine fed by renderer-derived
// state, a baked static idle-pose far LOD, and a shadow-only proxy for the
// mid-distance band. All geometry/materials are shared caches — dispose()
// only releases mixer bindings.
import * as THREE from 'three';
import type { OverheadEmoteId } from '../../world_api';
import { GFX } from '../gfx';
import { glitterShardTexture, glitterSoftTexture } from '../textures';
import type { EmoteClipSpec, VisualDef } from './manifest';
import {
  applyMaterials, assembleModel, prepareVisual, skinTexture, syncWeaponAttachments, tintedFarMaterials,
} from './assets';
import { desiredBaseState, locomotionTimeScale, type AnimState, type BaseState } from './anim_state';

export type { AnimState, BaseState } from './anim_state';

const FADE = 0.22;
const ONESHOT_FADE = 0.1;
const HIT_REACT_COOLDOWN = 0.9;
// Lie_Idle already lays the rig flat — a touch of extra pitch reads as a
// surface glide; clip-less rigs (creatures) get the full procedural prone
const SWIM_PITCH_CLIP = 0.35;
const SWIM_PITCH_PROCEDURAL = 1.18;
const SWIM_RISE = 0.95; // body must break the surface or only the hat floats
const MIXER_DT_CAP = 0.3; // throttled entities never integrate a huge step
const GHOST_OPACITY = 0.34;
const ENH_SPARKLE_HDR = 2.0;

interface WeaponSpan {
  axis: 0 | 1 | 2;
  min: number;
  max: number;
  center: THREE.Vector3;
  perpA: 0 | 1 | 2;
  perpB: 0 | 1 | 2;
  perpRadius: number;
}

interface GlitterSlot {
  base: THREE.Vector3;
  phase: number;
  spin: number;
  size: number;
  sharp: boolean;
  rateA: number;
  rateB: number;
  rateC: number;
  orbitRate: number;
  drift: number;
}

const _weaponBox = new THREE.Box3();
const _weaponCorner = new THREE.Vector3();
const _weaponSize = new THREE.Vector3();

function glitterCount(level: number): number {
  if (level >= 9) return 26;
  if (level >= 8) return 14;
  if (level >= 7) return 6;
  return 0;
}

function glitterTier(level: number): {
  size: number; peakOpacity: number; floorOpacity: number; twinkleScale: number; motionScale: number; gleam: number;
} {
  if (level >= 9) return { size: 0.14, peakOpacity: 0.82, floorOpacity: 0.04, twinkleScale: 1.05, motionScale: 1.55, gleam: 0.38 };
  if (level >= 8) return { size: 0.11, peakOpacity: 0.64, floorOpacity: 0.03, twinkleScale: 0.92, motionScale: 1.3, gleam: 0.28 };
  return { size: 0.08, peakOpacity: 0.38, floorOpacity: 0.02, twinkleScale: 0.8, motionScale: 1.05, gleam: 0.18 };
}

/** Layered organic shimmer — soft breathing glow with occasional gentle gleam peaks. */
function organicTwinkle(t: number, slot: GlitterSlot, gleam: number): number {
  const a = 0.5 + 0.5 * Math.sin(t * slot.rateA + slot.phase);
  const b = 0.5 + 0.5 * Math.sin(t * slot.rateB + slot.phase * 1.618);
  const c = 0.5 + 0.5 * Math.sin(t * slot.rateC + slot.phase * 2.399);
  const breath = 0.6 + 0.4 * Math.sin(t * slot.drift * 0.5 + slot.phase * 0.71);
  const blend = (a * 0.4 + b * 0.35 + c * 0.25) * breath;
  const soft = blend * blend * (3 - 2 * blend);
  const gleamPeak = Math.pow(Math.max(0, Math.sin(t * slot.rateA * 1.25 + slot.phase * 0.53)), 3.2) * gleam;
  return Math.min(1, soft * 0.7 + gleamPeak + blend * 0.18);
}

function axisCoord(v: THREE.Vector3, axis: 0 | 1 | 2): number {
  return axis === 0 ? v.x : axis === 1 ? v.y : v.z;
}

function setAxisCoord(v: THREE.Vector3, axis: 0 | 1 | 2, value: number): void {
  if (axis === 0) v.x = value;
  else if (axis === 1) v.y = value;
  else v.z = value;
}

function slotHash(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

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

  private def: VisualDef;
  private key: string;
  private entityColor: number;
  private skinIndex: number;
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
  private bobPhase = Math.random() * Math.PI * 2;
  private mainhandItemId: string | null = null;

  private mainhandEnhance = 0;
  private mainhandWeaponMeshes: THREE.Mesh[] = [];
  private weaponSpan: WeaponSpan | null = null;
  private glitterSlots: GlitterSlot[] = [];
  private enhanceGlitters: THREE.Sprite[] = [];
  private sparkleBone: THREE.Object3D | null = null;

  constructor(key: string, entityColor: number, skinIndex = 0) {
    const prep = prepareVisual(key);
    this.def = prep.def;
    this.key = key;
    this.entityColor = entityColor;
    this.skinIndex = skinIndex;
    this.height = prep.def.height;

    // model: yaw/scale/feet normalization wrapper around the skinned clone
    this.model = assembleModel(prep.def);
    applyMaterials(this.model, prep.def, entityColor, skinTexture(key, skinIndex));
    this.collectMainhandWeaponMeshes();
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) this.originalMaterials.set(mesh, mesh.material);
    });
    this.sparkleBone = this.model.getObjectByName('handslotr')
      ?? this.model.getObjectByName('handslot.r')
      ?? this.modelWrap;
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
      this.farMesh = new THREE.Mesh(prep.idleGeo, tintedFarMaterials(prep.def, entityColor, prep.idleSrcMats));
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
    this.clickProxy = new THREE.Mesh(clickGeo(), clickMat());
    this.clickProxy.scale.set(r * 2, this.height, r * 2);
    this.clickProxy.visible = false;
    this.root.add(this.clickProxy);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const name of clipNamesOf(prep.def)) {
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
          if (timeScale < 0 && this.current.time <= 1e-3) this.current.time = Math.max(0, this.current.getClip().duration - 1e-3);
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
    this.poseWrap.position.y = s.swimming && !s.dead
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
    }
    this.tickMainhandEnhanceFx(dt);
  }

  // -------------------------------------------------------------------------
  // One-shot triggers (sim events)
  // -------------------------------------------------------------------------

  playAttack(): void {
    if (this.deadLock) return;
    const clips = this.def.clips.attack;
    if (clips.length === 0) return;
    const name = clips[this.attackIdx++ % clips.length];
    this.playOneShot(name, this.def.attackTimeScale ?? 1.3);
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
    for (const [mesh, original] of this.originalMaterials) {
      mesh.material = on ? this.toGhostMaterial(original) : original;
    }
    if (this.farMesh && this.farMaterials) {
      this.farMesh.material = on ? this.toGhostMaterial(this.farMaterials) : this.farMaterials;
    }
  }

  /** Swap the body skin (alternate texture atlas) at runtime; no-op if unchanged.
   *  Reuses the shared skin-keyed material cache, so this is a cheap reassign. */
  setSkin(skinIndex: number): void {
    if (skinIndex === this.skinIndex) return;
    this.skinIndex = skinIndex;
    applyMaterials(this.model, this.def, this.entityColor, skinTexture(this.key, skinIndex));
    this.collectMainhandWeaponMeshes();
    // re-snapshot the material map ghost/restore relies on, then re-ghost if stealthed
    this.originalMaterials.clear();
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) this.originalMaterials.set(mesh, mesh.material);
    });
    if (this.ghosted) this.setGhost(true);
    this.resetWeaponEmissive();
    this.syncEnhanceGlitters();
  }

  /** +7/+8/+9 mainhand glitter — sprite-only, distributed along the full weapon. */
  setMainhandEnhance(level: number): void {
    const next = Math.max(0, Math.min(9, Math.floor(level)));
    if (next === this.mainhandEnhance) return;
    this.mainhandEnhance = next;
    this.resetWeaponEmissive();
    this.syncEnhanceGlitters();
  }

  /** Mainhand prop meshes only — clone materials so prior glow experiments never leak. */
  private collectMainhandWeaponMeshes(): void {
    this.mainhandWeaponMeshes = [];
    this.weaponSpan = null;
    const handBone = this.model.getObjectByName('handslotr')
      ?? this.model.getObjectByName('handslot.r');
    if (!handBone) return;
    handBone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => m.clone());
      else mesh.material = mesh.material.clone();
      this.mainhandWeaponMeshes.push(mesh);
    });
    this.measureWeaponSpan(handBone);
  }

  /** Weapon AABB in hand-bone space — glitter slots span grip to tip on the long axis. */
  private measureWeaponSpan(handBone: THREE.Object3D): void {
    _weaponBox.makeEmpty();
    handBone.updateWorldMatrix(true, true);
    for (const mesh of this.mainhandWeaponMeshes) {
      mesh.updateWorldMatrix(true, false);
      const gb = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox);
      if (!gb) continue;
      const { min, max } = gb;
      for (const xi of [min.x, max.x]) {
        for (const yi of [min.y, max.y]) {
          for (const zi of [min.z, max.z]) {
            _weaponCorner.set(xi, yi, zi).applyMatrix4(mesh.matrixWorld);
            handBone.worldToLocal(_weaponCorner);
            _weaponBox.expandByPoint(_weaponCorner);
          }
        }
      }
    }
    if (_weaponBox.isEmpty()) {
      this.weaponSpan = {
        axis: 1, min: 0.02, max: 0.48,
        center: new THREE.Vector3(0, 0.25, 0),
        perpA: 0, perpB: 2, perpRadius: 0.035,
      };
      return;
    }
    _weaponBox.getSize(_weaponSize);
    const axis: 0 | 1 | 2 = _weaponSize.x >= _weaponSize.y && _weaponSize.x >= _weaponSize.z
      ? 0 : _weaponSize.y >= _weaponSize.z ? 1 : 2;
    const axes: (0 | 1 | 2)[] = [0, 1, 2];
    const perp = axes.filter((a) => a !== axis);
    const center = _weaponBox.getCenter(new THREE.Vector3());
    const perpRadius = Math.max(
      0.02,
      axisCoord(_weaponSize, perp[0]) * 0.42,
      axisCoord(_weaponSize, perp[1]) * 0.42,
    );
    this.weaponSpan = {
      axis,
      min: axis === 0 ? _weaponBox.min.x : axis === 1 ? _weaponBox.min.y : _weaponBox.min.z,
      max: axis === 0 ? _weaponBox.max.x : axis === 1 ? _weaponBox.max.y : _weaponBox.max.z,
      center,
      perpA: perp[0],
      perpB: perp[1],
      perpRadius,
    };
  }

  private resetWeaponEmissive(): void {
    const tint = (mat: THREE.Material): void => {
      const m = mat as THREE.MeshStandardMaterial & THREE.MeshLambertMaterial;
      if (!('emissive' in m) || !m.emissive) return;
      m.emissive.setHex(0x000000);
      m.emissiveIntensity = 0;
    };
    for (const mesh of this.mainhandWeaponMeshes) {
      if (Array.isArray(mesh.material)) mesh.material.forEach(tint);
      else tint(mesh.material);
    }
  }

  private buildGlitterSlots(level: number): GlitterSlot[] {
    const count = glitterCount(level);
    const span = this.weaponSpan ?? {
      axis: 1 as const, min: 0.02, max: 0.48,
      center: new THREE.Vector3(0, 0.25, 0),
      perpA: 0 as const, perpB: 2 as const, perpRadius: 0.035,
    };
    const tier = glitterTier(level);
    const slots: GlitterSlot[] = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const along = span.min + (span.max - span.min) * t;
      const pos = span.center.clone();
      setAxisCoord(pos, span.axis, along);
      const ja = (slotHash(i, 1.1) - 0.5) * span.perpRadius * 2;
      const jb = (slotHash(i, 2.7) - 0.5) * span.perpRadius * 2;
      setAxisCoord(pos, span.perpA, axisCoord(pos, span.perpA) + ja);
      setAxisCoord(pos, span.perpB, axisCoord(pos, span.perpB) + jb);
      slots.push({
        base: pos,
        phase: slotHash(i, 3.9) * Math.PI * 2,
        spin: (slotHash(i, 5.3) - 0.5) * 1.4,
        size: tier.size * (0.75 + slotHash(i, 7.1) * 0.5),
        sharp: i % 3 !== 1,
        rateA: 0.85 + slotHash(i, 8.2) * 1.15,
        rateB: 0.65 + slotHash(i, 9.4) * 0.95,
        rateC: 0.48 + slotHash(i, 10.6) * 0.72,
        orbitRate: 0.5 + slotHash(i, 11.8) * 0.78,
        drift: 0.32 + slotHash(i, 12.9) * 0.48,
      });
    }
    return slots;
  }

  private tickMainhandEnhanceFx(dt: number): void {
    if (this.mainhandEnhance < 7) return;
    const tier = glitterTier(this.mainhandEnhance);
    const wall = performance.now() * 0.001;
    const tTwinkle = wall * tier.twinkleScale + this.bobPhase;
    const tMotion = wall * tier.motionScale + this.bobPhase;
    const span = this.weaponSpan;
    const bladeLen = span ? Math.max(0.08, span.max - span.min) : 0.4;
    const hdrBase = GFX.composer ? ENH_SPARKLE_HDR : 1;
    for (let i = 0; i < this.enhanceGlitters.length; i++) {
      const slot = this.glitterSlots[i];
      const sprite = this.enhanceGlitters[i];
      if (!slot || !sprite) continue;
      const mat = sprite.material as THREE.SpriteMaterial;
      const shimmer = organicTwinkle(tTwinkle, slot, tier.gleam);
      const orbit = tMotion * slot.orbitRate + slot.phase;
      const orbit2 = tMotion * slot.orbitRate * 0.58 + slot.phase * 1.73;
      sprite.position.copy(slot.base);
      if (span) {
        const crawl = Math.sin(tMotion * slot.drift + slot.phase * 1.4) * bladeLen * 0.055;
        const lift = Math.sin(tMotion * slot.drift * 1.2 + slot.phase * 0.6) * 0.016;
        setAxisCoord(sprite.position, span.axis, axisCoord(sprite.position, span.axis) + crawl);
        setAxisCoord(sprite.position, span.perpA,
          axisCoord(sprite.position, span.perpA) + Math.sin(orbit) * span.perpRadius * 0.42
            + Math.cos(orbit2) * span.perpRadius * 0.16);
        setAxisCoord(sprite.position, span.perpB,
          axisCoord(sprite.position, span.perpB) + Math.cos(orbit * 1.19) * span.perpRadius * 0.42
            + Math.sin(orbit2) * span.perpRadius * 0.16);
        setAxisCoord(sprite.position, span.axis, axisCoord(sprite.position, span.axis) + lift);
      }
      const s = slot.size * (0.58 + shimmer * 0.48);
      sprite.scale.set(s, s, 1);
      mat.opacity = tier.floorOpacity + shimmer * tier.peakOpacity;
      mat.color.setScalar(hdrBase * (0.92 + shimmer * 0.55));
      mat.rotation += slot.spin * dt * 1.6;
      sprite.visible = true;
    }
  }

  private syncEnhanceGlitters(): void {
    this.clearEnhanceGlitters();
    if (this.mainhandEnhance < 7 || !this.sparkleBone) return;
    this.glitterSlots = this.buildGlitterSlots(this.mainhandEnhance);
    for (const slot of this.glitterSlots) {
      const mat = new THREE.SpriteMaterial({
        map: slot.sharp ? glitterShardTexture() : glitterSoftTexture(),
        transparent: true,
        depthWrite: false,
        color: new THREE.Color(0xeaf6ff),
        opacity: 0,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(slot.base);
      sprite.scale.set(slot.size, slot.size, 1);
      sprite.visible = false;
      this.sparkleBone.add(sprite);
      this.enhanceGlitters.push(sprite);
    }
  }

  private clearEnhanceGlitters(): void {
    for (const sprite of this.enhanceGlitters) sprite.parent?.remove(sprite);
    this.enhanceGlitters = [];
    this.glitterSlots = [];
  }

  /** Swap attached weapon props when mainhand equipment changes (epic item models). */
  setMainhand(itemId: string | null): void {
    const next = itemId ?? null;
    if (next === this.mainhandItemId) return;
    this.mainhandItemId = next;
    syncWeaponAttachments(this.model, this.def, next);
  }

  dispose(): void {
    this.clearEnhanceGlitters();
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

  private toGhostMaterial<T extends THREE.Material | THREE.Material[]>(material: T): T {
    if (Array.isArray(material)) return material.map((m) => this.ghostMaterial(m)) as T;
    return this.ghostMaterial(material) as T;
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

  private action(name: string | undefined): THREE.AnimationAction | null {
    return name ? this.actions.get(name) ?? null : null;
  }

  private baseAction(): THREE.AnimationAction | null {
    const c = this.def.clips;
    switch (this.baseState) {
      case 'walk': return this.action(c.walk) ?? this.action(c.idle);
      case 'walkBack': return this.action(c.walkBack) ?? this.action(c.walk);
      case 'run': return this.action(c.run) ?? this.action(c.walk);
      case 'cast': return this.action(c.cast) ?? this.action(c.idle);
      case 'swim': return this.action(c.swim) ?? this.action(c.idle);
      case 'sit': return this.action(c.sitDown) ?? this.action(c.sitIdle) ?? this.action(c.idle);
      case 'jump': return this.action(c.jump) ?? this.action(c.idle);
      default: return this.action(c.idle);
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

  private playOneShot(name: string, timeScale: number, repeats = 1, emoteId: OverheadEmoteId | null = null): void {
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
    c.idle, c.walk, c.run, c.death,
    ...(c.attack ?? []), ...(c.hit ?? []),
    c.cast, c.sitDown, c.sitIdle, c.swim, c.jump, c.walkBack, c.flourish,
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
