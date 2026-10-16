// Corpse sink: a body too big to vanish cleanly sinks out of sight at the end of its
// corpse window (MobTemplate.corpseSink).
//
// A slain world boss lies where he fell for his whole lootable window, then the scheduler
// removes him (world_boss.ts). For an ordinary mob that removal is a blink nobody sees; for
// a thirteen-yard giant lying across the fen it is a mountain of granite popping out of
// existence in front of the raid. So over the last few seconds of the window the corpse
// sinks into the ground, and by the tick the scheduler drops him he is already under it.
//
// SIM-SIDE on purpose. The removal happens in the sim, and the one thing every host already
// streams for every entity is its position: lowering the corpse's `pos.y` sinks him on the
// offline world, the online mirror and any spectator identically, with no new wire field,
// no render timer guessing when the scheduler will act, and no renderer hook holding a
// dropped view alive. The renderer throws the dust (balgath_death_fx_core.ts) off the same
// signal: a dead body below where it lay.
//
// The template opting in also keeps its emptied corpse lying for the full window
// (corpseKeepsBody, read by pruneCorpseLoot): the fast "emptied corpse collapses in four
// seconds" arm is right for trash, and exactly the vanish this module exists to remove.
//
// src/sim-pure and rng-free: no DOM/Three/render imports, no clock reads, no draws.

import { MOBS } from '../data';
import type { Entity, MobTemplate } from '../types';

type SinkDef = NonNullable<MobTemplate['corpseSink']>;

/**
 * Yards the corpse has sunk with `corpseTimer` seconds of its window left: nothing until
 * the last `def.seconds`, then an ease-in to the full depth at zero (slow as the ground
 * takes him, faster as he goes under).
 */
export function corpseSinkDepth(def: SinkDef, corpseTimer: number): number {
  if (def.seconds <= 0 || corpseTimer >= def.seconds) return 0;
  const t = Math.min(1, Math.max(0, 1 - corpseTimer / def.seconds));
  return def.depth * t * t;
}

/** Whether this template's emptied corpse keeps lying for its whole window. */
export function corpseKeepsBody(template: Pick<MobTemplate, 'corpseSink'> | undefined): boolean {
  return template?.corpseSink !== undefined;
}

/**
 * Lower a sinking corpse for this tick. Called on every dead tick after the corpse timer
 * has counted down; inert for every mob without `corpseSink` and for the living.
 */
export function tickBossCorpseSink(mob: Entity): void {
  const def = MOBS[mob.templateId]?.corpseSink;
  if (!def || !mob.dead) return;
  const depth = corpseSinkDepth(def, mob.corpseTimer);
  if (depth <= 0 && mob.corpseSinkBaseY === undefined) return;
  if (mob.corpseSinkBaseY === undefined) mob.corpseSinkBaseY = mob.pos.y;
  // One-way: a loot roll or master-loot hold that lengthens the window mid-sink must not
  // pop a half-buried corpse back up out of the ground; he simply stays that deep.
  mob.pos.y = Math.min(mob.pos.y, mob.corpseSinkBaseY - depth);
}

/** Forget where the last corpse lay, for an entity about to live again. */
export function clearCorpseSink(mob: Entity): void {
  if (mob.corpseSinkBaseY !== undefined) mob.corpseSinkBaseY = undefined;
}
