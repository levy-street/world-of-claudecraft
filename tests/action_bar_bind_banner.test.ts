// @vitest-environment jsdom
//
// The on-bar key-binding banner's DOM: built by its own module, its buttons
// wired to the caller, and its status line. Placement and drag are pinned in
// tests/action_bar_bind_banner_placement.test.ts.
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

it('reclamps a manually moved banner when the viewport shrinks', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const banner = mountActionBarBindBanner(parent, { onReset: () => {}, onDone: () => {} });
  Object.defineProperty(banner, 'offsetWidth', { value: 200 });
  Object.defineProperty(banner, 'offsetHeight', { value: 80 });
  banner.style.left = '700px';
  banner.style.top = '500px';
  banner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  const width = window.innerWidth,
    height = window.innerHeight;
  try {
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(Number.parseFloat(banner.style.left) + 200).toBeLessThanOrEqual(400);
    expect(Number.parseFloat(banner.style.top) + 80).toBeLessThanOrEqual(300);
  } finally {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
    parent.remove();
  }
});
