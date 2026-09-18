import { QUESTS } from '../../../sim/data';
import { questObjectiveRequired } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { ownEntry } from '../../known_item';
import type { PainterHostWriters } from '../../painter_host';
import { type QuestTrackingState, sharedQuestTracking } from '../../quest_tracking_core';
import { buildQuestStrip, type QuestStripController } from './quest_strip_controller';
import { type QuestTrackerView, questTrackerView, type TrackedQuest } from './quest_tracker';

export interface QuestTrackerSettingsPort {
  available(): boolean;
  collapsed(): boolean;
  setCollapsed(collapsed: boolean): void;
}

export interface QuestTrackerControllerDeps {
  /** Hud's shared write-elision facet, forwarded to the touch strip so its
   *  band-driven writes elide against the same cache as every other HUD write. */
  writers: PainterHostWriters;
  element: HTMLElement;
  document: Document;
  world(): Pick<IWorld, 'questLog' | 'cfg' | 'player'>;
  /** Injectable tracking set; production leaves it out and shares the HUD's one. */
  tracking?: QuestTrackingState;
  settings: QuestTrackerSettingsPort;
  questTitle(questId: string): string;
  objectiveLabel(questId: string, objectiveIndex: number): string;
  click(): void;
}

/** Owns quest tracker projection, collapse persistence, and elided DOM updates.
 *  The projection has TWO presentations: this right-anchored tracker on desktop,
 *  and the top-band strip on touch, which is handed the same TrackedQuest[]
 *  rather than projecting the log a second time. */
export class QuestTrackerController {
  private readonly strip: QuestStripController | null;
  /** The last frame time Hud handed down. The collapse toggle re-renders off a
   *  user gesture rather than a frame, so it reuses it instead of minting a
   *  clock here; the strip's grace is measured in seconds and cannot see the
   *  one-tick staleness. */
  private lastNow = 0;

  // The repaint memo compares against the LAST BUILT html, never the live
  // innerHTML: overlays decorate the painted rows in place (the island
  // coach's .qd-coach pulse adds a class and an animation-delay style), and
  // a live compare reads every such decoration as a content change, so the
  // tracker rewrote itself each update and the pulse strobed as it was
  // stripped and re-added in a fight.
  private lastHtml: string | null = null;

  constructor(private readonly deps: QuestTrackerControllerDeps) {
    this.strip = buildQuestStrip({ writers: deps.writers, click: () => this.deps.click() });
  }

  /** Language switch: the desktop rows already re-resolve unconditionally in
   *  renderHtml, but the strip is gated on a raw pre-resolve key that a locale
   *  switch alone cannot move, so it needs its own nudge. Bumping the strip's
   *  generation first, then rebuilding the tracked quests so their titles and
   *  objective labels re-resolve too, covers both halves in one call. */
  relocalize(): void {
    this.strip?.relocalize();
    this.update(this.lastNow);
  }

  update(now: number): void {
    this.lastNow = now;
    let collapsed = this.deps.settings.collapsed();
    const quests: TrackedQuest[] = [];
    const world = this.deps.world();
    const tracking = this.deps.tracking ?? sharedQuestTracking();
    tracking.useCharacter(world.cfg.playerClass, world.player.name);
    const untracked = tracking.untrackedIds();
    // The acceptance-order position in the WHOLE log, not this array's length: an
    // untracked quest keeps its number reserved, so every remaining row still
    // matches the world map's gold badge for the same quest.
    let logPosition = 0;
    for (const progress of world.questLog.values()) {
      logPosition++;
      if (untracked.has(progress.questId)) continue;
      // The log is SERVER truth: a quest id accepted on a current client can
      // reach a bundle that predates it (stale-client guard, R34), and the
      // tracker runs inside hud.update() every frame, so an unguarded deref
      // here killed the whole HUD tail. The unknown entry still PUSHES (raw
      // id as its title, no objectives): a player must be able to see, and
      // untrack, a row the client cannot name.
      const quest = ownEntry(QUESTS, progress.questId);
      quests.push({
        id: progress.questId,
        number: logPosition,
        // The unknown title SAYS unknown (a localizable sentence carrying the
        // raw id) instead of handing the player a bare content slug; the raw
        // id stays present so the row still matches a bug report.
        title: quest
          ? this.deps.questTitle(progress.questId)
          : t('questUi.tracker.unknownQuest', { id: progress.questId }),
        complete: progress.state === 'ready',
        objectives: quest
          ? quest.objectives.map((_objective, objectiveIndex) => ({
              label: this.deps.objectiveLabel(progress.questId, objectiveIndex),
              current: progress.counts[objectiveIndex],
              total: questObjectiveRequired(quest, progress, objectiveIndex),
            }))
          : [],
      });
    }
    if (collapsed && quests.length === 0 && this.deps.settings.available()) {
      this.deps.settings.setCollapsed(false);
      collapsed = false;
    }
    // On touch the strip IS the tracker: the right-anchored markup is hidden in
    // hud.mobile.css, so rendering it would be a string build a phone never sees.
    if (this.strip?.active() === true) {
      this.strip.update(quests, now);
      if (this.deps.element.innerHTML !== '') this.deps.element.innerHTML = '';
      return;
    }
    const html = this.renderHtml(questTrackerView(quests, collapsed));
    // First update adopts the live DOM as the baseline, so a host that
    // pre-seeded the element (or an empty tracker) still elides the write.
    if (this.lastHtml === null) this.lastHtml = this.deps.element.innerHTML;
    if (this.lastHtml !== html) {
      this.lastHtml = html;
      this.deps.element.innerHTML = html;
    }
  }

  toggleCollapsed(): void {
    if (!this.deps.settings.available()) return;
    const active = this.deps.document.activeElement as HTMLElement | null;
    const refocus = active?.classList.contains('qt-header') === true;
    this.deps.settings.setCollapsed(!this.deps.settings.collapsed());
    this.deps.click();
    this.update(this.lastNow);
    if (refocus) this.deps.element.querySelector<HTMLElement>('.qt-header')?.focus();
  }

  private renderHtml(view: QuestTrackerView): string {
    if (!view.visible) return '';
    const chevron = view.collapsed ? '▸' : '▾';
    const count = ` <span class="qt-count ui-num">${esc(this.number(view.count))}</span>`;
    const hint = esc(
      t(
        view.collapsed
          ? 'hudChrome.questTracker.expandHint'
          : 'hudChrome.questTracker.collapseHint',
      ),
    );
    const header =
      `<button type="button" class="qt-header ui-cin" aria-expanded="${!view.collapsed}" aria-controls="qt-list" title="${hint}">` +
      `<span class="qt-chevron" aria-hidden="true">${chevron}</span>` +
      `<span class="qt-h-label">${esc(t('questUi.tracker.title'))}</span>${count}</button>`;
    let rows = '';
    for (const quest of view.quests) {
      rows += `<div class="qt-title ui-cin" role="button" tabindex="0" data-quest="${esc(quest.id)}"><span class="qt-num ui-badge ui-num">${esc(this.number(quest.number))}</span>${esc(quest.title)}${quest.complete ? ` <span class="quest-complete">(${esc(t('questUi.tracker.complete'))})</span>` : ''}</div>`;
      for (const objective of quest.objectives) {
        const state = objective.done ? ' done' : objective.counted ? ' counted' : ' muted';
        const value =
          !objective.done && objective.counted
            ? `<span class="qt-obj-count ui-num">${esc(this.progressValue(objective.current, objective.total))}</span>`
            : '';
        rows += `<div class="qt-obj ui-meta${state}"><span>- ${esc(objective.label)}</span>${value}</div>`;
      }
    }
    return `${header}<div id="qt-list">${rows}</div>`;
  }

  private number(value: number): string {
    return formatNumber(value, { maximumFractionDigits: 0 });
  }

  private progressValue(current: number, total: number): string {
    return t('hudChrome.questTracker.objectiveValue', {
      current: this.number(current),
      total: this.number(total),
    });
  }
}
