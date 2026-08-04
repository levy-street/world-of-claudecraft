// Gathering tool tier gating (#1123, extended by #1135). A base gathering
// tool has a tier; the tool's tier gates which node tiers AND which monster
// material tiers it can gather/harvest, via one shared comparator. This
// module is a pure leaf: no SimContext state, just the comparison +
// item-shape helpers, so it is Vitest-importable directly (like
// threat.ts/spatial.ts).
//
// This repo has no durability mechanic anywhere in ItemDef (see types.ts):
// a base gathering tool never carries a durability field, so it can never
// become unusable from durability loss. That is a property of the item shape,
// not something this module enforces at runtime.

import {
  GATHERING_PROFESSION_IDS,
  type GatheringProfessionId,
  TOOL_EFFECTS,
  type ToolEffectId,
} from '../content/professions';
import type { InvSlot, ItemDef, ItemUse } from '../types';
import { DISENCHANT_MATERIAL_BY_QUALITY } from './disenchant_reagents';
import type { MaterialRarity } from './gathering';
import { type CraftSkillState, rechargeDiscountMultiplier } from './wheel';

export interface GatherToolUse {
  type: 'gatherTool';
  professionId: GatheringProfessionId;
  tier: number;
}

export function isGatherToolUse(use: ItemUse | undefined): use is GatherToolUse {
  return !!use && use.type === 'gatherTool';
}

// Returns the tool's gathering tier, or undefined if the item is not a
// gathering tool for the given profession.
export function gatherToolTier(
  item: ItemDef | undefined,
  professionId: GatheringProfessionId,
): number | undefined {
  if (!item?.use || !isGatherToolUse(item.use)) return undefined;
  if (item.use.professionId !== professionId) return undefined;
  return item.use.tier;
}

// Shared pure comparator (#1135): a tool of a given tier covers its own tier and
// every tier below it, never above. Both node gating and monster-material
// gating reuse this single comparison so the semantics can never drift apart.
function toolTierCovers(toolTier: number, targetTier: number): boolean {
  return toolTier >= targetTier;
}

// True only when the player's tool tier is at least the node/material tier:
// a tier-1 tool cannot gather a tier-2+ node, a tier-2 tool can gather tier 1
// and tier 2, and so on. A tool's rarity (ItemDef `quality`) never enters THIS
// check: gating is tier-only, and that is the part that must never change.
//
// Rarity is no longer cosmetic, though, which amends the older claim here.
// It buys narrow bonuses that cannot affect access: charges on a slotted
// effect (`startingDurabilityFor`) and a wider reel window on a rod. An epic
// tool opens no node a common tool of the same tier cannot, which is exactly
// what this function keeps true. Rarity is also a COARSENING of tier rather
// than a second axis: every shipped gathering tool's rarity follows its tier,
// and tiers 1 and 2 are both common.
export function canGatherTier(playerToolTier: number, nodeTier: number): boolean {
  return toolTierCovers(playerToolTier, nodeTier);
}

// True only when the player's tool tier is at least the monster material's
// tier (#1135): e.g. skinning/harvesting a material off a slain monster. Same
// semantics as `canGatherTier`, reusing the one shared comparator so node
// gating and monster-material gating can never fall out of sync.
export function canHarvestMonsterMaterial(toolTier: number, materialTier: number): boolean {
  return toolTierCovers(toolTier, materialTier);
}

// Owned-best tool resolution (Professions 2.0). Bare hands resolve to
// effective tool tier 1 for the surfaces that still allow them (corpse
// harvesting, the fishing catch-band floor); NODE gathering does not (#2343,
// below). `items` is passed as a parameter (never imported) so this module
// stays a pure leaf.
export const BARE_HANDS_TOOL_TIER = 1;

// No matching-profession tool owned at all. Distinct from the bare-hands
// floor: node gathering (#2343, the RuneScape rule) requires a REAL tool for
// every node, so its gate needs to see "none" rather than the floored tier.
export const NO_TOOL_OWNED = 0;

// The best (highest) matching-profession gatherTool tier anywhere in the
// player's bags, or NO_TOOL_OWNED when none is carried. Pure bag scan, no
// equip slot: owning the tool is carrying it.
// ACCESS AND GRADE DECISIONS DO NOT BELONG HERE (R22): this is the raw
// OWNERSHIP scan, kept for the price family (R47 ratchet, R30 recharge) and
// for tests; any surface deciding what a player may WORK or MINT must use
// the wield-filtered sibling in professions/wield_gate.ts, or a traded tool
// silently skips its use requirement.
export function bestOwnedGatherToolTierOrNone(
  inventory: readonly InvSlot[],
  professionId: GatheringProfessionId,
  items: Readonly<Record<string, ItemDef>>,
): number {
  let best = NO_TOOL_OWNED;
  for (const slot of inventory) {
    const tier = gatherToolTier(items[slot.itemId], professionId);
    if (tier !== undefined && tier > best) best = tier;
  }
  return best;
}

// The best matching-profession gatherTool tier, floored at
// BARE_HANDS_TOOL_TIER. The bare-hands-tolerant surfaces (corpse harvesting,
// fishing's band cap and bite/reel synergy) read this one.
export function bestOwnedGatherToolTier(
  inventory: readonly InvSlot[],
  professionId: GatheringProfessionId,
  items: Readonly<Record<string, ItemDef>>,
): number {
  return Math.max(
    BARE_HANDS_TOOL_TIER,
    bestOwnedGatherToolTierOrNone(inventory, professionId, items),
  );
}

/** The best owned tool as BOTH of the axes a bonus can read: its tier and its
 *  own rarity. */
export interface OwnedGatherTool {
  /** Same number `bestOwnedGatherToolTier` returns, bare-hands floor included. */
  tier: number;
  /**
   * The same scan WITHOUT the bare-hands floor: NO_TOOL_OWNED when no matching
   * tool is carried, exactly as `bestOwnedGatherToolTierOrNone` reports it.
   * Carried alongside `tier` so a caller that must distinguish "no tool" from
   * "tier 1" (the node gate's rule, and the slot gate's) gets both answers from
   * ONE bag walk instead of scanning twice.
   */
  ownedTier: number;
  /**
   * The winning tool's `quality`, or 'common' when the tier came from the
   * bare-hands floor rather than from a def. Typed as the full `ItemDef`
   * quality union rather than `MaterialRarity`, because a def may legitimately
   * carry `'poor'` or omit `quality` entirely, and both are values
   * `MaterialRarity` excludes. Every consumer routes through
   * `rarityLadderIndex`, which floors them at the common rung.
   */
  rarity: ItemDef['quality'];
}

// The rarity-carrying twin of `bestOwnedGatherToolTier`, for the one bonus that
// reads a tool's rarity off the LIVE path (the rod reel window). Kept beside it
// rather than folded into it because every other caller wants the bare number,
// and widening the three tier-only gates to carry a rarity they never read is
// exactly the coupling the per-profession slot decision avoided.
//
// Ordered by tier FIRST and rarity only as the tie-break, so it can never
// prefer a shinier low-tier tool over a plainer high-tier one. No shipped
// content reaches the tie-break: every gathering tool's rarity is a function of
// its tier, so no two tools of one profession share a tier at different
// rarities. It is here so that a future pair which does share a tier resolves
// deterministically instead of by bag order, which is player-controlled.
export function bestOwnedGatherToolFor(
  inventory: readonly InvSlot[],
  professionId: GatheringProfessionId,
  items: Readonly<Record<string, ItemDef>>,
): OwnedGatherTool {
  let best: OwnedGatherTool = {
    tier: BARE_HANDS_TOOL_TIER,
    ownedTier: NO_TOOL_OWNED,
    rarity: 'common',
  };
  for (const slot of inventory) {
    const def = items[slot.itemId];
    const tier = gatherToolTier(def, professionId);
    if (tier === undefined) continue;
    const rarity = def?.quality ?? 'common';
    if (
      tier > best.ownedTier ||
      (tier === best.ownedTier && rarityLadderIndex(rarity) > rarityLadderIndex(best.rarity))
    ) {
      best = { tier: Math.max(BARE_HANDS_TOOL_TIER, tier), ownedTier: tier, rarity };
    }
  }
  return best;
}

// True when the player carries ANY fishing implement: the simple pole
// (use.type 'fishing') or a tiered fishing-profession gatherTool rod. The
// startFishing implement gate (#2343: casting a line always needs tackle in
// bags, the node-tool rule's fishing arm) reads this; pure bag scan.
export function hasFishingImplement(
  inventory: readonly InvSlot[],
  items: Readonly<Record<string, ItemDef>>,
): boolean {
  return inventory.some((slot) => {
    const use = items[slot.itemId]?.use;
    return (
      !!use &&
      (use.type === 'fishing' || (use.type === 'gatherTool' && use.professionId === 'fishing'))
    );
  });
}

// The best owned gatherTool tier across EVERY gathering profession, floored at
// BARE_HANDS_TOOL_TIER. It was the corpse-harvest gate's input until R22/R50
// moved that arm onto the wield-filtered sibling (wield_gate.ts
// bestWieldableAnyGatherToolTier); no production path reads it today. Kept
// DELIBERATELY as the cross-profession OWNERSHIP reference: the corpse suite
// uses it as its ownership oracle, and the tool-gate guard pins by name that
// interaction.ts never regresses onto it.
export function bestOwnedAnyGatherToolTier(
  inventory: readonly InvSlot[],
  items: Readonly<Record<string, ItemDef>>,
): number {
  let best = BARE_HANDS_TOOL_TIER;
  for (const professionId of GATHERING_PROFESSION_IDS) {
    const tier = bestOwnedGatherToolTier(inventory, professionId, items);
    if (tier > best) best = tier;
  }
  return best;
}

// Tool effect slotting (#1136). Durability is a standalone counter on a
// `ToolEffectSlot`, and the caller owns where that slot lives.
//
// The original note here said this repo had no per-instance item payload to
// hang charges on. That is no longer true: `ItemInstancePayload` (types.ts)
// carries `charges?: Record<string, number>`, described in exactly those
// words, it is deep-cloned already, and inventory ships wholesale over the
// wire, so a payload-resident counter would get persistence and the wire for
// free. The route was re-examined on those facts rather than on the old note,
// and the slot still does NOT live there, for a reason that has nothing to do
// with availability:
//
// the live harvest path resolves a TOOL TIER, never a tool. Nothing on it ever
// holds the particular pick that satisfied the gate, because the tier scans
// return a number: fishing's band cap still reads
// `bestOwnedGatherToolTierOrNone`, and the node and corpse gates read the
// wield-filtered siblings in wield_gate.ts (R22). Keying a slot per item
// would mean widening all three to carry an item through, and a slot bought
// for a tier-4 pick would go inert the moment its owner crafts the tier-5 one,
// which inverts the point of giving players a reason to chase the better tool.
//
// So a slot is keyed per gathering profession by its owner (PlayerMeta), and
// this module stays a pure leaf that stores nothing: it is handed a slot and
// returns what the slot does.
// Always-or-prompt-on-use configuration (#1138): a high-value slotted effect
// spends a charge every use it fires. 'always' preserves #1136's original
// baseline (fires and spends every use, no gate). 'prompt' means the player
// must explicitly confirm each use before it is allowed to fire and spend a
// charge; an unconfirmed use skips the effect entirely (no bonus, no charge
// spent) while the underlying harvest/craft action still proceeds.
export type ToolEffectConfirmMode = 'always' | 'prompt';

// Shared frozen empty projection result for Sim.toolEffectSlotsFor: it runs
// per tick per session on the snapshot path and almost every player has no
// slotted effect, so the empty arm must never allocate. The facet type is
// readonly and every consumer only iterates the rows.
export const EMPTY_TOOL_EFFECT_SLOT_VIEWS: readonly never[] = Object.freeze([]);

// The longest crafter name a legal mint can stamp: character names come
// through server/auth.ts's `/^[A-Za-z][A-Za-z' -]{1,15}$/`, so 16 characters.
// normalizeToolEffectSlots drops a longer stored craftedBy as corrupt
// (phase 16: the one professions blob field with no length ceiling at all).
export const MAX_CRAFTED_BY_LENGTH = 16;

/**
 * True only for a string a legal mint could have stamped as a crafter name:
 * at most MAX_CRAFTED_BY_LENGTH characters AND printable ASCII throughout.
 *
 * The char-code half is what makes this a BYTE bound rather than a
 * code-unit one: the auth name alphabet is ASCII, so a multi-byte string has
 * no legal mint at all, and 16 code units of astral characters weigh several
 * times a name's once JSON escapes them, which is exactly how a corrupt row
 * evades a length-only test and rides every autosave. Deliberately looser
 * than the auth regex itself: the persisted value has to outlive a future
 * widening of the legal alphabet, so this bounds the SHAPE and never the
 * spelling.
 *
 * Two readers, so the rule cannot drift apart: normalizeToolEffectSlots
 * below, and the payload `signer` arm in src/sim/item_instance_load.ts.
 */
export function isLegalCrafterName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_CRAFTED_BY_LENGTH) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

export interface ToolEffectSlot {
  effectId: ToolEffectId;
  /** Remaining charges. Reaches 0 when the effect is fully depleted. */
  durability: number;
  /**
   * The slot's high-water CEILING and price-rung floor (R47), not the
   * recharge target: a recharge fills to the R30 re-derived maximum of the
   * tool held at recharge time (`resolveRechargeToolEffect.newMax`) and this
   * field only bounds it from above. Raised at mint, by a recharge whose
   * fill exceeds it, and by the use-time ratchet (`ratchetCeilingForUse`);
   * never lowered except by a fresh re-slot (the charm is the toll).
   * `rarityRungForMaxDurability` reads the price rung back out of it, which
   * is what makes stashing a good tool unable to buy a cheap fill.
   */
  maxDurability: number;
  /**
   * Character NAME of whoever produced this effect via the production craft
   * that made it (#1137): the consumed charm copy's `instance.signer`, the
   * identity the craft signing rule stamps on every rare-output copy and the
   * one the whole signer ecosystem compares (never an entity id, which
   * restarts at 1 every boot). Additive and optional: undefined means the
   * consumed copy carried no signer, or the slot predates the acquisition
   * craft. Recharging reads this only to decide the original-crafter
   * discount; it never gates the base tool or the bonus itself.
   */
  craftedBy?: string;
  /** How this slot's effect fires. Defaults to 'always' (see slotEffect). */
  confirmMode: ToolEffectConfirmMode;
}

// Attaches an effect from the catalog to a tool, at its full starting
// durability. Re-slotting (calling this again) always resets to full charges,
// same as installing a fresh effect. `craftedBy` (#1137) records the player
// id of the production craft that made this effect, if known; omit it when no
// identity is available (the slot is then never eligible for the
// original-crafter recharge discount). `confirmMode` (#1138) defaults to
// 'always' so a caller that never touches the new config gets #1136's exact
// prior behavior. Keyword options (not positional) so a future third option
// can't silently rebind an existing one.
export function slotEffect(
  effectId: ToolEffectId,
  options: {
    craftedBy?: string;
    confirmMode?: ToolEffectConfirmMode;
    toolRarity?: ItemDef['quality'];
  } = {},
): ToolEffectSlot {
  const { craftedBy, confirmMode = 'always', toolRarity = 'common' } = options;
  const durability = startingDurabilityFor(effectId, toolRarity);
  return {
    effectId,
    durability,
    maxDurability: durability,
    craftedBy,
    confirmMode,
  };
}

/** Stable deny vocabulary for one slot request (the trainResult idiom: ids,
 *  not prose; the client renders localized copy). `invalid_request` covers the
 *  shapes an honest client never sends (unknown profession/effect, a
 *  policy-refused pair, a mode outside the union); `no_tool`, `no_charm` and
 *  `no_gain` (the byte-equal re-slot, which would burn a charm for nothing)
 *  are the three an honest player can hit. */
export type SlotToolEffectDenyReason = 'invalid_request' | 'no_tool' | 'no_charm' | 'no_gain';

export type ResolvedSlotToolEffect =
  | {
      ok: true;
      professionId: GatheringProfessionId;
      slot: ToolEffectSlot;
      /** Inventory index of the charm copy the mint consumes (one unit). */
      consumeIndex: number;
    }
  | { ok: false; reason: SlotToolEffectDenyReason };

/**
 * Resolve one slot request into the slot it should mint plus the charm copy
 * it consumes, or a typed refusal.
 *
 * The whole decision lives here rather than on the Sim coordinator, matching
 * what `resolveTrain` does for `Sim.trainRecipe`: none of these gates need the
 * coordinator's private mutable state, they need an inventory and an item
 * table, and this module already takes both as parameters. That also makes
 * every refusal arm unit-testable without constructing a Sim. THIS RESOLVER IS
 * THE ONE MINT AUTHORITY: the wire command, the offline console handle, and
 * the load-time normalizer (via the shared `slotToolEffectRefused` policy) all
 * answer to the same gates, so no path can mint what another path refuses (the
 * free-grant incident was exactly a second path with fewer gates).
 *
 * Seven refusals, all before any mutation and all draw-free (the seventh,
 * the no_gain re-slot with its R48 directional provenance arm, is documented
 * at its own check below):
 *   - a profession id that is not a gathering profession
 *   - an effect id absent from the live catalog
 *   - a pair the slot POLICY refuses (`slotToolEffectRefused` below: the
 *     Springback Charm everywhere, every effect on fishing)
 *   - any confirm mode outside the union. A malformed value is refused
 *     OUTRIGHT rather than falling back; 'prompt' is accepted since the R40
 *     confirm flow shipped: the harvest command carries the per-use consent
 *     (confirmEffectUse), completeGatherCast threads it into the grade
 *     resolution and the grant, and `applyToolEffectUse` gates the fire, so
 *     a 'prompt' slot genuinely asks first and an unconfirmed use costs
 *     nothing.
 *   - no REAL tool carried for that profession. Reads
 *     `bestOwnedGatherToolTierOrNone`, which returns NO_TOOL_OWNED rather than
 *     the bare-hands floor, so carrying nothing is not carrying a tier-1 tool.
 *   - no charm ITEM for the effect carried (the acquisition craft's whole
 *     point: minting a slot consumes one crafted copy, so the slot is never
 *     free). Which copy matters, because a copy's `instance.signer` becomes
 *     the slot's `craftedBy`: the scan prefers (1) a copy the slotter signed
 *     themselves, which is the only provenance that can ever earn THEM the
 *     original-crafter recharge discount, then (2) an unsigned copy, so a
 *     bought signed charm is preserved over a provenance-free one, then (3)
 *     the first signed copy in bag order.
 *
 * `craftedBy` is the consumed copy's `signer`: the character NAME the craft
 * signing rule stamps on every rare-output copy (crafting.ts, #1149). That is
 * the identity the whole signer ecosystem already compares (the self-signed
 * craft discount, Battlefield Experience attribution), and it survives
 * restarts, which an entity id never could. An unsigned copy (nothing mints
 * one today; dev grants and pre-craft saves can) slots with `craftedBy`
 * unset and pays the generic recharge rate forever.
 */
export function resolveSlotToolEffect(
  inventory: readonly InvSlot[],
  professionId: string,
  effectId: string,
  confirmMode: ToolEffectConfirmMode,
  items: Readonly<Record<string, ItemDef>>,
  // Both explicitly required (undefined must be a deliberate spelling, never
  // an omission): dropping `live` silently disables the no_gain double-click
  // protection, and dropping `slotterName` disables the self-signed consume
  // preference and the R48 upgrade arm, so a caller that lacks either must
  // say so at the call site.
  slotterName: string | undefined,
  live: ToolEffectSlot | undefined,
): ResolvedSlotToolEffect {
  if (!(GATHERING_PROFESSION_IDS as readonly string[]).includes(professionId)) {
    return { ok: false, reason: 'invalid_request' };
  }
  if (!Object.hasOwn(TOOL_EFFECTS, effectId)) return { ok: false, reason: 'invalid_request' };
  if (slotToolEffectRefused(professionId, effectId)) {
    return { ok: false, reason: 'invalid_request' };
  }
  if (confirmMode !== 'always' && confirmMode !== 'prompt') {
    return { ok: false, reason: 'invalid_request' };
  }
  const profession = professionId as GatheringProfessionId;
  const best = bestOwnedGatherToolFor(inventory, profession, items);
  if (best.ownedTier === NO_TOOL_OWNED) return { ok: false, reason: 'no_tool' };
  const consumeIndex = charmIndexToConsume(inventory, effectId, items, slotterName);
  if (consumeIndex === -1) return { ok: false, reason: 'no_charm' };
  // The zero-benefit refusal, the R9 doctrine applied to the mint itself: a
  // re-slot whose minted slot would gain the player NOTHING buys them
  // nothing and costs them a whole charm (four hundred copper of reagents).
  // Checked AFTER the consume-copy choice, and each conjunct below names the
  // something it protects: a different effect; a different confirm mode; a
  // ceiling the new mint would MOVE in either direction (up on a better
  // tool, and DOWN on a lesser one, which is R47's sanctioned escape off a
  // high price rung, so an exactly-full downgrade re-slot must land);
  // charges genuinely restored; and the R48 provenance arm.
  //
  // The provenance arm is DIRECTIONAL (R48), not any-change: recharging is
  // owner-performed (R46), so `isOriginalCrafter` can only ever match the
  // OWNER, and a craftedBy rewrite is economically real only TOWARD the
  // slotter's own signature (re-slotting one's own signed charm over a
  // bought slot to claim the original-crafter discount). A rewrite AWAY from
  // the slotter's signature (to a foreign name, or to no provenance) buys
  // the owner strictly nothing and is refused with the rest: the case that
  // made this load-bearing is the double-click whose first click consumed
  // the last self-signed copy, where the second click would otherwise fall
  // to a foreign copy, burn it, and silently retire the owner's discount.
  // What remains refused is every no-gain case, which is what makes a
  // double-click safe in every bag composition: the second command answers
  // no_gain instead of eating a second charm.
  const mintedMax = startingDurabilityFor(effectId as ToolEffectId, best.rarity);
  const consumedSigner = inventory[consumeIndex].instance?.signer;
  const provenanceUpgrade =
    consumedSigner !== undefined &&
    slotterName !== undefined &&
    consumedSigner === slotterName &&
    live !== undefined &&
    live.craftedBy !== slotterName;
  if (
    live !== undefined &&
    live.effectId === effectId &&
    live.confirmMode === confirmMode &&
    live.maxDurability === mintedMax &&
    live.durability >= mintedMax &&
    !provenanceUpgrade
  ) {
    return { ok: false, reason: 'no_gain' };
  }
  return {
    ok: true,
    professionId: profession,
    consumeIndex,
    slot: slotEffect(effectId as ToolEffectId, {
      confirmMode,
      toolRarity: best.rarity,
      craftedBy: consumedSigner,
    }),
  };
}

/** The charm copy a successful slot consumes, by the preference order the
 *  resolver doc states (self-signed, then unsigned, then first signed), or -1
 *  when no copy of the effect's charm is carried. Bag order breaks ties
 *  inside a preference class, which is player-visible state, not a hidden
 *  coin flip. Pure scan, no rng. */
function charmIndexToConsume(
  inventory: readonly InvSlot[],
  effectId: string,
  items: Readonly<Record<string, ItemDef>>,
  slotterName?: string,
): number {
  let unsigned = -1;
  let signed = -1;
  for (let index = 0; index < inventory.length; index++) {
    const entry = inventory[index];
    const use = items[entry.itemId]?.use;
    if (!use || use.type !== 'toolEffect' || use.effectId !== effectId) continue;
    const signer = entry.instance?.signer;
    if (signer !== undefined && slotterName !== undefined && signer === slotterName) return index;
    if (signer === undefined) {
      if (unsigned === -1) unsigned = index;
    } else if (signed === -1) {
      signed = index;
    }
  }
  return unsigned !== -1 ? unsigned : signed;
}

/**
 * Slot policy (R9): pairs refused even though the catalog knows the effect.
 * Two arms, both wire-it-then-widen rather than ship-it-inert:
 *
 * - Every respawnSpeed-kind effect (today Springback Charm), on every
 *   profession: that bonus arm is a deliberate no-op (`applyEffectBonus`
 *   returns the outcome unchanged, pinned in tests/professions_tools.test.ts)
 *   while the catalog description still promises respawn shortening, so a
 *   slotted charm would be a permanently inert row advertising a bonus it
 *   never delivers. (It would not even burn charges under R42, which makes
 *   it quieter than the old unconditional-depletion reading of this policy,
 *   not more honest.) Keyed off the catalog KIND, not the id, so a renamed
 *   charm cannot slip past the policy while the unknown-id arm refuses the
 *   old name. Refused until the bonus arm is wired for real.
 * - fishing, for every effect: `completeFishing` never consults the effect
 *   system, so a fishing slot would be mintable, HUD-rendered, and inert:
 *   never fires, never spends. Refused until an effect has real fishing
 *   behavior (wiring one needs its own draw-order review; the catch-table
 *   draw sits ahead of the grant).
 *
 * Consulted by BOTH arms so they cannot drift: `resolveSlotToolEffect` (the
 * mint) and `normalizeToolEffectSlots` (the load), where a persisted row
 * minted before this policy existed drops exactly like a retired id.
 */
export function slotToolEffectRefused(professionId: string, effectId: string): boolean {
  if (professionId === 'fishing') return true;
  return (
    Object.hasOwn(TOOL_EFFECTS, effectId) &&
    TOOL_EFFECTS[effectId as ToolEffectId].kind === 'respawnSpeed'
  );
}

/**
 * Deep-copy slots on the way OUT to a save, so the persisted snapshot can never
 * alias the live counters. `depleteEffect` mutates `durability` IN PLACE (on
 * every harvest the bonus mattered for, and the recharge rewrites both
 * counters), so a shallow spread would hand the save layer the same objects
 * the sim keeps mutating.
 */
export function structuredCloneToolEffectSlots(
  slots: Partial<Record<GatheringProfessionId, ToolEffectSlot>>,
): Partial<Record<GatheringProfessionId, ToolEffectSlot>> {
  const out: Partial<Record<GatheringProfessionId, ToolEffectSlot>> = {};
  for (const professionId of GATHERING_PROFESSION_IDS) {
    const slot = slots[professionId];
    if (slot) out[professionId] = { ...slot };
  }
  return out;
}

/**
 * Re-validate persisted tool-effect slots on the way IN, returning undefined
 * when nothing usable survives.
 *
 * Undefined rather than `{}` is the contract, and it is load-bearing: the
 * caller assigns the PlayerMeta field only when this returns a value, so a
 * character who has never slotted an effect keeps the field ABSENT. An empty
 * object still serializes into the parity state digest, and initialising it
 * moved every golden in the suite for a feature no scenario uses.
 *
 * Persisted JSONB is data the process wrote, not data a client sent, but it can
 * still be older than the content it names: retiring an effect id or a
 * gathering profession would otherwise load a slot that no catalog lookup can
 * resolve, and `TOOL_EFFECTS[slot.effectId]` is a bare index that would hand
 * `applyEffectBonus` an undefined def and throw on the next harvest. Every row
 * is therefore checked against live content and every counter validated
 * (durability clamped into [0, max]; the max validated but deliberately
 * without an upper clamp, see the one-sided note below), rather
 * than trusted because it came from our own save. Rows the slot POLICY refuses
 * (`slotToolEffectRefused`) drop the same way: a row minted before the policy
 * existed must not outlive it through a restart.
 */
export function normalizeToolEffectSlots(
  saved: Partial<Record<string, ToolEffectSlot>> | undefined,
): Partial<Record<GatheringProfessionId, ToolEffectSlot>> | undefined {
  if (!saved) return undefined;
  let out: Partial<Record<GatheringProfessionId, ToolEffectSlot>> | undefined;
  for (const professionId of GATHERING_PROFESSION_IDS) {
    const row = saved[professionId];
    if (!row || !Object.hasOwn(TOOL_EFFECTS, row.effectId)) continue;
    if (slotToolEffectRefused(professionId, row.effectId)) continue;
    // A stored maxDurability that is not a usable positive integer falls back
    // to the catalog's own starting value, because a recharge restores TO this
    // number and a dead one would make the slot permanently useless.
    //
    // The test explicitly: `Math.floor(x) || catalog` is NOT enough, because
    // Math.floor(-5) is -5, which is truthy, so a negative short-circuits past
    // the fallback and a Math.max(1, ...) floor then hands back a ONE-charge
    // slot rather than the catalog value. Zero and NaN take the fallback but a
    // negative did not, which is the kind of split the `||` idiom hides.
    //
    // Deliberately one-sided: there is no upper clamp, because the stored max
    // must survive a future catalog rebalance DOWNWARD (that is the whole
    // reason it is stored rather than re-derived). COUPLED HALF: the pricing
    // inverse `rarityRungForMaxDurability` below reads the rung back out of
    // this preserved value against the CURRENT catalog base, so a downward
    // rebalance of `startingDurability` silently re-prices surviving legacy
    // rows one rung up at the two material boundaries (uncommon/rare and
    // rare/epic). Retune the base and the inverse's expectations together.
    const storedMax = Math.floor(row.maxDurability);
    const maxDurability =
      Number.isFinite(storedMax) && storedMax > 0
        ? storedMax
        : TOOL_EFFECTS[row.effectId].startingDurability;
    out ??= {};
    out[professionId] = {
      effectId: row.effectId,
      durability: Math.min(maxDurability, Math.max(0, Math.floor(row.durability) || 0)),
      maxDurability,
      // A crafter name outside the legal name shape cannot come from a legal
      // mint (isLegalCrafterName above: the auth length cap AND the ASCII
      // alphabet), so it is a hand-edited or corrupted row: DROP it rather
      // than truncate, because a truncated prefix could equal a DIFFERENT
      // player's real name and misattribute the original-crafter recharge
      // discount, while an absent crafter merely forgoes it. Part of the
      // phase 16 blob-growth bound, beside the item-payload signer bound
      // (item_instance_load.ts) and the knownRecipes id-shape filter on the
      // sim load path. The key is OMITTED rather than set to an explicit
      // undefined, matching how the payload arms delete it: an
      // explicit-undefined key survives `in` and Object.keys while every
      // consumer only tests `!== undefined`.
      ...(isLegalCrafterName(row.craftedBy) ? { craftedBy: row.craftedBy } : {}),
      // A persisted 'prompt' row is PRESERVED, and since the R40 confirm
      // flow shipped it is an ordinary live mode: the mint accepts it and
      // the harvest command carries the per-use consent it asks for.
      // Coercing it to 'always' here would silently retire a player's
      // deliberate choice. An ABSENT or NULL mode is a legacy row minted
      // before the union existed, when every slot fired unconditionally
      // ('always' is its faithful reading; null is the one plausible
      // never-set shape a JSON column writes). A GARBLED value (no live
      // path writes one; a hand-edited or corrupted row) coerces to
      // 'prompt', the fail-safe direction: a slot that asks first can
      // never silently spend a charge, while 'always' would. The coercion
      // is NOT read-only: the normalized row re-serializes on the next
      // save (sim.ts serializeCharacter), so a garbled value becomes a
      // stored 'prompt' permanently and can no longer be told apart from a
      // deliberate choice, and changing a live slot's mode back costs
      // another charm (the no_gain conjunct is what lets a mode-only
      // re-slot land). Fail-safe stays the right direction: a burned
      // charge is unrecoverable, a charm is a known price, and the mode
      // chip makes the coerced state visible.
      confirmMode: row.confirmMode === 'always' || row.confirmMode == null ? 'always' : 'prompt',
    };
  }
  return out;
}

// The outcome shape a harvest produces, in the axes the LIVE harvest path
// actually has (professions/gathering.ts resolveHarvest). It used to carry
// `{quantity, quality, respawnTicks}`, which was authored before there was a
// call site and matched none of them: the live path has no numeric quality,
// its rarity is an enum from `rollMaterialRarity`, and it writes respawn in
// SECONDS, before either draw. Reshaped to the live path rather than adapted
// at the call site, so nothing here is a field no caller reads.
export interface HarvestOutcome {
  /** Units the harvest grants. Read after both draws, so raising it is free. */
  quantity: number;
  /**
   * The effective tool tier the FINE-GRADE comparison reads
   * (material_grades.ts `yieldsFineGrade`). Deliberately NOT the access gate:
   * `canGatherTier` reads the player's real tool tier, so an effect can change
   * what comes out of a vein and can never change which veins open. That
   * separation is what keeps a slotted effect inside the "narrow bonuses that
   * never affect access" ruling.
   */
  gradeToolTier: number;
}

// Pure: returns a NEW outcome with the slotted effect's bonus applied, or the
// SAME outcome (by value, unchanged) when there is no slot or its durability
// has reached 0. The base tool's own tier/gating (canGatherTier /
// canHarvestMonsterMaterial above) is untouched either way: a depleted effect
// never blocks the base tool, it just stops contributing its bonus.
export function applyEffectBonus(
  slot: ToolEffectSlot | undefined,
  outcome: HarvestOutcome,
): HarvestOutcome {
  if (!slot || slot.durability <= 0) return outcome;
  const def = TOOL_EFFECTS[slot.effectId];
  switch (def.kind) {
    case 'quantity':
      return { ...outcome, quantity: outcome.quantity + def.bonus };
    case 'quality':
      // The shipped bonus of 1 over bare hands (NO_TOOL_OWNED, 0) lands ON
      // the strict fine threshold, not past it (yieldsFineGrade requires
      // strictly-above), so a tool-less player cannot mint fine grades. That
      // margin is exactly one point and is pinned in
      // tests/professions_tools.test.ts; a bonus above 1 needs a real-tool
      // floor in the grade resolver first.
      return { ...outcome, gradeToolTier: outcome.gradeToolTier + def.bonus };
    case 'respawnSpeed':
      // Deliberately inert, and this arm is the record of why rather than an
      // oversight. A respawn-speed bonus shortens the node timer, which points
      // the endgame gathering loop back at the starter zone, so the effect
      // carrying it (Springback Charm) ships as catalog content with no live
      // behaviour. The live respawn is also written in SECONDS and BEFORE both
      // draws, so the shipped bonus of 1 would have shaved one second off 240
      // if it had simply been pointed at the live field.
      return outcome;
  }
}

// The standard rarity ladder (MaterialRarity: common/uncommon/rare/epic/
// legendary, see gathering.ts), read here as a tool's own rarity (ItemDef
// `quality`). It is the only input to the charge ladder below AND to the rod
// reel-window bonus (professions/fishing.ts fishReelWindowSecFor), which is why
// it is exported: two bonuses keyed to the same ladder must not each carry
// their own copy of the rung order.
const RARITY_ORDER: readonly MaterialRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/**
 * The rung a tool's rarity sits on, 0 for common. Takes the full `ItemDef`
 * quality union rather than `MaterialRarity`, so the two off-ladder inputs a
 * real item def can present resolve to the common rung instead of to -1:
 * `undefined` (a def that omits `quality` entirely) and `'poor'` (the one
 * quality `MaterialRarity` excludes). Both used to fall through `indexOf` as
 * -1, which SUBTRACTED a rung: a poor-quality tool would have minted a slot
 * with ten charges FEWER than a common one, and would now also open a reel
 * window narrower than the base. Nothing ships at either value today, so this
 * is a floor rather than a fix for live content.
 */
export function rarityLadderIndex(rarity: ItemDef['quality']): number {
  const rung = RARITY_ORDER.indexOf(rarity as MaterialRarity);
  return rung < 0 ? 0 : rung;
}

// How many extra charges each rung of tool rarity buys a slotted effect.
//
// This REPLACES a probabilistic consumption curve that keyed the same intent
// ("a better tool's effect lasts longer") to an rng roll per use. The roll had
// to go: the live harvest path draws exactly twice per granted harvest and is
// golden-pinned at that, so a depletion roll would have been a third draw for
// every player owning a slot. The intent survives here, where it costs no draw
// at all and is legible to a player as a number instead of a hidden rate.
//
// Read against `RARITY_ORDER`, so it is a STEP FUNCTION OF TIER rather than an
// independent axis: every shipped gathering tool's rarity is a function of its
// tier, and tiers 1 and 2 are both common. That is the honest description, and
// it is what makes this a rarity bonus rather than a second tier bonus for
// land tools: a tier-1 and a tier-2 pick are both common and last the same,
// while tier otherwise orders everything strictly.
export const RARITY_DURABILITY_BONUS = 10;

/** The charges a fresh slot of `effectId` gets on a tool of `toolRarity`. */
export function startingDurabilityFor(
  effectId: ToolEffectId,
  toolRarity: ItemDef['quality'],
): number {
  return (
    TOOL_EFFECTS[effectId].startingDurability +
    RARITY_DURABILITY_BONUS * rarityLadderIndex(toolRarity)
  );
}

// Spends one charge, and draws NOTHING.
//
// The property being given up is worth naming, because the old comment here
// leaned on it: depletion used to roll `Rng.chance` even at durability 0, so
// the depletion SEQUENCE was independent of an effect's remaining charges. It
// is still order-independent, for a stronger reason. There is no draw to
// order, so nothing about a slot can move the world's rng stream, and a player
// who owns a slot and a player who does not walk the same stream. That is what
// lets this be wired into a harvest path pinned at exactly two draws.
//
// Mutates `slot.durability` in place and returns whether it decremented.
export function depleteEffect(slot: ToolEffectSlot | undefined): boolean {
  if (!slot || slot.durability <= 0) return false;
  slot.durability -= 1;
  return true;
}

// Effect recharge (#1137, priced by R39 and refilled by R30). A depleted (or
// partially depleted) effect is restored by its owner for arcane materials:
// the material IDENTITY is the disenchant ladder keyed on the rarity of the
// best tool the owner holds AT RECHARGE TIME (dust for a common or uncommon
// tool, essence for rare, shard for epic; the same table a disenchant yields
// from, so the two ladders can never drift), and the COUNT scales with the
// charges the fill restores. Recharging an effect whose slot records the
// recharger as its original crafter (`craftedBy`, stamped from the consumed
// charm's signer at slot time) is cheaper, deeper still when that crafter is
// also specialized in the effect's craft: both discounts compose into the
// count and never touch the material identity.

/** Charges one arcane material restores: the R39 scale factor. A full fill
 *  runs 2 to 5 materials across the shipped rarity rungs (20 to 50 charges),
 *  which is the ruling's stated band; retuning it moves the
 *  mint-exceeds-recharge inequality, so the craft reagent lists and the
 *  economics pin in tests/professions_tool_effect_recharge.test.ts move with
 *  it. */
export const RECHARGE_CHARGES_PER_MATERIAL = 10;

// The original crafter pays half the material count of a generic recharge.
// One named fraction so every consumer prices the same discount.
const ORIGINAL_CRAFTER_DISCOUNT = 0.5;

// True only when the slot recorded who crafted the effect AND that identity
// matches the player attempting the recharge. `craftedBy` is the character
// NAME the production craft signed the consumed charm with; a slot with no
// recorded crafter (an unsigned charm copy) is never eligible for the
// discount, so it always costs the generic rate.
//
// Name-as-identity carries the settled ecosystem's known edge, ACCEPTED
// here: names are freeable, so whoever later registers a retired name
// inherits the discount on slots and charms that name signed. The rename
// flow keeps a LIVE crafter's own discount working
// (src/sim/character_rename.ts sweeps craftedBy beside every signer), and
// the payoff for a name-reuser is a bounded material discount, never power
// or a dupe.
export function isOriginalCrafter(slot: ToolEffectSlot, rechargerName: string): boolean {
  return slot.craftedBy !== undefined && slot.craftedBy === rechargerName;
}

/** The composed R39 discount multiplier for one recharge: the
 *  original-crafter half, times the specialization multiplier
 *  (`rechargeDiscountMultiplier`, wheel.ts) when the original crafter is ALSO
 *  specialized in the effect's craft. A non-original recharger never sees the
 *  specialization arm even when specialized: the perk is for recharging
 *  one's OWN work. Generic rate is exactly 1. */
export function rechargeDiscountFor(
  slot: ToolEffectSlot,
  rechargerName: string,
  rechargerSkills: CraftSkillState = {},
): number {
  if (!isOriginalCrafter(slot, rechargerName)) return 1;
  return (
    ORIGINAL_CRAFTER_DISCOUNT *
    rechargeDiscountMultiplier(rechargerSkills, TOOL_EFFECTS[slot.effectId].craftId)
  );
}

/**
 * The rarity rung a stored `maxDurability` implies: the inverse of
 * `startingDurabilityFor`, clamped into the ladder. A slot minted on an epic
 * tool carries 50 charges, which is rung 3, whatever the owner happens to be
 * carrying later.
 *
 * This exists for the PRICING half of R47: a stored max above the catalog
 * base is proof the slot has been used or maintained at that rung, and the
 * price must not fall below it just because a cheaper tool is in the bags
 * for one command. A stored max the ladder cannot explain (a legacy or
 * hand-edited row) floors at the common rung rather than throwing: pricing
 * must never be the thing that breaks a load.
 */
export function rarityRungForMaxDurability(effectId: ToolEffectId, maxDurability: number): number {
  const base = TOOL_EFFECTS[effectId].startingDurability;
  const rungs = Math.floor((maxDurability - base) / RARITY_DURABILITY_BONUS);
  if (!Number.isFinite(rungs) || rungs < 0) return 0;
  return Math.min(rungs, RARITY_ORDER.length - 1);
}

/**
 * The USE-TIME half of R47: raise the slot's ceiling to the rung of the best
 * tool the owner holds while the effect actually fires. The harvest boundary
 * calls this beside the charge settle, once per end of the cast (the
 * completion bags AND the cast-start capture, because trade has no casting
 * gate and a mid-cast handoff must not dodge the latch), and it is what
 * makes the price rung un-gameable: the moments a player takes the bonus
 * alongside a better tool are exactly the moments the ceiling latches, so
 * minting low with the good pick stashed buys nothing past the first
 * bonus-bearing harvest. Raise-only, draw-free, and a no-op for a tool at or
 * below the recorded rung, so the common case writes nothing.
 */
export function ratchetCeilingForUse(slot: ToolEffectSlot, toolRarity: ItemDef['quality']): void {
  const used = startingDurabilityFor(slot.effectId, toolRarity);
  if (used > slot.maxDurability) slot.maxDurability = used;
}

/** Stable deny vocabulary for one recharge request. `no_tool` mirrors the
 *  slot gate (a profession the owner holds no real tool for cannot resolve
 *  the R30 rarity, so it cannot price or size the fill); `already_full` is
 *  the slot sitting at its own ceiling; `tool_capped` is the honest
 *  distinction R47 needs, the slot already at everything the CURRENTLY held
 *  tool can fill while its ceiling sits higher, which is how a borrowed epic
 *  pick's inflated mint stays one fill at most (the inflated charges keep
 *  spending, and no lesser tool renews them). */
export type RechargeToolEffectDenyReason =
  | 'invalid_request'
  | 'no_tool'
  | 'already_full'
  | 'tool_capped';

export type ResolvedRechargeToolEffect =
  | {
      ok: true;
      /** The R30 re-derived FILL target: what this recharge restores the
       *  charges to, sized by the best tool owned right now. */
      newMax: number;
      /** The slot's ceiling AFTER this fill: the high-water maximum, raised
       *  when a better tool fills past it and never lowered by a lesser one
       *  (R47: lowering it would reset the price floor every cheap fill). */
      ceiling: number;
      /** Charges this fill actually restores (newMax minus current). */
      restored: number;
      /** The R39 material identity for the resolved price rung. */
      materialItemId: string;
      /** Materials consumed: ceil((restored / RECHARGE_CHARGES_PER_MATERIAL)
       *  times the composed discount), floored at 1. */
      count: number;
    }
  | { ok: false; reason: RechargeToolEffectDenyReason };

/**
 * Resolve one recharge request against the owner's live bags: pure, draw-free
 * and mutation-free, the `resolveSlotToolEffect` shape. The caller (the
 * command body in tool_effect_actions.ts) owns consuming `count` of
 * `materialItemId` and writing `newMax` onto the slot's two counters.
 *
 * The fill and the price read DIFFERENT rungs, deliberately (R47):
 *   - The FILL is R30's: sized by the best tool owned NOW, never read back
 *     from the slot's minted value, so the slot-time mint stands as-is and a
 *     borrowed epic pick buys one inflated fill at most.
 *   - The PRICE rung is the HIGHER of the owned tool's and the one the
 *     slot's CEILING implies, and the ceiling is a high-water mark a lesser
 *     tool never lowers. R39 read alone made the price a bag-state choice:
 *     the per-charge price climbs steeply with rarity while the charge buys
 *     the same bonus at every rung, so an epic-tool owner could bank the
 *     pick, refill at the dust rung, and withdraw it again, paying about a
 *     ninth per charge and retiring the shard sink the ruling exists to feed
 *     (staged as ascending partial fills, the same trick completed an
 *     epic-cap refill at a third of its price). With the high-water floor
 *     both collapse: stashing the good tool buys a SMALLER fill at the SAME
 *     price rung, which is never cheaper than filling honestly (and strictly
 *     worse whenever the ceil rounds up, that is, off exact multiples of
 *     RECHARGE_CHARGES_PER_MATERIAL), and the
 *     ascending ladder pays the top rung at every step. The honest cases are
 *     untouched: a slot filled by the tool that minted it prices exactly as
 *     before, and a player who genuinely wants a cheaper maintenance tier
 *     re-slots a fresh charm, which re-mints the ceiling at the new tool's
 *     rung (that charm is the toll, and it costs more than any recharge).
 */
export function resolveRechargeToolEffect(
  inventory: readonly InvSlot[],
  professionId: string,
  slot: ToolEffectSlot,
  rechargerName: string,
  rechargerSkills: CraftSkillState,
  items: Readonly<Record<string, ItemDef>>,
): ResolvedRechargeToolEffect {
  if (!(GATHERING_PROFESSION_IDS as readonly string[]).includes(professionId)) {
    return { ok: false, reason: 'invalid_request' };
  }
  const best = bestOwnedGatherToolFor(inventory, professionId as GatheringProfessionId, items);
  if (best.ownedTier === NO_TOOL_OWNED) return { ok: false, reason: 'no_tool' };
  const newMax = startingDurabilityFor(slot.effectId, best.rarity);
  const restored = newMax - slot.durability;
  if (restored <= 0) {
    // Two honest ways to have nothing to restore, and they are different
    // player situations: at the ceiling (nothing to do), or at everything
    // this tool can fill while the ceiling sits higher (carry the better
    // tool). Collapsing them would tell a downgraded owner their half-empty
    // slot is full.
    return {
      ok: false,
      reason: slot.durability >= slot.maxDurability ? 'already_full' : 'tool_capped',
    };
  }
  // The price rung: the owned tool's, floored at the one the slot's ceiling
  // implies (R47 above). `rarityLadderIndex` normalizes the def-quality
  // union so 'poor'/undefined price at the common rung, exactly as they mint
  // there.
  const rung =
    RARITY_ORDER[
      Math.max(
        rarityLadderIndex(best.rarity),
        rarityRungForMaxDurability(slot.effectId, slot.maxDurability),
      )
    ];
  const materialItemId = DISENCHANT_MATERIAL_BY_QUALITY[rung];
  const discount = rechargeDiscountFor(slot, rechargerName, rechargerSkills);
  const count = Math.max(1, Math.ceil((restored / RECHARGE_CHARGES_PER_MATERIAL) * discount));
  return {
    ok: true,
    newMax,
    ceiling: Math.max(slot.maxDurability, newMax),
    restored,
    materialItemId,
    count,
  };
}

// The outcome of applying a slotted effect to one harvest/craft action,
// after the always/prompt-on-use gate (#1138).
export interface ToolEffectUseResult {
  outcome: HarvestOutcome;
  /** False when a 'prompt' slot was not confirmed, when there is no slot, or
   *  when its durability is spent: nothing fired, the base outcome passed
   *  through unchanged. */
  applied: boolean;
}

// The always/prompt-on-use confirmation gate (#1138). This is the ONE call
// site a harvest outcome path should use to apply a slotted effect: it wraps
// `applyEffectBonus` behind the slot's `confirmMode`, so callers never need
// to hand-roll the gate.
//
// APPLIES ONLY, NEVER SPENDS (R42). Depletion used to live here,
// unconditionally on every applied use; R42 made the spend conditional on
// the bonus actually changing the granted outcome, and only the command
// boundary can see that (capacity truncation happens at the grant,
// completeGatherCast). So the boundary settles the charge with
// `depleteEffect` under the R42 predicate, and this function stays the pure
// apply half.
//
// - `confirmMode: 'always'` (the default from `slotEffect`): `confirmed` is
//   ignored; the bonus applies.
// - `confirmMode: 'prompt'`: the caller must pass `confirmed: true`
//   (representing the player's explicit confirmation for this one use) or
//   nothing happens at all: the base outcome passes through unchanged, and
//   the base harvest action itself is unaffected either way (this function
//   never touches it).
//
// Draw-free and mutation-free in every arm, which is what lets a harvest
// path pinned at exactly two draws call it unconditionally.
export function applyToolEffectUse(
  slot: ToolEffectSlot | undefined,
  outcome: HarvestOutcome,
  confirmed: boolean,
): ToolEffectUseResult {
  if (!slot || slot.durability <= 0) return { outcome, applied: false };
  if (slot.confirmMode === 'prompt' && !confirmed) {
    return { outcome, applied: false };
  }
  return { outcome: applyEffectBonus(slot, outcome), applied: true };
}

// INTEGRATION NOTE. `applyToolEffectUse` is wired: the node-harvest outcome
// path calls it (professions/gathering.ts resolveHarvest), reading the slot
// from its owner's PlayerMeta, and the command boundary
// (completeGatherCast) settles the R42 charge spend against the granted
// outcome. Both halves draw nothing, so they sit inside the pinned
// two-draws-per-granted-harvest contract without widening it, and the bonus
// is applied AFTER both draws so neither the rarity roll nor the rare-event
// roll can move because a player owns a slot.
//
// `resolveRechargeToolEffect` is wired too: the recharge_tool_effect command
// body (tool_effect_actions.ts rechargeToolEffectAction) resolves through it,
// consumes the priced materials, and writes the R30 fill onto the slot.
