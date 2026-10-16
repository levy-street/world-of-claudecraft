// Dungeon Finder wire surface: the nine df_* command bodies, extracted whole
// from server/game.ts (the monolith ratchet paid for the dungeon guide's
// answer command; the farming_commands.ts precedent). The case labels stay in
// game.ts: the command-schema suite scans that switch for the dispatch
// universe, and the labels ARE the protocol surface.
//
// Deliberately NOT in HEAVY_SELF_CMDS: finder state rides its own `df`/`dfb`
// delta keys, and group formation bumps the party key through the normal
// snapshot path. Every field is validated here; the Sim re-validates
// eligibility, roles, capacity, and party state authoritatively.

import { isFinderListingTag, isFinderRole } from '../src/sim/content/dungeon_finder';
import type { Sim } from '../src/sim/sim';

/** Routes one Dungeon Finder command frame (`msg` is the parsed client frame,
 *  every field re-guarded here exactly as dispatchMessage guarded it). */
export function dispatchDungeonFinderCommand(
  sim: Sim,
  msg: Record<string, unknown>,
  pid: number,
): void {
  switch (msg.cmd) {
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
  }
}
