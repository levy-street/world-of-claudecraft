import { CLUE_HUNTS_BY_ID } from '../../../sim/content/clue_hunts';
import { WISP_MAZE_QUEST_ID } from '../../../sim/content/world_quest_wisp_maze';
import { QUESTS, WORLD_QUESTS_BY_ID } from '../../../sim/data';
import { questObjectiveRequired } from '../../../sim/types';
import { wispMazeActionsLocked } from '../../../sim/wisp_maze_action_lock';
import { positionInWorldQuestArea } from '../../../sim/world_quest_area';
import type { IWorld } from '../../../world_api';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { ownEntry } from '../../known_item';
import type { PainterHostWriters } from '../../painter_host';
import { clueHuntTitle, clueStepText } from '../../quest_event_view';
import { type QuestTrackingState, sharedQuestTracking } from '../../quest_tracking_core';
import { forgeInstructionLines } from '../../world_quest_forge_view';
import { gliderInstructionLines } from '../../world_quest_glider_view';
import { investigationInstructionLines } from '../../world_quest_investigation_view';
import { shadowInstructionLines } from '../../world_quest_shadow_view';
import { worldQuestTraceProgressInstruction } from '../../world_quest_trace_view';
import { worldQuestDisplayName, worldQuestObjectiveLabel } from '../../world_quest_view';
import { wispMazeInstructionLines } from '../../world_quest_wisp_maze_view';
import { buildQuestStrip, type QuestStripController } from './quest_strip_controller';
import {
  type QuestTrackerSection,
  type QuestTrackerSectionView,
  questTrackerSectionFor,
  questTrackerSectionOf,
  questTrackerSections,
  type TrackedQuest,
} from './quest_tracker';
import { buildWispMazeHud, type WispMazeHudController } from './wisp_maze_hud_controller';
import { createWorldQuestTrackerVisibility } from './world_quest_tracker_visibility';

export interface QuestTrackerSettingsPort {
  available(): boolean;
  /** The Quests section's persisted collapse. */
  collapsed(): boolean;
  setCollapsed(collapsed: boolean): void;
  /** The World Quests section's own persisted collapse. A host that leaves
   *  these out keeps that section expanded and its header inert. */
  worldQuestsCollapsed?(): boolean;
  setWorldQuestsCollapsed?(collapsed: boolean): void;
}

export interface QuestTrackerControllerDeps {
  /** Hud's shared write-elision facet, forwarded to the touch strip so its
   *  band-driven writes elide against the same cache as every other HUD write. */
  writers: PainterHostWriters;
  element: HTMLElement;
  document: Document;
  world(): Pick<IWorld, 'questLog' | 'cfg' | 'player' | 'worldQuestLog'> &
    Partial<Pick<IWorld, 'abandonQuest' | 'clueHunt'>>;
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
 *  rather than projecting the log a second time. Active world quests join the
 *  projection after the quest log and list under their own collapsible "World
 *  Quests" section on desktop (quest_tracker.ts groups them); a live movement
 *  lesson (tracing, forging, the wisp maze, a glider flight) holds its section
 *  open while it runs. */
export class QuestTrackerController {
  private readonly strip: QuestStripController | null;
  private readonly wispHud: WispMazeHudController | null;
  /** The last frame time Hud handed down. The collapse toggle re-renders off a
   *  user gesture rather than a frame, so it reuses it instead of minting a
   *  clock here; the strip's grace is measured in seconds and cannot see the
   *  one-tick staleness. */
  private lastNow = 0;
  /** Area and completion grace for the World Quests section (presentation only). */
  private readonly worldQuestVisibility = createWorldQuestTrackerVisibility();

  // The repaint memo compares against the LAST BUILT html, never the live
  // innerHTML: overlays decorate the painted rows in place (the island
  // coach's .qd-coach pulse adds a class and an animation-delay style), and
  // a live compare reads every such decoration as a content change, so the
  // tracker rewrote itself each update and the pulse strobed as it was
  // stripped and re-added in a fight.
  private lastHtml: string | null = null;
  /** A live movement lesson must remain readable. While it is present its
   *  section's header is a truthful disabled control and cannot mutate the
   *  saved choice. Null when no lesson holds a section open. */
  private lockedSection: QuestTrackerSection | null = null;
  /** The sections the last desktop paint drew; a header toggle for a section
   *  that is not on screen does nothing. */
  private paintedSections: ReadonlySet<QuestTrackerSection> = new Set();

  constructor(private readonly deps: QuestTrackerControllerDeps) {
    this.wispHud = buildWispMazeHud(deps.writers, () =>
      deps.world().abandonQuest?.(WISP_MAZE_QUEST_ID),
    );
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
    const world = this.deps.world();
    const worldQuestLog = world.worldQuestLog;
    this.wispHud?.update(
      worldQuestLog.get(WISP_MAZE_QUEST_ID),
      wispMazeActionsLocked(worldQuestLog),
      now,
    );
    let collapsed = this.deps.settings.collapsed();
    const quests: TrackedQuest[] = [];
    let focusQuestId: string | undefined;
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
    for (const progress of worldQuestLog.values()) {
      if (
        progress.state !== 'active' &&
        // A just-completed quest keeps its row for the completion grace; the
        // visibility core drops it (and never lists one completed earlier).
        progress.state !== 'completed' &&
        !(progress.traceResult && progress.tracing?.phase === 'success') &&
        !progress.forging &&
        !progress.wispMaze &&
        !progress.glider
      )
        continue;
      const quest = ownEntry(WORLD_QUESTS_BY_ID, progress.questId);
      if (!quest) continue;
      const lessonRunning =
        !!progress.tracing ||
        progress.forging?.phase === 'countdown' ||
        progress.forging?.phase === 'working' ||
        (!!progress.wispMaze && !progress.wispMaze.paused && progress.wispMaze.phase !== 'won') ||
        progress.glider?.phase === 'countdown' ||
        progress.glider?.phase === 'flying';
      const complete =
        progress.state === 'completed' &&
        !(progress.wispMaze && progress.wispMaze.phase !== 'won') &&
        progress.glider?.phase !== 'countdown' &&
        progress.glider?.phase !== 'flying';
      // WoW style: listed only while the player is in the quest's area, with
      // a grace on leaving and on completion. Display only: the progress on
      // the log entry is untouched, so 5/10 is still 5/10 on the way back.
      const inArea = positionInWorldQuestArea(world.player.pos, quest);
      if (
        !this.worldQuestVisibility.visible(
          progress.questId,
          { inArea, complete, lessonRunning },
          now,
        )
      )
        continue;
      if (lessonRunning) focusQuestId = progress.questId;
      quests.push({
        id: progress.questId,
        number: quests.length + 1,
        worldQuest: true,
        title: worldQuestDisplayName(progress.questId),
        complete,
        objectives:
          quest.objective.type === 'forging' ||
          quest.objective.type === 'wisp_maze' ||
          quest.objective.type === 'glider' ||
          quest.objective.type === 'shadow' ||
          quest.objective.type === 'investigation'
            ? (quest.objective.type === 'wisp_maze'
                ? wispMazeInstructionLines(progress)
                : quest.objective.type === 'forging'
                  ? forgeInstructionLines(progress)
                  : quest.objective.type === 'glider'
                    ? gliderInstructionLines(progress)
                    : quest.objective.type === 'shadow'
                      ? shadowInstructionLines(progress)
                      : investigationInstructionLines(progress)
              ).map((label) => ({
                label,
                current: 0,
                total: 1,
                instruction: true,
              }))
            : [
                {
                  label:
                    quest.objective.type === 'tracing'
                      ? worldQuestTraceProgressInstruction(progress, quest)
                      : worldQuestObjectiveLabel(progress.questId),
                  current: Math.min(progress.count, quest.count),
                  total: quest.count,
                  ...(quest.objective.type === 'tracing' ? { instruction: true } : {}),
                },
              ],
      });
    }
    this.worldQuestVisibility.retain(new Set(worldQuestLog.keys()));
    // The active Clue Scroll hunt rides the tracker as one row: the hunt's
    // title, and the current clue as a full-width instruction line with the
    // step tally. It persists across the daily reset, so it stays put while
    // the world quests around it come and go.
    const clueHunt = world.clueHunt;
    const hunt = clueHunt ? CLUE_HUNTS_BY_ID[clueHunt.huntId] : undefined;
    if (clueHunt && hunt) {
      quests.push({
        id: `clue:${clueHunt.huntId}`,
        // After every log position: the world quests above it list unnumbered
        // in their own section, so counting them would skip badge numbers.
        number: logPosition + 1,
        title: t('questUi.tracker.clueHuntTitle', {
          title: clueHuntTitle(clueHunt.huntId),
          step: formatNumber(clueHunt.step + 1, { maximumFractionDigits: 0 }),
          total: formatNumber(hunt.steps.length, { maximumFractionDigits: 0 }),
        }),
        complete: false,
        objectives: [
          {
            label: clueStepText(clueHunt.huntId, clueHunt.step),
            current: clueHunt.step,
            total: hunt.steps.length,
            instruction: true,
          },
        ],
      });
    }
    // A section with no rows paints no header, so a stale collapse there would
    // hide the next row to arrive behind a header the player never saw close:
    // clear it once, per section.
    const settings = this.deps.settings;
    const worldQuestRows = quests.filter((quest) => quest.worldQuest === true).length;
    if (collapsed && quests.length === worldQuestRows && settings.available()) {
      settings.setCollapsed(false);
      collapsed = false;
    }
    if (worldQuestRows === 0 && this.worldQuestsCollapsed() && settings.available())
      settings.setWorldQuestsCollapsed?.(false);
    // On touch the strip IS the tracker: the right-anchored markup is hidden in
    // hud.mobile.css, so rendering it would be a string build a phone never sees.
    if (this.strip?.active() === true) {
      this.strip.update(quests, now, focusQuestId);
      this.paintedSections = new Set();
      if (this.deps.element.innerHTML !== '') this.deps.element.innerHTML = '';
      return;
    }
    const focusQuest =
      focusQuestId === undefined ? undefined : quests.find((quest) => quest.id === focusQuestId);
    this.lockedSection = focusQuest ? questTrackerSectionFor(focusQuest) : null;
    const sections = questTrackerSections(quests, (section) =>
      section === this.lockedSection
        ? false
        : section === 'quests'
          ? collapsed
          : this.worldQuestsCollapsed(),
    );
    this.paintedSections = new Set(sections.map((view) => view.section));
    const html = this.renderHtml(sections);
    // First update adopts the live DOM as the baseline, so a host that
    // pre-seeded the element (or an empty tracker) still elides the write.
    if (this.lastHtml === null) this.lastHtml = this.deps.element.innerHTML;
    if (this.lastHtml !== html) {
      this.lastHtml = html;
      this.deps.element.innerHTML = html;
    }
  }

  /** Flip one section's persisted collapse (the Quests section by default: the
   *  header activation), preserving keyboard focus across the rebuild. */
  toggleCollapsed(section: QuestTrackerSection = 'quests'): void {
    if (
      section === this.lockedSection ||
      !this.paintedSections.has(section) ||
      !this.deps.settings.available()
    )
      return;
    const settings = this.deps.settings;
    if (section === 'worldQuests') {
      if (!settings.setWorldQuestsCollapsed) return;
      settings.setWorldQuestsCollapsed(!this.worldQuestsCollapsed());
    } else {
      settings.setCollapsed(!settings.collapsed());
    }
    const active = this.deps.document.activeElement as HTMLElement | null;
    const refocus = active?.classList.contains('qt-header') === true;
    this.deps.click();
    this.update(this.lastNow);
    const selector =
      section === 'worldQuests'
        ? '.qt-header[data-qt-section="worldQuests"]'
        : '.qt-header:not([data-qt-section])';
    if (refocus) this.deps.element.querySelector<HTMLElement>(selector)?.focus();
  }

  /** The shared header delegation's entry (tracker_header_wiring.ts): toggle
   *  the section whose header was activated. */
  toggleHeader(header: HTMLElement): void {
    this.toggleCollapsed(questTrackerSectionOf(header.dataset.qtSection));
  }

  private worldQuestsCollapsed(): boolean {
    return this.deps.settings.worldQuestsCollapsed?.() === true;
  }

  private renderHtml(sections: readonly QuestTrackerSectionView[]): string {
    let html = '';
    for (const view of sections) {
      html +=
        view.section === 'worldQuests'
          ? this.worldQuestSectionHtml(view)
          : this.questSectionHtml(view);
    }
    return html;
  }

  /** One section header: the collapse toggle with its label and count. */
  private headerHtml(
    view: QuestTrackerSectionView,
    label: string,
    listId: string,
    hints: { collapse: string; expand: string },
  ): string {
    // Locked by a live lesson, or a World Quests header on a host that cannot
    // persist its collapse: either way a truthful disabled control.
    const lockedHere =
      view.section === this.lockedSection ||
      (view.section === 'worldQuests' && !this.deps.settings.setWorldQuestsCollapsed);
    const chevron = view.collapsed ? '▸' : '▾';
    const count = ` <span class="qt-count ui-num">${esc(this.number(view.count))}</span>`;
    const hint = lockedHere
      ? ''
      : ` title="${esc(view.collapsed ? hints.expand : hints.collapse)}"`;
    const locked = lockedHere ? ' disabled aria-disabled="true"' : '';
    const worldQuests = view.section === 'worldQuests';
    const attrs = worldQuests ? ' qt-header-wq ui-cin" data-qt-section="worldQuests"' : ' ui-cin"';
    return (
      `<button type="button" class="qt-header${attrs} aria-expanded="${!view.collapsed}" aria-controls="${listId}"${hint}${locked}>` +
      `<span class="qt-chevron" aria-hidden="true">${chevron}</span>` +
      `<span class="qt-h-label">${esc(label)}</span>${count}</button>`
    );
  }

  private completeTag(complete: boolean): string {
    return complete
      ? ` <span class="quest-complete">(${esc(t('questUi.tracker.complete'))})</span>`
      : '';
  }

  /** The World Quests section, listed the classic way: the quest name, then
   *  "- Objective: 2/10" lines that update live. A world quest has no
   *  quest-log entry to jump to, so its row is plain text with no number. */
  private worldQuestSectionHtml(view: QuestTrackerSectionView): string {
    const header = this.headerHtml(view, t('hudChrome.questTracker.worldQuests'), 'qt-wq-list', {
      collapse: t('hudChrome.questTracker.worldQuestsCollapseHint'),
      expand: t('hudChrome.questTracker.worldQuestsExpandHint'),
    });
    let rows = '';
    for (const quest of view.quests) {
      rows += `<div class="qt-title qt-wq-title ui-cin">${esc(quest.title)}${this.completeTag(quest.complete)}</div>`;
      for (const objective of quest.objectives) {
        // A movement lesson instruction reads in full; a counted objective
        // carries its tally inline ("Bandits defeated: 2/10").
        const counted = !objective.instruction && objective.counted;
        const text = counted
          ? t('questUi.detail.objectiveProgress', {
              label: objective.label,
              current: this.number(objective.current),
              total: this.number(objective.total),
            })
          : objective.label;
        const state = objective.done
          ? ' done'
          : objective.instruction
            ? ''
            : counted
              ? ' counted'
              : ' muted';
        rows += `<div class="qt-obj ui-meta${state}"><span>- ${esc(text)}</span></div>`;
      }
    }
    return `${header}<div id="qt-wq-list">${rows}</div>`;
  }

  private questSectionHtml(view: QuestTrackerSectionView): string {
    const header = this.headerHtml(view, t('questUi.tracker.title'), 'qt-list', {
      collapse: t('hudChrome.questTracker.collapseHint'),
      expand: t('hudChrome.questTracker.expandHint'),
    });
    let rows = '';
    for (const quest of view.quests) {
      // World quests list in their own section; this guard keeps any world
      // quest id that reaches this list plain text (it has no log entry).
      const worldQuest = ownEntry(WORLD_QUESTS_BY_ID, quest.id);
      const behavior = !worldQuest
        ? ` role="button" tabindex="0" data-quest="${esc(quest.id)}"`
        : '';
      rows += `<div class="qt-title ui-cin"${behavior}><span class="qt-num ui-badge ui-num">${esc(this.number(quest.number))}</span>${esc(quest.title)}${this.completeTag(quest.complete)}</div>`;
      for (const objective of quest.objectives) {
        if (objective.instruction) {
          // A movement lesson instruction is shown in full, with no count.
          rows += `<div class="qt-obj ui-meta${objective.done ? ' done' : ''}"><span>- ${esc(objective.label)}</span></div>`;
          continue;
        }
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
