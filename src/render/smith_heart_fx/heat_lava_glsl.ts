// The Guardian of the Heat's molten look in GLSL, shared by its painters
// (heat_fx.ts, heat_fight_fx.ts, heat_well_fx.ts, heat_cinder_fx.ts): value
// noise and fBm, a cell field for the crust's plates, and the first flame's
// molten ramp (a white-hot core, gold, amber, a deep umber glow under a dark
// basalt crust). The Hearth's art rule: white-gold and molten gold, never
// volcanic red. Strings only (no Three, no state): each painter splices what
// it needs into its own shaders, compiled under its own gated root.

/** Hash, value noise and a five-octave fBm on a 2D field. */
export const HEAT_NOISE_GLSL = /* glsl */ `
float hh2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hh2(i), hh2(i + vec2(1.0, 0.0)), f.x),
             mix(hh2(i + vec2(0.0, 1.0)), hh2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vn(p);
    p = p * 2.03 + vec2(13.1, 7.7);
    a *= 0.5;
  }
  return s;
}
// The distance to the nearest cell's edge (the crust's plates).
float cellEdge(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hh2(i + g), hh2(i + g + 17.3));
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; }
      else if (d < d2) { d2 = d; }
    }
  }
  return d2 - d1;
}
`;

/** The molten ramp: `m` 0 (cold crust) to 1 (white-hot), as a colour. */
export const HEAT_MOLTEN_GLSL = /* glsl */ `
vec3 molten(float m) {
  vec3 crust = vec3(0.075, 0.062, 0.055);
  vec3 deep = vec3(0.55, 0.22, 0.05);
  vec3 amber = vec3(0.98, 0.55, 0.16);
  vec3 gold = vec3(1.0, 0.78, 0.36);
  vec3 core = vec3(1.0, 0.97, 0.86);
  vec3 c = mix(crust, deep, smoothstep(0.0, 0.3, m));
  c = mix(c, amber, smoothstep(0.25, 0.55, m));
  c = mix(c, gold, smoothstep(0.5, 0.78, m));
  c = mix(c, core, smoothstep(0.78, 1.0, m));
  // Past the crust it glows (HDR-ish: the bloom lifts it).
  return c * (1.0 + 1.6 * smoothstep(0.35, 1.0, m));
}
`;

/**
 * A flowing molten surface at field point `p` (yards), flowing along `flow`
 * (yards a second), at time `t`, with heat `heat` (0..1.5): domain-warped fBm
 * rolling under drifting plates of dark crust whose seams glow. Returns the
 * molten level 0..1 (feed it to `molten`).
 */
export const HEAT_LAVA_GLSL = /* glsl */ `
float lavaLevel(vec2 p, vec2 flow, float t, float heat) {
  vec2 q = p * 0.35 - flow * t * 0.35;
  vec2 w = vec2(fbm(q + vec2(0.0, t * 0.08)), fbm(q + vec2(5.2, 1.3) - t * 0.06));
  float body = fbm(q * 1.4 + w * 1.8 + vec2(t * 0.05, -t * 0.04));
  // The crust: plates riding the flow, their seams molten.
  float edge = cellEdge(p * 0.42 - flow * t * 0.3 + w * 0.6);
  float crust = smoothstep(0.05, 0.22, edge) * smoothstep(0.62, 0.38, body);
  float m = body * 1.15 - crust * 0.75;
  m += (1.0 - smoothstep(0.0, 0.06, edge)) * 0.45;
  return clamp(m * heat, 0.0, 1.0);
}
`;
