// Thin DOM painter for the Talents 2.0 specialization and choice-row window.

import type { ChoiceRowLevel } from '../sim/content/choice_rows';
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
import { buildChoiceRowsView, hasChoiceRows } from './choice_rows_view';
import { markDialogRoot } from './dialog_root';
import { classDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { rovingTarget } from './roving_index';
import { roleLabel, tTalent } from './talent_i18n';
import { talentChoiceIconDataUrl } from './talent_icons';
import { buildTalentsView, type TalentsView } from './talents_view';
import { svgIcon } from './ui_icons';

export interface TalentsWindowDeps extends PainterHostPresentation {
  root(): HTMLElement;
  hideTooltip(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  getStage(): TalentAllocation | null;
  setStage(stage: TalentAllocation | null): void;
  playerClass(): PlayerClass;
  playerLevel(): number;
  abilityTooltipForGrant(abilityId: string): string | null;
  /** Server-authoritative full-allocation apply (build import). */
  applyTalents(alloc: TalentAllocation): void;
  /** Server-authoritative row reset (the free respec). */
  resetRows(): void;
  chooseRow(level: ChoiceRowLevel, optionId: string): void;
  currentAllocation(): TalentAllocation;
  activeLoadout(): number;
  loadouts(): readonly SavedLoadout[];
  currentBar(): (string | null)[];
  saveLoadout(name: string, bar: (string | null)[], alloc: TalentAllocation): void;
  switchLoadout(index: number): void;
  deleteLoadout(index: number): void;
  applyLoadoutBar(bar: (string | null)[]): void;
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

const TAL_COLOR = {
  classAccent: 'var(--color-text-muted)',
  signature: 'var(--gold)',
  dormant: 'var(--color-talent-dormant)',
} as const;

function signatureName(abilityId: string): string {
  return ABILITIES[abilityId]
    ? tEntity({ kind: 'ability', id: abilityId, field: 'name' })
    : abilityId;
}

export class TalentsWindow {
  private tab: 'choices' | 'spec' = 'choices';
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly deps: TalentsWindowDeps) {}

  open(): void {
    this.returnFocus = this.deps.captureFocus();
    this.deps.setStage(cloneAllocation(this.deps.currentAllocation()));
    this.render();
    this.deps.root().style.display = 'block';
  }

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
    if (el.style.display !== 'block' && this.deps.getStage() === null) return;
    markDialogRoot(el, { label: t('game.talents.title') });
    const cls = this.deps.playerClass();
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
    let stage = this.deps.getStage();
    if (!stage) {
      stage = cloneAllocation(this.deps.currentAllocation());
      this.deps.setStage(stage);
    }
    const level = this.deps.playerLevel();
    const liveRows = this.deps.currentAllocation().rows ?? {};
    stage.rows = { ...liveRows };
    const view = buildTalentsView(stage, cls, level);

    el.innerHTML =
      `<div class="panel-title"><span>${t('game.talents.title')} <span style="color:${TAL_COLOR.classAccent};font-size:11px">${esc(classDisplayName(cls))}</span></span>${close}</div>` +
      `<div class="tal-head"><span>${t('game.talents.choicesTab')}: <b>${view.pickedRows}</b> / ${view.unlockedRows}</span><span>${t('game.talents.specTab')}: <b>${view.selectedSpec ? esc(tTalent({ kind: 'talentSpec', spec: view.selectedSpec, field: 'name' })) : esc(t('game.talents.chooseSpec'))}</b></span></div>` +
      `<div class="tal-tabs" role="tablist" aria-label="${esc(t('game.talents.title'))}">` +
      (hasChoiceRows(cls)
        ? `<div class="tal-tab${this.tab === 'choices' ? ' active' : ''}" role="tab" tabindex="${this.tab === 'choices' ? '0' : '-1'}" aria-selected="${this.tab === 'choices'}" aria-controls="tal-body" data-tab="choices"><span class="tal-tab-label">${t('game.talents.choicesTab')}</span><span class="tt-pts">${view.pickedRows}</span></div>`
        : '') +
      `<div class="tal-tab${this.tab === 'spec' ? ' active' : ''}" role="tab" tabindex="${this.tab === 'spec' ? '0' : '-1'}" aria-selected="${this.tab === 'spec'}" aria-controls="tal-body" data-tab="spec"><span class="tal-tab-label">${t('game.talents.specTab')}</span></div>` +
      `</div><div id="tal-body" role="tabpanel"></div>` +
      this.footerHtml(view);

    const tabs = Array.from(el.querySelectorAll<HTMLElement>('.tal-tab'));
    const switchTab = (tab: HTMLElement): void => {
      this.tab = tab.dataset.tab as 'choices' | 'spec';
      this.render();
    };
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
    if (this.tab === 'spec') this.paintSpecTab(body, view, stage);
    else this.paintChoiceRows(body);
    this.wireFooter(el, stage, level);
  }

  private paintChoiceRows(body: HTMLElement): void {
    const cls = this.deps.playerClass();
    const level = this.deps.playerLevel();
    const rowsView = buildChoiceRowsView(cls, level, this.deps.currentAllocation().rows ?? {});
    const wrap = document.createElement('div');
    wrap.className = 'tal-rows';
    for (const row of rowsView.rows) {
      const rowEl = document.createElement('div');
      rowEl.className = `tal-row${row.unlocked ? '' : ' locked'}`;
      const head = document.createElement('div');
      head.className = 'tal-row-head';
      head.innerHTML =
        `<span class="tal-row-lvl">${row.level}</span>` +
        (row.unlocked
          ? ''
          : `<span class="tal-row-lock">${esc(
              t('game.talents.rowUnlocks').replace('{level}', String(row.level)),
            )}</span>`);
      rowEl.appendChild(head);
      const opts = document.createElement('div');
      opts.className = 'tal-row-opts';
      opts.setAttribute('role', 'radiogroup');
      opts.setAttribute('aria-label', `${t('game.talents.choicesTab')} ${row.level}`);
      for (const { option, picked } of row.options) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `tal-row-opt${picked ? ' sel' : ''}`;
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', String(picked));
        card.disabled = !row.unlocked;
        const label = tTalent({ kind: 'talentChoice', choice: option, field: 'name' });
        const description = tTalent({ kind: 'talentChoice', choice: option, field: 'description' });
        card.innerHTML =
          `<span class="tco-icon" style="background-image:url(${esc(
            talentChoiceIconDataUrl(option),
          )})"></span>` + `<span class="tal-row-opt-name">${esc(label)}</span>`;
        this.deps.attachTooltip(card, () => {
          let html = `<div class="tt-name">${esc(label)}</div>`;
          html += `<div class="tt-desc">${esc(description)}</div>`;
          const granted = option.effect.grant?.ability;
          const grantTooltip = granted ? this.deps.abilityTooltipForGrant(granted) : null;
          if (grantTooltip) html += grantTooltip;
          if (!row.unlocked) {
            html += `<div class="tt-sub" style="color:${TAL_COLOR.dormant}">${esc(
              t('game.talents.rowUnlocks').replace('{level}', String(row.level)),
            )}</div>`;
          }
          return html;
        });
        card.addEventListener('click', () => {
          if (!row.unlocked || picked) return;
          this.deps.chooseRow(row.level, option.id);
          this.deps.hideTooltip();
          const stage = this.deps.getStage();
          if (stage) stage.rows = { ...stage.rows, [row.level]: option.id };
          this.render();
        });
        opts.appendChild(card);
      }
      rowEl.appendChild(opts);
      wrap.appendChild(rowEl);
    }
    body.appendChild(wrap);
  }

  private paintSpecTab(body: HTMLElement, view: TalentsView, stage: TalentAllocation): void {
    const picker = document.createElement('div');
    picker.className = 'tal-specs';
    picker.setAttribute('role', 'radiogroup');
    picker.setAttribute('aria-label', t('game.talents.specTab'));
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
      this.deps.attachTooltip(card, () => {
        let html =
          `<div class="tt-title">${esc(specName)}</div><div class="tt-sub">${esc(specDescription)}</div>` +
          `<div class="tt-sub" style="color:${TAL_COLOR.signature}">${t('game.talents.signature')}: ${esc(signatureName(sp.signature))}</div>` +
          `<div class="tt-sub">${t('game.talents.mastery')}: ${esc(masteryName)} - ${esc(masteryDescription)}</div>`;
        const grantTooltip = this.deps.abilityTooltipForGrant(sp.signature);
        if (grantTooltip) html += grantTooltip;
        return html;
      });
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
  }

  private setSpec(stage: TalentAllocation, specId: string): void {
    if (stage.spec === specId) return;
    stage.spec = specId;
    this.render();
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
      `<button class="btn tal-secondary" data-act="clear"${view.pickedRows > 0 ? '' : ' disabled'}>${t('game.talents.clear')}</button>` +
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

  private wireFooter(el: HTMLElement, stage: TalentAllocation, playerLevel: number): void {
    const cls = this.deps.playerClass();
    el.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
      // the FREE respec: server-authoritative row reset (rows re-pick freely);
      // render re-reads the live allocation, so no stage bookkeeping here
      this.deps.resetRows();
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
      if (!validateAllocation(cls, stage, playerLevel).ok) {
        this.deps.showError(t('game.talents.buildInvalid'));
        return;
      }
      const activeLoadout = this.deps.activeLoadout();
      const active = activeLoadout >= 0 ? this.deps.loadouts()[activeLoadout] : null;
      if (active) saveStagedBuild(active.name);
      else promptNewBuild();
    });
    el.querySelector('[data-act="new"]')?.addEventListener('click', () => {
      if (!validateAllocation(cls, stage, playerLevel).ok) {
        this.deps.showError(t('game.talents.buildInvalid'));
        return;
      }
      promptNewBuild();
    });
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
      this.deps.confirmDialog(
        t('game.talents.deleteBuildTitle'),
        t('game.talents.deleteBuildBody', { name: active.name }),
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
        placeholder: 'eyJ2Ijoy...',
        multiline: true,
        okText: t('game.talents.import'),
        onOk: (str) => {
          const res = importBuild(str.trim());
          if (!res.ok || res.cls !== cls) {
            this.deps.showError(t('game.talents.invalidBuild'));
            return;
          }
          // imports APPLY (server-authoritative): staging alone would be
          // clobbered by the live-rows re-sync on the next render
          this.deps.applyTalents(res.alloc);
          this.deps.setStage(cloneAllocation(res.alloc));
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
