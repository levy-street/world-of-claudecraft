// Chronomancy mass resurrection. Selection is derived exclusively from the
// authoritative party roster and is kept deterministic by preserving roster order.
// Every offer additionally obeys the shared resurrection reach rule (range +
// line of sight to the body): an unbounded roster sweep was the raid/heroic
// lockout bypass, teleporting a member dead anywhere in the world to a caster
// standing inside a locked instance.

import type { SimContext } from '../sim_context';
import type { AbilityDef, Entity } from '../types';
import { offerResurrection } from './resurrection_offer';
import { resurrectionReachError } from './resurrection_reach';

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

// The cast gate above hasDeadGroupMember: at least one dead member's body must
// also be within the casting ability's resurrection reach, so a cast that could
// raise nobody is refused up front instead of burning the mana and the cooldown.
export function hasDeadGroupMemberInReach(
  ctx: SimContext,
  caster: Entity,
  maxRange: number,
): boolean {
  const party = ctx.partyOf(caster.id);
  if (!party) return false;
  return party.members.some((memberId) => {
    const member = ctx.entities.get(memberId);
    if (member?.kind !== 'player' || (!member.dead && !member.ghost)) return false;
    return resurrectionReachError(ctx, caster, member, maxRange) === null;
  });
}

export function resurrectDeadGroupMembers(
  ctx: SimContext,
  caster: Entity,
  hpFrac: number,
  abilityId: string,
  maxRange: number,
  school: AbilityDef['school'] = 'arcane',
): void {
  const party = ctx.partyOf(caster.id);
  if (!party) return;

  for (const memberId of party.members) {
    const member = ctx.entities.get(memberId);
    if (member?.kind !== 'player' || (!member.dead && !member.ghost)) continue;
    if (resurrectionReachError(ctx, caster, member, maxRange) !== null) continue;
    const body = member.corpsePos ?? member.pos;
    offerResurrection(ctx, caster, member, hpFrac, maxRange);
    ctx.emit({
      type: 'spellfxAt',
      x: body.x,
      z: body.z,
      school,
      fx: 'nova',
      radius: 2,
      ability: abilityId,
    });
  }
}
