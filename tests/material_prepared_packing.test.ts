import { describe, expect, it } from 'vitest';
import { PreparedMaterialComposition } from '../src/sim/material_sources';
import { type MaterialStackSlot, PreparedMaterialStack } from '../src/sim/material_stack';
import {
  materialStackFit,
  PreparedMaterialInventory,
  planMaterialStackAdd,
} from '../src/sim/material_stack_packing';
import {
  appliedVaultRowAdd,
  planVaultDeposit,
  planVaultDepositMutation,
  planVaultRowAdd,
} from '../src/sim/vault_slot_ops';
import {
  planMaterialStackAdd as oldAdd,
  materialStackFit as oldFit,
} from './helpers/material_stack_packing_oracle';

const ids = new Set(['copper_ore']);
const slot = (count: number, kind: number): MaterialStackSlot => ({
  itemId: 'copper_ore',
  count,
  materialSources: [
    {
      source:
        kind % 3 === 0
          ? {}
          : {
              gatherer: { kind: 'character', id: kind + 1, name: 'Ana' },
              ...(kind % 3 === 2 ? { signer: '' } : {}),
            },
      count,
    },
  ],
  ...(kind % 7 === 0 ? { materialSeparated: true as const } : {}),
  ...(kind % 5 === 0 ? { instance: { locked: true } } : {}),
  ...(kind % 11 === 0 ? { craftedRecipeId: 'recipe' } : {}),
});

describe('command-local prepared packing', () => {
  it('matches the frozen packing oracle for fit, ordered edits, refusals and oversized rows', () => {
    for (let n = 0; n < 240; n++) {
      const inventory = [slot((n % 33) + 1, n % 17), slot((n % 23) + 1, (n % 13) + 1), slot(4, 3)];
      if (n % 9 === 0) inventory[2].materialSources = [{ source: {}, count: 0 }];
      const request = {
        inventory,
        incoming: slot((n % 37) + 1, n % 19),
        materialIds: ids,
        stackSize: (n % 15) + 1,
        maxNewSlots: n % 4,
      };
      expect(materialStackFit(request)).toEqual(oldFit(request));
      expect(planMaterialStackAdd(request)).toEqual(oldAdd(request));
    }
  });

  it('retains validation precedence and reads later same-item rows even when enough room exists', () => {
    const malformed = slot(1, 1);
    malformed.materialSources = [{ source: {}, count: 0 }];
    const request = {
      inventory: [slot(1, 1), malformed],
      incoming: slot(1, 1),
      materialIds: ids,
      stackSize: 100,
      maxNewSlots: 1,
    };
    expect(planMaterialStackAdd(request)).toEqual({ ok: false, error: 'invalid-count' });
    expect(planMaterialStackAdd({ ...request, stackSize: 0 })).toEqual({
      ok: false,
      error: 'invalid-capacity',
    });
    expect(planMaterialStackAdd({ ...request, incoming: { ...slot(1, 1), count: 0 } })).toEqual({
      ok: false,
      error: 'invalid-count',
    });
  });

  it('owns raw inputs and every public snapshot independently', () => {
    const raw = slot(3, 1);
    const prepared = PreparedMaterialStack.read(raw, ids);
    if (!prepared.ok) throw new Error(prepared.error);
    const inventory = PreparedMaterialInventory.read([raw], raw.itemId, ids);
    if (!inventory.ok) throw new Error(inventory.error);
    raw.count = 90;
    raw.materialSources = [];
    const first = prepared.value.materialize();
    first.materialSources = [];
    first.count = 50;
    inventory.value.someIdentity((view) => {
      view.count = 0;
      view.materialSources = [];
      return false;
    });
    expect(prepared.value.materialize().count).toBe(3);
    const add = inventory.value.plan(slot(1, 2), 100, 1);
    if (!add.ok) throw new Error(add.error);
    expect(add.value.replacements[0].slot.count).toBe(4);
    const expected = structuredClone(add);
    add.value.replacements[0].slot.materialSources = [];
    expect(inventory.value.plan(slot(1, 2), 100, 1)).toEqual(expected);
    const comp = PreparedMaterialComposition.read(
      [{ source: {}, count: Number.MAX_SAFE_INTEGER }],
      Number.MAX_SAFE_INTEGER,
    );
    const unit = PreparedMaterialComposition.read([{ source: {}, count: 1 }], 1);
    if (!comp.ok || !unit.ok) throw new Error('fixture');
    expect(comp.value.merge(unit.value)).toEqual({ ok: false, error: 'count-overflow' });
  });

  it('matches separate fold-then-grant packing without combining actual grant facts', () => {
    for (let n = 0; n < 100; n++) {
      const rows = [slot((n % 27) + 1, n % 17), slot((n % 9) + 1, (n % 11) + 1)];
      const incoming = slot((n % 19) + 1, (n % 13) + 1);
      const pooled = n % 7;
      const plan = planVaultDeposit(rows, incoming, incoming.count, pooled, ids);
      let expected = rows;
      let refused = plan === null;
      if (plan !== null) {
        for (const grant of [
          plan.foldUnits > 0 ? { itemId: incoming.itemId, count: plan.foldUnits } : null,
          plan.grant,
        ]) {
          if (grant === null) continue;
          const add = planVaultRowAdd(expected, grant, ids);
          if (add === null) {
            refused = true;
            break;
          }
          expected = appliedVaultRowAdd(expected, add);
        }
      }
      expect(planVaultDepositMutation(rows, incoming, incoming.count, pooled, ids)).toEqual(
        refused ? null : { plan, rows: expected },
      );
    }
  });
});
