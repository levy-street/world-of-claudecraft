// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { RiteController } from '../src/ui/hud/delve/rite_controller';

function harness() {
  const panel = document.createElement('div');
  panel.id = 'delve-rite-panel';
  panel.style.display = 'none';
  document.body.appendChild(panel);
  const focusFirst = vi.fn();
  const release = vi.fn();
  const choose = vi.fn();
  const trap: FocusTrapHandle = { focusFirst, release };
  const openFocusTrap = vi.fn(() => trap);
  const controller = new RiteController({ panel, openFocusTrap, choose });
  return { controller, panel, focusFirst, release, choose, openFocusTrap };
}

describe('RiteController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('owns one focus trap for the visible lifetime and releases it with the requested policy', () => {
    const test = harness();

    test.controller.open();
    test.controller.open();

    expect(test.panel.style.display).toBe('block');
    expect(test.panel.innerHTML).toContain('lp-ante-row');
    expect(test.openFocusTrap).toHaveBeenCalledTimes(1);
    expect(test.focusFirst).toHaveBeenCalledWith('.lp-ante-btn');

    test.controller.close(false);
    test.controller.close(false);
    expect(test.panel.style.display).toBe('none');
    expect(test.release).toHaveBeenCalledTimes(1);
    expect(test.release).toHaveBeenCalledWith(false);
  });

  it('submits the chosen intensity and closes the panel', () => {
    const test = harness();
    test.controller.open();

    test.panel.querySelector<HTMLButtonElement>('[data-rite="hard"]')?.click();

    expect(test.choose).toHaveBeenCalledWith('hard');
    expect(test.panel.style.display).toBe('none');
    expect(test.release).toHaveBeenCalledWith(true);
  });
});
