// Play Dead (hunter feign death). The hunter drops to the floor and every
// client draws them as a corpse with empty health and Focus, but the entity
// never dies: entity.dead stays false, so nothing in the death pipeline runs.
//
// On cast the caller (effect_dispatch.ts) first runs dropSelfFromHostileFocus,
// the Vanish threat wipe (every hostile mob forgets the hunter and the pet, and
// a mob left with an empty hate table evades). This module then drops every
// enemy player's target lock and lays the hunter down. While it lasts, mobs and
// pets cannot perceive the hunter (threat.ts), so nothing re-acquires them.
//
// It ends when the hunter recasts it, presses a movement key, starts an attack,
// uses any other ability, or uses an item. Taking damage or being displaced (a
// knockback, a moving platform) does not end it. Draws no rng.
//
// Cast on the run (PR 4488): a hunter still holding a movement or jump key when
// it lands gets the effect's movingGrace sec to let go before movement ends it.
// The grace rides the aura's value (unused otherwise) and counts down on the
// hunter tick; the body does not slide meanwhile (cast_move_gate's
// isFeigningDeath blocks translation while the aura is up).

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { DT } from '../types';
import { hasMovementInput } from './cast_move_gate';
import { dropTargetsOnStealth } from './stealth';

export const PLAY_DEAD_ID = 'play_dead';
/** Finite backing duration (JSON-safe); the hunter stays down until they act. */
const PLAY_DEAD_BACKING_DURATION = 3600;

function heldMovement(ctx: SimContext, hunter: Entity): boolean {
  const input = ctx.players.get(hunter.id)?.moveInput;
  return !!input && (hasMovementInput(input) || input.jump);
}

/** Pure over the aura list, so the renderer and HUD on both hosts can read it. */
export function isPlayingDead(entity: { auras: readonly { kind: string }[] }): boolean {
  return entity.auras.some((aura) => aura.kind === 'feign_death');
}

/** Stands a feigning hunter up (no-op otherwise). Item use calls this too. */
export function endPlayDead(ctx: SimContext, hunter: Entity): void {
  for (let index = hunter.auras.length - 1; index >= 0; index--) {
    const aura = hunter.auras[index];
    if (aura.kind !== 'feign_death') continue;
    hunter.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: hunter.id, name: aura.name, gained: false });
  }
}

/** Lays the hunter down after the caller's threat wipe; alsoHidden is the pet
 *  id list that wipe returns, so enemy players drop the pet lock too. */
export function startPlayDead(
  ctx: SimContext,
  hunter: Entity,
  name: string,
  alsoHidden: readonly number[],
  movingGrace = 0,
): void {
  if (hunter.castingAbility) ctx.cancelCast(hunter);
  hunter.autoAttack = false;
  hunter.queuedOnSwing = null;
  // A press queued in the GCD tail before lying down must not fire and stand
  // the hunter back up (offGcd casts skip the stale-press drop).
  hunter.queuedCastAbility = null;
  hunter.queuedCastAim = null;
  hunter.queuedCastTargetId = null;
  hunter.vx = 0;
  hunter.vz = 0;
  dropTargetsOnStealth(ctx, hunter, alsoHidden);
  ctx.applyAura(hunter, {
    id: PLAY_DEAD_ID,
    name,
    kind: 'feign_death',
    remaining: PLAY_DEAD_BACKING_DURATION,
    duration: PLAY_DEAD_BACKING_DURATION,
    // Grace seconds left before held movement ends it (0 when cast standing still).
    value: heldMovement(ctx, hunter) ? movingGrace : 0,
    sourceId: hunter.id,
    school: 'physical',
  });
}

/**
 * Runs at the top of every cast attempt. Recasting Play Dead while down stands
 * the hunter up and consumes the press (true), ahead of the cooldown gate so the
 * 30 sec cooldown never traps them on the floor. Any other ability stands the
 * hunter up and lets that cast continue (false).
 */
export function playDeadOnCastAttempt(ctx: SimContext, hunter: Entity, abilityId: string): boolean {
  if (!isPlayingDead(hunter)) return false;
  endPlayDead(ctx, hunter);
  return abilityId === PLAY_DEAD_ID;
}

/** Per-tick: a held movement or jump key (once any grace has run out), or
 *  starting an attack, ends it. */
export function playDeadTick(ctx: SimContext, hunter: Entity): void {
  const aura = hunter.auras.find((entry) => entry.kind === 'feign_death');
  if (!aura) return;
  if (hunter.autoAttack || hunter.dead) {
    endPlayDead(ctx, hunter);
    return;
  }
  if (aura.value > 0) {
    // Letting go spends the grace: a later key press stands the hunter up as usual.
    aura.value = heldMovement(ctx, hunter) ? Math.max(0, aura.value - DT) : 0;
    return;
  }
  if (heldMovement(ctx, hunter)) endPlayDead(ctx, hunter);
}
