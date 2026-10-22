import type { AssetCollisionBox, MapPlacement } from '../sim/map_doc';
import type { PlacedAsset } from '../sim/types';
import { placementsToRenderAssets } from './custom_map';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stableValue(v)]),
    );
  return value;
}

/** Compare the actual play projection, including collision, with only documented defaults normalized. */
function signature(asset: PlacedAsset, placement: MapPlacement): string {
  return JSON.stringify(
    stableValue({
      ...asset,
      // Objective anchors are projected separately from render/collision assets.
      regionRole: placement.regionRole,
      y: asset.y ?? 0,
      rotX: asset.rotX ?? 0,
      rotZ: asset.rotZ ?? 0,
      scaleX: asset.scaleX ?? 1,
      scaleY: asset.scaleY ?? 1,
      scaleZ: asset.scaleZ ?? 1,
    }),
  );
}

export interface SceneryMatches {
  matches: { sourceIndex: number; currentIndex: number }[];
  unmatchedSource: number[];
  unmatchedCurrent: number[];
}

/** Each current object can satisfy exactly one source object. Unknown assets never match. */
export function matchLayoutScenery(
  source: readonly MapPlacement[],
  current: readonly MapPlacement[],
  sourceMeshes?: Readonly<Record<string, readonly AssetCollisionBox[]>>,
): SceneryMatches {
  const project = (placements: readonly MapPlacement[], meshes?: typeof sourceMeshes) =>
    placementsToRenderAssets(placements, { keepLocalIds: true, meshCollision: meshes });
  const buckets = new Map<string, { indices: number[]; next: number }>();
  project(current).forEach((asset, index) => {
    if (!asset) return;
    const key = signature(asset, current[index]);
    const bucket = buckets.get(key) ?? { indices: [], next: 0 };
    bucket.indices.push(index);
    buckets.set(key, bucket);
  });
  const matches: SceneryMatches['matches'] = [];
  const unmatchedSource: number[] = [];
  const used = new Set<number>();
  project(source, sourceMeshes).forEach((asset, sourceIndex) => {
    const bucket = asset && buckets.get(signature(asset, source[sourceIndex]));
    if (!bucket || bucket.next === bucket.indices.length) {
      unmatchedSource.push(sourceIndex);
      return;
    }
    const currentIndex = bucket.indices[bucket.next++];
    used.add(currentIndex);
    matches.push({ sourceIndex, currentIndex });
  });
  return {
    matches,
    unmatchedSource,
    unmatchedCurrent: current.map((_, i) => i).filter((i) => !used.has(i)),
  };
}
