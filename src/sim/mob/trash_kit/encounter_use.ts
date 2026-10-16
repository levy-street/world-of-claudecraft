// G3, the trash engine's usable encounter bodies (TrashKitDef.usable): a
// player who targets one and presses interact channels a short use on it (a
// non-spell activity, so any hit that lands, a step or a stun breaks it,
// exactly like a gather); when the bar completes the use's effect lands.
// First consumer: the Soul Brazier's Topple Brazier (gravewyrm_sanctum.ts),
// the brazier kicked over onto its own pack.
//
// Server authority: the press arrives through the ordinary `interact` command
// (interaction.ts interact, its target arm), so the online client sends
// nothing new; this module validates everything on the authoritative sim (the
// body is usable, alive, in the claim the player stands in, in reach and in
// sight, the player alive and free to act), re-checks reach and the body
// every tick while the bar runs (casting_lifecycle.ts updateCasting, beside
// the corpse harvest's own recheck), and re-validates at completion. Nothing
// the client says decides an outcome. A use's `range` is capped by the
// interact press's own reach (INTERACT_RANGE + 2, interaction.ts), which runs
// first.
//
// The player's bar is the use's own cast id (it starts with
// KIT_USE_CAST_PREFIX, types.ts isKitUseCast), with castTargetId on the body.
// Zero rng here; a toppled body's spill draws its rolls on its own beats
// (kit_hazard.ts).
//
// Two effects: 'topple' (the body dies and spills a hazard) and 'relight'
// (the body stays; its dungeon module reads `Entity.kitUseCompletedBy` on its
// next pass and decides what was lit: the Hollow Crypt's Remembrance Candles,
// encounters/hollow_crypt/morthen_candles.ts). A def with `holdsThroughHits`
// is not broken by a landed hit (combat/damage.ts asks kitUseHoldsThroughHits);
// a step, a stun, death or drifting out of reach still break it.

import { claimedInstanceAt } from '../../instances/dungeons';
import type { SimContext } from '../../sim_context';
import { type Aura, dist2d, type Entity, isKitUseCast, type KitUseDef } from '../../types';
import { spawnKitHazard } from './kit_hazard';
import { kitOf } from './kit_of';

/** The use a body carries, or null (a mob template's kit `usable`). */
export function kitUseOf(e: Entity | undefined | null): KitUseDef | null {
  if (!e || e.kind !== 'mob') return null;
  return kitOf(e)?.usable ?? null;
}

/** The school a use's beats are drawn in (its spill's, or a relight's own). */
export function kitUseSchool(def: KitUseDef): Aura['school'] {
  return def.effect.kind === 'topple' ? def.effect.hazard.school : def.effect.school;
}

/** Does the use `p` is channelling hold through a hit that lands on them?
 *  (combat/damage.ts: a landed hit breaks every other non-spell cast.) */
export function kitUseHoldsThroughHits(ctx: SimContext, p: Entity): boolean {
  if (!isKitUseCast(p.castingAbility) || p.castTargetId === null) return false;
  const def = kitUseOf(ctx.entities.get(p.castTargetId));
  return !!def && def.castId === p.castingAbility && def.holdsThroughHits === true;
}

/** Is `body` usable right now by anyone (alive, in the world)? */
export function kitUsableNow(body: Entity | undefined | null): boolean {
  return !!body && !body.dead && body.hp > 0 && kitUseOf(body) !== null;
}

/** Why a press on a usable body is refused (null: it may start). The words
 *  are the sim's shared refusal lines (src/ui/sim_i18n.ts re-localizes). */
export function kitUseRefusal(
  ctx: SimContext,
  p: Entity,
  body: Entity,
  def: KitUseDef,
): string | null {
  if (p.dead) return "You can't do that while dead.";
  if (ctx.isStunned(p)) return 'You are busy.';
  if (dist2d(p.pos, body.pos) > def.range) return 'Too far away.';
  if (!ctx.hasLineOfSight(p, body)) return 'Line of sight.';
  // The body and the player must share a claim (no reaching across slots).
  const here = claimedInstanceAt(ctx, p.pos);
  if (!here || !here.mobIds.includes(body.id)) return 'Too far away.';
  if (p.castingAbility !== null) return 'You are busy.';
  return null;
}

/**
 * The interact press landed on `body` (the player's target). Returns true
 * when `body` is a usable body (whether the use started or was refused with
 * an error line), false to let the interact press fall through.
 */
export function tryStartKitUse(ctx: SimContext, body: Entity, p: Entity): boolean {
  const def = kitUseOf(body);
  if (!def || body.dead || body.hp <= 0) return false;
  const refusal = kitUseRefusal(ctx, p, body, def);
  if (refusal) {
    ctx.error(p.id, refusal);
    return true;
  }
  p.castingAbility = def.castId;
  p.castTotal = def.channel;
  p.castRemaining = def.channel;
  p.castTargetId = body.id;
  p.channeling = false;
  p.castAim = null;
  ctx.emit({
    type: 'spellfx',
    sourceId: p.id,
    targetId: body.id,
    school: kitUseSchool(def),
    fx: 'windup',
    ability: def.castId,
  });
  return true;
}

/** The per-tick recheck while a use runs: false cancels it (the body fell,
 *  left, or the player drifted out of reach). */
export function validateKitUse(ctx: SimContext, p: Entity): boolean {
  if (!isKitUseCast(p.castingAbility)) return true;
  const body = p.castTargetId !== null ? ctx.entities.get(p.castTargetId) : undefined;
  const def = kitUseOf(body);
  if (!body || !def || def.castId !== p.castingAbility || !kitUsableNow(body)) return false;
  return dist2d(p.pos, body.pos) <= def.range + 0.5;
}

/** The use's bar completed: re-validate, then land its effect. Returns true
 *  when it landed. */
export function completeKitUse(ctx: SimContext, p: Entity, castId: string, bodyId: number | null) {
  const body = bodyId !== null ? ctx.entities.get(bodyId) : undefined;
  const def = kitUseOf(body);
  p.castTargetId = null;
  if (!body || !def || def.castId !== castId || !kitUsableNow(body) || p.dead) return false;
  if (dist2d(p.pos, body.pos) > def.range + 0.5) return false;
  // A wall that fell between them mid-kick spoils it (the press checked sight).
  if (!ctx.hasLineOfSight(p, body)) return false;
  const inst = claimedInstanceAt(ctx, body.pos);
  if (!inst) return false;
  ctx.emit({
    type: 'spellfx',
    sourceId: p.id,
    targetId: body.id,
    school: kitUseSchool(def),
    fx: 'nova',
    ability: def.castId,
  });
  if (def.effect.kind === 'relight') {
    // The body stays: its dungeon module reads the completion on its pass.
    body.kitUseCompletedBy = p.id;
    return true;
  }
  // Topple: the spill lands `ahead` yards past the body, away from the user.
  const dx = body.pos.x - p.pos.x;
  const dz = body.pos.z - p.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  const x = body.pos.x + (dx / len) * def.effect.ahead;
  const z = body.pos.z + (dz / len) * def.effect.ahead;
  spawnKitHazard(ctx, inst, p, def.effect.hazard, x, z);
  // The body is spent: it dies, credited to the one who toppled it.
  body.facing = Math.atan2(dx, dz);
  ctx.handleDeath(body, p);
  return true;
}
