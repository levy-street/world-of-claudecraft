// The Wildheart Basin's splash primitives (curves: saurian_fx_core.ts
// crownShape / rippleShape), shared by every body effect of the basin: a CROWN
// (a ring of torn sheet thrown up round an impact, flaring as it climbs, tinted
// per use: ford water, pit sand, seedpod goo, Gorge's acid) and a RIPPLE (rings
// racing out over the floor or the water). Two fixed pools, one program each;
// a slot is re-laid, never rebuilt. Built under the WildheartFx root before its
// gated attach; on the floor ladder's ground band (cosmetic, under every
// telegraph). Lent to the Saurian's and the bosses' effects through
// BasinFxHost.splash.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { BASIN_SUN_DIRECTION } from './basin_plan_core';
import { type CrownSpec, crownShape, type RippleSpec, rippleShape } from './saurian_fx_core';

const CROWN_SLOTS = 28;
const RIPPLE_SLOTS = 26;

const CROWN_VERT = /* glsl */ `
uniform float uRadius;
uniform float uHeight;
uniform float uSeed;
varying float vV;
varying float vShade;
varying float vStreak;
uniform vec3 uSun;
void main() {
  float a = atan(position.z, position.x);
  float v = position.y;
  // A torn rim: the sheet stands taller in ragged tongues round the ring.
  float jag = 0.5 + 0.3 * sin(a * 7.0 + uSeed * 3.1) + 0.2 * sin(a * 19.0 + uSeed * 7.7);
  float h = uHeight * (0.42 + 0.58 * clamp(jag, 0.0, 1.0));
  // It flares outward as it climbs, the classic crown of a heavy splash.
  float r = uRadius * (1.0 + 0.42 * v * v);
  vec3 p = vec3(cos(a) * r, v * h, sin(a) * r);
  vV = v;
  vStreak = a;
  vec3 n = normalize(vec3(cos(a), 0.35, sin(a)));
  vShade = 0.72 + 0.4 * max(dot(n, uSun), 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const CROWN_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uSeed;
uniform vec3 uTint;
varying float vV;
varying float vShade;
varying float vStreak;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  // Vertical streaks of thicker sheet, thinning to spray at the lip.
  float s = vStreak * 9.5493 + uSeed * 5.0;
  float streak = mix(h1(floor(s)), h1(floor(s) + 1.0), smoothstep(0.0, 1.0, fract(s)));
  float body = smoothstep(0.0, 0.08, vV) * (1.0 - smoothstep(0.55 + 0.3 * streak, 1.0, vV));
  float foam = 1.0 - smoothstep(0.0, 0.35, vV);
  vec3 col = mix(vec3(0.74, 0.86, 0.84), vec3(1.0, 0.99, 0.95), foam * 0.7 + streak * 0.3) * vShade * uTint;
  float a = body * (0.32 + 0.48 * streak + 0.3 * foam) * uAlpha;
  gl_FragColor = vec4(col, a);
}
`;

const RIPPLE_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RIPPLE_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uRings;
uniform float uSeed;
uniform vec3 uTint;
varying vec2 vLocal;
void main() {
  float r = length(vLocal);
  float a = atan(vLocal.y, vLocal.x);
  float wob = 0.012 * sin(a * 11.0 + uSeed) + 0.008 * sin(a * 27.0 - uSeed * 2.0);
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    if (fi >= uRings) break;
    float ri = 1.0 - fi * 0.17;
    float w = 0.022 + fi * 0.008;
    float band = 1.0 - smoothstep(0.0, w, abs(r + wob - ri));
    // The crest bright, the trough behind it a faint dark line.
    float trough = 1.0 - smoothstep(0.0, w * 1.6, abs(r + wob - (ri - w * 2.2)));
    sum += band * (1.0 - fi * 0.2) - trough * 0.25;
  }
  float inside = 1.0 - smoothstep(0.96, 1.0, r);
  float a1 = clamp(sum, -0.3, 1.0) * inside * uAlpha;
  vec3 col = a1 >= 0.0 ? vec3(0.95, 1.0, 0.98) * uTint : vec3(0.18, 0.26, 0.22);
  gl_FragColor = vec4(col, abs(a1) * 0.42);
}
`;

interface Slot<S> {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  spec: S;
  born: number;
  alive: boolean;
}

export class BasinSplash {
  private readonly crowns: Slot<CrownSpec>[] = [];
  private readonly ripples: Slot<RippleSpec>[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private clock = 0;
  private seed = 0x51a7;
  private readonly crownOut = { radius: 0, height: 0, alpha: 0 };
  private readonly rippleOut = { radius: 0, alpha: 0 };

  constructor(root: THREE.Object3D) {
    const sun = new THREE.Vector3(...BASIN_SUN_DIRECTION).normalize();
    const crownGeo = new THREE.CylinderGeometry(1, 1, 1, 56, 6, true).translate(0, 0.5, 0);
    this.geometries.push(crownGeo);
    for (let i = 0; i < CROWN_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'wildheartSplashCrown',
        uniforms: {
          uRadius: { value: 1 },
          uHeight: { value: 1 },
          uAlpha: { value: 0 },
          uSeed: { value: i * 3.7 },
          uSun: { value: sun },
          uTint: { value: new THREE.Color(1, 1, 1) },
        },
        vertexShader: CROWN_VERT,
        fragmentShader: CROWN_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(crownGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('ground', 6);
      root.add(mesh);
      this.crowns.push({
        mesh,
        mat,
        spec: { r0: 1, r1: 1, height: 1, life: 1 },
        born: 0,
        alive: false,
      });
    }
    const rippleGeo = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2);
    this.geometries.push(rippleGeo);
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'wildheartSplashRipple',
        uniforms: {
          uAlpha: { value: 0 },
          uRings: { value: 2 },
          uSeed: { value: i * 2.3 },
          uTint: { value: new THREE.Color(1, 1, 1) },
        },
        vertexShader: RIPPLE_VERT,
        fragmentShader: RIPPLE_FRAG,
        transparent: true,
        depthWrite: false,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(rippleGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('ground', 5);
      root.add(mesh);
      this.ripples.push({
        mesh,
        mat,
        spec: { reach: 1, life: 1, rings: 1 },
        born: 0,
        alive: false,
      });
    }
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  /** A crown rising from (x, y, z), tinted (0xffffff: clear water). */
  crown(x: number, y: number, z: number, spec: CrownSpec, tint = 0xffffff): void {
    const slot = this.crowns.find((c) => !c.alive) ?? oldest(this.crowns);
    slot.alive = true;
    slot.spec = spec;
    slot.born = this.clock;
    slot.mat.uniforms.uSeed.value = this.rand() * 40;
    (slot.mat.uniforms.uTint.value as THREE.Color).setHex(tint);
    slot.mesh.position.set(x, y, z);
    slot.mesh.rotation.y = this.rand() * Math.PI * 2;
    slot.mesh.visible = true;
  }

  /** Rings racing out from (x, y, z). */
  ripple(x: number, y: number, z: number, spec: RippleSpec, tint = 0xffffff): void {
    const slot = this.ripples.find((r) => !r.alive) ?? oldest(this.ripples);
    slot.alive = true;
    slot.spec = spec;
    slot.born = this.clock;
    slot.mat.uniforms.uRings.value = spec.rings;
    slot.mat.uniforms.uSeed.value = this.rand() * 40;
    (slot.mat.uniforms.uTint.value as THREE.Color).setHex(tint);
    slot.mesh.position.set(x, y, z);
    slot.mesh.visible = true;
  }

  update(clock: number): void {
    this.clock = clock;
    for (const c of this.crowns) {
      if (!c.alive) continue;
      const sh = crownShape(c.spec, clock - c.born, this.crownOut);
      if (sh.alpha <= 0) {
        c.alive = false;
        c.mesh.visible = false;
        continue;
      }
      c.mat.uniforms.uRadius.value = sh.radius;
      c.mat.uniforms.uHeight.value = Math.max(0.01, sh.height);
      c.mat.uniforms.uAlpha.value = sh.alpha;
    }
    for (const r of this.ripples) {
      if (!r.alive) continue;
      const sh = rippleShape(r.spec, clock - r.born, this.rippleOut);
      if (sh.alpha <= 0) {
        r.alive = false;
        r.mesh.visible = false;
        continue;
      }
      r.mesh.scale.setScalar(Math.max(0.05, sh.radius));
      r.mat.uniforms.uAlpha.value = sh.alpha;
    }
  }

  hideAll(): void {
    for (const c of [...this.crowns, ...this.ripples]) {
      c.alive = false;
      c.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

function oldest<T extends { born: number }>(slots: T[]): T {
  let best = slots[0];
  for (const s of slots) if (s.born < best.born) best = s;
  return best;
}
