// The Smith's Heart's hard enrage as data (Jose's approval of 2026-11-25):
// Forge-Fury, the one berserk every boss of the raid shares (hard_enrage.ts
// runs it; each coordinator calls it). Normal has none (each fight's own soft
// enrage stays, on every tier); Heroic and Mythic burn the raid away once the
// pull has run its timer. Imports nothing.
//
//   The clock    from the pull, every tick of the fight, its scripted
//                downtime included (an overflow, the isles, an intermission:
//                they are part of every kill's length).
//   The warning  `warnLead` seconds before: Gathering Forge-Fury on the boss
//                (its countdown on the boss frame) and one line to the room.
//   The fury     at the timer: Forge-Fury on the boss, and every `pulseEvery`
//                seconds a burn on everyone in the fight of `pulseShare` of
//                their maximum health times the pulse's number (the first a
//                share, the second twice it), the `killPulse`th a death
//                whatever shields them. It never ends while the fight lasts.
//   Fair         it never lands while the boss itself cannot be harmed (the
//                Heat sunk in an overflow, the Breath's Gale Cocoon, the
//                final boss's shield or kneel): the fury waits for the first
//                tick the raid can strike it again.

export type HeartEnrageBoss = 'council' | 'breath' | 'quench' | 'heat' | 'final';
export type HeartEnrageTier = 'normal' | 'heroic' | 'mythic';

/** Each boss's timer per tier, in seconds from the pull (null: no hard
 *  enrage). Mythic is Heroic's plus a minute. */
export const HARD_ENRAGE_SECONDS: Readonly<
  Record<HeartEnrageBoss, Readonly<Record<HeartEnrageTier, number | null>>>
> = {
  council: { normal: null, heroic: 480, mythic: 540 },
  breath: { normal: null, heroic: 540, mythic: 600 },
  heat: { normal: null, heroic: 480, mythic: 540 },
  quench: { normal: null, heroic: 480, mythic: 540 },
  final: { normal: null, heroic: 600, mythic: 660 },
};

export const HARD_ENRAGE_TUNING = {
  /** The warning's lead before the fury, seconds. */
  warnLead: 30,
  /** Seconds between two burns of the fury. */
  pulseEvery: 1,
  /** A burn's share of maximum health, times its number. */
  pulseShare: 0.4,
  /** The burn that kills whatever shields (the first is 1). */
  killPulse: 3,
} as const;

/** The auras on the boss (quiet `internal_cd` markers the client reads). */
export const HARD_ENRAGE_AURAS = {
  /** The last `warnLead` seconds: `remaining` the countdown, `value` the
   *  boss's timer for this tier (seconds from the pull). */
  gathering: 'heart_forge_fury_gathering',
  /** The fury itself, held while the fight lasts: `value` the same timer. */
  fury: 'heart_forge_fury',
} as const;

/** The names (IP-checked 2026-11-25: plain English compound, no game uses it). */
export const HARD_ENRAGE_NAMES = {
  gathering: 'Gathering Forge-Fury',
  fury: 'Forge-Fury',
} as const;

/** The lines the room reads (re-localized by src/ui/sim_i18n.ts, EXACT). */
export const HARD_ENRAGE_LOGS = {
  warn: 'Forge-Fury gathers. In 30 seconds it will burn the raid away.',
  fury: 'Forge-Fury is unleashed!',
} as const;

/** The fury's burn on each player (spellfx, the boss to them). */
export const HARD_ENRAGE_CUES = {
  pulse: 'heart_forge_fury_pulse',
} as const;

/** The timer for `boss` on `tier` (null: none). */
export function hardEnrageSeconds(boss: HeartEnrageBoss, tier: HeartEnrageTier): number | null {
  return HARD_ENRAGE_SECONDS[boss][tier];
}
