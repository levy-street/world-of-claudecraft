// The shaders of the Guardian of the Breath's death (breath_death_fx.ts):
// the cloud overhead parting from the middle out with its torn rims lit
// gold, and the shaft of clear light that falls through the gap. Each on a
// positioned mesh under the painter's stage (three's modelViewMatrix,
// composed on the CPU). No light, no pow (every falloff a product).

const NOISE2 = /* glsl */ `
  float dh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float dn(vec2 p) {
    vec2 i = floor(p);
    vec2 g = fract(p);
    g = g * g * (3.0 - 2.0 * g);
    return mix(mix(dh(i), dh(i + vec2(1.0, 0.0)), g.x), mix(dh(i + vec2(0.0, 1.0)), dh(i + vec2(1.0, 1.0)), g.x), g.y);
  }
  float dfbm(vec2 p) {
    return dn(p) * 0.5 + dn(p * 2.07 + 5.3) * 0.28 + dn(p * 4.31 - 2.1) * 0.14 + dn(p * 8.9 + 9.7) * 0.08;
  }
`;

export const DECK_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** The storm's last cloud seen from under it: dark billows turning slowly,
 *  a hole opening from the middle out (uOpen, a share of the radius) with
 *  ragged edges, the torn rims lit gold by the sun above (uRim), the
 *  thunderclap lighting the whole deck from within (uClap). Normal blending. */
export const DECK_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uOpen;
  uniform float uRim;
  uniform float uClap;
  uniform float uTime;
  varying vec2 vUv;
  ${NOISE2}
  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float a = atan(c.y, c.x + 1e-5);
    vec2 q = vec2(cos(a - uTime * 0.03), sin(a - uTime * 0.03)) * (0.5 + r * 2.2);
    float m = dfbm(q * 1.7 + vec2(uTime * 0.04, 0.0));
    float m2 = dfbm(c * 3.1 - vec2(0.0, uTime * 0.05));
    // The gap's ragged edge: the billows' own noise pushes it in and out.
    float edgeR = r + (m - 0.5) * 0.22;
    float open = uOpen * 1.08;
    float gap = smoothstep(open - 0.04, open + 0.1, edgeR);
    float cloud = smoothstep(0.28, 0.66, m * 0.7 + m2 * 0.3);
    float rim = 1.0 - smoothstep(0.62, 1.0, r);
    float a1 = (0.62 + 0.38 * cloud) * rim * gap;
    vec3 dark = vec3(0.012, 0.015, 0.026);
    vec3 grey = vec3(0.07, 0.08, 0.11);
    vec3 col = mix(dark, grey, m2);
    // The torn rim lit gold where the sun breaks through.
    float lip = (1.0 - smoothstep(0.0, 0.16, abs(edgeR - open))) * step(0.01, uOpen);
    col += vec3(1.0, 0.78, 0.42) * uRim * lip * (0.6 + 0.6 * cloud);
    // The thunderclap lights the deck from within.
    col += vec3(0.55, 0.68, 1.0) * uClap * (0.35 + 0.65 * (1.0 - r));
    gl_FragColor = vec4(col, clamp(a1 * uAlpha, 0.0, 0.94));
    #include <colorspace_fragment>
  }
`;

/** The shaft: a unit open cylinder (y 0 the floor, 1 the cloud) narrowing to
 *  `uFoot` at the floor from `uTop` at the cloud (shares of the scale). */
export const SHAFT_VERT = /* glsl */ `
  uniform float uFoot;
  uniform float uTop;
  varying float vY;
  varying float vFace;
  varying vec2 vUv;
  void main() {
    vec3 p = position;
    p.xz *= mix(uFoot, uTop, p.y);
    vY = p.y;
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 n = normalize(normalMatrix * vec3(position.x, 0.0, position.z));
    vFace = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;

/** Clear light falling: soft at its sides (the face-on share), brightest
 *  near the floor and fading up into the cloud, slow bands of motes drifting
 *  down through it. Additive. */
export const SHAFT_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uTime;
  uniform vec3 uColor;
  varying float vY;
  varying float vFace;
  varying vec2 vUv;
  ${NOISE2}
  void main() {
    float side = vFace * vFace * vFace;
    float up = (1.0 - smoothstep(0.55, 1.0, vY)) * (0.55 + 0.45 * (1.0 - vY));
    float foot = smoothstep(0.0, 0.04, vY);
    float bands = 0.75 + 0.25 * dfbm(vec2(vUv.x * 9.0, vY * 3.0 + uTime * 0.12));
    float k = side * up * foot * bands * uAlpha;
    gl_FragColor = vec4(uColor * k, 1.0);
  }
`;
