// Presentation-only clip cues: let a mob pick an AUTHORED one-shot instead of
// its plain attack rotation, for a mechanic whose visual the rig has a clip for.
//
// HOW IT REACHES A CLIP. There is exactly one shipped route, the dragonkin
// brood's (src/sim/mob/mob_swing.ts arcCleave): a `spellfx` with fx 'windup'
// carrying an `ability` id. The renderer forwards that id into triggerAttack ->
// playAttack, which looks it up in the rig's ClipMap.attackByAbility. Do NOT
// hang an id on a plain 'nova' instead: that fx terminates at the generic vfx
// arm and never reaches triggerAttack, so the id is silently ignored.
//
// ORDERING IS THE MECHANISM. The renderer animates EVERY physical damage event
// with the plain rotation clip, so a cue emitted before its own damage event is
// overwritten inside the same drain. Every caller here fires AFTER the damage
// it decorates. That is why the enraged-swing cue hangs off the mobSwing call
// site rather than living inside mobSwing: the miss/dodge/parry branches return
// early, and cueing from the caller covers all five outcomes uniformly.
//
// DEGRADES CLEANLY. playAttack falls through to the normal rotation for an id
// the rig does not map, so these ids are inert on every other creature. Keep
// them mob-namespaced (the shipped 'brood_cleave' convention) so they can never
// collide with a player ability id that the ability-VFX painter would claim
// first.
//
// PARITY. Every hook is gated on an OPTIONAL template field. A template that
// does not opt in emits nothing at all, so the parity event digests never move.
import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** The one emit shape that reaches ClipMap.attackByAbility. */
function emitClipCue(ctx: SimContext, mob: Entity, ability: string): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: 'physical',
    fx: 'windup',
    ability,
  });
}

/**
 * The enrage moment (Brutok's Battlecry). Call right after `mob.enraged` flips,
 * beside the existing nova, so the roar reads as the cause of the buff.
 */
export function emitEnrageCryCue(ctx: SimContext, mob: Entity): void {
  const ability = MOBS[mob.templateId]?.enrage?.cryAbility;
  if (ability) emitClipCue(ctx, mob, ability);
}

/**
 * Every swing for the rest of the pull once enraged. Call from the mobSwing
 * CALL SITE (after the swing resolves), never from inside mobSwing: a miss,
 * dodge or parry returns early from there, and those swings must read enraged
 * too or one in ten reverts to the calm animation mid-frenzy.
 */
export function emitEnragedSwingCue(ctx: SimContext, mob: Entity): void {
  if (!mob.enraged) return;
  const ability = MOBS[mob.templateId]?.enrage?.swingAbility;
  if (ability) emitClipCue(ctx, mob, ability);
}

/**
 * The periodic AoE slam (Brutok's Skull Smash). Call after the pulse's own
 * damage loop has closed, for the ordering reason in the header.
 */
export function emitAoePulseCue(ctx: SimContext, mob: Entity): void {
  const ability = MOBS[mob.templateId]?.aoePulse?.ability;
  if (ability) emitClipCue(ctx, mob, ability);
}
