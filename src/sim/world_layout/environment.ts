import { decodeBiomePaintIdsRle } from '../biome_paint_codec';
import type { WorldContent } from '../types';
import type { LayoutEnvironment } from './types';

/** Sculpt order includes repeated dabs. Current pads remain underneath. */
export function placeLayoutEnvironment(base: WorldContent, edit?: LayoutEnvironment): WorldContent {
  if (!edit) return base;
  let paint = base.biomePaint;
  if (edit.biomePaint) {
    const { idsRle, ...grid } = edit.biomePaint;
    const ids = decodeBiomePaintIdsRle(idsRle);
    if (!ids || ids.length !== grid.cols * grid.rows)
      throw new Error('Invalid layout biome paint encoding');
    if (paint) {
      for (const key of ['edgeSoftness', 'edgeDetail'] as const)
        if (paint[key] !== grid[key])
          throw new Error('Layout paint edge settings conflict with current paint');
      for (const key of ['cell', 'cols', 'rows', 'originX', 'originZ'] as const)
        if (paint[key] !== grid[key])
          throw new Error('Layout paint grid conflicts with current paint');
      const custom = new Map((paint.custom ?? []).map((swatch) => [swatch.id, swatch]));
      for (const swatch of grid.custom ?? []) {
        const current = custom.get(swatch.id);
        if (current && JSON.stringify(current) !== JSON.stringify(swatch))
          throw new Error(`Layout paint swatch conflicts with current paint: ${swatch.id}`);
        custom.set(swatch.id, swatch);
      }
      const currentIds = paint.ids;
      paint = {
        ...paint,
        ...grid,
        custom: [...custom.values()],
        ids: ids.map((id, i) => (id === 255 ? currentIds[i] : id)),
      };
    } else paint = { ...grid, ids };
  }
  return {
    ...base,
    ...(edit.terrainEdits?.length
      ? { terrainEdits: [...(base.terrainEdits ?? []), ...edit.terrainEdits] }
      : {}),
    ...(edit.grassClear?.length
      ? { grassClear: [...(base.grassClear ?? []), ...edit.grassClear] }
      : {}),
    ...(paint ? { biomePaint: paint } : {}),
  };
}
