// Leveling and Progression. How experience is earned, the journey across the world's
// zones, rested XP, and what waits at the cap. Spoiler-safe and number-free by design:
// systems and direction only, no XP amounts, percentages, or timings.

import { esc } from '../../ui/esc';
import { formatNumber, t } from '../../ui/i18n';
import { LEVEL_CAP, RIDING_MIN_LEVEL, ZONE_COUNT, ZONE_TEASERS } from '../data';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, related } from './ui';

// Every zone, in level-band order, named from the shared world teaser rows (which are
// themselves derived from the sim), so this list cannot fall behind the world.
const ZONES = ZONE_TEASERS;

export const progression: GuidePage = {
  titleKey: 'guide.nav.progression',
  render() {
    const zones = ZONES.map(
      (z) => `<li class="guide-basic">
        <h3>${esc(t(z.nameKey))}</h3>
        <p class="guide-zone-band">${esc(t('guide.progression.bandLabel', { min: formatNumber(z.min), max: formatNumber(z.max) }))}</p>
        <p>${esc(t(z.blurbKey))}</p>
      </li>`,
    ).join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.progression'))}</h1>
        ${lead('guide.progression.intro')}

        <section class="guide-block">
          <h2>${esc(t('guide.progression.xpTitle'))}</h2>
          <p>${esc(t('guide.progression.xpBody'))}</p>
          <p>${esc(t('guide.progression.capBody', { cap: formatNumber(LEVEL_CAP) }))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.progression.journeyTitle'))}</h2>
          <p>${esc(t('guide.progression.journeyBodyCount', { zones: formatNumber(ZONE_COUNT) }))}</p>
          <ol class="guide-basics">${zones}</ol>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.progression.restedTitle'))}</h2>
          <p>${esc(t('guide.progression.restedBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.progression.capTitle', { cap: formatNumber(LEVEL_CAP) }))}</h2>
          <p>${esc(t('guide.progression.capJourneyBody', { cap: formatNumber(LEVEL_CAP) }))}</p>
          <p>${esc(t('guide.progression.capEndgameBody'))}</p>
          <p>${esc(t('guide.progression.prestigeBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.progression.ridingTitle'))}</h2>
          <p>${esc(t('guide.progression.ridingBody', { level: formatNumber(RIDING_MIN_LEVEL) }))}</p>
        </section>

        <p class="guide-callout">${esc(t('guide.progression.noRush'))}</p>
        ${related([
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('reference/combat'), key: 'guide.nav.combat' },
          { href: hrefFor('world'), key: 'guide.nav.world' },
          { href: hrefFor('mounts'), key: 'guide.nav.mounts' },
          { href: hrefFor('delves'), key: 'guide.nav.delves' },
          { href: hrefFor('rifts'), key: 'guide.nav.rifts' },
          { href: hrefFor('deeds'), key: 'guide.nav.deeds' },
        ])}
      </article>`;
  },
};
