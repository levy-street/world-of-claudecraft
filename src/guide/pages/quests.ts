// Quests: how the quest loop works, the kinds of objective you meet, and a spoiler-safe
// telling of the main-story saga as a trail north (no endings, no boss names), plus the
// optional side-chains.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, loreBeat, related } from './ui';

const STEPS = [
  ['guide.questsPage.acceptTitle', 'guide.questsPage.acceptBody'],
  ['guide.questsPage.objectivesTitle', 'guide.questsPage.objectivesBody'],
  ['guide.questsPage.turninTitle', 'guide.questsPage.turninBody'],
  ['guide.questsPage.partyTitle', 'guide.questsPage.partyBody'],
] as const;

// The objective shapes, as title + body beat cards.
const TYPES = [
  ['guide.questsPage.typeSlayTitle', 'guide.questsPage.typeSlayBody'],
  ['guide.questsPage.typeGatherTitle', 'guide.questsPage.typeGatherBody'],
  ['guide.questsPage.typeInteractTitle', 'guide.questsPage.typeInteractBody'],
  ['guide.questsPage.typeMusterTitle', 'guide.questsPage.typeMusterBody'],
  ['guide.questsPage.typeGroupTitle', 'guide.questsPage.typeGroupBody'],
] as const;

// The villain-ladder saga, zone by zone, as title + body beat cards.
const SAGA = [
  ['guide.questsPage.sagaValeTitle', 'guide.questsPage.sagaValeBody'],
  ['guide.questsPage.sagaMarshTitle', 'guide.questsPage.sagaMarshBody'],
  ['guide.questsPage.sagaPeaksTitle', 'guide.questsPage.sagaPeaksBody'],
] as const;

// The optional side-chains.
const SIDE = [
  ['guide.questsPage.sideWardenTitle', 'guide.questsPage.sideWardenBody'],
  ['guide.questsPage.sideTempleTitle', 'guide.questsPage.sideTempleBody'],
  ['guide.questsPage.sideCryptTitle', 'guide.questsPage.sideCryptBody'],
] as const;

export const quests: GuidePage = {
  titleKey: 'guide.nav.quests',
  render() {
    const steps = STEPS.map(
      ([title, body]) =>
        `<section class="guide-block"><h2>${esc(t(title))}</h2><p>${esc(t(body))}</p></section>`,
    ).join('');
    const types = TYPES.map(([title, body]) => loreBeat(title, body)).join('');
    const saga = SAGA.map(([title, body]) => loreBeat(title, body)).join('');
    const side = SIDE.map(([title, body]) => loreBeat(title, body)).join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.questsPage.heading'))}</h1>
        ${lead('guide.questsPage.intro')}
        ${steps}

        <section class="guide-block">
          <h2>${esc(t('guide.questsPage.typesTitle'))}</h2>
          <p>${esc(t('guide.questsPage.typesBody'))}</p>
          <div class="guide-beat-grid">${types}</div>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.questsPage.storyTitle'))}</h2>
          <p>${esc(t('guide.questsPage.storyBody'))}</p>
          <p class="guide-callout">${esc(t('guide.questsPage.soloNote'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.questsPage.sagaTitle'))}</h2>
          <p>${esc(t('guide.questsPage.sagaBody'))}</p>
          <div class="guide-beat-grid">${saga}</div>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.questsPage.sideTitle'))}</h2>
          <div class="guide-beat-grid">${side}</div>
        </section>

        ${related([
          { href: hrefFor('world'), key: 'guide.nav.world' },
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
        ])}
      </article>`;
  },
};
