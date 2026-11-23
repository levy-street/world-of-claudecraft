// Cantor Ilvane's Dirge of the Hollow (plan: ilvane_dirge_fx_core.ts), on the
// crypt boss host (crypt_boss_fx.ts), composed by ilvane_fx.ts. Read off the
// sim only: her cast bar (ILVANE_DIRGE or the heroic Unbroken Verse), where
// she stands (planted for the whole bar), the 'nova' cue as it lands, and the
// silence aura on the players it struck.
//
//  - The build-up: a dark aura swelling round her as the bar fills, the shadow
//    choir's voices spiralling up it, notes of song rising off her and off the
//    Bone Organ, whose pipes kindle violet behind her.
//  - The sight cue (ACTIONABLE, every tier): the loft floor she can see, out to
//    the sim's own radius, filling with the bar, and the hatched shadow wedge
//    each choir pillar throws (the shared sight field, the trash engine's G6
//    look, measured with the sim's own sight test); a beam of song from her
//    voice to every player she sees and a pulsing ring under them, a calm pale
//    ring under every player hidden in reach.
//  - The release: a shock of dark sound racing out over the lit floor and
//    stopping dead at each pillar (its curtain bursting against the stone),
//    rings across the loft, a burst of smoke and notes; every silenced player
//    wears a silence mark over the head for as long as the silence holds.
//
// Cosmetic (the low tier thins or sheds it): the aura, voices, notes, the
// organ's kindling, the curtain and the bursts. Every geometry and material is
// built in the constructor under the host's root, before its gated attach; no
// light; no per-frame allocation.

import * as THREE from 'three';
import { lineOfSightClear } from '../../sim/colliders';
import {
  ILVANE_DIRGE,
  ILVANE_DIRGE_SILENCE,
  ILVANE_UNBROKEN_DIRGE,
} from '../../sim/encounters/hollow_crypt/ilvane_ids';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  TELEGRAPH_THREAT_COLORS,
  type TelegraphLook,
  telegraphFillOf,
  telegraphLook,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  NOVA_RAYS,
  SIGHT_DRAPE_BUDGET,
  SIGHT_FIELD_VERT,
  SIGHT_SHADE_GLSL,
  SIGHT_STEEP_GLSL,
  SightFieldSurface,
  sightReach,
  sightStations,
} from '../trash_engine_fx';
import type { CryptBossFxHost } from './crypt_boss_fx';
import { cryptSlotOrigin } from './crypt_boss_fx_core';
import { BEAM_VERT, beamGeometry, GLYPH_VERT, NOISE_GLSL } from './crypt_fx_floor';
import { PARTICLE_VERT, ParticlePool } from './crypt_fx_particles';
import {
  DIRGE_RADIUS,
  DIRGE_VOICE_Y,
  DIRGE_WAVE_LINGER,
  DIRGE_WAVE_SECONDS,
  dirgeSwell,
  dirgeWave,
  ORGAN_PIPES,
  ORGAN_SPOT,
  silenceMark,
  silenceMarkScale,
} from './ilvane_dirge_fx_core';

/** Players a fight can hold (a five-player party and then some). */
const PLAYER_SLOTS = 10;
/** Rays re-measured per second, at most this many a frame, and on the claim. */
const RAYS_PER_SECOND = 256;
const MAX_RAYS_PER_FRAME = 12;
const FIRST_RAYS = 16;
/** How often the exposed / hidden / silenced players are re-read. */
const SCAN_SEC = 0.1;
/** Over the floor: the field, and the rings under the players. */
const FIELD_LIFT = 0.06;
/** She shows up this far from the bar's spot: a real resend (lay the field
 *  afresh); less is the mirror settling. */
const RESEND_YARDS = 0.3;
const SONG = new THREE.Color(0x9a5cff);
const SONG_RGB = { r: 0.6, g: 0.36, b: 1 };
const SMOKE = { r: 0.05, g: 0.018, b: 0.085 };
const PALE = { r: 0.82, g: 0.9, b: 1 };

// ------------------------------------------------------------------ shaders

/** The Dirge's sight field: the lit floor she can see (the shared telegraph
 *  layers in the threat colour, the song's ripples rolling out from her) and
 *  the shared hatched shadow behind cover. */
const FIELD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSong;
uniform float uRadius;
uniform float uFill;
uniform float uBase;
uniform float uFilled;
uniform float uFront;
uniform float uRim;
uniform float uWarn;
uniform float uDetail;
uniform float uHarsh;
uniform float uTime;
uniform float uFade;
varying float vR;
varying float vReach;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
${SIGHT_STEEP_GLSL}
${SIGHT_SHADE_GLSL}
void main() {
  if (sightSteep(vLocal)) discard;
  if (vR > vReach + 0.02) {
    vec4 shade = sightShade(vR, vReach, uRadius, vLocal);
    gl_FragColor = vec4(shade.rgb, shade.a * uFade);
    return;
  }
  float edge = max(0.0, vReach - vR);
  float open = smoothstep(uRadius - 0.3, uRadius - 0.05, vReach);
  float rimCore = 1.0 - smoothstep(0.05, 0.22, edge);
  float rimSoft = 1.0 - smoothstep(0.0, 0.9, edge);
  float fillYards = uFill * uRadius;
  float inside = 1.0 - smoothstep(fillYards - 0.1, fillYards + 0.1, vR);
  float front = (1.0 - smoothstep(0.0, 0.8, abs(vR - fillYards))) * uFront;
  float a = uBase + inside * uFilled + front + rimSoft * 0.3 + rimCore * uRim * mix(0.75, 1.0, open);
  a += uWarn * (0.12 + inside * 0.14);
  vec3 col = uColor * (0.8 + 0.35 * inside + 0.45 * rimCore) + uSong * front * 0.7;
  // The song rolling out from her voice: dark ripples (cosmetic).
  float ripple = fract(vR * 0.2 - uTime * (0.8 + uFill));
  float rings = smoothstep(0.0, 0.06, ripple) * (1.0 - smoothstep(0.08, 0.26, ripple));
  a += rings * 0.14 * uDetail * (0.35 + uFill) * inside;
  col += uSong * rings * 0.6 * uDetail * inside;
  // The Unbroken Verse: a second, broken edge inside the rim that crackles.
  if (uHarsh > 0.5) {
    float inner = 1.0 - smoothstep(0.0, 0.12, abs(edge - 0.7));
    float crackle = step(0.45, hash(floor(vWorld.xz * 2.0) + floor(uTime * 12.0)));
    a += inner * (0.35 + 0.4 * crackle) * open;
    col += vec3(1.0, 0.85, 0.8) * inner * crackle * 0.6 * open;
  }
  col += vec3(1.0) * uWarn * 0.12;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uFade);
}
`;

/** The shock of dark sound over the lit floor: a violet-white crest racing
 *  out, a throbbing wake behind it, a wall of light where cover stops it. */
const WAVE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uFront;
uniform float uAlpha;
uniform float uTime;
varying float vR;
varying float vReach;
varying vec3 vWorld;
${SIGHT_STEEP_GLSL}
void main() {
  if (sightSteep(vLocal)) discard;
  if (vR > uFront || vR > vReach + 0.02) discard;
  float d = uFront - vR;
  float crest = exp(-d * d * 1.1);
  float wake = (0.2 + 0.14 * sin(vR * 1.4 - uTime * 9.0)) * (1.0 - smoothstep(0.0, 14.0, d));
  float wall = 1.0 - smoothstep(0.0, 0.6, vReach - vR);
  vec3 col = mix(uColor, vec3(1.0), crest * 0.55) * (1.0 + crest * 1.4 + wall * 0.9);
  gl_FragColor = vec4(col * (crest + wake + wall * 0.7) * uAlpha, 1.0);
}
`;

const CURTAIN_VERT = /* glsl */ `
attribute float aH;
varying float vH;
varying vec3 vWorld;
void main() {
  vH = aH;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  // Camera-relative (the CPU's double-precision modelView): instance bands
  // sit far out, where a float32 world point rounds by more than the lift.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The standing wall of sound riding the front: streaks of violet, brightest
 *  at the floor. */
const CURTAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying float vH;
varying vec3 vWorld;
void main() {
  float streak = 0.55 + 0.45 * sin((vWorld.x - vWorld.z) * 2.3 + vH * 6.0 - uTime * 14.0);
  float fall = pow(max(1.0 - vH, 0.0), 1.4);
  vec3 col = mix(uColor, vec3(1.0), 0.25) * 1.5;
  gl_FragColor = vec4(col * fall * streak * uAlpha, 1.0);
}
`;

const SHELL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  // Camera-relative (the CPU's double-precision modelView): instance bands
  // sit far out, where a float32 world point rounds by more than the lift.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Her dark aura: smoke-dark bands spiralling up round her (normal blend). */
const SHELL_DARK_FRAG = /* glsl */ `
uniform float uPower;
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  vec2 q = vec2(vUv.x * 9.0 + vUv.y * 3.5 - uTime * 0.9, vUv.y * 3.0 - uTime * 1.7);
  float n = fbm(q);
  float foot = smoothstep(0.0, 0.12, vUv.y);
  float top = pow(max(1.0 - vUv.y, 0.0), 0.9);
  float a = uPower * 0.62 * smoothstep(0.32, 0.8, n) * foot * top;
  gl_FragColor = vec4(vec3(0.06, 0.015, 0.11) + vec3(0.12, 0.04, 0.2) * n, a);
}
`;

/** The shadow choir's voices: thin violet streaks winding up her aura
 *  (additive). */
const SHELL_GLOW_FRAG = /* glsl */ `
uniform float uPower;
uniform float uTime;
uniform vec3 uSong;
varying vec2 vUv;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  float wind = vUv.x * 6.2831 * 5.0 + vUv.y * 7.0 - uTime * 4.5;
  float streak = smoothstep(0.82, 1.0, sin(wind));
  float n = vnoise(vec2(vUv.x * 14.0, vUv.y * 5.0 - uTime * 2.2));
  float foot = smoothstep(0.0, 0.1, vUv.y);
  float top = pow(max(1.0 - vUv.y, 0.0), 1.3);
  float k = (streak * (0.6 + 0.6 * n) + 0.08 * n) * foot * top * uPower;
  gl_FragColor = vec4(uSong * 1.6 * k, 1.0);
}
`;

const ORGAN_VERT = /* glsl */ `
attribute vec3 aPipe;
varying vec3 vPipe;
void main() {
  vPipe = aPipe;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The Bone Organ's pipes kindling: violet light welling up each pipe, a
 *  flare at its mouth (additive). aPipe: across (-1..1), up (0..1), seed. */
const ORGAN_FRAG = /* glsl */ `
uniform float uPower;
uniform float uTime;
uniform vec3 uSong;
varying vec3 vPipe;
void main() {
  float across = 1.0 - abs(vPipe.x);
  float core = across * across;
  float rise = fract(vPipe.y * 2.2 - uTime * (0.9 + uPower * 1.6) + vPipe.z * 7.0);
  float pulse = smoothstep(0.0, 0.15, rise) * (1.0 - smoothstep(0.3, 0.7, rise));
  float fill = smoothstep(0.0, 1.0, uPower * 1.25 - vPipe.y * 0.45);
  float mouth = smoothstep(0.8, 1.0, vPipe.y) * uPower;
  float flick = 0.85 + 0.15 * sin(uTime * 17.0 + vPipe.z * 40.0);
  float k = (core * (0.25 + 0.75 * pulse) * fill + core * mouth * 0.8) * flick;
  gl_FragColor = vec4(uSong * 1.4 * k * uPower, 1.0);
}
`;

/** A beam of song from her voice to a player she sees: a bright core with
 *  pulses racing toward them (additive). */
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float core = pow(max(across, 0.0), 2.5);
  float pulse = smoothstep(0.75, 1.0, sin(vUv.y * 28.0 - uTime * 16.0));
  float ends = smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.94, 1.0, vUv.y));
  float k = core * (0.45 + 0.9 * pulse) * ends * uAlpha;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.35) * k, 1.0);
}
`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // Camera-relative, pulled a hand toward the camera (as the sight field).
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dc = max(length(mv.xyz), 1e-3);
  mv.xyz -= mv.xyz * (min(0.2, dc * 0.25) / dc);
  gl_Position = projectionMatrix * mv;
}
`;

/** A ring under a player: exposed (the threat colour, pulsing in) or hidden
 *  (calm, pale). */
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
uniform float uPulse;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float rim = 1.0 - smoothstep(0.0, 0.08, abs(r - 0.86));
  float inner = fract(1.0 - r + uTime * 1.6 * uPulse);
  float chase = uPulse * smoothstep(0.85, 1.0, inner) * step(r, 0.86);
  float wash = (1.0 - smoothstep(0.3, 0.9, r)) * 0.12;
  float a = (rim * 0.9 + chase * 0.5 + wash) * uAlpha;
  gl_FragColor = vec4(uColor * (1.0 + rim * 0.4), a);
}
`;

/** The silence mark over a silenced player's head: a dark disc, a note, a
 *  slash through it, rimmed in violet. */
const SILENCE_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uSong;
varying vec2 vUv;
float box(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return max(d.x, d.y); }
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);
  float aa = 0.012;
  float disc = 1.0 - smoothstep(0.4 - aa, 0.4 + aa, r);
  float rim = 1.0 - smoothstep(0.03 - aa, 0.03 + aa, abs(r - 0.4));
  vec2 h = p - vec2(-0.07, -0.13);
  h = vec2(h.x * 0.94 + h.y * 0.34, -h.x * 0.34 + h.y * 0.94);
  float head = 1.0 - smoothstep(1.0 - 0.12, 1.0 + 0.12, length(h / vec2(0.105, 0.075)));
  float stem = 1.0 - smoothstep(-aa, aa, box(p, vec2(0.025, 0.05), vec2(0.018, 0.17)));
  vec2 f = p - vec2(0.07, 0.17);
  float flag = 1.0 - smoothstep(-aa, aa, box(vec2(f.x, f.y + f.x * 0.6), vec2(0.0), vec2(0.06, 0.03)));
  float note = max(head, max(stem, flag));
  float slash = (1.0 - smoothstep(0.035 - aa, 0.035 + aa, abs(p.x + p.y) * 0.7071)) * step(r, 0.39);
  vec3 col = mix(vec3(0.05, 0.02, 0.09), vec3(0.85, 0.82, 1.0), note);
  col = mix(col, uSong * 1.6 + vec3(0.25, 0.1, 0.3), max(rim, slash));
  float a = max(disc * 0.78, max(rim, slash));
  gl_FragColor = vec4(col, a * uAlpha);
}
`;

/** A note of song: an eighth note, softly glowing (additive particles). */
const NOTE_FRAG = /* glsl */ `
varying float vT;
varying float vSeed;
varying vec4 vColor;
varying vec2 vUv;
float box(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return max(d.x, d.y); }
void main() {
  vec2 p = vUv - 0.5;
  if (vSeed > 0.5) p.x = -p.x;
  vec2 h = p - vec2(-0.1, -0.2);
  h = vec2(h.x * 0.94 + h.y * 0.34, -h.x * 0.34 + h.y * 0.94);
  float head = 1.0 - smoothstep(0.85, 1.15, length(h / vec2(0.15, 0.105)));
  float stem = 1.0 - smoothstep(-0.02, 0.02, box(p, vec2(0.035, 0.03), vec2(0.026, 0.25)));
  vec2 f = p - vec2(0.12, 0.22);
  float flag = 1.0 - smoothstep(-0.02, 0.02, box(vec2(f.x, f.y + f.x * 0.7), vec2(0.0), vec2(0.09, 0.04)));
  float note = max(head, max(stem, flag));
  float halo = (1.0 - smoothstep(0.0, 0.5, length(p))) * 0.25;
  float fade = smoothstep(0.0, 0.12, vT) * (1.0 - smoothstep(0.6, 1.0, vT));
  gl_FragColor = vec4(vColor.rgb * (note * 1.4 + halo), 1.0) * fade * vColor.a;
}
`;

// ------------------------------------------------------------------ pieces

interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

interface Mark {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

/** A player in reach as the last scan saw them. */
interface Seen {
  id: number;
  exposed: boolean;
}

/** The Dirge's silence on a player, if it holds (a loop: no closure). */
function silenceAura(e: Entity): Entity['auras'][number] | undefined {
  for (const a of e.auras) if (a.id === ILVANE_DIRGE_SILENCE) return a;
  return undefined;
}

/** A pipe-rank quad strip: one quad per organ pipe, aPipe = (across, up, seed). */
function organGeometry(): THREE.BufferGeometry {
  const n = ORGAN_PIPES.length;
  const pos = new Float32Array(n * 4 * 3);
  const pipe = new Float32Array(n * 4 * 3);
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = ORGAN_PIPES[i];
    const w = 0.55;
    const corners: [number, number][] = [
      [-1, 0],
      [1, 0],
      [-1, 1],
      [1, 1],
    ];
    for (let c = 0; c < 4; c++) {
      const [u, v] = corners[c];
      const k = i * 4 + c;
      pos[k * 3] = p.x - ORGAN_SPOT.x + u * w;
      pos[k * 3 + 1] = p.base + v * p.length;
      pos[k * 3 + 2] = p.z - ORGAN_SPOT.z;
      pipe[k * 3] = u;
      pipe[k * 3 + 1] = v;
      pipe[k * 3 + 2] = p.seed;
    }
    const b = i * 4;
    index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPipe', new THREE.BufferAttribute(pipe, 3));
  g.setIndex(index);
  return g;
}

export class IlvaneDirgeFx {
  private readonly field: SightFieldSurface;
  private readonly fieldMesh: THREE.Mesh;
  private readonly fieldMat: THREE.ShaderMaterial;
  private readonly waveSurface: SightFieldSurface;
  private readonly waveMesh: THREE.Mesh;
  private readonly waveMat: THREE.ShaderMaterial;
  private readonly curtain: THREE.Mesh;
  private readonly curtainMat: THREE.ShaderMaterial;
  private readonly shellDark: THREE.Mesh;
  private readonly shellGlow: THREE.Mesh;
  private readonly shellUniforms: { uPower: { value: number } };
  private readonly organ: THREE.Mesh;
  private readonly organMat: THREE.ShaderMaterial;
  private readonly notes: ParticlePool;
  private readonly beams: Beam[] = [];
  private readonly rings: Ring[] = [];
  private readonly marks: Mark[] = [];
  private readonly look: TelegraphLook = {
    base: 0,
    filled: 0,
    front: 0,
    rim: 0,
    warn: 0,
    detail: 0,
  };
  private readonly reach = new Float32Array(NOVA_RAYS);
  private readonly waveReach = new Float32Array(NOVA_RAYS);
  private readonly splashed = new Uint8Array(NOVA_RAYS);
  private readonly sinA = new Float32Array(NOVA_RAYS);
  private readonly cosA = new Float32Array(NOVA_RAYS);
  private readonly from = { x: 0, y: 0, z: 0 };
  private readonly to = { x: 0, y: 0, z: 0 };
  private rayX = 0;
  private rayZ = 0;
  private seed = 0;
  private readonly clearAt = (d: number): boolean => {
    this.to.x = this.from.x + this.rayX * d;
    this.to.z = this.from.z + this.rayZ * d;
    return lineOfSightClear(this.seed, this.from, this.to, 0.05);
  };
  /** The bar being drawn: its caster, cast id and the spot it is planted on. */
  private casterId = -1;
  private castId = '';
  private x = 0;
  private y = 0;
  private z = 0;
  private cursor = 0;
  private due = 0;
  private voice = 0;
  private organPower = 0;
  private scanIn = 0;
  /** The players in reach at the last scan: `seenCount` of the fixed slots. */
  private readonly seen: Seen[] = [];
  private seenCount = 0;
  private readonly silenced: number[] = [];
  private readonly silenceBurst = new Set<number>();
  /** Floor samples still free this frame (SIGHT_DRAPE_BUDGET, shared). */
  private drapeLeft = SIGHT_DRAPE_BUDGET;
  private waveAlive = false;
  private waveBorn = 0;
  private waveX = 0;
  private waveY = 0;
  private waveZ = 0;

  constructor(private readonly host: CryptBossFxHost) {
    for (let i = 0; i < NOVA_RAYS; i++) {
      const a = (i / NOVA_RAYS) * Math.PI * 2;
      this.sinA[i] = Math.sin(a);
      this.cosA[i] = Math.cos(a);
    }
    for (let i = 0; i < PLAYER_SLOTS; i++) this.seen.push({ id: -1, exposed: false });
    const stations = sightStations(DIRGE_RADIUS);
    // The sight field (actionable).
    this.field = new SightFieldSurface(NOVA_RAYS, stations);
    host.own(this.field.geometry);
    this.fieldMat = host.own(
      new THREE.ShaderMaterial({
        name: 'ilvaneDirgeSight',
        uniforms: {
          uColor: { value: new THREE.Color() },
          uSong: { value: SONG.clone() },
          uRadius: { value: DIRGE_RADIUS },
          uFill: { value: 0 },
          uBase: { value: 0 },
          uFilled: { value: 0 },
          uFront: { value: 0 },
          uRim: { value: 0 },
          uWarn: { value: 0 },
          uDetail: { value: 0 },
          uHarsh: { value: 0 },
          uTime: host.uTime,
          uFade: { value: 1 },
        },
        vertexShader: SIGHT_FIELD_VERT,
        fragmentShader: FIELD_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.fieldMesh = this.place(new THREE.Mesh(this.field.geometry, this.fieldMat), 14);
    // The release's shock of sound and its standing curtain.
    this.waveSurface = new SightFieldSurface(NOVA_RAYS, stations);
    host.own(this.waveSurface.geometry);
    this.waveMat = host.own(
      new THREE.ShaderMaterial({
        name: 'ilvaneDirgeWave',
        uniforms: {
          uColor: { value: SONG.clone() },
          uFront: { value: 0 },
          uAlpha: { value: 0 },
          uTime: host.uTime,
        },
        vertexShader: SIGHT_FIELD_VERT,
        fragmentShader: WAVE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.waveMesh = this.place(new THREE.Mesh(this.waveSurface.geometry, this.waveMat), 21);
    const cg = host.own(new THREE.BufferGeometry());
    cg.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(NOVA_RAYS * 2 * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    const hAttr = new Float32Array(NOVA_RAYS * 2);
    for (let r = 0; r < NOVA_RAYS; r++) hAttr[r * 2 + 1] = 1;
    cg.setAttribute('aH', new THREE.BufferAttribute(hAttr, 1));
    const ci: number[] = [];
    for (let r = 0; r < NOVA_RAYS; r++) {
      const j = (r + 1) % NOVA_RAYS;
      ci.push(r * 2, j * 2, r * 2 + 1, j * 2, j * 2 + 1, r * 2 + 1);
    }
    cg.setIndex(ci);
    this.curtainMat = host.own(
      new THREE.ShaderMaterial({
        name: 'ilvaneDirgeCurtain',
        uniforms: { uColor: { value: SONG.clone() }, uAlpha: { value: 0 }, uTime: host.uTime },
        vertexShader: CURTAIN_VERT,
        fragmentShader: CURTAIN_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.curtain = this.place(new THREE.Mesh(cg, this.curtainMat), 24);
    // Her aura: a dark shell and the voices winding up it.
    const shellGeo = host.own(new THREE.CylinderGeometry(1, 0.82, 1, 40, 1, true));
    shellGeo.translate(0, 0.5, 0);
    this.shellUniforms = { uPower: { value: 0 } };
    const shellDarkMat = host.own(
      new THREE.ShaderMaterial({
        name: 'ilvaneDirgeAura',
        uniforms: { uPower: this.shellUniforms.uPower, uTime: host.uTime },
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_DARK_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const shellGlowMat = host.own(
      new THREE.ShaderMaterial({
        name: 'ilvaneDirgeVoices',
        uniforms: { uPower: this.shellUniforms.uPower, uTime: host.uTime, uSong: { value: SONG } },
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.shellDark = this.place(new THREE.Mesh(shellGeo, shellDarkMat), 24);
    this.shellGlow = this.place(new THREE.Mesh(shellGeo, shellGlowMat), 26);
    // The Bone Organ's pipes kindling.
    this.organMat = host.own(
      new THREE.ShaderMaterial({
        name: 'ilvaneDirgeOrgan',
        uniforms: { uPower: { value: 0 }, uTime: host.uTime, uSong: { value: SONG } },
        vertexShader: ORGAN_VERT,
        fragmentShader: ORGAN_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.organ = this.place(new THREE.Mesh(host.own(organGeometry()), this.organMat), 26);
    // Notes of song.
    this.notes = new ParticlePool(
      Math.round(320 * host.density),
      host.own(
        new THREE.ShaderMaterial({
          name: 'ilvaneDirgeNotes',
          uniforms: { uTime: host.uTime },
          vertexShader: PARTICLE_VERT,
          fragmentShader: NOTE_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
      floorVfxRenderOrder('encounter', 28),
    );
    // The host disposes what it owns: the pool's instanced geometry too.
    host.own(this.notes.mesh.geometry);
    host.root.add(this.notes.mesh);
    // Per player: the beam of song, the ring under them, the silence mark.
    const beamGeo = host.own(beamGeometry(16));
    const ringGeo = host.own(new THREE.CircleGeometry(1, 48));
    ringGeo.rotateX(-Math.PI / 2);
    const markGeo = host.own(new THREE.PlaneGeometry(2, 2));
    for (let i = 0; i < PLAYER_SLOTS; i++) {
      const beamMat = host.own(
        new THREE.ShaderMaterial({
          name: 'ilvaneDirgeBeam',
          uniforms: {
            uTime: host.uTime,
            uA: { value: new THREE.Vector3() },
            uB: { value: new THREE.Vector3() },
            uWidth: { value: 0.32 },
            uSag: { value: 0 },
            uWave: { value: 0.08 },
            uColor: { value: SONG.clone() },
            uAlpha: { value: 0 },
          },
          vertexShader: BEAM_VERT,
          fragmentShader: BEAM_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      this.beams.push({ mesh: this.place(new THREE.Mesh(beamGeo, beamMat), 26), mat: beamMat });
      const ringMat = host.own(
        new THREE.ShaderMaterial({
          name: 'ilvaneDirgeRing',
          uniforms: {
            uColor: { value: new THREE.Color() },
            uAlpha: { value: 0 },
            uTime: host.uTime,
            uPulse: { value: 0 },
          },
          vertexShader: RING_VERT,
          fragmentShader: RING_FRAG,
          transparent: true,
          depthWrite: false,
        }),
      );
      this.rings.push({ mesh: this.place(new THREE.Mesh(ringGeo, ringMat), 16), mat: ringMat });
      const markMat = host.own(
        new THREE.ShaderMaterial({
          name: 'ilvaneDirgeSilence',
          uniforms: { uAlpha: { value: 0 }, uSong: { value: SONG } },
          vertexShader: GLYPH_VERT,
          fragmentShader: SILENCE_FRAG,
          transparent: true,
          depthWrite: false,
        }),
      );
      this.marks.push({ mesh: this.place(new THREE.Mesh(markGeo, markMat), 29), mat: markMat });
    }
  }

  private place(mesh: THREE.Mesh, step: number): THREE.Mesh {
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = floorVfxRenderOrder('encounter', step);
    this.host.root.add(mesh);
    return mesh;
  }

  // ------------------------------------------------------------------ events

  /** The Dirge landed: the shock of dark sound. */
  release(e: Entity, world: IWorld): void {
    const h = this.host;
    const now = h.clock();
    const singing = this.casterId === e.id;
    const x = singing ? this.x : e.pos.x;
    const z = singing ? this.z : e.pos.z;
    const y = singing ? this.y : h.groundY(x, z);
    this.waveX = x;
    this.waveY = y;
    this.waveZ = z;
    if (singing) {
      this.waveReach.set(this.reach);
      this.waveSurface.copyFrom(this.field);
    } else {
      // Seen landing without its bar (it came into view late): a coarse read.
      this.seed = world.cfg.seed;
      this.from.x = e.pos.x;
      this.from.y = e.pos.y;
      this.from.z = e.pos.z;
      for (let r = 0; r < NOVA_RAYS; r += 4) {
        this.rayX = this.sinA[r];
        this.rayZ = this.cosA[r];
        const reach = sightReach(this.clearAt, DIRGE_RADIUS, 3);
        for (let k = 0; k < 4 && r + k < NOVA_RAYS; k++) this.waveReach[r + k] = reach;
      }
      this.waveSurface.begin(x, y, z, DIRGE_RADIUS, FIELD_LIFT);
      this.waveSurface.setReach(this.waveReach);
    }
    this.hideBar();
    this.waveAlive = true;
    this.waveBorn = now;
    this.splashed.fill(0);
    this.waveMesh.position.set(x, y, z);
    this.curtain.position.set(x, y, z);
    this.waveMesh.visible = true;
    this.curtain.visible = !h.low;
    // The blow at her heart: rings across the loft, smoke and notes flung out.
    h.wave(x, z, DIRGE_RADIUS * 0.85, 0.9, 0x7a3cff, 0.1);
    h.wave(x, z, 16, 0.55, 0xffffff, 0.06);
    h.wave(x, z, 6, 0.35, 0xd8c4ff, 0.3);
    const vy = y + DIRGE_VOICE_Y;
    const smoke = Math.round(60 * h.density);
    for (let i = 0; i < smoke; i++) {
      const a = (i / smoke) * Math.PI * 2 + h.rand() * 0.2;
      const s = 7 + h.rand() * 6;
      h.dust.emit(now, {
        x: x + Math.sin(a) * 1.2,
        y: y + 0.6 + h.rand() * 2.5,
        z: z + Math.cos(a) * 1.2,
        vx: Math.sin(a) * s,
        vy: 0.6 + h.rand() * 1.4,
        vz: Math.cos(a) * s,
        life: 1.4 + h.rand() * 0.6,
        drag: 2.2,
        size0: 1.6,
        size1: 3.6,
        ...SMOKE,
        a: 0.42,
      });
    }
    const notes = Math.round(70 * h.density);
    for (let i = 0; i < notes; i++) {
      const a = h.rand() * Math.PI * 2;
      const s = 9 + h.rand() * 9;
      this.notes.emit(now, {
        x,
        y: vy + (h.rand() - 0.5),
        z,
        vx: Math.sin(a) * s,
        vy: (h.rand() - 0.3) * 5,
        vz: Math.cos(a) * s,
        ay: -4,
        life: 0.9 + h.rand() * 0.5,
        drag: 1.4,
        size0: 1.1,
        size1: 0.5,
        spin: (h.rand() - 0.5) * 4,
        seed: h.rand(),
        r: 0.85,
        g: 0.7,
        b: 1,
        a: 1,
      });
    }
    h.shakeAt(x, z, 0.7);
  }

  /** The Dirge was cut: the field and her aura are gone at once (ilvane_fx.ts
   *  plays the song shattering). */
  cut(): void {
    this.hideBar();
  }

  // ------------------------------------------------------------------ frame

  update(world: IWorld, ilvane: Entity | undefined, dt: number): void {
    this.drapeLeft = SIGHT_DRAPE_BUDGET;
    const casting = ilvane?.castingAbility;
    const singing =
      !!ilvane && !ilvane.dead && (casting === ILVANE_DIRGE || casting === ILVANE_UNBROKEN_DIRGE);
    if (singing && ilvane) this.paintBar(world, ilvane, casting as string, dt);
    else if (this.casterId >= 0) this.hideBar();
    this.paintOrgan(ilvane, singing, dt);
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scanIn = SCAN_SEC;
      this.scan(world, singing ? ilvane : undefined);
    }
    this.paintPlayers(world, singing ? ilvane : undefined);
    this.paintWave();
    this.notes.update(this.host.clock());
  }

  private hideBar(): void {
    this.casterId = -1;
    this.castId = '';
    this.fieldMesh.visible = false;
    this.shellDark.visible = false;
    this.shellGlow.visible = false;
    for (const b of this.beams) b.mesh.visible = false;
  }

  private measure(count: number): void {
    for (let k = 0; k < count; k++) {
      const ray = this.cursor;
      this.cursor = (this.cursor + 1) % NOVA_RAYS;
      this.rayX = this.sinA[ray];
      this.rayZ = this.cosA[ray];
      const reach = sightReach(this.clearAt, DIRGE_RADIUS);
      if (Math.abs(reach - this.reach[ray]) > 0.05) {
        this.reach[ray] = reach;
        this.field.setRay(this.reach, ray);
      }
    }
  }

  private paintBar(world: IWorld, ilvane: Entity, castId: string, dt: number): void {
    const h = this.host;
    const moved = Math.hypot(ilvane.pos.x - this.x, ilvane.pos.z - this.z) > RESEND_YARDS;
    if (this.casterId !== ilvane.id || this.castId !== castId || moved) {
      // A new bar (or a resend of where she stands): lay the field afresh.
      this.casterId = ilvane.id;
      this.castId = castId;
      this.x = ilvane.pos.x;
      this.z = ilvane.pos.z;
      this.y = h.groundY(this.x, this.z);
      this.reach.fill(DIRGE_RADIUS);
      this.field.begin(this.x, this.y, this.z, DIRGE_RADIUS, FIELD_LIFT);
      this.fieldMesh.position.set(this.x, this.y, this.z);
      this.cursor = 0;
      this.due = 0;
      const u = this.fieldMat.uniforms;
      const harsh = castId !== ILVANE_DIRGE;
      (u.uColor.value as THREE.Color).setHex(
        harsh ? TELEGRAPH_THREAT_COLORS.lethal : TELEGRAPH_THREAT_COLORS.danger,
      );
      u.uHarsh.value = harsh ? 1 : 0;
      this.seed = world.cfg.seed;
      this.from.x = ilvane.pos.x;
      this.from.y = ilvane.pos.y;
      this.from.z = ilvane.pos.z;
      this.measure(FIRST_RAYS);
      this.fieldMesh.visible = true;
    }
    this.drapeLeft -= this.field.drapeSome(h.groundY, this.drapeLeft);
    this.seed = world.cfg.seed;
    this.from.x = ilvane.pos.x;
    this.from.y = ilvane.pos.y;
    this.from.z = ilvane.pos.z;
    this.due = Math.min(MAX_RAYS_PER_FRAME, this.due + dt * RAYS_PER_SECOND);
    const now = Math.floor(this.due);
    this.due -= now;
    this.measure(now);
    const fill = telegraphFillOf(ilvane.castRemaining, ilvane.castTotal);
    const clock = h.clock();
    const l = telegraphLook(fill, clock, !h.low, this.look);
    const u = this.fieldMat.uniforms;
    const harsh = u.uHarsh.value > 0.5;
    u.uFill.value = fill;
    u.uBase.value = l.base;
    u.uFilled.value = l.filled;
    u.uFront.value = l.front;
    u.uRim.value = l.rim;
    u.uWarn.value = harsh ? Math.min(1, l.warn * 1.4 + 0.15 * fill) : l.warn;
    u.uDetail.value = l.detail;
    // Her aura, swelling with the bar (cosmetic).
    const swell = dirgeSwell(fill);
    this.shellUniforms.uPower.value = swell.power * (h.low ? 0.7 : 1);
    this.shellDark.position.set(this.x, this.y, this.z);
    this.shellDark.scale.set(swell.radius, swell.height, swell.radius);
    this.shellGlow.position.copy(this.shellDark.position);
    this.shellGlow.scale.set(swell.radius * 1.08, swell.height * 1.05, swell.radius * 1.08);
    this.shellDark.visible = true;
    this.shellGlow.visible = !h.low;
    // The shadow choir's voices and the notes leaving her.
    this.voice -= dt;
    while (this.voice <= 0) {
      this.voice += swell.voiceEvery / Math.max(0.3, h.density);
      const a = h.rand() * Math.PI * 2;
      const r = swell.radius * (0.7 + 0.4 * h.rand());
      const tang = 3 + 3 * fill;
      h.dust.emit(clock, {
        x: this.x + Math.sin(a) * r,
        y: this.y + 0.3 + h.rand() * 0.8,
        z: this.z + Math.cos(a) * r,
        vx: Math.cos(a) * tang - Math.sin(a) * 0.6,
        vy: 2.2 + 2.6 * fill,
        vz: -Math.sin(a) * tang - Math.cos(a) * 0.6,
        life: 1.3,
        drag: 1.3,
        size0: 1.1,
        size1: 2.6,
        ...SMOKE,
        a: 0.55 + 0.3 * fill,
      });
      if (h.rand() < 0.55) {
        const b = h.rand() * Math.PI * 2;
        this.notes.emit(clock, {
          x: this.x + Math.sin(b) * (swell.radius + 0.4),
          y: this.y + 1 + h.rand() * swell.height * 0.6,
          z: this.z + Math.cos(b) * (swell.radius + 0.4),
          vx: Math.cos(b) * 1.8,
          vy: 1.6 + 1.6 * fill,
          vz: -Math.sin(b) * 1.8,
          life: 1.4,
          drag: 0.6,
          size0: 0.8 + 0.5 * fill,
          size1: 0.35,
          spin: (h.rand() - 0.5) * 1.2,
          seed: h.rand(),
          ...SONG_RGB,
          a: 0.8,
        });
      }
    }
  }

  /** The Bone Organ kindles while she sings and cools after. */
  private paintOrgan(ilvane: Entity | undefined, singing: boolean, dt: number): void {
    const h = this.host;
    const fill = singing && ilvane ? telegraphFillOf(ilvane.castRemaining, ilvane.castTotal) : 0;
    const target = singing ? dirgeSwell(fill).power : 0;
    this.organPower += (target - this.organPower) * Math.min(1, dt * (singing ? 6 : 2.5));
    if (this.organPower < 0.01 || !ilvane) {
      this.organ.visible = false;
      return;
    }
    const o = cryptSlotOrigin(ilvane.pos.x, ilvane.pos.z);
    const ox = o.x + ORGAN_SPOT.x;
    const oz = o.z + ORGAN_SPOT.z;
    const oy = h.groundY(ox, oz - 2);
    this.organ.position.set(ox, oy, oz);
    this.organMat.uniforms.uPower.value = this.organPower;
    this.organ.visible = true;
    if (!singing || h.rand() > 0.35 * h.density * (0.4 + fill)) return;
    // A note or a breath of smoke off a pipe's mouth.
    const p = ORGAN_PIPES[Math.floor(h.rand() * ORGAN_PIPES.length)];
    if (!p) return;
    const clock = h.clock();
    this.notes.emit(clock, {
      x: o.x + p.x + (h.rand() - 0.5) * 0.6,
      y: oy + p.base + p.length,
      z: o.z + p.z - 0.4,
      vx: (h.rand() - 0.5) * 1.4,
      vy: 2 + 2 * fill,
      vz: -1.4 - h.rand() * 1.4,
      life: 1.5,
      drag: 0.5,
      size0: 1,
      size1: 0.45,
      spin: h.rand() - 0.5,
      seed: h.rand(),
      ...SONG_RGB,
      a: 0.85,
    });
  }

  /** Re-read who is in reach, who she can see, and who is silenced. */
  private scan(world: IWorld, ilvane: Entity | undefined): void {
    this.seenCount = 0;
    this.silenced.length = 0;
    const seed = world.cfg.seed;
    for (const e of world.entities.values()) {
      if (e.kind !== 'player' || e.dead) continue;
      if (silenceAura(e) && this.silenced.length < PLAYER_SLOTS) this.silenced.push(e.id);
      if (!ilvane || this.seenCount >= PLAYER_SLOTS) continue;
      const dx = e.pos.x - this.x;
      const dz = e.pos.z - this.z;
      if (dx * dx + dz * dz > DIRGE_RADIUS * DIRGE_RADIUS) continue;
      this.to.x = e.pos.x;
      this.to.y = e.pos.y;
      this.to.z = e.pos.z;
      this.from.x = ilvane.pos.x;
      this.from.y = ilvane.pos.y;
      this.from.z = ilvane.pos.z;
      const slot = this.seen[this.seenCount++];
      slot.id = e.id;
      slot.exposed = lineOfSightClear(seed, this.from, this.to, 0.05);
    }
    // A burst on each newly silenced player (once per silence).
    for (const id of this.silenceBurst)
      if (!this.silenced.includes(id)) this.silenceBurst.delete(id);
    const h = this.host;
    const now = h.clock();
    for (const id of this.silenced) {
      if (this.silenceBurst.has(id)) continue;
      this.silenceBurst.add(id);
      const p = world.entities.get(id);
      if (!p) continue;
      for (let i = 0; i < Math.round(18 * h.density); i++) {
        const a = h.rand() * Math.PI * 2;
        h.glow.emit(now, {
          x: p.pos.x,
          y: p.pos.y + 2.4,
          z: p.pos.z,
          vx: Math.sin(a) * 3,
          vy: (h.rand() - 0.2) * 3,
          vz: Math.cos(a) * 3,
          life: 0.6,
          drag: 2,
          size0: 0.7,
          size1: 0.15,
          ...SONG_RGB,
          a: 1,
        });
      }
    }
  }

  private paintPlayers(world: IWorld, ilvane: Entity | undefined): void {
    const h = this.host;
    const fill = ilvane ? telegraphFillOf(ilvane.castRemaining, ilvane.castTotal) : 0;
    let b = 0;
    let r = 0;
    for (let i = 0; i < this.seenCount; i++) {
      const s = this.seen[i];
      if (!ilvane) break;
      const p = world.entities.get(s.id);
      if (!p || p.dead) continue;
      const ring = this.rings[r++];
      const gy = h.groundY(p.pos.x, p.pos.z);
      ring.mesh.position.set(p.pos.x, gy + 0.09, p.pos.z);
      ring.mesh.scale.setScalar(s.exposed ? 1.25 : 1.05);
      const ru = ring.mat.uniforms;
      if (s.exposed) {
        (ru.uColor.value as THREE.Color).setHex(TELEGRAPH_THREAT_COLORS.danger);
        ru.uAlpha.value = 0.55 + 0.45 * fill;
        ru.uPulse.value = 1;
      } else {
        (ru.uColor.value as THREE.Color).setRGB(PALE.r, PALE.g, PALE.b);
        ru.uAlpha.value = 0.5;
        ru.uPulse.value = 0;
      }
      ring.mesh.visible = true;
      if (!s.exposed) continue;
      // Her voice reaching the one she sees.
      const beam = this.beams[b++];
      const bu = beam.mat.uniforms;
      (bu.uA.value as THREE.Vector3).set(ilvane.pos.x, this.y + DIRGE_VOICE_Y, ilvane.pos.z);
      (bu.uB.value as THREE.Vector3).set(p.pos.x, p.pos.y + 1.3, p.pos.z);
      bu.uAlpha.value = 0.35 + 0.65 * fill;
      bu.uWidth.value = 0.22 + 0.25 * fill;
      beam.mesh.visible = true;
    }
    for (; b < this.beams.length; b++) this.beams[b].mesh.visible = false;
    for (; r < this.rings.length; r++) this.rings[r].mesh.visible = false;
    // The silence marks over the silenced.
    let m = 0;
    for (const id of this.silenced) {
      const p = world.entities.get(id);
      const aura = p ? silenceAura(p) : undefined;
      if (!p || !aura || p.dead) continue;
      const mark = this.marks[m++];
      const k = silenceMark(aura.remaining, aura.duration);
      mark.mat.uniforms.uAlpha.value = k;
      mark.mesh.position.set(p.pos.x, p.pos.y + 3.1 + 0.08 * Math.sin(h.clock() * 3 + id), p.pos.z);
      mark.mesh.scale.setScalar(0.62 * silenceMarkScale(aura.remaining, aura.duration));
      mark.mesh.visible = k > 0.01;
    }
    for (; m < this.marks.length; m++) this.marks[m].mesh.visible = false;
  }

  private paintWave(): void {
    if (!this.waveAlive) return;
    const h = this.host;
    const elapsed = h.clock() - this.waveBorn;
    if (elapsed > DIRGE_WAVE_SECONDS + DIRGE_WAVE_LINGER) {
      this.waveAlive = false;
      this.waveMesh.visible = false;
      this.curtain.visible = false;
      return;
    }
    this.drapeLeft -= this.waveSurface.drapeSome(h.groundY, this.drapeLeft);
    const wave = dirgeWave(elapsed);
    this.waveMat.uniforms.uFront.value = wave.front;
    this.waveMat.uniforms.uAlpha.value = wave.alpha;
    const racing = elapsed < DIRGE_WAVE_SECONDS;
    this.curtainMat.uniforms.uAlpha.value = racing ? 0.85 : Math.max(0, wave.alpha - 0.35);
    if (!this.curtain.visible) return;
    const cp = this.curtain.geometry.getAttribute('position') as THREE.BufferAttribute;
    const now = h.clock();
    for (let ray = 0; ray < NOVA_RAYS; ray++) {
      const reach = this.waveReach[ray];
      const d = Math.min(wave.front, reach);
      const wx = this.waveX + this.sinA[ray] * d;
      const wz = this.waveZ + this.cosA[ray] * d;
      const gy = h.groundY(wx, wz) - this.waveY;
      cp.setXYZ(ray * 2, wx - this.waveX, gy, wz - this.waveZ);
      cp.setXYZ(ray * 2 + 1, wx - this.waveX, gy + 3.4, wz - this.waveZ);
      // The sound slams into the pillar that stops it: dark spray at the face.
      if (racing && this.splashed[ray] === 0 && reach < DIRGE_RADIUS - 0.3 && wave.front >= reach) {
        this.splashed[ray] = 1;
        h.dust.emit(now, {
          x: wx,
          y: gy + this.waveY + 1.2,
          z: wz,
          vx: -this.sinA[ray] * 2.4,
          vy: 1.8,
          vz: -this.cosA[ray] * 2.4,
          life: 1,
          drag: 2,
          size0: 1.2,
          size1: 2.8,
          ...SMOKE,
          a: 0.6,
        });
        h.glow.emit(now, {
          x: wx,
          y: gy + this.waveY + 1.5,
          z: wz,
          vx: -this.sinA[ray] * 3,
          vy: 2.5,
          vz: -this.cosA[ray] * 3,
          life: 0.45,
          drag: 2,
          size0: 0.5,
          size1: 0.1,
          ...SONG_RGB,
          a: 1,
        });
      }
    }
    cp.needsUpdate = true;
  }
}
