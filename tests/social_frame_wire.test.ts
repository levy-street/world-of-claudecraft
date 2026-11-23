import { describe, expect, it, vi } from 'vitest';
import { applySocialPositions, socialInfoFromFrame } from '../src/net/social_frame_wire';
import { Sim } from '../src/sim/sim';
import { friendRows } from '../src/ui/social_view';
import { bareClient } from './helpers/bare_client';

const friend = {
  id: 3,
  name: 'Companion',
  cls: 'warrior',
  level: 1,
  realm: 'home',
  activeTitle: 'existing',
  online: false,
  tier: 'bound' as const,
};

describe('account friend frame paging', () => {
  it('retains a continuation on an empty visible page and ignores malformed cursors', () => {
    const frame = socialInfoFromFrame({ friends: [], friendsCursor: 1, friendsNextCursor: 4 });
    expect(frame.friends).toEqual([]);
    expect(frame.friendsCursor).toBe(1);
    expect(frame.friendsNextCursor).toBe(4);
    expect(
      socialInfoFromFrame({ friendsCursor: -1, friendsNextCursor: '4' }).friendsNextCursor,
    ).toBeUndefined();
  });

  it('updates known positions, keeps titles from older frames and never adds off-page friends', () => {
    const frame = socialInfoFromFrame({ friends: [{ ...friend }] });
    applySocialPositions(frame, [
      { id: 3, x: 1, z: 2, zone: 'Town', status: 'online' },
      { id: 4, x: 4, z: 5, zone: 'Town', status: 'online' },
      { id: 3, x: Number.NaN, z: 0, zone: 'Bad', status: 'online' },
    ]);
    expect(frame.friends).toHaveLength(1);
    expect(frame.friends[0]).toMatchObject({ x: 1, z: 2, activeTitle: 'existing', online: true });
    applySocialPositions(frame, [{ id: 3, x: 1, z: 2, zone: 'Town', status: 'afk', title: null }]);
    expect(frame.friends[0].activeTitle).toBeNull();
  });

  it('retains bound friend tier in the UI view', () => {
    expect(friendRows(socialInfoFromFrame({ friends: [friend] }))[0].tier).toBe('bound');
  });
});

describe('account block page mirror', () => {
  it('keeps block continuation independent of friends, including an empty realm page', () => {
    const frame = socialInfoFromFrame({
      friendsCursor: 2,
      friendsNextCursor: 3,
      blocks: [],
      blocksCursor: 4,
      blocksNextCursor: 5,
      blocksUnavailable: true,
    });
    expect(frame).toMatchObject({
      friendsCursor: 2,
      friendsNextCursor: 3,
      blocks: [],
      blocksCursor: 4,
      blocksNextCursor: 5,
      blocksUnavailable: true,
    });
  });
  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '5', null])(
    'rejects malformed block metadata %s',
    (cursor) => {
      const frame = socialInfoFromFrame({
        blocksCursor: cursor,
        blocksNextCursor: cursor,
        blocksUnavailable: 'true',
      });
      expect(frame.blocksCursor).toBeUndefined();
      expect(frame.blocksNextCursor).toBeUndefined();
      expect(frame.blocksUnavailable).toBeUndefined();
    },
  );
  it('sends only the selected block cursor and leaves authoritative pages unchanged', () => {
    const state = socialInfoFromFrame({ friendsCursor: 2, blocksCursor: 3 });
    const world = bareClient(5, { socialInfo: state });
    const send = vi.fn();
    (world as unknown as { cmd: typeof send }).cmd = send;
    world.socialBlocksPage(4);
    expect(send).toHaveBeenCalledWith({ cmd: 'social_refresh', afterBlockCursor: 4 });
    expect(world.socialInfo).toBe(state);
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    sim.socialBlocksPage(4);
    expect(sim.socialInfo).toBeNull();
  });
});
