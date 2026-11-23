// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow } from '../src/ui/bags_window';
import type { MaterialSourcesDialogOptions } from '../src/ui/material_sources_dialog';

// Exercise the real gesture dispatcher without constructing the unrelated bag
// drag/paint controllers. Every sink this market branch may use is explicit.
function click(slot: InvSlot) {
  const stage = vi.fn();
  const open = vi.fn<(options: MaterialSourcesDialogOptions) => void>();
  const isMarketSell = vi.fn(() => true);
  const root = document.createElement('div');
  const host = {
    deps: { stageMarketSell: stage, openMaterialSources: open, root: () => root, isMarketSell },
    partyTradeWindowActive: () => false,
    bagMode: () => ({ marketSell: true }),
  };
  const dispatch = (
    BagsWindow.prototype as unknown as {
      runBagAction(item: (typeof ITEMS)[string], slot: InvSlot, event: MouseEvent): void;
    }
  ).runBagAction;
  dispatch.call(host, ITEMS[slot.itemId], slot, new MouseEvent('click'));
  return { stage, open, isMarketSell };
}

describe('bag market staging for mixed makers', () => {
  it('does not stage a delayed source confirmation after leaving the market sell tab', () => {
    const { stage, open, isMarketSell } = click({
      itemId: 'minor_healing_potion',
      count: 2,
      materialSources: [
        { source: {}, count: 1 },
        { source: { signer: 'Ana' }, count: 1 },
      ],
    });
    isMarketSell.mockReturnValue(false);
    open.mock.calls[0][0].onConfirm?.({
      count: 1,
      quantities: [{ sourceIndex: 1, count: 1 }],
      sources: [{ source: { signer: 'Ana' }, count: 1 }],
    });
    expect(stage).not.toHaveBeenCalled();
  });

  it('opens a one-unit maker picker and stages the selected crafter', () => {
    const slot: InvSlot = {
      itemId: 'minor_healing_potion',
      count: 3,
      materialSources: [
        { source: { signer: 'Ana' }, count: 1 },
        { source: { signer: 'Bru' }, count: 2 },
      ],
    };
    const { stage, open } = click(slot);
    expect(stage).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledOnce();
    const options = open.mock.calls[0][0];
    expect(options.limit).toBe(1);
    options.onConfirm?.({
      count: 1,
      quantities: [{ sourceIndex: 1, count: 1 }],
      sources: [{ source: { signer: 'Bru' }, count: 1 }],
    });
    expect(stage).toHaveBeenCalledExactlyOnceWith(slot.itemId, { signer: 'Bru' });
  });

  it('stages a homogeneous crafter directly and leaves material staging unchanged', () => {
    const slot: InvSlot = {
      itemId: 'minor_healing_potion',
      count: 2,
      materialSources: [{ source: { signer: 'Ana' }, count: 2 }],
    };
    const potion = click(slot);
    expect(potion.stage).toHaveBeenCalledExactlyOnceWith(slot.itemId, { signer: 'Ana' });
    expect(potion.open).not.toHaveBeenCalled();
    const material = click({ ...slot, itemId: 'copper_ore' });
    expect(material.stage).toHaveBeenCalledExactlyOnceWith('copper_ore', undefined);
    expect(material.open).not.toHaveBeenCalled();
  });
});
