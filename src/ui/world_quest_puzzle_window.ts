import type { IWorld } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import type { FocusTrapHandle } from './focus_manager';
import { t } from './i18n';
import type { QuestEventPresentation } from './quest_event_view';
import { svgIcon } from './ui_icons';
import { resolveWorldQuestConfectionProgress } from './world_quest_confection_view';
import { WorldQuestConfectionWindow } from './world_quest_confection_window';
import {
  applyWorldQuestLeyRotation,
  resolveWorldQuestLeyState,
  setWorldQuestLeyOutcome,
  type WorldQuestLeyState,
} from './world_quest_ley_view';
import { WorldQuestLeyWindow } from './world_quest_ley_window';
import {
  buildWorldQuestMatch3View,
  type WorldQuestMatch3PresentationProgress,
} from './world_quest_match3_view';

export interface WorldQuestPuzzleWindowDeps {
  document: Document;
  world(): Pick<
    IWorld,
    | 'worldQuestLog'
    | 'worldQuestTime'
    | 'rotateWorldQuestPuzzleTile'
    | 'swapWorldQuestMatch3Tiles'
    | 'resetWorldQuestMatch3'
    | 'resetWorldQuestPuzzle'
  > &
    Partial<Pick<IWorld, 'worldQuestCycle'>>;
  closeOthers(selector: string): void;
  openFocusTrap(root: () => HTMLElement | null): FocusTrapHandle;
  click(): void;
}

export class WorldQuestPuzzleWindow {
  private readonly root: HTMLElement;
  private readonly match3Announcer: HTMLElement;
  private questId: string | null = null;

  get activeQuestId(): string | null {
    return this.root.style.display !== 'none' ? this.questId : null;
  }
  private lastSignature = '';
  private focusTrap: FocusTrapHandle | null = null;
  private selectedMatch3Cell: number | null = null;
  private readonly confection: WorldQuestConfectionWindow;
  private readonly ley: WorldQuestLeyWindow;
  private leyState: WorldQuestLeyState | null = null;
  private match3Progress: WorldQuestMatch3PresentationProgress | undefined;
  private match3Completed = false;
  private worldQuestCycle: string | undefined;

  constructor(private readonly deps: WorldQuestPuzzleWindowDeps) {
    this.root = deps.document.createElement('div');
    this.confection = new WorldQuestConfectionWindow(this.root, deps.document);
    this.ley = new WorldQuestLeyWindow(this.root, deps.document);
    this.root.id = 'world-quest-puzzle-window';
    this.root.className = 'window panel';
    this.root.style.display = 'none';
    const parent = deps.document.querySelector('#ui') ?? deps.document.body;
    parent.appendChild(this.root);
    this.match3Announcer = deps.document.createElement('p');
    this.match3Announcer.className = 'visually-hidden';
    this.match3Announcer.setAttribute('role', 'status');
    this.match3Announcer.setAttribute('aria-live', 'polite');
    this.match3Announcer.setAttribute('aria-atomic', 'true');
    parent.appendChild(this.match3Announcer);
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-close]')) {
        this.deps.click();
        this.close();
        return;
      }
      const tile = target.closest<HTMLElement>('[data-puzzle-tile]');
      const tileIndex = Number(tile?.dataset.puzzleTile);
      if (
        this.questId &&
        tile &&
        !tile.hasAttribute('disabled') &&
        Number.isSafeInteger(tileIndex)
      ) {
        this.deps.click();
        this.deps.world().rotateWorldQuestPuzzleTile(this.questId, tileIndex);
        return;
      }
      if (target.closest('[data-match3-reset]') && this.questId) {
        this.deps.click();
        this.selectedMatch3Cell = null;
        this.confection.cancelMove();
        this.deps.world().resetWorldQuestMatch3(this.questId);
        this.render();
        return;
      }
      if (target.closest('[data-ley-retry]') && this.questId) {
        this.deps.click();
        this.deps.world().resetWorldQuestPuzzle(this.questId);
        return;
      }
      const cell = target.closest<HTMLElement>('[data-match3-cell]');
      const cellIndex = Number(cell?.dataset.match3Cell);
      if (!this.questId || !Number.isSafeInteger(cellIndex) || cell?.hasAttribute('disabled'))
        return;
      this.deps.click();
      if (this.selectedMatch3Cell === null || this.selectedMatch3Cell === cellIndex) {
        this.selectedMatch3Cell = this.selectedMatch3Cell === cellIndex ? null : cellIndex;
        this.render();
        return;
      }
      const fromIndex = this.selectedMatch3Cell;
      this.selectedMatch3Cell = null;
      this.confection.beginMove(
        this.questId,
        this.deps.world().worldQuestLog.get(this.questId),
        fromIndex,
        cellIndex,
      );
      this.deps.world().swapWorldQuestMatch3Tiles(this.questId, fromIndex, cellIndex);
      this.render();
    });
  }

  open(questId: string): void {
    this.deps.closeOthers('#world-quest-puzzle-window');
    this.confection.leave();
    this.ley.leave();
    this.leyState = null;
    this.match3Progress = undefined;
    this.match3Completed = false;
    this.worldQuestCycle = this.deps.world().worldQuestCycle;
    this.questId = questId;
    this.selectedMatch3Cell = null;
    this.lastSignature = '';
    this.render();
    this.root.style.display = 'flex';
    this.root.dataset.windowOpen = '1';
    this.focusTrap?.release(false);
    this.focusTrap = this.deps.openFocusTrap(() => this.root);
    this.focusTrap.focusFirst(
      this.ley.showingResult
        ? '.wql-result'
        : '[data-puzzle-tile]:not(:disabled), [data-match3-cell]:not(:disabled), [data-match3-reset]',
    );
  }

  close(): void {
    if (this.root.style.display === 'none') return;
    this.root.style.display = 'none';
    this.confection.leave();
    this.ley.leave();
    this.leyState = null;
    this.match3Progress = undefined;
    this.match3Completed = false;
    this.match3Announcer.textContent = '';
    delete this.root.dataset.windowOpen;
    this.focusTrap?.release();
    this.focusTrap = null;
  }

  closeIfQuest(questId: string): void {
    this.syncCycle();
    if (this.questId === questId && !this.confection.showingVictory && !this.ley.showingResult)
      this.close();
  }

  applyEventPresentation(presentation: QuestEventPresentation): void {
    if (presentation.openWorldQuestPuzzle) this.open(presentation.openWorldQuestPuzzle);
    if (
      this.questId &&
      this.root.style.display !== 'none' &&
      (presentation.updateWorldQuestPuzzle?.questId === this.questId ||
        presentation.completeWorldQuestPuzzle === this.questId ||
        presentation.failWorldQuestPuzzle === this.questId)
    ) {
      if (this.worldQuestCycle !== this.deps.world().worldQuestCycle) {
        this.refreshIfChanged();
        return;
      }
      this.leyState = resolveWorldQuestLeyState(
        this.questId,
        this.deps.world().worldQuestLog.get(this.questId),
        this.deps.world().worldQuestTime ?? 0,
        this.leyState,
      );
      if (presentation.updateWorldQuestPuzzle)
        this.leyState = applyWorldQuestLeyRotation(
          this.leyState,
          presentation.updateWorldQuestPuzzle,
        );
      if (presentation.completeWorldQuestPuzzle === this.questId)
        this.leyState = setWorldQuestLeyOutcome(this.leyState, 'won');
      if (presentation.failWorldQuestPuzzle === this.questId)
        this.leyState = setWorldQuestLeyOutcome(this.leyState, 'lost');
      if (this.leyState) this.render();
    }
    if (
      presentation.completeWorldQuestPuzzle === this.questId &&
      this.root.style.display !== 'none' &&
      this.match3Progress
    ) {
      if (this.worldQuestCycle !== this.deps.world().worldQuestCycle) {
        this.refreshIfChanged();
        return;
      }
      this.match3Completed = true;
      this.selectedMatch3Cell = null;
      this.render();
    }
    if (presentation.closeWorldQuestPuzzle) this.closeIfQuest(presentation.closeWorldQuestPuzzle);
  }

  refreshIfChanged(): void {
    if (this.root.style.display === 'none' || !this.questId) return;
    if (this.syncCycle()) return;
    const progress = this.deps.world().worldQuestLog.get(this.questId);
    const signature = JSON.stringify(progress ?? null);
    if (signature === this.lastSignature) return;
    this.render();
  }

  private syncCycle(): boolean {
    const world = this.deps.world();
    if (
      (this.match3Progress || this.leyState) &&
      this.questId &&
      (this.worldQuestCycle !== world.worldQuestCycle || !world.worldQuestLog.has(this.questId))
    ) {
      this.close();
      this.worldQuestCycle = world.worldQuestCycle;
      return true;
    }
    if (this.worldQuestCycle !== world.worldQuestCycle) {
      this.worldQuestCycle = world.worldQuestCycle;
      this.match3Progress = undefined;
      this.match3Completed = false;
      this.selectedMatch3Cell = null;
      this.confection.leave();
      this.ley.leave();
      this.leyState = null;
      this.lastSignature = '';
    }
    return false;
  }

  relocalize(): void {
    if (this.root.style.display === 'none') return;
    this.lastSignature = '';
    this.render();
  }

  private render(): void {
    if (!this.questId) return;
    if (this.syncCycle()) return;
    const progress = this.deps.world().worldQuestLog.get(this.questId);
    this.leyState = resolveWorldQuestLeyState(
      this.questId,
      progress,
      this.deps.world().worldQuestTime ?? 0,
      this.leyState,
    );
    this.match3Progress = resolveWorldQuestConfectionProgress(
      this.questId,
      progress,
      this.match3Progress,
      this.match3Completed,
    );
    const match3 = buildWorldQuestMatch3View(this.questId, this.match3Progress);
    if (match3) {
      this.ley.leave();
      this.leyState = null;
      this.lastSignature = JSON.stringify(progress ?? null);
      markDialogRoot(this.root, { labelledBy: 'world-quest-puzzle-title' });
      const announcement = this.confection.render(match3, progress, this.selectedMatch3Cell);
      if (this.match3Announcer.textContent !== announcement)
        this.match3Announcer.textContent = announcement;
      return;
    }
    this.confection.leave();
    if (this.leyState) {
      this.lastSignature = JSON.stringify(progress ?? null);
      markDialogRoot(this.root, { labelledBy: 'world-quest-puzzle-title' });
      const announcement = this.ley.render(this.leyState);
      if (this.match3Announcer.textContent !== announcement)
        this.match3Announcer.textContent = announcement;
      return;
    }
    this.ley.leave();
    this.match3Announcer.textContent = '';
    this.lastSignature = JSON.stringify(progress ?? null);
    markDialogRoot(this.root, { labelledBy: 'world-quest-puzzle-title' });
    this.root.innerHTML =
      `<div class="panel-title"><span id="world-quest-puzzle-title">${esc(t('questUi.worldQuest.puzzleTitle'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.worldQuest.puzzleClose'))}">${svgIcon('close')}</button></div>` +
      `<p class="wqp-instructions">${esc(t('questUi.worldQuest.puzzleInstructions'))}</p>`;
  }
}
