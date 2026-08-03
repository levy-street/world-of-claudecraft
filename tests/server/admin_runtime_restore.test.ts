// R35 GameServer runtime methods over a REAL sim (the tests/discord_activity_
// professions rig): adminCharacterState's live-session gate, adminRestoreItem
// reaching the real addItem grant hub with the defensive clamp, and
// adminRestoreToolEffectSlot's pass-through, plus the audit-durability save
// both restores force (the stored blob must not lag a committed audit row by
// up to an autosave interval).
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
  walletForAccount: vi.fn(async () => null),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import * as db from '../../server/db';
import { type ClientSession, GameServer } from '../../server/game';
import type { PlayerClass } from '../../src/sim/types';

interface FakeClient {
  sent: unknown[];
  ws: { readyState: number; send: (payload: string) => void };
}

function fakeWs(): FakeClient {
  const sent: unknown[] = [];
  return {
    sent,
    ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) },
  };
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws as any, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function bagCount(server: GameServer, pid: number, itemId: string): number {
  const meta = server.sim.meta(pid);
  return (meta?.inventory ?? [])
    .filter((slot: { itemId: string }) => slot.itemId === itemId)
    .reduce((sum: number, slot: { count: number }) => sum + slot.count, 0);
}

describe('R35 GameServer runtime methods', () => {
  let server: GameServer;

  beforeEach(() => {
    server = new GameServer();
    vi.clearAllMocks();
    (db.pool.query as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ rows: [] }));
  });

  it('adminCharacterState serves a live snapshot and null for anyone else', () => {
    joinServer(server, fakeWs(), 201, 'Live');
    const state = server.adminCharacterState(201);
    expect(state).not.toBeNull();
    // The blob carries progression, not identity (the name lives on the
    // characters row); a fresh serialize reads the live level.
    expect(state?.level).toBe(1);
    expect(server.adminCharacterState(999999)).toBeNull();
    // The cheap predicate the restore pre-checks ride (no serialize).
    expect(server.adminCharacterOnline(201)).toBe(true);
    expect(server.adminCharacterOnline(999999)).toBe(false);
  });

  it('adminRestoreItem grants through the real addItem hub and forces a save', async () => {
    const session = joinServer(server, fakeWs(), 202, 'Restoree');
    expect(bagCount(server, session.pid, 'copper_mining_pick')).toBe(0);
    expect(server.adminRestoreItem(202, 'copper_mining_pick', 2)).toBe('ok');
    expect(bagCount(server, session.pid, 'copper_mining_pick')).toBe(2);
    await flushAsync();
    // The audit-durability save: the mint must not wait for the autosave.
    expect(db.saveCharacterState).toHaveBeenCalled();
  });

  it('adminRestoreItem clamps a hostile count and refuses unknown items and offline targets', () => {
    const session = joinServer(server, fakeWs(), 203, 'Clamped');
    expect(server.adminRestoreItem(203, 'copper_mining_pick', 999)).toBe('ok');
    expect(bagCount(server, session.pid, 'copper_mining_pick')).toBe(20); // the dev_give cap
    expect(server.adminRestoreItem(203, 'copper_mining_pick', Number.NaN)).toBe('ok');
    expect(bagCount(server, session.pid, 'copper_mining_pick')).toBe(21); // NaN clamps to 1
    expect(server.adminRestoreItem(203, 'not_a_real_item', 1)).toBe('invalid_item');
    expect(server.adminRestoreItem(999999, 'copper_mining_pick', 1)).toBe('offline');
  });

  it('a fenced-out forced save logs the restore-specific error, not just the generic warn', async () => {
    // A same-account takeover can rotate the lease nonce so the audited
    // grant's save matches no row: saveCharacter resolves false without
    // throwing, and the restore path must say ITS grant did not persist
    // (the operator already got a 200 and the audit row is committed).
    const session = joinServer(server, fakeWs(), 204, 'Fenced');
    vi.mocked(db.saveCharacterState).mockResolvedValueOnce(false);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(server.adminRestoreItem(204, 'copper_mining_pick', 1)).toBe('ok');
    await flushAsync();
    expect(
      errSpy.mock.calls.some(
        (c) => typeof c[0] === 'string' && c[0].includes('audited grant did not persist'),
      ),
    ).toBe(true);
    errSpy.mockRestore();
    warnSpy.mockRestore();
    void session;
  });

  it('clamps a fraction, a negative, and zero to exactly ONE item each', () => {
    // The NaN case above is the easy half of "every non-integer clamps to 1".
    // A finite fraction is the half that would survive a Math.floor or a
    // Math.round rewrite (2.7 must grant 1, never 2 or 3), and the two
    // out-of-range integers pin the lower clamp arm the same way. Deltas, not
    // totals, so each call is pinned on its own.
    const session = joinServer(server, fakeWs(), 205, 'Fractional');
    for (const count of [2.7, -5, 0]) {
      const before = bagCount(server, session.pid, 'copper_mining_pick');
      expect(server.adminRestoreItem(205, 'copper_mining_pick', count)).toBe('ok');
      expect(bagCount(server, session.pid, 'copper_mining_pick') - before).toBe(1);
    }
    expect(bagCount(server, session.pid, 'copper_mining_pick')).toBe(3);
  });

  it('adminRestoreToolEffectSlot mints once, saves, then refuses the overwrite', async () => {
    const session = joinServer(server, fakeWs(), 204, 'Slotted');
    server.sim.addItem('copper_mining_pick', 1, session.pid);
    (db.saveCharacterState as ReturnType<typeof vi.fn>).mockClear();
    expect(server.adminRestoreToolEffectSlot(204, 'mining', 'gatherers_cache')).toBe('ok');
    await flushAsync();
    expect(db.saveCharacterState).toHaveBeenCalled();
    // The slot now exists, so a second restore is the overwrite refusal.
    expect(server.adminRestoreToolEffectSlot(204, 'mining', 'gatherers_cache')).toBe(
      'already_slotted',
    );
    expect(server.adminRestoreToolEffectSlot(999999, 'mining', 'gatherers_cache')).toBe('offline');
  });
});
