import * as THREE from 'three';
import {
  EDICT_SEAL_RADIUS,
  EDICT_SLASH,
  EDICT_STAMP_DURATION,
  EDICT_STAMP_SCALE,
  EDICT_TRAIL,
  EDICT_WAVE_EDGE_SEGMENTS,
  EDICT_WAVE_SHOCK_SEGMENTS,
  EDICT_WAVE_SPOKES,
  type EdictOutcome,
  type EdictSlashWindow,
  type EdictSpark,
  type EdictWavePose,
  edictAlpha,
  edictSealScale,
  edictSlashWindow,
  edictStampAlpha,
  edictWaveArrival,
  edictWavePose,
  FINAL_EDICT_AFTER,
  FINAL_EDICT_CAPACITY,
  FINAL_EDICT_FOLLOW,
  FINAL_EDICT_LAND,
  FINAL_EDICT_PALETTE,
  FINAL_EDICT_SLASH_SEGMENTS,
  FINAL_EDICT_SPARKS,
  FINAL_EDICT_STAMP_CAPACITY,
  FINAL_EDICT_STAMP_VERTICES,
  FINAL_EDICT_VERTICES_PER_CAST,
  FINAL_EDICT_WAVE_CAPACITY,
  FINAL_EDICT_WAVE_DURATION,
  FINAL_EDICT_WAVE_RADIUS,
  FINAL_EDICT_WAVE_VERTICES,
  sampleEdictSpark,
} from '../final_edict_core';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { noteVowkeeperWeapon } from '../paladin_shield_buffs';
import type { VfxAnchorResolver } from '../vfx_anchor';
import type { WeaponAnchorSampler } from '../weapon_trail_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { effectFloor, GROUND_DEPTH_PULL, GROUND_DEPTH_PULL_GLSL } from './effect_floor';

// Additive light in the shared Paladin palette. Nothing here darkens the scene.
const COLORS = {
  hot: new THREE.Color(FINAL_EDICT_PALETTE.ivory).multiplyScalar(1.3),
  gold: new THREE.Color(FINAL_EDICT_PALETTE.gold).multiplyScalar(1.25),
  rose: new THREE.Color(FINAL_EDICT_PALETTE.peach).multiplyScalar(1.1),
};
type Tone = keyof typeof COLORS;
/** Shapes above `spark` lie on the ground. */
export const EDICT_SHAPE = {
  weapon: 0,
  slash: 1,
  flare: 2,
  ring: 3,
  spark: 4,
  seal: 5,
  band: 6,
  spoke: 7,
} as const;
const SHAPE = EDICT_SHAPE;

const MAX_VERTICES =
  FINAL_EDICT_CAPACITY * FINAL_EDICT_VERTICES_PER_CAST +
  FINAL_EDICT_WAVE_CAPACITY * FINAL_EDICT_WAVE_VERTICES +
  FINAL_EDICT_STAMP_CAPACITY * FINAL_EDICT_STAMP_VERTICES;
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
/** The newest-first slot of oldest-first sample `k` in a path of `last + 1`. */
function pathIndex(last: number, k: number): number {
  return (last - Math.min(last, Math.max(0, k))) * 4;
}
const UPLOAD_ATTRIBUTES = [
  'position',
  'aColor',
  'aAlpha',
  'aUv',
  'aShape',
  'aGroundDistance',
  'aTime',
] as const;
/** Ground-lying light sits this far over the floor (the depth pull does the rest). */
const GROUND_LIFT = 0.03;

interface Slot {
  active: boolean;
  /** Seconds since the strike resolved; the blow lands at FINAL_EDICT_LAND. */
  age: number;
  target: number;
  source: number;
  /** Contact point on the recipient. */
  x: number;
  y: number;
  z: number;
  /** Horizontal strike direction, caster to recipient. */
  fx: number;
  fz: number;
  ground: number;
  critical: boolean;
  outcome: EdictOutcome;
  landed: boolean;
  onLand: (() => void) | null;
  /** The weapon tip's path down the swing, newest first: x, y, z, age. */
  path: Float32Array;
  points: number;
  /** The caster's weapon sampler, cached for the slot's life (resolving one
   *  walks the rig), with the elapsed time of its next lookup when missing. */
  weapon: WeaponAnchorSampler | null;
  weaponRetry: number;
}

interface Wave {
  active: boolean;
  age: number;
  source: number;
  x: number;
  z: number;
  /** The Paladin's displayed feet, for raised floors. */
  feet: number;
  radius: number;
}

interface Stamp {
  active: boolean;
  age: number;
  /** When the shockwave reaches this enemy, in seconds after the cue. */
  at: number;
  target: number;
  x: number;
  y: number;
  z: number;
  ground: number;
  fx: number;
  fz: number;
  absorbed: boolean;
}

/** One bounded draw, no textures, lights, camera impulses or cast-time assets.
 * The preparation carrier borrows this exact geometry/material and uploads it
 * through the existing scheduler before the pool accepts a cast. */
export class FinalEdict {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'final_edict'>;
  private readonly slots: Slot[] = Array.from({ length: FINAL_EDICT_CAPACITY }, () => ({
    active: false,
    age: 0,
    target: -1,
    source: -1,
    x: 0,
    y: 0,
    z: 0,
    fx: 0,
    fz: 1,
    ground: 0,
    critical: false,
    outcome: 'none',
    landed: false,
    onLand: null,
    path: new Float32Array(EDICT_TRAIL.points * 4),
    points: 0,
    weapon: null,
    weaponRetry: 0,
  }));
  private readonly waves: Wave[] = Array.from({ length: FINAL_EDICT_WAVE_CAPACITY }, () => ({
    active: false,
    age: 0,
    source: -1,
    x: 0,
    z: 0,
    feet: 0,
    radius: FINAL_EDICT_WAVE_RADIUS,
  }));
  private readonly stamps: Stamp[] = Array.from({ length: FINAL_EDICT_STAMP_CAPACITY }, () => ({
    active: false,
    age: 0,
    at: 0,
    target: -1,
    x: 0,
    y: 0,
    z: 0,
    ground: 0,
    fx: 0,
    fz: 1,
    absorbed: false,
  }));
  private readonly positions = new Float32Array(MAX_VERTICES * 3);
  private readonly colors = new Float32Array(MAX_VERTICES * 3);
  private readonly alphas = new Float32Array(MAX_VERTICES);
  private readonly uvs = new Float32Array(MAX_VERTICES * 2);
  private readonly shapes = new Float32Array(MAX_VERTICES);
  private readonly groundDistances = new Float32Array(MAX_VERTICES);
  private readonly times = new Float32Array(MAX_VERTICES);
  private readonly window: EdictSlashWindow = { head: 0, tail: 0 };
  private readonly pose: EdictWavePose = { front: 0, shock: 0, edge: 0, spokes: 0 };
  private readonly spark: EdictSpark = {
    forward: 0,
    up: 0,
    side: 0,
    vForward: 0,
    vUp: 0,
    vSide: 0,
    alpha: 0,
  };
  private readonly source = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly weaponAt = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  /** Resampled blade path: x, y, z, age, then the edge offset x, y, z, width. */
  private readonly blade = new Float32Array((FINAL_EDICT_SLASH_SEGMENTS + 1) * 8);
  /** The last weaponLight call found the weapon itself, not the chest. */
  private tip = false;
  private vertex = 0;
  private time = 0;
  private ground = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly camera?: THREE.Camera,
    private readonly groundY?: (x: number, z: number) => number,
    /** The Paladin's weapon, where the empowered strike blazes. */
    private readonly weapon?: (id: number, hand: 0 | 1) => WeaponAnchorSampler | null,
  ) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, array, size] of [
      ['position', this.positions, 3],
      ['aColor', this.colors, 3],
      ['aAlpha', this.alphas, 1],
      ['aUv', this.uvs, 2],
      ['aShape', this.shapes, 1],
      ['aGroundDistance', this.groundDistances, 1],
      ['aTime', this.times, 1],
    ] as const)
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage),
      );
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute vec2 aUv;
        attribute float aAlpha, aShape, aGroundDistance, aTime;
        varying vec3 vColor;
        varying vec2 vUv;
        varying float vAlpha, vShape, vGroundDistance, vTime;
        ${GROUND_DEPTH_PULL_GLSL}
        void main() {
          vColor = aColor; vAlpha = aAlpha; vUv = aUv; vShape = aShape;
          vGroundDistance = aGroundDistance; vTime = aTime;
          gl_Position = projectionMatrix
            * groundPulledView(position, aShape > 4.5 ? ${GROUND_DEPTH_PULL.toFixed(2)} : 0.0);
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying vec2 vUv;
        varying float vAlpha, vShape, vGroundDistance, vTime;
        const vec3 HOT = vec3(1.0, 0.88, 0.604);
        float band(float r, float at, float width) { float d = (r - at) / width; return exp(-d * d); }
        float sq(float x){return x*x;}
        void main() {
          if (vAlpha <= 0.001) discard;
          float t = vTime;
          vec2 p = vec2(vUv.x * 2.0 - 1.0, vUv.y);
          float r = length(p);
          float mask = 0.0;
          vec3 color = vColor;
          // Light in the air fades out against the floor; ground light lies on it.
          float grounded = vShape > 4.5 ? 1.0 : smoothstep(0.0, 0.25, vGroundDistance);
          if (vShape > 6.5) {
            // A sun ray racing out along the ground behind the shockwave,
            // brightest toward the front.
            float u = vUv.x;
            mask = exp(-vUv.y * vUv.y * 7.0) * smoothstep(0.0, 0.2, u) * (0.35 + 0.65 * u)
              * (1.0 - smoothstep(0.88, 1.0, u));
          } else if (vShape > 5.5) {
            // A ribbon of light on the ground (the shockwave, the reach's edge).
            float v = vUv.y;
            mask = exp(-v * v * 6.0) + exp(-v * v * 1.5) * 0.25;
            color = mix(vColor, HOT, exp(-v * v * 14.0) * 0.6);
          } else if (vShape > 4.5) {
            // The edict's seal: a ring about a planted sword, pointing along the
            // blow. It flashes as it is stamped.
            float outer = band(r, 0.88, 0.04);
            float inner = band(r, 0.72, 0.022) * 0.55;
            float along = p.x;
            float halfWidth = mix(0.09, 0.0, clamp((along - 0.2) / 0.42, 0.0, 1.0));
            float blade = step(-0.36, along) * (1.0 - smoothstep(0.6, 0.63, along))
              * (1.0 - smoothstep(halfWidth * 0.6, halfWidth + 0.015, abs(p.y)));
            float guard = (1.0 - smoothstep(0.045, 0.065, abs(along + 0.3)))
              * (1.0 - smoothstep(0.27, 0.3, abs(p.y)));
            float pommel = 1.0 - smoothstep(0.06, 0.08, length(vec2(along + 0.5, p.y)));
            float glyph = max(max(blade, guard), pommel);
            float flash = exp(-r * r * 3.0) * clamp(1.0 - t / 0.12, 0.0, 1.0) * 0.6;
            mask = (outer + inner + glyph * 0.9 + flash) * (1.0 - smoothstep(0.95, 1.0, r));
            color = mix(vColor, HOT, clamp(glyph * 0.5 + flash, 0.0, 1.0));
          } else if (vShape > 3.5) {
            // Spark streak: hot head, tail trailing back along its flight.
            float head = exp(-((vUv.x - 0.85) * (vUv.x - 0.85) * 30.0 + vUv.y * vUv.y * 6.0));
            mask = exp(-vUv.y * vUv.y * 5.0) * pow(max(vUv.x,0.0),1.6) * 0.8 + head;
            color = mix(vColor, HOT, head);
          } else if (vShape > 2.5) {
            // Shield ping: a ring racing out from a caught blow.
            float grow = 1.0 - pow(max(1.0 - clamp(t / 0.22, 0.0, 1.0),0.0),3.0);
            float radius = 0.25 + 0.65 * grow;
            mask = band(r, radius, 0.035 + 0.06 * t) + exp(-r * r * 6.0) * 0.15 * (1.0 - grow);
            mask *= 1.0 - smoothstep(0.95, 1.0, r);
          } else if (vShape > 1.5) {
            // Contact flare: white core and a four-point holy star.
            float core = exp(-r * r * 16.0);
            float halo = exp(-r * r * 4.0) * 0.3;
            float spokeX = exp(-abs(p.y) * 32.0) * exp(-abs(p.x) * 1.8);
            float spokeY = exp(-abs(p.x) * 32.0) * exp(-abs(p.y) * 2.6);
            mask = (core * 1.5 + halo + (spokeX + spokeY) * 0.8);
            mask *= 1.0 - smoothstep(0.85, 1.0, max(abs(p.x), abs(p.y)));
            color = mix(vColor, HOT, core);
          } else if (vShape > 0.5) {
            // Chop crescent: a razor-bright cutting edge over a thin gold body
            // that thins to nothing behind it.
            float v = vUv.y;
            float edge = exp(-sq((v - 0.62) * 9.0));
            float body = smoothstep(-1.0, 0.6, v) * (1.0 - smoothstep(0.6, 0.85, v)) * 0.32;
            mask = (edge * 1.4 + body) * (1.0 - smoothstep(0.85, 1.0, abs(v)));
            color = mix(vec3(1.0, 0.62, 0.22) * 1.3, HOT, clamp(edge * 1.2, 0.0, 1.0));
          } else {
            // The empowered weapon: holy light gathering on it through the raise
            // and blazing as it strikes; a hot core, a six-point star, a halo.
            float core = exp(-r * r * 20.0);
            float a = atan(p.y, p.x);
            float star = pow(max(cos(a * 3.0), 0.0), 24.0) * exp(-r * 2.5) * (1.0 - smoothstep(0.5, 0.95, r));
            float halo = exp(-r * r * 5.0) * 0.4;
            mask = (core * 1.6 + star * 0.9 + halo) * (1.0 - smoothstep(0.55, 1.0, r));
            color = mix(vColor, HOT, core + star * 0.4);
          }
          float alpha = vAlpha * mask * grounded;
          if(!(alpha>=0.002)) discard;
          gl_FragColor = vec4(color, alpha);
          #include <colorspace_fragment>
        }`,
    });
    material.name = 'final_edict:surface';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'final-edict-holy-light';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = floorVfxRenderOrder('player', 0);
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([['final_edict', geometry]]), material);
  }

  /** The strike resolved on `targetId`. The light gathers on the weapon until
   * the blow lands, when `onLand` runs (the jolt and the flinch). */
  spawn(
    sourceId: number,
    targetId: number,
    outcome: EdictOutcome,
    critical: boolean,
    onLand?: () => void,
  ): boolean {
    if (this.disposed || outcome === 'none' || !this.preparation.ready('final_edict')) return false;
    if (!this.anchor(targetId, 0.62, this.target)) return false;
    const slot = this.oldest(this.slots);
    // A slot cut short still owes its landing.
    if (slot.active && !slot.landed) slot.onLand?.();
    slot.active = true;
    slot.age = 0;
    slot.target = targetId;
    slot.source = sourceId;
    slot.critical = critical;
    slot.outcome = outcome;
    slot.landed = false;
    slot.onLand = onLand ?? null;
    slot.points = 0;
    slot.weapon = null;
    slot.weaponRetry = 0;
    this.place(slot);
    return true;
  }

  /** Ascension's Holy explosion around `sourceId`, out to `radius` yards. It
   * releases with the blow. */
  verdict(sourceId: number, radius: number): boolean {
    if (this.disposed || !this.preparation.ready('final_edict')) return false;
    const feet = this.anchor(sourceId, 0, this.feet);
    if (!feet) return false;
    const wave = this.oldest(this.waves);
    wave.active = true;
    wave.age = 0;
    wave.source = sourceId;
    wave.x = feet.x;
    wave.z = feet.z;
    wave.feet = feet.y;
    wave.radius = radius > 0 ? radius : FINAL_EDICT_WAVE_RADIUS;
    return true;
  }

  /** An enemy the explosion struck: its seal is stamped as the shockwave
   * reaches it. */
  areaHit(sourceId: number, targetId: number, outcome: EdictOutcome): boolean {
    if (this.disposed || outcome === 'none' || !this.preparation.ready('final_edict')) return false;
    if (!this.anchor(targetId, 0.62, this.target)) return false;
    let wave: Wave | null = null;
    for (const w of this.waves)
      if (w.active && w.source === sourceId && (!wave || w.age < wave.age)) wave = w;
    const stamp = this.oldest(this.stamps);
    stamp.active = true;
    stamp.age = wave ? wave.age : 0;
    stamp.target = targetId;
    stamp.absorbed = outcome === 'absorb';
    const dx = wave ? this.target.x - wave.x : 0;
    const dz = wave ? this.target.z - wave.z : 1;
    const distance = Math.hypot(dx, dz);
    stamp.fx = distance > 0.001 ? dx / distance : 0;
    stamp.fz = distance > 0.001 ? dz / distance : 1;
    stamp.at = FINAL_EDICT_LAND + (wave ? edictWaveArrival(distance, wave.radius) : 0);
    this.placeStamp(stamp);
    return true;
  }

  private oldest<T extends { active: boolean; age: number }>(pool: T[]): T {
    const free = pool.find((candidate) => !candidate.active);
    if (free) return free;
    let slot = pool[0];
    for (const candidate of pool) if (candidate.age > slot.age) slot = candidate;
    return slot;
  }

  private place(slot: Slot): void {
    const from = this.anchor(slot.source, 0.62, this.source);
    const dx = from ? this.target.x - from.x : 0;
    const dz = from ? this.target.z - from.z : 1;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.001) {
      slot.fx = dx / distance;
      slot.fz = dz / distance;
    }
    slot.x = this.target.x;
    slot.y = this.target.y;
    slot.z = this.target.z;
    // The recipient's feet are the visible floor on docks, bridges and tiers.
    const feet = this.anchor(slot.target, 0, this.feet)?.y;
    slot.ground = effectFloor(this.groundY?.(slot.x, slot.z), feet);
  }

  private placeStamp(stamp: Stamp): void {
    stamp.x = this.target.x;
    stamp.y = this.target.y;
    stamp.z = this.target.z;
    const feet = this.anchor(stamp.target, 0, this.feet)?.y;
    stamp.ground = effectFloor(this.groundY?.(stamp.x, stamp.z), feet);
  }

  update(dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    const step = Math.max(0, dt);
    this.clock += step;
    this.vertex = 0;
    const v = this.view();
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += step;
      if (!slot.landed && slot.age >= FINAL_EDICT_LAND) {
        slot.landed = true;
        const land = slot.onLand;
        slot.onLand = null;
        land?.();
      }
      if (slot.age >= FINAL_EDICT_LAND + FINAL_EDICT_AFTER) {
        slot.active = false;
        noteVowkeeperWeapon(slot.source, 0, 0);
        continue;
      }
      // The Paladin's own weapon blazes through the swing and flares as the
      // blow lands (the character's glowing layer, shared with Vowkeeper Strike).
      {
        const since = slot.age - FINAL_EDICT_LAND;
        const weak = slot.outcome === 'absorb' ? 0.6 : 1;
        const rise = Math.min(1, slot.age / 0.12);
        const glow = since < 0 ? 0.9 : 0.9 * Math.max(0, 1 - Math.max(0, since - 0.1) / 0.45);
        noteVowkeeperWeapon(
          slot.source,
          rise * glow * weak,
          since < 0 ? 0 : Math.exp(-since * 14) * (slot.critical ? 1.2 : 1) * weak,
        );
      }
      // Contact follows the recipient until just after the blow lands; the
      // released light then stays in world space. A despawn retires the effect
      // instead of inventing a body.
      if (slot.age <= FINAL_EDICT_LAND + FINAL_EDICT_FOLLOW) {
        if (!this.anchor(slot.target, 0.62, this.target)) {
          slot.active = false;
          continue;
        }
        this.place(slot);
      }
      this.ground = slot.ground;
      const since = slot.age - FINAL_EDICT_LAND;
      this.weaponLight(slot, v, since);
      // The blade of light follows the weapon down its swing.
      if (this.tip && since >= -EDICT_TRAIL.lead && since <= EDICT_TRAIL.hold) this.record(slot);
      if (since < 0) {
        this.trail(slot, v, since);
        continue;
      }
      if (slot.outcome === 'absorb') {
        this.trail(slot, v, since);
        this.absorb(slot, v, since);
      } else this.strike(slot, v, since, reducedMotion);
    }
    for (const wave of this.waves) {
      if (!wave.active) continue;
      wave.age += step;
      const since = wave.age - FINAL_EDICT_LAND;
      if (since >= FINAL_EDICT_WAVE_DURATION) {
        wave.active = false;
        continue;
      }
      if (since >= 0) this.wave(wave, since, reducedMotion);
    }
    for (const stamp of this.stamps) {
      if (!stamp.active) continue;
      stamp.age += step;
      const since = stamp.age - stamp.at;
      if (since >= EDICT_STAMP_DURATION) {
        stamp.active = false;
        continue;
      }
      if (since < 0) {
        // The enemy keeps moving until the shockwave reaches it.
        if (this.anchor(stamp.target, 0.62, this.target)) this.placeStamp(stamp);
        continue;
      }
      this.stamp(stamp, v, since);
    }
    this.mesh.visible = this.vertex > 0;
    this.mesh.geometry.setDrawRange(0, this.vertex);
    if (!this.vertex) return;
    for (const name of UPLOAD_ATTRIBUTES) {
      const attribute = this.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, this.vertex * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }

  /** Camera basis: right, up and viewing direction. Tests without a camera get
   * a fixed front view. */
  private view(): number[] {
    const v = this.viewBasis;
    const e = this.camera?.matrixWorld.elements;
    if (!e) {
      v.fill(0);
      v[0] = 1;
      v[4] = 1;
      v[8] = -1;
      return v;
    }
    v[0] = e[0];
    v[1] = e[1];
    v[2] = e[2];
    v[3] = e[4];
    v[4] = e[5];
    v[5] = e[6];
    v[6] = -e[8];
    v[7] = -e[9];
    v[8] = -e[10];
    return v;
  }
  /** Per-frame scratch: the camera basis and the last `across` result. */
  private readonly viewBasis: number[] = new Array(9).fill(0);
  private readonly acrossOut: number[] = [0, 0, 0];
  /** Seconds this effect has run, for the weapon sampler's retry clock. */
  private clock = 0;

  /** The empowered weapon: light gathering on the Paladin's weapon as it is
   * raised, blazing as it lands (their chest when no weapon can be found). */
  private weaponLight(slot: Slot, v: number[], since: number): void {
    if (!slot.weapon && this.clock >= slot.weaponRetry) {
      slot.weapon = this.weapon?.(slot.source, 0) ?? null;
      slot.weaponRetry = this.clock + 0.25;
    }
    this.tip = slot.weapon?.(this.weaponAt) === true;
    // A sampler whose weapon is gone is looked up again after the delay.
    if (!this.tip && slot.weapon) slot.weapon = null;
    const armed = this.tip || this.anchor(slot.source, 0.75, this.weaponAt) !== null;
    const scale = slot.critical ? 1.2 : 1;
    const size = since < 0 ? 0.5 + 0.35 * (1 + since / FINAL_EDICT_LAND) : 0.9;
    this.time = Math.max(0, since);
    this.billboard(
      this.weaponAt.x,
      this.weaponAt.y,
      this.weaponAt.z,
      v,
      size * scale,
      'hot',
      armed
        ? edictAlpha('weapon', since, slot.critical) * (slot.outcome === 'absorb' ? 0.6 : 1)
        : 0,
      SHAPE.weapon,
    );
  }

  private absorb(slot: Slot, v: number[], age: number): void {
    this.time = age;
    // A shield ping: the verdict was caught, so no blade and no seal.
    this.billboard(
      slot.x,
      slot.y,
      slot.z,
      v,
      0.45,
      'hot',
      edictAlpha('flare', age, false) * 0.45,
      SHAPE.flare,
    );
    this.billboard(
      slot.x,
      slot.y,
      slot.z,
      v,
      0.7,
      'gold',
      edictAlpha('ring', age, false) * 0.8,
      SHAPE.ring,
    );
  }

  private strike(slot: Slot, v: number[], age: number, reduced: boolean): void {
    const crit = slot.critical;
    const scale = crit ? 1.2 : 1;
    const fx = slot.fx,
      fz = slot.fz;
    const sx = -fz,
      sz = fx;

    // The one blade of light: the weapon's own path down through the victim,
    // or, when the weapon cannot be followed, the clip's diagonal cut.
    if (slot.points >= 2) this.trail(slot, v, age);
    else this.slash(slot, v, scale, reduced, age);

    this.time = reduced ? 0.3 : age;
    this.billboard(
      slot.x,
      slot.y,
      slot.z,
      v,
      0.95 * scale,
      'hot',
      edictAlpha('flare', age, crit),
      SHAPE.flare,
    );

    // The edict's seal, stamped on the ground beneath the victim, its sword
    // planted along the blow.
    const seal = EDICT_SEAL_RADIUS * scale * (reduced ? 1 : edictSealScale(age));
    this.time = age;
    this.groundQuad(
      slot.x,
      slot.ground,
      slot.z,
      fx * seal,
      fz * seal,
      sx * seal,
      sz * seal,
      'gold',
      edictAlpha('seal', age, crit),
      SHAPE.seal,
    );

    // Sparks: thrown onward through the victim, each streak along its flight.
    const s = this.spark;
    for (let i = 0; i < FINAL_EDICT_SPARKS; i++) {
      sampleEdictSpark(i, age, reduced, crit, s);
      const hx = slot.x + fx * s.forward + sx * s.side;
      const hy = slot.y + s.up;
      const hz = slot.z + fz * s.forward + sz * s.side;
      let ax = fx * s.vForward + sx * s.vSide,
        ay = s.vUp,
        az = fz * s.vForward + sz * s.vSide;
      const speed = Math.hypot(ax, ay, az) || 1;
      ax /= speed;
      ay /= speed;
      az /= speed;
      const streak = Math.min(0.7, Math.max(0.2, speed * 0.09)) * 0.5;
      const p = this.across(ax, ay, az, v, crit ? 0.07 : 0.06);
      const px = p[0],
        py = p[1],
        pz = p[2];
      this.quad(
        hx - ax * streak,
        hy - ay * streak,
        hz - az * streak,
        ax * streak,
        ay * streak,
        az * streak,
        px,
        py,
        pz,
        i % 4 === 0 ? 'rose' : i % 2 ? 'hot' : 'gold',
        s.alpha * edictAlpha('spark', age, crit),
        SHAPE.spark,
      );
    }
  }

  /** Keeps the weapon tip's newest position (this.weaponAt) on the path. */
  private record(slot: Slot): void {
    const p = slot.path;
    if (
      slot.points > 0 &&
      Math.hypot(this.weaponAt.x - p[0], this.weaponAt.y - p[1], this.weaponAt.z - p[2]) < 0.02
    ) {
      p[3] = slot.age;
      return;
    }
    p.copyWithin(4, 0, (EDICT_TRAIL.points - 1) * 4);
    p[0] = this.weaponAt.x;
    p[1] = this.weaponAt.y;
    p[2] = this.weaponAt.z;
    p[3] = slot.age;
    slot.points = Math.min(EDICT_TRAIL.points, slot.points + 1);
  }

  /** A point `f` along the recorded path (0 its oldest, 1 the weapon), smoothed
   * through the samples (Catmull-Rom), into `out` at `at`: x, y, z, age. */
  private along(slot: Slot, f: number, out: Float32Array, at: number): void {
    const p = slot.path;
    const last = slot.points - 1;
    // Oldest-first index i lives at newest-first slot (last - i).
    const x = Math.min(last, Math.max(0, f * last));
    const i = Math.min(last - 1, Math.floor(x));
    const t = x - i;
    const a = pathIndex(last, i - 1),
      b = pathIndex(last, i),
      c = pathIndex(last, i + 1),
      d = pathIndex(last, i + 2);
    const t2 = t * t,
      t3 = t2 * t;
    for (let k = 0; k < 4; k++) {
      const p0 = p[a + k],
        p1 = p[b + k],
        p2 = p[c + k],
        p3 = p[d + k];
      out[at + k] =
        0.5 *
        (2 * p1 +
          (-p0 + p2) * t +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
          (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    }
  }

  /** The blade of light along the weapon's path: brightest and widest at the
   * weapon, each part burning out as the weapon leaves it, with a flash as
   * the blow lands. Its sharp edge faces away from the Paladin's shoulder. */
  private trail(slot: Slot, v: number[], since: number): void {
    if (slot.points < 2) return;
    const scale = slot.critical ? 1.2 : 1;
    const env =
      (since < 0 ? 0.85 : 0.85 + 0.6 * Math.exp(-since * 18)) *
      (slot.outcome === 'absorb' ? 0.55 : 1);
    const b = this.blade;
    const segments = FINAL_EDICT_SLASH_SEGMENTS;
    for (let k = 0; k <= segments; k++) this.along(slot, k / segments, b, k * 8);
    const shoulder = this.anchor(slot.source, 0.8, this.shoulder);
    // One side for the whole blade, from its middle, so it never twists.
    const mid = (segments >> 1) * 8;
    const m = this.across(
      b[mid + 8] - b[mid - 8],
      b[mid + 9] - b[mid - 7],
      b[mid + 10] - b[mid - 6],
      v,
      1,
    );
    const mx = m[0],
      my = m[1],
      mz = m[2];
    const flip =
      shoulder &&
      mx * (b[mid] - shoulder.x) + my * (b[mid + 1] - shoulder.y) + mz * (b[mid + 2] - shoulder.z) <
        0
        ? -1
        : 1;
    for (let k = 0; k <= segments; k++) {
      const o = k * 8;
      const prev = Math.max(0, k - 1) * 8,
        next = Math.min(segments, k + 1) * 8;
      const n = this.across(
        b[next] - b[prev],
        b[next + 1] - b[prev + 1],
        b[next + 2] - b[prev + 2],
        v,
        flip,
      );
      const nx = n[0],
        ny = n[1],
        nz = n[2];
      const u = k / segments;
      b[o + 4] = nx;
      b[o + 5] = ny;
      b[o + 6] = nz;
      b[o + 7] = EDICT_SLASH.width * 0.4 * scale * (0.2 + 0.8 * u);
    }
    this.time = Math.max(0, since);
    for (let segment = 0; segment < segments; segment++)
      for (let j = 0; j < 6; j++) {
        const k = segment + CORNERS[j * 2];
        const side = CORNERS[j * 2 + 1];
        const o = k * 8;
        const burnt = (slot.age - b[o + 3]) / EDICT_TRAIL.life;
        const fresh = burnt <= 0 ? 1 : burnt >= 1 ? 0 : 1 - burnt * burnt * (3 - 2 * burnt);
        const width = b[o + 7];
        this.put(
          b[o] + b[o + 4] * side * width,
          b[o + 1] + b[o + 5] * side * width,
          b[o + 2] + b[o + 6] * side * width,
          k / segments,
          side,
          'hot',
          env * fresh,
          SHAPE.slash,
        );
      }
  }

  /** The cut when the weapon cannot be followed: an arc in the clip's diagonal
   * plane, from high over the Paladin's right shoulder down through the victim
   * to low on their left, widened toward the camera so it keeps its body at
   * grazing views. The visible window is baked into vertex alpha, brightest
   * where the sweep is arriving. */
  private slash(slot: Slot, v: number[], scale: number, reduced: boolean, age: number): void {
    const w = this.window;
    edictSlashWindow(age, reduced, w);
    // In-plane axes: along the blow, and upright leaned toward the Paladin's right.
    const ux = slot.fx,
      uz = slot.fz;
    const lean = EDICT_SLASH.lean;
    const vx = -slot.fz * Math.sin(lean),
      vy = Math.cos(lean),
      vz = slot.fx * Math.sin(lean);
    const radius = EDICT_SLASH.radius * scale;
    const cy = slot.y + EDICT_SLASH.lift;
    const base = edictAlpha('slash', age, slot.critical);
    this.time = age;
    for (let segment = 0; segment < FINAL_EDICT_SLASH_SEGMENTS; segment++)
      for (let j = 0; j < 6; j++) {
        const u = (segment + CORNERS[j * 2]) / FINAL_EDICT_SLASH_SEGMENTS;
        const side = CORNERS[j * 2 + 1];
        const theta = EDICT_SLASH.from + (EDICT_SLASH.to - EDICT_SLASH.from) * u;
        const c = Math.cos(theta),
          s = Math.sin(theta);
        // Radial and tangent directions in the plane, then the camera-facing
        // perpendicular, flipped outward so the sharp edge stays outside.
        const rx = c * ux + s * vx,
          ry = s * vy,
          rz = c * uz + s * vz;
        const tx = -s * ux + c * vx,
          ty = c * vy,
          tz = -s * uz + c * vz;
        const n = this.across(tx, ty, tz, v, 1);
        let nx = n[0],
          ny = n[1],
          nz = n[2];
        if (nx * rx + ny * ry + nz * rz < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const width = EDICT_SLASH.width * scale * Math.sin(Math.PI * u) ** 0.6 * 0.5;
        const shown =
          (u <= w.head ? 1 : 0) *
          Math.min(1, Math.max(0, (u - w.tail) / 0.18)) *
          (w.tail >= 1 ? 0 : 1);
        const arriving = w.head < 1 ? 1 + 1.2 * Math.exp(-(w.head - u) * 14) : 1;
        this.put(
          slot.x + rx * radius + nx * side * width,
          cy + ry * radius + ny * side * width,
          slot.z + rz * radius + nz * side * width,
          u,
          side,
          'hot',
          base * shown * arriving,
          SHAPE.slash,
        );
      }
  }

  /** The Holy explosion: a shockwave racing out over the ground behind sun
   * rays, then the reach held as a ring of light at its true radius. */
  private wave(wave: Wave, age: number, reduced: boolean): void {
    const pose = this.pose;
    edictWavePose(age, wave.radius, reduced, pose);
    this.time = age;
    // Sun rays behind the front.
    const inner = wave.radius * 0.12;
    for (let i = 0; i < EDICT_WAVE_SPOKES; i++) {
      const a = (i / EDICT_WAVE_SPOKES) * Math.PI * 2 + 0.13;
      const cx = Math.cos(a),
        cz = Math.sin(a);
      const half = Math.max(0, pose.front - inner) * 0.5;
      const mid = inner + half;
      const x = wave.x + cx * mid,
        z = wave.z + cz * mid;
      this.ground = this.floorAt(wave, x, z);
      this.groundQuad(
        x,
        this.ground,
        z,
        cx * half,
        cz * half,
        -cz * 0.09,
        cx * 0.09,
        'gold',
        half > 0 ? pose.spokes : 0,
        SHAPE.spoke,
      );
    }
    // The shockwave's front, then the reach's edge.
    this.ring(wave, pose.front, 0.6, EDICT_WAVE_SHOCK_SEGMENTS, 'hot', pose.shock);
    this.ring(wave, wave.radius, 0.17, EDICT_WAVE_EDGE_SEGMENTS, 'gold', pose.edge);
  }

  private ring(
    wave: Wave,
    radius: number,
    width: number,
    segments: number,
    tone: Tone,
    alpha: number,
  ): void {
    const halfChord = (Math.PI / segments) * radius * 1.03;
    for (let i = 0; i < segments; i++) {
      const a = ((i + 0.5) / segments) * Math.PI * 2;
      const cx = Math.cos(a),
        cz = Math.sin(a);
      const x = wave.x + cx * radius,
        z = wave.z + cz * radius;
      this.ground = this.floorAt(wave, x, z);
      this.groundQuad(
        x,
        this.ground,
        z,
        -cz * halfChord,
        cx * halfChord,
        cx * width * 0.5,
        cz * width * 0.5,
        tone,
        alpha,
        SHAPE.band,
      );
    }
  }

  private floorAt(wave: Wave, x: number, z: number): number {
    return effectFloor(this.groundY?.(x, z), wave.feet);
  }

  /** An enemy the explosion struck: the seal beneath them and a flare. */
  private stamp(stamp: Stamp, v: number[], age: number): void {
    const alpha = edictStampAlpha(age) * (stamp.absorbed ? 0.4 : 1);
    const seal = EDICT_SEAL_RADIUS * EDICT_STAMP_SCALE * edictSealScale(age);
    this.ground = stamp.ground;
    this.time = age;
    this.groundQuad(
      stamp.x,
      stamp.ground,
      stamp.z,
      stamp.fx * seal,
      stamp.fz * seal,
      -stamp.fz * seal,
      stamp.fx * seal,
      'gold',
      alpha * 0.85,
      SHAPE.seal,
    );
    this.billboard(
      stamp.x,
      stamp.y,
      stamp.z,
      v,
      0.55,
      'hot',
      alpha * Math.exp(-age * 9),
      SHAPE.flare,
    );
  }

  /** Unit vector across a direction as seen by the camera, scaled. */
  private across(ax: number, ay: number, az: number, v: number[], size: number): number[] {
    // cross(direction, view)
    let px = ay * v[8] - az * v[7],
      py = az * v[6] - ax * v[8],
      pz = ax * v[7] - ay * v[6];
    const length = Math.hypot(px, py, pz);
    if (length < 0.0001) {
      px = v[0];
      py = v[1];
      pz = v[2];
    } else {
      px /= length;
      py /= length;
      pz /= length;
    }
    const out = this.acrossOut;
    out[0] = px * size;
    out[1] = py * size;
    out[2] = pz * size;
    return out;
  }

  private billboard(
    x: number,
    y: number,
    z: number,
    v: number[],
    half: number,
    tone: Tone,
    alpha: number,
    shape: number,
  ): void {
    this.quad(
      x,
      y,
      z,
      v[0] * half,
      v[1] * half,
      v[2] * half,
      v[3] * half,
      v[4] * half,
      v[5] * half,
      tone,
      alpha,
      shape,
    );
  }

  /** A quad lying on the floor at `y`: u along (ax, az), v along (bx, bz). */
  private groundQuad(
    x: number,
    y: number,
    z: number,
    ax: number,
    az: number,
    bx: number,
    bz: number,
    tone: Tone,
    alpha: number,
    shape: number,
  ): void {
    this.ground = y;
    this.quad(x, y + GROUND_LIFT, z, ax, 0, az, bx, 0, bz, tone, alpha, shape);
  }

  /** Quad about a centre: u runs along `a` (0 at -a), v along `b` (-1 to 1). */
  private quad(
    x: number,
    y: number,
    z: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    tone: Tone,
    alpha: number,
    shape: number,
  ): void {
    for (let j = 0; j < 6; j++) {
      const u = CORNERS[j * 2],
        side = CORNERS[j * 2 + 1],
        along = u * 2 - 1;
      this.put(
        x + ax * along + bx * side,
        y + ay * along + by * side,
        z + az * along + bz * side,
        u,
        side,
        tone,
        alpha,
        shape,
      );
    }
  }

  private put(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    tone: Tone,
    alpha: number,
    shape: number,
  ): void {
    if (this.vertex >= MAX_VERTICES) return;
    const i = this.vertex++,
      j = i * 3,
      color = COLORS[tone];
    this.positions[j] = x;
    this.positions[j + 1] = y;
    this.positions[j + 2] = z;
    this.colors[j] = color.r;
    this.colors[j + 1] = color.g;
    this.colors[j + 2] = color.b;
    this.alphas[i] = Math.max(0, alpha);
    this.uvs[i * 2] = u;
    this.uvs[i * 2 + 1] = v;
    this.shapes[i] = shape;
    this.groundDistances[i] = y - this.ground;
    this.times[i] = this.time;
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.onLand = null;
    }
    for (const wave of this.waves) wave.active = false;
    for (const stamp of this.stamps) stamp.active = false;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const release of [
      () => this.clear(),
      () => this.preparation.dispose(),
      () => this.mesh.removeFromParent(),
      () => this.mesh.geometry.dispose(),
      () => this.mesh.material.dispose(),
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Final Edict cleanup failed');
  }
}
