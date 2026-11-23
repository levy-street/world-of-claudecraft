// Run-local active participation, bounded by the current admitted roster.

import { FINDER_ACTIVITIES } from '../content/dungeon_finder';
import { QUEUE_DAILY_POINT_CAP, QUEUE_REWARDS_ENABLED } from '../content/queue_rewards';
import { killParticipationPos } from '../loot/kill_participation';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { grantQueueEncounter, loadQueueRewards } from '../social/queue_rewards';
import type { Entity } from '../types';
import { expeditionActivity, expeditionFamilyClaims } from './dungeon_expeditions';
import { claimedInstanceAt, instanceClaimHolds } from './dungeons';

const authoredBossIds: ReadonlySet<string> = new Set(
  FINDER_ACTIVITIES.flatMap((a) => a.encounters.map((e) => e.mobId)),
);

export interface QueueHelperParticipation {
  identity: string;
  partyId: number;
  scores: Map<string, number>;
  defeated: Set<string>;
}
export type QueueHelperRoster = Map<number, QueueHelperParticipation>;
export const QUEUE_PARTICIPATION_FRACTION = 0.01;
function rosterFor(ctx: SimContext, claim: InstanceSlot) {
  if (!claim.queueHelpers)
    claim.queueHelpers = expeditionFamilyClaims(ctx, claim).find(
      (c) => c.queueHelpers,
    )?.queueHelpers;
  return claim.queueHelpers;
}
export function admitQueueHelper(
  ctx: SimContext,
  claim: InstanceSlot,
  pid: number,
  partyId: number,
): void {
  if (!QUEUE_REWARDS_ENABLED) return;
  const family = expeditionFamilyClaims(ctx, claim);
  const roster = family.find((c) => c.queueHelpers)?.queueHelpers ?? new Map();
  for (const member of roster.keys())
    if (ctx.partyOf(member)?.id !== partyId) roster.delete(member);
  const meta = ctx.players.get(pid);
  if (!meta) return;
  roster.set(pid, {
    identity: String(meta.characterId ?? pid),
    partyId,
    scores: new Map(),
    defeated: new Set(),
  });
  for (const room of family) room.queueHelpers = roster;
}
function add(
  ctx: SimContext,
  claim: InstanceSlot,
  boss: Entity,
  pid: number,
  amount: number,
): void {
  const helper = rosterFor(ctx, claim)?.get(pid);
  const meta = ctx.players.get(pid);
  const player = ctx.entities.get(pid);
  if (
    !helper ||
    !meta ||
    meta.leaving ||
    !player ||
    player.dead ||
    player.ghost ||
    String(meta.characterId ?? pid) !== helper.identity ||
    ctx.partyOf(pid)?.id !== helper.partyId ||
    !instanceClaimHolds(claim, player.pos)
  )
    return;
  helper.scores.set(
    boss.templateId,
    Math.min(boss.maxHp, (helper.scores.get(boss.templateId) ?? 0) + amount),
  );
}
export function recordQueueDamage(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  amount: number,
): void {
  if (!QUEUE_REWARDS_ENABLED) return;
  if (!source || amount <= 0) return;
  const boss =
    target.kind === 'mob' && target.ownerId === null
      ? target
      : source.kind === 'mob' && source.ownerId === null
        ? source
        : null;
  if (!boss || !authoredBossIds.has(boss.templateId)) return;
  const contributor = boss === target ? source : target;
  const pid = contributor.kind === 'player' ? contributor.id : contributor.ownerId;
  if (pid === null || !ctx.players.has(pid)) return;
  const claim = claimedInstanceAt(ctx, boss.pos);
  if (
    !claim ||
    !rosterFor(ctx, claim)?.size ||
    !claim.mobIds.includes(boss.id) ||
    !expeditionActivity(claim)?.encounters.some((e) => e.mobId === boss.templateId)
  )
    return;
  add(ctx, claim, boss, pid, amount);
}
export function recordQueueHealing(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  amount: number,
): void {
  if (!QUEUE_REWARDS_ENABLED) return;
  if (amount <= 0 || target.kind !== 'player') return;
  const pid = source.kind === 'player' ? source.id : source.ownerId;
  if (pid === null) return;
  const party = ctx.partyOf(pid);
  if (!party?.members.includes(target.id)) return;
  const claim = claimedInstanceAt(ctx, target.pos);
  if (claim && rosterFor(ctx, claim)?.has(pid)) {
    const activity = expeditionActivity(claim);
    if (!activity) return;
    for (const id of claim.mobIds) {
      const boss = ctx.entities.get(id);
      if (
        boss &&
        !boss.dead &&
        boss.threat.size &&
        activity.encounters.some((e) => e.mobId === boss.templateId)
      )
        add(ctx, claim, boss, pid, amount);
    }
    return;
  }
}
export function awardQueueEncounter(
  ctx: SimContext,
  claim: InstanceSlot | null,
  boss: Entity,
): void {
  if (!QUEUE_REWARDS_ENABLED) return;
  const activity = claim && expeditionActivity(claim);
  const encounter = activity?.encounters.find((e) => e.mobId === boss.templateId);
  if (
    !claim ||
    !rosterFor(ctx, claim) ||
    !activity ||
    !encounter ||
    claim.defeatedEncounterIds?.has(boss.templateId)
  )
    return;
  for (const [pid, helper] of rosterFor(ctx, claim)!) {
    const meta = ctx.players.get(pid);
    const player = ctx.entities.get(pid);
    if (
      !meta ||
      meta.leaving ||
      !player ||
      String(meta.characterId ?? pid) !== helper.identity ||
      ctx.partyOf(pid)?.id !== helper.partyId ||
      !instanceClaimHolds(claim, killParticipationPos(player, claim.exitId)!)
    )
      continue;
    if ((helper.scores.get(boss.templateId) ?? 0) < boss.maxHp * QUEUE_PARTICIPATION_FRACTION)
      continue;
    helper.defeated.add(boss.templateId);
    if (!encounter.final) continue;
    const state = meta.queueRewards ?? loadQueueRewards();
    meta.queueRewards = state;
    for (const entry of activity.encounters)
      if (helper.defeated.has(entry.mobId))
        grantQueueEncounter(state, ctx.resetDay, activity.id, entry.mobId);
  }
}
export function queueRewardsView(
  value: import('../social/queue_rewards').QueueRewardsState | undefined,
  day: string,
) {
  return {
    balance: value?.balance ?? 0,
    unlocked: [...(value?.unlocked ?? [])],
    equipped: value?.equipped ?? null,
    earnedToday: value?.day === (day || 'offline') ? value.earnedToday : 0,
    dailyCap: QUEUE_DAILY_POINT_CAP,
  };
}
