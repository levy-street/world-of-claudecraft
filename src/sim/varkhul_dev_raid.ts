import { ignivarDevRaidTravelRoster, setupIgnivarDevRaid } from './ignivar_dev_raid';
import { IGNIVAR_RAID_ARENA_ID, IGNIVAR_SECOND_WING_ID } from './ignivar_raid_ids';
import { enterDungeon, instanceAt } from './instances/dungeons';
import { resetRaidDevBot, reviveRaidDevBotInPlace } from './raid_dev_bot';
import type { SimContext } from './sim_context';
import type { DungeonDifficulty } from './types';

const VARKHUL_DEV_FORMATION = [
  { x: -24, z: -20 },
  { x: 0, z: -24 },
  { x: 24, z: -20 },
  { x: -28, z: 0 },
  { x: 28, z: 0 },
  { x: -22, z: 16 },
  { x: 22, z: 16 },
  { x: -28, z: 22 },
  { x: 28, z: 22 },
] as const;

export type VarkhulDevRaidResult =
  | { ok: true; allies: number; reused: boolean; difficulty: DungeonDifficulty }
  | { ok: false; message: string };

function allRaidMembersInInnerCrucible(
  ctx: SimContext,
  memberIds: readonly number[],
  difficulty: DungeonDifficulty,
): boolean {
  const partyKey = ctx.instanceKeyFor(memberIds[0]);
  return memberIds.every((memberId) => {
    const member = ctx.entities.get(memberId);
    if (!member) return false;
    const instance = instanceAt(ctx, member.pos);
    return (
      instance?.dungeonId === IGNIVAR_SECOND_WING_ID &&
      instance.partyKey === partyKey &&
      instance.difficulty === difficulty
    );
  });
}

/** Places the sanctioned ten-player practice roster across the Inner Crucible. */
export function stageVarkhulDevRaid(ctx: SimContext, pid: number): VarkhulDevRaidResult {
  const player = ctx.entities.get(pid);
  if (player?.kind !== 'player') return { ok: false, message: 'Player not found.' };
  const claimId = ctx.instanceClaimIdAt(player.pos);
  const instance = ctx.instances.find(
    (candidate) =>
      candidate.exitId === claimId &&
      candidate.partyKey !== null &&
      candidate.dungeonId === IGNIVAR_SECOND_WING_ID,
  );
  if (!instance || instance.partyKey !== ctx.instanceKeyFor(pid)) {
    return { ok: false, message: 'Enter the Inner Crucible first.' };
  }
  const roster = ignivarDevRaidTravelRoster(ctx, pid);
  if (!roster.ok) return roster;
  const botPids = roster.memberIds.filter((memberId) => memberId !== pid);
  if (botPids.length !== VARKHUL_DEV_FORMATION.length) {
    return { ok: false, message: 'The Varkhul practice raid roster is incomplete.' };
  }
  const origin = ctx.instanceOriginOf(instance);
  for (let index = 0; index < botPids.length; index++) {
    const point = VARKHUL_DEV_FORMATION[index];
    if (!resetRaidDevBot(ctx, botPids[index], origin.x + point.x, origin.z + point.z)) {
      return { ok: false, message: 'A Varkhul practice bot disappeared.' };
    }
    instance.enteredBy.add(botPids[index]);
  }
  return { ok: true, allies: botPids.length, reused: true, difficulty: instance.difficulty };
}

/** Creates or reuses the sanctioned practice roster, then enters Varkhul's room. */
export function setupVarkhulDevRaid(
  ctx: SimContext,
  pid: number,
  requestedDifficulty?: DungeonDifficulty,
): VarkhulDevRaidResult {
  const player = ctx.entities.get(pid);
  if (player?.kind !== 'player') return { ok: false, message: 'Player not found.' };

  const currentInstance = instanceAt(ctx, player.pos);
  const difficulty =
    requestedDifficulty ??
    (currentInstance?.dungeonId === IGNIVAR_SECOND_WING_ID ? currentInstance.difficulty : 'normal');
  let roster = ignivarDevRaidTravelRoster(ctx, pid);
  if (!roster.ok) return roster;

  for (const memberId of roster.memberIds) {
    if (memberId === pid) continue;
    if (!reviveRaidDevBotInPlace(ctx, memberId)) {
      return { ok: false, message: 'A Varkhul practice bot disappeared.' };
    }
  }

  ctx.setDungeonDifficulty(difficulty, pid);
  let reused = roster.memberIds.length > 1;
  if (roster.memberIds.length === 1) {
    if (!enterDungeon(ctx, IGNIVAR_RAID_ARENA_ID, pid, true)) {
      return { ok: false, message: 'Could not prepare the Varkhul practice raid.' };
    }
    const formed = setupIgnivarDevRaid(ctx, pid);
    if (!formed.ok) return formed;
    reused = formed.reused;
    roster = ignivarDevRaidTravelRoster(ctx, pid);
    if (!roster.ok) return roster;
  }

  if (!allRaidMembersInInnerCrucible(ctx, roster.memberIds, difficulty)) {
    for (const memberId of roster.memberIds) {
      if (!enterDungeon(ctx, IGNIVAR_SECOND_WING_ID, memberId, true)) {
        return { ok: false, message: 'Could not enter the Inner Crucible practice room.' };
      }
    }
  }
  const staged = stageVarkhulDevRaid(ctx, pid);
  return staged.ok ? { ...staged, reused } : staged;
}
