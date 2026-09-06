// Thin DOM painter for the Collections window: every buddy, every mount and
// every epic-or-better armour set in the game, with where each one comes from.
//
// The consumer half of the pure-core + thin-painter split. collections_view.ts
// models the three tabs and collection_sources.ts derives each row's sources
// from the live content tables; this module renders whichever tab is selected,
// owns the window's view-state (active tab, selected row, render-skip
// signature, focus return) and holds no Sim reference, reaching Hud only
// through its deps.
//
// The detail pane mounts the SHARED character turntable (Hud.mountSharedPreview
// through the mountPreview dep), never a second WebGL context: one preview
// canvas moves between the character sheet, the inspect stage and this window,
// so opening Collections adds no GPU producer.
//
// Live prices are deliberately per-SELECTION, never per-row: the World Market
// figure rides the existing at-the-Merchant sell-price check and the $WOC
// figure one Exchange browse for the selected set's pieces. A whole-catalog
// price sweep would need a bulk server read that does not exist today, and
// this window is not the place to invent one.

import { audio } from '../../game/audio';
import { ITEMS } from '../../sim/data';
import type { ArmorType } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { markDialogRoot } from '../dialog_root';
import { itemDisplayName, itemSetBonusField, tEntity } from '../entity_i18n';
import { esc } from '../esc';
import { formatMoney, formatNumber, type TranslationKey, t } from '../i18n';
import type { PainterHostPresentation } from '../painter_host';
import { svgIcon } from '../ui_icons';
import { itemIconImgHtml } from '../unknown_item_icon';
import type { CollectionDropSource, CollectionItemFacts } from './collection_sources';
import {
  buildCollectionsView,
  COLLECTIONS_TABS,
  type CollectionEntryView,
  type CollectionPetGroupView,
  type CollectionPetKind,
  type CollectionSetStat,
  type CollectionSetView,
  type CollectionsTabId,
  type CollectionsView,
} from './collections_view';

/** Which body the preview is framing: the two differ by several times a
 *  player's height, so they cannot share one camera crop. */
export type CollectionPreviewKind = 'buddy' | 'mount';

export interface CollectionsWindowDeps extends PainterHostPresentation {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** Mount the shared turntable showing this renderer visual key. A key with no
   *  rig is a no-op for the caller to ignore: the pane then shows the icon
   *  alone rather than an empty canvas. */
  mountPreview(
    container: HTMLElement,
    visualKey: string,
    kind: CollectionPreviewKind,
    tint: number,
  ): void;
  /** Buddy and mount keys the viewer owns, and the item ids they carry or wear
   *  (the set tab's per-piece marks). All three come straight off IWorld. */
  ownedBuddyKeys(): ReadonlySet<string>;
  ownedMountKeys(): ReadonlySet<string>;
  ownedItemIds(): ReadonlySet<string>;
  /** key -> renderer visual key for mount rows (src/render/mount_visuals.ts). */
  buddyVisualKeys(): Readonly<Partial<Record<string, string>>>;
  mountVisualKeys(): Readonly<Partial<Record<string, string>>>;
  /** Lowest live $WOC Exchange buy-now price per item id, in USD cents. Null
   *  when the Exchange is not attached on this build (desktop, native, offline),
   *  which the pane says outright rather than showing a blank price. */
  exchangeLowestCents?: (itemIds: readonly string[]) => Promise<Map<string, number>> | null;
}

const TAB_LABEL: Record<CollectionsTabId, TranslationKey> = {
  buddies: 'hudChrome.collections.tabs.buddies',
  mounts: 'hudChrome.collections.tabs.mounts',
  sets: 'hudChrome.collections.tabs.sets',
};

const ARMOR_LABEL: Record<ArmorType, TranslationKey> = {
  cloth: 'hudChrome.collections.armor.cloth',
  mail: 'hudChrome.collections.armor.mail',
  leather: 'hudChrome.collections.armor.leather',
};

const STAT_LABEL: Record<CollectionSetStat, TranslationKey> = {
  intellect: 'hudChrome.collections.stat.intellect',
  agility: 'hudChrome.collections.stat.agility',
  strength: 'hudChrome.collections.stat.strength',
  mixed: 'hudChrome.collections.stat.mixed',
};

/** Flavour text per companion. A typed map rather than a built key: tsc names
 *  the buddy that lost its blurb, instead of a missing string appearing live. */
const BUDDY_LORE: Readonly<Record<string, TranslationKey>> = {
  ember_fox: 'hudChrome.collections.buddyLore.ember_fox',
  moss_hare: 'hudChrome.collections.buddyLore.moss_hare',
  frog: 'hudChrome.collections.buddyLore.frog',
  crimson_claw_crab: 'hudChrome.collections.buddyLore.crimson_claw_crab',
  golden_sentinel: 'hudChrome.collections.buddyLore.golden_sentinel',
  nightfang: 'hudChrome.collections.buddyLore.nightfang',
  tuskhorn_boar: 'hudChrome.collections.buddyLore.tuskhorn_boar',
  emerald_wolf: 'hudChrome.collections.buddyLore.emerald_wolf',
  tiger: 'hudChrome.collections.buddyLore.tiger',
  cate_coin: 'hudChrome.collections.buddyLore.cate_coin',
  alon: 'hudChrome.collections.buddyLore.alon',
  trollface: 'hudChrome.collections.buddyLore.trollface',
  ansem: 'hudChrome.collections.buddyLore.ansem',
  triple_t: 'hudChrome.collections.buddyLore.triple_t',
  kekius: 'hudChrome.collections.buddyLore.kekius',
  solbot: 'hudChrome.collections.buddyLore.solbot',
  frostfire: 'hudChrome.collections.buddyLore.frostfire',
  rocky: 'hudChrome.collections.buddyLore.rocky',
  proud_grunt: 'hudChrome.collections.buddyLore.proud_grunt',
  loot_goblin: 'hudChrome.collections.buddyLore.loot_goblin',
  penny_goldspark: 'hudChrome.collections.buddyLore.penny_goldspark',
  stag: 'hudChrome.collections.buddyLore.stag',
  alpaca: 'hudChrome.collections.buddyLore.alpaca',
  bull: 'hudChrome.collections.buddyLore.bull',
  spider: 'hudChrome.collections.buddyLore.spider',
  raptor: 'hudChrome.collections.buddyLore.raptor',
  skeleton: 'hudChrome.collections.buddyLore.skeleton',
  crystal_lich: 'hudChrome.collections.buddyLore.crystal_lich',
  forgemaw: 'hudChrome.collections.buddyLore.forgemaw',
  crystal_tide: 'hudChrome.collections.buddyLore.crystal_tide',
  phantom: 'hudChrome.collections.buddyLore.phantom',
};

const PET_KIND_LABEL: Record<CollectionPetKind, TranslationKey> = {
  beast: 'hudChrome.collections.petKind.beast',
  elemental: 'hudChrome.collections.petKind.elemental',
  humanoid: 'hudChrome.collections.petKind.humanoid',
  undead: 'hudChrome.collections.petKind.undead',
  celebrity: 'hudChrome.collections.petKind.celebrity',
};

/** The authored text of one set bonus tier, through the same entity key the
 *  item tooltip reads, so this window can never word a bonus differently from
 *  the tooltip beside it. */
function setBonusText(setId: string, pieces: number): string {
  return tEntity({ kind: 'itemSet', id: setId, field: itemSetBonusField(pieces) });
}

const num = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

/** A per-kill drop chance as a percent string; small odds keep two decimals so
 *  a 1.5% tier and a 0.1% boss drop do not both render as "2%". */
function pct(chance: number): string {
  return formatNumber(chance * 100, { maximumFractionDigits: chance < 0.01 ? 2 : 1 });
}

function usd(cents: number): string {
  return formatNumber(cents / 100, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

/** Which drop sentence a row takes: heroic-only tables, rows that drop at a
 *  second rate under a heroic claim (LootEntry.heroicChance), and the ordinary
 *  one-rate row. A player planning a farm needs to see BOTH rates when the row
 *  carries two, or the harder kill looks like the same odds. */
function dropKey(drop: CollectionDropSource): TranslationKey {
  if (drop.heroicOnly) return 'hudChrome.collections.detail.heroicDrop';
  if (drop.heroicChance !== null) return 'hudChrome.collections.detail.dropWithHeroic';
  return 'hudChrome.collections.detail.drop';
}

function iconHtml(itemId: string | null, quality: string): string {
  if (!itemId) return '<span class="item-icon q-common col-noart"></span>';
  return itemIconImgHtml(`/ui/items/${itemId}.webp`, quality);
}

export class CollectionsWindow {
  private tab: CollectionsTabId = 'buddies';
  /** The selected row's key, per tab, so switching tabs and back keeps place. */
  private selected: Partial<Record<CollectionsTabId, string>> = {};
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  /** Lowest Exchange price in USD cents, by item id, for the current selection. */
  private exchangePrices = new Map<string, number>();
  /** The selection the exchange prices above were fetched for, so a late
   *  response can never paint onto a different row. */
  private exchangeFetchedFor = '';
  /** False once a lookup has answered "there is no Exchange here" (a wrapped
   *  shell, or offline). Distinct from an empty price map, which means the
   *  Exchange answered and nothing is listed. */
  private exchangeAvailable = true;
  /** How far each tab's catalog list is scrolled. render() rebuilds the whole
   *  panel's innerHTML, which throws the scroller away and its offset with it,
   *  so without this a click on a row two screens down would snap the player
   *  back to the top of the catalog. Per tab, because each tab is its own
   *  list and its own place. */
  private listScroll: Partial<Record<CollectionsTabId, number>> = {};
  /** The tab the CURRENT DOM belongs to, so an offset read off the live
   *  scroller is filed under the list it actually came from: a tab switch
   *  repaints a different tab into the same node in the same frame. */
  private paintedTab: CollectionsTabId | null = null;

  constructor(private readonly deps: CollectionsWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'collections-title' });
    root.style.display = 'block';
    this.lastSig = '';
    this.render();
    (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    el.style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /** Re-localize the open window after an in-game language switch: the skip
   *  signature is text-independent, so clear it and rebuild exactly once. */
  relocalize(): void {
    if (!this.isOpen) return;
    this.lastSig = '';
    this.render();
  }

  /** The whole view model, rebuilt from the live ownership reads. Cheap
   *  enough for the repaint band: the catalogs are static and every row's
   *  source derivation is memoized by collection_sources.ts. */
  private collections(): CollectionsView {
    return buildCollectionsView({
      ownedBuddyKeys: this.deps.ownedBuddyKeys(),
      ownedMountKeys: this.deps.ownedMountKeys(),
      ownedItemIds: this.deps.ownedItemIds(),
      buddyVisualKeys: this.deps.buddyVisualKeys(),
      mountVisualKeys: this.deps.mountVisualKeys(),
    });
  }

  render(): void {
    if (!this.isOpen) return;
    const view = this.collections();
    const rows = this.tab === 'mounts' ? view.mounts : view.buddies;
    const selectedKey = this.selected[this.tab] ?? this.defaultSelection(view, rows);
    this.selected[this.tab] = selectedKey;
    // Signature: what actually changes the painted DOM. Ownership counts move
    // when a whistle is looted, the selection moves on a click, and the
    // exchange map fills on a late fetch; nothing else does, so the 250ms
    // repaint band rebuilds only when one of those happens.
    const sig = JSON.stringify([
      this.tab,
      selectedKey,
      view.buddies.filter((row) => row.owned).length,
      view.mounts.filter((row) => row.owned).length,
      view.setGroups.reduce((sum, group) => sum + group.sets.length, 0),
      [...this.exchangePrices].sort(),
    ]);
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    const root = this.deps.root();
    this.rememberListScroll(root);
    root.innerHTML = `
      <div class="panel-title">
        <span id="collections-title">${esc(t('hudChrome.collections.title'))}</span>
        <button type="button" class="x-btn" data-close
          aria-label="${esc(t('hudChrome.collections.close'))}">${svgIcon('close')}</button>
      </div>
      <div class="col-tabs" role="tablist">
        ${COLLECTIONS_TABS.map(
          (tab) => `
          <button type="button" role="tab" class="col-tab${tab === this.tab ? ' active' : ''}"
            aria-selected="${tab === this.tab}" data-tab="${tab}">${esc(t(TAB_LABEL[tab]))}</button>`,
        ).join('')}
      </div>
      <div class="col-body">
        <div class="col-list" role="list">${
          this.tab === 'sets'
            ? this.setListHtml(view.setGroups, selectedKey)
            : this.tab === 'buddies'
              ? this.buddyListHtml(view.buddyGroups, selectedKey)
              : this.entryListHtml(rows, selectedKey)
        }</div>
        <div class="col-detail">${
          this.tab === 'sets'
            ? this.setDetailHtml(
                view.setGroups.flatMap((group) => group.sets),
                selectedKey,
              )
            : this.entryDetailHtml(rows, selectedKey)
        }</div>
      </div>`;
    this.wire(root);
    this.restoreListScroll(root);
  }

  /** Read the live scroller before innerHTML drops it. */
  private rememberListScroll(root: HTMLElement): void {
    if (this.paintedTab === null) return;
    const list = root.querySelector<HTMLElement>('.col-list');
    if (list) this.listScroll[this.paintedTab] = list.scrollTop;
  }

  /** Put the new scroller back where the old one stood. A shorter list clamps
   *  itself, so a tab whose catalog shrank lands at its own bottom rather than
   *  out of range. */
  private restoreListScroll(root: HTMLElement): void {
    this.paintedTab = this.tab;
    const top = this.listScroll[this.tab] ?? 0;
    if (top <= 0) return;
    const list = root.querySelector<HTMLElement>('.col-list');
    if (list) list.scrollTop = top;
  }

  private defaultSelection(view: CollectionsView, rows: CollectionEntryView[]): string {
    if (this.tab === 'sets') return view.setGroups[0]?.sets[0]?.setId ?? '';
    return rows[0]?.key ?? '';
  }

  /** The buddy tab: one heading per pet kind, rows already in rarity order
   *  (the view core sorts them, so the painter never re-decides). */
  private buddyListHtml(groups: readonly CollectionPetGroupView[], selectedKey: string): string {
    return groups
      .map(
        (group) => `
        <div class="col-group">
          <h3 class="col-group-head">${esc(t(PET_KIND_LABEL[group.kind]))}</h3>
          ${this.entryListHtml(group.entries, selectedKey)}
        </div>`,
      )
      .join('');
  }

  private entryListHtml(rows: readonly CollectionEntryView[], selectedKey: string): string {
    return rows
      .map((row) => {
        const state = row.owned
          ? 'hudChrome.collections.state.owned'
          : row.obtainable
            ? 'hudChrome.collections.state.notOwned'
            : 'hudChrome.collections.state.unavailable';
        const name = row.itemId ? itemDisplayName(ITEMS[row.itemId]) : row.name;
        return `
        <button type="button" role="listitem" data-key="${esc(row.key)}"
          class="col-row${row.key === selectedKey ? ' active' : ''}${row.obtainable ? '' : ' col-locked'}">
          ${iconHtml(row.itemId, row.quality)}
          <span class="col-row-name q-${esc(row.quality)}">${esc(name)}</span>
          <span class="col-row-state">${esc(t(state as TranslationKey))}</span>
        </button>`;
      })
      .join('');
  }

  private setListHtml(groups: CollectionsView['setGroups'], selectedKey: string): string {
    return groups
      .map(
        (group) => `
        <div class="col-group">
          <h3 class="col-group-head">${esc(t(ARMOR_LABEL[group.armorType]))} &middot; ${esc(
            t(STAT_LABEL[group.stat]),
          )}</h3>
          ${group.sets
            .map(
              (set) => `
            <button type="button" data-key="${esc(set.setId)}"
              class="col-row${set.setId === selectedKey ? ' active' : ''}">
              <span class="col-row-name q-${esc(set.quality)}">${esc(set.name)}${
                set.itemLevel === undefined
                  ? ''
                  : ` <span class="col-ilvl">${esc(
                      t('hudChrome.collections.set.itemLevel', { level: num(set.itemLevel) }),
                    )}</span>`
              }</span>
              <span class="col-row-state">${esc(
                t('hudChrome.collections.set.owned', {
                  owned: num(set.ownedCount),
                  total: num(set.pieces.length),
                }),
              )}</span>
            </button>`,
            )
            .join('')}
        </div>`,
      )
      .join('');
  }

  /** The source, bind and price lines shared by every detail pane. */
  private factsHtml(facts: CollectionItemFacts | null): string {
    if (!facts) {
      return `<p class="col-note">${esc(t('hudChrome.collections.detail.noItem'))}</p>`;
    }
    const lines: string[] = [];
    if (facts.globalDrop) {
      lines.push(
        this.line(
          'hudChrome.collections.detail.dropLabel',
          t('hudChrome.collections.detail.globalDrop', {
            chance: pct(facts.globalDrop.chance),
            count: num(facts.globalDrop.poolSize),
          }),
        ),
      );
    }
    if (facts.fishingDrop !== null) {
      lines.push(
        this.line(
          'hudChrome.collections.detail.dropLabel',
          t('hudChrome.collections.detail.fishingDrop', { chance: pct(facts.fishingDrop) }),
        ),
      );
    }
    for (const drop of facts.drops) {
      lines.push(
        this.line(
          'hudChrome.collections.detail.dropLabel',
          t(dropKey(drop), {
            mob: drop.mobName,
            location: drop.location,
            chance: pct(drop.chance),
            heroicChance: drop.heroicChance === null ? '' : pct(drop.heroicChance),
          }),
        ),
      );
    }
    for (const vendor of facts.vendors) {
      const price =
        vendor.currency === 'gold'
          ? formatMoney(vendor.price)
          : t(
              vendor.currency === 'honor'
                ? 'hudChrome.collections.detail.honorPrice'
                : 'hudChrome.collections.detail.marksPrice',
              { amount: num(vendor.price) },
            );
      lines.push(
        this.line(
          'hudChrome.collections.detail.vendorLabel',
          t('hudChrome.collections.detail.vendor', {
            npc: vendor.npcName,
            location: vendor.zoneName,
            price,
          }),
        ),
      );
    }
    if (lines.length === 0) {
      lines.push(
        this.line(
          'hudChrome.collections.detail.dropLabel',
          t('hudChrome.collections.detail.noSource'),
        ),
      );
    }
    lines.push(
      this.line(
        'hudChrome.collections.detail.bindLabel',
        t(
          facts.tradeable
            ? 'hudChrome.collections.detail.tradeable'
            : 'hudChrome.collections.detail.soulbound',
        ),
      ),
      this.line(
        'hudChrome.collections.detail.sellLabel',
        facts.sellValue === null
          ? t('hudChrome.collections.detail.noSell')
          : formatMoney(facts.sellValue),
      ),
    );
    return lines.join('');
  }

  private line(label: TranslationKey, value: string): string {
    return `<p class="col-line"><span class="col-line-label">${esc(t(label))}</span><span class="col-line-value">${esc(value)}</span></p>`;
  }

  private entryDetailHtml(rows: readonly CollectionEntryView[], selectedKey: string): string {
    const row = rows.find((candidate) => candidate.key === selectedKey);
    if (!row) return '';
    const name = row.itemId ? itemDisplayName(ITEMS[row.itemId]) : row.name;
    const loreKey = BUDDY_LORE[row.key];
    const lore = loreKey ? `<p class="col-lore">${esc(t(loreKey))}</p>` : '';
    return `
      <div class="col-preview" data-preview="${esc(row.visualKey ?? '')}" data-tint="${row.tint}"></div>
      <h3 class="col-detail-name q-${esc(row.quality)}">${esc(name)}</h3>
      ${lore}
      ${this.factsHtml(row.facts)}`;
  }

  private setDetailHtml(sets: readonly CollectionSetView[], selectedKey: string): string {
    const set = sets.find((candidate) => candidate.setId === selectedKey);
    if (!set) return '';
    const pieces = set.pieces
      .map((piece) => {
        const cents = this.exchangePrices.get(piece.itemId);
        const exchange = !this.exchangeAvailable
          ? t('hudChrome.collections.detail.exchangeUnavailable')
          : cents === undefined
            ? t('hudChrome.collections.detail.exchangeNone')
            : usd(cents);
        const level =
          piece.itemLevel === undefined
            ? ''
            : ` <span class="col-ilvl">${esc(t('hudChrome.collections.set.itemLevel', { level: num(piece.itemLevel) }))}</span>`;
        const tick = piece.owned ? '<span class="col-tick" aria-hidden="true">&#10003;</span>' : '';
        return `
        <li class="col-piece${piece.owned ? ' col-owned' : ''}" data-item="${esc(piece.itemId)}">
          ${iconHtml(piece.itemId, set.quality)}
          <span class="col-row-name q-${esc(set.quality)}">${tick}${esc(itemDisplayName(ITEMS[piece.itemId]))}${level}</span>
          ${this.factsHtml(piece.facts)}
          ${this.line('hudChrome.collections.detail.marketLabel', this.marketPriceText(piece.itemId))}
          ${this.line('hudChrome.collections.detail.exchangeLabel', exchange)}
        </li>`;
      })
      .join('');
    const bonuses = set.bonuses
      .map(
        (tier) => `
        <p class="col-line col-bonus${tier.owned ? ' col-bonus-live' : ''}">
          <span class="col-line-label">${esc(t('hudChrome.collections.set.bonusLabel', { pieces: num(tier.pieces) }))}</span>
          <span class="col-line-value">${esc(setBonusText(set.setId, tier.pieces))}</span>
        </p>`,
      )
      .join('');
    return `
      <h3 class="col-detail-name q-${esc(set.quality)}">${esc(set.name)}</h3>
      <p class="col-line"><span class="col-line-label">${esc(
        t('hudChrome.collections.detail.setLabel'),
      )}</span><span class="col-line-value">${esc(
        t('hudChrome.collections.set.owned', {
          owned: num(set.ownedCount),
          total: num(set.pieces.length),
        }) +
          (set.itemLevel === undefined
            ? ''
            : ` ${t('hudChrome.collections.set.itemLevel', { level: num(set.itemLevel) })}`),
      )}</span></p>
      ${bonuses}
      <ul class="col-pieces">${pieces}</ul>`;
  }

  /** The World Market's lowest live listing, which the server only streams for
   *  the item the player has staged AT the Merchant. Away from the Merchant the
   *  pane says where the figure comes from instead of showing a stale one. */
  private marketPriceText(itemId: string): string {
    const info = this.deps.world().marketInfo;
    if (!info) return t('hudChrome.collections.detail.marketAtMerchant');
    if (info.sellPriceItemId !== itemId) {
      this.deps.world().marketSellPriceCheck(itemId);
      return t('hudChrome.collections.detail.marketChecking');
    }
    return info.sellLowestPrice === null
      ? t('hudChrome.collections.detail.marketNone')
      : formatMoney(info.sellLowestPrice);
  }

  private wire(root: HTMLElement): void {
    for (const button of root.querySelectorAll<HTMLElement>('[data-tab]')) {
      button.addEventListener('click', () => {
        const tab = button.dataset.tab as CollectionsTabId;
        if (tab === this.tab) return;
        this.tab = tab;
        this.lastSig = '';
        audio.click();
        this.render();
        // Price the tab's opening selection too, so the Exchange row answers on
        // arrival rather than only after the first row click.
        if (tab === 'sets') this.fetchExchangePrices(this.selected.sets ?? '');
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>('[data-key]')) {
      button.addEventListener('click', () => {
        const key = button.dataset.key ?? '';
        if (this.selected[this.tab] === key) return;
        this.selected[this.tab] = key;
        this.lastSig = '';
        audio.click();
        this.render();
        if (this.tab === 'sets') this.fetchExchangePrices(key);
      });
    }
    // The real item tooltip, the same markup the bags and the vendor grid
    // show: hovering a set piece here answers stats, bonuses and compare
    // without the player leaving the window.
    for (const row of root.querySelectorAll<HTMLElement>('[data-item]')) {
      const item = ITEMS[row.dataset.item ?? ''];
      if (!item) continue;
      this.deps.attachTooltip(row, () => this.deps.itemTooltip(item));
    }
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    const preview = root.querySelector<HTMLElement>('[data-preview]');
    const visualKey = preview?.dataset.preview ?? '';
    if (preview && visualKey) {
      this.deps.mountPreview(
        preview,
        visualKey,
        this.tab === 'mounts' ? 'mount' : 'buddy',
        Number(preview.dataset.tint ?? 0xffffff),
      );
    }
  }

  /** One Exchange browse for the selected set's pieces, lowest buy-now first.
   *  Bounded to the SELECTION on purpose (see the module header) and guarded by
   *  the selection it was issued for, so a slow response cannot paint onto a
   *  row the player has already left. */
  private fetchExchangePrices(setId: string): void {
    const lookup = this.deps.exchangeLowestCents;
    if (!lookup) return;
    const view = this.collections();
    const set = view.setGroups.flatMap((group) => group.sets).find((s) => s.setId === setId);
    if (!set) return;
    this.exchangeFetchedFor = setId;
    const pending = lookup(set.pieces.map((piece) => piece.itemId));
    if (!pending) {
      // No Exchange attached (a wrapped shell, or offline): say so on the row
      // rather than leaving the previous selection's prices standing under a
      // different set's pieces.
      this.exchangeAvailable = false;
      this.exchangePrices = new Map();
      this.lastSig = '';
      this.render();
      return;
    }
    this.exchangeAvailable = true;
    void pending
      .then((prices) => {
        if (this.exchangeFetchedFor !== setId || !this.isOpen) return;
        this.exchangePrices = prices;
        this.lastSig = '';
        this.render();
      })
      .catch((err) => console.error('collections: exchange price lookup failed:', err));
  }
}
