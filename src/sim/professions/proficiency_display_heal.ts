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
// join. Only band thresholds heal: they are the deed milestones and the
// catch-table boundaries; a mid-band schedule breakpoint (150) has no reader
// and stays untouched. Applied once per character behind
// CharacterState.proficiencyDisplayHealApplied (the masteryResetApplied
// idiom): blobs written by post-fix code floor on the sheet instead, so a
// live 99.5 correctly reads 99 and is never healed.
//
// Pure leaf (no SimContext, no rng, Vitest-importable directly), mutating
// the record in place, the applyMasteryReset shape.
import { GATHERING_PROFESSION_IDS, GATHERING_PROFESSIONS } from '../content/professions';
import type { GatheringProficiency } from './gathering';
import { PROFICIENCY_BAND_THRESHOLDS } from './proficiency_bands';

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
    for (const threshold of PROFICIENCY_BAND_THRESHOLDS) {
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
