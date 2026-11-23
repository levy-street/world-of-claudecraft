import { type BrushShape, brushDistanceSquared } from '../sim/brush_shape';
import type { BiomePaint } from '../sim/types';

export interface BiomeBrush {
  x: number;
  z: number;
  radius: number;
  shape?: BrushShape;
  hardness: number;
  sampleAlpha?: (u: number, v: number) => number;
}

/** Visits changed cells only; the caller owns mutation and stroke undo recording. */
export function visitBiomeBrushCells(
  grid: BiomePaint,
  brush: BiomeBrush,
  paintId: number,
  visit: (index: number) => void,
): void {
  const { x, z, radius } = brush;
  if (!(radius > 0) || !Number.isFinite(radius + x + z)) return;
  const hard = Math.min(1, Math.max(0, brush.hardness));
  const c0 = Math.max(0, Math.floor((x - radius - grid.originX) / grid.cell));
  const c1 = Math.min(grid.cols - 1, Math.floor((x + radius - grid.originX) / grid.cell));
  const r0 = Math.max(0, Math.floor((z - radius - grid.originZ) / grid.cell));
  const r1 = Math.min(grid.rows - 1, Math.floor((z + radius - grid.originZ) / grid.cell));
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const dx = grid.originX + (col + 0.5) * grid.cell - x;
      const dz = grid.originZ + (row + 0.5) * grid.cell - z;
      const d2 = brushDistanceSquared(dx, dz, brush.shape);
      if (d2 > radius * radius) continue;
      let coverage = brush.sampleAlpha ? brush.sampleAlpha(dx / radius, dz / radius) : 1;
      if (hard < 1) {
        const distance = Math.sqrt(d2) / radius;
        if (distance > hard) {
          const t = (distance - hard) / Math.max(0.001, 1 - hard);
          coverage *= 1 - t * t;
        }
      }
      if (coverage <= 0) continue;
      // Keep the existing deterministic R2 dither, including the circular default.
      const gate = (col * 0.7548776662466927 + row * 0.5698402909980532) % 1;
      if (coverage < 1 && gate >= coverage) continue;
      const index = row * grid.cols + col;
      if (grid.ids[index] !== paintId) visit(index);
    }
  }
}
