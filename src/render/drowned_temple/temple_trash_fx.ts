// The Drowned Temple's trash mechanics pass effects, composed by temple_fx.ts;
// the plan (every radius, beat and look) is temple_trash_fx_core.ts:
//  - Shrine Vigil: a luminous moon-pearl bubble round the protected singer
//    (nacre scales, crescent moons round its belt, light running down it),
//    brighter the more pilgrims kneel, and a thread of light from each praying
//    pilgrim's shrine to her, pulses running along it toward her: "she is
//    protected, kill the pilgrims". When the ward falls, the bubble cracks,
//    flashes and bursts into pearl shards;
//  - Moonset Oath (heroic): a braided nacre chain from the guard to the
//    singer it shelters and a scallop-shell shield glyph over her head; both
//    draw taut and redden as the guard nears the oath's reach;
//  - Lullaby Echo (heroic): a control ring of the echo's reach round the
//    sleeper, filling to each beat, and on each beat a pink and silver wave
//    of sleep running out to its edge with drifting motes;
//  - Prism Glare: while its bar fills, a great rainbow eye over the lurker
//    whose lids part and iris widens with the bar, its stalks blazing, and a
//    prismatic rim at the gaze's reach; at landing the eye flares, a prism
//    ring races out to the reach and rainbow light bursts; a dazzled player
//    trails rainbow motes round the head, and the LOCAL player sees a
//    prismatic edge veil (temple_dazzle_veil.ts);
//  - Spiral Whirlpool: a spinning vortex out to the pull's reach (spiral arms
//    of foam flowing inward at the pull's pace, a crisp rim at its edge), the
//    biting core in the danger colour filling to each bite, spray wheeling
//    round the shell;
//  - Arcing Spark: lightning crackling on the eel's jaws while it charges,
//    then branching arcs leaping hop to hop in chain order with impact sparks;
//  - Tidewisp: a frost crust round a chilled player's legs, melting with the
//    chill; a swollen wisp wrapped in a larger shell of moon-water with a
//    brighter core, its wider burst ring on the floor round it; each merge a
//    streak of moon-water flowing into the survivor; every burst a wave of
//    moon-water out to its true radius.
//
// Rules (src/render/CLAUDE.md): everything built once here under the gated
// temple root (the floor rings are the shared kit's slots), idle pieces
// hidden once the gate has linked them, the layer hidden while nothing shows;
// no lights; the frame path reuses one scratch particle spec and one floor
// paint, and reads auras by loop (the 10 Hz scan claims slots with small
// closures, as temple_fx.ts's own scan does). The actionable reads (the bubble and its threads, the
// oath, the rings, the eye and its rim, the vortex and its core, the arcs)
// draw on every tier; only the particles thin on the low tier. Reduced
// motion holds the flashes down, keeps the veil still and skips the camera.
// State is read off IWorld only (entity auras with their value and source,
// the cast bar, spellfx), so offline and online look the same.

import * as THREE from 'three';
import {
  TEMPLE_ARCING_SPARK,
  TEMPLE_LULLABY_ECHO,
  TEMPLE_MOONSET_OATH,
  TEMPLE_OATH_KEEPER,
  TEMPLE_PRISM_DAZZLE,
  TEMPLE_PRISM_GLARE,
  TEMPLE_SHRINE_VIGIL,
  TEMPLE_SPIRAL_WHIRLPOOL,
  TEMPLE_SWOLLEN_TIDE,
  TEMPLE_TIDEWISP_CHILL,
  TEMPLE_VIGIL_PRAYER,
} from '../../sim/mob/trash_kit/temple_cast_ids';
import type { Aura, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import type { TelegraphFan, TelegraphKit } from '../floor_telegraph';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  DUST_FRAG,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
  type ParticleSpec,
} from '../hollow_crypt/crypt_fx_particles';
import { TempleDazzleVeil } from './temple_dazzle_veil';
import {
  chillCrust,
  dazzleVeil,
  echoRingFill,
  eelJawUp,
  GAZE_EYE_SIZE,
  GAZE_FLASH_SECONDS,
  gazeEyeLook,
  gazeEyeUp,
  idHue,
  oathTension,
  pilgrimShrineUp,
  SPARK_ARC_SECONDS,
  SPARK_HOP_STAGGER,
  sparkArcLook,
  sparkHopIndex,
  TEMPLE_TRASH_ACCENTS,
  TEMPLE_TRASH_IDS,
  templeBodyHeight,
  templeTrashCue,
  templeTrashNumbers,
  templeZoneSpecs,
  trashWave,
  VIGIL_SHATTER_SECONDS,
  vigilBubble,
  vigilBubbleLook,
  vigilShatter,
  whirlCoreFill,
  whirlpoolLook,
  wispBurstRadius,
  wispCoreUp,
  wispSwellLook,
} from './temple_trash_fx_core';

const SCAN_SEC = 0.1;
const BUBBLES = 4;
const PRAYERS = 10;
const OATHS = 4;
const EYES = 3;
const WAVES = 8;
const VORTICES = 3;
const BOLTS = 8;
const SWELLS = 3;
const CRUSTS = 8;
const ECHO_RINGS = 3;
const WISPS = 12;
const DAZZLED = 10;
const RIBBON_STATIONS = 24;

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
`;

const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A camera-facing card centred on the mesh's position, uSize yards across
// (0: no area, nothing drawn).
const BILLBOARD_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c + (r * position.x + u * position.y) * uSize;
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

const SHELL_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * wocCamRelView(world.xyz);
}
`;

// A ribbon between two world points, turned to face the camera: a thread of
// prayer, the oath's chain, a lightning arc (uJag > 0: a jagged path that
// re-rolls 22 times a second, pinned at both ends). uReach runs it out from
// uA toward uB (an arc racing to its target).
const RIBBON_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
uniform vec3 uA;
uniform vec3 uB;
uniform float uWidth;
uniform float uJag;
uniform float uSag;
uniform float uSeed;
uniform float uReach;
uniform float uTime;
attribute float aT;
attribute float aSide;
varying float vT;
varying float vSide;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float t = aT * uReach;
  vec3 dir = uB - uA;
  float len = max(length(dir), 1e-3);
  vec3 d = dir / len;
  vec3 up = abs(d.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 s1 = normalize(cross(d, up));
  vec3 s2 = cross(s1, d);
  vec3 p = uA + dir * t;
  p.y -= uSag * len * sin(3.14159 * t);
  if (uJag > 0.0) {
    float k = t * 9.0;
    float i = floor(k);
    float f = smoothstep(0.0, 1.0, fract(k));
    float s = uSeed * 17.0 + floor(uTime * 22.0) * 3.17;
    vec2 a = vec2(h1(i * 12.9 + s), h1(i * 78.2 + s * 1.7)) - 0.5;
    vec2 b = vec2(h1((i + 1.0) * 12.9 + s), h1((i + 1.0) * 78.2 + s * 1.7)) - 0.5;
    vec2 o = mix(a, b, f) * sin(3.14159 * t);
    p += (s1 * o.x + s2 * o.y) * uJag * min(len, 8.0);
  }
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = cross(d, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : s1;
  p += side * aSide * uWidth;
  vT = aT;
  vSide = aSide;
  gl_Position = projectionMatrix * wocCamRelView(p);
}
`;

// A pilgrim's prayer: gold at the shrine to pearl at the singer, beads of
// light running along it toward her.
const PRAYER_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying float vT;
varying float vSide;
void main() {
  float x = abs(vSide);
  float core = 1.0 - smoothstep(0.0, 0.45, x);
  float glow = pow(max(1.0 - x, 0.0), 1.6);
  float bead = pow(max(0.5 + 0.5 * sin((vT * 5.0 - uTime * 1.8) * 6.28318), 0.0), 6.0);
  vec3 col = mix(vec3(1.0, 0.84, 0.5), vec3(0.92, 0.95, 1.0), vT);
  col = col * (0.7 + 1.5 * bead) + vec3(1.0) * core * 0.35;
  float ends = smoothstep(0.0, 0.05, vT) * (1.0 - smoothstep(0.95, 1.0, vT));
  float a = (glow * 0.35 + core * 0.4 + bead * glow * 0.7) * uAlpha * ends;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// The Moonset Oath: a braided chain of nacre links, reddening as it draws
// taut toward the oath's reach.
const OATH_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uTension;
uniform float uFlicker;
uniform float uLen;
varying float vT;
varying float vSide;
void main() {
  float x = abs(vSide);
  float links = 0.5 + 0.5 * sin(vT * uLen * 4.0 + vSide * 2.4 - uTime * 1.2);
  float link = smoothstep(0.3, 0.7, links);
  vec3 nacre = mix(vec3(0.78, 0.9, 1.0), vec3(1.0, 0.86, 0.96), 0.5 + 0.5 * sin(vT * 14.0 + uTime));
  float strain = smoothstep(0.6, 1.0, uTension);
  float beat = 0.6 + 0.4 * sin(uTime * 12.0) * uFlicker;
  vec3 col = mix(nacre, vec3(1.0, 0.36, 0.3), strain * beat);
  float edge = pow(max(1.0 - x, 0.0), 1.3);
  float a = edge * (0.4 + 0.45 * link) * uAlpha;
  gl_FragColor = vec4(col * (0.75 + 0.6 * link), clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// A lightning arc: a white core in a storm-blue sheath.
const BOLT_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
uniform vec3 uColor;
varying float vT;
varying float vSide;
void main() {
  float x = abs(vSide);
  float core = 1.0 - smoothstep(0.0, 0.3, x);
  float glow = pow(max(1.0 - x, 0.0), 2.2);
  vec3 col = mix(uColor, vec3(1.0), core) * (1.0 + core);
  gl_FragColor = vec4(col, clamp((glow * 0.6 + core) * uAlpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// The Shrine Vigil: a bubble of moon-pearl, nacre scales over it, crescent
// moons round its belt, light running down from the crown; cracks open and
// it flashes as it shatters.
const BUBBLE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uStrength;
uniform float uCrack;
uniform float uAlpha;
uniform float uFlash;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
${NOISE}
void main() {
  float fres = pow(max(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0), 2.4);
  vec3 p = normalize(vLocal);
  float lon = atan(p.z, p.x);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  vec2 g = vec2(lon * 5.0, lat * 6.0 + uTime * 0.12);
  vec2 cell = fract(g) - 0.5;
  float scale = 1.0 - smoothstep(0.36, 0.5, max(abs(cell.x) * 1.1 + abs(cell.y) * 0.6, abs(cell.y) * 1.2));
  float seams = 1.0 - scale;
  float sheen = 0.5 + 0.5 * sin(lon * 2.0 + lat * 7.0 + uTime * 0.9 + vnoise(p.xz * 3.0) * 4.0);
  vec3 pearl = mix(vec3(0.85, 0.9, 1.0), vec3(1.0, 0.88, 0.97), sheen);
  pearl = mix(pearl, vec3(0.75, 1.0, 0.96), 0.2 * (1.0 - sheen));
  float cm = floor((lon + 3.14159) / 6.28318 * 6.0);
  float cx = (cm + 0.5) / 6.0 * 6.28318 - 3.14159;
  vec2 d = vec2((lon - cx) * 2.2, (lat - 0.15) * 3.0);
  float moon = (1.0 - smoothstep(0.3, 0.34, length(d))) * smoothstep(0.22, 0.27, length(d - vec2(0.13, 0.05)));
  float ripple = pow(max(0.5 + 0.5 * sin(lat * 14.0 + uTime * 3.0), 0.0), 8.0) * 0.45;
  float n = vnoise(vec2(lon * 4.0, lat * 6.0) + 11.0);
  float crack = (1.0 - smoothstep(0.0, 0.04, abs(n - 0.5))) * uCrack;
  vec3 col = pearl * (0.3 + 0.9 * fres) * (0.55 + 0.6 * uStrength);
  col += vec3(1.0, 0.95, 0.85) * moon * 0.9 * uStrength;
  col += pearl * seams * 0.3 * fres;
  col += vec3(0.9, 0.97, 1.0) * ripple * uStrength;
  col += vec3(1.0) * crack * 2.0;
  col = mix(col, vec3(1.0), uFlash);
  float a = (0.1 + 0.75 * fres + seams * 0.08 + moon * 0.5 + ripple * 0.4) * (0.5 + 0.5 * uStrength);
  a += crack + uFlash;
  gl_FragColor = vec4(col, clamp(a * uAlpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// The oath's shield over the singer: a scallop shell of nacre, ribs and a
// glowing rim, reddening as the chain draws taut.
const SHIELD_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uTension;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - vec2(0.5, 0.36)) * 2.0;
  float r = length(p);
  float a = atan(p.x, p.y);
  float fan = 1.0 - smoothstep(1.2, 1.3, abs(a));
  float ribs = 0.5 + 0.5 * cos(a * 11.0);
  float rim = 0.8 + 0.06 * ribs;
  float inside = (1.0 - smoothstep(rim - 0.03, rim, r)) * fan;
  float edge = (1.0 - smoothstep(0.0, 0.05, abs(r - rim + 0.02))) * fan;
  float hinge = 1.0 - smoothstep(0.1, 0.16, length(p - vec2(0.0, -0.04)));
  vec3 nacre = mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.86, 0.96), 0.5 + 0.5 * sin(r * 9.0 - uTime * 1.6 + a * 2.0));
  vec3 col = mix(nacre, vec3(1.0, 0.45, 0.35), smoothstep(0.6, 1.0, uTension) * 0.6);
  float ribLine = smoothstep(0.75, 1.0, ribs) * inside;
  col *= 0.6 + 0.5 * ribLine;
  float alpha = inside * 0.5 + edge * 0.95 + hinge * 0.85;
  gl_FragColor = vec4(col * (1.0 + 0.6 * edge), clamp(alpha * uAlpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// The Prism Glare's eye: lids parting with the bar, a turning rainbow iris
// round a slit pupil, rainbow rays and a halo; it flares white at landing.
const EYE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uOpen;
uniform float uIris;
uniform float uBlaze;
uniform float uPulse;
uniform float uFlash;
uniform float uAlpha;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float lid = uOpen * 0.6 * (1.0 - p.x * p.x);
  float inEye = (1.0 - smoothstep(-0.02, 0.02, abs(p.y) - lid)) * step(abs(p.x), 0.97);
  float lidLine = (1.0 - smoothstep(0.0, 0.05, abs(abs(p.y) - lid))) * (1.0 - smoothstep(0.9, 0.98, abs(p.x)));
  float r = length(p);
  float ang = atan(p.y, p.x);
  float irisR = 0.2 + 0.26 * uIris;
  float iris = 1.0 - smoothstep(irisR - 0.02, irisR + 0.02, r);
  float striae = 0.65 + 0.35 * sin(ang * 24.0 + uTime * 2.0);
  vec3 rainbow = hue(fract(ang / 6.28318 + r * 0.8 - uTime * 0.25)) * (0.8 + 0.6 * striae);
  float pupil = 1.0 - smoothstep(0.06, 0.09, length(p * vec2(2.4, 1.0 / max(uOpen, 0.2))));
  vec3 col = vec3(0.95, 0.97, 1.0) * 0.65;
  col = mix(col, rainbow, iris);
  col = mix(col, vec3(0.04, 0.02, 0.09), pupil);
  col *= inEye;
  float rays = pow(max(0.5 + 0.5 * cos(ang * 12.0 + uTime * 0.8), 0.0), 10.0);
  rays *= (1.0 - smoothstep(0.45, 1.0, r)) * smoothstep(0.25, 0.5, r) * uBlaze;
  float halo = (1.0 - smoothstep(0.5, 1.0, r)) * 0.35 * uBlaze;
  vec3 outCol = col + hue(fract(ang / 6.28318 + uTime * 0.1)) * rays * 1.4;
  outCol += hue(fract(r - uTime * 0.3)) * halo * (1.0 - inEye);
  outCol += vec3(1.0, 0.95, 1.0) * lidLine * 1.3;
  outCol *= 1.0 + 0.6 * uPulse;
  outCol = mix(outCol, vec3(1.0), uFlash * 0.7);
  float alpha = max(inEye * 0.95, max(lidLine, max(rays, halo)));
  alpha += uFlash * (1.0 - smoothstep(0.2, 1.0, r));
  gl_FragColor = vec4(outCol, clamp(alpha * uAlpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// The gaze's reach on the floor: a prismatic dashed rim, and at landing a
// prism ring racing out to it (uWave: its radius as a share, 0 for none).
const RIM_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uWave;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float rim = 1.0 - smoothstep(0.0, 0.012, abs(r - 0.985));
  float band = smoothstep(0.92, 0.985, r) * (1.0 - smoothstep(0.985, 1.0, r)) * 0.3;
  vec3 col = hue(fract(a / 6.28318 * 3.0 + uTime * 0.2));
  float dash = step(0.35, fract(a * 48.0 / 6.28318 - uTime * 0.6));
  float wave = uWave > 0.0 ? exp(-pow(max((r - uWave) * 30.0, 0.0), 2.0)) : 0.0;
  float body = uWave > 0.0 ? (1.0 - smoothstep(0.0, uWave, r)) * 0.12 * uWave : 0.0;
  float alpha = (rim * (0.45 + 0.55 * dash) + band) * uAlpha + (wave + body) * uAlpha;
  gl_FragColor = vec4(col * (1.15 + wave), clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// A wave running over the floor (an echo beat, a wisp's burst, the
// whirlpool's first turn): a band behind a bright crest.
const WAVE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uReach;
uniform float uAlpha;
uniform vec3 uColor;
uniform vec3 uCrest;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float edge = uReach + (vnoise(vec2(a * 5.0, uTime * 2.0)) - 0.5) * 0.03;
  float crest = exp(-pow(max((r - edge) * 24.0, 0.0), 2.0));
  float body = smoothstep(edge - 0.3, edge, r) * (1.0 - smoothstep(edge, edge + 0.02, r));
  float ripple = 0.5 + 0.5 * sin((r - uTime * 0.5) * 50.0);
  vec3 col = mix(uColor * (0.7 + 0.3 * ripple), uCrest, crest);
  gl_FragColor = vec4(col, clamp((body * 0.45 + crest) * uAlpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// The Spiral Whirlpool: logarithmic arms of foam flowing inward over deep
// water darkening to the eye, a crisp foam rim at the pull's reach, the
// biting core tinted in the danger colour, flaring on each bite.
const VORTEX_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uSpin;
uniform float uCore;
uniform float uBite;
uniform float uAlpha;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float rr = max(r, 0.02);
  float phase = a * 4.0 + log(rr) * 6.0 + uTime * uSpin * 4.0;
  float arm = 0.5 + 0.5 * sin(phase);
  float foam = pow(max(arm, 0.0), 7.0) * smoothstep(0.08, 0.45, r);
  float n = vnoise(vec2(a * 3.0 + uTime * uSpin, r * 8.0 - uTime * 2.0));
  vec3 deep = vec3(0.02, 0.1, 0.18);
  vec3 water = vec3(0.12, 0.55, 0.68);
  vec3 col = mix(deep, water, smoothstep(0.0, 0.9, r) * (0.6 + 0.4 * arm));
  col += vec3(0.9, 1.0, 1.0) * foam * (0.6 + 0.4 * n);
  float rim = 1.0 - smoothstep(0.0, 0.02, abs(r - 0.975));
  col = mix(col, vec3(0.85, 1.0, 1.0), rim);
  float inCore = 1.0 - smoothstep(uCore - 0.02, uCore, r);
  col = mix(col, vec3(1.0, 0.42, 0.16), inCore * (0.18 + 0.4 * uBite));
  float alpha = 0.35 + 0.25 * smoothstep(0.0, 0.8, r) + foam * 0.5 + rim * 0.6;
  alpha *= 1.0 - smoothstep(0.985, 1.0, r) * (1.0 - rim);
  gl_FragColor = vec4(col, clamp(alpha * uAlpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// A swollen wisp's moon-water shell: caustics, a bright rim and a brighter
// core showing through.
const SWELL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uCore;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
${NOISE}
void main() {
  float fres = pow(max(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0), 2.0);
  vec3 p = normalize(vLocal);
  float caust = vnoise(p.xz * 5.0 + vec2(uTime * 0.7, -uTime * 0.5)) * vnoise(p.xy * 4.0 - uTime * 0.4);
  float core = pow(max(1.0 - fres, 0.0), 3.0) * uCore;
  vec3 col = mix(vec3(0.35, 0.85, 0.9), vec3(0.9, 0.97, 1.0), fres) * (0.4 + 0.8 * fres);
  col += vec3(0.85, 0.97, 1.0) * core + vec3(0.8, 1.0, 1.0) * caust * 0.6;
  float a = (0.1 + 0.6 * fres + core * 0.45 + caust * 0.3) * uAlpha;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// The Tidewisp's chill: a crust of ice up a player's legs, its jagged top
// sinking as it melts.
const CRUST_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAmount;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
${NOISE}
void main() {
  float fres = pow(max(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0), 1.6);
  float h = vLocal.y + 0.5;
  float a0 = atan(vLocal.z, vLocal.x);
  float jag = vnoise(vec2(a0 * 4.0, 3.0)) * 0.25;
  float top = 1.0 - smoothstep(uAmount - 0.05 - jag, uAmount - jag, h);
  float facets = vnoise(vec2(a0 * 9.0, h * 7.0));
  float crack = 1.0 - smoothstep(0.0, 0.05, abs(facets - 0.5));
  vec3 ice = mix(vec3(0.55, 0.8, 0.95), vec3(0.92, 0.98, 1.0), fres * 0.7 + facets * 0.3);
  ice += vec3(1.0) * crack * 0.5;
  float glint = pow(max(vnoise(vec2(a0 * 20.0, h * 20.0 + uTime * 0.5)), 0.0), 10.0) * 3.0;
  float alpha = (0.25 + 0.55 * fres + crack * 0.3 + glint) * top;
  gl_FragColor = vec4(ice + glint, clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;
type Uniforms = Record<string, { value: unknown }>;

interface Piece {
  mesh: THREE.Mesh;
  u: Uniforms;
}

interface BubbleSlot extends Piece {
  singerId: number;
  age: number;
  /** The bubble's last full radius (the shatter bursts out from it). */
  radius: number;
  /** Seconds into its shatter (-1: not shattering). */
  shatter: number;
}

interface PrayerSlot extends Piece {
  pilgrimId: number;
  singerId: number;
  age: number;
}

interface OathSlot {
  chain: Piece;
  shield: Piece;
  guardId: number;
  singerId: number;
  age: number;
}

interface EchoSlot extends TelegraphFan {
  sleeperId: number;
  since: number;
  beatAt: number;
}

interface EyeSlot {
  eye: Piece;
  rim: Piece;
  lurkerId: number;
  /** Seconds since the gaze landed (-1: still charging or gone). */
  flash: number;
  /** Seconds the eye has been closing since its bar broke (-1: not). */
  fade: number;
  fill: number;
  blazeDebt: number;
  /** The last lurker this slot showed and when its eye closed (a lagging
   *  snapshot that still reads the bar must not reopen it). */
  lastLurker: number;
  freedAt: number;
}

interface WaveSlot extends Piece {
  age: number;
  life: number;
}

interface VortexSlot extends Piece {
  core: TelegraphFan;
  snapperId: number;
  since: number;
  sprayDebt: number;
}

interface BoltSlot {
  main: Piece;
  branch: Piece;
  fromId: number;
  toId: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  age: number;
  index: number;
  /** The arc has reached its target (its impact sparks are spent). */
  struck: boolean;
}

interface SwellSlot extends Piece {
  ring: TelegraphFan;
  wispId: number;
}

interface CrustSlot extends Piece {
  playerId: number;
}

interface WispTrack {
  id: number;
  x: number;
  y: number;
  z: number;
  swell: number;
  /** Seconds since its body left the world (a burst or merge event naming it
   *  is read after it is gone, so the track outlives it a moment). */
  gone: number;
}

/** First aura of `id` on a body (a loop: no closure per call). */
function auraOf(auras: readonly Aura[], id: string): Aura | undefined {
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return auras[i];
  return undefined;
}

export class TempleTrashFx {
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly glow: ParticlePool;
  private readonly mist: ParticlePool;
  private readonly veil: TempleDazzleVeil;
  private readonly bubbles: BubbleSlot[] = [];
  private readonly prayers: PrayerSlot[] = [];
  private readonly oaths: OathSlot[] = [];
  private readonly echoes: EchoSlot[] = [];
  private readonly eyes: EyeSlot[] = [];
  private readonly waves: WaveSlot[] = [];
  private readonly vortices: VortexSlot[] = [];
  private readonly bolts: BoltSlot[] = [];
  private readonly swells: SwellSlot[] = [];
  private readonly crusts: CrustSlot[] = [];
  private readonly wisps: WispTrack[] = [];
  private readonly dazzled: number[] = [];
  private readonly sparkers: number[] = [];
  private readonly n = templeTrashNumbers();
  private readonly zones = templeZoneSpecs();
  private readonly density: number;
  private readonly spec: ParticleSpec = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 1,
    size1: 1,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  };
  private readonly look = { strength: 0, grow: 0 };
  private readonly eyeLook = { open: 0, iris: 0, blaze: 0, pulse: 0 };
  private readonly veilLook = { edge: 0, flash: 0 };
  private readonly whirlLook = { spin: 0, grow: 0 };
  private readonly arcLook = { alpha: 0, reach: 0 };
  private readonly bubbleSize = { radius: 0, up: 0 };
  private readonly shatterLook = { scale: 0, crack: 0, alpha: 0 };
  private readonly waveLook = { reach: 0, alpha: 0 };
  private readonly swellLook = { radius: 0, core: 0 };
  private readonly color = new THREE.Color();
  private scan = 0;
  private gated = false;
  private seed = 73;
  private sparkAt = -1;
  private sparkIndex = 0;
  private dazzleSeen = -1;
  private dazzleSince = 0;
  private sparkleDebt = 0;
  private crackleDebt = 0;
  private readonly paint = { fill: 0, clock: 0, range: 0 };

  constructor(
    parent: THREE.Group,
    private readonly world: IWorld | undefined,
    private readonly groundY: (x: number, z: number) => number,
    detail: boolean,
    private readonly kit: TelegraphKit,
    private readonly shake?: (amount: number) => void,
    private readonly calm: () => boolean = () => false,
  ) {
    this.root.name = 'drowned-temple-trash-fx';
    parent.add(this.root);
    this.density = detail ? 1 : 0.35;
    const particleMat = (frag: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime },
        vertexShader: PARTICLE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      return m;
    };
    this.glow = new ParticlePool(
      Math.round(1800 * this.density),
      particleMat(GLOW_FRAG, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 27),
    );
    this.mist = new ParticlePool(
      Math.round(400 * this.density),
      particleMat(DUST_FRAG, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 26),
    );
    this.root.add(this.glow.mesh, this.mist.mesh);

    const disc = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const card = new THREE.PlaneGeometry(1, 1);
    const ball = new THREE.SphereGeometry(1, 40, 24);
    const crust = new THREE.CylinderGeometry(0.42, 0.55, 1, 20, 1, true);
    const ribbon = ribbonGeometry(RIBBON_STATIONS);
    this.geometries.push(disc, card, ball, crust, ribbon);

    for (let i = 0; i < BUBBLES; i++) {
      const p = this.piece(ball, SHELL_VERT, BUBBLE_FRAG, 24, THREE.AdditiveBlending, {
        uStrength: { value: 0 },
        uCrack: { value: 0 },
        uAlpha: { value: 0 },
        uFlash: { value: 0 },
      });
      p.mesh.scale.setScalar(1e-4);
      this.bubbles.push({ ...p, singerId: -1, age: 0, radius: 1, shatter: -1 });
    }
    for (let i = 0; i < PRAYERS; i++) {
      const p = this.piece(ribbon, RIBBON_VERT, PRAYER_FRAG, 25, THREE.AdditiveBlending, {
        ...ribbonUniforms(),
        uAlpha: { value: 0 },
      });
      this.prayers.push({ ...p, pilgrimId: -1, singerId: -1, age: 0 });
    }
    for (let i = 0; i < OATHS; i++) {
      const chain = this.piece(ribbon, RIBBON_VERT, OATH_FRAG, 25, THREE.NormalBlending, {
        ...ribbonUniforms(),
        uAlpha: { value: 0 },
        uTension: { value: 0 },
        uFlicker: { value: 1 },
        uLen: { value: 1 },
      });
      const shield = this.piece(card, BILLBOARD_VERT, SHIELD_FRAG, 28, THREE.NormalBlending, {
        uSize: { value: 0 },
        uAlpha: { value: 0 },
        uTension: { value: 0 },
      });
      this.oaths.push({ chain, shield, guardId: -1, singerId: -1, age: 0 });
    }
    for (let i = 0; i < EYES; i++) {
      const eye = this.piece(card, BILLBOARD_VERT, EYE_FRAG, 29, THREE.NormalBlending, {
        uSize: { value: 0 },
        uOpen: { value: 0 },
        uIris: { value: 0 },
        uBlaze: { value: 0 },
        uPulse: { value: 0 },
        uFlash: { value: 0 },
        uAlpha: { value: 0 },
      });
      const rim = this.piece(disc, UV_VERT, RIM_FRAG, 5, THREE.AdditiveBlending, {
        uAlpha: { value: 0 },
        uWave: { value: 0 },
      });
      rim.mesh.scale.setScalar(1e-4);
      this.eyes.push({
        eye,
        rim,
        lurkerId: -1,
        flash: -1,
        fade: -1,
        fill: 0,
        blazeDebt: 0,
        lastLurker: -1,
        freedAt: -1,
      });
    }
    for (let i = 0; i < WAVES; i++) {
      const p = this.piece(disc, UV_VERT, WAVE_FRAG, 6, THREE.AdditiveBlending, {
        uReach: { value: 0 },
        uAlpha: { value: 0 },
        uColor: { value: new THREE.Color() },
        uCrest: { value: new THREE.Color() },
      });
      p.mesh.scale.setScalar(1e-4);
      this.waves.push({ ...p, age: -1, life: 0 });
    }
    for (let i = 0; i < VORTICES; i++) {
      const p = this.piece(disc, UV_VERT, VORTEX_FRAG, 3, THREE.NormalBlending, {
        uSpin: { value: 0 },
        uCore: { value: 0 },
        uBite: { value: 0 },
        uAlpha: { value: 0 },
      });
      p.mesh.scale.setScalar(1e-4);
      this.vortices.push({ ...p, core: kit.fan(15), snapperId: -1, since: 0, sprayDebt: 0 });
    }
    for (let i = 0; i < BOLTS; i++) {
      const bolt = () =>
        this.piece(ribbon, RIBBON_VERT, BOLT_FRAG, 28, THREE.AdditiveBlending, {
          ...ribbonUniforms(),
          uAlpha: { value: 0 },
          uColor: { value: new THREE.Color(TEMPLE_TRASH_ACCENTS.storm) },
        });
      this.bolts.push({
        main: bolt(),
        branch: bolt(),
        fromId: -1,
        toId: -1,
        a: new THREE.Vector3(),
        b: new THREE.Vector3(),
        age: -1,
        index: 0,
        struck: false,
      });
    }
    for (let i = 0; i < SWELLS; i++) {
      const p = this.piece(ball, SHELL_VERT, SWELL_FRAG, 24, THREE.AdditiveBlending, {
        uCore: { value: 0 },
        uAlpha: { value: 0 },
      });
      p.mesh.scale.setScalar(1e-4);
      this.swells.push({ ...p, ring: kit.fan(15), wispId: -1 });
    }
    for (let i = 0; i < CRUSTS; i++) {
      const p = this.piece(crust, SHELL_VERT, CRUST_FRAG, 24, THREE.NormalBlending, {
        uAmount: { value: 0 },
      });
      (p.mesh.material as THREE.ShaderMaterial).side = THREE.DoubleSide;
      p.mesh.scale.setScalar(1e-4);
      this.crusts.push({ ...p, playerId: -1 });
    }
    for (let i = 0; i < ECHO_RINGS; i++)
      this.echoes.push({ ...kit.fan(15), sleeperId: -1, since: 0, beatAt: -1 });
    this.veil = new TempleDazzleVeil(this.root, this.uTime);
  }

  /** One pooled drawable on encounter rung `step` (in the air: over every
   *  floor mark it might stand above; on the floor: under the kit's rings). */
  private piece(
    geo: THREE.BufferGeometry,
    vert: string,
    frag: string,
    step: number,
    blending: THREE.Blending,
    uniforms: Uniforms,
  ): Piece {
    const u: Uniforms = { uTime: this.uTime, ...uniforms };
    const m = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.materials.push(m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = floorVfxRenderOrder('encounter', step);
    this.root.add(mesh);
    return { mesh, u };
  }

  /** This frame's floor paint, in the one reused object. */
  private paintOf(fill: number, clock: number, range: number) {
    const p = this.paint;
    p.fill = fill;
    p.clock = clock;
    p.range = range;
    return p;
  }

  /** The temple root's gate has linked every program: idle pieces hide. */
  markGated(): void {
    this.gated = true;
    this.veil.markGated();
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Show a piece only while it draws something (before the gate links it,
   *  every piece stays in the tree so its program compiles with the rest). */
  private shown(p: Piece, on: boolean): void {
    p.mesh.visible = on || !this.gated;
  }

  // ---- events --------------------------------------------------------------

  /** True when the event is one of the pass's own cues (drawn here). */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx') return false;
    const cue = templeTrashCue(ev);
    if (!cue || !this.world) return false;
    const world = this.world;
    switch (cue) {
      case 'gaze': {
        const lurker = world.entities.get(ev.sourceId);
        if (lurker) this.gazeLands(lurker);
        return true;
      }
      case 'spark':
        this.sparkLands(world, ev.sourceId, ev.targetId);
        return true;
      case 'echo': {
        const sleeper = world.entities.get(ev.sourceId);
        if (sleeper) this.echoBeat(sleeper);
        return true;
      }
      case 'whirl': {
        const snapper = world.entities.get(ev.sourceId);
        if (snapper) this.whirlStarts(snapper);
        return true;
      }
      case 'merge':
        this.merge(world, ev.sourceId, ev.targetId);
        return true;
      case 'burst': {
        const w = this.wispTrack(ev.sourceId);
        if (!w) return false;
        this.burst(w);
        return true;
      }
    }
    return false;
  }

  private emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    r: number,
    g: number,
    b: number,
    a: number,
    ay = 0,
    drag = 0.001,
  ): void {
    const s = this.spec;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = vx;
    s.vy = vy;
    s.vz = vz;
    s.ay = ay;
    s.drag = drag;
    s.life = life;
    s.size0 = size0;
    s.size1 = size1;
    s.r = r;
    s.g = g;
    s.b = b;
    s.a = a;
    this.glow.emit(this.uTime.value, s);
  }

  private wave(
    x: number,
    z: number,
    radius: number,
    color: number,
    crest: number,
    life = 0.75,
  ): void {
    let slot = this.waves[0];
    for (const w of this.waves) {
      if (w.age < 0) {
        slot = w;
        break;
      }
    }
    slot.age = 0;
    slot.life = life;
    slot.mesh.position.set(x, this.groundY(x, z) + 0.07, z);
    slot.mesh.scale.setScalar(radius);
    (slot.u.uColor.value as THREE.Color).setHex(color);
    (slot.u.uCrest.value as THREE.Color).setHex(crest);
  }

  private gazeLands(lurker: EntityView): void {
    let slot: EyeSlot | undefined;
    for (const e of this.eyes) {
      if (e.lurkerId === lurker.id) {
        slot = e;
        break;
      }
    }
    slot ??= this.claimEye(lurker.id);
    if (slot) {
      slot.flash = 0;
      slot.fade = -1;
    }
    const y = this.groundY(lurker.pos.x, lurker.pos.z) + gazeEyeUp();
    const n = Math.round(140 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const e = (this.rand() - 0.35) * 1.4;
      const s = 9 + this.rand() * 12;
      this.color.setHSL((i / n + this.rand() * 0.1) % 1, 1, 0.65);
      this.emit(
        lurker.pos.x,
        y,
        lurker.pos.z,
        Math.cos(a) * Math.cos(e) * s,
        Math.sin(e) * s,
        Math.sin(a) * Math.cos(e) * s,
        0.6 + this.rand() * 0.4,
        0.7,
        0.15,
        this.color.r,
        this.color.g,
        this.color.b,
        1,
        -3,
        1.4,
      );
    }
    const me = this.world?.entities.get(this.world.playerId);
    if (!me || this.calm() || !this.shake) return;
    if (Math.hypot(me.pos.x - lurker.pos.x, me.pos.z - lurker.pos.z) <= this.n.gaze.range)
      this.shake(0.08);
  }

  private sparkLands(world: IWorld, fromId: number, toId: number): void {
    const now = this.uTime.value;
    this.sparkIndex = sparkHopIndex(this.sparkAt, this.sparkIndex, now);
    this.sparkAt = now;
    const from = world.entities.get(fromId);
    const to = world.entities.get(toId);
    if (!to) return;
    let slot = this.bolts[0];
    for (const b of this.bolts) {
      if (b.age < 0) {
        slot = b;
        break;
      }
    }
    slot.fromId = fromId;
    slot.toId = toId;
    slot.age = 0;
    slot.index = this.sparkIndex;
    slot.struck = false;
    this.boltEnd(to, slot.b, false);
    // A link already gone from view: the arc falls on the struck from above.
    if (from) this.boltEnd(from, slot.a, true);
    else slot.a.set(slot.b.x, slot.b.y + 6, slot.b.z);
    slot.main.u.uSeed.value = idHue(toId * 31 + this.sparkIndex) * 10;
    slot.branch.u.uSeed.value = idHue(toId * 17 + 5) * 10;
    if (!this.calm() && this.shake && toId === world.playerId) this.shake(0.1);
  }

  /** Where an arc meets a body: the eel's jaws, else a player's chest. */
  private boltEnd(e: EntityView | undefined, out: THREE.Vector3, source: boolean): void {
    if (!e) return;
    const up = e.templateId === TEMPLE_TRASH_IDS.eel ? eelJawUp() : source ? 1.3 : 1.2;
    out.set(e.pos.x, e.pos.y + up, e.pos.z);
  }

  private echoBeat(sleeper: EntityView): void {
    for (const s of this.echoes) {
      if (s.sleeperId === sleeper.id) {
        s.beatAt = this.uTime.value;
        break;
      }
    }
    const r = this.n.echo.radius;
    this.wave(sleeper.pos.x, sleeper.pos.z, r, TEMPLE_TRASH_ACCENTS.lullaby, 0xf4f0ff, 0.9);
    const y = this.groundY(sleeper.pos.x, sleeper.pos.z);
    const n = Math.round(40 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const silver = this.rand() < 0.45;
      this.emit(
        sleeper.pos.x + Math.cos(a) * 0.6,
        y + 0.6 + this.rand() * 1.2,
        sleeper.pos.z + Math.sin(a) * 0.6,
        Math.cos(a) * r * 1.2,
        0.6 + this.rand() * 0.8,
        Math.sin(a) * r * 1.2,
        0.8 + this.rand() * 0.4,
        0.45,
        0.2,
        silver ? 0.92 : 1,
        silver ? 0.94 : 0.62,
        silver ? 1 : 0.9,
        0.9,
        0,
        1.6,
      );
    }
  }

  private whirlStarts(snapper: EntityView): void {
    let slot: VortexSlot | undefined;
    for (const v of this.vortices) {
      if (v.snapperId === snapper.id) {
        slot = v;
        break;
      }
    }
    slot ??= this.claimVortex(snapper.id);
    if (slot) slot.since = this.uTime.value;
    this.wave(
      snapper.pos.x,
      snapper.pos.z,
      this.n.whirl.radius,
      TEMPLE_TRASH_ACCENTS.whirl,
      0xeaffff,
    );
    const y = this.groundY(snapper.pos.x, snapper.pos.z);
    const n = Math.round(70 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = 3 + this.rand() * 5;
      this.emit(
        snapper.pos.x + Math.cos(a) * 1.2,
        y + 0.5,
        snapper.pos.z + Math.sin(a) * 1.2,
        Math.cos(a) * s,
        4 + this.rand() * 5,
        Math.sin(a) * s,
        0.7 + this.rand() * 0.4,
        0.5,
        0.12,
        0.55,
        0.92,
        1,
        1,
        -14,
        0.8,
      );
    }
    const me = this.world?.entities.get(this.world.playerId);
    if (!me || this.calm() || !this.shake) return;
    if (Math.hypot(me.pos.x - snapper.pos.x, me.pos.z - snapper.pos.z) <= this.n.whirl.radius)
      this.shake(0.12);
  }

  /** A wisp drank another: moon-water streams from where the drunk one
   *  was into the survivor, and the survivor ripples. */
  private merge(world: IWorld, goneId: number, survivorId: number): void {
    const gone = this.wispTrack(goneId);
    const survivor = world.entities.get(survivorId);
    if (!survivor) return;
    const up = wispCoreUp();
    const tx = survivor.pos.x;
    const ty = survivor.pos.y + up;
    const tz = survivor.pos.z;
    const sx = gone ? gone.x : tx;
    const sy = gone ? gone.y + up : ty;
    const sz = gone ? gone.z : tz;
    const n = Math.round(60 * this.density);
    for (let i = 0; i < n; i++) {
      // A streak: droplets leave the gone wisp's spot along the line to the
      // survivor, timed to arrive together.
      const k = this.rand();
      const life = 0.35 + 0.25 * this.rand();
      const ox = (this.rand() - 0.5) * 0.6;
      const oz = (this.rand() - 0.5) * 0.6;
      this.emit(
        sx + ox,
        sy + (this.rand() - 0.5) * 0.5,
        sz + oz,
        (tx - sx - ox) / life,
        (ty - sy) / life + 0.5,
        (tz - sz - oz) / life,
        life,
        0.5 + 0.3 * k,
        0.2,
        0.55 + 0.4 * k,
        0.95,
        1,
        0.95,
      );
    }
    this.wave(tx, tz, 1.6, TEMPLE_TRASH_ACCENTS.tide, 0xeefcff, 0.5);
    if (gone) gone.id = -1;
  }

  /** A wisp's burst: a wave of moon-water to its true radius (wider by each
   *  merge), droplets and frost mist. */
  private burst(w: WispTrack): void {
    const radius = wispBurstRadius(w.swell, this.n);
    this.wave(w.x, w.z, radius, TEMPLE_TRASH_ACCENTS.tide, 0xf0fbff, 0.7);
    const y = this.groundY(w.x, w.z);
    const n = Math.round((70 + 30 * w.swell) * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = radius * (1.4 + this.rand() * 1.2);
      const frost = this.rand() < 0.35;
      this.emit(
        w.x,
        y + wispCoreUp(),
        w.z,
        Math.cos(a) * s,
        2 + this.rand() * 4,
        Math.sin(a) * s,
        0.5 + this.rand() * 0.4,
        frost ? 0.6 : 0.42,
        0.1,
        frost ? 0.9 : 0.45,
        frost ? 0.97 : 0.9,
        1,
        1,
        -10,
        1.1,
      );
    }
    const m = Math.round(16 * this.density);
    for (let i = 0; i < m; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = radius * this.rand() * 0.8;
      const s = this.spec;
      s.x = w.x + Math.cos(a) * r;
      s.y = y + 0.4;
      s.z = w.z + Math.sin(a) * r;
      s.vx = Math.cos(a) * 1.5;
      s.vy = 0.6;
      s.vz = Math.sin(a) * 1.5;
      s.ay = 0;
      s.drag = 1.2;
      s.life = 1.2;
      s.size0 = 1.6;
      s.size1 = 3;
      s.r = 0.85;
      s.g = 0.95;
      s.b = 1;
      s.a = 0.35;
      this.mist.emit(this.uTime.value, s);
    }
    w.id = -1;
  }

  // ---- the scan ------------------------------------------------------------

  private wispTrack(id: number): WispTrack | undefined {
    for (const w of this.wisps) if (w.id === id) return w;
    return undefined;
  }

  /** Start remembering a wisp's spot (a free track, or a new one up to the
   *  cap; the pool only ever grows to WISPS). */
  private trackWisp(e: EntityView): void {
    let track = this.wisps.find((w) => w.id < 0);
    if (!track && this.wisps.length < WISPS) {
      track = { id: -1, x: 0, y: 0, z: 0, swell: 0, gone: 0 };
      this.wisps.push(track);
    }
    if (!track) return;
    track.id = e.id;
    track.x = e.pos.x;
    track.y = e.pos.y;
    track.z = e.pos.z;
    track.swell = 0;
    track.gone = 0;
  }

  private claimEye(lurkerId: number): EyeSlot | undefined {
    const slot = this.eyes.find((e) => e.lurkerId < 0);
    if (!slot) return undefined;
    slot.lurkerId = lurkerId;
    slot.flash = -1;
    slot.fade = -1;
    slot.fill = 0;
    return slot;
  }

  private claimVortex(snapperId: number): VortexSlot | undefined {
    const slot = this.vortices.find((v) => v.snapperId < 0);
    if (!slot) return undefined;
    slot.snapperId = snapperId;
    slot.since = this.uTime.value;
    const spec = this.zones[TEMPLE_SPIRAL_WHIRLPOOL];
    this.kit.layOutFan(slot.core, 360, { color: spec.color, accent: spec.accent });
    slot.core.group.visible = true;
    return slot;
  }

  /** Who wears what: claim a slot for every new wearer (the frame loops
   *  free them when the aura or the body goes). */
  private scanWorld(world: IWorld): void {
    this.dazzled.length = 0;
    this.sparkers.length = 0;
    for (const e of world.entities.values()) {
      if (e.dead) continue;
      if (e.kind === 'player') {
        if (this.dazzled.length < DAZZLED && auraOf(e.auras, TEMPLE_PRISM_DAZZLE))
          this.dazzled.push(e.id);
        if (
          auraOf(e.auras, TEMPLE_TIDEWISP_CHILL) &&
          !this.crusts.some((c) => c.playerId === e.id)
        ) {
          const slot = this.crusts.find((c) => c.playerId < 0);
          if (slot) slot.playerId = e.id;
        }
        if (
          auraOf(e.auras, TEMPLE_LULLABY_ECHO) &&
          !this.echoes.some((s) => s.sleeperId === e.id)
        ) {
          const slot = this.echoes.find((s) => s.sleeperId < 0);
          if (slot) {
            const spec = this.zones[TEMPLE_LULLABY_ECHO];
            this.kit.layOutFan(slot, 360, { color: spec.color, accent: spec.accent });
            slot.sleeperId = e.id;
            slot.since = this.uTime.value;
            slot.beatAt = -1;
            slot.group.visible = true;
          }
        }
        continue;
      }
      if (e.kind !== 'mob') continue;
      switch (e.templateId) {
        case TEMPLE_TRASH_IDS.acolyte:
        case TEMPLE_TRASH_IDS.siren:
          if (
            auraOf(e.auras, TEMPLE_SHRINE_VIGIL) &&
            !this.bubbles.some((b) => b.singerId === e.id)
          ) {
            const slot = this.bubbles.find((b) => b.singerId < 0 && b.shatter < 0);
            if (slot) {
              slot.singerId = e.id;
              slot.age = 0;
            }
          }
          break;
        case TEMPLE_TRASH_IDS.pilgrim: {
          const prayer = auraOf(e.auras, TEMPLE_VIGIL_PRAYER);
          if (prayer && !this.prayers.some((p) => p.pilgrimId === e.id)) {
            const slot = this.prayers.find((p) => p.pilgrimId < 0);
            if (slot) {
              slot.pilgrimId = e.id;
              slot.singerId = prayer.sourceId;
              slot.age = 0;
            }
          }
          break;
        }
        case TEMPLE_TRASH_IDS.guard: {
          const keep = auraOf(e.auras, TEMPLE_OATH_KEEPER);
          if (keep && !this.oaths.some((o) => o.guardId === e.id)) {
            const slot = this.oaths.find((o) => o.guardId < 0);
            if (slot) {
              slot.guardId = e.id;
              slot.singerId = keep.sourceId;
              slot.age = 0;
            }
          }
          break;
        }
        case TEMPLE_TRASH_IDS.lurker:
          if (
            e.castingAbility === TEMPLE_PRISM_GLARE &&
            e.castRemaining > 0 &&
            !this.eyes.some((s) => s.lurkerId === e.id) &&
            !this.eyes.some((s) => s.lastLurker === e.id && this.uTime.value - s.freedAt < 1)
          )
            this.claimEye(e.id);
          break;
        case TEMPLE_TRASH_IDS.snapper:
          if (
            auraOf(e.auras, TEMPLE_SPIRAL_WHIRLPOOL) &&
            !this.vortices.some((v) => v.snapperId === e.id)
          )
            this.claimVortex(e.id);
          break;
        case TEMPLE_TRASH_IDS.eel:
          if (e.castingAbility === TEMPLE_ARCING_SPARK && this.sparkers.length < 4)
            this.sparkers.push(e.id);
          break;
        case TEMPLE_TRASH_IDS.wisp:
          if (!this.wispTrack(e.id)) this.trackWisp(e);
          if (auraOf(e.auras, TEMPLE_SWOLLEN_TIDE) && !this.swells.some((s) => s.wispId === e.id)) {
            const slot = this.swells.find((s) => s.wispId < 0);
            if (slot) {
              this.kit.layOutFan(slot.ring, 360, {
                color: TELEGRAPH_THREAT_COLORS.danger,
                accent: TEMPLE_TRASH_ACCENTS.tide,
              });
              slot.ring.group.visible = true;
              slot.wispId = e.id;
            }
          }
          break;
      }
    }
  }

  // ---- the frame -------------------------------------------------------------

  update(dt: number, clock: number): void {
    this.uTime.value = clock;
    const world = this.world;
    this.scan -= dt;
    if (world && this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    let busy = this.glow.lastDeath > clock || this.mist.lastDeath > clock;
    if (world) {
      this.stepWisps(world, dt);
      if (this.stepBubbles(world, dt)) busy = true;
      if (this.stepPrayers(world, dt)) busy = true;
      if (this.stepOaths(world, dt)) busy = true;
      if (this.stepEchoes(world, clock)) busy = true;
      if (this.stepEyes(world, dt, clock)) busy = true;
      if (this.stepDazzle(world, dt, clock)) busy = true;
      if (this.stepVortices(world, dt, clock)) busy = true;
      if (this.stepSparkers(world, dt)) busy = true;
      if (this.stepSwells(world, clock)) busy = true;
      if (this.stepCrusts(world)) busy = true;
    }
    if (this.stepBolts(world, dt)) busy = true;
    if (this.stepWaves(dt)) busy = true;
    this.glow.update(clock);
    this.mist.update(clock);
    this.root.visible = !this.gated || busy;
  }

  /** Every wisp's last spot and swell (a burst or a merge names a wisp that
   *  is already gone by the time its event is read). */
  private stepWisps(world: IWorld, dt: number): void {
    for (const w of this.wisps) {
      if (w.id < 0) continue;
      const e = world.entities.get(w.id);
      if (!e) {
        w.gone += dt;
        if (w.gone > 1) w.id = -1;
        continue;
      }
      w.gone = 0;
      w.x = e.pos.x;
      w.y = e.pos.y;
      w.z = e.pos.z;
      w.swell = auraOf(e.auras, TEMPLE_SWOLLEN_TIDE)?.value ?? 0;
    }
  }

  private stepBubbles(world: IWorld, dt: number): boolean {
    let any = false;
    for (const b of this.bubbles) {
      if (b.shatter >= 0) {
        b.shatter += dt;
        const s = vigilShatter(b.shatter, this.shatterLook);
        b.mesh.scale.setScalar(b.radius * s.scale);
        b.u.uCrack.value = s.crack;
        b.u.uAlpha.value = s.alpha;
        b.u.uFlash.value = Math.max(0, (b.u.uFlash.value as number) - dt * 4);
        if (b.shatter >= VIGIL_SHATTER_SECONDS) {
          b.shatter = -1;
          b.mesh.scale.setScalar(1e-4);
          this.shown(b, false);
        } else {
          this.shown(b, true);
          any = true;
        }
        continue;
      }
      if (b.singerId < 0) {
        this.shown(b, false);
        continue;
      }
      const e = world.entities.get(b.singerId);
      const ward = e && !e.dead ? auraOf(e.auras, TEMPLE_SHRINE_VIGIL) : undefined;
      if (!e || !ward) {
        if (e) this.shatterBubble(b, e);
        b.singerId = -1;
        continue;
      }
      b.age += dt;
      let prayers = 0;
      for (const p of this.prayers) if (p.singerId === b.singerId && p.pilgrimId >= 0) prayers++;
      const look = vigilBubbleLook(ward.value, prayers, b.age, this.look);
      const size = vigilBubble(e.templateId, this.bubbleSize);
      const breathe = 1 + 0.025 * Math.sin(this.uTime.value * 2.2 + b.singerId);
      b.radius = size.radius;
      b.mesh.position.set(e.pos.x, e.pos.y + size.up, e.pos.z);
      b.mesh.scale.set(
        size.radius * look.grow * breathe,
        size.radius * 1.08 * look.grow,
        size.radius * look.grow * breathe,
      );
      b.u.uStrength.value = look.strength;
      b.u.uAlpha.value = 1;
      b.u.uCrack.value = 0;
      b.u.uFlash.value = Math.max(0, (b.u.uFlash.value as number) - dt * 3);
      this.shown(b, true);
      any = true;
      // Moonlight drawn in over the bubble while it holds.
      if (this.rand() < 0.35 * this.density) {
        const a = this.rand() * Math.PI * 2;
        const el = this.rand() * 1.2 - 0.3;
        const r = size.radius * 1.05;
        this.emit(
          e.pos.x + Math.cos(a) * Math.cos(el) * r,
          e.pos.y + size.up + Math.sin(el) * r,
          e.pos.z + Math.sin(a) * Math.cos(el) * r,
          0,
          0.4,
          0,
          1,
          0.3,
          0.05,
          0.95,
          0.93,
          1,
          0.8,
        );
      }
    }
    return any;
  }

  /** The ward fell: the bubble cracks, flashes and bursts into pearl shards. */
  private shatterBubble(b: BubbleSlot, e: EntityView): void {
    b.shatter = 0;
    b.u.uFlash.value = this.calm() ? 0.4 : 1;
    const size = vigilBubble(e.templateId, this.bubbleSize);
    const cx = e.pos.x;
    const cy = e.pos.y + size.up;
    const cz = e.pos.z;
    const n = Math.round(130 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const el = (this.rand() - 0.3) * 1.6;
      const s = 5 + this.rand() * 9;
      const pearl = this.rand();
      this.emit(
        cx + Math.cos(a) * Math.cos(el) * size.radius,
        cy + Math.sin(el) * size.radius,
        cz + Math.sin(a) * Math.cos(el) * size.radius,
        Math.cos(a) * Math.cos(el) * s,
        Math.sin(el) * s + 2,
        Math.sin(a) * Math.cos(el) * s,
        0.7 + this.rand() * 0.5,
        0.55,
        0.12,
        0.9 + 0.1 * pearl,
        0.86 + 0.14 * pearl,
        1,
        1,
        -12,
        0.8,
      );
    }
    if (this.calm() || !this.shake) return;
    const me = this.world?.entities.get(this.world.playerId);
    if (me && Math.hypot(me.pos.x - cx, me.pos.z - cz) <= 12) this.shake(0.08);
  }

  private stepPrayers(world: IWorld, dt: number): boolean {
    let any = false;
    for (const p of this.prayers) {
      if (p.pilgrimId < 0) {
        this.shown(p, false);
        continue;
      }
      const pilgrim = world.entities.get(p.pilgrimId);
      const prayer =
        pilgrim && !pilgrim.dead ? auraOf(pilgrim.auras, TEMPLE_VIGIL_PRAYER) : undefined;
      const singer = world.entities.get(p.singerId);
      if (!pilgrim || !prayer || prayer.sourceId !== p.singerId || !singer || singer.dead) {
        p.pilgrimId = -1;
        p.singerId = -1;
        p.u.uAlpha.value = 0;
        this.shown(p, false);
        continue;
      }
      p.age += dt;
      const size = vigilBubble(singer.templateId, this.bubbleSize);
      (p.u.uA.value as THREE.Vector3).set(
        pilgrim.pos.x,
        pilgrim.pos.y + pilgrimShrineUp(),
        pilgrim.pos.z,
      );
      (p.u.uB.value as THREE.Vector3).set(singer.pos.x, singer.pos.y + size.up, singer.pos.z);
      p.u.uWidth.value = 0.16;
      p.u.uSag.value = -0.08;
      p.u.uReach.value = Math.min(1, p.age / 0.3);
      p.u.uAlpha.value = 1;
      this.shown(p, true);
      any = true;
    }
    return any;
  }

  private stepOaths(world: IWorld, dt: number): boolean {
    let any = false;
    const flicker = this.calm() ? 0 : 1;
    for (const o of this.oaths) {
      if (o.guardId < 0) {
        this.shown(o.chain, false);
        this.shown(o.shield, false);
        continue;
      }
      const guard = world.entities.get(o.guardId);
      const singer = world.entities.get(o.singerId);
      const keep = guard && !guard.dead ? auraOf(guard.auras, TEMPLE_OATH_KEEPER) : undefined;
      const oath = singer && !singer.dead ? auraOf(singer.auras, TEMPLE_MOONSET_OATH) : undefined;
      if (
        !guard ||
        !singer ||
        !keep ||
        keep.sourceId !== o.singerId ||
        !oath ||
        oath.sourceId !== o.guardId
      ) {
        o.guardId = -1;
        o.singerId = -1;
        o.chain.u.uAlpha.value = 0;
        o.shield.u.uSize.value = 0;
        this.shown(o.chain, false);
        this.shown(o.shield, false);
        continue;
      }
      o.age += dt;
      const dist = Math.hypot(guard.pos.x - singer.pos.x, guard.pos.z - singer.pos.z);
      const tension = oathTension(dist, this.n.oath.range);
      const gh = templeBodyHeight(guard.templateId);
      const sh = templeBodyHeight(singer.templateId);
      (o.chain.u.uA.value as THREE.Vector3).set(guard.pos.x, guard.pos.y + gh * 0.6, guard.pos.z);
      (o.chain.u.uB.value as THREE.Vector3).set(
        singer.pos.x,
        singer.pos.y + sh * 0.55,
        singer.pos.z,
      );
      o.chain.u.uWidth.value = 0.22;
      // A slack chain sags; a taut one runs straight.
      o.chain.u.uSag.value = 0.12 * (1 - tension);
      o.chain.u.uReach.value = Math.min(1, o.age / 0.25);
      o.chain.u.uTension.value = tension;
      o.chain.u.uFlicker.value = flicker;
      o.chain.u.uLen.value = Math.max(1, dist);
      o.chain.u.uAlpha.value = 1;
      o.shield.mesh.position.set(singer.pos.x, singer.pos.y + sh + 1.3, singer.pos.z);
      o.shield.u.uSize.value = 1.9 * Math.min(1, o.age / 0.25);
      o.shield.u.uTension.value = tension;
      o.shield.u.uAlpha.value = 1;
      this.shown(o.chain, true);
      this.shown(o.shield, true);
      any = true;
    }
    return any;
  }

  private stepEchoes(world: IWorld, clock: number): boolean {
    let any = false;
    const spec = this.zones[TEMPLE_LULLABY_ECHO];
    for (const s of this.echoes) {
      if (s.sleeperId < 0) continue;
      const e = world.entities.get(s.sleeperId);
      if (!e || e.dead || !auraOf(e.auras, TEMPLE_LULLABY_ECHO)) {
        s.sleeperId = -1;
        s.group.visible = false;
        continue;
      }
      const fill = echoRingFill(
        clock - s.since,
        s.beatAt < 0 ? -1 : clock - s.beatAt,
        this.n.echo.delay,
        this.n.echo.every,
      );
      const y = this.groundY(e.pos.x, e.pos.z);
      this.kit.drapeFan(s, this.groundY, e.pos.x, y, e.pos.z, clock * 0.6, spec.radius);
      this.kit.paintFan(s, this.paintOf(fill, clock, spec.radius));
      // Sleep motes drifting up off the sleeper.
      if (this.rand() < 0.3 * this.density) {
        const a = this.rand() * Math.PI * 2;
        this.emit(
          e.pos.x + Math.cos(a) * 0.5,
          e.pos.y + 1.8,
          e.pos.z + Math.sin(a) * 0.5,
          Math.cos(a) * 0.3,
          0.7,
          Math.sin(a) * 0.3,
          1.4,
          0.35,
          0.1,
          1,
          0.7,
          0.92,
          0.85,
        );
      }
      any = true;
    }
    return any;
  }

  private stepEyes(world: IWorld, dt: number, clock: number): boolean {
    let any = false;
    const calm = this.calm();
    for (const s of this.eyes) {
      if (s.lurkerId < 0) {
        this.shown(s.eye, false);
        this.shown(s.rim, false);
        continue;
      }
      const e = world.entities.get(s.lurkerId);
      if (!e) {
        this.freeEye(s);
        continue;
      }
      const gy = this.groundY(e.pos.x, e.pos.z);
      s.eye.mesh.position.set(e.pos.x, gy + gazeEyeUp(), e.pos.z);
      s.rim.mesh.position.set(e.pos.x, gy + 0.06, e.pos.z);
      s.rim.mesh.scale.setScalar(this.n.gaze.range);
      if (s.flash >= 0) {
        // Landed: the eye flares wide and a prism ring races to the reach.
        s.flash += dt;
        const k = Math.min(1, s.flash / GAZE_FLASH_SECONDS);
        const wave = trashWave(s.flash, GAZE_FLASH_SECONDS, this.waveLook);
        s.eye.u.uSize.value = GAZE_EYE_SIZE * (1 + 0.5 * k);
        s.eye.u.uOpen.value = 1;
        s.eye.u.uIris.value = 1;
        s.eye.u.uBlaze.value = 1;
        s.eye.u.uFlash.value = (calm ? 0.45 : 1) * (1 - k);
        s.eye.u.uAlpha.value = 1 - k * k;
        s.rim.u.uWave.value = wave.reach;
        s.rim.u.uAlpha.value = wave.alpha;
        if (s.flash >= GAZE_FLASH_SECONDS) this.freeEye(s);
        else {
          this.shown(s.eye, true);
          this.shown(s.rim, true);
          any = true;
        }
        continue;
      }
      const casting = !e.dead && e.castingAbility === TEMPLE_PRISM_GLARE && e.castTotal > 0;
      if (casting) {
        s.fill = Math.min(1, Math.max(0, 1 - e.castRemaining / e.castTotal));
        s.fade = -1;
      } else if (s.fade < 0) s.fade = 0;
      let alpha = 1;
      if (s.fade >= 0) {
        // The bar broke (a stun): the eye shuts and dims.
        s.fade += dt;
        s.fill = Math.max(0, s.fill - dt * 4);
        alpha = Math.max(0, 1 - s.fade / 0.3);
        if (alpha <= 0) {
          this.freeEye(s);
          continue;
        }
      }
      const look = gazeEyeLook(s.fill, clock, calm, this.eyeLook);
      s.eye.u.uSize.value = GAZE_EYE_SIZE * (0.75 + 0.25 * look.open);
      s.eye.u.uOpen.value = look.open;
      s.eye.u.uIris.value = look.iris;
      s.eye.u.uBlaze.value = look.blaze;
      s.eye.u.uPulse.value = look.pulse;
      s.eye.u.uFlash.value = 0;
      s.eye.u.uAlpha.value = alpha;
      s.rim.u.uWave.value = 0;
      s.rim.u.uAlpha.value = alpha * (0.35 + 0.5 * s.fill);
      this.shown(s.eye, true);
      this.shown(s.rim, true);
      any = true;
      if (casting) this.stalkBlaze(e, s, dt, look.blaze, gy);
    }
    return any;
  }

  private freeEye(s: EyeSlot): void {
    if (s.lurkerId >= 0) {
      s.lastLurker = s.lurkerId;
      s.freedAt = this.uTime.value;
    }
    s.lurkerId = -1;
    s.flash = -1;
    s.fade = -1;
    s.eye.u.uSize.value = 0;
    s.rim.u.uAlpha.value = 0;
    this.shown(s.eye, false);
    this.shown(s.rim, false);
  }

  /** Rainbow light pouring up off the lurker's stalked eyes as it charges. */
  private stalkBlaze(e: EntityView, s: EyeSlot, dt: number, blaze: number, gy: number): void {
    s.blazeDebt += (30 + 90 * blaze) * this.density * dt;
    const h = templeBodyHeight(e.templateId);
    const fx = Math.sin(e.facing);
    const fz = Math.cos(e.facing);
    while (s.blazeDebt >= 1) {
      s.blazeDebt -= 1;
      const side = this.rand() < 0.5 ? -1 : 1;
      this.color.setHSL((this.uTime.value * 0.4 + this.rand() * 0.5) % 1, 1, 0.68);
      this.emit(
        e.pos.x + fx * h * 0.42 + fz * side * 0.45,
        gy + h * 0.78,
        e.pos.z + fz * h * 0.42 - fx * side * 0.45,
        fz * side * 0.6 + (this.rand() - 0.5),
        2.5 + 3 * blaze * this.rand(),
        -fx * side * 0.6 + (this.rand() - 0.5),
        0.5 + this.rand() * 0.3,
        0.45 + 0.3 * blaze,
        0.08,
        this.color.r,
        this.color.g,
        this.color.b,
        1,
        0,
        0.8,
      );
    }
  }

  /** Rainbow motes round each dazzled head, and the local player's veil. */
  private stepDazzle(world: IWorld, dt: number, clock: number): boolean {
    let any = false;
    this.sparkleDebt += 26 * this.density * dt;
    const emits = Math.floor(this.sparkleDebt);
    this.sparkleDebt -= emits;
    for (const id of this.dazzled) {
      const p = world.entities.get(id);
      if (!p || p.dead || !auraOf(p.auras, TEMPLE_PRISM_DAZZLE)) continue;
      any = true;
      for (let i = 0; i < emits; i++) {
        const a = this.rand() * Math.PI * 2;
        this.color.setHSL((idHue(id) + clock * 0.5 + this.rand() * 0.3) % 1, 1, 0.7);
        this.emit(
          p.pos.x + Math.cos(a) * 0.55,
          p.pos.y + 2 + (this.rand() - 0.5) * 0.4,
          p.pos.z + Math.sin(a) * 0.55,
          -Math.sin(a) * 1.6,
          0.25,
          Math.cos(a) * 1.6,
          0.55,
          0.3,
          0.05,
          this.color.r,
          this.color.g,
          this.color.b,
          1,
          0,
          0.2,
        );
      }
    }
    const me = world.entities.get(world.playerId);
    const mine = me && !me.dead ? auraOf(me.auras, TEMPLE_PRISM_DAZZLE) : undefined;
    if (mine) {
      if (this.dazzleSeen < 0) {
        this.dazzleSeen = 1;
        this.dazzleSince = clock;
      }
      const v = dazzleVeil(
        mine.remaining,
        mine.duration,
        clock - this.dazzleSince,
        this.calm(),
        this.veilLook,
      );
      this.veil.paint(v.edge, v.flash, this.calm());
      any = true;
    } else {
      this.dazzleSeen = -1;
      this.veil.paint(0, 0, false);
    }
    return any;
  }

  private stepVortices(world: IWorld, dt: number, clock: number): boolean {
    let any = false;
    const core = this.zones[TEMPLE_SPIRAL_WHIRLPOOL];
    for (const v of this.vortices) {
      if (v.snapperId < 0) {
        this.shown(v, false);
        continue;
      }
      const e = world.entities.get(v.snapperId);
      if (!e || e.dead || !auraOf(e.auras, TEMPLE_SPIRAL_WHIRLPOOL)) {
        v.snapperId = -1;
        v.core.group.visible = false;
        v.mesh.scale.setScalar(1e-4);
        this.shown(v, false);
        continue;
      }
      const age = clock - v.since;
      const look = whirlpoolLook(age, this.n.whirl.pull, this.n.whirl.radius, this.whirlLook);
      const bite = whirlCoreFill(age, this.n.whirl.tick);
      const gy = this.groundY(e.pos.x, e.pos.z);
      v.mesh.position.set(e.pos.x, gy + 0.05, e.pos.z);
      v.mesh.scale.setScalar(Math.max(1e-4, this.n.whirl.radius * look.grow));
      v.u.uSpin.value = look.spin;
      v.u.uCore.value = this.n.whirl.radius > 0 ? this.n.whirl.core / this.n.whirl.radius : 0;
      // The core flares on the bite and settles.
      v.u.uBite.value = bite > 0.85 ? (bite - 0.85) / 0.15 : Math.max(0, 1 - bite * 5);
      v.u.uAlpha.value = look.grow;
      this.kit.drapeFan(
        v.core,
        this.groundY,
        e.pos.x,
        gy,
        e.pos.z,
        -clock * look.spin,
        core.radius,
      );
      this.kit.paintFan(v.core, this.paintOf(bite, clock, core.radius));
      this.shown(v, true);
      any = true;
      // Spray wheeling round the shell, drawn inward.
      v.sprayDebt += 40 * this.density * dt;
      while (v.sprayDebt >= 1) {
        v.sprayDebt -= 1;
        const a = this.rand() * Math.PI * 2;
        const r = this.n.whirl.radius * (0.3 + 0.7 * this.rand());
        const tang = r * look.spin;
        this.emit(
          e.pos.x + Math.cos(a) * r,
          gy + 0.25 + this.rand() * 0.5,
          e.pos.z + Math.sin(a) * r,
          -Math.sin(a) * tang - Math.cos(a) * this.n.whirl.pull,
          1.2 + this.rand(),
          Math.cos(a) * tang - Math.sin(a) * this.n.whirl.pull,
          0.7,
          0.38,
          0.1,
          0.75,
          0.97,
          1,
          0.85,
          -3,
          0.4,
        );
      }
    }
    return any;
  }

  /** Lightning crawling over the eel's jaws while the spark charges. */
  private stepSparkers(world: IWorld, dt: number): boolean {
    let any = false;
    for (const id of this.sparkers) {
      const e = world.entities.get(id);
      if (!e || e.dead || e.castingAbility !== TEMPLE_ARCING_SPARK || e.castTotal <= 0) continue;
      any = true;
      const fill = 1 - e.castRemaining / e.castTotal;
      // A debt, so the crackle holds its rate on any frame rate and tier.
      this.crackleDebt += (120 + 360 * fill) * this.density * dt;
      const n = Math.floor(this.crackleDebt);
      this.crackleDebt -= n;
      const y = e.pos.y + eelJawUp();
      for (let i = 0; i < n; i++) {
        const a = this.rand() * Math.PI * 2;
        const el = (this.rand() - 0.5) * 2;
        const s = 3 + this.rand() * 4;
        this.emit(
          e.pos.x + Math.cos(a) * 0.4,
          y + el * 0.3,
          e.pos.z + Math.sin(a) * 0.4,
          Math.cos(a) * s,
          el * s,
          Math.sin(a) * s,
          0.12 + this.rand() * 0.1,
          0.35,
          0.05,
          0.75,
          0.92,
          1,
          1,
          0,
          3,
        );
      }
    }
    return any;
  }

  private stepBolts(world: IWorld | undefined, dt: number): boolean {
    let any = false;
    for (const b of this.bolts) {
      if (b.age < 0) {
        b.main.u.uAlpha.value = 0;
        b.branch.u.uAlpha.value = 0;
        b.main.u.uWidth.value = 0;
        b.branch.u.uWidth.value = 0;
        this.shown(b.main, false);
        this.shown(b.branch, false);
        continue;
      }
      b.age += dt;
      const after = b.age - b.index * SPARK_HOP_STAGGER;
      // Follow the bodies while they stand (the struck reel, the eel sways).
      this.boltEnd(world?.entities.get(b.fromId), b.a, true);
      this.boltEnd(world?.entities.get(b.toId), b.b, false);
      const look = sparkArcLook(b.age, b.index, this.arcLook);
      if (!b.struck && after >= 0) {
        b.struck = true;
        this.sparkImpact(b.b);
      }
      if (after >= SPARK_ARC_SECONDS) {
        b.age = -1;
        continue;
      }
      const m = b.main.u;
      (m.uA.value as THREE.Vector3).copy(b.a);
      (m.uB.value as THREE.Vector3).copy(b.b);
      m.uWidth.value = look.alpha > 0 ? 0.22 : 0;
      m.uJag.value = 0.16;
      m.uSag.value = 0;
      m.uReach.value = look.reach;
      m.uAlpha.value = look.alpha;
      // A fork off the main arc's middle toward the floor beside the struck.
      const br = b.branch.u;
      const bA = br.uA.value as THREE.Vector3;
      bA.copy(b.a).lerp(b.b, 0.45);
      (br.uB.value as THREE.Vector3).set(
        b.b.x + Math.sin(b.index * 2.1 + b.toId) * 1.6,
        b.b.y - 1.1,
        b.b.z + Math.cos(b.index * 2.1 + b.toId) * 1.6,
      );
      br.uWidth.value = look.alpha > 0 ? 0.1 : 0;
      br.uJag.value = 0.22;
      br.uSag.value = 0;
      br.uReach.value = look.reach;
      br.uAlpha.value = look.alpha * 0.7;
      this.shown(b.main, true);
      this.shown(b.branch, true);
      any = true;
    }
    return any;
  }

  /** The arc strikes: white-blue sparks fly off the struck. */
  private sparkImpact(at: THREE.Vector3): void {
    const n = Math.round(36 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const el = (this.rand() - 0.2) * 1.6;
      const s = 4 + this.rand() * 7;
      this.emit(
        at.x,
        at.y,
        at.z,
        Math.cos(a) * Math.cos(el) * s,
        Math.sin(el) * s,
        Math.sin(a) * Math.cos(el) * s,
        0.25 + this.rand() * 0.25,
        0.4,
        0.05,
        0.8,
        0.93,
        1,
        1,
        -18,
        1.2,
      );
    }
  }

  private stepSwells(world: IWorld, clock: number): boolean {
    let any = false;
    for (const s of this.swells) {
      if (s.wispId < 0) {
        this.shown(s, false);
        continue;
      }
      const e = world.entities.get(s.wispId);
      const swell = e && !e.dead ? auraOf(e.auras, TEMPLE_SWOLLEN_TIDE) : undefined;
      if (!e || !swell) {
        s.wispId = -1;
        s.ring.group.visible = false;
        s.mesh.scale.setScalar(1e-4);
        this.shown(s, false);
        continue;
      }
      const look = wispSwellLook(swell.value, this.swellLook);
      const wobble = 1 + 0.04 * Math.sin(clock * 5 + s.wispId);
      s.mesh.position.set(e.pos.x, e.pos.y + wispCoreUp(), e.pos.z);
      s.mesh.scale.set(look.radius * wobble, look.radius / wobble, look.radius * wobble);
      s.u.uCore.value = look.core;
      s.u.uAlpha.value = 1;
      const radius = wispBurstRadius(swell.value, this.n);
      const gy = this.groundY(e.pos.x, e.pos.z);
      this.kit.drapeFan(s.ring, this.groundY, e.pos.x, gy, e.pos.z, clock * 1.4, radius);
      this.kit.paintFan(s.ring, this.paintOf(0.55 + 0.25 * Math.sin(clock * 4), clock, radius));
      this.shown(s, true);
      any = true;
    }
    return any;
  }

  private stepCrusts(world: IWorld): boolean {
    let any = false;
    for (const c of this.crusts) {
      if (c.playerId < 0) {
        this.shown(c, false);
        continue;
      }
      const p = world.entities.get(c.playerId);
      const chill = p && !p.dead ? auraOf(p.auras, TEMPLE_TIDEWISP_CHILL) : undefined;
      if (!p || !chill) {
        c.playerId = -1;
        c.mesh.scale.setScalar(1e-4);
        this.shown(c, false);
        continue;
      }
      const amount = chillCrust(chill.remaining, this.n.wisp.chillSeconds || chill.duration);
      c.mesh.position.set(p.pos.x, p.pos.y + 0.5, p.pos.z);
      c.mesh.scale.setScalar(1);
      c.u.uAmount.value = amount;
      this.shown(c, true);
      any = true;
      if (this.rand() < 0.25 * this.density) {
        const a = this.rand() * Math.PI * 2;
        this.emit(
          p.pos.x + Math.cos(a) * 0.5,
          p.pos.y + this.rand() * amount,
          p.pos.z + Math.sin(a) * 0.5,
          0,
          0.3,
          0,
          0.6,
          0.25,
          0.05,
          0.85,
          0.97,
          1,
          0.9,
        );
      }
    }
    return any;
  }

  private stepWaves(dt: number): boolean {
    let any = false;
    for (const w of this.waves) {
      if (w.age < 0) {
        this.shown(w, false);
        continue;
      }
      w.age += dt;
      if (w.age >= w.life) {
        w.age = -1;
        w.mesh.scale.setScalar(1e-4);
        this.shown(w, false);
        continue;
      }
      const look = trashWave(w.age, w.life, this.waveLook);
      w.u.uReach.value = look.reach;
      w.u.uAlpha.value = look.alpha;
      this.shown(w, true);
      any = true;
    }
    return any;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.veil.dispose();
    this.glow.dispose();
    this.mist.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

/** A ribbon's strip: `stations` pairs of vertices along aT 0..1, aSide -1/1
 *  (positions are the vertex shader's; the attribute only sizes the draw). */
function ribbonGeometry(stations: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = stations * 2;
  const t = new Float32Array(n);
  const side = new Float32Array(n);
  for (let i = 0; i < stations; i++) {
    const k = i / (stations - 1);
    t[i * 2] = k;
    t[i * 2 + 1] = k;
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  const index: number[] = [];
  for (let i = 0; i + 1 < stations; i++) {
    const b = i * 2;
    index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  g.setIndex(index);
  return g;
}

function ribbonUniforms(): Uniforms {
  return {
    uA: { value: new THREE.Vector3() },
    uB: { value: new THREE.Vector3() },
    uWidth: { value: 0 },
    uJag: { value: 0 },
    uSag: { value: 0 },
    uSeed: { value: 0 },
    uReach: { value: 1 },
  };
}
