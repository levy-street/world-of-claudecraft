// The courier vault leg on the wire: the dispatch reader admits the two vault
// lists strictly, the vault half rides its own `courierVault` key (older clients
// reject unknown courierData keys), and the banker exchange records the vault
// leg in the vault ledger under its own reservation.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({ insertBankLedgerRow: vi.fn(), insertBankLedgerRows: vi.fn() }));

import { BankLedgerOutboxBudget } from '../server/bank_ledger_outbox';
import { createBankLedgerSessionJournal } from '../server/bank_ledger_session';
import {
  BANK_VAULT_LEDGER_ROW_BURST,
  bankVaultLedgerMaxRows,
  createBankVaultLedgerGuardCoordinator,
} from '../server/bank_vault_ledger_guard';
import {
  type CourierWireSim,
  courierBankExchangeFor,
  courierVaultLedgerRowBound,
  emitCourierSelfKeys,
  readCourierDispatch,
} from '../server/courier_wire';
import { REALM } from '../server/realm';
import type { StorageAdmissionSession } from '../server/storage_admission';
import { applyCourierSelfWire, decodeCourierStores } from '../src/net/courier_wire';
import type { CourierInfo } from '../src/sim/courier';
import type { BankInfo, VaultInfo } from '../src/world_api/bank';

const vault = (stock: Record<string, number> = {}): VaultInfo => ({
  stock,
  special: [],
  upgrades: 1,
  perMaterialCap: 100,
  nextUpgradeCost: 50000,
});
const info = (): CourierInfo => ({
  phase: 'ready',
  x: 10,
  z: 20,
  bankerId: null,
  travelDistance: 0,
  remainingDistance: 0,
  cargo: [],
  withdrawals: [],
  revision: 1,
  active: true,
  inventoryRevision: 1,
  bankRevision: 1,
  bankSlots: [],
  bankCapacity: 24,
  vault: vault({ copper_ore: 6 }),
});
function sim(value: CourierInfo | null): CourierWireSim {
  return {
    courierDispatch: vi.fn(),
    courierInfoFor: () => value,
    courierPoseFor: () =>
      value && {
        phase: value.phase,
        x: value.x,
        z: value.z,
        bankerId: value.bankerId,
        travelDistance: value.travelDistance,
        remainingDistance: value.remainingDistance,
        inventoryRevision: value.inventoryRevision,
      },
    courierWireRevisionFor: () => (value ? '1' : null),
    courierBankInfoFor: () => null,
    ctx: { players: new Map(), resolve: () => null } as never,
    meta: () => ({
      characterId: 10,
      inventory: [],
      bank: { inventory: [] },
      courier: { cargo: [], withdrawals: [] },
    }),
  };
}
const base = { t: 'cmd', cmd: 'courier_dispatch', deposits: [], withdrawals: [] };

describe('courier vault wire', () => {
  it('reads both vault lists and refuses malformed or excessive ones', () => {
    const vaultDeposits = [{ index: 1, fingerprint: 'f' }];
    const vaultWithdrawals = [
      { itemId: 'copper_ore', count: 6 },
      { itemId: 'copper_ore', count: 4, special: { index: 0, fingerprint: 'g' } },
    ];
    expect(readCourierDispatch({ ...base, vaultDeposits, vaultWithdrawals })).toEqual({
      deposits: [],
      withdrawals: [],
      vaultDeposits,
      vaultWithdrawals,
    });
    for (const bad of [
      { vaultDeposits: [{ index: -1, fingerprint: 'f' }] },
      { vaultWithdrawals: [{ itemId: 'copper_ore', count: 0 }] },
      { vaultWithdrawals: [{ itemId: '', count: 1 }] },
      { vaultWithdrawals: [{ itemId: 'copper_ore', count: 1, extra: true }] },
      { vaultWithdrawals: [{ itemId: 'copper_ore', count: 1, special: { index: 0 } }] },
      { vaultWithdrawals: Array.from({ length: 25 }, () => ({ itemId: 'copper_ore', count: 1 })) },
    ])
      expect(readCourierDispatch({ ...base, ...bad })).toBeNull();
  });

  it('keeps courierData exactly as older clients know it and sends the vault apart', () => {
    const sent: Record<string, string> = {};
    const frame: Record<string, unknown> = {};
    const emit = (key: string, value: unknown) => {
      const raw = JSON.stringify(value);
      if (sent[key] !== raw) {
        sent[key] = raw;
        frame[key] = JSON.parse(raw);
      }
    };
    const session = { pid: 17, lastSent: sent, lastCourierWireRevision: null };
    emitCourierSelfKeys(emit, sim(info()), session);
    expect(Object.keys(frame.courierData as object)).not.toContain('vault');
    expect(frame.courierStores).toEqual({
      vault: vault({ copper_ore: 6 }),
      vaultCargo: [],
      vaultWithdrawals: [],
      account: null,
    });
    const target = { courierInfo: null as CourierInfo | null };
    applyCourierSelfWire(target, frame);
    expect(target.courierInfo).toEqual(info());
    // A malformed vault frame leaves the mirror alone; null clears the vault.
    applyCourierSelfWire(target, { courierStores: { vault: { stock: 'x' } } });
    expect(target.courierInfo?.vault).toEqual(vault({ copper_ore: 6 }));
    applyCourierSelfWire(target, { courierStores: null });
    expect(target.courierInfo?.vault).toBeNull();
    expect(decodeCourierStores({ vault: null, vaultCargo: [], vaultWithdrawals: [] })).toEqual({
      vault: null,
    });
  });

  it('reads an older server, which never sends courierVault, as a courier without a vault', () => {
    const { vault: _vault, ...older } = info();
    const target = { courierInfo: null as CourierInfo | null };
    const { phase, x, z, bankerId, travelDistance, remainingDistance, inventoryRevision, ...data } =
      older;
    applyCourierSelfWire(target, {
      courier: { phase, x, z, bankerId, travelDistance, remainingDistance, inventoryRevision },
      courierData: data,
    });
    expect(target.courierInfo?.vault).toBeNull();
  });

  it('bounds the vault ledger rows of a trip by its stacks and rows', () => {
    expect(courierVaultLedgerRowBound(vault(), {})).toBe(1);
    expect(
      courierVaultLedgerRowBound(vault(), {
        vaultCargo: [
          { itemId: 'copper_ore', count: 3 },
          { itemId: 'linen_scrap', count: 2 },
        ],
        vaultWithdrawals: [{ itemId: 'wolf_fang', count: 2 }],
      }),
    ).toBe(3);
  });

  it.each([false, true])(
    'settles vault exchanges without stranding oversized saved trips (%s)',
    (oversized) => {
      const live = {
        stock: { linen_scrap: 4 } as Record<string, number>,
        special: [],
        upgrades: 1,
      };
      const bank = { slots: [], purchasedSlots: 0, nextExpansionCost: 500 } as unknown as BankInfo;
      const meta = {
        vault: live,
        courier: {
          vaultCargo: oversized
            ? Array.from({ length: BANK_VAULT_LEDGER_ROW_BURST + 1 }, (_, i) => ({
                itemId: `material_${i}`,
                count: 1,
              }))
            : [{ itemId: 'copper_ore', count: 3 }],
          vaultWithdrawals: [{ itemId: 'linen_scrap', count: 4 }],
        },
      };
      const host = {
        ...sim(info()),
        courierBankInfoFor: () => structuredClone(bank),
        ctx: {
          players: new Map([[17, meta]]),
          resolve: () => ({ meta }),
          storagePrices: { vaultUpgrades: [20000, 50000, 100000, 200000, 400000] },
        } as never,
      };
      const rows: { surface: string; batch: unknown[] }[] = [];
      const admission = {
        tryReserve: vi.fn((_rows: number, _guild: number, surface: string) => ({
          commit: (batch: readonly unknown[]) => {
            rows.push({ surface, batch: [...batch] });
            return true;
          },
          cancel: vi.fn(() => true),
          failAfterMutation: vi.fn(),
        })),
      };
      const runtime = createBankVaultLedgerGuardCoordinator(() => 0).createRuntime(
        20,
        admission as never,
        vi.fn(),
      );
      const session = {
        pid: 17,
        characterId: 10,
        accountId: 20,
        left: false,
        escrowQuarantined: false,
        bankLedgerJournal: { outbox: { owner: { characterId: 10, accountId: 20 } } },
        bankVaultLedgerGuard: runtime,
      } as unknown as StorageAdmissionSession;
      const ok = courierBankExchangeFor(
        host,
        session,
        17,
        () => {
          live.stock.copper_ore = 3;
        },
        () => {
          delete live.stock.linen_scrap;
        },
      );
      expect(ok).toBe(true);
      if (oversized) {
        expect(live.stock).toEqual({ linen_scrap: 4 });
        expect(admission.tryReserve).not.toHaveBeenCalled();
        expect(rows).toEqual([]);
        return;
      }
      // One reservation covers both legs (the courier dispatch floor plus the
      // two vault rows); a second concurrent one is never requested.
      expect(admission.tryReserve).toHaveBeenCalledOnce();
      expect(admission.tryReserve).toHaveBeenCalledWith(
        bankVaultLedgerMaxRows('courier_dispatch') + 2,
        0,
        'vault',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].batch).toMatchObject([
        { op: 'deposit', itemId: 'copper_ore', count: 3, container: 'vault' },
        { op: 'withdraw', itemId: 'linen_scrap', count: 4, container: 'vault' },
      ]);
    },
  );

  // Discord "Courier seems semi bugged": a trip with a vault leg reserved the
  // personal rows first, and the real outbox admission hands that reservation
  // every remaining byte, so the vault reservation was refused on every retry
  // and the courier hovered at the banker ("Flying to the bank") forever.
  it('admits a vault leg through the real session journal on the first arrival', () => {
    const live = { stock: { linen_scrap: 4 } as Record<string, number>, special: [], upgrades: 1 };
    const bank = { slots: [], purchasedSlots: 0, nextExpansionCost: 500 } as unknown as BankInfo;
    const meta = {
      vault: live,
      courier: {
        vaultCargo: [{ itemId: 'copper_ore', count: 3 }],
        vaultWithdrawals: [{ itemId: 'linen_scrap', count: 4 }],
      },
    };
    const host = {
      ...sim(info()),
      courierBankInfoFor: () => structuredClone(bank),
      ctx: {
        players: new Map([[17, meta]]),
        resolve: () => ({ meta }),
        storagePrices: { vaultUpgrades: [20000, 50000, 100000, 200000, 400000] },
      } as never,
    };
    const owner = { realm: REALM, characterId: 10, accountId: 20 };
    const journal = createBankLedgerSessionJournal(
      owner,
      { onProjectionFailure: vi.fn() },
      { budget: new BankLedgerOutboxBudget() },
    );
    const runtime = createBankVaultLedgerGuardCoordinator(() => 0).createRuntime(
      20,
      journal.admission,
      vi.fn(),
    );
    const session = {
      pid: 17,
      ...owner,
      left: false,
      escrowQuarantined: false,
      bankLedgerJournal: journal,
      bankVaultLedgerGuard: runtime,
    } as unknown as StorageAdmissionSession;
    const deposit = vi.fn(() => {
      bank.slots.push({ itemId: 'healing_potion', count: 2 });
      live.stock.copper_ore = 3;
    });
    const withdraw = vi.fn(() => {
      delete live.stock.linen_scrap;
    });
    expect(courierBankExchangeFor(host, session, 17, deposit, withdraw)).toBe(true);
    expect(deposit).toHaveBeenCalledOnce();
    expect(withdraw).toHaveBeenCalledOnce();
    expect(live.stock).toEqual({ copper_ore: 3 });
    // Both legs landed in the one outbox, and no reservation is left behind.
    expect(journal.outbox.usage).toMatchObject({ reservedRows: 0, reservedEncodedBytes: 0 });
    // One batch carries the personal bank row and both vault rows, in order.
    expect(journal.outbox.usage.queuedRows).toBe(3);
    const queued = journal.outbox.snapshot().batches.flatMap((b) => b.rows);
    expect(queued).toMatchObject([
      { op: 'deposit', itemId: 'healing_potion', count: 2 },
      { op: 'deposit', itemId: 'copper_ore', count: 3, container: 'vault' },
      { op: 'withdraw', itemId: 'linen_scrap', count: 4, container: 'vault' },
    ]);
    expect(queued[0].container).not.toBe('vault');
  });

  // Both legs share the account's row burst: a combined bound over it settles
  // unchanged (the cargo rides home) instead of retrying at the banker forever,
  // and a vault leg with no readable vault never mutates without its rows.
  it.each([
    { label: 'exactly at the burst', extra: 0, admitted: true },
    { label: 'one over the burst', extra: 1, admitted: false },
    { label: 'with no readable vault', extra: 0, admitted: false, noVault: true },
  ])('combined courier ledger bound $label', ({ extra, admitted, noVault }) => {
    const floor = bankVaultLedgerMaxRows('courier_dispatch');
    // Each distinct material is one vault row, plus one for the withdrawal.
    const materials = BANK_VAULT_LEDGER_ROW_BURST - floor - 1 + extra;
    const live = { stock: { linen_scrap: 4 } as Record<string, number>, special: [], upgrades: 1 };
    const meta = {
      vault: noVault ? undefined : live,
      courier: {
        vaultCargo: Array.from({ length: materials }, (_, i) => ({
          itemId: `material_${i}`,
          count: 1,
        })),
        vaultWithdrawals: [{ itemId: 'linen_scrap', count: 4 }],
      },
    };
    const host = {
      ...sim(info()),
      courierBankInfoFor: () =>
        ({ slots: [], purchasedSlots: 0, nextExpansionCost: 500 }) as unknown as BankInfo,
      ctx: {
        players: new Map([[17, meta]]),
        resolve: () => (noVault ? null : { meta }),
        storagePrices: { vaultUpgrades: [20000, 50000, 100000, 200000, 400000] },
      } as never,
    };
    const admission = {
      tryReserve: vi.fn(() => ({
        commit: () => true,
        cancel: vi.fn(() => true),
        failAfterMutation: vi.fn(),
      })),
    };
    const session = {
      pid: 17,
      characterId: 10,
      accountId: 20,
      left: false,
      escrowQuarantined: false,
      bankLedgerJournal: { outbox: { owner: { characterId: 10, accountId: 20 } } },
      bankVaultLedgerGuard: createBankVaultLedgerGuardCoordinator(() => 0).createRuntime(
        20,
        admission as never,
        vi.fn(),
      ),
    } as unknown as StorageAdmissionSession;
    const deposit = vi.fn();
    const withdraw = vi.fn();
    expect(courierBankExchangeFor(host, session, 17, deposit, withdraw)).toBe(true);
    if (admitted) {
      expect(admission.tryReserve).toHaveBeenCalledWith(BANK_VAULT_LEDGER_ROW_BURST, 0, 'vault');
      expect(deposit).toHaveBeenCalledOnce();
    } else {
      expect(admission.tryReserve).not.toHaveBeenCalled();
      expect(deposit).not.toHaveBeenCalled();
      expect(withdraw).not.toHaveBeenCalled();
    }
  });

  it('reads the other-character leg strictly and round-trips it on courierStores', () => {
    const account = {
      characterId: 12,
      deposits: [{ index: 0, fingerprint: 'f' }],
      withdrawals: [{ index: 3, fingerprint: 'g' }],
    };
    expect(readCourierDispatch({ ...base, account })).toMatchObject({ account });
    for (const bad of [
      { ...account, characterId: 0 },
      { ...account, extra: 1 },
      { ...account, deposits: [{ index: -1, fingerprint: 'f' }] },
    ])
      expect(readCourierDispatch({ ...base, account: bad })).toBeNull();
    const leg = {
      characterId: 12,
      cargo: [{ itemId: 'healing_potion', count: 2 }],
      withdrawals: [],
    };
    expect(
      decodeCourierStores({ vault: null, vaultCargo: [], vaultWithdrawals: [], account: leg }),
    ).toEqual({ vault: null, account: leg });
    expect(
      decodeCourierStores({
        vault: null,
        vaultCargo: [],
        vaultWithdrawals: [],
        account: { ...leg, characterId: -1 },
      }),
    ).toBeUndefined();
  });
});
