// QuenchBreathStreaks, a part of QuenchBody (quench_body.ts): Quenching
// Breath's wind made visible. As the cold leaves her mouth, streaks of
// freezing wind tear down the cone toward the ice: each a long blade of
// wind, white-cyan at its head and deep blue at its edges (so it reads on the
// white lake as well as on her dark gown), born a few yards out from her
// mouth (her face and her heart stay seen through the blast) and thickening
// down the cone. Plan: quench_breath_core.ts. Cosmetic: the cone, its frost
// and its ice are QuenchFx's, on every tier; the low tier halves the streaks.
//
// Rules (src/render/CLAUDE.md): one instanced draw built in the constructor
// under the owner's gated root, a fixed pool, no per-frame allocation, no
// light.

import * as THREE from 'three';
import { QUENCH_BREATH_STREAK as K, quenchBreathStreakFade } from './quench_breath_core';

const VERT = /* glsl */ `
attribute float aFade;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv;
  vFade = aFade;
  vec4 local = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  local = instanceMatrix * local;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * local;
}
`;
/** A streak: its head at uv.y 1, its tail fading to nothing; a bright core
 *  down its middle in a deep blue edge. */
const FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uCore;
uniform vec3 uHot;
varying vec2 vUv;
varying float vFade;
void main() {
  float across = abs(vUv.x * 2.0 - 1.0);
  float core = 1.0 - smoothstep(0.0, 0.35, across);
  float body = 1.0 - smoothstep(0.45, 1.0, across);
  float along = smoothstep(0.0, 0.75, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
  float a = vFade * along * max(body * 0.6, core);
  vec3 col = mix(uDeep, uCore, core);
  col = mix(col, uHot, core * smoothstep(0.6, 1.0, vUv.y) * 0.8);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.9));
}
`;

/** Two ribbons crossed along +z (length 1 from 0 to 1, width 1): seen from
 *  any side, a streak never thins to a line. */
function streakGeometry(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const b = a.clone().rotateZ(Math.PI / 2);
  const pos = new Float32Array(a.attributes.position.count * 6);
  const uv = new Float32Array(a.attributes.uv.count * 4);
  pos.set(a.attributes.position.array as Float32Array, 0);
  pos.set(b.attributes.position.array as Float32Array, a.attributes.position.count * 3);
  // uv.y along the streak (z), uv.x across it.
  const fix = (src: THREE.BufferGeometry, into: Float32Array, at: number) => {
    const p = src.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const across = Math.abs(p.getX(i)) > 1e-4 ? p.getX(i) : p.getY(i);
      into[(at + i) * 2] = across + 0.5;
      into[(at + i) * 2 + 1] = p.getZ(i);
    }
  };
  fix(a, uv, 0);
  fix(b, uv, a.attributes.position.count);
  const idxA = a.index?.array ?? [];
  const n = a.attributes.position.count;
  const idx: number[] = [];
  for (const i of idxA) idx.push(i);
  for (const i of idxA) idx.push(i + n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  a.dispose();
  b.dispose();
  return g;
}

interface Streak {
  born: number;
  life: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  speed: number;
  len: number;
  width: number;
  roll: number;
  live: boolean;
}

const color = (c: readonly [number, number, number]) => new THREE.Color(c[0], c[1], c[2]);

export class QuenchBreathStreaks {
  private readonly mesh: THREE.InstancedMesh;
  private readonly fade: THREE.InstancedBufferAttribute;
  private readonly pool: Streak[];
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qr = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private readonly d = new THREE.Vector3();

  constructor(
    parent: THREE.Object3D,
    count: number,
    deep: readonly [number, number, number],
    core: readonly [number, number, number],
    hot: readonly [number, number, number],
    materials: THREE.Material[],
    geometries: THREE.BufferGeometry[],
  ) {
    const geo = streakGeometry();
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', this.fade);
    geometries.push(geo);
    const mat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchBreathStreak',
      uniforms: {
        uDeep: { value: color(deep) },
        uCore: { value: color(core) },
        uHot: { value: color(hot) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    materials.push(mat);
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.name = 'smithHeartQuenchBreathStreaks';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    parent.add(this.mesh);
    this.pool = Array.from({ length: count }, () => ({
      born: 0,
      life: 0,
      x: 0,
      y: 0,
      z: 0,
      dx: 0,
      dy: 0,
      dz: 1,
      speed: 0,
      len: 1,
      width: 0.3,
      roll: 0,
      live: false,
    }));
  }

  /** Loose one streak from (x, y, z) along the unit (dx, dy, dz); `r` a
   *  0..1 draw for its own speed, length and roll. */
  emit(
    clock: number,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    r: number,
  ): void {
    const s = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    s.born = clock;
    s.life = K.life * (0.8 + 0.4 * r);
    s.x = x;
    s.y = y;
    s.z = z;
    s.dx = dx;
    s.dy = dy;
    s.dz = dz;
    s.speed = K.speed * (0.8 + 0.4 * ((r * 7.13) % 1));
    s.len = K.length[0] + (K.length[1] - K.length[0]) * ((r * 3.71) % 1);
    s.width = K.width * (0.7 + 0.6 * ((r * 5.3) % 1));
    s.roll = r * Math.PI;
    s.live = true;
    this.mesh.visible = true;
  }

  update(clock: number): void {
    if (!this.mesh.visible) return;
    let any = false;
    for (let i = 0; i < this.pool.length; i++) {
      const s = this.pool[i];
      if (!s.live) continue;
      const age = clock - s.born;
      const k = age / s.life;
      if (k >= 1 || k < 0) {
        s.live = false;
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        this.fade.setX(i, 0);
        continue;
      }
      any = true;
      const travel = s.speed * age;
      this.v.set(s.x + s.dx * travel, s.y + s.dy * travel, s.z + s.dz * travel);
      this.d.set(s.dx, s.dy, s.dz);
      this.q.setFromUnitVectors(this.fwd, this.d);
      this.qr.setFromAxisAngle(this.fwd, s.roll);
      this.q.multiply(this.qr);
      // It stretches as it flies, its head at the travel point.
      const len = s.len * (0.4 + 0.6 * Math.min(1, k * 3));
      this.v.addScaledVector(this.d, -len);
      const w = s.width * (0.6 + 0.8 * k);
      this.s.set(w, w, len);
      this.mesh.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
      this.fade.setX(i, quenchBreathStreakFade(k));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fade.needsUpdate = true;
    if (!any) this.mesh.visible = false;
  }

  /** Every slot cleared (none redrawn frozen at the next emit). */
  hide(): void {
    for (let i = 0; i < this.pool.length; i++) {
      this.pool[i].live = false;
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.fade.setX(i, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fade.needsUpdate = true;
    this.mesh.visible = false;
  }

  /** Free the instanced draw's own per-instance buffer (its geometry and
   *  material are the owner's arrays). */
  dispose(): void {
    this.mesh.dispose();
  }
}
