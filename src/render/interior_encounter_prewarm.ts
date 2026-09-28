// Which dungeon interiors prewarm encounter visuals at first attach: the
// mechanic visuals an encounter builds lazily in live combat. Boot never pays
// this; the outdoor zone prewarm stops at the dungeon door. (Nythraxis' Soul
// Rend mark needs nothing here any more: it draws the spirit veil, whose
// program family the boot manifest links.)
//
// Deliberately NOT the encounter's own NPC. Brother Aldric was the first
// suspect and the A/B says he is innocent: entering the arena from a start zone
// that had never compiled npc_aldric, his 70% spawn still linked ZERO programs
// and cost 29ms, because his rig shares its programs with the player bodies
// already on screen. Warming a model that costs nothing is work, not a fix.
export interface InteriorEncounterPrewarmSpec {
  varkhulVisuals?: boolean;
  ignivarVisuals?: boolean;
  /** Nythraxis's Grave Eruption, Grave Flame, Gravefire, and Binding Sigil
   *  floor materials: crypt-only actionable telegraphs warm here, never in
   *  the boot manifest. */
  nythraxisGraveVisuals?: boolean;
}

/** The staged sets a spec can build: every flag. Each is claimed once per
 *  session, not once per interior: the Ignivar raid reaches the same sets from
 *  several rooms, and programs are per GL context, so what one room linked
 *  every later room keeps. */
export type EncounterPrewarmSet = keyof InteriorEncounterPrewarmSpec;

// A Record, so a new spec flag fails to compile until it is listed here.
const ENCOUNTER_PREWARM_SET_FLAGS: Record<EncounterPrewarmSet, true> = {
  varkhulVisuals: true,
  ignivarVisuals: true,
  nythraxisGraveVisuals: true,
};

export const ENCOUNTER_PREWARM_SETS = Object.keys(
  ENCOUNTER_PREWARM_SET_FLAGS,
) as readonly EncounterPrewarmSet[];

export function unclaimedEncounterPrewarmSets(
  spec: InteriorEncounterPrewarmSpec,
  claimed: ReadonlySet<EncounterPrewarmSet>,
): EncounterPrewarmSet[] {
  return ENCOUNTER_PREWARM_SETS.filter((set) => spec[set] === true && !claimed.has(set));
}

/** The spec narrowed to `sets`, so a pass builds only what its interior claimed. */
export function encounterPrewarmSpecForSets(
  spec: InteriorEncounterPrewarmSpec,
  sets: readonly EncounterPrewarmSet[],
): InteriorEncounterPrewarmSpec {
  const narrowed = { ...spec };
  for (const set of ENCOUNTER_PREWARM_SETS) narrowed[set] = sets.includes(set);
  return narrowed;
}

export const INTERIOR_ENCOUNTER_PREWARM: Record<string, InteriorEncounterPrewarmSpec> = {
  nythraxis: {
    nythraxisGraveVisuals: true,
  },
  // The Forge-Lift is the raid's first room and a sealed ride
  // (IGNIVAR_LIFT_RIDE_SECONDS) with nothing to react to: both raid sets link
  // there, rooms before either boss is pulled, instead of racing the pull in
  // the boss's own room.
  ignivar_lift: {
    varkhulVisuals: true,
    ignivarVisuals: true,
  },
  // The Halls, whose interior the Molten Assembly shares: a raider who joins
  // past the lift still warms both sets before the Crucible.
  ignivar_approach: {
    varkhulVisuals: true,
    ignivarVisuals: true,
  },
  ignivar_depths: {
    varkhulVisuals: true,
    ignivarVisuals: true,
  },
  // The Crucible arena where Ignivar itself is fought (interior 'ignivar'):
  // the same fire beams, rotating rays and Judgment as the depths, without
  // Varkhul. Without this row the arena had no spec at all, so every mechanic
  // linked its programs at first onset (2026-09-12 hunt: fire beams, rotating
  // rays and the water cleanse runes, 15 live programs in one pull).
  ignivar: {
    ignivarVisuals: true,
  },
};

export function encounterPrewarmForInterior(interior: string): InteriorEncounterPrewarmSpec | null {
  return INTERIOR_ENCOUNTER_PREWARM[interior] ?? null;
}

export function encounterPrewarmDisabled(search: string): boolean {
  const value = new URLSearchParams(search).get('encounterPrewarm');
  return value === '0' || value === 'off';
}
