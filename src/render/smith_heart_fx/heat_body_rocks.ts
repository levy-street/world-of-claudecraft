// The Guardian of the Heat's stone that is not its body, a part of HeatBody:
// the molten rocks circling it and the basalt its blows fling (Jose's review
// of 2026-11-06: the circling rocks drew plain black). Both are chunks of dark
// basalt split by cracks of lava (one unlit shader: a fixed key from above,
// the wellspring's glow from below, the cracks emissive and breathing), the
// thrown chunks tumbling on a ballistic arc, landing and sinking away.
//
// Cosmetic (src/render/CLAUDE.md): the low tier keeps fewer; nothing here is
// information a player acts on. Built with the owner's root before its gated
// attach (the instanced meshes are their own carriers); fixed pools, matrices
// written in place, no light.

import * as THREE from 'three';
import { heatBodyHash } from './heat_body_core';

const ROCK_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying float vSeed;
void main() {
  vObj = position;
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  vSeed = 0.0;
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = mat3(instanceMatrix) * n;
  vSeed = fract(float(gl_InstanceID) * 0.618);
#endif
  vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;

const ROCK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
varying vec3 vObj;
varying vec3 vN;
varying float vSeed;
float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h31(i), h31(i + vec3(1, 0, 0)), u.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), u.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
void main() {
  vec3 n = normalize(vN);
  vec3 q = vObj * 2.3 + vSeed * 11.0;
  float grain = vn3(q * 3.0) * 0.6 + vn3(q * 7.0) * 0.4;
  // The cracks: thin ridges of a warped noise, wider where it runs hot.
  float c = vn3(q + vn3(q * 1.7) * 0.8);
  float crack = 1.0 - smoothstep(0.0, 0.055, abs(c - 0.5));
  float vein = 1.0 - smoothstep(0.0, 0.16, abs(c - 0.5));
  // Basalt: near-black umber, a cool key from above, the lava's glow below.
  vec3 albedo = mix(vec3(0.055, 0.045, 0.04), vec3(0.15, 0.12, 0.105), grain);
  float key = 0.35 + 0.65 * max(0.0, dot(n, normalize(vec3(0.3, 0.9, 0.25))));
  float under = max(0.0, -n.y);
  vec3 lit = albedo * key * 1.4 + vec3(0.85, 0.24, 0.04) * under * 0.55 * uGlow;
  float breath = 0.75 + 0.25 * sin(uTime * 2.1 + vSeed * 30.0);
  vec3 hot = mix(vec3(0.9, 0.16, 0.01), vec3(1.0, 0.55, 0.1), crack);
  vec3 col = lit + hot * (crack * 1.6 + vein * 0.35) * breath * uGlow;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** A rough chunk of basalt (faceted), its own geometry for every rock. */
function rockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  // Displace each corner by a hash of where it is, so shared corners stay shut.
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const key = Math.round(x * 97) * 7 + Math.round(y * 89) * 13 + Math.round(z * 83) * 17;
    const k = 0.72 + 0.5 * heatBodyHash(key, 29);
    p.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}

/** The rocks' shared shader (unlit; `uGlow` 1 burning, 0 cooled). */
export function heatRockMaterial(uTime: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'smithHeartHeatRock',
    uniforms: { uTime, uGlow: { value: 1 } },
    vertexShader: ROCK_VERT,
    fragmentShader: ROCK_FRAG,
    fog: false,
  });
}

interface Chunk {
  born: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  spin: number;
  landed: number;
}

const GRAVITY = 26;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class HeatBodyRocks {
  /** The circling rocks (the painter writes their matrices). */
  readonly orbit: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  private readonly debris: THREE.InstancedMesh;
  private readonly chunks: Chunk[] = [];
  private cursor = 0;
  private alive = 0;

  constructor(
    root: THREE.Object3D,
    uTime: { value: number },
    orbitCount: number,
    debrisCount: number,
    materials: THREE.Material[],
    geometries: THREE.BufferGeometry[],
  ) {
    const geo = rockGeometry();
    geometries.push(geo);
    this.material = heatRockMaterial(uTime);
    materials.push(this.material);
    const mk = (count: number, name: string) => {
      const m = new THREE.InstancedMesh(geo, this.material, count);
      m.name = name;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < count; i++) m.setMatrixAt(i, _m.makeScale(0, 0, 0));
      m.visible = false;
      root.add(m);
      return m;
    };
    this.orbit = mk(orbitCount, 'smithHeartHeatRocks');
    this.debris = mk(debrisCount, 'smithHeartHeatDebris');
    for (let i = 0; i < debrisCount; i++)
      this.chunks.push({
        born: -99,
        life: 0,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 1,
        spin: 0,
        landed: -1,
      });
  }

  /** Fling `n` chunks of basalt out of (x, y, z), `speed` yards a second. */
  fling(
    x: number,
    y: number,
    z: number,
    n: number,
    speed: number,
    size: number,
    rand: () => number,
  ): void {
    for (let i = 0; i < n; i++) {
      const c = this.chunks[this.cursor];
      this.cursor = (this.cursor + 1) % this.chunks.length;
      const a = rand() * Math.PI * 2;
      const sp = speed * (0.45 + 0.75 * rand());
      c.born = -1;
      c.life = 1.8 + rand() * 0.8;
      c.x = x + Math.cos(a) * 0.6;
      c.y = y;
      c.z = z + Math.sin(a) * 0.6;
      c.vx = Math.cos(a) * sp;
      c.vz = Math.sin(a) * sp;
      c.vy = speed * (0.6 + 0.7 * rand());
      c.size = size * (0.35 + 0.65 * rand());
      c.spin = (rand() - 0.5) * 12;
      c.landed = -1;
    }
    this.alive = this.chunks.length;
  }

  /** Step the thrown chunks (their landing on `groundY`). */
  update(clock: number, dt: number, groundY: (x: number, z: number) => number): void {
    if (this.alive <= 0) {
      if (this.debris.visible) this.debris.visible = false;
      return;
    }
    let live = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (c.born === -1) c.born = clock;
      const age = clock - c.born;
      if (c.life <= 0 || age > c.life) {
        if (c.life > 0) {
          c.life = 0;
          this.debris.setMatrixAt(i, _m.makeScale(0, 0, 0));
        }
        continue;
      }
      live++;
      if (c.landed < 0) {
        c.vy -= GRAVITY * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        const g = groundY(c.x, c.z);
        if (c.y < g + c.size * 0.4 && c.vy < 0) {
          c.y = g + c.size * 0.4;
          c.landed = age;
        }
      }
      // Landed, it settles and sinks away over its last half second.
      const sink = Math.max(0, Math.min(1, (age - (c.life - 0.5)) / 0.5));
      const rot = c.landed < 0 ? age * c.spin : c.landed * c.spin;
      _q.setFromEuler(_e.set(rot, rot * 0.7, rot * 0.4));
      _p.set(c.x, c.y - sink * c.size, c.z);
      _s.setScalar(c.size * (1 - 0.6 * sink));
      this.debris.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.alive = live;
    this.debris.visible = live > 0;
    this.debris.instanceMatrix.needsUpdate = true;
  }

  hide(): void {
    this.orbit.visible = false;
  }

  dispose(): void {
    this.orbit.dispose();
    this.debris.dispose();
  }
}
