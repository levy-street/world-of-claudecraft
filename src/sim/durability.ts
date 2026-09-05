// Gear durability, the SimContext half: the death penalty, the Spirit Healer
// surcharge, and the vendor Repair All command. The pure rules (pool sizes,
// the current value, the cost formula) live in durability_rules.ts, the leaf
// entity.ts and the vendor window's view core read directly; this module is
// the only writer of a worn copy's `durability` field.
//
// Draws no rng and reads no clock: every loss is a fixed fraction of the
// pool, so the same deaths on the same seed damage the same gear identically
// on every host.
import { ITEMS } from './data';
import {
  DEATH_DURABILITY_LOSS,
  DURABILITY_LOSS_MIN_LEVEL,
  damageWornGear,
  repairAllCost,
  restoreWornGear,
  SPIRIT_REZ_DURABILITY_LOSS,
} from './durability_rules';
import { recalcPlayerStats } from './entity';
import { formatMoney } from './format_money';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

/** The one exemption both loss arms share: below the level floor (a starter's
 *  deaths are free) or inside an arena match (the Ashen Coliseum is a sport,
 *  not a corpse run). Thornhollow Fields deaths DO cost gear, like the open
 *  world (the bgMatches carve-out mirrors spirit.ts releasePlayerSpirit). */
export function durabilityLossExempt(ctx: SimContext, p: Entity): boolean {
  if (p.level < DURABILITY_LOSS_MIN_LEVEL) return true;
  return ctx.arenaMatches.has(p.id) && !ctx.bgMatches.has(p.id);
}

/** The death penalty: every worn piece with a pool loses DEATH_DURABILITY_LOSS
 *  of its max. Skipped below DURABILITY_LOSS_MIN_LEVEL (a starter's deaths are
 *  free) and inside an arena match (the Ashen Coliseum is a sport, not a
 *  corpse run; Thornhollow Fields deaths DO cost gear, like the open world).
 *  Bags are never touched: only worn gear pays. Returns true when any slot
 *  changed. Called from handleDeath's player arm; the body is dead, so the
 *  stat recalc waits for the revive that every way back to life runs. */
export function applyDeathDurabilityLoss(ctx: SimContext, meta: PlayerMeta, p: Entity): boolean {
  if (durabilityLossExempt(ctx, p)) return false;
  const changed = damageWornGear(
    meta.equipment,
    meta.equipmentInstance,
    DEATH_DURABILITY_LOSS,
    ITEMS,
  );
  // Deliberately no log line: the client renders the ONE death recap off the
  // playerDeath event (combat/damage.ts), and the durability state shows on
  // the paperdoll and vendor window instead.
  return changed;
}

/** The Spirit Healer surcharge: SPIRIT_REZ_DURABILITY_LOSS more of every pool,
 *  on top of the death loss already taken. Same exemption as the death arm
 *  (the arena arm is unreachable here today, since an arena death never
 *  releases to a Spirit Healer, but the rule is stated once, not twice).
 *  Runs BEFORE the revive's recalcPlayerStats so a piece this pushes to zero
 *  is inert from the moment the body stands up. */
export function applySpiritRezDurabilityLoss(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
): boolean {
  if (durabilityLossExempt(ctx, p)) return false;
  const changed = damageWornGear(
    meta.equipment,
    meta.equipmentInstance,
    SPIRIT_REZ_DURABILITY_LOSS,
    ITEMS,
  );
  return changed;
}

/** Repair All at a merchant: charge repairAllCost from the purse and restore
 *  every worn piece, and every damaged copy in the bags, to full. Refuse-whole: a purse short of the full bill
 *  repairs nothing (the classic vendor has no partial-repair arm). Gated like
 *  buyItem on the merchant being a live vendor NPC; the sim re-derives the
 *  cost from its own equipment maps, never trusting a client quote. */
export function repairAllGear(ctx: SimContext, npcId: number, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e: p } = r;
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return false;
  }
  const npc = ctx.entities.get(npcId);
  if (npc?.kind !== 'npc' || npc.vendorItems.length === 0) {
    ctx.error(meta.entityId, 'That merchant is not available.');
    return false;
  }
  const cost = repairAllCost(meta.equipment, meta.equipmentInstance, ITEMS, meta.inventory);
  if (cost <= 0) {
    ctx.error(meta.entityId, 'Your equipment does not need repairing.');
    return false;
  }
  if (meta.copper < cost) {
    ctx.error(meta.entityId, 'Not enough money.');
    return false;
  }
  meta.copper -= cost;
  restoreWornGear(meta.equipmentInstance, meta.inventory);
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  ctx.emit({
    type: 'log',
    text: `Repaired all items for ${formatMoney(cost)}.`,
    color: '#8f8',
    pid: meta.entityId,
  });
  return true;
}
