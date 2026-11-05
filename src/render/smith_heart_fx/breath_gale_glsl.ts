// The Storm Cornice's funnels of wind (the vortex before the guardian's mouth,
// the loose gales and their cores), moved out of breath_fight_fx.ts in the
// AAA pass's third round (2026-11-04: "the gales still read as pale
// ribbons"). A gale is now a body of air: torn masses of storm cloud wound up
// the column and thickest at its silhouette (seen through more of itself
// there), dust-laden and dark low, paler where it opens to the sky, grit and
// debris carried round it in the spiral, a few bright streaks only where the
// wind runs fastest. `uCore` 1 is a gale's inner core: tighter, darker, no
// skirt. Texture free; one program for every funnel.

/** How a point faces the eye (the funnel's silhouette fills in). */
export const WIND_FUNNEL_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFace;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;

/** The cloud's body: share of the column's alpha its torn masses carry. */
export const GALE_BODY_ALPHA = 0.86;

export const FUNNEL_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform float uSpin;
uniform float uCore;
uniform vec3 uWind;
uniform vec3 uShade;
uniform vec3 uGrit;
varying vec2 vUv;
varying float vFace;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  return n(p) * 0.55 + n(p * 2.13 + 7.1) * 0.3 + n(p * 4.37 - 3.3) * 0.15;
}
void main() {
  float y = vUv.y;
  // The spiral the air rides (wound tighter in the core), sheared upward.
  float sp = vUv.x * 6.0 + y * (3.0 + 2.0 * uCore) - uTime * uSpin;
  // Torn masses of cloud wound up the column, slowly churning.
  float mass = fbm(vec2(sp * 1.6, y * 3.2 - uTime * 0.35));
  float torn = smoothstep(0.3, 0.64, mass);
  // Seen edge on, wind is seen through more of itself: the silhouette fills.
  float edge = 1.0 - vFace;
  float thick = 0.5 + 0.5 * edge * edge;
  float body = torn * thick * (1.0 - smoothstep(0.25, 0.98, y));
  // The fastest wind: a few bright streaks only, never the whole look.
  float streak = smoothstep(0.82, 0.95, n(vec2(sp * 5.0, y * 7.0))) * (0.4 + 0.6 * torn);
  // Grit and debris carried round in the spiral: small dark flecks.
  vec2 cell = vec2(sp * 9.0, y * 26.0);
  float fleck = step(0.94, h(floor(cell))) * smoothstep(0.5, 0.15, length(fract(cell) - 0.5));
  fleck *= (1.0 - smoothstep(0.05, 0.75, y)) * (1.0 - 0.6 * uCore);
  // The skirt where it scours the floor: a dense billow of dust.
  float skirt = (1.0 - smoothstep(0.0, 0.24, y)) * (1.0 - uCore) * (0.45 + 0.55 * smoothstep(0.3, 0.7, mass));
  float fade = smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.72, 1.0, y));
  float a = (body * ${GALE_BODY_ALPHA.toFixed(2)} + skirt * 0.8 + streak * 0.35 + fleck * 0.9) * fade * uAlpha;
  // Its colour: storm grey-blue in the body, the dust's brown low, paler up
  // where it opens to the sky; the core darker still.
  vec3 col = mix(uShade, uWind, 0.22 + 0.5 * smoothstep(0.2, 0.95, y) * (1.0 - torn * 0.45));
  // The dust's brown only in the skirt (the column itself is cool storm grey).
  col = mix(col, uGrit, clamp(skirt * 0.65, 0.0, 1.0));
  col = mix(col, uWind * 1.05, streak * 0.8);
  col = mix(col, uGrit * 0.45, fleck);
  col *= (0.62 + 0.45 * y) * (1.0 - 0.32 * uCore);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.94));
  #include <colorspace_fragment>
}
`;

/** The dust rolling out at a gale's foot: soft billows that swell and overlap
 *  into one skirt (the first round's small puffs read as popcorn in a ring). */
export const GALE_FOOT_DUST = {
  rate: 22,
  size: [1.4, 4.6] as const,
  alpha: 0.3,
  life: 1.9,
  speed: 2.6,
  drag: 1.1,
  /** A cool grey dust a breath warmer than the Cornice. */
  color: [0.5, 0.48, 0.46] as const,
} as const;

/** The grit thrown up round the column: small dark flecks, fewer than before. */
export const GALE_GRIT = {
  rate: 14,
  size: [0.22, 0.12] as const,
  alpha: 0.9,
  color: [0.27, 0.26, 0.28] as const,
} as const;
