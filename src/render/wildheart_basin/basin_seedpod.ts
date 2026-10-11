// The Gorgebloom's seedpods, modelled: a fat ribbed bulb of blood-red flesh
// flecked pale, drawn to a split beak at its top, its veins burning gold-orange
// between the ribs as it nears sprouting and throbbing hard once ripe (the
// sim's own pod states: WILDHEART_SEEDPOD, WILDHEART_SEEDPOD_RIPE). The same
// bulb, smaller, flies as the lobbed seed.
//
// Geometry built once (procedural, deterministic); one program, a material per
// pod slot for its own glow (basin_boss_fx.ts owns the slots, under the gated
// root). Lit by the basin sun in the shader, so the vein glow can climb past
// the flesh without a light.

import * as THREE from 'three';
import { BASIN_SUN_DIRECTION } from './basin_plan_core';

const RIBS = 7;

const POD_VERT = /* glsl */ `
attribute float aRib;
attribute float aV;
varying float vRib;
varying float vV;
varying vec3 vN;
varying vec3 vP;
void main() {
  vRib = aRib;
  vV = aV;
  vN = normalize(mat3(modelMatrix) * normal);
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const POD_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uGlow;
uniform float uRipe;
uniform float uTime;
varying float vRib;
varying float vV;
varying vec3 vN;
varying vec3 vP;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  vec3 n = normalize(vN);
  float lit = 0.38 + 0.62 * max(dot(n, uSun), 0.0);
  // Flesh: deep crimson in the furrows, lighter on the ridges, pale flecks.
  vec3 flesh = mix(vec3(0.16, 0.015, 0.03), vec3(0.46, 0.05, 0.07), smoothstep(-0.4, 0.95, vRib));
  float fleck = step(0.93, h3(floor(vP * 11.0)));
  flesh = mix(flesh, vec3(0.78, 0.62, 0.5), fleck * 0.35 * (1.0 - vV * 0.6));
  vec3 col = flesh * lit;
  // The veins between the ribs and the split beak burn as it ripens.
  float vein = smoothstep(-0.55, -0.95, vRib) * smoothstep(0.05, 0.3, vV) * (1.0 - smoothstep(0.85, 0.98, vV));
  float beak = smoothstep(0.82, 0.98, vV);
  float throb = uRipe > 0.5 ? 0.55 + 0.45 * sin(uTime * 11.0) : 0.8 + 0.2 * sin(uTime * 3.0);
  vec3 glowCol = mix(vec3(1.0, 0.42, 0.12), vec3(1.0, 0.82, 0.3), uRipe);
  col += glowCol * (vein * 1.6 + beak * 1.1) * uGlow * throb;
  // A wet sheen on the bulb.
  float rim = pow(max(1.0 - abs(n.y), 0.0), 3.0) * 0.12;
  col += vec3(1.0, 0.85, 0.75) * rim * lit;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** The bulb: base on y = 0, about 1.1 wide and 1.45 tall at scale 1. */
export function seedpodGeometry(): THREE.BufferGeometry {
  const lon = 28;
  const lat = 16;
  const pos: number[] = [];
  const rib: number[] = [];
  const vv: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= lat; j++) {
    const v = j / lat;
    const th = v * Math.PI;
    // A fat bulb low, drawn to a beak at the top, its base flattened.
    const bulge = Math.sin(th) ** 0.8 * (1 - 0.35 * v * v);
    for (let i = 0; i <= lon; i++) {
      const ph = (i / lon) * Math.PI * 2;
      const r = 0.55 * bulge * (1 + 0.14 * Math.cos(ph * RIBS));
      const y = 1.45 * (0.5 - 0.5 * Math.cos(th)) ** 0.95;
      pos.push(Math.cos(ph) * r, Math.max(0, y - 0.04), Math.sin(ph) * r);
      rib.push(Math.cos(ph * RIBS));
      vv.push(v);
    }
  }
  for (let j = 0; j < lat; j++)
    for (let i = 0; i < lon; i++) {
      const a = j * (lon + 1) + i;
      const b = a + lon + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRib', new THREE.Float32BufferAttribute(rib, 1));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(vv, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A pod's flesh-and-vein material (one per slot: its own glow). */
export function seedpodMaterial(uTime: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'wildheartSeedpod',
    uniforms: {
      uSun: { value: new THREE.Vector3(...BASIN_SUN_DIRECTION).normalize() },
      uGlow: { value: 0.3 },
      uRipe: { value: 0 },
      uTime,
    },
    vertexShader: POD_VERT,
    fragmentShader: POD_FRAG,
  });
}
