// Pure decision for the landing-page cinematic backdrop. Kept DOM-free so it can
// be unit-tested and reused by main.ts: given the device/preference signals it
// answers ONE question — should we show the static poster instead of fetching &
// playing the looping trailer video?
//
// Static-only wins when ANY of these hold, because each is a reason a moving
// 5.7 MB video is unwelcome:
//   - phone: small touch device — battery + cellular data + decode cost.
//   - saveData: the user asked their browser to conserve data (Save-Data hint).
//   - reducedMotion: prefers-reduced-motion — drifting video is a motion trigger.
//   - highContrast: the explicit landingHighContrast setting (legibility choice).

export interface BackdropSignals {
  phone: boolean;
  saveData: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
}

export function shouldUseStaticBackdrop(s: BackdropSignals): boolean {
  return s.phone || s.saveData || s.reducedMotion || s.highContrast;
}
