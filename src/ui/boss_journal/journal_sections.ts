// Markup for the dungeon journal's extra sections (role tips, key choices,
// the Heroic callout, rank chips, tier marks, the two-tier damage line). Pure
// strings from the view model: every label is a t() key, every number goes
// through formatNumber, every interpolation through esc(). The window
// (raid_boss_guide_window.ts) owns the DOM, the events and the focus.

import { esc } from '../esc';
import { formatNumber, type InterpolationValues, type TranslationKey, t } from '../i18n';
import { iconDataUrl } from '../icons';
import { svgIcon, type UiIconName } from '../ui_icons';
import type {
  JournalChoice,
  JournalDamageCompare,
  JournalMark,
  JournalNote,
  JournalRank,
  JournalTip,
  JournalTipRole,
  JournalValues,
} from './journal_view';

/** Locale-formatted placeholder values (percent style for the listed names). */
export function formattedJournalValues(
  values: JournalValues | undefined,
  percentValues: readonly string[] = [],
): InterpolationValues | undefined {
  if (!values) return undefined;
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      formatNumber(
        value,
        percentValues.includes(name)
          ? { style: 'percent', maximumFractionDigits: 0 }
          : { maximumFractionDigits: 1 },
      ),
    ]),
  );
}

const TIP_PRESENTATION: Readonly<Record<JournalTipRole, [TranslationKey, UiIconName]>> = {
  tank: ['hudChrome.raidBossGuide.roleTank', 'tank'],
  healer: ['hudChrome.raidBossGuide.roleHealer', 'healer'],
  damage: ['hudChrome.raidBossGuide.roleDamage', 'attack'],
};

const MARK_PRESENTATION: Readonly<Record<JournalMark, TranslationKey>> = {
  heroicOnly: 'hudChrome.raidBossGuide.markHeroicOnly',
  heroicChanged: 'hudChrome.raidBossGuide.markHeroicChanged',
};

export function rankLabel(rank: JournalRank | undefined): string | null {
  if (rank === 'miniboss') return t('hudChrome.raidBossGuide.rankMiniboss');
  if (rank === 'final') return t('hudChrome.raidBossGuide.rankFinal');
  return null;
}

export function rankChipHtml(rank: JournalRank | undefined): string {
  const label = rankLabel(rank);
  return label ? `<span class="rbg-rank rbg-rank-${esc(rank ?? '')}">${esc(label)}</span>` : '';
}

export function markChipsHtml(marks: readonly JournalMark[] | undefined): string {
  if (!marks || marks.length === 0) return '';
  return `<span class="rbg-marks">${marks
    .map(
      (mark) =>
        `<span class="rbg-mark rbg-mark-${esc(mark)}">${esc(t(MARK_PRESENTATION[mark]))}</span>`,
    )
    .join('')}</span>`;
}

export function markLabels(marks: readonly JournalMark[] | undefined): string[] {
  return (marks ?? []).map((mark) => t(MARK_PRESENTATION[mark]));
}

export function damageCompareText(compare: JournalDamageCompare): string {
  const range = (r: { min: number; max: number }) =>
    t('hudChrome.raidBossGuide.damageRange', {
      min: formatNumber(r.min),
      max: formatNumber(r.max),
    });
  return t('hudChrome.raidBossGuide.damageCompare', {
    normal: range(compare.normal),
    heroic: range(compare.heroic),
  });
}

export function heroicNotesHtml(notes: readonly JournalNote[] | undefined): string {
  if (!notes || notes.length === 0) return '';
  return `<aside class="rbg-heroic" aria-labelledby="rbg-heroic-title"><div class="rbg-heroic-head">${svgIcon(
    'skull',
  )}<span id="rbg-heroic-title">${esc(t('hudChrome.raidBossGuide.heroicHeading'))}</span></div><ul>${notes
    .map(
      (note) =>
        `<li>${esc(t(note.key, formattedJournalValues(note.values, note.percentValues)))}</li>`,
    )
    .join('')}</ul></aside>`;
}

export function tipsHtml(tips: readonly JournalTip[] | undefined): string {
  if (!tips || tips.length === 0) return '';
  return `<section class="rbg-tips" aria-labelledby="rbg-tips-title"><div class="rbg-section-title" id="rbg-tips-title">${esc(
    t('hudChrome.raidBossGuide.tipsHeading'),
  )}</div><div class="rbg-tip-grid">${tips
    .map((tip) => {
      const [labelKey, icon] = TIP_PRESENTATION[tip.role];
      return `<article class="rbg-tip rbg-tip-${esc(tip.role)}"><header><span class="rbg-badge rbg-badge-role rbg-badge-${esc(
        tip.role,
      )}" aria-hidden="true">${svgIcon(icon)}</span><h3>${esc(t(labelKey))}</h3></header><p>${esc(
        t(tip.key, formattedJournalValues(tip.values, tip.percentValues)),
      )}</p></article>`;
    })
    .join('')}</div></section>`;
}

export function choicesHtml(choices: readonly JournalChoice[] | undefined): string {
  if (!choices || choices.length === 0) return '';
  return `<section class="rbg-choices" aria-labelledby="rbg-choices-title"><div class="rbg-section-title" id="rbg-choices-title">${esc(
    t('hudChrome.raidBossGuide.choicesHeading'),
  )}</div>${choices
    .map((choice) => {
      const values = formattedJournalValues(choice.values, choice.percentValues);
      return `<article class="rbg-choice" data-choice="${esc(choice.id)}"><header><img src="${esc(
        iconDataUrl('ability', choice.iconId, 48),
      )}" alt="" aria-hidden="true"><h3>${esc(t(choice.nameKey, values))}</h3></header><div class="rbg-choice-sides"><div class="rbg-choice-gain"><span class="rbg-choice-label">${svgIcon(
        'check',
      )}${esc(t('hudChrome.raidBossGuide.choiceGain'))}</span><p>${esc(
        t(choice.gainKey, values),
      )}</p></div><div class="rbg-choice-risk"><span class="rbg-choice-label">${svgIcon(
        'alert',
      )}${esc(t('hudChrome.raidBossGuide.choiceRisk'))}</span><p>${esc(
        t(choice.riskKey, values),
      )}</p></div></div></article>`;
    })
    .join('')}</section>`;
}
