import { beforeEach, describe, expect, it, vi } from 'vitest';

// ws_auth.ts takes ALL of its DB access through the injected deps bag, including
// the two character-lease functions, so the handshake drives with no live
// database and no module mock: the lease fns are vi.fn spies on the deps object.
import { createWsAuth } from '../server/ws_auth';

const ALREADY_IN_WORLD = 'character already in world';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeWs() {
  const sent: any[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  return {
    sent,
    closes,
    ws: {
      readyState: 1,
      send: (p: string) => sent.push(JSON.parse(p)),
      close: (code?: number, reason?: string) => closes.push({ code, reason }),
      on: () => {},
    } as any,
  };
}

const authFrame = (character: number) => JSON.stringify({ t: 'auth', token: 'tok', character });
const fakeReq = () => ({}) as any;

// Build a full WsAuthDeps bag whose cheap checks all pass, so a handshake reaches
// the lease section and game.join. opts tunes the levers this file exercises:
// whether a live session already exists, what game.join returns, and whether the
// lease acquire succeeds.
function makeDeps(opts: { joinResult?: any; hasSession?: boolean; acquireResult?: boolean } = {}) {
  const character = {
    id: 7,
    name: 'Vaultkeeper',
    class: 'warrior',
    state: null,
    is_gm: false,
    force_rename: false,
  };
  const session = { pid: 1, characterId: 7, name: 'Vaultkeeper', ws: null, awaitingPong: false };
  const joinSpy = vi.fn((...args: unknown[]) => {
    void args;
    return opts.joinResult ?? session;
  });
  const hasSessionSpy = vi.fn((_characterId: number) => opts.hasSession ?? false);
  const acquireSpy = vi.fn(async (_characterId: number, _accountId: number, _nonce: string) => {
    return opts.acquireResult ?? true;
  });
  const releaseSpy = vi.fn(async (_characterId: number, _nonce?: string) => {});
  // Bank bonus: the fresh-join arm recomputes the bank bonus before acquiring the lease.
  const bankBonusSpy = vi.fn(async (_accountId: number) => ({
    bonusSlots: 0,
    sources: [] as unknown[],
  }));
  const game = {
    isIpBlocked: () => false,
    countIpSessions: () => 0,
    hasSessionForCharacter: hasSessionSpy,
    join: joinSpy,
    clients: { size: 1 },
  };
  const deps: any = {
    game,
    accountForToken: vi.fn(async () => 1),
    moderationStatusForAccount: vi.fn(async () => ({ locked: false, chatStrikes: 0 })),
    getCharacter: vi.fn(async () => character),
    chatMuteStatusForAccount: vi.fn(async () => ({ mutedUntil: null, reason: null })),
    adminRolesForAccount: vi.fn(async () => null),
    permissionsForRoles: () => new Set<string>(),
    metaRequestUserData: () => ({}),
    metaEventSourceUrl: () => undefined,
    loadAccountCosmetics: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
    isConnectionRefused: () => false,
    bufferHandshakeMessages: () => () => {},
    requestMetadata: () => ({ ip: '1.2.3.4', userAgent: 'test' }),
    maxWsPerIpHard: 100,
    // Realm admission cap disabled: this file exercises the lease arm, not the cap.
    maxPlayersPerRealm: 0,
    acquireCharacterLease: acquireSpy,
    releaseCharacterLease: releaseSpy,
    bankBonusForAccount: bankBonusSpy,
  };
  return { deps, game, joinSpy, hasSessionSpy, acquireSpy, releaseSpy, bankBonusSpy, session };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ws auth character load lease', () => {
  it('refuses the handshake fail-closed when the lease is held elsewhere', async () => {
    const { deps, joinSpy, acquireSpy, releaseSpy } = makeDeps({ acquireResult: false });
    const { ws, sent, closes } = fakeWs();

    const h = createWsAuth(deps);
    await h.authenticateWebSocket(ws, authFrame(7), fakeReq());

    // Acquired on the ownership-checked id, not a raw client field.
    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(acquireSpy.mock.calls[0][0]).toBe(7);
    // The refusal reuses planJoin's exact wire string (already client-mapped).
    expect(sent).toContainEqual({ t: 'error', error: ALREADY_IN_WORLD });
    // No session is created, and nothing releases a lease we never took.
    expect(joinSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(closes.length).toBeGreaterThan(0);

    // A refused handshake clears the pending guard too (not just a successful
    // one): a retry after the foreign lease frees must reach the DB acquire
    // again rather than dying on a leaked pending id.
    acquireSpy.mockResolvedValueOnce(true);
    const retry = fakeWs();
    await h.authenticateWebSocket(retry.ws, authFrame(7), fakeReq());
    expect(acquireSpy).toHaveBeenCalledTimes(2);
    expect(retry.sent).not.toContainEqual({ t: 'error', error: ALREADY_IN_WORLD });
    expect(joinSpy).toHaveBeenCalledTimes(1);
  });

  it('acquires with the AUTHENTICATED account id, never the client-sent character id', async () => {
    // Distinct fixtures: getCharacter yields character 7, accountForToken yields
    // account 1, so a positional swap of the two args cannot pass unnoticed.
    const { deps, acquireSpy, joinSpy } = makeDeps();
    const { ws } = fakeWs();

    await createWsAuth(deps).authenticateWebSocket(ws, authFrame(7), fakeReq());

    expect(acquireSpy).toHaveBeenCalledTimes(1);
    const [characterId, accountId, nonce] = acquireSpy.mock.calls[0];
    // The ownership-checked character id first, the token-resolved account id
    // second, the per-join nonce third. Seeding the account arm from a
    // client-controlled value would let a caller reclaim a foreign account's lease.
    expect(characterId).toBe(7);
    expect(accountId).toBe(1);
    expect(nonce).toMatch(UUID_RE);
    expect(joinSpy).toHaveBeenCalledTimes(1);
  });

  it('acquires with a uuid nonce then joins, passing that same nonce into the session meta', async () => {
    const { deps, joinSpy, acquireSpy, releaseSpy } = makeDeps();
    const { ws, sent } = fakeWs();

    await createWsAuth(deps).authenticateWebSocket(ws, authFrame(7), fakeReq());

    expect(acquireSpy).toHaveBeenCalledTimes(1);
    const nonce = acquireSpy.mock.calls[0][2];
    expect(nonce).toMatch(UUID_RE);
    expect(joinSpy).toHaveBeenCalledTimes(1);
    // The 8th game.join arg is the meta bag; the lease nonce rides into the session
    // so leave() can release with the exact value acquire stamped.
    const joinMeta = joinSpy.mock.calls[0][7] as any;
    expect(joinMeta.leaseNonce).toBe(nonce);
    expect(sent).not.toContainEqual({ t: 'error', error: ALREADY_IN_WORLD });
    // A successful join owns the lease; leave() releases it, not the handshake.
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it('awaits a nonce-fenced release when join refuses and no session owns it', async () => {
    const { deps, acquireSpy, releaseSpy } = makeDeps({
      joinResult: { error: 'too many characters on this account are already in the world' },
      hasSession: false,
    });
    const { ws, sent } = fakeWs();

    await createWsAuth(deps).authenticateWebSocket(ws, authFrame(7), fakeReq());

    const nonce = acquireSpy.mock.calls[0][2];
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    // Fenced with the SAME nonce it acquired with, so it can only delete its own row.
    expect(releaseSpy.mock.calls[0]).toEqual([7, nonce]);
    expect(sent).toContainEqual({
      t: 'error',
      error: 'too many characters on this account are already in the world',
    });
  });

  it('skips the acquire and does not release when a live session already owns the lease', async () => {
    const { deps, acquireSpy, joinSpy, releaseSpy } = makeDeps({
      hasSession: true,
      joinResult: { error: ALREADY_IN_WORLD },
    });
    const { ws, sent } = fakeWs();

    await createWsAuth(deps).authenticateWebSocket(ws, authFrame(7), fakeReq());

    // A session in this process owns the row; never re-stamp it, never release it.
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(joinSpy).toHaveBeenCalledTimes(1);
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(sent).toContainEqual({ t: 'error', error: ALREADY_IN_WORLD });
  });

  it('skips the acquire on a linkdead resume (session exists, join succeeds)', async () => {
    const { deps, acquireSpy, joinSpy, releaseSpy } = makeDeps({ hasSession: true });
    const { ws, sent } = fakeWs();

    await createWsAuth(deps).authenticateWebSocket(ws, authFrame(7), fakeReq());

    expect(acquireSpy).not.toHaveBeenCalled();
    expect(joinSpy).toHaveBeenCalledTimes(1);
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(sent).not.toContainEqual({ t: 'error', error: ALREADY_IN_WORLD });
  });

  it('does not write a lease for a character the account does not own', async () => {
    const { deps, acquireSpy } = makeDeps();
    deps.getCharacter = vi.fn(async () => null);
    const { ws, sent } = fakeWs();

    await createWsAuth(deps).authenticateWebSocket(ws, authFrame(7), fakeReq());

    // getCharacter is the ownership gate; acquiring before it would let any
    // authenticated user lock arbitrary characters (a login DoS).
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(sent).toContainEqual({ t: 'error', error: 'no such character' });
  });

  it('recomputes the bank bonus BEFORE acquiring the lease and stamps it into the join meta', async () => {
    const { deps, acquireSpy, joinSpy, bankBonusSpy } = makeDeps();
    // A NON-ZERO grant: the join meta must carry the recompute's actual result,
    // not a zero default stamped independently of bankBonusForAccount.
    const grant = {
      bonusSlots: 4,
      sources: [
        { id: 'email', slots: 2, maxSlots: 2 },
        { id: 'discord', slots: 2, maxSlots: 2 },
      ],
    };
    bankBonusSpy.mockResolvedValueOnce(grant);
    const { ws } = fakeWs();

    await createWsAuth(deps).authenticateWebSocket(ws, authFrame(7), fakeReq());

    // Recomputed once, keyed by the resolved account id (1), and BEFORE the lease acquire
    // so the lease-held window stays tight.
    expect(bankBonusSpy).toHaveBeenCalledTimes(1);
    expect(bankBonusSpy).toHaveBeenCalledWith(1);
    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(bankBonusSpy.mock.invocationCallOrder[0]).toBeLessThan(
      acquireSpy.mock.invocationCallOrder[0],
    );
    // The grant rides the join meta bag (8th arg), so addPlayer stamps it at load.
    const joinMeta = joinSpy.mock.calls[0][7] as any;
    expect(joinMeta.bankBonus).toEqual(grant);
  });

  it('never recomputes the bank bonus on a linkdead resume (session exists)', async () => {
    const { deps, acquireSpy, bankBonusSpy } = makeDeps({ hasSession: true });
    const { ws } = fakeWs();

    await createWsAuth(deps).authenticateWebSocket(ws, authFrame(7), fakeReq());

    // Resume arm: no lease acquire and no bonus recompute (locked no-mid-session-recompute).
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(bankBonusSpy).not.toHaveBeenCalled();
  });

  it('fails the handshake without taking the lease when the bank-bonus recompute rejects', async () => {
    const { deps, acquireSpy, releaseSpy, joinSpy, bankBonusSpy } = makeDeps();
    bankBonusSpy.mockRejectedValueOnce(new Error('db down'));
    const { ws } = fakeWs();

    // A bare await: a DB error here fails the handshake exactly like a getCharacter
    // failure, and because it runs before the acquire, no lease is ever taken.
    await expect(
      createWsAuth(deps).authenticateWebSocket(ws, authFrame(7), fakeReq()),
    ).rejects.toThrow('db down');
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(joinSpy).not.toHaveBeenCalled();
  });

  it('clears the pending-join id after a bank-bonus rejection (a retry reaches the acquire)', async () => {
    // The recompute rejects inside the pendingLeaseJoins try/finally: if the finally
    // ever stopped clearing this throw site, the character would be locked out of the
    // whole process after one transient DB error (every retry refused fail-closed).
    const { deps, acquireSpy, joinSpy, bankBonusSpy } = makeDeps();
    bankBonusSpy.mockRejectedValueOnce(new Error('db down'));
    const wsAuth = createWsAuth(deps);
    const first = fakeWs();
    await expect(wsAuth.authenticateWebSocket(first.ws, authFrame(7), fakeReq())).rejects.toThrow(
      'db down',
    );

    const second = fakeWs();
    await wsAuth.authenticateWebSocket(second.ws, authFrame(7), fakeReq());

    // The retry took the FRESH-JOIN arm end to end: recompute again, acquire, join.
    expect(bankBonusSpy).toHaveBeenCalledTimes(2);
    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(joinSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses a second concurrent handshake for one character without touching the lease', async () => {
    const { deps } = makeDeps();
    // Park the first handshake inside the lease section: its acquire hangs, so the
    // pending-join set holds the character id while a second handshake arrives.
    let releaseAcquire!: (v: boolean) => void;
    const gate = new Promise<boolean>((r) => {
      releaseAcquire = r;
    });
    let acquireEntered!: () => void;
    const entered = new Promise<void>((r) => {
      acquireEntered = r;
    });
    deps.acquireCharacterLease = vi.fn(() => {
      acquireEntered();
      return gate;
    });

    const h = createWsAuth(deps);
    const w1 = fakeWs();
    const w2 = fakeWs();
    const p1 = h.authenticateWebSocket(w1.ws, authFrame(7), fakeReq());
    await entered; // H1 has entered acquire => pending set holds 7, H1 parked

    await h.authenticateWebSocket(w2.ws, authFrame(7), fakeReq()); // H2 runs to completion

    // H2 hit the pending guard and was refused without a second acquire.
    expect(w2.sent).toContainEqual({ t: 'error', error: ALREADY_IN_WORLD });
    expect(deps.acquireCharacterLease).toHaveBeenCalledTimes(1);

    releaseAcquire(true);
    await p1; // H1 completes and clears the pending id

    // The finally must have cleared the guard: a third handshake for the same
    // character reaches a fresh DB acquire instead of being refused by a leaked
    // pending id (which would lock the character out of this process for good).
    const w3 = fakeWs();
    await h.authenticateWebSocket(w3.ws, authFrame(7), fakeReq());
    expect(w3.sent).not.toContainEqual({ t: 'error', error: ALREADY_IN_WORLD });
    expect(deps.acquireCharacterLease).toHaveBeenCalledTimes(2);
  });
});
