// Companion Home shell: session restore, login, load home data, spin.

import { EconomyClient } from '../net/economy_sdk';
import { Api } from '../net/online';
import { applySpinResult, buildHomeModel, type CompanionHomeModel } from './home_model';
import { type CompanionT, renderHome, renderLoading, renderLogin } from './home_render';

export interface CompanionAppOptions {
  root: HTMLElement;
  t: CompanionT;
  playUrl?: string;
  api?: Api;
}

export class CompanionApp {
  private readonly root: HTMLElement;
  private readonly t: CompanionT;
  private readonly playUrl: string;
  private readonly api: Api;
  private readonly economy: EconomyClient;
  private home: CompanionHomeModel | null = null;
  private spinning = false;
  private busy = false;

  constructor(opts: CompanionAppOptions) {
    this.root = opts.root;
    this.t = opts.t;
    this.playUrl = opts.playUrl ?? '/play';
    this.api = opts.api ?? new Api();
    this.economy = new EconomyClient({
      token: () => this.api.token,
      base: '',
    });
  }

  async start(): Promise<void> {
    renderLoading(this.root, this.t);
    const restored = this.api.restoreSession();
    if (!restored || !this.api.token) {
      this.showLogin(null);
      return;
    }
    try {
      await this.api.getAccount();
      await this.loadHome();
    } catch {
      this.api.clearSession();
      this.showLogin(this.t('companion.login.sessionExpired'));
    }
  }

  private showLogin(error: string | null): void {
    renderLogin(
      this.root,
      this.t,
      (username, password) => {
        void this.login(username, password);
      },
      error,
      this.busy,
    );
  }

  private async login(username: string, password: string): Promise<void> {
    if (!username || !password) {
      this.showLogin(this.t('companion.login.missingFields'));
      return;
    }
    this.busy = true;
    this.showLogin(null);
    try {
      const result = await this.api.login(username, password);
      if ('twoFactorRequired' in result && result.twoFactorRequired) {
        this.busy = false;
        this.showLogin(this.t('companion.login.twoFactor'));
        return;
      }
      this.api.saveSession();
      this.busy = false;
      await this.loadHome();
    } catch (error) {
      this.busy = false;
      this.showLogin(error instanceof Error ? error.message : this.t('companion.login.failed'));
    }
  }

  private async loadHome(): Promise<void> {
    renderLoading(this.root, this.t);
    const username = this.api.username ?? 'player';
    try {
      const [characters, daily, claudium] = await Promise.all([
        this.api.characters(),
        this.api.dailyRewards(),
        this.economy.balance(),
      ]);
      this.home = buildHomeModel({
        username,
        characters,
        daily,
        claudium,
        playUrl: this.playUrl,
      });
      this.paintHome();
    } catch (error) {
      this.showLogin(error instanceof Error ? error.message : this.t('companion.home.loadFailed'));
    }
  }

  private paintHome(): void {
    if (!this.home) return;
    renderHome(
      this.root,
      this.home,
      this.t,
      {
        onSpin: () => {
          void this.spin();
        },
        onRefresh: () => {
          void this.loadHome();
        },
        onLogout: () => {
          this.api.clearSession();
          this.home = null;
          this.showLogin(null);
        },
      },
      this.spinning,
    );
  }

  private async spin(): Promise<void> {
    if (!this.home || this.home.spin.kind !== 'ready' || this.spinning) return;
    this.spinning = true;
    this.paintHome();
    try {
      const result = await this.api.spinDailyReward();
      this.home = applySpinResult(this.home, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : this.t('companion.home.spinFailed');
      // Re-paint with error as eligibility-style banner: reload full status.
      await this.loadHome();
      if (this.home) {
        const banner = document.createElement('p');
        banner.className = 'companion-error';
        banner.textContent = message;
        this.root.querySelector('.companion-hero')?.append(banner);
      }
      this.spinning = false;
      return;
    }
    this.spinning = false;
    this.paintHome();
  }
}
