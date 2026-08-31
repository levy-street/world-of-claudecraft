import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
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
import { encodeMarketLocalizedItemMask, type MarketQuery } from '../src/sim/market_query';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import type { MarketInfo } from '../src/world_api';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

function standAtMerchant(sim: Sim, pid: number): void {
  const merchant = [...sim.entities.values()].find(
    (entity) => entity.templateId === 'the_merchant',
  );
  const player = sim.entities.get(pid);
  if (!merchant || !player) throw new Error('missing player or Merchant');
  player.pos.x = merchant.pos.x;
  player.pos.z = merchant.pos.z;
  player.pos.y = groundHeight(player.pos.x, player.pos.z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
}

function installBook(sim: Sim): void {
  const book = sim.market.marketListings;
  book.length = 0;
  for (let i = 0; i < 55; i++) {
    book.push({
      id: 1000 + i,
      sellerKey: 'match',
      sellerName: 'Match',
      itemId: 'bone_fragments',
      count: 1,
      price: 100 + i,
      expiresAt: Number.POSITIVE_INFINITY,
      house: false,
    });
  }
  for (let i = 0; i < 10; i++) {
    book.push({
      id: 2000 + i,
      sellerKey: 'distractor',
      sellerName: 'Distractor',
      itemId: 'ashwood_log',
      count: 1,
      price: 100 + i,
      expiresAt: Number.POSITIVE_INFINITY,
      house: false,
    });
  }
}

function projection(info: MarketInfo | null): unknown {
  if (!info) throw new Error('missing market projection');
  return {
    ids: info.listings.map((listing) => listing.itemId),
    totalCount: info.totalCount,
    page: info.page,
    pageCount: info.pageCount,
  };
}

describe('localized World Market search host parity', () => {
  it('returns the same authoritative localized page offline and online', () => {
    const localizedItemMask = encodeMarketLocalizedItemMask(['bone_fragments']);
    const query: MarketQuery = {
      search: 'fragmentos',
      localizedItemMask,
      itemType: 'all',
      subtype: 'all',
      armorClass: 'all',
      primaryStat: 'all',
      rarity: 'all',
      sort: 'name',
      page: 1,
      collapseLowest: false,
    };

    const offline = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const offlinePid = offline.addPlayer('warrior', 'Browser');
    standAtMerchant(offline, offlinePid);
    installBook(offline);
    offline.marketSearch(query, offlinePid);

    const server = new GameServer();
    const socket = fakeWs();
    const session = joinServer(server, socket, 71, 'Browser');
    standAtMerchant(server.sim, session.pid);
    installBook(server.sim);
    server.handleMessage(
      session,
      JSON.stringify({
        t: 'cmd',
        cmd: 'market_search',
        q: query.search,
        localizedItemMask: query.localizedItemMask,
        itemType: query.itemType,
        subtype: query.subtype,
        armorClass: query.armorClass,
        primaryStat: query.primaryStat,
        rarity: query.rarity,
        sort: query.sort,
        page: query.page,
        collapseLowest: query.collapseLowest,
      }),
    );
    broadcast(server);
    const client = bareClient(session.pid);
    (client as unknown as { applySnapshot(snapshot: unknown): void }).applySnapshot(
      lastSnap(socket.sent),
    );

    expect(projection(client.marketInfo)).toEqual(projection(offline.marketInfoFor(offlinePid)));
    expect(client.marketInfo?.listings).toHaveLength(5);
    expect(
      client.marketInfo?.listings.every((listing) => listing.itemId === 'bone_fragments'),
    ).toBe(true);
  });
});
