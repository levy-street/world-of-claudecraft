export function characterViewOutsideHysteresis(
  wasVisible: boolean,
  distanceSquared: number,
  createRangeSquared: number,
  destroyRangeSquared: number,
): boolean {
  const cutoff = wasVisible ? destroyRangeSquared : createRangeSquared;
  return distanceSquared > cutoff;
}
