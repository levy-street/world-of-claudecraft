import { describe, expect, it } from 'vitest';
import { selectPartyFrameMembers } from '../src/ui/party_frames';
import type { PartyInfo, PartyMemberInfo } from '../src/world_api';

const member = (pid: number, group: 1 | 2, x = 0, z = 0): PartyMemberInfo => ({
  pid,
  name: `Raid${pid}`,
  cls: 'priest',
  level: 20,
  hp: 100,
  mhp: 100,
  res: 100,
  mres: 100,
  rtype: 'mana',
  x,
  z,
  dead: 0,
  inCombat: 0,
  group,
});

describe('party frame member selection', () => {
  it('shows every other raid member across raid groups', () => {
    const info: PartyInfo = {
      leader: 1,
      raid: true,
      members: [
        member(1, 1),
        member(2, 1),
        member(3, 1),
        member(4, 1),
        member(5, 1),
        member(6, 2),
        member(7, 2),
        member(8, 2),
        member(9, 2),
        member(10, 2),
      ],
    };

    const frames = selectPartyFrameMembers(info, 1, { x: 0, z: 0 });

    expect(frames.map((m) => m.pid)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(frames.filter((m) => m.group === 2)).toHaveLength(5);
  });

  it('matches the raid social tab ordering when raid groups are interleaved', () => {
    const info: PartyInfo = {
      leader: 1,
      raid: true,
      members: [member(1, 1), member(6, 2), member(2, 1), member(7, 2), member(3, 1), member(4, 1)],
    };

    const frames = selectPartyFrameMembers(info, 1, { x: 0, z: 0 });

    expect(frames.map((m) => m.pid)).toEqual([2, 3, 4, 6, 7]);
  });

  it('marks live out-of-range members without hiding them', () => {
    const info: PartyInfo = {
      leader: 1,
      raid: true,
      members: [member(1, 1), member(2, 2, 150, 0)],
    };

    expect(selectPartyFrameMembers(info, 1, { x: 0, z: 0 })[0]).toMatchObject({
      pid: 2,
      oor: true,
    });
  });
});
