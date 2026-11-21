// The world-marker button and its flyout (DOM): a gilded button in the party
// frame column (beside the raid boss guide) that opens a flyout of the eight
// raid-marker symbols and a clear-all control, the classic raid-manager flare.
//
//   pick a symbol    it arms (the flyout folds away so the ground is free to
//                    click), then a click on the ground places it; pressing
//                    the armed symbol again, a right click or Escape cancels
//   right-click      (a long press on touch) removes that one marker
//   clear all        removes every marker the group has down here
//
// A symbol already down shows lit, with its key binding in the corner when one
// is bound. A raid member who is not the leader sees the button dimmed and
// read-only, with the reason in its tooltip. The flyout is cold chrome: built
// once, repainted only when the paint key moves (sync is polled on the party
// frames' band and compares one number on an idle tick), writes through the
// shared PainterHost writers. Escape reaches it through the one closeAll
// dispatcher (registerTouchMenu); a press outside closes it.

import type { IWorld } from '../../../world_api';
import { esc } from '../../esc';
import { t } from '../../i18n';
import { raidMarkerDataUrl } from '../../icons';
import type { PainterHostWriters } from '../../painter_host';
import { blurIfPointerClick } from '../../pointer_blur';
import { raidMarkerDisplayName } from '../../raid_marker_labels_view';
import { armTapMenuOutsideDismiss, registerTouchMenu } from '../tap_menu';
import type { WorldMarkerAim } from './world_marker_aim';
import {
  inMarkableInstance,
  WORLD_MARKER_PLACE_ACTIONS,
  WORLD_MARKER_SYMBOLS,
  type WorldMarkerBarView,
  worldMarkerBarView,
  worldMarkerPress,
} from './world_markers_core';

/** A long press on touch removes a marker (there is no right click). */
const LONG_PRESS_MS = 520;

export type WorldMarkersWorld = Pick<
  IWorld,
  'partyInfo' | 'playerId' | 'player' | 'sharedMapMarks' | 'clearSharedMapMarks'
>;

export interface WorldMarkersControllerDeps {
  doc: Document;
  writers: PainterHostWriters;
  world(): WorldMarkersWorld;
  aim: WorldMarkerAim;
  /** Cancel a spell's ground aim before a marker takes the cursor. */
  cancelSpellAim(): void;
  attachTooltip(el: HTMLElement, html: () => string): void;
  /** The bound key label for an action id ('' when unbound). */
  keyLabel(actionId: string): string;
  /** The touch HUD is active (tap wording, long press, no cursor placement). */
  isTouch(): boolean;
}

interface Tile {
  symbol: number;
  el: HTMLButtonElement;
  key: HTMLElement;
}

export class WorldMarkersController {
  readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly buttonGlyph: HTMLImageElement;
  private readonly buttonLabel: HTMLElement;
  private readonly flyout: HTMLElement;
  private readonly tiles: Tile[] = [];
  private readonly clearBtn: HTMLButtonElement;
  private view: WorldMarkerBarView = {
    visible: false,
    editable: false,
    placed: 0,
    armed: null,
    key: -1,
  };
  private paintedKey = -1;
  private keysPainted = '';
  private disarmOutside: (() => void) | null = null;

  constructor(private readonly deps: WorldMarkersControllerDeps) {
    const doc = deps.doc;
    const root = doc.createElement('div');
    root.className = 'party-world-markers';
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'party-world-markers-button';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'party-world-markers-flyout');
    const glyph = doc.createElement('img');
    glyph.className = 'party-world-markers-glyph';
    glyph.alt = '';
    glyph.src = raidMarkerDataUrl(0);
    const label = doc.createElement('span');
    label.className = 'party-world-markers-label';
    const chevron = doc.createElement('span');
    chevron.className = 'party-world-markers-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    button.append(glyph, label, chevron);
    button.addEventListener('click', (ev) => {
      blurIfPointerClick(ev, button);
      if (this.deps.aim.isActive()) {
        this.deps.aim.cancel();
        return;
      }
      this.setOpen(!this.isOpen());
    });
    deps.attachTooltip(button, () => this.buttonTip());
    root.append(button);

    const flyout = doc.createElement('div');
    flyout.id = 'party-world-markers-flyout';
    flyout.className = 'party-world-markers-flyout ui-panel-strong';
    flyout.setAttribute('role', 'group');
    flyout.setAttribute('aria-label', t('hudChrome.worldMarkers.flyoutAria'));
    const grid = doc.createElement('div');
    grid.className = 'party-world-markers-grid';
    for (const symbol of WORLD_MARKER_SYMBOLS) grid.append(this.buildTile(symbol).el);
    const clear = doc.createElement('button');
    clear.type = 'button';
    clear.className = 'party-world-markers-clear';
    clear.textContent = t('hudChrome.worldMarkers.clearAll');
    clear.addEventListener('click', (ev) => {
      blurIfPointerClick(ev, clear);
      this.press(null, false);
    });
    deps.attachTooltip(clear, () =>
      this.tip(t('hudChrome.worldMarkers.clearAll'), [t('hudChrome.worldMarkers.clearAllTip')]),
    );
    flyout.append(grid, clear);
    flyout.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      this.setOpen(false);
      this.button.focus();
    });
    root.append(flyout);

    this.root = root;
    this.button = button;
    this.buttonGlyph = glyph;
    this.buttonLabel = label;
    this.flyout = flyout;
    this.clearBtn = clear;
    registerTouchMenu(() => this.close());
  }

  private buildTile(symbol: number): Tile {
    const doc = this.deps.doc;
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'party-world-markers-tile';
    el.dataset.symbol = String(symbol);
    el.setAttribute('aria-pressed', 'false');
    el.setAttribute(
      'aria-label',
      t('hudChrome.worldMarkers.tileAria', { marker: raidMarkerDisplayName(symbol) }),
    );
    const img = doc.createElement('img');
    img.className = 'party-world-markers-tile-glyph';
    img.alt = '';
    img.src = raidMarkerDataUrl(symbol);
    const key = doc.createElement('span');
    key.className = 'party-world-markers-tile-key';
    key.setAttribute('aria-hidden', 'true');
    el.append(img, key);
    el.addEventListener('click', (ev) => {
      blurIfPointerClick(ev, el);
      if (this.longPressFired) {
        this.longPressFired = false;
        return;
      }
      this.press(symbol, false);
    });
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      // A touch hold already removed it on its own timer (Android also fires
      // contextmenu for the same hold): one hold sends one clear.
      if (this.lastPointerTouch) return;
      this.press(symbol, true);
    });
    this.bindLongPress(el, symbol);
    this.deps.attachTooltip(el, () => this.tileTip(symbol));
    const tile = { symbol, el, key };
    this.tiles.push(tile);
    return tile;
  }

  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressFired = false;
  private lastPointerTouch = false;

  /** Touch: a held press removes the marker (the click that follows is eaten). */
  private bindLongPress(el: HTMLElement, symbol: number): void {
    const cancel = (): void => {
      if (this.longPressTimer !== null) clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    };
    el.addEventListener('pointerdown', (ev) => {
      this.lastPointerTouch = ev.pointerType === 'touch';
      if (ev.pointerType !== 'touch') return;
      cancel();
      this.longPressFired = false;
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        this.longPressFired = true;
        this.press(symbol, true);
      }, LONG_PRESS_MS);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const)
      el.addEventListener(type, cancel);
  }

  /** A press on a symbol tile, the clear-all control or a hotkey (symbol null clears). */
  press(symbol: number | null, secondary: boolean, atCursor = false): void {
    this.refreshView();
    const action = worldMarkerPress(this.view, symbol, secondary);
    const world = this.deps.world();
    switch (action.kind) {
      case 'refuse':
        return;
      case 'clear':
        world.clearSharedMapMarks(action.symbol);
        if (action.symbol === null || this.deps.aim.armed() === action.symbol)
          this.deps.aim.cancel();
        return;
      case 'disarm':
        this.deps.aim.cancel();
        return;
      case 'arm':
        this.deps.cancelSpellAim();
        this.deps.aim.begin(action.symbol, atCursor && !this.deps.isTouch());
        // The ground must be free to click (and to tap, on the touch HUD); the
        // focus goes back to the button, whose label now names the armed marker.
        this.setOpen(false);
        if (this.root.contains(this.deps.doc.activeElement)) this.button.focus();
        return;
    }
  }

  /** A world-marker hotkey: place `symbol` at the cursor (desktop) or arm it
   *  for a tap; pressed again while armed it cancels; null clears all. */
  hotkey(symbol: number | null): void {
    this.refreshView();
    if (!this.view.visible) return;
    this.press(symbol, false, true);
  }

  isOpen(): boolean {
    return this.root.classList.contains('is-open');
  }

  /** Close the flyout if it is open (Escape through closeAll). */
  close(): boolean {
    if (!this.isOpen()) return false;
    this.setOpen(false);
    return true;
  }

  private setOpen(open: boolean): void {
    if (open && !this.view.editable) open = false;
    this.deps.writers.toggleClass(this.root, 'is-open', open);
    this.deps.writers.setAttr(this.button, 'aria-expanded', String(open));
    this.disarmOutside?.();
    this.disarmOutside = open
      ? armTapMenuOutsideDismiss(
          () => [this.root],
          () => this.setOpen(false),
        )
      : null;
    if (open) this.paintKeys();
  }

  private refreshView(): void {
    const world = this.deps.world();
    this.view = worldMarkerBarView({
      party: world.partyInfo,
      playerId: world.playerId,
      inInstance: inMarkableInstance(world.player.pos),
      marks: world.sharedMapMarks(),
      armed: this.deps.aim.armed(),
    });
  }

  /**
   * The party frames' band tick: refresh the view, repaint only when its key
   * moved, and hand the party column the control (or null when it hides).
   */
  sync(): HTMLElement | null {
    this.refreshView();
    const v = this.view;
    if (!v.visible) {
      if (this.paintedKey !== v.key) {
        this.paintedKey = v.key;
        if (this.isOpen()) this.setOpen(false);
        if (this.deps.aim.isActive()) this.deps.aim.cancel();
      }
      return null;
    }
    if (v.key !== this.paintedKey) {
      this.paintedKey = v.key;
      this.paint(v);
    }
    return this.root;
  }

  private paint(v: WorldMarkerBarView): void {
    const w = this.deps.writers;
    w.toggleClass(this.root, 'is-read-only', !v.editable);
    w.toggleClass(this.root, 'is-armed', v.armed !== null);
    const armedName = v.armed === null ? null : raidMarkerDisplayName(v.armed);
    w.setText(
      this.buttonLabel,
      armedName === null
        ? t('hudChrome.worldMarkers.button')
        : t('hudChrome.worldMarkers.buttonArmed', { marker: armedName }),
    );
    const glyphSymbol = v.armed ?? 0;
    if (this.buttonGlyph.dataset.glyph !== String(glyphSymbol)) {
      this.buttonGlyph.dataset.glyph = String(glyphSymbol);
      w.setAttr(this.buttonGlyph, 'src', raidMarkerDataUrl(glyphSymbol));
    }
    w.setAttr(this.button, 'aria-disabled', v.editable ? null : 'true');
    for (const tile of this.tiles) {
      const placed = (v.placed & (1 << tile.symbol)) !== 0;
      w.toggleClass(tile.el, 'is-placed', placed);
      w.toggleClass(tile.el, 'is-armed', v.armed === tile.symbol);
      w.setAttr(tile.el, 'aria-pressed', String(v.armed === tile.symbol));
      const name = raidMarkerDisplayName(tile.symbol);
      w.setAttr(
        tile.el,
        'aria-label',
        t(placed ? 'hudChrome.worldMarkers.tileAriaPlaced' : 'hudChrome.worldMarkers.tileAria', {
          marker: name,
        }),
      );
    }
    w.setAttr(this.clearBtn, 'disabled', v.placed === 0 ? '' : null);
  }

  /** Each tile's bound key in its corner (read when the flyout opens: binds
   *  change in the options window, never mid-flyout). */
  private paintKeys(): void {
    let sig = '';
    for (const tile of this.tiles)
      sig += `${this.deps.keyLabel(WORLD_MARKER_PLACE_ACTIONS[tile.symbol])}|`;
    if (sig === this.keysPainted) return;
    this.keysPainted = sig;
    for (const tile of this.tiles)
      this.deps.writers.setText(
        tile.key,
        this.deps.keyLabel(WORLD_MARKER_PLACE_ACTIONS[tile.symbol]),
      );
  }

  /** Re-emit the language-bound text after an in-game language switch. */
  relocalize(): void {
    this.deps.writers.setAttr(this.flyout, 'aria-label', t('hudChrome.worldMarkers.flyoutAria'));
    this.deps.writers.setText(this.clearBtn, t('hudChrome.worldMarkers.clearAll'));
    this.paintedKey = -1;
  }

  private tip(title: string, lines: readonly string[], red?: string): string {
    let html = `<div class="tt-title">${esc(title)}</div>`;
    for (const line of lines) html += `<div class="tt-desc">${esc(line)}</div>`;
    if (red) html += `<div class="tt-red">${esc(red)}</div>`;
    return html;
  }

  private buttonTip(): string {
    const touch = this.deps.isTouch();
    return this.tip(
      t('hudChrome.worldMarkers.title'),
      [t(touch ? 'hudChrome.worldMarkers.tipTouch' : 'hudChrome.worldMarkers.tip')],
      this.view.editable ? undefined : t('hudChrome.worldMarkers.readOnly'),
    );
  }

  private tileTip(symbol: number): string {
    const touch = this.deps.isTouch();
    const placed = (this.view.placed & (1 << symbol)) !== 0;
    const lines = [
      t(touch ? 'hudChrome.worldMarkers.tileTipTouch' : 'hudChrome.worldMarkers.tileTip'),
    ];
    if (placed)
      lines.push(
        t(touch ? 'hudChrome.worldMarkers.tileRemoveTouch' : 'hudChrome.worldMarkers.tileRemove'),
      );
    return this.tip(
      raidMarkerDisplayName(symbol),
      lines,
      this.view.editable ? undefined : t('hudChrome.worldMarkers.readOnly'),
    );
  }
}
