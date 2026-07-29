// Gathering profession proficiency: state shape + gain logic, behind the
// SimContext seam. The backing counters live on PlayerMeta (sim.ts); this
// module holds the pure functions. Each gathering profession is an
// independent, additive counter: granting one never touches another (no
// shared/conserved pool). Proficiency producers: world-node harvests
// (resolveHarvest below, via the harvestNode command) and the
// ALLOW_DEV_COMMANDS `/dev gather` chat cheat (src/sim/social/chat.ts). Both
// QUEUE a grant here; the queue is drained once per player during the normal
// 20 Hz tick loop (sim.ts `tick()`, next to `updateRested`), so a grant only
// ever takes effect on the deterministic tick path, never out of band.

import { bagCapacity, bagsFullError, countFit } from '../bags';
import { isActionLockingFormAuraKind } from '../combat/forms';
import { GATHER_NODES } from '../content/gather_nodes';
import {
  GATHERING_PROFESSION_IDS,
  GATHERING_PROFESSIONS,
  type GatheringProfessionId,
  HARVEST_COMPONENT_ITEMS,
  TOOL_EFFECTS,
} from '../content/professions';
import { ITEMS } from '../data';
import { forceDismount } from '../mounts';
import type { Rng } from '../rng';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  type Entity,
  GATHER_CAST_ID,
  type GatherNodeDef,
  type GatherNodeType,
  type GatherRareEventFlavor,
  INTERACT_RANGE,
  type InvSlot,
  type ItemDef,
  isConsuming,
} from '../types';
import {
  announceGatherRareEvent,
  GATHER_RARE_EVENT_YIELD_MULT,
  rollGatherRareEvent,
} from './gather_events';
import { fineGradeReachable, harvestGradeItemId } from './material_grades';
import { gatherActionXp } from './profession_xp';
import { proficiencyBandFor } from './proficiency_bands';
import {
  applyToolEffectUse,
  bestOwnedGatherToolFor,
  canGatherTier,
  depleteEffect,
  NO_TOOL_OWNED,
  ratchetCeilingForUse,
  type ToolEffectSlot,
} from './tools';
import type { PlayerProfessionSkill } from './types';
import { tierProgressMultiplier } from './wheel';
import { bestWieldableGatherToolTierOrNone, minWieldRequirementToWork } from './wield_gate';

export type GatheringProficiency = Record<GatheringProfessionId, number>;

// Per-node harvest tuning (#1121). Each node type maps to one gathering
// profession (one proficiency point per harvest) and a per-player respawn
// timer. Which material item a harvest grants is zone-dependent and lives in
// NODE_MATERIAL_TABLE below (Professions 2.0); the former
// placeholder junk grants (bone_fragments/linen_scrap/spider_leg) are gone,
// but those items themselves survive (recipes consume them, players hold
// them): only their node source went away.
//
// respawnSeconds is 240 and moved there together with the node count, which
// doubled to six per type per zone across the TUNED strip zones
// (content/gather_nodes.ts; the v0.32.0 expansion zones ship two starter
// nodes per type instead, their ceilings deliberately starter-kit per R37
// until the zone-4 design pass re-tiers them). The pair
// is one change and has to stay one within that tuned set: the per-zone
// ceiling is nodes * 3600 / respawn,
// so 9 nodes at 120 seconds and 18 at 240 are the same 270 harvests an hour,
// and Mirefen and Thornpeak (12 nodes at 120, 360 an hour) come DOWN onto that
// same figure rather than up. What the pair buys is circuit length: every zone
// circuit used to be shorter than the respawn, so a gathering session was spent
// standing at a node already worked. Raising respawn alone would have cut the
// ceiling; adding nodes alone would have raised it. Neither is the goal.
export const NODE_HARVEST_TABLE: Record<
  GatherNodeType,
  { professionId: GatheringProfessionId; respawnSeconds: number }
> = {
  ore: { professionId: 'mining', respawnSeconds: 240 },
  wood: { professionId: 'logging', respawnSeconds: 240 },
  herb: { professionId: 'herbalism', respawnSeconds: 240 },
};

// Every material row yields this many units per rolled rarity (one
// shared curve; a per-family tune may diverge later if playtests want it).
// Frozen because every NODE_MATERIAL_TABLE row shares this one object: a
// per-family tune must clone it per row, never mutate it in place.
const MATERIAL_QTY_BY_RARITY: Record<MaterialRarity, number> = Object.freeze({
  common: 1,
  uncommon: 2,
  rare: 2,
  epic: 3,
  legendary: 4,
});

// Zone x node-type material matrix (Professions 2.0): which item a
// harvest grants in which zone, and the per-rarity unit counts. The zone-1
// (eastbrook_vale) rows grant ONLY the dedicated starter-material FAMILIES
// (copper_ore/ironbark_log/silverleaf_herb), never the premium vendor
// reagents: that is the stockpiling mitigation, scoped to what it actually
// buys since D8: an out-tooled gatherer harvests the sellValue-8 FINE grade
// of these same families here, so starter-node farming yields fine starter
// materials, still never the mid-tier vendor reagents the mitigation
// exists to keep off this faucet. Exported so tests can pin the table
// contents.
export const NODE_MATERIAL_TABLE: Record<
  GatherNodeType,
  Record<string, { itemId: string; qtyByRarity: Record<MaterialRarity, number> }>
> = {
  ore: {
    eastbrook_vale: { itemId: 'copper_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    mirefen_marsh: { itemId: 'iron_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    thornpeak_heights: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    veiled_hollow: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    drakelands: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    frostveil: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    amberfall: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    willowfen: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    nightbloom: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    wraithwood: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    galecrest: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    palmreach: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    evergarden: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    farshore_isle: { itemId: 'iron_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
  },
  wood: {
    eastbrook_vale: { itemId: 'ironbark_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    mirefen_marsh: { itemId: 'ashwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    thornpeak_heights: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    veiled_hollow: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    drakelands: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    frostveil: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    amberfall: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    willowfen: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    nightbloom: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    wraithwood: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    galecrest: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    palmreach: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    evergarden: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    farshore_isle: { itemId: 'ashwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
  },
  herb: {
    eastbrook_vale: { itemId: 'silverleaf_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    mirefen_marsh: { itemId: 'goldleaf_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    thornpeak_heights: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    veiled_hollow: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    drakelands: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    frostveil: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    amberfall: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    willowfen: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    nightbloom: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    wraithwood: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    galecrest: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    palmreach: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    evergarden: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    farshore_isle: { itemId: 'goldleaf_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
  },
};

// The material row for one node type in one zone. A zone without its own row
// (a future zone added before its material content lands) falls back to the
// eastbrook_vale starter row rather than throwing: degraded yields, never a
// broken harvest.
export function nodeMaterialFor(
  type: GatherNodeType,
  zoneId: string,
): { itemId: string; qtyByRarity: Record<MaterialRarity, number> } {
  const byZone = NODE_MATERIAL_TABLE[type];
  // Bare index on purpose, unlike rodTierRequiredForZone's Object.hasOwn:
  // zoneId here is static GATHER_NODES content, never a map-doc-authored
  // string, so a prototype key cannot reach this lookup.
  return byZone[zoneId] ?? byZone.eastbrook_vale;
}

/** The item id a harvest of `node` grants a player whose best matching tool is
 *  `usableToolTier`: the zone row's material, upgraded to its fine grade when
 *  that tool outclasses the material at a full-grade vein (D8, the rule and
 *  its two arms live in professions/material_grades.ts). Signature kept
 *  separate from nodeMaterialFor, whose (type, zoneId) shape is depended on by
 *  the quest-objective and placement suites and carries no player. */
export function harvestYieldItemIdFor(node: GatherNodeDef, usableToolTier: number): string {
  return harvestGradeItemId(
    nodeMaterialFor(node.type, node.zoneId).itemId,
    node.tier,
    usableToolTier,
  );
}

/** The same resolution from a player's bags. One pure bag scan, no rng, so
 *  every caller can ask BEFORE drawing: the capacity pre-gates at both ends of
 *  the cast and the grant itself all resolve the id this way, and they must
 *  agree or a pre-gate would clear room for an item the grant does not mint.
 *  `effectUseConfirmed` is the R40 consent the pre-gates thread through so an
 *  unconfirmed 'prompt' cast reserves room for the BASE grade the grant will
 *  actually mint; readers outside a live command (the tooltip preview) keep
 *  the default and see the effect-assisted answer. */
export function harvestYieldItemId(
  meta: PlayerMeta,
  node: GatherNodeDef,
  effectUseConfirmed = true,
): string {
  const professionId = NODE_HARVEST_TABLE[node.type].professionId;
  return harvestYieldItemIdFor(
    node,
    effectiveGradeToolTier(meta, professionId, node, effectUseConfirmed),
  );
}

/** The subset of PlayerMeta the grade resolution reads, spelled out so the
 *  client-side tooltip preview can supply it too: the sim hands the full
 *  PlayerMeta (structurally assignable), the tooltip adapts the equivalent
 *  IWorld reads (bags, proficiency map, tool-effect slot rows). Loose string
 *  keying on the proficiency map is deliberate: the online mirror's map is
 *  Record<string, number>, and an absent profession coerces fail-closed to 0
 *  inside bestWieldableGatherToolTierOrNone either way. */
export interface GradeReadMeta {
  inventory: readonly InvSlot[];
  gatheringProficiency: Readonly<Record<string, number>>;
  toolEffectSlots?: Partial<Record<GatheringProfessionId, ToolEffectSlot>>;
}

/**
 * The slot the grant will actually RUN for a harvest of this node: a QUALITY
 * effect is suppressed outright (no charge spent, no bonus applied) where the
 * fine grade is categorically unreachable (the R9 zero-benefit refusal;
 * yieldsFineGrade demands node.tier at or above the material's rung, and the
 * v0.32.0 expansion's starter nodes sit below every rung 2+ material they
 * grant). Quantity effects always pay and pass through. Pure reads only.
 * The preview (`effectiveGradeToolTier`) and the grant (`resolveHarvest`)
 * both read THIS resolution: a second copy of the suppression rule is
 * exactly how a tooltip would come to advertise a bonus the grant refuses.
 */
export function usableToolEffectSlot(
  meta: GradeReadMeta,
  professionId: GatheringProfessionId,
  node: GatherNodeDef,
): ToolEffectSlot | undefined {
  const slot = meta.toolEffectSlots?.[professionId];
  const slotKind = slot ? TOOL_EFFECTS[slot.effectId]?.kind : undefined;
  const materialItemId = nodeMaterialFor(node.type, node.zoneId).itemId;
  return slotKind === 'quality' && !fineGradeReachable(materialItemId, node.tier)
    ? undefined
    : slot;
}

/**
 * The tool tier the FINE-GRADE comparison should read for this player at this
 * node: their best WIELDABLE tool (R22/R49, wield_gate.ts), plus whatever a
 * USABLE slotted quality effect adds (`usableToolEffectSlot` above owns
 * usability, so a suppressed slot previews no bonus either).
 *
 * Runs the bonus through `applyEffectBonus`, the same function the grant path
 * uses, rather than re-deriving "+1 if a quality effect is slotted" here. That
 * is deliberate: a second copy of a bonus rule is exactly how a tooltip once
 * promised a second the sim's clamp never gave. One definition, three live
 * readers (the capacity gates at both ends of the cast, through
 * harvestYieldItemId, the grant, and the grade-preview tooltip, which adapts
 * the IWorld reads into `GradeReadMeta` in src/ui/gathering_view.ts so the
 * preview and the grant literally share this function).
 *
 * Pure and draw-free, and it never spends a charge: spending belongs to the
 * grant alone (`resolveHarvest`), so asking what a harvest WOULD yield costs
 * the player nothing.
 */
export function effectiveGradeToolTier(
  meta: GradeReadMeta,
  professionId: GatheringProfessionId,
  node: GatherNodeDef,
  // The R40 consent: a 'prompt' slot contributes its bonus only when the use
  // is confirmed. Defaults true so out-of-command readers (the tooltip
  // preview, an 'always' world) see the effect-assisted answer; the capacity
  // pre-gates thread the live cast's captured value.
  effectUseConfirmed = true,
): number {
  // WIELDABLE, not owned (R49, the R22 grade arm): the fine-grade comparison
  // reads the same wield-filtered scan the access gate reads, so a traded
  // tier-4 tool a player cannot swing mints no fine grade either. The access
  // gate and this resolution moving together is the invariant; the ratchet
  // and recharge surfaces deliberately stay ownership-based (R47/R30, the
  // price family).
  const wieldable = bestWieldableGatherToolTierOrNone(
    meta.inventory,
    professionId,
    meta.gatheringProficiency[professionId],
    ITEMS,
  );
  // Through applyToolEffectUse rather than applyEffectBonus directly, so the
  // prompt-consent gate has ONE owner: the tier a pre-gate reserves for and
  // the tier the grant runs share the same confirmed/unconfirmed answer.
  return applyToolEffectUse(
    usableToolEffectSlot(meta, professionId, node),
    { quantity: 0, gradeToolTier: wieldable },
    effectUseConfirmed,
  ).outcome.gradeToolTier;
}

export function gatherNodeById(nodeId: string): GatherNodeDef | undefined {
  return GATHER_NODES.find((n) => n.id === nodeId);
}

// Material rarity roll (#1122): the standard item rarity ladder (ItemDef['quality'],
// src/sim/types.ts), minus 'poor' (a harvested material is never junk-grade). A
// gathering profession's proficiency shifts a harvest's rarity roll toward the
// higher tiers; a fresh proficiency-0 harvest always lands common.
export type MaterialRarity = Exclude<NonNullable<ItemDef['quality']>, 'poor'>;

// Proficiency is clamped to this ceiling before weighting: proficiency gains
// beyond this point buy no further rarity odds (the ladder is already maxed out).
export const MATERIAL_RARITY_MAX_PROFICIENCY = 100;

// Weight formula: at clamped proficiency p in [0, MATERIAL_RARITY_MAX_PROFICIENCY],
// each non-common tier's weight is p * its fixed share below, and common's weight is
// the remainder (MAX - p). The shares sum to exactly 1, so the total weight is always
// MATERIAL_RARITY_MAX_PROFICIENCY regardless of p: at p=0 the roll is 100% common; as
// p rises, weight moves linearly out of common and into the four tiers above it in
// this fixed proportion, so every non-common tier's weight (and therefore its roll
// probability) is non-decreasing in proficiency, satisfying the "more proficiency
// never hurts your odds" acceptance bar. Tuned so legendary stays rare even at max
// proficiency (2% at p=100) while uncommon becomes the single likeliest non-common
// outcome quickly.
export const MATERIAL_RARITY_SHARE: Record<Exclude<MaterialRarity, 'common'>, number> = {
  uncommon: 0.6,
  rare: 0.3,
  epic: 0.08,
  legendary: 0.02,
};

// Pure function of (proficiency, rng): rolls one material rarity for a harvest.
// Uses exactly one rng.next() draw, so it composes cleanly with the rest of the
// sim's one-draw-per-roll rng convention (see loot_roll.ts). Independent of node/
// harvest wiring: callable standalone, or from resolveHarvest (see below).
export function rollMaterialRarity(proficiency: number, rng: Rng): MaterialRarity {
  // NaN pins to 0 rather than surviving the clamp: every `NaN < w` comparison
  // below is false, so an unclamped NaN would fall through to legendary.
  const p = Number.isNaN(proficiency)
    ? 0
    : Math.max(0, Math.min(MATERIAL_RARITY_MAX_PROFICIENCY, proficiency));
  const weights: [MaterialRarity, number][] = [
    ['common', MATERIAL_RARITY_MAX_PROFICIENCY - p],
    ['uncommon', p * MATERIAL_RARITY_SHARE.uncommon],
    ['rare', p * MATERIAL_RARITY_SHARE.rare],
    ['epic', p * MATERIAL_RARITY_SHARE.epic],
    ['legendary', p * MATERIAL_RARITY_SHARE.legendary],
  ];
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [tier, w] of weights) {
    if (roll < w) return tier;
    roll -= w;
  }
  return 'legendary'; // unreachable: weights sum to `total`, so the loop always returns above
}

// Flat-ground distance from a player to a node's (x, z) placement. Node
// placements carry no y (see GatherNodeDef, #1120), so this stays a plain 2D
// distance rather than reusing types.ts's dist2d (which takes a full Vec3).
function distToNode(pos: { x: number; z: number }, node: { x: number; z: number }): number {
  const dx = pos.x - node.x;
  const dz = pos.z - node.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// Per-player, per-node respawn readiness: `meta.nodeHarvestReadyAt[nodeId]` is the
// sim.time (seconds) at or after which THAT player may harvest THAT node again.
// Absent means never harvested (always ready). Persisted across logout as
// remaining-time deltas (D6, professions/node_persist.ts): the timers freeze
// at the logout frame and resume on load, so a relog cannot reset them. Still
// strictly per-player: one player harvesting a node never blocks, delays, or
// resets any other player's timer for the same node, so there is no gather
// rush or node camping.
export function isNodeHarvestableBy(meta: PlayerMeta, nodeId: string, now: number): boolean {
  const readyAt = meta.nodeHarvestReadyAt[nodeId];
  return readyAt === undefined || now >= readyAt;
}

/** Remaining seconds until THIS player may harvest `nodeId` again, or null
 *  when it is harvestable now (never harvested counts as ready). The read
 *  half of the same timer isNodeHarvestableBy gates on, same clock domain
 *  (sim.time seconds), so the tooltip countdown and the harvest gate can
 *  never disagree about readiness. */
export function nodeRespawnRemainingSec(
  meta: PlayerMeta,
  nodeId: string,
  now: number,
): number | null {
  const readyAt = meta.nodeHarvestReadyAt[nodeId];
  if (readyAt === undefined || now >= readyAt) return null;
  return readyAt - now;
}

// Node-tier-relative proficiency gain (Professions 2.0): every
// GATHER_GAIN_TIER_STEP points of proficiency is one gain tier, scored
// against the node's tier through the same four-state mastery curve crafting
// uses (wheel.ts tierProgressMultiplier). A node of tier T (1 = bare-hands)
// maps to gain tier T - 1, so it carries the player through the band below
// T * 25 at full-to-minimal gain: t1 nodes gray out at proficiency 75+, and
// Thornpeak's t3 nodes are what finish the climb to 100.
export const GATHER_GAIN_TIER_STEP = 25;

// The per-harvest proficiency gain for one node harvest: deterministic
// fractional amounts (1 / 0.5 / 0.25 / 0 by tiers below), never a skill-up
// roll and never an rng draw.
export function gatherNodeGainMultiplier(proficiency: number, nodeTier: number): number {
  return tierProgressMultiplier(
    Math.floor(Math.max(0, proficiency) / GATHER_GAIN_TIER_STEP),
    Math.max(0, nodeTier - 1),
  );
}

export interface HarvestResolution {
  granted: boolean;
  itemId?: string;
  professionId?: GatheringProfessionId;
  // The rolled material rarity (#1122), scaled by the player's proficiency in
  // the node's matching profession at the moment of harvest. It
  // drives the yield: unit count via the material row's qtyByRarity, and
  // signing via isSignableMaterialRarity.
  rarity?: MaterialRarity;
  // Units of itemId this harvest RESOLVES to (qtyByRarity[rarity], multiplied
  // by GATHER_RARE_EVENT_YIELD_MULT on a rare event). The command boundary
  // (harvestNode) may still truncate the actual grant to bag room.
  qty?: number;
  // True when the yield is granted as signed instances ({ signer: name }, the
  // corpse-harvest precedent): a rare-or-better rarity roll, or any rare
  // event, which forces signing regardless of the rolled rarity.
  signed?: boolean;
  // Non-null when draw #2 hit the zone-broadcast rare event.
  rareEvent?: GatherRareEventFlavor | null;
  // The R42 counterfactual, carried so the command boundary can settle the
  // charge spend against what the player ACTUALLY received. `effectApplied`
  // is true when a usable slotted effect fired on this resolution;
  // `baseItemId`/`baseQty` are the same-draw outcome WITHOUT the bonus (same
  // rarity, same rare-event roll, zero extra draws). The boundary spends the
  // charge only when the granted outcome differs from this base: the fine
  // grade really minted, or the extra unit really landed past truncation.
  effectApplied?: boolean;
  baseItemId?: string;
  baseQty?: number;
}

// Resolves one player's harvest attempt against one node: if that player's own
// timer for this node has elapsed, resolves the zone's material and yield
// (rarity scaled by the player's current proficiency in the node's profession,
// plus the rare-event roll) and queues the matching profession's
// proficiency gain, then resets that player's timer; otherwise denies without
// side effects. Never touches any other player's state for this or any other
// node. Granting is the caller's job (harvestNode), which may truncate to bag
// room.
export function resolveHarvest(
  meta: PlayerMeta,
  node: GatherNodeDef,
  now: number,
  rng: Rng,
  // The R40 per-use consent for a 'prompt'-mode slot, threaded from the
  // command boundary (completeGatherCast reads the cast-start capture).
  // Defaults false, the fail-safe arm: an unconfirmed prompt use skips the
  // effect entirely (no bonus, no charge) while the harvest proceeds; an
  // 'always' slot ignores it (applyToolEffectUse owns the gate).
  effectUseConfirmed = false,
): HarvestResolution {
  if (!isNodeHarvestableBy(meta, node.id, now)) return { granted: false };
  const entry = NODE_HARVEST_TABLE[node.type];
  meta.nodeHarvestReadyAt[node.id] = now + entry.respawnSeconds;
  // Pinned determinism contract: once the harvest gate above passes, EXACTLY
  // two rng draws happen, in this order, on every harvest, draw #1 the
  // material rarity and draw #2 the rare-event roll, regardless of the
  // caller's bag state, so a full or partial bag never shifts the world's
  // rng stream.
  const rarity = rollMaterialRarity(meta.gatheringProficiency[entry.professionId], rng);
  const rareEvent = rollGatherRareEvent(rng, node.type);
  const material = nodeMaterialFor(node.type, node.zoneId);
  // Grade resolution (D8): a pure bag scan against the node, AFTER both draws
  // so it cannot move them, and unit counts come from the base row either way
  // (a fine grade is a quality change, never a rate one). Read here, at the
  // grant, rather than carried from the cast start: the tool GATE is
  // deliberately a start-time check that completeGatherCast does not re-run,
  // but the grade is about what the player is holding when the ore comes out,
  // and pinning it at start would need transient cast state on Entity for a
  // difference only a player who gained or lost a tool mid-cast could see.
  // Losing the tool mid-cast costs the upgrade, never the harvest.
  // The slotted tool effect (D10), applied AFTER both draws and drawing
  // nothing itself, which is what lets it sit inside the two-draw contract
  // above. A quantity effect raises the units; a quality effect raises only
  // the tier the GRADE comparison reads, never the tier the access gate reads,
  // so an effect can improve what a vein yields and can never open one.
  // `confirmed` is the R40 per-use consent threaded from the command
  // boundary; an 'always' slot ignores it outright, a 'prompt' slot fires
  // only when it is true.
  // Use-time zero-benefit gate (the R9 refusal): `usableToolEffectSlot` owns
  // the suppression rule, shared with the preview reader
  // (`effectiveGradeToolTier`), so the tier a tooltip previews and the tier
  // the grant runs can never diverge. Without the gate a slotted Artisan's
  // Eye would burn a charge per harvest on the expansion's starter nodes for
  // a categorically impossible upgrade. Pure reads only, so the two-draw
  // contract is untouched.
  //
  // THE CHARGE IS NOT SPENT HERE (R42): `applyToolEffectUse` only applies
  // the bonus. The command boundary (completeGatherCast) settles the spend
  // against the granted outcome, because only it can see capacity
  // truncation; the base fields returned below are its same-draw
  // counterfactual.
  // WIELDABLE, not owned (R49): the grant's grade comparison must agree with
  // the capacity pre-gates at both cast ends, which resolve through
  // effectiveGradeToolTier's wield-filtered scan; an unwieldable tool minting
  // a fine grade here would clear room for one item and grant another.
  const wieldableTier = bestWieldableGatherToolTierOrNone(
    meta.inventory,
    entry.professionId,
    meta.gatheringProficiency[entry.professionId],
    ITEMS,
  );
  const baseQty = material.qtyByRarity[rarity] * (rareEvent ? GATHER_RARE_EVENT_YIELD_MULT : 1);
  const effect = applyToolEffectUse(
    usableToolEffectSlot(meta, entry.professionId, node),
    { quantity: baseQty, gradeToolTier: wieldableTier },
    effectUseConfirmed,
  );
  const itemId = harvestYieldItemIdFor(node, effect.outcome.gradeToolTier);
  const qty = effect.outcome.quantity;
  const signed = rareEvent !== null || isSignableMaterialRarity(rarity);
  // The queued gain is node-tier-relative (gatherNodeGainMultiplier
  // above), read off the proficiency at the moment of harvest; a gray harvest
  // resolves to 0, which queueGatheringGrant drops, so it queues nothing.
  queueGatheringGrant(
    meta,
    entry.professionId,
    gatherNodeGainMultiplier(meta.gatheringProficiency[entry.professionId], node.tier),
  );
  return {
    granted: true,
    itemId,
    professionId: entry.professionId,
    rarity,
    qty,
    signed,
    rareEvent,
    effectApplied: effect.applied,
    baseItemId: effect.applied ? harvestYieldItemIdFor(node, wieldableTier) : itemId,
    baseQty,
  };
}

// Gather cast timing (Professions 2.0): the harvest is a short
// visible cast instead of an instant grant. Base duration, shortened per
// WIELDABLE tool tier ABOVE the node's tier (R22; holding exactly the
// required tier buys nothing: the gate already demands covering it) and
// modestly per proficiency band, floored. Named tuning constants, recorded in state.md.
export const GATHER_CAST_BASE_SEC = 2.5;
export const GATHER_CAST_FLOOR_SEC = 1.5;
export const GATHER_CAST_TOOL_TIER_REDUCTION_SEC = 0.4;
export const GATHER_CAST_BAND_REDUCTION_SEC = 0.15;

// Pure duration formula for one gather cast. No rng, no clamping surprises:
// max(FLOOR, BASE - max(0, ownedTier - nodeTier) * TOOL_RED - band * BAND_RED).
export function gatherCastDurationSec(
  nodeTier: number,
  ownedTier: number,
  band: 0 | 1 | 2,
): number {
  return Math.max(
    GATHER_CAST_FLOOR_SEC,
    GATHER_CAST_BASE_SEC -
      Math.max(0, ownedTier - nodeTier) * GATHER_CAST_TOOL_TIER_REDUCTION_SEC -
      band * GATHER_CAST_BAND_REDUCTION_SEC,
  );
}

// Command entry point (behind the SimContext seam): validates one player's
// harvest attempt against a node they must be standing near and STARTS a
// gather cast instead of granting instantly (draws and grants
// moved to completeGatherCast below). Runs on the deterministic 20 Hz tick
// path (dispatched from a wire command the same tick it arrives, per the
// other immediate-interaction commands like `buyItem`), never off-tick.
// Denies (no side effect, rng-free) if the requesting player is dead
// (matching the vendor family's dead gate, items.ts buyItem/useItem), in
// combat or swimming (the same pair startFishing enforces, byte-identical
// literals so the existing client matcher rows cover both), busy (already
// casting or consuming), the node id is unknown, the player is too
// far away, their own timer for the node has not elapsed, they lack the tool
// tier, or their bags are full (matching the pickupObject capacity
// pre-check, interaction.ts); a denial never touches another player's state,
// never consumes that player's respawn timer, and never starts a cast.
// Returns true when the cast STARTS: starting the cast is the successful
// interaction for the autorun-stop contract (#1982).
//
// `confirmEffectUse` is the R40 per-use consent for a 'prompt'-mode tool
// effect slot: true means the player explicitly confirmed spending a charge
// on THIS harvest. Defaults false (fail-safe: an old bundle that never sends
// the flag skips the effect and keeps the charge); an 'always' slot ignores
// it entirely, so every pre-prompt caller is byte-identical.
// Parameter order matches the `Sim.harvestNode` delegate positionally
// (nodeId, then consent, then pid), so a caller written against either
// signature cannot silently land a pid in the consent slot or the reverse
// (the whole-branch review found the two disagreed, an any-cast footgun).
export function harvestNode(
  ctx: SimContext,
  nodeId: string,
  confirmEffectUse = false,
  pid?: number,
): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e: p } = r;
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return false;
  }
  // In-combat and swimming denials, mirroring startFishing's order (dead,
  // combat, swim, busy): land harvesting refuses exactly where fishing does,
  // so the two gathering surfaces are explainable as one rule. Both are
  // rng-free and state-free, and both literals already have matcher rows.
  if (p.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return false;
  }
  if (ctx.isSwimming(p)) {
    ctx.error(meta.entityId, "You can't do that while swimming.");
    return false;
  }
  // Busy gate: a running cast or a consume blocks starting a gather cast,
  // the startFishing busy literal.
  if (p.castingAbility || isConsuming(p)) {
    ctx.error(meta.entityId, 'You are busy.');
    return false;
  }
  // Action-locked shapeshift forms refuse harvesting, the exact gate and
  // literal castAbility applies to the normal kit (a Bruin druid cannot mine
  // any more than it can cast). Moonkin/shadow keep the normal kit and pass;
  // the classic rule is the sim's own action-locked set, not "any form".
  if (p.auras.some((a) => isActionLockingFormAuraKind(a.kind))) {
    ctx.error(meta.entityId, "You can't do that while shapeshifted.");
    return false;
  }
  const node = gatherNodeById(nodeId);
  if (!node) {
    ctx.error(meta.entityId, 'That resource node does not exist.');
    return false;
  }
  if (distToNode(p.pos, node.pos) > INTERACT_RANGE) {
    ctx.error(meta.entityId, 'Too far away.');
    return false;
  }
  if (!isNodeHarvestableBy(meta, node.id, ctx.time)) {
    ctx.error(meta.entityId, 'This resource node has not respawned for you yet.');
    return false;
  }
  // Tool gate (#2343, the RuneScape rule): pure access gating, never a speed
  // mechanic. EVERY node harvest requires a matching-profession gatherTool of
  // at least the node's tier anywhere in bags (no equip slot); bare hands
  // never harvest, so a tier-1 node needs a tier-1 tool and requiredTier 1 on
  // the denial means "no tool owned at all". Since R22 the tool must also
  // WIELD: the scan filters out land tools whose proficiency requirement the
  // player has not reached (professions/wield_gate.ts), so a traded or
  // bought-ahead tool sits inert until earned ON THE ACCESS, GRADE, AND
  // SPEED AXES. Stated precisely because one axis deliberately stays
  // ownership-based: the tool-effect mint and recharge size charges from the
  // best tool OWNED (R30's letter; the R47 ratchet and rung floor own the
  // price side), so an unearned tool still fattens a slot's charge count.
  // That reading is SURFACED in the review worklist's ledger for the
  // maintainer beside R45/R47 rather than silently re-ruled here.
  // The gate is rng-free and sits
  // before both rng draws: a denial never touches the respawn timer, never
  // draws rng, and never consumes anything.
  const professionId = NODE_HARVEST_TABLE[node.type].professionId;
  // One bag scan serves both the tool gate and the cast-duration formula
  // below (pure lookup, no rng, so hoisting it cannot shift the draw order).
  const wieldableToolTier = bestWieldableGatherToolTierOrNone(
    meta.inventory,
    professionId,
    meta.gatheringProficiency[professionId],
    ITEMS,
  );
  if (wieldableToolTier === NO_TOOL_OWNED || !canGatherTier(wieldableToolTier, node.tier)) {
    // Two shapes of the same refusal, split for the player's sake: when a
    // covering tool IS in the bags and only the wield requirement is short,
    // the denial names the smallest proficiency at which something they
    // already carry would work this node (`wieldProficiency`); otherwise it
    // is the plain no-tool/tier arm. Both are text-free events the client
    // matcher renders.
    const wieldReq = minWieldRequirementToWork(meta.inventory, professionId, node.tier, ITEMS);
    ctx.emit({
      type: 'gatherDenied',
      pid: meta.entityId,
      surface: 'node',
      professionId,
      requiredTier: node.tier,
      ...(wieldReq !== null && wieldReq > 0 ? { wieldProficiency: wieldReq } : {}),
    });
    return false;
  }
  // Capacity pre-gate on the material this zone's node actually grants. The
  // item id is known BEFORE any rng draw (zone x type lookup plus the D8 grade
  // comparison, both pure), so a full-bag denial here happens before the rng
  // stream is touched and cannot shift the world's draw order. It resolves
  // through the slotted quality effect (harvestYieldItemId), the SAME resolver
  // the completion gate and the grant use, so the three sites cannot disagree
  // about which id needs room: a raw-tool read here once passed a harvest the
  // grant would refuse (room for plain, none for fine) and refused the mirror
  // case. That re-walks the bags once more per cast START (a command, never
  // per tick), the price of one resolver instead of two.
  const yieldItemId = harvestYieldItemId(meta, node, confirmEffectUse);
  if (!ctx.canAddItem(yieldItemId, 1, meta.entityId)) {
    bagsFullError(ctx, meta.entityId);
    return false;
  }
  // Start the gather cast: every gate above is rng-free, so a
  // denial draws nothing and starts no cast. The draws and the grant moved
  // to completeGatherCast below, routed by the cast lifecycle on completion.
  // Starting the cast is a deliberate action and breaks stealth (rng-free),
  // AFTER every deny arm: a refused attempt never reveals the player.
  ctx.breakStealth(p);
  if (p.sitting) ctx.standUp(p);
  // Auto-dismount family (the castStart arm in combat/casting_lifecycle.ts):
  // a gather cast is a deliberate cast, so a mounted player dismounts to
  // gather and an in-flight summon channel is dropped, exactly as any
  // ability cast does. Draw-free (forceDismount is field writes plus a stat
  // recalc), so the two-draw contract is untouched.
  if (p.mountKey !== '') forceDismount(ctx, p);
  if (p.mountCastKey !== '') {
    p.mountCastRemaining = 0;
    p.mountCastKey = '';
  }
  const duration = gatherCastDurationSec(
    node.tier,
    wieldableToolTier,
    proficiencyBandFor(meta.gatheringProficiency[professionId]),
  );
  p.castingAbility = GATHER_CAST_ID;
  p.castTotal = duration;
  p.castRemaining = duration;
  p.castTargetId = null;
  p.channeling = false;
  p.gatherCastNodeId = node.id;
  // The R47 use-time capture: remember the best matching-profession tool
  // rarity at CAST START when this profession carries a tool-effect slot, so
  // the completion-time ratchet latches off BOTH ends of the cast. Trade has
  // no casting gate (deliberately), so without this a mid-cast handoff could
  // take the bonus while dodging the price rung. '' when no slot exists,
  // which keeps the field inert for every slot-less gather cast (and every
  // existing parity frame byte-identical). Pure bag scan, draw-free. The
  // `?? ''` is a type-level floor only: with a slot present the scan always
  // returns a concrete rarity (bestOwnedGatherToolFor floors at 'common'),
  // so the no-slot branch is the one live source of ''.
  p.gatherCastToolRarity = meta.toolEffectSlots?.[professionId]
    ? (bestOwnedGatherToolFor(meta.inventory, professionId, ITEMS).rarity ?? '')
    : '';
  // The R40 consent capture, beside the rarity capture and under the same
  // slot-present condition, so a slot-less cast (every player until one is
  // slotted) keeps the field inert and every existing parity frame
  // byte-identical. Read once at completion. Load-bearing coupling: the
  // cast-start pre-gate above threads the RAW flag while this capture ANDs
  // in slot presence; they agree only because usableToolEffectSlot derives
  // presence from the same toolEffectSlots map, so a confirmed-but-slotless
  // read resolves the base grade either way. If the two expressions ever
  // diverge, the pre-gate reserves room for an id the grant does not mint.
  p.gatherCastEffectConfirmed =
    confirmEffectUse && meta.toolEffectSlots?.[professionId] !== undefined;
  // Drop any GCD-held queued spell press: a session's end paths never call
  // fireQueuedCast, so a slot that survived into the session would fire
  // unprompted one tick after it ends (updateCasting's retry arm).
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  ctx.emit({
    type: 'castStart',
    entityId: p.id,
    ability: GATHER_CAST_ID,
    time: duration,
    gatherNodeType: node.type,
  });
  return true;
}

// Inverse of NODE_HARVEST_TABLE for the tool-use path below: which node type
// a gathering tool works. Fishing has no world nodes (its gatherTool rods
// route to startFishing at the items.ts boundary), so it never appears here.
export const NODE_TYPE_BY_PROFESSION: Partial<Record<GatheringProfessionId, GatherNodeType>> = {
  mining: 'ore',
  logging: 'wood',
  herbalism: 'herb',
};

// Using a pick/axe/sickle from the bags (#2343): behaves like the interact
// press, scoped to the tool's own profession. Finds the nearest matching
// node within interact range, preferring one that is ready for this player
// over one still respawning, and starts the standard gather cast on it
// through harvestNode (which re-runs every gate: dead, busy, range, respawn,
// tool, capacity). With no matching node in range it emits the text-free
// gatherToolNoNode event so the click is never a silent no-op. The scan is
// pure state (no rng), so a no-node denial draws nothing.
export function useGatherToolItem(
  ctx: SimContext,
  professionId: GatheringProfessionId,
  pid?: number,
): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e: p } = r;
  const nodeType = NODE_TYPE_BY_PROFESSION[professionId];
  if (!nodeType) return false;
  let best: GatherNodeDef | null = null;
  let bestDist = Infinity;
  let bestReady = false;
  for (const node of GATHER_NODES) {
    if (node.type !== nodeType) continue;
    const d = distToNode(p.pos, node.pos);
    if (d > INTERACT_RANGE) continue;
    const ready = isNodeHarvestableBy(meta, node.id, ctx.time);
    // A ready node always beats a respawning one; ties resolve by distance.
    if (ready !== bestReady) {
      if (!ready) continue;
      best = node;
      bestDist = d;
      bestReady = true;
    } else if (d < bestDist) {
      best = node;
      bestDist = d;
    }
  }
  if (!best) {
    ctx.emit({ type: 'gatherToolNoNode', pid: meta.entityId, professionId });
    return false;
  }
  // Deliberately consent-blind (R40): this is the raw item-use command's
  // path (the RL env, bots, an old bundle), whose wire shape carries no
  // confirm flag and whose callers have no dialog to answer, so the default
  // false is the fail-safe arm: a 'prompt' slot never fires here and never
  // spends. The three client dispatch sites resolve the node locally and
  // send harvest_node with the consent instead.
  return harvestNode(ctx, best.id, false, pid);
}

// Completion of a running gather cast, reached through the
// ctx.completeGatherCast callback when updateCasting sees the cast finish.
// Re-validates EXACTLY range, respawn readiness, and capacity with the same
// error literals as the cast start (the world can move during the cast: the
// player can drift, the timer can rewind on a dev cheat, the bags can fill);
// the tool gate is deliberately NOT re-checked: it was held at cast start.
// Then runs the pre-12b resolve body verbatim (move-not-rewrite): the
// two-draw pair, the truncated grant, the quest/deed/XP hooks, and the
// gatherResult emit.
export function completeGatherCast(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  const nodeId = p.gatherCastNodeId;
  p.gatherCastNodeId = '';
  // The R47 cast-start rarity capture (harvestNode): read and reset beside
  // the node id, so the field is inert again whatever arm returns below.
  const startToolRarity = p.gatherCastToolRarity;
  p.gatherCastToolRarity = '';
  // The R40 consent capture, read-and-reset the same way: the whole
  // completion (both capacity reads and the grant) resolves under ONE
  // consent value, so the room this gate checks is room for the id the
  // grant actually mints, confirmed or not.
  const effectUseConfirmed = p.gatherCastEffectConfirmed;
  p.gatherCastEffectConfirmed = false;
  const node = gatherNodeById(nodeId);
  // Defensive: the id was validated at cast start and content is static.
  if (!node) return;
  if (distToNode(p.pos, node.pos) > INTERACT_RANGE) {
    ctx.error(meta.entityId, 'Too far away.');
    return;
  }
  if (!isNodeHarvestableBy(meta, node.id, ctx.time)) {
    ctx.error(meta.entityId, 'This resource node has not respawned for you yet.');
    return;
  }
  // Same grade resolution resolveHarvest is about to make, one line later and
  // with no inventory mutation in between, so the room this gate checks is
  // room for the id the grant actually mints.
  if (!ctx.canAddItem(harvestYieldItemId(meta, node, effectUseConfirmed), 1, meta.entityId)) {
    bagsFullError(ctx, meta.entityId);
    return;
  }
  const result = resolveHarvest(meta, node, ctx.time, ctx.rng, effectUseConfirmed);
  if (!result.granted) {
    // Unreachable in practice (the readiness check above already gates this),
    // but kept as a defensive fallback so a future resolveHarvest change
    // cannot silently grant with no player-visible denial.
    ctx.error(meta.entityId, 'This resource node has not respawned for you yet.');
    return;
  }
  const { itemId, professionId, rarity, qty, signed, rareEvent } = result;
  if (!itemId || !professionId || !rarity || !qty) {
    // resolveHarvest's granted branch always supplies these fields. Keep the
    // boundary defensive without introducing a player-visible impossible case.
    return;
  }
  // Grant the resolved yield, truncated to what the bags actually absorb: the
  // Sim grant hub (sim.ts addItem/addItemInstance) NEVER capacity-caps (an
  // async award must not destroy items), so the command boundary here owns
  // the truncation. Both rng draws already happened in resolveHarvest, so
  // truncation never shifts the draw order.
  let grantedQty = 0;
  // Fungible grant: find the largest count that still fits (stack top-up
  // plus free slots, ctx.canAddItem). The pre-gate guarantees at least 1.
  const grantFungibleFit = (): number => {
    let fit = qty;
    while (fit > 1 && !ctx.canAddItem(itemId, fit, meta.entityId)) fit--;
    // silent + callerLogs: the gatherResult event below owns BOTH halves of
    // the player feedback for this harvest. It plays its own node-type cue
    // (audio.gather in src/game/audio.ts), so the generic loot ding would
    // stack on top of it, and it logs the rarity-colored, item-linked gather
    // line, so the hub's "You receive:" line would be a second line for the
    // one grant (#2430).
    ctx.addItem(itemId, fit, meta.entityId, { silent: true, callerLogs: true });
    return fit;
  };
  if (signed) {
    // A signed instance merges only into a byte-equal same-signer stack
    // (identical-payload stacking; never a plain stack, #1165):
    // countFit with the payload counts that merge room plus free slots, so a
    // rare-event windfall lands whole once a single slot (or same-signer
    // stack room) is open, where the earlier contract needed one free slot
    // per unit. The fungible pre-gate above can pass on plain-stack top-up
    // room alone, so when no signed unit fits the yield falls back to an
    // unsigned top-up grant (the truncation contract wins over signing in
    // that self-inflicted edge; the crossing-case pin lives in
    // tests/gather_rare_events.test.ts).
    const capacity = bagCapacity(meta.bags);
    const fit = countFit(meta.inventory, capacity, itemId, qty, { signer: meta.name });
    if (fit > 0) {
      // One batched grant: a x5 windfall lands as ONE hub loot event
      // instead of five (the recorded loot-burst polish), which the gather
      // line then renders as a single "You gather: X x5." line.
      // silent + callerLogs: see grantFungibleFit's matching comment above,
      // same reasons.
      ctx.addItemInstance(itemId, { signer: meta.name }, meta.entityId, fit, {
        silent: true,
        callerLogs: true,
      });
      grantedQty = fit;
    }
    if (grantedQty === 0) {
      grantedQty = grantFungibleFit();
      // The yield survived as a plain top-up but its signature did
      // not; tell the player (a text-free personal event, the gatherDenied
      // idiom; one signed batch per harvest, so no dedupe flag is needed).
      ctx.emit({ type: 'gatherDowngrade', pid: meta.entityId, surface: 'node', lost: 'mark' });
    }
  } else {
    grantedQty = grantFungibleFit();
  }
  // The R42 charge settle, AFTER the grant so truncation is visible: the
  // charge is spent only when the bonus actually changed what the player
  // received. The two kinds reduce to one predicate over the counterfactual
  // the resolution carried: a quality effect mattered iff the granted id
  // differs from the no-bonus id (draw-free grade compare), a quantity
  // effect mattered iff the granted count exceeds the no-bonus count (the
  // same-draw base; a grant clipped to or below it gave the player nothing
  // the base would not have). Draws nothing, so the two-draw contract holds;
  // the slot object is the same live reference the resolution applied, read
  // through the SAME suppression rule so a suppressed slot never spends.
  //
  // The R47 use-time ratchet settles here too, on EVERY applied use (mattered
  // or not): taking the bonus alongside a better owned tool is what latches
  // the slot's price ceiling. It reads BOTH ends of the cast, the completion
  // bags and the cast-start capture (harvestNode), because trade has no
  // casting gate: a mid-cast handoff could otherwise fire the bonus with the
  // good pick already gone and dodge the latch (the completion-only read
  // once claimed "node access forces the tool to be CARRIED", which is true
  // only at cast start). So a slot minted cheap with the good pick stashed
  // re-prices itself on its first bonus-bearing harvest, handoff or not.
  // Raise-only and idempotent, so the pair is exactly max(start, completion).
  // One extra bag scan on the effect-bearing path only, draw-free.
  let effectDepleted = false;
  if (result.effectApplied) {
    const usedSlot = usableToolEffectSlot(meta, professionId, node);
    if (usedSlot) {
      ratchetCeilingForUse(
        usedSlot,
        bestOwnedGatherToolFor(meta.inventory, professionId, ITEMS).rarity,
      );
      if (startToolRarity !== '') ratchetCeilingForUse(usedSlot, startToolRarity);
    }
    const mattered = itemId !== result.baseItemId || grantedQty > (result.baseQty ?? qty);
    // The last-charge signal (the UX pass): a spend that empties the slot is
    // the one worth announcing, so the return depleteEffect always had is
    // finally read instead of discarded. Rides the gatherResult emit below
    // as an additive optional field.
    if (mattered) {
      const spent = depleteEffect(usedSlot);
      // `spent` already implies usedSlot is defined (depleteEffect returns
      // false for undefined); the extra term is TypeScript narrowing only.
      // Do not "simplify" by dropping `spent`: the durability read alone
      // would announce a depletion the settle never performed.
      effectDepleted = spent && usedSlot !== undefined && usedSlot.durability <= 0;
    }
  }
  ctx.onNodeGatheredForQuests(node, itemId, meta);
  // Zone gather mark: one entry per zone and node type ever harvested.
  ctx.markVisited(meta, `gather:${node.zoneId}:${node.type}`);
  // Character XP for the harvest (profession_xp.ts), tier-scaled and
  // level-gated the same way kill XP is: a max-level player farming a
  // trivial (gray) node gets zero.
  ctx.grantXp(gatherActionXp(node.level, p.level), meta);
  // Rare event: soft zone broadcast plus the dormant per-flavor
  // deed mark, resolved in gather_events.ts after the grant lands.
  if (rareEvent) announceGatherRareEvent(ctx, meta, node, rareEvent, itemId);
  // Gather-completion event (#1729): personal (pid), so the client can play a
  // gathering audio cue for the acting player only. Emitted here on the granted
  // path exactly like craftItem emits craftResult on a completed craft; carries
  // the rolled rarity so a rare-material harvest is distinguishable for a
  // special cue, plus the rare-event fields: qty is the ACTUAL granted unit count
  // (post-truncation), rareEvent the flavor or null. Draws no rng, so the
  // two-draws-per-harvest contract (see the rng-draw test) is unaffected.
  ctx.emit({
    type: 'gatherResult',
    pid: meta.entityId,
    nodeId: node.id,
    nodeType: node.type,
    professionId,
    itemId,
    rarity,
    qty: grantedQty,
    rareEvent: rareEvent ?? null,
    // Present only when THIS spend emptied the slot (absent otherwise, so
    // every non-final harvest's event stays byte-identical to the old wire).
    ...(effectDepleted ? { effectDepleted: true as const } : {}),
  });
}

export interface PendingGatherGrant {
  professionId: GatheringProfessionId;
  amount: number;
}

export function emptyGatheringProficiency(): GatheringProficiency {
  return { mining: 0, logging: 0, herbalism: 0, fishing: 0 };
}

export function isGatheringProfessionId(id: string): id is GatheringProfessionId {
  return (GATHERING_PROFESSION_IDS as string[]).includes(id);
}

// Normalizes a possibly-absent, possibly-partial saved record (old character
// saves predate this field entirely) into a full, zero-defaulted proficiency
// record. Never throws on an absent or malformed field. A loaded
// value above the profession's enforced content cap (GATHERING_PROFESSIONS
// maxSkill) clamps DOWN to it; the sim.ts call site feeds this both the
// current gatheringProficiency key and the legacy pre-rename `professions`
// key, so the clamp covers both save shapes. CAP-RAISE CAVEAT: this clamp
// makes a cap raise rollback-destructive (an old binary clamps raised values
// on load and persists the loss on its first save); whoever raises a cap
// must ship the mechanical fix with it. See the shared "rollback erases
// newer fields" note in docs/design/professions-tuning-packet.md.
export function normalizeGatheringProficiency(
  saved: Partial<Record<string, number>> | undefined | null,
): GatheringProficiency {
  const out = emptyGatheringProficiency();
  if (!saved) return out;
  for (const id of GATHERING_PROFESSION_IDS) {
    const v = saved[id];
    if (typeof v === 'number' && Number.isFinite(v))
      out[id] = Math.max(0, Math.min(GATHERING_PROFESSIONS[id].maxSkill, v));
  }
  return out;
}

// Queues a grant for the next tick's drain; called from the `/dev gather`
// chat cheat (offline local play or ALLOW_DEV_COMMANDS=1 on the server). No
// rng draw: the amount is a fixed value passed by the caller, so the result is
// fully deterministic given the same sequence of calls. Proficiency is a
// monotonic additive-only counter (no decrement path), so a non-positive
// amount is rejected here rather than silently applied as a decrement by
// drainGatheringGrants.
export function queueGatheringGrant(
  meta: PlayerMeta,
  professionId: GatheringProfessionId,
  amount: number,
): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  meta.pendingGatherGrants.push({ professionId, amount });
}

// One clamp rule for applying a queued grant to a proficiency record, shared
// by the tick drain and the save-time fold below so the two can never disagree
// about the cap. The GATHERING_PROFESSIONS lookup is deliberately unguarded:
// every queue writer is typed (or validates via isGatheringProfessionId, the
// /dev gather path). Note the fold puts this lookup on the SAVE path, so an
// out-of-table id would fail the save (a retried leave flush), not just the
// tick that drained it.
function applyGrantClamped(record: GatheringProficiency, grant: PendingGatherGrant): void {
  record[grant.professionId] = Math.max(
    0,
    Math.min(
      GATHERING_PROFESSIONS[grant.professionId].maxSkill,
      record[grant.professionId] + grant.amount,
    ),
  );
}

// Drains one player's queued grants, applying each additively to that
// profession's own counter only. Called once per player per tick (sim.ts
// `tick()`), so a grant issued this tick is visible starting next tick, the
// same cadence as every other per-tick system. Each result clamps
// at the profession's enforced content cap (GATHERING_PROFESSIONS maxSkill),
// the gain-time arm for harvests, catches, and the `/dev gather` cheat; at
// cap, harvests and catches still yield, only proficiency gain stops.
export function drainGatheringGrants(meta: PlayerMeta): void {
  if (meta.pendingGatherGrants.length === 0) return;
  for (const grant of meta.pendingGatherGrants) {
    applyGrantClamped(meta.gatheringProficiency, grant);
  }
  meta.pendingGatherGrants.length = 0;
}

// The proficiency record a SAVE should carry: the live counters with any
// still-queued grants folded in, under the same clamp the tick drain applies.
// A leave-time save can run between the tick that queued a grant (a completed
// harvest, a reel-landed catch) and the tick that drains it; without this fold
// that save would silently lose the grant. Pure: the live meta is untouched,
// so the queue still drains ONLY on the deterministic tick path, and the
// folded snapshot equals what the drain will produce one tick later.
export function foldPendingGatherGrants(
  meta: Pick<PlayerMeta, 'gatheringProficiency' | 'pendingGatherGrants'>,
): GatheringProficiency {
  const out = { ...meta.gatheringProficiency };
  for (const grant of meta.pendingGatherGrants) applyGrantClamped(out, grant);
  return out;
}

// Projects the internal per-profession counter onto the settled
// `PlayerProfessionSkill` shape (src/sim/professions/types.ts, from #1164),
// in the stable GATHERING_PROFESSION_IDS order. This is what backs the
// `IWorldProfessions.professionsState` read (sim.ts `professionsStateFor`);
// crafting/secondary professions still contribute nothing until they land.
export function gatheringSkillsView(proficiency: GatheringProficiency): PlayerProfessionSkill[] {
  return GATHERING_PROFESSION_IDS.map((id) => ({
    professionId: id,
    skill: proficiency[id],
    maxSkill: GATHERING_PROFESSIONS[id].maxSkill,
  }));
}

// Corpse harvest: a single-use, first-come shared resource, the deliberate opposite
// of a world gathering node (which is per-player: every player who reaches a node can
// harvest their own instance of it). A slain mob's corpse can be salvaged for
// profession components (hide, fang, silk, ...) exactly ONCE: the first player to
// harvest it claims the yield, and every later attempt (same tick or any later tick)
// against that same corpse is denied.
//
// Pure leaf: no Sim/Entity import, no clock, mirroring the loot/loot_ffa.ts
// pattern (reference: format_money.ts, threat.ts, loot/loot_ffa.ts). The single-use
// claim below draws no rng; the #1142 focus-harvest tier roll further down takes an
// explicit `Rng` argument, same pattern as loot/loot_roll.ts. The owning
// caller (src/sim/interaction.ts) holds the corpse's `harvestClaimedBy` state on the
// Entity and passes it in; resolveCorpseHarvest performs the whole check-and-set in
// one synchronous call, so there is nothing left to race.
//
// Race-freedom argument: the sim tick is single-threaded at 20 Hz (see
// src/sim/CLAUDE.md, "sim.ts coordinator map"). Every player command in a tick's
// batch is processed one at a time, in order, by the SAME synchronous call stack;
// there is no `await` or callback boundary between reading `harvestClaimedBy` and
// writing it back. So two harvest attempts landing in the SAME tick are still
// resolved sequentially, never concurrently: whichever command is processed first
// (deterministic command-batch order) sees `currentClaimedBy === null` and wins;
// the second sees the just-written claim and is denied. No lock is needed because
// there is no interleaving to guard against.
//
// #1142 adds a per-corpse FOCUS PICKER on top of the single-use claim above:
// which of the corpse's tagged component(s) the claiming player extracts, and
// the concentrate-vs-spread tier tradeoff for that choice (see
// resolveCorpseFocusHarvest below). Draws rng, unlike the rest of this file.

// The tag-to-item yield map is game data, so it lives in src/sim/content/professions.ts
// (this directory holds shapes and logic, no game data; see the local CLAUDE.md).
// Re-exported here so existing importers keep resolving.
export { HARVEST_COMPONENT_ITEMS };

export interface HarvestClaim {
  readonly success: boolean;
  readonly claimedBy: number | null;
}

/**
 * The one way to read HARVEST_COMPONENT_ITEMS. Every question about "what does
 * this component family yield" goes through here: the two predicates below, the
 * pre-claim capacity gate, and the grant loop (src/sim/interaction.ts
 * harvestCorpse). That is the whole point, because the family of bugs #2509 and
 * #2513 close is a disagreement between two of those readers.
 *
 * `Object.hasOwn` first: HARVEST_COMPONENT_ITEMS is a plain object literal, so a
 * bare `table[component]` answers with Object.prototype for `constructor`,
 * `toString`, `valueOf` and the rest. A bare lookup made that truthy in the
 * gate AND in the grant loop, which would try to grant an item id that is a
 * function. Guarding one reader and not the others would just move the
 * disagreement, so the guard lives in the single accessor they all share.
 */
export function harvestItemForFamily(component: string): string | undefined {
  return Object.hasOwn(HARVEST_COMPONENT_ITEMS, component)
    ? HARVEST_COMPONENT_ITEMS[component]
    : undefined;
}

/**
 * Does one component family have a harvest item behind it? A TRUTHINESS test,
 * not `!== undefined`, so it stays byte-equivalent to the `if (!itemId)
 * continue` the grant loop and the pre-claim capacity gate use over the SAME
 * accessor: an empty-string mapping must read as unyieldable everywhere, or it
 * reads as harvestable here and as grantable nowhere, which is the exact bug the
 * two predicates below refuse. One rule, one place, because isHarvestableCorpse
 * and forfeitsEveryMappedYield both ask it and a copy in either would be a copy
 * that can drift. Written as `in` or `!== undefined` it reintroduces the bug, so
 * do not "tidy" it; pinned in tests/gathering.test.ts against an empty-string
 * mapping and against the Object.prototype keys.
 */
export function harvestFamilyYieldsItem(component: string): boolean {
  return !!harvestItemForFamily(component);
}

/**
 * Does this mob's corpse support profession harvest at all? Answers on the
 * MAPPED families the corpse carries, not on its tag COUNT (#2513).
 *
 * The count answer was a lie on exactly one shipped template: fen_troll
 * carried `claw` and `tusk` and HARVEST_COMPONENT_ITEMS mapped neither at the
 * time (#2905 has since wired both, so no shipped template is all-unmapped
 * today), so its corpse advertised a harvest it could never pay, accepted the
 * command, spent the
 * single-use claim, drew one tier roll per effective family, granted nothing,
 * and emitted NOTHING AT ALL (the harvestResult ledger is gated on
 * `granted.length > 0`). Measured pre-fix: an omitted pick, `[]` and
 * `['claw','tusk']` each drew 2 and `['claw']` drew 1, all of them silent, with
 * the claim spent and the corpse timer clamped from 9999 to 4. Those counts are
 * seed-INDEPENDENT, not a golden: an unmapped family costs its tier roll and
 * then `continue`s before the rarity roll, so the count is just the effective
 * pick's length.
 *
 * Answering on mapped families instead retires that whole class rather than
 * reporting it: the corpse takes the SAME path as the many shipped templates
 * that carry no component tags at all, so the picker and the interact prompt
 * never offer it (src/sim/corpse_interaction.ts, src/game/corpse_loot_availability.ts,
 * src/ui/hud/loot/corpse_harvest_view.ts all read this predicate), and an
 * explicit command that arrives anyway (a stale client bundle, the headless env,
 * a hand-built wire frame) hits harvestCorpse's pre-existing pre-claim, rng-free
 * `error.corpseNothingToHarvest` refusal instead of burning the corpse in
 * silence. No new string, no new event, no new wire or IWorld member.
 *
 * Deliberately NOT a narrowing inside effectiveFocusComponents: this one moves
 * nothing on a MIXED corpse, so the concentration bonus and the #2509 refusal
 * were untouched on all nine of them. (#2514 has since moved that bonus on
 * purpose, in yieldingFocusComponents below; this predicate still moves
 * nothing on a mixed corpse.) The one knock-on it does have is wanted:
 * pruneCorpseLoot (loot/loot_roll.ts) reads the same predicate, so an emptied
 * all-unmapped corpse now takes the fast collapse arm instead of holding a
 * 30-second grace window open for a harvest that can never come.
 *
 * `.some` covers the empty array, so the former length test is subsumed rather
 * than dropped.
 */
export function isHarvestableCorpse(componentTags: readonly string[] | undefined): boolean {
  return !!componentTags && componentTags.some(harvestFamilyYieldsItem);
}

/**
 * Atomic check-and-set harvest claim: exactly one caller, for a given corpse, ever
 * gets `success: true`. Deterministic and order-independent for a fixed
 * `currentClaimedBy` (null means unclaimed) and requesting `pid`.
 */
export function resolveCorpseHarvest(currentClaimedBy: number | null, pid: number): HarvestClaim {
  if (currentClaimedBy !== null) return { success: false, claimedBy: currentClaimedBy };
  return { success: true, claimedBy: pid };
}

// Per-corpse focus picker (#1142): concentrate vs spread tradeoff.
//
// At a harvestable corpse the player chooses which tagged component(s) to
// extract. Extracting FEWER components concentrates the effort and yields a
// measurably higher tier per component than spreading across every tagged
// type on the same corpse.
//
// "Extracting", not "choosing", and the difference is #2514's whole ruling: a
// tagged family with no item behind it is never extracted, so checking or
// unchecking it changes nothing. On a corpse carrying exactly ONE mapped
// family that leaves no choice at all, and every legal pick there lands the
// same outcome. harvestConcentrationBonus below owns that rule and states it
// in full.

/** Component yield tiers, worst to best. Independent of `ItemDef['quality']`
 * (a harvest yield is a raw material, not necessarily an equippable item),
 * but reuses the same classic six-tier naming so it reads consistently. */
export type HarvestTier = 'poor' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

// Exported so professions/focus.ts (#1143) can shift a rolled tier upward by a
// persistent town-focus bonus without redefining the tier order.
export const HARVEST_TIERS: readonly HarvestTier[] = [
  'poor',
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
];

// Base per-tier roll weights (poor..legendary), used unshifted when the player
// spreads across every tagged component on the corpse (zero concentration).
// Tune here, not inline in the roll. Exported so tests can pin the table and
// derive the expected yield per bonus from it rather than hard-coding a second
// copy of these numbers (the #2514 content-shape guard in
// tests/mob_component_tags.test.ts does exactly that).
export const BASE_TIER_WEIGHTS: readonly number[] = [40, 30, 15, 10, 4, 1];

export interface FocusHarvestYield {
  readonly component: string;
  readonly tier: HarvestTier;
}

/**
 * The component set a focus pick actually extracts: an empty `chosen` or one
 * covering every tagged component both spread across all of `taggedComponents`
 * (the #1141 behavior); a strict subset concentrates on its valid members.
 * Shared by resolveCorpseFocusHarvest and the command boundary's pre-claim
 * capacity gate (src/sim/interaction.ts), which must see exactly the set the
 * roll will yield WITHOUT drawing rng (a refused command must not shift the
 * world's draw order).
 *
 * `chosen` reaches here straight off the wire (server/game.ts forwards the
 * client's `components` array after a type filter only), so it is SANITIZED
 * first and only then interpreted: deduped to a set (#2474), then narrowed to
 * the tags this corpse actually carries (#2504). BOTH length tests below read
 * that sanitized set, never the raw array, which is what stops a padded frame
 * from switching arms:
 *   - A repeated tag counts ONCE. A corpse is single-use, so a repeat that
 *     survived would let one hand-crafted frame farm the same family several
 *     times off one claim: two tier rolls, two grants, and on a rare-or-better
 *     roll two signed yields (#2474).
 *   - A tag the corpse does not carry counts for NOTHING. Measured against the
 *     raw count it padded the pick past the `>= taggedComponents.length` spread
 *     threshold, so `['hide','junk']` on a two-tag ALL-MAPPED corpse spread
 *     across every family at bonus 0 where `['hide']` concentrates on hide
 *     (#2504). The bonus-0 half of that is archaeology on a mixed corpse, where
 *     the spread carries a bonus of its own (#2514); the sanitization it
 *     describes is unchanged on every shape.
 * After the narrowing that second test can only ever be an equality: `picked`
 * is a deduped subset of the tags, so it can exceed their count only if the
 * tags themselves repeat, which tests/mob_component_tags.test.ts forbids. That
 * cross-file pin is what makes the `>` half unreachable; the comparator stays
 * `>=` as the plain statement of "the pick covers every tagged component", and
 * degrades safely rather than silently if the pin ever loosens.
 *
 * Consequence, decided rather than inherited: a pick whose entries are ALL
 * invalid sanitizes to the empty pick, so it spreads, exactly as sending no
 * selection at all does. "Ignored entirely" is then one rule applied
 * uniformly, a junk tag is never the difference between two outcomes, and a
 * client whose tag vocabulary has drifted from the server's content degrades
 * to the #1141 default instead of burning a single-use corpse for nothing.
 * This supersedes the narrower #2474 knock-on (an all-junk pick yielded
 * nothing), which was itself only ever true BELOW the threshold: above it, the
 * same frame already spread. Scope, so the sentence above is not read as more
 * than it is: this covers a tag the corpse does not CARRY. A tag it carries
 * that HARVEST_COMPONENT_ITEMS does not map (claw, tusk, gills, horn) is a
 * different case and is still handled a different way: it survives THIS
 * function, because two later readers need to see it. The command boundary
 * REFUSES the harvest pre-claim when the surviving pick maps to no item at all
 * (#2509, forfeitsEveryMappedYield and src/sim/interaction.ts harvestCorpse),
 * and that refusal is only expressible over a pick that still names the
 * unmapped families. Only then is it dropped, by yieldingFocusComponents
 * (#2514), which is what the tier rolls and the concentration bonus read: an
 * unmapped family is never extracted, so it never dilutes the bonus.
 *
 * First occurrence wins (Set iteration is insertion-ordered) and the narrowing
 * preserves that order, so tag ORDER is untouched: it is the order the yields,
 * the grants and the harvestResult ledger entries land in (#2457). Same
 * order-preserving idiom the picker's own view-core (`corpseHarvestView`)
 * already applied to the tags it renders, which is why no CURRENT shipped
 * client produces either shape. "Current" is load-bearing and not hedging: a
 * cached desktop or native bundle whose content predates a retag can still
 * name a tag this server no longer carries, which is the realistic path to the
 * junk shape and the reason the ruling above is decided the way it is.
 * `taggedComponents` needs no dedupe of its own: content uniqueness is pinned
 * by tests/mob_component_tags.test.ts, the same cross-file pin the `>=`
 * argument above leans on.
 */
export function effectiveFocusComponents(
  taggedComponents: readonly string[],
  chosen: readonly string[],
): readonly string[] {
  const picked = [...new Set(chosen)].filter((c) => taggedComponents.includes(c));
  return picked.length === 0 || picked.length >= taggedComponents.length
    ? taggedComponents
    : picked;
}

/**
 * #2509: does this pick throw away EVERYTHING the corpse had to give? True when
 * the effective set maps to no item at all while the corpse carries at least
 * one family that does, i.e. a different pick on the same corpse would have
 * paid out. The command boundary refuses on it (src/sim/interaction.ts
 * harvestCorpse, pre-claim and rng-free) and the picker's view-core disables
 * Harvest on it (src/ui/hud/loot/corpse_harvest_view.ts), so this is the ONE
 * place the rule is written: a mirror stated twice is a mirror that can drift,
 * and the spread threshold it depends on lives in effectiveFocusComponents
 * above rather than in either caller.
 *
 * Both halves matter, and the second one is kept deliberately after #2513 even
 * though isHarvestableCorpse now excludes an all-unmapped corpse UPSTREAM of
 * both callers (harvestCorpse refuses at its own gate first; the picker never
 * renders for such a corpse). It stays because it is what this predicate MEANS:
 * "a different pick on this corpse would have paid out". Drop it and the
 * function starts answering a question nobody asked it, and the two gates would
 * be one narrowing away from disagreeing. Its second half is now belt and
 * braces rather than the load-bearing term it was for #2509, and both states
 * are pinned separately (tests/corpse_harvest_view.test.ts drives both terms
 * on sethrael_palecoil's real mixed tags, and the all-unmapped arm rides the
 * retagged fixtures in tests/corpse_harvest_window.test.ts and
 * tests/loot_window_controller.test.ts, so the two terms can never quietly
 * coincide).
 *
 * Pure and rng-free, so the refusal it drives draws nothing.
 */
export function forfeitsEveryMappedYield(
  taggedComponents: readonly string[],
  chosen: readonly string[],
): boolean {
  return (
    !effectiveFocusComponents(taggedComponents, chosen).some(harvestFamilyYieldsItem) &&
    taggedComponents.some(harvestFamilyYieldsItem)
  );
}

/**
 * The families a focus pick actually EXTRACTS: the effective pick, minus every
 * family HARVEST_COMPONENT_ITEMS does not map. This is the set the tier rolls,
 * the grants and the pre-claim capacity gate all iterate, so a family with no
 * item behind it costs no rng draw and produces no yield entry.
 *
 * #2514, and the ruling is stated in full on harvestConcentrationBonus below.
 * Deliberately a SECOND function rather than a narrowing folded into
 * effectiveFocusComponents: that one answers "what did the player's pick name,
 * once sanitized", which is what #2509's forfeitsEveryMappedYield refusal and
 * the spread threshold are both written against, and folding this in would
 * silently retire that refusal (an all-unmapped pick would sanitize to the
 * empty pick and spread, exactly the silent claim-burning #2509 closed).
 */
export function yieldingFocusComponents(
  taggedComponents: readonly string[],
  chosen: readonly string[],
): readonly string[] {
  return effectiveFocusComponents(taggedComponents, chosen).filter(harvestFamilyYieldsItem);
}

/**
 * The concentration bonus one focus pick earns: how much of this corpse's
 * breadth the harvest gives up, in tier shifts, clamped to
 * `[0, HARVEST_TIERS.length - 1]`.
 *
 * THE #2514 RULING, next to the formula it governs. The bonus counts families
 * the harvest could not extract, and a family with no item behind it (claw,
 * tusk, gills, horn) is NEVER extracted, whether or not the player checked it.
 * So it is always forfeited breadth: the numerator is yieldingFocusComponents,
 * not the raw effective pick.
 *
 * Before: the numerator was the effective pick itself, so checking Claw beside
 * Hide on old_greyjaw (hide, fang, claw) cost a full tier on hide and returned
 * nothing for claw. Measured at seed 5, `['hide']` gave bonus 2 (rough_hide 4
 * plus a signed pristine_hide) and `['hide','claw']` gave bonus 1 (rough_hide 3):
 * the player paid a tier and a specimen roll to tick a box that can only ever
 * come back empty. Nine shipped templates mix mapped and unmapped families and
 * on sethrael_palecoil (hide, claw, horn) two of the three boxes carried that
 * cost. After: `['hide','claw']` is byte-identical to `['hide']`.
 *
 * Why THIS numerator and not a matching move of the denominator to the mapped
 * tag count: the denominator is the corpse's ADVERTISED breadth, what it
 * carries, and that half is not new. It has read `taggedComponents.length`
 * since #1142, so "an extra tag is worth an extra tier to whoever concentrates"
 * was already the shipped rule: `['hide']` on old_greyjaw (3 tags) is bonus 2
 * today where `['hide']` on forest_wolf (2 tags) is bonus 1. #2514 does not
 * introduce that, it extends it to the picks that were paying for breadth they
 * never received. Moving the denominator too would make the single-mapped
 * shapes (the three `gills, hide` murlocs, sethrael_palecoil) permanently
 * bonus-0, a NERF on the very templates this issue is about, and it would make
 * the bonus SHRINK when content ships.
 *
 * The tension with #2513, stated rather than left for a reader to find: that
 * issue called an unmapped tag inert data and masked a corpse made of nothing
 * else. Here an unmapped tag is not inert, it is breadth the harvest cannot
 * reach, and it raises the bonus. Both readings are the same rule seen from two
 * sides (a family with no item is never extracted), and the two never disagree
 * about the same question: #2513 answers "is there anything here", #2514
 * answers "how much of what is here does this pick give up".
 *
 * The knock-on that ruling has, and its guard: adding a decorative unmapped tag
 * to a mob is a balance edit, because it widens the denominator. Bounded on
 * shipped content, where a corpse's default harvest still pays no more than it
 * would if every tag it carries had an item behind it, and pinned as exactly
 * that property (tests/mob_component_tags.test.ts), which reds on the first
 * template shaped so it would not. The bound is a property of the shape
 * (tag count vs mapped count), not of the change, so it is checked rather than
 * assumed.
 *
 * As written the change is bounded on both sides, which is the balance
 * argument for making it at all:
 *   - No ceiling moves. Every pick a caller can actually harvest on has
 *     `extracted.length >= 1` (the #2509 and #2513 refusals take the rest,
 *     BEFORE this is asked), so its bonus never exceeds `tags.length - 1`,
 *     which is exactly the bonus a player who already knew which rows were dead
 *     got today by checking one box. That bound is a statement about the gated
 *     call sites, not about this function: asked raw about a pick that extracts
 *     nothing (`(['hide','fang','claw'], ['claw'])`, or any pick on an
 *     all-unmapped corpse) it answers `tags.length`, one above the bound, and
 *     resolveCorpseFocusHarvest then rolls nothing at all with it.
 *   - No pick's EXPECTED value gets worse. `extracted` is a subset of the
 *     effective pick, so the new bonus is >= the old one for every pick on
 *     every corpse. Per-seed outcomes are a different statement and a weaker
 *     one: the draw position moves (next bullet), so a given seed can land a
 *     smaller plain stack than it used to. One of the re-measured literals is
 *     exactly that (mudfin_murloc at seed 5: rough_hide 4 and no specimen
 *     before, rough_hide 3 plus a signed pristine_hide after).
 *   - The eight all-mapped tagged templates and the 101 untagged ones do not
 *     move at all: with nothing to filter, `extracted` IS the effective pick.
 *   - Only tier QUANTITY moves. The signed/specimen jackpot comes from
 *     rollCorpseMaterialRarity, a fixed-baseline roll this bonus never feeds,
 *     and it is already drawn once per granted family. What does move is the
 *     draw POSITION: an unmapped family no longer burns a tier roll, and
 *     ctx.rng is the WORLD's single stream, not a per-corpse one, so the first
 *     mixed-corpse harvest after this ships re-phases every draw that follows
 *     it in that world. Determinism is untouched (same seed plus same command
 *     sequence gives the same world) and no golden or replay drives
 *     harvestCorpse, so nothing downstream is pinned to the old phase; what it
 *     means in practice is that which harvests happen to mint a specimen is
 *     reshuffled symmetrically rather than made more or less likely.
 *   - It is self-healing. The day claw/tusk/gills/horn get items, every number
 *     returns to today's, with no code change.
 *
 * What is deliberately retired, because "the equivalence survives" must not be
 * read as "nothing moved": on a mixed corpse bonus 0, the unshifted
 * BASE_TIER_WEIGHTS roll #1141 shipped as the spread, is no longer REACHABLE.
 * The widest pick available on those nine templates is now bonus 1 (2 on
 * sethrael_palecoil), because part of their breadth is unreachable content. On
 * the four templates carrying exactly one mapped family (the three murlocs and
 * sethrael_palecoil) that collapses every legal pick to one identical outcome,
 * so the picker there stops being a choice, which is honest: a picker offering
 * one live row and one dead one never was one.
 *
 * The "an explicit full cover spreads exactly like an empty pick" equivalence
 * SURVIVES, and is pinned: both still collapse to `taggedComponents` inside
 * effectiveFocusComponents, so both extract the same set and earn the same
 * bonus. It also WIDENS: on a mixed corpse a cover of just the mapped families
 * now lands in the same class (old_greyjaw `[]`, `['hide','fang','claw']` and
 * `['hide','fang']` are one world). What moved is the value the class shares
 * (old_greyjaw: bonus 0 before, bonus 1 now), not the equality.
 */
export function harvestConcentrationBonus(
  taggedComponents: readonly string[],
  chosen: readonly string[],
): number {
  return concentrationBonusFor(
    taggedComponents.length,
    yieldingFocusComponents(taggedComponents, chosen).length,
  );
}

/** The clamp itself, so the exported reader above and any future caller cannot
 *  write two copies of the tier ceiling. The NUMERATOR is not shared here: the
 *  roll below asks harvestConcentrationBonus itself, which is what actually
 *  keeps the client's `concentrated` hint and the sim's bonus from diverging.
 *  Sharing only the clamp would let a second exclusion reason land in one and
 *  not the other, with nothing to red. */
function concentrationBonusFor(taggedCount: number, extractedCount: number): number {
  return Math.max(0, Math.min(HARVEST_TIERS.length - 1, taggedCount - extractedCount));
}

/**
 * Resolve a per-corpse focus harvest: one independent tier roll per EXTRACTED
 * component, each roll's weight table shifted upward by the concentration bonus
 * above.
 *
 * Formula (monotonic, documented, no invented balance numbers beyond the base
 * weight table above): each component's tier index is
 * `min(rolledIndex + bonus, HARVEST_TIERS.length - 1)`. Covering every tagged
 * component on a corpse whose tags ALL map to an item gives `bonus = 0` (an
 * unshifted roll, the pre-#1142 "spread" behavior); choosing strictly fewer
 * components out of the same tagged set can only raise the shift, never lower
 * it, so concentrating on fewer components always yields an equal-or-higher
 * expected tier per component than spreading wider on the same corpse. On a
 * corpse that also carries an unmapped family, bonus 0 is unreachable: see the
 * ruling on harvestConcentrationBonus above, which owns that.
 *
 * Backward compatibility: an empty `chosen` (no selection made) or a `chosen`
 * that covers every tagged component both default to spreading across all of
 * `taggedComponents`, matching the single-harvest behavior from #1141. A
 * `chosen` naming only tags this corpse does not carry sanitizes to the empty
 * pick, and spreads for that same reason (#2504); see effectiveFocusComponents.
 *
 * Pure: draws only from the passed-in `Rng`, one draw per EXTRACTED component
 * (#2514: an unmapped family costs no draw at all), in
 * `yieldingFocusComponents` order. That filter imposes no order of its own, so
 * this is still the effective pick's order: a strict subset yields in the
 * PICK's order and the spread arm in the corpse's tag order, which is the order
 * the grants and the harvestResult ledger land in (#2457).
 */
export function resolveCorpseFocusHarvest(
  taggedComponents: readonly string[],
  chosen: readonly string[],
  rng: Rng,
): FocusHarvestYield[] {
  const extracted = yieldingFocusComponents(taggedComponents, chosen);
  // The exported reader, not a second numerator that happens to agree today:
  // its one other caller is the picker's view-core, and a hint that disagreed
  // with the roll would be a lie with nothing to red. One extra pure call on a
  // cold command path, no rng touched.
  const bonus = harvestConcentrationBonus(taggedComponents, chosen);
  return extracted.map((component) => ({ component, tier: rollFocusTier(rng, bonus) }));
}

/** How many of the mapped item a yielded tier grants: 1 (poor) through 6 (legendary). */
export function harvestTierQuantity(tier: HarvestTier): number {
  return HARVEST_TIERS.indexOf(tier) + 1;
}

function rollFocusTier(rng: Rng, bonus: number): HarvestTier {
  const totalWeight = BASE_TIER_WEIGHTS.reduce((sum, w) => sum + w, 0);
  let roll = rng.next() * totalWeight;
  let index = 0;
  for (; index < BASE_TIER_WEIGHTS.length - 1; index++) {
    roll -= BASE_TIER_WEIGHTS[index];
    if (roll < 0) break;
  }
  const shifted = Math.min(HARVEST_TIERS.length - 1, index + bonus);
  return HARVEST_TIERS[shifted];
}

// Signed materials (#1145): a corpse-harvested monster material rolls the same
// MaterialRarity ladder a gathering node does (rollMaterialRarity, above), but a
// corpse yield has no per-player proficiency counter to scale off (there is no
// "skinning" gathering profession yet, unlike mining/logging/herbalism): it uses
// a fixed baseline "power" input instead, tuned so a corpse harvest has a real
// but modest chance (about 16%) of coming back rare-or-better. One rng.next()
// draw per harvest that actually yields an item, same one-draw convention as
// rollMaterialRarity itself.
export const CORPSE_HARVEST_RARITY_BASELINE = 40;

export function rollCorpseMaterialRarity(rng: Rng): MaterialRarity {
  return rollMaterialRarity(CORPSE_HARVEST_RARITY_BASELINE, rng);
}

// The rarity floor at which a monster material is stamped with its gatherer's
// name (#1145 acceptance criteria: "rare-or-better"). Below this tier the yield
// stays a plain fungible stack, same as before this issue.
export function isSignableMaterialRarity(rarity: MaterialRarity): boolean {
  return rarity === 'rare' || rarity === 'epic' || rarity === 'legendary';
}
