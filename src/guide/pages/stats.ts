// Character & Stats: what the five primary attributes do, the secondary stats they
// feed, and where to read them on the character sheet. Directional only, no formulas
// or balance numbers, so there is nothing here to min-max (WoW-style altitude).

import { t } from '../../ui/i18n';
import { esc } from '../../ui/esc';
import { hrefFor } from '../routes';
import { lead, related } from './ui';
import type { GuidePage } from './types';

// The five primary attributes, in the order the character sheet lists them.
const PRIMARY = [
  ['guide.stats.strTitle', 'guide.stats.strBody'],
  ['guide.stats.agiTitle', 'guide.stats.agiBody'],
  ['guide.stats.staTitle', 'guide.stats.staBody'],
  ['guide.stats.intTitle', 'guide.stats.intBody'],
  ['guide.stats.spiTitle', 'guide.stats.spiBody'],
] as const;

// Secondary / derived stats the sheet shows alongside the primaries.
const SECONDARY = [
  ['guide.stats.armorTitle', 'guide.stats.armorBody'],
  ['guide.stats.apTitle', 'guide.stats.apBody'],
  ['guide.stats.critTitle', 'guide.stats.critBody'],
  ['guide.stats.dodgeTitle', 'guide.stats.dodgeBody'],
] as const;

export const stats: GuidePage = {
  titleKey: 'guide.nav.stats',
  render() {
    const primary = PRIMARY
      .map(([title, body]) => `<div class="guide-basic"><h3>${esc(t(title))}</h3><p>${esc(t(body))}</p></div>`)
      .join('');
    const secondary = SECONDARY
      .map(([title, body]) => `<section class="guide-block"><h2>${esc(t(title))}</h2><p>${esc(t(body))}</p></section>`)
      .join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.stats'))}</h1>
        ${lead('guide.stats.intro')}

        <section class="guide-block">
          <h2>${esc(t('guide.stats.primaryHeading'))}</h2>
          <p>${esc(t('guide.stats.primaryBody'))}</p>
          <div class="guide-basics">${primary}</div>
        </section>

        ${secondary}

        <section class="guide-block">
          <h2>${esc(t('guide.stats.sheetHeading'))}</h2>
          <p>${esc(t('guide.stats.sheetBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.stats.growHeading'))}</h2>
          <p>${esc(t('guide.stats.growBody'))}</p>
        </section>

        ${related([
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('gear'), key: 'guide.nav.gear' },
          { href: hrefFor('reference/combat'), key: 'guide.nav.combat' },
        ])}
      </article>`;
  },
};
