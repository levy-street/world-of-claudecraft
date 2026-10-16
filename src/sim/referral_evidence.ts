import { FINDER_ACTIVITIES } from './content/dungeon_finder';
import { REFERRAL_MILESTONES, type ReferralCharacter } from './referral_cards';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

export interface ReferralEvidence {
  type: 'referralEvidence';
  kind: 'party' | 'quest' | 'boss';
  participants: (ReferralCharacter & { pid: number })[];
  questId?: string;
  characterId?: number;
  mobId?: string;
  dungeonId?: string;
  activityId?: string;
}

/** Host-only evidence captured before another command can change the party or quests.
 * Work is bounded by the ten-player raid cap and the four authored milestone quests. */
export function referralParticipants(
  ctx: SimContext,
  pids: readonly number[],
): ReferralEvidence['participants'] {
  const participants: ReferralEvidence['participants'] = [];
  for (const pid of pids.slice(0, 10)) {
    const meta = ctx.players.get(pid);
    if (!meta || !meta.accountId || !meta.characterId || meta.leaving) continue;
    const entity = ctx.entities.get(pid);
    if (!entity) continue;
    participants.push({
      pid,
      accountId: meta.accountId,
      characterId: meta.characterId,
      name: meta.name,
      level: entity.level,
      partyId: ctx.partyOf(pid)?.id ?? null,
      completedQuestIds: REFERRAL_MILESTONES.flatMap((m) =>
        m.questId && meta.questsDone.has(m.questId) ? [m.questId] : [],
      ),
    });
  }
  return participants;
}
export function emitReferralPartyEvidence(ctx: SimContext, pids: readonly number[]): void {
  const participants = referralParticipants(ctx, pids);
  if (participants.length) ctx.emit({ type: 'referralEvidence', kind: 'party', participants });
}
export function emitReferralQuestEvidence(
  ctx: SimContext,
  meta: PlayerMeta,
  questId: string,
): void {
  if (!REFERRAL_MILESTONES.some((m) => m.questId === questId)) return;
  const participants = referralParticipants(
    ctx,
    ctx.partyOf(meta.entityId)?.members ?? [meta.entityId],
  );
  if (participants.length && meta.characterId)
    ctx.emit({
      type: 'referralEvidence',
      kind: 'quest',
      participants,
      questId,
      characterId: meta.characterId,
    });
}
export function emitReferralBossEvidence(
  ctx: SimContext,
  mob: Entity,
  eligible: readonly PlayerMeta[],
): void {
  if (!mob.dungeonId) return;
  const activity = FINDER_ACTIVITIES.find(
    (a) =>
      a.encounters.some((e) => e.mobId === mob.templateId) &&
      (a.kind === 'raid' || a.dungeonId === mob.dungeonId),
  );
  if (!activity) return;
  const final = activity.encounters.some((e) => e.mobId === mob.templateId && e.final);
  if (activity.kind !== 'raid' && !final) return;
  const participants = referralParticipants(
    ctx,
    eligible.map((m) => m.entityId),
  );
  if (!participants.length) return;
  ctx.emit({
    type: 'referralEvidence',
    kind: 'boss',
    participants,
    mobId: mob.templateId,
    ...(final ? { dungeonId: activity.dungeonId } : {}),
    ...(activity.kind === 'raid' ? { activityId: activity.id } : {}),
  });
}
