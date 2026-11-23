/** World-aligned brush footprints. Radius is half the square's side length. */
export type BrushShape = 'circle' | 'square';

export function brushDistanceSquared(dx: number, dz: number, shape?: BrushShape): number {
  return shape === 'square' ? Math.max(dx * dx, dz * dz) : dx * dx + dz * dz;
}

export function brushContains(dx: number, dz: number, radius: number, shape?: BrushShape): boolean {
  return radius > 0 && brushDistanceSquared(dx, dz, shape) < radius * radius;
}
