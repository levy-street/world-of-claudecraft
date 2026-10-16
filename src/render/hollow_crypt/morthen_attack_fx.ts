// Morthen's blows on the Rite Ring (host: morthen_rite_fx.ts; plan:
// morthen_rite_fx_core.ts), read off his cast bars, facing and the Grasp's
// encounter objects:
//  - Shadow Pulse: a 12 yd ring on the floor round him (the danger orange of
//    the shared palette, his shadow accent) filling over the 2 s bar while
//    shadow is drawn in off its rim; on the toll a violet shockwave rolls out
//    to its edge in a ring of grave smoke (the bell's own rings are
//    morthen_fx.ts's);
//  - Reap the Unquiet: a HUGE lethal-red 120 degree, 14 yd cone from his
//    locked facing, red-black smoke boiling inside it, filling over the bar
//    while he raises the scythe; on the landing a crescent of red-black soul
//    fire sweeps across the whole cone as the ScytheSweep cuts;
//  - heroic Grasp of the Grave: a 4 yd violet ring locked under the marked
//    player gathering over the 1.5 s fuse, then skeletal hands burst out of
//    the floor round it and hold, and two more grip each rooted player's feet.
//
// The ring, the cone, the Grasp ring and the hands are ACTIONABLE: every tier.
// The smoke, embers and bursts are cosmetic and thin on the low tier.

import * as THREE from 'three';
import {
  MORTHEN_GRASP_ERUPTS,
  MORTHEN_GRASP_HANDS_TEMPLATE,
  MORTHEN_REAP,
  MORTHEN_SHADOW_PULSE,
} from '../../sim/encounters/hollow_crypt/morthen_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { type TelegraphFan, telegraphFillOf } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  type CragDrapeMemo,
  cragDrapeMemo,
  drapeFanOnCrag,
  resetCragDrape,
} from './crag_fan_drape';
import { coneSpot } from './crypt_creature_fx_core';
import { MORTHEN_REAP_SWEEP } from './morthen_fx_core';
import {
  cragRimRadius,
  graspFill,
  graspHandSpots,
  HANDS_SINK_SEC,
  handsRise,
  handsSink,
  MORTHEN_TELEGRAPHS,
  onCragFloor,
  pulseCharge,
  REAP_SWEEP_SEC,
  reapSweep,
} from './morthen_rite_fx_core';
import { RITE_MESH_VERT, type RiteFxHost, type RitePainter } from './morthen_rite_host';

const GRASP_SLOTS = 4;
const HANDS_PER_RING = 7;
const GRIP_SLOTS = 4;
const HANDS_PER_GRIP = 2;
const HAND_COUNT = GRASP_SLOTS * HANDS_PER_RING + GRIP_SLOTS * HANDS_PER_GRIP;
const CRESCENTS = 2;
const ARC_SEGMENTS = 48;
const HAND_SPOTS = graspHandSpots(HANDS_PER_RING);

/** The Reap's crescent: red-black soul fire between its fading tail and the
 *  white-hot leading edge, hottest along the blade's outer rim. */
const CRESCENT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHead;
uniform float uTail;
uniform float uAlpha;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float u = vUv.x;
  float v = vUv.y;
  if (u > uHead || u < uTail) discard;
  float along = (u - uTail) / max(uHead - uTail, 1e-3);
  float lead = smoothstep(0.8, 1.0, along);
  float n = vnoise(vec2(u * 26.0 - uTime * 4.0, v * 6.0));
  float rim = smoothstep(0.72, 1.0, v);
  vec3 dark = vec3(0.09, 0.0, 0.012);
  vec3 hot = vec3(2.8, 0.42, 0.3);
  float heat = clamp(lead * 0.95 + rim * 0.5 * along + n * 0.18, 0.0, 1.0);
  vec3 col = mix(dark, hot, heat);
  float body = (0.3 + 0.7 * along) * (0.55 + 0.45 * n) * smoothstep(0.0, 0.14, v);
  gl_FragColor = vec4(col, clamp(body * uAlpha, 0.0, 1.0));
}
`;

/** The grave's hands: old bone lit by the crypt's moon, soul fire licking up
 *  them out of the floor they burst from. Opaque (instanced). */
const HAND_VERT = /* glsl */ `
varying vec3 vN;
varying float vY;
${CAMERA_RELATIVE_GLSL}
void main() {
  vY = position.y;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * wocCamRelView(w.xyz);
}
`;
const HAND_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying float vY;
void main() {
  vec3 n = normalize(vN);
  float key = max(dot(n, normalize(vec3(0.35, 0.8, 0.45))), 0.0);
  float under = max(-n.y, 0.0);
  vec3 bone = vec3(0.74, 0.7, 0.6);
  vec3 col = bone * (0.2 + 0.62 * key) + vec3(0.25, 0.9, 0.35) * under * 0.22;
  float grave = 1.0 - smoothstep(-0.2, 1.0, vY);
  col += vec3(0.45, 1.0, 0.4) * grave * (0.5 + 0.25 * sin(uTime * 6.0 + vY * 9.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

/** A crescent band over the Reap's arc: u runs the arc from his right (0) to
 *  his left (1), v the radius (0 inner, 1 the reach). Local +z his front. */
function crescentGeometry(arcDeg: number): THREE.BufferGeometry {
  const half = (arcDeg * Math.PI) / 360;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const u = i / ARC_SEGMENTS;
    const a = -half + 2 * half * u;
    for (const [r, v] of [
      [0.12, 0],
      [1, 1],
    ] as const) {
      pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
      uv.push(u, v);
    }
    if (i > 0) {
      const b = (i - 1) * 2;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A skeletal hand clawing up out of the floor: the forearm's two bones from
 *  deep under the flags to the wrist, the carpals, four fingers of three
 *  joints each curled forward (+z) and a thumb. Authored about two yards from
 *  the floor to the knuckles (giant grave hands). */
function handGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const seg = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number) => {
    const dir = b.clone().sub(a);
    const len = Math.max(1e-3, dir.length());
    const g = new THREE.CylinderGeometry(r1, r0, len, 6, 1, false);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(q.setFromUnitVectors(up, dir.normalize()));
    g.translate(a.x, a.y, a.z);
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  seg(v(-0.08, -2.6, 0), v(-0.07, 0.95, 0.02), 0.07, 0.055);
  seg(v(0.08, -2.6, 0), v(0.08, 0.95, 0), 0.065, 0.05);
  seg(v(0, 0.88, 0.01), v(0, 1.14, 0.03), 0.12, 0.14);
  for (let k = 0; k < 4; k++) {
    const x0 = (k - 1.5) * 0.08;
    const x1 = (k - 1.5) * 0.12;
    const knuckle = v(x1, 1.5, 0.06);
    seg(v(x0, 1.1, 0.03), knuckle, 0.034, 0.03);
    const len = 1 - Math.abs(k - 1.5) * 0.12;
    let p = knuckle;
    for (const [dy, dz, l, r0, r1] of [
      [0.8, 0.6, 0.3, 0.03, 0.026],
      [0.15, 1, 0.24, 0.026, 0.021],
      [-0.6, 0.8, 0.18, 0.021, 0.012],
    ] as const) {
      const d = v(0, dy, dz)
        .normalize()
        .multiplyScalar(l * len);
      const next = p.clone().add(d);
      seg(p, next, r0, r1);
      p = next;
    }
  }
  seg(v(0.13, 1.08, 0.03), v(0.28, 1.3, 0.13), 0.034, 0.028);
  seg(v(0.28, 1.3, 0.13), v(0.32, 1.46, 0.32), 0.026, 0.014);
  let count = 0;
  for (const g of parts) count += g.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

interface Crescent {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  /** The floor under him as it landed (the sweep stays on the crag top). */
  floor: number;
  born: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  alive: boolean;
  emitted: number;
}

interface GraspSlot {
  objectId: number;
  fan: TelegraphFan;
  born: number;
  /** When its hands erupted (-1: still gathering). */
  handsAt: number;
  /** When the ring left (-1: still holding); the hands sink after it. */
  sinkAt: number;
  x: number;
  z: number;
  radius: number;
  /** The floor under the ring (its hands stay on the crag top). */
  floor: number;
  memo: CragDrapeMemo;
}

interface GripSlot {
  playerId: number;
  born: number;
  sinkAt: number;
  x: number;
  z: number;
}

export class MorthenAttackFx implements RitePainter {
  private readonly pulse: TelegraphFan;
  private readonly reap: TelegraphFan;
  private readonly grasps: GraspSlot[] = [];
  private readonly grips: GripSlot[] = [];
  private readonly crescents: Crescent[] = [];
  private readonly hands: THREE.InstancedMesh;
  private readonly handMat: THREE.ShaderMaterial;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p3 = new THREE.Vector3();
  private readonly s3 = new THREE.Vector3();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private pulseOn = false;
  private reapOn = false;
  private readonly pulseMemo = cragDrapeMemo();
  private readonly reapMemo = cragDrapeMemo();

  constructor(private readonly h: RiteFxHost) {
    const S = MORTHEN_TELEGRAPHS;
    this.pulse = h.kit.fan(10);
    h.kit.layOutFan(this.pulse, S.pulse.arcDeg, { color: S.pulse.color, accent: S.pulse.accent });
    this.reap = h.kit.fan(11);
    h.kit.layOutFan(this.reap, S.reap.arcDeg, { color: S.reap.color, accent: S.reap.accent });
    for (let i = 0; i < GRASP_SLOTS; i++) {
      const fan = h.kit.fan(12);
      h.kit.layOutFan(fan, S.grasp.arcDeg, { color: S.grasp.color, accent: S.grasp.accent });
      this.grasps.push({
        objectId: -1,
        fan,
        born: 0,
        handsAt: -1,
        sinkAt: -1,
        x: 0,
        z: 0,
        radius: S.grasp.radius,
        floor: 0,
        memo: cragDrapeMemo(),
      });
    }
    for (let i = 0; i < GRIP_SLOTS; i++)
      this.grips.push({ playerId: -1, born: 0, sinkAt: -1, x: 0, z: 0 });
    for (let i = 0; i < CRESCENTS; i++) {
      // Each its own: a landing near the rim cuts its band back to the crag.
      const crescentGeo = h.own(crescentGeometry(S.reap.arcDeg));
      const mat = h.own(
        new THREE.ShaderMaterial({
          uniforms: {
            uTime: h.uTime,
            uHead: { value: 0 },
            uTail: { value: 0 },
            uAlpha: { value: 0 },
          },
          vertexShader: RITE_MESH_VERT,
          fragmentShader: CRESCENT_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      const mesh = new THREE.Mesh(crescentGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 28);
      h.root.add(mesh);
      this.crescents.push({
        mesh,
        mat,
        born: 0,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        alive: false,
        emitted: 0,
        floor: 0,
      });
    }
    this.handMat = h.own(
      new THREE.ShaderMaterial({
        uniforms: { uTime: h.uTime },
        vertexShader: HAND_VERT,
        fragmentShader: HAND_FRAG,
      }),
    );
    this.hands = new THREE.InstancedMesh(h.own(handGeometry()), this.handMat, HAND_COUNT);
    this.hands.frustumCulled = false;
    for (let i = 0; i < HAND_COUNT; i++) this.hands.setMatrixAt(i, this.zero);
    this.hands.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.hands.visible = false;
    h.root.add(this.hands);
  }

  // ------------------------------------------------------------------ events

  handleEvent(ev: SimEvent, world: IWorld): void {
    if (ev.type !== 'spellfx') return;
    if (ev.ability === MORTHEN_SHADOW_PULSE && ev.fx === 'nova') {
      const m = world.entities.get(ev.sourceId);
      if (m) this.toll(m);
    } else if (ev.ability === MORTHEN_REAP && ev.fx === 'nova') {
      const m = world.entities.get(ev.sourceId);
      if (m) this.reapLands(m);
    } else if (ev.ability === MORTHEN_GRASP_ERUPTS) {
      const ring = world.entities.get(ev.targetId);
      if (ring) this.erupt(ring);
    }
  }

  /** The toll lands: shadow rolls out to the ring's edge. */
  private toll(m: Entity): void {
    const h = this.h;
    const R = MORTHEN_TELEGRAPHS.pulse.radius;
    const gy = h.groundY(m.pos.x, m.pos.z);
    h.wave(m.pos.x, m.pos.z, R + 0.5, 0.55, 0x9a6bff, 0.22);
    h.wave(m.pos.x, m.pos.z, R * 0.6, 0.4, 0xe0d4ff, 0.3);
    const n = Math.round(110 * h.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + h.rand() * 0.1;
      const sp = 12 + h.rand() * 6;
      {
        const ps = h.ps();
        ps.x = m.pos.x + Math.sin(a) * 1.5;
        ps.y = gy + 0.4 + h.rand() * 0.8;
        ps.z = m.pos.z + Math.cos(a) * 1.5;
        ps.vx = Math.sin(a) * sp;
        ps.vy = 0.3 + h.rand() * 0.8;
        ps.vz = Math.cos(a) * sp;
        ps.life = 1 + h.rand() * 0.4;
        ps.drag = 1.25;
        ps.floor = gy + 0.2;
        ps.size0 = 1.4;
        ps.size1 = 3.8 + h.rand() * 1.6;
        ps.spin = (h.rand() - 0.5) * 0.8;
        ps.r = 0.07;
        ps.g = 0.05;
        ps.b = 0.1;
        ps.a = 0.5;
        h.dust.emit(h.clock() + h.rand() * 0.06, ps);
      }
    }
    const g = Math.round(70 * h.density);
    for (let i = 0; i < g; i++) {
      const a = h.rand() * Math.PI * 2;
      const sp = 9 + h.rand() * 7;
      {
        const ps = h.ps();
        ps.x = m.pos.x;
        ps.y = gy + 0.5;
        ps.z = m.pos.z;
        ps.vx = Math.sin(a) * sp;
        ps.vy = 0.5 + h.rand() * 2;
        ps.vz = Math.cos(a) * sp;
        ps.life = 0.7 + h.rand() * 0.4;
        ps.drag = 1.4;
        ps.size0 = 0.32;
        ps.size1 = 0.06;
        ps.r = 0.68;
        ps.g = 0.45;
        ps.b = 1;
        ps.a = 0.9;
        h.glow.emit(h.clock(), ps);
      }
    }
    h.shakeAt(m.pos.x, m.pos.z, 0.35);
  }

  /** The Reap lands: the scythe comes round and its crescent sweeps the cone. */
  private reapLands(m: Entity): void {
    const h = this.h;
    h.gesture(m.id, MORTHEN_REAP_SWEEP);
    const c = this.crescents.find((q) => !q.alive) ?? this.crescents[0];
    c.alive = true;
    c.born = h.clock();
    c.emitted = 0;
    c.x = m.pos.x;
    c.z = m.pos.z;
    c.floor = h.groundY(m.pos.x, m.pos.z);
    c.y = c.floor + 1.1;
    c.yaw = m.facing;
    this.clipCrescent(c);
    c.mesh.position.set(c.x, c.y, c.z);
    c.mesh.rotation.set(0, c.yaw, 0);
    c.mesh.scale.setScalar(MORTHEN_TELEGRAPHS.reap.radius);
    c.mat.uniforms.uHead.value = 0;
    c.mat.uniforms.uTail.value = 0;
    h.shakeAt(m.pos.x, m.pos.z, 0.6);
  }

  /** Cut the crescent's band back to the crag top along each of its spokes
   *  (a Reap at the rim never sweeps out over the floor far below). */
  private clipCrescent(c: Crescent): void {
    const S = MORTHEN_TELEGRAPHS.reap;
    const half = (S.arcDeg * Math.PI) / 360;
    const pos = c.mesh.geometry.getAttribute('position');
    const cols = pos.count / 2;
    for (let i = 0; i < cols; i++) {
      const th = -half + (2 * half * i) / (cols - 1);
      const a = c.yaw + th;
      const rim = cragRimRadius(
        this.h.groundY,
        c.x,
        c.z,
        Math.sin(a),
        Math.cos(a),
        c.floor,
        S.radius,
      );
      const outer = Math.min(1, rim / S.radius);
      const inner = Math.min(0.12, outer);
      pos.setXYZ(i * 2, Math.sin(th) * inner, 0, Math.cos(th) * inner);
      pos.setXYZ(i * 2 + 1, Math.sin(th) * outer, 0, Math.cos(th) * outer);
    }
    pos.needsUpdate = true;
  }

  /** The hands burst out of a ring. */
  private erupt(ring: Entity): void {
    const h = this.h;
    const slot = this.grasps.find((g) => g.objectId === ring.id);
    if (slot && slot.handsAt < 0) slot.handsAt = h.clock();
    const R = ring.scale || MORTHEN_TELEGRAPHS.grasp.radius;
    const gy = h.groundY(ring.pos.x, ring.pos.z);
    h.wave(ring.pos.x, ring.pos.z, R + 1, 0.4, 0xb67bff, 0.3);
    h.flash(ring.pos.x, gy + 1, ring.pos.z, R * 1.6, 0.35, 0x8a5bd8);
    const n = Math.round(60 * h.density);
    for (let i = 0; i < n; i++) {
      const a = h.rand() * Math.PI * 2;
      const r = Math.sqrt(h.rand()) * R;
      {
        const ps = h.ps();
        ps.x = ring.pos.x + Math.sin(a) * r;
        ps.y = gy + 0.2;
        ps.z = ring.pos.z + Math.cos(a) * r;
        ps.vx = Math.sin(a) * 2;
        ps.vy = 2 + h.rand() * 3;
        ps.vz = Math.cos(a) * 2;
        ps.ay = -3;
        ps.life = 1 + h.rand() * 0.6;
        ps.drag = 1.5;
        ps.floor = gy + 0.15;
        ps.size0 = 0.8;
        ps.size1 = 2.4;
        ps.r = 0.3;
        ps.g = 0.27;
        ps.b = 0.24;
        ps.a = 0.5;
        h.dust.emit(h.clock(), ps);
      }
      if (i % 2 === 0) {
        const ps = h.ps();
        ps.x = ring.pos.x + Math.sin(a) * r;
        ps.y = gy + 0.3;
        ps.z = ring.pos.z + Math.cos(a) * r;
        ps.vx = Math.sin(a) * 3;
        ps.vy = 3 + h.rand() * 4;
        ps.vz = Math.cos(a) * 3;
        ps.ay = -6;
        ps.life = 0.8;
        ps.drag = 0.8;
        ps.size0 = 0.14;
        ps.size1 = 0.05;
        ps.r = 0.95;
        ps.g = 0.92;
        ps.b = 0.85;
        ps.a = 1;
        h.glow.emit(h.clock(), ps);
      }
    }
    h.shakeAt(ring.pos.x, ring.pos.z, 0.2);
  }

  // ------------------------------------------------------------------- frame

  update(world: IWorld, dt: number): void {
    const h = this.h;
    const m = h.scan.morthenId >= 0 ? world.entities.get(h.scan.morthenId) : undefined;
    const alive = !!m && !m.dead;
    this.stepPulse(alive ? m : undefined, dt);
    this.stepReap(alive ? m : undefined, dt);
    this.stepCrescents(dt);
    this.stepGrasps(world, dt);
  }

  private stepPulse(m: Entity | undefined, dt: number): void {
    const h = this.h;
    const on = !!m && m.castingAbility === MORTHEN_SHADOW_PULSE;
    if (on !== this.pulseOn) {
      this.pulseOn = on;
      this.pulse.group.visible = on;
    }
    if (!m || !on) return;
    const R = MORTHEN_TELEGRAPHS.pulse.radius;
    const gy = h.groundY(m.pos.x, m.pos.z);
    const fill = telegraphFillOf(m.castRemaining, m.castTotal);
    drapeFanOnCrag(h.kit, this.pulse, h.groundY, m.pos.x, gy, m.pos.z, 0, R, this.pulseMemo);
    h.kit.paintFan(this.pulse, { fill, clock: h.clock(), range: R });
    // Shadow drawn in off the rim toward him as the toll gathers.
    const charge = pulseCharge(fill);
    const n = 60 * charge * h.density * dt;
    for (let i = 0; i < Math.floor(n + h.rand()); i++) {
      const a = h.rand() * Math.PI * 2;
      const x = m.pos.x + Math.sin(a) * R;
      const z = m.pos.z + Math.cos(a) * R;
      const ly = h.groundY(x, z);
      if (!onCragFloor(ly, gy)) continue;
      {
        const ps = h.ps();
        ps.x = x;
        ps.y = ly + 0.3 + h.rand() * 0.5;
        ps.z = z;
        ps.vx = -Math.sin(a) * 9;
        ps.vy = 0.2;
        ps.vz = -Math.cos(a) * 9;
        ps.life = 0.9;
        ps.drag = 0.9;
        ps.size0 = 1.6;
        ps.size1 = 0.5;
        ps.spin = (h.rand() - 0.5) * 1.2;
        ps.r = 0.06;
        ps.g = 0.04;
        ps.b = 0.09;
        ps.a = 0.42;
        h.mist.emit(h.clock(), ps);
      }
      if (i % 2 === 0) {
        const ps = h.ps();
        ps.x = x;
        ps.y = ly + 0.2;
        ps.z = z;
        ps.vx = 0;
        ps.vy = 1 + h.rand() * 1.5;
        ps.vz = 0;
        ps.life = 0.7;
        ps.drag = 0.6;
        ps.size0 = 0.22;
        ps.size1 = 0.05;
        ps.r = 0.66;
        ps.g = 0.45;
        ps.b = 1;
        ps.a = 0.85;
        h.glow.emit(h.clock(), ps);
      }
    }
  }

  private stepReap(m: Entity | undefined, dt: number): void {
    const h = this.h;
    const on = !!m && m.castingAbility === MORTHEN_REAP;
    if (on !== this.reapOn) {
      this.reapOn = on;
      this.reap.group.visible = on;
    }
    if (!m || !on) return;
    const S = MORTHEN_TELEGRAPHS.reap;
    const gy = h.groundY(m.pos.x, m.pos.z);
    const fill = telegraphFillOf(m.castRemaining, m.castTotal);
    drapeFanOnCrag(
      h.kit,
      this.reap,
      h.groundY,
      m.pos.x,
      gy,
      m.pos.z,
      m.facing,
      S.radius,
      this.reapMemo,
    );
    h.kit.paintFan(this.reap, { fill, clock: h.clock(), range: S.radius });
    // Red-black smoke boiling inside the cone, embers lifting off its rim.
    const c = Math.cos(m.facing);
    const s = Math.sin(m.facing);
    const n = (30 + 50 * fill) * h.density * dt;
    for (let i = 0; i < Math.floor(n + h.rand()); i++) {
      const spot = coneSpot(Math.floor(h.rand() * 997), 997, S.radius, S.arcDeg, 1.5);
      const x = m.pos.x + spot.x * c + spot.z * s;
      const z = m.pos.z - spot.x * s + spot.z * c;
      const ly = h.groundY(x, z);
      if (onCragFloor(ly, gy)) {
        const ps = h.ps();
        ps.x = x;
        ps.y = ly + 0.2;
        ps.z = z;
        ps.vx = (h.rand() - 0.5) * 0.6;
        ps.vy = 0.5 + h.rand() * 0.6;
        ps.vz = (h.rand() - 0.5) * 0.6;
        ps.life = 1.2 + h.rand() * 0.6;
        ps.drag = 0.8;
        ps.size0 = 1.2;
        ps.size1 = 2.6;
        ps.spin = h.rand() - 0.5;
        ps.r = 0.16;
        ps.g = 0.01;
        ps.b = 0.02;
        ps.a = 0.34;
        h.mist.emit(h.clock(), ps);
      }
      const a = (h.rand() * 2 - 1) * ((S.arcDeg * Math.PI) / 360);
      const rx = m.pos.x + Math.sin(m.facing + a) * S.radius;
      const rz = m.pos.z + Math.cos(m.facing + a) * S.radius;
      const ry = h.groundY(rx, rz);
      if (onCragFloor(ry, gy)) {
        const ps = h.ps();
        ps.x = rx;
        ps.y = ry + 0.2;
        ps.z = rz;
        ps.vx = 0;
        ps.vy = 1.4 + h.rand() * 2 * fill;
        ps.vz = 0;
        ps.life = 0.8;
        ps.drag = 0.5;
        ps.size0 = 0.2;
        ps.size1 = 0.05;
        ps.r = 1;
        ps.g = 0.16;
        ps.b = 0.1;
        ps.a = 0.9;
        h.glow.emit(h.clock(), ps);
      }
    }
  }

  private stepCrescents(dt: number): void {
    const h = this.h;
    const R = MORTHEN_TELEGRAPHS.reap.radius;
    const half = (MORTHEN_TELEGRAPHS.reap.arcDeg * Math.PI) / 360;
    for (const c of this.crescents) {
      if (!c.alive) continue;
      const t = h.clock() - c.born;
      const plan = reapSweep(t);
      if (!plan) {
        c.alive = false;
        c.mesh.visible = false;
        continue;
      }
      c.mesh.visible = true;
      c.mat.uniforms.uHead.value = plan.head;
      c.mat.uniforms.uTail.value = plan.tail;
      c.mat.uniforms.uAlpha.value = plan.alpha;
      if (t > REAP_SWEEP_SEC) continue;
      // The blade's edge throws red-black fire and sparks across the floor.
      const a = c.yaw - half + 2 * half * plan.head;
      c.emitted += 260 * h.density * dt;
      while (c.emitted >= 1) {
        c.emitted -= 1;
        const r = R * (0.2 + 0.8 * Math.sqrt(h.rand()));
        const x = c.x + Math.sin(a) * r;
        const z = c.z + Math.cos(a) * r;
        const gy = h.groundY(x, z);
        if (!onCragFloor(gy, c.floor)) continue;
        const tx = Math.cos(a);
        const tz = -Math.sin(a);
        {
          const ps = h.ps();
          ps.x = x;
          ps.y = gy + 0.4 + h.rand();
          ps.z = z;
          ps.vx = tx * 4 + (h.rand() - 0.5);
          ps.vy = 0.8 + h.rand();
          ps.vz = tz * 4 + (h.rand() - 0.5);
          ps.life = 0.9 + h.rand() * 0.5;
          ps.drag = 1.4;
          ps.size0 = 1.4;
          ps.size1 = 3.2;
          ps.spin = (h.rand() - 0.5) * 1.4;
          ps.r = 0.14;
          ps.g = 0.0;
          ps.b = 0.02;
          ps.a = 0.5;
          h.dust.emit(h.clock(), ps);
        }
        if (h.rand() < 0.6) {
          const ps = h.ps();
          ps.x = x;
          ps.y = gy + 0.6 + h.rand() * 1.2;
          ps.z = z;
          ps.vx = tx * 7 + (h.rand() - 0.5) * 2;
          ps.vy = 1 + h.rand() * 3;
          ps.vz = tz * 7 + (h.rand() - 0.5) * 2;
          ps.life = 0.5 + h.rand() * 0.3;
          ps.drag = 1.6;
          ps.size0 = 0.3;
          ps.size1 = 0.06;
          ps.r = 1;
          ps.g = h.rand() < 0.2 ? 0.85 : 0.2;
          ps.b = 0.12;
          ps.a = 1;
          h.glow.emit(h.clock(), ps);
        }
      }
    }
  }

  // ------------------------------------------------------------------- grasp

  private stepGrasps(world: IWorld, dt: number): void {
    const h = this.h;
    const now = h.clock();
    // Claim the rings the scan sees; a ring that left starts its hands sinking.
    for (const id of h.scan.grasps) {
      let held = false;
      let slot: GraspSlot | null = null;
      for (const g of this.grasps) {
        if (g.objectId === id) held = true;
        else if (!slot && g.objectId < 0 && g.sinkAt < 0) slot = g;
      }
      if (held) continue;
      const e = world.entities.get(id);
      if (!e || !slot) continue;
      slot.objectId = id;
      slot.born = now;
      slot.handsAt = e.templateId === MORTHEN_GRASP_HANDS_TEMPLATE ? now : -1;
      slot.sinkAt = -1;
      slot.x = e.pos.x;
      slot.z = e.pos.z;
      slot.radius = e.scale || MORTHEN_TELEGRAPHS.grasp.radius;
      slot.floor = h.groundY(e.pos.x, e.pos.z);
      resetCragDrape(slot.memo);
      slot.fan.group.visible = true;
    }
    for (const g of this.grasps) {
      if (g.objectId < 0) continue;
      const e = world.entities.get(g.objectId);
      if (!e) {
        g.objectId = -1;
        g.fan.group.visible = false;
        if (g.handsAt >= 0) g.sinkAt = now;
        continue;
      }
      if (e.templateId === MORTHEN_GRASP_HANDS_TEMPLATE && g.handsAt < 0) g.handsAt = now;
      g.x = e.pos.x;
      g.z = e.pos.z;
      g.radius = e.scale || g.radius;
      const gy = g.floor;
      drapeFanOnCrag(h.kit, g.fan, h.groundY, g.x, gy, g.z, 0, g.radius, g.memo);
      if (g.handsAt < 0) {
        const fill = graspFill(now - g.born);
        h.kit.paintFan(g.fan, { fill, clock: now, range: g.radius });
        // Grave dust stirring and violet motes drawn round the ring.
        const n = (20 + 50 * fill) * h.density * dt;
        for (let i = 0; i < Math.floor(n + h.rand()); i++) {
          const a = h.rand() * Math.PI * 2;
          const r = g.radius * (0.3 + 0.7 * h.rand());
          const tang = a + Math.PI / 2;
          {
            const ps = h.ps();
            ps.x = g.x + Math.sin(a) * r;
            ps.y = gy + 0.15;
            ps.z = g.z + Math.cos(a) * r;
            ps.vx = Math.sin(tang) * 2 - Math.sin(a);
            ps.vy = 0.6 + h.rand() * 1.2 * fill;
            ps.vz = Math.cos(tang) * 2 - Math.cos(a);
            ps.life = 0.7;
            ps.drag = 0.8;
            ps.size0 = 0.2;
            ps.size1 = 0.05;
            ps.r = 0.72;
            ps.g = 0.5;
            ps.b = 1;
            ps.a = 0.85;
            h.glow.emit(now, ps);
          }
          if (i % 3 === 0) {
            const ps = h.ps();
            ps.x = g.x + Math.sin(a) * r;
            ps.y = gy + 0.2;
            ps.z = g.z + Math.cos(a) * r;
            ps.vx = 0;
            ps.vy = 0.4 + h.rand() * 0.6 * fill;
            ps.vz = 0;
            ps.life = 1;
            ps.drag = 1;
            ps.size0 = 0.6;
            ps.size1 = 1.6;
            ps.r = 0.26;
            ps.g = 0.24;
            ps.b = 0.22;
            ps.a = 0.35;
            h.mist.emit(now, ps);
          }
        }
      } else {
        // The hands hold: the ring stays on the floor, quieter, as the zone.
        h.kit.paintFan(g.fan, { fill: 1, clock: now, range: g.radius, fade: 0.55, front: 0 });
      }
    }
    // The grips at each rooted player's feet.
    for (const id of h.scan.rooted) {
      let held = false;
      let slot: GripSlot | null = null;
      for (const g of this.grips) {
        if (g.playerId === id) held = true;
        else if (!slot && g.playerId < 0 && g.sinkAt < 0) slot = g;
      }
      if (held) continue;
      const p = world.entities.get(id);
      if (!p || !slot) continue;
      slot.playerId = id;
      slot.born = now;
      slot.sinkAt = -1;
      slot.x = p.pos.x;
      slot.z = p.pos.z;
    }
    for (const g of this.grips) {
      if (g.playerId < 0) continue;
      const p = world.entities.get(g.playerId);
      let rooted = false;
      for (let k = 0; k < h.scan.rooted.length; k++)
        if (h.scan.rooted[k] === g.playerId) rooted = true;
      if (!p || p.dead || !rooted) {
        g.playerId = -1;
        g.sinkAt = now;
        continue;
      }
      g.x = p.pos.x;
      g.z = p.pos.z;
    }
    this.layHands(now);
  }

  /** Every hand's matrix this frame (risen, holding, sinking or hidden). */
  private layHands(now: number): void {
    const h = this.h;
    let any = false;
    let k = 0;
    for (const g of this.grasps) {
      let rise = 0;
      if (g.handsAt >= 0) {
        rise = handsRise(now - g.handsAt);
        if (g.sinkAt >= 0) {
          const sink = handsSink(now - g.sinkAt);
          rise *= sink;
          if (now - g.sinkAt > HANDS_SINK_SEC) {
            g.handsAt = -1;
            g.sinkAt = -1;
            rise = 0;
          }
        }
      }
      for (let i = 0; i < HANDS_PER_RING; i++, k++) {
        if (rise <= 0.001) {
          this.hands.setMatrixAt(k, this.zero);
          continue;
        }
        any = true;
        const spot = HAND_SPOTS[i];
        const x = g.x + spot.x * g.radius;
        const z = g.z + spot.z * g.radius;
        const hy = h.groundY(x, z);
        // A ring at the rim: no hand claws up out of the cliff.
        if (!onCragFloor(hy, g.floor)) {
          this.hands.setMatrixAt(k, this.zero);
          continue;
        }
        const sc = (g.radius / 4) * spot.scale;
        const clutch = 0.22 + 0.1 * Math.sin(now * 3.1 + i * 1.9);
        this.place(
          k,
          x,
          hy - 2.4 * sc * (1 - Math.min(1, rise)),
          z,
          spot.yaw,
          clutch,
          sc * Math.max(1, rise),
        );
      }
    }
    for (const g of this.grips) {
      let rise = 0;
      if (g.playerId >= 0) rise = handsRise(now - g.born);
      else if (g.sinkAt >= 0) {
        rise = handsSink(now - g.sinkAt);
        if (now - g.sinkAt > HANDS_SINK_SEC) {
          g.sinkAt = -1;
          rise = 0;
        }
      }
      for (let i = 0; i < HANDS_PER_GRIP; i++, k++) {
        if (rise <= 0.001) {
          this.hands.setMatrixAt(k, this.zero);
          continue;
        }
        any = true;
        const a = i * Math.PI + 0.6;
        const x = g.x + Math.sin(a) * 0.55;
        const z = g.z + Math.cos(a) * 0.55;
        const sc = 0.62;
        this.place(
          k,
          x,
          h.groundY(x, z) - 2.4 * sc * (1 - Math.min(1, rise)),
          z,
          a + Math.PI,
          0.5,
          sc,
        );
      }
    }
    // Nothing risen now or last frame: no upload.
    if (any || this.hands.visible) this.hands.instanceMatrix.needsUpdate = true;
    this.hands.visible = any;
  }

  private place(
    k: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    lean: number,
    s: number,
  ): void {
    this.e.set(lean, yaw, 0, 'YXZ');
    this.q.setFromEuler(this.e);
    this.p3.set(x, y, z);
    this.s3.set(s, s, s);
    this.m4.compose(this.p3, this.q, this.s3);
    this.hands.setMatrixAt(k, this.m4);
  }
}
