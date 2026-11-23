import { describe, expect, it, vi } from 'vitest';
import {
  AccountSocialHost,
  type AccountSocialSession,
  sendAccountSocialSnapshot,
} from '../server/account_social_host';
import type { SocialSnapshot } from '../server/social';
import { canShowInWho } from '../server/who_roster';

function session(accountId: number, characterId: number): AccountSocialSession {
  return {
    accountId,
    characterId,
    pid: characterId,
    left: false,
    blockedIds: new Set(),
    blockedAccountIds: new Set(),
    blockListLoaded: false,
    guildStampSeq: 0,
    socialTrackedIds: [],
  };
}
const emptySnapshot: SocialSnapshot = {
  friends: [],
  blocks: [],
  ignores: [],
  guild: null,
  myPledge: null,
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('account social host', () => {
  it('bills only the synchronous cache installation after its database wait', async () => {
    const observe = vi.fn();
    const host = new AccountSocialHost<AccountSocialSession>(observe);
    const live = session(1, 10);
    host.add(live);
    const waiting = deferred<{ characters: number[]; accounts: number[] }>();
    const hydration = host.refreshBlocks(live, () => waiting.promise);
    expect(observe).not.toHaveBeenCalled();
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(103);
    try {
      waiting.resolve({ characters: [], accounts: [2, 3] });
      await hydration;
      expect(observe).toHaveBeenCalledExactlyOnceWith(3);
      expect(live.blockedAccountIds).toEqual(new Set([2, 3]));
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps an oversized inherited block cache fail-closed while leaving paging available', async () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    const live = session(1, 10);
    host.add(live);
    await host.refreshBlocks(live, async () => ({
      characters: [],
      accounts: Array.from({ length: 4097 }, (_, i) => i + 2),
    }));
    expect(live.blockListLoaded).toBe(false);
    expect(live.blockedAccountIds.size).toBe(0);
    expect(host.isBlocking(live, session(99999, 20))).toBe(true);
    expect(
      await host.friendSnapshot(live, async () => ({ ...emptySnapshot, blocksNextCursor: 42 })),
    ).toMatchObject({ blocksUnavailable: true, blocksNextCursor: 1 });
    expect(host.selectBlockPage(live, 1)).toBe(true);
    await host.refreshBlocks(live, async () => ({
      characters: [],
      accounts: Array.from({ length: 4096 }, (_, i) => i + 2),
    }));
    expect(live.blockListLoaded).toBe(true);
    expect(live.blockListOverflow).toBe(false);
  });

  it.each([52, 5000])('hydrates %s accounts in bounded reconnect cohorts', async (count) => {
    const host = new AccountSocialHost<AccountSocialSession>();
    for (let i = 1; i <= count; i++) host.add(session(i, i + 100));
    const batch = vi.fn(
      async (ids: readonly number[]) => new Map(ids.map((id) => [id, [1000 + id]])),
    );
    const single = vi.fn(async () => []);
    await host.resyncBlocks({
      blockedIds: single,
      blockedAccountIds: single,
      blockedAccountIdsForAccounts: batch,
    });
    expect(batch).toHaveBeenCalledTimes(Math.ceil(count / 25));
    expect(batch.mock.calls.every(([ids]) => ids.length <= 25)).toBe(true);
    expect(single).not.toHaveBeenCalled();
    expect(host.online(52)?.blockedAccountIds.has(1052)).toBe(true);
  });

  it('fences reconnect batch results after notification loss or a newer account refresh', async () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    const live = session(1, 10);
    host.add(live);
    const pending = deferred<Map<number, number[]>>();
    const work = host.resyncBlocks({
      blockedIds: async () => [],
      blockedAccountIds: async () => [],
      blockedAccountIdsForAccounts: async () => pending.promise,
    });
    await host.refreshBlocks(live, async () => ({ characters: [], accounts: [9] }));
    pending.resolve(new Map([[1, [2]]]));
    await work;
    expect([...live.blockedAccountIds]).toEqual([9]);
    const disconnected = deferred<Map<number, number[]>>();
    const retry = host.resyncBlocks({
      blockedIds: async () => [],
      blockedAccountIds: async () => [],
      blockedAccountIdsForAccounts: async () => disconnected.promise,
    });
    host.setBlockListenerReady(false);
    disconnected.resolve(new Map([[1, []]]));
    await retry;
    expect(live.blockListLoaded).toBe(false);
  });

  it('uses the replacement session loader when an account rejoins during an old read', async () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    const old = session(1, 10);
    host.add(old);
    const pending = deferred<{ characters: number[]; accounts: number[] }>();
    const first = host.refreshBlocks(old, () => pending.promise);
    host.remove(old);
    const replacement = session(1, 11);
    host.add(replacement);
    const fresh = vi.fn(async () => ({ characters: [], accounts: [2] }));
    const second = host.refreshBlocks(replacement, fresh);
    pending.resolve({ characters: [], accounts: [] });
    await Promise.all([first, second]);
    expect(fresh).toHaveBeenCalledOnce();
    expect(replacement.blockedAccountIds.has(2)).toBe(true);
  });

  it('invalidates in-flight privacy reads on listener loss and refreshes after reconnect', async () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    const live = session(1, 10);
    host.add(live);
    const pending = deferred<{ characters: number[]; accounts: number[] }>();
    const work = host.refreshBlocks(live, () => pending.promise);
    host.setBlockListenerReady(false);
    pending.resolve({ characters: [], accounts: [] });
    await work;
    expect(live.blockListLoaded).toBe(false);
    const alt = session(1, 11);
    host.add(alt);
    await host.refreshBlocks(alt, async () => ({ characters: [], accounts: [] }));
    expect(alt.blockListLoaded).toBe(false);
    host.setBlockListenerReady(true);
    await host.refreshBlocks(alt, async () => ({ characters: [], accounts: [2] }));
    expect(live.blockListLoaded).toBe(true);
    expect(live.blockedAccountIds.has(2)).toBe(true);
  });

  it('retries a stale friend page after page selection changes during the read', async () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    const live = session(1, 10);
    host.add(live);
    await host.friendSnapshot(live, async () => ({ ...emptySnapshot, friendsNextCursor: 99 }));
    host.selectFriendPage(live, 1);
    const pending = deferred<SocialSnapshot>();
    const read = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue(emptySnapshot);
    const work = host.friendSnapshot(live, read);
    host.selectFriendPage(live, 0);
    pending.resolve({ ...emptySnapshot, friendsNextCursor: 123 });
    expect((await work).friendsCursor).toBe(0);
    expect(read.mock.calls).toEqual([
      [99, 0],
      [0, 0],
    ]);
  });

  it('bounds page-race retries even when a client resets the page during every read', async () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    const live = session(1, 10);
    const read = vi.fn(async () => {
      host.selectFriendPage(live, 0);
      return emptySnapshot;
    });
    await expect(host.friendSnapshot(live, read)).rejects.toThrow('changed while reading');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('paginates the block display independently without narrowing the privacy cache', async () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    const live = session(1, 10),
      alt = session(1, 11);
    host.add(live);
    host.add(alt);
    await host.refreshBlocks(live, async () => ({ characters: [], accounts: [2, 999] }));
    expect(live.blockedAccountIds).toBe(alt.blockedAccountIds);
    const read = vi.fn(async (_friend: number, _block: number) => ({
      ...emptySnapshot,
      blocksNextCursor: 700,
    }));
    const first = await host.friendSnapshot(live, read);
    expect(first.blocksNextCursor).toBe(1);
    expect(host.selectBlockPage(live, 700)).toBe(false);
    expect(host.selectBlockPage(live, first.blocksNextCursor)).toBe(true);
    const next = await host.friendSnapshot(live, read);
    expect(next.blocksCursor).toBe(1);
    expect(read).toHaveBeenLastCalledWith(0, 700);
    expect(live.blockedAccountIds.has(999)).toBe(true);
    expect(host.selectBlockPage(live, 0)).toBe(true);
  });

  it('shares account blocks across alts and blocks a newly created sender without another DB read', async () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    const first = session(1, 10),
      alt = session(1, 11),
      sender = session(2, 20);
    host.add(first);
    host.add(alt);
    host.add(sender);
    const load = vi.fn(async () => ({ characters: [20], accounts: [2] }));
    await host.refreshBlocks(first, load);
    const newSender = session(2, 21);
    newSender.blockListLoaded = true;
    host.add(newSender);
    expect(host.isBlocking(alt, newSender)).toBe(true);
    expect(canShowInWho(alt, newSender)).toBe(false);
    expect(canShowInWho(newSender, alt)).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    host.remove(first);
    expect(host.online(1)).toBe(alt);
    host.remove(alt);
    expect(host.sessionsByAccountId.has(1)).toBe(false);
  });

  it('fails closed on a block read failure for every online alt', async () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    const first = session(1, 10),
      alt = session(1, 11);
    first.blockListLoaded = alt.blockListLoaded = true;
    host.add(first);
    host.add(alt);
    await expect(
      host.refreshBlocks(first, async () => {
        throw new Error('unavailable');
      }),
    ).rejects.toThrow('unavailable');
    expect(first.blockListLoaded).toBe(false);
    expect(alt.blockListLoaded).toBe(false);
  });

  it('keeps all alts fail-closed until the latest block read resolves', async () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    const live = session(1, 10),
      sender = session(2, 20);
    host.add(live);
    host.add(sender);
    const old = deferred<{ characters: number[]; accounts: number[] }>();
    const fresh = deferred<{ characters: number[]; accounts: number[] }>();
    const load = vi
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => fresh.promise);
    const first = host.refreshBlocks(live, load);
    const second = host.refreshBlocks(live, load);
    old.resolve({ characters: [], accounts: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    expect(live.blockListLoaded).toBe(false);
    expect(host.isBlocking(live, sender)).toBe(true);
    fresh.resolve({ characters: [20], accounts: [2] });
    await Promise.all([first, second]);
    expect(live.blockListLoaded).toBe(true);
    expect(host.isBlocking(live, sender)).toBe(true);
  });

  it('coalesces a burst into one running snapshot and one refresh while retaining first-join credit', async () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    const live = session(1, 10);
    host.add(live);
    const first = deferred<void>();
    const read = vi.fn(async (_initial: boolean) => {
      if (read.mock.calls.length === 1) await first.promise;
    });
    const requests = [host.snapshot(live, false, read)];
    for (let i = 0; i < 1000; i++) requests.push(host.snapshot(live, i === 999, read));
    expect(read).toHaveBeenCalledTimes(1);
    first.resolve();
    await Promise.all(requests);
    expect(read.mock.calls).toEqual([[false], [true]]);
    await host.snapshot(live, false, read);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('keeps private account cursors off the wire and accepts only the current continuation', async () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    const live = session(1, 10);
    host.add(live);
    const read = vi.fn(async (_cursor: number) => ({
      ...emptySnapshot,
      friendsCursor: 4567,
      friendsNextCursor: 9876,
    }));
    const first = await host.friendSnapshot(live, read);
    expect(first.friendsCursor).toBe(0);
    expect(first.friendsNextCursor).toBe(1);
    expect(JSON.stringify(first)).not.toContain('9876');
    expect(host.selectFriendPage(live, 9876)).toBe(false);
    expect(host.selectFriendPage(live, first.friendsNextCursor)).toBe(true);
    expect(host.selectFriendPage(live, first.friendsNextCursor)).toBe(false);
    const next = await host.friendSnapshot(live, read);
    expect(read.mock.calls).toEqual([
      [0, 0],
      [9876, 0],
    ]);
    expect(next.friendsCursor).toBe(1);
    expect(host.selectFriendPage(live, 0)).toBe(true);
    await host.friendSnapshot(live, read);
    expect(read).toHaveBeenLastCalledWith(0, 0);
  });

  it('only visits the requested account when sending an account refresh', () => {
    const host = new AccountSocialHost<AccountSocialSession>();
    for (let i = 0; i < 1000; i++) host.add(session(i, i));
    const alt = session(5, 1001);
    host.add(alt);
    const push = vi.fn();
    host.pushAccountSnapshots(alt, push);
    expect(push.mock.calls).toEqual([[5], [1001]]);
  });

  it('does not send or stamp a snapshot after its session departs', async () => {
    const live = session(1, 10),
      pending = deferred<SocialSnapshot>();
    const send = vi.fn(),
      setPlayerGuild = vi.fn(),
      setPlayerGuildMembership = vi.fn(),
      setPlayerPledge = vi.fn();
    const work = sendAccountSocialSnapshot(live, true, {
      snapshot: () => pending.promise,
      sim: { guildBanks: new Map(), setPlayerGuild, setPlayerGuildMembership, setPlayerPledge },
      ensureGuildLoaded: async () => {},
      current: () => !live.left,
      send,
    });
    live.left = true;
    pending.resolve(emptySnapshot);
    await work;
    expect(send).not.toHaveBeenCalled();
    expect(setPlayerGuild).not.toHaveBeenCalled();
  });
});
