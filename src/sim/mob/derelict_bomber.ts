// The derelict forge mech (MobTemplate.meleeBomb): a downed automaton that
// crawls to its target, turns in place to FACE it before it translates (so it
// never glides sideways), and on reaching melee range stands up over a short
// windup, flashing red like a fuse, before detonating an AoE blast and dying.
//
// This runs in place of the normal melee pursuit for meleeBomb mobs (called from
// mob/combat_profile.ts). The render is entirely event-driven and needs no wire:
// the StandUp clip is the mech's `flourish` (a one-shot fired on arm), the fuse
// pulses a red fire light (`procSurge`), and the blast is a `nova`. Timing the
// windup to the StandUp clip length means the detonation + death animation take
// over exactly as the stand-up finishes.

import { MOBS } from '../data';
import type { MobCombatProfile } from '../mob_combat';
import type { SimContext } from '../sim_context';
import {
  type Aura,
  angleTo,
  DT,
  dist2d,
  type Entity,
  type MobTemplate,
  steadyAngleTo,
} from '../types';

// Within this angle of the target the mech is "facing" it and may crawl forward.
const FACE_THRESHOLD = 0.2; // rad (~11 deg)
// In-place turn rate while aligning, so the render facing has time to catch up
// before any translation starts.
const TURN_RATE = Math.PI * 1.5; // rad/s
// Cadence of the red "ticking" light pulse during the fuse (~4 Hz at 20 Hz tick).
const FLASH_INTERVAL_TICKS = 5;

/** Rotate `current` toward `target` by at most `maxStep`, taking the short way
 *  around the circle. Snaps once within a step. */
function turnToward(current: number, target: number, maxStep: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

function detonate(ctx: SimContext, mob: Entity, bomb: NonNullable<MobTemplate['meleeBomb']>): void {
  const school = (bomb.school ?? 'fire') as Aura['school'];
  ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
  if (!MOBS[mob.templateId]?.quietMechanics)
    ctx.emit({
      type: 'log',
      text: `${mob.name} detonates!`,
      color: '#ff9933',
      entityId: mob.id,
    });
  for (const meta of ctx.players.values()) {
    const pe = ctx.entities.get(meta.entityId);
    if (pe && !pe.dead && dist2d(pe.pos, mob.pos) <= bomb.radius) {
      const dmg = Math.round(ctx.rng.range(bomb.min, bomb.max) * (mob.mechanicDamageMult ?? 1));
      ctx.dealDamage(mob, pe, dmg, false, school, bomb.name, 'hit', true);
    }
  }
  // The blast is the mech's own death: run the normal death path so the corpse,
  // loot, and Death animation all resolve exactly as a killed mob's would.
  ctx.handleDeath(mob, null);
}

/** One engaged tick for a meleeBomb mob. Owns movement, facing, arming, and the
 *  detonation; the caller returns 'done' after this so the normal pursuit and
 *  melee-swing logic never run for a bomber. */
export function updateDerelictBomber(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  profile: MobCombatProfile,
): void {
  const bomb = MOBS[mob.templateId]?.meleeBomb;
  if (!bomb) return;

  // Armed: stand fast facing the target, tick the fuse, detonate at zero.
  if ((mob.bombWindup ?? 0) > 0) {
    mob.aiState = 'attack';
    mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
    if (ctx.tickCount % FLASH_INTERVAL_TICKS === 0)
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: 'fire',
        fx: 'procSurge',
      });
    mob.bombWindup = Math.max(0, (mob.bombWindup ?? 0) - DT);
    if ((mob.bombWindup ?? 0) <= 0) detonate(ctx, mob, bomb);
    return;
  }

  const d = dist2d(mob.pos, target.pos);
  if (d <= profile.meleeRange) {
    // Reached the target: arm the fuse and stand up (the StandUp one-shot).
    mob.bombWindup = bomb.windup;
    mob.aiState = 'attack';
    mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: mob.id,
      school: 'fire',
      fx: 'flourish',
    });
    return;
  }

  // Approach: FACE the target first (turn in place, no translation), then crawl
  // straight in once aligned so the body never slides sideways.
  mob.aiState = 'chase';
  if (ctx.isRooted(mob)) {
    mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
    return;
  }
  const desired = angleTo(mob.pos, target.pos);
  let diff = desired - mob.facing;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) > FACE_THRESHOLD) {
    mob.facing = turnToward(mob.facing, desired, TURN_RATE * DT);
    return;
  }
  ctx.moveToward(mob, target.pos, mob.moveSpeed * profile.chaseSpeedMult * ctx.moveSpeedMult(mob));
}
