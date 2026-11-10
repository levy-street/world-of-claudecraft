// The Guardian of the Quench's entrance as numbers (docs/design/raid/
// smith_heart.md section 7.3, "The entrance"), "Under the ice": the pure half
// of quench_entrance_fx.ts and of the entrance's hooks in her body
// (quench_body.ts, through quench_entrance_state.ts).
//
// The sim holds her frozen under the lake's ice until the raid first steps
// onto it, then runs the scene's clock on one aura (encounters/smith_heart/
// quench_intro.ts); this module reads that clock (`quenchEntranceClock`),
// keeps the painter's own smooth scene time on it (`stepQuenchEntranceTime`:
// a late joiner starts where the scene is, a scene seen ending runs on to its
// tail, one never seen is simply awake) and plans every beat
// (`quenchEntranceLook`):
//
//   dormant    the lake still; she lies on her back under a sheet of clear
//              ice, her eyes shut, dim and grey, a breath of frost drifting
//              off the ice over her mouth now and then
//   the wake   her eyes open under the ice, a sharp blue glint ("Hush...")
//   the web    spiderweb cracks race out from her across the lake toward
//              the raid, blue light leaking up through them, frost creeping
//              over the ice, cold mist rising, snow beginning ("the lake
//              was sleeping"), thickening into a flurry; the sheet over her
//              trembles and crazes as the light under it swells
//   the breach she bursts up through the ice ("You have WOKEN the cold"): a
//              fountain of shards, a frost shockwave racing across the raid
//              (cosmetic: no damage, no knockback), the camera's thud, a
//              burst of cold light; she rises slowly to her full height, her
//              arms climbing to the sky
//   the blades her conjured ice blades rise out of the lake one by one round
//              her ("and the cold..."), circle her, then turn and point at
//              the raid as she throws her arms down ("...forgive"); the fight
//              is hers to begin; then they plunge back under the ice
//
// The beats ride the voice clip's own words (QUENCH_INTRO_VOICE, measured on
// the shipped clip), counted from the sim's QUENCH_INTRO.speakAt.
//
// Presentation only, every tier (the low tier thins counts, never a beat;
// reduced motion drops the thud and the flash). Node-only (RENDER_PURE_CORES):
// no three.js, no DOM, deterministic (a hash, never rng).

import { QUENCH_AURAS } from '../../sim/encounters/smith_heart/quench_ids';
import {
  QUENCH_INTRO,
  QUENCH_INTRO_STAGES,
} from '../../sim/encounters/smith_heart/quench_intro_plan';
import { bladeHalfThick, bladeHalfWidth } from './quench_blade_tip_core';
import { QUENCH_YD_PER_UNIT } from './quench_body_core';

// ---- the clock -----------------------------------------------------------------------------

/** The entrance line's words in its shipped clip (public/audio/voice/
 *  heart_quench_guardian, the `quench.intro` line), seconds from the clip's
 *  start, measured with ffmpeg (silencedetect at -35 dB, 0.18 s, and a 50 ms
 *  loudness envelope) and a word-timed transcript: "Hush...", "the lake was
 *  sleeping.", the pause, "You have woken the cold,", "and the cold does not
 *  forgive." and the clip's end. A new take of the line is measured again
 *  and written here. */
export const QUENCH_INTRO_VOICE = {
  hush: 0.12,
  lake: 1.8,
  sleepingEnd: 3.55,
  you: 4.65,
  woken: 5.58,
  cold: 6.22,
  andThe: 7.4,
  forgive: 9.76,
  end: 10.66,
} as const;

const SPEAK = QUENCH_INTRO.speakAt;
const V = QUENCH_INTRO_VOICE;

/** The Emerge clip's beats (scripts/build_quench_guardian_entrance_anims.mjs,
 *  seconds into the clip, which starts on the breach): the burst out of the
 *  ice, her full height, the arms thrown down at the raid, the clip's end. */
export const QUENCH_EMERGE_CLIP = {
  burst: 0.45,
  stood: 2.7,
  throw: 4.18,
  end: 5.8,
} as const;

/** The scene's beats, seconds from the wake (the sim's clock). */
export const QUENCH_ENTRANCE = {
  /** Her eyes open under the ice, a breath before "Hush...". */
  eyesAt: 0.15,
  eyesFor: 0.3,
  /** The web of cracks starts out from her on "the lake", runs to its tips. */
  webAt: SPEAK + V.lake,
  webFor: 2.6,
  /** The frost creeps over the ice with the web, to its full reach. */
  frostFor: 4.2,
  /** The gather: in the line's held breath the sheet over her trembles and
   *  crazes, the light under it swells. */
  gatherAt: SPEAK + V.sleepingEnd,
  /** She bursts out of the ice on "woken". */
  breachAt: SPEAK + V.woken,
  /** The shockwave: from the breach's lip out past the raid. */
  ringFrom: 3,
  ringTo: 72,
  ringFor: 2.1,
  /** The burst of cold light at the breach (a flash on its point, never a
   *  white-out: the Quench's own rule), its size (yards) and peak. */
  flashFor: 0.55,
  flashSize: 30,
  flashPeak: 1.25,
  /** The geyser of ice and cold light the breach throws up: its climb, how
   *  long it stands, its fall, its height and its radius at the root. */
  geyserRise: 0.22,
  geyserHold: 0.45,
  geyserFall: 1.1,
  geyserHeight: 50,
  geyserRadius: 5.4,
  /** The camera's thud at the breach (the shake sink's amount at her; it
   *  falls off over `shakeReach`). */
  shake: 1.6,
  shakeReach: 110,
  /** Her blades rise one by one from "and the cold", each `bladeStep`
   *  after the one before, each up out of the ice in `bladeRise`. */
  bladesAt: SPEAK + V.andThe,
  bladeStep: 0.24,
  bladeRise: 0.85,
  /** They turn and point at the raid on "forgive" (and her arms come down). */
  pointAt: SPEAK + V.forgive,
  pointFor: 0.16,
  /** After she is handed back they plunge back under the ice. */
  plungeAt: QUENCH_INTRO.seconds + 0.35,
  plungeStep: 0.07,
  plungeFor: 0.5,
  /** The scene's tail: the snow thins, the mist and the frost fade. */
  end: QUENCH_INTRO.seconds + 2.6,
} as const;

/** What the guardian's aura says: frozen, waking at `t`, or neither. */
export interface QuenchEntranceClock {
  stage: 'none' | 'frozen' | 'waking';
  t: number;
}

/** Read the entrance off the guardian's auras (allocation free). */
export function quenchEntranceClock(
  auras: readonly { id: string; value: number; remaining: number; duration: number }[],
  out: QuenchEntranceClock = { stage: 'none', t: 0 },
): QuenchEntranceClock {
  out.stage = 'none';
  out.t = 0;
  for (const a of auras) {
    if (a.id !== QUENCH_AURAS.intro) continue;
    if (Math.round(a.value) === QUENCH_INTRO_STAGES.waking) {
      out.stage = 'waking';
      const total =
        Number.isFinite(a.duration) && a.duration > 0 ? a.duration : QUENCH_INTRO.seconds;
      out.t = Math.max(0, Math.min(total, total - a.remaining));
    } else out.stage = 'frozen';
    break;
  }
  return out;
}

/** The painter's scene time: `FROZEN` while she waits, `AWAKE` once the scene
 *  is over (or was never seen waking), else seconds into the scene. */
export const FROZEN = -1;
export const AWAKE = -2;

/** How far the painter's own time may drift off the aura's before it snaps
 *  back (a stalled tab, a late snapshot). */
export const QUENCH_ENTRANCE_DRIFT = 0.35;

/**
 * Step the painter's scene time `prev` by `dt` against the aura's `clock`:
 * frozen holds FROZEN; waking runs smoothly on the aura's time (a scene first
 * seen mid-way starts where it is); a scene that has been seen keeps running
 * after the aura is gone, to its tail, then AWAKE (cut short before the
 * breach, it jumps to the breach: she breaks out at once); a guardian never seen
 * waking is AWAKE (a late joiner sees her standing).
 */
export function stepQuenchEntranceTime(
  prev: number,
  dt: number,
  clock: QuenchEntranceClock,
): number {
  if (clock.stage === 'frozen') return FROZEN;
  if (clock.stage === 'waking') {
    if (prev < 0) return clock.t;
    const next = prev + dt;
    // Never backward (a late snapshot would replay the beats): ahead of the
    // aura it waits for it; far behind it snaps forward.
    if (next > clock.t + QUENCH_ENTRANCE_DRIFT) return prev;
    return clock.t - next > QUENCH_ENTRANCE_DRIFT ? clock.t : next;
  }
  if (prev < 0) return AWAKE;
  // Cut short before the breach (a forced pull): she breaks out now, never
  // fought lying under the ice.
  if (prev < QUENCH_ENTRANCE.breachAt) return QUENCH_ENTRANCE.breachAt;
  const next = prev + dt;
  return next >= QUENCH_ENTRANCE.end ? AWAKE : next;
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

/** The stance the rig holds (quench_body_core.ts QUENCH_BODY_GESTURES):
 *  lying frozen under the ice, the burst and the rise (the Emerge clip, sent
 *  once on the breach), or standing. */
export type QuenchEntranceStance = 'frozen' | 'emerge' | 'stand';

/** The blades she conjures: how many, the ring they circle her on (yards
 *  from her), how high they hover (the hilt's foot over the ice), their
 *  length and how fast they circle (radians a second). */
export const QUENCH_ENTRANCE_BLADES = {
  count: 6,
  ring: 8.5,
  hover: 3,
  length: 7,
  orbit: 0.55,
} as const;

/** One conjured blade at a moment of the scene. */
export interface QuenchEntranceBlade {
  /** Drawn at all. */
  shown: boolean;
  /** Out of the ice: 0 under it (its point at the ice), 1 hovering. */
  lift: number;
  /** Its bearing round her (radians, her frame: 0 ahead of her). */
  bearing: number;
  /** Upright (0) to pointing at its mark (1). */
  aim: number;
  /** The plunge back under the ice: 0 none, 1 gone. */
  plunge: number;
  /** Its light (0..1, past 1 flaring). */
  glow: number;
  /** Its turn about its own length (radians): spun fast up out of the ice,
   *  slowing to a lazy turn as it settles. */
  spin: number;
  /** Its distance out on the ring (share): spiralling out to the ring as it
   *  rises. */
  reach: number;
  /** The glint off its point as it snaps onto its mark (0..1). */
  glint: number;
}

export interface QuenchEntranceLook {
  /** The scene is on (or she waits frozen): false once awake. */
  active: boolean;
  /** Frozen under the ice, waiting. */
  frozen: boolean;
  /** Seconds into the scene (0 while frozen). */
  t: number;
  stance: QuenchEntranceStance;
  /** Her own body held dim and grey (the frozen glow pulse re-sent). */
  dim: boolean;
  /** Her eyes: 0 shut, past 1 the sharp glint as they open, 1 open. */
  eyes: number;
  /** Her heart's light (0.2 a slow heartbeat under the ice, 1 as fought). */
  heart: number;
  /** Her always-on cold (the hem's mist, the snow and glitter round her):
   *  none under the ice, back as she rises. */
  ambient: number;
  /** The sheet of ice over her: whole (1) to gone (0, shattered). */
  sheet: number;
  /** Its own cracks crazing over it (0..1) and its tremble (0..1). */
  sheetCrack: number;
  tremble: number;
  /** The cold light swelling under her (0..1, past 1 at the breach). */
  under: number;
  /** The web of cracks: how far it has run (0..1) and the light leaking up
   *  through it (0..1, past 1 at the breach). */
  web: number;
  webGlow: number;
  /** The frost creeping over the ice: its reach (0..1) and its strength. */
  frost: number;
  frostAlpha: number;
  /** The cold mist, the snow (past 1 a flurry), the frost breath off the
   *  sheet (per-second shares before the tier). */
  mist: number;
  snow: number;
  breath: number;
  /** Seconds since the breach (negative before). */
  sinceBreach: number;
  /** The frost shockwave: its radius (yards) and brightness. */
  ringR: number;
  ring: number;
  /** The breach's burst of light (its opacity share). */
  flash: number;
  /** The breach's geyser: its height share and brightness. */
  geyserH: number;
  geyser: number;
  /** The conjured blades (QUENCH_ENTRANCE_BLADES.count of them). */
  blades: QuenchEntranceBlade[];
}

function newBlade(): QuenchEntranceBlade {
  return {
    shown: false,
    lift: 0,
    bearing: 0,
    aim: 0,
    plunge: 0,
    glow: 0,
    spin: 0,
    reach: 0,
    glint: 0,
  };
}

export function newQuenchEntranceLook(): QuenchEntranceLook {
  const blades: QuenchEntranceBlade[] = [];
  for (let i = 0; i < QUENCH_ENTRANCE_BLADES.count; i++) blades.push(newBlade());
  return {
    active: false,
    frozen: false,
    t: 0,
    stance: 'stand',
    dim: false,
    eyes: 1,
    heart: 1,
    ambient: 1,
    sheet: 0,
    sheetCrack: 0,
    tremble: 0,
    under: 0,
    web: 0,
    webGlow: 0,
    frost: 0,
    frostAlpha: 0,
    mist: 0,
    snow: 0,
    breath: 0,
    sinceBreach: -99,
    ringR: 0,
    ring: 0,
    flash: 0,
    geyserH: 0,
    geyser: 0,
    blades,
  };
}

/** The awake look: everything as the fight has it, no scene (written in
 *  place: the painter asks every frame). */
function awake(out: QuenchEntranceLook): QuenchEntranceLook {
  out.active = false;
  out.frozen = false;
  out.t = 0;
  out.stance = 'stand';
  out.dim = false;
  out.eyes = 1;
  out.heart = 1;
  out.ambient = 1;
  out.sheet = 0;
  out.sheetCrack = 0;
  out.tremble = 0;
  out.under = 0;
  out.web = 0;
  out.webGlow = 0;
  out.frost = 0;
  out.frostAlpha = 0;
  out.mist = 0;
  out.snow = 0;
  out.breath = 0;
  out.sinceBreach = -99;
  out.ringR = 0;
  out.ring = 0;
  out.flash = 0;
  out.geyserH = 0;
  out.geyser = 0;
  for (const b of out.blades) {
    b.shown = false;
    b.lift = 0;
    b.aim = 0;
    b.plunge = 0;
    b.glow = 0;
  }
  return out;
}

/** Where blade `i` starts round her (radians, her frame): evenly round the
 *  ring, the first straight ahead of her (toward the raid). */
export function entranceBladeBearing0(i: number): number {
  return (i / QUENCH_ENTRANCE_BLADES.count) * Math.PI * 2;
}

/**
 * The scene at painter time `time` (FROZEN, AWAKE or seconds in), written
 * into `out` (allocation free once built).
 */
export function quenchEntranceLook(
  time: number,
  out: QuenchEntranceLook = newQuenchEntranceLook(),
): QuenchEntranceLook {
  if (time === AWAKE || time >= QUENCH_ENTRANCE.end) return awake(out);
  const E = QUENCH_ENTRANCE;
  const frozen = time === FROZEN;
  const t = frozen ? 0 : Math.max(0, time);
  out.active = true;
  out.frozen = frozen;
  out.t = t;
  const since = frozen ? -99 : t - E.breachAt;
  out.sinceBreach = since;
  const broke = since >= 0;
  out.stance = broke ? 'emerge' : 'frozen';
  out.dim = !broke;
  const tail =
    t > QUENCH_INTRO.seconds
      ? clamp01((t - QUENCH_INTRO.seconds) / (E.end - QUENCH_INTRO.seconds))
      : 0;
  // Her eyes: shut, then the sharp glint as they open, settling bright.
  if (frozen) out.eyes = 0;
  else {
    const open = smooth(E.eyesAt, E.eyesAt + E.eyesFor * 0.4, t);
    const glint = Math.exp(-Math.max(0, t - E.eyesAt - E.eyesFor * 0.4) * 2.4);
    out.eyes = open * (1.25 + 1.1 * glint) + (broke ? 0.6 * Math.exp(-since * 1.8) : 0);
  }
  // Her heart: a slow heartbeat under the ice, quickening as the light
  // swells, blazing at the breach, the fight's own after.
  const beatRate = frozen ? 0.45 : 0.45 + 0.9 * smooth(E.gatherAt - 1, E.breachAt, t);
  const beat = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * beatRate - 1.2);
  out.heart = broke
    ? 1 + 1.6 * Math.exp(-since * 1.2)
    : 0.16 + 0.14 * beat * beat + (frozen ? 0 : 0.7 * smooth(E.gatherAt - 0.8, E.breachAt, t));
  out.ambient = broke ? smooth(0.4, QUENCH_EMERGE_CLIP.stood, since) : 0;
  // The sheet over her, crazing and trembling as the light swells, gone at
  // the breach.
  out.sheet = broke ? 0 : 1;
  out.sheetCrack = frozen ? 0 : smooth(E.gatherAt - 0.6, E.breachAt, t);
  out.tremble = frozen ? 0 : broke ? 0 : smooth(E.gatherAt, E.breachAt, t) ** 1.5;
  out.under = frozen
    ? 0.1 + 0.14 * beat * beat
    : broke
      ? 1.6 * Math.exp(-since * 2.2)
      : 0.25 * rise(E.eyesAt, E.webAt, t) + 0.95 * smooth(E.gatherAt - 0.4, E.breachAt, t) ** 1.3;
  // The web: it runs out, its light swelling to the breach and fading after.
  out.web = frozen ? 0 : rise(E.webAt, E.webAt + E.webFor, t);
  const glowIn = smooth(E.webAt, E.webAt + 0.5, t);
  out.webGlow = frozen
    ? 0
    : broke
      ? (1 + 0.9 * Math.exp(-since * 2.5)) * (1 - smooth(1.5, 5.5, since)) * (1 - tail)
      : glowIn * (0.75 + 0.45 * smooth(E.gatherAt, E.breachAt, t));
  // The frost creeping out with the web, lasting to the tail.
  out.frost = frozen ? 0 : smooth(E.webAt - 0.2, E.webAt + E.frostFor, t);
  out.frostAlpha = frozen
    ? 0
    : out.frost > 0
      ? (0.35 + 0.65 * clamp01(out.frost * 1.5)) * (1 - tail)
      : 0;
  // The cold air: mist off the ice, snow from a hush to a flurry, thinning
  // in the tail; the frost breath off the sheet while she lies under it.
  out.mist = frozen
    ? 0.15
    : (0.2 + 0.8 * rise(E.webAt, E.breachAt, t) + (broke ? 0.6 * Math.exp(-since) : 0)) *
      (1 - tail);
  out.snow = Math.min(
    QUENCH_ENTRANCE_SNOW_PEAK,
    frozen
      ? 0.12
      : (0.15 +
          0.85 * rise(E.webAt, E.webAt + 1.5, t) +
          1.3 * smooth(E.gatherAt, E.breachAt + 0.6, t)) *
          (1 - 0.85 * tail),
  );
  out.breath = broke ? 0 : 1;
  // The breach's shockwave and burst of light.
  if (broke) {
    const k = clamp01(since / E.ringFor);
    out.ringR = E.ringFrom + (E.ringTo - E.ringFrom) * (1 - (1 - k) ** 2.4);
    out.ring = since < E.ringFor ? (1 - k) ** 0.8 : 0;
    out.flash =
      since < E.flashFor
        ? E.flashPeak * Math.min(1, since / 0.04) * (1 - since / E.flashFor) ** 2
        : 0;
    out.geyserH = rise(0, E.geyserRise, since);
    const fall = clamp01((since - E.geyserRise - E.geyserHold) / E.geyserFall);
    out.geyser = since < E.geyserRise + E.geyserHold + E.geyserFall ? 1 - fall * fall : 0;
  } else {
    out.ringR = 0;
    out.ring = 0;
    out.flash = 0;
    out.geyserH = 0;
    out.geyser = 0;
  }
  // The blades.
  const B = QUENCH_ENTRANCE_BLADES;
  const aimK = smooth(E.pointAt, E.pointAt + E.pointFor, t);
  // They circle until they aim; the circling slows to a stop as they turn.
  const orbitT = Math.max(0, Math.min(t, E.pointAt + E.pointFor * 0.5) - E.bladesAt);
  for (let i = 0; i < out.blades.length; i++) {
    const b = out.blades[i];
    const start = E.bladesAt + i * E.bladeStep;
    const plungeFrom = E.plungeAt + i * E.plungeStep;
    b.plunge = smooth(plungeFrom, plungeFrom + E.plungeFor, t);
    b.shown = !frozen && t >= start && b.plunge < 1;
    b.lift = frozen ? 0 : rise(start, start + E.bladeRise, t);
    b.bearing = entranceBladeBearing0(i) + B.orbit * orbitT;
    // The snap: past the mark a breath, then settling on it.
    const snap = t >= E.pointAt ? t - E.pointAt : -1;
    b.aim =
      snap < 0
        ? 0
        : aimK + 0.12 * Math.sin(Math.min(1, snap / 0.5) * Math.PI) * Math.exp(-snap * 4);
    const up = 1 - b.lift;
    b.spin = 14 * up * up + 0.6 * Math.max(0, t - start) + i;
    b.reach = 0.35 + 0.65 * b.lift;
    b.glint = snap < 0 ? 0 : Math.exp(-snap * 3.2) * Math.min(1, snap / 0.04);
    const born = t >= start ? Math.exp(-(t - start) * 2.2) : 0;
    const pointFlare = t >= E.pointAt ? Math.exp(-(t - E.pointAt) * 2.6) : 0;
    b.glow = b.shown ? 0.7 + 0.8 * born + 0.9 * pointFlare : 0;
  }
  return out;
}

/** Did the scene cross the beat `at` between painter times `prev` and `t`?
 *  Never for a scene joined late (`prev` not a scene time) or while frozen:
 *  a late joiner plays no one-shot it missed. */
export function crossedQuenchBeat(prev: number, t: number, at: number): boolean {
  return prev >= 0 && t >= 0 && prev < at && t >= at;
}

/** The breach's burst of light: none under reduced motion (as no thud). */
export function quenchEntranceFlash(look: QuenchEntranceLook, reducedMotion: boolean): number {
  return reducedMotion ? 0 : look.flash;
}

/** The breach's thud for a player `distance` yards from her: none under
 *  reduced motion or past the reach, else falling off with distance. */
export function quenchEntranceShake(distance: number, reducedMotion: boolean): number {
  const E = QUENCH_ENTRANCE;
  if (reducedMotion || distance >= E.shakeReach) return 0;
  return E.shake * (1 - (distance / E.shakeReach) * 0.6);
}

/** The snow's peak share (a flurry, held under the smoke pool's room:
 *  the mist, the snow and the shockwave's spray share one pool). */
export const QUENCH_ENTRANCE_SNOW_PEAK = 1.6;

/** The low tier's share of the particles (counts only, never a beat). */
export const QUENCH_ENTRANCE_LOW_SHARE = 0.4;

/** The pools' rates (a second, at full share and full density). */
export const QUENCH_ENTRANCE_POOLS = {
  /** Mist off the ice, snow over the lake, frost breath off the sheet. */
  mistRate: 26,
  snowRate: 110,
  snowLife: 3.8,
  breathEvery: 3.4,
  /** The snow's cloud: its reach off her and its height. */
  snowReach: 34,
  snowHeight: 22,
  /** Light motes rising off the cracks a second at full glow. */
  moteRate: 70,
  /** The breach: shards flung up, the instanced chunks of the sheet, the
   *  frost mist rolling out, the powder snow blasted up to rain down. */
  shardBurst: 260,
  mistBurst: 56,
  debrisBurst: 100,
  /** The great plates of lake ice heaved up round her. */
  slabs: 16,
  chunks: 56,
  /** The shockwave's spray thrown up along its front a second. */
  sprayRate: 300,
} as const;

/** The sounds of the scene (the Quench's own samples, `heart_quench_*`):
 *  the ice cracking deep as the web runs (three groans, the later ones
 *  lower), the cold gathering under her, the breach (the ice shattering and
 *  the lake breaking), the blades waking, their lock as they point, the
 *  plunge. Each plays once, on its beat, for a scene seen crossing it. */
export const QUENCH_ENTRANCE_SOUNDS: readonly {
  at: number;
  key: string;
  gain: number;
  rate: number;
}[] = [
  { at: QUENCH_ENTRANCE.webAt, key: 'heart_quench_crack', gain: 1, rate: 0.82 },
  { at: QUENCH_ENTRANCE.webAt + 0.9, key: 'heart_quench_crack', gain: 0.9, rate: 0.7 },
  { at: QUENCH_ENTRANCE.webAt + 1.8, key: 'heart_quench_crack', gain: 0.85, rate: 0.62 },
  { at: QUENCH_ENTRANCE.breachAt - 2, key: 'heart_quench_wake_charge', gain: 0.85, rate: 1.0 },
  { at: QUENCH_ENTRANCE.breachAt, key: 'heart_quench_hole', gain: 1, rate: 0.75 },
  { at: QUENCH_ENTRANCE.breachAt, key: 'heart_quench_shatter', gain: 1, rate: 0.8 },
  { at: QUENCH_ENTRANCE.bladesAt, key: 'heart_quench_wake', gain: 0.9, rate: 1.05 },
  { at: QUENCH_ENTRANCE.pointAt, key: 'heart_quench_slash_lock', gain: 1, rate: 0.9 },
  { at: QUENCH_ENTRANCE.plungeAt, key: 'heart_quench_plunge', gain: 0.8, rate: 1.1 },
];

// ---- the web of cracks across the lake -----------------------------------------------------

/** Deterministic hash in [0, 1). */
export function quenchEntranceHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A crack's point in her frame (x her left... her right, z ahead of her
 *  toward the raid, yards), its reveal (0 at her, 1 at the web's farthest
 *  tip) and its half width (yards). */
export interface WebPoint {
  x: number;
  z: number;
  reveal: number;
  half: number;
}

export const WEB = {
  /** Radial cracks out of her. */
  spokes: 15,
  /** Points per spoke. */
  steps: 18,
  /** A spoke's reach behind her and ahead of her (toward the raid, the way
   *  she faces), the web's start off her middle, its jag and width. */
  reachBack: 19,
  reachAhead: 33,
  start: 2.6,
  jag: 0.42,
  width: 0.5,
  /** The rings of the web (yards from her) joining neighbouring spokes. */
  rings: [5, 8.5, 12.5, 17, 22.5, 28] as readonly number[],
  ringSteps: 5,
} as const;

/** A spoke's reach at bearing `a` (radians, 0 ahead of her). */
export function webReach(a: number): number {
  const ahead = Math.max(0, Math.cos(a));
  return WEB.reachBack + (WEB.reachAhead - WEB.reachBack) * ahead * ahead;
}

/** The web's farthest tip (the reveal's 1). */
const WEB_FAR = WEB.reachAhead + 1;

/** Every crack of the web as a polyline in her frame: the spokes, then the
 *  rings' arcs between neighbouring spokes (each arc only where both spokes
 *  reach). Deterministic. */
export const ENTRANCE_WEB: readonly (readonly WebPoint[])[] = (() => {
  const lines: WebPoint[][] = [];
  const spokes: { x: number; z: number; d: number }[][] = [];
  const bearings: number[] = [];
  for (let i = 0; i < WEB.spokes; i++) {
    const a0 = (i / WEB.spokes) * Math.PI * 2 + (quenchEntranceHash(i, 3) - 0.5) * 0.28;
    bearings.push(a0);
    const reach = webReach(a0) * (0.82 + 0.18 * quenchEntranceHash(i, 5));
    const pts: WebPoint[] = [];
    const raw: { x: number; z: number; d: number }[] = [];
    let a = a0;
    let r = WEB.start;
    const step = (reach - WEB.start) / WEB.steps;
    for (let k = 0; k <= WEB.steps; k++) {
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const taper = 1 - k / (WEB.steps + 1);
      pts.push({
        x,
        z,
        reveal: clamp01(r / WEB_FAR),
        half: WEB.width * (0.3 + 0.7 * taper) * (0.85 + 0.3 * quenchEntranceHash(i, 7)),
      });
      raw.push({ x, z, d: r });
      a += ((quenchEntranceHash(i * 31 + k, 11) - 0.5) * 2 * WEB.jag * step) / Math.max(4, r);
      r += step;
    }
    lines.push(pts);
    spokes.push(raw);
  }
  // The rings: an arc from each spoke to the next at each ring's radius,
  // sagging a little inward like a real web's.
  for (let ri = 0; ri < WEB.rings.length; ri++) {
    const R = WEB.rings[ri];
    for (let i = 0; i < WEB.spokes; i++) {
      const j = (i + 1) % WEB.spokes;
      const a = spokes[i];
      const b = spokes[j];
      if (a[a.length - 1].d < R || b[b.length - 1].d < R) continue;
      // Skip some arcs (a cracked lake, never a drawn grid).
      if (quenchEntranceHash(i * 13 + ri, 17) < 0.22) continue;
      const pa = pointAtRadius(a, R);
      const pb = pointAtRadius(b, R);
      const pts: WebPoint[] = [];
      for (let k = 0; k <= WEB.ringSteps; k++) {
        const f = k / WEB.ringSteps;
        const sag = 1 - 0.13 * Math.sin(f * Math.PI);
        const jx = (quenchEntranceHash(i * 97 + ri * 7 + k, 19) - 0.5) * 0.7;
        const jz = (quenchEntranceHash(i * 89 + ri * 5 + k, 23) - 0.5) * 0.7;
        const x = (pa.x + (pb.x - pa.x) * f) * sag + jx;
        const z = (pa.z + (pb.z - pa.z) * f) * sag + jz;
        pts.push({
          x,
          z,
          reveal: clamp01(Math.hypot(x, z) / WEB_FAR),
          half: WEB.width * 0.5 * (1 - (ri / WEB.rings.length) * 0.4),
        });
      }
      lines.push(pts);
    }
  }
  return lines;
})();

function pointAtRadius(
  spoke: readonly { x: number; z: number; d: number }[],
  R: number,
): { x: number; z: number } {
  for (let k = 1; k < spoke.length; k++) {
    if (spoke[k].d >= R) {
      const a = spoke[k - 1];
      const b = spoke[k];
      const f = (R - a.d) / (b.d - a.d);
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
    }
  }
  const last = spoke[spoke.length - 1];
  return { x: last.x, z: last.z };
}

/** The web's vertex count as a strip pair per point (the painter's buffer). */
export const WEB_VERTICES = ENTRANCE_WEB.reduce((n, l) => n + l.length * 2, 0);

/** The web's spokes' tips (her frame), where the light motes rise thickest. */
export const WEB_TIPS: readonly { x: number; z: number }[] = ENTRANCE_WEB.slice(0, WEB.spokes).map(
  (l) => ({ x: l[l.length - 1].x, z: l[l.length - 1].z }),
);

/** The frost's reach (yards from her) at its full spread. */
export const FROST_REACH = WEB.reachAhead + 3;

// ---- the sheet of ice over her --------------------------------------------------------------

/** The sheet over her lying body, in her frame (yards): its middle (her hips
 *  lie at her place, her head toward her back), its half length and width,
 *  and its height over the ice (her lying body tops out at about a yard). */
export const QUENCH_SHEET = {
  z: -0.4,
  halfLength: 6.6,
  halfWidth: 3.6,
  height: 1.55,
} as const;

/** Where her mouth lies under the sheet (her frame, yards; the frost breath
 *  drifts off the sheet over it while the rig's socket is still loading). */
export const QUENCH_SHEET_MOUTH = { x: 0, z: -3.3 * QUENCH_YD_PER_UNIT } as const;

// ---- the sheet's chunks: flung up at the breach --------------------------------------------

/** Gravity on a flung chunk (yards a second squared) and how long a fallen
 *  one lies on the ice before it melts away. */
export const CHUNK_GRAVITY = 24;
export const CHUNK_REST = 1.3;

/** A chunk of the sheet `since` seconds after the breach, in her frame:
 *  where it is, how big (0 gone), how far it has tumbled (radians). */
export interface ChunkState {
  x: number;
  y: number;
  z: number;
  size: number;
  spin: number;
  ax: number;
  ay: number;
  az: number;
}

export function newChunkState(): ChunkState {
  return { x: 0, y: 0, z: 0, size: 0, spin: 0, ax: 0, ay: 1, az: 0 };
}

/** Chunk `i` of the sheet (deterministic): born over the sheet, flung up
 *  and out (the fountain), tumbling, landing on the ice and melting away. */
export function sheetChunkAt(i: number, since: number, out: ChunkState): ChunkState {
  const h = (k: number) => quenchEntranceHash(i, k);
  const S = QUENCH_SHEET;
  const ang = h(1) * Math.PI * 2;
  const rr = Math.sqrt(h(2));
  const x0 = Math.cos(ang) * S.halfWidth * rr * 0.9;
  const z0 = S.z + Math.sin(ang) * S.halfLength * rr * 0.9;
  const y0 = 0.6 + h(3) * (S.height - 0.4);
  // Up and out from her middle: the fountain's core flies highest.
  const out0 = 4 + 11 * h(4);
  const up = 11 + 16 * (1 - rr) + 7 * h(5);
  const dx = x0;
  const dz = z0 - S.z;
  const dl = Math.hypot(dx, dz) || 1;
  const vx = (dx / dl) * out0;
  const vz = (dz / dl) * out0;
  const base = 0.6 + 1.1 * h(6) * h(6);
  // Time to land (y back to the ice).
  const g = CHUNK_GRAVITY;
  const land = (up + Math.sqrt(up * up + 2 * g * y0)) / g;
  const s = Math.max(0, since);
  const tf = Math.min(s, land);
  out.x = x0 + vx * tf;
  out.z = z0 + vz * tf;
  out.y = Math.max(0.05, y0 + up * tf - 0.5 * g * tf * tf);
  const rest = s - land;
  out.size = since < 0 ? 0 : rest > 0 ? base * clamp01(1 - rest / CHUNK_REST) : base;
  out.spin = tf * (4 + 8 * h(7));
  const ax = h(8) - 0.5;
  const ay = h(9) - 0.5;
  const az = h(10) - 0.5;
  const al = Math.hypot(ax, ay, az) || 1;
  out.ax = ax / al;
  out.ay = ay / al;
  out.az = az / al;
  return out;
}

// ---- the great plates heaved up round her at the breach ---------------------------------

/** A heaved plate `since` seconds after the breach, in her frame: where its
 *  foot is, its bearing (turned out from her), how far it has tipped up
 *  (radians from lying flat), its tumble once flung, its size (yards; 0
 *  gone). */
export interface SlabState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tilt: number;
  tumble: number;
  w: number;
  d: number;
  t: number;
}

export function newSlabState(): SlabState {
  return { x: 0, y: 0, z: 0, yaw: 0, tilt: 0, tumble: 0, w: 0, d: 0, t: 0 };
}

/** The plates' clock: the heave, how long the wreck stands, the sinking. */
export const SLAB = { heave: 0.32, stand: 4.2, sink: 1.4 } as const;

/** Plate `i` (deterministic): burst up out of the lake round her and tipped
 *  outward; the outer ones flung up and tumbling, landing; all of them
 *  sinking back under the ice as the scene ends. */
export function heavedSlabAt(i: number, since: number, out: SlabState): SlabState {
  const h = (k: number) => quenchEntranceHash(i + 101, k);
  const n = QUENCH_ENTRANCE_POOLS.slabs;
  const bearing = ((i + 0.5 * h(1)) / n) * Math.PI * 2;
  const r = 3.2 + 5.8 * h(2);
  const flung = h(3) > 0.78;
  out.yaw = bearing;
  out.w = 1.6 + 2.6 * h(4);
  out.d = 1.2 + 2 * h(5);
  out.t = 0.35 + 0.35 * h(6);
  if (since < 0) {
    out.w = 0;
    return out;
  }
  const heave = rise(0, SLAB.heave * (0.7 + 0.6 * h(7)), since);
  const sink = clamp01((since - SLAB.stand - h(8)) / SLAB.sink);
  let rr = r;
  let y = -1.5 + (1.5 + 0.6 * h(9)) * heave;
  let tumble = 0;
  if (flung) {
    // Thrown up and out, landing a few yards on.
    const up = 10 + 8 * h(10);
    const g = CHUNK_GRAVITY;
    const land = (2 * up) / g;
    const tf = Math.min(since, land);
    y = up * tf - 0.5 * g * tf * tf;
    rr = r + (1.5 + 3 * h(11)) * (tf / land);
    tumble = tf * (3 + 5 * h(12));
  }
  y -= 3 * sink * sink;
  out.x = Math.sin(bearing) * rr;
  out.z = Math.cos(bearing) * rr;
  out.y = y;
  out.tilt = (0.6 + 0.65 * h(13)) * heave;
  out.tumble = tumble;
  if (sink >= 1) out.w = 0;
  return out;
}

/** The longest a chunk lives after the breach (its flight and its melt). */
export const CHUNK_LIFE = (() => {
  const c = newChunkState();
  let longest = 0;
  for (let i = 0; i < QUENCH_ENTRANCE_POOLS.chunks; i++) {
    for (let s = 0; s < 12; s += 0.05) {
      sheetChunkAt(i, s, c);
      if (c.size <= 0) {
        longest = Math.max(longest, s);
        break;
      }
    }
  }
  return longest;
})();

// ---- the conjured blades --------------------------------------------------------------------

/** One blade's shape in its own frame (y up its length from the pommel's
 *  foot, the point at `length`): a crystal sword of the Smith's own section
 *  (quench_blade_tip_core.ts: the flat diamond the great blades are cut in),
 *  scaled to its size. Each ring of the profile: its height share up the
 *  sword, its half width and half thickness (yards). */
export interface BladeRing {
  y: number;
  w: number;
  d: number;
}

export const ENTRANCE_BLADE_PROFILE: readonly BladeRing[] = (() => {
  const L = QUENCH_ENTRANCE_BLADES.length;
  // The great blade's section, shrunk to a conjured sword (its widest about
  // half a yard).
  const k = 0.62 / bladeHalfWidth(0);
  const w = (s: number) => bladeHalfWidth(s * 9) * k;
  const d = (s: number) => bladeHalfThick(s * 9) * k * 1.0;
  return [
    // The pommel, the grip, the guard.
    { y: 0, w: 0.05, d: 0.05 },
    { y: 0.03, w: 0.16, d: 0.16 },
    { y: 0.06, w: 0.1, d: 0.1 },
    { y: 0.17, w: 0.09, d: 0.09 },
    { y: 0.18, w: 0.9, d: 0.2 },
    { y: 0.205, w: 0.95, d: 0.21 },
    { y: 0.22, w: w(0) * 1.05, d: d(0) * 1.2 },
    // The blade, tapering to its point.
    { y: 0.4, w: w(0.2), d: d(0.2) },
    { y: 0.65, w: w(0.55), d: d(0.55) },
    { y: 0.86, w: w(0.85) * 0.78, d: d(0.85) * 0.8 },
    { y: 1, w: 0.01, d: 0.01 },
  ].map((r) => ({ y: r.y * L, w: r.w, d: r.d }));
})();
