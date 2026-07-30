// The Book of Deeds. A spoiler-safe overview of the achievements system: how deeds are
// earned and shown, what Renown is, the cosmetic titles and borders, the per-zone
// Chronicles and their Chroniclers, and the Feats shelf, followed by the full public
// catalog by category. Hidden deeds are filtered out upstream by the generator, so nothing
// secret can reach this page. Every deed's criteria live in the in-game Book of Deeds; the
// wiki lists names, Renown, and rewards only, keeping instanced spoilers off the public
// site (the same bar the dungeons page and the bestiary hold).

import { esc } from '../../ui/esc';
import { formatNumber, type TranslationKey, t } from '../../ui/i18n';
import { GUIDE_DEEDS, type GuideDeed } from '../content.generated';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, related } from './ui';

// Category display order, and the key group its labels come from. Hidden is intentionally
// absent (those deeds never reach GUIDE_DEEDS). A category with no deeds renders nothing, so
// the page survives an empty catalog (the explainer alone).
const CATEGORY_ORDER = [
  'progression',
  'combat',
  'dungeon',
  'delve',
  'chronicle',
  'collection',
  'pvp',
  'social',
  'exploration',
  'feat',
] as const;

// A literal map (not key interpolation) so every category label key is checked against
// the catalog at compile time; a renamed or dropped key fails tsc, not just the render test.
const CATEGORY_LABEL_KEYS: Record<(typeof CATEGORY_ORDER)[number], TranslationKey> = {
  progression: 'guide.deedsPage.cat.progression',
  combat: 'guide.deedsPage.cat.combat',
  dungeon: 'guide.deedsPage.cat.dungeon',
  delve: 'guide.deedsPage.cat.delve',
  chronicle: 'guide.deedsPage.cat.chronicle',
  collection: 'guide.deedsPage.cat.collection',
  pvp: 'guide.deedsPage.cat.pvp',
  social: 'guide.deedsPage.cat.social',
  exploration: 'guide.deedsPage.cat.exploration',
  feat: 'guide.deedsPage.cat.feat',
};

// One catalog row: the deed name, then its Renown (or a Feat tag for zero-Renown feats),
// then the cosmetic reward (title text, the word Border, or nothing). Names and reward
// titles are English proper nouns baked from the sim, rendered as raw text through esc().
function deedRow(d: GuideDeed): string {
  const renownCell = d.feat
    ? `<span class="guide-deed-feat">${esc(t('guide.deedsPage.featTag'))}</span>`
    : esc(formatNumber(d.renown));
  const reward = d.rewardTitle
    ? esc(d.rewardTitle)
    : d.rewardBorder
      ? esc(t('guide.deedsPage.rewardBorder'))
      : '';
  return `<tr>
        <td class="guide-deed-name"><span class="guide-deed-name-wrap">${
          d.crest
            ? `<img class="guide-deed-crest" src="${esc(d.crest)}" alt="" width="28" height="28" loading="lazy" decoding="async" />`
            : ''
        }${esc(d.name)}</span></td>
        <td class="guide-deed-renown">${renownCell}</td>
        <td class="guide-deed-reward">${reward}</td>
      </tr>`;
}

// A whole category subsection: heading with its count, then a table of its deeds. Returns
// an empty string when the category holds no public deeds, so it self-omits.
function categorySection(cat: (typeof CATEGORY_ORDER)[number], list: GuideDeed[]): string {
  const rows = list.filter((d) => d.category === cat);
  if (!rows.length) return '';
  const heading = t('guide.deedsPage.catHeading', {
    label: t(CATEGORY_LABEL_KEYS[cat]),
    count: formatNumber(rows.length),
  });
  return `<section class="guide-block guide-deed-cat" id="deed-cat-${esc(cat)}">
        <h3 class="guide-deed-cat-h">${esc(heading)}</h3>
        <div class="guide-table-scroll">
          <table class="guide-keytable guide-deed-table">
            <thead>
              <tr>
                <th scope="col">${esc(t('guide.deedsPage.colName'))}</th>
                <th scope="col">${esc(t('guide.deedsPage.colRenown'))}</th>
                <th scope="col">${esc(t('guide.deedsPage.colReward'))}</th>
              </tr>
            </thead>
            <tbody>${rows.map(deedRow).join('')}</tbody>
          </table>
        </div>
      </section>`;
}

// The full catalog: one subsection per non-empty category, in display order. Pure over its
// input, so it renders '' for an empty list (the page then shows the explainer alone) and is
// unit-testable without a DOM.
export function catalogSections(list: GuideDeed[]): string {
  return CATEGORY_ORDER.map((cat) => categorySection(cat, list)).join('');
}

export const deeds: GuidePage = {
  titleKey: 'guide.nav.deeds',
  render() {
    const catalog = catalogSections(GUIDE_DEEDS);
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.deeds'))}</h1>
        ${lead('guide.deedsPage.intro')}

        <section class="guide-block">
          <h2>${esc(t('guide.deedsPage.howHeading'))}</h2>
          <p>${esc(t('guide.deedsPage.howBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.deedsPage.renownHeading'))}</h2>
          <p>${esc(t('guide.deedsPage.renownBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.deedsPage.rewardsHeading'))}</h2>
          <p>${esc(t('guide.deedsPage.rewardsBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.deedsPage.chroniclesHeading'))}</h2>
          <p>${esc(t('guide.deedsPage.chroniclesBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.deedsPage.featsHeading'))}</h2>
          <p>${esc(t('guide.deedsPage.featsBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.deedsPage.catalogHeading'))}</h2>
          <p>${esc(t('guide.deedsPage.catalogBody'))}</p>
          ${catalog}
        </section>

        <p class="guide-callout">${esc(t('guide.deedsPage.standingsNote'))}</p>
        ${related([
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('world'), key: 'guide.nav.world' },
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
        ])}
      </article>`;
  },
};
