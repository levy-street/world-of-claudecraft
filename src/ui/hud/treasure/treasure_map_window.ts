// Treasure map window (#treasure-map-window): the parchment a read treasure map
// opens (src/sim/treasure_vault.ts emits treasureMapRead). A thin DOM consumer of
// treasure_map_view.ts: the cropped terrain plate with the X, the digging hint,
// and what redrawing it a rarity finer would take. Self-mounting: the
// panel is created beside the other windows on first open, so the static HTML
// entries stay untouched. Cold chrome, painted only on open and on a click.

import {
  CARTOGRAPHERS_INK_ITEM_ID,
  TREASURE_MAP_ITEM_IDS,
} from '../../../sim/content/treasure_maps';
import { ITEMS } from '../../../sim/data';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName, zoneDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { ownEntry } from '../../known_item';
import { svgIcon } from '../../ui_icons';
import { treasureMapModel } from './treasure_map_view';

export interface TreasureMapWindowDeps {
  world(): Pick<IWorld, 'treasureMap' | 'inventory'>;
}

const NUM0 = { maximumFractionDigits: 0 } as const;
const pct = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

export class TreasureMapWindow {
  private el: HTMLElement | null = null;

  constructor(private readonly deps: TreasureMapWindowDeps) {}

  private panel(): HTMLElement {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.id = 'treasure-map-window';
    el.className = 'window panel';
    el.style.display = 'none';
    (document.getElementById('delve-rite-panel')?.parentElement ?? document.body).appendChild(el);
    this.el = el;
    return el;
  }

  get isOpen(): boolean {
    return this.el !== null && this.el.style.display === 'block';
  }

  open(): void {
    this.render();
  }

  close(): void {
    if (this.el) this.el.style.display = 'none';
  }

  /** Repaint if open (a currency or rarity change); closes once the map is gone. */
  refresh(): void {
    if (this.isOpen) this.render();
  }

  private render(): void {
    const world = this.deps.world();
    const inks = world.inventory.reduce(
      (sum, slot) => sum + (slot?.itemId === CARTOGRAPHERS_INK_ITEM_ID ? slot.count : 0),
      0,
    );
    const model = treasureMapModel(world, inks);
    const el = this.panel();
    if (!model) {
      this.close();
      return;
    }
    const mapDef = ownEntry(ITEMS, TREASURE_MAP_ITEM_IDS[model.rarity]);
    const title = mapDef ? itemDisplayName(mapDef) : '';
    // The plate is laid out larger than the parchment and shifted so only the
    // crop shows; the parchment clips the rest.
    const plate =
      `background-image:url('${model.plateUrl}');` +
      `width:${pct(model.plateScaleX)};height:${pct(model.plateScaleY)};` +
      `left:${pct(model.plateOffsetX)};top:${pct(model.plateOffsetY)};`;
    // The redraw itself happens by using Cartographer's Ink (sold by the
    // faction quartermasters); the parchment only says what it would take.
    const upgrade = model.upgrade
      ? `<div class="tmap-upgrade">${esc(
          t('hudChrome.treasureMap.upgradeNote', {
            rarity: t(`hudChrome.treasureMap.rarity.${model.upgrade.next}` as TranslationKey),
            inks: formatNumber(model.upgrade.inks, NUM0),
            held: formatNumber(model.upgrade.held, NUM0),
          }),
        )}</div>`
      : `<div class="tmap-upgrade tmap-maxed">${esc(t('hudChrome.treasureMap.upgradeMaxed'))}</div>`;
    markDialogRoot(el, { label: title });
    el.dataset.rarity = model.rarity;
    el.innerHTML =
      `<div class="panel-title"><span class="tmap-title">${esc(title)}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(
        t('hudChrome.treasureMap.close'),
      )}">${svgIcon('close')}</button></div>` +
      `<div class="tmap-parchment"><div class="tmap-plate" style="${plate}"></div>` +
      `<span class="tmap-mark" style="left:${pct(model.markX)};top:${pct(model.markY)}" aria-hidden="true">X</span></div>` +
      `<div class="tmap-zone">${esc(
        t('hudChrome.treasureMap.zone', { zone: zoneDisplayName(model.zoneId) }),
      )}</div>` +
      `<div class="tmap-hint">${esc(t('hudChrome.treasureMap.hint'))}</div>` +
      upgrade;
    el.style.display = 'block';
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }
}
