import type { MapDoc, MapPlacement } from '../sim/map_doc';
import type { PlacedAsset } from '../sim/types';
import { compileLayoutAdditions } from './world_layout_additions';
import { matchLayoutScenery } from './world_layout_scenery';

export interface DecorationLayoutReplacement {
  uid: string;
  source: MapPlacement;
  key: string;
  reason: string;
}

/** The generator's stable exclusion key removes exactly the replaced tree/rock/dressing. */
export function compileLayoutDecorations(
  map: MapDoc,
  edits: readonly DecorationLayoutReplacement[] | undefined,
  current: readonly MapPlacement[] | undefined,
  used: Set<string>,
  reservedIndices: Set<number>,
  issue: (id: string, reason: string) => void,
) {
  const additions: PlacedAsset[] = [];
  const decorationExclusions: string[] = [];
  for (const edit of edits ?? []) {
    const matches = current && matchLayoutScenery([edit.source, edit.source], current).matches;
    const index = matches?.length === 1 ? matches[0].currentIndex : undefined;
    if (
      index === undefined ||
      current?.[index].uid !== `decoration:${edit.key}` ||
      reservedIndices.has(index)
    ) {
      issue(
        `decoration:${edit.uid}`,
        'Decoration replacement needs one unchanged generator baseline and its exact exclusion key.',
      );
      continue;
    }
    const projected = compileLayoutAdditions(map, { [edit.uid]: edit.reason }, used, issue);
    if (projected.length !== 1) continue;
    reservedIndices.add(index);
    decorationExclusions.push(edit.key);
    additions.push(projected[0]);
  }
  return { additions, decorationExclusions };
}
