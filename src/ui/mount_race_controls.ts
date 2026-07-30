// Show-jumping race HUD controls: the bottom Start/Cancel Race button above the
// player frame and the raised center-screen 3..2..1..GO countdown. A thin
// DOM painter (the MountRaceStrip precedent); hud.ts owns the event routing and
// wires this to IWorld. Every player-visible string renders through the
// hudChrome.mountRace.* t() keys; the countdown digits go through formatNumber.

import { TICK_RATE } from '../sim/types';
import type { MountRaceView } from '../world_api';
import { formatNumber, t } from './i18n';

export interface MountRaceControlsDeps {
  /** The authoritative self race view (world.mountRaceView()), or null when idle. */
  getState(): MountRaceView | null;
  /** Whether the self player is standing on the shared start platform and may
   *  surface the Start Race action. The server still re-validates. */
  canStart(): boolean;
  /** Begin a race (world.mountRaceStart()); the server re-validates. */
  startRace(): void;
  /** Exit the active countdown or lap. */
  cancelRace(): void;
}

// Hold "GO!" for the first ~0.8s of the lap, then clear the countdown. Measured
// off the lap timer (no wall clock), so it is host-agnostic.
const GO_HOLD_TICKS = 16;

const NUM0 = { maximumFractionDigits: 0 } as const;

export class MountRaceControls {
  private readonly startButton: HTMLButtonElement | null;
  private readonly countdown: HTMLElement | null;
  private lastButtonVisible: boolean | null = null;
  private buttonMode: 'hidden' | 'start' | 'cancel' = 'hidden';
  private lastCountdownMode: 'hidden' | 'countdown' | 'go' | null = null;
  private lastCountdownNumber = -1;

  constructor(private readonly deps: MountRaceControlsDeps) {
    this.startButton = document.getElementById('race-start-btn') as HTMLButtonElement | null;
    this.countdown = document.getElementById('race-countdown');
    this.startButton?.addEventListener('click', () => {
      if (this.buttonMode === 'start') this.deps.startRace();
      else if (this.buttonMode === 'cancel') this.deps.cancelRace();
    });
  }

  /** Per-frame realign to authoritative state: the Start Race button visibility
   *  and the center-screen countdown / GO flash. Cheap: only touches style/text. */
  // Re-localize after an in-game language switch. The gates here are a
  // visibility flag, a countdown mode and the countdown NUMBER, none of which
  // move when the locale does, so the Start/Cancel label and the GO text would
  // stay in the old language. Clearing the memos forces one repaint with fresh
  // t(); update() self-gates, so this is safe to call unconditionally.
  relocalize(): void {
    this.lastButtonVisible = null;
    this.lastCountdownMode = null;
    this.lastCountdownNumber = -1;
    this.update();
  }

  update(): void {
    const view = this.deps.getState();
    this.paintButton(
      view?.phase === 'countdown' ? 'cancel' : !view && this.deps.canStart() ? 'start' : 'hidden',
    );
    if (!view) {
      this.paintCountdown('hidden');
      return;
    }
    if (view.phase === 'countdown') {
      // 3, 2, 1 (never 0: it flips to GO at the boundary).
      const n = Math.max(1, Math.ceil(view.goTicksLeft / TICK_RATE));
      this.paintCountdown('countdown', n);
      return;
    }
    // Racing: flash GO! for the opening moment, then clear.
    const elapsed = view.timeLimitTicks - view.ticksLeft;
    if (elapsed <= GO_HOLD_TICKS) {
      this.paintCountdown('go');
    } else {
      this.paintCountdown('hidden');
    }
  }

  private paintButton(mode: 'hidden' | 'start' | 'cancel'): void {
    const button = this.startButton;
    if (!button || mode === this.buttonMode) return;
    this.buttonMode = mode;
    const visible = mode !== 'hidden';
    if (visible !== this.lastButtonVisible) {
      button.style.display = visible ? 'block' : 'none';
      this.lastButtonVisible = visible;
    }
    if (!visible) return;
    const label = t(
      mode === 'cancel' ? 'hudChrome.mountRace.cancelButton' : 'hudChrome.mountRace.startButton',
    );
    button.textContent = label;
    button.setAttribute('aria-label', label);
    button.classList.toggle('is-cancel', mode === 'cancel');
  }

  private paintCountdown(mode: 'hidden' | 'countdown' | 'go', n = -1): void {
    const el = this.countdown;
    if (!el) return;
    if (
      mode === this.lastCountdownMode &&
      (mode !== 'countdown' || n === this.lastCountdownNumber)
    ) {
      return;
    }
    this.lastCountdownMode = mode;
    this.lastCountdownNumber = n;
    if (mode === 'hidden') {
      el.style.display = 'none';
      el.classList.remove('rc-go');
      return;
    }
    if (mode === 'countdown') {
      el.textContent = formatNumber(n, NUM0);
      el.classList.remove('rc-go');
    } else {
      el.textContent = t('hudChrome.mountRace.go');
      el.classList.add('rc-go');
    }
    el.style.display = 'flex';
  }

  /** Race ended / left: clear the countdown (the button reappears via update). */
  hide(): void {
    this.paintCountdown('hidden');
    this.paintButton(this.deps.canStart() ? 'start' : 'hidden');
  }
}
