// Combat overview. High level by design: concepts only, no formulas, coefficients, or
// numbers, so there is nothing here to min-max or exploit (classic-guide altitude).
//
// The ledge-climb block (guide.combat.climb*) is traversal rather than combat, and it
// lands here because the pull-up is a scripted movement mode that crowd control breaks
// (src/sim/climb.ts). If the Controls page ever grows a movement section, move it there.

import { esc } from '../../ui/esc';
import { formatNumber, t } from '../../ui/i18n';
import { LEVEL_CAP } from '../data';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, p, pageHeader, related, section, sectionPair } from './ui';

const BLOCKS = [
  ['guide.combat.hitTitle', 'guide.combat.hitBody'],
  ['guide.combat.mitigationTitle', 'guide.combat.mitigationBody'],
  ['guide.combat.resourcesTitle', 'guide.combat.resourcesBody'],
  ['guide.combat.queueTitle', 'guide.combat.queueBody'],
] as const;

export const combat: GuidePage = {
  titleKey: 'guide.nav.combat',
  render() {
    const blocks = BLOCKS.map(([title, body]) => sectionPair(title, body)).join('');
    return `
      <article class="guide-article">
        ${pageHeader('guide.nav.combat')}
        ${lead('guide.combat.intro')}
        ${blocks}
        ${section(
          'guide.combat.growTitle',
          `<p>${esc(t('guide.combat.growBody', { cap: formatNumber(LEVEL_CAP) }))}</p>`,
        )}
        ${section(
          'guide.combat.effectsTitle',
          p('guide.combat.effectsBody') + p('guide.combat.ccBody') + p('guide.combat.metersBody'),
        )}
        ${sectionPair('guide.combat.threatTitle', 'guide.combat.threatBody')}
        ${sectionPair('guide.combat.climbTitle', 'guide.combat.climbBody')}
        ${section(
          'guide.combat.hazardsTitle',
          p('guide.combat.breathBody') + p('guide.combat.fatigueBody'),
        )}
        ${sectionPair('guide.combat.deathTitle', 'guide.combat.deathBody')}
        ${sectionPair('guide.combat.allyRezTitle', 'guide.combat.allyRezBody')}
        ${sectionPair('guide.combat.unstuckTitle', 'guide.combat.unstuckBody')}
        ${related([
          { href: hrefFor('reference/stats'), key: 'guide.nav.stats' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('reference/talents'), key: 'guide.nav.talents' },
          { href: hrefFor('reference/glossary'), key: 'guide.nav.glossary' },
        ])}
      </article>`;
  },
};
