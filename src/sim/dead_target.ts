// Whether a DEAD entity may still be selected as a target. Most corpses are not
// targetable, but three categories are: dead players (so allies can select them for
// resurrection), lootable mob corpses (so their loot window is reachable), and the
// viewer's OWN pet (so its Revive / Abandon menu remains reachable after login).
//
// Pure leaf shared by both worlds: the authoritative Sim (targeting.ts) and the
// online ClientWorld's optimistic mirror (net/online.ts) call this so they agree on
// what is selectable. src/sim-pure (no DOM/Three/rng), enforced by architecture.test.

import type { Entity } from './types';

export function deadTargetSelectable(e: Entity, viewerId: number): boolean {
  if (e.lootable) return true;
  if (e.kind === 'player') return true;
  // the viewer's own pet (an owned mob) stays targetable while dead
  return e.kind === 'mob' && e.ownerId === viewerId;
}
