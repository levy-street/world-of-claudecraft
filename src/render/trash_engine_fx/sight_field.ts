// The line-of-sight field's floor surface (layout and the reasons in
// sight_field_core.ts): a dense polar grid draped on the real floor once per
// bar, nearest the caster first and a budget of floor samples a frame, so no
// single frame pays for the whole disc. A ray's reach is a per-sector
// attribute (`aReach`) the fragment shader cuts the lit floor and its hatched
// shadow against; the vertex shader pulls every vertex a hand toward the
// camera along its own view ray (no z-fight, same pixels), and the fragment
// shader drops any triangle steeper than a walkable slope (a drop, a riser).
//
// Shared by the trash engine's nova (engine_nova.ts) and Cantor Ilvane's
// Dirge (../hollow_crypt/ilvane_dirge_fx.ts). Every buffer is allocated in
// the constructor; begin / drapeSome / setRay write in place.

import * as THREE from 'three';
import {
  SIGHT_COLUMNS_PER_SECTOR,
  SIGHT_DEPTH_PULL,
  SIGHT_MIN_NORMAL_Y,
  sectorReach,
  sightColumnAngle,
  sightColumnCount,
  sightDrapeSamples,
  sightIndex,
  sightVertex,
  sightVertexCount,
} from './sight_field_core';

/**
 * The field's vertex stage: `vR` (yards out from the caster), `vReach` (the
 * sector's sight reach), `vWorld` (the floor point, for world-locked
 * patterns) and `vLocal` (the same point from the caster: small numbers, so
 * its screen derivatives stay exact) for the fragment stage.
 *
 * The position is transformed CAMERA-RELATIVE (`modelViewMatrix`, composed on
 * the CPU in double precision), never as a world point times the view matrix
 * on the GPU: the dungeon instance bands sit a hundred thousand yards out,
 * where a float32 world position is only good to a few hundredths of a yard,
 * and that rounding (more than the field's lift over the floor) shifting with
 * the camera was the field flickering and interleaving with the stone. Then
 * every vertex is pulled a hand toward the camera along its own view ray (the
 * view-space origin): same pixels, always in front of the floor it lies on.
 */
export const SIGHT_FIELD_VERT = /* glsl */ `
attribute float aR;
attribute float aReach;
varying float vR;
varying float vReach;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vR = aR;
  vReach = aReach;
  vLocal = position;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dc = max(length(mv.xyz), 1e-3);
  mv.xyz -= mv.xyz * (min(${SIGHT_DEPTH_PULL.toFixed(3)}, dc * 0.25) / dc);
  gl_Position = projectionMatrix * mv;
}
`;

/**
 * `sightSteep(vLocal)`: is this triangle steeper than a walkable slope? Call
 * it FIRST in main (before any discard): it reads screen derivatives, which
 * are flat per triangle. Pass the caster-local point, never the world one
 * (float precision far out in the instance bands makes world derivatives
 * noisy and the test fire at random).
 */
export const SIGHT_STEEP_GLSL = /* glsl */ `
varying vec3 vLocal;
bool sightSteep(vec3 p) {
  vec3 n = cross(dFdx(p), dFdy(p));
  float l = length(n);
  return l > 1e-9 && abs(n.y) < ${SIGHT_MIN_NORMAL_Y.toFixed(3)} * l;
}
`;

/**
 * `sightShade(vR, vReach, radius, vLocal)`: the shadow behind cover, one look
 * for every sight field so a player learns it once: dark, cool and hatched
 * (the blast cannot see here), brighter near the cover that throws it, its
 * outer edge a faint dotted trace of the reach round the caster. Fed the
 * caster-local point (exact; a world point far out in an instance band is
 * not). Returns rgb and alpha.
 */
export const SIGHT_SHADE_GLSL = /* glsl */ `
vec4 sightShade(float r, float reach, float radius, vec3 local) {
  float hatch = step(0.5, fract((local.x + local.z) * 0.9));
  float near = 1.0 - smoothstep(0.0, 1.2, r - reach);
  float trace = (1.0 - smoothstep(0.08, 0.2, radius - r)) * step(0.5, fract(atan(local.z, local.x) * 30.0));
  vec3 col = mix(vec3(0.02, 0.05, 0.09), vec3(0.45, 0.8, 0.95), hatch * 0.25 + near * 0.35);
  return vec4(col, 0.34 + hatch * 0.08 + near * 0.2 + trace * 0.35);
}
`;

/** Floor samples an owner lets its draping fields take in one frame, shared
 *  across all of them (`drapeSome` returns what it spent). */
export const SIGHT_DRAPE_BUDGET = 1100;

export class SightFieldSurface {
  readonly geometry: THREE.BufferGeometry;
  private readonly pos: THREE.BufferAttribute;
  private readonly rAttr: THREE.BufferAttribute;
  private readonly reachAttr: THREE.BufferAttribute;
  private readonly sinQ: Float32Array;
  private readonly cosQ: Float32Array;
  private readonly samples: number;
  private radius = 1;
  private lift = 0;
  private x = 0;
  private y = 0;
  private z = 0;
  /** Floor samples laid so far this bar. */
  private draped = 0;

  constructor(
    readonly rays: number,
    readonly stations: number,
  ) {
    const count = sightVertexCount(rays, stations);
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.rAttr = new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.reachAttr = new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(
      THREE.DynamicDrawUsage,
    );
    g.setAttribute('position', this.pos);
    g.setAttribute('aR', this.rAttr);
    g.setAttribute('aReach', this.reachAttr);
    g.setIndex(sightIndex(rays, stations));
    this.geometry = g;
    const cols = sightColumnCount(rays);
    this.sinQ = new Float32Array(cols);
    this.cosQ = new Float32Array(cols);
    for (let q = 0; q < cols; q++) {
      const a = sightColumnAngle(q, rays);
      // Sim convention: angle 0 looks down +z (x = sin, z = cos).
      this.sinQ[q] = Math.sin(a);
      this.cosQ[q] = Math.cos(a);
    }
    this.samples = sightDrapeSamples(rays, stations);
  }

  /** Is the whole disc on the floor yet? */
  get drapedAll(): boolean {
    return this.draped >= this.samples;
  }

  /**
   * Start a field at the floor point (x, y, z) out to `radius`, `lift` over
   * the floor: laid flat at the caster's floor height (the drape then follows
   * the ground outward) and wholly lit. The owner's mesh sits at (x, y, z).
   */
  begin(x: number, y: number, z: number, radius: number, lift: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.radius = radius;
    this.lift = lift;
    this.draped = 0;
    const K = this.stations;
    const p = this.pos.array as Float32Array;
    const r = this.rAttr.array as Float32Array;
    const reach = this.reachAttr.array as Float32Array;
    for (let s = 0; s < this.rays; s++) {
      for (let k = 0; k <= K; k++) {
        const d = (radius * k) / K;
        for (let c = 0; c < SIGHT_COLUMNS_PER_SECTOR; c++) {
          const q = c < 2 ? s * 2 + c : ((s + 1) % this.rays) * 2;
          const v = sightVertex(s, k, c, K);
          p[v * 3] = this.sinQ[q] * d;
          p[v * 3 + 1] = lift;
          p[v * 3 + 2] = this.cosQ[q] * d;
          r[v] = d;
          reach[v] = radius;
        }
      }
    }
    this.pos.needsUpdate = true;
    this.rAttr.needsUpdate = true;
    this.reachAttr.needsUpdate = true;
  }

  /** Lay up to `budget` more floor samples, nearest first (the order of
   *  sightDrapeSample, inlined: no allocation). Returns the samples spent. */
  drapeSome(groundY: (x: number, z: number) => number, budget = SIGHT_DRAPE_BUDGET): number {
    if (this.draped >= this.samples || budget <= 0) return 0;
    const K = this.stations;
    const cols = this.rays * 2;
    const p = this.pos.array as Float32Array;
    const start = this.draped;
    const end = Math.min(this.samples, start + budget);
    for (let n = start; n < end; n++) {
      const k = Math.floor(n / cols);
      const q = n - k * cols;
      const d = (this.radius * k) / K;
      const wx = this.x + this.sinQ[q] * d;
      const wz = this.z + this.cosQ[q] * d;
      const h = groundY(wx, wz) - this.y + this.lift;
      if ((q & 1) === 1) {
        p[sightVertex((q - 1) >> 1, k, 1, K) * 3 + 1] = h;
      } else {
        const s = q >> 1;
        p[sightVertex(s, k, 0, K) * 3 + 1] = h;
        p[sightVertex((s + this.rays - 1) % this.rays, k, 2, K) * 3 + 1] = h;
      }
    }
    this.draped = end;
    this.pos.needsUpdate = true;
    return end - start;
  }

  /** Every sector's reach from the per-ray reaches. */
  setReach(reach: ArrayLike<number>): void {
    for (let s = 0; s < this.rays; s++) this.writeSector(reach, s);
    this.reachAttr.needsUpdate = true;
  }

  /** Ray `ray`'s reach changed: rewrite the two sectors that share it. */
  setRay(reach: ArrayLike<number>, ray: number): void {
    this.writeSector(reach, (ray + this.rays - 1) % this.rays);
    this.writeSector(reach, ray);
    this.reachAttr.needsUpdate = true;
  }

  /** Take another surface's whole state (same layout): a wave launched off
   *  a bar's field reuses its drape instead of sampling the floor again. */
  copyFrom(o: SightFieldSurface): void {
    (this.pos.array as Float32Array).set(o.pos.array as Float32Array);
    (this.rAttr.array as Float32Array).set(o.rAttr.array as Float32Array);
    (this.reachAttr.array as Float32Array).set(o.reachAttr.array as Float32Array);
    this.x = o.x;
    this.y = o.y;
    this.z = o.z;
    this.radius = o.radius;
    this.lift = o.lift;
    this.draped = o.draped;
    this.pos.needsUpdate = true;
    this.rAttr.needsUpdate = true;
    this.reachAttr.needsUpdate = true;
  }

  private writeSector(reach: ArrayLike<number>, s: number): void {
    const q = sectorReach(reach, s);
    const per = (this.stations + 1) * SIGHT_COLUMNS_PER_SECTOR;
    (this.reachAttr.array as Float32Array).fill(q, s * per, (s + 1) * per);
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
