import type { MapPlacement } from '../sim/map_doc';
import type { PlacedAsset, WorldContent } from '../sim/types';
import type { LayoutPropRemoval } from '../sim/world_layout/props';

/** Native ambience follows the parent's main model, not an edited accessory. */
export function layoutPropAmbience(
  record: LayoutPropRemoval,
  source: MapPlacement,
  target: PlacedAsset,
): NonNullable<WorldContent['sceneryAmbience']> {
  const kind =
    record.family === 'campfires'
      ? 'campfire'
      : record.family === 'stalls' && record.source.smithy
        ? 'forge'
        : null;
  if (!kind) return [];
  const height = kind === 'campfire' ? 0.6 : 1;
  return [
    {
      id: `layout:${kind}:${source.x}:${source.z}`,
      kind,
      x: target.x,
      z: target.z,
      offsetY: (target.y ?? 0) + height - (source.y ?? 0),
      ...(target.detached ? { groundY: target.groundY ?? 0 } : {}),
    },
  ];
}
