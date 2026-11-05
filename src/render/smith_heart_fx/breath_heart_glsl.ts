// The Knotted Gale's own shaders (breath_heart_fx.ts): the portal's swirling floor,
// its funnel of wind, the link of light, a letter that always faces the camera, the
// fuse's ring and the burst's wall. Everything goes through three's modelViewMatrix on
// a positioned mesh, safe in the instance bands (tests/camera_relative_floor_shaders).
// The ball itself is the Storm Orb's (final_kit_glsl.ts ORB_FRAG, ORB_CORE_FRAG).

import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';

/** A plain uv and height pass. */
export const HEART_UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** A portal's mouth on the floor: arms of wind wound into the centre. uArms and
 *  uSpin tell the pairs apart by pattern as well as colour (the first pair four
 *  arms turning one way; the second three, turning the other, inside a doubled
 *  rim: uRing2 is 1 for it). */
export const PORTAL_DISC_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpen;
uniform vec3 uColor;
uniform float uArms;
uniform float uSpin;
uniform float uRing2;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float arms = 0.5 + 0.5 * sin(a * uArms + uSpin * (r * 11.0 - uTime * 5.0));
  arms = pow(max(arms, 0.0), 2.0);
  float rim = smoothstep(0.82, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r));
  rim += uRing2 * smoothstep(0.62, 0.68, r) * (1.0 - smoothstep(0.7, 0.76, r));
  float eye = 1.0 - smoothstep(0.0, 0.3, r);
  vec3 col = uColor * (0.25 + 1.1 * arms * (1.0 - r * 0.5)) + uColor * rim * 1.7 + vec3(1.0) * eye * 0.3;
  gl_FragColor = vec4(col, (0.55 * arms + rim + eye * 0.3 + 0.18) * uOpen);
}
`;

/** A portal's funnel of wind: bands climbing and turning, fading to the top
 *  (uSpin -1 turns the second pair's the other way). */
export const PORTAL_FUNNEL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpen;
uniform vec3 uColor;
uniform float uSpin;
varying vec2 vUv;
void main() {
  float bands = 0.5 + 0.5 * sin(uSpin * vUv.x * 37.7 + vUv.y * 9.0 - uTime * 7.0);
  bands = pow(max(bands, 0.0), 3.0);
  float fade = pow(max(1.0 - vUv.y, 0.0), 1.4) * smoothstep(0.0, 0.06, vUv.y);
  gl_FragColor = vec4(uColor * (0.5 + 1.3 * bands), (0.15 + 0.75 * bands) * fade * uOpen);
}
`;

/** The link of light within a pair, a tube of light (an open cylinder along z,
 *  unit radius and length): `vAlong` 0 at the first portal (A or C) and 1 at
 *  its partner, `vFace` 1 where the tube faces the eye and 0 at its silhouette,
 *  so it reads as a round beam from any side (the audit's point 15: the old
 *  flat ribbon thinned to a line seen along it). */
export const PORTAL_LINK_VERT = /* glsl */ `
varying vec2 vUv;
varying float vAlong;
varying float vFace;
void main() {
  vUv = uv;
  vAlong = position.z + 0.5;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFace = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;

/** The link's light: the first portal's colour running into its partner's, a
 *  white-hot core, energy flowing along it and a pulse racing from one to the
 *  other. uBraid 0 is the first pair's one round beam; 1 is the second pair's
 *  two strands wound round each other, so the links read apart where they
 *  cross. Its ends melt into the portals' funnels. */
export const PORTAL_LINK_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform float uBraid;
uniform float uLen;
varying vec2 vUv;
varying float vAlong;
varying float vFace;
void main() {
  float t = vAlong;
  float body = vFace * vFace;
  float core = body * body * body;
  // Energy flowing from the first portal to its partner, a twist about every
  // three yards whatever the link's length.
  float flow = 0.5 + 0.5 * sin(t * uLen * 1.4 - uTime * 6.0 + vUv.x * 6.2832);
  float pulse = 0.5 + 0.5 * sin(t * uLen * 0.3 - uTime * 3.2);
  pulse = pulse * pulse;
  pulse = pulse * pulse * pulse;
  float wind = abs(fract(vUv.x * 2.0 + t * uLen * 0.33 - uTime * 0.9) - 0.5);
  float strands = 1.0 - smoothstep(0.07, 0.17, wind);
  float beam = body * 0.5 + core * 0.95;
  float braid = strands * (0.35 + 0.65 * vFace) + core * 0.3;
  float across = mix(beam, braid, uBraid);
  float ends = smoothstep(0.0, 0.05, t) * smoothstep(0.0, 0.05, 1.0 - t);
  vec3 col = mix(uA, uB, smoothstep(0.1, 0.9, t)) * (0.75 + 0.35 * flow + 1.3 * pulse);
  col += vec3(1.0, 0.98, 0.95) * core * (0.45 + 0.5 * pulse);
  gl_FragColor = vec4(col, across * (0.55 + 0.45 * flow) * ends);
}
`;

/** A flat shape that always faces the camera (the letter over a marked
 *  player); `vP` its own shape's coordinates for its light. */
export const FACING_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  gl_Position = projectionMatrix * mv;
}
`;

/** A portal's letter laid flat in its mouth, turned on the floor to the
 *  camera's bearing so it always reads upright to the viewer (a fixed decal
 *  read upside down from the far side; Part C of the bot pass, 2026-11-04).
 *  The shape's x/y in yards, scaled by the mesh. */
export const FLOOR_FACING_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
void main() {
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 toCam = cameraPosition.xz - c.xz;
  toCam = length(toCam) > 1e-4 ? normalize(toCam) : vec2(0.0, 1.0);
  vec2 up = -toCam;
  vec2 right = vec2(-up.y, up.x);
  float s = length(modelMatrix[0].xyz);
  vec2 xz = c.xz + (right * position.x + up * position.y) * s;
  gl_Position = projectionMatrix * wocCamRelView(vec3(xz.x, c.y, xz.y));
}
`;

/** The floor letter's flat ink. */
export const FLOOR_LETTER_FRAG = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
}
`;

/** The letter's light (audit point 37: a flat fill): brighter at its top, a
 *  slow pulse of light running up through it. */
export const FACING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vP;
void main() {
  float up = clamp((vP.y + 0.7) / 1.4, 0.0, 1.0);
  float run = 0.5 + 0.5 * sin(vP.y * 6.0 - uTime * 3.0);
  vec3 col = uColor * (1.05 + 0.55 * up + 0.25 * run);
  col = mix(col, vec3(1.0), 0.18 * up * run);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** A band of storm light on a unit ring (the fuse's ring, the marks, the
 *  load's; audit point 37: a flat white stroke): its edge wavering and
 *  crackling, a spark running round it, a soft glow falling inward, and a
 *  filling disc inside it (a mark's coming portal). */
export const HEART_RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uFill;
uniform float uTime;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float wob = (n(vec2(a * 6.0, uTime * 2.0)) - 0.5) * 0.035;
  float band = smoothstep(0.84 + wob, 0.91 + wob, r) * (1.0 - smoothstep(0.95 + wob, 1.0, r));
  float crackle = smoothstep(0.5, 0.9, n(vec2(a * 14.0 - uTime * 3.0, r * 6.0 + uTime)));
  float spark = max(0.0, sin(a * 3.0 - uTime * 4.0));
  spark = spark * spark;
  spark = spark * spark * spark * spark;
  float glow = smoothstep(0.5, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r)) * 0.3;
  float inner = 1.0 - smoothstep(uFill - 0.05, uFill, r);
  vec3 col = uColor * (band * (0.75 + 0.6 * crackle) + 0.5 * inner + glow) + vec3(1.0) * spark * band * 0.7;
  gl_FragColor = vec4(col, (band * (0.7 + 0.3 * crackle) + 0.35 * inner + glow * 0.6) * uAlpha);
}
`;

/** The burst's wall of storm: a torn shell, brightest at its edge. */
export const BURST_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float bands = 0.5 + 0.5 * sin(vUv.x * 62.8 + vUv.y * 14.0 - uTime * 24.0);
  float fade = pow(max(1.0 - vUv.y, 0.0), 1.2);
  gl_FragColor = vec4(uColor * (0.8 + 1.2 * bands), (0.35 + 0.65 * bands) * fade * uAlpha);
}
`;
