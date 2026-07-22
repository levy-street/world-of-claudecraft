// Tier-crossing master mail (Professions 2.0 Phase 14): when an ATTUNED
// character's ACTIVE pair advances one of its two major crafts to a new tier,
// the pair's resident master writes them a congratulatory Ravenpost letter. A
// 1 Hz sweep beside the Guild trend letter sweep (professions/guild_letter.ts),
// the same single evaluation chokepoint for every craft-skill mutation path plus
// the load backfill case. Draws NO rng and emits nothing itself: it only books a
// letter via ctx.mailAuthoredLetter (the guild_letter idiom), so appending it in
// the mail phase cannot fork the deterministic draw order.
//
// Only the active pair's two MAJORS are watched: never the hobby, a dormant
// craft, or (obviously) an unattuned character. Per-craft acknowledgement lives
// in PlayerMeta.tierMailSent (a Map, persisted with zero-default omission), whose
// baseline arming both migrates already-attuned characters at deploy (no
// retroactive spam) and baselines a freshly- or newly-majored craft at its
// current tier, so the FIRST mail is only for a tier crossed AFTER attunement.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/net
// imports, no Math.random/Date.now, host-agnostic.

import { MASTER_TIER_LETTERS } from '../content/letters';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { archetypePairId } from './archetype';
import { tierForSkill } from './wheel';

/** Rebuild the persisted per-craft acknowledged-tier record into a live map,
 *  keeping only valid finite non-negative entries; a craft dropped here (or absent
 *  from the save) re-baselines silently on the next sweep. Keeps the sim.ts load
 *  arm thin and consistent with cadence.ts clampCadenceOnLoad. */
export function normalizeTierMailOnLoad(
  saved: Record<string, number> | undefined | null,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!saved) return map;
  for (const [craft, tier] of Object.entries(saved)) {
    if (typeof tier === 'number' && Number.isFinite(tier) && tier >= 0) {
      map.set(craft, tier);
    }
  }
  return map;
}

/** The active pair's two major craft ids, or null when the character is not
 *  attuned (activeArchetype/pairedMajor both null). */
function activeMajors(meta: PlayerMeta): [string, string] | null {
  const { activeArchetype, pairedMajor } = meta.archetype;
  if (activeArchetype === null || pairedMajor === null) return null;
  return [activeArchetype, pairedMajor];
}

/** Baseline-arm the active pair's two majors at their CURRENT tier without
 *  sending any mail: records tierMailSent[craft] = tier for any major not yet in
 *  the map. Called at attunement time (the quest-effect call path) so a newly-
 *  majored craft baselines at its attunement-time tier, closing the up-to-one-
 *  second window before the next sweep would otherwise swallow a tier crossed
 *  immediately after attunement. A no-op for an unattuned character. */
export function baselineActivePairTierMail(meta: PlayerMeta): void {
  const majors = activeMajors(meta);
  if (!majors) return;
  for (const craft of majors) {
    if (!meta.tierMailSent.has(craft)) {
      meta.tierMailSent.set(craft, tierForSkill(meta.craftSkills[craft] ?? 0));
    }
  }
}

/** Evaluate one character: for each of the active pair's two majors, baseline-arm
 *  a not-yet-tracked craft silently, then, when the current tier exceeds the
 *  acknowledged tier, book the CURRENT (top) tier's letter once (a multi-tier
 *  jump sends only the highest tier's letter) and acknowledge the new tier.
 *  Returns whether any letter was booked. */
export function updateTierMailFor(meta: PlayerMeta, ctx: SimContext): boolean {
  const majors = activeMajors(meta);
  if (!majors) return false;
  const pairId = archetypePairId(majors[0], majors[1]);
  if (!pairId) return false;
  let booked = false;
  for (const craft of majors) {
    const currentTier = tierForSkill(meta.craftSkills[craft] ?? 0);
    const acknowledged = meta.tierMailSent.get(craft);
    if (acknowledged === undefined) {
      // Baseline (deploy migration / fresh or returning attunement): silent.
      meta.tierMailSent.set(craft, currentTier);
      continue;
    }
    if (currentTier > acknowledged) {
      const letter = MASTER_TIER_LETTERS[pairId]?.[currentTier];
      if (letter) {
        ctx.mailAuthoredLetter(meta, letter);
        booked = true;
      }
      // Acknowledge the reached tier even when no letter exists for it (a tier
      // beyond the authored 1..5 range, e.g. a debug over-cap skill), so the
      // same crossing is never re-evaluated.
      meta.tierMailSent.set(craft, currentTier);
    }
  }
  return booked;
}

/** The 1 Hz tick sweep (called from the mail phase of Sim.tick, beside
 *  updateGuildTrendLetters): evaluates every player on the PostOffice's
 *  once-a-second cadence. Zero rng, so its position in the tick tail cannot fork
 *  the draw order. */
export function updateTierMail(ctx: SimContext): void {
  if (ctx.tickCount % 20 !== 0) return;
  for (const meta of ctx.players.values()) updateTierMailFor(meta, ctx);
}
