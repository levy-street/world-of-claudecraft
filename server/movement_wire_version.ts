export type MovementWireVersion = 1 | 2;

export function negotiateMovementWireVersion(offered: unknown): MovementWireVersion {
  return offered === 2 ? 2 : 1;
}
