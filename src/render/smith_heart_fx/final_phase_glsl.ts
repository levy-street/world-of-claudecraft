// The Masterless Strength's part 2 shaders (final_phase_fx.ts builds them).
// Strings only (no Three, no state). Every vertex goes through
// `modelViewMatrix` (camera-relative: the Heart sits in an instance band far
// from the world's origin); every noise runs on the mesh's own coordinates.
//
//   SHIELD     Gathered Strength: a dome of the four veins' light round the
//              boss, bands of each vein chasing up it, a hard fresnel rim and
//              hex-cracked plates that flare as the call nears its end.
//   QRING      a Quenching Ring: a band of frost at its front, ragged and
//              rimed, cut clean through at its gaps (the gaps carry a cold
//              blue line on either side so they read as doors); the threat's
//              hot line on its leading edge.
//   PILLAR     a column of a vein's light (a Splinter rising, the four
//              quarters waking): bright at the floor, tearing into flames up
//              its height, fading with its life.
//   BEAM       an element pouring into the boss: a thick flowing beam, bands
//              racing from the Splinter to the boss.
//   SIGIL      a Splinter's ground sigil and the poured marks' ring: a
//              runed circle in its vein's colour, turning.

const NOISE = /* glsl */ `
float ph(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ph(i), ph(i + vec2(1.0, 0.0)), f.x), mix(ph(i + vec2(0.0, 1.0)), ph(i + vec2(1.0, 1.0)), f.x), f.y);
}
float pfbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * pn(p);
    p = p * 2.03 + vec2(7.1, 3.7);
    a *= 0.5;
  }
  return s;
}
`;

const VEINS = /* glsl */ `
uniform vec3 uHeat;
uniform vec3 uQuench;
uniform vec3 uBreath;
uniform vec3 uHammer;
vec3 veinAt(float s) {
  float k = fract(s) * 4.0;
  vec3 v0 = k < 1.0 ? uHeat : k < 2.0 ? uQuench : k < 3.0 ? uBreath : uHammer;
  vec3 v1 = k < 1.0 ? uQuench : k < 2.0 ? uBreath : k < 3.0 ? uHammer : uHeat;
  return mix(v0, v1, smoothstep(0.65, 1.0, fract(k)));
}
`;

/** Local position, normal and view (bodies). */
export const PHASE_BODY_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
varying vec2 vUv;
void main() {
  vUv = uv;
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

/** Local position only (floor bands). */
export const PHASE_FLOOR_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SHIELD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uUrgent;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
${NOISE}
${VEINS}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  float fres = pow(1.0 - abs(dot(n, v)), 2.2);
  float a = atan(vObj.x, vObj.z);
  float h = vObj.y;
  // The four veins chasing up and round the dome.
  vec3 vein = veinAt(a / 6.2831853 + h * 0.18 - uTime * 0.07);
  // Hex-like plates: a cell net on the dome's own angle and height.
  vec2 cell = vec2(a * 3.2, h * 3.6);
  float net = 1.0 - smoothstep(0.0, 0.08, abs(fract(cell.x + 0.5 * floor(cell.y)) - 0.5) - 0.42);
  net = max(net, 1.0 - smoothstep(0.0, 0.08, abs(fract(cell.y) - 0.5) - 0.42));
  float flow = pfbm(vec2(a * 2.0 + uTime * 0.4, h * 1.4 - uTime * 0.9));
  float bands = smoothstep(0.55, 0.9, sin(h * 5.0 - uTime * 3.0 + flow * 4.0) * 0.5 + 0.5);
  float crackle = smoothstep(0.82, 1.0, pn(vec2(a * 9.0, h * 7.0 + uTime * 2.0))) * uUrgent;
  // Clear through its face (the boss reads inside it), lit at its rim, its
  // plates and its climbing bands.
  vec3 col = vein * (0.03 + fres * 1.1 + bands * 0.18 * fres + net * 0.3 * (0.35 + uUrgent))
    + vec3(1.0, 0.96, 0.88) * (fres * fres * 0.45 + crackle * 0.9);
  // The floor's foot of the dome, brighter where it meets the stone.
  col += vein * smoothstep(0.6, 0.0, h) * 0.45;
  gl_FragColor = vec4(col * uAlpha, 1.0);
}
`;

export const QRING_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFront;
uniform float uAlpha;
uniform float uGapHalf;
uniform float uGapN;
uniform vec4 uGaps;
uniform float uDetail;
uniform vec3 uFrost;
uniform vec3 uThreat;
varying vec3 vLocal;
${NOISE}
float gapDist(float a) {
  float best = 10.0;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uGapN) break;
    float g = uGaps[i];
    float d = abs(atan(sin(a - g), cos(a - g)));
    best = min(best, d);
  }
  return best;
}
void main() {
  float r = length(vLocal.xz);
  // Sim facing: 0 along +z, clockwise toward +x.
  float a = atan(vLocal.x, vLocal.z);
  float rag = (pn(vec2(a * 22.0, uFront * 0.4)) - 0.5) * 0.9;
  float d = uFront - r + rag;
  // A band 3 yd deep behind the front, its leading edge sharp.
  if (d < -0.4 || d > 3.2) discard;
  float gd = gapDist(a) - uGapHalf;
  // Inside a gap: nothing but its cold door frame.
  float frameW = 0.05;
  if (gd < 0.0) {
    float door = 1.0 - smoothstep(0.0, frameW, -gd);
    if (door <= 0.01) discard;
    gl_FragColor = vec4(vec3(0.75, 0.92, 1.0) * door * 1.2 * uAlpha * smoothstep(3.2, 0.0, d), 1.0);
    return;
  }
  float edge = 1.0 - smoothstep(0.0, 0.35, abs(d));
  float body = smoothstep(3.2, 0.2, d);
  // Rime feathers and ice shards in the band.
  float rime = pfbm(vec2(a * 30.0, r * 1.6)) * uDetail;
  float shard = smoothstep(0.7, 0.95, pn(vec2(a * 70.0, d * 3.0))) * uDetail;
  float doorEdge = 1.0 - smoothstep(0.0, 0.09, gd);
  vec3 col = uFrost * (body * (0.35 + 0.55 * rime) + shard * 0.6)
    + mix(uThreat, vec3(1.0), 0.25) * edge * 1.3
    + vec3(0.75, 0.92, 1.0) * doorEdge * 1.4;
  gl_FragColor = vec4(col * uAlpha, 1.0);
}
`;

export const PILLAR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uSeed;
uniform vec3 uColor;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
varying vec2 vUv;
${NOISE}
void main() {
  float h = vUv.y;
  float a = vUv.x * 6.2831853;
  // Tongues of the vein's light tearing up the column, thinning with height.
  float tear = pfbm(vec2(a * 2.0 + uSeed, h * 5.0 - uTime * 4.0));
  float flame = smoothstep(h * 0.9, h * 0.9 + 0.35, tear);
  // A rim-lit sheath: bright at its silhouette, clear through its middle,
  // so the column reads as light, never a solid pipe.
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  float rim = pow(1.0 - abs(dot(n, v)), 1.6);
  float streak = smoothstep(0.6, 1.0, pn(vec2(a * 6.0, h * 2.0 - uTime * 6.0)));
  float foot = smoothstep(0.35, 0.0, h);
  vec3 col = uColor * (rim * 0.85 + streak * 0.35) * flame + mix(uColor, vec3(1.0), 0.5) * foot * rim;
  gl_FragColor = vec4(col * uAlpha * (1.0 - h * 0.7) * 0.8, 1.0);
}
`;

export const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
varying vec2 vUv;
${NOISE}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  float core = pow(abs(dot(n, v)), 2.0);
  float flow = pfbm(vec2(vUv.x * 6.2831853, vUv.y * 6.0 - uTime * 9.0));
  float bands = smoothstep(0.45, 0.85, flow);
  vec3 col = uColor * (0.4 + bands * 0.9) + vec3(1.0) * core * (0.6 + bands * 0.6);
  gl_FragColor = vec4(col * uAlpha, 1.0);
}
`;

export const SIGIL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uSpin;
uniform vec3 uColor;
varying vec3 vLocal;
${NOISE}
void main() {
  float r = length(vLocal.xz);
  float a = atan(vLocal.x, vLocal.z) + uTime * uSpin;
  // Two rings and a band of runes between them, a soft fill inside.
  float outer = 1.0 - smoothstep(0.0, 0.05, abs(r - 0.95));
  float inner = 1.0 - smoothstep(0.0, 0.04, abs(r - 0.72));
  float runeBand = step(0.74, r) * step(r, 0.93);
  float cellA = fract(a * 24.0 / 6.2831853);
  float rune = runeBand * step(0.45, pn(vec2(floor(a * 24.0 / 6.2831853), floor(r * 20.0))))
    * step(0.2, cellA) * step(cellA, 0.8);
  float fill = smoothstep(0.95, 0.0, r) * (0.18 + 0.12 * sin(uTime * 3.0 + r * 9.0));
  float spoke = smoothstep(0.92, 1.0, cos(a * 6.0)) * step(r, 0.72) * 0.35;
  vec3 col = uColor * (outer * 1.3 + inner * 0.9 + rune * 0.8 + fill + spoke);
  col += vec3(1.0) * outer * 0.25;
  gl_FragColor = vec4(col * uAlpha * step(r, 1.0), 1.0);
}
`;
