// The Guardian of the Heat's entrance as numbers (docs/design/raid/
// smith_heart.md section 7.4, "The entrance"): the pure half of
// heat_entrance_fx.ts and of the entrance's hooks in the body
// (heat_body.ts) and the wellspring (heat_well_fx.ts).
//
// The sim holds the guardian cold until the raid first comes near, then runs
// the scene's clock on one aura (encounters/smith_heart/heat_intro.ts); this
// module reads that clock (`heatEntranceClock`), keeps the painter's own
// smooth scene time on it (`stepEntranceTime`: a late joiner starts where
// the scene is, a scene seen ending runs on to its tail, one never seen is
// simply awake) and plans every beat (`heatEntranceLook`):
//
//   cold       grey embers on the floor, thin smoke, the giant dark as cold
//              coal, its wellspring crusted over
//   0 to 3.2   the embers ignite in a spiral inward to it; its body catches
//              fire from its foot to its crown; the wellspring kindles
//   sentence 1 (contempt) a crown of flame on its head, a heat haze round
//              it, sparks rising
//   sentence 2 (anger) flames pour off its shoulders and arms, the floor
//              cracks round it in glowing seams, a rain of embers
//   the shout  it explodes: a column of fire to the sky, a ring of fire
//              racing across the floor toward the raid (cosmetic, no
//              damage), the camera's thud, an orange flash
//   after      full blaze; the floor's seams and the rain cool away
//
// The beats ride the voice clip's own turns (HEAT_INTRO_VOICE, measured on
// the shipped clip), counted from the sim's HEAT_INTRO.speakAt.
//
// Presentation only, every tier (the low tier thins counts, never a beat).
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic (a hash,
// never rng).

import { FORGE_POINTS, HEARTH_WELL } from '../../sim/content/smith_heart_layout';
import { HEAT_AURAS } from '../../sim/encounters/smith_heart/heat_ids';
import { HEAT_INTRO, HEAT_INTRO_STAGES } from '../../sim/encounters/smith_heart/heat_intro_plan';
import { HEAT_BODY_CLIP, HEAT_MODEL_LAVA, HEAT_SOCKETS, type HeatSocketId } from './heat_body_core';

// ---- the clock -----------------------------------------------------------------------------

/** The entrance line's beats in its shipped clip (public/audio/voice/
 *  heart_heat_guardian, the `heat.intro` line), seconds from the clip's
 *  start, measured with ffmpeg (silencedetect at -35 dB, 0.18 s, and a 50 ms
 *  loudness envelope): "Insects.", "You crawl...", "I was burning...", "Then
 *  burn with it!", the shout's loudest word ("burn") and the clip's end. A
 *  new take of the line is measured again and written here. */
export const HEAT_INTRO_VOICE = {
  insects: 0.1,
  crawl: 1.62,
  burning: 5.66,
  thenBurn: 9.38,
  shout: 9.9,
  end: 10.82,
} as const;

const SPEAK = HEAT_INTRO.speakAt;
const V = HEAT_INTRO_VOICE;

/** The scene's beats, seconds from the wake (the sim's clock). */
export const HEAT_ENTRANCE = {
  /** The embers' spiral of ignition, rim to wellspring. */
  spiralFrom: 0,
  spiralTo: 2.4,
  /** The body catching fire, its foot to its crown. */
  igniteFrom: 0.5,
  igniteTo: 3.1,
  /** Sentence 1 (contempt): the crown of flame, the haze, the sparks. */
  crownAt: SPEAK + V.insects,
  /** Sentence 2 (anger): the shoulders and arms pour fire, the floor
   *  cracks, the embers rain. */
  rageAt: SPEAK + V.burning,
  /** The cracks' run out to their tips. */
  cracksFor: 3.2,
  /** The shout begins: it gathers. */
  gatherAt: SPEAK + V.thenBurn,
  /** It explodes, on the shout's loudest word. */
  blastAt: SPEAK + V.shout,
  /** The column: its climb, how long it stands, its fall. */
  columnRise: 0.45,
  columnHold: 1.6,
  columnFall: 2.1,
  /** The column's height (yards over the wellspring: past the Hearth's
   *  smoke) and its radius at the root. */
  columnHeight: 78,
  columnRadius: 7.5,
  /** The ring of fire: from the wellspring's lip out past the raid. */
  ringFrom: HEARTH_WELL.r + 1,
  ringTo: 72,
  ringFor: 2.3,
  /** The orange flash: up in a breath, gone in half a second. */
  flashFor: 0.55,
  flashPeak: 0.3,
  /** The camera's thud at the blast (the shake sink's amount, at the
   *  wellspring; it falls off over `shakeReach`). */
  shake: 1.1,
  shakeReach: 110,
  /** The scene's tail: the seams, the rain and the haze cooled away. */
  end: SPEAK + V.shout + 4.2,
} as const;

/** The gesture lead: the Throw clip's release lands on the blast. */
export const HEAT_ENTRANCE_THROW_AT = HEAT_ENTRANCE.blastAt - HEAT_BODY_CLIP.throwRelease;

/** What the guardian's aura says: cold, waking at `t`, or neither. */
export interface HeatEntranceClock {
  stage: 'none' | 'cold' | 'waking';
  t: number;
}

/** Read the entrance off the guardian's auras (allocation free). */
export function heatEntranceClock(
  auras: readonly { id: string; value: number; remaining: number; duration: number }[],
  out: HeatEntranceClock = { stage: 'none', t: 0 },
): HeatEntranceClock {
  out.stage = 'none';
  out.t = 0;
  for (const a of auras) {
    if (a.id !== HEAT_AURAS.intro) continue;
    if (Math.round(a.value) === HEAT_INTRO_STAGES.waking) {
      out.stage = 'waking';
      const total = a.duration > 0 ? a.duration : HEAT_INTRO.seconds;
      out.t = Math.max(0, Math.min(total, total - a.remaining));
    } else out.stage = 'cold';
    break;
  }
  return out;
}

/** The painter's scene time: `COLD` while it waits, `AWAKE` once it has
 *  burned up (or was never seen waking), else seconds into the scene. */
export const COLD = -1;
export const AWAKE = -2;

/** How far the painter's own time may drift off the aura's before it
 *  snaps back (a stalled tab, a late snapshot). */
export const ENTRANCE_DRIFT = 0.35;

/**
 * Step the painter's scene time `prev` by `dt` against the aura's `clock`:
 * cold holds COLD; waking runs smoothly on the aura's time (a scene first
 * seen mid-way starts where it is); a scene that has been seen keeps running
 * after the aura is gone, to its tail, then AWAKE; a guardian never seen
 * waking is AWAKE (a late joiner sees it burning).
 */
export function stepEntranceTime(prev: number, dt: number, clock: HeatEntranceClock): number {
  if (clock.stage === 'cold') return COLD;
  if (clock.stage === 'waking') {
    if (prev < 0) return clock.t;
    const next = prev + dt;
    return Math.abs(next - clock.t) > ENTRANCE_DRIFT ? clock.t : next;
  }
  if (prev < 0) return AWAKE;
  const next = prev + dt;
  return next >= HEAT_ENTRANCE.end ? AWAKE : next;
}

// ---- the look ------------------------------------------------------------------------------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
/** 0 before `a`, 1 by `b`, eased out. */
const rise = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return 1 - (1 - k) * (1 - k);
};

/** Each socket's height up the body, 0 at the lava, 1 at the crown. */
const TOP = Math.max(...HEAT_SOCKETS.map((s) => s.at[1]));
export const SOCKET_HEIGHT: readonly number[] = HEAT_SOCKETS.map((s) =>
  clamp01((s.at[1] - HEAT_MODEL_LAVA) / (TOP - HEAT_MODEL_LAVA)),
);
const idx = (id: HeatSocketId) => HEAT_SOCKETS.findIndex((s) => s.id === id);
const CROWN = [idx('crown'), idx('hornL'), idx('hornR')];
const RAGE = [idx('shoulderL'), idx('shoulderR'), idx('back'), idx('fistL'), idx('fistR')];

export interface HeatEntranceLook {
  /** The scene is on (or the guardian waits cold): false once awake. */
  active: boolean;
  /** Waiting cold. */
  cold: boolean;
  /** Seconds into the scene (0 while cold). */
  t: number;
  /** The embers' spiral of ignition (0 none lit, 1 all). */
  spiral: number;
  /** The cold embers' grey (1 cold, fading as they burn and after). */
  ash: number;
  /** The lit embers' heat (they cool after the blast). */
  embers: number;
  /** The spiral's lit path (it settles low once the floor cracks, so the
   *  seams lead the second sentence, and cools after the blast). */
  trail: number;
  /** The body's fire front, its foot (0) to its crown (1). */
  front: number;
  /** The tongues' strength (0 none: the body's fire hidden). */
  fire: number;
  /** Each socket's fire size (HEAT_SOCKETS order; 0 out, 1 at rest). */
  socket: number[];
  /** The model's own glow (emissive, 1 as authored) and its colour's
   *  share (cold coal is darker). */
  glow: number;
  coal: number;
  /** The eyes, the heart's ring, the vortex at its foot (0..1). */
  eyes: number;
  vortex: number;
  /** The wellspring's kindling (0 crusted over, 1 as in the fight). */
  well: number;
  /** The crown of flame, the haze, the rising sparks, the anger (0..1). */
  crown: number;
  haze: number;
  sparks: number;
  rage: number;
  /** The floor's seams: how far they have run out (0..1) and their heat. */
  cracks: number;
  crackHeat: number;
  /** The rain of embers (0..1, past 1 right after the blast). */
  rain: number;
  /** Seconds since the blast (negative before). */
  sinceBlast: number;
  /** The column: its height share, radius share and brightness. */
  columnH: number;
  columnR: number;
  column: number;
  /** The ring of fire: its radius (yards) and brightness. */
  ringR: number;
  ring: number;
  /** The orange flash's opacity. */
  flash: number;
  /** The smoke off the cold hearth (per second, before the tier). */
  smoke: number;
}

export function newHeatEntranceLook(): HeatEntranceLook {
  return {
    active: false,
    cold: false,
    t: 0,
    spiral: 0,
    ash: 0,
    embers: 0,
    trail: 0,
    front: 1,
    fire: 1,
    socket: HEAT_SOCKETS.map(() => 1),
    glow: 1,
    coal: 1,
    eyes: 1,
    vortex: 1,
    well: 1,
    crown: 0,
    haze: 0,
    sparks: 0,
    rage: 0,
    cracks: 0,
    crackHeat: 0,
    rain: 0,
    sinceBlast: -99,
    columnH: 0,
    columnR: 0,
    column: 0,
    ringR: 0,
    ring: 0,
    flash: 0,
    smoke: 0,
  };
}

/** The awake look: everything as the fight has it, no scene (written in
 *  place: the painter asks every frame). */
function awake(out: HeatEntranceLook): HeatEntranceLook {
  out.active = false;
  out.cold = false;
  out.t = 0;
  out.spiral = 1;
  out.ash = 0;
  out.embers = 0;
  out.trail = 0;
  out.front = 1;
  out.fire = 1;
  for (let i = 0; i < out.socket.length; i++) out.socket[i] = 1;
  out.glow = 1;
  out.coal = 1;
  out.eyes = 1;
  out.vortex = 1;
  out.well = 1;
  out.crown = 0;
  out.haze = 0;
  out.sparks = 0;
  out.rage = 0;
  out.cracks = 0;
  out.crackHeat = 0;
  out.rain = 0;
  out.sinceBlast = -99;
  out.columnH = 0;
  out.columnR = 0;
  out.column = 0;
  out.ringR = 0;
  out.ring = 0;
  out.flash = 0;
  out.smoke = 0;
  return out;
}

/**
 * The scene at painter time `time` (COLD, AWAKE or seconds in), written into
 * `out` (allocation free once built).
 */
export function heatEntranceLook(
  time: number,
  out: HeatEntranceLook = newHeatEntranceLook(),
): HeatEntranceLook {
  if (time === AWAKE || time >= HEAT_ENTRANCE.end) return awake(out);
  const E = HEAT_ENTRANCE;
  const cold = time === COLD;
  const t = cold ? 0 : Math.max(0, time);
  out.active = true;
  out.cold = cold;
  out.t = t;
  const since = cold ? -99 : t - E.blastAt;
  out.sinceBlast = since;
  // The spiral and the body's ignition.
  out.spiral = cold ? 0 : rise(E.spiralFrom, E.spiralTo, t);
  out.front = cold ? 0 : smooth(E.igniteFrom, E.igniteTo, t);
  out.fire = cold ? 0 : clamp01(out.front * 1.6);
  const tail = since > 0 ? clamp01(since / (E.end - E.blastAt)) : 0;
  out.ash = cold ? 1 : 1 - rise(0, E.spiralTo + 1.2, t);
  out.embers = cold ? 0 : 1 - smooth(E.blastAt + 1.5, E.end, t);
  out.trail = cold ? 0 : out.embers * (1 - 0.65 * smooth(E.spiralTo + 0.8, E.rageAt + 0.6, t));
  out.glow = cold ? 0.02 : 0.02 + 0.98 * smooth(E.igniteFrom, E.igniteTo + 0.4, t);
  out.coal = cold ? 0.24 : 0.24 + 0.76 * smooth(E.igniteFrom, E.igniteTo + 0.6, t);
  out.eyes = cold ? 0.08 : Math.max(0.08, smooth(E.igniteTo - 0.6, E.igniteTo + 0.3, t));
  out.vortex = cold ? 0.04 : 0.04 + 0.96 * smooth(E.igniteFrom, E.igniteFrom + 1.2, t);
  out.well = cold ? 0.14 : 0.14 + 0.86 * smooth(E.spiralTo - 0.6, E.spiralTo + 0.8, t);
  // The three turns of the voice.
  out.crown = cold ? 0 : rise(E.crownAt, E.crownAt + 0.9, t) * (1 - 0.6 * clamp01(since / 2));
  out.haze = cold ? 0 : rise(E.crownAt, E.crownAt + 1.6, t) * (1 - tail);
  out.rage = cold ? 0 : rise(E.rageAt, E.rageAt + 1.2, t) * (1 - 0.7 * clamp01(since / 3));
  out.sparks = cold
    ? 0
    : 0.55 * rise(E.crownAt, E.crownAt + 1, t) + 0.45 * rise(E.rageAt, E.rageAt + 1, t);
  if (since > 0) out.sparks *= 1 - tail;
  out.cracks = cold ? 0 : rise(E.rageAt + 0.2, E.rageAt + 0.2 + E.cracksFor, t);
  out.crackHeat = out.cracks * (since > 0 ? (1 + 0.8 * Math.exp(-since * 2.2)) * (1 - tail) : 1);
  out.rain = cold
    ? 0
    : rise(E.rageAt + 0.8, E.gatherAt, t) *
      (since > 0 ? (1 + 0.6 * Math.exp(-since)) * (1 - tail) : 1);
  // The blast.
  if (since >= 0) {
    out.columnH = rise(0, E.columnRise, since);
    const fall = clamp01((since - E.columnRise - E.columnHold) / E.columnFall);
    out.columnR = 1 - 0.55 * fall;
    out.column = (0.75 + 0.25 * Math.exp(-since * 3)) * (1 - fall * fall);
    const k = clamp01(since / E.ringFor);
    out.ringR = E.ringFrom + (E.ringTo - E.ringFrom) * (1 - (1 - k) ** 2.2);
    out.ring = since < E.ringFor ? (1 - k) ** 0.7 : 0;
    out.flash =
      since < E.flashFor
        ? E.flashPeak * Math.min(1, since / 0.05) * (1 - since / E.flashFor) ** 2
        : 0;
  } else {
    out.columnH = 0;
    out.columnR = 1;
    out.column = 0;
    out.ringR = 0;
    out.ring = 0;
    out.flash = 0;
  }
  out.smoke = cold ? 3 : 3 * (1 - out.spiral);
  // Each socket: lit as the front passes it, the crown and the anger
  // growing their own, everything roaring past its size in the blast and
  // settling back to the fight's full blaze.
  const surge =
    since > 0 ? 1.1 * Math.exp(-since * 1.4) : since > -0.6 ? 0.4 * (1 + since / 0.6) : 0;
  for (let i = 0; i < SOCKET_HEIGHT.length; i++) {
    const h = SOCKET_HEIGHT[i];
    let k = cold ? 0 : smooth(h - 0.12, h + 0.04, out.front * 1.12);
    if (CROWN.includes(i)) k *= 1 + 1.7 * out.crown;
    if (RAGE.includes(i)) k *= 1 + 1.15 * out.rage;
    out.socket[i] = k * (1 + surge);
  }
  return out;
}

/** Did the scene cross the beat `at` between painter times `prev` and `t`?
 *  Never for a scene joined late (`prev` not a scene time) or while cold:
 *  a late joiner plays no one-shot it missed. */
export function crossedBeat(prev: number, t: number, at: number): boolean {
  return prev >= 0 && t >= 0 && prev < at && t >= at;
}

/** The flash's opacity: none under reduced motion (as no thud). */
export function entranceFlash(look: HeatEntranceLook, reducedMotion: boolean): number {
  return reducedMotion ? 0 : look.flash;
}

/** The blast's thud for a player `distance` yards from the guardian: none
 *  under reduced motion or past the reach, else falling off with distance. */
export function entranceShake(distance: number, reducedMotion: boolean): number {
  const E = HEAT_ENTRANCE;
  if (reducedMotion || distance >= E.shakeReach) return 0;
  return E.shake * (1 - (distance / E.shakeReach) * 0.6);
}

/** The low tier's share of the embers and particles (counts only). */
export const ENTRANCE_LOW_SHARE = 0.4;

/** The embers a tier draws: every k-th of the plan, so the low tier's spiral
 *  stays whole (indices into ENTRANCE_EMBERS). */
export function entranceEmberPicks(detail: boolean): number[] {
  const all = ENTRANCE_EMBERS.length;
  const count = detail ? all : Math.round(all * ENTRANCE_LOW_SHARE);
  const step = all / count;
  const picks: number[] = [];
  for (let i = 0; i < count; i++) picks.push(Math.min(all - 1, Math.floor(i * step)));
  return picks;
}

/** A socket's fire under the scene (`k` its fight size): the scene's share,
 *  1 when awake. */
export function entranceSocketFire(look: HeatEntranceLook | null, i: number, k: number): number {
  return look?.active ? k * (look.socket[i] ?? 1) : k;
}

/** The wellspring's look under the scene: crusted over while it waits,
 *  kindling as the spiral reaches it (`look` null: as the fight has it). */
export function kindleWellLook<T extends { heat: number; boil: number; pulse: number }>(
  w: T,
  look: HeatEntranceLook | null,
): T {
  if (!look?.active) return w;
  const k = look.well;
  w.heat *= k;
  w.boil *= 0.3 + 0.7 * k;
  w.pulse *= k;
  return w;
}

// ---- the embers: a spiral of cold coals round the wellspring -------------------------------

/** Deterministic hash in [0, 1). */
export function entranceHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Is (x, z) (instance-local) on the Hearth's floor? */
function onFloor(x: number, z: number): boolean {
  let inside = false;
  const pts = FORGE_POINTS;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The spiral: its arms, its turns, its reach (yards off the wellspring). */
export const EMBER_SPIRAL = {
  arms: 3,
  turns: 1.15,
  outer: 46,
  inner: HEARTH_WELL.r + 1.2,
  /** Yards an ember strays off its arm. */
  stray: 2.4,
  /** Embers on the arms and scattered between them (the ring lights the
   *  scattered ones). */
  onArms: 760,
  scattered: 420,
} as const;

/** One ember: its place off the wellspring's middle, its turn in the
 *  spiral's ignition (0 first, at the rim; 1 last, at the wellspring; past 1
 *  for a scattered one the spiral never reaches), its size. */
export interface EntranceEmber {
  x: number;
  z: number;
  order: number;
  size: number;
  seed: number;
}

/** Every ember (instance-local offsets from HEARTH_WELL), the low tier's
 *  share first-come (every k-th is kept). */
export const ENTRANCE_EMBERS: readonly EntranceEmber[] = (() => {
  const out: EntranceEmber[] = [];
  const S = EMBER_SPIRAL;
  let n = 0;
  for (let i = 0; i < S.onArms + S.scattered && n < 40000; n++) {
    const arm = i < S.onArms;
    let x: number;
    let z: number;
    let order: number;
    if (arm) {
      const s = entranceHash(n, 3) ** 0.85;
      const a = (n % S.arms) / S.arms;
      const r = S.outer - (S.outer - S.inner) * s;
      const theta = (a + S.turns * s) * Math.PI * 2;
      const off = (entranceHash(n, 5) - 0.5) * 2 * S.stray * (0.4 + 0.6 * (1 - s));
      x = Math.cos(theta) * (r + off);
      z = Math.sin(theta) * (r + off);
      order = s;
    } else {
      const r = S.inner + 1 + (S.outer + 8 - S.inner) * Math.sqrt(entranceHash(n, 7));
      const theta = entranceHash(n, 11) * Math.PI * 2;
      x = Math.cos(theta) * r;
      z = Math.sin(theta) * r;
      order = 1.5;
    }
    if (!onFloor(HEARTH_WELL.x + x, HEARTH_WELL.z + z)) continue;
    if (Math.hypot(x, z) < HEARTH_WELL.r + 0.6) continue;
    out.push({
      x,
      z,
      order,
      size: (arm ? 0.8 : 0.6) + 0.9 * entranceHash(n, 13) ** 2,
      seed: entranceHash(n, 17),
    });
    i++;
  }
  return out;
})();

// ---- the cracks: glowing seams run out from the wellspring ---------------------------------

/** A seam's point: its place off the wellspring, its reveal (0 at the lip,
 *  1 at the farthest tip of any seam) and its half width (yards). */
export interface CrackPoint {
  x: number;
  z: number;
  reveal: number;
  half: number;
}

export const CRACKS = {
  main: 16,
  /** Points per main seam and per branch. */
  steps: 16,
  branchSteps: 8,
  /** A main seam's reach off the lip (yards), its jitter, its width. */
  reachMin: 22,
  reachMax: 44,
  jag: 0.5,
  width: 0.95,
} as const;

/** Every seam as a polyline (main seams, then their branches), clipped at
 *  the floor's edge. */
export const ENTRANCE_CRACKS: readonly (readonly CrackPoint[])[] = (() => {
  const C = CRACKS;
  const lip = HEARTH_WELL.r + 0.4;
  const far = lip + C.reachMax;
  const lines: CrackPoint[][] = [];
  const grow = (
    x0: number,
    z0: number,
    bearing: number,
    reach: number,
    steps: number,
    half0: number,
    seed: number,
  ): CrackPoint[] => {
    const pts: CrackPoint[] = [];
    let x = x0;
    let z = z0;
    let b = bearing;
    const step = reach / steps;
    for (let k = 0; k <= steps; k++) {
      if (!onFloor(HEARTH_WELL.x + x, HEARTH_WELL.z + z)) break;
      const d = Math.hypot(x, z);
      const taper = 1 - k / (steps + 1);
      pts.push({
        x,
        z,
        reveal: clamp01((d - lip) / (far - lip)),
        half: half0 * (0.25 + 0.75 * taper),
      });
      b += (entranceHash(seed, k * 7 + 1) - 0.5) * 2 * C.jag;
      x += Math.cos(b) * step;
      z += Math.sin(b) * step;
    }
    return pts;
  };
  for (let i = 0; i < C.main; i++) {
    const bearing = (i / C.main) * Math.PI * 2 + (entranceHash(i, 23) - 0.5) * 0.3;
    const reach = C.reachMin + (C.reachMax - C.reachMin) * entranceHash(i, 29);
    const main = grow(
      Math.cos(bearing) * lip,
      Math.sin(bearing) * lip,
      bearing,
      reach,
      C.steps,
      C.width * (0.8 + 0.4 * entranceHash(i, 31)),
      i * 101 + 7,
    );
    if (main.length < 3) continue;
    lines.push(main);
    // One or two branches off its middle.
    const branches = 1 + (entranceHash(i, 37) < 0.5 ? 1 : 0);
    for (let j = 0; j < branches; j++) {
      const at =
        main[
          Math.min(main.length - 2, 3 + Math.floor(entranceHash(i, 41 + j) * (main.length - 4)))
        ];
      const side = entranceHash(i, 43 + j) < 0.5 ? -1 : 1;
      const b0 = Math.atan2(at.z, at.x) + side * (0.5 + 0.4 * entranceHash(i, 47 + j));
      const br = grow(
        at.x,
        at.z,
        b0,
        reach * 0.42,
        C.branchSteps,
        at.half * 0.7,
        i * 211 + j * 17 + 3,
      );
      if (br.length >= 3) lines.push(br);
    }
  }
  return lines;
})();

// ---- the spiral's path: the trail of ash the fire runs along -------------------------------

/** Each arm of the spiral as a path (its points every `SPIRAL_STEP` yards
 *  or so, `reveal` its turn in the ignition, the same as its embers'). */
export const SPIRAL_STEP = 1.6;
export const SPIRAL_HALF = 0.85;

export const ENTRANCE_SPIRAL: readonly (readonly CrackPoint[])[] = (() => {
  const S = EMBER_SPIRAL;
  const lines: CrackPoint[][] = [];
  for (let a = 0; a < S.arms; a++) {
    const pts: CrackPoint[] = [];
    // Arc length of the arm, walked by the order s.
    const n = 160;
    let lastX = Number.NaN;
    let lastZ = Number.NaN;
    for (let k = 0; k <= n; k++) {
      const sOrder = k / n;
      const r = S.outer - (S.outer - S.inner) * sOrder;
      const theta = (a / S.arms + S.turns * sOrder) * Math.PI * 2;
      const wob = (entranceHash(a * 997 + k, 61) - 0.5) * 0.9;
      const x = Math.cos(theta) * (r + wob);
      const z = Math.sin(theta) * (r + wob);
      if (Number.isFinite(lastX) && Math.hypot(x - lastX, z - lastZ) < SPIRAL_STEP && k < n)
        continue;
      if (!onFloor(HEARTH_WELL.x + x, HEARTH_WELL.z + z)) {
        // Off the floor: the path breaks (a new line from the next point on).
        if (pts.length >= 2) lines.push(pts.splice(0));
        else pts.length = 0;
        lastX = Number.NaN;
        continue;
      }
      pts.push({ x, z, reveal: sOrder, half: SPIRAL_HALF * (0.75 + 0.5 * entranceHash(a, k)) });
      lastX = x;
      lastZ = z;
    }
    if (pts.length >= 2) lines.push(pts);
  }
  return lines;
})();

/** The spiral's vertex count (two a point). */
export const SPIRAL_VERTICES = ENTRANCE_SPIRAL.reduce((n, l) => n + l.length * 2, 0);

/** The seams' vertex count as a strip pair per point (the painter's buffer). */
export const CRACK_VERTICES = ENTRANCE_CRACKS.reduce((n, l) => n + l.length * 2, 0);

// ---- the pools -----------------------------------------------------------------------------

export const HEAT_ENTRANCE_POOLS = {
  /** The column's layers (the fire, its white-gold core). */
  columnLayers: 2,
  /** Sparks a second off the body at full `sparks`, the rain's embers a
   *  second at full `rain` (before the tier's density). */
  sparkRate: 70,
  rainRate: 200,
  /** The rain's cloud: its reach off the wellspring and its height. */
  rainReach: 62,
  rainHeight: 34,
  /** Flame licks along the spiral's front a second. */
  frontRate: 90,
} as const;
