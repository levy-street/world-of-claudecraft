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
      }),
    );

    expect(server.sim.players.get(joined.pid)?.marketQuery).toEqual({
      search: 'robe',
      itemType: 'armor',
      subtype: 'chest',
      armorClass: 'cloth',
      primaryStat: 'int',
      rarity: 'rare',
      page: 2,
    });
  });
});
