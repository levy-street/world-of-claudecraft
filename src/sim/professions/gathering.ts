// Gathering profession proficiency: state shape + gain logic, behind the
// SimContext seam. The backing counters live on PlayerMeta (sim.ts); this
// module holds the pure functions. Each gathering profession is an
// independent, additive counter: granting one never touches another (no
// shared/conserved pool). No world nodes exist yet (see issue #1119), so the
// only producer today is the ALLOW_DEV_COMMANDS `/dev gather` chat cheat
// (src/sim/social/chat.ts), which QUEUES a grant here; the queue is drained
// once per player during the normal 20 Hz tick loop (sim.ts `tick()`, next to
// `updateRested`), so a grant only ever takes effect on the deterministic tick
// path, never out of band.

import { GATHER_NODES } from '../content/gather_nodes';
import {
  GATHERING_PROFESSION_IDS,
  GATHERING_PROFESSIONS,
  type GatheringProfessionId,
  HARVEST_COMPONENT_ITEMS,
} from '../content/professions';
import { QUESTS } from '../data';
import type { Rng } from '../rng';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type GatherNodeDef, type GatherNodeType, INTERACT_RANGE, type ItemDef } from '../types';
import type { PlayerProfessionSkill } from './types';

// Quest-gated bonus grant (#1701 follow-up review): while the paired quest is
// active and short of its collect objective, a harvest of this node type also
// grants the quest's own dedicated item, never NODE_HARVEST_TABLE's shared
// junk/reagent material. That material (e.g. bone_fragments) drops from mobs,
// salvage, and the market, so a collect objective targeting it is satisfied by
// anything but mining; the dedicated item can only ever come from here. Mirrors
// the mob-loot questId gate (loot_roll.ts needsQuestDrop) but unconditional: a
// gathering action has no miss chance, so a harvest that clears the node's own
// respawn gate always also clears the quest need.
const NODE_QUEST_GRANT: Partial<Record<GatherNodeType, { questId: string; itemId: string }>> = {
  ore: { questId: 'q_prof_intro', itemId: 'chunk_of_ore' },
};

function neededNodeQuestItem(
  ctx: SimContext,
  meta: PlayerMeta,
  node: GatherNodeDef,
): string | undefined {
  const grant = NODE_QUEST_GRANT[node.type];
  if (!grant) return undefined;
  if (meta.questLog.get(grant.questId)?.state !== 'active') return undefined;
  const quest = QUESTS[grant.questId];
  const objIdx = quest.objectives.findIndex(
    (o) => o.type === 'collect' && o.itemId === grant.itemId,
  );
  if (objIdx < 0) return undefined;
  return ctx.countItem(grant.itemId, meta.entityId) < quest.objectives[objIdx].count
    ? grant.itemId
    : undefined;
}

export type GatheringProficiency = Record<GatheringProfessionId, number>;

// Per-node harvest tuning (#1121). Each node type grants one fixed material item
// and one point of the matching gathering profession's proficiency; no rng draw,
// so the outcome is fully deterministic given the same sequence of harvests (the
// item's RARITY roll is explicitly out of scope, see issue #1122). The items
// reused below are existing generic junk entries (src/sim/content/items.ts): a
// placeholder grant that avoids expanding the positional per-locale item-name
// arrays in src/ui/i18n.catalog/items.ts for this issue; dedicated ore/wood/herb
// items are future content work.
export const NODE_HARVEST_TABLE: Record<
  GatherNodeType,
  { professionId: GatheringProfessionId; itemId: string; respawnSeconds: number }
> = {
  ore: { professionId: 'mining', itemId: 'bone_fragments', respawnSeconds: 120 },
  wood: { professionId: 'logging', itemId: 'linen_scrap', respawnSeconds: 120 },
  herb: { professionId: 'herbalism', itemId: 'spider_leg', respawnSeconds: 120 },
};

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
  // The rolled material rarity (#1122), scaled by the player's proficiency in the
  // node's matching profession at the moment of harvest. Informational for now:
  // NODE_HARVEST_TABLE still grants one fixed placeholder item id regardless of
  // rarity (dedicated per-rarity ore/wood/herb items are future content work, same
  // as the NODE_HARVEST_TABLE comment above), so this does not yet change what
  // gets granted; it settles the roll contract callers (loot text, future content)
  // build against.
  rarity?: MaterialRarity;
}

// Resolves one player's harvest attempt against one node: if that player's own
// timer for this node has elapsed, grants the node type's material (via the
// caller's item-grant callback), rolls that material's rarity scaled by the
// player's current proficiency in the node's profession, and queues the matching
// profession's proficiency gain, then resets that player's timer; otherwise
// denies without side effects. Never touches any other player's state for this
// or any other node.
export function resolveHarvest(
  meta: PlayerMeta,
  node: GatherNodeDef,
  now: number,
  rng: Rng,
): HarvestResolution {
  if (!isNodeHarvestableBy(meta, node.id, now)) return { granted: false };
  const entry = NODE_HARVEST_TABLE[node.type];
  meta.nodeHarvestReadyAt[node.id] = now + entry.respawnSeconds;
  const rarity = rollMaterialRarity(meta.gatheringProficiency[entry.professionId], rng);
  queueGatheringGrant(meta, entry.professionId, 1);
  return { granted: true, itemId: entry.itemId, professionId: entry.professionId, rarity };
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
export function harvestNode(ctx: SimContext, nodeId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  const node = gatherNodeById(nodeId);
  if (!node) {
    ctx.error(meta.entityId, 'That resource node does not exist.');
    return;
  }
  if (distToNode(p.pos, node.pos) > INTERACT_RANGE) {
    ctx.error(meta.entityId, 'Too far away.');
    return;
  }
  if (!isNodeHarvestableBy(meta, node.id, ctx.time)) {
    ctx.error(meta.entityId, 'This resource node has not respawned for you yet.');
    return;
  }
  const entry = NODE_HARVEST_TABLE[node.type];
  if (!ctx.canAddItem(entry.itemId, 1, meta.entityId)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    return;
  }
  const questItemId = neededNodeQuestItem(ctx, meta, node);
  const result = resolveHarvest(meta, node, ctx.time, ctx.rng);
  if (!result.granted) {
    // Unreachable in practice (the readiness check above already gates this),
    // but kept as a defensive fallback so a future resolveHarvest change
    // cannot silently grant with no player-visible denial.
    ctx.error(meta.entityId, 'This resource node has not respawned for you yet.');
    return;
  }
  ctx.addItem(result.itemId!, 1, meta.entityId);
  // Resolved against the timer/bags gates above, before the timer-consuming
  // resolveHarvest call, so a full-bags quest item never eats the node's
  // per-player respawn timer on its own.
  if (questItemId && ctx.canAddItem(questItemId, 1, meta.entityId)) {
    ctx.addItem(questItemId, 1, meta.entityId);
  }
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

// Fixed rarity ladder, low to high, matching the tier-index scale professions/
// archetype.ts's empowerment ceiling already uses (common=0, uncommon=1,
// rare=2, epic=3, legendary=4).
const MATERIAL_RARITY_ORDER: readonly MaterialRarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
];

/** Clamp a rolled rarity down to at most `maxTier` (a tier index on the same
 *  ladder, e.g. from archetype.ts `archetypeCeilingFor`; `Infinity` is a no-op).
 *  Used to cap crafted-output quality at the #1129 empowerment ceiling: a
 *  dormant or hobby craft can still ROLL a high rarity off raw skill, but the
 *  actual result granted never exceeds what that craft is empowered to
 *  produce. Never raises a roll, only lowers it. */
export function clampMaterialRarity(rarity: MaterialRarity, maxTier: number): MaterialRarity {
  if (!Number.isFinite(maxTier)) return rarity;
  const cap = Math.max(0, Math.min(MATERIAL_RARITY_ORDER.length - 1, Math.floor(maxTier)));
  const rolled = MATERIAL_RARITY_ORDER.indexOf(rarity);
  return MATERIAL_RARITY_ORDER[Math.min(rolled, cap)];
}
