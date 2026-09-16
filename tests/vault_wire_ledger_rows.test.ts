import { beforeEach, describe, expect, it, vi } from 'vitest';

// Postgres is mocked (hoisted above the server/game import), so GameServer runs
// with no live DB; every vault command stages its rows in the session-owned
// transactional journal exactly as production does.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => {}),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  releaseCharacterLease: vi.fn(async () => true),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  loadAccountFlair: vi.fn(async () => ({ titleId: null, cosmetics: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
}));

import { bankLedgerIdle } from '../server/bank_ledger';
import type { GameServer as GameServerType } from '../server/game';
import { GameServer } from '../server/game';
import { decodeVaultInfoWire } from '../src/net/vault_snapshot_wire';
import { canonicalMaterialComposition, type MaterialSource } from '../src/sim/material_sources';
import { vaultStoredCount } from '../src/sim/materials_vault';
import type { PlayerMeta, Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';
import { vaultSpecialRef } from '../src/ui/vault_view';
import { type FakeClient, fakeWs, joinServer } from './helpers/bare_client';

// The 0.42.0 regression (players kicked on an individual vault deposit or
// withdraw, deposit-all unaffected): carried material stacks now combine while
// keeping per-unit sources, so ONE stack can hold units signed by several
// premium crafters beside unsigned units. The bank_ledger keys a vault row per
// distinct (material, identity), so a single deposit or withdrawal of such a
// stack diffs into several rows, while the command reserved exactly ONE row
// before mutating. The commit then threw AFTER the Sim had moved the items,
// which the live host treats as a lost ledger projection: it quarantines the
// session and disconnects it ("character state could not be saved"). This
// suite drives the REAL GameServer session path (guard, journal admission,
// dispatch) and pins that the mixed-identity commands stay connected, write
// their rows, and conserve every unit.

const KICK_TEXT = 'character state could not be saved';

const signedAna: MaterialSource = { signer: 'Ana' };
const signedBob: MaterialSource = { signer: 'Bob' };
const gatheredCal: MaterialSource = { gatherer: { kind: 'character', id: 31, name: 'Cal' } };

function composition(rows: readonly { source: MaterialSource; count: number }[]) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const built = canonicalMaterialComposition(rows, total);
  if (!built.ok) throw new Error(`bad fixture composition: ${built.error}`);
  return built.value;
}

interface Seated {
  // biome-ignore lint/suspicious/noExplicitAny: ClientSession is opaque to this suite
  session: any;
  sim: Sim;
  pid: number;
  meta: PlayerMeta;
  fw: FakeClient;
}

function send(server: GameServerType, session: unknown, msg: Record<string, unknown>): void {
  // biome-ignore lint/suspicious/noExplicitAny: ClientSession is opaque to this suite
  server.handleMessage(session as any, JSON.stringify({ t: 'cmd', ...msg }));
}

/** Stand a fresh character at a banker with an unlocked vault at `upgrades`. */
function seat(server: GameServerType, characterId: number, name: string, upgrades: number): Seated {
  const fw = fakeWs();
  const session = joinServer(server, fw, characterId, name);
  // biome-ignore lint/suspicious/noExplicitAny: Sim internals the fixture reaches into
  const sim = server.sim as any;
  const pid = session.pid;
  const banker = sim.entities.get(sim.bankerIds[0]);
  const p = sim.entities.get(pid);
  if (!banker || !p) throw new Error('missing banker/player test entity');
  banker.pos = { ...p.pos };
  banker.prevPos = { ...banker.pos };
  const meta = sim.players.get(pid) as PlayerMeta;
  meta.inventory.length = 0;
  meta.vault.upgrades = upgrades;
  return { session, sim, pid, meta, fw };
}

function journalRows(session: Seated['session']): Record<string, unknown>[] {
  return session.bankLedgerJournal.outbox
    .snapshot()
    .batches.flatMap((batch: { rows: readonly Record<string, unknown>[] }) => batch.rows);
}

function kickFrames(fw: FakeClient): unknown[] {
  return fw.sent.filter((frame) => {
    try {
      const parsed = JSON.parse(String(frame)) as { t?: string; error?: string };
      return parsed.t === 'error' && parsed.error === KICK_TEXT;
    } catch {
      return false;
    }
  });
}

/** The quarantine kick fires on a microtask after the dispatch, so the
 *  "still connected" claim must be checked after one turn of the loop. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Order journal row tuples by their trailing count, numerically: a bare
 *  Array.sort compares the tuples as strings, where 10 sorts before 6. */
function byCount(a: unknown[], b: unknown[]): number {
  return Number(a[a.length - 1]) - Number(b[b.length - 1]);
}

function carried(meta: PlayerMeta, itemId: string): number {
  return meta.inventory
    .filter((s: InvSlot) => s.itemId === itemId)
    .reduce((sum: number, s: InvSlot) => sum + s.count, 0);
}

beforeEach(async () => {
  await bankLedgerIdle();
});

describe('materials vault ledger rows for mixed-identity stacks', () => {
  it('an individual deposit of a stack signed by two crafters stays connected and writes one row per identity', async () => {
    const server = new GameServer();
    const { session, sim, pid, meta, fw } = seat(server, 1, 'Vaultmix', 2);
    sim.addItem('copper_ore', 12, pid, {
      materialSources: composition([
        { source: gatheredCal, count: 5 },
        { source: signedAna, count: 4 },
        { source: signedBob, count: 3 },
      ]),
    });

    send(server, session, { cmd: 'vault_deposit', slot: 0 });
    await settle();

    expect(session.escrowQuarantined).toBe(false);
    expect(session.left).toBe(false);
    expect(kickFrames(fw)).toEqual([]);
    expect(carried(meta, 'copper_ore')).toBe(0);
    expect(vaultStoredCount(meta.vault, 'copper_ore')).toBe(12);
    const rows = journalRows(session);
    expect(rows.map((row) => [row.op, row.itemId, row.count]).sort(byCount)).toEqual([
      ['deposit', 'copper_ore', 3],
      ['deposit', 'copper_ore', 4],
      ['deposit', 'copper_ore', 5],
    ]);
    // The owner's snapshot still decodes on the client boundary.
    expect(decodeVaultInfoWire(JSON.parse(JSON.stringify(sim.vaultInfoFor(pid))))).not.toBeNull();
  });

  it('an individual withdraw of a mixed identity row returns every unit without a kick', async () => {
    const server = new GameServer();
    const { session, sim, pid, meta, fw } = seat(server, 2, 'Vaultback', 2);
    // Unsigned stock first (the pre-0.42 compact row), then a signed stack of
    // the same material: the deposit folds the compact units into ONE identity
    // row holding an unsigned bucket beside the signed one.
    sim.addItem('copper_ore', 10, pid);
    send(server, session, { cmd: 'vault_deposit', slot: 0 });
    sim.addItem('copper_ore', 6, pid, {
      materialSources: composition([{ source: signedAna, count: 6 }]),
    });
    send(server, session, { cmd: 'vault_deposit', slot: 0 });
    await settle();
    expect(session.escrowQuarantined).toBe(false);
    expect(meta.vault.stock).toEqual({});
    expect(meta.vault.special).toHaveLength(1);
    const rowsBefore = journalRows(session).length;

    const special = sim.vaultInfoFor(pid)?.special ?? [];
    send(server, session, {
      cmd: 'vault_withdraw',
      itemId: 'copper_ore',
      special: vaultSpecialRef(0, special[0]),
    });
    await settle();

    expect(session.escrowQuarantined).toBe(false);
    expect(session.left).toBe(false);
    expect(kickFrames(fw)).toEqual([]);
    expect(vaultStoredCount(meta.vault, 'copper_ore')).toBe(0);
    expect(carried(meta, 'copper_ore')).toBe(16);
    const withdrawRows = journalRows(session).slice(rowsBefore);
    expect(withdrawRows.map((row) => [row.op, row.itemId, row.count]).sort(byCount)).toEqual([
      ['withdraw', 'copper_ore', 6],
      ['withdraw', 'copper_ore', 10],
    ]);
  });

  it('a 120-ceiling vault stocked past 80 keeps taking mixed deposits and paying them back', async () => {
    const server = new GameServer();
    const { session, sim, pid, meta, fw } = seat(server, 3, 'Vaultwide', 3);
    for (let i = 0; i < 5; i++) {
      sim.addItem('copper_ore', 20, pid, {
        materialSources: composition([
          { source: i % 2 ? signedAna : signedBob, count: 12 },
          { source: gatheredCal, count: 8 },
        ]),
      });
      send(server, session, { cmd: 'vault_deposit', slot: 0 });
    }
    await settle();

    expect(session.escrowQuarantined).toBe(false);
    expect(kickFrames(fw)).toEqual([]);
    expect(vaultStoredCount(meta.vault, 'copper_ore')).toBe(100);
    expect(carried(meta, 'copper_ore')).toBe(0);
    const info = sim.vaultInfoFor(pid);
    expect(info?.perMaterialCap).toBe(120);
    expect(decodeVaultInfoWire(JSON.parse(JSON.stringify(info)))).not.toBeNull();

    // Shift-click partial: 20 units (one bag stack) out of the three-identity row.
    const special = info?.special ?? [];
    send(server, session, {
      cmd: 'vault_withdraw',
      itemId: 'copper_ore',
      count: 20,
      special: vaultSpecialRef(0, special[0]),
    });
    await settle();
    expect(session.escrowQuarantined).toBe(false);
    expect(session.left).toBe(false);
    expect(kickFrames(fw)).toEqual([]);
    expect(vaultStoredCount(meta.vault, 'copper_ore')).toBe(80);
    expect(carried(meta, 'copper_ore')).toBe(20);
  });

  it('deposit-all over mixed stacks keeps its single batched receipt', async () => {
    const server = new GameServer();
    const { session, sim, pid, meta, fw } = seat(server, 4, 'Vaultsweep', 2);
    sim.addItem('copper_ore', 8, pid, {
      materialSources: composition([
        { source: signedAna, count: 4 },
        { source: signedBob, count: 4 },
      ]),
    });
    sim.addItem('iron_ore', 5, pid);

    send(server, session, { cmd: 'vault_deposit_all' });
    await settle();

    expect(session.escrowQuarantined).toBe(false);
    expect(kickFrames(fw)).toEqual([]);
    expect(vaultStoredCount(meta.vault, 'copper_ore')).toBe(8);
    expect(vaultStoredCount(meta.vault, 'iron_ore')).toBe(5);
    expect(session.bankLedgerJournal.outbox.snapshot().batches).toHaveLength(1);
    expect(
      journalRows(session)
        .map((row) => [row.itemId, row.count])
        .sort(),
    ).toEqual([
      ['copper_ore', 4],
      ['copper_ore', 4],
      ['iron_ore', 5],
    ]);
    expect(sim.meta(pid)).toBe(meta);
  });
});
