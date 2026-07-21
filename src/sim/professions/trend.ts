// Craft-trend classification (Professions 2.0 Phase 7): which adjacent pair a
// character's flat craft skills are trending toward, and whether that trend has
// crossed the Guild's attention threshold. A pure leaf over wheel.ts state and
// archetype.ts pair vocabulary: no SimContext, no rng, no clock, no mutation.
// The Guild trend letter trigger (guild_letter.ts) is the one consumer today.

import { ARCHETYPE_PAIR_TARGETS, craftsForPairTarget } from './archetype';
import { type CraftSkills, TIER_SKILL_STEP } from './wheel';

// The pair score at which the Guild takes notice: one full tier of combined
// skill across the pair (wheel.ts's tier step, not a new balance number).
export const GUILD_LETTER_SKILL_THRESHOLD = TIER_SKILL_STEP;

/** The leading adjacent-pair trend in a character's craft skills. */
export interface CraftTrend {
  // Canonical pair id (archetype.ts ARCHETYPE_PAIR_TARGETS, "craftA+craftB").
  pairId: string;
  // The pair's two member craft ids, in canonical ring order.
  crafts: [string, string];
  // Sum of the two members' skill values (missing or non-positive count as 0).
  score: number;
  // Whether the leading pair's score has reached GUILD_LETTER_SKILL_THRESHOLD.
  crossed: boolean;
}

// A skill entry counts only when it is a positive finite number; missing,
// non-positive, and malformed entries all read as 0 (persisted records are
// normalized upstream, but this classifier stays total over any input).
function skillOf(skills: CraftSkills, craftId: string): number {
  const value = skills[craftId];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Classify the leading adjacent-pair trend in `skills`, or null when every
 *  pair scores 0 (a character who has never crafted). The leading pair is the
 *  maximum by: score descending, then the lesser member skill descending (a
 *  balanced pair beats a lopsided one), then the FIRST ring member's skill
 *  descending, then ring index ascending (the iteration order of
 *  ARCHETYPE_PAIR_TARGETS, so ties resolve to the earliest pair). */
export function classifyCraftTrend(skills: CraftSkills): CraftTrend | null {
  let best: {
    pairId: string;
    crafts: [string, string];
    score: number;
    minSkill: number;
    firstSkill: number;
  } | null = null;
  for (const pairId of ARCHETYPE_PAIR_TARGETS) {
    const crafts = craftsForPairTarget(pairId);
    if (!crafts) continue;
    const first = skillOf(skills, crafts[0]);
    const second = skillOf(skills, crafts[1]);
    const score = first + second;
    const minSkill = Math.min(first, second);
    const wins =
      best === null ||
      score > best.score ||
      (score === best.score &&
        (minSkill > best.minSkill || (minSkill === best.minSkill && first > best.firstSkill)));
    if (wins) best = { pairId, crafts, score, minSkill, firstSkill: first };
  }
  if (best === null || best.score <= 0) return null;
  return {
    pairId: best.pairId,
    crafts: best.crafts,
    score: best.score,
    crossed: best.score >= GUILD_LETTER_SKILL_THRESHOLD,
  };
}
