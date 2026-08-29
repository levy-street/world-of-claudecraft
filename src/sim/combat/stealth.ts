import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

// When a player slips into stealth (Rogue Duskveil/Smokestep, Druid Stalk, Mage
// Greater Invisibility, all kind:'stealth' auras) every hostile hunter that
// cannot see them loses its LIVE lock on the caster.
//
// Enemy PLAYERS and PETS can never observe a stealthed target at any range
// (canObserveEntity / petCanSeeStealthedTarget), so their target lock is dropped
// outright here. An ally keeps sight of a stealthed friend, so a party heal
// target is never dropped.
//
// MOBS deliberately keep their CLASSIC proximity stealth detection
// (canDetectStealthedTarget, owned by mob targeting). This pass only releases a
// mob's live aggro/target so the mob RE-EVALUATES the caster through that
// detection on its next tick: a point-blank mob re-acquires immediately, while a
// distant one prunes the now-unseeable caster from its hate table and evades.
// Clearing aggroTargetId is what forces that re-evaluation; without it a mob left
// with a stale target it can no longer see would keep chasing the invisible
// caster (mob/targeting.ts never nulls aggro when the current target vanishes).
//
// The hate table itself is NOT wiped here. That is Vanish's exclusive power and
// is owned by dropSelfFromHostileFocus (effect_dispatch.ts), which the caller
// runs FIRST, and only on the Vanish / Greater-Invisibility path. So a plain
// stealth opener grants NO unconditional threat dump: a mid-pull restealth resets
// the pull only when the mob can no longer see the caster, exactly as classic
// detection dictates, and a mob still in the caster's face keeps its hate.
//
// Draws no rng and iterates the roster once, only on the occasional stealth-enter
// cast (never per tick).
export function dropTargetsOnStealth(
  ctx: SimContext,
  hidden: Entity,
  alsoHidden: readonly number[] = [],
): void {
  const hiddenIds = alsoHidden.length === 0 ? [hidden.id] : [hidden.id, ...alsoHidden];
  for (const e of ctx.entities.values()) {
    if (hiddenIds.includes(e.id)) continue;
    if (e.kind === 'mob') {
      // Only a live ENEMY mob loses its lock: skip corpses and any non-hostile
      // owned mob (the caster's own pet, an allied pet). The hostility check puts
      // the caster FIRST because isHostileTo needs a PLAYER attacker to be
      // meaningful (isHostileTo(mob, player) is always false); this matches the
      // sibling dropSelfFromHostileFocus and is the deliberate REVERSE of the
      // player branch below, which asks whether the enemy player holding the lock
      // is hostile to the caster.
      if (e.dead || !ctx.isHostileTo(hidden, e)) continue;
      if (e.aggroTargetId !== null && hiddenIds.includes(e.aggroTargetId)) e.aggroTargetId = null;
      if (e.targetId !== null && hiddenIds.includes(e.targetId)) e.targetId = null;
      if (e.forcedTargetId !== null && hiddenIds.includes(e.forcedTargetId)) {
        e.forcedTargetId = null;
        e.forcedTargetTimer = 0;
      }
    } else if (
      e.kind === 'player' &&
      e.targetId !== null &&
      hiddenIds.includes(e.targetId) &&
      ctx.isHostileTo(e, hidden)
    ) {
      e.targetId = null;
      e.autoAttack = false;
      e.queuedOnSwing = null;
      delete e.queuedOnSwingFree;
      delete e.queuedOnSwingCostMultiplier;
    }
  }
}
