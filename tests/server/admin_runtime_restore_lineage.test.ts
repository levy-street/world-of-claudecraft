// The GM item restore's lost-copy link over a REAL GameServer and sim (the
// tests/server/admin_runtime_restore.test.ts rig): adminRestoreItem passes
// derivedFrom into the grant hub, so the restored tracked copy is a NEW guid
// labelled `restore` whose provenance names the lost copy it replaces.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => true),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => ({ listings: [], collections: new Map() })),
  saveMarketState: vi.fn(async () => {}),
  loadMailState: vi.fn(async () => ({})),
  saveMailState: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import * as db from '../../server/db';
import { type ClientSession, GameServer } from '../../server/game';
import { isItemGuid } from '../../src/sim/item_provenance';

const LOST = '9b2e7c1a-5d34-4f6e-8a1b-2c3d4e5f6071';
const EPIC = 'duskforged_warblade';

function join(server: GameServer, characterId: number, name: string): ClientSession {
  const ws = { readyState: 1, send: () => {} };
  // biome-ignore lint/suspicious/noExplicitAny: the fake socket is structural.
  const session = server.join(ws as any, characterId, characterId, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function epicSlots(server: GameServer, pid: number) {
  return (server.sim.meta(pid)?.inventory ?? []).filter((s) => s.itemId === EPIC);
}

describe('adminRestoreItem lineage over the real grant hub', () => {
  let server: GameServer;

  beforeEach(() => {
    server = new GameServer();
    vi.clearAllMocks();
    (db.pool.query as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ rows: [] }));
  });

  it('mints the restored copy as a derive of the named lost copy', () => {
    const session = join(server, 301, 'Restoree');
    server.sim.drainEvents();
    expect(server.adminRestoreItem(301, EPIC, 1, LOST)).toBe('ok');
    const [slot] = epicSlots(server, session.pid);
    expect(isItemGuid(slot?.instance?.guid)).toBe(true);
    expect(slot?.instance?.guid).not.toBe(LOST);
    expect(slot?.instance?.provenance).toMatchObject({ source: 'restore', derivedFrom: LOST });
    const tracked = server.sim
      .drainEvents()
      .filter((e) => e.type === 'itemTracked' && e.itemId === EPIC);
    expect(tracked).toEqual([
      expect.objectContaining({ kind: 'derive', relatedGuid: LOST, source: 'restore' }),
    ]);
  });

  it('a restore that names no lost copy is a plain restore mint', () => {
    const session = join(server, 302, 'Plainrest');
    server.sim.drainEvents();
    expect(server.adminRestoreItem(302, EPIC, 1)).toBe('ok');
    const [slot] = epicSlots(server, session.pid);
    expect(slot?.instance?.provenance?.source).toBe('restore');
    expect(slot?.instance?.provenance?.derivedFrom).toBeUndefined();
    const tracked = server.sim
      .drainEvents()
      .filter((e) => e.type === 'itemTracked' && e.itemId === EPIC);
    expect(tracked).toEqual([expect.objectContaining({ kind: 'mint', source: 'restore' })]);
  });
});
