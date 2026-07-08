// SpriteAtlas: loads a horizontal-strip sprite sheet PNG + JSON metadata,
// computes UV rects per animation frame, and provides a texture + UV lookup
// for SpriteVisual to drive billboard rendering.
import * as THREE from 'three';
import { loadTexture } from '../assets/loader';
import { registerPreload } from '../assets/preload';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnimFrameDef {
  row: number;
  frames: number;
  fps: number;
}

export interface WeaponSlotMeta {
  bone: string;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface SpriteMeta {
  height: number;
  hover?: number;
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, AnimFrameDef>;
  weaponSlot?: WeaponSlotMeta;
}

export interface SpriteFrameUV {
  u: number;
  v: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const atlasCache = new Map<string, SpriteAtlas>();
const metaCache = new Map<string, SpriteMeta>();

// ---------------------------------------------------------------------------
// Preload helpers
// ---------------------------------------------------------------------------

/** Kick off the fetch for a sprite atlas + its metadata JSON at import time. */
export function preloadSpriteAtlas(bodyUrl: string, metaUrl: string): void {
  const p = Promise.all([
    loadTexture(bodyUrl, { srgb: true }),
    fetch(metaUrl).then((r) => r.json() as Promise<SpriteMeta>),
  ]).then(([tex, meta]) => {
    const key = bodyUrl.replace(/\.\w+$/, '');
    metaCache.set(key, meta);
    atlasCache.set(key, new SpriteAtlas(tex, meta));
  });
  registerPreload(p);
}

/** Kick off the fetch for a weapon sprite atlas + its metadata JSON at import time. */
export function preloadWeaponAtlas(weaponUrl: string, metaUrl: string): void {
  const p = Promise.all([
    loadTexture(weaponUrl, { srgb: true }),
    fetch(metaUrl).then((r) => r.json() as Promise<SpriteMeta>),
  ]).then(([tex, meta]) => {
    const key = weaponUrl.replace(/\.\w+$/, '');
    metaCache.set(key, meta);
    atlasCache.set(key, new SpriteAtlas(tex, meta));
  });
  registerPreload(p);
}

/** Get a cached atlas (synchronous, must be called after assetsReady). */
export function getCachedAtlas(key: string): SpriteAtlas | undefined {
  return atlasCache.get(key);
}

/** Get cached metadata (synchronous, must be called after assetsReady). */
export function getCachedMeta(key: string): SpriteMeta | undefined {
  return metaCache.get(key);
}

// ---------------------------------------------------------------------------
// SpriteAtlas
// ---------------------------------------------------------------------------

export class SpriteAtlas {
  readonly texture: THREE.Texture;
  readonly meta: SpriteMeta;
  private frameUVs: Map<string, SpriteFrameUV[]>;

  constructor(texture: THREE.Texture, meta: SpriteMeta) {
    this.texture = texture;
    this.meta = meta;
    this.frameUVs = new Map();
    this.computeFrameUVs();
  }

  /** Get UV rects for every frame of a given animation. */
  getFrames(anim: string): readonly SpriteFrameUV[] {
    return this.frameUVs.get(anim) ?? [];
  }

  /** Get a single frame's UV rect. */
  getFrame(anim: string, frame: number): SpriteFrameUV | undefined {
    const frames = this.frameUVs.get(anim);
    return frames?.[frame % frames.length];
  }

  dispose(): void {
    this.texture.dispose();
    this.frameUVs.clear();
  }

  /** Replace the underlying texture and recompute UV rects (for weapon swap). */
  swapTexture(newTexture: THREE.Texture): void {
    this.texture.dispose();
    (this as { texture: THREE.Texture }).texture = newTexture;
    this.frameUVs.clear();
    this.computeFrameUVs();
  }

  private computeFrameUVs(): void {
    const { frameWidth: fw, frameHeight: fh, animations } = this.meta;
    const texW = this.texture.image?.width ?? 1;
    const texH = this.texture.image?.height ?? 1;
    // frameWidth/frameHeight = 0 means single-frame mode: the entire texture is one frame
    const frameWidth = fw > 0 ? fw : texW;
    const frameHeight = fh > 0 ? fh : texH;

    for (const [anim, def] of Object.entries(animations)) {
      const frames: SpriteFrameUV[] = [];
      const rowCols = Math.max(1, Math.floor(texW / frameWidth));
      for (let i = 0; i < def.frames; i++) {
        const col = i % rowCols;
        // Flip V so row 0 is at the top of the texture (Three.js loads images
        // with Y=0 at top, but UV V=0 is bottom — flip here, flip again in setFrame)
        const vFlipped = 1 - (def.row * frameHeight) / texH - frameHeight / texH;
        frames.push({
          u: (col * frameWidth) / texW,
          v: vFlipped,
          w: Math.min(frameWidth / texW, 1),
          h: Math.min(frameHeight / texH, 1),
        });
      }
      this.frameUVs.set(anim, frames);
    }
  }
}
