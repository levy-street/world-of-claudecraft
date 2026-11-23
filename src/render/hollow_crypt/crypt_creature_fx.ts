// The Hollow Crypt's hero creature effects (plan: crypt_creature_fx_core.ts),
// at the Ignivar raid's bar: the flame atlas every sprite fire in the game
// samples, graded here into GHOSTLY FIRE (white-hot at the jaws, pale
// green-white tongues, grave-green at the tips, sooty green-black smoke): real
// flame shapes, upright and licking upward (never spun like shards), a heat
// shimmer over the burning ground (Ignivar's wobble haze) and rising embers,
// GPU-advected particles, and draped floor shaders.
//
//  The Ossuary Drake
//  - Barrowflame Breath: over its 2 s bar the fire gathers in its jaws (a hot
//    core swelling at the mouth, soul wisps drawn up into it); when the bar
//    lands, a torrent pours from the jaws down onto the floor and rolls out
//    over the WHOLE cone the sim tests (ground fire from the apex to the rim),
//    with a heat shimmer over it and embers lifting off it; it leaves the cone
//    scorched, smouldering grave-green for a few seconds.
//  - Tail sweep: a dust wake whipped across the rear cone.
//  - Wing buffet: a ring of dust and a pale shockwave racing out to its reach.
//  - Landing: a dust blast where it touches down.
//
//  The Chapel Gargoyle
//  - Awaken: stone dust and chips burst off the statue as it cracks free.
//  - Dive: the slam where it lands throws a shockwave ring, a burst of dust and
//    debris, and leaves radial cracks in the floor.
//  - Stone Shriek: violet sonic rings pour off it over the bar; the landing
//    throws a violet shockwave out to the stun's reach.
//
// Rules (src/render/CLAUDE.md): one root, attached through the compile gate
// with every material present; every geometry and material built once and
// pooled; particles are three draws (fire, glow, dust) simulated on the GPU
// from per-particle launch data, so the CPU only writes a particle when it is
// born. The telegraphs that decide outcomes live in crypt_trash_fx.ts on every
// tier; these are cosmetic, their particle budgets shed on the low effects
// tier, and nothing here is needed to read a mechanic.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  CRYPT_BARROWFLAME_BREATH,
  CRYPT_PERCH_DIVE,
  CRYPT_SKY_LANDING,
  CRYPT_STONE_SHRIEK,
  CRYPT_TAIL_LASH,
  CRYPT_WING_GUST,
} from '../../sim/mob/trash_kit/cast_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import {
  anchorWorld,
  coneSpot,
  DRAKE_JAWS_EXHALE,
  DRAKE_JAWS_INHALE,
  drakeBreathCone,
  drakeStrikeShapes,
  GARGOYLE_HEAD_SCREECH,
  gargoyleShriekRadius,
  scorchPhase,
  shockwave,
  tailSweepAngle,
  torrentEnvelope,
  torrentSeconds,
  touchedDown,
} from './crypt_creature_fx_core';
import {
  DUST_FRAG,
  FIRE_FRAG,
  FIRE_VERT,
  GHOST_RAMP,
  GLOW_FRAG,
  HAZE_FRAG,
  PARTICLE_VERT,
  ParticlePool,
} from './crypt_fx_particles';

const DRAKE = 'crypt_ossuary_drake';
/** The Knellwyrm (encounters/hollow_crypt) breathes, lashes and lands as the
 *  drake does: its kin shares every drake effect, anchors scaled by its size. */
const KNELLWYRM = 'crypt_knellwyrm';
function drakeKin(templateId: string): boolean {
  return templateId === DRAKE || templateId === KNELLWYRM;
}
const GARGOYLE = 'crypt_chapel_gargoyle';

// ------------------------------------------------------------------ floors

const FLOOR_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec2 aPolar; // normalized radius, angle fraction
varying vec2 vPolar;
varying vec3 vWorld;
void main() {
  vPolar = aPolar;
  vec4 w = modelMatrix * vec4(position, 1.0);
  // Noise coordinates: the patch's own local frame (instance bands sit ~1e5
  // yards out, far past where a float hash stays smooth).
  vWorld = position;
  gl_Position = projectionMatrix * wocCamRelView(w.xyz);
}
`;

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1 + 7.3) * 0.3 + vnoise(p * 4.3 - 3.1) * 0.15; }
`;

/** The scorched cone: charred ash with ghost-fire embers glowing through the cracks. */
const SCORCH_FRAG = /* glsl */ `
uniform float uTime;
uniform float uChar;
uniform float uEmbers;
uniform float uBurn;
varying vec2 vPolar;
varying vec3 vWorld;
${NOISE}
${GHOST_RAMP}
void main() {
  float edge = (1.0 - smoothstep(0.82, 1.0, vPolar.x)) * smoothstep(0.0, 0.06, vPolar.y) * (1.0 - smoothstep(0.94, 1.0, vPolar.y));
  float n = fbm(vWorld.xz * 0.55);
  float cracks = 1.0 - smoothstep(0.02, 0.09, abs(fbm(vWorld.xz * 1.3 + 4.0) - 0.5));
  float ash = uChar * edge * (0.55 + 0.45 * n);
  float flick = 0.7 + 0.3 * sin(uTime * 3.0 + n * 20.0);
  float glow = uEmbers * edge * cracks * flick;
  // While the torrent pours, the whole footprint burns brighter.
  float burn = uBurn * edge * (0.35 + 0.65 * n);
  vec3 col = mix(vec3(0.02, 0.025, 0.03), ghostRamp(0.55 + 0.35 * glow) * 1.6, clamp(glow + burn, 0.0, 1.0));
  float a = clamp(ash * 0.78 + glow * 0.9 + burn * 0.6, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

/** Radial cracks where a gargoyle slammed down, and the dust stain. */
const CRACKS_FRAG = /* glsl */ `
uniform float uFade;
varying vec2 vPolar;
varying vec3 vWorld;
${NOISE}
void main() {
  float a = vPolar.y * 6.2831;
  float spokes = pow(abs(sin(a * 4.5 + fbm(vec2(vPolar.x * 3.0, a)) * 2.4)), 18.0);
  float ring = 1.0 - smoothstep(0.0, 0.08, abs(vPolar.x - 0.45 - 0.08 * fbm(vec2(a * 2.0, 1.0))));
  float crack = max(spokes * (1.0 - smoothstep(0.2, 1.0, vPolar.x)), ring * 0.7) * smoothstep(0.05, 0.18, vPolar.x);
  float stain = (1.0 - smoothstep(0.2, 1.0, vPolar.x)) * 0.35 * (0.6 + 0.4 * fbm(vWorld.xz * 0.8));
  float alpha = clamp(crack * 0.9 + stain, 0.0, 1.0) * uFade;
  gl_FragColor = vec4(mix(vec3(0.34, 0.32, 0.3), vec3(0.03, 0.03, 0.035), crack), alpha);
}
`;

/** A ground shockwave band: a bright leading edge with a soft wake. */
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vPolar;
varying vec3 vWorld;
${NOISE}
void main() {
  float lead = smoothstep(0.78, 0.97, vPolar.x) * (1.0 - smoothstep(0.97, 1.0, vPolar.x));
  float wake = smoothstep(0.35, 0.95, vPolar.x) * 0.35;
  float n = 0.75 + 0.25 * vnoise(vWorld.xz * 1.7);
  gl_FragColor = vec4(uColor * (1.2 + lead), (lead + wake) * n * uAlpha);
}
`;

/** A soft billboard glow (the jaws' gathering fire, the shriek's sonic rings). */
const HALO_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 c = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(modelMatrix[0].xyz);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c.xyz + (camRight * position.x + camUp * position.y) * s;
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;
const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uRing;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float core = pow(max(1.0 - r, 0.0), 2.4);
  float ring = (1.0 - smoothstep(0.0, 0.1, abs(r - 0.85))) * uRing;
  float a = mix(core, ring, step(0.5, uRing)) * uAlpha;
  gl_FragColor = vec4(uColor * (1.0 + core), a);
}
`;

/** A polar-grid floor patch (disc or cone) whose vertices get draped on the floor. */
function polarGeometry(rings: number, segments: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = (rings + 1) * (segments + 1);
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage),
  );
  const polar = new Float32Array(n * 2);
  const index: number[] = [];
  for (let r = 0; r <= rings; r++) {
    for (let s = 0; s <= segments; s++) {
      const i = r * (segments + 1) + s;
      polar[i * 2] = r / rings;
      polar[i * 2 + 1] = s / segments;
      if (r < rings && s < segments) {
        const a = i;
        const b = i + 1;
        const c = i + segments + 1;
        const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
  }
  g.setAttribute('aPolar', new THREE.BufferAttribute(polar, 2));
  g.setIndex(index);
  return g;
}

interface FloorPatch {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  alive: boolean;
  /** Seconds this patch lives. */
  span: number;
  /** Extra per-kind state (a ring's reach, a scorch's source). */
  reach: number;
  ox: number;
  oz: number;
  yaw: number;
  arc: number;
}

// ------------------------------------------------------------------ the fx

interface Torrent {
  sourceId: number;
  born: number;
  x: number;
  z: number;
  floor: number;
  facing: number;
  scale: number;
  emitted: number;
  scorch: FloorPatch | null;
}

interface Watch {
  wasUp: number;
  diving: boolean;
}

const MAX_TORRENTS = 2;

export class CryptCreatureFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly fire: ParticlePool;
  private readonly glow: ParticlePool;
  private readonly dust: ParticlePool;
  private readonly haze: ParticlePool;
  private readonly scorches: FloorPatch[] = [];
  private readonly cracks: FloorPatch[] = [];
  private readonly rings: FloorPatch[] = [];
  private readonly halos: {
    mesh: THREE.Mesh;
    mat: THREE.ShaderMaterial;
    owner: number;
    /** A sonic ring's phase offset and strength; animated every frame. */
    ring: { phase: number; strength: number } | null;
  }[] = [];
  private readonly torrents: Torrent[] = [];
  private readonly watch = new Map<number, Watch>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly breath = drakeBreathCone();
  private readonly strikes = drakeStrikeShapes();
  private readonly shriek = gargoyleShriekRadius();
  private clock = 0;
  private scan = 0;
  private seed = 0x5eed;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shake?: (amount: number) => void,
  ) {
    this.root.name = 'crypt-creature-fx';
    setRenderCategory(this.root, 'ui3d');
    const low =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';
    this.density = low ? 0.45 : 1;
    const flameTex = typeof document !== 'undefined' ? getFlameTex() : null;
    const particleMat = (frag: string, vert: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime, uTex: { value: flameTex } },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      return m;
    };
    this.fire = new ParticlePool(
      Math.round(900 * this.density),
      particleMat(FIRE_FRAG, FIRE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 26),
    );
    this.glow = new ParticlePool(
      Math.round(700 * this.density),
      particleMat(GLOW_FRAG, PARTICLE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 27),
    );
    this.dust = new ParticlePool(
      Math.round(700 * this.density),
      particleMat(DUST_FRAG, PARTICLE_VERT, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 25),
    );
    this.haze = new ParticlePool(
      Math.round(260 * this.density),
      particleMat(HAZE_FRAG, PARTICLE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 28),
    );
    for (const p of [this.dust, this.fire, this.glow, this.haze]) {
      this.geometries.push(p.mesh.geometry);
      this.root.add(p.mesh);
    }
    const floorMat = (frag: string, uniforms: Record<string, THREE.IUniform>, additive = false) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime, ...uniforms },
        vertexShader: FLOOR_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.materials.push(m);
      return m;
    };
    const patch = (
      rings: number,
      segments: number,
      mat: THREE.ShaderMaterial,
      order: number,
    ): FloorPatch => {
      const geo = polarGeometry(rings, segments);
      this.geometries.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = order;
      this.root.add(mesh);
      return { mesh, mat, born: 0, alive: false, span: 0, reach: 0, ox: 0, oz: 0, yaw: 0, arc: 0 };
    };
    for (let i = 0; i < MAX_TORRENTS; i++) {
      this.scorches.push(
        patch(
          14,
          40,
          floorMat(SCORCH_FRAG, {
            uChar: { value: 0 },
            uEmbers: { value: 0 },
            uBurn: { value: 0 },
          }),
          floorVfxRenderOrder('encounter', 2),
        ),
      );
    }
    for (let i = 0; i < 4; i++) {
      this.cracks.push(
        patch(
          8,
          48,
          floorMat(CRACKS_FRAG, { uFade: { value: 0 } }),
          floorVfxRenderOrder('encounter', 3),
        ),
      );
    }
    for (let i = 0; i < 6; i++) {
      this.rings.push(
        patch(
          6,
          64,
          floorMat(RING_FRAG, { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } }, true),
          floorVfxRenderOrder('encounter', 24),
        ),
      );
    }
    const haloGeo = new THREE.PlaneGeometry(2, 2);
    this.geometries.push(haloGeo);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 0 },
          uRing: { value: 0 },
        },
        vertexShader: HALO_VERT,
        fragmentShader: HALO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(haloGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 28);
      this.root.add(mesh);
      this.halos.push({ mesh, mat, owner: -1, ring: null });
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  // ----------------------------------------------------------------- events

  handleEvent(ev: SimEvent): void {
    if (ev.type !== 'spellfx' || !this.world || this.disposed) return;
    const source = this.world.entities.get(ev.sourceId);
    if (!source) return;
    if (ev.fx === 'fireCone' && drakeKin(source.templateId)) this.startTorrent(source);
    else if (ev.fx === 'nova' && ev.ability === CRYPT_TAIL_LASH) this.tailSweep(source);
    else if (ev.fx === 'nova' && ev.ability === CRYPT_WING_GUST) this.wingBuffet(source);
    else if (ev.fx === 'nova' && ev.ability === CRYPT_STONE_SHRIEK) this.shriekBlast(source);
    else if (ev.fx === 'windup' && ev.ability === CRYPT_PERCH_DIVE) this.awaken(source);
    else if (ev.fx === 'windup' && ev.ability === CRYPT_SKY_LANDING) this.skyCry(source);
  }

  private startTorrent(e: Entity): void {
    if (this.torrents.length >= MAX_TORRENTS) this.torrents.shift();
    const floor = this.groundY(e.pos.x, e.pos.z);
    const scorch = this.scorches.find((s) => !s.alive) ?? null;
    const t: Torrent = {
      sourceId: e.id,
      born: this.clock,
      x: e.pos.x,
      z: e.pos.z,
      floor,
      facing: e.facing,
      scale: e.scale || 1,
      emitted: 0,
      scorch,
    };
    if (scorch)
      this.layCone(scorch, e.pos.x, e.pos.z, e.facing, this.breath.range, this.breath.arcDeg);
    this.torrents.push(t);
    // The ground fire over the whole footprint, lit as the torrent reaches it.
    const n = Math.round(150 * this.density);
    for (let i = 0; i < n; i++) {
      const spot = coneSpot(i, n, this.breath.range, this.breath.arcDeg, 1.2);
      const c = Math.cos(e.facing);
      const s = Math.sin(e.facing);
      const wx = e.pos.x + spot.x * c + spot.z * s;
      const wz = e.pos.z - spot.x * s + spot.z * c;
      const gy = this.groundY(wx, wz);
      const delay = 0.14 + (spot.r / this.breath.range) * 0.35;
      const reps = 3;
      for (let k = 0; k < reps; k++) {
        this.fire.emit(this.clock + delay + k * 0.42 + this.rand() * 0.2, {
          x: wx + (this.rand() - 0.5) * 0.8,
          y: gy + 0.1,
          z: wz + (this.rand() - 0.5) * 0.8,
          vx: 0,
          vy: 1.6 + this.rand() * 1.6,
          vz: 0,
          ay: 1.5,
          life: 0.7 + this.rand() * 0.5,
          drag: 0.8,
          size0: 0.8 + this.rand() * 0.8,
          size1: 1.8 + this.rand() * 2.6,
          spin: 0,
          r: 0.85 + this.rand() * 0.3,
          g: 0,
          b: 0,
          a: 0.85,
        });
      }
      // The air over the burning ground swims, and embers lift off it.
      if (i % 3 === 0) {
        this.haze.emit(this.clock + delay + this.rand() * 0.6, {
          x: wx,
          y: gy + 1.2,
          z: wz,
          vx: 0,
          vy: 1.4 + this.rand(),
          vz: 0,
          life: 1.4 + this.rand() * 0.8,
          drag: 0.5,
          size0: 2.4,
          size1: 4.6 + this.rand() * 1.5,
          r: 0.3,
          g: 0.42,
          b: 0.22,
          a: 0.32,
        });
      }
      if (i % 2 === 0) {
        this.glow.emit(this.clock + delay + this.rand() * 1.2, {
          x: wx + (this.rand() - 0.5) * 1.5,
          y: gy + 0.3,
          z: wz + (this.rand() - 0.5) * 1.5,
          vx: (this.rand() - 0.5) * 1.6,
          vy: 3 + this.rand() * 3.5,
          vz: (this.rand() - 0.5) * 1.6,
          ay: 0.8,
          life: 1.1 + this.rand() * 1.1,
          drag: 0.7,
          size0: 0.16,
          size1: 0.05,
          r: 0.78 + this.rand() * 0.2,
          g: 1,
          b: 0.42,
          a: 1,
        });
      }
    }
  }

  private tailSweep(e: Entity): void {
    const { range, arcDeg } = this.strikes.tail;
    const n = Math.round(46 * this.density);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const delay = k * 0.32;
      const ang = tailSweepAngle(delay, arcDeg) + e.facing + Math.PI;
      const r = range * (0.55 + this.rand() * 0.5);
      const x = e.pos.x + Math.sin(ang) * r;
      const z = e.pos.z + Math.cos(ang) * r;
      const gy = this.groundY(x, z);
      const tang = ang + Math.PI / 2;
      this.dust.emit(this.clock + delay, {
        x,
        y: gy + 0.3,
        z,
        vx: Math.sin(tang) * 6 + Math.sin(ang) * 3,
        vy: 1.5 + this.rand() * 2,
        vz: Math.cos(tang) * 6 + Math.cos(ang) * 3,
        ay: -0.6,
        life: 1.2 + this.rand() * 0.6,
        drag: 2.2,
        floor: gy + 0.2,
        size0: 1.2,
        size1: 3.4 + this.rand() * 1.5,
        spin: (this.rand() - 0.5) * 0.8,
        r: 0.52,
        g: 0.5,
        b: 0.47,
        a: 0.55,
      });
    }
    this.shakeFor(e, 0.35);
  }

  private wingBuffet(e: Entity): void {
    const reach = this.strikes.gust.radius;
    const gy = this.groundY(e.pos.x, e.pos.z);
    this.ring(e.pos.x, e.pos.z, reach * 1.05, 0.55, 0xd9e6ee);
    this.ring(e.pos.x, e.pos.z, reach * 0.7, 0.4, 0xffffff);
    const n = Math.round(90 * this.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand() * 0.1;
      const r0 = 2 + this.rand() * 1.5;
      const x = e.pos.x + Math.sin(a) * r0;
      const z = e.pos.z + Math.cos(a) * r0;
      const speed = 14 + this.rand() * 6;
      this.dust.emit(this.clock + this.rand() * 0.06, {
        x,
        y: gy + 0.3 + this.rand() * 0.8,
        z,
        vx: Math.sin(a) * speed,
        vy: 0.6 + this.rand() * 1.4,
        vz: Math.cos(a) * speed,
        life: 1.1 + this.rand() * 0.5,
        drag: 2.1,
        floor: gy + 0.2,
        size0: 1.4,
        size1: 4.2 + this.rand() * 1.8,
        spin: (this.rand() - 0.5) * 0.8,
        r: 0.5,
        g: 0.5,
        b: 0.5,
        a: 0.5,
      });
    }
    this.shakeFor(e, 0.5);
  }

  private shriekBlast(e: Entity): void {
    this.ring(e.pos.x, e.pos.z, this.shriek, 0.5, 0xb77bff);
    this.ring(e.pos.x, e.pos.z, this.shriek * 0.75, 0.38, 0xe7d2ff);
    const head = anchorWorld(
      GARGOYLE_HEAD_SCREECH,
      e.pos.x,
      this.groundY(e.pos.x, e.pos.z),
      e.pos.z,
      e.facing,
      e.scale || 1,
    );
    const n = Math.round(70 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const up = (this.rand() - 0.3) * 0.8;
      const speed = 12 + this.rand() * 6;
      this.glow.emit(this.clock, {
        x: head.x,
        y: head.y,
        z: head.z,
        vx: Math.sin(a) * speed,
        vy: up * speed * 0.4,
        vz: Math.cos(a) * speed,
        life: 0.6 + this.rand() * 0.3,
        drag: 3,
        size0: 0.5,
        size1: 1.4,
        r: 0.72,
        g: 0.46,
        b: 1,
        a: 0.7,
      });
    }
    this.shakeFor(e, 0.3);
  }

  private awaken(e: Entity): void {
    // Stone dust shed off the statue and chips of it falling.
    const n = Math.round(40 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * 1.6;
      this.dust.emit(this.clock + this.rand() * 0.25, {
        x: e.pos.x + Math.sin(a) * r,
        y: e.pos.y + 0.5 + this.rand() * 3.5,
        z: e.pos.z + Math.cos(a) * r,
        vx: Math.sin(a) * 1.5,
        vy: -0.5 - this.rand(),
        vz: Math.cos(a) * 1.5,
        ay: -1.2,
        life: 1.6 + this.rand() * 0.8,
        drag: 1.5,
        size0: 0.8,
        size1: 2.4 + this.rand(),
        spin: (this.rand() - 0.5) * 0.5,
        r: 0.72,
        g: 0.71,
        b: 0.68,
        a: 0.5,
      });
    }
    const chips = Math.round(30 * this.density);
    for (let i = 0; i < chips; i++) {
      const a = this.rand() * Math.PI * 2;
      this.dust.emit(this.clock + this.rand() * 0.3, {
        x: e.pos.x + Math.sin(a) * 0.8,
        y: e.pos.y + 1 + this.rand() * 3,
        z: e.pos.z + Math.cos(a) * 0.8,
        vx: Math.sin(a) * (1 + this.rand() * 2),
        vy: 1 + this.rand() * 2,
        vz: Math.cos(a) * (1 + this.rand() * 2),
        ay: -18,
        life: 1.4,
        floor: this.groundY(e.pos.x, e.pos.z) + 0.05,
        size0: 0.16 + this.rand() * 0.12,
        size1: 0.16,
        spin: (this.rand() - 0.5) * 8,
        r: 0.3,
        g: 0.3,
        b: 0.32,
        a: 1,
      });
    }
    this.watchFor(e, true);
  }

  private skyCry(e: Entity): void {
    this.watchFor(e, true);
  }

  // ------------------------------------------------------------ landings

  private watchFor(e: Entity, diving: boolean): void {
    const floor = this.groundY(e.pos.x, e.pos.z);
    this.watch.set(e.id, { wasUp: e.pos.y - floor, diving });
  }

  private landed(e: Entity): void {
    const gy = this.groundY(e.pos.x, e.pos.z);
    const drake = drakeKin(e.templateId);
    const reach = drake ? 9 : 5.5;
    this.ring(e.pos.x, e.pos.z, reach, 0.5, drake ? 0xcfd8dc : 0xeeeae2);
    if (!drake) {
      const crack = this.cracks.find((c) => !c.alive) ?? this.cracks[0];
      this.layDisc(crack, e.pos.x, e.pos.z, 3.6);
      crack.born = this.clock;
      crack.span = 5;
      crack.alive = true;
      crack.mesh.visible = true;
    }
    const n = Math.round((drake ? 80 : 55) * this.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand() * 0.2;
      const speed = (drake ? 11 : 8) + this.rand() * 5;
      this.dust.emit(this.clock + this.rand() * 0.05, {
        x: e.pos.x + Math.sin(a) * 1.2,
        y: gy + 0.3,
        z: e.pos.z + Math.cos(a) * 1.2,
        vx: Math.sin(a) * speed,
        vy: 0.8 + this.rand() * 2.2,
        vz: Math.cos(a) * speed,
        life: 1.3 + this.rand() * 0.6,
        drag: 2.3,
        floor: gy + 0.2,
        size0: 1.2,
        size1: (drake ? 5 : 3.4) + this.rand() * 1.5,
        spin: (this.rand() - 0.5) * 0.7,
        r: 0.55,
        g: 0.54,
        b: 0.52,
        a: 0.55,
      });
    }
    if (!drake) {
      for (let i = 0; i < Math.round(26 * this.density); i++) {
        const a = this.rand() * Math.PI * 2;
        const sp = 3 + this.rand() * 4;
        this.dust.emit(this.clock, {
          x: e.pos.x,
          y: gy + 0.4,
          z: e.pos.z,
          vx: Math.sin(a) * sp,
          vy: 4 + this.rand() * 5,
          vz: Math.cos(a) * sp,
          ay: -20,
          life: 1.1,
          floor: gy + 0.05,
          size0: 0.2 + this.rand() * 0.15,
          size1: 0.2,
          spin: (this.rand() - 0.5) * 9,
          r: 0.28,
          g: 0.28,
          b: 0.3,
          a: 1,
        });
      }
    }
    this.shakeFor(e, drake ? 0.6 : 0.45);
  }

  // --------------------------------------------------------------- helpers

  private shakeFor(e: Entity, amount: number): void {
    this.shakeAt(e.pos.x, e.pos.z, amount);
  }

  private shakeAt(x: number, z: number, amount: number): void {
    if (!this.shake || this.reducedMotion() || !this.world) return;
    const me = this.world.player;
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < 30) this.shake(amount * (1 - d / 30));
  }

  private ring(x: number, z: number, reach: number, seconds: number, color: number): void {
    const r = this.rings.find((p) => !p.alive) ?? this.rings[0];
    r.alive = true;
    r.born = this.clock;
    r.span = seconds;
    r.reach = reach;
    r.ox = x;
    r.oz = z;
    (r.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    // Draped once at its full reach; the frame loop only scales it out (the
    // crypt's terraces are flat, so the drape holds at every radius).
    this.layDisc(r, x, z, reach);
    r.mesh.scale.set(0.01, 1, 0.01);
    r.mesh.visible = true;
  }

  /** Lay a patch as a cone (apex at x, z, opening along `facing`) draped on the floor. */
  private layCone(
    p: FloorPatch,
    x: number,
    z: number,
    facing: number,
    range: number,
    arcDeg: number,
  ): void {
    const pos = p.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const polar = p.mesh.geometry.getAttribute('aPolar') as THREE.BufferAttribute;
    const half = (arcDeg * Math.PI) / 360;
    const y0 = this.groundY(x, z);
    for (let i = 0; i < pos.count; i++) {
      const rr = polar.getX(i) * range;
      const a = facing - half + 2 * half * polar.getY(i);
      const wx = x + Math.sin(a) * rr;
      const wz = z + Math.cos(a) * rr;
      pos.setXYZ(i, wx - x, this.groundY(wx, wz) - y0 + 0.06, wz - z);
    }
    pos.needsUpdate = true;
    p.mesh.position.set(x, y0, z);
    p.born = this.clock;
    p.alive = true;
    p.mesh.visible = true;
  }

  /** Lay a patch as a disc of `radius` around x, z, draped on the floor. */
  private layDisc(p: FloorPatch, x: number, z: number, radius: number): void {
    const pos = p.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const polar = p.mesh.geometry.getAttribute('aPolar') as THREE.BufferAttribute;
    const y0 = this.groundY(x, z);
    for (let i = 0; i < pos.count; i++) {
      const rr = polar.getX(i) * radius;
      const a = polar.getY(i) * Math.PI * 2;
      const wx = x + Math.sin(a) * rr;
      const wz = z + Math.cos(a) * rr;
      pos.setXYZ(i, wx - x, this.groundY(wx, wz) - y0 + 0.05, wz - z);
    }
    pos.needsUpdate = true;
    p.mesh.position.set(x, y0, z);
  }

  private halo(owner: number): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } | null {
    return (
      this.halos.find((h) => h.owner === owner) ?? this.halos.find((h) => h.owner === -1) ?? null
    );
  }

  // ----------------------------------------------------------------- frame

  update(dt: number): void {
    if (this.disposed || !this.world) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scan -= dt;
    const world = this.world;
    if (this.scan <= 0) {
      this.scan = 0.05;
      this.scanCreatures(world);
    }
    this.stepTorrents(world, dt);
    for (const s of this.scorches) {
      if (!s.alive) continue;
      const t = this.clock - s.born;
      const ph = scorchPhase(t);
      const burn = torrentEnvelope(t - 0.1);
      s.mat.uniforms.uChar.value = ph.char;
      s.mat.uniforms.uEmbers.value = ph.embers;
      s.mat.uniforms.uBurn.value = burn;
      if (ph.char <= 0 && t > torrentSeconds()) {
        s.alive = false;
        s.mesh.visible = false;
      }
    }
    for (const c of this.cracks) {
      if (!c.alive) continue;
      const t = this.clock - c.born;
      const fade = t < 0.08 ? t / 0.08 : Math.max(0, 1 - (t - c.span * 0.5) / (c.span * 0.5));
      c.mat.uniforms.uFade.value = fade;
      if (t > c.span) {
        c.alive = false;
        c.mesh.visible = false;
      }
    }
    for (const r of this.rings) {
      if (!r.alive) continue;
      const w = shockwave(this.clock - r.born, r.reach, r.span);
      if (w.done) {
        r.alive = false;
        r.mesh.visible = false;
        continue;
      }
      const k = w.radius / Math.max(r.reach, 1e-3);
      r.mesh.scale.set(k, 1, k);
      r.mat.uniforms.uAlpha.value = w.alpha;
    }
    for (const h of this.halos) {
      if (!h.ring || h.owner < 0) continue;
      const k = (this.clock * 1.8 + h.ring.phase) % 1;
      h.mesh.scale.setScalar(0.8 + 6.5 * k);
      h.mat.uniforms.uAlpha.value = (1 - k) ** 1.5 * h.ring.strength;
    }
    this.fire.update(this.clock);
    this.glow.update(this.clock);
    this.dust.update(this.clock);
    this.haze.update(this.clock);
  }

  /** The inhale, the shriek's sonic rings, and the touchdowns, read off entity state. */
  private scanCreatures(world: IWorld): void {
    const seen = new Set<number>();
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      if (!drakeKin(e.templateId) && e.templateId !== GARGOYLE) continue;
      const floor = this.groundY(e.pos.x, e.pos.z);
      const up = e.pos.y - floor;
      const w = this.watch.get(e.id);
      if (w) {
        if (touchedDown(w.wasUp, up)) {
          this.landed(e);
          this.watch.delete(e.id);
        } else {
          w.wasUp = Math.max(up, w.diving ? w.wasUp : up);
        }
      }
      if (drakeKin(e.templateId) && e.castingAbility === CRYPT_BARROWFLAME_BREATH) {
        seen.add(e.id);
        this.inhale(e, floor);
      } else if (e.templateId === GARGOYLE && e.castingAbility === CRYPT_STONE_SHRIEK) {
        seen.add(e.id);
        this.sonic(e, floor);
      }
    }
    // Forget touchdown watches whose creature died, despawned or left view.
    for (const [id] of this.watch) {
      const e = world.entities.get(id);
      if (!e || e.dead) this.watch.delete(id);
    }
    for (const h of this.halos) {
      const who = h.owner >= 10_000_000 ? h.owner % 10_000_000 : h.owner;
      if (h.owner >= 0 && !seen.has(who)) {
        h.owner = -1;
        h.ring = null;
        h.mesh.visible = false;
      }
    }
  }

  private inhale(e: Entity, floor: number): void {
    const fill = e.castTotal > 0 ? 1 - e.castRemaining / e.castTotal : 1;
    const jaws = anchorWorld(DRAKE_JAWS_INHALE, e.pos.x, floor, e.pos.z, e.facing, e.scale || 1);
    const h = this.halo(e.id);
    if (h) {
      const slot = this.halos.find((x) => x.mesh === h.mesh);
      if (slot) {
        slot.owner = e.id;
        slot.ring = null;
      }
      h.mesh.position.set(jaws.x, jaws.y, jaws.z);
      h.mesh.scale.setScalar(0.8 + 2.4 * fill);
      (h.mat.uniforms.uColor.value as THREE.Color).setRGB(0.62, 1, 0.38);
      h.mat.uniforms.uAlpha.value = 0.35 + 0.65 * fill;
      h.mat.uniforms.uRing.value = 0;
      h.mesh.visible = true;
    }
    // Soul wisps drawn up into the jaws from all round.
    const n = Math.round(6 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = 5 + this.rand() * 4;
      const sx = jaws.x + Math.sin(a) * r;
      const sz = jaws.z + Math.cos(a) * r;
      const sy = jaws.y - 3 + this.rand() * 5;
      const life = 0.55 + this.rand() * 0.2;
      this.glow.emit(this.clock, {
        x: sx,
        y: sy,
        z: sz,
        vx: ((jaws.x - sx) / life) * 1.1,
        vy: ((jaws.y - sy) / life) * 1.1,
        vz: ((jaws.z - sz) / life) * 1.1,
        life,
        drag: 0.4,
        size0: 0.35,
        size1: 0.1,
        r: 0.6,
        g: 1,
        b: 0.42,
        a: 0.8,
      });
    }
  }

  private sonic(e: Entity, floor: number): void {
    const head = anchorWorld(
      GARGOYLE_HEAD_SCREECH,
      e.pos.x,
      floor,
      e.pos.z,
      e.facing,
      e.scale || 1,
    );
    const fill = e.castTotal > 0 ? 1 - e.castRemaining / e.castTotal : 1;
    // Three sonic rings pouring off the head, staggered a third of a beat apart.
    for (let k = 0; k < 3; k++) {
      const owner = e.id + (k + 1) * 10_000_000;
      const slot =
        this.halos.find((x) => x.owner === owner) ?? this.halos.find((x) => x.owner === -1);
      if (!slot) break;
      slot.owner = owner;
      slot.ring = { phase: k / 3, strength: 0.55 + 0.45 * fill };
      slot.mesh.position.set(head.x, head.y, head.z);
      (slot.mat.uniforms.uColor.value as THREE.Color).setRGB(0.78, 0.52, 1);
      slot.mat.uniforms.uRing.value = 1;
      slot.mesh.visible = true;
    }
    if (this.rand() < 0.6) {
      const a = this.rand() * Math.PI * 2;
      this.glow.emit(this.clock, {
        x: head.x,
        y: head.y,
        z: head.z,
        vx: Math.sin(a) * 6,
        vy: (this.rand() - 0.5) * 3,
        vz: Math.cos(a) * 6,
        life: 0.5,
        drag: 2,
        size0: 0.3,
        size1: 1.2,
        r: 0.7,
        g: 0.45,
        b: 1,
        a: 0.6,
      });
    }
  }

  /** Pour the torrent: jet sprites from the jaws, down and out over the cone. */
  private stepTorrents(world: IWorld, dt: number): void {
    for (let i = this.torrents.length - 1; i >= 0; i--) {
      const t = this.torrents[i];
      const age = this.clock - t.born;
      const env = torrentEnvelope(age);
      if (age > torrentSeconds()) {
        this.torrents.splice(i, 1);
        continue;
      }
      const src = world.entities.get(t.sourceId);
      const facing = src && !src.dead ? src.facing : t.facing;
      const x = src ? src.pos.x : t.x;
      const z = src ? src.pos.z : t.z;
      const jaws = anchorWorld(DRAKE_JAWS_EXHALE, x, t.floor, z, facing, t.scale);
      const perSec = 420 * this.density * env;
      t.emitted += perSec * dt;
      const half = (this.breath.arcDeg * Math.PI) / 360;
      while (t.emitted >= 1) {
        t.emitted -= 1;
        // Aim each sprite at a spot inside the cone: it falls from the jaws and
        // rolls out along the floor toward the rim.
        const a = facing + (this.rand() * 2 - 1) * half * 0.92;
        const reach = this.breath.range * (0.45 + 0.6 * this.rand());
        const tx = x + Math.sin(a) * reach;
        const tz = z + Math.cos(a) * reach;
        const flight = 0.5 + this.rand() * 0.15;
        const drag = 1.1;
        const k = (1 - Math.exp(-drag * flight)) / drag;
        const gy = this.groundY(tx, tz);
        this.fire.emit(this.clock, {
          x: jaws.x + (this.rand() - 0.5) * 0.4,
          y: jaws.y + (this.rand() - 0.5) * 0.4,
          z: jaws.z + (this.rand() - 0.5) * 0.4,
          vx: (tx - jaws.x) / k,
          vy: (gy - jaws.y - 0.6) / k,
          vz: (tz - jaws.z) / k,
          ay: 2.2,
          life: flight + 0.45 + this.rand() * 0.3,
          drag,
          floor: t.floor + 0.25,
          size0: 0.35 + this.rand() * 0.25,
          size1: 1.7 + this.rand() * 1.6,
          spin: 0,
          r: 1.05 + this.rand() * 0.25,
          g: 0,
          b: 0,
          a: 0.9 * env,
        });
        // A few embers thrown off the torrent, and a heat-haze puff riding it.
        if (this.rand() < 0.3) {
          this.glow.emit(this.clock + flight * this.rand(), {
            x: tx + (this.rand() - 0.5) * 3,
            y: gy + 0.4,
            z: tz + (this.rand() - 0.5) * 3,
            vx: (this.rand() - 0.5) * 2,
            vy: 2.5 + this.rand() * 3,
            vz: (this.rand() - 0.5) * 2,
            ay: 1,
            life: 1.2 + this.rand() * 1.2,
            drag: 0.6,
            size0: 0.14,
            size1: 0.06,
            r: 0.75 + this.rand() * 0.25,
            g: 1,
            b: 0.4,
            a: 1,
          });
        }
        if (this.rand() < 0.05) {
          this.haze.emit(this.clock + flight, {
            x: tx,
            y: gy + 1,
            z: tz,
            vx: 0,
            vy: 1.6,
            vz: 0,
            life: 1.2,
            drag: 0.6,
            size0: 2,
            size1: 4.2,
            r: 0.3,
            g: 0.42,
            b: 0.22,
            a: 0.3,
          });
        }
        if (this.rand() < 0.08) {
          this.dust.emit(this.clock, {
            x: jaws.x,
            y: jaws.y,
            z: jaws.z,
            vx: ((tx - jaws.x) / k) * 0.8,
            vy: ((gy - jaws.y) / k) * 0.6 + 2,
            vz: ((tz - jaws.z) / k) * 0.8,
            ay: 2,
            life: 1.1,
            drag,
            floor: t.floor + 0.8,
            size0: 1.5,
            size1: 5,
            r: 0.05,
            g: 0.08,
            b: 0.035,
            a: 0.32,
          });
        }
      }
      // The muzzle: a white-hot, green-white core at the jaws while it pours.
      const h = this.halo(-100 - t.sourceId);
      if (h) {
        const slot = this.halos.find((q) => q.mesh === h.mesh);
        if (slot) {
          slot.owner = -100 - t.sourceId;
          slot.ring = null;
        }
        h.mesh.position.set(jaws.x, jaws.y, jaws.z);
        h.mesh.scale.setScalar(2.2 + 0.4 * Math.sin(this.clock * 30));
        (h.mat.uniforms.uColor.value as THREE.Color).setRGB(0.92, 1, 0.72);
        h.mat.uniforms.uAlpha.value = env;
        h.mat.uniforms.uRing.value = 0;
        h.mesh.visible = env > 0.01;
      }
      if (age < 0.1) this.shakeAt(x, z, 0.25);
    }
    // Retire muzzle halos whose torrent ended.
    for (const h of this.halos) {
      if (h.owner <= -100 && !this.torrents.some((t) => -100 - t.sourceId === h.owner)) {
        h.owner = -1;
        h.mesh.visible = false;
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
