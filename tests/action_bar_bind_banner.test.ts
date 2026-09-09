// @vitest-environment jsdom
//
// The on-bar key-binding banner as a HUD-root element: built by its own module,
// its buttons wired to the caller, and placed against the LIVE primary bar in
// HUD author px (the #ui zoom divided out) so a bar moved with Interface Unlock
// never paints over its own Done / Reset buttons (the stuck-mode bug).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mountActionBarBindBanner,
  setActionBarBindBannerStatus,
} from '../src/ui/hud/action_bar/action_bar_bind_banner';

const audioMock = vi.hoisted(() => ({
  click: vi.fn(),
}));

vi.mock('../src/game/audio', () => ({
  audio: { click: audioMock.click },
}));

vi.mock('../src/ui/i18n', () => ({
  t: (key: string, params?: Record<string, string>) =>
    params ? `${key}:${Object.values(params).join(',')}` : key,
}));

describe('mountActionBarBindBanner', () => {
  beforeEach(() => {
    audioMock.click.mockClear();
    document.body.innerHTML = '<div id="ui"></div>';
  });

  it('appends the banner with the hint, a status line, and Reset + Done wired to the caller', () => {
    const onReset = vi.fn();
    const onDone = vi.fn();
    const parent = document.getElementById('ui');
    const banner = mountActionBarBindBanner(parent, { onReset, onDone });
    expect(banner.id).toBe('actionbar-bind-banner');
    expect(banner.isConnected).toBe(true);
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.querySelector('.actionbar-bind-hint')?.textContent).toBe(
      'hudChrome.actionBar.bannerHint',
    );
    const buttons = banner.querySelectorAll<HTMLButtonElement>('.actionbar-bind-actions button');
    expect([...buttons].map((b) => b.textContent)).toEqual([
      'hudChrome.actionBar.reset',
      'hudChrome.actionBar.done',
    ]);
    buttons[0].click();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(audioMock.click).toHaveBeenCalledTimes(1);
    buttons[1].click();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(audioMock.click).toHaveBeenCalledTimes(2);
  });

  it('writes the status line from the current state', () => {
    const banner = mountActionBarBindBanner(document.getElementById('ui'), {
      onReset: () => {},
      onDone: () => {},
    });
    setActionBarBindBannerStatus(banner, { selectedSlot: 1, lastBoundKeyLabel: null });
    expect(banner.querySelector('.actionbar-bind-status')?.textContent).toBe(
      'hudChrome.actionBar.bannerCapturing',
    );
    setActionBarBindBannerStatus(banner, { selectedSlot: null, lastBoundKeyLabel: 'R' });
    expect(banner.querySelector('.actionbar-bind-status')?.textContent).toBe(
      'hudChrome.actionBar.boundToKey:R',
    );
    setActionBarBindBannerStatus(banner, { selectedSlot: null, lastBoundKeyLabel: null });
    expect(banner.querySelector('.actionbar-bind-status')?.textContent).toBe('');
  });

  it('tolerates a missing parent', () => {
    const banner = mountActionBarBindBanner(null, { onReset: () => {}, onDone: () => {} });
    expect(banner.isConnected).toBe(false);
  });
});
