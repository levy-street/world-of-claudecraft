// How to Play / Basics: the low-density newcomer tutorial. Steps mirror the in-game
// New-Adventurer flow (Marshal Redbrook, Wolves at the Door). Spoiler-free.

import { t } from '../../ui/i18n';
import { esc } from '../../ui/esc';
import { hrefFor } from '../routes';
import { lead, related } from './ui';
import type { GuidePage } from './types';

const STEPS = [
  ['guide.howToPlay.step1Title', 'guide.howToPlay.step1Body'],
  ['guide.howToPlay.step2Title', 'guide.howToPlay.step2Body'],
  ['guide.howToPlay.step3Title', 'guide.howToPlay.step3Body'],
  ['guide.howToPlay.step4Title', 'guide.howToPlay.step4Body'],
  ['guide.howToPlay.step5Title', 'guide.howToPlay.step5Body'],
  ['guide.howToPlay.step6Title', 'guide.howToPlay.step6Body'],
] as const;

const BASICS = [
  ['guide.howToPlay.resourcesTitle', 'guide.howToPlay.resourcesBody'],
  ['guide.howToPlay.targetingTitle', 'guide.howToPlay.targetingBody'],
  ['guide.howToPlay.questsTitle', 'guide.howToPlay.questsBody'],
  ['guide.howToPlay.deathTitle', 'guide.howToPlay.deathBody'],
  ['guide.howToPlay.groupingTitle', 'guide.howToPlay.groupingBody'],
  ['guide.howToPlay.onlineTitle', 'guide.howToPlay.onlineBody'],
] as const;

export const howToPlay: GuidePage = {
  titleKey: 'guide.nav.howToPlay',
  render() {
    const steps = STEPS
      .map(([title, body]) => `<li><h3>${esc(t(title))}</h3><p>${esc(t(body))}</p></li>`)
      .join('');
    const basics = BASICS
      .map(([title, body]) => `<div class="guide-basic"><h3>${esc(t(title))}</h3><p>${esc(t(body))}</p></div>`)
      .join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.howToPlay'))}</h1>
        ${lead('guide.howToPlay.intro')}

        <section class="guide-block">
          <h2>${esc(t('guide.howToPlay.firstHeading'))}</h2>
          <ol class="guide-steps">${steps}</ol>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.howToPlay.basicsHeading'))}</h2>
          <div class="guide-basics">${basics}</div>
        </section>

        <p class="guide-callout">${esc(t('guide.howToPlay.reassure'))}</p>
        <p class="guide-section-more"><a href="${esc(hrefFor('reference/controls'))}">${esc(t('guide.howToPlay.controlsLink'))}</a></p>
        ${related([
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('wish-i-knew'), key: 'guide.nav.wishIKnew' },
          { href: hrefFor('world'), key: 'guide.nav.world' },
        ])}
      </article>`;
  },
};
