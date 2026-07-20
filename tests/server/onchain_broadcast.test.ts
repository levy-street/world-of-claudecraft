import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; only the chat broadcast is under test.
vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { GameServer } from '../../server/game';

interface FakeClient {
  sent: Array<{ t: string; list?: Array<{ type: string; text: string; color?: string }> }>;
  ws: { readyState: number; send: (p: string) => void };
}

function fakeWs(): FakeClient {
  const sent: FakeClient['sent'] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function logEvents(
  sent: FakeClient['sent'],
): Array<{ type: string; text: string; color?: string }> {
  return sent
    .filter((m) => m.t === 'events')
    .flatMap((m) => m.list ?? [])
    .filter((e) => e.type === 'log');
}

describe('GameServer.announceOnchain broadcasts to realm chat', () => {
  it('delivers the line to every connected client as a yellow system log', () => {
    const server = new GameServer();
    const a = fakeWs();
    const b = fakeWs();
    const sa = server.join(a.ws as never, 1, 1, 'Alice', 'warrior', null, false, {});
    const sb = server.join(b.ws as never, 2, 2, 'Bob', 'mage', null, false, {});
    if ('error' in sa) throw new Error(sa.error);
    if ('error' in sb) throw new Error(sb.error);
    a.sent.length = 0;
    b.sent.length = 0;

    const line = '[WOC] Burned 25,000 WOC ($4.38). Total burned 442,072 WOC.';
    server.announceOnchain(line);

    for (const client of [a, b]) {
      const logs = logEvents(client.sent);
      const hit = logs.find((e) => e.text === line);
      expect(
        hit,
        `client did not receive the announcement: ${JSON.stringify(client.sent)}`,
      ).toBeTruthy();
      expect(hit?.color).toBe('#ffd100'); // the system-notice yellow
    }
  });
});
