// Thin DOM painter for the World Quest rankings window
// (#world-quest-leaderboard-window).
//
// The consumer half of the pure-core + thin-painter split:
// world_quest_leaderboard_view.ts decides every card, podium slot, row, and the
// pinned "your best" bar; this module owns the window lifecycle (open, close,
// focus return), the selected board and page, the ASYNC read through
// IWorld.worldQuestLeaderboard, and the render epoch that drops a slow answer
// for a board or page the player has already left. It is cold: it paints on
// open, a card pick, and a page change, never from the per-frame path. It holds
// no Sim reference and reaches Hud only through its deps.
import { LEADERBOARD_PAGE_SIZE } from '../sim/leaderboard_page';
import type { IWorld, WorldQuestLeaderboardPage } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { type PodiumSlotHtml, podiumHtml } from './leaderboard_podium_html';
import { svgIcon } from './ui_icons';
import {
  buildWorldQuestLadderView,
  DEFAULT_WORLD_QUEST_BOARD,
  resolveWorldQuestBoard,
  type WorldQuestLadderRowView,
  type WorldQuestLadderSelfView,
  type WorldQuestLadderView,
  type WorldQuestPodiumSlotView,
} from './world_quest_leaderboard_view';

/** The window's element id in both HTML entries (index.html, play.html). */
export const WORLD_QUEST_RANKINGS_ROOT_ID = 'world-quest-leaderboard-window';

export interface WorldQuestLeaderboardWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onVisibilityChange?(): void;
}

/** Where focus lands after a repaint: the close button on open, the picked
 *  card after a board switch, the pager button just used after a page change. */
type FocusTarget = 'open' | 'card' | 'prev' | 'next' | null;

function artStyle(prop: '--wql-art' | '--wql-medal', url: string | null): string {
  return url ? ` style="${prop}:url('${esc(url)}')"` : '';
}

export class WorldQuestLeaderboardWindow {
  private board: string = DEFAULT_WORLD_QUEST_BOARD;
  private page = 0;
  // Render epoch: every await re-checks it, so a slow page for an older board
  // or page can neither repaint the window nor move the pager.
  private renderSeq = 0;
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: WorldQuestLeaderboardWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'flex';
  }

  /** Open (or re-point) the window, optionally on a given board. */
  open(boardId?: string): void {
    if (!this.isOpen) {
      // Capture the opener BEFORE closing siblings, so their own focus return
      // cannot clobber the element this window restores to.
      this.openerFocus = this.deps.captureFocus();
      this.deps.closeOthers();
      this.deps.root().style.display = 'flex';
      this.deps.onVisibilityChange?.();
    }
    if (boardId !== undefined) this.board = resolveWorldQuestBoard(boardId).id;
    this.page = 0;
    void this.render('open');
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'flex') {
      this.openerFocus = null;
      return;
    }
    this.renderSeq++;
    el.style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onVisibilityChange?.();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Paint the loading shell, await the page, then paint the resolved state. */
  async render(focus: FocusTarget = null): Promise<void> {
    const seq = ++this.renderSeq;
    const world = this.deps.world();
    const viewer = world.player.name;
    const board = resolveWorldQuestBoard(this.board).id;
    this.paint(buildWorldQuestLadderView(board, { kind: 'loading' }, viewer), focus);
    let result: WorldQuestLeaderboardPage | null = null;
    try {
      result = await world.worldQuestLeaderboard(board, this.page, LEADERBOARD_PAGE_SIZE, viewer);
    } catch {
      result = null;
    }
    if (seq !== this.renderSeq || !this.isOpen) return;
    // Mirror the server's clamped page so the pager never drifts past the end.
    if (result) this.page = result.page;
    const view = buildWorldQuestLadderView(
      board,
      result ? { kind: 'page', page: result } : { kind: 'error' },
      viewer,
    );
    this.paint(view, focus);
  }

  private paint(view: WorldQuestLadderView, focus: FocusTarget): void {
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'wql-title' });
    root.innerHTML =
      `<div class="panel-title wql-title"><span id="wql-title">${esc(view.title)}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(view.closeLabel)}">${svgIcon('close')}</button></div>` +
      `<div class="wql-sub">${esc(view.subtitle)}</div>` +
      this.cardsHtml(view) +
      this.boardHtml(view) +
      this.selfHtml(view.self);
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    root.querySelectorAll<HTMLButtonElement>('[data-wql-board]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = button.dataset.wqlBoard ?? '';
        if (next === this.board) return;
        this.board = next;
        this.page = 0;
        void this.render('card');
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-wql-page]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        const forward = button.dataset.wqlPage === 'next';
        this.page = Math.max(0, this.page + (forward ? 1 : -1));
        void this.render(forward ? 'next' : 'prev');
      });
    });
    this.applyFocus(root, focus);
  }

  private applyFocus(root: HTMLElement, focus: FocusTarget): void {
    const close = root.querySelector<HTMLElement>('[data-close]');
    if (focus === 'open') close?.focus();
    if (focus === 'card') root.querySelector<HTMLElement>('.wql-card-active')?.focus();
    if (focus === 'prev' || focus === 'next') {
      const wanted = root.querySelector<HTMLButtonElement>(`[data-wql-page="${focus}"]`);
      if (wanted && !wanted.disabled) wanted.focus();
      else close?.focus();
    }
  }

  private cardsHtml(view: WorldQuestLadderView): string {
    const cards = view.cards
      .map(
        (card) =>
          `<button type="button" class="wql-card${card.active ? ' wql-card-active' : ''}" data-wql-board="${esc(card.id)}" aria-pressed="${card.active ? 'true' : 'false'}">` +
          `<span class="wql-card-art"${artStyle('--wql-art', card.art)} aria-hidden="true"></span>` +
          `<span class="wql-card-name">${esc(card.label)}</span>` +
          `<span class="wql-card-metric">${esc(card.metricHeader)}</span></button>`,
      )
      .join('');
    return `<div class="wql-cards" role="group" aria-label="${esc(view.boardsLabel)}">${cards}</div>`;
  }

  private boardHtml(view: WorldQuestLadderView): string {
    const busy = view.state === 'loading' ? ' aria-busy="true"' : '';
    const total = view.totalText ? `<span class="wql-total">${esc(view.totalText)}</span>` : '';
    const head =
      `<div class="wql-board-head"><span class="wql-board-title" id="wql-board-title">${esc(view.boardTitle)}</span>` +
      `<span class="wql-board-rule">${esc(view.boardRule)}</span>${total}</div>`;
    return `<section class="wql-board window-fill" aria-labelledby="wql-board-title"${busy}>${head}${this.boardBodyHtml(view)}</section>`;
  }

  private boardBodyHtml(view: WorldQuestLadderView): string {
    if (view.state === 'loading')
      return `<div class="wql-state" role="status">${esc(view.message)}</div>`;
    if (view.state === 'error')
      return `<div class="wql-state wql-error" role="alert">${esc(view.message)}</div>`;
    if (view.state === 'empty') return `<div class="wql-state">${esc(view.message)}</div>`;
    const podium = podiumHtml(
      view.podium.map((slot) => this.slotHtml(slot, view.youLabel)),
      view.podiumLabel,
    );
    const list = view.rows.length
      ? `<div class="wql-list"><div class="wql-row wql-head"><span>${esc(view.columns.rank)}</span>` +
        `<span>${esc(view.columns.name)}</span><span>${esc(view.columns.medal)}</span>` +
        `<span class="wql-metric">${esc(view.columns.metric)}</span></div>` +
        view.rows.map((row) => this.rowHtml(row, view.youLabel)).join('') +
        `</div>`
      : '';
    const pager = view.pager
      ? `<div class="wql-pager">` +
        `<button type="button" class="wql-page-btn" data-wql-page="prev"${view.pager.prevDisabled ? ' disabled' : ''}>${esc(view.pager.prevLabel)}</button>` +
        `<span class="wql-page-status">${esc(view.pager.status)}</span>` +
        `<button type="button" class="wql-page-btn" data-wql-page="next"${view.pager.nextDisabled ? ' disabled' : ''}>${esc(view.pager.nextLabel)}</button>` +
        `</div>`
      : '';
    return podium + list + pager;
  }

  private slotHtml(slot: WorldQuestPodiumSlotView, youLabel: string): PodiumSlotHtml {
    const you = slot.me ? ` <span class="wql-you">(${esc(youLabel)})</span>` : '';
    return {
      place: slot.place,
      rankText: slot.rank,
      filled: slot.filled,
      me: slot.me,
      nameHtml: `${esc(slot.name)}${you}`,
      metricHtml: slot.filled ? esc(slot.metricText) : '',
      detailHtml: slot.filled ? this.medalCellHtml(slot.medal, slot.medalArt, slot.medalText) : '',
    };
  }

  private medalCellHtml(medal: string | null, art: string | null, text: string): string {
    const tone = medal ? ` wql-medal-${medal}` : '';
    return (
      `<span class="wql-medal${tone}"><span class="wql-medal-icon"${artStyle('--wql-medal', art)} aria-hidden="true"></span>` +
      `${esc(text)}</span>`
    );
  }

  private rowHtml(row: WorldQuestLadderRowView, youLabel: string): string {
    const you = row.me ? ` <span class="wql-you">(${esc(youLabel)})</span>` : '';
    return (
      `<div class="wql-row${row.me ? ' wql-mine' : ''}"><span class="wql-rank">${esc(row.rank)}</span>` +
      `<span class="wql-name">${esc(row.name)}${you}</span>` +
      this.medalCellHtml(row.medal, row.medalArt, row.medalText) +
      `<span class="wql-metric">${esc(row.metricText)}</span></div>`
    );
  }

  private selfHtml(self: WorldQuestLadderSelfView | null): string {
    if (!self) return '';
    if (self.kind === 'none') {
      return (
        `<div class="wql-self"><span class="wql-self-label">${esc(self.label)}</span>` +
        `<span class="wql-self-none">${esc(self.text)}</span></div>`
      );
    }
    return (
      `<div class="wql-self"><span class="wql-self-label">${esc(self.label)}</span>` +
      `<span class="wql-self-rank">${esc(self.rankText)}</span>` +
      `<span class="wql-self-name">${esc(self.name)}</span>` +
      this.medalCellHtml(self.medal, self.medalArt, self.medalText) +
      `<span class="wql-metric">${esc(self.metricText)}</span></div>`
    );
  }
}
