// The Sanctum's air (design section 8): never rain and never a snowstorm,
// only a thin glitter of diamond dust drifting over the walks (tiny ice
// crystals turning in the dusk, each flashing as a face catches the light)
// and spindrift: wind-blown snow peeling off the terrace lips in gusts and
// streaming out east over the crevasses.
//
// One instanced draw per system, the whole life of every particle run in the
// vertex shader on the shared clock from its seed, so the CPU never touches it
// after the build. Cosmetic only: the counts shed with the effects tier
// (density 0.35, 0.6, 1); nothing here hides a telegraph or a body (the dust
// is a few pixels per crystal, the streamers stay off the walking tops).

import * as THREE from 'three';
import { GRAVEWYRM_SANCTUM_FIELD } from '../../sim/content/gravewyrm_sanctum_layout';
import { authoredFieldCliffRuns } from '../../sim/instances/authored_field';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { sharedUniforms } from '../gfx';
import { markSharedMaterial } from '../shared_resource';
import { planDustSpots, sanctumHash } from './sanctum_plan_core';
export interface SanctumAirOptions {
  lowGfx: boolean;
  /** 0..1 cosmetic density (tier shed). */
  density: number;
}

const fogUniforms = (): Record<string, THREE.IUniform> =>
  THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

// ---- diamond dust ------------------------------------------------------------------

/** Crystals per dust spot, and the box each spot's crystals drift through. */
const DUST_PER_SPOT = 18;
const DUST_BOX = 18;
const DUST_HEIGHT = 9;

const DUST_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
uniform float uTime;
attribute vec3 aBase;
attribute vec4 aSeed; // three phases and the crystal's size
varying float vGlint;
varying float vFade;
varying vec2 vQuad;
#include <fog_pars_vertex>
void main() {
  float box = ${DUST_BOX.toFixed(1)};
  vec3 off;
  // A slow drift east on the breeze, a lazy meander across it, a slow fall.
  off.x = mod(aSeed.x * box + uTime * (0.35 + aSeed.y * 0.4), box) - box * 0.5;
  off.z = mod(aSeed.y * box + sin(uTime * 0.11 + aSeed.x * 20.0) * 2.0, box) - box * 0.5;
  off.y = 0.3 + mod(aSeed.z * ${DUST_HEIGHT.toFixed(1)} - uTime * (0.08 + 0.08 * aSeed.x), ${DUST_HEIGHT.toFixed(1)});
  vec4 world = modelMatrix * vec4(aBase + off, 1.0);
  vec4 mvPosition = wocCamRelView(world.xyz);
  // Never vanish to a sub-pixel speck at range (a crystal is a glint, not a size).
  float size = aSeed.w * (1.0 + max(0.0, -mvPosition.z) * 0.012);
  mvPosition.xy += position.xy * size;
  float fx = 1.0 - smoothstep(0.32, 0.5, abs(off.x) / box);
  float fz = 1.0 - smoothstep(0.32, 0.5, abs(off.z) / box);
  float fy = smoothstep(0.3, 1.2, off.y) * (1.0 - smoothstep(${(DUST_HEIGHT - 2).toFixed(1)}, ${DUST_HEIGHT.toFixed(1)}, off.y));
  // Too close to the lens: gone (no fat blobs across the screen).
  float near = smoothstep(1.5, 4.0, -mvPosition.z);
  vFade = fx * fz * fy * near;
  // A face of the crystal catches the light as it tumbles: a short flash.
  float ph = uTime * (1.2 + aSeed.y * 2.6) + aSeed.x * 40.0;
  vGlint = pow(max(0.0, sin(ph)), 28.0);
  vQuad = position.xy;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const DUST_FRAG = /* glsl */ `
precision highp float;
varying float vGlint;
varying float vFade;
varying vec2 vQuad;
#include <fog_pars_fragment>
void main() {
  vec2 q = vQuad * 2.0;
  float r = length(q);
  float dotA = smoothstep(1.0, 0.0, r);
  // The flash is a four-pointed star.
  float star = max(
    smoothstep(0.14, 0.0, abs(q.x)) * smoothstep(1.0, 0.0, abs(q.y)),
    smoothstep(0.14, 0.0, abs(q.y)) * smoothstep(1.0, 0.0, abs(q.x)));
  float a = (dotA * dotA * 0.28 + (dotA + star) * vGlint * 1.7) * vFade;
  gl_FragColor = vec4(vec3(0.72, 0.86, 1.0) * a, 1.0);
  // Additive: fade toward black with distance (a mix toward the fog colour
  // would paint every quad's empty corners).
  #ifdef USE_FOG
  gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  #include <colorspace_fragment>
}
`;

let dustMat: THREE.ShaderMaterial | null = null;

function dustMaterial(): THREE.ShaderMaterial {
  dustMat ??= markSharedMaterial(
    new THREE.ShaderMaterial({
      name: 'sanctumDiamondDust',
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: { ...fogUniforms(), uTime: sharedUniforms.uTime },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    }),
  );
  return dustMat;
}

function buildDust(opts: SanctumAirOptions): THREE.Mesh | null {
  const spots = planDustSpots(Math.round(130 * opts.density), 7);
  if (spots.length === 0) return null;
  const n = spots.length * DUST_PER_SPOT;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const base = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  let i = 0;
  for (const [s, [x, y, z]] of spots.entries()) {
    for (let k = 0; k < DUST_PER_SPOT; k++) {
      base.set([x, y, z], i * 3);
      seed.set(
        [
          sanctumHash(s * 13 + k, 1),
          sanctumHash(s * 13 + k, 2),
          sanctumHash(s * 13 + k, 3),
          0.05 + 0.05 * sanctumHash(s * 13 + k, 4),
        ],
        i * 4,
      );
      i++;
    }
  }
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = n;
  quad.dispose();
  const mesh = new THREE.Mesh(geo, dustMaterial());
  mesh.name = 'sanctumDiamondDust';
  mesh.frustumCulled = false;
  return mesh;
}

// ---- spindrift ---------------------------------------------------------------------

/** One lip spindrift peels off: the lip's point, its height, the way the
 *  snow streams (the wind's east, bent out over the drop). */
export interface SpindriftSpot {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  /** How far below the lip the drop runs (the streamer sinks into it). */
  drop: number;
}

/** The lips the wind strips: every real drop (more than 8 yd) whose open side
 *  faces downwind (east), sampled about every 11 yd along each run. */
export function planSpindriftSpots(max: number): SpindriftSpot[] {
  const out: SpindriftSpot[] = [];
  let k = 0;
  for (const run of authoredFieldCliffRuns(GRAVEWYRM_SANCTUM_FIELD)) {
    if (run.high - run.low < 8 || run.nx < 0.25) continue;
    const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
    const steps = Math.max(1, Math.floor(len / 11));
    for (let s = 0; s < steps; s++) {
      k++;
      if (sanctumHash(k, 71) < 0.3) continue;
      const t = (s + 0.5) / steps;
      const dx = 0.75 + run.nx * 0.5;
      const dz = run.nz * 0.5;
      const l = Math.hypot(dx, dz);
      out.push({
        x: run.ax + (run.bx - run.ax) * t,
        y: run.high,
        z: run.az + (run.bz - run.az) * t,
        dx: dx / l,
        dz: dz / l,
        drop: run.high - run.low,
      });
    }
  }
  // Evenly thinned to the budget (every n-th, never the first n).
  if (out.length <= max) return out;
  const stride = out.length / max;
  return Array.from({ length: max }, (_, i) => out[Math.floor(i * stride)]);
}

const DRIFT_PER_SPOT = 6;

const DRIFT_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
uniform float uTime;
attribute vec3 aBase;
attribute vec4 aDir;  // wind x, wind z, drop, seed
attribute float aPhase;
varying float vAlpha;
varying vec2 vQuad;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  float seed = aDir.w;
  float age = fract(uTime * (0.16 + 0.06 * fract(seed * 7.3)) + aPhase);
  // Gusts: the lip only smokes while the wind leans on it.
  float gust = 0.5 + 0.5 * sin(uTime * 0.23 + aBase.x * 0.031 + aBase.z * 0.047 + seed * 3.0);
  gust = smoothstep(0.35, 0.95, gust);
  float run = 6.0 + 16.0 * fract(seed * 3.1);
  vec3 p = aBase;
  p.xz += aDir.xy * age * run;
  // Lifted off the lip by the gust, then falling away into the drop.
  p.y += 1.0 * sin(age * 3.14159) - min(aDir.z, 18.0) * age * age * 0.55;
  p.xz += vec2(-aDir.y, aDir.x) * sin(age * 5.0 + seed * 9.0) * 0.8;
  vec4 mvPosition = wocCamRelView((modelMatrix * vec4(p, 1.0)).xyz);
  float w = mix(1.1, 6.5, age);
  float h = w * 0.42;
  mvPosition.xy += vec2(position.x * w, position.y * h);
  vAlpha = pow(max(sin(age * 3.14159), 0.0), 1.3) * gust * smoothstep(3.0, 9.0, -mvPosition.z);
  vQuad = position.xy;
  vSeed = seed + floor(uTime * 0.2 + aPhase);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const DRIFT_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying float vAlpha;
varying vec2 vQuad;
varying float vSeed;
#include <fog_pars_fragment>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n21(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 q = vQuad * 2.0;
  float body = smoothstep(1.0, 0.15, length(vec2(q.x * 0.9, q.y * 1.5)));
  // Streaked along the wind: long wisps, never a puff.
  float wisp = n21(vec2(q.x * 2.0 - uTime * 1.6, q.y * 7.0) + vSeed * 13.0) * 0.65
             + n21(vec2(q.x * 4.5 - uTime * 2.4, q.y * 13.0) + vSeed * 5.0) * 0.35;
  float a = body * smoothstep(0.35, 0.85, wisp) * vAlpha * uAlpha;
  gl_FragColor = vec4(vec3(0.8, 0.86, 0.94), a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

let driftMat: THREE.ShaderMaterial | null = null;

function driftMaterial(): THREE.ShaderMaterial {
  driftMat ??= markSharedMaterial(
    new THREE.ShaderMaterial({
      name: 'sanctumSpindrift',
      vertexShader: DRIFT_VERT,
      fragmentShader: DRIFT_FRAG,
      uniforms: { ...fogUniforms(), uTime: sharedUniforms.uTime, uAlpha: { value: 0.42 } },
      transparent: true,
      depthWrite: false,
      fog: true,
    }),
  );
  return driftMat;
}

function buildSpindrift(opts: SanctumAirOptions): THREE.Mesh | null {
  const spots = planSpindriftSpots(Math.round(64 * opts.density));
  if (spots.length === 0) return null;
  const per = opts.lowGfx ? 3 : DRIFT_PER_SPOT;
  const n = spots.length * per;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const base = new Float32Array(n * 3);
  const dir = new Float32Array(n * 4);
  const phase = new Float32Array(n);
  let i = 0;
  for (const [s, spot] of spots.entries()) {
    for (let k = 0; k < per; k++) {
      // Spread a little along the lip so one gust smokes a stretch of it.
      const along = (sanctumHash(s, k + 0.5) - 0.5) * 6;
      base.set([spot.x - spot.dz * along, spot.y + 0.2, spot.z + spot.dx * along], i * 3);
      dir.set([spot.dx, spot.dz, spot.drop, sanctumHash(s * 7 + k, 9)], i * 4);
      phase[i] = k / per + sanctumHash(s, k * 3.3) * 0.1;
      i++;
    }
  }
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
  geo.setAttribute('aDir', new THREE.InstancedBufferAttribute(dir, 4));
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.instanceCount = n;
  quad.dispose();
  const mesh = new THREE.Mesh(geo, driftMaterial());
  mesh.name = 'sanctumSpindrift';
  mesh.frustumCulled = false;
  return mesh;
}

/** The diamond dust and the spindrift (instance-local frame). */
export function buildSanctumAir(opts: SanctumAirOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sanctumAir';
  const dust = buildDust(opts);
  if (dust) group.add(dust);
  const drift = buildSpindrift(opts);
  if (drift) group.add(drift);
  return group;
}
