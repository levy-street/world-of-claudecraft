import { describe, expect, it } from 'vitest';
import type { MaterialComposition } from '../src/sim/material_sources';
import { materialSourcesDialogModel } from '../src/ui/material_sources_dialog';

const source = (id: number, name: string) => ({
  gatherer: { kind: 'character' as const, id, name },
});

describe('material source dialog model', () => {
  it('keeps every descriptor available to the details dialog', () => {
    const composition: MaterialComposition = Array.from({ length: 9 }, (_, index) => ({
      source: source(index + 1, `Gatherer ${index + 1}`),
      count: index + 1,
    }));
    const model = materialSourcesDialogModel(composition, false);

    expect(model.selectable).toBe(false);
    expect(model.choices).toHaveLength(9);
    expect(model.total).toBe(45);
  });

  it('marks the same uncapped rows as selectable for a separation picker', () => {
    const composition: MaterialComposition = [
      { source: source(1, 'Ana'), count: 2 },
      { source: source(2, 'Bru'), count: 4 },
    ];
    const model = materialSourcesDialogModel(composition, true);

    expect(model.selectable).toBe(true);
    expect(model.choices.map((choice) => choice.row.count)).toEqual([2, 4]);
    expect(model.choices.map((choice) => choice.sourceIndex)).toEqual([0, 1]);
    expect(model.choices.map((choice) => choice.row.key)).toHaveLength(2);
  });
});
