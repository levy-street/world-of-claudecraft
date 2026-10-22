import { builtinKeyOf } from '../render/terrain_texture_sets';
import { decodeBiomePaintIdsRle, encodeBiomePaintIdsRle } from '../sim/biome_paint_codec';
import {
  MAX_GRASS_CLEAR,
  MAX_TERRAIN_EDITS,
  type MapDoc,
  sanitizeBiomePaint,
  sanitizeStamp,
} from '../sim/map_doc';
import type { LayoutEnvironment } from '../sim/world_layout/types';

export interface EnvironmentLayoutReview {
  reason: string;
  terrainEdits?: true;
  grassClear?: true;
  biomePaint?: true;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** Use the document validators, but reject loss/clamping instead of silently repairing a release. */
export function compileLayoutEnvironment(
  map: MapDoc,
  review: EnvironmentLayoutReview | undefined,
  issue: (id: string, reason: string) => void,
): LayoutEnvironment | undefined {
  if (!review) return undefined;
  if (!review.reason.trim()) {
    issue('environment-review', 'Environment import needs a recorded composition decision.');
    return undefined;
  }
  const out: LayoutEnvironment = {};
  if (review.terrainEdits) {
    if (map.terrainEdits.length > MAX_TERRAIN_EDITS)
      issue('terrain-cap', 'Terrain exceeds the document cap.');
    out.terrainEdits = [];
    for (const [index, stamp] of map.terrainEdits.entries()) {
      const { id: _id, ...source } = stamp;
      const parsed = sanitizeStamp(source);
      // Explicit add and omitted mode have identical semantics.
      const comparable = { ...source };
      if (comparable.mode === 'add') delete comparable.mode;
      if (!parsed || stable(parsed) !== stable(comparable))
        issue(`terrain:${index}`, 'Terrain stamp would be discarded or changed by validation.');
      else out.terrainEdits.push(parsed);
    }
  }
  if (review.grassClear) {
    const circles = map.grassClear ?? [];
    if (circles.length > MAX_GRASS_CLEAR)
      issue('grass-cap', 'Grass clearings exceed the document cap.');
    out.grassClear = circles.map(({ id: _id, ...circle }, index) => {
      if (
        ![circle.x, circle.z, circle.r].every(Number.isFinite) ||
        circle.r < 0.1 ||
        circle.r > 400 ||
        Object.keys(circle).some((key) => !['x', 'z', 'r'].includes(key))
      )
        issue(`grass:${index}`, 'Invalid grass clearing.');
      return circle;
    });
  }
  if (review.biomePaint) {
    const encoded = map.biomePaint as
      | (NonNullable<MapDoc['biomePaint']> & { idsRle?: string })
      | undefined;
    if (!encoded) issue('biome-paint', 'Reviewed biome paint is absent.');
    else {
      const { idsRle, ...grid } = encoded;
      const source = {
        ...grid,
        ids: idsRle === undefined ? grid.ids : decodeBiomePaintIdsRle(idsRle),
      };
      const parsed = sanitizeBiomePaint(source);
      if (!parsed || stable(parsed) !== stable(source))
        issue('biome-paint', 'Biome paint would be discarded or changed by validation.');
      else {
        for (const swatch of parsed.custom ?? [])
          if (swatch.textureSha && !builtinKeyOf(swatch.textureSha))
            issue(
              `paint-texture:${swatch.id}`,
              'Imported paint texture needs an explicit shipped asset binding.',
            );
        const { ids, ...metadata } = parsed;
        out.biomePaint = { ...metadata, idsRle: encodeBiomePaintIdsRle(ids) };
      }
    }
  }
  return out;
}
