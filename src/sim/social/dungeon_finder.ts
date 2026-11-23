// Dungeon Finder (docs/prd/dungeon-finder.md): the realm-local group finder
// behind the SimContext seam. Two surfaces share this machine:
//
//  - the automatic role queue: indivisible solo/premade units, deterministic
//    FIFO matching with exact role composition, a 30 second availability
//    proposal, and a decline cooldown;
//  - the premade board: leader-published listings with structured tags and a
//    leader-approved application flow.
//
// Queue and manual listings form groups through PartyMachine. Open expeditions
// additionally bind a running claim; explicit travel reuses the normal door
// admission and never resets that claim or changes its difficulty. The finder
// draws no rng and reads only the sim clock. Matching runs at the end of a tick.
//
// src/sim-pure: imports only sibling sim types/content plus type-only IWorld
// view shapes (the sanctioned world_api type edge), so it runs unchanged in
// Node, the browser, and the headless RL env (tests/architecture.test.ts).

import type {
  DungeonFinderBoard,
  DungeonFinderExpeditionView,
  DungeonFinderInfo,
  DungeonFinderListingView,
  DungeonFinderProposalView,
  ExpeditionSettings,
} from '../../world_api/dungeon_finder';
import {
  FINDER_ACTIVITIES,
  FINDER_CLASS_ROLES,
  FINDER_ROLE_ORDER,
  type FinderActivity,
  type FinderComposition,
  type FinderListingTag,
  finderActivity,
} from '../content/dungeon_finder';
import type { Role } from '../content/talents';
import {
  canTravelToExpedition,
  currentExpeditionClaim,
  expeditionActivity,
  expeditionAdmission,
  expeditionClaimByExit,
  expeditionFinished,
  expeditionProgress,
  travelToExpedition,
} from '../instances/dungeon_expeditions';
import { instanceClaimHolds } from '../instances/dungeons';
import { admitQueueHelper, queueRewardsView } from '../instances/queue_participation';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { PlayerClass } from '../types';
import { chat } from './chat';
import {
  type ExpeditionDetails,
  ExpeditionSocialState,
  validExpeditionDetails,
} from './expedition_social';
import {
  FinderAdvertCooldowns,
  type FinderAdvertTarget,
  finderAdvertText,
  isFinderAdvertTarget,
} from './finder_advert';
import { FINDER_PLAYER_APPLICATION_CAP, FinderApplications } from './finder_applications';
import {
  finderGuildOf,
  guildPartyCreateError,
  isGuildParty,
  sharesLeaderGuild,
} from './finder_guild';
import { cleanFinderPartyRoles, planFinderDifficulty } from './finder_listing_edit';
import {
  finderLevelEligible,
  planFinderListing,
  planFinderRecruitment,
} from './finder_recruitment';
import { changeQueueReward, loadQueueRewards } from './queue_rewards';

export { finderLevelEligible } from './finder_recruitment';

// Host-only note admission runs after the machine rejects unchanged details.
export type FinderConfigureArgs = [
  settings: ExpeditionSettings,
  pid?: number,
  allowNote?: (note: string) => boolean,
];

// Availability window before a proposal expires (whole seconds).
export const FINDER_PROPOSAL_SECONDS = 30;
// Queue lockout after declining or letting a proposal expire (whole seconds).
export const FINDER_DECLINE_COOLDOWN_SECONDS = 60;
// FIFO candidate window per matching attempt: bounds the combination search
// while keeping strict join-order fairness inside the window.
export const FINDER_MATCH_UNIT_WINDOW = 24;
// Backstop on the combination search so a pathological queue can never stall
// a tick (the single-role pruning makes real queues far cheaper).
export const FINDER_MATCH_NODE_BUDGET = 4000;
// Board projection cap: the wire payload stays bounded however many listings
// a realm accumulates (oldest listings first, stable order).
export const FINDER_BOARD_LISTING_CAP = 50;
export const FINDER_EXPEDITION_APPLICATION_CAP = 20;
export const FINDER_EXPEDITION_APPLICATION_SECONDS = 120;
export const FINDER_EXPEDITION_APPLICATION_COOLDOWN = 10;
// Distinct recent requests are separate from the five simultaneously pending rows.
// Preserve every active retry deadline; a full window rejects further attempts.
export const FINDER_EXPEDITION_RECENT_APPLICATION_CAP = FINDER_BOARD_LISTING_CAP;

// ---------------------------------------------------------------------------
// Pure helpers (direct Vitest coverage in tests/dungeon_finder.test.ts).
// ---------------------------------------------------------------------------

// Role declarations describe class capabilities independently of current talents.
// Keep level/spec inputs compatible with callers; selecting a role changes neither.
export function compatibleFinderRoles(
  cls: PlayerClass,
  _level: number,
  _specRole: Role | null,
): Role[] {
  return FINDER_ROLE_ORDER.filter((role) => FINDER_CLASS_ROLES[role].includes(cls));
}

// Normalize a client-selected activity list: known ids only, auto-queue only,
// deduplicated, and re-ordered to catalogue order so "first activity of the
// oldest unit" is deterministic whatever order the client sent.
export function normalizeFinderSelection(activityIds: readonly string[]): string[] {
  const wanted = new Set(activityIds);
  return FINDER_ACTIVITIES.filter((a) => a.autoQueue && wanted.has(a.id)).map((a) => a.id);
}

export interface FinderRoleMember {
  pid: number;
  roles: readonly Role[];
}

export interface FinderRoleMatch {
  assigned: Map<number, Role>;
  open: FinderComposition;
}

// Maximum bipartite matching (Kuhn's augmenting paths) of members onto the
// role slots of `caps`. Deterministic: members in the given order, roles tried
// in FINDER_ROLE_ORDER. Members whose role set cannot be seated stay
// unassigned; `open` reports the leftover capacity per role.
export function matchFinderRoles(
  members: readonly FinderRoleMember[],
  caps: FinderComposition,
): FinderRoleMatch {
  const holders: Record<Role, number[]> = { tank: [], healer: [], dps: [] };
  const roleOf = new Map<number, Role>();

  // One augmenting path (Kuhn), used both for a fresh member (no `except`) and for the
  // holder being displaced out of `except`, which may not simply take that seat back.
  // FINDER_ROLE_ORDER is a total order and `visited` bounds the recursion, so the walk
  // stays deterministic and terminates.
  const seat = (i: number, visited: Set<Role>, except?: Role): boolean => {
    for (const role of FINDER_ROLE_ORDER) {
      if (role === except || !members[i].roles.includes(role) || visited.has(role)) continue;
      visited.add(role);
      if (holders[role].length < caps[role]) {
        holders[role].push(members[i].pid);
        roleOf.set(members[i].pid, role);
        return true;
      }
      for (let h = 0; h < holders[role].length; h++) {
        const otherPid = holders[role][h];
        const otherIdx = members.findIndex((m) => m.pid === otherPid);
        if (otherIdx < 0) continue;
        if (seat(otherIdx, visited, role)) {
          holders[role][h] = members[i].pid;
          roleOf.set(members[i].pid, role);
          return true;
        }
      }
    }
    return false;
  };

  for (let i = 0; i < members.length; i++) {
    if (roleOf.has(members[i].pid)) continue;
    seat(i, new Set());
  }
  return {
    assigned: roleOf,
    open: {
      tank: caps.tank - holders.tank.length,
      healer: caps.healer - holders.healer.length,
      dps: caps.dps - holders.dps.length,
    },
  };
}

// Exact composition check: every member seated and every slot filled. Returns
// the deterministic pid -> role map, or null when the set cannot form the
// composition.
export function assignFinderRoles(
  members: readonly FinderRoleMember[],
  caps: FinderComposition,
): Map<number, Role> | null {
  if (members.length !== caps.tank + caps.healer + caps.dps) return null;
  const match = matchFinderRoles(members, caps);
  if (match.assigned.size !== members.length) return null;
  return match.assigned;
}

// ---------------------------------------------------------------------------
// Machine state shapes.
// ---------------------------------------------------------------------------

export interface FinderQueueUnit {
  id: number; // monotonic (FIFO tiebreaker)
  joinedAt: number; // sim time of the ORIGINAL join; preserved across returns
  partyId: number | null; // premade party id (null = solo unit)
  leaderPid: number;
  members: number[]; // roster snapshot at join (revalidated every sweep)
  activities: string[]; // normalized selection (catalogue order)
}

interface FinderProposal {
  id: number;
  activityId: string;
  units: FinderQueueUnit[]; // held OUT of the queue while proposed
  roles: Map<number, Role>;
  accepted: Set<number>;
  expiresAt: number;
}

interface FinderListing {
  id: number;
  activityId: string;
  leaderPid: number;
  tags: FinderListingTag[];
  createdAt: number;
  expeditionExitId?: number;
  expeditionPartyId?: number | null;
  details?: ExpeditionDetails;
  // Roles the leader assigned to the party members this listing brought along
  // (read against the live roster, so a departed member's entry is inert).
  memberRoles?: Map<number, Role>;
}

// ---------------------------------------------------------------------------
// The machine.
// ---------------------------------------------------------------------------

export class DungeonFinderMachine {
  private readonly social = new ExpeditionSocialState();
  // Sticky per-player role selection (validated on write and on every use).
  private readonly roleSelections = new Map<number, Role[]>();
  // FIFO queue of indivisible units (solo players / whole premade parties).
  private queue: FinderQueueUnit[] = [];
  private readonly proposals: FinderProposal[] = [];
  private readonly cooldownUntil = new Map<number, number>();
  private listings: FinderListing[] = [];
  private readonly listingsByLeader = new Map<number, FinderListing>();
  private readonly applications = new FinderApplications();
  // Offline advert cooldowns (sim clock, keyed by player); online the server
  // owns them per account and never forwards an advertise command here.
  private readonly adverts = new FinderAdvertCooldowns();
  // At most FINDER_EXPEDITION_RECENT_APPLICATION_CAP entries per player,
  // including reservations held by pending applications until their response.
  private readonly expeditionApplicationUntil = new Map<number, Map<number, number>>();
  private readonly expeditionMemberships = new Map<
    number,
    { exitId: number; leaderPid: number; partyId: number; role?: Role }
  >();
  private nextUnitId = 1;
  private nextProposalId = 1;
  private nextListingId = 1;
  private nextApplicationSeq = 1;
  // Set by any queue mutation; matching runs once per tick at most.
  private matchDirty = false;
  // Board projection cache (viewer-independent): rebuilt when the revision
  // bumps or on the once-a-second sweep (party rosters mutate outside finder
  // commands), then delta-elided on the wire by the encoder.
  private boardRev = 1;
  private boardCache: DungeonFinderBoard = [];
  private boardCacheRev = 0;
  private boardCacheTick = -1;

  constructor(private readonly ctx: SimContext) {}

  // ---- shared validation ----------------------------------------------------

  private levelOf(pid: number): number {
    return this.ctx.entities.get(pid)?.level ?? 0;
  }

  private allowedRoles(pid: number): Role[] {
    const meta = this.ctx.players.get(pid);
    if (!meta) return [];
    const eligible = compatibleFinderRoles(meta.cls, this.levelOf(pid), meta.talentMods.role);
    const selected = this.roleSelections.get(pid) ?? [];
    return FINDER_ROLE_ORDER.filter((r) => selected.includes(r) && eligible.includes(r));
  }

  private unitFor(pid: number): FinderQueueUnit | null {
    return this.queue.find((u) => u.members.includes(pid)) ?? null;
  }

  private proposalFor(pid: number): FinderProposal | null {
    return this.proposals.find((p) => p.roles.has(pid)) ?? null;
  }

  private listingBy(leaderPid: number): FinderListing | null {
    return this.listingsByLeader.get(leaderPid) ?? null;
  }

  private addListing(listing: FinderListing): void {
    this.listings.push(listing);
    this.listingsByLeader.set(listing.leaderPid, listing);
  }

  private applicationsFor(listing: FinderListing) {
    return this.applications.forListing(listing.id);
  }

  private dropApplication(pid: number, listingId?: number): boolean {
    return this.applications.delete(pid, listingId);
  }

  onPartyJoined(pid: number): void {
    if (this.dropApplication(pid)) this.bumpBoard();
  }

  dungeonFinderExpeditionConfigure(...[settings, pid, allowNote]: FinderConfigureArgs): void {
    const r = this.ctx.resolve(pid);
    if (!r || r.meta.leaving) return;
    const id = r.meta.entityId;
    if (settings.kind === 'recruit') {
      const details = planFinderRecruitment(this.ctx, id, settings, {
        hasListing: (memberPid) => !!this.listingBy(memberPid),
        memberBlocksError: (leaderPid, memberPid) => this.memberBlocksError(leaderPid, memberPid),
        eligibleRoles: compatibleFinderRoles(r.meta.cls, r.e.level, r.meta.talentMods.role),
        queued: (memberPid) => !!this.unitFor(memberPid) || !!this.proposalFor(memberPid),
        pendingApplication: (memberPid) => this.applications.has(memberPid),
        ongoingExpedition: (memberPid) => !!this.expeditionViewFor(memberPid),
      });
      if (!details) return;
      this.roleSelections.set(id, [settings.role]);
      this.addListing({
        id: this.nextListingId++,
        activityId: settings.activityId,
        leaderPid: id,
        tags: [],
        createdAt: this.ctx.time,
        details,
      });
      this.matchDirty = true;
      this.bumpBoard();
      this.ctx.notice(id, 'Your group listing is published.');
    } else if (settings.kind === 'cancel_application') {
      if (Number.isSafeInteger(settings.listingId) && settings.listingId > 0)
        this.cancelApplication(id, settings.listingId);
    } else if (settings.kind === 'details') {
      const listing = this.listingBy(id);
      if (!listing || !validExpeditionDetails(settings.details)) return;
      const details = { purpose: settings.details.purpose, note: settings.details.note.trim() };
      if (
        (listing.details?.purpose ?? 'clear') === details.purpose &&
        (listing.details?.note ?? '') === details.note
      )
        return;
      if (allowNote && !allowNote(details.note)) return;
      if (!this.listingValid(listing)) return;
      listing.details = details;
      this.bumpBoard();
    } else if (settings.kind === 'available') {
      const eligible = compatibleFinderRoles(r.meta.cls, r.e.level, r.meta.talentMods.role);
      if (
        typeof settings.enabled !== 'boolean' ||
        !Array.isArray(settings.roles) ||
        settings.roles.length > 3 ||
        settings.roles.some((role) => !eligible.includes(role)) ||
        (settings.enabled && !settings.roles.length)
      )
        return;
      this.social.setAvailable(
        id,
        settings.enabled,
        FINDER_ROLE_ORDER.filter((role) => settings.roles.includes(role)),
      );
    } else if (settings.kind === 'advertise') {
      if (isFinderAdvertTarget(settings.target)) this.advertise(id, settings.target);
    } else if (settings.kind === 'party_roles') {
      const listing = this.listingBy(id);
      if (!listing || listing.expeditionExitId !== undefined || !Array.isArray(settings.roles))
        return;
      // The full assignment list each time: a member left out seats by their
      // own role selection again.
      listing.memberRoles = cleanFinderPartyRoles(
        this.ctx,
        id,
        this.listingMembers(listing),
        settings.roles,
      );
      this.bumpBoard();
    } else if (settings.kind === 'difficulty') {
      this.changeDifficulty(id, settings.activityId);
    } else if (settings.kind === 'reward') {
      const state = r.meta.queueRewards ?? loadQueueRewards();
      if (typeof settings.buy === 'boolean' && changeQueueReward(state, settings.id, settings.buy))
        r.meta.queueRewards = state;
    }
  }

  /** The "LFM - ..." line for a leader's listing, or null when it has none. */
  advertTextFor(leaderPid: number): string | null {
    const listing = this.listingBy(leaderPid);
    const activity = listing ? finderActivity(listing.activityId) : undefined;
    if (!listing || !activity || !this.listingValid(listing)) return null;
    const view = this.listingViewFor(listing, activity, this.listingMembers(listing));
    return view ? finderAdvertText({ ...view, guildOnly: isGuildParty(view.tags) }) : null;
  }

  // Offline host only: General reaches the local chat log; Discord needs the server.
  private advertise(pid: number, target: FinderAdvertTarget): void {
    const text = this.advertTextFor(pid);
    if (!text) {
      this.ctx.error(pid, 'You do not lead a group listing.');
      return;
    }
    if (target === 'discord') {
      this.ctx.error(pid, 'Posting to Discord is only available in online play.');
      return;
    }
    if (!this.adverts.use(pid, target, this.ctx.time)) {
      this.ctx.error(pid, 'You posted your group recently. Please wait before posting again.');
      return;
    }
    chat(this.ctx, `/general ${text}`, pid);
  }

  // Switch my listing to the same content's other difficulty. Pending
  // applicants outside the new level band are released with a notice.
  private changeDifficulty(id: number, activityId: unknown): void {
    const listing = this.listingBy(id);
    if (!listing) {
      this.ctx.error(id, 'You do not lead a group listing.');
      return;
    }
    if (listing.expeditionExitId !== undefined || typeof activityId !== 'string') {
      this.ctx.error(id, 'That listing is no longer available.');
      return;
    }
    const target = planFinderDifficulty(
      this.ctx,
      id,
      listing.activityId,
      activityId,
      this.listingMembers(listing),
      (leaderPid, memberPid) => this.memberBlocksError(leaderPid, memberPid),
    );
    if (!target) return;
    listing.activityId = target.id;
    for (const app of this.applicationsFor(listing)) {
      if (finderLevelEligible(target, this.levelOf(app.pid))) {
        // Kept applicants see the group's new difficulty in their applications.
        app.activityId = target.id;
        continue;
      }
      this.dropApplication(app.pid, listing.id);
      if (this.ctx.players.has(app.pid))
        this.ctx.notice(
          app.pid,
          'The group you applied to changed its difficulty, so your application was withdrawn.',
        );
    }
    this.bumpBoard();
    this.ctx.notice(id, 'Your group listing difficulty is updated.');
  }

  // A party member the leader assigned a role keeps it on this listing; anyone
  // else (the leader, accepted applicants) seats by their own role selection.
  private listingRoles(listing: FinderListing, pid: number): Role[] {
    const assigned = listing.memberRoles?.get(pid);
    return assigned ? [assigned] : this.allowedRoles(pid);
  }

  private listingMembers(listing: FinderListing): number[] {
    const party = this.ctx.partyOf(listing.leaderPid);
    return party ? [...party.members] : [listing.leaderPid];
  }

  // A premade unit is intact while its party still exists with the same leader
  // and the same roster; a solo unit while the player stays party-free.
  private unitIntact(unit: FinderQueueUnit): boolean {
    for (const pid of unit.members) {
      // `leaving` is the disconnect flag every other reward/eligibility system honours:
      // the player is still in players/entities during the persistence await, but their
      // removal is already committed, so they must not be matched into a group.
      const meta = this.ctx.players.get(pid);
      if (!meta || meta.leaving || !this.ctx.entities.has(pid)) return false;
    }
    if (unit.partyId === null) {
      return unit.members.length === 1 && this.ctx.partyOf(unit.leaderPid) === null;
    }
    const party = this.ctx.partyOf(unit.leaderPid);
    if (!party || party.id !== unit.partyId || party.leader !== unit.leaderPid) return false;
    if (party.members.length !== unit.members.length) return false;
    for (const pid of unit.members) if (!party.members.includes(pid)) return false;
    return true;
  }

  // Activities every member of the unit is still eligible for (level band and
  // a non-empty compatible role selection where roles are enforced).
  private eligibleActivitiesFor(unit: FinderQueueUnit): string[] {
    return unit.activities.filter((id) => {
      const activity = finderActivity(id);
      if (!activity || !activity.autoQueue || activity.composition === null) return false;
      if (unit.members.length >= activity.size) return false;
      for (const pid of unit.members) {
        if (!finderLevelEligible(activity, this.levelOf(pid))) return false;
        if (this.allowedRoles(pid).length === 0) return false;
      }
      return true;
    });
  }

  // ---- role selection --------------------------------------------------------

  dungeonFinderSetRoles(roles: Role[], pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    const eligible = compatibleFinderRoles(r.meta.cls, r.e.level, r.meta.talentMods.role);
    const cleaned = FINDER_ROLE_ORDER.filter((role) => roles.includes(role));
    const invalid = cleaned.some((role) => !eligible.includes(role));
    if (invalid) {
      this.ctx.error(id, 'You cannot fill that role.');
      return;
    }
    this.roleSelections.set(
      id,
      cleaned.filter((role) => eligible.includes(role)),
    );
    this.matchDirty = true;
    // Listing projections derive member roles from this selection.
    this.bumpBoard();
  }

  // ---- automatic queue -------------------------------------------------------

  dungeonFinderQueueJoin(activityIds: string[], pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    if (this.unitFor(id) || this.proposalFor(id)) {
      this.ctx.error(id, 'You are already in the Dungeon Finder queue.');
      return;
    }
    const party = this.ctx.partyOf(id);
    if (party && party.leader !== id) {
      this.ctx.error(id, 'Only the party leader may use the Dungeon Finder.');
      return;
    }
    const members = party ? [...party.members] : [id];
    for (const memberPid of members) {
      if (this.unitFor(memberPid) || this.proposalFor(memberPid)) {
        this.ctx.error(id, 'You are already in the Dungeon Finder queue.');
        return;
      }
      const until = this.cooldownUntil.get(memberPid) ?? 0;
      if (until > this.ctx.time) {
        if (memberPid === id) {
          this.ctx.error(id, 'You cannot join the queue again yet.');
        } else {
          const name = this.ctx.players.get(memberPid)?.name ?? 'A party member';
          this.ctx.error(id, `${name} cannot join the queue again yet.`);
        }
        return;
      }
    }
    const activities = normalizeFinderSelection(activityIds);
    if (activities.length === 0) {
      this.ctx.error(id, 'Select at least one activity to queue for.');
      return;
    }
    for (const activityId of activities) {
      const activity = finderActivity(activityId);
      if (!activity) continue;
      if (members.length >= activity.size) {
        this.ctx.error(id, 'Your group is too large for that activity.');
        return;
      }
      for (const memberPid of members) {
        if (!finderLevelEligible(activity, this.levelOf(memberPid))) {
          this.memberBlocksError(id, memberPid);
          return;
        }
        if (this.allowedRoles(memberPid).length === 0) {
          this.memberRolesError(id, memberPid);
          return;
        }
      }
    }
    const unit: FinderQueueUnit = {
      id: this.nextUnitId++,
      joinedAt: this.ctx.time,
      partyId: party?.id ?? null,
      leaderPid: id,
      members,
      activities,
    };
    this.queue.push(unit);
    this.matchDirty = true;
    for (const memberPid of members)
      this.ctx.notice(memberPid, 'You join the Dungeon Finder queue.');
  }

  private memberBlocksError(leaderPid: number, memberPid: number): void {
    if (memberPid === leaderPid) {
      this.ctx.error(leaderPid, 'You do not meet the level range for that activity.');
      return;
    }
    const name = this.ctx.players.get(memberPid)?.name ?? 'A party member';
    this.ctx.error(leaderPid, `${name} does not meet the level range for that activity.`);
  }

  private memberRolesError(leaderPid: number, memberPid: number): void {
    if (memberPid === leaderPid) {
      this.ctx.error(leaderPid, 'Select a Dungeon Finder role first.');
      return;
    }
    const name = this.ctx.players.get(memberPid)?.name ?? 'A party member';
    this.ctx.error(leaderPid, `${name} has not selected a Dungeon Finder role.`);
  }

  dungeonFinderQueueLeave(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    const unit = this.unitFor(id);
    if (!unit) {
      this.ctx.error(id, 'You are not in the Dungeon Finder queue.');
      return;
    }
    if (unit.partyId !== null && unit.leaderPid !== id) {
      this.ctx.error(id, 'Only the party leader may use the Dungeon Finder.');
      return;
    }
    this.dropUnit(unit);
    for (const memberPid of unit.members)
      this.ctx.notice(memberPid, 'You leave the Dungeon Finder queue.');
  }

  private dropUnit(unit: FinderQueueUnit): void {
    this.queue = this.queue.filter((u) => u.id !== unit.id);
    this.matchDirty = true;
  }

  // ---- proposals ------------------------------------------------------------

  dungeonFinderRespond(accept: boolean, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    const proposal = this.proposalFor(id);
    if (!proposal) {
      this.ctx.error(id, 'There is no group proposal to answer.');
      return;
    }
    if (!accept) {
      this.failProposal(proposal, new Set([id]), { blame: true });
      return;
    }
    if (proposal.accepted.has(id)) return;
    proposal.accepted.add(id);
    if (proposal.accepted.size === proposal.roles.size) this.completeProposal(proposal);
  }

  private removeProposal(proposal: FinderProposal): void {
    const idx = this.proposals.indexOf(proposal);
    if (idx >= 0) this.proposals.splice(idx, 1);
  }

  private failProposal(
    proposal: FinderProposal,
    offenders: Set<number>,
    opts: { blame: boolean },
  ): void {
    this.removeProposal(proposal);
    for (const unit of proposal.units) {
      const hasOffender = unit.members.some((m) => offenders.has(m));
      if (hasOffender || !this.unitIntact(unit)) {
        for (const memberPid of unit.members) {
          if (!this.ctx.players.has(memberPid)) continue;
          if (offenders.has(memberPid)) {
            if (opts.blame) {
              this.cooldownUntil.set(memberPid, this.ctx.time + FINDER_DECLINE_COOLDOWN_SECONDS);
            }
            this.ctx.notice(memberPid, 'You left the Dungeon Finder queue.');
          } else {
            this.ctx.notice(memberPid, 'Your group left the Dungeon Finder queue.');
          }
        }
        continue;
      }
      // Accepted (or still-deciding) intact units return with their ORIGINAL
      // join time, so a failed proposal never costs them their place.
      this.queue.push(unit);
      for (const memberPid of unit.members)
        this.ctx.notice(memberPid, 'The group did not assemble. You keep your place in the queue.');
    }
    this.matchDirty = true;
  }

  private completeProposal(proposal: FinderProposal): void {
    const activity = finderActivity(proposal.activityId);
    if (!activity) {
      this.failProposal(proposal, new Set(), { blame: false });
      return;
    }
    // Last-second revalidation: rosters intact, everyone still in range, and
    // every assigned role still legal for its player.
    for (const unit of proposal.units) {
      if (!this.unitIntact(unit)) {
        this.failProposal(proposal, new Set(unit.members), { blame: false });
        return;
      }
      for (const memberPid of unit.members) {
        const role = proposal.roles.get(memberPid);
        if (
          !finderLevelEligible(activity, this.levelOf(memberPid)) ||
          role === undefined ||
          !this.allowedRoles(memberPid).includes(role)
        ) {
          this.failProposal(proposal, new Set([memberPid]), { blame: false });
          return;
        }
      }
    }
    // Oldest-first, so the formation seam's "first premade keeps its party,
    // else the first solo leads" picks the longest-waiting unit even when the
    // matcher seated the anchor ahead of an older non-anchor unit.
    const ordered = [...proposal.units].sort((a, b) => a.joinedAt - b.joinedAt || a.id - b.id);
    const formed = this.ctx.formDungeonFinderGroup(
      ordered.map((u) => ({
        partyId: u.partyId,
        leaderPid: u.leaderPid,
        members: [...u.members],
      })),
      { raid: activity.kind === 'raid' },
    );
    if (!formed) {
      this.failProposal(proposal, new Set(), { blame: false });
      return;
    }
    this.removeProposal(proposal);
    for (const memberPid of proposal.roles.keys()) {
      // A formed member's finder side-state is stale by definition now.
      this.dropApplication(memberPid);
      const listing = this.listingBy(memberPid);
      if (listing) this.closeListing(listing, { notifyLeader: false });
      this.ctx.notice(
        memberPid,
        'Your Dungeon Finder group has assembled. Travel to the entrance together.',
      );
    }
    this.matchDirty = true;
  }

  // ---- premade board ---------------------------------------------------------

  dungeonFinderListingCreate(activityId: string, tags: FinderListingTag[], pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    if (
      !planFinderListing(this.ctx, id, activityId, {
        hasListing: (memberPid) => !!this.listingBy(memberPid),
        memberBlocksError: (leaderPid, memberPid) => this.memberBlocksError(leaderPid, memberPid),
      })
    )
      return;
    const seen = new Set<FinderListingTag>();
    const cleanedTags = tags.filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
    if (isGuildParty(cleanedTags)) {
      const party = this.ctx.partyOf(id);
      const error = guildPartyCreateError(this.ctx, id, party ? party.members : [id]);
      if (error) {
        this.ctx.error(id, error);
        return;
      }
    }
    this.addListing({
      id: this.nextListingId++,
      activityId,
      leaderPid: id,
      tags: cleanedTags,
      createdAt: this.ctx.time,
    });
    this.bumpBoard();
    this.ctx.notice(id, 'Your group listing is published.');
  }

  dungeonFinderExpeditionOpen(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    const claim = currentExpeditionClaim(this.ctx, id);
    const activity = claim ? expeditionActivity(claim) : null;
    const party = this.ctx.partyOf(id);
    if (party && party.leader !== id) {
      this.ctx.error(id, 'Only the party leader may use the Dungeon Finder.');
      return;
    }
    if (
      !claim ||
      !activity ||
      claim.exitId === null ||
      r.meta.leaving ||
      r.e.dead ||
      r.e.ghost ||
      expeditionFinished(this.ctx, claim, activity)
    ) {
      this.ctx.error(id, 'You must be inside an unfinished dungeon run to open recruitment.');
      return;
    }
    if (this.unitFor(id) || this.proposalFor(id)) {
      this.ctx.error(id, 'You are already in the Dungeon Finder queue.');
      return;
    }
    const members = party?.members ?? [id];
    if (members.length >= activity.size) {
      this.ctx.error(id, 'Your group is too large for that activity.');
      return;
    }
    for (const memberPid of members) {
      if (
        !finderLevelEligible(activity, this.levelOf(memberPid)) ||
        this.ctx.players.get(memberPid)?.leaving
      ) {
        this.memberBlocksError(id, memberPid);
        return;
      }
    }
    const existing = this.listingBy(id);
    if (existing?.expeditionExitId === claim.exitId) return;
    if (existing) this.closeListing(existing, { notifyLeader: false });
    this.addListing({
      id: this.nextListingId++,
      activityId: activity.id,
      leaderPid: id,
      tags: [],
      createdAt: this.ctx.time,
      expeditionExitId: claim.exitId,
      expeditionPartyId: party?.id ?? null,
      details: { purpose: 'clear', note: '' },
    });
    if (party) {
      for (const memberPid of members)
        this.expeditionMemberships.set(memberPid, {
          exitId: claim.exitId,
          leaderPid: id,
          partyId: party.id,
          role: this.allowedRoles(memberPid)[0],
        });
    }
    this.bumpBoard();
  }

  dungeonFinderExpeditionTravel(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const view = this.expeditionViewFor(r.meta.entityId);
    const claim = view ? expeditionClaimByExit(this.ctx, view.exitId) : null;
    if (!claim) this.ctx.error(r.meta.entityId, 'Your expedition is no longer available.');
    else if (!travelToExpedition(this.ctx, claim, r.meta.entityId))
      this.ctx.error(r.meta.entityId, 'You cannot travel to your expedition right now.');
  }

  dungeonFinderExpeditionApply(listingId: number, role: Role, pid?: number): void {
    const listing = this.listings.find((entry) => entry.id === listingId);
    if (
      !listing ||
      (listing.expeditionExitId === undefined &&
        finderActivity(listing.activityId)?.kind !== 'dungeon')
    ) {
      const r = this.ctx.resolve(pid);
      if (r) this.ctx.error(r.meta.entityId, 'That listing is no longer available.');
      return;
    }
    this.applyToListing(listingId, pid, role);
  }

  dungeonFinderListingClose(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    const listing = this.listingBy(id);
    if (!listing) {
      this.ctx.error(id, 'You do not lead a group listing.');
      return;
    }
    this.closeListing(listing, { notifyLeader: true });
  }

  private closeListing(listing: FinderListing, opts: { notifyLeader: boolean }): void {
    for (const app of this.applicationsFor(listing))
      if (listing.expeditionExitId !== undefined)
        this.social.outcome(app.pid, 'closed', this.ctx.players.get(listing.leaderPid)?.name ?? '');
    this.listings = this.listings.filter((l) => l.id !== listing.id);
    this.listingsByLeader.delete(listing.leaderPid);
    for (const app of this.applicationsFor(listing)) {
      const pid = app.pid;
      this.dropApplication(pid, listing.id);
      if (this.ctx.players.has(pid))
        this.ctx.notice(pid, 'The group listing you applied to has closed.');
    }
    if (opts.notifyLeader && this.ctx.players.has(listing.leaderPid))
      this.ctx.notice(listing.leaderPid, 'Your group listing is now closed.');
    this.bumpBoard();
  }

  dungeonFinderApply(listingId: number, pid?: number): void {
    this.applyToListing(listingId, pid);
  }

  private applyToListing(listingId: number, pid?: number, expeditionRole?: Role): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    if (
      this.applications.get(id, listingId) &&
      this.listings.some(
        (listing) => listing.id === listingId && listing.expeditionExitId !== undefined,
      )
    )
      return;
    const listing = this.listings.find((l) => l.id === listingId) ?? null;
    if (!listing || listing.leaderPid === id || !this.listingValid(listing)) {
      this.ctx.error(id, 'That listing is no longer available.');
      return;
    }
    if (isGuildParty(listing.tags) && !sharesLeaderGuild(this.ctx, listing.leaderPid, id)) {
      this.ctx.error(id, 'That group is a Guild Party for members of its guild only.');
      return;
    }
    const pending = this.applications.forPlayer(id);
    if (
      pending.length &&
      (listing.expeditionExitId === undefined || pending.some((app) => app.expiresAt === undefined))
    ) {
      this.ctx.error(id, 'You already have a pending application.');
      return;
    }
    if (pending.length >= FINDER_PLAYER_APPLICATION_CAP) {
      this.ctx.error(id, 'You may have at most 5 pending expedition applications.');
      return;
    }
    if (this.ctx.partyOf(id)) {
      this.ctx.error(id, 'Leave your party before applying to a listing.');
      return;
    }
    const activity = finderActivity(listing.activityId);
    if (!activity) {
      this.ctx.error(id, 'That listing is no longer available.');
      return;
    }
    if (!finderLevelEligible(activity, r.e.level)) {
      this.ctx.error(id, 'You do not meet the level range for that activity.');
      return;
    }
    let roles: Role[] = [];
    if (expeditionRole !== undefined && listing.expeditionExitId === undefined) {
      const eligible = compatibleFinderRoles(r.meta.cls, r.e.level, r.meta.talentMods.role);
      if (!eligible.includes(expeditionRole)) {
        this.ctx.error(id, 'You cannot fill that role.');
        return;
      }
      if (r.meta.leaving || this.unitFor(id) || this.proposalFor(id)) {
        this.ctx.error(id, 'That player is no longer available.');
        return;
      }
    }
    if (listing.expeditionExitId !== undefined) {
      const claim = expeditionClaimByExit(this.ctx, listing.expeditionExitId);
      const selected = expeditionRole ?? this.allowedRoles(id)[0];
      const eligible = compatibleFinderRoles(r.meta.cls, r.e.level, r.meta.talentMods.role);
      if (!selected || !eligible.includes(selected)) {
        this.memberRolesError(id, id);
        return;
      }
      const cooldowns = this.expeditionApplicationUntil.get(id);
      if (cooldowns) {
        for (const [targetId, until] of cooldowns)
          if (until <= this.ctx.time && !this.applications.get(id, targetId))
            cooldowns.delete(targetId);
        if (cooldowns.has(listingId) || cooldowns.size >= FINDER_EXPEDITION_RECENT_APPLICATION_CAP)
          return;
      }
      if (
        !claim ||
        !expeditionAdmission(this.ctx, claim, id, listing.leaderPid) ||
        this.unitFor(id) ||
        this.proposalFor(id) ||
        this.applicationsFor(listing).length >= FINDER_EXPEDITION_APPLICATION_CAP
      ) {
        this.ctx.error(id, 'That player is no longer available.');
        return;
      }
      roles = [selected];
    } else if (activity.composition !== null) {
      roles = expeditionRole === undefined ? this.allowedRoles(id) : [expeditionRole];
      if (roles.length === 0) {
        this.memberRolesError(id, id);
        return;
      }
      if (!this.applicantFits(listing, activity, id, roles)) {
        this.ctx.error(id, 'That listing has no room for your roles.');
        return;
      }
    } else if (this.listingMembers(listing).length >= activity.size) {
      this.ctx.error(id, 'That listing has no room for your roles.');
      return;
    }
    this.applications.set({
      pid: id,
      listingId: listing.id,
      activityId: listing.activityId,
      leaderPid: listing.leaderPid,
      roles,
      ...(expeditionRole === undefined || listing.expeditionExitId !== undefined
        ? {}
        : { selectedRole: expeditionRole }),
      at: this.nextApplicationSeq++,
      ...(listing.expeditionExitId !== undefined
        ? { expiresAt: this.ctx.time + FINDER_EXPEDITION_APPLICATION_SECONDS }
        : {}),
    });
    this.social.clearFeedback(id);
    this.bumpBoard();
    if (listing.expeditionExitId !== undefined) {
      const cooldowns = this.expeditionApplicationUntil.get(id) ?? new Map<number, number>();
      cooldowns.set(listingId, this.ctx.time + FINDER_EXPEDITION_APPLICATION_COOLDOWN);
      this.expeditionApplicationUntil.set(id, cooldowns);
      return;
    }
    this.ctx.notice(id, 'You apply to a group listing.');
    if (this.ctx.players.has(listing.leaderPid))
      this.ctx.notice(listing.leaderPid, `${r.meta.name} applies to your group listing.`);
  }

  // Can `applicantPid` be seated beside the listing's current members under
  // the activity composition?
  private applicantFits(
    listing: FinderListing,
    activity: FinderActivity,
    applicantPid: number,
    applicantRoles: readonly Role[],
  ): boolean {
    const comp = activity.composition;
    if (comp === null) return this.listingMembers(listing).length < activity.size;
    const members = this.listingMembers(listing);
    if (members.length >= activity.size) return false;
    const seated: FinderRoleMember[] = members
      .map((memberPid) => ({ pid: memberPid, roles: this.listingRoles(listing, memberPid) }))
      .filter((m) => m.roles.length > 0);
    seated.push({ pid: applicantPid, roles: applicantRoles });
    const match = matchFinderRoles(seated, comp);
    return match.assigned.has(applicantPid);
  }

  dungeonFinderApplyCancel(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    this.cancelApplication(id);
  }

  private cancelApplication(id: number, listingId?: number): void {
    const app = this.applications.get(id, listingId);
    if (!app) {
      this.ctx.error(id, 'You have no pending application.');
      return;
    }
    const listing = this.listings.find((l) => l.id === app.listingId);
    if (listing?.expeditionExitId !== undefined)
      this.social.outcome(id, 'cancelled', this.ctx.players.get(listing.leaderPid)?.name ?? '');
    this.dropApplication(id, app.listingId);
    this.bumpBoard();
    this.ctx.notice(id, 'You withdraw your application.');
  }

  dungeonFinderApplicationRespond(applicantPid: number, accept: boolean, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    const listing = this.listingBy(id);
    if (!listing) {
      this.ctx.error(id, 'You do not lead a group listing.');
      return;
    }
    const app = this.applications.get(applicantPid, listing.id);
    if (!app || app.listingId !== listing.id || !this.listingValid(listing)) {
      this.ctx.error(id, 'That player is no longer available.');
      return;
    }
    if (listing.expeditionExitId !== undefined)
      this.social.outcome(
        applicantPid,
        (app.expiresAt ?? 0) <= this.ctx.time ? 'expired' : accept ? 'closed' : 'declined',
        r.meta.name,
      );
    this.dropApplication(applicantPid, listing.id);
    this.bumpBoard();
    if (!accept) {
      if (listing.expeditionExitId !== undefined) {
        // Pending requests keep their bounded reservation until answered.
        this.expeditionApplicationUntil
          .get(applicantPid)
          ?.set(listing.id, this.ctx.time + FINDER_EXPEDITION_APPLICATION_COOLDOWN);
      }
      if (this.ctx.players.has(applicantPid))
        this.ctx.notice(applicantPid, 'Your application was declined.');
      return;
    }
    const activity = finderActivity(listing.activityId);
    const applicant = this.ctx.resolve(applicantPid);
    if (!activity || !applicant || this.ctx.partyOf(applicantPid)) {
      this.ctx.error(id, 'That player is no longer available.');
      return;
    }
    if (
      !finderLevelEligible(activity, applicant.e.level) ||
      (isGuildParty(listing.tags) && !sharesLeaderGuild(this.ctx, id, applicantPid))
    ) {
      this.ctx.error(id, 'That player is no longer available.');
      return;
    }
    const applicantRoles =
      app.selectedRole === undefined ? this.allowedRoles(applicantPid) : [app.selectedRole];
    if (
      app.selectedRole !== undefined &&
      (applicant.meta.leaving ||
        this.unitFor(applicantPid) ||
        this.proposalFor(applicantPid) ||
        !compatibleFinderRoles(
          applicant.meta.cls,
          applicant.e.level,
          applicant.meta.talentMods.role,
        ).includes(app.selectedRole))
    ) {
      this.ctx.error(id, 'That player is no longer available.');
      return;
    }
    if (
      listing.expeditionExitId === undefined &&
      activity.composition !== null &&
      !this.applicantFits(listing, activity, applicantPid, applicantRoles)
    ) {
      this.ctx.error(id, 'That listing has no room for your roles.');
      return;
    }
    const party = this.ctx.partyOf(id);
    if (party && party.leader !== id) {
      this.closeListing(listing, { notifyLeader: true });
      return;
    }
    if (this.listingMembers(listing).length >= activity.size) {
      this.ctx.error(id, 'Your group is too large for that activity.');
      return;
    }
    let expeditionClaim: InstanceSlot | undefined;
    if (listing.expeditionExitId !== undefined) {
      const claim = expeditionClaimByExit(this.ctx, listing.expeditionExitId);
      const eligible = compatibleFinderRoles(
        applicant.meta.cls,
        applicant.e.level,
        applicant.meta.talentMods.role,
      );
      if (
        !claim ||
        (app.expiresAt ?? 0) <= this.ctx.time ||
        app.roles.length !== 1 ||
        !eligible.includes(app.roles[0]) ||
        !expeditionAdmission(this.ctx, claim, applicantPid, id) ||
        this.unitFor(applicantPid) ||
        this.proposalFor(applicantPid)
      ) {
        this.ctx.error(id, 'That player is no longer available.');
        return;
      }
      expeditionClaim = claim;
    }
    const leaderUnit = {
      partyId: party?.id ?? null,
      leaderPid: id,
      members: party ? [...party.members] : [id],
    };
    const formed = this.ctx.formDungeonFinderGroup(
      [leaderUnit, { partyId: null, leaderPid: applicantPid, members: [applicantPid] }],
      { raid: activity.kind === 'raid', expeditionClaim },
    );
    if (!formed) {
      this.ctx.error(id, 'That player is no longer available.');
      return;
    }
    if (app.selectedRole !== undefined) this.roleSelections.set(applicantPid, [app.selectedRole]);
    // An accepted applicant seats by the role they applied with, never by an
    // assignment left over from an earlier spell in this party.
    listing.memberRoles?.delete(applicantPid);
    if (expeditionClaim && expeditionClaim.exitId !== null) {
      admitQueueHelper(this.ctx, expeditionClaim, applicantPid, formed.id);
      this.social.outcome(applicantPid, 'accepted', r.meta.name);
      listing.expeditionPartyId = formed.id;
      for (const memberPid of formed.members)
        this.expeditionMemberships.set(memberPid, {
          exitId: expeditionClaim.exitId,
          leaderPid: id,
          partyId: formed.id,
          role:
            memberPid === applicantPid
              ? app.roles[0]
              : (this.expeditionMemberships.get(memberPid)?.role ??
                this.allowedRoles(memberPid)[0]),
        });
    }
    this.ctx.notice(applicantPid, 'Your application was accepted.');
    // The applicant's own queue/application side-state is stale now that they
    // joined a party; the sweep would catch it, but clear it eagerly.
    const applicantUnit = this.unitFor(applicantPid);
    if (applicantUnit) this.dropUnit(applicantUnit);
    if (this.listingMembers(listing).length >= activity.size) {
      this.closeListing(listing, { notifyLeader: false });
      this.ctx.notice(id, 'Your group listing is now full.');
    } else {
      this.bumpBoard();
    }
  }

  // ---- lifecycle hooks --------------------------------------------------------

  // Called by Sim.removePlayer before the party machine tears the player out
  // of their party, so premade snapshots still resolve for notices.
  onPlayerRemoved(pid: number): void {
    this.social.remove(pid);
    this.roleSelections.delete(pid);
    this.cooldownUntil.delete(pid);
    this.expeditionApplicationUntil.delete(pid);
    this.expeditionMemberships.delete(pid);
    const unit = this.unitFor(pid);
    if (unit) {
      this.dropUnit(unit);
      for (const memberPid of unit.members) {
        if (memberPid !== pid && this.ctx.players.has(memberPid))
          this.ctx.notice(memberPid, 'Your group left the Dungeon Finder queue.');
      }
    }
    const proposal = this.proposalFor(pid);
    if (proposal) this.failProposal(proposal, new Set([pid]), { blame: false });
    const listing = this.listingBy(pid);
    if (listing) this.closeListing(listing, { notifyLeader: false });
    if (this.dropApplication(pid)) this.bumpBoard();
  }

  // ---- per-tick update (end-of-tick system block) ------------------------------

  update(): void {
    if (this.ctx.tickCount % 20 === 0) {
      this.sweep();
      const occupied = new Set(this.queue.flatMap((unit) => unit.members));
      for (const proposal of this.proposals)
        for (const pid of proposal.roles.keys()) occupied.add(pid);
      const leaderListings = new Map(
        this.listings.map((listing) => [listing.leaderPid, listing.id]),
      );
      const viewers = new Map<
        number,
        { level: number; roles: Role[]; ownListing?: number } | null
      >();
      this.social.update(this.buildBoard(), this.ctx.time, (pid, row, selected) => {
        if (!viewers.has(pid)) {
          const meta = this.ctx.players.get(pid);
          const level = this.levelOf(pid);
          viewers.set(
            pid,
            !meta ||
              meta.leaving ||
              this.ctx.partyOf(pid) ||
              occupied.has(pid) ||
              this.applications.has(pid)
              ? null
              : {
                  level,
                  roles: compatibleFinderRoles(meta.cls, level, meta.talentMods.role),
                  ownListing: leaderListings.get(pid),
                },
          );
        }
        const viewer = viewers.get(pid);
        const activity = finderActivity(row.activityId);
        return (
          !!viewer &&
          !!activity &&
          viewer.ownListing !== row.id &&
          finderLevelEligible(activity, viewer.level) &&
          row.size < row.capacity &&
          (row.guild === undefined || finderGuildOf(this.ctx, pid) === row.guild) &&
          selected.some((role) => viewer.roles.includes(role))
        );
      });
    }
    if (this.matchDirty) {
      this.matchDirty = false;
      this.runMatching();
    }
  }

  // Once a second: expire proposals, revalidate queue units, listings, and
  // applications against live party/level/role state.
  private sweep(): void {
    for (const proposal of [...this.proposals]) {
      if (proposal.expiresAt > this.ctx.time) continue;
      const offenders = new Set<number>();
      for (const memberPid of proposal.roles.keys()) {
        if (!proposal.accepted.has(memberPid)) offenders.add(memberPid);
      }
      this.failProposal(proposal, offenders, { blame: true });
    }
    for (const unit of [...this.queue]) {
      if (!this.unitIntact(unit)) {
        this.dropUnit(unit);
        for (const memberPid of unit.members) {
          if (this.ctx.players.has(memberPid))
            this.ctx.notice(memberPid, 'Your group changed and left the Dungeon Finder queue.');
        }
        continue;
      }
      const still = this.eligibleActivitiesFor(unit);
      if (still.length === 0) {
        this.dropUnit(unit);
        for (const memberPid of unit.members)
          this.ctx.notice(memberPid, 'Your group changed and left the Dungeon Finder queue.');
      } else if (still.length !== unit.activities.length) {
        unit.activities = still;
        this.matchDirty = true;
      }
    }
    for (const listing of [...this.listings]) {
      if (!this.listingValid(listing)) this.closeListing(listing, { notifyLeader: true });
    }
    for (const [pid, cooldowns] of this.expeditionApplicationUntil) {
      for (const [listingId, until] of cooldowns)
        if (until <= this.ctx.time && !this.applications.get(pid, listingId))
          cooldowns.delete(listingId);
      if (!cooldowns.size) this.expeditionApplicationUntil.delete(pid);
    }
    for (const [pid, membership] of this.expeditionMemberships) {
      const party = this.ctx.partyOf(pid);
      const claim = expeditionClaimByExit(this.ctx, membership.exitId);
      const activity = claim ? expeditionActivity(claim) : null;
      if (
        !party ||
        party.id !== membership.partyId ||
        party.leader !== membership.leaderPid ||
        !claim ||
        claim.partyKey !== `party:${party.id}` ||
        !activity ||
        expeditionFinished(this.ctx, claim, activity)
      )
        this.expeditionMemberships.delete(pid);
    }
    for (const app of this.applications.values()) {
      const pid = app.pid;
      const listing = this.listings.find((l) => l.id === app.listingId) ?? null;
      if (!listing) {
        // closeListing already notified; entry only lingers if the player
        // vanished mid-close.
        this.dropApplication(pid, app.listingId);
        continue;
      }
      const activity = finderActivity(listing.activityId);
      const meta = this.ctx.players.get(pid);
      const alive = !!meta && this.ctx.entities.has(pid);
      const eligible =
        alive &&
        activity !== null &&
        this.ctx.partyOf(pid) === null &&
        finderLevelEligible(activity, this.levelOf(pid)) &&
        !this.ctx.players.get(pid)?.leaving &&
        (listing.expeditionExitId !== undefined
          ? (app.expiresAt ?? 0) > this.ctx.time &&
            app.roles.every((role) => {
              const meta = this.ctx.players.get(pid);
              return (
                meta &&
                compatibleFinderRoles(meta.cls, this.levelOf(pid), meta.talentMods.role).includes(
                  role,
                )
              );
            })
          : app.selectedRole !== undefined
            ? compatibleFinderRoles(meta.cls, this.levelOf(pid), null).includes(app.selectedRole)
            : activity.composition === null || this.allowedRoles(pid).length > 0);
      if (!eligible) {
        if (listing.expeditionExitId !== undefined)
          this.social.outcome(
            pid,
            (app.expiresAt ?? 0) <= this.ctx.time ? 'expired' : 'closed',
            this.ctx.players.get(listing.leaderPid)?.name ?? '',
          );
        this.dropApplication(pid, app.listingId);
        this.bumpBoard();
        if (alive) this.ctx.notice(pid, 'You withdraw your application.');
      }
    }
  }

  private listingValid(listing: FinderListing): boolean {
    const activity = finderActivity(listing.activityId);
    if (!activity) return false;
    if (
      !this.ctx.players.has(listing.leaderPid) ||
      this.ctx.players.get(listing.leaderPid)?.leaving
    )
      return false;
    const party = this.ctx.partyOf(listing.leaderPid);
    if (party && party.leader !== listing.leaderPid) return false;
    const members = this.listingMembers(listing);
    if (members.length >= activity.size) return false;
    // A Guild Party stays one guild: the leader leaving their guild, or an
    // outsider joining the party by invite, closes it on the next sweep.
    if (isGuildParty(listing.tags) && guildPartyCreateError(this.ctx, listing.leaderPid, members))
      return false;
    if (listing.expeditionExitId !== undefined) {
      const claim = expeditionClaimByExit(this.ctx, listing.expeditionExitId);
      if (
        (party?.id ?? null) !== listing.expeditionPartyId ||
        !claim ||
        !this.ctx.entities.get(listing.leaderPid) ||
        !instanceClaimHolds(claim, this.ctx.entities.get(listing.leaderPid)!.pos) ||
        claim.partyKey !== this.ctx.instanceKeyFor(listing.leaderPid) ||
        !expeditionActivity(claim) ||
        expeditionFinished(this.ctx, claim, activity)
      )
        return false;
    }
    for (const memberPid of members) {
      if (
        !this.ctx.players.has(memberPid) ||
        this.ctx.players.get(memberPid)?.leaving ||
        !finderLevelEligible(activity, this.levelOf(memberPid))
      )
        return false;
    }
    return true;
  }

  // ---- deterministic matching ---------------------------------------------------

  private runMatching(): void {
    // Stable FIFO order: original join time, then unit id.
    let changed = true;
    while (changed) {
      changed = false;
      const sorted = [...this.queue].sort((a, b) => a.joinedAt - b.joinedAt || a.id - b.id);
      for (const anchor of sorted) {
        const anchorActivities = this.eligibleActivitiesFor(anchor);
        for (const activityId of anchorActivities) {
          const activity = finderActivity(activityId);
          if (!activity || activity.composition === null) continue;
          const match = this.tryAssemble(sorted, anchor, activity);
          if (!match) continue;
          this.createProposal(activity, match.units, match.roles);
          changed = true;
          break;
        }
        if (changed) break;
      }
    }
  }

  private unitRoleMembers(unit: FinderQueueUnit): FinderRoleMember[] {
    return unit.members.map((pid) => ({ pid, roles: this.allowedRoles(pid) }));
  }

  // Search a FIFO window of compatible units for an exact-size, exact-role
  // combination that includes `anchor`. Deterministic: candidates in FIFO
  // order, include-before-exclude, first solution wins, bounded node budget.
  private tryAssemble(
    sorted: FinderQueueUnit[],
    anchor: FinderQueueUnit,
    activity: FinderActivity,
  ): { units: FinderQueueUnit[]; roles: Map<number, Role> } | null {
    const comp = activity.composition;
    if (comp === null) return null;
    const target = activity.size;
    // Anchor first (mandatory), then every other compatible unit in FIFO
    // order. An older unit may appear here even though it failed as its own
    // anchor: skipping it is legal (it could not form a group anyway), taking
    // it keeps its wait from growing.
    const others = sorted.filter(
      (u) =>
        u.id !== anchor.id &&
        u.members.length < target &&
        this.eligibleActivitiesFor(u).includes(activity.id),
    );
    const candidates = [anchor, ...others].slice(0, FINDER_MATCH_UNIT_WINDOW);
    const roleMembers = new Map<number, FinderRoleMember[]>();
    for (const u of candidates) roleMembers.set(u.id, this.unitRoleMembers(u));

    let budget = FINDER_MATCH_NODE_BUDGET;
    const chosen: FinderQueueUnit[] = [];
    let solution: { units: FinderQueueUnit[]; roles: Map<number, Role> } | null = null;

    const dfs = (idx: number, size: number): boolean => {
      if (budget-- <= 0) return true; // out of budget: stop the whole search
      if (size === target) {
        const members = chosen.flatMap((u) => roleMembers.get(u.id) ?? []);
        const roles = assignFinderRoles(members, comp);
        if (roles) {
          solution = { units: [...chosen], roles };
          return true;
        }
        return false;
      }
      if (idx >= candidates.length) return false;
      // Prune: even taking every remaining unit cannot reach the target.
      let remaining = 0;
      for (let i = idx; i < candidates.length; i++) remaining += candidates[i].members.length;
      if (size + remaining < target) return false;
      const unit = candidates[idx];
      if (size + unit.members.length <= target) {
        chosen.push(unit);
        if (dfs(idx + 1, size + unit.members.length)) return true;
        chosen.pop();
      }
      return dfs(idx + 1, size);
    };

    chosen.push(anchor);
    // Anchor is candidates[0]; the DFS walks the rest.
    dfs(1, anchor.members.length);
    return solution;
  }

  private createProposal(
    activity: FinderActivity,
    units: FinderQueueUnit[],
    roles: Map<number, Role>,
  ): void {
    const ids = new Set(units.map((u) => u.id));
    this.queue = this.queue.filter((u) => !ids.has(u.id));
    const proposal: FinderProposal = {
      id: this.nextProposalId++,
      activityId: activity.id,
      units,
      roles,
      accepted: new Set(),
      expiresAt: this.ctx.time + FINDER_PROPOSAL_SECONDS,
    };
    this.proposals.push(proposal);
    for (const memberPid of roles.keys()) {
      this.ctx.notice(memberPid, 'A dungeon group is ready. Confirm your slot now.');
      this.ctx.emit({ type: 'dfProposal', pid: memberPid });
    }
    // Dev bots ("/dev lfg" seeding, devCommands only) answer instantly, so a
    // solo tester only has to confirm their own slot. May complete the
    // proposal right here when every participant is a bot.
    for (const memberPid of [...roles.keys()]) {
      if (this.ctx.players.get(memberPid)?.isDevBot) this.dungeonFinderRespond(true, memberPid);
    }
  }

  // ---- IWorld projections --------------------------------------------------------

  buildInfoFor(pid: number): DungeonFinderInfo {
    const meta = this.ctx.players.get(pid) ?? null;
    const level = this.levelOf(pid);
    const eligibleRoles = meta ? compatibleFinderRoles(meta.cls, level, meta.talentMods.role) : [];
    const selection = this.roleSelections.get(pid) ?? [];
    const roles = FINDER_ROLE_ORDER.filter(
      (r) => selection.includes(r) && eligibleRoles.includes(r),
    );
    const unit = this.unitFor(pid);
    const proposal = this.proposalFor(pid);
    const heldUnit = proposal?.units.find((u) => u.members.includes(pid)) ?? null;
    const queueUnit = unit ?? heldUnit;
    const until = this.cooldownUntil.get(pid) ?? 0;
    const listing = this.listingBy(pid);
    const advertText = listing ? this.advertTextFor(pid) : null;
    // Personal projection is bounded by FINDER_PLAYER_APPLICATION_CAP (5).
    const myApplications = this.applications.forPlayer(pid).map((app) => {
      return {
        listingId: app.listingId,
        activityId: app.activityId,
        leaderName: this.ctx.players.get(app.leaderPid)?.name ?? '',
        ...(app.expiresAt === undefined
          ? {}
          : {
              remaining: Math.max(0, Math.ceil(app.expiresAt - this.ctx.time)),
            }),
      };
    });
    return {
      roles,
      eligibleRoles,
      queue: queueUnit
        ? {
            activities: [...queueUnit.activities],
            waited: Math.max(0, Math.floor(this.ctx.time - queueUnit.joinedAt)),
          }
        : null,
      cooldown: Math.max(0, Math.ceil(until - this.ctx.time)),
      proposal: proposal ? this.proposalViewFor(proposal, pid) : null,
      myListing: listing
        ? {
            id: listing.id,
            activityId: listing.activityId,
            tags: [...listing.tags],
            ...(listing.details ? { details: { ...listing.details } } : {}),
            ...(advertText ? { advertText } : {}),
            partyRoles: this.listingMembers(listing).flatMap((memberPid) => {
              const role = listing.memberRoles?.get(memberPid);
              return role ? [{ pid: memberPid, role }] : [];
            }),
            applicants: this.applicationsFor(listing)
              .sort((a, b) => a.at - b.at)
              .map((a) => {
                const applicant = this.ctx.players.get(a.pid);
                return {
                  pid: a.pid,
                  name: applicant?.name ?? '',
                  cls: applicant?.cls ?? 'warrior',
                  spec: applicant?.talents.spec ?? null,
                  level: this.levelOf(a.pid),
                  roles: [...a.roles],
                  gear: { ...(this.ctx.entities.get(a.pid)?.equippedItems ?? {}) },
                  ...(a.expiresAt === undefined
                    ? {}
                    : { remaining: Math.max(0, Math.ceil(a.expiresAt - this.ctx.time)) }),
                };
              }),
          }
        : null,
      myApplication: myApplications[0] ?? null,
      myApplications,
      expedition: this.expeditionViewFor(pid),
      availability: this.social.readAvailability(pid),
      applicationFeedback: this.social.readFeedback(pid),
      advert: this.adverts.view(pid, this.ctx.time, false),
      queueRewards: queueRewardsView(meta?.queueRewards, this.ctx.resetDay),
    };
  }

  private expeditionViewFor(pid: number): DungeonFinderExpeditionView | null {
    const party = this.ctx.partyOf(pid);
    const leaderPid = party?.leader ?? pid;
    let claim = currentExpeditionClaim(this.ctx, pid);
    if (!claim) {
      const membership = this.expeditionMemberships.get(pid);
      if (membership && party?.id === membership.partyId && leaderPid === membership.leaderPid)
        claim = expeditionClaimByExit(this.ctx, membership.exitId);
    }
    const activity = claim ? expeditionActivity(claim) : null;
    if (
      !claim ||
      claim.exitId === null ||
      !activity ||
      claim.partyKey !== this.ctx.instanceKeyFor(pid) ||
      expeditionFinished(this.ctx, claim, activity)
    )
      return null;
    const player = this.ctx.entities.get(pid);
    const listing = this.listingBy(leaderPid);
    return {
      exitId: claim.exitId,
      activityId: activity.id,
      dungeonId: claim.dungeonId,
      leaderPid,
      isLeader: leaderPid === pid,
      isInside: !!player && instanceClaimHolds(claim, player.pos),
      canTravel: canTravelToExpedition(this.ctx, claim, pid),
      open: listing?.expeditionExitId === claim.exitId && this.listingValid(listing),
      ...expeditionProgress(this.ctx, claim, activity),
    };
  }

  private proposalViewFor(proposal: FinderProposal, pid: number): DungeonFinderProposalView {
    const acceptedByRole = { tank: 0, healer: 0, dps: 0 };
    for (const [memberPid, role] of proposal.roles) {
      if (proposal.accepted.has(memberPid)) acceptedByRole[role]++;
    }
    return {
      id: proposal.id,
      activityId: proposal.activityId,
      role: proposal.roles.get(pid) ?? 'dps',
      size: proposal.roles.size,
      accepted: proposal.accepted.size,
      acceptedByRole,
      myResponse: proposal.accepted.has(pid) ? 'accepted' : 'pending',
      remaining: Math.max(0, Math.ceil(proposal.expiresAt - this.ctx.time)),
    };
  }

  private bumpBoard(): void {
    this.boardRev++;
  }

  buildBoard(): DungeonFinderBoard {
    // Party rosters mutate outside finder commands, so the cache also refreshes
    // on the once-a-second sweep tick; the wire delta elides unchanged output.
    const tickBucket = Math.floor(this.ctx.tickCount / 20);
    if (this.boardCacheRev === this.boardRev && this.boardCacheTick === tickBucket) {
      return this.boardCache;
    }
    const board: DungeonFinderListingView[] = [];
    for (const listing of this.listings) {
      if (board.length >= FINDER_BOARD_LISTING_CAP) break;
      const activity = finderActivity(listing.activityId);
      if (!activity || !this.listingValid(listing)) continue;
      const members = this.listingMembers(listing);
      const view = this.listingViewFor(listing, activity, members);
      if (view) board.push(view);
    }
    this.boardCache = board;
    this.boardCacheRev = this.boardRev;
    this.boardCacheTick = tickBucket;
    return board;
  }

  private listingViewFor(
    listing: FinderListing,
    activity: FinderActivity,
    members: number[],
  ): DungeonFinderListingView | null {
    const leader = this.ctx.players.get(listing.leaderPid);
    if (!leader) return null;
    let assigned = new Map<number, Role>();
    let needed: { tank: number; healer: number; dps: number } | null = null;
    if (listing.expeditionExitId !== undefined) {
      for (const pid of members) {
        const role = this.expeditionMemberships.get(pid)?.role ?? this.allowedRoles(pid)[0];
        if (role) assigned.set(pid, role);
      }
    } else if (activity.composition !== null) {
      const seatable: FinderRoleMember[] = members
        .map((pid) => ({ pid, roles: this.listingRoles(listing, pid) }))
        .filter((m) => m.roles.length > 0);
      const match = matchFinderRoles(seatable, activity.composition);
      assigned = match.assigned;
      needed = {
        tank: Math.max(0, match.open.tank),
        healer: Math.max(0, match.open.healer),
        dps: Math.max(0, match.open.dps),
      };
    }
    return {
      id: listing.id,
      activityId: listing.activityId,
      leaderName: leader.name,
      ...(listing.details ? { details: { ...listing.details } } : {}),
      ...(listing.expeditionExitId !== undefined
        ? {
            expedition: expeditionProgress(
              this.ctx,
              expeditionClaimByExit(this.ctx, listing.expeditionExitId)!,
              activity,
            ),
          }
        : {}),
      tags: [...listing.tags],
      ...(isGuildParty(listing.tags) ? { guild: finderGuildOf(this.ctx, listing.leaderPid) } : {}),
      size: members.length,
      capacity: activity.size,
      needed,
      members: members.map((pid) => {
        const meta = this.ctx.players.get(pid);
        return {
          cls: meta?.cls ?? 'warrior',
          level: this.levelOf(pid),
          role: assigned.get(pid) ?? null,
        };
      }),
    };
  }
}
