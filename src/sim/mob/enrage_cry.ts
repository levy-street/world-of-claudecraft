// Two-phase enrage: a mob can ROAR first and turn frenzied a beat later, so
// the burn phase arrives as an announced moment instead of a silent stat flip.
//
// Shape is the dragonkin engageShout's (mob/combat_profile.ts, Entity.shoutFired
// / shoutIntroUntil): fire once per pull, stamp a sim-time window, and while
// that window runs the mob stands rooted facing its target, not moving, not
// swinging, and running no timed mechanic. The difference is only what opens it
// (an hp threshold rather than first aggro) and what closes it (the enrage
// buff actually landing).
//
// Authoring it as a LEAD threshold rather than reusing belowHpPct is deliberate:
// the roar has to start while the mob is still un-enraged, so `cryBelowHpPct`
// sits a little ABOVE `belowHpPct`. Brutok cries at 31% and turns at 30%.
//
// A template that authors neither field is untouched: cryWindowOpen is false
// forever, enrageReady collapses to the old `hpFrac <= belowHpPct` test, and no
// event is emitted. That is what keeps the parity digests still.
import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { emitEnrageCryCue } from './mob_clip_cue';

/** Is the mob mid-roar right now (rooted, not swinging)? */
export function enrageCryHolds(ctx: SimContext, mob: Entity): boolean {
  return mob.enrageCryUntil !== undefined && ctx.time < mob.enrageCryUntil;
}

/**
 * Open the roar window if this mob authored one and has just crossed its LEAD
 * threshold. Call before the enrage gate; returns true once, on the tick the
 * roar starts.
 */
export function tryStartEnrageCry(ctx: SimContext, mob: Entity, hpFrac: number): boolean {
  const enrage = MOBS[mob.templateId]?.enrage;
  const lead = enrage?.cryBelowHpPct;
  if (enrage === undefined || lead === undefined) return false;
  if (mob.enraged || mob.enrageCryFired) return false;
  if (hpFrac > lead) return false;
  mob.enrageCryFired = true;
  mob.enrageCryUntil = ctx.time + (enrage.cryRootSeconds ?? 0);
  emitEnrageCryCue(ctx, mob);
  return true;
}

/**
 * May the enrage buff land this tick? Below the real threshold as always, and
 * for a template with a roar, only once that roar has finished. A mob whose hp
 * plunges straight past both thresholds still owes the full roar first, which
 * is the point: the tell can never be skipped by a big crit.
 */
export function enrageReady(ctx: SimContext, mob: Entity, hpFrac: number): boolean {
  const enrage = MOBS[mob.templateId]?.enrage;
  if (enrage === undefined) return false;
  if (hpFrac > enrage.belowHpPct) return false;
  if (enrage.cryBelowHpPct === undefined) return true;
  return mob.enrageCryFired === true && !enrageCryHolds(ctx, mob);
}

/** Pull state, cleared alongside `enraged` on evade and respawn. */
export function resetEnrageCry(mob: Entity): void {
  mob.enrageCryFired = undefined;
  mob.enrageCryUntil = undefined;
}
