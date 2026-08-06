// The per-slot load doctrine, in ONE place.
//
// Every container that hydrates a persisted `InvSlot` from JSONB owes the same
// four steps, in this order: clamp a tampered stack to what identical-payload
// merges could legitimately have built, bound the slot-level crafted marker,
// rebuild a rift payload from its bounded keys, then bound the instance
// payload itself. The order is load-bearing and was settled by two earlier
// review rounds, both recorded on the bag arm this module was lifted from:
//
//   - the marker bound runs BEFORE the rift block, because a rift REFUSAL
//     stops the rest of the work for that slot, and a 100,000-char marker
//     riding a refused-rift row used to slip through that early exit;
//   - the rift rebuild runs BEFORE the payload bound, because the rebuild
//     reduces a corrupt-but-valid rift row to bounded keys, so an over-keyed
//     row that still carries a LEGAL rift survives as the rebuilt payload
//     instead of being destroyed by the key-count arm first.
//
// Spelling that order out per container is what let the toolbelt ship with a
// load path that copied `craftedRecipeId` and `instance` verbatim while the
// six older containers all validated them (the review finding this module
// answers). A shared helper makes the doctrine the default a new container
// gets by calling one function, rather than a sequence each one re-derives.
//
// Mutates the caller-owned CLONE in place and reports drops through the same
// sink every caller already threads to `warnDroppedInstanceKeys`. Idempotent:
// re-running it over an already-hydrated slot is a no-op, which is what makes
// it safe for the toolbelt spill to pass through the bag sweep a second time.
//
// `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/net import, no
// rng, no clock. Total on a malformed slot, so a corrupt row can never throw
// inside a character load.

import { instancedCountCap } from './bags';
import { ITEMS } from './data';
import {
  boundCraftedRecipeIdOnLoad,
  sanitizeItemInstancePayloadOnLoad,
} from './item_instance_load';
import { sanitizeRiftGearInstance } from './rift/progression';
import type { InvSlot } from './types';

/**
 * Applies the shared per-slot load doctrine to one caller-owned slot clone.
 *
 * `containerLabel` names the container in every dropped-key path ('bag',
 * 'buyback', 'bank', 'toolbelt'), so the aggregate diagnostic still says which
 * container a corrupt row came from. `ownerId` is the loading player, needed
 * to rebuild a rift payload against the right owner; an absent ownerId (a
 * unit caller with no player) SKIPS the rebuild rather than rebuilding
 * against a wrong owner, matching sanitizeBankState's rule.
 */
export function hydrateInvSlotOnLoad(
  slot: InvSlot,
  dropped: string[],
  containerLabel: string,
  ownerId?: number,
): void {
  // The shared tamper ceiling: a counted instanced slot loads capped at what
  // identical-payload merges could legitimately have built, and a
  // charge-bearing payload stays one-per-slot, so a hand-edited count can
  // never launder into independent copies via a later deposit or trade.
  slot.count = Math.min(slot.count, instancedCountCap(ITEMS[slot.itemId], slot.instance));
  // Before the rift block: its refusal arm returns early (see the header).
  boundCraftedRecipeIdOnLoad(slot, dropped, containerLabel);
  if (slot.instance?.rift) {
    if (ownerId === undefined) return;
    const rebuilt = sanitizeRiftGearInstance(slot.itemId, slot.instance, ownerId);
    if (rebuilt) {
      slot.instance = rebuilt;
    } else {
      // A refusal drops the instance silently, the equip arm's anti-tamper rule.
      delete slot.instance;
      return;
    }
  }
  if (slot.instance) {
    const { payload, dropped: junk } = sanitizeItemInstancePayloadOnLoad(slot.instance);
    for (const d of junk) dropped.push(`${containerLabel}.${slot.itemId}.${d}`);
    if (payload) slot.instance = payload;
    else delete slot.instance;
  }
}
