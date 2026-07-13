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

import { ROW_COUNT, type RowPicks, rowTreeFor } from '../sim/content/talent_rows';
import {
  cloneAllocation,
  exportBuild,
  importBuild,
  type SavedLoadout,
  type TalentAllocation,
  talentsFor,
  validateAllocation,
} from '../sim/content/talents';
import { ABILITIES } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import { SPEC_CARD_INFO } from './class_details_data';
import { markDialogRoot } from './dialog_root';
import { classDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { type TranslationKey, t } from './i18n';
import { iconDataUrl } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { rovingTarget } from './roving_index';
import { roleLabel, tTalent } from './talent_i18n';
import { paintTalentRowsTab } from './talent_rows_tab';
import { buildTalentRowsView } from './talent_rows_view';
import { buildTalentsView, type TalentsView } from './talents_view';
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
  /**
   * Rich tooltip HTML for an ability id (name, cost/range, cast/cooldown,
   * resolved description), reusing the HUD's shared ability tooltip. Used by the
   * spec preview so a new player can read what each example ability does before
   * committing. Returns null for an unknown id.
   */
  abilityTooltip(abilityId: string): string | null;
  // Choice-row talents (the Pandaria-style rows tab): live picks + level reads,
  // and the server-validated pick command (IWorld.pickRowTalent).
  rowPicks(): RowPicks;
  playerLevel(): number;
  pickRow(rowIndex: number, optionId: string | null): void;
  /** The current per-class action-bar ability ids, for saving alongside a build. */
  currentBar(): (string | null)[];
  // Loadout commit surface (server-authoritative IWorld; the only commit path).
  saveLoadout(name: string, bar: (string | null)[], alloc: TalentAllocation): void;
  switchLoadout(index: number): void;
  deleteLoadout(index: number): void;
  applyLoadoutBar(bar: (string | null)[]): void;
  // Shared HUD chrome components.
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

const SPEC_ICON_DIR = '/ui/specs';

function specIconUrl(cls: PlayerClass, specId: string): string | null {
  if (cls === 'warrior' && (specId === 'arms' || specId === 'fury' || specId === 'prot')) {
    return `${SPEC_ICON_DIR}/${cls}/${specId}.webp`;
  }
  return null;
}

function signatureName(abilityId: string): string {
  return ABILITIES[abilityId]
    ? tEntity({ kind: 'ability', id: abilityId, field: 'name' })
    : abilityId;
}

function specIconHtml(cls: PlayerClass, specId: string, fallbackIcon: string): string {
  const url = specIconUrl(cls, specId);
  return url
    ? `<div class="ts-icon ts-icon-art" style="background-image:url(${url})" aria-hidden="true"></div>`
    : `<div class="ts-icon">${esc(fallbackIcon)}</div>`;
}

export class TalentsWindow {
  private tab: 'spec' | 'rows' = 'spec';
  // The element to refocus when the window closes (WCAG 2.2 AA focus return).
  private returnFocus: HTMLElement | null = null;
  // The document-level dismiss handler while the loadout menu is open (cleared
  // by closeLoadoutMenu, and defensively by render/close so it never leaks).
  private dismissLoadoutMenu: ((e: Event) => void) | null = null;

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
    this.closeLoadoutMenu(el);
    el.style.display = 'none';
    this.deps.hideTooltip();
    this.deps.setStage(null);
    const target = this.returnFocus;
    this.returnFocus = null;
    this.deps.restoreFocus(target);
  }

  render(): void {
    const el = this.deps.root();
    // A repaint wipes the loadout menu's DOM; drop its document listener too.
    if (this.dismissLoadoutMenu) {
      document.removeEventListener('pointerdown', this.dismissLoadoutMenu, true);
      this.dismissLoadoutMenu = null;
    }
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
    // The choice-row (Choices) tab renders only for a class with authored rows AND
    // only once a spec is committed: choices are spec-flavored and mean nothing with
    // no spec, so the tab stays hidden until you pick one, and a stale rows view
    // snaps back to the spec tab. Its badge counts picked rows out of ROW_COUNT (6),
    // never the old classic talent-point total.
    const rowTree = rowTreeFor(cls);
    const specChosen = stage.spec !== null;
    const rowsAvailable = !!rowTree && specChosen;
    const rowsVm = buildTalentRowsView(rowTree, this.deps.rowPicks(), this.deps.playerLevel());
    if (!rowsAvailable && this.tab === 'rows') this.tab = 'spec';
    const rowsTab = rowsAvailable
      ? `<div class="tal-tab${this.tab === 'rows' ? ' active' : ''}" role="tab" tabindex="${this.tab === 'rows' ? '0' : '-1'}" aria-selected="${this.tab === 'rows'}" aria-controls="tal-body" data-tab="rows"><span class="tal-tab-label">${t('hudChrome.talentRows.tab')}</span><span class="tt-pts">${rowsVm.pickedCount}/${ROW_COUNT}</span></div>`
      : '';

    // No point-economy header any more: the point-spending Class tree tab is gone,
    // so the two remaining tabs (Specialization, Choices) never spend talent points.
    // The Choices tab carries its own picked/total badge instead.
    el.innerHTML =
      `<div class="panel-title"><span>${t('game.talents.title')} <span style="color:${TAL_COLOR.classAccent};font-size:11px">${esc(classDisplayName(cls))}</span></span>${close}</div>` +
      `<div class="tal-tabs" role="tablist" aria-label="${esc(t('game.talents.title'))}">` +
      `<div class="tal-tab${this.tab === 'spec' ? ' active' : ''}" role="tab" tabindex="${this.tab === 'spec' ? '0' : '-1'}" aria-selected="${this.tab === 'spec'}" aria-controls="tal-body" data-tab="spec"><span class="tal-tab-label">${t('game.talents.specTab')}</span></div>` +
      rowsTab +
      `</div><div id="tal-body" role="tabpanel"></div>` +
      this.footerHtml(view);

    const switchTab = (tab: HTMLElement): void => {
      this.tab = tab.dataset.tab as 'spec' | 'rows';
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
    if (this.tab === 'rows') {
      paintTalentRowsTab(body, rowsVm, {
        attachTooltip: (el, html) => this.deps.attachTooltip(el, html),
        pickRow: (rowIndex, optionId) => this.deps.pickRow(rowIndex, optionId),
        // Repaint now (offline Sim applies instantly), then once more shortly
        // after so the ONLINE mirror's authoritative tal snapshot lands too.
        rerender: () => {
          this.render();
          window.setTimeout(() => {
            if (this.deps.root().style.display === 'block' && this.tab === 'rows') this.render();
          }, 300);
        },
      });
    } else {
      this.paintSpecTab(body, view, stage);
    }
    this.wireFooter(el, stage, total);
  }

  private paintSpecTab(body: HTMLElement, view: TalentsView, stage: TalentAllocation): void {
    const cls = this.deps.playerClass();
    // All specs shown at once as full side-by-side panels (WoW-style spec screen):
    // every spec's icon, role, description, primary attribute, complexity, and
    // example abilities are visible without clicking; a click selects the spec and
    // the selected one gets the View talents button (jumps to the Choices tab).
    const grid = document.createElement('div');
    grid.className = 'ts-specs-grid';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', t('game.talents.specTab'));
    const panels: { el: HTMLElement; id: string }[] = [];
    for (const specVM of view.specs) {
      const sp = specVM.spec;
      const selected = specVM.selected;
      const info = SPEC_CARD_INFO[sp.id];
      const specName = tTalent({ kind: 'talentSpec', spec: sp, field: 'name' });
      const specDesc = tTalent({ kind: 'talentSpec', spec: sp, field: 'description' });
      const masteryName = tTalent({ kind: 'talentMastery', spec: sp, field: 'name' });
      const masteryDesc = tTalent({ kind: 'talentMastery', spec: sp, field: 'description' });
      const panel = document.createElement('div');
      panel.className = `ts-panel${selected ? ' sel' : ''}`;
      panel.setAttribute('role', 'radio');
      panel.setAttribute('tabindex', selected || !stage.spec ? '0' : '-1');
      panel.setAttribute('aria-checked', String(selected));
      panel.setAttribute('aria-label', `${specName}, ${roleLabel(specVM.role)}`);
      let html =
        `<div class="ts-panel-head">${specIconHtml(cls, sp.id, sp.icon)}` +
        `<div class="ts-panel-title"><div class="ts-name">${esc(specName)}</div><div class="ts-role">${roleLabel(specVM.role)}</div></div></div>` +
        `<div class="ts-det-desc">${esc(specDesc)}</div>`;
      if (info) {
        const statLabel = t(`itemUi.stats.${info.primaryStat}` as TranslationKey);
        const cxKey = (
          info.complexity === 'low'
            ? 'hudChrome.specPanel.complexityLow'
            : info.complexity === 'high'
              ? 'hudChrome.specPanel.complexityHigh'
              : 'hudChrome.specPanel.complexityMedium'
        ) as TranslationKey;
        html +=
          `<div class="ts-det-meta">` +
          `<div class="ts-det-attr"><span class="ts-det-attr-cap">${t('hudChrome.specPanel.primaryAttr')}</span><span class="ts-det-attr-val">${esc(statLabel)}</span></div>` +
          `<div class="ts-det-cx ts-cx-${info.complexity}"><span class="ts-det-cx-cap">${t('hudChrome.specPanel.complexity')}</span> ${t(cxKey)}</div>` +
          `</div>`;
      }
      html += `<div class="ts-det-mastery"><b>${esc(masteryName)}</b> - ${esc(masteryDesc)}</div>`;
      if (info?.examples.length) {
        html += `<div class="ts-ex-block"><div class="ts-det-label">${t('hudChrome.specPanel.exampleAbilities')}</div><div class="ts-ex-list">`;
        for (const id of info.examples) {
          const name = signatureName(id);
          html += `<div class="ts-ex" tabindex="0" data-ability="${esc(id)}"><span class="ts-ex-icon" style="background-image:url(${iconDataUrl('ability', id)})" aria-hidden="true"></span><span class="ts-ex-name">${esc(name)}</span></div>`;
        }
        html += '</div></div>';
      }
      panel.innerHTML = html;
      // Hover/focus tooltip per example ability: reuse the HUD's rich ability
      // tooltip so a new player can read what each does before committing.
      for (const exEl of Array.from(panel.querySelectorAll<HTMLElement>('.ts-ex'))) {
        const id = exEl.dataset.ability ?? '';
        exEl.setAttribute('aria-label', signatureName(id));
        this.deps.attachTooltip(exEl, () => this.deps.abilityTooltip(id) ?? esc(signatureName(id)));
      }
      // Every panel gets a View talents button: clicking it SELECTS that spec (it
      // stages the choice, exactly like clicking the panel) and jumps to the
      // Choices tab, so a new player picks a spec and lands on its talents in one
      // click. The selected spec's button reads as the primary action.
      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = `btn ts-view-talents${selected ? ' primary' : ''}${info?.examples.length ? ' has-ex' : ''}`;
      viewBtn.textContent = t('hudChrome.specPanel.viewTalents');
      viewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (stage.spec !== sp.id) this.setSpec(stage, sp.id);
        this.tab = 'rows';
        this.render();
      });
      panel.appendChild(viewBtn);
      panel.addEventListener('click', () => this.setSpec(stage, sp.id));
      panel.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const i = panels.findIndex((c) => c.el === panel);
        const next = rovingTarget(ke.key, i, panels.length, 'both');
        if (next !== null) {
          ke.preventDefault();
          this.setSpec(stage, panels[next].id);
          (this.deps.root().querySelector('.ts-panel.sel') as HTMLElement | null)?.focus();
          return;
        }
        this.keyboardActivate(ke, () => this.setSpec(stage, sp.id));
      });
      panels.push({ el: panel, id: sp.id });
      grid.appendChild(panel);
    }
    body.appendChild(grid);
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

  // The WoW-style loadout bar: ONE compact dropdown button, bottom-left. The
  // menu (built on demand by wireFooter) opens upward with the saved builds,
  // save/new, import/export, and reset. Replaces the old two-card footer.
  private footerHtml(_view: TalentsView): string {
    const activeIdx = this.deps.activeLoadout();
    const active = activeIdx >= 0 ? this.deps.loadouts()[activeIdx] : null;
    const label = active ? active.name : t('hudChrome.talentRows.defaultLoadout');
    return (
      `<div class="tal-foot">` +
      `<button type="button" class="tal-loadout-btn" data-act="loadout-menu"` +
      ` aria-haspopup="menu" aria-expanded="false">` +
      `<span class="tal-loadout-name">${esc(label)}</span>` +
      `<span class="tal-loadout-caret" aria-hidden="true"></span>` +
      `</button>` +
      `</div>`
    );
  }

  private wireFooter(el: HTMLElement, stage: TalentAllocation, total: number): void {
    const btn = el.querySelector<HTMLButtonElement>('[data-act="loadout-menu"]');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const existing = el.querySelector('.tal-loadout-menu');
      if (existing) {
        this.closeLoadoutMenu(el);
        return;
      }
      this.openLoadoutMenu(el, btn, stage, total);
    });
  }

  private closeLoadoutMenu(el: HTMLElement): void {
    el.querySelector('.tal-loadout-menu')?.remove();
    el.querySelector('[data-act="loadout-menu"]')?.setAttribute('aria-expanded', 'false');
    if (this.dismissLoadoutMenu) {
      document.removeEventListener('pointerdown', this.dismissLoadoutMenu, true);
      this.dismissLoadoutMenu = null;
    }
  }

  // Build the upward WoW-style loadout menu: the saved builds (pick + delete),
  // then save-current / new / import / export / reset. Every commit path is the
  // same server-authoritative logic the old two-card footer used.
  private openLoadoutMenu(
    el: HTMLElement,
    btn: HTMLButtonElement,
    stage: TalentAllocation,
    total: number,
  ): void {
    const cls = this.deps.playerClass();
    const valid = validateAllocation(cls, stage, total).ok;
    const spent = Object.values(stage.ranks).reduce((a, b) => a + b, 0);
    const loadouts = this.deps.loadouts();
    const activeIdx = this.deps.activeLoadout();

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

    const menu = document.createElement('div');
    menu.className = 'tal-loadout-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', t('game.talents.loadouts'));

    const item = (
      label: string,
      opts: { disabled?: boolean; cls?: string; onPick?: () => void },
    ): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tal-lo-item${opts.cls ? ` ${opts.cls}` : ''}`;
      b.setAttribute('role', 'menuitem');
      b.textContent = label;
      if (opts.disabled) b.disabled = true;
      if (opts.onPick) b.addEventListener('click', opts.onPick);
      return b;
    };

    // Saved builds: pick applies (server re-validated), the X deletes.
    if (loadouts.length === 0) {
      const none = document.createElement('div');
      none.className = 'tal-lo-empty';
      none.textContent = t('game.talents.noBuilds');
      menu.appendChild(none);
    }
    loadouts.forEach((lo, i) => {
      const row = document.createElement('div');
      row.className = `tal-lo-row${i === activeIdx ? ' active' : ''}`;
      const pick = item(lo.name, {
        cls: 'tal-lo-pick',
        onPick: () => {
          this.deps.switchLoadout(i);
          this.deps.applyLoadoutBar(lo.bar);
          this.deps.setStage(cloneAllocation(lo.alloc));
          this.render();
        },
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tal-lo-del';
      del.setAttribute('aria-label', `${t('game.talents.deleteBuild')}: ${lo.name}`);
      del.innerHTML = svgIcon('close');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeLoadoutMenu(el);
        this.deps.confirmDialog(
          t('game.talents.deleteBuildTitle'),
          t('game.talents.deleteBuildBody', { name: lo.name }),
          t('game.talents.deleteBuildConfirm'),
          t('game.talents.cancel'),
          () => {
            this.deps.deleteLoadout(i);
            this.render();
          },
        );
      });
      row.append(pick, del);
      menu.appendChild(row);
    });

    const sep = document.createElement('div');
    sep.className = 'tal-lo-sep';
    menu.appendChild(sep);

    menu.appendChild(
      item(t('game.talents.saveBuild'), {
        disabled: !valid,
        onPick: () => {
          this.closeLoadoutMenu(el);
          const active = activeIdx >= 0 ? this.deps.loadouts()[activeIdx] : null;
          if (active) saveStagedBuild(active.name);
          else promptNewBuild();
        },
      }),
    );
    menu.appendChild(
      item(t('game.talents.newBuild'), {
        cls: 'tal-lo-new',
        disabled: !valid,
        onPick: () => {
          this.closeLoadoutMenu(el);
          promptNewBuild();
        },
      }),
    );
    menu.appendChild(
      item(t('game.talents.import'), {
        onPick: () => {
          this.closeLoadoutMenu(el);
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
        },
      }),
    );
    menu.appendChild(
      item(t('game.talents.export'), {
        onPick: () => {
          this.closeLoadoutMenu(el);
          const active = activeIdx >= 0 ? this.deps.loadouts()[activeIdx] : null;
          this.deps.inputDialog({
            title: t('game.talents.export'),
            label: t('game.talents.exportTitle'),
            value: exportBuild(cls, active?.alloc ?? stage),
            multiline: true,
            readOnly: true,
            copy: true,
            cancelText: t('game.talents.close'),
          });
        },
      }),
    );
    menu.appendChild(
      item(t('game.talents.clear'), {
        disabled: spent === 0,
        onPick: () => {
          stage.ranks = {};
          stage.choices = {};
          this.render();
        },
      }),
    );

    btn.parentElement?.appendChild(menu);
    btn.setAttribute('aria-expanded', 'true');
    (menu.querySelector('.tal-lo-item, .tal-lo-pick') as HTMLElement | null)?.focus();
    menu.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') {
        e.stopPropagation();
        this.closeLoadoutMenu(el);
        btn.focus();
      }
    });
    // Dismiss on any pointer press outside the menu/button (capture phase so a
    // click that also opens something else still closes this menu first).
    this.dismissLoadoutMenu = (e: Event) => {
      const target = e.target as Node;
      if (!menu.contains(target) && !btn.contains(target)) this.closeLoadoutMenu(el);
    };
    document.addEventListener('pointerdown', this.dismissLoadoutMenu, true);
  }

  private keyboardActivate(e: KeyboardEvent, action: () => void): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    action();
  }
}
