// Dungeon Finder (docs/prd/dungeon-finder.md): the realm-local group finder
// behind the SimContext seam. Two surfaces share this machine:
//
//  - the automatic role queue: indivisible solo/premade units, deterministic
//    FIFO matching with exact role composition, a 30 second availability
//    proposal, and a decline cooldown;
//  - the premade board: leader-published listings with structured tags and a
//    leader-approved application flow.
//
// The finder only FORMS groups (through PartyMachine.formDungeonFinderGroup).
// It never teleports, enters instances, changes dungeon difficulty, or touches
// loot settings. It draws no rng and reads only the sim clock (ctx.time /
// ctx.tickCount), so installing it cannot perturb determinism; matching runs
// from the end-of-tick update, never per command.
//
// src/sim-pure: imports only sibling sim types/content plus type-only IWorld
// view shapes (the sanctioned world_api type edge), so it runs unchanged in
// Node, the browser, and the headless RL env (tests/architecture.test.ts).

import type {
  DungeonFinderBoard,
  DungeonFinderInfo,
  DungeonFinderListingView,
  DungeonFinderProposalView,
} from '../../world_api/dungeon_finder';
import {
  FINDER_ACTIVITIES,
  FINDER_PRE_SPEC_ROLES,
  FINDER_ROLE_ORDER,
  type FinderActivity,
  type FinderComposition,
  type FinderListingTag,
  finderActivity,
} from '../content/dungeon_finder';
import { FIRST_TALENT_LEVEL, type Role } from '../content/talents';
import type { SimContext } from '../sim_context';
import type { PlayerClass } from '../types';

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

// ---------------------------------------------------------------------------
// Pure helpers (direct Vitest coverage in tests/dungeon_finder.test.ts).
// ---------------------------------------------------------------------------

// Roles a character may select: below the first talent level a fixed class
// capability table applies; from there on, exactly the active spec's role
// (no active spec = cannot use the finder).
export function compatibleFinderRoles(
  cls: PlayerClass,
  level: number,
  specRole: Role | null,
): Role[] {
  if (level >= FIRST_TALENT_LEVEL) return specRole ? [specRole] : [];
  return FINDER_ROLE_ORDER.filter((role) => FINDER_PRE_SPEC_ROLES[role].includes(cls));
}

export function finderLevelEligible(activity: FinderActivity, level: number): boolean {
  return level >= activity.minLevel && level <= activity.maxLevel;
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
}

interface FinderApplication {
  pid: number;
  listingId: number;
  roles: Role[]; // compatible selected roles captured at apply time
  at: number;
}

// ---------------------------------------------------------------------------
// The machine.
// ---------------------------------------------------------------------------

export class DungeonFinderMachine {
  // Sticky per-player role selection (validated on write and on every use).
  private readonly roleSelections = new Map<number, Role[]>();
  // FIFO queue of indivisible units (solo players / whole premade parties).
  private queue: FinderQueueUnit[] = [];
  private readonly proposals: FinderProposal[] = [];
  private readonly cooldownUntil = new Map<number, number>();
  private listings: FinderListing[] = [];
  private readonly applications = new Map<number, FinderApplication>();
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
    return this.listings.find((l) => l.leaderPid === leaderPid) ?? null;
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
    if (r.e.level >= FIRST_TALENT_LEVEL && eligible.length === 0) {
      this.ctx.error(id, 'Choose a specialization to use the Dungeon Finder.');
      return;
    }
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
      const r = this.ctx.resolve(leaderPid);
      const eligible = r
        ? compatibleFinderRoles(r.meta.cls, r.e.level, r.meta.talentMods.role)
        : [];
      this.ctx.error(
        leaderPid,
        eligible.length === 0
          ? 'Choose a specialization to use the Dungeon Finder.'
          : 'Select a Dungeon Finder role first.',
      );
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
      this.applications.delete(memberPid);
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
    const activity = finderActivity(activityId);
    if (!activity) {
      this.ctx.error(id, 'That listing is no longer available.');
      return;
    }
    if (this.listingBy(id)) {
      this.ctx.error(id, 'You already lead a group listing.');
      return;
    }
    const party = this.ctx.partyOf(id);
    if (party && party.leader !== id) {
      this.ctx.error(id, 'Only the party leader may use the Dungeon Finder.');
      return;
    }
    const members = party ? [...party.members] : [id];
    if (members.length >= activity.size) {
      this.ctx.error(id, 'Your group is too large for that activity.');
      return;
    }
    for (const memberPid of members) {
      if (!finderLevelEligible(activity, this.levelOf(memberPid))) {
        this.memberBlocksError(id, memberPid);
        return;
      }
    }
    const seen = new Set<FinderListingTag>();
    const cleanedTags = tags.filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
    this.listings.push({
      id: this.nextListingId++,
      activityId,
      leaderPid: id,
      tags: cleanedTags,
      createdAt: this.ctx.time,
    });
    this.bumpBoard();
    this.ctx.notice(id, 'Your group listing is published.');
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
    this.listings = this.listings.filter((l) => l.id !== listing.id);
    for (const [pid, app] of this.applications) {
      if (app.listingId !== listing.id) continue;
      this.applications.delete(pid);
      if (this.ctx.players.has(pid))
        this.ctx.notice(pid, 'The group listing you applied to has closed.');
    }
    if (opts.notifyLeader && this.ctx.players.has(listing.leaderPid))
      this.ctx.notice(listing.leaderPid, 'Your group listing is now closed.');
    this.bumpBoard();
  }

  dungeonFinderApply(listingId: number, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    if (this.applications.has(id)) {
      this.ctx.error(id, 'You already have a pending application.');
      return;
    }
    const listing = this.listings.find((l) => l.id === listingId) ?? null;
    if (!listing || listing.leaderPid === id) {
      this.ctx.error(id, 'That listing is no longer available.');
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
    if (activity.composition !== null) {
      roles = this.allowedRoles(id);
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
    this.applications.set(id, {
      pid: id,
      listingId: listing.id,
      roles,
      at: this.nextApplicationSeq++,
    });
    this.bumpBoard();
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
      .map((memberPid) => ({ pid: memberPid, roles: this.allowedRoles(memberPid) }))
      .filter((m) => m.roles.length > 0);
    seated.push({ pid: applicantPid, roles: applicantRoles });
    const match = matchFinderRoles(seated, comp);
    return match.assigned.has(applicantPid);
  }

  dungeonFinderApplyCancel(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    if (!this.applications.has(id)) {
      this.ctx.error(id, 'You have no pending application.');
      return;
    }
    this.applications.delete(id);
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
    const app = this.applications.get(applicantPid);
    if (!app || app.listingId !== listing.id) {
      this.ctx.error(id, 'That player is no longer available.');
      return;
    }
    this.applications.delete(applicantPid);
    this.bumpBoard();
    if (!accept) {
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
    if (!finderLevelEligible(activity, applicant.e.level)) {
      this.ctx.error(id, 'That player is no longer available.');
      return;
    }
    if (
      activity.composition !== null &&
      !this.applicantFits(listing, activity, applicantPid, this.allowedRoles(applicantPid))
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
    const leaderUnit = {
      partyId: party?.id ?? null,
      leaderPid: id,
      members: party ? [...party.members] : [id],
    };
    const formed = this.ctx.formDungeonFinderGroup(
      [leaderUnit, { partyId: null, leaderPid: applicantPid, members: [applicantPid] }],
      { raid: activity.kind === 'raid' },
    );
    if (!formed) {
      this.ctx.error(id, 'That player is no longer available.');
      return;
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
    this.roleSelections.delete(pid);
    this.cooldownUntil.delete(pid);
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
    if (this.applications.delete(pid)) this.bumpBoard();
  }

  // ---- per-tick update (end-of-tick system block) ------------------------------

  update(): void {
    if (this.ctx.tickCount % 20 === 0) this.sweep();
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
    for (const [pid, app] of [...this.applications]) {
      const listing = this.listings.find((l) => l.id === app.listingId) ?? null;
      if (!listing) {
        // closeListing already notified; entry only lingers if the player
        // vanished mid-close.
        this.applications.delete(pid);
        continue;
      }
      const activity = finderActivity(listing.activityId);
      const alive = this.ctx.players.has(pid) && this.ctx.entities.has(pid);
      const eligible =
        alive &&
        activity !== null &&
        this.ctx.partyOf(pid) === null &&
        finderLevelEligible(activity, this.levelOf(pid)) &&
        (activity.composition === null || this.allowedRoles(pid).length > 0);
      if (!eligible) {
        this.applications.delete(pid);
        this.bumpBoard();
        if (alive) this.ctx.notice(pid, 'You withdraw your application.');
      }
    }
  }

  private listingValid(listing: FinderListing): boolean {
    const activity = finderActivity(listing.activityId);
    if (!activity) return false;
    if (!this.ctx.players.has(listing.leaderPid)) return false;
    const party = this.ctx.partyOf(listing.leaderPid);
    if (party && party.leader !== listing.leaderPid) return false;
    const members = this.listingMembers(listing);
    if (members.length >= activity.size) return false;
    for (const memberPid of members) {
      if (!finderLevelEligible(activity, this.levelOf(memberPid))) return false;
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
    const app = this.applications.get(pid) ?? null;
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
            applicants: [...this.applications.values()]
              .filter((a) => a.listingId === listing.id)
              .sort((a, b) => a.at - b.at)
              .map((a) => {
                const applicant = this.ctx.players.get(a.pid);
                return {
                  pid: a.pid,
                  name: applicant?.name ?? '',
                  cls: applicant?.cls ?? 'warrior',
                  level: this.levelOf(a.pid),
                  roles: [...a.roles],
                };
              }),
          }
        : null,
      myApplication: app ? { listingId: app.listingId } : null,
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
      if (!activity) continue;
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
    if (activity.composition !== null) {
      const seatable: FinderRoleMember[] = members
        .map((pid) => ({ pid, roles: this.allowedRoles(pid) }))
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
      tags: [...listing.tags],
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
