// @vitest-environment jsdom
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
    expect(win.hasAttribute('href')).toBe(false);
    expect(win.getAttribute('aria-disabled')).toBe('true');
    expect(win.classList.contains('is-unavailable')).toBe(true);
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

  it('no-ops when the download view is absent', () => {
    document.body.innerHTML = '<main></main>';
    expect(() => initDesktopDownload(document)).not.toThrow();
  });
});
