// Pure resolver for the icon ids shown on the pet command bar (Hunter / Warlock).
//
// These ids are NOT class abilities; they feed `iconDataUrl('ability', id)` purely
// for their art. The point of pinning them here (rather than inline in hud.ts) is a
// single guarantee, unit-tested in tests/pet_bar_icons.test.ts: a pet action must
// never reuse an icon the owning class also shows on its own action bar, which would
// render as a confusing on-screen duplicate. The Hunter's aggressive stance used to
// borrow `rapid_fire` (one of its own shots); the pet heal borrowed the Druid
// `rejuvenation` leaf, reading as a magic heal when the pet is actually fed.

import type { PetMode, PlayerClass } from '../sim/types';

// The only classes that ever see the pet command bar (they can own a persistent pet:
// Hunters tame beasts, Warlocks summon demons). The disjoint-icon guarantee below
// only needs to hold for these classes' own action bars.
export const PET_OWNER_CLASSES: PlayerClass[] = ['hunter', 'warlock'];

export const PET_ATTACK_ICON = 'attack';
export const PET_TAUNT_ICON = 'growl';

// Hunters feed the pet, so they get the dedicated roasted-haunch `feed_pet` icon.
// Warlocks channel healing into the demon: `mend_demon`, a distinct fel-mend icon, so
// the pet action does not duplicate the Warlock's own `drain_life` ability on the bar.
export const petHealIcon = (ownerClass: string): string =>
  ownerClass === 'warlock' ? 'mend_demon' : 'feed_pet';

export const PET_STANCE_ICONS: Record<PetMode, string> = {
  passive: 'prowl',
  defensive: 'defensive_stance',
  aggressive: 'pet_aggressive',
};

// Every pet-bar icon a player of `ownerClass` can see, for collision checks.
export const petBarIconIds = (ownerClass: string): string[] => [
  PET_ATTACK_ICON,
  PET_TAUNT_ICON,
  petHealIcon(ownerClass),
  ...Object.values(PET_STANCE_ICONS),
];
