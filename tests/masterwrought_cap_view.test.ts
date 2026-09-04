// The Masterwrought cap-visibility pure core (Masterwrought phase 14):
// src/ui/masterwrought_cap_view.ts. The load-bearing claim is EQUIVALENCE
// with the sim's own equip rule: the readout counts exactly what
// masterwroughtConflictSlot counts, so the sheet can never say "1 of 2" while
// the equip path refuses (or vice versa).
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { MASTERWROUGHT_EQUIP_CAP, masterwroughtConflictSlot } from '../src/sim/equipment_rules';
import type { EquipSlot } from '../src/sim/types';
import {
  masterwroughtCapReadout,
  masterwroughtTooltipLines,
  wornMasterwroughtSlots,
} from '../src/ui/masterwrought_cap_view';

// Real masterwrought defs (content/items.ts, the crafted-apex family) plus a
// plain piece, so the walk is proven over live content rather than fixtures.
const MW_MAINHAND = 'duskforged_warblade';
const MW_OFFHAND = 'duskforged_bulwark';
const MW_NECK = 'wyrmfall_pendant';
const PLAIN = 'eastbrook_arming_sword';

describe('wornMasterwroughtSlots', () => {
  it('counts exactly the worn ids whose def carries the flag, in slot order', () => {
    expect(ITEMS[MW_MAINHAND]?.masterwrought).toBe(true);
    expect(ITEMS[MW_NECK]?.masterwrought).toBe(true);
    expect(ITEMS[PLAIN]?.masterwrought).toBeUndefined();
    const equipment: Partial<Record<EquipSlot, string>> = {
      mainhand: MW_MAINHAND,
      neck: MW_NECK,
      chest: PLAIN,
    };
    expect(wornMasterwroughtSlots(equipment, ITEMS)).toEqual(['mainhand', 'neck']);
  });

  it('an unresolvable worn id counts as not flagged, never throws', () => {
    expect(wornMasterwroughtSlots({ mainhand: 'qa_no_such_item', neck: MW_NECK }, ITEMS)).toEqual([
      'neck',
    ]);
  });
});

describe('masterwroughtCapReadout', () => {
  it('is null with nothing Masterwrought worn (plain gear included)', () => {
    expect(masterwroughtCapReadout({}, ITEMS)).toBeNull();
    expect(masterwroughtCapReadout({ mainhand: PLAIN }, ITEMS)).toBeNull();
  });

  it('reports used against the imported cap, atCap exactly at the rule cap', () => {
    expect(masterwroughtCapReadout({ mainhand: MW_MAINHAND }, ITEMS)).toEqual({
      used: 1,
      cap: MASTERWROUGHT_EQUIP_CAP,
      atCap: false,
    });
    expect(masterwroughtCapReadout({ mainhand: MW_MAINHAND, offhand: MW_OFFHAND }, ITEMS)).toEqual({
      used: 2,
      cap: MASTERWROUGHT_EQUIP_CAP,
      atCap: true,
    });
  });
});

describe('equivalence with the sim equip rule (the drift pin)', () => {
  it('atCap iff masterwroughtConflictSlot refuses a fresh flagged piece with reason cap', () => {
    const lookup = (id: string) => ITEMS[id];
    const cases: Partial<Record<EquipSlot, string>>[] = [
      {},
      { mainhand: MW_MAINHAND },
      { mainhand: MW_MAINHAND, offhand: MW_OFFHAND },
      { mainhand: MW_MAINHAND, chest: PLAIN },
      { neck: MW_NECK, mainhand: 'qa_no_such_item' },
    ];
    for (const equipment of cases) {
      const readout = masterwroughtCapReadout(equipment, ITEMS);
      // An incoming flagged NECK piece aimed at an empty slot set (no
      // ignores beyond its own empty target) is the cleanest cap probe: the
      // conflict answer must be 'cap' exactly when the readout says atCap.
      const conflict = masterwroughtConflictSlot(
        ITEMS[MW_NECK],
        equipment,
        lookup,
        equipment.neck ? ['neck'] : [],
      );
      const atCap = readout?.atCap === true;
      expect(conflict?.reason === 'cap', JSON.stringify(equipment)).toBe(atCap);
      // ...and the counted slots are exactly the flag walk the rule runs.
      const used = readout?.used ?? 0;
      expect(wornMasterwroughtSlots(equipment, ITEMS)).toHaveLength(used);
    }
  });
});

describe('masterwroughtTooltipLines (the tooltip rows the hud renders)', () => {
  it('always leads with the counted-family line carrying the formatted cap', () => {
    const lines = masterwroughtTooltipLines({}, ITEMS);
    expect(lines[0]).toEqual({
      key: 'hudChrome.itemMasterwrought',
      values: { count: String(MASTERWROUGHT_EQUIP_CAP) },
    });
    // Below the cap there is exactly the one line: no at-cap chrome early.
    expect(lines).toHaveLength(1);
    expect(masterwroughtTooltipLines({ mainhand: MW_MAINHAND }, ITEMS)).toHaveLength(1);
  });

  it('appends the at-cap line exactly when the worn set consumed the budget', () => {
    const lines = masterwroughtTooltipLines({ mainhand: MW_MAINHAND, offhand: MW_OFFHAND }, ITEMS);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({
      key: 'hudChrome.masterwrought.tooltipAtCap',
      values: { cap: String(MASTERWROUGHT_EQUIP_CAP) },
    });
  });
});
