import { QUESTS } from '../../../sim/data';
import { questObjectiveRequired } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { type QuestTrackerView, questTrackerView, type TrackedQuest } from './quest_tracker';

export interface QuestTrackerSettingsPort {
  available(): boolean;
  collapsed(): boolean;
  setCollapsed(collapsed: boolean): void;
}

export interface QuestTrackerControllerDeps {
  element: HTMLElement;
  document: Document;
  world(): Pick<IWorld, 'questLog'>;
  settings: QuestTrackerSettingsPort;
  questTitle(questId: string): string;
  objectiveLabel(questId: string, objectiveIndex: number): string;
  click(): void;
}

/** Owns quest tracker projection, collapse persistence, and elided DOM updates. */
export class QuestTrackerController {
  constructor(private readonly deps: QuestTrackerControllerDeps) {}

  update(): void {
    let collapsed = this.deps.settings.collapsed();
    const quests: TrackedQuest[] = [];
    for (const progress of this.deps.world().questLog.values()) {
      const quest = QUESTS[progress.questId];
      quests.push({
        id: progress.questId,
        number: quests.length + 1,
        title: this.deps.questTitle(progress.questId),
        complete: progress.state === 'ready',
        objectives: quest.objectives.map((_objective, objectiveIndex) => ({
          label: this.deps.objectiveLabel(progress.questId, objectiveIndex),
          current: progress.counts[objectiveIndex],
          total: questObjectiveRequired(quest, progress, objectiveIndex),
        })),
      });
    }
    if (collapsed && quests.length === 0 && this.deps.settings.available()) {
      this.deps.settings.setCollapsed(false);
      collapsed = false;
    }
    const html = this.renderHtml(questTrackerView(quests, collapsed));
    if (this.deps.element.innerHTML !== html) this.deps.element.innerHTML = html;
  }

  toggleCollapsed(): void {
    if (!this.deps.settings.available()) return;
    const active = this.deps.document.activeElement as HTMLElement | null;
    const refocus = active?.classList.contains('qt-header') === true;
    this.deps.settings.setCollapsed(!this.deps.settings.collapsed());
    this.deps.click();
    this.update();
    if (refocus) this.deps.element.querySelector<HTMLElement>('.qt-header')?.focus();
  }

  private renderHtml(view: QuestTrackerView): string {
    if (!view.visible) return '';
    const chevron = view.collapsed ? '▸' : '▾';
    const count = view.collapsed
      ? ` <span class="qt-count">${esc(t('hudChrome.questTracker.count', { count: this.number(view.count) }))}</span>`
      : '';
    const hint = esc(
      t(
        view.collapsed
          ? 'hudChrome.questTracker.expandHint'
          : 'hudChrome.questTracker.collapseHint',
      ),
    );
    const header =
      `<button type="button" class="qt-header" aria-expanded="${!view.collapsed}" aria-controls="qt-list" title="${hint}">` +
      `<span class="qt-chevron" aria-hidden="true">${chevron}</span>` +
      `<span class="qt-h-label">${esc(t('questUi.tracker.title'))}</span>${count}</button>`;
    let rows = '';
    for (const quest of view.quests) {
      rows += `<div class="qt-title" role="button" tabindex="0" data-quest="${esc(quest.id)}"><span class="qt-num">${esc(this.number(quest.number))}</span>${esc(quest.title)}${quest.complete ? ` <span class="quest-complete">(${esc(t('questUi.tracker.complete'))})</span>` : ''}</div>`;
      for (const objective of quest.objectives) {
        rows += `<div class="qt-obj${objective.done ? ' done' : ''}">- ${esc(this.progressText(objective.label, objective.current, objective.total))}</div>`;
      }
    }
    return `${header}<div id="qt-list">${rows}</div>`;
  }

  private number(value: number): string {
    return formatNumber(value, { maximumFractionDigits: 0 });
  }

  private progressText(label: string, current: number, total: number): string {
    return t('questUi.detail.objectiveProgress', {
      label,
      current: this.number(current),
      total: this.number(total),
    });
  }
}
