// Factions and Standing: a spoiler-safe overview of the three allied factions, how world
// quests raise standing with them, the six standing tiers and each faction's titles, the
// quartermasters, where standing is read in game, and the deeds it records. Names, roles,
// hubs, and tier names only (guide spoiler policy): no standing thresholds, no per-quest
// amounts, no item stats or prices, and no level numbers beyond "standing pauses at a tier
// for lower-level characters". Sources: src/sim/factions.ts (FACTIONS, STANDING_TIERS,
// FACTION_TIER_TITLES) and src/sim/content/faction_vendors.ts (FACTION_VENDOR_NPCS).

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, p, pageHeader, related, section } from './ui';

export const factions: GuidePage = {
  titleKey: 'guide.nav.factions',
  render() {
    return `
      <article class="guide-article guide-factions">
        ${pageHeader('guide.factionsPage.heading', 'guide.factionsPage.intro')}
        ${section(
          'guide.factionsPage.whoHeading',
          `${p('guide.factionsPage.whoBody')}${p('guide.factionsPage.riftWatchBody')}${p('guide.factionsPage.churchOrderBody')}${p('guide.factionsPage.automatonsBody')}`,
        )}
        ${section(
          'guide.factionsPage.earningHeading',
          `<p>${esc(t('guide.factionsPage.earningBody'))}</p>${callout(esc(t('guide.factionsPage.lowLevelNote')), { variant: 'note' })}`,
        )}
        ${section(
          'guide.factionsPage.tiersHeading',
          `${p('guide.factionsPage.tiersBody')}${p('guide.factionsPage.riftWatchTitles')}${p('guide.factionsPage.churchOrderTitles')}${p('guide.factionsPage.automatonsTitles')}`,
        )}
        ${section('guide.factionsPage.quartermastersHeading', p('guide.factionsPage.quartermastersBody'))}
        ${section('guide.factionsPage.readingHeading', p('guide.factionsPage.readingBody'))}
        ${section('guide.factionsPage.deedsHeading', p('guide.factionsPage.deedsBody'))}
        ${related([
          { href: hrefFor('quests'), key: 'guide.nav.quests' },
          { href: hrefFor('economy'), key: 'guide.nav.economy' },
          { href: hrefFor('deeds'), key: 'guide.nav.deeds' },
          { href: hrefFor('reference/stats'), key: 'guide.nav.stats' },
        ])}
      </article>`;
  },
};
