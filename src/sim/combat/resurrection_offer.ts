// Player-cast resurrection offers. Spells create an authoritative, time-bounded
// offer; only the dead recipient can accept it. State lives on Sim and is exposed
// through SimContext, while this module owns every mutation and the expiry sweep.

import type { SimContext } from '../sim_context';
import { revivePlayerAt } from '../spirit';
import type { Aura, Entity, PendingResurrection } from '../types';
import { isUnbreakableControlAura } from './cc';
import { resurrectionReachError } from './resurrection_reach';

export const RESURRECTION_OFFER_SECONDS = 30;

export function offerResurrection(
  ctx: SimContext,
  caster: Entity,
  target: Entity,
  hpFrac: number,
  maxRange: number,
): boolean {
  if (target.kind !== 'player' || !target.dead) return false;
  // Thornhollow Fields revives on the team wave only: no player-cast rez (including
  // mass resurrection, which routes through here) bypasses the release rite.
  if (ctx.bgMatches.has(target.id)) return false;
  ctx.pendingResurrections.set(target.id, {
    casterId: caster.id,
    hpFrac,
    fallbackDestination: { ...caster.pos },
    expiresAt: ctx.time + RESURRECTION_OFFER_SECONDS,
    maxRange,
  });
  ctx.emit({ type: 'resurrectionOffer', fromName: caster.name, pid: target.id });
  return true;
}

// The live caster is the arrival anchor only while still within the offer's
// resurrection reach (range + line of sight) of the body being raised. Without
// the reach arm, a caster could cast the rez beside a corpse outside a locked
// instance door and walk inside during the offer window, and the accept would
// teleport a lockout-barred player past the door gate (instances/dungeons.ts
// owns that gate; the fallback is where the offer was cast, which the cast
// already proved reachable from the body). THE one arrival-destination rule:
// the accept below and the Nythraxis transition-stun prediction
// (encounters/nythraxis.ts) must both derive it from here, never re-inline it.
export function resurrectionArrivalAnchor(
  ctx: SimContext,
  offer: PendingResurrection,
  dead: Entity,
): Entity | null {
  const caster = ctx.entities.get(offer.casterId);
  return caster?.kind === 'player' &&
    !caster.dead &&
    resurrectionReachError(ctx, caster, dead, offer.maxRange) === null
    ? caster
    : null;
}

export function respondToResurrection(ctx: SimContext, accept: boolean, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const offer = ctx.pendingResurrections.get(r.e.id);
  if (!offer) return;
  ctx.pendingResurrections.delete(r.e.id);
  if (!accept || ctx.time >= offer.expiresAt || !r.e.dead) return;
  const arrivalAnchor = resurrectionArrivalAnchor(ctx, offer, r.e);
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
