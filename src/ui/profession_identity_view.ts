import { CRAFT_RING } from '../sim/content/professions';
import {
  archetypePairId,
  craftsForPairTarget,
  defaultHobbyForPair,
  hobbyCandidatesForPair,
  requiredAmendsProgress,
} from '../sim/professions/archetype';
import { TIER_SKILL_STEP, tierForSkill } from '../sim/professions/wheel';
import type { CraftingIdentityView } from '../world_api/professions';
import type { GatheringProficiencyRow } from './gathering_view';

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

export interface ProfessionUniformChips {
  role: ProfessionRole;
  ceiling: EmpowermentCeiling;
}

/** The uniform-column collapse decision (phase 22, Q28 option 3): when EVERY
 * skill row shares one role and one empowerment ceiling (the unattuned card,
 * where all ten rows repeat Unattuned / Rare cap), the card states the pair
 * once as a caption over the list and the rows render craft plus skill only.
 * Mixed roles OR mixed ceilings disable the collapse; the attuned card always
 * mixes, and that is a guarantee, not a tendency: CRAFT_RING holds ten
 * distinct crafts (three or more is enough) so a two-major pair can never
 * cover every row, and every archetype writer validates its ids through
 * isCraftId against the frozen ring (src/sim/professions/archetype.ts, the
 * frozen-ring invariant), so an off-ring all-dormant identity is not a
 * producible state. Row aria text is unaffected: every row keeps the
 * complete skillAria sentence either way. */
export function uniformSkillChips(
  skills: readonly ProfessionSkillRow[],
): ProfessionUniformChips | null {
  const first = skills[0];
  if (!first) return null;
  return skills.every((row) => row.role === first.role && row.ceiling === first.ceiling)
    ? { role: first.role, ceiling: first.ceiling }
    : null;
}

/** Presentation order for the identity CARD's capped list (the phase 22 QA
 * round): the 264px cap shows about five of ten rows, and in raw ring order
 * the two Material-pair majors sit at ring indices 8 and 9, below the fold,
 * so an attuned Smith's card opened on everything EXCEPT the two crafts it
 * exists to headline. Majors lead, then the hobby, then dormant rows that
 * still hold knowledge; the sort is stable, so ring order survives within
 * each group and the unattuned card (every row one role) is untouched.
 * A sorted COPY, deliberately not the model order: ProfessionIdentityModel
 * .skills stays in CRAFT_RING order because the professions window's craft
 * ROW LIST maps it positionally (professions_view.ts, identity.skills into
 * model.crafts, "Ten rows, CRAFT_RING order"); the wheel itself lays out
 * from CRAFT_RING directly and never reads the model. */
export function orderSkillsForCard(skills: readonly ProfessionSkillRow[]): ProfessionSkillRow[] {
  const rolePriority = (row: ProfessionSkillRow): number =>
    row.role === 'major' ? 0 : row.role === 'hobby' ? 1 : row.dormantKnowledge ? 2 : 3;
  return [...skills].sort((a, b) => rolePriority(a) - rolePriority(b));
}

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
    // The make-amends cost to return to an abandoned pair right now
    // (requiredAmendsProgress(returnCount) = 5 + 3 * returnCount): the shared
    // switch-cost-at-rest value professions_view.ts also derives, surfaced so
    // the identity card can show the same figure without a second formula.
    returnCost: number;
  };
  skills: ProfessionSkillRow[];
  // Non-null when every row shares one role and one ceiling: the card states
  // the pair once (a caption over the list) and the rows drop their chips.
  uniform: ProfessionUniformChips | null;
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
  // What a FUTURE return to this pair would cost in make-amends progress if the
  // player later leaves it: requiredAmendsProgress(switchCount), the same shared
  // formula professions_view.ts's switch-cost-at-rest line uses. Closes the 2039
  // review gap (the pre-commit picture omitted the escalating return cost).
  returnCost: number;
}

/** Compact signature for open Character/Crafting surfaces. These cold
 * painters need to converge when an online cprof snapshot arrives after the
 * personal attunement event, while bystander attunedZone events must not
 * repaint them. The Character sheet's Gathering section reads a second facet
 * (IWorldProfessions#professionsState via buildGatheringProficiencyRows), so
 * its rows ride the same signature: a delayed gathering snapshot converges
 * through the identical edge. Enumerate craft skills in ring order and sort
 * set-like arrays so equivalent wire payloads remain byte-stable (the
 * gathering rows already arrive in fixed GATHERING_PROFESSION_IDS order). */
export function professionSurfaceRefreshSig(
  identity: CraftingIdentityView,
  gathering: readonly GatheringProficiencyRow[],
): string {
  return JSON.stringify([
    identity.synced,
    identity.activeArchetype,
    identity.pairedMajor,
    identity.hobbyCraft,
    [...identity.attunedPairs].sort(),
    identity.switchCount,
    identity.amendsProgress,
    identity.amendsRequired,
    CRAFT_RING.map((craft) => identity.craftSkills[craft.id] ?? 0),
    [...identity.knownRecipes].sort(),
    gathering.map((row) => [row.professionId, row.value]),
  ]);
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
      // Display-honest under fractional mastery gains: floor the readout,
      // ceil the points-to-go (74.75 reads 74 with 1 to go, never 75 with 0).
      skill: Math.floor(skill),
      tier,
      pointsToNextTier: Math.ceil(TIER_SKILL_STEP - remainder),
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
      returnCost: requiredAmendsProgress(identity.switchCount),
    },
    skills,
    uniform: uniformSkillChips(skills),
    tutorial: skills.some((row) => row.tier >= 1) ? null : { targetSkill: TIER_SKILL_STEP },
    nudges,
  };
}

export function buildAttunementPreview(
  target: string,
  craftSkills: Readonly<Record<string, number>>,
  switchCount = 0,
  questedHobbies?: Readonly<Record<string, string>>,
): AttunementPreview | null {
  const pair = craftsForPairTarget(target);
  if (!pair) return null;
  // The hobby the transition will ACTUALLY set: a hobby this character once
  // quested for the target pair wins over the skill default (the
  // pair-transition restore, professions/hobby_memory.ts), validated against
  // the pair's candidates exactly like the restore itself, so the pre-commit
  // sentence and the outcome cannot disagree.
  const remembered = questedHobbies?.[target];
  const candidates = hobbyCandidatesForPair(pair[0], pair[1]);
  const hobbyCraft =
    remembered !== undefined && candidates.includes(remembered)
      ? remembered
      : defaultHobbyForPair(pair[0], pair[1], { ...craftSkills });
  return {
    target,
    majors: pair,
    hobbyCraft,
    majorCeiling: 'unlimited',
    hobbyCeiling: 'rare',
    otherCeiling: 'common',
    retainsAllSkill: true,
    returnCost: requiredAmendsProgress(switchCount),
  };
}
