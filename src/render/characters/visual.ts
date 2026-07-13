// Per-entity character visual: a SkeletonUtils clone of a manifest asset with
// its own AnimationMixer, a clip-driven state machine fed by renderer-derived
// state, a baked static idle-pose far LOD, and a shadow-only proxy for the
// mid-distance band. All geometry/materials are shared caches — dispose()
// only releases mixer bindings.
import * as THREE from 'three';
import { ITEMS } from '../../sim/data';
import { weaponHand } from '../../sim/equipment_rules';
import type { OverheadEmoteId } from '../../world_api';
import type { FormTint } from '../form_tint';
import { GFX } from '../gfx';
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
  setHeldItems,
  skinEmissiveTexture,
  skinTexture,
  tintedFarMaterials,
} from './assets';
import { buildHalo } from './halo';
import type { EmoteClipSpec, VisualDef, WeaponLayoutOverride } from './manifest';

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
// Bladestorm whirl: how fast the body spins on itself (radians/sec, ~2.2
// turns/sec; operator asked for a visibly quicker whirl than the classic
// ~1.75) and the swing-loop speed.
const SPIN_RATE = 14;
const SPIN_ATTACK_TIMESCALE = 1.6;
// Bladed Gyre (the INSTANT whirlwind): one quick self-spin rather than the held
// Bladestorm channel. About 1.6 turns over the short duration reads as a snappy
// little tornado, then the body snaps back to its facing.
const SPIN_ONCE_DURATION = 0.55; // seconds
const SPIN_ONCE_RATE = 18; // rad/sec
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
  private mainhandItemId: string | null;
  private offhandItemId: string | null;
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
  private weaponAuraMeshes: THREE.Mesh[] = [];
  private weaponAuraOn = false;
  private ghostMaterials = new Map<THREE.Material, THREE.Material>();
  private soulRendMaterials = new Map<THREE.Material, THREE.Material>();
  private formTintMaterials = new Map<string, Map<THREE.Material, THREE.Material>>();

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
  private spinAngle = 0;
  private spinOnceTimer = 0;

  private shadowOn = true;
  private far = false;
  private soulRend = false;
  private formTint: FormTint | null = null;
  private formTintSig = '';
  private bobPhase = Math.random() * Math.PI * 2;

  constructor(
    key: string,
    entityColor: number,
    skinIndex = 0,
    mainhandItemId: string | null = null,
    offhandItemId: string | null = null,
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
    this.mainhandItemId = mainhandItemId;
    this.offhandItemId = offhandItemId;
    this.height = prep.def.height;

    // model: yaw/scale/feet normalization wrapper around the skinned clone. The
    // Equipped held items (if the class swaps; see VisualDef.weaponSlots) pick
    // the visible weapon/shield models, so the visual is born holding live gear.
    this.model = assembleModel(this.def, [mainhandItemId, offhandItemId]);
    applyMaterials(
      this.model,
      this.def,
      entityColor,
      skinTexture(key, skinIndex),
      skinEmissiveTexture(key, skinIndex),
    );
    // Class halo (the priest's Light): a glowing ring behind the head bone.
    // Added AFTER applyMaterials (its additive material must not be re-mapped)
    // and BEFORE the originalMaterials snapshot, so ghost/stealth material
    // swaps restore it like any other mesh.
    if (this.def.halo !== undefined) {
      const head = this.model.getObjectByName('head');
      head?.add(buildHalo(this.def.halo));
    }
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
          if (timeScale < 0 && this.current.time <= 1e-3)
            this.current.time = Math.max(0, this.current.getClip().duration - 1e-3);
          this.current.timeScale = timeScale;
        }
        // the whirl swings faster than a normal one-shot attack
        if (this.baseState === 'spin') this.current.timeScale = SPIN_ATTACK_TIMESCALE;
      }
    }

    // Bladestorm whirl: spin the body on itself while the channel runs. The
    // yaw rides poseWrap (relative to the renderer-driven facing), and snaps
    // back to 0 the moment the channel ends so facing is authoritative again.
    if (s.spinning && !s.dead) {
      this.spinAngle = (this.spinAngle + dt * SPIN_RATE) % (Math.PI * 2);
      this.spinOnceTimer = 0; // the held channel supersedes a one-shot whirl
    } else if (this.spinOnceTimer > 0 && !s.dead) {
      // Bladed Gyre: one quick spin, then snap the body back to its facing.
      this.spinOnceTimer = Math.max(0, this.spinOnceTimer - dt);
      this.spinAngle =
        this.spinOnceTimer > 0 ? (this.spinAngle + dt * SPIN_ONCE_RATE) % (Math.PI * 2) : 0;
    } else {
      this.spinAngle = 0;
    }
    this.poseWrap.rotation.y = this.spinAngle;

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
    if (this.farMesh?.visible) {
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

  playAttack(abilityId?: string): void {
    if (this.deadLock) return;
    // A mapped ability plays its specific swing clip (if the model has it);
    // a plain auto then swings by weapon style (two-hander overhead / dual
    // wield double chop) when the manifest maps one, and everything else
    // rotates through the generic attack clips for variety.
    const override = abilityId ? this.def.clips.attackByAbility?.[abilityId] : undefined;
    if (override && this.action(override)) {
      this.playOneShot(override, this.def.attackTimeScale ?? 1.3);
      return;
    }
    const style = this.weaponSwingStyle();
    const handClip = style ? this.def.clips.attackByHand?.[style] : undefined;
    if (handClip && this.action(handClip)) {
      this.playOneShot(handClip, this.def.attackTimeScale ?? 1.3);
      return;
    }
    const clips = this.def.clips.attack;
    if (clips.length === 0) return;
    const name = clips[this.attackIdx++ % clips.length];
    this.playOneShot(name, this.def.attackTimeScale ?? 1.3);
  }

  /** 'dualwield' when both hands hold weapons (checked first: a Titan's Grip
   *  pair must read as two one-hand swings, never the two-handed overhead),
   *  'twohand' for a lone two-handed mainhand; null keeps the rotation. */
  private weaponSwingStyle(): 'twohand' | 'dualwield' | null {
    const mh = this.mainhandItemId ? ITEMS[this.mainhandItemId] : undefined;
    if (mh?.kind !== 'weapon') return null;
    const oh = this.offhandItemId ? ITEMS[this.offhandItemId] : undefined;
    if (oh?.kind === 'weapon') return 'dualwield';
    return weaponHand(mh) === 'twohand' ? 'twohand' : null;
  }

  /** Instant whirlwind (Bladed Gyre): swing the blades fast while the body does
   *  a single quick self-spin. Retriggering (each AoE target hit) just refreshes
   *  the timer, so the whole spin holds for one duration. */
  playWhirl(): void {
    if (this.deadLock) return;
    this.spinOnceTimer = SPIN_ONCE_DURATION;
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

  playEmote(id: OverheadEmoteId, repeatsOverride?: number): void {
    if (this.deadLock) return;
    const spec = this.def.clips.emote?.[id];
    const clip = firstLoadedEmoteClip(spec, (name) => this.action(name));
    if (!clip) return;
    // A caller may cap the repeats (the warrior shout roars ONCE; the chat
    // /cheer keeps its double pump from the spec).
    this.playOneShot(clip, spec?.timeScale ?? 1, repeatsOverride ?? spec?.repeats ?? 1, id);
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

  setFormTint(tint: FormTint | null): void {
    const sig = tint ? `${tint.color}:${tint.opacity}` : '';
    if (sig === this.formTintSig) return;
    this.formTint = tint;
    this.formTintSig = sig;
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
      if (mesh.isMesh) this.originalMaterials.set(mesh, mesh.material);
    });
    this.applyVisualMaterials();
  }

  /** Swap the held item models at runtime (gear equip/unequip); no-op if unchanged
   *  or if this class keeps fixed props. Mirrors setSkin: re-attach the prop(s),
   *  re-run the shared material pass, re-snapshot the original-material map, then
   *  re-apply any active ghost/soul-rend overlay. */
  setWeapons(mainhandItemId: string | null, offhandItemId: string | null): void {
    if (mainhandItemId === this.mainhandItemId && offhandItemId === this.offhandItemId) return;
    this.mainhandItemId = mainhandItemId;
    this.offhandItemId = offhandItemId;
    if (!this.def.weaponSlots?.length) return;
    setHeldItems(this.model, this.def, [mainhandItemId, offhandItemId]);
    applyMaterials(
      this.model,
      this.def,
      this.entityColor,
      skinTexture(this.key, this.skinIndex),
      skinEmissiveTexture(this.key, this.skinIndex),
    );
    // the model graph changed (weapon meshes added/removed): rebuild the caster
    // list and re-snapshot originals, then re-apply ghost/stealth overlays.
    this.originalMaterials.clear();
    this.rebuildCasters();
    this.applyVisualMaterials();
    this.rebuildWeaponAura();
  }

  /** Adds a lightweight additive overlay to the equipped mainhand only. */
  setWeaponAura(on: boolean): void {
    if (on === this.weaponAuraOn) return;
    this.weaponAuraOn = on;
    this.rebuildWeaponAura();
  }

  private rebuildWeaponAura(): void {
    for (const mesh of this.weaponAuraMeshes) {
      mesh.removeFromParent();
      (mesh.material as THREE.Material).dispose();
    }
    this.weaponAuraMeshes.length = 0;
    if (!this.weaponAuraOn) return;

    const weaponHolders: THREE.Object3D[] = [];
    this.model.traverse((o) => {
      if (o.userData.swapWeaponHolder) weaponHolders.push(o);
    });
    // Pick the MAINHAND holder by its stamped held slot (0 = mainhand): traverse
    // order is not slot order, so "first found" used to land the glow on the
    // offhand shield. Legacy holders without the stamp fall back to first-found.
    const mainhand = weaponHolders.find((o) => o.userData.heldSlot === 0) ?? weaponHolders[0];
    if (!mainhand) return;
    mainhand.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData.weaponMesh || !mesh.parent) return;
      const aura = new THREE.Mesh(
        mesh.geometry,
        new THREE.MeshBasicMaterial({
          color: 0x45ff9a,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      aura.position.copy(mesh.position);
      aura.quaternion.copy(mesh.quaternion);
      aura.scale.copy(mesh.scale).multiplyScalar(1.08);
      aura.renderOrder = 3;
      mesh.parent.add(aura);
      this.weaponAuraMeshes.push(aura);
    });
  }

  /** Rebuild the shadow-caster list and original-material snapshot after the model
   *  graph changes (a weapon swap adds/removes bone-child meshes). */
  private rebuildCasters(): void {
    this.casters.length = 0;
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = this.shadowOn;
      mesh.receiveShadow = false;
      if ((mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
      this.originalMaterials.set(mesh, mesh.material);
      this.casters.push(mesh);
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const mesh of this.weaponAuraMeshes) {
      mesh.removeFromParent();
      (mesh.material as THREE.Material).dispose();
    }
    this.weaponAuraMeshes.length = 0;
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
    let effected = material;
    if (this.soulRend) effected = this.soulRendMaterial(effected);
    else if (this.ghosted) effected = this.ghostMaterial(effected);
    if (this.formTint) effected = this.formTintMaterial(effected, this.formTint);
    return effected;
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

  private formTintMaterial(material: THREE.Material, tint: FormTint): THREE.Material {
    let byMaterial = this.formTintMaterials.get(this.formTintSig);
    if (!byMaterial) {
      byMaterial = new Map<THREE.Material, THREE.Material>();
      this.formTintMaterials.set(this.formTintSig, byMaterial);
    }
    const cached = byMaterial.get(material);
    if (cached) return cached;
    const tinted = material.clone();
    const withColor = tinted as THREE.Material & {
      color?: THREE.Color;
      opacity: number;
    };
    if (withColor.color) withColor.color.multiply(new THREE.Color(tint.color));
    if (tint.opacity < 1) {
      tinted.transparent = true;
      withColor.opacity *= tint.opacity;
      tinted.depthWrite = false;
    }
    byMaterial.set(material, tinted);
    return tinted;
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
      case 'spin':
        // loop the first attack swing while the body whirls (Bladestorm);
        // rigs without an attack clip just spin on their idle
        return this.action(this.def.clips.attack[0]) ?? this.action(c.idle);
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
    return s.moving || s.airborne || s.swimming || s.casting || !!s.spinning || s.sitting || s.dead;
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
      this.playOneShot(flourish.getClip().name, 1);
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
    ...Object.values(c.attackByAbility ?? {}),
    ...Object.values(c.attackByHand ?? {}),
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
