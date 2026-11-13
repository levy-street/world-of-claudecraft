// The Heat vein's light-river (heart_rivers.ts) drawn as the Hearth's own
// mark: a seam of fire burned into the stone instead of a flat pale band.
//
// What it carries: the route. Every vein's dim ribbon leads from the seal to
// its guardian (drawn on every tier), and the Heat's runs the length of the
// Hearth's floor to the wellspring. It keeps exactly that line, its width and
// its rung (the ground band, under every telegraph), and stays as readable:
// a groove of scorched basalt the ribbon's width with a molten thread down
// its middle (the vein's white-gold, never a threat colour), its glow
// breathing in pulses that run TOWARD the guardian (the ribbon's arc 0 is
// its arena), so the line still says "this way". Crust bridges dim the
// thread here and there, never out. The bright twin that runs once the
// guardian falls draws over it unchanged.
//
// One shared material (one draw per slot, the ribbon's own mesh), built at
// the interior's build with the dim ribbons (the interior's compile gate
// links it), on the shared clock; noise on the ribbon's own arc and across
// (never world coordinates), the vertex through `modelViewMatrix`.

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import { markSharedMaterial } from '../shared_resource';

/** The seam's look: its pulses' wavelength (yards along the ribbon) and
 *  speed (yards a second, toward the guardian), the thread's half width (a
 *  share of the ribbon's), how far a crust bridge dims it at most. */
export const HEAT_ROUTE_SEAM = {
  wavelength: 14,
  speed: 3.6,
  thread: 0.2,
  bridgeDim: 0.55,
} as const;

/** A pulse's brightness at `arc` yards along the ribbon at time `t`
 *  (0..1, mirrors the shader): its crests travel toward arc 0. */
export function heatSeamPulse(arc: number, t: number): number {
  const k = (Math.PI * 2) / HEAT_ROUTE_SEAM.wavelength;
  const b = 0.5 + 0.5 * Math.sin(k * (arc + HEAT_ROUTE_SEAM.speed * t));
  return b * b;
}

const f3 = (v: number) => v.toFixed(3);

const VERT = /* glsl */ `
attribute float aArc;
attribute float aSide;
varying float vArc;
varying float vAcross;
void main() {
  vArc = aArc;
  vAcross = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying float vArc;
varying float vAcross;
float hs(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vns(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hs(i), hs(i + vec2(1.0, 0.0)), f.x), mix(hs(i + vec2(0.0, 1.0)), hs(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float a = abs(vAcross);
  // The groove: scorched basalt the ribbon's width, its lips ragged, its
  // floor mottled.
  float rag = (vns(vec2(vArc * 0.7, 3.1)) - 0.5) * 0.22 + (vns(vec2(vArc * 2.3, 7.7)) - 0.5) * 0.1;
  float groove = 1.0 - smoothstep(0.72 + rag, 0.99, a);
  // The molten thread, wandering inside it (never ruler-straight).
  float wob = (vns(vec2(vArc * 0.12, 1.3)) - 0.5) * 0.7 + (vns(vec2(vArc * 0.5, 9.1)) - 0.5) * 0.2;
  float t = abs(vAcross - wob);
  float thread = 1.0 - smoothstep(${f3(HEAT_ROUTE_SEAM.thread * 0.4)}, ${f3(HEAT_ROUTE_SEAM.thread)}, t);
  float halo = 1.0 - smoothstep(0.05, 0.5, t);
  // Crust bridges over the thread now and then (dimmed, never out).
  float bridge = smoothstep(0.62, 0.82, vns(vec2(vArc * 0.8, 5.0))) * ${f3(HEAT_ROUTE_SEAM.bridgeDim)};
  // The pulses running toward the guardian (heatSeamPulse).
  float pk = ${f3((Math.PI * 2) / HEAT_ROUTE_SEAM.wavelength)};
  float pulse = 0.5 + 0.5 * sin(pk * (vArc + ${f3(HEAT_ROUTE_SEAM.speed)} * uTime));
  pulse *= pulse;
  float flick = 0.85 + 0.15 * vns(vec2(vArc * 1.7 + uTime * ${f3(HEAT_ROUTE_SEAM.speed * 1.7)}, 0.5));
  float heat = thread * (1.0 - bridge) * (0.65 + 0.55 * pulse) * flick;
  vec3 scorch = vec3(0.05, 0.042, 0.036);
  vec3 ember = vec3(0.86, 0.52, 0.16);
  vec3 core = vec3(1.0, 0.82, 0.48);
  scorch *= 0.75 + 0.5 * vns(vec2(vArc * 1.5, vAcross * 3.0 + 2.0));
  vec3 col = scorch + ember * halo * halo * (0.25 + 0.25 * pulse) * (1.0 - 0.5 * bridge);
  col += mix(ember, core, thread * 0.6) * heat * 1.15;
  float alpha = clamp(max(groove * 0.8, max(halo * 0.7, thread)), 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

let shared: THREE.ShaderMaterial | null = null;

/** The seam's shared material (built with the interior; never disposed by a
 *  slot's teardown). */
export function heatRouteSeamMaterial(): THREE.ShaderMaterial {
  if (shared) return shared;
  shared = new THREE.ShaderMaterial({
    name: 'smithHeartRiver:heat:seam',
    uniforms: { uTime: sharedUniforms.uTime },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  markSharedMaterial(shared);
  return shared;
}
