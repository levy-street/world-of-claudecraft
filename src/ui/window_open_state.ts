// The body-class mirror of "which windows are open", moved WHOLE from
// hud.ts syncAnyWindowOpenState (Phase 14, the A1 body-class family fix's
// extraction): the mobile chrome (touch router, controls, layout applier)
// reads these classes off document.body, so this is the ONE writer that keeps
// them true. Four classes, one scan:
//   - mobile-window-open: any .window.panel visible (the More tray excluded,
//     it is a control surface, not a window),
//   - mobile-fullscreen-window-open: the fullscreen bottom-bar hide, decided
//     by mobile_fullscreen_window_core.ts over the bags/char pair and the
//     vendor/bank/market/paired flags,
//   - store-stack-open: the daily-rewards + Claudium stack (diagnosed via
//     store_stack_diag.ts),
//   - mobile-map-quest-open: the map + quest-log stacked layout.
// Hud stays the thin consumer (its private syncAnyWindowOpenState delegates
// here, injecting its isWindowVisible read), so every window's
// onVisibilityChange dep keeps the pinned `() => this.syncAnyWindowOpenState()`
// shape, and a jsdom suite can drive THIS function against real DOM to pin
// the class flips without constructing a Hud.

import { isMobileFullscreenWindowOpen } from './mobile_fullscreen_window_core';
import { recordStoreStackSample } from './store_stack_diag';
import { stackedWindowsVisible } from './window_stack_state_core';

export function syncWindowOpenBodyClasses(isWindowVisible: (el: HTMLElement) => boolean): void {
  const windows = [...document.querySelectorAll<HTMLElement>('.window.panel')];
  const anyOpen = windows
    .filter((win) => win.id !== 'mobile-extra-controls')
    .some((win) => isWindowVisible(win));
  document.body.classList.toggle('mobile-window-open', anyOpen);
  const bagsWindow = document.getElementById('bags');
  const charWindow = document.getElementById('char-window');
  document.body.classList.toggle(
    'mobile-fullscreen-window-open',
    isMobileFullscreenWindowOpen(
      !!bagsWindow && isWindowVisible(bagsWindow),
      !!charWindow && isWindowVisible(charWindow),
      document.body.classList.contains('vendor-open'),
      document.body.classList.contains('bank-open'),
      document.body.classList.contains('market-open'),
      document.body.classList.contains('char-bags-paired'),
    ),
  );
  const storeWindow = document.getElementById('daily-rewards-window') as HTMLElement | null;
  const claudiumWindow = document.getElementById('claudium-window') as HTMLElement | null;
  const storeVisible = !!storeWindow && isWindowVisible(storeWindow);
  const claudiumVisible = !!claudiumWindow && isWindowVisible(claudiumWindow);
  const storeStacked = stackedWindowsVisible(storeVisible, claudiumVisible);
  document.body.classList.toggle('store-stack-open', storeStacked);
  recordStoreStackSample(storeVisible, claudiumVisible, storeStacked);
  const mapWindow = document.getElementById('map-window');
  const questLogWindow = document.getElementById('quest-log-window');
  document.body.classList.toggle(
    'mobile-map-quest-open',
    !!mapWindow &&
      !!questLogWindow &&
      isWindowVisible(mapWindow) &&
      isWindowVisible(questLogWindow),
  );
}
