import { apiUrl } from '../client_origin';
import type { WorldQuestProgress } from '../sim/types';
import { esc } from './esc';
import {
  captureFocusKey,
  FOCUS_KEY_ATTR,
  findFocusKey,
  focusKeyAttr,
  restoreFirstEnabled,
} from './focus_restore';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';
import { WorldQuestConfectionFxController } from './world_quest_confection_fx_controller';
import {
  prepareWorldQuestConfectionMove,
  type WorldQuestConfectionMove,
  worldQuestConfectionMoveState,
} from './world_quest_confection_view';
import type { WorldQuestMatch3View } from './world_quest_match3_view';

interface CandyCell {
  button: HTMLButtonElement;
  candy: HTMLElement;
  symbol: HTMLElement;
  selected: HTMLElement;
}

/** Stable controls paint the confirmed board; finite overlays add cosmetic feedback only. */
export class WorldQuestConfectionWindow {
  private active = false;
  private cells: CandyCell[] = [];
  private pending: WorldQuestConfectionMove | null = null;
  private fx: WorldQuestConfectionFxController | null = null;
  private outcome: WorldQuestMatch3View['outcome'] = 'playing';
  private art: HTMLImageElement | null = null;
  private artReady = false;
  private title!: HTMLElement;
  private closeButton!: HTMLButtonElement;
  private level!: HTMLElement;
  private instructions!: HTMLElement;
  private moves!: HTMLElement;
  private cleared!: HTMLElement;
  private meter!: HTMLElement;
  private grid!: HTMLElement;
  private result!: HTMLElement;
  private resultEmblem!: HTMLElement;
  private resultTitle!: HTMLElement;
  private resultDetail!: HTMLElement;
  private reset!: HTMLButtonElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly document: Document,
  ) {}

  get showingVictory(): boolean {
    return this.active && this.outcome === 'won';
  }

  beginMove(
    questId: string,
    progress: WorldQuestProgress | undefined,
    from: number,
    to: number,
  ): void {
    this.cancelMove();
    this.pending = prepareWorldQuestConfectionMove(questId, progress, from, to);
  }

  cancelMove(): void {
    this.pending = null;
    this.fx?.cancel();
  }

  leave(): void {
    this.cancelMove();
    this.fx?.dispose();
    this.fx = null;
    this.outcome = 'playing';
    delete this.root.dataset.outcome;
    this.active = false;
    this.cells = [];
    this.root.classList.remove('confection-cascade');
    delete this.root.dataset.candyArt;
  }

  render(
    view: WorldQuestMatch3View,
    progress: WorldQuestProgress | undefined,
    selected: number | null,
  ): string {
    const focused = captureFocusKey(this.root);
    if (!this.active || this.cells.length !== view.cells.length) this.build(view);
    this.title.textContent = t('questUi.worldQuest.match3Title');
    this.closeButton.setAttribute('aria-label', t('questUi.worldQuest.match3Close'));
    this.level.textContent = t('questUi.worldQuest.puzzleLevel', {
      level: formatNumber(view.level, { maximumFractionDigits: 0 }),
    });
    this.instructions.textContent = t('questUi.worldQuest.match3Instructions');
    this.grid.setAttribute('aria-label', t('questUi.worldQuest.match3Title'));
    this.grid.style.setProperty('--wqm-columns', String(view.columns));
    this.grid.style.setProperty('--wqm-rows', String(view.rows));
    const moves = t('questUi.worldQuest.match3Moves', {
      current: formatNumber(view.moves, { maximumFractionDigits: 0 }),
      total: formatNumber(view.maxMoves, { maximumFractionDigits: 0 }),
    });
    const cleared = t('questUi.worldQuest.match3Cleared', {
      current: formatNumber(view.cleared, { maximumFractionDigits: 0 }),
      total: formatNumber(view.target, { maximumFractionDigits: 0 }),
    });
    this.moves.hidden = !view.movesKnown;
    this.moves.textContent = view.movesKnown ? moves : '';
    this.cleared.textContent = cleared;
    this.meter.setAttribute('aria-label', cleared);
    this.meter.setAttribute('aria-valuemin', '0');
    this.meter.setAttribute('aria-valuemax', String(view.target));
    this.meter.setAttribute('aria-valuenow', String(Math.min(view.target, view.cleared)));
    this.meter.style.setProperty('--wqm-progress', String(Math.min(1, view.cleared / view.target)));
    const outcomeChanged = this.outcome !== view.outcome;
    this.root.dataset.outcome = view.outcome;
    const terminal = view.outcome !== 'playing';
    this.result.hidden = !terminal;
    const title = terminal
      ? t(
          view.outcome === 'won'
            ? 'questUi.worldQuest.match3VictoryTitle'
            : 'questUi.worldQuest.match3DefeatTitle',
        )
      : '';
    const detail = terminal
      ? t(
          view.outcome === 'won'
            ? 'questUi.worldQuest.match3VictoryDetail'
            : 'questUi.worldQuest.match3DefeatDetail',
        )
      : '';
    this.resultTitle.textContent = title;
    this.resultDetail.textContent = detail;
    if (outcomeChanged)
      this.resultEmblem.innerHTML = svgIcon(view.outcome === 'lost' ? 'enchant-rune' : 'crown');
    this.reset.textContent = t(
      view.outcome === 'won'
        ? 'questUi.dialog.continue'
        : view.outcome === 'lost'
          ? 'questUi.worldQuest.match3TryAgain'
          : 'questUi.worldQuest.match3Reset',
    );
    this.reset.toggleAttribute('data-close', view.outcome === 'won');
    for (const cell of view.cells) {
      const nodes = this.cells[cell.index];
      const isSelected = !terminal && selected === cell.index;
      nodes.button.className = `wqm-cell candy-${cell.candy}${isSelected ? ' selected' : ''}`;
      nodes.button.setAttribute('aria-label', cell.ariaLabel);
      nodes.button.setAttribute('aria-pressed', String(isSelected));
      nodes.button.disabled = terminal;
      nodes.candy.className = `wqm-candy candy-${cell.candy}`;
      nodes.symbol.textContent = cell.symbol;
      nodes.selected.textContent = isSelected ? t('questUi.worldQuest.match3Selected') : '';
    }
    if (terminal && outcomeChanged && this.root.style.display !== 'none')
      restoreFirstEnabled([this.result]);
    else if (!terminal && focused === 'match3:result')
      restoreFirstEnabled([this.cells[0]?.button, this.reset]);
    else if (focused)
      restoreFirstEnabled([findFocusKey(this.root, focused), this.reset, this.closeButton]);
    if (this.pending) {
      const pending = this.pending;
      const state = worldQuestConfectionMoveState(pending, progress);
      if (state !== 'waiting') {
        this.pending = null;
        if (state === 'confirmed' && !terminal) this.fx?.playMove(pending, view.columns);
      }
    }
    if (outcomeChanged) {
      if (view.outcome !== 'playing') this.fx?.playOutcome(view.outcome);
      else this.fx?.cancel();
    }
    this.outcome = view.outcome;
    if (terminal)
      return view.movesKnown
        ? t('questUi.worldQuest.match3ResultAnnouncement', { title, detail, moves, cleared })
        : t('questUi.worldQuest.match3ResultSummary', { title, detail, cleared });
    return t('questUi.worldQuest.match3Announcement', { moves, cleared });
  }

  private build(view: WorldQuestMatch3View): void {
    this.leave();
    this.active = true;
    this.root.classList.add('confection-cascade');
    this.root.style.setProperty('--wqm-columns', String(view.columns));
    this.root.innerHTML =
      `<div class="panel-title"><span id="world-quest-puzzle-title"></span><button type="button" class="x-btn" data-close${focusKeyAttr('match3:close')}>${svgIcon('close')}</button></div>` +
      '<div class="wqm-lid"><div class="wqp-level"></div><p class="wqp-instructions"></p>' +
      '<div class="wqm-status"><span class="wqm-moves"></span><span class="wqm-cleared"></span></div>' +
      '<div class="wqm-progress" role="progressbar"><span class="wqm-progress-fill" aria-hidden="true"></span></div></div>' +
      '<div class="wqm-frame"><span class="wqm-box-hinge" aria-hidden="true"></span><span class="wqm-frame-crest" aria-hidden="true"></span>' +
      `<div class="wqm-grid" role="group" style="--wqm-columns:${view.columns};--wqm-rows:${view.rows}"></div>` +
      '<span class="wqm-box-front" aria-hidden="true"></span>' +
      `<div class="wqm-result" role="group" tabindex="-1" aria-labelledby="wqm-result-title" aria-describedby="wqm-result-detail"${focusKeyAttr('match3:result')} hidden><span class="wqm-result-frame" aria-hidden="true"></span><span class="wqm-result-emblem" aria-hidden="true">${svgIcon('crown')}</span><h2 id="wqm-result-title" class="wqm-result-title"></h2><p id="wqm-result-detail" class="wqm-result-detail"></p></div></div>` +
      `<button type="button" class="btn secondary wqm-reset" data-match3-reset${focusKeyAttr('match3:reset')}></button>`;
    const get = <T extends HTMLElement = HTMLElement>(selector: string) =>
      this.root.querySelector<T>(selector)!;
    this.title = get('#world-quest-puzzle-title');
    this.closeButton = get<HTMLButtonElement>('[data-close]');
    this.level = get('.wqp-level');
    this.instructions = get('.wqp-instructions');
    this.moves = get('.wqm-moves');
    this.cleared = get('.wqm-cleared');
    this.meter = get('.wqm-progress');
    this.grid = get('.wqm-grid');
    this.result = get('.wqm-result');
    this.resultEmblem = get('.wqm-result-emblem');
    this.resultTitle = get('.wqm-result-title');
    this.resultDetail = get('.wqm-result-detail');
    this.reset = get<HTMLButtonElement>('[data-match3-reset]');
    for (const cell of view.cells) {
      const button = this.document.createElement('button');
      button.type = 'button';
      button.dataset.match3Cell = String(cell.index);
      button.innerHTML = `<span class="wqm-cell-inlay" aria-hidden="true"></span><span class="wqm-candy" aria-hidden="true"><span class="wqm-candy-symbol">${esc(cell.symbol)}</span></span><span class="visually-hidden"></span>`;
      button.setAttribute(FOCUS_KEY_ATTR, `match3:${cell.index}`);
      this.cells.push({
        button,
        candy: button.children[1] as HTMLElement,
        symbol: button.children[1].firstElementChild as HTMLElement,
        selected: button.children[2] as HTMLElement,
      });
      this.grid.appendChild(button);
    }
    this.fx = new WorldQuestConfectionFxController(this.root, this.document);
    this.fx.bind(
      get('.wqm-frame'),
      this.grid,
      this.cells.map((cell) => cell.button),
    );
    this.loadArt();
  }

  private loadArt(): void {
    for (const [property, path] of Object.entries({
      '--wqm-wood-texture': '/ui/minigames/confection-walnut.webp',
      '--wqm-frame-art': '/ui/minigames/confection-frame-v4.webp',
      '--wqm-clasp-art': '/ui/minigames/confection-lock-v7.webp',
      '--wqm-crest-art': '/ui/minigames/confection-jewels-v7.webp',
      '--wqm-hinge-art': '/ui/minigames/confection-hinge-v4.webp',
      '--wqm-victory-seal-art': '/ui/minigames/confection-victory-seal-v4.webp',
      '--wqm-defeat-seal-art': '/ui/minigames/confection-defeat-seal-v4.webp',
    })) {
      this.root.style.setProperty(property, `url(${JSON.stringify(apiUrl(path))})`);
    }
    const url = apiUrl('/ui/minigames/confection-candies.webp');
    this.root.style.setProperty('--wqm-candy-atlas', `url(${JSON.stringify(url)})`);
    if (this.artReady) this.root.dataset.candyArt = 'ready';
    if (this.art) return;
    this.art = this.document.createElement('img');
    this.art.decoding = 'async';
    this.art.onload = () => {
      this.artReady = true;
      if (this.active) this.root.dataset.candyArt = 'ready';
    };
    this.art.onerror = () => {
      this.artReady = false;
      delete this.root.dataset.candyArt;
    };
    this.art.src = url;
  }
}
