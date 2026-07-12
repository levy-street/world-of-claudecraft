// Combat overview. High level by design: concepts only, no formulas, coefficients, or
// numbers, so there is nothing here to min-max or exploit (classic-guide altitude).

import { esc } from '../../ui/esc';
import { formatNumber, t } from '../../ui/i18n';
import { LEVEL_CAP } from '../data';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, related } from './ui';

const BLOCKS = [
  ['guide.combat.hitTitle', 'guide.combat.hitBody'],
  ['guide.combat.mitigationTitle', 'guide.combat.mitigationBody'],
  ['guide.combat.resourcesTitle', 'guide.combat.resourcesBody'],
  ['guide.combat.queueTitle', 'guide.combat.queueBody'],
] as const;

export const combat: GuidePage = {
  titleKey: 'guide.nav.combat',
  render() {
    const blocks = BLOCKS.map(
      ([title, body]) =>
        `<section class="guide-block"><h2>${esc(t(title))}</h2><p>${esc(t(body))}</p></section>`,
    ).join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.combat'))}</h1>
        ${lead('guide.combat.intro')}
        ${blocks}
        <section class="guide-block">
          <h2>${esc(t('guide.combat.growTitle'))}</h2>
          <p>${esc(t('guide.combat.growBody', { cap: formatNumber(LEVEL_CAP) }))}</p>
        </section>
        <section class="guide-block">
          <h2>${esc(t('guide.combat.effectsTitle'))}</h2>
          <p>${esc(t('guide.combat.effectsBody'))}</p>
          <p>${esc(t('guide.combat.ccBody'))}</p>
          <p>${esc(t('guide.combat.metersBody'))}</p>
        </section>
        <section class="guide-block">
          <h2>${esc(t('guide.combat.deathTitle'))}</h2>
          <p>${esc(t('guide.combat.deathBody'))}</p>
        </section>
        ${related([
          { href: hrefFor('reference/stats'), key: 'guide.nav.stats' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('reference/talents'), key: 'guide.nav.talents' },
          { href: hrefFor('reference/glossary'), key: 'guide.nav.glossary' },
        ])}
      </article>`;
  },
};
