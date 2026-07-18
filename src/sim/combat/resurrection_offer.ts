// Player-cast resurrection offers. Spells create an authoritative, time-bounded
// offer; only the dead recipient can accept it. State lives on Sim and is exposed
// through SimContext, while this module owns every mutation and the expiry sweep.

import type { SimContext } from '../sim_context';
import { revivePlayerAt } from '../spirit';
import type { Entity } from '../types';

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
  const destination =
    caster?.kind === 'player' && !caster.dead ? caster.pos : offer.fallbackDestination;
  revivePlayerAt(ctx, r.e.id, destination, offer.hpFrac);
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
