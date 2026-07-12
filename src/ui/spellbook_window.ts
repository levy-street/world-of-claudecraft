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
import { encodeHotbarAction, HOTBAR_ACTION_MIME, type HotbarAction } from './hotbar';
import { formatNumber, t } from './i18n';
import { iconDataUrl } from './icons';
import {
  buildMobileSpellbookPicker,
  buildSpellbookView,
  nextMobileSpellbookPickerPage,
  type SpellbookRow,
} from './spellbook_view';
import { bindTouchTap } from './touch_tap';
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
  /** The returned show accepts an optional right-edge boundary (visual px):
   *  the painted tooltip never extends past it (the touch rows pass the left
   *  edge of their +/x controls strip so the description stays clear of it). */
  attachTooltip(
    el: HTMLElement,
    html: () => string,
    enabled?: () => boolean,
    directFocusOnly?: boolean,
  ): (maxRightX?: number) => void;
  /** describeAbilitySummary(known, player.resourceType), localized Hud-side. */
  abilitySummary(known: ResolvedAbility): string;
  /** The full ability tooltip markup (Hud-owned). */
  abilityTooltip(known: ResolvedAbility): string;
  /** Ability ids currently on the action bar. */
  barAbilityIds(): string[];
  /** The hotbar's ability id per bar slot (index 0 = barSlot 1), used to derive
   *  each row's mobile action-ring page (Phase 4, touch-only presentation). */
  abilityIdByBarSlot(): (string | null)[];
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
  isTouch?(): boolean;
  hotbarActions?(): readonly HotbarAction[];
  barToken?(): string;
  itemName?(itemId: string): string;
  assignMobileSlot?(request: { abilityId: string; targetIndex: number; barToken: string }): {
    changed: boolean;
    stale: boolean;
  };
  setMobileActionPage?(page: number): void;
}

export class SpellbookWindow {
  private openerFocus: HTMLElement | null = null;
  // Signature of the resolved abilities the last render painted (id/rank/cost/
  // cast/cooldown). Talent allocation while the window is open reassigns
  // world.known with new numbers; comparing this per frame lets tickOpen rebuild
  // the row summaries so their cost/cast/cooldown never go stale (tooltip parity).
  private lastKnownSig = '';
  private lastBarSig = '';
  private pickerAbilityId: string | null = null;
  private pickerPage = 0;
  private pickerBarToken = '';
  private pickerOpener: HTMLElement | null = null;
  // The touch selection highlight: the row whose description was last shown or
  // whose slot picker is open. Tracked by ability id so it survives the
  // re-renders the picker and the hotbar refresh trigger.
  private selectedAbilityId: string | null = null;
  // The row whose description tooltip is open right now (touch only): a second
  // tap on the same row folds the description away instead of re-showing it.
  // Cleared by every path that hides the tooltip (strip dead zone, picker,
  // close), so a fresh tap after any of those shows again rather than toggling.
  private descriptionAbilityId: string | null = null;
  // True only while rerenderPreservingView restores focus: the programmatic
  // focus() fires the same focusin the tooltip listens to, which used to
  // reopen a description the player just dismissed (tapping X on a phone
  // rerenders the list and refocuses the row).
  private suppressDescriptionOnRefocus = false;

  constructor(private readonly deps: SpellbookWindowDeps) {}

  // Cheap content signature of the fields a row summary displays. Reference
  // equality on world.known will not do: the online mirror rebuilds that array
  // every snapshot, so only the VALUES tell us a talent actually changed a number.
  private static knownSig(known: readonly ResolvedAbility[]): string {
    let sig = '';
    for (const k of known) sig += `${k.def.id}:${k.rank}:${k.cost}:${k.castTime}:${k.cooldown}|`;
    return sig;
  }

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
    this.descriptionAbilityId = null;
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.markSelectedRow(null);
    this.clearPickerState();
    el.classList.remove('spell-slot-picker-open');
  }

  closePicker(): boolean {
    if (!this.pickerAbilityId) return false;
    const root = this.deps.root();
    root.querySelector('[data-spell-slot-picker]')?.remove();
    root.classList.remove('spell-slot-picker-open');
    this.clearPickerState();
    this.focusPickerOpener();
    return true;
  }

  // Per-frame entry while the window is open. Rebuilds the whole list only when a
  // resolved ability's numbers changed (a talent allocation reassigns world.known),
  // so row summaries reflect current cost/cast/cooldown; otherwise it just does the
  // cheap in-place +/- toggle refresh. Hover tooltips resolve live regardless (see
  // appendRow), so this covers the always-visible row text, not the tooltip.
  tickOpen(): void {
    if (SpellbookWindow.knownSig(this.deps.world().known) !== this.lastKnownSig) {
      this.rerenderPreservingView();
      return;
    }
    this.refreshHotbarControls();
  }

  // render() rebuilds the list via innerHTML, and the window root is the scroll
  // container, so a mid-session rebuild would jump the scroll to top and drop the
  // keyboard user's focus. Preserve both across the talent-driven rebuild: capture
  // scrollTop and the focused element's identity (a row or its +/- toggle, keyed by
  // ability id; or the close/reset control), then restore after the render.
  private rerenderPreservingView(): void {
    const root = this.deps.root();
    const scrollTop = root.scrollTop;
    const active = document.activeElement as HTMLElement | null;
    let refocus: string | null = null;
    if (active && root.contains(active)) {
      const id = active.dataset.abilityId;
      if (id && active.classList.contains('spell-hotbar-toggle'))
        refocus = `.spell-hotbar-toggle[data-ability-id="${id}"]`;
      else if (id && active.classList.contains('spell-assignment-chip'))
        refocus = `.spell-assignment-chip[data-ability-id="${id}"], .spell-hotbar-add[data-ability-id="${id}"]`;
      else if (id && active.classList.contains('spell-hotbar-remove'))
        refocus = `.spell-hotbar-remove[data-ability-id="${id}"], .spell-hotbar-add[data-ability-id="${id}"]`;
      else if (id && active.classList.contains('spell-hotbar-add'))
        refocus = `.spell-hotbar-add[data-ability-id="${id}"], .spell-assignment-chip[data-ability-id="${id}"]`;
      else if (active.classList.contains('spell-slot-destination'))
        refocus = `.spell-slot-destination[data-source-slot="${active.dataset.sourceSlot}"]`;
      else if (active.getAttribute('role') === 'tab')
        refocus = `[role="tab"][data-picker-page="${active.dataset.pickerPage}"]`;
      else if (id && active.classList.contains('spell-row'))
        refocus = `.spell-row[data-ability-id="${id}"]`;
      else if (active.hasAttribute('data-reset-bar')) refocus = '[data-reset-bar]';
      else if (active.hasAttribute('data-close')) refocus = '[data-close]';
    }
    refocus ??= '[data-close]';
    this.render();
    root.scrollTop = scrollTop;
    // The focus restore is bookkeeping, not a fresh description request: gate
    // the tooltip's focusin path while the synchronous focus() call runs.
    this.suppressDescriptionOnRefocus = true;
    (root.querySelector(refocus) as HTMLElement | null)?.focus();
    this.suppressDescriptionOnRefocus = false;
  }

  render(): void {
    const el = this.deps.root();
    const world = this.deps.world();
    this.lastKnownSig = SpellbookWindow.knownSig(world.known);
    this.lastBarSig = this.barSignature();
    const classId = world.cfg.playerClass;
    const cls = CLASSES[classId];
    const view = buildSpellbookView({
      classId,
      abilities: cls.abilities,
      known: world.known,
      barAbilityIds: this.deps.barAbilityIds(),
      abilityIdByBarSlot: this.deps.abilityIdByBarSlot(),
      hasFreeSlot: this.deps.hasFreeSlot(),
      hasFormBars: this.deps.hasFormBars(),
      touchPresentation: this.isTouch(),
    });
    const className = classDisplayName(view.classId);
    markDialogRoot(el, { label: t('abilityUi.spellbook.title') });
    // "Reset bar" only applies to classes with per-form bars (druid); other classes
    // have a single bar, so the button is omitted for them.
    const resetBtnHtml = view.hasFormBars
      ? `<button type="button" class="x-btn spellbook-reset" data-reset-bar aria-label="${esc(t('abilityUi.spellbook.resetBarAria'))}">${esc(t('abilityUi.spellbook.resetBar'))}</button>`
      : '';
    el.innerHTML = `<div class="panel-title"><span>${esc(t('abilityUi.spellbook.title'))} <span class="spellbook-class">${esc(t('abilityUi.spellbook.classSubtitle', { className }))}</span></span><div class="panel-title-actions">${resetBtnHtml}<button type="button" class="x-btn" data-close aria-label="${esc(t('abilityUi.spellbook.close'))}">${svgIcon('close')}</button></div></div>`;
    const status = document.createElement('div');
    status.className = 'spell-assignment-status';
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    el.appendChild(status);
    const list = document.createElement('div');
    list.className = 'spell-list';
    list.setAttribute('role', 'list');
    el.appendChild(list);
    for (const row of view.rows) this.appendRow(list, row);
    if (this.pickerAbilityId) this.renderPicker();
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
    if (this.isTouch() && this.lastBarSig !== this.barSignature()) {
      this.rerenderPreservingView();
      return;
    }
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
        btn.disabled = !this.isTouch() && !onBar && !hasFree;
      });
  }

  private appendRow(list: HTMLElement, row: SpellbookRow): void {
    const def = ABILITIES[row.abilityId];
    const known = row.known;
    const el = document.createElement('div');
    el.className = `spell-row${known ? '' : ' locked'}`;
    el.tabIndex = 0;
    el.setAttribute('role', 'listitem');
    // Ability id on the row so a talent-driven rerenderPreservingView() can restore
    // scroll focus to the same row after it rebuilds the list.
    el.dataset.abilityId = row.abilityId;
    if (row.abilityId === this.selectedAbilityId) el.classList.add('is-selected');
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
      if (this.isTouch()) {
        this.appendTouchControls(el, row, name);
        const showDescription = this.deps.attachTooltip(
          el,
          () => this.deps.abilityTooltip(known),
          () => this.pickerAbilityId === null && !this.suppressDescriptionOnRefocus,
          true,
        );
        bindTouchTap(el, () => {
          if (this.pickerAbilityId !== null) return;
          if (this.descriptionAbilityId === row.abilityId) {
            // Same row again: the tap toggles its open description closed.
            this.descriptionAbilityId = null;
            this.deps.hideTooltip();
            this.markSelectedRow(null);
            return;
          }
          this.descriptionAbilityId = row.abilityId;
          this.markSelectedRow(row.abilityId);
          // The description stops at the +/x column: pass the strip's left
          // boundary so the tooltip never covers the row's own buttons.
          const controls = el.querySelector<HTMLElement>('.spell-touch-controls');
          showDescription(controls ? controls.getBoundingClientRect().left : undefined);
        });
        list.appendChild(el);
        return;
      }
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
      // Touch-only page label (Phase 4): names which mobile action-ring page
      // (Phase 1) this bar-assigned row's slot falls on, so a touch player who
      // added it from the spellbook knows where to find it on the ring. Desktop
      // rendering is untouched (row.mobilePage is still computed either way, but
      // the label never appends without the touch gate).
      if (row.mobilePage !== null && document.body.classList.contains('mobile-touch')) {
        const pageLabel = document.createElement('span');
        pageLabel.className = 'spell-mobile-page';
        pageLabel.textContent = t('hudChrome.mobile.spellbookPageLabel', {
          page: this.formatAbilityNumber(row.mobilePage + 1),
        });
        el.appendChild(pageLabel);
      }
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
      // Resolve the ability LIVE at hover time, not the object captured at render:
      // a talent allocated while the spellbook is open reassigns world.known with a
      // new cost/damage, and this row's tooltip must reflect it even before the next
      // tickOpen rebuild lands.
      this.deps.attachTooltip(
        el,
        () => {
          const live = this.deps.world().known.find((k) => k.def.id === known.def.id) ?? known;
          return this.deps.abilityTooltip(live);
        },
        () => !this.suppressDescriptionOnRefocus,
        true,
      );
    } else {
      this.deps.attachTooltip(
        el,
        () =>
          `<div class="tt-title">${esc(name)}</div><div class="tt-sub">${esc(t('abilityUi.spellbook.learnAtLevel', { level: learnLevel }))}</div>`,
        () => !this.suppressDescriptionOnRefocus,
      );
    }
    list.appendChild(el);
  }

  private appendTouchControls(el: HTMLElement, row: SpellbookRow, name: string): void {
    const controls = document.createElement('div');
    controls.className = 'spell-touch-controls';
    // The whole controls strip is a description dead zone: a tap ON one of its
    // buttons or AROUND them must never open the row description. Stopping only
    // the pointerdown is not enough on a phone: the row's touch-tap never
    // records the swallowed pointer, but the browser still synthesizes a click
    // that bubbles through the strip into the row, which reads it as a fresh
    // mouse activation. Stop BOTH here (click in the bubble phase, so the
    // Add/assignment/Remove handlers underneath keep firing first).
    const dismissDescription = (event: Event) => {
      this.descriptionAbilityId = null;
      this.deps.hideTooltip();
      event.stopPropagation();
    };
    controls.addEventListener('pointerdown', dismissDescription);
    controls.addEventListener('click', dismissDescription);
    if (row.assignment.kind === 'unassigned') {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'spell-hotbar-toggle spell-hotbar-add';
      add.dataset.abilityId = row.abilityId;
      add.textContent = '+';
      add.setAttribute('aria-label', t('hudChrome.spellbook.addToBarAria', { name }));
      add.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openPicker(row.abilityId, add);
      });
      controls.appendChild(add);
    } else {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'spell-assignment-chip';
      chip.dataset.abilityId = row.abilityId;
      const label =
        row.assignment.kind === 'mobile'
          ? t('hudChrome.spellbook.mobileChip', {
              page: this.formatAbilityNumber(row.assignment.page + 1),
              position: this.formatAbilityNumber(row.assignment.position),
            })
          : t('hudChrome.spellbook.desktopChip');
      chip.textContent = label;
      chip.setAttribute(
        'aria-label',
        t('hudChrome.spellbook.moveAssignmentAria', { name, slot: label }),
      );
      chip.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.pickerAbilityId === row.abilityId) this.closePicker();
        else this.openPicker(row.abilityId, chip);
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'spell-hotbar-remove';
      remove.dataset.abilityId = row.abilityId;
      remove.innerHTML = svgIcon('close');
      remove.setAttribute('aria-label', t('hudChrome.spellbook.removeFromBarAria', { name }));
      remove.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.deps.removeFromBar(row.abilityId)) audio.click();
        this.refreshHotbarControls();
      });
      controls.append(chip, remove);
    }
    el.appendChild(controls);
  }

  // Move the touch selection highlight: exactly one row carries .is-selected,
  // the one whose description or slot picker the player last activated.
  private markSelectedRow(abilityId: string | null): void {
    this.selectedAbilityId = abilityId;
    for (const row of this.deps.root().querySelectorAll<HTMLElement>('.spell-row')) {
      row.classList.toggle(
        'is-selected',
        abilityId !== null && row.dataset.abilityId === abilityId,
      );
    }
  }

  private openPicker(abilityId: string, opener: HTMLElement): void {
    this.deps.hideTooltip();
    this.descriptionAbilityId = null;
    this.markSelectedRow(abilityId);
    this.pickerAbilityId = abilityId;
    this.pickerBarToken = this.deps.barToken?.() ?? '';
    this.pickerOpener = opener;
    const actions = this.deps.hotbarActions?.() ?? [];
    const assignment = buildMobileSpellbookPicker({
      actions,
      abilityId,
      selectedPage: this.pickerPage,
      barToken: this.pickerBarToken,
    }).assignment;
    if (assignment.kind === 'mobile') this.pickerPage = assignment.page;
    this.renderPicker();
  }

  private renderPicker(): void {
    const root = this.deps.root();
    root.querySelector('[data-spell-slot-picker]')?.remove();
    if (!this.pickerAbilityId) return;
    root.classList.add('spell-slot-picker-open');
    root.scrollTop = 0;
    const picker = buildMobileSpellbookPicker({
      actions: this.deps.hotbarActions?.() ?? [],
      abilityId: this.pickerAbilityId,
      selectedPage: this.pickerPage,
      barToken: this.pickerBarToken,
    });
    const panel = document.createElement('section');
    panel.className = 'spell-slot-picker';
    panel.dataset.spellSlotPicker = '';
    const tabs = document.createElement('div');
    tabs.className = 'spell-slot-picker-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', t('hudChrome.spellbook.pickerPages'));
    for (const tab of picker.tabs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', tab.selected ? 'true' : 'false');
      button.dataset.pickerPage = String(tab.page);
      button.tabIndex = tab.tabIndex;
      button.textContent = this.formatAbilityNumber(tab.page + 1);
      button.addEventListener('click', () => this.selectPickerPage(tab.page));
      button.addEventListener('keydown', (event) => {
        const page = nextMobileSpellbookPickerPage(tab.page, event.key);
        if (page === tab.page) return;
        event.preventDefault();
        this.selectPickerPage(page);
      });
      tabs.appendChild(button);
    }
    const group = document.createElement('div');
    group.className = 'spell-slot-picker-destinations';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t('hudChrome.spellbook.pickerDestinations'));
    for (const destination of picker.destinations) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'spell-slot-destination';
      button.classList.toggle('has-occupant', !!destination.occupant);
      button.dataset.sourceSlot = String(destination.sourceSlot);
      if (destination.current) button.setAttribute('aria-current', 'true');
      const actionName = this.destinationActionName(destination.occupant);
      button.setAttribute(
        'aria-label',
        t('hudChrome.spellbook.destinationAria', {
          page: this.formatAbilityNumber(destination.page + 1),
          position: this.formatAbilityNumber(destination.position),
          state: actionName ?? t('hudChrome.spellbook.empty'),
        }),
      );
      button.innerHTML = destination.occupant
        ? `<span class="spell-slot-icon" style="background-image:url(${iconDataUrl(destination.occupant.type, destination.occupant.id)})"></span><span class="spell-slot-label">A${esc(this.formatAbilityNumber(destination.position))}</span>`
        : `<span class="spell-slot-label">A${esc(this.formatAbilityNumber(destination.position))}</span>`;
      const assign = () => this.assignPickerDestination(destination.sourceSlot - 1);
      button.addEventListener('click', assign);
      button.addEventListener('keydown', (event) => {
        const key = event.key;
        if (key === 'Enter' || key === ' ') {
          event.preventDefault();
          assign();
        }
      });
      group.appendChild(button);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'spell-slot-picker-close';
    close.setAttribute('aria-label', t('hudChrome.spellbook.closePicker'));
    close.innerHTML = svgIcon('close');
    close.addEventListener('click', () => this.closePicker());
    panel.append(tabs, group, close);
    root.querySelector('.panel-title')?.after(panel);
    const destinations = panel.querySelectorAll<HTMLButtonElement>('.spell-slot-destination');
    destinations[picker.focusDestinationIndex]?.focus();
  }

  private selectPickerPage(page: number): void {
    this.pickerPage = page;
    this.renderPicker();
    this.deps.root().querySelectorAll<HTMLButtonElement>('[role="tab"]')[page]?.focus();
  }

  private assignPickerDestination(targetIndex: number): void {
    if (!this.pickerAbilityId) return;
    const abilityId = this.pickerAbilityId;
    const result = this.deps.assignMobileSlot?.({
      abilityId,
      targetIndex,
      barToken: this.pickerBarToken,
    });
    if (!result || result.stale) return;
    let announcement = '';
    if (result.changed) {
      this.deps.setMobileActionPage?.(Math.floor(targetIndex / 5));
      announcement = t('hudChrome.spellbook.assignedStatus', {
        name: this.abilityName(ABILITIES[abilityId]),
        page: this.formatAbilityNumber(Math.floor(targetIndex / 5) + 1),
        position: this.formatAbilityNumber((targetIndex % 5) + 1),
      });
      audio.click();
    }
    this.closePicker();
    this.rerenderPreservingView();
    const status = this.deps.root().querySelector<HTMLElement>('.spell-assignment-status');
    if (status) status.textContent = announcement;
    this.deps
      .root()
      .querySelector<HTMLElement>(`.spell-assignment-chip[data-ability-id="${abilityId}"]`)
      ?.focus();
  }

  private destinationActionName(action: HotbarAction): string | null {
    if (!action) return null;
    if (action.type === 'ability') return this.abilityName(ABILITIES[action.id]);
    return this.deps.itemName?.(action.id) ?? action.id;
  }

  private barSignature(): string {
    return (this.deps.hotbarActions?.() ?? [])
      .map((action) => (action ? `${action.type}:${action.id}` : ''))
      .join('|');
  }

  private isTouch(): boolean {
    return this.deps.isTouch?.() ?? document.body.classList.contains('mobile-touch');
  }

  private clearPickerState(): void {
    this.pickerAbilityId = null;
    this.pickerPage = 0;
    this.pickerBarToken = '';
  }

  private focusPickerOpener(): void {
    this.pickerOpener?.focus();
    this.pickerOpener = null;
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
