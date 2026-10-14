import { abilitiesKnownAt } from '../content/classes';
import { membershipActive } from '../membership';
import { membershipAbilities } from '../membership_abilities';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';

/** Rebuild class and entitlement grants through the same progression seam. */
export function refreshKnownAbilities(ctx: SimContext, meta: PlayerMeta, announce: boolean): void {
  const e = ctx.entities.get(meta.entityId);
  if (!e) return;
  const before = new Map(meta.known.map((k) => [k.def.id, k.rank]));
  meta.known = membershipAbilities(
    abilitiesKnownAt(meta.cls, e.level, meta.talentMods, meta.questsDone),
    membershipActive(meta, ctx.time),
  );
  if (!announce) return;
  for (const k of meta.known) {
    const previous = before.get(k.def.id);
    if (previous !== undefined && previous >= k.rank) continue;
    ctx.emit({ type: 'learnAbility', abilityId: k.def.id, rank: k.rank, pid: meta.entityId });
    ctx.emit({
      type: 'log',
      pid: meta.entityId,
      text:
        previous === undefined
          ? `You have learned a new ability: ${k.def.name}.`
          : `Your ${k.def.name} has improved to Rank ${k.rank}.`,
      color: '#ffd100',
    });
  }
}
