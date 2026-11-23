import { describe, expect, it, vi } from 'vitest';
import { PgAccountFriendsDb } from '../server/account_friends_db';
import { AccountPresenceHost, type PresenceEdge } from '../server/account_presence_host';
import { copyPresenceSubject, presenceHiddenFrom } from '../server/presence_privacy';

type Session = { accountId: number; characterId: number; friendAccountIds?: ReadonlySet<number> };
function rig() {
  const sessions = new Map<number, Set<Session>>();
  const host = new AccountPresenceHost(sessions);
  const add = (accountId: number, characterId = accountId): Session => {
    const session = { accountId, characterId };
    const set = sessions.get(accountId) ?? new Set();
    set.add(session);
    sessions.set(accountId, set);
    return session;
  };
  return { sessions, host, add };
}

describe('account presence permissions independent of friend pages', () => {
  it('globally invalidates each live set once without pairwise deletion', async () => {
    const { host, add } = rig();
    for (let id = 1; id <= 100; id++) add(id);
    const sets = Array.from({ length: 100 }, (_, i) => host.friends(i + 1) as Set<number>);
    const clears = sets.map((set) => vi.spyOn(set, 'clear'));
    const deletes = sets.map((set) => vi.spyOn(set, 'delete'));
    host.invalidate();
    for (const clear of clears) expect(clear).toHaveBeenCalledOnce();
    for (const remove of deletes) expect(remove).not.toHaveBeenCalled();
  });

  it('does not recreate an offline account during a dirty refresh retry', async () => {
    const { host, add, sessions } = rig();
    add(1);
    add(2);
    let finish!: (rows: PresenceEdge[]) => void;
    const db = {
      presenceEdgesForAccount: vi.fn(
        () =>
          new Promise<PresenceEdge[]>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const pending = host.refresh(1, db);
    void host.refresh(1, db);
    sessions.delete(1);
    host.remove(1);
    finish([{ accountId: 2, outgoing: true, incoming: true }]);
    await pending;
    expect(db.presenceEdgesForAccount).toHaveBeenCalledOnce();
    const cache = host as unknown as { edges: Map<number, unknown>; epochs: Map<number, unknown> };
    expect(cache.edges.has(1)).toBe(false);
    expect(cache.epochs.has(1)).toBe(false);
  });
  it('keeps the logout snapshot authorized after removing the last live session', async () => {
    const { add, host, sessions } = rig();
    const subject = add(1);
    add(90);
    await host.refresh(1, {
      presenceEdgesForAccount: async () => [{ accountId: 90, outgoing: true, incoming: false }],
    });
    const departed = copyPresenceSubject({ ...subject, presenceMode: 'friends' });
    sessions.delete(1);
    host.remove(1);
    expect(subject.friendAccountIds?.size).toBe(0);
    expect(presenceHiddenFrom(departed, 90, 90)).toBe(false);
    expect(presenceHiddenFrom(departed, 91, 91)).toBe(true);
  });

  it('does not retain historical offline notification accounts', () => {
    const { host } = rig();
    for (let id = 1; id <= 10000; id++) host.invalidate(id);
    expect((host as unknown as { epochs: Map<number, number> }).epochs.size).toBe(0);
  });

  it('bulk-resyncs once and refuses an edge changed during its read', async () => {
    const { add, host } = rig();
    add(1);
    add(2);
    add(3);
    let finish!: (rows: { ownerId: number; friendId: number }[]) => void;
    const db = {
      presenceEdgesForLiveAccounts: vi.fn(
        () =>
          new Promise<{ ownerId: number; friendId: number }[]>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const pending = host.resync(db);
    host.invalidate(3);
    finish([
      { ownerId: 1, friendId: 2 },
      { ownerId: 1, friendId: 3 },
    ]);
    await pending;
    expect([...host.friends(1)]).toEqual([2]);
    expect(db.presenceEdgesForLiveAccounts).toHaveBeenCalledOnce();
    await expect(
      host.resync({
        presenceEdgesForLiveAccounts: async () => {
          throw new Error('offline');
        },
      }),
    ).rejects.toThrow('offline');
    expect(host.friends(1).size).toBe(0);
  });

  it('uses 20 bulk statements for 5000 live accounts instead of 100000 pair statements', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const db = new PgAccountFriendsDb({ query } as never);
    await db.presenceEdgesForLiveAccounts(Array.from({ length: 5000 }, (_, i) => i + 1));
    expect(query).toHaveBeenCalledTimes(20);
    const calls = query.mock.calls as unknown as [string, [number[], number[]]][];
    expect(calls.every((call) => call[1][0].length <= 256)).toBe(true);
    expect(calls[19][1][0]).toHaveLength(136);
  });
  it.each([true, false])(
    'hydrates both directions when subject joins first=%s',
    async (subjectFirst) => {
      const { add, host } = rig();
      const first = add(subjectFirst ? 1 : 90);
      const db = { presenceEdgesForAccount: vi.fn(async (): Promise<PresenceEdge[]> => []) };
      await host.refresh(first.accountId, db);
      const second = add(subjectFirst ? 90 : 1);
      // Account 1 lists account 90; account 90 need not list account 1.
      db.presenceEdgesForAccount.mockResolvedValue([
        { accountId: first.accountId, outgoing: !subjectFirst, incoming: subjectFirst },
      ]);
      await host.refresh(second.accountId, db);
      const subject = subjectFirst ? first : second;
      const viewer = subjectFirst ? second : first;
      expect(
        presenceHiddenFrom(
          { ...subject, presenceMode: 'friends' },
          viewer.characterId,
          viewer.accountId,
        ),
      ).toBe(false);
      expect(host.friends(90).has(1)).toBe(false);
    },
  );

  it('keeps a page-two referral friend visible to every alt without reads on snapshots', async () => {
    const { add, host } = rig();
    const subject = add(1);
    const viewer = add(90, 900);
    const alt = add(90, 901);
    const db = {
      presenceEdgesForAccount: vi.fn(async () => [
        { accountId: 90, outgoing: true, incoming: true },
      ]),
    };
    await host.refresh(1, db);
    for (let i = 0; i < 100; i++) {
      for (const candidate of [viewer, alt]) {
        expect(
          presenceHiddenFrom(
            { ...subject, presenceMode: 'friends' },
            candidate.characterId,
            candidate.accountId,
          ),
        ).toBe(false);
      }
    }
    expect(db.presenceEdgesForAccount).toHaveBeenCalledTimes(1);
  });

  it('revokes immediately and fences a stale read across a removal through another alt', async () => {
    const { add, host } = rig();
    add(1);
    add(90);
    let release!: (rows: PresenceEdge[]) => void;
    const db = {
      presenceEdgesForAccount: vi.fn(
        () =>
          new Promise<PresenceEdge[]>((resolve) => {
            release = resolve;
          }),
      ),
    };
    const first = host.refresh(1, db);
    db.presenceEdgesForAccount.mockImplementationOnce(async () => []);
    const second = host.refresh(1, db);
    expect(host.friends(1).size).toBe(0);
    release([{ accountId: 90, outgoing: true, incoming: false }]);
    await Promise.all([first, second]);
    expect(host.friends(1).size).toBe(0);
    expect(db.presenceEdgesForAccount).toHaveBeenCalledTimes(2);
  });

  it('fails closed after notification invalidation, disconnect and read failure', async () => {
    const { add, host, sessions } = rig();
    const subject = add(1);
    add(90);
    const db = {
      presenceEdgesForAccount: vi.fn(async () => [
        { accountId: 90, outgoing: true, incoming: true },
      ]),
    };
    await host.refresh(1, db);
    host.invalidate(90);
    expect(subject.friendAccountIds?.has(90)).toBe(false);
    db.presenceEdgesForAccount.mockRejectedValueOnce(new Error('unavailable'));
    await expect(host.refresh(1, db)).rejects.toThrow('unavailable');
    expect(host.friends(1).size).toBe(0);
    sessions.delete(90);
    host.remove(90);
    expect(host.friends(1).has(90)).toBe(false);
  });

  it('bounds database pair probes to 256 candidates with sequential admission', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const database = vi.fn();
    const db = new PgAccountFriendsDb({ query } as never, async (read) => {
      database();
      return read();
    });
    await db.presenceEdgesForAccount(
      1,
      Array.from({ length: 600 }, (_, i) => i + 2),
    );
    expect(query.mock.calls).toHaveLength(3);
    expect(database).toHaveBeenCalledTimes(3);
    const calls = query.mock.calls as unknown as [string, [number, number[]]][];
    expect(calls.map((call) => call[1][1].length)).toEqual([256, 256, 88]);
    expect(calls[0][0]).toContain('account_friendships');
    expect(calls[0][0]).toContain('referee_account_id');
    await db.presenceEdgesForAccount(1, []);
    expect(query).toHaveBeenCalledTimes(3);
  });
});
