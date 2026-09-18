// Lunge, the out-of-stealth shape of the Slinkstrike button (Wildfang kit
// pass 2): a 12 yd gap closer whose 60% weapon strike and combo point land
// on ARRIVAL, never at cast. The cast only starts the charge route; the strike
// is parked on a pending marker aura (the Bloodhook shape in
// hunter_fieldcraft.ts) that the route's settle hook (charge_route.ts)
// resolves: the tick the body arrives is the tick the strike rolls, and a
// route that ends short (deep water, a cliff, a root, the target dying or the
// 3 sec budget running out) strikes nothing and hands the 12 sec cooldown
// back. The energy is spent at cast either way, the bill a dodged strike
// pays. Draws no rng of its own: the strike rolls the ordinary melee hit
// table through ctx.meleeSwing on the arrival tick.
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const LUNGE_ID = 'lunge';
export const LUNGE_PENDING_ID = 'lunge_pending';
/** The strike's weapon-damage multiplier: the 60 the tooltip cites. */
export const LUNGE_WEAPON_MULT = 0.6;
export const LUNGE_COMBO_POINTS = 1;
// The charge mover's own budget (effect_dispatch.ts CHARGE_MAX_DURATION): the
// marker never outlives the route it rides.
const LUNGE_PENDING_SECONDS = 3;

/** The parked strike's target id while a Lunge is in flight, else null.
 *  Reads the aura list only, so both the Sim and the online mirror can ask. */
export function lungePendingTargetId(actor: Pick<Entity, 'auras'>): number | null {
  for (const aura of actor.auras) {
    if (aura.id === LUNGE_PENDING_ID && aura.kind === 'internal_cd') return aura.value;
  }
  return null;
}

function removePending(ctx: SimContext, druid: Entity): void {
  const index = druid.auras.findIndex((aura) => aura.id === LUNGE_PENDING_ID);
  if (index < 0) return;
  const [aura] = druid.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: druid.id, name: aura.name, gained: false });
}

/** The druid on-cast hook's arm, reached after the charge effect has run:
 *  parks the strike on the route the mover is about to run. A cast whose
 *  route never started (the mover's own guards refused it) parks nothing. */
export function startLunge(
  ctx: SimContext,
  druid: Entity,
  target: Entity | null | undefined,
): void {
  if (!target || target.dead || druid.chargeTargetId !== target.id) return;
  removePending(ctx, druid);
  ctx.applyAura(druid, {
    id: LUNGE_PENDING_ID,
    name: 'Lunge',
    kind: 'internal_cd',
    remaining: LUNGE_PENDING_SECONDS,
    duration: LUNGE_PENDING_SECONDS,
    value: target.id,
    sourceId: druid.id,
    school: 'physical',
  });
}

/** The route's settle hook: strike on arrival, refund the cooldown otherwise. */
export function finishLunge(
  ctx: SimContext,
  druid: Entity,
  target: Entity | null,
  arrived: boolean,
): void {
  const pendingTargetId = lungePendingTargetId(druid);
  if (pendingTargetId === null) return;
  removePending(ctx, druid);
  if (!arrived || !target || target.dead || target.id !== pendingTargetId) {
    druid.cooldowns.delete(LUNGE_ID);
    return;
  }
  const hit = ctx.meleeSwing(druid, target, 0, 'Lunge', {
    weaponMult: LUNGE_WEAPON_MULT,
    abilityId: LUNGE_ID,
  });
  if (hit) ctx.awardCombo(druid, target, LUNGE_COMBO_POINTS);
}
