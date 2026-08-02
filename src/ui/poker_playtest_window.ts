import type { PokerClientPort, PokerErrorCode } from '../sim/poker/protocol';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { captureFocusKey, restoreFirstEnabled } from './focus_restore';
import { formatNumber, t } from './i18n';
import {
  buildPokerPlaytestView,
  type PokerPlaytestView,
  pokerActionFromInput,
} from './poker_playtest_view';
import { svgIcon } from './ui_icons';

export interface PokerPlaytestWindowDeps {
  root(): HTMLElement;
  launcher(): HTMLElement;
  client: PokerClientPort;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  sound: { deal(): void; turn(): void };
  now(): number;
  schedule(callback: () => void, delayMs: number): number;
  cancelSchedule(id: number): void;
}

export class PokerPlaytestWindow {
  private openerFocus: HTMLElement | null = null;
  private lastHandNumber = -1;
  private wasPlayerTurn = false;
  private timer: number | null = null;
  private showLobby = true;
  private invalidAmount = false;
  private readonly wagerDraft = new Map<'bet' | 'raise', string>();
  private wagerActionSequence: number | null = null;

  constructor(private readonly deps: PokerPlaytestWindowDeps) {
    deps.client.subscribe(() => {
      this.syncLauncher();
      if (this.isOpen) this.render();
    });
    this.syncLauncher();
  }

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
    this.showLobby = this.deps.client.pokerState().snapshot === null;
    this.deps.client.requestTables();
    this.render();
    root.querySelector<HTMLElement>('[data-close]')?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.clearTimer();
    this.deps.root().style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  render(): void {
    if (!this.isOpen) return;
    this.clearTimer();
    const root = this.deps.root();
    this.captureWagerDraft(root);
    const focusKey = captureFocusKey(root);
    const state = this.deps.client.pokerState();
    const actionSequence = state.snapshot?.actionSequence ?? null;
    if (actionSequence !== this.wagerActionSequence) {
      this.wagerDraft.clear();
      this.wagerActionSequence = actionSequence;
    }
    const alert = !state.connected
      ? t('hudChrome.pokerPlaytest.reconnecting')
      : this.invalidAmount
        ? t('hudChrome.pokerPlaytest.error.invalidAmount')
        : state.error
          ? t(this.errorKey(state.error))
          : null;
    const body = !state.enabled
      ? this.empty(t('hudChrome.pokerPlaytest.disabled'))
      : this.showLobby || !state.snapshot
        ? this.lobby(state)
        : this.table(state);
    root.innerHTML =
      `<div class=panel-title><span id=poker-playtest-title>${esc(t('hudChrome.pokerPlaytest.title'))}</span>` +
      `<button type=button class=x-btn data-close data-focus-key=close aria-label='${esc(t('hudChrome.pokerPlaytest.close'))}'>${svgIcon('close')}</button></div>` +
      (alert ? `<div class=poker-alert role=alert>${esc(alert)}</div>` : '') +
      body;
    this.bind(root);
    if (focusKey !== null) {
      restoreFirstEnabled([
        root.querySelector<HTMLElement>(`[data-focus-key=${CSS.escape(focusKey)}]`),
        root.querySelector<HTMLElement>('[data-focus-key=close]'),
      ]);
    }
  }

  private lobby(state: ReturnType<PokerClientPort['pokerState']>): string {
    const rows = state.tables.map((table) => {
      const seats = table.openSeats ?? [];
      const options = seats
        .map(
          (seat) =>
            `<option value=${seat}>${esc(t('hudChrome.pokerPlaytest.seat', { seat: formatNumber(seat + 1) }))}</option>`,
        )
        .join('');
      const join = options
        ? `<select data-seat-for='${esc(table.tableId)}' data-focus-key='seat-${esc(table.tableId)}' aria-label='${esc(t('hudChrome.pokerPlaytest.chooseSeat'))}'>${options}</select>` +
          this.button(
            'join',
            table.tableId,
            t('hudChrome.pokerPlaytest.join'),
            state.connected,
            true,
          )
        : `<span class=poker-table-full>${esc(t('hudChrome.pokerPlaytest.tableFull'))}</span>`;
      return (
        `<li class=poker-table-row><div class=poker-table-summary><strong>${esc(table.tableId)}</strong>` +
        `<span>${esc(t('hudChrome.pokerPlaytest.seated', { count: formatNumber(table.seatedCount) }))}</span>` +
        `<span>${esc(t('hudChrome.pokerPlaytest.watchers', { count: formatNumber(table.watcherCount) }))}</span>` +
        `<span>${esc(t(table.inHand ? 'hudChrome.pokerPlaytest.inHand' : 'hudChrome.pokerPlaytest.betweenHands'))}</span></div>` +
        `<div class=poker-table-controls>${join}${this.button('watch', table.tableId, t('hudChrome.pokerPlaytest.watch'), state.connected)}</div></li>`
      );
    });
    return (
      `<div class=poker-lobby-toolbar><strong>${esc(t('hudChrome.pokerPlaytest.tables'))}</strong>` +
      this.button('refresh', '', t('hudChrome.pokerPlaytest.refresh'), state.connected) +
      `</div>${rows.length ? `<ul class=poker-table-list>${rows.join('')}</ul>` : this.empty(t('hudChrome.pokerPlaytest.noTables'))}`
    );
  }

  private table(state: ReturnType<PokerClientPort['pokerState']>): string {
    const snapshot = state.snapshot;
    if (!snapshot) return '';
    const view = buildPokerPlaytestView(snapshot, snapshot.viewerSeat);
    const ownTurn = snapshot.viewerSeat !== null && snapshot.actorSeat === snapshot.viewerSeat;
    if (view.active && snapshot.handNumber !== this.lastHandNumber) this.deps.sound.deal();
    if (ownTurn && !this.wasPlayerTurn) this.deps.sound.turn();
    this.lastHandNumber = snapshot.handNumber;
    this.wasPlayerTurn = ownTurn;
    const name = (seat: number): string => {
      const id = snapshot.seats[seat]?.playerId;
      return id === undefined
        ? t('hudChrome.pokerPlaytest.emptySeat')
        : (state.names[id] ?? t('hudChrome.pokerPlaytest.unknownPlayer'));
    };
    return this.tableContent(state, view, name);
  }

  private tableContent(
    state: ReturnType<PokerClientPort['pokerState']>,
    view: PokerPlaytestView,
    name: (seat: number) => string,
  ): string {
    const snapshot = state.snapshot;
    if (!snapshot) return '';
    const seats = view.seats.map((seat) => this.seatMarkup(seat, name(seat.seat))).join('');
    const result = snapshot.street === null ? snapshot.lastResult : null;
    const winners =
      result?.payouts
        .filter((payout) => payout.amount > 0)
        .map((payout) =>
          t('hudChrome.pokerPlaytest.winner', {
            name: name(payout.seat),
            amount: formatNumber(payout.amount),
          }),
        ) ?? [];
    return this.tableFrame(state, view, name, seats, result?.rake ?? null, winners);
  }

  private tableFrame(
    state: ReturnType<PokerClientPort['pokerState']>,
    view: PokerPlaytestView,
    name: (seat: number) => string,
    seats: string,
    rake: number | null,
    winners: string[],
  ): string {
    const snapshot = state.snapshot;
    if (!snapshot) return '';
    const result =
      rake === null
        ? ''
        : `<div class=poker-result-banner>${winners.map((line) => `<div>${esc(line)}</div>`).join('')}<div>${esc(t('hudChrome.pokerPlaytest.rake', { amount: formatNumber(rake) }))}</div></div>`;
    return this.tableControls(state, view, name) + this.board(view, seats, result);
  }

  private board(view: PokerPlaytestView, seats: string, result: string): string {
    const pot = esc(t('hudChrome.pokerPlaytest.pot', { amount: formatNumber(view.pot) }));
    return `<div class=poker-table-wrap><div class=poker-table-felt><div class=poker-board><div class=poker-pot>${pot}</div><div class=poker-cards>${this.cards(view.communityCards)}</div></div></div>${seats}${result}</div>`;
  }

  private seatMarkup(seat: PokerPlaytestView['seats'][number], name: string): string {
    const classes = `poker-table-seat seat-${seat.seat}${seat.acting ? ' acting' : ''}${seat.folded ? ' folded' : ''}${seat.occupied ? '' : ' empty'}`;
    const cards = seat.cardsVisible ? this.cards(seat.cards, !seat.own) : '';
    return `<div class='${esc(classes)}'><div class=poker-seat-cards>${cards}</div><div class=poker-avatar aria-hidden=true>${esc(seat.occupied ? name.slice(0, 2).toUpperCase() : '+')}</div>${this.markers(seat)}${this.seatText(seat, name)}</div>`;
  }

  private markers(seat: PokerPlaytestView['seats'][number]): string {
    const dealer = seat.dealer
      ? `<span class=poker-role-marker title='${esc(t('hudChrome.pokerPlaytest.dealerButton'))}'>${esc(t('hudChrome.pokerPlaytest.dealerMarker'))}</span>`
      : '';
    const blind = seat.blind
      ? `<span title='${esc(t(`hudChrome.pokerPlaytest.${seat.blind}Blind`))}'>${esc(t(`hudChrome.pokerPlaytest.${seat.blind}BlindMarker`))}</span>`
      : '';
    return `<div class=poker-role-markers>${dealer}${blind}</div>`;
  }

  private seatText(seat: PokerPlaytestView['seats'][number], name: string): string {
    const stack = seat.occupied
      ? t('hudChrome.pokerPlaytest.chips', { amount: formatNumber(seat.stack) })
      : '';
    const bet =
      seat.bet > 0
        ? `<div class=poker-bet><span class=poker-chip-stack aria-hidden=true><i></i><i></i><i></i></span><div class=poker-bet-amount>${esc(formatNumber(seat.bet))}</div></div>`
        : '';
    return `<div class=poker-seat-name>${esc(name)}</div><div class=poker-seat-stack>${esc(stack)}</div>${bet}`;
  }

  private tableControls(
    state: ReturnType<PokerClientPort['pokerState']>,
    view: PokerPlaytestView,
    _name: (seat: number) => string,
  ): string {
    const snapshot = state.snapshot;
    if (!snapshot) return '';
    const management = snapshot.watching
      ? this.button('stop-watch', '', t('hudChrome.pokerPlaytest.stopWatching'), state.connected)
      : this.seatedButtons(state.connected, view.active);
    const role = snapshot.watching
      ? t('hudChrome.pokerPlaytest.watching')
      : t('hudChrome.pokerPlaytest.seat', { seat: formatNumber((snapshot.viewerSeat ?? -1) + 1) });
    const updateTimer = state.connected && !this.invalidAmount && state.error === null;
    return `<div class=poker-table-toolbar>${this.button('lobby', '', t('hudChrome.pokerPlaytest.tables'), true)}<strong>${esc(snapshot.tableId)}</strong><span>${esc(role)}</span>${management}</div>${this.status(snapshot, updateTimer)}${this.actionControls(view, state.connected)}`;
  }

  private status(
    snapshot: NonNullable<ReturnType<PokerClientPort['pokerState']>['snapshot']>,
    updateTimer: boolean,
  ): string {
    const ownTurn = snapshot.viewerSeat !== null && snapshot.actorSeat === snapshot.viewerSeat;
    const text = ownTurn
      ? t('hudChrome.pokerPlaytest.yourTurn')
      : t('hudChrome.pokerPlaytest.waiting');
    if (snapshot.turnDeadlineMs === null) return `<div class=poker-status>${esc(text)}</div>`;
    const seconds = Math.max(0, Math.ceil((snapshot.turnDeadlineMs - this.deps.now()) / 1_000));
    if (updateTimer) this.armTimer(seconds);
    const timer = t('hudChrome.pokerPlaytest.timeRemaining', { seconds: formatNumber(seconds) });
    return `<div class=poker-status role=status aria-live=polite>${esc(text)} ${esc(timer)}</div>`;
  }

  private armTimer(seconds: number): void {
    if (seconds <= 0) return;
    this.timer = this.deps.schedule(() => {
      this.timer = null;
      this.render();
    }, 1_000);
  }

  private seatedButtons(connected: boolean, active: boolean): string {
    if (this.deps.client.pokerState().snapshot?.viewerSeat === null) return '';
    return (
      this.button('rebuy', '', t('hudChrome.pokerPlaytest.rebuy'), connected && !active) +
      this.button('leave', '', t('hudChrome.pokerPlaytest.leave'), connected)
    );
  }

  private actionControls(view: PokerPlaytestView, connected: boolean): string {
    return `<div class=poker-actions>${view.actions
      .map((action, index) => this.actionMarkup(action, index, connected))
      .join('')}</div>`;
  }

  private actionMarkup(
    action: PokerPlaytestView['actions'][number],
    index: number,
    connected: boolean,
  ): string {
    const label = t(`hudChrome.pokerPlaytest.action.${action.kind}` as const);
    if (action.kind === 'bet' || action.kind === 'raise') {
      const min = action.minTo ?? 1;
      const max = action.maxTo === null ? '' : ` max=${action.maxTo}`;
      const value = this.wagerDraft.get(action.kind) ?? String(min);
      return `<label class=poker-wager><span>${esc(label)}</span><input type=number inputmode=numeric step=1 min=${min}${max} value='${esc(value)}' data-wager=${index} data-wager-kind=${action.kind} data-focus-key=wager-${action.kind}${connected ? '' : ' disabled'}><button type=button class=poker-action data-action=${index} data-focus-key=action-${action.kind}${connected ? '' : ' disabled'}>${esc(label)}</button></label>`;
    }
    const text =
      action.amount === null
        ? label
        : t('hudChrome.pokerPlaytest.actionWithAmount', {
            action: label,
            amount: formatNumber(action.amount),
          });
    return `<button type=button class=poker-action data-action=${index} data-focus-key=action-${action.kind}${connected ? '' : ' disabled'}>${esc(text)}</button>`;
  }

  private cards(values: string[], hidden = false): string {
    if (!values.length) return hidden ? '??' : esc(t('hudChrome.pokerPlaytest.noCards'));
    return values.map((value) => `<span class=poker-card>${esc(value)}</span>`).join('');
  }

  private button(
    kind: string,
    value: string,
    label: string,
    enabled: boolean,
    _primary = false,
  ): string {
    const attr = value ? `=${esc(value)}` : '';
    const focus = `${kind}${value ? `-${value}` : ''}`;
    return `<button type=button class=poker-control data-${kind}${attr} data-focus-key=${esc(focus)}${enabled ? '' : ' disabled'}>${esc(label)}</button>`;
  }

  private empty(text: string): string {
    return `<div class=poker-empty-state>${esc(text)}</div>`;
  }

  private bind(root: HTMLElement): void {
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    root
      .querySelector('[data-refresh]')
      ?.addEventListener('click', () => this.deps.client.requestTables());
    root.querySelector('[data-lobby]')?.addEventListener('click', () => {
      this.showLobby = true;
      this.deps.client.requestTables();
      this.render();
    });
    this.bindLobby(root);
    this.bindTable(root);
  }

  private bindLobby(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[data-watch]').forEach((button) => {
      button.addEventListener('click', () => {
        this.showLobby = false;
        this.deps.client.watch(button.dataset.watch ?? '');
      });
    });
    root.querySelectorAll<HTMLElement>('[data-join]').forEach((button) => {
      button.addEventListener('click', () => this.joinSelected(root, button));
    });
  }

  private joinSelected(root: HTMLElement, button: HTMLElement): void {
    const tableId = button.dataset.join ?? '';
    const select = root.querySelector<HTMLSelectElement>(`[data-seat-for=${CSS.escape(tableId)}]`);
    const seat = Number(select?.value);
    if (!Number.isSafeInteger(seat)) return;
    this.showLobby = false;
    this.deps.client.join(tableId, seat);
  }

  private bindTable(root: HTMLElement): void {
    root.querySelector('[data-stop-watch]')?.addEventListener('click', () => {
      const id = this.currentTable();
      if (id) this.deps.client.stopWatching(id);
      this.backToLobby();
    });
    root.querySelector('[data-rebuy]')?.addEventListener('click', () => {
      const id = this.currentTable();
      if (id) this.deps.client.rebuy(id);
    });
    root.querySelector('[data-leave]')?.addEventListener('click', () => {
      const id = this.currentTable();
      if (id) this.deps.client.leave(id);
      this.backToLobby();
    });
    this.bindPokerActions(root);
  }

  private currentTable(): string | null {
    return this.deps.client.pokerState().snapshot?.tableId ?? null;
  }

  private backToLobby(): void {
    this.showLobby = true;
    this.deps.client.requestTables();
    this.render();
  }

  private bindPokerActions(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const state = this.deps.client.pokerState();
        if (!state.connected || !state.snapshot) return;
        const index = Number(button.dataset.action);
        const actionView = buildPokerPlaytestView(state.snapshot, state.snapshot.viewerSeat)
          .actions[index];
        if (!actionView) return;
        const raw =
          actionView.kind === 'bet' || actionView.kind === 'raise'
            ? root.querySelector<HTMLInputElement>(`[data-wager='${index}']`)?.value
            : undefined;
        const action = pokerActionFromInput(actionView, raw);
        if (!action) {
          this.invalidAmount = true;
          this.render();
          return;
        }
        this.invalidAmount = false;
        if (actionView.kind === 'bet' || actionView.kind === 'raise') {
          this.wagerDraft.delete(actionView.kind);
        }
        this.wasPlayerTurn = false;
        this.deps.client.act(action);
      });
    });
  }

  private captureWagerDraft(root: HTMLElement): void {
    root.querySelectorAll<HTMLInputElement>('[data-wager-kind]').forEach((input) => {
      const kind = input.dataset.wagerKind;
      if (kind === 'bet' || kind === 'raise') this.wagerDraft.set(kind, input.value);
    });
  }

  private errorKey(code: PokerErrorCode): `hudChrome.pokerPlaytest.error.${PokerErrorCode}` {
    return `hudChrome.pokerPlaytest.error.${code}`;
  }

  private syncLauncher(): void {
    this.deps.launcher().hidden = !this.deps.client.pokerState().enabled;
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.deps.cancelSchedule(this.timer);
    this.timer = null;
  }
}
