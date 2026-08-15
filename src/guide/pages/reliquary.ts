// The Reliquary wiki page: spoiler-safe catalog of shelves, pages, and relic
// names. No personal progress, clear counts, firstFind, or drop sources. Names
// are English proper nouns baked from the sim (GUIDE_DEEDS pattern).

import { esc } from '../../ui/esc';
import { formatNumber, type TranslationKey, t } from '../../ui/i18n';
import { GUIDE_RELIQUARY, type GuideReliquaryPage } from '../content.generated';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, related } from './ui';

const SHELF_ORDER = ['conquerors', 'professions', 'horizons'] as const;

const SHELF_LABEL_KEYS: Record<(typeof SHELF_ORDER)[number], TranslationKey> = {
  conquerors: 'guide.reliquaryPage.shelf.conquerors',
  professions: 'guide.reliquaryPage.shelf.professions',
  horizons: 'guide.reliquaryPage.shelf.horizons',
};

/** Tag word + explanatory line for an outside-completion page, keyed by the
 *  flag's reason so the two kinds never wear each other's word (the in-game
 *  chip's exhaustive-record rule, mirrored here for the wiki reader). */
const OUTSIDE_COMPLETION_KEYS: Record<
  'retired' | 'personal',
  { tag: TranslationKey; note: TranslationKey }
> = {
  retired: {
    tag: 'guide.reliquaryPage.retiredTag',
    note: 'guide.reliquaryPage.retiredNote',
  },
  personal: {
    tag: 'guide.reliquaryPage.personalTag',
    note: 'guide.reliquaryPage.personalNote',
  },
};

function pageSection(page: GuideReliquaryPage): string {
  const names = page.relics.map((r) => esc(r.name)).join(', ');
  const count = formatNumber(page.relics.length);
  const outside =
    page.excludeFromCompletion !== undefined
      ? OUTSIDE_COMPLETION_KEYS[page.excludeFromCompletion]
      : undefined;
  const tag = outside ? ` <span class="guide-reliquary-flag">(${esc(t(outside.tag))})</span>` : '';
  const note = outside ? `<p class="guide-reliquary-note">${esc(t(outside.note))}</p>` : '';
  return `<section class="guide-block guide-reliquary-page" id="reliquary-${esc(page.id)}">
        <h3 class="guide-reliquary-page-h">${esc(page.name)} <span class="guide-reliquary-count">(${esc(count)})</span>${tag}</h3>
        ${note}<p class="guide-reliquary-relics">${names}</p>
      </section>`;
}

function shelfSection(shelf: (typeof SHELF_ORDER)[number], list: GuideReliquaryPage[]): string {
  const pages = list.filter((p) => p.shelf === shelf);
  if (!pages.length) return '';
  const heading = t('guide.reliquaryPage.shelfHeading', {
    label: t(SHELF_LABEL_KEYS[shelf]),
    count: formatNumber(pages.length),
  });
  return `<section class="guide-block guide-reliquary-shelf" id="reliquary-shelf-${esc(shelf)}">
        <h2 class="guide-reliquary-shelf-h">${esc(heading)}</h2>
        ${pages.map(pageSection).join('')}
      </section>`;
}

/** Pure catalog render over the generated list (unit-testable without a DOM). */
export function reliquaryCatalogSections(list: GuideReliquaryPage[]): string {
  return SHELF_ORDER.map((shelf) => shelfSection(shelf, list)).join('');
}

export const reliquary: GuidePage = {
  titleKey: 'guide.nav.reliquary',
  render() {
    const catalog = reliquaryCatalogSections(GUIDE_RELIQUARY);
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.reliquary'))}</h1>
        ${lead('guide.reliquaryPage.intro')}

        <section class="guide-block">
          <h2>${esc(t('guide.reliquaryPage.howHeading'))}</h2>
          <p>${esc(t('guide.reliquaryPage.howBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.reliquaryPage.ranksHeading'))}</h2>
          <p>${esc(t('guide.reliquaryPage.ranksBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.reliquaryPage.catalogHeading'))}</h2>
          <p>${esc(t('guide.reliquaryPage.catalogBody'))}</p>
          ${catalog}
        </section>

        <p class="guide-callout">${esc(t('guide.reliquaryPage.spoilerNote'))}</p>
        ${related([
          { href: hrefFor('deeds'), key: 'guide.nav.deeds' },
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
          { href: hrefFor('professions'), key: 'guide.nav.professions' },
        ])}
      </article>`;
  },
};
