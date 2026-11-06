// The Guardian of the Breath's orbiters, a part of BreathBody: the small
// stones and crystal shards circling it on its own wind (Jose's concept: a
// halo of grit and shards round the colossus). The stones are scoured granite
// (one unlit shader: a cool key from above, the wind's pale bounce below);
// the shards are its crystal (a cyan body, a white rim, a pulse of light
// inside), dimmed to dull glass in death. Both are instanced; the painter
// writes their matrices from breath_body_core.ts breathOrbit.
//
// Cosmetic (src/render/CLAUDE.md): the low tier keeps fewer; nothing here is
// information a player acts on. Built with the owner's root before its gated
// attach (the instanced meshes are their own carriers); fixed pools, matrices
// written in place, no light.

import * as THREE from 'three';
import { BREATH_ORBIT_LOW, breathBodyHash, breathOrbit } from './breath_body_core';

const ORBIT_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
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
  vec4 wp = modelMatrix * p;
  vN = normalize(mat3(modelMatrix) * n);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;

const ORBIT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform float uStorm;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
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
  float key = 0.4 + 0.6 * max(0.0, dot(n, normalize(vec3(0.3, 0.9, 0.25))));
  float rim = 1.0 - max(0.0, dot(n, normalize(vV)));
#ifdef BREATH_SHARD
  // Crystal: a cyan body, a white rim, a pulse of the vein's light inside.
  float pulse = 0.75 + 0.25 * sin(uTime * 2.7 + vSeed * 40.0);
  vec3 body = mix(vec3(0.18, 0.55, 0.75), vec3(0.55, 0.92, 1.0), key);
  vec3 col = body * (0.55 + 0.45 * uGlow) + vec3(0.7, 0.95, 1.0) * rim * rim * 0.9 * uGlow;
  col += vec3(0.3, 0.85, 1.0) * pulse * 0.35 * uGlow;
  col = mix(col, col * vec3(0.8, 0.9, 1.25), uStorm);
  gl_FragColor = vec4(col, 1.0);
#else
  // Scoured granite: a cool grey, grain, the pale wind under it.
  vec3 q = vObj * 3.1 + vSeed * 9.0;
  float grain = vn3(q * 2.0) * 0.6 + vn3(q * 5.0) * 0.4;
  vec3 albedo = mix(vec3(0.11, 0.12, 0.14), vec3(0.26, 0.27, 0.3), grain);
  float under = max(0.0, -n.y);
  vec3 col = albedo * key * 1.25 + vec3(0.45, 0.6, 0.8) * under * 0.25 + vec3(0.6, 0.75, 0.95) * rim * 0.18;
  gl_FragColor = vec4(col, 1.0);
#endif
}
`;

/** A rough faceted chunk (hashed corners, shared corners kept shut). */
function chunkGeometry(seed: number, squash: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const key = Math.round(x * 97) * 7 + Math.round(y * 89) * 13 + Math.round(z * 83) * 17;
    const k = 0.7 + 0.55 * breathBodyHash(key, seed);
    p.setXYZ(i, x * k, y * k * squash, z * k);
  }
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}

/** A crystal shard: a long six-sided double point. */
function shardGeometry(): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(1, 0);
  g.scale(0.38, 1.25, 0.38);
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _o = { x: 0, y: 0, z: 0, size: 0, spin: 0 };

export class BreathBodyOrbit {
  readonly stones: THREE.InstancedMesh;
  readonly shards: THREE.InstancedMesh;
  readonly stoneMat: THREE.ShaderMaterial;
  readonly shardMat: THREE.ShaderMaterial;

  constructor(
    root: THREE.Object3D,
    uTime: { value: number },
    private readonly stoneCount: number,
    private readonly shardCount: number,
    private readonly low: boolean,
    materials: THREE.Material[],
    geometries: THREE.BufferGeometry[],
  ) {
    const mat = (shard: boolean) =>
      new THREE.ShaderMaterial({
        name: shard ? 'smithHeartBreathShard' : 'smithHeartBreathStone',
        uniforms: { uTime, uGlow: { value: 1 }, uStorm: { value: 0 } },
        defines: shard ? { BREATH_SHARD: 1 } : {},
        vertexShader: ORBIT_VERT,
        fragmentShader: ORBIT_FRAG,
        fog: false,
      });
    this.stoneMat = mat(false);
    this.shardMat = mat(true);
    materials.push(this.stoneMat, this.shardMat);
    const sg = chunkGeometry(31, 0.75);
    const cg = shardGeometry();
    geometries.push(sg, cg);
    this.stones = new THREE.InstancedMesh(sg, this.stoneMat, stoneCount);
    this.shards = new THREE.InstancedMesh(cg, this.shardMat, shardCount);
    this.stones.name = 'smithHeartBreathStones';
    this.shards.name = 'smithHeartBreathShards';
    for (const m of [this.stones, this.shards]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(m);
    }
  }

  /** Place every orbiter round (x, y, z) facing `yaw`, `show` 0 gone to 1
   *  circling, `storm` 0..1 thrown wider, `drop` 0..1 fallen in death (to
   *  `floor`). Returns nothing; the matrices are written in place. */
  update(
    x: number,
    y: number,
    z: number,
    t: number,
    show: number,
    storm: number,
    drop: number,
    floor: number,
  ): void {
    const on = show > 0.01;
    this.stones.visible = on;
    this.shards.visible = on;
    if (!on) return;
    this.stoneMat.uniforms.uStorm.value = storm;
    this.shardMat.uniforms.uStorm.value = storm;
    const keep = this.low ? BREATH_ORBIT_LOW : 1e9;
    const write = (mesh: THREE.InstancedMesh, count: number, base: number, shard: boolean) => {
      // The low tier draws (and uploads) only the first few.
      const n = Math.min(count, keep);
      mesh.count = n;
      for (let i = 0; i < n; i++) {
        breathOrbit(base + i, t, storm, _o);
        const yy = y + _o.y * (1 - drop) + (floor - y + _o.size) * drop;
        _p.set(x + _o.x * (1 + 0.3 * drop), yy, z + _o.z * (1 + 0.3 * drop));
        if (shard)
          _q.setFromEuler(_e.set(0.4 * Math.sin(_o.spin), _o.spin, 0.3 * Math.cos(_o.spin)));
        else _q.setFromEuler(_e.set(_o.spin, _o.spin * 0.7, _o.spin * 0.3));
        _s.setScalar(_o.size * Math.min(1, show));
        mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
    };
    write(this.stones, this.stoneCount, 0, false);
    write(this.shards, this.shardCount, 100, true);
  }

  /** Light the shards (1) or let them go dark (0, death). */
  setGlow(k: number): void {
    this.shardMat.uniforms.uGlow.value = k;
  }
}
