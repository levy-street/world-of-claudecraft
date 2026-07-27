// The character physics engine's public surface. Consumers import from here,
// never from the files behind it: `src/sim/player_motion.ts` (the movement
// kernel both hosts run) is the only production consumer today.
export {
  type CharacterMoveParams,
  type CharacterMoveResult,
  floorHeightAt,
  MAX_STEP_HEIGHT,
  moveCharacter,
  physicsStats,
  resetPhysicsStats,
} from './character';
export { overlapCollider, SKIN_WIDTH, type SweepHit, sweepCollider } from './sweep';
