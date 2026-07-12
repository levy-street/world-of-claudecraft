// @vitest-environment jsdom
//
// Behavioral guards for the Daily Rewards window after its shared window-frame
// adoption: the frame chrome is stamped on an inner mount (the root stays a plain
// .window.panel), the reward body region is present, the shell is reused across
// repaints, the titlebar is a drag handle but the close is not, and the close
// routes to the window's close(). The reward content itself and the chest-toggle
// confirm flow stay covered by daily_rewards_window_chest_toggle.test.ts.

import { describe, expect, it, vi } from 'vitest';
import { DailyRewardsWindow, type DailyRewardsWindowDeps } from '../src/ui/daily_rewards_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';

function drEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'daily-rewards-window';
  el.className = 'window panel';
  return el;
}

function fakeDeps(
  el: HTMLElement,
  overrides: Partial<DailyRewardsWindowDeps> = {},
): DailyRewardsWindowDeps {
  return {
    root: () => el,
    world: () =>
      ({
        dailyRewards: async () => {
          throw new Error('unavailable');
        },
        dailyRewardHistory: async () => ({ payouts: [] }),
      }) as never,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    ...overrides,
  };
}

// ensureShell is the cold-path frame builder; call it directly so the frame is
// asserted without driving the async render's await.
function shell(w: DailyRewardsWindow): void {
  (w as unknown as { ensureShell(): void }).ensureShell();
}

describe('DailyRewardsWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an inner mount with titlebar, body, close', () => {
    const el = drEl();
    shell(new DailyRewardsWindow(fakeDeps(el)));
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // The reward body lives inside the scrollable frame body.
    expect(el.querySelector('.window-body .dr-body')).not.toBeNull();
    // The root itself never carries builder class / role / aria.
    expect(el.className).toBe('window panel');
    expect(el.hasAttribute('role')).toBe(false);
  });

  it('reuses the shell across repaints instead of rebuilding it cold', () => {
    const el = drEl();
    const w = new DailyRewardsWindow(fakeDeps(el));
    shell(w);
    const body = el.querySelector('.window-body');
    const drBody = el.querySelector('.dr-body');
    shell(w);
    expect(el.querySelector('.window-body')).toBe(body);
    expect(el.querySelector('.dr-body')).toBe(drBody);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
  });

  it('makes the titlebar a drag handle the Hud recognizes, but never the close', () => {
    const el = drEl();
    shell(new DailyRewardsWindow(fakeDeps(el)));
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const close = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(close, el)).toBe(false);
  });

  it('routes the close control to the window close()', () => {
    const el = drEl();
    const w = new DailyRewardsWindow(fakeDeps(el));
    shell(w);
    const closeSpy = vi.spyOn(w, 'close');
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
