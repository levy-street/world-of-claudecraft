// The Tideglass Colossus's Tideglass Fracture on the Prism Terrace (sim:
// src/sim/encounters/drowned_temple/tideglass_fracture.ts), composed by
// temple_fx.ts:
//  - the floor splits into eight slices of sea-glass round the terrace centre,
//    violet light running along the seams while the bar opens;
//  - each round the doomed slices turn to RED prism glass that charges from
//    the centre outward, its cracks blazing and its pulse quickening, while
//    the safe slices run CLEAR (transparent glass, a silver rim and caustics);
//  - on detonation a red slice flashes white-hot, a column of prism light
//    bursts up from it and shards of crystal fly, with a camera kick for a
//    player standing on the terrace.
// The slice footprint (red or clear, the charge) is ACTIONABLE and draws on
// every tier; only the motes, shards and the light columns shed density on
// the low tier.
//
// State is read off IWorld only: the eight slice objects (their template says
// crack, red or safe; their facing which slice) and the Colossus's channel bar
// (fx core fractureClock: the round and its charge), plus the burst cues.
// Rules (src/render/CLAUDE.md): every mesh and material is built once here,
// under the gated temple root and collapsed until that gate has linked them;
// after it the whole layer is hidden while no fracture is in range (no idle
// draws anywhere in the world). No lights; the idle frame allocates nothing
// (a live burst's particle specs are short-lived literals, as in the crypt and
// Ysolei layers). Reduced motion holds the warning pulse and the flash down.
// The hub under the plinth detonates every round, so it always reads red.

import * as THREE from 'three';
import {
  COLOSSUS_ID,
  COLOSSUS_TIDEGLASS_FRACTURE,
  COLOSSUS_TUNING,
  FRACTURE_BURST,
  FRACTURE_HUB,
  FRACTURE_REACH,
  FRACTURE_SLICES,
  fractureSliceYaw,
  fractureStateOf,
} from '../../sim/encounters/drowned_temple/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  DUST_FRAG,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
} from '../hollow_crypt/crypt_fx_particles';
import { type FractureSliceLook, fractureClock, fractureSliceLook } from './temple_fx_core';

const COLLAPSED = 1e-4;
const SCAN_SEC = 0.25;
const HALF = Math.PI / FRACTURE_SLICES;
/** A light column's height (yards) at its burst. */
const COLUMN_H = 14;

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
`;

const SLICE_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// One slice of prism glass. Its local frame: +z out along the slice's middle
// heading, x across it; the slice spans +-HALF about +z out to uReach.
const SLICE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uReach;
uniform float uHalf;
uniform float uHub;
uniform float uHeat;
uniform float uClear;
uniform float uCrack;
uniform float uPulse;
uniform float uCharge;
uniform float uFlash;
uniform float uFade;
varying vec3 vLocal;
${NOISE}
void main() {
  vec2 p = vLocal.xz;
  float r = length(p);
  float a = atan(p.x, p.y);
  float rn = r / uReach;
  // Yards to the nearest seam (the slice's sides and its outer rim).
  float side = (uHalf - abs(a)) * max(r, 0.001);
  float seamD = min(side, uReach - r);
  float seam = 1.0 - smoothstep(0.0, 0.32, seamD);
  float halo = 1.0 - smoothstep(0.0, 1.6, seamD);
  // Facets of cut glass: two noise layers folded into crack lines.
  float n1 = vnoise(p * 0.42 + 11.0);
  float n2 = vnoise(p * 1.15 - 4.0);
  float crackLine = 1.0 - smoothstep(0.0, 0.05, abs(n1 - 0.5) * (0.8 + 0.6 * n2));
  float facet = smoothstep(0.35, 0.65, n2);
  vec3 violet = vec3(0.72, 0.6, 1.0);
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // The crack (the bar opening): dark glass, violet seams and cracks growing.
  float grow = uCrack * smoothstep(0.0, 1.0, 1.0 - rn + uCrack * 0.6);
  col += violet * (seam * 1.4 + crackLine * grow * 0.9);
  alpha = max(alpha, uCrack * (0.12 + 0.5 * seam + 0.45 * crackLine * grow));

  // RED: crimson prism glass charging from the centre outward.
  if (uHeat > 0.0) {
    float pulse = 0.72 + 0.28 * sin(uTime * uPulse * 6.2832);
    float filled = 1.0 - smoothstep(uCharge - 0.04, uCharge + 0.01, rn);
    float front = (1.0 - smoothstep(0.0, 0.05, abs(rn - uCharge))) * step(0.02, uCharge);
    vec3 deep = mix(vec3(0.42, 0.02, 0.08), vec3(0.95, 0.12, 0.2), facet);
    // Saturated to the end: the doomed glass must never pale toward the
    // clear glass's white as it charges.
    vec3 hot = vec3(1.0, 0.1, 0.12);
    vec3 red = mix(deep, hot, filled * uHeat * 0.8);
    red += vec3(1.0, 0.45, 0.4) * crackLine * (0.4 + 0.9 * uHeat) * pulse;
    red += vec3(1.0, 0.75, 0.7) * front * 1.4;
    red += vec3(1.0, 0.25, 0.3) * seam * 1.3;
    col = mix(col, red * (0.75 + 0.45 * pulse), 1.0);
    alpha = max(alpha, (0.42 + 0.38 * uHeat) * (0.55 + 0.45 * filled) + 0.5 * seam + front * 0.4);
  }

  // CLEAR: transparent sea-glass, a silver rim, caustics swimming in it.
  if (uClear > 0.0) {
    float c1 = vnoise(p * 0.55 + vec2(uTime * 0.35, -uTime * 0.22));
    float c2 = vnoise(p * 1.4 - vec2(uTime * 0.5, uTime * 0.3));
    float caustic = pow(max(1.0 - abs(c1 + c2 - 1.0), 0.0), 6.0);
    vec3 glass = mix(vec3(0.55, 0.9, 1.0), vec3(0.92, 0.98, 1.0), caustic);
    vec3 clear = glass * (0.35 + 0.9 * caustic) + vec3(0.85, 0.95, 1.0) * (seam * 1.6 + halo * 0.25);
    col = mix(col, clear, uClear);
    alpha = mix(alpha, 0.08 + 0.22 * caustic + 0.6 * seam + 0.12 * halo, uClear);
  }

  // The detonation's white-hot flash.
  // The hub under the plinth detonates every round: always red while a round
  // is painted, whatever its slice shows.
  float hub = (1.0 - smoothstep(uHub - 0.2, uHub, r)) * step(0.001, uClear + uHeat);
  vec3 hubRed = vec3(0.95, 0.08, 0.12) * (0.85 + 0.3 * crackLine);
  col = mix(col, hubRed, hub);
  alpha = max(alpha, 0.8 * hub);

  // The detonation's white-hot flash, brightest along the cracks; short, so
  // the next round's colours read at once.
  col = mix(col, vec3(1.0, 0.93, 0.96), uFlash * (0.45 + 0.4 * crackLine));
  alpha = max(alpha, uFlash * (0.45 + 0.4 * crackLine));
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uFade);
  #include <colorspace_fragment>
}
`;

const COLUMN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The column of prism light a detonating slice throws up: additive, bright at
// the foot, streaked upward.
const COLUMN_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
${NOISE}
void main() {
  float streak = vnoise(vec2(vUv.x * 28.0, vUv.y * 3.0 - uTime * 6.0));
  float foot = 1.0 - smoothstep(0.0, 1.0, vUv.y);
  vec3 col = mix(vec3(1.0, 0.35, 0.45), vec3(0.85, 0.75, 1.0), vUv.y);
  col = mix(col, vec3(1.0), foot * 0.5);
  gl_FragColor = vec4(col * (0.8 + 0.8 * streak), uAlpha * foot * (0.35 + 0.65 * streak));
  #include <colorspace_fragment>
}
`;

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;

interface SliceUniforms {
  uTime: { value: number };
  uReach: { value: number };
  uHalf: { value: number };
  uHub: { value: number };
  uHeat: { value: number };
  uClear: { value: number };
  uCrack: { value: number };
  uPulse: { value: number };
  uCharge: { value: number };
  uFlash: { value: number };
  uFade: { value: number };
}

interface Slice {
  mesh: THREE.Mesh;
  uniforms: SliceUniforms;
  column: THREE.Mesh;
  columnAlpha: { value: number };
  objectId: number;
  flash: number;
  columnAge: number;
}

export class TempleFractureFx {
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly slices: Slice[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly glow: ParticlePool;
  private readonly dust: ParticlePool;
  private readonly density: number;
  private scan = 0;
  private seed = 11;
  private debt = 0;
  private bossId: number | null = null;
  private shookRound = -2;
  private rosterSeen = -1;
  private gated = false;
  private readonly clockNow = { round: -1, charge: 0 };
  private readonly look: FractureSliceLook = { heat: 0, clear: 0, crack: 0, pulse: 0 };

  constructor(
    parent: THREE.Group,
    private readonly world: IWorld | undefined,
    private readonly groundY: (x: number, z: number) => number,
    detail: boolean,
    private readonly shake?: (amount: number) => void,
    private readonly calm: () => boolean = () => false,
  ) {
    this.root.name = 'drowned-temple-fracture-fx';
    parent.add(this.root);
    this.density = detail ? 1 : 0.35;
    const particleMat = (frag: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime },
        vertexShader: PARTICLE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      return m;
    };
    this.glow = new ParticlePool(
      Math.round(1600 * this.density),
      particleMat(GLOW_FRAG, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 6),
    );
    this.dust = new ParticlePool(
      Math.round(500 * this.density),
      particleMat(DUST_FRAG, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 5),
    );
    this.root.add(this.glow.mesh, this.dust.mesh);

    // One slice's sector, laid flat with its middle heading on local +z:
    // CircleGeometry's theta runs in XY from +x; after the -90 degree turn
    // about x, theta = -PI/2 points along +z.
    const sector = new THREE.CircleGeometry(FRACTURE_REACH, 28, -Math.PI / 2 - HALF, HALF * 2);
    sector.rotateX(-Math.PI / 2);
    this.geometries.push(sector);
    const columnGeo = new THREE.CylinderGeometry(1, 1.4, 1, 24, 1, true).translate(0, 0.5, 0);
    this.geometries.push(columnGeo);
    for (let i = 0; i < FRACTURE_SLICES; i++) {
      const uniforms: SliceUniforms = {
        uTime: this.uTime,
        uReach: { value: FRACTURE_REACH },
        uHalf: { value: HALF },
        uHub: { value: FRACTURE_HUB },
        uHeat: { value: 0 },
        uClear: { value: 0 },
        uCrack: { value: 0 },
        uPulse: { value: 0 },
        uCharge: { value: 0 },
        uFlash: { value: 0 },
        uFade: { value: 0 },
      };
      const m = new THREE.ShaderMaterial({
        uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
        vertexShader: SLICE_VERT,
        fragmentShader: SLICE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(m);
      const mesh = new THREE.Mesh(sector, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 1);
      mesh.scale.setScalar(COLLAPSED);
      this.root.add(mesh);
      const columnAlpha = { value: 0 };
      const cm = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime, uAlpha: columnAlpha },
        vertexShader: COLUMN_VERT,
        fragmentShader: COLUMN_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.materials.push(cm);
      const column = new THREE.Mesh(columnGeo, cm);
      column.frustumCulled = false;
      column.renderOrder = floorVfxRenderOrder('encounter', 7);
      column.scale.setScalar(COLLAPSED);
      this.root.add(column);
      this.slices.push({
        mesh,
        uniforms,
        column,
        columnAlpha,
        objectId: -1,
        flash: 0,
        columnAge: -1,
      });
    }
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Which slice index a slice object stands for (its facing). */
  private indexOf(facing: number): number {
    const step = (Math.PI * 2) / FRACTURE_SLICES;
    return ((Math.round(facing / step) % FRACTURE_SLICES) + FRACTURE_SLICES) % FRACTURE_SLICES;
  }

  /** The temple root's gate has linked every program: idle, hide the layer. */
  markGated(): void {
    this.gated = true;
  }

  private rescan(): void {
    const world = this.world;
    // The slice objects come and go with the roster: walk it only on a change.
    if (!world || world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const s of this.slices) s.objectId = -1;
    let any = false;
    for (const e of world.entities.values()) {
      if (fractureStateOf(e.templateId) === null) continue;
      this.slices[this.indexOf(e.facing)].objectId = e.id;
      any = true;
    }
    if (!any) return;
    // The Colossus whose channel times the rounds (the nearest one).
    let best: EntityView | null = null;
    let bestD = Infinity;
    let anchorId = -1;
    for (const s of this.slices) if (anchorId < 0 && s.objectId >= 0) anchorId = s.objectId;
    const anchor = world.entities.get(anchorId);
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== COLOSSUS_ID || !anchor) continue;
      const d = Math.hypot(e.pos.x - anchor.pos.x, e.pos.z - anchor.pos.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    this.bossId = best?.id ?? null;
  }

  /** True when the cue is the fracture's (the renderer skips its generic draw). */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx' || ev.ability !== FRACTURE_BURST) return false;
    const slice = this.slices.find((s) => s.objectId === ev.targetId);
    const obj = this.world?.entities.get(ev.targetId);
    if (slice && obj) this.detonate(slice, obj);
    return true;
  }

  private detonate(slice: Slice, obj: EntityView): void {
    slice.flash = 1;
    slice.columnAge = 0;
    const i = this.slices.indexOf(slice);
    const yaw = fractureSliceYaw(i);
    const y = this.groundY(obj.pos.x, obj.pos.z);
    const n = Math.round(70 * this.density);
    for (let k = 0; k < n; k++) {
      const a = yaw + (this.rand() * 2 - 1) * HALF * 0.9;
      const r = 2 + this.rand() * (FRACTURE_REACH - 3);
      const x = obj.pos.x + Math.sin(a) * r;
      const z = obj.pos.z + Math.cos(a) * r;
      const hot = this.rand();
      this.glow.emit(this.uTime.value, {
        x,
        y: y + 0.2,
        z,
        vx: (this.rand() - 0.5) * 5,
        vy: 7 + this.rand() * 12,
        vz: (this.rand() - 0.5) * 5,
        ay: -16,
        drag: 0.8,
        life: 0.8 + this.rand() * 0.6,
        size0: 0.55 + this.rand() * 0.5,
        size1: 0.15,
        spin: 6,
        r: 1,
        g: 0.3 + 0.55 * hot,
        b: 0.4 + 0.6 * hot,
        a: 1,
      });
    }
    const d = Math.round(26 * this.density);
    for (let k = 0; k < d; k++) {
      const a = yaw + (this.rand() * 2 - 1) * HALF;
      const r = 3 + this.rand() * (FRACTURE_REACH - 4);
      this.dust.emit(this.uTime.value, {
        x: obj.pos.x + Math.sin(a) * r,
        y: y + 0.4,
        z: obj.pos.z + Math.cos(a) * r,
        vx: 0,
        vy: 2 + this.rand() * 2,
        vz: 0,
        drag: 0.5,
        life: 1.1 + this.rand() * 0.5,
        size0: 2.2,
        size1: 4.4,
        r: 0.95,
        g: 0.78,
        b: 0.92,
        a: 0.45,
      });
    }
    this.kick(obj);
  }

  /** One camera kick per round, harder for a player on the terrace. */
  private kick(obj: EntityView): void {
    const world = this.world;
    const b = this.bossId !== null ? world?.entities.get(this.bossId) : undefined;
    const round = b
      ? fractureClock(b.castTotal, b.castRemaining, COLOSSUS_TUNING.fractureCast).round
      : -1;
    if (!this.shake || round === this.shookRound) return;
    this.shookRound = round;
    const me = world?.entities.get(world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - obj.pos.x, me.pos.z - obj.pos.z);
    if (d <= FRACTURE_REACH) this.shake(0.42);
    else if (d <= FRACTURE_REACH + 25) this.shake(0.16);
  }

  update(dt: number, clock: number): void {
    this.uTime.value = clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.rescan();
    }
    const world = this.world;
    const b = this.bossId !== null ? world?.entities.get(this.bossId) : undefined;
    const channel = b && !b.dead && b.castingAbility === COLOSSUS_TIDEGLASS_FRACTURE;
    const clockNow = this.clockNow;
    if (channel)
      fractureClock(b.castTotal, b.castRemaining, COLOSSUS_TUNING.fractureCast, clockNow);
    else {
      clockNow.round = -1;
      clockNow.charge = 0;
      this.shookRound = -2;
    }
    const calm = this.calm();
    let busy = this.glow.lastDeath > clock || this.dust.lastDeath > clock;
    for (const s of this.slices) {
      s.flash = Math.max(0, s.flash - dt * 4);
      s.uniforms.uFlash.value = calm ? s.flash * 0.5 : s.flash;
      if (s.objectId >= 0 || s.flash > 0 || s.columnAge >= 0 || s.uniforms.uFade.value > 0.01)
        busy = true;
      this.stepColumn(s, dt);
      const obj = s.objectId >= 0 ? world?.entities.get(s.objectId) : undefined;
      const state = obj ? fractureStateOf(obj.templateId) : null;
      if (!obj || state === null) {
        s.uniforms.uFade.value = Math.max(0, s.uniforms.uFade.value - dt * 3);
        if (s.uniforms.uFade.value <= 0.01 && s.flash <= 0.01) s.mesh.scale.setScalar(COLLAPSED);
        continue;
      }
      const look = fractureSliceLook(state, clockNow.charge, calm, this.look);
      const u = s.uniforms;
      u.uFade.value = Math.min(1, u.uFade.value + dt * 4);
      u.uHeat.value = look.heat;
      u.uClear.value = look.clear;
      u.uCrack.value = look.crack;
      u.uPulse.value = look.pulse;
      u.uCharge.value = state === 'red' ? clockNow.charge : 0;
      s.mesh.scale.setScalar(1);
      s.mesh.position.set(obj.pos.x, this.groundY(obj.pos.x, obj.pos.z) + 0.07, obj.pos.z);
      s.mesh.rotation.y = fractureSliceYaw(this.slices.indexOf(s));
      if (state === 'red') this.motes(s, obj, dt, clockNow.charge);
    }
    this.glow.update(clock);
    this.dust.update(clock);
    // Until the gate has linked the layer it stays drawn (collapsed); after,
    // an idle layer is hidden so it costs no draw anywhere in the world.
    this.root.visible = !this.gated || busy;
  }

  /** Heat rising off a charging red slice, thicker as it nears detonation. */
  private motes(s: Slice, obj: EntityView, dt: number, charge: number): void {
    this.debt += (8 + 30 * charge) * this.density * dt;
    const yaw = fractureSliceYaw(this.slices.indexOf(s));
    const y = this.groundY(obj.pos.x, obj.pos.z);
    while (this.debt >= 1) {
      this.debt -= 1;
      const a = yaw + (this.rand() * 2 - 1) * HALF * 0.9;
      const r = 2 + this.rand() * (FRACTURE_REACH - 3) * Math.max(0.2, charge);
      this.glow.emit(this.uTime.value, {
        x: obj.pos.x + Math.sin(a) * r,
        y: y + 0.15,
        z: obj.pos.z + Math.cos(a) * r,
        vx: 0,
        vy: 1.5 + this.rand() * 2.5 + charge * 3,
        vz: 0,
        life: 0.7 + this.rand() * 0.5,
        size0: 0.35,
        size1: 0.6,
        r: 1,
        g: 0.32 + 0.3 * charge,
        b: 0.4,
        a: 0.85,
      });
    }
  }

  private stepColumn(s: Slice, dt: number): void {
    if (s.columnAge < 0) return;
    s.columnAge += dt;
    const k = Math.min(1, s.columnAge / 0.6);
    const obj = s.objectId >= 0 ? this.world?.entities.get(s.objectId) : undefined;
    if (k >= 1 || !obj) {
      s.columnAge = -1;
      s.columnAlpha.value = 0;
      s.column.scale.setScalar(COLLAPSED);
      return;
    }
    // The column stands on the slice's middle, two thirds of the way out.
    const yaw = fractureSliceYaw(this.slices.indexOf(s));
    const r = FRACTURE_REACH * 0.55;
    const x = obj.pos.x + Math.sin(yaw) * r;
    const z = obj.pos.z + Math.cos(yaw) * r;
    const rise = Math.min(1, k * 4);
    s.column.position.set(x, this.groundY(x, z), z);
    s.column.scale.set(
      FRACTURE_REACH * 0.16,
      Math.max(COLLAPSED, COLUMN_H * rise),
      FRACTURE_REACH * 0.16,
    );
    s.columnAlpha.value = (1 - k) * (1 - k);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.glow.dispose();
    this.dust.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
