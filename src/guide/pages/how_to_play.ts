// How to Play / Basics: the low-density newcomer tutorial. Steps mirror the in-game
// New-Adventurer flow (Marshal Redbrook, Wolves at the Door). Spoiler-free.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, related } from './ui';

// step0 was added after step1 to step6 were written, so it leads the list rather than
// renumbering keys that locales have already filled.
const STEPS = [
  ['guide.howToPlay.step0Title', 'guide.howToPlay.step0Body'],
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
  ['guide.howToPlay.worldsTitle', 'guide.howToPlay.worldsBody'],
  ['guide.howToPlay.charactersTitle', 'guide.howToPlay.charactersBody'],
  ['guide.howToPlay.namesTitle', 'guide.howToPlay.namesBody'],
  ['guide.howToPlay.connectionTitle', 'guide.howToPlay.connectionBody'],
] as const;

export const howToPlay: GuidePage = {
  titleKey: 'guide.nav.howToPlay',
  render() {
    const steps = STEPS.map(
      ([title, body]) => `<li><h3>${esc(t(title))}</h3><p>${esc(t(body))}</p></li>`,
    ).join('');
    const basics = BASICS.map(
      ([title, body]) =>
        `<div class="guide-basic"><h3>${esc(t(title))}</h3><p>${esc(t(body))}</p></div>`,
    ).join('');
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
          { href: hrefFor('faq'), key: 'guide.nav.faq' },
          { href: hrefFor('wish-i-knew'), key: 'guide.nav.wishIKnew' },
          { href: hrefFor('world'), key: 'guide.nav.world' },
        ])}
      </article>`;
  },
};
