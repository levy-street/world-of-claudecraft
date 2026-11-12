// The shader of the Guardian of the Quench's death (quench_death_fx.ts): the
// lake settling into a still, mirror-calm sheet round her once its cracks
// have healed. On a positioned disc under the painter's stage (three's
// modelViewMatrix, composed on the CPU). No light, no pow (every falloff a
// product).

export const MIRROR_VERT = /* glsl */ `
  varying vec2 vLocal;
  varying vec3 vView;
  varying vec3 vUp;
  void main() {
    vLocal = position.xz;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vUp = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
    gl_Position = projectionMatrix * mv;
  }
`;

/** Still ice as a mirror: the sky's cold blue deepening toward the eye,
 *  brightening to a pale sheen at a grazing look (a fresnel off the flat
 *  sheet), one soft glint band of the light over the lake, a faint frost
 *  rim fading it into the lake round its edge (local yards, its radius
 *  `uRadius`). Normal blending. */
export const MIRROR_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uRadius;
  uniform float uTime;
  varying vec2 vLocal;
  varying vec3 vView;
  varying vec3 vUp;
  void main() {
    float r = length(vLocal) / uRadius;
    if (r > 1.0) discard;
    vec3 v = normalize(vView);
    // The view's grazing share off the flat sheet (its normal, up, in the
    // view's frame).
    float graze = 1.0 - abs(dot(normalize(vUp), v));
    float fr = graze * graze;
    fr = fr * fr;
    vec3 deep = vec3(0.01, 0.05, 0.13);
    vec3 sky = vec3(0.3, 0.5, 0.72);
    vec3 col = mix(deep, sky, 0.2 + 0.8 * fr);
    // A slow soft glint band drifting over it (the light on still water).
    float band = sin(vLocal.x * 0.11 + vLocal.y * 0.07 + uTime * 0.15);
    band = max(band, 0.0);
    band = band * band * band;
    col += vec3(0.9, 0.97, 1.0) * band * 0.18;
    float edge = 1.0 - smoothstep(0.62, 1.0, r);
    float a = (0.16 + 0.12 * fr + 0.06 * band) * edge * uAlpha;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.3));
    #include <colorspace_fragment>
  }
`;
