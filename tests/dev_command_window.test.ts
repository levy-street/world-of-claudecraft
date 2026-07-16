// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DevCommandWindow, type DevCommandWindowDeps } from '../src/ui/dev_command_window';

function makeWindow(available = true) {
  const chat = vi.fn();
  const deps: DevCommandWindowDeps = {
    available: () => available,
    world: () => ({ chat }) as never,
    closeOthers: vi.fn(),
    captureFocus: () => document.activeElement as HTMLElement | null,
    restoreFocus: vi.fn(),
  };
  return { chat, window: new DevCommandWindow(deps) };
}

beforeEach(() => {
  document.body.innerHTML = '<main id="ui"></main>';
});

describe('developer command window', () => {
  it('does not create a production-disabled surface', () => {
    const { window } = makeWindow(false);
    expect(window.toggle()).toBe(false);
    expect(document.querySelector('#dev-command-window')).toBeNull();
  });

  it('routes actions through world chat and preserves keyboard focus after repaint', () => {
    const { chat, window } = makeWindow();
    expect(window.toggle()).toBe(true);
    const before = document.querySelector<HTMLButtonElement>('[data-dev-run="heal"]');
    expect(before).not.toBeNull();
    before?.focus();
    before?.click();

    const fresh = document.querySelector<HTMLButtonElement>('[data-dev-run="heal"]');
    expect(chat).toHaveBeenCalledWith('/dev heal');
    expect(fresh).not.toBe(before);
    expect(document.activeElement).toBe(fresh);
    expect(document.querySelector('.dev-command-footer output')?.textContent).toContain(
      '/dev heal',
    );
  });

  it('preserves focus on the selected category after rebuilding its command list', () => {
    const { window } = makeWindow();
    window.toggle();
    const before = document.querySelector<HTMLButtonElement>('[data-dev-category="spawns"]');
    before?.focus();
    before?.click();

    const fresh = document.querySelector<HTMLButtonElement>('[data-dev-category="spawns"]');
    expect(fresh).not.toBe(before);
    expect(fresh?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(fresh);
    expect(document.querySelector('[data-dev-action="spawn"]')).not.toBeNull();
  });
});
