// The one shared player-displacement recipe (the portals.ts teleport,
// extracted on the rule of three once the tutorial ferry became its third
// verbatim copy): profession-session teardown, reground at the landing, kill
// the interpolation streak, rebucket, drop target and auto-attack, settle
// the jump arc so no fall distance carries over, then the arcane #b9f flavor
// line. instances/dungeons.ts keeps its own variant (instance claim and
// party bookkeeping are interleaved with its move); any future overworld
// teleport calls this instead of pasting a fourth copy.
//
// Draws ZERO rng, so a caller's position in the tick cannot fork the
// deterministic draw order. `src/sim`-pure (src/sim/CLAUDE.md).

import { cancelProfessionSessionOnDisplacement } from './professions/session_teardown';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

export function displacePlayer(
  ctx: SimContext,
  p: Entity,
  landing: { x: number; z: number; facing: number },
  text: string,
): void {
  // The one every-teleport session teardown (session_teardown.ts): a
  // click-entry mid-cast is reachable and the rule is scoped to every
  // teleport, not the likely ones.
  cancelProfessionSessionOnDisplacement(ctx, p);
  p.pos = ctx.groundPos(landing.x, landing.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = landing.facing;
  p.targetId = null;
  p.autoAttack = false;
  // Land settled: no carried-over jump arc or fall distance from the far
  // side (a portal pair with an elevation delta would otherwise deal fall
  // damage on arrival).
  p.vy = 0;
  p.jumping = false;
  p.onGround = true;
  p.fallStartY = p.pos.y;
  ctx.emit({ type: 'log', text, color: '#b9f', pid: p.id });
}
