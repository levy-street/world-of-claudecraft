// The views the world cannot be entered without: the local player's own and its target's.
// The world-entry prewarm builds them first (the `views.required` manifest entry) and every
// live frame re-asks for whichever is missing, ahead of the budgeted candidate scan.
//
// A view counts as created only when it EXISTS after its build. createView returns having
// built nothing when the entity's assets are unavailable (the fail-soft path, issue 2079:
// the build is skipped, logged once and retried after its cooldown), and that used to be
// counted and sampled as a created view all the same, so the prewarm reported the player's
// own body as built while nothing stood on screen.
//
// Three-free and DOM-free; the clock is the caller's.
import type { Entity } from '../sim/types';
import { sampleCreatedViewType } from './view_candidate_pool_core';
import { liveViewCandidate } from './view_candidate_scan_core';

/** The Renderer members the required views read. Renderer satisfies this shape with private
 *  members, so its call site passes `this` as a bare object and this module casts (the
 *  zone_prewarm_groups.ts pattern: no public surface that exists only for this seam). */
export interface RequiredViewHost {
  sim: Parameters<typeof liveViewCandidate>[1];
  views: { has(id: number): boolean };
  questObjectHidden: Parameters<typeof liveViewCandidate>[3];
  viewCreateRetry: { canAttempt(entityId: number, slot: string, now: number): boolean };
  createView(e: Entity): void;
}

function createRequiredView(
  h: RequiredViewHost,
  id: number | null,
  createdViewTypes: string[],
  now: number,
): number {
  if (id === null) return 0;
  const e = liveViewCandidate(id, h.sim, h.views, h.questObjectHidden);
  if (!e || !h.viewCreateRetry.canAttempt(e.id, 'view', now)) return 0;
  h.createView(e);
  if (!h.views.has(e.id)) return 0;
  sampleCreatedViewType(createdViewTypes, e);
  return 1;
}

/** Build the player's view and its target's where either is missing, and return how many
 *  now exist that did not before. `now`: the frame clock the retry cooldown is read at. */
export function createRequiredViews(
  host: object,
  player: Pick<Entity, 'id' | 'targetId'>,
  createdViewTypes: string[],
  now: number,
): number {
  const h = host as RequiredViewHost;
  return (
    createRequiredView(h, player.id, createdViewTypes, now) +
    createRequiredView(h, player.targetId, createdViewTypes, now)
  );
}
