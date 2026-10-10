// The Hollow Crypt finale's effects (plan: crypt_finale_fx_core.ts), at the
// Ignivar raid's bar, on meshes modelled in Blender
// (scripts/assets/hollow_crypt_creatures/build_rite_vfx.py, shipped as
// public/models/props/crypt_rite_vfx.glb):
//
//  Morthen's entrance (read off his cast bar and height)
//  - the rite wakes: the ritual circle's glyph band ignites round his spot, the
//    great circle of the ring flares with it, and the light column over the
//    ring begins to swell;
//  - he rises: the floor breaks (shards of flagstone flung up, dust rolling
//    out, the camera shaking), columns of souls rise round him, a spectral wind
//    spirals up about him and the light column pours down at full strength;
//  - he speaks over the ring at the peak of it all, then comes down; the
//    landing throws a shockwave across the floor.
//
//  The Knellwyrm
//  - the pyre: the ritual circle bursts into ghost fire (a floor telegraph that
//    fills until it lands, flames round its rim, embers);
//  - the touchdown blast in the pyre (a fire nova, dust, a shockwave);
//  - Pyre Strafe: the lane painted while its bar runs, the wyrm's fire poured
//    down it on the run, then the lane left burning (flames along it);
//  - Dread Bellow: the ring it throws people out of, then a roar shockwave.
//
// Rules (src/render/CLAUDE.md): one root, attached through the compile gate
// with every material present (the Blender meshes swap in when the GLB lands;
// procedural stand-ins meanwhile); pooled everything; GPU particles. The
// telegraphs (pyre, lanes, the bellow ring) are ACTIONABLE and draw on every
// tier; the rest is cosmetic and sheds on the low effects tier.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  KNELL_LANE_MARK_TEMPLATE,
  KNELL_LANE_TEMPLATE,
  KNELL_PYRE_TEMPLATE,
  KNELLWYRM_DREAD_BELLOW,
  KNELLWYRM_ID,
  KNELLWYRM_PYRE_STRAFE,
  KNELLWYRM_STRAFE_RUN,
  KNELLWYRM_TOUCHDOWN,
  KNELLWYRM_TUNING,
  MORTHEN_ID,
  MORTHEN_LANDING,
  MORTHEN_RISE,
  MORTHEN_SPOT,
  RITE_RING,
} from '../../sim/encounters/hollow_crypt/ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { loadGltf, releaseGltf } from '../assets/loader';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import {
  TELEGRAPH_ACCENTS,
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  TelegraphKit,
  type TelegraphLane,
  telegraphFillOf,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import {
  isKnellLaneTemplate,
  laneBurn,
  laneFlameSpots,
  pyreFill,
  riteLevels,
} from './crypt_finale_fx_core';
import {
  DUST_FRAG,
  FIRE_FRAG,
  FIRE_VERT,
  GHOST_RAMP,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
} from './crypt_fx_particles';
export const CRYPT_RITE_VFX_URL = '/models/props/crypt_rite_vfx.glb';

/** The finale's own encounter objects (the pyre and the strafe lanes). */
const FINALE_OBJECT_TEMPLATES: ReadonlySet<string> = new Set([
  KNELL_PYRE_TEMPLATE,
  KNELL_LANE_MARK_TEMPLATE,
  KNELL_LANE_TEMPLATE,
]);

const SCAN_SEC = 0.1;
const SPOT_RING_RADIUS = 9;
const COLUMN_COUNT = 5;
const DEBRIS_PER_SHAPE = 10;
const DEBRIS_SHAPES = 4;

// ---------------------------------------------------------------- shaders

const MESH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vLocal;
void main() {
  vUv = uv;
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The ritual circle's glyph band: ignited round the ring as uIgnite sweeps
 *  from 0 to 1, white-hot at the ignition front, flickering ghost fire. */
const RUNE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIgnite;
uniform float uIntensity;
varying vec2 vUv;
${GHOST_RAMP}
void main() {
  float a = vUv.x;
  float lit = smoothstep(uIgnite, uIgnite - 0.04, a) * step(0.001, uIgnite);
  float front = (1.0 - smoothstep(0.0, 0.05, abs(a - uIgnite))) * step(uIgnite, 0.999);
  float flick = 0.8 + 0.2 * sin(uTime * 17.0 + a * 90.0) * sin(uTime * 5.3 + a * 31.0);
  float heat = clamp((0.55 + 0.35 * flick) * lit + front * 0.9, 0.0, 1.0);
  vec3 col = ghostRamp(0.35 + 0.6 * heat) * (1.2 + 1.6 * front);
  gl_FragColor = vec4(col, (lit * 0.9 + front) * uIntensity);
}
`;

/** A column of souls: ghost-fire bands climbing the ribbons, burning out at the top. */
const COLUMN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uSeed;
varying vec2 vUv;
${GHOST_RAMP}
void main() {
  float v = vUv.y;
  float souls = pow(max(0.5 + 0.5 * sin((v * 9.0 - uTime * 2.4 + vUv.x * 18.8 + uSeed) ), 0.0), 3.0);
  float streak = 0.5 + 0.5 * sin(v * 40.0 - uTime * 7.0 + vUv.x * 60.0);
  float body = souls * 0.8 + streak * 0.25;
  float fade = smoothstep(0.0, 0.08, v) * (1.0 - smoothstep(0.55, 1.0, v));
  vec3 col = ghostRamp(0.45 + 0.5 * body) * 1.5;
  gl_FragColor = vec4(col, body * fade * uIntensity * 0.85);
}
`;

/** The great light column over the ring: a soft shaft, brightest at its core. */
const LIGHT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vLocal;
${GHOST_RAMP}
void main() {
  float r = length(vLocal.xz) / 0.5;
  float core = pow(max(1.0 - r, 0.0), 1.6);
  float ripple = 0.8 + 0.2 * sin(vLocal.y * 0.6 - uTime * 3.0);
  float fade = smoothstep(0.0, 0.05, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  vec3 col = ghostRamp(0.7 + 0.28 * core) * 1.4;
  gl_FragColor = vec4(col, core * ripple * fade * uIntensity * 1.1);
}
`;

/** The flung flagstone shards: GPU ballistic flight from the burst time. */
const DEBRIS_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec3 aStart;
attribute vec3 aVel;
attribute vec4 aSpin; // axis xyz, rate
uniform float uTime;
uniform float uBurst;
uniform float uScale;
varying vec3 vNormal;
varying float vAlive;
mat3 rot(vec3 axis, float ang) {
  axis = normalize(axis);
  float s = sin(ang), c = cos(ang), oc = 1.0 - c;
  return mat3(oc * axis.x * axis.x + c, oc * axis.x * axis.y + axis.z * s, oc * axis.z * axis.x - axis.y * s,
              oc * axis.x * axis.y - axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z + axis.x * s,
              oc * axis.z * axis.x + axis.y * s, oc * axis.y * axis.z - axis.x * s, oc * axis.z * axis.z + c);
}
void main() {
  float t = uTime - uBurst;
  vAlive = step(0.0, t) * (1.0 - smoothstep(2.2, 2.8, t));
  vec3 p = aStart + aVel * t + vec3(0.0, -9.0 * t * t, 0.0);
  p.y = max(p.y, aStart.y - 0.2);
  mat3 R = rot(aSpin.xyz, aSpin.w * t);
  vec3 local = R * (position * uScale);
  vNormal = R * normal;
  vec4 w = modelMatrix * vec4(p + local, 1.0);
  gl_Position = vAlive > 0.0 ? projectionMatrix * wocCamRelView(w.xyz) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const DEBRIS_FRAG = /* glsl */ `
varying vec3 vNormal;
varying float vAlive;
void main() {
  float l = 0.35 + 0.65 * max(dot(normalize(vNormal), normalize(vec3(0.3, 0.9, 0.2))), 0.0);
  vec3 stone = vec3(0.36, 0.37, 0.4) * l;
  // Lit from below by the rite's ghost fire.
  stone += vec3(0.18, 0.55, 0.16) * max(-normalize(vNormal).y, 0.0) * 0.8;
  gl_FragColor = vec4(stone, vAlive);
}
`;

/** A floor shockwave band: a bright leading edge with a soft wake. */
const WAVE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vLocal;
void main() {
  float r = length(vLocal.xz);
  float lead = smoothstep(0.78, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float wake = smoothstep(0.3, 0.95, r) * 0.3 * step(r, 1.0);
  gl_FragColor = vec4(uColor * (1.2 + lead), (lead + wake) * uAlpha);
}
`;

// ---------------------------------------------------------------- types

interface Wave {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  span: number;
  reach: number;
  alive: boolean;
}

interface LaneSlot extends TelegraphLane {
  objectId: number;
  born: number;
}

interface PyreSlot extends TelegraphFan {
  objectId: number;
  born: number;
}

// ---------------------------------------------------------------- stand-ins

function standInColumn(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.8, 1, 1, 18, 12, true);
  g.translate(0, 0.5, 0);
  return g;
}

function standInRing(): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(0.62, 1, 96, 1);
  g.rotateX(-Math.PI / 2);
  // Polar UVs as the Blender ring carries them: u the angle, v the radius.
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    uv.setXY(i, (Math.atan2(-z, x) / (Math.PI * 2) + 1) % 1, Math.hypot(x, z));
  }
  return g;
}

function standInDebris(): THREE.BufferGeometry {
  return new THREE.DodecahedronGeometry(0.45, 0);
}

// ---------------------------------------------------------------- the fx

export class CryptFinaleFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly kit: TelegraphKit;
  private readonly fire: ParticlePool;
  private readonly glow: ParticlePool;
  private readonly dust: ParticlePool;
  private readonly runeSpot: THREE.Mesh;
  private readonly runeRing: THREE.Mesh;
  private readonly runeSpotMat: THREE.ShaderMaterial;
  private readonly runeRingMat: THREE.ShaderMaterial;
  private readonly columns: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  private readonly light: THREE.Mesh;
  private readonly lightMat: THREE.ShaderMaterial;
  private readonly debris: THREE.InstancedMesh[] = [];
  private readonly debrisMat: THREE.ShaderMaterial;
  private readonly waves: Wave[] = [];
  private readonly pyres: PyreSlot[] = [];
  private readonly lanes: LaneSlot[] = [];
  private readonly bellow: TelegraphFan;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly objectsSeen = new Map<number, number>();
  private morthenId = -1;
  private wyrmId = -1;
  private burstDone = new Set<number>();
  private clock = 0;
  private scan = 0;
  private seed = 0x4b1d;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shake?: (amount: number) => void,
  ) {
    this.root.name = 'crypt-finale-fx';
    setRenderCategory(this.root, 'ui3d');
    const low =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';
    this.density = low ? 0.45 : 1;
    this.kit = new TelegraphKit(this.root, !low);
    for (let i = 0; i < 2; i++) this.pyres.push({ ...this.kit.fan(12), objectId: -1, born: 0 });
    for (let i = 0; i < 4; i++) this.lanes.push({ ...this.kit.lane(13), objectId: -1, born: 0 });
    this.bellow = this.kit.fan(14);

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
      Math.round(1400 * this.density),
      particleMat(FIRE_FRAG, FIRE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 26),
    );
    this.glow = new ParticlePool(
      Math.round(1200 * this.density),
      particleMat(GLOW_FRAG, PARTICLE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 27),
    );
    this.dust = new ParticlePool(
      Math.round(700 * this.density),
      particleMat(DUST_FRAG, PARTICLE_VERT, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 25),
    );
    for (const p of [this.dust, this.fire, this.glow]) {
      this.geometries.push(p.mesh.geometry);
      this.root.add(p.mesh);
    }

    const additive = (
      frag: string,
      uniforms: Record<string, THREE.IUniform>,
      side = THREE.DoubleSide,
    ) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime, uIntensity: { value: 0 }, ...uniforms },
        vertexShader: MESH_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        side,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(m);
      return m;
    };
    const ringGeo = standInRing();
    this.geometries.push(ringGeo);
    this.runeSpotMat = additive(RUNE_FRAG, { uIgnite: { value: 0 } });
    this.runeRingMat = additive(RUNE_FRAG, { uIgnite: { value: 0 } });
    this.runeSpot = new THREE.Mesh(ringGeo, this.runeSpotMat);
    this.runeRing = new THREE.Mesh(ringGeo, this.runeRingMat);
    for (const m of [this.runeSpot, this.runeRing]) {
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = floorVfxRenderOrder('encounter', 4);
      this.root.add(m);
    }
    const columnGeo = standInColumn();
    this.geometries.push(columnGeo);
    for (let i = 0; i < COLUMN_COUNT; i++) {
      const mat = additive(COLUMN_FRAG, { uSeed: { value: i * 1.7 } });
      const mesh = new THREE.Mesh(columnGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 29);
      this.root.add(mesh);
      this.columns.push({ mesh, mat });
    }
    const lightGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8, true);
    lightGeo.translate(0, 0.5, 0);
    this.geometries.push(lightGeo);
    this.lightMat = additive(LIGHT_FRAG, {});
    this.light = new THREE.Mesh(lightGeo, this.lightMat);
    this.light.frustumCulled = false;
    this.light.visible = false;
    this.light.renderOrder = floorVfxRenderOrder('encounter', 30);
    this.root.add(this.light);

    this.debrisMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime, uBurst: { value: -1e6 }, uScale: { value: 1 } },
      vertexShader: DEBRIS_VERT,
      fragmentShader: DEBRIS_FRAG,
      transparent: true,
    });
    this.materials.push(this.debrisMat);
    for (let k = 0; k < DEBRIS_SHAPES; k++) {
      const geo = standInDebris();
      this.geometries.push(geo);
      this.debris.push(this.makeDebris(geo));
    }

    const waveGeo = new THREE.CircleGeometry(1, 64);
    waveGeo.rotateX(-Math.PI / 2);
    this.geometries.push(waveGeo);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } },
        vertexShader: MESH_VERT,
        fragmentShader: WAVE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(waveGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 24);
      this.root.add(mesh);
      this.waves.push({ mesh, mat, born: 0, span: 0, reach: 1, alive: false });
    }

    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
    if (typeof window !== 'undefined') void this.loadMeshes();
  }

  private makeDebris(geo: THREE.BufferGeometry): THREE.InstancedMesh {
    const n = DEBRIS_PER_SHAPE;
    const inst = new THREE.InstancedBufferGeometry();
    inst.index = geo.index;
    for (const name of ['position', 'normal']) {
      const a = geo.getAttribute(name);
      if (a) inst.setAttribute(name, a);
    }
    inst.setAttribute('aStart', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    inst.setAttribute('aVel', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    inst.setAttribute('aSpin', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
    inst.instanceCount = n;
    this.geometries.push(inst);
    const mesh = new THREE.InstancedMesh(inst, this.debrisMat, n);
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.root.add(mesh);
    return mesh;
  }

  /** Swap the Blender meshes in once the GLB lands (stand-ins until then). */
  private async loadMeshes(): Promise<void> {
    try {
      const gltf = await loadGltf(CRYPT_RITE_VFX_URL);
      if (this.disposed) return;
      const byName = new Map<string, THREE.BufferGeometry>();
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) byName.set(o.name, mesh.geometry.clone());
      });
      releaseGltf(CRYPT_RITE_VFX_URL);
      const ring = byName.get('Vfx_RuneRing');
      if (ring?.getAttribute('uv')) {
        this.geometries.push(ring);
        this.runeSpot.geometry = ring;
        this.runeRing.geometry = ring;
      }
      const column = byName.get('Vfx_SoulColumn');
      if (column?.getAttribute('uv')) {
        this.geometries.push(column);
        for (const c of this.columns) c.mesh.geometry = column;
      }
      for (let k = 0; k < DEBRIS_SHAPES; k++) {
        const g = byName.get(`Vfx_Debris${k}`);
        if (!g) continue;
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        this.geometries.push(g);
        const old = this.debris[k];
        const inst = old.geometry as THREE.InstancedBufferGeometry;
        inst.index = g.index;
        inst.setAttribute('position', g.getAttribute('position'));
        inst.setAttribute('normal', g.getAttribute('normal'));
      }
    } catch {
      // The stand-ins stay: the effect loses detail, never its meaning.
    }
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  // ----------------------------------------------------------------- events

  handleEvent(ev: SimEvent): void {
    if (ev.type !== 'spellfx' || !this.world || this.disposed) return;
    const src = this.world.entities.get(ev.sourceId);
    if (!src) return;
    if (ev.ability === MORTHEN_RISE && ev.fx === 'nova') this.breakFloor(src);
    else if (ev.ability === MORTHEN_LANDING) this.landing(src, 9, 0x9dff7a, 0.5);
    else if (ev.ability === KNELLWYRM_TOUCHDOWN) this.touchdown(src);
    else if (ev.ability === KNELLWYRM_DREAD_BELLOW && ev.fx === 'nova') this.bellowBlast(src);
  }

  /** He breaks the floor: shards flung up, dust rolling out, the ground shaking. */
  private breakFloor(e: Entity): void {
    const x = e.pos.x;
    const z = e.pos.z;
    const gy = this.groundY(x, z);
    if (!this.burstDone.has(e.id)) {
      this.burstDone.add(e.id);
      this.debrisMat.uniforms.uBurst.value = this.clock;
      for (const mesh of this.debris) {
        const g = mesh.geometry as THREE.InstancedBufferGeometry;
        const start = g.getAttribute('aStart') as THREE.InstancedBufferAttribute;
        const vel = g.getAttribute('aVel') as THREE.InstancedBufferAttribute;
        const spin = g.getAttribute('aSpin') as THREE.InstancedBufferAttribute;
        for (let i = 0; i < DEBRIS_PER_SHAPE; i++) {
          const a = this.rand() * Math.PI * 2;
          const r = this.rand() * 3.5;
          start.setXYZ(i, x + Math.sin(a) * r, gy + 0.1, z + Math.cos(a) * r);
          const out = 2 + this.rand() * 5;
          vel.setXYZ(i, Math.sin(a) * out, 7 + this.rand() * 9, Math.cos(a) * out);
          spin.setXYZW(i, this.rand() - 0.5, this.rand(), this.rand() - 0.5, 2 + this.rand() * 6);
        }
        start.needsUpdate = true;
        vel.needsUpdate = true;
        spin.needsUpdate = true;
        mesh.visible = true;
      }
    }
    const n = Math.round(90 * this.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand() * 0.2;
      const speed = 6 + this.rand() * 7;
      this.dust.emit(this.clock + this.rand() * 0.2, {
        x: x + Math.sin(a) * 1.5,
        y: gy + 0.3,
        z: z + Math.cos(a) * 1.5,
        vx: Math.sin(a) * speed,
        vy: 0.8 + this.rand() * 2.5,
        vz: Math.cos(a) * speed,
        life: 1.6 + this.rand() * 0.9,
        drag: 1.8,
        floor: gy + 0.2,
        size0: 1.4,
        size1: 5 + this.rand() * 2,
        spin: (this.rand() - 0.5) * 0.6,
        r: 0.5,
        g: 0.52,
        b: 0.5,
        a: 0.55,
      });
    }
    this.wave(x, z, 12, 0.7, 0xb8ff9a);
    this.shakeAt(x, z, 0.8);
  }

  private landing(e: Entity, reach: number, color: number, shake: number): void {
    const gy = this.groundY(e.pos.x, e.pos.z);
    this.wave(e.pos.x, e.pos.z, reach, 0.55, color);
    const n = Math.round(60 * this.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const speed = 8 + this.rand() * 5;
      this.dust.emit(this.clock + this.rand() * 0.05, {
        x: e.pos.x + Math.sin(a),
        y: gy + 0.3,
        z: e.pos.z + Math.cos(a),
        vx: Math.sin(a) * speed,
        vy: 0.6 + this.rand() * 1.6,
        vz: Math.cos(a) * speed,
        life: 1.2 + this.rand() * 0.6,
        drag: 2.2,
        floor: gy + 0.2,
        size0: 1.2,
        size1: 4 + this.rand() * 1.5,
        r: 0.52,
        g: 0.52,
        b: 0.5,
        a: 0.5,
      });
    }
    this.shakeAt(e.pos.x, e.pos.z, shake);
  }

  /** The Knellwyrm lands in the pyre: a nova of ghost fire and a shockwave. */
  private touchdown(e: Entity): void {
    this.landing(e, KNELLWYRM_TUNING.pyreRadius * 1.4, 0xa8ff6a, 0.9);
    const gy = this.groundY(e.pos.x, e.pos.z);
    const n = Math.round(160 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * KNELLWYRM_TUNING.pyreRadius;
      const out = 3 + this.rand() * 5;
      this.fire.emit(this.clock + this.rand() * 0.15, {
        x: e.pos.x + Math.sin(a) * r,
        y: gy + 0.1,
        z: e.pos.z + Math.cos(a) * r,
        vx: Math.sin(a) * out,
        vy: 2 + this.rand() * 4,
        vz: Math.cos(a) * out,
        ay: 1.5,
        life: 0.8 + this.rand() * 0.6,
        drag: 1.2,
        size0: 1.2,
        size1: 3.5 + this.rand() * 2.5,
        r: 1.05,
        g: 0,
        b: 0,
        a: 0.9,
      });
    }
  }

  private bellowBlast(e: Entity): void {
    this.wave(e.pos.x, e.pos.z, KNELLWYRM_TUNING.bellowRadius * 1.1, 0.6, 0xc8ffb0);
    this.wave(e.pos.x, e.pos.z, KNELLWYRM_TUNING.bellowRadius * 0.7, 0.45, 0xffffff);
    this.shakeAt(e.pos.x, e.pos.z, 0.7);
  }

  private wave(x: number, z: number, reach: number, seconds: number, color: number): void {
    const w = this.waves.find((q) => !q.alive) ?? this.waves[0];
    w.alive = true;
    w.born = this.clock;
    w.span = seconds;
    w.reach = reach;
    (w.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    w.mesh.position.set(x, this.groundY(x, z) + 0.12, z);
    w.mesh.scale.setScalar(0.01);
    w.mesh.visible = true;
  }

  private shakeAt(x: number, z: number, amount: number): void {
    if (!this.shake || this.reducedMotion() || !this.world) return;
    const me = this.world.player;
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < 45) this.shake(amount * (1 - d / 45));
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    this.stepRite(world, dt);
    this.stepPyres(world, dt);
    this.stepLanes(world, dt);
    this.stepWyrm(world, dt);
    for (const w of this.waves) {
      if (!w.alive) continue;
      const k = (this.clock - w.born) / w.span;
      if (k >= 1) {
        w.alive = false;
        w.mesh.visible = false;
        continue;
      }
      const ease = 1 - (1 - k) ** 3;
      w.mesh.scale.setScalar(w.reach * (0.08 + 0.92 * ease));
      w.mat.uniforms.uAlpha.value = (1 - k) ** 1.4;
    }
    if (this.clock - this.debrisMat.uniforms.uBurst.value > 3)
      for (const m of this.debris) m.visible = false;
    this.fire.update(this.clock);
    this.glow.update(this.clock);
    this.dust.update(this.clock);
  }

  private scanWorld(world: IWorld): void {
    this.morthenId = -1;
    this.wyrmId = -1;
    const live = new Set<number>();
    for (const e of world.entities.values()) {
      if (e.kind === 'mob') {
        if (e.templateId === MORTHEN_ID && !e.dead) this.morthenId = e.id;
        else if (e.templateId === KNELLWYRM_ID && !e.dead) this.wyrmId = e.id;
        continue;
      }
      // Only the finale's own objects: the wing bosses' graves, lanterns,
      // rime and note lanes share CRYPT_OBJECT_TEMPLATES (crypt_boss_fx.ts).
      if (e.kind !== 'object' || !FINALE_OBJECT_TEMPLATES.has(e.templateId)) continue;
      live.add(e.id);
      if (!this.objectsSeen.has(e.id)) this.objectsSeen.set(e.id, this.clock);
      if (e.templateId === KNELL_PYRE_TEMPLATE) {
        if (!this.pyres.some((p) => p.objectId === e.id)) {
          const slot = this.pyres.find((p) => p.objectId < 0);
          if (slot) {
            slot.objectId = e.id;
            slot.born = this.objectsSeen.get(e.id) ?? this.clock;
            this.kit.layOutFan(slot, 360, {
              color: TELEGRAPH_THREAT_COLORS.danger,
              accent: TELEGRAPH_ACCENTS.ghostfire,
            });
            slot.group.visible = true;
          }
        }
      } else if (
        isKnellLaneTemplate(e.templateId) &&
        !this.lanes.some((l) => l.objectId === e.id)
      ) {
        const slot = this.lanes.find((l) => l.objectId < 0);
        if (slot) {
          slot.objectId = e.id;
          slot.born = this.objectsSeen.get(e.id) ?? this.clock;
          slot.group.visible = true;
        }
      }
    }
    for (const [id] of this.objectsSeen) if (!live.has(id)) this.objectsSeen.delete(id);
    for (const p of this.pyres)
      if (p.objectId >= 0 && !live.has(p.objectId)) {
        p.objectId = -1;
        p.group.visible = false;
      }
    for (const l of this.lanes)
      if (l.objectId >= 0 && !live.has(l.objectId)) {
        l.objectId = -1;
        l.group.visible = false;
      }
  }

  /** Morthen's entrance, read off his cast bar each frame. */
  private stepRite(world: IWorld, dt: number): void {
    const m = this.morthenId >= 0 ? world.entities.get(this.morthenId) : undefined;
    const lv = m
      ? riteLevels(m.castingAbility, m.castRemaining, m.castTotal)
      : riteLevels(null, 0, 0);
    const on = lv.circle > 0 || lv.columns > 0 || lv.light > 0;
    this.runeSpot.visible = on;
    this.runeRing.visible = on;
    this.light.visible = on;
    for (const c of this.columns) c.mesh.visible = on;
    if (!m || !on) return;
    const x = m.pos.x;
    const z = m.pos.z;
    const gy = this.groundY(x, z);
    // The ring's centre (the great circle and the light column).
    const cx = x + (RITE_RING.x - MORTHEN_SPOT.x);
    const cz = z + (RITE_RING.z - MORTHEN_SPOT.z);
    const cy = this.groundY(cx, cz);
    this.runeSpot.position.set(x, gy + 0.09, z);
    this.runeSpot.scale.setScalar(SPOT_RING_RADIUS);
    this.runeSpotMat.uniforms.uIgnite.value = lv.circle;
    this.runeSpotMat.uniforms.uIntensity.value = 1.6;
    this.runeRing.position.set(cx, cy + 0.08, cz);
    this.runeRing.scale.setScalar(RITE_RING.r - 1.5);
    this.runeRingMat.uniforms.uIgnite.value = Math.min(1, lv.circle * 1.15);
    this.runeRingMat.uniforms.uIntensity.value = 1.1;
    this.light.position.set(cx, cy, cz);
    this.light.scale.set(7 + 3 * lv.light, 90, 7 + 3 * lv.light);
    this.lightMat.uniforms.uIntensity.value = lv.light;
    for (let i = 0; i < this.columns.length; i++) {
      const c = this.columns[i];
      if (i === 0) {
        // The column he rises inside.
        c.mesh.position.set(x, gy - 1, z);
        c.mesh.scale.set(2.6, 26 * lv.columns + 2, 2.6);
        c.mesh.rotation.y = this.clock * 0.9;
      } else {
        const a = ((i - 1) / (this.columns.length - 1)) * Math.PI * 2 + Math.PI / 4;
        const px = x + Math.sin(a) * 6.5;
        const pz = z + Math.cos(a) * 6.5;
        c.mesh.position.set(px, this.groundY(px, pz) - 0.5, pz);
        c.mesh.scale.set(1.3, 18 * lv.columns + 1, 1.3);
        c.mesh.rotation.y = -this.clock * 1.3 + i;
      }
      c.mat.uniforms.uIntensity.value = lv.columns;
    }
    // The spectral wind: wisps spiralling up round him.
    const wisps = lv.wind * 90 * this.density * dt;
    for (let n = 0; n < Math.floor(wisps + this.rand()); n++) {
      const a = this.rand() * Math.PI * 2;
      const r = 3 + this.rand() * 5;
      const up = 4 + this.rand() * 6;
      const tang = a + Math.PI / 2;
      this.glow.emit(this.clock, {
        x: x + Math.sin(a) * r,
        y: gy + this.rand() * 2,
        z: z + Math.cos(a) * r,
        vx: Math.sin(tang) * 7 - Math.sin(a) * 1.5,
        vy: up,
        vz: Math.cos(tang) * 7 - Math.cos(a) * 1.5,
        life: 1.4 + this.rand() * 0.8,
        drag: 0.8,
        size0: 0.5,
        size1: 0.12,
        r: 0.6 + this.rand() * 0.3,
        g: 1,
        b: 0.5,
        a: 0.85,
      });
    }
    // The circle's fire licking up round his spot as it ignites.
    const flames = lv.circle * 140 * this.density * dt;
    for (let n = 0; n < Math.floor(flames + this.rand()); n++) {
      const a = this.rand() * Math.PI * 2 * lv.circle;
      const r = SPOT_RING_RADIUS * (0.9 + this.rand() * 0.1);
      const fx = x + Math.cos(a) * r;
      const fz = z - Math.sin(a) * r;
      this.fire.emit(this.clock, {
        x: fx,
        y: this.groundY(fx, fz) + 0.1,
        z: fz,
        vx: 0,
        vy: 1.4 + this.rand(),
        vz: 0,
        ay: 1,
        life: 0.7 + this.rand() * 0.4,
        drag: 0.8,
        size0: 0.9,
        size1: 2.6 + this.rand() * 1.6 * lv.columns,
        r: 0.9 + this.rand() * 0.2,
        g: 0,
        b: 0,
        a: 0.8,
      });
    }
    // Dust shaken off the floor while it quakes.
    if (lv.quake > 0.05 && this.rand() < lv.quake * 0.6) {
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * 10;
      this.dust.emit(this.clock, {
        x: x + Math.sin(a) * r,
        y: gy + 0.2,
        z: z + Math.cos(a) * r,
        vx: 0,
        vy: 0.6 + this.rand(),
        vz: 0,
        life: 1.5,
        drag: 1,
        size0: 1,
        size1: 3.2,
        r: 0.5,
        g: 0.5,
        b: 0.48,
        a: 0.35,
      });
      if (this.rand() < 0.15) this.shakeAt(x, z, 0.15 * lv.quake);
    }
  }

  /** The burning ritual circle: a telegraph filling to the landing, fire round it. */
  private stepPyres(world: IWorld, dt: number): void {
    for (const p of this.pyres) {
      if (p.objectId < 0) continue;
      const obj = world.entities.get(p.objectId);
      if (!obj) continue;
      const radius = obj.scale || KNELLWYRM_TUNING.pyreRadius;
      const gy = this.groundY(obj.pos.x, obj.pos.z);
      const fill = pyreFill(this.clock - p.born);
      this.kit.drapeFan(p, this.groundY, obj.pos.x, gy, obj.pos.z, 0, radius);
      this.kit.paintFan(p, { fill, clock: this.clock, range: radius });
      // Flames round the rim and through the circle, rising as it fills.
      const n = (40 + 90 * fill) * this.density * dt;
      for (let i = 0; i < Math.floor(n + this.rand()); i++) {
        const a = this.rand() * Math.PI * 2;
        const rim = this.rand() < 0.65;
        const r = rim ? radius * (0.92 + this.rand() * 0.1) : Math.sqrt(this.rand()) * radius;
        const fx = obj.pos.x + Math.sin(a) * r;
        const fz = obj.pos.z + Math.cos(a) * r;
        this.fire.emit(this.clock, {
          x: fx,
          y: this.groundY(fx, fz) + 0.1,
          z: fz,
          vx: 0,
          vy: 1.6 + this.rand() * 1.4,
          vz: 0,
          ay: 1.4,
          life: 0.8 + this.rand() * 0.5,
          drag: 0.8,
          size0: rim ? 1 : 0.7,
          size1: (rim ? 2.8 : 1.8) + this.rand() * (1 + fill * 1.5),
          r: 0.85 + this.rand() * 0.3,
          g: 0,
          b: 0,
          a: 0.85,
        });
      }
      if (this.rand() < 0.5) {
        const a = this.rand() * Math.PI * 2;
        const r = this.rand() * radius;
        this.glow.emit(this.clock, {
          x: obj.pos.x + Math.sin(a) * r,
          y: gy + 0.4,
          z: obj.pos.z + Math.cos(a) * r,
          vx: (this.rand() - 0.5) * 1.5,
          vy: 3 + this.rand() * 3,
          vz: (this.rand() - 0.5) * 1.5,
          life: 1.2 + this.rand(),
          drag: 0.6,
          size0: 0.16,
          size1: 0.05,
          r: 0.8,
          g: 1,
          b: 0.45,
          a: 1,
        });
      }
    }
  }

  /** The strafe lanes: painted while marked, then burning. */
  private stepLanes(world: IWorld, dt: number): void {
    const wyrm = this.wyrmId >= 0 ? world.entities.get(this.wyrmId) : undefined;
    const half = KNELLWYRM_TUNING.laneHalf;
    for (const l of this.lanes) {
      if (l.objectId < 0) continue;
      const obj = world.entities.get(l.objectId);
      if (!obj) continue;
      const length = obj.scale || 1;
      const yaw = obj.facing;
      const gy = this.groundY(obj.pos.x, obj.pos.z);
      const marked = obj.templateId === KNELL_LANE_MARK_TEMPLATE;
      this.kit.drapeLane(l, this.groundY, obj.pos.x, gy, obj.pos.z, yaw, length, half, {
        color: TELEGRAPH_THREAT_COLORS.danger,
        accent: TELEGRAPH_ACCENTS.ghostfire,
      });
      if (marked) {
        const fill =
          wyrm && wyrm.castingAbility === KNELLWYRM_PYRE_STRAFE
            ? telegraphFillOf(wyrm.castRemaining, wyrm.castTotal)
            : 1;
        this.kit.paintLane(l, { fill, clock: this.clock, range: length });
        continue;
      }
      if (obj.templateId !== KNELL_LANE_TEMPLATE) continue;
      const burn = laneBurn(this.clock - l.born);
      this.kit.paintLane(l, {
        fill: 1,
        clock: this.clock,
        range: length,
        fade: 0.55 + 0.45 * burn,
      });
      // The fire standing on the lane.
      const spots = laneFlameSpots(Math.max(6, Math.round(length / 2.2)));
      const ax = Math.sin(yaw);
      const az = Math.cos(yaw);
      const rate = burn * 3.2 * this.density * dt;
      for (const s of spots) {
        if (this.rand() > rate) continue;
        const fx = obj.pos.x + ax * s.along * length + az * s.side * half;
        const fz = obj.pos.z + az * s.along * length - ax * s.side * half;
        this.fire.emit(this.clock, {
          x: fx,
          y: this.groundY(fx, fz) + 0.1,
          z: fz,
          vx: 0,
          vy: 1.5 + this.rand() * 1.5,
          vz: 0,
          ay: 1.3,
          life: 0.8 + this.rand() * 0.5,
          drag: 0.8,
          size0: 0.9,
          size1: 2.4 + this.rand() * 1.6,
          r: 0.9 + this.rand() * 0.25,
          g: 0,
          b: 0,
          a: 0.85,
        });
      }
    }
  }

  /** The wyrm's own moments: the strafe's fire, the bellow's ring. */
  private stepWyrm(world: IWorld, dt: number): void {
    const wyrm = this.wyrmId >= 0 ? world.entities.get(this.wyrmId) : undefined;
    const bellowing = !!wyrm && wyrm.castingAbility === KNELLWYRM_DREAD_BELLOW;
    this.bellow.group.visible = bellowing;
    if (wyrm && bellowing) {
      const gy = this.groundY(wyrm.pos.x, wyrm.pos.z);
      this.kit.layOutFan(this.bellow, 360, {
        color: TELEGRAPH_THREAT_COLORS.danger,
        accent: TELEGRAPH_ACCENTS.shadow,
      });
      this.kit.drapeFan(
        this.bellow,
        this.groundY,
        wyrm.pos.x,
        gy,
        wyrm.pos.z,
        0,
        KNELLWYRM_TUNING.bellowRadius,
      );
      this.kit.paintFan(this.bellow, {
        fill: telegraphFillOf(wyrm.castRemaining, wyrm.castTotal),
        clock: this.clock,
        range: KNELLWYRM_TUNING.bellowRadius,
      });
    }
    if (!wyrm || wyrm.castingAbility !== KNELLWYRM_STRAFE_RUN) return;
    // The run: fire poured from the jaws down onto the lane under and behind it
    // (the Strafe clip's plunged jaws, 4.4 yd ahead and 5.9 up at authored size).
    const s = wyrm.scale || 1;
    const jx = wyrm.pos.x + Math.sin(wyrm.facing) * 4.4 * s;
    const jz = wyrm.pos.z + Math.cos(wyrm.facing) * 4.4 * s;
    const jy = wyrm.pos.y + 5.9 * s;
    const n = 260 * this.density * dt;
    for (let i = 0; i < Math.floor(n + this.rand()); i++) {
      const tx = jx + (this.rand() - 0.5) * 4;
      const tz = jz + (this.rand() - 0.5) * 4;
      const gy = this.groundY(tx, tz);
      const flight = 0.35 + this.rand() * 0.15;
      this.fire.emit(this.clock, {
        x: jx,
        y: jy,
        z: jz,
        vx: (tx - jx) / flight,
        vy: (gy - jy) / flight,
        vz: (tz - jz) / flight,
        ay: 2,
        life: flight + 0.4 + this.rand() * 0.3,
        drag: 0.3,
        floor: gy + 0.2,
        size0: 0.5,
        size1: 2.4 + this.rand() * 1.8,
        r: 1.05 + this.rand() * 0.2,
        g: 0,
        b: 0,
        a: 0.9,
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
