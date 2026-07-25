// Player-cast resurrection offers. Spells create an authoritative, time-bounded
// offer; only the dead recipient can accept it. State lives on Sim and is exposed
// through SimContext, while this module owns every mutation and the expiry sweep.

import type { SimContext } from '../sim_context';
import { revivePlayerAt } from '../spirit';
import type { Aura, Entity } from '../types';
import { isUnbreakableControlAura } from './cc';

export const RESURRECTION_OFFER_SECONDS = 30;

export function offerResurrection(
  ctx: SimContext,
  caster: Entity,
  target: Entity,
  hpFrac: number,
): boolean {
  if (target.kind !== 'player' || !target.dead) return false;
  ctx.pendingResurrections.set(target.id, {
    casterId: caster.id,
    hpFrac,
    fallbackDestination: { ...caster.pos },
    expiresAt: ctx.time + RESURRECTION_OFFER_SECONDS,
  });
  ctx.emit({ type: 'resurrectionOffer', fromName: caster.name, pid: target.id });
  return true;
}

export function respondToResurrection(ctx: SimContext, accept: boolean, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const offer = ctx.pendingResurrections.get(r.e.id);
  if (!offer) return;
  ctx.pendingResurrections.delete(r.e.id);
  if (!accept || ctx.time >= offer.expiresAt || !r.e.dead) return;
  const caster = ctx.entities.get(offer.casterId);
  const arrivalAnchor = caster?.kind === 'player' && !caster.dead ? caster : null;
  const destination = arrivalAnchor?.pos ?? offer.fallbackDestination;
  revivePlayerAt(ctx, r.e.id, destination, offer.hpFrac);
  if (arrivalAnchor) inheritArrivalAnchorControl(ctx, arrivalAnchor, r.e);
}

// A live caster is also the authoritative arrival anchor. If that anchor is held
// by encounter-owned control, accepting an older resurrection offer must not open
// a same-call action window before the encounter's next update (notably when the
// caster itself has just accepted a chained resurrection into the encounter).
function inheritArrivalAnchorControl(ctx: SimContext, anchor: Entity, target: Entity): void {
  for (const aura of anchor.auras) {
    if (!isUnbreakableControlAura(aura) || aura.remaining <= 0) continue;
    if (
      target.auras.some(
        (existing) =>
          existing.id === aura.id &&
          existing.sourceId === aura.sourceId &&
          existing.kind === aura.kind &&
          isUnbreakableControlAura(existing),
      )
    )
      continue;
    ctx.applyAura(target, cloneAura(aura));
  }
}

function cloneAura(aura: Aura): Aura {
  return aura.empowerAbilities
    ? { ...aura, empowerAbilities: [...aura.empowerAbilities] }
    : { ...aura };
}

export function updateResurrectionOffers(ctx: SimContext): void {
  for (const [targetId, offer] of ctx.pendingResurrections) {
    const target = ctx.entities.get(targetId);
    if (!target?.dead || ctx.time >= offer.expiresAt) {
      ctx.pendingResurrections.delete(targetId);
    }
  }
}

export function dropResurrectionOffer(ctx: SimContext, pid: number): void {
  ctx.pendingResurrections.delete(pid);
}
