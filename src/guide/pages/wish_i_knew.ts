// "Things I Wish I Knew": a scannable set of beginner truths in a calm, mentoring voice.
// Conceptual reassurance and expectation-setting, never exploits or step-by-step routes.

import { t, type TranslationKey } from '../../ui/i18n';
import { esc } from '../../ui/esc';
import { hrefFor } from '../routes';
import { pageHeader, related } from './ui';
import type { GuidePage } from './types';

const ITEMS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export const wishIKnew: GuidePage = {
  titleKey: 'guide.nav.wishIKnew',
  render() {
    const items = ITEMS
      .map((n) => `
        <div class="guide-wish-item">
          <h2 class="guide-wish-title">${esc(t(`guide.wishPage.i${n}Title` as TranslationKey))}</h2>
          <p>${esc(t(`guide.wishPage.i${n}Body` as TranslationKey))}</p>
        </div>`)
      .join('');
    return `
      <article class="guide-article guide-wish">
        ${pageHeader('guide.wishPage.heading', 'guide.wishPage.intro')}
        <div class="guide-wish-list">${items}</div>
        ${related([
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('faq'), key: 'guide.nav.faq' },
        ])}
      </article>`;
  },
};
