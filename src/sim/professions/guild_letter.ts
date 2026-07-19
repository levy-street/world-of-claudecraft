// The Guild trend letter (Professions 2.0 Phase 7): when an unattuned
// character's craft skills first trend past the Guild's attention threshold
// (trend.ts), the Crafting Guild sends them ONE Ravenpost letter naming Smith
// Haldren and the attunement quest. One-shot per character via guildLetterSent (the
// mailWelcomed precedent: flipped BEFORE the send, round-tripped through
// CharacterState so no later load can re-send it).
//
// The sweep below is the single evaluation chokepoint for every craft-skill
// mutation path (crafting, battlefield trickle, enchanting, the public
// Sim.gainCraftSkill) AND the load backfill case: it runs at 1 Hz over all
// players inside the tick's mail phase, so a character already past the
// threshold at load gets the letter on the first sweep after join. It draws
// NO rng and emits NOTHING itself: mail arrival already has its own surface
// (the PostOffice announce cadence), so booking the letter is the only effect.

import { GUILD_TREND_LETTERS } from '../content/letters';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { classifyCraftTrend } from './trend';

/** Evaluate one character: eligible (letter never sent, no active archetype,
 *  no attunement history, so an amends-state character gets nothing) AND the
 *  leading craft trend has crossed the threshold books that pair's letter via
 *  the ctx.mailAuthoredLetter seam callback. Returns whether it was booked. */
export function maybeSendGuildTrendLetter(meta: PlayerMeta, ctx: SimContext): boolean {
  if (meta.guildLetterSent) return false;
  if (meta.archetype.activeArchetype !== null) return false;
  if (meta.archetype.attunedPairs.length > 0) return false;
  const trend = classifyCraftTrend(meta.craftSkills);
  if (!trend || !trend.crossed) return false;
  const letter = GUILD_TREND_LETTERS[trend.pairId];
  if (!letter) return false;
  // Flip before the send so a re-entrant save can never double-book the
  // letter (the sendWelcome convention; the callback binding carries the
  // 'system' kind and the mailKeyFor recipient key).
  meta.guildLetterSent = true;
  ctx.mailAuthoredLetter(meta, letter);
  return true;
}

/** The 1 Hz tick sweep (called from the mail phase of Sim.tick, beside
 *  postOffice.update): evaluates every player on the same cadence as the
 *  PostOffice's own once-a-second arm. Zero rng, no events, so its position
 *  in the tick tail cannot fork the deterministic draw order. */
export function updateGuildTrendLetters(ctx: SimContext): void {
  if (ctx.tickCount % 20 !== 0) return;
  for (const meta of ctx.players.values()) maybeSendGuildTrendLetter(meta, ctx);
}
