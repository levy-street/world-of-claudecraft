// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZONES } from '../src/sim/data';
import { devTownTargets } from '../src/sim/dev/town_teleport';
import { DevCommandWindow, type DevCommandWindowDeps } from '../src/ui/dev_command_window';

function makeWindow(available = true, accountAdmin = true) {
  const chat = vi.fn();
  const deps: DevCommandWindowDeps = {
    available: () => available,
    world: () => ({ chat, accountAdmin }) as never,
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

  it('offers the Spawns tab to admins and hides it from everyone else', () => {
    const { window } = makeWindow(true, true);
    window.toggle();
    expect(document.querySelector('[data-dev-category="spawns"]')).not.toBeNull();
    window.close();

    document.body.innerHTML = '<main id="ui"></main>';
    const { window: nonAdmin } = makeWindow(true, false);
    nonAdmin.toggle();
    expect(nonAdmin.isOpen).toBe(true);
    expect(document.querySelector('[data-dev-category="spawns"]')).toBeNull();
    // The other tabs are untouched, and clicking one still works.
    expect(document.querySelector('[data-dev-category="inventory"]')).not.toBeNull();
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

  it('offers every zone hub on the town card and sends the chosen slug', () => {
    const { chat, window } = makeWindow();
    window.toggle();
    document.querySelector<HTMLButtonElement>('[data-dev-category="travel"]')?.click();

    const select = document.querySelector<HTMLSelectElement>(
      '[data-dev-action="town"] select[data-dev-field="town"]',
    );
    expect(select).not.toBeNull();
    const values = [...(select?.options ?? [])].map((option) => option.value);
    expect(values).toEqual(expect.arrayContaining(devTownTargets(ZONES).map((town) => town.id)));
    expect(values.length).toBe(ZONES.length);
    expect(select?.querySelector('option[value="highwatch"]')?.textContent).toContain('Highwatch');

    if (select) select.value = 'highwatch';
    document.querySelector<HTMLButtonElement>('[data-dev-run="town"]')?.click();
    expect(chat).toHaveBeenCalledWith('/dev town highwatch');
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
