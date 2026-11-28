// Markup for the Adventure Journal's Loot tab (strings only, never DOM): the
// bar on top (This boss / Whole instance, then the Adventure Guide's own class
// and specialization pickers, with "All classes"), the drops as quality-rimmed
// bag slots (hover or long-press opens the real item tooltip), the count the
// filter hides, and the empty states. The model is journal_loot_filter_view.ts.

import { ITEMS } from '../../../sim/data';
import type { ItemDef } from '../../../sim/types';
import { lootPreviewControlsHtml } from '../../dungeon_catalogue_chrome';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { FOCUS_KEY_ATTR } from '../../focus_restore';
import { formatNumber, type TranslationKey, t, tPlural } from '../../i18n';
import { marketNameColor } from '../../market_name_color';
import { svgIcon } from '../../ui_icons';
import { sourceQualifierBits } from '../loot_explorer';
import type { JournalTier } from './journal_catalog';
import { tierName } from './journal_difficulty_html';
import type {
  JournalLootFilter,
  JournalLootScope,
  JournalLootSection,
  JournalLootView,
} from './journal_loot_filter_view';
import { JOURNAL_LOOT_SCOPES } from './journal_loot_filter_view';
import type { JournalLootRow } from './journal_loot_view';
import { instanceName, mobName, pageName } from './journal_page_html';

const SCOPE_KEYS: Readonly<Record<JournalLootScope, TranslationKey>> = {
  boss: 'hudChrome.adventureJournal.lootScopeBoss',
  instance: 'hudChrome.adventureJournal.lootScopeInstance',
};

/** One drop: a quality-rimmed bag slot, its name in the quality's (AA-lifted)
 *  colour and what qualifies it (chance, quest gate, class, dropping body). */
function lootRowHtml(
  row: JournalLootRow,
  showDropper: boolean,
  itemIcon: (item: ItemDef) => string,
): string {
  const def = ITEMS[row.itemId];
  if (!def) return '';
  const bits = sourceQualifierBits({
    category: 'raid',
    chance: row.chance,
    restrictedToClass: row.restrictedToClass,
    gatedByQuestId: row.gatedByQuestId,
  });
  if (showDropper) {
    bits.push(t('hudChrome.adventureJournal.lootFrom', { boss: mobName(row.dropsFrom) }));
  }
  // The AA-lifted name palette (rare and epic read 3.8:1 in the raw quality
  // hues on this panel).
  const color = marketNameColor(row.quality);
  return `<li class="aj-loot-row aj-quality-${esc(row.quality)}" tabindex="0" data-item-id="${esc(
    row.itemId,
  )}" ${FOCUS_KEY_ATTR}="loot:${esc(row.itemId)}"><span class="ui-socket ui-socket--bag aj-loot-slot">${itemIcon(
    def,
  )}</span><span class="aj-loot-text"><span class="aj-loot-name" style="color:${color}">${esc(
    itemDisplayName(def),
  )}</span><span class="aj-loot-detail">${esc(bits.join(' · '))}</span></span></li>`;
}

/** A list of drops (the Loot tab's grid). */
export function lootListHtml(
  rows: readonly JournalLootRow[],
  members: readonly string[],
  tier: JournalTier,
  itemIcon: (item: ItemDef) => string,
): string {
  return `<ul class="aj-loot" aria-label="${esc(
    t('hudChrome.adventureJournal.lootLabel', { difficulty: tierName(tier) }),
  )}">${rows.map((row) => lootRowHtml(row, members.length > 1, itemIcon)).join('')}</ul>`;
}

/** The empty card: a chest in a well and one line. */
function emptyHtml(text: string, action = ''): string {
  return `<section class="aj-loot-empty"><div class="aj-soon-sigil" aria-hidden="true">${svgIcon(
    'chest',
  )}</div><p>${esc(text)}</p>${action}</section>`;
}

function scopeHtml(scope: JournalLootScope): string {
  return `<div class="aj-loot-scope" role="group" aria-label="${esc(
    t('hudChrome.adventureJournal.lootScopeLabel'),
  )}">${JOURNAL_LOOT_SCOPES.map((entry) => {
    const selected = entry === scope;
    return `<button type="button" class="aj-loot-scope-btn${selected ? ' active' : ''}" data-loot-scope="${entry}" ${FOCUS_KEY_ATTR}="loot-scope:${entry}" aria-pressed="${selected}">${esc(
      t(SCOPE_KEYS[entry]),
    )}</button>`;
  }).join('')}</div>`;
}

function sectionHtml(
  section: JournalLootSection,
  tier: JournalTier,
  itemIcon: (item: ItemDef) => string,
): string {
  const name = pageName(section.members, section.nameKey);
  return `<section class="aj-loot-section"><h3 class="aj-loot-boss"><span class="aj-boss-portrait"><img src="${esc(
    section.portraitUrl,
  )}" alt="" aria-hidden="true"></span><span>${esc(name)}</span></h3>${lootListHtml(
    section.rows,
    section.members,
    tier,
    itemIcon,
  )}</section>`;
}

export interface JournalLootPanelInput {
  view: JournalLootView;
  scope: JournalLootScope;
  filter: JournalLootFilter;
  tier: JournalTier;
  instanceId: string;
  itemIcon: (item: ItemDef) => string;
}

/** The whole Loot tab: the bar, then the drops (one boss's, or each boss's
 *  under its name), the count the filter hides, or the matching empty card. */
export function lootPanelHtml(input: JournalLootPanelInput): string {
  const { view, scope, filter, tier, itemIcon } = input;
  // The class pickers only where there is loot to narrow.
  const pickers =
    view.total > 0 ? lootPreviewControlsHtml(filter, { allClasses: true, bare: true }) : '';
  const bar = `<div class="aj-loot-bar">${scopeHtml(scope)}${pickers}</div>`;
  if (view.total === 0) {
    const none =
      scope === 'instance'
        ? t('hudChrome.adventureJournal.lootNoneInstance', {
            instance: instanceName(input.instanceId),
            difficulty: tierName(tier),
          })
        : t('hudChrome.adventureJournal.lootNone', { difficulty: tierName(tier) });
    return bar + emptyHtml(none);
  }
  if (view.shown === 0) {
    return (
      bar +
      emptyHtml(
        t('hudChrome.adventureGuide.lootEmpty'),
        `<button type="button" class="aj-soon-tier" data-loot-show-all ${FOCUS_KEY_ATTR}="loot-show-all">${esc(
          t('hudChrome.adventureJournal.lootShowAll'),
        )}</button>`,
      )
    );
  }
  const hidden = view.total - view.shown;
  const note =
    filter && hidden > 0
      ? `<p class="aj-loot-hidden">${esc(
          tPlural('hudChrome.adventureJournal.lootHiddenPlural', hidden, {
            count: formatNumber(hidden),
          }),
        )}</p>`
      : '';
  const body =
    scope === 'instance'
      ? view.sections
          .filter((section) => section.rows.length > 0)
          .map((section) => sectionHtml(section, tier, itemIcon))
          .join('')
      : lootListHtml(view.sections[0]?.rows ?? [], view.sections[0]?.members ?? [], tier, itemIcon);
  return bar + note + body;
}
