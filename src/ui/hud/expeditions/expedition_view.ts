import { finderActivity } from '../../../sim/content/dungeon_finder';
import { FINDER_PLAYER_APPLICATION_CAP } from '../../../sim/social/finder_applications';
import type { DungeonFinderBoard, DungeonFinderInfo } from '../../../world_api/dungeon_finder';
import type { PartyInfo } from '../../../world_api/party';

export function buildExpeditionView(
  info: DungeonFinderInfo | null,
  board: DungeonFinderBoard | null,
  playerId: number,
  grouped: boolean,
  inCombat: boolean,
  dismissedClaim: number | null,
  groupSize = grouped ? 2 : 1,
  party: PartyInfo | null = null,
) {
  const run = info?.expedition ?? null;
  const partyLeaderName = party?.members.find((member) => member.pid === party.leader)?.name;
  const recruitmentListing = !run
    ? (info?.myListing ??
      (partyLeaderName
        ? board?.find((row) => !row.expedition && row.leaderName === partyLeaderName)
        : null))
    : null;
  const recruitmentActivity = recruitmentListing
    ? (finderActivity(recruitmentListing.activityId) ?? null)
    : null;
  const recruitment = recruitmentActivity
    ? {
        dungeonId: recruitmentActivity.dungeonId,
        difficulty: recruitmentActivity.difficulty,
        size: recruitmentActivity.size,
      }
    : null;
  const canOpen = !!run && groupSize < (finderActivity(run.activityId)?.size ?? 0);
  const roles = info?.eligibleRoles ?? [];
  const applications = info?.myApplications ?? (info?.myApplication ? [info.myApplication] : []);
  const pending = applications[0]?.listingId ?? null;
  const groups = (board ?? [])
    .filter((row) => finderActivity(row.activityId)?.kind === 'dungeon')
    .map((row) => {
      const activity = finderActivity(row.activityId);
      return {
        ...row,
        dungeonId: activity?.dungeonId ?? '',
        difficulty: activity?.difficulty ?? 'normal',
        // A suggested composition helps readers; it never restricts admission.
        needed:
          row.needed ??
          (activity?.composition
            ? {
                tank: Math.max(
                  0,
                  activity.composition.tank - row.members.filter((m) => m.role === 'tank').length,
                ),
                healer: Math.max(
                  0,
                  activity.composition.healer -
                    row.members.filter((m) => m.role === 'healer').length,
                ),
                dps: Math.max(
                  0,
                  activity.composition.dps - row.members.filter((m) => m.role === 'dps').length,
                ),
              }
            : null),
        application: applications.find((app) => app.listingId === row.id) ?? null,
        canApply:
          row.id !== info?.myListing?.id &&
          !grouped &&
          applications.length < FINDER_PLAYER_APPLICATION_CAP &&
          !applications.some((app) => app.listingId === row.id) &&
          roles.length > 0 &&
          row.size < row.capacity,
      };
    });
  const partyMembers = (party?.members ?? []).map(({ pid, name, cls, level, role, spec }) => ({
    pid,
    name,
    cls,
    level,
    role,
    spec,
  }));
  const leaderName = partyMembers.find((m) => m.pid === run?.leaderPid)?.name;
  // Board leaders have unique character names. This partition is presentation
  // only; all application and travel authority stays with the server.
  const currentGroup =
    groups.find(
      (row) =>
        row.id === info?.myListing?.id ||
        (!run && !!partyLeaderName && row.leaderName === partyLeaderName) ||
        (!!run &&
          !!leaderName &&
          row.leaderName === leaderName &&
          row.activityId === run.activityId),
    ) ?? null;
  const otherGroups = groups.filter((row) => row !== currentGroup);
  const requests = (info?.myListing?.applicants ?? []).filter((request) => request.remaining !== 0);
  const prompt =
    canOpen &&
    run?.isLeader &&
    run.isInside &&
    !run.open &&
    run.exitId !== dismissedClaim &&
    !inCombat
      ? run
      : null;
  const alert = !inCombat ? (requests.find((request) => request.remaining !== 0) ?? null) : null;
  const view = {
    myListing: info?.myListing ?? null,
    application: applications[0] ?? null,
    applications,
    feedback: info?.applicationFeedback ?? null,
    availability: info?.availability ?? null,
    queueRewards: info?.queueRewards ?? null,
    helperPaused: grouped || !!info?.queue || !!info?.proposal || pending !== null,
    run,
    recruitment,
    canOpen,
    canRecruit: !grouped || party?.leader === playerId,
    roles,
    groups,
    currentGroup,
    otherGroups,
    partyMembers,
    groupSize,
    grouped,
    capacity: run ? (finderActivity(run.activityId)?.size ?? groupSize) : (recruitment?.size ?? 0),
    requests,
    pending,
    prompt,
    alert,
    playerId,
    inCombat,
  };
  // Countdown ticks update their text in place, without replacing focused forms
  // or announcing the whole request again. Expiry still changes button state.
  return {
    ...view,
    sig: JSON.stringify(view, (key, value) => {
      // These legacy automatic-prompt fields are not rendered by Groups.
      if (key === 'prompt' || key === 'alert' || key === 'inCombat') return undefined;
      return key === 'remaining' ? (value === 0 ? 0 : 1) : value;
    }),
  };
}
