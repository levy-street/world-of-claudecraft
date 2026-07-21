import * as THREE from 'three';
import type { BiomeId } from '../sim/types';

// Ambient precipitation. One pooled THREE.Points cloud rides inside a box that
// follows the camera (the same "ride along" trick the sky dome uses), so a
// small fixed pool blankets the whole visible world. The biome under the player
// drives what falls: drifting snow in the peaks, light rain in the marsh, clear
// skies in the vale. Render-only and presentation-only — it never touches sim
// state, so it stays out of the determinism contract (like the other ambient
// render effects).
//
// Intensity cross-fades when the player crosses a zone band. Switching the
// precipitation TYPE (snow <-> rain) fades the current one out, swaps the
// material, then fades the new one in, so the two looks never blend into mush.

// Half-extents of the camera-relative spawn box (world units).
const HX = 70;
const HY = 46;
const HZ = 70;

type Precip = 'snow' | 'rain';

interface PrecipStyle {
  color: number;
  size: number; // world-unit point size (sizeAttenuation)
  fall: number; // base downward speed (u/s)
  fallVar: number; // per-particle fall-speed spread
  sway: number; // horizontal sway amplitude (snow); slant drift (rain)
  target: number; // steady-state opacity for this look
  texture: 'flake' | 'streak';
}

const STYLES: Record<Precip, PrecipStyle> = {
  // soft, slow, wind-swayed flakes. `size` is in world units (sizeAttenuation),
  // so it must read as a real flake (~a hand's width), not a boulder — anything
  // approaching a yard stays huge on screen even far off and looks like flying
  // snowballs. Kept just above the ambient motes (0.5) so it still registers
  // against bright snowfields.
  snow: { color: 0xffffff, size: 0.45, fall: 6.5, fallVar: 2.5, sway: 1.6, target: 0.95, texture: 'flake' },
  // fast, near-vertical streaks with a faint cool tint; a touch taller than a
  // flake so the streak still reads, but nowhere near the old yard-long drops.
  rain: { color: 0x9fc4e0, size: 0.6, fall: 52, fallVar: 14, sway: 0.5, target: 0.7, texture: 'streak' },
};

// Tiny deterministic RNG (mulberry32) so particle seeding never reaches for
// Math.random — keeps this in step with the "procedural-everything is seeded"
// ethos of the renderer even though it's not on the sim determinism path.
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

// A soft round flake — radial alpha falloff, painted white so the material's
// `color` tints it.
function flakeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

// A vertical raindrop streak inside the point billboard, so a square Points
// sprite reads as a falling line rather than a dot.
function streakTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(28, 2, 8, 60);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export class Weather {
  private points: THREE.Points;
  private material: THREE.PointsMaterial;
  private positions: Float32Array;
  private fallSpeed: Float32Array; // per-particle fall speed
  private phase: Float32Array; // per-particle sway phase
  private readonly count: number;
  private readonly textures: { flake: THREE.CanvasTexture; streak: THREE.CanvasTexture };

  private mode: Precip = 'snow';
  private intensity = 0; // current eased opacity 0..1
  private enabled = true;
  private time = 0;

  constructor(scene: THREE.Scene, lowGfx: boolean) {
    // a smaller pool on the low tier keeps the effect affordable there
    this.count = lowGfx ? 600 : 1500;
    this.positions = new Float32Array(this.count * 3);
    this.fallSpeed = new Float32Array(this.count);
    this.phase = new Float32Array(this.count);

    const rng = mulberry32(0x5eed);
    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = (rng() * 2 - 1) * HX;
      this.positions[i * 3 + 1] = (rng() * 2 - 1) * HY;
      this.positions[i * 3 + 2] = (rng() * 2 - 1) * HZ;
      this.fallSpeed[i] = rng();
      this.phase[i] = rng() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    // generous bounding sphere — the cloud is re-centred on the camera every
    // frame, so a fixed large radius avoids per-frame recompute and culling.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(HX, HY, HZ));

    this.textures = { flake: flakeTexture(), streak: streakTexture() };
    this.material = new THREE.PointsMaterial({
      size: STYLES.snow.size,
      map: this.textures.flake,
      color: STYLES.snow.color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3; // after the world, before nameplates
    this.points.visible = false;
    scene.add(this.points);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  private applyStyle(mode: Precip): void {
    const s = STYLES[mode];
    this.material.map = this.textures[s.texture];
    this.material.color.setHex(s.color);
    this.material.size = s.size;
    this.material.needsUpdate = true;
  }

  /**
   * @param cam   current camera position (cloud re-centres on it)
   * @param dt    seconds since last frame
   * @param biome biome under the player, or null when precipitation should stop
   *              (indoors / underwater / suppressed)
   */
  update(cam: THREE.Vector3, dt: number, biome: BiomeId | null): void {
    // peaks -> snow, marsh -> rain, everything else clears
    const want: Precip | null =
      !this.enabled || biome === null ? null : biome === 'peaks' ? 'snow' : biome === 'marsh' ? 'rain' : null;

    // While the visible type still differs from what we want, drive opacity to
    // zero first; once faded out, swap the material and let it climb again.
    let target: number;
    if (want === null) {
      target = 0;
    } else if (want !== this.mode) {
      target = 0;
      if (this.intensity <= 0.02) {
        this.mode = want;
        this.applyStyle(want);
      }
    } else {
      target = STYLES[this.mode].target;
    }

    const k = 1 - Math.exp(-dt * 1.8);
    this.intensity += (target - this.intensity) * k;
    this.material.opacity = this.intensity;

    const live = this.intensity > 0.01;
    this.points.visible = live;
    if (!live) return;

    this.time += dt;
    const s = STYLES[this.mode];
    const pos = this.positions;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      const fall = s.fall + this.fallSpeed[i] * s.fallVar;
      pos[j + 1] -= fall * dt;
      // snow drifts sideways on a slow sine; rain gets a faint constant slant
      pos[j] += Math.sin(this.time * 0.8 + this.phase[i]) * s.sway * dt;

      // wrap each axis into the camera-relative box so the field is endless
      let rx = pos[j] - cam.x;
      if (rx > HX) pos[j] -= HX * 2; else if (rx < -HX) pos[j] += HX * 2;
      let rz = pos[j + 2] - cam.z;
      if (rz > HZ) pos[j + 2] -= HZ * 2; else if (rz < -HZ) pos[j + 2] += HZ * 2;
      const ry = pos[j + 1] - cam.y;
      if (ry < -HY) pos[j + 1] += HY * 2; // fell out the bottom -> back to the top
      else if (ry > HY) pos[j + 1] -= HY * 2;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
