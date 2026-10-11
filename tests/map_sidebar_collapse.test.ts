import { describe, expect, it, vi } from 'vitest';
import { MapSidebarCollapse } from '../src/ui/hud/map/map_sidebar_collapse';

function harness(initial: boolean | null) {
  let collapsed = initial ?? false;
  const settings = {
    available: () => initial !== null,
    collapsed: () => collapsed,
    setCollapsed: vi.fn((next: boolean) => {
      collapsed = next;
    }),
  };
  const state = { mapOpen: false };
  const onChange = vi.fn();
  const openMap = vi.fn(() => {
    state.mapOpen = true;
  });
  const collapse = new MapSidebarCollapse({
    settings,
    mapOpen: () => state.mapOpen,
    openMap,
    onChange,
  });
  return { settings, state, collapse, onChange, openMap };
}

describe('map sidebar collapse (the world-quest board opener)', () => {
  it('expand is a no-op when the rail is shown and unfolds it when folded', () => {
    const shown = harness(false);
    shown.collapse.expand();
    expect(shown.settings.setCollapsed).not.toHaveBeenCalled();
    expect(shown.onChange).not.toHaveBeenCalled();
    const folded = harness(true);
    folded.collapse.expand();
    expect(folded.settings.setCollapsed).toHaveBeenCalledWith(false);
    expect(folded.collapse.collapsed()).toBe(false);
    expect(folded.onChange).toHaveBeenCalledTimes(1);
  });

  it('openBoard opens a closed map and always unfolds the rail', () => {
    const h = harness(true);
    h.collapse.openBoard();
    expect(h.openMap).toHaveBeenCalledTimes(1);
    expect(h.collapse.collapsed()).toBe(false);
    h.collapse.openBoard();
    expect(h.openMap).toHaveBeenCalledTimes(1);
    expect(h.onChange).toHaveBeenCalledTimes(1);
  });

  it('reads as shown before the preference store exists', () => {
    const h = harness(null);
    expect(h.collapse.collapsed()).toBe(false);
    h.collapse.expand();
    expect(h.settings.setCollapsed).not.toHaveBeenCalled();
  });
});
