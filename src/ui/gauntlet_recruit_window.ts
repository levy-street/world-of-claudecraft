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
  onJoinQueue(): void;
  onSpectate(): void;
  onPractice(): void;
  onLeave(): void;
}

/** The live status the window renders from (Hud feeds it per frame while open). */
export interface GauntletRecruitStatus {
  eventOpen: boolean;
  run: GauntletRunView | null;
  queuePosition: number; // 1-based place in the rolling queue, 0 when not queued
  spectating: boolean; // free-roaming spectator (distinct from a knocked-out contestant)
  time: number;
}

export class GauntletRecruitWindow {
  private openerFocus: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private countdownEl: HTMLElement | null = null;
  private noteEl: HTMLElement | null = null;
  // The primary action button: it re-labels per state and dispatches join-queue
  // when idle, else the unified leave (dequeue / withdraw / stop spectating). The
  // spectate + practice buttons only show in the idle state.
  private primaryBtn: HTMLButtonElement | null = null;
  private spectateBtn: HTMLButtonElement | null = null;
  private practiceBtn: HTMLButtonElement | null = null;
  // What the primary button currently dispatches, so its one click listener stays
  // stable across per-frame relabels.
  private primaryMode: 'joinQueue' | 'leave' = 'joinQueue';

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
    this.primaryBtn?.focus();
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

  /**
   * Per-frame refresh while open. Five states drive the buttons + status:
   *  - spectating: [Stop Spectating]
   *  - queued:     [Leave the Queue] + queue position
   *  - in a filling lobby: [Withdraw] + lobby countdown
   *  - in a live run (staging..podium): [Leave] (forfeit)
   *  - idle:       [Join the Queue] [Spectate] [Practice] + practice note
   */
  update(status: GauntletRecruitStatus): void {
    if (!this.isOpen) return;
    const spectating = status.spectating;
    const queued = status.queuePosition > 0;
    const inLobby = !spectating && status.run?.phase === 'lobby';
    const inRun = !spectating && !!status.run && !inLobby;
    const idle = !spectating && !queued && !status.run;

    // The primary button: join the queue only in the idle state, else a leave.
    this.primaryMode = idle ? 'joinQueue' : 'leave';
    if (this.primaryBtn) {
      const label = spectating
        ? 'hudChrome.gauntlet.stopSpectating'
        : queued
          ? 'hudChrome.gauntlet.leaveQueue'
          : inLobby
            ? 'hudChrome.gauntlet.withdraw'
            : inRun
              ? 'hudChrome.gauntlet.leave'
              : 'hudChrome.gauntlet.joinQueue';
      this.primaryBtn.textContent = t(label as TranslationKey);
      this.primaryBtn.disabled = idle && !status.eventOpen;
    }
    // Spectate + Practice are only offered from the idle state. Practice is always
    // enabled (an always-on training harness); Spectate needs the event open.
    if (this.spectateBtn) {
      this.spectateBtn.hidden = !idle;
      this.spectateBtn.disabled = !status.eventOpen;
      this.spectateBtn.textContent = t('hudChrome.gauntlet.spectate');
    }
    if (this.practiceBtn) {
      this.practiceBtn.hidden = !idle;
      this.practiceBtn.textContent = t('hudChrome.gauntlet.practice');
    }
    if (this.noteEl) {
      this.noteEl.hidden = !idle;
      this.noteEl.textContent = t('hudChrome.gauntlet.practiceNote');
    }

    if (this.statusEl && this.countdownEl) {
      if (queued) {
        this.statusEl.textContent = t('hudChrome.gauntlet.queuePosition', {
          n: formatNumber(status.queuePosition, INT),
        });
        this.statusEl.hidden = false;
        this.countdownEl.hidden = true;
      } else if (inLobby && status.run) {
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
      `<div class="gr-actions">` +
      `<button type="button" class="btn gr-action gr-primary"></button>` +
      `<button type="button" class="btn gr-spectate" hidden></button>` +
      `<button type="button" class="btn gr-practice" hidden></button>` +
      `</div>` +
      `<div class="gr-note" hidden></div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.statusEl = el.querySelector('.gr-status');
    this.countdownEl = el.querySelector('.gr-countdown');
    this.noteEl = el.querySelector('.gr-note');
    this.primaryBtn = el.querySelector('.gr-primary');
    this.spectateBtn = el.querySelector('.gr-spectate');
    this.practiceBtn = el.querySelector('.gr-practice');
    // Stable listeners; update() only relabels + toggles visibility, so the focus
    // trap and these handlers survive the per-frame refresh.
    this.primaryBtn?.addEventListener('click', () => {
      if (this.primaryMode === 'joinQueue') this.deps.onJoinQueue();
      else this.deps.onLeave();
    });
    this.spectateBtn?.addEventListener('click', () => this.deps.onSpectate());
    this.practiceBtn?.addEventListener('click', () => this.deps.onPractice());
  }
}
