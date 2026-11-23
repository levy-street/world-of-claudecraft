// One-time shell footer wiring, shared by web and packaged clients.
import { formatFooterVersion } from './app_version';
import { t } from './i18n';
import { privacyUrlFor, termsUrlFor, whitepaperUrlFor } from './terms_link';

export function syncBuildInfo(version: string, buildId: string, buildDate: string): void {
  const el = document.getElementById('game-version');
  if (!el) return;
  el.textContent = `v${formatFooterVersion(version)} · build ${buildId}`;
  el.title = t('meta.builtOn', { date: buildDate });
}

export function syncFooterLegalLinks(): void {
  const origin = globalThis.location?.origin ?? '';
  const whitepaper = document.querySelector<HTMLAnchorElement>('a[data-i18n="footer.whitepaper"]');
  if (whitepaper) {
    whitepaper.href = whitepaperUrlFor(origin);
    whitepaper.target = '_blank';
    whitepaper.rel = 'noopener noreferrer';
  }
  const terms = document.querySelector<HTMLAnchorElement>('a[data-i18n="footer.terms"]');
  if (terms) {
    terms.href = termsUrlFor(origin);
    terms.target = '_blank';
    terms.rel = 'noopener noreferrer';
  }
  const privacy = document.querySelector<HTMLAnchorElement>('a[data-i18n="footer.privacy"]');
  if (privacy) {
    privacy.href = privacyUrlFor(origin);
    privacy.target = '_blank';
    privacy.rel = 'noopener noreferrer';
  }
}
