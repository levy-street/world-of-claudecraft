import { describe, expect, it } from 'vitest';
import { canonicalMaterialComposition, type MaterialSource } from '../src/sim/material_sources';
import { captureMaterialStackSelection } from '../src/sim/material_stack_selection';
import type { InvSlot } from '../src/sim/types';
import {
  bagMaterialDepositSelection,
  bankMaterialWithdrawSelection,
  guildMaterialWithdrawSelection,
  vaultMaterialWithdrawSelection,
} from '../src/ui/material_source_storage_actions';
import {
  materialSourceChoices,
  selectedMaterialComposition,
} from '../src/ui/material_sources_view';
import type { IWorld } from '../src/world_api';

const ANA: MaterialSource = { gatherer: { kind: 'character', id: 11, name: 'Ana' } };
const BRU: MaterialSource = { gatherer: { kind: 'character', id: 22, name: 'Bru' } };

function sources(rows: readonly { source: MaterialSource; count: number }[]) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const result = canonicalMaterialComposition(rows, total);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('material source storage action session', () => {
  it('captures the displayed canonical sources and pin together at picker open', () => {
    const slot: InvSlot = {
      itemId: 'copper_ore',
      count: 3,
      materialSources: sources([
        { source: ANA, count: 2 },
        { source: BRU, count: 1 },
      ]),
    };
    const inventory = [slot];
    const deposits: unknown[][] = [];
    const world = {
      inventory,
      bankDeposit: (...args: unknown[]) => deposits.push(args),
    } as unknown as IWorld;
    const factory = bagMaterialDepositSelection(world, slot, 'bank', () => {});

    // A live update before activation must be the one the picker and pin share.
    slot.count = 5;
    slot.materialSources = sources([
      { source: BRU, count: 4 },
      { source: ANA, count: 1 },
    ]);
    const session = factory?.();
    expect(session).not.toBeNull();
    if (!session) return;
    const capturedTarget = captureMaterialStackSelection(inventory, slot.itemId, 0);
    const choices = materialSourceChoices(session.sources);
    const bru = choices.find((choice) => choice.row.name === 'Bru');
    expect(bru).toBeDefined();
    expect(session.sources).toEqual(slot.materialSources);

    // A later update cannot change the already-painted source indexes or pin.
    slot.count = 5;
    slot.materialSources = sources([{ source: ANA, count: 5 }]);
    const selected = selectedMaterialComposition(choices, new Map([[bru?.sourceIndex ?? -1, 2]]));
    expect(selected).not.toBeNull();
    if (!selected) return;
    session.onConfirm(selected);

    expect(deposits).toEqual([
      [
        0,
        2,
        {
          itemId: 'copper_ore',
          target: capturedTarget,
          quantities: [{ sourceIndex: bru?.sourceIndex, count: 2 }],
        },
      ],
    ]);
    expect(captureMaterialStackSelection(inventory, slot.itemId, 0)?.pin).not.toBe(
      capturedTarget?.pin,
    );
  });

  it('puts the captured selection in each storage command envelope', () => {
    const slot: InvSlot = {
      itemId: 'copper_ore',
      count: 2,
      materialSources: sources([
        { source: ANA, count: 1 },
        { source: BRU, count: 1 },
      ]),
    };
    const calls: { bank?: unknown[]; guild?: unknown[]; vault?: unknown[] } = {};
    const world = {
      inventory: [],
      bankInfo: { slots: [slot] },
      guildBankInfo: { slots: [slot] },
      vaultInfo: { special: [slot] },
      bankWithdraw: (...args: unknown[]) => {
        calls.bank = args;
      },
      guildBankWithdraw: (...args: unknown[]) => {
        calls.guild = args;
      },
      vaultWithdraw: (...args: unknown[]) => {
        calls.vault = args;
      },
    } as unknown as IWorld;
    const factories = [
      bankMaterialWithdrawSelection(world, slot.itemId, 0, () => {}),
      guildMaterialWithdrawSelection(world, slot.itemId, 0, () => {}),
      vaultMaterialWithdrawSelection(world, slot.itemId, 0, () => {}),
    ];
    const sessions = factories.map((factory) => factory?.());
    const choice = materialSourceChoices(sessions[0]?.sources)[0];
    const selected = selectedMaterialComposition(
      choice ? [choice] : [],
      new Map([[choice?.sourceIndex ?? -1, 1]]),
    );
    expect(selected).not.toBeNull();
    if (!selected) return;
    for (const session of sessions) session?.onConfirm(selected);

    const intent = {
      itemId: slot.itemId,
      target: captureMaterialStackSelection([slot], slot.itemId, 0),
      quantities: [{ sourceIndex: choice?.sourceIndex, count: 1 }],
    };
    expect(calls.bank).toEqual([0, 1, intent]);
    expect(calls.guild).toEqual([0, 1, intent]);
    expect(calls.vault).toEqual([slot.itemId, 1, { index: 0, selection: intent }]);
  });
});
