// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStartPanelNavigation } from '../src/game/start_panel_navigation';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
  document.body.innerHTML =
    '<div id="mode-select"></div><div id="login-panel" hidden></div><div id="forgot-panel" hidden></div>';
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
function expectOnly(id: string) {
  for (const panel of document.querySelectorAll<HTMLElement>('body > div')) {
    expect(panel.hidden).toBe(panel.id !== id);
    expect(panel.className).toBe('');
  }
  expect(document.body.dataset.startPanel).toBe(id);
}
describe('start panel navigation', () => {
  it('cancels Login when Play is clicked before the fade finishes', () => {
    const show = createStartPanelNavigation();
    show('#login-panel', vi.fn());
    show('#mode-select', vi.fn());
    vi.runAllTimers();
    expectOnly('mode-select');
  });
  it('settles rapid login, recovery and Play navigation on the last request', () => {
    const show = createStartPanelNavigation();
    show('#login-panel', vi.fn());
    vi.advanceTimersByTime(150);
    show('#forgot-panel', vi.fn());
    show('#mode-select', vi.fn());
    vi.runAllTimers();
    expectOnly('mode-select');
  });
  it('reveals the panel before notifying the character preview', () => {
    const show = createStartPanelNavigation();
    const onVisible = vi.fn(() =>
      expect(document.getElementById('login-panel')?.hidden).toBe(false),
    );
    show('#login-panel', onVisible);
    vi.runAllTimers();
    expectOnly('login-panel');
    expect(onVisible).toHaveBeenCalledOnce();
  });
});

describe('start panel immediate paths', () => {
  it('reveals immediately with reduced motion and ignores missing optional panels', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const show = createStartPanelNavigation();
    const callback = vi.fn();
    show('#login-panel', callback);
    expectOnly('login-panel');
    expect(callback).toHaveBeenCalledOnce();
    show('#discord-choice-panel', callback);
    expectOnly('login-panel');
    expect(callback).toHaveBeenCalledOnce();
  });
  it('notifies only the requested panel when a transition is canceled', () => {
    const show = createStartPanelNavigation();
    const login = vi.fn();
    const play = vi.fn();
    show('#login-panel', login);
    show('#mode-select', play);
    vi.runAllTimers();
    expectOnly('mode-select');
    expect(login).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledOnce();
  });
});
