import { beforeEach, describe, expect, it, vi } from 'vitest';

// Postgres is mocked (hoisted above the server/game import), the loot_roll_wire /
// bank_wire idiom, so GameServer runs with no live DB. The lease functions are
// vi.fn spies here: leave() releases and the autosave flush heartbeats, and this
// file asserts on those calls directly.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  // bank_ledger.ts (imported via game.ts recordBankOp) reads this at call time.
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import {
  heartbeatCharacterLeases,
  releaseCharacterLease,
  saveCharacterAndMarketState,
  saveCharacterState,
} from '../server/db';
import { GameServer } from '../server/game';

function fakeWs() {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}

// The 8th game.join arg is the meta bag; ws_auth stamps its lease nonce there, so
// join a session with the same nonce it "acquired" with, then assert leave()
// releases with THAT nonce (never a fresh one).
function join(
  server: GameServer,
  accountId: number,
  characterId: number,
  name: string,
  leaseNonce?: string,
): any {
  const fw = fakeWs();
  const s = server.join(fw.ws as any, accountId, characterId, name, 'warrior', null, false, {
    leaseNonce,
  }) as any;
  if (!('error' in s)) s.blockListLoaded = true;
  return s;
}

// Flush the microtask queue so an awaited leave() reaches its post-save steps.
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('character load lease, GameServer wiring', () => {
  it("leave() releases the lease exactly once with the session's own nonce", async () => {
    const server = new GameServer();
    const s = join(server, 100, 7, 'Leaver', 'nonce-1');
    expect('error' in s).toBe(false);

    await server.leave(s, 'test');

    expect(vi.mocked(releaseCharacterLease)).toHaveBeenCalledTimes(1);
    // The character id AND the session's own nonce: the fence that keeps a stale
    // release from deleting a re-acquired lease.
    expect(vi.mocked(releaseCharacterLease).mock.calls[0]).toEqual([7, 'nonce-1']);
    // The world-level session index is cleared, so a fresh login is not refused.
    expect(server.hasSessionForCharacter(7)).toBe(false);
  });

  it('takeover kicks the live session, releasing its lease with its nonce, and the character rejoins', async () => {
    const server = new GameServer();
    const s1 = join(server, 100, 7, 'Holder', 'nonce-h');
    expect('error' in s1).toBe(false);
    expect(server.hasSessionForCharacter(7)).toBe(true);

    // A duplicate live login for the same character is refused at the world level
    // (planJoin) until a takeover frees the slot. This is the exact string the
    // lease acquire also fails closed with.
    const dup = join(server, 100, 7, 'Holder');
    expect(dup.error).toBe('character already in world');

    const outcome = await server.takeOverCharacter(100, 7);
    expect(outcome).toBe('taken-over');
    expect(vi.mocked(releaseCharacterLease).mock.calls[0]).toEqual([7, 'nonce-h']);
    expect(server.hasSessionForCharacter(7)).toBe(false);

    // Same process, so a re-login lands the session slot again with no refusal.
    const s3 = join(server, 100, 7, 'Holder', 'nonce-h2');
    expect('error' in s3).toBe(false);
    expect(server.hasSessionForCharacter(7)).toBe(true);
  });

  it("a fire-and-forget leave whose release is still in flight carries that session's OWN nonce", async () => {
    // The grace-expiry sweep race: leave() runs fire-and-forget, its release is in
    // flight while a reconnect re-acquires the lease with a new nonce. The
    // game-level guarantee is that leave passes the session's own (now stale)
    // nonce; the SQL fence (character_lease.test.ts) then makes that delete a no-op
    // against the reconnect's re-stamped row.
    const server = new GameServer();
    let resolveRelease!: () => void;
    vi.mocked(releaseCharacterLease).mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveRelease = () => r();
        }),
    );

    const a = join(server, 100, 7, 'Holder', 'nonce-old');
    expect('error' in a).toBe(false);

    // Fire-and-forget, exactly as expireLinkdeadSessions calls it. Its synchronous
    // prefix plus the awaited save free the session slot; the release then parks.
    void server.leave(a, 'grace expired');
    await flushMicrotasks();
    expect(server.hasSessionForCharacter(7)).toBe(false);
    // The in-flight release carries a's own nonce.
    expect(vi.mocked(releaseCharacterLease).mock.calls[0]).toEqual([7, 'nonce-old']);

    // A reconnect takes the freed slot and (at the DB layer) re-acquires with a NEW
    // nonce. The in-flight release above, keyed to nonce-old, cannot touch it.
    const b = join(server, 100, 7, 'Holder', 'nonce-new');
    expect('error' in b).toBe(false);
    expect(server.hasSessionForCharacter(7)).toBe(true);
    // No second release fired: b is still live, and a's release still carries nonce-old.
    expect(vi.mocked(releaseCharacterLease)).toHaveBeenCalledTimes(1);

    resolveRelease();
  });

  it('saveCharacter forwards the session lease nonce as the trailing save arg (plain and market)', async () => {
    const server = new GameServer();
    const s = join(server, 100, 7, 'Saver', 'nonce-c');
    expect('error' in s).toBe(false);

    await (server as any).saveCharacter(s);
    // saveCharacterState(characterId, level, state, leaseNonce): nonce is arg 4.
    const plainCall = vi.mocked(saveCharacterState).mock.calls.at(-1);
    expect(plainCall?.[3]).toBe('nonce-c');

    await (server as any).saveCharacter(s, { withMarket: true });
    // saveCharacterAndMarketState(characterId, level, state, market, mail, leaseNonce):
    // nonce is arg 6.
    const marketCall = vi.mocked(saveCharacterAndMarketState).mock.calls.at(-1);
    expect(marketCall?.[5]).toBe('nonce-c');
  });

  it('a fenced-out save (false) warns, freezes lastSave, keeps deed records queued, and kicks the displaced session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const server = new GameServer();
      const fw = fakeWs();
      const s = server.join(fw.ws as any, 100, 7, 'Doomed', 'warrior', null, false, {
        leaseNonce: 'nonce-c',
      }) as any;
      expect('error' in s).toBe(false);
      s.blockListLoaded = true;
      s.pendingDeedRecords.push('deed-a', 'deed-b');
      s.lastSave = 111;

      // A same-account takeover reclaimed the lease: EVERY later fenced write from
      // this displaced session reports false, including its own leave save.
      vi.mocked(saveCharacterState).mockResolvedValue(false as any);
      vi.mocked(saveCharacterAndMarketState).mockResolvedValue(false as any);
      await (server as any).saveCharacter(s);

      // A deed must never publish ahead of the blob that proves it, and lastSave must
      // not claim a write that did not land.
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls.at(-1)?.[0])).toMatch(/fenced out/);
      expect(s.lastSave).toBe(111);
      expect(s.pendingDeedRecords).toEqual(['deed-a', 'deed-b']);

      // The displaced session is not left playing unsaved: it gets the same explicit
      // takeover signal the in-process path sends, and the world slot clears so the
      // player can reconnect cleanly.
      await vi.waitFor(() => {
        expect(s.left).toBe(true);
        // The character-session index clears only after leave()'s own (fenced,
        // no-op) save settles, so poll it here rather than asserting once.
        expect(server.hasSessionForCharacter(7)).toBe(false);
      });
      expect(fw.sent).toContainEqual({ t: 'error', error: 'character taken over' });

      // A session whose lease is intact still drains normally (re-zero proof): the
      // fence-out above cannot leak into an unrelated healthy session.
      vi.mocked(saveCharacterState).mockResolvedValue(true as any);
      const healthy = join(server, 200, 8, 'Healthy', 'nonce-h');
      expect('error' in healthy).toBe(false);
      healthy.pendingDeedRecords.push('deed-z');
      healthy.lastSave = 111;
      await (server as any).saveCharacter(healthy);
      expect(healthy.lastSave).not.toBe(111);
      expect(healthy.pendingDeedRecords).toEqual([]);
    } finally {
      // Restore the factory defaults so later tests see the pre-test mock shape.
      vi.mocked(saveCharacterState).mockImplementation(async () => undefined as any);
      vi.mocked(saveCharacterAndMarketState).mockImplementation(async () => undefined as any);
      warn.mockRestore();
    }
  });

  it('a session with no lease nonce saves via the legacy path (undefined nonce) and advances lastSave', async () => {
    const server = new GameServer();
    const s = join(server, 100, 7, 'Legacy');
    expect('error' in s).toBe(false);
    expect(s.leaseNonce).toBeUndefined();
    s.lastSave = 222;

    await (server as any).saveCharacter(s);

    const call = vi.mocked(saveCharacterState).mock.calls.at(-1);
    // No nonce forwarded: the legacy unconditional write reports success, so the
    // post-save steps run and lastSave advances.
    expect(call?.[3]).toBeUndefined();
    expect(s.lastSave).not.toBe(222);
  });

  it('the autosave flush heartbeats leases, gated on the autosave interval and reset after', () => {
    const server = new GameServer();
    const flush = (dt: number): void => (server as any).flushPeriodicSaves(dt);

    // Below the 30s autosave interval: the flush does not fire, so no heartbeat.
    flush(1);
    expect(vi.mocked(heartbeatCharacterLeases)).not.toHaveBeenCalled();

    // Crossing the interval trips the flush and heartbeats every held lease once.
    flush(1000);
    expect(vi.mocked(heartbeatCharacterLeases)).toHaveBeenCalledTimes(1);

    // The timer reset means the next sub-interval tick does not heartbeat again.
    flush(1);
    expect(vi.mocked(heartbeatCharacterLeases)).toHaveBeenCalledTimes(1);
  });
});
