// The shaders of the Anvil of the World's wall landmarks and its central
// well (phase 2M, heart_landmarks.ts and heart_quarters.ts paint with them):
// each landmark's own light (the Heat's lava flowing, the Hammer's gold
// crystal pulsing, the Quench's frost shimmering, the Breath's veins
// flickering with the storm), the air each one raises when its quarter
// wakes (the Heat's ember plume and smoke, the Hammer's golden motes, the
// Quench's frost wisps and glints, the Breath's sparks and its lightning),
// and the well's floor drawn as a sunken well of mist and crystal.
// Texture-free; every motion runs on the shared clock; every point goes
// through `modelViewMatrix` on a positioned mesh (the room's centre), so its
// own `position` is room-local. A flat effect quad is drawn double sided; no
// `pow()` of a value that can go negative (src/render/smith_heart/CLAUDE.md).

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/** Each landmark's life in its light (sets `flav` about 0.6 to 2 and `hot`,
 *  the white in it). */
const LANDMARK_FLAVOUR: Record<string, string> = {
  // Lava running down its face and its fall, crusting and breaking open.
  heat: `
    float flow = 0.5 + 0.5 * sin(vP.y * 1.9 + uTime * 4.2 + sin(vP.x * 0.6 + vP.z * 0.5) * 2.0);
    float crust = smoothstep(0.35, 0.9, sin(vP.x * 2.3 + uTime * 0.5) * sin(vP.z * 2.1 - uTime * 0.4) + 0.2);
    float flav = (0.75 + 0.7 * flow) * (1.0 - 0.45 * crust);
    float hot = flow * flow * 0.7 * (1.0 - crust);`,
  // The gold crystal breathing, glints running up it.
  hammer: `
    float beat = 0.5 + 0.5 * sin(uTime * 1.7 + vP.y * 0.25);
    float glint = max(0.0, sin(vP.y * 3.0 - uTime * 5.0 + vP.x * 1.3));
    glint = glint * glint * glint * glint * glint * glint;
    float flav = 0.8 + 0.5 * beat + 0.9 * glint;
    float hot = glint * 0.8 + beat * 0.15;`,
  // A slow cold shimmer, glints of frost catching.
  quench: `
    float sh = 0.5 + 0.5 * sin(vP.y * 0.8 - uTime * 0.9 + vP.x * 0.4);
    float glint = max(0.0, sin(dot(vP.xz, vec2(12.9898, 78.233)) * 2.1 + uTime * 2.4 + vP.y * 4.0));
    glint = glint * glint * glint * glint * glint * glint * glint * glint;
    float flav = 0.8 + 0.45 * sh + 1.0 * glint;
    float hot = glint * 0.8 + 0.2 * sh;`,
  // The storm: its veins flickering in bursts, as if the lightning ran
  // through the stone.
  breath: `
    float slot = floor(uTime * 11.0);
    float fl = step(0.6, fract(sin(slot * 12.9898 + floor(vP.y * 0.7) * 78.233) * 43758.5453));
    float wave = 0.5 + 0.5 * sin(vP.y * 1.4 - uTime * 6.0);
    float flav = 0.6 + 0.6 * wave + 1.2 * fl;
    float hot = fl * 0.75 + wave * 0.15;`,
};

/** A landmark's light (its kit glow slot): its quiet glow while its quarter
 *  sleeps, blazing with its element's life as its quarter wakes. */
export function landmarkGlowFrag(vein: string): string {
  return /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uQuiet;
uniform float uLit;
uniform float uTime;
uniform float uDark;
varying vec3 vShade;
varying vec3 vP;
void main() {
  ${LANDMARK_FLAVOUR[vein]}
  float level = mix(uQuiet * (0.85 + 0.15 * sin(uTime * 1.1 + vP.y * 0.3)), 1.15 * flav, uLit);
  vec3 white = vec3(1.0, 0.97, 0.9);
  vec3 c = uColor * (0.4 + 0.75 * vShade.r) * level * 1.5;
  c += mix(uColor, uHot, 0.5) * hot * uLit * (0.4 + 0.6 * vShade.r) * 1.1;
  c += white * smoothstep(0.92, 1.0, vShade.r) * 0.3 * uLit;
  vec3 dark = uColor * 0.05;
  gl_FragColor = vec4((dark + c) * (1.0 - 0.85 * uDark), 1.0);
  #include <colorspace_fragment>
}`;
}

const AIR_HEAD = /* glsl */ `
uniform float uTime;
uniform float uLit;
attribute vec2 aCorner;
attribute vec4 aParams;
varying vec2 vCorner;
varying float vFade;
varying float vHot;
`;

/** Shown while the landmark is awake (`uLit`), collapsed otherwise. */
const SHOW = (stretch = '1.0') => /* glsl */ `
  vFade *= uLit;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * vec2(1.0, ${stretch}) * size * step(0.002, vFade);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;`;

/** A plume: motes rising off a spot, spreading and drifting with the air
 *  (`aParams`: seed, size, speed, spread). The Heat's embers, the Hammer's
 *  gold, the Quench's rime, the Breath's sparks: their heights and their
 *  lives differ by uniforms. */
export const LANDMARK_PLUME_VERT = /* glsl */ `${AIR_HEAD}
uniform float uRise;
uniform float uSpread;
uniform float uSize;
uniform float uSpeed;
void main() {
  float seed = aParams.x;
  float life = fract(seed * 7.13 + uTime * uSpeed * (0.6 + 0.8 * aParams.z));
  vec3 p = position;
  float ang = seed * 37.0 + uTime * (0.7 + aParams.w);
  float spread = uSpread * (0.25 + life) * (0.4 + aParams.w);
  p.x += sin(ang) * spread + sin(uTime * 0.31 + seed * 9.0) * life * 2.0;
  p.z += cos(ang) * spread + cos(uTime * 0.27 + seed * 5.0) * life * 2.0;
  p.y += life * uRise * (0.55 + 0.6 * aParams.z);
  float tw = 0.55 + 0.45 * sin(uTime * 13.0 + seed * 80.0);
  vFade = smoothstep(0.0, 0.07, life) * (1.0 - smoothstep(0.55, 1.0, life)) * tw;
  vHot = 1.0 - life;
  float size = uSize * (0.6 + 0.8 * aParams.y);
  ${SHOW()}
}`;

/** A slow billow: big soft puffs rising and swelling (the Heat's smoke and
 *  haze over its crater, the Quench's frost mist). */
export const LANDMARK_BILLOW_VERT = /* glsl */ `${AIR_HEAD}
uniform float uRise;
uniform float uSize;
void main() {
  float seed = aParams.x;
  float life = fract(seed * 3.7 + uTime * 0.06 * (0.7 + aParams.z));
  vec3 p = position;
  p.xz += vec2(sin(seed * 20.0 + uTime * 0.2), cos(seed * 13.0 + uTime * 0.17)) * (1.0 + 4.0 * life);
  p.y += life * uRise;
  vFade = sin(3.14159 * life) * (0.55 + 0.45 * aParams.y);
  vHot = 0.3 * (1.0 - life);
  float size = uSize * (0.5 + 1.1 * life) * (0.7 + 0.6 * aParams.w);
  ${SHOW()}
}`;

/** A halo: one great soft glow on a spot, beating (the crater's light, the
 *  crystal's, the spires', the horns'). */
export const LANDMARK_HALO_VERT = /* glsl */ `${AIR_HEAD}
uniform float uQuiet;
void main() {
  vec3 p = position;
  float beat = 0.85 + 0.15 * sin(uTime * (1.4 + aParams.z) + aParams.x * 6.0);
  vFade = max(uQuiet * 0.35, uLit) * beat;
  vHot = 0.25;
  float size = (4.0 + 6.0 * aParams.y) * (0.7 + 0.3 * uLit);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * size * step(0.002, vFade);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}`;

/** The Breath's lightning: each bolt a ribbon turned to the camera,
 *  flashing in its own bursts while the quarter is awake, its path
 *  jumping with every flash (`aParams`: x the bolt's phase, y the side, z
 *  along it, w unused; `aOther`: the bolt's direction there). */
export const BOLT_VERT = /* glsl */ `
uniform float uTime;
uniform float uLit;
attribute vec2 aCorner;
attribute vec4 aParams;
attribute vec3 aOther;
varying vec2 vCorner;
varying float vFade;
varying float vHot;
void main() {
  float phase = aParams.x;
  float slot = floor(uTime * 9.0 + phase * 31.0);
  float r = fract(sin(slot * 12.9898 + phase * 78.233) * 43758.5453);
  float on = step(0.62, r) * uLit;
  float flash = 1.0 - fract(uTime * 9.0 + phase * 31.0);
  float mid = sin(3.14159 * aParams.z);
  vec3 jit = vec3(fract(sin((slot + aParams.z * 17.0) * 3.1) * 4375.5) - 0.5,
                  fract(sin((slot + aParams.z * 23.0) * 5.7) * 4375.5) - 0.5,
                  fract(sin((slot + aParams.z * 29.0) * 7.3) * 4375.5) - 0.5) * 1.6 * mid;
  vec3 p = position + jit;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 t = (modelViewMatrix * vec4(aOther, 0.0)).xyz;
  vec2 side = normalize(vec2(-t.y, t.x) + vec2(1e-4, 0.0));
  float w = 0.46 + 0.34 * mid;
  mv.xy += side * aCorner.y * w * step(0.002, on);
  vCorner = vec2(0.0, aCorner.y);
  vFade = on * (0.55 + 0.45 * flash);
  vHot = 0.6 + 0.4 * flash;
  gl_Position = projectionMatrix * mv;
}`;

/** The well's floor (the central circle's Kit_HeartWell glow faces, the
 *  mist tag): drawn as a sunken well under the walk. The eye's ray through
 *  each point is carried down into a cylinder of the well's radius: it
 *  meets either the well's wall (the dark rock falling away, veins of each
 *  quarter's light in it) or its bed (crystal round the heart's light), and
 *  passes layers of drifting mist on the way; the quarters lit colour the
 *  side that opens onto them, the final phase blazes it white-gold. */
export const WELL_VERT = /* glsl */ `
varying vec3 vP;
varying vec3 vEye;
void main() {
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // The eye's direction in the mesh's own frame (the mesh is placed
  // unscaled and unturned: its model-view's rotation is orthonormal).
  vEye = transpose(mat3(modelViewMatrix)) * (-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

export function wellFrag(
  wellR: number,
  depth: number,
  sweepDeg: number,
  firstDeg: number,
  lowGfx = false,
): string {
  return /* glsl */ `
uniform vec3 uV0;
uniform vec3 uV1;
uniform vec3 uV2;
uniform vec3 uV3;
uniform vec4 uQ;
uniform float uRing;
uniform float uBlaze;
uniform float uPulse;
uniform float uTime;
uniform float uDark;
varying vec3 vP;
varying vec3 vEye;
float wh(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float wn(vec2 q) {
  vec2 i = floor(q);
  vec2 u = fract(q);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), u.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Turned between octaves so no grid shows.
float wfbm(vec2 q) {
  mat2 m = mat2(0.8, -0.6, 0.6, 0.8);
  float v = 0.5 * wn(q);
  q = m * q * 2.03 + 3.7;
  v += 0.28 * wn(q);
  q = m * q * 2.01 - 1.3;
  v += 0.14 * wn(q);
  q = m * q * 2.02 + 5.1;
  v += 0.08 * wn(q);
  return v;
}
vec3 quarterAt(vec2 q, out float lit) {
  float b = degrees(atan(q.x, q.y));
  float phi = mod(b + ${f(sweepDeg)} - (${f(firstDeg)}), 360.0);
  float idx = floor(phi / 90.0);
  vec3 vc = uV0; lit = uQ.x;
  if (idx > 0.5) { vc = uV1; lit = uQ.y; }
  if (idx > 1.5) { vc = uV2; lit = uQ.z; }
  if (idx > 2.5) { vc = uV3; lit = uQ.w; }
  return vc;
}
void main() {
  const float R = ${f(wellR)};
  const float DEPTH = ${f(depth)};
  vec3 V = normalize(vEye);
  vec3 D = -V;
  float dy = max(0.08, -D.y);
  vec2 p = vP.xz;
  vec2 d = D.xz;
  vec3 heart = vec3(1.0, 0.86, 0.55);
  float beat = 0.82 + 0.18 * sin(uTime * 2.856);
  // Phase 2N: a funnel of rock falling away in broken courses, the eye's
  // ray marched down it. From above its narrowing courses read as rings
  // stepping down into the dark; from the side its wall rises over the bed.
  float t = 0.0;
  float depthAt = DEPTH;
  float wallHit = 0.0;
  vec2 hp = p;
  for (int k = 1; k <= 28; k++) {
    float z = DEPTH * float(k) / 28.0;
    vec2 q = p + d * (z / dy);
    float course = floor(z / (DEPTH / 7.0));
    float rw = R * (1.0 - 0.055 * course - 0.012 * z) + 0.35 * sin(atan(q.x, q.y) * 7.0 + course * 2.1);
    if (length(q) > rw) { depthAt = z; hp = q; wallHit = 1.0; break; }
    hp = q;
  }
  float qlit;
  vec3 qc = quarterAt(hp, qlit);
  float deep = clamp(depthAt / DEPTH, 0.0, 1.0);
  vec3 col;
  // The heart's light from below, pulsing up the well.
  float pulseUp = 0.5 + 0.5 * sin(uTime * 2.856 - depthAt * 0.9);
  if (wallHit > 0.5) {
    // The wall: dark rock in falling courses, each course's lip catching
    // the heart's light from below, veins of the quarters' light in it.
    float bear = atan(hp.x, hp.y);
    float cf = fract(depthAt / (DEPTH / 7.0));
    float strata = wfbm(vec2(bear * 6.0, depthAt * 1.3));
    vec3 rock = mix(vec3(0.02, 0.018, 0.024), vec3(0.075, 0.062, 0.066), strata);
    float lip = smoothstep(0.75, 1.0, cf);
    col = rock * (1.0 - 0.5 * deep) * (0.7 + 0.6 * (1.0 - cf));
    col += heart * lip * (0.06 + 0.2 * deep) * (0.4 + 0.6 * uRing) * (0.6 + 0.4 * pulseUp);
    float vein = smoothstep(0.6, 0.78, wfbm(vec2(bear * 9.0, depthAt * 0.7 - uTime * 0.12)));
    col += mix(heart * 0.45, qc * 1.1, qlit) * vein * (0.2 + 0.8 * max(uRing, qlit)) * (0.35 + 0.65 * deep);
  } else {
    // The bed: dark crystal round the heart's light, the quarters' colours
    // where they open.
    float rr = length(hp) / (R * 0.55);
    float cells = wfbm(hp * 0.42);
    float facet = smoothstep(0.5, 0.72, wfbm(hp * 1.1 + 7.0));
    vec3 bed = mix(vec3(0.02, 0.018, 0.026), vec3(0.075, 0.06, 0.065), cells);
    float core = exp(-rr * rr * 3.0);
    col = bed * (0.6 + 0.6 * facet);
    col += heart * (0.08 + 0.9 * core) * uRing * beat * (0.35 + 1.0 * facet * facet);
    col += qc * qlit * facet * smoothstep(0.7, 1.0, rr) * 0.3;
  }
  // The heart's glow welling up the shaft (a soft column of light seen
  // through the mist, stronger toward the bed).
  float shaft = exp(-dot(p + d * (DEPTH * 0.6 / dy), p + d * (DEPTH * 0.6 / dy)) / (R * R * 0.22));
  col += heart * shaft * (0.08 + 0.22 * uRing) * (0.6 + 0.4 * pulseUp);
  // Mist in layers between the walk and what the eye meets, each its own
  // drift and turn, lit from below by the heart (warmer the deeper), the
  // nearest thinnest so a body on the well's floor still stands in it.
  float mist = 0.0;
  vec3 mistC = vec3(0.0);
  for (int k = 0; k < ${lowGfx ? 4 : 6}; k++) {
    float z = (float(k) + 0.6) * DEPTH * 0.15;
    if (z > depthAt) break;
    vec2 q = p + d * (z / dy);
    float sw = uTime * (0.02 + 0.012 * float(k)) * (mod(float(k), 2.0) > 0.5 ? -1.0 : 1.0);
    mat2 turn = mat2(cos(sw), -sin(sw), sin(sw), cos(sw));
    float n = wfbm(turn * q * (0.07 + 0.012 * float(k)) + vec2(float(k) * 3.1, 1.7 + uTime * 0.01));
    n = smoothstep(0.2, 0.95, n);
    float am = n * (0.1 + 0.035 * float(k)) * (1.0 - mist);
    float warm = float(k) / 5.0;
    vec3 tint = mix(vec3(0.2, 0.18, 0.24), heart * 0.55, (0.15 + 0.6 * warm) * (0.3 + 0.7 * uRing));
    mistC += tint * am * (0.7 + 0.5 * uRing + 0.4 * pulseUp * uRing + 1.2 * uBlaze);
    mist += am;
  }
  col = col * (1.0 - mist) + mistC;
  // The light passing the ring, the final phase's blaze.
  float rp = length(p);
  float pr = (1.0 - uPulse) * R;
  col += vec3(1.0, 0.95, 0.85) * uPulse * exp(-(rp - pr) * (rp - pr) / 4.0) * 1.2;
  col *= 1.0 + uBlaze * (1.6 + 0.8 * sin(uTime * 4.2 - rp * 0.6));
  col += heart * uBlaze * 0.35 * exp(-rp * rp / 40.0);
  // The rim's shadow on the well's lip (its inner face looming over it).
  col *= 0.4 + 0.6 * smoothstep(R, R - 2.2, rp);
  gl_FragColor = vec4(col * (1.0 - 0.88 * uDark), 1.0);
  #include <colorspace_fragment>
}`;
}
