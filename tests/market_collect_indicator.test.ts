// The World Market collect indicator wire round-trip (the mailU pattern): the
// lightweight `mktU` self-snapshot bit streams ALWAYS (independent of Merchant
// proximity, unlike the full `market` payload) and mirrors onto
// ClientWorld.marketCollectPending. Sale -> streamed true -> collect ->
// streamed false, through the REAL server dispatch + snapshot encode and the
// real ClientWorld decode.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; wire/dispatch logic is under test.
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
  loadAccountFlair: vi.fn(async () => null),
}));

import { type ClientSession, GameServer } from '../server/game';
import type { PlayerClass } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

const hudSrc = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null, false, {});
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

function cmd(server: GameServer, session: ClientSession, payload: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...payload }));
}

function standAtMerchant(server: GameServer, pid: number): void {
  const sim = (server as any).sim;
  const merchant = sim.entities.get(sim.market.merchantIds[0]);
  const e = sim.entities.get(pid);
  e.pos = { ...merchant.pos };
  e.prevPos = { ...e.pos };
}

describe('market collect indicator wire round-trip (mktU)', () => {
  it('streams true after a sale (even away from the Merchant) and false after collecting', () => {
    const server = new GameServer();
    const sellerWs = fakeWs();
    const buyerWs = fakeWs();
    const seller = joinServer(server, sellerWs, 1, 'Seller');
    const buyer = joinServer(server, buyerWs, 2, 'Buyer', 'mage');
    const sim = (server as any).sim;
    standAtMerchant(server, seller.pid);
    standAtMerchant(server, buyer.pid);
    sim.addItem('wolf_fang', 1, seller.pid);
    sim.players.get(buyer.pid).copper = 500;

    // nothing waits yet: the first snapshot carries the bit as 0 and the
    // client mirror stays false
    broadcast(server);
    const client = bareClient(seller.pid);
    const before = lastSnap(sellerWs.sent);
    expect(before.self.mktU).toBe(0);
    (client as any).applySnapshot(before);
    expect(client.marketCollectPending).toBe(false);

    cmd(server, seller, { cmd: 'market_list', item: 'wolf_fang', count: 1, price: 200 });
    const listing = sim.marketListings.find((l: any) => !l.house && l.itemId === 'wolf_fang');
    expect(listing).toBeTruthy();

    // the seller walks far from the Merchant BEFORE the sale is broadcast: the
    // full market payload must drop off the wire while mktU still streams
    const e = sim.entities.get(seller.pid);
    e.pos = { ...e.pos, x: e.pos.x + 500, z: e.pos.z + 500 };
    e.prevPos = { ...e.pos };
    cmd(server, buyer, { cmd: 'market_buy', id: listing.id });

    sellerWs.sent.length = 0;
    broadcast(server);
    const sold = lastSnap(sellerWs.sent);
    expect(sold.self.mktU).toBe(1);
    expect(sold.self.market ?? null).toBeNull(); // full data still proximity-gated
    (client as any).applySnapshot(sold);
    expect(client.marketCollectPending).toBe(true);

    // back at the Merchant, collecting clears the bit on the next snapshot
    standAtMerchant(server, seller.pid);
    cmd(server, seller, { cmd: 'market_collect' });
    expect(sim.players.get(seller.pid).copper).toBe(190); // 200 less the 5% cut
    sellerWs.sent.length = 0;
    broadcast(server);
    const collected = lastSnap(sellerWs.sent);
    expect(collected.self.mktU).toBe(0);
    (client as any).applySnapshot(collected);
    expect(client.marketCollectPending).toBe(false);
  });
});

// Both game entries carry their own copy of the minimap cluster markup (the
// offline index.html and the online play.html); the badge must exist in BOTH
// or one host silently loses the indicator (there is no shared-markup guard).
describe('market collect indicator markup parity', () => {
  it('ships #market-indicator in both game entries', () => {
    for (const entry of ['index.html', 'play.html']) {
      const html = readFileSync(new URL(`../${entry}`, import.meta.url), 'utf8');
      expect(html, `${entry} is missing the badge`).toContain('id="market-indicator"');
      expect(html, `${entry} badge lost its icon`).toContain('data-icon="market"');
      expect(html, `${entry} badge lost its localized tooltip`).toContain(
        'data-i18n-title="hudChrome.marketIndicator.tip"',
      );
      expect(html, `${entry} badge gained visible text that can disturb the minimap`).toMatch(
        /<button id="market-indicator"[^>]*><\/button>/,
      );
    }
  });

  it('wires the shared HUD tooltip on hover and keyboard focus', () => {
    const initStart = hudSrc.indexOf('private initMarketIndicator(): void');
    expect(initStart).toBeGreaterThanOrEqual(0);
    const initEnd = hudSrc.indexOf('\n  // The World Market coin by the minimap', initStart);
    expect(initEnd).toBeGreaterThan(initStart);
    const initBody = hudSrc.slice(initStart, initEnd);
    expect(initBody).toMatch(/this\.attachTooltip\(\s*el,/);
    expect(initBody).toContain("t('hudChrome.marketIndicator.tip')");
  });
});
