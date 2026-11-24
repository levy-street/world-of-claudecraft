// The Hailstorm's falling stones (Elemental Fusion of the Quench and the
// Breath), a part of FinalElementsFx (final_elements_fx.ts keeps each spot's
// circle on the floor, its fill and the stone's shadow, on every tier, and
// hands each falling stone here). The plan and the reasons are
// final_hail_core.ts. Per spot:
//   - a cluster of jagged ice chunks (three faceted shapes, one draw each),
//     translucent blue with a bright rim, inner cracks and frost, tumbling as
//     they fall, every chunk landing on the sim's beat inside the circle;
//   - a frost trail streaming up behind each chunk (one draw);
//   - when it hits: ice shards thrown out, bouncing and skidding to a stop,
//     melting away (one draw for every burst).
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the host's root (the kit's one gated attach, so the first
// hailstone never compiles a program); fixed pools; no light; no per-frame
// allocation.

import * as THREE from 'three';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import {
  type HailChunk,
  type HailShard,
  hailChunk,
  hailChunkHeight,
  hailShardAt,
  hailTrailLength,
  iceCornerScale,
  HAIL_LOOK as L,
} from './final_hail_core';

/** The ice (the chunks and the shards): faceted, translucent, a bright rim,
 *  cracks and frost inside. Instanced; the light is fixed in view space. */
const ICE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying vec3 vObj;
varying float vSeed;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 nn = normal;
  vSeed = 0.0;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    nn = mat3(instanceMatrix) * nn;
    vSeed = fract(instanceMatrix[3].x * 0.371 + instanceMatrix[3].z * 0.713);
  #endif
  vObj = position;
  vec4 mv = modelViewMatrix * p;
  vN = normalize(normalMatrix * nn);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const ICE_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vView;
varying vec3 vObj;
varying float vSeed;
float ih(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float in3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(ih(i), ih(i + vec3(1, 0, 0)), u.x), mix(ih(i + vec3(0, 1, 0)), ih(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(ih(i + vec3(0, 0, 1)), ih(i + vec3(1, 0, 1)), u.x), mix(ih(i + vec3(0, 1, 1)), ih(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  float ndv = abs(dot(n, v));
  float fres = pow(1.0 - ndv, 2.2);
  vec3 l = normalize(vec3(-0.35, 0.85, 0.4));
  float key = max(dot(n, l), 0.0);
  // Deep blue where you look through it, paler on the lit facets.
  vec3 deep = vec3(0.02, 0.1, 0.26);
  vec3 lit = vec3(0.24, 0.52, 0.82);
  vec3 col = mix(deep, lit, 0.2 + 0.8 * key);
  // Cracks running through it: thin bright sheets in its own space.
  vec3 q = vObj * 2.7 + vSeed * 9.0;
  float c1 = 1.0 - smoothstep(0.0, 0.045, abs(in3(q) - 0.5));
  float c2 = 1.0 - smoothstep(0.0, 0.035, abs(in3(q * 1.9 + 4.0) - 0.5));
  col += vec3(0.55, 0.8, 1.0) * max(c1, c2 * 0.7) * (0.25 + 0.35 * (1.0 - ndv));
  // Frost: white powder clinging to the facets.
  float fr = smoothstep(0.58, 0.82, in3(vObj * 5.5 + 3.0 + vSeed * 4.0));
  col = mix(col, vec3(0.78, 0.9, 1.0), fr * 0.35);
  // The bright rim and a hard glint.
  col += vec3(0.6, 0.88, 1.0) * fres * 0.85;
  float spec = pow(max(dot(reflect(-v, n), l), 0.0), 30.0);
  col += vec3(1.0) * spec * 0.9;
  float a = clamp(0.86 + 0.14 * fres + fr * 0.2 + max(c1, c2) * 0.1, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

/** The frost trail: a card standing up from the stone, turned to the camera
 *  round the vertical; its width and length are the instance's x and y
 *  scale. */
const TRAIL_VERT = /* glsl */ `
varying vec2 vUv;
varying float vSeed;
${CAMERA_RELATIVE_GLSL}
void main() {
  vUv = position.xy + 0.5;
  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float wid = length(instanceMatrix[0].xyz);
  float len = length(instanceMatrix[1].xyz);
  vSeed = fract(c.x * 0.37 + c.z * 0.71);
  vec3 toCam = cameraPosition - c;
  toCam.y = 0.0;
  float l = length(toCam);
  vec3 f = l > 1e-4 ? toCam / l : vec3(0.0, 0.0, 1.0);
  vec3 side = vec3(f.z, 0.0, -f.x);
  // Wider as it trails up (the vapour spreading behind the stone).
  float spread = 0.55 + 0.9 * vUv.y;
  vec3 w = c + side * position.x * wid * spread + vec3(0.0, vUv.y * len, 0.0);
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

const TRAIL_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
float th(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(th(i), th(i + vec2(1.0, 0.0)), u.x), mix(th(i + vec2(0.0, 1.0)), th(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float x = vUv.x * 2.0 - 1.0;
  float y = vUv.y;
  // Wisps: streaks along the fall, broken up as they thin.
  float n = tn(vec2(x * 2.5 + vSeed * 11.0, y * 3.0 + uTime * 2.0)) * 0.6 + tn(vec2(x * 6.0 - vSeed * 5.0, y * 7.0 + uTime * 4.0)) * 0.4;
  // Wisps peeling off the sides as it thins (never a straight beam).
  float xw = x + (n - 0.5) * 0.9 * y;
  float core = exp(-xw * xw * 4.0);
  float a = core * pow(1.0 - y, 1.6) * smoothstep(0.2, 0.75, n + 0.25 * (1.0 - y)) * smoothstep(0.0, 0.08, y);
  vec3 col = mix(vec3(0.94, 0.98, 1.0), vec3(0.55, 0.8, 1.0), y);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * 0.5);
}
`;

/** What FinalElementsFx lends the stones. */
export interface FinalHailHost {
  root: THREE.Object3D;
  uTime: { value: number };
  density: number;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  /** The standing bodies' draw order. */
  order: number;
  /** Spots in the air at once (the kit's pool). */
  spots: number;
}

/** A jagged ice lump: a unit solid with its corners pushed in and out,
 *  faceted (flat normals). */
function chunkGeometry(shape: number): THREE.BufferGeometry {
  const base =
    shape === 0
      ? new THREE.IcosahedronGeometry(1, 0)
      : shape === 1
        ? new THREE.DodecahedronGeometry(1, 0)
        : new THREE.OctahedronGeometry(1, 1);
  const g = base.index ? base.toNonIndexed() : base;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = iceCornerScale(x, y, z, shape);
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  if (g !== base) base.dispose();
  return g;
}

interface Burst {
  x: number;
  y: number;
  z: number;
  born: number;
  seed: number;
  alive: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class FinalHailFx {
  private readonly chunks: THREE.InstancedMesh[] = [];
  private readonly used: number[] = [];
  private readonly trails: THREE.InstancedMesh;
  private trailUsed = 0;
  private readonly shards: THREE.InstancedMesh;
  private readonly bursts: Burst[] = [];
  private readonly perSpot: number;
  private readonly perBurst: number;
  private readonly chunk: HailChunk = {
    dx: 0,
    dz: 0,
    size: 0,
    sx: 0,
    sy: 0,
    sz: 0,
    lag: 0,
    shape: 0,
    ax: 0,
    ay: 1,
    az: 0,
    spin: 0,
  };
  private readonly shard: HailShard = { x: 0, y: 0, z: 0, scale: 0, spin: 0 };
  private burstSeed = 0;

  constructor(h: FinalHailHost) {
    const detail = h.density >= 1;
    this.perSpot = detail ? L.stones : L.stonesLow;
    this.perBurst = detail ? L.shards : L.shardsLow;
    const ice = new THREE.ShaderMaterial({
      name: 'smithHeartFinalHailIce',
      uniforms: { uTime: h.uTime },
      vertexShader: ICE_VERT,
      fragmentShader: ICE_FRAG,
      transparent: true,
      depthWrite: true,
      toneMapped: false,
      fog: false,
    });
    h.materials.push(ice);
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, name: string) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.name = name;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) m.setMatrixAt(i, ZERO);
      m.visible = false;
      m.renderOrder = h.order;
      h.root.add(m);
      return m;
    };
    const cap = h.spots * this.perSpot;
    for (let s = 0; s < L.shapes; s++) {
      const g = chunkGeometry(s);
      h.geometries.push(g);
      this.chunks.push(instanced(g, ice, cap, `smithHeartFinalHailStones${s}`));
      this.used.push(0);
    }
    const trailGeo = new THREE.PlaneGeometry(1, 1, 1, 6);
    h.geometries.push(trailGeo);
    const trailMat = new THREE.ShaderMaterial({
      name: 'smithHeartFinalHailTrail',
      uniforms: { uTime: h.uTime },
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    h.materials.push(trailMat);
    this.trails = instanced(trailGeo, trailMat, cap, 'smithHeartFinalHailTrail');
    this.trails.renderOrder = h.order + 1;
    // A shard: a thin sliver of the same ice.
    const shardGeo = new THREE.TetrahedronGeometry(1, 0).scale(0.55, 1.5, 0.4);
    shardGeo.computeVertexNormals();
    h.geometries.push(shardGeo);
    this.shards = instanced(shardGeo, ice, L.bursts * this.perBurst, 'smithHeartFinalHailShards');
    for (let i = 0; i < L.bursts; i++)
      this.bursts.push({ x: 0, y: 0, z: 0, born: -9, seed: 0, alive: false });
  }

  begin(): void {
    for (let i = 0; i < this.used.length; i++) this.used[i] = 0;
    this.trailUsed = 0;
  }

  /** A spot's stones this frame: the spot (its floor at y), the sim's
   *  radius, the main stone's height over the floor of a `drop` fall, the
   *  painter clock (their tumble). */
  stone(
    id: number,
    x: number,
    y: number,
    z: number,
    r: number,
    height: number,
    drop: number,
    clock: number,
  ): void {
    const c = this.chunk;
    for (let k = 0; k < this.perSpot; k++) {
      hailChunk(k, id, r, c);
      const mesh = this.chunks[c.shape];
      const i = this.used[c.shape];
      if (i >= mesh.count) continue;
      this.used[c.shape] = i + 1;
      const cy = y + hailChunkHeight(height, c.lag) + c.sy * 0.8;
      _q.setFromAxisAngle(_a.set(c.ax, c.ay, c.az), c.spin * clock + id * 1.7 + k);
      mesh.setMatrixAt(i, _m.compose(_v.set(x + c.dx, cy, z + c.dz), _q, _s.set(c.sx, c.sy, c.sz)));
      const t = this.trailUsed;
      if (t < this.trails.count) {
        this.trailUsed = t + 1;
        const len = hailTrailLength(height, drop) * (0.6 + 0.4 * (c.size / L.mainSize));
        _q.identity();
        this.trails.setMatrixAt(
          t,
          _m.compose(_v.set(x + c.dx, cy, z + c.dz), _q, _s.set(c.size * 1.7, len, 1)),
        );
      }
    }
  }

  /** A stone hits the floor at (x, y, z): its shards fly. */
  shatter(x: number, y: number, z: number, clock: number): void {
    let b = this.bursts.find((k) => !k.alive);
    if (!b) {
      b = this.bursts[0];
      for (const k of this.bursts) if (k.born < b.born) b = k;
    }
    b.alive = true;
    b.x = x;
    b.y = y;
    b.z = z;
    b.born = clock;
    b.seed = this.burstSeed++;
  }

  /** Upload the stones; fly the shards. */
  end(clock: number): void {
    for (let s = 0; s < this.chunks.length; s++) this.flush(this.chunks[s], this.used[s]);
    this.flush(this.trails, this.trailUsed);
    let used = 0;
    const sh = this.shard;
    for (const b of this.bursts) {
      if (!b.alive) continue;
      const age = clock - b.born;
      if (age >= L.shardLife || age < 0) {
        b.alive = false;
        continue;
      }
      for (let i = 0; i < this.perBurst; i++) {
        hailShardAt(i, b.seed, age, sh);
        if (sh.scale <= 0.001) continue;
        _q.setFromAxisAngle(_a.set(0.6, 0.3, 0.74).normalize(), sh.spin);
        this.shards.setMatrixAt(
          used++,
          _m.compose(_v.set(b.x + sh.x, b.y + sh.y, b.z + sh.z), _q, _s.setScalar(sh.scale)),
        );
      }
    }
    this.flush(this.shards, used);
  }

  private flush(m: THREE.InstancedMesh, used: number): void {
    const was = (m.userData.used as number | undefined) ?? 0;
    for (let i = used; i < was; i++) m.setMatrixAt(i, ZERO);
    m.userData.used = used;
    if (used > 0 || was > 0) m.instanceMatrix.needsUpdate = true;
    m.visible = used > 0;
  }

  hide(): void {
    for (const b of this.bursts) b.alive = false;
    this.begin();
    this.end(0);
  }

  dispose(): void {
    for (const m of this.chunks) m.dispose();
    this.trails.dispose();
    this.shards.dispose();
  }
}
