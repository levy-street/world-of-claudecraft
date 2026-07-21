// FAQ page: the fuller set of newcomer questions (the home page carries a short teaser).

import { t, formatNumber, type TranslationKey } from '../../ui/i18n';
import { esc } from '../../ui/esc';
import { lead } from './ui';
import { LEVEL_CAP } from '../data';
import type { GuidePage } from './types';

const QA: { q: TranslationKey; a: TranslationKey; cap?: boolean }[] = [
  { q: 'guide.faqPage.q1', a: 'guide.faqPage.a1' },
  { q: 'guide.faqPage.q2', a: 'guide.faqPage.a2' },
  { q: 'guide.faqPage.q3', a: 'guide.faqPage.a3' },
  { q: 'guide.faqPage.q4', a: 'guide.faqPage.a4' },
  { q: 'guide.faqPage.q5', a: 'guide.faqPage.a5' },
  { q: 'guide.faqPage.q6', a: 'guide.faqPage.a6', cap: true },
  { q: 'guide.faqPage.q7', a: 'guide.faqPage.a7' },
  { q: 'guide.faqPage.q8', a: 'guide.faqPage.a8' },
  { q: 'guide.faqPage.q9', a: 'guide.faqPage.a9' },
  { q: 'guide.faqPage.q10', a: 'guide.faqPage.a10', cap: true },
  { q: 'guide.faqPage.q11', a: 'guide.faqPage.a11' },
];

export const faq: GuidePage = {
  titleKey: 'guide.nav.faq',
  render() {
    const items = QA
      .map(({ q, a, cap }) => {
        const answer = cap ? t(a, { cap: formatNumber(LEVEL_CAP) }) : t(a);
        return `<details class="guide-faq-item"><summary>${esc(t(q))}</summary><p>${esc(answer)}</p></details>`;
      })
      .join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.faq'))}</h1>
        ${lead('guide.faqPage.intro')}
        <div class="guide-faq">${items}</div>
      </article>`;
  },
};
