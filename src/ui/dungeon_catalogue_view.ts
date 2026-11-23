// Catalogue-only decisions. A browse entry never becomes a queue activity.
import { DELVE_LIST, zoneAt } from '../sim/data';
import { MAX_LEVEL } from '../sim/types';
import type {
  FinderActivityDetailView,
  FinderActivityRowView,
  FinderEncounterViewModel,
} from './dungeon_finder_view';

export type AdventureCategory = 'dungeons' | 'raids' | 'delves';
export const ADVENTURE_CATEGORIES: readonly AdventureCategory[] = ['dungeons', 'raids', 'delves'];

export function adventureCategory(kind: FinderActivityRowView['kind']): AdventureCategory {
  return kind === 'raid' ? 'raids' : kind === 'delve' ? 'delves' : 'dungeons';
}

export function delveCatalogueRows(
  level: number,
  selected: string | null,
): FinderActivityRowView[] {
  return DELVE_LIST.map((d) => ({
    id: `delve:${d.id}`,
    dungeonId: d.id,
    difficulty: 'normal',
    kind: 'delve',
    minLevel: d.minLevel,
    maxLevel: MAX_LEVEL,
    size: d.maxPlayers,
    eligible: level >= d.minLevel,
    blocked: level < d.minLevel ? 'level' : null,
    lockedMinutes: 0,
    selected: selected === `delve:${d.id}`,
    portraitUrl: '',
  }));
}

export function delveCatalogueDetail(
  id: string,
  level: number,
  encounters: FinderEncounterViewModel[],
): FinderActivityDetailView | null {
  const d = DELVE_LIST.find((d) => `delve:${d.id}` === id);
  const row = delveCatalogueRows(level, id).find((r) => r.id === id);
  if (!d || !row) return null;
  return {
    ...row,
    composition: null,
    autoQueue: false,
    lockout: 'none',
    attunementQuestId: null,
    heroicMarks: 0,
    entrance: { ...d.doorPos, zoneId: zoneAt(d.doorPos.x, d.doorPos.z).id },
    encounters: encounters.map((e) => ({ ...e, portraitUrl: '' })),
  };
}

/** Search text is localized by the painter; raw ids never leak into labels. */
export function filterAdventureRows(
  rows: readonly FinderActivityRowView[],
  category: AdventureCategory,
  query: string,
  eligibleOnly: boolean,
  labels: ReadonlyMap<string, string>,
): FinderActivityRowView[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(
    (row) =>
      adventureCategory(row.kind) === category &&
      (!eligibleOnly || row.eligible) &&
      words.every((word) => (labels.get(row.id) ?? '').toLocaleLowerCase().includes(word)),
  );
}
