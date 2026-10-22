import type { LayoutRoad, RoadLayout } from './types';

export const roadLayoutKey = (points: LayoutRoad): string =>
  JSON.stringify(points.map(({ x, z }) => [x, z]));

export function validLayoutRoad(points: LayoutRoad): boolean {
  return points.length >= 2 && points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
}

/** Keep unrelated/new roads; reject stale or ambiguous source geometry. */
export function placeLayoutRoads(base: LayoutRoad[], layout?: RoadLayout): LayoutRoad[] {
  if (!layout || (!layout.edits.length && !layout.additions.length)) return base;
  const edits = new Map<string, LayoutRoad | null>();
  for (const edit of layout.edits) {
    const key = roadLayoutKey(edit.source);
    if (edits.has(key)) throw new Error('Duplicate road layout identity');
    if (base.filter((road) => roadLayoutKey(road) === key).length !== 1)
      throw new Error('Road source is missing or ambiguous');
    if (edit.points !== null && !validLayoutRoad(edit.points))
      throw new Error('Invalid edited road geometry');
    edits.set(key, edit.points);
  }
  const ids = new Set<string>();
  for (const addition of layout.additions) {
    if (!addition.id || ids.has(addition.id) || !validLayoutRoad(addition.points))
      throw new Error('Invalid or duplicate road addition');
    ids.add(addition.id);
  }
  const clone = (points: LayoutRoad) => points.map(({ x, z }) => ({ x, z }));
  return [
    ...base.flatMap((road) => {
      const edit = edits.get(roadLayoutKey(road));
      return edit === undefined ? [road] : edit === null ? [] : [clone(edit)];
    }),
    ...layout.additions.map((road) => clone(road.points)),
  ];
}
