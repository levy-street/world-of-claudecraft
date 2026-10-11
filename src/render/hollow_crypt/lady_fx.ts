// The Lady of the Bonechill's effects on the crypt boss host (crypt_boss_fx.ts),
// read off the sim (src/sim/encounters/hollow_crypt/lady*.ts):
//
//  - the three grave lanterns: an iron post and hooded cage, its flame, and the
//    pool of warm light on the ice that IS the shelter (its rim at the sim's
//    radius), darkening after a Lament and sputtering back as it kindles; a
//    golden dome when a lantern shelters someone;
//  - the frozen bridal grave on the ravine's north lip;
//  - Bride's Lament: the wail gathering round her (frost spiralling in, cold
//    rings rolling out from her), then the blast of rime across the ravine;
//  - the Frozen Embrace: the warning ring under her victim, the frost spiral
//    round the held, the snow when she lets go, the ice shattering under a
//    dropped player;
//  - the Rime Path patches and, after the Bridal Freeze, the whole ravine
//    sheeted in cracked ice (the freeze sweeping out from her);
//  - her own trail of drifting snow.
//
// The lantern light, the embrace ring and the ice are actionable and draw on
// every tier; spirals, snow and sparks are cosmetic.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BRIDAL_GRAVE,
  LADY_BRIDAL_FREEZE,
  LADY_BRIDES_LAMENT,
  LADY_EMBRACE_DROPPED,
  LADY_EMBRACE_RELEASED,
  LADY_EMBRACED,
  LADY_FROZEN_EMBRACE,
  LADY_FROZEN_FLOOR_TEMPLATE,
  LADY_ID,
  LADY_LANTERN_SHELTER,
  LADY_RIME_PATCH_TEMPLATE,
  LADY_SHATTERING_FALL,
  LADY_TUNING,
  lanternStateOf,
} from '../../sim/encounters/hollow_crypt/lady_ids';
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
import { cryptSlotOrigin, embraceSpiral, fadeIn, lanternLook } from './crypt_boss_fx_core';

const T = LADY_TUNING;
const SCAN_SEC = 0.1;
const LANTERNS = 3;
const PATCHES = T.rimeCap + 2;
const DOMES = 3;
const FROST = { r: 0.72, g: 0.9, b: 1 };
const AMBER = { r: 1, g: 0.66, b: 0.28 };
/** The flame's height on the lantern post (the cage hangs from the arm). */
const FLAME_Y = 2.75;
const FLAME_OUT = 0.7;

const DECAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The lantern's light on the ice: a warm pool, its rim at the shelter's edge
 *  (0.91 of the decal). Dark, only a cold dim ring shows where it was. */
const POOL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLit;
uniform float uSeed;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float edgeR = 0.91;
  float pool = (1.0 - smoothstep(0.0, edgeR, r)) * uLit;
  float rim = 1.0 - smoothstep(0.0, 0.03, abs(r - edgeR));
  float a = atan(vUv.y - 0.5, vUv.x - 0.5);
  float dash = step(0.5, fract(a * 6.0 / 3.14159 + uTime * 0.1));
  vec3 warm = vec3(1.0, 0.72, 0.36);
  vec3 cold = vec3(0.45, 0.58, 0.75);
  vec3 col = warm * (0.55 + 0.6 * pool) * (0.9 + 0.1 * sin(uTime * 7.0 + uSeed));
  float alpha = pool * 0.62 + rim * (0.35 + 0.65 * uLit);
  col = mix(cold * dash, col, step(0.05, uLit));
  alpha = mix(rim * dash * 0.35, alpha, step(0.05, uLit));
  gl_FragColor = vec4(col, alpha);
}
`;

/** Rime and ice on the floor: cracked crystal, a cold sheen sliding over it. */
const ICE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uScale;
uniform float uSeed;
varying vec2 vUv;
vec2 h22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float cracks(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = h22(i + g + uSeed);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return 1.0 - smoothstep(0.0, 0.035, d2 - d1);
}
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  vec2 p = d * uScale * 0.6;
  float c = cracks(p) * 0.8 + cracks(p * 2.3) * 0.35;
  float sheen = pow(max(0.0, sin((d.x + d.y) * uScale * 0.35 - uTime * 0.6)), 24.0);
  float body = 1.0 - smoothstep(0.82, 1.0, r);
  vec3 col = mix(vec3(0.36, 0.55, 0.74), vec3(0.82, 0.94, 1.0), c) + sheen * 0.45;
  gl_FragColor = vec4(col, body * uAlpha * (0.2 + 0.32 * c + 0.22 * sheen));
}
`;

/** A dome of lantern light or rime: a fresnel rim on a sphere. */
const DOME_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec3 vN;
varying vec3 vView;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
const DOME_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vView;
void main() {
  float rim = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0, 1.0), 2.0);
  gl_FragColor = vec4(uColor * (0.5 + 1.5 * rim), (0.15 + rim) * uAlpha);
}
`;

interface Lantern {
  body: THREE.Mesh;
  glass: THREE.Mesh;
  glassMat: THREE.MeshBasicMaterial;
  pool: THREE.Mesh;
  poolMat: THREE.ShaderMaterial;
  objectId: number;
  flame: number;
}

interface Patch {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  objectId: number;
  born: number;
}

interface Dome {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  alive: boolean;
}

/** Shift a geometry's vertex colours to one colour (merged props keep them). */
function tint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g.index ? g.toNonIndexed() : g;
}

/** The grave lantern's iron: a post on a stepped plinth, an arm, and the
 *  hooded cage hanging from it (the glass is its own mesh). */
function lanternGeometry(): THREE.BufferGeometry {
  const iron = 0x22201e;
  const stone = 0x5d5a55;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, hex: number) => parts.push(tint(g, hex));
  add(new THREE.CylinderGeometry(0.62, 0.72, 0.35, 8).translate(0, 0.17, 0), stone);
  add(new THREE.CylinderGeometry(0.42, 0.5, 0.3, 8).translate(0, 0.48, 0), stone);
  add(new THREE.CylinderGeometry(0.09, 0.12, 3.5, 6).translate(0, 2.3, 0), iron);
  add(new THREE.BoxGeometry(0.1, 0.1, 1.0).translate(0, 3.75, 0.42), iron);
  add(new THREE.ConeGeometry(0.06, 0.3, 5).rotateX(Math.PI / 2).translate(0, 3.75, -0.12), iron);
  // The cage: hanging chain, a hood, four bars and two rings.
  add(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 4).translate(0, 3.55, FLAME_OUT), iron);
  add(new THREE.ConeGeometry(0.42, 0.42, 8).translate(0, 3.25, FLAME_OUT), iron);
  for (const [dx, dz] of [
    [0.24, 0.24],
    [-0.24, 0.24],
    [0.24, -0.24],
    [-0.24, -0.24],
  ])
    add(
      new THREE.CylinderGeometry(0.03, 0.03, 0.75, 4).translate(dx, FLAME_Y, FLAME_OUT + dz),
      iron,
    );
  add(
    new THREE.TorusGeometry(0.33, 0.04, 4, 10).rotateX(Math.PI / 2).translate(0, 3.05, FLAME_OUT),
    iron,
  );
  add(
    new THREE.TorusGeometry(0.33, 0.05, 4, 10).rotateX(Math.PI / 2).translate(0, 2.38, FLAME_OUT),
    iron,
  );
  add(new THREE.ConeGeometry(0.2, 0.25, 6).rotateX(Math.PI).translate(0, 2.2, FLAME_OUT), iron);
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

/** The bride's frozen tomb: a slab on a plinth, a tall headstone with a
 *  carved veil, and a crust of ice shards over it all. */
function graveGeometry(): { stone: THREE.BufferGeometry; ice: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, hex: number) => parts.push(tint(g, hex));
  add(new THREE.BoxGeometry(3.4, 0.5, 5.8).translate(0, 0.25, 0), 0x4e4c4a);
  add(new THREE.BoxGeometry(2.8, 0.7, 5.0).translate(0, 0.85, 0), 0x6a6762);
  add(new THREE.BoxGeometry(2.5, 3.6, 0.5).translate(0, 2.3, -2.7), 0x77736c);
  add(
    new THREE.CylinderGeometry(1.25, 1.25, 0.5, 14, 1, false, 0, Math.PI)
      .rotateZ(Math.PI / 2)
      .rotateY(Math.PI / 2)
      .translate(0, 4.1, -2.7),
    0x77736c,
  );
  // The carved veil and wreath on the headstone.
  add(new THREE.TorusGeometry(0.55, 0.09, 5, 14).translate(0, 3.2, -2.42), 0x9a958c);
  add(new THREE.ConeGeometry(0.7, 1.6, 6, 1, true).translate(0, 2.0, -2.4), 0x8f8a82);
  const stone = mergeGeometries(parts);
  stone.computeVertexNormals();
  const shards: THREE.BufferGeometry[] = [];
  const spots: [number, number, number, number, number][] = [
    [1.3, 1.1, 1.6, 0.35, 1.6],
    [-1.4, 1.1, 0.8, 0.3, 1.3],
    [0.9, 1.2, -1.2, 0.4, 2.1],
    [-1.0, 1.2, -1.6, 0.35, 1.8],
    [1.5, 0.4, -2.8, 0.45, 2.6],
    [-1.6, 0.4, -2.6, 0.4, 2.2],
    [0.2, 1.2, 2.2, 0.3, 1.1],
    [-0.5, 4.2, -2.7, 0.25, 1.2],
    [0.6, 4.3, -2.6, 0.22, 1.0],
  ];
  for (const [x, y, z, r, h] of spots) {
    const c = new THREE.ConeGeometry(r, h, 5).translate(0, h / 2, 0);
    c.rotateZ((x > 0 ? -1 : 1) * 0.35);
    c.rotateX(z > 0 ? 0.25 : -0.25);
    c.translate(x, y, z);
    shards.push(c.index ? c.toNonIndexed() : c);
  }
  const ice = mergeGeometries(shards);
  ice.computeVertexNormals();
  return { stone, ice };
}

export class LadyFx implements CryptBossPainter {
  private readonly lanterns: Lantern[] = [];
  private readonly patches: Patch[] = [];
  private readonly domes: Dome[] = [];
  private readonly floor: THREE.Mesh;
  private readonly floorMat: THREE.ShaderMaterial;
  private readonly grave: THREE.Group;
  private readonly embraceRing: TelegraphFan;
  private ladyId = -1;
  private floorId = -1;
  private floorBorn = 0;
  private scan = 0;
  private snow = 0;
  private ring = 0;
  /** Players held in her Embrace (refreshed with the scan). */
  private embraced: number[] = [];

  constructor(private readonly host: CryptBossFxHost) {
    const decalGeo = host.own(new THREE.CircleGeometry(1, 64));
    decalGeo.rotateX(-Math.PI / 2);
    const lanternGeo = host.own(lanternGeometry());
    const ironMat = host.own(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const glassGeo = host.own(new THREE.BoxGeometry(0.4, 0.62, 0.4));
    glassGeo.translate(0, FLAME_Y, FLAME_OUT);
    for (let i = 0; i < LANTERNS; i++) {
      const body = new THREE.Mesh(lanternGeo, ironMat);
      body.visible = false;
      host.root.add(body);
      const glassMat = host.own(
        new THREE.MeshBasicMaterial({ color: 0xffb860, transparent: true, opacity: 0.9 }),
      );
      const glass = new THREE.Mesh(glassGeo, glassMat);
      glass.visible = false;
      host.root.add(glass);
      const poolMat = host.own(
        new THREE.ShaderMaterial({
          uniforms: { uTime: host.uTime, uLit: { value: 1 }, uSeed: { value: i * 2.1 } },
          vertexShader: DECAL_VERT,
          fragmentShader: POOL_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      const pool = new THREE.Mesh(decalGeo, poolMat);
      pool.frustumCulled = false;
      pool.visible = false;
      pool.renderOrder = floorVfxRenderOrder('encounter', 3);
      host.root.add(pool);
      this.lanterns.push({ body, glass, glassMat, pool, poolMat, objectId: -1, flame: 0 });
    }
    const iceMat = (seed: number) =>
      host.own(
        new THREE.ShaderMaterial({
          uniforms: {
            uTime: host.uTime,
            uAlpha: { value: 0 },
            uScale: { value: 6 },
            uSeed: { value: seed },
          },
          vertexShader: DECAL_VERT,
          fragmentShader: ICE_FRAG,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
    for (let i = 0; i < PATCHES; i++) {
      const mat = iceMat(i * 0.73);
      const mesh = new THREE.Mesh(decalGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 1);
      host.root.add(mesh);
      this.patches.push({ mesh, mat, objectId: -1, born: 0 });
    }
    this.floorMat = iceMat(9.1);
    this.floor = new THREE.Mesh(decalGeo, this.floorMat);
    this.floor.frustumCulled = false;
    this.floor.visible = false;
    this.floor.renderOrder = floorVfxRenderOrder('encounter', 0);
    host.root.add(this.floor);
    const domeGeo = host.own(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2));
    for (let i = 0; i < DOMES; i++) {
      const mat = host.own(
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color(0xffc870) }, uAlpha: { value: 0 } },
          vertexShader: DOME_VERT,
          fragmentShader: DOME_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      const mesh = new THREE.Mesh(domeGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 29);
      host.root.add(mesh);
      this.domes.push({ mesh, mat, born: 0, alive: false });
    }
    const graveGeo = graveGeometry();
    this.grave = new THREE.Group();
    this.grave.add(new THREE.Mesh(host.own(graveGeo.stone), ironMat));
    this.grave.add(
      new THREE.Mesh(
        host.own(graveGeo.ice),
        host.own(
          new THREE.MeshLambertMaterial({
            color: 0xbfe6ff,
            emissive: 0x3d6f9a,
            transparent: true,
            opacity: 0.82,
          }),
        ),
      ),
    );
    this.grave.visible = false;
    host.root.add(this.grave);
    this.embraceRing = host.kit.fan(12);
    host.kit.layOutFan(this.embraceRing, 360, {
      color: TELEGRAPH_THREAT_COLORS.control,
      accent: TELEGRAPH_ACCENTS.frost,
    });
  }

  // ------------------------------------------------------------------ events

  handleEvent(ev: SimEvent & { type: 'spellfx' }, world: IWorld): void {
    const a = ev.ability;
    if (a === LADY_BRIDES_LAMENT && ev.fx === 'nova') {
      const src = world.entities.get(ev.sourceId);
      if (src) this.lamentBlast(src);
    } else if (a === LADY_LANTERN_SHELTER) {
      const l = world.entities.get(ev.sourceId);
      if (l) this.shelterDome(l);
    } else if (a === LADY_EMBRACE_RELEASED || a === LADY_EMBRACE_DROPPED) {
      // She opens her arms (the Release clip, the manifest's attackByAbility).
      this.host.gesture(ev.sourceId, a);
      const p = world.entities.get(ev.targetId);
      if (p && a === LADY_EMBRACE_RELEASED) this.snowPuff(p.pos.x, p.pos.y, p.pos.z, 40);
    } else if (a === LADY_SHATTERING_FALL) {
      const p = world.entities.get(ev.targetId);
      if (p) this.shatter(p);
    } else if (a === LADY_BRIDAL_FREEZE && ev.fx === 'nova') {
      const src = world.entities.get(ev.sourceId);
      if (src) this.freezeSweep(src);
    }
  }

  private lamentBlast(e: Entity): void {
    const h = this.host;
    const now = h.clock();
    const gy = h.groundY(e.pos.x, e.pos.z);
    h.wave(e.pos.x, e.pos.z, 26, 0.9, 0xcff4ff, 0.14);
    h.wave(e.pos.x, e.pos.z, 18, 0.7, 0x9fd8ff, 0.08);
    const n = Math.round(160 * h.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const speed = 12 + h.rand() * 10;
      h.glow.emit(now + h.rand() * 0.05, {
        x: e.pos.x,
        y: gy + 2 + h.rand() * 3,
        z: e.pos.z,
        vx: Math.sin(a) * speed,
        vy: (h.rand() - 0.4) * 3,
        vz: Math.cos(a) * speed,
        life: 1 + h.rand() * 0.4,
        drag: 1.4,
        size0: 1.3,
        size1: 0.2,
        ...FROST,
        a: 0.8,
      });
    }
    h.shakeAt(e.pos.x, e.pos.z, 0.55);
  }

  private shelterDome(l: Entity): void {
    const d = this.domes.find((q) => !q.alive) ?? this.domes[0];
    d.alive = true;
    d.born = this.host.clock();
    d.mesh.position.set(l.pos.x, this.host.groundY(l.pos.x, l.pos.z), l.pos.z);
    d.mesh.visible = true;
  }

  private snowPuff(x: number, y: number, z: number, count: number): void {
    const h = this.host;
    const now = h.clock();
    for (let i = 0; i < Math.round(count * h.density); i++) {
      const a = h.rand() * Math.PI * 2;
      const s = 1 + h.rand() * 3;
      h.dust.emit(now, {
        x,
        y: y + 1 + h.rand(),
        z,
        vx: Math.sin(a) * s,
        vy: h.rand() * 2,
        vz: Math.cos(a) * s,
        life: 1.2 + h.rand() * 0.6,
        drag: 1.2,
        size0: 0.6,
        size1: 1.8,
        r: 0.88,
        g: 0.94,
        b: 1,
        a: 0.6,
      });
    }
  }

  private shatter(p: Entity): void {
    const h = this.host;
    const now = h.clock();
    const gy = h.groundY(p.pos.x, p.pos.z);
    for (let i = 0; i < Math.round(70 * h.density); i++) {
      const a = h.rand() * Math.PI * 2;
      const s = 3 + h.rand() * 6;
      h.glow.emit(now, {
        x: p.pos.x,
        y: gy + 0.3,
        z: p.pos.z,
        vx: Math.sin(a) * s,
        vy: 3 + h.rand() * 6,
        vz: Math.cos(a) * s,
        ay: -16,
        life: 0.8 + h.rand() * 0.4,
        drag: 0.6,
        floor: gy + 0.05,
        size0: 0.45,
        size1: 0.2,
        ...FROST,
        a: 1,
      });
    }
    this.snowPuff(p.pos.x, gy, p.pos.z, 30);
    h.wave(p.pos.x, p.pos.z, 4.5, 0.5, 0xdff6ff, 0.3);
    h.shakeAt(p.pos.x, p.pos.z, 0.6);
  }

  private freezeSweep(e: Entity): void {
    const h = this.host;
    const now = h.clock();
    h.wave(e.pos.x, e.pos.z, 24, 1.3, 0xe8fbff, 0.35);
    h.wave(e.pos.x, e.pos.z, 20, 1.0, 0x8fd0ff, 0.12);
    // Crystals erupting round the ravine's rim as the ice reaches it.
    const n = Math.round(90 * h.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 6 + h.rand() * 14;
      const x = e.pos.x + Math.sin(a) * r;
      const z = e.pos.z + Math.cos(a) * r;
      h.glow.emit(now + (r / 20) * 0.9, {
        x,
        y: h.groundY(x, z) + 0.2,
        z,
        vx: 0,
        vy: 2 + h.rand() * 4,
        vz: 0,
        life: 0.8,
        drag: 1.5,
        size0: 0.9,
        size1: 0.2,
        ...FROST,
        a: 0.9,
      });
    }
    h.shakeAt(e.pos.x, e.pos.z, 0.7);
  }

  // ------------------------------------------------------------------ frame

  update(world: IWorld, dt: number): void {
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    const lady = this.ladyId >= 0 ? world.entities.get(this.ladyId) : undefined;
    this.paintLanterns(world, dt);
    this.paintPatches(world);
    this.paintFloor(world);
    this.paintDomes();
    this.paintGrave(world);
    if (lady) {
      this.paintLament(lady, dt);
      this.paintEmbrace(world, lady);
      this.paintTrail(lady, dt);
    } else this.embraceRing.group.visible = false;
  }

  private scanWorld(world: IWorld): void {
    this.ladyId = -1;
    this.floorId = -1;
    this.embraced = [];
    const lanternIds = new Set<number>();
    const patchIds = new Set<number>();
    for (const e of world.entities.values()) {
      if (e.kind === 'mob') {
        if (e.templateId === LADY_ID && !e.dead) this.ladyId = e.id;
        continue;
      }
      if (e.kind === 'player') {
        for (const a of e.auras)
          if (a.id === LADY_EMBRACED) {
            this.embraced.push(e.id);
            break;
          }
        continue;
      }
      if (e.kind !== 'object') continue;
      if (lanternStateOf(e.templateId) !== null) lanternIds.add(e.id);
      else if (e.templateId === LADY_RIME_PATCH_TEMPLATE) patchIds.add(e.id);
      else if (e.templateId === LADY_FROZEN_FLOOR_TEMPLATE) {
        if (this.floorId !== e.id && !this.floor.visible) this.floorBorn = this.host.clock();
        this.floorId = e.id;
      }
    }
    for (const l of this.lanterns)
      if (l.objectId >= 0 && !lanternIds.has(l.objectId)) {
        l.objectId = -1;
        for (const m of [l.body, l.glass, l.pool]) m.visible = false;
      }
    for (const id of lanternIds) {
      if (this.lanterns.some((l) => l.objectId === id)) continue;
      const slot = this.lanterns.find((l) => l.objectId < 0);
      if (slot) slot.objectId = id;
    }
    for (const p of this.patches)
      if (p.objectId >= 0 && !patchIds.has(p.objectId)) {
        p.objectId = -1;
        p.mesh.visible = false;
      }
    for (const id of patchIds) {
      if (this.patches.some((p) => p.objectId === id)) continue;
      const slot = this.patches.find((p) => p.objectId < 0);
      if (slot) {
        slot.objectId = id;
        slot.born = this.host.clock();
      }
    }
    if (this.floorId < 0) this.floor.visible = false;
  }

  private paintLanterns(world: IWorld, dt: number): void {
    const h = this.host;
    const now = h.clock();
    for (const [i, l] of this.lanterns.entries()) {
      if (l.objectId < 0) continue;
      const obj = world.entities.get(l.objectId);
      const state = obj ? lanternStateOf(obj.templateId) : null;
      if (!obj || !state) continue;
      const gy = h.groundY(obj.pos.x, obj.pos.z);
      // The cage hangs toward the ravine's centre.
      const o = cryptSlotOrigin(obj.pos.x, obj.pos.z);
      const yaw = Math.atan2(o.x + 80 - obj.pos.x, o.z + 112 - obj.pos.z);
      l.body.position.set(obj.pos.x, gy, obj.pos.z);
      l.body.rotation.y = yaw;
      l.glass.position.copy(l.body.position);
      l.glass.rotation.y = yaw;
      const look = lanternLook(state, now, i * 2.3);
      l.glassMat.color.setRGB(
        0.25 + 0.75 * look.glass,
        0.18 + 0.55 * look.glass,
        0.1 + 0.3 * look.glass,
      );
      l.pool.position.set(obj.pos.x, gy + 0.05, obj.pos.z);
      l.pool.scale.setScalar(T.lanternRadius / 0.91);
      l.poolMat.uniforms.uLit.value = look.pool;
      for (const m of [l.body, l.glass, l.pool]) m.visible = true;
      if (look.flame <= 0) continue;
      l.flame -= dt;
      if (l.flame > 0) continue;
      l.flame = h.low ? 0.12 : 0.04;
      const fx = obj.pos.x + Math.sin(yaw) * FLAME_OUT;
      const fz = obj.pos.z + Math.cos(yaw) * FLAME_OUT;
      h.glow.emit(now, {
        x: fx + (h.rand() - 0.5) * 0.08,
        y: gy + FLAME_Y - 0.15,
        z: fz + (h.rand() - 0.5) * 0.08,
        vx: 0,
        vy: 0.9 + h.rand() * 0.6,
        vz: 0,
        life: 0.45,
        drag: 1,
        size0: 0.55 * look.flame,
        size1: 0.1,
        ...AMBER,
        a: 0.95 * look.flame,
      });
    }
  }

  private paintPatches(world: IWorld): void {
    const h = this.host;
    for (const p of this.patches) {
      if (p.objectId < 0) continue;
      const obj = world.entities.get(p.objectId);
      if (!obj) continue;
      const r = obj.scale > 0 ? obj.scale : T.rimeRadius;
      p.mesh.position.set(obj.pos.x, h.groundY(obj.pos.x, obj.pos.z) + 0.04, obj.pos.z);
      p.mesh.scale.setScalar(r / 0.9);
      p.mesh.rotation.y = obj.facing;
      p.mat.uniforms.uAlpha.value = fadeIn(h.clock() - p.born, 0.4);
      p.mat.uniforms.uScale.value = r * 2.2;
      p.mesh.visible = true;
    }
  }

  private paintFloor(world: IWorld): void {
    if (this.floorId < 0) return;
    const obj = world.entities.get(this.floorId);
    if (!obj) return;
    const h = this.host;
    const r = obj.scale > 0 ? obj.scale : 20;
    this.floor.position.set(obj.pos.x, h.groundY(obj.pos.x, obj.pos.z) + 0.03, obj.pos.z);
    this.floor.scale.setScalar(r / 0.95);
    this.floorMat.uniforms.uAlpha.value = fadeIn(h.clock() - this.floorBorn, 1.1);
    this.floorMat.uniforms.uScale.value = r * 1.6;
    this.floor.visible = true;
  }

  private paintDomes(): void {
    const now = this.host.clock();
    for (const d of this.domes) {
      if (!d.alive) continue;
      const k = (now - d.born) / 0.9;
      if (k >= 1) {
        d.alive = false;
        d.mesh.visible = false;
        continue;
      }
      d.mesh.scale.setScalar(T.lanternRadius * (0.7 + 0.35 * k));
      d.mat.uniforms.uAlpha.value = (1 - k) ** 1.5;
    }
  }

  private paintGrave(world: IWorld): void {
    const lady = this.ladyId >= 0 ? world.entities.get(this.ladyId) : undefined;
    const anchor = lady ?? world.player;
    if (!anchor) {
      this.grave.visible = false;
      return;
    }
    const o = cryptSlotOrigin(anchor.pos.x, anchor.pos.z);
    const x = o.x + BRIDAL_GRAVE.x;
    const z = o.z + BRIDAL_GRAVE.z;
    // Drawn only near the ravine (the slot's own grave).
    const me = world.player;
    const near = me ? Math.hypot(me.pos.x - x, me.pos.z - z) < 140 : false;
    this.grave.visible = near;
    if (!near) return;
    this.grave.position.set(x, this.host.groundY(x, z), z);
  }

  /** The wail gathering: frost spirals in round her, cold rings roll out. */
  private paintLament(lady: Entity, dt: number): void {
    const h = this.host;
    const casting = lady.castingAbility;
    if (casting !== LADY_BRIDES_LAMENT && casting !== LADY_BRIDAL_FREEZE) return;
    const now = h.clock();
    const gy = h.groundY(lady.pos.x, lady.pos.z);
    const fill = telegraphFillOf(lady.castRemaining, lady.castTotal);
    const n = h.low ? 1 : 4;
    for (let i = 0; i < n; i++) {
      const a = h.rand() * Math.PI * 2;
      const r = 6 + h.rand() * 6;
      h.glow.emit(now, {
        x: lady.pos.x + Math.sin(a) * r,
        y: gy + 1 + h.rand() * 5,
        z: lady.pos.z + Math.cos(a) * r,
        vx: -Math.sin(a) * r * 1.2 + Math.cos(a) * 3,
        vy: 0.5,
        vz: -Math.cos(a) * r * 1.2 - Math.sin(a) * 3,
        life: 0.7,
        drag: 0.5,
        size0: 0.3,
        size1: 0.9,
        ...FROST,
        a: 0.5 + 0.4 * fill,
      });
    }
    // A cold ring every half second, faster as the wail peaks.
    this.ring -= dt;
    if (this.ring <= 0) {
      this.ring = 0.5 - 0.25 * fill;
      h.wave(lady.pos.x, lady.pos.z, 7 + 8 * fill, 0.5, 0xb8e8ff, 0.1);
    }
  }

  private paintEmbrace(world: IWorld, lady: Entity): void {
    const h = this.host;
    const ring = this.embraceRing;
    // The warning under her chosen victim while she reaches for them.
    if (lady.castingAbility === LADY_FROZEN_EMBRACE && lady.castTargetId !== null) {
      const t = world.entities.get(lady.castTargetId);
      if (t) {
        const gy = h.groundY(t.pos.x, t.pos.z);
        h.kit.drapeFan(ring, h.groundY, t.pos.x, gy, t.pos.z, 0, 1.6);
        h.kit.paintFan(ring, {
          fill: telegraphFillOf(lady.castRemaining, lady.castTotal),
          clock: h.clock(),
          range: 1.6,
        });
        ring.group.visible = true;
      } else ring.group.visible = false;
    } else ring.group.visible = false;
    if (h.low) return;
    const now = h.clock();
    for (const id of this.embraced) {
      const e = world.entities.get(id);
      if (!e) continue;
      for (let k = 0; k < 2; k++) {
        const [dx, dy, dz] = embraceSpiral(now, Math.floor(h.rand() * 12), 12, 1.1, 2.4);
        h.glow.emit(now, {
          x: e.pos.x + dx,
          y: e.pos.y + dy,
          z: e.pos.z + dz,
          vx: 0,
          vy: 0.6,
          vz: 0,
          life: 0.5,
          drag: 1,
          size0: 0.5,
          size1: 0.1,
          ...FROST,
          a: 0.9,
        });
      }
    }
  }

  /** Her trail of drifting snow (cosmetic). */
  private paintTrail(lady: Entity, dt: number): void {
    const h = this.host;
    if (h.low) return;
    this.snow -= dt;
    if (this.snow > 0) return;
    this.snow = 0.05;
    const now = h.clock();
    h.dust.emit(now, {
      x: lady.pos.x + (h.rand() - 0.5) * 2.5,
      y: lady.pos.y + 0.5 + h.rand() * 4,
      z: lady.pos.z + (h.rand() - 0.5) * 2.5,
      vx: (h.rand() - 0.5) * 0.6,
      vy: -0.4,
      vz: (h.rand() - 0.5) * 0.6,
      life: 2.2,
      drag: 0.3,
      floor: h.groundY(lady.pos.x, lady.pos.z) + 0.05,
      size0: 0.25,
      size1: 0.1,
      r: 0.92,
      g: 0.97,
      b: 1,
      a: 0.75,
    });
  }
}
