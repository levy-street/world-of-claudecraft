// Show-jumping race bottom strip: the thin DOM consumer for the Highwatch
// paddock race (paints #mount-race-strip). Mirrors the vendor_window.ts split:
// this module owns paint; hud.ts owns the event routing, the start/finish
// banners, and the strip's show/hide. It composes the pure view model in
// mount_race_view.ts and renders every player-visible string through the
// hudChrome.mountRace.* t() keys.
//
// The strip is a slim, NON-INTERACTIVE readout anchored above the player frame
// (pointer-events none, no buttons). It intentionally shows only the loader bar
// and seconds remaining.

import { TICK_RATE } from '../sim/types';
import type { MountRaceView } from '../world_api';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { mountRaceRenderModel } from './mount_race_view';

/** Reads the strip needs from the HUD. It never imports Hud or a concrete
 *  world; the HUD wires this to IWorld. */
export interface MountRaceStripDeps {
  /** The authoritative self view (world.mountRaceView()), or null when idle. */
  getState(): MountRaceView | null;
}

const NUM0 = { maximumFractionDigits: 0 } as const;

export class MountRaceStrip {
  private readonly element: HTMLElement | null;
  private lastRaceId = '';
  private lastPhase: MountRaceView['phase'] | null = null;
  private lastSecond = -1;

  constructor(private readonly deps: MountRaceStripDeps) {
    this.element = document.getElementById('mount-race-strip');
  }

  /** First paint of a freshly started race. */
  show(): void {
    this.resetSignature();
    const view = this.deps.getState();
    if (view) this.render(view);
  }

  /** Per-frame safety net, mirroring lockpick's repaintIfChanged: realign the
   *  DOM to authoritative state (the countdown mostly). Cheap: repaints only on
   *  a sig change (bucketed to whole seconds). */
  // Re-localize after an in-game language switch. The repaint gate is the race
  // id, the phase and the whole SECOND remaining, all text-independent, so a
  // language change never moves it on its own and the strip would keep the old
  // locale until the clock ticked. Clearing the memo forces exactly one repaint
  // with fresh t(). Unconditional-call safe: repaintIfChanged self-gates on there
  // being a live race.
  relocalize(): void {
    this.lastRaceId = '';
    this.lastPhase = null;
    this.lastSecond = -1;
    this.repaintIfChanged();
  }

  repaintIfChanged(): void {
    const el = this.element;
    if (!el || el.style.display === 'none') return;
    const view = this.deps.getState();
    if (!view) return;
    const second = Math.ceil(view.ticksLeft / TICK_RATE);
    if (
      view.raceId !== this.lastRaceId ||
      view.phase !== this.lastPhase ||
      second !== this.lastSecond
    ) {
      this.render(view, second);
    }
  }

  private render(view: MountRaceView, second = Math.ceil(view.ticksLeft / TICK_RATE)): void {
    const el = this.element;
    if (!el) return;
    this.lastRaceId = view.raceId;
    this.lastPhase = view.phase;
    this.lastSecond = second;
    const m = mountRaceRenderModel(view);
    if (!m.active) return;

    if (m.secondsLeft != null) {
      const pct = Math.round((m.timeFraction ?? 0) * 100);
      const secText = t('hudChrome.mountRace.timeLeft', {
        seconds: formatNumber(m.secondsLeft, NUM0),
      });
      el.innerHTML =
        `<span class="mr-timer"><span class="mr-timer-bar" style="width:${pct}%"></span></span>` +
        `<span class="mr-secs">${esc(secText)}</span>`;
    }
  }

  /** Tear down on strip hide: forget the last paint. */
  hide(): void {
    this.resetSignature();
  }

  private resetSignature(): void {
    this.lastRaceId = '';
    this.lastPhase = null;
    this.lastSecond = -1;
  }
}
