// The touch bar editor overlay: one ring page exploded into a 4-button by
// 5-direction grid of real, focusable buttons, with page tabs. Tap-to-place (a
// spell armed by the spellbook lands in the tapped cell), tap-to-swap (tap one
// cell, then another). ZERO gestures, which is the point: binding used to ride
// the mobile long-press drag that reached only the four visible centre buttons
// and armed underneath the radial, so setup left the live combat surface
// entirely (see bar_editor_core.ts for the defect this closes).
//
// The consumer half of the pure-core + thin-consumer split: bar_editor_core.ts
// owns the grid model and the tap state machine; this module paints it and
// routes every mutation back through injected callbacks, so the SAME
// placeAbilityOnSlot / swapHotbarSlots / saveSlotMap path the desktop drop uses
// runs offline and online alike. It holds no Sim reference and never imports Hud.
//
// COLD BY CONSTRUCTION. It is not on Hud.update()'s band and arms no driver of
// its own: it paints on open, on a page switch, on a locale switch, and after a
// mutation it made itself. That is also why it does NOT instantiate
// ActionBarPainter over an ActionBarView the way the live ring does: that family
// derives cooldown sweeps, range dimming and proc glows from the live world
// every frame, and a cold surface would freeze one stale frame of them on
// screen. The editor shows what a slot HOLDS, which is all a binding decision
// needs; it reuses the family's icon-key contract instead of its per-frame state.

import { audio } from '../../../../game/audio';
import { ABILITIES, ITEMS } from '../../../../sim/data';
import { abilityDisplayName } from '../../../ability_display_name';
import { markDialogRoot } from '../../../dialog_root';
import { itemDisplayName } from '../../../entity_i18n';
import { esc } from '../../../esc';
import { captureFocusKey, restoreFirstEnabled } from '../../../focus_restore';
import { formatNumber, t } from '../../../i18n';
import { iconDataUrl } from '../../../icons';
import { svgIcon } from '../../../ui_icons';
import type { HotbarAction } from '../hotbar';
import { MOBILE_ACTION_BUTTONS } from '../mobile_action_page_view';
import {
  armBarEditorAbility,
  BAR_EDITOR_DIRECTION_KEYS,
  BAR_EDITOR_IDLE,
  type BarEditorCell,
  type BarEditorSelection,
  barEditorCaption,
  barEditorCellAria,
  barEditorClearArmed,
  barEditorPageCount,
  barEditorPickedSlot,
  buildBarEditorGrid,
  clampBarEditorPage,
  resolveBarEditorTap,
  toggleBarEditorClear,
} from './bar_editor_core';

/** Hud-supplied glue. Every mutation leaves through these, never through a
 *  second write path inside the editor. */
export interface BarEditorWindowDeps {
  root(): HTMLElement;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onVisibilityChange(): void;
  hideTooltip(): void;
  /** The bar's LIVE slot array (index 0 = barSlot 1), as Hud holds it. */
  barActions(): readonly HotbarAction[];
  /** Configurable source slots the editor may bind, which is the live ring's own
   *  span: the same cells, so anything bindable here is castable there. */
  sourceSlotCount(): number;
  /** The "lock action bars" option: locked means the grid is read-only. */
  editAllowed(): boolean;
  /** Place an ability on a 1-based bar slot (the desktop drop's own path). */
  placeAbility(abilityId: string, slot: number): void;
  /** Swap two 1-based bar slots (the desktop drop's own path). */
  swapSlots(slotA: number, slotB: number): void;
  /** Empty a 1-based bar slot (the desktop shift-clear's own path). */
  clearSlot(slot: number): void;
}

/** One painted cell and the grid position it stands for. Collected as the node
 *  is minted, so a repaint costs no subtree query (the spellbook's lesson). */
interface CellRef {
  readonly cell: BarEditorCell;
  readonly btn: HTMLButtonElement;
  readonly icon: HTMLElement;
  readonly name: HTMLElement;
}

export class BarEditorWindow {
  private openerFocus: HTMLElement | null = null;
  private page = 0;
  private selection: BarEditorSelection = BAR_EDITOR_IDLE;
  private readonly cells: CellRef[] = [];
  private caption: HTMLElement | null = null;
  private clearBtn: HTMLButtonElement | null = null;
  private readonly tabs: HTMLButtonElement[] = [];

  constructor(private readonly deps: BarEditorWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  /**
   * Open the editor, optionally with a spell already armed so the very next tap
   * places it. That armed path is the spellbook's assign control: on touch there
   * is no drag to the bar, so the spellbook hands the id over instead.
   */
  open(armedAbilityId: string | null = null): void {
    // Capture the opener BEFORE closing other windows, so a sibling's own
    // focus-return on close cannot clobber the element we restore to (WCAG).
    if (!this.isOpen) this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.selection =
      armedAbilityId === null ? BAR_EDITOR_IDLE : armBarEditorAbility(armedAbilityId);
    this.page = clampBarEditorPage(this.page, this.deps.sourceSlotCount());
    this.render();
    this.deps.root().style.display = 'block';
    this.deps.onVisibilityChange();
    (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.open();
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    el.style.display = 'none';
    this.selection = BAR_EDITOR_IDLE;
    this.deps.hideTooltip();
    this.deps.onVisibilityChange();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /** Re-localize after an in-game language switch. Self-gated on isOpen so the
   *  Hud fan-out can call it unconditionally. */
  relocalize(): void {
    if (!this.isOpen) return;
    this.render();
  }

  /**
   * Re-mint the whole window. Every control the player could be standing on is
   * destroyed here, and BOTH callers are a control activation (a tab press, an
   * in-game language switch), so the focused control's identity is carried
   * across with the shared focus_restore seam rather than left on <body>.
   *
   * The degradation ladder is this window's own: the rebuilt equivalent first,
   * then the active page tab, then the close button, so a key that no longer
   * exists (a page that shrank away) still lands somewhere in the editor.
   */
  private render(): void {
    const el = this.deps.root();
    const focusKey = captureFocusKey(el);
    const totalSlots = this.deps.sourceSlotCount();
    this.page = clampBarEditorPage(this.page, totalSlots);
    markDialogRoot(el, { label: t('hudChrome.barEditor.title') });
    this.cells.length = 0;
    this.tabs.length = 0;
    this.clearBtn = null;
    el.innerHTML = `<div class="panel-title"><span>${esc(t('hudChrome.barEditor.title'))}</span><div class="panel-title-actions"><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.barEditor.close'))}">${svgIcon('close')}</button></div></div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.appendChild(this.buildTabs(totalSlots));
    el.appendChild(this.buildGrid(totalSlots));
    el.appendChild(this.buildClearControl());
    const caption = document.createElement('div');
    caption.className = 'bar-editor-caption';
    // The editor is the ONLY binding path on touch, so its arm / place / swap /
    // refuse feedback has to be announced, not only drawn.
    caption.setAttribute('role', 'status');
    el.appendChild(caption);
    this.caption = caption;
    this.paint();
    if (focusKey !== null) this.restoreFocusKey(el, focusKey);
  }

  private restoreFocusKey(root: HTMLElement, focusKey: string): void {
    restoreFirstEnabled([
      root.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`),
      this.tabs[this.page],
      root.querySelector<HTMLElement>('[data-close]'),
    ]);
  }

  private buildTabs(totalSlots: number): HTMLElement {
    const strip = document.createElement('div');
    strip.className = 'bar-editor-tabs';
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', t('hudChrome.barEditor.pages'));
    for (let page = 0; page < barEditorPageCount(totalSlots); page++) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'bar-editor-tab';
      tab.dataset.focusKey = `bar-editor:tab:${page}`;
      tab.setAttribute('role', 'tab');
      tab.textContent = t('hudChrome.barEditor.pageTab', {
        page: formatNumber(page + 1, { maximumFractionDigits: 0 }),
      });
      tab.addEventListener('click', () => this.showPage(page));
      strip.appendChild(tab);
      this.tabs.push(tab);
    }
    return strip;
  }

  /** The Clear toggle. Touch had no way to EMPTY a slot at all (the desktop clear
   *  is shift plus right-click, which a phone cannot produce), so a bound slot
   *  could only be swapped or overwritten. Armed, the next cell tap empties that
   *  slot; it is a MODE rather than a per-cell control because the grid's cells
   *  are already the tap surface, and a second control per cell would halve every
   *  target at the tier that needs them largest. */
  private buildClearControl(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bar-editor-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bar-editor-clear';
    btn.dataset.focusKey = 'bar-editor:clear';
    btn.textContent = t('hudChrome.barEditor.clear');
    btn.setAttribute('aria-label', t('hudChrome.barEditor.clearAria'));
    btn.addEventListener('click', () => this.toggleClear());
    row.appendChild(btn);
    this.clearBtn = btn;
    return row;
  }

  private toggleClear(): void {
    if (!this.deps.editAllowed()) return;
    this.selection = toggleBarEditorClear(this.selection);
    audio.click();
    this.paint();
  }

  private buildGrid(totalSlots: number): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'bar-editor-grid';
    // A spacer over the direction column, then one header per ring button. The
    // headers are decoration: every cell's own accessible name already names its
    // button and direction, so repeating them to a screen reader adds noise.
    grid.appendChild(this.buildHeaderCell(''));
    for (let buttonIndex = 0; buttonIndex < MOBILE_ACTION_BUTTONS; buttonIndex++) {
      grid.appendChild(
        this.buildHeaderCell(
          t('hudChrome.barEditor.buttonHeader', {
            button: formatNumber(buttonIndex + 1, { maximumFractionDigits: 0 }),
          }),
        ),
      );
    }
    const cells = buildBarEditorGrid(this.page, totalSlots);
    cells.forEach((cell, index) => {
      if (index % MOBILE_ACTION_BUTTONS === 0) {
        grid.appendChild(this.buildHeaderCell(t(BAR_EDITOR_DIRECTION_KEYS[cell.direction])));
      }
      grid.appendChild(this.buildCell(cell));
    });
    return grid;
  }

  private buildHeaderCell(text: string): HTMLElement {
    const header = document.createElement('div');
    header.className = 'bar-editor-head';
    header.setAttribute('aria-hidden', 'true');
    header.textContent = text;
    return header;
  }

  private buildCell(cell: BarEditorCell): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bar-editor-cell';
    btn.dataset.barSlot = String(cell.slot);
    btn.dataset.focusKey = `bar-editor:cell:${cell.slot}`;
    const icon = document.createElement('span');
    icon.className = 'bar-editor-cell-icon';
    const name = document.createElement('span');
    name.className = 'bar-editor-cell-name';
    btn.append(icon, name);
    btn.addEventListener('click', () => this.tapCell(cell));
    this.cells.push({ cell, btn, icon, name });
    return btn;
  }

  private showPage(page: number): void {
    const totalSlots = this.deps.sourceSlotCount();
    const next = clampBarEditorPage(page, totalSlots);
    if (next === this.page) return;
    this.page = next;
    audio.click();
    // A pending pick SURVIVES the page switch on purpose: moving a binding from
    // one page to the other is the move the old drag could never make.
    this.render();
  }

  private tapCell(cell: BarEditorCell): void {
    if (!this.deps.editAllowed()) return;
    const tap = resolveBarEditorTap(this.selection, cell, this.actionForSlot(cell.slot) !== null);
    this.selection = tap.selection;
    if (tap.kind === 'place') this.deps.placeAbility(tap.abilityId, tap.slot);
    else if (tap.kind === 'swap') this.deps.swapSlots(tap.from, tap.to);
    else if (tap.kind === 'clear') this.deps.clearSlot(tap.slot);
    if (tap.kind !== 'idle') audio.click();
    // ONE tooltip hide for every mutation the editor makes (the desktop drop's
    // stale-tooltip rule), so each Hud callback stays the bar write plus the
    // shared save and no third one can forget it.
    if (tap.kind === 'place' || tap.kind === 'swap' || tap.kind === 'clear') {
      this.deps.hideTooltip();
    }
    this.paint();
  }

  /** In-place repaint of every cell from the live bar. Runs on open, on a page
   *  switch, and after a mutation this window made: never on a frame band. */
  private paint(): void {
    const picked = barEditorPickedSlot(this.selection);
    for (const ref of this.cells) {
      const action = ref.cell.inRange ? this.actionForSlot(ref.cell.slot) : null;
      const label = this.actionName(action);
      ref.icon.style.backgroundImage = this.iconBackground(action);
      ref.name.textContent = label ?? '';
      ref.btn.classList.toggle('empty', label === null);
      ref.btn.classList.toggle('out-of-range', !ref.cell.inRange);
      ref.btn.disabled = !ref.cell.inRange || !this.deps.editAllowed();
      ref.btn.setAttribute('aria-pressed', ref.cell.slot === picked ? 'true' : 'false');
      ref.btn.setAttribute(
        'aria-label',
        barEditorCellAria(ref.cell, label, {
          t,
          formatIndex: (value) => formatNumber(value, { maximumFractionDigits: 0 }),
        }),
      );
    }
    const clearArmed = barEditorClearArmed(this.selection);
    if (this.clearBtn) {
      this.clearBtn.setAttribute('aria-pressed', clearArmed ? 'true' : 'false');
      this.clearBtn.classList.toggle('active', clearArmed);
      this.clearBtn.disabled = !this.deps.editAllowed();
    }
    this.tabs.forEach((tab, page) => {
      tab.setAttribute('aria-selected', page === this.page ? 'true' : 'false');
      tab.classList.toggle('active', page === this.page);
    });
    if (this.caption) this.caption.textContent = this.captionText();
  }

  private captionText(): string {
    if (!this.deps.editAllowed()) return t('hudChrome.barEditor.locked');
    return barEditorCaption(this.selection, this.selectionName(), { t });
  }

  /** The localized name the caption speaks for whatever is armed or picked up. */
  private selectionName(): string | null {
    if (this.selection.kind === 'ability') {
      const def = ABILITIES[this.selection.abilityId];
      return def ? abilityDisplayName(def) : null;
    }
    if (this.selection.kind === 'slot')
      return this.actionName(this.actionForSlot(this.selection.slot));
    return null;
  }

  private actionForSlot(slot: number): HotbarAction {
    return this.deps.barActions()[slot - 1] ?? null;
  }

  private actionName(action: HotbarAction): string | null {
    if (action === null) return null;
    if (action.type === 'item') {
      const item = ITEMS[action.id];
      return item ? itemDisplayName(item) : null;
    }
    const def = ABILITIES[action.id];
    return def ? abilityDisplayName(def) : null;
  }

  private iconBackground(action: HotbarAction): string {
    if (action === null) return '';
    return `url(${iconDataUrl(action.type === 'item' ? 'item' : 'ability', action.id)})`;
  }
}
