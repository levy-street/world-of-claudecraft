// The item tooltip's "Requires Level N" line (item_level_gate.ts
// itemUseRequiredLevel, rendered by item_instance_tooltip.ts
// itemRequiredLevelLine) must name every level gate the sim enforces on an
// item and nothing else. Before this module the line only covered weapon and
// armor kinds, so a level-gated held off-hand refused to equip with no
// requirement on its card, and mounts never quoted the riding level.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { isLevelGatedEquipment, itemUseRequiredLevel } from '../src/sim/item_level_gate';
import { requiredLevelFor } from '../src/sim/item_level_req';
import { MOUNT_TRAIN_MIN_LEVEL } from '../src/sim/mounts_training';
import type { ItemDef } from '../src/sim/types';
import { itemRequiredLevelLine } from '../src/ui/item_instance_tooltip';

const ALL = Object.values(ITEMS) as ItemDef[];

describe('itemUseRequiredLevel', () => {
  it('quotes the equip gate for every wearable kind, held off-hands included', () => {
    const offhands = ALL.filter((d) => d.kind === 'held_offhand' && requiredLevelFor(d) > 1);
    // The bug this pins: real catalog off-hands carry an equip gate.
    expect(offhands.length).toBeGreaterThan(0);
    for (const d of ALL.filter(isLevelGatedEquipment)) {
      expect(itemUseRequiredLevel(d)).toBe(requiredLevelFor(d));
    }
  });

  it('quotes the riding level on every mount and on the riding service entry', () => {
    const mounts = ALL.filter((d) => d.kind === 'mount');
    const riding = ALL.filter((d) => d.teachesRiding);
    expect(mounts.length).toBeGreaterThan(0);
    expect(riding.length).toBeGreaterThan(0);
    for (const d of [...mounts, ...riding]) {
      expect(itemUseRequiredLevel(d)).toBe(MOUNT_TRAIN_MIN_LEVEL);
    }
  });

  it('never gates kinds the sim does not level-gate, even at rare quality', () => {
    // requiredLevelFor is a tier number for these (salvage/enchant math), not a gate.
    const ungated = ALL.filter(
      (d) => !isLevelGatedEquipment(d) && d.kind !== 'mount' && !d.teachesRiding,
    );
    expect(ungated.some((d) => requiredLevelFor(d) > 1)).toBe(true);
    for (const d of ungated) expect(itemUseRequiredLevel(d)).toBe(1);
  });
});

describe('itemRequiredLevelLine', () => {
  const offhand = ALL.find((d) => d.kind === 'held_offhand' && requiredLevelFor(d) > 1) as ItemDef;
  const mount = ALL.find((d) => d.kind === 'mount') as ItemDef;

  it('shows the requirement on a held off-hand, red only below the gate', () => {
    const req = requiredLevelFor(offhand);
    const below = itemRequiredLevelLine(offhand, req - 1);
    const at = itemRequiredLevelLine(offhand, req);
    expect(below).toContain(`Requires Level ${req}`);
    expect(below).toContain('tt-red');
    expect(at).toContain(`Requires Level ${req}`);
    expect(at).not.toContain('tt-red');
  });

  it('shows the riding level on mount reins', () => {
    expect(itemRequiredLevelLine(mount, 1)).toContain(`Requires Level ${MOUNT_TRAIN_MIN_LEVEL}`);
  });

  it('renders nothing for an ungated item', () => {
    const food = ALL.find((d) => d.kind === 'food') as ItemDef;
    expect(itemRequiredLevelLine(food, 1)).toBe('');
  });
});
