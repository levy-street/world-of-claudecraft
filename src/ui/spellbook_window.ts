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
// extracted stylesheet, no literal hex/px in TS).
//
// THIS IS THE ONE WINDOW Hud.update() DRIVES ON THE PER-FRAME BAND
// (tests/hud_update_drive.test.ts records it as such), so the per-frame contract in
// src/ui/CLAUDE.md applies to `tickOpen` and everything it reaches: refs resolved
// once, no per-frame allocation, every repeated write elided. An unchanged frame
// costs two in-place comparisons and makes no element lookup, no allocation and no
// DOM write at all. The two gates that buy that are `knownChanged` (rebuild the
// rows only when a resolved ability's numbers moved) and `takeControlChange`
// (repaint the +/- toggles only when the bar state they render moved). Both compare
// retained values in place rather than through a derived id list or a joined
// signature string: a gate that allocates to decide it has nothing to do keeps most
// of the cost it was meant to save. What is NOT inside that claim, since it sits at
// the Hud call site rather than in here: the `isOpen` check that decides whether to
// tick at all still resolves `#spellbook` by id every frame.
//
// It stays a COLD painter in tests/hud_perf_budget.test.ts rather than moving into
// HOT_PAINTERS, and #2519 settled that rather than leaving it open. Two reasons,
// neither of them "windows are cold":
//   - The hot bucket's write contract is a per-FILE token count pinned EXACTLY, and
//     the count cannot tell CADENCE, which is the only thing #2519 was about. Most
//     of this file's raw-write tokens are build-time writes in render() /
//     appendAttackRow() / appendRow(), a minority are the repaint writes in
//     paintHotbarControls, and several are not writes at all (the style.display
//     read in isOpen, the classList.contains reads that pick a refocus target).
//     Pinning the total makes every ordinary edit to the markup a diff line in the
//     gate while saying nothing about which bucket a given write is in. Re-derive
//     the numbers with the gate's own instrument (stripComments plus RAW_WRITES in
//     tests/hud_perf_budget.test.ts) rather than from a figure quoted here, which
//     would rot: this comment quoted one for exactly one commit before the change
//     it describes deleted the per-row `dataset` read and falsified it.
//   - The other half of the contract does not fit at all: the PainterHost writers
//     elide through Maps KEYED BY ELEMENT, and this window replaces its whole row
//     set on every rebuild, so routing its build-time writes through the facet
//     would strand a cache entry per destroyed node.
// The instrument that does answer a cadence question is behavioral, and it is
// tests/spellbook_tick_repaint.test.ts.

import { audio } from '../game/audio';
import { ABILITIES, CLASSES } from '../sim/data';
import type { ResolvedAbility } from '../sim/sim';
import type { AbilityDef } from '../sim/types';
import type { IWorld } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { classDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import {
  encodeHotbarAction,
  HOTBAR_ACTION_MIME,
  HOTBAR_ATTACK_MIME,
  type HotbarAction,
  isAbilityActionBarEligible,
} from './hud/action_bar/hotbar';
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
  /**
   * The action bar's LIVE ability slots (index 0 = barSlot 1, Hud.hotbarActions'
   * own convention; slot 0 is the Attack control and is not in here).
   *
   * Handed over as the slot array rather than as a derived id list because the
   * per-frame change check below walks it on every frame the window is open, and
   * has to allocate nothing while it does. The two derived views this window used
   * to take instead (the on-bar id list, the per-slot id list the mobile page
   * label reads) were a `flatMap` and a `map` over 33 slots, i.e. 34 and 1 fresh
   * arrays per call, and the check called one of them 60 times a second. Both are
   * now derived at render time, where the allocation is paid once per rebuild.
   */
  barActions(): readonly HotbarAction[];
  /** The action bar has at least one empty slot. */
  hasFreeSlot(): boolean;
  /** The Attack toggle currently occupies bar slot 0 (showAttackButton on). */
  attackOnBar(): boolean;
  /** Restore (true) or remove (false) the Attack toggle on bar slot 0; routes
   *  through the same Interface showAttackButton setting the options window and
   *  the slot's right-click use, so all three controls stay one state. */
  setAttackOnBar(on: boolean): void;
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

/** The ability on a bar slot, or null for an empty slot or an item. */
function slotAbilityId(action: HotbarAction): string | null {
  return action !== null && action.type === 'ability' ? action.id : null;
}

/** One row's +/- toggle and the ability it belongs to, captured as the row is built. */
interface RowToggle {
  readonly abilityId: string;
  readonly btn: HTMLButtonElement;
}

export class SpellbookWindow {
  private openerFocus: HTMLElement | null = null;
  // The resolved abilities the last render painted, as the fields a row summary
  // displays: one id per ability in `knownIds`, and its rank / cost / castTime /
  // cooldown packed four to an ability in `knownNums`. Talent allocation while the
  // window is open reassigns world.known with new numbers; comparing this per frame
  // lets tickOpen rebuild the row summaries so their cost/cast/cooldown never go
  // stale (tooltip parity).
  //
  // Two retained arrays rather than the joined signature STRING this started as,
  // for the same reason the bar state below is compared in place: the comparison
  // runs on every frame the window is open, and building a signature over every
  // known ability allocated a string of a thousand-odd characters per frame only to
  // throw it away on the (overwhelmingly common) unchanged one. Comparing in place
  // also stops at the first field that moved instead of always walking the whole
  // set. Reference equality on world.known would be cheaper still and is WRONG: the
  // online mirror rebuilds that array every snapshot, so only the VALUES tell us a
  // talent actually changed a number.
  private readonly knownIds: string[] = [];
  private readonly knownNums: number[] = [];
  // The +/- toggles the last render painted, COLLECTED AS THOSE ROWS ARE BUILT
  // rather than re-queried from the tick. Before #2519 the per-frame refresh ran a
  // querySelector for the Attack toggle plus a querySelectorAll subtree walk over
  // every ability row, on every frame the window was open, which is the shape
  // src/ui/CLAUDE.md bans ("resolve element refs ONCE, never querySelector from a
  // per-frame path").
  //
  // Capturing at BUILD time rather than re-querying at the end of render() (the
  // shape lockpick_window had to use, whose nodes arrive from an innerHTML string)
  // costs zero queries even on a rebuild, and hands each row's ability id over
  // with its node, so the refresh does not read `dataset` per row either.
  //
  // The refs are dropped and re-collected in render(), which is the ONLY thing
  // that replaces these nodes: its innerHTML write destroys the whole list and
  // appendAttackRow / appendRow rebuild it. close() deliberately does not clear
  // them, because it only hides the root (the nodes stay attached and correct, and
  // re-opening re-renders anyway).
  private attackToggle: HTMLButtonElement | null = null;
  private readonly rowToggles: RowToggle[] = [];
  // The action-bar state those toggles were painted from. Everything the refresh
  // writes is a function of exactly these three, so an unchanged frame has nothing
  // to paint; see takeControlChange.
  private lastAttackOnBar = false;
  private lastHasFree = false;
  private readonly lastSlotIds: (string | null)[] = [];

  constructor(private readonly deps: SpellbookWindowDeps) {}

  /** Number fields packed per known ability in `knownNums`: rank, cost, castTime, cooldown. */
  private static readonly KNOWN_FIELDS = 4;

  /**
   * Did any field a row summary displays move since the last render?
   *
   * Walks in place against the retained copy and returns at the first difference,
   * so an unchanged frame costs a bounded run of primitive comparisons and no
   * allocation at all.
   *
   * The length check is not redundant with the id compare below it: a set that
   * SHRANK at the tail leaves every surviving index matching, so without it an
   * unlearned last ability would keep its row (and its live +/- toggle) for the
   * rest of the session.
   *
   * What it covers is the RESOLVED ABILITY, which is what the summary is built
   * from, and no more. `deps.abilitySummary` also folds in live player state (the
   * resource type, spell haste), so a change to those alone does not rebuild here.
   * That limit predates this gate (the signature string it replaced covered the
   * same five fields) and is left as it was.
   */
  private knownChanged(known: readonly ResolvedAbility[]): boolean {
    if (known.length !== this.knownIds.length) return true;
    for (let i = 0; i < known.length; i++) {
      const k = known[i];
      if (k.def.id !== this.knownIds[i]) return true;
      const at = i * SpellbookWindow.KNOWN_FIELDS;
      if (k.rank !== this.knownNums[at]) return true;
      if (k.cost !== this.knownNums[at + 1]) return true;
      if (k.castTime !== this.knownNums[at + 2]) return true;
      if (k.cooldown !== this.knownNums[at + 3]) return true;
    }
    return false;
  }

  /** Latch the resolved-ability numbers this render is painting. */
  private captureKnown(known: readonly ResolvedAbility[]): void {
    this.knownIds.length = 0;
    this.knownNums.length = 0;
    for (const k of known) {
      this.knownIds.push(k.def.id);
      this.knownNums.push(k.rank, k.cost, k.castTime, k.cooldown);
    }
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
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  // Per-frame entry while the window is open, and the ONLY window on that band.
  //
  // Two gates, and NEITHER fall-through does work on an unchanged frame. The first
  // rebuilds the whole list when a resolved ability's numbers changed (a talent
  // allocation reassigns world.known), so row summaries reflect current
  // cost/cast/cooldown. The second repaints the +/- toggles when the bar state they
  // render changed. A frame where neither moved costs the two comparisons and
  // nothing else: no subtree query, no allocation, no DOM write. Hover tooltips
  // resolve live regardless (see appendRow), so this covers the always-visible row
  // text, not the tooltip.
  tickOpen(): void {
    if (this.knownChanged(this.deps.world().known)) {
      this.rerenderPreservingView();
      return;
    }
    this.refreshHotbarControlsIfChanged();
  }

  /**
   * Re-localize after an in-game language switch (the Hud's woc:languagechange
   * fan-out). Self-gated on isOpen so the fan-out can call it unconditionally.
   *
   * tickOpen only rebuilds when a resolved ability's id, rank, cost, cast time
   * or cooldown moved, and the hotbar toggles elide their accessible names on
   * the on-bar state, all of it text-independent, so an open spellbook would
   * otherwise keep the old locale until the player learned something. Goes
   * through the scroll- and focus-preserving path for the same reason it exists:
   * the list rebuild is an innerHTML write on the scroll container.
   */
  relocalize(): void {
    if (!this.isOpen) return;
    this.rerenderPreservingView();
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
      else if (id && active.classList.contains('spell-row'))
        refocus = `.spell-row[data-ability-id="${id}"]`;
      else if (active.hasAttribute('data-reset-bar')) refocus = '[data-reset-bar]';
      else if (active.hasAttribute('data-close')) refocus = '[data-close]';
    }
    this.render();
    root.scrollTop = scrollTop;
    if (refocus) (root.querySelector(refocus) as HTMLElement | null)?.focus();
  }

  render(): void {
    const el = this.deps.root();
    const world = this.deps.world();
    this.captureKnown(world.known);
    // Drop the toggle refs BEFORE the innerHTML write below destroys their nodes,
    // and re-latch the bar state this paint is about to render from, so the next
    // tick compares against what actually went on screen rather than repainting a
    // fresh list. After this call lastSlotIds / lastHasFree / lastAttackOnBar
    // mirror the live bar, which is what the view inputs below read.
    this.forgetToggles();
    this.takeControlChange();
    const classId = world.cfg.playerClass;
    const cls = CLASSES[classId];
    // The kit list is the display order, but spec signatures and other talent grants are
    // known WITHOUT being in the base kit (e.g. mortal_strike, chain_heal, stormstrike), so
    // append any known-but-not-in-kit ability so the spellbook shows everything the player has.
    const kit = cls.abilities;
    const grantedExtra = world.known
      .map((k) => k.def.id)
      .filter((id) => !kit.includes(id) && !!ABILITIES[id]);
    const view = buildSpellbookView({
      classId,
      abilities: [...kit, ...grantedExtra],
      known: world.known,
      // Both bar views are derived from the one latched slot list: one allocation
      // per rebuild, where the per-frame path pays none. abilityIdByBarSlot feeds
      // the touch-only "Page N" chip, which appendRow emits at BUILD time and no
      // repaint touches, so moving an ability between bar slots leaves that chip
      // until the next rebuild. Pre-existing, and left as it was.
      barAbilityIds: this.lastSlotIds.filter((id): id is string => id !== null),
      abilityIdByBarSlot: this.lastSlotIds,
      hasFreeSlot: this.lastHasFree,
      attackOnBar: this.lastAttackOnBar,
      hasFormBars: this.deps.hasFormBars(),
      spec: world.talentSpec,
      level: world.player.level,
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
    this.appendAttackRow(list, view.attackOnBar);
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

  // Force the +/- toggles to match the bar as it stands right now.
  //
  // Public because Hud drives it after a bar change it made ITSELF and does not
  // want to wait a frame for (the login-time action-bar layout restore, the
  // reset-form-bar command), and because this window's own click handlers use it to
  // reflect a toggle press immediately. Latching first is what keeps that free:
  // the state this paint renders is recorded, so the tick that follows sees an
  // unchanged frame and repaints nothing.
  refreshHotbarControls(): void {
    this.takeControlChange();
    this.paintHotbarControls();
  }

  /**
   * The per-frame fall-through: repaint the toggles only when the bar state they
   * render actually moved.
   *
   * This is the half #2519 was about. Everything paintHotbarControls writes is a
   * function of exactly the three inputs takeControlChange reads, so a frame where
   * none of them moved has nothing to paint, and returning here costs no subtree
   * query, no allocation and no DOM write. Before that gate, the fall-through ran
   * two element lookups (one of them a full subtree walk over every ability row),
   * allocated a Set from a freshly built id list, and wrote `disabled` on every row
   * unelided, sixty times a second for as long as the window was open.
   */
  private refreshHotbarControlsIfChanged(): void {
    if (!this.takeControlChange()) return;
    this.paintHotbarControls();
  }

  /**
   * Read the three bar inputs the toggles render, report whether any of them
   * moved, and latch the new values when they did.
   *
   * ALLOCATION-FREE on the unchanged path, which is the whole point of taking the
   * bar as its live slot array (see `barActions`): the comparison walks that array
   * in place against the retained copy and stops at the first difference, instead
   * of building an id list or a joined signature string it would throw away on
   * every frame. Only a frame that really changed pays the copy back.
   *
   * `hasFreeSlot` is read separately rather than derived from the slot array here,
   * so the action bar keeps owning that rule (a slot can be occupied by an item,
   * and the controller decides what counts as free).
   */
  private takeControlChange(): boolean {
    const attackOnBar = this.deps.attackOnBar();
    const hasFree = this.deps.hasFreeSlot();
    const actions = this.deps.barActions();
    if (!this.controlsMoved(attackOnBar, hasFree, actions)) return false;
    this.lastAttackOnBar = attackOnBar;
    this.lastHasFree = hasFree;
    this.lastSlotIds.length = 0;
    for (const action of actions) this.lastSlotIds.push(slotAbilityId(action));
    return true;
  }

  private controlsMoved(
    attackOnBar: boolean,
    hasFree: boolean,
    actions: readonly HotbarAction[],
  ): boolean {
    if (attackOnBar !== this.lastAttackOnBar) return true;
    if (hasFree !== this.lastHasFree) return true;
    if (actions.length !== this.lastSlotIds.length) return true;
    for (let i = 0; i < actions.length; i++) {
      if (slotAbilityId(actions[i]) !== this.lastSlotIds[i]) return true;
    }
    return false;
  }

  // In-place repaint of the hotbar toggles from the latched bar state, over the
  // refs render() collected. Runs only behind one of the two entry points above,
  // never on an unchanged frame.
  private paintHotbarControls(): void {
    // The Attack toggle tracks the Interface showAttackButton setting, which can
    // flip while the window is open (the options window, or a right-click on the
    // slot-0 button itself). Same elision discipline as the ability toggles:
    // rewrite only when the on-bar state actually flips.
    const attackBtn = this.attackToggle;
    if (attackBtn) {
      const onBar = this.lastAttackOnBar;
      if ((attackBtn.getAttribute('aria-pressed') === 'true') !== onBar) {
        attackBtn.textContent = onBar ? '-' : '+';
        attackBtn.classList.toggle('remove', onBar);
        attackBtn.setAttribute('aria-pressed', onBar ? 'true' : 'false');
        attackBtn.setAttribute(
          'aria-label',
          t(onBar ? 'hudChrome.spellbook.removeFromBarAria' : 'hudChrome.spellbook.addToBarAria', {
            name: t('abilityUi.actionBar.attackName'),
          }),
        );
      }
    }
    const hasFree = this.lastHasFree;
    for (const { abilityId, btn } of this.rowToggles) {
      const onBar = this.lastSlotIds.includes(abilityId);
      // Elide the toggle-state writes per row: a repaint fires when ANY of the
      // three inputs moved, but the +/- text, the remove class, and the accessible
      // name only change when this row's on-bar membership flips, which
      // aria-pressed already records. Recomputing the i18n name + rewriting the
      // attribute for every row on every repaint was avoidable churn (matches the
      // elided-writer doctrine).
      if ((btn.getAttribute('aria-pressed') === 'true') !== onBar) {
        btn.textContent = onBar ? '-' : '+';
        btn.classList.toggle('remove', onBar);
        btn.setAttribute('aria-pressed', onBar ? 'true' : 'false');
        // Keep the accessible name in sync with the toggle state: a spoken
        // action ("Add/Remove {name} to action bar"), not a bare +/- glyph.
        // Same key pair as appendRow.
        const def = ABILITIES[abilityId];
        if (def)
          btn.setAttribute(
            'aria-label',
            t(
              onBar ? 'hudChrome.spellbook.removeFromBarAria' : 'hudChrome.spellbook.addToBarAria',
              {
                name: this.abilityName(def),
              },
            ),
          );
      }
      // `disabled` needs its own elision rather than riding the aria-pressed
      // branch above: it also depends on hasFree, which can change without any
      // on-bar flip (the bar filling up disables every off-bar row's add control
      // while no row's membership moved). Diffed against the live property so a
      // repaint writes only the rows that actually flipped.
      const disabled = !onBar && !hasFree;
      if (btn.disabled !== disabled) btn.disabled = disabled;
    }
  }

  /** Drop the toggle refs whose nodes the next render() is about to replace. */
  private forgetToggles(): void {
    this.attackToggle = null;
    this.rowToggles.length = 0;
  }

  // The pinned basic Attack row, first in the list (classic spellbooks lead with
  // Attack). Attack is not an ability: its +/- toggle restores or removes the
  // fixed Attack button on bar slot 0 through the same Interface
  // showAttackButton setting the options window drives, so a player who
  // right-clicked the button away can always get it back from here. Reuses the
  // existing attackName/attackTooltip keys and the add/remove aria pair; no new
  // player strings.
  private appendAttackRow(list: HTMLElement, onBar: boolean): void {
    const name = t('abilityUi.actionBar.attackName');
    const summary = t('abilityUi.actionBar.attackTooltip');
    const el = document.createElement('div');
    el.className = 'spell-row';
    el.tabIndex = 0;
    el.setAttribute('role', 'listitem');
    // No aria-label override: the row's own localized text (name + summary) is
    // the accessible content, unlike ability rows whose label folds in rank.
    el.innerHTML = `<div class="spell-icon" style="background-image:url(${iconDataUrl('ability', 'attack')})"></div>
        <div class="spell-text"><div class="spell-name">${esc(name)}</div>
        <div class="spell-sub">${esc(summary)}</div></div>`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `spell-hotbar-toggle${onBar ? ' remove' : ''}`;
    toggle.dataset.attackToggle = '1';
    toggle.textContent = onBar ? '-' : '+';
    toggle.setAttribute(
      'aria-label',
      t(onBar ? 'hudChrome.spellbook.removeFromBarAria' : 'hudChrome.spellbook.addToBarAria', {
        name,
      }),
    );
    toggle.setAttribute('aria-pressed', onBar ? 'true' : 'false');
    toggle.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    toggle.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.deps.setAttackOnBar(!this.deps.attackOnBar());
      audio.click();
      this.refreshHotbarControls();
    });
    // Hold the ref the refresh repaints, instead of re-finding this node by its
    // data-attack-toggle marker on every frame.
    this.attackToggle = toggle;
    el.appendChild(toggle);
    // Attack drags onto the action bar like any ability row. It has no ability/item
    // id, so it cannot ride the HotbarAction path: the dragstart carries the dedicated
    // Attack marker MIME, which the action bar accepts by turning showAttackButton back
    // on (restoring Attack to slot 0). The +/- toggle above stays for touch/keyboard.
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      if (e.dataTransfer) {
        e.dataTransfer.setData(HOTBAR_ATTACK_MIME, '1');
        e.dataTransfer.effectAllowed = 'move';
      }
      this.deps.hideTooltip();
    });
    el.addEventListener('dragend', () => {
      this.deps.clearActionDropTargets();
    });
    this.deps.attachTooltip(
      el,
      () =>
        `<div class="tt-title">${esc(t('abilityUi.actionBar.attackName'))}</div><div class="tt-sub">${esc(t('abilityUi.actionBar.attackTooltip'))}</div>`,
    );
    list.appendChild(el);
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
    if (known && isAbilityActionBarEligible(def)) {
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
        // Read the bar LIVE here rather than off the latched slot list: the latch
        // is at most one frame old, and a keybind that moved this ability in that
        // frame would otherwise send the click down the wrong branch, where
        // addToBar reports no change and the press does nothing at all.
        const onBar = this.deps.barActions().some((action) => slotAbilityId(action) === id);
        const changed = onBar ? this.deps.removeFromBar(id) : this.deps.addToBar(id);
        if (!changed) return;
        audio.click();
        this.refreshHotbarControls();
      });
      // Hold the ref (with its ability id) the refresh repaints, instead of
      // walking the whole list for `.spell-hotbar-toggle` on every frame.
      this.rowToggles.push({ abilityId: known.def.id, btn: toggle });
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
    }
    if (known) {
      // Resolve every learned ability LIVE at hover time, including informational
      // passive rows that deliberately have no action-bar controls.
      this.deps.attachTooltip(el, () => {
        const live = this.deps.world().known.find((k) => k.def.id === known.def.id) ?? known;
        return this.deps.abilityTooltip(live);
      });
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
