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
        ${section(
          'guide.arenaPage.rewardsHeading',
          // Retired and re-keyed at Phase 20 (the wiki completeness audit,
          // 2026-09-03): rewardsBody said a loss pays nothing and that Honor's day
          // rolls on its own clock. A played-out loss and a draw pay
          // RANKED_ARENA_LOSS_HONOR, and the day is ctx.resetDay, the realm's
          // nightly reset (src/sim/pvp/honor.ts).
          p('guide.arenaPage.rewardsBodyLossShare'),
        )}
        ${section('guide.arenaPage.ladderHeading', `<p>${esc(t('guide.arenaPage.ladderBody'))}</p>`)}
        ${section(
          'guide.arenaPage.honorHeading',
          p('guide.arenaPage.honorBody') +
            p('guide.arenaPage.quartermastersBody') +
            // Retired and re-keyed at Phase 20 (the wiki completeness audit,
            // 2026-09-03): honorFinalNote said a coin purchase can be undone from
            // the buyback list, which only ever holds what you SOLD
            // (src/sim/items.ts recordVendorBuyback).
            callout(esc(t('guide.arenaPage.honorFinalNoteSoldBack')), { variant: 'warn' }),
        )}
        ${section(
          'guide.arenaPage.warfareHeading',
          // Retired and re-keyed at Phase 20 (the wiki completeness audit,
          // 2026-09-03): both bodies said a Warfare piece brings nothing a monster
          // feels, but every row carries ordinary stats and its slot's armor or
          // weapon baseline (src/sim/content/pvp_honor.ts); only the two ratings
          // and the set bonuses are PvP-only.
          p('guide.arenaPage.warfareBodyStatsStay') +
            p('guide.arenaPage.warfareTradeBodyRatingSpent'),
        )}
        ${related([
          { href: hrefFor('thornhollow-fields'), key: 'guide.nav.thornhollow' },
          { href: hrefFor('gear'), key: 'guide.nav.gear' },
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('reference/combat'), key: 'guide.nav.combat' },
        ])}
      </article>`;
  },
};
