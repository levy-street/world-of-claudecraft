// The eleven LAUNCH equip slots, frozen as a historical record. This is NOT the
// equipment surface: it omits the additive 'offhand' slot, and any future slot
// will be missing from it too, by design.
//
// It lives in its own module rather than beside ALL_EQUIP_SLOTS in types.ts on
// purpose. As a second same-shaped export named EQUIP_SLOTS it read like the
// obvious default and was picked up twice by code that wanted the live list:
// once by the offhand unequip/drag validators (tests/offhand_equip_wire.ts) and
// once by the equipmentInstance load path, which silently dropped every worn
// offhand's enchant on login. Four call sites were carrying hand-written "use
// ALL_EQUIP_SLOTS, not the frozen one" comments; the fifth was not, and that was
// the bug. A frozen list you have to import by this name, from here, is one
// nobody reaches for by accident.
//
// NEVER validate against this list. Untrusted slot strings go through
// isEquipSlot (types.ts), which is derived from the live ALL_EQUIP_SLOTS.
// The only legitimate readers are launch-era completeness records that must
// keep meaning exactly what they meant at launch:
//   - the full-paperdoll deed (deeds.ts allEquipSlotsFilled), whose earned
//     rows would otherwise silently change meaning under existing players
//   - the all-slot PvP set profiles (tests/pvp_honor_gear.test.ts)

import type { EquipSlot } from './types';

export const LAUNCH_PAPERDOLL_SLOTS: readonly EquipSlot[] = [
  'mainhand',
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
  'ring1',
  'ring2',
];
