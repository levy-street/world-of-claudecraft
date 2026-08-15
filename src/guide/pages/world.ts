// World / zones: a schematic map of the whole grid plus a card per zone, fed from sim zone
// data (name, level band, hub town, point-of-interest labels) with curated, spoiler-safe
// blurbs. Resident creature families come from the generated camp geography and link
// into the bestiary. Place and hub names are the English sim source (proper nouns), like
// creature and class names elsewhere in the guide.

import { esc } from '../../ui/esc';
import { formatNumber, type TranslationKey, t } from '../../ui/i18n';
import { GUIDE_ZONES, type GuideZoneInfo } from '../content.generated';
import { zoneKeyStem } from '../data';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { loreFigure, loreQuote, pageHeader, paras, related } from './ui';

// Curated per-zone copy (blurb, hub greeting, speaker, place notes) and the in-page
// anchor are keyed by the SHARED key stem in ../data (zoneKeyStem), resolved per ZONE ID
// and never by zone order. The home teaser grid keys its copy off the same stem, so the
// two surfaces cannot disagree about which zone owns which prose; the reason a stem is
// not simply the biome, and the rule for adding one, live with the map there.
const keyStem = zoneKeyStem;
// The stable in-page anchor for a zone card (the map links to it).
const zoneAnchor = (z: GuideZoneInfo): string => `zone-${keyStem(z)}`;

const blurbKey = (z: GuideZoneInfo): TranslationKey =>
  `guide.worldPage.${keyStem(z)}Blurb` as TranslationKey;
// Per-zone hub greeting (the spoken line + its speaker proper noun) and place notes.
const greetingKey = (z: GuideZoneInfo): TranslationKey =>
  `guide.worldPage.${keyStem(z)}Greeting` as TranslationKey;
const greeterText = (z: GuideZoneInfo): string =>
  t(`guide.worldPage.${keyStem(z)}Greeter` as TranslationKey);
const placeNotesKey = (z: GuideZoneInfo): TranslationKey =>
  `guide.worldPage.${keyStem(z)}PlaceNotes` as TranslationKey;
const familyName = (family: string): string => t(`guide.family.${family}.name` as TranslationKey);
const bandLabel = (z: GuideZoneInfo): string =>
  t('guide.home.world.levels', { min: formatNumber(z.min), max: formatNumber(z.max) });

// Which creature families live in a zone: generated from camp geography (a family is a
// resident only where it has a real camp), so a zone card cannot send a reader hunting
// a family that does not spawn there. Drives the spoiler-safe "who you will meet" links.
function residentFamilies(z: GuideZoneInfo): string[] {
  return z.families;
}

function mapHtml(): string {
  const bands = GUIDE_ZONES.map(
    (z) => `
      <a class="guide-worldmap-zone guide-zone-${esc(z.biome)}" href="#${esc(zoneAnchor(z))}">
        <span class="guide-worldmap-band">${esc(bandLabel(z))}</span>
        <span class="guide-worldmap-name">${esc(z.name)}</span>
        ${z.hub ? `<span class="guide-worldmap-hub">${esc(z.hub)}</span>` : ''}
      </a>`,
  ).join('');
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
      <p class="guide-zone-places-note">${esc(t(placeNotesKey(z)))}</p>
    </div>`;
}

function residentsHtml(z: GuideZoneInfo): string {
  const families = residentFamilies(z);
  if (!families.length) return '';
  const links = families
    .map(
      (fam) =>
        `<a class="guide-poi" href="${esc(hrefFor('bestiary'))}#fam-${esc(fam)}">${esc(familyName(fam))}</a>`,
    )
    .join('');
  return `
    <div class="guide-zone-detail">
      <h3 class="guide-zone-subh">${esc(t('guide.worldPage.residents'))}</h3>
      <div class="guide-poi-list">${links}</div>
    </div>`;
}

function zoneCard(z: GuideZoneInfo): string {
  return `
    <section class="guide-zone-card guide-zone-${esc(z.biome)}" id="${esc(zoneAnchor(z))}">
      <div class="guide-zone-body">
        <span class="guide-zone-band">${esc(bandLabel(z))}</span>
        <h2 class="guide-zone-name">${esc(z.name)}</h2>
        <p class="guide-zone-blurb">${esc(t(blurbKey(z)))}</p>
        ${z.hub ? `<p class="guide-zone-hub"><span>${esc(t('guide.worldPage.hub'))}:</span> ${esc(z.hub)}</p>` : ''}
        ${loreQuote(greetingKey(z), greeterText(z))}
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
          <h2>${esc(t('guide.worldPage.travelTitle'))}</h2>
          ${paras('guide.worldPage.travelBody')}
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.worldPage.mountsTitle'))}</h2>
          <p>${esc(t('guide.worldPage.mountsBody'))}</p>
          <p class="guide-section-more"><a href="${esc(hrefFor('mounts'))}">${esc(t('guide.worldPage.mountsMore'))}</a></p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.worldPage.riftTitle'))}</h2>
          <p>${esc(t('guide.worldPage.riftBody'))}</p>
          <p class="guide-section-more"><a href="${esc(hrefFor('rifts'))}">${esc(t('guide.worldPage.riftMore'))}</a></p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.lore.figuresTitle'))}</h2>
          <p>${esc(t('guide.lore.figuresBody'))}</p>
          <div class="guide-figures">
            ${loreFigure('Brother Aldric', 'guide.lore.aldricRole', 'guide.lore.aldricBody')}
            ${loreFigure('Scout Maren', 'guide.lore.marenRole', 'guide.lore.marenBody')}
          </div>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.worldPage.worldBossTitle'))}</h2>
          <p>${esc(t('guide.worldPage.worldBossBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.worldPage.gladeTitle'))}</h2>
          <p>${esc(t('guide.worldPage.gladeBody'))}</p>
        </section>

        ${related([
          { href: hrefFor('bestiary'), key: 'guide.nav.bestiary' },
          { href: hrefFor('quests'), key: 'guide.nav.quests' },
          { href: hrefFor('mounts'), key: 'guide.nav.mounts' },
          { href: hrefFor('rifts'), key: 'guide.nav.rifts' },
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
          { href: hrefFor('delves'), key: 'guide.nav.delves' },
        ])}
      </article>`;
  },
};
