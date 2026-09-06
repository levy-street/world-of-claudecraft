import * as THREE from 'three';

// The one vertex shader the three terrain-draped ground families share (shock
// rings, dissolve decals, buff ground auras).
//
// Each of them starts from a flat shape and pushes every vertex to its own
// sampled ground height. That displacement rides a single-float `aDrape`
// attribute rather than a rewrite of the position buffer (see
// ../draped_bounds_core.ts for why, and ground_auras.ts for the whole shape of
// the change). The families differ only in WHICH local axis is up: the discs
// bake their rotation into the geometry so it is local Y, while the ring quad
// is tilted by the mesh so it is local Z.
//
// That axis is a uniform rather than a difference in the source, so all three
// keep ONE vertex shader between them. Three derives a program's cache key
// from the shader SOURCE, so three near-identical sources would be three
// vertex compiles and three cache entries where one will do.

export const DRAPED_VERTEX_SHADER = `
  attribute float aDrape;
  uniform vec3 uDrapeAxis;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position + uDrapeAxis * aDrape;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

/** Discs that bake their -PI/2 rotation into the geometry: local Y is up. */
export const DRAPE_AXIS_Y = new THREE.Vector3(0, 1, 0);

/** The ring quad, tilted by the mesh instead: its local Z is up. */
export const DRAPE_AXIS_Z = new THREE.Vector3(0, 0, 1);
