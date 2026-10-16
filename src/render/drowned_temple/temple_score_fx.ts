// Choirmother Selthe's Score in the Choir Court (sim: src/sim/encounters/
// drowned_temple/selthe_score.ts; the plan: temple_score_fx_core.ts), composed
// by temple_fx.ts. A singer answered in moonlight over water:
//  - the five moon tiles: discs of moonlight on the court floor. Dormant they
//    are a thin rim; a tile that rings its note fills like a full moon under a
//    pillar of light while a thread of song runs to it from her mouth and
//    ripples run out over the floor; a tile of the melody keeps its PLACE on
//    it (pips on the disc, a numeral in the air); the tile the answer wants
//    is called out by rings closing on it and a beacon; a tile stepped in its
//    turn flares and stays a warm full moon; one stepped out of turn is
//    struck through with a cross and throws dark spray;
//  - her ward: a wall of moonwater standing round her pool while she sings,
//    sinking with the verse's own clock;
//  - her broken voice: the water round her collapses, a burst of light breaks
//    at her mouth and a ring of spray runs out over the court;
//  - Discord: a wall of sour water rolls from her to the court's rim.
//
// The tiles' footprint, their pips, numerals, call-out and pillars are
// ACTIONABLE (they are the order the group must step) and draw on every tier,
// with a shape for every state so nothing is read by colour alone; only the
// motes, the spray and the ripples shed density on the low tier.
//
// State is read off IWorld only: the tile objects (their template id is their
// state and place), her bar and the spellfx cues, so offline and online look
// the same. Rules (src/render/CLAUDE.md): every mesh and material is built
// once here, under the gated temple root and collapsed until that gate has
// linked them; after it the whole layer is hidden while no tile stands and
// nothing plays (no idle draws anywhere in the world). No lights; the idle
// frame allocates nothing (a live burst's particle specs are short-lived
// literals, as in the caster and fracture layers). Reduced motion stills the
// call-out and halves the flashes; the camera kicks ride the renderer's own
// reduced-motion gate.

import * as THREE from 'three';
import {
  moonTileOf,
  SELTHE_BROKEN_VOICE,
  SELTHE_DISCORD,
  SELTHE_FALSE_NOTE,
  SELTHE_ID,
  SELTHE_SCORE,
  SELTHE_TILE_NOTE,
  SELTHE_TILE_SOUNDED,
  SELTHE_TUNING,
  SELTHE_VOICE_BREAKS,
} from '../../sim/encounters/drowned_temple/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { GLOW_FRAG, PARTICLE_VERT, ParticlePool } from '../hollow_crypt/crypt_fx_particles';
import {
  BEACON_HEIGHT,
  DISCORD_REACH,
  type DiscordWave,
  discordWave,
  type MoonTileLook,
  moonTileLook,
  NOTE_PILLAR_HEIGHT,
  NUMERAL_HEIGHT,
  NUMERAL_SIZE,
  newMoonTileLook,
  numeralStrokes,
  PIP_RADIUS,
  PIP_RING,
  scoreSinging,
  scoreVeilLevel,
  VOICE_BREAK_REACH,
  VOICE_BREAK_SECONDS,
} from './temple_score_fx_core';
import { SPRAY_FRAG } from './temple_selthe_fx';

const COLLAPSED = 1e-4;
const SCAN_SEC = 0.25;
const TILE_SLOTS = SELTHE_TUNING.scoreTileCount;
const RIPPLE_SLOTS = 8;
/** The disc's quad reaches past the tile's rim for its halo (tile radii). */
const DISC_REACH = 1.36;
/** Her mouth over her pool (her drawn 9 yd body), where the song leaves her. */
const MOUTH_UP = 6.9;
/** Her ward's water: its radius and full height (yards). */
const VEIL_RADIUS = 4.6;
const VEIL_HEIGHT = 8;
const THREAD_LIFE = 0.5;
const RIPPLE_LIFE = 1.1;
const BURST_LIFE = 0.55;

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
`;

const FLAT_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// One moon tile, in tile radii (the rim at 1). Normal blending, so the dark
// collar round each pip and the struck cross read on a bright court floor.
const DISC_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uGlow;
uniform float uRim;
uniform float uFill;
uniform float uPips;
uniform float uCall;
uniform float uSour;
uniform float uWarm;
uniform float uFlash;
uniform float uFade;
uniform float uCalm;
uniform float uSeed;
varying vec2 vP;
${NOISE}
void main() {
  float r = length(vP);
  vec3 silver = vec3(0.7, 0.86, 1.0);
  vec3 gold = vec3(1.0, 0.9, 0.6);
  vec3 tint = mix(silver, gold, uWarm);
  float inside = 1.0 - smoothstep(0.95, 1.0, r);
  // The rim: a crisp outer ring and a fine inner one.
  float rim = (1.0 - smoothstep(0.0, 0.05, abs(r - 0.94)))
    + 0.55 * (1.0 - smoothstep(0.0, 0.022, abs(r - 0.82)));
  float halo = (1.0 - smoothstep(0.94, ${DISC_REACH.toFixed(2)}, r)) * step(0.94, r);
  // The moon's own face, and water light swimming over it.
  float face = vnoise(vP * 3.1 + uSeed) * 0.6 + vnoise(vP * 7.3 - uSeed) * 0.4;
  float moon = inside * (0.6 + 0.4 * smoothstep(0.3, 0.75, face));
  float caustic = vnoise(vP * 4.0 + vec2(uTime * 0.4, -uTime * 0.3));
  vec3 col = tint * (uRim * rim * 1.25 + uGlow * halo * 0.6);
  float alpha = uRim * rim * 0.9 + uGlow * halo * 0.38;
  col += tint * inside * uGlow * 0.22 * (0.6 + 0.4 * caustic);
  alpha = max(alpha, inside * uGlow * 0.24);
  col = mix(col, tint * moon * (0.78 + 0.3 * caustic), uFill * inside);
  alpha = max(alpha, moon * uFill * 0.86);
  // The call-out: rings closing on the centre (motion, not colour).
  float t = uCalm > 0.5 ? 0.0 : uTime;
  float band = 1.0 - smoothstep(0.0, 0.17, abs(fract(r * 2.4 + t * 1.15) - 0.5));
  float beat = uCalm > 0.5 ? 1.0 : 0.74 + 0.26 * sin(uTime * 8.8);
  col += vec3(0.85, 1.0, 1.0) * band * inside * uCall * beat;
  alpha = max(alpha, band * inside * uCall * 0.72 * beat);
  // Sour: struck through with a cross, its glass cracked.
  float crack = 1.0 - smoothstep(0.0, 0.06, abs(vnoise(vP * 2.6 + 9.0) - 0.5));
  float x1 = abs(vP.x - vP.y) * 0.7071;
  float x2 = abs(vP.x + vP.y) * 0.7071;
  float struck = (1.0 - smoothstep(0.07, 0.11, min(x1, x2))) * (1.0 - smoothstep(0.74, 0.8, r));
  vec3 sour = vec3(0.86, 0.16, 0.42) * (0.75 + 0.6 * crack);
  col = mix(col, sour, uSour * inside * 0.88);
  alpha = max(alpha, uSour * inside * 0.78);
  col = mix(col, vec3(1.0, 0.86, 0.92), struck * uSour);
  alpha = max(alpha, struck * uSour);
  // The place: pips like a die's face, each in a dark collar.
  float count = floor(uPips + 0.5);
  float pip = 0.0;
  float collar = 0.0;
  float turn = count < 2.5 ? 1.5708 : (count > 3.5 ? 0.7854 : 0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    if (fi < count) {
      float ang = 6.2832 * fi / max(count, 1.0) + turn;
      vec2 c = count < 1.5 ? vec2(0.0) : vec2(sin(ang), cos(ang)) * ${PIP_RING.toFixed(3)};
      float d = length(vP - c);
      pip = max(pip, 1.0 - smoothstep(${PIP_RADIUS.toFixed(3)}, ${(PIP_RADIUS + 0.03).toFixed(3)}, d));
      collar = max(collar, 1.0 - smoothstep(${(PIP_RADIUS + 0.05).toFixed(3)}, ${(PIP_RADIUS + 0.11).toFixed(3)}, d));
    }
  }
  col = mix(col, vec3(0.02, 0.05, 0.1), collar * 0.9);
  alpha = max(alpha, collar * 0.9);
  col = mix(col, vec3(1.0), pip);
  alpha = max(alpha, pip);
  // A step's flare.
  col = mix(col, vec3(1.0, 0.98, 0.9), uFlash * inside * 0.82);
  alpha = max(alpha, uFlash * (inside * 0.82 + halo * 0.6));
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uFade);
  #include <colorspace_fragment>
}
`;

// The numeral standing over a tile: a camera-facing plate, the digit drawn in
// strokes (temple_score_fx_core numeralStrokes) on a dark ground.
const NUMERAL_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vQ;
void main() {
  vQ = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;
const NUMERAL_FRAG = /* glsl */ `
precision highp float;
uniform vec4 uStrokeA;
uniform vec4 uStrokeB;
uniform float uAlpha;
uniform float uWarm;
varying vec2 vQ;
float stroke(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return 1.0 - smoothstep(0.05, 0.07, length(pa - ba * h));
}
void main() {
  vec2 q = vQ;
  // The plate: a rounded tablet with a bright edge.
  vec2 box = abs(q) - vec2(0.3, 0.52);
  float sd = length(max(box, 0.0)) + min(max(box.x, box.y), 0.0) - 0.1;
  float plate = 1.0 - smoothstep(0.0, 0.02, sd);
  float edge = 1.0 - smoothstep(0.0, 0.025, abs(sd + 0.03));
  const float X = 0.18;
  const float Y = 0.36;
  float ink = 0.0;
  ink = max(ink, uStrokeA.x * stroke(q, vec2(-X, Y), vec2(X, Y)));
  ink = max(ink, uStrokeA.y * stroke(q, vec2(X, Y), vec2(X, 0.0)));
  ink = max(ink, uStrokeA.z * stroke(q, vec2(X, 0.0), vec2(X, -Y)));
  ink = max(ink, uStrokeA.w * stroke(q, vec2(-X, -Y), vec2(X, -Y)));
  ink = max(ink, uStrokeB.x * stroke(q, vec2(-X, 0.0), vec2(-X, -Y)));
  ink = max(ink, uStrokeB.y * stroke(q, vec2(-X, Y), vec2(-X, 0.0)));
  ink = max(ink, uStrokeB.z * stroke(q, vec2(-X, 0.0), vec2(X, 0.0)));
  ink = max(ink, uStrokeB.w * stroke(q, vec2(0.0, Y), vec2(0.0, -Y)));
  ink = max(ink, uStrokeB.w * stroke(q, vec2(-0.13, Y - 0.15), vec2(0.0, Y)));
  vec3 tint = mix(vec3(0.72, 0.88, 1.0), vec3(1.0, 0.9, 0.6), uWarm);
  vec3 col = mix(vec3(0.02, 0.05, 0.11), tint, edge * 0.9);
  col = mix(col, vec3(1.0), ink);
  float a = max(plate * 0.82, ink);
  gl_FragColor = vec4(col, a * uAlpha);
  #include <colorspace_fragment>
}
`;

const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A column of moonlight over a tile: additive, bright at the foot.
const PILLAR_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uWarm;
varying vec2 vUv;
${NOISE}
void main() {
  float streak = vnoise(vec2(vUv.x * 22.0, vUv.y * 3.0 - uTime * 5.0));
  float foot = 1.0 - vUv.y;
  vec3 col = mix(vec3(0.6, 0.86, 1.0), vec3(1.0, 0.92, 0.66), uWarm);
  col = mix(col, vec3(1.0), foot * foot * 0.6);
  gl_FragColor = vec4(col * (0.7 + 0.7 * streak), uAlpha * foot * foot * (0.4 + 0.6 * streak));
  #include <colorspace_fragment>
}
`;

// A ripple running out over the floor (a flat ring, additive).
const RIPPLE_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
uniform float uWarm;
uniform float uSour;
varying vec2 vP;
void main() {
  float r = length(vP);
  float band = 1.0 - smoothstep(0.0, 0.05, abs(r - 0.95));
  vec3 col = mix(vec3(0.66, 0.9, 1.0), vec3(1.0, 0.9, 0.62), uWarm);
  col = mix(col, vec3(0.78, 0.2, 0.9), uSour);
  gl_FragColor = vec4(col, uAlpha * band);
  #include <colorspace_fragment>
}
`;

// A wall of water on a full ring (her ward, and Discord's rolling wave).
const VEIL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uSour;
varying vec2 vUv;
${NOISE}
void main() {
  float n = vnoise(vec2(vUv.x * 46.0, vUv.y * 3.0 - uTime * 3.2));
  float m = vnoise(vec2(vUv.x * 16.0 + uTime * 0.6, vUv.y * 5.0 - uTime * 1.6));
  vec3 body = mix(vec3(0.03, 0.24, 0.4), vec3(0.2, 0.72, 0.88), vUv.y * (0.55 + 0.5 * m));
  // Moonlight caught in the falling water.
  body += vec3(0.55, 0.86, 1.0) * m * m * m * 0.9;
  float crest = smoothstep(0.6, 0.95, vUv.y + (n - 0.5) * 0.35);
  vec3 col = mix(body, vec3(0.94, 0.99, 1.0), crest);
  // Discord sours it: bruised violet, torn white.
  vec3 sour = mix(vec3(0.2, 0.03, 0.34), vec3(0.86, 0.46, 1.0), crest + 0.3 * n);
  col = mix(col, sour, uSour);
  // Thin enough to see her through it; the crest and the streaks carry it.
  float a = uAlpha * (0.14 + 0.22 * vUv.y + 0.5 * crest + 0.22 * n * n)
    * (1.0 - smoothstep(0.93, 1.0, vUv.y) * 0.85);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// The thread of song from her mouth to the tile that rings (additive).
const THREAD_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
${NOISE}
void main() {
  float streak = vnoise(vec2(vUv.x * 8.0, vUv.y * 14.0 - uTime * 26.0));
  vec3 col = mix(vec3(0.6, 0.9, 1.0), vec3(1.0), streak);
  gl_FragColor = vec4(col, uAlpha * (0.35 + 0.65 * streak));
  #include <colorspace_fragment>
}
`;

// The burst at her mouth as her voice breaks: a many-pointed star (additive).
const STAR_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
varying vec2 vQ;
void main() {
  float r = length(vQ) * 2.0;
  float a = atan(vQ.y, vQ.x);
  float ray = abs(cos(a * 4.0));
  ray = ray * ray;
  ray = ray * ray * ray;
  float core = 1.0 - smoothstep(0.0, 0.3, r);
  float arms = (1.0 - smoothstep(0.1, 1.0, r)) * ray;
  vec3 col = mix(vec3(0.7, 0.9, 1.0), vec3(1.0), core);
  gl_FragColor = vec4(col, uAlpha * clamp(core + arms, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;
type F = { value: number };

interface DiscUniforms {
  uTime: F;
  uGlow: F;
  uRim: F;
  uFill: F;
  uPips: F;
  uCall: F;
  uSour: F;
  uWarm: F;
  uFlash: F;
  uFade: F;
  uCalm: F;
  uSeed: F;
}

interface TileSlot {
  objectId: number;
  disc: THREE.Mesh;
  u: DiscUniforms;
  numeral: THREE.Mesh;
  strokeA: THREE.Vector4;
  strokeB: THREE.Vector4;
  numeralAlpha: F;
  numeralSize: F;
  numeralWarm: F;
  digit: number;
  pillar: THREE.Mesh;
  pillarAlpha: F;
  pillarWarm: F;
  /** The pillar's eased strength (it rises and falls, never pops). */
  pillarLevel: number;
  flash: number;
  look: MoonTileLook;
}

interface Ripple {
  mesh: THREE.Mesh;
  alpha: F;
  warm: F;
  sour: F;
  age: number;
  life: number;
  from: number;
  to: number;
}

export class TempleScoreFx {
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly glow: ParticlePool;
  private readonly spray: ParticlePool;
  private readonly tiles: TileSlot[] = [];
  private readonly ripples: Ripple[] = [];
  private readonly veil: THREE.Mesh;
  private readonly veilU: { uTime: F; uAlpha: F; uSour: F };
  private readonly wave: THREE.Mesh;
  private readonly waveU: { uTime: F; uAlpha: F; uSour: F };
  private readonly thread: THREE.Mesh;
  private readonly threadAlpha = { value: 0 };
  private readonly star: THREE.Mesh;
  private readonly starAlpha = { value: 0 };
  private readonly starSize = { value: COLLAPSED };
  private readonly density: number;
  private bossId: number | null = null;
  private rosterSeen = -1;
  private gated = false;
  private scan = 0;
  private seed = 31;
  private debt = 0;
  private veilLevel = 0;
  private veilDrop = -1;
  private waveAge = -1;
  private readonly waveAt = new THREE.Vector3();
  private readonly waveNow: DiscordWave = { radius: 0, height: 0, alpha: 0 };
  private threadAge = -1;
  private threadTo = -1;
  private starAge = -1;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    parent: THREE.Group,
    private readonly world: IWorld | undefined,
    private readonly groundY: (x: number, z: number) => number,
    detail: boolean,
    private readonly shake?: (amount: number) => void,
    private readonly calm: () => boolean = () => false,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'drowned-temple-score-fx';
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
      Math.round(1500 * this.density),
      particleMat(GLOW_FRAG, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 13),
    );
    this.spray = new ParticlePool(
      Math.round(900 * this.density),
      particleMat(SPRAY_FRAG, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 12),
    );
    this.root.add(this.glow.mesh, this.spray.mesh);

    const shader = (
      vert: string,
      frag: string,
      uniforms: object,
      additive: boolean,
    ): THREE.ShaderMaterial => {
      const m = new THREE.ShaderMaterial({
        uniforms: uniforms as Record<string, THREE.IUniform>,
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.materials.push(m);
      return m;
    };

    // The tiles: a flat quad (in tile radii), a numeral plate and a pillar each.
    const discGeo = new THREE.PlaneGeometry(DISC_REACH * 2, DISC_REACH * 2).rotateX(-Math.PI / 2);
    const plateGeo = new THREE.PlaneGeometry(1, 1.4);
    const pillarGeo = new THREE.CylinderGeometry(1, 1.25, 1, 24, 1, true).translate(0, 0.5, 0);
    this.geometries.push(discGeo, plateGeo, pillarGeo);
    for (let i = 0; i < TILE_SLOTS; i++) {
      const u: DiscUniforms = {
        uTime: this.uTime,
        uGlow: { value: 0 },
        uRim: { value: 0 },
        uFill: { value: 0 },
        uPips: { value: 0 },
        uCall: { value: 0 },
        uSour: { value: 0 },
        uWarm: { value: 0 },
        uFlash: { value: 0 },
        uFade: { value: 0 },
        uCalm: { value: 0 },
        uSeed: { value: 3.7 * (i + 1) },
      };
      const disc = this.collapsed(
        new THREE.Mesh(discGeo, shader(FLAT_VERT, DISC_FRAG, u, false)),
        2,
      );
      const strokeA = new THREE.Vector4();
      const strokeB = new THREE.Vector4();
      const numeralAlpha = { value: 0 };
      const numeralSize = { value: COLLAPSED };
      const numeralWarm = { value: 0 };
      const numeral = new THREE.Mesh(
        plateGeo,
        shader(
          NUMERAL_VERT,
          NUMERAL_FRAG,
          {
            uStrokeA: { value: strokeA },
            uStrokeB: { value: strokeB },
            uAlpha: numeralAlpha,
            uSize: numeralSize,
            uWarm: numeralWarm,
          },
          false,
        ),
      );
      numeral.frustumCulled = false;
      numeral.renderOrder = floorVfxRenderOrder('encounter', 14);
      this.root.add(numeral);
      const pillarAlpha = { value: 0 };
      const pillarWarm = { value: 0 };
      const pillar = this.collapsed(
        new THREE.Mesh(
          pillarGeo,
          shader(
            UV_VERT,
            PILLAR_FRAG,
            { uTime: this.uTime, uAlpha: pillarAlpha, uWarm: pillarWarm },
            true,
          ),
        ),
        11,
      );
      this.tiles.push({
        objectId: -1,
        disc,
        u,
        numeral,
        strokeA,
        strokeB,
        numeralAlpha,
        numeralSize,
        numeralWarm,
        digit: -1,
        pillar,
        pillarAlpha,
        pillarWarm,
        pillarLevel: 0,
        flash: 0,
        look: newMoonTileLook(),
      });
    }

    // Ripples: a unit flat ring, scaled as it runs out.
    const rippleGeo = new THREE.PlaneGeometry(2.1, 2.1).rotateX(-Math.PI / 2);
    this.geometries.push(rippleGeo);
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
      const alpha = { value: 0 };
      const warm = { value: 0 };
      const sour = { value: 0 };
      const mesh = this.collapsed(
        new THREE.Mesh(
          rippleGeo,
          shader(FLAT_VERT, RIPPLE_FRAG, { uAlpha: alpha, uWarm: warm, uSour: sour }, true),
        ),
        4,
      );
      this.ripples.push({ mesh, alpha, warm, sour, age: -1, life: RIPPLE_LIFE, from: 1, to: 2 });
    }

    // Her ward's water and Discord's wave: one open ring of unit radius and height.
    const ringGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 6, true).translate(0, 0.5, 0);
    this.geometries.push(ringGeo);
    this.veilU = { uTime: this.uTime, uAlpha: { value: 0 }, uSour: { value: 0 } };
    this.veil = this.collapsed(
      new THREE.Mesh(ringGeo, shader(UV_VERT, VEIL_FRAG, this.veilU, false)),
      9,
    );
    this.waveU = { uTime: this.uTime, uAlpha: { value: 0 }, uSour: { value: 1 } };
    this.wave = this.collapsed(
      new THREE.Mesh(ringGeo, shader(UV_VERT, VEIL_FRAG, this.waveU, false)),
      10,
    );

    // The thread of song (a unit cylinder along +y) and the burst at her mouth.
    const threadGeo = new THREE.CylinderGeometry(1, 0.6, 1, 12, 1, true).translate(0, 0.5, 0);
    const starGeo = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(threadGeo, starGeo);
    this.thread = this.collapsed(
      new THREE.Mesh(
        threadGeo,
        shader(UV_VERT, THREAD_FRAG, { uTime: this.uTime, uAlpha: this.threadAlpha }, true),
      ),
      13,
    );
    this.star = new THREE.Mesh(
      starGeo,
      shader(NUMERAL_VERT, STAR_FRAG, { uAlpha: this.starAlpha, uSize: this.starSize }, true),
    );
    this.star.frustumCulled = false;
    this.star.renderOrder = floorVfxRenderOrder('encounter', 15);
    this.root.add(this.star);
  }

  private collapsed(mesh: THREE.Mesh, step: number): THREE.Mesh {
    mesh.frustumCulled = false;
    mesh.renderOrder = floorVfxRenderOrder('encounter', step);
    mesh.scale.setScalar(COLLAPSED);
    this.root.add(mesh);
    return mesh;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** The temple root's gate has linked every program: idle, hide the layer. */
  markGated(): void {
    this.gated = true;
  }

  private boss(): EntityView | null {
    if (!this.world || this.bossId === null) return null;
    return this.world.entities.get(this.bossId) ?? null;
  }

  /** The tiles and their singer come and go with the roster: walk it only on
   *  a change. Tiles take the slots in entity-id order. */
  private rescan(force = false): void {
    const world = this.world;
    if (!world || (!force && world.entityRosterVersion === this.rosterSeen)) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const s of this.tiles) s.objectId = -1;
    const me = world.entities.get(world.playerId);
    let best: EntityView | null = null;
    let bestD = Infinity;
    let n = 0;
    for (const e of world.entities.values()) {
      if (e.kind === 'mob' && e.templateId === SELTHE_ID) {
        const d = me ? Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) : 0;
        if (d < bestD) {
          bestD = d;
          best = e;
        }
        continue;
      }
      if (e.kind !== 'object' || n >= TILE_SLOTS || !moonTileOf(e.templateId)) continue;
      // Insert in id order (five at most).
      let at = n;
      while (at > 0 && this.tiles[at - 1].objectId > e.id) {
        this.tiles[at].objectId = this.tiles[at - 1].objectId;
        at--;
      }
      this.tiles[at].objectId = e.id;
      n++;
    }
    this.bossId = best?.id ?? null;
  }

  private slotOf(objectId: number): TileSlot | null {
    for (const s of this.tiles) if (s.objectId === objectId) return s;
    return null;
  }

  /** True when the cue is the Score's (the renderer skips its generic draw). */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx') return false;
    const ab = ev.ability;
    if (
      ab !== SELTHE_TILE_NOTE &&
      ab !== SELTHE_TILE_SOUNDED &&
      ab !== SELTHE_FALSE_NOTE &&
      ab !== SELTHE_VOICE_BREAKS &&
      ab !== SELTHE_DISCORD &&
      ab !== SELTHE_SCORE
    )
      return false;
    // The melody's opening cue is hers to animate too: seen, never claimed.
    if (ab === SELTHE_SCORE) return false;
    if (this.bossId === null || ev.sourceId !== this.bossId) this.rescan(true);
    const world = this.world;
    const b = this.boss();
    if (ab === SELTHE_VOICE_BREAKS) {
      if (b) this.voiceBreaks(b);
      return true;
    }
    if (ab === SELTHE_DISCORD) {
      if (b) this.discord(b);
      return true;
    }
    let slot = this.slotOf(ev.targetId);
    if (!slot) {
      this.rescan(true);
      slot = this.slotOf(ev.targetId);
    }
    const obj = world?.entities.get(ev.targetId);
    if (!slot || !obj) return true;
    if (ab === SELTHE_TILE_NOTE) this.note(slot, obj, b);
    else if (ab === SELTHE_TILE_SOUNDED) this.sounded(slot, obj);
    else this.falseNote(slot, obj);
    return true;
  }

  private ripple(
    x: number,
    z: number,
    from: number,
    to: number,
    life: number,
    warm: number,
    sour: number,
    delay = 0,
  ): void {
    let r = this.ripples[0];
    for (const k of this.ripples)
      if (k.age < -0.5) {
        r = k;
        break;
      }
    // A delayed ripple waits collapsed (its age climbs to zero first).
    r.age = delay > 0 ? -delay : 0;
    r.life = life;
    r.from = from;
    r.to = to;
    r.warm.value = warm;
    r.sour.value = sour;
    r.mesh.position.set(x, this.groundY(x, z) + 0.09, z);
  }

  /** A fountain of motes off a tile. */
  private motes(
    x: number,
    y: number,
    z: number,
    radius: number,
    n: number,
    speed: number,
    r: number,
    g: number,
    b: number,
  ): void {
    const count = Math.round(n * this.density);
    for (let i = 0; i < count; i++) {
      const a = this.rand() * Math.PI * 2;
      const d = Math.sqrt(this.rand()) * radius;
      this.glow.emit(this.uTime.value, {
        x: x + Math.cos(a) * d,
        y: y + 0.15,
        z: z + Math.sin(a) * d,
        vx: Math.cos(a) * speed * 0.25,
        vy: speed * (0.5 + this.rand()),
        vz: Math.sin(a) * speed * 0.25,
        ay: -5,
        drag: 0.6,
        life: 0.8 + this.rand() * 0.7,
        size0: 0.34 + this.rand() * 0.3,
        size1: 0.1,
        r,
        g,
        b,
        a: 1,
      });
    }
  }

  /** A tile rings its note: the pillar, the thread from her mouth, ripples. */
  private note(slot: TileSlot, obj: EntityView, b: EntityView | null): void {
    slot.flash = 0.6;
    slot.pillarLevel = Math.max(slot.pillarLevel, 0.4);
    const radius = obj.scale;
    this.ripple(obj.pos.x, obj.pos.z, radius, radius * 2.6, RIPPLE_LIFE, 0, 0);
    if (this.density >= 1)
      this.ripple(obj.pos.x, obj.pos.z, radius, radius * 2.1, RIPPLE_LIFE, 0, 0, 0.22);
    this.motes(
      obj.pos.x,
      this.groundY(obj.pos.x, obj.pos.z),
      obj.pos.z,
      radius,
      46,
      6,
      0.66,
      0.92,
      1,
    );
    if (b) {
      this.threadAge = 0;
      this.threadTo = obj.id;
    }
  }

  /** A tile stepped in its turn: it flares gold. */
  private sounded(slot: TileSlot, obj: EntityView): void {
    slot.flash = 1;
    const radius = obj.scale;
    this.ripple(obj.pos.x, obj.pos.z, radius * 0.6, radius * 3, 0.8, 1, 0);
    this.motes(
      obj.pos.x,
      this.groundY(obj.pos.x, obj.pos.z),
      obj.pos.z,
      radius,
      70,
      9,
      1,
      0.9,
      0.58,
    );
  }

  /** A tile stepped out of turn: it cracks, dark spray jumps off it. */
  private falseNote(slot: TileSlot, obj: EntityView): void {
    slot.flash = 0.35;
    const radius = obj.scale;
    const y = this.groundY(obj.pos.x, obj.pos.z);
    this.ripple(obj.pos.x, obj.pos.z, radius * 0.8, radius * 2.2, 0.7, 0, 1);
    const n = Math.round(46 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = 3 + this.rand() * 5;
      this.spray.emit(this.uTime.value, {
        x: obj.pos.x + Math.cos(a) * radius * this.rand(),
        y: y + 0.3,
        z: obj.pos.z + Math.sin(a) * radius * this.rand(),
        vx: Math.cos(a) * s,
        vy: 3 + this.rand() * 5,
        vz: Math.sin(a) * s,
        ay: -16,
        drag: 0.7,
        life: 0.5 + this.rand() * 0.4,
        size0: 0.3 + this.rand() * 0.3,
        size1: 0.12,
        r: 0.95,
        g: 0.35,
        b: 0.6,
        a: 0.9,
      });
    }
    const world = this.world;
    const me = world?.entities.get(world.playerId);
    if (me && Math.hypot(me.pos.x - obj.pos.x, me.pos.z - obj.pos.z) <= radius + 3)
      this.shake?.(0.12);
  }

  /** Her voice breaks: the water round her falls, light bursts at her mouth
   *  and a ring of spray runs out over the court. */
  private voiceBreaks(b: EntityView): void {
    this.veilDrop = 0;
    this.starAge = 0;
    this.playGesture?.(b.id, SELTHE_VOICE_BREAKS);
    const y = this.groundY(b.pos.x, b.pos.z);
    this.ripple(b.pos.x, b.pos.z, VEIL_RADIUS, VOICE_BREAK_REACH, 0.9, 0.5, 0);
    this.ripple(b.pos.x, b.pos.z, VEIL_RADIUS, VOICE_BREAK_REACH * 0.7, 0.9, 0, 0, 0.18);
    const n = Math.round(220 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = 7 + this.rand() * 12;
      // The ward's water thrown out and down.
      this.spray.emit(this.uTime.value, {
        x: b.pos.x + Math.cos(a) * VEIL_RADIUS,
        y: y + this.rand() * VEIL_HEIGHT * this.veilLevel,
        z: b.pos.z + Math.sin(a) * VEIL_RADIUS,
        vx: Math.cos(a) * s,
        vy: 1 + this.rand() * 5,
        vz: Math.sin(a) * s,
        ay: -18,
        drag: 0.8,
        life: 0.7 + this.rand() * 0.6,
        size0: 0.4 + this.rand() * 0.5,
        size1: 0.16,
        r: 0.82,
        g: 0.95,
        b: 1,
        a: 0.95,
      });
      // The shattered note: shards of light flung from her mouth.
      if (i % 2 === 0)
        this.glow.emit(this.uTime.value, {
          x: b.pos.x,
          y: b.pos.y + MOUTH_UP,
          z: b.pos.z,
          vx: Math.cos(a) * s * 0.9,
          vy: (this.rand() - 0.3) * 12,
          vz: Math.sin(a) * s * 0.9,
          ay: -14,
          drag: 0.9,
          life: 0.7 + this.rand() * 0.7,
          size0: 0.6 + this.rand() * 0.5,
          size1: 0.12,
          spin: 9,
          r: 1,
          g: 0.93,
          b: 0.72,
          a: 1,
        });
    }
    this.kick(b, VOICE_BREAK_REACH, 0.3, 0.12);
  }

  /** Discord: the sour wave rolls from her over the whole court. */
  private discord(b: EntityView): void {
    this.waveAge = 0;
    this.veilDrop = 0;
    this.waveAt.set(b.pos.x, this.groundY(b.pos.x, b.pos.z), b.pos.z);
    this.ripple(b.pos.x, b.pos.z, 3, DISCORD_REACH, 1.1, 0, 1);
    this.ripple(b.pos.x, b.pos.z, 3, DISCORD_REACH * 0.8, 1.1, 0, 1, 0.2);
    const n = Math.round(260 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = (DISCORD_REACH / 1.1) * (0.6 + this.rand() * 0.5);
      this.spray.emit(this.uTime.value, {
        x: b.pos.x + Math.cos(a) * 4,
        y: this.waveAt.y + 0.5 + this.rand() * 3,
        z: b.pos.z + Math.sin(a) * 4,
        vx: Math.cos(a) * s,
        vy: 3 + this.rand() * 7,
        vz: Math.sin(a) * s,
        ay: -12,
        drag: 0.75,
        life: 0.9 + this.rand() * 0.5,
        size0: 0.5 + this.rand() * 0.6,
        size1: 0.2,
        r: 0.8,
        g: 0.5,
        b: 1,
        a: 0.95,
      });
    }
    this.kick(b, DISCORD_REACH, 0.45, 0.16);
  }

  /** A camera kick for a player inside `reach` of her, a nudge beyond it. */
  private kick(b: EntityView, reach: number, inside: number, outside: number): void {
    const world = this.world;
    const me = world?.entities.get(world.playerId);
    if (!me || !this.shake) return;
    const d = Math.hypot(me.pos.x - b.pos.x, me.pos.z - b.pos.z);
    if (d <= reach) this.shake(inside);
    else if (d <= reach + 20) this.shake(outside);
  }

  update(dt: number, clock: number): void {
    this.uTime.value = clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.rescan();
    }
    const world = this.world;
    const calm = this.calm();
    const b = this.boss();
    let busy = this.glow.lastDeath > clock || this.spray.lastDeath > clock;
    const ease = Math.min(1, dt * 9);
    for (const s of this.tiles) {
      const obj = s.objectId >= 0 ? world?.entities.get(s.objectId) : undefined;
      const tile = obj ? moonTileOf(obj.templateId) : null;
      s.flash = Math.max(0, s.flash - dt * 2.6);
      const u = s.u;
      u.uFlash.value = calm ? s.flash * 0.5 : s.flash;
      u.uCalm.value = calm ? 1 : 0;
      if (!obj || !tile) {
        // The tile is gone: fade it out, then collapse every piece of it.
        u.uFade.value = Math.max(0, u.uFade.value - dt * 3);
        s.pillarLevel = 0;
        s.pillarAlpha.value = 0;
        s.pillar.scale.setScalar(COLLAPSED);
        s.numeralAlpha.value = 0;
        s.numeralSize.value = COLLAPSED;
        if (u.uFade.value <= 0.01) s.disc.scale.setScalar(COLLAPSED);
        else busy = true;
        continue;
      }
      busy = true;
      const look = moonTileLook(tile.state, tile.place, s.look);
      const radius = obj.scale;
      const y = this.groundY(obj.pos.x, obj.pos.z);
      u.uFade.value = Math.min(1, u.uFade.value + dt * 3);
      u.uGlow.value += (look.glow - u.uGlow.value) * ease;
      u.uRim.value += (look.rim - u.uRim.value) * ease;
      u.uFill.value += (look.fill - u.uFill.value) * ease;
      u.uCall.value += (look.call - u.uCall.value) * ease;
      u.uSour.value += (look.sour - u.uSour.value) * Math.min(1, dt * 16);
      u.uWarm.value += (look.warm - u.uWarm.value) * ease;
      // The place never eases: a count is a count.
      u.uPips.value = look.pips;
      s.disc.position.set(obj.pos.x, y + 0.07, obj.pos.z);
      s.disc.scale.setScalar(radius);
      this.stepNumeral(s, look, obj, y, clock, calm);
      this.stepPillar(s, look, obj, y, radius, dt, clock, calm);
      if (look.pillar >= 1) this.risingMotes(obj, y, radius, dt);
    }
    this.stepRipples(dt);
    this.stepVeil(b, dt);
    this.stepWave(dt);
    this.stepThread(b, dt);
    this.stepStar(b, dt);
    if (b && !b.dead && this.voiceBroken(b)) {
      this.drizzle(b, dt);
      busy = true;
    }
    this.glow.update(clock);
    this.spray.update(clock);
    if (this.veilLevel > 0.01 || this.waveAge >= 0 || this.threadAge >= 0 || this.starAge >= 0)
      busy = true;
    for (const r of this.ripples) if (r.age > -0.5) busy = true;
    // Until the gate has linked the layer it stays drawn (collapsed); after,
    // an idle layer is hidden so it costs no draw anywhere in the world.
    this.root.visible = !this.gated || busy;
  }

  /** Is she reeling under her broken voice (the stun)? */
  private voiceBroken(b: EntityView): boolean {
    for (const a of b.auras) if (a.id === SELTHE_BROKEN_VOICE) return true;
    return false;
  }

  /** The numeral over a tile: its digit, its warmth, a bob while called out. */
  private stepNumeral(
    s: TileSlot,
    look: MoonTileLook,
    obj: EntityView,
    y: number,
    clock: number,
    calm: boolean,
  ): void {
    if (look.numeral <= 0) {
      s.numeralAlpha.value = 0;
      s.numeralSize.value = COLLAPSED;
      return;
    }
    if (s.digit !== look.numeral) {
      s.digit = look.numeral;
      const k = numeralStrokes(look.numeral);
      s.strokeA.set(k[0], k[1], k[2], k[3]);
      s.strokeB.set(k[4], k[5], k[6], k[7]);
    }
    const bob = look.call > 0 && !calm ? 0.28 * Math.sin(clock * 5.2) : 0;
    s.numeral.position.set(obj.pos.x, y + NUMERAL_HEIGHT + bob, obj.pos.z);
    s.numeralSize.value = NUMERAL_SIZE * (look.call > 0 ? 1.25 : 1);
    s.numeralAlpha.value = 1;
    s.numeralWarm.value = look.warm;
  }

  /** The pillar over a tile: the ringing note's column, the call-out's beacon. */
  private stepPillar(
    s: TileSlot,
    look: MoonTileLook,
    obj: EntityView,
    y: number,
    radius: number,
    dt: number,
    clock: number,
    calm: boolean,
  ): void {
    s.pillarLevel += (look.pillar - s.pillarLevel) * Math.min(1, dt * 7);
    if (s.pillarLevel < 0.02) {
      s.pillarAlpha.value = 0;
      s.pillar.scale.setScalar(COLLAPSED);
      return;
    }
    // A full note is a wide column; the call-out a thin beacon.
    const note = look.pillar >= 1;
    const width = note ? radius * 0.6 : radius * 0.26;
    const height = note ? NOTE_PILLAR_HEIGHT : BEACON_HEIGHT;
    const beat = note || calm ? 1 : 0.7 + 0.3 * Math.sin(clock * 8.8);
    s.pillar.position.set(obj.pos.x, y + 0.05, obj.pos.z);
    s.pillar.scale.set(width, Math.max(COLLAPSED, height * s.pillarLevel), width);
    s.pillarAlpha.value = Math.min(1, s.pillarLevel * 1.4) * beat;
    s.pillarWarm.value = look.warm;
  }

  /** Light climbing the pillar of a ringing note. */
  private risingMotes(obj: EntityView, y: number, radius: number, dt: number): void {
    this.debt += 40 * this.density * dt;
    while (this.debt >= 1) {
      this.debt -= 1;
      const a = this.rand() * Math.PI * 2;
      const d = Math.sqrt(this.rand()) * radius * 0.8;
      this.glow.emit(this.uTime.value, {
        x: obj.pos.x + Math.cos(a) * d,
        y: y + 0.2,
        z: obj.pos.z + Math.sin(a) * d,
        vx: 0,
        vy: 5 + this.rand() * 6,
        vz: 0,
        life: 0.9 + this.rand() * 0.5,
        size0: 0.3,
        size1: 0.55,
        r: 0.7,
        g: 0.93,
        b: 1,
        a: 0.9,
      });
    }
  }

  private stepRipples(dt: number): void {
    for (const r of this.ripples) {
      if (r.age < -0.5) continue;
      r.age += dt;
      if (r.age < 0) continue;
      const k = r.age / r.life;
      if (k >= 1) {
        r.age = -1;
        r.alpha.value = 0;
        r.mesh.scale.setScalar(COLLAPSED);
        continue;
      }
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * (1 - (1 - k) * (1 - k)));
      r.alpha.value = (1 - k) * (1 - k);
    }
  }

  /** Her ward's water: it stands while she sings, sinks with the verse, and
   *  falls at once when the Score ends. */
  private stepVeil(b: EntityView | null, dt: number): void {
    const singing = !!b && !b.dead && scoreSinging(b.castingAbility);
    const want = b && singing ? scoreVeilLevel(b.castingAbility, b.castRemaining, b.castTotal) : 0;
    if (singing) this.veilDrop = -1;
    if (this.veilDrop >= 0) {
      // The collapse: faster than any ease, with the water's own weight.
      this.veilDrop += dt;
      const k = Math.min(1, this.veilDrop / VOICE_BREAK_SECONDS);
      this.veilLevel *= Math.max(0, 1 - dt * (4 + 14 * k));
      if (k >= 1) this.veilDrop = -1;
    } else this.veilLevel += (want - this.veilLevel) * Math.min(1, dt * (singing ? 3 : 8));
    if (!b || this.veilLevel < 0.01) {
      this.veilLevel = singing ? this.veilLevel : 0;
      this.veilU.uAlpha.value = 0;
      this.veil.scale.setScalar(COLLAPSED);
      return;
    }
    this.veil.position.set(b.pos.x, this.groundY(b.pos.x, b.pos.z), b.pos.z);
    this.veil.scale.set(VEIL_RADIUS, VEIL_HEIGHT * this.veilLevel, VEIL_RADIUS);
    this.veilU.uAlpha.value = Math.min(1, this.veilLevel * 1.6);
    // Spray off the crest of the standing water.
    this.debt += 26 * this.density * dt;
    while (this.debt >= 1) {
      this.debt -= 1;
      const a = this.rand() * Math.PI * 2;
      this.spray.emit(this.uTime.value, {
        x: b.pos.x + Math.cos(a) * VEIL_RADIUS,
        y: this.veil.position.y + VEIL_HEIGHT * this.veilLevel * (0.7 + this.rand() * 0.3),
        z: b.pos.z + Math.sin(a) * VEIL_RADIUS,
        vx: Math.cos(a) * 1.2,
        vy: 1 + this.rand() * 2,
        vz: Math.sin(a) * 1.2,
        ay: -9,
        drag: 0.6,
        life: 0.6 + this.rand() * 0.4,
        size0: 0.3 + this.rand() * 0.3,
        size1: 0.12,
        r: 0.8,
        g: 0.94,
        b: 1,
        a: 0.85,
      });
    }
  }

  private stepWave(dt: number): void {
    if (this.waveAge < 0) return;
    this.waveAge += dt;
    const w = discordWave(this.waveAge, this.waveNow);
    if (!w) {
      this.waveAge = -1;
      this.waveU.uAlpha.value = 0;
      this.wave.scale.setScalar(COLLAPSED);
      return;
    }
    this.wave.position.copy(this.waveAt);
    this.wave.scale.set(w.radius, w.height, w.radius);
    this.waveU.uAlpha.value = Math.min(1, w.alpha * 1.5);
  }

  /** The thread of song from her mouth to the tile that rings. */
  private stepThread(b: EntityView | null, dt: number): void {
    if (this.threadAge < 0) return;
    this.threadAge += dt;
    const k = this.threadAge / THREAD_LIFE;
    const obj = this.threadTo >= 0 ? this.world?.entities.get(this.threadTo) : undefined;
    if (k >= 1 || !b || !obj) {
      this.threadAge = -1;
      this.threadAlpha.value = 0;
      this.thread.scale.setScalar(COLLAPSED);
      return;
    }
    const from = this.a.set(b.pos.x, b.pos.y + MOUTH_UP, b.pos.z);
    const to = this.b.set(obj.pos.x, this.groundY(obj.pos.x, obj.pos.z) + 0.3, obj.pos.z);
    this.dir.subVectors(to, from);
    const len = Math.max(0.1, this.dir.length());
    this.dir.multiplyScalar(1 / len);
    // It races out to the tile, then thins away.
    const reach = Math.min(1, k * 3.2);
    const width = 0.34 * (1 - k * 0.7);
    this.thread.position.copy(from);
    this.thread.quaternion.setFromUnitVectors(this.up, this.dir);
    this.thread.scale.set(width, len * reach, width);
    this.threadAlpha.value = 1 - k * k;
  }

  /** The burst of light at her mouth as her voice breaks. */
  private stepStar(b: EntityView | null, dt: number): void {
    if (this.starAge < 0) return;
    this.starAge += dt;
    const k = this.starAge / BURST_LIFE;
    if (k >= 1 || !b) {
      this.starAge = -1;
      this.starAlpha.value = 0;
      this.starSize.value = COLLAPSED;
      return;
    }
    this.star.position.set(b.pos.x, b.pos.y + MOUTH_UP, b.pos.z);
    this.starSize.value = 5 + 16 * (1 - (1 - k) * (1 - k));
    this.starAlpha.value = (1 - k) * (this.calm() ? 0.5 : 1);
  }

  /** While her voice is broken: the last of her ward's water rains off her. */
  private drizzle(b: EntityView, dt: number): void {
    this.debt += 30 * this.density * dt;
    while (this.debt >= 1) {
      this.debt -= 1;
      const a = this.rand() * Math.PI * 2;
      const r = 1 + this.rand() * 2.6;
      this.spray.emit(this.uTime.value, {
        x: b.pos.x + Math.cos(a) * r,
        y: b.pos.y + 3 + this.rand() * 4,
        z: b.pos.z + Math.sin(a) * r,
        vx: 0,
        vy: -1 - this.rand() * 2,
        vz: 0,
        ay: -12,
        drag: 0.3,
        life: 0.6 + this.rand() * 0.3,
        size0: 0.22 + this.rand() * 0.2,
        size1: 0.1,
        r: 0.8,
        g: 0.93,
        b: 1,
        a: 0.8,
      });
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.glow.dispose();
    this.spray.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
