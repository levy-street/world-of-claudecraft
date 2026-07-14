import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BACKPACK_SLOTS, bagSlotsOf } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import { buildCharBags } from '../src/ui/char_bags_view';

// linen_pouch is a real kind:'bag' item from src/sim/content/items.ts
// (bagSlots: 6); travelers_knapsack (bagSlots: 8) exercises a second
// occupied socket. Both are pulled through the real ITEMS table so the
// partition math is pinned against the actual sim data, never a fixture
// that could drift from src/sim/bags.ts's own capacity rules.
const LINEN_POUCH_SLOTS = bagSlotsOf(ITEMS.linen_pouch);
const KNAPSACK_SLOTS = bagSlotsOf(ITEMS.travelers_knapsack);

const NO_BAGS: readonly (string | null)[] = [null, null, null, null];

function slotsOf(count: number, itemId = 'baked_bread'): InvSlot[] {
  return Array.from({ length: count }, () => ({ itemId, count: 1 }));
}

describe('char_bags_view: BACKPACK_SLOTS/bagSlotsOf pin', () => {
  it('linen_pouch and travelers_knapsack carry the expected real bagSlots values', () => {
    // Pins this test file's own assumptions against src/sim/content/items.ts
    // so a content edit surfaces here rather than silently drifting.
    expect(LINEN_POUCH_SLOTS).toBe(6);
    expect(KNAPSACK_SLOTS).toBe(8);
    expect(BACKPACK_SLOTS).toBe(16);
  });
});

describe('char_bags_view: container selector', () => {
  it('lists only the backpack when every socket is empty', () => {
    const model = buildCharBags({
      inventory: [],
      bags: NO_BAGS,
      items: ITEMS,
      selectedId: 'backpack',
    });
    expect(model.containers).toHaveLength(1);
    expect(model.containers[0]).toEqual({
      id: 'backpack',
      socket: null,
      label: '1',
      exists: true,
      capacity: BACKPACK_SLOTS,
    });
  });

  it('excludes empty sockets, keyed to the occupied socket index (not the list position)', () => {
    // Socket 0 empty, socket 1 occupied: the selector must show backpack + ONE
    // more entry (never a phantom placeholder for socket 0), and the id stays
    // tied to the real socket index (bag2 = socket 1), per the id contract.
    const bags: readonly (string | null)[] = [null, 'linen_pouch', null, null];
    const model = buildCharBags({ inventory: [], bags, items: ITEMS, selectedId: 'backpack' });
    expect(model.containers).toHaveLength(2);
    expect(model.containers[1].id).toBe('bag2');
    expect(model.containers[1].socket).toBe(1);
    expect(model.containers[1].capacity).toBe(LINEN_POUCH_SLOTS);
    // Positional label: the SECOND listed container reads '2', regardless of
    // its underlying socket index.
    expect(model.containers[1].label).toBe('2');
  });

  it('labels every listed container as a sequential 1-based ordinal, backpack first', () => {
    const bags: readonly (string | null)[] = [
      'linen_pouch',
      null,
      'travelers_knapsack',
      'wolfhide_satchel',
    ];
    const model = buildCharBags({ inventory: [], bags, items: ITEMS, selectedId: 'backpack' });
    expect(model.containers.map((c) => c.id)).toEqual(['backpack', 'bag1', 'bag3', 'bag4']);
    expect(model.containers.map((c) => c.label)).toEqual(['1', '2', '3', '4']);
  });

  it('marks every listed container exists: true (only existing containers are ever listed)', () => {
    const bags: readonly (string | null)[] = ['linen_pouch', null, null, null];
    const model = buildCharBags({ inventory: [], bags, items: ITEMS, selectedId: 'backpack' });
    expect(model.containers.every((c) => c.exists)).toBe(true);
  });
});

describe('char_bags_view: selectedId resolution', () => {
  it('resolves the matching container by id', () => {
    const bags: readonly (string | null)[] = ['linen_pouch', null, null, null];
    const model = buildCharBags({ inventory: [], bags, items: ITEMS, selectedId: 'bag1' });
    expect(model.selected.id).toBe('bag1');
  });

  it('falls back to the backpack for a stale selectedId (the selected socket emptied out)', () => {
    const bags: readonly (string | null)[] = [null, null, null, null];
    const model = buildCharBags({ inventory: [], bags, items: ITEMS, selectedId: 'bag1' });
    expect(model.selected.id).toBe('backpack');
  });

  it('falls back to the backpack for a totally unknown selectedId', () => {
    const model = buildCharBags({
      inventory: [],
      bags: NO_BAGS,
      items: ITEMS,
      selectedId: 'not-a-real-container',
    });
    expect(model.selected.id).toBe('backpack');
  });
});

describe('char_bags_view: used/capacity counts', () => {
  it('counts used as the occupied cells within the SELECTED container only', () => {
    // 10 items fill part of the backpack (capacity 16): backpack shows 10 used.
    const inventory = slotsOf(10);
    const model = buildCharBags({
      inventory,
      bags: NO_BAGS,
      items: ITEMS,
      selectedId: 'backpack',
    });
    expect(model.used).toBe(10);
    expect(model.selected.capacity).toBe(BACKPACK_SLOTS);
  });

  it('an empty selected container reports used: 0', () => {
    const bags: readonly (string | null)[] = ['linen_pouch', null, null, null];
    const model = buildCharBags({ inventory: [], bags, items: ITEMS, selectedId: 'bag1' });
    expect(model.used).toBe(0);
    expect(model.cells.every((c) => c.item === null && c.count === 0)).toBe(true);
  });

  it('a fully-packed backpack plus a partially-filled bag reports each container correctly', () => {
    const bags: readonly (string | null)[] = ['linen_pouch', null, null, null];
    // Fill the whole backpack (16) plus 2 slots into the bag1 virtual range (18 total).
    const inventory = slotsOf(BACKPACK_SLOTS + 2);
    const backpackModel = buildCharBags({ inventory, bags, items: ITEMS, selectedId: 'backpack' });
    expect(backpackModel.used).toBe(BACKPACK_SLOTS);
    const bag1Model = buildCharBags({ inventory, bags, items: ITEMS, selectedId: 'bag1' });
    expect(bag1Model.used).toBe(2);
    expect(bag1Model.selected.capacity).toBe(LINEN_POUCH_SLOTS);
  });
});

describe('char_bags_view: cell slot-index mapping', () => {
  it('maps the backpack container to absolute indices [0, BACKPACK_SLOTS)', () => {
    const inventory = slotsOf(3);
    const model = buildCharBags({ inventory, bags: NO_BAGS, items: ITEMS, selectedId: 'backpack' });
    expect(model.cells).toHaveLength(BACKPACK_SLOTS);
    expect(model.cells.map((c) => c.slotIndex)).toEqual(
      Array.from({ length: BACKPACK_SLOTS }, (_, i) => i),
    );
    expect(model.cells[0].item).toBe(ITEMS.baked_bread);
    expect(model.cells[2].item).toBe(ITEMS.baked_bread);
    expect(model.cells[3].item).toBeNull();
  });

  it('maps an occupied socket bag to the indices immediately after BACKPACK_SLOTS', () => {
    const bags: readonly (string | null)[] = ['linen_pouch', null, null, null];
    // 16 backpack slots full, then 2 items spill into the bag1 virtual range.
    const inventory = slotsOf(BACKPACK_SLOTS + 2);
    const model = buildCharBags({ inventory, bags, items: ITEMS, selectedId: 'bag1' });
    expect(model.cells).toHaveLength(LINEN_POUCH_SLOTS);
    expect(model.cells.map((c) => c.slotIndex)).toEqual(
      Array.from({ length: LINEN_POUCH_SLOTS }, (_, i) => BACKPACK_SLOTS + i),
    );
    expect(model.cells[0].item).toBe(ITEMS.baked_bread);
    expect(model.cells[1].item).toBe(ITEMS.baked_bread);
    expect(model.cells[2].item).toBeNull();
  });

  it('maps a SECOND occupied socket past the first bag`s own capacity, skipping the empty socket between them', () => {
    // socket 0 empty, socket 1 = linen_pouch, socket 2 = travelers_knapsack.
    // bag2 (socket 1) owns [BACKPACK_SLOTS, BACKPACK_SLOTS + LINEN_POUCH_SLOTS);
    // bag3 (socket 2) owns the next KNAPSACK_SLOTS indices after that.
    const bags: readonly (string | null)[] = [null, 'linen_pouch', 'travelers_knapsack', null];
    const inventory = slotsOf(BACKPACK_SLOTS + LINEN_POUCH_SLOTS + 3);
    const model = buildCharBags({ inventory, bags, items: ITEMS, selectedId: 'bag3' });
    expect(model.selected.id).toBe('bag3');
    const expectedBase = BACKPACK_SLOTS + LINEN_POUCH_SLOTS;
    expect(model.cells[0].slotIndex).toBe(expectedBase);
    expect(model.used).toBe(3);
  });
});

describe('char_bags_view: purity + host parity', () => {
  it('is a pure function: same input yields an equal model', () => {
    const bags: readonly (string | null)[] = ['linen_pouch', null, null, null];
    const inventory = slotsOf(4);
    expect(buildCharBags({ inventory, bags, items: ITEMS, selectedId: 'bag1' })).toEqual(
      buildCharBags({ inventory, bags, items: ITEMS, selectedId: 'bag1' }),
    );
  });

  it('yields an identical model from a Sim-shaped and a ClientWorld-mirror-shaped inventory/bags', () => {
    // Offline Sim hands a prototyped record carrying offline-only fields the
    // core must ignore; the ClientWorld mirror is a JSON round-trip.
    const simInventory = slotsOf(5).map((s) => Object.assign(Object.create({ dirty: true }), s));
    const simBags: readonly (string | null)[] = Object.assign(Object.create({ dirty: true }), [
      'linen_pouch',
      null,
      null,
      null,
    ]);
    const mirrorInventory = JSON.parse(JSON.stringify(simInventory)) as InvSlot[];
    const mirrorBags = JSON.parse(JSON.stringify(simBags)) as (string | null)[];
    expect(
      buildCharBags({ inventory: simInventory, bags: simBags, items: ITEMS, selectedId: 'bag1' }),
    ).toEqual(
      buildCharBags({
        inventory: mirrorInventory,
        bags: mirrorBags,
        items: ITEMS,
        selectedId: 'bag1',
      }),
    );
  });
});

describe('char_bags_view: scoped to a deterministic pure core (no DOM/i18n/Three/RNG)', () => {
  const src = readFileSync(new URL('../src/ui/char_bags_view.ts', import.meta.url), 'utf8');

  it('draws no randomness or wall-clock time', () => {
    expect(src).not.toMatch(/\bMath\.random\b/);
    expect(src).not.toMatch(/\bDate\.now\b/);
    expect(src).not.toMatch(/\bperformance\.now\b/);
  });

  it('imports no DOM/i18n/render/game/net/painter surface', () => {
    expect(src).not.toMatch(/from\s+['"]\.\.\/render\//);
    expect(src).not.toMatch(/from\s+['"]\.\.\/game\//);
    expect(src).not.toMatch(/from\s+['"]\.\.\/net\//);
    expect(src).not.toMatch(/from\s+['"]three['"]/);
    expect(src).not.toMatch(/from\s+['"]\.\/i18n['"]/);
    expect(src).not.toMatch(/\bdocument\./);
    expect(src).not.toMatch(/_painter['"]/);
  });
});
