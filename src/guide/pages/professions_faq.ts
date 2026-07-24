// Professions FAQ (/wiki/professions/faq): the recurring crafter questions,
// answered with the exact numbers the other professions pages publish (the
// transparency policy). Mirrors the sitewide FAQ page's
// details/summary structure; questions and answers are guide.profPages.faq.*
// t() keys, English-only at PR tier.

import { esc } from '../../ui/esc';
import { type TranslationKey, t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import { paras, related } from './ui';

export const PROF_FAQ_COUNT = 8;

export function faqDetailHtml(): string {
  const items: string[] = [];
  for (let n = 1; n <= PROF_FAQ_COUNT; n += 1) {
    const q = t(`guide.profPages.faq.q${n}` as TranslationKey);
    const a = paras(`guide.profPages.faq.a${n}` as TranslationKey);
    items.push(`<details class="guide-faq-item"><summary>${esc(q)}</summary>${a}</details>`);
  }
  return `
    <article class="guide-article guide-prof-page">
      <p class="guide-section-more"><a href="${esc(hrefFor('professions'))}">${esc(t('guide.profPages.back'))}</a></p>
      <h1>${esc(t('guide.profPages.faq.title'))}</h1>
      <p class="guide-lead">${esc(t('guide.profPages.faq.intro'))}</p>
      <div class="guide-faq">${items.join('')}</div>
      ${related([
        { href: hrefFor('professions'), key: 'guide.nav.professions' },
        { href: hrefFor('professions/economy'), key: 'guide.profPages.econ.title' },
        { href: hrefFor('faq'), key: 'guide.nav.faq' },
      ])}
    </article>`;
}
