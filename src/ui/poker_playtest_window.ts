import type { PokerClientPort, PokerErrorCode } from '../sim/poker/protocol';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { captureFocusKey, restoreFirstEnabled } from './focus_restore';
import { formatNumber, t } from './i18n';
import {
  buildPokerPlaytestView,
  type PokerPlaytestView,
  pokerActionFromInput,
  stepPokerWager,
} from './poker_playtest_view';
import { svgIcon } from './ui_icons';

const SHOWDOWN_REVEAL_MS = 900;

export interface PokerPlaytestWindowDeps {
  root(): HTMLElement;
  launcher(): HTMLElement;
  client: PokerClientPort;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  sound: { deal(): void; turn(): void; check?(): void; showdown?(): void };
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
  private lastCompletedHandNumber = -1;
  private showdownUntilMs = 0;

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
    const reachedShowdown =
      snapshot.street === null && Boolean(snapshot.lastResult?.revealedHoleCards.length);
    if (snapshot.street === null && snapshot.handNumber !== this.lastCompletedHandNumber) {
      this.lastCompletedHandNumber = snapshot.handNumber;
      this.showdownUntilMs = reachedShowdown ? this.deps.now() + SHOWDOWN_REVEAL_MS : 0;
      if (reachedShowdown) this.deps.sound.showdown?.();
    }
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
    const seats = view.seats
      .map((seat) =>
        this.seatMarkup(seat, name(seat.seat), snapshot.sitOutSeats?.includes(seat.seat) ?? false),
      )
      .join('');
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
    const showingShowdown = rake !== null && this.showdownUntilMs > this.deps.now();
    if (showingShowdown) this.armRender(this.showdownUntilMs - this.deps.now());
    const result =
      rake === null
        ? ''
        : showingShowdown
          ? `<div class=poker-showdown-banner role=status aria-live=polite>${esc(t('hudChrome.pokerPlaytest.showdown'))}</div>`
          : `<div class=poker-result-banner>${winners.map((line) => `<div>${esc(line)}</div>`).join('')}<div>${esc(t('hudChrome.pokerPlaytest.rake', { amount: formatNumber(rake) }))}</div></div>`;
    return this.tableControls(state, view, name) + this.board(view, seats, result);
  }

  private board(view: PokerPlaytestView, seats: string, result: string): string {
    const pot = esc(t('hudChrome.pokerPlaytest.pot', { amount: formatNumber(view.pot) }));
    return `<div class=poker-table-wrap><div class=poker-table-felt><div class=poker-board><div class=poker-pot>${pot}</div><div class=poker-cards>${this.cards(view.communityCards)}</div></div></div>${seats}${result}</div>`;
  }

  private seatMarkup(
    seat: PokerPlaytestView['seats'][number],
    name: string,
    sittingOut: boolean,
  ): string {
    const classes = `poker-table-seat seat-${seat.seat}${seat.acting ? ' acting' : ''}${seat.folded ? ' folded' : ''}${sittingOut ? ' sitting-out' : ''}${seat.occupied ? '' : ' empty'}`;
    const cards = seat.cardsVisible ? this.cards(seat.cards, !seat.own) : '';
    const sitOut = sittingOut
      ? `<div class=poker-sit-out>${esc(t('hudChrome.pokerPlaytest.sitOut'))}</div>`
      : '';
    return `<div class='${esc(classes)}'><div class=poker-seat-cards>${cards}</div><div class=poker-avatar aria-hidden=true>${esc(seat.occupied ? name.slice(0, 2).toUpperCase() : '+')}</div>${this.markers(seat)}${this.seatText(seat, name)}${sitOut}</div>`;
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
    const sittingOut =
      snapshot.viewerSeat !== null && Boolean(snapshot.sitOutSeats?.includes(snapshot.viewerSeat));
    const management = snapshot.watching
      ? this.button('stop-watch', '', t('hudChrome.pokerPlaytest.stopWatching'), state.connected)
      : this.sitOutControls(snapshot, state.connected) +
        this.seatedButtons(state.connected, view.active);
    const role = snapshot.watching
      ? t('hudChrome.pokerPlaytest.watching')
      : t('hudChrome.pokerPlaytest.seat', { seat: formatNumber((snapshot.viewerSeat ?? -1) + 1) });
    const updateTimer = state.connected && !this.invalidAmount && state.error === null;
    return `<div class=poker-table-toolbar>${this.button('lobby', '', t('hudChrome.pokerPlaytest.tables'), true)}<strong>${esc(snapshot.tableId)}</strong><span>${esc(role)}</span>${management}</div>${this.status(snapshot, updateTimer)}${sittingOut ? '' : this.actionControls(view, state.connected)}`;
  }

  private sitOutControls(
    snapshot: NonNullable<ReturnType<PokerClientPort['pokerState']>['snapshot']>,
    connected: boolean,
  ): string {
    if (snapshot.viewerSeat === null || !snapshot.sitOutSeats?.includes(snapshot.viewerSeat)) {
      return '';
    }
    return this.button('sit-in', '', t('hudChrome.pokerPlaytest.sitIn'), connected, true);
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
    this.armRender(1_000);
  }

  private armRender(delayMs: number): void {
    this.timer = this.deps.schedule(
      () => {
        this.timer = null;
        this.render();
      },
      Math.max(1, Math.ceil(delayMs)),
    );
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
      return this.wagerMarkup(action, index, connected, label);
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

  private wagerMarkup(
    action: PokerPlaytestView['actions'][number],
    index: number,
    connected: boolean,
    label: string,
  ): string {
    if (action.kind !== 'bet' && action.kind !== 'raise') return '';
    const min = action.minTo ?? 1;
    const max = action.maxTo ?? min;
    const value = Number(this.wagerDraft.get(action.kind) ?? min);
    const amountLabel = t('hudChrome.pokerPlaytest.wagerAmount', { action: label });
    const blindMarker = t('hudChrome.pokerPlaytest.bigBlindMarker');
    const decrease = this.wagerStepButton(
      action.kind,
      index,
      'decrease',
      `- 1 ${blindMarker}`,
      connected && value > min,
    );
    const increase = this.wagerStepButton(
      action.kind,
      index,
      'increase',
      `+ 1 ${blindMarker}`,
      connected && value < max,
    );
    const output = `<output class=poker-wager-value data-wager=${index} data-wager-kind=${action.kind} data-wager-value=${value} aria-live=polite>${esc(formatNumber(value))}</output>`;
    const submit = `<button type=button class=poker-action data-action=${index} data-focus-key=action-${action.kind}${connected ? '' : ' disabled'}>${esc(label)}</button>`;
    return `<div class=poker-wager><span>${esc(label)}</span><div class=poker-wager-stepper role=group aria-label='${esc(amountLabel)}'>${decrease}${output}${increase}</div>${submit}</div>`;
  }

  private wagerStepButton(
    kind: 'bet' | 'raise',
    index: number,
    direction: 'decrease' | 'increase',
    ariaLabel: string,
    enabled: boolean,
  ): string {
    const symbol = direction === 'increase' ? '+' : '-';
    return `<button type=button class=poker-wager-step data-wager=${index} data-wager-kind=${kind} data-wager-step=${direction} data-focus-key=wager-${kind}-${direction} aria-label='${esc(ariaLabel)}'${enabled ? '' : ' disabled'}>${symbol}</button>`;
  }

  private cards(values: string[], hidden = false): string {
    if (!values.length) {
      return hidden
        ? `<span class='poker-card back' aria-hidden=true></span><span class='poker-card back' aria-hidden=true></span>`
        : esc(t('hudChrome.pokerPlaytest.noCards'));
    }
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
    root.querySelector('[data-sit-in]')?.addEventListener('click', () => {
      const id = this.currentTable();
      if (id) this.deps.client.sitIn?.(id);
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
    root.querySelectorAll<HTMLElement>('[data-wager-step]').forEach((button) => {
      button.addEventListener('click', () => this.stepWager(root, button));
    });
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
            ? root.querySelector<HTMLOutputElement>(`output[data-wager='${index}']`)?.dataset
                .wagerValue
            : undefined;
        const action = pokerActionFromInput(actionView, raw);
        if (!action) {
          this.invalidAmount = true;
          this.render();
          return;
        }
        this.invalidAmount = false;
        if (actionView.kind === 'check') this.deps.sound.check?.();
        if (actionView.kind === 'bet' || actionView.kind === 'raise') {
          this.wagerDraft.delete(actionView.kind);
        }
        this.wasPlayerTurn = false;
        this.deps.client.act(action);
      });
    });
  }

  private stepWager(root: HTMLElement, button: HTMLElement): void {
    const state = this.deps.client.pokerState();
    if (!state.connected || !state.snapshot) return;
    const index = Number(button.dataset.wager);
    const action = buildPokerPlaytestView(state.snapshot, state.snapshot.viewerSeat).actions[index];
    if (!action || (action.kind !== 'bet' && action.kind !== 'raise')) return;
    const output = root.querySelector<HTMLOutputElement>(`output[data-wager='${index}']`);
    const current = Number(output?.dataset.wagerValue);
    const direction = button.dataset.wagerStep === 'increase' ? 1 : -1;
    const next = stepPokerWager(action, current, state.snapshot.config.bigBlind, direction);
    if (next === null) return;
    this.invalidAmount = false;
    if (output) output.dataset.wagerValue = String(next);
    this.wagerDraft.set(action.kind, String(next));
    this.render();
  }

  private captureWagerDraft(root: HTMLElement): void {
    root.querySelectorAll<HTMLOutputElement>('output[data-wager-kind]').forEach((output) => {
      const kind = output.dataset.wagerKind;
      const value = output.dataset.wagerValue;
      if ((kind === 'bet' || kind === 'raise') && value !== undefined) {
        this.wagerDraft.set(kind, value);
      }
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
