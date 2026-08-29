// Professions FAQ (/wiki/professions/faq): the recurring crafter questions,
// answered with the exact numbers the other professions pages publish (the
// transparency policy). Mirrors the sitewide FAQ page's
// details/summary structure; questions and answers are guide.profPages.faq.*
// t() keys, English-only at PR tier.

import { esc } from '../../ui/esc';
import { type TranslationKey, t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import { paras, related } from './ui';

export const PROF_FAQ_COUNT = 11;

/**
 * The answer key per row, NAMED rather than built from the index.
 *
 * WHY THIS IS A LIST AND NOT A TEMPLATE LITERAL (Phase 11i QA). A key built as
 * `faq.a${n}` cannot be RETIRED AND RE-KEYED, and retiring a key is the only
 * mechanism this repo has that forces a `pending` row in every locale when an
 * English value stops being true. Rewording in place leaves every already
 * translated overlay `translated` and wrong, with no gate that can see it, and
 * a7 spent this phase telling fifteen locales a fishing gain curve the sim
 * retired. Naming the keys costs one line each and makes every row of this page
 * fixable the same way the fishing prose was.
 *
 * The question keys stay indexed: none of them states a mechanic, so none can
 * go stale the way an answer can.
 */
export const FAQ_ANSWER_KEYS: readonly TranslationKey[] = [
  'guide.profPages.faq.a1',
  'guide.profPages.faq.a2',
  'guide.profPages.faq.a3',
  'guide.profPages.faq.a4',
  'guide.profPages.faq.a5',
  'guide.profPages.faq.a6ThreeRods',
  'guide.profPages.faq.a7RetunedTaper',
  'guide.profPages.faq.a8',
  'guide.profPages.faq.a9',
  'guide.profPages.faq.a10',
  'guide.profPages.faq.a11Promotion',
];

export function faqDetailHtml(): string {
  const items: string[] = [];
  for (let n = 1; n <= PROF_FAQ_COUNT; n += 1) {
    const q = t(`guide.profPages.faq.q${n}` as TranslationKey);
    const a = paras(FAQ_ANSWER_KEYS[n - 1]);
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
