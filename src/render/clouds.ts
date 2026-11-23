// Editor/map-authored cloud layer: a pool of big soft billboard puffs riding a
// camera-relative box at an authored height, drifting slowly downwind. At high
// coverage the layer reads as an overcast deck; authored LOW it hugs the
// ground and reads as rolling fog banks (the same sprites, just seated at
// terrain level). Render-only and presentation-only, like the weather
// particles: it never touches sim state.

import * as THREE from 'three';

// Camera-relative half-extents the puffs wrap inside.
const CX = 240;
const CZ = 240;
const PUFF_POOL = 42;
const DRIFT = 1.9; // u/s downwind (+x), matching the sky's cirrus crawl
/** Inside this many yards of the camera a puff is fully gone... */
export const PUFF_NEAR = 90;
/** ...and past this it is at its full (coverage-set) opacity. */
export const PUFF_FAR = 170;

/**
 * A live puff's opacity for a coverage. Half of the first cut (0.34 + 0.2c):
 * SPACEY: "make the fog clouds 50% more transparent" - the deck now tints the
 * distance rather than painting over it.
 */
export function puffOpacity(coverage: number): number {
  const c = Math.max(0, Math.min(1, coverage));
  return 0.17 + c * 0.1;
}

/**
 * Where a deck stops being a bank of puffs and becomes pure distance haze.
 * Past this the sprites ramp back OUT again, so the far field is the scene
 * fog alone, terrain simply bleeds into the horizon instead of having soft
 * white blobs pasted over it (SPACEY, 2026-09-19: "at distance it should just
 * cleanly bleed off ... rather than the cheap looking clouds we have"). The
 * fog does that for free in every material, so this costs nothing but the
 * draws it REMOVES.
 */
export const PUFF_HAZE_IN = 300;
/** Fully dissolved into the fog from here out. */
export const PUFF_HAZE_OUT = 460;

/**
 * A puff's distance fade: in from PUFF_NEAR to PUFF_FAR, then back out from
 * PUFF_HAZE_IN to PUFF_HAZE_OUT. Only the middle band draws, so a deck reads
 * as a bank in the mid distance and as clean haze beyond it.
 */
export function puffFade(distance: number): number {
  const up = Math.max(0, Math.min(1, (distance - PUFF_NEAR) / (PUFF_FAR - PUFF_NEAR)));
  const down = Math.max(0, Math.min(1, (distance - PUFF_HAZE_IN) / (PUFF_HAZE_OUT - PUFF_HAZE_IN)));
  const s = (t: number): number => t * t * (3 - 2 * t);
  return s(up) * (1 - s(down));
}

export interface CloudLayerConfig {
  /** 0..1: how much of the sky the deck covers (0 disposes the layer). */
  coverage: number;
  /** Puff-center height in yards above sea level (low = ground fog). */
  height: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One shared puff texture: a cluster of soft blobs so a single sprite already
// reads as a cloud, not a circle.
let puffTex: THREE.CanvasTexture | null = null;
function puffTexture(): THREE.CanvasTexture {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(0xc10d);
  const blob = (x: number, y: number, r: number, a: number): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.6, `rgba(255,255,255,${a * 0.55})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (let i = 0; i < 9; i++) {
    blob(48 + rng() * 160, 54 + rng() * 26, 26 + rng() * 30, 0.5 + rng() * 0.3);
  }
  blob(128, 66, 62, 0.55);
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.SRGBColorSpace;
  puffTex.minFilter = THREE.LinearFilter;
  puffTex.magFilter = THREE.LinearFilter;
  puffTex.generateMipmaps = false;
  return puffTex;
}

export class CloudLayer {
  private readonly scene: THREE.Scene;
  private group: THREE.Group | null = null;
  private sprites: THREE.Sprite[] = [];
  private drift: number[] = [];
  private config: CloudLayerConfig | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setConfig(config: CloudLayerConfig | null): void {
    const want = config && config.coverage > 0.01 ? config : null;
    this.config = want ? { ...want } : null;
    if (!want) {
      this.dispose();
      return;
    }
    if (!this.group) this.build();
    this.applyCoverage();
  }

  private build(): void {
    const g = new THREE.Group();
    g.name = 'editor-cloud-layer';
    const rng = mulberry32(0x5c1f);
    for (let i = 0; i < PUFF_POOL; i++) {
      const mat = new THREE.SpriteMaterial({
        map: puffTexture(),
        color: 0xf4f7fb,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      const w = 60 + rng() * 90;
      sp.scale.set(w, w * 0.42, 1);
      sp.position.set((rng() * 2 - 1) * CX, 0, (rng() * 2 - 1) * CZ);
      sp.renderOrder = 2;
      this.drift.push(DRIFT * (0.6 + rng() * 0.8));
      this.sprites.push(sp);
      g.add(sp);
    }
    this.group = g;
    this.scene.add(g);
  }

  /** A live puff's full opacity for this coverage: what it shows once it is
   *  far enough from the camera to show at all (see puffFade). */
  private baseOpacity = 0;

  private applyCoverage(): void {
    if (!this.config) return;
    const cover = Math.max(0, Math.min(1, this.config.coverage));
    const liveCount = Math.round(PUFF_POOL * cover);
    this.baseOpacity = puffOpacity(cover);
    for (let i = 0; i < this.sprites.length; i++) {
      const mat = this.sprites[i].material;
      mat.opacity = i < liveCount ? this.baseOpacity : 0;
      this.sprites[i].visible = i < liveCount;
    }
  }

  update(cam: THREE.Vector3, dt: number): void {
    if (!this.group || !this.config) return;
    const h = this.config.height;
    for (let i = 0; i < this.sprites.length; i++) {
      const sp = this.sprites[i];
      if (!sp.visible) continue;
      sp.position.x += this.drift[i] * dt;
      // Wrap into the camera-relative box so the deck is endless.
      let rx = sp.position.x - cam.x;
      if (rx > CX) sp.position.x -= CX * 2;
      else if (rx < -CX) sp.position.x += CX * 2;
      rx = sp.position.z - cam.z;
      if (rx > CZ) sp.position.z -= CZ * 2;
      else if (rx < -CZ) sp.position.z += CZ * 2;
      sp.position.y = h;
      // A puff is a distant thing. Up close a 100-yard billboard is a flat
      // white wall crossing the deck (SPACEY: "looks weird with the close up
      // fog"), so each one fades out as the camera nears it and is gone
      // inside PUFF_NEAR - the deck stays on the horizon and over the far
      // water, never on top of the maker.
      const fade = puffFade(sp.position.distanceTo(cam));
      // A fully faded puff is still a transparent draw and still sorts; drop
      // it out of the frame entirely instead.
      sp.visible = fade > 0.004;
      sp.material.opacity = this.baseOpacity * fade;
    }
  }

  dispose(): void {
    if (!this.group) return;
    this.scene.remove(this.group);
    for (const sp of this.sprites) sp.material.dispose();
    this.sprites = [];
    this.drift = [];
    this.group = null;
  }
}
