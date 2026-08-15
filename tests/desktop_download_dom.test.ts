// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { desktopDownloadUrl, initDesktopDownload } from '../src/game/desktop_download';

function buildView(): void {
  document.body.innerHTML = `
    <section id="download-view">
      <div class="desktop-download-actions">
        <a class="desktop-download-link" data-platform="mac" href="#">mac</a>
        <a class="desktop-download-link" data-platform="linux" href="#">linux</a>
        <a class="desktop-download-link" data-platform="win" href="#">win</a>
      </div>
      <p class="desktop-download-hint" data-platform-hint="linux" hidden>hint</p>
    </section>`;
}

function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

describe('initDesktopDownload', () => {
  beforeEach(buildView);

  it('syncs each button href to the versioned artifact URL', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
    initDesktopDownload(document);
    const mac = document.querySelector('[data-platform="mac"]') as HTMLAnchorElement;
    const linux = document.querySelector('[data-platform="linux"]') as HTMLAnchorElement;
    expect(mac.href).toBe(desktopDownloadUrl('mac'));
    expect(linux.href).toBe(desktopDownloadUrl('linux'));
    expect(linux.getAttribute('aria-disabled')).toBe('false');
    expect(linux.classList.contains('is-unavailable')).toBe(false);
    const win = document.querySelector('[data-platform="win"]') as HTMLAnchorElement;
    expect(win.href).toBe(desktopDownloadUrl('win'));
    expect(win.getAttribute('aria-disabled')).toBe('false');
    expect(win.classList.contains('is-unavailable')).toBe(false);
  });

  it('highlights and floats the visitor OS button first, and reveals its hint', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/125');
    initDesktopDownload(document);
    const actions = document.querySelector('.desktop-download-actions') as HTMLElement;
    const first = actions.firstElementChild as HTMLElement;
    expect(first.dataset.platform).toBe('linux');
    expect(first.classList.contains('is-detected')).toBe(true);
    const hint = document.querySelector('.desktop-download-hint') as HTMLElement;
    expect(hint.hidden).toBe(false);
  });

  it('keeps the Linux hint hidden for non-Linux visitors and highlights their OS', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    initDesktopDownload(document);
    const hint = document.querySelector('.desktop-download-hint') as HTMLElement;
    expect(hint.hidden).toBe(true);
    const mac = document.querySelector('[data-platform="mac"]') as HTMLElement;
    expect(mac.classList.contains('is-detected')).toBe(true);
  });

  it('highlights and floats the Windows button for Windows visitors', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125');
    initDesktopDownload(document);
    const actions = document.querySelector('.desktop-download-actions') as HTMLElement;
    const first = actions.firstElementChild as HTMLElement;
    expect(first.dataset.platform).toBe('win');
    expect(first.classList.contains('is-detected')).toBe(true);
  });

  it('no-ops when the download view is absent', () => {
    document.body.innerHTML = '<main></main>';
    expect(() => initDesktopDownload(document)).not.toThrow();
  });
});

// The static entry-page hrefs are the no-JS fallback for the download buttons.
// They are release-owned (scripts/release_version.mjs rewrites them at prepare)
// while the module derives its version from package.json at build time, so this
// is the guard that reds when only one of the two moves.
function entryLinks(path: string, platform: string): HTMLAnchorElement[] {
  const entry = new DOMParser().parseFromString(readFileSync(path, 'utf8'), 'text/html');
  return [
    ...entry.querySelectorAll<HTMLAnchorElement>(
      `.desktop-download-link[data-platform="${platform}"]`,
    ),
  ];
}

describe('desktop download entry markup', () => {
  it.each(['index.html', 'play.html'])('%s pins its mac and Windows hrefs', (path) => {
    for (const platform of ['mac', 'win'] as const) {
      const links = entryLinks(path, platform);
      expect(links).toHaveLength(1);
      expect(links[0]?.getAttribute('href')).toBe(desktopDownloadUrl(platform));
    }
  });

  it('pins the index.html Linux href, and keeps play.html free of one', () => {
    const links = entryLinks('index.html', 'linux');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe(desktopDownloadUrl('linux'));
    // play.html deliberately links only mac and Windows; collectReleaseVersionFailures
    // exempts pages that never carried an AppImage link.
    expect(entryLinks('play.html', 'linux')).toHaveLength(0);
  });

  it.each(['index.html', 'play.html'])('%s ships an enabled Windows fallback link', (path) => {
    const html = readFileSync(path, 'utf8');
    const entry = new DOMParser().parseFromString(html, 'text/html');
    const links = entry.querySelectorAll<HTMLAnchorElement>(
      '.desktop-download-link[data-platform="win"]',
    );

    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe(desktopDownloadUrl('win'));
    expect(links[0]?.dataset.i18n).toBe('download.windowsCta');
    expect(links[0]?.classList.contains('is-unavailable')).toBe(false);
    expect(entry.querySelector('[data-i18n="download.windowsPending"]')).toBeNull();
  });
});
