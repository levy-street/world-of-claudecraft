import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
}));

import { GameServer, type ClientSession } from '../server/game';

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

  it('uses the durable character id for online market listings', () => {
    const server = new GameServer();
    server.sim.loadMarket({
      listings: [
        { id: 50, sellerKey: 'Seller', sellerName: 'Seller', itemId: 'bone_fragments', count: 1, price: 75, secondsLeft: 60 },
      ],
      collections: [
        { key: 'Seller', copper: 25, items: [{ itemId: 'wolf_fang', count: 2 }] },
      ],
      nextListingId: 51,
    });
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Seller', 'warrior', null));
    const merchant = [...server.sim.entities.values()].find((e) => e.templateId === 'the_merchant')!;
    const player = server.sim.entities.get(session.pid)!;
    player.pos = { ...merchant.pos };
    player.prevPos = { ...player.pos };

    expect(server.sim.players.get(session.pid)?.marketKey).toBe('character:101');
    expect(server.sim.marketListings.find((l) => l.id === 50)).toMatchObject({
      sellerKey: 'character:101',
      sellerName: 'Seller',
    });
    expect(server.sim.marketInfoFor(session.pid)?.collectionCopper).toBe(25);
    server.sim.addItem('wolf_fang', 1, session.pid);
    server.sim.marketList('wolf_fang', 1, 100, session.pid);

    expect(server.sim.marketListings.find((l) => l.sellerKey === 'character:101' && l.itemId === 'wolf_fang')).toMatchObject({
      sellerName: 'Seller',
      itemId: 'wolf_fang',
      count: 1,
    });
  });
});
