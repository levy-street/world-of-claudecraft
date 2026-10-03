// The Drowned Temple's sky and lagoon: a violet night dome with a moon
// impossibly large and close hanging low over the north rim (cratered,
// haloed, a corona ring, thin silver clouds drifting across it, a sky of
// stars), and the lagoon itself: still dark water that mirrors that moon as a
// broken silver road toward the viewer, glows cyan with life along every
// walkway's edge, and is ringed with a thin foam where it laps the pearl
// stone. Low mist lies on the water; shoals of light-fish drift under it.
//
// All motion is shader-side on the shared clock (sharedUniforms.uTime): no
// per-frame JavaScript. Counts shed with the graphics tier; every element is
// cosmetic (no telegraph, no actionable information).

import * as THREE from 'three';
import { DROWNED_TEMPLE_WATER_LEVEL } from '../../sim/content/drowned_temple_layout';
import { DROWNED_TEMPLE_FOG_COLOR } from '../fog_scene_state';
import { sharedUniforms } from '../gfx';
import { DROWNED_TEMPLE_MOON_DIRECTION } from '../interior_light_rig';
import { planFishShoals, templeHash } from './temple_plan_core';
import { planTempleShoreMask, TEMPLE_SHORE_BOUNDS } from './temple_shore_core';

export interface TempleAtmosphereOptions {
  lowGfx: boolean;
  /** 0..1 cosmetic density (tier shed): particle counts and cloud octaves. */
  density: number;
}

function fogUniforms(): Record<string, THREE.IUniform> {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}

const NOISE_GLSL = /* glsl */ `
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
`;

// The moon, shared by the sky and the water's mirror: a disc of `radius`
// radians round uMoonDir, cratered and limb-darkened, its halo and corona.
const MOON_GLSL = /* glsl */ `
const float MOON_R = 0.19;
vec3 moonDisc(vec3 d, vec3 moonDir, out float disc, out float ang) {
  float cosA = dot(d, moonDir);
  ang = acos(clamp(cosA, -1.0, 1.0));
  disc = smoothstep(MOON_R, MOON_R - 0.004, ang);
  vec3 tu = normalize(cross(moonDir, vec3(0.0, 1.0, 0.0)));
  vec3 tv = cross(tu, moonDir);
  vec2 mp = vec2(dot(d, tu), dot(d, tv)) / MOON_R;
  float limb = sqrt(max(0.0, 1.0 - dot(mp, mp)));
  float maria = fbm(mp * 2.6 + 3.0);
  float craters = fbm(mp * 9.0 + 1.7);
  float rims = smoothstep(0.62, 0.7, fbm(mp * 17.0)) * 0.12;
  vec3 c = vec3(0.9, 0.93, 1.0) * (0.58 + 0.42 * limb) * (0.8 + 0.2 * craters + rims);
  c *= mix(0.7, 1.0, smoothstep(0.34, 0.6, maria));
  return c;
}
float moonHalo(float ang) {
  // A tight bloom, a wide glow, and a faint ice corona ring.
  return exp(-ang * 9.0) * 0.55 + exp(-ang * 2.4) * 0.16 + smoothstep(0.05, 0.0, abs(ang - 0.36)) * 0.05;
}
`;

// ---- the night dome -----------------------------------------------------------------

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
${NOISE_GLSL}
${MOON_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  // Violet night: a deep indigo zenith, a violet band, the haze at the horizon,
  // and a silver wash in the moon's quarter of the sky.
  vec3 zenith = vec3(0.012, 0.014, 0.05);
  vec3 band = vec3(0.07, 0.05, 0.14);
  vec3 col = mix(band, zenith, smoothstep(0.04, 0.7, up));
  col = mix(uHorizon * 1.3 + vec3(0.02, 0.02, 0.05), col, smoothstep(-0.02, 0.24, up));
  float toMoon = max(0.0, dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uMoonDir.x, 0.0, uMoonDir.z))));
  col += vec3(0.07, 0.08, 0.14) * pow(max(toMoon, 0.0), 4.0) * (1.0 - smoothstep(0.0, 0.6, up));

  // Stars: a jittered grid, twinkling, thinning toward the horizon and the moon.
  vec3 cell = floor(d * 460.0);
  float h = hash3(cell);
  vec3 jitter = vec3(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 4.1)) - 0.5;
  vec3 starDir = normalize((cell + 0.5 + jitter * 0.8) / 460.0);
  float starD = length(d - starDir) * 460.0;
  float star = smoothstep(0.4, 0.0, starD) * step(0.978, h) * (0.3 + 0.7 * pow(max(hash3(cell + 9.1), 0.0), 3.0));
  float twinkle = 0.55 + 0.45 * sin(uTime * (1.3 + h * 3.0) + h * 40.0);
  float glow;
  float disc;
  float ang;
  vec3 moon = moonDisc(d, uMoonDir, disc, ang);
  star *= smoothstep(0.02, 0.3, up) * twinkle * smoothstep(0.35, 0.8, ang);
  col += vec3(0.82, 0.88, 1.0) * star * 1.7;
  // A faint river of stars arching over the crater.
  float river = fbm(vec2(atan(d.z, d.x) * 2.2 + 1.3, d.y * 3.4) + 5.0);
  col += vec3(0.05, 0.045, 0.1) * smoothstep(0.5, 0.82, river) * smoothstep(0.12, 0.6, up);

  glow = moonHalo(ang);
  col += vec3(0.5, 0.56, 0.82) * glow;

  // Thin silver clouds drifting across the moon, lined where they cross it.
  float cloudMask = 0.0;
  if (up > -0.05 && uClouds > 0.0) {
    vec2 uv = d.xz / (up + 0.2);
    float c1 = fbm(uv * 0.5 + vec2(uTime * 0.005, uTime * 0.002));
    float c2 = fbm(uv * 1.4 - vec2(uTime * 0.009, 0.0) + 11.0);
    float c = smoothstep(0.55, 0.84, c1 * 0.72 + c2 * 0.42) * smoothstep(-0.02, 0.2, up) * uClouds;
    float lining = pow(max(0.0, dot(d, uMoonDir)), 30.0) * 1.3 + pow(max(0.0, dot(d, uMoonDir)), 5.0) * 0.3;
    vec3 cloudCol = mix(vec3(0.05, 0.045, 0.1), vec3(0.62, 0.66, 0.86), lining);
    cloudMask = c;
    col = mix(col, cloudCol, c * 0.7);
  }
  col = mix(col, moon * 1.25, disc * (1.0 - cloudMask * 0.45));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function buildSky(opts: TempleAtmosphereOptions): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    name: 'drownedTempleSky',
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uMoonDir: { value: DROWNED_TEMPLE_MOON_DIRECTION.clone() },
      uHorizon: { value: new THREE.Color(DROWNED_TEMPLE_FOG_COLOR) },
      uClouds: { value: opts.lowGfx ? 0.6 : 1 },
    },
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), material);
  mesh.name = 'drownedTempleSky';
  mesh.frustumCulled = false;
  return mesh;
}

// ---- the lagoon ---------------------------------------------------------------------

const LAGOON_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vLocal;
#include <fog_pars_vertex>
void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const LAGOON_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform sampler2D uShore;
uniform vec4 uShoreRect;
uniform float uDetail;
varying vec3 vWorld;
varying vec3 vLocal;
#include <fog_pars_fragment>
${NOISE_GLSL}
${MOON_GLSL}
vec3 skyAt(vec3 d) {
  float up = max(d.y, 0.0);
  vec3 zenith = vec3(0.012, 0.014, 0.05);
  vec3 band = vec3(0.07, 0.05, 0.14);
  vec3 c = mix(band, zenith, smoothstep(0.04, 0.7, up));
  return mix(uHorizon * 1.3, c, smoothstep(0.0, 0.24, up));
}
void main() {
  // Still water: slow, broad swells and a fine shimmer; calmer far out.
  vec2 p = vWorld.xz;
  float t = uTime;
  float n1 = noise(p * 0.08 + vec2(t * 0.05, t * 0.03));
  float n2 = noise(p * 0.21 - vec2(t * 0.07, -t * 0.04) + 7.0);
  float n3 = noise(p * 0.9 + vec2(t * 0.25, t * 0.17) + 13.0) * uDetail;
  vec2 slope = (vec2(n1, n2) - 0.5) * 0.09 + (vec2(n3, noise(p * 0.9 - t * 0.2 + 3.0)) - 0.5) * 0.05 * uDetail;
  vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
  vec3 view = normalize(cameraPosition - vWorld);
  vec3 r = reflect(-view, n);
  r.y = abs(r.y);
  float fres = 0.04 + 0.96 * pow(max(1.0 - max(0.0, dot(n, view)), 0.0), 5.0);

  // The mirror: the night sky and the moon, broken by the ripples.
  float disc;
  float ang;
  vec3 moon = moonDisc(normalize(r), uMoonDir, disc, ang);
  vec3 refl = skyAt(r) + vec3(0.5, 0.56, 0.82) * moonHalo(ang) * 0.8;
  refl = mix(refl, moon * 1.1, disc);
  // The moon's road: glitter on every ripple facing the moon.
  vec3 halfV = normalize(uMoonDir + view);
  float glint = pow(max(0.0, dot(n, halfV)), 420.0) * 3.5 + pow(max(0.0, dot(n, halfV)), 60.0) * 0.25;

  // The shallows along the pearl walkways: lighter teal, foam, life.
  vec2 suv = (vLocal.xz - uShoreRect.xy) / uShoreRect.zw;
  float shore = texture2D(uShore, suv).r;
  vec3 body = mix(uDeep, uShallow, smoothstep(0.05, 0.9, shore));
  vec3 col = mix(body, refl, clamp(fres * 1.35, 0.0, 1.0)) + vec3(0.8, 0.86, 1.0) * glint;
  // Bioluminescence: a cyan shimmer of motes that swell and fade, thickest in
  // the shallows, and slow ribbons of it out in the lagoon.
  float motes = smoothstep(0.93, 1.0, noise(p * 1.7 + vec2(t * 0.12, -t * 0.09)));
  float pulse = 0.5 + 0.5 * sin(t * 1.3 + hash(floor(p * 1.7)) * 30.0);
  float ribbon = smoothstep(0.7, 0.95, noise(p * 0.05 + vec2(t * 0.01, 0.0))) * smoothstep(0.55, 0.9, noise(p * 0.4 + t * 0.05));
  vec3 life = vec3(0.3, 0.9, 0.88) * (motes * pulse * (0.35 + 0.9 * shore) + ribbon * 0.12);
  col += life * uDetail;
  // A thin ring of foam lapping the stone.
  float lap = smoothstep(0.78, 0.95, shore) * (0.55 + 0.45 * sin(shore * 40.0 - t * 1.2 + noise(p * 0.6) * 6.0));
  col = mix(col, vec3(0.62, 0.7, 0.78), clamp(lap * 0.55, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

let shoreTexture: THREE.DataTexture | null = null;

/** The shared shore mask (built once; the Hydra Pool and the tide read it too). */
export function templeShoreTexture(lowGfx: boolean): THREE.DataTexture {
  if (shoreTexture) return shoreTexture;
  const size = lowGfx ? 192 : 320;
  const mask = planTempleShoreMask(size);
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

function shoreRect(): THREE.Vector4 {
  const b = TEMPLE_SHORE_BOUNDS;
  return new THREE.Vector4(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
}

function buildLagoon(opts: TempleAtmosphereOptions): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1400, 1400, 1, 1).rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    name: 'drownedTempleLagoon',
    vertexShader: LAGOON_VERT,
    fragmentShader: LAGOON_FRAG,
    uniforms: {
      ...fogUniforms(),
      uTime: sharedUniforms.uTime,
      uMoonDir: { value: DROWNED_TEMPLE_MOON_DIRECTION.clone() },
      uHorizon: { value: new THREE.Color(DROWNED_TEMPLE_FOG_COLOR) },
      uDeep: { value: new THREE.Color(0x04101c) },
      uShallow: { value: new THREE.Color(0x1d5a64) },
      uShore: { value: templeShoreTexture(opts.lowGfx) },
      uShoreRect: { value: shoreRect() },
      uDetail: { value: opts.lowGfx ? 0.4 : 1 },
    },
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(0, DROWNED_TEMPLE_WATER_LEVEL, 0);
  mesh.name = 'drownedTempleLagoon';
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- mist on the water ---------------------------------------------------------------

const MIST_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vLocal;
#include <fog_pars_vertex>
void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
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
  vec2 p = vWorld.xz * 0.02 + uLayer * 5.3;
  float t = uTime * (0.012 + uLayer * 0.004);
  float m = fbm(p + vec2(t, t * 0.6)) * 0.65 + fbm(p * 2.2 - vec2(t * 1.4, 0.0)) * 0.35;
  vec2 suv = (vLocal.xz - uShoreRect.xy) / uShoreRect.zw;
  float shore = texture2D(uShore, suv).r;
  // Over open water only: it thins against the walkways so no fight is veiled.
  float a = uAlpha * smoothstep(0.4, 0.82, m) * (1.0 - smoothstep(0.3, 0.75, shore));
  float near = smoothstep(14.0, 50.0, length(cameraPosition - vWorld));
  gl_FragColor = vec4(uColor, a * near);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function buildWaterMist(opts: TempleAtmosphereOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'drownedTempleMist';
  const layers = opts.lowGfx ? [0.7] : [0.5, 1.6, 3.4];
  const geo = new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2);
  layers.forEach((y, i) => {
    const material = new THREE.ShaderMaterial({
      name: 'drownedTempleMist',
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      uniforms: {
        ...fogUniforms(),
        uTime: sharedUniforms.uTime,
        uLayer: { value: i },
        uAlpha: { value: [0.42, 0.3, 0.2][i] ?? 0.3 },
        uColor: { value: new THREE.Color(i === 0 ? 0x9aa6c8 : 0x8490b8) },
        uShore: { value: templeShoreTexture(opts.lowGfx) },
        uShoreRect: { value: shoreRect() },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(0, DROWNED_TEMPLE_WATER_LEVEL + y, 0);
    mesh.renderOrder = 4 + i;
    mesh.name = `drownedTempleMist${i}`;
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  return group;
}

// ---- light-fish ------------------------------------------------------------------------

const FISH_VERT = /* glsl */ `
attribute vec4 aShoal; // cx, cz, radius, seed
attribute vec2 aFish;  // phase, lane
uniform float uTime;
varying vec2 vUv;
varying float vGlow;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  float speed = 0.18 + aShoal.w * 0.12;
  float a = aFish.x * 6.2831853 + uTime * speed * (mod(aFish.y, 2.0) < 1.0 ? 1.0 : -1.0);
  float r = aShoal.z * (0.45 + 0.55 * fract(aFish.y * 0.37 + aShoal.w));
  vec2 c = aShoal.xy + vec2(sin(a), cos(a)) * r + vec2(sin(uTime * 0.3 + aFish.x * 9.0), cos(uTime * 0.23 + aFish.y)) * 0.8;
  // Swim along the circle's tangent.
  vec2 fwd = normalize(vec2(cos(a), -sin(a))) * (mod(aFish.y, 2.0) < 1.0 ? 1.0 : -1.0);
  vec2 side = vec2(-fwd.y, fwd.x);
  vec3 world = vec3(c.x, 0.03, c.y) + vec3(side.x, 0.0, side.y) * position.x * 0.45 + vec3(fwd.x, 0.0, fwd.y) * position.y * 1.2;
  vGlow = 0.6 + 0.4 * sin(uTime * 2.0 + aFish.x * 17.0);
  vec4 mvPosition = viewMatrix * modelMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FISH_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vGlow;
#include <fog_pars_fragment>
void main() {
  vec2 q = vUv - 0.5;
  // A soft teardrop body with a brighter head, seen through the water.
  float body = smoothstep(0.5, 0.0, length(vec2(q.x * 2.2, q.y * (q.y > 0.0 ? 1.4 : 1.0))));
  vec3 col = vec3(0.35, 0.95, 0.92) * body * vGlow;
  gl_FragColor = vec4(col, body * 0.8);
  #include <fog_fragment>
}
`;

function buildFish(opts: TempleAtmosphereOptions): THREE.Mesh | null {
  const shoals = planFishShoals();
  const perShoal = opts.lowGfx ? 0.4 : Math.max(0.5, opts.density);
  const list: { shoal: (typeof shoals)[number]; i: number }[] = [];
  for (const s of shoals) {
    const n = Math.max(3, Math.round(s.count * perShoal));
    for (let i = 0; i < n; i++) list.push({ shoal: s, i });
  }
  if (list.length === 0) return null;
  const base = new THREE.PlaneGeometry(1, 1, 1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const shoal = new Float32Array(list.length * 4);
  const fish = new Float32Array(list.length * 2);
  list.forEach(({ shoal: s, i }, k) => {
    shoal.set([s.x, s.z, s.radius, s.seed], k * 4);
    fish.set([templeHash(k, 3), i + templeHash(k, 5)], k * 2);
  });
  geo.setAttribute('aShoal', new THREE.InstancedBufferAttribute(shoal, 4));
  geo.setAttribute('aFish', new THREE.InstancedBufferAttribute(fish, 2));
  geo.instanceCount = list.length;
  const material = new THREE.ShaderMaterial({
    name: 'drownedTempleFish',
    vertexShader: FISH_VERT,
    fragmentShader: FISH_FRAG,
    uniforms: { ...fogUniforms(), uTime: sharedUniforms.uTime },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'drownedTempleFish';
  mesh.position.y = DROWNED_TEMPLE_WATER_LEVEL;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

/** The whole sky, lagoon, mist and light-fish of the Drowned Temple, instance-local. */
export function buildTempleSkyLagoon(opts: TempleAtmosphereOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'drownedTempleSkyLagoon';
  group.add(buildSky(opts));
  group.add(buildLagoon(opts));
  group.add(buildWaterMist(opts));
  const fish = buildFish(opts);
  if (fish) group.add(fish);
  return group;
}
