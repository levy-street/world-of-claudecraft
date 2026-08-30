import { describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';

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

import { GameServer } from '../server/game';

describe('GameServer market query wire', () => {
  it('decodes armor class and primary stat before storing the session query', () => {
    const server = new GameServer();
    const ws = {
      readyState: 1,
      send: () => undefined,
    } as unknown as WebSocket;
    const joined = server.join(ws, 1, 1, 'Buyer', 'warrior', null);
    if ('error' in joined) throw new Error(joined.error);
    joined.blockListLoaded = true;

    server.handleMessage(
      joined,
      JSON.stringify({
        t: 'cmd',
        cmd: 'market_search',
        q: 'robe',
        itemType: 'armor',
        subtype: 'chest',
        armorClass: 'cloth',
        primaryStat: 'int',
        rarity: 'rare',
        page: 2,
        collapseLowest: true,
      }),
    );

    expect(server.sim.players.get(joined.pid)?.marketQuery).toEqual({
      search: 'robe',
      itemType: 'armor',
      subtype: 'chest',
      armorClass: 'cloth',
      primaryStat: 'int',
      rarity: 'rare',
      sort: 'name',
      page: 2,
      collapseLowest: true,
    });
  });

  it('decodes the price sort axis (issue #3102)', () => {
    const server = new GameServer();
    const ws = {
      readyState: 1,
      send: () => undefined,
    } as unknown as WebSocket;
    const joined = server.join(ws, 1, 1, 'Buyer', 'warrior', null);
    if ('error' in joined) throw new Error(joined.error);
    joined.blockListLoaded = true;

    server.handleMessage(
      joined,
      JSON.stringify({
        t: 'cmd',
        cmd: 'market_search',
        q: '',
        sort: 'price',
        page: 0,
      }),
    );

    expect(server.sim.players.get(joined.pid)?.marketQuery).toEqual({
      search: '',
      itemType: 'all',
      subtype: 'all',
      armorClass: 'all',
      primaryStat: 'all',
      rarity: 'all',
      sort: 'price',
      page: 0,
      collapseLowest: false,
    });
  });

  it('falls back to the classic name sort on an invalid value', () => {
    const server = new GameServer();
    const ws = {
      readyState: 1,
      send: () => undefined,
    } as unknown as WebSocket;
    const joined = server.join(ws, 1, 1, 'Buyer', 'warrior', null);
    if ('error' in joined) throw new Error(joined.error);
    joined.blockListLoaded = true;

    server.handleMessage(
      joined,
      JSON.stringify({
        t: 'cmd',
        cmd: 'market_search',
        q: '',
        sort: 'bogus',
        page: 0,
      }),
    );

    expect(server.sim.players.get(joined.pid)?.marketQuery?.sort).toBe('name');
  });

  // Issue #3103: a boolean field coerces by strict identity (raw?.collapseLowest === true
  // in sanitizeMarketQuery), unlike the enum axes above which fall back through a closed
  // options list. Pin both a client that never sends it (an old build) and one that sends
  // a truthy-but-not-true value, so neither can silently collapse the market book.
  it('defaults collapseLowest to false when the client omits or malforms it', () => {
    const server = new GameServer();
    const ws = { readyState: 1, send: () => undefined } as unknown as WebSocket;
    const joined = server.join(ws, 1, 1, 'Buyer', 'warrior', null);
    if ('error' in joined) throw new Error(joined.error);
    joined.blockListLoaded = true;

    server.handleMessage(
      joined,
      JSON.stringify({ t: 'cmd', cmd: 'market_search', q: '', page: 0 }),
    );
    expect(server.sim.players.get(joined.pid)?.marketQuery.collapseLowest).toBe(false);

    server.handleMessage(
      joined,
      JSON.stringify({
        t: 'cmd',
        cmd: 'market_search',
        q: 'a',
        page: 0,
        collapseLowest: 1,
      }),
    );
    expect(server.sim.players.get(joined.pid)?.marketQuery.collapseLowest).toBe(false);
  });
});
