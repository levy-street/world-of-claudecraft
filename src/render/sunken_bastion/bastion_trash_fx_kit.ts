// The shared kit of the Sunken Bastion trash mechanics' painters
// (bastion_trash_fx.ts and its siblings bastion_boathook_fx.ts,
// bastion_fog_bank_fx.ts, bastion_brine_column_fx.ts): the particle looks
// written into the creature effects' two pooled draws, the pooled shock rings
// on the floor, the one shell program every standing volume and band shares,
// and the body measures (model scale, drawn height, model anchors).
//
// Rules (src/render/CLAUDE.md): built once, pooled, no per-frame allocation.
// Every material is made at construction, under the Bastion telegraph root's
// compile gate.

import * as THREE from 'three';
import { MOBS } from '../../sim/data';
import type { IWorld } from '../../world_api';
import { VISUALS, visualKeyFor } from '../characters/manifest';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { type ModelPoint, modelPointWorld, modelScale } from './bastion_creature_fx_core';
import type { DrownedParticle, DrownedParticleSink } from './bastion_drowned_fx';
import { TRASH_FX_SLOTS } from './bastion_trash_fx_core';

export type TrashBody = IWorld['entities'] extends Map<number, infer E> ? E : never;

/** Bodies farther than this from the player shed their ambient glows. */
const AMBIENT_RANGE = 60;

export const SEA = new THREE.Color(0.45, 1.0, 0.85);

/** A particle's look: its size over life, colour, fall and streak. */
export interface ParticleLook {
  size0: number;
  size1: number;
  r: number;
  g: number;
  b: number;
  a: number;
  gravity?: number;
  streak?: boolean;
  stretch?: number;
}

export const LOOK = {
  /** A droplet of brine flung off something. */
  drop: {
    size0: 0.2,
    size1: 0.07,
    r: 0.6,
    g: 0.9,
    b: 0.86,
    a: 0.9,
    gravity: 15,
    streak: true,
    stretch: 0.9,
  },
  /** Sea mist rolling off. */
  mist: { size0: 0.9, size1: 2.6, r: 0.6, g: 0.72, b: 0.7, a: 0.24 },
  /** Fog billowing over a Fog Bank. */
  fog: { size0: 1.4, size1: 3.2, r: 0.62, g: 0.7, b: 0.65, a: 0.22 },
  /** Dust kicked off the flags. */
  dust: { size0: 0.9, size1: 2.4, r: 0.6, g: 0.58, b: 0.52, a: 0.28 },
  /** A soft flash of sea light (sized per call). */
  flash: { size0: 1, size1: 0.2, r: 0.78, g: 1, b: 0.9, a: 0.9 },
  /** A swell of light that grows as it fades (sized per call). */
  bloom: { size0: 1, size1: 1.8, r: 0.5, g: 1, b: 0.84, a: 0.8 },
  /** A mote of sea light drifting up. */
  mote: { size0: 0.34, size1: 0.08, r: 0.42, g: 1, b: 0.72, a: 1, gravity: -0.8 },
  /** A shard of rusted iron. */
  shard: {
    size0: 0.2,
    size1: 0.1,
    r: 0.42,
    g: 0.38,
    b: 0.34,
    a: 1,
    gravity: 18,
    streak: true,
    stretch: 0.6,
  },
  /** A hot spark. */
  spark: {
    size0: 0.16,
    size1: 0.05,
    r: 1,
    g: 0.88,
    b: 0.6,
    a: 1,
    gravity: 10,
    streak: true,
    stretch: 1,
  },
  /** A streak of the howl's shock. */
  shock: { size0: 0.5, size1: 0.9, r: 0.5, g: 1, b: 0.85, a: 0.6, streak: true, stretch: 4 },
  /** A bubble rising through water. */
  bubble: { size0: 0.14, size1: 0.22, r: 0.7, g: 1, b: 0.95, a: 0.7, gravity: -1 },
  /** A wisp of a released spirit. */
  wisp: { size0: 0.5, size1: 0.12, r: 0.78, g: 0.9, b: 1, a: 0.75, gravity: -0.6 },
} as const satisfies Record<string, ParticleLook>;

// ---------------------------------------------------------------- shell program

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
`;
export const TRASH_NOISE_GLSL = NOISE;

const SHELL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

/** The shell modes: the look one program draws (uMode). */
export const SHELL_MODE = { ward: 0, shroud: 1, water: 2, band: 3, soul: 4 } as const;

/** One program for every standing volume and band: the sea-glass ward, the
 *  fog shroud, the water column, a flowing band (the ward link, the poured
 *  stream) and the released soul light. */
const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uMode;
uniform float uSeed;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
${NOISE}
void main() {
  float fres = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2);
  vec3 col = uColor;
  float a = 0.0;
  if (uMode < 0.5) {
    vec2 g = vec2(vUv.x * 22.0, vUv.y * 11.0);
    vec2 f = abs(fract(g + vec2(0.5 * floor(g.y), 0.0)) - 0.5);
    float facet = smoothstep(0.4, 0.5, max(f.x, f.y));
    float sweep = pow(clamp(0.5 + 0.5 * sin(vUv.y * 16.0 - uTime * 3.2 + vUv.x * 6.2831), 0.0, 1.0), 8.0);
    float ends = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
    a = (fres * 0.85 + facet * 0.2 + sweep * 0.3) * ends;
    col = uColor * (0.75 + 0.7 * facet) + vec3(0.55, 0.65, 0.6) * sweep;
  } else if (uMode < 1.5) {
    float n = fbm(vec2(vUv.x * 7.0, vUv.y * 2.5 - uTime * 0.35) + uSeed);
    float ends = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
    a = (0.22 + fres * 0.6) * (0.35 + n) * ends;
    col = uColor * (0.85 + 0.3 * n);
  } else if (uMode < 2.5) {
    float sw = vUv.x * 3.0 + vUv.y * 1.8 - uTime * 1.5 + uSeed;
    float n = fbm(vec2(sw * 2.0, vUv.y * 4.0 - uTime * 2.4));
    float bands = 0.5 + 0.5 * sin(sw * 12.566 + n * 3.0);
    float foam = smoothstep(0.6, 0.92, n + bands * 0.35);
    float ends = smoothstep(0.0, 0.05, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
    col = mix(uColor * (0.8 + 0.6 * bands), vec3(0.9, 1.0, 0.97), foam);
    a = (0.3 + fres * 0.45 + foam * 0.55) * ends;
  } else if (uMode < 3.5) {
    float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
    float core = pow(clamp(across, 0.0, 1.0), 2.6);
    float flow = 0.5 + 0.5 * sin(vUv.x * 26.0 - uTime * 9.0);
    float n = fbm(vec2(vUv.x * 7.0 - uTime * 3.5, vUv.y * 2.0 + uSeed));
    a = core * (0.5 + 0.6 * flow * n);
    col = uColor * (0.85 + 0.6 * core) + vec3(0.5) * flow * core * 0.5;
  } else {
    float n = fbm(vec2(vUv.x * 5.0, vUv.y * 3.0 - uTime * 1.2) + uSeed);
    float ends = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
    a = (0.25 + fres * 0.7) * (0.45 + n) * ends;
    col = uColor * (0.9 + 0.4 * n);
  }
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uAlpha);
}
`;

export interface ShellUniforms {
  uTime: { value: number };
  uAlpha: { value: number };
  uMode: { value: number };
  uSeed: { value: number };
  uColor: { value: THREE.Color };
}

export interface ShellSlot {
  mesh: THREE.Mesh;
  u: ShellUniforms;
  id: number;
  alpha: number;
}

/** A flat unit ring whose vertex colour (the additive alpha) is dark at 0.55
 *  and at 1 and bright at its 0.86 crest. */
export function softRing(segments: number): THREE.BufferGeometry {
  const radii = [0.55, 0.86, 1];
  const shade = [0, 1, 0];
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    for (let k = 0; k < radii.length; k++) {
      pos.push(Math.cos(a) * radii[k], 0, Math.sin(a) * radii[k]);
      col.push(shade[k], shade[k], shade[k]);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let k = 0; k < radii.length - 1; k++) {
      const a = i * radii.length + k;
      const b = (i + 1) * radii.length + k;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

interface RingSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  alive: boolean;
  start: number;
  sec: number;
  r0: number;
  r1: number;
  peak: number;
}

export class TrashFxKit {
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  readonly uTime = { value: 0 };
  /** The painters' shared clock (the creature effects' seconds). */
  now = 0;
  private readonly rings: RingSlot[] = [];
  private readonly p: DrownedParticle = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 1,
    size1: 1,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  };
  private seed = 0x7a5e;

  constructor(
    readonly root: THREE.Object3D,
    readonly groundY: (x: number, z: number) => number,
    readonly world: IWorld | undefined,
    readonly glow: DrownedParticleSink,
    readonly mist: DrownedParticleSink,
    readonly density: number,
    readonly reducedMotion: () => boolean,
  ) {
    const geo = softRing(96);
    this.geometries.push(geo);
    for (let i = 0; i < TRASH_FX_SLOTS.rings; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: SEA,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      // Cosmetic shock rings sit under every telegraph's fill.
      mesh.renderOrder = floorVfxRenderOrder('encounter', 12);
      mesh.visible = false;
      root.add(mesh);
      this.rings.push({ mesh, mat, alive: false, start: 0, sec: 1, r0: 0, r1: 1, peak: 1 });
    }
  }

  /** A small deterministic generator: presentation only, never the sim's rng. */
  rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** A particle budget at the effects density (never below one). */
  count(n: number): number {
    return Math.max(1, Math.round(n * this.density));
  }

  /** An interval stretched on the low effects tier. */
  every(sec: number): number {
    return sec / Math.max(0.4, this.density);
  }

  /** A shell material in the shared program. */
  shellMaterial(
    mode: number,
    color: THREE.Color,
    additive: boolean,
  ): { u: ShellUniforms; mat: THREE.ShaderMaterial } {
    const u: ShellUniforms = {
      uTime: this.uTime,
      uAlpha: { value: 0 },
      uMode: { value: mode },
      uSeed: { value: this.rand() * 10 },
      uColor: { value: color.clone() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u as unknown as Record<string, THREE.IUniform>,
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.materials.push(mat);
    return { u, mat };
  }

  /** A pooled standing volume or band (hidden until used). */
  shellSlot(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mode: number,
    color: THREE.Color,
    additive: boolean,
  ): ShellSlot {
    const { u, mat } = this.shellMaterial(mode, color, additive);
    const mesh = new THREE.Mesh(geo, mat);
    // Standing volumes over the floor marks, with the particles.
    mesh.renderOrder = floorVfxRenderOrder('encounter', 29);
    mesh.frustumCulled = false;
    mesh.visible = false;
    parent.add(mesh);
    return { mesh, u, id: -1, alpha: 0 };
  }

  /** Model units to yards for a body whose GLB stands `rawHeight` tall. */
  scaleOf(e: TrashBody, rawHeight: number): number {
    const def = VISUALS[visualKeyFor(e)];
    const scale = e.scale || MOBS[e.templateId ?? '']?.scale || 1;
    return modelScale(def?.height ?? rawHeight, scale, rawHeight);
  }

  /** The body's drawn height (yards). */
  heightOf(e: TrashBody): number {
    const def = VISUALS[visualKeyFor(e)];
    return (def?.height ?? 2.6) * (e.scale || 1);
  }

  point(
    e: TrashBody,
    k: number,
    p: ModelPoint,
    out: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    return modelPointWorld(e.pos.x, e.pos.y, e.pos.z, e.facing, k, p, out);
  }

  /** Whether a spot is near enough the player for an ambient glow. */
  near(x: number, z: number): boolean {
    const me = this.world?.player;
    if (!me) return true;
    const dx = x - me.pos.x;
    const dz = z - me.pos.z;
    return dx * dx + dz * dz < AMBIENT_RANGE * AMBIENT_RANGE;
  }

  /** Emit one particle of a look (`size` and `alpha` scale it). */
  emit(
    sink: DrownedParticleSink,
    look: ParticleLook,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size = 1,
    alpha = 1,
  ): void {
    const p = this.p;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = life;
    p.size0 = look.size0 * size;
    p.size1 = look.size1 * size;
    p.r = look.r;
    p.g = look.g;
    p.b = look.b;
    p.a = look.a * alpha;
    p.gravity = look.gravity ?? 0;
    p.streak = look.streak ?? false;
    p.stretch = look.stretch ?? 0;
    sink.emit(this.now, p);
  }

  /** Brine thrown up and out from a point: droplets and a puff of sea mist.
   *  Reduced motion keeps a few drops and the mist. */
  splash(x: number, y: number, z: number, n: number, speed: number, mist: number): void {
    const drops = this.reducedMotion() ? Math.min(4, n) : this.count(n);
    for (let i = 0; i < drops; i++) {
      const a = this.rand() * Math.PI * 2;
      const sp = speed * (0.5 + this.rand()) * 0.7;
      const vy = (0.6 + this.rand()) * sp;
      const life = 0.5 + this.rand() * 0.4;
      const ox = Math.cos(a);
      const oz = Math.sin(a);
      this.emit(this.glow, LOOK.drop, x + ox * 0.3, y, z + oz * 0.3, ox * sp, vy, oz * sp, life);
    }
    const puffs = this.count(mist);
    for (let i = 0; i < puffs; i++) {
      const a = this.rand() * Math.PI * 2;
      const ox = Math.cos(a);
      const oz = Math.sin(a);
      const life = 1.1 + this.rand() * 0.6;
      const vy = 0.4 + this.rand() * 0.5;
      this.emit(this.mist, LOOK.mist, x + ox * 0.4, y, z + oz * 0.4, ox * 1.4, vy, oz * 1.4, life);
    }
  }

  /** A shock ring running out over the floor from r0 to r1 yards. */
  ring(
    x: number,
    z: number,
    color: THREE.Color | number,
    r0: number,
    r1: number,
    sec: number,
    peak: number,
  ): void {
    // Cosmetic: a full pool drops the newcomer, never cuts a ring short.
    const slot = this.rings.find((r) => !r.alive);
    if (!slot) return;
    slot.alive = true;
    slot.start = this.now;
    slot.sec = sec;
    slot.r0 = r0;
    slot.r1 = r1;
    slot.peak = peak;
    slot.mat.color.set(color);
    slot.mesh.position.set(x, this.groundY(x, z) + 0.07, z);
    slot.mesh.scale.set(r0, 1, r0);
    slot.mesh.visible = true;
  }

  updateRings(): void {
    for (const r of this.rings) {
      if (!r.alive) continue;
      const k = (this.now - r.start) / r.sec;
      if (k >= 1) {
        r.alive = false;
        r.mesh.visible = false;
        continue;
      }
      const ease = 1 - (1 - k) ** 2.4;
      const rad = r.r0 + (r.r1 - r.r0) * ease;
      r.mesh.scale.set(rad, 1, rad);
      r.mat.opacity = r.peak * (1 - k) * Math.min(1, k * 8);
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
