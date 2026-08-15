import * as THREE from 'three';
import type { BiomeId } from '../sim/types';
import { transitionAlpha, WEATHER_ENVIRONMENT_RESPONSE } from './environment_transition_core';
import { type PrecipMode, precipSpawnXZ, remotePrecipPlan } from './weather_field_core';

// Ambient precipitation. One pooled THREE.Points cloud rides inside a box that
// follows the camera (the same "ride along" trick the sky dome uses), so a
// small fixed pool blankets the whole visible world. Any weathered biome
// inside the box drives what falls (weather_field_core.ts): over your own
// head when you stand in the peaks' snow or the marsh's rain, and across the
// border when you stand OUTSIDE one looking in, with every spawn masked to
// the weathered zone's own cells so the neighbour's snowfall is visible from
// the clear side of the line. Render-only and presentation-only: it never
// touches sim state, so it stays out of the determinism contract (like the
// other ambient render effects).
//
// Intensity cross-fades when the player crosses a zone band. Switching the
// precipitation TYPE (snow <-> rain) fades the current one out, swaps the
// material, then fades the new one in, so the two looks never blend into mush.

// Half-extents of the camera-relative spawn box (world units).
const HX = 70;
const HY = 46;
const HZ = 70;

// How often the box is re-scanned for weathered cells (remotePrecipPlan).
// Zone borders move at walking speed under the camera; half a second is
// indistinguishable from per-frame and keeps the 49-tap scan out of the
// per-frame cost entirely.
const PLAN_INTERVAL = 0.5;

type Precip = PrecipMode;

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
  // so it must read as a real flake (~a hand's width), not a boulder: anything
  // approaching a yard stays huge on screen even far off and looks like flying
  // snowballs. Kept just above the ambient motes (0.5) so it still registers
  // against bright snowfields.
  snow: {
    color: 0xffffff,
    size: 0.45,
    fall: 6.5,
    fallVar: 2.5,
    sway: 1.6,
    target: 0.95,
    texture: 'flake',
  },
  // fast, near-vertical streaks with a faint cool tint; a touch taller than a
  // flake so the streak still reads, but nowhere near the old yard-long drops.
  rain: {
    color: 0x9fc4e0,
    size: 0.6,
    fall: 52,
    fallVar: 14,
    sway: 0.5,
    target: 0.7,
    texture: 'streak',
  },
};

// Tiny deterministic RNG (mulberry32) so particle seeding never reaches for
// Math.random, keeping this in step with the "procedural-everything is seeded"
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

// A soft round flake: radial alpha falloff, painted white so the material's
// `color` tints it.
function flakeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
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
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
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
  private readonly positionAttribute: THREE.BufferAttribute;
  private fallSpeed: Float32Array; // per-particle fall speed
  private phase: Float32Array; // per-particle sway phase
  private readonly count: number;
  private readonly textures: { flake: THREE.CanvasTexture; streak: THREE.CanvasTexture };
  /** The style's authored colour, kept apart from the day/night multiply so the
   *  two never compound: applyStyle sets this, the grade multiplies it. */
  private readonly styleColor = new THREE.Color(STYLES.snow.color);
  /** The frame's day/night colour multiply, the same `dnGrade.fog` the scene fog
   *  and the water surface take. */
  private readonly dayNight: [number, number, number] = [1, 1, 1];

  private mode: Precip = 'snow';
  private intensity = 0; // current eased opacity 0..1
  private enabled = true;
  private time = 0;
  // Remote-weather state: the cached box plan, its refresh clock, and whether
  // spawns are currently masked to the weathered zone's cells (plan found a
  // neighbour's weather rather than the player's own).
  private planMode: Precip | null = null;
  private planLocal = true;
  private planTimer = 0;
  private wasLive = false;
  private readonly spawnRng = mulberry32(0x5eed ^ 0x9e37);

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
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    geo.setAttribute('position', this.positionAttribute);
    // generous bounding sphere: the cloud is re-centred on the camera every
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
    this.points.userData.renderCategory = 'weather';
    scene.add(this.points);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /**
   * Expose the otherwise hidden precipitation draw during the renderer's boot
   * warm pass. Both rain and snow use the same PointsMaterial program shape;
   * returning both maps lets the loading screen upload them before a biome
   * transition can make either one visible.
   */
  beginPrewarm(): readonly THREE.Texture[] {
    this.points.visible = true;
    return [this.textures.flake, this.textures.streak];
  }

  endPrewarm(): void {
    this.points.visible = false;
    this.intensity = 0;
    this.material.opacity = 0;
  }

  /**
   * Precipitation is UNLIT (a PointsMaterial takes no scene light), so nothing
   * else in the renderer can darken it: without this, snow fell pure white at
   * midnight through an otherwise dark world and read as daylight confetti.
   * It takes the same grade the fog and the water surface take, so a flake in
   * the air matches the air it is falling through.
   */
  setDayNight(mul: readonly [number, number, number]): void {
    if (this.dayNight[0] === mul[0] && this.dayNight[1] === mul[1] && this.dayNight[2] === mul[2]) {
      return;
    }
    this.dayNight[0] = mul[0];
    this.dayNight[1] = mul[1];
    this.dayNight[2] = mul[2];
    this.applyTint();
  }

  /** Multiply in linear space, channel by channel: the style colour keeps its
   *  own sRGB decode from setHex and the grade is a plain multiplier. */
  private applyTint(): void {
    this.material.color.copy(this.styleColor);
    this.material.color.r *= this.dayNight[0];
    this.material.color.g *= this.dayNight[1];
    this.material.color.b *= this.dayNight[2];
  }

  private applyStyle(mode: Precip): void {
    const s = STYLES[mode];
    this.material.map = this.textures[s.texture];
    this.styleColor.setHex(s.color);
    this.material.size = s.size;
    this.applyTint();
  }

  /**
   * @param cam     current camera position (cloud re-centres on it)
   * @param dt      seconds since last frame
   * @param biome   biome under the player, or null when precipitation should
   *                stop (indoors / underwater / suppressed)
   * @param biomeAt world biome sampler (sim zoneBiomeAt), which is what lets a
   *                neighbouring zone's weather fall inside the box while the
   *                player stands outside it
   */
  update(
    cam: THREE.Vector3,
    dt: number,
    biome: BiomeId | null,
    biomeAt: (x: number, z: number) => BiomeId,
  ): void {
    // Any weathered biome in the box drives the mode (own zone first); the
    // player's own biome staying clear no longer clears the box. `biome`
    // stays the suppression channel: null (indoors/underwater) always stops.
    //
    // Suppressed, the scan is skipped outright rather than run and discarded:
    // its answer feeds `want` only on the arm that is already null here, so a
    // suppressed frame was paying 49 biomeAt taps twice a second for a value
    // nothing could read. The cached plan is dropped with it so a resume
    // re-scans against wherever the camera has since ended up instead of
    // opening on a stale mode.
    const suppressed = !this.enabled || biome === null;
    if (suppressed) {
      this.planTimer = 0;
      this.planMode = null;
      this.planLocal = true;
    } else {
      this.planTimer -= dt;
      if (this.planTimer <= 0) {
        this.planTimer = PLAN_INTERVAL;
        const plan = remotePrecipPlan(cam.x, cam.z, HX, HZ, biomeAt);
        this.planMode = plan.mode;
        this.planLocal = plan.local;
      }
    }
    const want: Precip | null = suppressed ? null : this.planMode;

    // While the visible type still differs from what we want, drive opacity to
    // zero first; once faded out, swap the material and let it climb again.
    let target: number;
    let maskedModeSwap = false;
    if (want === null) {
      target = 0;
    } else if (want !== this.mode) {
      target = 0;
      if (this.intensity <= 0.02) {
        this.mode = want;
        this.applyStyle(want);
        maskedModeSwap = !this.planLocal;
      }
    } else {
      target = STYLES[this.mode].target;
    }

    const k = transitionAlpha(dt, WEATHER_ENVIRONMENT_RESPONSE);
    this.intensity += (target - this.intensity) * k;
    this.material.opacity = this.intensity;

    const live = this.intensity > 0.01;
    this.points.visible = live;
    // A masked activation or live style swap reseeds the whole pool into the
    // weathered zone's cells. A type swap happens while the outgoing cloud is
    // still barely visible, so wasLive alone cannot identify that boundary.
    // Waiting for each particle's first wrap would open the new effect over
    // the WRONG (clear) side of the border.
    const masked = !this.planLocal;
    if (live && masked && (!this.wasLive || maskedModeSwap)) {
      for (let i = 0; i < this.count; i++) {
        const s = precipSpawnXZ(this.spawnRng, cam.x, cam.z, HX, HZ, this.mode, biomeAt);
        if (s) {
          this.positions[i * 3] = s.x;
          this.positions[i * 3 + 2] = s.z;
        }
      }
    }
    this.wasLive = live;
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
      let wrapped = false;
      const rx = pos[j] - cam.x;
      if (rx > HX) {
        pos[j] -= HX * 2;
        wrapped = true;
      } else if (rx < -HX) {
        pos[j] += HX * 2;
        wrapped = true;
      }
      const rz = pos[j + 2] - cam.z;
      if (rz > HZ) {
        pos[j + 2] -= HZ * 2;
        wrapped = true;
      } else if (rz < -HZ) {
        pos[j + 2] += HZ * 2;
        wrapped = true;
      }
      const ry = pos[j + 1] - cam.y;
      if (ry < -HY) {
        pos[j + 1] += HY * 2; // fell out the bottom -> back to the top
        wrapped = true;
      } else if (ry > HY) {
        pos[j + 1] -= HY * 2;
        wrapped = true;
      }
      // Remote weather: a wrap is a respawn, and a masked respawn must land
      // over the weathered zone's own cells (a sampling miss keeps the
      // wrapped position, one stray flake the next wrap re-tries).
      if (wrapped && masked) {
        const spawn = precipSpawnXZ(this.spawnRng, cam.x, cam.z, HX, HZ, this.mode, biomeAt);
        if (spawn) {
          pos[j] = spawn.x;
          pos[j + 2] = spawn.z;
        }
      }
    }
    this.positionAttribute.needsUpdate = true;
  }
}
