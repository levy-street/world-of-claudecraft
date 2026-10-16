// Ysolei calls the moon (sim: src/sim/encounters/drowned_temple/ysolei_moon.ts;
// plan: temple_moon_core.ts), composed by temple_fx.ts:
//  - the Beckoning Moon: the sky's moon swells and comes close (the shared
//    uniforms of temple_moon_sky.ts), the altar's column of light widens and
//    whitens, silver motes rise round her;
//  - each Moonlight Tear falls as a silver comet onto the island rim (a
//    flash, a ring of light, a splash of moonwater, a camera kick), then
//    ROLLS at her: a sphere of light turning over the slabs, a groove of
//    silver left behind it, and a line on the floor from the tear to her coil
//    (its path, ACTIONABLE: drawn on every tier; the silver catch circle under
//    it is temple_fx.ts's);
//  - a body that stops a tear takes a burst of silver sparks and a ring that
//    flattens against it; a tear that reaches her pours its light into her,
//    and her Moonswell stacks read from afar as a silver crescent over her
//    head and motes round her coil, brighter with every stack;
//  - the Full Moon: her Plenilune Ward is a silver dome round her coil, moon
//    phases turning on it, its CRACKS opening as its absorb drains (the ward's
//    health without the bar, drawn on every tier), while the moon descends
//    over the Falling Moon bar. Broken in time: the dome shatters into moon
//    glass, a white flash, a hard kick, the moon goes dark in eclipse and she
//    dims. Held: a column of moonlight slams down on the island, a silver
//    shockwave races to the rim, the water leaps, the hardest kick, and a
//    faint silver aura stays on her for her Moonborne Might.
//
// Rules (src/render/CLAUDE.md): every mesh, material and particle pool is
// built once here under the gated temple root and collapsed (never hidden)
// until markGated; after it the layer hides while idle. No lights; the idle
// frame allocates nothing (a live burst's particle specs are short-lived
// literals, as in the fracture and Ysolei layers). The low tier sheds the
// particles only. Reduced motion halves the flashes, keeps the moon's swell
// gentler and never kicks the camera. Everything is read off IWorld (her
// bars and auras, the tear objects) and the moon's cues, so offline and
// online look the same.

import * as THREE from 'three';
import { ALTAR_STONE, MOON_ALTAR } from '../../sim/content/drowned_temple_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ, MOBS } from '../../sim/data';
import {
  MOON_TEAR_TEMPLATE,
  MOONGLOW_TEMPLATE,
  YSOLEI_BECKONING_MOON,
  YSOLEI_ECLIPSE,
  YSOLEI_ECLIPSED,
  YSOLEI_FALLING_MOON,
  YSOLEI_ID,
  YSOLEI_MOON_FALLS,
  YSOLEI_MOON_TUNING,
  YSOLEI_MOONBORNE_MIGHT,
  YSOLEI_MOONSWELL,
  YSOLEI_PLENILUNE_WARD,
  YSOLEI_TEAR_ABSORBED,
  YSOLEI_TEAR_CAUGHT,
  YSOLEI_TEAR_LAND,
} from '../../sim/encounters/drowned_temple/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { TelegraphKit } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  DUST_FRAG,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
} from '../hollow_crypt/crypt_fx_particles';
import {
  approach,
  type BurstEnvelope,
  burstEnvelopeInto,
  COMET_SECONDS,
  cometHeight,
  type MoonSkyInput,
  type MoonSkyLook,
  moonShake,
  moonSkyTarget,
  moonswellGlow,
  tearRollAngle,
  wardCrack,
  wardPulseRate,
} from './temple_moon_core';
import { TEMPLE_MOON_SKY } from './temple_moon_sky';

const COLLAPSED = 1e-4;
const SCAN_SEC = 0.4;
/** One slot per tear of the largest wave (heroic): the sim never opens a
 *  second wave while the first still rolls, so a wave never outnumbers it. */
const TEAR_SLOTS = YSOLEI_MOON_TUNING.tearCountHeroic;
const RING_SLOTS = 8;
const FLASH_SLOTS = 6;
/** The rolling tear's drawn radius (1.4 yd across). */
const TEAR_R = 0.7;
/** The altar's column, the moon fall's column (yards). */
const COLUMN_H = 70;
const FALL_H = 150;
const FALL_R = 9;
const FALL_LIFE = 1.8;
/** Seconds the fall's column takes to slam down from the sky. */
const FALL_SLAM = 0.22;

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
`;

const SHEET_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vLocal;
void main() {
  vUv = uv;
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRESNEL_VERT = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

// A column of moonlight (an open cylinder's side): streaks running up it,
// white-hot at the foot, silver to cold blue toward the top.
const COLUMN_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uWhite;
varying vec2 vUv;
${NOISE}
void main() {
  float streak = vnoise(vec2(vUv.x * 34.0, vUv.y * 4.0 - uTime * 3.5));
  float streak2 = vnoise(vec2(vUv.x * 11.0 + 3.0, vUv.y * 1.5 - uTime * 1.2));
  float foot = 1.0 - smoothstep(0.0, 0.45, vUv.y);
  float top = 1.0 - smoothstep(0.55, 1.0, vUv.y);
  vec3 col = mix(vec3(0.62, 0.78, 1.0), vec3(0.95, 0.97, 1.0), 0.4 + 0.6 * uWhite);
  col = mix(col, vec3(1.0), foot * (0.4 + 0.6 * uWhite));
  float a = uAlpha * top * (0.28 + 0.5 * streak + 0.35 * streak2 + foot * 0.6);
  gl_FragColor = vec4(col * (0.85 + 0.6 * streak), a);
  #include <colorspace_fragment>
}
`;

// A comet's streak: a cone wide at the head (the bottom), its tail thinning
// up into the night.
const COMET_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
${NOISE}
void main() {
  float head = 1.0 - smoothstep(0.0, 0.35, vUv.y);
  float flick = vnoise(vec2(vUv.x * 20.0, vUv.y * 6.0 + uTime * 30.0));
  vec3 col = mix(vec3(0.7, 0.85, 1.0), vec3(1.0), head);
  float a = uAlpha * (1.0 - vUv.y) * (0.45 + 0.55 * flick + head);
  gl_FragColor = vec4(col * (1.0 + head), clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// A Moonlight Tear: a sphere of light, a pearly swirl turning inside it (in
// the mesh's own frame, so it ROLLS as the mesh turns), a bright rim.
const TEAR_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vLocal;
${NOISE}
void main() {
  float facing = max(0.0, dot(normalize(vNormalV), normalize(vViewV)));
  float rim = pow(max(1.0 - facing, 0.0), 2.2);
  vec3 p = normalize(vLocal);
  float swirl = vnoise(vec2(atan(p.z, p.x) * 2.2 + p.y * 3.0, p.y * 4.0 + uTime * 0.6));
  float band = smoothstep(0.55, 0.9, swirl);
  vec3 col = mix(vec3(0.72, 0.84, 1.0), vec3(1.0), band);
  col += vec3(0.55, 0.9, 1.0) * rim * 1.4;
  col *= 1.1 + 0.5 * pow(max(facing, 0.0), 3.0);
  gl_FragColor = vec4(col, 0.85 + 0.15 * rim);
  #include <colorspace_fragment>
}
`;

// A tear's path to her, flat on the floor: silver chevrons running toward
// her coil over a soft band (uLen yards long, its far end at her).
const PATH_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uLen;
varying vec2 vUv;
void main() {
  float across = abs(vUv.x - 0.5) * 2.0;
  float along = (1.0 - vUv.y) * uLen;
  float band = 1.0 - smoothstep(0.55, 1.0, across);
  float chev = fract((along - across * 0.6) * 0.5 - uTime * 1.2);
  float arrow = smoothstep(0.0, 0.12, chev) * (1.0 - smoothstep(0.22, 0.42, chev));
  float fadeEnds = smoothstep(0.0, 1.2, along) * (1.0 - smoothstep(uLen - 1.0, uLen, along));
  vec3 col = mix(vec3(0.7, 0.82, 1.0), vec3(1.0), arrow);
  float a = uAlpha * fadeEnds * band * (0.32 + 0.68 * arrow);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// A ring of light flat on the floor (the local radius tells inner from outer).
const RING_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec3 vLocal;
${NOISE}
void main() {
  float r = length(vLocal.xz);
  float band = smoothstep(0.82, 0.93, r) * (1.0 - smoothstep(0.95, 1.0, r));
  float n = vnoise(vec2(atan(vLocal.z, vLocal.x) * 9.0, uTime * 2.0));
  gl_FragColor = vec4(uColor * (1.2 + 0.6 * n), uAlpha * band * (0.65 + 0.35 * n));
  #include <colorspace_fragment>
}
`;

// A flash or an aura on a sphere: uCore 1 blazes at the middle (a flash),
// 0 glows at the rim (an aura, or with a dark colour the eclipse's shroud).
const GLOW_SPHERE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uCore;
uniform vec3 uColor;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vLocal;
void main() {
  float facing = max(0.0, dot(normalize(vNormalV), normalize(vViewV)));
  float core = pow(max(facing, 0.0), 2.5);
  float rim = pow(max(1.0 - facing, 0.0), 2.0);
  float shimmer = 0.85 + 0.15 * sin(uTime * 3.0 + vLocal.y * 4.0);
  float a = uAlpha * mix(rim, core, uCore) * shimmer;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

// The Plenilune Ward: a silver dome, a ring of moon phases turning round it
// (new to full and back), a sheen sweeping over it, and cracks of white
// light opening as uCrack climbs (0 whole, 1 about to break).
const DOME_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uCrack;
uniform float uPulse;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vLocal;
${NOISE}
void main() {
  vec3 p = normalize(vLocal);
  // Seen from inside (a melee player under it) the back faces carry only a
  // faint veil, their own fresnel, so the dome never washes the screen out
  // and the cracks (the ward's health) stay the brightest thing on it.
  float inside = gl_FrontFacing ? 0.0 : 1.0;
  vec3 nrm = normalize(vNormalV) * (gl_FrontFacing ? 1.0 : -1.0);
  float facing = max(0.0, dot(nrm, normalize(vViewV)));
  float rim = pow(max(1.0 - facing, 0.0), 1.8);
  float veil = mix(1.0, 0.22, inside);
  float lon = atan(p.z, p.x);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  vec3 col = vec3(0.7, 0.8, 1.0) * (0.35 + 0.9 * rim);
  float a = (0.12 + 0.55 * rim) * veil;
  // Eight moon phases on a band a third of the way up, turning slowly.
  float turn = lon + uTime * 0.25;
  float cell = 6.2832 / 8.0;
  float id = floor(turn / cell);
  vec2 q = vec2((fract(turn / cell) - 0.5) * cell * 2.4, (lat - 0.42) * 4.2);
  float disc = 1.0 - smoothstep(0.24, 0.29, length(q));
  float phase = mod(id, 8.0) / 8.0;
  float shadowX = (phase * 2.0 - 1.0) * 0.6;
  float lit = 1.0 - smoothstep(0.22, 0.29, length(q - vec2(shadowX, 0.0)));
  float glyph = disc * (0.35 + 0.65 * (1.0 - lit * step(0.01, abs(shadowX))));
  col += vec3(0.9, 0.95, 1.0) * glyph * 1.3;
  a += glyph * 0.5 * veil;
  // The sheen sweeping over it, and the pulse.
  float sheen = smoothstep(0.92, 1.0, sin(lon + lat * 2.0 - uTime * 1.6));
  col += vec3(1.0) * sheen * 0.6;
  a += (sheen * 0.25 + uPulse * 0.08) * veil;
  // Cracks: noise folded into lines, more and brighter as the ward drains.
  float n1 = vnoise(vec2(lon * 3.2, lat * 5.0) + 7.0);
  float n2 = vnoise(vec2(lon * 9.0, lat * 13.0) - 3.0);
  float line = 1.0 - smoothstep(0.0, 0.035 + 0.05 * uCrack, abs(n1 - 0.5) * (0.7 + 0.6 * n2));
  float reach = step(n2, uCrack * 1.15);
  float crack = line * reach * smoothstep(0.02, 0.15, uCrack);
  col = mix(col, vec3(2.0), crack);
  a = max(a, crack * mix(0.95, 0.8, inside));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uAlpha);
  #include <colorspace_fragment>
}
`;

// The Moonswell crescent over her head, flat (read from the camera above):
// a disc minus an offset disc, a soft glow round it.
const CRESCENT_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec3 vLocal;
void main() {
  vec2 p = vLocal.xz / 3.0;
  float outer = 1.0 - smoothstep(0.86, 0.92, length(p));
  float inner = 1.0 - smoothstep(0.7, 0.76, length(p - vec2(0.32, 0.12)));
  float c = outer * (1.0 - inner);
  float glow = (1.0 - smoothstep(0.0, 1.0, length(p))) * 0.25;
  float flick = 0.88 + 0.12 * sin(uTime * 2.3);
  gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * (1.3 + c), uAlpha * (c + glow) * flick);
  #include <colorspace_fragment>
}
`;

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;

/** The moon layer writing TEMPLE_MOON_SKY now (the last to update). */
let skyWriter: object | null = null;

interface Uniform<T> {
  value: T;
}

interface TearSlot {
  objectId: number;
  sphere: THREE.Mesh;
  path: THREE.Mesh;
  pathU: { uTime: Uniform<number>; uAlpha: Uniform<number>; uLen: Uniform<number> };
  lastX: number;
  lastZ: number;
  travelled: number;
  grooveDebt: number;
}

interface CometSlot {
  mesh: THREE.Mesh;
  u: { uTime: Uniform<number>; uAlpha: Uniform<number> };
  targetId: number;
  age: number;
  x: number;
  z: number;
  located: boolean;
}

interface BurstSlot {
  mesh: THREE.Mesh;
  u: { uAlpha: Uniform<number>; uColor: Uniform<THREE.Color> };
  age: number;
  life: number;
  r0: number;
  r1: number;
  peak: number;
}

export class TempleMoonFx {
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly glow: ParticlePool;
  private readonly spray: ParticlePool;
  private readonly density: number;
  private readonly tears: TearSlot[] = [];
  private readonly comets: CometSlot[] = [];
  private readonly rings: BurstSlot[] = [];
  private readonly flashes: BurstSlot[] = [];
  private readonly column: THREE.Mesh;
  private readonly columnU = { uTime: this.uTime, uAlpha: { value: 0 }, uWhite: { value: 0 } };
  private readonly fall: THREE.Mesh;
  private readonly fallU = { uTime: this.uTime, uAlpha: { value: 0 }, uWhite: { value: 1 } };
  private readonly dome: THREE.Mesh;
  private readonly domeU = {
    uTime: this.uTime,
    uAlpha: { value: 0 },
    uCrack: { value: 0 },
    uPulse: { value: 0 },
  };
  private readonly crescent: THREE.Mesh;
  private readonly crescentU = { uTime: this.uTime, uAlpha: { value: 0 } };
  private readonly shroud: THREE.Mesh;
  private readonly shroudU = {
    uTime: this.uTime,
    uAlpha: { value: 0 },
    uCore: { value: 0 },
    uColor: { value: new THREE.Color(0x05070f) },
  };
  private readonly aura: THREE.Mesh;
  private readonly auraU = {
    uTime: this.uTime,
    uAlpha: { value: 0 },
    uCore: { value: 0 },
    uColor: { value: new THREE.Color(0xcfe0ff) },
  };
  private readonly sky: MoonSkyLook = { swell: 0, drop: 0, eclipse: 0 };
  private readonly skyTarget: MoonSkyLook = { swell: 0, drop: 0, eclipse: 0 };
  private readonly skyInput: MoonSkyInput = {
    beckoning: null,
    tears: 0,
    falling: null,
    eclipsedLeft: 0,
    sinceFall: 999,
  };
  private readonly glowIds: number[] = [];
  private bossId: number | null = null;
  private rosterSeen = -1;
  private scan = 0;
  private seed = 23;
  private debt = 0;
  private gated = false;
  private clock = 0;
  private fallAt = -999;
  private fallAge = -1;
  private fallX = 0;
  private fallY = 0;
  private fallZ = 0;
  private columnLevel = 0;
  private pulsePhase = 0;
  private readonly altar = { x: 0, z: 0 };
  private readonly env: BurstEnvelope = { grow: 0, alpha: 0, done: false };
  private domeLevel = 0;
  private wardSeen = false;

  constructor(
    parent: THREE.Group,
    private readonly world: IWorld | undefined,
    private readonly groundY: (x: number, z: number) => number,
    detail: boolean,
    _kit: TelegraphKit,
    private readonly shake?: (amount: number) => void,
    private readonly calm: () => boolean = () => false,
  ) {
    this.root.name = 'drowned-temple-moon-fx';
    parent.add(this.root);
    this.density = detail ? 1 : 0.35;
    const particleMat = (frag: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime },
        vertexShader: PARTICLE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      return m;
    };
    this.glow = new ParticlePool(
      Math.round(2400 * this.density),
      particleMat(GLOW_FRAG, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 8),
    );
    this.spray = new ParticlePool(
      Math.round(900 * this.density),
      particleMat(DUST_FRAG, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 7),
    );
    this.root.add(this.glow.mesh, this.spray.mesh);

    const shader = (
      vert: string,
      frag: string,
      uniforms: Record<string, unknown>,
      additive: boolean,
      side: THREE.Side = THREE.DoubleSide,
    ) => {
      const m = new THREE.ShaderMaterial({
        uniforms: uniforms as Record<string, THREE.IUniform>,
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        side,
      });
      this.materials.push(m);
      return m;
    };
    const geo = <G extends THREE.BufferGeometry>(g: G): G => {
      this.geometries.push(g);
      return g;
    };
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, order: number) => {
      const out = new THREE.Mesh(g, m);
      out.frustumCulled = false;
      out.renderOrder = order;
      out.scale.setScalar(COLLAPSED);
      this.root.add(out);
      return out;
    };
    const cyl = geo(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0));
    const cone = geo(new THREE.CylinderGeometry(0.02, 1, 1, 16, 1, true).translate(0, 0.5, 0));
    const sphere = geo(new THREE.SphereGeometry(1, 32, 16));
    const hemi = geo(new THREE.SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2));
    const ring = geo(new THREE.RingGeometry(0.8, 1, 96).rotateX(-Math.PI / 2));
    // Unit strip along +z from its origin (the path runs from the tear).
    const strip = geo(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5));
    const disc = geo(new THREE.CircleGeometry(3, 64).rotateX(-Math.PI / 2));
    const order = (n: number) => floorVfxRenderOrder('encounter', n);

    // The columns are front faces only: a camera inside one sees through it
    // instead of two full-screen additive layers.
    this.column = mesh(
      cyl,
      shader(SHEET_VERT, COLUMN_FRAG, this.columnU, true, THREE.FrontSide),
      order(9),
    );
    this.fall = mesh(
      cyl,
      shader(SHEET_VERT, COLUMN_FRAG, this.fallU, true, THREE.FrontSide),
      order(10),
    );
    this.dome = mesh(hemi, shader(FRESNEL_VERT, DOME_FRAG, this.domeU, true), order(9));
    this.crescent = mesh(disc, shader(SHEET_VERT, CRESCENT_FRAG, this.crescentU, true), order(9));
    this.shroud = mesh(
      sphere,
      shader(FRESNEL_VERT, GLOW_SPHERE_FRAG, this.shroudU, false, THREE.FrontSide),
      order(6),
    );
    this.aura = mesh(
      sphere,
      shader(FRESNEL_VERT, GLOW_SPHERE_FRAG, this.auraU, true, THREE.FrontSide),
      order(8),
    );
    const tearMat = shader(FRESNEL_VERT, TEAR_FRAG, { uTime: this.uTime }, false, THREE.FrontSide);
    for (let i = 0; i < TEAR_SLOTS; i++) {
      const pathU = { uTime: this.uTime, uAlpha: { value: 0 }, uLen: { value: 1 } };
      this.tears.push({
        objectId: -1,
        sphere: mesh(sphere, tearMat, order(8)),
        path: mesh(strip, shader(SHEET_VERT, PATH_FRAG, pathU, true), order(4)),
        pathU,
        lastX: 0,
        lastZ: 0,
        travelled: 0,
        grooveDebt: 0,
      });
      const u = { uTime: this.uTime, uAlpha: { value: 0 } };
      this.comets.push({
        mesh: mesh(cone, shader(SHEET_VERT, COMET_FRAG, u, true), order(10)),
        u,
        targetId: -1,
        age: -1,
        x: 0,
        z: 0,
        located: false,
      });
    }
    for (let i = 0; i < RING_SLOTS; i++) {
      const u = { uTime: this.uTime, uAlpha: { value: 0 }, uColor: { value: new THREE.Color() } };
      this.rings.push({
        mesh: mesh(ring, shader(SHEET_VERT, RING_FRAG, u, true), order(7)),
        u,
        age: -1,
        life: 1,
        r0: 0,
        r1: 1,
        peak: 1,
      });
    }
    for (let i = 0; i < FLASH_SLOTS; i++) {
      const u = {
        uTime: this.uTime,
        uAlpha: { value: 0 },
        uCore: { value: 1 },
        uColor: { value: new THREE.Color(0xf2f6ff) },
      };
      this.flashes.push({
        mesh: mesh(
          sphere,
          shader(FRESNEL_VERT, GLOW_SPHERE_FRAG, u, true, THREE.FrontSide),
          order(11),
        ),
        u,
        age: -1,
        life: 0.5,
        r0: 0,
        r1: 1,
        peak: 1,
      });
    }
  }

  /** The temple root's gate has linked every program: idle, hide the layer. */
  markGated(): void {
    this.gated = true;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private boss(): EntityView | null {
    if (!this.world || this.bossId === null) return null;
    return this.world.entities.get(this.bossId) ?? null;
  }

  private bodyRadius(): number {
    return MOBS[YSOLEI_ID]?.bodyRadius ?? 8;
  }

  private domeRadius(): number {
    return this.bodyRadius() + 4;
  }

  /** The island's middle (the altar stone) in the world, from her claim
   *  (written into one reused record: read it before the next call). */
  private altarAt(b: EntityView): { x: number; z: number } {
    const o = instanceOrigin(DUNGEONS.drowned_temple.index, instanceSlotForZ(b.pos.z));
    this.altar.x = o.x + ALTAR_STONE.x;
    this.altar.z = o.z + ALTAR_STONE.z;
    return this.altar;
  }

  private rescan(): void {
    const world = this.world;
    if (!world) return;
    const me = world.entities.get(world.playerId);
    let best: EntityView | null = null;
    let bestD = Infinity;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== YSOLEI_ID) continue;
      const d = me ? Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) : 0;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    this.bossId = best?.id ?? null;
    // The tear objects come and go with the roster: walk it only on a change.
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    this.glowIds.length = 0;
    for (const e of world.entities.values()) {
      if (e.templateId === MOONGLOW_TEMPLATE) {
        if (this.glowIds.length < 8) this.glowIds.push(e.id);
        continue;
      }
      if (e.templateId !== MOON_TEAR_TEMPLATE) continue;
      if (this.tears.some((t) => t.objectId === e.id)) continue;
      const slot = this.tears.find((t) => t.objectId < 0);
      if (!slot) continue;
      slot.objectId = e.id;
      slot.lastX = e.pos.x;
      slot.lastZ = e.pos.z;
      slot.travelled = 0;
      slot.grooveDebt = 0;
    }
  }

  /** True when the cue is the moon's (the renderer skips its generic draw). */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx') return false;
    const a = ev.ability;
    if (
      a !== YSOLEI_TEAR_LAND &&
      a !== YSOLEI_TEAR_CAUGHT &&
      a !== YSOLEI_TEAR_ABSORBED &&
      a !== YSOLEI_ECLIPSE &&
      a !== YSOLEI_MOON_FALLS
    )
      return false;
    const world = this.world;
    if (!world) return true;
    if (a === YSOLEI_TEAR_LAND) {
      const c = this.comets.find((k) => k.age < 0) ?? this.comets[0];
      c.targetId = ev.targetId;
      c.age = 0;
      c.located = false;
      // Rescan soon: the tear object arrives with its cue.
      this.rosterSeen = -1;
      this.scan = 0;
      return true;
    }
    if (a === YSOLEI_TEAR_CAUGHT) {
      const p = world.entities.get(ev.targetId);
      if (p) this.caught(p);
      return true;
    }
    const her = world.entities.get(ev.sourceId) ?? world.entities.get(ev.targetId);
    if (!her) return true;
    if (a === YSOLEI_TEAR_ABSORBED) this.absorbed(her);
    else if (a === YSOLEI_ECLIPSE) this.shatter(her);
    else this.moonFalls(her);
    return true;
  }

  private kick(x: number, z: number, near: number, nearR: number, far: number, farR: number): void {
    if (!this.shake || this.calm()) return;
    const me = this.world?.entities.get(this.world.playerId);
    if (!me) return;
    const amount = moonShake(Math.hypot(me.pos.x - x, me.pos.z - z), near, nearR, far, farR);
    if (amount > 0) this.shake(amount);
  }

  private ringAt(
    x: number,
    y: number,
    z: number,
    r0: number,
    r1: number,
    life: number,
    color: number,
    peak = 1,
  ): void {
    const s = this.rings.find((k) => k.age < 0) ?? this.rings[0];
    s.age = 0;
    s.life = life;
    s.r0 = r0;
    s.r1 = r1;
    s.peak = peak;
    s.u.uColor.value.setHex(color);
    s.mesh.position.set(x, y + 0.15, z);
  }

  private flashAt(x: number, y: number, z: number, r0: number, r1: number, life: number): void {
    const s = this.flashes.find((k) => k.age < 0) ?? this.flashes[0];
    s.age = 0;
    s.life = life;
    s.r0 = r0;
    s.r1 = r1;
    s.peak = this.calm() ? 0.5 : 1;
    s.mesh.position.set(x, y, z);
  }

  /** A tear's comet strikes the rim. */
  private impact(x: number, z: number): void {
    const y = this.groundY(x, z);
    const t = this.uTime.value;
    this.flashAt(x, y + 1, z, 1.5, 7, 0.45);
    this.ringAt(x, y, z, 0.5, 7.5, 0.9, 0xdce8ff);
    this.ringAt(x, y, z, 0.3, 4, 0.6, 0x9fe8ff, 0.8);
    const n = Math.round(120 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = 4 + this.rand() * 9;
      this.glow.emit(t, {
        x,
        y: y + 0.3,
        z,
        vx: Math.cos(a) * s,
        vy: 3 + this.rand() * 9,
        vz: Math.sin(a) * s,
        ay: -16,
        drag: 0.9,
        life: 0.7 + this.rand() * 0.6,
        size0: 0.6 + this.rand() * 0.4,
        size1: 0.15,
        spin: 5,
        r: 0.82,
        g: 0.9,
        b: 1,
        a: 1,
      });
    }
    const m = Math.round(60 * this.density);
    for (let i = 0; i < m; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = 2 + this.rand() * 5;
      this.spray.emit(t, {
        x,
        y: y + 0.4,
        z,
        vx: Math.cos(a) * s,
        vy: 5 + this.rand() * 7,
        vz: Math.sin(a) * s,
        ay: -14,
        drag: 0.6,
        life: 0.9 + this.rand() * 0.5,
        size0: 1.3,
        size1: 2.8,
        r: 0.78,
        g: 0.9,
        b: 1,
        a: 0.55,
      });
    }
    this.kick(x, z, 0.3, 25, 0, 0);
  }

  /** A body stopped a tear: silver sparks, a ring flattening against it. */
  private caught(p: EntityView): void {
    const y = this.groundY(p.pos.x, p.pos.z);
    const t = this.uTime.value;
    this.flashAt(p.pos.x, y + 1.1, p.pos.z, 0.8, 3.2, 0.35);
    this.ringAt(p.pos.x, y, p.pos.z, 3.5, 0.6, 0.45, 0xeef4ff);
    const n = Math.round(90 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const e = this.rand() * 1.2;
      const s = 5 + this.rand() * 7;
      this.glow.emit(t, {
        x: p.pos.x,
        y: y + 1.1,
        z: p.pos.z,
        vx: Math.cos(a) * Math.cos(e) * s,
        vy: Math.sin(e) * s,
        vz: Math.sin(a) * Math.cos(e) * s,
        ay: -10,
        drag: 1.4,
        life: 0.45 + this.rand() * 0.4,
        size0: 0.45,
        size1: 0.08,
        spin: 6,
        r: 0.92,
        g: 0.96,
        b: 1,
        a: 1,
      });
    }
    const world = this.world;
    if (world && p.id === world.playerId && this.shake && !this.calm()) this.shake(0.18);
  }

  /** A tear reached her: its light pours into her coil. */
  private absorbed(b: EntityView): void {
    const y = this.groundY(b.pos.x, b.pos.z);
    const t = this.uTime.value;
    const reach = this.bodyRadius() + 1;
    this.flashAt(b.pos.x, y + 9, b.pos.z, 3, 10, 0.6);
    const n = Math.round(110 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const x = b.pos.x + Math.cos(a) * reach;
      const z = b.pos.z + Math.sin(a) * reach;
      const yy = y + 0.5 + this.rand() * 2;
      const life = 0.6 + this.rand() * 0.3;
      this.glow.emit(t, {
        x,
        y: yy,
        z,
        vx: (b.pos.x - x) / life,
        vy: (y + 10 + this.rand() * 6 - yy) / life,
        vz: (b.pos.z - z) / life,
        life,
        size0: 0.4,
        size1: 1,
        r: 0.85,
        g: 0.93,
        b: 1,
        a: 0.95,
      });
    }
  }

  /** The ward broke in time: the dome shatters into moon glass. */
  private shatter(b: EntityView): void {
    const y = this.groundY(b.pos.x, b.pos.z);
    const t = this.uTime.value;
    const R = this.domeRadius();
    this.domeLevel = 0;
    this.flashAt(b.pos.x, y + R * 0.5, b.pos.z, R * 0.6, R * 1.6, 0.7);
    this.ringAt(b.pos.x, y, b.pos.z, R * 0.8, MOON_ALTAR.r, 1.1, 0xe6eeff);
    const n = Math.round(320 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const e = this.rand() * 1.4;
      const s = 8 + this.rand() * 14;
      const hot = this.rand();
      this.glow.emit(t, {
        x: b.pos.x + Math.cos(a) * Math.cos(e) * R,
        y: y + Math.sin(e) * R,
        z: b.pos.z + Math.sin(a) * Math.cos(e) * R,
        vx: Math.cos(a) * Math.cos(e) * s,
        vy: Math.sin(e) * s + 3,
        vz: Math.sin(a) * Math.cos(e) * s,
        ay: -18,
        drag: 0.7,
        life: 0.9 + this.rand() * 0.8,
        size0: 0.5 + this.rand() * 0.6,
        size1: 0.12,
        spin: 9,
        r: 0.78 + 0.22 * hot,
        g: 0.88 + 0.12 * hot,
        b: 1,
        a: 1,
      });
    }
    // Hard beside the dome, softer anywhere on the island.
    const alt = this.altarAt(b);
    const islandR = Math.hypot(alt.x - b.pos.x, alt.z - b.pos.z) + MOON_ALTAR.r + 10;
    this.kick(b.pos.x, b.pos.z, 0.55, R + 6, 0.25, islandR);
  }

  /** The ward held: the moon falls on the island. */
  private moonFalls(b: EntityView): void {
    const alt = this.altarAt(b);
    this.fallAt = this.clock;
    this.fallAge = 0;
    this.fallX = alt.x;
    this.fallZ = alt.z;
    this.fallY = this.groundY(alt.x, alt.z);
    this.domeLevel = 0;
    this.kick(alt.x, alt.z, 0.6, MOON_ALTAR.r + 10, 0.25, MOON_ALTAR.r + 60);
  }

  /** The column's impact (once it has slammed down). */
  private fallImpact(): void {
    const t = this.uTime.value;
    const x = this.fallX;
    const y = this.fallY;
    const z = this.fallZ;
    this.flashAt(x, y + 6, z, 6, 22, 0.8);
    this.ringAt(x, y, z, 3, MOON_ALTAR.r + 2, 1.2, 0xeef4ff);
    this.ringAt(x, y, z, 2, MOON_ALTAR.r * 0.7, 0.8, 0x9fe8ff, 0.8);
    // The water leaps all round the rim.
    const n = Math.round(260 * this.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand() * 0.05;
      const rx = x + Math.cos(a) * (MOON_ALTAR.r + 0.5);
      const rz = z + Math.sin(a) * (MOON_ALTAR.r + 0.5);
      this.spray.emit(t, {
        x: rx,
        y: this.groundY(rx, rz) + 0.2,
        z: rz,
        vx: Math.cos(a) * 3,
        vy: 8 + this.rand() * 9,
        vz: Math.sin(a) * 3,
        ay: -15,
        drag: 0.5,
        life: 1.2 + this.rand() * 0.6,
        size0: 1.8,
        size1: 3.8,
        r: 0.82,
        g: 0.92,
        b: 1,
        a: 0.6,
      });
    }
    const m = Math.round(200 * this.density);
    for (let i = 0; i < m; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = 10 + this.rand() * 16;
      this.glow.emit(t, {
        x,
        y: y + 0.5,
        z,
        vx: Math.cos(a) * s,
        vy: 2 + this.rand() * 6,
        vz: Math.sin(a) * s,
        ay: -6,
        drag: 0.8,
        life: 0.9 + this.rand() * 0.5,
        size0: 0.9,
        size1: 0.2,
        r: 0.85,
        g: 0.92,
        b: 1,
        a: 1,
      });
    }
  }

  update(dt: number, clock: number): void {
    this.clock = clock;
    this.uTime.value = clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.rescan();
    }
    const calm = this.calm();
    const b = this.boss();
    const alive = b !== null && !b.dead;
    let busy = this.glow.lastDeath > clock || this.spray.lastDeath > clock;

    // ---- the sky's moon ----
    const input = this.skyInput;
    input.beckoning = null;
    input.falling = null;
    input.eclipsedLeft = 0;
    input.tears = 0;
    for (const t of this.tears) if (t.objectId >= 0) input.tears++;
    input.sinceFall = clock - this.fallAt;
    let ward: { value: number; value2?: number } | null = null;
    let swellStacks = 0;
    let might = false;
    if (b && alive) {
      const frac = b.castTotal > 0 ? 1 - b.castRemaining / b.castTotal : 1;
      if (b.castingAbility === YSOLEI_BECKONING_MOON) input.beckoning = frac;
      if (b.castingAbility === YSOLEI_FALLING_MOON) input.falling = frac;
      for (const a of b.auras) {
        if (a.id === YSOLEI_ECLIPSED) input.eclipsedLeft = a.remaining;
        else if (a.id === YSOLEI_PLENILUNE_WARD) ward = a;
        else if (a.id === YSOLEI_MOONSWELL) swellStacks = a.stacks ?? 1;
        else if (a.id === YSOLEI_MOONBORNE_MIGHT) might = true;
      }
    }
    const target = moonSkyTarget(input, calm, this.skyTarget);
    const sky = this.sky;
    sky.swell = approach(sky.swell, target.swell, dt, input.falling !== null ? 3 : 1.4);
    sky.drop = approach(sky.drop, target.drop, dt, 1.4);
    sky.eclipse = approach(sky.eclipse, target.eclipse, dt, target.eclipse > sky.eclipse ? 6 : 1.5);
    skyWriter = this;
    TEMPLE_MOON_SKY.swell.value = sky.swell;
    TEMPLE_MOON_SKY.drop.value = sky.drop;
    TEMPLE_MOON_SKY.eclipse.value = sky.eclipse;
    if (sky.swell > 0 || sky.drop > 0 || sky.eclipse > 0) busy = true;

    // ---- the altar's column, widened and whitened by the call ----
    const calling = input.beckoning !== null;
    this.columnLevel = approach(this.columnLevel, calling ? 1 : 0, dt, calling ? 3 : 0.8);
    if (b && this.columnLevel > 0.01) {
      busy = true;
      const alt = this.altarAt(b);
      this.column.position.set(alt.x, this.groundY(alt.x, alt.z), alt.z);
      const w = 2.4 + 2.6 * this.columnLevel;
      this.column.scale.set(w, COLUMN_H, w);
      this.columnU.uAlpha.value = this.columnLevel * (calm ? 0.6 : 1);
      this.columnU.uWhite.value = this.columnLevel;
      if (calling) this.motes(b, dt, 70);
    } else {
      this.columnU.uAlpha.value = 0;
      this.column.scale.setScalar(COLLAPSED);
    }

    busy = this.updateComets(dt) || busy;
    busy = this.updateTears(dt, b) || busy;
    busy = this.updateWard(dt, b, ward) || busy;
    busy = this.updateSwell(dt, b, alive ? swellStacks : 0, alive && might) || busy;
    busy = this.updateFall(dt) || busy;
    busy = this.stepBursts(this.rings, dt, true) || busy;
    busy = this.stepBursts(this.flashes, dt, false) || busy;
    if (this.glowIds.length > 0) busy = this.moonglowMotes(dt) || busy;

    // Her scales dim in eclipse.
    if (b && input.eclipsedLeft > 0) {
      busy = true;
      const R = this.domeRadius();
      this.shroud.position.set(b.pos.x, this.groundY(b.pos.x, b.pos.z) + R * 0.45, b.pos.z);
      this.shroud.scale.set(R * 0.9, R * 0.75, R * 0.9);
      this.shroudU.uAlpha.value = Math.min(1, input.eclipsedLeft / 1.5) * 0.55;
    } else {
      this.shroudU.uAlpha.value = 0;
      this.shroud.scale.setScalar(COLLAPSED);
    }
    this.glow.update(clock);
    this.spray.update(clock);
    // Until the gate has linked the layer it stays drawn (collapsed); after,
    // an idle layer is hidden so it costs no draw anywhere in the world.
    this.root.visible = !this.gated || busy;
  }

  /** Silver motes rising round her coil. */
  private motes(b: EntityView, dt: number, rate: number): void {
    this.debt += rate * this.density * dt;
    const y = this.groundY(b.pos.x, b.pos.z);
    const R = this.domeRadius();
    while (this.debt >= 1) {
      this.debt -= 1;
      const a = this.rand() * Math.PI * 2;
      const r = R * (0.5 + this.rand() * 0.7);
      this.glow.emit(this.uTime.value, {
        x: b.pos.x + Math.cos(a) * r,
        y: y + 0.3 + this.rand() * 2,
        z: b.pos.z + Math.sin(a) * r,
        vx: 0,
        vy: 2.5 + this.rand() * 4,
        vz: 0,
        life: 1.4 + this.rand() * 0.8,
        size0: 0.45,
        size1: 0.15,
        r: 0.82,
        g: 0.9,
        b: 1,
        a: 0.9,
      });
    }
  }

  private updateComets(dt: number): boolean {
    let busy = false;
    const world = this.world;
    for (const c of this.comets) {
      if (c.age < 0) continue;
      busy = true;
      if (!c.located) {
        const obj = world?.entities.get(c.targetId);
        if (obj) {
          c.x = obj.pos.x;
          c.z = obj.pos.z;
          c.located = true;
          c.age = 0;
        } else {
          // Its tear never arrived (out of interest range): drop the comet.
          c.age += dt;
          if (c.age > 0.5) c.age = -1;
          continue;
        }
      }
      const before = c.age;
      c.age += dt;
      const y = this.groundY(c.x, c.z);
      if (c.age < COMET_SECONDS) {
        const h = cometHeight(c.age);
        c.mesh.position.set(c.x, y + h, c.z);
        c.mesh.scale.set(0.9, 16, 0.9);
        c.u.uAlpha.value = 1;
        // Its trail of silver sparks.
        const n = Math.round(10 * this.density);
        for (let i = 0; i < n; i++)
          this.glow.emit(this.uTime.value, {
            x: c.x + (this.rand() - 0.5) * 0.8,
            y: y + h + this.rand() * 6,
            z: c.z + (this.rand() - 0.5) * 0.8,
            vx: (this.rand() - 0.5) * 2,
            vy: 2,
            vz: (this.rand() - 0.5) * 2,
            life: 0.5 + this.rand() * 0.3,
            size0: 0.7,
            size1: 0.1,
            r: 0.85,
            g: 0.92,
            b: 1,
            a: 1,
          });
        continue;
      }
      if (before < COMET_SECONDS) this.impact(c.x, c.z);
      // The streak fades out into the impact.
      const fade = 1 - (c.age - COMET_SECONDS) / 0.25;
      if (fade <= 0) {
        c.age = -1;
        c.u.uAlpha.value = 0;
        c.mesh.scale.setScalar(COLLAPSED);
        continue;
      }
      c.mesh.position.set(c.x, y, c.z);
      c.mesh.scale.set(0.9 * fade, 16 * fade, 0.9 * fade);
      c.u.uAlpha.value = fade;
    }
    return busy;
  }

  private updateTears(dt: number, b: EntityView | null): boolean {
    const world = this.world;
    let busy = false;
    const reach = this.bodyRadius() + 1;
    for (const t of this.tears) {
      if (t.objectId < 0) continue;
      const obj = world?.entities.get(t.objectId);
      if (!obj || obj.templateId !== MOON_TEAR_TEMPLATE) {
        t.objectId = -1;
        t.sphere.scale.setScalar(COLLAPSED);
        t.path.scale.setScalar(COLLAPSED);
        t.pathU.uAlpha.value = 0;
        continue;
      }
      busy = true;
      const x = obj.pos.x;
      const z = obj.pos.z;
      const step = Math.hypot(x - t.lastX, z - t.lastZ);
      t.travelled += step;
      const heading = b ? Math.atan2(b.pos.x - x, b.pos.z - z) : obj.facing;
      const y = this.groundY(x, z);
      // The sphere rolls over the slabs toward her.
      t.sphere.position.set(x, y + TEAR_R + 0.05 * Math.sin(this.clock * 6), z);
      t.sphere.scale.setScalar(TEAR_R);
      t.sphere.rotation.set(tearRollAngle(t.travelled, TEAR_R), heading, 0, 'YXZ');
      // Its path to her coil, every tier.
      if (b) {
        const len = Math.max(0.5, Math.hypot(b.pos.x - x, b.pos.z - z) - reach);
        t.path.position.set(x, y + 0.06, z);
        t.path.rotation.set(0, heading, 0);
        t.path.scale.set(0.7, 1, len);
        t.pathU.uLen.value = len;
        t.pathU.uAlpha.value = Math.min(1, t.pathU.uAlpha.value + dt * 3);
      } else t.path.scale.setScalar(COLLAPSED);
      // The silver groove it leaves on the stones.
      t.grooveDebt += step * 5 * this.density;
      while (t.grooveDebt >= 1) {
        t.grooveDebt -= 1;
        this.glow.emit(this.uTime.value, {
          x: x + (this.rand() - 0.5) * 0.5,
          y: y + 0.08,
          z: z + (this.rand() - 0.5) * 0.5,
          vx: 0,
          vy: 0.05,
          vz: 0,
          life: 3 + this.rand(),
          size0: 0.75,
          size1: 0.3,
          r: 0.78,
          g: 0.88,
          b: 1,
          a: 0.75,
        });
      }
      // A few motes shed off the sphere itself.
      if (this.rand() < 0.5 * this.density)
        this.glow.emit(this.uTime.value, {
          x: x + (this.rand() - 0.5),
          y: y + TEAR_R * (0.5 + this.rand()),
          z: z + (this.rand() - 0.5),
          vx: 0,
          vy: 1.2,
          vz: 0,
          life: 0.8,
          size0: 0.3,
          size1: 0.05,
          r: 0.9,
          g: 0.95,
          b: 1,
          a: 0.9,
        });
      t.lastX = x;
      t.lastZ = z;
    }
    return busy;
  }

  private updateWard(
    dt: number,
    b: EntityView | null,
    ward: { value: number; value2?: number } | null,
  ): boolean {
    this.domeLevel = approach(this.domeLevel, ward ? 1 : 0, dt, ward ? 4 : 2);
    if (!b || this.domeLevel <= 0.01) {
      this.domeU.uAlpha.value = 0;
      this.dome.scale.setScalar(COLLAPSED);
      this.wardSeen = false;
      return false;
    }
    const R = this.domeRadius();
    const y = this.groundY(b.pos.x, b.pos.z);
    if (ward && !this.wardSeen) {
      // The dome blooms up round her.
      this.wardSeen = true;
      this.ringAt(b.pos.x, y, b.pos.z, 1, R + 1, 0.8, 0xdce8ff);
      this.flashAt(b.pos.x, y + 4, b.pos.z, 2, R, 0.5);
    }
    const crack = ward ? wardCrack(ward.value, ward.value2) : 1;
    this.dome.position.set(b.pos.x, y - 0.2, b.pos.z);
    this.dome.scale.set(R, R * 0.85, R);
    this.domeU.uAlpha.value = this.domeLevel;
    this.domeU.uCrack.value = crack;
    // The pulse's phase runs on its own clock: a quicker rate as it cracks
    // never jumps it (no strobe), and reduced motion keeps it slow and low.
    const calm = this.calm();
    this.pulsePhase = (this.pulsePhase + wardPulseRate(crack, calm) * dt) % (Math.PI * 2);
    this.domeU.uPulse.value = (0.5 + 0.5 * Math.sin(this.pulsePhase)) * (calm ? 0.5 : 1);
    // Light weeping from the cracks as they open.
    if (crack > 0.15 && this.rand() < crack * this.density) {
      const a = this.rand() * Math.PI * 2;
      const e = this.rand() * 1.2;
      this.glow.emit(this.uTime.value, {
        x: b.pos.x + Math.cos(a) * Math.cos(e) * R,
        y: y + Math.sin(e) * R * 0.85,
        z: b.pos.z + Math.sin(a) * Math.cos(e) * R,
        vx: Math.cos(a) * 1.5,
        vy: 0.5,
        vz: Math.sin(a) * 1.5,
        life: 0.7,
        size0: 0.5,
        size1: 0.1,
        r: 1,
        g: 1,
        b: 1,
        a: 1,
      });
    }
    return true;
  }

  /** Her Moonswell crescent and motes, and the Moonborne Might's faint aura. */
  private updateSwell(dt: number, b: EntityView | null, stacks: number, might: boolean): boolean {
    let busy = false;
    const glow = moonswellGlow(stacks);
    if (b && glow > 0) {
      busy = true;
      const y = this.groundY(b.pos.x, b.pos.z);
      this.crescent.position.set(b.pos.x, y + 24, b.pos.z);
      this.crescent.rotation.set(0, this.clock * 0.3, 0);
      this.crescent.scale.setScalar(1.4 + 0.25 * stacks);
      this.crescentU.uAlpha.value = glow;
      this.motes(b, dt, 6 * stacks);
    } else {
      this.crescentU.uAlpha.value = 0;
      this.crescent.scale.setScalar(COLLAPSED);
    }
    if (b && might) {
      busy = true;
      const R = this.domeRadius();
      this.aura.position.set(b.pos.x, this.groundY(b.pos.x, b.pos.z) + R * 0.45, b.pos.z);
      this.aura.scale.set(R * 0.95, R * 0.8, R * 0.95);
      this.auraU.uAlpha.value = 0.35 + 0.1 * Math.sin(this.clock * 2);
    } else {
      this.auraU.uAlpha.value = 0;
      this.aura.scale.setScalar(COLLAPSED);
    }
    return busy;
  }

  /** The column of moonlight slamming down on the island. */
  private updateFall(dt: number): boolean {
    if (this.fallAge < 0) return false;
    const before = this.fallAge;
    this.fallAge += dt;
    if (before < FALL_SLAM && this.fallAge >= FALL_SLAM) this.fallImpact();
    if (this.fallAge >= FALL_LIFE) {
      this.fallAge = -1;
      this.fallU.uAlpha.value = 0;
      this.fall.scale.setScalar(COLLAPSED);
      return false;
    }
    // It comes down from the sky: the foot drops to the island in FALL_SLAM.
    const k = Math.min(1, this.fallAge / FALL_SLAM);
    const foot = this.fallY + FALL_H * (1 - k);
    const fade =
      this.fallAge < FALL_SLAM ? 1 : 1 - (this.fallAge - FALL_SLAM) / (FALL_LIFE - FALL_SLAM);
    const w = FALL_R * (1 + 0.25 * Math.sin(Math.min(1, this.fallAge * 2) * Math.PI));
    this.fall.position.set(this.fallX, foot, this.fallZ);
    this.fall.scale.set(w, Math.max(COLLAPSED, this.fallY + FALL_H - foot + 20), w);
    this.fallU.uAlpha.value = Math.max(0, fade) * (this.calm() ? 0.6 : 1);
    return true;
  }

  private stepBursts(slots: BurstSlot[], dt: number, flat: boolean): boolean {
    let busy = false;
    for (const s of slots) {
      if (s.age < 0) continue;
      s.age += dt;
      const env = burstEnvelopeInto(s.age, s.life, this.env);
      if (env.done) {
        s.age = -1;
        s.u.uAlpha.value = 0;
        s.mesh.scale.setScalar(COLLAPSED);
        continue;
      }
      busy = true;
      const r = s.r0 + (s.r1 - s.r0) * env.grow;
      if (flat) s.mesh.scale.set(r, 1, r);
      else s.mesh.scale.setScalar(r);
      s.u.uAlpha.value = env.alpha * s.peak;
    }
    return busy;
  }

  /** Heroic: the moonlight a stopped tear leaves, glimmering. */
  private moonglowMotes(dt: number): boolean {
    const world = this.world;
    let any = false;
    for (const id of this.glowIds) {
      const o = world?.entities.get(id);
      if (!o || o.templateId !== MOONGLOW_TEMPLATE) continue;
      any = true;
      if (this.rand() > 12 * this.density * dt) continue;
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * o.scale;
      this.glow.emit(this.uTime.value, {
        x: o.pos.x + Math.cos(a) * r,
        y: this.groundY(o.pos.x, o.pos.z) + 0.2,
        z: o.pos.z + Math.sin(a) * r,
        vx: 0,
        vy: 1.5,
        vz: 0,
        life: 1,
        size0: 0.5,
        size1: 0.1,
        r: 0.85,
        g: 0.92,
        b: 1,
        a: 0.9,
      });
    }
    return any;
  }

  dispose(): void {
    this.root.removeFromParent();
    // The sky's moon is a module singleton: settle it home only if this layer
    // is still the one writing it (a newer layer rewrites it every frame).
    if (skyWriter === this) {
      skyWriter = null;
      TEMPLE_MOON_SKY.swell.value = 0;
      TEMPLE_MOON_SKY.drop.value = 0;
      TEMPLE_MOON_SKY.eclipse.value = 0;
    }
    this.glow.dispose();
    this.spray.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
