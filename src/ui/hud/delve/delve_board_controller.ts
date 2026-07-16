import { COMPANION_UPGRADE_COSTS, DELVES, ITEMS } from '../../../sim/data';
import type { ItemDef, SimEvent } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import type { FocusTrapHandle } from '../../focus_manager';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { QUALITY_COLOR } from '../../icons';
import { svgIcon } from '../../ui_icons';

type DelveTier = 'normal' | 'heroic';
type DelveBoardTab = 'delve' | 'shop';

export interface DelveBoardControllerDeps {
  element: HTMLElement;
  world(): IWorld;
  openFocusTrap(): FocusTrapHandle;
  closeOtherWindows(selector: string): void;
  hideTooltip(): void;
  attachTooltip(element: HTMLElement, html: () => string): void;
  itemIcon(item: ItemDef): string;
  itemTooltip(item: ItemDef): string;
  delveName(delveId: string): string;
  preloadInterior(event: Extract<SimEvent, { type: 'delveEntered' }>): void;
}

/** Owns the delve board window, its local tab/tier state, and authoritative commands. */
export class DelveBoardController {
  private openNpcId: number | null = null;
  private selectedTier: DelveTier = 'normal';
  private tab: DelveBoardTab = 'delve';
  private trap: FocusTrapHandle | null = null;

  constructor(private readonly deps: DelveBoardControllerDeps) {}

  get isOpen(): boolean {
    return this.openNpcId !== null;
  }

  open(npcId: number): void {
    const world = this.deps.world();
    const npc = world.entities.get(npcId);
    if (npc?.kind !== 'npc') return;
    const delve = Object.values(DELVES).find(
      (candidate) => candidate.boardNpcId === npc.templateId,
    );
    if (!delve) return;
    if (this.deps.element.style.display !== 'block') this.trap = this.deps.openFocusTrap();
    this.openNpcId = npcId;
    this.selectedTier = 'normal';
    this.tab = 'delve';
    this.deps.closeOtherWindows('#delve-board');
    this.deps.element.style.display = 'block';
    this.render(true);
  }

  render(focus = false): void {
    const { element } = this.deps;
    const world = this.deps.world();
    if (this.openNpcId === null) {
      element.style.display = 'none';
      return;
    }
    const npc = world.entities.get(this.openNpcId);
    if (npc?.kind !== 'npc') {
      this.close();
      return;
    }
    const delve = Object.values(DELVES).find(
      (candidate) => candidate.boardNpcId === npc.templateId,
    );
    if (!delve) {
      this.close();
      return;
    }

    const delveName = this.deps.delveName(delve.id);
    const partySize = world.partyInfo?.members.length ?? 1;
    const partyTooLarge = partySize > delve.maxPlayers;
    const canEnter = world.player.level >= delve.minLevel && !partyTooLarge;
    const normalLabel = t('delveUi.board.tier.normal');
    const heroicLabel = t('delveUi.board.tier.heroic');
    const marks = formatNumber(world.delveMarks, { maximumFractionDigits: 0 });
    const tabButton = (id: DelveBoardTab, label: string): string =>
      `<button type="button" class="delve-tab${this.tab === id ? ' active' : ''}" role="tab" aria-selected="${this.tab === id}" data-board-tab="${id}">${esc(label)}</button>`;
    const body =
      this.tab === 'shop'
        ? this.shopBodyHtml(delve.id)
        : this.delveBodyHtml(
            delve.id,
            delve.autoCompanionId ?? 'companion_tessa',
            delveName,
            normalLabel,
            heroicLabel,
            canEnter,
          );
    element.innerHTML =
      `<div class="panel-title"><span>${esc(t('delveUi.board.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.dialog.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="delve-board-name">${esc(delveName)}</div>` +
      `<div class="delve-board-meta">${esc(t('delveUi.board.marks', { count: marks }))}</div>` +
      `<div class="delve-board-req${world.player.level >= delve.minLevel ? '' : ' req-unmet'}">${esc(t('delveUi.board.minLevel', { level: formatNumber(delve.minLevel, { maximumFractionDigits: 0 }) }))}</div>` +
      `<div class="delve-board-req${partyTooLarge ? ' req-unmet' : ''}">${esc(t('delveUi.board.partyTooLarge', { max: formatNumber(delve.maxPlayers, { maximumFractionDigits: 0 }) }))}</div>` +
      `<div class="delve-tabs" role="tablist" aria-label="${esc(t('delveUi.board.title'))}">${tabButton('delve', t('delveUi.board.tabDelve'))}${tabButton('shop', t('delveUi.board.tabShop'))}</div>` +
      `<div class="delve-board-body" role="tabpanel">${body}</div>`;

    element.querySelectorAll<HTMLElement>('[data-board-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = button.dataset.boardTab as DelveBoardTab;
        if (next === this.tab) return;
        this.tab = next;
        this.render(true);
      });
    });
    if (this.tab === 'shop') this.bindShopHandlers(delve.id);
    else this.bindDelveHandlers(delve.id);
    element.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    if (focus) {
      this.trap?.focusFirst(this.tab === 'shop' ? '.delve-shop-buy' : '.delve-enter-btn');
    }
  }

  close(restoreFocus = true): void {
    this.deps.element.style.display = 'none';
    this.openNpcId = null;
    this.deps.hideTooltip();
    this.trap?.release(restoreFocus);
    this.trap = null;
  }

  private delveBodyHtml(
    delveId: string,
    companionId: string,
    delveName: string,
    normalLabel: string,
    heroicLabel: string,
    canEnter: boolean,
  ): string {
    const world = this.deps.world();
    const companionRank = world.companionUpgrades[companionId] ?? 1;
    const rankLabel = t('delveUi.board.companion.rank', {
      rank: formatNumber(companionRank, { maximumFractionDigits: 0 }),
    });
    const maxRank = Math.max(...Object.keys(COMPANION_UPGRADE_COSTS).map(Number));
    const nextRank = companionRank + 1;
    const nextCost = COMPANION_UPGRADE_COSTS[nextRank];
    const companionNameKey = companionId === 'companion_edda' ? 'edda' : 'tessa';
    const companionName = t(`delveUi.board.companion.${companionNameKey}` as TranslationKey);
    let companionAction: string;
    if (companionRank >= maxRank || !nextCost) {
      companionAction = `<div class="delve-companion-max quest-muted">${esc(t('delveUi.board.companion.maxRank'))}</div>`;
    } else {
      const costMarks = formatNumber(nextCost.marks, { maximumFractionDigits: 0 });
      const nextRankLabel = formatNumber(nextRank, { maximumFractionDigits: 0 });
      const affordable = world.delveMarks >= nextCost.marks;
      companionAction =
        `<button type="button" class="btn delve-companion-upgrade" data-companion-upgrade="${esc(companionId)}"` +
        ` aria-label="${esc(t('delveUi.board.companion.upgradeAria', { name: companionName, rank: nextRankLabel, marks: costMarks }))}"` +
        `${affordable ? '' : ' disabled'}>${esc(t('delveUi.board.companion.upgrade', { rank: nextRankLabel, marks: costMarks }))}</button>`;
    }
    const tierRow = (['normal', 'heroic'] as const)
      .map((tier) => {
        const label = tier === 'heroic' ? heroicLabel : normalLabel;
        const selected = this.selectedTier === tier ? ' selected' : '';
        return `<button type="button" class="delve-tier-btn${selected}" data-tier-pick="${tier}" aria-pressed="${this.selectedTier === tier}">${esc(label)}</button>`;
      })
      .join('');
    const tierLabel = this.selectedTier === 'heroic' ? heroicLabel : normalLabel;
    return (
      `<div class="delve-board-greeting">${esc(t(delveId === 'drowned_litany' ? 'delveUi.npc.halvenMarsh.greeting' : 'delveUi.npc.halven.greeting', { playerName: world.player.name }))}</div>` +
      `<div class="delve-tier-row">${tierRow}</div>` +
      `<div class="delve-companion-row"><div class="delve-companion-label">${esc(t('delveUi.board.companion.pick'))}</div>` +
      `<div class="delve-companion-name">${esc(companionName)} <span class="quest-muted">(${esc(rankLabel)})</span></div>` +
      `<div class="delve-companion-boon quest-muted">${esc(t('delveUi.board.companion.boon'))}</div>` +
      `${companionAction}</div>` +
      `<button type="button" class="btn delve-enter-btn" data-delve-enter aria-label="${esc(t('delveUi.board.enterAria', { delve: delveName, tier: tierLabel }))}"${canEnter ? '' : ' disabled'}>${esc(t('delveUi.board.enter'))}</button>`
    );
  }

  private shopBodyHtml(delveId: string): string {
    const world = this.deps.world();
    const rows = world
      .delveShopOffers(delveId)
      .map((offer) => {
        const item = ITEMS[offer.itemId];
        if (!item) return '';
        const qualityColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
        const name = itemDisplayName(item);
        const marksLabel = formatNumber(offer.marks, { maximumFractionDigits: 0 });
        const priceLabel = t('delveUi.shop.price', { marks: marksLabel });
        const affordable = world.delveMarks >= offer.marks;
        let action: string;
        if (!offer.unlocked) {
          const requirement = offer.requiresHeroicClear
            ? t('delveUi.shop.reqHeroic')
            : t('delveUi.shop.reqClears', {
                count: formatNumber(offer.requiresClears, { maximumFractionDigits: 0 }),
              });
          action = `<span class="delve-shop-req">${esc(requirement)}</span>`;
        } else {
          const buyLabel = t('delveUi.shop.buyAria', { item: name, marks: marksLabel });
          action = `<button type="button" class="delve-shop-buy" data-buy="${esc(offer.itemId)}" aria-label="${esc(buyLabel)}"${affordable ? '' : ' disabled'}>${esc(t('delveUi.shop.buy'))}</button>`;
        }
        const priceClass = offer.unlocked && !affordable ? ' unaffordable' : '';
        return (
          `<div class="delve-shop-row${offer.unlocked ? '' : ' locked'}" role="listitem" data-shop-item="${esc(offer.itemId)}">` +
          `${this.deps.itemIcon(item)}` +
          `<div class="delve-shop-info"><span class="delve-shop-name" style="color:${qualityColor}">${esc(name)}</span>` +
          `<span class="delve-shop-price${priceClass}">${esc(priceLabel)}</span></div>${action}</div>`
        );
      })
      .join('');
    if (!rows) return `<div class="delve-shop-empty">${esc(t('delveUi.shop.empty'))}</div>`;
    return `<div class="delve-shop-list" role="list">${rows}</div>`;
  }

  private bindShopHandlers(delveId: string): void {
    this.deps.element.querySelectorAll<HTMLElement>('[data-shop-item]').forEach((row) => {
      const item = ITEMS[row.dataset.shopItem ?? ''];
      if (item) this.deps.attachTooltip(row, () => this.deps.itemTooltip(item));
    });
    this.deps.element.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        this.deps.world().delveBuyShopItem(delveId, button.dataset.buy ?? '');
      });
    });
  }

  private bindDelveHandlers(delveId: string): void {
    this.deps.element.querySelectorAll<HTMLElement>('[data-tier-pick]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedTier = button.dataset.tierPick as DelveTier;
        this.render(true);
      });
    });
    this.deps.element
      .querySelector<HTMLElement>('[data-companion-upgrade]')
      ?.addEventListener('click', (event) => {
        const companionId = (event.currentTarget as HTMLElement).dataset.companionUpgrade;
        if (!companionId) return;
        this.deps.world().companionUpgrade(companionId);
        this.render(true);
      });
    this.deps.element.querySelector('[data-delve-enter]')?.addEventListener('click', () => {
      const tierId = this.selectedTier;
      this.deps.world().enterDelve(delveId, tierId);
      this.deps.preloadInterior({ type: 'delveEntered', delveId, tierId });
      this.close();
    });
  }
}
