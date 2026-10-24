import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
}));

import { buildVaultLedgerRows } from '../server/bank_ledger';
import { BankLedgerOutboxAdmission } from '../server/bank_ledger_admission';
import {
  BankLedgerOutbox,
  BankLedgerOutboxBudget,
  serializeBankLedgerCommandBatch,
} from '../server/bank_ledger_outbox';
import { REALM } from '../server/realm';
import { dispatchVaultCommand, type VaultCommandName } from '../server/vault_wire';
import { captureMaterialStackSelection } from '../src/sim/material_stack_selection';
import { sanitizeVaultState } from '../src/sim/materials_vault';
import type { InvSlot } from '../src/sim/types';
import { vaultSpecialRef } from '../src/ui/vault_view';
import { vaultCommandCustody, vaultCommandFixture } from './helpers/vault_command_fixture';

const WHO = { characterId: 101, accountId: 202 };
function rig(overrides: { maxRows?: number; maxEncodedBytes?: number } = {}) {
  const limits = { maxRows: 200, maxEncodedBytes: 4 * 1024 * 1024, ...overrides };
  const outbox = new BankLedgerOutbox({
    owner: { realm: REALM, ...WHO },
    limits,
    budget: new BankLedgerOutboxBudget(limits),
    nextBatchKey: () => 'facts:1',
  });
  const quarantine = vi.fn();
  return {
    outbox,
    quarantine,
    admission: new BankLedgerOutboxAdmission(outbox, { onProjectionFailure: quarantine }),
  };
}
const mixed = (): InvSlot => ({
  itemId: 'copper_ore',
  count: 6,
  craftedRecipeId: 'smelt_copper',
  instance: { rolled: { quality: 'rare', stats: { sta: 2 } } },
  materialSources: [
    { source: {}, count: 2 },
    { source: { signer: 'Ana' }, count: 2 },
    { source: { signer: 'Bob' }, count: 2 },
  ],
});
function selection(inventory: readonly InvSlot[], index: number, sourceIndex = 1) {
  const target = captureMaterialStackSelection(inventory, inventory[index].itemId, index);
  if (!target) throw new Error('Missing exact fixture anchor');
  return { itemId: inventory[index].itemId, target, quantities: [{ sourceIndex, count: 1 }] };
}
describe('actual vault command facts equal the old complete-book oracle', () => {
  it.each([
    'deposit',
    'selected-deposit',
    'partial-deposit',
    'fold',
    'sweep',
    'withdraw',
    'selected-withdraw',
    'partial-withdraw',
    'compact-withdraw',
    'dormant-withdraw',
    'upgrade',
    'free-upgrade',
    'max-upgrade',
    'stale-pin',
    'forged-pin',
    'locked',
    'dead',
    'away',
    'full',
    'empty',
    'legacy-overcap',
  ])(
    '%s preserves ordered receipt bytes and exact custody',
    (kind) => {
      const f = vaultCommandFixture(false, kind === 'free-upgrade' ? Array(10).fill(0) : undefined);
      const { sim, meta, pid, player, banker } = f;
      let command: VaultCommandName = 'vault_deposit';
      let msg: Record<string, unknown> = { slot: 0 };
      meta.inventory = [mixed()];
      if (kind === 'selected-deposit')
        msg = { slot: 0, count: 1, selection: selection(meta.inventory, 0) };
      if (kind === 'partial-deposit') {
        meta.vault.stock.copper_ore = 998;
        msg.count = 6;
      }
      if (kind === 'fold') {
        meta.inventory = [
          {
            itemId: 'copper_ore',
            count: 2,
            materialSources: [
              { source: { gatherer: { kind: 'character', id: 33, name: 'Gatherer' } }, count: 2 },
            ],
          },
        ];
        meta.vault.stock.copper_ore = 3;
      }
      if (kind === 'sweep') {
        command = 'vault_deposit_all';
        msg = {};
        meta.inventory = [mixed(), mixed(), { itemId: 'silverleaf', count: 3 }];
        meta.vault.stock.silverleaf = 4;
      }
      if (kind.includes('withdraw')) {
        command = 'vault_withdraw';
        meta.inventory = [];
        meta.vault = sanitizeVaultState({ stock: {}, special: [mixed()], upgrades: 10 });
        const row = meta.vault.special[0];
        msg = { itemId: row.itemId, count: 3, special: vaultSpecialRef(0, row) };
        if (kind === 'selected-withdraw') {
          const chosen = selection(meta.vault.special, 0);
          msg = {
            itemId: row.itemId,
            count: 1,
            special: { ...vaultSpecialRef(0, row), selection: chosen },
          };
        }
        if (kind === 'partial-withdraw') {
          meta.vault = sanitizeVaultState({
            stock: {},
            upgrades: 10,
            special: [
              { itemId: 'copper_ore', count: 6, materialSources: [{ source: {}, count: 6 }] },
            ],
          });
          meta.inventory = Array.from({ length: 16 }, () => ({ itemId: 'copper_ore', count: 20 }));
          meta.inventory[0].count = 19;
          msg = { itemId: 'copper_ore', count: 6, special: { index: 0 } };
        }
        if (kind === 'compact-withdraw') {
          meta.vault.stock = { copper_ore: 5 };
          meta.vault.special = [];
          msg = { itemId: 'copper_ore', count: 2 };
        }
        if (kind === 'dormant-withdraw') {
          meta.vault.stock = { dormant_material: 3 };
          meta.vault.special = [];
          msg = { itemId: 'dormant_material', count: 1 };
        }
      }
      if (kind.includes('upgrade')) {
        command = 'vault_buy_upgrade';
        msg = {};
        if (kind !== 'max-upgrade') meta.vault.upgrades = 1;
      }
      if (kind === 'stale-pin' || kind === 'forged-pin') {
        const chosen = selection(meta.inventory, 0);
        if (kind === 'stale-pin') meta.inventory[0].count++;
        else chosen.target = { ...chosen.target, pin: '0'.repeat(32) };
        msg = { slot: 0, count: 1, selection: chosen };
      }
      if (kind === 'locked') meta.inventory[0].instance = { locked: true };
      if (kind === 'dead') player.dead = true;
      if (kind === 'away') banker.pos.x += 1000;
      if (kind === 'full') meta.vault.stock.copper_ore = 1000;
      if (kind === 'empty') {
        command = 'vault_withdraw';
        msg = { itemId: 'copper_ore' };
        meta.inventory = [];
      }
      if (kind === 'legacy-overcap') {
        meta.vault.stock.copper_ore = 5000;
      }
      const before = sim.vaultInfoFor(pid),
        custody = vaultCommandCustody(meta),
        copper = meta.copper;
      const clone = vi.spyOn(sim, 'vaultInfoFor');
      const { outbox, admission, quarantine } = rig();
      dispatchVaultCommand(sim, WHO, command, msg, pid, admission);
      expect(clone).not.toHaveBeenCalled();
      clone.mockRestore();
      const after = sim.vaultInfoFor(pid);
      const op =
        command === 'vault_buy_upgrade'
          ? 'buy_slots'
          : command === 'vault_withdraw'
            ? 'withdraw'
            : 'deposit';
      const expected = buildVaultLedgerRows(op, WHO, before, after);
      expect(outbox.snapshot().batches.flatMap((batch) => batch.rows)).toEqual(
        expected.length ? serializeBankLedgerCommandBatch('facts:1', expected).rows : [],
      );
      expect(outbox.snapshot().batches).toHaveLength(expected.length ? 1 : 0);
      expect(quarantine).not.toHaveBeenCalled();
      expect(vaultCommandCustody(meta)).toEqual(custody);
      expect(meta.copper - copper).toBe(expected.reduce((sum, row) => sum + row.copperDelta, 0));
    },
    15000,
  );
  it('never clones the grown 118000-source vault and reads no unrelated source rows during scoped dispatch', () => {
    const { sim, meta, pid } = vaultCommandFixture(true);
    const reads = new Map<string, number>();
    let active = false;
    const wrapped = new WeakSet<object>();
    const instrument = () => {
      for (const row of meta.vault.special)
        if (row.materialSources && !wrapped.has(row.materialSources)) {
          const source = row.materialSources;
          const proxy = new Proxy(source, {
            get(target, key, receiver) {
              if (active && typeof key === 'string' && /^\d+$/.test(key))
                reads.set(row.itemId, (reads.get(row.itemId) ?? 0) + 1);
              return Reflect.get(target, key, receiver);
            },
          });
          wrapped.add(proxy);
          row.materialSources = proxy;
        }
    };
    const run = (
      command: VaultCommandName,
      msg: Record<string, unknown>,
      affected: ReadonlySet<string>,
    ) => {
      instrument();
      reads.clear();
      const before = sim.vaultInfoFor(pid),
        custody = vaultCommandCustody(meta);
      const { outbox, admission } = rig();
      const clone = vi.spyOn(sim, 'vaultInfoFor');
      active = true;
      try {
        dispatchVaultCommand(sim, WHO, command, msg, pid, admission);
      } finally {
        active = false;
      }
      expect(clone).not.toHaveBeenCalled();
      clone.mockRestore();
      for (const [id, n] of reads) if (!affected.has(id)) expect(n).toBe(0);
      const after = sim.vaultInfoFor(pid);
      const op =
        command === 'vault_buy_upgrade'
          ? 'buy_slots'
          : command === 'vault_withdraw'
            ? 'withdraw'
            : 'deposit';
      const oracle = buildVaultLedgerRows(op, WHO, before, after);
      const expected = oracle.length ? serializeBankLedgerCommandBatch('facts:1', oracle).rows : [];
      expect(outbox.snapshot().batches.flatMap((batch) => batch.rows)).toEqual(expected);
      expect(vaultCommandCustody(meta)).toEqual(custody);
      return { reads: new Map(reads), rows: expected.length };
    };
    expect(run('vault_buy_upgrade', {}, new Set()).reads.size).toBe(0);
    meta.vault.upgrades = 9;
    expect(run('vault_buy_upgrade', {}, new Set()).rows).toBe(1);
    const row = meta.vault.special[0],
      itemId = row.itemId;
    const selected = selection(meta.vault.special, 0);
    expect(
      run(
        'vault_withdraw',
        { itemId, count: 1, special: { ...vaultSpecialRef(0, row), selection: selected } },
        new Set([itemId]),
      ).rows,
    ).toBe(1);
    expect(
      run(
        'vault_deposit',
        { slot: 0, count: 1, selection: selection(meta.inventory, 0, 0) },
        new Set([itemId]),
      ).rows,
    ).toBe(1);
    expect(
      run(
        'vault_withdraw',
        { itemId, count: 1, special: vaultSpecialRef(0, meta.vault.special[0]) },
        new Set([itemId]),
      ).rows,
    ).toBe(1);
    expect(run('vault_deposit', { slot: 0, count: 1 }, new Set([itemId])).rows).toBe(1);
    // The sweep touches many material ids, but its receipt contains only the
    // actual one unit moved for each, never the 999 stored source units.
    meta.bags = Array(4).fill('loombound_reagent_satchel');
    meta.inventory = meta.vault.special.slice(0, 112).map((slot) => {
      const first = slot.materialSources?.[0];
      if (!first) throw new Error('Missing maximal fixture source');
      slot.count--;
      slot.materialSources = slot.materialSources?.slice(1);
      return { itemId: slot.itemId, count: 1, materialSources: [first] };
    });
    const touched = new Set(meta.inventory.map((slot) => slot.itemId));
    const sweep = run('vault_deposit_all', {}, touched);
    expect(sweep.rows).toBe(112);
    // Every affected stored bucket is validated once, without reparsing it for
    // routing, compatibility or the final merge. No unrelated buckets are read.
    expect(sweep.reads.size).toBe(112);
    for (const count of sweep.reads.values()) expect(count).toBe(999);
    expect(meta.inventory).toEqual([]);
  }, 30000);

  it('leaves immutable receipt data detached from later source and payload mutations', () => {
    const { sim, meta, pid } = vaultCommandFixture();
    meta.inventory = [mixed()];
    const { outbox, admission } = rig();
    dispatchVaultCommand(sim, WHO, 'vault_deposit', { slot: 0 }, pid, admission);
    const original = JSON.stringify(outbox.snapshot().batches);
    meta.vault.special[0].count = 99;
    meta.vault.special[0].instance = { signer: 'Changed' };
    if (meta.vault.special[0].materialSources)
      meta.vault.special[0].materialSources = [{ source: { signer: 'Changed' }, count: 99 }];
    expect(JSON.stringify(outbox.snapshot().batches)).toBe(original);
    expect(Object.isFrozen(outbox.snapshot().batches[0].rows)).toBe(true);
  });

  it('preflight failure allocates no reservation, byte refusal mutates nothing, and post-mutation fact failure quarantines', () => {
    const { sim, meta, pid } = vaultCommandFixture();
    meta.inventory = [mixed()];
    const unavailable = vi.spyOn(sim, 'vaultInfoWireRevFor').mockImplementation(() => {
      throw new Error('preflight failed');
    });
    const reserve = vi.fn();
    expect(() =>
      dispatchVaultCommand(sim, WHO, 'vault_withdraw', { itemId: 'copper_ore' }, pid, {
        tryReserve: reserve,
      }),
    ).toThrow('preflight failed');
    expect(reserve).not.toHaveBeenCalled();
    unavailable.mockRestore();
    const state = JSON.stringify([meta.inventory, meta.vault, meta.copper]);
    const byteRefusal = rig({ maxEncodedBytes: 256 });
    dispatchVaultCommand(sim, WHO, 'vault_deposit', { slot: 0 }, pid, byteRefusal.admission);
    expect(JSON.stringify([meta.inventory, meta.vault, meta.copper])).toBe(state);
    const { outbox, admission, quarantine } = rig();
    const original = sim.vaultDeposit.bind(sim);
    vi.spyOn(sim, 'vaultDeposit').mockImplementation((...args) => {
      const facts = original(...args);
      if (facts)
        Object.defineProperty(facts, 'slots', {
          get() {
            throw new Error('fact projection failed');
          },
        });
      return facts;
    });
    expect(() =>
      dispatchVaultCommand(sim, WHO, 'vault_deposit', { slot: 0 }, pid, admission),
    ).toThrow('fact projection failed');
    expect(meta.inventory).toEqual([]);
    expect(quarantine).toHaveBeenCalledOnce();
    expect(outbox.usage.reservedRows).toBeGreaterThan(0);
    expect(outbox.snapshot().batches).toEqual([]);
  });
});
