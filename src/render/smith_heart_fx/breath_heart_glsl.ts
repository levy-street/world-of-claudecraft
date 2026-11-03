// The Knotted Gale's own shaders (breath_heart_fx.ts): the portal's swirling floor,
// its funnel of wind, the link of light, a letter that always faces the camera, the
// fuse's ring and the burst's wall. Everything goes through three's modelViewMatrix on
// a positioned mesh, safe in the instance bands (tests/camera_relative_floor_shaders).
// The ball itself is the Storm Orb's (final_kit_glsl.ts ORB_FRAG, ORB_CORE_FRAG).

/** A plain uv and height pass. */
export const HEART_UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** A portal's mouth on the floor: arms of wind wound into the centre. uArms and
 *  uSpin tell the pairs apart by pattern as well as colour (the first pair four
 *  arms turning one way; the second three, turning the other, inside a doubled
 *  rim: uRing2 is 1 for it). */
export const PORTAL_DISC_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpen;
uniform vec3 uColor;
uniform float uArms;
uniform float uSpin;
uniform float uRing2;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float arms = 0.5 + 0.5 * sin(a * uArms + uSpin * (r * 11.0 - uTime * 5.0));
  arms = pow(arms, 2.0);
  float rim = smoothstep(0.82, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r));
  rim += uRing2 * smoothstep(0.62, 0.68, r) * (1.0 - smoothstep(0.7, 0.76, r));
  float eye = 1.0 - smoothstep(0.0, 0.3, r);
  vec3 col = uColor * (0.25 + 1.1 * arms * (1.0 - r * 0.5)) + uColor * rim * 1.7 + vec3(1.0) * eye * 0.3;
  gl_FragColor = vec4(col, (0.55 * arms + rim + eye * 0.3 + 0.18) * uOpen);
}
`;

/** A portal's funnel of wind: bands climbing and turning, fading to the top
 *  (uSpin -1 turns the second pair's the other way). */
export const PORTAL_FUNNEL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpen;
uniform vec3 uColor;
uniform float uSpin;
varying vec2 vUv;
void main() {
  float bands = 0.5 + 0.5 * sin(uSpin * vUv.x * 37.7 + vUv.y * 9.0 - uTime * 7.0);
  bands = pow(bands, 3.0);
  float fade = pow(1.0 - vUv.y, 1.4) * smoothstep(0.0, 0.06, vUv.y);
  gl_FragColor = vec4(uColor * (0.5 + 1.3 * bands), (0.15 + 0.75 * bands) * fade * uOpen);
}
`;

/** The link of light within a pair: the first portal's colour to its partner's,
 *  a pulse running along it (u is the length, 0 at A or C). uBraid 0 is the first
 *  pair's one soft beam; 1 is the second pair's two thin strands twisting round
 *  each other, so the links read apart where they cross. */
export const PORTAL_LINK_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform float uBraid;
uniform float uLen;
varying vec2 vUv;
void main() {
  float y = vUv.y * 2.0 - 1.0;
  float beam = pow(1.0 - abs(y), 2.2);
  // A twist about every three yards, whatever the link's length.
  float w = 0.55 * sin(vUv.x * uLen * 2.1 - uTime * 4.0);
  float s1 = 1.0 - smoothstep(0.0, 0.2, abs(y - w));
  float s2 = 1.0 - smoothstep(0.0, 0.2, abs(y + w));
  float across = mix(beam, max(s1, s2), uBraid);
  float pulse = pow(0.5 + 0.5 * sin(vUv.x * 18.0 - uTime * 7.0), 4.0);
  vec3 col = mix(uA, uB, vUv.x) * (0.7 + 1.6 * pulse);
  gl_FragColor = vec4(col, across * (0.35 + 0.65 * pulse));
}
`;

/** A flat shape that always faces the camera (the letter over a marked player). */
export const FACING_VERT = /* glsl */ `
void main() {
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  gl_Position = projectionMatrix * mv;
}
`;

export const FACING_FRAG = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor * 1.4, 1.0);
}
`;

/** A soft-edged band on a unit ring (the fuse's ring, the marks, the load's). */
export const HEART_RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uFill;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float band = smoothstep(0.86, 0.93, r) * (1.0 - smoothstep(0.96, 1.0, r));
  // A filling disc inside it (a mark's coming portal).
  float inner = 1.0 - smoothstep(uFill - 0.05, uFill, r);
  gl_FragColor = vec4(uColor * (1.2 * band + 0.5 * inner), (band + 0.35 * inner) * uAlpha);
}
`;

/** The burst's wall of storm: a torn shell, brightest at its edge. */
export const BURST_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float bands = 0.5 + 0.5 * sin(vUv.x * 62.8 + vUv.y * 14.0 - uTime * 24.0);
  float fade = pow(1.0 - vUv.y, 1.2);
  gl_FragColor = vec4(uColor * (0.8 + 1.2 * bands), (0.35 + 0.65 * bands) * fade * uAlpha);
}
`;
