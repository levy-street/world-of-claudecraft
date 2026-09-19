// Grand Teleport: the mage's party portal to Highwatch. Data only; the object
// and its party gate live in src/sim/party_gate.ts. One ordinary level 20
// class spell (no tome, no quest unlock, no per-city variants: the ruling on
// #3932); the destination table stays a list so a second city is a data row.

import type { AbilityDef, ItemDef } from '../types';

export interface GrandTeleportDestination {
  id: string;
  town: string;
  landing: { x: number; z: number; facing: number };
}

export const GRAND_TELEPORT_DESTINATIONS: readonly GrandTeleportDestination[] = [
  {
    id: 'highwatch',
    town: 'Highwatch',
    landing: { x: 6, z: 652, facing: 3.1 },
  },
];

export const GRAND_PORTAL_OBJECT_ITEM_ID = 'grand_portal';
export const GRAND_PORTAL_DURATION = 300;
export const GRAND_TELEPORT_COOLDOWN = 1200;
export const GRAND_TELEPORT_CAST_TIME = 10;
export const GRAND_TELEPORT_LEARN_LEVEL = 20;
export const RUNE_OF_PASSAGE_ITEM_ID = 'rune_of_passage';
export const RUNE_BUY_COPPER = 10_000;

export function grandTeleportAbilityId(destinationId: string): string {
  return `grand_teleport_${destinationId}`;
}
export function grandTeleportDestination(id: string): GrandTeleportDestination | undefined {
  return GRAND_TELEPORT_DESTINATIONS.find((d) => d.id === id);
}

export const GRAND_TELEPORT_ABILITY_IDS: readonly string[] = GRAND_TELEPORT_DESTINATIONS.map((d) =>
  grandTeleportAbilityId(d.id),
);

export const GRAND_TELEPORT_ABILITIES: Record<string, AbilityDef> = Object.fromEntries(
  GRAND_TELEPORT_DESTINATIONS.map((dest) => {
    const id = grandTeleportAbilityId(dest.id);
    const def: AbilityDef = {
      id,
      name: `Grand Teleport: ${dest.town}`,
      class: 'mage',
      learnLevel: GRAND_TELEPORT_LEARN_LEVEL,
      cost: 120,
      castTime: GRAND_TELEPORT_CAST_TIME,
      cooldown: GRAND_TELEPORT_COOLDOWN,
      range: 0,
      school: 'arcane',
      requiresTarget: false,
      requiresOutOfCombat: true,
      reagent: { itemId: RUNE_OF_PASSAGE_ITEM_ID, count: 1 },
      effects: [
        { type: 'summonGrandPortal', destination: dest.id, duration: GRAND_PORTAL_DURATION },
      ],
      description: `Opens a Grand Portal to ${dest.town} for 5 min. Only members of your group at the moment of casting can step through. Consumes a Rune of Passage. 10 sec cast.`,
    };
    return [id, def];
  }),
);

export const GRAND_TELEPORT_ITEMS: Record<string, ItemDef> = {
  [RUNE_OF_PASSAGE_ITEM_ID]: {
    id: RUNE_OF_PASSAGE_ITEM_ID,
    name: 'Rune of Passage',
    kind: 'junk',
    quality: 'common',
    stackSize: 20,
    sellValue: 2_500,
    buyValue: RUNE_BUY_COPPER,
  },
};
