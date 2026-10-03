// The Hollow Crypt's sky and air: a moonlit night dome with its colossal moon
// and drifting cloud banks, the grave-mist sea under the terraces, the soul
// column over the Rite Ring (seen from every corner of the necropolis), the
// soul-wisp rivers flowing toward it, moonbeams through the ruins, drifting
// bone dust around the camera, frost glitter in the gallery, and the black crag
// ring that closes the horizon.
//
// All motion is shader-side on the shared clock (sharedUniforms.uTime): no
// per-frame JavaScript. Particle counts shed with the graphics tier; every
// element here is cosmetic (no telegraph, no actionable information).

import * as THREE from 'three';
import { HOLLOW_CRYPT_FOG_COLOR } from '../fog_scene_state';
import { sharedUniforms } from '../gfx';
import { HOLLOW_CRYPT_MOON_DIRECTION } from '../interior_light_rig';
import {
  HOLLOW_CRYPT_WISP_RIVERS,
  planBackdropSpires,
  RITE_RING,
  resampleRiver,
} from './crypt_plan_core';

export interface CryptAtmosphereOptions {
  lowGfx: boolean;
  /** 0..1 cosmetic density (tier shed): particle counts and cloud octaves. */
  density: number;
}

const FOG_CHUNKS_VERT = /* glsl */ `
#include <fog_pars_vertex>
`;

function fogUniforms(): Record<string, THREE.IUniform> {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}

// ---- sky dome -------------------------------------------------------------------------

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
uniform vec3 uMoonDir;
uniform vec3 uHorizon;
uniform float uClouds;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
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

void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  // Gradient: indigo zenith, bruised violet band, a pale mist glow at the horizon.
  vec3 zenith = vec3(0.020, 0.026, 0.070);
  vec3 band = vec3(0.070, 0.070, 0.150);
  vec3 col = mix(band, zenith, smoothstep(0.05, 0.75, up));
  col = mix(uHorizon * 1.35 + vec3(0.03, 0.03, 0.05), col, smoothstep(-0.02, 0.22, up));
  // Soul-green breath on the northern horizon, under the column.
  float north = max(0.0, dot(normalize(vec3(d.x, 0.0, d.z)), vec3(0.0, 0.0, 1.0)));
  col += vec3(0.02, 0.07, 0.05) * pow(max(north, 0.0), 6.0) * (1.0 - smoothstep(0.0, 0.35, up));

  // Stars: a jittered grid on the sphere, twinkling, thinning toward the horizon.
  vec3 cell = floor(d * 420.0);
  float h = hash3(cell);
  vec3 jitter = vec3(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 4.1)) - 0.5;
  vec3 starDir = normalize((cell + 0.5 + jitter * 0.8) / 420.0);
  float starD = length(d - starDir) * 420.0;
  float star = smoothstep(0.38, 0.0, starD) * step(0.982, h) * (0.3 + 0.7 * pow(max(hash3(cell + 9.1), 0.0), 3.0));
  float twinkle = 0.6 + 0.4 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
  float milky = fbm(vec2(atan(d.z, d.x) * 2.0, d.y * 3.0) + 7.0);
  star *= smoothstep(0.02, 0.3, up) * twinkle * (0.7 + milky);
  col += vec3(0.85, 0.9, 1.0) * star * 1.6;
  col += vec3(0.04, 0.045, 0.08) * smoothstep(0.45, 0.8, milky) * smoothstep(0.1, 0.5, up);

  // The colossal moon: a cratered disc, limb-darkened, wrapped in a wide halo.
  float cosA = dot(d, uMoonDir);
  float ang = acos(clamp(cosA, -1.0, 1.0));
  float radius = 0.13;
  float disc = smoothstep(radius, radius - 0.004, ang);
  vec3 tangentU = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec3 tangentV = cross(tangentU, uMoonDir);
  vec2 mp = vec2(dot(d, tangentU), dot(d, tangentV)) / radius;
  float limb = sqrt(max(0.0, 1.0 - dot(mp, mp)));
  float maria = fbm(mp * 3.1 + 3.0);
  float craters = fbm(mp * 11.0);
  vec3 moon = vec3(0.86, 0.9, 1.0) * (0.55 + 0.45 * limb) * (0.78 + 0.22 * craters) * mix(0.72, 1.0, smoothstep(0.35, 0.62, maria));
  float halo = exp(-ang * 7.5) * 0.42 + exp(-ang * 2.2) * 0.12;
  col += vec3(0.45, 0.52, 0.75) * halo;

  // Cloud banks: two fbm decks drifting across the moon, silver-lined near it.
  float cloudMask = 0.0;
  if (up > -0.05 && uClouds > 0.0) {
    vec2 uv = d.xz / (up + 0.18);
    float c1 = fbm(uv * 0.55 + vec2(uTime * 0.006, uTime * 0.002));
    float c2 = fbm(uv * 1.3 - vec2(uTime * 0.011, 0.0) + 11.0);
    float c = smoothstep(0.48, 0.78, c1 * 0.7 + c2 * 0.45) * smoothstep(-0.02, 0.2, up) * uClouds;
    float lining = pow(max(0.0, cosA), 40.0) * 1.4 + pow(max(0.0, cosA), 6.0) * 0.25;
    vec3 cloudCol = mix(vec3(0.05, 0.05, 0.09), vec3(0.55, 0.6, 0.8), lining);
    cloudMask = c;
    col = mix(col, cloudCol, c * 0.88);
  }
  col = mix(col, moon, disc * (1.0 - cloudMask * 0.55));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function buildSky(opts: CryptAtmosphereOptions): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    name: 'hollowCryptSky',
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uMoonDir: { value: HOLLOW_CRYPT_MOON_DIRECTION.clone() },
      uHorizon: { value: new THREE.Color(HOLLOW_CRYPT_FOG_COLOR) },
      uClouds: { value: opts.lowGfx ? 0.6 : 1 },
    },
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), material);
  mesh.name = 'hollowCryptSky';
  mesh.frustumCulled = false;
  return mesh;
}

// ---- grave-mist sea ---------------------------------------------------------------------

const MIST_VERT = /* glsl */ `
varying vec3 vWorld;
${FOG_CHUNKS_VERT}
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const MIST_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform float uTime;
uniform float uLayer;
uniform float uAlpha;
uniform vec3 uLow;
uniform vec3 uHigh;
uniform vec3 uOrigin;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { s += noise(p) * a; p *= 2.07; a *= 0.5; }
  return s;
}
void main() {
  vec2 p = (vWorld.xz - uOrigin.xz) * 0.018 + uLayer * 7.3;
  float t = uTime * (0.012 + uLayer * 0.004);
  float m = fbm(p + vec2(t, t * 0.6)) * 0.6 + fbm(p * 2.3 - vec2(t * 1.7, 0.0)) * 0.4;
  float billow = smoothstep(0.25, 0.85, m);
  vec3 col = mix(uLow, uHigh, billow);
  float a = uAlpha * (0.35 + 0.65 * billow);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function buildMist(opts: CryptAtmosphereOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hollowCryptMist';
  const layers = opts.lowGfx ? [-14] : [-9, -13, -18, -26];
  const geo = new THREE.PlaneGeometry(1400, 1400, 1, 1).rotateX(-Math.PI / 2);
  layers.forEach((y, i) => {
    const material = new THREE.ShaderMaterial({
      name: 'hollowCryptMist',
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      uniforms: {
        ...fogUniforms(),
        uTime: sharedUniforms.uTime,
        uLayer: { value: i },
        uAlpha: { value: opts.lowGfx ? 0.92 : [0.42, 0.5, 0.62, 0.95][i] },
        uLow: { value: new THREE.Color(0x151a2c) },
        uHigh: { value: new THREE.Color(i === 0 ? 0x7a82a8 : 0x4c5478) },
        uOrigin: { value: new THREE.Vector3() },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(0, y, 60);
    mesh.renderOrder = 2 - i;
    mesh.name = `mistLayer${i}`;
    group.add(mesh);
  });
  return group;
}

// ---- the soul column ------------------------------------------------------------------

const COLUMN_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vH;
varying vec2 vAxis;
uniform float uHeight;
void main() {
  vAxis = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vH = position.y / uHeight + 0.5;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const COLUMN_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vH;
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uPower;
varying vec2 vAxis;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec3 view = normalize(cameraPosition - vWorld);
  float facing = abs(dot(normalize(vNormalW), view));
  float body = pow(max(facing, 0.0), uPower);
  // Long vertical soul streaks climbing the beam (angle round the AXIS, so
  // the pattern never bands horizontally on the near face).
  float ang = atan(vWorld.z - vAxis.y, vWorld.x - vAxis.x);
  float flow = noise(vec2(ang * 5.0, vWorld.y * 0.012 - uTime * 0.35)) * 0.6
    + noise(vec2(ang * 11.0 + 3.0, vWorld.y * 0.03 - uTime * 0.8)) * 0.4;
  float fadeTop = 1.0 - smoothstep(0.55, 1.0, vH);
  float fadeBase = smoothstep(0.0, 0.03, vH);
  // Dimmer up close: a beacon from afar, never a bloom wash over the fight.
  float axisDist = length(cameraPosition.xz - vAxis);
  float near = mix(0.12, 1.0, smoothstep(20.0, 120.0, axisDist));
  float i = body * (0.55 + 0.75 * flow) * fadeTop * fadeBase * 0.6 * near;
  vec3 col = mix(uEdge, uCore, body);
  gl_FragColor = vec4(col * i, i);
  #include <colorspace_fragment>
}
`;

function columnMaterial(
  core: number,
  edge: number,
  power: number,
  height: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'hollowCryptColumn',
    vertexShader: COLUMN_VERT,
    fragmentShader: COLUMN_FRAG,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uCore: { value: new THREE.Color(core) },
      uEdge: { value: new THREE.Color(edge) },
      uPower: { value: power },
      uHeight: { value: height },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
}

function buildColumn(opts: CryptAtmosphereOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hollowCryptSoulColumn';
  const height = 420;
  const base = RITE_RING.h;
  const layers: [number, number, number, number, number][] = opts.lowGfx
    ? [[5, 0xe8fff4, 0x3fa884, 1.6, 0.9]]
    : [
        [2.4, 0xffffff, 0x9dffd8, 2.5, 1],
        [6.5, 0xd8fff0, 0x3fae88, 1.7, 0.8],
        [15, 0x7ff0c4, 0x1f5a4a, 1.1, 0.55],
      ];
  for (const [r, core, edge, power, scale] of layers) {
    const geo = new THREE.CylinderGeometry(r, r * 1.25, height, 32, 1, true);
    const mesh = new THREE.Mesh(geo, columnMaterial(core, edge, power, height));
    mesh.position.set(RITE_RING.x, base + height / 2, RITE_RING.z);
    mesh.scale.set(scale, 1, scale);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    group.add(mesh);
  }
  return group;
}

// ---- particles ------------------------------------------------------------------------

const WISP_VERT = /* glsl */ `
attribute float aRiver;
attribute float aPhase;
attribute vec3 aJitter;
uniform float uTime;
uniform vec3 uPath[RIVERS * SAMPLES];
uniform float uSize;
varying float vAlpha;
varying float vHue;
vec3 pathAt(int river, float s) {
  float f = s * float(SAMPLES - 1);
  int i = int(floor(f));
  i = clamp(i, 0, SAMPLES - 2);
  float t = f - float(i);
  vec3 a = uPath[river * SAMPLES + i];
  vec3 b = uPath[river * SAMPLES + i + 1];
  return mix(a, b, t);
}
void main() {
  int river = int(aRiver + 0.5);
  float s = fract(aPhase + uTime * (0.012 + aJitter.x * 0.004));
  vec3 p = pathAt(river, s);
  float wobble = uTime * (0.6 + aJitter.y) + aPhase * 30.0;
  p += vec3(sin(wobble) * aJitter.z, sin(wobble * 1.3) * 0.8, cos(wobble * 0.9) * aJitter.z) * 2.2;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(14.0, uSize * (0.6 + aJitter.y) * (300.0 / max(1.0, -mv.z)));
  // Fade a wisp that drifts into the camera: a mote, never a screen wash.
  float nearFade = smoothstep(6.0, 22.0, -mv.z);
  vAlpha = nearFade * smoothstep(0.0, 0.06, s) * (1.0 - smoothstep(0.9, 1.0, s)) * (0.55 + 0.45 * sin(wobble * 2.0));
  vHue = aJitter.x;
}
`;

const WISP_FRAG = /* glsl */ `
precision highp float;
varying float vAlpha;
varying float vHue;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float core = pow(max(0.0, 1.0 - d), 3.0);
  vec3 col = mix(vec3(0.44, 1.0, 0.76), vec3(0.72, 0.62, 1.0), vHue);
  float a = core * vAlpha;
  gl_FragColor = vec4(col * a * 1.6, a);
  #include <colorspace_fragment>
}
`;

const RIVER_SAMPLES = 16;

function buildWisps(opts: CryptAtmosphereOptions): THREE.Points {
  const rivers = HOLLOW_CRYPT_WISP_RIVERS;
  const path: THREE.Vector3[] = [];
  for (const r of rivers) {
    for (const p of resampleRiver(r, RIVER_SAMPLES)) path.push(new THREE.Vector3(p[0], p[1], p[2]));
  }
  const riverIds: number[] = [];
  const phases: number[] = [];
  const jitter: number[] = [];
  let seed = 7;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  rivers.forEach((r, i) => {
    const n = Math.max(8, Math.round(r.count * opts.density));
    for (let k = 0; k < n; k++) {
      riverIds.push(i);
      phases.push(rnd());
      jitter.push(rnd(), rnd(), 0.3 + rnd());
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(new Float32Array(riverIds.length * 3), 3),
  );
  geo.setAttribute('aRiver', new THREE.Float32BufferAttribute(riverIds, 1));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geo.setAttribute('aJitter', new THREE.Float32BufferAttribute(jitter, 3));
  const material = new THREE.ShaderMaterial({
    name: 'hollowCryptWisps',
    vertexShader: WISP_VERT,
    fragmentShader: WISP_FRAG,
    defines: { RIVERS: rivers.length, SAMPLES: RIVER_SAMPLES },
    uniforms: {
      uTime: sharedUniforms.uTime,
      uPath: { value: path },
      uSize: { value: 2.6 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, material);
  points.name = 'hollowCryptWisps';
  points.frustumCulled = false;
  points.renderOrder = 15;
  return points;
}

const DUST_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform vec3 uBox;
uniform float uSize;
varying float vAlpha;
void main() {
  vec3 drift = vec3(sin(uTime * 0.07 + aSeed.x * 6.0) * 3.0, uTime * (0.25 + aSeed.y * 0.35), cos(uTime * 0.05 + aSeed.z * 6.0) * 3.0);
  vec3 p = position + drift;
  vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = cameraPosition + rel;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(3.0, uSize * (0.5 + aSeed.z) * (40.0 / max(1.0, -mv.z)));
  float edge = 1.0 - smoothstep(0.35, 0.5, max(abs(rel.x) / uBox.x, abs(rel.z) / uBox.z));
  vAlpha = edge * (0.35 + 0.65 * fract(aSeed.x * 13.0 + uTime * 0.1));
}
`;

const DUST_FRAG = /* glsl */ `
precision highp float;
varying float vAlpha;
uniform vec3 uColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * vAlpha * 0.22;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

function buildDust(opts: CryptAtmosphereOptions): THREE.Points {
  const count = Math.round((opts.lowGfx ? 220 : 900) * opts.density);
  const box = new THREE.Vector3(90, 36, 90);
  const pos = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  let s = 3;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rnd() * box.x;
    pos[i * 3 + 1] = rnd() * box.y;
    pos[i * 3 + 2] = rnd() * box.z;
    seeds[i * 3] = rnd();
    seeds[i * 3 + 1] = rnd();
    seeds[i * 3 + 2] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  const material = new THREE.ShaderMaterial({
    name: 'hollowCryptDust',
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uBox: { value: box },
      uSize: { value: 1.8 },
      uColor: { value: new THREE.Color(0xcfc8e0) },
    },
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const points = new THREE.Points(geo, material);
  points.name = 'hollowCryptDust';
  points.frustumCulled = false;
  points.renderOrder = 16;
  return points;
}

// ---- the crag ring -------------------------------------------------------------------

function buildBackdrop(opts: CryptAtmosphereOptions): THREE.Mesh {
  const spires = planBackdropSpires(opts.lowGfx ? 20 : 34);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const sides = opts.lowGfx ? 9 : 16;
  const rings = opts.lowGfx ? 8 : 18;
  const moon = HOLLOW_CRYPT_MOON_DIRECTION;
  const noise = (a: number, t: number, seed: number) =>
    Math.sin(a * 2 + seed) * 0.5 +
    Math.sin(a * 5.3 + t * 7 + seed * 1.3) * 0.3 +
    Math.sin(a * 11.1 - t * 13 + seed * 2.1) * 0.2;
  const lobe = (
    cx: number,
    cz: number,
    radius: number,
    height: number,
    base: number,
    seed: number,
  ) => {
    const first = positions.length / 3;
    const lean = Math.sin(seed * 2.3) * 0.1;
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const y = base + (height - base) * t;
      // Weathered taper with ledges; the last rings break into a jagged crown.
      const ledge = 1 - Math.floor(t * 6) * 0.1 - (t * 6 - Math.floor(t * 6)) * 0.07;
      const rad = radius * Math.max(0.05, (1 - t) ** 0.65 * ledge);
      const ox = cx + lean * (y - base);
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const jag = 0.7 + 0.3 * noise(a, t, seed);
        const crown = t > 0.9 ? (Math.sin(a * 3 + seed) > 0.2 ? 1 : 0.55) : 1;
        const px = ox + Math.cos(a) * rad * jag * crown;
        const pz = cz + Math.sin(a) * rad * jag * crown;
        positions.push(px, y + (t > 0.9 ? Math.sin(a * 4 + seed) * radius * 0.2 : 0), pz);
        // A cold rim where the face turns toward the moon.
        const rim = Math.max(0, Math.cos(a) * moon.x + Math.sin(a) * moon.z) ** 3;
        // Near-black basalt: the moon rim is the only thing that reads.
        const shade = 0.035 + t * 0.025 + rim * 0.05 * t;
        colors.push(shade, shade * 0.98, shade * 1.08);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < sides; k++) {
        const i0 = first + r * sides + k;
        const i1 = first + r * sides + ((k + 1) % sides);
        indices.push(i0, i0 + sides, i1, i1, i0 + sides, i1 + sides);
      }
    }
  };
  for (const s of spires) {
    lobe(s.x, s.z, s.radius, s.height, s.base, s.seed);
    const extra = s.seed % 3;
    for (let e = 0; e < extra; e++) {
      const a = s.seed * 1.7 + e * 2.1;
      lobe(
        s.x + Math.cos(a) * s.radius * 0.7,
        s.z + Math.sin(a) * s.radius * 0.7,
        s.radius * (0.45 + 0.1 * e),
        s.base + (s.height - s.base) * (0.55 + 0.15 * e),
        s.base,
        s.seed + 10 + e,
      );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // Lit and faceted: the moon rakes the crags, the fog grades them into the
  // night by distance (aerial perspective), so they read as rock, not card.
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.95,
      name: 'hollowCryptCrags',
    }),
  );
  mesh.name = 'hollowCryptCragRing';
  mesh.frustumCulled = false;
  return mesh;
}

/** The whole sky-and-air layer of the Hollow Crypt, instance-local. */
export function buildCryptAtmosphere(
  opts: CryptAtmosphereOptions,
  ground: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hollowCryptAtmosphere';
  group.add(buildSky(opts));
  group.add(buildBackdrop(opts));
  group.add(buildMist(opts));
  group.add(buildColumn(opts));
  group.add(buildWisps(opts));
  if (!opts.lowGfx) group.add(buildDust(opts));
  void ground;
  return group;
}
