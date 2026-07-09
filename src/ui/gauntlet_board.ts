// The Gauntlet standings board: a compact top-left panel that lists every
// contestant (players first, then the NPC backfill) with their event-vitality
// bar, marks the viewer's own row, and shows who has been knocked out. It
// replaces the old flurry of "someone is out" toasts with one persistent read
// of the whole field, exactly like a battle-royale standings list.
//
// This is a low-frequency panel, not a per-frame hot painter: the board only
// changes on a vitality hit or a knockout, so update() diffs a cheap numeric
// signature and rebuilds the DOM only when something actually changed. It owns
// its own show/hide and holds no Sim reference (Hud feeds it the wire view).
// Contestant names are proper nouns, escaped through esc(), never translated.

import type { GauntletRunView } from '../world_api/gauntlet';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';

const INT = { maximumFractionDigits: 0 } as const;
// Below this vitality fraction the bar reads as critical (adds the .low class so
// the stylesheet tints it); a threshold, not a magic style value.
const LOW_FRAC = 0.34;

type BoardRow = GauntletRunView['board'][number];

/** Hud-supplied glue; the board reaches the DOM only through this. */
export interface GauntletBoardDeps {
  /** The board container (#gauntlet-board). */
  root(): HTMLElement;
}

export class GauntletBoard {
  private visible = false;
  // The signature of the last rendered board; -1 forces the next shown frame to
  // paint. Recomputed each update from the field's vitality + knockout state.
  private lastSig = -1;

  constructor(private readonly deps: GauntletBoardDeps) {}

  /** Per-frame refresh from the viewer's run view. Shows once the field is
   *  assembled (staging through podium), hidden in the lobby, between runs, and
   *  after the run resolves. The signature diff makes an unchanged frame free. */
  update(run: GauntletRunView | null): void {
    const root = this.deps.root();
    const show = !!run && run.phase !== 'lobby' && run.phase !== 'done' && run.board.length > 0;
    if (!show || !run) {
      this.hide(root);
      return;
    }
    const sig = boardSignature(run.board);
    if (this.visible && sig === this.lastSig) return; // nothing changed this frame
    this.lastSig = sig;
    if (!this.visible) {
      root.style.display = 'flex';
      this.visible = true;
    }
    root.innerHTML = this.render(run);
  }

  /** Tear the board down (the run went null, or the lobby/done phase). */
  hide(root: HTMLElement = this.deps.root()): void {
    if (!this.visible) return;
    root.style.display = 'none';
    root.replaceChildren();
    this.visible = false;
    this.lastSig = -1;
  }

  private render(run: GauntletRunView): string {
    const board = run.board;
    const alive = board.reduce((n, b) => n + (b.out ? 0 : 1), 0);
    const count = `${formatNumber(alive, INT)} / ${formatNumber(board.length, INT)}`;
    const title = t(K.title);
    const head =
      `<div class="gb-head"><span class="gb-title">${esc(title)}</span>` +
      `<span class="gb-count">${esc(count)}</span></div>`;
    const rows = board.map((b) => this.row(b, run.vitalityMax)).join('');
    return `${head}<ol class="gb-list">${rows}</ol>`;
  }

  private row(b: BoardRow, vitalityMax: number): string {
    const cls = ['gb-row'];
    if (b.you) cls.push('me');
    if (b.out) cls.push('out');
    const name = `<span class="gb-name">${esc(b.name)}</span>`;
    if (b.out) {
      // Knocked out: a text label (never colour alone) instead of a bar.
      return `<li class="${cls.join(' ')}">${name}<span class="gb-out">${esc(t(K.out))}</span></li>`;
    }
    const frac = vitalityMax > 0 ? Math.max(0, Math.min(1, b.vitality / vitalityMax)) : 0;
    const pct = `${(frac * 100).toFixed(0)}%`;
    const fillCls = frac <= LOW_FRAC ? 'gb-fill low' : 'gb-fill';
    const bar = `<span class="gb-bar"><span class="${fillCls}" style="width:${pct}"></span></span>`;
    return `<li class="${cls.join(' ')}">${name}${bar}</li>`;
  }
}

// A cheap order-sensitive numeric hash of the field's mutable state (vitality +
// knockout + the viewer flag): identical fields yield the same number so the
// board skips the rebuild, and any real change forces one. Names/order are
// fixed once the field is assembled, so they need not enter the hash.
function boardSignature(board: readonly BoardRow[]): number {
  let h = board.length * 0x1000193;
  for (let i = 0; i < board.length; i++) {
    const b = board[i];
    h = (h * 31 + b.vitality * 4 + (b.out ? 1 : 0) + (b.you ? 2 : 0)) | 0;
  }
  return h;
}

// The i18n keys the board resolves (named so the completeness sweep finds them
// and there is no bare string literal in the render body).
const K = {
  title: 'hudChrome.gauntlet.boardTitle',
  out: 'hudChrome.gauntlet.boardOut',
} satisfies Record<string, TranslationKey>;
