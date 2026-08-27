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
// The ORANGE PROMOTION (Masterwrought phase 13, R3) is a SEPARATE,
// DETERMINISTIC act on an already-Perfected copy, reached through the same
// perfect_item command: a valid player-chosen name (legendary_name.ts, the
// shape half; the server screens content) plus one Deed of Making promotes
// the copy to legendary PRESENTATION (rolled.quality = 'legendary',
// payload.name = the normalized name; stats BYTE-IDENTICAL, the R5 bonus
// already landed at Perfected). A WORN promotion still runs recalcPlayerStats
// (2026-08-27 review): not for the stats, which cannot move, but because
// recalc is the ONE site the peer eqi mirror (Entity.equippedInstances) is
// rebuilt, so peers see the promoted name and quality at the moment rather
// than at the next unrelated recalc. Never folded into the rank-4 stamp, and
// never a roll: the chain is resolvePerfectingAttempt ->
// resolveLegendaryPromotion -> promotePerfectedCopy below.
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
//   the promotion, WHOLE ...... 0 (deny and success alike: deterministic by
//                               design, R3; no arm of
//                               resolveLegendaryPromotion may ever draw)
//   the craft-time head start . 0 here (crafting.ts's single unconditional
//                               proc draw decides it; this module only names
//                               the rank it stamps)
//   info reads / save+load .... 0
import { ALL_RECIPES, ITEMS } from '../data';
import { markItemDiscovered } from '../deeds';
import { recalcPlayerStats } from '../entity';
import { masterwroughtConflictSlot, uniqueEquipConflictSlot } from '../equipment_rules';
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
import type { CoreStats, Entity, EquipSlot, InvSlot, ItemDef, ItemInstancePayload } from '../types';
import { announceZoneCelebration } from './gather_events';
import { normalizeLegendaryName } from './legendary_name';
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

// Consumed once by the orange promotion (phase 13, R3): exactly one Deed of
// Making, inscription's first 125-rung output (content/recipes.ts
// recipe_deed_of_making), tradable so an inscriptionist scribes it FOR the
// promoter. Deterministic: no roll rides this bill.
export const LEGENDARY_PROMOTION_COST: readonly Readonly<{ itemId: string; count: number }>[] = [
  { itemId: 'deed_of_making', count: 1 },
];

/** The target piece: a passed selection, never id-only (the item_copy_ref
 *  discipline). A worn ref names an equipment slot; a bagged ref names a bag
 *  CELL index AND the item id the caller saw there (validated server-side and
 *  re-validated here through selectedInventorySlot's index-plus-id pin, so a
 *  cell that shifted under a consumption or a sort between the click and the
 *  command resolves to nothing rather than to whatever apex piece now sits
 *  there and binding it). */
export type PerfectItemRef = { slot: EquipSlot } | { bag: number; itemId: string };

export interface PerfectingMaterialView {
  itemId: string;
  required: number;
  /** Lock-aware: copies the owner has locked (item_lock.ts) do not count. */
  have: number;
}

/** The both-hosts view of one piece's Perfecting state, built ONLY by
 *  perfectingInfoFrom below so the offline Sim and the online ClientWorld
 *  mirrors cannot drift. ONLINE CAVEAT for a consumer (phase 14 owns the
 *  UI): `skillMet` reads the crafting-identity mirror, which is all-zero
 *  until the first cprof frame lands, so a consumer gates its skill line on
 *  IWorld.craftingIdentity.synced exactly as the Apply Enchant picker's
 *  viewer.synced does, rather than painting a false "skill unmet" at
 *  startup. */
export interface PerfectingInfoView {
  itemId: string;
  /** Mid-track rank in [0, PERFECTING_RANKS - 1]; 0 for an untouched piece. */
  rank: number;
  ranks: number;
  perfected: boolean;
  /** The copy is already legendary (rolled.quality === 'legendary'): the
   *  phase 13 promotion has happened. Independent of `perfected` so a
   *  legacy legendary-rolled payload reads honestly too. */
  promoted: boolean;
  /** The craft that made this apex piece (craftForApexItem), null off-track. */
  craftId: string | null;
  skillReq: number;
  skillMet: boolean;
  /** boundTo present on the copy (the R2 bind has happened). */
  bound: boolean;
  /** The NEXT act's bill, lock-aware: the three attempt materials while the
   *  copy is unperfected, and the promotion's Deed of Making once
   *  `perfected && !promoted` (the phase 14 window renders whichever rows
   *  arrive; a promoted copy keeps the deed row at have-counts, its
   *  requirement moot). Minimal on purpose: one field, one row shape. */
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
 *  (item_copy_ref.ts): the named cell must exist AND hold the item id the
 *  caller named (the index-plus-id pin every selected-copy consumer in this
 *  repo makes), so a stale cell answers null, never a different item. */
function baggedSlotAt(inventory: InvSlot[], bag: number, itemId: string): InvSlot | null {
  return selectedInventorySlot(inventory, itemId, bag) ?? null;
}

/** The ONE ref-to-copy resolution both command entries share (the attempt and
 *  the phase 13 promotion), so their noItem behavior cannot drift. A worn ref
 *  reads the equipment maps; a bagged ref walks baggedSlotAt above. */
function resolvePerfectTarget(
  meta: PlayerMeta,
  ref: PerfectItemRef,
): {
  itemId: string | undefined;
  payload: ItemInstancePayload | undefined;
  wornSlot: EquipSlot | null;
  bagged: InvSlot | null;
} {
  if ('slot' in ref) {
    const itemId = meta.equipment[ref.slot];
    return {
      itemId,
      payload: meta.equipmentInstance[ref.slot],
      wornSlot: itemId ? ref.slot : null,
      bagged: null,
    };
  }
  const bagged = baggedSlotAt(meta.inventory, ref.bag, ref.itemId);
  return { itemId: bagged?.itemId, payload: bagged?.instance, wornSlot: null, bagged };
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
    const slot = baggedSlotAt(inputs.inventory, ref.bag, ref.itemId);
    itemId = slot?.itemId;
    payload = slot?.instance;
  }
  if (!itemId) return null;
  const craftId = craftForApexItem(itemId);
  const perfected = payload?.perfected === true;
  return {
    itemId,
    rank: payload?.perfecting ?? 0,
    ranks: PERFECTING_RANKS,
    perfected,
    promoted: payload?.rolled?.quality === 'legendary',
    craftId,
    skillReq: PERFECTING_SKILL_REQ,
    skillMet: craftId !== null && (inputs.craftSkills[craftId] ?? 0) >= PERFECTING_SKILL_REQ,
    bound: payload?.boundTo !== undefined,
    materials: (perfected ? LEGENDARY_PROMOTION_COST : PERFECTING_ATTEMPT_COST).map((c) => ({
      itemId: c.itemId,
      required: c.count,
      have: countUnlockedInSlots(inputs.inventory, c.itemId),
    })),
  };
}

/** The resolved target both command entries act on, built ONLY by
 *  resolvePerfectingHead below: the acting player, the resolved copy, and
 *  where it sits (worn slot or bagged cell). */
interface PerfectingTarget {
  meta: PlayerMeta;
  e: Entity;
  itemId: string;
  def: ItemDef;
  payload: ItemInstancePayload | undefined;
  wornSlot: EquipSlot | null;
  bagged: InvSlot | null;
}

/**
 * The ONE resolution head both command entries run (the attempt and the
 * phase 13 promotion), so their shared deny arms and literals exist exactly
 * once: resolve the player, resolve the ref (resolvePerfectTarget above),
 * then the noItem / not-masterwrought / skill ladder in that order, each
 * deny emitting its own line and drawing ZERO rng. A null answer means a
 * deny already emitted (or an unresolvable pid, which emits nothing); a
 * non-null answer passed every shared gate.
 * OWNERSHIP IS BY POSSESSION, presence-only (the shipped Maker's Bond
 * doctrine: trade.ts isTradeLocked and commission.ts unbind check that
 * boundTo is PRESENT, never its value, because entity ids are not
 * session-stable): a bound copy sitting in the acting player's own bags or
 * equipment is theirs by construction, since a bound copy refuses every
 * transfer channel. No arm here ever compares an existing boundTo value.
 */
function resolvePerfectingHead(
  ctx: SimContext,
  pid: number | undefined,
  ref: PerfectItemRef,
): PerfectingTarget | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const meta: PlayerMeta = r.meta;
  const { itemId, payload, wornSlot, bagged } = resolvePerfectTarget(meta, ref);
  // Presence-only ownership (see above): holding the copy IS the credential,
  // so the only noItem arm is an unresolvable ref.
  if (!itemId) {
    ctx.error(meta.entityId, "You don't have that item.");
    return null;
  }
  const def = ITEMS[itemId];
  if (def?.masterwrought !== true) {
    ctx.error(meta.entityId, 'Only Masterwrought items can be perfected.');
    return null;
  }
  // masterwrought R13. A null craftId cannot happen for a shipped apex def
  // (every masterwrought item is a recipe output); it fails the skill gate
  // rather than minting a skill-free path. One gate for BOTH acts: the
  // promotion answers this same line (phase 13 moved the gate above the
  // perfected split; the retired perfectAlready line went with it).
  const craftId = craftForApexItem(itemId);
  if (craftId === null || (meta.craftSkills[craftId] ?? 0) < PERFECTING_SKILL_REQ) {
    ctx.error(meta.entityId, 'Perfecting that requires 125 skill in the craft that made it.');
    return null;
  }
  return { meta, e: r.e, itemId, def, payload, wornSlot, bagged };
}

/**
 * Resolve one Perfecting attempt, or route an already-Perfected copy to the
 * phase 13 promotion (resolveLegendaryPromotion below). The dead gate rides
 * the Sim wrapper (dead_gate.ts, like every profession-action wrapper);
 * everything below is this module's own ladder. DENY LADDER, in order, first
 * match wins, every denial draws ZERO rng and consumes nothing:
 *   2. invalid ref / no item at ref (the shared head)
 *   3. not apex (def.masterwrought !== true) (the shared head)
 *   4. skill under PERFECTING_SKILL_REQ in the craft that made it (the
 *      shared head: one gate guards BOTH acts)
 *   5. already Perfected: route to the promotion through the EXPORTED
 *      resolveLegendaryPromotion, so the export IS the production path (its
 *      own head re-runs the three shared gates, every one already passed
 *      here: zero draws, no emit, nothing consumed; its ladder arms are
 *      documented on promotePerfectedCopy)
 *   6. lock-only material shortfall (raw counts meet the need, unlocked do
 *      not): the DEDICATED locked line, never the missing-materials one
 *   7. genuine material shortfall
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
  name?: string,
): void {
  const head = resolvePerfectingHead(ctx, pid, ref);
  if (!head) return;
  const { meta, e, itemId, def, wornSlot, bagged } = head;
  let { payload } = head;
  if (payload?.perfected === true) {
    resolveLegendaryPromotion(ctx, pid, ref, name);
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
    // Two single-line emits, never one wrapped ternary: the S3 drift guard
    // (tests/localization_fixes.test.ts) scans one call per line and cannot
    // see a literal on a continuation line, so a wrapped call would let a
    // reword of either line pass CI with no matcher.
    if (lockOnly) ctx.error(meta.entityId, 'A material needed for perfecting is locked.');
    else ctx.error(meta.entityId, 'You lack the materials to perfect that item.');
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
    // The alias keeps the emit on ONE line under the 100-column width: the S3
    // drift guard scans one call per line (see the materials arm above).
    const ranks = PERFECTING_RANKS;
    ctx.notice(meta.entityId, `Perfecting: ${def.name} advances to rank ${rank} of ${ranks}.`);
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
          // normalizePrimaryStats writes a 0 for a present axis the delta's
          // largest-remainder pass never reaches; a zero key is never written
          // here (item_instance_merge.ts's structural equality treats a
          // present zero as distinct from absent, and the tooltip would
          // render "+0"), the enchanting.ts replace-arm prune's rule.
          if (value === undefined || value === 0) continue;
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
          e,
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

/**
 * The orange promotion's command entry (Masterwrought phase 13, R3), THE
 * production path: resolvePerfectingAttempt's perfected branch delegates
 * here, so a test or the deeds suite driving this export directly exercises
 * the same chain the live command takes (resolvePerfectingAttempt ->
 * resolveLegendaryPromotion -> promotePerfectedCopy). Runs the shared head
 * (resolvePerfectingHead: the same noItem / not-masterwrought / skill arms
 * with the same lines), then the promotion ladder (promotePerfectedCopy
 * below). PRECONDITION arm rather than a fifth deny line: a copy that is
 * NOT Perfected is unreachable here through the real command
 * (resolvePerfectingAttempt owns that routing and sends an unperfected copy
 * down the attempt ladder instead), so a direct call on one is a caller bug
 * and no-ops: nothing consumed, nothing drawn, no invented player line.
 */
export function resolveLegendaryPromotion(
  ctx: SimContext,
  pid: number | undefined,
  ref: PerfectItemRef,
  name: string | undefined,
): void {
  const head = resolvePerfectingHead(ctx, pid, ref);
  if (!head) return;
  const { meta, e, itemId, def, payload, wornSlot } = head;
  if (payload?.perfected !== true) return;
  promotePerfectedCopy(ctx, meta, e, itemId, def, payload, wornSlot, name);
}

/**
 * The promotion ladder body, THE STAMP SITE (reached only through the chain
 * resolvePerfectingAttempt -> resolveLegendaryPromotion -> here; the dead
 * gate, noItem, not-masterwrought, and skill arms have all answered
 * upstream and the copy is Perfected). DENY LADDER, first match wins, ZERO
 * rng on EVERY arm (deny and success alike, the header's draw contract),
 * nothing consumed on any deny:
 *   1. already legendary (rolled.quality === 'legendary')
 *   2. no name given (undefined / empty)
 *   3. name given but not a legal shape (legendary_name.ts; the server
 *      screens CONTENT before the command reaches the sim)
 *   4. equip legality at legendary (the 2026-08-27 review): re-stamping
 *      effective quality in place would otherwise mint worn states the
 *      equip path refuses (two worn legendaries past the sub-cap; a
 *      duplicate the next login's benchDuplicateUniqueEquipped silently
 *      unequips), so the copy is judged AS IF incoming at legendary
 *      quality. A WORN copy excludes its own slot and answers BOTH equip
 *      rules (uniqueEquipConflictSlot, then masterwroughtConflictSlot, the
 *      items.ts order); a BAGGED copy answers the unique rule against the
 *      worn set (a promoted twin of a worn unique-equipped copy would burn
 *      the deed and the name on a copy it could never wear beside its
 *      twin), while the counted caps stay the equip path's own question (a
 *      bagged legendary is legal to hold and to wear alone; pinned by the
 *      sub-cap interplay case in tests/orange_promotion.test.ts). Every
 *      refusal reuses the equip path's EXACT literal (items.ts equipItem),
 *      so the sim_i18n matchers cover them unchanged.
 *   5. lock-only deed shortfall: the shared locked-material line
 *   6. genuine deed shortfall
 * Success: consume the one Deed of Making (lock-aware, the attempt's consume
 * idiom, one quest resync), stamp rolled.quality = 'legendary' (stats
 * BYTE-IDENTICAL: the R5 bonus landed at Perfected; a Perfected copy whose
 * attempt never minted rolled gets a stats-free { quality } record) and
 * payload.name = the normalized name (signer untouched), mark the legendary
 * discovery at the stamp site (markItemDiscovered, the addItemInstance
 * hub's recipe: the quality:legendary deed mark lands same-tick, never at
 * the next login's retro pass), bump the legendariesForged deed stat, on a
 * WORN copy recalcPlayerStats (the module header says why: the peer eqi
 * mirror rebuild, never the stats), emit the personal legendaryForged event
 * then the legendaryForgedZone fanout (the shared announceZoneCelebration
 * prologue; the masterwork order and instanced-owner skip), and bump
 * wireRev. NO ctx.notice success line: the two events drive the client copy
 * (recorded design).
 */
function promotePerfectedCopy(
  ctx: SimContext,
  meta: PlayerMeta,
  e: Entity,
  itemId: string,
  def: ItemDef,
  payload: ItemInstancePayload,
  wornSlot: EquipSlot | null,
  name: string | undefined,
): void {
  if (payload.rolled?.quality === 'legendary') {
    ctx.error(meta.entityId, 'That work is already legendary.');
    return;
  }
  if (name === undefined || name === '') {
    ctx.error(meta.entityId, 'That work needs a name to become a legend.');
    return;
  }
  const normalized = normalizeLegendaryName(name);
  if (normalized === null) {
    ctx.error(meta.entityId, 'That name cannot be inscribed on the work.');
    return;
  }
  // Arm 4 (the ladder above): the copy as the equip path would judge it once
  // promoted. The synthetic incoming payload keeps `perfected` (the
  // promotion-scoped isUniqueEquipped read requires it) and overrides only
  // the rolled quality; nothing here mutates the real payload yet.
  const asPromoted: ItemInstancePayload = {
    ...payload,
    rolled: { ...payload.rolled, quality: 'legendary' },
  };
  const ignoreSlots: readonly EquipSlot[] = wornSlot ? [wornSlot] : [];
  const uniqueConflict = uniqueEquipConflictSlot(
    def,
    meta.equipment,
    (id) => ITEMS[id],
    ignoreSlots,
    meta.equipmentInstance,
    asPromoted,
  );
  if (uniqueConflict) {
    ctx.error(meta.entityId, 'You can only equip one of those.');
    return;
  }
  const masterwroughtConflict = wornSlot
    ? masterwroughtConflictSlot(
        def,
        meta.equipment,
        (id) => ITEMS[id],
        ignoreSlots,
        meta.equipmentInstance,
        'legendary',
      )
    : null;
  if (masterwroughtConflict) {
    // Two plain calls, each on ONE physical line (the S3 guard rule the
    // deed-shortfall pair below documents); the literals are the equip
    // path's own, matched by the same sim_i18n rows.
    if (masterwroughtConflict.reason === 'legendary') {
      ctx.error(meta.entityId, 'You can only equip one legendary Masterwrought item.');
    } else {
      ctx.error(meta.entityId, 'You can only equip two Masterwrought items.');
    }
    return;
  }
  if (
    LEGENDARY_PROMOTION_COST.some((c) => countUnlockedInSlots(meta.inventory, c.itemId) < c.count)
  ) {
    const lockOnly = LEGENDARY_PROMOTION_COST.every(
      (c) => countRawInSlots(meta.inventory, c.itemId) >= c.count,
    );
    // Two single-line emits, never one wrapped ternary: the S3 drift guard
    // scans one call per line (the attempt's materials arm above says why).
    if (lockOnly) ctx.error(meta.entityId, 'A material needed for perfecting is locked.');
    else ctx.error(meta.entityId, 'You need a Deed of Making to make that work a legend.');
    return;
  }
  for (const c of LEGENDARY_PROMOTION_COST) {
    removeUnlockedFromSlots(meta.inventory, c.itemId, c.count);
  }
  ctx.onInventoryChangedForQuests?.(meta);
  // Presentation only (R3): the quality override rides the same rolled record
  // the R5 stats live on; the stats themselves are untouched by construction
  // (a copy whose attempt never minted rolled gets a stats-free record).
  payload.rolled = { ...payload.rolled, quality: 'legendary' };
  payload.name = normalized;
  // The discovery ledger at the stamp site (the addItemInstance hub's
  // recipe): the quality:legendary mark (a real deed trigger) lands the
  // moment the promotion mints it, never at the next login's retro pass.
  // Draw-free, like every deeds hook.
  markItemDiscovered(ctx, meta, itemId, 'legendary');
  ctx.bumpDeedStat(meta, 'legendariesForged', 1);
  if (wornSlot) {
    // The worn-mutation recipe (the attempt's Perfected stamp above): the
    // derived stats cannot move (R3), but recalcPlayerStats is the ONE site
    // the peer eqi mirror (Entity.equippedInstances) is rebuilt, so peers
    // see the promoted name and quality now rather than at the next
    // unrelated recalc.
    recalcPlayerStats(e, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  }
  const owner = meta.entityId;
  ctx.emit({ type: 'legendaryForged', itemId, name: normalized, owner, pid: owner });
  // The zone celebration through the shared prologue (gather_events.ts
  // announceZoneCelebration, the masterworkZone recipe): one pid-scoped copy
  // per overworld player in the owner's zone, the owner included; skipped
  // entirely for an instanced owner (the personal event alone fires).
  announceZoneCelebration(ctx, owner, (recipientPid, zoneId) => ({
    type: 'legendaryForgedZone',
    pid: recipientPid,
    ownerPid: owner,
    ownerName: meta.name,
    itemId,
    itemName: normalized,
    zoneId,
  }));
  // The same in-place payload-mutation bump the attempt ends on: the owner's
  // heavy self mirrors (inv, einst) re-diff on the next snapshot.
  meta.wireRev++;
}
