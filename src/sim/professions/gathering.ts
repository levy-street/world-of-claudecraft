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

import { bagCapacity } from '../bags';
import { GATHER_NODES } from '../content/gather_nodes';
import {
  GATHERING_PROFESSION_IDS,
  GATHERING_PROFESSIONS,
  type GatheringProfessionId,
  HARVEST_COMPONENT_ITEMS,
} from '../content/professions';
import type { Rng } from '../rng';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  type GatherNodeDef,
  type GatherNodeType,
  type GatherRareEventFlavor,
  INTERACT_RANGE,
  type ItemDef,
} from '../types';
import {
  announceGatherRareEvent,
  GATHER_RARE_EVENT_YIELD_MULT,
  rollGatherRareEvent,
} from './gather_events';
import { gatherActionXp } from './profession_xp';
import type { PlayerProfessionSkill } from './types';

export type GatheringProficiency = Record<GatheringProfessionId, number>;

// Per-node harvest tuning (#1121). Each node type maps to one gathering
// profession (one proficiency point per harvest) and a per-player respawn
// timer. Which material item a harvest grants is zone-dependent and lives in
// NODE_MATERIAL_TABLE below (Professions 2.0 Phase 4); the pre-Phase-4
// placeholder junk grants (bone_fragments/linen_scrap/spider_leg) are gone,
// but those items themselves survive (recipes consume them, players hold
// them): only their node source went away.
export const NODE_HARVEST_TABLE: Record<
  GatherNodeType,
  { professionId: GatheringProfessionId; respawnSeconds: number }
> = {
  ore: { professionId: 'mining', respawnSeconds: 120 },
  wood: { professionId: 'logging', respawnSeconds: 120 },
  herb: { professionId: 'herbalism', respawnSeconds: 120 },
};

// Every material row yields this many units per rolled rarity (Phase 4's one
// shared curve; Phase 15 tunes per family if playtests want divergence).
// Frozen because every NODE_MATERIAL_TABLE row shares this one object: a
// per-family tune must clone it per row, never mutate it in place.
const MATERIAL_QTY_BY_RARITY: Record<MaterialRarity, number> = Object.freeze({
  common: 1,
  uncommon: 2,
  rare: 2,
  epic: 3,
  legendary: 4,
});

// Zone x node-type material matrix (Professions 2.0 Phase 4): which item a
// harvest grants in which zone, and the per-rarity unit counts. The zone-1
// (eastbrook_vale) rows grant ONLY the dedicated sellValue-4 starter materials
// (copper_ore/ironbark_log/silverleaf_herb), never the premium vendor
// reagents: that is the stockpiling mitigation, so farming starter nodes
// cannot pile up mid-tier trade goods. Exported so tests can pin the table
// contents.
export const NODE_MATERIAL_TABLE: Record<
  GatherNodeType,
  Record<string, { itemId: string; qtyByRarity: Record<MaterialRarity, number> }>
> = {
  ore: {
    eastbrook_vale: { itemId: 'copper_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    mirefen_marsh: { itemId: 'iron_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    thornpeak_heights: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
  },
  wood: {
    eastbrook_vale: { itemId: 'ironbark_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    mirefen_marsh: { itemId: 'ashwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    thornpeak_heights: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
  },
  herb: {
    eastbrook_vale: { itemId: 'silverleaf_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    mirefen_marsh: { itemId: 'goldleaf_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    thornpeak_heights: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
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
  return byZone[zoneId] ?? byZone.eastbrook_vale;
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
const MATERIAL_RARITY_SHARE: Record<Exclude<MaterialRarity, 'common'>, number> = {
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
// Absent means never harvested (always ready). Session-only state (not
// persisted), same as `lastActiveTick`: one player harvesting a node never
// blocks, delays, or resets any other player's timer for the same node, so
// there is no gather rush or node camping.
export function isNodeHarvestableBy(meta: PlayerMeta, nodeId: string, now: number): boolean {
  const readyAt = meta.nodeHarvestReadyAt[nodeId];
  return readyAt === undefined || now >= readyAt;
}

export interface HarvestResolution {
  granted: boolean;
  itemId?: string;
  professionId?: GatheringProfessionId;
  // The rolled material rarity (#1122), scaled by the player's proficiency in
  // the node's matching profession at the moment of harvest. Since Phase 4 it
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
  // Non-null when draw #2 hit the zone-broadcast rare event (Phase 4).
  rareEvent?: GatherRareEventFlavor | null;
}

// Resolves one player's harvest attempt against one node: if that player's own
// timer for this node has elapsed, resolves the zone's material and yield
// (rarity scaled by the player's current proficiency in the node's profession,
// plus the Phase 4 rare-event roll) and queues the matching profession's
// proficiency gain, then resets that player's timer; otherwise denies without
// side effects. Never touches any other player's state for this or any other
// node. Granting is the caller's job (harvestNode), which may truncate to bag
// room.
export function resolveHarvest(
  meta: PlayerMeta,
  node: GatherNodeDef,
  now: number,
  rng: Rng,
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
  const qty = material.qtyByRarity[rarity] * (rareEvent ? GATHER_RARE_EVENT_YIELD_MULT : 1);
  const signed = rareEvent !== null || isSignableMaterialRarity(rarity);
  queueGatheringGrant(meta, entry.professionId, 1);
  return {
    granted: true,
    itemId: material.itemId,
    professionId: entry.professionId,
    rarity,
    qty,
    signed,
    rareEvent,
  };
}

// Command entry point (behind the SimContext seam): resolves one player's
// harvest attempt against a node they must be standing near. Runs on the
// deterministic 20 Hz tick path (dispatched from a wire command the same tick
// it arrives, per the other immediate-interaction commands like `buyItem`),
// never off-tick. Denies (no side effect) if the requesting player is dead
// (matching the vendor family's dead gate, items.ts buyItem/useItem), the
// node id is unknown, the player is too far away, their own timer for the
// node has not elapsed, or their bags are full (matching the pickupObject
// capacity pre-check, interaction.ts); a denial never touches another
// player's state and never consumes that player's respawn timer.
export function harvestNode(ctx: SimContext, nodeId: string, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e: p } = r;
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
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
  // Capacity pre-gate on the material this zone's node actually grants. The
  // item id is known BEFORE any rng draw (zone x type lookup, no roll), so a
  // full-bag denial here happens before the rng stream is touched and cannot
  // shift the world's draw order.
  const material = nodeMaterialFor(node.type, node.zoneId);
  if (!ctx.canAddItem(material.itemId, 1, meta.entityId)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    return false;
  }
  const result = resolveHarvest(meta, node, ctx.time, ctx.rng);
  if (!result.granted) {
    // Unreachable in practice (the readiness check above already gates this),
    // but kept as a defensive fallback so a future resolveHarvest change
    // cannot silently grant with no player-visible denial.
    ctx.error(meta.entityId, 'This resource node has not respawned for you yet.');
    return false;
  }
  const { itemId, professionId, rarity, qty, signed, rareEvent } = result;
  if (!itemId || !professionId || !rarity || !qty) {
    // resolveHarvest's granted branch always supplies these fields. Keep the
    // boundary defensive without introducing a player-visible impossible case.
    // false: nothing was granted, so this is not a successful interaction for
    // the autorun-stop contract (#1982).
    return false;
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
    ctx.addItem(itemId, fit, meta.entityId);
    return fit;
  };
  if (signed) {
    // Signed instances never merge into stacks (bags.ts addStacked, #1165):
    // each unit is its own slot, so EVERY unit (the first included) needs a
    // genuinely free slot and an oversized rare-event windfall truncates
    // instead of overflowing the bag. The fungible pre-gate above can pass on
    // stack top-up room alone, so when no free slot exists the yield falls
    // back to an unsigned top-up grant (the truncation contract wins over
    // signing in that self-inflicted edge; the crossing-case pin lives in
    // tests/gather_rare_events.test.ts).
    const capacity = bagCapacity(meta.bags);
    for (let i = 0; i < qty; i++) {
      if (meta.inventory.length >= capacity) break;
      ctx.addItemInstance(itemId, { signer: meta.name }, meta.entityId);
      grantedQty++;
    }
    if (grantedQty === 0) grantedQty = grantFungibleFit();
  } else {
    grantedQty = grantFungibleFit();
  }
  ctx.onNodeGatheredForQuests(node, itemId, meta);
  // Zone gather mark: one entry per zone and node type ever harvested.
  ctx.markVisited(meta, `gather:${node.zoneId}:${node.type}`);
  // Character XP for the harvest (profession_xp.ts), tier-scaled and
  // level-gated the same way kill XP is: a max-level player farming a
  // trivial (gray) node gets zero.
  ctx.grantXp(gatherActionXp(node.level, p.level), meta);
  // Phase 4 rare event: soft zone broadcast plus the dormant per-flavor
  // deed mark, resolved in gather_events.ts after the grant lands.
  if (rareEvent) announceGatherRareEvent(ctx, meta, node, rareEvent, itemId);
  // Gather-completion event (#1729): personal (pid), so the client can play a
  // gathering audio cue for the acting player only. Emitted here on the granted
  // path exactly like craftItem emits craftResult on a completed craft; carries
  // the rolled rarity so a rare-material harvest is distinguishable for a
  // special cue, plus the Phase 4 fields: qty is the ACTUAL granted unit count
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
  });
  return true;
}

export interface PendingGatherGrant {
  professionId: GatheringProfessionId;
  amount: number;
}

export function emptyGatheringProficiency(): GatheringProficiency {
  return { mining: 0, logging: 0, herbalism: 0 };
}

export function isGatheringProfessionId(id: string): id is GatheringProfessionId {
  return (GATHERING_PROFESSION_IDS as string[]).includes(id);
}

// Normalizes a possibly-absent, possibly-partial saved record (old character
// saves predate this field entirely) into a full, zero-defaulted proficiency
// record. Never throws on an absent or malformed field.
export function normalizeGatheringProficiency(
  saved: Partial<Record<string, number>> | undefined | null,
): GatheringProficiency {
  const out = emptyGatheringProficiency();
  if (!saved) return out;
  for (const id of GATHERING_PROFESSION_IDS) {
    const v = saved[id];
    if (typeof v === 'number' && Number.isFinite(v)) out[id] = Math.max(0, v);
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

// Drains one player's queued grants, applying each additively to that
// profession's own counter only. Called once per player per tick (sim.ts
// `tick()`), so a grant issued this tick is visible starting next tick, the
// same cadence as every other per-tick system.
export function drainGatheringGrants(meta: PlayerMeta): void {
  if (meta.pendingGatherGrants.length === 0) return;
  for (const grant of meta.pendingGatherGrants) {
    meta.gatheringProficiency[grant.professionId] = Math.max(
      0,
      meta.gatheringProficiency[grant.professionId] + grant.amount,
    );
  }
  meta.pendingGatherGrants.length = 0;
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

/** Does this mob's corpse support profession harvest at all? */
export function isHarvestableCorpse(componentTags: readonly string[] | undefined): boolean {
  return !!componentTags && componentTags.length > 0;
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
// extract. Choosing FEWER components concentrates the effort and yields a
// measurably higher tier per component than spreading across every tagged
// type on the same corpse.

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
// Tune here, not inline in the roll.
const BASE_TIER_WEIGHTS: readonly number[] = [40, 30, 15, 10, 4, 1];

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
 */
export function effectiveFocusComponents(
  taggedComponents: readonly string[],
  chosen: readonly string[],
): readonly string[] {
  return chosen.length === 0 || chosen.length >= taggedComponents.length
    ? taggedComponents
    : chosen.filter((c) => taggedComponents.includes(c));
}

/**
 * Resolve a per-corpse focus harvest: one independent tier roll per chosen
 * component, each roll's weight table shifted upward by a concentration bonus.
 *
 * Formula (monotonic, documented, no invented balance numbers beyond the base
 * weight table above): `bonus = taggedComponents.length - effectiveChosen.length`,
 * clamped to `[0, HARVEST_TIERS.length - 1]`. Each component's tier index is
 * `min(rolledIndex + bonus, HARVEST_TIERS.length - 1)`. Choosing every tagged
 * component gives `bonus = 0` (an unshifted roll, the pre-#1142 "spread"
 * behavior); choosing strictly fewer components out of the same tagged set
 * can only raise the shift, never lower it, so concentrating on fewer
 * components always yields an equal-or-higher expected tier per component
 * than spreading wider on the same corpse.
 *
 * Backward compatibility: an empty `chosen` (no selection made) or a `chosen`
 * that covers every tagged component both default to spreading across all of
 * `taggedComponents`, matching the single-harvest behavior from #1141.
 *
 * Pure: draws only from the passed-in `Rng`, one draw per yielded component,
 * in `effectiveChosen` order.
 */
export function resolveCorpseFocusHarvest(
  taggedComponents: readonly string[],
  chosen: readonly string[],
  rng: Rng,
): FocusHarvestYield[] {
  const effectiveChosen = effectiveFocusComponents(taggedComponents, chosen);
  const bonus = Math.max(
    0,
    Math.min(HARVEST_TIERS.length - 1, taggedComponents.length - effectiveChosen.length),
  );
  return effectiveChosen.map((component) => ({ component, tier: rollFocusTier(rng, bonus) }));
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
