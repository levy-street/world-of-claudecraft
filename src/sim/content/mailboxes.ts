// Ravenpost perch placements: one mailbox per town, a few strides from each
// hub fire so it reads as town furniture. The Sim ctor spawns one interactable
// `kind:'object'` entity (templateId 'mailbox') per entry; the renderer draws
// the raven-pillar prop for that template. Positions are nudged by findSafePos
// at spawn, so a collision with a building resolves to the nearest open spot.

export interface MailboxDef {
  x: number;
  z: number;
}

export const MAILBOXES: MailboxDef[] = [
  { x: 7, z: -8 }, // Eastbrook, by the square south of the well
  { x: 6, z: 294 }, // Fenbridge, at the boardwalk mouth
  { x: 6, z: 654 }, // Highwatch, beside the gate path
];
