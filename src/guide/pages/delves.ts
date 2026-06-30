// Delves: the short, replayable instanced descents. The roster (name, level floor, party
// size, the keeper NPC, the auto-companion, the difficulty tier labels, and the run-modifier
// affix names) is generated from the sim COLLAPSED_RELIQUARY_DELVE so it never drifts; the
// explainer copy is curated guide prose. Spoiler-safe: no balance numbers, lock-grid layouts,
// Marks prices, loot, or boss script. Modeled on dungeons.ts.

import { esc } from '../../ui/esc';
import { formatNumber, t } from '../../ui/i18n';
import { GUIDE_DELVES, type GuideDelve } from '../content.generated';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, p, pageHeader, related, section, tag, tagRow } from './ui';

// The companion role reuses the shared role labels, so "healer" reads the same here as on the
// class pages. Unknown roles fall back to the damage label.
function roleLabel(role: string): string {
  if (role === 'tank') return t('guide.role.tank');
  if (role === 'healer') return t('guide.role.healer');
  return t('guide.role.damage');
}

function delveCard(d: GuideDelve): string {
  const tiers = d.tiers.map((tier) => `<span class="guide-badge">${esc(tier)}</span>`).join(' ');
  const facts: string[] = [];
  if (d.keeper) {
    // The separator/punctuation is translator-controlled via keeperFmt, not a hardcoded ", ".
    const keeper = d.keeper.title
      ? t('guide.delvesPage.keeperFmt', { name: d.keeper.name, title: d.keeper.title })
      : d.keeper.name;
    facts.push(
      `<p><span class="guide-figure-role">${esc(t('guide.delvesPage.keeperLabel'))}</span> ${esc(keeper)}</p>`,
    );
  }
  if (d.companion) {
    const companion = t('guide.delvesPage.companionFmt', {
      name: d.companion.name,
      role: roleLabel(d.companion.role),
    });
    facts.push(
      `<p><span class="guide-figure-role">${esc(t('guide.delvesPage.companionLabel'))}</span> ${esc(companion)}</p>`,
    );
  }
  if (tiers) {
    facts.push(
      `<p><span class="guide-figure-role">${esc(t('guide.delvesPage.tiersLabel'))}</span> ${tiers}</p>`,
    );
  }
  return `
    <section class="guide-dungeon-card">
      <div class="guide-dungeon-head">
        <h2 class="guide-dungeon-name">${esc(d.name)}</h2>
        <span class="guide-badge guide-badge-level">${esc(t('guide.delvesPage.fromLevel', { n: formatNumber(d.minLevel) }))}</span>
      </div>
      <p class="guide-dungeon-meta">${esc(t('guide.delvesPage.partyLabel'))}</p>
      ${facts.join('')}
    </section>`;
}

export const delves: GuidePage = {
  titleKey: 'guide.nav.delves',
  render() {
    // The affix pill row pools every delve's modifier names (deduped), so a future second
    // delve theme widens the list automatically.
    const affixNames = [...new Set(GUIDE_DELVES.flatMap((d) => d.affixes))];
    const affixRow = affixNames.length ? tagRow(affixNames.map((a) => tag(a)).join('')) : '';
    const cards = GUIDE_DELVES.map(delveCard).join('');
    return `
      <article class="guide-article guide-delves">
        ${pageHeader('guide.delvesPage.heading', 'guide.delvesPage.intro')}
        ${section('guide.delvesPage.whatHeading', p('guide.delvesPage.whatBody'))}
        ${section('guide.delvesPage.howHeading', p('guide.delvesPage.howBody'))}
        <div class="guide-dungeon-grid">${cards}</div>
        ${section('guide.delvesPage.companionHeading', p('guide.delvesPage.companionBody'))}
        ${section('guide.delvesPage.lockpickHeading', p('guide.delvesPage.lockpickBody'))}
        ${section('guide.delvesPage.tiersHeading', p('guide.delvesPage.tiersBody'))}
        ${section('guide.delvesPage.affixesHeading', `${p('guide.delvesPage.affixesBody')}${affixRow}`)}
        ${section('guide.delvesPage.marksHeading', p('guide.delvesPage.marksBody'))}
        ${section('guide.delvesPage.whereHeading', callout(p('guide.delvesPage.whereBody'), { variant: 'note' }))}
        ${related([
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
          { href: hrefFor('world'), key: 'guide.nav.world' },
          { href: hrefFor('gear'), key: 'guide.nav.gear' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
        ])}
      </article>`;
  },
};
