// One raid atlas boss card (DOM): the parchment tooltip a boss pin opens, with
// its portrait(s), name, encounter subtitle, state and lore. Shared by the
// map's pins (raid_atlas_boss_pins.ts, inside the atlas chrome) and the
// minimap's (raid_atlas_minimap_card.ts, beside the round minimap), so the two
// read the same. Its content is rebuilt only when the boss or its state
// changes (a keyed write), and its size is measured once per rebuild, never
// per paint.

import { mobDisplayName } from '../../entity_display_core';
import { t } from '../../i18n';
import { type RaidAtlasBossTooltipModel, raidAtlasBossTooltip } from './raid_atlas_boss_core';
import type { RaidAtlasBossMark } from './raid_atlas_view';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  parent?.appendChild(node);
  return node;
}

/** The card's title: an encounter name (a council), else the lead body's name. */
export function raidAtlasBossTitle(model: RaidAtlasBossTooltipModel): string {
  return model.titleKey ? t(model.titleKey) : (model.names[0] ?? '');
}

export class RaidAtlasBossCard {
  readonly el: HTMLElement;
  private readonly faces: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly stateLine: HTMLElement;
  private readonly lore: HTMLElement;
  private contentKey = '';
  private w = 0;
  private h = 0;
  private placeKey = '';

  constructor(parent: HTMLElement, cls: string, id?: string) {
    const card = el('div', cls, parent);
    if (id) card.id = id;
    card.setAttribute('role', 'tooltip');
    this.faces = el('div', 'raid-atlas-boss-faces', card);
    const head = el('div', 'raid-atlas-boss-head', card);
    this.title = el('div', 'raid-atlas-boss-title', head);
    this.subtitle = el('div', 'raid-atlas-boss-subtitle', head);
    this.stateLine = el('div', 'raid-atlas-boss-state', card);
    el('div', 'raid-atlas-boss-rule', card);
    this.lore = el('p', 'raid-atlas-boss-lore', card);
    this.el = card;
  }

  isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  setOpen(open: boolean): void {
    this.el.classList.toggle('is-open', open);
    if (open) this.placeKey = '';
  }

  /** The card's measured size (CSS px), as of its last content change. */
  size(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }

  /** Show this boss and state; true when the content (and size) changed. */
  fill(mark: RaidAtlasBossMark): boolean {
    const model = raidAtlasBossTooltip(mark, mobDisplayName);
    const key = `${model.id}|${model.state}`;
    if (key === this.contentKey) return false;
    this.contentKey = key;
    this.el.dataset.state = model.state;
    this.el.dataset.boss = model.id;
    const imgs = model.portraits.map((src, i) => {
      const img = document.createElement('img');
      img.className = i === 0 ? 'raid-atlas-boss-face' : 'raid-atlas-boss-face is-partner';
      img.src = src;
      img.alt = '';
      img.decoding = 'async';
      return img;
    });
    this.faces.replaceChildren(...imgs);
    this.faces.classList.toggle('is-council', imgs.length > 1);
    this.title.textContent = raidAtlasBossTitle(model);
    this.subtitle.textContent = t(model.subtitleKey, {
      lead: model.names[0] ?? '',
      partner: model.names[1] ?? '',
    });
    this.stateLine.textContent = t(model.stateKey);
    this.lore.textContent = t(model.loreKey);
    this.w = this.el.offsetWidth;
    this.h = this.el.offsetHeight;
    this.placeKey = '';
    return true;
  }

  /** Move the card's top-left to (left, top) in its parent's px (a write only on change). */
  place(left: number, top: number): void {
    const l = Math.round(left);
    const tp = Math.round(top);
    const key = `${l},${tp}`;
    if (key === this.placeKey) return;
    this.placeKey = key;
    this.el.style.transform = `translate(${l}px, ${tp}px)`;
  }
}
