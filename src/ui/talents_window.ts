// Thin DOM painter for the talents & specializations window.
//
// The consumer half of the pure-core + thin-painter split: it paints
// #talents-window from the structured TalentsView (talents_view.ts) and owns the
// interactive wiring (class/spec tabs, the spec radiogroup, the shape-coded tree
// nodes, the choice flyout, and the build/loadout footer). It composes the shared
// PainterHostPresentation bag (only attachTooltip is relevant for this window) plus
// the talents-specific glue Hud injects.
//
// STAGED-EDIT MODEL: the user edits a LOCAL mutable buffer (a `cloneAllocation` of
// the live IWorld.talents). Hud owns that single buffer; this painter reads it via
// `deps.getStage()` and replaces it via `deps.setStage()`, and the mutation handlers
// (spend / remove / setSpec / footer reset) mutate that same object IN PLACE before
// re-deriving + repainting. The build only commits to the server-authoritative
// IWorld on save / loadout-switch / delete (deps.saveLoadout / switchLoadout /
// deleteLoadout), never inline. The painter never clones a second buffer of its own.
//
// No raw hex: the SVG/inline colors reference --color-* custom
// properties via TAL_COLOR; the tree geometry comes from the core's named layout
// constants. No em dashes anywhere (the mastery / choice separator is ASCII " - ").

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
import { markDialogRoot } from './dialog_root';
import { classDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { rovingTarget } from './roving_index';
import { roleLabel, tTalent } from './talent_i18n';
import { talentChoiceIconDataUrl, talentNodeIconDataUrl } from './talent_icons';
import { talentTreeFitScale } from './talent_tree_fit';
import { buildTalentsView, type TalentsView, type TalentTreeVM } from './talents_view';
import { svgIcon } from './ui_icons';

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

// Talent palette: CSS custom properties (no raw hex in the painter).
// classAccent/signature reuse existing tokens; the rest are --color-talent-* tokens
// added in tokens.css with the exact pre-existing hex so render stays byte-identical.
const TAL_COLOR = {
  classAccent: 'var(--color-text-muted)',
  signature: 'var(--gold)',
  arrow: 'var(--color-talent-arrow)',
  arrowDim: 'var(--color-talent-arrow-dim)',
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

export class TalentsWindow {
  private tab: 'class' | 'spec' = 'class';
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

  render(): void {
    const el = this.deps.root();
    // Early-return when hidden AND no staged buffer (nothing to repaint).
    if (el.style.display !== 'block' && this.deps.getStage() === null) return;
    // WCAG 2.2 AA: name the focus-trapped root so AT users entering the trap
    // land on a labeled dialog, not an anonymous group. innerHTML below replaces the
    // children, not these own-element attributes, so setting them once per render is
    // idempotent and covers both the coming-soon and the populated branch.
    markDialogRoot(el, { label: t('game.talents.title') });
    const cls = this.deps.playerClass();
    // A real <button> close (was a non-focusable <span>): keyboard-reachable and named,
    // matching the sibling cold windows. focusFirst skips [data-close] on open.
    const close = `<button type="button" class="x-btn" data-close aria-label="${esc(t('game.talents.close'))}">${svgIcon('close')}</button>`;
    if (!talentsFor(cls)) {
      el.innerHTML =
        `<div class="panel-title"><span>${t('game.talents.title')} <span style="color:${TAL_COLOR.classAccent};font-size:11px">${esc(classDisplayName(cls))}</span></span>${close}</div>` +
        `<div class="tal-empty tal-coming-soon" data-talents-coming-soon>` +
        `<b>${t('game.talents.comingSoonTitle')}</b>` +
        `<span>${t('game.talents.comingSoonBody')}</span>` +
        `</div>`;
      el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
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

    el.innerHTML =
      `<div class="panel-title"><span>${t('game.talents.title')} <span style="color:${TAL_COLOR.classAccent};font-size:11px">${esc(classDisplayName(cls))}</span></span>${close}</div>` +
      `<div class="tal-head"><span>${t('game.talents.available')}: <b>${view.available}</b> / ${view.total}</span><span>${t('game.talents.spent')}: <b>${view.spent}</b></span></div>` +
      `<div class="tal-help">${esc(t('game.talents.pointSource').replace('{first}', String(FIRST_TALENT_LEVEL)).replace('{cap}', String(MAX_LEVEL)))}</div>` +
      `<div class="tal-tabs" role="tablist" aria-label="${esc(t('game.talents.title'))}">` +
      `<div class="tal-tab${this.tab === 'class' ? ' active' : ''}" role="tab" tabindex="${this.tab === 'class' ? '0' : '-1'}" aria-selected="${this.tab === 'class'}" aria-controls="tal-body" data-tab="class"><span class="tal-tab-label">${t('game.talents.classTab')}</span><span class="tt-pts">${view.classSpent}</span></div>` +
      `<div class="tal-tab${this.tab === 'spec' ? ' active' : ''}" role="tab" tabindex="${this.tab === 'spec' ? '0' : '-1'}" aria-selected="${this.tab === 'spec'}" aria-controls="tal-body" data-tab="spec"><span class="tal-tab-label">${t('game.talents.specTab')}</span><span class="tt-pts">${view.specSpent}</span></div>` +
      `</div><div id="tal-body" role="tabpanel"></div>` +
      this.footerHtml(view);

    const switchTab = (tab: HTMLElement): void => {
      this.tab = tab.dataset.tab as 'class' | 'spec';
      this.render();
    };
    // WAI-ARIA tabs: roving arrow navigation (Left/Right/Home/End) plus Enter/Space.
    // switchTab re-renders the window; the root persists, so focus the freshly active
    // tab afterward to keep the roving-tabindex focus on the selected tab.
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('.tal-tab'));
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => switchTab(tab));
      tab.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const next = rovingTarget(ke.key, i, tabs.length, 'horizontal');
        if (next !== null) {
          ke.preventDefault();
          const target = tabs[next];
          if (target && target !== tab) {
            switchTab(target);
            (el.querySelector('.tal-tab.active') as HTMLElement | null)?.focus();
          }
          return;
        }
        this.keyboardActivate(ke, () => switchTab(tab));
      });
    });
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());

    const body = el.querySelector('#tal-body') as HTMLElement;
    if (this.tab === 'class') {
      const tree = document.createElement('div');
      tree.className = 'tal-tree';
      body.appendChild(tree);
      this.paintTree(tree, view.classTree, stage);
    } else {
      this.paintSpecTab(body, view, stage);
    }
    this.wireFooter(el, stage, total);
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
    const tree = document.createElement('div');
    tree.className = 'tal-tree';
    body.appendChild(tree);
    if (view.specTree) this.paintTree(tree, view.specTree, stage);
  }

  private paintTree(host: HTMLElement, treeVM: TalentTreeVM, stage: TalentAllocation): void {
    if (treeVM.empty) {
      host.innerHTML = `<div class="tal-empty">${t('game.talents.pickSpecFirst')}</div>`;
      return;
    }
    host.style.width = `${treeVM.width}px`;
    host.style.height = `${treeVM.height}px`;

    let svg = `<svg class="tal-arrows" width="${treeVM.width}" height="${treeVM.height}">`;
    for (const a of treeVM.arrows)
      svg += `<line x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" style="stroke:${a.filled ? TAL_COLOR.arrow : TAL_COLOR.arrowDim};stroke-width:2"/>`;
    host.insertAdjacentHTML('beforeend', `${svg}</svg>`);

    for (const vm of treeVM.nodes) {
      const n = vm.node;
      const div = document.createElement('div');
      div.className = `tal-node ${vm.shape} ${vm.state}`;
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');
      div.setAttribute('aria-pressed', String(vm.ranks > 0));
      if (vm.disabled) div.setAttribute('aria-disabled', 'true');
      const nodeName = tTalent({ kind: 'talentNode', node: n, field: 'name' });
      const chosenLabel = vm.chosen
        ? `, ${tTalent({ kind: 'talentChoice', choice: vm.chosen, field: 'name' })}`
        : '';
      div.setAttribute(
        'aria-label',
        `${nodeName}${chosenLabel}, ${t('game.talents.rank')} ${vm.ranks}/${vm.maxRank}`,
      );
      div.style.left = `${vm.left}px`;
      div.style.top = `${vm.top}px`;
      const icon = document.createElement('span');
      icon.className = 'tal-icon';
      icon.style.backgroundImage = `url(${vm.chosen ? talentChoiceIconDataUrl(vm.chosen) : talentNodeIconDataUrl(n)})`;
      div.appendChild(icon);
      if (vm.ranks > 0 || n.maxRank > 1) {
        const badge = document.createElement('span');
        badge.className = 'tal-rank';
        badge.textContent = `${vm.ranks}/${vm.maxRank}`;
        div.appendChild(badge);
      }
      this.deps.attachTooltip(div, () => this.talentTooltip(n, stage, vm.state === 'dormant'));
      div.addEventListener('click', () => {
        // octagon choice nodes open a classic-MMO-style option flyout; others add a rank
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
      host.appendChild(div);
    }
    this.fitTreeToMobileViewport(host, treeVM.width, treeVM.height);
  }

  // Char/talents mobile landscape redo (issue 1577 follow-up): the tree is a
  // fixed pixel grid (host.style.width/height above), so on a mobile-touch
  // landscape phone we scale the whole grid down to whatever room #tal-body
  // actually has, via the pure talentTreeFitScale, so a full tree reads in one
  // view instead of needing an internal scroll to see it. Desktop is untouched
  // (early-return keeps host at its native, unscaled size there).
  private fitTreeToMobileViewport(host: HTMLElement, width: number, height: number): void {
    if (!document.body.classList.contains('mobile-touch')) return;
    const body = host.parentElement;
    if (!body) return;
    // #tal-body sizes to its OWN content (it is not a flex child with a capped
    // height), so its bounding rect grows with the tree instead of reporting
    // the room actually left in the viewport. The scrollable box on mobile is
    // the whole #talents-window (inset:0 in hud.mobile.css), so measure the
    // remaining space below tal-body's own top, clipped to the visible window.
    const win = this.deps.root();
    const winRect = win.getBoundingClientRect();
    const bodyTop = body.getBoundingClientRect().top;
    const availableWidth = body.clientWidth || winRect.width;
    const availableHeight = Math.min(winRect.bottom, window.innerHeight) - bodyTop;
    if (availableWidth <= 0 || availableHeight <= 0) return;
    const scale = talentTreeFitScale(width, height, availableWidth, availableHeight);
    host.style.transformOrigin = 'top left';
    host.style.transform = scale < 1 ? `scale(${scale})` : '';
    // .tal-tree's base rule is `margin: 6px auto` (desktop centers it); auto
    // horizontal centering measures the tree's UNSCALED width, so left it alone
    // it would push the shrunk tree off to the right. Pin both margins
    // explicitly and collapse the now-empty right/bottom margin box back to
    // the scaled visual size, so the window doesn't reserve the tree's full
    // unscaled footprint and force a scrollbar anyway (transform never changes
    // the layout box it applies to).
    host.style.marginLeft = scale < 1 ? '0' : '';
    host.style.marginTop = scale < 1 ? '0' : '';
    host.style.marginRight = scale < 1 ? `${-(width * (1 - scale))}px` : '';
    host.style.marginBottom = scale < 1 ? `${-(height * (1 - scale))}px` : '';
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

  // classic-MMO-style choice-node picker: clicking an octagon node opens a flyout of
  // its options; selecting one assigns it (spending a point if needed). Anchored to
  // the node, closes on click-away.
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
          dismiss(true); // can't afford / gated: no re-render, so return focus to the node
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
      `<button class="btn tal-primary" data-act="save"${valid ? '' : ' disabled'}>${t('game.talents.saveBuild')}</button>` +
      `<button class="btn tal-secondary" data-act="export">${t('game.talents.export')}</button>` +
      `<button class="btn tal-secondary" data-act="del"${this.deps.activeLoadout() >= 0 ? '' : ' disabled'}>${t('game.talents.deleteBuild')}</button>` +
      `<button class="btn tal-secondary" data-act="clear"${view.spent > 0 ? '' : ' disabled'}>${t('game.talents.clear')}</button>` +
      `</div>` +
      `<div class="tal-build-help">${t('game.talents.currentBuildHint')}</div>` +
      `</section>` +
      `<section class="tal-build-card tal-build-create" aria-label="${esc(t('game.talents.createBuild'))}">` +
      `<div class="tal-build-head"><span>${t('game.talents.createBuild')}</span></div>` +
      `<div class="tal-build-actions">` +
      `<button class="btn tal-primary" data-act="new"${valid ? '' : ' disabled'}>${t('game.talents.newBuild')}</button>` +
      `<button class="btn tal-secondary" data-act="import">${t('game.talents.import')}</button>` +
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
