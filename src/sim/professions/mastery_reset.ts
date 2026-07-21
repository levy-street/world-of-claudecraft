// The one-time mastery reset (Professions 2.0 Phase 12c, the curve deploy):
// fires once per pre-curve character at load-time normalize (the sim.ts
// masteryResetApplied branch), and touches EXACTLY the two skill maps: every
// CRAFT_RING craft skill and every gathering proficiency, zeroed in place.
// Everything else on the sheet (recipes, tools, bank, deeds, archetype
// history, quests, mail) is deliberately untouched: the keep ledger in
// tests/professions_mastery_reset.test.ts pins it row by row. The one-shot
// flag is CharacterState-only BY DESIGN: it must never land on PlayerMeta,
// because the parity sampler has to see zero new fields so every
// non-appendix golden stays byte identical.

import { MASTERY_RESET_LETTER } from '../content/letters';
import { CRAFT_RING, GATHERING_PROFESSION_IDS } from '../content/professions';
import type { SimContext } from '../sim_context';

/** The authored notice letter's stable id (content/letters.ts
 *  MASTERY_RESET_LETTER carries the same literal; pinned together in the
 *  reset suite so the two can never drift apart). */
export const MASTERY_RESET_LETTER_ID = 'mastery_reset_notice';

/** Zero every CRAFT_RING craft skill and every gathering proficiency IN
 *  PLACE. Touches nothing else, is idempotent, and draws no rng. */
export function applyMasteryReset(
  craftSkills: Record<string, number>,
  gatheringProficiency: Record<string, number>,
): void {
  for (const craft of CRAFT_RING) craftSkills[craft.id] = 0;
  for (const id of GATHERING_PROFESSION_IDS) gatheringProficiency[id] = 0;
}

/** The tick mail-phase sweep (called from Sim.tick beside
 *  updateGuildTrendLetters): a player whose load-time normalize just applied
 *  the reset carries the transient pendingMasteryResetNotice flag; flip it
 *  BEFORE the send (the mailWelcomed / guild_letter.ts precedent, so a
 *  re-entrant path can never double-book) and book the authored notice via
 *  the ctx.mailAuthoredLetter seam. Draws ZERO rng and emits nothing itself,
 *  so its position in the tick tail cannot fork the deterministic draw
 *  order. */
export function updateMasteryResetNotices(ctx: SimContext): void {
  for (const meta of ctx.players.values()) {
    if (!meta.pendingMasteryResetNotice) continue;
    meta.pendingMasteryResetNotice = false;
    ctx.mailAuthoredLetter(meta, MASTERY_RESET_LETTER);
  }
}
