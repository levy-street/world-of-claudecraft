// The Hammer's, the Breath's and the Quench's light-rivers (heart_rivers.ts)
// drawn as veins of their own light cut into the floor, the way the Heat's is
// the Hearth's seam of fire (heat_route_seam.ts), instead of a flat pale band
// (the taste pass, design doc section 5.27).
//
// What each carries: the route. Every vein's dim ribbon leads from the seal to
// its guardian (drawn on every tier). Each keeps exactly that line, its width
// and its rung (the ground band, under every telegraph), and stays as
// readable: a groove cut the ribbon's width into the stone with a thread of
// the vein's own colour wandering down its middle (never a threat colour), its
// glow breathing in pulses that run TOWARD the guardian (the ribbon's arc 0 is
// its arena), so the line still says "this way". The thread dims between
// pulses, never out. Each element adds one touch of its own: the Hammer's ore
// glints in the groove's floor, the Breath's thread kinks and beads like
// static, the Quench's lips are rimed. The bright twin that runs once the
// guardian falls draws over it.
//
// One program, one shared material per vein (one draw per slot, the ribbon's
// own mesh), built at the interior's build with the ribbons (the interior's
// compile gate links it), on the shared clock; noise on the ribbon's own arc
// and across (never world coordinates), the vertex through `modelViewMatrix`.
// No `pow()`: every square is written out.

import * as THREE from 'three';
import { SMITH_HEART_VEIN_COLORS, type SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { sharedUniforms } from '../gfx';
import { markSharedMaterial } from '../shared_resource';

/** The veins whose dim ribbon is a vein of light (the Heat's is its seam). */
export type RiverVein = Exclude<SmithHeartVein, 'heat'>;
export const RIVER_VEINS: readonly RiverVein[] = ['hammer', 'breath', 'quench'];

export interface RiverVeinLook {
  /** The cut stone under the light (linear rgb): dark, in the vein's own cast. */
  readonly groove: readonly [number, number, number];
  /** The thread's half width (a share of the ribbon's half width). */
  readonly thread: number;
  /** How far the thread wanders off the middle (the same share). */
  readonly wander: number;
  /** Its pulses' wavelength (yards along the ribbon). */
  readonly wavelength: number;
  /** Their speed (yards a second, toward the guardian). */
  readonly speed: number;
  /** The element's own touch, each 0 or 1: ore glinting in the groove, the
   *  thread kinking and beading like static, rime on the lips. */
  readonly fleck: number;
  readonly crackle: number;
  readonly rime: number;
}

/** How dim the thread falls between two pulses (a share of its crest): the
 *  route never goes out. */
export const RIVER_VEIN_FLOOR = 0.5;

export const RIVER_VEIN_LOOKS: Readonly<Record<RiverVein, RiverVeinLook>> = {
  // A seam of ore in the quarry's stone: broad, slow, glinting.
  hammer: {
    groove: [0.075, 0.054, 0.034],
    thread: 0.15,
    wander: 0.5,
    wavelength: 16,
    speed: 2.6,
    fleck: 1,
    crackle: 0,
    rime: 0,
  },
  // The storm's static running in a crack: thin, quick, restless.
  breath: {
    groove: [0.04, 0.05, 0.066],
    thread: 0.13,
    wander: 0.42,
    wavelength: 11,
    speed: 5.2,
    fleck: 0,
    crackle: 1,
    rime: 0,
  },
  // Light under the ice: a clean cold line between rimed lips.
  quench: {
    groove: [0.034, 0.054, 0.076],
    thread: 0.17,
    wander: 0.45,
    wavelength: 13,
    speed: 3,
    fleck: 0,
    crackle: 0,
    rime: 1,
  },
};

/** A pulse's brightness at `arc` yards along a vein's ribbon at time `t`
 *  (RIVER_VEIN_FLOOR..1, mirrors the shader): its crests travel toward arc 0. */
export function riverVeinPulse(vein: RiverVein, arc: number, t: number): number {
  const L = RIVER_VEIN_LOOKS[vein];
  const k = (Math.PI * 2) / L.wavelength;
  const b = 0.5 + 0.5 * Math.sin(k * (arc + L.speed * t));
  return RIVER_VEIN_FLOOR + (1 - RIVER_VEIN_FLOOR) * b * b;
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
uniform vec3 uColor;
uniform vec3 uGroove;
// x the thread's half width, y its wander, z the pulses' wavenumber, w their speed.
uniform vec4 uLook;
// x ore flecks, y static, z rime.
uniform vec3 uKind;
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
  // The groove: cut the ribbon's width into the floor, its lips ragged.
  float rag = (vns(vec2(vArc * 0.7, 3.1)) - 0.5) * 0.2 + (vns(vec2(vArc * 2.3, 7.7)) - 0.5) * 0.1;
  float groove = 1.0 - smoothstep(0.7 + rag, 0.98, a);
  // The thread of light, wandering inside it (never ruler-straight); the
  // Breath's kinks like static, a few times a second.
  float wob = (vns(vec2(vArc * 0.12, 1.3)) - 0.5) * 1.4 + (vns(vec2(vArc * 0.5, 9.1)) - 0.5) * 0.4;
  wob = wob * uLook.y + (vns(vec2(vArc * 3.1, floor(uTime * 9.0) * 1.7)) - 0.5) * 0.26 * uKind.y;
  float t = abs(vAcross - wob);
  float thread = 1.0 - smoothstep(uLook.x * 0.4, uLook.x, t);
  float halo = 1.0 - smoothstep(0.05, 0.55, t);
  // The pulses running toward the guardian (riverVeinPulse).
  float beat = 0.5 + 0.5 * sin(uLook.z * (vArc + uLook.w * uTime));
  float pulse = ${f3(RIVER_VEIN_FLOOR)} + ${f3(1 - RIVER_VEIN_FLOOR)} * beat * beat;
  float flick = 0.86 + 0.14 * vns(vec2(vArc * 1.7 + uTime * uLook.w * 1.7, 0.5));
  // The Breath's beads: the static leaping along the thread.
  float bead = smoothstep(0.58, 0.9, vns(vec2(vArc * 1.3 + uTime * 6.0, 2.0))) * uKind.y;
  // The Hammer's ore: small round flecks in the groove's floor, each glinting in
  // its own time (a round grain in its cell, never the cell itself: a lit cell
  // read as a dash).
  vec2 fp = vec2(vArc * 5.0, vAcross * 3.2 + 8.0);
  float fn = hs(floor(fp));
  vec2 fo = fract(fp) - 0.5 - (vec2(hs(floor(fp) + 3.3), hs(floor(fp) + 7.1)) - 0.5) * 0.5;
  float grain = 1.0 - smoothstep(0.0, 0.2, length(fo * vec2(1.0, 1.6)));
  float glint = 0.5 + 0.5 * sin(uTime * (1.0 + fn * 3.0) + fn * 40.0);
  float fleck = step(0.86, fn) * grain * glint * glint * groove * uKind.x;
  // The Quench's rime: pale frost along both lips.
  float rime = smoothstep(0.52, 0.9, a) * (1.0 - smoothstep(0.93, 1.0, a));
  rime *= (0.55 + 0.45 * vns(vec2(vArc * 4.0, vAcross * 6.0))) * uKind.z;
  float light = thread * pulse * flick * (1.0 + bead);
  vec3 stone = uGroove * (0.75 + 0.5 * vns(vec2(vArc * 1.5, vAcross * 3.0 + 2.0)));
  vec3 core = mix(uColor, vec3(1.0), 0.55);
  vec3 col = stone + uColor * halo * halo * (0.08 + 0.24 * pulse);
  col += mix(uColor, core, thread * 0.5) * light * 0.9;
  col += mix(uColor, core, 0.4) * fleck * 0.7;
  col = mix(col, vec3(0.78, 0.9, 1.0), rime * 0.55);
  float alpha = clamp(max(groove * 0.78, max(halo * 0.65, max(thread, rime * 0.7))), 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

const shared = new Map<RiverVein, THREE.ShaderMaterial>();

/** A vein's shared ribbon material (built with the interior; never disposed by
 *  a slot's teardown). All three run one program. */
export function riverVeinMaterial(vein: RiverVein): THREE.ShaderMaterial {
  const have = shared.get(vein);
  if (have) return have;
  const L = RIVER_VEIN_LOOKS[vein];
  const m = new THREE.ShaderMaterial({
    name: `smithHeartRiver:${vein}:dim`,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uColor: { value: new THREE.Color(SMITH_HEART_VEIN_COLORS[vein]) },
      uGroove: { value: new THREE.Vector3(...L.groove) },
      uLook: {
        value: new THREE.Vector4(L.thread, L.wander, (Math.PI * 2) / L.wavelength, L.speed),
      },
      uKind: { value: new THREE.Vector3(L.fleck, L.crackle, L.rime) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  markSharedMaterial(m);
  shared.set(vein, m);
  return m;
}
