// The Guardian of the Heat's living fire (plan: heat_flame_core.ts), a part of
// HeatBody: the tongues of flame standing on its burning sockets, each a
// ribbon turned to the camera round its own bent spine (so no card edge ever
// shows), its root on the bone, its tip licking up and trailing behind the
// bone's motion. Two draws over the same tongues: a smoke-dark under-layer
// (normal blend, a little wider and set back) that gives the fire depth
// against the boss's rock and the bright room, then the fire itself (additive,
// scrolling domain-warped noise eroding the tongue from its tips, the ramp
// red at the edges, orange through the body, yellow only at the core, capped
// under white so stacked tongues never bloom the frame out).
//
// Cosmetic (src/render/CLAUDE.md): the low tier keeps a few tongues per
// socket (HEAT_TONGUE_LOW); nothing here is information a player acts on.
// Both materials are built with the owner's root before its gated attach;
// fixed buffers written in place each frame (one small upload), no light.

import * as THREE from 'three';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { HEAT_FX_GROW, HEAT_SOCKETS, heatSocketIndex } from './heat_body_core';
import {
  fireRampGlsl,
  HEAT_TONGUE_LOW,
  HEAT_TONGUES,
  TONGUE_SPLAY,
  tongueFlicker,
  tongueLean,
} from './heat_flame_core';

const TONGUE_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
uniform float uTime;
uniform float uWiden;
uniform float uBack;
attribute vec3 aBase;
attribute vec3 aAxis;
attribute vec4 aShape; // width, seed, heat, alpha
varying vec2 vUv;
varying float vSeed;
varying float vHeat;
varying float vAlpha;
void main() {
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  vSeed = aShape.y;
  vHeat = aShape.z;
  vAlpha = aShape.w;
  float hgt = length(aAxis);
  if (aShape.w <= 0.002 || hgt < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float v = vUv.y;
  vec3 up = vec3(0.0, hgt, 0.0);
  // The spine rises straight off the root and bends to the lean at the tip.
  vec3 spine = aBase + up * v + (aAxis - up) * (v * v);
  vec3 tangent = normalize(up + 2.0 * (aAxis - up) * v);
  vec3 toCam = normalize(cameraPosition - spine);
  vec3 side = cross(tangent, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float s = aShape.y * 40.0;
  // An S-bend travelling up the tongue (the body sways one way, the tip
  // whips back), and a flick of the tip on its own faster clock: roaring
  // fire, never a straight spike.
  float sBend = sin(v * 5.2 - uTime * 3.6 + s) * (0.6 + 0.4 * sin(uTime * 1.3 + s * 0.7));
  float flick = sin(uTime * 9.3 + s * 2.1) * 0.5 + sin(uTime * 13.7 + s * 3.3) * 0.3;
  spine += side * (sBend * 0.16 * v + flick * 0.12 * v * v * v) * hgt;
  // The curl reaches into depth too, so the tongue never reads flat.
  spine += toCam * sin(v * 4.1 - uTime * 2.7 + s * 1.9) * 0.08 * hgt * v;
  spine -= toCam * uBack;
  vec3 w = spine + side * position.x * aShape.x * uWiden;
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

const TONGUE_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vHeat;
varying float vAlpha;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.03 + 1.7) * 0.3 + vnoise(p * 4.01 + 3.1) * 0.15;
}
${fireRampGlsl('fireRamp')}
void main() {
  vec2 uv = vUv;
  float s = vSeed * 17.0;
  float t = uTime * (0.9 + 0.25 * vSeed);
  // The flow: noise rising faster than the tongue, warped by a slower field.
  vec2 q = vec2(uv.x * 2.1 + s, uv.y * 1.7 - t * 1.8);
#ifdef HEAT_TONGUE_DARK
  // The dark body only needs its shape: one octave of the flow, no warp.
  vec2 warp = vec2(vnoise(q * 0.8) - 0.5, 0.0);
  float n = vnoise(q * 1.9 + vec2(0.0, -t * 1.1));
#else
  vec2 warp = vec2(fbm(q * 0.8 + vec2(0.0, -t * 0.5)), fbm(q * 0.8 + vec2(5.2, 1.3 - t * 0.5))) - 0.5;
  float n = fbm(q * 1.9 + warp * 1.7 + vec2(0.0, -t * 1.1));
#endif
  // The tongue: a round root drawn to ragged licks, swaying more up high.
  float x = (uv.x - 0.5) * 2.0 + warp.x * 1.1 * uv.y;
  float halfW = mix(0.8, 0.05, pow(uv.y, 0.8));
  float shape = 1.0 - smoothstep(halfW * 0.2, halfW, abs(x));
  float root = smoothstep(0.0, 0.16, uv.y);
  float I = shape * root * (0.45 + 0.8 * n) - uv.y * 0.38;
  // Eroded at the tips: the fire breaks into licks and gaps as it climbs.
  I -= smoothstep(0.45, 1.0, uv.y) * (1.0 - n) * 0.55;
  I = clamp(I * 1.35, 0.0, 1.0);
#ifdef HEAT_TONGUE_DARK
  // The smoke-dark body round the fire (a soft rim, thickest up the tongue).
  float a = smoothstep(0.0, 0.25, I) * (0.6 + 0.4 * uv.y);
  gl_FragColor = vec4(0.06, 0.016, 0.006, a * vAlpha * 0.5);
#else
  // Hottest low in the tongue, cooling to red as it climbs and frays.
  float h = I * vHeat * (1.0 - 0.32 * uv.y);
  vec3 col = fireRamp(h);
  float a = smoothstep(0.04, 0.24, I) * vAlpha;
  gl_FragColor = vec4(col * 0.95, a);
#endif
}
`;

const _lean = { x: 0, z: 0, stretch: 1 };

export class HeatFlameTongues {
  private readonly count = HEAT_TONGUES.length;
  private readonly base: THREE.InstancedBufferAttribute;
  private readonly axis: THREE.InstancedBufferAttribute;
  private readonly shape: THREE.InstancedBufferAttribute;
  private readonly fire: THREE.Mesh;
  private readonly dark: THREE.Mesh;
  private readonly socketOf: number[];
  /** The low tier sheds the smoke-dark under-layer (cosmetic depth only). */
  private readonly lowTier: boolean;
  private readonly kept: boolean[];
  /** Each socket's smoothed velocity (yards a second) and last place. */
  private readonly vel: THREE.Vector3[] = HEAT_SOCKETS.map(() => new THREE.Vector3());
  private readonly prev: THREE.Vector3[] = HEAT_SOCKETS.map(() => new THREE.Vector3());
  private primed = false;
  /** Each tongue's eased visibility (a socket under the lava goes out). */
  private readonly lit: Float32Array;
  /** Each tongue's outward lean (its share of the height, the body's frame). */
  private readonly splayX: Float32Array;
  private readonly splayZ: Float32Array;

  constructor(
    root: THREE.Object3D,
    uTime: { value: number },
    lowTier: boolean,
    materials: THREE.Material[],
    geometries: THREE.BufferGeometry[],
  ) {
    const quad = new THREE.PlaneGeometry(1, 1, 1, 10);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const n = this.count;
    const attr = (size: number) =>
      new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(
        THREE.DynamicDrawUsage,
      );
    this.base = attr(3);
    this.axis = attr(3);
    this.shape = attr(4);
    geo.setAttribute('aBase', this.base);
    geo.setAttribute('aAxis', this.axis);
    geo.setAttribute('aShape', this.shape);
    geo.instanceCount = n;
    geometries.push(geo, quad);
    const mat = (dark: boolean) =>
      new THREE.ShaderMaterial({
        name: dark ? 'smithHeartHeatTongueSmoke' : 'smithHeartHeatTongue',
        uniforms: {
          uTime,
          uWiden: { value: dark ? 1.35 : 1 },
          uBack: { value: dark ? 0.6 : 0 },
        },
        defines: dark ? { HEAT_TONGUE_DARK: 1 } : {},
        vertexShader: TONGUE_VERT,
        fragmentShader: TONGUE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: dark ? THREE.NormalBlending : THREE.AdditiveBlending,
        fog: false,
      });
    const darkMat = mat(true);
    const fireMat = mat(false);
    materials.push(darkMat, fireMat);
    this.dark = new THREE.Mesh(geo, darkMat);
    this.fire = new THREE.Mesh(geo, fireMat);
    this.dark.name = 'smithHeartHeatTongueSmoke';
    this.fire.name = 'smithHeartHeatTongues';
    // The smoke-dark layer under the fire: no renderOrder of its own (these
    // stand in the air, off the floor ladder); both meshes share one origin,
    // so three's transparent sort keeps them in build order, dark first.
    for (const m of [this.dark, this.fire]) {
      m.frustumCulled = false;
      m.visible = false;
      root.add(m);
    }
    this.lowTier = lowTier;
    this.socketOf = HEAT_TONGUES.map((t) => heatSocketIndex(t.socket));
    this.kept = HEAT_TONGUES.map((_, i) => !lowTier || HEAT_TONGUE_LOW[i]);
    this.lit = new Float32Array(n);
    // Each tongue leans out along its own offset from the socket.
    this.splayX = new Float32Array(n);
    this.splayZ = new Float32Array(n);
    HEAT_TONGUES.forEach((t, i) => {
      const m = Math.hypot(t.off[0], t.off[2]) || 1;
      const k = TONGUE_SPLAY * (0.6 + 0.8 * t.seed);
      this.splayX[i] = (t.off[0] / m) * k;
      this.splayZ[i] = (t.off[2] / m) * k;
    });
  }

  /** Stand the tongues on the sockets this frame. `strength` the fire's
   *  (0 out, 1 full), `heat` its core's push up the ramp, `boost` each
   *  socket's size (1 at rest; Basalt Fist's gathering fist more). */
  update(
    sock: readonly THREE.Vector3[],
    yaw: number,
    lavaY: number,
    clock: number,
    dt: number,
    strength: number,
    heat: number,
    boost: ArrayLike<number>,
  ): void {
    const on = strength > 0.01;
    this.fire.visible = on;
    this.dark.visible = on && !this.lowTier;
    if (!on) {
      this.primed = false;
      return;
    }
    // Each socket's velocity, eased (a snapped view or a teleport resets it).
    const ease = Math.min(1, dt * 7);
    for (let s = 0; s < sock.length; s++) {
      const p = sock[s];
      const v = this.vel[s];
      if (!this.primed || dt <= 0) v.set(0, 0, 0);
      else {
        const vx = (p.x - this.prev[s].x) / dt;
        const vy = (p.y - this.prev[s].y) / dt;
        const vz = (p.z - this.prev[s].z) / dt;
        if (vx * vx + vy * vy + vz * vz > 80 * 80) v.set(0, 0, 0);
        else v.set(v.x + (vx - v.x) * ease, v.y + (vy - v.y) * ease, v.z + (vz - v.z) * ease);
      }
      this.prev[s].copy(p);
    }
    this.primed = true;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const b = this.base.array as Float32Array;
    const a = this.axis.array as Float32Array;
    const sh = this.shape.array as Float32Array;
    const fade = Math.min(1, dt * 6);
    for (let i = 0; i < this.count; i++) {
      const t = HEAT_TONGUES[i];
      const s = this.socketOf[i];
      const p = sock[s];
      // The recipe is in yards on the body it was tuned at; it grows with it.
      const x = t.off[0] * HEAT_FX_GROW;
      const z = t.off[2] * HEAT_FX_GROW;
      const bx = p.x + x * cosY + z * sinY;
      const by = p.y + t.off[1] * HEAT_FX_GROW;
      const bz = p.z - x * sinY + z * cosY;
      // Out under the lava (a socket sunk past the surface goes dark).
      const want = this.kept[i] ? Math.max(0, Math.min(1, (by - lavaY) / 1.2)) : 0;
      this.lit[i] += (want - this.lit[i]) * fade;
      const v = this.vel[s];
      tongueLean(v.x, v.y, v.z, _lean);
      const k = boost[s] ?? 1;
      const h =
        HEAT_FX_GROW *
        t.h *
        tongueFlicker(clock, t.seed) *
        _lean.stretch *
        k *
        (0.55 + 0.45 * strength);
      b[i * 3] = bx;
      b[i * 3 + 1] = by;
      b[i * 3 + 2] = bz;
      // The lick behind the motion, plus a splay out from the socket so the
      // tongues fan like the concept's sheets of fire, never a row of candles.
      const ox = this.splayX[i] * cosY + this.splayZ[i] * sinY;
      const oz = -this.splayX[i] * sinY + this.splayZ[i] * cosY;
      a[i * 3] = (_lean.x + ox) * h;
      a[i * 3 + 1] = h;
      a[i * 3 + 2] = (_lean.z + oz) * h;
      sh[i * 4] =
        HEAT_FX_GROW *
        t.w *
        (0.7 + 0.3 * k) *
        (0.92 + 0.16 * tongueFlicker(clock * 1.3, t.seed + 0.5));
      sh[i * 4 + 1] = t.seed;
      sh[i * 4 + 2] = Math.min(1, t.heat * heat);
      sh[i * 4 + 3] = this.lit[i] * strength;
    }
    this.base.needsUpdate = true;
    this.axis.needsUpdate = true;
    this.shape.needsUpdate = true;
  }

  hide(): void {
    this.fire.visible = false;
    this.dark.visible = false;
    this.primed = false;
    this.lit.fill(0);
  }
}
