// Pure, host-agnostic celebration plan for profession skill level-ups
// (gathering proficiency and craft skill counters). Skills gain fractional
// amounts; the player-visible "level" is the floored integer, so a crossing
// registers only when that floor climbs (classic "skill increased to N"
// feedback).
//
// Cadence discipline: an at-tier action moves a skill by exactly +1.0
// (tierProgressMultiplier's orange arm), so a floor crossing is the COMMON
// case while actively gathering or crafting, not a rare one. The chat line
// therefore fires on every crossing (the classic per-point skill message),
// while the banner plate and celebration sound are reserved for gathering
// milestone crossings (SKILL_PLATE_MILESTONE_STEP). Craft floors never
// plate: the craft tier-up celebration (craft_celebration_view.ts) already
// owns every craft 25-boundary, and a per-point plate would flood the
// bounded celebration queue (banner_queue.ts drops celebrations beyond its
// limit, starving real level-up and deed plates).
//
// The buildCraftCelebrationPlan shape (craft_celebration_view.ts): the HUD arm
// stays a thin consumer and the batching rules are unit-pinned here. DOM-free
// and i18n-free so tests/skill_level_toast_view.test.ts drives it directly.
//
// Silent first observation (null prev): a fresh cprof/gprof mirror never toasts
// the player's whole history on login/join. `synced` gates the same way craft
// tier-ups do: the pre-mirror state must never become a baseline.

import { GATHER_GAIN_TIER_STEP } from '../sim/professions/gathering';

/** Display level for a (possibly fractional) skill counter: floor of a
 *  non-negative value, 0 for anything non-positive or non-finite. */
export function skillDisplayLevel(skill: number): number {
  if (!(skill > 0) || !Number.isFinite(skill)) return 0;
  return Math.floor(skill);
}

/** One skill whose floored display level climbed between two snapshots. */
export interface SkillLevelUp {
  skillId: string;
  fromLevel: number;
  toLevel: number;
}

const NO_SKILL_UPS: SkillLevelUp[] = [];

/**
 * Integer skill-level crossings between two skill maps. One entry per skill
 * that climbed, carrying the floors on both sides (a multi-point jump reports
 * only the final floor). `prev === null` is the silent first observation.
 * Returns the shared empty array when nothing climbed: this runs on every
 * drain, so the no-change path must not allocate.
 */
export function computeSkillLevelUps(
  prev: Readonly<Record<string, number>> | null,
  next: Readonly<Record<string, number>>,
): SkillLevelUp[] {
  if (prev === null) return NO_SKILL_UPS;
  let ups: SkillLevelUp[] | null = null;
  for (const skillId in next) {
    const toLevel = skillDisplayLevel(next[skillId]);
    const fromLevel = skillDisplayLevel(prev[skillId] ?? 0);
    if (toLevel > fromLevel) {
      if (ups === null) ups = [];
      ups.push({ skillId, fromLevel, toLevel });
    }
  }
  return ups ?? NO_SKILL_UPS;
}

export interface SkillLevelObservation {
  skillUps: SkillLevelUp[];
  prev: Record<string, number> | null;
}

/**
 * Per-drain skill-level observation step: silent first synced baseline, then
 * every subsequent synced observation diffs floors. Always-on after init (no
 * armed window): craft skill can climb on craft/enchant/salvage/battlefield
 * trickle, and gathering proficiency applies the tick after gatherResult/
 * fishingResult, so an event-armed window would miss quiet drains. Guarded on
 * `synced` so a pre-mirror snapshot never becomes a baseline.
 *
 * ADVANCES ITS OWN STATE: once initialized, `prev` is mutated in place
 * (values carried forward; skills only ever climb, keys never leave) and the
 * SAME object is returned, avoiding a per-drain snapshot allocation. The
 * caller owns exactly one snapshot per skill family and must not share it.
 */
export function advanceSkillLevelObservation(
  synced: boolean,
  prev: Record<string, number> | null,
  next: Readonly<Record<string, number>>,
): SkillLevelObservation {
  if (!synced) return { skillUps: NO_SKILL_UPS, prev };
  if (prev === null) return { skillUps: NO_SKILL_UPS, prev: { ...next } };
  const skillUps = computeSkillLevelUps(prev, next);
  for (const skillId in next) {
    if (prev[skillId] !== next[skillId]) prev[skillId] = next[skillId];
  }
  return { skillUps, prev };
}

/** The gathering plate fires when a crossing passes a multiple of this step:
 *  the gathering analogue of the craft tier-up celebration, anchored to the
 *  same 25-point tier stride the sim's gain curve uses (GATHER_GAIN_TIER_STEP,
 *  never an invented balance number). Between milestones the chat line is the
 *  whole feedback, exactly like classic per-point skill messages. */
export const SKILL_PLATE_MILESTONE_STEP = GATHER_GAIN_TIER_STEP;

/** Whether a crossing passed a milestone boundary (a multi-point jump that
 *  clears one still plates once, reporting the reached level). */
export function crossedSkillPlateMilestone(up: SkillLevelUp): boolean {
  return (
    Math.floor(up.toLevel / SKILL_PLATE_MILESTONE_STEP) >
    Math.floor(up.fromLevel / SKILL_PLATE_MILESTONE_STEP)
  );
}

export interface SkillLevelCelebrationPlan {
  /** One chat line each, craft ups then gathering ups, in observation order. */
  skillUpLogs: SkillLevelUp[];
  /** Coalesced single plate slot: the LAST gathering milestone crossing wins
   *  when several land in one drain (the log carries every line). Craft ups
   *  never plate; the tier-up celebration owns those boundaries. */
  banner: SkillLevelUp | null;
  /** At most one celebration sound per drain, standing down when the drain
   *  already chimed (tier-up, masterwork, or deed). */
  playSound: boolean;
  /** Motion-only flourishes; false under reducedMotion. Never gates the log
   *  lines, the banner text, or the sound (information survives). */
  motion: boolean;
}

/** Plan the HUD reaction to one drain's skill level-ups. */
export function buildSkillLevelCelebrationPlan(
  craftUps: readonly SkillLevelUp[],
  gatherUps: readonly SkillLevelUp[],
  reducedMotion: boolean,
  celebrationAlreadyChimed: boolean,
): SkillLevelCelebrationPlan {
  const skillUpLogs = [...craftUps, ...gatherUps];
  let banner: SkillLevelUp | null = null;
  for (const up of gatherUps) {
    if (crossedSkillPlateMilestone(up)) banner = up;
  }
  return {
    skillUpLogs,
    banner,
    playSound: banner !== null && !celebrationAlreadyChimed,
    motion: banner !== null && !reducedMotion,
  };
}

/** Painted profession art id for a gathering skill id (the only family that
 *  plates). The caller still resolves through professionImageUrl, which
 *  returns null when the art file is absent from the registry. */
export function skillLevelArtId(skillId: string): string {
  return `gather_${skillId}`;
}
