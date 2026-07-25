import {
  type PreparedPartyFrameAura,
  partyFrameAurasForViewer,
  preparePartyFrameAuras,
} from '../src/sim/party_frame_info';
import type { Aura } from '../src/sim/types';
import type { PartyInfo, PartyMemberInfo } from '../src/world_api';

export interface PartyFrameProjectionParty {
  id: number;
  leader: number;
  raid: boolean;
  master: PartyInfo['master'];
  members: readonly number[];
}

export interface PartyFrameMemberProjection {
  member: Omit<PartyMemberInfo, 'auras'>;
  auras: readonly Aura[];
}

export type ProjectPartyFrameMember = (pid: number) => PartyFrameMemberProjection | null;

interface CachedPartyFrameMember {
  member: Omit<PartyMemberInfo, 'auras'>;
  auras: PreparedPartyFrameAura[];
}

interface CachedPartyFrameProjection {
  leader: number;
  raid: boolean;
  master: PartyInfo['master'];
  members: CachedPartyFrameMember[];
}

/**
 * Shares viewer-independent party member projection work across every recipient
 * in one broadcast. Temporal Echo visibility remains viewer-specific.
 */
export class PartyFrameProjectionCache {
  private readonly parties = new Map<number, CachedPartyFrameProjection>();

  beginBroadcast(): void {
    this.parties.clear();
  }

  forViewer(
    party: PartyFrameProjectionParty,
    viewerId: number,
    projectMember: ProjectPartyFrameMember,
  ): PartyInfo {
    let projection = this.parties.get(party.id);
    if (!projection) {
      projection = this.projectParty(party, projectMember);
      this.parties.set(party.id, projection);
    }

    return {
      leader: projection.leader,
      raid: projection.raid,
      master: { ...projection.master },
      members: projection.members.map(({ member, auras }) => ({
        ...member,
        // Prepared summaries are immutable for the lifetime of this broadcast.
        // Only the per-viewer array is new; rows are safe to share through stringify.
        auras: partyFrameAurasForViewer(auras, viewerId),
      })),
    };
  }

  private projectParty(
    party: PartyFrameProjectionParty,
    projectMember: ProjectPartyFrameMember,
  ): CachedPartyFrameProjection {
    const members: CachedPartyFrameMember[] = [];
    for (const pid of party.members) {
      const projection = projectMember(pid);
      if (!projection) continue;
      members.push({
        member: projection.member,
        auras: preparePartyFrameAuras(projection.auras),
      });
    }
    return {
      leader: party.leader,
      raid: party.raid,
      master: { ...party.master },
      members,
    };
  }
}
