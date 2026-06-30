// Dungeons and Raids: group-content overview plus teaser cards. The roster (names, level
// bands, party sizes) is generated from the sim DUNGEONS so it never drifts; the flavor
// bodies are curated guide copy. Thematic only, no boss scripts, timers, or loot. The
// endgame raid is teased without naming its boss (its sim name is withheld in the feed).

import { esc } from '../../ui/esc';
import { formatNumber, type TranslationKey, t } from '../../ui/i18n';
import { GUIDE_DUNGEONS, type GuideDungeon } from '../content.generated';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, p, pageHeader, related, section } from './ui';

// Curated flavor body, keyed by the generated dungeon id (raid is the withheld-name one).
const BODY: Record<string, TranslationKey> = {
  hollow_crypt: 'guide.dungeonsPage.hollowBody',
  sunken_bastion: 'guide.dungeonsPage.bastionBody',
  drowned_temple: 'guide.dungeonsPage.templeBody',
  gravewyrm_sanctum: 'guide.dungeonsPage.sanctumBody',
  raid: 'guide.dungeonsPage.raidBody',
};

function levelLabel(d: GuideDungeon): string {
  if (d.min == null || d.max == null) return '';
  return d.min === d.max
    ? t('guide.dungeonsPage.levelExact', { n: formatNumber(d.max) })
    : t('guide.dungeonsPage.levelBand', { min: formatNumber(d.min), max: formatNumber(d.max) });
}

function dungeonCard(d: GuideDungeon): string {
  const bodyKey = BODY[d.id];
  if (!bodyKey) return '';
  const name = d.isRaid ? t('guide.dungeonsPage.raidName') : (d.name ?? '');
  const level = levelLabel(d);
  return `
    <section class="guide-dungeon-card${d.isRaid ? ' guide-dungeon-raid' : ''}">
      <div class="guide-dungeon-head">
        <h2 class="guide-dungeon-name">${esc(name)}</h2>
        ${level ? `<span class="guide-badge guide-badge-level">${esc(level)}</span>` : ''}
      </div>
      <p class="guide-dungeon-meta">${esc(t('guide.dungeonsPage.partySize', { n: formatNumber(d.suggestedPlayers) }))}</p>
      <p>${esc(t(bodyKey))}</p>
    </section>`;
}

export const dungeons: GuidePage = {
  titleKey: 'guide.nav.dungeons',
  render() {
    const cards = GUIDE_DUNGEONS.map(dungeonCard).join('');
    return `
      <article class="guide-article guide-dungeons">
        ${pageHeader('guide.dungeonsPage.heading', 'guide.dungeonsPage.intro')}
        <p>${esc(t('guide.dungeonsPage.party'))}</p>
        ${callout(esc(t('guide.dungeonsPage.soloLead')))}
        <div class="guide-dungeon-grid">${cards}</div>
        ${section('guide.dungeonsPage.templeLoreTitle', p('guide.dungeonsPage.templeLoreBody'))}
        ${section('guide.dungeonsPage.cryptLeadTitle', p('guide.dungeonsPage.cryptLeadBody'))}
        ${related([
          { href: hrefFor('delves'), key: 'guide.nav.delves' },
          { href: hrefFor('world'), key: 'guide.nav.world' },
          { href: hrefFor('arena'), key: 'guide.nav.arena' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
        ])}
      </article>`;
  },
};
