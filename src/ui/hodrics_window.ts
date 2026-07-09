// Thin DOM painter for the Hodric's Castle Gauntlet window (the Herald's
// race desk): queue join/leave, standings, and the offline practice race.
//
// The consumer half of the pure-core + thin-painter split (arena_window.ts
// shape): it paints #hodrics-window from the structured HcWindowView
// (hodrics_window_view.ts), owns the render-skip signature and the WCAG focus
// opener, and wires queue / leave / practice / close back through IWorld +
// injected callbacks. Redraws while open from hud.update()'s mediumHud band,
// skipping the DOM rebuild when the content signature is unchanged.

import { audio } from '../game/audio';
import type { IWorld } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { buildHcWindowView, type HcWindowView } from './hodrics_window_view';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

// Render-skip sentinel for the offline note (see arena_window.ts for why a
// non-'[' token can never collide with a live JSON signature).
const HC_OFFLINE_SIG = 'hc-offline';

export interface HodricsWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

export class HodricsWindow {
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  // Offline only: hook that spins up a practice race vs the court (null online).
  private practiceHook: (() => void) | null = null;

  constructor(private readonly deps: HodricsWindowDeps) {}

  /** Wire the offline practice hook (left null online, which hides it). */
  setPracticeHook(fn: (() => void) | null): void {
    this.practiceHook = fn;
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
    markDialogRoot(root, { labelledBy: 'hodrics-title' });
    root.style.display = 'block';
    this.lastSig = '';
    this.render();
    (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    el.style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /** Re-localize the open window after a language switch (one forced rebuild). */
  relocalize(): void {
    if (!this.isOpen) return;
    this.lastSig = '';
    this.render();
  }

  render(): void {
    const world = this.deps.world();
    const el = this.deps.root();
    const view = buildHcWindowView({
      info: world.hcInfo,
      practiceAvailable: this.practiceHook !== null,
    });

    if (view.kind === 'offline') {
      if (this.lastSig === HC_OFFLINE_SIG) return;
      this.lastSig = HC_OFFLINE_SIG;
      el.innerHTML =
        this.titleHtml() + `<div class="arena-note">${esc(t('hudChrome.hc.offlineNote'))}</div>`;
      el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
      return;
    }

    if (view.sig === this.lastSig) return;
    this.lastSig = view.sig;
    el.innerHTML = this.liveHtml(view);
    this.wire(el);
  }

  private wire(el: HTMLElement): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.querySelector('[data-act="queue"]')?.addEventListener('click', () => {
      this.deps.world().hcQueueJoin();
      audio.click();
    });
    el.querySelector('[data-act="leave"]')?.addEventListener('click', () => {
      this.deps.world().hcQueueLeave();
      audio.click();
    });
    el.querySelector('[data-act="practice"]')?.addEventListener('click', () => {
      this.practiceHook?.();
      this.lastSig = '';
      audio.click();
    });
  }

  private titleHtml(): string {
    return `<div class="panel-title"><span id="hodrics-title">${esc(t('hudChrome.hc.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.hc.close'))}">${svgIcon('close')}</button></div>`;
  }

  private liveHtml(view: Extract<HcWindowView, { kind: 'live' }>): string {
    const howto = `<div class="arena-note">${esc(t('hudChrome.hc.howto'))}</div>`;
    let standing = '';
    if (view.standing) {
      const best =
        view.standing.best !== null
          ? t('hudChrome.hc.bestTime', {
              seconds: formatNumber(view.standing.best, { maximumFractionDigits: 1 }),
            })
          : t('hudChrome.hc.bestNone');
      standing =
        `<div class="hc-standing">` +
        `<span>${esc(
          t('hudChrome.hc.record', {
            wins: formatNumber(view.standing.wins, { maximumFractionDigits: 0 }),
            races: formatNumber(view.standing.races, { maximumFractionDigits: 0 }),
          }),
        )}</span>` +
        `<span>${esc(best)}</span></div>`;
    }
    let action: string;
    if (view.action.kind === 'in-match') {
      action = `<div class="arena-note">${esc(t('hudChrome.hc.inMatchNote'))}</div>`;
    } else if (view.action.kind === 'queued') {
      action =
        `<div class="hc-queued">${esc(
          t('hudChrome.hc.queuedAt', {
            position: formatNumber(view.action.position, { maximumFractionDigits: 0 }),
          }),
        )}</div>` +
        `<button class="btn" data-act="leave">${esc(t('hudChrome.hc.leaveQueue'))}</button>`;
    } else {
      action = `<button class="btn" data-act="queue">${esc(t('hudChrome.hc.joinQueue'))}</button>`;
    }
    const practice = view.practice
      ? `<button class="btn" data-act="practice">${esc(t('hudChrome.hc.practice'))}</button>` +
        `<div class="arena-note">${esc(t('hudChrome.hc.practiceNote'))}</div>`
      : '';
    return (
      this.titleHtml() + howto + standing + `<div class="hc-actions">${action}${practice}</div>`
    );
  }
}
