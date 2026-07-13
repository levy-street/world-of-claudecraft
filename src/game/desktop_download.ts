// Landing-page desktop-download wiring. Builds the per-platform installer URLs
// from one version constant and, as progressive enhancement, highlights the
// visitor's own OS and reveals the AppImage note for Linux. main.ts stays a
// firewall: it only calls initDesktopDownload() once at landing bootstrap. The
// pure helpers (detectDesktopPlatform, desktopDownloadUrl) are Node-tested.

export type DesktopPlatform = 'mac' | 'win' | 'linux' | 'other';

// The published desktop build on the update host. Bump in lockstep with the
// artifacts uploaded to updates.worldofclaudecraft.com/desktop/ at release
// (see docs/desktop-release.md). The static hrefs in index.html carry the same
// version as a no-JS fallback.
export const DESKTOP_VERSION = '0.24.1';
const DESKTOP_HOST = 'https://updates.worldofclaudecraft.com/desktop';

// electron-builder website-channel artifact names (docs/desktop-release.md):
// mac ships one universal dmg; the x64 Linux AppImage is named x86_64 (that is
// electron-builder's arch token for AppImage, not "x64"). Windows is not
// published yet, so it has no entry here.
const ARTIFACT: Partial<Record<DesktopPlatform, string>> = {
  mac: `world-of-claudecraft-${DESKTOP_VERSION}-mac-universal.dmg`,
  linux: `world-of-claudecraft-${DESKTOP_VERSION}-linux-x86_64.AppImage`,
};

// Full download URL for a platform, or null when no artifact is published for it.
export function desktopDownloadUrl(platform: DesktopPlatform): string | null {
  const file = ARTIFACT[platform];
  return file ? `${DESKTOP_HOST}/${file}` : null;
}

// Best-effort desktop-OS detection from a userAgent string. Pure so Node tests
// can pin each family; the DOM consumer passes navigator.userAgent. Android
// reports "linux" in its UA but is not a desktop target, so it maps to 'other'.
export function detectDesktopPlatform(userAgent: string): DesktopPlatform {
  const ua = userAgent.toLowerCase();
  if (ua.includes('android')) return 'other';
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('win')) return 'win';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'other';
}

// Wire the landing download view: sync hrefs to the version constant, highlight
// the visitor's platform button (and float it first), and reveal any note keyed
// to that platform. No-ops when the view is absent (every non-index entry).
export function initDesktopDownload(doc: Document = document): void {
  const section = doc.getElementById('download-view');
  if (!section) return;
  const links = section.querySelectorAll<HTMLAnchorElement>(
    '.desktop-download-link[data-platform]',
  );
  for (const link of links) {
    const platform = link.dataset.platform as DesktopPlatform | undefined;
    const url = platform ? desktopDownloadUrl(platform) : null;
    link.classList.toggle('is-unavailable', !url);
    link.setAttribute('aria-disabled', url ? 'false' : 'true');
    if (url) {
      link.href = url;
    } else {
      link.removeAttribute('href');
    }
  }
  const detected = detectDesktopPlatform(navigator.userAgent);
  const actions = section.querySelector('.desktop-download-actions');
  for (const link of links) {
    const platform = link.dataset.platform as DesktopPlatform | undefined;
    const isSelf = !!platform && !!desktopDownloadUrl(platform) && platform === detected;
    link.classList.toggle('is-detected', isSelf);
    if (isSelf && actions && link !== actions.firstElementChild) actions.prepend(link);
  }
  const hints = section.querySelectorAll<HTMLElement>('[data-platform-hint]');
  for (const hint of hints) {
    const platform = hint.dataset.platformHint as DesktopPlatform | undefined;
    hint.hidden = platform !== detected || !desktopDownloadUrl(platform);
  }
}
