import {
  DEFAULT_TITLE_ID,
  normalizeTitleId,
  PLAYER_TITLES,
  playerTitleById,
  playerTitleIdsForLevel,
} from './content/titles';
import type { PlayerMeta } from './sim';
import type { Entity } from './types';

export function refreshPlayerTitles(
  meta: PlayerMeta,
  e: Entity,
  opts: { autoSelectDefault?: boolean } = {},
): void {
  for (const id of playerTitleIdsForLevel(e.level)) meta.earnedTitles.add(id);
  if (meta.activeTitle && !meta.earnedTitles.has(meta.activeTitle)) meta.activeTitle = null;
  if (opts.autoSelectDefault && !meta.activeTitle && meta.earnedTitles.has(DEFAULT_TITLE_ID)) {
    meta.activeTitle = DEFAULT_TITLE_ID;
  }
  e.title = meta.activeTitle ? (playerTitleById(meta.activeTitle)?.name ?? '') : '';
}

export function titleReadout(meta: PlayerMeta): string {
  const earned = PLAYER_TITLES.filter((title) => meta.earnedTitles.has(title.id));
  const active = meta.activeTitle ? playerTitleById(meta.activeTitle)?.name : null;
  const list = earned.map((title) => {
    const marker = title.id === meta.activeTitle ? '*' : '-';
    return `${marker} ${title.id}: ${title.name}`;
  });
  return [
    active ? `Active title: ${active}.` : 'No active title.',
    'Earned titles:',
    ...(list.length ? list : ['- none']),
    'Use /title <id> to select one, or /title clear.',
  ].join('\n');
}

export function selectPlayerTitle(
  meta: PlayerMeta,
  e: Entity,
  rawId: string,
): 'selected' | 'cleared' | 'unknown' | 'locked' {
  const id = normalizeTitleId(rawId);
  if (id === 'clear' || id === 'none' || id === 'off') {
    meta.activeTitle = null;
    e.title = '';
    return 'cleared';
  }
  const title = playerTitleById(id);
  if (!title) return 'unknown';
  refreshPlayerTitles(meta, e);
  if (!meta.earnedTitles.has(title.id)) return 'locked';
  meta.activeTitle = title.id;
  e.title = title.name;
  return 'selected';
}

export function titleName(id: string): string {
  return playerTitleById(normalizeTitleId(id))?.name ?? id;
}
