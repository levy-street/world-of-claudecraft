// Whether a DEAD entity may still be selected as a target. Most corpses are not
// targetable, but two are: a lootable mob corpse (so its loot window is reachable)
// and the viewer's OWN pet (so a dead hunter pet stays selectable for the Revive /
// Abandon context menu after login, which otherwise has no way to be targeted).
//
// Pure leaf shared by both worlds: the authoritative Sim (targeting.ts) and the
// online ClientWorld's optimistic mirror (net/online.ts) call this so they agree on
// what is selectable. src/sim-pure (no DOM/Three/rng), enforced by architecture.test.

import type { Entity } from './types';

export function deadTargetSelectable(e: Entity, viewerId: number): boolean {
  if (e.lootable) return true;
  // the viewer's own pet (an owned mob) stays targetable while dead
  return e.kind === 'mob' && e.ownerId === viewerId;
}
