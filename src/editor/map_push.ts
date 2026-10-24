// Studio's "Push changes to repo map": apply only what the maker changed to a
// repo map (data/maps/<slug>.map.json) since they opened it, onto that file as
// it is NOW, so other people's pushes survive. The merge is map_merge_core.ts;
// this module fetches the three copies from the dev server and hands the
// merged map to the caller's publish (which writes the file and the game's
// module, exactly as Publish to Game does).
//
// The base: when the editor opens a repo map, the dev server names that
// version by its git blob id (scripts/lib/studio_map_base.mjs) and the editor
// stores it on the document as meta.basedOn, so it survives saves and reloads.

import type { CustomMap } from './custom_map';
import { ensureMapItemIds } from './map_item_ids';
import { upgradeLoadedMap } from './map_load_upgrades';
import {
  hasCleanItemIds,
  type MapChangeCounts,
  type MapChangeKind,
  type MapMergeConflict,
  mergeMapChanges,
} from './map_merge_core';
import { parseMap } from './persist';

/** The dev-server header naming the version of a repo map a response carries. */
export const MAP_BASE_HEADER = 'x-studio-map-base';

export type MapPushOutcome =
  | { status: 'notLinked' }
  | { status: 'baseMissing' }
  | { status: 'repoMissing' }
  | { status: 'missingIds' }
  | { status: 'nothing' }
  | { status: 'conflicts'; conflicts: MapMergeConflict[] }
  | { status: 'publishFailed' }
  | {
      status: 'pushed';
      merged: CustomMap;
      applied: Partial<Record<MapChangeKind, MapChangeCounts>>;
      /** An edit touched an item the editor's open-time upgrades added, so
       *  the file took those upgrades too (map_load_upgrades.ts). */
      withUpgrades: boolean;
      /** The repo file's new version, the editor's next base. */
      newBase: string | null;
    };

type Fetch = (url: string) => Promise<Response>;

/** A repo map as it is now, with the id of this version. */
export async function fetchRepoMap(
  slug: string,
  fetchFn: Fetch = fetch,
): Promise<{ map: CustomMap; base: string | null } | null> {
  try {
    const res = await fetchFn(`/__studio_map/doc?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const map = parseMap(await res.text());
    return map ? { map, base: res.headers.get(MAP_BASE_HEADER) } : null;
  } catch {
    return null;
  }
}

/** The version the editing copy was opened from, as the file held it. */
async function fetchBase(id: string, fetchFn: Fetch): Promise<CustomMap | null> {
  try {
    const res = await fetchFn(`/__studio_map/base?id=${encodeURIComponent(id)}`);
    return res.ok ? parseMap(await res.text()) : null;
  } catch {
    return null;
  }
}

/**
 * Push `mine`'s changes into the repo map it was opened from. `mine` gains
 * any missing item ids (in place). `publish` writes the merged map under the
 * slug and resolves true on success. Nothing is written unless the merge is
 * clean and something changed.
 */
export async function pushMapChanges(
  mine: CustomMap,
  publish: (merged: CustomMap, slug: string) => Promise<boolean>,
  fetchFn: Fetch = fetch,
): Promise<MapPushOutcome> {
  const link = mine.meta.basedOn;
  if (!link) return { status: 'notLinked' };
  ensureMapItemIds(mine);
  const base = await fetchBase(link.base, fetchFn);
  if (!base) return { status: 'baseMissing' };
  const now = await fetchRepoMap(link.slug, fetchFn);
  if (!now) return { status: 'repoMissing' };
  // A file whose items lack ids (never migrated, or twins left by a hand
  // merge) cannot say which item is which: refuse rather than guess.
  if (!hasCleanItemIds(base) || !hasCleanItemIds(now.map)) return { status: 'missingIds' };
  // Merge with all three copies upgraded alike (base as the editor upgraded
  // it on open), so neither the editor's open-time upgrades nor the file's
  // lack of them reads as anyone's change.
  upgradeLoadedMap(base);
  const theirs = structuredClone(now.map);
  upgradeLoadedMap(theirs);
  const result = mergeMapChanges(base, mine, theirs);
  if (!result.ok) return { status: 'missingIds' };
  if (result.conflicts.length > 0) return { status: 'conflicts', conflicts: result.conflicts };
  if (!result.changed) return { status: 'nothing' };
  // Then write just those edits over the file as it is: a second merge whose
  // "mine" is the edits and whose "theirs" is the file without the upgrades.
  // An edited item an upgrade repaired lands in its upgraded form (mineWins:
  // the repairs are per item). An edit to an item an upgrade ADDED cannot
  // land without that upgrade, so then the whole upgraded map is written.
  const minimal = mergeMapChanges(theirs, result.merged, now.map, { mineWins: true });
  const withUpgrades = !minimal.ok || minimal.conflicts.length > 0;
  // A copy: the merge hands back some of `mine`'s own objects.
  const toWrite = structuredClone(withUpgrades ? result.merged : minimal.merged);
  if (!(await publish(toWrite, link.slug))) return { status: 'publishFailed' };
  const after = await fetchRepoMap(link.slug, fetchFn);
  return {
    status: 'pushed',
    merged: after?.map ?? toWrite,
    applied: result.applied,
    withUpgrades,
    newBase: after?.base ?? null,
  };
}
