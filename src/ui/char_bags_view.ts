// Pure, host-agnostic view model for the character window's EMBEDDED BAGS
// section (docs/char-equipment/, Phase 4): the container selector (the
// implicit backpack plus each equipped bag socket) and the selected
// container's slot grid.
//
// The pooled inventory has no real per-container split (src/sim/bags.ts:
// every item lives in ONE flat list; an equipped bag only raises the slot
// BUDGET, it never pins an item to itself). This core lays a CANONICAL
// virtual partition over that flat list: the backpack owns the first
// BACKPACK_SLOTS absolute indices, then each OCCUPIED socket (in socket
// order) owns the next bagSlotsOf(item) indices, mirroring the exact
// summation order src/sim/bags.ts's bagCapacity() uses. A cell's absolute
// slotIndex resolves against the live inventory array the same way the
// standalone bags grid's used/capacity math does. The partition always comes
// from BACKPACK_SLOTS/bagSlotsOf (src/sim/bags.ts): never re-derived
// arithmetic.
//
// DOM/Three/i18n-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { BACKPACK_SLOTS, bagSlotsOf } from '../sim/bags';
import type { InvSlot, ItemDef } from '../sim/types';

/** One selectable bag container: the implicit backpack or an equipped bag
 *  socket. `id` is STABLE (keyed to the socket index, never this container's
 *  position in the selector), so a session-local `selectedId` keeps pointing
 *  at the same physical bag across renders even when an earlier socket
 *  empties out from under it. */
export interface CharBagContainer {
  id: 'backpack' | `bag${1 | 2 | 3 | 4}`; // bag1..bag4 = socket index + 1
  /** null for the backpack; the 0-based socket index for an equipped bag. */
  socket: number | null;
  /** The selector button's plain-text label: a 1-based ordinal across the
   *  containers CURRENTLY listed (backpack is always '1', the first equipped
   *  bag is '2', and so on). Positional, not the socket-based id ordinal:
   *  that would collide with the backpack's '1' the moment socket 0 fills. */
  label: string;
  /** Always true: `containers` only ever lists existing containers. */
  exists: boolean;
  /** Slot count of this container (BACKPACK_SLOTS for the backpack, else
   *  bagSlotsOf the equipped bag item). */
  capacity: number;
}

/** One cell of the selected container's grid. */
export interface CharBagCell {
  /** Absolute index into world.inventory this slot maps to. */
  slotIndex: number;
  item: ItemDef | null;
  /** Stack count (0 for an empty slot). */
  count: number;
}

export interface CharBagsModel {
  /** Backpack first, then sockets in order; only existing containers are
   *  listed (these are exactly the selector buttons). */
  containers: CharBagContainer[];
  /** Resolved selection (falls back to the backpack for a stale/unknown
   *  selectedId). */
  selected: CharBagContainer;
  /** The selected container's slots, in slot order. */
  cells: CharBagCell[];
  /** Occupied slots in the selected container. */
  used: number;
}

const BAG_CONTAINER_IDS: readonly CharBagContainer['id'][] = ['bag1', 'bag2', 'bag3', 'bag4'];

/** A container plus the absolute inventory index its virtual slot range
 *  starts at. Internal to this module: the base index is a computation
 *  detail the public model does not expose on CharBagContainer itself. */
interface PartitionedContainer {
  container: CharBagContainer;
  baseIndex: number;
}

/** The canonical container partition, backpack first then each occupied
 *  socket in order, cumulative offsets built purely from BACKPACK_SLOTS and
 *  bagSlotsOf so they always agree with src/sim/bags.ts's own capacity math. */
function partitionContainers(
  bags: readonly (string | null)[],
  items: Record<string, ItemDef>,
): PartitionedContainer[] {
  const partition: PartitionedContainer[] = [
    {
      container: {
        id: 'backpack',
        socket: null,
        label: '1',
        exists: true,
        capacity: BACKPACK_SLOTS,
      },
      baseIndex: 0,
    },
  ];
  let nextIndex = BACKPACK_SLOTS;
  let ordinal = 2;
  const socketCount = Math.min(bags.length, BAG_CONTAINER_IDS.length);
  for (let socket = 0; socket < socketCount; socket++) {
    const itemId = bags[socket];
    if (!itemId) continue;
    const capacity = bagSlotsOf(items[itemId]);
    partition.push({
      container: {
        id: BAG_CONTAINER_IDS[socket],
        socket,
        label: String(ordinal++),
        exists: true,
        capacity,
      },
      baseIndex: nextIndex,
    });
    nextIndex += capacity;
  }
  return partition;
}

/** Build the embedded bags model: the container selector list, the resolved
 *  selection (falling back to the backpack for a stale/unknown selectedId),
 *  and the selected container's cells in slot order. */
export function buildCharBags(input: {
  inventory: readonly InvSlot[];
  bags: readonly (string | null)[];
  items: Record<string, ItemDef>;
  selectedId: string;
}): CharBagsModel {
  const partition = partitionContainers(input.bags, input.items);
  const containers = partition.map((p) => p.container);
  const match = partition.find((p) => p.container.id === input.selectedId) ?? partition[0];
  const selected = match.container;
  const cells: CharBagCell[] = [];
  let used = 0;
  for (let i = 0; i < selected.capacity; i++) {
    const slotIndex = match.baseIndex + i;
    const slot = input.inventory[slotIndex];
    if (slot) used++;
    const item = slot ? (input.items[slot.itemId] ?? null) : null;
    cells.push({ slotIndex, item, count: slot ? slot.count : 0 });
  }
  return { containers, selected, cells, used };
}
