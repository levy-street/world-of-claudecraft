// Cold, emit-only Adventure Guide chrome. State and filtering live in pure cores.
import { TALENTS } from '../sim/content/talents';
import { ALL_CLASSES } from '../sim/types';
import {
  ADVENTURE_CATEGORIES,
  type AdventureCategory,
  adventureCategory,
} from './dungeon_catalogue_view';
import type { FinderActivityDetailView, FinderActivityRowView } from './dungeon_finder_view';
import type { LootPreviewSelection } from './dungeon_loot_preview_view';
import { classDisplayName, dungeonDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { FOCUS_KEY_ATTR } from './focus_restore';
import { formatNumber, t } from './i18n';
import { tTalent } from './talent_i18n';
import { svgIcon } from './ui_icons';

export function adventureName(row: Pick<FinderActivityRowView, 'kind' | 'dungeonId'>): string {
  return row.kind === 'delve'
    ? tEntity({ kind: 'delve', id: row.dungeonId, field: 'name' })
    : dungeonDisplayName(row.dungeonId);
}

/** Decorative art only; the copy and encounter portraits carry the accessible names. */
export function catalogueHeroArtHtml(detail: FinderActivityDetailView): string {
  const panoramic = detail.dungeonId === 'hollow_crypt';
  const encounter = detail.encounters.find((entry) => entry.final) ?? detail.encounters.at(-1);
  const url = panoramic ? '/textures/loading/hollow-crypt-empty.webp' : encounter?.portraitUrl;
  return url
    ? `<img class="df-guide-hero-art${panoramic ? '' : ' df-guide-hero-portrait'}" src="${esc(url)}" alt="" decoding="async" draggable="false">`
    : '';
}

export function adventureToolbarHtml(
  rows: readonly FinderActivityRowView[],
  category: AdventureCategory,
  query: string,
  eligibleOnly: boolean,
): string {
  return (
    `<div class="df-guide-intro"><span class="df-eyebrow">${esc(t('hudChrome.adventureGuide.eyebrow'))}</span><p>${esc(t('hudChrome.adventureGuide.intro'))}</p></div>` +
    `<div class="df-categories" role="group" aria-label="${esc(t('hudChrome.adventureGuide.title'))}">${ADVENTURE_CATEGORIES.map(
      (id) => {
        const count = rows.filter((r) => adventureCategory(r.kind) === id).length;
        return `<button type="button" class="df-category ui-btn${id === category ? ' is-on' : ''}" data-category="${id}" ${FOCUS_KEY_ATTR}="category:${id}" aria-pressed="${id === category}">${svgIcon(id === 'raids' ? 'skull' : id === 'delves' ? 'chest' : 'social')}<span>${esc(t(`hudChrome.adventureGuide.${id}`))}</span><span class="df-category-count">${formatNumber(count)}</span></button>`;
      },
    ).join('')}</div>` +
    `<div class="df-filters"><label class="df-search"><span class="sr-only">${esc(t('hudChrome.adventureGuide.search'))}</span><input class="ui-input" type="search" data-guide-search ${FOCUS_KEY_ATTR}="guide-search" value="${esc(query)}" placeholder="${esc(t('hudChrome.adventureGuide.search'))}"></label><label class="df-eligible"><input type="checkbox" data-guide-eligible ${FOCUS_KEY_ATTR}="guide-eligible"${eligibleOnly ? ' checked' : ''}>${esc(t('hudChrome.adventureGuide.eligible'))}</label></div>`
  );
}

export function lootPreviewControlsHtml(selection: LootPreviewSelection): string {
  return `<div class="df-loot-filter"><div class="df-sub">${esc(t('hudChrome.adventureGuide.inspectLoot'))}</div><div class="df-loot-selects"><label>${esc(t('hudChrome.adventureGuide.lootClass'))}<select class="ui-input" data-loot-class ${FOCUS_KEY_ATTR}="loot-class">${ALL_CLASSES.map((cls) => `<option value="${cls}"${cls === selection.cls ? ' selected' : ''}>${esc(classDisplayName(cls))}</option>`).join('')}</select></label><label>${esc(t('hudChrome.adventureGuide.lootSpec'))}<select class="ui-input" data-loot-spec ${FOCUS_KEY_ATTR}="loot-spec"><option value=""${selection.spec === null ? ' selected' : ''}>${esc(t('hudChrome.adventureGuide.allSpecs'))}</option>${TALENTS[selection.cls].specs.map((spec) => `<option value="${esc(spec.id)}"${spec.id === selection.spec ? ' selected' : ''}>${esc(tTalent({ kind: 'talentSpec', spec, field: 'name' }))}</option>`).join('')}</select></label></div><p class="df-loot-hint">${esc(t('hudChrome.adventureGuide.lootHint'))}</p></div>`;
}
