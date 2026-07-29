// The guild bank activity log's SERVER gate and answer frame, driven against a
// REAL GameServer + Sim with the db layer mocked (the guild_stamp_fence /
// guild_bank_persistence idiom).
//
// The gate is the point of the feature's permission model: the log is the
// social check that makes an officer-only bank defensible, and it must be
// exactly as restricted as the bank itself. A MEMBER reading it would be a side
// channel around the officer-only design; an officer NOT being able to read it
// would remove the check. Both arms are pinned, plus the mid-flight demotion
// (the read is awaited, so authority is re-checked at DELIVERY time) and the
// fact that the guild is taken from the server's own membership stamp rather
// than from anything the client sent.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  // biome-ignore lint/suspicious/noExplicitAny: the hoisted double predates its typed impl
  loadGuildBankLogRows: vi.fn(async (..._args: any[]): Promise<unknown[]> => []),
}));

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  GUILD_BANK_ROW_MAX_BYTES: 262144,
  loadGuildBankLogRows: dbMock.loadGuildBankLogRows,
  saveCharacterState: vi.fn(async () => true),
  saveCharacterAndGuildBankState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => true),
  insertBankLedgerRow: vi.fn(async () => {}),
  loadGuildBankRows: vi.fn(async (): Promise<unknown[]> => []),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  releaseCharacterLease: vi.fn(async () => {}),
}));

import { bankLedgerIdle } from '../server/bank_ledger';
import { type ClientSession, GameServer } from '../server/game';
import { resetGuildBankLogCacheForTests } from '../server/guild_bank_log';
import type { Entity } from '../src/sim/types';

const GUILD_ID = 913;
const OTHER_GUILD_ID = 914;
const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'];
const AT = 1_770_000_000_000;

function fakeWs(): { sent: Record<string, unknown>[]; ws: unknown } {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload)),
      close: () => {},
      terminate: () => {},
    },
  };
}

function joinServer(
  server: GameServer,
  characterId: number,
  name: string,
): { session: ClientSession; sent: Record<string, unknown>[] } {
  const fc = fakeWs();
  const session = server.join(fc.ws as never, characterId, characterId, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return { session, sent: fc.sent };
}

// biome-ignore lint/suspicious/noExplicitAny: the tests span the private dispatch seam
const priv = (server: GameServer): any => server as any;

function moveToBanker(server: GameServer, pid: number): void {
  let banker: Entity | null = null;
  for (const e of server.sim.entities.values()) {
    if (e.kind === 'npc' && BANKERS.includes(e.templateId ?? '')) banker = e;
  }
  if (!banker) throw new Error('no banker NPC spawned in the server world');
  const p = server.sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { ...banker.pos };
  p.prevPos = { ...p.pos };
  server.sim.rebucket(p);
}

/** Stand `pid` at a banker with `rank` in GUILD_ID and its book loaded (opened:
 *  rung 0 bought, 24 slots). Everything the bank's own gate needs. */
function stand(
  server: GameServer,
  session: ClientSession,
  rank: 'leader' | 'officer' | 'member',
  guildId = GUILD_ID,
): void {
  moveToBanker(server, session.pid);
  server.sim.setPlayerGuildMembership(session.pid, { guildId, rank });
  server.sim.loadGuildBank(guildId, { treasury: 100_000, inventory: [], purchasedSlots: 24 });
}

/** Re-establish the standing state after an await. The live server keeps
 *  ticking and its join-time social snapshot resolves against the mocked db
 *  with no guild, which CLEARS the membership stamp; re-standing keeps each
 *  step's precondition explicit instead of letting an unrelated async path
 *  decide the outcome. */
function restand(
  server: GameServer,
  session: ClientSession,
  rank: 'leader' | 'officer' | 'member' = 'officer',
): void {
  stand(server, session, rank);
}

const dispatch = (server: GameServer, session: ClientSession) =>
  priv(server).dispatchMessage(
    session,
    { t: 'cmd', cmd: 'guild_bank_log' },
    JSON.stringify({ cmd: 'guild_bank_log' }),
    0,
  );

/** Let the awaited cached read and its send settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const logFrames = (sent: Record<string, unknown>[]) => sent.filter((m) => m.t === 'gbanklog');

beforeEach(() => {
  dbMock.loadGuildBankLogRows.mockClear();
  dbMock.loadGuildBankLogRows.mockResolvedValue([
    {
      id: 5,
      at: AT,
      characterName: 'Kara',
      op: 'withdraw',
      itemId: 'iron_ore',
      count: 3,
      copperDelta: 0,
    },
  ]);
  // A cold cache per test, so one test's warm entry cannot answer the next.
  // minRefreshMs 0 disables the COALESCING FLOOR here on purpose: these tests
  // are about the WIRING (does a real op reach the cache at all), and the floor
  // itself is measured with an injected clock in tests/server/guild_bank_log.
  resetGuildBankLogCacheForTests({ minRefreshMs: 0 });
});

describe('guild_bank_log: the read gate is the BANK gate', () => {
  it('serves an OFFICER standing at a banker', async () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'Offi');
    stand(server, session, 'officer');
    dispatch(server, session);
    await settle();
    const [frame] = logFrames(sent);
    expect(frame?.ok).toBe(true);
    expect(frame?.entries).toEqual([
      { id: 5, at: AT, actor: 'Kara', op: 'withdraw', itemId: 'iron_ore', count: 3, copper: null },
    ]);
  });

  it('serves the LEADER too (leader is inside the officer-plus allowlist)', async () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'Boss');
    stand(server, session, 'leader');
    dispatch(server, session);
    await settle();
    expect(logFrames(sent)[0]?.ok).toBe(true);
  });

  it('serves a plain MEMBER too (the guild-wide read-only view includes the log)', async () => {
    // The decisive arm of the v0.35 widening: the log is the trust surface
    // that lets the whole guild audit its officers, so the same membership
    // gate that streams the read-only bank view serves the history read.
    const server = new GameServer();
    const { session, sent } = joinServer(server, 2, 'Grunt');
    stand(server, session, 'member');
    dispatch(server, session);
    await settle();
    const [frame] = logFrames(sent);
    expect(frame?.ok).toBe(true);
    expect(frame?.entries).toEqual([
      { id: 5, at: AT, actor: 'Kara', op: 'withdraw', itemId: 'iron_ore', count: 3, copper: null },
    ]);
  });

  it('REFUSES an officer standing away from a banker (the proximity half of the gate)', async () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'Offi');
    stand(server, session, 'officer');
    const p = server.sim.entities.get(session.pid);
    if (!p) throw new Error('missing player');
    p.pos = { ...p.pos, x: p.pos.x + 500 };
    server.sim.rebucket(p);
    dispatch(server, session);
    await settle();
    expect(logFrames(sent)[0]?.ok).toBe(false);
  });

  it('REFUSES a player with no guild at all', async () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 3, 'Loner');
    moveToBanker(server, session.pid);
    dispatch(server, session);
    await settle();
    expect(logFrames(sent)[0]?.ok).toBe(false);
    expect(dbMock.loadGuildBankLogRows).not.toHaveBeenCalled();
  });

  it('reads the guild from the SERVER stamp, never from the request', async () => {
    // A client naming a guild would be the obvious escalation; there is no
    // guild field on the wire at all, and the id comes from the membership
    // stamp the server itself wrote.
    const server = new GameServer();
    const { session } = joinServer(server, 1, 'Offi');
    stand(server, session, 'officer');
    priv(server).dispatchMessage(
      session,
      { t: 'cmd', cmd: 'guild_bank_log', guildId: OTHER_GUILD_ID, container_id: OTHER_GUILD_ID },
      '{}',
      0,
    );
    await settle();
    expect(dbMock.loadGuildBankLogRows).toHaveBeenCalledTimes(1);
    expect(dbMock.loadGuildBankLogRows.mock.calls[0][0]).toBe(GUILD_ID);
  });

  it('re-checks authority AFTER the awaited read: a mid-flight guild LEAVE refuses', async () => {
    // The read can share an in-flight query, so a leave, kick, death, or
    // walk-away can land inside that window. The answer must reflect authority
    // at DELIVERY time, not at request time. (A mid-flight DEMOTE no longer
    // refuses: a member holds the membership gate, the next test.)
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'Offi');
    stand(server, session, 'officer');
    let release: (() => void) | undefined;
    dbMock.loadGuildBankLogRows.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );
    dispatch(server, session);
    await settle();
    // Still a full officer at this instant: the ONLY thing that changes below
    // is the membership, so the refusal can only come from the post-await
    // re-check.
    restand(server, session);
    expect(server.sim.guildBankInfoFor(session.pid)).not.toBeNull();
    server.sim.setPlayerGuildMembership(session.pid, null);
    release?.();
    await settle();
    expect(logFrames(sent)[0]).toEqual({ t: 'gbanklog', ok: false });
  });

  it('a mid-flight DEMOTE to member still serves: membership is the gate, not rank', async () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'Offi');
    stand(server, session, 'officer');
    let release: (() => void) | undefined;
    dbMock.loadGuildBankLogRows.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );
    dispatch(server, session);
    await settle();
    restand(server, session);
    server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'member' });
    release?.();
    await settle();
    expect(logFrames(sent)[0]?.ok).toBe(true);
  });

  it('answers a failed read with a refusal rather than leaving the pane loading forever', async () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'Offi');
    stand(server, session, 'officer');
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbMock.loadGuildBankLogRows.mockRejectedValue(new Error('database is down'));
    dispatch(server, session);
    await settle();
    expect(logFrames(sent)[0]).toEqual({ t: 'gbanklog', ok: false });
    errs.mockRestore();
  });

  it('withholds the anomaly ops even when the statement layer hands them over', async () => {
    // Defence in depth: the SQL filters them, and the projection refuses them
    // again, so a loosened statement cannot leak operator forensics to a guild.
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'Offi');
    stand(server, session, 'officer');
    dbMock.loadGuildBankLogRows.mockResolvedValue([
      {
        id: 9,
        at: AT,
        characterName: 'Kara',
        op: 'escrow_deficit',
        itemId: null,
        count: -2,
        copperDelta: -250,
      },
      {
        id: 8,
        at: AT,
        characterName: 'Kara',
        op: 'counterparty_orphan',
        itemId: 'iron_ore',
        count: 1,
        copperDelta: 0,
      },
      {
        id: 7,
        at: AT,
        characterName: 'Kara',
        op: 'deposit',
        itemId: 'iron_ore',
        count: 1,
        copperDelta: 0,
      },
    ]);
    dispatch(server, session);
    await settle();
    const frame = logFrames(sent)[0];
    expect(frame?.ok).toBe(true);
    expect(((frame?.entries ?? []) as { id: number }[]).map((e) => e.id)).toEqual([7]);
  });

  it('shows an operator purge with no actor at all', async () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'Offi');
    stand(server, session, 'officer');
    dbMock.loadGuildBankLogRows.mockResolvedValue([
      {
        id: 11,
        at: AT,
        characterName: 'Carrier',
        op: 'admin_purge',
        itemId: 'cursed_blade',
        count: 1,
        copperDelta: 0,
      },
    ]);
    dispatch(server, session);
    await settle();
    const entries = logFrames(sent)[0]?.entries as { actor: string | null; op: string }[];
    expect(entries[0].op).toBe('admin_purge');
    expect(entries[0].actor).toBeNull();
    // And the carrier's name is nowhere in the frame at all.
    expect(JSON.stringify(logFrames(sent)[0])).not.toContain('Carrier');
  });

  it('a REAL guild bank op busts the cache: the next read sees the new history', async () => {
    // The end-to-end freshness contract. Without the bust wired into the one
    // ledger writer, an officer watching the log would be shown a pre-op
    // history for a whole TTL precisely while somebody was watching for the op,
    // which is the exact failure the log exists to prevent.
    const server = new GameServer();
    const { session, sent } = joinServer(server, 1, 'Offi');
    stand(server, session, 'officer');
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 500_000;

    dispatch(server, session);
    await settle();
    expect(dbMock.loadGuildBankLogRows).toHaveBeenCalledTimes(1);

    // A cached second read costs nothing. (See restand: the live server keeps
    // running across an await, so each step re-states its precondition.)
    restand(server, session);
    dispatch(server, session);
    await settle();
    expect(dbMock.loadGuildBankLogRows).toHaveBeenCalledTimes(1);

    // A real op through the real dispatch path: its ledger write busts the log.
    restand(server, session);
    const meta2 = server.sim.players.get(session.pid);
    if (meta2) meta2.copper = 500_000;
    priv(server).dispatchMessage(
      session,
      { t: 'cmd', cmd: 'guild_bank_deposit_gold', amount: 5_000 },
      '{}',
      0,
    );
    expect(server.sim.guildBankInfoFor(session.pid)?.treasury).toBe(105_000);
    await bankLedgerIdle();
    await settle();
    restand(server, session);
    dispatch(server, session);
    await settle();
    expect(dbMock.loadGuildBankLogRows).toHaveBeenCalledTimes(2);
    expect(logFrames(sent).length).toBe(3);
  });

  it('two officers of the same guild share ONE query', async () => {
    const server = new GameServer();
    const a = joinServer(server, 1, 'Offi');
    const b = joinServer(server, 2, 'Ossi');
    stand(server, a.session, 'officer');
    stand(server, b.session, 'officer');
    dispatch(server, a.session);
    dispatch(server, b.session);
    await settle();
    expect(dbMock.loadGuildBankLogRows).toHaveBeenCalledTimes(1);
    expect(logFrames(a.sent)[0]).toEqual(logFrames(b.sent)[0]);
  });
});
