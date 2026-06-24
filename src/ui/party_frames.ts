import type { PartyInfo, PartyMemberInfo } from '../world_api';

export const PARTY_FRAME_RANGE_YD = 100;

export type PartyFrameMember = PartyMemberInfo & { oor: boolean };

export function selectPartyFrameMembers(
  info: PartyInfo,
  playerId: number,
  playerPos: { x: number; z: number },
  rangeYd = PARTY_FRAME_RANGE_YD,
): PartyFrameMember[] {
  return info.members
    .map((member, index) => ({ member, index }))
    .sort((a, b) =>
      info.raid ? a.member.group - b.member.group || a.index - b.index : a.index - b.index,
    )
    .map(({ member }) => member)
    .filter((m) => m.pid !== playerId)
    .map((m) => ({
      ...m,
      oor: !m.dead && Math.hypot(m.x - playerPos.x, m.z - playerPos.z) > rangeYd,
    }));
}
