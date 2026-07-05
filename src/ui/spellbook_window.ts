// Thin DOM painter for the spellbook window.
//
// The consumer half of the pure-core + thin-painter split: it paints #spellbook
// from the structured SpellbookView (spellbook_view.ts) and owns the window's DOM
// wiring (per-row hotbar toggle, drag-to-bar, tooltips, the per-form reset button,
// the WCAG focus opener). The pure core decides the class kit order + each row's
// learned / rank / on-bar / disabled state; this module renders that, resolves the
// localized name / summary / icon, and routes the hotbar + drag commands back
// through injected callbacks. It holds no Sim reference and reaches into Hud only
// through its deps.
//
// Ability icons resolve via iconDataUrl (the procedural ability-icon source), not
// the PainterHost item-icon helper: that helper paints ItemDef rows, and the
// spellbook renders abilities. It is NOT a canvas window (colors live in the
// extracted stylesheet, no literal hex/px in TS). refreshHotbarControls
// is the one not-cold touch: hud.update() calls it while the window is open so the
// +/- toggles track action-bar changes without a full rebuild.

import { audio } from '../game/audio';
import { ABILITIES, CLASSES } from '../sim/data';
import type { ResolvedAbility } from '../sim/sim';
import type { AbilityDef } from '../sim/types';
import type { IWorld } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { classDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { encodeHotbarAction, HOTBAR_ACTION_MIME } from './hotbar';
import { formatNumber, t } from './i18n';
import { iconDataUrl } from './icons';
import { buildSpellbookView, type SpellbookRow } from './spellbook_view';
import { svgIcon } from './ui_icons';

/**
 * Hud-supplied glue. The spellbook renders from IWorld + these callbacks; it never
 * reaches into Hud directly. abilitySummary/abilityTooltip resolve the localized
 * ability copy Hud owns; the bar / drag callbacks keep the action-bar state on the
 * HUD; captureFocus/restoreFocus add the WCAG focus-return the inline site lacked.
 */
export interface SpellbookWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  hideTooltip(): void;
  attachTooltip(el: HTMLElement, html: () => string): void;
  /** describeAbilitySummary(known, player.resourceType), localized Hud-side. */
  abilitySummary(known: ResolvedAbility): string;
  /** The full ability tooltip markup (Hud-owned). */
  abilityTooltip(known: ResolvedAbility): string;
  /** Ability ids currently on the action bar. */
  barAbilityIds(): string[];
  /** The action bar has at least one empty slot. */
  hasFreeSlot(): boolean;
  /** Place an ability on the first free slot; returns whether it changed. */
  addToBar(abilityId: string): boolean;
  /** Remove an ability from the bar; returns whether it changed. */
  removeFromBar(abilityId: string): boolean;
  /** The class has per-form bars (druid), enabling the reset-bar button. */
  hasFormBars(): boolean;
  /** Reset the active form bar to its default kit. */
  resetFormBar(): void;
  setDragAction(action: { type: 'ability'; id: string } | null): void;
  clearActionDropTargets(): void;
}

export class SpellbookWindow {
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: SpellbookWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    // Capture the opener BEFORE closing other windows, so a sibling window's own
    // focus-return on close cannot clobber the element we restore to (WCAG).
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.render();
    this.deps.root().style.display = 'block';
    (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    el.style.display = 'none';
    this.deps.hideTooltip();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  render(): void {
    const el = this.deps.root();
    const world = this.deps.world();
    const classId = world.cfg.playerClass;
    const cls = CLASSES[classId];
    const view = buildSpellbookView({
      classId,
      abilities: cls.abilities,
      known: world.known,
      barAbilityIds: this.deps.barAbilityIds(),
      hasFreeSlot: this.deps.hasFreeSlot(),
      hasFormBars: this.deps.hasFormBars(),
    });
    const className = classDisplayName(view.classId);
    markDialogRoot(el, { label: t('abilityUi.spellbook.title') });
    // "Reset bar" only applies to classes with per-form bars (druid); other classes
    // have a single bar, so the button is omitted for them.
    const resetBtnHtml = view.hasFormBars
      ? `<button type="button" class="x-btn spellbook-reset" data-reset-bar aria-label="${esc(t('abilityUi.spellbook.resetBarAria'))}">${esc(t('abilityUi.spellbook.resetBar'))}</button>`
      : '';
    el.innerHTML = `<div class="panel-title"><span>${esc(t('abilityUi.spellbook.title'))} <span class="spellbook-class">${esc(t('abilityUi.spellbook.classSubtitle', { className }))}</span></span><div class="panel-title-actions">${resetBtnHtml}<button type="button" class="x-btn" data-close aria-label="${esc(t('abilityUi.spellbook.close'))}">${svgIcon('close')}</button></div></div>`;
    const list = document.createElement('div');
    list.className = 'spell-list';
    list.setAttribute('role', 'list');
    el.appendChild(list);
    for (const row of view.rows) this.appendRow(list, row);
    if (view.empty) {
      const empty = document.createElement('div');
      empty.className = 'spell-sub';
      empty.textContent = t('abilityUi.spellbook.empty');
      list.appendChild(empty);
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    const resetBtn = el.querySelector('[data-reset-bar]');
    resetBtn?.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    resetBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.deps.resetFormBar();
      audio.click();
    });
  }

  // In-place refresh of the per-row hotbar toggles, called from hud.update() while
  // the window is open so the +/- state tracks action-bar changes (drag-drop,
  // keybind use) without a full rebuild. Mirrors the inline refreshSpellbookHotbar
  // controls but scoped to this window's root.
  refreshHotbarControls(): void {
    const barIds = new Set(this.deps.barAbilityIds());
    const hasFree = this.deps.hasFreeSlot();
    this.deps
      .root()
      .querySelectorAll<HTMLButtonElement>('.spell-hotbar-toggle')
      .forEach((btn) => {
        const id = btn.dataset.abilityId;
        if (!id) return;
        const onBar = barIds.has(id);
        // Elide the toggle-state writes: this runs every frame while the window is
        // open, but the +/- text, the remove class, and the accessible name only
        // change when on-bar membership flips (a drag-drop / keybind use), which
        // aria-pressed already records. Recomputing the i18n name + rewriting the
        // attribute every frame was avoidable churn (matches the elided-writer
        // doctrine). `disabled` stays per-frame: it also depends
        // on hasFree, which can change without an on-bar flip.
        if ((btn.getAttribute('aria-pressed') === 'true') !== onBar) {
          btn.textContent = onBar ? '-' : '+';
          btn.classList.toggle('remove', onBar);
          btn.setAttribute('aria-pressed', onBar ? 'true' : 'false');
          // Keep the accessible name in sync with the toggle state: a spoken
          // action ("Add/Remove {name} to action bar"), not a bare +/- glyph.
          // Same key pair as appendRow.
          const def = ABILITIES[id];
          if (def)
            btn.setAttribute(
              'aria-label',
              t(
                onBar
                  ? 'hudChrome.spellbook.removeFromBarAria'
                  : 'hudChrome.spellbook.addToBarAria',
                {
                  name: this.abilityName(def),
                },
              ),
            );
        }
        btn.disabled = !onBar && !hasFree;
      });
  }

  private appendRow(list: HTMLElement, row: SpellbookRow): void {
    const def = ABILITIES[row.abilityId];
    const known = row.known;
    const el = document.createElement('div');
    el.className = `spell-row${known ? '' : ' locked'}`;
    el.tabIndex = 0;
    el.setAttribute('role', 'listitem');
    const locked = !known;
    const summary = known ? this.deps.abilitySummary(known) : '';
    const name = this.abilityName(def);
    const learnLevel = this.formatAbilityNumber(def.learnLevel);
    el.setAttribute(
      'aria-label',
      known
        ? t('abilityUi.spellbook.knownAbilityAria', {
            name,
            rank: this.formatAbilityNumber(known.rank),
            summary,
          })
        : t('abilityUi.spellbook.unlearnedAbilityAria', { name, level: learnLevel }),
    );
    el.innerHTML = `<div class="spell-icon" style="background-image:url(${iconDataUrl('ability', row.abilityId)})"></div>
        <div class="spell-text"><div class="spell-name">${esc(name)}${known && known.rank > 1 ? ` <span class="spell-rank">${esc(t('abilityUi.tooltip.rank', { rank: this.formatAbilityNumber(known.rank) }))}</span>` : ''}</div>
        <div class="spell-sub">${locked ? esc(t('abilityUi.spellbook.trainableAtLevel', { level: learnLevel })) : esc(summary)}</div></div>`;
    if (known) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = `spell-hotbar-toggle${row.onBar ? ' remove' : ''}`;
      toggle.dataset.abilityId = known.def.id;
      toggle.textContent = row.onBar ? '-' : '+';
      toggle.setAttribute(
        'aria-label',
        t(
          row.onBar ? 'hudChrome.spellbook.removeFromBarAria' : 'hudChrome.spellbook.addToBarAria',
          {
            name,
          },
        ),
      );
      toggle.setAttribute('aria-pressed', row.onBar ? 'true' : 'false');
      toggle.disabled = row.toggleDisabled;
      toggle.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      toggle.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = known.def.id;
        const changed = this.deps.barAbilityIds().includes(id)
          ? this.deps.removeFromBar(id)
          : this.deps.addToBar(id);
        if (!changed) return;
        audio.click();
        this.refreshHotbarControls();
      });
      el.appendChild(toggle);
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        const action = { type: 'ability' as const, id: known.def.id };
        this.deps.setDragAction(action);
        this.writeDraggedAction(e.dataTransfer, action);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        this.deps.hideTooltip();
      });
      el.addEventListener('dragend', () => {
        this.deps.setDragAction(null);
        this.deps.clearActionDropTargets();
      });
      this.deps.attachTooltip(el, () => this.deps.abilityTooltip(known));
    } else {
      this.deps.attachTooltip(
        el,
        () =>
          `<div class="tt-title">${esc(name)}</div><div class="tt-sub">${esc(t('abilityUi.spellbook.learnAtLevel', { level: learnLevel }))}</div>`,
      );
    }
    list.appendChild(el);
  }

  // Reproduced from the exported hotbar encoder so cross-window drag state stays on
  // the HUD via the deps (mirrors bags_window).
  private writeDraggedAction(
    dt: DataTransfer | null,
    action: { type: 'ability'; id: string },
  ): void {
    if (!dt) return;
    dt.setData(HOTBAR_ACTION_MIME, encodeHotbarAction(action));
    dt.setData('text/plain', action.id);
  }

  private abilityName(def: AbilityDef): string {
    return tEntity({ kind: 'ability', id: def.id, field: 'name' });
  }

  private formatAbilityNumber(value: number): string {
    return formatNumber(value, { maximumFractionDigits: 1 });
  }
}
