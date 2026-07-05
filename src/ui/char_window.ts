// Thin DOM painter for the character window (the paperdoll sheet).
//
// The consumer half of the pure-core + thin-painter split: it paints
// #char-window from the structured PaperdollView (char_view.ts) plus the
// HUD-supplied stat / talent / progression fragments, and wires the equip-slot
// unequip / drag / tooltip affordances. It owns no Sim reference and reaches into
// Hud only through its deps.
//
// Two regions stay HUD concerns and are triggered here through callbacks, never
// built in this module: the shared 3D turntable preview (the single WebGL preview
// is borrowed by the skin-event overlay and the player card, so its lifecycle
// stays HUD-owned) and the cosmetic skin picker (its async mech-asset loading +
// preview remounts live with the preview). The pure core stays paperdoll-only; no
// 3D types or RNG cross into it.
//
// Colors live in the extracted stylesheet: item-quality tint comes
// from the shared QUALITY_COLOR map and the empty-slot greys are CSS tokens, so no
// raw hex sits in this painter.

import { audio } from '../game/audio';
import type { GatheringProfessionId } from '../sim/content/professions';
import { ITEMS } from '../sim/data';
import type { EquipSlot } from '../sim/types';
import type { IWorld } from '../world_api';
import { buildPaperdollView, type PaperdollSlot } from './char_view';
import { markDialogRoot } from './dialog_root';
import { classDisplayName, itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { buildGatheringProficiencyRows } from './gathering_view';
import { formatNumber, t } from './i18n';
import { iconDataUrl, QUALITY_COLOR } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { hydratePortraits, portraitChipHtml } from './portrait_chip';
import type { StatId } from './stat_tooltip';
import { svgIcon } from './ui_icons';

// Quality / empty-slot colors as CSS custom properties: the shared
// QUALITY_COLOR map carries the per-quality hex, and these tokens cover the
// unranked item plus the empty-slot label and icon border, so no raw hex lives
// in this painter.
const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';
const SLOT_EMPTY_TEXT_COLOR = 'var(--color-slot-empty-text)';
const SLOT_EMPTY_BORDER_COLOR = 'var(--color-slot-empty-border)';

// The ten character-sheet stat cells, primaries down the left column and derived
// stats down the right (the CSS grid wraps two per row). The HUD builds each cell
// from the unit-tested stat_tooltip_view model, so the order is the only stat
// concern this painter owns.
const STAT_GRID: readonly StatId[] = [
  'str',
  'armor',
  'agi',
  'attackPower',
  'sta',
  'dps',
  'int',
  'critChance',
  'spi',
  'dodge',
  'spellPower',
];

/**
 * Hud-supplied glue. Composes the shared PainterHostPresentation bag
 * (icon/tooltip) and adds the character-sheet surface: world reads, the localized
 * slot name, the HUD-built stat / talent / progression fragments, the unequip +
 * drag plumbing (the bags drop target reads HUD's drag slot), focus capture for
 * WCAG focus-return, and the two HUD-owned render regions (3D preview + skin
 * picker) invoked by callback.
 */
export interface CharWindowDeps extends PainterHostPresentation {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  hideTooltip(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  slotName(slot: EquipSlot): string;
  statCellHtml(stat: StatId): string;
  statTooltipHtml(stat: StatId): string;
  talentSummaryHtml(): string;
  progressionHtml(level: number): string;
  /** Remove the equipped piece in `slot` to bags and repaint bags + the sheet. */
  unequip(slot: EquipSlot): void;
  /** Stage a drag-to-unequip: record the slot HUD-side and reveal the bags drop. */
  beginUnequipDrag(slot: EquipSlot): void;
  /** End a drag-to-unequip: clear the HUD slot and the bags drop-target hint. */
  endUnequipDrag(): void;
  /** Mount the shared 3D turntable into the model panel (HUD-owned lifecycle). */
  renderPreview(): void;
  /** Paint the cosmetic skin picker into the skin row (HUD-owned cosmetics). */
  renderSkinPicker(): void;
  openPlayerCard(): void;
  openPrestige(): void;
}

// Maps each gathering profession id to its hud_chrome display-name key (issue 1124).
const GATHERING_PROFESSION_LABEL_KEY: Record<
  GatheringProfessionId,
  'hudChrome.gathering.mining' | 'hudChrome.gathering.logging' | 'hudChrome.gathering.herbalism'
> = {
  mining: 'hudChrome.gathering.mining',
  logging: 'hudChrome.gathering.logging',
  herbalism: 'hudChrome.gathering.herbalism',
};

const SHARE_GLYPH =
  '<svg class="pc-share-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M18 16.1a3 3 0 0 0-2.3 1.1l-6.7-3.9a3 3 0 0 0 0-2.6l6.7-3.9A3 3 0 1 0 15 4l-6.7 3.9a3 3 0 1 0 0 8.2L15 20a3 3 0 1 0 3-3.9z"/></svg>';

export class CharWindow {
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: CharWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.render();
    this.deps.root().style.display = 'block';
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') return;
    el.style.display = 'none';
    this.deps.hideTooltip();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  renderIfOpen(): void {
    if (this.isOpen) this.render();
  }

  render(): void {
    const el = this.deps.root();
    const world = this.deps.world();
    const p = world.player;
    const className = classDisplayName(world.cfg.playerClass);
    const level = formatNumber(p.level, { maximumFractionDigits: 0 });
    // WCAG 2.2 AA: name the focus-trapped root via the character title span.
    markDialogRoot(el, { labelledBy: 'char-title' });
    let html = `<div class="panel-title char-title-portrait">${portraitChipHtml({ cls: world.cfg.playerClass, skin: p.skin ?? 0, name: p.name, variant: 'md' })}<span class="char-title-text" id="char-title">${esc(p.name)} <span class="panel-subtitle">${esc(t('itemUi.equipment.levelClass', { level, className }))}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>`;
    html += `<div class="paperdoll">
      <div class="equip-col" id="equip-col-left"></div>
      <div class="char-model-panel">
        <div id="char-model-preview" class="char-model-preview" role="img" aria-label="${esc(t('hudChrome.character.modelPreview'))}"></div>
        <div id="char-skin-row" class="skin-row char-skin-row" role="list" aria-label="${esc(t('auth.appearance'))}"></div>
      </div>
      <div class="equip-col equip-col-right" id="equip-col-right"></div>
    </div>`;
    html += `<div class="char-stats">${STAT_GRID.map((stat) => this.deps.statCellHtml(stat)).join('')}</div>`;
    html += this.deps.talentSummaryHtml();
    html += this.deps.progressionHtml(p.level);
    html += this.gatheringHtml(world);
    html += `<div class="pc-share-row"><button type="button" class="btn pc-share-btn" data-act="share-card">${SHARE_GLYPH}<span>${esc(t('playerCard.shareButton'))}</span></button></div>`;
    el.innerHTML = html;
    hydratePortraits(el);
    el.querySelector('[data-act="prestige"]')?.addEventListener('click', () =>
      this.deps.openPrestige(),
    );
    el.querySelector('[data-act="share-card"]')?.addEventListener('click', () => {
      audio.click();
      this.deps.openPlayerCard();
    });

    const view = buildPaperdollView(world.equipment, ITEMS);
    const leftCol = el.querySelector('#equip-col-left');
    const rightCol = el.querySelector('#equip-col-right');
    for (const cell of view.left) leftCol?.appendChild(this.buildSlotRow(cell));
    for (const cell of view.right) rightCol?.appendChild(this.buildSlotRow(cell));

    for (const cell of el.querySelectorAll<HTMLElement>('.char-stats [data-stat]')) {
      const stat = cell.dataset.stat as StatId;
      // Resolve the tooltip lazily, on show, so the breakdown reflects the
      // player's current stats at the moment they hover, not at render time.
      this.deps.attachTooltip(cell, () => this.deps.statTooltipHtml(stat));
    }

    this.deps.renderPreview();
    this.deps.renderSkinPicker();
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  // The "Gathering" section (issue 1124): one row per gathering profession, showing
  // the viewer's own proficiency points (IWorldProfessions#professionsState).
  // Data comes from the pure gathering_view.ts core; this painter only formats it.
  private gatheringHtml(world: IWorld): string {
    const rows = buildGatheringProficiencyRows(world);
    const items = rows
      .map(
        (r) =>
          `<span>${esc(t(GATHERING_PROFESSION_LABEL_KEY[r.professionId]))}: <b>${formatNumber(r.value, { maximumFractionDigits: 0 })}</b></span>`,
      )
      .join('');
    return `<div class="char-progression"><div class="cp-title">${esc(t('hudChrome.gathering.title'))}</div><div class="char-stats cp-stats">${items}</div></div>`;
  }

  private buildSlotRow(cell: PaperdollSlot): HTMLElement {
    const { slot, item } = cell;
    const row = document.createElement('div');
    row.className = 'equip-slot';
    // Stable id + programmatic focusability so the corner-x rebuild can hand focus
    // back to this slot (the rebuilt row may be empty, with no x to focus).
    row.id = `equip-slot-${slot}`;
    row.tabIndex = -1;
    const qColor = !item
      ? SLOT_EMPTY_TEXT_COLOR
      : (QUALITY_COLOR[item.quality ?? 'common'] ?? QUALITY_DEFAULT_COLOR);
    const icon = item
      ? this.deps.itemIcon(item)
      : `<img class="item-icon" style="border-color:${SLOT_EMPTY_BORDER_COLOR}" src="${iconDataUrl('item', 'slot_empty')}" alt="" draggable="false">`;
    row.innerHTML = `${icon}
        <div><div class="slot-name">${esc(this.deps.slotName(slot))}</div><div class="slot-item" style="color:${qColor}">${item ? esc(itemDisplayName(item)) : esc(t('itemUi.equipment.empty'))}</div></div>`;
    if (item) {
      this.deps.attachTooltip(
        row,
        () =>
          `${this.deps.itemTooltip(item)}<div class="tt-sub">${esc(t('hudChrome.paperdoll.unequipHint'))}</div>`,
      );
      // Corner x: a styled glyph control (not an in-game icon), revealed on
      // hover/focus and always shown on touch where right-click is unavailable.
      const unequip = document.createElement('button');
      unequip.type = 'button';
      unequip.className = 'equip-unequip-btn';
      unequip.textContent = '×';
      unequip.setAttribute(
        'aria-label',
        t('hudChrome.paperdoll.unequipAria', { item: itemDisplayName(item) }),
      );
      unequip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.doUnequip(slot, true);
      });
      row.appendChild(unequip);
      // Right-click the slot (classic-MMO muscle memory; matches the bags grid).
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        this.doUnequip(slot, false);
      });
      // Drag the piece out onto the bags window to unequip it.
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        this.deps.beginUnequipDrag(slot);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        this.deps.hideTooltip();
      });
      row.addEventListener('dragend', () => this.deps.endUnequipDrag());
    } else {
      // Empty slot: still swallow the native menu so right-click feels consistent.
      row.addEventListener('contextmenu', (ev) => ev.preventDefault());
    }
    return row;
  }

  // `keepFocus` hands focus back to the now-empty slot row after the unequip
  // rebuilds the paperdoll (the innerHTML rebuild otherwise drops focus to
  // <body>); the keyboard/touch x path needs this, right-click and drag do not.
  private doUnequip(slot: EquipSlot, keepFocus: boolean): void {
    this.deps.unequip(slot);
    if (keepFocus) {
      const rebuilt = document.getElementById(`equip-slot-${slot}`);
      this.deps.restoreFocus(rebuilt instanceof HTMLElement ? rebuilt : null);
    }
  }
}
