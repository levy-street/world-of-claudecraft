import type { MapDoc } from '../sim/map_doc';
import { validLayoutRoad } from '../sim/world_layout/roads';
import type { LayoutRoad, RoadLayout } from '../sim/world_layout/types';

export interface RoadLayoutReview {
  /** Source map indices are pinned by the outer review's exact SHA-256. */
  edits: Record<string, LayoutRoad>;
  additionIds: string[];
}

export function compileLayoutRoads(
  map: MapDoc,
  review: RoadLayoutReview | undefined,
  preservedRecords: Record<string, string> | undefined,
  issue: (id: string, reason: string) => void,
): RoadLayout | undefined {
  const result: RoadLayout = { edits: [], additions: [] };
  const preserve = (key: string) => !!preservedRecords?.[key]?.trim();
  for (const [index, source] of Object.entries(review?.edits ?? {})) {
    const edit = map.roadEdits?.[index];
    if (!/^(0|[1-9][0-9]*)$/.test(index) || !map.content.roads?.[Number(index)] || !edit) {
      issue(`road:${index}`, 'Road binding no longer resolves in the reviewed source map.');
      continue;
    }
    if (
      ('removed' in edit && (edit.removed !== true || Object.keys(edit).length !== 1)) ||
      (!('removed' in edit) && Object.keys(edit).some((key) => key !== 'points'))
    ) {
      issue(`road:${index}`, 'Invalid road edit; deletion must be exactly removed: true.');
      continue;
    }
    const points = 'removed' in edit ? null : edit.points;
    if (!validLayoutRoad(source) || (points !== null && !validLayoutRoad(points))) {
      issue(`road:${index}`, 'Invalid road geometry.');
      continue;
    }
    const clone = (road: LayoutRoad) => road.map(({ x, z }) => ({ x, z }));
    result.edits.push({ source: clone(source), points: points && clone(points) });
  }
  const ids = new Set<string>();
  for (const id of review?.additionIds ?? []) {
    const matches = (map.roadDefs ?? []).filter((road) => road.id === id);
    if (ids.has(id) || matches.length !== 1) {
      issue(`roadDef:${id}`, 'Road addition is missing or duplicated.');
      continue;
    }
    ids.add(id);
    const road = matches[0];
    if (road.kind !== 'path' || !validLayoutRoad(road.points)) {
      issue(`roadDef:${id}`, 'Only valid path geometry is supported by the built-in road import.');
      continue;
    }
    result.additions.push({ id, points: road.points.map(({ x, z }) => ({ x, z })) });
  }
  for (const index of Object.keys(map.roadEdits ?? {})) {
    if (!Object.hasOwn(review?.edits ?? {}, index) && !preserve(`road:${index}`))
      issue(`road:${index}`, 'Unreconciled road edit; bind its current canonical source geometry.');
  }
  for (const road of map.roadDefs ?? []) {
    if (!ids.has(road.id) && !preserve(`roadDef:${road.id}`))
      issue(`roadDef:${road.id}`, 'Unreconciled authored road addition.');
  }
  return result.edits.length || result.additions.length ? result : undefined;
}
