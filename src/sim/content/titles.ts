export interface PlayerTitleDef {
  id: string;
  name: string;
  minLevel: number;
}

export const PLAYER_TITLES: readonly PlayerTitleDef[] = [
  { id: 'adventurer', name: 'the Adventurer', minLevel: 1 },
  { id: 'veteran', name: 'the Veteran', minLevel: 10 },
  { id: 'champion', name: 'the Champion', minLevel: 20 },
] as const;

export const DEFAULT_TITLE_ID = PLAYER_TITLES[0].id;

export function playerTitleById(id: string): PlayerTitleDef | undefined {
  return PLAYER_TITLES.find((title) => title.id === id);
}

export function playerTitleIdsForLevel(level: number): string[] {
  return PLAYER_TITLES.filter((title) => level >= title.minLevel).map((title) => title.id);
}

export function normalizeTitleId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}
