// The Guardian of the Breath's leaf (docs/design/raid/smith_heart.md section
// 7.2): every id the fight's sim, its renderer, its HUD, its dev helpers and
// its tests key on, the per-difficulty rules, the tuning, and the pure
// template-id helpers of its encounter objects. No SimContext, no rng.
//
// EVERY number here is a SKETCH, unmeasured (the design doc's 7.2 table says
// so too): anchored to the Hammer Council's (level 20 elite, ten players, a
// measured bot raid of about 400 to 460 damage a second) and the level-20
// cloth reference (about 1,135 to 1,345 health), to be calibrated with the
// meters harness before the raid ships.
//
// What every client reads (no wire or IWorld change; all of it rides
// existing entity fields):
//   - the wind's state: ONE object at the Cornice's middle whose template id
//     carries the phase, the bearing it blows toward and the phase's length
//     (`breathWindTemplate`); each player in it wears the kernel's wind aura
//     (src/sim/wind_drift.ts), so both hosts step the same push;
//   - Captain Thessaly (an NPC, `BREATH_THESSALY_NPC`) and her circle of calm
//     (an object: landing, holding, spent), the anchored and the spent
//     players (auras);
//   - the vortex, the loose gales, the strikes' spots, the charged ground and
//     the Thunder's Cradle (objects, their radius in `scale`), the lifted
//     player (carried in the air: carried_body.ts), the marked conductor
//     (an aura), the pinned (an aura);
//   - the guardian's bars (cast ids below) and its storm body and the
//     storm's swell (auras on it), the moments as `spellfx` cues.

/** The guardian (template id, frozen: its death lights the Breath vein). */
export const BREATH_GUARDIAN = 'heart_breath_guardian';
/** Captain Thessaly at the head of the Cornice climb (an NPC def with no
 *  quests: the Highwatch captain's name, look and voice). */
export const BREATH_THESSALY_NPC = 'heart_captain_thessaly';

// ---- casts, auras, objects, cues --------------------------------------------------

/** The guardian's bars (and the damage names they carry). Storm Lance stays
 *  the trash kit's own cast (content/smith_heart.ts), never started here. */
export const BREATH_CASTS = {
  /** The indrawn breath: the wind turns and pulls everyone in (planted). */
  inhale: 'heart_breath_inhale',
  /** The exhale: the old Bellows Gust (its id kept), now the blast that
   *  throws everyone outward after the indrawn breath. */
  gust: 'heart_bellows_gust',
  /** Storm Lance (the trash kit's line, read by the renderer). */
  lance: 'heart_storm_lance',
  /** At half health: the guardian draws the wind in and tears open. */
  storm: 'heart_breath_storm_break',
  /** Phase 2: a bolt that forks from player to player. */
  fork: 'heart_breath_forking_bolt',
  /** Phase 2: a player lifted into the storm (the raid gathers under them). */
  cradle: 'heart_breath_thunders_cradle',
  /** Phase 2: a player marked to draw the lightning to their feet. */
  drawn: 'heart_breath_drawn_lightning',
} as const;

/** The auras the fight puts on players and on the guardian. The kernel's
 *  wind and pull auras are wind_drift.ts's (WIND_DRIFT_AURA, WIND_PULL_AURA). */
export const BREATH_AURAS = {
  /** Thessaly's anchor: no wind, pull, blast or throw moves this player. */
  anchor: 'heart_breath_anchor',
  /** Heroic: an anchor ran out; no circle takes this player again yet. */
  spent: 'heart_breath_calm_spent',
  /** Pressed against the rim's wall by the wind (it hurts each second). */
  pinned: 'heart_breath_pinned',
  /** The marked conductor: a strike falls at their feet every 2 s. */
  drawn: 'heart_breath_drawn_lightning',
  /** Lifted into the storm (an unbreakable stun while it holds them). */
  cradled: 'heart_breath_cradled',
  /** On the guardian through phase 2: its body of lightning. */
  stormForm: 'heart_breath_storm_unbound',
  /** On the guardian: one stack per pulse of the swelling storm. */
  swell: 'heart_breath_swelling_storm',
} as const;

/** The fight's object templates (their radius rides `scale`). */
export const BREATH_OBJECTS = {
  /** The wind's state, at the Cornice's middle (breathWindTemplate). */
  windPrefix: 'sh_breath_wind_',
  /** Thessaly's circle: `<prefix><state>_<tenths>` (calmTemplate). */
  calmPrefix: 'sh_breath_calm_',
  /** The vortex before the guardian's mouth while it draws breath. */
  vortex: 'sh_breath_vortex',
  /** Heroic: a loose gale wandering the Cornice. */
  gale: 'sh_breath_loose_gale',
  /** A lightning strike's spot, `<prefix><tenths>` of warning. */
  strikePrefix: 'sh_breath_strike_',
  /** Charged ground left by a conductor's strike, `<prefix><tenths>`. */
  chargedPrefix: 'sh_breath_charged_',
  /** The Thunder's Cradle's gather circle under the lifted player
   *  (`<prefix><tenths>` of hold); it also carries them. */
  cradlePrefix: 'sh_breath_cradle_',
} as const;

/** The spellfx ability ids of the fight's moments. */
export const BREATH_CUES = {
  /** The exhale lands (spellfx 'nova' on the guardian). */
  gust: 'heart_bellows_gust',
  /** A strike lands (spellfxAt 'burst', radius = the strike). */
  strike: 'heart_breath_strike',
  /** A leaping bolt jumps (spellfx 'beam', from the last struck to the next;
   *  the first leg from the guardian). */
  fork: 'heart_breath_fork',
  /** The cradle discharges (spellfxAt 'burst', radius = the gather circle). */
  discharge: 'heart_breath_cradle_discharge',
  /** The guardian tears open into its storm body (spellfx 'nova'). */
  tear: 'heart_breath_tear',
  /** The swelling storm pulses (spellfx 'nova' on the guardian). */
  swell: 'heart_breath_swell',
  /** A loose gale tosses a player (spellfx 'nova' from the gale on them). */
  toss: 'heart_breath_toss',
  /** Thessaly's circle lands (spellfxAt 'burst', radius = the circle). */
  calmLand: 'heart_breath_calm_land',
  /** A player is anchored (spellfx 'beam' from Thessaly to them). */
  anchor: 'heart_breath_anchor',
  /** A player goes over the lip of a gap (spellfxAt 'burst' where they
   *  left the floor). */
  fall: 'heart_breath_fall',
} as const;

/** The damage and aura names (combat log, floating text, the buff bar;
 *  re-localized by src/ui/sim_i18n.ts through the mechanic reverse map). */
export const BREATH_NAMES = {
  wind: 'Bellows Wind',
  pull: 'Indrawn Breath',
  pinned: 'Pressed to the Rim',
  vortex: 'Breath Vortex',
  gust: 'Bellows Gust',
  anchor: 'Anchored in Calm',
  spent: 'Calm Spent',
  gale: 'Loose Gale',
  storm: 'The Storm Breaks',
  strike: 'Breaking Storm',
  fork: 'Leaping Bolt',
  cradle: "Thunder's Cradle",
  backlash: 'Cradle Backlash',
  drawn: 'Drawn Lightning',
  charged: 'Charged Ground',
  stormForm: 'Storm Unbound',
  swell: 'Swelling Storm',
  calm: 'Circle of Calm',
} as const;

// ---- difficulty -----------------------------------------------------------------------

/** The fight's difficulty. Each tier is one BREATH_DIFFICULTY row; mythic is
 *  a dev-switched prototype (breath.ts setBreathDevTier) and, for now, the
 *  heroic row whole: a later mythic-only mechanic is one more field here and
 *  its own module, never a branch on a tier's name. */
export type BreathDifficulty = 'normal' | 'heroic' | 'mythic';

export interface BreathDifficultyRules {
  /** The blow's speed (yards a second; a run is 7). */
  windSpeed: number;
  /** Every mechanic's damage, on top of the claim's own multiplier. */
  damageMult: number;
  /** An anchor that ran out leaves its player spent (no circle for a while). */
  calmSpent: boolean;
  /** Loose gales wander the Cornice after each indrawn breath. */
  looseGales: boolean;
  /** Short gusts return in phase 2. */
  stormGusts: boolean;
  /** The Thunder's Cradle wants at least this many under it. */
  cradleSoakers: number;
}

export const BREATH_DIFFICULTY: Readonly<Record<BreathDifficulty, BreathDifficultyRules>> = {
  normal: {
    windSpeed: 3.2,
    damageMult: 1,
    calmSpent: false,
    looseGales: false,
    stormGusts: false,
    cradleSoakers: 4,
  },
  heroic: {
    windSpeed: 3.6,
    damageMult: 1.25,
    calmSpent: true,
    looseGales: true,
    stormGusts: true,
    cradleSoakers: 5,
  },
  // Exactly heroic for now (the circle rule included): the seam for one
  // later mythic-only mechanic.
  mythic: {
    windSpeed: 3.6,
    damageMult: 1.25,
    calmSpent: true,
    looseGales: true,
    stormGusts: true,
    cradleSoakers: 5,
  },
};

// ---- tuning (SKETCH, unmeasured) ------------------------------------------------------

export const BREATH_TUNING = {
  // The wind (phase 1).
  /** Seconds from the pull to the first blow's telegraph. */
  firstGather: 3,
  /** The telegraph before each blow: the coming wind drawn on the floor. */
  gatherSeconds: 2.5,
  blowSeconds: 10,
  /** The calm after a blow (its telegraph included): 5 s at full health,
   *  shortening to 3 s at half (calmSeconds). */
  calmMax: 5,
  calmMin: 3,
  /** Pressed against the rim's wall: a hit each second. */
  pinTick: 1,
  pinMin: 90,
  pinMax: 110,
  /** How far downwind of a body the wall must stand to pin it (yards). */
  pinReach: 1.3,
  // Captain Thessaly's circle of calm (phase 1 only).
  circleFirst: 9,
  circleEvery: 20,
  /** Its telegraph (where it will land), then how long it holds. */
  circleLand: 2,
  circleHold: 6,
  circleR: 3.5,
  /** At most this many take its anchor. */
  circleSeats: 3,
  /** How far upwind of the guardian it lands (yards). */
  circleReach: 12,
  anchorSeconds: 15,
  /** Heroic: no circle anchors the same player again for this long. */
  spentSeconds: 60,
  // The indrawn breath and the exhale (Bellows Gust).
  inhaleFirst: 38,
  inhaleEvery: 45,
  inhaleCast: 5,
  pullSpeed: 4,
  /** The vortex: this far before the mouth, this wide, this often. */
  vortexAhead: 7,
  vortexR: 4.5,
  vortexTick: 0.5,
  vortexMin: 90,
  vortexMax: 110,
  gustCast: 1.5,
  gustMin: 160,
  gustMax: 200,
  /** The exhale throws everyone this far outward (yards). */
  gustThrow: 18,
  // Heroic: the loose gales after each indrawn breath.
  galeCount: 3,
  galeSeconds: 20,
  galeR: 2.2,
  galeMin: 120,
  galeMax: 150,
  galeThrow: 11,
  /** One toss per player per gale in this many seconds. */
  galeEvery: 2,
  // At half health: the storm breaks.
  stormAt: 0.5,
  stormCast: 4,
  /** The barrage of strikes after it tears open. */
  barrageSeconds: 10,
  barrageEvery: 0.8,
  barrageSpots: 2,
  strikeWarn: 1.6,
  strikeR: 3.5,
  strikeMin: 320,
  strikeMax: 380,
  // Phase 2: the Leaping Bolt.
  forkFirst: 6,
  forkEvery: 22,
  forkCast: 2.5,
  /** It jumps to the nearest player within this (yards), again and again. */
  forkJump: 8,
  forkMaxHops: 9,
  forkMin: 240,
  forkMax: 280,
  // Phase 2: the Thunder's Cradle.
  cradleFirst: 16,
  cradleEvery: 40,
  cradleCast: 1.5,
  /** The lifted player hangs this long, this high, over a gather circle of
   *  this radius; then the discharge splits between everyone under it. */
  cradleHold: 6,
  cradleLift: 5,
  cradleR: 6,
  cradleTotal: 2600,
  /** Short of the difficulty's soakers: each share this much heavier, and
   *  the whole Cornice takes the backlash. */
  cradlePenaltyMult: 1.6,
  backlashMin: 180,
  backlashMax: 220,
  // Phase 2: Drawn Lightning (the marked conductor).
  drawnFirst: 26,
  drawnEvery: 30,
  drawnCast: 1,
  drawnSeconds: 10,
  /** A strike at the conductor's feet every this often, on this warning. */
  drawnStrikeEvery: 2,
  drawnWarn: 1.2,
  drawnR: 3,
  drawnMin: 280,
  drawnMax: 320,
  /** The charged ground each strike leaves. */
  chargedSeconds: 18,
  chargedR: 3,
  chargedTick: 1,
  chargedMin: 60,
  chargedMax: 75,
  // Phase 2: the swelling storm (the soft enrage).
  swellEvery: 5,
  swellMin: 35,
  swellMax: 42,
  /** Each pulse this much louder than the first, without end. */
  swellGrowth: 0.08,
  // Heroic phase 2: the short gusts.
  gustFirst: 12,
  gustEvery: 24,
  gustGather: 2,
  gustSeconds: 3.5,
  /** Seconds of plain melee after a bar lands before the next begins. */
  barGap: 1.2,
  /** How far below the Cornice a fallen body is dead for sure (yards). */
  voidDepth: 25,
} as const;

// ---- pure helpers ---------------------------------------------------------------------

/** The calm after a blow at `hpFrac` health (5 s at full, 3 s at half). */
export function calmSeconds(hpFrac: number): number {
  const T = BREATH_TUNING;
  const k = Math.max(0, Math.min(1, (hpFrac - T.stormAt) / (1 - T.stormAt)));
  return T.calmMin + (T.calmMax - T.calmMin) * k;
}

/** The bearings the blows aim at, in the order they turn (compass degrees,
 *  clockwise from north: where the wind blows TOWARD). Each pair a wide turn
 *  apart; four point at a gap's throat, two at a walled stretch. */
export const BLOW_BEARINGS: readonly number[] = [182, 22, 300, 128, 332, 75];

/** The `k`-th blow's bearing of a pull that began on `start`. Pure. */
export function blowBearing(start: number, k: number): number {
  const n = BLOW_BEARINGS.length;
  return BLOW_BEARINGS[(((start + k) % n) + n) % n];
}

/** The swelling storm's multiplier on its `pulse`-th pulse (0 the first). */
export function swellMult(pulse: number): number {
  return 1 + BREATH_TUNING.swellGrowth * Math.max(0, pulse);
}

/** How each soaker of the Thunder's Cradle fares: the share each takes and
 *  whether the backlash rolls over the Cornice. */
export function cradleShare(
  soakers: number,
  need: number,
  total: number = BREATH_TUNING.cradleTotal,
): { each: number; backlash: boolean } {
  const n = Math.max(1, soakers);
  const short = n < need;
  return {
    each: Math.round((total / n) * (short ? BREATH_TUNING.cradlePenaltyMult : 1)),
    backlash: short,
  };
}

/** The leaping bolt's path: from the first struck, each next the nearest
 *  player not yet struck within `jump` of the last (ties: the lower id), up
 *  to `maxHops` jumps. Pure over positions. */
export function forkPath<P extends { id: number; pos: { x: number; z: number } }>(
  first: P,
  players: readonly P[],
  jump: number = BREATH_TUNING.forkJump,
  maxHops: number = BREATH_TUNING.forkMaxHops,
): P[] {
  const out: P[] = [first];
  const hit = new Set<number>([first.id]);
  let at = first;
  for (let hop = 0; hop < maxHops; hop++) {
    let best: P | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const p of players) {
      if (hit.has(p.id)) continue;
      const d = Math.hypot(p.pos.x - at.pos.x, p.pos.z - at.pos.z);
      if (d > jump + 1e-9) continue;
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && p.id < best.id)) {
        best = p;
        bestD = d;
      }
    }
    if (!best) break;
    out.push(best);
    hit.add(best.id);
    at = best;
  }
  return out;
}

// ---- object templates (pure) ----------------------------------------------------------

/** The wind's phases as the object carries them. */
export type BreathWindPhase =
  | 'still'
  | 'gather'
  | 'blow'
  | 'calm'
  | 'inhale'
  | 'exhale'
  | 'break'
  | 'storm'
  | 'gustgather'
  | 'gust';

const WIND_PHASES: readonly BreathWindPhase[] = [
  'still',
  'gather',
  'blow',
  'calm',
  'inhale',
  'exhale',
  'break',
  'storm',
  'gustgather',
  'gust',
];

const tenthsOf = (seconds: number): number => Math.max(0, Math.round(seconds * 10));

/** The wind object's template: its phase, the bearing it blows toward
 *  (whole degrees, 0 to 359) and the phase's length (so every client fills
 *  its telegraph to the very tick it turns). */
export function breathWindTemplate(
  phase: BreathWindPhase,
  bearingDeg: number,
  seconds: number,
): string {
  const deg = ((Math.round(bearingDeg) % 360) + 360) % 360;
  return `${BREATH_OBJECTS.windPrefix}${phase}_${deg}_${tenthsOf(seconds)}`;
}

/** The wind object template's phase, bearing and length, or null. */
export function breathWindOf(
  templateId: string,
): { phase: BreathWindPhase; bearingDeg: number; seconds: number } | null {
  if (!templateId.startsWith(BREATH_OBJECTS.windPrefix)) return null;
  const [phase, deg, tenths] = templateId.slice(BREATH_OBJECTS.windPrefix.length).split('_');
  if (!WIND_PHASES.includes(phase as BreathWindPhase)) return null;
  const d = Number(deg);
  const t = Number(tenths);
  if (!Number.isInteger(d) || d < 0 || d > 359 || !Number.isInteger(t) || t < 0) return null;
  return { phase: phase as BreathWindPhase, bearingDeg: d, seconds: t / 10 };
}

/** Thessaly's circle's states: landing (its telegraph), holding (anchors
 *  free), spent (every seat taken, or its hold run out). */
export type BreathCalmState = 'land' | 'hold' | 'spent';

/** The circle's template: its state and that state's length. */
export function calmTemplate(state: BreathCalmState, seconds: number): string {
  return `${BREATH_OBJECTS.calmPrefix}${state}_${tenthsOf(seconds)}`;
}

/** The circle template's state and length, or null. */
export function calmOf(templateId: string): { state: BreathCalmState; seconds: number } | null {
  if (!templateId.startsWith(BREATH_OBJECTS.calmPrefix)) return null;
  const [state, tenths] = templateId.slice(BREATH_OBJECTS.calmPrefix.length).split('_');
  if (state !== 'land' && state !== 'hold' && state !== 'spent') return null;
  const t = Number(tenths);
  return Number.isInteger(t) && t >= 0 ? { state, seconds: t / 10 } : null;
}

/** A timed spot's template (a strike's warning, charged ground's life, the
 *  cradle's hold): `<prefix><tenths>`. */
export function timedTemplate(prefix: string, seconds: number): string {
  return `${prefix}${tenthsOf(seconds)}`;
}

/** A timed spot template's seconds, or null when it is not of `prefix`. */
export function timedOf(prefix: string, templateId: string): number | null {
  if (!templateId.startsWith(prefix)) return null;
  const t = Number(templateId.slice(prefix.length));
  return Number.isInteger(t) && t >= 0 ? t / 10 : null;
}
