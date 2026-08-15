export function matrixElementsExactlyEqual(
  previous: ArrayLike<number>,
  current: ArrayLike<number>,
): boolean {
  if (previous.length !== current.length) return false;
  for (let i = 0; i < previous.length; i++) {
    if (!Object.is(previous[i], current[i])) return false;
  }
  return true;
}

export function skeletonPaletteNeedsUpdate(
  poseRevision: number,
  appliedPoseRevision: number,
  previousWorldMatrix: ArrayLike<number> | null,
  currentWorldMatrix: ArrayLike<number>,
): boolean {
  return (
    previousWorldMatrix === null ||
    poseRevision !== appliedPoseRevision ||
    !matrixElementsExactlyEqual(previousWorldMatrix, currentWorldMatrix)
  );
}
