import { describe, expect, it } from 'vitest';
import type { BoolSettingKey } from '../src/game/settings';
import type { OptionsHooks } from '../src/ui/hud';
import { trackerCollapseSettings } from '../src/ui/tracker_collapse_settings';

function fakeHooks() {
  const values = new Map<BoolSettingKey, boolean>();
  const hooks = {
    settings: {
      get: (key: BoolSettingKey) => values.get(key) ?? false,
      set: (key: BoolSettingKey, value: boolean) => {
        values.set(key, value);
        return value;
      },
    },
  } as unknown as OptionsHooks;
  return { hooks, values };
}

describe('trackerCollapseSettings', () => {
  it('is unavailable and reads/writes as a no-op while the hooks are null', () => {
    const port = trackerCollapseSettings(() => null, 'questTrackerCollapsed');
    expect(port.available()).toBe(false);
    expect(port.collapsed()).toBe(false);
    port.setCollapsed(true);
    expect(port.collapsed()).toBe(false);
  });

  it('reads and writes the named boolean setting once the hooks attach', () => {
    const { hooks, values } = fakeHooks();
    const port = trackerCollapseSettings(() => hooks, 'mapAtlasSidebarCollapsed');
    expect(port.available()).toBe(true);
    expect(port.collapsed()).toBe(false);

    port.setCollapsed(true);

    expect(values.get('mapAtlasSidebarCollapsed')).toBe(true);
    expect(port.collapsed()).toBe(true);
  });

  it('keys two ports off the same hooks independently', () => {
    const { hooks } = fakeHooks();
    const quest = trackerCollapseSettings(() => hooks, 'questTrackerCollapsed');
    const map = trackerCollapseSettings(() => hooks, 'mapAtlasSidebarCollapsed');

    quest.setCollapsed(true);

    expect(quest.collapsed()).toBe(true);
    expect(map.collapsed()).toBe(false);
  });
});
