// The shared feast (Phase 12, D16): the tier-4 communal payoff. A placed
// feast is a REAL world entity (kind 'object', templateId 'farm_feast', the
// battleground-flag precedent) riding the normal interest-scoped entity
// snapshot, so no new wire mechanism exists anywhere in this feature. The
// server owns every outcome: charges, the per-player consumed ledger, and
// the tick-domain expiry all live here and are re-validated on every command.
//
// DRAW CONTRACT: placement and consumption draw ZERO rng (no Rng access in
// this module at all). Placement is a bag spend plus an entity spawn;
// consumption is a ledger write plus the SAME eating slot a bagged dish
// sets, so the Well Fed mint stays the Phase 11 completion path
// (src/sim/wellfed.ts via updateRegen) and owns no draw either. The expiry
// sweep decides from stored state alone. Nothing here can fork the shared
// draw stream.
//
// TRANSIENT BY DESIGN: FeastState lives only in SimContext.feasts and dies
// with the Sim instance. No field of it enters PlayerMeta, CharacterState,
// any save blob, or any database write, and the entity itself is pruned from
// client mirrors by snapshot absence. Rationale: a feast is a mobile social
// station, not property. Its expiry is tick-domain (not wall-clock), so it
// is deliberately NOT restart-safe: a server restart clears every live
// feast exactly like it clears every live ground object, and re-anchoring
// tick deadlines across a restart would demand the serialization this
// design forbids.
//
// ANTI-ABUSE RULE (decided this phase): ONE ACTIVE FEAST PER PLACER. A
// placement while the owner's previous feast still stands is refused
// (farmDenied reason 'feast_active'). Chosen over a placement cooldown
// because it needs no per-player timestamp that outlives the feast, bounds
// the live entity count at one per player, and involves no clock at all.
// The charge count and expiry below are maintainer-flagged tuning.
//
// THE LEDGER KEY: eatenBy holds the rename-proof owner key
// (meta.characterId ?? meta.entityId, the PlayerMeta contract), never the
// bare entity id, per the interact_object_credit stable-key lesson: entity
// ids are session artifacts. The set is bounded by the feast's own charge
// count and dropped wholesale at despawn, so it inherits none of the
// persistence machinery the credited-objects ledger needs.

import { ITEMS } from '../data';
import { createGroundObject } from '../entity';
import { instanceAt } from '../instances/dungeons';
import { countUnlockedInSlots, removeUnlockedFromSlots } from '../item_lock';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  CONSUME_DURATION,
  CONSUME_TICKS,
  DT,
  dist2d,
  type Entity,
  INTERACT_RANGE,
  isConsuming,
  isNonSpellCast,
} from '../types';

/** The one placeable feast item (content/profession_items.ts) and the
 *  templateId its placed entity carries. A second placeable is explicitly
 *  out of scope (no general placeable-object framework). */
export const FARM_FEAST_ITEM_ID = 'harvest_feast';
export const FARM_FEAST_TEMPLATE_ID = 'farm_feast';

/** One live placed feast. Keyed in SimContext.feasts by its entity id. */
export interface FeastState {
  entityId: number;
  /** The placer's rename-proof owner key (characterId ?? entityId). */
  ownerKey: number;
  /** Servings left. Decremented at bite START (the dish precedent: the
   *  spend lands at use; an interrupted meal forfeits the buff, never
   *  refunds the serving). Despawn on 0 rides the 1 Hz sweep below. */
  charges: number;
  /** Tick-domain deadline (ctx.tickCount base). Sub-second staleness
   *  between expiry and the 1 Hz sweep answers 'feast_expired'. */
  expiresAtTick: number;
  /** The per-player consumed ledger: one bite per player per feast. */
  eatenBy: Set<number>;
}

/** The rename-proof player key the ledger and the anti-abuse rule share. */
export function feastOwnerKey(meta: PlayerMeta): number {
  return meta.characterId ?? meta.entityId;
}

/** Set out a harvest feast at the caller's feet, spending one feast item
 *  from bags. Gate order mirrors plantCrop: the family's shared ctx.error
 *  sentences for dead/busy (deviation (bq): no new wire enum arm for a
 *  state every command family refuses the same way), then text-free
 *  id-carrying farmDenied reasons for everything feast-specific. */
export function placeFeastAction(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (p.castingAbility || isConsuming(p)) {
    ctx.error(meta.entityId, 'You are busy.');
    return;
  }
  // Water refuses PLACEMENT too (the QA gate's find): without this, the
  // spend destroys the item and spawns a feast nobody can ever eat (the
  // bite's own swimming gate), holding the one-active slot for the full
  // 180s. Combat placement stays deliberately LEGAL, asymmetric with the
  // bite: combat ends and the feast remains fully usable after it (the
  // raid-table flavor), where a water placement never becomes usable.
  if (ctx.isSwimming(p)) {
    ctx.error(meta.entityId, "You can't do that while swimming.");
    return;
  }
  const ownerKey = feastOwnerKey(meta);
  for (const feast of ctx.feasts.values()) {
    if (feast.ownerKey === ownerKey) {
      ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'feast_active' });
      return;
    }
  }
  const def = ITEMS[FARM_FEAST_ITEM_ID];
  const info = def?.feast;
  if (!info) return; // content invariant; pinned in the suite
  // Lock-aware spend split (deviation (ao), the crafting.ts idiom): a raw
  // count the owner locked is invisible to the sufficiency gate, and when
  // only a lock caused the shortfall the toast says so.
  if (countUnlockedInSlots(meta.inventory, FARM_FEAST_ITEM_ID) < 1) {
    const reason = ctx.countItem(FARM_FEAST_ITEM_ID, meta.entityId) >= 1 ? 'locked' : 'no_feast';
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason });
    return;
  }
  // Lock-aware SPEND to match the lock-aware gate above: ctx.removeItem is
  // the inventory hub's lock-blind walk (highest bag index first, any slot a
  // victim), so a locked end-slot copy would be spent first while the gate
  // had counted only the unlocked one. Same walk the seed spend uses
  // (plantCrop): locked slots are never victims. removeUnlockedFromSlots
  // mutates the slot array only, so the quest hook fires once here
  // (place_feast stays a HEAVY_SELF_CMDS member for the self snapshot).
  removeUnlockedFromSlots(meta.inventory, FARM_FEAST_ITEM_ID, 1);
  ctx.onInventoryChangedForQuests?.(meta);
  // The entity, the battleground-flag shape: a ground object with a custom
  // templateId, no pickup item, not lootable. `name` carries the PLACER'S
  // raw name as a VALUE; the client composes the localized
  // "{name}'s Harvest Feast" title off the templateId (i18n: the text is
  // the key, the name is a param, never sim-side English).
  const e = createGroundObject(ctx.nextId++, '', meta.name, { ...p.pos });
  e.templateId = FARM_FEAST_TEMPLATE_ID;
  e.objectItemId = null;
  e.lootable = false;
  // The object-respawn sweep in sim.ts's entity loop treats EVERY
  // lootable-false object as a cooling pickup (respawnTimer -= DT, re-arm
  // at zero), which re-armed the feast one second after placement and
  // handed the interact press to the generic object arm (found by the
  // player-path probe). A spawn timer longer than the feast's own life
  // keeps the sweep from ever re-arming it; the 1 Hz despawn below ends
  // the entity long before the timer runs out.
  e.respawnTimer = (info.durationTicks + 20) * DT;
  ctx.addEntity(e);
  // Inside a claimed dungeon instance the feast joins the run's teardown
  // roster: freeInstance drops every registered objectId when the reaper
  // frees the empty claim, and the 1 Hz sweep's entities.has leg below then
  // reclaims the state and the placer's one-active slot (the inverse
  // cleanup's designed job). Without this the entity outlived the run and
  // stood at the slot origin, still edible, for the next claiming party.
  const inst = instanceAt(ctx, e.pos);
  if (inst && inst.partyKey !== null) inst.objectIds.push(e.id);
  ctx.feasts.set(e.id, {
    entityId: e.id,
    ownerKey,
    charges: info.charges,
    expiresAtTick: ctx.tickCount + info.durationTicks,
    eatenBy: new Set(),
  });
  ctx.emit({ type: 'farmFeastPlaced', pid: meta.entityId, feastId: e.id });
}

/** Eat from the placed feast `feastId` (an entity id): once per player per
 *  feast. The bite spends a serving at START and sets the SAME eating slot
 *  a bagged tier-4 dish sets (Consuming pointed at the dish item), so the
 *  18s sit-restore, the interruption-forfeit rules, and the Well Fed mint
 *  at completion are the Phase 11 machinery (the gate SET mirrors the
 *  items.ts food arm; the ORDER follows plantCrop's family order, so a
 *  dead mid-cast player hears the dead line first here), zero draws
 *  (consume-slot chosen over instant-mint: it keeps one mint site and the
 *  classic eat ritual; the decision record lives in state.md). */
export function consumeFeastAction(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  feastId: number,
): void {
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  const feast = ctx.feasts.get(feastId);
  const entity = ctx.entities.get(feastId);
  if (!feast || !entity) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'feast_expired' });
    return;
  }
  if (ctx.tickCount >= feast.expiresAtTick) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'feast_expired' });
    return;
  }
  if (feast.charges < 1) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'feast_finished' });
    return;
  }
  if (dist2d(p.pos, entity.pos) > INTERACT_RANGE) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'feast_range' });
    return;
  }
  if (feast.eatenBy.has(feastOwnerKey(meta))) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'feast_eaten' });
    return;
  }
  // The eating family's own gates, mirrored from the items.ts food arm so a
  // feast bite refuses exactly where a bagged dish does: a running non-spell
  // cast (fishing/gather/farming) blocks the bite with the family's one busy
  // sentence, while a SPELL cast deliberately does not (the items.ts rule:
  // the Demon Heal channel keeps items usable, and item use carries no GCD
  // gate to mirror), then combat, water, and the occupied eating slot.
  if (isNonSpellCast(p.castingAbility)) {
    ctx.error(meta.entityId, 'You are busy.');
    return;
  }
  if (p.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return;
  }
  if (ctx.isSwimming(p)) {
    ctx.error(meta.entityId, "You can't do that while swimming.");
    return;
  }
  if (p.eating !== null) {
    ctx.error(meta.entityId, 'You are already eating.');
    return;
  }
  const dish = ITEMS[ITEMS[FARM_FEAST_ITEM_ID]?.feast?.dishItemId ?? ''];
  if (!dish) return; // content invariant; pinned in the suite
  feast.eatenBy.add(feastOwnerKey(meta));
  feast.charges -= 1;
  // The bite: one serving of the capstone dish, the items.ts food-arm
  // construction verbatim (sit, slot, the sfx-only first bite, the log
  // line). Completion mints ITEMS[dish].wellfed through updateRegen.
  p.sitting = true;
  p.eating = {
    itemId: dish.id,
    kind: 'food',
    hpPer2s: dish.foodHp ? Math.round(dish.foodHp / CONSUME_TICKS) : 0,
    manaPer2s: dish.drinkMana ? Math.round(dish.drinkMana / CONSUME_TICKS) : 0,
    remaining: CONSUME_DURATION,
    ticksElapsed: 0,
  };
  ctx.emit({ type: 'heal', targetId: p.id, amount: 0, source: 'food', sfxTick: true });
  ctx.emit({ type: 'log', text: 'You sit down to eat.', color: '#999', pid: meta.entityId });
}

/** The despawn check: zero charges or expiry. Rides INSIDE updateFarming's
 *  existing 1 Hz sweep (never a second appended sim.ts sweep), decides from
 *  stored state alone, draws zero rng, and allocates nothing while no feast
 *  stands (the overwhelmingly common tick). The entities.has leg is the
 *  inverse cleanup: no other despawn path exists today, but if anything ever
 *  drops the entity out from under the state, the sweep reclaims the state
 *  (and the placer's one-active slot) instead of stranding both for 180s. */
export function updateFarmFeasts(ctx: SimContext): void {
  if (ctx.feasts.size === 0) return;
  for (const [id, feast] of ctx.feasts) {
    if (feast.charges > 0 && ctx.tickCount < feast.expiresAtTick && ctx.entities.has(id)) continue;
    ctx.feasts.delete(id);
    if (ctx.entities.has(id)) ctx.dropEntity(id);
  }
}
