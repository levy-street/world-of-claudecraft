// The Guardian of the Hammer's blows' floor shader (council_strike_fx.ts
// builds it; the plan is council_strike_core.ts). A string only (no Three,
// no state); the vertex goes through `modelViewMatrix` (camera-relative: the
// Quarry sits in an instance band far from the world's origin); the noise
// runs on the mesh's own coordinates (its local units: the cracks' full
// reach is 1).
//
//   CRACKS  under the caster: jagged cracks of the vein's light splitting
//           open out of its feet as the bar fills, rings of light drawn in
//           over the floor toward it while it gathers, the whole flaring
//           white at the release and cooling.

export const STRIKE_FLOOR_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const STRIKE_CRACKS_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCrack;
uniform float uHeat;
uniform float uDraw;
uniform float uAlpha;
uniform float uSeed;
uniform vec3 uLight;
uniform vec3 uCore;
varying vec2 vLocal;
const float TAU = 6.2831853;
float sh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sh(i), sh(i + vec2(1.0, 0.0)), f.x), mix(sh(i + vec2(0.0, 1.0)), sh(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float ang = atan(vLocal.x, vLocal.y);
  // Jagged spokes out of its feet, each its own length, wandering.
  float wob = (sn(vec2(ang * 2.6 + uSeed, r * 7.0)) - 0.5) * 0.7 + (sn(vec2(ang * 9.0, r * 19.0)) - 0.5) * 0.18;
  float a = (ang + wob * 0.3) / TAU * 11.0;
  float spoke = abs(fract(a) - 0.5) * 2.0;
  float width = 0.05 + 0.07 * (1.0 - r);
  float crack = 1.0 - smoothstep(0.0, width, spoke);
  float reach = 0.45 + 0.55 * sh(vec2(floor(a), uSeed));
  crack *= 1.0 - smoothstep(reach * uCrack * 0.85, reach * uCrack + 0.001, r);
  // A web of fine cracks round its feet.
  float web = smoothstep(0.66, 0.72, 1.0 - abs(sn(vLocal * 11.0 + uSeed) * 2.0 - 1.0));
  web *= (1.0 - smoothstep(0.1, 0.35, r)) * uCrack;
  float k = max(crack, web * 0.7);
  float flick = 0.8 + 0.2 * sn(vLocal * 14.0 + uTime * 4.0);
  vec3 col = mix(uLight, uCore, smoothstep(0.5, 1.0, uHeat) * (1.0 - r)) * k * flick * (0.5 + 1.5 * uHeat);
  float alpha = k * clamp(uHeat * 1.3, 0.0, 1.0);
  // The rings drawn in toward it while it gathers.
  float rings = 0.0;
  for (int i = 0; i < 3; i++) {
    float rr = 1.0 - fract(uTime * 0.7 + float(i) / 3.0);
    float band = 1.0 - smoothstep(0.0, 0.035, abs(r - rr));
    rings += band * smoothstep(0.0, 0.25, rr) * (1.0 - smoothstep(0.85, 1.0, rr));
  }
  col += uLight * rings * uDraw * 0.9;
  alpha += rings * uDraw * 0.6;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uAlpha);
}
`;
