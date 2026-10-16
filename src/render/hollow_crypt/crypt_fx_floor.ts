// Shared pieces of the Hollow Crypt trash kit's hero effects
// (crypt_trash_kit_fx.ts and its parts): the polar floor patch (a disc or a
// cone whose vertices drape on the real floor), the camera-facing beam (a
// ribbon between two world points: the soul tether, the crows' streaks, the
// web strand), the billboard glyph, and the shader chunks they share.
//
// Every geometry here is built once per pooled slot by the host and reused;
// the drape helpers write into the slot's own buffers (no allocation).

import * as THREE from 'three';

import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
/** Polar floor patch vertex: `aPolar` carries (normalized radius, angle
 *  fraction); the noise reads the patch's local frame (instance bands sit far
 *  out, past where a float hash stays smooth). */
export const POLAR_VERT = /* glsl */ `
attribute vec2 aPolar;
varying vec2 vPolar;
varying vec3 vLocal;
void main() {
  vPolar = aPolar;
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const NOISE_GLSL = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1 + 7.3) * 0.3 + vnoise(p * 4.3 - 3.1) * 0.15; }
`;

/** A ground shockwave band: a hot leading edge with a soft wake. */
export const SHOCK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vPolar;
varying vec3 vLocal;
${NOISE_GLSL}
void main() {
  float lead = smoothstep(0.76, 0.96, vPolar.x) * (1.0 - smoothstep(0.96, 1.0, vPolar.x));
  float wake = smoothstep(0.3, 0.95, vPolar.x) * 0.32;
  float n = 0.72 + 0.28 * vnoise(vLocal.xz * 1.6);
  gl_FragColor = vec4(uColor * (1.25 + lead), (lead + wake) * n * uAlpha);
}
`;

/**
 * A ribbon between uA and uB facing the camera, `uWidth` yards wide, sagging
 * `uSag` yards at its middle and swaying `uWave`. vUv.x runs across it, vUv.y
 * from A (0) to B (1). Degenerate ends (A on B, or the ribbon pointing at the
 * camera) fall back to a fixed side so no NaN reaches the bloom.
 */
export const BEAM_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
uniform vec3 uA;
uniform vec3 uB;
uniform float uWidth;
uniform float uSag;
uniform float uWave;
uniform float uTime;
varying vec2 vUv;
void main() {
  float t = position.y + 0.5;
  vec3 d = uB - uA;
  float len = length(d);
  vec3 dir = len > 1e-4 ? d / len : vec3(0.0, 1.0, 0.0);
  vec3 p = mix(uA, uB, t);
  p.y -= uSag * 4.0 * t * (1.0 - t);
  vec3 toCam = cameraPosition - p;
  float tl = length(toCam);
  vec3 view = tl > 1e-4 ? toCam / tl : vec3(0.0, 0.0, 1.0);
  vec3 c = cross(dir, view);
  float cl = length(c);
  vec3 side = cl > 1e-4 ? c / cl : vec3(1.0, 0.0, 0.0);
  p += side * sin(t * 9.0 - uTime * 6.0) * uWave * 4.0 * t * (1.0 - t);
  p += side * position.x * uWidth;
  vUv = vec2(position.x + 0.5, t);
  gl_Position = projectionMatrix * wocCamRelView(p);
}
`;

/** A camera-facing quad of the mesh's scale at its position. */
export const GLYPH_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 c = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(modelMatrix[0].xyz);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c.xyz + (camRight * position.x + camUp * position.y) * s;
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

/** A soft round glow (a halo at a body, a muzzle at a staff). */
export const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float k = max(1.0 - r, 0.0);
  float core = k * k * k;
  gl_FragColor = vec4(uColor * (1.0 + 1.5 * core), (core + 0.25 * k) * uAlpha);
}
`;

/** A splinter of bone or a flake of stone: a long jagged sliver with one lit
 *  facet, spun by the particle vertex shader (crypt_fx_particles.ts
 *  PARTICLE_VERT), normal-blended so it reads as a solid shard. */
export const SHARD_FRAG = /* glsl */ `
varying float vT;
varying float vSeed;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float w = 0.13 + 0.14 * fract(vSeed * 7.31);
  float jag = 0.07 * sin(p.y * 37.0 + vSeed * 23.0);
  float d = abs(p.x) / w + abs(p.y) / 0.48;
  float m = 1.0 - smoothstep(0.84 + jag, 0.98 + jag, d);
  float facet = p.x / w;
  float shade = 0.62 + 0.5 * clamp(0.5 - 0.5 * facet, 0.0, 1.0) + 0.25 * step(0.0, p.y) * step(facet, 0.0);
  float fade = 1.0 - smoothstep(0.78, 1.0, vT);
  gl_FragColor = vec4(vColor.rgb * shade, m * fade * vColor.a);
}
`;

/** A polar-grid floor patch (rings x segments) whose vertices get draped. */
export function polarGeometry(rings: number, segments: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = (rings + 1) * (segments + 1);
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage),
  );
  const polar = new Float32Array(n * 2);
  const index: number[] = [];
  for (let r = 0; r <= rings; r++) {
    for (let s = 0; s <= segments; s++) {
      const i = r * (segments + 1) + s;
      polar[i * 2] = r / rings;
      polar[i * 2 + 1] = s / segments;
      if (r < rings && s < segments) {
        const c = i + segments + 1;
        index.push(i, c, i + 1, i + 1, c, c + 1);
      }
    }
  }
  g.setAttribute('aPolar', new THREE.BufferAttribute(polar, 2));
  g.setIndex(index);
  // Draped every lay-out and positioned by the mesh: never culled.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/**
 * Drape a polar patch on the floor about (x, z): a disc of `radius` when
 * `arcDeg` is 360 (the default), else a cone of `radius` reach opening along
 * `facing` (sim convention, 0 = +z). The mesh sits at the floor under (x, z)
 * and every vertex takes the floor under its own spot, `lift` over it.
 */
export function drapePolar(
  mesh: THREE.Mesh,
  groundY: (x: number, z: number) => number,
  x: number,
  z: number,
  radius: number,
  lift: number,
  facing = 0,
  arcDeg = 360,
): void {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const polar = mesh.geometry.getAttribute('aPolar') as THREE.BufferAttribute;
  const y0 = groundY(x, z);
  const disc = arcDeg >= 360;
  const half = (Math.min(360, arcDeg) * Math.PI) / 360;
  for (let i = 0; i < pos.count; i++) {
    const rr = polar.getX(i) * radius;
    const a = disc ? polar.getY(i) * Math.PI * 2 : facing - half + 2 * half * polar.getY(i);
    const wx = x + Math.sin(a) * rr;
    const wz = z + Math.cos(a) * rr;
    pos.setXYZ(i, wx - x, groundY(wx, wz) - y0 + lift, wz - z);
  }
  pos.needsUpdate = true;
  mesh.position.set(x, y0, z);
}

/** A ribbon geometry along +y with `steps` segments (BEAM_VERT bends it). */
export function beamGeometry(steps: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 1, steps);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}
