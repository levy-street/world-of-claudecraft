// Pure placement math for fitting fixed-length dungeon wall modules to authored
// wall segments. Keeping every module inside its segment prevents short pieces
// beside a doorway from visually covering the collision-free opening.

export interface AuthoredWallCell {
  center: number;
  length: number;
}

export function fitAuthoredWallSegment(
  a: number,
  b: number,
  moduleLength: number,
): AuthoredWallCell[] {
  const length = Math.max(0, b - a);
  if (length === 0 || moduleLength <= 0) return [];
  const count = Math.max(1, Math.ceil(length / moduleLength));
  const cellLength = length / count;
  return Array.from({ length: count }, (_, index) => ({
    center: a + cellLength * (index + 0.5),
    length: cellLength,
  }));
}
