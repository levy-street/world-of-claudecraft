import { apiUrl } from '../client_origin';
import { WORLD_QUEST_LEY_BONUS_LEVELS } from '../sim/world_quest_daily_generation';
import { WORLD_QUEST_LEY_TIMER_SECONDS } from '../sim/world_quests';
import {
  captureFocusKey,
  FOCUS_KEY_ATTR,
  findFocusKey,
  focusKeyAttr,
  restoreFirstEnabled,
} from './focus_restore';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';
import { WorldQuestLeyFxController } from './world_quest_ley_fx_controller';
import type { WorldQuestLeyOutcome, WorldQuestLeyState } from './world_quest_ley_view';
import { buildWorldQuestPuzzleView } from './world_quest_puzzle_view';

const SIDES = ['north', 'east', 'south', 'west'] as const;
interface LeyCell {
  button: HTMLButtonElement;
  arms: HTMLElement[];
}

/** Stable controls render confirmed state. The defeat face is ready for a future game rule. */
export class WorldQuestLeyWindow {
  private active = false;
  private boardKey = '';
  private cells: LeyCell[] = [];
  private rotations: number[] = [];
  private outcome: WorldQuestLeyOutcome = 'playing';
  private fx: WorldQuestLeyFxController | null = null;
  private timerInterval: number | null = null;
  private timerDeadline = 0;
  private timerSourceDeadline: number | null | undefined;
  private timerUrgent = false;
  private title!: HTMLElement;
  private closeButton!: HTMLButtonElement;
  private level!: HTMLElement;
  private instructions!: HTMLElement;
  private source!: HTMLElement;
  private target!: HTMLElement;
  private reach!: HTMLElement;
  private timer!: HTMLElement;
  private grid!: HTMLElement;
  private result!: HTMLElement;
  private resultTitle!: HTMLElement;
  private resultDetail!: HTMLElement;
  private retryButton!: HTMLButtonElement;
  private returnButton!: HTMLButtonElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly document: Document,
  ) {}
  get showingResult(): boolean {
    return this.active && this.outcome !== 'playing';
  }

  leave(): void {
    if (!this.active) return;
    this.stopTimer();
    this.timerDeadline = 0;
    this.timerSourceDeadline = undefined;
    this.timerUrgent = false;
    this.fx?.dispose();
    this.fx = null;
    this.active = false;
    this.cells = [];
    this.rotations = [];
    this.boardKey = '';
    this.outcome = 'playing';
    this.root.classList.remove('ley-beam');
    delete this.root.dataset.leyOutcome;
  }

  render(state: WorldQuestLeyState): string {
    const focused = captureFocusKey(this.root);
    // Rebuild localized labels from the retained observations, including on terminal boards.
    const board = state.snapshot
      ? buildWorldQuestPuzzleView(state.questId, state.snapshot)
      : state.board;
    const key = `${state.questId}:${board?.level}:${board?.columns}:${board?.rows}`;
    const rebuild = !this.active || this.boardKey !== key;
    if (rebuild) {
      this.build(state);
      this.boardKey = key;
    }
    const terminal = state.outcome !== 'playing';
    const changedOutcome = state.outcome !== this.outcome;
    this.root.dataset.leyOutcome = state.outcome;
    this.root.style.setProperty('--wql-columns', String(board?.columns ?? 3));
    this.title.textContent = t('questUi.worldQuest.puzzleTitle');
    this.closeButton.setAttribute('aria-label', t('questUi.worldQuest.puzzleClose'));
    this.level.hidden = !board;
    this.level.textContent = board
      ? board.bonusLevel
        ? t('questUi.worldQuest.puzzleBonusLevel', {
            level: formatNumber(board.bonusLevel, { maximumFractionDigits: 0 }),
            total: formatNumber(WORLD_QUEST_LEY_BONUS_LEVELS, { maximumFractionDigits: 0 }),
          })
        : t('questUi.worldQuest.puzzleLevel', {
            level: formatNumber(board.level, { maximumFractionDigits: 0 }),
          })
      : '';
    this.instructions.textContent = t('questUi.worldQuest.puzzleInstructions');
    this.source.textContent = t('questUi.worldQuest.puzzleSource');
    this.target.textContent = t('questUi.worldQuest.puzzleTarget');
    this.target.classList.toggle('connected', !!board?.solved);
    const reach = board
      ? t('questUi.worldQuest.puzzleBeamReach', {
          count: formatNumber(board.path.length, { maximumFractionDigits: 0 }),
        })
      : '';
    this.reach.textContent = reach;
    this.grid.hidden = !board;
    this.grid.setAttribute('aria-label', t('questUi.worldQuest.puzzleTitle'));
    this.grid.style.setProperty('--wqp-columns', String(board?.columns ?? 3));
    this.grid.style.setProperty('--wqp-rows', String(board?.rows ?? 3));
    this.result.hidden = !terminal;
    // A win past the daily solve is a bonus purse; the detail then points at the
    // next charged board, or closes the offer once both are cleared.
    const bonusPaid = state.outcome === 'won' && (state.bonusPaid ?? 0) > 0;
    this.resultTitle.textContent = terminal
      ? t(
          state.outcome === 'won'
            ? bonusPaid
              ? 'questUi.worldQuest.puzzleBonusPaid'
              : 'questUi.worldQuest.puzzleVictoryTitle'
            : 'questUi.worldQuest.puzzleDefeatTitle',
        )
      : '';
    this.resultDetail.textContent = terminal
      ? state.outcome === 'won'
        ? state.bonusCharged
          ? t('questUi.worldQuest.puzzleBonusCharged', {
              level: formatNumber(state.bonusCharged, { maximumFractionDigits: 0 }),
              total: formatNumber(WORLD_QUEST_LEY_BONUS_LEVELS, { maximumFractionDigits: 0 }),
            })
          : bonusPaid
            ? t('questUi.worldQuest.puzzleBonusDone')
            : t('questUi.worldQuest.puzzleVictoryDetail')
        : t('questUi.worldQuest.puzzleDefeatDetail')
      : '';
    if (terminal) {
      this.stopTimer();
      if (this.timer) {
        this.timer.textContent = '';
        this.timer.removeAttribute('aria-label');
        this.timer.hidden = true;
        this.timer.classList.remove('urgent');
        this.timerUrgent = false;
      }
      this.retryButton.hidden = state.outcome !== 'lost';
      this.retryButton.textContent = t('questUi.worldQuest.puzzleRetry');
    } else {
      this.retryButton.hidden = true;
      this.timer.hidden = false;
      this.startTimer(state);
    }
    this.returnButton.textContent = t(
      terminal ? 'questUi.dialog.continue' : 'questUi.worldQuest.puzzleReturn',
    );
    const turns: number[] = [];
    let boardChanged = false;
    for (const tile of board?.tiles ?? []) {
      const cell = this.cells[tile.index];
      if (!cell) continue;
      const turn =
        this.rotations[tile.index] === undefined
          ? 0
          : (tile.rotation - this.rotations[tile.index] + 4) % 4;
      turns.push(turn);
      boardChanged ||= turn !== 0;
      cell.button.classList.toggle('powered', tile.powered);
      cell.button.setAttribute('aria-label', tile.ariaLabel);
      cell.button.disabled = terminal;
      for (const [index, side] of SIDES.entries())
        cell.arms[index].hidden = !tile.connectors.includes(side);
    }
    this.rotations = board?.tiles.map((tile) => tile.rotation) ?? [];
    if (terminal && changedOutcome && this.root.style.display !== 'none')
      restoreFirstEnabled([this.result]);
    else if (focused) restoreFirstEnabled([findFocusKey(this.root, focused), this.returnButton]);
    if (changedOutcome) this.fx?.playOutcome(state.outcome);
    else if (!terminal && !rebuild && boardChanged && board)
      this.fx?.playCircuit(
        board.path,
        this.cells.map((cell) => cell.button),
        turns,
      );
    this.outcome = state.outcome;
    return terminal
      ? t('questUi.worldQuest.puzzleResultAnnouncement', {
          title: this.resultTitle.textContent,
          detail: this.resultDetail.textContent,
          reach,
        })
      : reach;
  }

  private build(state: WorldQuestLeyState): void {
    this.leave();
    this.active = true;
    this.root.classList.add('ley-beam');
    this.root.style.setProperty(
      '--wql-frame-art',
      `url("${apiUrl('/ui/minigames/ley-frame-v1.webp')}")`,
    );
    this.root.style.setProperty(
      '--wql-heart-art',
      `url("${apiUrl('/ui/minigames/ley-heart-v1.webp')}")`,
    );
    this.root.innerHTML =
      `<div class="panel-title"><span id="world-quest-puzzle-title"></span><button type="button" class="x-btn" data-close>${svgIcon('close')}</button></div>` +
      '<div class="wql-heading"><span class="wql-heading-sigil" aria-hidden="true"></span><div class="wqp-level"></div><p class="wqp-instructions"></p></div>' +
      '<div class="wql-status"><span class="wql-source-label"></span><span class="wql-reach"></span><span class="wql-timer" id="wql-timer"></span><span class="wql-target-label"></span></div>' +
      '<div class="wql-frame"><span class="wql-frame-art" aria-hidden="true"></span><div class="wqp-grid" role="group"></div>' +
      `<section class="wql-result" tabindex="-1" ${focusKeyAttr('ley:result')} aria-labelledby="wql-result-title" aria-describedby="wql-result-detail" hidden>` +
      '<span class="wql-result-frame" aria-hidden="true"></span><span class="wql-result-seal" aria-hidden="true"></span><h2 id="wql-result-title" class="wql-result-title"></h2><p id="wql-result-detail" class="wql-result-detail"></p>' +
      `<button type="button" class="btn wql-retry" data-ley-retry ${focusKeyAttr('ley:retry')} hidden></button></section>` +
      '<div class="wql-fx-layer" aria-hidden="true"></div></div>' +
      `<button type="button" class="wql-return" data-close ${focusKeyAttr('ley:return')}></button>`;
    const get = <T extends HTMLElement>(selector: string): T =>
      this.root.querySelector<T>(selector)!;
    this.title = get('#world-quest-puzzle-title');
    this.closeButton = get('.x-btn');
    this.level = get('.wqp-level');
    this.instructions = get('.wqp-instructions');
    this.source = get('.wql-source-label');
    this.target = get('.wql-target-label');
    this.reach = get('.wql-reach');
    this.timer = get('.wql-timer');
    this.grid = get('.wqp-grid');
    this.result = get('.wql-result');
    this.resultTitle = get('.wql-result-title');
    this.resultDetail = get('.wql-result-detail');
    this.retryButton = get('.wql-retry');
    this.returnButton = get('.wql-return');
    for (const tile of state.board?.tiles ?? []) {
      const button = this.document.createElement('button');
      button.type = 'button';
      button.className = 'wqp-tile';
      button.dataset.puzzleTile = String(tile.index);
      button.innerHTML = `<span class="wql-rotor" aria-hidden="true">${SIDES.map((side) => `<span class="wqp-arm ${side}"></span>`).join('')}<span class="wql-core"></span></span>`;
      button.setAttribute(FOCUS_KEY_ATTR, `tile:${tile.index}`);
      for (const [kind, side] of [
        ['source', tile.sourceSide],
        ['target', tile.targetSide],
      ] as const) {
        if (!side) continue;
        const edge = this.document.createElement('span');
        edge.className = `wqp-edge ${kind} ${side}`;
        edge.setAttribute('aria-hidden', 'true');
        button.appendChild(edge);
      }
      this.grid.appendChild(button);
      this.cells.push({ button, arms: [...button.querySelectorAll<HTMLElement>('.wqp-arm')] });
    }
    this.fx = new WorldQuestLeyFxController(this.root, get('.wql-fx-layer'), this.document);
  }

  private startTimer(state: WorldQuestLeyState): void {
    if (this.timerSourceDeadline === state.expiresAt) return;
    this.stopTimer();
    this.timerSourceDeadline = state.expiresAt;
    const remaining =
      state.expiresAt === null ? WORLD_QUEST_LEY_TIMER_SECONDS : state.secondsRemaining;
    this.timerDeadline = performance.now() + remaining * 1_000;
    this.paintTimer(Math.ceil(remaining));
    if (remaining <= 0) return;
    this.timerInterval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((this.timerDeadline - performance.now()) / 1000));
      this.paintTimer(remaining);
      if (remaining <= 0) {
        this.stopTimer();
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private paintTimer(seconds: number): void {
    if (!this.timer) return;
    this.timer.textContent = t('questUi.worldQuest.puzzleTimer', {
      seconds: formatNumber(seconds, { maximumFractionDigits: 0 }),
    });
    this.timer.setAttribute(
      'aria-label',
      t('questUi.worldQuest.puzzleTimerAria', {
        seconds: formatNumber(seconds, { maximumFractionDigits: 0 }),
      }),
    );
    const urgent = seconds <= 10;
    if (urgent !== this.timerUrgent) {
      this.timer.classList.toggle('urgent', urgent);
      this.timerUrgent = urgent;
    }
  }
}
