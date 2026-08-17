import { describe, expect, it } from 'vitest';
import { destructionRuinPips } from '../src/ui/hud/warlock/destruction_resource_view';

describe('destruction resource view', () => {
  it('shows a clamped five-pip Ruin meter only for committed Destruction', () => {
    for (let amount = 0; amount <= 5; amount++) {
      const auras = amount === 0 ? [] : [{ kind: 'destruction_ruin', stacks: amount }];
      expect(destructionRuinPips('destruction', auras)).toBe(amount);
    }

    const auras = [{ kind: 'destruction_ruin', stacks: 3 }];
    expect(destructionRuinPips('affliction', auras)).toBe(0);
    expect(destructionRuinPips('destruction', [{ kind: 'destruction_ruin', stacks: 99 }])).toBe(5);
  });
});
