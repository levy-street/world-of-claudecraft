import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));
vi.mock('../server/ip_block_db', () => ({
  loadActiveBlockedIps: vi.fn(async () => [{ ip: '1.2.3.4', expiresAtMs: null }]),
}));

import { GameServer } from '../server/game';

function fakeWs() {
  let closed = false;
  return {
    get closed() {
      return closed;
    },
    ws: {
      readyState: 1,
      send: () => {},
      close: () => {
        closed = true;
      },
    },
  };
}

function join(server: GameServer, ws: any, id: number, ip: string, isAdmin: boolean) {
  const r = server.join(ws, id, id, `P${id}`, 'warrior', null, false, {
    ip,
    userAgent: '',
    isAdmin,
  });
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('IP-block kicks', () => {
  it('disconnectByIp kicks matching non-admins but skips admins', () => {
    const s = new GameServer();
    const a = fakeWs();
    const admin = fakeWs();
    const other = fakeWs();
    join(s, a.ws, 1, '1.2.3.4', false);
    join(s, admin.ws, 2, '1.2.3.4', true);
    join(s, other.ws, 3, '9.9.9.9', false);
    s.disconnectByIp('1.2.3.4', 'bye');
    expect(a.closed).toBe(true);
    expect(admin.closed).toBe(false);
    expect(other.closed).toBe(false);
    expect(s.clients.size).toBe(2);
  });

  it('disconnectBlockedSessions sweeps now-blocked non-admins, sparing admins', async () => {
    const s = new GameServer();
    const a = fakeWs();
    const admin = fakeWs();
    const safe = fakeWs();
    join(s, a.ws, 1, '1.2.3.4', false);
    join(s, admin.ws, 2, '1.2.3.4', true);
    join(s, safe.ws, 3, '9.9.9.9', false);
    await s.loadBlockedIps();
    s.disconnectBlockedSessions('bye');
    expect(a.closed).toBe(true);
    expect(admin.closed).toBe(false);
    expect(safe.closed).toBe(false);
    expect(s.clients.size).toBe(2);
  });
});
