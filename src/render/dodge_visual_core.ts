export const PLAYER_DODGE_ROLL_CLIP = 'Player_Dodge_Roll';
export const PLAYER_DODGE_ROLL_SOURCE = 'Running_A';

export type DodgeVisualDirection = 'forward' | 'back' | 'left' | 'right';

/** Maps an authoritative world-space dodge vector into the actor's local facing. */
export function dodgeVisualDirection(
  worldX: number,
  worldZ: number,
  facing: number,
): DodgeVisualDirection {
  if (![worldX, worldZ, facing].every(Number.isFinite)) return 'forward';
  const length = Math.hypot(worldX, worldZ);
  if (length <= 1e-9) return 'forward';
  const x = worldX / length;
  const z = worldZ / length;
  const localRight = -x * Math.cos(facing) + z * Math.sin(facing);
  const localForward = x * Math.sin(facing) + z * Math.cos(facing);
  if (Math.abs(localForward) >= Math.abs(localRight)) {
    return localForward >= 0 ? 'forward' : 'back';
  }
  return localRight >= 0 ? 'right' : 'left';
}
