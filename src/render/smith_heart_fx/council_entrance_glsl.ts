// The Hammer Council entrance's shaders (council_entrance_fx.ts and its two
// parts, council_entrance_stone.ts and council_entrance_crystal.ts): the
// quarry's stone (the Guardian's spur, its slabs and rubble, the hopping
// pebbles) lit by one fixed key light with the cracks burning up it; the
// Seam Singer's amber crystal; the carved columns' climbing runes; light
// cards; the punch's wall of dust and the note's wall of light; the
// resonance rings. Every pow() base here is clamped (tests/
// shader_pow_domain.test.ts).

/** A cheap 3D value noise (`n3`), 0..1. */
export const COUNCIL_NOISE3_GLSL = /* glsl */ `
  float h3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float n3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(h3(i), h3(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(h3(i + vec3(0.0, 1.0, 0.0)), h3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(h3(i + vec3(0.0, 0.0, 1.0)), h3(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(h3(i + vec3(0.0, 1.0, 1.0)), h3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
`;

// ---- stone: the spur, its slabs and rubble, the pebbles ----------------------------------------

/** The spur's slabs and the rubble: placed by their instance, their own
 *  stage-local place carried for the cracks' reveal up the spur. */
export const STONE_VERT = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vObj;
  varying vec3 vN;
  void main() {
    vec4 p = instanceMatrix * vec4(position, 1.0);
    vLocal = p.xyz;
    vObj = position;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * p;
  }
`;

/** The pebbles: hopping with the thrum (each on its own beat, irregular),
 *  kicked high as the punch's ring rolls under them. `aPeb`: its seed and
 *  its distance from the Guardian. */
export const PEBBLE_VERT = /* glsl */ `
  attribute vec2 aPeb;
  uniform float uThrum;
  uniform float uTime;
  uniform float uRingR;
  uniform float uRing;
  varying vec3 vLocal;
  varying vec3 vObj;
  varying vec3 vN;
  void main() {
    float seed = aPeb.x;
    float rate = 1.4 + seed * 1.8;
    float ph = fract(uTime * rate + seed * 7.13);
    float beat = step(0.45, fract(sin(floor(uTime * rate + seed * 7.13) * 12.9898 + seed * 78.233) * 43758.5453));
    float hop = 4.0 * ph * (1.0 - ph) * beat * uThrum * (0.12 + 0.34 * seed);
    float across = (uRingR - aPeb.y) / 3.0;
    float kick = exp(-across * across) * uRing * (0.6 + 0.8 * seed);
    vec4 p = instanceMatrix * vec4(position, 1.0);
    p.y += hop + kick;
    vLocal = vec3(0.0);
    vObj = position;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * p;
  }
`;

/** The quarry's sandstone: warm strata under one fixed key light (the
 *  quarry's sun, high in the south-west) and a cool fill, the cracks burning
 *  ochre-gold up the spur to `uCrack` (its share of `uHeight`), white-hot at
 *  their leading front; `uEmber` keeps a dull glow in a flying slab's seams.
 *  `uTint` darkens a pebble to the floor's grit. */
export const STONE_FRAG = /* glsl */ `
  uniform float uCrack;
  uniform float uHeat;
  uniform float uHeight;
  uniform float uEmber;
  uniform float uTime;
  uniform float uTint;
  varying vec3 vLocal;
  varying vec3 vObj;
  varying vec3 vN;
  ${COUNCIL_NOISE3_GLSL}
  void main() {
    vec3 n = normalize(vN);
    vec3 key = normalize(vec3(-0.45, 0.8, -0.35));
    float lam = max(dot(n, key), 0.0);
    float fill = 0.5 + 0.5 * n.y;
    float g = n3(vObj * 2.6) * 0.6 + n3(vObj * 7.0) * 0.4;
    float strata = 0.5 + 0.5 * sin((vLocal.y + vObj.y * 0.6) * 2.4 + g * 2.2);
    vec3 dark = vec3(0.16, 0.135, 0.125);
    vec3 light = vec3(0.46, 0.38, 0.31);
    vec3 albedo = mix(dark, light, 0.35 + 0.45 * strata + 0.2 * g) * mix(1.0, 0.55, uTint);
    vec3 col = albedo * (0.26 * fill + 0.9 * lam);
    // The cracks: ridged noise over the stone, revealed up the spur.
    float r1 = 1.0 - abs(n3(vLocal * 0.55 + vObj * 0.9) * 2.0 - 1.0);
    float r2 = 1.0 - abs(n3(vLocal * 1.3 + 11.0) * 2.0 - 1.0);
    float ridge = max(r1 * r1 * r1, r2 * r2 * r2 * r2 * 0.9);
    float line = smoothstep(0.78, 0.97, ridge);
    float halo = smoothstep(0.55, 0.95, ridge);
    float h = uHeight > 0.0 ? clamp(vLocal.y / uHeight, 0.0, 1.0) : 0.0;
    float shown = 1.0 - smoothstep(uCrack - 0.06, uCrack, h);
    float front = exp(-((uCrack - h) * 14.0) * ((uCrack - h) * 14.0)) * step(0.001, uCrack) * (1.0 - step(0.999, uCrack));
    float flick = 0.8 + 0.2 * sin(uTime * 9.0 + vLocal.y * 2.0 + g * 6.0);
    float heat = shown * uHeat * flick + uEmber * 0.55;
    vec3 molten = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.86, 0.5), clamp(line + front * 0.6, 0.0, 1.0));
    col += molten * (line * 2.4 + halo * 0.35) * heat;
    col += vec3(1.0, 0.92, 0.7) * line * front * shown * uHeat * 2.5;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---- crystal: the vein, the cocoon, the shards ---------------------------------------------------

export const CRYSTAL_VERT = /* glsl */ `
  attribute float aH;
  varying vec3 vN;
  varying vec3 vV;
  varying float vH;
  varying vec3 vGlow;
  void main() {
    vH = aH;
    #ifdef USE_INSTANCING_COLOR
    vGlow = instanceColor;
    #else
    vGlow = vec3(1.0);
    #endif
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

/** Amber crystal: deep and see-through facing the eye (so her curled body
 *  shows through the cocoon), its rims and facets bright, a light pulsing
 *  up its length with `uGlow` (past 1 ringing), the instance's colour
 *  scaling it. */
export const CRYSTAL_FRAG = /* glsl */ `
  uniform float uGlow;
  uniform float uTime;
  uniform float uClear;
  varying vec3 vN;
  varying vec3 vV;
  varying float vH;
  varying vec3 vGlow;
  void main() {
    vec3 n = normalize(vN);
    float fr = clamp(1.0 - abs(dot(n, normalize(vV))), 0.0, 1.0);
    float rim = fr * fr;
    float light = vGlow.r * uGlow;
    float band = 0.5 + 0.5 * sin(vH * 9.0 - uTime * (2.0 + 6.0 * min(uGlow, 1.5)));
    vec3 deep = vec3(0.16, 0.06, 0.012);
    vec3 amber = vec3(1.0, 0.56, 0.16);
    vec3 hot = vec3(1.0, 0.86, 0.52);
    vec3 col = deep + amber * rim * (0.45 + 0.9 * light) + hot * light * (0.18 + 0.32 * band) * (0.35 + 0.65 * vH);
    float a = clamp((0.36 + 0.45 * rim + 0.15 * light) * (1.0 - uClear * (1.0 - rim) * 0.55), 0.0, 0.94);
    gl_FragColor = vec4(col, a);
  }
`;

// ---- the carved columns' light ---------------------------------------------------------------------

export const SHEATH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vGlow;
  void main() {
    vUv = uv;
    #ifdef USE_INSTANCING_COLOR
    vGlow = instanceColor;
    #else
    vGlow = vec3(0.0);
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

/** A carved column waking: thin seams of light climbing each face from its
 *  foot to its climb (`vGlow.r`), the climb's front a white-gold band, a
 *  ring of light at its foot and, once lit to the top, at its crown; the
 *  whole breathing at `vGlow.g` (past 1 flaring with the wave of light).
 *  Additive, and kept to lines: the column's own stone still reads. */
export const SHEATH_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vGlow;
  void main() {
    float climb = vGlow.r;
    float glow = vGlow.g;
    if (glow <= 0.001) discard;
    float y = vUv.y;
    float lit = 1.0 - smoothstep(climb - 0.03, climb, y);
    // Two seams down each face (four faces round the sheath), wandering.
    float u = vUv.x * 8.0 + 0.5 + 0.06 * sin(y * 23.0 + floor(vUv.x * 8.0) * 1.7);
    float seam = 1.0 - smoothstep(0.0, 0.05, abs(fract(u) - 0.5));
    // A branch now and then off a seam.
    float branch = (1.0 - smoothstep(0.0, 0.035, abs(fract(u * 2.0 + y * 3.0) - 0.5)))
      * step(0.72, fract(sin(floor(y * 9.0) * 12.9898 + floor(u) * 4.1) * 43758.5453));
    float rings = (1.0 - smoothstep(0.0, 0.025, abs(y - 0.03)))
      + (1.0 - smoothstep(0.0, 0.025, abs(y - 0.95))) * step(0.97, climb);
    float fq = (climb - y) / 0.035;
    float front = exp(-fq * fq) * (1.0 - step(0.999, climb));
    float flow = 0.7 + 0.3 * sin(y * 30.0 - uTime * 6.0 + vUv.x * 12.0);
    float k = ((seam * 0.75 + branch * 0.4) * flow + rings * 0.9) * lit * glow + front * 1.2 * step(0.001, climb);
    vec3 c = mix(vec3(1.0, 0.48, 0.1), vec3(1.0, 0.88, 0.6), clamp(front + seam * 0.25, 0.0, 1.0));
    gl_FragColor = vec4(c * k * 0.8, 1.0);
  }
`;

// ---- light cards: billboards ------------------------------------------------------------------------

export const GLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vCol;
  void main() {
    vUv = uv;
    #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
    vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float s = length(instanceMatrix[0].xyz);
    #else
    vCol = vec3(1.0);
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float s = length(modelMatrix[0].xyz);
    #endif
    c.xy += position.xy * s;
    gl_Position = projectionMatrix * c;
  }
`;

/** A soft round light: a hot core in a wide falloff, the instance's colour
 *  its tint and strength. Additive. */
export const GLOW_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vCol;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float g = max(1.0 - d, 0.0);
    float core = g * g * g * g;
    float k = g * g * 0.55 + core * 1.1;
    if (k * max(vCol.r, max(vCol.g, vCol.b)) <= 0.002) discard;
    gl_FragColor = vec4(vCol * k, 1.0);
  }
`;

// ---- walls: the punch's dust, the note's light -----------------------------------------------------

export const WALL_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;

/** The punch's ring: a rolling wall of dust and grit, billowing, thickest at
 *  its foot, its crest ragged. Normal blending (dust hides, never glows). */
export const DUST_WALL_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uTime;
  uniform float uWrap;
  varying vec2 vUv;
  varying float vFacing;
  ${COUNCIL_NOISE3_GLSL}
  void main() {
    float h = vUv.y;
    float n = n3(vec3(vUv.x * uWrap, h * 3.0 - uTime * 1.4, uTime * 0.3));
    float n2 = n3(vec3(vUv.x * uWrap * 2.3, h * 6.0 - uTime * 2.2, 3.0));
    float top = 1.0 - smoothstep(0.35 + 0.4 * n, 0.95, h);
    float foot = smoothstep(0.0, 0.05, h);
    float k = top * foot * (0.55 + 0.45 * n2) * (0.35 + 0.65 * vFacing);
    vec3 col = mix(vec3(0.42, 0.33, 0.24), vec3(0.78, 0.66, 0.5), n * 0.7 + h * 0.3);
    gl_FragColor = vec4(col, clamp(k * uAlpha, 0.0, 0.9));
  }
`;

/** The note's wave: a curtain of amber light with bright bands rising up it.
 *  Additive. */
export const LIGHT_WALL_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uTime;
  uniform float uWrap;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    float h = vUv.y;
    float lace = 0.5 + 0.5 * sin(vUv.x * uWrap + sin(h * 7.0 + uTime * 3.0) * 1.2);
    float bands = 0.6 + 0.4 * sin(h * 26.0 - uTime * 9.0);
    float fade = (1.0 - smoothstep(0.15, 1.0, h)) * smoothstep(0.0, 0.04, h);
    float k = fade * (0.45 + 0.55 * lace * bands) * (0.4 + 0.6 * vFacing);
    vec3 col = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.93, 0.72), lace * (1.0 - h));
    gl_FragColor = vec4(col * k * uAlpha, 1.0);
  }
`;

// ---- the resonance rings off the vein ------------------------------------------------------------

export const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vA;
  void main() {
    vUv = uv;
    #ifdef USE_INSTANCING_COLOR
    vA = instanceColor.r;
    #else
    vA = 1.0;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

/** A thin bright ring of sound, its edge soft. `vUv.y` runs across the band
 *  (RingGeometry's), the instance's red its strength. Additive. */
export const RING_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying float vA;
  void main() {
    if (vA <= 0.002) discard;
    float across = abs(vUv.y - 0.5) * 2.0;
    float k = 1.0 - smoothstep(0.2, 1.0, across);
    vec3 col = mix(vec3(1.0, 0.55, 0.16), vec3(1.0, 0.92, 0.7), k);
    gl_FragColor = vec4(col * k * vA, 1.0);
  }
`;

// ---- the flash: a burst of light on a point (never the whole view) ---------------------------------
// (drawn with GLOW_VERT and GLOW_FRAG on its own card.)
