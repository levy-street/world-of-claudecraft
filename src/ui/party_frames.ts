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

/**
 * The cheap per-frame rebuild signature for the party frames, computed in a SINGLE
 * pass over `info.members` with NO intermediate array allocation, so an unchanged
 * party short-circuits BEFORE `selectPartyFrameMembers` (which allocates the sorted /
 * filtered / mapped arrays) is ever called. It encodes exactly the inputs the frames
 * render from: per member the pid, group, hp/maxHp, resource, dead,
 * in-combat, the out-of-range flag (computed inline, identically to the selector),
 * level, and the aura strip (id + kind + sap flag per aura, in order), plus the
 * leader, raid flag, and the player's own group. The player is skipped (the
 * frames never show the local player), matching the selector's `pid !== playerId`.
 *
 * Pure and deterministic (only `Math.hypot` and string building). It iterates in raw
 * member order rather than the selector's sorted order; the server's party member
 * order is stable frame to frame, so a reorder only accompanies a membership change,
 * which flips the signature and rebuilds regardless. Any selector-relevant change
 * (a field, a join/leave, an out-of-range flip) changes this string, and nothing the
 * selector depends on is omitted, so an equal signature means an identical render.
 */
export function partyFrameSignature(
  info: PartyInfo,
  playerId: number,
  playerPos: { x: number; z: number },
  rangeYd = PARTY_FRAME_RANGE_YD,
): string {
  let sig = '';
  let myGroup: 1 | 2 = 1;
  for (const m of info.members) {
    if (m.pid === playerId) {
      myGroup = m.group;
      continue;
    }
    const oor = !m.dead && Math.hypot(m.x - playerPos.x, m.z - playerPos.z) > rangeYd;
    sig += `${m.pid}:${m.group}:${m.hp}/${m.mhp}:${m.res}:${m.dead}:${m.inCombat}:${oor ? 1 : 0}:${m.level}:`;
    // The aura strip, appended inline (no intermediate array): a joined/left aura,
    // a kind flip, or a sap-sign flip changes the string and repaints the row.
    if (m.auras) {
      for (const a of m.auras) sig += `${a.id},${a.kind},${a.neg ? 1 : 0};`;
    }
    sig += '|';
  }
  return `${sig}L${info.leader}:R${info.raid ? 1 : 0}:G${myGroup}`;
}
