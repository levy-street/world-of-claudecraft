import { audio } from '../../../game/audio';
import { esc } from '../../esc';
import { FOCUS_KEY_ATTR } from '../../focus_restore';
import { t } from '../../i18n';

/** Harvest entry controls open another window and never gather or spend. */
export interface HarvestEntryCallbacks {
  harvestBody?(): void;
  openHarvestJournal?(): void;
}

export function harvestBodyEntryHtml(enabled: boolean): string {
  if (!enabled) return '';
  return (
    '<section class="prof-harvest-body">' +
    `<button type="button" class="btn prof-effect-btn" data-harvest-body ${FOCUS_KEY_ATTR}="harvestBody">${esc(t('hudChrome.professions.harvestBodyButton'))}</button>` +
    `<p class="prof-harvest-body-hint">${esc(t('hudChrome.professions.harvestBodyHint'))}</p></section>`
  );
}

export function harvestJournalEntryHtml(professionId: string, enabled: boolean): string {
  if (professionId !== 'farming' || !enabled) return '';
  return `<div class="prof-effect-actions"><button type="button" class="btn prof-effect-btn" data-harvest-journal ${FOCUS_KEY_ATTR}="harvestJournal">${esc(t('hudChrome.harvestJournal.title'))}</button></div>`;
}

export function wireHarvestEntries(root: HTMLElement, callbacks: HarvestEntryCallbacks): void {
  root.querySelector('[data-harvest-body]')?.addEventListener('click', () => {
    audio.click();
    callbacks.harvestBody?.();
  });
  root.querySelector('[data-harvest-journal]')?.addEventListener('click', () => {
    audio.click();
    callbacks.openHarvestJournal?.();
  });
}
