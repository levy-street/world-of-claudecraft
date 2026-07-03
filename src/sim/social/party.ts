// Party / raid state machine (session A1), MOVED out of the 17.5k-line Sim class
// behind SimContext. This is a MOVE, not a rewrite: every method body below is the
// verbatim body from sim.ts, with the only change being that the shared-Sim
// references (resolve / error / players / emit / time, the trade+duel invite maps,
// and the raid-marker drop) now route through `this.ctx`. Statement order, branches,
// iteration order, and in-place mutation are preserved exactly; the slice draws no
// rng, so the parity draw-order log must stay byte-identical.
//
// The machine OWNS its four state maps (parties / partyByPid / partyInvites /
// nextPartyId), which moved off Sim with the logic. `partyOf` and the eight command
// methods stay reachable on Sim through thin delegates (IWorld + the many foreign
// `this.partyOf` call sites), and `removeFromParty` stays reachable by Sim's
// `removePlayer` teardown through the SimContext seam.
//
// src/sim-pure: imports only sibling sim types + a content constant (no DOM/Three/
// render/ui/game/net, no Math.random/Date.now), so it runs unchanged in Node, the
// browser, and the headless RL env (enforced by tests/architecture.test.ts).

import { effectiveMasterLooter } from '../loot_master';
import type { Party } from '../sim';
import type { SimContext } from '../sim_context';
import { DEFAULT_PARTY_LOOT_STRATEGIES } from '../types';

// Group caps (classic 5-player party, 10-player raid as 2 subgroups of 5). Moved
// from sim.ts with the only code that reads them; do NOT inline new numbers.
const PARTY_MAX = 5;
const RAID_MIN = 5;
const RAID_MAX = 10;
const RAID_GROUP_MAX = 5;

export class PartyMachine {
  // The party machine's private state (moved off Sim). Public so Sim's teardown and
  // the dead-party-loot white-box test can reach them as they did on Sim.
  parties = new Map<number, Party>();
  partyByPid = new Map<number, number>(); // pid -> party id
  partyInvites = new Map<number, { fromPid: number; expires: number }>(); // invitee pid -> invite
  nextPartyId = 1;

  constructor(private readonly ctx: SimContext) {}

  partyOf(pid: number): Party | null {
    const partyId = this.partyByPid.get(pid);
    return partyId !== undefined ? (this.parties.get(partyId) ?? null) : null;
  }

  // English Loot Settings summary line for a party (re-localized client-side). Sent
  // to a joiner (private) and to the whole group on party/raid conversion. A single
  // ternary return (rather than an early-return branch) keeps this recognized by the
  // localizeSystemText summaryMaster/summaryGroup arms without a second, spurious
  // literal-return candidate for the S3 drift guard's static scan.
  private lootSettingsSummary(party: Party): string {
    const m = party.lootStrategies.master;
    const looterPid = m.looter === 0 ? party.leader : m.looter;
    const looterName = this.ctx.players.get(looterPid)?.name ?? 'the leader';
    return m.enabled
      ? `Loot Settings: Master Loot, Master Looter ${looterName}, threshold ${m.threshold}.`
      : 'Loot Settings: Group Loot.';
  }

  // Announce a shifted effective master looter to the whole group. `before` is the
  // effective looter captured before a leadership change; call after the change.
  private announceLooterShift(party: Party, before: number | null): void {
    if (party.members.length <= 1) return;
    if (!party.lootStrategies.master.enabled) return;
    const after = effectiveMasterLooter(party.lootStrategies.master, party.leader, party.members);
    if (after === null || after === before) return;
    const name = this.ctx.players.get(after)?.name ?? 'the leader';
    for (const mPid of party.members)
      this.ctx.emit({
        type: 'log',
        text: `Master Looter is now ${name}.`,
        color: '#aaf',
        pid: mPid,
      });
  }

  private hasActiveInvite(
    map: Map<number, { fromPid: number; expires: number }>,
    targetPid: number,
  ): boolean {
    const invite = map.get(targetPid);
    if (!invite) return false;
    if (invite.expires < this.ctx.time) {
      map.delete(targetPid);
      return false;
    }
    return true;
  }

  hasPendingSocialInvite(targetPid: number): boolean {
    return (
      this.hasActiveInvite(this.partyInvites, targetPid) ||
      this.hasActiveInvite(this.ctx.tradeInvites, targetPid) ||
      this.hasActiveInvite(this.ctx.duelInvites, targetPid)
    );
  }

  partyCapacity(party: Party | null): number {
    return party?.raid ? RAID_MAX : PARTY_MAX;
  }

  partyInvite(targetPid: number, pid?: number): void {
    const r = this.ctx.resolve(pid);
    const target = this.ctx.players.get(targetPid);
    if (!r || !target) return;
    if (targetPid === r.meta.entityId) return;
    const myParty = this.partyOf(r.meta.entityId);
    if (myParty && myParty.leader !== r.meta.entityId) {
      this.ctx.error(r.meta.entityId, 'Only the party leader may invite.');
      return;
    }
    if (myParty && myParty.members.length >= this.partyCapacity(myParty)) {
      this.ctx.error(r.meta.entityId, myParty.raid ? 'Your raid is full.' : 'Your party is full.');
      return;
    }
    if (this.partyOf(targetPid)) {
      this.ctx.error(r.meta.entityId, `${target.name} is already in a party.`);
      return;
    }
    if (this.hasPendingSocialInvite(targetPid)) {
      this.ctx.error(r.meta.entityId, `${target.name} already has a pending invitation.`);
      return;
    }
    this.partyInvites.set(targetPid, { fromPid: r.meta.entityId, expires: this.ctx.time + 30 });
    this.ctx.emit({
      type: 'partyInvite',
      fromPid: r.meta.entityId,
      fromName: r.meta.name,
      pid: targetPid,
    });
    this.ctx.emit({
      type: 'log',
      text: `You have invited ${target.name} to your party.`,
      color: '#aaf',
      pid: r.meta.entityId,
    });
  }

  partyAccept(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const invite = this.partyInvites.get(r.meta.entityId);
    if (!invite || invite.expires < this.ctx.time) {
      this.ctx.error(r.meta.entityId, 'The invitation has expired.');
      return;
    }
    this.partyInvites.delete(r.meta.entityId);
    // A player can hold a stale incoming invite while having since joined or
    // formed a party of their own (inviting others never consumes one's own
    // pending invite). Accepting now would add them to a second party's member
    // list, corrupting the "at most one party" invariant.
    if (this.partyOf(r.meta.entityId)) {
      this.ctx.error(r.meta.entityId, 'You are already in a party.');
      return;
    }
    const leaderMeta = this.ctx.players.get(invite.fromPid);
    if (!leaderMeta) return;
    let party = this.partyOf(invite.fromPid);
    if (!party) {
      party = {
        id: this.nextPartyId++,
        leader: invite.fromPid,
        members: [invite.fromPid],
        raid: false,
        raidGroups: new Map([[invite.fromPid, 1]]),
        lootStrategies: { ...DEFAULT_PARTY_LOOT_STRATEGIES },
        lootTurn: 0,
      };
      this.parties.set(party.id, party);
      this.partyByPid.set(invite.fromPid, party.id);
    }
    if (party.members.length >= this.partyCapacity(party)) {
      this.ctx.error(r.meta.entityId, party.raid ? 'That raid is full.' : 'That party is full.');
      return;
    }
    const raidGroup = this.nextRaidGroupFor(party);
    party.members.push(r.meta.entityId);
    party.raidGroups.set(r.meta.entityId, raidGroup);
    this.partyByPid.set(r.meta.entityId, party.id);
    for (const mPid of party.members) {
      this.ctx.emit({
        type: 'log',
        text: `${r.meta.name} joins the party.`,
        color: '#aaf',
        pid: mPid,
      });
    }
    this.ctx.emit({
      type: 'log',
      text: this.lootSettingsSummary(party),
      color: '#aaf',
      pid: r.meta.entityId,
    });
  }

  partyDecline(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const invite = this.partyInvites.get(r.meta.entityId);
    this.partyInvites.delete(r.meta.entityId);
    if (invite) {
      this.ctx.emit({
        type: 'log',
        text: `${r.meta.name} declines your invitation.`,
        color: '#aaf',
        pid: invite.fromPid,
      });
    }
  }

  partyLeave(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    this.removeFromParty(r.meta.entityId, 'leaves the party');
  }

  partyKick(targetPid: number, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const party = this.partyOf(r.meta.entityId);
    if (!party || party.leader !== r.meta.entityId) {
      this.ctx.error(r.meta.entityId, 'You are not the party leader.');
      return;
    }
    if (!party.members.includes(targetPid) || targetPid === r.meta.entityId) return;
    this.removeFromParty(targetPid, 'has been removed from the party');
  }

  // Leader-only handoff: pass leadership to another member without changing the
  // roster. Master loot pinned to the leader (looter 0) and the leader-only HUD
  // controls track `party.leader`, so they follow the new leader automatically.
  partyPromote(targetPid: number, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const party = this.partyOf(r.meta.entityId);
    if (!party || party.leader !== r.meta.entityId) {
      this.ctx.error(r.meta.entityId, 'You are not the party leader.');
      return;
    }
    if (!party.members.includes(targetPid) || targetPid === party.leader) return;
    const beforeLooter = effectiveMasterLooter(
      party.lootStrategies.master,
      party.leader,
      party.members,
    );
    party.leader = targetPid;
    const newLeader = this.ctx.players.get(targetPid);
    for (const mPid of party.members) {
      this.ctx.emit({
        type: 'log',
        text: `${newLeader?.name ?? 'Someone'} is now the party leader.`,
        color: '#aaf',
        pid: mPid,
      });
    }
    this.announceLooterShift(party, beforeLooter);
  }

  convertPartyToRaid(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const party = this.partyOf(r.meta.entityId);
    if (!party) {
      this.ctx.error(r.meta.entityId, 'You need a full party of five before converting to raid.');
      return;
    }
    if (party.leader !== r.meta.entityId) {
      this.ctx.error(r.meta.entityId, 'Only the party leader may convert to raid.');
      return;
    }
    if (party.raid) {
      this.ctx.error(r.meta.entityId, 'Your group is already a raid.');
      return;
    }
    if (party.members.length < RAID_MIN) {
      this.ctx.error(r.meta.entityId, 'You need a full party of five before converting to raid.');
      return;
    }
    party.raid = true;
    this.normalizeRaidGroups(party);
    for (const mPid of party.members) {
      this.ctx.emit({
        type: 'log',
        text: 'Your party has converted to a raid group.',
        color: '#aaf',
        pid: mPid,
      });
    }
    for (const mPid of party.members)
      this.ctx.emit({
        type: 'log',
        text: this.lootSettingsSummary(party),
        color: '#aaf',
        pid: mPid,
      });
  }

  convertRaidToParty(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const party = this.partyOf(r.meta.entityId);
    if (!party) {
      this.ctx.error(r.meta.entityId, 'You are not in a raid group.');
      return;
    }
    if (party.leader !== r.meta.entityId) {
      this.ctx.error(r.meta.entityId, 'Only the raid leader may convert to a party.');
      return;
    }
    if (!party.raid) {
      this.ctx.error(r.meta.entityId, 'Your group is not a raid.');
      return;
    }
    // A raid can hold up to two subgroups; only one party's worth can fold back.
    if (party.members.length > PARTY_MAX) {
      this.ctx.error(
        r.meta.entityId,
        'A raid with more than five members cannot convert back to a party.',
      );
      return;
    }
    party.raid = false;
    party.raidGroups.clear();
    for (const mPid of party.members) {
      this.ctx.emit({
        type: 'log',
        text: 'Your raid has converted back to a party.',
        color: '#aaf',
        pid: mPid,
      });
    }
    for (const mPid of party.members)
      this.ctx.emit({
        type: 'log',
        text: this.lootSettingsSummary(party),
        color: '#aaf',
        pid: mPid,
      });
  }

  moveRaidMember(targetPid: number, group: 1 | 2, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const party = this.partyOf(r.meta.entityId);
    if (!party?.raid) {
      this.ctx.error(r.meta.entityId, 'You are not in a raid group.');
      return;
    }
    if (party.leader !== r.meta.entityId) {
      this.ctx.error(r.meta.entityId, 'Only the raid leader may adjust groups.');
      return;
    }
    if (!party.members.includes(targetPid)) return;
    const current = party.raidGroups.get(targetPid) ?? 1;
    if (current === group) return;
    const inTargetGroup = party.members.filter(
      (mPid) => (party.raidGroups.get(mPid) ?? 1) === group,
    ).length;
    if (inTargetGroup >= RAID_GROUP_MAX) {
      this.ctx.error(r.meta.entityId, `Raid group ${group} is full.`);
      return;
    }
    party.raidGroups.set(targetPid, group);
    const moved = this.ctx.players.get(targetPid)?.name ?? 'Someone';
    for (const mPid of party.members) {
      this.ctx.emit({
        type: 'log',
        text: `${moved} has been moved to raid group ${group}.`,
        color: '#aaf',
        pid: mPid,
      });
    }
  }

  private nextRaidGroupFor(party: Party): 1 | 2 {
    const g1 = party.members.filter((mPid) => (party.raidGroups.get(mPid) ?? 1) === 1).length;
    return g1 < RAID_GROUP_MAX ? 1 : 2;
  }

  private normalizeRaidGroups(party: Party): void {
    party.raidGroups.clear();
    for (let i = 0; i < party.members.length; i++) {
      party.raidGroups.set(party.members[i], i < RAID_GROUP_MAX ? 1 : 2);
    }
  }

  removeFromParty(pid: number, verb: string): void {
    const party = this.partyOf(pid);
    if (!party) return;
    const beforeLooter = effectiveMasterLooter(
      party.lootStrategies.master,
      party.leader,
      party.members,
    );
    const meta = this.ctx.players.get(pid);
    party.members = party.members.filter((m) => m !== pid);
    party.raidGroups.delete(pid);
    this.partyByPid.delete(pid);
    for (const mPid of [...party.members, pid]) {
      this.ctx.emit({
        type: 'log',
        text: `${meta?.name ?? 'Someone'} ${verb}.`,
        color: '#aaf',
        pid: mPid,
      });
    }
    if (party.members.length <= 1) {
      for (const mPid of party.members) {
        this.partyByPid.delete(mPid);
        this.ctx.emit({ type: 'log', text: 'Your party has disbanded.', color: '#aaf', pid: mPid });
      }
      this.parties.delete(party.id);
      this.ctx.dropPartyMarkers(party.id);
    } else if (party.leader === pid) {
      party.leader = party.members[0];
      const newLeader = this.ctx.players.get(party.leader);
      for (const mPid of party.members) {
        this.ctx.emit({
          type: 'log',
          text: `${newLeader?.name ?? 'Someone'} is now the party leader.`,
          color: '#aaf',
          pid: mPid,
        });
      }
    }
    this.announceLooterShift(party, beforeLooter);
    if (party.raid) this.normalizeRaidGroups(party);
  }
}
