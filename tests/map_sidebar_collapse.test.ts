// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import {
  MAP_SIDEBAR_COLLAPSED_CLASS,
  MapSidebarCollapse,
} from '../src/ui/hud/map/map_sidebar_collapse';

function harness(initial: boolean | null) {
  const window = document.createElement('div');
  const button = document.createElement('button');
  const store = new Map<string, boolean>();
  if (initial !== null) store.set('mapSidebarCollapsed', initial);
  const settings =
    initial === null
      ? () => null
      : () =>
          ({
            get: (key: string) => store.get(key) ?? false,
            set: (key: string, value: boolean) => store.set(key, value),
          }) as never;
  const onChange = vi.fn();
  const openMap = vi.fn();
  const collapse = new MapSidebarCollapse({ window, button, settings, onChange, openMap });
  return { window, button, store, collapse, onChange, openMap };
}

describe('map sidebar collapse', () => {
  it('applies the persisted preference on construction and flips it on the button', () => {
    const h = harness(true);
    expect(h.window.classList.contains(MAP_SIDEBAR_COLLAPSED_CLASS)).toBe(true);
    expect(h.button.getAttribute('aria-pressed')).toBe('false');
    h.button.click();
    expect(h.store.get('mapSidebarCollapsed')).toBe(false);
    expect(h.window.classList.contains(MAP_SIDEBAR_COLLAPSED_CLASS)).toBe(false);
    expect(h.button.getAttribute('aria-pressed')).toBe('true');
    expect(h.onChange).toHaveBeenCalledTimes(1);
  });

  it('expand is a no-op when already shown and unfolds when collapsed', () => {
    const h = harness(false);
    h.collapse.expand();
    expect(h.onChange).not.toHaveBeenCalled();
    h.collapse.toggle();
    expect(h.collapse.collapsed()).toBe(true);
    h.collapse.expand();
    expect(h.collapse.collapsed()).toBe(false);
    expect(h.onChange).toHaveBeenCalledTimes(2);
  });

  it('openBoard opens a closed map and always unfolds the rail', () => {
    const h = harness(true);
    h.collapse.openBoard();
    expect(h.openMap).toHaveBeenCalledTimes(1);
    expect(h.collapse.collapsed()).toBe(false);
    h.window.style.display = 'block';
    h.collapse.openBoard();
    expect(h.openMap).toHaveBeenCalledTimes(1);
  });

  it('reads as shown before the preference store exists', () => {
    const h = harness(null);
    expect(h.collapse.collapsed()).toBe(false);
    expect(h.button.getAttribute('aria-pressed')).toBe('true');
  });
});
