// Pull toward a point (G13 in docs/design/dungeon-rework/README.md): drag a
// player a few yards toward a spot this tick (an undertow, a whirlpool), with
// the knockback's terrain clamp and collider sweep (knockback.ts displaceAlong),
// so a pulled body stops at a wall or a cliff edge exactly like a shoved one
// and the result is identical on every host. The same shields as a knockback
// hold a body in place: the Mooring Stone, the Veilbound March, an Ice Block
// and a dev anchor. Zero rng.

import { isVeilboundMarchActive } from './combat/paladin_veilbound_state';
import { isMoored } from './combat/trinkets';
import { displaceAlong } from './knockback';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

/** Is `target` held against a pull this tick (the Mooring Stone, the
 *  Veilbound March, an Ice Block, a dev anchor)? */
export function pullHeld(ctx: SimContext, target: Entity): boolean {
  if (ctx.isIceBlocked(target) || isVeilboundMarchActive(target) || isMoored(target)) return true;
  return ctx.cfg.devCommands && ctx.players.get(target.id)?.devAnchored === true;
}

/**
 * Drag `target` up to `step` yards toward (x, z), never closer than `stop`
 * yards to it. Returns the yards moved (0 when held, or already there).
 */
export function pullToward(
  ctx: SimContext,
  target: Entity,
  x: number,
  z: number,
  step: number,
  stop: number,
): number {
  if (pullHeld(ctx, target)) return 0;
  const dx = x - target.pos.x;
  const dz = z - target.pos.z;
  const len = Math.hypot(dx, dz);
  if (len <= stop + 1e-6) return 0;
  return displaceAlong(ctx, target, dx / len, dz / len, Math.min(step, len - stop));
}
