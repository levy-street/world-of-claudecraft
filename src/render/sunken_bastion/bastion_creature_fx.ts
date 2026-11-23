// The Sunken Bastion's creature effects (plan: bastion_creature_fx_core.ts).
//
//  The Fogbound Arbalest
//  - Every shot it looses (the Rusted Bolt, and the Piercing Bolt down its
//    lane) flies as a real crossbow bolt: a pale fletched shaft with an iron
//    head lit with sea light, dragging a streak behind it, fast and flat.
//    At the loose the string snaps (a burst of light and sparks at the prod,
//    a puff of sea mist); where it lands it throws sparks and splinters. The
//    Piercing Bolt is heavier: a longer streak, a brighter head, and it flies
//    the whole lane the sim tests, leaving a fading tracer along it.
//  These bolts REPLACE the generic school-coloured projectile for this mob
//  (handleEvent claims the event), so the loose reads as a crossbow shot.
//
//  The Gaol Turnkey
//  - Open the Cells: the Turnkey raises its lantern (its LanternRaise clip,
//    played through the gesture hook) and the lantern flares: a hot amber
//    core in a wide halo, rays and embers thrown up out of it and a band of
//    lantern light racing out
//    over the floor. It replaces the generic nova for this mob.
//
//  The drowned (bastion_drowned_fx.ts) write their drips, sprays and death
//  gush into these same two particle draws.
//
// Rules (src/render/CLAUDE.md): everything is built once and pooled, rides
// the Bastion telegraph root (one compile gate), and nothing allocates per
// frame. Cosmetic only: the damage is already the sim's, so the particle
// budgets shed on the low effects tier; the bolts themselves draw on every
// tier (they replace a projectile that always drew).

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { MOBS } from '../../sim/data';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { VISUALS } from '../characters/manifest';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { GFX } from '../gfx';
import { tagVfxSubtree } from '../renderer_diagnostics';
import {
  ARBALEST,
  ARBALEST_MUZZLE,
  ARBALEST_RAW_HEIGHT,
  BASTION_OPEN_CELLS_GESTURE,
  BOLT_TARGET_CHEST,
  boltFlightSeconds,
  boltTrailLength,
  LANTERN_FLARE_DELAY,
  LANTERN_FLARE_SEC,
  lanternFlareEnvelope,
  modelPointWorld,
  modelScale,
  PIERCING_BOLT_SPEED,
  PIERCING_TRAIL,
  piercingBoltReach,
  RUSTED_BOLT_SPEED,
  RUSTED_TRAIL,
  TURNKEY,
  TURNKEY_LANTERN_HIGH,
  TURNKEY_RAW_HEIGHT,
} from './bastion_creature_fx_core';
import { BastionDrownedFx } from './bastion_drowned_fx';
import { BastionOrderFx } from './bastion_order_fx';
import { BastionTrashFx } from './bastion_trash_fx';

const BOLT_SLOTS = 8;
const FLARE_SLOTS = 3;
const SEA_LIGHT = new THREE.Color(0.45, 1.0, 0.85);
const LANTERN = new THREE.Color(1.0, 0.72, 0.32);

// ---------------------------------------------------------------- particles

const PARTICLE_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
uniform float uTime;
attribute vec3 aPos0;
attribute vec3 aVel;
attribute vec4 aLife;   // birth, life, gravity, stretch
attribute vec4 aShape;  // size0, size1, seed, kind (0 glow, 1 streak)
attribute vec4 aColor;
varying float vT;
varying vec4 vColor;
varying vec2 vUv;
varying float vKind;
void main() {
  float age = uTime - aLife.x;
  float t = age / max(aLife.y, 1e-3);
  vT = t;
  vColor = aColor;
  vUv = position.xy + 0.5;
  vKind = aShape.w;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float drag = 2.2;
  vec3 v = aVel * exp(-drag * age) + vec3(0.0, -aLife.z * age, 0.0);
  vec3 p = aPos0 + aVel * (1.0 - exp(-drag * age)) / drag - vec3(0.0, 0.5 * aLife.z * age * age, 0.0);
  float size = mix(aShape.x, aShape.y, t);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w;
  if (aShape.w > 0.5) {
    // A spark: a thin streak stretched along its screen-space velocity.
    vec3 sv = normalize(vec3(dot(v, camRight), dot(v, camUp), 0.0) + vec3(1e-4, 0.0, 0.0));
    vec3 along = camRight * sv.x + camUp * sv.y;
    vec3 across = camRight * -sv.y + camUp * sv.x;
    float len = size * (1.0 + aLife.w * length(v) * 0.08);
    w = p + along * position.y * len + across * position.x * size * 0.18;
  } else {
    w = p + (camRight * position.x + camUp * position.y) * size;
  }
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

const PARTICLE_FRAG = /* glsl */ `
varying float vT;
varying vec4 vColor;
varying vec2 vUv;
varying float vKind;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d * vec2(vKind > 0.5 ? 3.0 : 1.0, 1.0)) * 2.0;
  float core = pow(max(1.0 - r, 0.0), vKind > 0.5 ? 1.2 : 2.0);
  float fade = smoothstep(0.0, 0.06, vT) * (1.0 - smoothstep(0.45, 1.0, vT));
  gl_FragColor = vec4(vColor.rgb * (0.7 + 1.6 * core), core * fade * vColor.a);
}
`;

const MIST_FRAG = /* glsl */ `
varying float vT;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float puff = 1.0 - smoothstep(0.2, 1.0, r);
  float fade = smoothstep(0.0, 0.1, vT) * (1.0 - smoothstep(0.3, 1.0, vT));
  gl_FragColor = vec4(vColor.rgb, puff * fade * vColor.a);
}
`;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  gravity?: number;
  stretch?: number;
  size0: number;
  size1: number;
  streak?: boolean;
  r: number;
  g: number;
  b: number;
  a: number;
}

class Particles {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly pos0: THREE.InstancedBufferAttribute;
  private readonly vel: THREE.InstancedBufferAttribute;
  private readonly life: THREE.InstancedBufferAttribute;
  private readonly shape: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private cursor = 0;
  private dirty = false;
  private lastDeath = -1;

  constructor(
    private readonly capacity: number,
    material: THREE.ShaderMaterial,
    order: number,
  ) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    const attr = (n: number) =>
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(
        THREE.DynamicDrawUsage,
      );
    this.pos0 = attr(3);
    this.vel = attr(3);
    this.life = attr(4);
    this.shape = attr(4);
    this.color = attr(4);
    for (let i = 0; i < capacity; i++) this.life.setXYZW(i, -1e6, 1, 0, 0);
    this.geo.setAttribute('aPos0', this.pos0);
    this.geo.setAttribute('aVel', this.vel);
    this.geo.setAttribute('aLife', this.life);
    this.geo.setAttribute('aShape', this.shape);
    this.geo.setAttribute('aColor', this.color);
    this.geo.instanceCount = capacity;
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.visible = false;
  }

  emit(now: number, p: Particle): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos0.setXYZ(i, p.x, p.y, p.z);
    this.vel.setXYZ(i, p.vx, p.vy, p.vz);
    this.life.setXYZW(i, now, p.life, p.gravity ?? 0, p.stretch ?? 0);
    this.shape.setXYZW(i, p.size0, p.size1, (i * 0.618034) % 1, p.streak ? 1 : 0);
    this.color.setXYZW(i, p.r, p.g, p.b, p.a);
    this.lastDeath = Math.max(this.lastDeath, now + p.life);
    this.dirty = true;
  }

  update(now: number): void {
    if (this.dirty) {
      this.pos0.needsUpdate = true;
      this.vel.needsUpdate = true;
      this.life.needsUpdate = true;
      this.shape.needsUpdate = true;
      this.color.needsUpdate = true;
      this.dirty = false;
    }
    this.mesh.visible = now <= this.lastDeath;
  }

  dispose(): void {
    this.geo.dispose();
  }
}

// ---------------------------------------------------------------- bolts

interface BoltSlot {
  group: THREE.Group;
  body: THREE.Group;
  trail: THREE.Mesh;
  trailMat: THREE.MeshBasicMaterial;
  halo: THREE.Mesh;
  alive: boolean;
  heavy: boolean;
  born: number;
  flight: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  targetId: number;
  landed: boolean;
  fadeFrom: number;
}

interface FlareSlot {
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  at: THREE.Vector3;
  floor: number;
  start: number;
  sparked: boolean;
  alive: boolean;
  /** When the lantern next throws a pulse of light while it burns. */
  nextPulse: number;
}

/** A flat unit ring on the floor whose vertex colour (the additive alpha)
 *  is dark at 0.55 and at 1 and bright at its 0.86 crest. */
function softRingGeometry(segments: number): THREE.BufferGeometry {
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

/** A tapered streak from the origin back along -Z, 1 yard long (scaled). */
function trailGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // Two crossed ribbons so the streak reads from any angle; alpha rides the
  // vertex colour (additive: black is transparent).
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const quad = (ax: number, ay: number) => {
    const b = pos.length / 3;
    pos.push(ax, ay, 0, -ax, -ay, 0, -ax * 0.2, -ay * 0.2, -1, ax * 0.2, ay * 0.2, -1);
    col.push(1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  quad(0.5, 0);
  quad(0, 0.5);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

export class BastionCreatureFx {
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly glow: Particles;
  private readonly mist: Particles;
  private readonly bolts: BoltSlot[] = [];
  private readonly flares: FlareSlot[] = [];
  private readonly drowned: BastionDrownedFx;
  /** The trash mechanics' visuals (bastion_trash_fx.ts), on these same draws. */
  private readonly trash: BastionTrashFx;
  /** The Drowned Sergeant's Loose on My Mark (bastion_order_fx.ts). */
  private readonly order: BastionOrderFx;
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly tmp = { x: 0, y: 0, z: 0 };
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  /** One reused particle record for the lantern's steady pulse (no garbage
   *  while it burns). */
  private readonly pulse: Particle = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0.4,
    vz: 0,
    life: 0.35,
    size0: 1,
    size1: 1,
    r: 1,
    g: 0.74,
    b: 0.36,
    a: 0,
  };
  private clock = 0;
  private seed = 0xb017;

  constructor(
    root: THREE.Object3D,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
    private readonly reducedMotion: () => boolean = () => false,
  ) {
    const low =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';
    this.density = low ? 0.4 : 1;
    const shader = (frag: string, blending: THREE.Blending) => {
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
    // Sized for the trash mechanics' fog and splashes too (bastion_trash_fx.ts).
    this.mist = new Particles(
      Math.round(320 * this.density),
      shader(MIST_FRAG, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 30),
    );
    this.glow = new Particles(
      Math.round(1100 * this.density),
      shader(PARTICLE_FRAG, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 32),
    );
    for (const p of [this.mist, this.glow]) {
      this.geometries.push(p.mesh.geometry);
      root.add(p.mesh);
    }
    this.buildBolts(root);
    this.buildFlares(root);
    this.drowned = new BastionDrownedFx(this.glow, this.mist, world, this.density, reducedMotion);
    this.trash = new BastionTrashFx(
      root,
      groundY,
      world,
      this.glow,
      this.mist,
      this.density,
      reducedMotion,
      playGesture,
    );
    this.order = new BastionOrderFx(root, world, this.glow, this.mist, this.density, reducedMotion);
    for (const m of root.children) tagVfxSubtree(m);
  }

  private buildBolts(root: THREE.Object3D): void {
    // One bolt, built once along +Z (the head forward), cloned per slot on
    // the SAME geometries and materials.
    const shaftGeo = new THREE.CylinderGeometry(0.035, 0.03, 1.1, 6);
    shaftGeo.rotateX(Math.PI / 2);
    shaftGeo.translate(0, 0, -0.45);
    const headGeo = new THREE.ConeGeometry(0.075, 0.26, 4);
    headGeo.rotateX(Math.PI / 2);
    headGeo.translate(0, 0, 0.2);
    const vaneGeo = new THREE.PlaneGeometry(0.1, 0.26);
    vaneGeo.rotateX(Math.PI / 2);
    vaneGeo.translate(0.05, 0, -0.9);
    const haloGeo = new THREE.SphereGeometry(0.16, 10, 8);
    const trailGeo = trailGeometry();
    this.geometries.push(shaftGeo, headGeo, vaneGeo, haloGeo, trailGeo);
    const shaftMat = new THREE.MeshLambertMaterial({ color: 0x9a7048 });
    const headMat = new THREE.MeshBasicMaterial({ color: SEA_LIGHT.clone().multiplyScalar(1.6) });
    const vaneMat = new THREE.MeshLambertMaterial({ color: 0xe6e4d6, side: THREE.DoubleSide });
    const haloMat = new THREE.MeshBasicMaterial({
      color: SEA_LIGHT.clone().multiplyScalar(0.9),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(shaftMat, headMat, vaneMat, haloMat);
    for (let i = 0; i < BOLT_SLOTS; i++) {
      const group = new THREE.Group();
      group.name = 'bastion-bolt';
      group.visible = false;
      const body = new THREE.Group();
      body.add(new THREE.Mesh(shaftGeo, shaftMat));
      body.add(new THREE.Mesh(headGeo, headMat));
      for (let k = 0; k < 3; k++) {
        const vane = new THREE.Mesh(vaneGeo, vaneMat);
        vane.rotation.z = (k * Math.PI * 2) / 3;
        body.add(vane);
      }
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.z = 0.22;
      body.add(halo);
      const trailMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        color: SEA_LIGHT,
      });
      this.materials.push(trailMat);
      const trail = new THREE.Mesh(trailGeo, trailMat);
      trail.renderOrder = floorVfxRenderOrder('encounter', 31);
      halo.renderOrder = floorVfxRenderOrder('encounter', 32);
      group.add(body, trail);
      for (const m of [trail, halo]) m.frustumCulled = false;
      root.add(group);
      this.bolts.push({
        group,
        body,
        trail,
        trailMat,
        halo,
        alive: false,
        heavy: false,
        born: 0,
        flight: 0,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        targetId: -1,
        landed: false,
        fadeFrom: 0,
      });
    }
  }

  private buildFlares(root: THREE.Object3D): void {
    // The lantern light racing over the floor: a soft band (additive, its
    // alpha in the vertex colour: dark at both edges, bright at its crest).
    const ringGeo = softRingGeometry(96);
    this.geometries.push(ringGeo);
    for (let i = 0; i < FLARE_SLOTS; i++) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: LANTERN,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(ringMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.renderOrder = floorVfxRenderOrder('encounter', 29);
      ring.visible = false;
      root.add(ring);
      this.flares.push({
        ring,
        ringMat,
        at: new THREE.Vector3(),
        floor: 0,
        start: 0,
        sparked: false,
        alive: false,
        nextPulse: 0,
      });
    }
  }

  private rand(): number {
    // A small deterministic generator: presentation only, never the sim's rng.
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private count(n: number): number {
    return Math.max(1, Math.round(n * this.density));
  }

  /** Claims an arbalest's shot or the Turnkey's call; true when it drew it. */
  /** The drawn swell of a fed Barnacle Crawler, 1 for every other body. */
  bodySwell(id: number): number {
    return this.trash.swellOf(id);
  }

  handleEvent(ev: SimEvent): boolean {
    this.drowned.observe(ev, this.clock);
    // A marked bolt is the sergeant's volley, never a Piercing Bolt down a lane.
    if (this.order.handleEvent(ev, this.clock)) return true;
    if (this.trash.handleEvent(ev, this.clock)) return true;
    if (ev.type !== 'spellfx' || !this.world) return false;
    const source = this.world.entities.get(ev.sourceId);
    if (!source || source.kind !== 'mob') return false;
    if (source.templateId === ARBALEST && (ev.fx === 'projectile' || ev.fx === 'heavyBolt')) {
      this.loose(source, ev.targetId, ev.fx === 'heavyBolt');
      return true;
    }
    if (source.templateId === TURNKEY && ev.fx === 'nova') {
      this.playGesture?.(source.id, BASTION_OPEN_CELLS_GESTURE);
      this.lightLantern(source);
      return true;
    }
    return false;
  }

  private loose(
    source: { pos: { x: number; y: number; z: number }; facing: number },
    targetId: number,
    heavy: boolean,
  ): void {
    const slot = this.bolts.find((b) => !b.alive) ?? this.bolts[0];
    if (!slot) return;
    const k = modelScale(
      VISUALS.bastion_skel_arbalest?.height ?? 5.4,
      MOBS[ARBALEST]?.scale ?? 1,
      ARBALEST_RAW_HEIGHT,
    );
    const m = modelPointWorld(
      source.pos.x,
      source.pos.y,
      source.pos.z,
      source.facing,
      k,
      ARBALEST_MUZZLE,
      this.tmp,
    );
    slot.from.set(m.x, m.y, m.z);
    if (heavy) {
      const reach = piercingBoltReach();
      const ex = source.pos.x + Math.sin(source.facing) * reach;
      const ez = source.pos.z + Math.cos(source.facing) * reach;
      slot.to.set(ex, this.groundY(ex, ez) + 1.2, ez);
    } else {
      const target = this.world?.entities.get(targetId);
      if (target) slot.to.set(target.pos.x, target.pos.y + BOLT_TARGET_CHEST, target.pos.z);
      else slot.to.set(m.x + Math.sin(source.facing) * 20, m.y, m.z + Math.cos(source.facing) * 20);
    }
    slot.alive = true;
    slot.heavy = heavy;
    slot.landed = false;
    slot.born = this.clock;
    slot.targetId = heavy ? -1 : targetId;
    slot.flight = boltFlightSeconds(
      slot.from.distanceTo(slot.to),
      heavy ? PIERCING_BOLT_SPEED : RUSTED_BOLT_SPEED,
    );
    // The bolt at the crossbow's own size (its bolt is about 2.5 yd long).
    const s = heavy ? 2.3 : 1.8;
    slot.body.scale.setScalar(s);
    // A tight sheen along the head, never a ball of light (it is a bolt).
    const h = heavy ? 1.3 : 1;
    slot.halo.scale.set(0.5 * h, 0.5 * h, 1.8 * h);
    slot.group.visible = true;
    slot.body.visible = true;
    slot.trailMat.opacity = 1;
    slot.group.position.copy(slot.from);
    this.v1.copy(slot.to).sub(slot.from).normalize();
    this.muzzleBurst(slot.from, this.v1, heavy);
  }

  /** The string snaps: a flash at the prod, sparks sprayed ahead, sea mist. */
  private muzzleBurst(at: THREE.Vector3, dir: THREE.Vector3, heavy: boolean): void {
    const now = this.clock;
    const big = heavy ? 1.6 : 1;
    this.glow.emit(now, {
      x: at.x,
      y: at.y,
      z: at.z,
      vx: dir.x * 2,
      vy: dir.y * 2,
      vz: dir.z * 2,
      life: 0.22,
      size0: 1.3 * big,
      size1: 0.2,
      r: 0.7,
      g: 1.0,
      b: 0.9,
      a: 0.9,
    });
    this.glow.emit(now, {
      x: at.x,
      y: at.y,
      z: at.z,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0.09,
      size0: 0.5 * big,
      size1: 1.1 * big,
      r: 0.8,
      g: 1,
      b: 0.92,
      a: 0.55,
    });
    const sparks = this.reducedMotion() ? 0 : this.count(heavy ? 22 : 12);
    for (let i = 0; i < sparks; i++) {
      const sp = (4 + this.rand() * 10) * big;
      const jx = (this.rand() - 0.5) * 0.9;
      const jy = (this.rand() - 0.3) * 0.7;
      const jz = (this.rand() - 0.5) * 0.9;
      this.glow.emit(now, {
        x: at.x,
        y: at.y,
        z: at.z,
        vx: (dir.x + jx) * sp,
        vy: (dir.y + jy) * sp,
        vz: (dir.z + jz) * sp,
        life: 0.25 + this.rand() * 0.25,
        gravity: 6,
        stretch: 1,
        size0: 0.18,
        size1: 0.06,
        streak: true,
        r: 0.75,
        g: 1,
        b: 0.9,
        a: 1,
      });
    }
    const puffs = this.count(heavy ? 8 : 5);
    for (let i = 0; i < puffs; i++) {
      this.mist.emit(now, {
        x: at.x - dir.x * 0.4,
        y: at.y,
        z: at.z - dir.z * 0.4,
        vx: dir.x * 2 + (this.rand() - 0.5) * 3,
        vy: 0.3 + this.rand() * 0.8,
        vz: dir.z * 2 + (this.rand() - 0.5) * 3,
        life: 0.8 + this.rand() * 0.6,
        size0: 0.35 * big,
        size1: 1.3 * big,
        r: 0.6,
        g: 0.72,
        b: 0.7,
        a: 0.16,
      });
    }
  }

  /** The bolt lands: sparks, splinters and a flash (and a longer spray for
   *  the Piercing Bolt at the end of its lane). */
  private impact(at: THREE.Vector3, dir: THREE.Vector3, heavy: boolean): void {
    const now = this.clock;
    const big = heavy ? 1.5 : 1;
    this.glow.emit(now, {
      x: at.x,
      y: at.y,
      z: at.z,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0.3,
      size0: 1.6 * big,
      size1: 0.4,
      r: 0.8,
      g: 1,
      b: 0.9,
      a: 0.85,
    });
    const sparks = this.count(heavy ? 26 : 16);
    for (let i = 0; i < sparks; i++) {
      const sp = (3 + this.rand() * 8) * big;
      this.glow.emit(now, {
        x: at.x,
        y: at.y,
        z: at.z,
        vx: (-dir.x * 0.6 + (this.rand() - 0.5) * 1.6) * sp,
        vy: (0.2 + this.rand() * 0.8) * sp,
        vz: (-dir.z * 0.6 + (this.rand() - 0.5) * 1.6) * sp,
        life: 0.3 + this.rand() * 0.3,
        gravity: 14,
        stretch: 1,
        size0: 0.16,
        size1: 0.05,
        streak: true,
        r: 1,
        g: 0.86,
        b: 0.55,
        a: 1,
      });
    }
    // Wood splinters: dull, slower, falling.
    const splinters = this.count(8);
    for (let i = 0; i < splinters; i++) {
      this.glow.emit(now, {
        x: at.x,
        y: at.y,
        z: at.z,
        vx: (this.rand() - 0.5) * 6,
        vy: 1 + this.rand() * 3,
        vz: (this.rand() - 0.5) * 6,
        life: 0.5 + this.rand() * 0.3,
        gravity: 18,
        stretch: 0.4,
        size0: 0.14,
        size1: 0.1,
        streak: true,
        r: 0.36,
        g: 0.24,
        b: 0.14,
        a: 0.9,
      });
    }
  }

  private lightLantern(source: { pos: { x: number; y: number; z: number }; facing: number }): void {
    const slot = this.flares.find((f) => !f.alive) ?? this.flares[0];
    if (!slot) return;
    const k = modelScale(
      VISUALS.bastion_turnkey?.height ?? 4.8,
      MOBS[TURNKEY]?.scale ?? 1,
      TURNKEY_RAW_HEIGHT,
    );
    const p = modelPointWorld(
      source.pos.x,
      source.pos.y,
      source.pos.z,
      source.facing,
      k,
      TURNKEY_LANTERN_HIGH,
      this.tmp,
    );
    slot.at.set(p.x, p.y, p.z);
    slot.floor = this.groundY(source.pos.x, source.pos.z);
    slot.ring.position.set(source.pos.x, slot.floor + 0.06, source.pos.z);
    slot.start = this.clock + LANTERN_FLARE_DELAY;
    slot.sparked = false;
    slot.nextPulse = 0;
    slot.alive = true;
  }

  update(dt: number): void {
    this.clock += dt;
    this.uTime.value = this.clock;
    const now = this.clock;
    for (const slot of this.bolts) {
      if (!slot.alive) continue;
      const age = now - slot.born;
      if (!slot.landed) {
        // A homing Rusted Bolt tracks the chest it was loosed at.
        if (slot.targetId >= 0) {
          const t = this.world?.entities.get(slot.targetId);
          if (t) slot.to.set(t.pos.x, t.pos.y + BOLT_TARGET_CHEST, t.pos.z);
        }
        const f = Math.min(1, age / slot.flight);
        this.v1.copy(slot.from).lerp(slot.to, f);
        slot.group.position.copy(this.v1);
        this.v2.copy(slot.to).sub(slot.from);
        const dist = this.v2.length();
        if (dist > 1e-4) {
          this.v2.divideScalar(dist);
          slot.group.lookAt(this.v1.x + this.v2.x, this.v1.y + this.v2.y, this.v1.z + this.v2.z);
        }
        const trail = boltTrailLength(dist * f, slot.heavy ? PIERCING_TRAIL : RUSTED_TRAIL);
        slot.trail.scale.set(
          slot.heavy ? 0.5 : 0.32,
          slot.heavy ? 0.5 : 0.32,
          Math.max(0.01, trail),
        );
        if (f >= 1) {
          slot.landed = true;
          slot.fadeFrom = now;
          slot.body.visible = false;
          this.impact(slot.to, this.v2, slot.heavy);
        }
      } else {
        // The streak lingers and fades where it flew.
        const fade = 1 - (now - slot.fadeFrom) / (slot.heavy ? 0.55 : 0.22);
        slot.trailMat.opacity = Math.max(0, fade);
        if (fade <= 0) {
          slot.alive = false;
          slot.group.visible = false;
        }
      }
    }
    for (const slot of this.flares) {
      if (!slot.alive) continue;
      const t = now - slot.start;
      if (t < 0) continue;
      if (!slot.sparked) {
        slot.sparked = true;
        this.flareBurst(slot.at);
      }
      const e = lanternFlareEnvelope(t);
      slot.ring.visible = e > 0;
      const r = 1.5 + 11 * Math.min(1, t / (LANTERN_FLARE_SEC * 0.7));
      slot.ring.scale.set(r, 1, r);
      slot.ringMat.opacity = 0.85 * e;
      // The lantern keeps blazing while the flare lasts: a pulse of light
      // at the glass every few frames' worth of time.
      if (now >= slot.nextPulse && e > 0.05 && !this.reducedMotion()) {
        slot.nextPulse = now + 0.09;
        const pulse = this.pulse;
        pulse.x = slot.at.x;
        pulse.y = slot.at.y;
        pulse.z = slot.at.z;
        pulse.size0 = 1.6 + 1.6 * e;
        pulse.size1 = 2.4 + 2.4 * e;
        pulse.a = 0.35 * e;
        this.glow.emit(now, pulse);
      }
      if (t > LANTERN_FLARE_SEC) {
        slot.alive = false;
        slot.ring.visible = false;
      }
    }
    this.drowned.update(now);
    this.trash.update(now, dt);
    this.order.update(now, dt);
    this.glow.update(now);
    this.mist.update(now);
  }

  /** The lantern flares: a white-hot core in a wide amber halo, long rays
   *  of light, embers thrown up and out, smoke rolling off the glass. */
  private flareBurst(at: THREE.Vector3): void {
    const now = this.clock;
    this.glow.emit(now, {
      x: at.x,
      y: at.y,
      z: at.z,
      vx: 0,
      vy: 0.2,
      vz: 0,
      life: 0.7,
      size0: 1.2,
      size1: 2.4,
      r: 1,
      g: 0.93,
      b: 0.72,
      a: 1,
    });
    this.glow.emit(now, {
      x: at.x,
      y: at.y,
      z: at.z,
      vx: 0,
      vy: 0.3,
      vz: 0,
      life: 1.1,
      size0: 3.5,
      size1: 7.5,
      r: 1,
      g: 0.6,
      b: 0.24,
      a: 0.4,
    });
    // Reduced motion keeps the glow and the light on the floor, never the
    // flying rays and embers.
    const still = this.reducedMotion();
    const rays = still ? 0 : this.count(12);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + this.rand() * 0.3;
      const sp = 2.5 + this.rand();
      this.glow.emit(now, {
        x: at.x,
        y: at.y,
        z: at.z,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: Math.sin(a * 1.7) * sp * 0.4,
        life: 0.55,
        stretch: 6,
        size0: 0.9,
        size1: 1.4,
        streak: true,
        r: 1,
        g: 0.8,
        b: 0.46,
        a: 0.55,
      });
    }
    const embers = still ? 0 : this.count(48);
    for (let i = 0; i < embers; i++) {
      const a = this.rand() * Math.PI * 2;
      const up = 0.3 + this.rand() * 1.1;
      const sp = 3 + this.rand() * 7;
      this.glow.emit(now, {
        x: at.x,
        y: at.y,
        z: at.z,
        vx: Math.cos(a) * sp,
        vy: up * sp,
        vz: Math.sin(a) * sp,
        life: 0.7 + this.rand() * 0.7,
        gravity: 4,
        stretch: 0.8,
        size0: 0.22,
        size1: 0.06,
        streak: true,
        r: 1,
        g: 0.62 + this.rand() * 0.25,
        b: 0.25,
        a: 1,
      });
    }
    const smoke = this.count(10);
    for (let i = 0; i < smoke; i++) {
      this.mist.emit(now, {
        x: at.x + (this.rand() - 0.5) * 0.6,
        y: at.y + 0.3,
        z: at.z + (this.rand() - 0.5) * 0.6,
        vx: (this.rand() - 0.5) * 1.2,
        vy: 1.2 + this.rand() * 1.2,
        vz: (this.rand() - 0.5) * 1.2,
        life: 1.4 + this.rand() * 0.8,
        size0: 0.8,
        size1: 2.6,
        r: 0.5,
        g: 0.45,
        b: 0.38,
        a: 0.3,
      });
    }
  }

  dispose(): void {
    this.trash.dispose();
    this.order.dispose();
    this.glow.dispose();
    this.mist.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
