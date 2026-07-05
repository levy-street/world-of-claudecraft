import type { Entity } from '../sim/types';

// Classic-style "threat plates": a hostile mob that is actively aggroed on the
// local player gets its nameplate health bar tinted red, so you can spot at a
// glance which enemies are coming for *you* (distinct from the ground selection
// ring, which marks the unit *you* have targeted).
//
// Pure so it can be unit-tested without a DOM/renderer; the renderer just
// toggles a CSS class from the boolean.
export function isMobThreateningViewer(e: Entity, viewerId: number): boolean {
  return (
    e.kind === 'mob' &&
    !e.dead &&
    e.ownerId === null && // a friendly/owned pet is never a threat to its owner
    e.aggroTargetId === viewerId
  );
}
