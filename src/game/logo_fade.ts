// Pure timing curve for the wordmark overlay shown during the first-spawn intro
// cinematic (see spawn_cinematic.ts): the logo fades in near the start of the
// pan, holds fully visible for a beat, then fades back out well before the
// cinematic lands and the HUD is revealed. Deliberately wall-clock driven (the
// cinematic itself runs off performance.now() elapsed seconds, not the sim's
// deterministic 20Hz tick): this is cosmetic overlay timing, not gameplay, so it
// has no business on Rng or the sim tick. No DOM, no Three.js: importable
// directly by Vitest. main.ts (or a thin DOM driver module) feeds elapsed
// seconds in each frame and applies the returned opacity to the overlay element.

export interface LogoFadeWindows {
  fadeInSec: number;
  holdSec: number;
  fadeOutSec: number;
}

// Defaults sized well inside the 9s spawn cinematic (spawnCinematicFor):
// fade in across the opening 1.5s, hold fully visible for 2.5s, fade back out
// over 1.5s, finishing at 5.5s so the overlay is long gone before the ~9s
// cinematic lands and the HUD reappears.
export const DEFAULT_LOGO_FADE_WINDOWS: LogoFadeWindows = {
  fadeInSec: 1.5,
  holdSec: 2.5,
  fadeOutSec: 1.5,
};

// Returns the overlay opacity in [0, 1] at `elapsedSec` into a cinematic of
// `totalDurationSec`. Windows are relative to the START of the cinematic, not
// scaled to totalDurationSec, so a caller can never blow past the total: the
// fade sequence is simply clamped to have fully finished (opacity 0) once
// totalDurationSec is reached even if the windows would otherwise run longer.
export function logoFadeOpacity(
  elapsedSec: number,
  totalDurationSec: number,
  windows: LogoFadeWindows = DEFAULT_LOGO_FADE_WINDOWS,
): number {
  if (elapsedSec <= 0 || totalDurationSec <= 0) return 0;
  if (elapsedSec >= totalDurationSec) return 0;

  const fadeInEnd = windows.fadeInSec;
  const holdEnd = fadeInEnd + windows.holdSec;
  const fadeOutEnd = holdEnd + windows.fadeOutSec;

  if (elapsedSec < fadeInEnd) {
    return windows.fadeInSec <= 0 ? 1 : clamp01(elapsedSec / windows.fadeInSec);
  }
  if (elapsedSec < holdEnd) return 1;
  if (elapsedSec < fadeOutEnd) {
    return windows.fadeOutSec <= 0 ? 0 : clamp01(1 - (elapsedSec - holdEnd) / windows.fadeOutSec);
  }
  return 0;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
