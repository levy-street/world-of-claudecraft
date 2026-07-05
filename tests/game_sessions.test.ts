import { describe, expect, it, vi } from 'vitest';
import { MECH_CHROMAS } from '../src/sim/content/skins';

const openPlaySession = vi.fn(async () => 1);
const closePlaySession = vi.fn(async () => {});
const markAccountQuestComplete = vi.fn(async (_accountId: number, questId: string) => ({
  completedQuestIds: [questId],
  mechChromaIds: [],
}));
const grantAccountMechChroma = vi.fn(async (_accountId: number, chromaId: string) => ({
  completedQuestIds: [],
  mechChromaIds: [chromaId],
}));
const revokeAccountMechChroma = vi.fn(async (_accountId: number, _chromaId: string) => ({
  completedQuestIds: [],
  mechChromaIds: [],
}));

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: (...args: unknown[]) => openPlaySession(...(args as [])),
  closePlaySession: (...args: unknown[]) => closePlaySession(...(args as [])),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: (...args: unknown[]) =>
    markAccountQuestComplete(...(args as [number, string])),
  grantAccountMechChroma: (...args: unknown[]) =>
    grantAccountMechChroma(...(args as [number, string])),
  revokeAccountMechChroma: (...args: unknown[]) =>
    revokeAccountMechChroma(...(args as [number, string])),
}));

import { saveCharacterAndMarketState, saveCharacterState } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';

function fakeWs() {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  } as any;
}

function expectJoined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  return result;
}

describe('GameServer sessions', () => {
  it('applies account-wide quest lockouts when a character joins', () => {
    const server = new GameServer();
    const session = expectJoined(
      server.join(fakeWs(), 11, 101, 'Lockedout', 'warrior', null, false, {
        accountCosmetics: { completedQuestIds: ['q_aldrics_fallen_star'], mechChromaIds: [] },
      }),
    );

    expect(server.sim.questState('q_aldrics_fallen_star', session.pid)).toBe('done');
    expect(server.sim.meta(session.pid)?.questsDone.has('q_aldrics_fallen_star')).toBe(true);
  });

  it('marks Aldric quest completion account-wide when a character turns it in', () => {
    markAccountQuestComplete.mockClear();
    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Aldricdone', 'warrior', null));
    const meta = server.sim.meta(session.pid)!;
    const player = server.sim.entities.get(session.pid)!;
    const aldric = [...server.sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'brother_aldric_fen',
    )!;
    const pos = server.sim.groundPos(aldric.pos.x + 1, aldric.pos.z);
    player.pos = { ...pos };
    player.prevPos = { ...pos };
    meta.questLog.set('q_aldrics_fallen_star', {
      questId: 'q_aldrics_fallen_star',
      counts: [1],
      state: 'ready',
    });
    server.sim.addItem('unknown_alien_weaponry', 1, session.pid);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'turnin', quest: 'q_aldrics_fallen_star' }),
    );

    expect(markAccountQuestComplete).toHaveBeenCalledWith(11, 'q_aldrics_fallen_star');
    expect(session.accountCosmetics.completedQuestIds).toContain('q_aldrics_fallen_star');
    expect(server.sim.meta(session.pid)?.questsDone.has('q_aldrics_fallen_star')).toBe(true);
  });

  it('stores the mech chroma on the account after claiming from the Aldric spinner item', () => {
    grantAccountMechChroma.mockClear();
    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Mechclaim', 'mage', null));
    const choice = MECH_CHROMAS.findIndex((chroma) => chroma.id === 'amber_crimson');
    expect(choice).toBeGreaterThanOrEqual(0);
    server.sim.addItem('alien_armor_plate', 1, session.pid);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'use', item: 'alien_armor_plate' }),
    );

    expect(grantAccountMechChroma).not.toHaveBeenCalled();
    expect(session.accountCosmetics.mechChromaIds).not.toContain(MECH_CHROMAS[choice].id);
    expect(server.sim.countItem('alien_armor_plate', session.pid)).toBe(1);
    expect(server.sim.entities.get(session.pid)?.skinCatalog).not.toBe('mech');

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'claim_event_skin', skin: choice }),
    );

    expect(grantAccountMechChroma).toHaveBeenCalledWith(11, MECH_CHROMAS[choice].id);
    expect(session.accountCosmetics.mechChromaIds).toContain(MECH_CHROMAS[choice].id);
    expect(server.sim.countItem('alien_armor_plate', session.pid)).toBe(0);
    expect(server.sim.entities.get(session.pid)?.skinCatalog).toBe('mech');
  });

  it('equips a live mech appearance only when the account owns the chroma', () => {
    const server = new GameServer();
    const allowed = expectJoined(
      server.join(fakeWs(), 11, 101, 'Mechwearer', 'shaman', null, false, {
        accountCosmetics: { completedQuestIds: [], mechChromaIds: ['amber_crimson'] },
      }),
    );
    const blocked = expectJoined(server.join(fakeWs(), 12, 102, 'Blockedmech', 'shaman', null));

    server.handleMessage(
      allowed,
      JSON.stringify({ t: 'cmd', cmd: 'change_skin', skin: 0, catalog: 'mech' }),
    );
    server.handleMessage(
      blocked,
      JSON.stringify({ t: 'cmd', cmd: 'change_skin', skin: 0, catalog: 'mech' }),
    );

    expect(server.sim.entities.get(allowed.pid)?.skinCatalog).toBe('mech');
    expect(server.sim.entities.get(blocked.pid)?.skinCatalog).not.toBe('mech');
  });

  it('unequips a mech chroma from every live character on the account and returns its item', () => {
    revokeAccountMechChroma.mockClear();
    const server = new GameServer();
    const cosmetics = { completedQuestIds: [], mechChromaIds: ['amber_crimson'] };
    const first = expectJoined(
      server.join(fakeWs(), 11, 101, 'Mechone', 'shaman', null, false, {
        accountCosmetics: cosmetics,
      }),
    );
    const second = expectJoined(
      server.join(fakeWs(), 11, 102, 'Mechtwo', 'mage', null, false, {
        accountCosmetics: cosmetics,
      }),
    );

    server.handleMessage(
      first,
      JSON.stringify({ t: 'cmd', cmd: 'change_skin', skin: 0, catalog: 'mech' }),
    );
    server.handleMessage(
      second,
      JSON.stringify({ t: 'cmd', cmd: 'change_skin', skin: 0, catalog: 'mech' }),
    );
    server.handleMessage(
      first,
      JSON.stringify({ t: 'cmd', cmd: 'unequip_mech_chroma', chroma: 'amber_crimson' }),
    );

    expect(revokeAccountMechChroma).toHaveBeenCalledWith(11, 'amber_crimson');
    expect(first.accountCosmetics.mechChromaIds).not.toContain('amber_crimson');
    expect(second.accountCosmetics.mechChromaIds).not.toContain('amber_crimson');
    expect(server.sim.entities.get(first.pid)?.skinCatalog).toBe('class');
    expect(server.sim.entities.get(second.pid)?.skinCatalog).toBe('class');
    expect(server.sim.countItem('amber_crimson_armor_plate', first.pid)).toBe(1);
    expect(server.sim.countItem('amber_crimson_armor_plate', second.pid)).toBe(0);
  });

  it('keeps the character-id session index coherent across join, duplicate join, leave, and rejoin', async () => {
    const server = new GameServer();
    const first = expectJoined(server.join(fakeWs(), 11, 101, 'Indexa', 'warrior', null));
    const second = expectJoined(server.join(fakeWs(), 12, 102, 'Indexb', 'warrior', null));

    expect((server as any).sessionByCharacterId(101)).toBe(first);
    expect((server as any).sessionByCharacterId(102)).toBe(second);
    expect(server.join(fakeWs(), 13, 101, 'Indexa', 'warrior', null)).toEqual({
      error: 'character already in world',
    });

    await server.leave(first, 'test');

    expect((server as any).sessionByCharacterId(101)).toBeNull();
    expect((server as any).sessionByCharacterId(102)).toBe(second);

    const rejoined = expectJoined(server.join(fakeWs(), 13, 101, 'Indexa', 'warrior', null));
    expect((server as any).sessionByCharacterId(101)).toBe(rejoined);
  });

  it('blocks a fast relog until the disconnect save releases the character id', async () => {
    const server = new GameServer();
    const first = expectJoined(server.join(fakeWs(), 11, 101, 'Indexa', 'warrior', null));

    let resolveSave!: () => void;
    const slowSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    vi.mocked(saveCharacterAndMarketState).mockImplementationOnce(() => slowSave);

    const leaving = server.leave(first, 'test');
    await vi.waitFor(() => {
      expect(saveCharacterAndMarketState).toHaveBeenCalled();
    });

    expect((server as any).sessionByCharacterId(101)).toBe(first);
    expect(server.join(fakeWs(), 13, 101, 'Indexa', 'warrior', null)).toEqual({
      error: 'character already in world',
    });

    resolveSave();
    await leaving;

    expect((server as any).sessionByCharacterId(101)).toBeNull();
    const rejoined = expectJoined(server.join(fakeWs(), 13, 101, 'Indexa', 'warrior', null));
    expect((server as any).sessionByCharacterId(101)).toBe(rejoined);
  });

  it('retries failed disconnect saves before releasing the character for rejoin', async () => {
    vi.useFakeTimers();
    vi.mocked(saveCharacterAndMarketState).mockReset();
    vi.mocked(saveCharacterAndMarketState)
      .mockRejectedValueOnce(new Error('temporary database outage'))
      .mockRejectedValueOnce(new Error('temporary database outage'))
      .mockResolvedValueOnce(undefined);

    try {
      const server = new GameServer();
      const session = expectJoined(server.join(fakeWs(), 11, 101, 'Indexa', 'warrior', null));
      const leaving = server.leave(session, 'test');

      await vi.waitFor(() => {
        expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1);
      });
      expect(server.join(fakeWs(), 12, 101, 'Indexa', 'warrior', null)).toEqual({
        error: 'character already in world',
      });

      await vi.runOnlyPendingTimersAsync();
      await vi.waitFor(() => {
        expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(2);
      });

      await vi.runOnlyPendingTimersAsync();
      await leaving;

      expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(3);
      expect((server as any).sessionByCharacterId(101)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes overlapping saves for one character so an older write cannot land last', async () => {
    vi.mocked(saveCharacterState).mockReset();
    vi.mocked(saveCharacterState).mockResolvedValue(undefined);

    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Saverace', 'warrior', null));

    let resolveFirstSave!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve;
    });
    vi.mocked(saveCharacterState).mockImplementationOnce(() => firstSave);

    const first = server.saveCharacter(session);
    await vi.waitFor(() => {
      expect(saveCharacterState).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(saveCharacterState).mock.calls[0][2].questsDone).not.toContain('q_wolves');

    server.sim.meta(session.pid)!.questsDone.add('q_wolves');
    const second = server.saveCharacter(session);
    await Promise.resolve();
    expect(saveCharacterState).toHaveBeenCalledTimes(1);

    resolveFirstSave();
    await first;
    await second;

    expect(saveCharacterState).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveCharacterState).mock.calls[1][2].questsDone).toContain('q_wolves');
  });

  it('closes the play session even when the open insert lands after the player has left', async () => {
    openPlaySession.mockReset();
    closePlaySession.mockReset();
    closePlaySession.mockResolvedValue(undefined);

    // Defer the openPlaySession insert so the player can disconnect first.
    let resolveOpen!: (id: number) => void;
    openPlaySession.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 21, 201, 'Racer', 'warrior', null));
    expect(session.dbSessionId).toBeNull();

    // Player disconnects before the insert resolves: leave() sees a null id.
    await server.leave(session, 'test');
    expect(closePlaySession).not.toHaveBeenCalled();

    // The insert finally lands; the late callback must close the orphaned row.
    resolveOpen(99);
    await Promise.resolve();
    await Promise.resolve();
    expect(closePlaySession).toHaveBeenCalledWith(99);
  });

  it('allows two ONLINE characters per account, and lets the account back in once one leaves', async () => {
    const server = new GameServer();
    const a = expectJoined(server.join(fakeWs(), 20, 201, 'Aone', 'warrior', null));
    const a2 = expectJoined(server.join(fakeWs(), 20, 202, 'Atwo', 'mage', null));

    expect((server as any).sessionByCharacterId(202)).toBe(a2);

    // same account, a third character is rejected while two are online
    expect(server.join(fakeWs(), 20, 204, 'Athree', 'rogue', null)).toEqual({
      error: 'too many characters on this account are already in the world',
    });

    // a different account is unaffected
    const b = expectJoined(server.join(fakeWs(), 21, 203, 'Bone', 'priest', null));
    expect((server as any).sessionByCharacterId(203)).toBe(b);

    // once one of the account's online characters leaves, another of its characters may join
    await server.leave(a, 'test');
    const a3 = expectJoined(server.join(fakeWs(), 20, 204, 'Athree', 'rogue', null));
    expect((server as any).sessionByCharacterId(204)).toBe(a3);
  });

  it('exempts GM characters from the per-account session cap (for supervision)', () => {
    const server = new GameServer();
    expectJoined(server.join(fakeWs(), 30, 301, 'Gmaa', 'warrior', null));
    expectJoined(server.join(fakeWs(), 30, 302, 'Gmbb', 'warrior', null));
    // a third character on the same account joins because it is flagged GM
    expectJoined(server.join(fakeWs(), 30, 303, 'Gmcc', 'warrior', null, true));
    expect((server as any).sessionByCharacterId(303)).not.toBeNull();
  });

  // The per-IP session count backs the hard connection cap (countIpSessions in
  // main.ts). It is bookkeeping no other test now drives, so pin it directly.
  it('tracks per-IP session counts across join/leave and deletes the entry at zero', async () => {
    vi.mocked(saveCharacterState).mockResolvedValue(undefined);
    const server = new GameServer();
    const ip = '203.0.113.7';
    expect(server.countIpSessions(ip)).toBe(0);

    const a = expectJoined(server.join(fakeWs(), 41, 401, 'Ipone', 'warrior', null, false, { ip }));
    expect(server.countIpSessions(ip)).toBe(1);
    const b = expectJoined(server.join(fakeWs(), 42, 402, 'Iptwo', 'mage', null, false, { ip }));
    expect(server.countIpSessions(ip)).toBe(2);

    await server.leave(a, 'test');
    expect(server.countIpSessions(ip)).toBe(1);
    expect((server as any).ipSessionCounts.has(ip)).toBe(true);

    await server.leave(b, 'test');
    expect(server.countIpSessions(ip)).toBe(0);
    // deleted at zero so a churning IP cannot leak map entries
    expect((server as any).ipSessionCounts.has(ip)).toBe(false);
  });

  it('decrements a per-IP count only once when leave runs twice (kick then socket close)', async () => {
    // A kick that both closes the socket and calls leave() must not
    // double-decrement, or the count would drift below the live total and
    // weaken the hard cap. leave() is guarded by session.left, so it is idempotent.
    vi.mocked(saveCharacterState).mockResolvedValue(undefined);
    const server = new GameServer();
    const ip = '203.0.113.8';
    const a = expectJoined(
      server.join(fakeWs(), 43, 403, 'Ipsolo', 'warrior', null, false, { ip }),
    );
    const b = expectJoined(server.join(fakeWs(), 44, 404, 'Ipkick', 'rogue', null, false, { ip }));
    expect(server.countIpSessions(ip)).toBe(2);

    await server.leave(b, 'kick');
    await server.leave(b, 'socket close'); // second call is a no-op
    expect(server.countIpSessions(ip)).toBe(1);

    await server.leave(a, 'test');
    expect(server.countIpSessions(ip)).toBe(0);
  });

  it('keeps per-IP session counts independent across different IPs', async () => {
    vi.mocked(saveCharacterState).mockResolvedValue(undefined);
    const server = new GameServer();
    const ip1 = '198.51.100.1';
    const ip2 = '198.51.100.2';
    const a = expectJoined(
      server.join(fakeWs(), 45, 405, 'Neta', 'warrior', null, false, { ip: ip1 }),
    );
    expectJoined(server.join(fakeWs(), 46, 406, 'Netb', 'mage', null, false, { ip: ip2 }));
    expect(server.countIpSessions(ip1)).toBe(1);
    expect(server.countIpSessions(ip2)).toBe(1);

    await server.leave(a, 'test');
    expect(server.countIpSessions(ip1)).toBe(0);
    expect(server.countIpSessions(ip2)).toBe(1);
  });

  it('takeOverCharacter frees a live session and lets the same character re-join', async () => {
    vi.mocked(saveCharacterState).mockResolvedValue(undefined);
    const server = new GameServer();
    const ws = fakeWs();
    expectJoined(server.join(ws, 70, 700, 'Takeoverme', 'warrior', null));
    // A second join for the same character is rejected while it is online.
    expect(server.join(fakeWs(), 70, 700, 'Takeoverme', 'warrior', null)).toEqual({
      error: 'character already in world',
    });

    const result = await server.takeOverCharacter(70, 700);
    expect(result).toBe('taken-over');
    expect(ws.close).toHaveBeenCalled();
    // Slot is freed: the character can now enter the world again.
    expectJoined(server.join(fakeWs(), 70, 700, 'Takeoverme', 'warrior', null));
  });

  it('takeOverCharacter is a no-op when the character is offline', async () => {
    const server = new GameServer();
    expect(await server.takeOverCharacter(71, 710)).toBe('not-online');
  });

  it('takeOverCharacter refuses to disconnect a session owned by another account', async () => {
    vi.mocked(saveCharacterState).mockResolvedValue(undefined);
    const server = new GameServer();
    const ws = fakeWs();
    expectJoined(server.join(ws, 80, 800, 'Owned', 'mage', null));
    // A different account must never be able to kick this session.
    expect(await server.takeOverCharacter(81, 800)).toBe('not-online');
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('an anti-bot kick notifies the client and closes the socket so the player can rejoin', async () => {
    // Regression: the anti-bot kick used to call leave() WITHOUT sending an error
    // frame or closing the socket (unlike disconnectAccount/takeOverCharacter).
    // The character was removed from the world but the client stayed wedged
    // "connected" — no onclose/error fired, so the app never returned to
    // character select and the player could not rejoin.
    vi.mocked(saveCharacterState).mockResolvedValue(undefined);
    const server = new GameServer();
    const ws = fakeWs();
    expectJoined(server.join(ws, 90, 900, 'Imdutha', 'warrior', null));

    // Force the bot detector to kick on the next anti-bot tick.
    (server as any).botDetector = {
      ...(server as any).botDetector,
      handleTick: () => 'kick',
      releaseTrackingContext: () => {},
    };
    (server as any).runAntibotTick();
    await vi.waitFor(() => {
      expect((server as any).sessionByCharacterId(900)).toBeNull();
    });

    // The client is told why and the socket is torn down (mirrors the other
    // kick paths), so net/online.ts surfaces the disconnect and the app can
    // return to character select.
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ t: 'error', error: 'rejected by server' }),
    );
    expect(ws.close).toHaveBeenCalled();

    // The character slot is freed: the same character can enter the world again.
    expectJoined(server.join(fakeWs(), 90, 900, 'Imdutha', 'warrior', null));
  });
});
