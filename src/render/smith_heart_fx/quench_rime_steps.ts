// QuenchRimeSteps, a part of QuenchBody (quench_body.ts): the lake freezing
// where the Guardian of the Quench steps. Every few yards she walks a ring of
// new rime spreads over the ice under her (quench_body_core.ts quenchRimeLook:
// it spreads fast, sets, and thaws slowly away): feathers of white frost round
// a glassy centre, fine darker cracks so it reads on the pale lake, a few
// glints. Cosmetic: the low tier keeps fewer rings; it sits on the encounter
// band's floor rung, under every telegraph of the fight.
//
// Rules (src/render/CLAUDE.md): one instanced mesh and one material built in
// the constructor under the owner's gated root; a fixed pool; no per-frame
// allocation; no light.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { QUENCH_RIME_LIFE, quenchRimeLook } from './quench_body_core';

const VERT = /* glsl */ `
attribute vec2 aLook;
varying vec2 vUv;
varying vec2 vLook;
void main() {
  vUv = uv * 2.0 - 1.0;
  vLook = aLook;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec2 vLook;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float a = atan(vUv.y, vUv.x);
  float seed = vLook.y * 37.0;
  // Feathers of frost reaching out from the centre, ragged at the rim.
  float n = vnoise(vec2(a * 5.0 + seed, r * 3.0));
  float rim = 0.78 + 0.2 * n;
  float body = 1.0 - smoothstep(rim - 0.25, rim, r);
  float feather = abs(sin(a * 9.0 + seed + vnoise(vec2(a * 3.0, r * 6.0 + seed)) * 3.0));
  feather = smoothstep(0.75, 1.0, feather) * smoothstep(0.15, 0.7, r) * body;
  float crack = smoothstep(0.93, 1.0, 1.0 - abs(vnoise(vUv * 7.0 + seed) - 0.5) * 2.0) * body;
  vec3 frost = vec3(0.9, 0.96, 1.0);
  vec3 deep = vec3(0.32, 0.55, 0.8);
  vec3 col = mix(frost, deep, crack * 0.85);
  float glint = step(0.985, h21(floor(vUv * 26.0) + seed)) * (0.5 + 0.5 * sin(uTime * 4.0 + seed * 3.0));
  col += vec3(0.6, 0.85, 1.0) * glint * body;
  float alpha = (body * 0.42 + feather * 0.35 + crack * 0.4 + glint * 0.5) * vLook.x;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85));
}
`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _look = { radius: 0, alpha: 0 };

interface Ring {
  x: number;
  y: number;
  z: number;
  born: number;
  spin: number;
}

export class QuenchRimeSteps {
  readonly mesh: THREE.InstancedMesh;
  private readonly looks: THREE.InstancedBufferAttribute;
  private readonly rings: Ring[] = [];
  private head = 0;
  private lastX = Number.NaN;
  private lastZ = 0;
  private walked = 0;

  constructor(
    parent: THREE.Object3D,
    uTime: { value: number },
    private readonly pool: number,
    private readonly every: number,
    materials: THREE.Material[],
    geometries: THREE.BufferGeometry[],
  ) {
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.looks = new THREE.InstancedBufferAttribute(new Float32Array(pool * 2), 2);
    this.looks.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aLook', this.looks);
    geometries.push(geo);
    const mat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchRime',
      uniforms: { uTime },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    materials.push(mat);
    this.mesh = new THREE.InstancedMesh(geo, mat, pool);
    this.mesh.name = 'smithHeartQuenchRime';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = floorVfxRenderOrder('encounter', 0);
    this.mesh.count = 0;
    for (let i = 0; i < pool; i++) {
      this.rings.push({ x: 0, y: 0, z: 0, born: -99, spin: 0 });
      this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    }
    parent.add(this.mesh);
  }

  /** Forget where she last stepped (a new guardian, a wipe). */
  reset(): void {
    this.lastX = Number.NaN;
    this.walked = 0;
    for (const r of this.rings) r.born = -99;
  }

  /** She stands at (x, z) on the ice at height `y`, `now` seconds in: a ring
   *  freezes under her every `every` yards she walks (and one where she first
   *  stands). */
  step(x: number, y: number, z: number, now: number): void {
    if (Number.isNaN(this.lastX)) {
      this.lastX = x;
      this.lastZ = z;
      this.freeze(x, y, z, now);
      return;
    }
    const d = Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;
    if (d > 6) return; // a teleport, not a step
    this.walked += d;
    if (this.walked >= this.every) {
      this.walked = 0;
      this.freeze(x, y, z, now);
    }
  }

  private freeze(x: number, y: number, z: number, now: number): void {
    const r = this.rings[this.head];
    this.head = (this.head + 1) % this.pool;
    r.x = x;
    r.y = y;
    r.z = z;
    r.born = now;
    r.spin = (Math.sin(now * 12.9898 + x) * 43758.5453) % 1;
  }

  /** Lay the live rings (only those upload and draw). */
  update(now: number): void {
    let n = 0;
    const L = this.looks.array as Float32Array;
    for (const r of this.rings) {
      const age = now - r.born;
      if (age < 0 || age > QUENCH_RIME_LIFE) continue;
      const look = quenchRimeLook(age, _look);
      if (look.alpha <= 0.01) continue;
      _p.set(r.x, r.y + 0.06, r.z);
      _q.setFromAxisAngle(_up, r.spin * Math.PI * 2);
      _s.set(look.radius, 1, look.radius);
      this.mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
      L[n * 2] = look.alpha;
      L[n * 2 + 1] = Math.abs(r.spin);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.looks.needsUpdate = true;
    }
  }

  hide(): void {
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}
