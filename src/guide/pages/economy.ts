// Economy & Trade overview: coin, vendors, the World Market, and player trading.
// Systems and direction only, no prices or stock lists (classic-guide altitude).

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, p, related, section } from './ui';

// Heading + one body paragraph each, in reading order.
const BLOCKS = [
  ['guide.economy.coinTitle', 'guide.economy.coinBody'],
  ['guide.economy.marksTitle', 'guide.economy.marksBody'],
  ['guide.economy.vendorsTitle', 'guide.economy.vendorsBody'],
  ['guide.economy.buyingTitle', 'guide.economy.buyingBody'],
  ['guide.economy.junkTitle', 'guide.economy.junkBody'],
  ['guide.economy.tradeTitle', 'guide.economy.tradeBody'],
] as const;

export const economy: GuidePage = {
  titleKey: 'guide.nav.economy',
  render() {
    const blocks = BLOCKS.map(([title, body]) => section(title, p(body))).join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.economy'))}</h1>
        ${lead('guide.economy.intro')}
        ${blocks}

        <section class="guide-block">
          <h2>${esc(t('guide.economy.marketTitle'))}</h2>
          <p>${esc(t('guide.economy.marketBody'))}</p>
          <p>${esc(t('guide.economy.marketBrowse'))}</p>
          <p>${esc(t('guide.economy.marketPost'))}</p>
          <p>${esc(t('guide.economy.marketCollect'))}</p>
          <p>${esc(t('guide.economy.marketPricing'))}</p>
        </section>

        ${related([
          { href: hrefFor('gear'), key: 'guide.nav.gear' },
          { href: hrefFor('delves'), key: 'guide.nav.delves' },
          { href: hrefFor('social'), key: 'guide.nav.social' },
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
        ])}
      </article>`;
  },
};
