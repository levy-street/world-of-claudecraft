import { describe, expect, it } from 'vitest';
import {
  DESKTOP_VERSION,
  desktopDownloadUrl,
  detectDesktopPlatform,
} from '../src/game/desktop_download';

// Real userAgent strings (trimmed) for the desktop and mobile families.
const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
  fedoraAtomic: 'Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
};

describe('detectDesktopPlatform', () => {
  it('detects macOS', () => {
    expect(detectDesktopPlatform(UA.mac)).toBe('mac');
  });

  it('detects Windows', () => {
    expect(detectDesktopPlatform(UA.win)).toBe('win');
  });

  it('detects Linux, including Fedora atomic (Bazzite) UAs', () => {
    expect(detectDesktopPlatform(UA.linux)).toBe('linux');
    expect(detectDesktopPlatform(UA.fedoraAtomic)).toBe('linux');
  });

  it('does not treat Android as a Linux desktop', () => {
    expect(detectDesktopPlatform(UA.android)).toBe('other');
  });

  it('maps iOS (reports "Mac") to mac, and unknowns to other', () => {
    // iPhone UA contains "Mac OS X"; there is no iOS desktop build, but mac is
    // the closest and the mac button is a harmless fallback.
    expect(detectDesktopPlatform(UA.iphone)).toBe('mac');
    expect(detectDesktopPlatform('some-unknown-agent')).toBe('other');
  });
});

describe('desktopDownloadUrl', () => {
  it('builds the mac universal dmg URL', () => {
    expect(desktopDownloadUrl('mac')).toBe(
      `https://updates.worldofclaudecraft.com/desktop/world-of-claudecraft-${DESKTOP_VERSION}-mac-universal.dmg`,
    );
  });

  it('builds the Linux x86_64 AppImage URL (electron-builder x64 arch token)', () => {
    expect(desktopDownloadUrl('linux')).toBe(
      `https://updates.worldofclaudecraft.com/desktop/world-of-claudecraft-${DESKTOP_VERSION}-linux-x86_64.AppImage`,
    );
  });

  it('builds the combined Windows NSIS installer URL', () => {
    expect(desktopDownloadUrl('win')).toBe(
      `https://updates.worldofclaudecraft.com/desktop/world-of-claudecraft-${DESKTOP_VERSION}-win.exe`,
    );
  });

  it('returns null for platforms with no published artifact', () => {
    expect(desktopDownloadUrl('other')).toBeNull();
  });
});
