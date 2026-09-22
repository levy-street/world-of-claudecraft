// The ward a boss holds while his eye is whole, and the window that opens when it is put out.
//
// The fight-design problem this solves is level spread: a world boss stands in an open zone
// where a level 6 and a level 20 arrive at the same pull, and raw numbers make the level 6 a
// spectator. So the boss keeps a MITIGATION ward up (Barrowhide: a permanent `buff_dr` aura,
// visible on his frame like any buff) that only a MECHANIC can remove, and the mechanic is
// deliberately level-blind: the Shardpike's thrust (lance_trial.ts) does fixed damage and
// asks for timing and nerve, not gear. Low-level players open the window; high-level players
// spend it. Neither can carry the fight alone, which is the whole point of a WORLD boss.
//
// Truth lives in two timestamps on the entity, never in the aura list: `eyeWardDownUntil`
// (the blind window) and `eyeWardSealedUntil` (the refractory seal after the ward re-forms).
// The auras, the ward buff and the Blinded debuff, are PRESENTATION of those timestamps: a
// death wipe, a cleanse arm, or any future aura fiddling cannot silently change when the
// mechanic thinks the ward is up, because the per-tick reconcile below re-derives the aura
// state from the clock every tick.
//
// Opt-in per template (`MobTemplate.eyeWard`), inert for every other mob, and it draws NO
// rng: apply/remove/reconcile are pure state, so the parity goldens never see it.

import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { emitMobYell } from './yells';

/** Aura id of the standing ward (the boss's frame shows it as a buff). */
export const EYE_WARD_AURA_ID = 'eye_ward';
/** Aura id of the Blinded window (the raid reads its remaining time off his frame). */
export const EYE_WARD_BLINDED_AURA_ID = 'eye_ward_blinded';
/**
 * Renderer cue for the blind moment: routed like the warpath windups, through the same
 * `fx: 'windup'` channel and `attackByAbility`, so the boss plays his authored Blinded clip.
 */
export const EYE_WARD_BLIND_ABILITY = 'mob_eye_ward_blinded';

/** Is this mob's ward currently pried open? */
export function eyeWardBlinded(ctx: SimContext, mob: Entity): boolean {
  return (mob.eyeWardDownUntil ?? 0) > ctx.time;
}

/** Can a thrust blind him RIGHT NOW (ward up, seal expired)? */
export function eyeWardVulnerable(ctx: SimContext, mob: Entity): boolean {
  if (!MOBS[mob.templateId]?.eyeWard) return false;
  if (eyeWardBlinded(ctx, mob)) return false;
  return (mob.eyeWardSealedUntil ?? 0) <= ctx.time;
}

/**
 * The Blinded aura, built in ONE place so the blind and the per-tick reconcile cannot
 * describe the same window differently.
 *
 * Value 0 on purpose: the DPS window IS the missing ward, and this aura is only the timer
 * the raid reads it from. A nonzero value here would double-dip the window and make the
 * fixed-damage story about the poke untrue.
 */
function blindedAura(mob: Entity, name: string, remaining: number): Aura {
  const left = Math.max(0.05, remaining);
  return {
    id: EYE_WARD_BLINDED_AURA_ID,
    name,
    kind: 'vulnerability',
    value: 0,
    remaining: left,
    duration: left,
    sourceId: mob.id,
    school: 'physical',
  };
}

/**
 * Reconcile the ward auras with the clock. Runs every alive tick for a template that
 * declares the ward; a handful of array scans, no allocation on the steady state.
 */
export function tickEyeWard(ctx: SimContext, mob: Entity): void {
  const def = MOBS[mob.templateId]?.eyeWard;
  if (!def) return;
  const blinded = eyeWardBlinded(ctx, mob);
  const hasWard = mob.auras.some((a) => a.id === EYE_WARD_AURA_ID);
  if (blinded) {
    if (hasWard) mob.auras = mob.auras.filter((a) => a.id !== EYE_WARD_AURA_ID);
    // ...and the BLINDED aura is re-derived from the same clock, which this reconcile used
    // to do for the ward only. That asymmetry was a real hole rather than an omission: the
    // window's remaining time is read off this aura by the raid's frames AND (since the
    // state cues landed) by the badge over his head and his body aura, so anything that
    // stripped it mid-window (a cleanse arm, a wipe, a future aura sweep) left him
    // genuinely vulnerable while every indicator said he was not. The module header already
    // claimed the auras were pure presentation of the two timestamps; now both are.
    if (!mob.auras.some((a) => a.id === EYE_WARD_BLINDED_AURA_ID)) {
      ctx.applyAura(mob, blindedAura(mob, def.blindName, (mob.eyeWardDownUntil ?? 0) - ctx.time));
    }
    return;
  }
  // Out of the window: the blinded aura must not outlive the timestamp it mirrors.
  if (mob.auras.some((a) => a.id === EYE_WARD_BLINDED_AURA_ID)) {
    mob.auras = mob.auras.filter((a) => a.id !== EYE_WARD_BLINDED_AURA_ID);
  }
  if (!hasWard) {
    // (Re)forms on spawn, after a blind window ends, and after any wipe that cleared his
    // auras: the reconcile does not care WHY it is missing, only that it should be up.
    ctx.applyAura(mob, wardAura(mob, def.name, def.reduction));
  }
}

/**
 * Put the eye out: drop the ward for `blindSeconds` and seal it against a re-blind.
 *
 * Returns false without side effects when he cannot be blinded (no ward declared, already
 * blinded, or still sealed), so the thrust that failed still lands its damage but the caller
 * knows not to celebrate. The seal starts at the blind and extends past the window
 * (`blindSeconds + refractorySeconds`), so the cadence of the fight is: window, ward
 * re-forms, a forced lull, then the next chance.
 */
export function blindEyeWard(ctx: SimContext, mob: Entity): boolean {
  const def = MOBS[mob.templateId]?.eyeWard;
  if (!def || mob.dead) return false;
  if (!eyeWardVulnerable(ctx, mob)) return false;
  mob.eyeWardDownUntil = ctx.time + def.blindSeconds;
  mob.eyeWardSealedUntil = ctx.time + def.blindSeconds + def.refractorySeconds;
  mob.auras = mob.auras.filter((a) => a.id !== EYE_WARD_AURA_ID);
  ctx.applyAura(mob, blindedAura(mob, def.blindName, def.blindSeconds));
  // The staggered-blind presentation: the same windup channel the warpath uses, so the
  // renderer routes it through attackByAbility to the authored clip with no bespoke path.
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: 'physical',
    fx: 'windup',
    ability: EYE_WARD_BLIND_ABILITY,
  });
  if (def.blindYell) emitMobYell(ctx, mob, def.blindYell, def.yellRange ?? 160);
  return true;
}

function wardAura(mob: Entity, name: string, reduction: number): Aura {
  return {
    id: EYE_WARD_AURA_ID,
    name,
    kind: 'buff_dr',
    value: reduction,
    remaining: 3600,
    duration: 3600,
    permanent: true,
    sourceId: mob.id,
    school: 'physical',
  };
}
