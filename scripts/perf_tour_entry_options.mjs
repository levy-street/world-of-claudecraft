const MOBILE_PREFLIGHT_TIMEOUT_MS = 30_000;

export function perfTourEntryOptions(viewport, gameBootTimeoutMs) {
  return {
    charClass: 'warrior',
    charName: viewport.label === 'mobile' ? 'MobilePerf' : 'DesktopPerf',
    settleMs: 0,
    dismissMobilePreflight: viewport.isMobile,
    mobilePreflightTimeoutMs: MOBILE_PREFLIGHT_TIMEOUT_MS,
    gameBootTimeoutMs,
  };
}
