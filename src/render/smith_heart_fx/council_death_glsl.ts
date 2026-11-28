// The Hammer Council's deaths' own shaders (council_death_fx.ts and its two
// parts): the shafts of light leaking out of the Seam Singer's fracturing
// crystal. Everything else the scene draws reuses the entrance's programs
// (council_entrance_glsl.ts: the quarry's stone and its burning seams, the
// amber crystal, the light cards, the resonance rings, the columns' runes),
// so the scene links only this one program of its own. Every pow() base here
// is clamped (tests/shader_pow_domain.test.ts).

/** A shaft of light: an open cone along +y (its root at 0, its mouth at 1),
 *  `uv.y` along it. The instance's colour: red its strength, green a seed
 *  for its flicker. */
export const LEAK_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vLeak;
  varying float vFacing;
  void main() {
    vUv = uv;
    #ifdef USE_INSTANCING_COLOR
    vLeak = instanceColor.rg;
    #else
    vLeak = vec2(1.0, 0.0);
    #endif
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;

/** Amber-white light pouring out of a crack: white-hot at its root, its
 *  streaks running out along it and flickering, fading toward its mouth and
 *  at its grazing edges (so the cone reads as a soft shaft, never a tube).
 *  Additive. */
export const LEAK_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec2 vLeak;
  varying float vFacing;
  void main() {
    float level = vLeak.x;
    if (level <= 0.002) discard;
    float y = vUv.y;
    float seed = vLeak.y * 37.0;
    float streak = 0.55 + 0.45 * sin(vUv.x * 43.98 + seed + sin(y * 5.0 - uTime * 7.0 + seed) * 0.8);
    float flick = 0.82 + 0.18 * sin(uTime * (23.0 + seed) + seed * 3.1);
    float along = pow(clamp(1.0 - y, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.04, y);
    float soft = smoothstep(0.05, 0.6, vFacing);
    float k = along * soft * (0.45 + 0.55 * streak) * flick * level;
    vec3 col = mix(vec3(1.0, 0.6, 0.2), vec3(1.0, 0.95, 0.82), clamp(1.0 - y * 1.6, 0.0, 1.0));
    gl_FragColor = vec4(col * k, 1.0);
  }
`;
