// Profession nudges (Professions 2.0, completing the #1295 nudge arm):
// two soft, text-free personal reminders emitted on a 1 Hz sweep beside the
// Guild trend letter sweep (professions/guild_letter.ts). Draws NO rng; it only
// emits events (ctx.emit draws nothing), so its position in the mail phase tail
// cannot fork the deterministic draw order.
//
//  1. Trend nudge: an unattuned crafter whose skills lean toward an adjacent
//     pair (trend.ts classifyCraftTrend) gets a `profTrendNudge` at most once per
//     NUDGE_CADENCE_TICKS. The cadence state is DELIBERATELY in-memory
//     (PlayerMeta.profNudgeCadence, never serialized): a restart reopens the
//     window, which is accepted, since the nudge is a hint, not a one-shot
//     award. The Guild trend letter (the letter-voice follow-up at the crossing
//     threshold) keeps its own one-shot semantics unchanged; nudges can fire
//     BELOW that threshold because classifyCraftTrend returns leaning trends that
//     have not yet crossed.
//  2. First-tier tutorial: the first time ANY craft skill crosses tier 1 (skill
//     >= TIER_SKILL_STEP), attuned or not, the character gets a `profTierTutorial`
//     exactly once ever. A persisted one-shot flag (PlayerMeta.profTierTutorialSent,
//     the guildLetterSent idiom) flipped BEFORE the emit guarantees it never
//     re-fires across load, relog, or restart.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/net
// imports, no Math.random/Date.now, host-agnostic.

import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { armCadence, isCadenceBlocked, NUDGE_CADENCE_TICKS } from './cadence';
import { classifyCraftTrend } from './trend';
import { tierForSkill } from './wheel';

// The single cadence key the trend nudge arms (one nudge type per character, so
// one keyed window in the per-character profNudgeCadence map).
const TREND_NUDGE_KEY = 'trend';

/** Whether any of the character's craft skills has reached tier 1 or higher. */
function hasCraftAtTierOne(meta: PlayerMeta): boolean {
  for (const skill of Object.values(meta.craftSkills)) {
    if (tierForSkill(skill) >= 1) return true;
  }
  return false;
}

/** The first-tier tutorial one-shot: emit once ever the first time any craft
 *  reaches tier 1. Flips the persisted flag BEFORE the emit so a re-entrant load
 *  can never double-fire. Returns whether it emitted. */
export function maybeEmitTierTutorial(meta: PlayerMeta, ctx: SimContext): boolean {
  if (meta.profTierTutorialSent) return false;
  if (!hasCraftAtTierOne(meta)) return false;
  meta.profTierTutorialSent = true;
  ctx.emit({ type: 'profTierTutorial', pid: meta.entityId });
  return true;
}

/** The trend nudge: for an unattuned crafter with a leading craft trend, emit
 *  `profTrendNudge` when the in-memory per-character window is open, then arm the
 *  window. Eligibility mirrors the Guild trend letter (no active archetype, no
 *  attunement history) but fires at the lower classifyCraftTrend != null bar.
 *  Returns whether it emitted. */
export function maybeEmitTrendNudge(meta: PlayerMeta, ctx: SimContext): boolean {
  if (meta.archetype.activeArchetype !== null) return false;
  if (meta.archetype.attunedPairs.length > 0) return false;
  const trend = classifyCraftTrend(meta.craftSkills);
  if (!trend) return false;
  if (isCadenceBlocked(meta.profNudgeCadence, TREND_NUDGE_KEY, ctx.tickCount)) return false;
  armCadence(meta.profNudgeCadence, TREND_NUDGE_KEY, ctx.tickCount, NUDGE_CADENCE_TICKS);
  ctx.emit({ type: 'profTrendNudge', pid: meta.entityId, pairId: trend.pairId });
  return true;
}

/** The 1 Hz tick sweep (called from the mail phase of Sim.tick, beside
 *  updateGuildTrendLetters): evaluates every player on the PostOffice's
 *  once-a-second cadence. Zero rng, so its position in the tick tail cannot fork
 *  the draw order (it only emits events, which draw nothing). */
export function updateProfNudges(ctx: SimContext): void {
  if (ctx.tickCount % 20 !== 0) return;
  for (const meta of ctx.players.values()) {
    maybeEmitTierTutorial(meta, ctx);
    maybeEmitTrendNudge(meta, ctx);
  }
}
