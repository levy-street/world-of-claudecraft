// Property and edge pins for the Materials Vault ledger row bound
// (server/vault_ledger_row_bound.ts) driven through the REAL dispatch and the
// REAL session journal admission (server/bank_ledger_session.ts), which is
// the path a live GameServer session takes. The fixed-fixture pins live in
// tests/server/vault_ledger_row_bound.test.ts; this suite holds the invariant
// the whole fix rests on, over randomized stacks: the rows a command commits
// never exceed the rows it reserved, so the post-mutation commit can never
// throw and quarantine the session again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBankLedgerSessionJournal } from '../server/bank_ledger_session';
import {
  gameMetricsCounters,
  noopGameMetricsCounters,
  setGameMetricsCounters,
  type VaultLedgerIncident,
} from '../server/http/game_signals';
import { REALM } from '../server/realm';
import {
  VAULT_LEDGER_ROW_BOUND_MAX,
  vaultDepositAllLedgerRowBound,
  vaultDepositLedgerRowBound,
  vaultWithdrawLedgerRowBound,
} from '../server/vault_ledger_row_bound';
import { dispatchVaultCommand, type VaultSim } from '../server/vault_wire';
import { materialStorageTransferPayload } from '../src/net/material_storage_command';
import { vaultWithdrawPayload } from '../src/net/vault_snapshot_wire';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  canonicalMaterialComposition,
  type MaterialComposition,
  type MaterialSource,
} from '../src/sim/material_sources';
import { vaultStoredCount } from '../src/sim/materials_vault';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, WorldContent } from '../src/sim/types';
import { vaultSpecialRef } from '../src/ui/vault_view';

const BANKER_ID = 'bursar_fernando';
const BANKER_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: { [BANKER_ID]: BUILTIN_WORLD.npcs[BANKER_ID] },
  groundObjects: [],
};
const WHO = { characterId: 1, accountId: 1 };
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));

const SIGNERS = ['Ana', 'Bob', 'Cyn', 'Dee', 'Eli'];
// Members of the honest material set (src/sim/material_ids.ts); a non-material
// id would make every deposit a silent refusal and hollow the property out.
const MATERIALS = ['copper_ore', 'iron_ore', 'linen_scrap'];

function composition(rows: readonly { source: MaterialSource; count: number }[]) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const built = canonicalMaterialComposition(rows, total);
  if (!built.ok) throw new Error(`bad fixture composition: ${built.error}`);
  return built.value;
}

/** A random stack of up to 20 units split across unsigned, gatherer-only and
 *  premium-signed buckets: the shapes 0.42.0 stack combining produces. */
function randomComposition(rng: Rng, units: number): MaterialComposition {
  const rows: { source: MaterialSource; count: number }[] = [];
  let left = units;
  while (left > 0) {
    const count = rng.int(1, left);
    left -= count;
    const roll = rng.int(0, 3);
    const source: MaterialSource =
      roll === 0
        ? {}
        : roll === 1
          ? { gatherer: { kind: 'character', id: 100 + rng.int(0, 4), name: 'Gath' } }
          : { signer: SIGNERS[rng.int(0, SIGNERS.length - 1)] };
    rows.push({ source, count });
  }
  return composition(rows);
}

function bankerSim(): Sim {
  const sim = new Sim({ seed: 73, playerClass: 'warrior', autoEquip: false, world: BANKER_WORLD });
  const banker = [...sim.entities.values()].find(
    (e): e is Entity => e.kind === 'npc' && e.templateId === BANKER_ID,
  );
  if (!banker) throw new Error('banker did not spawn');
  sim.player.pos = { ...banker.pos };
  sim.player.prevPos = { ...banker.pos };
  sim.rebucket(sim.player);
  return sim;
}

interface Harness {
  sim: Sim;
  pid: number;
  failures: string[];
  rowsCommitted(): number;
  deposit(slot: number, count?: number): void;
  withdraw(itemId: string, count?: number, special?: ReturnType<typeof vaultSpecialRef>): void;
  depositAll(): void;
}

function harness(sim: Sim): Harness {
  const failures: string[] = [];
  const journal = createBankLedgerSessionJournal(
    { realm: REALM, characterId: 1, accountId: 1 },
    {
      onProjectionFailure: (error, surface) => failures.push(`${surface}: ${String(error)}`),
      onReservationFailure: (error) => failures.push(`reservation: ${String(error)}`),
    },
  );
  const pid = sim.playerId;
  const vs = sim as unknown as VaultSim;
  const rowsCommitted = () =>
    journal.outbox.snapshot().batches.reduce((sum, batch) => sum + batch.rows.length, 0);
  return {
    sim,
    pid,
    failures,
    rowsCommitted,
    deposit: (slot, count) =>
      dispatchVaultCommand(
        vs,
        WHO,
        'vault_deposit',
        wire(materialStorageTransferPayload(slot, count)),
        pid,
        journal.admission,
      ),
    withdraw: (itemId, count, special) =>
      dispatchVaultCommand(
        vs,
        WHO,
        'vault_withdraw',
        wire(vaultWithdrawPayload(itemId, count, special)),
        pid,
        journal.admission,
      ),
    depositAll: () =>
      dispatchVaultCommand(vs, WHO, 'vault_deposit_all', {}, pid, journal.admission),
  };
}

function resetPlayer(sim: Sim, upgrades: number): void {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player meta');
  meta.inventory = [];
  meta.vault = { stock: {}, special: [], upgrades };
  meta.vaultWireRev++;
}

function carried(sim: Sim, itemId: string): number {
  return (sim.meta(sim.playerId)?.inventory ?? [])
    .filter((slot: InvSlot) => slot.itemId === itemId)
    .reduce((sum: number, slot: InvSlot) => sum + slot.count, 0);
}

describe('vault ledger row bound property (real dispatch, real journal admission)', () => {
  // One Sim for the whole sweep: construction dominates, and every case
  // resets the carried inventory and the vault to a clean rung-3 state.
  const sim = bankerSim();

  it('rows committed by a deposit never exceed its bound, and nothing is ever quarantined', () => {
    const rng = new Rng(4242);
    for (let round = 0; round < 40; round++) {
      resetPlayer(sim, 3);
      const h = harness(sim);
      const itemId = MATERIALS[rng.int(0, MATERIALS.length - 1)];
      // A pre-existing vault holding of the same material in a random shape,
      // so deposits exercise the fold and the merge-into-existing-row arms.
      if (rng.int(0, 1) === 1) {
        const seedUnits = rng.int(1, 20);
        sim.addItem(itemId, seedUnits, sim.playerId, {
          materialSources: randomComposition(rng, seedUnits),
        });
        h.deposit(0);
        expect(h.failures).toEqual([]);
      }
      if (rng.int(0, 1) === 1) {
        sim.addItem(itemId, rng.int(1, 20), sim.playerId);
        h.deposit(0);
        expect(h.failures).toEqual([]);
      }
      const units = rng.int(1, 20);
      sim.addItem(itemId, units, sim.playerId, {
        materialSources: randomComposition(rng, units),
      });
      const slot = (sim.meta(sim.playerId)?.inventory ?? []).findIndex((s) => s.itemId === itemId);
      const stack = sim.meta(sim.playerId)?.inventory[slot];
      const bound = vaultDepositLedgerRowBound(stack);
      const rowsBefore = h.rowsCommitted();
      const storedBefore = vaultStoredCount(sim.meta(sim.playerId)!.vault, itemId);
      const carriedBefore = carried(sim, itemId);
      // Random partial or whole deposit.
      const partial = rng.int(0, 2) === 0 ? rng.int(1, units) : undefined;
      h.deposit(slot, partial);
      expect(h.failures).toEqual([]);
      const rows = h.rowsCommitted() - rowsBefore;
      expect(rows, `round ${round}`).toBeLessThanOrEqual(bound);
      expect(rows).toBeGreaterThan(0);
      // Conservation across the two containers.
      expect(vaultStoredCount(sim.meta(sim.playerId)!.vault, itemId) + carried(sim, itemId)).toBe(
        storedBefore + carriedBefore,
      );
    }
  });

  it('rows committed by an identity-row withdrawal never exceed its bound', () => {
    const rng = new Rng(9001);
    for (let round = 0; round < 40; round++) {
      resetPlayer(sim, 3);
      const h = harness(sim);
      const itemId = MATERIALS[rng.int(0, MATERIALS.length - 1)];
      // Build a random mixed identity row out of one to three deposits.
      const stacks = rng.int(1, 3);
      for (let i = 0; i < stacks; i++) {
        const units = rng.int(1, 20);
        sim.addItem(itemId, units, sim.playerId, {
          materialSources: randomComposition(rng, units),
        });
        h.deposit(0);
        expect(h.failures).toEqual([]);
      }
      const info = sim.vaultInfoFor(sim.playerId);
      if (!info || info.special.length === 0) continue; // an all-unsigned draw pooled: not this arm
      const index = rng.int(0, info.special.length - 1);
      const row = info.special[index];
      const ref = vaultSpecialRef(index, row);
      const bound = vaultWithdrawLedgerRowBound(info, itemId, ref);
      const rowsBefore = h.rowsCommitted();
      const partial = rng.int(0, 1) === 0 && row.count > 1 ? rng.int(1, row.count - 1) : undefined;
      h.withdraw(itemId, partial, ref);
      expect(h.failures).toEqual([]);
      const rows = h.rowsCommitted() - rowsBefore;
      expect(rows, `round ${round}`).toBeLessThanOrEqual(bound);
      expect(rows).toBeGreaterThan(0);
    }
  });

  it('a compact withdrawal beside a mixed identity row of the same material writes exactly one row', () => {
    resetPlayer(sim, 3);
    const h = harness(sim);
    // A mixed identity row first, then a dormant compact holding written
    // straight into the record the way a pre-provenance save carries it.
    sim.addItem('copper_ore', 10, sim.playerId, {
      materialSources: composition([
        { source: { signer: 'Ana' }, count: 6 },
        { source: {}, count: 4 },
      ]),
    });
    h.deposit(0);
    sim.meta(sim.playerId)!.vault.stock.copper_ore = 15;
    const info = sim.vaultInfoFor(sim.playerId);
    expect(vaultWithdrawLedgerRowBound(info, 'copper_ore', undefined)).toBe(1);
    const rowsBefore = h.rowsCommitted();
    h.withdraw('copper_ore');
    expect(h.failures).toEqual([]);
    expect(h.rowsCommitted() - rowsBefore).toBe(1);
    expect(sim.meta(sim.playerId)!.vault.stock).toEqual({});
    expect(carried(sim, 'copper_ore')).toBe(15);
  });

  it('a legacy signer-on-payload stack deposits onto an unsigned row within its bound', () => {
    resetPlayer(sim, 3);
    const h = harness(sim);
    sim.addItem('copper_ore', 10, sim.playerId);
    h.deposit(0);
    const meta = sim.meta(sim.playerId)!;
    // The pre-provenance shape: the signer rides the instance payload and no
    // bucket exists yet. Normalization projects it into a signer bucket.
    meta.inventory.push({ itemId: 'copper_ore', count: 5, instance: { signer: 'Ana' } });
    const bound = vaultDepositLedgerRowBound(meta.inventory[0]);
    expect(bound).toBe(1);
    const rowsBefore = h.rowsCommitted();
    h.deposit(0);
    expect(h.failures).toEqual([]);
    expect(h.rowsCommitted() - rowsBefore).toBeLessThanOrEqual(bound);
    expect(vaultStoredCount(meta.vault, 'copper_ore')).toBe(15);
  });

  it('a withdraw whose selector fingerprint misses writes nothing and quarantines nothing', () => {
    resetPlayer(sim, 3);
    const h = harness(sim);
    sim.addItem('copper_ore', 10, sim.playerId, {
      materialSources: composition([{ source: { signer: 'Ana' }, count: 10 }]),
    });
    h.deposit(0);
    const rowsBefore = h.rowsCommitted();
    h.withdraw('copper_ore', undefined, { index: 7, craftedRecipeId: 'not_this_row' });
    expect(h.failures).toEqual([]);
    expect(h.rowsCommitted() - rowsBefore).toBe(0);
    expect(vaultStoredCount(sim.meta(sim.playerId)!.vault, 'copper_ore')).toBe(10);
  });
});

describe('over-bound refusal happens before mutation', () => {
  const incidents: VaultLedgerIncident[] = [];
  afterEach(() => {
    setGameMetricsCounters(noopGameMetricsCounters);
    incidents.length = 0;
  });

  /** More distinct (material, signer) keys than the account row burst can
   *  ever hold: seven materials, each a stack signed by eighteen crafters. */
  function overBoundInventory(): InvSlot[] {
    // Seven honest material ids (a non-material stack is skipped by the sweep
    // and by the bound alike, so it could not push the count over).
    const materials = [
      'copper_ore',
      'iron_ore',
      'linen_scrap',
      'rough_hide',
      'spider_silk',
      'silverleaf_herb',
      'thorium_ore',
    ];
    return materials.map((itemId) => ({
      itemId,
      count: 18,
      materialSources: composition(
        Array.from({ length: 18 }, (_, i) => ({ source: { signer: `Crafter${i}` }, count: 1 })),
      ),
    }));
  }

  it('refuses a deposit-all whose key count exceeds the burst with the busy line, reserving and mutating nothing', () => {
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      vaultLedgerIncident: (kind) => void incidents.push(kind),
    });
    const inventory = overBoundInventory();
    const bound = vaultDepositAllLedgerRowBound(inventory);
    expect(bound).toBeGreaterThan(VAULT_LEDGER_ROW_BOUND_MAX);

    const errors: string[] = [];
    const depositAll = vi.fn();
    const tryReserve = vi.fn(() => {
      throw new Error('the guard must never see an over-bound reservation');
    });
    // The metric never names a character (unbounded ids are banned as labels),
    // so the log line beside the increment must carry the identifying detail.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake: VaultSim = {
      ctx: {
        resolve: () => ({ meta: { entityId: 5, inventory } }),
        error: (_id, text) => void errors.push(text),
      },
      vaultInfoFor: () => null,
      vaultDeposit: vi.fn(),
      vaultWithdraw: vi.fn(),
      vaultDepositAll: depositAll,
      vaultBuyUpgrade: vi.fn(),
    };
    dispatchVaultCommand(fake, WHO, 'vault_deposit_all', {}, 5, { tryReserve });

    expect(errors).toEqual(['You are busy.']);
    expect(depositAll).not.toHaveBeenCalled();
    expect(tryReserve).not.toHaveBeenCalled();
    expect(incidents).toEqual(['row_bound_exceeded']);
    expect(gameMetricsCounters()).not.toBe(noopGameMetricsCounters);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('vault_deposit_all refused for character 1');
    expect(line).toContain(`row bound ${bound} exceeds the 121-row reservation ceiling`);
    warn.mockRestore();
  });
});
