import type { DailyRewardHistory, DailyRewardStatus, IWorld } from '../world_api';
import { buildDailyRewardsView, type DailyRewardsView } from './daily_rewards_view';
import { esc } from './esc';
import { formatDateTime, formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';
import { ensureWindowFrame } from './window_frame_mount';
import type { WindowFrameDescriptor } from './window_frame_view';

// A closable, tab-less frame: the reward summary, spin wheel, tasks, leaderboard,
// and history stack in one scrollable body. The spin control stays coupled to its
// in-body wheel visual (not lifted into a sticky footer), so the frame carries no
// footer. Title + close keys are reused from the existing dailyRewards catalog.
const DAILY_FRAME: WindowFrameDescriptor = {
  id: 'daily-rewards-window',
  titleKey: 'hudChrome.dailyRewards.title',
  closeLabelKey: 'hudChrome.dailyRewards.close',
};

function reasonText(eligibility: DailyRewardStatus['eligibility']): string {
  switch (eligibility.reason) {
    case 'eligible':
      return t('hudChrome.dailyRewards.reason.eligible');
    case 'no_wallet':
      return t('hudChrome.dailyRewards.reason.no_wallet');
    case 'under_minimum':
      return t('hudChrome.dailyRewards.reason.under_minimum');
    case 'price_unavailable':
      return t('hudChrome.dailyRewards.reason.price_unavailable');
    case 'banned':
      return t('hudChrome.dailyRewards.reason.banned', {
        reason: eligibility.banReason ?? t('hudChrome.dailyRewards.unknown'),
      });
  }
}

export interface DailyRewardsWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onVisibilityChange?(): void;
  onStatus?(status: DailyRewardStatus): void;
  onWalletConnect?(): void;
  showChestButton?(): boolean;
  setShowChestButton?(show: boolean): void;
  confirmDialog?(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
}

export class DailyRewardsWindow {
  private openerFocus: HTMLElement | null = null;
  private poll: number | null = null;
  private countdownPoll: number | null = null;
  private renderSeq = 0;
  private lastHistory: DailyRewardHistory = { payouts: [] };
  private spinOverlay: HTMLElement | null = null;

  private readonly wheelValues = [20, 30, 40, 50, 75, 100, 150, 250];

  constructor(private readonly deps: DailyRewardsWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    const root = this.deps.root();
    root.style.display = 'block';
    this.deps.onVisibilityChange?.();
    this.ensureShell();
    void this.render('open');
    this.poll = window.setInterval(() => {
      if (this.isOpen) void this.render(null);
    }, 15_000);
    this.countdownPoll = window.setInterval(() => {
      if (this.isOpen) this.paintCountdowns();
    }, 30_000);
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    if (this.poll !== null) {
      window.clearInterval(this.poll);
      this.poll = null;
    }
    if (this.countdownPoll !== null) {
      window.clearInterval(this.countdownPoll);
      this.countdownPoll = null;
    }
    root.style.display = 'none';
    this.closeSpinOverlay();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onVisibilityChange?.();
  }

  async render(focus: 'open' | null = null): Promise<void> {
    const root = this.deps.root();
    const seq = ++this.renderSeq;
    this.ensureShell();
    if (focus === 'open')
      (root.querySelector('[data-window-close]') as HTMLElement | null)?.focus();
    let status: DailyRewardStatus | null = null;
    let history: DailyRewardHistory = { payouts: [] };
    try {
      status = await this.deps.world().dailyRewards();
      history = await this.deps.world().dailyRewardHistory();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'daily rewards unavailable';
      if (seq === this.renderSeq) this.paint(buildDailyRewardsView({ kind: 'error', message }));
      return;
    }
    if (!this.isOpen || seq !== this.renderSeq) return;
    this.lastHistory = history;
    this.deps.onStatus?.(status);
    this.paint(buildDailyRewardsView({ kind: 'status', status, history }));
    this.paintCountdowns();
  }

  private ensureShell(): void {
    const root = this.deps.root();
    // The shared frame owns the titlebar + close (dialog role/aria live on the
    // inner mount, so #daily-rewards-window stays a plain .window.panel); the
    // reward body is repainted into its scrollable window-body.
    const { body } = ensureWindowFrame(root, DAILY_FRAME, { onClose: () => this.close() });
    if (!body.querySelector('.dr-body')) body.innerHTML = this.loadingHtml();
  }

  private paint(view: DailyRewardsView): void {
    const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
    if (!body) return;
    if (view.kind === 'loading') {
      body.innerHTML = `<div class="dr-empty" role="status">${esc(t('hudChrome.dailyRewards.loading'))}</div>`;
      return;
    }
    if (view.kind === 'error') {
      body.innerHTML = `<div class="dr-empty dr-error" role="alert">${esc(t('hudChrome.dailyRewards.error'))}</div>`;
      return;
    }
    body.innerHTML =
      this.summaryHtml(view) +
      this.walletHtml(view) +
      this.spinHtml(view) +
      this.tasksHtml(view) +
      this.leaderboardHtml(view.status) +
      this.historyHtml(view.history);
    body.querySelector<HTMLButtonElement>('[data-spin]')?.addEventListener('click', () => {
      void this.spin();
    });
    body
      .querySelector<HTMLButtonElement>('[data-wallet-connect]')
      ?.addEventListener('click', () => {
        this.deps.onWalletConnect?.();
      });
    body.querySelector<HTMLButtonElement>('[data-chest-toggle]')?.addEventListener('click', () => {
      if (this.showChestButton()) {
        // Hiding the HUD shortcut is easy to trigger by accident amid the task
        // list and not obviously reversible, so confirm before persisting it.
        this.deps.confirmDialog?.(
          t('hudChrome.dailyRewards.hideChestConfirmTitle'),
          t('hudChrome.dailyRewards.hideChestConfirmBody'),
          t('hudChrome.dailyRewards.hideChestConfirmOk'),
          t('hudChrome.dailyRewards.hideChestConfirmCancel'),
          () => {
            this.deps.setShowChestButton?.(false);
            this.paint(view);
          },
        );
        return;
      }
      this.deps.setShowChestButton?.(true);
      this.paint(view);
    });
  }

  private async spin(): Promise<void> {
    const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
    const button = body?.querySelector<HTMLButtonElement>('[data-spin]');
    if (button) button.disabled = true;
    try {
      const result = await this.deps.world().spinDailyReward();
      this.openSpinOverlay(result.awardedPoints);
      this.deps.onStatus?.(result);
      this.paint(
        buildDailyRewardsView({ kind: 'status', status: result, history: this.lastHistory }),
      );
    } catch {
      await this.render(null);
      return;
    }
  }

  private loadingHtml(): string {
    return `<div class="dr-body"><div class="dr-empty" role="status" aria-busy="true">${esc(t('hudChrome.dailyRewards.loading'))}</div></div>`;
  }

  private summaryHtml(view: Extract<DailyRewardsView, { kind: 'ready' }>): string {
    const s = view.status;
    const prize =
      s.prizePoolSol === null
        ? t('hudChrome.dailyRewards.unknown')
        : `${t('hudChrome.dailyRewards.sol', {
            amount: formatNumber(s.prizePoolSol, { maximumFractionDigits: 3 }),
          })} (${t('hudChrome.dailyRewards.usd', {
            amount: `$${formatNumber(s.prizePoolUsd, {
              maximumFractionDigits: 2,
              minimumFractionDigits: 2,
            })}`,
          })})`;
    const reset = formatDateTime(new Date(s.resetAt), { hour: 'numeric', minute: '2-digit' });
    const remaining = this.remainingText(s.resetAt);
    const value =
      s.eligibility.usdValue === null
        ? t('hudChrome.dailyRewards.unknown')
        : t('hudChrome.dailyRewards.usd', {
            amount: `$${formatNumber(s.eligibility.usdValue, { maximumFractionDigits: 2 })}`,
          });
    const reason = reasonText(s.eligibility);
    return (
      `<p class="dr-intro">${esc(t('hudChrome.dailyRewards.intro'))}</p>` +
      `<p class="dr-disclaimer">${esc(t('hudChrome.dailyRewards.disclaimer'))}</p>` +
      `<div class="dr-summary">` +
      `<div><span>${esc(t('hudChrome.dailyRewards.prize'))}</span><strong>${esc(prize)}</strong></div>` +
      `<div><span>${esc(t('hudChrome.dailyRewards.reset'))}</span><strong>${esc(reset)}</strong></div>` +
      `<div class="dr-countdown"><span data-daily-rewards-countdown="${esc(s.resetAt)}">${esc(t('hudChrome.dailyRewards.endsIn', { time: remaining }))}</span></div>` +
      `<div><span>${esc(t('hudChrome.dailyRewards.score'))}</span><strong>${formatNumber(s.score, { maximumFractionDigits: 0 })}</strong></div>` +
      `<div><span>${esc(t('hudChrome.dailyRewards.walletValue'))}</span><strong>${esc(value)}</strong></div>` +
      `<p class="${view.locked ? 'dr-lock' : 'dr-ok'}">${esc(reason)}</p>` +
      `</div>`
    );
  }

  private remainingText(resetAt: string): string {
    const ms = Date.parse(resetAt) - Date.now();
    const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
    if (totalMinutes < 1) return t('hudChrome.dailyRewards.remainingLessThanMinute');
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) {
      return t('hudChrome.dailyRewards.remainingMinutes', {
        minutes: formatNumber(minutes, { maximumFractionDigits: 0 }),
      });
    }
    return t('hudChrome.dailyRewards.remainingHoursMinutes', {
      hours: formatNumber(hours, { maximumFractionDigits: 0 }),
      minutes: formatNumber(minutes, { maximumFractionDigits: 0 }),
    });
  }

  private paintCountdowns(): void {
    const root = this.deps.root();
    root.querySelectorAll<HTMLElement>('[data-daily-rewards-countdown]').forEach((el) => {
      const resetAt = el.dataset.dailyRewardsCountdown;
      if (!resetAt) return;
      el.textContent = t('hudChrome.dailyRewards.endsIn', { time: this.remainingText(resetAt) });
    });
  }

  private spinHtml(view: Extract<DailyRewardsView, { kind: 'ready' }>): string {
    const spin = view.status.spin;
    const text = spin.claimed
      ? t('hudChrome.dailyRewards.spinClaimed', {
          points: formatNumber(spin.points ?? 0, { maximumFractionDigits: 0 }),
        })
      : t('hudChrome.dailyRewards.spinReady');
    return (
      `<section class="dr-section"><h3>${esc(t('hudChrome.dailyRewards.spinTitle'))}</h3>` +
      `<div class="dr-spin"><div class="dr-wheel">${esc(spin.claimed ? `+${formatNumber(spin.points ?? 0, { maximumFractionDigits: 0 })}` : '?')}</div>` +
      `<div><p>${esc(text)}</p><button type="button" class="lb-page-btn" data-spin ${view.locked || spin.claimed ? 'disabled' : ''}>${esc(t('hudChrome.dailyRewards.spinButton'))}</button></div></div></section>`
    );
  }

  private walletHtml(view: Extract<DailyRewardsView, { kind: 'ready' }>): string {
    if (!view.locked) return '';
    const reason = view.lockReason;
    if (reason === 'banned') return '';
    const title =
      reason === 'no_wallet'
        ? t('hudChrome.dailyRewards.walletConnectTitle')
        : t('hudChrome.dailyRewards.walletHoldTitle');
    const body =
      reason === 'no_wallet'
        ? t('hudChrome.dailyRewards.walletConnectBody')
        : reason === 'under_minimum'
          ? t('hudChrome.dailyRewards.walletHoldBody', {
              amount: formatNumber(view.status.eligibility.minUsd, { maximumFractionDigits: 0 }),
            })
          : t('hudChrome.dailyRewards.walletPriceBody');
    const button =
      reason === 'no_wallet'
        ? `<button type="button" class="lb-page-btn" data-wallet-connect>${esc(t('hudChrome.dailyRewards.walletConnectButton'))}</button>`
        : '';
    return (
      `<section class="dr-wallet-card">` +
      `<h3>${esc(title)}</h3>` +
      `<p>${esc(body)}</p>` +
      button +
      `</section>`
    );
  }

  private wheelLandingAngle(points: number): number {
    const index = Math.max(0, this.wheelValues.indexOf(points));
    const segment = 360 / this.wheelValues.length;
    const center = index * segment + segment / 2;
    return -center;
  }

  private openSpinOverlay(points: number): void {
    this.closeSpinOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'dr-spin-overlay open';
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeSpinOverlay();
    });
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) this.closeSpinOverlay();
    });
    const labels = this.wheelValues
      .map(
        (value, index) =>
          `<span style="--i:${index}">+${formatNumber(value, { maximumFractionDigits: 0 })}</span>`,
      )
      .join('');
    overlay.innerHTML =
      `<div class="dr-spin-stage" role="dialog" aria-modal="true" aria-label="${esc(t('hudChrome.dailyRewards.spinDialogTitle'))}">` +
      `<button type="button" class="x-btn dr-spin-close" data-spin-close aria-label="${esc(t('hudChrome.dailyRewards.spinClose'))}">${svgIcon('close')}</button>` +
      `<div class="dr-spin-pointer" aria-hidden="true"></div>` +
      `<div class="dr-spin-wheel-big" style="--land-angle:${this.wheelLandingAngle(points)}deg" aria-hidden="true">${labels}</div>` +
      `<div class="dr-spin-result" style="--tier-color:#ffe27a">` +
      `<span>${esc(t('hudChrome.dailyRewards.spinResult', { points: formatNumber(points, { maximumFractionDigits: 0 }) }))}</span>` +
      `<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>` +
      `<b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b>` +
      `</div></div>`;
    overlay
      .querySelector('[data-spin-close]')
      ?.addEventListener('click', () => this.closeSpinOverlay());
    document.body.appendChild(overlay);
    this.spinOverlay = overlay;
    (overlay.querySelector('[data-spin-close]') as HTMLElement | null)?.focus();
  }

  private closeSpinOverlay(): void {
    if (!this.spinOverlay) return;
    this.spinOverlay.remove();
    this.spinOverlay = null;
  }

  private tasksHtml(view: Extract<DailyRewardsView, { kind: 'ready' }>): string {
    const rows = view.status.tasks
      .map((task) => {
        const multiplier =
          typeof task.multiplier === 'number' && Number.isFinite(task.multiplier)
            ? `<em>${esc(t('hudChrome.dailyRewards.taskMultiplier', { multiplier: formatNumber(task.multiplier, { maximumFractionDigits: 2 }) }))}</em>`
            : '';
        return `<li class="${task.completed ? 'done' : ''}"><span>${esc(task.title)}</span><small><span>${esc(task.description)}</span>${multiplier}</small><b>${formatNumber(task.points, { maximumFractionDigits: 0 })}</b></li>`;
      })
      .join('');
    const chestToggle = this.showChestButton()
      ? t('hudChrome.dailyRewards.hideChestButton')
      : t('hudChrome.dailyRewards.showChestButton');
    return (
      `<section class="dr-section"><h3>${esc(t('hudChrome.dailyRewards.tasks'))}</h3>` +
      `<ul class="dr-tasks">${rows}</ul>` +
      `<button type="button" class="lb-page-btn dr-chest-toggle" data-chest-toggle>${esc(chestToggle)}</button>` +
      `</section>`
    );
  }

  private showChestButton(): boolean {
    return this.deps.showChestButton?.() ?? true;
  }

  private leaderboardHtml(status: DailyRewardStatus): string {
    const totalKey =
      status.leaderboardTotal === 1
        ? 'hudChrome.dailyRewards.totalPlayer'
        : 'hudChrome.dailyRewards.totalPlayers';
    const total = `<div class="dr-leaderboard-total">${esc(t(totalKey, { count: formatNumber(status.leaderboardTotal, { maximumFractionDigits: 0 }) }))}</div>`;
    const rows =
      status.leaderboard.length === 0
        ? `<div class="dr-empty">${esc(t('hudChrome.dailyRewards.noLeaders'))}</div>`
        : status.leaderboard
            .map(
              (row) =>
                `<div class="dr-rank${row.me ? ' mine' : ''}"><span>${row.rank}</span><b>${esc(row.name)}</b><strong>${formatNumber(row.points, { maximumFractionDigits: 0 })}</strong></div>`,
            )
            .join('');
    return `<section class="dr-section"><h3>${esc(t('hudChrome.dailyRewards.leaderboard'))}</h3>${total}<div class="dr-ranks dr-leaderboard-ranks">${rows}</div></section>`;
  }

  private historyHtml(history: DailyRewardHistory): string {
    const rows =
      history.payouts.length === 0
        ? `<div class="dr-empty">${esc(t('hudChrome.dailyRewards.noHistory'))}</div>`
        : history.payouts
            .slice(0, 10)
            .map((row) => {
              const prize = `$${t('hudChrome.dailyRewards.usd', {
                amount: formatNumber(row.prizeUsd, { maximumFractionDigits: 2 }),
              })}`;
              return `<div class="dr-rank"><span>${esc(row.day)} #${row.rank}</span><b>${esc(row.name)}</b><strong>${esc(prize)}</strong></div>`;
            })
            .join('');
    return `<section class="dr-section"><h3>${esc(t('hudChrome.dailyRewards.history'))}</h3><div class="dr-ranks">${rows}</div></section>`;
  }
}
