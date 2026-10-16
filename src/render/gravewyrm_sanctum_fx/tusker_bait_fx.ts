// The Sledge Tusker's bait rework on the Sledge Road (plan: tusker_bait_fx_core.ts),
// composed by SanctumFx (sanctum_fx.ts) on its host:
//  - the five ice outcrops: a cluster of glacier fangs three players tall, cut
//    in facets and lit from inside (one ice shader: rim light, frost, snow on
//    its shoulders). Through a Trample's aim every intact outcrop glows cold
//    from inside, and the one the painted lane will end in burns brightest
//    inside an ice-blue ring on the shared kit that fills with the bar (the
//    floor circles and the lane's colour are tusker_aim_fx.ts's);
//    an outcrop the tusks are buried in is shoved, shudders, and cracks of
//    light climb it for the seconds it holds; a burst outcrop is a jagged
//    stump among its fallen blocks;
//  - the tusks going in and the outcrop bursting: the white flash, ice shards
//    and blocks thrown out (the shared shard pool), a wall of powder, the shock
//    in the ice, the shake;
//  - the stuck Tusker: the gold damage-window ring under it draining with the
//    seconds left (the shared kit, as under a Sunstruck Zulgar), the frost
//    smoking off its buried tusks, its own pawing (a gesture);
//  - the soulfire trail: the burning lane's edge on the shared kit (the edge
//    the sim tests), a river of soulfire flowing on the ice inside it, and
//    walls of flame taller than a player down its length and across it (each
//    a row of separate soul-green tongues tearing violet at the tip), racing
//    down the lane as the charge runs it and guttering over its last seconds.
//
// Readable on every tier: the outcrops, the two rings, the trail's edge, its
// river and its flame walls are meshes built once under the host's root (they
// ride its gated attach) and their states are uniforms; only the particles,
// the shards and the cross walls' count thin with the density. Cosmetic: no
// outcome is decided here. No light; no per-frame allocation.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  SANCTUM_OUTCROP_HELD,
  SANCTUM_SOULFIRE_TRAIL,
  SANCTUM_TRAIL_BURN,
  SLEDGE_TUSKER_ID,
  TUSKER_BREAKS_FREE,
  TUSKER_STUCK_EXPOSED,
  TUSKER_TRAMPLE,
  TUSKER_TUNING,
  TUSKER_TUSKS_STICK,
} from '../../sim/encounters/gravewyrm_sanctum/ids';
import type { OutcropSpot } from '../../sim/encounters/gravewyrm_sanctum/tusker_road';
import { planTrampleLaneWorld } from '../../sim/encounters/gravewyrm_sanctum/tusker_road_world';
import type { Entity, SimEvent, TuskerLane } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  type TelegraphLane,
  type TelegraphPaint,
  telegraphFillOf,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { FLAME_HEAT, rampGlsl, rgb, SANCTUM_ACCENTS, SOULFIRE_RAMP } from './sanctum_fx_core';
import type { SanctumFxHost } from './sanctum_fx_host';
import type { OutcropView } from './tusker_aim_fx';
import { TRAMPLE_AIM_COLORS } from './tusker_aim_fx_core';
import {
  BAIT_POOLS,
  BAIT_RING_RADIUS,
  OUTCROP_FANGS,
  OUTCROP_HEIGHT,
  OUTCROP_STUMPS,
  type OutcropPhase,
  outcropFlash,
  outcropPhase,
  STUCK_RING_RADIUS,
  struckOutcrop,
  stuckRing,
  TRAIL_LOOK,
  TUSKER_STRAIN_GESTURE,
  trailPresence,
} from './tusker_bait_fx_core';
import { modelToWorld, TUSKER_MODEL, tuskerModelScale } from './tusker_model_core';

/** Seconds between the strain gestures while it is held. */
const STRAIN_EVERY = 2.1;

/** The Sanctum's low key light as the ice shader reads it (the polar dusk
 *  comes in over the Calving Face, high and from the north-west). */
const KEY_DIR = new THREE.Vector3(-0.34, 0.78, 0.52).normalize();

const NOISE_GLSL = /* glsl */ `
float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(bHash(i), bHash(i + vec2(1.0, 0.0)), u.x),
    mix(bHash(i + vec2(0.0, 1.0)), bHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
`;

const ICE_VERT = /* glsl */ `
varying vec3 vView;
varying vec3 vLocal;
varying float vH;
#include <fog_pars_vertex>
void main() {
  vLocal = position;
  vH = position.y / ${OUTCROP_HEIGHT.toFixed(2)};
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // View space: small numbers, so the face normals cut from its derivatives
  // stay clean a hundred thousand yards from the world's origin.
  vView = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** Glacier ice: a deep blue heart to rime at its tips, cut in hard facets
 *  (the normal is the face's own), a cold light through its thin edges, snow
 *  on whatever faces up. `uStruck` sends cracks of light climbing it,
 *  `uArmed` is the cold pulse through a Trample's aim (1: the outcrop the
 *  lane will end in; a third of it: every other intact one), `uFlash` the
 *  white of an impact. */
const ICE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStruck;
uniform float uArmed;
uniform float uFlash;
uniform vec3 uKeyDir;
varying vec3 vView;
varying vec3 vLocal;
varying float vH;
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  // Guarded: an edge-on pixel's derivatives cross to zero, and a NaN normal
  // would reach the bloom.
  vec3 fc = cross(dFdx(vView), dFdy(vView));
  vec3 N = fc * inversesqrt(max(dot(fc, fc), 1e-20));
  vec3 V = normalize(-vView);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);
  vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float lit = max(dot(N, L), 0.0);
  float back = max(dot(N, -L), 0.0);
  float sky = dot(N, up);
  float fres = 1.0 - max(dot(N, V), 0.0);
  float rim = fres * fres * fres;
  float frost = bNoise(vLocal.xz * 0.8 + vLocal.y * 0.5) * 0.6 + bNoise(vLocal.xy * 1.9) * 0.4;
  vec3 heart = vec3(0.012, 0.07, 0.17);
  vec3 blue = vec3(0.08, 0.3, 0.55);
  vec3 pale = vec3(0.6, 0.83, 0.95);
  vec3 col = mix(heart, blue, smoothstep(0.0, 0.6, vH + frost * 0.25));
  col = mix(col, pale, smoothstep(0.45, 1.05, vH + frost * 0.2) * 0.75);
  // Each facet takes the dusk on its own face: hard, bright planes against
  // deep ones, the far side lit a little by the snow.
  col *= 0.3 + 1.25 * lit + 0.28 * back;
  col += vec3(0.02, 0.1, 0.2) * (0.5 + 0.5 * sky);
  // Snow lying on whatever faces the sky.
  col = mix(col, vec3(0.88, 0.94, 1.0) * (0.55 + 0.6 * lit), smoothstep(0.55, 0.9, sky) * 0.85);
  // The glacier's own cold light through its thin edges, and the sky's glint.
  col += vec3(0.2, 0.62, 0.95) * rim * 1.25;
  vec3 Hh = normalize(L + V);
  float s = max(dot(N, Hh), 0.0);
  float s4 = s * s * s * s;
  col += vec3(0.85, 0.94, 1.0) * s4 * s4 * s4 * 0.9;
  // Cracks of light climbing from where the tusks went in.
  float n1 = bNoise(vLocal.xy * 1.25 + vLocal.z * 0.7 + 11.0);
  float n2 = bNoise(vLocal.zy * 1.6 - vLocal.x * 0.5 + 3.0);
  float vein =
    (1.0 - smoothstep(0.0, 0.05, abs(n1 - 0.5))) +
    (1.0 - smoothstep(0.0, 0.04, abs(n2 - 0.5))) * 0.8;
  float climbed = 1.0 - smoothstep(uStruck * 1.3 - 0.3, uStruck * 1.3 + 0.02, vH);
  float beat = 0.8 + 0.4 * sin(uTime * 15.0 + vH * 9.0);
  col += vec3(0.55, 0.95, 1.0) * vein * climbed * beat * step(0.001, uStruck) * 2.6;
  col += vec3(0.1, 0.42, 0.66) * climbed * uStruck * 0.5;
  // Through a Trample's aim: a cold pulse from inside (strongest in the
  // outcrop the lane will end in).
  col += vec3(0.45, 0.9, 1.0) * uArmed * (0.45 + 0.35 * sin(uTime * 8.0)) * (0.35 + rim * 1.9);
  col = mix(col, vec3(0.94, 0.98, 1.0), uFlash);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

const STRIP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  // x across the strip (-1..1), y down its length (0..1).
  vUv = vec2(position.x * 2.0, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The river of soulfire on the ice inside the trail's edge. */
const STRIP_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLength;
uniform float uFront;
uniform float uFlames;
varying vec2 vUv;
${NOISE_GLSL}
${rampGlsl(SOULFIRE_RAMP, 'soulRamp')}
void main() {
  float along = vUv.y * uLength;
  float ragged = (bNoise(vec2(along * 0.9, uTime * 0.7)) - 0.5) * 0.4;
  float body = 1.0 - smoothstep(0.45, 1.0, abs(vUv.x) + ragged);
  // Soulfire running down the lane in ropes, never a flat sheet.
  float flow =
    bNoise(vec2(vUv.x * 2.6, along * 0.7 - uTime * 1.7)) * 0.6 +
    bNoise(vec2(vUv.x * 6.0 + 4.0, along * 1.8 - uTime * 2.9)) * 0.4;
  float ropes = smoothstep(0.35, 0.75, flow);
  float heat = clamp(body * (0.16 + 0.7 * ropes), 0.0, 0.86);
  float lit = 1.0 - smoothstep(uFront - 0.04, uFront + 0.001, vUv.y);
  float ends = smoothstep(0.0, 1.4, along) * smoothstep(0.0, 1.4, uLength - along);
  gl_FragColor = vec4(soulRamp(heat), heat * lit * ends * (0.3 + 0.4 * uFlames));
}
`;

const WALL_VERT = /* glsl */ `
attribute float aAlong;
attribute float aSeed;
attribute float aRun;
uniform float uLength;
uniform float uWidth;
varying vec2 vUv;
varying float vAlong;
varying float vSeed;
varying float vRun;
void main() {
  // Yards along the wall's own run (a long wall runs the lane, a cross wall
  // spans it), and 0..1 up the flame.
  vUv = vec2(mix(position.x * uWidth, aAlong * uLength, aRun), position.y);
  vAlong = aAlong;
  vSeed = aSeed;
  vRun = aRun;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** A wall of soulfire, drawn the way the game's flame sprites are (the shared
 *  FIRE_FRAG: teardrop tongues carved by scrolling noise, hot at the root and
 *  cooling up the ramp): a row of separate tongues, each its own height,
 *  swaying and flickering, with a shorter row offset in front, so it reads as
 *  fire with gaps between the flames and never as a flat sheet. Soul-green at
 *  the root, violet where it tears at the tip; the heat is held below the
 *  ramp's pale core (no white) and each layer stays dim, because the walls
 *  overlap and add. */
const WALL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLength;
uniform float uFront;
uniform float uFlames;
varying vec2 vUv;
varying float vAlong;
varying float vSeed;
varying float vRun;
${NOISE_GLSL}
${rampGlsl(SOULFIRE_RAMP, 'soulRamp')}
float h11(float p) { return fract(sin(p * 78.233) * 43758.5453); }
// One row of tongues w yards apart: x yards along the wall, y 0..1 up.
// Returns the tongue's body (0..1); hot is its core (root and spine).
float tongues(vec2 p, float w, float off, float seed, out float hot) {
  float u = p.x / w + off;
  float id = floor(u);
  float s = h11(id + seed * 37.0);
  float s2 = h11(id * 1.7 + seed * 11.0 + 3.1);
  float tall = (0.42 + 0.58 * s) * (0.84 + 0.16 * sin(uTime * (4.0 + 5.0 * s2) + s * 50.0));
  float y = p.y / max(0.05, tall * uFlames);
  // The tip bends with the heat; the root holds.
  float sway = (bNoise(vec2(id * 3.1 + seed * 5.0, uTime * 1.4)) - 0.5) * 0.7 * y * y;
  // A waver up the tongue (heat shimmer), stronger toward the tip.
  float waver = (bNoise(vec2(p.y * 3.0 - uTime * 3.2, id * 1.3 + seed)) - 0.5) * 0.28 * y;
  float x = fract(u) - 0.5 - sway - waver;
  float n = bNoise(vec2(p.x * 1.5 + seed * 9.0, p.y * 2.2 - uTime * (2.4 + 1.2 * s2))) * 0.75 +
    bNoise(vec2(p.x * 3.2 + seed * 4.0, p.y * 4.4 - uTime * 4.1)) * 0.25;
  // Round and wide at the root (the tongues merge there), drawn to a tip.
  float halfW = mix(0.52, 0.05, smoothstep(0.0, 1.0, sqrt(max(y, 0.0)))) * (0.72 + 0.5 * n);
  float body = (1.0 - smoothstep(halfW * 0.45, halfW, abs(x))) *
    (1.0 - smoothstep(0.78, 1.02, y + (n - 0.5) * 0.25));
  // The tip thins to smoke rather than a hard needle.
  body *= mix(1.0, 0.45, smoothstep(0.55, 1.0, y));
  hot = (1.0 - smoothstep(0.0, 0.75, y)) * (1.0 - smoothstep(0.0, halfW * 0.7, abs(x))) * body;
  return body;
}
void main() {
  // The cheap masks first: a pixel the fire has not reached yet, past the
  // strip's ends, or above the tallest tongue the flames can stand at costs
  // nothing more (the quad is mostly air above the tongues).
  float lit = 1.0 - smoothstep(uFront - 0.04, uFront + 0.001, vAlong);
  float along = vAlong * uLength;
  float ends = smoothstep(0.0, 1.2, along) * smoothstep(0.0, 1.2, uLength - along);
  float foot = smoothstep(0.0, 0.04, vUv.y);
  if (lit * ends * foot < 0.004 || vUv.y > uFlames * 1.15) discard;
  float hotA;
  float hotB = 0.0;
  float a1 = tongues(vUv, 1.45, 0.0, vSeed, hotA);
  // The shorter second row only on the long walls: a cross wall is seen
  // edge-on or stacked down the lane, where one row reads the same.
  float a2 = 0.0;
  if (vRun > 0.5) a2 = tongues(vUv * vec2(1.0, 1.35), 1.05, 0.5, vSeed + 0.37, hotB) * 0.85;
  // A burning bed along the foot that the tongues rise out of, so the row
  // reads as one fire and never as a picket of separate spikes.
  float bed = 1.0 - smoothstep(0.03, 0.1, vUv.y + (bNoise(vec2(vUv.x * 1.3, uTime * 1.1 + vSeed * 7.0)) - 0.5) * 0.06);
  float body = max(max(a1, a2), bed * 0.6);
  if (body < 0.12) discard;
  // Soul-green at the root and along each tongue's spine, cooling to violet
  // only up where the tall tongues tear.
  float heat = clamp(0.58 + 0.18 * max(hotA, hotB) + 0.05 * body - 0.34 * vUv.y, 0.0, 0.74);
  float flick = 0.88 + 0.12 * sin(uTime * 23.0 + vSeed * 61.0);
  // The cross walls add up when seen down the lane: each one dimmer.
  float layer = mix(0.62, 0.9, vRun);
  float a = smoothstep(0.12, 0.55, body) * lit * foot * ends * layer * flick;
  // Squared, the ramp keeps its hue on screen (a soul-green body, violet
  // tongues) instead of washing out to pastel over the snow.
  vec3 c = soulRamp(heat);
  // Dimmer toward each tongue's edge, so the flame has a soft rim.
  gl_FragColor = vec4(c * c * 1.55 * (0.55 + 0.45 * body), a);
}
`;

interface OutcropSlot {
  objectId: number;
  seen: boolean;
  phase: OutcropPhase;
  /** The phase's meshes are laid out (false on a fresh claim). */
  applied: boolean;
  group: THREE.Group;
  whole: THREE.Mesh;
  stump: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  stumpMat: THREE.ShaderMaterial;
  x: number;
  z: number;
  y: number;
  /** The heading the tusks came in on (the shove's way). */
  yaw: number;
  /** Clock of the last impact (the flash), and the chips' emitter. */
  flashAt: number;
  emit: number;
}

interface TrailSlot {
  objectId: number;
  seen: boolean;
  since: number;
  lane: TelegraphLane;
  strip: THREE.Mesh;
  walls: THREE.Mesh;
  stripMat: THREE.ShaderMaterial;
  wallMat: THREE.ShaderMaterial;
  emit: number;
}

/** One fang: a faceted cone, its rings knocked out of true, leaning to its tip. */
function fangGeometry(
  f: { x: number; z: number; r: number; h: number; sides: number; twist: number },
  leanX: number,
  leanZ: number,
  topShare: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(f.r * topShare, f.r, f.h, f.sides, 3, false);
  g.translate(0, f.h / 2, 0);
  g.rotateY(f.twist);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / f.h;
    // The middle rings bulge and pinch (a crystal, never a turned cone).
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const knock = t > 0.05 && t < 0.95 ? 1 + 0.2 * Math.sin(a * 2.3 + t * 9 + f.twist * 5) : 1;
    const lean = t * t;
    p.setXYZ(i, p.getX(i) * knock + leanX * lean + f.x, y, p.getZ(i) * knock + leanZ * lean + f.z);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g;
}

function outcropGeometry(): THREE.BufferGeometry {
  const parts = OUTCROP_FANGS.map((f) => fangGeometry(f, f.leanX, f.leanZ, 0.02));
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

function stumpGeometry(): THREE.BufferGeometry {
  const parts = OUTCROP_STUMPS.map((s, i) => {
    const g = fangGeometry({ ...s, twist: i * 0.9 }, 0, 0, 0.72);
    // A snapped top: sheared off at an angle (a fallen block lies on its side).
    const lying = Math.abs(s.tilt) > 1;
    g.translate(-s.x, lying ? -s.h / 2 : 0, -s.z);
    if (lying) g.rotateZ(s.tilt);
    else {
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++)
        if (p.getY(k) > s.h * 0.6) p.setY(k, p.getY(k) + p.getX(k) * s.tilt);
    }
    g.translate(s.x, lying ? s.r * 0.7 : 0, s.z);
    return g;
  });
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

/** The trail's flame walls in a unit box (x across -0.5..0.5, y up 0..1, z
 *  down the lane 0..1): three long walls and `cross` walls across. */
function wallGeometry(cross: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const along: number[] = [];
  const seed: number[] = [];
  const run: number[] = [];
  const index: number[] = [];
  const quad = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    sd: number,
    isRun: number,
    cuts: number,
  ): void => {
    for (let c = 0; c < cuts; c++) {
      const u0 = c / cuts;
      const u1 = (c + 1) / cuts;
      const base = pos.length / 3;
      for (const [u, y] of [
        [u0, 0],
        [u1, 0],
        [u1, 1],
        [u0, 1],
      ]) {
        const x = ax + (bx - ax) * u;
        const z = az + (bz - az) * u;
        pos.push(x, y, z);
        along.push(z);
        seed.push(sd);
        run.push(isRun);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  // The long walls: the trail's spine and its two shoulders.
  quad(0, 0, 0, 1, 0.13, 1, 16);
  quad(-0.3, 0, -0.3, 1, 0.57, 1, 16);
  quad(0.3, 0, 0.3, 1, 0.91, 1, 16);
  // The cross walls: the strip's volume from any side.
  for (let i = 0; i < cross; i++) {
    const z = (i + 0.5) / cross;
    quad(-0.46, z, 0.46, z, 0.2 + i * 0.37, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setAttribute('aRun', new THREE.Float32BufferAttribute(run, 1));
  g.setIndex(index);
  return g;
}

export class TuskerBaitFx {
  private readonly outcrops: OutcropSlot[] = [];
  private readonly trails: TrailSlot[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly window: TelegraphFan;
  private readonly armed: TelegraphFan;
  private readonly paint: TelegraphPaint = { fill: 0, clock: 0, range: 1, fade: 1 };
  private readonly standingSpots: OutcropSpot[] = [];
  private readonly spotPool: OutcropSpot[] = [];
  private readonly laneScratch: TuskerLane = {
    x: 0,
    z: 0,
    yaw: 0,
    length: 0,
    reach: 0,
    outcropId: null,
  };
  private readonly tmpPt = { x: 0, z: 0 };
  private readonly struck = { shove: 0, jitter: 0, cracks: 0 };
  private readonly presence = { front: 0, flames: 0, edge: 0 };
  private tuskerId = -1;
  private windowShown = false;
  private armedShown = false;
  private strainAt = -1e9;
  private frostEmit = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    private readonly host: SanctumFxHost,
    private readonly world: IWorld,
  ) {
    const outcropGeo = outcropGeometry();
    const stumpGeo = stumpGeometry();
    this.geometries.push(outcropGeo, stumpGeo);
    const iceMat = (name: string): THREE.ShaderMaterial => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uTime: { value: 0 },
            uStruck: { value: 0 },
            uArmed: { value: 0 },
            uFlash: { value: 0 },
            uKeyDir: { value: KEY_DIR.clone() },
          },
        ]),
        vertexShader: ICE_VERT,
        fragmentShader: ICE_FRAG,
        fog: true,
        side: THREE.DoubleSide,
      });
      this.materials.push(m);
      return m;
    };
    for (let i = 0; i < BAIT_POOLS.outcrops; i++) {
      const group = new THREE.Group();
      group.name = 'sanctumIceOutcrop';
      group.visible = false;
      const mat = iceMat('sanctumIceOutcrop');
      const stumpMat = iceMat('sanctumIceOutcropStump');
      const whole = new THREE.Mesh(outcropGeo, mat);
      const stump = new THREE.Mesh(stumpGeo, stumpMat);
      for (const mesh of [whole, stump]) {
        mesh.frustumCulled = false;
        mesh.castShadow = host.density >= 1;
        mesh.renderOrder = floorVfxRenderOrder('encounter', 5);
        group.add(mesh);
      }
      stump.visible = false;
      host.root.add(group);
      this.outcrops.push({
        objectId: -1,
        seen: false,
        phase: 'whole',
        applied: false,
        group,
        whole,
        stump,
        mat,
        stumpMat,
        x: 0,
        z: 0,
        y: 0,
        yaw: 0,
        flashAt: -1e9,
        emit: 0,
      });
    }
    // The two rings on the shared kit (every tier): the damage window under a
    // stuck Tusker, and the outcrop a painted lane will end in.
    this.window = host.kit.fan(14);
    this.window.group.name = 'sanctum-tusker-stuck-ring';
    host.kit.layOutFan(this.window, 360, {
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: SANCTUM_ACCENTS.rime,
    });
    this.window.group.visible = false;
    this.armed = host.kit.fan(15);
    this.armed.group.name = 'sanctum-tusker-bait-ring';
    host.kit.layOutFan(this.armed, 360, {
      color: TRAMPLE_AIM_COLORS.bait,
      accent: SANCTUM_ACCENTS.rime,
    });
    this.armed.group.visible = false;
    // The soulfire trails.
    const stripGeo = new THREE.PlaneGeometry(1, 1, 1, 24)
      .rotateX(-Math.PI / 2)
      .translate(0, 0, 0.5);
    const wallGeo = wallGeometry(
      host.density >= 1 ? TRAIL_LOOK.crossWalls : Math.round(TRAIL_LOOK.crossWalls / 3),
    );
    this.geometries.push(stripGeo, wallGeo);
    for (let i = 0; i < BAIT_POOLS.trails; i++) {
      const uniforms = (): Record<string, THREE.IUniform> => ({
        uTime: host.uTime,
        uLength: { value: 1 },
        uWidth: { value: TUSKER_TUNING.trailHalfWidth * 2 },
        uFront: { value: 0 },
        uFlames: { value: 1 },
      });
      const stripMat = new THREE.ShaderMaterial({
        name: 'sanctumSoulfireTrailRiver',
        uniforms: uniforms(),
        vertexShader: STRIP_VERT,
        fragmentShader: STRIP_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const wallMat = new THREE.ShaderMaterial({
        name: 'sanctumSoulfireTrailWalls',
        uniforms: uniforms(),
        vertexShader: WALL_VERT,
        fragmentShader: WALL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        // Over: the walls overlap down the lane, and added they burn out to
        // white on the snow. Laid over, each keeps the soulfire's hue; the
        // river under them and the flame sprites over them carry the glow.
        blending: THREE.NormalBlending,
      });
      this.materials.push(stripMat, wallMat);
      const strip = new THREE.Mesh(stripGeo, stripMat);
      const walls = new THREE.Mesh(wallGeo, wallMat);
      strip.name = 'sanctumSoulfireTrailRiver';
      walls.name = 'sanctumSoulfireTrailWalls';
      strip.renderOrder = floorVfxRenderOrder('encounter', 3);
      // Under the coordinator's particle pools (smoke 6, soulfire 7, glow 8):
      // laid over (normal blending), the walls must never paint over the
      // flame sprites and embers in front of them.
      walls.renderOrder = floorVfxRenderOrder('encounter', 5);
      for (const mesh of [strip, walls]) {
        mesh.frustumCulled = false;
        mesh.visible = false;
        host.root.add(mesh);
      }
      const lane = host.kit.lane(13);
      lane.group.visible = false;
      this.trails.push({
        objectId: -1,
        seen: false,
        since: 0,
        lane,
        strip,
        walls,
        stripMat,
        wallMat,
        emit: 0,
      });
    }
  }

  // ------------------------------------------------------------------- scans

  beginScan(): void {
    for (const o of this.outcrops) o.seen = false;
    for (const t of this.trails) t.seen = false;
    this.tuskerId = -1;
  }

  /** An outcrop or a trail seen by the scan. True when it is one of ours. */
  scanObject(e: Entity): boolean {
    const phase = outcropPhase(e.templateId);
    if (phase !== null) {
      let slot = this.outcrops.find((o) => o.objectId === e.id);
      if (!slot) {
        slot = this.outcrops.find((o) => o.objectId < 0);
        if (!slot) return true;
        slot.objectId = e.id;
        slot.applied = false;
        slot.x = e.pos.x;
        slot.z = e.pos.z;
        slot.y = this.host.groundY(e.pos.x, e.pos.z);
        slot.flashAt = -1e9;
        slot.emit = 0;
        slot.group.position.set(slot.x, slot.y - 0.25, slot.z);
        // Each stands turned its own way (a fixed turn off its spot).
        slot.group.rotation.set(0, (Math.abs(slot.x * 0.37 + slot.z * 0.61) % 1) * Math.PI * 2, 0);
        slot.group.visible = true;
      }
      slot.seen = true;
      this.setPhase(slot, phase);
      return true;
    }
    if (e.templateId !== SANCTUM_SOULFIRE_TRAIL) return false;
    let trail = this.trails.find((t) => t.objectId === e.id);
    if (!trail) {
      trail = this.trails.find((t) => t.objectId < 0);
      if (!trail) return true;
      trail.objectId = e.id;
      trail.since = this.clock;
      trail.emit = 0;
      this.layTrail(trail, e);
    }
    trail.seen = true;
    return true;
  }

  /** A Tusker seen by the scan (the one whose bars and window are drawn). */
  scanTusker(e: Entity): void {
    if (e.templateId !== SLEDGE_TUSKER_ID || e.dead) return;
    this.tuskerId = e.id;
  }

  endScan(): void {
    for (const o of this.outcrops) {
      if (o.objectId < 0 || o.seen) continue;
      o.objectId = -1;
      o.group.visible = false;
    }
    for (const t of this.trails) if (t.objectId >= 0 && !t.seen) this.releaseTrail(t);
  }

  /** The Tusker the scan found (the one whose bars are drawn), or null. */
  currentTusker(): Entity | null {
    if (this.tuskerId < 0) return null;
    return this.world.entities.get(this.tuskerId) ?? null;
  }

  /** The outcrop slots (a negative objectId is a free one): the floor
   *  circles' input (tusker_aim_fx.ts). */
  outcropViews(): readonly OutcropView[] {
    return this.outcrops;
  }

  /** The standing outcrops in view, in the world (the lane plan's input). */
  standing(): readonly OutcropSpot[] {
    // Called every frame of a Trample's bar: the spots are reused.
    const out = this.standingSpots;
    out.length = 0;
    for (const o of this.outcrops) {
      if (o.objectId < 0 || o.phase !== 'whole') continue;
      let spot = this.spotPool[out.length];
      if (!spot) {
        spot = { id: 0, x: 0, z: 0 };
        this.spotPool[out.length] = spot;
      }
      spot.id = o.objectId;
      spot.x = o.x;
      spot.z = o.z;
      out.push(spot);
    }
    return out;
  }

  private setPhase(slot: OutcropSlot, phase: OutcropPhase): void {
    if (slot.phase === phase && slot.applied) return;
    slot.phase = phase;
    slot.applied = true;
    slot.whole.visible = phase !== 'broken';
    slot.stump.visible = phase === 'broken';
    if (phase !== 'struck') {
      slot.group.position.set(slot.x, slot.y - 0.25, slot.z);
      slot.group.rotation.x = 0;
      slot.group.rotation.z = 0;
      slot.mat.uniforms.uStruck.value = 0;
    }
  }

  // ------------------------------------------------------------------ events

  /** The slam and the burst. True when drawn here. */
  handleEvent(ev: SimEvent & { type: 'spellfx' }, src: Entity): boolean {
    if (ev.ability !== TUSKER_TUSKS_STICK && ev.ability !== TUSKER_BREAKS_FREE) return false;
    const slot = this.outcrops.find((o) => o.objectId === ev.targetId);
    const target = this.world.entities.get(ev.targetId);
    const x = slot?.x ?? target?.pos.x ?? src.pos.x;
    const z = slot?.z ?? target?.pos.z ?? src.pos.z;
    const gy = this.host.groundY(x, z);
    const yaw = src.facing;
    if (slot) {
      slot.flashAt = this.clock;
      slot.yaw = yaw;
    }
    if (ev.ability === TUSKER_TUSKS_STICK) this.slam(x, gy, z, yaw);
    else this.burst(x, gy, z, yaw);
    return true;
  }

  /** The tusks go in: ice thrown back at the beast and out to both sides, a
   *  wall of powder, the shock in the road. */
  private slam(x: number, gy: number, z: number, yaw: number): void {
    const host = this.host;
    const back = yaw + Math.PI;
    host.shards.burst(x, gy + 2.2, z, 30, {
      speed: 12,
      up: 8,
      size: [0.5, 1.7],
      heading: back,
      spread: 1.25,
      radius: 1.4,
    });
    host.shards.burst(x, gy + 4.5, z, 16, { speed: 7, up: 10, size: [0.35, 1.1], radius: 1 });
    // The crack of it: a cold flash in the ice, and powder blown off the face.
    host.puff(x, gy + 3, z, 2, {
      speed: 0.3,
      life: 0.3,
      size: [5, 8],
      color: [0.7, 0.92, 1],
      alpha: 0.8,
      pool: 'glow',
    });
    host.puff(x, gy + 3.4, z, 8, {
      speed: 4,
      up: 4,
      life: 1.1,
      size: [0.9, 2.6],
      color: [0.9, 0.95, 1],
      alpha: 0.38,
      drag: 2.4,
      dir: [Math.sin(back) * 0.3, 0.9, Math.cos(back) * 0.3],
      spread: 0.8,
      radius: 1.2,
    });
    host.puff(x, gy + 3.5, z, 34, {
      speed: 9,
      up: 4,
      life: 0.8,
      size: [0.36, 0.06],
      color: rgb(0xd6f3ff),
      alpha: 1,
      pool: 'glow',
      gravity: 9,
      radius: 1.6,
    });
    host.shockRing(x, z, 0xd6f3ff, 9, 0.6);
    host.shockRing(x, z, 0x5ab8ff, 6, 0.45);
    if (!host.reducedMotion()) host.shake(0.7);
  }

  /** It wrenches free: the outcrop bursts, blocks and shards thrown high and
   *  all round, a cloud of powder, the stump left smoking with cold. */
  private burst(x: number, gy: number, z: number, yaw: number): void {
    const host = this.host;
    host.shards.burst(x, gy + 1.5, z, 48, { speed: 13, up: 14, size: [0.7, 2.2], radius: 1.8 });
    host.shards.burst(x, gy + 4.5, z, 30, { speed: 10, up: 10, size: [0.5, 1.5], radius: 1.2 });
    host.shards.burst(x, gy + 6.5, z, 16, { speed: 7, up: 6, size: [0.35, 1.1], radius: 0.8 });
    host.puff(x, gy + 3.5, z, 2, {
      speed: 0.4,
      life: 0.35,
      size: [7, 11],
      color: [0.75, 0.93, 1],
      alpha: 0.85,
      pool: 'glow',
    });
    // A column of powder thrown up where it stood (never a flat bank of fog).
    for (const lift of [1, 3.5, 6]) {
      host.puff(x, gy + lift, z, 7, {
        speed: 3.5,
        up: 5 - lift * 0.4,
        life: 1.7,
        size: [1.2, 3.8],
        color: [0.9, 0.95, 1],
        alpha: 0.4,
        drag: 1.8,
        radius: 1.2,
      });
    }
    host.puff(x, gy + 3, z, 60, {
      speed: 13,
      up: 6,
      life: 1,
      size: [0.4, 0.06],
      color: rgb(0xd6f3ff),
      alpha: 1,
      pool: 'glow',
      gravity: 11,
      radius: 1.8,
    });
    // The beast's head thrown up and back out of it.
    const back = yaw + Math.PI;
    host.puff(x + Math.sin(back) * 3, gy + 3, z + Math.cos(back) * 3, 14, {
      speed: 5,
      up: 3,
      life: 1.4,
      size: [1.4, 4.5],
      color: [0.88, 0.93, 0.98],
      alpha: 0.5,
      drag: 2,
      dir: [Math.sin(back), 0.4, Math.cos(back)],
      spread: 0.5,
    });
    host.shockRing(x, z, 0xeef6fa, 12, 0.75);
    host.shockRing(x, z, 0x7fc4e8, 8, 0.55);
    if (!host.reducedMotion()) host.shake(0.6);
  }

  // ------------------------------------------------------------------- frame

  update(dt: number, clock: number): void {
    if (this.disposed) return;
    this.clock = clock;
    const tusker = this.tuskerId >= 0 ? (this.world.entities.get(this.tuskerId) ?? null) : null;
    this.paintOutcrops(dt, tusker);
    this.paintWindow(dt, tusker);
    for (const t of this.trails) if (t.objectId >= 0) this.paintTrail(t, dt);
  }

  private paintOutcrops(dt: number, tusker: Entity | null): void {
    // The outcrop a painted lane will end in (the sim's own plan).
    let armedId = -1;
    let armedFill = 0;
    const aiming = !!tusker && !tusker.dead && tusker.castingAbility === TUSKER_TRAMPLE;
    if (tusker && aiming) {
      const lane = planTrampleLaneWorld(
        tusker.pos.x,
        tusker.pos.z,
        tusker.facing,
        this.standing(),
        this.laneScratch,
      );
      if (lane.outcropId !== null) {
        armedId = lane.outcropId;
        armedFill = telegraphFillOf(tusker.castRemaining, tusker.castTotal);
      }
    }
    let ringOn = false;
    for (const o of this.outcrops) {
      if (o.objectId < 0) continue;
      const u = o.mat.uniforms;
      u.uTime.value = this.clock;
      const flash = outcropFlash(this.clock - o.flashAt);
      u.uFlash.value = flash * 0.85;
      o.stumpMat.uniforms.uFlash.value = flash * 0.6;
      const isArmed = o.objectId === armedId && o.phase === 'whole';
      const want = isArmed ? 1 : aiming && o.phase === 'whole' ? 0.33 : 0;
      u.uArmed.value += (want - u.uArmed.value) * Math.min(1, dt * 10);
      if (isArmed) {
        ringOn = true;
        this.host.kit.drapeFan(this.armed, this.host.groundY, o.x, o.y, o.z, 0, BAIT_RING_RADIUS);
        this.paint.fill = armedFill;
        this.paint.clock = this.clock;
        this.paint.range = BAIT_RING_RADIUS;
        this.paint.fade = 1;
        this.host.kit.paintFan(this.armed, this.paint);
      }
      if (o.phase !== 'struck') continue;
      // Held: the seconds ride the outcrop's own bar.
      const obj = this.world.entities.get(o.objectId);
      const left =
        obj?.castingAbility === SANCTUM_OUTCROP_HELD
          ? obj.castRemaining
          : TUSKER_TUNING.stuckSeconds;
      const held = TUSKER_TUNING.stuckSeconds - left;
      const s = struckOutcrop(held, left, this.struck);
      u.uStruck.value = s.cracks;
      const jx = Math.sin(this.clock * 61 + o.objectId) * s.jitter;
      const jz = Math.cos(this.clock * 53 + o.objectId * 1.7) * s.jitter;
      o.group.position.set(
        o.x + Math.sin(o.yaw) * s.shove + jx,
        o.y - 0.25,
        o.z + Math.cos(o.yaw) * s.shove + jz,
      );
      o.group.rotation.x = Math.sin(this.clock * 47) * s.jitter * 0.12;
      o.group.rotation.z = Math.cos(this.clock * 43) * s.jitter * 0.12;
      // Chips and frost shaken off it for as long as it holds.
      o.emit += dt * (9 + 26 * s.jitter * 4) * this.host.density;
      while (o.emit >= 1) {
        o.emit -= 1;
        const a = this.host.rand() * Math.PI * 2;
        const r = 0.6 + this.host.rand() * 1.4;
        const up = 1 + this.host.rand() * (OUTCROP_HEIGHT - 2);
        this.host.puff(o.x + Math.cos(a) * r, o.y + up, o.z + Math.sin(a) * r, 1, {
          speed: 0.8,
          up: -0.5,
          life: 1.3,
          size: [0.7, 2.2],
          color: [0.9, 0.95, 1],
          alpha: 0.4,
          gravity: 2.5,
          drag: 1,
        });
        if (this.host.rand() < 0.4)
          this.host.shards.burst(o.x + Math.cos(a) * r, o.y + up, o.z + Math.sin(a) * r, 1, {
            speed: 1.6,
            up: 0.5,
            size: [0.15, 0.4],
          });
      }
    }
    if (ringOn !== this.armedShown) {
      this.armedShown = ringOn;
      this.armed.group.visible = ringOn;
    }
  }

  /** The damage window under a stuck Tusker, the frost off its tusks, its pawing. */
  private paintWindow(dt: number, tusker: Entity | null): void {
    let remaining = 0;
    let duration = 0;
    if (tusker && !tusker.dead) {
      const auras = tusker.auras;
      for (let i = 0; i < auras.length; i++) {
        const a = auras[i];
        if (a.id !== TUSKER_STUCK_EXPOSED) continue;
        remaining = a.remaining;
        duration = a.duration;
      }
    }
    if (!tusker || !(remaining > 0)) {
      if (this.windowShown) {
        this.windowShown = false;
        this.window.group.visible = false;
      }
      this.strainAt = -1e9;
      return;
    }
    const host = this.host;
    const { x, z } = tusker.pos;
    const ring = stuckRing(remaining, duration, this.clock);
    host.kit.drapeFan(this.window, host.groundY, x, host.groundY(x, z), z, 0, STUCK_RING_RADIUS);
    this.paint.fill = ring.fill;
    this.paint.clock = this.clock;
    this.paint.range = STUCK_RING_RADIUS;
    this.paint.fade = ring.fade;
    host.kit.paintFan(this.window, this.paint);
    if (!this.windowShown) {
      this.windowShown = true;
      this.window.group.visible = true;
    }
    // It paws and heaves at the ice.
    if (this.clock - this.strainAt >= STRAIN_EVERY) {
      this.strainAt = this.clock;
      host.gesture(tusker.id, TUSKER_STRAIN_GESTURE);
    }
    // Frost smoking off the buried tusks, and its breath.
    this.frostEmit += dt * 22 * host.density;
    const k = tuskerModelScale(tusker.scale || 1);
    while (this.frostEmit >= 1) {
      this.frostEmit -= 1;
      const side = host.rand() < 0.5 ? -1 : 1;
      const tip = TUSKER_MODEL.tuskTip;
      const p = modelToWorld(
        tusker.pos,
        tusker.facing,
        k,
        side * tip.x * (0.5 + host.rand() * 0.5),
        tip.z * (0.7 + host.rand() * 0.35),
        this.tmpPt,
      );
      const y = host.groundY(p.x, p.z) + tip.y * k * (0.7 + host.rand() * 0.6);
      host.puff(p.x, y, p.z, 1, {
        speed: 0.6,
        up: 1.3,
        life: 1.5,
        size: [0.6, 2.4],
        color: [0.86, 0.95, 1],
        alpha: 0.42,
        drag: 1.2,
      });
      if (host.rand() < 0.5)
        host.puff(p.x, y, p.z, 1, {
          speed: 1.4,
          up: 1.8,
          life: 0.7,
          size: [0.22, 0.05],
          color: rgb(0xbfeaff),
          alpha: 1,
          pool: 'glow',
        });
    }
  }

  private layTrail(t: TrailSlot, e: Entity): void {
    const host = this.host;
    const length = Math.max(0.5, e.scale);
    const yaw = e.facing;
    const x = e.pos.x;
    const z = e.pos.z;
    const y0 = host.groundY(x, z);
    const ex = x + Math.sin(yaw) * length;
    const ez = z + Math.cos(yaw) * length;
    const y1 = host.groundY(ex, ez);
    const pitch = Math.atan2(y1 - y0, length);
    const half = TUSKER_TUNING.trailHalfWidth;
    host.kit.drapeLane(t.lane, host.groundY, x, y0, z, yaw, length, half, {
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: SANCTUM_ACCENTS.soulfire,
    });
    t.lane.group.visible = true;
    // Along the road's own slope, a hand above the ice.
    const run = Math.hypot(length, y1 - y0);
    t.strip.position.set(x, y0 + 0.16, z);
    t.strip.rotation.set(-pitch, yaw, 0, 'YXZ');
    t.strip.scale.set(half * 2, 1, run);
    t.walls.position.set(x, y0 + 0.1, z);
    t.walls.rotation.set(-pitch, yaw, 0, 'YXZ');
    t.walls.scale.set(half * 2, TRAIL_LOOK.flameHeight, run);
    for (const m of [t.stripMat, t.wallMat]) {
      m.uniforms.uLength.value = length;
      m.uniforms.uFront.value = 0;
      m.uniforms.uFlames.value = 1;
    }
    t.strip.visible = true;
    t.walls.visible = true;
  }

  private releaseTrail(t: TrailSlot): void {
    t.objectId = -1;
    t.lane.group.visible = false;
    t.strip.visible = false;
    t.walls.visible = false;
  }

  private paintTrail(t: TrailSlot, dt: number): void {
    const obj = this.world.entities.get(t.objectId);
    if (!obj) {
      this.releaseTrail(t);
      return;
    }
    const host = this.host;
    const total = obj.castingAbility === SANCTUM_TRAIL_BURN ? obj.castTotal : 0;
    const remaining = total > 0 ? obj.castRemaining : TUSKER_TUNING.trailSeconds;
    const p = trailPresence(
      this.clock - t.since,
      remaining,
      total > 0 ? total : TUSKER_TUNING.trailSeconds,
      this.presence,
    );
    t.stripMat.uniforms.uFront.value = p.front;
    t.stripMat.uniforms.uFlames.value = p.flames;
    t.wallMat.uniforms.uFront.value = p.front;
    t.wallMat.uniforms.uFlames.value = p.flames;
    const length = Math.max(0.5, obj.scale);
    // The edge the sim tests, as an outline: the river is the strip's body.
    this.paint.fill = 0;
    this.paint.clock = this.clock;
    this.paint.range = length;
    this.paint.fade = p.edge;
    host.kit.paintLane(t.lane, this.paint);
    // Tongues of soulfire, embers and steam off the ice, along what has caught.
    const lit = length * p.front;
    t.emit += dt * lit * 1.5 * host.density * p.flames;
    const yaw = obj.facing;
    const half = TUSKER_TUNING.trailHalfWidth;
    while (t.emit >= 1) {
      t.emit -= 1;
      const along = host.rand() * lit;
      const side = (host.rand() * 2 - 1) * half * 0.85;
      const x = obj.pos.x + Math.sin(yaw) * along + Math.cos(yaw) * side;
      const z = obj.pos.z + Math.cos(yaw) * along - Math.sin(yaw) * side;
      const gy = host.groundY(x, z);
      host.puff(x, gy + 0.1, z, 1, {
        speed: 0.3,
        up: 2.2,
        life: 0.95,
        size: [2.6, 0.7],
        color: FLAME_HEAT,
        alpha: 1,
        pool: 'soulfire',
      });
      const roll = host.rand();
      if (roll < 0.45)
        host.puff(x, gy + 0.8, z, 1, {
          speed: 0.7,
          up: 4.2,
          life: 1.5,
          size: [0.2, 0.04],
          color: roll < 0.22 ? [0.72, 0.5, 1] : [0.6, 1, 0.75],
          alpha: 1,
          pool: 'glow',
          drag: 0.5,
        });
      else if (roll < 0.62)
        host.puff(x, gy + 0.2, z, 1, {
          speed: 0.4,
          up: 1.6,
          life: 2.6,
          size: [1, 3.6],
          color: [0.86, 0.9, 0.95],
          alpha: 0.22,
          drag: 1,
        });
    }
  }

  hideAll(): void {
    for (const o of this.outcrops) {
      o.objectId = -1;
      o.group.visible = false;
    }
    for (const t of this.trails) this.releaseTrail(t);
    this.window.group.visible = false;
    this.armed.group.visible = false;
    this.windowShown = false;
    this.armedShown = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
