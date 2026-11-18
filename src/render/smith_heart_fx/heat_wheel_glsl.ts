// The Wheel of the Hearth in GLSL (heat_wheel_fx.ts; the plan
// heat_wheel_fx_core.ts), in the lava waves' family (heat_lava_wall_glsl.ts):
//  - the slice on the floor (a molten decal: char under glow, the Heat's
//    zone rungs): a doomed slice darkens and smokes while molten cracks spread
//    out from the lip through the basalt, the plates between them heating to a
//    throb; its rims the lethal crimson. It erupts in a flash running out from
//    the lip, burns as broken molten ground, then cools to a dark scorch with
//    dying red seams. The safe slice is the one cool thing on the floor: frost
//    blue, bright cold rims, slow mist drifting over it;
//  - the geysers over a slice (one instanced draw a slice, three crossed
//    planes and a camera-facing burst each): heat shimmer wavering up off a
//    doomed slice's vents while it warns, then big columns of fire bursting
//    out from the lip in step with the flash when it erupts.
// Strings only.

import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { WALL_COMMON_GLSL } from './heat_lava_wall_glsl';
import { WHEEL_FX } from './heat_wheel_fx_core';

export const WHEEL_FLOOR_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;

/** The slice on the floor. `noise` is HEAT_NOISE_GLSL (vn, fbm, cellEdge),
 *  `molten` HEAT_MOLTEN_GLSL, `lava` HEAT_LAVA_GLSL. */
export function wheelFloorFrag(noise: string, molten: string, lava: string): string {
  return /* glsl */ `
uniform float uTime;
uniform float uBuild;
uniform float uThrob;
uniform float uErupt;
uniform float uBurn;
uniform float uScorch;
uniform vec3 uRim;
uniform vec4 uClip;
uniform vec4 uArc;
uniform float uSafe;
varying vec2 vUv;
varying vec3 vW;
${noise}
${molten}
${lava}
const float WELL_R = ${WHEEL_FX.ventInner.toFixed(2)} - 2.5;
void main() {
  if (vW.x < uClip.x || vW.x > uClip.y || vW.z < uClip.z || vW.z > uClip.w) discard;
  vec2 d = vW.xz - uArc.xy;
  float r = length(d);
  float a = atan(d.x, d.y);
  if (a < -1.5707963) a += 6.2831853;
  if (a < uArc.z || a >= uArc.w) discard;
  float edge = min(a - uArc.z, uArc.w - a) * r;
  float y = vUv.y;
  float hard = max(1.0 - smoothstep(0.0, 0.6, edge), (1.0 - smoothstep(0.0, 0.03, y)) + smoothstep(0.97, 1.0, y));
  float soft = 1.0 - smoothstep(0.0, 2.5, edge);
  vec2 w = vW.xz;
  if (uSafe > 0.5) {
    // Calm: a cool clear sheet, frost brightening toward its edges, slow mist
    // drifting across it, a hard bright rim of cold light all round.
    float frost = vn(w * 0.35 + vec2(uTime * 0.05, 0.0));
    float mist = smoothstep(0.45, 0.85, fbm(w * 0.09 + vec2(uTime * 0.06, -uTime * 0.04)));
    float rime = 1.0 - smoothstep(0.0, 0.06, cellEdge(w * 0.45));
    float breathe = 0.5 + 0.5 * sin(uTime * 1.6);
    vec3 sheet = mix(vec3(0.08, 0.26, 0.42), vec3(0.36, 0.72, 0.92), 0.35 * frost + 0.45 * soft);
    sheet = mix(sheet, vec3(0.66, 0.88, 1.0), 0.4 * rime + 0.25 * mist);
    vec3 cool = mix(sheet, vec3(0.86, 0.97, 1.0), clamp(hard, 0.0, 1.0));
    float ca = max(hard * 0.98, 0.5 + 0.08 * soft + 0.06 * mist + 0.03 * breathe);
    gl_FragColor = vec4(cool * (1.0 + 0.5 * clamp(hard, 0.0, 1.0)), clamp(ca, 0.0, 0.97));
    #include <colorspace_fragment>
    return;
  }
  // The basalt's cracks: its big joints and a finer branching web, warped.
  vec2 warp = vec2(fbm(w * 0.11), fbm(w * 0.11 + vec2(5.3, 1.9))) - 0.5;
  float big = 1.0 - smoothstep(0.0, 0.065, cellEdge(w * 0.42 + warp * 0.8));
  float fine = 1.0 - smoothstep(0.0, 0.04, cellEdge(w * 1.25 + warp * 2.2));
  float web = max(big, fine * 0.75);
  // How far out from the lip the cracks have run (they reach the far wall a
  // little before the eruption), each one ragged at its tip.
  float rn = clamp((r - WELL_R) / 42.0, 0.0, 1.2);
  float lag = rn + 0.16 * (vn(w * 0.3) - 0.5);
  float front = uBuild * 1.3 - 0.06;
  float reached = smoothstep(lag, lag + 0.05, front);
  float tip = reached * (1.0 - smoothstep(0.0, 0.14, front - lag));
  float grain = fbm(w * 0.2 + vec2(uTime * 0.18, -uTime * 0.12));
  vec3 rim = uRim * 1.7;
  if (uErupt < 0.0) {
    // The warning: smoke-dark ground, the cracks molten (deep red early, amber
    // to gold as it nears), the plates heating to an ember throb.
    float heat = pow(clamp(uBuild, 0.0, 1.0), 1.4);
    // Faint seams already glow everywhere; the bright front runs out over them.
    float pre = web * smoothstep(0.0, 0.12, uBuild) * (0.35 + 0.3 * grain);
    float crack = max(max(big, fine * (0.4 + 0.6 * heat)) * reached, pre * 0.45);
    float m = crack * (0.38 + 0.38 * heat + 0.28 * tip + 0.15 * uThrob) * (0.55 + 0.45 * reached);
    vec3 crackCol = molten(clamp(m, 0.0, 0.8));
    // The plates heat behind the front, and a red glow runs a little ahead of it.
    float ahead = smoothstep(lag - 0.3, lag, front) * (1.0 - reached) * 0.35;
    // Uneven: some plates still dark crust, others glowing through.
    float patchy = smoothstep(0.3, 0.75, grain);
    float plate = (reached * heat + ahead) * (0.15 + 0.85 * patchy) * (0.5 + 0.5 * uThrob);
    float soot = fbm(w * 0.06 + vec2(uTime * 0.03, 0.0));
    vec3 ground = mix(vec3(0.1, 0.02, 0.009) * (0.45 + 0.8 * soot), vec3(0.6, 0.075, 0.02), plate);
    vec3 col = mix(ground, crackCol, smoothstep(0.05, 0.4, crack));
    col = mix(col, uRim * (0.9 + 0.5 * uThrob), soft * 0.4);
    col = mix(col, rim, clamp(hard, 0.0, 1.0));
    float base = 0.24 + 0.34 * uBuild + 0.12 * uThrob;
    float alpha = max(max(hard * 0.97, crack * 0.95), max(base, soft * 0.6));
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
    #include <colorspace_fragment>
    return;
  }
  // The eruption: a flash running out from the lip, then broken molten ground
  // under the flames, then the scorch cooling with its seams dying red.
  float fr = WELL_R + uErupt * ${(42 / WHEEL_FX.ripple).toFixed(2)};
  float behind = smoothstep(0.0, 2.0, fr - r);
  float flash = exp(-abs(r - fr) * 0.9) * (1.0 - smoothstep(0.2, 0.5, uErupt));
  float lvl = lavaLevel(w, vec2(0.0, 1.2), uTime, 1.1);
  float burnM = behind * uBurn * (0.04 + 0.5 * lvl * lvl + 0.4 * web);
  vec3 col = molten(clamp(burnM, 0.0, 0.52));
  float cool = uScorch * (1.0 - uBurn * 0.7);
  vec3 scorch = mix(vec3(0.03, 0.022, 0.02), vec3(0.75, 0.1, 0.02) * (0.5 + 0.5 * grain), web * 0.8 * uScorch);
  col = mix(col, scorch, clamp(cool * behind, 0.0, 1.0));
  col += vec3(1.0, 0.5, 0.14) * flash * 1.3;
  col = mix(col, rim, clamp(hard, 0.0, 1.0) * max(uBurn, uScorch * 0.5));
  float alpha = max(behind * max(0.32 + 0.3 * uBurn, 0.75 * uScorch), flash * 0.85);
  alpha = max(alpha, hard * 0.9 * max(uBurn, uScorch * 0.4));
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
  #include <colorspace_fragment>
}
`;
}

/** Hash and value noise for the vents (the wall's own, renamed). */
const VENT_NOISE = /* glsl */ `
float kh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float kn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(kh(i), kh(i + vec2(1.0, 0.0)), u.x), mix(kh(i + vec2(0.0, 1.0)), kh(i + vec2(1.0, 1.0)), u.x), u.y);
}
float kfbm(vec2 p) {
  return kn(p) * 0.55 + kn(p * 2.03 + 1.7) * 0.3 + kn(p * 4.01 + 3.1) * 0.15;
}
`;

/** A geyser over a slice (aVent: the bearing's share, the radius's share, a
 *  seed, 1; aPlane: which of its planes). Each geyser is three crossed
 *  vertical planes of fire (a volume from any side) and a camera-facing burst
 *  at its foot (round from straight above); while the slice warns only its
 *  first plane stands, as heat shimmer. It erupts in step with the flash
 *  running out from the lip. Clipped to the Hearth's floor (WALL_COMMON_GLSL's
 *  polygon, its uCenter the wellspring on the floor). */
export const WHEEL_VENT_VERT = /* glsl */ `
uniform vec4 uArc;
uniform float uCount;
uniform float uBuild;
uniform float uErupt;
uniform float uBurn;
uniform float uQuench;
attribute vec4 aVent;
attribute float aIndex;
attribute float aPlane;
varying vec2 vUv;
varying float vSeed;
varying float vFire;
varying float vHaze;
varying float vBurst;
${WALL_COMMON_GLSL}
${CAMERA_RELATIVE_GLSL}
void main() {
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  vSeed = aVent.z;
  vBurst = step(2.5, aPlane);
  float a = mix(uArc.z, uArc.w, aVent.x);
  float r = mix(${WHEEL_FX.ventInner.toFixed(2)}, ${WHEEL_FX.ventOuter.toFixed(2)}, aVent.y);
  vec2 dir = vec2(sin(a), cos(a));
  vec2 xz = uCenter.xz + dir * r;
  float inside = step(aIndex, uCount - 0.5)
    * step(${WHEEL_FX.ventEdge.toFixed(2)}, min(a - uArc.z, uArc.w - a) * r)
    * step(wallPolySd(xz), -1.5);
  float s = aVent.z;
  float hgt = 0.0;
  vFire = 0.0;
  vHaze = 0.0;
  vec3 base = vec3(xz.x, uCenter.y - 0.15, xz.y);
  vec3 toCam = normalize(cameraPosition - base);
  float overhead = smoothstep(0.6, 0.95, toCam.y);
  if (uErupt < 0.0) {
    // Warning: shimmer over the vent, rising with the heat (one plane).
    if (aPlane < 0.5) {
      vHaze = smoothstep(0.08, 0.9, uBuild) * (0.75 + 0.25 * sin(uTime * 3.0 + s * 30.0));
      hgt = 4.5 + 3.0 * s;
    }
  } else {
    // In step with the flash running out from the lip, a beat apart each.
    float lt = uErupt - aVent.y * ${WHEEL_FX.ripple.toFixed(2)} - fract(s * 7.13) * 0.1;
    float rise = smoothstep(0.0, 0.14, lt);
    float hold = 0.85 + 0.45 * s;
    float fall = 1.0 - smoothstep(hold, hold + 0.6, lt);
    float tail = max(fall, 0.35 * clamp(uBurn * 1.6, 0.0, 1.0));
    vFire = rise * tail * (1.0 - uQuench);
    hgt = mix(${WHEEL_FX.geyser[0].toFixed(2)}, ${WHEEL_FX.geyser[1].toFixed(2)}, fract(s * 3.7))
      * rise * (0.35 + 0.65 * tail) * (1.0 + 0.25 * (1.0 - smoothstep(0.0, 0.35, lt)));
    // Crossed planes go edge-on from straight above: the burst carries it there.
    // The burst is the bang at the foot; it gives way to the column (from
    // straight above it stays: the crossed planes go edge-on there).
    float bang = 1.0 - smoothstep(0.2, 0.75, lt) * (1.0 - 0.6 * overhead);
    vFire *= vBurst > 0.5 ? bang * mix(0.75, 1.0, overhead) : 1.0 - 0.6 * overhead;
  }
  if (inside < 0.5 || (vFire + vHaze) < 0.003 || hgt < 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float v = vUv.y;
  if (vBurst > 0.5) {
    // The burst at the foot: a ball of fire facing the camera.
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float size = hgt * 0.5;
    vec3 c = base + vec3(0.0, size * 0.5, 0.0);
    gl_Position = projectionMatrix * wocCamRelView(c + right * position.x * size + camUp * position.y * size);
    return;
  }
  vec3 side;
  if (vHaze > 0.0) {
    side = cross(vec3(0.0, 1.0, 0.0), toCam);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  } else {
    float ang = aPlane * 1.0471976 + s * 6.2831853;
    side = vec3(cos(ang), 0.0, sin(ang));
  }
  vec3 up = vec3(0.0, hgt, 0.0);
  float bend = sin(v * 4.2 - uTime * 3.4 + s * 40.0 + aPlane) * (0.5 + 0.5 * sin(uTime * 1.3 + s * 17.0));
  vec3 lean = vec3(cos(s * 31.0), 0.0, sin(s * 31.0)) * 0.12 * v * v * hgt;
  vec3 spine = base + up * v + side * bend * 0.08 * v * hgt + lean;
  float width = hgt * (vHaze > 0.0 ? 0.3 : 0.5) * (0.85 + 0.3 * fract(s * 9.1 + aPlane * 0.37));
  gl_Position = projectionMatrix * wocCamRelView(spine + side * position.x * width);
}
`;

/** The geyser's fire (the Hearth's fire ramp, the wall's family: a boiling
 *  white-yellow foot, tongues rising and breaking into dark red tips), its
 *  burst ball, or its shimmer. Additive. */
export function wheelVentFrag(rampGlsl: string): string {
  return /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vFire;
varying float vHaze;
varying float vBurst;
${VENT_NOISE}
${rampGlsl}
void main() {
  vec2 uv = vUv;
  float s = vSeed * 17.0;
  if (vHaze > 0.0) {
    // Heat shimmer: faint warm streaks wavering up, a hot glow at the foot.
    float x = (uv.x - 0.5) * 2.0;
    float bend = sin(uv.y * 6.0 - uTime * 2.2 + s) * 0.28;
    float streak = pow(clamp(0.5 + 0.5 * sin((x + bend) * 7.0 + s), 0.0, 1.0), 5.0);
    float rise = 0.5 + 0.5 * sin(uv.y * 11.0 - uTime * 3.4 + s * 1.7);
    float body = (1.0 - smoothstep(0.55, 1.0, abs(x))) * (1.0 - smoothstep(0.35, 1.0, uv.y));
    float foot = (1.0 - smoothstep(0.0, 0.14, uv.y)) * (1.0 - smoothstep(0.2, 1.0, abs(x)));
    vec3 c = vec3(1.0, 0.62, 0.3) * streak * (0.4 + 0.6 * rise) * body * 0.16
      + vec3(1.0, 0.35, 0.08) * foot * 0.55;
    gl_FragColor = vec4(c * vHaze, 1.0);
    return;
  }
  float t = uTime * (1.0 + 0.3 * vSeed);
  if (vBurst > 0.5) {
    // A boiling ball of fire, ragged at its edge, hottest at its heart.
    vec2 p = (uv - 0.5) * 2.0;
    float ang = atan(p.y, p.x);
    float n = kfbm(vec2(ang * 1.6 + s, length(p) * 2.5 - t * 2.4));
    float rr = length(p) / (0.6 + 0.4 * n);
    float I = clamp((1.0 - rr) * 1.6 + (n - 0.5) * 0.6, 0.0, 1.0);
    vec3 col = fireRamp(I * 0.95) * 1.1;
    // Soft where it meets the floor, never a cut edge.
    float foot = smoothstep(0.0, 0.25, uv.y);
    gl_FragColor = vec4(col, smoothstep(0.03, 0.3, I) * vFire * 0.9 * foot);
    return;
  }
  vec2 q = vec2(uv.x * 1.6 + s, uv.y * 1.35 - t * 2.4);
  vec2 warp = vec2(kfbm(q * 0.8 + vec2(0.0, -t * 0.5)), kfbm(q * 0.8 + vec2(5.2, 1.3 - t * 0.5))) - 0.5;
  float n = kfbm(q * 1.9 + warp * 1.7 + vec2(0.0, -t * 1.2));
  // Tongues of uneven height across the column, rising and breaking.
  float x = (uv.x - 0.5) * 2.0 + warp.x * 1.4 * uv.y;
  float r1 = 1.0 - abs(2.0 * kn(vec2(uv.x * 3.1 + s, t * 0.9)) - 1.0);
  float top = 0.55 + 0.4 * r1 * r1;
  float yy = uv.y / top;
  // Rounded where it boils out of the ground, widest low, tapering to licks.
  float halfW = mix(0.8, 0.2, clamp(yy, 0.0, 1.0)) * (0.8 + 0.4 * n)
    * (0.55 + 0.45 * smoothstep(0.0, 0.16, uv.y));
  float shape = 1.0 - smoothstep(halfW * 0.25, halfW, abs(x));
  float I = shape * ((1.0 - yy) * 1.1 + (n - 0.5) * 1.3);
  I -= smoothstep(0.4, 1.05, yy) * (1.0 - n) * 0.8;
  I += (1.0 - smoothstep(0.0, 0.14, uv.y)) * 0.35 * shape;
  I = clamp(I * 1.35, 0.0, 1.0);
  // White-yellow at the foot, orange through the body, dark red at the tips.
  float h = I * (1.0 - 0.55 * smoothstep(0.0, 1.0, yy));
  vec3 col = fireRamp(h) * 1.1;
  float a = smoothstep(0.04, 0.28, I) * vFire * smoothstep(0.0, 0.12, uv.y);
  gl_FragColor = vec4(col, a);
}
`;
}
