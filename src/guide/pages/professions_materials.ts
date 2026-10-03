// The Materials reference (/wiki/professions/materials): every material a recipe
// or enchant bill asks for, and every way to get it. A FIXED page beside
// 'economy', 'faq' and 'provisioning', because it spans every craft rather than
// belonging to one.
//
// NOTHING HERE IS HAND-LISTED. Every row and source comes from
// GUIDE_PROF_MATERIALS, which the generator derives from the live tables (the
// gathered half through the same materialSourceInfo authority the in-game
// source panel reads), so the page cannot drift from the game. Every sentence is
// a guide.* t() key; material names localize through their item keys, while
// zone, creature and NPC names are baked English proper nouns (the
// GUIDE_PROF_STATIONS precedent). TRANSPARENCY POLICY: professions pages publish
// exact numbers. SPOILER-SAFE: instanced drops are named by kind only and elite or
// boss carriers by their zone only; the generator enforces both.

import { esc } from '../../ui/esc';
import { formatList, formatMoney, formatNumber, type TranslationKey, t } from '../../ui/i18n';
import {
  GUIDE_PROF_MATERIALS,
  type GuideProfCreatureRef,
  type GuideProfMaterialRow,
  type GuideProfMaterialSource,
} from '../content.generated';
import { hrefFor } from '../routes';
import { craftLabel, dropPlaceLabel, itemNameKey, offerLabel } from './professions_craft';
import { gatheringLabel } from './professions_gathering';
import { related } from './ui';

/** The in-page anchor of one material row, shared with the search index. */
export function materialAnchor(itemId: string): string {
  return `mat-${itemId}`;
}

/** The NPC Locations anchor of one NPC, shared with the search index. */
export function npcAnchor(npcId: string): string {
  return `npc-${npcId}`;
}

const qualityLabel = (q: string): string => t(`itemUi.quality.${q}` as TranslationKey);

function creatureList(creatures: GuideProfCreatureRef[], more: number): string {
  const names = creatures.map((c) =>
    t('guide.profPages.mat.creatureFmt', { name: c.name, zone: c.zone }),
  );
  if (more > 0) names.push(t('guide.profPages.mat.moreFmt', { count: formatNumber(more) }));
  return formatList(names);
}

/** Every line one source contributes, as escaped HTML. Exported for the tests,
 *  which drive each kind directly. */
export function materialSourceHtml(source: GuideProfMaterialSource): string[] {
  switch (source.kind) {
    case 'node': {
      const zones = formatList(
        source.zones.map((z) =>
          t('guide.profPages.mat.nodeZoneFmt', { zone: z.zone, tier: formatNumber(z.nodeTier) }),
        ),
      );
      const lines = [
        esc(
          t('guide.profPages.mat.nodeFmt', {
            profession: gatheringLabel(source.profession),
            zones,
          }),
        ),
      ];
      if (source.fineToolTier !== undefined) {
        lines.push(
          esc(t('guide.profPages.mat.nodeFine', { tier: formatNumber(source.fineToolTier) })),
        );
      }
      return lines;
    }
    case 'corpse': {
      const lines: string[] = [];
      if (source.creatures.length > 0) {
        lines.push(
          esc(
            t('guide.profPages.mat.corpseFmt', {
              creatures: creatureList(source.creatures, source.more),
            }),
          ),
        );
      }
      if (source.eliteZones) {
        lines.push(
          esc(t('guide.profPages.mat.corpseElite', { zones: formatList(source.eliteZones) })),
        );
      }
      return lines;
    }
    case 'specimen':
      // Points at the base material's own row, where its harvest sources are.
      return [
        linkedSentence(
          t('guide.profPages.mat.specimenFmt', { base: LINK_MARKER }),
          `<a href="#${esc(materialAnchor(source.baseItemId))}">${esc(t(itemNameKey(source.baseItemId)))}</a>`,
        ),
      ];
    case 'farm': {
      const lines = [
        esc(
          t('guide.profPages.mat.farmFmt', {
            skill: formatNumber(source.skill),
            tier: formatNumber(source.hoeTier),
            minutes: formatNumber(source.growMinutes),
          }),
        ),
      ];
      if (source.fine) lines.push(esc(t('guide.profPages.mat.farmFine')));
      return lines;
    }
    case 'fishing':
      return [
        esc(
          t('guide.profPages.mat.fishingFmt', {
            zones: formatList(
              source.zones.map((z) =>
                t('guide.profPages.mat.fishingZoneFmt', {
                  zone: z.zone,
                  skill: formatNumber(z.proficiency),
                  tier: formatNumber(z.rodTier),
                }),
              ),
            ),
          }),
        ),
      ];
    case 'vendor': {
      // Each vendor links to its NPC Locations row, so "who sells it" and
      // "where do I find them" are one click apart.
      const vendors = source.vendors.map(
        (v) => `<a href="${esc(`${hrefFor('npcs')}#${npcAnchor(v.npcId)}`)}">${esc(v.name)}</a>`,
      );
      return [
        linkedSentence(
          t('guide.profPages.mat.vendorFmt', {
            vendors: LINK_MARKER,
            price: formatMoney(source.priceCopper),
          }),
          formatListHtml(vendors),
        ),
      ];
    }
    case 'crafted':
      return [
        esc(
          t('guide.profPages.mat.craftedFmt', {
            crafts: formatList(source.crafts.map((c) => craftLabel(c))),
          }),
        ),
      ];
    case 'drop':
      return [
        esc(
          t('guide.profPages.mat.dropFmt', {
            creatures: creatureList(source.creatures, source.more),
          }),
        ),
      ];
    case 'eliteDrop':
      return [esc(t('guide.profPages.mat.eliteDropFmt', { zones: formatList(source.zones) }))];
    case 'instanced':
      return source.places.map((place) => esc(dropPlaceLabel(place)));
    case 'questDrop':
      return source.places.map((place) =>
        esc(t('guide.profPages.mat.questOnlyFmt', { source: dropPlaceLabel(place) })),
      );
    case 'quartermaster':
      return source.offers.map((offer) => esc(offerLabel(offer)));
    case 'disenchant':
      return [
        `<a href="${esc(`${hrefFor('professions/enchanting')}#prof-disenchant`)}">${esc(
          t('guide.profPages.mat.disenchant'),
        )}</a>`,
      ];
    case 'salvage':
      return [
        `<a href="${esc(hrefFor('professions/enchanting'))}">${esc(t('guide.profPages.mat.salvage'))}</a>`,
      ];
    case 'bossCredit':
      return [
        esc(
          t('guide.profPages.mat.bossCreditFmt', {
            min: formatNumber(source.min),
            max: formatNumber(source.max),
          }),
        ),
        esc(
          t('guide.profPages.mat.riftCreditFmt', {
            a: formatNumber(source.riftA),
            s: formatNumber(source.riftS),
          }),
        ),
      ];
  }
}

/** A t() sentence with one linked slot: the template is filled with a marker
 *  and split there, so the link markup never passes through t() as HTML and
 *  the rest of the sentence is escaped as text. */
const LINK_MARKER = '\uE000';
function linkedSentence(text: string, linkHtml: string): string {
  return text
    .split(LINK_MARKER)
    .map((part) => esc(part))
    .join(linkHtml);
}

/** Joins already-escaped HTML fragments with the locale's list punctuation:
 *  the fragments are swapped for placeholders, formatted, then swapped back. */
function formatListHtml(fragments: string[]): string {
  const keys = fragments.map((_, i) => `\uE001${i}\uE001`);
  return esc(formatList(keys)).replace(/\uE001(\d+)\uE001/g, (_, i) => fragments[Number(i)]);
}

function materialRowHtml(row: GuideProfMaterialRow): string {
  const where = row.sources
    .flatMap(materialSourceHtml)
    .map((line) => `<span class="guide-prof-src">${line}</span>`)
    .join('');
  return `<tr id="${esc(materialAnchor(row.itemId))}">
        <td class="q-${esc(row.quality)}">${esc(t(itemNameKey(row.itemId)))}<span class="guide-prof-effect">${esc(qualityLabel(row.quality))}</span></td>
        <td>${esc(formatList(row.usedBy.map((c) => craftLabel(c))))}</td>
        <td>${where}</td>
      </tr>`;
}

export function materialsDetailHtml(): string {
  const rows = GUIDE_PROF_MATERIALS.map(materialRowHtml).join('');
  return `<article class="guide-article guide-prof-detail">
    <h1>${esc(t('guide.profPages.mat.title'))}</h1>
    <p class="guide-lead">${esc(t('guide.profPages.mat.intro'))}</p>
    <div class="guide-table-scroll"><table class="guide-keytable guide-prof-table">
      <thead><tr>
        <th scope="col">${esc(t('guide.profPages.colMaterial'))}</th>
        <th scope="col">${esc(t('guide.profPages.mat.colUsedBy'))}</th>
        <th scope="col">${esc(t('guide.profPages.mat.colWhere'))}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${related([
      { href: hrefFor('professions'), key: 'guide.nav.professions' },
      { href: hrefFor('npcs'), key: 'guide.nav.npcs' },
      { href: hrefFor('professions/provisioning'), key: 'guide.profPages.prov.title' },
      { href: hrefFor('professions/economy'), key: 'guide.profPages.econ.title' },
    ])}
  </article>`;
}
