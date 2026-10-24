// Cold DOM adapter for the encounter journal opened from party frames (and
// from the Dungeon Finder's boss list). A journal SOURCE owns the boss, phase,
// difficulty, and mechanic data: the raid guide (raid_boss_guide_view.ts) or a
// five-player dungeon page (boss_journal/). This class owns browsing state,
// localization, tooltips, and focus return.

import type { LinkedProgramTouchQueue } from '../render/linked_program_touch_lane';
import { journalModelFor } from './boss_journal/journal_model_spec';
import {
  choicesHtml,
  damageCompareText,
  formattedJournalValues,
  heroicNotesHtml,
  markChipsHtml,
  markLabels,
  rankChipHtml,
  rankLabel,
  tipsHtml,
} from './boss_journal/journal_sections';
import {
  type JournalBossView,
  type JournalContext,
  type JournalDifficulty,
  type JournalMechanic,
  type JournalPhase,
  type JournalRunInput,
  type JournalSource,
  journalBossDefeated,
  journalContextFor,
} from './boss_journal/journal_view';
import { dungeonJournalSourceFor } from './boss_journal/registry';
import { markDialogRoot } from './dialog_root';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { captureFocusKey, FOCUS_KEY_ATTR, restoreFirstEnabled } from './focus_restore';
import { formatList, formatNumber, type InterpolationValues, type TranslationKey, t } from './i18n';
import { iconDataUrl } from './icons';
import { blurIfPointerClick } from './pointer_blur';
import { RaidBossGuideModelController } from './raid_boss_guide_model_controller';
import { bindRaidBossGuideScroll } from './raid_boss_guide_scroll';
import type {
  RaidBossGuideFlag,
  RaidBossGuideRole,
  RaidBossGuideTextKey,
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
  /** The dungeon run the player stands in (IWorld.dungeonRun): suggests the
   *  next boss, the run's difficulty, and marks the defeated bosses. */
  dungeonRun?(): JournalRunInput | null;
}

const DIFFICULTIES: readonly JournalDifficulty[] = ['normal', 'heroic'];

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

function tx(key: RaidBossGuideTextKey | TranslationKey, values?: InterpolationValues): string {
  return t(key as TranslationKey, values);
}

// The raid pages keep their shipped number formatting; the dungeon pages pass
// fractional cast times, so they format through journal_sections.
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

function mobName(mobId: string): string {
  return tEntity({ kind: 'mob', id: mobId, field: 'name' });
}

function dungeonName(dungeonId: string): string {
  return tEntity({ kind: 'dungeon', id: dungeonId, field: 'name' });
}

function difficultyName(difficulty: JournalDifficulty): string {
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

function mechanicBadges(mechanic: JournalMechanic): string {
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
  /** What the room offers (drives the party-frames button). */
  private context: JournalContext | null = null;
  /** The journal the window shows (the room's, or one opened from the finder). */
  private source: JournalSource | null = null;
  private selectedBoss: string | null = null;
  private difficulty: JournalDifficulty = 'normal';
  private expandedMechanicId: string | null = null;
  private openerFocus: HTMLElement | null = null;
  /** Opened from the room's button (closes when the room loses its guide). */
  private openedFromContext = true;
  /** The room and run the last sync read: an unchanged tick does nothing. */
  private seenDungeonId: string | null | undefined = undefined;
  private seenRun: JournalRunInput | null = null;

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

  private run(): JournalRunInput | null {
    return this.deps.dungeonRun?.() ?? null;
  }

  syncAvailability(dungeonId: string | null): HTMLButtonElement | null {
    // IWorld.dungeonRun is reference-stable until the run changes, so a tick in
    // the same room with the same run has nothing to repaint.
    const run = dungeonId ? this.run() : null;
    if (dungeonId === this.seenDungeonId && run === this.seenRun) {
      return this.context ? this.button : null;
    }
    this.seenDungeonId = dungeonId;
    const next = journalContextFor(dungeonId, run, dungeonJournalSourceFor);
    const browsingElsewhere = this.isOpen && !this.openedFromContext;
    if (!next) {
      if (this.isOpen && this.openedFromContext) this.close(this.deps.contextFallback());
      else if (this.button.ownerDocument.activeElement === this.button) {
        this.deps.restoreFocus(this.deps.contextFallback());
      }
      this.context = null;
      if (!browsingElsewhere) {
        this.source = null;
        this.selectedBoss = null;
        this.expandedMechanicId = null;
      }
      this.seenRun = run;
      return null;
    }

    const previous = this.context;
    const sourceChanged = next.source.id !== previous?.source.id;
    const contextChanged = sourceChanged || next.bossKey !== previous?.bossKey;
    this.context = next;
    let selectionChanged = false;
    if (!browsingElsewhere) {
      if (sourceChanged) {
        this.source = next.source;
        if (!this.isOpen && next.runDifficulty) this.difficulty = next.runDifficulty;
      }
      // A dungeon's suggestion advances as bosses fall; an open page keeps the
      // boss the player is reading. The raid follows its room as it always has.
      const follow = sourceChanged || next.source.kind === 'raid' || !this.isOpen;
      if (!this.selectedBoss || (contextChanged && follow && this.selectedBoss !== next.bossKey)) {
        this.selectedBoss = next.bossKey;
        this.expandedMechanicId = null;
        selectionChanged = true;
      }
    }
    if (contextChanged) this.paintButton();
    const runChanged = run !== this.seenRun;
    this.seenRun = run;
    if (this.isOpen && (selectionChanged || (runChanged && this.source?.kind === 'dungeon'))) {
      this.render();
    }
    return this.button;
  }

  toggle(): void {
    if (!this.context) return;
    if (this.isOpen) {
      this.close();
      return;
    }
    this.openedFromContext = true;
    if (this.source?.id !== this.context.source.id) {
      this.source = this.context.source;
      this.selectedBoss = null;
    }
    this.selectedBoss ??= this.context.bossKey;
    this.show();
  }

  /** Open a dungeon's guide on one boss from outside the room (the Dungeon
   *  Finder). False when the dungeon ships no guide. */
  openJournal(dungeonId: string, bossMobId?: string, difficulty?: JournalDifficulty): boolean {
    const source = dungeonJournalSourceFor(dungeonId);
    if (!source) return false;
    if (this.isOpen) this.close();
    this.openedFromContext = false;
    this.source = source;
    this.selectedBoss =
      bossMobId && source.bossKeys.includes(bossMobId) ? bossMobId : source.bossKeys[0];
    if (difficulty) this.difficulty = difficulty;
    this.expandedMechanicId = null;
    this.show();
    return true;
  }

  /** Whether a dungeon ships a guide page for this mob (the finder's button). */
  static hasJournal(dungeonId: string, mobId: string): boolean {
    return dungeonJournalSourceFor(dungeonId)?.bossKeys.includes(mobId) ?? false;
  }

  private show(): void {
    this.deps.closeOthers();
    // A page opened from the Dungeon Finder has no opener left to return to
    // (closing the other windows hid the finder): it returns to the stable
    // launcher instead.
    this.openerFocus = this.openedFromContext
      ? this.deps.captureFocus()
      : this.deps.contextFallback();
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
    if (!this.openedFromContext) {
      // The finder's page closes back to the room's own journal, if any.
      this.openedFromContext = true;
      this.source = this.context?.source ?? null;
      this.selectedBoss = this.context?.bossKey ?? null;
      if (this.context?.runDifficulty) this.difficulty = this.context.runDifficulty;
    }
  }

  relocalize(): void {
    if (this.context) this.paintButton();
    if (this.isOpen) this.render();
  }

  resetGraphicsPreviewContext(): void {
    this.modelController.destroy();
  }

  restoreGraphicsPreviewContext(): void {
    if (this.isOpen) this.render();
  }

  render(focusKey?: string): void {
    const source = this.source;
    if (!this.selectedBoss || !source) return;
    const dungeon = source.kind === 'dungeon';
    const root = this.deps.root();
    const restoreKey = focusKey ?? captureFocusKey(root) ?? undefined;
    const view = source.view(this.selectedBoss, this.difficulty);
    const selectedBossName = mobName(view.mobId);
    const selectedDifficultyName = difficultyName(this.difficulty);
    const subtitle = dungeon
      ? t('hudChrome.raidBossGuide.dungeonSubtitle', {
          dungeon: dungeonName(source.id),
          boss: selectedBossName,
          difficulty: selectedDifficultyName,
        })
      : t('hudChrome.raidBossGuide.subtitle', {
          boss: selectedBossName,
          difficulty: selectedDifficultyName,
        });

    root.innerHTML =
      `<div class="rbg-head panel-title">` +
      `<div><div id="raid-boss-guide-title">${esc(t('hudChrome.raidBossGuide.title'))}</div>` +
      `<div class="rbg-subtitle">${esc(subtitle)}</div></div>` +
      `<button type="button" class="x-btn" data-close data-focus-key="close" aria-label="${esc(
        t('hudChrome.raidBossGuide.close'),
      )}">${svgIcon('close')}</button></div>` +
      `<div class="rbg-shell">${this.bossNavigation(source)}<section class="rbg-journal" tabindex="0" data-focus-key="journal" aria-label="${esc(
        t('hudChrome.raidBossGuide.title'),
      )}">` +
      `${this.heroHtml(selectedBossName, view, dungeon)}` +
      `${this.difficultyHtml()}` +
      (dungeon
        ? `${heroicNotesHtml(view.heroicNotes)}${tipsHtml(view.tips)}${choicesHtml(view.choices)}`
        : '') +
      `<div class="rbg-section-title">${esc(tx('hudChrome.raidBossGuide.abilitiesHeading'))}</div>` +
      `<div class="rbg-phases">${view.phases.map((phase) => this.phaseHtml(phase, dungeon)).join('')}</div>` +
      `</section></div>`;

    const modelSlot = root.querySelector<HTMLElement>('[data-model-slot]');
    if (modelSlot) {
      const model = dungeon ? journalModelFor(view.mobId) : undefined;
      this.modelController.mount(modelSlot, {
        boss: view.key,
        ...(dungeon ? { spec: model?.spec ?? null, tint: model?.tint ?? null } : {}),
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
        const boss = bossButton.dataset.boss;
        if (!boss || boss === this.selectedBoss) return;
        this.deps.hideTooltip();
        this.selectedBoss = boss;
        this.expandedMechanicId = null;
        this.render(`boss:${boss}`);
      });
    }
    for (const difficultyButton of root.querySelectorAll<HTMLButtonElement>('[data-difficulty]')) {
      difficultyButton.addEventListener('click', () => {
        const difficulty = difficultyButton.dataset.difficulty as JournalDifficulty | undefined;
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
        this.deps.attachTooltip(control, () => this.mechanicTooltip(phase, mechanic, dungeon));
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

  private bossNavigation(source: JournalSource): string {
    const dungeon = source.kind === 'dungeon';
    const run = dungeon && this.seenRun?.dungeonId === source.id ? this.seenRun : null;
    const label = dungeon
      ? tx('hudChrome.raidBossGuide.dungeonBossesLabel')
      : tx('hudChrome.raidBossGuide.bossesLabel');
    return `<nav class="rbg-boss-nav${dungeon ? ' rbg-boss-nav-dungeon' : ''}" aria-label="${esc(label)}">${source.bossKeys
      .map((boss) => {
        const view = source.view(boss, this.difficulty);
        const name = mobName(view.mobId);
        const selected = boss === this.selectedBoss;
        const defeated = journalBossDefeated(run, view.mobId);
        const ariaKey = defeated
          ? 'hudChrome.raidBossGuide.browseBossDefeated'
          : 'hudChrome.raidBossGuide.browseBoss';
        const rank = dungeon ? rankLabel(view.rank) : null;
        const meta =
          dungeon && (rank || defeated)
            ? `<small class="rbg-boss-meta">${rank ? `<span>${esc(rank)}</span>` : ''}${
                defeated
                  ? `<span class="rbg-defeated">${svgIcon('check')}${esc(tx('hudChrome.raidBossGuide.defeated'))}</span>`
                  : ''
              }</small>`
            : '';
        const text = dungeon
          ? `<span class="rbg-boss-text"><span>${esc(name)}</span>${meta}</span>`
          : `<span>${esc(name)}</span>`;
        return `<button type="button" class="rbg-boss-tab${selected ? ' active' : ''}${defeated ? ' defeated' : ''}" data-boss="${esc(boss)}" data-focus-key="boss:${esc(boss)}" aria-pressed="${selected}" aria-label="${esc(
          tx(ariaKey, { boss: name }),
        )}"><img src="${esc(view.portraitUrl)}" alt="" aria-hidden="true">${text}</button>`;
      })
      .join('')}</nav>`;
  }

  private heroHtml(selectedBossName: string, view: JournalBossView, dungeon: boolean): string {
    const overview = dungeon
      ? tx(
          view.overviewKey,
          formattedJournalValues(view.overviewValues, view.overviewPercentValues),
        )
      : tx(view.overviewKey);
    return `<div class="rbg-hero"><div class="rbg-model-slot" data-model-slot></div><div class="rbg-overview"><h2>${esc(selectedBossName)}</h2>${
      dungeon ? rankChipHtml(view.rank) : ''
    }<div class="rbg-section-kicker">${esc(
      tx('hudChrome.raidBossGuide.overviewHeading'),
    )}</div><p>${esc(overview)}</p></div></div>`;
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

  private values(
    dungeon: boolean,
    values: Readonly<Record<string, number>> | undefined,
    percentValues?: readonly string[],
  ): InterpolationValues | undefined {
    return dungeon
      ? formattedJournalValues(values, percentValues)
      : formattedValues(values, percentValues);
  }

  private phaseHtml(phase: JournalPhase, dungeon: boolean): string {
    const values = this.values(dungeon, phase.values, phase.percentValues);
    return `<section class="rbg-phase" data-phase="${esc(phase.id)}"><header><div class="rbg-phase-rule"></div><div><h3>${esc(
      tx(phase.nameKey),
    )}</h3><p>${esc(tx(phase.summaryKey, values))}</p></div></header><div class="rbg-abilities">${phase.mechanics
      .map((mechanic) => this.mechanicHtml(mechanic, dungeon))
      .join('')}</div></section>`;
  }

  private mechanicHtml(mechanic: JournalMechanic, dungeon: boolean): string {
    const expanded = mechanic.id === this.expandedMechanicId;
    const values = this.values(dungeon, mechanic.values, mechanic.percentValues);
    const name = tx(mechanic.nameKey, values);
    const detailId = `rbg-detail-${mechanic.id}`;
    // A dungeon toggle shows the summary inline; its aria-label replaces the
    // button's text as the name, so the summary is wired as its description.
    const summaryId = `rbg-summary-${mechanic.id}`;
    const actionKey = expanded
      ? 'hudChrome.raidBossGuide.collapseAbility'
      : 'hudChrome.raidBossGuide.expandAbility';
    const semanticLabels = [
      ...mechanic.roles.map((role) => tx(ROLE_PRESENTATION[role][0])),
      ...mechanic.flags.map((flag) => tx(FLAG_PRESENTATION[flag][0])),
      ...(dungeon ? markLabels(mechanic.marks) : []),
    ];
    const accessibleLabel = tx('hudChrome.raidBossGuide.abilityControlLabel', {
      action: tx(actionKey, { ability: name }),
      details: formatList(semanticLabels),
    });
    const summary = tx(mechanic.summaryKey, values);
    const response = tx('hudChrome.raidBossGuide.whatToDoResponse', {
      response: tx(mechanic.responseKey, values),
    });
    const main = dungeon
      ? `<span class="rbg-ability-main"><span class="rbg-expand-mark" aria-hidden="true">${expanded ? '−' : '+'}</span><span class="rbg-ability-text"><span class="rbg-ability-name">${esc(
          name,
        )}</span>${markChipsHtml(mechanic.marks)}<span class="rbg-ability-summary" id="${esc(summaryId)}">${esc(summary)}</span></span></span>`
      : `<span class="rbg-ability-main"><span class="rbg-expand-mark" aria-hidden="true">${expanded ? '−' : '+'}</span><span class="rbg-ability-name">${esc(
          name,
        )}</span></span>`;
    const detail = dungeon
      ? `<p>${esc(response)}</p>${
          mechanic.compare
            ? `<p class="rbg-compare">${esc(damageCompareText(mechanic.compare))}</p>`
            : ''
        }`
      : `<p>${esc(summary)}</p><p>${esc(response)}</p>`;
    return `<article class="rbg-ability${expanded ? ' expanded' : ''}"><button type="button" class="rbg-ability-toggle" data-mechanic="${esc(
      mechanic.id,
    )}" data-focus-key="mechanic:${esc(mechanic.id)}" aria-expanded="${expanded}"${
      expanded ? ` aria-controls="${esc(detailId)}"` : ''
    }${dungeon ? ` aria-describedby="${esc(summaryId)}"` : ''} aria-label="${esc(accessibleLabel)}"><img src="${esc(
      iconDataUrl('ability', mechanic.iconId, 48),
    )}" alt="" aria-hidden="true">${main}${mechanicBadges(mechanic)}</button>${
      expanded
        ? `<div class="rbg-ability-detail" id="${esc(detailId)}" data-detail="${esc(
            mechanic.id,
          )}">${detail}</div>`
        : ''
    }</article>`;
  }

  private mechanicTooltip(
    phase: JournalPhase,
    mechanic: JournalMechanic,
    dungeon: boolean,
  ): string {
    const values = this.values(dungeon, mechanic.values, mechanic.percentValues);
    const name = tx(mechanic.nameKey, values);
    const meta = tx('hudChrome.raidBossGuide.tooltipMeta', {
      phase: tx(phase.nameKey),
      difficulty: difficultyName(this.difficulty),
    });
    const response = tx('hudChrome.raidBossGuide.whatToDoResponse', {
      response: tx(mechanic.responseKey, values),
    });
    const compare =
      dungeon && mechanic.compare
        ? `<div class="tt-desc">${esc(damageCompareText(mechanic.compare))}</div>`
        : '';
    return `<div class="tt-title">${esc(name)}</div><div class="tt-sub">${esc(
      meta,
    )}</div><div class="tt-desc">${esc(
      tx(mechanic.summaryKey, values),
    )}</div><div class="tt-desc">${esc(response)}</div>${compare}`;
  }

  private paintButton(): void {
    const context = this.context;
    if (!context) return;
    const text =
      context.source.kind === 'dungeon'
        ? t('hudChrome.raidBossGuide.dungeonButton', { dungeon: dungeonName(context.source.id) })
        : t('hudChrome.raidBossGuide.button', {
            boss: mobName(context.source.view(context.bossKey, 'normal').mobId),
          });
    this.buttonLabel.textContent = text;
    this.button.title = text;
    this.button.setAttribute('aria-label', text);
  }
}
