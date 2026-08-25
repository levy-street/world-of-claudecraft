export type DodgeVisualDirection = 'forward' | 'back' | 'left' | 'right';

export const PLAYER_DODGE_ROLL_CLIPS: Readonly<Record<DodgeVisualDirection, string>> = {
  forward: 'Player_Dodge_Roll_Forward',
  back: 'Player_Dodge_Roll_Back',
  left: 'Player_Dodge_Roll_Left',
  right: 'Player_Dodge_Roll_Right',
};
export const PLAYER_DODGE_ROLL_CLIP = PLAYER_DODGE_ROLL_CLIPS.forward;
export const PLAYER_DODGE_ROLL_SOURCE = 'Running_A';

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
