// The Sunken Bastion's sky and sea: a storm-tide dusk dome (a low pale sun
// sinking behind torn fog cloud, lightning walking the far horizon over the
// fen, rain curtains hanging under the storm), the fen-sea itself (a rolling
// storm swell that foams white against every cliff foot and along the flats),
// the fog lying on the water (the storm rain is bastion_rain.ts), gulls wheeling
// over the headland, and the sea stacks and far coast that close the vista.
//
// All motion is shader-side on the shared clock (sharedUniforms.uTime): no
// per-frame JavaScript. Counts shed with the graphics tier; every element is
// cosmetic (no telegraph, no actionable information).

import * as THREE from 'three';
import {
  SUNKEN_BASTION_FIELD,
  SUNKEN_BASTION_SEA_LEVEL,
} from '../../sim/content/sunken_bastion_layout';
import { rockDetail } from '../authored_field/field_textures';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { SUNKEN_BASTION_FOG_COLOR } from '../fog_scene_state';
import { sharedUniforms } from '../gfx';
import { SUNKEN_BASTION_SUN_DIRECTION } from '../interior_light_rig';
import {
  bastionHash,
  planFogBanks,
  planSeaStacks,
  planShoreMask,
  SHORE_MASK_BOUNDS,
} from './bastion_plan_core';
export interface BastionAtmosphereOptions {
  lowGfx: boolean;
  /** 0..1 cosmetic density (tier shed): particle counts and cloud octaves. */
  density: number;
}

function fogUniforms(): Record<string, THREE.IUniform> {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}

const NOISE_GLSL = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += noise(p) * a; p *= 2.03; a *= 0.5; }
  return s;
}
`;

// ---- the storm dome -------------------------------------------------------------------

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = gl_Position.w * 0.99999;
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uHorizon;
uniform float uDetail;
${NOISE_GLSL}

// A lightning schedule: returns the flash strength (0..1) of the strike
// cell k, and its bearing on the horizon, both hashed from the cell index.
float strike(float t, float cell, out float bearing) {
  float k = floor(t / cell);
  float h = hash(vec2(k, 3.7));
  bearing = hash(vec2(k, 9.1));
  float local = t - k * cell;
  float start = h * (cell - 1.2);
  float x = local - start;
  if (x < 0.0 || x > 0.9) return 0.0;
  // Two or three flickers in the first second, fading.
  float flick = step(0.0, x) * (1.0 - smoothstep(0.0, 0.07, x))
    + step(0.18, x) * (1.0 - smoothstep(0.18, 0.28, x)) * 0.8
    + step(0.42, x) * (1.0 - smoothstep(0.42, 0.62, x)) * 0.55 * step(0.5, h);
  return flick * step(0.35, hash(vec2(k, 1.3)));
}

void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  vec3 sun = normalize(uSunDir);
  float cosSun = dot(d, sun);
  vec2 flatD = normalize(d.xz + 1e-5);
  vec2 flatSun = normalize(sun.xz);
  float towardSun = dot(flatD, flatSun) * 0.5 + 0.5;

  // Storm grade: bruised slate overhead, a sick green-grey band, a warm
  // amber glow low toward the drowned sun, the fog colour at the horizon.
  // (Linear values: the colorspace chunk lifts them to sRGB.)
  vec3 zenith = vec3(0.016, 0.022, 0.026);
  vec3 band = vec3(0.058, 0.072, 0.07);
  vec3 warm = vec3(0.62, 0.36, 0.14);
  vec3 col = mix(band, zenith, smoothstep(0.08, 0.7, up));
  col = mix(col, warm, pow(max(towardSun, 0.0), 5.0) * (1.0 - smoothstep(0.0, 0.34, up)) * 0.55);
  col = mix(uHorizon * 1.15, col, smoothstep(-0.03, 0.2, up));

  // The low sun: a pale, diffused disc, a wide glow under the cloud deck.
  float ang = acos(clamp(cosSun, -1.0, 1.0));
  float disc = smoothstep(0.055, 0.045, ang);
  float glow = exp(-ang * 9.0) * 0.9 + exp(-ang * 2.6) * 0.22;
  vec3 sunCol = vec3(1.0, 0.9, 0.72);

  // The storm deck: two warped fbm decks racing inland, dark bellies, and
  // bright rims where the sun catches their edges.
  float cloud = 0.0;
  float lit = 0.0;
  if (up > -0.08) {
    vec2 uv = d.xz / (up + 0.16);
    vec2 wind = vec2(uTime * 0.012, uTime * 0.006);
    vec2 warp = vec2(fbm(uv * 0.3 + 3.0 + wind), fbm(uv * 0.3 - 7.0 - wind)) * 1.6;
    float c1 = fbm(uv * 0.42 + warp + wind * 1.5);
    float c2 = fbm(uv * 1.1 - warp * 0.6 + wind * 2.5 + 11.0);
    float c = c1 * 0.68 + c2 * 0.45 * uDetail;
    cloud = smoothstep(0.42, 0.78, c) * smoothstep(-0.06, 0.14, up);
    // Thinner near the sun so it can bleed through gaps.
    cloud *= 1.0 - 0.45 * exp(-ang * 4.0) * smoothstep(0.62, 0.45, c);
    lit = smoothstep(0.55, 0.3, c) * pow(max(0.0, cosSun), 3.0);
  }
  vec3 belly = vec3(0.022, 0.027, 0.03);
  vec3 cloudCol = mix(belly, vec3(0.11, 0.12, 0.115), smoothstep(0.1, 0.6, up + 0.3));
  cloudCol += sunCol * lit * 0.9;

  // Lightning over the fen: flashes light a patch of the deck from inside.
  float bearingA; float bearingB;
  float fa = strike(uTime, 9.0, bearingA);
  float fb = strike(uTime + 4.3, 13.0, bearingB);
  float azim = atan(d.x, d.z) / 6.2831853 + 0.5;
  float lightning = 0.0;
  // Strikes live on the landward arc (away from the sun).
  float arcA = 0.25 + bearingA * 0.45;
  float arcB = 0.3 + bearingB * 0.4;
  float nearA = 1.0 - smoothstep(0.0, 0.07, abs(azim - arcA));
  float nearB = 1.0 - smoothstep(0.0, 0.06, abs(azim - arcB));
  lightning = fa * nearA + fb * nearB;
  float lowBand = smoothstep(0.34, 0.02, up) * smoothstep(-0.05, 0.02, up);
  vec3 flash = vec3(0.5, 0.58, 0.8) * lightning * (0.6 + 0.8 * cloud) * lowBand;
  // A forked bolt under the deck at the hottest strike.
  float boltX = (azim - arcA) * 90.0 + (noise(vec2(up * 40.0, floor(uTime / 9.0))) - 0.5) * 1.6;
  float bolt = (1.0 - smoothstep(0.0, 0.35, abs(boltX))) * fa * step(0.0, up) * step(up, 0.22);

  // Rain curtains hanging under distant cells.
  float curtain = smoothstep(0.62, 0.9, noise(vec2(azim * 60.0, 0.5 + uTime * 0.05)))
    * smoothstep(0.2, 0.0, up) * smoothstep(-0.02, 0.05, up) * 0.35;

  col = mix(col, cloudCol, cloud * 0.9);
  col += sunCol * glow * (1.0 - cloud * 0.8) * 0.45;
  col = mix(col, sunCol * 1.6, disc * (1.0 - cloud * 0.75));
  col = mix(col, uHorizon * 0.7, curtain);
  col += flash + vec3(0.85, 0.9, 1.0) * bolt * 1.6;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function buildSky(opts: BastionAtmosphereOptions): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    name: 'sunkenBastionSky',
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uSunDir: { value: SUNKEN_BASTION_SUN_DIRECTION.clone() },
      uHorizon: { value: new THREE.Color(SUNKEN_BASTION_FOG_COLOR) },
      uDetail: { value: opts.lowGfx ? 0.4 : 1 },
    },
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), material);
  mesh.name = 'sunkenBastionSky';
  mesh.frustumCulled = false;
  return mesh;
}

// ---- the sea --------------------------------------------------------------------------

const SEA_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
uniform float uTime;
uniform float uChop;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vCrest;
#include <fog_pars_vertex>

// A storm swell: four directional waves rolling in from the south-west.
vec3 swell(vec2 p, out vec3 nrm, out float crest) {
  vec2 dirs[4];
  dirs[0] = normalize(vec2(0.6, 0.8));
  dirs[1] = normalize(vec2(0.2, 1.0));
  dirs[2] = normalize(vec2(0.9, 0.4));
  dirs[3] = normalize(vec2(-0.3, 1.0));
  float lens[4];
  lens[0] = 38.0; lens[1] = 21.0; lens[2] = 13.0; lens[3] = 7.5;
  float amps[4];
  amps[0] = 0.85; amps[1] = 0.45; amps[2] = 0.24; amps[3] = 0.12;
  vec3 offs = vec3(0.0);
  vec3 dx = vec3(1.0, 0.0, 0.0);
  vec3 dz = vec3(0.0, 0.0, 1.0);
  crest = 0.0;
  for (int i = 0; i < 4; i++) {
    float k = 6.2831853 / lens[i];
    float c = sqrt(9.8 / k);
    float a = amps[i] * uChop;
    float f = k * (dot(dirs[i], p) - c * uTime * 0.55);
    float q = 0.55;
    offs.x += q * a * dirs[i].x * cos(f);
    offs.z += q * a * dirs[i].y * cos(f);
    offs.y += a * sin(f);
    dx += vec3(-q * dirs[i].x * dirs[i].x * a * k * sin(f), dirs[i].x * a * k * cos(f), -q * dirs[i].x * dirs[i].y * a * k * sin(f));
    dz += vec3(-q * dirs[i].x * dirs[i].y * a * k * sin(f), dirs[i].y * a * k * cos(f), -q * dirs[i].y * dirs[i].y * a * k * sin(f));
    crest += max(0.0, sin(f)) * amps[i];
  }
  nrm = normalize(cross(dz, dx));
  return offs;
}

varying vec3 vNormalW;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vLocal = position;
  vec3 n;
  float crest;
  vec3 off = swell(world.xz, n, crest);
  // Calm the swell far out (the horizon stays a plane) and at the grid rim.
  float fade = 1.0 - smoothstep(420.0, 900.0, length(position.xz));
  world.xyz += off * fade;
  vWorld = world.xyz;
  vNormalW = normalize(mix(vec3(0.0, 1.0, 0.0), n, fade));
  vCrest = crest * fade;
  vec4 mvPosition = wocCamRelView(world.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SEA_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSky;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform sampler2D uShore;
uniform vec4 uShoreRect;
uniform vec3 uOrigin;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vNormalW;
varying float vCrest;
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  vec3 n = normalize(vNormalW);
  // Fine ripple normals on top of the swell.
  vec2 rp = vWorld.xz * 0.35 + vec2(uTime * 0.4, uTime * 0.25);
  n = normalize(n + vec3(noise(rp) - 0.5, 0.0, noise(rp + 17.0) - 0.5) * 0.35);
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(max(1.0 - max(0.0, dot(n, view)), 0.0), 4.0);
  vec3 sun = normalize(uSunDir);
  vec3 halfV = normalize(sun + view);
  float glint = pow(max(0.0, dot(n, halfV)), 180.0) * 2.2 + pow(max(0.0, dot(n, halfV)), 22.0) * 0.18;

  // How close to the shore: the land mask, blurred into a ramp.
  vec2 suv = (vLocal.xz - uShoreRect.xy) / uShoreRect.zw;
  float shore = texture2D(uShore, suv).r;
  vec3 water = mix(uDeep, uShallow, smoothstep(0.0, 0.5, shore) * 0.8 + vCrest * 0.18);
  vec3 col = mix(water, uSky, 0.18 + fres * 0.55);
  col += vec3(1.0, 0.9, 0.72) * glint;

  // Surf: bands of foam rolling onto the shore, breaking white at the rocks.
  // Break the rollers up so they never read as ruled lines.
  float warp = noise(vWorld.xz * 0.05) * 9.0 + noise(vWorld.xz * 0.17) * 3.0;
  float band = sin(shore * 30.0 - uTime * 1.6 + warp);
  float surfZone = smoothstep(0.12, 0.34, shore) * (1.0 - smoothstep(0.55, 0.8, shore));
  float foamNoise = noise(vWorld.xz * 0.45 + uTime * 0.3) * 0.6 + noise(vWorld.xz * 1.3 - uTime * 0.5) * 0.4;
  float foam = surfZone * smoothstep(0.55, 0.98, band * 0.5 + 0.5) * smoothstep(0.4, 0.75, foamNoise);
  foam += smoothstep(0.44, 0.62, shore) * smoothstep(0.42, 0.78, foamNoise) * 0.95;
  // Sparse whitecaps on the swell crests out at sea.
  foam += smoothstep(1.2, 1.55, vCrest + foamNoise * 0.6) * 0.45 * smoothstep(0.55, 0.8, noise(vWorld.xz * 0.07 + 5.0));
  col = mix(col, vec3(0.62, 0.66, 0.64), clamp(foam, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

let shoreTexture: THREE.DataTexture | null = null;

function shoreMaskTexture(lowGfx: boolean): THREE.DataTexture {
  if (shoreTexture) return shoreTexture;
  const size = lowGfx ? 128 : 256;
  const mask = planShoreMask(size);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < mask.length; i++) {
    const v = Math.round(Math.min(1, mask[i]) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  shoreTexture = tex;
  return tex;
}

function buildSea(opts: BastionAtmosphereOptions): THREE.Mesh {
  // A dense grid round the headland, stretched toward the horizon.
  const segs = opts.lowGfx ? 96 : 200;
  const geo = new THREE.PlaneGeometry(1800, 1800, segs, segs).rotateX(-Math.PI / 2);
  // Pull the vertices in toward the centre (dense near, sparse far).
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const t = r / 900;
    const k = (t * t * 0.75 + t * 0.25) * 900;
    pos.setX(i, (x / r) * k);
    pos.setZ(i, (z / r) * k);
  }
  geo.computeBoundingSphere();
  const b = SHORE_MASK_BOUNDS;
  const material = new THREE.ShaderMaterial({
    name: 'sunkenBastionSea',
    vertexShader: SEA_VERT,
    fragmentShader: SEA_FRAG,
    uniforms: {
      ...fogUniforms(),
      uTime: sharedUniforms.uTime,
      uChop: { value: opts.lowGfx ? 0.7 : 1 },
      uSunDir: { value: SUNKEN_BASTION_SUN_DIRECTION.clone() },
      uSky: { value: new THREE.Color(0x4f5d59) },
      uDeep: { value: new THREE.Color(0x0b1617) },
      uShallow: { value: new THREE.Color(0x2c4640) },
      uShore: { value: shoreMaskTexture(opts.lowGfx) },
      uShoreRect: { value: new THREE.Vector4(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ) },
      uOrigin: { value: new THREE.Vector3() },
    },
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  const cx = (SUNKEN_BASTION_FIELD.bounds.minX + SUNKEN_BASTION_FIELD.bounds.maxX) / 2;
  const cz = (SUNKEN_BASTION_FIELD.bounds.minZ + SUNKEN_BASTION_FIELD.bounds.maxZ) / 2;
  // The shore lookup reads instance-local xz from the mesh's own position.
  mesh.position.set(0, SUNKEN_BASTION_SEA_LEVEL, 0);
  mesh.name = 'sunkenBastionSea';
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  void cx;
  void cz;
  return mesh;
}

// ---- fog on the water ---------------------------------------------------------------

const BANK_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec4 aBank;   // x, y, z, size
attribute vec3 aDrift;  // dx, dz, seed
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vSeed = aDrift.z;
  // Banks roll back and forth on the swell's breath round where they lie, so
  // they never drift in over a terrace a fight happens on.
  vec3 c = aBank.xyz;
  float sway = sin(uTime * 0.018 * (0.6 + aDrift.z) + aDrift.z * 40.0);
  c.x += aDrift.x * sway * 14.0;
  c.z += aDrift.y * sway * 14.0;
  vec4 world = modelMatrix * vec4(c, 1.0);
  // Camera-facing on the vertical axis only: a wall of fog, not a sprite.
  vec3 toCam = cameraPosition - world.xyz;
  vec2 side = normalize(vec2(-toCam.z, toCam.x) + 1e-5);
  world.xyz += vec3(side.x, 0.0, side.y) * position.x * aBank.w + vec3(0.0, position.y * aBank.w * 0.35, 0.0);
  // Never a wall across the camera: fade banks that come too close.
  vFade = smoothstep(18.0, 60.0, length(toCam));
  vec4 mvPosition = wocCamRelView(world.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const BANK_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uLit;
uniform float uAlpha;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  vec2 p = vUv * vec2(3.0, 1.4) + vec2(vSeed * 13.0 + uTime * 0.02, vSeed * 7.0);
  float n = fbm(p) * 0.7 + fbm(p * 2.2 + 5.0) * 0.3;
  float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
  float a = smoothstep(0.32, 0.72, n) * edge * uAlpha * vFade;
  vec3 col = mix(uColor, uLit, smoothstep(0.4, 0.9, n) * vUv.y);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function buildFogBanks(opts: BastionAtmosphereOptions): THREE.Mesh {
  const banks = planFogBanks(Math.round((opts.lowGfx ? 26 : 70) * Math.max(0.4, opts.density)));
  const base = new THREE.PlaneGeometry(2, 2, 1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const bank = new Float32Array(banks.length * 4);
  const drift = new Float32Array(banks.length * 3);
  banks.forEach((b, i) => {
    bank.set([b.x, b.y, b.z, b.size], i * 4);
    drift.set([b.dx, b.dz, b.seed], i * 3);
  });
  geo.setAttribute('aBank', new THREE.InstancedBufferAttribute(bank, 4));
  geo.setAttribute('aDrift', new THREE.InstancedBufferAttribute(drift, 3));
  geo.instanceCount = banks.length;
  const material = new THREE.ShaderMaterial({
    name: 'sunkenBastionFogBanks',
    vertexShader: BANK_VERT,
    fragmentShader: BANK_FRAG,
    uniforms: {
      ...fogUniforms(),
      uTime: sharedUniforms.uTime,
      uColor: { value: new THREE.Color(0x7d8d86) },
      uLit: { value: new THREE.Color(0xd9d5c4) },
      uAlpha: { value: opts.lowGfx ? 0.5 : 0.62 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'sunkenBastionFogBanks';
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return mesh;
}

// A thin mist layer hugging the water round the cliff feet (never over a terrace).
const MIST_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
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

const MIST_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uLayer;
uniform float uAlpha;
uniform vec3 uColor;
uniform sampler2D uShore;
uniform vec4 uShoreRect;
varying vec3 vWorld;
varying vec3 vLocal;
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  vec2 p = vWorld.xz * 0.015 + uLayer * 7.3;
  float t = uTime * (0.01 + uLayer * 0.004);
  float m = fbm(p + vec2(t, t * 0.5)) * 0.65 + fbm(p * 2.4 - vec2(t * 1.6, 0.0)) * 0.35;
  vec2 suv = (vLocal.xz - uShoreRect.xy) / uShoreRect.zw;
  float shore = texture2D(uShore, suv).r;
  // Thickest just off the cliffs, clear over the land itself.
  float band = smoothstep(0.02, 0.3, shore) * (1.0 - smoothstep(0.55, 0.8, shore));
  float a = uAlpha * smoothstep(0.35, 0.8, m) * (0.3 + 0.7 * band);
  float near = smoothstep(10.0, 45.0, length(cameraPosition - vWorld));
  gl_FragColor = vec4(uColor, a * near);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function buildWaterMist(opts: BastionAtmosphereOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sunkenBastionWaterMist';
  const layers = opts.lowGfx ? [1.2] : [0.8, 2.6, 5.2];
  const b = SHORE_MASK_BOUNDS;
  const geo = new THREE.PlaneGeometry(1400, 1400, 1, 1).rotateX(-Math.PI / 2);
  layers.forEach((y, i) => {
    const material = new THREE.ShaderMaterial({
      name: 'sunkenBastionWaterMist',
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      uniforms: {
        ...fogUniforms(),
        uTime: sharedUniforms.uTime,
        uLayer: { value: i },
        uAlpha: { value: [0.55, 0.42, 0.3][i] ?? 0.4 },
        uColor: { value: new THREE.Color(i === 0 ? 0x9aa8a0 : 0x86968f) },
        uShore: { value: shoreMaskTexture(opts.lowGfx) },
        uShoreRect: {
          value: new THREE.Vector4(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ),
        },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(0, SUNKEN_BASTION_SEA_LEVEL + y, 0);
    mesh.renderOrder = 4 + i;
    mesh.name = `waterMist${i}`;
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  return group;
}

// ---- gulls -----------------------------------------------------------------------------

const GULL_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec4 aOrbit; // cx, cz, radius, height
attribute vec2 aSeed;  // phase, speed
uniform float uTime;
varying float vShade;
#include <fog_pars_vertex>
void main() {
  float a = aSeed.x * 6.2831853 + uTime * (0.12 + aSeed.y * 0.1);
  vec3 c = vec3(aOrbit.x + sin(a) * aOrbit.z, aOrbit.w + sin(uTime * 0.7 + aSeed.x * 9.0) * 2.0, aOrbit.y + cos(a) * aOrbit.z);
  // Heading along the orbit's tangent.
  vec2 fwd = normalize(vec2(cos(a), -sin(a)));
  vec2 side = vec2(-fwd.y, fwd.x);
  // A wing beat on the outer wing vertices (|x| > 0.1), gliding most of the time.
  float beat = sin(uTime * 9.0 + aSeed.x * 20.0) * step(0.55, fract(uTime * 0.23 + aSeed.x));
  vec3 p = position;
  p.y += abs(p.x) * (0.35 + 0.45 * beat);
  vec3 world = c + vec3(side.x, 0.0, side.y) * p.x + vec3(fwd.x, 0.0, fwd.y) * p.z + vec3(0.0, p.y, 0.0);
  vShade = 0.75 + 0.25 * sign(p.x) * beat;
  vec4 mvPosition = wocCamRelView(world);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const GULL_FRAG = /* glsl */ `
precision highp float;
varying float vShade;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(vec3(0.86, 0.87, 0.84) * vShade, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function buildGulls(opts: BastionAtmosphereOptions): THREE.Mesh {
  // One gull: a body and two swept wings, 1.6 yd across.
  const wing = new Float32Array([
    // left wing
    0, 0, 0.25, -0.8, 0.05, -0.05, 0, 0, -0.2,
    // right wing
    0, 0, 0.25, 0, 0, -0.2, 0.8, 0.05, -0.05,
    // body
    -0.07, 0, 0.35, 0.07, 0, 0.35, 0, 0, -0.45,
  ]);
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.BufferAttribute(wing, 3));
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', base.getAttribute('position'));
  const n = opts.lowGfx ? 8 : 26;
  const orbit = new Float32Array(n * 4);
  const seed = new Float32Array(n * 2);
  const spots: [number, number, number, number][] = [
    [0, -170, 60, 22],
    [60, 60, 34, 34],
    [-40, 190, 40, 52],
    [-10, -90, 44, 26],
  ];
  for (let i = 0; i < n; i++) {
    const [cx, cz, r, h] = spots[i % spots.length];
    orbit.set([cx, cz, r * (0.6 + bastionHash(i, 3) * 0.7), h + bastionHash(i, 5) * 14], i * 4);
    seed.set([bastionHash(i, 7), bastionHash(i, 11)], i * 2);
  }
  geo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 2));
  geo.instanceCount = n;
  const material = new THREE.ShaderMaterial({
    name: 'sunkenBastionGulls',
    vertexShader: GULL_VERT,
    fragmentShader: GULL_FRAG,
    uniforms: { ...fogUniforms(), uTime: sharedUniforms.uTime },
    side: THREE.DoubleSide,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'sunkenBastionGulls';
  mesh.frustumCulled = false;
  return mesh;
}

// ---- sea stacks and the far coast --------------------------------------------------------

function buildStacks(opts: BastionAtmosphereOptions): THREE.Mesh {
  const stacks = planSeaStacks(opts.lowGfx ? 18 : 36);
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const sides = opts.lowGfx ? 9 : 14;
  const rings = opts.lowGfx ? 6 : 12;
  const sea = SUNKEN_BASTION_SEA_LEVEL;
  const noise = (a: number, t: number, seed: number) =>
    Math.sin(a * 2 + seed) * 0.5 +
    Math.sin(a * 5.3 + t * 7 + seed * 1.3) * 0.3 +
    Math.sin(a * 11.1 - t * 13 + seed * 2.1) * 0.2;
  for (const st of stacks) {
    const first = positions.length / 3;
    const base = sea - 6;
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const y = base + (st.height - base) * t;
      const ledge = 1 - Math.floor(t * 5) * 0.08 - (t * 5 - Math.floor(t * 5)) * 0.06;
      const rad = st.radius * Math.max(0.12, (1 - t) ** 0.45 * ledge) * (t > 0.92 ? 0.7 : 1);
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const jag = 0.72 + 0.28 * noise(a, t, st.seed);
        positions.push(st.x + Math.cos(a) * rad * jag, y, st.z + Math.sin(a) * rad * jag);
        uvs.push((k / sides) * st.radius * 0.3, y * 0.12);
        // Wet near-black at the waterline, a pale algae band, weathered grey above.
        const above = y - sea;
        const wet = Math.max(0, 1 - above / 2.5);
        const algae = Math.max(0, 1 - Math.abs(above - 3) / 2);
        const shade = 0.13 + t * 0.07;
        colors.push(
          shade * (1 - wet * 0.55) + algae * 0.05,
          shade * (1 - wet * 0.5) + algae * 0.09,
          shade * (1 - wet * 0.45) + algae * 0.04,
        );
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < sides; k++) {
        const i0 = first + r * sides + k;
        const i1 = first + r * sides + ((k + 1) % sides);
        indices.push(i0, i1, i0 + sides, i1, i1 + sides, i0 + sides);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const rock = rockDetail();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: rock.map,
      roughness: 0.95,
      flatShading: true,
      name: 'sunkenBastionStacks',
    }),
  );
  mesh.name = 'sunkenBastionSeaStacks';
  mesh.frustumCulled = false;
  return mesh;
}

/** The whole sky, sea and weather of the Sunken Bastion, instance-local. */
export function buildBastionSkySea(opts: BastionAtmosphereOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sunkenBastionSkySea';
  group.add(buildSky(opts));
  group.add(buildSea(opts));
  group.add(buildStacks(opts));
  group.add(buildWaterMist(opts));
  group.add(buildFogBanks(opts));
  group.add(buildGulls(opts));
  return group;
}
