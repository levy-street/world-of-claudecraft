// Read-only admission shared by legacy premade listings and compact recruitment.
// The finder machine commits roles and listing state only after a plan succeeds.
import { type FinderActivity, finderActivity } from '../content/dungeon_finder';
import type { Role } from '../content/talents';
import type { SimContext } from '../sim_context';
import { type ExpeditionDetails, validExpeditionDetails } from './expedition_social';

export function finderLevelEligible(activity: FinderActivity, level: number): boolean {
  return level >= activity.minLevel && level <= activity.maxLevel;
}

interface ListingAdmission {
  hasListing: (pid: number) => boolean;
  memberBlocksError: (leaderPid: number, memberPid: number) => void;
}

export function planFinderListing(
  ctx: SimContext,
  pid: number,
  activityId: string,
  admission: ListingAdmission,
): { activity: FinderActivity; members: number[] } | null {
  const activity = finderActivity(activityId);
  if (!activity) {
    ctx.error(pid, 'That listing is no longer available.');
    return null;
  }
  if (admission.hasListing(pid)) {
    ctx.error(pid, 'You already lead a group listing.');
    return null;
  }
  const party = ctx.partyOf(pid);
  if (party && party.leader !== pid) {
    ctx.error(pid, 'Only the party leader may use the Dungeon Finder.');
    return null;
  }
  const members = party ? [...party.members] : [pid];
  if (members.length >= activity.size) {
    ctx.error(pid, 'Your group is too large for that activity.');
    return null;
  }
  for (const memberPid of members) {
    if (!finderLevelEligible(activity, ctx.entities.get(memberPid)?.level ?? 0)) {
      admission.memberBlocksError(pid, memberPid);
      return null;
    }
  }
  return { activity, members };
}

export function planFinderRecruitment(
  ctx: SimContext,
  pid: number,
  settings: { activityId: string; role: Role; details: ExpeditionDetails },
  admission: ListingAdmission & {
    eligibleRoles: readonly Role[];
    queued: (pid: number) => boolean;
    pendingApplication: (pid: number) => boolean;
    ongoingExpedition: (pid: number) => boolean;
  },
): ExpeditionDetails | null {
  if (!validExpeditionDetails(settings.details)) return null;
  const plan = planFinderListing(ctx, pid, settings.activityId, admission);
  if (!plan) return null;
  if (!admission.eligibleRoles.includes(settings.role)) {
    ctx.error(pid, 'You cannot fill that role.');
    return null;
  }
  for (const memberPid of plan.members) {
    if (admission.queued(memberPid)) {
      ctx.error(pid, 'You are already in the Dungeon Finder queue.');
      return null;
    }
    if (
      ctx.players.get(memberPid)?.leaving ||
      !ctx.entities.has(memberPid) ||
      admission.pendingApplication(memberPid) ||
      admission.ongoingExpedition(memberPid)
    ) {
      ctx.error(pid, 'That listing is no longer available.');
      return null;
    }
  }
  return { purpose: settings.details.purpose, note: settings.details.note.trim() };
}
