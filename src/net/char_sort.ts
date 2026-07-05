import type { CharacterSummary } from './online';

export type CharSortMode = 'level' | 'name' | 'recent' | 'playtime';

export const CHAR_SORT_MODES: readonly CharSortMode[] = ['level', 'name', 'recent', 'playtime'];

export const DEFAULT_CHAR_SORT: CharSortMode = 'level';

export function normalizeCharSortMode(value: string | null | undefined): CharSortMode {
  return (CHAR_SORT_MODES as readonly string[]).includes(value ?? '')
    ? (value as CharSortMode)
    : DEFAULT_CHAR_SORT;
}

function lastPlayedMs(c: CharacterSummary): number {
  if (!c.lastPlayed) return 0;
  const ms = Date.parse(c.lastPlayed);
  return Number.isFinite(ms) ? ms : 0;
}

export function sortCharacters(
  chars: readonly CharacterSummary[],
  mode: CharSortMode,
): CharacterSummary[] {
  const byName = (a: CharacterSummary, b: CharacterSummary) => a.name.localeCompare(b.name);
  return chars.slice().sort((a, b) => {
    let primary = 0;
    switch (mode) {
      case 'level':
        primary = b.level - a.level;
        break;
      case 'name':
        primary = byName(a, b);
        break;
      case 'recent':
        primary = lastPlayedMs(b) - lastPlayedMs(a);
        break;
      case 'playtime':
        primary = (b.playtimeSeconds ?? 0) - (a.playtimeSeconds ?? 0);
        break;
    }
    if (primary !== 0) return primary;
    const n = byName(a, b);
    return n !== 0 ? n : a.id - b.id;
  });
}
