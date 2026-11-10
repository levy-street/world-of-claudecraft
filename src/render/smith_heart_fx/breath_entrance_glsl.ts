// The Guardian of the Breath entrance's shaders (breath_entrance_fx.ts and
// its parts): the eye of storm cloud turning over the Cornice, the funnel's
// shell of torn storm cloud lit from within by its lightning and its glowing
// heart, the bolts (camera-facing strips on CPU-written spines), the ring of
// gust's wall of wind and dust, the flying granite. Texture free; no pow()
// anywhere (tests/shader_pow_domain.test.ts).

import { BREATH_STORM_SHAPE } from './breath_entrance_core';

const S = BREATH_STORM_SHAPE;
const f = (v: number) => v.toFixed(3);

/** A cheap 2D value noise (`bn`) and its fbm (`bfbm`), 0..1. */
const NOISE2 = /* glsl */ `
  float bh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float bn(vec2 p) {
    vec2 i = floor(p);
    vec2 g = fract(p);
    g = g * g * (3.0 - 2.0 * g);
    return mix(mix(bh(i), bh(i + vec2(1.0, 0.0)), g.x), mix(bh(i + vec2(0.0, 1.0)), bh(i + vec2(1.0, 1.0)), g.x), g.y);
  }
  float bfbm(vec2 p) {
    return bn(p) * 0.5 + bn(p * 2.07 + 5.3) * 0.28 + bn(p * 4.31 - 2.1) * 0.14 + bn(p * 8.9 + 9.7) * 0.08;
  }
`;

// ---- the eye ------------------------------------------------------------------------------------

export const EYE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** A turning eye of storm cloud seen from under it or over it: spiral arms
 *  of dark cloud wound into a black heart, their edges lit by the lightning
 *  inside (uFlash), thinning to nothing at the rim. Normal blending. */
export const EYE_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uTurn;
  uniform float uTime;
  uniform float uFlash;
  uniform float uTwist;
  varying vec2 vUv;
  ${NOISE2}
  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float a = atan(c.y, c.x + 1e-5);
    float sw = a + r * uTwist - uTurn;
    vec2 q = vec2(cos(sw), sin(sw)) * (0.6 + r * 1.6);
    float m = bfbm(q * 2.2 + vec2(uTime * 0.05, 0.0));
    float m2 = bfbm(vec2(sw * 1.27, r * 5.0 - uTime * 0.2));
    float arms = 0.5 + 0.5 * sin(sw * 3.0 + m * 5.0);
    float cloud = smoothstep(0.32, 0.72, m * 0.65 + m2 * 0.35 + arms * 0.25);
    float rim = 1.0 - smoothstep(0.55, 1.0, r);
    float heart = 1.0 - smoothstep(0.0, 0.2, r);
    float a1 = (cloud * 0.85 + 0.25) * rim;
    a1 = max(a1, heart * 0.95);
    vec3 dark = vec3(0.012, 0.015, 0.024);
    vec3 grey = vec3(0.06, 0.07, 0.095);
    vec3 col = mix(dark, grey, m2 * 0.8 * (1.0 - heart));
    // The lightning inside lights the arms' thin edges and the heart.
    float edge = smoothstep(0.25, 0.55, m) * (1.0 - smoothstep(0.55, 0.9, m));
    col += vec3(0.18, 0.26, 0.6) * uFlash * (edge * 0.9 + heart * 0.6 + 0.04);
    gl_FragColor = vec4(col, clamp(a1 * uAlpha, 0.0, 0.96));
    #include <colorspace_fragment>
  }
`;

// ---- the funnel -------------------------------------------------------------------------------------

/** The funnel: a unit open cylinder (y 0 at the foot to 1 at the eye)
 *  shaped to the core's `funnelRadius`, its foot snaking, coming down from
 *  the eye to `uReach` (below the tip the skin is drawn into a rope), blown
 *  out wide at the burst. `uScale` shrinks it for the glowing heart. */
export const FUNNEL_VERT = /* glsl */ `
  uniform float uReach;
  uniform float uBurst;
  uniform float uTime;
  uniform float uScale;
  varying vec2 vUv;
  varying float vFace;
  varying float vTip;
  void main() {
    float y = position.y;
    float tip = 1.0 - uReach;
    float yy = max(y, tip);
    float rope = smoothstep(tip, tip + 0.16, y);
    float r = ${f(S.rBot)} + ${f(S.rTop - S.rBot)} * yy * yy * (0.6 + 0.4 * yy);
    r *= mix(0.18, 1.0, rope) * uScale * (1.0 + 2.8 * uBurst);
    float low = (1.0 - yy) * (1.0 - yy);
    vec2 sway = vec2(sin(uTime * 1.3 + yy * 5.0), cos(uTime * 1.07 + yy * 4.3)) * ${f(S.sway)} * low;
    vec3 p = vec3(position.x * r + sway.x, yy * ${f(S.funnelH)} + uBurst * 3.0 * yy, position.z * r + sway.y);
    vUv = vec2(uv.x, yy);
    vTip = y - tip;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 n = normalize(normalMatrix * normalize(vec3(position.x, 0.0, position.z) + vec3(0.0, 1e-4, 0.0)));
    vFace = abs(dot(n, normalize(-mv.xyz + vec3(0.0, 0.0, 1e-4))));
    gl_Position = projectionMatrix * mv;
  }
`;

/** The funnel's shell: torn masses of storm cloud wound up the column and
 *  thickest at its silhouette, dark and dust-laden low, its thin parts lit
 *  blue-white from within by the lightning (uFlash), a ragged tip as it
 *  comes down. Normal blending. */
export const FUNNEL_SHELL_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uTime;
  uniform float uFlash;
  uniform float uFlashY;
  uniform float uBurst;
  varying vec2 vUv;
  varying float vFace;
  varying float vTip;
  ${NOISE2}
  void main() {
    float y = vUv.y;
    float sp = vUv.x * 7.0 + y * 4.5 - uTime * 1.9;
    float mass = bfbm(vec2(sp * 1.4, y * 4.0 - uTime * 0.6));
    float fine = bn(vec2(sp * 5.0, y * 16.0 - uTime * 2.4));
    float ragged = 0.04 + 0.08 * bn(vec2(vUv.x * 13.0, uTime * 2.0));
    if (vTip < -ragged) discard;
    float tipFade = smoothstep(-ragged, 0.04, vTip);
    float torn = smoothstep(0.34, 0.62, mass);
    float edge = 1.0 - vFace;
    float thick = 0.88 + 0.12 * edge;
    float body = (0.8 + 0.2 * torn) * thick;
    float top = 1.0 - smoothstep(0.88, 1.0, y);
    float a1 = body * top * tipFade * uAlpha * (1.0 - uBurst);
    // Linear colours (the colour-space pass lifts them): near-black storm
    // cloud in the folds, slate where the masses turn to the sky.
    vec3 shade = vec3(0.012, 0.014, 0.02);
    vec3 grey = vec3(0.085, 0.095, 0.125);
    vec3 dust = vec3(0.07, 0.06, 0.05);
    float lift = smoothstep(0.3, 0.85, mass) * (0.45 + 0.55 * y);
    vec3 col = mix(shade, grey, lift);
    // The silhouette's rim catches the sky: the column reads round.
    col += vec3(0.05, 0.06, 0.08) * edge * edge * (0.4 + 0.6 * torn);
    col = mix(col, dust, (1.0 - smoothstep(0.0, 0.22, y)) * 0.6);
    // Fast streaks where the wind runs hardest.
    float streak = smoothstep(0.82, 0.96, fine) * (0.4 + 0.6 * torn);
    col = mix(col, vec3(0.2, 0.22, 0.27), streak * 0.6);
    // Lit from within: the thin cloud glows where the light gets through.
    float thin = 1.0 - torn * 0.75;
    // The light is the bolt's: a band of the column round its height
    // (uFlashY), never the whole funnel at once.
    float band = (y - uFlashY) * 3.2;
    float near = 0.2 + 0.8 * exp(-band * band);
    col += vec3(0.16, 0.24, 0.62) * uFlash * near * (0.05 + 0.5 * thin * (0.3 + 0.7 * fine));
    gl_FragColor = vec4(col, clamp(a1, 0.0, 0.95));
    #include <colorspace_fragment>
  }
`;

/** The funnel's heart: a cold blue glow deep in the column, breathing with
 *  the lightning inside it (uFlicker) and brightest where the light is
 *  (uFlashY), seen through the shell; the bolts themselves are the strips'
 *  (breath_entrance_bolts.ts). Additive. */
export const FUNNEL_CORE_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uTime;
  uniform float uFlicker;
  uniform float uFlashY;
  varying vec2 vUv;
  varying float vFace;
  varying float vTip;
  ${NOISE2}
  void main() {
    if (vTip < 0.0) discard;
    float y = vUv.y;
    float sp = vUv.x * 5.0 + y * 6.0 - uTime * 3.2;
    float glow = 0.03 + 0.05 * bfbm(vec2(sp, y * 3.0 - uTime));
    float band = (y - uFlashY) * 3.0;
    float lit = uFlicker * (0.15 + 0.85 * exp(-band * band));
    float fade = smoothstep(0.0, 0.06, vTip) * (1.0 - smoothstep(0.85, 1.0, y));
    float k = (glow + 0.22 * lit) * fade * vFace * vFace * uAlpha;
    if (k <= 0.002) discard;
    gl_FragColor = vec4(vec3(0.35, 0.5, 1.0) * k, 1.0);
  }
`;

// ---- the bolts --------------------------------------------------------------------------------------

/** A bolt's strip: each vertex a point on its spine (`position`), the spine's
 *  way on (`aDir`), its side (`aSide` -1 or 1), its half width and its light
 *  (`aBolt`: width, light); turned to face the eye in view space. */
export const BOLT_VERT = /* glsl */ `
  attribute vec3 aDir;
  attribute float aSide;
  attribute vec2 aBolt;
  varying float vSide;
  varying float vLight;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 d = (modelViewMatrix * vec4(aDir, 0.0)).xyz;
    vec2 side = normalize(vec2(-d.y, d.x) + vec2(1e-5, 0.0));
    mv.xy += side * aSide * aBolt.x;
    vSide = aSide;
    vLight = aBolt.y;
    gl_Position = projectionMatrix * mv;
  }
`;

/** A white-hot core in a blue-violet glow, soft at its edge. Additive. */
export const BOLT_FRAG = /* glsl */ `
  varying float vSide;
  varying float vLight;
  void main() {
    if (vLight <= 0.002) discard;
    float across = abs(vSide);
    float core = 1.0 - smoothstep(0.0, 0.26, across);
    float glow = 1.0 - smoothstep(0.1, 1.0, across);
    vec3 col = vec3(0.45, 0.58, 1.0) * glow * glow * 0.9 + vec3(1.0, 0.98, 1.0) * core * 1.6;
    gl_FragColor = vec4(col * vLight, 1.0);
  }
`;

// ---- the ring of gust ----------------------------------------------------------------------------------

export const WALL_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz + vec3(0.0, 0.0, 1e-4))));
    gl_Position = projectionMatrix * mv;
  }
`;

/** The ring of gust: a wall of wind racing out, streaks torn sideways
 *  through it, dust thick at its foot, its crest ragged. Normal blending. */
export const GUST_WALL_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uTime;
  uniform float uWrap;
  varying vec2 vUv;
  varying float vFacing;
  ${NOISE2}
  void main() {
    float h = vUv.y;
    float n = bfbm(vec2(vUv.x * uWrap, h * 2.5 - uTime * 1.3));
    float streak = smoothstep(0.62, 0.92, bn(vec2(vUv.x * uWrap * 3.0 - uTime * 6.0, h * 14.0)));
    float top = 1.0 - smoothstep(0.3 + 0.45 * n, 1.0, h);
    float foot = smoothstep(0.0, 0.04, h);
    float k = top * foot * (0.15 + 0.6 * n * n + streak * 0.55) * (0.3 + 0.7 * vFacing);
    vec3 air = vec3(0.3, 0.34, 0.42);
    vec3 dust = vec3(0.16, 0.145, 0.13);
    vec3 col = mix(dust, air, smoothstep(0.0, 0.5, h) * 0.7 + streak * 0.3);
    gl_FragColor = vec4(col, clamp(k * uAlpha, 0.0, 0.85));
    #include <colorspace_fragment>
  }
`;

// ---- the stone ------------------------------------------------------------------------------------------

/** The Cornice's grey granite, flying: one fixed key light, a cool fill, and
 *  the lightning's blue on every face that turns to the funnel (uFlash).
 *  Drawn with council_entrance_glsl.ts STONE_VERT. */
export const GRANITE_FRAG = /* glsl */ `
  uniform float uFlash;
  varying vec3 vLocal;
  varying vec3 vObj;
  varying vec3 vN;
  ${NOISE2}
  void main() {
    vec3 n = normalize(vN);
    vec3 key = normalize(vec3(-0.4, 0.82, -0.3));
    float lam = max(dot(n, key), 0.0);
    float fill = 0.5 + 0.5 * n.y;
    float g = bn(vObj.xy * 3.1 + vObj.z * 1.7) * 0.6 + bn(vObj.zy * 7.0) * 0.4;
    vec3 albedo = mix(vec3(0.17, 0.18, 0.2), vec3(0.47, 0.48, 0.5), 0.3 + 0.6 * g);
    vec3 col = albedo * (0.3 * fill + 0.85 * lam);
    vec3 toAxis = normalize(vec3(-vLocal.x, 0.0, -vLocal.z) + vec3(1e-4, 0.0, 0.0));
    float lit = max(dot(n, toAxis), 0.0);
    col += vec3(0.45, 0.6, 1.0) * uFlash * (0.15 + 0.85 * lit);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
