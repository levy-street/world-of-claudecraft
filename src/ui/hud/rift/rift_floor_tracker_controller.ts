// Thin, cold consumer of rift_floor_tracker_view.ts (issue #2655): paints the
// #rift-tracker strip only when its signature changes, mirroring the sibling
// DelveTrackerController recipe (src/ui/hud/delve/delve_tracker_controller.ts).
// No forced-reflow layout read, no repeating driver of its own: Hud.update()
// polls it on the mediumHud (~4Hz) band, plenty to catch every whole-second
// countdown tick without missing one.

import type { IWorld } from '../../../world_api';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { riftFloorTrackerModel, riftTimerParts } from './rift_floor_tracker_view';

export interface RiftFloorTrackerControllerDeps {
  element: HTMLElement;
  world(): Pick<IWorld, 'riftFloor' | 'riftEventMsRemaining'>;
}

const num = (n: number): string =>
  formatNumber(n, { maximumFractionDigits: 0, useGrouping: false });
const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Paints the rift floor + closing-timer tracker only when its visible state changes. */
export class RiftFloorTrackerController {
  private lastSignature = '';

  constructor(private readonly deps: RiftFloorTrackerControllerDeps) {}

  /**
   * Re-localize after an in-game language switch (the Hud's woc:languagechange
   * fan-out). Every member of the signature below is a number, so setLanguage
   * alone never moves it and a plain update() from the fan-out early-returns
   * with the old locale still on screen. Clearing forces exactly one rebuild.
   *
   * Needs no open check: update() paints only while a rift floor exists and
   * clears the strip when it does not.
   */
  relocalize(): void {
    this.lastSignature = '';
    this.update();
  }

  update(): void {
    const { element } = this.deps;
    const model = riftFloorTrackerModel(this.deps.world());
    if (!model) {
      this.lastSignature = '';
      if (element.innerHTML !== '') element.innerHTML = '';
      element.style.display = 'none';
      return;
    }
    const signature = JSON.stringify([model.floor, model.floorCount, model.timerSeconds]);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    element.style.display = 'block';

    const floorLine = t('hudChrome.riftTracker.floor', {
      current: num(model.floor),
      total: num(model.floorCount),
    });
    // A dev-spawned rift has no backing event (see rift_floor_tracker_view.ts):
    // degrade to floor progress only, never show a zero/bogus countdown.
    const timerLine =
      model.timerSeconds === null
        ? ''
        : `<div class="rt-obj">${esc(
            t('hudChrome.riftTracker.closesIn', { time: this.clockText(model.timerSeconds) }),
          )}</div>`;
    element.innerHTML =
      `<div class="rt-header">${esc(t('hudChrome.riftTracker.title'))}</div>` +
      `<div class="rt-obj">${esc(floorLine)}</div>` +
      timerLine;
  }

  /** "H:MM:SS" past an hour (community rifts run up to six), else "M:SS". */
  private clockText(totalSeconds: number): string {
    const { hours, minutes, seconds } = riftTimerParts(totalSeconds);
    return hours > 0
      ? t('hudChrome.riftTracker.clockHms', {
          hours: num(hours),
          minutes: pad2(minutes),
          seconds: pad2(seconds),
        })
      : t('hudChrome.riftTracker.clockMs', { minutes: num(minutes), seconds: pad2(seconds) });
  }
}
