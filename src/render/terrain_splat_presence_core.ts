export interface TerrainSplatPresence {
  readonly splat: readonly [boolean, boolean, boolean, boolean];
  readonly extra: readonly [boolean, boolean];
}

export function terrainSplatPresenceMask(presence: TerrainSplatPresence): number {
  return (
    Number(presence.splat[0]) |
    (Number(presence.splat[1]) << 1) |
    (Number(presence.splat[2]) << 2) |
    (Number(presence.splat[3]) << 3) |
    (Number(presence.extra[0]) << 4) |
    (Number(presence.extra[1]) << 5)
  );
}

/**
 * Conservative per-chunk layer presence for the terrain fragment shader.
 * A channel is absent only when every source vertex is exactly zero, so its
 * linearly interpolated fragment weight is also exactly zero across the draw.
 * NaN is treated as present to keep malformed data on the full shader path.
 */
export function terrainSplatPresence(
  splats: ArrayLike<number> | null,
  extras: ArrayLike<number> | null,
): TerrainSplatPresence {
  const splat = [false, false, false, false];
  const extra = [false, false];

  if (splats) {
    for (let i = 0; i < splats.length; i += 4) {
      for (let channel = 0; channel < 4; channel++) {
        if (splats[i + channel] !== 0) splat[channel] = true;
      }
    }
  }
  if (extras) {
    for (let i = 0; i < extras.length; i += 4) {
      if (extras[i] !== 0) extra[0] = true;
      if (extras[i + 1] !== 0) extra[1] = true;
    }
  }

  return {
    splat: splat as [boolean, boolean, boolean, boolean],
    extra: extra as [boolean, boolean],
  };
}
