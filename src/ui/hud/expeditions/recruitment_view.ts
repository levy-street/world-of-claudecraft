import { FINDER_ACTIVITIES } from '../../../sim/content/dungeon_finder';
import type { Role } from '../../../sim/content/talents';
import { finderLevelEligible } from '../../../sim/social/dungeon_finder';
import {
  type ExpeditionDetails,
  validExpeditionDetails,
} from '../../../sim/social/expedition_social';
import type { DungeonFinderInfo } from '../../../world_api/dungeon_finder';
import type { PartyInfo } from '../../../world_api/party';

export interface RecruitmentDraft extends ExpeditionDetails {
  dungeonId: string;
  difficulty: 'normal' | 'heroic';
  role: Role | null;
}

type RecruitmentBlock =
  | 'loading'
  | 'leader'
  | 'exists'
  | 'run'
  | 'queue'
  | 'proposal'
  | 'application'
  | 'activity'
  | 'role'
  | 'note';

export function buildRecruitmentView(
  info: DungeonFinderInfo | null,
  party: PartyInfo | null,
  playerId: number,
  playerLevel: number,
  draft: RecruitmentDraft,
) {
  const levels = party ? party.members.map((member) => member.level) : [playerLevel];
  const size = party?.members.length ?? 1;
  const activities = FINDER_ACTIVITIES.filter(
    (activity) =>
      activity.kind === 'dungeon' &&
      size < activity.size &&
      levels.every((level) => finderLevelEligible(activity, level)),
  );
  const dungeonIds = [...new Set(activities.map((activity) => activity.dungeonId))];
  const dungeonId = dungeonIds.includes(draft.dungeonId) ? draft.dungeonId : (dungeonIds[0] ?? '');
  const difficulties = activities.filter((activity) => activity.dungeonId === dungeonId);
  const activity =
    difficulties.find((option) => option.difficulty === draft.difficulty) ??
    difficulties[0] ??
    null;
  const roles = info?.eligibleRoles ?? [];
  const role =
    draft.role && roles.includes(draft.role)
      ? draft.role
      : (info?.roles.find((selected) => roles.includes(selected)) ?? roles[0] ?? null);
  const applications = info?.myApplications ?? (info?.myApplication ? [info.myApplication] : []);
  const blocked: RecruitmentBlock | null = !info
    ? 'loading'
    : party && party.leader !== playerId
      ? 'leader'
      : info.myListing
        ? 'exists'
        : info.expedition
          ? 'run'
          : info.queue
            ? 'queue'
            : info.proposal
              ? 'proposal'
              : applications.length
                ? 'application'
                : !activity
                  ? 'activity'
                  : !role
                    ? 'role'
                    : !validExpeditionDetails(draft)
                      ? 'note'
                      : null;
  return { dungeonIds, dungeonId, difficulties, activity, roles, role, size, blocked };
}
