// The Gravewyrm Sanctum's sky: a clear polar dusk at the blue hour (design
// section 8). A deep blue zenith, the first stars, a band of afterglow lying
// low behind the western peaks, and the AURORA: shard-light rising from the
// glacier in the north in slow curtains, rose-gold at its roots, teal through
// its folds, violet at its crowns, beating with the Wyrm's heart and
// brightening as the Calving Face cracks (SANCTUM_SHARD_UNIFORMS, written by
// the face's driver). One shader on the dome, no light: the aurora reaches the
// scene only as a faint wash on the snow of the peaks (a colour write on the
// mountains' material). No rain, no snowstorm, no sea.
//
// The dome's onBeforeRender is the Sanctum's frame driver: the dome draws
// every frame the interior is shown (never culled), so the face's story, the
// chains and the shard's light all advance from here even while the face is
// off screen.

import * as THREE from 'three';
import { GRAVEWYRM_SANCTUM_FOG_COLOR } from '../fog_scene_state';
import { sharedUniforms } from '../gfx';
import { SANCTUM_SHARD_UNIFORMS } from './sanctum_face';
import { SANCTUM_AFTERGLOW_DIRECTION } from './sanctum_plan_core';

export interface SanctumSkyOptions {
  lowGfx: boolean;
  /** The effects tier's density (the aurora's march thins below 1). */
  density: number;
  /** Called once per drawn frame (the interior's frame driver). */
  onFrame: () => void;
}

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
uniform float uAurora;
uniform float uBeat;
uniform vec3 uHorizon;
uniform vec3 uAfterglow;
uniform float uSteps;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { s += noise(p) * a; p *= 2.03; a *= 0.5; }
  return s;
}
// The curtains on one layer of the sky: three long folded ribbons lying
// east to west over the glacier (north, +z), each a sheet of fine vertical
// rays with a soft luminous haze round it. az is the bearing (the rays run
// straight up the sky at a bearing, never fanning to the zenith); north is
// how far north the layer point lies. Never a repeating pattern.
float curtains(float az, float north, float t) {
  float s = 0.0;
  float u = az * 640.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float root = 560.0 + fk * 420.0;
    float fold = sin(u * (0.0042 - fk * 0.0007) + fk * 2.3 + t * (0.9 + fk * 0.3)) * (110.0 + fk * 50.0)
      + sin(u * 0.012 + fk * 5.1 - t * 1.7) * 30.0
      + (fbm(vec2(u * 0.0022 + fk * 7.0, t * 0.8)) - 0.5) * 260.0;
    float off = north - root - fold;
    float w = 40.0 + fk * 22.0;
    float sheet = exp(-(off * off) / (w * w));
    float haze = exp(-(off * off) / (w * w * 10.0)) * 0.2;
    // Fine vertical rays drifting along the fold.
    float rays = 0.3 + 0.7 * pow(max(noise(vec2(u * 0.09 + fk * 13.0 - t * 5.0, fk * 3.0)), 0.0), 1.5);
    // The ribbon fades out along its length (no endless band).
    float span = smoothstep(1.3, 0.35, abs(az + (fk - 1.0) * 0.35));
    s += (sheet * rays + haze) * span * (1.0 - fk * 0.18);
  }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -0.25, 1.0);
  // The blue hour: deep ultramarine overhead, a paler cold blue toward the
  // horizon, the haze itself at the rim.
  vec3 zenith = vec3(0.006, 0.014, 0.05);
  vec3 mid = vec3(0.03, 0.065, 0.16);
  vec3 col = mix(uHorizon, mid, smoothstep(0.0, 0.22, up));
  col = mix(col, zenith, smoothstep(0.18, 0.85, up));
  // The afterglow: a warm band low in the west, rose above amber, fading up
  // through a lilac into the blue.
  vec2 h2 = normalize(d.xz + vec2(1e-5));
  float west = max(0.0, dot(h2, normalize(uAfterglow.xz)));
  float band = pow(max(west, 0.0), 3.0) * exp(-max(0.0, up - 0.01) * 9.0);
  col += uAfterglow * band * 1.25;
  col += vec3(0.18, 0.07, 0.16) * pow(max(west, 0.0), 2.0) * exp(-max(0.0, up) * 3.5) * 0.45;
  // Stars: hashed points on the dome, more of them overhead and in the east,
  // gone where the afterglow and the aurora are bright.
  vec3 cell = floor(d * 230.0);
  float star = step(0.9975, hash3(cell));
  vec3 f = fract(d * 230.0) - 0.5;
  float core = smoothstep(0.32, 0.0, length(f));
  float tw = 0.65 + 0.35 * sin(uTime * (1.5 + hash3(cell + 3.0) * 3.0) + hash3(cell) * 40.0);
  float starVis = smoothstep(0.08, 0.5, up) * (1.0 - band * 4.0);
  col += vec3(0.75, 0.82, 1.0) * star * core * tw * starVis * (0.6 + hash3(cell + 7.0) * 1.2);
  // A faint milky band of dust across the zenith.
  float milky = fbm(vec2(atan(d.x, d.z) * 3.0, d.y * 6.0)) * smoothstep(0.3, 0.9, up);
  col += vec3(0.05, 0.06, 0.1) * milky * 0.25;
  // The aurora: march up through its curtains' layers (their roots low over
  // the glacier, their crowns high overhead, drifting south as they rise).
  vec3 aur = vec3(0.0);
  if (d.y > 0.004) {
    float t = uTime * 0.01;
    float steps = uSteps;
    for (int i = 0; i < 14; i++) {
      float fi = float(i);
      if (fi >= steps) break;
      float hgt = (fi + 0.5) / steps;
      // The curtains hang from about 260 to 900 up over the glacier.
      float layer = 260.0 + hgt * 640.0;
      float north = d.z / d.y * layer;
      float c = curtains(atan(d.x, d.z), north, t);
      // Rose-gold roots, teal folds, violet crowns.
      vec3 tint = mix(vec3(0.95, 0.55, 0.3), vec3(0.12, 0.8, 0.56), smoothstep(0.0, 0.32, hgt));
      tint = mix(tint, vec3(0.42, 0.24, 0.85), smoothstep(0.5, 1.0, hgt));
      // Brightest at the roots, thinning toward the crowns.
      aur += tint * c * (1.15 - hgt * 0.75) / steps;
    }
    // It beats with the heart: a breath through the whole display.
    aur *= uAurora * (0.78 + 0.3 * uBeat) * 1.6 * smoothstep(0.004, 0.06, d.y);
  }
  col += aur;
  // Under the horizon: the haze (the peaks stand in front of it anyway).
  col = mix(col, uHorizon, smoothstep(0.02, -0.12, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** The dome (and the Sanctum's frame driver). */
export function buildSanctumSky(opts: SanctumSkyOptions): THREE.Mesh {
  const glow = new THREE.Color(0.95, 0.42, 0.2);
  const dir = SANCTUM_AFTERGLOW_DIRECTION;
  const uniforms = {
    uTime: sharedUniforms.uTime,
    uAurora: SANCTUM_SHARD_UNIFORMS.uAurora,
    uBeat: SANCTUM_SHARD_UNIFORMS.uBeat,
    uHorizon: { value: new THREE.Color(GRAVEWYRM_SANCTUM_FOG_COLOR) },
    uAfterglow: { value: new THREE.Vector3(glow.r * 0.55, glow.g * 0.55, glow.b * 0.55) },
    uSteps: { value: opts.lowGfx ? 5 : opts.density >= 1 ? 12 : 8 },
  };
  // The afterglow's bearing rides on the uniform's x/z (its colour is the
  // length): carry the direction in a second vector.
  uniforms.uAfterglow.value.set(glow.r * 0.55, glow.g * 0.55, glow.b * 0.55);
  const material = new THREE.ShaderMaterial({
    name: 'gravewyrmSanctumSky',
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG.replace(
      'normalize(uAfterglow.xz)',
      `normalize(vec2(${dir[0].toFixed(4)}, ${dir[2].toFixed(4)}))`,
    ),
    uniforms,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), material);
  mesh.name = 'gravewyrmSanctumSky';
  mesh.frustumCulled = false;
  // Drawn after the opaque world (its depth sits on the far plane): every
  // pixel the cirque covers is rejected before the aurora's march runs.
  mesh.renderOrder = 1000;
  mesh.onBeforeRender = () => {
    opts.onFrame();
  };
  return mesh;
}
