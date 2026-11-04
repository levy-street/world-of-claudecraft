// The socket each of the Smith's blades is driven into on the Frozen Lake
// (moved out of quench_blades_fx.ts in the AAA pass's third round,
// 2026-11-04: "the socket still reads as a pale sticker, the blade floating
// over it"). The socket now lies at the blade's home the whole fight, turned
// along its broad face: seated, the blade stands IN it (the slot's dark water
// round its foot); torn out, the slot stays. It reads carved, never painted
// on: the heaved plates lit along their raised edges and shaded on the far
// ones, the slot's inner walls falling dark to the water with a thin rime
// lip catching the light, the whole fading out into the lake with no edge.

export const SOCKET_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The light the plates' raised edges take (the lake's own key, in the
 *  socket's plane: x along the blade's broad face, y across it). */
export const SOCKET_LIGHT = [-0.6, 0.8] as const;

export const SOCKET_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uDark;
uniform vec3 uLight;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float rag = 0.78 + 0.16 * n(vec2(a * 2.5, 1.7)) + 0.06 * n(vec2(a * 9.0, 4.1));
  if (r > rag) discard;
  // Heaved plates along warped seams (never sectors of a circle).
  vec2 q = p * 2.4 + vec2(n(p * 3.0), n(p * 3.0 + 7.0)) * 0.8;
  float plate = h(floor(q));
  vec2 f = fract(q);
  float seam = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float crack = (1.0 - smoothstep(0.02, 0.06, seam)) * smoothstep(0.2, 0.45, r);
  // Each plate tipped up toward the slot: its raised edge lit, its far edge in shade.
  vec2 fp = f - 0.5;
  float rim = (1.0 - smoothstep(0.04, 0.16, seam)) * (1.0 - crack);
  float lit = dot(normalize(fp + vec2(1e-4)), vec2(${SOCKET_LIGHT.join(', ')}));
  // The slot: long along the broad face, its walls falling to the water.
  float sd = length(p * vec2(0.5, 1.7)) + 0.05 * n(p * 9.0);
  float slot = 1.0 - smoothstep(0.1, 0.2, sd);
  float wall = smoothstep(0.08, 0.17, sd) * (1.0 - smoothstep(0.17, 0.25, sd));
  // The rime lip: the wall's near side catches the light, the far side is in shade.
  float lipLit = wall * smoothstep(-0.2, 0.6, dot(normalize(p + vec2(1e-4)), vec2(${SOCKET_LIGHT.join(', ')})));
  // The lake ice heaved up, barely paler than the lake round it.
  vec3 ice = mix(uDark * 1.9, uLight * 0.5, 0.25 + 0.3 * plate);
  vec3 col = ice * (1.0 + 0.35 * rim * lit);
  col = mix(col, uDark * 0.85, crack * 0.7);
  col = mix(col, uDark * 0.55, wall * 0.8);
  col = mix(col, uLight * 0.9, lipLit * 0.55);
  col = mix(col, uDark * 0.28, slot);
  // No edge: the plates melt into the lake long before the rag.
  float fade = 1.0 - smoothstep(rag * 0.45, rag, r);
  float alpha = fade * (0.22 + 0.14 * plate + 0.3 * rim * abs(lit) + 0.3 * crack) + slot * 0.75 + wall * 0.5;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95) * uAlpha);
  #include <colorspace_fragment>
}
`;
