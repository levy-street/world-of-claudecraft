import type { corpseLootAvailability } from '../../../game/corpse_loot_availability';
import { ITEMS } from '../../../sim/data';
import { dist2d, type Entity, type ItemDef } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { svgIcon } from '../../ui_icons';
import { corpseHarvestView } from './corpse_harvest_view';
import { renderCorpseHarvestPicker } from './corpse_harvest_window';

export interface LootWindowItemStack {
  itemId: string;
  count: number;
}

export interface LootWindowControllerDeps {
  element: HTMLElement;
  document: Document;
  world(): IWorld;
  corpseAvailability(entity: Entity): ReturnType<typeof corpseLootAvailability>;
  closeTransient(): void;
  hideTooltip(): void;
  entityName(entity: Entity): string;
  money(copper: number): string;
  coinIconUrl(): string;
  itemIcon(item: ItemDef): string;
  itemTooltip(item: ItemDef): string;
  attachTooltip(element: HTMLElement, html: () => string): void;
  centerPopup(element: HTMLElement): void;
  placePopup(
    element: HTMLElement,
    x: number,
    y: number,
    reserveRight: number,
    reserveBottom: number,
    minLeft?: number,
    minTop?: number,
  ): void;
}

/** Owns corpse and delve-chest loot popup state, rendering, actions, and range closure. */
export class LootWindowController {
  private mobId: number | null = null;
  private chestId: number | null = null;

  constructor(private readonly deps: LootWindowControllerDeps) {}

  get hasOpenChest(): boolean {
    return this.chestId !== null;
  }

  openCorpse(mobId: number, screenX: number, screenY: number): void {
    const world = this.deps.world();
    const mob = world.entities.get(mobId);
    if (!mob) return;
    const { componentTags, harvestable, visibleItems, hasLoot, canOpen } =
      this.deps.corpseAvailability(mob);
    if (!canOpen) return;

    this.deps.closeTransient();
    this.mobId = mobId;
    this.chestId = null;
    let html = this.titleHtml(this.deps.entityName(mob));
    if (mob.loot && mob.loot.copper > 0) {
      html += `<div class="loot-item"><img class="item-icon q-common" src="${this.deps.coinIconUrl()}" alt="" draggable="false"><span>${this.deps.money(mob.loot.copper)}</span></div>`;
    }
    html += visibleItems.map((stack) => this.itemRowHtml(stack)).join('');
    this.deps.element.innerHTML = html;
    this.attachItemTooltips();

    if (hasLoot) {
      this.appendTakeAll(() => {
        this.deps.world().lootCorpse(mobId);
        this.close();
      }, t('hudChrome.loot.takeAllTooltip'));
    }
    if (harvestable && componentTags) {
      renderCorpseHarvestPicker(this.deps.element, corpseHarvestView(componentTags, new Set()), {
        onHarvest: (chosen) => {
          this.deps.world().harvestCorpse(mobId, chosen);
          this.close();
        },
      });
    }
    this.bindClose();
    this.deps.element.style.display = 'block';
    if (this.deps.document.body.classList.contains('mobile-touch')) {
      this.deps.centerPopup(this.deps.element);
    } else {
      this.deps.placePopup(this.deps.element, screenX - 115, screenY - 30, 260, 280, 10, 10);
      this.deps.element.style.transform = 'none';
    }
  }

  openChest(chestId: number, items: readonly LootWindowItemStack[]): void {
    if (items.length === 0) return;
    this.deps.closeTransient();
    this.mobId = null;
    this.chestId = chestId;
    const chest = this.deps.world().entities.get(chestId);
    this.deps.element.innerHTML =
      this.titleHtml(chest ? this.deps.entityName(chest) : t('hudChrome.loot.chestTitle')) +
      items.map((stack) => this.itemRowHtml(stack)).join('');
    this.attachItemTooltips();
    this.appendTakeAll(() => {
      this.deps.world().collectDelveChestLoot(chestId);
      this.close();
    });
    this.bindClose();
    this.deps.element.style.display = 'block';
    this.deps.centerPopup(this.deps.element);
  }

  close(): void {
    this.deps.element.style.display = 'none';
    this.mobId = null;
    this.chestId = null;
    this.deps.hideTooltip();
  }

  updateProximity(): void {
    const world = this.deps.world();
    if (this.mobId !== null) {
      const mob = world.entities.get(this.mobId);
      if (!mob?.lootable || this.distanceFromPlayer(mob) > 7) this.close();
    }
    if (this.chestId !== null) {
      const chest = world.entities.get(this.chestId);
      if (!chest || this.distanceFromPlayer(chest) > 7) this.close();
    }
  }

  private distanceFromPlayer(entity: Entity): number {
    return dist2d(this.deps.world().player.pos, entity.pos);
  }

  private titleHtml(title: string): string {
    return `<div class="panel-title"><span>${esc(title)}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.loot.close'))}">${svgIcon('close')}</button></div>`;
  }

  private itemRowHtml(stack: LootWindowItemStack): string {
    const item = ITEMS[stack.itemId];
    const count =
      stack.count > 1
        ? ` ${esc(t('itemUi.bags.stackCount', { count: formatNumber(stack.count, { maximumFractionDigits: 0 }) }))}`
        : '';
    return `<div class="loot-item" data-item="${stack.itemId}">${this.deps.itemIcon(item)}<span style="font-size:12px">${esc(itemDisplayName(item))}${count}</span></div>`;
  }

  private attachItemTooltips(): void {
    this.deps.element.querySelectorAll<HTMLElement>('[data-item]').forEach((row) => {
      const itemId = row.dataset.item ?? '';
      this.deps.attachTooltip(row, () => this.deps.itemTooltip(ITEMS[itemId]));
    });
  }

  private appendTakeAll(onTakeAll: () => void, title?: string): void {
    const button = this.deps.document.createElement('button');
    button.className = 'btn';
    button.textContent = t('itemUi.loot.takeAll');
    if (title) button.title = title;
    button.addEventListener('click', onTakeAll);
    this.deps.element.appendChild(button);
  }

  private bindClose(): void {
    this.deps.element.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }
}
