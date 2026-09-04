import type { IWorld } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import type { FocusTrapHandle } from './focus_manager';
import { captureFocusKey, findFocusKey, focusKeyAttr, restoreFirstEnabled } from './focus_restore';
import { formatNumber, t } from './i18n';
import type { QuestEventPresentation } from './quest_event_view';
import { svgIcon } from './ui_icons';
import { buildWorldQuestMatch3View, type WorldQuestMatch3View } from './world_quest_match3_view';
import { buildWorldQuestPuzzleView } from './world_quest_puzzle_view';

export interface WorldQuestPuzzleWindowDeps {
  document: Document;
  world(): Pick<
    IWorld,
    | 'worldQuestLog'
    | 'rotateWorldQuestPuzzleTile'
    | 'swapWorldQuestMatch3Tiles'
    | 'resetWorldQuestMatch3'
  >;
  closeOthers(selector: string): void;
  openFocusTrap(root: () => HTMLElement | null): FocusTrapHandle;
  click(): void;
}

export class WorldQuestPuzzleWindow {
  private readonly root: HTMLElement;
  private readonly match3Announcer: HTMLElement;
  private questId: string | null = null;
  private lastSignature = '';
  private focusTrap: FocusTrapHandle | null = null;
  private selectedMatch3Cell: number | null = null;

  constructor(private readonly deps: WorldQuestPuzzleWindowDeps) {
    this.root = deps.document.createElement('div');
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
      if (this.questId && Number.isSafeInteger(tileIndex)) {
        this.deps.click();
        this.deps.world().rotateWorldQuestPuzzleTile(this.questId, tileIndex);
        return;
      }
      if (target.closest('[data-match3-reset]') && this.questId) {
        this.deps.click();
        this.selectedMatch3Cell = null;
        this.deps.world().resetWorldQuestMatch3(this.questId);
        return;
      }
      const cell = target.closest<HTMLElement>('[data-match3-cell]');
      const cellIndex = Number(cell?.dataset.match3Cell);
      if (!this.questId || !Number.isSafeInteger(cellIndex)) return;
      this.deps.click();
      if (this.selectedMatch3Cell === null || this.selectedMatch3Cell === cellIndex) {
        this.selectedMatch3Cell = this.selectedMatch3Cell === cellIndex ? null : cellIndex;
        this.render();
        return;
      }
      const fromIndex = this.selectedMatch3Cell;
      this.selectedMatch3Cell = null;
      this.deps.world().swapWorldQuestMatch3Tiles(this.questId, fromIndex, cellIndex);
      this.render();
    });
  }

  open(questId: string): void {
    this.deps.closeOthers('#world-quest-puzzle-window');
    this.questId = questId;
    this.selectedMatch3Cell = null;
    this.lastSignature = '';
    this.render();
    this.root.style.display = 'flex';
    this.root.dataset.windowOpen = '1';
    this.focusTrap?.release(false);
    this.focusTrap = this.deps.openFocusTrap(() => this.root);
    this.focusTrap.focusFirst(
      '[data-puzzle-tile]:not(:disabled), [data-match3-cell]:not(:disabled), [data-match3-reset]',
    );
  }

  close(): void {
    if (this.root.style.display === 'none') return;
    this.root.style.display = 'none';
    this.match3Announcer.textContent = '';
    delete this.root.dataset.windowOpen;
    this.focusTrap?.release();
    this.focusTrap = null;
  }

  closeIfQuest(questId: string): void {
    if (this.questId === questId) this.close();
  }

  applyEventPresentation(presentation: QuestEventPresentation): void {
    if (presentation.openWorldQuestPuzzle) this.open(presentation.openWorldQuestPuzzle);
    if (presentation.closeWorldQuestPuzzle) this.closeIfQuest(presentation.closeWorldQuestPuzzle);
  }

  refreshIfChanged(): void {
    if (this.root.style.display === 'none' || !this.questId) return;
    const progress = this.deps.world().worldQuestLog.get(this.questId);
    const signature = JSON.stringify(progress ?? null);
    if (signature === this.lastSignature) return;
    this.render();
  }

  relocalize(): void {
    if (this.root.style.display === 'none') return;
    this.lastSignature = '';
    this.render();
  }

  private render(): void {
    if (!this.questId) return;
    const focusedTile = captureFocusKey(this.root);
    const progress = this.deps.world().worldQuestLog.get(this.questId);
    const view = buildWorldQuestPuzzleView(this.questId, progress);
    const match3 = buildWorldQuestMatch3View(this.questId, progress);
    if (match3) {
      this.renderMatch3(match3, progress);
      return;
    }
    this.match3Announcer.textContent = '';
    if (!view) {
      this.lastSignature = JSON.stringify(progress ?? null);
      markDialogRoot(this.root, { labelledBy: 'world-quest-puzzle-title' });
      this.root.innerHTML =
        `<div class="panel-title"><span id="world-quest-puzzle-title">${esc(t('questUi.worldQuest.puzzleTitle'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.worldQuest.puzzleClose'))}">${svgIcon('close')}</button></div>` +
        `<p class="wqp-instructions">${esc(t('questUi.worldQuest.puzzleInstructions'))}</p>`;
      return;
    }
    this.lastSignature = JSON.stringify(progress ?? null);
    markDialogRoot(this.root, { labelledBy: 'world-quest-puzzle-title' });
    let tiles = '';
    for (const tile of view.tiles) {
      const connectors = new Set<string>(tile.connectors);
      const arms = ['north', 'east', 'south', 'west']
        .filter((side) => connectors.has(side))
        .map((side) => `<span class="wqp-arm ${side}" aria-hidden="true"></span>`)
        .join('');
      const edge =
        (tile.sourceSide
          ? `<span class="wqp-edge source ${tile.sourceSide}" title="${esc(t('questUi.worldQuest.puzzleSource'))}" aria-hidden="true"></span>`
          : '') +
        (tile.targetSide
          ? `<span class="wqp-edge target ${tile.targetSide}" title="${esc(t('questUi.worldQuest.puzzleTarget'))}" aria-hidden="true"></span>`
          : '');
      tiles += `<button type="button" class="wqp-tile${tile.powered ? ' powered' : ''}" data-puzzle-tile="${tile.index}"${focusKeyAttr(`tile:${tile.index}`)} aria-label="${esc(tile.ariaLabel)}">${arms}<span class="wqp-node" aria-hidden="true"></span>${edge}</button>`;
    }
    this.root.innerHTML =
      `<div class="panel-title"><span id="world-quest-puzzle-title">${esc(t('questUi.worldQuest.puzzleTitle'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.worldQuest.puzzleClose'))}">${svgIcon('close')}</button></div>` +
      `<div class="wqp-level">${esc(t('questUi.worldQuest.puzzleLevel', { level: formatNumber(view.level, { maximumFractionDigits: 0 }) }))}</div>` +
      `<p class="wqp-instructions">${esc(t('questUi.worldQuest.puzzleInstructions'))}</p>` +
      `<div class="wqp-grid" style="--wqp-columns:${view.columns};--wqp-rows:${view.rows}">${tiles}</div>`;
    if (focusedTile) restoreFirstEnabled([findFocusKey(this.root, focusedTile)]);
  }

  private renderMatch3(view: WorldQuestMatch3View, progress: unknown): void {
    const focusedCell = captureFocusKey(this.root);
    this.lastSignature = JSON.stringify(progress ?? null);
    markDialogRoot(this.root, { labelledBy: 'world-quest-puzzle-title' });
    const cells = view.cells
      .map((cell) => {
        const selected = cell.index === this.selectedMatch3Cell;
        return `<button type="button" class="wqm-cell candy-${cell.candy}${selected ? ' selected' : ''}" data-match3-cell="${cell.index}"${focusKeyAttr(`match3:${cell.index}`)} aria-label="${esc(cell.ariaLabel)}" aria-pressed="${selected}"${view.exhausted ? ' disabled' : ''}><span aria-hidden="true">${cell.symbol}</span>${selected ? `<span class="visually-hidden">${esc(t('questUi.worldQuest.match3Selected'))}</span>` : ''}</button>`;
      })
      .join('');
    const movesStatus = t('questUi.worldQuest.match3Moves', {
      current: formatNumber(view.moves, { maximumFractionDigits: 0 }),
      total: formatNumber(view.maxMoves, { maximumFractionDigits: 0 }),
    });
    const clearedStatus = t('questUi.worldQuest.match3Cleared', {
      current: formatNumber(view.cleared, { maximumFractionDigits: 0 }),
      total: formatNumber(view.target, { maximumFractionDigits: 0 }),
    });
    this.root.innerHTML =
      `<div class="panel-title"><span id="world-quest-puzzle-title">${esc(t('questUi.worldQuest.match3Title'))}</span><button type="button" class="x-btn" data-close${focusKeyAttr('match3:close')} aria-label="${esc(t('questUi.worldQuest.match3Close'))}">${svgIcon('close')}</button></div>` +
      `<div class="wqp-level">${esc(t('questUi.worldQuest.puzzleLevel', { level: formatNumber(view.level, { maximumFractionDigits: 0 }) }))}</div>` +
      `<p class="wqp-instructions">${esc(t('questUi.worldQuest.match3Instructions'))}</p>` +
      `<div class="wqm-status"><span>${esc(movesStatus)}</span><span>${esc(clearedStatus)}</span></div>` +
      `<div class="wqm-grid" role="group" aria-label="${esc(t('questUi.worldQuest.match3Title'))}" style="--wqm-columns:${view.columns};--wqm-rows:${view.rows}">${cells}</div>` +
      `${view.exhausted ? `<p class="wqm-out" role="alert">${esc(t('questUi.worldQuest.match3OutOfMoves'))}</p>` : ''}` +
      `<button type="button" class="btn secondary wqm-reset" data-match3-reset${focusKeyAttr('match3:reset')}>${esc(t('questUi.worldQuest.match3Reset'))}</button>`;
    const announcement = t('questUi.worldQuest.match3Announcement', {
      moves: movesStatus,
      cleared: clearedStatus,
    });
    if (this.match3Announcer.textContent !== announcement) {
      this.match3Announcer.textContent = announcement;
    }
    if (focusedCell) {
      restoreFirstEnabled([
        findFocusKey(this.root, focusedCell),
        findFocusKey(this.root, 'match3:reset'),
        findFocusKey(this.root, 'match3:close'),
      ]);
    }
  }
}
