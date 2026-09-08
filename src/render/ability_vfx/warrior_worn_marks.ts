interface SpriteSink {
  push(
    x: number,
    y: number,
    z: number,
    color: number,
    size: number,
    cell: number,
    alpha: number,
    brightness: number,
  ): void;
}

/** A split armor seam or downward iron weights, worn on the receiving body.
 * These reuse the overlay batch and never tint the character's materials. */
export function drawWarriorWornMark(
  sink: SpriteSink,
  breach: boolean,
  at: { x: number; y: number; z: number },
  _rightX: number,
  _rightZ: number,
  cell: number,
  alpha: number,
  towardX = 0,
  towardY = 0,
  towardZ = 0,
): void {
  // Offset along the view direction preserves the projected imprint while
  // clearing broad equipped silhouettes. The actual mage mesh buried five of
  // six former spark centres at 0.55; ordinary depth testing remains enabled.
  sink.push(
    at.x + towardX * 1.2,
    at.y - 0.15 + towardY * 1.2,
    at.z + towardZ * 1.2,
    breach ? 0xe9ad79 : 0x93bfdb,
    breach ? 1.05 : 0.95,
    cell,
    alpha,
    1.5,
  );
}
