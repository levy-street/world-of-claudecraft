// Battlegrounds: the Gravemarch, the 5v5 objective battleground. Spoiler-safe
// concepts and names only (the story, the two companies, the roads and
// Bulwarks, the Knell, spectating, the ladder): no timings, health numbers,
// respawn math, or rating internals (docs/prd/battlegrounds.md).

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, loreBeat, pageHeader, related, section } from './ui';

// The three field objectives, as title + body beat cards.
const OBJECTIVES = [
  ['guide.bgPage.roadsTitle', 'guide.bgPage.roadsBody'],
  ['guide.bgPage.bulwarksTitle', 'guide.bgPage.bulwarksBody'],
  ['guide.bgPage.knellTitle', 'guide.bgPage.knellBody'],
] as const;

export const battlegrounds: GuidePage = {
  titleKey: 'guide.nav.battlegrounds',
  render() {
    const objectives = OBJECTIVES.map(([title, body]) => loreBeat(title, body)).join('');
    return `
      <article class="guide-article guide-battlegrounds">
        ${pageHeader('guide.bgPage.heading', 'guide.bgPage.intro')}
        ${section('guide.bgPage.storyHeading', `<p>${esc(t('guide.bgPage.storyBody'))}</p>`)}
        ${section('guide.bgPage.companiesHeading', `<p>${esc(t('guide.bgPage.companiesBody'))}</p>${callout(esc(t('guide.bgPage.fairNote')), { variant: 'note' })}`)}
        ${section('guide.bgPage.fieldHeading', `<p>${esc(t('guide.bgPage.fieldBody'))}</p><div class="guide-beat-grid">${objectives}</div>`)}
        ${section('guide.bgPage.deathHeading', `<p>${esc(t('guide.bgPage.deathBody'))}</p>`)}
        ${section('guide.bgPage.watchHeading', `<p>${esc(t('guide.bgPage.watchBody'))}</p>`)}
        ${section('guide.bgPage.ladderHeading', `<p>${esc(t('guide.bgPage.ladderBody'))}</p>`)}
        ${related([
          { href: hrefFor('arena'), key: 'guide.nav.arena' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('world'), key: 'guide.nav.world' },
        ])}
      </article>`;
  },
};
