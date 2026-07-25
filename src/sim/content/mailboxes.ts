// Ravenpost perch placements: one mailbox per town, a few strides from each
// hub fire so it reads as town furniture. The Sim ctor spawns one interactable
// `kind:'object'` entity (templateId 'mailbox') per entry; the renderer draws
// the raven-pillar prop for that template. Positions are nudged by findSafePos
// at spawn, so a collision with a building resolves to the nearest open spot.

import { EASTBROOK_LAYOUT } from '../eastbrook_layout';
import type { MailboxDef } from '../types';

export type { MailboxDef } from '../types';

export const MAILBOXES: MailboxDef[] = [
  { ...EASTBROOK_LAYOUT.services.mailbox.position },
  { x: 6, z: 294 }, // Fenbridge, at the boardwalk mouth
  { x: 6, z: 654 }, // Highwatch, beside the gate path
];
