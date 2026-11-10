// The Guardian of the Breath's entrance as numbers (docs/design/raid/
// smith_heart.md section 7.2, "The entrance"), "Calm before the storm": the
// pure half of breath_entrance_fx.ts and its two parts (breath_entrance_
// storm.ts, the eye, the funnel and the gust; breath_entrance_bolts.ts, the
// lightning).
//
// The sim holds the guardian out of reach until the raid first climbs onto
// the Storm Cornice, then runs the scene's clock on one aura on it
// (encounters/smith_heart/breath_intro.ts); this module reads that clock
// (`breathEntranceClock`), keeps the painter's own smooth scene time on it
// (`stepBreathEntranceTime`: a late joiner starts where the scene is, a scene
// seen ending runs on to its tail, one cut short bursts at once, one never
// seen is simply awake) and plans every beat (`breathEntranceLook`):
//
//   the calm     the Cornice utterly still: dust and loose stone hang in the
//                air over the floor, nothing moves, no wind; high over the
//                middle a dark smudge of cloud turns very slowly
//   the pull     everything starts to drift, then races up toward that point
//                in the sky in tightening spirals, the smudge swelling into
//                a turning eye of storm cloud; a rising howl
//   the funnel   a tornado comes down out of the eye onto the floor (a thud
//                and a ring of dust as it touches), a great twisting column
//                of storm cloud with lightning crawling inside and round it,
//                stone orbiting it, bolts striking the floor at its foot and
//                thunder
//   the burst    it explodes outward: a ring of gust sweeps across the whole
//                Cornice past the raid (cosmetic: no damage, no knockback),
//                the orbiting stone flung out, and the guardian floats where
//                it stood (it has been forming inside the funnel)
//   the finale   lightning strikes the floor round it, then one great bolt
//                onto it with a thunderclap; the fight is its
//
// No voice: wind and thunder only.
//
// Presentation only, every tier (the low tier thins counts, never a beat;
// reduced motion drops the thuds and the flashes and caps the added light).
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic (a hash,
// never rng).

import { BREATH, SMITH_HEART_BOSS_SPOTS } from '../../sim/content/smith_heart_layout';
import { BREATH_AURAS } from '../../sim/encounters/smith_heart/breath_ids';
import {
  BREATH_INTRO,
  BREATH_INTRO_STAGES,
} from '../../sim/encounters/smith_heart/breath_intro_plan';

// ---- the clock -----------------------------------------------------------------------------

/** The Form clip (scripts/build_breath_entrance_anims.mjs): its length and
 *  the share of its size it starts from. */
export const BREATH_FORM_CLIP = { length: 1.6, from: 0.03 } as const;

/** The guardian's growth over the Form clip (`k` 0..1 of its time): eased
 *  out with a breath of overshoot (the build script's `formScale`). */
export function breathFormScale(k: number): number {
  const c = Math.min(1, Math.max(0, k));
  const ease = 1 - (1 - c) ** 3;
  const over = 0.06 * Math.sin(Math.PI * Math.min(1, c / 0.92)) * c;
  return BREATH_FORM_CLIP.from + (1 - BREATH_FORM_CLIP.from) * ease + over * (1 - c);
}

/** The scene's beats, seconds from the wake (the sim's clock). */
export const BREATH_ENTRANCE = {
  /** The dead calm: the hanging dust and stone, the smudge in the sky. */
  calmTo: 1.8,
  /** The pull: each piece starts drifting within `pullSpread` of `pullAt`
   *  and takes about `pullTravel` to reach the eye. */
  pullAt: 1.8,
  pullSpread: 1.1,
  pullTravel: 1.9,
  /** The eye: a smudge at first, swelling to its full by `eyeFull`. */
  eyeFull: 4.6,
  /** The funnel comes down from the eye, its tip on the floor at `touchAt`. */
  descendFrom: 4.5,
  touchAt: 5.8,
  /** The guardian's Form clip leaves here (inside the funnel), so its body
   *  is whole just before the burst. */
  formAt: 8.5 - BREATH_FORM_CLIP.length - 0.05,
  /** The burst: the funnel blown apart, the ring of gust. */
  burstAt: 8.5,
  burstFor: 0.75,
  ringFrom: 5,
  ringTo: 66,
  ringFor: 1.7,
  /** The great bolt onto the guardian, the thunderclap. */
  finalAt: 10.85,
  /** The burst of light at the burst and the great bolt (a flash on it,
   *  never a white-out): its size (yards) and its peak. */
  flashFor: 0.5,
  flashSize: 34,
  flashPeak: 1.1,
  /** The cameras' thuds: the touch, the burst, a strike, the great bolt.
   *  Each at the guardian; falling off over `shakeReach`. */
  shakeTouch: 0.7,
  shakeBurst: 1.5,
  shakeStrike: 0.28,
  shakeFinal: 1.0,
  shakeReach: 120,
  /** The scene's tail: the eye thins away, the dust settles. */
  end: BREATH_INTRO.seconds + 2.2,
} as const;

const E = BREATH_ENTRANCE;

/** The storm's shape (yards, off the guardian's foot): the eye high over
 *  it, the funnel from the floor up into the eye. */
export const BREATH_STORM_SHAPE = {
  eyeH: 40,
  /** The eye's radius at its full, and as the smudge the calm shows. */
  eyeR: 36,
  eyeSmudgeR: 9,
  /** The funnel: its height (to under the eye), its radius at the foot and
   *  the top, and how far its foot snakes about. */
  funnelH: 39,
  rBot: 5.6,
  rTop: 20,
  sway: 2.6,
  /** The guardian's heart height (where the great bolt lands, yards). */
  heartY: 9,
} as const;

const S = BREATH_STORM_SHAPE;

/** The funnel's radius at height share `y` (0 the foot, 1 the eye),
 *  before the burst (its shader runs the same curve). */
export function funnelRadius(y: number): number {
  const c = Math.min(1, Math.max(0, y));
  return S.rBot + (S.rTop - S.rBot) * c * c * (0.6 + 0.4 * c);
}

/** One strike of lightning: when, where it lands (stage-local: angle off the
 *  guardian about up, from +z toward +x, and yards out), its kind (`ground`
 *  a bolt from the eye to the floor; `axis` down the funnel's heart onto the
 *  floor; `guardian` the great bolt onto it) and whether it is a big one. */
export interface BreathStrike {
  at: number;
  kind: 'ground' | 'axis' | 'guardian';
  angle: number;
  r: number;
  big: boolean;
}

/** The scene's strikes (the raid climbs in from the west, angle -PI/2). */
export const BREATH_STRIKES: readonly BreathStrike[] = [
  { at: 5.05, kind: 'ground', angle: -2.0, r: 21, big: false },
  { at: E.touchAt, kind: 'axis', angle: 0, r: 0, big: true },
  { at: 6.5, kind: 'ground', angle: -1.2, r: 12, big: false },
  { at: 7.15, kind: 'ground', angle: 2.3, r: 14, big: false },
  { at: 7.75, kind: 'ground', angle: -2.7, r: 11, big: false },
  { at: 8.15, kind: 'ground', angle: 0.6, r: 13, big: false },
  { at: 9.3, kind: 'ground', angle: -1.6, r: 12, big: true },
  { at: 9.65, kind: 'ground', angle: 1.2, r: 11, big: true },
  { at: 10.0, kind: 'ground', angle: 3.0, r: 13, big: true },
  { at: 10.3, kind: 'ground', angle: -0.4, r: 10, big: true },
  { at: E.finalAt, kind: 'guardian', angle: 0, r: 0, big: true },
];

/** A strike's bolt lives this long, re-struck `BOLT_FLICKERS` times. */
export const BOLT_LIFE = 0.5;
export const BOLT_FLICKERS = 3;

/** The stances the rig holds (breath_entrance gestures): gathered into
 *  nothing (its Gathered clip), forming out of the wind (the Form one-shot,
 *  sent once), or floating (its calm stance). */
export type BreathEntranceStance = 'gathered' | 'form' | 'stand';

/** The gestures the entrance sends through the gesture seam (the look in
 *  characters/smith_heart_boss_looks.ts binds them; standing is the body's
 *  own calm stance, breath_body_core.ts BREATH_BODY_GESTURES.calm). */
export const BREATH_ENTRANCE_GESTURES = {
  gathered: 'smith_heart_breath_body_gathered',
  form: 'smith_heart_breath_body_form',
} as const;

/** What the guardian's aura says: dormant, waking at `t`, or neither. */
export interface BreathEntranceClock {
  stage: 'none' | 'dormant' | 'waking';
  t: number;
}

/** Read the entrance off the guardian's auras (allocation free). */
export function breathEntranceClock(
  auras: readonly { id: string; value: number; remaining: number; duration: number }[],
  out: BreathEntranceClock = { stage: 'none', t: 0 },
): BreathEntranceClock {
  out.stage = 'none';
  out.t = 0;
  for (const a of auras) {
    if (a.id !== BREATH_AURAS.intro) continue;
    if (Math.round(a.value) === BREATH_INTRO_STAGES.waking) {
      out.stage = 'waking';
      const total =
        Number.isFinite(a.duration) && a.duration > 0 ? a.duration : BREATH_INTRO.seconds;
      out.t = Math.max(0, Math.min(total, total - a.remaining));
    } else out.stage = 'dormant';
    break;
  }
  return out;
}

/** The painter's scene time: `DORMANT` while it waits, `AWAKE` once the
 *  scene is over (or was never seen waking), else seconds into the scene. */
export const DORMANT = -1;
export const AWAKE = -2;

/** How far the painter's own time may drift off the aura's before it snaps
 *  back (a stalled tab, a late snapshot). */
export const BREATH_ENTRANCE_DRIFT = 0.35;

/**
 * Step the painter's scene time `prev` by `dt` against the aura's `clock`:
 * dormant holds DORMANT; waking runs smoothly on the aura's time (a scene
 * first seen mid-way starts where it is, never backward); a scene that has
 * been seen keeps running after the aura is gone, to its tail, then AWAKE
 * (cut short before the burst, it jumps there: the guardian bursts out at
 * once); a guardian never seen waking is AWAKE (a late joiner sees it
 * floating).
 */
export function stepBreathEntranceTime(
  prev: number,
  dt: number,
  clock: BreathEntranceClock,
): number {
  if (clock.stage === 'dormant') return DORMANT;
  if (clock.stage === 'waking') {
    if (prev < 0) return clock.t;
    const next = prev + dt;
    if (next > clock.t + BREATH_ENTRANCE_DRIFT) return prev;
    return clock.t - next > BREATH_ENTRANCE_DRIFT ? clock.t : next;
  }
  if (prev < 0) return AWAKE;
  // Cut short before the burst (a forced pull): it bursts now, never fought
  // as a speck in the air.
  if (prev < E.burstAt) return E.burstAt;
  const next = prev + dt;
  return next >= E.end ? AWAKE : next;
}

/** Did the scene cross the beat `at` between painter times `prev` and `t`?
 *  Never for a scene joined late (`prev` not a scene time) or while it waits:
 *  a late joiner plays no one-shot it missed. */
export function crossedBreathBeat(prev: number, t: number, at: number): boolean {
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
  since < 0 ? 0 : Math.min(1, since / 0.04) * (1 - clamp01(since / span)) ** 2;

export interface BreathEntranceLook {
  /** The scene is on (or it waits): false once awake. */
  active: boolean;
  /** Waiting for the raid (the calm, unbroken). */
  dormant: boolean;
  /** Seconds into the scene (0 waiting). */
  t: number;
  stance: BreathEntranceStance;
  /** The guardian's air (breath_body.ts reads it through
   *  breath_entrance_state.ts): 0 while it is nothing, filling as it forms,
   *  1 once it has burst out. */
  body: number;
  /** The hanging dust and stone's stillness (1 the dead calm). */
  calm: number;
  /** The eye: its strength (0..1), its radius (yards), its turn (radians). */
  eye: number;
  eyeR: number;
  eyeTurn: number;
  /** The funnel: how far down from the eye it has come (0..1, 1 on the
   *  floor), its strength (0..1) and its burst (0..1, blown apart). */
  reach: number;
  funnel: number;
  burst: number;
  /** Lightning lighting the cloud from within (0..1, flickering). */
  flicker: number;
  /** The lightning's light without its flicker (reduced motion reads it:
   *  each strike one fading flash, no crackle). */
  steady: number;
  /** Where up the funnel the flicker is (0 the foot, 1 the eye). */
  flickerY: number;
  /** The rising howl's level (0..1). */
  howl: number;
  /** Seconds since the touch, the burst and the great bolt (negative before). */
  sinceTouch: number;
  sinceBurst: number;
  sinceFinal: number;
  /** The ring of gust: its radius (yards) and strength. */
  ringR: number;
  ring: number;
  /** The orbiting stone's share (0..1) round the funnel. */
  orbit: number;
  /** The burst of light at the burst or the great bolt (opacity share). */
  flash: number;
}

export function newBreathEntranceLook(): BreathEntranceLook {
  return {
    active: false,
    dormant: false,
    t: 0,
    stance: 'stand',
    body: 1,
    calm: 0,
    eye: 0,
    eyeR: 0,
    eyeTurn: 0,
    reach: 0,
    funnel: 0,
    burst: 0,
    flicker: 0,
    steady: 0,
    flickerY: 0.5,
    howl: 0,
    sinceTouch: -99,
    sinceBurst: -99,
    sinceFinal: -99,
    ringR: 0,
    ring: 0,
    orbit: 0,
    flash: 0,
  };
}

/** The awake look: everything as the fight has it, no scene (written in
 *  place: the painter asks every frame). */
function awake(out: BreathEntranceLook): BreathEntranceLook {
  out.active = false;
  out.dormant = false;
  out.t = 0;
  out.stance = 'stand';
  out.body = 1;
  out.calm = 0;
  out.eye = 0;
  out.eyeR = 0;
  out.eyeTurn = 0;
  out.reach = 0;
  out.funnel = 0;
  out.burst = 0;
  out.flicker = 0;
  out.steady = 0;
  out.flickerY = 0.5;
  out.howl = 0;
  out.sinceTouch = -99;
  out.sinceBurst = -99;
  out.sinceFinal = -99;
  out.ringR = 0;
  out.ring = 0;
  out.orbit = 0;
  out.flash = 0;
  return out;
}

/** Deterministic hash in [0, 1). */
export function breathEntranceHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hash = breathEntranceHash;

/** A strike's light at scene time `t` (0..1: its bolt's flicker). */
export function strikeLight(s: BreathStrike, t: number): number {
  const since = t - s.at;
  if (since < 0 || since > BOLT_LIFE) return 0;
  const k = since / BOLT_LIFE;
  // Re-struck: bright, dim, bright again, each one weaker.
  const beat = Math.floor(k * BOLT_FLICKERS);
  const inBeat = k * BOLT_FLICKERS - beat;
  return (1 - inBeat * 0.75) * (1 - beat * 0.22) * (1 - k * 0.3);
}

/** A strike's light without its re-strikes (reduced motion: one flash
 *  fading over its life, never a flicker). */
export function strikeLightSteady(s: BreathStrike, t: number): number {
  const since = t - s.at;
  if (since < 0 || since > BOLT_LIFE) return 0;
  return 1 - since / BOLT_LIFE;
}

/**
 * The scene at painter time `time` (DORMANT, AWAKE or seconds in), written
 * into `out` (allocation free once built).
 */
export function breathEntranceLook(
  time: number,
  out: BreathEntranceLook = newBreathEntranceLook(),
): BreathEntranceLook {
  if (time === AWAKE || time >= E.end) return awake(out);
  const dormant = time === DORMANT;
  const t = dormant ? 0 : Math.max(0, time);
  out.active = true;
  out.dormant = dormant;
  out.t = t;
  const tail =
    t > BREATH_INTRO.seconds
      ? clamp01((t - BREATH_INTRO.seconds) / (E.end - BREATH_INTRO.seconds))
      : 0;
  const sinceTouch = dormant ? -99 : t - E.touchAt;
  const sinceBurst = dormant ? -99 : t - E.burstAt;
  const sinceFinal = dormant ? -99 : t - E.finalAt;
  out.sinceTouch = sinceTouch;
  out.sinceBurst = sinceBurst;
  out.sinceFinal = sinceFinal;
  const burst = sinceBurst >= 0;
  out.stance = burst || (!dormant && t >= E.formAt) ? 'form' : 'gathered';
  // Its air: nothing until it forms, whole by the burst.
  out.body = dormant ? 0 : smooth(E.formAt + 0.3, E.burstAt, t);
  out.calm = dormant ? 1 : 1 - smooth(E.pullAt, E.pullAt + 0.6, t);
  // The eye: a smudge in the calm, swelling with the pull, held over the
  // storm, thinning away after the great bolt.
  const swell = dormant ? 0 : smooth(E.pullAt - 0.4, E.eyeFull, t);
  out.eye = (0.22 + 0.78 * swell) * (1 - 0.55 * smooth(E.finalAt + 0.4, E.end, t)) * (1 - tail);
  out.eyeR = S.eyeSmudgeR + (S.eyeR - S.eyeSmudgeR) * swell;
  out.eyeTurn = 0.05 * t + 1.6 * swell * swell + (dormant ? 0 : 0.35 * Math.max(0, t - E.pullAt));
  // The funnel.
  out.reach = dormant ? 0 : smooth(E.descendFrom, E.touchAt, t);
  out.burst = burst ? clamp01(sinceBurst / E.burstFor) : 0;
  out.funnel = dormant ? 0 : rise(E.descendFrom, E.descendFrom + 0.4, t) * (1 - out.burst);
  out.orbit = dormant || burst ? 0 : smooth(E.touchAt - 0.4, E.touchAt + 0.7, t);
  // Lightning in the cloud: every strike, and a ragged flicker while the
  // funnel stands.
  let light = 0;
  let steady = 0;
  for (const s of BREATH_STRIKES) {
    light = Math.max(light, strikeLight(s, t));
    steady = Math.max(steady, strikeLightSteady(s, t));
  }
  out.steady = dormant ? 0 : steady;
  const bin = Math.floor(t * 11);
  const crackle = out.funnel > 0.05 && hash(bin, 71) > 0.8 ? 0.3 + 0.4 * hash(bin, 73) : 0;
  const stir = !dormant && t > E.pullAt + 1 && t < E.descendFrom && hash(bin, 79) > 0.86 ? 0.4 : 0;
  out.flicker = dormant ? 0 : Math.max(light, crackle * out.funnel, stir);
  // Where up the column it lights: a strike's light is low, the crackle
  // wanders.
  out.flickerY = light >= crackle * out.funnel ? 0.3 : 0.15 + 0.7 * hash(bin, 83);
  // The howl: rising with the pull, at its height through the funnel, cut
  // off by the burst.
  out.howl = dormant
    ? 0
    : rise(E.pullAt, E.descendFrom + 0.6, t) * (1 - smooth(E.burstAt, E.burstAt + 0.5, t));
  // The ring of gust.
  if (sinceBurst >= 0 && sinceBurst < E.ringFor) {
    const k = clamp01(sinceBurst / E.ringFor);
    out.ringR = E.ringFrom + (E.ringTo - E.ringFrom) * (1 - (1 - k) * (1 - k) * (1 - k));
    out.ring = (1 - k) ** 0.7;
  } else {
    out.ringR = 0;
    out.ring = 0;
  }
  out.flash = Math.max(spike(sinceBurst, E.flashFor), 0.85 * spike(sinceFinal, E.flashFor));
  return out;
}

/** The flash's opacity: none under reduced motion. */
export function breathEntranceFlash(look: BreathEntranceLook, reducedMotion: boolean): number {
  return reducedMotion ? 0 : look.flash;
}

/** The added light's ceiling: reduced motion caps every bolt and flare
 *  (they still show, never blaze). */
export const REDUCED_LIGHT_CAP = 0.6;

/** The lightning's light in the cloud under the viewer's motion setting:
 *  reduced motion takes the steady envelope (no 11 Hz crackle, no
 *  re-strikes: nothing flashes faster than a strike) under the cap. */
export function breathEntranceFlicker(look: BreathEntranceLook, reducedMotion: boolean): number {
  return reducedMotion ? Math.min(look.steady, REDUCED_LIGHT_CAP) : look.flicker;
}

/** An added light's level `v` under the viewer's motion setting. */
export function breathEntranceLight(v: number, reducedMotion: boolean): number {
  return reducedMotion ? Math.min(v, REDUCED_LIGHT_CAP) : v;
}

/** A thud of `amount` (at the guardian) for a player `distance` yards away:
 *  none under reduced motion or past the reach, else falling off. */
export function breathEntranceShake(
  amount: number,
  distance: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || distance >= E.shakeReach) return 0;
  return amount * (1 - (distance / E.shakeReach) * 0.6);
}

/** The low tier's share of the particles and the flying stone. */
export const BREATH_ENTRANCE_LOW_SHARE = 0.4;

/** Every k-th of a plan for the low tier (indices), so it stays whole. */
export function breathEntrancePicks(total: number, detail: boolean): number[] {
  const count = detail ? total : Math.max(1, Math.round(total * BREATH_ENTRANCE_LOW_SHARE));
  const step = total / count;
  const picks: number[] = [];
  for (let i = 0; i < count; i++) picks.push(Math.min(total - 1, Math.floor(i * step)));
  return picks;
}

// ---- the stone -------------------------------------------------------------------------------

/** A piece of stone at a moment (stage-local, yards off the guardian's foot:
 *  x, up, z), its turn (radians) and size (yards; 0 gone). */
export interface FlyingPiece {
  x: number;
  y: number;
  z: number;
  turn: number;
  size: number;
}

export function newFlyingPiece(): FlyingPiece {
  return { x: 0, y: 0, z: 0, turn: 0, size: 0 };
}

/** One piece of the loose stone hanging over the Cornice in the calm: its
 *  place (stage-local), its size, its seed, and when it starts drifting. */
export interface HangingPiece {
  x: number;
  y: number;
  z: number;
  size: number;
  seed: number;
  delay: number;
  travel: number;
}

/** The Cornice's middle off the guardian (stage-local). */
const MID = {
  x: BREATH.cornice.x - SMITH_HEART_BOSS_SPOTS.breath.x,
  z: BREATH.cornice.z - SMITH_HEART_BOSS_SPOTS.breath.z,
};

export const HANGING_STONE: readonly HangingPiece[] = (() => {
  const out: HangingPiece[] = [];
  const C = BREATH.cornice;
  for (let i = 0; out.length < 170 && i < 4000; i++) {
    const a = hash(i, 11) * Math.PI * 2;
    const r = Math.sqrt(hash(i, 13));
    const x = MID.x + Math.sin(a) * r * (C.rx - 6);
    const z = MID.z + Math.cos(a) * r * (C.rz - 5);
    const d = Math.hypot(x, z);
    if (d < 7) continue;
    // The big slabs hang nearer the middle: never a boulder in the raid's
    // face as it climbs in.
    const big = hash(i, 17) > 0.86 && d < 32;
    const size = big ? 0.9 + 1.1 * hash(i, 19) : 0.18 + 0.5 * hash(i, 19) ** 2;
    out.push({
      x,
      y: 0.6 + (big ? 1.4 : 0.4) + 4.2 * hash(i, 23),
      z,
      size,
      seed: hash(i, 29),
      // The nearer go first, the far rim last: the pull reaches outward.
      delay: E.pullSpread * (0.25 * hash(i, 31) + 0.75 * clamp01(d / 46)),
      travel: E.pullTravel * (0.8 + 0.4 * hash(i, 37)),
    });
  }
  return out;
})();

/** Piece `p` at scene look `look` (`clock` the painter's own, for the hang's
 *  slow bob): hanging, then drawn up to the eye in a tightening spiral and
 *  swallowed by it (`size` 0). */
export function hangingAt(
  p: HangingPiece,
  look: Pick<BreathEntranceLook, 't' | 'dormant'>,
  clock: number,
  out: FlyingPiece,
): FlyingPiece {
  const bob = 0.22 * Math.sin(clock * 0.55 + p.seed * 40);
  const since = look.dormant ? -1 : look.t - E.pullAt - p.delay;
  if (since <= 0) {
    out.x = p.x;
    out.y = p.y + bob;
    out.z = p.z;
    out.turn = p.seed * 6 + clock * 0.06;
    out.size = p.size;
    return out;
  }
  const k = clamp01(since / p.travel);
  // Drifting, then racing.
  const ease = k * k * (0.3 + 0.7 * k);
  const a0 = Math.atan2(p.x, p.z);
  const r0 = Math.hypot(p.x, p.z);
  const a = a0 + 2.6 * ease * ease;
  const r = r0 * (1 - ease) + S.eyeSmudgeR * 0.4 * ease * (1 - k);
  out.x = Math.sin(a) * r;
  out.z = Math.cos(a) * r;
  out.y = p.y + bob * (1 - k) + (S.eyeH - p.y) * ease;
  out.turn = p.seed * 6 + since * (3 + 6 * p.seed) * (0.3 + k);
  out.size = p.size * (1 - smooth(0.82, 1, k));
  return out;
}

/** The stone orbiting the funnel: its height share up it, its start angle,
 *  its distance out past the cloud, size, and its fling at the burst. */
export interface OrbitPiece {
  h: number;
  a: number;
  out: number;
  size: number;
  rate: number;
  vOut: number;
  vUp: number;
  seed: number;
}

export const ORBIT_STONE: readonly OrbitPiece[] = (() => {
  const out: OrbitPiece[] = [];
  for (let i = 0; i < 72; i++) {
    const h = 0.03 + 0.72 * hash(i, 101) ** 1.4;
    out.push({
      h,
      a: hash(i, 103) * Math.PI * 2,
      out: 1.5 + 4.5 * hash(i, 107),
      size: 0.3 + 1.2 * hash(i, 109) ** 2,
      rate: 0.8 + 0.6 * hash(i, 113),
      vOut: 12 + 9 * hash(i, 127),
      vUp: 4 + 9 * hash(i, 131),
      seed: hash(i, 137),
    });
  }
  return out;
})();

/** Gravity on the flung stone (yards a second squared), and how long a flung
 *  piece lasts before it is gone. */
export const STONE_GRAVITY = 22;
export const STONE_FLUNG_FOR = 2.2;

/** Orbiting piece `p` at scene look `look`: round the funnel while it
 *  stands (spinning faster low and tight), flung outward at the burst. */
export function orbitAt(
  p: OrbitPiece,
  look: Pick<BreathEntranceLook, 't' | 'orbit' | 'sinceBurst'>,
  out: FlyingPiece,
): FlyingPiece {
  const y = p.h * S.funnelH;
  const r = funnelRadius(p.h) + p.out;
  const omega = (p.rate * 13) / r;
  const a = p.a + look.t * omega;
  const flung = look.sinceBurst;
  if (flung >= 0) {
    const g = STONE_GRAVITY;
    const tt = flung;
    const rr = r + p.vOut * tt;
    // The orbit's own sweep carried on as the stone flies off.
    const aa = a + (omega * tt) / (1 + tt * 2);
    out.x = Math.sin(aa) * rr;
    out.z = Math.cos(aa) * rr;
    out.y = Math.max(0.2, y + p.vUp * tt - 0.5 * g * tt * tt);
    out.turn = p.seed * 9 + look.t * (4 + 6 * p.seed);
    out.size = p.size * (1 - clamp01((tt - STONE_FLUNG_FOR * 0.6) / (STONE_FLUNG_FOR * 0.4)));
    return out;
  }
  out.x = Math.sin(a) * r;
  out.z = Math.cos(a) * r;
  out.y = y + 0.8 * Math.sin(look.t * 2.1 + p.seed * 30);
  out.turn = p.seed * 9 + look.t * (4 + 6 * p.seed);
  out.size = p.size * look.orbit;
  return out;
}

// ---- the lightning ----------------------------------------------------------------------------

/** Points down one bolt's spine (and so its strip's segments). */
export const BOLT_POINTS = 22;

/** A point on a jagged bolt from `a` to `b` (stage-local), point `i` of
 *  BOLT_POINTS, its shape picked by `seed` (a re-strike is a new seed):
 *  the ends pinned, the middle kicked sideways up to `jag` of its length. */
export function boltPoint(
  seed: number,
  i: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  jag: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const k = i / (BOLT_POINTS - 1);
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  // Two octaves of hashed kicks, pinned at both ends.
  const pin = Math.sin(Math.PI * k);
  const s = seed | 0;
  const coarse = (j: number, c: number) => hash(s * 31 + j, c) - 0.5;
  const kk = k * 5;
  const j0 = Math.floor(kk);
  const f = kk - j0;
  const lerp = (c: number) => coarse(j0, c) * (1 - f) + coarse(j0 + 1, c) * f;
  const fine = (c: number) => hash(s * 97 + i, c) - 0.5;
  const ox = (lerp(1) * 0.8 + fine(3) * 0.35) * jag * len * pin;
  const oz = (lerp(5) * 0.8 + fine(7) * 0.35) * jag * len * pin;
  const oy = fine(9) * 0.15 * jag * len * pin;
  out.x = ax + (bx - ax) * k + ox;
  out.y = ay + (by - ay) * k + oy;
  out.z = az + (bz - az) * k + oz;
  return out;
}

/** A crawler: an arc of lightning crawling up the funnel's skin. Crawler
 *  `c` at scene time `t`: its re-strike (`seed`), its arc's foot and head
 *  (height shares and angles) and its light. */
export const CRAWLERS = 5;
export const CRAWL_EVERY = 0.16;

export function crawlerArc(
  c: number,
  t: number,
  out: { seed: number; h0: number; h1: number; a0: number; a1: number; light: number },
): typeof out {
  const strike = Math.floor((t + c * 0.037) / CRAWL_EVERY);
  out.seed = strike * 7 + c * 1013;
  const u = hash(strike, 211 + c);
  out.h0 = 0.05 + 0.7 * u;
  out.h1 = Math.min(0.96, out.h0 + 0.12 + 0.25 * hash(strike, 223 + c));
  out.a0 = hash(strike, 227 + c) * Math.PI * 2;
  out.a1 = out.a0 + (hash(strike, 229 + c) - 0.5) * 2.2;
  const inStrike = ((t + c * 0.037) / CRAWL_EVERY) % 1;
  out.light = hash(strike, 233 + c) > 0.35 ? 1 - inStrike * 0.7 : 0;
  return out;
}

// ---- the sounds ------------------------------------------------------------------------------

/** The scene's sounds on their beats (the Breath fight's own samples, no
 *  voice): the hush, the indrawn breath of the pull, the gathering storm,
 *  the funnel's descent and its touch, every strike's thunder, the burst's
 *  blast, the great bolt's thunderclap. The howl is a loop under them
 *  (BREATH_ENTRANCE_HOWL), riding `look.howl`. */
export const BREATH_ENTRANCE_SOUNDS: readonly {
  at: number;
  key: string;
  gain: number;
  rate: number;
}[] = [
  { at: 0.05, key: 'heart_breath_calm', gain: 0.55, rate: 0.6 },
  { at: E.pullAt, key: 'heart_breath_inhale', gain: 1, rate: 0.82 },
  { at: E.pullAt + 1.3, key: 'heart_breath_gather', gain: 0.9, rate: 0.75 },
  { at: E.descendFrom, key: 'heart_breath_exhale', gain: 1, rate: 0.6 },
  { at: E.touchAt, key: 'heart_breath_roar_hit', gain: 1, rate: 0.62 },
  { at: E.touchAt + 0.02, key: 'heart_breath_storm_break', gain: 0.8, rate: 1.15 },
  ...BREATH_STRIKES.filter((s) => s.kind === 'ground').map((s, k) => ({
    at: s.at,
    key: 'heart_breath_strike',
    gain: s.big ? 1 : 0.8,
    rate: 0.82 + 0.07 * (k % 4),
  })),
  { at: E.burstAt - 0.12, key: 'heart_breath_tear', gain: 0.9, rate: 0.9 },
  { at: E.burstAt, key: 'heart_breath_summit_roar', gain: 1, rate: 0.8 },
  { at: E.burstAt + 0.03, key: 'heart_breath_bulwark_break', gain: 0.9, rate: 0.85 },
  { at: E.finalAt - 0.15, key: 'heart_breath_discharge', gain: 0.85, rate: 1.1 },
  { at: E.finalAt, key: 'heart_breath_strike', gain: 1, rate: 0.66 },
  { at: E.finalAt + 0.05, key: 'heart_breath_storm_break', gain: 1, rate: 0.72 },
];

/** The howl under the pull and the funnel: its looping sample and its gain
 *  at full. */
export const BREATH_ENTRANCE_HOWL = { key: 'heart_breath_gale_loop', gain: 0.9 } as const;

/** A sound `d` yards off is heard from no farther than this (the storm fills
 *  the whole Cornice; the mixer's own reach is 46 yd). */
export const BREATH_ENTRANCE_HEARD_AT = 16;

export const BREATH_ENTRANCE_POOLS = {
  /** Dust motes hanging in the calm, a second (before the tier). */
  calmMotes: 26,
  /** Grit streaming up to the eye with the pull, a second. */
  pullGrit: 70,
  /** The funnel's foot: the dust skirt torn off it, a second. */
  skirt: 60,
  /** The touch's dust, a strike's sparks and dust, the burst's dust front. */
  touchDust: 70,
  strikeSparks: 26,
  strikeDust: 16,
  ringDust: 120,
} as const;
