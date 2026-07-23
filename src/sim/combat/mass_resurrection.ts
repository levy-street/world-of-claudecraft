// Chronomancy mass resurrection. Selection is derived exclusively from the
// authoritative party roster and is kept deterministic by preserving roster order.

import type { SimContext } from '../sim_context';
import type { AbilityDef, Entity } from '../types';
import { offerResurrection } from './resurrection_offer';

export function isMassResurrectionAbility(ability: Pick<AbilityDef, 'effects'>): boolean {
  return ability.effects.some((effect) => effect.type === 'massResurrectGroup');
}

export function hasDeadGroupMember(ctx: SimContext, caster: Entity): boolean {
  const party = ctx.partyOf(caster.id);
  if (!party) return false;
  return party.members.some((memberId) => {
    const member = ctx.entities.get(memberId);
    return member?.kind === 'player' && (member.dead || member.ghost);
  });
}

export function resurrectDeadGroupMembers(ctx: SimContext, caster: Entity, hpFrac: number): void {
  const party = ctx.partyOf(caster.id);
  if (!party) return;

  for (const memberId of party.members) {
    const member = ctx.entities.get(memberId);
    if (member?.kind !== 'player' || (!member.dead && !member.ghost)) continue;
    const body = member.corpsePos ?? member.pos;
    offerResurrection(ctx, caster, member, hpFrac);
    ctx.emit({
      type: 'spellfxAt',
      x: body.x,
      z: body.z,
      school: 'arcane',
      fx: 'nova',
      radius: 2,
    });
  }
}
