// The item tooltip's "Requires Level N" line (item_level_gate.ts
// itemUseRequiredLevel, rendered by item_instance_tooltip.ts
// itemRequiredLevelLine) must name every level gate the sim enforces on an
// item and nothing else. Before this module the line only covered weapon and
// armor kinds, so a level-gated held off-hand refused to equip with no
// requirement on its card, and mounts never quoted the riding level.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { isLevelGatedEquipment, itemUseRequiredLevel } from '../src/sim/item_level_gate';
import { requiredLevelFor } from '../src/sim/item_level_req';
import { MOUNT_TRAIN_MIN_LEVEL } from '../src/sim/mounts_training';
import { Sim } from '../src/sim/sim';
import type { ItemDef, PlayerClass, SimEvent } from '../src/sim/types';
import { itemRequiredLevelLine } from '../src/ui/item_instance_tooltip';

const ALL = Object.values(ITEMS) as ItemDef[];
// The equip path's own kind filter (items.ts equipItem), spelled out literally
// so the tests do not select their cases through the predicate under test.
const EQUIP_KINDS = ['weapon', 'armor', 'held_offhand'] as const;
const CLASSES: PlayerClass[] = ['warrior', 'mage', 'priest', 'rogue', 'hunter', 'paladin'];

function gatedOfKind(kind: (typeof EQUIP_KINDS)[number]): ItemDef[] {
  return ALL.filter((d) => d.slot && d.kind === kind && requiredLevelFor(d) > 1);
}

describe('itemUseRequiredLevel', () => {
  it('pins the riding level the mount lines quote', () => {
    expect(MOUNT_TRAIN_MIN_LEVEL).toBe(20);
  });

  it('quotes the equip gate for every wearable kind, held off-hands included', () => {
    for (const kind of EQUIP_KINDS) {
      const gated = gatedOfKind(kind);
      // The bug this pins: real catalog pieces of every equip kind carry a gate.
      expect(gated.length, kind).toBeGreaterThan(0);
      for (const d of gated) {
        expect(isLevelGatedEquipment(d), d.id).toBe(true);
        expect(itemUseRequiredLevel(d), d.id).toBe(requiredLevelFor(d));
      }
    }
  });

  it('quotes the riding level on every mount and on the riding service entry', () => {
    const mounts = ALL.filter((d) => d.kind === 'mount');
    const riding = ALL.filter((d) => d.teachesRiding);
    expect(mounts.length).toBeGreaterThan(0);
    expect(riding.length).toBeGreaterThan(0);
    for (const d of [...mounts, ...riding]) expect(itemUseRequiredLevel(d), d.id).toBe(20);
  });

  it('never gates kinds the sim does not level-gate, even at rare quality', () => {
    // requiredLevelFor is a tier number for these (salvage/enchant math), not a gate.
    const ungated = ALL.filter(
      (d) =>
        !(d.slot && (EQUIP_KINDS as readonly string[]).includes(d.kind)) &&
        d.kind !== 'mount' &&
        !d.teachesRiding,
    );
    expect(ungated.some((d) => requiredLevelFor(d) > 1)).toBe(true);
    for (const d of ungated) expect(itemUseRequiredLevel(d), d.id).toBe(1);
  });
});

describe('itemUseRequiredLevel matches the live equip gate', () => {
  function errorTexts(events: SimEvent[]): string[] {
    return events
      .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
      .map((e) => e.text);
  }

  for (const kind of EQUIP_KINDS) {
    it(`refuses a ${kind} below the quoted level and equips it at that level`, () => {
      let picked: { def: ItemDef; cls: PlayerClass } | undefined;
      for (const def of gatedOfKind(kind)) {
        const cls = CLASSES.find((c) => canEquipItem(c, def));
        if (cls && !def.unique) {
          picked = { def, cls };
          break;
        }
      }
      expect(picked, kind).toBeDefined();
      const { def, cls } = picked as { def: ItemDef; cls: PlayerClass };
      const req = itemUseRequiredLevel(def);
      const attempt = (level: number) => {
        const sim = new Sim({ seed: 7, playerClass: cls, noPlayer: true, autoEquip: false });
        const pid = sim.addPlayer(cls, 'Tester');
        sim.setPlayerLevel(level, pid);
        sim.addItem(def.id, 1, pid);
        sim.drainEvents();
        sim.equipItem(def.id, pid);
        return errorTexts(sim.drainEvents());
      };
      expect(attempt(req - 1)).toContain(`You must be level ${req} to equip that.`);
      expect(attempt(req).some((e) => e.startsWith('You must be level'))).toBe(false);
    });
  }
});

describe('itemRequiredLevelLine', () => {
  const offhand = gatedOfKind('held_offhand')[0];

  it('shows the requirement on a held off-hand, red only below the gate', () => {
    const req = requiredLevelFor(offhand);
    const below = itemRequiredLevelLine(offhand, req - 1);
    const at = itemRequiredLevelLine(offhand, req);
    expect(below).toContain(`Requires Level ${req}`);
    expect(below).toContain('tt-red');
    expect(at).toContain(`Requires Level ${req}`);
    expect(at).not.toContain('tt-red');
  });

  it('keeps the line on gated weapons and armor', () => {
    for (const kind of ['weapon', 'armor'] as const) {
      const d = gatedOfKind(kind)[0];
      expect(itemRequiredLevelLine(d, 1), d.id).toContain(`Requires Level ${requiredLevelFor(d)}`);
    }
  });

  it('shows the riding level on mount reins and the riding service entry', () => {
    const mount = ALL.find((d) => d.kind === 'mount') as ItemDef;
    const riding = ALL.find((d) => d.teachesRiding) as ItemDef;
    expect(itemRequiredLevelLine(mount, 1)).toContain('Requires Level 20');
    expect(itemRequiredLevelLine(riding, 1)).toContain('Requires Level 20');
  });

  it('renders nothing for an ungated item, including a high-tier material', () => {
    const food = ALL.find((d) => d.kind === 'food') as ItemDef;
    expect(itemRequiredLevelLine(food, 1)).toBe('');
    const tiered = ALL.find(
      (d) => !d.slot && d.kind !== 'mount' && !d.teachesRiding && requiredLevelFor(d) > 1,
    ) as ItemDef;
    expect(tiered).toBeDefined();
    expect(itemRequiredLevelLine(tiered, 1)).toBe('');
  });
});
