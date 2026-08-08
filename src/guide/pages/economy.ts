// Economy & Trade overview: coin, vendors, the World Market, and player trading.
// Systems and direction only, no prices or stock lists (classic-guide altitude).

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, p, related, section } from './ui';

// Heading + one body paragraph each, in reading order. The marks-and-Honor block
// sits between the coin block and the vendors block and carries two paragraphs, so
// it renders on its own below rather than from this table.
const BLOCKS_AFTER_MARKS = [
  ['guide.economy.vendorsTitle', 'guide.economy.vendorsBody'],
  ['guide.economy.buyingTitle', 'guide.economy.buyingBody'],
  ['guide.economy.junkTitle', 'guide.economy.junkBody'],
  ['guide.economy.tradeTitle', 'guide.economy.tradeBody'],
] as const;

export const economy: GuidePage = {
  titleKey: 'guide.nav.economy',
  render() {
    const blocks = BLOCKS_AFTER_MARKS.map(([title, body]) => section(title, p(body))).join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.economy'))}</h1>
        ${lead('guide.economy.intro')}
        ${section('guide.economy.coinTitle', p('guide.economy.coinBody'))}

        ${section(
          'guide.economy.marksTitle',
          p('guide.economy.marksBody') + p('guide.economy.honorBody'),
        )}

        ${blocks}

        <section class="guide-block">
          <h2>${esc(t('guide.economy.marketTitle'))}</h2>
          <p>${esc(t('guide.economy.marketBody'))}</p>
          <p>${esc(t('guide.economy.marketBrowse'))}</p>
          <p>${esc(t('guide.economy.marketPost'))}</p>
          <p>${esc(t('guide.economy.marketCollect'))}</p>
          <p>${esc(t('guide.economy.marketPricing'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.economy.bankTitle'))}</h2>
          <p>${esc(t('guide.economy.bankBody'))}</p>
          <p>${esc(t('guide.economy.bankHow'))}</p>
          <p>${esc(t('guide.economy.bankSlots'))}</p>
          <p>${esc(t('guide.economy.guildBankNote'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.economy.mailTitle'))}</h2>
          <p>${esc(t('guide.economy.mailBody'))}</p>
          <p>${esc(t('guide.economy.mailHow'))}</p>
        </section>

        ${section('guide.economy.dailyTitle', p('guide.economy.dailyBody'))}

        ${related([
          { href: hrefFor('gear'), key: 'guide.nav.gear' },
          { href: hrefFor('delves'), key: 'guide.nav.delves' },
          { href: hrefFor('arena'), key: 'guide.nav.arena' },
          { href: hrefFor('social'), key: 'guide.nav.social' },
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
        ])}
      </article>`;
  },
};
