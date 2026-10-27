// The Smith's Heart's sky, one dome for both areas of the slot:
//   - over the main map, the storm over Stormcrag seen up out of the
//     mountain's fissures: a bruised slate deck racing over the summits, torn
//     so a colder grey shows through, and lightning walking inside the cloud;
//   - over the Heart, the sky seen up out of the chamber inside the mountain:
//     a deep ember-violet night full of slow stars, warm veils drifting where
//     the heart's light catches the high air, no storm at all.
//   - over the Breath (phase 2G), the storm seen from the summit IN it:
//     paler and lower, a rolling deck racing in from the north-west, the
//     key's light breaking through it in a bright rift, lightning walking
//     the cloud and, every few seconds, a bolt standing in the distance.
//   - over the Quench (phase 2H), the sky seen up out of the cold: calm, a
//     pale overcast thinning to a wash of cold blue overhead, high thin
//     veils drifting slow, the low pale sun in the south-east behind them
//     with the ice crystals' ring round it (a 22 degree halo), no storm.
//   - over the Heat (phase 2I), the sky seen up out of the Hearth's fissure:
//     the smoke of the first flame rising and drifting east in slow billows,
//     lit gold from below where the fire catches it, a hazy white-gold sun
//     low in the west behind it, a deep warm slate overhead; never a storm,
//     never a volcano's red.
// `uBreath` blends the storm toward the Breath's as the camera climbs into
// it, `uQuench` toward the Quench's as it sinks, `uHeat` toward the Heat's smoke (both eased like the hop's). `uCore` blends the two (heart_portal_core.ts heartAreaBlend eases it after
// a hop, so the sky turns as the raid arrives). One shader on the dome, no
// light; the horizon is the area's fog colour.
//
// The dome's onBeforeRender is the slot's frame driver: the dome draws every
// frame the interior is shown (never culled), so the gates, the seal, the
// portals and the light-rivers advance from here even while they are off
// screen. It hands the driver the camera (the area, the hop and the wash).

import * as THREE from 'three';
import { SUNKEN_BASTION_FOG_COLOR } from '../fog_scene_state';
import { sharedUniforms } from '../gfx';
import {
  SMITH_HEART_BREATH_FOG,
  SMITH_HEART_HEAT_FOG,
  SMITH_HEART_HEAT_LIGHT,
  SMITH_HEART_QUENCH_FOG,
  SMITH_HEART_QUENCH_LIGHT,
} from './heart_environment';

export interface HeartSkyOptions {
  lowGfx: boolean;
  /** Called once per drawn frame (the interior's frame driver), with the
   *  camera's world position. */
  onFrame: (camera: THREE.Vector3) => void;
}

/** The Heart's horizon: an ember-violet dark (its fog state's colour). */
export const HEART_CORE_FOG_COLOR = 0x1c1424;

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
uniform vec3 uHorizon;
uniform vec3 uCoreHorizon;
uniform float uDetail;
uniform float uCore;
uniform float uBreath;
uniform vec3 uBreathHorizon;
uniform float uQuench;
uniform vec3 uQuenchHorizon;
uniform vec3 uQuenchSun;
uniform float uHeat;
uniform vec3 uHeatHorizon;
uniform vec3 uHeatSun;
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
// One lightning cell: a flash of two or three flickers at a hashed moment
// and bearing inside each cell of the schedule.
float strike(float t, float cell, out float bearing) {
  float k = floor(t / cell);
  float h = hash(vec2(k, 5.3));
  bearing = hash(vec2(k, 2.9));
  float x = t - k * cell - h * (cell - 1.2);
  if (x < 0.0 || x > 0.8) return 0.0;
  float flick = (1.0 - smoothstep(0.0, 0.07, x))
    + step(0.2, x) * (1.0 - smoothstep(0.2, 0.3, x)) * 0.7;
  return flick * step(0.3, hash(vec2(k, 8.1)));
}
vec3 stormSky(vec3 d, float up) {
  // Slate overhead, a colder grey band, the fog at the rim (linear values).
  vec3 zenith = vec3(0.02, 0.024, 0.032);
  vec3 band = vec3(0.07, 0.078, 0.09);
  vec3 col = mix(band, zenith, smoothstep(0.08, 0.75, up));
  col = mix(uHorizon, col, smoothstep(-0.03, 0.22, up));
  float cloud = 0.0;
  float rim = 0.0;
  if (up > -0.08) {
    vec2 uv = d.xz / (up + 0.18);
    vec2 wind = vec2(uTime * 0.016, -uTime * 0.009);
    vec2 warp = vec2(fbm(uv * 0.32 + 2.0 + wind), fbm(uv * 0.32 - 5.0 - wind)) * 1.5;
    float c1 = fbm(uv * 0.45 + warp + wind * 1.4);
    float c2 = fbm(uv * 1.2 - warp * 0.5 + wind * 2.6 + 9.0);
    float c = c1 * 0.7 + c2 * 0.4 * uDetail;
    cloud = smoothstep(0.4, 0.74, c) * smoothstep(-0.06, 0.12, up);
    rim = smoothstep(0.52, 0.42, c) * smoothstep(0.36, 0.44, c);
  }
  vec3 belly = vec3(0.018, 0.02, 0.026);
  vec3 lifted = vec3(0.1, 0.105, 0.115);
  vec3 cloudCol = mix(belly, lifted, smoothstep(0.0, 0.7, up + 0.25));
  col = mix(col, cloudCol, cloud * 0.92);
  col += vec3(0.05, 0.055, 0.065) * rim;
  float ba; float bb;
  float fa = strike(uTime, 8.0, ba);
  float fb = strike(uTime + 3.7, 11.0, bb);
  float azim = atan(d.x, d.z) / 6.2831853 + 0.5;
  float nearA = 1.0 - smoothstep(0.0, 0.08, abs(azim - ba));
  float nearB = 1.0 - smoothstep(0.0, 0.07, abs(azim - bb));
  float lit = (fa * nearA + fb * nearB) * smoothstep(-0.02, 0.1, up);
  col += vec3(0.42, 0.48, 0.66) * lit * (0.35 + 0.9 * cloud);
  return col;
}
// A distant bolt: a jagged thread standing from the cloud base toward the
// horizon at a hashed bearing, a flicker or two (cell seconds apart).
float bolt(vec3 d, float up, float t, float cell, float seed) {
  float k = floor(t / cell);
  float h = hash(vec2(k, seed));
  float x = t - k * cell - h * (cell - 1.0);
  if (x < 0.0 || x > 0.45) return 0.0;
  float flick = (1.0 - smoothstep(0.0, 0.06, x)) + step(0.14, x) * (1.0 - smoothstep(0.14, 0.24, x)) * 0.8;
  float bearing = hash(vec2(k, seed + 3.1));
  float azim = atan(d.x, d.z) / 6.2831853 + 0.5;
  float top = 0.16 + 0.14 * hash(vec2(k, seed + 7.7));
  float along = clamp(up / top, 0.0, 1.0);
  float wander = (noise(vec2(up * 38.0, k * 3.7)) - 0.5) * 0.022 + (noise(vec2(up * 9.0, k)) - 0.5) * 0.03;
  float off = abs(azim - bearing - wander * (0.4 + along));
  float core = 1.0 - smoothstep(0.0, 0.0016, off);
  float glow = 1.0 - smoothstep(0.0, 0.012, off);
  float span = step(-0.02, up) * step(up, top);
  return (core * 2.2 + glow * 0.45) * span * flick;
}
vec3 breathSky(vec3 d, float up) {
  // The summit in the storm: a slate zenith, a pale cold band low down.
  vec3 zenith = vec3(0.05, 0.058, 0.07);
  vec3 band = vec3(0.17, 0.19, 0.22);
  vec3 col = mix(band, zenith, smoothstep(0.05, 0.7, up));
  col = mix(uBreathHorizon, col, smoothstep(-0.03, 0.18, up));
  float cloud = 0.0;
  float lit = 0.0;
  if (up > -0.08) {
    vec2 uv = d.xz / (up + 0.14);
    // The deck races in from the north-west, rolling as it comes.
    vec2 wind = vec2(uTime * 0.034, -uTime * 0.03);
    vec2 warp = vec2(fbm(uv * 0.28 + 4.0 + wind * 0.6), fbm(uv * 0.28 - 2.0 - wind * 0.6)) * 1.8;
    float c1 = fbm(uv * 0.38 + warp + wind);
    float c2 = fbm(uv * 1.1 - warp * 0.4 + wind * 2.2 + 3.0);
    float c = c1 * 0.72 + c2 * 0.38 * uDetail;
    cloud = smoothstep(0.36, 0.7, c) * smoothstep(-0.06, 0.1, up);
    lit = smoothstep(0.55, 0.8, c1 + 0.12) * (1.0 - smoothstep(0.62, 0.9, c));
  }
  vec3 belly = vec3(0.07, 0.08, 0.095);
  vec3 top = vec3(0.3, 0.33, 0.37);
  col = mix(col, mix(belly, top, lit), cloud * 0.94);
  // The rift where the key breaks through (north-west, high).
  vec3 key = normalize(vec3(-0.42, 0.8, 0.43));
  float rift = pow(max(0.0, dot(d, key)), 6.0) * (1.0 - cloud * 0.6);
  col += vec3(0.42, 0.5, 0.54) * rift * 0.7;
  // Lightning in the cloud, and the distant bolts below it.
  float ba; float bb;
  float fa = strike(uTime, 5.0, ba);
  float fb = strike(uTime + 2.3, 7.0, bb);
  float azim = atan(d.x, d.z) / 6.2831853 + 0.5;
  float nearA = 1.0 - smoothstep(0.0, 0.09, abs(azim - ba));
  float nearB = 1.0 - smoothstep(0.0, 0.08, abs(azim - bb));
  float flash = (fa * nearA + fb * nearB) * smoothstep(-0.02, 0.1, up);
  col += vec3(0.5, 0.66, 0.78) * flash * (0.3 + 1.0 * cloud);
  float bolts = bolt(d, up, uTime, 6.0, 1.7) + bolt(d, up, uTime + 3.1, 9.0, 4.3) * uDetail;
  col += vec3(0.72, 0.9, 1.0) * bolts;
  return col;
}
vec3 quenchSky(vec3 d, float up) {
  // A calm cold sky: the pale mist at the rim, a pale overcast band, a wash
  // of cold blue overhead (linear values).
  vec3 zenith = vec3(0.16, 0.22, 0.31);
  vec3 band = vec3(0.34, 0.39, 0.45);
  vec3 col = mix(band, zenith, smoothstep(0.06, 0.8, up));
  col = mix(uQuenchHorizon, col, smoothstep(-0.03, 0.24, up));
  if (up > -0.05) {
    vec2 uv = d.xz / (up + 0.22);
    // High thin veils drifting slow (never a storm deck).
    vec2 drift = vec2(uTime * 0.004, uTime * 0.0025);
    float v1 = fbm(uv * 0.22 + drift + 7.0);
    float v2 = fbm(uv * 0.7 - drift * 1.6 + 2.0);
    float veil = smoothstep(0.46, 0.78, v1 * 0.75 + v2 * 0.35 * uDetail) * smoothstep(-0.04, 0.18, up);
    col = mix(col, vec3(0.44, 0.48, 0.53), veil * 0.55);
    // Streaks of cirrus, long and thin across the sky.
    float cirrus = smoothstep(0.62, 0.8, fbm(vec2(uv.x * 0.18 + uv.y * 0.05, uv.y * 1.4) + drift * 2.0));
    col += vec3(0.05, 0.055, 0.06) * cirrus * uDetail * smoothstep(0.1, 0.5, up);
  }
  // The low pale sun behind the veil, and the ice crystals' ring round it.
  float a = acos(clamp(dot(d, uQuenchSun), -1.0, 1.0));
  col += vec3(0.62, 0.66, 0.7) * exp(-a * a * 90.0) * 1.2;
  col += vec3(0.24, 0.27, 0.31) * exp(-a * 5.0) * 0.5;
  float off = (a - 0.384) * 34.0;
  float ring = exp(-off * off);
  col += vec3(0.13, 0.15, 0.18) * ring * (0.75 + 0.25 * sin(atan(d.x, d.z) * 3.0));
  return col;
}
vec3 heatSky(vec3 d, float up) {
  // The smoke over the Hearth: a warm smoke-grey band low, a deep warm
  // slate overhead, the fog at the rim (linear values).
  vec3 zenith = vec3(0.045, 0.04, 0.043);
  vec3 band = vec3(0.22, 0.185, 0.16);
  vec3 col = mix(band, zenith, smoothstep(0.04, 0.78, up));
  col = mix(uHeatHorizon, col, smoothstep(-0.03, 0.22, up));
  if (up > -0.06) {
    vec2 uv = d.xz / (up + 0.2);
    // Billows of smoke climbing out of the fissure and drifting east (their
    // pattern runs up the sky and leans with the wind), slow.
    vec2 drift = vec2(uTime * 0.011, uTime * 0.003);
    float s1 = fbm(uv * 0.28 + drift - vec2(0.0, uTime * 0.008));
    float s2 = fbm(uv * 0.85 - drift * 1.6 + 3.0);
    float smoke = smoothstep(0.42, 0.78, s1 * 0.72 + s2 * 0.36 * uDetail) * smoothstep(-0.05, 0.16, up);
    // Lit gold from below near the rim, where the fire catches it.
    vec3 smokeLit = mix(vec3(0.15, 0.125, 0.11), vec3(0.4, 0.29, 0.17), 1.0 - smoothstep(0.0, 0.42, up));
    col = mix(col, smokeLit, smoke * 0.78);
    // Thinner veils high up, catching a little warm light.
    float veil = smoothstep(0.55, 0.85, fbm(uv * 0.12 + drift * 0.5 + 7.0));
    col += vec3(0.04, 0.03, 0.02) * veil * smoothstep(0.2, 0.7, up) * uDetail;
  }
  // The low sun in the west behind the smoke: a soft hazy disc, a broad glow.
  float a = acos(clamp(dot(d, uHeatSun), -1.0, 1.0));
  col += vec3(0.86, 0.62, 0.32) * exp(-a * a * 40.0) * 0.7;
  col += vec3(0.3, 0.19, 0.09) * exp(-a * 3.4) * 0.6;
  return col;
}
vec3 coreSky(vec3 d, float up) {
  // Ember-violet night: warm low (the heart's light on the high air), deep
  // violet-black overhead.
  vec3 zenith = vec3(0.006, 0.004, 0.014);
  vec3 low = vec3(0.07, 0.03, 0.03);
  vec3 col = mix(low, zenith, smoothstep(0.02, 0.7, up));
  col = mix(uCoreHorizon, col, smoothstep(-0.05, 0.2, up));
  if (up > 0.0) {
    vec2 sp = d.xz / (up + 0.2);
    // Stars in three sizes, slow twinkle.
    for (int k = 0; k < 3; k++) {
      float sc = 26.0 + float(k) * 31.0;
      vec2 cell = floor(sp * sc + float(k) * 17.0);
      vec2 f = fract(sp * sc + float(k) * 17.0) - 0.5;
      float h = hash(cell);
      float star = step(0.986 - float(k) * 0.004, h) * smoothstep(0.16 - float(k) * 0.03, 0.0, length(f));
      float tw = 0.55 + 0.45 * sin(uTime * (0.8 + h * 2.5) + h * 40.0);
      col += mix(vec3(1.0, 0.86, 0.7), vec3(0.75, 0.82, 1.0), hash(cell + 3.7)) * star * tw * (1.3 - float(k) * 0.35) * smoothstep(0.04, 0.35, up);
    }
    // Warm veils drifting where the heart's light catches the air.
    vec2 vv = sp * 0.55 + vec2(uTime * 0.006, -uTime * 0.004);
    float veil = fbm(vv + fbm(vv * 1.7) * 0.8);
    col += vec3(0.32, 0.12, 0.05) * smoothstep(0.52, 0.85, veil) * (1.0 - smoothstep(0.1, 0.8, up)) * uDetail;
    col += vec3(0.08, 0.04, 0.12) * smoothstep(0.6, 0.9, fbm(vv * 0.6 + 4.0)) * smoothstep(0.2, 0.9, up);
  }
  return col;
}
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  vec3 col = vec3(0.0);
  if (uCore < 0.999) {
    col = uBreath < 0.999 && uQuench < 0.999 && uHeat < 0.999 ? stormSky(d, up) : vec3(0.0);
    if (uBreath > 0.001) col = mix(col, breathSky(d, up), uBreath);
    if (uQuench > 0.001) col = mix(col, quenchSky(d, up), uQuench);
    if (uHeat > 0.001) col = mix(col, heatSky(d, up), uHeat);
  }
  if (uCore > 0.001) col = mix(col, coreSky(d, up), uCore);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export interface HeartSky {
  mesh: THREE.Mesh;
  /** Blend the dome toward the Heart's sky (0 the storm, 1 the Heart). */
  setCore(k: number): void;
  /** Blend the main map's storm toward the Breath's summit storm. */
  setBreath(k: number): void;
  /** Blend the main map's storm toward the Quench's calm cold sky. */
  setQuench(k: number): void;
  /** Blend the main map's storm toward the Heat's smoke over the Hearth. */
  setHeat(k: number): void;
}

/** The dome (and the slot's frame driver). */
export function buildHeartSky(opts: HeartSkyOptions): HeartSky {
  const material = new THREE.ShaderMaterial({
    name: 'smithHeartSky',
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uHorizon: { value: new THREE.Color(SUNKEN_BASTION_FOG_COLOR) },
      uCoreHorizon: { value: new THREE.Color(HEART_CORE_FOG_COLOR) },
      uDetail: { value: opts.lowGfx ? 0.4 : 1 },
      uCore: { value: 0 },
      uBreath: { value: 0 },
      uBreathHorizon: { value: new THREE.Color(SMITH_HEART_BREATH_FOG.color) },
      uQuench: { value: 0 },
      uQuenchHorizon: { value: new THREE.Color(SMITH_HEART_QUENCH_FOG.color) },
      uQuenchSun: {
        value: new THREE.Vector3(...SMITH_HEART_QUENCH_LIGHT.keyDirection).normalize(),
      },
      uHeat: { value: 0 },
      uHeatHorizon: { value: new THREE.Color(SMITH_HEART_HEAT_FOG.color) },
      uHeatSun: {
        value: new THREE.Vector3(...SMITH_HEART_HEAT_LIGHT.keyDirection).normalize(),
      },
    },
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), material);
  mesh.name = 'smithHeartSky';
  mesh.frustumCulled = false;
  // Once per frame (a hook also fires for shadow passes; the dome casts none).
  let stamp = -1;
  const camera = new THREE.Vector3();
  mesh.onBeforeRender = (_renderer, _scene, cam) => {
    const now = sharedUniforms.uTime.value;
    if (now === stamp) return;
    stamp = now;
    cam.getWorldPosition(camera);
    opts.onFrame(camera);
  };
  let core = -1;
  let breath = -1;
  let quench = -1;
  let heat = -1;
  return {
    mesh,
    setHeat(k) {
      const q = Math.round(k * 200) / 200;
      if (q === heat) return;
      heat = q;
      material.uniforms.uHeat.value = q;
    },
    setQuench(k) {
      const q = Math.round(k * 200) / 200;
      if (q === quench) return;
      quench = q;
      material.uniforms.uQuench.value = q;
    },
    setBreath(k) {
      const q = Math.round(k * 200) / 200;
      if (q === breath) return;
      breath = q;
      material.uniforms.uBreath.value = q;
    },
    setCore(k) {
      const q = Math.round(k * 200) / 200;
      if (q === core) return;
      core = q;
      material.uniforms.uCore.value = q;
    },
  };
}
