// Standing water inside the Sunken Bastion: the flooded moat ring round the
// Drowned Chapel, the ankle-deep flood of the Drowning Yard, and the tide
// pools left on the flats, all dimpled by the rain. Render only.
//
// Readability: every sheet is transparent with depth-write off on the water
// surface order (0, under the whole floor VFX ladder), so each telegraph drawn
// on the floor under it still paints over it (docs/design/vfx-floor-layering.md).

import * as THREE from 'three';
import {
  BAILEY_CHAPEL,
  DROWNING_WINCH,
  DROWNING_YARD,
} from '../../sim/content/sunken_bastion_layout';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { sharedUniforms } from '../gfx';
import { SUNKEN_BASTION_SUN_DIRECTION } from '../interior_light_rig';
import { bastionHash } from './bastion_plan_core';

const WATER_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec3 vWorld;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = wocCamRelView(world.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const WATER_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uTint;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform float uAlpha;
uniform float uSoftEdge;
varying vec3 vWorld;
varying vec2 vUv;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Rain rings: each cell drops a ring on its own beat.
float rings(vec2 p) {
  vec2 cell = floor(p);
  float r = 0.0;
  for (int dx = -1; dx <= 1; dx++) {
    for (int dz = -1; dz <= 1; dz++) {
      vec2 c = cell + vec2(float(dx), float(dz));
      float h = hash(c);
      // Each cycle a new random spot in the cell, and only some cells fire:
      // scattered drops, never a regular grid of rings.
      float beat = uTime * (0.6 + h * 0.5) + h;
      float cyc = floor(beat);
      float t = fract(beat);
      vec2 center = c + vec2(hash(c + 3.1 + cyc), hash(c + 7.7 - cyc));
      float live = step(0.62, hash(c + cyc * 1.37));
      float d = length(p - center);
      float grow = 1.0 - (1.0 - t) * (1.0 - t);
      float ring = smoothstep(0.035, 0.0, abs(d - grow * 0.8)) * (1.0 - t) * (1.0 - t);
      r += ring * live;
    }
  }
  return r;
}
void main() {
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(max(1.0 - max(0.0, view.y), 0.0), 3.0);
  float rain = rings(vWorld.xz * 1.6);
  vec3 n = normalize(vec3(0.0, 1.0, 0.0) + vec3(rain * 0.2, 0.0, rain * 0.15));
  vec3 h = normalize(normalize(uSunDir) + view);
  float glint = pow(max(0.0, dot(n, h)), 90.0) * 0.8;
  vec3 col = mix(uTint, uSky, 0.25 + fres * 0.55) + vec3(1.0, 0.92, 0.78) * glint + rain * 0.08;
  // A soft shoreline where the sheet has one (a pool), none for a clipped sheet.
  float edge = uSoftEdge > 0.5 ? smoothstep(0.5, 0.36, length(vUv - 0.5)) : 1.0;
  gl_FragColor = vec4(col, uAlpha * edge * (0.75 + 0.25 * fres));
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function waterMaterial(alpha: number, softEdge: boolean, tint = 0x243632): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'sunkenBastionStandingWater',
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: sharedUniforms.uTime,
      uTint: { value: new THREE.Color(tint) },
      uSky: { value: new THREE.Color(0x7d8d86) },
      uSunDir: { value: SUNKEN_BASTION_SUN_DIRECTION.clone() },
      uAlpha: { value: alpha },
      uSoftEdge: { value: softEdge ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    fog: true,
  });
}

/** Every standing water sheet of the fortress, instance-local. */
export function buildBastionWater(ground: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sunkenBastionWater';
  // The moat ring round the chapel island: shin-deep over its floor, a hand
  // under the bailey and the island.
  const moat = new THREE.Mesh(
    new THREE.RingGeometry(BAILEY_CHAPEL.island - 0.2, BAILEY_CHAPEL.moat + 0.1, 72, 1).rotateX(
      -Math.PI / 2,
    ),
    waterMaterial(0.82, false),
  );
  moat.position.set(BAILEY_CHAPEL.x, BAILEY_CHAPEL.moatFloor + 0.25, BAILEY_CHAPEL.z);
  moat.renderOrder = 0;
  group.add(moat);
  // The Drowning Yard: ankle-deep over the whole floor (the cage pit keeps its own).
  const yard = new THREE.Mesh(
    new THREE.RingGeometry(DROWNING_WINCH.r + 0.3, DROWNING_YARD.r - 0.1, 72, 1).rotateX(
      -Math.PI / 2,
    ),
    waterMaterial(0.55, false, 0x1f3431),
  );
  yard.position.set(DROWNING_YARD.x, DROWNING_YARD.h + 0.2, DROWNING_YARD.z);
  yard.renderOrder = 0;
  group.add(yard);
  // Tide pools on the flats and puddles in the gaol mud.
  const pools: [number, number, number, number][] = [];
  for (let i = 0; i < 26; i++) {
    const x = -80 + bastionHash(i, 3) * 150;
    const z = -205 + bastionHash(i, 5) * 70;
    pools.push([x, z, 3 + bastionHash(i, 7) * 6, bastionHash(i, 9) * 3]);
  }
  for (let i = 0; i < 10; i++) {
    pools.push([
      -36 + bastionHash(i, 13) * 80,
      60 + bastionHash(i, 17) * 44,
      2 + bastionHash(i, 19) * 3,
      bastionHash(i, 23) * 3,
    ]);
  }
  const poolMaterial = waterMaterial(0.5, true, 0x16211f);
  const poolGeometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  for (const [x, z, r, rot] of pools) {
    const g = ground(x, z);
    // Only on flat mud, and whole: every corner on the same floor.
    const corners = [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ].map(([dx, dz]) => ground(x + dx, z + dz));
    if (corners.some((c) => Math.abs(c - g) > 0.05) || g < -5) continue;
    const pool = new THREE.Mesh(poolGeometry, poolMaterial);
    pool.position.set(x, g + 0.05, z);
    pool.rotation.y = rot;
    pool.scale.set(r, 1, r * 0.65);
    pool.renderOrder = 0;
    group.add(pool);
  }
  return group;
}
