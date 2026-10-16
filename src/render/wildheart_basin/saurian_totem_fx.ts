// The Great Saurian's totem rework and its heroic drum (plan:
// saurian_totem_fx_core.ts), composed by WildheartFx (basin_fx.ts) under its
// gated root:
//  - the rider's throw: the hex gathering red in the Hexcaller's hands up in
//    the howdah, then a carved bundle arcing out over the ford trailing sap
//    sparks, landing in a splash as the Sunbone Sap Totem tears up out of the
//    water (its own Rise clip, offered here);
//  - a standing totem: a toothed war-red ring round its foot (its arming
//    sweep filling over the 4 s bar), a sap beacon climbing 16 yd over its
//    crown and a turning hex sigil in it, seen from across the ford and over
//    the beast's back, and the tether: a thick braided rope of sap from its
//    crown to the beast's withers, reaching out through the arming bar, then
//    flowing, with a hot knot running down it on every mending (the totem's
//    own Pulse clip, a flare at its crown and a green-gold bloom on the
//    beast);
//  - the break: the tether snapping back into the beast white-hot, a flash,
//    a burst of carved red wood, bone and heartwood splinters, red sparks, a
//    shock on the water;
//  - heroic: the second rider's drum on the howdah's aft deck, a drummer a
//    head taller than a player beating it with two sticks; every beat flashes
//    the skin, throws a ring of force out round the howdah and a pulse over
//    the ford at the Stomp's reach. Silenced, the sticks hang, the skin is
//    dark and it smokes.
//
// Cosmetic only (src/render/CLAUDE.md): it decides nothing. Every read a
// player acts on (the ring, the beacon, the sigil, the tether, the drum, its
// sticks and its pulse) is a mesh built once whose state is a uniform or a
// transform: every tier draws it; the splinters and the sparks thin with the
// density. Built once under the host's root before its gated attach; nothing
// is minted after; no light.

import * as THREE from 'three';
import {
  SAP_TOTEM_ID,
  SAURIAN_DRUM_BEAT,
  SAURIAN_DRUM_SILENCED,
  SAURIAN_SAP_BACKLASH,
  SAURIAN_SAP_TETHER,
  SAURIAN_TOTEM_THROW,
  SAURIAN_TUNING,
  SAURIAN_WAR_DRUM,
} from '../../sim/encounters/wildheart_basin/ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { surfaceMat } from '../gfx';
import type { BasinFxHost } from './basin_fx_host';
import { TOTEM_RISE_GESTURE } from './basin_trash_fx_core';
import { CROWN_LOOKS, RIPPLE_LOOKS, wetFloor } from './saurian_fx_core';
import {
  DRUM_LOOK,
  drumBeat,
  drumSeat,
  drumSticks,
  riderEmber,
  riderFlare,
  riderHands,
  SAP_BEACON_HEIGHT,
  SAP_BREAK_SECONDS,
  SAP_COLORS,
  SAP_POOLS,
  SAP_PULSE_SECONDS,
  SAP_RING_RADIUS,
  SAP_SNAP_SECONDS,
  SAP_TOTEM_CROWN,
  sapAnchor,
  sapBreakFlash,
  sapMendFlare,
  sapPulse,
  sapSag,
  sapShardCount,
  sapTether,
  sapTotemArming,
  sapTotemHeight,
  TOTEM_RISE_OFFER,
  TOTEM_THROW_SECONDS,
  totemThrow,
} from './saurian_totem_fx_core';

// ---- shaders ---------------------------------------------------------------------------

const TETHER_VERT = /* glsl */ `
uniform vec3 uFrom;
uniform vec3 uTo;
uniform float uSag;
uniform float uTime;
uniform float uStrength;
uniform float uPulse;
varying float vU;
varying float vSid;
varying float vRim;
varying float vKnot;
void main() {
  float u = position.x;
  float ang = position.y;
  float sid = position.z;
  vec3 p = mix(uFrom, uTo, u);
  p.y -= uSag * 4.0 * u * (1.0 - u);
  vec3 dir = normalize(uTo - uFrom + vec3(0.0, 1e-4, 0.0));
  vec3 side = normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 up = normalize(cross(side, dir));
  // A living rope: it writhes a little along its length.
  float writhe = sin(u * 9.0 - uTime * 3.3) * 0.16 * sin(3.14159265 * u);
  p += up * writhe;
  float knot = 0.0;
  if (uPulse >= 0.0) {
    float d = (u - uPulse) / 0.07;
    knot = exp(-d * d);
  }
  float swell = 0.65 + 0.35 * uStrength;
  vec3 c = p;
  float r;
  if (sid < 0.5) {
    r = 0.26 * swell * (1.0 + 1.6 * knot);
  } else if (sid < 1.5) {
    r = 0.95 * swell * (1.0 + 0.9 * knot);
  } else {
    float ph = (sid - 2.0) * 3.14159265 + u * 34.0 - uTime * 2.4;
    c += (side * cos(ph) + up * sin(ph)) * 0.46 * swell;
    r = 0.11 * swell;
  }
  vec3 n = side * cos(ang) + up * sin(ang);
  vU = u;
  vSid = sid;
  vKnot = knot;
  vec4 view = modelViewMatrix * vec4(c + n * r, 1.0);
  vRim = abs(normalize(mat3(modelViewMatrix) * n).z);
  gl_Position = projectionMatrix * view;
}
`;

const TETHER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform float uCharge;
uniform float uSnap;
uniform float uAlpha;
varying float vU;
varying float vSid;
varying float vRim;
varying float vKnot;
void main() {
  // It reaches from the totem (u 0) toward the beast as it arms.
  if (vU > uCharge) discard;
  // A snapped tether is gone behind its white-hot front.
  float snapHot = 0.0;
  if (uSnap >= 0.0) {
    if (vU < uSnap) discard;
    float d = (vU - uSnap) / 0.05;
    snapHot = exp(-d * d);
  }
  float tipD = (uCharge - vU) / 0.035;
  float tip = uCharge < 0.999 ? exp(-tipD * tipD) : 0.0;
  float flow = fract(vU * 7.0 - uTime * 1.7);
  float band = smoothstep(0.0, 0.2, flow) * (1.0 - smoothstep(0.3, 0.62, flow));
  float ends = smoothstep(0.0, 0.03, vU) * smoothstep(1.0, 0.97, vU);
  vec3 sap = vec3(0.78, 0.95, 0.35);
  vec3 hot = vec3(1.0, 0.94, 0.63);
  vec3 war = vec3(0.86, 0.24, 0.16);
  vec3 col;
  float a;
  if (vSid < 0.5) {
    col = mix(sap, hot, 0.35 + 0.5 * band + vKnot);
    a = (0.75 + 0.5 * band) * (0.45 + 0.55 * vRim);
  } else if (vSid < 1.5) {
    col = sap;
    a = 0.22 * vRim * vRim * (0.6 + 0.4 * band + 1.2 * vKnot);
  } else {
    col = mix(war, hot, 0.25 * band);
    a = 0.8 * (0.5 + 0.5 * vRim);
  }
  col = mix(col, vec3(1.0, 0.86, 0.78), clamp(snapHot + tip, 0.0, 1.0));
  a = (a + 1.4 * snapHot + 1.2 * tip) * ends * uAlpha * (0.55 + 0.45 * uStrength);
  gl_FragColor = vec4(col * a, 1.0);
}
`;

const FLOOR_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The ring at a totem's foot: an outer band of war-red teeth turning, an
 *  inner band of sap that fills round with the arming bar (and pulses on
 *  each mending once it feeds). */
const RING_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFill;
uniform float uArming;
uniform float uFlash;
uniform float uAlpha;
uniform float uInner;
uniform float uOuter;
varying vec2 vP;
void main() {
  float r = length(vP);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  float ang = atan(vP.x, vP.y) / 6.2831853 + 0.5;
  // Teeth: a saw of 14 fangs pointing in, turning slowly.
  float saw = fract(ang * 14.0 + uTime * 0.12);
  float tooth = 1.0 - abs(saw - 0.5) * 2.0;
  float teeth = step(t, 0.42 + 0.5 * tooth) * step(0.55, t);
  float rim = smoothstep(0.93, 0.98, t) * (1.0 - smoothstep(0.98, 1.0, t));
  float inner = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.32, 0.4, t));
  float filled = uArming > 0.5 ? step(ang, uFill) : 1.0;
  vec3 war = vec3(0.9, 0.2, 0.12);
  vec3 sap = vec3(0.78, 0.95, 0.35);
  vec3 hot = vec3(1.0, 0.94, 0.63);
  vec3 col = war * (teeth * 0.95 + rim * 1.2);
  col += mix(sap * 0.25, mix(sap, hot, uFlash), filled) * inner * (0.7 + 0.8 * uFlash);
  float a = uAlpha * clamp(teeth * 0.9 + rim + inner * (0.4 + 0.6 * filled), 0.0, 1.0);
  gl_FragColor = vec4(col * a, 1.0);
}
`;

const BEACON_VERT = /* glsl */ `
varying vec2 vUv;
varying float vRim;
void main() {
  vUv = uv;
  vRim = abs(normalize(mat3(modelViewMatrix) * normal).z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BEACON_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
varying float vRim;
void main() {
  float fade = (1.0 - vUv.y);
  fade *= fade;
  float bands = fract(vUv.y * 5.0 - uTime * 0.9);
  float b = smoothstep(0.0, 0.25, bands) * (1.0 - smoothstep(0.35, 0.7, bands));
  float a = uAlpha * fade * (0.35 + 0.65 * vRim * vRim) * (0.55 + 0.45 * b);
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

/** A camera-facing card laid out in the vertex shader. */
const CARD_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;

/** The hex sigil over a totem: a broken outer ring, three claw strokes
 *  raking down to a burning eye. A shape, never only a colour. */
const SIGIL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float ca = cos(uTime * 0.5);
  float sa = sin(uTime * 0.5);
  vec2 q = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
  float r = length(p);
  float ang = atan(q.y, q.x);
  float ring = smoothstep(0.08, 0.0, abs(r - 0.82)) * step(0.25, fract(ang / 6.2831853 * 6.0));
  float claws = 0.0;
  for (int i = 0; i < 3; i++) {
    float x0 = (float(i) - 1.0) * 0.26;
    float y = p.y;
    float x = p.x - x0 - y * 0.18 * (float(i) - 1.0);
    float len = step(-0.5, y) * step(y, 0.55);
    claws += smoothstep(0.07, 0.0, abs(x)) * len * (0.6 + 0.4 * (0.55 - y));
  }
  float eye = smoothstep(0.2, 0.0, length(p - vec2(0.0, -0.62)));
  float halo = smoothstep(1.0, 0.0, r) * 0.25;
  vec3 war = vec3(1.0, 0.3, 0.16);
  vec3 sap = vec3(0.86, 1.0, 0.45);
  vec3 col = war * (ring + claws) + sap * (eye * 1.6 + halo);
  float a = uAlpha * clamp(ring + claws + eye + halo, 0.0, 1.0);
  gl_FragColor = vec4(col * a, 1.0);
}
`;

/** A soft glow card (flares, the rider's hex, a bloom on the beast). */
const GLOW_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float core = smoothstep(0.35, 0.0, r);
  float body = smoothstep(1.0, 0.0, r);
  float a = uAlpha * (body * body * 0.7 + core);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.6) * a, 1.0);
}
`;

/** The drum's ring of force: a band of air thrown out round the howdah,
 *  brightest at its foot, torn into strokes. */
const BAND_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
varying float vRim;
void main() {
  float fade = 1.0 - vUv.y;
  float strokes = 0.6 + 0.4 * step(0.35, fract(vUv.x * 24.0 + vUv.y * 2.0));
  float a = uAlpha * fade * fade * strokes * (0.4 + 0.6 * vRim);
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

// ---- geometry -----------------------------------------------------------------------

/** The tether's tube in parameter space: (u along, angle, strand id); laid
 *  out on its ends in the vertex shader. Core 0, halo 1, two strands 2, 3. */
function tetherGeometry(): THREE.BufferGeometry {
  const segs = 56;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let sid = 0; sid < 4; sid++) {
    const radial = sid === 1 ? 10 : 6;
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++)
      for (let j = 0; j <= radial; j++) pos.push(i / segs, (j / radial) * Math.PI * 2, sid);
    for (let i = 0; i < segs; i++)
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j;
        const b = a + radial + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // Laid out in the shader: the box is anything, never culled.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

interface Part {
  geo: THREE.BufferGeometry;
  rgb: number;
}

/** Merge coloured parts into one vertex-coloured geometry. */
function mergeColoured(parts: Part[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const c = new THREE.Color();
  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    g.computeVertexNormals();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    c.setHex(part.rgb);
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      colors.push(c.r, c.g, c.b);
    }
    if (g !== part.geo) g.dispose();
    part.geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.computeBoundingSphere();
  return out;
}

const WAR_RED = 0x8f2a22;
const DARK_WOOD = 0x3b2414;
const BONE = 0xe6dcc0;
const HIDE = 0xc9a676;
const GOLD = 0xd8a640;
const SKIN = 0x5a3a2a;

/** The thrown bundle: a short carved post lashed round a jaguar skull. */
function bundleGeometry(): THREE.BufferGeometry {
  return mergeColoured([
    { geo: new THREE.BoxGeometry(0.5, 1.8, 0.5), rgb: WAR_RED },
    { geo: new THREE.SphereGeometry(0.42, 10, 8).translate(0, 1.05, 0), rgb: BONE },
    {
      geo: new THREE.ConeGeometry(0.3, 0.6, 6).translate(0, -1.2, 0).rotateX(Math.PI),
      rgb: DARK_WOOD,
    },
    { geo: new THREE.TorusGeometry(0.34, 0.07, 6, 12).rotateX(Math.PI / 2), rgb: GOLD },
  ]);
}

/** The drum: a tall barrel of dark wood in war-red bands, bone rims, its
 *  lacing down the sides, on the platform it shares with its drummer. The
 *  skin is its own mesh. */
function drumGeometry(): THREE.BufferGeometry {
  const r = DRUM_LOOK.radius;
  const h = DRUM_LOOK.height;
  const back = r + 0.55;
  const p = DRUM_LOOK.platform;
  const parts: Part[] = [
    // The platform lashed to the howdah's roof, under drum and drummer.
    {
      geo: new THREE.CylinderGeometry(p, p * 0.92, 0.34, 22).translate(0, -0.17, -back / 2),
      rgb: DARK_WOOD,
    },
    {
      geo: new THREE.TorusGeometry(p, 0.1, 6, 28).rotateX(Math.PI / 2).translate(0, 0.0, -back / 2),
      rgb: WAR_RED,
    },
    {
      geo: new THREE.CylinderGeometry(r, r * 0.86, h, 20, 1, true).translate(0, h / 2, 0),
      rgb: DARK_WOOD,
    },
    {
      geo: new THREE.TorusGeometry(r, 0.09, 6, 24).rotateX(Math.PI / 2).translate(0, h, 0),
      rgb: BONE,
    },
    {
      geo: new THREE.TorusGeometry(r * 0.87, 0.08, 6, 24)
        .rotateX(Math.PI / 2)
        .translate(0, 0.04, 0),
      rgb: BONE,
    },
    {
      geo: new THREE.CylinderGeometry(r * 1.01, r * 0.95, 0.24, 20, 1, true).translate(
        0,
        h * 0.62,
        0,
      ),
      rgb: WAR_RED,
    },
    {
      geo: new THREE.CylinderGeometry(r * 0.95, r * 0.9, 0.2, 20, 1, true).translate(
        0,
        h * 0.28,
        0,
      ),
      rgb: WAR_RED,
    },
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push({
      geo: new THREE.BoxGeometry(0.06, h, 0.06)
        .translate(0, h / 2, 0)
        .rotateZ(0.05)
        .translate(Math.cos(a) * r * 0.97, 0, Math.sin(a) * r * 0.97),
      rgb: HIDE,
    });
  }
  // Hanging bone charms.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push({
      geo: new THREE.ConeGeometry(0.1, 0.45, 5)
        .rotateX(Math.PI)
        .translate(Math.cos(a) * r * 1.02, h * 0.45, Math.sin(a) * r * 1.02),
      rgb: BONE,
    });
  }
  return mergeColoured(parts);
}

/** The drummer from the hips up, seated behind the drum (faces +z): a war-red
 *  cloak, a bone breastplate, a tusked bone mask, a fan of red and gold
 *  feathers. DRUM_LOOK.drummer tall from the deck. */
function drummerGeometry(): THREE.BufferGeometry {
  const H = DRUM_LOOK.drummer;
  return mergeColoured([
    {
      geo: new THREE.CylinderGeometry(0.55, 0.85, H * 0.48, 10).translate(0, H * 0.24, 0),
      rgb: WAR_RED,
    },
    {
      geo: new THREE.CylinderGeometry(0.62, 0.58, H * 0.2, 10).translate(0, H * 0.56, 0),
      rgb: SKIN,
    },
    { geo: new THREE.BoxGeometry(1.0, H * 0.18, 0.18).translate(0, H * 0.56, 0.52), rgb: BONE },
    { geo: new THREE.SphereGeometry(0.42, 12, 10).translate(0, H * 0.76, 0), rgb: SKIN },
    { geo: new THREE.BoxGeometry(0.62, 0.66, 0.2).translate(0, H * 0.76, 0.38), rgb: BONE },
    {
      geo: new THREE.ConeGeometry(0.08, 0.5, 5).rotateX(-0.9).translate(0.2, H * 0.68, 0.55),
      rgb: BONE,
    },
    {
      geo: new THREE.ConeGeometry(0.08, 0.5, 5).rotateX(-0.9).translate(-0.2, H * 0.68, 0.55),
      rgb: BONE,
    },
    ...[-2, -1, 0, 1, 2].map((i) => ({
      geo: new THREE.BoxGeometry(0.16, 1.05, 0.04)
        .translate(0, 0.52, 0)
        .rotateZ(i * 0.32)
        .translate(0, H * 0.84, -0.15),
      rgb: i % 2 === 0 ? WAR_RED : GOLD,
    })),
    {
      geo: new THREE.SphereGeometry(0.3, 8, 6).scale(1.4, 0.9, 1).translate(0.7, H * 0.62, 0),
      rgb: BONE,
    },
    {
      geo: new THREE.SphereGeometry(0.3, 8, 6).scale(1.4, 0.9, 1).translate(-0.7, H * 0.62, 0),
      rgb: BONE,
    },
  ]);
}

/** One arm with its stick, hanging from the shoulder (origin) along -y then
 *  forward: rotated about x by the stroke. */
function armGeometry(): THREE.BufferGeometry {
  return mergeColoured([
    { geo: new THREE.CylinderGeometry(0.17, 0.14, 1.1, 8).translate(0, -0.55, 0), rgb: SKIN },
    {
      geo: new THREE.CylinderGeometry(0.14, 0.12, 0.95, 8)
        .rotateX(Math.PI / 2)
        .translate(0, -1.1, 0.45),
      rgb: SKIN,
    },
    {
      geo: new THREE.CylinderGeometry(0.06, 0.05, 1.6, 6)
        .rotateX(Math.PI / 2 - 0.35)
        .translate(0, -1.0, 1.55),
      rgb: BONE,
    },
    { geo: new THREE.SphereGeometry(0.17, 8, 6).translate(0, -0.72, 2.3), rgb: WAR_RED },
  ]);
}

// ---- slots ------------------------------------------------------------------------------

interface Card {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

interface TotemSlot {
  id: number;
  seen: boolean;
  x: number;
  y: number;
  z: number;
  height: number;
  bornAt: number;
  /** When it was first seen dead (-1 while it stands). */
  deadAt: number;
  pulseAt: number;
  snapAt: number;
  riseUntil: number;
  tether: THREE.Mesh;
  tetherMat: THREE.ShaderMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  beacon: THREE.Mesh;
  beaconMat: THREE.ShaderMaterial;
  sigil: Card;
  crown: Card;
  bloom: Card;
}

interface ThrowSlot {
  live: boolean;
  at: number;
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  emit: number;
  mesh: THREE.Mesh;
  glow: Card;
}

interface SaurianTrack {
  id: number;
  seen: boolean;
  x: number;
  y: number;
  z: number;
  facing: number;
  scale: number;
  dead: boolean;
  engaged: boolean;
  drum: 'none' | 'beating' | 'silenced';
}

const SHARD_GRAVITY = 22;

export class SaurianTotemFx {
  private readonly totems: TotemSlot[] = [];
  private readonly throws: ThrowSlot[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly saurian: SaurianTrack = {
    id: -1,
    seen: false,
    x: 0,
    y: 0,
    z: 0,
    facing: 0,
    scale: 3.2,
    dead: true,
    engaged: false,
    drum: 'none',
  };
  private readonly rider: Card;
  private riderAt = -1e9;
  private riderLit = 0;
  // The drum.
  private readonly drum = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly skinMat: THREE.ShaderMaterial;
  private readonly band: THREE.Mesh;
  private readonly bandMat: THREE.ShaderMaterial;
  private beatAt = -1e9;
  private smokeAt = 0;
  // The splinters of a break: one instanced draw.
  private readonly shards: THREE.InstancedMesh;
  private readonly shardCount: number;
  private readonly sPos: Float32Array;
  private readonly sVel: Float32Array;
  private readonly sSpin: Float32Array;
  private readonly sAxis: Float32Array;
  private readonly sAge: Float32Array;
  private readonly sFloor: Float32Array;
  private shardNext = 0;
  private shardsLive = 0;
  private readonly tether = { charge: 0, strength: 0 };
  private readonly arc = { along: 0, lift: 0, spin: 0 };
  private readonly sticks = { right: 0, left: 0 };
  private readonly beat = { flash: 0, radius: 0, alpha: 0 };
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private clock = 0;

  constructor(
    private readonly host: BasinFxHost,
    private readonly world: IWorld,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
    /** Is this Saurian's howdah still on its back (saurian_fx.ts)? */
    private readonly howdahStanding: (id: number) => boolean = () => true,
  ) {
    const root = host.root;
    const tetherGeo = tetherGeometry();
    const ringGeo = new THREE.RingGeometry(
      SAP_RING_RADIUS * 0.55,
      SAP_RING_RADIUS * 1.45,
      72,
      1,
    ).rotateX(-Math.PI / 2);
    const beaconGeo = new THREE.CylinderGeometry(0.22, 0.85, 1, 20, 1, true).translate(0, 0.5, 0);
    const cardGeo = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(tetherGeo, ringGeo, beaconGeo, cardGeo);
    const card = (frag: string, size: number, color: number, order: number): Card => {
      const mat = new THREE.ShaderMaterial({
        name: 'wildheartSapCard',
        uniforms: {
          uSize: { value: size },
          uAlpha: { value: 0 },
          uColor: { value: new THREE.Color(color) },
          uTime: host.uTime,
        },
        vertexShader: CARD_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(cardGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', order);
      root.add(mesh);
      return { mesh, mat };
    };
    for (let i = 0; i < SAP_POOLS.totems; i++) {
      const tetherMat = new THREE.ShaderMaterial({
        name: 'wildheartSapTether',
        uniforms: {
          uFrom: { value: new THREE.Vector3() },
          uTo: { value: new THREE.Vector3() },
          uSag: { value: 0 },
          uTime: host.uTime,
          uStrength: { value: 0 },
          uPulse: { value: -1 },
          uCharge: { value: 0 },
          uSnap: { value: -1 },
          uAlpha: { value: 1 },
        },
        vertexShader: TETHER_VERT,
        fragmentShader: TETHER_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const tether = new THREE.Mesh(tetherGeo, tetherMat);
      tether.name = 'wildheart-sap-tether';
      tether.frustumCulled = false;
      tether.visible = false;
      tether.renderOrder = floorVfxRenderOrder('encounter', 9);
      const ringMat = new THREE.ShaderMaterial({
        name: 'wildheartSapRing',
        uniforms: {
          uTime: host.uTime,
          uFill: { value: 0 },
          uArming: { value: 1 },
          uFlash: { value: 0 },
          uAlpha: { value: 0 },
          uInner: { value: SAP_RING_RADIUS * 0.55 },
          uOuter: { value: SAP_RING_RADIUS * 1.45 },
        },
        vertexShader: FLOOR_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.name = 'wildheart-sap-ring';
      ring.frustumCulled = false;
      ring.visible = false;
      ring.renderOrder = floorVfxRenderOrder('encounter', 5);
      const beaconMat = new THREE.ShaderMaterial({
        name: 'wildheartSapBeacon',
        uniforms: {
          uTime: host.uTime,
          uAlpha: { value: 0 },
          uColor: { value: new THREE.Color(SAP_COLORS.sap) },
        },
        vertexShader: BEACON_VERT,
        fragmentShader: BEACON_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.name = 'wildheart-sap-beacon';
      beacon.frustumCulled = false;
      beacon.visible = false;
      beacon.renderOrder = floorVfxRenderOrder('encounter', 10);
      this.materials.push(tetherMat, ringMat, beaconMat);
      root.add(tether, ring, beacon);
      const sigil = card(SIGIL_FRAG, 3.2, SAP_COLORS.sap, 11);
      sigil.mesh.name = 'wildheart-sap-sigil';
      const crown = card(GLOW_FRAG, 4.5, SAP_COLORS.sap, 11);
      crown.mesh.name = 'wildheart-sap-crown';
      const bloom = card(GLOW_FRAG, 7, SAP_COLORS.sap, 11);
      bloom.mesh.name = 'wildheart-sap-bloom';
      this.totems.push({
        id: -1,
        seen: false,
        x: 0,
        y: 0,
        z: 0,
        height: sapTotemHeight(),
        bornAt: -1e9,
        deadAt: -1,
        pulseAt: -1e9,
        snapAt: -1,
        riseUntil: -1,
        tether,
        tetherMat,
        ring,
        ringMat,
        beacon,
        beaconMat,
        sigil,
        crown,
        bloom,
      });
    }
    // The thrown bundles.
    const bundleGeo = bundleGeometry();
    this.geometries.push(bundleGeo);
    const bundleMat = surfaceMat({ color: 0xffffff, vertexColors: true, roughness: 0.7 });
    for (let i = 0; i < SAP_POOLS.throws; i++) {
      const mesh = new THREE.Mesh(bundleGeo, bundleMat);
      mesh.name = 'wildheart-sap-bundle';
      mesh.frustumCulled = false;
      mesh.visible = false;
      root.add(mesh);
      const glow = card(GLOW_FRAG, 3.4, 0xff5a2a, 11);
      this.throws.push({
        live: false,
        at: 0,
        fx: 0,
        fy: 0,
        fz: 0,
        tx: 0,
        ty: 0,
        tz: 0,
        emit: 0,
        mesh,
        glow,
      });
    }
    // The rider's hex in his hands.
    this.rider = card(GLOW_FRAG, 4, 0xff4a22, 11);
    this.rider.mesh.name = 'wildheart-sap-rider';
    // The drum, its drummer and his arms.
    const drumGeo = drumGeometry();
    const drummerGeo = drummerGeometry();
    const armGeo = armGeometry();
    const skinGeo = new THREE.CircleGeometry(DRUM_LOOK.radius * 0.98, 28).rotateX(-Math.PI / 2);
    this.geometries.push(drumGeo, drummerGeo, armGeo, skinGeo);
    const bodyMat = surfaceMat({ color: 0xffffff, vertexColors: true, roughness: 0.75 });
    const drumMesh = new THREE.Mesh(drumGeo, bodyMat);
    drumMesh.name = 'wildheart-war-drum';
    this.skinMat = new THREE.ShaderMaterial({
      name: 'wildheartDrumSkin',
      uniforms: { uFlash: { value: 0 }, uLit: { value: 1 } },
      vertexShader: FLOOR_VERT,
      fragmentShader: /* glsl */ `
        uniform float uFlash;
        uniform float uLit;
        varying vec2 vP;
        void main() {
          float r = length(vP) / ${DRUM_LOOK.radius.toFixed(2)};
          vec3 hide = vec3(0.62, 0.5, 0.34) * (0.55 + 0.45 * uLit);
          float sun = smoothstep(0.42, 0.36, r) * step(0.3, r) + smoothstep(0.12, 0.0, r);
          vec3 col = mix(hide, vec3(0.55, 0.12, 0.08), sun * 0.8);
          col += vec3(1.0, 0.62, 0.3) * uFlash * (1.2 - r);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.materials.push(this.skinMat);
    const skin = new THREE.Mesh(skinGeo, this.skinMat);
    skin.name = 'wildheart-war-drum-skin';
    skin.position.y = DRUM_LOOK.height + 0.02;
    const drummer = new THREE.Mesh(drummerGeo, bodyMat);
    drummer.name = 'wildheart-war-drummer';
    drummer.position.set(0, 0, -DRUM_LOOK.radius - 0.55);
    for (const [arm, side] of [
      [this.armR, -1],
      [this.armL, 1],
    ] as const) {
      const m = new THREE.Mesh(armGeo, bodyMat);
      m.name = 'wildheart-war-drum-stick';
      arm.add(m);
      arm.position.set(side * 0.72, DRUM_LOOK.drummer * 0.62, -DRUM_LOOK.radius - 0.55);
      this.drum.add(arm);
    }
    this.drum.add(drumMesh, skin, drummer);
    this.drum.name = 'wildheart-war-drum-group';
    this.drum.visible = false;
    for (const o of [drumMesh, skin, drummer]) o.frustumCulled = false;
    root.add(this.drum);
    // The ring of force a beat throws out round the howdah.
    const bandGeo = new THREE.CylinderGeometry(1, 1, 1, 56, 1, true).translate(0, 0.5, 0);
    this.geometries.push(bandGeo);
    this.bandMat = new THREE.ShaderMaterial({
      name: 'wildheartDrumBand',
      uniforms: { uAlpha: { value: 0 }, uColor: { value: new THREE.Color(0xff7a2e) } },
      vertexShader: BEACON_VERT,
      fragmentShader: BAND_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.materials.push(this.bandMat);
    this.band = new THREE.Mesh(bandGeo, this.bandMat);
    this.band.name = 'wildheart-war-drum-band';
    this.band.frustumCulled = false;
    this.band.visible = false;
    this.band.renderOrder = floorVfxRenderOrder('encounter', 10);
    root.add(this.band);
    // The splinters.
    this.shardCount = sapShardCount(host.density);
    const shardGeo = new THREE.BoxGeometry(0.22, 0.9, 0.16);
    this.geometries.push(shardGeo);
    this.shards = new THREE.InstancedMesh(
      shardGeo,
      surfaceMat({ color: 0xffffff, roughness: 0.8 }),
      this.shardCount,
    );
    this.shards.name = 'wildheart-sap-splinters';
    this.shards.frustumCulled = false;
    this.shards.visible = false;
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.Color();
    const mix = [WAR_RED, WAR_RED, BONE, DARK_WOOD, GOLD];
    for (let i = 0; i < this.shardCount; i++) {
      this.shards.setColorAt(i, color.setHex(mix[i % mix.length]));
      this.shards.setMatrixAt(i, this.tmpM.makeScale(0, 0, 0));
    }
    root.add(this.shards);
    this.sPos = new Float32Array(this.shardCount * 3);
    this.sVel = new Float32Array(this.shardCount * 3);
    this.sAxis = new Float32Array(this.shardCount * 3);
    this.sSpin = new Float32Array(this.shardCount);
    this.sAge = new Float32Array(this.shardCount).fill(1e9);
    this.sFloor = new Float32Array(this.shardCount);
  }

  // ------------------------------------------------------------------ scans

  beginScan(): void {
    this.saurian.seen = false;
    for (const t of this.totems) t.seen = false;
  }

  /** The Great Saurian (alive or fallen). */
  scanSaurian(e: Entity): void {
    const s = this.saurian;
    if (s.id !== e.id) {
      s.id = e.id;
      s.x = e.pos.x;
      s.y = e.pos.y;
      s.z = e.pos.z;
      s.facing = e.facing;
    }
    s.seen = true;
    s.scale = e.scale || 3.2;
    s.dead = e.dead;
    s.engaged = !e.dead && e.inCombat;
    let drum: SaurianTrack['drum'] = 'none';
    if (!e.dead)
      for (const a of e.auras) {
        if (a.id === SAURIAN_WAR_DRUM) drum = 'beating';
        else if (a.id === SAURIAN_DRUM_SILENCED) drum = 'silenced';
      }
    s.drum = drum;
  }

  /** A Sunbone Sap Totem: true when it is one. */
  scanTotem(e: Entity): boolean {
    if (e.templateId !== SAP_TOTEM_ID) return false;
    let slot: TotemSlot | null = null;
    for (const t of this.totems) if (t.id === e.id) slot = t;
    if (e.dead) {
      // A dead totem keeps its slot while its snap plays, and a beat longer in
      // case its backlash is still on its way.
      if (slot) {
        if (slot.deadAt < 0) slot.deadAt = this.clock;
        slot.seen = slot.snapAt >= 0 || this.clock - slot.deadAt < 0.6;
      }
      return true;
    }
    if (!slot) {
      slot = this.totems.find((t) => t.id < 0) ?? null;
      if (!slot) return true;
      // Its age off its arming bar (a view that joins late), else long landed.
      const arming = e.castingAbility === SAURIAN_SAP_TETHER && sapTotemArming(e.castTotal);
      this.claim(slot, e.id, this.clock - (arming ? e.castTotal - e.castRemaining : 10));
    }
    slot.seen = true;
    slot.x = e.pos.x;
    slot.y = e.pos.y;
    slot.z = e.pos.z;
    slot.height = sapTotemHeight(e.scale || undefined);
    return true;
  }

  endScan(): void {
    if (!this.saurian.seen) {
      this.saurian.id = -1;
      this.saurian.drum = 'none';
      this.saurian.engaged = false;
    }
    for (const t of this.totems) if (t.id >= 0 && !t.seen) this.release(t);
  }

  private claim(slot: TotemSlot, id: number, bornAt: number): void {
    slot.id = id;
    slot.bornAt = bornAt;
    slot.deadAt = -1;
    slot.pulseAt = -1e9;
    slot.snapAt = -1;
    slot.riseUntil = -1;
    slot.seen = true;
  }

  private release(slot: TotemSlot): void {
    slot.id = -1;
    slot.snapAt = -1;
    slot.tether.visible = false;
    slot.ring.visible = false;
    slot.beacon.visible = false;
    slot.sigil.mesh.visible = false;
    slot.crown.mesh.visible = false;
    slot.bloom.mesh.visible = false;
  }

  // ----------------------------------------------------------------- events

  /** The rework's spellfx. True when drawn. */
  handleEvent(ev: SimEvent & { type: 'spellfx' }): boolean {
    switch (ev.ability) {
      case SAURIAN_TOTEM_THROW:
        this.onThrow(ev.sourceId, ev.targetId);
        return true;
      case SAURIAN_SAP_TETHER:
        this.onMend(ev.sourceId);
        return true;
      case SAURIAN_SAP_BACKLASH:
        this.onBreak(ev.sourceId);
        return true;
      case SAURIAN_DRUM_BEAT:
        this.onBeat();
        return true;
      default:
        return false;
    }
  }

  private onThrow(saurianId: number, totemId: number | undefined): void {
    const s = this.world.entities.get(saurianId);
    const t = totemId === undefined ? undefined : this.world.entities.get(totemId);
    if (!s || !t) return;
    if (this.saurian.id !== s.id) this.scanSaurian(s);
    this.riderAt = this.clock;
    const hands = this.riderPoint(this.tmpV);
    const slot = this.throws.find((x) => !x.live) ?? this.throws[0];
    slot.live = true;
    slot.at = this.clock;
    slot.fx = hands.x;
    slot.fy = hands.y;
    slot.fz = hands.z;
    slot.tx = t.pos.x;
    slot.ty = this.host.groundY(t.pos.x, t.pos.z);
    slot.tz = t.pos.z;
    slot.emit = 0;
    // The totem's slot opens now: its tether reaches out once it lands.
    let ts = this.totems.find((x) => x.id === t.id);
    if (!ts) {
      ts = this.totems.find((x) => x.id < 0);
      if (ts) this.claim(ts, t.id, this.clock);
    } else ts.bornAt = this.clock;
    if (ts) {
      ts.x = t.pos.x;
      ts.y = t.pos.y;
      ts.z = t.pos.z;
      ts.riseUntil = this.clock + TOTEM_THROW_SECONDS + TOTEM_RISE_OFFER;
    }
    this.playGesture?.(t.id, TOTEM_RISE_GESTURE);
    // The hex gathering in his hands.
    this.host.puff(hands.x, hands.y, hands.z, 14, {
      speed: 2.2,
      up: 1.4,
      life: 0.8,
      size: [0.5, 0.15],
      color: [1, 0.36, 0.16],
      alpha: 0.95,
      glow: true,
      radius: 0.8,
    });
  }

  private onMend(totemId: number): void {
    const slot = this.totems.find((t) => t.id === totemId);
    if (!slot) return;
    slot.pulseAt = this.clock;
    this.playGesture?.(totemId, SAURIAN_SAP_TETHER);
    const cy = slot.y + slot.height * SAP_TOTEM_CROWN;
    this.host.puff(slot.x, cy, slot.z, 8, {
      speed: 1.4,
      up: 1.6,
      life: 1,
      size: [0.6, 0.2],
      color: [0.8, 1, 0.42],
      alpha: 0.9,
      glow: true,
      radius: 0.6,
    });
  }

  private onBreak(totemId: number): void {
    const slot = this.totems.find((t) => t.id === totemId);
    const e = this.world.entities.get(totemId);
    const x = slot ? slot.x : e?.pos.x;
    const z = slot ? slot.z : e?.pos.z;
    if (x === undefined || z === undefined) return;
    const gy = this.host.groundY(x, z);
    const h = slot ? slot.height : sapTotemHeight();
    if (slot) {
      slot.snapAt = this.clock;
      slot.seen = true;
    }
    this.burstShards(x, gy, z, h);
    // Red sparks off the splintering post, dust and spray at its foot.
    this.host.puff(x, gy + h * 0.55, z, 34, {
      speed: 9,
      up: 4,
      life: 1.1,
      size: [0.55, 0.12],
      color: [1, 0.38, 0.18],
      alpha: 1,
      glow: true,
      gravity: 9,
      radius: 1.2,
    });
    this.host.puff(x, gy + 0.6, z, 16, {
      speed: 4.5,
      up: 1.2,
      life: 1.5,
      size: [1.8, 3.6],
      color: [0.62, 0.5, 0.36],
      alpha: 0.55,
      drag: 2,
      radius: 1.2,
    });
    this.host.shockRing(x, z, 0xff5a2a, SAP_RING_RADIUS * 3.2, 0.6);
    if (wetFloor(gy)) {
      this.host.splash.crown(x, gy, z, CROWN_LOOKS.debris, 0xffffff);
      this.host.splash.ripple(x, gy, z, RIPPLE_LOOKS.rider, 0xffffff);
    }
  }

  private onBeat(): void {
    this.beatAt = this.clock;
    const s = this.saurian;
    if (s.id < 0) return;
    // The pulse over the ford at the Stomp's reach: the clock it quickens.
    this.host.shockRing(s.x, s.z, 0xff7a2e, SAURIAN_TUNING.stompRadius, 0.55);
    const gy = this.host.groundY(s.x, s.z);
    if (wetFloor(gy)) this.host.splash.ripple(s.x, gy, s.z, RIPPLE_LOOKS.stamp, 0xffffff);
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, clock: number): void {
    this.clock = clock;
    this.followSaurian(dt);
    this.paintRider();
    this.paintThrows();
    this.paintTotems();
    this.paintDrum();
    this.stepShards(dt);
  }

  hideAll(): void {
    for (const t of this.totems) this.release(t);
    for (const t of this.throws) {
      t.live = false;
      t.mesh.visible = false;
      t.glow.mesh.visible = false;
    }
    this.rider.mesh.visible = false;
    this.drum.visible = false;
    this.band.visible = false;
    this.shards.visible = false;
    this.shardsLive = 0;
    this.sAge.fill(1e9);
    this.saurian.id = -1;
  }

  /** The beast's drawn place: eased onto its 20 Hz steps. */
  private followSaurian(dt: number): void {
    const s = this.saurian;
    if (s.id < 0) return;
    const e = this.world.entities.get(s.id);
    if (!e) return;
    const k = Math.min(1, dt * 12);
    s.x += (e.pos.x - s.x) * k;
    s.y += (e.pos.y - s.y) * k;
    s.z += (e.pos.z - s.z) * k;
    let d = e.facing - s.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    s.facing += d * k;
  }

  /** A point on the beast: `up` yards over its feet, `forward` along it. */
  private beastPoint(up: number, forward: number, out: THREE.Vector3): THREE.Vector3 {
    const s = this.saurian;
    return out.set(
      s.x + Math.sin(s.facing) * forward,
      s.y + up,
      s.z + Math.cos(s.facing) * forward,
    );
  }

  private riderPoint(out: THREE.Vector3): THREE.Vector3 {
    const r = riderHands(this.saurian.scale);
    return this.beastPoint(r.up, r.forward, out);
  }

  private paintRider(): void {
    const s = this.saurian;
    const card = this.rider;
    if (s.id < 0 || s.dead || !this.howdahStanding(s.id)) {
      card.mesh.visible = false;
      return;
    }
    const flare = riderFlare(this.clock - this.riderAt);
    const ember = s.engaged ? riderEmber(this.clock) : 0;
    const lit = Math.max(flare, ember);
    this.riderLit = lit;
    if (lit <= 0.01) {
      card.mesh.visible = false;
      return;
    }
    this.riderPoint(card.mesh.position);
    card.mat.uniforms.uAlpha.value = lit;
    card.mat.uniforms.uSize.value = 2.6 + 4.2 * flare;
    card.mesh.visible = true;
    // Hex embers rising off his hands while he works.
    if (s.engaged && this.host.rand() < 0.12 * this.host.density + 0.4 * flare) {
      const p = card.mesh.position;
      this.host.puff(p.x, p.y, p.z, 1, {
        speed: 0.6,
        up: 2,
        life: 1,
        size: [0.35, 0.1],
        color: [1, 0.4, 0.18],
        alpha: 0.85,
        glow: true,
        radius: 0.6,
      });
    }
  }

  /** The rider's lit share this frame (0..1), for tests and evidence. */
  riderGlow(): number {
    return this.riderLit;
  }

  private paintThrows(): void {
    for (const t of this.throws) {
      if (!t.live) continue;
      const age = this.clock - t.at;
      const arc = totemThrow(age, this.arc);
      if (!arc) {
        // Landed: the splash and the shock where the totem tears up.
        t.live = false;
        t.mesh.visible = false;
        t.glow.mesh.visible = false;
        this.host.shockRing(t.tx, t.tz, 0xff5a2a, SAP_RING_RADIUS * 2.4, 0.5);
        this.host.puff(t.tx, t.ty + 0.4, t.tz, 18, {
          speed: 5,
          up: 3,
          life: 1.2,
          size: [1.2, 2.6],
          color: [0.7, 0.62, 0.48],
          alpha: 0.6,
          drag: 2,
          radius: 1,
        });
        if (wetFloor(t.ty)) {
          this.host.splash.crown(t.tx, t.ty, t.tz, CROWN_LOOKS.stamp, 0xffffff);
          this.host.splash.ripple(t.tx, t.ty, t.tz, RIPPLE_LOOKS.stamp, 0xffffff);
        }
        continue;
      }
      const x = t.fx + (t.tx - t.fx) * arc.along;
      const y = t.fy + (t.ty + 1 - t.fy) * arc.along + arc.lift;
      const z = t.fz + (t.tz - t.fz) * arc.along;
      t.mesh.position.set(x, y, z);
      t.mesh.rotation.set(arc.spin, 0, arc.spin * 0.6);
      t.mesh.scale.setScalar(1.4);
      t.mesh.visible = true;
      t.glow.mesh.position.set(x, y, z);
      t.glow.mat.uniforms.uAlpha.value = 0.85;
      t.glow.mesh.visible = true;
      t.emit += 1;
      if (t.emit % 2 === 0)
        this.host.puff(x, y, z, 2, {
          speed: 0.8,
          up: 0.2,
          life: 0.7,
          size: [0.5, 0.1],
          color: [0.85, 1, 0.42],
          alpha: 0.9,
          glow: true,
          radius: 0.3,
        });
    }
  }

  private paintTotems(): void {
    const s = this.saurian;
    const anchor = sapAnchor(s.scale);
    for (const slot of this.totems) {
      if (slot.id < 0) continue;
      const e = this.world.entities.get(slot.id);
      const snapping = slot.snapAt >= 0;
      if (snapping && this.clock - slot.snapAt > SAP_BREAK_SECONDS) {
        this.release(slot);
        continue;
      }
      const alive = !!e && !e.dead && !snapping;
      if (e && !e.dead) {
        slot.x = e.pos.x;
        slot.y = e.pos.y;
        slot.z = e.pos.z;
      }
      const crownY = slot.y + slot.height * SAP_TOTEM_CROWN;
      const landed = this.clock - slot.bornAt >= TOTEM_THROW_SECONDS;
      // The Rise on offer until its view takes it.
      if (alive && slot.riseUntil > this.clock) this.playGesture?.(slot.id, TOTEM_RISE_GESTURE);
      // The ring, the beacon, the sigil: while it stands and has landed.
      const show = alive && landed;
      let fill = 1;
      let arming = false;
      if (show && e) {
        arming = e.castingAbility === SAURIAN_SAP_TETHER && sapTotemArming(e.castTotal);
        fill =
          e.castingAbility === SAURIAN_SAP_TETHER && e.castTotal > 0
            ? 1 - e.castRemaining / e.castTotal
            : 1;
      }
      const mend = sapMendFlare(this.clock - slot.pulseAt, false);
      slot.ring.visible = show;
      slot.beacon.visible = show;
      slot.sigil.mesh.visible = show;
      if (show) {
        const gy = this.host.groundY(slot.x, slot.z);
        slot.ring.position.set(slot.x, gy + 0.08, slot.z);
        const ru = slot.ringMat.uniforms;
        ru.uFill.value = fill;
        ru.uArming.value = arming ? 1 : 0;
        ru.uFlash.value = mend;
        ru.uAlpha.value = 1;
        slot.beacon.position.set(slot.x, crownY, slot.z);
        slot.beacon.scale.set(1, SAP_BEACON_HEIGHT, 1);
        slot.beaconMat.uniforms.uAlpha.value = 0.32 + 0.4 * mend + (arming ? 0.08 : 0.2);
        slot.sigil.mesh.position.set(slot.x, crownY + 3.4, slot.z);
        slot.sigil.mat.uniforms.uAlpha.value = 0.85 + 0.15 * mend;
      }
      slot.crown.mesh.visible = show && mend > 0.01;
      if (slot.crown.mesh.visible) {
        slot.crown.mesh.position.set(slot.x, crownY, slot.z);
        slot.crown.mat.uniforms.uAlpha.value = mend;
      }
      // The tether.
      const beast = s.id >= 0 && !s.dead;
      const tetherOn = beast && landed && (alive || snapping);
      slot.tether.visible = tetherOn;
      const bloom = beast ? sapMendFlare(this.clock - slot.pulseAt, true) : 0;
      const snapT = snapping ? (this.clock - slot.snapAt) / SAP_SNAP_SECONDS : -1;
      const snapFlash = snapping ? sapBreakFlash(this.clock - slot.snapAt - SAP_SNAP_SECONDS) : 0;
      const beastLit = Math.max(bloom, snapFlash);
      slot.bloom.mesh.visible = beastLit > 0.01;
      if (beastLit > 0.01) {
        this.beastPoint(anchor.up, anchor.forward, slot.bloom.mesh.position);
        slot.bloom.mat.uniforms.uAlpha.value = beastLit;
        slot.bloom.mat.uniforms.uColor.value.setHex(snapping ? SAP_COLORS.snap : SAP_COLORS.sap);
      }
      if (!tetherOn) continue;
      if (snapping && snapT >= 1) {
        slot.tether.visible = false;
        continue;
      }
      const u = slot.tetherMat.uniforms;
      u.uFrom.value.set(slot.x, crownY, slot.z);
      this.beastPoint(anchor.up, anchor.forward, u.uTo.value);
      const span = u.uFrom.value.distanceTo(u.uTo.value);
      u.uSag.value = sapSag(span);
      if (snapping) {
        u.uCharge.value = 1;
        u.uStrength.value = 1;
        u.uSnap.value = Math.min(1, snapT * snapT * (3 - 2 * snapT));
        u.uPulse.value = -1;
      } else {
        sapTether(arming, fill, this.tether);
        u.uCharge.value = this.tether.charge;
        u.uStrength.value = this.tether.strength;
        u.uSnap.value = -1;
        u.uPulse.value = sapPulse(this.clock - slot.pulseAt, SAP_PULSE_SECONDS);
      }
    }
  }

  private paintDrum(): void {
    const s = this.saurian;
    const on = s.id >= 0 && !s.dead && s.drum !== 'none';
    this.drum.visible = on;
    if (!on) {
      this.band.visible = false;
      return;
    }
    const seat = drumSeat(s.scale);
    this.beastPoint(seat.up, seat.forward, this.drum.position);
    this.drum.rotation.set(0, s.facing, 0);
    const k = s.scale / 3.2;
    this.drum.scale.setScalar(k);
    const beating = s.drum === 'beating';
    const since = this.clock - this.beatAt;
    drumSticks(since, beating, this.sticks);
    // Raised is -1.25 (sticks up and back), down on the skin is 0.
    this.armR.rotation.x = -1.25 + this.sticks.right;
    this.armL.rotation.x = -1.25 + this.sticks.left;
    drumBeat(beating ? since : -1, this.beat);
    this.skinMat.uniforms.uFlash.value = this.beat.flash;
    this.skinMat.uniforms.uLit.value = beating ? 1 : 0.35;
    this.band.visible = this.beat.alpha > 0.01;
    if (this.band.visible) {
      this.band.position.set(s.x, this.drum.position.y - 1.2 * k, s.z);
      this.band.scale.set(this.beat.radius * k, 2.4 * k, this.beat.radius * k);
      this.bandMat.uniforms.uAlpha.value = this.beat.alpha;
    }
    // Silenced: it smokes.
    if (!beating && this.clock - this.smokeAt > 0.35) {
      this.smokeAt = this.clock;
      const p = this.drum.position;
      this.host.puff(p.x, p.y + DRUM_LOOK.height * k, p.z, 2, {
        speed: 0.5,
        up: 1.6,
        life: 2,
        size: [0.8, 2.4],
        color: [0.36, 0.34, 0.32],
        alpha: 0.5,
        drag: 1,
        radius: 0.6,
      });
    }
  }

  // ---- the splinters -------------------------------------------------------------------

  private burstShards(x: number, y: number, z: number, h: number): void {
    const n = this.shardCount;
    for (let k = 0; k < n; k++) {
      const i = this.shardNext;
      this.shardNext = (this.shardNext + 1) % n;
      const a = this.host.rand() * Math.PI * 2;
      const sp = 4 + this.host.rand() * 9;
      const at = 0.15 + this.host.rand() * 0.8;
      this.sPos[i * 3] = x + Math.sin(a) * 0.5;
      this.sPos[i * 3 + 1] = y + h * at;
      this.sPos[i * 3 + 2] = z + Math.cos(a) * 0.5;
      this.sVel[i * 3] = Math.sin(a) * sp;
      this.sVel[i * 3 + 1] = 3 + this.host.rand() * 9;
      this.sVel[i * 3 + 2] = Math.cos(a) * sp;
      const ax = this.host.rand() - 0.5;
      const ay = this.host.rand() - 0.5;
      const az = this.host.rand() - 0.5;
      const l = Math.hypot(ax, ay, az) || 1;
      this.sAxis[i * 3] = ax / l;
      this.sAxis[i * 3 + 1] = ay / l;
      this.sAxis[i * 3 + 2] = az / l;
      this.sSpin[i] = 6 + this.host.rand() * 12;
      this.sAge[i] = 0;
      this.sFloor[i] = y;
    }
    this.shardsLive = n;
    this.shards.visible = true;
  }

  private stepShards(dt: number): void {
    if (this.shardsLive === 0) return;
    let live = 0;
    for (let i = 0; i < this.shardCount; i++) {
      const age = this.sAge[i];
      if (age >= SAP_BREAK_SECONDS) {
        if (age < 1e8) {
          this.sAge[i] = 1e9;
          this.shards.setMatrixAt(i, this.tmpM.makeScale(0, 0, 0));
        }
        continue;
      }
      live++;
      this.sAge[i] = age + dt;
      const o = i * 3;
      if (this.sPos[o + 1] > this.sFloor[i]) {
        this.sVel[o + 1] -= SHARD_GRAVITY * dt;
        this.sPos[o] += this.sVel[o] * dt;
        this.sPos[o + 1] = Math.max(this.sFloor[i], this.sPos[o + 1] + this.sVel[o + 1] * dt);
        this.sPos[o + 2] += this.sVel[o + 2] * dt;
      }
      const size = age > SAP_BREAK_SECONDS - 0.4 ? (SAP_BREAK_SECONDS - age) / 0.4 : 1;
      this.tmpQ.setFromAxisAngle(
        this.tmpV.set(this.sAxis[o], this.sAxis[o + 1], this.sAxis[o + 2]),
        age * this.sSpin[i],
      );
      this.tmpM.compose(
        this.tmpV.set(this.sPos[o], this.sPos[o + 1], this.sPos[o + 2]),
        this.tmpQ,
        this.tmpS.setScalar(Math.max(0, size) * (0.8 + (i % 3) * 0.35)),
      );
      this.shards.setMatrixAt(i, this.tmpM);
    }
    this.shards.instanceMatrix.needsUpdate = true;
    this.shardsLive = live;
    if (live === 0) this.shards.visible = false;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
