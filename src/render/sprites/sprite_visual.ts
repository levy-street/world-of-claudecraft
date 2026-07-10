// SpriteVisual: drop-in replacement for CharacterVisual that renders a
// Ragnarok Online-style pixel-art billboard sprite instead of a rigged glTF.
// Satisfies the same public interface the renderer.ts expects from a visual,
// so EntityView.visual can hold either type without branching on construction.
import * as THREE from 'three';
import type { OverheadEmoteId } from '../../sim/types';
import type { AnimState, BaseState } from '../characters/anim_state';
import { desiredBaseState } from '../characters/anim_state';
import { GFX } from '../gfx';
import type { SpriteAtlas, SpriteMeta, WeaponSlotMeta } from './atlas';
import { getCachedAtlas, getCachedMeta } from './atlas';
import { newSpriteLocoState, spriteAnimSpeedScale, updateSpriteLoco } from './sprite_locomotion';
import {
  SPRITE_DEFS,
  SPRITE_DIR_ORDER,
  type SpriteDef,
  type SpriteDir,
  WEAPON_OFFSETS,
  spriteBodyDirMetaUrl,
  spriteWeaponDirPng,
  weaponSpriteForItem,
} from './sprite_manifest';
import { createSpriteMaterial } from './sprite_shader';
import { createSpriteShadow, disposeSpriteShadow, type SpriteShadow } from './sprite_shadow';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GHOST_OPACITY = 0.34;
const SOUL_REND_OPACITY = 0.58;
const SOUL_REND_TINT = new THREE.Color(0x4f0505);
const WHITE = new THREE.Color(0xffffff);

// Shared geometry — a unit quad (1×1) centred at origin, used by every sprite.
let quadGeoSingleton: THREE.PlaneGeometry | null = null;
function quadGeo(): THREE.PlaneGeometry {
  if (!quadGeoSingleton) quadGeoSingleton = new THREE.PlaneGeometry(1, 1);
  return quadGeoSingleton;
}

// Shadow-only circle for far-LOD ground shadow
let shadowGeoSingleton: THREE.CircleGeometry | null = null;
function shadowGeo(): THREE.CircleGeometry {
  if (!shadowGeoSingleton) shadowGeoSingleton = new THREE.CircleGeometry(0.5, 12);
  return shadowGeoSingleton;
}

// Invisible click capsule — same as CharacterVisual
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

// Shadow-only material (writes neither color nor depth)
let shadowOnlySingleton: THREE.Material | null = null;
function shadowOnlyMat(): THREE.Material {
  shadowOnlySingleton ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  return shadowOnlySingleton;
}

// ---------------------------------------------------------------------------
// Animation state mapping
// ---------------------------------------------------------------------------

function spriteAnimationFor(base: BaseState): string {
  switch (base) {
    case 'walk':
    case 'walkBack':
    case 'run':
      return 'walk';
    case 'cast':
      return 'cast';
    case 'swim':
    case 'sit':
    case 'jump':
    default:
      return 'idle';
  }
}

// ---------------------------------------------------------------------------
// SpriteVisual
// ---------------------------------------------------------------------------

export class SpriteVisual {
  /** Group the renderer adds to the entity group; pivot at feet, faces +Z */
  readonly root = new THREE.Group();
  /** Unscaled world-unit height — nameplate anchor = height * e.scale + 0.5 */
  readonly height: number;
  /** Invisible capsule for picking (userData.entityId set by the renderer) */
  readonly clickProxy: THREE.Mesh;

  // Three.js objects
  private bodyMesh: THREE.Mesh;
  private bodyMaterial: THREE.ShaderMaterial;
  private weaponMesh: THREE.Mesh | null = null;
  private weaponMaterial: THREE.ShaderMaterial | null = null;
  private shadowProxy: THREE.Mesh | null = null;
  shadowBlob: SpriteShadow | null = null;
  private farMesh: THREE.Mesh | null = null;

  // Atlas / metadata
  private bodyAtlas: SpriteAtlas;
  private bodyMeta: SpriteMeta;
  private weaponAtlas: SpriteAtlas | null = null;
  private weaponMeta: WeaponSlotMeta | null = null;

  // Directional atlas storage (8 directions, null = not loaded / fallback to front)
  private dirBodyAtlases: Map<SpriteDir, SpriteAtlas> | null = null;
  private dirBodyMetas: Map<SpriteDir, SpriteMeta> | null = null;
  private dirWeaponAtlases: Map<SpriteDir, SpriteAtlas> | null = null;
  private dirWeaponMetas: Map<SpriteDir, WeaponSlotMeta | null> | null = null;
  private currentDir: SpriteDir = 'front';
  private readonly isDirectional: boolean;

  // SpriteDef fields
  private readonly spriteDef: SpriteDef;
  private readonly entityColor: number;

  // Animation state
  private currentAnim = 'idle';
  private currentFrame = 0;
  private frameTimer = 0;
  private loop = true;
  private deadLock = false;
  private wasDead = false;
  private initialized = false;

  // One-shot tracking (attack/hit)
  private currentIsOneShot = false;
  private attackIdx = 0;
  private hitCooldown = 0;

  // LOD / effects
  private far = false;
  private shadowOn = true;
  private ghosted = false;
  private soulRend = false;

  // Tint
  private tintColor: THREE.Color | null = null;
  private tintStrength = 0;

  // Locomotion lean
  private locoState = newSpriteLocoState();

  // Animation speed scaling (walk cycles faster when moving faster)
  private animSpeedScale = 1;

  // Weapon swap state
  private currentWeaponItemId: string | null = null;

  // Dispose guard
  private disposed = false;

  constructor(
    key: string,
    entityColor: number,
    _skinIndex = 0,
    _weaponItemId: string | null = null,
    _weaponOverride: unknown = null,
  ) {
    const def = SPRITE_DEFS[key];
    if (!def) throw new Error(`sprite_visual: no SPRITE_DEFS entry for "${key}"`);

    this.spriteDef = def;
    this.entityColor = entityColor;
    this.height = def.height;
    this.isDirectional = def.directional === true;

    const bodyAtlas = getCachedAtlas(`sprites/bodies/${def.bodyPng}`);
    const bodyMeta = getCachedMeta(`sprites/bodies/${def.bodyPng}`);
    if (!bodyAtlas || !bodyMeta) throw new Error(`sprite_visual: atlas not loaded for "${key}"`);

    this.bodyAtlas = bodyAtlas;
    this.bodyMeta = bodyMeta;

    // Load directional body atlases if defined
    if (this.isDirectional && def.bodyDir) {
      this.dirBodyAtlases = new Map();
      this.dirBodyMetas = new Map();
      for (const dir of SPRITE_DIR_ORDER) {
        const png = def.bodyDir[dir];
        if (png) {
          const atlas = getCachedAtlas(`sprites/bodies/${png}`);
          const meta = getCachedMeta(`sprites/bodies/${png}`);
          if (atlas && meta) {
            this.dirBodyAtlases.set(dir, atlas);
            this.dirBodyMetas.set(dir, meta);
          }
        }
      }
    }

    // Body mesh — unit quad, scaled to height
    this.bodyMaterial = createSpriteMaterial(bodyAtlas.texture);
    // Apply tint if defined
    if (def.tint !== undefined) {
      this.tintStrength = def.tintStrength ?? 0.4;
      const tintHex = def.tint === 'entity' ? entityColor : def.tint;
      this.tintColor = new THREE.Color(tintHex);
      this.applyTint();
    }
    this.bodyMesh = new THREE.Mesh(quadGeo(), this.bodyMaterial);
    this.bodyMesh.scale.set(def.height, def.height, 1);
    // Offset upward by half height so the bottom of the sprite sits at the pivot (ground level)
    this.bodyMesh.position.y = def.height / 2 + (def.hover ?? 0);
    this.root.add(this.bodyMesh);

    // Weapon overlay — lazy, built when weapon is equipped
    // Skip on low/medium tiers for performance (cheaper draw calls)
    if (def.weaponPng && GFX.tier !== 'low' && GFX.tier !== 'medium') {
      const wAtlas = getCachedAtlas(`sprites/weapons/${def.weaponPng}`);
      const wMeta = getCachedMeta(`sprites/weapons/${def.weaponPng}`);
      if (wAtlas && wMeta) {
        this.weaponAtlas = wAtlas;
        this.weaponMeta = wMeta.weaponSlot ?? WEAPON_OFFSETS[def.weaponPng] ?? null;
        this.weaponMaterial = createSpriteMaterial(wAtlas.texture);
        this.weaponMesh = new THREE.Mesh(quadGeo(), this.weaponMaterial);
        this.applyWeaponOffset(this.weaponMeta);
        this.root.add(this.weaponMesh);
      }

      // Load directional weapon atlases if defined
      if (this.isDirectional && def.weaponDir) {
        this.dirWeaponAtlases = new Map();
        this.dirWeaponMetas = new Map();
        for (const dir of SPRITE_DIR_ORDER) {
          const png = def.weaponDir[dir];
          if (png) {
            const atlas = getCachedAtlas(`sprites/weapons/${png}`);
            const meta = getCachedMeta(`sprites/weapons/${png}`);
            if (atlas && meta) {
              this.dirWeaponAtlases.set(dir, atlas);
              this.dirWeaponMetas.set(dir, meta.weaponSlot ?? WEAPON_OFFSETS[png] ?? null);
            }
          }
        }
      }
    }

    // Shadow proxy — small circle on the ground (skip on low tier)
    if (GFX.tier !== 'low') {
      this.shadowProxy = new THREE.Mesh(shadowGeo(), shadowOnlyMat());
      this.shadowProxy.rotation.x = -Math.PI / 2;
      this.shadowProxy.position.y = 0.01;
      this.shadowProxy.visible = false;
      this.root.add(this.shadowProxy);
      // Visual shadow blob — gradient circle anchored to terrain
      this.shadowBlob = createSpriteShadow(this.root);
    }

    // Click proxy — invisible cylinder for raycasting
    const r = def.height * 0.25; // rough click radius
    this.clickProxy = new THREE.Mesh(clickGeo(), clickMat());
    this.clickProxy.scale.set(r * 2, def.height, r * 2);
    this.clickProxy.visible = false;
    this.root.add(this.clickProxy);

    // Start on idle frame
    this.setFrame('idle', 0);
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  /** Called every frame by the renderer. Matches CharacterVisual.update signature. */
  update(dt: number, s: AnimState, animate: boolean): void {
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);

    // Death edge-trigger
    if (s.dead && !this.wasDead) this.enterDeath();
    else if (!s.dead && this.wasDead) this.revive();
    this.wasDead = s.dead;
    this.initialized = true;

    // Animation state machine
    if (!this.deadLock) {
      const desired = desiredBaseState(s, false);
      const anim = spriteAnimationFor(desired);
      const isOneShot = this.currentIsOneShot;

      if (!isOneShot) {
        if (anim !== this.currentAnim) {
          this.setAnimation(anim, true);
        }
      }
    }

    // Advance frame — skip if throttled (same as CharacterVisual)
    if (animate) this.advanceFrame(dt);

    // Lean forward when moving (bone-free locomotion)
    const lean = updateSpriteLoco(this.locoState, s, animate ? dt : 0);
    this.bodyMesh.rotation.x = lean;
    if (this.weaponMesh) this.weaponMesh.rotation.x = lean;

    // Animation speed scaling — walk cycles play faster at higher movement speed
    this.animSpeedScale = spriteAnimSpeedScale(s.speed);

    // Billboard: the renderer sets root.rotation.y = camYaw − facing each frame,
    // so the root's world rotation = camYaw (facing the camera).  The bodyMesh
    // stays at rotation.y = 0 — no counter-rotation needed — so its world
    // rotation is also camYaw, keeping the sprite front-on to the viewer.

    // Swim pose — bob proportional to entity height so small creatures (fox 1.0u)
    // aren't submerged and large ones (tolling bell 3.4u) aren't too high.
    // Ratio ~0.36 matches the original 0.95/2.6 knight calibration.
    if (s.swimming && !s.dead) {
      const swimLift = this.spriteDef.height * 0.36;
      this.bodyMesh.position.y =
        this.spriteDef.height / 2 +
        (this.spriteDef.hover ?? 0) +
        swimLift +
        Math.sin(performance.now() / 500) * 0.08;
    } else {
      this.bodyMesh.position.y = this.spriteDef.height / 2 + (this.spriteDef.hover ?? 0);
    }
  }

  // -------------------------------------------------------------------------
  // One-shot triggers
  // -------------------------------------------------------------------------

  get isMidOneShot(): boolean {
    return this.currentIsOneShot;
  }

  playAttack(): void {
    if (this.deadLock) return;
    this.playOneShot('attack');
    this.attackIdx++;
  }

  playHit(): void {
    if (this.deadLock || this.currentIsOneShot || this.hitCooldown > 0) return;
    this.hitCooldown = 0.9;
    // Use idle as hit-react for sprites (simple flash)
    this.flashHit();
  }

  playEmote(_id: OverheadEmoteId): void {
    // Emotes stay 3D — no-op for sprites
  }

  // -------------------------------------------------------------------------
  // Static posing (preview capture)
  // -------------------------------------------------------------------------

  poseFreeze(candidates: readonly string[], fraction: number): string | null {
    // For sprites, freeze on a specific frame
    const anim = candidates.find((c) => this.bodyMeta.animations[c]) ?? 'idle';
    const def = this.bodyMeta.animations[anim];
    if (!def) return null;
    const frame = Math.floor(fraction * (def.frames - 1));
    this.setFrame(anim, frame);
    this.currentIsOneShot = true;
    this.deadLock = true;
    return anim;
  }

  clearPose(): void {
    this.deadLock = false;
    this.currentIsOneShot = false;
    this.setAnimation('idle', true);
  }

  // -------------------------------------------------------------------------
  // LOD / shadow plumbing
  // -------------------------------------------------------------------------

  setShadow(on: boolean): void {
    this.shadowOn = on;
  }

  setProxyShadow(on: boolean): void {
    if (this.shadowProxy) this.shadowProxy.visible = on;
  }

  setFar(far: boolean): void {
    if (far === this.far) return;
    this.far = far;
    // On far LOD, hold idle frame 0 and hide weapon overlay
    if (far) {
      this.setFrame('idle', 0);
      if (this.weaponMesh) this.weaponMesh.visible = false;
    } else {
      // Only show weapon if the entity actually has one equipped
      if (this.weaponMesh) {
        this.weaponMesh.visible = this.currentWeaponItemId !== null && this.weaponMeta !== null;
      }
    }
  }

  get isFar(): boolean {
    return this.far;
  }

  setGhost(on: boolean): void {
    this.ghosted = on;
    this.applyEffectMaterial();
  }

  setSoulRend(on: boolean): void {
    if (on === this.soulRend) return;
    this.soulRend = on;
    this.applyEffectMaterial();
  }

  // -------------------------------------------------------------------------
  // Directional sprite switching (8-direction, world-space)
  // -------------------------------------------------------------------------

  /** Returns true if this sprite has directional variants (world-space rendering). */
  hasDirectional(): boolean {
    return this.isDirectional;
  }

  /** Get the current directional variant. */
  getDirection(): SpriteDir {
    return this.currentDir;
  }

  /**
   * Switch the active body+weapon atlas to the given direction.
   * No-op if the sprite is not directional or the direction is already active.
   */
  setDirection(dir: SpriteDir): void {
    if (!this.isDirectional || dir === this.currentDir) return;
    this.currentDir = dir;

    // Swap body atlas to directional variant (fallback to front)
    const dirAtlas = this.dirBodyAtlases?.get(dir);
    const dirMeta = this.dirBodyMetas?.get(dir);
    if (dirAtlas && dirMeta) {
      this.bodyAtlas = dirAtlas;
      this.bodyMeta = dirMeta;
    } else {
      // Fallback to front (base) atlas
      const frontAtlas = getCachedAtlas(`sprites/bodies/${this.spriteDef.bodyPng}`);
      const frontMeta = getCachedMeta(`sprites/bodies/${this.spriteDef.bodyPng}`);
      if (frontAtlas && frontMeta) {
        this.bodyAtlas = frontAtlas;
        this.bodyMeta = frontMeta;
      }
    }
    // Re-apply current frame on new atlas
    this.setFrame(this.currentAnim, this.currentFrame);

    // Swap weapon atlas to directional variant
    if (this.weaponMesh && this.weaponMaterial) {
      const wDirAtlas = this.dirWeaponAtlases?.get(dir);
      const wDirMeta = this.dirWeaponMetas?.get(dir);
      if (wDirAtlas && wDirMeta) {
        this.weaponAtlas = wDirAtlas;
        this.weaponMeta = wDirMeta;
        (this.weaponMaterial.uniforms.map.value as THREE.Texture) = wDirAtlas.texture;
        this.applyWeaponOffset(wDirMeta);
      } else {
        // Fallback to front weapon atlas
        const wPng = this.spriteDef.weaponPng;
        if (wPng) {
          const frontWAtlas = getCachedAtlas(`sprites/weapons/${wPng}`);
          const frontWMeta = getCachedMeta(`sprites/weapons/${wPng}`);
          if (frontWAtlas && frontWMeta) {
            this.weaponAtlas = frontWAtlas;
            this.weaponMeta = frontWMeta.weaponSlot ?? WEAPON_OFFSETS[wPng] ?? null;
            (this.weaponMaterial.uniforms.map.value as THREE.Texture) = frontWAtlas.texture;
            this.applyWeaponOffset(this.weaponMeta);
          }
        }
      }
      // Re-apply current frame on new weapon atlas
      this.setFrame(this.currentAnim, this.currentFrame);
    }
  }

  // -------------------------------------------------------------------------
  // Skin / weapon swap
  // -------------------------------------------------------------------------

  setSkin(skinIndex: number): void {
    // Skin swap on sprites = swap to a different body atlas
    // For now this is a no-op (all skins share the same sprite sheet)
    // TODO: swap bodyAtlas when per-skin sprite sheets exist
    void skinIndex;
  }

  setWeapon(weaponItemId: string | null): void {
    if (weaponItemId === this.currentWeaponItemId) return;
    this.currentWeaponItemId = weaponItemId;

    // Skip weapon swap on low/medium tiers (no weapon mesh)
    if (GFX.tier === 'low' || GFX.tier === 'medium') {
      if (this.weaponMesh) this.weaponMesh.visible = false;
      return;
    }

    const spriteName = weaponSpriteForItem(weaponItemId);
    const hasWeapon = spriteName !== null;

    if (hasWeapon && spriteName) {
      const weaponUrl = `sprites/weapons/${spriteName}`;
      const newAtlas = getCachedAtlas(weaponUrl);
      const newMeta = getCachedMeta(weaponUrl);

      if (newAtlas && newMeta) {
        // Swap the weapon material's texture (ShaderMaterial stores map in uniforms)
        if (this.weaponMaterial) {
          (this.weaponMaterial.uniforms.map.value as THREE.Texture) = newAtlas.texture;
        }
        // Update weapon offset from new metadata
        const newOffset = newMeta.weaponSlot ?? WEAPON_OFFSETS[spriteName] ?? null;
        this.weaponMeta = newOffset;
        this.weaponAtlas = newAtlas;
        this.applyWeaponOffset(newOffset);

        // If directional, rebuild directional weapon atlases for the new weapon
        if (this.isDirectional && this.dirWeaponAtlases) {
          this.dirWeaponAtlases.clear();
          this.dirWeaponMetas?.clear();
          // The new weapon's directional variants would need to be defined
          // per-entity or follow a naming convention (e.g. sword_1handed_back).
          // For now, runtime-swapped weapons use front-facing only.
        }
      }
    }

    // Toggle visibility
    if (this.weaponMesh) {
      this.weaponMesh.visible = hasWeapon && !this.far;
    }
    // Re-apply current frame
    this.setFrame(this.currentAnim, this.currentFrame);
  }

  // -------------------------------------------------------------------------
  // Tint
  // -------------------------------------------------------------------------

  setTint(color: number, strength: number): void {
    this.tintColor = new THREE.Color(color);
    this.tintStrength = strength;
    this.applyTint();
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  dispose(): void {
    this.disposed = true;
    if (this.shadowBlob) disposeSpriteShadow(this.shadowBlob, this.root);
    this.root.removeFromParent();
    // Don't dispose shared geometry/materials — they're caches
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Apply weapon overlay position/scale from offset metadata. */
  private applyWeaponOffset(off: WeaponSlotMeta | null): void {
    if (!off || !this.weaponMesh || !this.spriteDef) return;
    this.weaponMesh.scale.set(
      this.spriteDef.height * off.scale,
      this.spriteDef.height * off.scale,
      1,
    );
    this.weaponMesh.position.set(
      off.offsetX,
      this.spriteDef.height * off.offsetY +
        this.spriteDef.height / 2 +
        (this.spriteDef.hover ?? 0),
      0.01,
    );
  }

  private setAnimation(name: string, loop: boolean): void {
    if (name === this.currentAnim && this.loop === loop) return;
    this.currentAnim = name;
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.loop = loop;
    this.currentIsOneShot = false;
  }

  private playOneShot(name: string): void {
    this.currentAnim = name;
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.loop = false;
    this.currentIsOneShot = true;
  }

  private advanceFrame(dt: number): void {
    const def = this.bodyMeta.animations[this.currentAnim];
    if (!def || def.frames <= 0) return;

    this.frameTimer += dt * def.fps * this.animSpeedScale;
    if (this.frameTimer >= 1) {
      const advance = Math.floor(this.frameTimer);
      this.frameTimer -= advance;
      this.currentFrame += advance;

      if (this.currentFrame >= def.frames) {
        if (this.loop) {
          this.currentFrame %= def.frames;
        } else {
          this.currentFrame = def.frames - 1;
          // One-shot finished — return to base
          if (this.currentIsOneShot) {
            this.currentIsOneShot = false;
            if (!this.deadLock) {
              this.currentAnim = 'idle';
              this.currentFrame = 0;
            }
          }
        }
      }
    }

    this.setFrame(this.currentAnim, this.currentFrame);
  }

  private setFrame(anim: string, frame: number): void {
    const uv = this.bodyAtlas.getFrame(anim, frame);
    if (!uv) return;

    // Update UV on body material via offset/center (ShaderMaterial texture lives in uniforms)
    const bodyMap = this.bodyMaterial.uniforms.map.value as THREE.Texture;
    bodyMap.offset.set(uv.u, 1 - uv.v - uv.h);
    bodyMap.repeat.set(uv.w, uv.h);
    bodyMap.needsUpdate = true;

    // Sync weapon overlay frame
    if (this.weaponMesh && this.weaponAtlas && this.weaponMaterial) {
      const wuv = this.weaponAtlas.getFrame(anim, frame);
      if (wuv) {
        const weaponMap = this.weaponMaterial.uniforms.map.value as THREE.Texture;
        weaponMap.offset.set(wuv.u, 1 - wuv.v - wuv.h);
        weaponMap.repeat.set(wuv.w, wuv.h);
        weaponMap.needsUpdate = true;
      }
    }
  }

  private flashHit(): void {
    // Brief white flash for hit-react on sprites — re-apply tint blend on
    // restore instead of snapshotting the raw color, so tint property changes
    // during the flash window aren't lost.
    (this.bodyMaterial.uniforms.color.value as THREE.Color).set(0xffffff);
    setTimeout(() => {
      if (!this.disposed) this.applyTint();
    }, 80);
  }

  private enterDeath(): void {
    this.deadLock = true;
    this.currentIsOneShot = false;
    this.setAnimation('death', false);
  }

  private revive(): void {
    this.deadLock = false;
    this.currentIsOneShot = false;
    this.setAnimation('idle', true);
  }

  private applyEffectMaterial(): void {
    if (this.ghosted) {
      this.bodyMaterial.transparent = true;
      this.bodyMaterial.uniforms.opacity.value = GHOST_OPACITY;
      this.bodyMaterial.depthWrite = false;
      this.bodyMaterial.needsUpdate = true;
    } else if (this.soulRend) {
      this.bodyMaterial.transparent = true;
      this.bodyMaterial.uniforms.opacity.value = SOUL_REND_OPACITY;
      this.bodyMaterial.depthWrite = false;
      (this.bodyMaterial.uniforms.color.value as THREE.Color).copy(SOUL_REND_TINT);
      this.bodyMaterial.needsUpdate = true;
    } else {
      this.bodyMaterial.transparent = true;
      this.bodyMaterial.uniforms.opacity.value = 1;
      this.bodyMaterial.depthWrite = true;
      this.applyTint();
      this.bodyMaterial.needsUpdate = true;
    }
  }

  /** Apply tint color blended with white at tintStrength. */
  private applyTint(): void {
    const colorUniform = this.bodyMaterial.uniforms.color.value as THREE.Color;
    if (!this.tintColor) {
      colorUniform.copy(WHITE);
      return;
    }
    // Blend tint toward white: tintStrength=0 → white (no tint), 1 → full tint
    colorUniform.copy(WHITE).lerp(this.tintColor, this.tintStrength);
  }
}
