// Validate new optional expedition data without changing legacy finder mirror
// reference semantics. A malformed expedition cannot enable travel controls.

import {
  QUEUE_BALANCE_CAP,
  QUEUE_DAILY_POINT_CAP,
  QUEUE_REWARDS,
} from '../sim/content/queue_rewards';
import { validExpeditionDetails } from '../sim/social/expedition_social';
import { FINDER_PLAYER_APPLICATION_CAP } from '../sim/social/finder_applications';
import type {
  DungeonFinderBoard,
  DungeonFinderExpeditionView,
  DungeonFinderInfo,
} from '../world_api/dungeon_finder';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is number => count(value) && value > 0;
const token = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 64;

export function validExpeditionProgress(value: unknown): boolean {
  return (
    record(value) &&
    count(value.bossesDefeated) &&
    count(value.bossesTotal) &&
    value.bossesDefeated <= value.bossesTotal &&
    value.bossesTotal <= 64
  );
}

export function decodeDungeonFinderExpedition(value: unknown): DungeonFinderExpeditionView | null {
  if (
    !record(value) ||
    !id(value.exitId) ||
    !id(value.leaderPid) ||
    !token(value.activityId) ||
    !token(value.dungeonId) ||
    !validExpeditionProgress(value) ||
    !['isLeader', 'isInside', 'canTravel', 'open'].every((key) => typeof value[key] === 'boolean')
  )
    return null;
  return value as unknown as DungeonFinderExpeditionView;
}

export function decodeDungeonFinderInfo(value: unknown): DungeonFinderInfo | null {
  if (!record(value)) return null;
  let decoded = value;
  const drop = (key: string, replacement: unknown = undefined) => {
    decoded = { ...decoded, [key]: replacement };
  };
  if (value.expedition != null && !decodeDungeonFinderExpedition(value.expedition))
    drop('expedition', null);
  if (value.availability !== undefined && !validAvailability(value.availability))
    drop('availability');
  if (value.applicationFeedback != null && !validFeedback(value.applicationFeedback))
    drop('applicationFeedback', null);
  if (value.queueRewards !== undefined && !validQueueRewards(value.queueRewards))
    drop('queueRewards');
  if (
    record(value.myListing) &&
    ((value.myListing.details !== undefined && !validExpeditionDetails(value.myListing.details)) ||
      (Array.isArray(value.myListing.applicants) &&
        value.myListing.applicants.some(
          (a) => record(a) && a.remaining !== undefined && !seconds(a.remaining),
        )))
  )
    drop('myListing', null);
  if (record(decoded.myListing) && Array.isArray(decoded.myListing.applicants)) {
    const applicants = decoded.myListing.applicants;
    if (applicants.some((a) => record(a) && a.spec != null && !token(a.spec)))
      drop('myListing', {
        ...decoded.myListing,
        applicants: applicants.map((a) =>
          record(a) && a.spec != null && !token(a.spec) ? { ...a, spec: null } : a,
        ),
      });
  }
  if (value.myApplication != null && !validApplication(value.myApplication))
    drop('myApplication', null);
  if (value.myApplications !== undefined) {
    if (
      !Array.isArray(value.myApplications) ||
      value.myApplications.length > FINDER_PLAYER_APPLICATION_CAP
    )
      drop('myApplications', []);
    else {
      const seen = new Set<number>();
      const applications = value.myApplications.filter((app) => {
        if (!validApplication(app) || seen.has(app.listingId)) return false;
        seen.add(app.listingId);
        return true;
      });
      if (applications.length !== value.myApplications.length) drop('myApplications', applications);
    }
  }
  return decoded as unknown as DungeonFinderInfo;
}

const seconds = (value: unknown): value is number => count(value) && value <= 120;
function validApplication(value: unknown): value is { listingId: number } {
  return (
    record(value) &&
    id(value.listingId) &&
    (value.remaining === undefined ||
      (seconds(value.remaining) && typeof value.leaderName === 'string')) &&
    (value.leaderName === undefined ||
      (typeof value.leaderName === 'string' && value.leaderName.length <= 64)) &&
    (value.activityId === undefined || token(value.activityId))
  );
}
const roles = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length <= 3 &&
  value.every((r) => ['tank', 'healer', 'dps'].includes(r)) &&
  new Set(value).size === value.length;
function validAvailability(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.enabled === 'boolean' &&
    roles(value.roles) &&
    (value.notice === null ||
      (record(value.notice) &&
        id(value.notice.seq) &&
        Array.isArray(value.notice.listingIds) &&
        value.notice.listingIds.length <= 5 &&
        value.notice.listingIds.every(id)))
  );
}
function validFeedback(value: unknown): boolean {
  return (
    record(value) &&
    id(value.seq) &&
    ['accepted', 'declined', 'expired', 'cancelled', 'closed'].includes(String(value.outcome)) &&
    typeof value.leaderName === 'string' &&
    value.leaderName.length <= 64
  );
}
function validQueueRewards(value: unknown): boolean {
  const reward = (v: unknown) => QUEUE_REWARDS.some((r) => r.id === v);
  return (
    record(value) &&
    count(value.balance) &&
    value.balance <= QUEUE_BALANCE_CAP &&
    count(value.earnedToday) &&
    value.earnedToday <= QUEUE_DAILY_POINT_CAP &&
    value.dailyCap === QUEUE_DAILY_POINT_CAP &&
    Array.isArray(value.unlocked) &&
    value.unlocked.length <= QUEUE_REWARDS.length &&
    value.unlocked.every(reward) &&
    new Set(value.unlocked).size === value.unlocked.length &&
    (value.equipped === null || value.unlocked.includes(value.equipped))
  );
}

export function decodeDungeonFinderBoard(value: unknown): DungeonFinderBoard | null {
  if (!Array.isArray(value)) return null;
  const rows = value.filter(
    (row) =>
      record(row) &&
      (row.expedition === undefined || validExpeditionProgress(row.expedition)) &&
      (row.details === undefined || validExpeditionDetails(row.details)),
  );
  return (rows.length === value.length ? value : rows) as DungeonFinderBoard;
}
