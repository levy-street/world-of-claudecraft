// Talents and Specializations: a concept explainer plus a spoiler-safe specializations
// overview for all nine classes (name, role, one-liner, mastery name, from talent_i18n).
// Deliberately no numeric talent trees or point allocations: that is build-guide territory
// our guide does not ship. The spec cards reuse the shared class_view component.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { classCrest, className, specCardHtml } from '../class_view';
import { GUIDE_CLASSES, type GuideClassInfo } from '../content.generated';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, pageHeader, related, section } from './ui';

function classBlock(c: GuideClassInfo): string {
  return `
    <section class="guide-talents-class">
      <h3 class="guide-talents-class-h">
        <img class="guide-talents-crest" src="${esc(classCrest(c.id, 96))}" alt="" width="40" height="40" loading="lazy" decoding="async" />
        <a href="${esc(hrefFor(`classes/${c.id}`))}">${esc(className(c.id))}</a>
      </h3>
      <ul class="guide-spec-list">${c.specs.map((sp) => specCardHtml(c.id, sp)).join('')}</ul>
    </section>`;
}

export const talents: GuidePage = {
  titleKey: 'guide.nav.talents',
  render() {
    const specOverview = `
      <p>${esc(t('guide.talentsPage.specsBody'))}</p>
      <div class="guide-talents-classes">${GUIDE_CLASSES.map(classBlock).join('')}</div>`;
    return `
      <article class="guide-article guide-talents">
        ${pageHeader('guide.talentsPage.heading', 'guide.talentsPage.intro')}
        ${section('guide.talentsPage.whatHeading', `<p>${esc(t('guide.talentsPage.whatBody'))}</p>`)}
        ${section('guide.talentsPage.howHeading', `<p>${esc(t('guide.talentsPage.howBody'))}</p><p>${esc(t('guide.talentsPage.choiceNote'))}</p><p>${esc(t('guide.talentsPage.shareNote'))}</p>`)}
        ${callout(esc(t('guide.talentsPage.resetNote')), { variant: 'note', titleKey: 'guide.talentsPage.resetTitle' })}
        ${section('guide.talentsPage.specsHeading', specOverview)}
        ${related([
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('reference/combat'), key: 'guide.nav.combat' },
        ])}
      </article>`;
  },
};
