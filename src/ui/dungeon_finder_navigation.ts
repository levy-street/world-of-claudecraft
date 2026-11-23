import type { FinderTab } from './dungeon_finder_view';
import { esc } from './esc';
import { t } from './i18n';
import { svgIcon } from './ui_icons';

export function finderTitle(tab: FinderTab, creating = false): string {
  if (tab === 'vault') return t('hudChrome.weeklyRewards.title');
  if (tab === 'board' && creating) return t('hudChrome.finder.createGroup');
  return t(
    tab === 'board'
      ? 'hudChrome.finder.groups'
      : tab === 'catalogue'
        ? 'hudChrome.finder.dungeonGuide'
        : 'hudChrome.finder.tabQueue',
  );
}

/** Secondary destinations, not three competing primary workflows. */
export function finderNavigationHtml(
  tab: FinderTab,
  queued: boolean,
  canStartCreate = false,
  showVault = true,
): string {
  const create = canStartCreate
    ? `<div class="df-group-toolbar"><button type="button" class="df-start-create ui-btn ui-btn--gold" data-start-create>${svgIcon('social')}${esc(t('hudChrome.finder.createGroup'))}</button></div>`
    : '';
  const back =
    tab !== 'board'
      ? `<button type="button" class="ui-btn df-back-groups" data-tab="board">${svgIcon('social')}${esc(t('hudChrome.finder.backToGroups'))}</button>`
      : '';
  const queue =
    queued && tab !== 'queue'
      ? `<button type="button" class="ui-btn df-open-queue" data-tab="queue">${svgIcon('social')}${esc(t('hudChrome.finder.activeQueue'))}</button>`
      : '';
  const vault =
    showVault && tab !== 'vault'
      ? `<button type="button" class="ui-btn df-open-vault" data-tab="vault">${svgIcon('chest')}${esc(t('hudChrome.weeklyRewards.title'))}</button>`
      : '';
  if (!create && !back && !queue && !vault) return '';
  return `<div class="df-navigation">${create}<div class="df-navigation-actions">${back}${queue}${vault}</div></div>`;
}
