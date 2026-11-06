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
  return { settings, collapse: new MapSidebarCollapse({ settings }) };
}

// Menu consolidation step 8: on the touch HUD the atlas rail starts folded
// every time the map opens; the desktop rail keeps the player's choice.
describe('map sidebar collapse (fold on open, touch only)', () => {
  it('folds an unfolded rail when the map opens on the touch HUD', () => {
    const h = harness(false);
    h.collapse.foldOnOpen(true);
    expect(h.settings.setCollapsed).toHaveBeenCalledWith(true);
    expect(h.collapse.collapsed()).toBe(true);
  });

  it('leaves the desktop rail as the player left it', () => {
    const shown = harness(false);
    shown.collapse.foldOnOpen(false);
    expect(shown.settings.setCollapsed).not.toHaveBeenCalled();
    expect(shown.collapse.collapsed()).toBe(false);
    const folded = harness(true);
    folded.collapse.foldOnOpen(false);
    expect(folded.settings.setCollapsed).not.toHaveBeenCalled();
    expect(folded.collapse.collapsed()).toBe(true);
  });

  it('writes nothing when already folded, or before the settings port is attached', () => {
    const folded = harness(true);
    folded.collapse.foldOnOpen(true);
    expect(folded.settings.setCollapsed).not.toHaveBeenCalled();
    const detached = harness(null);
    detached.collapse.foldOnOpen(true);
    expect(detached.settings.setCollapsed).not.toHaveBeenCalled();
    expect(detached.collapse.collapsed()).toBe(false);
  });
});
