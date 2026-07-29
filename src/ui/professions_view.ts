// Professions wheel window view core (Professions 2.0): the pure model
// behind the read-only professions window. COMPOSES the PR 2039 identity view
// (profession_identity_view.ts) rather than absorbing it, because the crafting
// window and quest dialogs keep consuming that module directly; the full
// ProfessionIdentityModel embeds here unchanged, so every identity semantic
// (per-craft role, ceiling, nudges, tutorial state) survives into this model.
// Registered in UI_PURE_CORES (tests/architecture.test.ts): no DOM, no t(), no
// render/game/net imports. Per-call allocation is fine: the window is cold
// (event-driven), never per-frame.

import {
  CRAFT_RING,
  craftMaxSkillFor,
  oppositeCraft,
  PERK_THRESHOLDS,
  TOOL_EFFECT_IDS,
  TOOL_EFFECTS,
  type ToolEffectId,
} from '../sim/content/professions';
import { ITEMS } from '../sim/data';
import { requiredAmendsProgress } from '../sim/professions/archetype';
import {
  resolveRechargeToolEffect,
  resolveSlotToolEffect,
  type ToolEffectSlot,
} from '../sim/professions/tools';
import {
  type CraftSkills,
  isSpecialized,
  materialCostMultiplier,
  TIER_SKILL_STEP,
  tierForSkill,
} from '../sim/professions/wheel';
import type { InvSlot } from '../sim/types';
import type { CraftingIdentityView } from '../world_api/professions';
import {
  buildProfessionIdentityView,
  type ProfessionIdentityModel,
  type ProfessionSkillRow,
} from './profession_identity_view';

// ---------------------------------------------------------------------------
// Skill bar + tier pips (shared by the ten craft rows and the gathering rows).
// Craft rows read the ENFORCED per-profession content cap
// (content/professions.ts craftMaxSkillFor); pip slot count and
// the 'mastered' next-unlock state derive from it. The old display-only
// CRAFT_MAX_SKILL 300 constant is retired.
// ---------------------------------------------------------------------------

export interface SkillBarModel {
  skill: number;
  maxSkill: number;
  /** ceil(maxSkill / TIER_SKILL_STEP); the 125 craft cap gives 5. */
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
    // Fractional mastery gains never round a threshold forward on a readout:
    // the displayed skill floors (74.75 reads 74, not a fake crossed 75) and
    // the points-to-go ceils (0.25 left reads 1, never 0). Fractions still
    // drive the exact bar/pip geometry below.
    skill: Math.floor(skill),
    maxSkill,
    pipSlots,
    filledPips: Math.min(tierIndex, pipSlots),
    tierIndex,
    tierFraction: skill >= maxSkill ? 0 : remainder / TIER_SKILL_STEP,
    fillFraction: Math.min(1, skill / maxSkill),
    pointsToNextTier: Math.ceil(TIER_SKILL_STEP - remainder),
  };
}

// ---------------------------------------------------------------------------
// Per-craft next-unlock line. A discriminated union on purpose: Phases 9/10
// enrich what a crossing changes without a model-shape change.
// ---------------------------------------------------------------------------

export type CraftNextUnlock =
  | { kind: 'tier'; targetTier: number; pointsRemaining: number }
  | { kind: 'specialized'; pointsRemaining: number; materialDiscountPct: number }
  | { kind: 'mastered' };

/** The nearest milestone ahead of `skill` in `craftId`: the next tier pip (the
 *  masterwork-odds step), the specialization threshold when that is the next
 *  boundary crossed (its perks), or 'mastered' at the enforced content cap
 *  (craftMaxSkillFor): no unreachable next-tier carrot past where shipped
 *  content ends. */
export function craftNextUnlock(craftId: string, skill: number): CraftNextUnlock {
  if (skill >= craftMaxSkillFor(craftId)) return { kind: 'mastered' };
  const threshold = perkThresholdFor(craftId);
  const nextTierBoundary = (tierForSkill(skill) + 1) * TIER_SKILL_STEP;
  if (
    skill < threshold.specializedSkillThreshold &&
    threshold.specializedSkillThreshold <= nextTierBoundary
  ) {
    return {
      kind: 'specialized',
      // ceil: fractional gains never advertise an uncrossed threshold as 0 away.
      pointsRemaining: Math.ceil(threshold.specializedSkillThreshold - skill),
      materialDiscountPct: threshold.materialDiscountPct,
    };
  }
  return {
    kind: 'tier',
    targetTier: tierForSkill(skill) + 1,
    pointsRemaining: Math.ceil(nextTierBoundary - skill),
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
   *  professionsState); nothing here hardcodes the id set, so the
   *  fishing row flows through unchanged. */
  gathering: readonly GatheringSkillInput[];
  /** The viewer's slotted tool effects (IWorld `toolEffectSlots`), keyed to a
   *  gathering row by professionId. Injected as the flat seam list rather than
   *  pre-joined, so this core owns the join and a Vitest can drive it with a
   *  row that has no matching profession. Empty for every player who has never
   *  slotted an effect.
   *
   *  REQUIRED rather than optional: there is one production caller, so
   *  optionality bought nothing and cost the compile-time proof. A second
   *  caller that forgot the field would silently paint no effect row instead
   *  of failing tsc. */
  toolEffects: readonly {
    professionId: string;
    effectId: string;
    charges: number;
    maxCharges: number;
    confirmMode: 'always' | 'prompt';
    /** Whether the slot's recorded crafter is the VIEWER (the tslot
     *  projection's privacy-preserving boolean; the name itself never
     *  crosses). Sufficient for exact resolver parity because the R48
     *  directional no_gain arm only ever compares `craftedBy` against the
     *  slotter's own name. */
    selfCrafted: boolean;
  }[];
  /** The viewer's bags (IWorld `inventory`): the slot and recharge
   *  affordances derive from the SAME resolvers the sim's commands run
   *  (resolveSlotToolEffect / resolveRechargeToolEffect over this list), so
   *  a button this window shows is exactly an action the server accepts.
   *  REQUIRED for the same compile-time-proof reason as `toolEffects`. */
  inventory: readonly InvSlot[];
  /** The viewer's own character name (IWorld `player.name`): threaded into
   *  resolveSlotToolEffect as the slotter, so the consume-copy preference
   *  and the R48 provenance arm evaluate exactly as the server will. */
  viewerName: string;
  /** Profession ids whose "Ask each use" toggle is ON (painter-local UI
   *  state, R40): the slot affordance asks the resolver with the mode the
   *  button will actually SEND, so a same-effect re-slot that only changes
   *  the confirm mode renders its button exactly when the server would
   *  accept it (the no_gain mode conjunct). Omitted reads as none. */
  slotModePrompt?: readonly string[];
}

export interface ProfessionsCraftRow {
  /** The composed identity row: role, ceiling, dormantKnowledge survive as-is. */
  identity: ProfessionSkillRow;
  bar: SkillBarModel;
  perks: CraftPerksModel;
  nextUnlock: CraftNextUnlock;
}

/** The slotted tool effect a gathering row shows, already reduced to what the
 *  row paints. `null` on a profession with no slot. */
export interface GatheringToolEffectModel {
  /** A ToolEffectId; the row resolves its display name from the catalog. */
  effectId: string;
  charges: number;
  maxCharges: number;
  /** True once the charges are spent: the bonus stops, the base tool is
   *  untouched, and a recharge can restore it. The row says "spent" rather
   *  than showing a bare 0, because 0 of 30 reads like a broken tool. */
  spent: boolean;
  /** True when the recharge command would accept right now, derived through
   *  the sim's own resolveRechargeToolEffect over the viewer's mirrored bags
   *  (a real tool owned, charges below the R30 re-derived maximum). The
   *  button never second-guesses the resolver, so it cannot offer an action
   *  the server refuses. */
  rechargeable: boolean;
  /** The slot's live confirm mode (R40): 'prompt' rows chip "Asks each use"
   *  so the per-use dialog never surprises. */
  confirmMode: 'always' | 'prompt';
  /** The recharge cost preview (the UX pass, the phase 12 QA hand-off):
   *  the priced material, count, and charges restored for the fill the
   *  resolver would perform RIGHT NOW, present exactly when `rechargeable`.
   *  Resolved with the viewer's REAL craft skills, so the specialization
   *  discount previews at its true count, and re-derived per repaint, which
   *  is what makes the blind marginal top-up visible: at 49 of 50 the
   *  ceil-priced count still reads one full material for one charge. */
  recharge?: { materialItemId: string; count: number; restored: number };
}

export interface ProfessionsGatheringRow {
  professionId: string;
  bar: SkillBarModel;
  /** ONE effect per profession, never a list: the slot is keyed per gathering
   *  profession rather than per tool, so a player owning two picks shares one
   *  mining slot. */
  effect: GatheringToolEffectModel | null;
  /** Effect ids of crafted charms in bags this row can slot RIGHT NOW,
   *  derived through the sim's own resolveSlotToolEffect (charm held, real
   *  tool owned, policy accepts the pair), in TOOL_EFFECT catalog order.
   *  Empty for a charm-less or tool-less row; re-slotting an already-slotted
   *  effect stays offered (it consumes another charm and resets to full). */
  slottable: readonly string[];
}

export interface SwitchCostModel {
  returnCount: number;
  amendsProgress: number;
  amendsRequired: number;
  /** Client-computed at rest, display-only: requiredAmendsProgress(returnCount). */
  nextSwitchCost: number;
  /** Whether the switch-cost line renders at all: a player who has NEVER
   *  attuned (attunedPairs empty) has no archetype to switch from, so the
   *  "next switch costs N amends" line is noise until the first
   *  attunement. */
  show: boolean;
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
    trending.skill > 0 && nextUnlock.kind !== 'mastered'
      ? { kind: 'raise', craftId: trending.craftId, points: nextUnlock.pointsRemaining }
      : { kind: 'start' };
  return {
    trendingCraftId: trending.craftId,
    nextUnlock,
    cta,
    tutorial: identity.tutorial,
  };
}

/** Distinct effect ids of tool-effect charms in bags, in TOOL_EFFECT_IDS
 *  catalog order: the candidate set the per-row slot affordance filters
 *  through the resolver. Catalog order rather than bag order on purpose, so
 *  the buttons do not reshuffle when the player moves items around. Pure bag
 *  scan. */
function heldCharmEffectIds(inventory: readonly InvSlot[]): string[] {
  const held = new Set<string>();
  for (const entry of inventory) {
    const use = ITEMS[entry.itemId]?.use;
    if (use?.type === 'toolEffect') held.add(use.effectId);
  }
  return TOOL_EFFECT_IDS.filter((effectId) => held.has(effectId));
}

/** A wire slot row as the sim-side `ToolEffectSlot` the resolvers read.
 *  Undefined for an absent row or one naming an effect this build's catalog
 *  retired (the unknown-id doctrine: the resolvers index TOOL_EFFECTS, so a
 *  stale id must never reach them from a projection).
 *
 *  `craftedBy` is synthesized from the projection's privacy-preserving
 *  `selfCrafted` boolean: the viewer's own name when self-crafted, undefined
 *  otherwise. That is EXACT for every resolver decision, because the R48
 *  directional no_gain arm only ever compares `craftedBy` against the
 *  slotter's own name (a foreign name and no name behave identically), and
 *  the discount half never gates ok/deny. */
function liveSlotFor(
  row: ProfessionsViewInput['toolEffects'][number] | undefined,
  viewerName: string,
): ToolEffectSlot | undefined {
  if (!row || !Object.hasOwn(TOOL_EFFECTS, row.effectId)) return undefined;
  return {
    effectId: row.effectId as ToolEffectId,
    durability: row.charges,
    maxDurability: row.maxCharges,
    ...(row.selfCrafted ? { craftedBy: viewerName } : {}),
    confirmMode: row.confirmMode,
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
      bar: buildSkillBar(row.skill, craftMaxSkillFor(row.craftId)),
      perks: craftPerks(skills, row.craftId),
      nextUnlock: craftNextUnlock(row.craftId, row.skill),
    }),
  );
  // Join the flat effect list onto the gathering rows by profession id. An
  // effect naming a profession with no row is DROPPED rather than rendered
  // loose: the row is the only place a slot is meaningful, and a stray entry
  // would otherwise paint an orphan line with no skill bar above it.
  const effectByProfession = new Map(
    (input.toolEffects ?? []).map((row) => [row.professionId, row]),
  );
  const heldEffectIds = heldCharmEffectIds(input.inventory);
  const gathering = input.gathering.map((row): ProfessionsGatheringRow => {
    const slot = effectByProfession.get(row.professionId);
    return {
      professionId: row.professionId,
      bar: buildSkillBar(row.skill, row.maxSkill),
      effect: slot
        ? {
            effectId: slot.effectId,
            charges: slot.charges,
            maxCharges: slot.maxCharges,
            spent: slot.charges <= 0,
            confirmMode: slot.confirmMode,
            // The recharge affordance asks the sim's own resolver over the
            // mirrored bags: a slot-shaped view row carries everything the
            // ok/deny half of the resolution reads (the recharger identity
            // and skills only move the COUNT, so placeholders are honest).
            // The hasOwn guard is the unknown-id doctrine: a row naming an
            // effect this build's catalog lacks renders un-rechargeable
            // instead of throwing mid-paint (the resolver's charge math
            // indexes the catalog).
            ...(() => {
              const live = liveSlotFor(slot, input.viewerName);
              // The one resolver call now feeds BOTH the affordance and the
              // cost preview (the UX pass): viewerName decides the
              // original-crafter half of the discount, and the viewer's
              // REAL craft skills decide the specialization half, so the
              // previewed count is the count the command would charge.
              const resolved =
                live !== undefined
                  ? resolveRechargeToolEffect(
                      input.inventory,
                      row.professionId,
                      live,
                      input.viewerName,
                      input.identity.craftSkills,
                      ITEMS,
                    )
                  : undefined;
              return resolved?.ok
                ? {
                    rechargeable: true,
                    recharge: {
                      materialItemId: resolved.materialItemId,
                      count: resolved.count,
                      restored: resolved.restored,
                    },
                  }
                : { rechargeable: false };
            })(),
          }
        : null,
      // The slot affordance asks the SAME resolver the command runs, per held
      // charm effect, with the SAME inputs: the live slot (craftedBy
      // synthesized from the selfCrafted projection) and the viewer's own
      // name as the slotter, so the consume-copy preference and the R48
      // provenance arm evaluate exactly as the server will. One authority
      // with its inputs threaded whole is what makes the contract real: the
      // button set cannot drift from what the server accepts, and a re-slot
      // the resolver would refuse as no-gain never renders a button at all.
      slottable: heldEffectIds.filter(
        (effectId) =>
          resolveSlotToolEffect(
            input.inventory,
            row.professionId,
            effectId,
            // The mode the button will actually send (R40): with the row's
            // "Ask each use" toggle on, a same-effect re-slot that only
            // changes the mode is a gain and must render its button.
            input.slotModePrompt?.includes(row.professionId) ? 'prompt' : 'always',
            ITEMS,
            input.viewerName,
            liveSlotFor(slot, input.viewerName),
          ).ok,
      ),
    };
  });
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
      show: input.identity.attunedPairs.length > 0,
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
    // The slot rows ride the signature too, so spending a charge on a harvest
    // repaints the row. Without this the count would freeze at whatever it read
    // when some OTHER field last moved the signature.
    //
    // Note this hashes EVERY slot row, including one the join above drops for
    // naming a profession with no gathering row. A charge spent on such a slot
    // therefore moves the signature and triggers a rebuild that changes nothing
    // visible. Bounded (at most a handful of gathering professions, on the cold
    // 500 ms band) and deliberately not filtered: the alternative couples the
    // signature to the join's drop rule, and a signature that can MISS a repaint
    // is a worse failure than one that occasionally does a spare one.
    (input.toolEffects ?? []).map((row) => [
      row.professionId,
      row.effectId,
      row.charges,
      row.maxCharges,
      row.confirmMode,
      // The R48 provenance projection feeds the slot affordance, so a
      // provenance change (an upgrade re-slot landing) repaints the buttons.
      row.selfCrafted,
    ]),
    // The slot/recharge affordances derive from the charms and gathering
    // tools in bags (plus the charge counts above), so those inventory rows
    // ride the signature: buying a charm, crafting a better pick, or spending
    // the last copy repaints the buttons. Filtered to the two use kinds the
    // resolvers actually read, so ordinary loot churn does not thrash the
    // rebuild. The signer rides each tuple because the consume-copy
    // preference reads it: trading a self-signed copy for a foreign-signed
    // one at the same id and count must move the affordance.
    input.inventory
      .filter((entry) => {
        const use = ITEMS[entry.itemId]?.use;
        return use !== undefined && (use.type === 'toolEffect' || use.type === 'gatherTool');
      })
      .map((entry) => [entry.itemId, entry.count, entry.instance?.signer ?? '']),
    // The slotter identity itself: a rename moves every name-derived
    // affordance in one repaint.
    input.viewerName,
    // The R40 "Ask each use" toggles: the slottable set asks the resolver
    // with the mode the button will send, so flipping a toggle can change
    // which buttons exist and must repaint. Sorted: set order is not a
    // repaint dimension.
    [...(input.slotModePrompt ?? [])].sort(),
    [...local],
  ]);
}
