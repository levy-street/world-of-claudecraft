// Professions wheel window view core (Professions 2.0 Phase 5): the pure model
// behind the read-only professions window. COMPOSES the PR 2039 identity view
// (profession_identity_view.ts) rather than absorbing it, because the crafting
// window and quest dialogs keep consuming that module directly; the full
// ProfessionIdentityModel embeds here unchanged, so every identity semantic
// (per-craft role, ceiling, nudges, tutorial state) survives into this model.
// Registered in UI_PURE_CORES (tests/architecture.test.ts): no DOM, no t(), no
// render/game/net imports. Per-call allocation is fine: the window is cold
// (event-driven), never per-frame.

import { CRAFT_RING, oppositeCraft, PERK_THRESHOLDS } from '../sim/content/professions';
import { requiredAmendsProgress } from '../sim/professions/archetype';
import {
  type CraftSkills,
  isSpecialized,
  materialCostMultiplier,
  TIER_SKILL_STEP,
  tierForSkill,
} from '../sim/professions/wheel';
import type { CraftingIdentityView } from '../world_api/professions';
import {
  buildProfessionIdentityView,
  type ProfessionIdentityModel,
  type ProfessionSkillRow,
} from './profession_identity_view';

// Display cap for a craft's skill bar. Craft skill is additive and uncapped in
// the sim (wheel.ts gainCraftSkill) and content defines no craft-side cap
// constant, so this is presentational only, following the classic 1-300
// profession scale the gathering defs pin (content/professions.ts maxSkill):
// pip slot count and the 'max' next-unlock state derive from it.
export const CRAFT_MAX_SKILL = 300;

// ---------------------------------------------------------------------------
// Skill bar + tier pips (shared by the ten craft rows and the gathering rows).
// ---------------------------------------------------------------------------

export interface SkillBarModel {
  skill: number;
  maxSkill: number;
  /** ceil(maxSkill / TIER_SKILL_STEP); 300 gives 12. */
  pipSlots: number;
  /** Whole tiers earned, capped at pipSlots (sim skill is uncapped). */
  filledPips: number;
  tierIndex: number;
  /** 0..1 progress within the current pip toward the next tier; 0 at max. */
  tierFraction: number;
  /** 0..1 overall bar fill (skill clamped to maxSkill); painters render width from this. */
  fillFraction: number;
  pointsToNextTier: number;
}

export function buildSkillBar(skill: number, maxSkill: number): SkillBarModel {
  const pipSlots = Math.ceil(maxSkill / TIER_SKILL_STEP);
  const tierIndex = tierForSkill(skill);
  const remainder = skill % TIER_SKILL_STEP;
  return {
    skill,
    maxSkill,
    pipSlots,
    filledPips: Math.min(tierIndex, pipSlots),
    tierIndex,
    tierFraction: skill >= maxSkill ? 0 : remainder / TIER_SKILL_STEP,
    fillFraction: Math.min(1, skill / maxSkill),
    pointsToNextTier: TIER_SKILL_STEP - remainder,
  };
}

// ---------------------------------------------------------------------------
// Per-craft next-unlock line. A discriminated union on purpose: Phases 9/10
// enrich what a crossing changes without a model-shape change.
// ---------------------------------------------------------------------------

export type CraftNextUnlock =
  | { kind: 'tier'; targetTier: number; pointsRemaining: number }
  | { kind: 'specialized'; pointsRemaining: number; materialDiscountPct: number }
  | { kind: 'max' };

/** The nearest milestone ahead of `skill` in `craftId`: the next tier pip (the
 *  masterwork-odds step), the specialization threshold when that is the next
 *  boundary crossed (its perks), or 'max' at the display cap. */
export function craftNextUnlock(craftId: string, skill: number): CraftNextUnlock {
  if (skill >= CRAFT_MAX_SKILL) return { kind: 'max' };
  const threshold = perkThresholdFor(craftId);
  const nextTierBoundary = (tierForSkill(skill) + 1) * TIER_SKILL_STEP;
  if (
    skill < threshold.specializedSkillThreshold &&
    threshold.specializedSkillThreshold <= nextTierBoundary
  ) {
    return {
      kind: 'specialized',
      pointsRemaining: threshold.specializedSkillThreshold - skill,
      materialDiscountPct: threshold.materialDiscountPct,
    };
  }
  return {
    kind: 'tier',
    targetTier: tierForSkill(skill) + 1,
    pointsRemaining: nextTierBoundary - skill,
  };
}

// ---------------------------------------------------------------------------
// Specialization perks readout. rechargeDiscountPct is deliberately absent:
// that is the parked tools half, not part of this window's readout.
// ---------------------------------------------------------------------------

export interface CraftPerksModel {
  specialized: boolean;
  specializedSkillThreshold: number;
  materialDiscountPct: number;
  /** 1 until specialized, then 1 - materialDiscountPct (wheel.ts). */
  materialCostMultiplier: number;
}

function perkThresholdFor(craftId: string) {
  const threshold = PERK_THRESHOLDS[craftId];
  if (!threshold) throw new Error(`no perk threshold registered for craft id: ${craftId}`);
  return threshold;
}

function craftPerks(skills: CraftSkills, craftId: string): CraftPerksModel {
  const threshold = perkThresholdFor(craftId);
  return {
    specialized: isSpecialized(skills, craftId),
    specializedSkillThreshold: threshold.specializedSkillThreshold,
    materialDiscountPct: threshold.materialDiscountPct,
    materialCostMultiplier: materialCostMultiplier(skills, craftId),
  };
}

// ---------------------------------------------------------------------------
// Ring layout math: ten unit-circle nodes in CRAFT_RING order, evenly spaced
// by index angle (the painter scales and centers).
// ---------------------------------------------------------------------------

export const RING_STEP_ANGLE = (2 * Math.PI) / CRAFT_RING.length;

export interface RingNode {
  craftId: string;
  index: number;
  angle: number;
  x: number;
  y: number;
}

export function ringNodePositions(): RingNode[] {
  return CRAFT_RING.map((craft, index) => {
    const angle = index * RING_STEP_ANGLE;
    return { craftId: craft.id, index, angle, x: Math.cos(angle), y: Math.sin(angle) };
  });
}

/** The minor arc spanning the two ring-adjacent majors, wrap-safe (9 -> 0
 *  yields endAngle 2*PI, never 0). */
export interface RingArc {
  aIndex: number;
  bIndex: number;
  startAngle: number;
  endAngle: number;
}

/** The chord from the hobby craft to the craft it sits opposite on the ring
 *  (one of the majors for any canonical hobby choice). */
export interface RingChord {
  hobbyIndex: number;
  oppositeIndex: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RingLayout {
  /** Ten nodes, CRAFT_RING order. */
  nodes: RingNode[];
  pairArc: RingArc | null;
  hobbyChord: RingChord | null;
}

export function buildRingLayout(
  majors: [string, string] | null,
  hobbyCraft: string | null,
): RingLayout {
  const nodes = ringNodePositions();
  const size = CRAFT_RING.length;
  const indexOf = (id: string) => CRAFT_RING.findIndex((craft) => craft.id === id);
  let pairArc: RingArc | null = null;
  if (majors) {
    const ai = indexOf(majors[0]);
    const bi = indexOf(majors[1]);
    // Attuned pairs are always ring-adjacent; anything else stays null.
    const start =
      ai >= 0 && (ai + 1) % size === bi ? ai : bi >= 0 && (bi + 1) % size === ai ? bi : -1;
    if (start >= 0) {
      pairArc = {
        aIndex: start,
        bIndex: (start + 1) % size,
        startAngle: start * RING_STEP_ANGLE,
        endAngle: (start + 1) * RING_STEP_ANGLE,
      };
    }
  }
  let hobbyChord: RingChord | null = null;
  if (hobbyCraft) {
    const hobbyIndex = indexOf(hobbyCraft);
    if (hobbyIndex >= 0) {
      const oppositeIndex = indexOf(oppositeCraft(hobbyCraft).id);
      const from = nodes[hobbyIndex];
      const to = nodes[oppositeIndex];
      hobbyChord = { hobbyIndex, oppositeIndex, x1: from.x, y1: from.y, x2: to.x, y2: to.y };
    }
  }
  return { nodes, pairArc, hobbyChord };
}

// ---------------------------------------------------------------------------
// The window model.
// ---------------------------------------------------------------------------

export interface GatheringSkillInput {
  professionId: string;
  skill: number;
  maxSkill: number;
}

export interface ProfessionsViewInput {
  identity: CraftingIdentityView;
  /** Injected gathering rows (today mining/logging/herbalism via
   *  professionsState); nothing here hardcodes the id set, so Phase 11's
   *  fishing row flows through unchanged. */
  gathering: readonly GatheringSkillInput[];
}

export interface ProfessionsCraftRow {
  /** The composed identity row: role, ceiling, dormantKnowledge survive as-is. */
  identity: ProfessionSkillRow;
  bar: SkillBarModel;
  perks: CraftPerksModel;
  nextUnlock: CraftNextUnlock;
}

export interface ProfessionsGatheringRow {
  professionId: string;
  bar: SkillBarModel;
}

export interface SwitchCostModel {
  returnCount: number;
  amendsProgress: number;
  amendsRequired: number;
  /** Client-computed at rest, display-only: requiredAmendsProgress(returnCount). */
  nextSwitchCost: number;
}

export type ProfessionsWindowMode = 'simplified' | 'full';

/** The copy decision for the one call-to-action line, derived in the core so
 *  both worlds' tests pin it: 'raise' once the trending craft has any skill
 *  and a milestone ahead, 'start' otherwise. `points` always equals the
 *  distance to the next tier boundary: the specialized threshold only wins in
 *  craftNextUnlock when it coincides with that boundary. */
export type SimplifiedCta = { kind: 'raise'; craftId: string; points: number } | { kind: 'start' };

export interface SimplifiedCallToAction {
  /** Highest-skill craft, ties broken by ring order. */
  trendingCraftId: string;
  nextUnlock: CraftNextUnlock;
  cta: SimplifiedCta;
  /** The identity tutorial line, promoted ({ targetSkill: 25 } pre-first-tier). */
  tutorial: { targetSkill: number } | null;
}

export interface ProfessionsViewModel {
  /** 'simplified' when syncing, or unattuned with no craft at tier 1 yet;
   *  'full' at first tier or attunement. */
  mode: ProfessionsWindowMode;
  identity: ProfessionIdentityModel;
  /** Ten rows, CRAFT_RING order (same order as identity.skills). */
  crafts: ProfessionsCraftRow[];
  /** Injected order preserved. */
  gathering: ProfessionsGatheringRow[];
  ring: RingLayout;
  switchCost: SwitchCostModel;
  /** Non-null iff mode is 'simplified'. */
  simplified: SimplifiedCallToAction | null;
}

function buildSimplifiedCallToAction(identity: ProfessionIdentityModel): SimplifiedCallToAction {
  let trending = identity.skills[0];
  for (const row of identity.skills) {
    if (row.skill > trending.skill) trending = row;
  }
  const nextUnlock = craftNextUnlock(trending.craftId, trending.skill);
  const cta: SimplifiedCta =
    trending.skill > 0 && nextUnlock.kind !== 'max'
      ? { kind: 'raise', craftId: trending.craftId, points: nextUnlock.pointsRemaining }
      : { kind: 'start' };
  return {
    trendingCraftId: trending.craftId,
    nextUnlock,
    cta,
    tutorial: identity.tutorial,
  };
}

export function buildProfessionsView(input: ProfessionsViewInput): ProfessionsViewModel {
  const identity = buildProfessionIdentityView(input.identity);
  // One mutable copy for the wheel.ts perk reads (their param type is the live
  // CraftSkills record; the identity view spreads the same way).
  const skills: CraftSkills = { ...input.identity.craftSkills };
  const crafts = identity.skills.map(
    (row): ProfessionsCraftRow => ({
      identity: row,
      bar: buildSkillBar(row.skill, CRAFT_MAX_SKILL),
      perks: craftPerks(skills, row.craftId),
      nextUnlock: craftNextUnlock(row.craftId, row.skill),
    }),
  );
  const gathering = input.gathering.map(
    (row): ProfessionsGatheringRow => ({
      professionId: row.professionId,
      bar: buildSkillBar(row.skill, row.maxSkill),
    }),
  );
  const anyTier = identity.skills.some((row) => row.tier >= 1);
  const mode: ProfessionsWindowMode =
    identity.state === 'syncing' || (identity.state !== 'attuned' && !anyTier)
      ? 'simplified'
      : 'full';
  return {
    mode,
    identity,
    crafts,
    gathering,
    ring: buildRingLayout(identity.summary.majors, identity.summary.hobbyCraft),
    switchCost: {
      returnCount: identity.summary.returnCount,
      amendsProgress: input.identity.amendsProgress,
      amendsRequired: input.identity.amendsRequired,
      nextSwitchCost: requiredAmendsProgress(input.identity.switchCount),
    },
    simplified: mode === 'simplified' ? buildSimplifiedCallToAction(identity) : null,
  };
}

// ---------------------------------------------------------------------------
// Window refresh signature (the deedsRefreshSig idiom): the compact key the
// cold painter's slow-band refresh diffs. Covers every repaint dimension the
// model derives from; craftSkills is enumerated in CRAFT_RING order so record
// key order can never move the signature. `local` is the painter's slot for
// UI-local dimensions (selected craft, tab), appended verbatim.
// ---------------------------------------------------------------------------

export function professionsRefreshSig(
  input: ProfessionsViewInput,
  local: readonly (string | number | boolean | null)[] = [],
): string {
  const id = input.identity;
  return JSON.stringify([
    id.synced,
    id.activeArchetype,
    id.pairedMajor,
    id.hobbyCraft,
    [...id.attunedPairs],
    id.switchCount,
    id.amendsProgress,
    id.amendsRequired,
    CRAFT_RING.map((craft) => id.craftSkills[craft.id] ?? 0),
    input.gathering.map((row) => [row.professionId, row.skill, row.maxSkill]),
    [...local],
  ]);
}
