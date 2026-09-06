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
  insertBankLedgerRows: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  setCharacterHotbarLayout: vi.fn(async () => {}),
}));

import { setCharacterHotbarLayout } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';
import { HotbarLayoutStore, mergeHotbarLayoutSave } from '../server/hotbar_layout';
import { createWsAuth } from '../server/ws_auth';
import { ONLINE_WORLD_AUTH_TYPE } from '../src/world_api';
import type { ActionBarLayout, ActionBarLayoutProfiles } from '../src/world_api/action_bar';

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

function save(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'save_hotbar_layout', ...body }));
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

const TOUCH_LAYOUT: ActionBarLayout = {
  v: 1,
  forms: { normal: { bar: [{ type: 'ability', id: 'sunder_armor' }], attack: null } },
};

const LAYOUT_AFTER_MIDSESSION_EDIT: ActionBarLayout = {
  v: 1,
  forms: {
    normal: {
      bar: [{ type: 'ability', id: 'shield_slam' }, null],
      attack: { type: 'item', id: 'linen_bandage' },
    },
  },
};

// The `hbl` wire view of a v1 layout at rest: the per-profile document under
// the desktop profile plus the `forms` mirror a pre-profile bundle reads.
function wireOf(desktop: ActionBarLayout): unknown {
  return { v: 2, forms: desktop.forms, profiles: { desktop } };
}

function docOf(profiles: ActionBarLayoutProfiles['profiles']): ActionBarLayoutProfiles {
  return { v: 2, profiles };
}

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
    expect(snap.self.hbl).toEqual(wireOf(LAYOUT));

    // Second broadcast: the frozen layout is diffed against lastSent, so it is
    // NOT re-echoed (a later save must never round-trip back and clobber edits).
    fc.sent.length = 0;
    broadcast(server);
    const snap2 = lastSnap(fc.sent);
    expect(snap2?.self).not.toHaveProperty('hbl');
  });

  it('wires a stored v2 document with every profile and the desktop forms mirror', () => {
    const server = new GameServer();
    const fc = fakeWs();
    join(server, fc, 3, 'TwoSurfaces', {
      hotbarLayout: docOf({ desktop: LAYOUT, touch: TOUCH_LAYOUT }),
    });
    broadcast(server);
    const hbl = lastSnap(fc.sent).self.hbl;
    expect(hbl.profiles).toEqual({ desktop: LAYOUT, touch: TOUCH_LAYOUT });
    expect(hbl.forms).toEqual(LAYOUT.forms);
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
    expect(lastSnap(ownerFc.sent).self.hbl).toEqual(wireOf(LAYOUT));
    void owner;
  });

  it('supersedes a still-queued save with the newer document and never reorders a started one', async () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = join(server, fc, 9, 'Ordered');
    const layoutOf = (id: string): ActionBarLayout => ({
      v: 1,
      forms: { normal: { bar: [{ type: 'ability', id }] } },
    });
    // The first write starts and then blocks, holding the per-character FIFO.
    let started!: () => void;
    let release!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(setCharacterHotbarLayout).mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    save(server, session, { profile: 'desktop', layout: layoutOf('first') });
    await firstStarted;
    // Two more saves while the first is running: the second is queued and the
    // third supersedes it (the session document already carries every merge),
    // so exactly one more write lands, with the newest document, after the first.
    save(server, session, { profile: 'touch', layout: layoutOf('second') });
    save(server, session, { profile: 'desktop', layout: layoutOf('third') });
    release();
    await vi.waitFor(() => expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(setCharacterHotbarLayout).mock.calls;
    expect(calls.map((c) => c[0])).toEqual([9, 9]);
    expect(calls[0][1]).toEqual(docOf({ desktop: layoutOf('first') }));
    expect(calls[1][1]).toEqual(docOf({ desktop: layoutOf('third'), touch: layoutOf('second') }));
  });

  it('validates + enqueues a save with the exact sanitized payload on a save_hotbar_layout command', async () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = join(server, fc, 7, 'Saver');
    save(server, session, { profile: 'touch', layout: TOUCH_LAYOUT });
    await vi.waitFor(() => expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(1));
    const [characterId, saved] = vi.mocked(setCharacterHotbarLayout).mock.calls[0];
    expect(characterId).toBe(7);
    expect(saved).toEqual(docOf({ touch: TOUCH_LAYOUT }));
  });

  it('merges a touch save into the stored document without clobbering the desktop profile', async () => {
    const server = new GameServer();
    const fc = fakeWs();
    // A v1 layout at rest (saved before profiles shipped) is the desktop profile.
    const session = join(server, fc, 13, 'Phone', { hotbarLayout: LAYOUT });
    save(server, session, { profile: 'touch', layout: TOUCH_LAYOUT });
    await vi.waitFor(() => expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(setCharacterHotbarLayout).mock.calls[0][1]).toEqual(
      docOf({ desktop: LAYOUT, touch: TOUCH_LAYOUT }),
    );
    // And the desktop save that follows keeps the touch profile intact.
    save(server, session, { profile: 'desktop', layout: LAYOUT_AFTER_MIDSESSION_EDIT });
    await vi.waitFor(() => expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(setCharacterHotbarLayout).mock.calls[1][1]).toEqual(
      docOf({ desktop: LAYOUT_AFTER_MIDSESSION_EDIT, touch: TOUCH_LAYOUT }),
    );
  });

  it('lands a save that names no profile (a pre-profile client bundle) on the desktop profile', async () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = join(server, fc, 14, 'OldBundle', {
      hotbarLayout: docOf({ desktop: LAYOUT, touch: TOUCH_LAYOUT }),
    });
    save(server, session, { layout: LAYOUT_AFTER_MIDSESSION_EDIT });
    await vi.waitFor(() => expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(setCharacterHotbarLayout).mock.calls[0][1]).toEqual(
      docOf({ desktop: LAYOUT_AFTER_MIDSESSION_EDIT, touch: TOUCH_LAYOUT }),
    );
  });

  it('resumes with the in-session document even when the row re-read is behind it', () => {
    const server = new GameServer();
    const firstFc = fakeWs();
    const session = join(server, firstFc, 11, 'Resumer', { hotbarLayout: LAYOUT });
    broadcast(server);
    expect(lastSnap(firstFc.sent).self.hbl).toEqual(wireOf(LAYOUT));

    // The player edits the touch bar mid-session (the session document holds
    // the merge at once; the FIFO write may still be queued), then the socket
    // drops into the linkdead grace window.
    save(server, session, { profile: 'touch', layout: TOUCH_LAYOUT });
    session.linkdead = true;

    // The reconnect's WS auth handshake re-reads the character row fresh
    // (server/ws_auth.ts). This session is the character's only writer, so a
    // row that has not caught up yet must never regress the merge base or the
    // wire value: the other profile's edit would otherwise be dropped by the
    // next save.
    const secondFc = fakeWs();
    const resumed = join(server, secondFc, 11, 'Resumer', { hotbarLayout: LAYOUT });
    expect(resumed).toBe(session);
    broadcast(server);
    const resumedSnap = lastSnap(secondFc.sent);
    expect(resumedSnap.self.hbl).toEqual({
      v: 2,
      forms: LAYOUT.forms,
      profiles: { desktop: LAYOUT, touch: TOUCH_LAYOUT },
    });
    expect(session.hotbarLayout).toEqual(docOf({ desktop: LAYOUT, touch: TOUCH_LAYOUT }));
  });

  it('a session holding no document takes the freshly-read row on resume', () => {
    const server = new GameServer();
    const firstFc = fakeWs();
    const session = join(server, firstFc, 16, 'RowResumer');
    broadcast(server);
    expect(lastSnap(firstFc.sent).self.hbl).toBeNull();

    session.linkdead = true;
    const secondFc = fakeWs();
    const resumed = join(server, secondFc, 16, 'RowResumer', {
      hotbarLayout: LAYOUT_AFTER_MIDSESSION_EDIT,
    });
    expect(resumed).toBe(session);
    broadcast(server);
    expect(lastSnap(secondFc.sent).self.hbl).toEqual(wireOf(LAYOUT_AFTER_MIDSESSION_EDIT));
    expect(session.hotbarLayout).toEqual(docOf({ desktop: LAYOUT_AFTER_MIDSESSION_EDIT }));
  });

  it('resume keeps the saved layout when the caller omits hotbarLayout in meta', () => {
    // ws_auth.ts (the real reconnect path) always supplies hotbarLayout, but an
    // in-process/test caller passing meta = {} must not have the session's
    // layout reset to null: that would read to the client as "server has no
    // copy, seed from this device" and clobber a real saved layout.
    const server = new GameServer();
    const firstFc = fakeWs();
    const session = join(server, firstFc, 12, 'BareResumer', { hotbarLayout: LAYOUT });
    broadcast(server);
    expect(lastSnap(firstFc.sent).self.hbl).toEqual(wireOf(LAYOUT));

    session.linkdead = true;
    const secondFc = fakeWs();
    const resumed = join(server, secondFc, 12, 'BareResumer');
    expect(resumed).toBe(session);
    broadcast(server);
    const resumedSnap = lastSnap(secondFc.sent);
    expect(resumedSnap.self.hbl).toEqual(wireOf(LAYOUT));
  });

  it('drops a garbage / oversized payload server-side without crashing or persisting', async () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = join(server, fc, 8, 'Abuser');

    // Not an object.
    expect(() => save(server, session, { layout: 'nope' })).not.toThrow();
    // An oversized bar (past the slot cap) rejects the whole payload.
    const huge = { v: 1, forms: { normal: { bar: Array.from({ length: 500 }, () => null) } } };
    expect(() => save(server, session, { layout: huge })).not.toThrow();
    // Missing layout entirely.
    expect(() => save(server, session, {})).not.toThrow();
    // A profile outside the known set.
    expect(() => save(server, session, { profile: 'vr', layout: LAYOUT })).not.toThrow();
    expect(() => save(server, session, { profile: 7, layout: LAYOUT })).not.toThrow();

    await new Promise((r) => setTimeout(r, 10));
    expect(vi.mocked(setCharacterHotbarLayout)).not.toHaveBeenCalled();
    // The session survives: a subsequent valid command still processes.
    save(server, session, { profile: 'desktop', layout: LAYOUT });
    await vi.waitFor(() => expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(1));
  });
});

describe('a queued write outliving its session (logout then a fresh join)', () => {
  beforeEach(() => {
    vi.mocked(setCharacterHotbarLayout).mockClear();
  });

  function deferFirstWrite(): { started: Promise<void>; release: () => void } {
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(setCharacterHotbarLayout).mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    return { started: startedPromise, release: () => release() };
  }

  it('the store reports the newest document as pending until its write settles', async () => {
    const store = new HotbarLayoutStore();
    const session = { characterId: 21, initialHotbarLayoutJson: 'null', hotbarLayout: null };
    const gate = deferFirstWrite();
    store.save(session, { profile: 'desktop', layout: LAYOUT });
    expect(store.pending(21)).toEqual(docOf({ desktop: LAYOUT }));
    await gate.started;
    store.save(session, { profile: 'touch', layout: TOUCH_LAYOUT });
    expect(store.pending(21)).toEqual(docOf({ desktop: LAYOUT, touch: TOUCH_LAYOUT }));
    gate.release();
    await vi.waitFor(() => expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.pending(21)).toBeNull());
    expect(store.pending(22)).toBeNull();
  });

  it("a fresh join seeds from the previous session's still-queued document, not the stale row", async () => {
    const server = new GameServer();
    const firstFc = fakeWs();
    const first = join(server, firstFc, 23, 'Relogger', { hotbarLayout: LAYOUT });
    const gate = deferFirstWrite();
    // The last desktop edit of the session is queued (its write is running and
    // has not committed) when the player logs out.
    save(server, first, { profile: 'desktop', layout: LAYOUT_AFTER_MIDSESSION_EDIT });
    await gate.started;
    await server.leave(first, 'logout');
    expect(server.hotbarLayouts.pending(23)).toEqual(
      docOf({ desktop: LAYOUT_AFTER_MIDSESSION_EDIT }),
    );

    // The fresh login's auth handshake read the row before that commit.
    const secondFc = fakeWs();
    const second = join(server, secondFc, 23, 'Relogger', { hotbarLayout: LAYOUT });
    expect(second).not.toBe(first);
    expect(second.hotbarLayout).toEqual(docOf({ desktop: LAYOUT_AFTER_MIDSESSION_EDIT }));
    broadcast(server);
    expect(lastSnap(secondFc.sent).self.hbl).toEqual(wireOf(LAYOUT_AFTER_MIDSESSION_EDIT));

    // Its first save merges onto the pending document, so the desktop edit
    // survives the touch save that follows it.
    save(server, second, { profile: 'touch', layout: TOUCH_LAYOUT });
    gate.release();
    await vi.waitFor(() => expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(setCharacterHotbarLayout).mock.calls;
    expect(calls[0][1]).toEqual(docOf({ desktop: LAYOUT_AFTER_MIDSESSION_EDIT }));
    expect(calls[1][1]).toEqual(
      docOf({ desktop: LAYOUT_AFTER_MIDSESSION_EDIT, touch: TOUCH_LAYOUT }),
    );
    await vi.waitFor(() => expect(server.hotbarLayouts.pending(23)).toBeNull());
  });
});

describe('the auth handshake: a queued write that settles between the row reads and join', () => {
  beforeEach(() => {
    vi.mocked(setCharacterHotbarLayout).mockClear();
  });

  function deferFirstWrite(): { started: Promise<void>; release: () => void } {
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(setCharacterHotbarLayout).mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    return { started: startedPromise, release: () => release() };
  }

  // The socket the handshake admits: the real GameServer joins it, so it needs
  // the OPEN constant the mid-handshake death re-check compares against and the
  // listener hooks ws_auth attaches after join.
  function fakeAuthWs(): FakeClient & { ws: { OPEN: number; close: () => void; on: () => void } } {
    const sent: any[] = [];
    return {
      sent,
      ws: {
        readyState: 1,
        OPEN: 1,
        send: (p: string) => sent.push(JSON.parse(p)),
        close: () => {},
        on: () => {},
      },
    };
  }

  // ws_auth.ts takes every DB call through its deps bag; only getCharacter
  // matters here (the lease and the rest pass), and the game is the REAL
  // server whose store the handshake must consult.
  function authDeps(
    server: GameServer,
    getCharacter: () => Promise<unknown>,
  ): Parameters<typeof createWsAuth>[0] {
    return {
      game: server,
      accountAndScopeForToken: async () => ({ accountId: 23, scope: 'full' as const }),
      moderationStatusForAccount: async () => ({ locked: false, chatStrikes: 0 }),
      getCharacter,
      chatMuteStatusForAccount: async () => ({ mutedUntil: null, reason: null }),
      adminRolesForAccount: async () => null,
      permissionsForRoles: () => new Set<string>(),
      metaRequestUserData: () => ({}),
      metaEventSourceUrl: () => undefined,
      loadAccountCosmetics: async () => ({ completedQuestIds: [], mechChromaIds: [] }),
      isConnectionRefused: () => false,
      bufferHandshakeMessages: () => () => {},
      requestMetadata: () => ({ ip: '1.2.3.4', userAgent: 'test' }),
      maxWsPerIpHard: 100,
      maxPlayersPerRealm: 0,
      acquireCharacterLease: async () => true,
      releaseCharacterLease: async () => {},
      bankBonusForAccount: async () => ({ bonusSlots: 0, sources: [], characterCount: 1 }),
    } as unknown as Parameters<typeof createWsAuth>[0];
  }

  it("seeds the fresh join from the previous session's last save even when that write commits after the handshake's row reads", async () => {
    const server = new GameServer();
    const first = join(server, fakeWs(), 23, 'Relogger', { hotbarLayout: LAYOUT });
    const gate = deferFirstWrite();
    save(server, first, { profile: 'desktop', layout: LAYOUT_AFTER_MIDSESSION_EDIT });
    await gate.started;
    await server.leave(first, 'logout');
    expect(server.hotbarLayouts.pending(23)).toEqual(
      docOf({ desktop: LAYOUT_AFTER_MIDSESSION_EDIT }),
    );

    // Both handshake reads of the row (the ownership check and the post-lease
    // reload) return the stale layout, and the queued write commits DURING the
    // reload: by the time game.join runs, the store has forgotten its pending
    // document and the only fresh copy is the one the handshake captured.
    const staleRow = {
      id: 23,
      name: 'Relogger',
      class: 'warrior',
      state: null,
      is_gm: false,
      force_rename: false,
      hotbar_layout: LAYOUT,
    };
    let reads = 0;
    const getCharacter = async () => {
      reads++;
      if (reads === 2) {
        gate.release();
        await vi.waitFor(() => expect(server.hotbarLayouts.pending(23)).toBeNull());
      }
      return staleRow;
    };
    const client = fakeAuthWs();
    const auth = createWsAuth(authDeps(server, getCharacter));
    await auth.authenticateWebSocket(
      client.ws as any,
      JSON.stringify({ t: ONLINE_WORLD_AUTH_TYPE, token: 'tok', character: 23 }),
      {} as any,
    );
    expect(reads).toBe(2);
    const second = [...server.clients.values()].find((s) => s.characterId === 23);
    expect(second).toBeDefined();
    if (!second) return;
    expect(second.hotbarLayout).toEqual(docOf({ desktop: LAYOUT_AFTER_MIDSESSION_EDIT }));
    // The wire value the client restores from is the committed edit, not the
    // row the handshake raced.
    expect(JSON.parse(second.initialHotbarLayoutJson)).toEqual(
      wireOf(LAYOUT_AFTER_MIDSESSION_EDIT),
    );
    // Its first save merges onto the fresh document, so the desktop edit
    // survives the touch save that follows it.
    second.blockListLoaded = true;
    save(server, second, { profile: 'touch', layout: TOUCH_LAYOUT });
    await vi.waitFor(() => expect(vi.mocked(setCharacterHotbarLayout)).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(setCharacterHotbarLayout).mock.calls;
    expect(calls[1][1]).toEqual(
      docOf({ desktop: LAYOUT_AFTER_MIDSESSION_EDIT, touch: TOUCH_LAYOUT }),
    );
    await vi.waitFor(() => expect(server.hotbarLayouts.pending(23)).toBeNull());
  });

  it('with nothing queued, the fresh join takes the post-lease reload of the row, not the ownership read', async () => {
    const server = new GameServer();
    let reads = 0;
    const getCharacter = async () => {
      reads++;
      return {
        id: 23,
        name: 'Relogger',
        class: 'warrior',
        state: null,
        is_gm: false,
        force_rename: false,
        // The row moved between the two reads (another process committed the
        // character's last save before this handshake's lease landed).
        hotbar_layout: reads === 1 ? LAYOUT : LAYOUT_AFTER_MIDSESSION_EDIT,
      };
    };
    const auth = createWsAuth(authDeps(server, getCharacter));
    await auth.authenticateWebSocket(
      fakeAuthWs().ws as any,
      JSON.stringify({ t: ONLINE_WORLD_AUTH_TYPE, token: 'tok', character: 23 }),
      {} as any,
    );
    const session = [...server.clients.values()].find((s) => s.characterId === 23);
    expect(session?.hotbarLayout).toEqual(docOf({ desktop: LAYOUT_AFTER_MIDSESSION_EDIT }));
  });
});

describe('mergeHotbarLayoutSave (the per-profile merge rule)', () => {
  it('replaces the named profile and keeps the others, immutably', () => {
    const current = docOf({ desktop: LAYOUT, touch: TOUCH_LAYOUT });
    const next = mergeHotbarLayoutSave(current, {
      profile: 'touch',
      layout: LAYOUT_AFTER_MIDSESSION_EDIT,
    });
    expect(next).toEqual(docOf({ desktop: LAYOUT, touch: LAYOUT_AFTER_MIDSESSION_EDIT }));
    expect(current).toEqual(docOf({ desktop: LAYOUT, touch: TOUCH_LAYOUT }));
  });

  it('starts a document from nothing and defaults an absent profile to desktop', () => {
    expect(mergeHotbarLayoutSave(null, { layout: LAYOUT })).toEqual(docOf({ desktop: LAYOUT }));
    expect(mergeHotbarLayoutSave(null, { profile: 'gamepad', layout: LAYOUT })).toEqual(
      docOf({ gamepad: LAYOUT }),
    );
  });

  it('drops an unknown profile or a malformed layout (returns null, current untouched)', () => {
    const current = docOf({ desktop: LAYOUT });
    expect(mergeHotbarLayoutSave(current, { profile: 'vr', layout: LAYOUT })).toBeNull();
    expect(mergeHotbarLayoutSave(current, { profile: null, layout: LAYOUT })).toBeNull();
    expect(mergeHotbarLayoutSave(current, { profile: 'touch', layout: 'nope' })).toBeNull();
    expect(mergeHotbarLayoutSave(current, { profile: 'touch' })).toBeNull();
    expect(current).toEqual(docOf({ desktop: LAYOUT }));
  });
});
