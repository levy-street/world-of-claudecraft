import { describe, expect, it } from 'vitest';
import {
  readMaterialSourceTransferSelection,
  resolveMaterialSourceTransferSelection,
} from '../src/sim/material_source_transfer_selection';
import { captureMaterialStackSelection } from '../src/sim/material_stack_selection';
import type { InvSlot } from '../src/sim/types';

const slots = (): InvSlot[] => [
  {
    itemId: 'copper_ore',
    count: 6,
    materialSources: [
      { source: {}, count: 1 },
      { source: { gatherer: { kind: 'character', id: 11, name: 'Ana' } }, count: 3 },
      { source: { gatherer: { kind: 'character', id: 12, name: 'Bru' }, signer: 'Bru' }, count: 2 },
    ],
  },
];
function intent(inventory = slots()) {
  return {
    itemId: 'copper_ore',
    target: captureMaterialStackSelection(inventory, 'copper_ore', 0)!,
    quantities: [{ sourceIndex: 1, count: 2 }],
  };
}
describe('bounded source transfer selection', () => {
  it('resolves indexes against the pinned authoritative composition without splitting', () => {
    const inventory = slots();
    const before = structuredClone(inventory);
    expect(resolveMaterialSourceTransferSelection(inventory, intent(inventory))).toEqual({
      ok: true,
      value: { count: 2, sources: [{ source: inventory[0].materialSources![1].source, count: 2 }] },
    });
    expect(inventory).toEqual(before);
  });
  it('refuses a stale source composition, changed total, moved row, or different item', () => {
    for (const mutate of [
      (held: InvSlot[]) => {
        held[0].materialSources = held[0].materialSources!.map((entry, i) =>
          i === 1
            ? { ...entry, source: { gatherer: { kind: 'character', id: 11, name: 'Zed' } } }
            : entry,
        );
      },
      (held: InvSlot[]) => {
        held[0].count++;
      },
      (held: InvSlot[]) => {
        held.unshift({ itemId: 'bread', count: 1 });
      },
      (held: InvSlot[]) => {
        held[0].itemId = 'iron_ore';
      },
    ]) {
      const inventory = slots();
      const selected = intent(inventory);
      mutate(inventory);
      expect(resolveMaterialSourceTransferSelection(inventory, selected).ok).toBe(false);
    }
  });
  it('rejects empty, repeated, short, fractional and out-of-range source requests', () => {
    for (const quantities of [
      [],
      [{ sourceIndex: 1, count: 0 }],
      [{ sourceIndex: 1, count: 4 }],
      [{ sourceIndex: 1, count: 1.5 }],
      [{ sourceIndex: 9, count: 1 }],
      [
        { sourceIndex: 1, count: 1 },
        { sourceIndex: 1, count: 1 },
      ],
    ]) {
      const inventory = slots();
      expect(
        resolveMaterialSourceTransferSelection(inventory, { ...intent(inventory), quantities }).ok,
      ).toBe(false);
    }
  });
  it('requires a present selection to be valid and clones the accepted intent', () => {
    for (const value of [
      undefined,
      null,
      [],
      {},
      { ...intent(), target: null },
      { ...intent(), quantities: null },
    ])
      expect(readMaterialSourceTransferSelection(value)).toBeNull();
    const source = intent();
    const parsed = readMaterialSourceTransferSelection(source)!;
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(parsed.target.anchor).not.toBe(source.target.anchor);
    expect(parsed.quantities).not.toBe(source.quantities);
  });
  it('keeps a 200-source vault choice below the existing 16KiB inbound frame limit', () => {
    const inventory: InvSlot[] = [
      {
        itemId: 'copper_ore',
        count: 200,
        materialSources: Array.from({ length: 200 }, (_, i) => ({
          source: {
            gatherer: { kind: 'character' as const, id: i + 1, name: 'WWWWWWWWWWWWWWWW' },
            signer: 'WWWWWWWWWWWWWWWW',
          },
          count: 1,
        })),
      },
    ];
    const selection = {
      ...intent(inventory),
      quantities: Array.from({ length: 200 }, (_, sourceIndex) => ({ sourceIndex, count: 1 })),
    };
    expect(Buffer.byteLength(JSON.stringify({ cmd: 'vault_withdraw', selection }))).toBeLessThan(
      16 * 1024,
    );
    const resolved = resolveMaterialSourceTransferSelection(inventory, selection);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.count).toBe(200);
      expect(resolved.value.sources).toHaveLength(200);
    }
  });
});
