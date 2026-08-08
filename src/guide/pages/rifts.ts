// Rifts: the procedural instanced descents that tear open on their own out in the zones.
// Curated explainer prose only; there is no generated rift roster (every run is built
// fresh from its own seed, so there is nothing stable to tabulate). Spoiler-safe: names,
// the rank letters, the level gate, the shape of a run, and the race rule, all of which
// the game broadcasts to the whole realm in chat. NO rank multipliers, mob levels, drop
// rates, loot tables, coin amounts, or boss scripts. Modeled on delves.ts.
//
// Deliberately absent: the "Rift Forge". The upgrade/enchant/socket seam exists in the
// sim and on the wire but has no client caller, so no player can reach it and the wiki
// must not name it.

import { esc } from '../../ui/esc';
import { formatNumber, t } from '../../ui/i18n';
import { RIFT_MIN_LEVEL } from '../data';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, p, pageHeader, related, section, tag, tagRow } from './ui';

// The four rank letters are proper nouns (they are printed verbatim in the realm
// announcement), so they are raw text spliced into a translator-controlled label.
const RANKS = ['C', 'B', 'A', 'S'] as const;

export const rifts: GuidePage = {
  titleKey: 'guide.nav.rifts',
  render() {
    const rankRow = tagRow(
      RANKS.map((rank) => tag(t('guide.riftsPage.rankFmt', { rank }))).join(''),
    );
    return `
      <article class="guide-article guide-rifts">
        ${pageHeader('guide.riftsPage.heading', 'guide.riftsPage.intro')}
        ${section('guide.riftsPage.whatHeading', p('guide.riftsPage.whatBody'))}
        ${section('guide.riftsPage.openHeading', p('guide.riftsPage.openBody'))}
        ${section('guide.riftsPage.ranksHeading', `${p('guide.riftsPage.ranksBody')}${rankRow}`)}
        ${section(
          'guide.riftsPage.groupHeading',
          `${p('guide.riftsPage.groupBody')}${callout(
            `<p>${esc(t('guide.riftsPage.levelNote', { n: formatNumber(RIFT_MIN_LEVEL) }))}</p>`,
            { variant: 'note' },
          )}`,
        )}
        ${section('guide.riftsPage.floorsHeading', p('guide.riftsPage.floorsBody'))}
        ${section('guide.riftsPage.boundHeading', p('guide.riftsPage.boundBody'))}
        ${section('guide.riftsPage.raceHeading', p('guide.riftsPage.raceBody'))}
        ${section('guide.riftsPage.rewardsHeading', p('guide.riftsPage.rewardsBody'))}
        ${section('guide.riftsPage.trackerHeading', p('guide.riftsPage.trackerBody'))}
        ${related([
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
          { href: hrefFor('delves'), key: 'guide.nav.delves' },
          { href: hrefFor('world'), key: 'guide.nav.world' },
          { href: hrefFor('gear'), key: 'guide.nav.gear' },
        ])}
      </article>`;
  },
};
