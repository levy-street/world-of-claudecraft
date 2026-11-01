// The Anvil falling apart's shaders (heart_collapse.ts): the ring's abyss at the very
// end (depth faked by parallax along the view ray, in the mesh's own yards, so the
// instance bands' far coordinates never touch it), the warning cracks glowing in the
// quarter's element, the ember line along a fallen quarter's exact edge, and the dust.

const NOISE = /* glsl */ `
float hH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hN(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hH(i), hH(i + vec2(1, 0)), f.x), mix(hH(i + vec2(0, 1)), hH(i + vec2(1, 1)), f.x), f.y);
}
float hF(vec2 p) { return hN(p) * 0.55 + hN(p * 2.1 + 3.1) * 0.3 + hN(p * 4.3 + 7.7) * 0.15; }
`;

export const COLLAPSE_VERT = /* glsl */ `
attribute float aEdge;
varying vec3 vL;
varying vec3 vCam;
varying float vEdge;
void main() {
  vL = position;
  vEdge = aEdge;
  // The camera in the mesh's own yards (direction only: the parallax's ray).
  vCam = cameraPosition - modelMatrix[3].xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** The ember line on the ground left standing: brightest on the exact edge, broken up
 *  along it, a slow glow that keeps the edge readable on every tier. */
export const LIP_VERT = /* glsl */ `
attribute float aEdge;
varying vec3 vL;
varying float vEdge;
void main() {
  vL = position;
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const LIP_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHeat;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec3 vL;
varying float vEdge;
${NOISE}
void main() {
  float n = hF(vL.xz * 0.7 + vec2(uTime * 0.05, 0.0));
  float reach = 1.0 - smoothstep(0.1 + 0.5 * n, 0.95, vEdge);
  float line = 1.0 - smoothstep(0.0, 0.22, vEdge);
  float beat = 0.82 + 0.18 * sin(uTime * 1.7 + n * 9.0);
  vec3 col = mix(uColor, uHot, line * (0.35 + 0.65 * uHeat));
  col *= (reach * 0.42 + line * 0.75) * (0.75 + 1.6 * uHeat) * beat;
  gl_FragColor = vec4(col, 1.0);
}`;

/** The depth under a fallen quarter: a layer of the heart's light and its smoke, soft at
 *  its edge, each layer its own drift, so looking down through the hole has parallax. */
export const DEPTH_VERT = /* glsl */ `
varying vec3 vL;
void main() {
  vL = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const DEPTH_FRAG = /* glsl */ `
uniform float uTime;
uniform float uK;
uniform float uScale;
uniform float uSeed;
varying vec3 vL;
${NOISE}
void main() {
  float r = length(vL.xz);
  vec2 p = vL.xz * uScale + uSeed;
  float n = hF(p + vec2(uTime * 0.035, -uTime * 0.05));
  float m = hF(p * 2.3 - vec2(uTime * 0.06, uTime * 0.02));
  float smoke = smoothstep(0.3, 0.8, n) * (0.55 + 0.45 * m);
  float edge = 1.0 - smoothstep(34.0, 76.0, r);
  float beat = 0.85 + 0.15 * sin(uTime * 2.856);
  // The heart's own light welling up under the ring, through the smoke further out.
  float well = 1.0 - smoothstep(8.0, 52.0, r);
  vec3 col = mix(vec3(1.0, 0.33, 0.07), vec3(1.0, 0.72, 0.36), smoke * smoke + well * well * 0.4);
  gl_FragColor = vec4(col * (smoke * edge + well * well * 0.5) * uK * beat, 1.0);
}`;

/** The veil of dark air over the heart's bed: thin at the heart, thick out at the bed's
 *  rim, drifting, gone before the crown. */
export const VEIL_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vL;
${NOISE}
void main() {
  float r = length(vL.xz);
  float n = hF(vL.xz * 0.03 + vec2(uTime * 0.012, -uTime * 0.02));
  float a = mix(0.62, 0.97, smoothstep(10.0, 62.0, r)) * (1.0 - smoothstep(92.0, 130.0, r));
  a = clamp(a - (n - 0.5) * 0.18, 0.0, 1.0);
  gl_FragColor = vec4(vec3(0.03, 0.017, 0.014), a);
}`;

/** The dust out of the breaks: heavy soft puffs in the room's own frame. Each starts
 *  with the floor under it (from the wall in), most hanging and spreading over the
 *  hole, some sinking away with what fell, lit warm from under as they go down. */
export const DUST_VERT = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aParams;
uniform float uFall;
varying vec2 vCorner;
varying float vA;
varying float vLow;
void main() {
  float r0 = length(position.xz);
  float u = clamp((r0 - 16.0) / 44.0, 0.0, 1.0);
  float t = uFall - (0.45 + (1.0 - u) * 1.1 + aParams.x * 0.9);
  float life = 2.6 + 2.6 * aParams.y;
  float k = clamp(t / life, 0.0, 1.0);
  vec3 p = position;
  float sinks = step(0.62, aParams.z);
  p.y = 0.5 + (1.0 - sinks) * (1.4 + 3.2 * aParams.w) * (1.0 - exp(-t * 0.9))
      - sinks * (2.0 * t + 4.0 * t * t);
  p.x += (aParams.w - 0.5) * 5.0 * k;
  p.z += (aParams.y - 0.5) * 5.0 * k;
  vCorner = aCorner;
  vA = step(0.0, t) * smoothstep(0.0, 0.12, k) * (1.0 - k) * (1.0 - k) * (0.28 + 0.3 * aParams.w);
  vLow = clamp(-p.y / 40.0, 0.0, 1.0);
  float size = (2.6 + 4.6 * aParams.x) * (0.55 + 1.5 * k) * step(0.0, t);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * size;
  gl_Position = projectionMatrix * mv;
}`;

export const DUST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uGlow;
varying vec2 vCorner;
varying float vA;
varying float vLow;
void main() {
  float d = length(vCorner);
  float a = (1.0 - smoothstep(0.1, 1.0, d)) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uColor, uGlow, vLow * 0.55), a);
  #include <colorspace_fragment>
}`;

/** The abyss: nearly black, smoke of the chasm's gold light far below, embers
 *  falling away, and a broken lip of rock at the edge, still hot from the break. */
export const ABYSS_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHeat;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec3 vL;
varying vec3 vCam;
varying float vEdge;
${NOISE}
void main() {
  vec3 ray = normalize(vL - vCam);
  float dy = max(0.18, -ray.y);
  vec2 flat2 = ray.xz / dy;
  vec3 col = vec3(0.006, 0.005, 0.008);
  // Layers of smoke, deeper and dimmer, lit from far below.
  for (int i = 0; i < 4; i++) {
    float d = 7.0 + float(i) * float(i) * 11.0;
    vec2 p = (vL.xz + flat2 * d) * (0.09 - float(i) * 0.012);
    float n = hF(p + vec2(uTime * 0.03, -uTime * 0.05) * (1.0 + float(i)));
    float s = smoothstep(0.42, 0.85, n);
    col += mix(vec3(0.30, 0.13, 0.05), uColor * 0.5, 0.35) * s * (0.03 + 0.05 * float(i));
  }
  // Embers sinking far under the lip.
  vec2 e = (vL.xz + flat2 * 22.0) * 0.55 + vec2(0.0, uTime * 0.35);
  vec2 g = floor(e);
  float spark = step(0.965, hH(g)) * smoothstep(0.3, 0.0, length(fract(e) - 0.5));
  col += uHot * spark * (0.6 + 0.4 * sin(uTime * 3.0 + hH(g) * 40.0));
  // The lip: broken rock a few yards wide, its break glowing and cooling.
  float lip = 1.0 - smoothstep(0.0, 1.0, vEdge + (hF(vL.xz * 0.9) - 0.5) * 0.55);
  float rock = 0.05 + 0.1 * hF(vL.xz * 1.6);
  col = mix(col, vec3(rock * 1.05, rock * 0.95, rock * 0.9), smoothstep(0.1, 0.55, lip));
  float seam = smoothstep(0.45, 0.62, lip) * (1.0 - smoothstep(0.62, 0.95, lip));
  col += mix(uColor, uHot, 0.4) * seam * (0.3 + 1.6 * uHeat);
  gl_FragColor = vec4(col, 1.0);
}`;

/** The warning: a web of cracks running in from the wall (`uCrack` how far), their
 *  light in the element, the quarter's whole edge lit so it reads from anywhere. */
export const CRACK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCrack;
uniform float uR0;
uniform float uR1;
uniform float uInward;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec3 vL;
varying float vEdge;
${NOISE}
float cracks(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = 8.0; float b = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = o + vec2(hH(i + o), hH(i + o + 17.0)) - f;
    float d = dot(c, c);
    if (d < a) { b = a; a = d; } else if (d < b) b = d;
  }
  return sqrt(b) - sqrt(a);
}
void main() {
  float r = length(vL.xz);
  float u = clamp((r - uR0) / (uR1 - uR0), 0.0, 1.0);
  float along = uInward > 0.5 ? 1.0 - u : u;
  float wob = hF(vL.xz * 0.2) * 0.3;
  float reach = smoothstep(0.0, 0.25, uCrack * 1.35 - along - wob + 0.2);
  vec2 warp = vL.xz + (vec2(hN(vL.xz * 0.3), hN(vL.xz * 0.3 + 9.0)) - 0.5) * 3.0;
  float big = 1.0 - smoothstep(0.0, 0.07, cracks(warp * 0.14));
  float fine = (1.0 - smoothstep(0.0, 0.06, cracks(warp * 0.42))) * smoothstep(0.45, 0.9, uCrack);
  float beat = 0.72 + 0.28 * sin(uTime * (4.0 + uCrack * 8.0));
  float line = max(big, fine * 0.65) * reach;
  float halo = (1.0 - smoothstep(0.0, 0.3, cracks(warp * 0.14))) * reach * 0.22;
  float border = (1.0 - smoothstep(0.0, 1.0, vEdge)) * uCrack;
  vec3 col = mix(uColor, uHot, line * 0.75) * (line * 2.1 + halo) * beat;
  col += uColor * border * (0.5 + 0.5 * beat) * 1.3;
  gl_FragColor = vec4(col, 1.0);
}`;
