// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showFatalOverlay } from '../src/ui/fatal_overlay_controller';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('fatal overlay update recovery', () => {
  it('focuses recovery, traps Tab and shields native button keys from game input', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(0, 0, 100, 40),
    ] as unknown as DOMRectList);
    const gameKey = vi.fn();
    window.addEventListener('keydown', gameKey);
    try {
      showFatalOverlay('Version mismatch', { searchUpdates: async () => 'none' });
      const buttons = document.querySelectorAll('button');
      await vi.waitFor(() => expect(document.activeElement).toBe(buttons[0]));
      expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe(
        'disconnect-message',
      );
      buttons[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
      expect(document.activeElement).toBe(buttons[1]);
      buttons[1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
      expect(document.activeElement).toBe(buttons[0]);
      const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      buttons[0].dispatchEvent(space);
      expect(space.defaultPrevented).toBe(false);
      expect(gameKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', gameKey);
    }
  });
  it('keeps ordinary errors limited to return to login and preserves the first reason', () => {
    showFatalOverlay('Connection lost');
    showFatalOverlay('Another error', { searchUpdates: vi.fn() });
    expect(document.querySelectorAll('button')).toHaveLength(1);
    expect(document.body.textContent).toContain('Connection lost');
    expect(document.body.textContent).not.toContain('Another error');
  });

  it('searches once per click, then offers an explicit restart for a downloaded update', async () => {
    let resolve!: (value: 'ready') => void;
    const searchUpdates = vi.fn(
      () =>
        new Promise<'ready'>((done) => {
          resolve = done;
        }),
    );
    const installUpdate = vi.fn(async () => {});
    showFatalOverlay('Version mismatch', { searchUpdates, installUpdate });
    const search = document.querySelector('button')!;
    expect(search.textContent).toBe('Search for updates');
    search.click();
    search.click();
    expect(search.disabled).toBe(true);
    expect(searchUpdates).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('button')).toHaveLength(2);
    resolve('ready');
    await vi.waitFor(() => expect(search.textContent).toBe('Restart now'));
    search.click();
    await vi.waitFor(() => expect(installUpdate).toHaveBeenCalledTimes(1));
    expect(searchUpdates).toHaveBeenCalledTimes(1);
  });

  it.each(['none', 'unavailable', 'failed'] as const)(
    'reports %s and allows another search',
    async (result) => {
      const searchUpdates = vi.fn(async () => result);
      showFatalOverlay('Version mismatch', { searchUpdates });
      const search = document.querySelector('button')!;
      search.click();
      await vi.waitFor(() => expect(search.disabled).toBe(false));
      expect(document.querySelector('[role="status"]')?.textContent).toBe(
        {
          none: 'No update found. Try again shortly.',
          unavailable: 'Update through your game store or download the latest client.',
          failed: 'Could not check for updates. Please try again.',
        }[result],
      );
      expect(search.textContent).toBe('Search for updates');
      search.click();
      expect(searchUpdates).toHaveBeenCalledTimes(2);
    },
  );

  it('recovers from a rejected update search without rendering raw bridge errors', async () => {
    showFatalOverlay('Version mismatch', {
      searchUpdates: async () => {
        throw new Error('private');
      },
    });
    const search = document.querySelector('button')!;
    search.click();
    await vi.waitFor(() => expect(search.disabled).toBe(false));
    expect(document.body.textContent).toContain('Could not check for updates');
    expect(document.body.textContent).not.toContain('private');
  });
});
