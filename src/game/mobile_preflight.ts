// The "install to home screen" preflight prompt's platform detection and copy
// selection: extracted from main.ts (a client-bootstrap helper, root CLAUDE.md
// "main.ts is a firewall, not a home"). main.ts keeps only the DOM prompt
// wiring (showMobilePreflightPrompt / hideMobilePreflightPrompt), which needs
// its own promise-singleton and element state.
import { t } from '../ui/i18n';

export function mobilePlatform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent;
  const platform = navigator.platform;
  if (/iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1))
    return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

export function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function mobilePreflightCopy(): { detail: string; steps: string[] } {
  const standalone = isStandaloneDisplay();
  const base = [t('mobilePreflight.baseLandscape'), t('mobilePreflight.basePerformance')];
  if (mobilePlatform() === 'ios') {
    return {
      detail: standalone
        ? t('mobilePreflight.iosStandaloneDetail')
        : t('mobilePreflight.iosInstallDetail'),
      steps: standalone
        ? base
        : [t('mobilePreflight.iosShareStep'), t('mobilePreflight.iosOpenStep'), ...base],
    };
  }
  if (mobilePlatform() === 'android') {
    return {
      detail: standalone
        ? t('mobilePreflight.androidStandaloneDetail')
        : t('mobilePreflight.androidInstallDetail'),
      steps: standalone
        ? base
        : [t('mobilePreflight.androidInstallStep'), t('mobilePreflight.androidOpenStep'), ...base],
    };
  }
  return {
    detail: standalone
      ? t('mobilePreflight.otherStandaloneDetail')
      : t('mobilePreflight.otherInstallDetail'),
    steps: base,
  };
}
