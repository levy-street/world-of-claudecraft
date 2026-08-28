// Pure, DOM-free core for the mobile consumables quick bar: turns the raw
// inventory into the ordered, capped list of consumable item ids whose slots
// the bar paints (through the shared action_bar_view core, which derives the
// per-slot count / potion-cooldown / usable state itself). Touch has no way to
// drag an item onto the hotbar, so unlike the desktop bar this list is
// AUTO-POPULATED from what the player is carrying: zero setup, the bag's
// "Consumables" category made castable. Host-agnostic (a Vitest drives it
// directly); registered in tests/architecture.test.ts UI_PURE_CORES.

import type { InvSlot, ItemDef } from '../../../sim/types';

/** Slot buttons the quick bar renders; both game shells ship this many. */
export const CONSUMABLE_BAR_SLOTS = 6;

// Combat-priority order: what a player reaches for mid-fight comes first, so
// the capped row never buries a potion behind a stack of picnic food. Scrolls
// sit with the elixirs they alternate with (phase 06), and flasks with both
// (phase 10): all three are combat-usable buffs, and touch has no
// drag-to-hotbar, so this bar is their only mid-fight surface. The flask sits
// ahead of the scroll because it is the higher-value buff of the pair (an apex
// consumable that outranks the elixir and scroll of its stat), not because it
// is re-applied after a wipe: a flask rides through death by design, so the
// only wipes that clear it are the arena and Fiesta clean slates.
export const CONSUMABLE_KIND_ORDER = [
  'potion',
  'elixir',
  'flask',
  'scroll',
  'food',
  'drink',
] as const;

export type ConsumableLookup = (itemId: string) => ItemDef | undefined;

// Reused per-call scratch for the kind-fair cap (phase 14): segment bounds and
// keep counts per kind, sized once to the fixed kind table so a per-frame call
// allocates nothing. Overwritten wholesale on every call, never read across
// calls, so the core stays same-input-same-output.
const SEG_START = new Array<number>(CONSUMABLE_KIND_ORDER.length).fill(0);
const SEG_LEN = new Array<number>(CONSUMABLE_KIND_ORDER.length).fill(0);
const SEG_KEEP = new Array<number>(CONSUMABLE_KIND_ORDER.length).fill(0);

/**
 * Fill `out` with the item ids the quick bar shows, in render order:
 * potions, then elixirs, then flasks, then scrolls, then food, then drink; id-sorted within a
 * kind so the row stays visually stable while stacks merge, split, or shuffle bag order.
 * Multiple stacks of one item collapse to a single slot (the shared bar core
 * sums the count across stacks). Mutates and returns `out` (allocation-light:
 * per-frame callers reuse one array, matching the action_bar_view contract).
 *
 * The cap is KIND-FAIR (phase 14): when more distinct consumables exist than
 * seats, every PRESENT kind seats its id-sorted first item, in kind order,
 * before any kind takes a second seat; the leftover seats then fill in the
 * existing priority order (kind order, id order within a kind). Farming's
 * dishes, feast, and tonic made a potion-and-elixir-heavy bag the common
 * case, and the old head-first truncation starved whole kinds off the tray
 * (the recorded flask starvation). With at most six kinds in the game, no
 * kind is ever starved while a seat exists; past the guarantee, the shed
 * order keeps the old priority semantics. Render order stays kind-grouped.
 */
export function consumableBarItems(
  inventory: readonly Pick<InvSlot, 'itemId'>[],
  lookup: ConsumableLookup,
  out: string[],
  cap = CONSUMABLE_BAR_SLOTS,
): string[] {
  out.length = 0;
  for (let k = 0; k < CONSUMABLE_KIND_ORDER.length; k++) {
    const kind = CONSUMABLE_KIND_ORDER[k];
    const segStart = out.length;
    SEG_START[k] = segStart;
    for (const slot of inventory) {
      const def = lookup(slot.itemId);
      if (!def || def.kind !== kind) continue;
      let seen = false;
      for (let i = segStart; i < out.length; i++) {
        if (out[i] === slot.itemId) {
          seen = true;
          break;
        }
      }
      if (seen) continue;
      // Insertion-sort the new id into its kind segment (no splice: splice
      // allocates its removed-elements array even when removing nothing).
      out.push(slot.itemId);
      for (let i = out.length - 1; i > segStart && out[i - 1] > out[i]; i--) {
        const tmp = out[i - 1];
        out[i - 1] = out[i];
        out[i] = tmp;
      }
    }
    SEG_LEN[k] = out.length - segStart;
  }
  if (out.length <= cap) return out;
  // Kind-fair cap. Guarantee pass: one seat per present kind, in kind order,
  // while seats last (a cap under the present-kind count truncates the
  // guarantee itself down the same ladder). Leftover pass: the remaining
  // seats go to each kind's next id-sorted items in kind order, so the old
  // priority semantics decide everything past the guarantee.
  let guaranteeSeats = cap;
  for (let k = 0; k < CONSUMABLE_KIND_ORDER.length; k++) {
    if (SEG_LEN[k] > 0 && guaranteeSeats > 0) {
      SEG_KEEP[k] = 1;
      guaranteeSeats--;
    } else {
      SEG_KEEP[k] = 0;
    }
  }
  let leftoverSeats = guaranteeSeats;
  for (let k = 0; k < CONSUMABLE_KIND_ORDER.length && leftoverSeats > 0; k++) {
    if (SEG_KEEP[k] === 0) continue;
    const extra = Math.min(SEG_LEN[k] - SEG_KEEP[k], leftoverSeats);
    SEG_KEEP[k] += extra;
    leftoverSeats -= extra;
  }
  // Compact in place: each kept run is that kind's segment head, and the
  // write cursor can never pass a segment's start, so the forward copy is
  // safe without a second array.
  let w = 0;
  for (let k = 0; k < CONSUMABLE_KIND_ORDER.length; k++) {
    const start = SEG_START[k];
    for (let i = 0; i < SEG_KEEP[k]; i++) out[w++] = out[start + i];
  }
  out.length = w;
  return out;
}
