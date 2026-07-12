// Thin DOM painter for the talents & specializations window.
//
// The consumer half of the pure-core + thin-painter split: it paints
// #talents-window from the structured TalentsView (talents_view.ts) and owns the
// interactive wiring (the frame tab rail, the spec radiogroup, the tiered talent
// cards, the choice flyout, and the build/loadout footer). It composes the shared
// PainterHostPresentation bag (only attachTooltip is relevant for this window) plus
// the talents-specific glue Hud injects.
//
// TIERED-CHOICES LAYOUT: the window is a classic tiered picker. The titlebar reads
// "Talents" plus the class name; a status strip shows the staged choice count and
// the chosen specialization; the shared frame tab rail switches between the
// CHOICES tab (the class tree as unlock-level tier rows of talent cards) and the
// SPECIALIZATION tab (the spec radiogroup plus the chosen spec's tier rows); the
// build/loadout panels close the body. COLD PATH: everything repaints on
// open/change only, never per frame.
//
// STAGED-EDIT MODEL: the user edits a LOCAL mutable buffer (a `cloneAllocation` of
// the live IWorld.talents). Hud owns that single buffer; this painter reads it via
// `deps.getStage()` and replaces it via `deps.setStage()`, and the mutation handlers
// (spend / remove / setSpec / footer reset) mutate that same object IN PLACE before
// re-deriving + repainting. The build only commits to the server-authoritative
// IWorld on save / loadout-switch / delete (deps.saveLoadout / switchLoadout /
// deleteLoadout), never inline. The painter never clones a second buffer of its own.
//
// No raw hex: the inline tooltip colors reference --color-* custom properties via
// TAL_COLOR; every layout color lives in the stylesheet (tokens only). No em dashes
// anywhere (the mastery / choice separator is ASCII " - ").

import {
  cloneAllocation,
  exportBuild,
  FIRST_TALENT_LEVEL,
  importBuild,
  type SavedLoadout,
  type TalentAllocation,
  type TalentNode,
  talentsFor,
  validateAllocation,
} from '../sim/content/talents';
import { ABILITIES } from '../sim/data';
import { MAX_LEVEL, type PlayerClass } from '../sim/types';
import { classDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { rovingTarget } from './roving_index';
import { roleLabel, tTalent } from './talent_i18n';
import { talentChoiceIconDataUrl, talentNodeIconDataUrl } from './talent_icons';
import {
  buildTalentsView,
  type TalentNodeVM,
  type TalentsView,
  type TalentTreeVM,
} from './talents_view';
import { svgIcon } from './ui_icons';
import { renderWindowFrame, type WindowFrameParts } from './window_frame';
import type { WindowFrameDescriptor } from './window_frame_view';

/**
 * Hud-supplied glue. attachTooltip comes from the shared PainterHostPresentation
 * bag; the rest is talents-specific: the host owns the #talents-window element, the
 * single staged edit buffer (getStage/setStage), the world reads that seed + gate the
 * buffer, the loadout commit surface, and the shared HUD chrome components (dropdown
 * + dialogs + error toast). The module never reaches into Hud directly.
 */
export interface TalentsWindowDeps extends PainterHostPresentation {
  /** The #talents-window root (Hud owns the id; the painter stays instance-parameterized). */
  root(): HTMLElement;
  hideTooltip(): void;
  // Focus management (WCAG 2.2 AA): capture the opener on open, restore it on close.
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  // The host-owned staged edit buffer (a clone of IWorld.talents); NOT IWorld-derived.
  getStage(): TalentAllocation | null;
  setStage(stage: TalentAllocation | null): void;
  // World reads: the seed + the point economy + the saved loadouts. Read, not mutated.
  playerClass(): PlayerClass;
  totalPoints(): number;
  currentAllocation(): TalentAllocation;
  activeLoadout(): number;
  loadouts(): readonly SavedLoadout[];
  /** The current per-class action-bar ability ids, for saving alongside a build. */
  currentBar(): (string | null)[];
  // Loadout commit surface (server-authoritative IWorld; the only commit path).
  saveLoadout(name: string, bar: (string | null)[], alloc: TalentAllocation): void;
  switchLoadout(index: number): void;
  deleteLoadout(index: number): void;
  applyLoadoutBar(bar: (string | null)[]): void;
  // Shared HUD chrome components.
  buildDropdown(
    options: { value: string; label: string }[],
    current: string,
    onChange: (value: string) => void,
    placeholder: string,
    a11y: { ariaLabel?: string; labelledBy?: string },
  ): HTMLElement;
  inputDialog(opts: {
    title: string;
    label?: string;
    value?: string;
    placeholder?: string;
    multiline?: boolean;
    readOnly?: boolean;
    copy?: boolean;
    selectText?: boolean;
    okText?: string;
    cancelText?: string;
    onOk?: (value: string) => void;
  }): void;
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
  showError(text: string): void;
}

// Talent palette: CSS custom properties (no raw hex in the painter). These color
// the tooltip accent lines; every layout color lives in components.css as tokens.
const TAL_COLOR = {
  signature: 'var(--gold)',
  choiceSel: 'var(--gold)',
  choiceDim: 'var(--color-talent-opt-dim)',
  hint: 'var(--color-talent-hint)',
  requires: 'var(--color-talent-req)',
  dormant: 'var(--color-talent-dormant)',
} as const;

function signatureName(abilityId: string): string {
  return ABILITIES[abilityId]
    ? tEntity({ kind: 'ability', id: abilityId, field: 'name' })
    : abilityId;
}

function num(n: number): string {
  return formatNumber(n, { maximumFractionDigits: 0, useGrouping: false });
}

// The talents window is a closable, footer-less frame with the shared tab rail:
// CHOICES (the class tree as tier rows) and SPECIALIZATION (spec picker + spec
// tiers). The staged-edit build panels stay inside the body (NOT lifted to the
// frame's sticky .window-footer): they are a rich multi-action block, not a single
// trailing action. Title + close reuse the existing game.talents.* keys; the
// CHOICES tab label is the one new chrome key. The frame IS the dialog (role +
// aria-labelledby on the inner mount).
const TALENTS_FRAME: WindowFrameDescriptor = {
  id: 'talents-window',
  titleKey: 'game.talents.title',
  closeLabelKey: 'game.talents.close',
  tabs: [
    { id: 'choices', labelKey: 'hudChrome.talents.choicesTab' },
    { id: 'spec', labelKey: 'game.talents.specTab' },
  ],
};

export class TalentsWindow {
  private tab: 'choices' | 'spec' = 'choices';
  // The element to refocus when the window closes (WCAG 2.2 AA focus return).
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly deps: TalentsWindowDeps) {}

  /** Open the window: seed a fresh staged buffer from the live build, paint, show. */
  open(): void {
    this.returnFocus = this.deps.captureFocus();
    this.deps.setStage(cloneAllocation(this.deps.currentAllocation()));
    this.deps.root().style.display = 'block';
    this.render();
  }

  /** Close the window: hide, drop the tooltip, discard the buffer, restore focus. */
  close(): void {
    const el = this.deps.root();
    el.style.display = 'none';
    this.deps.hideTooltip();
    this.deps.setStage(null);
    const target = this.returnFocus;
    this.returnFocus = null;
    this.deps.restoreFocus(target);
  }

  /**
   * Stamp the shared window frame cold at first open, then reuse it. The frame
   * mounts on an INNER container (never on the shared #talents-window root), so
   * the root stays a pristine `.window.panel`: the id-scoped viewport clamp, the
   * resize grip, and the mobile inset rule all keep matching it. An intact mounted
   * frame (its body present) is the reuse marker; only the body repaints per
   * render. The cold stamp also adds the two persistent chrome bits: the class
   * name beside the title, and the point pips + arrow-key roving on the tab rail.
   */
  private ensureFrame(el: HTMLElement): WindowFrameParts {
    const mounted = el.querySelector<HTMLElement>(':scope > .window-frame');
    const body = mounted?.querySelector<HTMLElement>('.window-body');
    if (mounted && body) {
      return {
        root: mounted,
        body,
        footer: null,
        tabButtons: Array.from(mounted.querySelectorAll<HTMLButtonElement>('[data-window-tab]')),
      };
    }
    const mount = document.createElement('div');
    const parts = renderWindowFrame(
      mount,
      TALENTS_FRAME,
      {
        onClose: () => this.close(),
        onTabChange: (tabId) => {
          this.tab = tabId === 'spec' ? 'spec' : 'choices';
          this.render();
        },
      },
      this.tab,
    );
    // Titlebar: "Talents" plus the class name (the classic titlebar pairing).
    const sub = document.createElement('span');
    sub.className = 'tal-class-sub';
    sub.textContent = classDisplayName(this.deps.playerClass());
    parts.root.querySelector('.window-title')?.after(sub);
    // Tab rail: a points pip per tab (updated each render) and WAI-ARIA arrow-key
    // roving (Left/Right/Home/End). The buttons persist with the frame, so this
    // wiring is cold; activating a tab routes through the frame's own click path.
    parts.tabButtons.forEach((btn, i) => {
      const pip = document.createElement('span');
      pip.className = 'tt-pts';
      btn.appendChild(pip);
      btn.addEventListener('keydown', (e) => {
        const next = rovingTarget(e.key, i, parts.tabButtons.length, 'horizontal');
        if (next === null || next === i) return;
        e.preventDefault();
        const target = parts.tabButtons[next];
        target.click();
        target.focus();
      });
    });
    el.replaceChildren(mount);
    return parts;
  }

  /**
   * Re-affirm the rail against this.tab (roving tabindex, aria-selected, the
   * body's tabpanel id) and refresh the per-tab spent pips. The frame's click
   * handler already does the aria half on a click; a Hud-driven repaint against
   * the reused frame must re-assert it.
   */
  private syncTabs(parts: WindowFrameParts, view: TalentsView): void {
    for (const btn of parts.tabButtons) {
      const key = btn.dataset.windowTab;
      const selected = key === this.tab;
      btn.setAttribute('aria-selected', String(selected));
      btn.tabIndex = selected ? 0 : -1;
      if (selected) {
        const panelId = btn.getAttribute('aria-controls');
        if (panelId) parts.body.id = panelId;
      }
      const pip = btn.querySelector('.tt-pts');
      if (pip) pip.textContent = num(key === 'spec' ? view.specSpent : view.classSpent);
    }
  }

  /** The status strip: staged choices spent / total (left), chosen spec (right). */
  private statusHtml(view: TalentsView): string {
    const specName = view.selectedSpec
      ? tTalent({ kind: 'talentSpec', spec: view.selectedSpec, field: 'name' })
      : null;
    return (
      `<div class="tal-status">` +
      `<span class="tal-status-choices">${t('hudChrome.talents.choicesTab')}: <b>${num(view.spent)}</b> / ${num(view.total)}</span>` +
      `<span class="tal-status-spec">${t('game.talents.specTab')}: <b>${specName ? esc(specName) : t('game.talents.chooseSpec')}</b></span>` +
      `</div>`
    );
  }

  render(): void {
    const el = this.deps.root();
    // Early-return when hidden AND no staged buffer (nothing to repaint).
    if (el.style.display !== 'block' && this.deps.getStage() === null) return;
    // The shared frame carries the dialog role + aria-labelledby (its "Talents"
    // title) and the tab rail; the body repaints below. The close routes to
    // this.close() via the frame's onClose, wired once when the frame is stamped.
    const parts = this.ensureFrame(el);
    const body = parts.body;
    const cls = this.deps.playerClass();
    if (!talentsFor(cls)) {
      body.innerHTML =
        `<div class="tal-empty tal-coming-soon" data-talents-coming-soon>` +
        `<b>${t('game.talents.comingSoonTitle')}</b>` +
        `<span>${t('game.talents.comingSoonBody')}</span>` +
        `</div>`;
      return;
    }
    // Create-on-first-open: ensure the staged buffer exists, seeded from the live build.
    let stage = this.deps.getStage();
    if (!stage) {
      stage = cloneAllocation(this.deps.currentAllocation());
      this.deps.setStage(stage);
    }
    const total = this.deps.totalPoints();
    const view = buildTalentsView(stage, cls, total);
    this.syncTabs(parts, view);

    body.innerHTML = this.statusHtml(view) + `<div id="tal-body"></div>` + this.footerHtml(view);

    const panel = body.querySelector('#tal-body') as HTMLElement;
    if (this.tab === 'choices') {
      this.paintTiers(panel, view.classTree, stage);
      panel.insertAdjacentHTML(
        'beforeend',
        `<div class="tal-help">${esc(t('game.talents.pointSource').replace('{first}', String(FIRST_TALENT_LEVEL)).replace('{cap}', String(MAX_LEVEL)))}</div>`,
      );
    } else {
      this.paintSpecTab(panel, view, stage);
    }
    this.wireFooter(body, stage, total);
  }

  private paintSpecTab(body: HTMLElement, view: TalentsView, stage: TalentAllocation): void {
    const picker = document.createElement('div');
    picker.className = 'tal-specs';
    picker.setAttribute('role', 'radiogroup');
    picker.setAttribute('aria-label', t('game.talents.specTab'));
    // WAI-ARIA radiogroup: arrow keys move focus among the spec radios and select on
    // move (setSpec re-renders; the root persists, so focus the new selected card).
    const specCards: { el: HTMLElement; id: string }[] = [];
    for (const specVM of view.specs) {
      const sp = specVM.spec;
      const card = document.createElement('div');
      const selected = specVM.selected;
      card.className = `tal-spec${selected ? ' sel' : ''}`;
      card.setAttribute('role', 'radio');
      card.setAttribute('tabindex', selected || !stage.spec ? '0' : '-1');
      card.setAttribute('aria-checked', String(selected));
      const specName = tTalent({ kind: 'talentSpec', spec: sp, field: 'name' });
      const specDescription = tTalent({ kind: 'talentSpec', spec: sp, field: 'description' });
      const masteryName = tTalent({ kind: 'talentMastery', spec: sp, field: 'name' });
      const masteryDescription = tTalent({ kind: 'talentMastery', spec: sp, field: 'description' });
      card.setAttribute('aria-label', `${specName}, ${roleLabel(specVM.role)}`);
      card.innerHTML = `<div class="ts-icon">${esc(sp.icon)}</div><div class="ts-name">${esc(specName)}</div><div class="ts-role">${roleLabel(specVM.role)}</div>`;
      this.deps.attachTooltip(
        card,
        () =>
          `<div class="tt-title">${esc(specName)}</div><div class="tt-sub">${esc(specDescription)}</div>` +
          `<div class="tt-sub" style="color:${TAL_COLOR.signature}">${t('game.talents.signature')}: ${esc(signatureName(sp.signature))}</div>` +
          `<div class="tt-sub">${t('game.talents.mastery')}: ${esc(masteryName)} - ${esc(masteryDescription)}</div>`,
      );
      card.addEventListener('click', () => this.setSpec(stage, sp.id));
      card.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const i = specCards.findIndex((c) => c.el === card);
        const next = rovingTarget(ke.key, i, specCards.length, 'both');
        if (next !== null) {
          ke.preventDefault();
          this.setSpec(stage, specCards[next].id);
          (this.deps.root().querySelector('.tal-spec.sel') as HTMLElement | null)?.focus();
          return;
        }
        this.keyboardActivate(ke, () => this.setSpec(stage, sp.id));
      });
      specCards.push({ el: card, id: sp.id });
      picker.appendChild(card);
    }
    body.appendChild(picker);
    const sp = view.selectedSpec;
    if (!sp) {
      const e = document.createElement('div');
      e.className = 'tal-empty';
      e.textContent = t('game.talents.chooseSpec');
      body.appendChild(e);
      return;
    }
    const m = document.createElement('div');
    m.className = 'tal-mastery';
    m.innerHTML = `<b>${t('game.talents.mastery')}: ${esc(tTalent({ kind: 'talentMastery', spec: sp, field: 'name' }))}</b> - ${esc(tTalent({ kind: 'talentMastery', spec: sp, field: 'description' }))}`;
    body.appendChild(m);
    if (view.specTree) this.paintTiers(body, view.specTree, stage);
  }

  /**
   * Paint a tree as classic tier rows: a level number on the left rail, then the
   * row's talent cards on a three-column grid (column identity from the content
   * `col`, so a two-card row keeps its middle gap). A level-locked tier (the
   * point budget cannot open it yet) dims and carries a lock on its rail.
   */
  private paintTiers(host: HTMLElement, treeVM: TalentTreeVM, stage: TalentAllocation): void {
    if (treeVM.empty) {
      host.insertAdjacentHTML(
        'beforeend',
        `<div class="tal-empty">${t('game.talents.pickSpecFirst')}</div>`,
      );
      return;
    }
    const tiers = document.createElement('div');
    tiers.className = 'tal-tiers';
    for (const tier of treeVM.tiers) {
      const row = document.createElement('section');
      row.className = `tal-tier${tier.levelLocked ? ' level-locked' : ''}`;
      // The content row this tier band renders. Every card inside carries the
      // same stamp, so a test can pin that a card never leaves its tier's band
      // (the one-horizontal-row-per-tier alignment contract; the row placement
      // itself is the explicit `.tal-tier-cards > .tal-card { grid-row: 1 }`
      // stylesheet rule, released only by the narrow-container collapse).
      row.dataset.tierRow = String(tier.row);
      row.setAttribute('aria-label', t('hudChrome.talents.tierLevel', { n: num(tier.level) }));
      const rail = document.createElement('div');
      rail.className = 'tal-tier-rail';
      rail.innerHTML =
        `<span class="tal-tier-caption">${t('hudChrome.talents.tierLevelLabel')}</span>` +
        `<span class="tal-tier-num">${num(tier.level)}</span>` +
        (tier.levelLocked ? svgIcon('lock', { cls: 'tal-tier-lock' }) : '');
      row.appendChild(rail);
      const cards = document.createElement('div');
      cards.className = 'tal-tier-cards';
      for (const vm of tier.nodes) {
        const card = this.buildCard(vm, stage);
        card.dataset.tierRow = String(tier.row);
        cards.appendChild(card);
      }
      row.appendChild(cards);
      tiers.appendChild(row);
    }
    host.appendChild(tiers);
  }

  /** One selectable talent card: icon + name (+ chosen option), state-classed. */
  private buildCard(vm: TalentNodeVM, stage: TalentAllocation): HTMLElement {
    const n = vm.node;
    const div = document.createElement('div');
    div.className = `tal-card ${vm.shape} ${vm.state} tal-col-${vm.col}`;
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.setAttribute('aria-pressed', String(vm.ranks > 0));
    if (vm.disabled) div.setAttribute('aria-disabled', 'true');
    const nodeName = tTalent({ kind: 'talentNode', node: n, field: 'name' });
    const chosenName = vm.chosen
      ? tTalent({ kind: 'talentChoice', choice: vm.chosen, field: 'name' })
      : null;
    div.setAttribute(
      'aria-label',
      `${nodeName}${chosenName ? `, ${chosenName}` : ''}, ${t('game.talents.rank')} ${vm.ranks}/${vm.maxRank}`,
    );
    const icon = document.createElement('span');
    icon.className = 'tal-icon';
    icon.style.backgroundImage = `url(${vm.chosen ? talentChoiceIconDataUrl(vm.chosen) : talentNodeIconDataUrl(n)})`;
    div.appendChild(icon);
    const text = document.createElement('span');
    text.className = 'tal-card-text';
    const name = document.createElement('span');
    name.className = 'tal-card-name';
    name.textContent = nodeName;
    text.appendChild(name);
    if (chosenName) {
      const sub = document.createElement('span');
      sub.className = 'tal-card-sub';
      sub.textContent = chosenName;
      text.appendChild(sub);
    }
    div.appendChild(text);
    if (vm.ranks > 0 || n.maxRank > 1) {
      const badge = document.createElement('span');
      badge.className = 'tal-rank';
      badge.textContent = `${vm.ranks}/${vm.maxRank}`;
      div.appendChild(badge);
    }
    this.deps.attachTooltip(div, () => this.talentTooltip(n, stage, vm.state === 'dormant'));
    div.addEventListener('click', () => {
      // octagon choice cards open a classic-MMO-style option flyout; others add a rank
      if (n.kind === 'choice') this.openChoicePopup(div, n, stage);
      else this.nodeClick(stage, n);
    });
    div.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Backspace' || ke.key === 'Delete') {
        ke.preventDefault();
        this.nodeRemove(stage, n);
        return;
      }
      this.keyboardActivate(ke, () => {
        if (n.kind === 'choice') this.openChoicePopup(div, n, stage);
        else this.nodeClick(stage, n);
      });
    });
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.nodeRemove(stage, n);
    });
    return div;
  }

  private setSpec(stage: TalentAllocation, specId: string): void {
    if (stage.spec === specId) return;
    stage.spec = specId;
    const ct = talentsFor(this.deps.playerClass());
    for (const id of Object.keys(stage.ranks)) {
      const n = ct?.nodes.find((x) => x.id === id);
      if (n?.tree === 'spec' && n.specId !== specId) {
        delete stage.ranks[id];
        delete stage.choices[id];
      }
    }
    this.render();
  }

  private nodeClick(stage: TalentAllocation, n: TalentNode): void {
    const cls = this.deps.playerClass();
    const total = this.deps.totalPoints();
    const ranks = stage.ranks[n.id] ?? 0;
    if (ranks >= n.maxRank) return;
    const cand = cloneAllocation(stage);
    cand.ranks[n.id] = ranks + 1;
    if (!validateAllocation(cls, cand, total).ok) return;
    stage.ranks[n.id] = ranks + 1;
    this.render();
  }

  private nodeRemove(stage: TalentAllocation, n: TalentNode): void {
    const ranks = stage.ranks[n.id] ?? 0;
    if (ranks <= 0) return;
    if (ranks - 1 <= 0) {
      delete stage.ranks[n.id];
      delete stage.choices[n.id];
    } else stage.ranks[n.id] = ranks - 1;
    this.render();
  }

  private talentTooltip(n: TalentNode, stage: TalentAllocation, isDormant: boolean): string {
    const ranks = stage.ranks[n.id] ?? 0;
    let html = `<div class="tt-title">${esc(tTalent({ kind: 'talentNode', node: n, field: 'name' }))}</div><div class="tt-sub">${esc(tTalent({ kind: 'talentNode', node: n, field: 'description' }))}</div>`;
    if (n.kind === 'choice') {
      for (const o of n.choices ?? []) {
        const sel = stage.choices[n.id] === o.id;
        html += `<div class="tt-sub" style="color:${sel ? TAL_COLOR.choiceSel : TAL_COLOR.choiceDim}"><span class="tt-opt-icon" style="background-image:url(${esc(talentChoiceIconDataUrl(o))})"></span> ${esc(tTalent({ kind: 'talentChoice', choice: o, field: 'name' }))} - ${esc(tTalent({ kind: 'talentChoice', choice: o, field: 'description' }))}</div>`;
      }
      html += `<div class="tt-sub" style="color:${TAL_COLOR.hint}">${t('game.talents.cycleHint')}</div>`;
    } else {
      html += `<div class="tt-sub">${t('game.talents.rank')} ${ranks}/${n.maxRank}</div>`;
    }
    const ct = talentsFor(this.deps.playerClass());
    if (n.requires?.length) {
      const names = n.requires
        .map((r) => {
          const required = ct?.nodes.find((x) => x.id === r);
          return required ? tTalent({ kind: 'talentNode', node: required, field: 'name' }) : r;
        })
        .join(', ');
      html += `<div class="tt-sub" style="color:${TAL_COLOR.requires}">${t('game.talents.requires')}: ${esc(names)}</div>`;
    }
    if (n.pointsGate)
      html += `<div class="tt-sub" style="color:${TAL_COLOR.requires}">${n.pointsGate} ${t('game.talents.pointsGate')}</div>`;
    if (isDormant)
      html += `<div class="tt-sub" style="color:${TAL_COLOR.dormant}">${t('game.talents.dormant')}</div>`;
    html += `<div class="tt-sub" style="color:${TAL_COLOR.hint}">${t('game.talents.editHint')}</div>`;
    return html;
  }

  // classic-MMO-style choice-node picker: clicking an octagon card opens a flyout of
  // its options; selecting one assigns it (spending a point if needed). Anchored to
  // the card, closes on click-away.
  private openChoicePopup(anchor: HTMLElement, node: TalentNode, stage: TalentAllocation): void {
    document.getElementById('tal-choice-pop')?.remove();
    const cls = this.deps.playerClass();
    const total = this.deps.totalPoints();
    const ranks = stage.ranks[node.id] ?? 0;
    const pop = document.createElement('div');
    pop.id = 'tal-choice-pop';
    pop.className = 'tal-choice-pop';
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', tTalent({ kind: 'talentNode', node, field: 'name' }));
    // Roving tabindex: only the selected option (else the first) is in the tab order;
    // the Arrow/Home/End handler below moves focus among the rest (so the
    // role=menu announces a pattern the keyboard actually implements).
    const choices = node.choices ?? [];
    const selIdx = choices.findIndex((o) => stage.choices[node.id] === o.id);
    const rovingIdx = selIdx >= 0 ? selIdx : 0;
    pop.innerHTML = choices
      .map((o, i) => {
        const sel = stage.choices[node.id] === o.id;
        return (
          `<div class="tal-choice-opt${sel ? ' sel' : ''}" role="menuitemradio" tabindex="${i === rovingIdx ? '0' : '-1'}" aria-checked="${sel}" data-opt="${esc(o.id)}"><span class="tco-icon" style="background-image:url(${esc(talentChoiceIconDataUrl(o))})"></span>` +
          `<span class="tco-text"><b>${esc(tTalent({ kind: 'talentChoice', choice: o, field: 'name' }))}</b><span>${esc(tTalent({ kind: 'talentChoice', choice: o, field: 'description' }))}</span></span></div>`
        );
      })
      .join('');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const preferredLeft = r.left + r.width / 2 - pop.offsetWidth / 2;
    const left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, preferredLeft));
    const top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 12));
    const caretLeft = Math.max(14, Math.min(pop.offsetWidth - 14, r.left + r.width / 2 - left));
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.setProperty('--tal-choice-caret-left', `${caretLeft}px`);
    // One idempotent close path. returnFocus lands focus back on the still-attached
    // anchor (Escape / outside click / Tab-out / can't-afford); a successful choose()
    // re-renders the tree, detaching its anchor, so it dismisses WITHOUT a refocus and
    // lets render() own focus. The body.contains guard keeps a stale anchor from being
    // focused if it was already rebuilt.
    let dismissed = false;
    const dismiss = (returnFocus: boolean): void => {
      if (dismissed) return;
      dismissed = true;
      pop.remove();
      if (returnFocus && document.body.contains(anchor)) anchor.focus();
    };
    const choose = (optEl: Element): void => {
      const optId = optEl.getAttribute('data-opt') ?? '';
      if (ranks === 0) {
        const cand = cloneAllocation(stage);
        cand.ranks[node.id] = 1;
        cand.choices[node.id] = optId;
        if (!validateAllocation(cls, cand, total).ok) {
          dismiss(true); // can't afford / gated: no re-render, so return focus to the card
          return;
        }
        stage.ranks[node.id] = 1;
      }
      stage.choices[node.id] = optId;
      dismiss(false);
      this.render();
    };
    const opts = Array.from(pop.querySelectorAll<HTMLElement>('.tal-choice-opt'));
    // Move the roving focus among the options (no selection on move; Enter/Space picks).
    const focusOpt = (idx: number): void => {
      const n = opts.length;
      if (n === 0) return;
      const next = ((idx % n) + n) % n;
      opts.forEach((o, j) => {
        o.setAttribute('tabindex', j === next ? '0' : '-1');
      });
      opts[next].focus();
    };
    opts.forEach((optEl, i) => {
      optEl.addEventListener('click', (e) => {
        e.stopPropagation();
        choose(optEl);
      });
      optEl.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Escape') {
          ke.preventDefault();
          dismiss(true);
          return;
        }
        const next = rovingTarget(ke.key, i, opts.length, 'both');
        if (next !== null) {
          ke.preventDefault();
          focusOpt(next);
          return;
        }
        this.keyboardActivate(ke, () => choose(optEl));
      });
    });
    focusOpt(rovingIdx);
    // The popup is appended to document.body (its position:fixed math needs the
    // viewport, and the .window transform would otherwise become its containing
    // block), so it lives OUTSIDE the talents dialog's focus trap. Dismiss it the
    // moment focus leaves it (Tab-out, click-away), returning focus to the anchor, so
    // a keyboard user can never escape the dialog through the flyout.
    pop.addEventListener('focusout', (e) => {
      if (!pop.contains((e as FocusEvent).relatedTarget as Node | null)) dismiss(true);
    });
    // A click anywhere outside also dismisses it (added a tick later so the opening
    // click does not immediately close it). dismiss() is idempotent; the contains(pop)
    // guard means a stale listener left by a popup that was replaced (opening a second
    // choice node removes the first via getElementById without calling its dismiss) no
    // longer fires and cannot yank focus to the old anchor.
    setTimeout(
      () =>
        document.addEventListener(
          'click',
          () => {
            if (document.body.contains(pop)) dismiss(true);
          },
          { once: true },
        ),
      0,
    );
  }

  private footerHtml(view: TalentsView): string {
    const valid = view.valid;
    return (
      `<div class="tal-foot">` +
      `<section class="tal-build-card tal-build-current" aria-label="${esc(t('game.talents.currentBuild'))}">` +
      `<div class="tal-build-head"><span>${t('game.talents.currentBuild')}</span><span class="tal-loadslot"></span></div>` +
      `<div class="tal-build-actions">` +
      `<button class="btn is-primary" data-act="save"${valid ? '' : ' disabled'}>${t('game.talents.saveBuild')}</button>` +
      `<button class="btn" data-act="export">${t('game.talents.export')}</button>` +
      `<button class="btn is-danger" data-act="del"${this.deps.activeLoadout() >= 0 ? '' : ' disabled'}>${t('game.talents.deleteBuild')}</button>` +
      `<button class="btn" data-act="clear"${view.spent > 0 ? '' : ' disabled'}>${t('hudChrome.talents.resetChoices')}</button>` +
      `</div>` +
      `<div class="tal-build-help">${t('game.talents.currentBuildHint')}</div>` +
      `</section>` +
      `<section class="tal-build-card tal-build-create" aria-label="${esc(t('game.talents.createBuild'))}">` +
      `<div class="tal-build-head"><span>${t('game.talents.createBuild')}</span></div>` +
      `<div class="tal-build-actions">` +
      `<button class="btn is-primary" data-act="new"${valid ? '' : ' disabled'}>${t('game.talents.newBuild')}</button>` +
      `<button class="btn" data-act="import">${t('game.talents.import')}</button>` +
      `</div>` +
      `<div class="tal-build-help">${t('game.talents.createBuildHint')}</div>` +
      `</section>` +
      `</div>`
    );
  }

  private wireFooter(el: HTMLElement, stage: TalentAllocation, total: number): void {
    const cls = this.deps.playerClass();
    el.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
      stage.ranks = {};
      stage.choices = {};
      this.render();
    });
    const saveStagedBuild = (name: string): void => {
      const n = name.trim();
      if (!n) return;
      this.deps.saveLoadout(n, this.deps.currentBar(), cloneAllocation(stage));
      this.deps.setStage(cloneAllocation(stage));
      this.render();
    };
    const promptNewBuild = (): void => {
      this.deps.inputDialog({
        title: t('game.talents.saveBuildAs'),
        label: t('game.talents.namePrompt'),
        value: t('hudChrome.talents.defaultBuildName', { n: this.deps.loadouts().length + 1 }),
        okText: t('game.talents.save'),
        selectText: true,
        onOk: saveStagedBuild,
      });
    };
    el.querySelector('[data-act="save"]')?.addEventListener('click', () => {
      if (!validateAllocation(cls, stage, total).ok) {
        this.deps.showError(t('game.talents.buildInvalid'));
        return;
      }
      const activeLoadout = this.deps.activeLoadout();
      const active = activeLoadout >= 0 ? this.deps.loadouts()[activeLoadout] : null;
      if (active) saveStagedBuild(active.name);
      else promptNewBuild();
    });
    el.querySelector('[data-act="new"]')?.addEventListener('click', () => {
      if (!validateAllocation(cls, stage, total).ok) {
        this.deps.showError(t('game.talents.buildInvalid'));
        return;
      }
      promptNewBuild();
    });
    // in-app loadout dropdown (shared component, no native <select>)
    const slot = el.querySelector('.tal-loadslot');
    if (slot) {
      const loadouts = this.deps.loadouts();
      const activeLoadout = this.deps.activeLoadout();
      const opts = loadouts.length
        ? loadouts.map((l, i) => ({ value: String(i), label: l.name }))
        : [{ value: '-1', label: t('game.talents.noBuilds') }];
      const current = activeLoadout >= 0 ? String(activeLoadout) : loadouts.length ? '' : '-1';
      slot.replaceWith(
        this.deps.buildDropdown(
          opts,
          current,
          (v) => {
            const i = parseInt(v, 10);
            const lo = this.deps.loadouts()[i];
            if (!lo) return;
            this.deps.switchLoadout(i);
            this.deps.applyLoadoutBar(lo.bar);
            this.deps.setStage(cloneAllocation(lo.alloc));
            this.render();
          },
          t('game.talents.loadouts'),
          { ariaLabel: t('game.talents.loadouts') },
        ),
      );
    }
    el.querySelector('[data-act="del"]')?.addEventListener('click', () => {
      const activeLoadout = this.deps.activeLoadout();
      if (activeLoadout < 0) {
        this.deps.showError(t('game.talents.selectBuildFirst'));
        return;
      }
      const active = this.deps.loadouts()[activeLoadout];
      if (!active) {
        this.deps.showError(t('game.talents.selectBuildFirst'));
        return;
      }
      const body = t('game.talents.deleteBuildBody', { name: active.name });
      this.deps.confirmDialog(
        t('game.talents.deleteBuildTitle'),
        body,
        t('game.talents.deleteBuildConfirm'),
        t('game.talents.cancel'),
        () => {
          this.deps.deleteLoadout(this.deps.activeLoadout());
          this.render();
        },
      );
    });
    el.querySelector('[data-act="export"]')?.addEventListener('click', () => {
      const activeLoadout = this.deps.activeLoadout();
      const active = activeLoadout >= 0 ? this.deps.loadouts()[activeLoadout] : null;
      this.deps.inputDialog({
        title: t('game.talents.export'),
        label: t('game.talents.exportTitle'),
        value: exportBuild(cls, active?.alloc ?? stage),
        multiline: true,
        readOnly: true,
        copy: true,
        cancelText: t('game.talents.close'),
      });
    });
    el.querySelector('[data-act="import"]')?.addEventListener('click', () => {
      this.deps.inputDialog({
        title: t('game.talents.import'),
        label: t('game.talents.importPrompt'),
        placeholder: 'eyJ2Ijox…',
        multiline: true,
        okText: t('game.talents.import'),
        onOk: (str) => {
          const res = importBuild(str.trim());
          if (!res.ok || res.cls !== cls) {
            this.deps.showError(t('game.talents.invalidBuild'));
            return;
          }
          this.deps.setStage(res.alloc);
          this.render();
        },
      });
    });
  }

  private keyboardActivate(e: KeyboardEvent, action: () => void): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    action();
  }
}
