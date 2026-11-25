// Treasure map window (#treasure-map-window): the parchment a read treasure map
// opens (src/sim/treasure_vault.ts emits treasureMapRead). A thin DOM consumer of
// treasure_map_view.ts: the cropped terrain plate with the X, the digging hint,
// and what redrawing it a rarity finer would take. Self-mounting: the
// panel is created beside the other windows on first open, so the static HTML
// entries stay untouched. Cold chrome: painted on open, on the upgrade / vault
// events, and from the Hud slow-band poll only when its signature moved (the held
// ink count, the map's rarity and site, the map still being in the bags).

import {
  CARTOGRAPHERS_INK_ITEM_ID,
  TREASURE_MAP_ITEM_IDS,
} from '../../../sim/content/treasure_maps';
import { ITEMS } from '../../../sim/data';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName, zoneDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import {
  captureFocusKey,
  findFocusKey,
  restoreFirstEnabled,
  stampFocusKey,
} from '../../focus_restore';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { ownEntry } from '../../known_item';
import { svgIcon } from '../../ui_icons';
import { treasureMapModel } from './treasure_map_view';

export interface TreasureMapWindowDeps {
  world(): Pick<IWorld, 'treasureMap' | 'inventory'>;
}

const NUM0 = { maximumFractionDigits: 0 } as const;
const pct = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

type TreasureMapWorld = Pick<IWorld, 'treasureMap' | 'inventory'>;

/** Cartographer's Ink held across the bags (the upgrade note's "held"). */
function inksHeld(world: TreasureMapWorld): number {
  return world.inventory.reduce(
    (sum, slot) => sum + (slot?.itemId === CARTOGRAPHERS_INK_ITEM_ID ? slot.count : 0),
    0,
  );
}

const MAP_ITEM_IDS: ReadonlySet<string> = new Set(Object.values(TREASURE_MAP_ITEM_IDS));

/** Whether the bags still hold a treasure map: sold, destroyed or mailed away,
 *  the parchment has nothing left to show. ANY rarity counts, not just the read
 *  map's own: online an upgrade's new rarity (the quest snapshot) and its
 *  swapped bag item (the inventory delta) can land in different frames, and a
 *  rarity-exact check would close the window mid-upgrade. */
function mapInBags(world: TreasureMapWorld): boolean {
  if (!world.treasureMap) return false;
  return world.inventory.some((slot) => slot !== null && MAP_ITEM_IDS.has(slot.itemId));
}

export class TreasureMapWindow {
  private el: HTMLElement | null = null;
  // The data digest the last paint drew from (see signature()). Latched by every
  // paint, so an event repaint never buys a second rebuild on the next poll.
  private lastSig = '';

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

  /**
   * The slow-band poll (Hud.update): ink bought or looted moves the held count,
   * and the map leaving the bags closes the window. A repeated identical poll
   * compares one short string and touches no DOM.
   */
  refreshIfChanged(): void {
    if (this.isOpen && this.signature(this.deps.world()) !== this.lastSig) this.render();
  }

  /** The language fan-out arm: the signature is text-independent, so force one
   *  rebuild and leave it re-latched. */
  relocalize(): void {
    if (this.isOpen) this.render();
  }

  private signature(world: TreasureMapWorld): string {
    const map = world.treasureMap;
    return `${map?.rarity ?? ''}|${map?.siteId ?? ''}|${inksHeld(world)}|${mapInBags(world) ? 1 : 0}`;
  }

  private render(): void {
    const world = this.deps.world();
    const model = mapInBags(world) ? treasureMapModel(world, inksHeld(world)) : null;
    const el = this.panel();
    this.lastSig = this.signature(world);
    if (!model) {
      this.close();
      return;
    }
    const focusKey = captureFocusKey(el);
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
    stampFocusKey(el, '[data-close]', 'close');
    if (focusKey !== null) restoreFirstEnabled([findFocusKey(el, focusKey)]);
  }
}
