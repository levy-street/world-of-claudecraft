// The ring crystal's one material (ring_crystal.ts): the painting on the Tripo model, lit
// by the seal's state, unlit by the world (the crystal is the light; no scene light, so
// no program depends on the light census). Every vertex carries its element weights
// (`_weights`: hammer, breath, quench, heat; the white-gold heart is what is left of 1) and
// its path (`_path`: 0 at the plinth's rim where its element's river arrives, 1 at the far
// tips of that element's crystals):
//   dark       smoky crystal, the painting at a fraction of its value, a breath of its
//              element's colour at the rim;
//   climbing   an element's light flows in at the plinth's rim and runs out along its own
//              crystals behind a white-hot front (`uFill` per element, 0 dark to 1 at the
//              tips), the painting at full and over, the facets and the brightest texels in
//              the element's colour;
//   the heart  the white-gold shaft glows with the four (`uCrown`);
//   ready      the whole crystal swells and pulses white-gold (`uReady`);
//   the burst  the overload before the shatter whitens it (`uCharge`).
// Built once per slot with the interior (hidden carriers link it; the painting uploads
// with the gate). Opaque, drawn on every tier (it is the raid's progress and the way).

import * as THREE from 'three';
import { SMITH_HEART_VEIN_COLORS, SMITH_HEART_VEINS } from '../../sim/content/smith_heart_layout';
import { sharedUniforms } from '../gfx';

const VERT = /* glsl */ `
attribute vec4 _weights;
attribute float _path;
varying vec2 vUv;
varying vec4 vW;
varying float vPath;
varying float vRim;
void main() {
  vUv = uv;
  vW = _weights;
  vPath = _path;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vRim = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec4 uFill;
uniform vec4 uLevel;
uniform float uCrown;
uniform float uReady;
uniform float uCharge;
uniform float uTime;
uniform vec3 uColors[4];
varying vec2 vUv;
varying vec4 vW;
varying float vPath;
varying float vRim;
void main() {
  vec3 painted = texture2D(uMap, vUv).rgb;
  float lum = dot(painted, vec3(0.299, 0.587, 0.114));
  float wsum = clamp(dot(vW, vec4(1.0)), 0.0, 1.0);
  float crownW = 1.0 - wsum;
  vec3 qCol = (uColors[0] * vW.x + uColors[1] * vW.y + uColors[2] * vW.z + uColors[3] * vW.w) / max(wsum, 0.001);
  qCol = mix(vec3(1.0, 0.93, 0.74), qCol, wsum);
  float rim = pow(max(1.0 - vRim, 0.0), 2.0);

  // How far along its element's crystals the light has run (from the plinth's rim out to
  // the tips), and the hot front of each run.
  vec4 pv = vec4(vPath);
  vec4 on = step(vec4(0.0001), uFill);
  vec4 reach = (vec4(1.0) - smoothstep(uFill - 0.05, uFill + 0.05, pv)) * on;
  vec4 front = smoothstep(vec4(0.09), vec4(0.0), abs(pv - uFill)) * on * (vec4(1.0) - step(vec4(0.999), uFill));
  float glow = dot(vW, reach * uLevel) + crownW * uCrown;
  float lit = clamp(dot(vW, reach) + crownW * clamp(uCrown, 0.0, 1.0), 0.0, 1.0);
  float edge = dot(vW, front);

  vec3 dormant = mix(vec3(lum), painted, 0.22) * vec3(0.3, 0.32, 0.38) + qCol * rim * 0.05;
  float pulse = 0.9 + 0.1 * sin(uTime * 1.7 - vPath * 7.0);
  vec3 burn = painted * (0.85 + 0.55 * glow) * pulse + qCol * (rim * 0.8 + pow(lum, 3.0) * 0.55) * glow;
  vec3 col = mix(dormant, burn, lit);
  col += mix(qCol, vec3(1.0, 0.96, 0.88), 0.7) * edge * 1.5;
  float swell = uReady * (0.55 + 0.45 * sin(uTime * 2.6 - vPath * 4.0));
  col += vec3(1.0, 0.9, 0.62) * swell * (0.16 + 0.55 * rim + 0.5 * lum * lum);
  col = mix(col, vec3(1.0, 0.97, 0.9) * 2.2, uCharge * (0.35 + 0.5 * rim));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** The crystal's material over its painting. */
export function ringCrystalMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'smithHeartRingCrystal',
    fog: false,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: map },
      uFill: { value: new THREE.Vector4() },
      uLevel: { value: new THREE.Vector4() },
      uCrown: { value: 0 },
      uReady: { value: 0 },
      uCharge: { value: 0 },
      uTime: sharedUniforms.uTime,
      uColors: {
        value: SMITH_HEART_VEINS.map((v) => new THREE.Color(SMITH_HEART_VEIN_COLORS[v])),
      },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}
