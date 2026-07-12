// @vitest-environment jsdom
//
// DOM behavioral guards for the leaderboard window after its shared window-frame
// adoption (the source-string a11y/async pins live in leaderboard_window.test.ts).
// These drive the real painter: the frame chrome is stamped on an inner mount
// (the #leaderboard-window root stays a plain .window.panel), the board rail +
// tabpanel render inside the scrollable body, the realm subtitle lands in the
// resolved title node, the titlebar is a drag handle but the close is not, and the
// close routes to the window's close().

import { describe, expect, it, vi } from 'vitest';
import { LeaderboardWindow, type LeaderboardWindowDeps } from '../src/ui/leaderboard_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';

function lbEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'leaderboard-window';
  el.className = 'window panel';
  // The async board render bails unless the window reads as open (display:block);
  // set it so render() completes its error-state paint deterministically.
  el.style.display = 'block';
  return el;
}

function fakeDeps(
  el: HTMLElement,
  overrides: Partial<LeaderboardWindowDeps> = {},
): LeaderboardWindowDeps {
  const reject = async () => {
    throw new Error('offline');
  };
  return {
    root: () => el,
    world: () =>
      ({
        realm: 'Testrealm',
        player: { name: 'Hero', level: 10, githubLogin: null },
        lifetimeXp: 500,
        leaderboard: reject,
        guildLeaderboard: reject,
        devLeaderboard: reject,
        dailyRewardLeaderboard: reject,
      }) as never,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    showDevBadges: () => true,
    ...overrides,
  };
}

async function renderLb(
  el: HTMLElement,
  overrides: Partial<LeaderboardWindowDeps> = {},
): Promise<LeaderboardWindow> {
  const w = new LeaderboardWindow(fakeDeps(el, overrides));
  await w.render();
  return w;
}

describe('LeaderboardWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an inner mount with titlebar, body, close', async () => {
    const el = lbEl();
    await renderLb(el);
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // The root itself never carries builder class / role / aria.
    expect(el.className).toBe('window panel');
    expect(el.hasAttribute('role')).toBe(false);
  });

  it('sets the realm subtitle into the resolved title node', async () => {
    const el = lbEl();
    await renderLb(el);
    expect(el.querySelector('.window-title')?.textContent).toContain('Testrealm');
    expect(el.querySelector('.window-title .lb-subtitle')).not.toBeNull();
  });

  it('renders the board rail (tablist) and the tabpanel inside the scrollable body', async () => {
    const el = lbEl();
    await renderLb(el);
    expect(el.querySelector('.window-body .lb-tabs[role="tablist"]')).not.toBeNull();
    const panel = el.querySelector<HTMLElement>('.window-body #lb-body-panel');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('role')).toBe('tabpanel');
  });

  it('makes the titlebar a drag handle the Hud recognizes, but never the close', async () => {
    const el = lbEl();
    await renderLb(el);
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const close = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(close, el)).toBe(false);
  });

  it('routes the close control to the window close()', async () => {
    const el = lbEl();
    const w = await renderLb(el);
    const closeSpy = vi.spyOn(w, 'close');
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
