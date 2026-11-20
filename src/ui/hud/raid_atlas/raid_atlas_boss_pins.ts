// The raid atlas's boss pins as interactive things: the boss tooltip card
// (portrait, name, encounter subtitle, state, lore) and one keyboard focus
// stop per boss. The controller owns input and the camera; it hands this module
// what a pointer is over, what was tapped, and the projection of each paint.
//
//   mouse      hovering a medallion opens its card; leaving it closes it
//   touch      a tap on a medallion opens its card (a tap on the same one,
//              or anywhere else, closes it); the pin tool keeps its taps
//   keyboard   Tab reaches each boss on the open page after the map itself;
//              focus opens its card, Escape closes it and returns to the map
//
// The card follows its pin through every zoom and pan (`follow`, each paint)
// and closes when the pin leaves the map face. Its content is rebuilt only
// when the boss or its state changes (a keyed write).
//
// The focus stops are transparent buttons laid over the medallions with
// pointer-events off, so they never take a drag or a pin tap from the canvas;
// they exist for keyboard and screen-reader users (each names the boss and its
// state, and points at the card while it is open).

import { mobDisplayName } from '../../entity_display_core';
import { t } from '../../i18n';
import {
  type RaidAtlasBossTooltipModel,
  raidAtlasBossTooltip,
  raidAtlasTooltipPlacement,
} from './raid_atlas_boss_core';
import type { RaidAtlasFloorId } from './raid_atlas_plan_core';
import type { RaidAtlasBossMark } from './raid_atlas_view';

const CARD_ID = 'raid-atlas-boss-card';

/** One paint's geometry: where each pin of the open page stands right now. */
export interface RaidAtlasPinGeometry {
  floor: RaidAtlasFloorId;
  marks: readonly RaidAtlasBossMark[];
  project: (x: number, z: number) => { sx: number; sy: number };
  /** The medallion radius as painted (CSS px of the canvas). */
  r: number;
  /** The canvas's CSS px side. */
  side: number;
  /** The canvas's content box offset inside the chrome (author px). */
  offsetX: number;
  offsetY: number;
}

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

function titleOf(model: RaidAtlasBossTooltipModel): string {
  return model.titleKey ? t(model.titleKey) : (model.names[0] ?? '');
}

export class RaidAtlasBossPins {
  private readonly card: HTMLElement;
  private readonly faces: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly stateLine: HTMLElement;
  private readonly lore: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly stops = new Map<string, HTMLButtonElement>();
  private openId: string | null = null;
  /** Why the card is open: a hover closes on leave, a tap or focus does not. */
  private openBy: 'hover' | 'tap' | 'focus' | null = null;
  private contentKey = '';
  private placeKey = '';
  /** The card's measured size, read once per content change (never per paint). */
  private cardW = 0;
  private cardH = 0;
  private readonly stopPlace = new Map<string, string>();
  private readonly stopLabel = new Map<string, string>();
  private geometry: RaidAtlasPinGeometry | null = null;

  /** `onChange` repaints the map (the hovered pin's halo). */
  constructor(
    chrome: HTMLElement,
    private readonly onChange: () => void,
    private readonly onEscape: () => void,
  ) {
    // The focus stops come first in the chrome, so Tab reaches the bosses
    // straight after the map and before the page tabs and tools.
    this.layer = el('div', 'raid-atlas-boss-stops');
    chrome.insertBefore(this.layer, chrome.firstChild);
    const card = el('div', 'raid-atlas-boss-card', chrome);
    card.id = CARD_ID;
    card.setAttribute('role', 'tooltip');
    this.faces = el('div', 'raid-atlas-boss-faces', card);
    const head = el('div', 'raid-atlas-boss-head', card);
    this.title = el('div', 'raid-atlas-boss-title', head);
    this.subtitle = el('div', 'raid-atlas-boss-subtitle', head);
    this.stateLine = el('div', 'raid-atlas-boss-state', card);
    el('div', 'raid-atlas-boss-rule', card);
    this.lore = el('p', 'raid-atlas-boss-lore', card);
    this.card = card;
  }

  /** The encounter whose card is open (its pin wears the halo), or null. */
  hovered(): string | null {
    return this.openId;
  }

  isOpen(): boolean {
    return this.openId !== null;
  }

  /** A mouse moved over the map with no button down: open or close by hover.
   *  Returns true when the pointer is over a pin (the cursor shows a hand). */
  hover(mark: RaidAtlasBossMark | null): boolean {
    if (mark) {
      if (this.openId !== mark.boss.id) this.open(mark, 'hover');
      return true;
    }
    if (this.openBy === 'hover') this.close();
    return false;
  }

  /** The pointer left the map, or a drag began: a hover card goes. */
  leave(): void {
    if (this.openBy === 'hover') this.close();
  }

  /** A tap (or click) on the map, not on a player pin. Returns true when it
   *  was spent here (on a boss, or closing an open card). */
  tap(mark: RaidAtlasBossMark | null): boolean {
    if (mark) {
      if (this.openId === mark.boss.id && this.openBy === 'tap') this.close();
      else this.open(mark, 'tap');
      return true;
    }
    if (this.openId !== null && this.openBy !== 'hover') {
      this.close();
      return true;
    }
    return false;
  }

  /** Tab from the map itself: focus the first (or, backwards, the last)
   *  boss in view. False when no boss of the open page is in view. */
  focusFirst(backwards: boolean): boolean {
    const shown = this.shownStops();
    const target = backwards ? shown[shown.length - 1] : shown[0];
    target?.focus();
    return target !== undefined;
  }

  private shownStops(): HTMLButtonElement[] {
    return [...this.stops.values()].filter((b) => !b.hidden);
  }

  /** Move focus `dir` stops on from `from`; false past either end. */
  private step(from: HTMLButtonElement, dir: 1 | -1): boolean {
    const shown = this.shownStops();
    const next = shown[shown.indexOf(from) + dir];
    next?.focus();
    return next !== undefined;
  }

  close(): void {
    if (this.openId === null) return;
    const stop = this.stops.get(this.openId);
    stop?.removeAttribute('aria-describedby');
    this.openId = null;
    this.openBy = null;
    this.card.classList.remove('is-open');
    this.onChange();
  }

  /** Each paint: keep the card on its pin, its content on its boss's state,
   *  and the focus stops over their medallions. */
  follow(geometry: RaidAtlasPinGeometry): void {
    this.geometry = geometry;
    this.syncStops(geometry);
    if (this.openId === null) return;
    const mark = geometry.marks.find((m) => m.boss.id === this.openId);
    if (!mark || mark.boss.floor !== geometry.floor) {
      this.close();
      return;
    }
    const p = geometry.project(mark.boss.x, mark.boss.z);
    if (p.sx < 0 || p.sy < 0 || p.sx > geometry.side || p.sy > geometry.side) {
      this.close();
      return;
    }
    this.fill(mark);
    this.place(p, geometry);
  }

  private open(mark: RaidAtlasBossMark, by: 'hover' | 'tap' | 'focus'): void {
    const prev = this.openId ? this.stops.get(this.openId) : null;
    prev?.removeAttribute('aria-describedby');
    this.openId = mark.boss.id;
    this.openBy = by;
    this.stops.get(mark.boss.id)?.setAttribute('aria-describedby', CARD_ID);
    this.placeKey = '';
    this.card.classList.add('is-open');
    this.fill(mark);
    const g = this.geometry;
    if (g) this.place(g.project(mark.boss.x, mark.boss.z), g);
    this.onChange();
  }

  private fill(mark: RaidAtlasBossMark): void {
    const model = raidAtlasBossTooltip(mark, mobDisplayName);
    const key = `${model.id}|${model.state}`;
    if (key === this.contentKey) return;
    this.contentKey = key;
    this.card.dataset.state = model.state;
    this.card.dataset.boss = model.id;
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
    this.title.textContent = titleOf(model);
    this.subtitle.textContent = t(model.subtitleKey, {
      lead: model.names[0] ?? '',
      partner: model.names[1] ?? '',
    });
    this.stateLine.textContent = t(model.stateKey);
    this.lore.textContent = t(model.loreKey);
    this.cardW = this.card.offsetWidth;
    this.cardH = this.card.offsetHeight;
    this.placeKey = '';
  }

  private place(p: { sx: number; sy: number }, g: RaidAtlasPinGeometry): void {
    const at = raidAtlasTooltipPlacement(p, g.r * 1.2, { w: this.cardW, h: this.cardH }, g.side);
    const left = Math.round(at.left + g.offsetX);
    const top = Math.round(at.top + g.offsetY);
    const key = `${left},${top}`;
    if (key === this.placeKey) return;
    this.placeKey = key;
    this.card.style.transform = `translate(${left}px, ${top}px)`;
  }

  /** One focus stop per boss of the open page, over its medallion. */
  private syncStops(g: RaidAtlasPinGeometry): void {
    for (const mark of g.marks) {
      const id = mark.boss.id;
      let stop = this.stops.get(id);
      if (!stop) {
        stop = el('button', 'raid-atlas-boss-stop', this.layer);
        stop.type = 'button';
        const made = stop;
        made.addEventListener('focus', () => {
          const live = this.geometry?.marks.find((m) => m.boss.id === id);
          if (live) this.open(live, 'focus');
        });
        made.addEventListener('blur', () => {
          if (this.openId === id && this.openBy === 'focus') this.close();
        });
        made.addEventListener('keydown', (ev) => {
          if (ev.key === 'Tab') {
            // The game claims Tab for targeting, so the map walks its own
            // ring: the map, each boss in turn, and back to the map.
            ev.preventDefault();
            ev.stopPropagation();
            if (!this.step(made, ev.shiftKey ? -1 : 1)) this.onEscape();
            return;
          }
          if (ev.key !== 'Escape') return;
          ev.preventDefault();
          ev.stopPropagation();
          this.close();
          this.onEscape();
        });
        this.stops.set(id, made);
      }
      const onPage = mark.boss.floor === g.floor;
      const p = g.project(mark.boss.x, mark.boss.z);
      const inView = onPage && p.sx >= 0 && p.sy >= 0 && p.sx <= g.side && p.sy <= g.side;
      // The accessible name changes with the boss's state only.
      const labelKey = `${id}|${mark.state}`;
      if (this.stopLabel.get(id) !== labelKey) {
        this.stopLabel.set(id, labelKey);
        const model = raidAtlasBossTooltip(mark, mobDisplayName);
        stop.setAttribute(
          'aria-label',
          t('hudChrome.raidAtlas.boss.aria', { name: titleOf(model), state: t(model.stateKey) }),
        );
      }
      const x = Math.round(p.sx - g.r + g.offsetX);
      const y = Math.round(p.sy - g.r + g.offsetY);
      const d = Math.round(g.r * 2);
      const place = inView ? `${x},${y},${d}` : 'off';
      if (this.stopPlace.get(id) === place) continue;
      this.stopPlace.set(id, place);
      stop.hidden = !inView;
      if (inView) {
        stop.style.width = `${d}px`;
        stop.style.height = `${d}px`;
        stop.style.transform = `translate(${x}px, ${y}px)`;
      }
    }
  }
}
