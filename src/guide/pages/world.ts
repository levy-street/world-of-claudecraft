// World / zones: a schematic south-to-north map plus a card per zone, fed from sim zone
// data (name, level band, hub town, point-of-interest labels) with curated, spoiler-safe
// blurbs. Resident creature families are derived from the bestiary level bands and link
// into it. Place and hub names are the English sim source (proper nouns), like creature
// and class names elsewhere in the guide.

import { t, formatNumber, type TranslationKey } from '../../ui/i18n';
import { esc } from '../../ui/esc';
import { GUIDE_ZONES, GUIDE_FAMILIES, type GuideZoneInfo } from '../content.generated';
import { hrefFor } from '../routes';
import { pageHeader, related, loreQuote, loreFigure } from './ui';
import type { GuidePage } from './types';

// Blurbs are keyed by biome (vale / marsh / peaks), so they never depend on zone order.
const blurbKey = (biome: string): TranslationKey => `guide.worldPage.${biome}Blurb` as TranslationKey;
// Per-biome hub greeting (the spoken line + its speaker proper noun) and place notes.
const greetingKey = (biome: string): TranslationKey => `guide.worldPage.${biome}Greeting` as TranslationKey;
const greeterText = (biome: string): string => t(`guide.worldPage.${biome}Greeter` as TranslationKey);
const placeNotesKey = (biome: string): TranslationKey => `guide.worldPage.${biome}PlaceNotes` as TranslationKey;
const familyName = (family: string): string => t(`guide.family.${family}.name` as TranslationKey);
const bandLabel = (z: GuideZoneInfo): string => t('guide.home.world.levels', { min: formatNumber(z.min), max: formatNumber(z.max) });

// Which creature families live in a zone: any family with a creature whose level band
// overlaps the zone's. Drives the spoiler-safe "who you will meet" cross-links.
function residentFamilies(z: GuideZoneInfo): string[] {
  return GUIDE_FAMILIES
    .filter((fam) => fam.creatures.some((c) => c.min <= z.max && c.max >= z.min))
    .map((fam) => fam.family);
}

function mapHtml(): string {
  const bands = GUIDE_ZONES
    .map((z) => `
      <a class="guide-worldmap-zone guide-zone-${esc(z.biome)}" href="#zone-${esc(z.biome)}">
        <span class="guide-worldmap-band">${esc(bandLabel(z))}</span>
        <span class="guide-worldmap-name">${esc(z.name)}</span>
        ${z.hub ? `<span class="guide-worldmap-hub">${esc(z.hub)}</span>` : ''}
      </a>`)
    .join('');
  return `
    <section class="guide-worldmap-wrap" aria-labelledby="guide-worldmap-h">
      <h2 class="guide-worldmap-h" id="guide-worldmap-h">${esc(t('guide.worldPage.mapHeading'))}</h2>
      <p class="guide-worldmap-sub">${esc(t('guide.worldPage.mapSub'))}</p>
      <div class="guide-worldmap">${bands}</div>
    </section>`;
}

function poisHtml(z: GuideZoneInfo): string {
  if (!z.pois.length) return '';
  const items = z.pois.map((label) => `<li class="guide-poi">${esc(label)}</li>`).join('');
  return `
    <div class="guide-zone-detail">
      <h3 class="guide-zone-subh">${esc(t('guide.worldPage.places'))}</h3>
      <ul class="guide-poi-list">${items}</ul>
      <p class="guide-zone-places-note">${esc(t(placeNotesKey(z.biome)))}</p>
    </div>`;
}

function residentsHtml(z: GuideZoneInfo): string {
  const families = residentFamilies(z);
  if (!families.length) return '';
  const links = families
    .map((fam) => `<a class="guide-poi" href="${esc(hrefFor('bestiary'))}#fam-${esc(fam)}">${esc(familyName(fam))}</a>`)
    .join('');
  return `
    <div class="guide-zone-detail">
      <h3 class="guide-zone-subh">${esc(t('guide.worldPage.residents'))}</h3>
      <div class="guide-poi-list">${links}</div>
    </div>`;
}

function zoneCard(z: GuideZoneInfo): string {
  return `
    <section class="guide-zone-card guide-zone-${esc(z.biome)}" id="zone-${esc(z.biome)}">
      <div class="guide-zone-body">
        <span class="guide-zone-band">${esc(bandLabel(z))}</span>
        <h2 class="guide-zone-name">${esc(z.name)}</h2>
        <p class="guide-zone-blurb">${esc(t(blurbKey(z.biome)))}</p>
        ${z.hub ? `<p class="guide-zone-hub"><span>${esc(t('guide.worldPage.hub'))}:</span> ${esc(z.hub)}</p>` : ''}
        ${loreQuote(greetingKey(z.biome), greeterText(z.biome))}
        ${poisHtml(z)}
        ${residentsHtml(z)}
      </div>
    </section>`;
}

export const world: GuidePage = {
  titleKey: 'guide.nav.world',
  render() {
    return `
      <article class="guide-article guide-world">
        ${pageHeader('guide.worldPage.heading', 'guide.worldPage.intro')}
        ${mapHtml()}
        <div class="guide-zone-grid guide-zone-grid-detail">${GUIDE_ZONES.map(zoneCard).join('')}</div>

        <section class="guide-block">
          <h2>${esc(t('guide.lore.figuresTitle'))}</h2>
          <p>${esc(t('guide.lore.figuresBody'))}</p>
          <div class="guide-figures">
            ${loreFigure('Brother Aldric', 'guide.lore.aldricRole', 'guide.lore.aldricBody')}
            ${loreFigure('Scout Maren', 'guide.lore.marenRole', 'guide.lore.marenBody')}
            ${loreFigure('Ranger Elwyn', 'guide.lore.elwynRole', 'guide.lore.elwynBody')}
          </div>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.worldPage.gladeTitle'))}</h2>
          <p>${esc(t('guide.worldPage.gladeBody'))}</p>
        </section>

        ${related([
          { href: hrefFor('bestiary'), key: 'guide.nav.bestiary' },
          { href: hrefFor('quests'), key: 'guide.nav.quests' },
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
        ])}
      </article>`;
  },
};
