// Cold DOM adapter for the raid encounter journal opened from party frames.
// raid_boss_guide_view.ts owns the boss, phase, difficulty, and mechanic data;
// this class owns browsing state, localization, tooltips, and focus return.

import type { LinkedProgramTouchQueue } from '../render/linked_program_touch_lane';
import { markDialogRoot } from './dialog_root';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { captureFocusKey, FOCUS_KEY_ATTR, restoreFirstEnabled } from './focus_restore';
import { formatList, formatNumber, type InterpolationValues, type TranslationKey, t } from './i18n';
import { iconDataUrl } from './icons';
import { blurIfPointerClick } from './pointer_blur';
import { RaidBossGuideModelController } from './raid_boss_guide_model_controller';
import { bindRaidBossGuideScroll } from './raid_boss_guide_scroll';
import {
  type RaidBossGuideBoss,
  type RaidBossGuideDifficulty,
  type RaidBossGuideFlag,
  type RaidBossGuideMechanic,
  type RaidBossGuidePhase,
  type RaidBossGuideRole,
  type RaidBossGuideTextKey,
  raidBossGuideBossForDungeon,
  raidBossGuideView,
} from './raid_boss_guide_view';
import { svgIcon, type UiIconName } from './ui_icons';

export interface RaidBossGuideWindowDeps {
  root(): HTMLElement;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  contextFallback(): HTMLElement | null;
  attachTooltip(element: HTMLElement, html: () => string): void;
  hideTooltip(): void;
  modelTouchQueue?(): LinkedProgramTouchQueue | null;
}

const BOSSES: readonly RaidBossGuideBoss[] = ['ignivar', 'varkhul'];
const DIFFICULTIES: readonly RaidBossGuideDifficulty[] = ['normal', 'heroic'];

const ROLE_PRESENTATION: Readonly<Record<RaidBossGuideRole, [RaidBossGuideTextKey, UiIconName]>> = {
  tank: ['hudChrome.raidBossGuide.roleTank', 'tank'],
  healer: ['hudChrome.raidBossGuide.roleHealer', 'healer'],
  damage: ['hudChrome.raidBossGuide.roleDamage', 'attack'],
  all: ['hudChrome.raidBossGuide.roleAll', 'target'],
};

const FLAG_PRESENTATION: Readonly<Record<RaidBossGuideFlag, [RaidBossGuideTextKey, UiIconName]>> = {
  deadly: ['hudChrome.raidBossGuide.flagDeadly', 'skull'],
  interruptible: ['hudChrome.raidBossGuide.flagInterruptible', 'alert'],
  important: ['hudChrome.raidBossGuide.flagImportant', 'alert'],
  cleansable: ['hudChrome.raidBossGuide.flagCleansable', 'check'],
};

function tx(key: RaidBossGuideTextKey, values?: InterpolationValues): string {
  return t(key as TranslationKey, values);
}

function formattedValues(
  values: Readonly<Record<string, number>> | undefined,
  percentValues: readonly string[] = [],
): InterpolationValues | undefined {
  if (!values) return undefined;
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      formatNumber(
        value,
        percentValues.includes(name) ? { style: 'percent', maximumFractionDigits: 0 } : undefined,
      ),
    ]),
  );
}

function bossName(boss: RaidBossGuideBoss): string {
  return tEntity({ kind: 'mob', id: raidBossGuideView(boss).bossId, field: 'name' });
}

function difficultyName(difficulty: RaidBossGuideDifficulty): string {
  return tx(`hudChrome.raidBossGuide.${difficulty}`);
}

function badgeHtml(
  kind: 'role' | 'flag',
  id: RaidBossGuideRole | RaidBossGuideFlag,
  key: RaidBossGuideTextKey,
  icon: UiIconName,
): string {
  const label = tx(key);
  return `<span class="rbg-badge rbg-badge-${esc(kind)} rbg-badge-${esc(id)}" title="${esc(label)}" aria-label="${esc(label)}">${svgIcon(icon)}<span>${esc(label)}</span></span>`;
}

function mechanicBadges(mechanic: RaidBossGuideMechanic): string {
  const roles = mechanic.roles
    .map((role) => badgeHtml('role', role, ...ROLE_PRESENTATION[role]))
    .join('');
  const flags = mechanic.flags
    .map((flag) => badgeHtml('flag', flag, ...FLAG_PRESENTATION[flag]))
    .join('');
  return `<span class="rbg-badges"><span class="rbg-role-badges" aria-label="${esc(tx('hudChrome.raidBossGuide.rolesLabel'))}">${roles}</span><span class="rbg-flag-badges" aria-label="${esc(tx('hudChrome.raidBossGuide.flagsLabel'))}">${flags}</span></span>`;
}

export function raidBossGuideContextFallback(doc: Document, mobile: boolean): HTMLElement | null {
  return doc.querySelector<HTMLElement>(mobile ? '#mobile-more' : '#mm-char');
}

export class RaidBossGuideWindow {
  readonly button: HTMLButtonElement;
  private readonly buttonLabel: HTMLSpanElement;
  private contextBoss: RaidBossGuideBoss | null = null;
  private selectedBoss: RaidBossGuideBoss | null = null;
  private difficulty: RaidBossGuideDifficulty = 'normal';
  private expandedMechanicId: string | null = null;
  private openerFocus: HTMLElement | null = null;

  constructor(
    private readonly deps: RaidBossGuideWindowDeps,
    doc: Document = document,
    private readonly modelController: RaidBossGuideModelController = new RaidBossGuideModelController(
      doc,
      undefined,
      undefined,
      undefined,
      deps.modelTouchQueue,
    ),
  ) {
    this.button = doc.createElement('button');
    this.button.type = 'button';
    this.button.className = 'party-boss-guide-button';
    this.button.insertAdjacentHTML('beforeend', svgIcon('book'));
    this.buttonLabel = doc.createElement('span');
    this.button.append(this.buttonLabel);
    this.button.addEventListener('click', (event) => {
      blurIfPointerClick(event, this.button);
      this.toggle();
    });
  }

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  syncAvailability(dungeonId: string | null): HTMLButtonElement | null {
    const nextContextBoss = raidBossGuideBossForDungeon(dungeonId);
    if (!nextContextBoss) {
      if (this.isOpen) this.close(this.deps.contextFallback());
      else if (this.button.ownerDocument.activeElement === this.button) {
        this.deps.restoreFocus(this.deps.contextFallback());
      }
      this.contextBoss = null;
      this.selectedBoss = null;
      this.expandedMechanicId = null;
      return null;
    }

    const contextChanged = nextContextBoss !== this.contextBoss;
    this.contextBoss = nextContextBoss;
    let selectionChanged = false;
    if (!this.selectedBoss || (contextChanged && this.selectedBoss !== nextContextBoss)) {
      this.selectedBoss = nextContextBoss;
      this.expandedMechanicId = null;
      selectionChanged = true;
    }
    if (contextChanged) this.paintButton();
    if (selectionChanged && this.isOpen) this.render();
    return this.button;
  }

  toggle(): void {
    if (!this.contextBoss) return;
    if (this.isOpen) {
      this.close();
      return;
    }
    this.selectedBoss ??= this.contextBoss;
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'raid-boss-guide-title' });
    root.style.display = 'block';
    this.render();
    root.querySelector<HTMLElement>(`[data-boss="${this.selectedBoss}"]`)?.focus();
  }

  close(focusFallback: HTMLElement | null = null): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') return;
    this.deps.hideTooltip();
    this.modelController.destroy();
    root.style.display = 'none';
    this.deps.restoreFocus(focusFallback ?? this.openerFocus);
    this.openerFocus = null;
  }

  relocalize(): void {
    if (this.contextBoss) this.paintButton();
    if (this.isOpen) this.render();
  }

  resetGraphicsPreviewContext(): void {
    this.modelController.destroy();
  }

  restoreGraphicsPreviewContext(): void {
    if (this.isOpen) this.render();
  }

  render(focusKey?: string): void {
    if (!this.selectedBoss) return;
    const root = this.deps.root();
    const restoreKey = focusKey ?? captureFocusKey(root) ?? undefined;
    const view = raidBossGuideView(this.selectedBoss, this.difficulty);
    const selectedBossName = tEntity({ kind: 'mob', id: view.bossId, field: 'name' });
    const selectedDifficultyName = difficultyName(this.difficulty);

    root.innerHTML =
      `<div class="rbg-head panel-title">` +
      `<div><div id="raid-boss-guide-title">${esc(t('hudChrome.raidBossGuide.title'))}</div>` +
      `<div class="rbg-subtitle">${esc(
        t('hudChrome.raidBossGuide.subtitle', {
          boss: selectedBossName,
          difficulty: selectedDifficultyName,
        }),
      )}</div></div>` +
      `<button type="button" class="x-btn" data-close data-focus-key="close" aria-label="${esc(
        t('hudChrome.raidBossGuide.close'),
      )}">${svgIcon('close')}</button></div>` +
      `<div class="rbg-shell">${this.bossNavigation()}<section class="rbg-journal" tabindex="0" data-focus-key="journal" aria-label="${esc(
        t('hudChrome.raidBossGuide.title'),
      )}">` +
      `${this.heroHtml(selectedBossName, view.overviewKey)}` +
      `${this.difficultyHtml()}` +
      `<div class="rbg-section-title">${esc(tx('hudChrome.raidBossGuide.abilitiesHeading'))}</div>` +
      `<div class="rbg-phases">${view.phases.map((phase) => this.phaseHtml(phase)).join('')}</div>` +
      `</section></div>`;

    const modelSlot = root.querySelector<HTMLElement>('[data-model-slot]');
    if (modelSlot) {
      this.modelController.mount(modelSlot, {
        boss: this.selectedBoss,
        name: selectedBossName,
        posterUrl: view.portraitUrl,
        canvasLabel: t('guide.viewer.canvasLabel', { name: selectedBossName }),
        loadingText: t('guide.viewer.loading'),
        errorText: t('guide.viewer.error', { name: selectedBossName }),
        hintText: t('guide.viewer.dragHint'),
        viewButtonText: t('guide.viewer.view3dShort'),
        viewButtonLabel: t('guide.viewer.view3d', { name: selectedBossName }),
      });
    }

    const journal = root.querySelector<HTMLElement>('.rbg-journal');
    if (journal) bindRaidBossGuideScroll(journal);
    root.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', () => this.close());
    for (const bossButton of root.querySelectorAll<HTMLButtonElement>('[data-boss]')) {
      bossButton.addEventListener('click', () => {
        const boss = bossButton.dataset.boss as RaidBossGuideBoss | undefined;
        if (!boss || boss === this.selectedBoss) return;
        this.deps.hideTooltip();
        this.selectedBoss = boss;
        this.expandedMechanicId = null;
        this.render(`boss:${boss}`);
      });
    }
    for (const difficultyButton of root.querySelectorAll<HTMLButtonElement>('[data-difficulty]')) {
      difficultyButton.addEventListener('click', () => {
        const difficulty = difficultyButton.dataset.difficulty as
          | RaidBossGuideDifficulty
          | undefined;
        if (!difficulty || difficulty === this.difficulty) return;
        this.deps.hideTooltip();
        this.difficulty = difficulty;
        this.expandedMechanicId = null;
        this.render(`difficulty:${difficulty}`);
      });
    }
    for (const phase of view.phases) {
      for (const mechanic of phase.mechanics) {
        const control = root.querySelector<HTMLButtonElement>(`[data-mechanic="${mechanic.id}"]`);
        if (!control) continue;
        control.addEventListener('click', () => {
          this.deps.hideTooltip();
          this.expandedMechanicId = this.expandedMechanicId === mechanic.id ? null : mechanic.id;
          this.render(`mechanic:${mechanic.id}`);
        });
        this.deps.attachTooltip(control, () => this.mechanicTooltip(phase, mechanic));
      }
    }
    if (restoreKey) {
      const keyed = [...root.querySelectorAll<HTMLElement>(`[${FOCUS_KEY_ATTR}]`)];
      restoreFirstEnabled([
        keyed.find((candidate) => candidate.dataset.focusKey === restoreKey),
        root.querySelector<HTMLElement>('[data-close]'),
      ]);
    }
  }

  private bossNavigation(): string {
    return `<nav class="rbg-boss-nav" aria-label="${esc(tx('hudChrome.raidBossGuide.bossesLabel'))}">${BOSSES.map(
      (boss) => {
        const view = raidBossGuideView(boss, this.difficulty);
        const name = bossName(boss);
        const selected = boss === this.selectedBoss;
        return `<button type="button" class="rbg-boss-tab${selected ? ' active' : ''}" data-boss="${boss}" data-focus-key="boss:${boss}" aria-pressed="${selected}" aria-label="${esc(
          tx('hudChrome.raidBossGuide.browseBoss', { boss: name }),
        )}"><img src="${esc(view.portraitUrl)}" alt="" aria-hidden="true"><span>${esc(name)}</span></button>`;
      },
    ).join('')}</nav>`;
  }

  private heroHtml(selectedBossName: string, overviewKey: RaidBossGuideTextKey): string {
    return `<div class="rbg-hero"><div class="rbg-model-slot" data-model-slot></div><div class="rbg-overview"><h2>${esc(selectedBossName)}</h2><div class="rbg-section-kicker">${esc(
      tx('hudChrome.raidBossGuide.overviewHeading'),
    )}</div><p>${esc(tx(overviewKey))}</p></div></div>`;
  }

  private difficultyHtml(): string {
    return `<div class="rbg-difficulty"><span>${esc(
      tx('hudChrome.raidBossGuide.difficultyLabel'),
    )}</span><div class="rbg-segmented" role="group" aria-label="${esc(
      tx('hudChrome.raidBossGuide.difficultyLabel'),
    )}">${DIFFICULTIES.map((difficulty) => {
      const name = difficultyName(difficulty);
      const selected = difficulty === this.difficulty;
      return `<button type="button" data-difficulty="${difficulty}" data-focus-key="difficulty:${difficulty}" aria-pressed="${selected}" aria-label="${esc(
        tx('hudChrome.raidBossGuide.chooseDifficulty', { difficulty: name }),
      )}" class="${selected ? 'active' : ''}">${esc(name)}</button>`;
    }).join('')}</div></div>`;
  }

  private phaseHtml(phase: RaidBossGuidePhase): string {
    const values = formattedValues(phase.values, phase.percentValues);
    return `<section class="rbg-phase" data-phase="${esc(phase.id)}"><header><div class="rbg-phase-rule"></div><div><h3>${esc(
      tx(phase.nameKey),
    )}</h3><p>${esc(tx(phase.summaryKey, values))}</p></div></header><div class="rbg-abilities">${phase.mechanics
      .map((mechanic) => this.mechanicHtml(mechanic))
      .join('')}</div></section>`;
  }

  private mechanicHtml(mechanic: RaidBossGuideMechanic): string {
    const expanded = mechanic.id === this.expandedMechanicId;
    const values = formattedValues(mechanic.values, mechanic.percentValues);
    const name = tx(mechanic.nameKey, values);
    const detailId = `rbg-detail-${mechanic.id}`;
    const actionKey = expanded
      ? 'hudChrome.raidBossGuide.collapseAbility'
      : 'hudChrome.raidBossGuide.expandAbility';
    const semanticLabels = [
      ...mechanic.roles.map((role) => tx(ROLE_PRESENTATION[role][0])),
      ...mechanic.flags.map((flag) => tx(FLAG_PRESENTATION[flag][0])),
    ];
    const accessibleLabel = tx('hudChrome.raidBossGuide.abilityControlLabel', {
      action: tx(actionKey, { ability: name }),
      details: formatList(semanticLabels),
    });
    const response = tx('hudChrome.raidBossGuide.whatToDoResponse', {
      response: tx(mechanic.responseKey, values),
    });
    return `<article class="rbg-ability${expanded ? ' expanded' : ''}"><button type="button" class="rbg-ability-toggle" data-mechanic="${esc(
      mechanic.id,
    )}" data-focus-key="mechanic:${esc(mechanic.id)}" aria-expanded="${expanded}"${
      expanded ? ` aria-controls="${esc(detailId)}"` : ''
    } aria-label="${esc(accessibleLabel)}"><img src="${esc(
      iconDataUrl('ability', mechanic.iconId, 48),
    )}" alt="" aria-hidden="true"><span class="rbg-ability-main"><span class="rbg-expand-mark" aria-hidden="true">${expanded ? '−' : '+'}</span><span class="rbg-ability-name">${esc(
      name,
    )}</span></span>${mechanicBadges(mechanic)}</button>${
      expanded
        ? `<div class="rbg-ability-detail" id="${esc(detailId)}" data-detail="${esc(
            mechanic.id,
          )}"><p>${esc(tx(mechanic.summaryKey, values))}</p><p>${esc(response)}</p></div>`
        : ''
    }</article>`;
  }

  private mechanicTooltip(phase: RaidBossGuidePhase, mechanic: RaidBossGuideMechanic): string {
    const values = formattedValues(mechanic.values, mechanic.percentValues);
    const name = tx(mechanic.nameKey, values);
    const meta = tx('hudChrome.raidBossGuide.tooltipMeta', {
      phase: tx(phase.nameKey),
      difficulty: difficultyName(this.difficulty),
    });
    const response = tx('hudChrome.raidBossGuide.whatToDoResponse', {
      response: tx(mechanic.responseKey, values),
    });
    return `<div class="tt-title">${esc(name)}</div><div class="tt-sub">${esc(
      meta,
    )}</div><div class="tt-desc">${esc(
      tx(mechanic.summaryKey, values),
    )}</div><div class="tt-desc">${esc(response)}</div>`;
  }

  private paintButton(): void {
    if (!this.contextBoss) return;
    const name = bossName(this.contextBoss);
    const text = t('hudChrome.raidBossGuide.button', { boss: name });
    this.buttonLabel.textContent = text;
    this.button.title = text;
    this.button.setAttribute('aria-label', text);
  }
}
