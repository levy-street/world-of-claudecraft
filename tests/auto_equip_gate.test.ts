// The worn-family half of auto-equip's silent-skip gate
// (src/sim/auto_equip_gate.ts). The contract is agreement with the EXPLICIT
// equip path in src/sim/items.ts: where that path would refuse, auto-equip must
// decline quietly. These pin both rules and, decisively, the instance-aware arm
// the def-only peek used to miss.

import { describe, expect, it } from 'vitest';
import { type AutoEquipWornState, autoEquipFamilyConflict } from '../src/sim/auto_equip_gate';
import type { EquipSlot, ItemDef, ItemInstancePayload } from '../src/sim/types';

const RING_A: ItemDef = {
  id: 'gate_ring_a',
  name: 'Gate Ring A',
  kind: 'armor',
  slot: 'ring',
  quality: 'epic',
  stats: {},
  sellValue: 1,
} as ItemDef;

const RING_B: ItemDef = { ...RING_A, id: 'gate_ring_b', name: 'Gate Ring B' } as ItemDef;

/** The unique-equipped pair. Legendary QUALITY is what makes a def unique
 *  (isUniqueEquipped), and heroicOf keys the two into ONE family. */
const UNIQUE_A: ItemDef = { ...RING_A, id: 'gate_unique_a', quality: 'legendary' } as ItemDef;
const UNIQUE_B: ItemDef = {
  ...RING_A,
  id: 'gate_unique_b',
  quality: 'legendary',
  heroicOf: 'gate_unique_a',
} as ItemDef;

const MW_A: ItemDef = { ...RING_A, id: 'gate_mw_a', masterwrought: true } as ItemDef;
const MW_B: ItemDef = { ...RING_A, id: 'gate_mw_b', masterwrought: true } as ItemDef;
const MW_C: ItemDef = { ...RING_A, id: 'gate_mw_c', masterwrought: true } as ItemDef;

const DEFS: Record<string, ItemDef> = {
  [RING_A.id]: RING_A,
  [RING_B.id]: RING_B,
  [UNIQUE_A.id]: UNIQUE_A,
  [UNIQUE_B.id]: UNIQUE_B,
  [MW_A.id]: MW_A,
  [MW_B.id]: MW_B,
  [MW_C.id]: MW_C,
};
const lookup = (id: string): ItemDef | undefined => DEFS[id];

function worn(
  equipment: Partial<Record<EquipSlot, string>>,
  inventory: { itemId: string; count: number; instance?: ItemInstancePayload }[] = [],
  equipmentInstance?: Partial<Record<EquipSlot, ItemInstancePayload>>,
): AutoEquipWornState {
  return { equipment, inventory, equipmentInstance } as AutoEquipWornState;
}

/** A PROMOTED copy: perfected plus a legendary roll, which is what makes a copy
 *  unique-equipped on a def that is not (isUniqueEquipped's instance arm; a
 *  legacy legendary roll WITHOUT `perfected` deliberately does not count). */
const promoted = {
  perfected: true,
  rolled: { quality: 'legendary' },
} as unknown as ItemInstancePayload;

describe('autoEquipFamilyConflict', () => {
  it('passes an ordinary piece with nothing conflicting worn', () => {
    expect(autoEquipFamilyConflict(RING_A, RING_A.id, worn({ ring2: RING_B.id }), lookup)).toBe(
      false,
    );
  });

  it('refuses when the unique-equipped family is already worn', () => {
    const state = worn({ ring1: UNIQUE_B.id }, [{ itemId: UNIQUE_A.id, count: 1 }]);
    expect(autoEquipFamilyConflict(UNIQUE_A, UNIQUE_A.id, state, lookup)).toBe(true);
  });

  it('refuses two PROMOTED copies of one item: the arm a def-only peek missed entirely', () => {
    // THE regression this item closes. RING_A's def is epic, so a def-only read
    // says neither side is unique-equipped and auto-equip happily wears the
    // second copy; the explicit equip path in items.ts has judged both sides by
    // their instances since phase 13 and refuses. Both copies here are promoted
    // (perfected plus a legendary roll), so both count and the family matches.
    const state = worn(
      { ring1: RING_A.id },
      [{ itemId: RING_A.id, count: 1, instance: promoted }],
      { ring1: promoted },
    );
    expect(autoEquipFamilyConflict(RING_A, RING_A.id, state, lookup)).toBe(true);
    // Each side is load-bearing on its own. Drop the WORN payload and the worn
    // copy is an ordinary epic ring again, so nothing conflicts...
    const wornPlain = worn({ ring1: RING_A.id }, [
      { itemId: RING_A.id, count: 1, instance: promoted },
    ]);
    expect(autoEquipFamilyConflict(RING_A, RING_A.id, wornPlain, lookup)).toBe(false);
    // ...and drop the INCOMING payload and the rule short-circuits before it
    // ever looks at what is worn.
    const incomingPlain = worn({ ring1: RING_A.id }, [{ itemId: RING_A.id, count: 1 }], {
      ring1: promoted,
    });
    expect(autoEquipFamilyConflict(RING_A, RING_A.id, incomingPlain, lookup)).toBe(false);
  });

  it('a legacy legendary roll WITHOUT perfected does not count on either side', () => {
    // The deliberate migration carve-out in isUniqueEquipped: a live character
    // wearing two legacy legendary-rolled copies is not retroactively benched.
    const legacy = { rolled: { quality: 'legendary' } } as unknown as ItemInstancePayload;
    const state = worn({ ring1: RING_A.id }, [{ itemId: RING_A.id, count: 1, instance: legacy }], {
      ring1: legacy,
    });
    expect(autoEquipFamilyConflict(RING_A, RING_A.id, state, lookup)).toBe(false);
  });

  it('peeks the copy an auto-equip would actually LIFT (highest index), not a lower one', () => {
    // Auto-equip passes no slotIndex, so it consumes the highest-index unit. A
    // promoted copy sitting UNDER a plain one is not the copy being equipped,
    // and must not make the gate refuse.
    const state = worn({ ring1: UNIQUE_A.id }, [
      { itemId: RING_A.id, count: 1, instance: promoted },
      { itemId: RING_A.id, count: 1 },
    ]);
    expect(autoEquipFamilyConflict(RING_A, RING_A.id, state, lookup)).toBe(false);
  });

  it('refuses at the Masterwrought worn cap', () => {
    const state = worn({ ring1: MW_A.id, ring2: MW_B.id }, [{ itemId: MW_C.id, count: 1 }]);
    expect(autoEquipFamilyConflict(MW_C, MW_C.id, state, lookup)).toBe(true);
  });

  it('allows a Masterwrought piece under the cap', () => {
    const state = worn({ ring1: MW_A.id }, [{ itemId: MW_B.id, count: 1 }]);
    expect(autoEquipFamilyConflict(MW_B, MW_B.id, state, lookup)).toBe(false);
  });

  it('refuses at the Masterwrought LEGENDARY sub-cap, read off the incoming copy', () => {
    // One legendary Masterwrought piece is already worn; the incoming copy is
    // legendary by its ROLL, so the sub-cap must count it.
    const state = worn({ ring1: MW_A.id }, [{ itemId: MW_B.id, count: 1, instance: promoted }], {
      ring1: promoted,
    });
    expect(autoEquipFamilyConflict(MW_B, MW_B.id, state, lookup)).toBe(true);
  });

  it('declines rather than displacing: a worn conflict is never exempted as a swap target', () => {
    // ignoreSlots is empty on both rules, so even the slot the piece would
    // naturally take counts as a conflict. Strictly more conservative than the
    // explicit path, which is the intended asymmetry.
    const state = worn({ ring1: UNIQUE_A.id, ring2: UNIQUE_B.id }, [
      { itemId: UNIQUE_A.id, count: 1 },
    ]);
    expect(autoEquipFamilyConflict(UNIQUE_A, UNIQUE_A.id, state, lookup)).toBe(true);
  });
});
