// Social aggro for fleeing mobs. A cowardly mob that panics at low HP runs away and
// looks, each tick, for a LOCAL same-family ally within FLEE_HELP_RADIUS. The instant it
// reaches one, that local cluster joins the fight and the fleer turns back to re-engage
// WITH it (the caller ends the flee on the first non-empty rally). Ending the flee on
// first contact is what stops a fleer from chaining the whole camp: it pulls one local
// cluster, not every mob down the escape lane. A per-tick rally that never stopped
// cascaded a single pull into a whole-camp wipe.
//
// Pure entity-state mutation: it sets aiState/aggroTargetId/leashAnchor and seeds the
// hate table, and draws NO rng. That keeps the shared draw order unchanged, so the
// parity goldens are unaffected.
import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import { addThreat } from '../threat';
import type { Entity } from '../types';

// A fleeing mob rallies same-family allies within this (small, local) radius. Kept tight
// so the first cluster it reaches is local, not the whole camp down the escape lane.
export const FLEE_HELP_RADIUS = 5;

// Pull every idle, same-family ally currently within FLEE_HELP_RADIUS of the fleeing
// mob onto its attacker. Called each tick of the flee; the caller turns the fleer back
// the moment this returns a non-zero count. Returns the number of allies newly pulled.
export function rallyFleeingAllies(ctx: SimContext, mob: Entity, target: Entity): number {
  const family = MOBS[mob.templateId]?.family;
  if (!family) return 0;
  let pulled = 0;
  ctx.grid.forEachInRadius(mob.pos.x, mob.pos.z, FLEE_HELP_RADIUS, (m, d2) => {
    if (
      m.kind === 'mob' &&
      m.id !== mob.id &&
      !m.dead &&
      m.hostile &&
      m.aiState === 'idle' &&
      m.ownerId === null &&
      MOBS[m.templateId]?.family === family &&
      d2 < FLEE_HELP_RADIUS * FLEE_HELP_RADIUS
    ) {
      m.aiState = 'chase';
      m.aggroTargetId = target.id;
      m.inCombat = true;
      m.leashAnchor = { ...m.pos };
      addThreat(m, target.id, 1);
      pulled++;
    }
  });
  return pulled;
}
