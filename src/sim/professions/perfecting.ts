// The Perfecting stage (Masterwrought phase 12, R1): a wearer walks an apex
// (masterwrought-flagged) piece up a rank track to Perfected, paying materials
// per attempt. Self-service: the attempting player owns the piece (worn or
// bagged), needs skill in the craft that made it (masterwrought R13), and pays
// the materials from their own bags. Fail-forward ONLY (R1): a failed attempt
// consumes the materials and never harms or downgrades the piece. The piece
// binds on the FIRST attempt via the Maker's Bond boundTo reuse (R2; base
// pieces stay freely tradable until then). Reaching the top rank deletes the
// track field, stamps `perfected`, and merges the R5-safe bonus-stat delta
// into rolled.stats (the pre-existing generic recalc channel).
//
// Behind the SimContext seam (src/sim/professions/CLAUDE.md): functions taking
// (ctx, ...) plus pure leaves; never a Sim import (PlayerMeta arrives
// type-only, the crafting.ts/commission.ts idiom). `src/sim`-pure: no
// DOM/render/ui/game/net imports, no Math.random/Date.now, host-agnostic.
//
// DRAW CONTRACT (the farming.ts header discipline: restated whole whenever a
// draw moves, never amended one line at a time):
//   attempt, resolved ......... EXACTLY 1 ctx.rng draw (the success roll), at
//                               the documented position: after validation,
//                               after the material consume, after the
//                               first-attempt boundTo stamp; the ONLY draw in
//                               the whole system
//   attempt, every deny arm ... 0 (the whole ladder below, dead gate included)
//   the craft-time head start . 0 here (crafting.ts's single unconditional
//                               proc draw decides it; this module only names
//                               the rank it stamps)
//   info reads / save+load .... 0
import { ALL_RECIPES, ITEMS } from '../data';
import { recalcPlayerStats } from '../entity';
import {
  normalizePrimaryStats,
  PRIMARY_STATS,
  primaryStatBudget,
  QUALITY_ILVL_BONUS,
  slotStatMultForItem,
  TWOHAND_STAT_MULT,
} from '../item_budget';
import { selectedInventorySlot } from '../item_copy_ref';
import { countRawInSlots, countUnlockedInSlots, removeUnlockedFromSlots } from '../item_lock';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { CoreStats, EquipSlot, InvSlot, ItemDef, ItemInstancePayload } from '../types';
import type { ProfessionRecipeRecord } from './types';
import type { CraftSkills } from './wheel';

// The rank track: rank PERFECTING_RANKS is Perfected itself, so the persisted
// `perfecting` field only ever holds a mid-track value in
// [1, PERFECTING_RANKS - 1] (absent = rank 0). Counts derived against the
// qr-12-CADENCE criterion (the derivation is recorded in
// docs/prd/masterwrought/state.md): 4 ranks at 0.8 give E[attempts] = 5, the
// mid-band of the 4-to-6-week target at one Maker's Ember per week.
export const PERFECTING_RANKS = 4;
export const PERFECTING_SUCCESS_CHANCE = 0.8;
// The craft-time masterwork proc on an apex craft stamps this rank instead of
// a quality bump (R1; crafting.ts's effect gate), worth about one week
// (E = 1/0.8 = 1.25 attempts) on the cadence above.
export const PERFECTING_HEADSTART_RANK = 1;
// masterwrought R13: skill 125 in the craft that made the piece.
export const PERFECTING_SKILL_REQ = 125;
// The R5 Power placement: a Perfected piece is budgeted as if its source were
// level 28 (one tier over the raid chest's 27) instead of its recipe's own
// level, at the def's own epic quality.
export const PERFECTED_SOURCE_LEVEL = 28;

// Consumed on EVERY resolved attempt, success or failure. The Maker's Ember is
// the pacing lever (1/week accrual, R4 untouched); the essence and setting
// have faster faucets.
export const PERFECTING_ATTEMPT_COST: readonly Readonly<{ itemId: string; count: number }>[] = [
  { itemId: 'makers_ember', count: 1 },
  { itemId: 'sundered_essence', count: 1 },
  { itemId: 'prismglass_setting', count: 1 },
];

/** The target piece: a passed selection, never id-only (the item_copy_ref
 *  discipline). A worn ref names an equipment slot; a bagged ref names a bag
 *  CELL index (validated server-side and re-validated here). */
export type PerfectItemRef = { slot: EquipSlot } | { bag: number };

export interface PerfectingMaterialView {
  itemId: string;
  required: number;
  /** Lock-aware: copies the owner has locked (item_lock.ts) do not count. */
  have: number;
}

/** The both-hosts view of one piece's Perfecting state, built ONLY by
 *  perfectingInfoFrom below so the offline Sim and the online ClientWorld
 *  mirrors cannot drift. */
export interface PerfectingInfoView {
  itemId: string;
  /** Mid-track rank in [0, PERFECTING_RANKS - 1]; 0 for an untouched piece. */
  rank: number;
  ranks: number;
  perfected: boolean;
  /** The craft that made this apex piece (craftForApexItem), null off-track. */
  craftId: string | null;
  skillReq: number;
  skillMet: boolean;
  /** boundTo present on the copy (the R2 bind has happened). */
  bound: boolean;
  materials: PerfectingMaterialView[];
}

/** The recipe in the merged tables whose result is this APEX item, or null
 *  for a non-apex id (content-derived, never instance-derived). */
function apexRecipeFor(itemId: string): ProfessionRecipeRecord | null {
  if (ITEMS[itemId]?.masterwrought !== true) return null;
  return ALL_RECIPES.find((r) => r.resultItemId === itemId) ?? null;
}

/** The professionId whose skill gates Perfecting this apex item
 *  (masterwrought R13), or null for a non-apex id. */
export function craftForApexItem(itemId: string): string | null {
  return apexRecipeFor(itemId)?.professionId ?? null;
}

/** The def's stat budget at a given SOURCE level, composed exactly the way
 *  item_level.ts expectedStatBudget composes it for the live item (itemLevel's
 *  source + QUALITY_ILVL_BONUS floor, primaryStatBudget with the
 *  slotStatMultForItem override, the two-hand mult applied the same way):
 *  the shipped primitives, never a re-derivation. */
function apexBudgetAtSource(def: ItemDef, sourceLevel: number): number {
  const ilvl = Math.max(1, sourceLevel + (QUALITY_ILVL_BONUS[def.quality ?? 'common'] ?? 0));
  const base = primaryStatBudget(ilvl, def.quality, def.slot, slotStatMultForItem(def));
  return def.kind === 'weapon' && def.hand === 'twohand'
    ? Math.round(base * TWOHAND_STAT_MULT)
    : base;
}

/**
 * The R5 bonus a Perfected copy carries: the primary-stat budget DELTA between
 * source PERFECTED_SOURCE_LEVEL (28) and source recipe.level at the def's own
 * (epic) quality and slot, redistributed over the def's primary profile with
 * normalizePrimaryStats (largest-remainder, deterministic), exactly the
 * masterwork.ts bake's shape. Formula-derived, never a magic number.
 *
 * NOTE: this makes a FOURTH consumer of recipe.level (after item_level.ts's
 * source-index registration, craftActionXp in profession_xp.ts, and the
 * masterwork bake's MasterworkStatsInput.level via crafting.ts
 * craftBonusStatsFor; the 11o QA's "exactly three" was a probe, not a pin).
 * Null when the def carries no slot/primary profile or the delta is not
 * positive.
 */
export function perfectedBonusStats(
  def: ItemDef,
  recipe: Pick<ProfessionRecipeRecord, 'level'>,
): Partial<CoreStats> | null {
  if (!def.slot || !def.stats) return null;
  // Primary stats only, the masterworkBonusStats filter: armor would double.
  const profile: Partial<CoreStats> = {};
  for (const stat of PRIMARY_STATS) {
    const value = def.stats[stat] ?? 0;
    if (value > 0) profile[stat] = value;
  }
  if (Object.keys(profile).length === 0) return null;
  const delta =
    apexBudgetAtSource(def, PERFECTED_SOURCE_LEVEL) - apexBudgetAtSource(def, recipe.level);
  if (delta <= 0) return null;
  return normalizePrimaryStats(profile, delta);
}

/** Resolve a bagged ref through the shared selection walk
 *  (item_copy_ref.ts): a bag ref names a CELL, not an id, so the id
 *  selectedInventorySlot matches against is the named slot's own (the id-match
 *  arm is then vacuously true and the index validation stays in one place).
 *  Null for any invalid index. */
function baggedSlotAt(inventory: InvSlot[], bag: number): InvSlot | null {
  const itemId =
    Number.isInteger(bag) && bag >= 0 && bag < inventory.length ? inventory[bag].itemId : '';
  return selectedInventorySlot(inventory, itemId, bag) ?? null;
}

export interface PerfectingInfoInputs {
  ref: PerfectItemRef;
  inventory: InvSlot[];
  equipment: Readonly<Partial<Record<EquipSlot, string>>>;
  equipmentInstances: Readonly<Partial<Record<EquipSlot, ItemInstancePayload>>>;
  craftSkills: Readonly<CraftSkills>;
}

/** The ONE shared view builder both hosts consume (the offline Sim delegate
 *  and ClientWorld over its mirrors), over plain inputs so it stays
 *  host-agnostic. Null when the ref resolves to no item. */
export function perfectingInfoFrom(inputs: PerfectingInfoInputs): PerfectingInfoView | null {
  const { ref } = inputs;
  let itemId: string | undefined;
  let payload: ItemInstancePayload | undefined;
  if ('slot' in ref) {
    itemId = inputs.equipment[ref.slot];
    payload = inputs.equipmentInstances[ref.slot];
  } else {
    const slot = baggedSlotAt(inputs.inventory, ref.bag);
    itemId = slot?.itemId;
    payload = slot?.instance;
  }
  if (!itemId) return null;
  const craftId = craftForApexItem(itemId);
  return {
    itemId,
    rank: payload?.perfecting ?? 0,
    ranks: PERFECTING_RANKS,
    perfected: payload?.perfected === true,
    craftId,
    skillReq: PERFECTING_SKILL_REQ,
    skillMet: craftId !== null && (inputs.craftSkills[craftId] ?? 0) >= PERFECTING_SKILL_REQ,
    bound: payload?.boundTo !== undefined,
    materials: PERFECTING_ATTEMPT_COST.map((c) => ({
      itemId: c.itemId,
      required: c.count,
      have: countUnlockedInSlots(inputs.inventory, c.itemId),
    })),
  };
}

/**
 * Resolve one Perfecting attempt. The dead gate rides the Sim wrapper
 * (dead_gate.ts, like every profession-action wrapper); everything below is
 * this module's own ladder. DENY LADDER, in order, first match wins, every
 * denial draws ZERO rng and consumes nothing:
 *   2. invalid ref / no item at ref
 *   3. not apex (def.masterwrought !== true)
 *   4. already Perfected
 *   5. skill under PERFECTING_SKILL_REQ in the craft that made it
 *   6. lock-only material shortfall (raw counts meet the need, unlocked do
 *      not): the DEDICATED locked line, never the missing-materials one
 *   7. genuine material shortfall
 * OWNERSHIP IS BY POSSESSION, presence-only (the shipped Maker's Bond
 * doctrine: trade.ts isTradeLocked and commission.ts unbind check that
 * boundTo is PRESENT, never its value, because entity ids are not
 * session-stable): a bound copy sitting in the attempting player's own bags
 * or equipment is theirs by construction, since a bound copy refuses every
 * transfer channel. No arm here ever compares an existing boundTo value.
 * Success path order (the documented rng position): validate, consume the
 * three materials, FIRST ATTEMPT ONLY stamp boundTo = pid (R2 Maker's Bond
 * reuse; only when boundTo is undefined, an existing value is left untouched
 * whatever it is) and emit the bind notice, then draw
 * EXACTLY ONE ctx.rng.next(). roll < PERFECTING_SUCCESS_CHANCE: rank+1 (the
 * advance notice); reaching PERFECTING_RANKS: delete payload.perfecting, set
 * payload.perfected = true, merge perfectedBonusStats ADDITIVELY into
 * payload.rolled.stats (create rolled if absent; NEVER set rolled.masterwork),
 * emit the done notice, and on a WORN copy recalcPlayerStats plus the same
 * wireRev bump the rift forge ops use. Roll at or over the chance: the fail
 * notice; materials are spent either way (fail-forward, R1).
 */
export function resolvePerfectingAttempt(
  ctx: SimContext,
  pid: number | undefined,
  ref: PerfectItemRef,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const meta: PlayerMeta = r.meta;
  let itemId: string | undefined;
  let payload: ItemInstancePayload | undefined;
  let wornSlot: EquipSlot | null = null;
  let bagged: InvSlot | null = null;
  if ('slot' in ref) {
    itemId = meta.equipment[ref.slot];
    payload = meta.equipmentInstance[ref.slot];
    wornSlot = itemId ? ref.slot : null;
  } else {
    bagged = baggedSlotAt(meta.inventory, ref.bag);
    itemId = bagged?.itemId;
    payload = bagged?.instance;
  }
  // Presence-only ownership (see the header): holding the copy IS the
  // credential, so the only noItem arm is an unresolvable ref. boundTo is
  // never compared here.
  if (!itemId) {
    ctx.error(meta.entityId, "You don't have that item.");
    return;
  }
  const def = ITEMS[itemId];
  if (def?.masterwrought !== true) {
    ctx.error(meta.entityId, 'Only Masterwrought items can be perfected.');
    return;
  }
  if (payload?.perfected === true) {
    ctx.error(meta.entityId, 'That item is already Perfected.');
    return;
  }
  // masterwrought R13. A null craftId cannot happen for a shipped apex def
  // (every masterwrought item is a recipe output); it fails the skill gate
  // rather than minting a skill-free path.
  const craftId = craftForApexItem(itemId);
  if (craftId === null || (meta.craftSkills[craftId] ?? 0) < PERFECTING_SKILL_REQ) {
    ctx.error(meta.entityId, 'Perfecting that requires 125 skill in the craft that made it.');
    return;
  }
  // Sufficiency counted lock-aware (issue 3042 doctrine, the crafting.ts
  // precedent); the raw twin splits a lock-only shortfall onto its dedicated
  // line.
  if (
    PERFECTING_ATTEMPT_COST.some((c) => countUnlockedInSlots(meta.inventory, c.itemId) < c.count)
  ) {
    const lockOnly = PERFECTING_ATTEMPT_COST.every(
      (c) => countRawInSlots(meta.inventory, c.itemId) >= c.count,
    );
    ctx.error(
      meta.entityId,
      lockOnly
        ? 'A material needed for perfecting is locked.'
        : 'You lack the materials to perfect that item.',
    );
    return;
  }
  // Consume: fungible materials through the lock-aware id walk (the
  // crafting.ts reagent precedent), one quest resync for the whole removal.
  for (const c of PERFECTING_ATTEMPT_COST) {
    removeUnlockedFromSlots(meta.inventory, c.itemId, c.count);
  }
  ctx.onInventoryChangedForQuests?.(meta);
  // First attempt: the copy gains a payload if it never had one (a plain
  // fungible apex copy; apex gear is stack-cap 1, so the named cell IS the
  // copy) and binds to the attempting player (R2).
  if (payload === undefined) {
    payload = {};
    if (wornSlot) meta.equipmentInstance[wornSlot] = payload;
    else if (bagged) bagged.instance = payload;
  }
  if (payload.boundTo === undefined) {
    payload.boundTo = meta.entityId;
    ctx.notice(meta.entityId, `Perfecting begins: ${def.name} is now bound to you.`);
  }
  // THE ONE DRAW (see the module header's draw contract).
  const roll = ctx.rng.next();
  if (roll < PERFECTING_SUCCESS_CHANCE) {
    const rank = (payload.perfecting ?? 0) + 1;
    ctx.notice(
      meta.entityId,
      `Perfecting: ${def.name} advances to rank ${rank} of ${PERFECTING_RANKS}.`,
    );
    if (rank >= PERFECTING_RANKS) {
      delete payload.perfecting;
      payload.perfected = true;
      const recipe = apexRecipeFor(itemId);
      const bonus = recipe ? perfectedBonusStats(def, recipe) : null;
      if (bonus) {
        // Additive merge into the pre-existing generic recalc channel, the
        // enchantedPayloadFor shape; rolled.masterwork is never set here.
        const stats: Record<string, number> = { ...payload.rolled?.stats };
        for (const [stat, value] of Object.entries(bonus)) {
          if (value === undefined) continue;
          stats[stat] = (stats[stat] ?? 0) + value;
        }
        payload.rolled = { ...payload.rolled, stats };
      }
      ctx.notice(meta.entityId, `${def.name} is now Perfected!`);
      if (wornSlot) {
        // The worn-mutation recipe (professions/enchanting.ts's worn apply):
        // re-bake derived stats off the per-slot rolled.stats, which also
        // rebuilds the render mirror.
        recalcPlayerStats(
          r.e,
          meta.cls,
          meta.equipment,
          ctx.playerMods(meta),
          meta.equipmentInstance,
        );
      }
    } else {
      payload.perfecting = rank;
    }
  } else {
    ctx.notice(meta.entityId, 'The perfecting attempt fails; the materials are spent.');
  }
  // The rift forge ops' wire bump on an in-place payload mutation: the owner's
  // heavy self mirrors (inv, einst) re-diff on the next snapshot. Every
  // resolved attempt mutated the bags (materials), so bump on both outcomes.
  meta.wireRev++;
}
