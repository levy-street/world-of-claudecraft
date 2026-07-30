// PTR / dev-only free gear vendor. Spawned on demand by the "/dev vendor" chat
// cheat (ALLOW_DEV_COMMANDS only, handleDevChat), never placed as permanent
// world content, so a free-epic vendor can NEVER reach a production realm. It
// stocks every epic gear piece in the game and sells them for free (buyItem's
// dev-vendor branch skips the cost + buyValue requirement on dev-command realms).

import { ITEMS } from '../data';
import type { NpcDef } from '../types';

// Every equippable epic piece, resolved from the merged item table so new epics
// are stocked automatically. Sorted for a stable vendor-window order.
export function allEpicGearIds(): string[] {
  return Object.values(ITEMS)
    .filter((i) => i.quality === 'epic' && (i.kind === 'armor' || i.kind === 'weapon') && !!i.slot)
    .map((i) => i.id)
    .sort();
}

export const PTR_DEV_VENDOR_ID = 'ptr_dev_vendor';

// pos/facing are placeholders: spawnDevVendor places the NPC next to the caller.
export const PTR_DEV_VENDOR_DEF: NpcDef = {
  id: PTR_DEV_VENDOR_ID,
  name: 'Test Quartermaster',
  title: 'Free Epic Gear (dev realm)',
  pos: { x: 0, z: 0 },
  facing: 0,
  color: 0x9932cc,
  questIds: [],
  vendorItems: allEpicGearIds(),
  devVendor: true,
  greeting: 'Gear up, tester. Everything here is free on this realm.',
};
