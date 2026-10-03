// The trash kit's support and lane casts, and the once-per-pull withdraw
// (MobTemplate.trashKit mend, ward, line, withdraw): the Sunken Bastion's
// Brine Mend, Fog Ward, Piercing Bolt and the Turretback Hermit's Withdraw
// (and the Wildheart Basin's Ancestral Sap and Entangling Lash, a lane that
// roots).
// A sibling of driver.ts, which routes these keys here.
//
//   mend      an interruptible heal on the most injured ally in reach, only
//             while one is hurt (a kick wastes it; left alone it undoes a pull)
//   ward      an interruptible absorb shield on the most injured unshielded ally
//   line      a lane locked at the bar's start toward one player, landing on
//             everyone standing in it when the bar ends (step out sideways)
//   withdraw  once per pull under a health share: shelter a few seconds with
//             no attacks, taking much less damage (a breather, then the burn)
//
// Zero rng in every pick: allies sort by health share then entity id, the
// line's victim is the kit's hashed pick. The only draws are a landing line's
// damage rolls, in roster order.

import { MOBS } from '../../data';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { angleTo, dist2d, type Entity, type TrashKitDef, type TrashKitState } from '../../types';
import { inLane } from './lane';
import { pickHashedTarget } from './targets';

/** Mob ids a withdraw shelter rides (the stun and ward it wears). */
export const TRASH_WITHDRAW_AURA = 'trash_kit_withdraw';
export const TRASH_WITHDRAW_WARD = 'trash_kit_withdraw_ward';
/** The absorb aura a ward cast puts on its ally. */
export const TRASH_WARD_AURA = 'trash_kit_ward';

/** Living mobs of the claim within `range` of `from`, the caster included. */
function alliesInReach(ctx: SimContext, inst: InstanceSlot, from: Entity, range: number): Entity[] {
  const out: Entity[] = [];
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.hp <= 0 || e.kind !== 'mob') continue;
    if (dist2d(e.pos, from.pos) > range) continue;
    out.push(e);
  }
  return out;
}

function hpShare(e: Entity): number {
  return e.maxHp > 0 ? e.hp / e.maxHp : 1;
}

/** The most injured living ally in reach under `below` of its health (ties to
 *  the lower id), or null when nobody needs it. Only allies in the fight. */
export function pickMendTarget(
  ctx: SimContext,
  inst: InstanceSlot,
  caster: Entity,
  range: number,
  below: number,
  family?: string,
  exclude: readonly string[] = [],
): Entity | null {
  let best: Entity | null = null;
  for (const e of alliesInReach(ctx, inst, caster, range)) {
    if (e.id !== caster.id && !e.inCombat) continue;
    if (family !== undefined && MOBS[e.templateId]?.family !== family) continue;
    if (exclude.includes(e.templateId)) continue;
    if (hpShare(e) >= below) continue;
    if (!best || hpShare(e) < hpShare(best) - 1e-9) best = e;
    else if (Math.abs(hpShare(e) - hpShare(best)) <= 1e-9 && e.id < best.id) best = e;
  }
  return best;
}

/** The most injured living ally in reach not already warded (ties to the
 *  lower id; the caster counts), or null. */
export function pickWardTarget(
  ctx: SimContext,
  inst: InstanceSlot,
  caster: Entity,
  range: number,
): Entity | null {
  let best: Entity | null = null;
  for (const e of alliesInReach(ctx, inst, caster, range)) {
    if (e.id !== caster.id && !e.inCombat) continue;
    if (e.auras.some((a) => a.id === TRASH_WARD_AURA)) continue;
    if (!best || hpShare(e) < hpShare(best) - 1e-9) best = e;
    else if (Math.abs(hpShare(e) - hpShare(best)) <= 1e-9 && e.id < best.id) best = e;
  }
  return best;
}

export type SupportKey = 'mend' | 'ward' | 'line';

/** Can a support or lane cast start now? Returns its target (the ally for a
 *  mend or ward, the victim the lane aims at for a line). */
export function supportCastReady(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  key: SupportKey,
  st: TrashKitState,
  players: readonly Entity[],
): { ok: boolean; target: Entity | null } {
  const no = { ok: false, target: null };
  if (key === 'mend') {
    const def = kit.mend;
    const target = def
      ? pickMendTarget(ctx, inst, mob, def.range, def.below, def.family, def.exclude)
      : null;
    return target ? { ok: true, target } : no;
  }
  if (key === 'ward') {
    const def = kit.ward;
    const target = def ? pickWardTarget(ctx, inst, mob, def.range) : null;
    return target ? { ok: true, target } : no;
  }
  const def = kit.line;
  if (!def) return no;
  const target = pickHashedTarget(players, mob.pos, def.length, mob.id, st.casts);
  return target ? { ok: true, target } : no;
}

/** A line cast just started: lock its aim on the victim's spot now. */
export function lockLineAim(mob: Entity, st: TrashKitState, target: Entity | null): void {
  st.aim = target ? angleTo(mob.pos, target.pos) : mob.facing;
  mob.facing = st.aim;
}

/** Hold a running line cast's locked aim (the mob AI may turn it mid-bar). */
export function holdLineAim(mob: Entity, st: TrashKitState): void {
  if (st.aim !== undefined) mob.facing = st.aim;
}

/** The bar ran out: the support or lane cast lands. */
export function landSupportCast(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  key: SupportKey,
  targetId: number | null,
  st: TrashKitState,
  players: readonly Entity[],
): void {
  if (key === 'mend') {
    const def = kit.mend;
    const ally = targetId !== null ? ctx.entities.get(targetId) : undefined;
    if (!def || !ally || ally.dead || ally.hp <= 0) return;
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: ally.id,
      school: def.school,
      fx: 'selfCast',
      ability: def.castId,
    });
    ctx.applyHeal(mob, ally, Math.round(ally.maxHp * def.healPct), def.name, def.castId, false);
    return;
  }
  if (key === 'ward') {
    const def = kit.ward;
    const ally = targetId !== null ? ctx.entities.get(targetId) : undefined;
    if (!def || !ally || ally.dead || ally.hp <= 0) return;
    const amount = Math.max(1, Math.round(ally.maxHp * def.shieldPct));
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: ally.id,
      school: def.school,
      fx: 'wardBloom',
      ability: def.castId,
    });
    ctx.applyAura(ally, {
      id: TRASH_WARD_AURA,
      name: def.name,
      kind: 'absorb',
      remaining: def.duration,
      duration: def.duration,
      value: amount,
      sourceId: mob.id,
      school: def.school,
    });
    return;
  }
  const def = kit.line;
  if (!def) return;
  const yaw = st.aim ?? mob.facing;
  st.aim = undefined;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: targetId ?? mob.id,
    school: def.school,
    fx: 'heavyBolt',
    ability: def.castId,
  });
  for (const p of players) {
    if (p.dead) continue;
    if (!inLane(mob.pos.x, mob.pos.z, yaw, def.length, def.halfWidth, p.pos.x, p.pos.z)) continue;
    const amount = Math.max(
      1,
      Math.round(ctx.rng.range(def.min, def.max) * (mob.mechanicDamageMult ?? 1)),
    );
    ctx.dealDamage(mob, p, amount, false, def.school, def.name, 'hit', true);
    // An entangling lane roots whoever it caught (the Vine Lasher's lash).
    if (def.root && !p.dead) {
      ctx.applyAura(p, {
        id: `${def.castId}_root`,
        name: def.name,
        kind: 'root',
        remaining: def.root,
        duration: def.root,
        value: 0,
        sourceId: mob.id,
        school: def.school,
      });
    }
  }
}

/**
 * The once-per-pull withdraw: under its health share the mob shelters (a
 * self stun, so it neither swings nor casts, and a damage ward). Returns true
 * on the tick it fires.
 */
export function stepWithdraw(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): boolean {
  const def = kit.withdraw;
  if (!def || st.withdrawn || mob.maxHp <= 0) return false;
  if (mob.hp / mob.maxHp >= def.belowHpPct) return false;
  st.withdrawn = true;
  if (st.cast) {
    if (mob.castingAbility === st.cast.castId) {
      mob.castingAbility = null;
      mob.castRemaining = 0;
      mob.castTotal = 0;
      mob.castTargetId = null;
      mob.channeling = false;
    }
    st.cast = null;
  }
  st.aim = undefined;
  ctx.applyAura(mob, {
    id: TRASH_WITHDRAW_AURA,
    name: def.name,
    kind: 'stun',
    remaining: def.seconds,
    duration: def.seconds,
    value: 0,
    sourceId: mob.id,
    school: 'physical',
    unbreakableControl: true,
  });
  ctx.applyAura(mob, {
    id: TRASH_WITHDRAW_WARD,
    name: def.name,
    kind: 'shield_wall',
    remaining: def.seconds,
    duration: def.seconds,
    value: def.reduction,
    sourceId: mob.id,
    school: 'physical',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: 'physical',
    fx: 'wardBloom',
    ability: TRASH_WITHDRAW_AURA,
  });
  return true;
}
