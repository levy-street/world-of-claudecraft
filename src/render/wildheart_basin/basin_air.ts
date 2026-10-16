// The Wildheart Basin's air and life: the warm humid haze lying thick in the
// gorge between the terraces (it thins against every walkway, so no fight is
// veiled), shafts of afternoon sun slanting down through the canopy, fireflies
// winking in the shade and pollen motes drifting gold in the light near the
// floor, and flocks of birds wheeling over the canopy, lifting from it and
// settling again.
//
// Render only and cosmetic: every system is one draw (instanced or merged),
// all motion on the shared clock, counts shed with the effects tier.

import * as THREE from 'three';
import {
  WILDHEART_BASIN_FIELD,
  WILDHEART_BASIN_VOID_HEIGHT,
} from '../../sim/content/wildheart_basin_layout';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { sharedUniforms } from '../gfx';
import { markSharedTexture } from '../shared_resource';
import {
  BASIN_SUN_DIRECTION,
  basinHash,
  planBirdFlocks,
  planGodRays,
  planMoteSpots,
  planWalkMask,
} from './basin_plan_core';
import { BASIN_NOISE_GLSL } from './basin_sky';
export interface BasinAirOptions {
  lowGfx: boolean;
  density: number;
}

function fogUniforms(): Record<string, THREE.IUniform> {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}

// ---- the gorge haze ------------------------------------------------------------------

let walkMaskTexture: THREE.DataTexture | null = null;

/** The walkable mask over the field (1 on a top), built once per page. */
export function basinWalkMaskTexture(): THREE.DataTexture {
  if (walkMaskTexture) return walkMaskTexture;
  const size = 128;
  const mask = planWalkMask(size, 2);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < mask.length; i++) {
    const v = Math.round(Math.min(1, mask[i]) * 255);
    data.set([v, v, v, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  markSharedTexture(tex);
  walkMaskTexture = tex;
  return tex;
}

const HAZE_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec3 vWorld;
varying vec3 vLocal;
#include <fog_pars_vertex>
void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = wocCamRelView(world.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const HAZE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uLayer;
uniform float uAlpha;
uniform vec3 uColor;
uniform sampler2D uMask;
uniform vec4 uRect;
varying vec3 vWorld;
varying vec3 vLocal;
#include <fog_pars_fragment>
${BASIN_NOISE_GLSL}
void main() {
  vec2 p = vLocal.xz * 0.025 + uLayer * 4.1;
  float t = uTime * (0.01 + uLayer * 0.004);
  float m = bfbm(p + vec2(t, t * 0.5)) * 0.6 + bfbm(p * 2.3 - vec2(t * 1.3, 0.0)) * 0.4;
  vec2 uv = (vLocal.xz - uRect.xy) / uRect.zw;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float walk = texture2D(uMask, clamp(uv, 0.0, 1.0)).r * inside;
  float a = uAlpha * smoothstep(0.3, 0.75, m) * (1.0 - smoothstep(0.15, 0.6, walk));
  float near = smoothstep(10.0, 40.0, length(cameraPosition - vWorld));
  gl_FragColor = vec4(uColor, a * near);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function buildGorgeHaze(opts: BasinAirOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wildheartGorgeHaze';
  const b = WILDHEART_BASIN_FIELD.bounds;
  const rect = new THREE.Vector4(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
  // Warm and thick low in the gorge, thinning as it rises toward the terraces.
  // One layer below the high effects tier, two at it (cosmetic shed).
  const layers = opts.lowGfx || opts.density < 1 ? [6] : [4, 12];
  // Laid out in the interior's own frame (the mask reads local x, z).
  const geo = new THREE.PlaneGeometry(b.maxX - b.minX + 120, b.maxZ - b.minZ + 120)
    .rotateX(-Math.PI / 2)
    .translate((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  layers.forEach((lift, i) => {
    const material = new THREE.ShaderMaterial({
      name: 'wildheartGorgeHaze',
      vertexShader: HAZE_VERT,
      fragmentShader: HAZE_FRAG,
      uniforms: {
        ...fogUniforms(),
        uTime: sharedUniforms.uTime,
        uLayer: { value: i },
        uAlpha: { value: layers.length === 1 ? 0.5 : ([0.5, 0.28][i] ?? 0.3) },
        uColor: { value: new THREE.Color(i === 0 ? 0xc9c7a0 : 0xd6cfa4) },
        uMask: { value: basinWalkMaskTexture() },
        uRect: { value: rect },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
      defines: { BFBM_OCTAVES: 3 },
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = WILDHEART_BASIN_VOID_HEIGHT + lift;
    mesh.name = `wildheartGorgeHaze${i}`;
    mesh.renderOrder = 3 + i;
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  return group;
}

// ---- god rays --------------------------------------------------------------------------

const RAY_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec4 aRay; // across (-1..1), along (0 top .. 1 floor), seed, width
varying vec4 vRay;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vRay = aRay;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = wocCamRelView(world.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const RAY_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec4 vRay;
varying vec3 vWorld;
#include <fog_pars_fragment>
${BASIN_NOISE_GLSL}
void main() {
  float across = vRay.x;
  float along = vRay.y;
  float seed = vRay.z;
  float core = 1.0 - smoothstep(0.2, 1.0, abs(across));
  // Dust turning in the light, and the shaft breathing as leaves sway above.
  float dust = 0.65 + 0.35 * bnoise(vec2(across * 3.0 + seed, along * 6.0 - uTime * 0.15));
  float breathe = 0.6 + 0.4 * sin(uTime * 0.35 + seed * 7.0);
  float ends = smoothstep(0.0, 0.25, along) * (1.0 - smoothstep(0.75, 1.0, along));
  // Fades as the camera walks into it (no full-screen wash).
  float near = smoothstep(6.0, 22.0, length(cameraPosition - vWorld));
  float a = core * dust * breathe * ends * near * uAlpha;
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.55) * a, 1.0);
  // Additive: fade toward black with distance (a fog mix toward the fog
  // colour would paint the whole quad gold where it is transparent).
  #ifdef USE_FOG
  gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
}
`;

function buildGodRays(opts: BasinAirOptions): THREE.Mesh | null {
  const rays = planGodRays();
  if (rays.length === 0) return null;
  const s = BASIN_SUN_DIRECTION;
  const positions: number[] = [];
  const attrs: number[] = [];
  const indices: number[] = [];
  for (const r of rays) {
    // The shaft runs from high up toward the sun down to the floor; two
    // crossed quads so it reads from every side.
    const topX = r.x + s[0] * r.length;
    const topY = r.y + s[1] * r.length;
    const topZ = r.z + s[2] * r.length;
    for (const [px, pz] of [
      [1, 0],
      [0, 1],
    ]) {
      const base = positions.length / 3;
      for (const along of [0, 1]) {
        const cx = along === 0 ? topX : r.x;
        const cy = along === 0 ? topY : r.y;
        const cz = along === 0 ? topZ : r.z;
        const w = r.width * (along === 0 ? 0.7 : 1.3);
        for (const across of [-1, 1]) {
          positions.push(cx + px * w * across, cy, cz + pz * w * across);
          attrs.push(across, along, r.seed, r.width);
        }
      }
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aRay', new THREE.Float32BufferAttribute(attrs, 4));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      name: 'wildheartGodRays',
      vertexShader: RAY_VERT,
      fragmentShader: RAY_FRAG,
      uniforms: {
        ...fogUniforms(),
        uTime: sharedUniforms.uTime,
        uAlpha: { value: opts.lowGfx ? 0.08 : 0.14 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    }),
  );
  mesh.name = 'wildheartGodRays';
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- fireflies and pollen ----------------------------------------------------------------

const MOTE_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec4 aMote; // x, y, z (floor), seed
attribute float aKind; // 0 firefly, 1 pollen
uniform float uTime;
varying float vKind;
varying float vGlow;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vKind = aKind;
  float s = aMote.w;
  vec3 c = aMote.xyz;
  float t = uTime;
  if (aKind < 0.5) {
    // Fireflies: low, wandering loops in the shade, winking on and off.
    c += vec3(sin(t * 0.37 + s * 30.0) * 2.4, 0.8 + 1.4 * fract(s * 7.3) + sin(t * 0.9 + s * 11.0) * 0.4, cos(t * 0.31 + s * 21.0) * 2.4);
    float wink = sin(t * (1.1 + fract(s * 3.1) * 1.4) + s * 50.0);
    vGlow = smoothstep(0.2, 0.9, wink);
  } else {
    // Pollen: drifting slowly up and along on the warm air, catching the sun.
    float life = fract(t * 0.03 + s);
    c += vec3(sin(s * 40.0) * 5.0 + life * 8.0, 0.5 + life * 6.0, cos(s * 33.0) * 5.0 + life * 3.0);
    vGlow = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.7, 1.0, life));
  }
  float size = aKind < 0.5 ? 0.22 : 0.12;
  vec4 mvPosition = wocCamRelView((modelMatrix * vec4(c, 1.0)).xyz);
  mvPosition.xy += position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const MOTE_FRAG = /* glsl */ `
precision highp float;
varying float vKind;
varying float vGlow;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float core = pow(max(0.0, 1.0 - r), 2.0);
  vec3 col = vKind < 0.5 ? vec3(0.85, 1.0, 0.45) * 2.2 : vec3(1.0, 0.9, 0.5) * 1.2;
  float a = core * vGlow * (vKind < 0.5 ? 1.0 : 0.55);
  gl_FragColor = vec4(col * a, 1.0);
  // Additive: fade toward black with distance (a fog mix toward the fog
  // colour would paint the whole quad gold where it is transparent).
  #ifdef USE_FOG
  gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
}
`;

function buildMotes(opts: BasinAirOptions): THREE.Mesh | null {
  const fireflies = Math.round((opts.lowGfx ? 60 : 260) * Math.max(0.3, opts.density));
  const pollen = Math.round((opts.lowGfx ? 60 : 320) * Math.max(0.3, opts.density));
  const spotsF = planMoteSpots(fireflies, 17);
  const spotsP = planMoteSpots(pollen, 41);
  const total = spotsF.length + spotsP.length;
  if (total === 0) return null;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const mote = new Float32Array(total * 4);
  const kind = new Float32Array(total);
  let k = 0;
  for (const [x, y, z] of spotsF) {
    mote.set([x, y, z, basinHash(k, 3)], k * 4);
    kind[k++] = 0;
  }
  for (const [x, y, z] of spotsP) {
    mote.set([x, y, z, basinHash(k, 5)], k * 4);
    kind[k++] = 1;
  }
  geo.setAttribute('aMote', new THREE.InstancedBufferAttribute(mote, 4));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
  geo.instanceCount = total;
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      name: 'wildheartMotes',
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      uniforms: { ...fogUniforms(), uTime: sharedUniforms.uTime },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    }),
  );
  mesh.name = 'wildheartMotes';
  mesh.renderOrder = 11;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- birds --------------------------------------------------------------------------------

const BIRD_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec4 aFlock;  // centre x, z, height, radius
attribute vec4 aBird;   // speed (rad/s), cycle (s), seed, slot
uniform float uTime;
#include <fog_pars_vertex>
void main() {
  float t = uTime;
  float seed = aBird.z;
  float slot = aBird.w;
  // Each flock wheels round its circuit; through each cycle it lifts out of
  // the canopy, climbs and circles wide, then glides back down to settle.
  float cyc = fract(t / aBird.y + seed);
  float lift = smoothstep(0.0, 0.25, cyc) * (1.0 - smoothstep(0.7, 1.0, cyc));
  float ang = t * aBird.x + slot * 0.32 + seed * 6.0;
  float rad = aFlock.w * (0.7 + 0.5 * lift) + sin(slot * 2.3 + seed) * 3.0;
  vec3 c = vec3(aFlock.x + cos(ang) * rad, aFlock.z - 14.0 + lift * 22.0 + sin(slot * 1.7 + t * 0.6) * 1.5, aFlock.y + sin(ang) * rad);
  // Fly along the circle's tangent, banking into the turn.
  vec3 fwd = normalize(vec3(-sin(ang), 0.0, cos(ang)) * sign(aBird.x));
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  float flap = sin(t * (7.0 + fract(seed * 9.1) * 3.0) + slot * 1.3) * (0.4 + 0.6 * lift);
  // position.x: -1..1 along the wing span, position.y: 0..1 chord.
  float span = position.x;
  float wingY = abs(span) * flap * 0.7;
  vec3 local = side * span * 0.9 + fwd * (position.y - 0.4) * (0.55 - abs(span) * 0.3) + vec3(0.0, wingY, 0.0);
  vec4 mvPosition = wocCamRelView((modelMatrix * vec4(c + local * 1.4, 1.0)).xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const BIRD_FRAG = /* glsl */ `
precision highp float;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(0.1, 0.09, 0.08, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function buildBirds(opts: BasinAirOptions): THREE.Mesh | null {
  const flocks = planBirdFlocks();
  const birds: { f: (typeof flocks)[number]; slot: number }[] = [];
  const keep = opts.lowGfx ? 0.5 : Math.max(0.5, opts.density);
  for (const f of flocks) {
    const n = Math.max(3, Math.round(f.count * keep));
    for (let i = 0; i < n; i++) birds.push({ f, slot: i });
  }
  if (birds.length === 0) return null;
  // A bird: a body diamond and two wings in one strip of triangles.
  const base = new THREE.BufferGeometry();
  base.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-1, 0.5, 0, -0.15, 0.1, 0, -0.15, 0.9, 0, 1, 0.5, 0, 0.15, 0.9, 0, 0.15, 0.1, 0],
      3,
    ),
  );
  base.setIndex([0, 1, 2, 3, 4, 5, 1, 5, 2, 2, 5, 4]);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  const flock = new Float32Array(birds.length * 4);
  const bird = new Float32Array(birds.length * 4);
  birds.forEach(({ f, slot }, i) => {
    flock.set([f.x, f.z, f.y, f.radius], i * 4);
    bird.set([f.speed, f.cycle, f.seed, slot], i * 4);
  });
  geo.setAttribute('aFlock', new THREE.InstancedBufferAttribute(flock, 4));
  geo.setAttribute('aBird', new THREE.InstancedBufferAttribute(bird, 4));
  geo.instanceCount = birds.length;
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      name: 'wildheartBirds',
      vertexShader: BIRD_VERT,
      fragmentShader: BIRD_FRAG,
      uniforms: { ...fogUniforms(), uTime: sharedUniforms.uTime },
      side: THREE.DoubleSide,
      fog: true,
    }),
  );
  mesh.name = 'wildheartBirds';
  mesh.frustumCulled = false;
  return mesh;
}

/** The haze, the god rays, the fireflies and pollen, and the birds. */
export function buildBasinAir(opts: BasinAirOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wildheartBasinAir';
  group.add(buildGorgeHaze(opts));
  for (const m of [buildGodRays(opts), buildMotes(opts), buildBirds(opts)]) if (m) group.add(m);
  return group;
}
