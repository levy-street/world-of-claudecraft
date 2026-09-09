// One-time heal for gathering proficiencies stranded by the pre-fix
// character-sheet rounding (issue 2339). The sheet formatted the raw value
// with round-half-up while every threshold reader (the proficiency bands and
// the 100/200 gathering deeds) compares the raw value with >=, so a player at
// 99.5 to 99.99 read "Fishing: 100" with Old Salt still locked, took the
// readout at its word, and stopped fishing with the deed stranded.
//
// The heal bumps any value inside the half-point display band below a band
// threshold ([threshold - 0.5, threshold), exactly the values the old sheet
// showed as that threshold) up to the threshold, so the join-time deed retro
// pass (the sim.ts addPlayer tail) grants the matching deeds on that same
// join. Only threshold values with a READER heal: the deed milestones and the
// catch-table boundaries.
//
// FISHING READS A DIFFERENT LADDER SINCE masterwrought Phase 11i, and this
// module had to follow it. The comment here used to say a mid-band breakpoint
// at 150 "has no reader and stays untouched", which stopped being true the
// moment FISHING_CATCH_BAND_THRESHOLDS made 150 the band-2 catch gate: a
// pre-fix blob at fishing 149.5 to 149.99, which the old sheet displayed as
// "150", would have been left one hundredth below a table it had been told it
// had earned. That is precisely the strand this module exists to close, so the
// walk below takes fishing's OWN ladder for fishing and the shared one for the
// land professions. The land professions are unaffected either way (their
// maxSkill is 100, so every threshold above it is skipped), but reading the
// right ladder per profession is what keeps that an argument rather than a
// coincidence. Applied once per character behind
// CharacterState.proficiencyDisplayHealApplied (the masteryResetApplied
// idiom): blobs written by post-fix code floor on the sheet instead, so a
// live 99.5 correctly reads 99 and is never healed.
//
// Pure leaf (no SimContext, no rng, Vitest-importable directly), mutating
// the record in place, the applyMasteryReset shape.
import { GATHERING_PROFESSION_IDS, GATHERING_PROFESSIONS } from '../content/professions';
import { FISHING_CATCH_BAND_THRESHOLDS } from './fishing_bands';
import type { GatheringProficiency } from './gathering';
import { PROFICIENCY_BAND_THRESHOLDS } from './proficiency_bands';

/** The threshold ladder a profession's own readers gate on. Fishing has had its
 *  own since masterwrought Phase 11i; every land profession still shares one.
 *  Duplicate entries (fishing's three 200s) are harmless: the heal is
 *  idempotent and clamps at the cap. */
function healThresholdsFor(professionId: string): readonly number[] {
  return professionId === 'fishing' ? FISHING_CATCH_BAND_THRESHOLDS : PROFICIENCY_BAND_THRESHOLDS;
}

// Half a display point: the pre-fix sheet's round-half-up showed a threshold
// for any raw value at or above threshold - 0.5.
export const DISPLAY_HEAL_BAND = 0.5;

/** Bumps every proficiency the pre-fix sheet displayed as a crossed band
 *  threshold up to that threshold, capped at the profession's maxSkill
 *  ladder (a threshold above the cap never applies). Returns whether any
 *  value changed. */
export function healDisplayRoundedProficiency(proficiency: GatheringProficiency): boolean {
  let healed = false;
  for (const id of GATHERING_PROFESSION_IDS) {
    const cap = GATHERING_PROFESSIONS[id].maxSkill;
    for (const threshold of healThresholdsFor(id)) {
      if (threshold === 0 || threshold > cap) continue;
      const v = proficiency[id];
      if (v >= threshold - DISPLAY_HEAL_BAND && v < threshold) {
        proficiency[id] = threshold;
        healed = true;
      }
    }
  }
  return healed;
}
