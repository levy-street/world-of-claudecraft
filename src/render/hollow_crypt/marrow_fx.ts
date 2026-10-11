// Sexton Marrow's effects on the crypt boss host (crypt_boss_fx.ts), read off
// the sim (src/sim/encounters/hollow_crypt/marrow.ts):
//
//  - Shovelful: the cone floor telegraph filling with his bar (aim locked by
//    the sim), then a spray of grave dirt and clods flung down it;
//  - Measured for the Grave: the ring under the marked player filling as the
//    mark runs out, and the measuring thread from his spade to them;
//  - the Open Graves: each pit (a dark hole, a rim of churned earth, its
//    hazard edge) caving open with a burst of earth, grave mist breathing out;
//  - the Burial Bell's rope hanging into the yard, hauled while he rings; the
//    peals rolling out of the bell as shells of sound and floor waves, the Toll
//    a great violet-green wave, and the dead clawing out of every grave.
//
// The cone, the ring and the pits are actionable and draw on every tier; the
// dirt, the mist, the thread, the shells and the sparks are cosmetic.

import * as THREE from 'three';
import {
  bellRopeSpot,
  MARROW_BELL_PEAL,
  MARROW_BONES_RISE,
  MARROW_BURIAL_TOLL,
  MARROW_GRAVE_OPENS,
  MARROW_GRAVE_TEMPLATE,
  MARROW_ID,
  MARROW_MEASURE,
  MARROW_MEASURED,
  MARROW_SHOVELFUL,
  MARROW_TOLLING,
  MARROW_TUNING,
} from '../../sim/encounters/hollow_crypt/marrow_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import {
  TELEGRAPH_ACCENTS,
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  telegraphFillOf,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { CryptBossFxHost, CryptBossPainter } from './crypt_boss_fx';
import {
  BELL_MOUTH_OVER_YARD,
  cryptSlotOrigin,
  graveOpening,
  pulse,
  ropePull,
} from './crypt_boss_fx_core';

const T = MARROW_TUNING;
const SCAN_SEC = 0.1;
const PITS = T.graveCap + 2;
const MARKS = 3;
const SHELLS = 4;
const EARTH = { r: 0.17, g: 0.13, b: 0.1 };
const GRAVE_GLOW = { r: 0.55, g: 0.42, b: 0.95 };
const SOUL = { r: 0.62, g: 1, b: 0.72 };

const DECAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** An Open Grave seen from above: a black pit with a violet glow breathing in
 *  its depths, churned umber earth round it, and a thin hazard edge at the
 *  sim's own radius (0.87 of the decal). */
const PIT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpen;
uniform float uSeed;
uniform vec3 uEdge;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float a = atan(d.y, d.x);
  float n = vnoise(vec2(a * 3.0 + uSeed, r * 6.0)) * 0.6 + vnoise(vUv * 14.0 + uSeed) * 0.4;
  float hole = 0.62 * uOpen + (n - 0.5) * 0.08;
  float inPit = 1.0 - smoothstep(hole - 0.04, hole + 0.04, r);
  float breath = 0.5 + 0.5 * sin(uTime * 1.7 + uSeed * 6.0);
  vec3 depth = mix(vec3(0.01, 0.0, 0.02), vec3(0.22, 0.12, 0.42), (1.0 - r / max(hole, 0.01)) * (0.35 + 0.35 * breath));
  vec3 earth = mix(vec3(0.09, 0.06, 0.04), vec3(0.24, 0.17, 0.11), n);
  vec3 col = mix(earth, depth, inPit);
  float body = (1.0 - smoothstep(0.86, 1.0, r)) * uOpen;
  float edge = (1.0 - smoothstep(0.0, 0.035, abs(r - 0.87))) * uOpen;
  col = mix(col, uEdge * 1.6, edge * 0.85);
  gl_FragColor = vec4(col, max(body * 0.96, edge));
}
`;

/** A sound shell rolling out of the bell: a fresnel rim on a sphere. */
const SHELL_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec3 vN;
varying vec3 vView;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vView;
void main() {
  float rim = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0, 1.0), 2.4);
  gl_FragColor = vec4(uColor * (0.6 + 1.6 * rim), rim * uAlpha);
}
`;

interface Pit {
  decal: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  mound: THREE.Mesh;
  objectId: number;
  born: number;
  mist: number;
}

interface Mark extends TelegraphFan {
  playerId: number;
}

interface Shell {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  span: number;
  reach: number;
  alive: boolean;
}

/** A lumpy ring of churned earth round a pit (unit radius, flat on y = 0). */
function moundGeometry(): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(1, 0.2, 7, 30);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const a = Math.atan2(x, z);
    const lump = 1 + 0.35 * Math.sin(a * 5) * Math.sin(a * 3 + 1.3) + 0.2 * Math.sin(a * 11);
    pos.setY(i, Math.max(0, pos.getY(i)) * lump * 1.4);
    const k = 0.75 + 0.25 * Math.sin(a * 7 + x * 3);
    colors[i * 3] = 0.15 * k;
    colors[i * 3 + 1] = 0.105 * k;
    colors[i * 3 + 2] = 0.075 * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export class MarrowFx implements CryptBossPainter {
  private readonly shovel: TelegraphFan;
  private readonly marks: Mark[] = [];
  private readonly pits: Pit[] = [];
  private readonly shells: Shell[] = [];
  private readonly rope: THREE.Mesh;
  private marrowId = -1;
  private scan = 0;
  private ringStart = -1;
  private tolling = false;

  constructor(private readonly host: CryptBossFxHost) {
    const kit = host.kit;
    this.shovel = kit.fan(10);
    kit.layOutFan(this.shovel, T.shovelArcDeg, {
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: TELEGRAPH_ACCENTS.physical,
    });
    for (let i = 0; i < MARKS; i++) {
      const f = kit.fan(11);
      kit.layOutFan(f, 360, {
        color: TELEGRAPH_THREAT_COLORS.danger,
        accent: TELEGRAPH_ACCENTS.shadow,
      });
      this.marks.push({ ...f, playerId: -1 });
    }
    const decalGeo = host.own(new THREE.CircleGeometry(1, 56));
    decalGeo.rotateX(-Math.PI / 2);
    const mound = host.own(moundGeometry());
    const moundMat = host.own(new THREE.MeshLambertMaterial({ vertexColors: true }));
    for (let i = 0; i < PITS; i++) {
      const mat = host.own(
        new THREE.ShaderMaterial({
          uniforms: {
            uTime: host.uTime,
            uOpen: { value: 0 },
            uSeed: { value: i * 1.37 },
            uEdge: { value: new THREE.Color(TELEGRAPH_THREAT_COLORS.danger) },
          },
          vertexShader: DECAL_VERT,
          fragmentShader: PIT_FRAG,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        }),
      );
      const decal = new THREE.Mesh(decalGeo, mat);
      decal.frustumCulled = false;
      decal.visible = false;
      decal.renderOrder = floorVfxRenderOrder('encounter', 2);
      host.root.add(decal);
      const m = new THREE.Mesh(mound, moundMat);
      m.visible = false;
      host.root.add(m);
      this.pits.push({ decal, mat, mound: m, objectId: -1, born: 0, mist: 0 });
    }
    const shellGeo = host.own(new THREE.SphereGeometry(1, 32, 16));
    for (let i = 0; i < SHELLS; i++) {
      const mat = host.own(
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } },
          vertexShader: SHELL_VERT,
          fragmentShader: SHELL_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      const mesh = new THREE.Mesh(shellGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 28);
      host.root.add(mesh);
      this.shells.push({ mesh, mat, born: 0, span: 1, reach: 1, alive: false });
    }
    const ropeGeo = host.own(new THREE.CylinderGeometry(0.07, 0.09, 1, 6, 12));
    ropeGeo.translate(0, 0.5, 0);
    this.rope = new THREE.Mesh(
      ropeGeo,
      host.own(new THREE.MeshLambertMaterial({ color: 0x4a3a28 })),
    );
    this.rope.visible = false;
    host.root.add(this.rope);
  }

  // ------------------------------------------------------------------ events

  handleEvent(ev: SimEvent & { type: 'spellfx' }, world: IWorld): void {
    const a = ev.ability;
    if (
      a !== MARROW_SHOVELFUL &&
      a !== MARROW_GRAVE_OPENS &&
      a !== MARROW_BELL_PEAL &&
      a !== MARROW_BURIAL_TOLL &&
      a !== MARROW_BONES_RISE
    )
      return;
    const src = world.entities.get(ev.sourceId);
    if (a === MARROW_SHOVELFUL && ev.fx === 'nova' && src) this.dirtSpray(src);
    else if (a === MARROW_GRAVE_OPENS) {
      const obj = world.entities.get(ev.targetId);
      if (obj) this.caveIn(obj.pos.x, obj.pos.z);
    } else if (a === MARROW_BELL_PEAL && src) this.peal(src, false);
    else if (a === MARROW_BURIAL_TOLL && ev.fx === 'nova' && src) this.peal(src, true);
    else if (a === MARROW_BONES_RISE && src) this.bonesRise(src);
  }

  private dirtSpray(e: Entity): void {
    const h = this.host;
    const now = h.clock();
    const gy = h.groundY(e.pos.x, e.pos.z);
    const half = ((T.shovelArcDeg / 2) * Math.PI) / 180;
    const n = Math.round(110 * h.density);
    for (let i = 0; i < n; i++) {
      const a = e.facing + (h.rand() * 2 - 1) * half;
      const speed = 6 + h.rand() * 9;
      const clod = i % 3 === 0;
      h.dust.emit(now + h.rand() * 0.08, {
        x: e.pos.x + Math.sin(e.facing) * 1.2,
        y: gy + 1.2 + h.rand(),
        z: e.pos.z + Math.cos(e.facing) * 1.2,
        vx: Math.sin(a) * speed,
        vy: 2 + h.rand() * 4,
        vz: Math.cos(a) * speed,
        ay: clod ? -20 : -2,
        life: clod ? 0.9 + h.rand() * 0.3 : 1.2 + h.rand() * 0.6,
        drag: clod ? 0.4 : 1.6,
        floor: gy + 0.1,
        size0: clod ? 0.35 : 0.7,
        size1: clod ? 0.3 : 2.2 + h.rand(),
        spin: (h.rand() - 0.5) * 2,
        r: clod ? 0.16 : EARTH.r,
        g: clod ? 0.11 : EARTH.g,
        b: clod ? 0.07 : EARTH.b,
        a: clod ? 1 : 0.55,
      });
    }
    h.shakeAt(e.pos.x, e.pos.z, 0.3);
  }

  private caveIn(x: number, z: number): void {
    const h = this.host;
    const now = h.clock();
    const gy = h.groundY(x, z);
    const n = Math.round(80 * h.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + h.rand() * 0.3;
      const up = i % 4 === 0;
      const speed = up ? 2 + h.rand() * 3 : 4 + h.rand() * 5;
      h.dust.emit(now + h.rand() * 0.1, {
        x: x + Math.sin(a) * 0.8,
        y: gy + 0.2,
        z: z + Math.cos(a) * 0.8,
        vx: Math.sin(a) * speed,
        vy: up ? 7 + h.rand() * 5 : 1 + h.rand() * 2,
        vz: Math.cos(a) * speed,
        ay: up ? -18 : -1,
        life: 1 + h.rand() * 0.7,
        drag: up ? 0.5 : 2,
        floor: gy + 0.1,
        size0: up ? 0.4 : 0.9,
        size1: up ? 0.35 : 2.4,
        r: EARTH.r,
        g: EARTH.g,
        b: EARTH.b,
        a: up ? 1 : 0.5,
      });
    }
    for (let i = 0; i < Math.round(30 * h.density); i++) {
      const a = h.rand() * Math.PI * 2;
      h.glow.emit(now + h.rand() * 0.2, {
        x: x + Math.sin(a) * h.rand() * 1.5,
        y: gy + 0.2,
        z: z + Math.cos(a) * h.rand() * 1.5,
        vx: 0,
        vy: 2 + h.rand() * 3,
        vz: 0,
        life: 0.9 + h.rand() * 0.5,
        drag: 1,
        size0: 0.8,
        size1: 0.2,
        ...GRAVE_GLOW,
        a: 0.8,
      });
    }
    h.wave(x, z, T.graveRadius * 1.6, 0.5, 0xb08050, 0.3);
    h.shakeAt(x, z, 0.35);
  }

  /** A peal (or the Toll itself) rolls out of the Burial Bell. */
  private peal(e: Entity, toll: boolean): void {
    const h = this.host;
    const now = h.clock();
    const gy = h.groundY(e.pos.x, e.pos.z);
    const by = gy + BELL_MOUTH_OVER_YARD;
    const shell = this.shells.find((s) => !s.alive) ?? this.shells[0];
    shell.alive = true;
    shell.born = now;
    shell.span = toll ? 1.6 : 1.1;
    shell.reach = toll ? 34 : 22;
    (shell.mat.uniforms.uColor.value as THREE.Color).setHex(toll ? 0xa6ffcf : 0xc9b4ff);
    shell.mesh.position.set(e.pos.x, by, e.pos.z);
    shell.mesh.visible = true;
    const n = Math.round((toll ? 120 : 50) * h.density);
    for (let i = 0; i < n; i++) {
      const a = h.rand() * Math.PI * 2;
      const el = (h.rand() - 0.3) * 1.2;
      const speed = 8 + h.rand() * 10;
      h.glow.emit(now, {
        x: e.pos.x,
        y: by,
        z: e.pos.z,
        vx: Math.sin(a) * Math.cos(el) * speed,
        vy: Math.sin(el) * speed,
        vz: Math.cos(a) * Math.cos(el) * speed,
        life: 0.8 + h.rand() * 0.5,
        drag: 2.4,
        size0: toll ? 1.4 : 0.9,
        size1: 0.3,
        ...(toll ? SOUL : GRAVE_GLOW),
        a: 0.9,
      });
    }
    h.wave(e.pos.x, e.pos.z, toll ? 30 : 16, toll ? 1 : 0.7, toll ? 0xa6ffcf : 0x9d7cff, 0.12);
    if (toll) {
      h.wave(e.pos.x, e.pos.z, 22, 0.8, 0xffffff, 0.06);
      // Every grave breathes out its dead.
      for (const p of this.pits) if (p.objectId >= 0) this.graveFlare(p);
    }
    h.shakeAt(e.pos.x, e.pos.z, toll ? 0.9 : 0.35);
  }

  private graveFlare(p: Pit): void {
    const h = this.host;
    const now = h.clock();
    const x = p.decal.position.x;
    const z = p.decal.position.z;
    const gy = p.decal.position.y;
    for (let i = 0; i < Math.round(36 * h.density); i++) {
      h.glow.emit(now + h.rand() * 0.25, {
        x: x + (h.rand() - 0.5) * 2,
        y: gy,
        z: z + (h.rand() - 0.5) * 2,
        vx: (h.rand() - 0.5) * 1.5,
        vy: 4 + h.rand() * 6,
        vz: (h.rand() - 0.5) * 1.5,
        life: 1 + h.rand() * 0.6,
        drag: 0.8,
        size0: 1.1,
        size1: 0.2,
        ...SOUL,
        a: 0.85,
      });
    }
  }

  private bonesRise(e: Entity): void {
    const h = this.host;
    const now = h.clock();
    const gy = h.groundY(e.pos.x, e.pos.z);
    for (let i = 0; i < Math.round(40 * h.density); i++) {
      const a = h.rand() * Math.PI * 2;
      h.dust.emit(now + h.rand() * 0.1, {
        x: e.pos.x,
        y: gy + 0.3,
        z: e.pos.z,
        vx: Math.sin(a) * (2 + h.rand() * 4),
        vy: 3 + h.rand() * 5,
        vz: Math.cos(a) * (2 + h.rand() * 4),
        ay: -14,
        life: 0.9 + h.rand() * 0.4,
        drag: 0.6,
        floor: gy + 0.1,
        size0: 0.5,
        size1: 1.6,
        r: EARTH.r,
        g: EARTH.g,
        b: EARTH.b,
        a: 0.85,
      });
    }
    h.wave(e.pos.x, e.pos.z, 3.5, 0.5, 0xa6ffcf, 0.3);
  }

  // ------------------------------------------------------------------ frame

  update(world: IWorld, dt: number): void {
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    const marrow = this.marrowId >= 0 ? world.entities.get(this.marrowId) : undefined;
    this.paintShovel(marrow);
    this.paintMarks(world);
    this.paintPits(world, dt);
    this.paintRope(marrow);
    this.paintShells();
    if (marrow) this.paintMeasure(world, marrow);
  }

  private scanWorld(world: IWorld): void {
    this.marrowId = -1;
    const live = new Set<number>();
    for (const e of world.entities.values()) {
      if (e.kind === 'mob' && e.templateId === MARROW_ID && !e.dead) this.marrowId = e.id;
      else if (e.kind === 'object' && e.templateId === MARROW_GRAVE_TEMPLATE) {
        live.add(e.id);
        if (!this.pits.some((p) => p.objectId === e.id)) {
          const slot = this.pits.find((p) => p.objectId < 0);
          if (slot) {
            slot.objectId = e.id;
            slot.born = this.host.clock();
          }
        }
      } else if (e.kind === 'player') {
        const marked = e.auras.some((a) => a.id === MARROW_MEASURED);
        const has = this.marks.find((m) => m.playerId === e.id);
        if (marked && !has) {
          const slot = this.marks.find((m) => m.playerId < 0);
          if (slot) slot.playerId = e.id;
        } else if (!marked && has) {
          has.playerId = -1;
          has.group.visible = false;
        }
      }
    }
    for (const p of this.pits)
      if (p.objectId >= 0 && !live.has(p.objectId)) {
        p.objectId = -1;
        p.decal.visible = false;
        p.mound.visible = false;
      }
  }

  private paintShovel(marrow: Entity | undefined): void {
    const f = this.shovel;
    if (!marrow || marrow.castingAbility !== MARROW_SHOVELFUL) {
      f.group.visible = false;
      return;
    }
    const h = this.host;
    const gy = h.groundY(marrow.pos.x, marrow.pos.z);
    h.kit.drapeFan(f, h.groundY, marrow.pos.x, gy, marrow.pos.z, marrow.facing, T.shovelRange);
    h.kit.paintFan(f, {
      fill: telegraphFillOf(marrow.castRemaining, marrow.castTotal),
      clock: h.clock(),
      range: T.shovelRange,
    });
    f.group.visible = true;
  }

  private paintMarks(world: IWorld): void {
    const h = this.host;
    for (const m of this.marks) {
      if (m.playerId < 0) continue;
      const p = world.entities.get(m.playerId);
      const a = p?.auras.find((x) => x.id === MARROW_MEASURED);
      if (!p || !a) {
        m.group.visible = false;
        continue;
      }
      const radius = a.value2 ?? T.graveRadius;
      const gy = h.groundY(p.pos.x, p.pos.z);
      h.kit.drapeFan(m, h.groundY, p.pos.x, gy, p.pos.z, 0, radius);
      h.kit.paintFan(m, {
        fill: telegraphFillOf(a.remaining, a.duration),
        clock: h.clock(),
        range: radius,
      });
      m.group.visible = true;
      // Grave dirt trickling round the mark (cosmetic).
      if (!h.low && h.rand() < 0.35) {
        const ang = h.rand() * Math.PI * 2;
        h.dust.emit(h.clock(), {
          x: p.pos.x + Math.sin(ang) * radius,
          y: gy + 3 + h.rand() * 2,
          z: p.pos.z + Math.cos(ang) * radius,
          vx: 0,
          vy: -1,
          vz: 0,
          ay: -9,
          life: 0.8,
          drag: 0.2,
          floor: gy + 0.05,
          size0: 0.25,
          size1: 0.2,
          r: 0.2,
          g: 0.14,
          b: 0.09,
          a: 0.9,
        });
      }
    }
  }

  private paintPits(world: IWorld, dt: number): void {
    const h = this.host;
    const now = h.clock();
    for (const p of this.pits) {
      if (p.objectId < 0) continue;
      const obj = world.entities.get(p.objectId);
      if (!obj) continue;
      const radius = obj.scale > 0 ? obj.scale : T.graveRadius;
      const gy = h.groundY(obj.pos.x, obj.pos.z);
      const open = graveOpening(now - p.born);
      p.decal.position.set(obj.pos.x, gy + 0.06, obj.pos.z);
      p.decal.scale.setScalar(radius / 0.87);
      p.mat.uniforms.uOpen.value = open;
      p.decal.visible = true;
      p.mound.position.set(obj.pos.x, gy - 0.05, obj.pos.z);
      // Never a flat zero scale (a singular normal matrix on a lit mesh).
      p.mound.scale.set(radius * 0.98, Math.max(0.02, open), radius * 0.98);
      p.mound.visible = true;
      // Grave mist breathing out of the pit (cosmetic).
      p.mist -= dt;
      if (p.mist <= 0) {
        p.mist = h.low ? 0.6 : 0.22;
        const ang = h.rand() * Math.PI * 2;
        const r = h.rand() * radius * 0.5;
        h.glow.emit(now, {
          x: obj.pos.x + Math.sin(ang) * r,
          y: gy - 0.2,
          z: obj.pos.z + Math.cos(ang) * r,
          vx: (h.rand() - 0.5) * 0.4,
          vy: 0.8 + h.rand() * 0.8,
          vz: (h.rand() - 0.5) * 0.4,
          life: 2.2,
          drag: 0.4,
          size0: 1.2,
          size1: 2.4,
          ...GRAVE_GLOW,
          a: 0.28,
        });
      }
    }
  }

  /** The rope hangs from the Burial Bell into the yard; he hauls it as he rings. */
  private paintRope(marrow: Entity | undefined): void {
    if (!marrow) {
      this.rope.visible = false;
      this.ringStart = -1;
      return;
    }
    const h = this.host;
    const o = cryptSlotOrigin(marrow.pos.x, marrow.pos.z);
    const spot = bellRopeSpot();
    const x = o.x + spot.x;
    const z = o.z + spot.z;
    const gy = h.groundY(x, z);
    const ringing = marrow.castingAbility === MARROW_BURIAL_TOLL;
    if (ringing && this.ringStart < 0) this.ringStart = h.clock();
    if (!ringing) this.ringStart = -1;
    const pull = ringing ? ropePull(h.clock() - this.ringStart) : 0;
    // The rope's foot rides his fists as he hauls (the BellRing clip's lower fist:
    // about 6.3 yd up at the top of a pull, 4.2 at the bottom).
    const foot = gy + 4.2 + (1 - pull) * 2.1;
    const top = gy + BELL_MOUTH_OVER_YARD;
    this.rope.position.set(x, foot, z);
    this.rope.scale.set(1, top - foot, 1);
    this.rope.visible = true;
    // While he tolls, the violet of the dead gathers round him (cosmetic).
    this.tolling = marrow.auras.some((a) => a.id === MARROW_TOLLING);
    if (this.tolling && !h.low && h.rand() < 0.6) {
      const ang = h.rand() * Math.PI * 2;
      h.glow.emit(h.clock(), {
        x: marrow.pos.x + Math.sin(ang) * 1.6,
        y: h.groundY(marrow.pos.x, marrow.pos.z) + 0.5 + h.rand() * 3,
        z: marrow.pos.z + Math.cos(ang) * 1.6,
        vx: Math.cos(ang) * 1.2,
        vy: 1.4,
        vz: -Math.sin(ang) * 1.2,
        life: 1,
        drag: 0.8,
        size0: 0.8,
        size1: 0.1,
        ...GRAVE_GLOW,
        a: 0.7,
      });
    }
  }

  private paintShells(): void {
    const now = this.host.clock();
    for (const s of this.shells) {
      if (!s.alive) continue;
      const k = (now - s.born) / s.span;
      if (k >= 1) {
        s.alive = false;
        s.mesh.visible = false;
        continue;
      }
      s.mesh.scale.setScalar(s.reach * (1 - (1 - k) ** 2.5) + 0.5);
      s.mat.uniforms.uAlpha.value = pulse(now - s.born, s.span) * 0.45;
    }
  }

  /** The measuring thread from his spade to the one he sizes up (cosmetic). */
  private paintMeasure(world: IWorld, marrow: Entity): void {
    const h = this.host;
    if (h.low || marrow.castingAbility !== MARROW_MEASURE || marrow.castTargetId === null) return;
    const t = world.entities.get(marrow.castTargetId);
    if (!t) return;
    const gy = h.groundY(marrow.pos.x, marrow.pos.z);
    const ty = h.groundY(t.pos.x, t.pos.z);
    for (let i = 0; i < 3; i++) {
      const u = h.rand();
      h.glow.emit(h.clock(), {
        x: marrow.pos.x + (t.pos.x - marrow.pos.x) * u,
        y: gy + 4.3 + (ty + 1.6 - gy - 4.3) * u,
        z: marrow.pos.z + (t.pos.z - marrow.pos.z) * u,
        vx: 0,
        vy: 0.3,
        vz: 0,
        life: 0.35,
        drag: 1,
        size0: 0.45,
        size1: 0.15,
        ...GRAVE_GLOW,
        a: 0.9,
      });
    }
  }
}
