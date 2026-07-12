// Thin DOM driver for the wordmark overlay shown during the first-spawn intro
// cinematic. All timing math lives in the pure, host-agnostic logo_fade.ts;
// this module only ever reads its opacity output and writes it to one element,
// so it stays a one-line consumer main.ts can call from its existing
// introCameraTick/finishIntro without growing new logic there.

import { type LogoFadeWindows, logoFadeOpacity } from './logo_fade';

export interface IntroLogoOverlay {
  // Call once per intro-cinematic frame with elapsed seconds and the
  // cinematic's total duration; updates the element's opacity/visibility.
  tick(elapsedSec: number, totalDurationSec: number): void;
  // Force-hides the overlay immediately (intro skipped or finished).
  hide(): void;
}

export function createIntroLogoOverlay(
  el: HTMLElement | null,
  windows?: LogoFadeWindows,
): IntroLogoOverlay {
  return {
    tick(elapsedSec: number, totalDurationSec: number): void {
      if (!el) return;
      const opacity = logoFadeOpacity(elapsedSec, totalDurationSec, windows);
      el.style.opacity = String(opacity);
      el.style.display = opacity > 0 ? '' : 'none';
    },
    hide(): void {
      if (!el) return;
      el.style.opacity = '0';
      el.style.display = 'none';
    },
  };
}
