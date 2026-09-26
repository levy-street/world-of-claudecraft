// Which fallen ally a single-target resurrection is begun over.
//
// The combat rezzes (Temporal Reversal, Wildwake) keep the classic rule: the press
// must name a dead group member, through the mouseover override or the current
// target, because in a fight WHICH body gets the one combat res is the decision.
//
// An out-of-combat rez has no such decision to protect. Recall the Fallen was the
// one healer resurrection that still demanded a selected corpse (every other
// healer's out-of-combat rez is a targetless group sweep), so a paladin pressing it
// with nobody, or a living member, selected was told to target a dead ally while
// standing on the body. When the press names no fallen ally, an out-of-combat rez
// now picks one itself: the current target when that is a fallen member (a
// deliberate selection is never swapped, even out of reach), else the nearest
// fallen member whose body is within resurrection reach. Two rules keep the pick
// from wasting the shared five-minute cooldown: a Thornhollow Fields fighter is
// never picked (the battleground revives on its team wave, so offerResurrection
// refuses them), and a body still holding a live offer from another healer ranks
// behind every body without one.
//
// Pure SimContext reads, no rng: roster order breaks an exact tie, so the pick is
// identical on every host.

import type { SimContext } from '../sim_context';
import { type AbilityDef, dist2d, type Entity } from '../types';
import { resurrectionReachError } from './resurrection_reach';

export function autoPicksFallenAlly(
  ability: Pick<AbilityDef, 'targetsDead' | 'requiresOutOfCombat'>,
): boolean {
  return ability.targetsDead === true && ability.requiresOutOfCombat === true;
}

// A dead player on the caster's group or raid roster: the only body a
// single-target resurrection may be begun over.
export function isFallenGroupMember(ctx: SimContext, caster: Entity, e: Entity): boolean {
  if (!e.dead || e.kind !== 'player') return false;
  return ctx.partyOf(caster.id)?.members.includes(e.id) ?? false;
}

export function pickFallenAlly(ctx: SimContext, caster: Entity, maxRange: number): Entity | null {
  const current = caster.targetId !== null ? ctx.entities.get(caster.targetId) : undefined;
  if (current && isFallenGroupMember(ctx, caster, current)) return current;
  const party = ctx.partyOf(caster.id);
  if (!party) return null;
  let best: Entity | null = null;
  let bestOffered = true;
  let bestDist = Infinity;
  for (const memberId of party.members) {
    const member = ctx.entities.get(memberId);
    if (member?.kind !== 'player' || !member.dead) continue;
    if (ctx.bgMatches.has(member.id)) continue;
    if (resurrectionReachError(ctx, caster, member, maxRange) !== null) continue;
    const offer = ctx.pendingResurrections.get(member.id);
    const offered = offer !== undefined && ctx.time < offer.expiresAt;
    // Reach is measured to the body, so the ranking is too: a released ghost
    // waits at the graveyard, but the rite raises the corpse.
    const d = dist2d(caster.pos, member.corpsePos ?? member.pos);
    if (offered === bestOffered ? d < bestDist : !offered) {
      best = member;
      bestOffered = offered;
      bestDist = d;
    }
  }
  return best;
}
