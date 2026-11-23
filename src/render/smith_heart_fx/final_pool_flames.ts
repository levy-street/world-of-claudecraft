// The burning pools' fire (the Ember Mark's smouldering embers, Mythic's
// Forge Fire, part 2's Cinder Trail), a part of FinalKitFx (the kit keeps each
// pool's floor telegraph at the sim's radius, its danger edge, on every tier).
// The polish pass of 2026-11-23: the pools were a flat molten disc pricked
// with a few stick-like flame sprites; now low tongues of real fire lick up
// all over each pool (the Heat guardian's tongue fragment, heat_lava_wall_glsl
// .ts), leaning and breathing on their own clocks, with embers drifting up
// off them. Two draws for every pool at once (one instanced tongue draw, one
// point draw).
//
// Binding (readability): every tongue's foot stands inside the sim's radius
// (`POOL_FLAMES.reach` of it), so the fire never reads wider than the hit
// area; the floor telegraph stays the edge.
//
// Rules (src/render/CLAUDE.md): built whole in the constructor under the
// kit's root (its one gated attach); fixed pools; no light; the per-pool
// attributes are written into fixed buffers (no allocation a frame).

import * as THREE from 'three';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { POOL_FLAMES, poolFlameHeat, poolFlameHeight } from './final_pool_flames_core';
import { fireRampGlsl } from './heat_flame_core';
import { WALL_EMBER_FRAG, wallTongueFrag } from './heat_lava_wall_glsl';
import { lineFireHash } from './line_fire_wall';

const TONGUE_VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aPool;   // the pool's centre (x, y, z) and the sim's radius
attribute vec2 aFlame;  // its heat (0 hides), its tongues' height
attribute vec3 aTongue; // the bearing (0..1), the share out (0..1), the seed
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
${CAMERA_RELATIVE_GLSL}
void main() {
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  vSeed = aTongue.z;
  float a = aTongue.x * 6.2831853;
  float period = 0.8 + 0.9 * fract(aTongue.z * 7.31);
  float ph = fract(uTime / period + aTongue.z * 3.7);
  float grow = sin(min(ph, 0.75) / 0.75 * 3.14159);
  float lift = smoothstep(0.62, 1.0, ph) * 0.5;
  // Lower toward the pool's edge (a mound of fire, not a hedge).
  float edge = 1.0 - 0.45 * aTongue.y;
  // Uneven: a few tall licks over a carpet of low ones.
  float tall = fract(aTongue.z * 13.7);
  float hgt = aFlame.y * edge * (0.3 + 0.7 * tall * tall) * (0.5 + 0.5 * grow) * aFlame.x;
  vAlpha = aFlame.x * (1.0 - smoothstep(0.62, 0.92, ph)) * smoothstep(0.0, 0.1, ph);
  if (vAlpha <= 0.002 || hgt < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // Its foot no further out than keeps its whole flame inside the sim's
  // radius (poolTongueReach in final_pool_flames_core.ts, at its tallest).
  float hMax = aFlame.y;
  float spread = (0.35 + hMax * 0.75) * 1.2 * 0.5 * 0.8 + hMax * 0.22;
  float reach = max(0.0, min(aPool.w * ${POOL_FLAMES.reach.toFixed(3)}, aPool.w - spread));
  float out_ = sqrt(aTongue.y) * reach;
  vec3 foot = aPool.xyz + vec3(sin(a) * out_, 0.0, cos(a) * out_);
  vec3 base = foot + vec3(0.0, -0.1 + lift * hgt * 0.8, 0.0);
  float v = vUv.y;
  vec3 up = vec3(0.0, hgt, 0.0);
  float s = aTongue.z * 40.0;
  vec3 lean = vec3(sin(uTime * 0.7 + s), 0.0, cos(uTime * 0.6 + s * 1.3)) * hgt * 0.22;
  vec3 spine = base + up * v + lean * v * v;
  vec3 tangent = normalize(up + 2.0 * lean * v);
  vec3 toCam = normalize(cameraPosition - spine);
  vec3 side = cross(tangent, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float sBend = sin(v * 5.2 - uTime * 3.6 + s) * (0.6 + 0.4 * sin(uTime * 1.3 + s * 0.7));
  float flick = sin(uTime * 9.3 + s * 2.1) * 0.5 + sin(uTime * 13.7 + s * 3.3) * 0.3;
  spine += side * (sBend * 0.14 * v + flick * 0.1 * v * v * v) * hgt;
  float width = (0.35 + hgt * 0.75) * (0.8 + 0.4 * fract(aTongue.z * 3.3)) * (1.0 - 0.45 * lift);
  vec3 w = spine + side * position.x * width;
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

const EMBER_VERT = /* glsl */ `
uniform float uTime;
uniform float uPx;
attribute vec4 aPool;
attribute vec2 aFlame;
attribute vec4 aEmber; // the bearing (0..1), the share out, the seed, its speed
varying float vLife;
varying float vSpark;
varying float vAlpha;
${CAMERA_RELATIVE_GLSL}
void main() {
  float life = fract(uTime * aEmber.w + aEmber.z * 11.0);
  vLife = life;
  vSpark = 0.0;
  float a = aEmber.x * 6.2831853;
  float out_ = sqrt(aEmber.y) * ${POOL_FLAMES.reach.toFixed(3)} * aPool.w * 0.8;
  float hgt = life * (2.5 + 4.0 * fract(aEmber.z * 2.3));
  float curl = sin(uTime * 1.3 + aEmber.z * 40.0 + hgt * 0.5) * (0.3 + hgt * 0.12);
  vec3 p = aPool.xyz + vec3(sin(a) * out_ + curl, 0.3 + hgt, cos(a) * out_ - curl * 0.6);
  vAlpha = aFlame.x * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.65, 1.0, life));
  vec4 mv = wocCamRelView(p);
  gl_Position = projectionMatrix * mv;
  float sz = (0.18 + 0.2 * fract(aEmber.z * 5.1)) * (1.0 - 0.5 * life);
  gl_PointSize = vAlpha > 0.002 ? clamp(sz * uPx / max(1.0, -mv.z), 1.0, 24.0) : 0.0;
}
`;

interface Slot {
  id: number;
  seen: boolean;
  /** The heat last written (a steady pool is not re-uploaded). */
  heat: number;
}

export interface PoolFlamesHost {
  root: THREE.Object3D;
  uTime: { value: number };
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  /** Detail tier (the low tier keeps fewer tongues and embers). */
  detail: boolean;
  /** The draw order (over the floor rungs). */
  order: number;
}

export class FinalPoolFlames {
  private readonly slots: Slot[] = [];
  private readonly perTongue: number;
  private readonly perEmber: number;
  private readonly tPool: THREE.InstancedBufferAttribute;
  private readonly tFlame: THREE.InstancedBufferAttribute;
  private readonly ePool: THREE.BufferAttribute;
  private readonly eFlame: THREE.BufferAttribute;
  private readonly tongues: THREE.Mesh;
  private readonly embers: THREE.Points;
  private dirty = false;

  constructor(h: PoolFlamesHost) {
    const L = POOL_FLAMES;
    this.perTongue = h.detail ? L.tongues : L.tonguesLow;
    this.perEmber = h.detail ? L.embers : L.embersLow;
    for (let i = 0; i < L.pools; i++) this.slots.push({ id: -1, seen: false, heat: -1 });
    const quad = new THREE.PlaneGeometry(1, 1, 1, 8);
    const tg = new THREE.InstancedBufferGeometry();
    tg.index = quad.index;
    tg.setAttribute('position', quad.getAttribute('position'));
    const nT = L.pools * this.perTongue;
    const ta = new Float32Array(nT * 3);
    for (let p = 0; p < L.pools; p++)
      for (let k = 0; k < this.perTongue; k++) {
        const i = p * this.perTongue + k;
        // Even bearings round the pool, jittered; feet spread over its disc.
        ta[i * 3] = (k + 0.7 * lineFireHash(i, 601)) / this.perTongue;
        ta[i * 3 + 1] = (k % 3) / 3 + 0.33 * lineFireHash(i, 613);
        ta[i * 3 + 2] = lineFireHash(i, 627);
      }
    tg.setAttribute('aTongue', new THREE.InstancedBufferAttribute(ta, 3));
    this.tPool = new THREE.InstancedBufferAttribute(new Float32Array(nT * 4), 4);
    this.tPool.setUsage(THREE.DynamicDrawUsage);
    this.tFlame = new THREE.InstancedBufferAttribute(new Float32Array(nT * 2), 2);
    this.tFlame.setUsage(THREE.DynamicDrawUsage);
    tg.setAttribute('aPool', this.tPool);
    tg.setAttribute('aFlame', this.tFlame);
    tg.instanceCount = nT;
    h.geometries.push(quad, tg);
    const ramp = fireRampGlsl('fireRamp');
    const tMat = new THREE.ShaderMaterial({
      name: 'smithHeartFinalPoolFlames',
      uniforms: { uTime: h.uTime, uHeat: { value: 0.82 } },
      vertexShader: TONGUE_VERT,
      fragmentShader: wallTongueFrag(ramp),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    h.materials.push(tMat);
    this.tongues = new THREE.Mesh(tg, tMat);
    this.tongues.name = 'smithHeartFinalPoolFlames';
    this.tongues.frustumCulled = false;
    this.tongues.visible = false;
    this.tongues.renderOrder = h.order;
    h.root.add(this.tongues);

    const nE = L.pools * this.perEmber;
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nE * 3), 3));
    const ea = new Float32Array(nE * 4);
    for (let i = 0; i < nE; i++) {
      ea[i * 4] = lineFireHash(i, 701);
      ea[i * 4 + 1] = lineFireHash(i, 709);
      ea[i * 4 + 2] = lineFireHash(i, 719);
      ea[i * 4 + 3] = 0.3 + 0.4 * lineFireHash(i, 727);
    }
    eg.setAttribute('aEmber', new THREE.BufferAttribute(ea, 4));
    this.ePool = new THREE.BufferAttribute(new Float32Array(nE * 4), 4);
    this.ePool.setUsage(THREE.DynamicDrawUsage);
    this.eFlame = new THREE.BufferAttribute(new Float32Array(nE * 2), 2);
    this.eFlame.setUsage(THREE.DynamicDrawUsage);
    eg.setAttribute('aPool', this.ePool);
    eg.setAttribute('aFlame', this.eFlame);
    h.geometries.push(eg);
    const eMat = new THREE.ShaderMaterial({
      name: 'smithHeartFinalPoolEmbers',
      uniforms: { uTime: h.uTime, uPx: { value: 900 } },
      vertexShader: EMBER_VERT,
      fragmentShader: WALL_EMBER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    h.materials.push(eMat);
    this.embers = new THREE.Points(eg, eMat);
    this.embers.name = 'smithHeartFinalPoolEmbers';
    this.embers.frustumCulled = false;
    this.embers.visible = false;
    this.embers.renderOrder = h.order + 1;
    h.root.add(this.embers);
  }

  begin(): void {
    for (const s of this.slots) s.seen = false;
  }

  /** A burning pool this frame: its centre on the floor, the sim's radius,
   *  how long it has burnt. */
  see(id: number, x: number, y: number, z: number, r: number, age: number): void {
    let i = -1;
    for (let k = 0; k < this.slots.length && i < 0; k++) if (this.slots[k].id === id) i = k;
    for (let k = 0; k < this.slots.length && i < 0; k++)
      if (this.slots[k].id === -1 && !this.slots[k].seen) i = k;
    if (i < 0) return;
    const s = this.slots[i];
    const heat = poolFlameHeat(age);
    const fresh = s.id !== id;
    s.id = id;
    s.seen = true;
    // Written when it takes the pool and while its fire catches; a steady
    // pool costs no upload.
    if (fresh || heat !== s.heat) {
      s.heat = heat;
      this.write(i, x, y, z, r, heat, poolFlameHeight(r));
    }
  }

  private write(i: number, x: number, y: number, z: number, r: number, heat: number, h: number) {
    const tp = this.tPool.array as Float32Array;
    const tf = this.tFlame.array as Float32Array;
    for (let k = 0; k < this.perTongue; k++) {
      const q = i * this.perTongue + k;
      tp[q * 4] = x;
      tp[q * 4 + 1] = y;
      tp[q * 4 + 2] = z;
      tp[q * 4 + 3] = r;
      tf[q * 2] = heat;
      tf[q * 2 + 1] = h;
    }
    const ep = this.ePool.array as Float32Array;
    const ef = this.eFlame.array as Float32Array;
    for (let k = 0; k < this.perEmber; k++) {
      const q = i * this.perEmber + k;
      ep[q * 4] = x;
      ep[q * 4 + 1] = y;
      ep[q * 4 + 2] = z;
      ep[q * 4 + 3] = r;
      ef[q * 2] = heat;
      ef[q * 2 + 1] = h;
    }
    this.dirty = true;
  }

  /** Free the pools not seen this frame; upload and show what burns. */
  end(): void {
    let any = false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.seen) {
        any = true;
        continue;
      }
      if (s.id !== -1) {
        s.id = -1;
        s.heat = -1;
        this.write(i, 0, 0, 0, 0, 0, 0);
      }
    }
    if (this.dirty) {
      this.tPool.needsUpdate = true;
      this.tFlame.needsUpdate = true;
      this.ePool.needsUpdate = true;
      this.eFlame.needsUpdate = true;
      this.dirty = false;
    }
    this.tongues.visible = any;
    this.embers.visible = any;
  }

  hide(): void {
    this.begin();
    this.end();
  }
}
