// Thin DOM consumer for the Loot Explorer window (#loot-explorer-window),
// the deeds/reliquary/dungeon-finder pure-core + thin-consumer family: the
// static index and its filtering live in loot_explorer_view.ts; this module
// only paints and wires callbacks through injected deps, never imports Hud,
// never hardcodes the window id (Hud owns it, see src/ui/hud.ts).
//
// Cold window (src/ui/hud/CLAUDE.md): no live IWorld read, so no signature to
// poll and Hud.update() never touches this file; it rebuilds only on open,
// on a search/filter/tab interaction, and on relocalize() (Hud's language
// fan-out; self-gated on isOpen, forces a full render(), then carries the
// focused control across by data-focus-key, matching the professions_window
// idiom rather than the Reliquary/Deeds no-arm precedent).
//
// Every row is a plain HTML string inserted via innerHTML, never
// document.createElement: this module never reaches a bare document/window
// global (everything comes through the injected root element), so it needs
// no UI_DOM_MODULES entry (tests/architecture.test.ts). A tooltip is wired
// AFTER the string lands (querySelector over the real parsed node), never on
// a node built and discarded before serialization, which is inert.

import { ITEMS } from '../../../sim/data';
import {
  ALL_CLASSES,
  type DungeonDifficulty,
  type ItemDef,
  type PlayerClass,
} from '../../../sim/types';
import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName, tEntity } from '../../entity_i18n';
import { esc } from '../../esc';
import {
  captureFocusKey,
  findFocusKey,
  focusedWithin,
  restoreFirstEnabled,
} from '../../focus_restore';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { QUALITY_COLOR } from '../../icons';
import { ITEM_QUALITY_LABEL_KEYS } from '../../item_kind_label';
import type { PainterHostPresentation } from '../../painter_host';
import { statNameKey } from '../../stat_tooltip_view';
import { focusActiveTab, wireTabStrip } from '../../tab_strip_painter';
import { tabStripHtml, tabStripModel } from '../../tab_strip_view';
import { svgIcon } from '../../ui_icons';
import {
  buildLootExplorerIndex,
  filterLootExplorerItems,
  groupLootExplorerBySource,
  LOOT_EXPLORER_CATEGORIES,
  LOOT_EXPLORER_DEFAULT_FILTERS,
  type LootExplorerCategory,
  type LootExplorerEncounter,
  type LootExplorerFilters,
  type LootExplorerItem,
  type LootExplorerSource,
} from './loot_explorer_view';

const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';
const STAT_FILTER_KEYS = ['str', 'agi', 'sta', 'int', 'spi', 'armor'] as const;
type LootExplorerTab = 'items' | 'encounters';

export interface LootExplorerWindowDeps extends PainterHostPresentation {
  /** The #loot-explorer-window root (Hud owns the id). */
  root(): HTMLElement;
  closeOthers(): void;
  hideTooltip(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

function categoryLabelKey(category: LootExplorerCategory): TranslationKey {
  return `hudChrome.lootExplorer.category.${category}` as TranslationKey;
}

/** Resolves a source row's display name and instance context, entirely
 *  through the entity/class name resolvers (never raw catalog English). */
function sourceLine(source: LootExplorerSource): string {
  const category = t(categoryLabelKey(source.category));
  switch (source.category) {
    case 'raid':
    case 'dungeon':
    case 'open_world': {
      const mobName = tEntity({ kind: 'mob', id: source.sourceId, field: 'name' });
      const context = source.contextId
        ? tEntity({ kind: 'dungeon', id: source.contextId, field: 'name' })
        : null;
      return context
        ? t('hudChrome.lootExplorer.sourceWithContext', { category, name: mobName, context })
        : t('hudChrome.lootExplorer.source', { category, name: mobName });
    }
    case 'delve': {
      const mobName = tEntity({ kind: 'mob', id: source.sourceId, field: 'name' });
      const context = source.contextId
        ? tEntity({ kind: 'delve', id: source.contextId, field: 'name' })
        : null;
      return context
        ? t('hudChrome.lootExplorer.sourceWithContext', { category, name: mobName, context })
        : t('hudChrome.lootExplorer.source', { category, name: mobName });
    }
    case 'rift':
      return t('hudChrome.lootExplorer.riftRankLabel', { rank: source.sourceId });
    case 'vendor':
      return t('hudChrome.lootExplorer.source', {
        category,
        name: tEntity({ kind: 'npc', id: source.sourceId, field: 'name' }),
      });
    case 'quest_reward':
    case 'quest_objective':
      return t('hudChrome.lootExplorer.source', {
        category,
        name: tEntity({ kind: 'quest', id: source.sourceId, field: 'title' }),
      });
    case 'ground_object':
      return category;
    case 'starting_equipment':
      return t('hudChrome.lootExplorer.source', {
        category,
        name: tEntity({
          kind: 'class',
          id: source.restrictedToClass ?? (source.sourceId as PlayerClass),
          field: 'name',
        }),
      });
  }
}

/** A source with no chance field reads as an outright guaranteed handout
 *  UNLESS it is a rift pool pick (a uniform random draw, not a chance roll,
 *  and not every pool item pays out), a quest-collect objective (its item
 *  comes from fulfilling the objective, not from a loot table), or gated
 *  behind an active quest (its own gate line states the real availability).
 *  Shared so the flat item view and the by-encounter grouping never
 *  disagree on the same source (an OSSBrain review defect: the encounter
 *  card labelled every undefined-chance drop "Guaranteed", including rift
 *  pool entries the item view correctly left unlabelled). Exported for
 *  tests/loot_explorer_window.test.ts, which drives it directly (a pure
 *  string function, no DOM), rather than re-deriving the rule against
 *  rendered HTML. */
export function sourceQualifierBits(
  source: {
    category: LootExplorerCategory;
    chance?: number;
    restrictedToClass?: PlayerClass;
    gatedByQuestId?: string;
  },
  difficulty?: DungeonDifficulty,
): string[] {
  const bits: string[] = [];
  if (difficulty) {
    bits.push(t(`hudChrome.lootExplorer.difficulty.${difficulty}` as TranslationKey));
  }
  if (typeof source.chance === 'number') {
    bits.push(
      t('hudChrome.lootExplorer.chance', {
        pct: formatNumber(source.chance * 100, { maximumFractionDigits: 1 }),
      }),
    );
  } else if (
    source.category !== 'rift' &&
    source.category !== 'quest_objective' &&
    !source.gatedByQuestId
  ) {
    bits.push(t('hudChrome.lootExplorer.guaranteed'));
  }
  if (source.category === 'quest_reward' && source.restrictedToClass) {
    bits.push(tEntity({ kind: 'class', id: source.restrictedToClass, field: 'name' }));
  }
  if (source.gatedByQuestId) {
    bits.push(
      t('hudChrome.lootExplorer.gatedByQuest', {
        quest: tEntity({ kind: 'quest', id: source.gatedByQuestId, field: 'title' }),
      }),
    );
  }
  return bits;
}

function sourceDetailLine(source: LootExplorerSource): string {
  return sourceQualifierBits(source, source.difficulty).join(' · ');
}

function itemRowHtml(item: LootExplorerItem, deps: LootExplorerWindowDeps): string {
  const def = itemDefFor(item.itemId);
  if (!def) return '';
  const name = itemDisplayName(def);
  const color = QUALITY_COLOR[item.quality] ?? QUALITY_DEFAULT_COLOR;
  const sources = item.sources
    .map(
      (s) =>
        `<li class="loot-explorer-source"><span class="loot-explorer-source-name">${esc(sourceLine(s))}</span><span class="loot-explorer-source-detail">${esc(sourceDetailLine(s))}</span></li>`,
    )
    .join('');
  return (
    // No aria-label override: the accessible name computes from the visible
    // text (name + every source line), reachable in one focus stop.
    `<div class="loot-explorer-row" tabindex="0" role="group" data-focus-key="item:${esc(item.itemId)}">` +
    `${deps.itemIcon(def)}<div class="loot-explorer-row-body">` +
    `<span class="loot-explorer-item-name" style="color:${color}">${esc(name)}</span>` +
    `<ul class="loot-explorer-sources">${sources}</ul>` +
    `</div></div>`
  );
}

function encounterCardHtml(enc: LootExplorerEncounter, deps: LootExplorerWindowDeps): string {
  const category = t(categoryLabelKey(enc.category));
  const heading =
    enc.category === 'rift'
      ? t('hudChrome.lootExplorer.riftRankLabel', { rank: enc.sourceId })
      : sourceLine({ category: enc.category, sourceId: enc.sourceId, contextId: enc.contextId });
  const diff = enc.difficulty
    ? ` <span class="loot-explorer-diff">${esc(t(`hudChrome.lootExplorer.difficulty.${enc.difficulty}` as TranslationKey))}</span>`
    : '';
  // No attachTooltip() here: this cell is serialized to an HTML string, so a
  // listener bound now would attach to a node that is thrown away, never the
  // parsed node that lands in the document. Wired in renderBody() instead,
  // after the string is inserted (same split itemRowHtml/renderBody use).
  const drops = enc.drops
    .map((drop) => {
      const def = itemDefFor(drop.itemId);
      if (!def) return '';
      const color = QUALITY_COLOR[def.quality ?? 'common'] ?? QUALITY_DEFAULT_COLOR;
      // Difficulty is already shown once at the card title (diff, above): a
      // drop's own detail carries only the chance/guaranteed/class/gate bits,
      // via the same table sourceDetailLine reads for the flat item view.
      const detail = sourceQualifierBits({
        category: enc.category,
        chance: drop.chance,
        restrictedToClass: drop.restrictedToClass,
        gatedByQuestId: drop.gatedByQuestId,
      }).join(' · ');
      const focusKey = `drop:${enc.category}:${enc.sourceId}:${enc.difficulty ?? ''}:${drop.itemId}`;
      return (
        `<div class="loot-explorer-drop" tabindex="0" role="group" data-focus-key="${esc(focusKey)}" data-item-id="${esc(drop.itemId)}">` +
        `${deps.itemIcon(def)}<span style="color:${color}">${esc(itemDisplayName(def))}</span>` +
        `<span class="loot-explorer-source-detail">${esc(detail)}</span></div>`
      );
    })
    .join('');
  return (
    `<div class="loot-explorer-encounter">` +
    `<div class="loot-explorer-encounter-title"><span class="loot-explorer-cat-badge">${esc(category)}</span>${esc(heading)}${diff}</div>` +
    `<div class="loot-explorer-drop-grid">${drops}</div>` +
    `</div>`
  );
}

function itemDefFor(itemId: string): ItemDef | null {
  return ITEMS[itemId] ?? null;
}

function optionsHtml<T extends string>(
  values: readonly T[],
  selected: T | 'all',
  labelFor: (v: T) => string,
): string {
  const all = `<option value="all"${selected === 'all' ? ' selected' : ''}>${esc(t('hudChrome.lootExplorer.filterAll'))}</option>`;
  return (
    all +
    values
      .map(
        (v) =>
          `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(labelFor(v))}</option>`,
      )
      .join('')
  );
}

export class LootExplorerWindow {
  private opened = false;
  private tab: LootExplorerTab = 'items';
  private search = '';
  private filters: LootExplorerFilters = { ...LOOT_EXPLORER_DEFAULT_FILTERS };
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: LootExplorerWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    if (this.opened) {
      this.render();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    this.opened = true;
    this.render();
    this.deps.root().style.display = 'flex';
    (this.deps.root().querySelector('input[data-search]') as HTMLElement | null)?.focus();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.deps.hideTooltip();
    const el = this.deps.root();
    el.style.display = 'none';
    // Per-visit, like deeds/reliquary: a needle typed last session must not
    // hide the catalog on the next open. Filters and the active tab persist.
    this.search = '';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  /** Self-gated on the window's own open check (Hud.refreshLocalizedDynamicUi
   *  calls every window's relocalize() unconditionally on a language switch):
   *  a no-op while closed. This window carries no repaint signature (it is
   *  cold, not signature-gated; see the module header), so there is nothing
   *  to re-latch, only the full render() to force. render() reads search,
   *  filters, and the active tab straight off instance state, so those
   *  survive the rebuild for free; only the focused control needs an
   *  explicit carry, because render() replaces the whole root (toolbar,
   *  tabs, and body alike), not just the body panel renderBody() targets. */
  relocalize(): void {
    if (!this.opened) return;
    const el = this.deps.root();
    const focusKey = captureFocusKey(el);
    this.render();
    if (focusKey) {
      restoreFirstEnabled([
        findFocusKey(el, focusKey),
        findFocusKey(el, 'search'),
        findFocusKey(el, 'close'),
      ]);
    }
  }

  private setSearch(value: string): void {
    this.search = value;
    this.renderBody();
  }

  private setFilter<K extends keyof LootExplorerFilters>(
    key: K,
    value: LootExplorerFilters[K],
  ): void {
    this.filters = { ...this.filters, [key]: value };
    this.renderBody();
  }

  private matchesSearch(item: LootExplorerItem): boolean {
    if (!this.search) return true;
    const def = itemDefFor(item.itemId);
    if (!def) return false;
    return itemDisplayName(def).toLowerCase().includes(this.search.toLowerCase());
  }

  private filteredItems(): LootExplorerItem[] {
    const index = buildLootExplorerIndex();
    return filterLootExplorerItems(index, this.filters).filter((item) => this.matchesSearch(item));
  }

  private render(): void {
    this.deps.hideTooltip();
    const el = this.deps.root();
    markDialogRoot(el, { label: t('hudChrome.lootExplorer.title') });
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('hudChrome.lootExplorer.title'))}</span>` +
      `<button type="button" class="x-btn" data-close data-focus-key="close" aria-label="${esc(t('hudChrome.lootExplorer.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="loot-explorer-toolbar">` +
      `<input type="search" class="loot-explorer-search" data-search data-focus-key="search" value="${esc(this.search)}" placeholder="${esc(t('hudChrome.lootExplorer.searchPlaceholder'))}" aria-label="${esc(t('hudChrome.lootExplorer.searchAria'))}">` +
      `<select class="loot-explorer-filter" data-filter="category" data-focus-key="filter:category" aria-label="${esc(t('hudChrome.lootExplorer.filterCategoryAria'))}">${optionsHtml(LOOT_EXPLORER_CATEGORIES, this.filters.category, (c) => t(categoryLabelKey(c)))}</select>` +
      `<select class="loot-explorer-filter" data-filter="requiredClass" data-focus-key="filter:requiredClass" aria-label="${esc(t('hudChrome.lootExplorer.filterClassAria'))}">${optionsHtml(ALL_CLASSES, this.filters.requiredClass, (c) => tEntity({ kind: 'class', id: c, field: 'name' }))}</select>` +
      `<select class="loot-explorer-filter" data-filter="statKey" data-focus-key="filter:statKey" aria-label="${esc(t('hudChrome.lootExplorer.filterStatAria'))}">${optionsHtml(STAT_FILTER_KEYS, this.filters.statKey, (s) => t(statNameKey(s) as TranslationKey))}</select>` +
      `<select class="loot-explorer-filter" data-filter="quality" data-focus-key="filter:quality" aria-label="${esc(t('hudChrome.lootExplorer.filterQualityAria'))}">${optionsHtml(['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary'] as const, this.filters.quality, (q) => t(ITEM_QUALITY_LABEL_KEYS[q]))}</select>` +
      `</div>` +
      tabStripHtml(
        tabStripModel({
          ariaLabel: t('hudChrome.lootExplorer.title'),
          panelId: 'loot-explorer-body-panel',
          stripClass: 'loot-explorer-tabs',
          tabClass: 'loot-explorer-tab',
          selectedClass: 'on',
          tabs: [
            { id: 'items', label: t('hudChrome.lootExplorer.tabItems') },
            { id: 'encounters', label: t('hudChrome.lootExplorer.tabEncounters') },
          ],
          selected: this.tab,
        }),
      ) +
      `<div id="loot-explorer-body-panel" role="tabpanel" class="loot-explorer-body"></div>` +
      `<div class="loot-explorer-live sr-only" aria-live="polite" role="status"></div>`;
    this.wireChrome(el);
    this.renderBody();
  }

  private wireChrome(el: HTMLElement): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    wireTabStrip(el, 'loot-explorer-tab', (id, focusFollow) => {
      this.tab = id as LootExplorerTab;
      this.render();
      if (focusFollow) focusActiveTab(el, 'loot-explorer-tab', 'on');
    });
    // tab_strip_view.ts is a shared pure core outside this domain's ownership
    // and emits no data-focus-key (only data-tab); stamp it here so a tab
    // button survives relocalize()/render() the same way bank_window.ts keys
    // its shared strip.
    for (const tabEl of el.querySelectorAll<HTMLElement>('.loot-explorer-tab')) {
      tabEl.dataset.focusKey = `tab:${tabEl.dataset.tab}`;
    }
    el.querySelector('input[data-search]')?.addEventListener('input', (e) => {
      this.setSearch((e.target as HTMLInputElement).value);
    });
    for (const select of el.querySelectorAll<HTMLSelectElement>('select[data-filter]')) {
      select.addEventListener('change', () => {
        const key = select.dataset.filter as keyof LootExplorerFilters;
        this.setFilter(key, select.value as LootExplorerFilters[typeof key]);
      });
    }
  }

  private renderBody(): void {
    const el = this.deps.root();
    const body = el.querySelector<HTMLElement>('#loot-explorer-body-panel');
    if (!body) return;
    this.deps.hideTooltip();
    const focused = focusedWithin(body);
    const focusKey = focused?.dataset.focusKey ?? null;
    const scrollTop = body.scrollTop;
    const items = this.filteredItems();
    let count: number;
    if (this.tab === 'items') {
      const rows = items.map((item) => itemRowHtml(item, this.deps)).join('');
      body.innerHTML =
        rows || `<div class="loot-explorer-empty">${esc(t('hudChrome.lootExplorer.empty'))}</div>`;
      for (const row of body.querySelectorAll<HTMLElement>('.loot-explorer-row')) {
        const itemId = row.dataset.focusKey?.slice('item:'.length);
        const def = itemId ? itemDefFor(itemId) : null;
        if (def) this.deps.attachTooltip(row, () => this.deps.itemTooltip(def));
      }
      count = items.length;
    } else {
      const encounters = groupLootExplorerBySource(items);
      const cards = encounters.map((enc) => encounterCardHtml(enc, this.deps)).join('');
      body.innerHTML =
        cards || `<div class="loot-explorer-empty">${esc(t('hudChrome.lootExplorer.empty'))}</div>`;
      for (const drop of body.querySelectorAll<HTMLElement>('.loot-explorer-drop')) {
        const itemId = drop.dataset.itemId;
        const def = itemId ? itemDefFor(itemId) : null;
        if (def) this.deps.attachTooltip(drop, () => this.deps.itemTooltip(def));
      }
      count = encounters.length;
    }
    body.scrollTop = scrollTop;
    const live = el.querySelector<HTMLElement>('.loot-explorer-live');
    if (live) {
      live.textContent = t('hudChrome.lootExplorer.resultCount', { count: formatNumber(count) });
    }
    if (focusKey) {
      const keyed = [...el.querySelectorAll<HTMLElement>('[data-focus-key]')];
      const exact = keyed.find((n) => n.dataset.focusKey === focusKey);
      restoreFirstEnabled([
        exact,
        keyed.find((n) => n.dataset.focusKey === 'search'),
        keyed.find((n) => n.dataset.focusKey === 'close'),
      ]);
    }
  }
}
