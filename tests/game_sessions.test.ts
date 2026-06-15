import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveEconomyState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  saveMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
}));

import { GameServer, type ClientSession } from '../server/game';
import { saveCharacterState, saveEconomyState, saveMarketState } from '../server/db';

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

function command(cmd: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ t: 'cmd', cmd, ...extra });
}

function teleport(server: GameServer, pid: number, x: number, z: number): void {
  const e = server.sim.entities.get(pid);
  if (!e) throw new Error('missing entity');
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, server.sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function merchant(server: GameServer): Entity {
  for (const e of server.sim.entities.values()) if (e.templateId === 'the_merchant') return e;
  throw new Error('the Merchant was not spawned');
}

function standAtMerchant(server: GameServer, pid: number): void {
  const m = merchant(server);
  teleport(server, pid, m.pos.x, m.pos.z);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GameServer sessions', () => {
  it('serializes overlapping saves for the same character', async () => {
    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Saver', 'warrior', null));
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(saveCharacterState).mockImplementationOnce(async () => {
      await firstStarted;
    });

    const firstSave = server.saveCharacter(session);
    await vi.waitFor(() => expect(saveCharacterState).toHaveBeenCalledTimes(1));

    const meta = server.sim.meta(session.pid);
    if (!meta) throw new Error('missing player meta');
    meta.copper += 37;
    const secondSave = server.saveCharacter(session);

    await Promise.resolve();
    expect(saveCharacterState).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([firstSave, secondSave]);

    expect(saveCharacterState).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveCharacterState).mock.calls[1][2].copper).toBe(meta.copper);
  });

  it('serializes overlapping market saves', async () => {
    const server = new GameServer();
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(saveMarketState).mockImplementationOnce(async () => {
      await firstStarted;
    });

    const firstSave = server.saveMarket();
    await vi.waitFor(() => expect(saveMarketState).toHaveBeenCalledTimes(1));
    const secondSave = server.saveMarket();

    await Promise.resolve();
    expect(saveMarketState).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([firstSave, secondSave]);

    expect(saveMarketState).toHaveBeenCalledTimes(2);
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

  it('persists completed trades as one economy transaction with both characters', async () => {
    const server = new GameServer();
    const a = expectJoined(server.join(fakeWs(), 11, 101, 'Tradera', 'warrior', null));
    const b = expectJoined(server.join(fakeWs(), 12, 102, 'Traderb', 'mage', null));
    teleport(server, a.pid, 0, -40);
    teleport(server, b.pid, 3, -40);
    server.sim.addItem('wolf_fang', 2, a.pid);
    server.sim.addItem('baked_bread', 1, b.pid);
    server.sim.meta(a.pid)!.copper = 100;
    server.sim.meta(b.pid)!.copper = 50;

    server.handleMessage(a, command('trade_req', { id: b.pid }));
    server.handleMessage(b, command('trade_accept'));
    server.handleMessage(a, command('trade_offer', { items: [{ itemId: 'wolf_fang', count: 2 }], copper: 30 }));
    server.handleMessage(b, command('trade_offer', { items: [{ itemId: 'baked_bread', count: 1 }], copper: 10 }));
    server.handleMessage(a, command('trade_confirm'));
    expect(saveEconomyState).not.toHaveBeenCalled();

    server.handleMessage(b, command('trade_confirm'));
    await vi.waitFor(() => expect(saveEconomyState).toHaveBeenCalledTimes(1));

    const [characters, market] = vi.mocked(saveEconomyState).mock.calls[0];
    expect(characters.map((c) => c.characterId).sort((x, y) => x - y)).toEqual([101, 102]);
    expect(characters.find((c) => c.characterId === 101)?.state.copper).toBe(80);
    expect(characters.find((c) => c.characterId === 102)?.state.copper).toBe(70);
    expect(market).toBeNull();
  });

  it('does not persist a completed trade when one character snapshot is missing', async () => {
    const server = new GameServer();
    const a = expectJoined(server.join(fakeWs(), 11, 101, 'Tradera', 'warrior', null));
    const b = expectJoined(server.join(fakeWs(), 12, 102, 'Traderb', 'mage', null));
    teleport(server, a.pid, 0, -40);
    teleport(server, b.pid, 3, -40);
    server.sim.addItem('wolf_fang', 1, a.pid);

    server.handleMessage(a, command('trade_req', { id: b.pid }));
    server.handleMessage(b, command('trade_accept'));
    server.handleMessage(a, command('trade_offer', { items: [{ itemId: 'wolf_fang', count: 1 }], copper: 0 }));
    server.handleMessage(a, command('trade_confirm'));
    server.clients.delete(b.pid);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      server.handleMessage(b, command('trade_confirm'));
      await Promise.resolve();
    } finally {
      consoleError.mockRestore();
    }

    expect(saveEconomyState).not.toHaveBeenCalled();
  });

  it('cancels trade confirmation before mutation when the peer session is missing', async () => {
    const server = new GameServer();
    const a = expectJoined(server.join(fakeWs(), 11, 101, 'Tradera', 'warrior', null));
    const b = expectJoined(server.join(fakeWs(), 12, 102, 'Traderb', 'mage', null));
    teleport(server, a.pid, 0, -40);
    teleport(server, b.pid, 3, -40);
    server.sim.addItem('wolf_fang', 1, a.pid);

    server.handleMessage(a, command('trade_req', { id: b.pid }));
    server.handleMessage(b, command('trade_accept'));
    server.handleMessage(a, command('trade_offer', { items: [{ itemId: 'wolf_fang', count: 1 }], copper: 0 }));
    server.handleMessage(b, command('trade_confirm'));
    server.clients.delete(b.pid);

    server.handleMessage(a, command('trade_confirm'));
    await Promise.resolve();

    expect(saveEconomyState).not.toHaveBeenCalled();
    expect(server.sim.tradeFor(a.pid)).toBeNull();
    expect(server.sim.countItem('wolf_fang', a.pid)).toBe(1);
  });

  it('persists successful market listings with seller state and market state', async () => {
    const server = new GameServer();
    const seller = expectJoined(server.join(fakeWs(), 11, 101, 'Seller', 'warrior', null));
    standAtMerchant(server, seller.pid);
    server.sim.addItem('wolf_fang', 2, seller.pid);

    server.handleMessage(seller, command('market_list', { item: 'wolf_fang', count: 2, price: 100 }));
    await vi.waitFor(() => expect(saveEconomyState).toHaveBeenCalledTimes(1));

    const [characters, market] = vi.mocked(saveEconomyState).mock.calls[0];
    expect(characters.map((c) => c.characterId)).toEqual([101]);
    expect(characters[0].state.inventory).not.toContainEqual({ itemId: 'wolf_fang', count: 2 });
    expect(market?.listings).toHaveLength(1);
    expect(market?.listings[0]).toMatchObject({ sellerKey: 'Seller', itemId: 'wolf_fang', count: 2, price: 100 });
  });

  it('persists player market buys with buyer state and market state', async () => {
    const server = new GameServer();
    const seller = expectJoined(server.join(fakeWs(), 11, 101, 'Seller', 'warrior', null));
    const buyer = expectJoined(server.join(fakeWs(), 12, 102, 'Buyer', 'mage', null));
    standAtMerchant(server, seller.pid);
    standAtMerchant(server, buyer.pid);
    server.sim.addItem('wolf_fang', 1, seller.pid);
    server.sim.meta(buyer.pid)!.copper = 500;
    server.sim.marketList('wolf_fang', 1, 100, seller.pid);
    const listing = server.sim.marketListings.find((l) => l.sellerKey === 'Seller')!;
    vi.mocked(saveEconomyState).mockClear();

    server.handleMessage(buyer, command('market_buy', { id: listing.id }));
    await vi.waitFor(() => expect(saveEconomyState).toHaveBeenCalledTimes(1));

    const [characters, market] = vi.mocked(saveEconomyState).mock.calls[0];
    expect(characters.map((c) => c.characterId)).toEqual([102]);
    expect(characters[0].state.copper).toBe(400);
    expect(characters[0].state.inventory).toContainEqual({ itemId: 'wolf_fang', count: 1 });
    expect(market?.listings).toHaveLength(0);
    expect(market?.collections).toContainEqual({ key: 'Seller', copper: 95, items: [] });
  });

  it('does not persist a market mutation when the acting character snapshot is missing', async () => {
    const server = new GameServer();
    const seller = expectJoined(server.join(fakeWs(), 11, 101, 'Seller', 'warrior', null));
    standAtMerchant(server, seller.pid);
    server.sim.addItem('wolf_fang', 1, seller.pid);
    server.clients.delete(seller.pid);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      server.handleMessage(seller, command('market_list', { item: 'wolf_fang', count: 1, price: 100 }));
      await Promise.resolve();
    } finally {
      consoleError.mockRestore();
    }

    expect(saveEconomyState).not.toHaveBeenCalled();
  });

  it('persists market cleanup when a listing references missing item content', async () => {
    const server = new GameServer();
    const buyer = expectJoined(server.join(fakeWs(), 12, 102, 'Buyer', 'mage', null));
    standAtMerchant(server, buyer.pid);
    server.sim.marketListings.push({
      id: 999,
      sellerKey: 'Seller',
      sellerName: 'Seller',
      itemId: 'missing_item',
      count: 1,
      price: 100,
      expiresAt: server.sim.time + 100,
      house: false,
    });

    server.handleMessage(buyer, command('market_buy', { id: 999 }));
    await vi.waitFor(() => expect(saveEconomyState).toHaveBeenCalledTimes(1));

    const [characters, market] = vi.mocked(saveEconomyState).mock.calls[0];
    expect(characters).toEqual([]);
    expect(market?.listings.some((l) => l.id === 999)).toBe(false);
  });

  it('does not persist rejected market buys or incomplete trades as economy transfers', async () => {
    const server = new GameServer();
    const seller = expectJoined(server.join(fakeWs(), 11, 101, 'Seller', 'warrior', null));
    const buyer = expectJoined(server.join(fakeWs(), 12, 102, 'Buyer', 'mage', null));
    standAtMerchant(server, seller.pid);
    standAtMerchant(server, buyer.pid);
    server.sim.addItem('wolf_fang', 1, seller.pid);
    server.sim.marketList('wolf_fang', 1, 100, seller.pid);
    const listing = server.sim.marketListings.find((l) => l.sellerKey === 'Seller')!;
    vi.mocked(saveEconomyState).mockClear();

    server.handleMessage(buyer, command('market_buy', { id: listing.id }));
    server.handleMessage(seller, command('trade_req', { id: buyer.pid }));
    server.handleMessage(buyer, command('trade_accept'));
    server.handleMessage(seller, command('trade_confirm'));
    await Promise.resolve();

    expect(saveEconomyState).not.toHaveBeenCalled();
  });
});
