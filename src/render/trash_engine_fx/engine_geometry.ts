// Small shared geometry for the trash engine's floor surfaces: a polar disc
// (a centre and rings of vertices out to radius 1) whose vertices can be
// draped onto the real floor once, so a pool or a quench basin hugs a gentle
// slope instead of floating over it. The unit (x, z) of every vertex rides an
// `aUnit` attribute for the surface shaders.

import * as THREE from 'three';

/** How far a floor surface floats over the floor it drapes on (no z-fight). */
export const SURFACE_LIFT = 0.06;

/** A unit polar disc: 1 + rings * segs vertices, `aUnit` = unit (x, z). */
export function polarDisc(rings: number, segs: number): THREE.BufferGeometry {
  const count = 1 + rings * segs;
  const pos = new Float32Array(count * 3);
  const unit = new Float32Array(count * 2);
  for (let r = 0; r < rings; r++) {
    const radius = (r + 1) / rings;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const k = 1 + r * segs + i;
      unit[k * 2] = Math.cos(a) * radius;
      unit[k * 2 + 1] = Math.sin(a) * radius;
      pos[k * 3] = unit[k * 2];
      pos[k * 3 + 2] = unit[k * 2 + 1];
    }
  }
  const index: number[] = [];
  for (let i = 0; i < segs; i++) index.push(0, 1 + ((i + 1) % segs), 1 + i);
  for (let r = 0; r + 1 < rings; r++) {
    const a0 = 1 + r * segs;
    const b0 = 1 + (r + 1) * segs;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      index.push(a0 + i, a0 + j, b0 + i, a0 + j, b0 + j, b0 + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aUnit', new THREE.BufferAttribute(unit, 2));
  g.setIndex(index);
  return g;
}

/**
 * Drape a mesh's own copy of a polar disc on the floor: the mesh stands at
 * (x, y, z) scaled by `radius` in x/z, and each vertex takes the floor height
 * under its own spot (relative to `y`, plus the lift).
 */
export function drapeDisc(
  geo: THREE.BufferGeometry,
  groundY: (x: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  radius: number,
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const unit = geo.getAttribute('aUnit') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const ux = unit.getX(i);
    const uz = unit.getY(i);
    pos.setY(i, groundY(x + ux * radius, z + uz * radius) - y + SURFACE_LIFT);
  }
  pos.needsUpdate = true;
}

/** The shared surface vertex shader: unit disc coords and the world spot. */
export const SURFACE_VERT = /* glsl */ `
attribute vec2 aUnit;
varying vec2 vP;
varying vec3 vWorld;
void main() {
  vP = aUnit;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  // Camera-relative (the CPU's double-precision modelView): instance bands
  // sit far out, where a float32 world point rounds by more than the lift.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** GLSL value noise and fbm the surface shaders share. */
export const NOISE_GLSL = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
  return s;
}
`;
