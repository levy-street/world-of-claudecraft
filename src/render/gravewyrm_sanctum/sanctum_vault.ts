// The Ritual Vault's meltwater: the three round pools (THAW_POOLS, 7 yd) the
// thaw pyres stand in, melted down into the vault's cold lake-ice floor. Two
// floors that cannot be confused (design 6.2): the pale ice is matte and
// bright; the pools are near-black blue-green water, steaming, stirred by slow
// ripples and rising bubbles, the soulfire above them reflected as a sick
// green shimmer, and ringed by a crisp violet-green band where the soulfire's
// light meets the slush at the water's edge. Phase B's death-site rule reads
// exactly that edge ("in the meltwater or on cold ice"), so the band sits on
// the pool's radius and is drawn sharp, never feathered out into the ice.
//
// ONE mesh per pool on one shared material, all motion shader-side on the
// shared clock. The pools are floor marks: they sit a hair over the field's
// top on the floor ladder's `ground` rung, so every telegraph paints over them.
// The water's steam is sanctum_steam.ts's; the pyres' light sanctum_lights.ts's.

import * as THREE from 'three';
import { RITUAL_VAULT, THAW_POOLS } from '../../sim/content/gravewyrm_sanctum_layout';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import { sanctumGround } from './sanctum_plan_core';
/** How far the water's top stands over the vault floor (yards). */
export const VAULT_POOL_LIFT = 0.05;

const VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec2 vLocal;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  // The disc is a unit circle scaled to the pool: its own xz is the 0..1
  // radius the band keys on.
  vLocal = position.xz;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = wocCamRelView(world.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vLocal;
varying vec3 vWorld;
uniform float uTime;
uniform float uSeed;
uniform float uDetail;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float waves(vec2 p, float t) {
  return noise(p * 1.6 + vec2(t * 0.21, -t * 0.13)) * 0.6 + noise(p * 3.9 - vec2(t * 0.17, t * 0.29)) * 0.4;
}
// One bubble's ring spreading from where it surfaced, on its own clock.
float bubble(vec2 p, float k) {
  float period = 2.6 + 2.2 * hash(vec2(k, uSeed));
  float t = uTime / period + hash(vec2(uSeed, k));
  float cycle = floor(t);
  float age = fract(t);
  vec2 c = (vec2(hash(vec2(cycle, k)), hash(vec2(k, cycle + 3.1))) - 0.5) * 1.3;
  float r = length(p - c);
  float ring = smoothstep(0.012, 0.0, abs(r - age * 0.16)) * (1.0 - age);
  float pop = smoothstep(0.03, 0.0, r) * smoothstep(0.25, 0.0, age);
  return ring * 0.8 + pop;
}
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float t = uTime;
  vec2 p = vLocal * 6.0 + uSeed * 3.0;
  // A slope from the ripples: its tilt shades the water and breaks up the
  // reflections (a cheap normal from two height samples).
  float h0 = waves(p, t);
  float hx = waves(p + vec2(0.15, 0.0), t);
  float hz = waves(p + vec2(0.0, 0.15), t);
  vec3 n = normalize(vec3((h0 - hx) * 2.2, 1.0, (h0 - hz) * 2.2));
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(max(1.0 - max(0.0, dot(n, view)), 0.0), 4.0);
  // Near-black blue-green water, deepest in the middle (meltwater over a
  // melted-out bowl), a little bluer toward the slush at the edge.
  vec3 deep = vec3(0.004, 0.016, 0.02);
  vec3 shallow = vec3(0.012, 0.045, 0.055);
  vec3 col = mix(deep, shallow, smoothstep(0.35, 0.95, r));
  // The dusk sky in the water at a glancing view: matte, kept low.
  col += vec3(0.07, 0.11, 0.2) * fres * 0.7;
  // The soulfire overhead, broken by the ripples into a sick green shimmer
  // that gathers toward the pyre's stack in the middle.
  float flick = 0.75 + 0.25 * sin(t * 7.0 + uSeed * 9.0) * sin(t * 3.1);
  float glow = exp(-r * r * 3.2) * (0.5 + 0.5 * smoothstep(0.45, 0.75, h0));
  col += vec3(0.08, 0.32, 0.15) * glow * flick * 0.55;
  // Steam-dulled sheen streaks drifting over the surface.
  float streak = smoothstep(0.62, 0.8, noise(vec2(vLocal.x * 2.0 + t * 0.05, vLocal.y * 9.0)));
  col += vec3(0.05, 0.08, 0.09) * streak * 0.5;
  // Bubbles surfacing (the high tiers stir more of them).
  float b = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= uDetail) break;
    b += bubble(vLocal, float(i));
  }
  col += vec3(0.16, 0.42, 0.26) * b * 0.45;
  // The edge: a crisp violet-green band where the soulfire's light meets the
  // slush, a thin bright inner line and a violet halo just inside it, so
  // "in the water" ends exactly at the pool's radius.
  float band = smoothstep(0.86, 0.95, r);
  float line = smoothstep(0.945, 0.975, r) * (1.0 - smoothstep(0.985, 1.0, r));
  float wobble = 0.85 + 0.15 * noise(vec2(atan(vLocal.y, vLocal.x) * 6.0, t * 0.6));
  col = mix(col, vec3(0.13, 0.06, 0.26), band * 0.65);
  col += vec3(0.25, 0.85, 0.48) * line * wobble * 0.9;
  // A dark wet lip at the very edge so the band never melts into the ice.
  col *= 1.0 - smoothstep(0.988, 1.0, r) * 0.5;
  gl_FragColor = vec4(col, 0.97);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

let material: THREE.ShaderMaterial | null = null;
let geometry: THREE.BufferGeometry | null = null;

function poolMaterial(lowGfx: boolean): THREE.ShaderMaterial {
  if (!material) {
    material = new THREE.ShaderMaterial({
      name: 'gravewyrmSanctumMeltwater',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: sharedUniforms.uTime,
        uSeed: { value: 0 },
        uDetail: { value: lowGfx ? 2 : 5 },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    markSharedMaterial(material);
  }
  return material;
}

/** The three meltwater pools of the Ritual Vault (instance-local frame). */
export function buildSanctumVault(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gravewyrmSanctumVault';
  geometry ??= markSharedGeometry(new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2));
  const base = poolMaterial(lowGfx);
  THAW_POOLS.forEach((pool, i) => {
    // Each pool its own seed (a uniform per pool: one program, three values).
    const m = base.clone();
    m.uniforms.uTime = sharedUniforms.uTime;
    m.uniforms.uSeed = { value: i * 1.7 + 0.3 };
    m.uniforms.uDetail = { value: lowGfx ? 2 : 5 };
    const mesh = new THREE.Mesh(geometry ?? undefined, m);
    mesh.name = `gravewyrmSanctumPool:${pool.id}`;
    mesh.position.set(pool.x, sanctumGround(pool.x, pool.z) + VAULT_POOL_LIFT, pool.z);
    mesh.scale.setScalar(pool.r);
    // The water on the floor's own rung (the fire stains over it, every
    // telegraph over both).
    mesh.renderOrder = floorVfxRenderOrder('ground', 1);
    mesh.receiveShadow = false;
    group.add(mesh);
  });
  return group;
}

/** The vault's floor height (the pools' level under their lift). */
export function vaultFloorHeight(): number {
  return sanctumGround(RITUAL_VAULT.x, RITUAL_VAULT.z);
}
