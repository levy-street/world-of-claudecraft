// Hodric's Castle: a spoiler-safe overview of the Gauntlet obstacle race.
// Concepts only, no physics numbers or obstacle timings.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { pageHeader, related, section } from './ui';

export const hodricsCastle: GuidePage = {
  titleKey: 'guide.nav.hodricsCastle',
  render() {
    return `
      <article class="guide-article guide-hodrics-castle">
        ${pageHeader('guide.hodricsCastlePage.heading', 'guide.hodricsCastlePage.intro')}
        ${section('guide.hodricsCastlePage.heraldHeading', `<p>${esc(t('guide.hodricsCastlePage.heraldBody'))}</p>`)}
        ${section('guide.hodricsCastlePage.courseHeading', `<p>${esc(t('guide.hodricsCastlePage.courseBody'))}</p>`)}
        ${section('guide.hodricsCastlePage.fairnessHeading', `<p>${esc(t('guide.hodricsCastlePage.fairnessBody'))}</p>`)}
        ${section('guide.hodricsCastlePage.fallsHeading', `<p>${esc(t('guide.hodricsCastlePage.fallsBody'))}</p>`)}
        ${section('guide.hodricsCastlePage.standingsHeading', `<p>${esc(t('guide.hodricsCastlePage.standingsBody'))}</p>`)}
        ${related([
          { href: hrefFor('arena'), key: 'guide.nav.arena' },
          { href: hrefFor('world'), key: 'guide.nav.world' },
        ])}
      </article>`;
  },
};
