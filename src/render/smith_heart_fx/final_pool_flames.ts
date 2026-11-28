// The burning pools' fire (the Ember Mark's smouldering embers, Mythic's
// Forge Fire, part 2's Cinder Trail, Magma Rift's lava pools), a part of
// FinalKitFx (the kit keeps each pool's floor telegraph at the sim's radius,
// its danger edge, on every tier).
// The second polish pass of 2026-11-24: the first pass's tongues read as rows
// of regular little cones standing on the disc. Now each pool burns with:
//   - soft flames (soft_flame_glsl.ts): noise cards with no outline, wide and
//     round low, licked into tongues and holes up high, their roots melting
//     into the floor; each on its own height, clock and wandering foot (a
//     flame dies and rekindles a little elsewhere), so the pool reads as one
//     living fire;
//   - the heat glow on the pool's surface under them, breathing;
//   - smoke curling up off it (detail tier);
//   - embers drifting up.
// Five draws for every pool at once (the glow, the smoke, the fire's dark
// body and its flames, one instanced draw each, and the embers' points).
//
// Binding (readability): every flame's foot stands inside the sim's radius
// by its own width and lean (poolTongueReach in final_pool_flames_core.ts),
// the glow stays inside the radius, so the fire never reads wider than the
// hit area; the floor telegraph stays the edge.
//
// Rules (src/render/CLAUDE.md): built whole in the constructor under the
// kit's root (its one gated attach); fixed pools; no light; the per-pool
// attributes are written into fixed buffers (no allocation a frame).

import * as THREE from 'three';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import {
  POOL_FLAME_SHAPE,
  POOL_FLAMES,
  poolFlameHeat,
  poolFlameHeight,
} from './final_pool_flames_core';
import { fireRampGlsl } from './heat_flame_core';
import { WALL_EMBER_FRAG } from './heat_lava_wall_glsl';
import { lineFireHash } from './line_fire_wall';
import {
  SOFT_FIRE_COMMON,
  SOFT_GLOW_FRAG,
  SOFT_SMOKE_FRAG,
  softFlameFrag,
} from './soft_flame_glsl';

const FLAME_VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aPool;   // the pool's centre (x, y, z) and the sim's radius
attribute vec2 aFlame;  // its heat (0 hides), its flames' height
attribute vec3 aTongue; // the bearing (0..1), the share out (0..1), the seed
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
varying float vHeat;
${SOFT_FIRE_COMMON}
${CAMERA_RELATIVE_GLSL}
void main() {
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  float seed = aTongue.z;
  vSeed = seed;
  // Its life: it kindles, burns, gutters; each life a little elsewhere.
  float period = 1.3 + 1.1 * fract(seed * 7.31);
  float ph0 = uTime / period + seed * 3.7;
  float cyc = floor(ph0);
  float ph = ph0 - cyc;
  float life = smoothstep(0.0, 0.2, ph) * (1.0 - smoothstep(0.62, 1.0, ph));
  float bearing = (aTongue.x + 0.22 * (sfHash(cyc + seed * 91.0) - 0.5)) * 6.2831853;
  float share = clamp(aTongue.y + 0.35 * (sfHash(cyc * 1.7 + seed * 53.0) - 0.5), 0.0, 1.0);
  // Uneven: a few tall flames over a bed of low ones, lower toward the rim.
  float tall = fract(seed * 13.7);
  float hMax = aFlame.y * (0.42 + 0.58 * pow(max(tall, 0.0), 1.5)) * (1.0 - 0.3 * share);
  float hgt = hMax * (0.72 + 0.28 * life) * aFlame.x;
  vAlpha = aFlame.x * life;
  vHeat = 0.8 + 0.2 * tall;
  if (vAlpha <= 0.003 || hgt < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float halfW = hMax * ${POOL_FLAME_SHAPE.halfW.toFixed(3)} * (0.8 + 0.2 * fract(seed * 3.3));
  // Its foot planted in by its own width and lean (poolTongueReach).
  float spread = hMax * ${(POOL_FLAME_SHAPE.halfW + POOL_FLAME_SHAPE.lean).toFixed(3)};
  float reach = max(0.0, min(aPool.w * ${POOL_FLAMES.reach.toFixed(3)}, aPool.w - spread));
  float out_ = sqrt(share) * reach;
  vec3 foot = aPool.xyz + vec3(sin(bearing) * out_, 0.02, cos(bearing) * out_);
  float s = seed * 40.0;
  vec2 lean = vec2(sin(uTime * 0.7 + s), cos(uTime * 0.6 + s * 1.3)) * hMax * ${POOL_FLAME_SHAPE.lean.toFixed(3)};
  vec3 w = sfFlameCard(foot, hgt, halfW, lean, vec2(position.x * 2.0, vUv.y));
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

const GLOW_VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aPool;
attribute vec2 aFlame;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
${CAMERA_RELATIVE_GLSL}
void main() {
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  vSeed = fract(aPool.x * 0.37 + aPool.z * 0.11);
  vAlpha = aFlame.x * 0.1;
  if (vAlpha <= 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // Inside the sim's radius.
  float r = aPool.w * 0.94;
  vec3 w = aPool.xyz + vec3(position.x * 2.0 * r, 0.09, -position.y * 2.0 * r);
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

const SMOKE_VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aPool;
attribute vec2 aFlame;
attribute vec3 aTongue; // the bearing, the share out, the seed
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
varying float vHeat;
${SOFT_FIRE_COMMON}
${CAMERA_RELATIVE_GLSL}
void main() {
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  float seed = aTongue.z;
  vSeed = seed;
  float period = 3.2 + 1.6 * fract(seed * 5.9);
  float ph0 = uTime / period + seed * 2.3;
  float cyc = floor(ph0);
  float life = ph0 - cyc;
  float bearing = (aTongue.x + 0.3 * sfHash(cyc + seed * 17.0)) * 6.2831853;
  float out_ = sqrt(aTongue.y) * aPool.w * 0.55;
  float H = aFlame.y;
  float rise = H * (0.55 + 2.4 * life);
  float drift = life * life * 1.6;
  vec3 c = aPool.xyz + vec3(sin(bearing) * out_ + drift * sin(seed * 9.0), rise, cos(bearing) * out_ + drift * cos(seed * 9.0));
  float halfS = H * (0.3 + 0.45 * life);
  vAlpha = aFlame.x * smoothstep(0.0, 0.2, life) * (1.0 - smoothstep(0.45, 1.0, life)) * 0.75;
  vHeat = 1.0 - smoothstep(0.0, 0.5, life);
  if (vAlpha <= 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 w = sfSmokeCard(c, halfS, vec2(position.x * 2.0, position.y * 2.0));
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
  float hgt = life * (2.5 + 4.5 * fract(aEmber.z * 2.3));
  float curl = sin(uTime * 1.3 + aEmber.z * 40.0 + hgt * 0.5) * (0.3 + hgt * 0.12);
  vec3 p = aPool.xyz + vec3(sin(a) * out_ + curl, 0.3 + hgt, cos(a) * out_ - curl * 0.6);
  vAlpha = aFlame.x * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.65, 1.0, life));
  vec4 mv = wocCamRelView(p);
  gl_Position = projectionMatrix * mv;
  float sz = (0.16 + 0.2 * fract(aEmber.z * 5.1)) * (1.0 - 0.5 * life);
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
  /** Detail tier (the low tier keeps fewer flames and embers, no smoke). */
  detail: boolean;
  /** The draw order (over the floor rungs). */
  order: number;
}

/** One instanced layer's per-pool attributes: the pool (centre, radius) and
 *  its fire (heat, height), `per` instances a pool. */
interface Layer {
  per: number;
  pool: THREE.BufferAttribute;
  flame: THREE.BufferAttribute;
  obj: THREE.Object3D;
}

export class FinalPoolFlames {
  private readonly slots: Slot[] = [];
  private readonly layers: Layer[] = [];
  private dirty = false;

  constructor(h: PoolFlamesHost) {
    const L = POOL_FLAMES;
    for (let i = 0; i < L.pools; i++) this.slots.push({ id: -1, seen: false, heat: -1 });
    const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    h.geometries.push(quad);
    const ramp = fireRampGlsl('fireRamp');

    /** An instanced card layer: `per` cards a pool, its own attributes. */
    const cards = (
      name: string,
      per: number,
      vertexShader: string,
      fragmentShader: string,
      blending: THREE.Blending,
      order: number,
      salt: number,
      defines: Record<string, string> = {},
    ): void => {
      if (per <= 0) return;
      const g = new THREE.InstancedBufferGeometry();
      g.index = quad.index;
      g.setAttribute('position', quad.getAttribute('position'));
      const n = L.pools * per;
      const ta = new Float32Array(n * 3);
      for (let p = 0; p < L.pools; p++)
        for (let k = 0; k < per; k++) {
          const i = p * per + k;
          // Even bearings round the pool, jittered; feet spread over its disc.
          ta[i * 3] = (k + 0.7 * lineFireHash(i, salt)) / per;
          ta[i * 3 + 1] = (k * 0.618034 + 0.25 * lineFireHash(i, salt + 12)) % 1;
          ta[i * 3 + 2] = lineFireHash(i, salt + 26);
        }
      g.setAttribute('aTongue', new THREE.InstancedBufferAttribute(ta, 3));
      const pool = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      pool.setUsage(THREE.DynamicDrawUsage);
      const flame = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
      flame.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aPool', pool);
      g.setAttribute('aFlame', flame);
      g.instanceCount = n;
      h.geometries.push(g);
      const mat = new THREE.ShaderMaterial({
        name,
        uniforms: { uTime: h.uTime, uHeat: { value: 0.86 } },
        defines,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending,
        toneMapped: false,
        fog: false,
      });
      h.materials.push(mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = h.order + order;
      h.root.add(mesh);
      this.layers.push({ per, pool, flame, obj: mesh });
    };
    // The glow on the pool first, the smoke behind the fire, the fire, then
    // the embers over it.
    cards('smithHeartFinalPoolGlow', 1, GLOW_VERT, SOFT_GLOW_FRAG, THREE.AdditiveBlending, 0, 801);
    cards(
      'smithHeartFinalPoolSmoke',
      h.detail ? L.smokes : L.smokesLow,
      SMOKE_VERT,
      SOFT_SMOKE_FRAG,
      THREE.NormalBlending,
      1,
      851,
    );
    cards(
      'smithHeartFinalPoolFlameBody',
      h.detail ? L.tongues : L.tonguesLow,
      FLAME_VERT,
      softFlameFrag(ramp),
      THREE.NormalBlending,
      2,
      601,
      { SOFT_DARK: '' },
    );
    cards(
      'smithHeartFinalPoolFlames',
      h.detail ? L.tongues : L.tonguesLow,
      FLAME_VERT,
      softFlameFrag(ramp),
      THREE.AdditiveBlending,
      3,
      601,
    );

    const perEmber = h.detail ? L.embers : L.embersLow;
    const nE = L.pools * perEmber;
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
    const ePool = new THREE.BufferAttribute(new Float32Array(nE * 4), 4);
    ePool.setUsage(THREE.DynamicDrawUsage);
    const eFlame = new THREE.BufferAttribute(new Float32Array(nE * 2), 2);
    eFlame.setUsage(THREE.DynamicDrawUsage);
    eg.setAttribute('aPool', ePool);
    eg.setAttribute('aFlame', eFlame);
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
    const embers = new THREE.Points(eg, eMat);
    embers.name = 'smithHeartFinalPoolEmbers';
    embers.frustumCulled = false;
    embers.visible = false;
    embers.renderOrder = h.order + 4;
    h.root.add(embers);
    this.layers.push({ per: perEmber, pool: ePool, flame: eFlame, obj: embers });
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
    for (const l of this.layers) {
      const tp = l.pool.array as Float32Array;
      const tf = l.flame.array as Float32Array;
      for (let k = 0; k < l.per; k++) {
        const q = i * l.per + k;
        tp[q * 4] = x;
        tp[q * 4 + 1] = y;
        tp[q * 4 + 2] = z;
        tp[q * 4 + 3] = r;
        tf[q * 2] = heat;
        tf[q * 2 + 1] = h;
      }
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
      for (const l of this.layers) {
        l.pool.needsUpdate = true;
        l.flame.needsUpdate = true;
      }
      this.dirty = false;
    }
    for (const l of this.layers) l.obj.visible = any;
  }

  hide(): void {
    this.begin();
    this.end();
  }
}
