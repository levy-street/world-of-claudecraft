// Ravenpost perch placements: one mailbox per town, a few strides from each
// hub fire so it reads as town furniture. The Sim ctor spawns one interactable
// `kind:'object'` entity (templateId 'mailbox') per entry; the renderer draws
// the raven-pillar prop for that template. Positions are nudged by findSafePos
// at spawn, so a collision with a building resolves to the nearest open spot.

import { EASTBROOK_LAYOUT } from '../eastbrook_layout';
import { FENBRIDGE_LAYOUT } from '../fenbridge_layout';
import type { MailboxDef } from '../types';
import { AMBERFALL_ZONE } from './amberfall';
import { DRAKELANDS_ZONE } from './drakelands';
import { EVERGARDEN_ZONE } from './evergarden';
import { FARSHORE_ZONE } from './farshore';
import { FROSTVEIL_ZONE } from './frostveil';
import { GALECREST_ZONE } from './galecrest';
import { NIGHTBLOOM_ZONE } from './nightbloom';
import { PALMREACH_ZONE } from './palmreach';
import { REALM_ZONE } from './realm';
import { WILLOWFEN_ZONE } from './willowfen';
import { WRAITHWOOD_ZONE } from './wraithwood';

export type { MailboxDef } from '../types';

function hubMailbox(
  zone: { hub: { x: number; z: number } },
  offset: { x: number; z: number },
): MailboxDef {
  return { x: zone.hub.x + offset.x, z: zone.hub.z + offset.z };
}

export const MAILBOXES: MailboxDef[] = [
  { ...EASTBROOK_LAYOUT.services.mailbox.position },
  { ...FENBRIDGE_LAYOUT.services.mailbox.position },
  { x: 6, z: 654 }, // Highwatch, beside the gate path
  hubMailbox(REALM_ZONE, { x: 7, z: -5 }), // Eldergleam, south of the great tree
  hubMailbox(DRAKELANDS_ZONE, { x: -7, z: 5 }), // Wyrmwatch, inside the gate lawn
  hubMailbox(FROSTVEIL_ZONE, { x: 7, z: -5 }), // Icemantle, at the pass-side square
  hubMailbox(AMBERFALL_ZONE, { x: 7, z: -5 }), // Lanternmere, by the ferry market
  hubMailbox(WILLOWFEN_ZONE, { x: 6, z: -6 }), // Bridgemere, near the island square
  hubMailbox(NIGHTBLOOM_ZONE, { x: 6, z: -5 }), // Moonrest, beside the hollow path
  hubMailbox(WRAITHWOOD_ZONE, { x: -6, z: 6 }), // Gallowmere, under the eaves
  hubMailbox(PALMREACH_ZONE, { x: 6, z: -5 }), // Drifthaven, at the reef road
  hubMailbox(EVERGARDEN_ZONE, { x: -6, z: 6 }), // Hedgewick, facing the parterre
  hubMailbox(GALECREST_ZONE, { x: 7, z: -5 }), // Wickharbor, beside the harbor square
  hubMailbox(FARSHORE_ZONE, { x: -6, z: 6 }), // Gullhaven, inside the redoubt
];
