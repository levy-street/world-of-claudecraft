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

import { PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../pathfind';
import { PLATFORM_CARRY_CLEARANCE } from '../physics/character';
import { rideHeight, rideSteepnessAt } from '../ride_height';
import type { Entity, MoveInput } from '../types';
import { groundHeight, terrainDownhill, terrainHeight, waterLevelAt } from '../world';
import { afflictionCanCastWhileMoving } from './affliction';
import { isRooted } from './cc';
import { iceFloesAuraForAbility } from './empower_next';

const SWIM_DEPTH = PLAYER_SWIM_DEPTH;
const MAX_CLIMB_SLOPE = PLAYER_MAX_CLIMB_SLOPE;

function swimsAt(y: number, ground: number, level: number): boolean {
  return ground < level - SWIM_DEPTH && y <= level - 0.75 + 0.15;
}

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

// The movement-cancel predicate only fires when those held keys would actually
// translate the body. A root, steep ground control strip, or locked dismount
// channel means the player is holding input but not moving.
export function movementInputWouldMove(
  p: Entity,
  inp: MoveInput,
  steepGround: boolean,
  mountLocked: boolean,
): boolean {
  return hasMovementInput(inp) && !isRooted(p) && !steepGround && !mountLocked;
}

export function heldMovementInputWouldMove(p: Entity, inp: MoveInput, seed: number): boolean {
  if (!hasMovementInput(inp)) return false;
  const swimGround = groundHeight(p.pos.x, p.pos.z, seed);
  const swimLevel = waterLevelAt(p.pos.x, p.pos.z, seed);
  const swimming = swimsAt(p.pos.y, swimGround, swimLevel);
  const steepFlagged =
    p.onGround &&
    !swimming &&
    rideSteepnessAt(p.pos.x, p.pos.z, seed) > MAX_CLIMB_SLOPE &&
    p.pos.y <=
      rideHeight(p.pos.x, p.pos.z, terrainHeight(p.pos.x, p.pos.z, seed), seed) +
        PLATFORM_CARRY_CLEARANCE;
  const steepGround = steepFlagged && terrainDownhill(p.pos.x, p.pos.z, seed) !== null;
  const mountLocked = p.mountCastRemaining > 0 && p.mountCastKey === '';
  return movementInputWouldMove(p, inp, steepGround, mountLocked);
}
