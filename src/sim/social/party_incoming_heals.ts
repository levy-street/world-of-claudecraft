// The heals each party member has incoming right now (the party frames' heal
// prediction), moved out of the Sim coordinator unchanged: it reads only the
// casters' entities and their known abilities.

import type { SimContext } from '../sim_context';

export function partyIncomingHealsOf(
  ctx: SimContext,
  memberIds: readonly number[],
): Map<number, number> {
  const members = new Set(memberIds);
  const incoming = new Map<number, number>();
  for (const casterId of memberIds) {
    const caster = ctx.entities.get(casterId);
    if (!caster?.castingAbility || caster.castTargetId === null) continue;
    if (!members.has(caster.castTargetId)) continue;
    const ability = ctx.players
      .get(casterId)
      ?.known.find((known) => known.def.id === caster.castingAbility);
    if (!ability) continue;
    let amount = 0;
    for (const effect of ability.effects) {
      if (effect.type === 'heal') amount += Math.round((effect.min + effect.max) / 2);
      else if (effect.type === 'hot') amount += effect.total;
    }
    if (amount > 0)
      incoming.set(caster.castTargetId, (incoming.get(caster.castTargetId) ?? 0) + amount);
  }
  return incoming;
}
