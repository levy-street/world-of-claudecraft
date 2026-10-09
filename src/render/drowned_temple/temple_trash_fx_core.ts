// Pure plan for the Drowned Temple's trash mechanics pass effects
// (temple_trash_fx.ts): the Shrine Vigil's pearl bubble and its prayer
// threads, the heroic Moonset Oath's tether and shell glyph, the heroic
// Lullaby Echo's ring and waves, the Glimmerscale Lurker's Prism Glare (the
// gaze eye, its reach, the flash, the dazzle and the local veil), the Lagoon
// Snapper's Spiral Whirlpool, the Lagoon Eel's Arcing Spark and the Tidewisp's
// chill and heroic Swollen Tide.
//
// Every radius, duration and beat here is read off the sim's own templates
// (MOBS[...].trashKit.temple and .detonate), so the edge a player reads is the
// edge the sim tests; what is decided here is only how bright and how big the
// light draws at a moment. Everything is a function of what IWorld mirrors
// (positions, auras with their value and source, the cast bar, spellfx), so
// offline and online look the same.
//
// Three-free, DOM-free, deterministic.

import { MOBS } from '../../sim/data';
import {
  TEMPLE_ARCING_SPARK,
  TEMPLE_LULLABY_ECHO,
  TEMPLE_PRISM_GLARE,
  TEMPLE_SPIRAL_WHIRLPOOL,
  TEMPLE_SWOLLEN_TIDE,
  TEMPLE_TIDEWISP_BURST,
} from '../../sim/mob/trash_kit/temple_cast_ids';
import type { TempleKitDef } from '../../sim/mob/trash_kit/temple_kit_types';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** The template ids the pass dresses (the sim's own, frozen). */
export const TEMPLE_TRASH_IDS = {
  pilgrim: 'drowned_pilgrim',
  acolyte: 'pale_choir_acolyte',
  siren: 'moonlit_siren',
  guard: 'drowned_templeguard',
  lurker: 'glimmerscale_lurker',
  snapper: 'lagoon_snapper',
  eel: 'ice_wraith',
  wisp: 'tidewisp',
} as const;

function templeKit(templateId: string): TempleKitDef | undefined {
  return MOBS[templateId]?.trashKit?.temple;
}

/** Every number the pass draws from, read off the templates once. A missing
 *  key reads 0 (the effect then never draws), never an invented size. */
export interface TempleTrashNumbers {
  vigil: { range: number; min: number; reduction: number; heroicReduction: number };
  oath: { range: number; share: number };
  echo: { radius: number; delay: number; every: number };
  gaze: {
    range: number;
    halfArcDeg: number;
    castTime: number;
    seconds: number;
    heroicSeconds: number;
  };
  whirl: { radius: number; core: number; tick: number; pull: number; heroicPull: number };
  spark: { range: number; jump: number; hits: number; castTime: number };
  wisp: { radius: number; radiusPer: number; maxMerges: number; chillSeconds: number };
}

export function templeTrashNumbers(): TempleTrashNumbers {
  const vigil = templeKit(TEMPLE_TRASH_IDS.acolyte)?.vigil;
  const guard = templeKit(TEMPLE_TRASH_IDS.guard)?.guard;
  const echo = templeKit(TEMPLE_TRASH_IDS.acolyte)?.lullabyEcho;
  const gaze = templeKit(TEMPLE_TRASH_IDS.lurker)?.gaze;
  const whirl = templeKit(TEMPLE_TRASH_IDS.snapper)?.whirlpool;
  const spark = templeKit(TEMPLE_TRASH_IDS.eel)?.spark;
  const burst = MOBS[TEMPLE_TRASH_IDS.wisp]?.trashKit?.detonate;
  const merge = templeKit(TEMPLE_TRASH_IDS.wisp)?.merge;
  return {
    vigil: {
      range: vigil?.range ?? 0,
      min: vigil?.min ?? 0,
      reduction: vigil?.reduction ?? 0,
      heroicReduction: vigil?.heroicReduction ?? 0,
    },
    oath: { range: guard?.range ?? 0, share: guard?.share ?? 0 },
    echo: { radius: echo?.radius ?? 0, delay: echo?.delay ?? 0, every: echo?.every ?? 0 },
    gaze: {
      range: gaze?.range ?? 0,
      halfArcDeg: gaze?.halfArcDeg ?? 0,
      castTime: gaze?.castTime ?? 0,
      seconds: gaze?.seconds ?? 0,
      heroicSeconds: gaze?.heroicSeconds ?? 0,
    },
    whirl: {
      radius: whirl?.radius ?? 0,
      core: whirl?.core ?? 0,
      tick: whirl?.tick ?? 0,
      pull: whirl?.pull ?? 0,
      heroicPull: whirl?.heroicPull ?? 0,
    },
    spark: {
      range: spark?.range ?? 0,
      jump: spark?.jump ?? 0,
      hits: spark?.hits ?? 0,
      castTime: spark?.castTime ?? 0,
    },
    wisp: {
      radius: burst?.radius ?? 0,
      radiusPer: merge?.radiusPer ?? 0,
      maxMerges: merge?.max ?? 0,
      chillSeconds: burst?.slow?.seconds ?? 0,
    },
  };
}

/** The pass's own element accents: the vigil's moon pearl, the oath's nacre,
 *  the lullaby's pink-silver, the gaze's prism, the spark's storm, the
 *  whirlpool's deep water and the tide's moon-water. */
export const TEMPLE_TRASH_ACCENTS = {
  pearl: 0xf3ecff,
  nacre: 0xcfe9ff,
  lullaby: 0xffb8e6,
  prism: 0xb9a6ff,
  storm: 0x9fdcff,
  whirl: 0x4fc6d8,
  tide: 0x6fe3e0,
} as const;

/** A floor ring an AURA stands for, round the body that wears it: its radius
 *  (the sim's own), the threat colour (the floor kit's palette) and accent. */
export interface TempleZoneSpec {
  radius: number;
  color: number;
  accent: number;
}

/** The aura-borne rings: the Lullaby Echo's reach round its sleeper (a sleep:
 *  control; spread out of it), the Spiral Whirlpool's biting core round the
 *  snapper (danger; the pull out to its rim is the vortex itself). The
 *  Swollen Tide's wider burst is wispBurstRadius (it grows with the swell). */
export function templeZoneSpecs(): Readonly<Record<string, TempleZoneSpec>> {
  const n = templeTrashNumbers();
  return {
    [TEMPLE_LULLABY_ECHO]: {
      radius: n.echo.radius,
      color: TELEGRAPH_THREAT_COLORS.control,
      accent: TEMPLE_TRASH_ACCENTS.lullaby,
    },
    [TEMPLE_SPIRAL_WHIRLPOOL]: {
      radius: n.whirl.core,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: TEMPLE_TRASH_ACCENTS.whirl,
    },
  };
}

/** How a creature of the pass is drawn (its manifest height times its
 *  template scale, in yards), so the light sits on the body: the bubble wraps
 *  the singer, the thread leaves the pilgrim's shrine, the eye floats over the
 *  lurker's stalks, the spark leaves the eel's jaws. Pinned to the manifest by
 *  tests/drowned_temple_trash_fx_core.test.ts. */
export const TEMPLE_TRASH_BODY: Readonly<Record<string, { height: number; hover: number }>> = {
  [TEMPLE_TRASH_IDS.pilgrim]: { height: 4.9 * 0.95, hover: 0 },
  [TEMPLE_TRASH_IDS.acolyte]: { height: 5.2 * 1.0, hover: 0 },
  [TEMPLE_TRASH_IDS.siren]: { height: 6.0 * 1.0, hover: 0 },
  [TEMPLE_TRASH_IDS.guard]: { height: 5.0 * 1.1, hover: 0 },
  [TEMPLE_TRASH_IDS.lurker]: { height: 3.65 * 1.2, hover: 0 },
  [TEMPLE_TRASH_IDS.snapper]: { height: 3.83 * 1.2, hover: 0 },
  [TEMPLE_TRASH_IDS.eel]: { height: 4.0 * 1.2, hover: 0.3 },
  [TEMPLE_TRASH_IDS.wisp]: { height: 2.75 * 0.8, hover: 0.45 },
};

/** A body's drawn height (yards); 2 for anything unlisted (a player). */
export function templeBodyHeight(templateId: string | undefined): number {
  return (templateId && TEMPLE_TRASH_BODY[templateId]?.height) || 2;
}

// ---- Shrine Vigil -------------------------------------------------------------

/** The pearl bubble's size round a singer: wide enough to hold her whole
 *  drawn body (a sphere centred at half her height, a touch taller). */
export function vigilBubble(
  templateId: string | undefined,
  out: { radius: number; up: number } = { radius: 0, up: 0 },
): { radius: number; up: number } {
  const h = templeBodyHeight(templateId);
  out.radius = h * 0.62;
  out.up = h * 0.5;
  return out;
}

/** The bubble's light for the ward's strength (the aura value is the share it
 *  turns: 0.75, 0.85 on heroic) and how many pilgrims feed it: brighter and
 *  denser the more it turns and the more kneel. `age` swells it in. */
export function vigilBubbleLook(
  reduction: number,
  prayers: number,
  age: number,
  out: { strength: number; grow: number } = { strength: 0, grow: 0 },
): { strength: number; grow: number } {
  const ward = clamp01(reduction);
  out.strength = clamp01(0.45 + 0.5 * ward + 0.06 * Math.max(0, prayers - 2));
  const k = clamp01(age / VIGIL_SWELL_SECONDS);
  out.grow = 1 - (1 - k) ** 3;
  return out;
}

/** How long the bubble takes to swell in, and to shatter. */
export const VIGIL_SWELL_SECONDS = 0.35;
export const VIGIL_SHATTER_SECONDS = 0.7;

/** The shatter `age` seconds after the ward falls: the shell bursts outward
 *  (scale over its own size) as its cracks open and its light goes. */
export function vigilShatter(
  age: number,
  out: { scale: number; crack: number; alpha: number } = { scale: 0, crack: 0, alpha: 0 },
): { scale: number; crack: number; alpha: number } {
  const k = clamp01(age / VIGIL_SHATTER_SECONDS);
  out.scale = 1 + 0.35 * (1 - (1 - k) ** 2);
  out.crack = clamp01(k * 3);
  out.alpha = (1 - k) ** 1.6;
  return out;
}

/** Where a pilgrim's prayer leaves it: the little shrine on its shell, a
 *  little over half its drawn height. */
export function pilgrimShrineUp(): number {
  return templeBodyHeight(TEMPLE_TRASH_IDS.pilgrim) * 0.62;
}

// ---- Moonset Oath ----------------------------------------------------------------

/** The oath's tether strain: 0 with the guard at the singer's side, 1 at the
 *  sim's reach (one step more and the oath breaks), so a group dragging the
 *  guard away watches the nacre chain draw taut and redden. */
export function oathTension(distance: number, range: number): number {
  if (range <= 0) return 0;
  return clamp01(distance / range);
}

// ---- Lullaby Echo ---------------------------------------------------------------

/** The echo ring's fill toward its next beat: from the sleep landing to the
 *  first beat over `delay`, then over `every` from each beat (the beat's
 *  spellfx resets `sinceBeat`; negative means none yet). 1 on the beat. */
export function echoRingFill(
  sinceSeen: number,
  sinceBeat: number,
  delay: number,
  every: number,
): number {
  if (sinceBeat < 0) return delay > 0 ? clamp01(sinceSeen / delay) : 1;
  return every > 0 ? clamp01(sinceBeat / every) : 1;
}

/** An expanding floor wave's life (the echo beat, a wisp's burst, the
 *  whirlpool's first turn, the gaze's flash ring). */
export const TRASH_WAVE_SECONDS = 0.75;

/** A wave `age` seconds in: how far it has run (share of its radius) and its
 *  light. */
export function trashWave(
  age: number,
  life = TRASH_WAVE_SECONDS,
  out: { reach: number; alpha: number } = { reach: 0, alpha: 0 },
): { reach: number; alpha: number } {
  const k = clamp01(age / life);
  out.reach = 0.15 + 0.85 * (1 - (1 - k) ** 3);
  out.alpha = (1 - k) ** 1.3;
  return out;
}

// ---- Prism Glare ----------------------------------------------------------------------

/** Where the gaze eye floats over the lurker (yards over the floor): above
 *  its reared front and its stalked eyes. */
export function gazeEyeUp(): number {
  return templeBodyHeight(TEMPLE_TRASH_IDS.lurker) + 1.6;
}

/** The eye's drawn size (yards across). */
export const GAZE_EYE_SIZE = 3.4;

/** The gaze eye as the bar fills (`fill` 0 to 1, the sim's own bar): the lids
 *  part, the rainbow iris widens, the stalks blaze, and over the last third
 *  it throbs faster (held to a slow glow for reduced motion; the opening, the
 *  part a player reads, is the same). */
export function gazeEyeLook(
  fill: number,
  clock: number,
  calm: boolean,
  out: { open: number; iris: number; blaze: number; pulse: number } = {
    open: 0,
    iris: 0,
    blaze: 0,
    pulse: 0,
  },
): { open: number; iris: number; blaze: number; pulse: number } {
  const f = clamp01(fill);
  out.open = 0.12 + 0.88 * (1 - (1 - f) ** 2);
  out.iris = 0.35 + 0.65 * f;
  out.blaze = 0.3 + 0.7 * f * f;
  const late = clamp01((f - 0.66) / 0.34);
  const hz = calm ? 0.8 : 2 + 6 * late;
  out.pulse = late * (0.5 + 0.5 * Math.sin(clock * hz * Math.PI * 2));
  return out;
}

/** The flash at landing: how long the eye and its prismatic ring burn. */
export const GAZE_FLASH_SECONDS = 0.6;

/** The dazzle's local veil: an edge-only prism tint (the middle of the screen
 *  is never touched, nor is the HUD: the dazzle's actionable read is its aura
 *  icon), a flash on the moment it lands and fading with the aura's own clock.
 *  Reduced motion: no flash and no shimmer, a steady faint edge. */
export const DAZZLE_VEIL_MAX = 0.32;
export const DAZZLE_FLASH_SECONDS = 0.3;

export function dazzleVeil(
  remaining: number,
  duration: number,
  sinceStart: number,
  calm: boolean,
  out: { edge: number; flash: number } = { edge: 0, flash: 0 },
): { edge: number; flash: number } {
  if (remaining <= 0 || duration <= 0) {
    out.edge = 0;
    out.flash = 0;
    return out;
  }
  const left = clamp01(remaining / duration);
  // Full for most of the dazzle, easing out over its last third.
  const ease = clamp01(left / 0.33);
  out.edge = (calm ? 0.55 : 1) * DAZZLE_VEIL_MAX * ease;
  out.flash = calm ? 0 : DAZZLE_VEIL_MAX * (1 - clamp01(sinceStart / DAZZLE_FLASH_SECONDS));
  return out;
}

// ---- Spiral Whirlpool ------------------------------------------------------------------

/** How the vortex turns: its spiral arms flow inward at the pull's own pace
 *  (radians a second at the rim, so the water visibly moves at the speed it
 *  drags you), and it swells in over its first half second. */
export function whirlpoolLook(
  age: number,
  pull: number,
  radius: number,
  out: { spin: number; grow: number } = { spin: 0, grow: 0 },
): { spin: number; grow: number } {
  out.spin = radius > 0 ? (pull / radius) * 3 : 0;
  out.grow = 1 - (1 - clamp01(age / 0.5)) ** 3;
  return out;
}

/** The biting core's fill toward its next bite: it bites every `tick` from
 *  the moment the water starts to turn (temple_tide.ts stepWhirlpool). */
export function whirlCoreFill(age: number, tick: number): number {
  if (tick <= 0) return 1;
  const into = Math.max(0, age) % tick;
  return clamp01(into / tick);
}

// ---- Arcing Spark ------------------------------------------------------------------------

/** One leap's arc: it strikes in chain order, each hop a beat after the last
 *  (the sim lands them on one tick; the eye needs the order), crackles, and
 *  goes. */
export const SPARK_HOP_STAGGER = 0.07;
export const SPARK_ARC_SECONDS = 0.5;

/** The arc of hop `index` `age` seconds after its chain landed: its light and
 *  how much of the way it has run (it races from source to struck). */
export function sparkArcLook(
  age: number,
  index: number,
  out: { alpha: number; reach: number } = { alpha: 0, reach: 0 },
): { alpha: number; reach: number } {
  const t = age - index * SPARK_HOP_STAGGER;
  if (t < 0) {
    out.alpha = 0;
    out.reach = 0;
    return out;
  }
  const k = clamp01(t / SPARK_ARC_SECONDS);
  out.reach = clamp01(t / 0.06);
  // Bright on the strike, a flicker, then out.
  out.alpha = k >= 1 ? 0 : (1 - k) ** 1.5 * (k < 0.2 ? 1 : 0.75 + 0.25 * Math.cos(t * 60));
  return out;
}

/** The chain index of a spark hop: hops of one chain arrive together, so a
 *  hop within `window` seconds of the last one is the next link. */
export function sparkHopIndex(
  lastAt: number,
  lastIndex: number,
  now: number,
  window = 0.03,
): number {
  return lastAt >= 0 && now - lastAt <= window ? lastIndex + 1 : 0;
}

/** Where the Ice Wraith's spark leaves it: its face, measured
 *  off the live rig's head bone over its hover. */
export function eelJawUp(): number {
  return templeBodyHeight(TEMPLE_TRASH_IDS.eel) * 0.78;
}

// ---- Tidewisp ---------------------------------------------------------------------------

/** A swollen wisp's drawn growth: about 1 + 0.4 per merge (aura value). */
export function wispSwellScale(merges: number): number {
  return 1 + 0.4 * Math.max(0, merges);
}

/** A wisp's burst radius (yards): the template's, wider by `radiusPer` per
 *  merge (temple_kit.ts stepDetonate reads the same). */
export function wispBurstRadius(merges: number, n = templeTrashNumbers()): number {
  return n.wisp.radius + n.wisp.radiusPer * Math.max(0, merges);
}

/** The swell's moon-water shell round the wisp (yards) and its core light. */
export function wispSwellLook(
  merges: number,
  out: { radius: number; core: number } = { radius: 0, core: 0 },
): { radius: number; core: number } {
  const body = templeBodyHeight(TEMPLE_TRASH_IDS.wisp);
  out.radius = body * 0.42 * wispSwellScale(merges);
  out.core = 0.5 + 0.25 * Math.max(0, merges);
  return out;
}

/** Where a wisp's body hangs (its hover plus half its drawn height). */
export function wispCoreUp(): number {
  const b = TEMPLE_TRASH_BODY[TEMPLE_TRASH_IDS.wisp];
  return b.hover + b.height * 0.5;
}

/** The chill's frost crust on a player: thick when it lands, melting with the
 *  aura's own clock. */
export function chillCrust(remaining: number, seconds: number): number {
  if (seconds <= 0 || remaining <= 0) return 0;
  const left = clamp01(remaining / seconds);
  return 0.35 + 0.65 * left;
}

// ---- Events --------------------------------------------------------------------------------

export type TempleTrashCue = 'gaze' | 'spark' | 'echo' | 'whirl' | 'merge' | 'burst' | null;

/** Which of the pass's effects a spellfx is (null: none of them). */
export function templeTrashCue(ev: {
  type: string;
  fx?: string;
  ability?: string;
}): TempleTrashCue {
  if (ev.type !== 'spellfx') return null;
  switch (ev.ability) {
    case TEMPLE_PRISM_GLARE:
      return ev.fx === 'nova' ? 'gaze' : null;
    case TEMPLE_ARCING_SPARK:
      return ev.fx === 'heavyBolt' ? 'spark' : null;
    case TEMPLE_LULLABY_ECHO:
      return ev.fx === 'nova' ? 'echo' : null;
    case TEMPLE_SPIRAL_WHIRLPOOL:
      return ev.fx === 'windup' ? 'whirl' : null;
    case TEMPLE_SWOLLEN_TIDE:
      return ev.fx === 'nova' ? 'merge' : null;
    case TEMPLE_TIDEWISP_BURST:
      return ev.fx === 'nova' ? 'burst' : null;
    default:
      return null;
  }
}

/** A rainbow hue for a body id (deterministic variety off the id alone). */
export function idHue(id: number): number {
  const h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return (h % 1000) / 1000;
}
