// Markup for the Adventure Journal's personal progress layer (strings only,
// never DOM): the "Your kills" strip under the banner's chips (a count per
// difficulty, Mythic as coming soon, the difficulty being read marked), the
// instance's lockout line when the character is saved on that difficulty
// ("Saved on Heroic: 1 of 2 bosses", resets in, and when), and the page's own
// "Defeated this week" chip for the banner's kicker. Every label is a t() key,
// every number goes through formatNumber, the reset through formatDateTime and
// the shared lockout countdown (raid_lockout_format.ts). The decisions are the
// pure core's (journal_progress_view.ts).

import { esc } from '../../esc';
import { formatDateTime, formatNumber, t } from '../../i18n';
import { formatLockoutDuration } from '../../raid_lockout_format';
import { svgIcon } from '../../ui_icons';
import { tierName } from './journal_page_html';
import type { JournalLockBoundary, JournalPageProgress } from './journal_progress_view';

const RESET_WHEN: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
};

/** The banner kicker's chip for a page saved on the difficulty being read. */
export function savedChipHtml(boundary: JournalLockBoundary | null): string {
  if (!boundary) return '';
  const text = t(
    boundary === 'weekly'
      ? 'hudChrome.adventureJournal.defeatedThisWeek'
      : 'hudChrome.adventureJournal.defeatedToday',
  );
  return `<span class="aj-chip-status aj-chip-defeated aj-chip-saved">${svgIcon('lock')}${esc(text)}</span>`;
}

/** The progress strip: the kill counts, then the lockout line when saved. */
export function progressHtml(progress: JournalPageProgress): string {
  const cells = progress.kills
    .map((cell) => {
      const name = tierName(cell.tier);
      // Mythic reads Coming soon, and is marked when it is the tier being read.
      if (cell.count === null) {
        return `<li class="aj-kill aj-kill-soon${cell.selected ? ' selected' : ''}"><span class="aj-kill-tier">${esc(name)}</span><span class="aj-kill-note">${esc(
          t('hudChrome.adventureJournal.comingSoon'),
        )}</span></li>`;
      }
      const count = formatNumber(cell.count);
      const label = t('hudChrome.adventureJournal.killsCell', { difficulty: name, count });
      // The visible pair is for the eye; a screen reader reads the one phrase.
      return `<li class="aj-kill${cell.selected ? ' selected' : ''}${
        cell.count === 0 ? ' none' : ''
      }"><span class="aj-kill-tier" aria-hidden="true">${esc(
        name,
      )}</span><b class="aj-kill-count" aria-hidden="true">${esc(count)}</b><span class="visually-hidden">${esc(
        label,
      )}</span></li>`;
    })
    .join('');
  const lock = progress.lockout;
  const selected = progress.kills.find((cell) => cell.selected)?.tier;
  const lockLine =
    lock && selected
      ? `<p class="aj-lockout">${svgIcon('lock')}<span class="aj-lockout-saved">${esc(
          lock.total > 1
            ? t('hudChrome.adventureJournal.savedBosses', {
                difficulty: tierName(selected),
                saved: formatNumber(lock.saved),
                total: formatNumber(lock.total),
              })
            : t('hudChrome.adventureJournal.savedInstance', { difficulty: tierName(selected) }),
        )}</span><span class="aj-lockout-reset">${esc(
          t('hudChrome.adventureJournal.resetsIn', {
            time: formatLockoutDuration(lock.msRemaining),
            when: formatDateTime(lock.resetAtMs, RESET_WHEN),
          }),
        )}</span></p>`
      : '';
  return `<div class="aj-progress" role="group" aria-label="${esc(
    t('hudChrome.adventureJournal.progressLabel'),
  )}"><span class="aj-progress-label">${svgIcon('skull')}<span>${esc(
    t('hudChrome.adventureJournal.killsLabel'),
  )}</span></span><ul class="aj-kills">${cells}</ul>${lockLine}</div>`;
}
