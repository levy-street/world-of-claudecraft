// The Islands of the Wind's shaders (breath_isles_fx.ts): the Gale Path's and
// the Homeward Gale's wind discs and columns, the flowing ribbons (the
// routes, the riders' wraps, the Mender's stream), the isles' wind runes and
// the Gale Bulwark's shell. Additive (rgb is the colour, alpha the
// strength: THREE's additive blend multiplies them), no lights, no textures.

/** Shared: a hash and a value noise. */
const NOISE = /* glsl */ `
float ih(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float inoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ih(i), ih(i + vec2(1, 0)), f.x), mix(ih(i + vec2(0, 1)), ih(i + vec2(1, 1)), f.x), f.y);
}
`;

export const ISLE_UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** A wind disc on the floor: arms of wind wheeling in toward its middle, a
 *  bright rim, a core that breathes. vUv in 0..1 over the disc's square. */
export const ISLE_DISC_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uGlow;
uniform float uOpen;
uniform float uSpin;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  // Five arms spiralling in, turning.
  float arms = sin(a * 5.0 + r * 9.0 - uTime * uSpin * 2.4);
  float swirl = smoothstep(0.2, 1.0, arms) * (0.35 + 0.65 * inoise(vec2(a * 3.0, r * 6.0 - uTime * 1.5)));
  float rim = smoothstep(0.86, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float core = (1.0 - smoothstep(0.0, 0.32, r)) * (0.6 + 0.4 * sin(uTime * 3.0));
  float k = (swirl * (1.0 - r * 0.5) * 0.85 + rim * 1.4 + core * 0.9) * uOpen * uGlow;
  vec3 col = mix(uColor, uCore, clamp(core + rim * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col * (1.0 + 0.6 * k), clamp(k, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** A column of wind over a disc (an open cylinder): streaks spiralling up,
 *  fading out at its top. vUv.x around, vUv.y up. */
export const ISLE_COLUMN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uGlow;
uniform float uOpen;
varying vec2 vUv;
${NOISE}
void main() {
  float x = vUv.x * 6.0 + vUv.y * 2.2 - uTime * 0.9;
  float streak = smoothstep(0.55, 1.0, inoise(vec2(x * 3.0, vUv.y * 4.0 - uTime * 2.6)));
  float band = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
  float k = streak * band * uGlow * uOpen * 0.9;
  gl_FragColor = vec4(uColor * (1.0 + 0.6 * k), clamp(k, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** A ribbon of flowing wind (a route, a rider's wrap, a stream): dashes
 *  rushing along vUv.x (0 at its start), soft across vUv.y. */
export const ISLE_RIBBON_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uGlow;
uniform float uFlow;
uniform float uDash;
uniform float uFade;
varying vec2 vUv;
${NOISE}
void main() {
  float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
  float edge = smoothstep(0.0, 0.55, across);
  float s = vUv.x * uDash - uTime * uFlow;
  float dash = smoothstep(0.35, 0.95, fract(s)) * (1.0 - smoothstep(0.95, 1.0, fract(s)));
  float grain = 0.55 + 0.45 * inoise(vec2(vUv.x * 40.0 - uTime * uFlow * 6.0, vUv.y * 3.0));
  // Fade at both ends (the start and where it sets down).
  float ends = smoothstep(0.0, uFade, vUv.x) * (1.0 - smoothstep(1.0 - uFade, 1.0, vUv.x));
  float k = (0.35 * edge + dash * edge * 1.4) * grain * ends * uGlow;
  vec3 col = mix(uColor, uCore, dash * across);
  gl_FragColor = vec4(col * (1.0 + 0.6 * k), clamp(k, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** The isles' wind runes: an annulus of carved glyphs (procedural strokes
 *  in cells round it), breathing; awake (uWake) they burn bright and race.
 *  vUv.x round the ring (0..1), vUv.y across it. */
export const ISLE_RUNE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uWake;
varying vec2 vUv;
${NOISE}
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  float cells = 28.0;
  float cx = vUv.x * cells;
  float id = floor(cx);
  vec2 q = vec2(fract(cx), vUv.y);
  // Three strokes per glyph, picked by the cell's hash.
  float d = 1.0;
  for (int s = 0; s < 3; s++) {
    float fs = float(s);
    vec2 a = vec2(ih(vec2(id, fs)), ih(vec2(fs, id)));
    vec2 b = vec2(ih(vec2(id + 7.0, fs)), ih(vec2(fs + 3.0, id)));
    a = mix(vec2(0.2), vec2(0.8), a);
    b = mix(vec2(0.2), vec2(0.8), b);
    d = min(d, seg(q, a, b));
  }
  float line = 1.0 - smoothstep(0.03, 0.08, d);
  // Two thin borders.
  float border = (1.0 - smoothstep(0.0, 0.05, vUv.y)) + smoothstep(0.95, 1.0, vUv.y);
  float race = 0.5 + 0.5 * sin(vUv.x * 6.2832 * 2.0 - uTime * (0.6 + uWake * 3.0) + id * 0.4);
  float k = (line * (0.35 + 0.65 * race) + border * 0.5) * (0.35 + uWake * 0.9);
  gl_FragColor = vec4(uColor * (1.0 + 0.6 * k), clamp(k, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** The Gale Bulwark: a shell of turning wind round the guardian, its rim
 *  bright (fresnel), bands of wind wheeling over it, cracks opening as it
 *  thins. */
export const BULWARK_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
export const BULWARK_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uEdge;
uniform float uSolid;
uniform float uCrack;
uniform float uSpin;
uniform float uFlash;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
${NOISE}
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.2);
  vec3 p = normalize(vLocal);
  float lon = atan(p.z, p.x);
  float lat = p.y;
  float bands = inoise(vec2(lon * 3.0 + uTime * uSpin, lat * 7.0 - uTime * 0.4));
  float streak = smoothstep(0.58, 0.95, inoise(vec2(lon * 9.0 + uTime * uSpin * 2.2, lat * 18.0)));
  // Cracks: dark seams that open as the shield thins.
  float c = abs(inoise(vec2(lon * 6.0, lat * 6.0)) - 0.5);
  float crack = (1.0 - smoothstep(0.0, 0.02 + 0.05 * uCrack, c)) * uCrack;
  float k = (f * 0.9 + bands * 0.08 + streak * 0.42) * uSolid + uFlash * (0.5 + f);
  vec3 col = mix(uColor, uEdge, clamp(f + streak * 0.5 + uFlash, 0.0, 1.0));
  col += vec3(1.0, 0.95, 0.8) * crack * 1.6;
  float a = clamp(k + crack * 0.8, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/** The Bulwark's vertex shader: the uv and the world position (a camera
 *  inside the vortex thins it, so a melee body is never blinded by it). */
export const BULWARK_BAND_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/** A band of the Gale Bulwark's vortex (an open lathe round the guardian):
 *  wind streaks wheeling round it at its own speed and slant, grit carried
 *  in them, soft at its top and foot, its life (uLive) fading it out as the
 *  shell thins (a band peels away). vUv.x round, vUv.y up. */
export const BULWARK_BAND_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uEdge;
uniform float uLive;
uniform float uSpin;
uniform float uSlant;
uniform float uFlash;
uniform vec3 uCenter;
uniform float uRadius;
varying vec2 vUv;
varying vec3 vWorld;
${NOISE}
void main() {
  float x = vUv.x * 7.0 + vUv.y * uSlant - uTime * uSpin;
  float streak = smoothstep(0.5, 0.95, inoise(vec2(x * 2.4, vUv.y * 3.0 - uTime * 0.6)));
  float fine = smoothstep(0.7, 1.0, inoise(vec2(x * 9.0, vUv.y * 11.0)));
  float grit = step(0.93, ih(floor(vec2(x * 14.0, vUv.y * 9.0)))) * 0.8;
  // Thick ropes of wind (a few broad bands of streaks, gaps between them:
  // the shell reads as wind wheeling round, never a bubble).
  float rope = smoothstep(0.35, 0.75, sin(x * 3.14159 * 0.9) * 0.5 + 0.5);
  float body = 0.12 + 0.18 * inoise(vec2(x * 0.8, vUv.y * 2.0 + uTime * 0.3));
  float ends = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
  // A camera inside (or right at) the vortex sees it thinned to a veil.
  float inside = smoothstep(0.9, 1.8, length(cameraPosition - uCenter) / max(uRadius, 0.01));
  float k = ((body + rope * (0.5 + streak * 1.2) + fine * 0.4 + grit) * ends * uLive
          + uFlash * ends * 0.8) * mix(0.12, 1.0, inside);
  vec3 col = mix(uColor, uEdge, clamp(streak * 0.7 + fine * 0.4 + grit + uFlash, 0.0, 1.0));
  gl_FragColor = vec4(col * (1.0 + 0.4 * k), clamp(k, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** A Gale Mender's healing beam: a bright braided core and a soft sheath,
 *  pulses racing from the Mender (vUv.x 0) into the shell (1); cut (uCut 0
 *  to 1) it parts at its middle, both ends whipping back and fading. */
export const MEND_BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uGlow;
uniform float uCut;
uniform float uSheath;
varying vec2 vUv;
${NOISE}
void main() {
  float across = abs(vUv.y * 2.0 - 1.0);
  float braid = abs(sin(vUv.x * 46.0 - uTime * 14.0)) * 0.5 + 0.5;
  float core = 1.0 - smoothstep(0.0, mix(0.3, 0.55, braid), across);
  float sheath = (1.0 - smoothstep(0.2, 1.0, across)) * uSheath;
  float pulse = smoothstep(0.75, 1.0, fract(vUv.x * 5.0 - uTime * 2.6));
  float grain = 0.75 + 0.25 * inoise(vec2(vUv.x * 30.0 - uTime * 9.0, vUv.y * 4.0));
  float ends = smoothstep(0.0, 0.03, vUv.x) * (1.0 - smoothstep(0.97, 1.0, vUv.x));
  // The cut: a gap opening from the middle, its torn ends flickering.
  float gap = abs(vUv.x - 0.5) - uCut * 0.5;
  float torn = smoothstep(-0.01, 0.06, gap);
  float tear = (1.0 - smoothstep(0.0, 0.05, abs(gap))) * step(0.001, uCut) * (0.6 + 0.4 * sin(uTime * 40.0));
  float k = ((core * (1.2 + pulse * 1.6) + sheath * 0.45) * grain * ends * torn + tear * 1.5) * uGlow;
  vec3 col = mix(uColor, uCore, clamp(core * 0.8 + pulse * core, 0.0, 1.0));
  gl_FragColor = vec4(col * (1.0 + 0.5 * k), clamp(k, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** The Gale Path's launch: a funnel of wind spinning up out of the circle
 *  (an open cone, wide at its top), streaks twisting up it, flaring and
 *  thinning away. vUv.x round, vUv.y up. */
export const FUNNEL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uLife;
varying vec2 vUv;
${NOISE}
void main() {
  float x = vUv.x * 5.0 + vUv.y * 3.4 - uTime * 3.2;
  float streak = smoothstep(0.45, 0.95, inoise(vec2(x * 2.6, vUv.y * 5.0 - uTime * 4.0)));
  float ends = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  float k = (0.2 + streak * 1.3) * ends * uLife;
  vec3 col = mix(uColor, uCore, streak);
  gl_FragColor = vec4(col * (1.0 + 0.5 * k), clamp(k, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;
