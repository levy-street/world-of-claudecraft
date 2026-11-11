// The Hammer Council's entrance as numbers (docs/design/raid/smith_heart.md
// section 7.1, "The entrance"), "The quarry wakes": the pure half of
// council_entrance_fx.ts and its two parts (council_entrance_stone.ts, the
// Guardian's rock; council_entrance_crystal.ts, the Seam Singer's vein).
//
// The sim holds both members asleep until the raid first comes down into the
// Quarry, then runs the scene's clock on one aura on each (encounters/
// smith_heart/council_intro.ts); this module reads that clock
// (`councilEntranceClock`), keeps the painter's own smooth scene time on it
// (`stepCouncilEntranceTime`: a late joiner starts where the scene is, a
// scene seen ending runs on to its tail, one cut short breaks both out at
// once, one never seen is simply awake) and plans every beat
// (`councilEntranceLook`):
//
//   dormant    the Guardian fused into a spur of the quarry's rock, its
//              shape only hinted at between the stones, dark and grey, a
//              slow light breathing deep inside it; the Seam Singer asleep
//              inside a vein of amber crystal, her curled silhouette seen
//              through it, the crystal glowing faintly
//   the thrum  the ground starts to hum: a deep rumble, dust trickling off
//              the terraces, pebbles hopping on the floor; the five carved
//              columns light one by one, their runes climbing to the top
//   the tear   glowing cracks race up the rock round the Guardian (as it
//              says "Strangers in the Quarry."), then it rips itself out: the
//              spur bursts into rubble and great slabs that tumble and land,
//              a cloud of dust; on "flesh" it punches the ground and a ring of
//              stone and dust rolls out across the raid (cosmetic: no damage,
//              no knockback) with a heavy thud
//   the song   the crystal vein rings like a rising note, rings of resonance
//              pulsing off it faster and faster; it shatters in a bright
//              burst ("Hear the seam sing?") and she floats out, shards of
//              crystal orbiting her
//   the note   she hits a high note ("...your voices"): every crystal in the
//              room resonates at once in a wave of light racing out across
//              the quarry; her shards fly out with it; the fight is hers
//
// The beats ride the two voice clips' own words (COUNCIL_INTRO_VOICE,
// measured on the shipped clips), counted from the sim's speak beats.
//
// Presentation only, every tier (the low tier thins counts, never a beat;
// reduced motion drops the thuds and the flashes and caps the added light).
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic (a hash,
// never rng).

import { SMITH_HEART_COUNCIL_FACING } from '../../sim/content/smith_heart';
import {
  HAMMER_PIT,
  QUARRY_PILLAR_SPOTS,
  SMITH_HEART_BOSS_SPOTS,
  SMITH_HEART_FIELD,
} from '../../sim/content/smith_heart_layout';
import { COUNCIL_AURAS } from '../../sim/encounters/smith_heart/council_ids';
import {
  COUNCIL_INTRO,
  COUNCIL_INTRO_STAGES,
} from '../../sim/encounters/smith_heart/council_intro_plan';
import { COUNCIL_GROW } from './council_bodies_core';

/** How much bigger each member is drawn than the set pieces were first
 *  authored for (council_bodies_core.ts `COUNCIL_GROW`): the rock, the vein,
 *  her shards and the anchors on their bodies grow by it. */
export const COUNCIL_ENTRANCE_GROW = COUNCIL_GROW;
const GG = COUNCIL_GROW.guardian;
const SG = COUNCIL_GROW.singer;

/** Where the Singer stands off the Guardian (yards, world axes) and each
 *  one's bearing to the other in its own frame (radians, 0 its front, as the
 *  plans' angles: x = sin, z = cos), at their spawn facing. The two stand
 *  some 9.5 yd apart, so the rock and the vein lean away from each other. */
export const COUNCIL_PAIR = (() => {
  const dx = SMITH_HEART_BOSS_SPOTS.seamSinger.x - SMITH_HEART_BOSS_SPOTS.hammer.x;
  const dz = SMITH_HEART_BOSS_SPOTS.seamSinger.z - SMITH_HEART_BOSS_SPOTS.hammer.z;
  const toSinger = Math.atan2(dx, dz);
  return {
    dx,
    dz,
    apart: Math.hypot(dx, dz),
    guardianToSinger: toSinger - SMITH_HEART_COUNCIL_FACING,
    singerToGuardian: toSinger + Math.PI - SMITH_HEART_COUNCIL_FACING,
  } as const;
})();

/** How squarely a plan angle `a` faces bearing `b` (0 off to the side or
 *  behind, 1 straight at it). */
export function councilFacingShare(a: number, b: number): number {
  return Math.max(0, Math.cos(a - b));
}

// ---- the clock -----------------------------------------------------------------------------

/** The entrance lines' words in their shipped clips (public/audio/voice/
 *  heart_hammer_guardian and heart_seam_singer, the council's two pull
 *  lines), seconds from each clip's start, measured with ffmpeg
 *  (silencedetect at -30 dB, 0.08 s, and a 50 ms loudness envelope). The
 *  Guardian: "Strangers in the Quarry.", its pause, "The Hammer's strength
 *  does not yield to flesh.", the word "flesh", the clip's end. The Singer:
 *  "Hear the seam sing?", its breath, "It has waited so long for your
 *  voices.", the word "voices", the clip's end (its last sound: each file
 *  trails a breath of silence). A new take of either line is
 *  measured again and written here. */
export const COUNCIL_INTRO_VOICE = {
  guardian: { strangers: 0.27, quarryEnd: 2.1, hammer: 2.84, flesh: 5.3, end: 5.9 },
  singer: { hear: 0.06, singEnd: 1.55, waited: 1.7, voices: 4.35, end: 5.25 },
} as const;

const G = COUNCIL_INTRO.guardianSpeakAt;
const S = COUNCIL_INTRO.singerSpeakAt;
const VG = COUNCIL_INTRO_VOICE.guardian;
const VS = COUNCIL_INTRO_VOICE.singer;

/** The Awaken clips' beats (both rigs ship one: a still crouch, then the rise;
 *  seconds into the clip): when the body starts to move out of the crouch. */
export const COUNCIL_AWAKEN_CLIP = {
  guardianBurst: 0.55,
  singerBurst: 0.5,
  /** The Guardian's CastWake slam lands its fists at this time (1x). */
  punchContact: 0.94,
  /** The Singer's CastSong gives its note at this time (at its 1x). */
  noteContact: 3.0,
  /** The note gesture plays CastSong this much faster, so the note comes
   *  well after her rise has settled. */
  noteRate: 2,
} as const;

/** The scene's beats, seconds from the wake (the sim's clock). */
export const COUNCIL_ENTRANCE = {
  /** The thrum: the rumble swells to its full by `thrumFull`. */
  thrumFull: 1.6,
  /** The five columns light one by one (the nearest the Pit Mouth first,
   *  round the circle), each `columnStep` after the one before, its runes
   *  climbing to the top over `columnClimb`. */
  columnsAt: 0.45,
  columnStep: 0.5,
  columnClimb: 0.7,
  /** The cracks race up the rock round the Guardian, foot to crown. */
  crackFrom: G - 0.2,
  crackTo: G + VG.quarryEnd + 0.1,
  /** It tears itself out, in the breath after "Strangers in the Quarry." */
  tearAt: G + VG.quarryEnd + 0.25,
  /** It punches the ground on "flesh". */
  punchAt: G + VG.flesh,
  /** The punch's ring of stone and dust: from its fists out past the raid. */
  ringFrom: 4 * GG,
  ringTo: 66,
  ringFor: 2.2,
  /** The crystal begins to ring, a breath before her line. */
  veinAt: S - 0.4,
  /** It shatters, in the breath after "Hear the seam sing?" */
  shatterAt: S + VS.singEnd + 0.1,
  /** Her shards gather into their orbit round her. */
  orbitFor: 0.9,
  /** The high note: the wave of light, on "voices". */
  noteAt: S + VS.voices,
  waveFrom: 3 * SG,
  waveTo: 74,
  /** Done by the hand-back: no light over the fight's first telegraphs. */
  waveFor: 1.15,
  /** The burst of light at the shatter and at the note (a flash on her,
   *  never a white-out): its size (yards) and its peak. */
  flashFor: 0.5,
  flashSize: 26,
  flashPeak: 1.15,
  /** The cameras' thuds: at the tear, the punch (heavy) and the shatter; the
   *  thrum's own tremor. Each at the body; falling off over `shakeReach`. */
  shakeTear: 0.75,
  shakePunch: 1.6,
  shakeShatter: 0.45,
  shakeThrum: 0.12,
  shakeReach: 110,
  /** The scene's tail: the dust settles, the slabs sink, the light fades. */
  end: COUNCIL_INTRO.seconds + 2.4,
} as const;

const E = COUNCIL_ENTRANCE;

/** Each resonance ring off the vein (seconds of the scene): slow at first,
 *  faster and faster up to the shatter (the rising note). */
export const VEIN_RINGS: readonly number[] = (() => {
  const out: number[] = [];
  let t = E.veinAt;
  let gap = 0.62;
  while (t < E.shatterAt - 0.05) {
    out.push(t);
    t += gap;
    gap = Math.max(0.16, gap * 0.78);
  }
  return out;
})();

/** The stances each rig holds (council_entrance_core gestures): asleep (its
 *  Dormant clip, dimmed), breaking out (the Awaken one-shot, sent once), or
 *  standing. */
export type CouncilEntranceStance = 'dormant' | 'emerge' | 'stand';

/** The gestures the entrance sends through the gesture seam (the looks in
 *  characters/smith_heart_boss_looks.ts bind them). */
export const COUNCIL_ENTRANCE_GESTURES = {
  guardianDormant: 'smith_heart_council_guardian_dormant',
  guardianEmerge: 'smith_heart_council_guardian_emerge',
  guardianStand: 'smith_heart_council_guardian_stand',
  /** Its body held dark and grey in the rock (a glow pulse that dulls its
   *  colour, re-sent while it sleeps; it fills back as it tears free). */
  guardianDim: 'smith_heart_council_guardian_dim',
  /** The fist into the ground (CastWake). */
  guardianPunch: 'smith_heart_council_guardian_punch',
  singerDormant: 'smith_heart_council_singer_dormant',
  singerEmerge: 'smith_heart_council_singer_emerge',
  singerStand: 'smith_heart_council_singer_stand',
  singerDim: 'smith_heart_council_singer_dim',
  /** Her high note (CastSong, at COUNCIL_AWAKEN_CLIP.noteRate). */
  singerNote: 'smith_heart_council_singer_note',
} as const;

/** When each one-shot gesture leaves (seconds of the scene), so its clip's
 *  beat lands on its moment. */
export const COUNCIL_ENTRANCE_GESTURE_AT = {
  guardianEmerge: E.tearAt - COUNCIL_AWAKEN_CLIP.guardianBurst,
  guardianPunch: E.punchAt - COUNCIL_AWAKEN_CLIP.punchContact,
  singerEmerge: E.shatterAt - COUNCIL_AWAKEN_CLIP.singerBurst,
  singerNote: E.noteAt - COUNCIL_AWAKEN_CLIP.noteContact / COUNCIL_AWAKEN_CLIP.noteRate,
} as const;

/** What the members' auras say: dormant, waking at `t`, or neither. */
export interface CouncilEntranceClock {
  stage: 'none' | 'dormant' | 'waking';
  t: number;
}

/** Read the entrance off a member's auras (allocation free). */
export function councilEntranceClock(
  auras: readonly { id: string; value: number; remaining: number; duration: number }[],
  out: CouncilEntranceClock = { stage: 'none', t: 0 },
): CouncilEntranceClock {
  out.stage = 'none';
  out.t = 0;
  for (const a of auras) {
    if (a.id !== COUNCIL_AURAS.intro) continue;
    if (Math.round(a.value) === COUNCIL_INTRO_STAGES.waking) {
      out.stage = 'waking';
      const total =
        Number.isFinite(a.duration) && a.duration > 0 ? a.duration : COUNCIL_INTRO.seconds;
      out.t = Math.max(0, Math.min(total, total - a.remaining));
    } else out.stage = 'dormant';
    break;
  }
  return out;
}

/** The painter's scene time: `DORMANT` while they sleep, `AWAKE` once the
 *  scene is over (or was never seen waking), else seconds into the scene. */
export const DORMANT = -1;
export const AWAKE = -2;

/** How far the painter's own time may drift off the aura's before it snaps
 *  back (a stalled tab, a late snapshot). */
export const COUNCIL_ENTRANCE_DRIFT = 0.35;

/**
 * Step the painter's scene time `prev` by `dt` against the aura's `clock`:
 * dormant holds DORMANT; waking runs smoothly on the aura's time (a scene
 * first seen mid-way starts where it is, never backward); a scene that has
 * been seen keeps running after the aura is gone, to its tail, then AWAKE
 * (cut short before the shatter, it jumps there: both break out at once); a
 * council never seen waking is AWAKE (a late joiner sees them standing).
 */
export function stepCouncilEntranceTime(
  prev: number,
  dt: number,
  clock: CouncilEntranceClock,
): number {
  if (clock.stage === 'dormant') return DORMANT;
  if (clock.stage === 'waking') {
    if (prev < 0) return clock.t;
    const next = prev + dt;
    if (next > clock.t + COUNCIL_ENTRANCE_DRIFT) return prev;
    return clock.t - next > COUNCIL_ENTRANCE_DRIFT ? clock.t : next;
  }
  if (prev < 0) return AWAKE;
  // Cut short before the shatter (a forced pull): both break out now, never
  // fought asleep in the stone.
  if (prev < E.shatterAt) return E.shatterAt;
  const next = prev + dt;
  return next >= E.end ? AWAKE : next;
}

/** Did the scene cross the beat `at` between painter times `prev` and `t`?
 *  Never for a scene joined late (`prev` not a scene time) or while asleep:
 *  a late joiner plays no one-shot it missed. */
export function crossedCouncilBeat(prev: number, t: number, at: number): boolean {
  return prev >= 0 && t >= 0 && prev < at && t >= at;
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
/** A one-shot spike at `since` 0 falling over `span` (0 before). */
const spike = (since: number, span: number) =>
  since < 0 ? 0 : Math.min(1, since / 0.05) * (1 - clamp01(since / span)) ** 2;

export interface CouncilEntranceLook {
  /** The scene is on (or they sleep): false once awake. */
  active: boolean;
  /** Asleep, waiting for the raid. */
  dormant: boolean;
  /** Seconds into the scene (0 asleep). */
  t: number;
  guardianStance: CouncilEntranceStance;
  singerStance: CouncilEntranceStance;
  /** Each body held dark (its dim pulse re-sent). */
  guardianDim: boolean;
  singerDim: boolean;
  /** The ground's hum (0..1): the rumble, the dust, the pebbles' hop. */
  thrum: number;
  /** Each carved column's light (QUARRY_PILLAR_SPOTS order): how far its
   *  runes have climbed (0..1) and its brightness (past 1 flaring). */
  columnClimb: number[];
  columnGlow: number[];
  /** The Guardian's rock: whole (1) to torn (0); its cracks' reach up it
   *  (0..1) and their heat; the light deep inside it (0..1). */
  rock: number;
  crack: number;
  crackHeat: number;
  core: number;
  /** Seconds since the tear, the punch, the shatter, the note (negative
   *  before). */
  sinceTear: number;
  sincePunch: number;
  sinceShatter: number;
  sinceNote: number;
  /** The punch's ring of stone and dust: its radius (yards) and strength. */
  ringR: number;
  ring: number;
  /** The Singer's crystal: whole (1) to shattered (0); its glow (0.2 asleep,
   *  past 1 ringing) and its tremble (0..1). */
  crystal: number;
  veinGlow: number;
  tremble: number;
  /** Her orbiting shards: gathered (0..1), and flung out with the note
   *  (seconds, negative before). */
  orbit: number;
  orbitFling: number;
  /** The wave of light: its radius (yards) and brightness. */
  waveR: number;
  wave: number;
  /** The burst of light at the shatter or the note (opacity share). */
  flash: number;
}

export function newCouncilEntranceLook(): CouncilEntranceLook {
  return {
    active: false,
    dormant: false,
    t: 0,
    guardianStance: 'stand',
    singerStance: 'stand',
    guardianDim: false,
    singerDim: false,
    thrum: 0,
    columnClimb: QUARRY_PILLAR_SPOTS.map(() => 0),
    columnGlow: QUARRY_PILLAR_SPOTS.map(() => 0),
    rock: 0,
    crack: 0,
    crackHeat: 0,
    core: 0,
    sinceTear: -99,
    sincePunch: -99,
    sinceShatter: -99,
    sinceNote: -99,
    ringR: 0,
    ring: 0,
    crystal: 0,
    veinGlow: 0,
    tremble: 0,
    orbit: 0,
    orbitFling: -99,
    waveR: 0,
    wave: 0,
    flash: 0,
  };
}

/** The awake look: everything as the fight has it, no scene (written in
 *  place: the painter asks every frame). */
function awake(out: CouncilEntranceLook): CouncilEntranceLook {
  out.active = false;
  out.dormant = false;
  out.t = 0;
  out.guardianStance = 'stand';
  out.singerStance = 'stand';
  out.guardianDim = false;
  out.singerDim = false;
  out.thrum = 0;
  out.columnClimb.fill(0);
  out.columnGlow.fill(0);
  out.rock = 0;
  out.crack = 0;
  out.crackHeat = 0;
  out.core = 0;
  out.sinceTear = -99;
  out.sincePunch = -99;
  out.sinceShatter = -99;
  out.sinceNote = -99;
  out.ringR = 0;
  out.ring = 0;
  out.crystal = 0;
  out.veinGlow = 0;
  out.tremble = 0;
  out.orbit = 0;
  out.orbitFling = -99;
  out.waveR = 0;
  out.wave = 0;
  out.flash = 0;
  return out;
}

/** The order the columns light in (indices into QUARRY_PILLAR_SPOTS): the
 *  one nearest the Pit Mouth first, then on away from the raid, so the light
 *  runs across the quarry toward the two of them. */
export const COLUMN_ORDER: readonly number[] = (() => {
  const mouth = { x: -35, z: -179 };
  return QUARRY_PILLAR_SPOTS.map((p, i) => ({ i, d: Math.hypot(p.x - mouth.x, p.z - mouth.z) }))
    .sort((a, b) => a.d - b.d)
    .map((c) => c.i);
})();

/** When column `i` (QUARRY_PILLAR_SPOTS index) lights (seconds of the
 *  scene). */
export function columnLightAt(i: number): number {
  return E.columnsAt + COLUMN_ORDER.indexOf(i) * E.columnStep;
}

/**
 * The scene at painter time `time` (DORMANT, AWAKE or seconds in), written
 * into `out` (allocation free once built).
 */
export function councilEntranceLook(
  time: number,
  out: CouncilEntranceLook = newCouncilEntranceLook(),
): CouncilEntranceLook {
  if (time === AWAKE || time >= E.end) return awake(out);
  const dormant = time === DORMANT;
  const t = dormant ? 0 : Math.max(0, time);
  out.active = true;
  out.dormant = dormant;
  out.t = t;
  const tail =
    t > COUNCIL_INTRO.seconds
      ? clamp01((t - COUNCIL_INTRO.seconds) / (E.end - COUNCIL_INTRO.seconds))
      : 0;
  const sinceTear = dormant ? -99 : t - E.tearAt;
  const sincePunch = dormant ? -99 : t - E.punchAt;
  const sinceShatter = dormant ? -99 : t - E.shatterAt;
  const sinceNote = dormant ? -99 : t - E.noteAt;
  out.sinceTear = sinceTear;
  out.sincePunch = sincePunch;
  out.sinceShatter = sinceShatter;
  out.sinceNote = sinceNote;
  const torn = sinceTear >= 0;
  const broke = sinceShatter >= 0;
  out.guardianStance = torn ? 'emerge' : 'dormant';
  out.singerStance = broke ? 'emerge' : 'dormant';
  out.guardianDim = !torn;
  out.singerDim = !broke;
  // The thrum: it swells, peaks through the tear and the punch, ebbs under
  // the song and dies with the scene.
  out.thrum = dormant
    ? 0
    : rise(0, E.thrumFull, t) * (0.7 + 0.3 * smooth(E.crackFrom, E.tearAt, t)) -
      0.55 * smooth(E.punchAt + 0.6, E.punchAt + 2.4, t) -
      0.15 * smooth(E.noteAt, COUNCIL_INTRO.seconds, t);
  out.thrum = clamp01(out.thrum) * (1 - tail);
  // The columns, one by one, flaring again with the wave of light.
  for (let i = 0; i < out.columnClimb.length; i++) {
    const at = columnLightAt(i);
    const lit = dormant ? 0 : rise(at, at + E.columnClimb, t);
    out.columnClimb[i] = lit;
    const flare = dormant || t < at ? 0 : 0.9 * Math.exp(-(t - at) * 3);
    out.columnGlow[i] = lit * (0.85 + flare) * (1 - tail);
  }
  // The Guardian's rock.
  out.rock = torn ? 0 : 1;
  out.crack = dormant ? 0 : rise(E.crackFrom, E.crackTo, t);
  out.crackHeat = torn ? 0 : out.crack * (0.8 + 0.6 * smooth(E.crackTo - 0.6, E.tearAt, t));
  out.core = dormant
    ? 0.18
    : torn
      ? 2.2 * spike(sinceTear, 0.9)
      : 0.18 + 1.1 * out.crack + 0.6 * smooth(E.crackTo - 0.4, E.tearAt, t);
  // The punch's ring.
  if (sincePunch >= 0 && sincePunch < E.ringFor) {
    const k = clamp01(sincePunch / E.ringFor);
    out.ringR = E.ringFrom + (E.ringTo - E.ringFrom) * (1 - (1 - k) ** 2.4);
    out.ring = (1 - k) ** 0.8;
  } else {
    out.ringR = 0;
    out.ring = 0;
  }
  // The Singer's crystal.
  out.crystal = broke ? 0 : 1;
  const ringing = dormant ? 0 : smooth(E.veinAt, E.shatterAt, t);
  out.veinGlow = broke ? 0 : 0.22 + 1.5 * ringing * ringing;
  out.tremble = broke ? 0 : ringing;
  out.orbit = broke ? rise(0.15, 0.15 + E.orbitFor, sinceShatter) : 0;
  out.orbitFling = sinceNote;
  // The wave of light from her note.
  if (sinceNote >= 0 && sinceNote < E.waveFor) {
    const k = clamp01(sinceNote / E.waveFor);
    out.waveR = E.waveFrom + (E.waveTo - E.waveFrom) * (1 - (1 - k) ** 2);
    out.wave = (1 - k) ** 0.9;
  } else {
    out.waveR = 0;
    out.wave = 0;
  }
  out.flash = Math.max(spike(sinceShatter, E.flashFor), 0.7 * spike(sinceNote, E.flashFor));
  return out;
}

/** How brightly a crystal `d` yards from the Singer flares as the wave of
 *  light passes it (0 before, a peak as the crest crosses it, a lingering
 *  ring after). */
export function crystalFlare(look: CouncilEntranceLook, d: number): number {
  if (look.sinceNote < 0) return 0;
  const k = clamp01(look.sinceNote / E.waveFor);
  const crestR = E.waveFrom + (E.waveTo - E.waveFrom) * (1 - (1 - k) ** 2);
  if (crestR < d - 6) return 0;
  const across = (crestR - d) / 6;
  const crest = Math.exp(-across * across);
  // When the crest passed it, how long it has rung since.
  const ringFor = Math.max(0, look.sinceNote - E.waveFor * (d / E.waveTo));
  const ring = crestR >= d ? 0.55 * Math.exp(-ringFor * 1.4) : 0;
  return Math.max(crest * 1.4, ring);
}

/** The flash's opacity: none under reduced motion. */
export function councilEntranceFlash(look: CouncilEntranceLook, reducedMotion: boolean): number {
  return reducedMotion ? 0 : look.flash;
}

/** The added light's ceiling: reduced motion caps every flare and wave
 *  (they still show, never blaze). */
export const REDUCED_LIGHT_CAP = 0.6;

/** An added light's level `v` under the viewer's motion setting. */
export function councilEntranceLight(v: number, reducedMotion: boolean): number {
  return reducedMotion ? Math.min(v, REDUCED_LIGHT_CAP) : v;
}

/** A thud of `amount` (at the body) for a player `distance` yards away: none
 *  under reduced motion or past the reach, else falling off with distance. */
export function councilEntranceShake(
  amount: number,
  distance: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || distance >= E.shakeReach) return 0;
  return amount * (1 - (distance / E.shakeReach) * 0.6);
}

/** The low tier's share of the particles, rubble, shards and pebbles. */
export const COUNCIL_ENTRANCE_LOW_SHARE = 0.4;

// ---- the sounds ------------------------------------------------------------------------------

/** The scene's sounds on their beats (the council's own samples): the
 *  rumble, a column lighting, the rock's cracking and tearing, the punch's
 *  impact, the crystal's rising note, its shatter, the high note. */
export const COUNCIL_ENTRANCE_SOUNDS: readonly {
  at: number;
  key: string;
  gain: number;
  rate: number;
}[] = [
  { at: 0.05, key: 'heart_final_tremor', gain: 1, rate: 0.62 },
  { at: 1.4, key: 'heart_council_slab_grind', gain: 0.9, rate: 0.55 },
  ...COLUMN_ORDER.map((_, k) => ({
    at: E.columnsAt + k * E.columnStep,
    key: 'heart_council_pillar_pulse',
    gain: 0.75,
    rate: 0.82 + k * 0.06,
  })),
  { at: E.crackFrom, key: 'heart_council_pillar_crack', gain: 1, rate: 0.7 },
  { at: E.crackFrom + 1.1, key: 'heart_council_pillar_crack', gain: 1, rate: 0.62 },
  { at: E.tearAt - 0.3, key: 'heart_council_wrath_charge', gain: 0.85, rate: 1.3 },
  { at: E.tearAt, key: 'heart_council_pillar_collapse', gain: 1, rate: 0.72 },
  { at: E.tearAt + 0.05, key: 'heart_council_slab_crush', gain: 1, rate: 0.78 },
  { at: E.punchAt, key: 'heart_council_rush_impact', gain: 1, rate: 0.78 },
  { at: E.punchAt + 0.04, key: 'heart_council_wrath_blast', gain: 0.9, rate: 0.85 },
  ...VEIN_RINGS.map((at, k) => ({
    at,
    key: 'heart_council_resonance',
    gain: 0.55 + Math.min(0.4, k * 0.05),
    rate: Math.min(1.9, 0.75 + k * 0.11),
  })),
  { at: E.shatterAt, key: 'heart_council_soul_burst', gain: 1, rate: 1.15 },
  { at: E.shatterAt + 0.02, key: 'heart_council_pillar_collapse', gain: 0.6, rate: 1.6 },
  { at: E.noteAt - 0.05, key: 'heart_council_song_cast', gain: 0.9, rate: 1.35 },
  { at: E.noteAt, key: 'heart_council_song_pulse', gain: 1, rate: 1.5 },
];

// ---- the plans -------------------------------------------------------------------------------

/** Deterministic hash in [0, 1). */
export function councilEntranceHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hash = councilEntranceHash;

/** The Guardian's spur of rock: its height and its radius at the foot and
 *  the crown (yards; the Guardian stands about 14.7 yd, crouched some 11).
 *  Its foot grows less than its height (the Singer's vein stands 9.5 yd
 *  off), and the slabs toward her are drawn in by `singerSide`. */
export const COUNCIL_ROCK = {
  height: 12.5 * GG,
  footR: 7.6,
  crownR: 3.2 * GG,
  /** How far in the slabs facing the Singer sit (a share of their ring). */
  singerSide: 0.14,
  /** Rings of slabs, bottom to top: how many in each. */
  rings: [8, 8, 7, 6, 4, 2],
} as const;

/** One slab of the spur, in the Guardian's frame (x its left, y up off the
 *  floor, z its front): where it sits, its size, its turn, and how it flies
 *  when the Guardian tears out (velocity, spin about a tilted axis, a
 *  breath of delay). */
export interface RockSlab {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  tilt: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  ax: number;
  az: number;
  delay: number;
  /** Lies whole on the floor this long before it sinks. */
  rest: number;
}

export const ROCK_SLABS: readonly RockSlab[] = (() => {
  const R = COUNCIL_ROCK;
  const out: RockSlab[] = [];
  const rings = R.rings.length;
  let n = 0;
  for (let ring = 0; ring < rings; ring++) {
    const count = R.rings[ring];
    const h = (ring + 0.5) / rings;
    const y = h * R.height * 0.92;
    const r = R.footR + (R.crownR - R.footR) * h;
    for (let k = 0; k < count; k++, n++) {
      const a = ((k + (ring % 2) * 0.5) / count) * Math.PI * 2 + (hash(n, 3) - 0.5) * 0.35;
      // A window at the front, chest and head high: its shape hinted at
      // through the gap (its face toward the raid).
      const front = Math.cos(a);
      if (ring >= 3 && ring <= 4 && front > 0.9) continue;
      const toHer = councilFacingShare(a, COUNCIL_PAIR.guardianToSinger) ** 2;
      const rr = r * (0.92 + hash(n, 5) * 0.16) * (1 - R.singerSide * toHer);
      const x = Math.sin(a) * rr;
      const z = Math.cos(a) * rr;
      const out1 = 0.55 + 0.45 * hash(n, 7);
      // Thrown outward and up, harder toward the raid.
      const speed = (7 + 7 * hash(n, 11)) * (1 + 0.35 * Math.max(0, front)) * Math.sqrt(GG);
      out.push({
        x,
        y,
        z,
        sx: ((2 * Math.PI * r) / count) * (0.75 + 0.3 * hash(n, 13)),
        sy: (R.height / rings) * (1.05 + 0.35 * hash(n, 17)),
        sz: (1.3 + 1.4 * hash(n, 19)) * GG * (1 - 0.2 * toHer),
        yaw: a,
        tilt: (hash(n, 23) - 0.5) * 0.5,
        vx: Math.sin(a) * speed * out1,
        vy: 5 + 8 * hash(n, 29) + h * 4,
        vz: Math.cos(a) * speed * out1,
        spin: (hash(n, 31) - 0.5) * 7,
        ax: hash(n, 37) - 0.5,
        az: hash(n, 41) - 0.5,
        delay: (1 - h) * 0.12 + hash(n, 43) * 0.06,
        rest: 2.6 + hash(n, 47) * 1.4,
      });
    }
  }
  return out;
})();

/** Gravity on the flying stone (yards a second squared), how long a slab
 *  takes to sink into the floor once it has rested. */
export const ROCK_GRAVITY = 24;
export const ROCK_SINK = 1.4;

/** A slab or a chunk at a moment: its place (Guardian frame), its turn
 *  about its axis (radians), its size share (1 whole, shrinking as it sinks)
 *  and whether it has landed. */
export interface FlyingStone {
  x: number;
  y: number;
  z: number;
  turn: number;
  size: number;
  landed: boolean;
  /** Seconds since it landed (negative in the air). */
  sinceLand: number;
}

export function newFlyingStone(): FlyingStone {
  return { x: 0, y: 0, z: 0, turn: 0, size: 1, landed: false, sinceLand: -1 };
}

/** Slab `s` `since` seconds after the tear (negative: still in the spur). */
export function slabAt(s: RockSlab, since: number, out: FlyingStone): FlyingStone {
  const t = since - s.delay;
  if (t <= 0) {
    out.x = s.x;
    out.y = s.y;
    out.z = s.z;
    out.turn = 0;
    out.size = 1;
    out.landed = false;
    out.sinceLand = -1;
    return out;
  }
  // Up and out until it falls back to its own half height off the floor.
  const floor = s.sy * 0.35;
  const g = ROCK_GRAVITY;
  const disc = s.vy * s.vy + 2 * g * (s.y - floor);
  const tLand = (s.vy + Math.sqrt(Math.max(0, disc))) / g;
  const tt = Math.min(t, tLand);
  out.x = s.x + s.vx * tt;
  out.z = s.z + s.vz * tt;
  out.y = s.y + s.vy * tt - 0.5 * g * tt * tt;
  out.turn = s.spin * tt;
  out.landed = t >= tLand;
  out.sinceLand = out.landed ? t - tLand : -1;
  const sink = out.landed ? clamp01((out.sinceLand - s.rest) / ROCK_SINK) : 0;
  out.y -= sink * s.sy * 0.9;
  out.size = 1 - 0.35 * sink;
  return out;
}

/** The rubble thrown with the slabs: small chunks, faster and higher. */
export interface RockChunk {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  spin: number;
  delay: number;
}

export const ROCK_CHUNKS: readonly RockChunk[] = (() => {
  const out: RockChunk[] = [];
  const R = COUNCIL_ROCK;
  for (let i = 0; i < 90; i++) {
    const a = hash(i, 101) * Math.PI * 2;
    const h = hash(i, 103);
    const r = R.footR + (R.crownR - R.footR) * h;
    const speed = (10 + 12 * hash(i, 107)) * Math.sqrt(GG);
    out.push({
      x: Math.sin(a) * r,
      y: h * R.height,
      z: Math.cos(a) * r,
      vx: Math.sin(a) * speed,
      vy: 6 + 14 * hash(i, 109),
      vz: Math.cos(a) * speed,
      size: (0.35 + 0.9 * hash(i, 113) ** 2) * GG,
      spin: (hash(i, 127) - 0.5) * 14,
      delay: hash(i, 131) * 0.1,
    });
  }
  return out;
})();

/** A chunk of rubble `since` seconds after the tear: flying, bouncing once,
 *  lying a breath, then gone (`size` 0). */
export function chunkAt(c: RockChunk, since: number, out: FlyingStone): FlyingStone {
  const t = since - c.delay;
  const g = ROCK_GRAVITY;
  if (t <= 0) {
    out.x = c.x;
    out.y = c.y;
    out.z = c.z;
    out.turn = 0;
    out.size = 0;
    out.landed = false;
    out.sinceLand = -1;
    return out;
  }
  const floor = c.size * 0.4;
  const tLand = (c.vy + Math.sqrt(c.vy * c.vy + 2 * g * Math.max(0, c.y - floor))) / g;
  const tt = Math.min(t, tLand);
  out.x = c.x + c.vx * tt;
  out.z = c.z + c.vz * tt;
  out.y = c.y + c.vy * tt - 0.5 * g * tt * tt;
  out.turn = c.spin * tt;
  out.landed = t >= tLand;
  out.sinceLand = out.landed ? t - tLand : -1;
  const life = 1.6;
  out.size = out.landed ? c.size * (1 - clamp01((out.sinceLand - life) / 0.6)) : c.size;
  return out;
}

/** Every k-th of a plan for the low tier (indices), so it stays whole. */
export function councilEntrancePicks(total: number, detail: boolean): number[] {
  const count = detail ? total : Math.max(1, Math.round(total * COUNCIL_ENTRANCE_LOW_SHARE));
  const step = total / count;
  const picks: number[] = [];
  for (let i = 0; i < count; i++) picks.push(Math.min(total - 1, Math.floor(i * step)));
  return picks;
}

/** The Singer's vein of crystal (her frame, yards): the cocoon she sleeps
 *  in (its radius and height: she stands 11 yd, curled in it some 8; its
 *  middle `cocoonX`, `cocoonZ`, nudged `shift` away from the Guardian's rock),
 *  the prisms round it, the wedge toward the rock they leave bare (`gap`,
 *  radians either side) and how far they reach off her (the pebbles keep
 *  off it). */
export const COUNCIL_VEIN = (() => {
  const shift = 1.4;
  const away = COUNCIL_PAIR.singerToGuardian + Math.PI;
  return {
    cocoonR: 4.2,
    cocoonH: 6.6 * SG * 0.9,
    shift,
    cocoonX: Math.sin(away) * shift,
    cocoonZ: Math.cos(away) * shift,
    prisms: 13,
    gap: (65 * Math.PI) / 180,
    reach: 8.5,
  } as const;
})();

/** One crystal prism of the vein: its foot, its lean (radians off upright,
 *  toward `bearing`), its radius and its length. */
export interface VeinPrism {
  x: number;
  z: number;
  bearing: number;
  lean: number;
  r: number;
  len: number;
}

export const VEIN_PRISMS: readonly VeinPrism[] = (() => {
  const out: VeinPrism[] = [];
  for (let i = 0; i < COUNCIL_VEIN.prisms; i++) {
    // Round her, all but the wedge toward the Guardian's rock (the two stand
    // 9.5 yd apart); the ones at its edges drawn in, cut short and stood up.
    const V = COUNCIL_VEIN;
    const arc = Math.PI * 2 - 2 * V.gap;
    const a =
      COUNCIL_PAIR.singerToGuardian +
      V.gap +
      ((i + 0.5) / V.prisms) * arc +
      (hash(i, 201) - 0.5) * 0.35;
    const near = councilFacingShare(a, COUNCIL_PAIR.singerToGuardian) ** 2;
    const r = (1.9 + hash(i, 203) * 1.6) * SG * 0.85 * (1 - 0.3 * near);
    out.push({
      x: Math.sin(a) * r,
      z: Math.cos(a) * r,
      bearing: a,
      lean: (0.25 + 0.45 * hash(i, 207)) * (1 - 0.65 * near),
      r: (0.55 + 0.5 * hash(i, 211)) * SG * 0.85,
      len: (2.8 + 4.2 * hash(i, 213)) * SG * 0.9 * (1 - 0.45 * near),
    });
  }
  return out;
})();

/** One shard of the shattered crystal: its burst off the cocoon (her frame),
 *  its size and spin. */
export interface CrystalShard {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  spin: number;
}

export const CRYSTAL_SHARDS: readonly CrystalShard[] = (() => {
  const out: CrystalShard[] = [];
  const V = COUNCIL_VEIN;
  for (let i = 0; i < 64; i++) {
    const a = hash(i, 301) * Math.PI * 2;
    const h = hash(i, 303);
    const speed = (8 + 14 * hash(i, 307)) * Math.sqrt(SG);
    out.push({
      x: V.cocoonX + Math.sin(a) * V.cocoonR * 0.8,
      y: 0.5 + h * V.cocoonH,
      z: V.cocoonZ + Math.cos(a) * V.cocoonR * 0.8,
      vx: Math.sin(a) * speed,
      vy: 3 + 10 * hash(i, 309),
      vz: Math.cos(a) * speed,
      size: (0.25 + 0.75 * hash(i, 311) ** 1.5) * SG * 0.8,
      spin: (hash(i, 313) - 0.5) * 16,
    });
  }
  return out;
})();

/** A shard `since` seconds after the shatter: flung, falling, glinting on the
 *  floor and fading (`size` 0 gone). */
export function shardAt(c: CrystalShard, since: number, out: FlyingStone): FlyingStone {
  const g = ROCK_GRAVITY * 0.85;
  const floor = 0.15;
  const tLand = (c.vy + Math.sqrt(c.vy * c.vy + 2 * g * Math.max(0, c.y - floor))) / g;
  const t = Math.max(0, since);
  const tt = Math.min(t, tLand);
  out.x = c.x + c.vx * tt;
  out.z = c.z + c.vz * tt;
  out.y = c.y + c.vy * tt - 0.5 * g * tt * tt;
  out.turn = c.spin * tt;
  out.landed = t >= tLand;
  out.sinceLand = out.landed ? t - tLand : -1;
  out.size = since < 0 ? 0 : c.size * (1 - clamp01((t - 1.6) / 0.8));
  return out;
}

/** Her orbiting shards: how many, their ring (yards), their heights, their
 *  turn (radians a second), and how fast they fly out with the note. */
export const ORBIT_SHARDS = {
  count: 9,
  r: 3.2 * SG * 0.9,
  yLow: 1.4 * SG,
  yHigh: 5.2 * SG,
  spin: 0.9,
  flingSpeed: 45,
  flingFor: 1.3,
  /** The smallest shard's width (yards; each 3.2 times as long). */
  size: 0.48 * SG * 0.8,
} as const;

/** Orbiting shard `i` at scene look `look` (her frame): place, turn, size. */
export function orbitShardAt(
  i: number,
  look: Pick<CouncilEntranceLook, 'orbit' | 'orbitFling' | 't'>,
  out: FlyingStone,
): FlyingStone {
  const O = ORBIT_SHARDS;
  const a0 = (i / O.count) * Math.PI * 2;
  const a = a0 + look.t * O.spin * (0.8 + 0.4 * hash(i, 401));
  const gather = look.orbit;
  // Spiralling in from the burst's reach to the ring as they gather.
  const r = O.r * (1 + 2.2 * (1 - gather)) * (0.9 + 0.2 * hash(i, 403));
  const y = O.yLow + (O.yHigh - O.yLow) * hash(i, 405) + 0.35 * Math.sin(look.t * 1.7 + i);
  const fling = look.orbitFling;
  const flown = fling > 0 ? O.flingSpeed * fling * (1 - 0.3 * Math.min(1, fling)) : 0;
  out.x = Math.sin(a) * (r + flown);
  out.z = Math.cos(a) * (r + flown);
  out.y = y + (fling > 0 ? 2.5 * fling : 0);
  out.turn = look.t * (1.2 + hash(i, 407));
  out.size = gather * (fling > 0 ? 1 - clamp01(fling / O.flingFor) : 1);
  out.landed = false;
  out.sinceLand = -1;
  return out;
}

/** The pebbles that hop on the floor with the thrum: their place off the
 *  Quarry's middle (instance-local offsets), their size and their seed. */
export interface Pebble {
  x: number;
  z: number;
  size: number;
  seed: number;
}

export const QUARRY_PEBBLES: readonly Pebble[] = (() => {
  const out: Pebble[] = [];
  const P = HAMMER_PIT;
  for (let i = 0; out.length < 260 && i < 4000; i++) {
    const a = hash(i, 501) * Math.PI * 2;
    const r = Math.sqrt(hash(i, 503));
    const x = Math.sin(a) * r * (P.rx - 4);
    const z = Math.cos(a) * r * (P.rz - 4);
    // Off the Guardian's spur and the Singer's vein (their own stone).
    if (Math.hypot(x, z) < COUNCIL_ROCK.footR + 2) continue;
    if (Math.hypot(x - COUNCIL_PAIR.dx, z - COUNCIL_PAIR.dz) < COUNCIL_VEIN.reach) continue;
    out.push({ x, z, size: 0.07 + 0.15 * hash(i, 507) ** 2, seed: hash(i, 509) });
  }
  return out;
})();

/** Where the dust trickles off the terraces (instance-local: on the lip of
 *  the first step, above the pit floor). */
export const DUST_SPOTS: readonly { x: number; y: number; z: number }[] = (() => {
  const out: { x: number; y: number; z: number }[] = [];
  const P = HAMMER_PIT;
  for (let i = 0; i < 18; i++) {
    const deg = 40 + (170 * (i + hash(i, 601))) / 18;
    const a = (deg * Math.PI) / 180;
    out.push({
      x: P.x + Math.sin(a) * (P.rx + 3),
      y: 21 + 6 * hash(i, 603),
      z: P.z + Math.cos(a) * (P.rz + 3),
    });
  }
  // And off the west rim the raid comes down past.
  for (let i = 0; i < 6; i++) {
    const deg = 250 + 70 * hash(i, 605);
    const a = (deg * Math.PI) / 180;
    out.push({
      x: P.x + Math.sin(a) * (P.rx + 2),
      y: P.h + 6 + 4 * hash(i, 607),
      z: P.z + Math.cos(a) * (P.rz + 2),
    });
  }
  return out;
})();

/** The crystals in the room the high note rings (instance-local): the
 *  quarry's geodes and the crown of each carved column. */
export const QUARRY_CRYSTALS: readonly { x: number; z: number; lift: number; size: number }[] =
  (() => {
    const out: { x: number; z: number; lift: number; size: number }[] = [];
    for (const p of SMITH_HEART_FIELD.props) {
      if (p.kind !== 'sh_geode') continue;
      if (Math.hypot(p.x - HAMMER_PIT.x, p.z - HAMMER_PIT.z) > HAMMER_PIT.rx + 20) continue;
      out.push({ x: p.x, z: p.z, lift: 1.6, size: 7 });
    }
    for (const c of QUARRY_PILLAR_SPOTS) out.push({ x: c.x, z: c.z, lift: 12.4, size: 6 });
    return out;
  })();

/** The carved columns' drawn shape (council_pillars_fx.ts: a carved column
 *  stands 12.6 yd, about 2.25 yd round), which their light's sheath wraps. */
export const COLUMN_SHEATH = {
  /** Above its plinth to under its capital. */
  foot: 1.5,
  height: 10.6,
  /** A square sheath (its faces just off the column's). */
  half: 1.62,
} as const;

export const COUNCIL_ENTRANCE_POOLS = {
  /** Dust off the terraces a second at full thrum (before the tier). */
  dustRate: 40,
  /** Smoke puffs in the tear's cloud, debris flung by the punch. */
  tearDust: 46,
  punchDebris: 60,
  /** Motes off a column as it lights. */
  columnMotes: 18,
  /** Glints rising off the crystal as it rings, a second. */
  veinMotes: 30,
} as const;
