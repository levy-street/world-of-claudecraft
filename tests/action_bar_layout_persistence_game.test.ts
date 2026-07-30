import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked-db GameServer harness (see tests/character_lease_game.test.ts). Only the
// db exports game.ts touches on the join / dispatch / broadcast paths are stubbed;
// setCharacterHotbarLayout is the one this suite asserts on. The mock is hoisted
// above the game import.
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
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  setCharacterHotbarLayout: vi.fn(async () => {}),
}));

import { setCharacterHotbarLayout } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';
import type { ActionBarLayout } from '../src/world_api/action_bar';

interface FakeClient {
  sent: any[];
  ws: { readyState: number; send: (payload: string) => void };
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

function join(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  meta: Parameters<GameServer['join']>[7] = {},
): ClientSession {
  const s = server.join(fc.ws as any, characterId, characterId, name, 'warrior', null, false, meta);
  if ('error' in s) throw new Error(s.error);
  s.blockListLoaded = true;
  return s;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

const LAYOUT: ActionBarLayout = {
  v: 1,
  forms: {
    normal: {
      bar: [{ type: 'ability', id: 'heroic_strike' }, null],
      attack: { type: 'item', id: 'linen_bandage' },
    },
    stealth: { bar: [{ type: 'ability', id: 'ambush' }], attack: null },
  },
};

describe('action-bar layout persistence (wire round trip)', () => {
  beforeEach(() => {
    vi.mocked(setCharacterHotbarLayout).mockClear();
  });

  it('sends the stored layout to the owning client once, as the self `hbl` field', () => {
    const server = new GameServer();
    const fc = fakeWs();
    join(server, fc, 1, 'Owner', { hotbarLayout: LAYOUT });
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.hbl).toEqual(LAYOUT);

    // Second broadcast: the frozen layout is diffed against lastSent, so it is
    // NOT re-echoed (a later save must never round-trip back and clobber edits).
    fc.sent.length = 0;
    broadcast(server);
    const snap2 = lastSnap(fc.sent);
    expect(snap2?.self).not.toHaveProperty('hbl');
  });

  it('sends an explicit null `hbl` (seed signal) when the character has no stored layout', () => {
    const server = new GameServer();
    const fc = fakeWs();
    join(server, fc, 5, 'Fresh');
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self).toHaveProperty('hbl');
    expect(snap.self.hbl).toBeNull();
  });

  it("does NOT leak one player's layout to another client observing the same entity", () => {
    const server = new GameServer();
    const ownerFc = fakeWs();
    const observerFc = fakeWs();
    const owner = join(server, ownerFc, 1, 'Owner', { hotbarLayout: LAYOUT });
    join(server, observerFc, 2, 'Observer');
    broadcast(server);

    const observerSnap = lastSnap(observerFc.sent);
    // The observer sees the owner as an OTHER entity (snap.ents); no entity wire
    // carries a hotbar layout, and the observer's own self.hbl is its own (null).
    for (const ent of observerSnap.ents ?? []) {
      expect(ent).not.toHaveProperty('hbl');
    }
    expect(observerSnap.self.hbl).toBeNull();
    // Decisive: the owner's private layout appears nowhere in the observer's frame.
    expect(JSON.stringify(observerSnap)).not.toContain('linen_bandage');
    // The owner still receives its own layout.
    expect(lastSnap(ownerFc.sent).self.hbl).toEqual(LAYOUT);
    void owner;
  });

  it('serializes concurrent saves per character in FIFO order (no reordered stale write)', async () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = join(server, fc, 9, 'Ordered');
    const first: ActionBarLayout = {
      v: 1,
      forms: { normal: { bar: [{ type: 'ability', id: 'first' }] } },
    };
    const second: ActionBarLayout = {
      v: 1,
      forms: { normal: { bar: [{ type: 'ability', id: 'second' }] } },
    };
    // Two saves dispatched back to back: the per-character FIFO queue must commit
    // them in arrival order so the newer layout is never overwritten by the older.
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'save_hotbar_layout', layout: first }),
    );
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'save_hotbar_layout', layout: second }),
    );
    await vi.waitFor(() => expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(setCharacterHotbarLayout).mock.calls;
    expect(calls.map((c) => c[0])).toEqual([9, 9]);
    expect(calls[0][1]).toEqual(first);
    expect(calls[1][1]).toEqual(second);
  });

  it('validates + enqueues a save with the exact sanitized payload on a save_hotbar_layout command', async () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = join(server, fc, 7, 'Saver');
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'save_hotbar_layout', layout: LAYOUT }),
    );
    await vi.waitFor(() => expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(1));
    const [characterId, saved] = vi.mocked(setCharacterHotbarLayout).mock.calls[0];
    expect(characterId).toBe(7);
    expect(saved).toEqual(LAYOUT);
  });

  it('drops a garbage / oversized payload server-side without crashing or persisting', async () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = join(server, fc, 8, 'Abuser');

    // Not an object.
    expect(() =>
      server.handleMessage(
        session,
        JSON.stringify({ t: 'cmd', cmd: 'save_hotbar_layout', layout: 'nope' }),
      ),
    ).not.toThrow();
    // An oversized bar (past the slot cap) rejects the whole payload.
    const huge = { v: 1, forms: { normal: { bar: Array.from({ length: 500 }, () => null) } } };
    expect(() =>
      server.handleMessage(
        session,
        JSON.stringify({ t: 'cmd', cmd: 'save_hotbar_layout', layout: huge }),
      ),
    ).not.toThrow();
    // Missing layout entirely.
    expect(() =>
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'save_hotbar_layout' })),
    ).not.toThrow();

    await new Promise((r) => setTimeout(r, 10));
    expect(vi.mocked(setCharacterHotbarLayout)).not.toHaveBeenCalled();
    // The session survives: a subsequent valid command still processes.
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'save_hotbar_layout', layout: LAYOUT }),
    );
    await vi.waitFor(() => expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(1));
  });
});
