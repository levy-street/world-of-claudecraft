// Keeper's Wager (Trial 4) panel: a small window for the marble odd/even duel
// against a seeded partner. It opens/closes automatically as run.wager appears and
// disappears, and Hud drives it per frame. The SIM owns every outcome; this panel
// only surfaces the purses + round clock and dispatches the three player actions
// (set the stake, hide a count on a hold round, call odd/even on a guess round).
//
// The wire view drives which control is live off `stage` ('hold' -> hide buttons,
// 'guess' -> odd/even, 'done' -> a result line until the pair flips). The chosen
// stake is a LOCAL UI value (the wire view does not project it); the server re-clamps
// every send, so a stale local stake is always corrected authoritatively.
//
// A WINDOW module (runs only while the trial is live), so it paints with direct DOM
// writes rather than the per-frame elided-writer facet, like gauntlet_recruit_window.

import { GAUNTLET } from '../sim/content/gauntlet';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';

/** The viewer's live wager substate (GauntletRunView.wager) plus the sim clock. */
export interface GauntletWagerStatus {
  mine: number;
  theirs: number;
  partnerName: string;
  holder: boolean;
  stage: 'hold' | 'guess' | 'done';
  roundEndsAt: number;
  time: number;
}

/** Hud-supplied glue; the panel reaches into Hud only through these. */
export interface GauntletWagerWindowDeps {
  root(): HTMLElement;
  /** Set the round stake (marbles moved on a win/loss). */
  onWager(n: number): void;
  /** Hide `n` of your own marbles this hold round. */
  onHold(n: number): void;
  /** Call the partner's hidden parity (true = odd). */
  onGuess(odd: boolean): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

const INT = { maximumFractionDigits: 0 } as const;
// Stake / hide options are 1..maxWager; both rows render the same digit buttons.
const MAX_OPTION = GAUNTLET.wager.maxWager;

const K = {
  title: 'hudChrome.gauntlet.wagerTitle',
  yours: 'hudChrome.gauntlet.wagerYours',
  partner: 'hudChrome.gauntlet.wagerPartner',
  round: 'hudChrome.gauntlet.wagerRound',
  stake: 'hudChrome.gauntlet.wagerStake',
  hide: 'hudChrome.gauntlet.wagerHide',
  guess: 'hudChrome.gauntlet.wagerGuess',
  odd: 'hudChrome.gauntlet.odd',
  even: 'hudChrome.gauntlet.even',
  won: 'hudChrome.gauntlet.wagerWon',
  lost: 'hudChrome.gauntlet.wagerLost',
} satisfies Record<string, TranslationKey>;

const digitButtons = (cls: string): string => {
  let out = '';
  for (let n = 1; n <= MAX_OPTION; n++) {
    out += `<button type="button" class="btn gw-digit ${cls}" data-n="${n}">${esc(formatNumber(n, INT))}</button>`;
  }
  return out;
};

export class GauntletWagerWindow {
  private opened = false;
  private openerFocus: HTMLElement | null = null;
  private stake = 1;
  private yoursEl: HTMLElement | null = null;
  private partnerEl: HTMLElement | null = null;
  private roundEl: HTMLElement | null = null;
  private stakeRow: HTMLElement | null = null;
  private holdRow: HTMLElement | null = null;
  private guessRow: HTMLElement | null = null;
  private doneEl: HTMLElement | null = null;
  private stakeBtns: HTMLButtonElement[] = [];
  private holdBtns: HTMLButtonElement[] = [];

  constructor(private readonly deps: GauntletWagerWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  /** Per-frame entry point: opens on first non-null status, refreshes, closes on null. */
  sync(status: GauntletWagerStatus | null): void {
    if (!status) {
      this.close();
      return;
    }
    if (!this.opened) this.open();
    this.update(status);
  }

  private open(): void {
    this.openerFocus = this.deps.captureFocus();
    this.stake = 1;
    this.build();
    const el = this.deps.root();
    el.style.display = 'block';
    el.dataset.windowOpen = '1';
    this.opened = true;
    (this.stakeBtns[0] ?? el).focus();
  }

  close(): void {
    if (!this.opened) return;
    const el = this.deps.root();
    el.style.display = 'none';
    delete el.dataset.windowOpen;
    this.opened = false;
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  private build(): void {
    const el = this.deps.root();
    markDialogRoot(el, { labelledBy: 'gauntlet-wager-title', modal: false });
    el.innerHTML =
      `<div class="panel-title"><span id="gauntlet-wager-title">${esc(t(K.title))}</span></div>` +
      `<div class="gw-purses"><span class="gw-yours"></span><span class="gw-partner"></span></div>` +
      `<div class="gw-round" role="status"></div>` +
      `<div class="gw-stake"><span class="gw-label">${esc(t(K.stake))}</span>` +
      `<div class="gw-digits gw-stake-row" role="group" aria-label="${esc(t(K.stake))}">${digitButtons('gw-stake-btn')}</div></div>` +
      `<div class="gw-hold"><span class="gw-label">${esc(t(K.hide))}</span>` +
      `<div class="gw-digits gw-hold-row" role="group" aria-label="${esc(t(K.hide))}">${digitButtons('gw-hold-btn')}</div></div>` +
      `<div class="gw-guess"><span class="gw-label">${esc(t(K.guess))}</span>` +
      `<div class="gw-guess-row"><button type="button" class="btn gw-odd">${esc(t(K.odd))}</button>` +
      `<button type="button" class="btn gw-even">${esc(t(K.even))}</button></div></div>` +
      `<div class="gw-done" role="status"></div>`;
    this.yoursEl = el.querySelector('.gw-yours');
    this.partnerEl = el.querySelector('.gw-partner');
    this.roundEl = el.querySelector('.gw-round');
    this.stakeRow = el.querySelector('.gw-stake');
    this.holdRow = el.querySelector('.gw-hold');
    this.guessRow = el.querySelector('.gw-guess');
    this.doneEl = el.querySelector('.gw-done');
    this.stakeBtns = [...el.querySelectorAll<HTMLButtonElement>('.gw-stake-btn')];
    this.holdBtns = [...el.querySelectorAll<HTMLButtonElement>('.gw-hold-btn')];
    for (const btn of this.stakeBtns) {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this.stake = Number(btn.dataset.n);
        this.deps.onWager(this.stake);
      });
    }
    for (const btn of this.holdBtns) {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this.deps.onHold(Number(btn.dataset.n));
      });
    }
    el.querySelector('.gw-odd')?.addEventListener('click', () => this.deps.onGuess(true));
    el.querySelector('.gw-even')?.addEventListener('click', () => this.deps.onGuess(false));
  }

  private update(status: GauntletWagerStatus): void {
    // The stake can never exceed the smaller purse; clamp the local pick for display
    // (the server re-clamps every send anyway).
    const cap = Math.max(1, Math.min(MAX_OPTION, status.mine, status.theirs));
    if (this.stake > cap) this.stake = cap;
    const done = status.stage === 'done';
    if (this.yoursEl)
      this.yoursEl.textContent = t(K.yours, { count: formatNumber(status.mine, INT) });
    if (this.partnerEl)
      // Assigned via textContent below, which escapes, so the raw proper-noun name
      // is correct here (esc() is only for the innerHTML build path).
      this.partnerEl.textContent = t(K.partner, {
        name: status.partnerName,
        count: formatNumber(status.theirs, INT),
      });
    if (this.roundEl) {
      const seconds = Math.max(0, Math.ceil(status.roundEndsAt - status.time));
      this.roundEl.textContent = done ? '' : t(K.round, { seconds: formatNumber(seconds, INT) });
      this.roundEl.style.display = done ? 'none' : '';
    }
    // Stake chips: highlight the pick, disable options above the purse cap.
    for (const btn of this.stakeBtns) {
      const n = Number(btn.dataset.n);
      btn.disabled = n > cap;
      btn.classList.toggle('gw-on', n === this.stake && !done);
    }
    // Hide buttons cap at the smaller of 5 and the viewer's own purse.
    const holdCap = Math.max(1, Math.min(MAX_OPTION, status.mine));
    for (const btn of this.holdBtns) btn.disabled = Number(btn.dataset.n) > holdCap;
    if (this.stakeRow) this.stakeRow.style.display = done ? 'none' : '';
    if (this.holdRow) this.holdRow.style.display = status.stage === 'hold' ? '' : 'none';
    if (this.guessRow) this.guessRow.style.display = status.stage === 'guess' ? '' : 'none';
    if (this.doneEl) {
      this.doneEl.style.display = done ? '' : 'none';
      if (done) this.doneEl.textContent = status.mine > status.theirs ? t(K.won) : t(K.lost);
    }
  }
}
