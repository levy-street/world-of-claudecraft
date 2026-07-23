import type { PokerAction, PokerViewerSnapshot } from '../sim/poker/engine';
import { buildPokerPlaytestView, type PokerPlaytestActionView } from './poker_playtest_view';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

const NEXT_HAND_DELAY_MS = 2_500;

export interface PokerPlaytestPort {
  state(): {
    snapshot: PokerViewerSnapshot;
    playerName: string;
    dealerName: string;
  };
  act(action: PokerAction): void;
  nextHand(): void;
  reset(): void;
}

export interface PokerPlaytestWindowDeps {
  root(): HTMLElement;
  session: PokerPlaytestPort;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  sound: {
    deal(): void;
    turn(): void;
  };
  schedule(callback: () => void, delayMs: number): number;
  cancelSchedule(id: number): void;
}

export class PokerPlaytestWindow {
  private openerFocus: HTMLElement | null = null;
  private lastHandNumber = -1;
  private wasPlayerTurn = false;
  private scheduledResultHand = -1;
  private nextHandTimer: number | null = null;

  constructor(private readonly deps: PokerPlaytestWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'poker-playtest-title' });
    root.style.display = 'block';
    this.render();
    (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') return;
    root.style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  render(): void {
    if (!this.isOpen) return;
    const state = this.deps.session.state();
    const view = buildPokerPlaytestView(state.snapshot);
    if (view.active && state.snapshot.handNumber !== this.lastHandNumber) {
      this.deps.sound.deal();
    }
    const isPlayerTurn = view.actorSeat === 0;
    if (isPlayerTurn && !this.wasPlayerTurn) this.deps.sound.turn();
    this.lastHandNumber = state.snapshot.handNumber;
    this.wasPlayerTurn = isPlayerTurn;
    const cards = (values: string[], hidden = false): string =>
      values.length > 0
        ? values
            .map((value) => `<span class="poker-card${/[♦♥]/.test(value) ? ' red' : ''}">${esc(value)}</span>`)
            .join('')
        : hidden
          ? '<span class="poker-card back">?</span><span class="poker-card back">?</span>'
          : `<span class="poker-empty">${esc(t('hudChrome.pokerPlaytest.noCards'))}</span>`;
    const amount = (value: number): string =>
      formatNumber(value, { maximumFractionDigits: 0, useGrouping: true });
    const actionLabel = (action: PokerPlaytestActionView): string => {
      const key = `hudChrome.pokerPlaytest.action.${action.kind}` as const;
      return action.amount === null
        ? t(key)
        : t('hudChrome.pokerPlaytest.actionWithAmount', {
            action: t(key),
            amount: amount(action.amount),
          });
    };
    const actions = view.actions
      .map(
        (entry, index) =>
          `<button type="button" class="poker-action" data-action="${index}">${esc(actionLabel(entry))}</button>`,
      )
      .join('');
    const seatName = (seat: number): string => {
      if (seat === 0) return state.playerName;
      if (seat === 3) return state.dealerName;
      return t('hudChrome.pokerPlaytest.emptySeat');
    };
    const result = state.snapshot.lastResult;
    const winnerLines =
      !view.active && result
        ? result.payouts
            .filter((payout) => payout.amount > 0)
            .map((payout) =>
              t('hudChrome.pokerPlaytest.winner', {
                name: seatName(payout.seat),
                amount: amount(payout.amount),
              }),
            )
        : [];
    const winnerBanner =
      winnerLines.length > 0
        ? `<div class="poker-result-banner">${winnerLines.map((line) => `<div>${esc(line)}</div>`).join('')}</div>`
        : '';
    const status = view.active
      ? view.actorSeat === 0
        ? t('hudChrome.pokerPlaytest.yourTurn')
        : t('hudChrome.pokerPlaytest.dealerTurn')
      : t('hudChrome.pokerPlaytest.nextRoundSoon');
    const next = view.active
      ? ''
      : `<button type="button" class="poker-action primary" data-next>${esc(t('hudChrome.pokerPlaytest.nextHand'))}</button>`;
    const seats = view.seats
      .map((seat) => {
        const initials = seat.occupied
          ? seatName(seat.seat)
              .split(/\s+/)
              .map((part) => part[0] ?? '')
              .join('')
              .slice(0, 2)
              .toUpperCase()
          : '+';
        const seatCards = seat.cardsVisible
          ? cards(seat.cards, !seat.own)
          : '';
        const roleMarkers =
          (seat.dealer
            ? `<span class="poker-role-marker dealer" title="${esc(t('hudChrome.pokerPlaytest.dealerButton'))}">D</span>`
            : '') +
          (seat.blind
            ? `<span class="poker-blind-marker ${seat.blind}" title="${esc(t(`hudChrome.pokerPlaytest.${seat.blind}Blind`))}">` +
              `<span class="poker-chip-face">${seat.blind === 'small' ? 'SB' : 'BB'}</span>` +
              `<span class="poker-marker-amount">${esc(amount(seat.blindAmount))}</span></span>`
            : '');
        const bet =
          seat.bet > 0
            ? `<div class="poker-bet"><span class="poker-chip-stack"><i></i><i></i><i></i></span>` +
              `<span class="poker-bet-amount">${esc(amount(seat.bet))}</span></div>`
            : '';
        return (
          `<div class="poker-table-seat seat-${seat.seat}${seat.acting ? ' acting' : ''}${seat.folded ? ' folded' : ''}${seat.occupied ? '' : ' empty'}">` +
          `<div class="poker-seat-cards">${seatCards}</div>` +
          `<div class="poker-avatar" aria-hidden="true">${esc(initials)}</div>` +
          `<div class="poker-role-markers">${roleMarkers}</div>` +
          `<div class="poker-seat-name">${esc(seatName(seat.seat))}</div>` +
          `<div class="poker-seat-stack">${seat.occupied ? esc(t('hudChrome.pokerPlaytest.chips', { amount: amount(seat.stack) })) : ''}</div>` +
          bet +
          `</div>`
        );
      })
      .join('');
    const root = this.deps.root();
    root.innerHTML =
      `<div class="panel-title"><span id="poker-playtest-title">${esc(t('hudChrome.pokerPlaytest.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.pokerPlaytest.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="poker-playtest-note">${esc(t('hudChrome.pokerPlaytest.note'))}</div>` +
      `<div class="poker-table-wrap"><div class="poker-table-felt">` +
      `<div class="poker-board"><div class="poker-pot">${esc(t('hudChrome.pokerPlaytest.pot', { amount: amount(view.pot) }))}</div>` +
      `<div class="poker-cards community">${cards(view.communityCards)}</div></div>` +
      `</div>${seats}${winnerBanner}</div>` +
      `<div class="poker-status" role="status" aria-live="polite">${esc(status)}</div>` +
      `<div class="poker-actions">${actions}${next}</div>` +
      `<button type="button" class="poker-reset" data-reset>${esc(t('hudChrome.pokerPlaytest.reset'))}</button>`;
    if (!view.active && result && result.handNumber !== this.scheduledResultHand) {
      this.clearNextHandTimer();
      this.scheduledResultHand = result.handNumber;
      this.nextHandTimer = this.deps.schedule(() => {
        this.nextHandTimer = null;
        this.wasPlayerTurn = false;
        this.deps.session.nextHand();
        this.render();
      }, NEXT_HAND_DELAY_MS);
    }
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    root.querySelector('[data-next]')?.addEventListener('click', () => {
      this.clearNextHandTimer();
      this.wasPlayerTurn = false;
      this.deps.session.nextHand();
      this.render();
    });
    root.querySelector('[data-reset]')?.addEventListener('click', () => {
      this.clearNextHandTimer();
      this.lastHandNumber = -1;
      this.wasPlayerTurn = false;
      this.scheduledResultHand = -1;
      this.deps.session.reset();
      this.render();
    });
    root.querySelectorAll<HTMLElement>('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = view.actions[Number(button.dataset.action)];
        if (!action) return;
        this.wasPlayerTurn = false;
        this.deps.session.act(action.action);
        this.render();
      });
    });
  }

  private clearNextHandTimer(): void {
    if (this.nextHandTimer === null) return;
    this.deps.cancelSchedule(this.nextHandTimer);
    this.nextHandTimer = null;
  }
}
