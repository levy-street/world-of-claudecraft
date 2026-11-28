// The Islands of the Wind's 50 percent phase shaders (plan:
// breath_isle_phase_core.ts): Skyrend Nova's sphere of storm light, the sky
// darkening round the Cornice, each isle's Closing Storm (its floor ring and
// its wall of cloud, both shaped on the isle's own rim), the Stillstone's
// crystal and the Squall Ward's shield and its arc on the floor. No lights,
// no textures; built once by their painters' constructors.

/** Shared: a hash, a value noise and a small fbm (2D and 3D). */
const NOISE = /* glsl */ `
float ph(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ph(i), ph(i + vec2(1, 0)), f.x), mix(ph(i + vec2(0, 1)), ph(i + vec2(1, 1)), f.x), f.y);
}
float pfbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * pnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}
float ph3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float pnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(ph3(i), ph3(i + vec3(1, 0, 0)), f.x), mix(ph3(i + vec3(0, 1, 0)), ph3(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(ph3(i + vec3(0, 0, 1)), ph3(i + vec3(1, 0, 1)), f.x), mix(ph3(i + vec3(0, 1, 1)), ph3(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
float pfbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * pnoise3(p);
    p = p * 2.07 + vec3(3.1, 1.7, 5.3);
    a *= 0.5;
  }
  return s;
}
`;

/** A lit-free shell's vertex shader: its local point, normal and view. */
export const PHASE_SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
varying vec2 vUv;
void main() {
  vLocal = position;
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

/** Skyrend Nova's light: an additive shell over its storm core. A bright
 *  rim, lightning veins crawling over it (more and brighter with the
 *  charge), bands of glow turning in it; toward the end the angry violet
 *  runs in (uHot) and it throbs harder. */
export const NOVA_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uCore;
uniform vec3 uHot;
uniform float uGlow;
uniform float uHotK;
uniform float uThrob;
uniform float uCharge;
uniform float uFade;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
${NOISE}
void main() {
  vec3 n = normalize(vN);
  float facing = max(dot(n, normalize(vView)), 0.0);
  float rim = pow(clamp(1.0 - facing, 0.0, 1.0), 3.0);
  vec3 p = normalize(vLocal);
  float t = uTime;
  float lon = atan(p.z, p.x);
  vec3 q = vec3(cos(lon + t * 0.45 + p.y * 1.8), p.y * 1.7, sin(lon + t * 0.45 + p.y * 1.8));
  float band = smoothstep(0.55, 0.85, pfbm3(q * 2.6 + vec3(0.0, -t * 0.3, 0.0)));
  // Lightning veins: thin ridges of a second noise, re-struck in steps.
  float v = abs(pfbm3(p * 4.0 + vec3(floor(t * 6.0) * 1.7, 0.0, t * 0.2)) - 0.5);
  float vein = (1.0 - smoothstep(0.0, 0.018 + 0.02 * uCharge, v));
  // As it gathers the soft bands give way to the veins (a pale wash read as
  // weak at full charge): saturated storm light, white only in the veins'
  // hearts, a hard bright rim.
  float k = (rim * 1.4 + band * 0.35 * (1.0 - 0.7 * uCharge) + vein * (0.7 + 1.9 * uCharge)) * uGlow * (0.8 + 0.4 * uThrob);
  vec3 base = mix(uColor, uHot, uHotK);
  float hotVein = vein * (1.0 - smoothstep(0.0, 0.012, v));
  vec3 col = mix(base * (1.0 + 0.6 * uCharge), uCore, clamp(hotVein * 0.9 + rim * 0.15, 0.0, 1.0));
  gl_FragColor = vec4(col * (1.0 + 0.25 * k), clamp(k * mix(0.8, 0.6, uCharge), 0.0, 0.92) * uFade);
  #include <colorspace_fragment>
}
`;

/** Skyrend Nova's body: a ball of dark storm cloud churning (normal
 *  blending: it reads against a bright sky), lit from within by a light
 *  that spreads through it as it gathers (uCharge): patches at first, a
 *  white-hot heart under thin cloud at its end. */
export const NOVA_CORE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uStorm;
uniform vec3 uColor;
uniform vec3 uCore;
uniform vec3 uHot;
uniform float uHotK;
uniform float uCharge;
uniform float uThrob;
uniform float uFade;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
${NOISE}
void main() {
  vec3 n = normalize(vN);
  float facing = max(dot(n, normalize(vView)), 0.0);
  vec3 p = normalize(vLocal);
  float t = uTime;
  float lon = atan(p.z, p.x);
  vec3 q = vec3(cos(lon - t * 0.3 + p.y * 2.2), p.y * 2.0, sin(lon - t * 0.3 + p.y * 2.2));
  float cloud = pfbm3(q * 2.0 + vec3(0.0, t * 0.15, 0.0));
  // Depth: a second, deeper layer seen through the first along the view
  // (parallax), turning the other way, so the ball reads as a volume.
  vec3 v = normalize(vView);
  vec3 deep = p - v * 0.45;
  float lon2 = atan(deep.z, deep.x);
  float cloud2 = pfbm3(vec3(cos(lon2 + t * 0.22), deep.y * 2.4, sin(lon2 + t * 0.22)) * 2.6 - vec3(0.0, t * 0.2, 0.0));
  // The light inside: where both layers thin, more of it as it gathers;
  // ridged storm bands always cross the heart, so it never goes flat.
  float gap = (1.0 - cloud) * 0.6 + (1.0 - cloud2) * 0.4;
  float thin = smoothstep(0.62 - 0.25 * uCharge, 0.9 - 0.15 * uCharge, gap);
  float bands = abs(cloud2 - 0.5) * 2.0;
  float heart = pow(clamp(facing, 0.0, 1.0), 3.0) * smoothstep(0.2, 1.0, uCharge) * smoothstep(0.15, 0.6, bands);
  float light = clamp(thin * (0.35 + 0.45 * facing) * (1.0 - 0.35 * uCharge) + heart * (0.45 + 0.35 * uThrob), 0.0, 0.75);
  // The rim catches the storm's light (the ball's edge stays read).
  float rim = pow(clamp(1.0 - facing, 0.0, 1.0), 2.5);
  // Menace as it gathers: the storm darkens round a saturated, throbbing light.
  vec3 lit = mix(mix(uColor, uHot, uHotK) * (1.0 + 0.5 * uCharge), uCore, heart * 0.4);
  vec3 storm = uStorm * (0.45 + 0.9 * cloud * cloud2 * 1.6) * (1.0 - 0.5 * uCharge);
  vec3 col = mix(storm, lit * (1.1 + uThrob * 0.45), light);
  col += mix(uColor, uHot, uHotK) * rim * (0.35 + 0.4 * uCharge);
  float a = mix(0.92, 0.88, uCharge);
  gl_FragColor = vec4(col, a * uFade);
  #include <colorspace_fragment>
}
`;

/** The storm sky round the Cornice: a dome seen from inside (back faces),
 *  thick cloud rolling over it, darkest overhead, thinner at the horizon
 *  (the cloud sea stays read), lit from within by the nova's lightning
 *  (uFlash). Normal blending, drawn first of the see-through things: it
 *  darkens the sky and the far mountains, never the fight's own light. */
export const SKY_DOME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDark;
uniform float uFlash;
uniform vec3 uStorm;
uniform vec3 uLit;
varying vec3 vLocal;
${NOISE}
void main() {
  vec3 d = normalize(vLocal);
  float up = smoothstep(-0.3, 0.45, d.y);
  vec2 sky = d.xz / (0.3 + max(d.y, 0.0)) * 1.4;
  float cloud = pfbm(sky + vec2(uTime * 0.05, -uTime * 0.03));
  float body = smoothstep(0.3, 0.8, cloud);
  float lit = uFlash * smoothstep(0.5, 0.9, cloud) * (0.6 + 0.4 * pnoise(sky * 3.0 + uTime));
  vec3 col = mix(uStorm * (0.7 + 0.6 * body), uLit, lit);
  float a = uDark * (0.4 + 0.6 * up) * (0.65 + 0.35 * body) + lit * 0.35;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.88));
  #include <colorspace_fragment>
}
`;

/** The Closing Storm's two pieces share their shape: every vertex carries
 *  its isle's rim at that bearing (aRim, yards) and its place across or up
 *  (position: x and z a unit direction times the share of the rim). */
export const CLOSING_FLOOR_VERT = /* glsl */ `
attribute float aRim;
varying float vR;
varying float vA;
void main() {
  vR = length(position.xz);
  vA = atan(position.z, position.x);
  vec3 p = vec3(position.x * aRim, position.y, position.z * aRim);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

/** The floor under a Closing Storm: the ring where the storm stands now (a
 *  crisp line with a soft glow inside it), the stone beyond it shaded under
 *  the storm, faint streaks of wind running in toward the middle. vR the
 *  share of the rim, uK the ring's. Additive over a char pass is not needed:
 *  it is a thin mark, normal blended. */
export const CLOSING_FLOOR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uK;
uniform vec3 uColor;
uniform vec3 uShade;
uniform float uDark;
uniform float uThrob;
varying float vR;
varying float vA;
${NOISE}
void main() {
  float d = vR - uK;
  float line = 1.0 - smoothstep(0.0, 0.035, abs(d));
  float inner = (1.0 - smoothstep(0.0, 0.14, -d)) * step(d, 0.0);
  float out_ = smoothstep(-0.01, 0.06, d);
  float streak = smoothstep(0.62, 0.95, pnoise(vec2(vA * 9.0, vR * 6.0 + uTime * 1.6)));
  vec3 col = mix(uShade, uColor, clamp(line + inner * 0.6 + streak * 0.3 * out_, 0.0, 1.0));
  float a = line * (0.85 + 0.15 * uThrob) + inner * 0.35 + out_ * (0.18 + 0.32 * uDark) + streak * out_ * 0.18;
  gl_FragColor = vec4(col * (1.0 + line * 0.8), clamp(a, 0.0, 0.95));
  #include <colorspace_fragment>
}
`;

export const CLOSING_WALL_VERT = /* glsl */ `
attribute float aRim;
uniform float uK;
uniform float uH;
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec3 p = vec3(position.x * aRim * uK, position.y * uH - 0.4, position.z * aRim * uK);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(normalMatrix * vec3(position.x, 0.0, position.z));
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;

/** The Closing Storm's wall of cloud standing on the ring: torn storm cloud
 *  wheeling round the isle, darkest at its middle, a bright crawling foot
 *  where it meets the stone, lightning flickering inside, thinning at its
 *  crest; seen edge-on it thickens, seen face-on it stays a veil the raid
 *  sees through. vUv.x round, vUv.y up. Normal blending. */
export const CLOSING_WALL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uShade;
uniform float uDark;
uniform float uThrob;
uniform float uFlash;
varying vec2 vUv;
varying float vFacing;
${NOISE}
void main() {
  float x = vUv.x * 18.0;
  float y = vUv.y;
  float cloud = pfbm(vec2(x - uTime * 0.9 + y * 1.5, y * 3.0 - uTime * 0.6));
  float torn = smoothstep(0.32, 0.7, cloud + (1.0 - y) * 0.25 - y * 0.25);
  float foot = (1.0 - smoothstep(0.0, 0.12, y)) * (0.6 + 0.4 * uThrob);
  float bolt = step(0.93, pnoise(vec2(floor(x * 0.6), floor(uTime * 7.0)))) * smoothstep(0.1, 0.9, y) * uFlash;
  float edge = mix(1.0, 0.5, vFacing);
  // Storm cloud: the shade lit by the ring's colour only in its torn edges.
  float lit = smoothstep(0.45, 0.8, cloud) * 0.55;
  vec3 col = mix(uShade * (0.8 + 0.5 * cloud), uColor, clamp(foot * 0.8 + bolt + lit, 0.0, 1.0));
  float a = (torn * (0.3 + 0.5 * uDark) * edge + foot * 0.4 + bolt * 0.6) * (1.0 - smoothstep(0.7, 1.0, y));
  gl_FragColor = vec4(col * (1.0 + foot * 0.6 + bolt), clamp(a, 0.0, 0.9));
  #include <colorspace_fragment>
}
`;

/** The Stillstone's crystal: cut facets catching a cold light, a heart of
 *  calm teal (gold once stilled) breathing inside it, its edges bright. */
export const CRYSTAL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uGold;
uniform vec3 uCore;
uniform float uGlow;
uniform float uGoldK;
uniform float uPulse;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
${NOISE}
void main() {
  vec3 n = normalize(vN);
  float facing = max(dot(n, normalize(vView)), 0.0);
  float rim = pow(clamp(1.0 - facing, 0.0, 1.0), 2.0);
  float facet = pnoise3(floor(n * 3.5) + 0.5);
  float heart = pow(clamp(facing, 0.0, 1.0), 2.0) * (0.5 + 0.5 * uPulse);
  float swirl = pfbm3(vLocal * 1.6 + vec3(0.0, uTime * 0.4, 0.0));
  vec3 tint = mix(uColor, uGold, uGoldK);
  vec3 dark = tint * 0.06 + vec3(0.015, 0.02, 0.04);
  // Cut facets: each face its own tone, a bright edge where faces meet the light.
  float face = facet * facet;
  vec3 col = dark + tint * (face * 0.55 + swirl * 0.4 * uGlow) + mix(tint, uCore, 0.65) * (heart * uGlow * 0.9 + rim * (0.35 + 0.65 * uGlow));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** The Squall Ward: a curved shield of wind in front of the Shieldbearer
 *  (a band of a sphere round it, cut to its front arc: uHalf radians either
 *  side of local +z), streaks racing across it, its rim and its two ends
 *  bright (the edge of the arc a raider steps round), grit in it. Additive. */
export const WARD_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uRim;
uniform float uGlow;
uniform float uHalf;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
varying vec2 vUv;
${NOISE}
void main() {
  float ang = atan(vLocal.x, vLocal.z);
  if (abs(ang) > uHalf) discard;
  float u = ang / uHalf * 0.5 + 0.5;
  float facing = abs(dot(normalize(vN), normalize(vView)));
  float fres = pow(clamp(1.0 - facing, 0.0, 1.0), 1.8);
  float streak = smoothstep(0.55, 0.95, pnoise(vec2(u * 14.0 - uTime * 3.2, vUv.y * 9.0)));
  float ends = 1.0 - smoothstep(0.0, 0.06, min(u, 1.0 - u));
  float y = 1.0 - vUv.y;
  float top = smoothstep(0.0, 0.2, y) * (1.0 - smoothstep(0.75, 1.0, y));
  float grit = step(0.94, ph(floor(vec2(u * 40.0 - uTime * 8.0, vUv.y * 24.0)))) * 0.8;
  float k = ((0.06 + fres * 0.7 + streak * 0.55 + grit) * top + ends * 1.3 * top) * uGlow;
  vec3 col = mix(uColor, uRim, clamp(ends + streak * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col * (1.0 + 0.4 * k), clamp(k, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** The ward's front arc on the floor (a disc, vUv its planar uv, cut to
 *  the arc: uHalf either side of the disc's +y): its edge and its two side
 *  lines bright, a soft fill flowing outward. */
export const WARD_FLOOR_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uGlow;
uniform float uHalf;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = abs(atan(p.x, p.y));
  if (r > 1.0 || a > uHalf) discard;
  float side = 1.0 - smoothstep(0.0, 0.03, (uHalf - a) * r);
  float rim = smoothstep(0.9, 0.98, r) * (1.0 - smoothstep(0.98, 1.0, r));
  float flow = 0.5 + 0.5 * sin(r * 18.0 - uTime * 6.0);
  float k = (rim * 1.1 + side * 1.1 + (0.1 + 0.1 * flow) * smoothstep(0.2, 0.6, r)) * uGlow;
  gl_FragColor = vec4(uColor * (1.0 + 0.5 * k), clamp(k, 0.0, 0.9));
  #include <colorspace_fragment>
}
`;

/** A plain uv vertex shader. */
export const PHASE_UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The sky dome's vertex shader: its local direction only. */
export const SKY_DOME_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The cocoon's flung shards (instanced): each instance turned and placed by
 *  its matrix. */
export const SHARD_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * p;
  vN = normalize(normalMatrix * n);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

/** A shard of wind-glass: clear at its face, its edges catching a hard
 *  white light (fresnel), a cold tint between. Additive. */
export const GLASS_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
varying vec3 vN;
varying vec3 vView;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vView)));
  float fres = pow(clamp(1.0 - facing, 0.0, 1.0), 1.6);
  vec3 col = mix(uColor, vec3(1.0), fres);
  gl_FragColor = vec4(col * (1.0 + fres), clamp((0.25 + fres * 1.2) * uGlow, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** A shockwave racing over the floor (a disc, vUv its planar uv): a bright
 *  crest at its edge, a fading wake of wind behind it. Additive. */
export const SHOCK_FLOOR_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uGlow;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float crest = smoothstep(0.86, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float a = atan(p.y, p.x);
  float streak = smoothstep(0.5, 0.9, pnoise(vec2(a * 18.0, r * 4.0 - uTime * 3.0)));
  float wake = smoothstep(0.35, 0.95, r) * (0.25 + 0.5 * streak);
  float k = (crest * 1.6 + wake * 0.45) * uGlow;
  vec3 col = mix(uColor, vec3(1.0), crest * 0.6);
  gl_FragColor = vec4(col * (1.0 + 0.5 * k), clamp(k, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** Shoving Gale's wind inside its lane (a strip, vUv.x across, vUv.y along
 *  from the Herald): streaks of wind racing down it, bright where the bar
 *  has filled (uFill), a crisp front at the fill, faint beyond it. */
export const LANE_WIND_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uFill;
uniform float uGlow;
varying vec2 vUv;
${NOISE}
void main() {
  float across = abs(vUv.x * 2.0 - 1.0);
  float side = 1.0 - smoothstep(0.75, 1.0, across);
  float streak = smoothstep(0.55, 0.92, pnoise(vec2(vUv.x * 9.0, vUv.y * 7.0 - uTime * 3.2)));
  float fine = smoothstep(0.7, 0.98, pnoise(vec2(vUv.x * 23.0 + 3.0, vUv.y * 18.0 - uTime * 5.5)));
  float filled = 1.0 - smoothstep(uFill - 0.01, uFill + 0.01, vUv.y);
  float front = (1.0 - smoothstep(0.0, 0.025, abs(vUv.y - uFill))) * step(0.02, uFill);
  float chevron = smoothstep(0.6, 0.95, fract(vUv.y * 9.0 - across * 0.35 - uTime * 1.6));
  // Read from straight above too: a saturated body of wind down the whole
  // lane (stronger where the bar has filled), bright rails along both sides.
  float rails = smoothstep(0.82, 0.93, across) * (1.0 - smoothstep(0.96, 1.0, across));
  float body = (0.3 + 0.5 * filled) * side;
  float k = ((streak * 0.9 + fine * 0.6 + chevron * 0.6) * (0.3 + 0.7 * filled) + front * 1.6) * side;
  k = (k + body * 0.55 + rails * (0.9 + 0.5 * filled)) * uGlow;
  vec3 wind = mix(vec3(0.3, 0.72, 1.0), uColor, 0.35);
  vec3 col = mix(wind, vec3(1.0), clamp(fine * 0.6 + front + rails * 0.7, 0.0, 1.0));
  gl_FragColor = vec4(col * (1.0 + 0.4 * k), clamp(k, 0.0, 0.95));
  #include <colorspace_fragment>
}
`;
