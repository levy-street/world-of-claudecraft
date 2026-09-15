// The ONE predicate for "does a cast/channel of `abilityId` survive `p` moving": both
// castAbility's deny-at-press guard (casting_lifecycle.ts, refuses the press outright
// before it ever arms the GCD) and player_motion's move-to-cancel check (interrupts an
// in-progress cast) read it, so the two can never disagree. Before this module existed
// they were two independent copies of the same expression: a press while already moving
// would pass the (stale) deny-at-press copy, start the cast and arm the GCD, then get
// killed by the move-to-cancel copy on the very next tick, wasting a full GCD on a cast
// that never had a chance to complete. A def-level castWhileMoving flag, a talent-resolved
// override, Ice Floes, Affliction's Drain Life under Evil Eye Possession, and the
// Processional Grace aura all grant mobility.
//
// `src/sim`-pure: no SimContext, no rng, no clock. Reused by src/render/self_motion.ts
// through player_motion.ts, so it must stay host-agnostic.

import type { Entity, MoveInput } from '../types';
import { afflictionCanCastWhileMoving } from './affliction';
import { iceFloesAuraForAbility } from './empower_next';

export function abilityCastSurvivesMovement(
  p: Entity,
  abilityId: string,
  resolved: { def: { castWhileMoving?: boolean }; castWhileMoving?: boolean },
): boolean {
  return Boolean(
    resolved.def.castWhileMoving ||
      resolved.castWhileMoving ||
      iceFloesAuraForAbility(p, abilityId) !== undefined ||
      afflictionCanCastWhileMoving(p, abilityId) ||
      p.auras.some((a) => a.kind === 'processional_grace'),
  );
}

// Whether the held directional input alone would move the player: forward/back/strafe
// only, mirroring player_motion's own hasMoveInput (turning in place and jump never
// count). This is the one thing castAbility needs at press time to know whether the
// very next movement tick would cancel a cast it is about to start.
export function hasMovementInput(inp: MoveInput): boolean {
  return inp.forward || inp.back || inp.strafeLeft || inp.strafeRight;
}
