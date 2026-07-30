export interface PerfTourViewport {
  label: string;
  isMobile: boolean;
}

export interface PerfTourEntryOptions {
  charClass: 'warrior';
  charName: 'MobilePerf' | 'DesktopPerf';
  settleMs: 0;
  dismissMobilePreflight: boolean;
  mobilePreflightTimeoutMs: number;
  gameBootTimeoutMs: number;
}

export function perfTourEntryOptions(
  viewport: PerfTourViewport,
  gameBootTimeoutMs: number,
): PerfTourEntryOptions;
