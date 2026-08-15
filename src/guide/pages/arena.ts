// Arena and PvP: the hub page for player versus player. Duels, the Ashen Coliseum's
// ranked brackets, what a match pays, and the Honor currency with the Warfare gear it
// buys. Concepts only, no ratings math, honor amounts, prices, item budgets, or
// matchmaking internals. (The Fiesta and Protect Yumi modes are retired from the menu,
// so the page no longer documents them; PVP_TABS is exactly Thornhollow Fields, 1v1
// and 2v2, which is why the copy names one button with three tabs.)

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, p, pageHeader, related, section } from './ui';

export const arena: GuidePage = {
  titleKey: 'guide.nav.arena',
  render() {
    return `
      <article class="guide-article guide-arena">
        ${pageHeader('guide.arenaPage.heading', 'guide.arenaPage.intro')}
        ${section('guide.arenaPage.duelsHeading', `<p>${esc(t('guide.arenaPage.duelsBody'))}</p>`)}
        ${section('guide.arenaPage.coliseumHeading', `<p>${esc(t('guide.arenaPage.coliseumBody'))}</p>`)}
        ${section('guide.arenaPage.rewardsHeading', p('guide.arenaPage.rewardsBody'))}
        ${section('guide.arenaPage.ladderHeading', `<p>${esc(t('guide.arenaPage.ladderBody'))}</p>`)}
        ${section(
          'guide.arenaPage.honorHeading',
          p('guide.arenaPage.honorBody') +
            p('guide.arenaPage.quartermastersBody') +
            callout(esc(t('guide.arenaPage.honorFinalNote')), { variant: 'warn' }),
        )}
        ${section(
          'guide.arenaPage.warfareHeading',
          p('guide.arenaPage.warfareBody') + p('guide.arenaPage.warfareTradeBody'),
        )}
        ${related([
          { href: hrefFor('thornhollow-fields'), key: 'guide.nav.thornhollow' },
          { href: hrefFor('vale-cup'), key: 'guide.nav.valeCup' },
          { href: hrefFor('gear'), key: 'guide.nav.gear' },
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('reference/combat'), key: 'guide.nav.combat' },
        ])}
      </article>`;
  },
};
