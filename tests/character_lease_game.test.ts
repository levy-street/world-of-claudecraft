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

import { heartbeatCharacterLeases, releaseCharacterLease } from '../server/db';
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
