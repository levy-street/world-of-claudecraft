// Vael's staging on the Beacon Crown (plan: bastion_vael_stage_core.ts), read
// off mirrored entity state and his spellfx cues so offline and online look the
// same:
//  - his entrance: at every rise out of the roof a column of green soul fire
//    erupts round him, a shockwave of fog races out over the flags, a flash
//    blooms and debris flies; the last rise, at his own place, is the biggest
//    and shakes the camera (reduced motion: no shake);
//  - the fog gathering before each Fog Veil: a wall of fog rolls in off the
//    rim and tightens onto the crown's heart over the Gathering Fog bar and
//    his sink, darkening as it closes, while a green glow builds on his body;
//    it clears as the four figures rise;
//  - the Shadow Crossing's scythe: an impact flash where the blade lands at
//    every step of the chain, and a jolt for whoever stands near.
//
// Rules (src/render/CLAUDE.md): every mesh and material is built once in the
// constructor under the Bastion telegraph root (compile-gated by BastionFx),
// no per-frame allocation. Nothing here carries an outcome (the cast bars, the
// pools and the yells do): the fog vortex draws on every tier (it is the
// veil's warning beat); the pillar, shockwave, flashes and debris are
// cosmetic and shed on the low tier.

import * as THREE from 'three';
import {
  VAEL_ID,
  VAEL_INTRO_RISE,
  VAEL_REAPING_SCYTHE,
  VAEL_SINK,
  VAEL_VEIL_GATHER,
} from '../../sim/encounters/sunken_bastion/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import { radialGlowTexture } from '../textures';
import { bastionSlotOrigin, CROWN } from './bastion_boss_fx_core';
import { BastionParticles } from './bastion_particles';
import {
  ERUPTION_SECONDS,
  eruptionFlash,
  eruptionPillar,
  eruptionShake,
  eruptionShockwave,
  FLASH_SECONDS,
  GATHER_FADE_SECONDS,
  gatherGlow,
  gatherProgress,
  gatherVortex,
  isVaelHome,
  SWEEP_FLASH_SECONDS,
  sweepFlash,
} from './bastion_vael_stage_core';

const ERUPTION_SLOTS = 2;
const SWEEP_SLOTS = 3;
const SCAN_SEC = 0.1;

const PILLAR_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * wocCamRelView(w.xyz);
}
`;

// The soul-fire column: green flame tongues racing up its skin, brightest at
// its silhouette and white-hot at the root, so the figure rising inside it
// stays readable through its heart; ragged and fading toward the top.
const PILLAR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float h = vUv.y;
  float n = noise(vec2(vUv.x * 9.0, h * 3.0 - uTime * 4.5));
  float n2 = noise(vec2(vUv.x * 21.0 + 3.0, h * 7.0 - uTime * 7.0));
  float tongues = smoothstep(0.3, 0.9, n * 0.7 + n2 * 0.5 - h * 0.45);
  float root = 1.0 - smoothstep(0.0, 0.22, h);
  vec3 view = normalize(cameraPosition - vWorld);
  float rim = 1.0 - abs(dot(normalize(vNormalW), view));
  rim = rim * rim;
  vec3 soul = vec3(0.3, 0.95, 0.62);
  vec3 hot = vec3(0.85, 1.0, 0.92);
  vec3 col = mix(soul, hot, root * 0.7 + n2 * 0.15);
  float body = tongues * (0.25 + 1.25 * rim) + root * 0.75;
  float i = body * (1.0 - smoothstep(0.55, 1.0, h)) * uAlpha;
  gl_FragColor = vec4(col * i, i);
  #include <colorspace_fragment>
}
`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The shockwave over the flags: a bright leading edge of soul light trailing
// a band of churned fog.
const SHOCK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float edge = smoothstep(0.78, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r));
  float band = smoothstep(0.45, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
  float wobble = 0.75 + 0.25 * sin(atan(c.y, c.x) * 14.0 + uTime * 9.0);
  vec3 col = vec3(0.55, 1.0, 0.8) * edge * 2.4 + vec3(0.4, 0.62, 0.55) * band * 0.8;
  float a = (edge * 1.5 * wobble + band * 0.5) * uAlpha;
  gl_FragColor = vec4(col * uAlpha, a);
  #include <colorspace_fragment>
}
`;

// The gathering fog: a wall of grey-green sea fog wheeling round the crown,
// streaked toward its heart, dense at the closing edge, darker inside.
const VORTEX_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uInner;
uniform float uSwirl;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float a = atan(c.y, c.x);
  float spiral = a * 3.0 + r * 9.0 - uTime * uSwirl * 2.4;
  float n = noise(vec2(cos(spiral), sin(spiral)) * 2.2 + r * 5.0 - uTime * 0.6);
  float n2 = noise(vec2(a * 5.0 + uTime * uSwirl, r * 12.0 - uTime * 3.0));
  float wall = smoothstep(uInner - 0.08, uInner + 0.06, r);
  float front = smoothstep(uInner - 0.04, uInner + 0.02, r) * (1.0 - smoothstep(uInner + 0.02, uInner + 0.2, r));
  float rimFade = 1.0 - smoothstep(0.86, 1.0, r);
  vec3 dark = vec3(0.012, 0.03, 0.028);
  vec3 fog = vec3(0.2, 0.27, 0.25);
  // Darker toward the closing edge: the fog is heaviest where it is coming in.
  vec3 col = mix(dark, fog, (0.25 + 0.55 * n) * (0.55 + 0.45 * r));
  col += vec3(0.25, 0.75, 0.5) * front * (0.35 + 0.65 * n2) * 0.7;
  float alpha = wall * rimFade * (0.62 + 0.3 * n + 0.2 * n2) + front * 0.35;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uAlpha);
  #include <colorspace_fragment>
}
`;

interface EruptionSlot {
  age: number;
  home: boolean;
  x: number;
  y: number;
  z: number;
  pillar: THREE.Mesh;
  pillarMat: THREE.ShaderMaterial;
  shock: THREE.Mesh;
  shockMat: THREE.ShaderMaterial;
  flash: THREE.Sprite;
  flashMat: THREE.SpriteMaterial;
}

interface SweepSlot {
  age: number;
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
}

export class BastionVaelStageFx {
  private readonly root = new THREE.Group();
  private readonly fx: BastionParticles;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly eruptions: EruptionSlot[] = [];
  private readonly sweeps: SweepSlot[] = [];
  private readonly vortex: THREE.Mesh;
  private readonly vortexMat: THREE.ShaderMaterial;
  private readonly aura: THREE.Sprite;
  private readonly auraMat: THREE.SpriteMaterial;
  /** The gathering Vael (and how far into the gathering), else -1. */
  private gatherId = -1;
  private gatherAge = 0;
  private gatherFade = 0;
  private gatherAt = { x: 0, y: 0, z: 0 };
  private gatherCrown = { x: 0, y: 0, z: 0 };
  private scan = 0;
  private clock = 0;

  constructor(
    parent: THREE.Group,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world: IWorld | undefined,
    private readonly cosmetic: boolean,
    private readonly shake?: (amount: number) => void,
    private readonly reducedMotion?: () => boolean,
  ) {
    this.root.name = 'sunken-bastion-vael-stage-fx';
    parent.add(this.root);
    this.fx = new BastionParticles(this.root, cosmetic);
    const glowTex = radialGlowTexture();
    // The gathering fog's disc over the whole crown (every tier).
    const disc = new THREE.PlaneGeometry(2, 2);
    disc.rotateX(-Math.PI / 2);
    this.geometries.push(disc);
    this.vortexMat = new THREE.ShaderMaterial({
      name: 'sunkenBastionGatherVortex',
      vertexShader: RING_VERT,
      fragmentShader: VORTEX_FRAG,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uAlpha: { value: 0 },
        uInner: { value: 1 },
        uSwirl: { value: 0.4 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.materials.push(this.vortexMat);
    this.vortex = new THREE.Mesh(disc, this.vortexMat);
    this.vortex.visible = false;
    this.vortex.frustumCulled = false;
    this.vortex.renderOrder = floorVfxRenderOrder('encounter', 12);
    this.root.add(this.vortex);
    // The green glow building on him while the fog gathers (every tier).
    this.auraMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0x8dffc0,
      opacity: 0,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(this.auraMat);
    this.aura = new THREE.Sprite(this.auraMat);
    this.aura.visible = false;
    this.root.add(this.aura);
    if (!cosmetic) return;
    // The entrance's eruptions (cosmetic: he is untouchable through it).
    const column = new THREE.CylinderGeometry(1, 1.15, 1, 28, 6, true);
    column.translate(0, 0.5, 0);
    this.geometries.push(column);
    for (let i = 0; i < ERUPTION_SLOTS; i++) {
      const pillarMat = new THREE.ShaderMaterial({
        name: 'sunkenBastionVaelPillar',
        vertexShader: PILLAR_VERT,
        fragmentShader: PILLAR_FRAG,
        uniforms: { uTime: sharedUniforms.uTime, uAlpha: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      const shockMat = new THREE.ShaderMaterial({
        name: 'sunkenBastionVaelShock',
        vertexShader: RING_VERT,
        fragmentShader: SHOCK_FRAG,
        uniforms: { uTime: sharedUniforms.uTime, uAlpha: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      const flashMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xd8ffe8,
        opacity: 0,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.materials.push(pillarMat, shockMat, flashMat);
      const pillar = new THREE.Mesh(column, pillarMat);
      const shock = new THREE.Mesh(disc, shockMat);
      const flash = new THREE.Sprite(flashMat);
      pillar.renderOrder = floorVfxRenderOrder('encounter', 3);
      shock.renderOrder = floorVfxRenderOrder('encounter', 13);
      for (const o of [pillar, shock, flash]) {
        o.visible = false;
        o.frustumCulled = false;
        this.root.add(o);
      }
      this.eruptions.push({
        age: -1,
        home: false,
        x: 0,
        y: 0,
        z: 0,
        pillar,
        pillarMat,
        shock,
        shockMat,
        flash,
        flashMat,
      });
    }
    for (let i = 0; i < SWEEP_SLOTS; i++) {
      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xc8ffe4,
        opacity: 0,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.materials.push(mat);
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.root.add(sprite);
      this.sweeps.push({ age: -1, sprite, mat });
    }
  }

  private quake(amount: number, x: number, z: number): void {
    if (!this.shake || this.reducedMotion?.() || !this.world) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    // Felt across the crown, fading with distance.
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    const k = Math.max(0, 1 - d / 45);
    if (k > 0.05) this.shake(amount * k);
  }

  /** Claims nothing (the reaper's smoke and the scythe's trail still draw);
   *  only adds the staging on top of his cues. */
  handleEvent(ev: SimEvent): void {
    if (ev.type !== 'spellfx' || !this.world) return;
    const src = this.world.entities.get(ev.sourceId);
    if (!src || src.templateId !== VAEL_ID) {
      if (ev.ability === VAEL_REAPING_SCYTHE && src)
        this.sweepImpact(src.pos.x, src.pos.z, src.facing);
      return;
    }
    if (ev.ability === VAEL_INTRO_RISE) {
      const o = bastionSlotOrigin(src.pos.x, src.pos.z);
      this.erupt(src.pos.x, src.pos.z, isVaelHome(src.pos.x - o.x, src.pos.z - o.z));
    } else if (ev.ability === VAEL_REAPING_SCYTHE) {
      this.sweepImpact(src.pos.x, src.pos.z, src.facing);
    } else if (ev.ability === VAEL_SINK && this.cosmetic) {
      const y = this.groundY(src.pos.x, src.pos.z);
      // The flags close over him: a ring of black water slapping shut.
      this.fx.burst(src.pos.x, y + 0.2, src.pos.z, 0x0a1210, 10, 0.8, 3.6, 0.8, 0.4, 3.2, true);
      this.fx.burst(src.pos.x, y + 4, src.pos.z, 0x9dffd0, 6, 0.5, 2.2, 1.0, -2.5, 0.6);
    }
  }

  /** A rise out of the roof: pillar, shockwave, flash, debris, and a jolt. */
  private erupt(x: number, z: number, home: boolean): void {
    const y = this.groundY(x, z);
    this.quake(eruptionShake(home), x, z);
    if (!this.cosmetic) return;
    let slot = this.eruptions.find((s) => s.age < 0);
    if (!slot) {
      slot = this.eruptions[0];
      for (const s of this.eruptions) if (s.age > slot.age) slot = s;
    }
    slot.age = 0;
    slot.home = home;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.pillar.visible = slot.shock.visible = slot.flash.visible = true;
    // The flags burst open: flagstone chips, black water, a column of souls.
    this.fx.chunksAt(x, y + 0.3, z, y, 0x3c4440, home ? 14 : 8, home ? 9 : 6, 0.9);
    this.fx.burst(x, y + 0.2, z, 0x0b1412, home ? 14 : 9, 1.4, 5.2, 1.1, 0.8, home ? 6 : 4, true);
    this.fx.burst(x, y + 1.0, z, 0x9dffd0, home ? 14 : 8, 0.6, 2.4, 1.4, home ? 9 : 6, 1.2);
    this.fx.burst(x, y + 0.6, z, 0x6f817b, home ? 10 : 6, 2.4, 7.5, 2.0, 0.6, home ? 5 : 3.2, true);
  }

  /** Where the blade lands at a step of the chain: a flash and a spray of souls. */
  private sweepImpact(x: number, z: number, facing: number): void {
    const y = this.groundY(x, z);
    const bx = x + Math.sin(facing) * 3.5;
    const bz = z + Math.cos(facing) * 3.5;
    this.quake(0.22, bx, bz);
    if (!this.cosmetic) return;
    const slot = this.sweeps.find((s) => s.age < 0) ?? this.sweeps[0];
    slot.age = 0;
    slot.sprite.position.set(bx, y + 1.6, bz);
    slot.sprite.visible = true;
    this.fx.burst(bx, y + 1.2, bz, 0xb8ffe0, 10, 0.35, 1.8, 0.6, 1.4, 5.5);
    this.fx.burst(bx, y + 0.3, bz, 0x1a0f24, 6, 1.2, 3.6, 0.8, 0.5, 3, true);
  }

  update(dt: number): void {
    const world = this.world;
    if (!world) return;
    this.clock += dt;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.findGatherer(world);
    }
    this.updateGather(world, dt);
    this.updateEruptions(dt);
    for (const s of this.sweeps) {
      if (s.age < 0) continue;
      s.age += dt;
      if (s.age >= SWEEP_FLASH_SECONDS) {
        s.age = -1;
        s.sprite.visible = false;
        continue;
      }
      const k = sweepFlash(s.age);
      s.mat.opacity = k;
      const size = 4 + 7 * (1 - k);
      s.sprite.scale.set(size, size, 1);
    }
    this.fx.update(dt);
  }

  /** The Vael whose fog is gathering (the bar, then the sink that follows it). */
  private findGatherer(world: IWorld): void {
    if (this.gatherId >= 0) {
      const e = world.entities.get(this.gatherId);
      if (e && !e.dead && (e.castingAbility === VAEL_VEIL_GATHER || e.castingAbility === VAEL_SINK))
        return;
    }
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.dead || e.templateId !== VAEL_ID) continue;
      if (e.castingAbility !== VAEL_VEIL_GATHER) continue;
      this.gatherId = e.id;
      this.gatherAge = Math.max(0, e.castTotal - e.castRemaining);
      const o = bastionSlotOrigin(e.pos.x, e.pos.z);
      this.gatherCrown.x = o.x + CROWN.x;
      this.gatherCrown.z = o.z + CROWN.z;
      this.gatherCrown.y = this.groundY(o.x + CROWN.x + CROWN.r * 0.6, o.z + CROWN.z);
      return;
    }
    this.gatherId = -1;
  }

  private updateGather(world: IWorld, dt: number): void {
    const e = this.gatherId >= 0 ? world.entities.get(this.gatherId) : undefined;
    const live =
      !!e && !e.dead && (e.castingAbility === VAEL_VEIL_GATHER || e.castingAbility === VAEL_SINK);
    if (live && e) {
      this.gatherAge += dt;
      this.gatherFade = 1;
      this.gatherAt.x = e.pos.x;
      this.gatherAt.y = e.pos.y;
      this.gatherAt.z = e.pos.z;
      // A breath of fog rolling in off the rim toward him.
      if (this.cosmetic && this.fx.rand() < dt * 10) {
        const a = this.fx.rand() * Math.PI * 2;
        const r = CROWN.r - 2 - this.fx.rand() * 4;
        this.fx.burst(
          this.gatherCrown.x + Math.sin(a) * r,
          this.gatherCrown.y + 0.6,
          this.gatherCrown.z + Math.cos(a) * r,
          0x6f817b,
          1,
          2.5,
          6,
          1.6,
          0.4,
          0,
          true,
        );
      }
    } else if (this.gatherFade > 0) {
      this.gatherFade = Math.max(0, this.gatherFade - dt / GATHER_FADE_SECONDS);
      if (this.gatherFade <= 0) this.gatherId = -1;
    }
    const on = this.gatherFade > 0;
    this.vortex.visible = on;
    this.aura.visible = on;
    if (!on) return;
    const p = gatherProgress(this.gatherAge);
    const v = gatherVortex(p);
    this.vortex.position.set(this.gatherCrown.x, this.gatherCrown.y + 0.12, this.gatherCrown.z);
    this.vortex.scale.set(v.outer, 1, v.outer);
    this.vortex.rotation.y = this.clock * 0.15;
    this.vortexMat.uniforms.uAlpha.value = v.alpha * this.gatherFade;
    this.vortexMat.uniforms.uInner.value = v.inner / v.outer;
    this.vortexMat.uniforms.uSwirl.value = v.swirl;
    const g = gatherGlow(p) * this.gatherFade;
    this.auraMat.opacity = Math.min(1, g * (0.85 + 0.15 * Math.sin(this.clock * 12)));
    const size = 5 + 9 * g;
    this.aura.scale.set(size, size * 1.4, 1);
    this.aura.position.set(this.gatherAt.x, this.gatherAt.y + 3.4, this.gatherAt.z);
  }

  private updateEruptions(dt: number): void {
    for (const s of this.eruptions) {
      if (s.age < 0) continue;
      s.age += dt;
      if (s.age >= ERUPTION_SECONDS) {
        s.age = -1;
        s.pillar.visible = s.shock.visible = s.flash.visible = false;
        continue;
      }
      const p = eruptionPillar(s.age, s.home);
      s.pillarMat.uniforms.uAlpha.value = p.alpha;
      s.pillar.position.set(s.x, s.y, s.z);
      s.pillar.scale.set(p.radius, Math.max(0.01, p.height), p.radius);
      s.pillar.visible = p.alpha > 0.01;
      const w = eruptionShockwave(s.age, s.home);
      s.shock.visible = w.alpha > 0.01;
      s.shock.position.set(s.x, s.y + 0.1, s.z);
      s.shock.scale.set(w.radius, 1, w.radius);
      s.shockMat.uniforms.uAlpha.value = w.alpha;
      const f = eruptionFlash(s.age, s.home);
      s.flash.visible = s.age < FLASH_SECONDS && f > 0.01;
      s.flashMat.opacity = Math.min(1, f);
      const size = (s.home ? 38 : 24) * (0.6 + 0.4 * (s.age / FLASH_SECONDS));
      s.flash.scale.set(size, size, 1);
      s.flash.position.set(s.x, s.y + 3, s.z);
      // Souls streaming up the column while it burns.
      if (p.alpha > 0.3 && this.fx.rand() < dt * (s.home ? 30 : 18)) {
        const a = this.fx.rand() * Math.PI * 2;
        const r = p.radius * (0.5 + this.fx.rand() * 0.6);
        this.fx.burst(
          s.x + Math.sin(a) * r,
          s.y + this.fx.rand() * 2,
          s.z + Math.cos(a) * r,
          0xb8ffe0,
          1,
          0.3,
          1.0,
          1.1,
          s.home ? 11 : 7,
        );
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.fx.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
