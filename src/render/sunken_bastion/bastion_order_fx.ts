// The Drowned Sergeant's Loose on My Mark, drawn (plan: bastion_order_fx_core.ts;
// sim: ../../sim/mob/trash_kit/bastion_order.ts):
//  - the red crosshair over the marked player's head while the shout's bar
//    runs, closing in and pulsing faster to lock-on, flaring as it lands;
//  - a dashed red aiming line from every arbalest that can answer it to the
//    mark, its dashes racing toward them and brightening as the bar fills;
//  - the volley: a heavy rusted bolt per arbalest dragging a red tracer and
//    brine spray, bursting in sparks, splinters and spray on the mark; a bolt
//    the sim stopped on a wall flies to the first blocked spot along its line
//    (the sim's own sight test, bisected) and shatters on the stone.
//
// Hosted by BastionCreatureFx (its root, compile gate and particle pools),
// which hands it every event before its own arbalest claim, so a marked bolt
// is never drawn as a Piercing Bolt down a lane.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built once in
// the constructor, pooled, no light. The crosshair, the aiming lines and the
// bolts are ACTIONABLE (who is marked, from where, whether the wall held) and
// draw on every tier; only the spray, sparks and splinters shed with the
// effects density, and reduced motion drops the flying debris.

import * as THREE from 'three';
import { lineOfSightClear } from '../../sim/colliders';
import { MOBS } from '../../sim/data';
import {
  BASTION_LOOSE_ON_MY_MARK,
  BASTION_MARKED_BOLT,
  BASTION_MARKED_BOLT_BLOCKED,
} from '../../sim/mob/trash_kit/bastion_cast_ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { VISUALS } from '../characters/manifest';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  ARBALEST_MUZZLE,
  ARBALEST_RAW_HEIGHT,
  boltFlightSeconds,
  modelPointWorld,
  modelScale,
} from './bastion_creature_fx_core';
import type { DrownedParticle, DrownedParticleSink } from './bastion_drowned_fx';
import {
  aimLineLook,
  MARK_CHEST,
  MARK_SHOOTER,
  MARKED_BOLT_SPEED,
  markedBoltEnd,
  markedTrailLength,
  ORDER_FX_SLOTS,
  orderAimers,
  orderFill,
  RETICLE_HEIGHT,
  reticleLook,
  reticleRate,
  SERGEANT,
  SPRAY_INTERVAL,
} from './bastion_order_fx_core';
import { inBastionClaim } from './bastion_trash_fx_core';

const SCAN_SEC = 0.1;
/** Seconds the crosshair flares and the lines fade once the shout ends. */
const LOCK_FLASH_SEC = 0.3;
const LINE_FADE_SEC = 0.18;
/** Seconds a landed bolt's tracer lingers. */
const TRAIL_FADE_SEC = 0.4;
const MARK_RED = new THREE.Color(1.0, 0.16, 0.08);
const TRACER_RED = new THREE.Color(1.0, 0.32, 0.18);

const RETICLE_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;

// The crosshair: a broken outer ring that turns, a thin guard ring, four
// ticks closing on the centre with the bar, a hot centre pip. A dark rim
// round every stroke keeps it legible on bright sea and on dark stone.
const RETICLE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uSpin;
uniform float uClose;
varying vec2 vUv;
float band(float x, float c, float w) { return 1.0 - smoothstep(w * 0.55, w, abs(x - c)); }
float strokes(float grow) {
  float r = length(vUv);
  float a = atan(vUv.y, vUv.x);
  float arcs = step(0.22, abs(sin((a + uSpin) * 2.0)));
  float ring = band(r, 0.78, 0.075 + grow) * arcs;
  float guard = band(r, 0.93, 0.025 + grow) * 0.8;
  float inner = mix(0.62, 0.2, uClose);
  vec2 q = abs(vUv);
  float w = 0.045 + grow;
  float tx = (1.0 - smoothstep(w * 0.6, w, q.y)) * step(inner, q.x) * step(q.x, 0.9);
  float ty = (1.0 - smoothstep(w * 0.6, w, q.x)) * step(inner, q.y) * step(q.y, 0.9);
  float pip = 1.0 - smoothstep(0.07 + grow, 0.11 + grow, r);
  return max(max(ring, guard), max(max(tx, ty), pip));
}
void main() {
  float s = strokes(0.0);
  float wide = strokes(0.05);
  float r = length(vUv);
  float halo = exp(-r * r * 4.0) * 0.35 * uClose;
  vec3 hot = mix(uColor, vec3(1.0, 0.86, 0.8), (1.0 - smoothstep(0.0, 0.12, r)) * 0.7);
  vec3 col = mix(vec3(0.1, 0.0, 0.0), hot, s / max(wide, 0.001));
  float alpha = max(wide * 0.75, s) * uAlpha + halo * uAlpha;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(mix(col, uColor, halo * (1.0 - wide)), min(1.0, alpha));
}
`;

const LINE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The aiming line: a red ribbon (two crossed quads) with dashes racing from
// the crossbow to the mark, its core hotter than its edge.
const LINE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
uniform float uLen;
uniform float uFlow;
varying vec2 vUv;
void main() {
  float along = vUv.y * uLen;
  float dash = fract((along - uTime * uFlow) / 1.4);
  float on = smoothstep(0.0, 0.08, dash) * (1.0 - smoothstep(0.5, 0.62, dash));
  float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float core = smoothstep(0.0, 0.7, edge);
  float ends = smoothstep(0.0, 0.05, vUv.y) * (0.55 + 0.45 * vUv.y);
  float a = uAlpha * ends * core * (0.3 + 0.7 * on);
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.78, 0.7), on * core * 0.4), a);
}
`;

type Body = IWorld['entities'] extends Map<number, infer E> ? E : never;

interface ReticleSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  sergeantId: number;
  markId: number;
  phase: number;
  fill: number;
  /** Seconds into the lock flash once the shout ended (-1 while it runs). */
  flash: number;
  x: number;
  y: number;
  z: number;
}

interface LineSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  sergeantId: number;
  shooterId: number;
  markId: number;
  /** Seconds into its fade once the shout ended (-1 while it runs). */
  fade: number;
  alpha: number;
}

interface BoltSlot {
  group: THREE.Group;
  body: THREE.Group;
  trail: THREE.Mesh;
  trailMat: THREE.MeshBasicMaterial;
  alive: boolean;
  landed: boolean;
  blocked: boolean;
  born: number;
  flight: number;
  fadeFrom: number;
  nextSpray: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

/** A tapered streak from the origin back along -Z, 1 yard long (scaled). */
function tracerGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const quad = (ax: number, ay: number) => {
    const b = pos.length / 3;
    pos.push(ax, ay, 0, -ax, -ay, 0, -ax * 0.15, -ay * 0.15, -1, ax * 0.15, ay * 0.15, -1);
    col.push(1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  quad(0.5, 0);
  quad(0, 0.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Two crossed unit ribbons along +Z from 0 to 1 (uv.y runs along it). */
function ribbonGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const quad = (ax: number, ay: number) => {
    const b = pos.length / 3;
    pos.push(-ax, -ay, 0, ax, ay, 0, ax, ay, 1, -ax, -ay, 1);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  quad(0.5, 0);
  quad(0, 0.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class BastionOrderFx {
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly reticles: ReticleSlot[] = [];
  private readonly lines: LineSlot[] = [];
  private readonly bolts: BoltSlot[] = [];
  private readonly uTime = { value: 0 };
  private readonly arbalestK: number;
  private readonly tmp = { x: 0, y: 0, z: 0 };
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
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
  /** The sight probe's ray (ground points; the sim's own test). */
  private readonly probeFrom = { x: 0, z: 0 };
  private readonly probeTo = { x: 0, z: 0 };
  private probeX = 0;
  private probeZ = 0;
  private readonly clearAt = (d: number): boolean => {
    this.probeTo.x = this.probeFrom.x + this.probeX * d;
    this.probeTo.z = this.probeFrom.z + this.probeZ * d;
    const seed = this.world?.cfg.seed ?? 0;
    return lineOfSightClear(seed, this.probeFrom, this.probeTo, 0.05);
  };
  private scanIn = 0;
  private clock = 0;
  private seed = 0x5e7a;

  constructor(
    root: THREE.Object3D,
    private readonly world: IWorld | undefined,
    private readonly glow: DrownedParticleSink,
    private readonly mist: DrownedParticleSink,
    private readonly density: number,
    private readonly reducedMotion: () => boolean = () => false,
  ) {
    this.arbalestK = modelScale(
      VISUALS.bastion_skel_arbalest?.height ?? 5.4,
      MOBS[MARK_SHOOTER]?.scale ?? 1,
      ARBALEST_RAW_HEIGHT,
    );
    this.buildReticles(root);
    this.buildLines(root);
    this.buildBolts(root);
  }

  private buildReticles(root: THREE.Object3D): void {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(geo);
    for (let i = 0; i < ORDER_FX_SLOTS.reticles; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: MARK_RED.clone() },
          uAlpha: { value: 0 },
          uSpin: { value: 0 },
          uClose: { value: 0 },
          uSize: { value: 1 },
        },
        vertexShader: RETICLE_VERT,
        fragmentShader: RETICLE_FRAG,
        transparent: true,
        depthWrite: false,
        // Actionable: the marked player reads it through a crenel too.
        depthTest: false,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'bastion-mark-reticle';
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 34);
      root.add(mesh);
      this.reticles.push({
        mesh,
        mat,
        sergeantId: -1,
        markId: -1,
        phase: 0,
        fill: 0,
        flash: -1,
        x: 0,
        y: 0,
        z: 0,
      });
    }
  }

  private buildLines(root: THREE.Object3D): void {
    const geo = ribbonGeometry();
    this.geometries.push(geo);
    for (let i = 0; i < ORDER_FX_SLOTS.lines; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: MARK_RED.clone() },
          uAlpha: { value: 0 },
          uTime: this.uTime,
          uLen: { value: 1 },
          uFlow: { value: 4 },
        },
        vertexShader: LINE_VERT,
        fragmentShader: LINE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'bastion-mark-aim';
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 33);
      root.add(mesh);
      this.lines.push({
        mesh,
        mat,
        sergeantId: -1,
        shooterId: -1,
        markId: -1,
        fade: -1,
        alpha: 0,
      });
    }
  }

  private buildBolts(root: THREE.Object3D): void {
    // A heavier quarrel than the Rusted Bolt: a thick rust-eaten shaft, a
    // broad barbed iron head, tarred vanes, all built once along +Z.
    const shaftGeo = new THREE.CylinderGeometry(0.05, 0.042, 1.25, 6);
    shaftGeo.rotateX(Math.PI / 2);
    shaftGeo.translate(0, 0, -0.5);
    const headGeo = new THREE.ConeGeometry(0.11, 0.34, 4);
    headGeo.rotateX(Math.PI / 2);
    headGeo.translate(0, 0, 0.24);
    const barbGeo = new THREE.BoxGeometry(0.28, 0.03, 0.08);
    barbGeo.translate(0, 0, 0.1);
    const vaneGeo = new THREE.PlaneGeometry(0.13, 0.3);
    vaneGeo.rotateX(Math.PI / 2);
    vaneGeo.translate(0.065, 0, -1.0);
    const trailGeo = tracerGeometry();
    this.geometries.push(shaftGeo, headGeo, barbGeo, vaneGeo, trailGeo);
    const shaftMat = new THREE.MeshLambertMaterial({ color: 0x5c3a22 });
    const headMat = new THREE.MeshLambertMaterial({
      color: 0x7a4a2c,
      emissive: 0x5a0c04,
    });
    const vaneMat = new THREE.MeshLambertMaterial({ color: 0x2c2420, side: THREE.DoubleSide });
    this.materials.push(shaftMat, headMat, vaneMat);
    for (let i = 0; i < ORDER_FX_SLOTS.bolts; i++) {
      const group = new THREE.Group();
      group.name = 'bastion-marked-bolt';
      group.visible = false;
      const body = new THREE.Group();
      body.add(new THREE.Mesh(shaftGeo, shaftMat));
      body.add(new THREE.Mesh(headGeo, headMat));
      body.add(new THREE.Mesh(barbGeo, headMat));
      for (let k = 0; k < 3; k++) {
        const vane = new THREE.Mesh(vaneGeo, vaneMat);
        vane.rotation.z = (k * Math.PI * 2) / 3;
        body.add(vane);
      }
      body.scale.setScalar(2.1);
      const trailMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        color: TRACER_RED,
      });
      this.materials.push(trailMat);
      const trail = new THREE.Mesh(trailGeo, trailMat);
      trail.frustumCulled = false;
      trail.renderOrder = floorVfxRenderOrder('encounter', 31);
      group.add(body, trail);
      root.add(group);
      this.bolts.push({
        group,
        body,
        trail,
        trailMat,
        alive: false,
        landed: false,
        blocked: false,
        born: 0,
        flight: 0,
        fadeFrom: 0,
        nextSpray: 0,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
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

  /** How many of each pool are live (tests and diagnostics). */
  liveCounts(): { reticles: number; lines: number; bolts: number } {
    return {
      reticles: this.reticles.filter((r) => r.mesh.visible).length,
      lines: this.lines.filter((l) => l.mesh.visible).length,
      bolts: this.bolts.filter((b) => b.alive).length,
    };
  }

  // ------------------------------------------------------------------ events

  /** A marked bolt: claimed (true) so no generic or Piercing Bolt draws it. */
  handleEvent(ev: SimEvent, now: number): boolean {
    if (ev.type !== 'spellfx') return false;
    const blocked = ev.ability === BASTION_MARKED_BOLT_BLOCKED;
    if (!blocked && ev.ability !== BASTION_MARKED_BOLT) return false;
    this.clock = now;
    const world = this.world;
    const shooter = world?.entities.get(ev.sourceId);
    const mark = world?.entities.get(ev.targetId);
    if (shooter && mark) this.loose(shooter, mark, blocked);
    return true;
  }

  private loose(shooter: Body, mark: Body, blocked: boolean): void {
    const slot = this.bolts.find((b) => !b.alive) ?? this.bolts[0];
    if (!slot) return;
    // The sim turned the arbalest onto its mark as it loosed.
    const facing = Math.atan2(mark.pos.x - shooter.pos.x, mark.pos.z - shooter.pos.z);
    const m = modelPointWorld(
      shooter.pos.x,
      shooter.pos.y,
      shooter.pos.z,
      facing,
      this.arbalestK,
      ARBALEST_MUZZLE,
      this.tmp,
    );
    slot.from.set(m.x, m.y, m.z);
    const chest = { x: mark.pos.x, y: mark.pos.y + MARK_CHEST, z: mark.pos.z };
    this.probeFrom.x = shooter.pos.x;
    this.probeFrom.z = shooter.pos.z;
    const pdx = mark.pos.x - shooter.pos.x;
    const pdz = mark.pos.z - shooter.pos.z;
    const pd = Math.hypot(pdx, pdz);
    this.probeX = pd > 1e-6 ? pdx / pd : 0;
    this.probeZ = pd > 1e-6 ? pdz / pd : 1;
    const end = markedBoltEnd(
      { x: slot.from.x, y: slot.from.y, z: slot.from.z },
      chest,
      blocked,
      this.clearAt,
    );
    slot.to.set(end.x, end.y, end.z);
    slot.alive = true;
    slot.landed = false;
    slot.blocked = blocked;
    slot.born = this.clock;
    slot.nextSpray = this.clock;
    slot.flight = boltFlightSeconds(slot.from.distanceTo(slot.to), MARKED_BOLT_SPEED);
    slot.group.visible = true;
    slot.body.visible = true;
    slot.trailMat.opacity = 1;
    slot.group.position.copy(slot.from);
    this.v1.copy(slot.to).sub(slot.from).normalize();
    this.muzzle(slot.from, this.v1);
  }

  /** The prod snaps: a red-hot flash and a cough of brine off the string. */
  private muzzle(at: THREE.Vector3, dir: THREE.Vector3): void {
    const now = this.clock;
    this.burst(now, at, 0, 0, 0, 0.16, 1.6, 0.3, 1, 0.4, 0.22, 0.95, this.glow);
    const sparks = this.reducedMotion() ? 0 : this.count(14);
    for (let i = 0; i < sparks; i++) {
      const sp = 5 + this.rand() * 9;
      const p = this.p;
      p.x = at.x;
      p.y = at.y;
      p.z = at.z;
      p.vx = (dir.x + (this.rand() - 0.5) * 0.8) * sp;
      p.vy = (dir.y + (this.rand() - 0.3) * 0.6) * sp;
      p.vz = (dir.z + (this.rand() - 0.5) * 0.8) * sp;
      p.life = 0.22 + this.rand() * 0.2;
      p.gravity = 6;
      p.stretch = 1;
      p.size0 = 0.2;
      p.size1 = 0.05;
      p.streak = true;
      p.r = 1;
      p.g = 0.45 + this.rand() * 0.3;
      p.b = 0.25;
      p.a = 1;
      this.glow.emit(now, p);
    }
    const puffs = this.count(6);
    for (let i = 0; i < puffs; i++) {
      this.burst(
        now,
        at,
        dir.x * 2 + (this.rand() - 0.5) * 3,
        0.4 + this.rand() * 0.8,
        dir.z * 2 + (this.rand() - 0.5) * 3,
        0.9 + this.rand() * 0.5,
        0.4,
        1.5,
        0.58,
        0.7,
        0.68,
        0.18,
        this.mist,
      );
    }
  }

  private burst(
    now: number,
    at: { x: number; y: number; z: number },
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    r: number,
    g: number,
    b: number,
    a: number,
    sink: DrownedParticleSink,
  ): void {
    const p = this.p;
    p.x = at.x;
    p.y = at.y;
    p.z = at.z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = life;
    p.gravity = 0;
    p.stretch = 0;
    p.size0 = size0;
    p.size1 = size1;
    p.streak = false;
    p.r = r;
    p.g = g;
    p.b = b;
    p.a = a;
    sink.emit(now, p);
  }

  /** The bolt lands: on the mark a red burst, splinters and a sheet of brine;
   *  on a wall a shower of white stone sparks, splinters and grit. */
  private impact(at: THREE.Vector3, dir: THREE.Vector3, blocked: boolean): void {
    const now = this.clock;
    const still = this.reducedMotion();
    if (blocked) {
      this.burst(now, at, 0, 0, 0, 0.28, 1.8, 0.4, 1, 0.92, 0.7, 0.9, this.glow);
    } else {
      this.burst(now, at, 0, 0, 0, 0.32, 2.2, 0.5, 1, 0.3, 0.16, 0.95, this.glow);
      this.burst(now, at, 0, 0.2, 0, 0.5, 1.2, 3.2, 1, 0.2, 0.1, 0.35, this.glow);
    }
    const sparks = still ? 0 : this.count(blocked ? 30 : 22);
    for (let i = 0; i < sparks; i++) {
      const sp = 3 + this.rand() * 9;
      const p = this.p;
      p.x = at.x;
      p.y = at.y;
      p.z = at.z;
      // Off a wall they spray back toward the shooter; on a body, out of it.
      const back = blocked ? -0.9 : 0.4;
      p.vx = (dir.x * back + (this.rand() - 0.5) * 1.6) * sp;
      p.vy = (0.25 + this.rand() * 0.8) * sp;
      p.vz = (dir.z * back + (this.rand() - 0.5) * 1.6) * sp;
      p.life = 0.3 + this.rand() * 0.3;
      p.gravity = 14;
      p.stretch = 1;
      p.size0 = 0.17;
      p.size1 = 0.05;
      p.streak = true;
      p.r = 1;
      p.g = blocked ? 0.9 : 0.5;
      p.b = blocked ? 0.65 : 0.3;
      p.a = 1;
      this.glow.emit(now, p);
    }
    const splinters = still ? 0 : this.count(blocked ? 12 : 8);
    for (let i = 0; i < splinters; i++) {
      const p = this.p;
      p.x = at.x;
      p.y = at.y;
      p.z = at.z;
      p.vx = (this.rand() - 0.5) * 7 - dir.x * (blocked ? 3 : 0);
      p.vy = 1 + this.rand() * 3.5;
      p.vz = (this.rand() - 0.5) * 7 - dir.z * (blocked ? 3 : 0);
      p.life = 0.55 + this.rand() * 0.35;
      p.gravity = 18;
      p.stretch = 0.4;
      p.size0 = 0.16;
      p.size1 = 0.11;
      p.streak = true;
      p.r = 0.34;
      p.g = 0.22;
      p.b = 0.13;
      p.a = 0.95;
      this.glow.emit(now, p);
    }
    const puffs = this.count(blocked ? 7 : 9);
    for (let i = 0; i < puffs; i++) {
      this.burst(
        now,
        at,
        (this.rand() - 0.5) * 2.6,
        0.3 + this.rand() * 1.1,
        (this.rand() - 0.5) * 2.6,
        0.9 + this.rand() * 0.6,
        0.5,
        2,
        blocked ? 0.55 : 0.56,
        blocked ? 0.52 : 0.7,
        blocked ? 0.48 : 0.7,
        blocked ? 0.28 : 0.22,
        this.mist,
      );
    }
  }

  // ------------------------------------------------------------------- frame

  update(now: number, dt: number): void {
    this.clock = now;
    this.uTime.value = now;
    const world = this.world;
    if (!world) return;
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scanIn = SCAN_SEC;
      if (inBastionClaim(world.player.pos.x)) this.scan(world);
    }
    this.updateReticles(world, dt);
    this.updateLines(world, dt);
    this.updateBolts(dt);
  }

  /** Hand every shouting sergeant a crosshair and its arbalests a line. */
  private scan(world: IWorld): void {
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.dead || e.templateId !== SERGEANT) continue;
      if (e.castingAbility !== BASTION_LOOSE_ON_MY_MARK || e.castTargetId === null) continue;
      const mark = world.entities.get(e.castTargetId);
      if (!mark || mark.dead) continue;
      let ret = this.reticles.find((r) => r.sergeantId === e.id && r.flash < 0);
      if (!ret) {
        ret = this.reticles.find((r) => r.sergeantId < 0);
        if (ret) {
          ret.sergeantId = e.id;
          ret.markId = mark.id;
          ret.phase = 0;
          ret.flash = -1;
          ret.mesh.visible = true;
        }
      }
      for (const id of orderAimers(e, mark, world.entities.values())) {
        if (this.lines.some((l) => l.sergeantId === e.id && l.shooterId === id && l.fade < 0))
          continue;
        const line = this.lines.find((l) => l.sergeantId < 0);
        if (!line) break;
        line.sergeantId = e.id;
        line.shooterId = id;
        line.markId = mark.id;
        line.fade = -1;
        line.alpha = 0;
        line.mesh.visible = true;
      }
    }
  }

  /** The sergeant still shouting at its mark: the bar's fill, else null. */
  private shoutFill(world: IWorld, sergeantId: number, markId: number): number | null {
    const s = world.entities.get(sergeantId);
    if (!s || s.dead || s.castingAbility !== BASTION_LOOSE_ON_MY_MARK) return null;
    if (s.castTargetId !== markId) return null;
    return orderFill(s.castRemaining, s.castTotal);
  }

  private updateReticles(world: IWorld, dt: number): void {
    for (const r of this.reticles) {
      if (r.sergeantId < 0) continue;
      const mark = world.entities.get(r.markId);
      const fill = this.shoutFill(world, r.sergeantId, r.markId);
      if (fill !== null && r.flash < 0 && mark && !mark.dead) {
        r.fill = fill;
        r.phase += dt * reticleRate(fill);
        r.x = mark.pos.x;
        r.y = mark.pos.y + RETICLE_HEIGHT;
        r.z = mark.pos.z;
        const look = reticleLook(r.phase, fill);
        r.mesh.position.set(r.x, r.y, r.z);
        r.mat.uniforms.uSize.value = look.size;
        r.mat.uniforms.uAlpha.value = look.alpha;
        r.mat.uniforms.uSpin.value = look.spin;
        r.mat.uniforms.uClose.value = look.close;
        continue;
      }
      // The shout ended (landed, kicked, the sergeant down): the lock flares
      // out where it hung, then the slot is free.
      if (r.flash < 0) r.flash = 0;
      r.flash += dt;
      const k = r.flash / LOCK_FLASH_SEC;
      if (k >= 1) {
        r.sergeantId = -1;
        r.markId = -1;
        r.mesh.visible = false;
        continue;
      }
      if (mark && !mark.dead) {
        r.x = mark.pos.x;
        r.y = mark.pos.y + RETICLE_HEIGHT;
        r.z = mark.pos.z;
      }
      r.mesh.position.set(r.x, r.y, r.z);
      const landed = r.fill > 0.9;
      r.mat.uniforms.uSize.value =
        reticleLook(r.phase, r.fill).size * (1 + (landed ? 0.9 : 0.3) * k);
      r.mat.uniforms.uAlpha.value = (1 - k) * (landed ? 1 : 0.6);
      r.mat.uniforms.uClose.value = landed ? 1 : r.fill * (1 - k);
    }
  }

  private updateLines(world: IWorld, dt: number): void {
    for (const l of this.lines) {
      if (l.sergeantId < 0) continue;
      const shooter = world.entities.get(l.shooterId);
      const mark = world.entities.get(l.markId);
      const fill = this.shoutFill(world, l.sergeantId, l.markId);
      if (!shooter || shooter.dead || !mark || mark.dead) {
        l.sergeantId = -1;
        l.mesh.visible = false;
        continue;
      }
      let alpha: number;
      let look = aimLineLook(fill ?? 1);
      if (fill !== null && l.fade < 0) {
        alpha = look.alpha;
        l.alpha = alpha;
      } else {
        if (l.fade < 0) l.fade = 0;
        l.fade += dt;
        const k = l.fade / LINE_FADE_SEC;
        if (k >= 1) {
          l.sergeantId = -1;
          l.mesh.visible = false;
          continue;
        }
        look = aimLineLook(1);
        alpha = l.alpha * (1 - k);
      }
      const facing = Math.atan2(mark.pos.x - shooter.pos.x, mark.pos.z - shooter.pos.z);
      const m = modelPointWorld(
        shooter.pos.x,
        shooter.pos.y,
        shooter.pos.z,
        facing,
        this.arbalestK,
        ARBALEST_MUZZLE,
        this.tmp,
      );
      this.v1.set(m.x, m.y, m.z);
      this.v2.set(mark.pos.x, mark.pos.y + MARK_CHEST, mark.pos.z);
      const len = this.v1.distanceTo(this.v2);
      if (len < 0.2) {
        l.mesh.visible = false;
        continue;
      }
      l.mesh.visible = true;
      l.mesh.position.copy(this.v1);
      l.mesh.lookAt(this.v2);
      l.mesh.scale.set(look.width, look.width, len);
      l.mat.uniforms.uAlpha.value = alpha;
      l.mat.uniforms.uLen.value = len;
      l.mat.uniforms.uFlow.value = look.flow;
    }
  }

  private updateBolts(_dt: number): void {
    const now = this.clock;
    for (const slot of this.bolts) {
      if (!slot.alive) continue;
      if (!slot.landed) {
        const f = Math.min(1, (now - slot.born) / slot.flight);
        this.v1.copy(slot.from).lerp(slot.to, f);
        slot.group.position.copy(this.v1);
        this.v2.copy(slot.to).sub(slot.from);
        const dist = this.v2.length();
        if (dist > 1e-4) {
          this.v2.divideScalar(dist);
          slot.group.lookAt(this.v1.x + this.v2.x, this.v1.y + this.v2.y, this.v1.z + this.v2.z);
        }
        slot.trail.scale.set(0.42, 0.42, Math.max(0.01, markedTrailLength(dist * f)));
        // Brine sheds off the shaft in flight (density sheds the puffs only).
        if (now >= slot.nextSpray && !this.reducedMotion()) {
          slot.nextSpray = now + SPRAY_INTERVAL / Math.max(0.25, this.density);
          this.burst(
            now,
            this.v1,
            (this.rand() - 0.5) * 1.2,
            0.2 + this.rand() * 0.6,
            (this.rand() - 0.5) * 1.2,
            0.45 + this.rand() * 0.25,
            0.22,
            0.85,
            0.6,
            0.74,
            0.72,
            0.16,
            this.mist,
          );
          this.burst(now, this.v1, 0, 0, 0, 0.12, 0.42, 0.1, 1, 0.3, 0.16, 0.6, this.glow);
        }
        if (f >= 1) {
          slot.landed = true;
          slot.fadeFrom = now;
          // A blocked bolt stands quivering in the stone a beat; a hit is gone.
          slot.body.visible = slot.blocked;
          this.impact(slot.to, this.v2, slot.blocked);
        }
      } else {
        const t = now - slot.fadeFrom;
        const fade = 1 - t / TRAIL_FADE_SEC;
        slot.trailMat.opacity = Math.max(0, fade);
        if (slot.blocked && slot.body.visible) {
          // The quiver: a damped shake about its stuck point.
          slot.body.rotation.y = Math.sin(t * 60) * 0.08 * Math.max(0, 1 - t / 0.5);
        }
        if (t > (slot.blocked ? 0.9 : TRAIL_FADE_SEC)) {
          slot.alive = false;
          slot.group.visible = false;
          slot.body.rotation.y = 0;
        }
      }
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
