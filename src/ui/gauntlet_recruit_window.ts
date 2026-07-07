// The Gauntlet recruiter dialog (Maro Half-Mask, the Herald). A small `.window`
// panel the player opens by interacting with the recruiter NPC: it pitches the
// event, shows the live lobby status while a lobby is filling, and offers one
// action button that is Join while the player is out of the run and Withdraw while
// they wait in the lobby. Hud owns the open/close orchestration and the focus
// bridge (windowFocus); this module renders one panel and reports back through the
// injected deps, holding no Sim reference.
//
// It builds its structure once on open (stable Close + action buttons, wired once)
// and refreshes only the dynamic status text + action label per frame, so the
// focus trap and listeners survive the live lobby countdown.

import type { GauntletRunView } from '../world_api/gauntlet';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { svgIcon } from './ui_icons';

const INT = { maximumFractionDigits: 0 } as const;

/** Hud-supplied glue; the window reaches into Hud only through these. */
export interface GauntletRecruitWindowDeps {
  root(): HTMLElement;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onJoin(): void;
  onLeave(): void;
}

/** The live status the window renders from (Hud feeds it per frame while open). */
export interface GauntletRecruitStatus {
  eventOpen: boolean;
  run: GauntletRunView | null;
  time: number;
}

export class GauntletRecruitWindow {
  private openerFocus: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private countdownEl: HTMLElement | null = null;
  private actionBtn: HTMLButtonElement | null = null;
  // Which action the button currently dispatches (join vs withdraw), so the single
  // click listener stays stable across per-frame relabels.
  private mode: 'join' | 'withdraw' = 'join';

  constructor(private readonly deps: GauntletRecruitWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  open(status: GauntletRecruitStatus): void {
    // Capture the opener BEFORE closing siblings so their focus-return cannot
    // clobber the element we restore to on close (WCAG 2.4.3).
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.build();
    this.deps.root().style.display = 'block';
    this.deps.root().dataset.windowOpen = '1';
    this.update(status);
    this.actionBtn?.focus();
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    el.style.display = 'none';
    delete el.dataset.windowOpen;
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /** Per-frame refresh while open: the action mode + the lobby status text. */
  update(status: GauntletRecruitStatus): void {
    if (!this.isOpen) return;
    const inLobby = status.run?.phase === 'lobby';
    this.mode = inLobby ? 'withdraw' : 'join';
    if (this.actionBtn) {
      this.actionBtn.textContent = inLobby
        ? t('hudChrome.gauntlet.withdraw')
        : t('hudChrome.gauntlet.join');
      this.actionBtn.disabled = !inLobby && !status.eventOpen;
    }
    if (this.statusEl && this.countdownEl) {
      if (inLobby && status.run) {
        const seconds = Math.max(0, Math.ceil(status.run.endsAt - status.time));
        this.statusEl.textContent = t('hudChrome.gauntlet.lobbyJoined', {
          count: formatNumber(status.run.survivors, INT),
        });
        this.countdownEl.textContent = t('hudChrome.gauntlet.lobbyCountdown', {
          seconds: formatNumber(seconds, INT),
        });
        this.statusEl.hidden = false;
        this.countdownEl.hidden = false;
      } else {
        this.statusEl.hidden = true;
        this.countdownEl.hidden = true;
      }
    }
  }

  private build(): void {
    const el = this.deps.root();
    markDialogRoot(el, { labelledBy: 'gauntlet-recruit-title' });
    const title: TranslationKey = 'hudChrome.gauntlet.title';
    const close: TranslationKey = 'questUi.dialog.close';
    const pitch: TranslationKey = 'hudChrome.gauntlet.pitch';
    el.innerHTML =
      `<div class="panel-title"><span id="gauntlet-recruit-title">${esc(t(title))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t(close))}">${svgIcon('close')}</button></div>` +
      `<div class="gr-pitch">${esc(t(pitch))}</div>` +
      `<div class="gr-status" role="status" hidden></div>` +
      `<div class="gr-countdown" role="status" hidden></div>` +
      `<div class="gr-actions"><button type="button" class="btn gr-action"></button></div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.statusEl = el.querySelector('.gr-status');
    this.countdownEl = el.querySelector('.gr-countdown');
    this.actionBtn = el.querySelector('.gr-action');
    this.actionBtn?.addEventListener('click', () => {
      if (this.mode === 'withdraw') this.deps.onLeave();
      else this.deps.onJoin();
    });
  }
}
