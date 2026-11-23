// Leader edits to a published group listing: the roles the leader assigns to
// the party members a listing brings along, and switching the listing to the
// same content's other difficulty. Read-only planning over SimContext; the
// finder machine commits the result.
import {
  FINDER_ACTIVITIES,
  FINDER_CLASS_ROLES,
  type FinderActivity,
  finderActivity,
  isFinderRole,
} from '../content/dungeon_finder';
import type { Role } from '../content/talents';
import type { SimContext } from '../sim_context';
import { finderLevelEligible } from './finder_recruitment';

export interface FinderPartyRole {
  pid: number;
  role: Role;
}

// A party is at most a 40-player raid, so a longer list is malformed input.
export const FINDER_PARTY_ROLES_CAP = 40;

/** The same content at its other difficulties (the listing's switch targets). */
export function finderDifficultySiblings(activityId: string): FinderActivity[] {
  const activity = finderActivity(activityId);
  if (!activity) return [];
  return FINDER_ACTIVITIES.filter(
    (entry) => entry.dungeonId === activity.dungeonId && entry.id !== activity.id,
  );
}

/**
 * Keep only assignments for current party members other than the leader, each
 * to a role their class can fill; the last assignment per member wins. The
 * leader's own role stays their finder role selection.
 */
export function cleanFinderPartyRoles(
  ctx: SimContext,
  leaderPid: number,
  members: readonly number[],
  roles: readonly FinderPartyRole[],
): Map<number, Role> {
  const out = new Map<number, Role>();
  for (const entry of roles.slice(0, FINDER_PARTY_ROLES_CAP)) {
    if (entry.pid === leaderPid || !members.includes(entry.pid) || !isFinderRole(entry.role))
      continue;
    const cls = ctx.players.get(entry.pid)?.cls;
    if (cls && FINDER_CLASS_ROLES[entry.role].includes(cls)) out.set(entry.pid, entry.role);
  }
  return out;
}

/**
 * Can the listing move to `targetId`? Only the same content at another
 * difficulty, with every current member inside the new level band and room
 * left for at least one more player. Reports the refusal to the leader.
 */
export function planFinderDifficulty(
  ctx: SimContext,
  leaderPid: number,
  currentId: string,
  targetId: string,
  members: readonly number[],
  memberBlocksError: (leaderPid: number, memberPid: number) => void,
): FinderActivity | null {
  const target = finderDifficultySiblings(currentId).find((entry) => entry.id === targetId);
  if (!target) {
    ctx.error(leaderPid, 'That listing is no longer available.');
    return null;
  }
  if (members.length >= target.size) {
    ctx.error(leaderPid, 'Your group is too large for that activity.');
    return null;
  }
  for (const memberPid of members) {
    if (!finderLevelEligible(target, ctx.entities.get(memberPid)?.level ?? 0)) {
      memberBlocksError(leaderPid, memberPid);
      return null;
    }
  }
  return target;
}
