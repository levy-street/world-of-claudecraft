// FAQ page: the fuller set of newcomer questions (the home page carries a short teaser).
// Order is reading order, not key order: newer rows (q12 and up) are slotted next to the
// question they belong with, so the money answers sit together and the "where do I play"
// answers sit together.

import { esc } from '../../ui/esc';
import { formatNumber, type TranslationKey, t } from '../../ui/i18n';
import { LEVEL_CAP, ZONE_COUNT } from '../data';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, related } from './ui';

const QA: { q: TranslationKey; a: TranslationKey; cap?: boolean; zones?: boolean }[] = [
  { q: 'guide.faqPage.q1', a: 'guide.faqPage.a1' },
  { q: 'guide.faqPage.q2', a: 'guide.faqPage.a2' },
  { q: 'guide.faqPage.q12', a: 'guide.faqPage.a12' },
  { q: 'guide.faqPage.q3', a: 'guide.faqPage.a3' },
  { q: 'guide.faqPage.q13', a: 'guide.faqPage.a13' },
  { q: 'guide.faqPage.q14', a: 'guide.faqPage.a14' },
  { q: 'guide.faqPage.q4', a: 'guide.faqPage.a4' },
  { q: 'guide.faqPage.q15', a: 'guide.faqPage.a15' },
  { q: 'guide.faqPage.q16', a: 'guide.faqPage.a16' },
  { q: 'guide.faqPage.q17', a: 'guide.faqPage.a17' },
  { q: 'guide.faqPage.q18', a: 'guide.faqPage.a18' },
  { q: 'guide.faqPage.q5', a: 'guide.faqPage.a5' },
  { q: 'guide.faqPage.q6', a: 'guide.faqPage.a6Count', cap: true, zones: true },
  { q: 'guide.faqPage.q7', a: 'guide.faqPage.a7' },
  { q: 'guide.faqPage.q19', a: 'guide.faqPage.a19' },
  { q: 'guide.faqPage.q8', a: 'guide.faqPage.a8' },
  { q: 'guide.faqPage.q9', a: 'guide.faqPage.a9' },
  { q: 'guide.faqPage.q10', a: 'guide.faqPage.a10', cap: true },
  { q: 'guide.faqPage.q11', a: 'guide.faqPage.a11' },
  { q: 'guide.faqPage.q20', a: 'guide.faqPage.a20' },
];

export const faq: GuidePage = {
  titleKey: 'guide.nav.faq',
  render() {
    const items = QA.map(({ q, a, cap, zones }) => {
      const answer = t(a, {
        ...(cap ? { cap: formatNumber(LEVEL_CAP) } : {}),
        ...(zones ? { zones: formatNumber(ZONE_COUNT) } : {}),
      });
      return `<details class="guide-faq-item"><summary>${esc(t(q))}</summary><p>${esc(answer)}</p></details>`;
    }).join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.faq'))}</h1>
        ${lead('guide.faqPage.intro')}
        <div class="guide-faq">${items}</div>
        ${related([
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('rifts'), key: 'guide.nav.rifts' },
          { href: hrefFor('reference/settings'), key: 'guide.nav.settings' },
        ])}
      </article>`;
  },
};
