// Validated Dungeon Finder command family. Admission remains authoritative in Sim.
import { isFinderListingTag, isFinderRole } from '../src/sim/content/dungeon_finder';
import { QUEUE_REWARDS } from '../src/sim/content/queue_rewards';
import type { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';

// Both the personal `df` and realm-wide `dfb` snapshots use this cadence.
// Whole-second request clocks stay live without rebuilding views at 20 Hz.
export const DF_WIRE_HZ = 2;
export const DF_WIRE_INTERVAL_TICKS = Math.max(1, Math.round(1 / (DT * DF_WIRE_HZ)));

import { validExpeditionDetails } from '../src/sim/social/expedition_social';
import { type FinderAdvertTarget, isFinderAdvertTarget } from '../src/sim/social/finder_advert';
import { FINDER_PARTY_ROLES_CAP } from '../src/sim/social/finder_listing_edit';

// `advertise` is the server-owned listing advert (per-account cooldowns and the
// chat/Discord routes live in server/community_relay.ts). Without it, an
// advertise command is dropped: the Sim's own advert path is the offline host's.
export function dispatchDungeonFinderCommand(
  sim: Sim,
  pid: number,
  msg: Record<string, unknown>,
  allowNote: (note: string) => boolean = () => true,
  advertise?: (target: FinderAdvertTarget) => void,
): void {
  switch (msg.cmd) {
    case 'df_expedition_configure': {
      const s = msg.settings;
      if (!s || typeof s !== 'object' || Array.isArray(s)) break;
      const value = s as Record<string, unknown>;
      if (
        value.kind === 'recruit' &&
        typeof value.activityId === 'string' &&
        value.activityId.length > 0 &&
        value.activityId.length <= 64 &&
        isFinderRole(value.role) &&
        validExpeditionDetails(value.details) &&
        allowNote(value.details.note.trim())
      )
        sim.dungeonFinderExpeditionConfigure(
          {
            kind: 'recruit',
            activityId: value.activityId,
            role: value.role,
            details: { purpose: value.details.purpose, note: value.details.note.trim() },
          },
          pid,
        );
      else if (
        value.kind === 'cancel_application' &&
        typeof value.listingId === 'number' &&
        Number.isSafeInteger(value.listingId) &&
        value.listingId > 0
      )
        sim.dungeonFinderExpeditionConfigure(
          { kind: 'cancel_application', listingId: value.listingId },
          pid,
        );
      else if (value.kind === 'details' && validExpeditionDetails(value.details)) {
        const details = { purpose: value.details.purpose, note: value.details.note.trim() };
        sim.dungeonFinderExpeditionConfigure({ kind: 'details', details }, pid, allowNote);
      } else if (
        value.kind === 'available' &&
        typeof value.enabled === 'boolean' &&
        Array.isArray(value.roles) &&
        value.roles.length <= 3 &&
        value.roles.every(isFinderRole)
      )
        sim.dungeonFinderExpeditionConfigure(
          { kind: 'available', enabled: value.enabled, roles: value.roles },
          pid,
        );
      else if (value.kind === 'advertise' && isFinderAdvertTarget(value.target))
        advertise?.(value.target);
      else if (
        value.kind === 'party_roles' &&
        Array.isArray(value.roles) &&
        value.roles.length <= FINDER_PARTY_ROLES_CAP &&
        value.roles.every(
          (entry) =>
            !!entry &&
            typeof entry === 'object' &&
            Number.isSafeInteger(entry.pid) &&
            entry.pid > 0 &&
            isFinderRole(entry.role),
        )
      )
        sim.dungeonFinderExpeditionConfigure(
          {
            kind: 'party_roles',
            roles: value.roles.map((entry) => ({ pid: entry.pid, role: entry.role })),
          },
          pid,
        );
      else if (
        value.kind === 'difficulty' &&
        typeof value.activityId === 'string' &&
        value.activityId.length > 0 &&
        value.activityId.length <= 64
      )
        sim.dungeonFinderExpeditionConfigure(
          { kind: 'difficulty', activityId: value.activityId },
          pid,
        );
      else if (
        value.kind === 'reward' &&
        typeof value.buy === 'boolean' &&
        (value.id === null || QUEUE_REWARDS.some((r) => r.id === value.id))
      )
        sim.dungeonFinderExpeditionConfigure(
          {
            kind: 'reward',
            id: value.id as import('../src/sim/content/queue_rewards').QueueRewardId | null,
            buy: value.buy,
          },
          pid,
        );
      break;
    }
    case 'df_roles': {
      if (Array.isArray(msg.roles) && msg.roles.length <= 3) {
        const roles = msg.roles.filter(isFinderRole);
        if (roles.length === msg.roles.length) sim.dungeonFinderSetRoles(roles, pid);
      }
      break;
    }
    case 'df_queue': {
      if (Array.isArray(msg.activities) && msg.activities.length <= 16) {
        const activities = msg.activities.filter(
          (a): a is string => typeof a === 'string' && a.length <= 64,
        );
        if (activities.length === msg.activities.length)
          sim.dungeonFinderQueueJoin(activities, pid);
      }
      break;
    }
    case 'df_queue_leave':
      sim.dungeonFinderQueueLeave(pid);
      break;
    case 'df_proposal':
      sim.dungeonFinderRespond(msg.accept === true, pid);
      break;
    case 'df_list_create': {
      if (
        typeof msg.activity === 'string' &&
        msg.activity.length <= 64 &&
        Array.isArray(msg.tags) &&
        msg.tags.length <= 8
      ) {
        const tags = msg.tags.filter(isFinderListingTag);
        if (tags.length === msg.tags.length)
          sim.dungeonFinderListingCreate(msg.activity, tags, pid);
      }
      break;
    }
    case 'df_list_close':
      sim.dungeonFinderListingClose(pid);
      break;
    case 'df_apply':
      if (typeof msg.listing === 'number' && Number.isFinite(msg.listing))
        sim.dungeonFinderApply(msg.listing, pid);
      break;
    case 'df_apply_cancel':
      sim.dungeonFinderApplyCancel(pid);
      break;
    case 'df_app_respond':
      if (typeof msg.applicant === 'number' && Number.isFinite(msg.applicant))
        sim.dungeonFinderApplicationRespond(msg.applicant, msg.accept === true, pid);
      break;

    case 'df_expedition_open':
      sim.dungeonFinderExpeditionOpen(pid);
      break;
    case 'df_expedition_travel':
      sim.dungeonFinderExpeditionTravel(pid);
      break;
    case 'df_expedition_apply':
      if (
        typeof msg.listing === 'number' &&
        Number.isSafeInteger(msg.listing) &&
        msg.listing > 0 &&
        isFinderRole(msg.role)
      )
        sim.dungeonFinderExpeditionApply(msg.listing, msg.role, pid);
      break;
  }
}
