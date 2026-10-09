// The Sunken Bastion's storm rain (plan: bastion_rain_core.ts):
//  - streaks: thin camera-facing quads stretched along each drop's velocity
//    (a motion-blurred streak, bright at the head, fading up its tail), each
//    its own speed, length, width and brightness, slanted by the gusting wind,
//    faded out close to the lens and at the box edge;
//  - splashes: a crown of spray and a ripple ring landing on the real floor
//    round the camera (the stones, the puddles, the swell), never on a lip;
//  - sheets: pale curtains of rain standing out at the horizon, drifting and
//    thinning with the gusts.
//
// All motion is shader-side on the shared clock (sharedUniforms.uTime): no
// per-frame JavaScript. Counts shed with the effects tier; everything here is
// cosmetic. Built with the interior group and attached through its compile
// gate (the prewarm home of every material here).

import * as THREE from 'three';
import { SUNKEN_BASTION_SEA_LEVEL } from '../../sim/content/sunken_bastion_layout';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import {
  bastionRainTier,
  packSplashHeights,
  planSplashHeights,
  RAIN_BOX,
  RAIN_GUST_GLSL,
  RAIN_SHUTTER,
  RAIN_SPEED,
  RAIN_WIND,
  SPLASH_HEIGHT_RANGE,
  SPLASH_RADIUS,
} from './bastion_rain_core';
export interface BastionRainOptions {
  lowGfx: boolean;
  /** 0..1 cosmetic density (tier shed). */
  density: number;
}

const HASH_GLSL = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// ---- streaks ---------------------------------------------------------------------------

const STREAK_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec3 aSeed;
attribute vec2 aCorner;
uniform float uTime;
uniform vec3 uBox;
uniform vec2 uWind;
uniform vec2 uSpeed;
uniform vec2 uShutter;
varying float vAlpha;
varying vec2 vUv;
varying float vShade;
${RAIN_GUST_GLSL}
void main() {
  float gust = rainGust(uTime + aSeed.x * 4.0);
  float speed = mix(uSpeed.x, uSpeed.y, aSeed.y);
  vec2 wind = uWind * (0.55 + 0.9 * gust);
  vec3 vel = vec3(wind.x, -speed, wind.y);
  vec3 dir = normalize(vel);
  // Each drop falls through a box that follows the camera, leaning with the wind.
  vec3 p = vec3(aSeed.x * uBox.x, 0.0, aSeed.z * uBox.z);
  float fall = mod(aSeed.y * 97.0 - uTime * speed, uBox.y);
  p.y = fall;
  p.xz += wind * (uBox.y - fall) / speed;
  vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 head = cameraPosition + rel;
  float len = speed * mix(uShutter.x, uShutter.y, fract(aSeed.z * 7.13));
  vec3 toCam = normalize(cameraPosition - head);
  vec3 side = normalize(cross(dir, toCam));
  float dist = length(rel);
  // Thin, a hair wider with distance so far streaks stay a clean pixel.
  float width = (0.009 + fract(aSeed.x * 13.7) * 0.012) * (1.0 + dist * 0.035);
  vec3 world = head - dir * len * aCorner.y + side * width * aCorner.x;
  // Depth fade: a drop right on the lens is a smear, so it vanishes; the box
  // edge dissolves into the distant sheets. Calm spells thin the rain out.
  float nearFade = smoothstep(2.0, 7.0, dist);
  float edge = 1.0 - smoothstep(0.3, 0.5, max(abs(rel.x) / uBox.x, abs(rel.z) / uBox.z));
  float present = step(fract(aSeed.z * 31.1), 0.35 + 0.65 * gust);
  vAlpha = nearFade * edge * present * (0.55 + 0.45 * gust);
  vUv = aCorner;
  vShade = 0.72 + 0.28 * fract(aSeed.y * 17.3);
  gl_Position = projectionMatrix * wocCamRelView(world);
}
`;

const STREAK_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
varying float vAlpha;
varying vec2 vUv;
varying float vShade;
void main() {
  float across = 1.0 - vUv.x * vUv.x;
  // Bright at the head (y 0), fading up the blurred tail (y 1).
  float along = pow(max(1.0 - vUv.y, 0.0), 1.6) * smoothstep(0.0, 0.06, vUv.y + 0.02);
  gl_FragColor = vec4(uColor * vShade, 0.38 * vAlpha * across * along);
  #include <colorspace_fragment>
}
`;

function buildStreaks(count: number): THREE.Mesh {
  const seeds = new Float32Array(count * 4 * 3);
  const corners = new Float32Array(count * 4 * 2);
  const index = new Uint32Array(count * 6);
  let s = 11;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const quad: [number, number][] = [
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ];
  for (let i = 0; i < count; i++) {
    const a = rnd();
    const b = rnd();
    const c = rnd();
    for (let k = 0; k < 4; k++) {
      seeds.set([a, b, c], (i * 4 + k) * 3);
      corners.set(quad[k], (i * 4 + k) * 2);
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 4 * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  const material = new THREE.ShaderMaterial({
    name: 'sunkenBastionRainStreaks',
    vertexShader: STREAK_VERT,
    fragmentShader: STREAK_FRAG,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uBox: { value: new THREE.Vector3(RAIN_BOX.x, RAIN_BOX.y, RAIN_BOX.z) },
      uWind: { value: new THREE.Vector2(RAIN_WIND[0], RAIN_WIND[1]) },
      uSpeed: { value: new THREE.Vector2(RAIN_SPEED.min, RAIN_SPEED.max) },
      uShutter: { value: new THREE.Vector2(RAIN_SHUTTER.min, RAIN_SHUTTER.max) },
      uColor: { value: new THREE.Color(0xc8d6dc) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'sunkenBastionRain';
  mesh.frustumCulled = false;
  mesh.renderOrder = 18;
  return mesh;
}

// ---- splashes ---------------------------------------------------------------------------

const SPLASH_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec3 aSeed;
attribute vec2 aCorner;
attribute float aKind;
uniform float uTime;
uniform float uRadius;
uniform sampler2D uHeights;
uniform vec4 uGrid;
uniform vec2 uHeightRange;
varying float vAlpha;
varying vec2 vUv;
varying float vKind;
${HASH_GLSL}
void main() {
  float rate = 0.9 + aSeed.x * 0.9;
  float c = uTime * rate + aSeed.y * 17.0;
  float cyc = floor(c);
  float ph = fract(c);
  vec2 r2 = vec2(hash(vec2(cyc, aSeed.z * 91.7)), hash(vec2(aSeed.z * 37.3, cyc + 1.7)));
  vec2 center = cameraPosition.xz + (r2 - 0.5) * 2.0 * uRadius;
  // The field is laid out in its slot's frame (the interior group's origin).
  vec2 local = center - modelMatrix[3].xz;
  vec2 uv = (local - uGrid.xy) * uGrid.zw;
  vec4 texel = texture2D(uHeights, uv);
  float h = uHeightRange.x + (texel.r * 65280.0 + texel.g * 255.0) / 65535.0 * uHeightRange.y;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float ok = step(0.5, texel.b) * inside;
  float distFade = 1.0 - smoothstep(uRadius * 0.55, uRadius, length(center - cameraPosition.xz));
  vec3 base = vec3(center.x, h + 0.04, center.y);
  vec3 world;
  if (aKind < 0.5) {
    // The ripple ring: widening and fading on the stone or the water.
    // Eased out: a fast ring that slows as it spreads.
    float grow = 1.0 - (1.0 - ph) * (1.0 - ph);
    float r = 0.05 + grow * (0.22 + aSeed.x * 0.22);
    world = base + vec3(aCorner.x * r, 0.0, aCorner.y * r);
    vAlpha = (1.0 - ph) * (1.0 - ph) * 0.8;
  } else {
    // The crown: spray thrown up in the first third of the cycle.
    float life = clamp(ph * 3.2, 0.0, 1.0);
    vec3 toCam = normalize(cameraPosition - base);
    vec3 side = normalize(vec3(toCam.z, 0.0, -toCam.x));
    float hgt = (0.16 + aSeed.y * 0.16) * (0.4 + 0.6 * life);
    float wid = 0.1 * (0.5 + life);
    world = base + side * aCorner.x * wid + vec3(0.0, (aCorner.y * 0.5 + 0.5) * hgt, 0.0);
    vAlpha = (1.0 - life) * step(ph, 0.32);
  }
  vUv = aCorner;
  vKind = aKind;
  vAlpha *= ok * distFade;
  gl_Position = projectionMatrix * wocCamRelView(world);
}
`;

const SPLASH_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
varying float vAlpha;
varying vec2 vUv;
varying float vKind;
void main() {
  float a;
  if (vKind < 0.5) {
    // A thin outer ring and a fainter inner echo.
    float d = length(vUv);
    float outer = smoothstep(0.8, 0.9, d) * (1.0 - smoothstep(0.92, 1.0, d));
    float inner = smoothstep(0.42, 0.5, d) * (1.0 - smoothstep(0.52, 0.6, d)) * 0.45;
    a = (outer + inner) * 0.34;
  } else {
    // A few droplets thrown up out of the crown (soft dots, not strokes).
    vec2 q = vec2(vUv.x * 1.5, vUv.y * 0.5 + 0.5);
    float drops = 0.0;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      vec2 c = vec2((fk - 1.0) * 0.55, 0.35 + 0.25 * abs(fk - 1.0));
      drops += 1.0 - smoothstep(0.05, 0.14, length(q - c));
    }
    a = drops * 0.45;
  }
  gl_FragColor = vec4(uColor, a * vAlpha);
  #include <colorspace_fragment>
}
`;

function buildSplashes(count: number): THREE.Mesh {
  const grid = planSplashHeights(1);
  const tex = new THREE.DataTexture(packSplashHeights(grid), grid.cols, grid.rows);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const seeds = new Float32Array(count * 8 * 3);
  const corners = new Float32Array(count * 8 * 2);
  const kinds = new Float32Array(count * 8);
  const index = new Uint32Array(count * 12);
  let s = 23;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const quad: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  for (let i = 0; i < count; i++) {
    const a = rnd();
    const b = rnd();
    const c = rnd();
    for (let q = 0; q < 2; q++) {
      for (let k = 0; k < 4; k++) {
        const v = i * 8 + q * 4 + k;
        seeds.set([a, b, c], v * 3);
        corners.set(quad[k], v * 2);
        kinds[v] = q;
      }
      const o = i * 8 + q * 4;
      index.set([o, o + 1, o + 2, o + 1, o + 3, o + 2], i * 12 + q * 6);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 8 * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  const material = new THREE.ShaderMaterial({
    name: 'sunkenBastionRainSplashes',
    vertexShader: SPLASH_VERT,
    fragmentShader: SPLASH_FRAG,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uRadius: { value: SPLASH_RADIUS },
      uHeights: { value: tex },
      uGrid: {
        value: new THREE.Vector4(
          grid.minX - grid.step / 2,
          grid.minZ - grid.step / 2,
          1 / (grid.cols * grid.step),
          1 / (grid.rows * grid.step),
        ),
      },
      uHeightRange: {
        value: new THREE.Vector2(
          SPLASH_HEIGHT_RANGE.min,
          SPLASH_HEIGHT_RANGE.max - SPLASH_HEIGHT_RANGE.min,
        ),
      },
      uColor: { value: new THREE.Color(0xdde8ec) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'sunkenBastionRainSplashes';
  mesh.frustumCulled = false;
  // On the floor, under every telegraph a player must read.
  mesh.renderOrder = floorVfxRenderOrder('ground', 1);
  return mesh;
}

// ---- distant sheets --------------------------------------------------------------------

const SHEET_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec3 aSheet; // bearing, radius, seed
attribute vec2 aCorner; // u across 0..1, v up 0..1
uniform float uTime;
uniform float uSea;
varying vec2 vUv;
varying float vSeed;
varying float vBearing;
${RAIN_GUST_GLSL}
void main() {
  // Each sheet drifts slowly round the camera with the wind.
  float bearing = aSheet.x + uTime * 0.004 * (0.5 + aSheet.z);
  float span = 0.5;
  float a = bearing + (aCorner.x - 0.5) * span;
  float radius = aSheet.y;
  vec3 world = vec3(cameraPosition.x + sin(a) * radius, uSea - 3.0 + aCorner.y * 70.0,
    cameraPosition.z + cos(a) * radius);
  // The top leans down-wind (the rain slants in the gusts).
  float gust = rainGust(uTime + aSheet.z * 9.0);
  world.xz += vec2(0.6, 0.4) * aCorner.y * 18.0 * (0.4 + gust);
  vUv = aCorner;
  vSeed = aSheet.z;
  vBearing = bearing;
  gl_Position = projectionMatrix * wocCamRelView(world);
}
`;

const SHEET_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying float vSeed;
varying float vBearing;
${HASH_GLSL}
${RAIN_GUST_GLSL}
void main() {
  float u = vUv.x * 42.0;
  float v = vUv.y * 70.0;
  // Fine falling streaks inside the sheet.
  float streak = smoothstep(0.55, 0.95, vnoise(vec2(u * 2.2 + v * 0.18, v * 0.05 + uTime * 3.2 + vSeed * 17.0)));
  // The sheet's body: thick patches that come and go.
  float body = smoothstep(0.3, 0.75, vnoise(vec2(vBearing * 4.0 + vUv.x * 2.0, uTime * 0.05 + vSeed * 5.0)));
  float edges = sin(vUv.x * 3.14159) * smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  float gust = rainGust(uTime + vSeed * 9.0);
  float a = (0.08 + 0.16 * streak) * body * edges * (0.45 + 0.55 * gust);
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

function buildSheets(count: number): THREE.Mesh {
  const SEG = 6;
  const verts = count * (SEG + 1) * 2;
  const sheet = new Float32Array(verts * 3);
  const corners = new Float32Array(verts * 2);
  const index: number[] = [];
  let s = 41;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = 0; i < count; i++) {
    const bearing = (i / count) * Math.PI * 2 + rnd() * 0.3;
    const radius = 80 + rnd() * 60;
    const seed = rnd();
    for (let k = 0; k <= SEG; k++) {
      for (let r = 0; r < 2; r++) {
        const v = (i * (SEG + 1) + k) * 2 + r;
        sheet.set([bearing, radius, seed], v * 3);
        corners.set([k / SEG, r], v * 2);
      }
    }
    for (let k = 0; k < SEG; k++) {
      const b = (i * (SEG + 1) + k) * 2;
      index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  geo.setAttribute('aSheet', new THREE.BufferAttribute(sheet, 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
  geo.setIndex(index);
  const material = new THREE.ShaderMaterial({
    name: 'sunkenBastionRainSheets',
    vertexShader: SHEET_VERT,
    fragmentShader: SHEET_FRAG,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uSea: { value: SUNKEN_BASTION_SEA_LEVEL },
      uColor: { value: new THREE.Color(0x9fb0ac) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'sunkenBastionRainSheets';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

/** The whole storm rain of the fortress (streaks, splashes, far sheets). */
export function buildBastionRain(opts: BastionRainOptions): THREE.Group {
  const tier = bastionRainTier(opts.lowGfx, opts.density);
  const group = new THREE.Group();
  group.name = 'sunkenBastionStormRain';
  if (tier.streaks > 0) group.add(buildStreaks(tier.streaks));
  if (tier.splashes > 0) group.add(buildSplashes(tier.splashes));
  if (tier.sheets > 0) group.add(buildSheets(tier.sheets));
  return group;
}
