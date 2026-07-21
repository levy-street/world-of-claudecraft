// Thin DOM painter for the canonical Talents V2 choice-row window.
//
// Talent state comes only from currentAllocation(), the IWorld snapshot. Spec
// and row controls delegate to authoritative IWorld commands and never mutate a
// local allocation. Offline Sim reflects those commands synchronously; the
// delayed repaint covers the later authoritative ClientWorld snapshot.

import {
  exportBuild,
  importBuild,
  type SavedLoadout,
  type TalentAllocation,
  type TalentRowLevel,
  talentsFor,
  validateAllocation,
} from '../sim/content/talents';
import { ABILITIES } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import { SPEC_CARD_INFO } from './class_details_data';
import { markDialogRoot } from './dialog_root';
import { classDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { iconDataUrl } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { rovingTarget } from './roving_index';
import { focusActiveTab, wireTabStrip } from './tab_strip_painter';
import { tabStripHtml, tabStripModel } from './tab_strip_view';
import { talentBodyMaxHeight } from './talent_body_fit';
import { roleLabel, tTalent } from './talent_i18n';
import {
  type TalentSpecIconRef,
  talentIconDataUrl,
  talentRowOptionIconRef,
  talentSpecIconRef,
} from './talent_icons';
import { buildTalentsView, type TalentSpecVM, type TalentsView } from './talents_view';
import { svgIcon } from './ui_icons';
import { getUiScale } from './ui_scale';

const AUTHORITATIVE_REFRESH_MS = 300;

export interface TalentsWindowDeps extends PainterHostPresentation {
  root(): HTMLElement;
  hideTooltip(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  playerClass(): PlayerClass;
  playerLevel(): number;
  currentAllocation(): TalentAllocation;
  activeLoadout(): number;
  loadouts(): readonly SavedLoadout[];
  /**
   * Rich tooltip HTML for an ability id (name, cost/range, cast/cooldown,
   * resolved description), reusing the HUD's shared ability tooltip. Used by the
   * spec panels' example abilities so a new player can read what each does
   * before committing. Returns null for an unknown id.
   */
  abilityTooltip(abilityId: string): string | null;
  commitSpec(specId: string): void;
  selectRow(level: TalentRowLevel, optionId: string | null): void;
  applyTalents(allocation: TalentAllocation): void;
  respec(): void;
  currentBar(): (string | null)[];
  saveLoadout(name: string, bar: (string | null)[], alloc: TalentAllocation): void;
  switchLoadout(index: number): void;
  deleteLoadout(index: number): void;
  applyLoadoutBar(bar: (string | null)[], alloc: TalentAllocation): void;
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

const TAL_COLOR = {
  signature: 'var(--gold)',
  choiceDim: 'var(--color-talent-opt-dim)',
  hint: 'var(--color-talent-hint)',
} as const;

function signatureName(abilityId: string): string {
  return ABILITIES[abilityId]
    ? tEntity({ kind: 'ability', id: abilityId, field: 'name' })
    : abilityId;
}

function specIconHtml(ref: TalentSpecIconRef): string {
  if (ref.kind === 'image') {
    return `<span class="ts-icon ts-icon-art" style="background-image:url(${esc(ref.url)})" aria-hidden="true"></span>`;
  }
  if (ref.kind !== 'text') {
    return `<span class="ts-icon ts-icon-art" style="background-image:url(${iconDataUrl(ref.kind, ref.id)})" aria-hidden="true"></span>`;
  }
  return `<span class="ts-icon" aria-hidden="true">${esc(ref.text)}</span>`;
}

export class TalentsWindow {
  private tab: 'spec' | 'rows' = 'spec';
  private returnFocus: HTMLElement | null = null;
  // The document-level dismiss handler while the loadout menu is open (cleared
  // on close, and on repaint because a re-render wipes the menu's DOM).
  private dismissLoadoutMenu: ((e: Event) => void) | null = null;

  constructor(private readonly deps: TalentsWindowDeps) {
    window.addEventListener('resize', () => {
      const root = this.deps.root();
      if (root.style.display === 'none') return;
      const body = root.querySelector<HTMLElement>('#tal-body');
      if (body) this.fitBodyToWindow(root, body);
    });
  }

  open(): void {
    this.returnFocus = this.deps.captureFocus();
    this.deps.root().style.display = 'block';
    this.render();
  }

  close(): void {
    const root = this.deps.root();
    root.style.display = 'none';
    this.deps.hideTooltip();
    const target = this.returnFocus;
    this.returnFocus = null;
    this.deps.restoreFocus(target);
  }

  render(): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') return;
    // A repaint wipes the loadout menu's DOM; drop its document listener too.
    this.closeLoadoutMenu(root);
    markDialogRoot(root, { label: t('game.talents.title') });
    const cls = this.deps.playerClass();
    const close =
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('game.talents.close'))}">` +
      `${svgIcon('close')}</button>`;
    if (!talentsFor(cls)) {
      root.innerHTML =
        `<div class="panel-title"><span>${t('game.talents.title')} <span class="tal-class-name">${esc(classDisplayName(cls))}</span></span>${close}</div>` +
        `<div class="tal-empty tal-coming-soon" data-talents-coming-soon>` +
        `<b>${t('game.talents.comingSoonTitle')}</b>` +
        `<span>${t('game.talents.comingSoonBody')}</span></div>`;
      root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
      return;
    }

    const allocation = this.deps.currentAllocation();
    const view = buildTalentsView(allocation, cls, this.deps.playerLevel());
    root.innerHTML =
      `<div class="panel-title"><span>${t('game.talents.title')} <span class="tal-class-name">${esc(classDisplayName(cls))}</span></span>${close}</div>` +
      // WAI-ARIA tabs, built from the shared tab_strip_view core (default
      // button tag; the Choices tab carries its picked-count badge via
      // extraHtml, the same markup contract social_window follows).
      tabStripHtml(
        tabStripModel({
          ariaLabel: t('game.talents.title'),
          panelId: 'tal-body',
          stripClass: 'tal-tabs',
          tabClass: 'tal-tab',
          selectedClass: 'active',
          tabs: [
            { id: 'spec', label: t('game.talents.specTab') },
            {
              id: 'rows',
              label: t('hudChrome.talentRows.tab'),
              extraHtml: `<span class="tt-pts">${formatNumber(view.pickedCount)}/${formatNumber(view.rows.length)}</span>`,
            },
          ],
          selected: this.tab,
        }),
      ) +
      `<div id="tal-body" role="tabpanel"></div>` +
      this.footerHtml(view);

    // The roving Arrow/Home/End + Enter/Space wiring lives in the shared
    // tab_strip_painter core; a keyboard move re-renders the window (the root
    // persists) and refocuses the freshly active tab afterward, matching the
    // prior hand-rolled handler.
    wireTabStrip(root, 'tal-tab', (id, focusFollow) => {
      this.tab = id as 'spec' | 'rows';
      this.render();
      if (focusFollow) focusActiveTab(root, 'tal-tab', 'active');
    });
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());

    const body = root.querySelector<HTMLElement>('#tal-body');
    if (!body) return;
    if (this.tab === 'spec') this.paintSpecTab(body, view);
    else this.paintRowsTab(body, view);
    this.wireFooter(root, view);
    this.fitBodyToWindow(root, body);
  }

  private paintSpecTab(body: HTMLElement, view: TalentsView): void {
    // All specs shown at once as full side-by-side panels: every spec's icon, role,
    // description, primary attribute, complexity, mastery, and example abilities
    // are visible without clicking. Clicking a panel commits that spec (the same
    // server-authoritative IWorld path as before); View talents jumps to Choices.
    const grid = document.createElement('div');
    grid.className = 'ts-specs-grid';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', t('game.talents.specTab'));
    const selectedIndex = view.specs.findIndex((entry) => entry.selected);
    view.specs.forEach((entry, index) => {
      const spec = entry.spec;
      // Keyed by class first: spec ids collide across classes (paladin/priest
      // "holy", shaman/druid "restoration"), so a bare spec-id lookup is wrong.
      const info = SPEC_CARD_INFO[spec.class]?.[spec.id];
      const specName = tTalent({ kind: 'talentSpec', spec, field: 'name' });
      const specDescription = tTalent({ kind: 'talentSpec', spec, field: 'description' });
      const masteryName = tTalent({ kind: 'talentMastery', spec, field: 'name' });
      const masteryDescription = tTalent({
        kind: 'talentMastery',
        spec,
        field: 'description',
      });
      const panel = document.createElement('div');
      panel.className = `ts-panel${entry.selected ? ' sel' : ''}`;
      let html =
        `<div class="ts-panel-head">${specIconHtml(talentSpecIconRef(spec))}` +
        `<div class="ts-panel-title"><div class="ts-name">${esc(specName)}</div><div class="ts-role">${roleLabel(spec.role)}</div></div></div>` +
        `<div class="ts-det-desc">${esc(specDescription)}</div>`;
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
      html += `<div class="ts-det-mastery"><b>${esc(masteryName)}</b> - ${esc(masteryDescription)}</div>`;
      if (info?.examples.length) {
        html += `<div class="ts-ex-block"><div class="ts-det-label">${t('hudChrome.specPanel.exampleAbilities')}</div><div class="ts-ex-list">`;
        for (const id of info.examples) {
          html += `<div class="ts-ex" tabindex="0" data-ability="${esc(id)}"><span class="ts-ex-icon" style="background-image:url(${iconDataUrl('ability', id)})" aria-hidden="true"></span><span class="ts-ex-name">${esc(signatureName(id))}</span></div>`;
        }
        html += '</div></div>';
      }
      panel.innerHTML = html;
      // The HEAD is the radio control (focusable, arrow-roved, checked state),
      // NOT the panel: the panel also contains the focusable View talents button
      // and the example-ability tiles, and a focusable descendant inside an
      // interactive element is an axe nested-interactive violation.
      const head = panel.querySelector<HTMLElement>('.ts-panel-head');
      if (head) {
        head.setAttribute('role', 'radio');
        head.setAttribute('aria-checked', String(entry.selected));
        head.setAttribute(
          'tabindex',
          index === (selectedIndex >= 0 ? selectedIndex : 0) ? '0' : '-1',
        );
        head.setAttribute('aria-label', `${specName}, ${roleLabel(spec.role)}`);
        head.addEventListener('keydown', (event) => {
          const keyEvent = event as KeyboardEvent;
          if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
            keyEvent.preventDefault();
            this.selectSpec(entry);
            return;
          }
          const next = rovingTarget(keyEvent.key, index, view.specs.length, 'both');
          if (next === null) return;
          keyEvent.preventDefault();
          this.selectSpec(view.specs[next]);
          this.deps.root().querySelector<HTMLElement>('.ts-panel.sel .ts-panel-head')?.focus();
        });
      }
      // Hover/focus tooltip per example ability: reuse the HUD's rich ability
      // tooltip so a new player can read what each does before committing.
      for (const exEl of Array.from(panel.querySelectorAll<HTMLElement>('.ts-ex'))) {
        const id = exEl.dataset.ability ?? '';
        exEl.setAttribute('aria-label', signatureName(id));
        this.deps.attachTooltip(exEl, () => this.deps.abilityTooltip(id) ?? esc(signatureName(id)));
      }
      // Every panel gets a View talents button: it commits the spec if needed and
      // jumps to the Choices tab. The selected spec's button reads as primary.
      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = `btn ts-view-talents${entry.selected ? ' primary' : ''}${info?.examples.length ? ' has-ex' : ''}`;
      viewBtn.textContent = t('hudChrome.specPanel.viewTalents');
      viewBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.activateSpec(entry);
      });
      panel.appendChild(viewBtn);
      panel.addEventListener('click', () => this.selectSpec(entry));
      grid.appendChild(panel);
    });
    body.appendChild(grid);
  }

  /** Clicking a panel commits the spec (server-validated) and stays on the tab. */
  private selectSpec(entry: TalentSpecVM): void {
    if (entry.action !== 'commit') return;
    this.deps.commitSpec(entry.spec.id);
    this.refreshFromAuthority();
  }

  /** View talents: commit the spec if it is not active yet, then jump to Choices. */
  private activateSpec(entry: TalentSpecVM): void {
    if (entry.action === 'commit') this.deps.commitSpec(entry.spec.id);
    this.tab = 'rows';
    this.refreshFromAuthority();
  }

  private paintRowsTab(body: HTMLElement, view: TalentsView): void {
    const wrap = document.createElement('div');
    wrap.className = 'tal-rows';
    const soon = t('hudChrome.talentRows.comingSoon');
    for (const row of view.rows) {
      const rowElement = document.createElement('div');
      rowElement.className = `tal-row${row.unlocked ? '' : ' locked'}`;
      const level = document.createElement('span');
      level.className = `tal-row-lv${row.unlocked ? '' : ' locked'}`;
      level.textContent = formatNumber(row.level, { maximumFractionDigits: 0 });
      const options = document.createElement('div');
      options.className = 'tal-row-opts';
      for (const optionVM of row.options) {
        const option = optionVM.option;
        const name = tTalent({ kind: 'talentChoice', choice: option, field: 'name' });
        const description = tTalent({
          kind: 'talentChoice',
          choice: option,
          field: 'description',
        });
        const button = document.createElement('button');
        button.type = 'button';
        button.className =
          `tal-row-opt${optionVM.picked ? ' picked' : ''}` +
          `${optionVM.pending ? ' pending' : ''}`;
        button.disabled = optionVM.disabled;
        button.dataset.rowLevel = String(row.level);
        button.dataset.optionId = option.id;
        button.setAttribute('aria-pressed', String(optionVM.picked));
        button.setAttribute(
          'aria-label',
          `${name}. ${description}${optionVM.pending ? ` (${soon})` : ''}`,
        );
        const icon = talentIconDataUrl(talentRowOptionIconRef(option));
        button.innerHTML =
          `<img src="${esc(icon)}" alt="" draggable="false"><b>${esc(name)}</b>` +
          (optionVM.pending ? `<i class="tal-soon">${esc(soon)}</i>` : '');
        this.deps.attachTooltip(
          button,
          () =>
            `<b>${esc(name)}</b><br><span>${esc(description)}</span>` +
            (optionVM.pending
              ? `<br><i style="color:${TAL_COLOR.choiceDim}">${esc(soon)}</i>`
              : `<br><i style="color:${TAL_COLOR.hint}">${t('game.talents.cycleHint')}</i>`),
        );
        button.addEventListener('click', () => {
          this.deps.selectRow(
            row.level as TalentRowLevel,
            optionVM.action === 'clear' ? null : option.id,
          );
          this.refreshFromAuthority();
        });
        options.appendChild(button);
      }
      rowElement.append(level, options);
      wrap.appendChild(rowElement);
    }
    body.appendChild(wrap);
  }

  private refreshFromAuthority(): void {
    this.render();
    window.setTimeout(() => {
      if (this.deps.root().style.display === 'block') this.render();
    }, AUTHORITATIVE_REFRESH_MS);
  }

  // The WoW-style loadout bar (ported from the tree-flip lineage the PR 1757
  // revert dropped): ONE compact dropdown button, bottom-left. The menu opens
  // upward with the saved builds, save/new, import/export, and reset. Every
  // action rides the same authoritative IWorld paths the old two-card footer
  // used; nothing stages locally.
  private footerHtml(_view: TalentsView): string {
    const activeIndex = this.deps.activeLoadout();
    const active = activeIndex >= 0 ? this.deps.loadouts()[activeIndex] : null;
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

  private wireFooter(root: HTMLElement, view: TalentsView): void {
    const btn = root.querySelector<HTMLButtonElement>('[data-act="loadout-menu"]');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (root.querySelector('.tal-loadout-menu')) {
        this.closeLoadoutMenu(root);
        return;
      }
      this.openLoadoutMenu(root, btn, view);
    });
  }

  private closeLoadoutMenu(root: HTMLElement): void {
    root.querySelector('.tal-loadout-menu')?.remove();
    root.querySelector('[data-act="loadout-menu"]')?.setAttribute('aria-expanded', 'false');
    if (this.dismissLoadoutMenu) {
      document.removeEventListener('pointerdown', this.dismissLoadoutMenu, true);
      this.dismissLoadoutMenu = null;
    }
  }

  // Build the upward loadout menu: the saved builds (pick + delete), then
  // save-current / new / import / export / reset.
  private openLoadoutMenu(root: HTMLElement, btn: HTMLButtonElement, view: TalentsView): void {
    const cls = this.deps.playerClass();
    const loadouts = this.deps.loadouts();
    const activeIndex = this.deps.activeLoadout();

    const saveCurrent = (name: string): void => {
      const clean = name.trim();
      if (!clean) return;
      const allocation = this.deps.currentAllocation();
      if (!validateAllocation(cls, allocation, this.deps.playerLevel()).ok) {
        this.deps.showError(t('game.talents.buildInvalid'));
        return;
      }
      this.deps.saveLoadout(clean, this.deps.currentBar(), allocation);
      this.refreshFromAuthority();
    };
    const promptNewBuild = (): void => {
      this.deps.inputDialog({
        title: t('game.talents.saveBuildAs'),
        label: t('game.talents.namePrompt'),
        value: t('hudChrome.talents.defaultBuildName', { n: this.deps.loadouts().length + 1 }),
        okText: t('game.talents.save'),
        selectText: true,
        onOk: saveCurrent,
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
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tal-lo-item${opts.cls ? ` ${opts.cls}` : ''}`;
      button.setAttribute('role', 'menuitem');
      button.textContent = label;
      if (opts.disabled) button.disabled = true;
      if (opts.onPick) button.addEventListener('click', opts.onPick);
      return button;
    };

    // Saved builds: pick applies (server re-validated), the X deletes.
    if (loadouts.length === 0) {
      const none = document.createElement('div');
      none.className = 'tal-lo-empty';
      none.textContent = t('game.talents.noBuilds');
      menu.appendChild(none);
    }
    loadouts.forEach((loadout, index) => {
      const row = document.createElement('div');
      row.className = `tal-lo-row${index === activeIndex ? ' active' : ''}`;
      const pick = item(loadout.name, {
        cls: 'tal-lo-pick',
        onPick: () => {
          this.closeLoadoutMenu(root);
          this.deps.switchLoadout(index);
          this.deps.applyLoadoutBar(loadout.bar, loadout.alloc);
          this.refreshFromAuthority();
        },
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tal-lo-del';
      del.setAttribute('aria-label', `${t('game.talents.deleteBuild')}: ${loadout.name}`);
      del.innerHTML = svgIcon('close');
      del.addEventListener('click', (event) => {
        event.stopPropagation();
        this.closeLoadoutMenu(root);
        this.deps.confirmDialog(
          t('game.talents.deleteBuildTitle'),
          t('game.talents.deleteBuildBody', { name: loadout.name }),
          t('game.talents.deleteBuildConfirm'),
          t('game.talents.cancel'),
          () => {
            this.deps.deleteLoadout(index);
            this.refreshFromAuthority();
          },
        );
      });
      row.append(pick, del);
      menu.appendChild(row);
    });

    const sep = document.createElement('div');
    sep.className = 'tal-lo-sep';
    menu.appendChild(sep);

    const active = activeIndex >= 0 ? loadouts[activeIndex] : null;
    menu.appendChild(
      item(t('game.talents.saveBuild'), {
        disabled: !view.valid,
        onPick: () => {
          this.closeLoadoutMenu(root);
          if (active) saveCurrent(active.name);
          else promptNewBuild();
        },
      }),
    );
    menu.appendChild(
      item(t('game.talents.newBuild'), {
        cls: 'tal-lo-new',
        disabled: !view.valid,
        onPick: () => {
          this.closeLoadoutMenu(root);
          promptNewBuild();
        },
      }),
    );
    menu.appendChild(
      item(t('game.talents.import'), {
        onPick: () => {
          this.closeLoadoutMenu(root);
          this.deps.inputDialog({
            title: t('game.talents.import'),
            label: t('game.talents.importPrompt'),
            placeholder: 'eyJ2Ijox...',
            multiline: true,
            okText: t('game.talents.import'),
            onOk: (value) => {
              const result = importBuild(value.trim());
              if (!result.ok || result.cls !== cls) {
                this.deps.showError(t('game.talents.invalidBuild'));
                return;
              }
              this.deps.applyTalents(result.alloc);
              this.refreshFromAuthority();
            },
          });
        },
      }),
    );
    menu.appendChild(
      item(t('game.talents.export'), {
        onPick: () => {
          this.closeLoadoutMenu(root);
          this.deps.inputDialog({
            title: t('game.talents.export'),
            label: t('game.talents.exportTitle'),
            value: exportBuild(cls, active?.alloc ?? this.deps.currentAllocation()),
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
        disabled: view.pickedCount === 0,
        onPick: () => {
          this.closeLoadoutMenu(root);
          this.deps.respec();
          this.refreshFromAuthority();
        },
      }),
    );

    btn.parentElement?.appendChild(menu);
    btn.setAttribute('aria-expanded', 'true');
    (menu.querySelector('.tal-lo-item, .tal-lo-pick') as HTMLElement | null)?.focus();
    menu.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') {
        event.stopPropagation();
        this.closeLoadoutMenu(root);
        btn.focus();
      }
    });
    // Dismiss on any pointer press outside the menu/button (capture phase so a
    // click that also opens something else still closes this menu first).
    this.dismissLoadoutMenu = (event: Event) => {
      const target = event.target as Node;
      if (!menu.contains(target) && !btn.contains(target)) this.closeLoadoutMenu(root);
    };
    document.addEventListener('pointerdown', this.dismissLoadoutMenu, true);
  }

  private fitBodyToWindow(root: HTMLElement, body: HTMLElement): void {
    body.style.maxHeight = '';
    body.style.overflowY = '';
    if (document.body.classList.contains('mobile-touch')) return;
    const foot = root.querySelector<HTMLElement>('.tal-foot');
    if (!foot) return;
    const rootMaxHeight = Number.parseFloat(getComputedStyle(root).maxHeight);
    const uiScale = getUiScale();
    const bodyTop = (body.getBoundingClientRect().top - root.getBoundingClientRect().top) / uiScale;
    const footHeight = foot.getBoundingClientRect().height / uiScale;
    const cap = talentBodyMaxHeight(rootMaxHeight, bodyTop, footHeight);
    if (cap !== null && body.scrollHeight > cap) {
      body.style.maxHeight = `${cap}px`;
      body.style.overflowY = 'auto';
    }
  }
}
