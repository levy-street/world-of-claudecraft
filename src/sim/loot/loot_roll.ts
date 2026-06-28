// Loot distribution core, extracted from the Sim monolith (L1).
//
// This module owns the loot-distribution layer: party-loot strategy resolution,
// the per-entry loot roller (rollLoot), the copper split (looter-takes-all vs
// fair-split), and the need-greed roll lifecycle (start/award/resolve/return),
// plus the corpse-loot helpers the interaction handler calls (lootSlotVisibleTo,
// pruneCorpseLoot). It sits downstream of C1 (combat/damage.ts), whose handleDeath
// drives rollLoot through ctx.rollLoot.
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam) or
// to a sibling function in this module. Statement order, branch order, and the
// in-place mutation (the refactor's immutability waiver) are preserved exactly so the
// parity gate's full-state trace AND rng draw-order log stay byte-identical.
//
// The rng draws live in two places and BOTH must keep their global stream position:
//  - producer (rollLoot): per template.loot entry, in array order -- exactly ONE
//    ctx.rng.next() per rollGroup (partitioned across the group), then for non-group
//    entries ctx.rng.chance(entry.chance) and, if entry.copper, ctx.rng.int(...).
//  - consumer: tryAwardCopperByFairSplit's Fisher-Yates ctx.rng.int(i, len-1) on the
//    remainder, and submitLootRoll's ctx.rng.int(1, 100) for need/greed (null for pass).
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts).

import { ITEMS, MOBS, QUESTS } from '../data';
import { formatMoney } from '../format_money';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type {
  CurrencyLootStrategy,
  Entity,
  ItemDef,
  ItemLootStrategy,
  LootEntry,
  LootRollChoice,
  LootRollPrompt,
  LootSlot,
  LootStrategies,
} from '../types';
import { dist2d, PARTY_XP_RANGE } from '../types';

// How long (seconds) a need-greed roll stays open before it auto-resolves. Sole
// users are startNeedGreedRoll + pruneCorpseLoot, so the constant lives with them.
const LOOT_ROLL_TIMEOUT = 30;

// The server-authoritative pending need-greed roll record. Sim-internal (the public
// projection clients see is LootRollPrompt); the `pendingLootRolls` map lives on Sim
// and is reached through the SimContext seam.
export interface PendingLootRoll {
  id: number;
  mobId: number;
  itemId: string;
  itemName: string;
  quality: ItemDef['quality'];
  candidates: number[];
  choices: Map<number, { choice: LootRollChoice; roll: number | null }>;
  expiresAt: number;
}

function partyLootStrategiesForMob(ctx: SimContext, mob: Entity): LootStrategies | null {
  if (mob.tappedById === null) return null;
  return ctx.partyOf(mob.tappedById)?.lootStrategies ?? null;
}

export function partyLootCandidatesForMob(ctx: SimContext, mob: Entity): PlayerMeta[] {
  if (mob.lootRecipientIds && mob.lootRecipientIds.length > 0) {
    return mob.lootRecipientIds.flatMap((pid) => {
      const candidate = ctx.players.get(pid);
      return candidate ? [candidate] : [];
    });
  }
  if (mob.tappedById === null) return [];
  const party = ctx.partyOf(mob.tappedById);
  if (!party || party.members.length <= 1) return [];
  const candidates: PlayerMeta[] = [];
  for (const pid of party.members) {
    const candidate = ctx.players.get(pid);
    const e = ctx.entities.get(pid);
    // Before a corpse has a death-time snapshot, fall back to current range.
    // Do not filter on `e.dead`: a downed member whose corpse is still in
    // range keeps loot rights.
    if (candidate && e && dist2d(e.pos, mob.pos) <= PARTY_XP_RANGE) candidates.push(candidate);
  }
  return candidates;
}

function effectiveCurrencyLootStrategy(ctx: SimContext, mob: Entity): CurrencyLootStrategy {
  return partyLootStrategiesForMob(ctx, mob)?.currency ?? 'looter-takes-all';
}

function effectiveItemLootStrategy(ctx: SimContext, itemId: string, mob: Entity): ItemLootStrategy {
  const q = ITEMS[itemId]?.quality ?? 'common';
  const strategies = partyLootStrategiesForMob(ctx, mob);
  if (!strategies) return 'looter-takes-all';
  return q === 'poor' || q === 'common' ? strategies.commonItems : strategies.premiumItems;
}

function needsQuestDrop(ctx: SimContext, entry: LootEntry, meta: PlayerMeta): boolean {
  if (!entry.questId || !entry.itemId) return false;
  const qp = meta.questLog.get(entry.questId);
  if (qp?.state !== 'active') return false;
  const quest = QUESTS[entry.questId];
  const objIdx = quest.objectives.findIndex(
    (o) => o.type === 'collect' && o.itemId === entry.itemId,
  );
  // A quest-gated drop is only "needed" while the player has an actual collect
  // objective for this item that is still short of its required count. If the
  // quest has no matching collect objective, the player never needs the item,
  // so it must not drop (fail closed rather than dropping unconditionally).
  return objIdx >= 0 && ctx.countItem(entry.itemId, meta.entityId) < quest.objectives[objIdx].count;
}

export function rollLoot(
  ctx: SimContext,
  mob: Entity,
  meta: PlayerMeta,
  eligible: PlayerMeta[] = [meta],
): void {
  const template = MOBS[mob.templateId];
  if (!template) return;
  let copper = 0;
  const items: LootSlot[] = [];
  const rolledGroups = new Set<string>();
  for (const entry of template.loot) {
    // Exclusive groups: a single rng draw is partitioned by the group
    // entries' chances, so at most one matching entry drops.
    // Exactly one rng.next() per group keeps replays deterministic.
    if (entry.rollGroup) {
      if (rolledGroups.has(entry.rollGroup)) continue;
      rolledGroups.add(entry.rollGroup);
      const group = template.loot.filter((l) => l.rollGroup === entry.rollGroup);
      const roll = ctx.rng.next();
      let cumulative = 0;
      for (const g of group) {
        cumulative += g.chance;
        if (roll < cumulative) {
          if (g.itemId) items.push({ itemId: g.itemId, count: 1 });
          break;
        }
      }
      continue;
    }
    if (entry.questId) {
      const questRecipients = eligible.filter((m) => needsQuestDrop(ctx, entry, m));
      if (questRecipients.length === 0) continue;
      if (!ctx.rng.chance(entry.chance)) continue;
      items.push({
        itemId: entry.itemId!,
        count: 1,
        personalFor: questRecipients.map((m) => m.entityId),
      });
      continue;
    }
    if (!ctx.rng.chance(entry.chance)) continue;
    if (entry.copper)
      copper += ctx.rng.int(Math.ceil(entry.copper * 0.6), Math.ceil(entry.copper * 1.4));
    if (entry.itemId) items.push({ itemId: entry.itemId, count: 1 });
  }
  if (copper > 0 || items.length > 0) {
    mob.loot = { copper, items };
    mob.lootable = true;
  }
}

function grantLootCopper(ctx: SimContext, meta: PlayerMeta, amount: number): void {
  meta.copper += amount;
  meta.counters.lootCopper += amount;
  ctx.emit({ type: 'loot', text: `You loot ${formatMoney(amount)}.`, pid: meta.entityId });
}

function awardAllCopperToLooter(ctx: SimContext, looter: PlayerMeta, copper: number): void {
  grantLootCopper(ctx, looter, copper);
}

function tryAwardCopperByFairSplit(ctx: SimContext, mob: Entity, copper: number): boolean {
  if (effectiveCurrencyLootStrategy(ctx, mob) !== 'fair-split') return false;
  const candidates = partyLootCandidatesForMob(ctx, mob);
  if (candidates.length <= 1) return false;
  const base = Math.floor(copper / candidates.length);
  const remainder = copper % candidates.length;
  const shares = new Map<PlayerMeta, number>(candidates.map((candidate) => [candidate, base]));
  const order = [...candidates];
  for (let i = 0; i < remainder; i++) {
    const idx = ctx.rng.int(i, order.length - 1);
    [order[i], order[idx]] = [order[idx], order[i]];
    shares.set(order[i], (shares.get(order[i]) ?? 0) + 1);
  }
  for (const candidate of candidates) {
    const amount = shares.get(candidate) ?? 0;
    if (amount > 0) grantLootCopper(ctx, candidate, amount);
  }
  return true;
}

export function distributeLootCopper(ctx: SimContext, mob: Entity, looter: PlayerMeta): void {
  if (!mob.loot || mob.loot.copper <= 0) return;
  const copper = mob.loot.copper;
  if (!tryAwardCopperByFairSplit(ctx, mob, copper)) awardAllCopperToLooter(ctx, looter, copper);
  mob.loot.copper = 0;
}

function startNeedGreedRoll(ctx: SimContext, itemId: string, mob: Entity): boolean {
  if (effectiveItemLootStrategy(ctx, itemId, mob) !== 'need-greed') return false;
  const candidates = partyLootCandidatesForMob(ctx, mob);
  if (candidates.length <= 1) return false;
  const def = ITEMS[itemId];
  const itemName = def?.name ?? itemId;
  const roll: PendingLootRoll = {
    id: ctx.nextLootRollId++,
    mobId: mob.id,
    itemId,
    itemName,
    quality: def?.quality,
    candidates: candidates.map((candidate) => candidate.entityId),
    choices: new Map(),
    expiresAt: ctx.time + LOOT_ROLL_TIMEOUT,
  };
  ctx.pendingLootRolls.set(roll.id, roll);
  mob.corpseTimer = Math.max(mob.corpseTimer, LOOT_ROLL_TIMEOUT + 2);
  for (const candidate of candidates) {
    ctx.emit({
      type: 'lootRoll',
      rollId: roll.id,
      itemId,
      itemName,
      quality: roll.quality,
      expiresAt: roll.expiresAt,
      pid: candidate.entityId,
    });
  }
  return true;
}

export function awardSharedLootItem(
  ctx: SimContext,
  itemId: string,
  mob: Entity,
  looter: PlayerMeta,
): void {
  if (!startNeedGreedRoll(ctx, itemId, mob)) ctx.addItem(itemId, 1, looter.entityId);
}

// Open need-greed rolls the given player may still answer. Mirrors the
// `lootRoll` events but is reconciled from authoritative state, so a client
// that missed an event (reconnect, interest churn, a dropped frame) can
// re-show the prompt instead of losing the roll while groupmates roll.
export function activeLootRolls(ctx: SimContext, pid: number): LootRollPrompt[] {
  const out: LootRollPrompt[] = [];
  for (const roll of ctx.pendingLootRolls.values()) {
    if (!roll.candidates.includes(pid) || roll.choices.has(pid)) continue;
    out.push({
      rollId: roll.id,
      itemId: roll.itemId,
      itemName: roll.itemName,
      quality: roll.quality,
      expiresAt: roll.expiresAt,
    });
  }
  return out;
}

export function submitLootRoll(
  ctx: SimContext,
  rollId: number,
  choice: LootRollChoice,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const roll = ctx.pendingLootRolls.get(rollId);
  if (!roll?.candidates.includes(r.meta.entityId) || roll.choices.has(r.meta.entityId)) return;
  roll.choices.set(r.meta.entityId, {
    choice,
    roll: choice === 'need' || choice === 'greed' ? ctx.rng.int(1, 100) : null,
  });
  if (roll.choices.size >= roll.candidates.length) resolveLootRoll(ctx, roll);
}

export function resolveLootRoll(ctx: SimContext, roll: PendingLootRoll): void {
  if (!ctx.pendingLootRolls.delete(roll.id)) return;
  const entries = roll.candidates
    .map((pid) => ({
      pid,
      result: roll.choices.get(pid) ?? { choice: 'pass' as const, roll: null },
    }))
    .filter((entry) => entry.result.choice !== 'pass');
  const needers = entries.filter((entry) => entry.result.choice === 'need');
  const contenders =
    needers.length > 0 ? needers : entries.filter((entry) => entry.result.choice === 'greed');
  if (contenders.length === 0) {
    returnLootRollItemToCorpse(ctx, roll);
    for (const pid of roll.candidates)
      ctx.emit({ type: 'loot', text: `Everyone passed on ${roll.itemName}.`, pid });
    return;
  }
  let winner = contenders[0];
  for (const contender of contenders.slice(1)) {
    if ((contender.result.roll ?? 0) > (winner.result.roll ?? 0)) winner = contender;
  }
  const winnerMeta = ctx.players.get(winner.pid);
  const winnerName = winnerMeta?.name ?? 'Unknown';
  for (const pid of roll.candidates) {
    ctx.emit({
      type: 'loot',
      text: `${winnerName} wins ${roll.itemName} (${winner.result.roll ?? 0})`,
      pid,
    });
  }
  ctx.addItem(roll.itemId, 1, winner.pid);
}

function returnLootRollItemToCorpse(ctx: SimContext, roll: PendingLootRoll): void {
  const mob = ctx.entities.get(roll.mobId);
  if (!mob?.dead) return;
  if (!mob.loot) mob.loot = { copper: 0, items: [] };
  const existing = mob.loot.items.find(
    (slot) => slot.openToAll && slot.itemId === roll.itemId && !slot.personalFor,
  );
  if (existing) existing.count += 1;
  else mob.loot.items.push({ itemId: roll.itemId, count: 1, openToAll: true });
  mob.lootable = true;
}

export function lootSlotVisibleTo(slot: LootSlot, pid: number): boolean {
  return slot.openToAll || !slot.personalFor || slot.personalFor.includes(pid);
}

function hasPendingLootRollForMob(ctx: SimContext, mobId: number): boolean {
  return [...ctx.pendingLootRolls.values()].some((roll) => roll.mobId === mobId);
}

export function pruneCorpseLoot(ctx: SimContext, mob: Entity): void {
  if (!mob.loot) return;
  mob.loot.items = mob.loot.items.filter(
    (s) => s.count > 0 && (!s.personalFor || s.personalFor.length > 0),
  );
  if (mob.loot.copper <= 0 && mob.loot.items.length === 0) {
    if (hasPendingLootRollForMob(ctx, mob.id)) {
      mob.loot = null;
      mob.lootable = true;
      mob.corpseTimer = Math.max(mob.corpseTimer, LOOT_ROLL_TIMEOUT + 2);
      return;
    }
    mob.loot = null;
    mob.lootable = false;
    mob.corpseTimer = Math.min(mob.corpseTimer, 4);
  }
}
