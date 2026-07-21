import { CRAFT_RING } from '../sim/content/professions';
import {
  archetypePairId,
  craftsForPairTarget,
  defaultHobbyForPair,
} from '../sim/professions/archetype';
import { TIER_SKILL_STEP, tierForSkill } from '../sim/professions/wheel';
import type { CraftingIdentityView } from '../world_api/professions';

export type ProfessionIdentityState = 'syncing' | 'unattuned' | 'attuned';
export type ProfessionRole = 'major' | 'hobby' | 'dormant' | 'unattuned';
export type EmpowermentCeiling = 'unlimited' | 'rare' | 'common';

export interface ProfessionSkillRow {
  craftId: string;
  skill: number;
  tier: number;
  pointsToNextTier: number;
  role: ProfessionRole;
  ceiling: EmpowermentCeiling;
  dormantKnowledge: boolean;
}

export type ProfessionNudge =
  | { type: 'nearTier'; craftId: string; points: number }
  | { type: 'dormantKnowledge'; craftId: string };

export interface ProfessionIdentityModel {
  state: ProfessionIdentityState;
  summary: {
    // The active pair's canonical id (archetypePairId), the identifier the
    // pair-archetype title renders from; null when unattuned.
    pairId: string | null;
    majors: [string, string] | null;
    hobbyCraft: string | null;
    attunedPairCount: number;
    returnCount: number;
  };
  skills: ProfessionSkillRow[];
  tutorial: { targetSkill: number } | null;
  nudges: ProfessionNudge[];
}

export interface AttunementPreview {
  // `target` IS the canonical pair id, so it doubles as the previewed title's
  // identifier (see getArchetypeTitle).
  target: string;
  majors: [string, string];
  hobbyCraft: string | null;
  majorCeiling: 'unlimited';
  hobbyCeiling: 'rare';
  otherCeiling: 'common';
  retainsAllSkill: true;
}

export function buildProfessionIdentityView(
  identity: CraftingIdentityView,
): ProfessionIdentityModel {
  const state: ProfessionIdentityState = !identity.synced
    ? 'syncing'
    : identity.activeArchetype && identity.pairedMajor
      ? 'attuned'
      : 'unattuned';
  const majors =
    state === 'attuned'
      ? ([identity.activeArchetype as string, identity.pairedMajor as string] as [string, string])
      : null;
  const skills = CRAFT_RING.map((craft): ProfessionSkillRow => {
    const skill = identity.craftSkills[craft.id] ?? 0;
    const tier = tierForSkill(skill);
    const remainder = skill % TIER_SKILL_STEP;
    const role: ProfessionRole =
      state !== 'attuned'
        ? 'unattuned'
        : majors?.includes(craft.id)
          ? 'major'
          : identity.hobbyCraft === craft.id
            ? 'hobby'
            : 'dormant';
    const ceiling: EmpowermentCeiling =
      role === 'major' ? 'unlimited' : role === 'hobby' || role === 'unattuned' ? 'rare' : 'common';
    return {
      craftId: craft.id,
      skill,
      tier,
      pointsToNextTier: TIER_SKILL_STEP - remainder,
      role,
      ceiling,
      dormantKnowledge: role === 'dormant' && skill > 0,
    };
  });
  const nudges: ProfessionNudge[] = [];
  for (const row of skills) {
    if (row.skill > 0 && row.pointsToNextTier <= 5) {
      nudges.push({ type: 'nearTier', craftId: row.craftId, points: row.pointsToNextTier });
    }
    if (row.dormantKnowledge && row.tier >= 1) {
      nudges.push({ type: 'dormantKnowledge', craftId: row.craftId });
    }
  }
  return {
    state,
    summary: {
      pairId: majors ? archetypePairId(majors[0], majors[1]) : null,
      majors,
      hobbyCraft: identity.hobbyCraft,
      attunedPairCount: identity.attunedPairs.length,
      returnCount: identity.switchCount,
    },
    skills,
    tutorial: skills.some((row) => row.tier >= 1) ? null : { targetSkill: TIER_SKILL_STEP },
    nudges,
  };
}

export function buildAttunementPreview(
  target: string,
  craftSkills: Readonly<Record<string, number>>,
): AttunementPreview | null {
  const pair = craftsForPairTarget(target);
  if (!pair) return null;
  return {
    target,
    majors: pair,
    hobbyCraft: defaultHobbyForPair(pair[0], pair[1], { ...craftSkills }),
    majorCeiling: 'unlimited',
    hobbyCeiling: 'rare',
    otherCeiling: 'common',
    retainsAllSkill: true,
  };
}
