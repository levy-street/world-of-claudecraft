import type { MapDoc, MapPlacement } from '../sim/map_doc';
import {
  emptyZoneProps,
  type PlacedAsset,
  type WorldContent,
  type ZonePropsDef,
} from '../sim/types';
import type { LayoutDeck } from '../sim/world_layout/decks';
import {
  LAYOUT_PROP_FAMILIES,
  type LayoutPropRemoval,
  propHutCenter,
  propRecordKey,
  propSourceIndex,
} from '../sim/world_layout/props';
import { WORLD_SEED } from '../sim/world_seed';
import { placementsToPlayAssets } from './custom_map';
import { compileLayoutAdditions } from './world_layout_additions';
import { layoutDockDecks } from './world_layout_docks';
import { layoutPropAmbience } from './world_layout_prop_ambience';
import { matchLayoutScenery } from './world_layout_scenery';
import { decorPropPlacements, worldMajorPropPlacements } from './world_prop_placements';

export interface PropLayoutReplacement {
  record: LayoutPropRemoval;
  parts: { source: MapPlacement; uid: string }[];
  reason: string;
}

/** Convert the complete parent, retaining the canonical variant of indexed props. */
export function layoutPropPlacements(props: ZonePropsDef, edit: LayoutPropRemoval): MapPlacement[] {
  if (!LAYOUT_PROP_FAMILIES.includes(edit.family)) throw new Error('Unsupported scenery family');
  const matches = (props[edit.family] ?? []).flatMap((record, index) =>
    propRecordKey(record) === propRecordKey(edit.source) ? [index] : [],
  );
  if (matches.length !== 1) throw new Error('Missing or ambiguous canonical scenery record');
  const selected = {
    ...emptyZoneProps(),
    layoutHutCenter: propHutCenter(props),
    [edit.family]: [edit.source],
    layoutSourceIndices: { [edit.family]: [propSourceIndex(props, edit.family, matches[0])] },
  };
  return [
    ...worldMajorPropPlacements(selected, WORLD_SEED, false),
    ...decorPropPlacements(selected),
  ];
}

/** Replace a whole parent only after every child has an explicit retained/replaced result. */
export function compileLayoutProps(
  map: MapDoc,
  edits: readonly PropLayoutReplacement[] | undefined,
  props: ZonePropsDef,
  current: readonly MapPlacement[] | undefined,
  used: Set<string>,
  reserved: Set<number>,
  issue: (id: string, reason: string) => void,
) {
  const additions: PlacedAsset[] = [];
  const decks: LayoutDeck[] = [];
  const propRemovals: LayoutPropRemoval[] = [];
  const retainedFences: ZonePropsDef['fences'] = [];
  const ambience: NonNullable<WorldContent['sceneryAmbience']> = [];
  const records = new Set<string>();
  for (const edit of edits ?? []) {
    const id = `prop:${edit.record.family}:${propRecordKey(edit.record.source)}`;
    try {
      if (!current || !edit.reason.trim() || !edit.parts.length || records.has(id))
        throw new Error(
          'Replacement needs a fresh baseline, distinct parent, changed children and a reason.',
        );
      const children = layoutPropPlacements(props, edit.record);
      if (!children.length)
        throw new Error('Canonical prop has no supported placement projection.');
      const baseline = matchLayoutScenery(children, current);
      if (
        baseline.unmatchedSource.length ||
        baseline.matches.some((m) => reserved.has(m.currentIndex))
      )
        throw new Error('Canonical group is missing or already replaced in the baseline.');
      const localUsed = new Set(used);
      const changed = new Map<number, PlacedAsset>();
      for (const part of edit.parts) {
        const matches = matchLayoutScenery([part.source, part.source], children).matches;
        if (matches.length !== 1 || changed.has(matches[0].currentIndex))
          throw new Error('Changed child needs a unique, unchanged parent baseline.');
        const errors: string[] = [];
        const replacement = compileLayoutAdditions(
          map,
          { [part.uid]: edit.reason },
          localUsed,
          (_id, reason) => errors.push(reason),
        );
        if (errors.length || replacement.length !== 1)
          throw new Error(errors.join(' ') || 'Invalid replacement child');
        changed.set(matches[0].currentIndex, replacement[0]);
      }
      const remaining = children.flatMap((child, index) => (changed.has(index) ? [] : [child]));
      // Keep untouched siblings, including children absent from the old source.
      // Absence alone does not authorize deleting newer canonical scenery.
      const source = map.placements.filter((p) => p.uid && !localUsed.has(p.uid));
      const retained = matchLayoutScenery(source, remaining, map.assetCollisionMesh);
      for (const match of retained.matches) localUsed.add(source[match.sourceIndex].uid!);
      const keptFences: ZonePropsDef['fences'] = [];
      if (edit.record.family === 'fences') {
        const fence = edit.record.source;
        for (let index = 0; index < children.length; index++) {
          if (changed.has(index)) continue;
          const start = index;
          while (index + 1 < children.length && !changed.has(index + 1)) index++;
          const point = (t: number) => ({
            x: fence.x1 + (fence.x2 - fence.x1) * t,
            z: fence.z1 + (fence.z2 - fence.z1) * t,
          });
          const a = point(start / children.length),
            b = point((index + 1) / children.length);
          keptFences.push({
            ...fence,
            ...(fence.id ? { id: `${fence.id}:layout:${start}` } : {}),
            x1: a.x,
            z1: a.z,
            x2: b.x,
            z2: b.z,
          });
        }
      }
      const projected = placementsToPlayAssets(remaining);
      if (projected.length !== remaining.length)
        throw new Error('Untouched children would be lost during projection.');
      const groupDecks =
        edit.record.family === 'docks'
          ? layoutDockDecks(
              edit.record.source,
              children,
              children.map(
                (child, index) => changed.get(index) ?? placementsToPlayAssets([child])[0],
              ),
            )
          : [];
      decks.push(...groupDecks);
      // Native fence runs retain isFence, jump crossing and authored rail height.
      retainedFences.push(...keptFences);
      additions.push(...(edit.record.family === 'fences' ? [] : projected), ...changed.values());
      const main = changed.get(0) ?? placementsToPlayAssets([children[0]])[0];
      ambience.push(...layoutPropAmbience(edit.record, children[0], main));
      propRemovals.push(edit.record);
      records.add(id);
      for (const uid of localUsed) used.add(uid);
      for (const match of baseline.matches) reserved.add(match.currentIndex);
    } catch (error) {
      issue(id, error instanceof Error ? error.message : String(error));
    }
  }
  return { additions, propRemovals, retainedFences, ambience, decks };
}
