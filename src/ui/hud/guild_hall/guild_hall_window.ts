// Thin DOM painter for Lantern Hall's guild window (#guild-hall-window).
//
// The consumer half of the pure-core + thin-painter split: guild_hall_view.ts decides what
// every contract notice says and guild_quartermaster_view.ts what the quartermaster's counter
// says; this module owns the window lifecycle (open on a resident's event, on the tab that
// resident keeps; close; focus return), the tab switch, the selected stock card, the one
// wall-clock read (the reset countdown), the hover cards, and the click that sends a purchase
// through IWorld. It holds no Sim reference and reaches Hud only through its deps.
//
// The contracts tab is a notice board: each contract a pinned parchment with its boss's
// portrait (the dungeon finder's prerendered stills, no live scene), the guild's wax seal, the
// week's counter and the reward. The quartermaster tab is a vendor counter: item cards on the
// left, the selected card's detail on the right. A title's preview is the nameplate it draws;
// the war horse and the weapon appearances get a live 3D stage (guild_offer_stage_controller.ts, over the
// preview hosts that already exist: no renderer of this window's own).
import { audio } from '../../../game/audio';
import { LANTERN_SEAL_ITEM_ID } from '../../../sim/content/guild_contracts';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { esc } from '../../esc';
import { focusedWithin, restoreFirstEnabled } from '../../focus_restore';
import { t } from '../../i18n';
import { iconDataUrl, itemImageUrl } from '../../icons';
import { svgIcon } from '../../ui_icons';
import { armorySkinArt } from '../../woc_store_view';
import {
  buildGuildHallView,
  type GuildContractCardView,
  type GuildHallTab,
  type GuildHallView,
  guildResetText,
  guildShopInput,
  lanternSeals,
} from './guild_hall_view';
import { GuildOfferStage } from './guild_offer_stage_controller';
import {
  type GuildShopArt,
  type GuildShopDetailView,
  type GuildShopItemView,
  guildShopOwnedFlags,
  guildShopTooltip,
} from './guild_quartermaster_view';

const PANEL_ID = 'guild-hall-panel';
const TABS: readonly GuildHallTab[] = ['contracts', 'quartermaster'];
/** Crest art sizes (device px the procedural crest is rasterized at): the card, the detail. */
const CARD_CREST_PX = 64;
const DETAIL_CREST_PX = 128;

export interface GuildHallWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** The HUD's shared hover card (Hud.attachTooltip); absent in a bare test mount. */
  attachTooltip?(el: HTMLElement, html: () => string): void;
  /** Mount Hud's shared character turntable into a stage, holding a weapon appearance
   *  (Hud.mountCharPreview's try-on); absent in a bare test mount. */
  tryOnWeaponSkin?(stage: HTMLElement, skinId: string): void;
}

export class GuildHallWindow {
  private opened = false;
  private tab: GuildHallTab = 'contracts';
  /** The quartermaster card the detail shows (null: the core's default, the next to buy). */
  private selectedOffer: string | null = null;
  private lastSig = '';
  private lastMinute = -1;
  private openerFocus: HTMLElement | null = null;
  /** The selected horse's or appearance's live 3D stage (kept across rebuilds). */
  private readonly stage: GuildOfferStage;

  constructor(private readonly deps: GuildHallWindowDeps) {
    this.stage = new GuildOfferStage({
      world: () => deps.world(),
      tryOnWeaponSkin: deps.tryOnWeaponSkin,
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** A resident's talk event: open (or repaint) the window on that resident's tab. */
  open(tab: GuildHallTab = 'contracts'): void {
    if (!this.opened) {
      this.deps.closeOthers();
      this.openerFocus = this.deps.captureFocus();
      this.opened = true;
      this.selectedOffer = null;
      audio.bagOpen();
    }
    this.tab = tab;
    this.lastSig = this.sig();
    this.render('open');
    this.deps.root().style.display = 'flex';
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.stage.hide();
    this.deps.root().style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  // The repaint signature: the board and progress, the seals, the offers owned (a title, the
  // horse, an appearance), the tab and the selected card; the countdown updates its own text
  // on its minute cadence below, so it stays out of it.
  private sig(): string {
    const world = this.deps.world();
    const seals = lanternSeals(world.inventory);
    const owned = guildShopOwnedFlags(guildShopInput(world, seals));
    return JSON.stringify([
      world.guildContracts,
      seals,
      owned,
      world.ridingTrained(),
      world.weeklyQuestResetAtMs,
      this.tab,
      this.selectedOffer,
    ]);
  }

  /** Language fan-out arm: the sheet is signature-gated on locale-free data, so a switch
   *  rebuilds it once here and re-latches the signature. */
  relocalize(): void {
    if (!this.opened) return;
    this.lastSig = this.sig();
    this.render(null);
  }

  /** Slow-band refresh: rebuild when the board, the bags or the Book change; once a minute
   *  only the countdown's text moves, so focus and the rest of the sheet stay put. */
  refreshIfChanged(): void {
    if (!this.opened) return;
    this.tickClock();
    const sig = this.sig();
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.render(null);
  }

  /** The countdown's own minute cadence: rewrite its text node, nothing else. */
  private tickClock(): void {
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    if (minute === this.lastMinute) return;
    this.lastMinute = minute;
    const reset = this.deps.root().querySelector('.gh-reset');
    if (reset) reset.textContent = guildResetText(this.deps.world().weeklyQuestResetAtMs, now);
  }

  private switchTab(next: GuildHallTab): void {
    if (next === this.tab) return;
    this.tab = next;
    this.lastSig = this.sig();
    this.render('tab');
  }

  private select(offerId: string): void {
    if (offerId === this.selectedOffer) return;
    this.selectedOffer = offerId;
    this.lastSig = this.sig();
    // a press rebuilt the sheet: the card's twin takes focus without popping its hover card
    this.render(null, true);
  }

  /** The key of the control holding focus, so a rebuild can hand focus back to its twin. */
  private focusedKey(root: HTMLElement): string | null {
    // focusedWithin refuses a parked dialog root, so a parked sheet resolves nothing
    const active = focusedWithin(root);
    if (!active) return null;
    if (active.dataset.ghTab) return `[data-gh-tab="${active.dataset.ghTab}"]`;
    if (active.dataset.ghBuy) return `[data-gh-buy="${active.dataset.ghBuy}"]`;
    if (active.dataset.ghOffer) return `[data-gh-offer="${active.dataset.ghOffer}"]`;
    if (active.hasAttribute('data-gh-seals')) return '[data-gh-seals]';
    if (active.hasAttribute('data-close')) return '[data-close]';
    return null;
  }

  private render(focus: 'open' | 'tab' | null, pressed = false): void {
    const root = this.deps.root();
    const world = this.deps.world();
    const keep = focus === null ? this.focusedKey(root) : null;
    const now = Date.now();
    this.lastMinute = Math.floor(now / 60_000);
    const view = buildGuildHallView(world, now, this.tab, this.selectedOffer);
    markDialogRoot(root, { labelledBy: 'guild-hall-title' });
    // a WAI-ARIA tablist with roving tabindex, controlling the one tabpanel below
    const tabs = view.tabs
      .map(
        (tab) =>
          `<button type="button" class="gh-tab" role="tab" id="guild-hall-tab-${esc(tab.id)}" aria-selected="${tab.selected}" tabindex="${tab.selected ? '0' : '-1'}" aria-controls="${PANEL_ID}" data-gh-tab="${esc(tab.id)}">${esc(tab.label)}</button>`,
      )
      .join('');
    const body = this.tab === 'contracts' ? this.boardHtml(view) : this.shopHtml(view);
    root.innerHTML =
      `<div class="panel-title gh-title"><span id="guild-hall-title">${esc(view.title)}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.guildHall.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="gh-tabs" role="tablist" aria-label="${esc(t('hudChrome.guildHall.tabsLabel'))}">${tabs}</div>` +
      `<div class="gh-panel" role="tabpanel" id="${PANEL_ID}" aria-labelledby="guild-hall-tab-${esc(this.tab)}">` +
      `<div class="gh-sub"><button type="button" class="gh-seals" data-gh-seals aria-describedby="gh-seals-tip">${this.sealIcon('gh-seal-icon')}<span>${esc(view.sealsText)}</span></button>` +
      `<span class="visually-hidden" id="gh-seals-tip">${esc(view.sealsTip)}</span>` +
      `<span class="gh-reset">${esc(view.resetText)}</span></div>` +
      `<p class="gh-intro">${esc(view.intro)}</p>` +
      body +
      `</div>`;
    this.placeStage(root, view);
    this.wire(root, world, view);
    const target =
      focus === 'open' ? '[data-close]' : focus === 'tab' ? `[data-gh-tab="${this.tab}"]` : keep;
    if (!target) return;
    const twin = root.querySelector<HTMLButtonElement>(target);
    // attachTooltip's own side channel (Hud): the focus a press hands the rebuilt twin is not
    // a keyboard arrival, so it shows no hover card
    if (pressed && twin) twin.dataset.suppressFocusTooltip = 'true';
    // a control the rebuild disabled (a title just bought) hands focus to Close
    restoreFirstEnabled([twin, root.querySelector<HTMLButtonElement>('[data-close]')]);
  }

  /** Stage the selected horse or appearance in the rebuilt detail's slot, or leave the stage
   *  (a title, the contracts tab, an empty stock). */
  private placeStage(root: HTMLElement, view: GuildHallView): void {
    const detail = this.tab === 'quartermaster' ? view.shop.detail : null;
    const slot = root.querySelector<HTMLElement>('[data-gh-stage-slot]');
    if (!detail || detail.stage.kind === 'plate' || !slot) {
      this.stage.hide();
      return;
    }
    this.stage.show(
      slot,
      detail.stage,
      t('hudChrome.guildHall.shop.stageLabel', { name: detail.name }),
    );
  }

  private wire(root: HTMLElement, world: IWorld, view: GuildHallView): void {
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    root.querySelectorAll<HTMLButtonElement>('[data-gh-tab]').forEach((button) => {
      const own: GuildHallTab =
        button.dataset.ghTab === 'quartermaster' ? 'quartermaster' : 'contracts';
      button.addEventListener('click', () => this.switchTab(own));
      // roving focus: the arrows, Home and End move along the strip (selection follows focus)
      button.addEventListener('keydown', (event) => {
        const at = TABS.indexOf(own);
        let next = -1;
        if (event.key === 'ArrowRight') next = (at + 1) % TABS.length;
        else if (event.key === 'ArrowLeft') next = (at - 1 + TABS.length) % TABS.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = TABS.length - 1;
        if (next < 0) return;
        event.preventDefault();
        this.switchTab(TABS[next]);
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-gh-offer]').forEach((card) => {
      const offerId = card.dataset.ghOffer ?? '';
      card.addEventListener('click', () => this.select(offerId));
      this.deps.attachTooltip?.(card, () => this.offerTipHtml(offerId));
    });
    root.querySelectorAll<HTMLButtonElement>('[data-gh-buy]').forEach((button) => {
      button.addEventListener('click', () => {
        const offerId = button.dataset.ghBuy;
        if (offerId) world.buyGuildCosmetic(offerId);
      });
    });
    const seals = root.querySelector<HTMLElement>('.gh-seals');
    if (seals) {
      const tip = view.sealsTip;
      this.deps.attachTooltip?.(
        seals,
        () =>
          `<div class="tt-title">${esc(view.sealsText)}</div><div class="tt-desc">${esc(tip)}</div>`,
      );
    }
  }

  /** The Lantern Seal's painted coin (decorative: the text beside it names it). */
  private sealIcon(cls: string): string {
    const url = itemImageUrl(LANTERN_SEAL_ITEM_ID);
    return url ? `<img class="${cls}" src="${esc(url)}" alt="" decoding="async">` : '';
  }

  // ---- the contract board ----------------------------------------------------------------

  private boardHtml(view: GuildHallView): string {
    const pips = view.contracts
      .map((card) => `<span class="gh-pip${card.done ? ' gh-pip-done' : ''}"></span>`)
      .join('');
    const tally =
      view.weekTotal > 0
        ? `<div class="gh-tally"><span class="gh-tally-text">${esc(view.weekProgressText)}</span>` +
          `<span class="gh-pips" role="progressbar" aria-label="${esc(view.weekProgressAria)}" aria-valuemin="0" aria-valuemax="${view.weekTotal}" aria-valuenow="${view.weekDone}" aria-valuetext="${esc(view.weekProgressText)}">${pips}</span></div>`
        : '';
    return (
      `<div class="gh-board">` +
      tally +
      `<div class="gh-cards" role="list" aria-label="${esc(view.noticesLabel)}">${view.contracts.map((card) => this.cardHtml(card)).join('')}</div>` +
      (view.emptyText ? `<p class="gh-empty">${esc(view.emptyText)}</p>` : '') +
      `<div class="gh-foot">${esc(view.lifetimeText)}</div>` +
      `</div>`
    );
  }

  private cardHtml(card: GuildContractCardView): string {
    const pips = Array.from(
      { length: card.progressTotal },
      (_, i) => `<span class="gh-pip${i < card.progressDone ? ' gh-pip-done' : ''}"></span>`,
    ).join('');
    return (
      `<article class="gh-card gh-card-${esc(card.kind)}${card.done ? ' gh-card-done' : ''}" role="listitem" data-gh-card="${esc(card.id)}">` +
      `<span class="gh-pin" aria-hidden="true"></span>` +
      `<div class="gh-ribbon"><span class="gh-kind">${esc(card.kindLabel)}</span></div>` +
      `<div class="gh-portrait"><img src="${esc(card.portraitUrl)}" width="96" height="96" loading="lazy" decoding="async" alt=""></div>` +
      `<h3 class="gh-boss" id="gh-boss-${esc(card.id)}">${esc(card.boss)}</h3>` +
      `<div class="gh-dungeon">${esc(card.dungeon)}</div>` +
      `<div class="gh-rule" aria-hidden="true"></div>` +
      `<p class="gh-goal">${esc(card.goal)}</p>` +
      (card.detail ? `<p class="gh-detail">${esc(card.detail)}</p>` : '') +
      `<div class="gh-progress">` +
      `<div class="gh-progress-row"><span class="gh-state">${esc(card.stateLabel)}</span><span class="gh-count">${esc(card.progressText)}</span></div>` +
      `<span class="gh-pips gh-pips-card" role="progressbar" aria-labelledby="gh-boss-${esc(card.id)}" aria-valuemin="0" aria-valuemax="${card.progressTotal}" aria-valuenow="${card.progressDone}" aria-valuetext="${esc(card.progressText)}">${pips}</span>` +
      `</div>` +
      `<div class="gh-reward">${this.sealIcon('gh-reward-icon')}<span>${esc(card.rewardLine)}</span></div>` +
      `<span class="gh-wax" aria-hidden="true">${svgIcon(card.done ? 'check' : 'crown')}</span>` +
      (card.done
        ? `<span class="gh-stamp" aria-hidden="true">${esc(t('hudChrome.guildHall.board.stamp'))}</span>`
        : '') +
      `</article>`
    );
  }

  // ---- the quartermaster's counter --------------------------------------------------------

  private shopHtml(view: GuildHallView): string {
    const shop = view.shop;
    return (
      `<div class="gh-shop">` +
      `<div class="gh-stock" role="group" aria-label="${esc(shop.stockLabel)}">${shop.items.map((item) => this.itemHtml(item)).join('')}</div>` +
      (shop.detail ? this.detailHtml(shop.detail) : '') +
      `</div>`
    );
  }

  private itemHtml(item: GuildShopItemView): string {
    return (
      `<button type="button" class="gh-item gh-item-${item.state}${item.selected ? ' gh-item-selected' : ''}" data-gh-offer="${esc(item.id)}" aria-pressed="${item.selected}">` +
      `<span class="gh-slot gh-slot-${item.art.kind}">${this.artHtml(item.art, CARD_CREST_PX)}</span>` +
      `<span class="gh-item-text"><span class="gh-item-kind">${esc(item.kindLabel)}</span>` +
      `<span class="gh-item-name">${esc(item.name)}</span>` +
      `<span class="gh-tag">${this.sealIcon('gh-tag-icon')}<span aria-hidden="true">${esc(item.priceValue)}</span><span class="visually-hidden">${esc(item.price)}</span></span></span>` +
      `<span class="gh-chip gh-chip-${item.state}">${esc(item.stateLabel)}</span>` +
      `</button>`
    );
  }

  private detailHtml(detail: GuildShopDetailView): string {
    return (
      `<section class="gh-detail-pane gh-detail-${detail.state}" aria-labelledby="gh-detail-name">` +
      `<div class="gh-detail-head"><span class="gh-slot gh-slot-large gh-slot-${detail.art.kind}">${this.artHtml(detail.art, DETAIL_CREST_PX)}</span>` +
      `<div><div class="gh-item-kind">${esc(detail.kindLabel)}</div><h3 class="gh-detail-name" id="gh-detail-name">${esc(detail.name)}</h3></div></div>` +
      this.stageHtml(detail) +
      (detail.summary ? `<p class="gh-detail-summary">${esc(detail.summary)}</p>` : '') +
      `<p class="gh-detail-text">${esc(detail.howTo)}</p>` +
      (detail.cosmetic ? `<p class="gh-detail-note">${esc(detail.cosmetic)}</p>` : '') +
      `<div class="gh-buybar"><div class="gh-buy-price"><span class="gh-tag gh-tag-large">${this.sealIcon('gh-tag-icon')}<span aria-hidden="true">${esc(detail.priceValue)}</span></span>` +
      `<span class="visually-hidden">${esc(detail.priceText)}</span><span class="gh-have">${esc(detail.haveText)}</span></div>` +
      `<button type="button" class="gh-btn gh-buy" data-gh-buy="${esc(detail.id)}"${detail.shortText ? ' aria-describedby="gh-short"' : ''}${detail.actionEnabled ? '' : ' disabled'}>${esc(detail.action)}</button></div>` +
      (detail.shortText ? `<p class="gh-short" id="gh-short">${esc(detail.shortText)}</p>` : '') +
      `</section>`
    );
  }

  /** The preview: a title's nameplate in text, or the slot the live 3D stage drops into. */
  private stageHtml(detail: GuildShopDetailView): string {
    const stage = detail.stage;
    if (stage.kind !== 'plate') {
      return (
        `<div class="gh-plate-stage gh-model-stage"><div class="gh-plate-heading">${esc(stage.heading)}</div>` +
        `<div class="gh-stage-slot" data-gh-stage-slot></div></div>`
      );
    }
    return (
      `<div class="gh-plate-stage"><div class="gh-plate-heading">${esc(stage.heading)}</div>` +
      `<div class="gh-plate">${stage.pre ? `<span class="gh-plate-title">${esc(stage.pre)}</span>` : ''}` +
      `<span class="gh-plate-name">${esc(stage.name)}</span>` +
      `${stage.post ? `<span class="gh-plate-title">${esc(stage.post)}</span>` : ''}</div></div>`
    );
  }

  /** A card's art: the title's Book of Deeds crest, the reins' icon, the appearance's
   *  Armory card (decorative: the name beside it says what it is). */
  private artHtml(art: GuildShopArt, crestPx: number): string {
    const url =
      art.kind === 'crest'
        ? iconDataUrl('crest', art.id, crestPx)
        : art.kind === 'item'
          ? itemImageUrl(art.itemId)
          : armorySkinArt(art.skinId);
    return url ? `<img src="${esc(url)}" alt="" decoding="async">` : '';
  }

  /** A stock card's hover card, through the shared tooltip's classes. */
  private offerTipHtml(offerId: string): string {
    const world = this.deps.world();
    const tip = guildShopTooltip(offerId, guildShopInput(world, lanternSeals(world.inventory)));
    if (!tip) return '';
    return (
      `<div class="tt-title">${esc(tip.title)}</div>` +
      tip.lines.map((line) => `<div class="tt-${line.tone}">${esc(line.text)}</div>`).join('')
    );
  }
}
