// @vitest-environment happy-dom

// Direct coverage for the Drowned Reliquary Rite difficulty popup
// (src/ui/hud/delve/rite_window.ts). The opening/focus lifecycle is pinned
// against RiteController (tests/rite_controller.test.ts); this file drives
// RiteWindow.render() itself, the one thing that owns the panel's markup and
// (since #2808) its WCAG 2.2 dialog identity.

import { describe, expect, it, vi } from 'vitest';
import { RiteWindow } from '../src/ui/hud/delve/rite_window';

function harness() {
  document.body.innerHTML = '<div id="delve-rite-panel" style="display:block"></div>';
  const panel = document.getElementById('delve-rite-panel') as HTMLElement;
  const onChoose = vi.fn();
  const onClose = vi.fn();
  const win = new RiteWindow({ panel: () => panel, onChoose, onClose });
  return { win, panel, onChoose, onClose };
}

describe('RiteWindow.render', () => {
  it('paints the three intensity options and wires them to onChoose', () => {
    const h = harness();
    h.win.render();

    const buttons = h.panel.querySelectorAll<HTMLButtonElement>('[data-rite]');
    expect([...buttons].map((b) => b.dataset.rite)).toEqual(['easy', 'medium', 'hard']);
    buttons[1].click();
    expect(h.onChoose).toHaveBeenCalledWith('medium');
  });

  it('the close button reports onClose', () => {
    const h = harness();
    h.win.render();

    h.panel.querySelector<HTMLButtonElement>('[data-close]')?.click();
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('marks the panel a labeled dialog (accessible name, #2808)', () => {
    const h = harness();
    h.win.render();

    expect(h.panel.getAttribute('role')).toBe('dialog');
    expect(h.panel.getAttribute('aria-modal')).toBe('false');
    expect(h.panel.getAttribute('tabindex')).toBe('-1');
    expect(h.panel.getAttribute('aria-label')).toBe('The Drowned Reliquary Rite');
    expect(h.panel.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('keeps the dialog identity across a repeated render (no drift, no doubled name)', () => {
    const h = harness();
    h.win.render();
    h.win.render();

    expect(h.panel.getAttribute('aria-label')).toBe('The Drowned Reliquary Rite');
    expect(h.panel.getAttribute('role')).toBe('dialog');
  });

  it('is a no-op when the panel is not mounted', () => {
    const win = new RiteWindow({ panel: () => null, onChoose: vi.fn(), onClose: vi.fn() });
    expect(() => win.render()).not.toThrow();
  });
});
