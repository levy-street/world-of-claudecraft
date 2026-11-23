// Which dungeon interiors prewarm encounter visuals at first attach: the
// mechanic visuals an encounter builds lazily in live combat. Boot never pays
// this; the outdoor zone prewarm stops at the dungeon door. (Nythraxis' Soul
// Rend mark needs nothing here any more: it draws the spirit veil, whose
// program family the boot manifest links.)
//
// Deliberately NOT the encounter's own NPC. Brother Aldric was the first
// suspect and the A/B says he is innocent: entering the arena from a start zone
// that had never compiled his rig (the stock npc_aldric model he wore then),
// his 70% spawn still linked ZERO programs and cost 29ms, because that rig
// shared its programs with the player bodies already on screen. He wears his
// authored look on the priest's WOC body now (characters/npc_looks.ts), a def
// a player draws with (player_priest); that spawn has not been measured again.
// Warming a model that costs nothing is work, not a fix.

export interface InteriorEncounterPrewarmSpec {
  varkhulVisuals?: boolean;
  ignivarVisuals?: boolean;
  /** Nythraxis's Grave Eruption, Grave Flame, Gravefire, and Binding Sigil
   *  floor materials: crypt-only actionable telegraphs warm here, never in
   *  the boot manifest. */
  nythraxisGraveVisuals?: boolean;
  /** Vael the Fogbinder's see-through Fog Shade (the Fogbeacon's Hollow Shade
   *  tell): the transparent ghost variant of his rig, an actionable tell that
   *  must not wait on a compile the first time the beam pours through one. */
  vaelShadeGhost?: boolean;
  /** The Sunbone Hexcaller's Toad Hex: the hexed player's `form_toad` rig, a
   *  tinted frog clone built lazily in the polymorph slot on the first hex
   *  (characters/form_rig_sync.ts). Linked here at the basin's attach, so the
   *  first hex does not hold the player on the base body behind the gate. */
  wildheartToadForm?: boolean;
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
  vaelShadeGhost: true,
  wildheartToadForm: true,
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
  // The Sunken Bastion: Vael's Fog Shades turn see-through in the Fogbeacon's
  // beam (the tell that finds the real one), on the ghost variant of his rig,
  // linked here at the landing, three bosses before the crown.
  sunken_bastion: {
    vaelShadeGhost: true,
  },
  // The Wildheart Basin: the Sunbone Hexcallers' Toad Hex turns a player into
  // the toad form rig, which no other content wears, linked at the Idol Maw
  // landing rather than on the first hex in a live pull.
  wildheart: {
    wildheartToadForm: true,
  },
};

export function encounterPrewarmForInterior(interior: string): InteriorEncounterPrewarmSpec | null {
  return INTERIOR_ENCOUNTER_PREWARM[interior] ?? null;
}

export function encounterPrewarmDisabled(search: string): boolean {
  const value = new URLSearchParams(search).get('encounterPrewarm');
  return value === '0' || value === 'off';
}
