// The basin's thorn spikes (plan: basin_thorns_core.ts): hooked thorns that
// tear up out of the loam where a lash lands and down the rest of its lane,
// stand a moment and sink back. One instanced draw for every spike of every
// wave, a fixed pool re-laid slot by slot (the oldest re-used when it runs
// out), matrices written only while a spike stands. Lent to the Gorgebloom's
// and the Snarlvine Lasher's effects through BasinFxHost.thorns.
//
// Built under the WildheartFx root before its gated attach; lit by the basin
// sun in the shader (no light). Cosmetic: the lanes' telegraphs are the kit's.

import * as THREE from 'three';
import { BASIN_SUN_DIRECTION } from './basin_plan_core';
import { type ThornGrowth, thornGrowthInto } from './basin_thorns_core';

const THORN_SLOTS = 96;

const THORN_VERT = /* glsl */ `
attribute float aV;
varying float vV;
varying vec3 vN;
void main() {
  vV = aV;
  mat4 m = modelMatrix * instanceMatrix;
  // The spikes are scaled unevenly (girth, height): the normal takes the
  // inverse scale so a stretched thorn still lights along its flanks.
  mat3 im = mat3(instanceMatrix);
  vec3 s2 = vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
  vN = normalize(mat3(modelMatrix) * (im * (normal / max(s2, vec3(1e-6)))));
  gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
}
`;

const THORN_FRAG = /* glsl */ `
uniform vec3 uSun;
varying float vV;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  float lit = 0.42 + 0.58 * max(dot(n, uSun), 0.0);
  // Dark mossy bark at the root, raw green up the spike, a blood-red hook.
  vec3 bark = mix(vec3(0.09, 0.12, 0.05), vec3(0.22, 0.34, 0.1), smoothstep(0.05, 0.55, vV));
  vec3 col = mix(bark, vec3(0.5, 0.07, 0.06), smoothstep(0.62, 0.97, vV)) * lit;
  // A wet sap sheen along the flanks.
  col += vec3(0.55, 0.8, 0.25) * pow(max(1.0 - abs(n.y), 0.0), 4.0) * 0.07;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** A hooked thorn: base on y = 0, 1 tall, curving forward (+z) toward its tip. */
function thornGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.26, 1, 7, 5, false).translate(0, 0.5, 0);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    v[i] = y;
    pos.setZ(i, pos.getZ(i) + 0.3 * y * y);
  }
  g.setAttribute('aV', new THREE.BufferAttribute(v, 1));
  g.computeVertexNormals();
  return g;
}

export class BasinThorns {
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly pos = new Float32Array(THORN_SLOTS * 3);
  private readonly yaw = new Float32Array(THORN_SLOTS);
  private readonly tilt = new Float32Array(THORN_SLOTS);
  private readonly size = new Float32Array(THORN_SLOTS * 2);
  private readonly born = new Float32Array(THORN_SLOTS);
  private readonly live = new Uint8Array(THORN_SLOTS);
  private liveCount = 0;
  private clock = 0;
  private readonly growth: ThornGrowth = { grow: 0, sink: 0, alive: false };
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    root: THREE.Object3D,
    private readonly groundY: (x: number, z: number) => number,
    private readonly rand: () => number,
  ) {
    this.geometry = thornGeometry();
    this.material = new THREE.ShaderMaterial({
      name: 'wildheartBasinThorns',
      uniforms: { uSun: { value: new THREE.Vector3(...BASIN_SUN_DIRECTION).normalize() } },
      vertexShader: THORN_VERT,
      fragmentShader: THORN_FRAG,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, THORN_SLOTS);
    this.mesh.name = 'wildheartBasinThorns';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < THORN_SLOTS; i++) this.mesh.setMatrixAt(i, this.zero);
    root.add(this.mesh);
  }

  /** A thorn tearing up at (x, z) `delay` seconds from now: its heading, its
   *  lean (radians off upright, toward its hook) and its height (yards). */
  spawn(x: number, z: number, yaw: number, tilt: number, height: number, delay = 0): void {
    let slot = -1;
    let oldest = 0;
    for (let i = 0; i < THORN_SLOTS; i++) {
      if (!this.live[i]) {
        slot = i;
        break;
      }
      if (this.born[i] < this.born[oldest]) oldest = i;
    }
    if (slot < 0) slot = oldest;
    const o = slot * 3;
    this.pos[o] = x;
    this.pos[o + 1] = this.groundY(x, z);
    this.pos[o + 2] = z;
    this.yaw[slot] = yaw;
    this.tilt[slot] = tilt;
    this.size[slot * 2] = height;
    this.size[slot * 2 + 1] = 0.75 + 0.5 * this.rand();
    this.born[slot] = this.clock + delay;
    if (!this.live[slot]) this.liveCount++;
    this.live[slot] = 1;
  }

  /** Some spike still stands (or waits to tear up). */
  busy(): boolean {
    return this.liveCount > 0;
  }

  /** Lay every standing spike out; the draw only covers the slots up to the
   *  highest one standing (spawns fill from the bottom), and only those
   *  matrices upload. Owns the mesh's visibility. */
  update(clock: number): void {
    this.clock = clock;
    if (this.liveCount <= 0) return;
    let live = 0;
    let hi = -1;
    for (let i = 0; i < THORN_SLOTS; i++) {
      if (!this.live[i]) continue;
      const g = thornGrowthInto(clock - this.born[i], this.growth);
      if (!g.alive) {
        this.live[i] = 0;
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      live++;
      hi = i;
      const o = i * 3;
      const h = this.size[i * 2] * g.grow;
      const w = this.size[i * 2 + 1] * (0.6 + 0.4 * Math.min(1, g.grow));
      this.tmpE.set(this.tilt[i], this.yaw[i], 0);
      this.tmpQ.setFromEuler(this.tmpE);
      this.tmpPos.set(this.pos[o], this.pos[o + 1] - 0.15 - g.sink, this.pos[o + 2]);
      this.tmpScale.set(w, Math.max(0.001, h), w);
      this.mesh.setMatrixAt(i, this.tmpM.compose(this.tmpPos, this.tmpQ, this.tmpScale));
    }
    const used = hi + 1;
    this.mesh.count = Math.max(1, used);
    const m = this.mesh.instanceMatrix;
    m.clearUpdateRanges();
    m.addUpdateRange(0, Math.max(1, used) * 16);
    m.needsUpdate = true;
    this.liveCount = live;
    this.mesh.visible = live > 0;
  }

  hideAll(): void {
    this.live.fill(0);
    this.liveCount = 0;
    for (let i = 0; i < THORN_SLOTS; i++) this.mesh.setMatrixAt(i, this.zero);
    const m = this.mesh.instanceMatrix;
    m.clearUpdateRanges();
    m.needsUpdate = true;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
