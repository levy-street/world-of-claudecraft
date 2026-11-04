// The engine kit's smoke (engine_particles.ts, the `smoke` pool): the crypt
// kit's billboards (crypt_fx_particles.ts PARTICLE_VERT) with two fixes the
// Smith's Heart audit found (points 13 and 20), and a painted billow instead
// of a round puff.
//  - A puff clamped to its floor stood half in the ground, so the floor cut it
//    in a straight line (the "white square" over the Quench's lake): its
//    sprite is lifted until its lower edge clears the floor.
//  - The round puff reached its quad's edge, so the quad's sides cut it
//    straight: the billow is windowed well inside its quad.
//  - A row of round puffs read as beads on a string: each billow is lobed and
//    torn by its own noise, and frays into wisps as it ages.

import { PARTICLE_VERT } from '../hollow_crypt/crypt_fx_particles';

/** Where the crypt kit's vertex shader billboards a particle. */
const BILLBOARD_CALL = 'billboard(p, size,';

/** How far over its floor a smoke sprite's centre stays (share of its size: a
 *  quad of side `size`, so 0.5 is its lower edge on the floor). */
export const SMOKE_FLOOR_LIFT = 0.48;

/** The smoke's vertex shader: the crypt kit's, its sprite kept over its floor. */
export const SMOKE_VERT = PARTICLE_VERT.replace(
  BILLBOARD_CALL,
  `p.y = max(p.y, aLife.w + size * ${SMOKE_FLOOR_LIFT.toFixed(2)});\n  ${BILLBOARD_CALL}`,
);

/** The smoke's fragment shader: a lobed, torn billow, windowed inside its quad. */
export const SMOKE_FRAG = /* glsl */ `
varying float vT;
varying float vSeed;
varying vec4 vColor;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float a = atan(d.y, d.x);
  // Its own outline: a few lobes, never a disc.
  float lobes = 0.09 * sin(a * 3.0 + vSeed * 21.0) + 0.05 * sin(a * 5.0 - vSeed * 13.0);
  // Torn by noise drifting through it as it lives.
  vec2 q = vUv * 2.6 + vec2(vSeed * 17.0, vSeed * 9.0 - vT * 0.9);
  float n = vnoise(q) * 0.55 + vnoise(q * 2.3 + 4.1) * 0.3 + vnoise(q * 5.1 - 2.7) * 0.15;
  float shape = r - lobes - (n - 0.5) * 0.75;
  float body = 1.0 - smoothstep(0.0, 0.85, shape);
  // The quad's own edge never shows.
  body *= 1.0 - smoothstep(0.66, 0.97, r);
  // It frays into wisps as it ages.
  float fray = 0.12 + 0.45 * smoothstep(0.2, 1.0, vT);
  body = smoothstep(fray, fray + 0.75, body * (0.6 + 0.6 * n));
  float fade = smoothstep(0.0, 0.12, vT) * (1.0 - smoothstep(0.35, 1.0, vT));
  // Its own light: the thick of it a touch deeper than its torn edge.
  vec3 col = vColor.rgb * (0.78 + 0.34 * n) * (0.9 + 0.18 * (1.0 - body));
  gl_FragColor = vec4(col, body * fade * vColor.a);
}
`;
