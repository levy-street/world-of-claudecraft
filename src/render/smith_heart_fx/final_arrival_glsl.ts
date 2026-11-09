// The Masterless Strength's arrival shaders (final_arrival_beam.ts paints
// them; the timeline is final_arrival_core.ts). Every one is additive and
// unclamped (toneMapped off), so the bloom catches the light: the four veins
// running over the floor, the beam's swirl and its white core, the pool of
// light at its foot.

/** A ribbon on the floor: `aAlong` 0 at the altar to 1 at the boss, `aSide`
 *  -1 to 1 across it, `aVein` the vein's index. */
export const ARRIVAL_STREAM_VERT = /* glsl */ `
attribute float aAlong;
attribute float aSide;
attribute float aVein;
varying float vAlong;
varying float vSide;
varying float vVein;
void main() {
  vAlong = aAlong;
  vSide = aSide;
  vVein = aVein;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Each vein's light running down its channel: a white-hot head at its
 *  front, a body of flowing light behind it in the vein's colour, a hot core
 *  line down its middle. */
export const ARRIVAL_STREAM_FRAG = /* glsl */ `
uniform vec4 uFront;
uniform vec4 uLevel;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uTime;
uniform float uLength;
varying float vAlong;
varying float vSide;
varying float vVein;
float h1(float p) { return fract(sin(p * 127.1) * 43758.5453); }
float n1(float p) {
  float i = floor(p);
  float f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(h1(i), h1(i + 1.0), f);
}
void main() {
  int v = int(vVein + 0.5);
  float front = v == 0 ? uFront.x : v == 1 ? uFront.y : v == 2 ? uFront.z : uFront.w;
  float level = v == 0 ? uLevel.x : v == 1 ? uLevel.y : v == 2 ? uLevel.z : uLevel.w;
  vec3 c = v == 0 ? uC0 : v == 1 ? uC1 : v == 2 ? uC2 : uC3;
  if (front < 0.0 || level < 0.002) discard;
  // Yards behind the front (negative: ahead of it, still dark).
  float behind = (front - vAlong) * uLength;
  if (behind < -2.5) discard;
  float lit = smoothstep(-0.6, 1.2, behind);
  float head = exp(-behind * behind * 0.18);
  float yd = vAlong * uLength;
  float flow = 0.55 + 0.45 * n1(yd * 0.55 - uTime * 9.0) + 0.25 * sin(yd * 0.9 - uTime * 14.0);
  float s2 = vSide * vSide;
  float edge = exp(-s2 * 2.2);
  float core = exp(-s2 * 22.0);
  vec3 col = c * (lit * (1.1 * edge + 2.2 * core) * flow + head * 5.0 * edge);
  col += vec3(1.0, 0.96, 0.88) * (lit * core * 0.8 * flow + head * core * 5.0);
  gl_FragColor = vec4(col * level, 1.0);
  #include <colorspace_fragment>
}
`;

/** The beam's cylinders: the uv's height share and how square-on the
 *  surface faces the eye (its middle burns, its rim fades). */
export const ARRIVAL_BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;

/** The swirl: the four colours wound up the column in helices turning as
 *  they climb, streaks of light racing up it, the foot flaring, the top
 *  dissolving into the sky. */
export const ARRIVAL_SWIRL_FRAG = /* glsl */ `
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uTime;
uniform float uHeight;
uniform float uGlow;
uniform float uDetail;
varying vec2 vUv;
varying float vFacing;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float yy = vUv.y * uHeight;
  float a = vUv.x * 6.2831853;
  vec3 vc[4];
  vc[0] = uC0; vc[1] = uC1; vc[2] = uC2; vc[3] = uC3;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float ph = a + float(i) * 1.5707963 - yy * 0.07 + uTime * 3.0;
    float band = pow(max(0.5 + 0.5 * sin(ph), 0.0), 6.0);
    col += vc[i] * band;
  }
  float streak = n2(vec2(vUv.x * 44.0, yy * 0.035 - uTime * 2.6));
  streak = mix(0.75, 0.35 + 1.1 * streak * streak, uDetail);
  float body = pow(clamp(vFacing, 0.0, 1.0), 1.1);
  float top = 1.0 - smoothstep(0.7, 1.0, vUv.y);
  float foot = 1.0 + 1.4 * exp(-yy * 0.09);
  vec3 c = col * 1.9 * streak * body * top * foot * uGlow;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

/** The white-hot core: brightest square-on, flickering as it pours up. */
export const ARRIVAL_CORE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHeight;
uniform float uGlow;
varying vec2 vUv;
varying float vFacing;
void main() {
  float yy = vUv.y * uHeight;
  float flick = 0.85 + 0.15 * sin(yy * 0.4 - uTime * 30.0) * sin(yy * 0.13 - uTime * 11.0);
  float body = pow(clamp(vFacing, 0.0, 1.0), 2.5);
  float top = 1.0 - smoothstep(0.8, 1.0, vUv.y);
  vec3 hot = mix(vec3(1.0, 0.82, 0.5), vec3(1.0, 0.98, 0.94), pow(clamp(vFacing, 0.0, 1.0), 2.0));
  gl_FragColor = vec4(hot * body * top * flick * 2.4 * uGlow, 1.0);
  #include <colorspace_fragment>
}
`;

/** A flat disc's local position (its radius in x, z: -1 to 1). */
export const ARRIVAL_POOL_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The pool of light at the beam's foot: the four colours turning round a
 *  white heart, falling away to the rim. */
export const ARRIVAL_POOL_FRAG = /* glsl */ `
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uTime;
uniform float uGlow;
varying vec2 vP;
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float a = atan(vP.y, vP.x);
  vec3 vc[4];
  vc[0] = uC0; vc[1] = uC1; vc[2] = uC2; vc[3] = uC3;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float ph = a + float(i) * 1.5707963 + r * 5.0 - uTime * 2.4;
    col += vc[i] * pow(max(0.5 + 0.5 * sin(ph), 0.0), 4.0);
  }
  float fall = pow(max(1.0 - r, 0.0), 2.2);
  float heart = exp(-r * r * 30.0);
  vec3 c = col * fall * 1.3 + vec3(1.0, 0.95, 0.86) * heart * 2.2;
  gl_FragColor = vec4(c * uGlow, 1.0);
  #include <colorspace_fragment>
}
`;
